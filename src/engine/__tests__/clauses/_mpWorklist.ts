// The multiplayer data work queue (docs/TESTING.md, "Multiplayer vocabulary gate").
//
// The spec (data/card-tests/mp-spec/<set>.json) records, per clause, every behavior site that
// holds a player word and whether the stored value has to change (`edit: true`). This module
// reads the spec against the live card data and answers, per site:
//   - `edit: true`  -> still pending (the site holds its recorded `now`), or done, or changed to
//                      something that is not a valid target form for its meaning ("invalid");
//   - `edit: true, now: null` (a new node: a wrapper, a step, a field) -> pending until its path
//                      holds a valid form for its meaning, then done;
//   - `edit: false` -> must still hold its `now`.
// A `movedTo` path (a data edit moved the site) is judged in place of `path`.
// The pending sites are the work queue, written to data/card-tests/mp-worklist.json by
// `npm run card-tests -- mp-worklist` and checked by `mp-vocabulary.test.ts`.
//
// The verdict is a pure function of the spec and the card data: no state is carried between runs, so
// regenerating the worklist never changes a verdict.
//
// Shared by the CLI and the gate so the file and the check can never drift.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CardDefinition } from "../../../engine.js";
import { CATALOG } from "./_manifest.js";
import { PLAIN_WORDS, PLAYER_FIELDS, type MpGroup } from "./_mpInventory.js";

const DATA = fileURLToPath(new URL("../../../../data/", import.meta.url));
export const WORKLIST_FILE = DATA + "card-tests/mp-worklist.json";
const SPEC_DIR = DATA + "card-tests/mp-spec/";

// --- The spec ----------------------------------------------------------------------

export interface SpecDataChange {
  path: string;
  /** Where the site is after a data edit moved it (a pick step inserted before it, a wrapper added around it). Judged in place of `path`. */
  movedTo?: string;
  now: unknown;
  meaning: string;
  edit: boolean;
  why?: string;
}
export interface SpecClause {
  key: string;
  status: string;
  dataChanges?: SpecDataChange[];
}
export interface SpecGroup {
  id: string;
  name: string;
  clauses: SpecClause[];
}

/** One `dataChanges` entry with where it came from. */
export interface Site extends SpecDataChange {
  /** The set the spec file belongs to (`mp-spec/<set>.json`). */
  set: string;
  /** The rules group's representative printing. */
  id: string;
  card: string;
  clause: string;
}

/** Every spec file's sites, sets in catalog order (`data/sets.json`), entries in file order. */
export function loadSpecSites(): Site[] {
  const sets = (JSON.parse(readFileSync(DATA + "sets.json", "utf8")) as Array<{ id: string }>).map((set) => set.id);
  const sites: Site[] = [];
  for (const set of sets) {
    const file = `${SPEC_DIR}${set}.json`;
    if (!existsSync(file)) continue;
    for (const group of JSON.parse(readFileSync(file, "utf8")) as SpecGroup[])
      for (const clause of group.clauses)
        for (const change of clause.dataChanges ?? []) sites.push({ ...change, set, id: group.id, card: group.name, clause: clause.key });
  }
  return sites;
}

export const describeSite = (site: Pick<Site, "card" | "clause" | "path">): string => `${site.card} ${site.clause} ${site.path}`;

// --- Reading the data -----------------------------------------------------------------

const SEGMENT = /([^.[\]]+)|\[(\d+)\]/g;

/** The value at `path` (`behavior.abilities[0].effects[1].player`) in a card; `found: false` when any step is missing. */
export function resolvePath(root: unknown, path: string): { found: boolean; value?: unknown } {
  let current = root;
  for (const match of path.matchAll(SEGMENT)) {
    const step = match[2] !== undefined ? Number(match[2]) : match[1]!;
    if (current === null || typeof current !== "object" || !(step in (current as object))) return { found: false };
    current = (current as Record<string | number, unknown>)[step];
  }
  return { found: true, value: current };
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** The inventory's word for a value: a string is itself, an object is its `type` (PlayerRef, iterating effect). */
const wordOf = (value: unknown): string | undefined => (typeof value === "string" ? value : isObject(value) && typeof value.type === "string" ? value.type : undefined);

const deepEqual = (a: unknown, b: unknown): boolean => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

/** A shallow description of a node: its own keys and primitive values, with nested nodes reduced to `#`, so edits deeper in the subtree do not count as edits of this site. */
function shallow(value: unknown): unknown {
  const own = (node: Record<string, unknown>) => Object.fromEntries(Object.keys(node).sort().map((key) => [key, node[key] !== null && typeof node[key] === "object" ? "#" : node[key]]));
  if (Array.isArray(value)) return value.map((item) => (isObject(item) ? own(item) : item !== null && typeof item === "object" ? "#" : item));
  return isObject(value) ? own(value) : value === undefined ? null : value;
}

/** A `now` that names a stored value (a word, flag, number, node JSON or list). `null` is a new node; anything else (prose) is not a stored value. */
const isRecordedValue = (now: unknown): boolean =>
  typeof now === "boolean" || typeof now === "number" || (typeof now === "string" && /^\w+$/.test(now)) || isObject(now) || Array.isArray(now);

/** Whether the stored primitive `value` is the recorded `now` (`true` also matches `"true"`). */
const primitiveIs = (value: unknown, now: unknown): boolean => deepEqual(value, now) || (typeof value !== "object" && typeof now === "string" && String(value) === now);

/** Whether a node still looks like the recorded word `now`: the same word (a `forEachPlayer` that has since gained `players` / `except` no longer does). */
function looksLikeNow(value: unknown, now: unknown): boolean {
  if (deepEqual(value, now)) return true;
  if (!isObject(value) || typeof now !== "string" || wordOf(value) !== now) return false;
  return !(now === "forEachPlayer" && ("players" in value || "except" in value));
}

/**
 * Whether the value at a site is still its recorded `now`, judged from the data alone. A primitive is compared
 * directly, a recorded node by its own keys and scalar fields (an edit deeper in the subtree is not an edit of this
 * site), a node recorded as a word by that word.
 */
function stillNow(live: { found: boolean; value?: unknown }, now: unknown): boolean {
  if (!live.found) return false;
  if (isObject(now) || Array.isArray(now)) return deepEqual(shallow(live.value), shallow(now));
  if (live.value !== null && typeof live.value === "object") return looksLikeNow(live.value, now);
  return primitiveIs(live.value, now);
}

// --- Target forms ---------------------------------------------------------------------------

/**
 * Where in the data a player word sits. The engine reads `"opponents"` and `"acting"` differently in each:
 * - `chooser`: a PlayerRef read by `resolvePlayerRef` (`"opponents"` is refused: wrap the choice in `forEachPlayer`).
 * - `target`: the `player` of a TargetRef (`deckPosition`, `factionOf`): a PlayerRef, `"opponents"` refused.
 * - `effect`: the `player` of an effect: `"opponents"` runs the effect once per opponent.
 * - `condition`: `player` / `controlledBy` / `by` of a condition: `"opponents"` holds when it holds for any opponent.
 * - `selector`: a selector's `controller` / `owner`: a PlayerScope (`"opponents"` is any opponent; `"acting"` is not read).
 * - `scope`: any other field (restrictions, modifiers, taxes): a PlayerScope, `"opponents"` is any opponent.
 */
export type Slot = "chooser" | "target" | "effect" | "condition" | "selector" | "scope";

/** The slot a player word at `path` sits in. */
export function slotOf(path: string): Slot {
  const leaf = [...path.matchAll(SEGMENT)].filter((match) => match[1] !== undefined).map((match) => match[1]!).pop();
  // A replacement ability's own `chooser` is the offer "any opponent may pay ..." (`"opponents"`: each opponent in turn), not an effect's chooser.
  if (leaf === "chooser") return /^(?:behavior|faction)\.abilities\[\d+\]\.chooser$/.test(path) ? "scope" : "chooser";
  if (/\.target\.player$/.test(path)) return "target";
  if (/(?:effects|elseEffects)\[\d+\]\.player$/i.test(path)) return "effect";
  if (leaf === "controller" || leaf === "owner") return "selector";
  if ((leaf === "player" || leaf === "controlledBy" || leaf === "by") && /(?:^|\.)conditions?(?:\[\d+\])?\./.test(path)) return "condition";
  return "scope";
}

/** A data form a site may hold: a literal string, or an object with a `type`, optionally only in some slots. */
export interface Form {
  string?: string;
  type?: string;
  /** The slots the form is read in (default: every slot). */
  at?: Slot[];
}

export interface MeaningForms {
  /** Forms the site's own value may take (for a site whose `now` is a player word). */
  site?: Form[];
  /** `players` values of a `forEachPlayer` that may enclose the site instead (the site moves under the iteration). */
  wrap?: string[];
  /** For a site whose `now` is `forEachPlayer`: the node must be a `forEachPlayer` with one of these `players` ... */
  iterator?: { players: string[]; except?: true };
  /** ... or, for `chosenOpponent`, no longer an iteration at all. */
  noIteration?: true;
}

const OPPONENT: Form = { string: "opponent" };
/** "each opponent": the effect happens once per opponent, or a selector / scope reads any opponent. In a condition it would mean "some opponent", and nowhere else is it read. */
const EACH_OPPONENTS: Form = { string: "opponents", at: ["effect", "selector", "scope"] };
/** "an opponent" over a set of cards or in a condition: any opponent. As an effect's `player` it would act on every opponent, so it is not accepted there. */
const ANY_OPPONENTS: Form = { string: "opponents", at: ["condition", "selector", "scope"] };
const CONTROLLER_OF: Form = { type: "controllerOf" };
const OWNER_OF: Form = { type: "ownerOf" };
const CHOSEN_PLAYER: Form = { type: "chosenPlayer" };
/** "that player" in an `opponentFrom: "acting"` block. A selector's `controller` / `owner` does not read it. */
const ACTING: Form = { string: "acting", at: ["chooser", "target", "effect", "condition", "scope"] };

/**
 * The meaning-to-data table, from docs/MULTIPLAYER-PLAN.md "Player vocabulary" and the spec README's `edit` table.
 * It judges only a site whose `now` is a player word (`opponent`, `self`, `controller`, ...) or `forEachPlayer`; a
 * site whose `now` is a flag, a restriction name, prose or `null` (a new shape) is done once it differs from its
 * recorded value. A meaning that is absent here is not constrained.
 */
export const MEANING_FORMS: Record<string, MeaningForms> = {
  /** "your opponent": `"opponent"` is the block's opponent (chosen, or derived from the event / battle / acting player); a player choice read back with `chosenPlayer` is the other accepted spelling. */
  chosenOpponent: { site: [OPPONENT, CHOSEN_PLAYER], noIteration: true },
  /** "an opponent": a pick-derived reference, a player choice read back with `chosenPlayer`, or `"opponents"` in a selector, scope or condition. */
  anyOneOpponent: { site: [ANY_OPPONENTS, CONTROLLER_OF, OWNER_OF, CHOSEN_PLAYER] },
  eachOpponent: { site: [EACH_OPPONENTS], wrap: ["opponents"], iterator: { players: ["opponents"] } },
  eachOtherPlayer: { wrap: ["others"], iterator: { players: ["others"] } },
  eachPlayer: { wrap: ["all"], iterator: { players: ["all"] } },
  /** "both players": a `pair` iteration (the acting player, else the controller, and the block's opponent). */
  chosenPair: { wrap: ["pair"], iterator: { players: ["pair"] } },
  selfAndEachOpponent: { wrap: ["selfAndOpponents"], iterator: { players: ["selfAndOpponents"] } },
  /** "that player": the same chosen player as the pick, the existing card-relative refs, or `"acting"` in an `opponentFrom: "acting"` block. */
  refersBack: { site: [CHOSEN_PLAYER, CONTROLLER_OF, OWNER_OF, ACTING] },
  /** "its controller" / "that faction's owner". */
  cardRelative: { site: [CONTROLLER_OF, OWNER_OF] },
  /** Gideon's Legacy (MPQ-P11): every player or every other player, except the picked player. */
  other: { iterator: { players: ["all", "others"], except: true } }
};

const formMatches = (form: Form, value: unknown, slot: Slot): boolean =>
  (form.at === undefined || form.at.includes(slot)) && (form.string !== undefined ? value === form.string : isObject(value) && value.type === form.type);
const formText = (form: Form): string =>
  `${form.string !== undefined ? JSON.stringify(form.string) : `{ type: "${form.type}" }`}${form.at ? ` (only as ${form.at.join(" / ")})` : ""}`;

const PLAYER_WORD_NOW: ReadonlySet<string> = new Set(["opponent", "self", "controller", "owner", "any", "all", "activePlayer", "anyPlayer"]);

/** The ability a path lies in (`behavior.abilities[2]`, `faction.abilities[0]`), or `undefined` for a path outside an ability. */
function abilityOf(card: unknown, path: string): Record<string, unknown> | undefined {
  const head = /^(?:behavior|faction)\.abilities\[\d+\]/.exec(path)?.[0];
  const hit = head ? resolvePath(card, head) : undefined;
  return hit?.found && isObject(hit.value) ? hit.value : undefined;
}

/** Whether a selector's `conditions` read the acting player: `controller: "any"` plus a `targetOwnedBy` / `targetControlledBy` of `"acting"`, the way a selector names "that player's" cards. */
function selectorNamesActing(card: unknown, path: string): boolean {
  const parent = resolvePath(card, path.replace(/\.(?:controller|owner)$/, ""));
  if (!parent.found || !isObject(parent.value)) return false;
  const holds = (node: unknown): boolean =>
    Array.isArray(node) ? node.some(holds) : isObject(node) && (((node.type === "targetOwnedBy" || node.type === "targetControlledBy") && node.player === "acting") || Object.values(node).some(holds));
  return holds(parent.value.conditions);
}

/** Every ancestor-or-self node of `path`, deepest first. */
function lineage(card: unknown, path: string): unknown[] {
  const steps = [...path.matchAll(SEGMENT)].map((match) => (match[2] !== undefined ? `[${match[2]}]` : `.${match[1]}`));
  const out: unknown[] = [];
  for (let n = steps.length; n >= 1; n--) {
    const prefix = steps.slice(0, n).join("").replace(/^\./, "");
    const hit = resolvePath(card, prefix);
    if (hit.found) out.push(hit.value);
  }
  return out;
}

type Live = { found: boolean; value?: unknown };

/** A player value that still reads as an opponent: the words and refs a site's meaning is judged by. */
function opponentish(value: unknown): boolean {
  if (typeof value === "string") return value === "opponent" || value === "opponents" || value === "acting";
  return isObject(value) && (value.type === "chosenPlayer" || value.type === "controllerOf" || value.type === "ownerOf");
}

/** Whether `value` (found at `path`) carries a `{ type: "chosenPlayer", id }` read-back anywhere inside it. */
function readsBack(value: unknown, id: string): boolean {
  if (Array.isArray(value)) return value.some((item) => readsBack(item, id));
  if (!isObject(value)) return false;
  return (value.type === "chosenPlayer" && value.id === id) || Object.values(value).some((child) => readsBack(child, id));
}

/**
 * A `playerChoices` entry as the site's value: the action names the player ("an opponent" nothing settles) and a
 * `chosenPlayer` ref reads it back. A cost step cannot ask a question, so a "pick an opponent" cost step is this entry.
 * `undefined` when it is a valid form for the meaning.
 */
function playerChoiceProblem(card: CardDefinition, site: Site, target: string, entry: unknown, forms: MeaningForms): string | undefined {
  if (!forms.site?.includes(CHOSEN_PLAYER)) return `${site.meaning} is not read through a playerChoices entry (chosenPlayer)`;
  if (!isObject(entry) || typeof entry.id !== "string" || (entry.from !== "opponents" && entry.from !== "players")) return `the playerChoices entry needs an id and from: "opponents" | "players"; it holds ${JSON.stringify(shallow(entry))}`;
  if (site.meaning !== "refersBack" && entry.from !== "opponents") return `${site.meaning} needs a player choice from: "opponents"; the entry holds from: ${JSON.stringify(entry.from)}`;
  const parentPath = target.replace(/\.playerChoices\[\d+\]$/, "");
  const parent = resolvePath(card, parentPath);
  return parent.found && readsBack(parent.value, entry.id) ? undefined : `no { type: "chosenPlayer", id: "${entry.id}" } reads the playerChoices entry back inside ${parentPath}`;
}

/**
 * A node that holds converted player references (an `otherPlayerChooses` cost whose `chooser` / selector children were
 * converted, a new step, a new ability): it needs a player field holding a valid form for the meaning, and none that
 * still holds the site's recorded word. `undefined` when it does.
 */
function convertedProblem(card: CardDefinition, site: Site, target: string, value: unknown, forms: MeaningForms): string | undefined {
  if (!forms.site) return `${site.meaning} is not read through player references`;
  const leaves: Array<{ path: string; value: unknown }> = [];
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) node.forEach((item, index) => walk(item, `${path}[${index}]`));
    else if (isObject(node))
      for (const [key, child] of Object.entries(node)) {
        if (PLAYER_FIELDS.has(key) && opponentish(child)) leaves.push({ path: `${path}.${key}`, value: child });
        else walk(child, `${path}.${key}`);
      }
  };
  walk(value, target);
  const accepted = (leaf: { path: string; value: unknown }): boolean =>
    forms.site!.some((form) => formMatches(form, leaf.value, slotOf(leaf.path)) && (form !== ACTING || abilityOf(card, leaf.path)?.opponentFrom === "acting"));
  const stale = leaves.filter((leaf) => typeof site.now === "string" && leaf.value === site.now && !accepted(leaf));
  if (stale.length) return `${stale.map((leaf) => leaf.path).join(", ")} still hold ${JSON.stringify(site.now)}`;
  return leaves.some(accepted) ? undefined : `the node holds no player reference that is a valid form for ${site.meaning} (${forms.site.map(formText).join(" | ")})`;
}

/** The iteration forms of a meaning: a `forEachPlayer` with the right `players` (and `except`), or, for a single opponent, no iteration at all. */
function iteratorProblem(site: Site, forms: MeaningForms, live: Live, holds: string): string | undefined {
  const value = live.value;
  const iterating = isObject(value) && value.type === "forEachPlayer";
  if (forms.noIteration && site.now === "forEachPlayer") return iterating ? `${site.meaning} must no longer iterate over players; the site is still a forEachPlayer` : undefined;
  if (!forms.iterator) return undefined;
  const need = forms.iterator;
  const ok = iterating && need.players.includes((value as Record<string, unknown>).players as string) && (!need.except || "except" in (value as object));
  return ok ? undefined : `${site.meaning} must be forEachPlayer { players: ${need.players.map((players) => `"${players}"`).join(" | ")}${need.except ? ", except: PlayerRef" : ""} }; the site holds ${holds}`;
}

/** Whether a site's `now` is one the gate judges: a player word, `forEachPlayer`, or `null` (a new node). */
const isJudged = (now: unknown): boolean => now === null || now === "forEachPlayer" || (typeof now === "string" && PLAYER_WORD_NOW.has(now));

/**
 * Why `live` (the value at `target`: the site's `movedTo`, else its `path`) is not a valid form for `site`, or
 * `undefined` when it is (or the site is not judged).
 */
function invalidReason(card: CardDefinition, site: Site, target: string, live: Live): string | undefined {
  // The ability-level `opponentFrom` of a block written from another player's point of view (MPQ-P10).
  if (/\.opponentFrom$/.test(target)) return live.found && live.value === "acting" ? undefined : `opponentFrom must be "acting" (text from another player's point of view, MPQ-P10); the site holds ${live.found ? JSON.stringify(live.value) : "nothing"}`;
  const forms = MEANING_FORMS[site.meaning];
  if (!forms || !isJudged(site.now)) return undefined;
  const holds = live.found ? JSON.stringify(shallow(live.value)) : "(nothing: the path no longer exists)";
  // A site that was an iteration, or a new node whose meaning is an iteration.
  let iteration: string | undefined;
  if (site.now === "forEachPlayer" || (site.now === null && forms.iterator)) {
    iteration = iteratorProblem(site, forms, live, holds);
    if (iteration === undefined) return undefined;
    if (site.now === "forEachPlayer") return iteration;
  }
  // A player word, or a new node whose meaning is read through a player reference.
  const slot = slotOf(target);
  const matched = live.found ? forms.site?.find((form) => formMatches(form, live.value, slot)) : undefined;
  if (matched === ACTING) {
    return abilityOf(card, target)?.opponentFrom === "acting" ? undefined : `${site.meaning} reads "acting", which needs opponentFrom: "acting" on the ability the site is in`;
  }
  if (matched) return undefined;
  if (forms.wrap && lineage(card, target).some((node) => isObject(node) && node.type === "forEachPlayer" && forms.wrap!.includes(node.players as string))) return undefined;
  // A selector cannot read "acting": it names the acting player's cards through a condition instead.
  if (site.meaning === "refersBack" && slot === "selector" && live.found && live.value === "any" && selectorNamesActing(card, target) && abilityOf(card, target)?.opponentFrom === "acting") return undefined;
  // A moved site or a new node may be a player choice, or a node whose child references were converted.
  let moveNote = "";
  if ((site.movedTo !== undefined || site.now === null) && live.found) {
    const entry = /\.playerChoices\[\d+\]$/.test(target);
    const problem = entry ? playerChoiceProblem(card, site, target, live.value, forms) : isObject(live.value) || Array.isArray(live.value) ? convertedProblem(card, site, target, live.value, forms) : "the value is not a node";
    if (problem === undefined) return undefined;
    moveNote = ` (${entry ? "as a playerChoices entry" : "as a converted node"}: ${problem})`;
  }
  const expected = [...(forms.site ?? []).map(formText), ...(forms.wrap ?? []).map((players) => `inside forEachPlayer { players: "${players}" }`)];
  const extra = site.meaning === "refersBack" && slot === "selector" ? ` (a selector's controller / owner cannot read "acting": use "any" with a targetOwnedBy { player: "acting" } condition in an opponentFrom "acting" ability)` : "";
  if (!expected.length) return iteration;
  return `${iteration ? `${iteration}; or ` : `${site.meaning} must become `}${expected.join(" | ")}${extra}; the site holds ${holds} (read as ${slot})${moveNote}`;
}

// --- The work queue --------------------------------------------------------------------------

export interface WorkEntry {
  card: string;
  /** The rules group's representative printing. */
  id: string;
  clause: string;
  path: string;
  /** Present when the site's data edit moved it (the spec's `movedTo`). */
  movedTo?: string;
  now: unknown;
  /** The target meaning (`mp-spec/README.md`, "Meanings"). */
  meaning: string;
}
export interface SetWork {
  sites: number;
  clauses: number;
  pending: WorkEntry[];
}
export interface Worklist {
  total: { sites: number; clauses: number };
  sets: Record<string, SetWork>;
}

export interface Findings {
  worklist: Worklist;
  /** `edit: true` sites that changed to something that is not a valid target form, or whose `movedTo` / `now` cannot be read. */
  invalid: string[];
  /** `edit: false` sites that no longer hold their `now` (at `movedTo`, when set). */
  moved: string[];
  /** Spec entries that name a group or card that does not exist. */
  unknown: string[];
}

export function readWorklist(): Worklist | undefined {
  return existsSync(WORKLIST_FILE) ? (JSON.parse(readFileSync(WORKLIST_FILE, "utf8")) as Worklist) : undefined;
}

export function renderWorklist(worklist: Worklist): string {
  return JSON.stringify(worklist, null, 2) + "\n";
}

/**
 * Judge every spec site against the card data. The verdict depends on the spec and the data alone (nothing is
 * remembered between runs), so regenerating the worklist is idempotent.
 *
 * For each site, `target` is its `movedTo` when set (the original `path` may be gone or hold something else), else its `path`.
 * - `edit: false`: the value at `target` is still the recorded `now`.
 * - `edit: true`, `now: null` (a new node): done once `target` holds a valid form for the meaning, pending until then.
 * - `edit: true`, `now` a player word or `forEachPlayer`, with `movedTo`: never pending, judged at `target`.
 * - `edit: true`, any other `now`: pending while the value at `target` is still `now`; once it left, judged.
 */
export function evaluate(sites: Site[], catalog: CardDefinition[] = CATALOG): Findings {
  const byId = new Map(catalog.map((card) => [card.id, card]));
  const sets: Record<string, SetWork> = {};
  const invalid: string[] = [];
  const moved: string[] = [];
  const unknown: string[] = [];
  // A site listed with `edit: true` on one clause is carried as an `edit: false` copy on the clauses that share its path; the owner's entry judges it.
  const owned = new Set(sites.filter((site) => site.edit).map((site) => `${site.id}|${site.path}`));
  for (const site of sites) {
    const set = (sets[site.set] ??= { sites: 0, clauses: 0, pending: [] });
    const card = byId.get(site.id);
    if (!card) {
      unknown.push(`${site.card} (${site.id}): no such printing`);
      continue;
    }
    if (!site.edit && owned.has(`${site.id}|${site.path}`)) continue;
    const target = site.movedTo ?? site.path;
    const live = resolvePath(card, target);
    const where = site.movedTo === undefined ? "" : ` (moved to ${site.movedTo})`;
    if (site.movedTo !== undefined && !live.found) {
      (site.edit ? invalid : moved).push(`${describeSite(site)}: movedTo ${site.movedTo} does not exist in the card; point movedTo at where the site is now, or remove it`);
      continue;
    }
    if (!site.edit) {
      const primitive = isRecordedValue(site.now) && live.found && (live.value === null || typeof live.value !== "object");
      const holds = primitive ? primitiveIs(live.value, site.now) : live.found && (deepEqual(live.value, site.now) || wordOf(live.value) === site.now);
      if (!holds) moved.push(`${describeSite(site)}: edit false, recorded ${JSON.stringify(site.now)}, now ${live.found ? JSON.stringify(shallow(live.value)) : "missing"}${where}`);
      continue;
    }
    // edit: true
    if (site.now !== null && !isRecordedValue(site.now)) {
      invalid.push(`${describeSite(site)}: now must be the stored value at the path (a word, flag, number, node JSON or list), or null for a node that does not exist yet; it holds ${JSON.stringify(site.now)}`);
      continue;
    }
    let pending: boolean;
    let reason: string | undefined;
    if (site.now === null) {
      reason = live.found ? invalidReason(card, site, target, live) : undefined;
      pending = !live.found || reason !== undefined;
    } else {
      pending = !(site.movedTo !== undefined && isJudged(site.now)) && stillNow(live, site.now);
      if (!pending) reason = invalidReason(card, site, target, live);
    }
    if (pending) {
      set.pending.push({ card: site.card, id: site.id, clause: site.clause, path: site.path, ...(site.movedTo !== undefined ? { movedTo: site.movedTo } : {}), now: site.now, meaning: site.meaning });
      continue;
    }
    if (reason) invalid.push(`${describeSite(site)}: ${reason}${where}`);
  }
  let totalSites = 0;
  let totalClauses = 0;
  for (const set of Object.values(sets)) {
    set.sites = set.pending.length;
    set.clauses = new Set(set.pending.map((entry) => `${entry.id}|${entry.clause}`)).size;
    totalSites += set.sites;
    totalClauses += set.clauses;
  }
  return { worklist: { total: { sites: totalSites, clauses: totalClauses }, sets }, invalid, moved, unknown };
}

// --- Spec vs data -------------------------------------------------------------------------------

/**
 * Every relevant site in the inventory (a behavior word other than plain self / controller / owner / card-relative
 * refs) that the spec's `dataChanges` for its clause does not list; plus spec entries naming a group or clause the
 * inventory does not have. An entry lists a word by its `path`, by its `movedTo`, or, when `movedTo` names a node
 * (a converted child, a new step), by any path inside that node. A new node is listed by its real path.
 */
export function specGaps(inventory: MpGroup[], sites: Site[]): string[] {
  const listed = new Map<string, { exact: Set<string>; inside: string[] }>();
  for (const site of sites) {
    const entry = listed.get(`${site.id}|${site.clause}`) ?? { exact: new Set<string>(), inside: [] };
    entry.exact.add(site.path);
    if (site.movedTo !== undefined) {
      entry.exact.add(site.movedTo);
      entry.inside.push(site.movedTo);
    }
    listed.set(`${site.id}|${site.clause}`, entry);
  }
  const covered = (id: string, clause: string, path: string): boolean => {
    const entry = listed.get(`${id}|${clause}`);
    return entry !== undefined && (entry.exact.has(path) || entry.inside.some((node) => path.startsWith(`${node}.`) || path.startsWith(`${node}[`)));
  };
  const out: string[] = [];
  for (const group of inventory)
    for (const clause of group.clauses)
      for (const word of clause.behavior)
        if (!PLAIN_WORDS.has(word.value) && !covered(group.id, clause.key, word.path)) out.push(`${group.name} ${clause.key} ${word.path} (${word.value}): no spec dataChanges entry`);
  const clauses = new Set(inventory.flatMap((group) => group.clauses.map((clause) => `${group.id}|${clause.key}`)));
  for (const site of sites) if (!clauses.has(`${site.id}|${site.clause}`)) out.push(`${site.card} ${site.clause}: the spec names a clause the inventory does not have`);
  return out;
}
