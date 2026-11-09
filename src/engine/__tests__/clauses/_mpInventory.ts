// The multiplayer inventory (docs/TESTING.md, "Multiplayer inventory"): for every
// rules group and clause of the clause manifest (`_manifest.ts`), every printed
// player phrase and every player word in the clause's behavior data.
//
// Printed phrases are read from the same printed text the manifest splits into
// clauses (`markup`, itself generated from data/card-audit/corrections.json where
// a printing's wording differs), so each clause's text here is byte-identical to
// `Clause.text` in data/card-tests/clauses.json. Behavior player words are read
// from the group's representative printing.
//
// Shared by `npm run card-tests -- mp-inventory` (writes
// data/card-tests/mp-inventory.{json,md}) and the currency gate
// (`__tests__/mp-inventory.test.ts`), so the file and the gate can never drift.

import { cardTextToPlain, parseCardText, type CardTextBlock, type CardTextInline } from "../../../cardText.js";
import type { CardDefinition } from "../../../engine.js";
import { buildRulesGroups, CATALOG, RELEASE_ORDER, type Clause, type RulesGroup } from "./_manifest.js";

// --- Printed phrases ---------------------------------------------------------

export const PHRASE_CATEGORIES = [
  "yourOpponent",
  "bothPlayers",
  "anOpponent",
  "opponentBare",
  "eachOpponent",
  "eachPlayer",
  "anyPlayer",
  "anotherPlayer",
  "activePlayer",
  "seat",
  // Categories beyond the requested set, found in the catalog:
  "anyOpponent",
  "thatOpponent",
  "theirOpponent",
  "eachOtherPlayer",
  "eachOfYou",
  "thatPlayer",
  "xPlayers",
  "eitherDeck",
  "playersBare",
  "playerOther"
] as const;
export type PhraseCategory = (typeof PHRASE_CATEGORIES)[number];

/** Categories that quantify over several players: a clause containing one gets `mp: "quantified"`. */
export const QUANTIFIED_CATEGORIES: readonly PhraseCategory[] = ["eachOpponent", "eachPlayer", "eachOtherPlayer", "eachOfYou"];

const POSS = "(?:'s|')?";
const NUM = "(?:'s)?";

/**
 * The matcher: case-insensitive, curly apostrophes folded to `'`. Patterns run
 * in this order and a later pattern never claims text an earlier one matched, so
 * the most specific reading wins ("each of your opponents" is one `eachOpponent`
 * occurrence, not `eachOpponent` + `playersBare`). Whatever player / opponent word
 * no specific pattern claims lands in the fallbacks `opponentBare`, `playersBare`
 * and `playerOther`, so nothing player-quantifying is silently missed.
 */
const PATTERNS: Array<[PhraseCategory, RegExp]> = [
  ["seat", /\bseats?\b|\bto\s+the\s+(?:left|right)\s+of\s+(?:you|your|a\s+player|that\s+player|each\s+player|the\s+active\s+player)\b/gi],
  // Plural opponents ("your opponents", "all opponents", "each of your opponents", "opponents you have", "each opponents'").
  ["eachOpponent", /\b(?:(?:each|every|all)\s+(?:of\s+)?)?(?:your\s+|the\s+|their\s+)?opponents\b'?/gi],
  ["eachOpponent", new RegExp(`\\b(?:each|every)\\s+opponent${NUM}\\b`, "gi")],
  ["yourOpponent", new RegExp(`\\byour\\s+opponent${NUM}\\b`, "gi")],
  ["anOpponent", new RegExp(`\\ban\\s+opponent${NUM}\\b`, "gi")],
  ["anyOpponent", new RegExp(`\\bany\\s+opponent${NUM}\\b`, "gi")],
  ["thatOpponent", new RegExp(`\\b(?:that|those)\\s+opponent${NUM}\\b`, "gi")],
  ["theirOpponent", new RegExp(`\\btheir\\s+opponent${NUM}\\b`, "gi")],
  ["opponentBare", new RegExp(`\\bopponent${NUM}\\b`, "gi")],
  ["bothPlayers", new RegExp(`\\bboth\\s+players?\\b${POSS}`, "gi")],
  ["eachOtherPlayer", new RegExp(`\\b(?:each|every|all)\\s+other\\s+players?\\b${POSS}`, "gi")],
  ["eachPlayer", new RegExp(`\\b(?:each|all|every)\\s+(?:of\\s+the\\s+)?players?\\b${POSS}`, "gi")],
  ["anyPlayer", new RegExp(`\\b(?:any\\s+players?|a\\s+player)\\b${POSS}`, "gi")],
  ["anotherPlayer", new RegExp(`\\b(?:another\\s+player|(?:the\\s+)?other\\s+players?)\\b${POSS}`, "gi")],
  ["activePlayer", new RegExp(`\\b(?:the\\s+)?active\\s+player\\b${POSS}`, "gi")],
  ["thatPlayer", new RegExp(`\\b(?:that|those|the|picked|chosen|whichever)\\s+players?\\b${POSS}`, "gi")],
  ["xPlayers", /\bx\s+players\b/gi],
  ["eachOfYou", /\beach\s+of\s+you\b/gi],
  ["eitherDeck", /\beither\s+deck\b/gi],
  ["playersBare", new RegExp(`\\bplayers\\b${POSS}`, "gi")],
  ["playerOther", new RegExp(`\\bplayer\\b${POSS}`, "gi")]
];

export interface MpPhrase {
  /** The matched text, as printed. */
  text: string;
  category: PhraseCategory;
  /** Character offset of the match in the clause's text (`Clause.text`). */
  at: number;
  /** Present (true) when the phrase is inside reminder parentheses. */
  reminder?: true;
}

/** Every player phrase in `text`, in reading order; `reminders` are the `[start, end)` offsets of reminder parentheses. */
export function findPhrases(text: string, reminders: Array<[number, number]> = []): MpPhrase[] {
  const folded = text.replace(/[‘’]/g, "'");
  const taken: Array<[number, number]> = [];
  const found: MpPhrase[] = [];
  for (const [category, pattern] of PATTERNS) {
    for (const match of folded.matchAll(pattern)) {
      const start = match.index!;
      const end = start + match[0].length;
      if (taken.some(([s, e]) => start < e && s < end)) continue;
      taken.push([start, end]);
      const phrase: MpPhrase = { text: text.slice(start, end), category, at: start };
      if (reminders.some(([s, e]) => start >= s && end <= e)) phrase.reminder = true;
      found.push(phrase);
    }
  }
  return found.sort((a, b) => a.at - b.at);
}

// --- Clause text with reminder spans ------------------------------------------

interface Built {
  text: string;
  reminders: Array<[number, number]>;
}

/** The plain-text label a block / ability part prints before its content ("EFFECT: ", "FLIP UP: ", ...). */
const blockLabel = (type: Exclude<CardTextBlock, { type: "ability" | "rule" | "option" | "grant" }>["type"]): string =>
  cardTextToPlain([{ type, children: [] }]);
const partLabel = (type: "cost" | "extraCost" | "effect"): string => cardTextToPlain([{ type: "ability", parts: [{ type, children: [] }] }]);

function appendInline(out: Built, nodes: CardTextInline[]): void {
  for (const node of nodes) {
    if (node.type === "reminder") {
      const start = out.text.length;
      out.text += "(";
      appendInline(out, node.children);
      out.text += ")";
      out.reminders.push([start, out.text.length]);
    } else {
      out.text += cardTextToPlain([{ type: "keywords", children: [node] }]).replace(/^/, "");
    }
  }
}

/** Mirrors `cardTextToPlain` for one block, additionally recording reminder spans. */
function buildBlock(block: CardTextBlock): Built {
  const out: Built = { text: "", reminders: [] };
  const join = (pieces: Array<() => void>, separator: string) => {
    pieces.forEach((piece, index) => {
      if (index > 0) out.text += separator;
      piece();
    });
  };
  const nested = (blocks: CardTextBlock[]) =>
    join(
      blocks.map((inner) => () => {
        const built = buildBlock(inner);
        const offset = out.text.length;
        out.text += built.text;
        for (const [s, e] of built.reminders) out.reminders.push([s + offset, e + offset]);
      }),
      " -- "
    );
  switch (block.type) {
    case "ability": {
      const header = cardTextToPlain([{ type: "ability", name: block.name, threshold: block.threshold, parts: [] }]);
      const pieces: Array<() => void> = [];
      if (header) pieces.push(() => (out.text += header));
      for (const part of block.parts)
        pieces.push(() => {
          out.text += partLabel(part.type);
          appendInline(out, part.children);
        });
      join(pieces, " -- ");
      break;
    }
    case "rule": {
      const label = cardTextToPlain([{ type: "rule", name: block.name, when: block.when, children: [] }]);
      if (label) out.text += label;
      appendInline(out, block.children);
      break;
    }
    case "option":
      out.text += `${block.label} -- `;
      nested(block.blocks);
      break;
    case "grant":
      out.text += '"';
      nested(block.blocks);
      out.text += '"';
      break;
    default:
      out.text += blockLabel(block.type);
      appendInline(out, block.children);
  }
  return out;
}

// --- Behavior player words -----------------------------------------------------

/**
 * Fields of the behavior vocabulary (src/types/{cards,effects,costs,conditions,expressions}.ts)
 * whose value is a player relationship: a `PlayerRef` (or `"self" | "opponent" | "any"` /
 * `"controller" | "anyPlayer" | "opponent"` / `"opponent" | "any" | "activePlayer"`) naming who
 * acts, chooses, is affected, or whose cards a selector matches.
 */
export const PLAYER_FIELDS: ReadonlySet<string> = new Set([
  "player", // effects, costs, conditions, expressions, continuous modifiers' `player`
  "toPlayer",
  "controller", // CardSelector.controller; createTokens / PlayerRef-typed `controller`
  "owner", // CardSelector.owner
  "controlledBy", // CardSelector-like / conditions / installReplacement
  "by", // installReplacement `by`, replacement filters, conditions `by`
  "nameNotControlledBy",
  "chooser",
  "picker",
  "splitter",
  "who",
  "of",
  "affects",
  "viewer",
  "revealFor",
  "target", // `PlayerRef` only in the effect that targets a player; TargetRef strings never collide with the player words
  "first", // alternatingPay(Loop)
  "opponent", // alternatingPay(Loop)
  "toFaction",
  "usableBy",
  "attachToController",
  "noResponse", // behavior.noResponse: "opponent" (only the selected opponent cannot respond)
  "attacker" // preventsAttackOnFaction.attacker: "opponent" (only the selected opponent cannot attack)
]);

/** The player words a string value can take in a player-valued field. */
export const PLAYER_WORDS: ReadonlySet<string> = new Set(["opponent", "self", "any", "controller", "owner", "activePlayer", "anyPlayer", "all"]);

/** PlayerRef objects: `{ type: "ownerOf" | "controllerOf" | "player", ... }`. */
export const PLAYER_REF_TYPES: ReadonlySet<string> = new Set(["ownerOf", "controllerOf", "player"]);

/** Effects / costs whose very shape iterates or alternates over players, with no player-valued field of their own. */
export const PLAYER_ITERATING_TYPES: ReadonlySet<string> = new Set([
  "forEachPlayer",
  "anyPlayerMayPay",
  "alternatingPay",
  "otherPlayerChooses",
  "auctionForCard",
  "partitionAndPick",
  "separateIntoPiles",
  "useAnyAbility"
]);

/** Iteration over players: a clause with one of these is already per-player in the data. */
const ITERATION_TYPES: ReadonlySet<string> = new Set(["forEachPlayer", "anyPlayerMayPay", "alternatingPay", "auctionForCard"]);

/** Fields never read by the engine. */
const NON_BEHAVIOR_FIELDS = new Set(["id", "set", "rarity", "subtitle", "flavorText", "art", "text", "markup"]);

export type WordLink =
  /** The ability the clause's `ref` names. */
  | "ref"
  /** The card's `flipUp` data, on the FLIP UP clause. */
  | "flipUp"
  /** The card's `thresholdSlack`, on the FEALTY clause. */
  | "fealty"
  /** Unlinked data and the group has exactly one clause it could belong to. */
  | "exclusive"
  /** Unlinked data (an ability with no `ref`, `onPlay`, `modes`, ...) listed on every clause it could belong to: see `sharedWith`. */
  | "shared";

export interface MpWord {
  /** JSON path from the card (`behavior.abilities[2].effects[0].player`). A PlayerRef object / iterating effect is the path of the object itself. */
  path: string;
  /** The word (`"opponent"`, `"self"`, ...), the PlayerRef `type` (`"controllerOf"`), or the iterating effect `type` (`"forEachPlayer"`). */
  value: string;
  /** The behavior unit it sits in: `ability:<id>`, `behavior.onPlay`, `flipUp`, `faction.<field>`, ... */
  unit: string;
  link: WordLink;
  /** `shared` words: how many clauses list this occurrence. */
  sharedWith?: number;
}

interface RawWord {
  path: string;
  value: string;
}

function collectWords(value: unknown, path: string, out: RawWord[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectWords(item, `${path}[${index}]`, out));
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const type = record.type;
  if (typeof type === "string" && (PLAYER_REF_TYPES.has(type) || PLAYER_ITERATING_TYPES.has(type))) out.push({ path, value: type });
  for (const [key, child] of Object.entries(record)) {
    const childPath = path ? `${path}.${key}` : key;
    if (typeof child === "string" && PLAYER_FIELDS.has(key) && PLAYER_WORDS.has(child)) out.push({ path: childPath, value: child });
    else collectWords(child, childPath, out);
  }
}

interface Unit {
  name: string;
  words: RawWord[];
}

/** The card's behavior data, one unit per ability and per other behavior field. */
function unitsOf(card: CardDefinition): Unit[] {
  const units: Unit[] = [];
  const add = (name: string, value: unknown, path: string) => {
    const words: RawWord[] = [];
    collectWords(value, path, words);
    units.push({ name, words });
  };
  const record = card as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (NON_BEHAVIOR_FIELDS.has(key)) continue;
    const top = record[key];
    if ((key === "behavior" || key === "faction") && top && typeof top === "object") {
      for (const [field, child] of Object.entries(top as Record<string, unknown>)) {
        if (field === "abilities" && Array.isArray(child)) {
          child.forEach((ability, index) => add(`ability:${(ability as { id: string }).id}`, ability, `${key}.abilities[${index}]`));
        } else add(`${key}.${field}`, child, `${key}.${field}`);
      }
    } else add(key, top, key);
  }
  return units.filter((unit) => unit.words.length > 0 || unit.name.startsWith("ability:"));
}

// --- Clause <-> behavior mapping -----------------------------------------------

function refsOf(block: CardTextBlock): string[] {
  switch (block.type) {
    case "ability":
    case "rule":
      return block.ref ? [block.ref] : [];
    case "option":
    case "grant":
      return block.blocks.flatMap(refsOf);
    default:
      return [];
  }
}

/** clause-key path prefix (`2`, `3.1`) -> the ability refs printed on that block. */
function refsByPath(markup: string | undefined): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!markup) return out;
  parseCardText(markup).forEach((block, index) => {
    if (block.type === "grant") block.blocks.forEach((inner, innerIndex) => out.set(`${index}.${innerIndex}`, refsOf(inner)));
    else out.set(String(index), refsOf(block));
  });
  return out;
}

const keywordish = (kind: string): boolean => /(^|-)(keyword|unique|attach)$/.test(kind);

export interface MpClause {
  /** The clause manifest's key (`data/card-tests/clauses.json`). */
  key: string;
  /** `"quantified"`: a printed each / all-players / each-opponent phrase. `true`: any printed phrase or behavior word. */
  mp: boolean | "quantified";
  phrases: MpPhrase[];
  behavior: MpWord[];
}

export interface MpGroup {
  /** The rules group's representative printing — joins with `clauses.json`. */
  id: string;
  name: string;
  printings: string[];
  batch: string;
  clauses: MpClause[];
}

function inventoryGroup(group: RulesGroup, card: CardDefinition): MpGroup {
  const refs = refsByPath(card.markup);
  const units = unitsOf(card);
  const abilityIds = new Set(units.filter((unit) => unit.name.startsWith("ability:")).map((unit) => unit.name.slice(8)));
  const built = new Map<string, Built>();
  if (card.markup) {
    parseCardText(card.markup).forEach((block, index) => {
      if (block.type === "grant") block.blocks.forEach((inner, innerIndex) => built.set(`${index}.${innerIndex}`, buildBlock(inner)));
      else built.set(String(index), buildBlock(block));
    });
  }
  const pathOf = (clause: Clause) => clause.key.slice(0, clause.key.indexOf(":")) ;
  const refsFor = (clause: Clause) => (refs.get(pathOf(clause)) ?? []).filter((ref) => abilityIds.has(ref));

  const words = new Map<string, MpWord[]>(group.clauses.map((clause) => [clause.key, []]));
  const push = (key: string, unit: Unit, link: WordLink, sharedWith?: number) => {
    for (const word of unit.words) words.get(key)!.push({ path: word.path, value: word.value, unit: unit.name, link, ...(sharedWith ? { sharedWith } : {}) });
  };

  // Eligible homes for data no clause names: everything except keyword-style lines, ref-linked clauses, FLIP UP and FEALTY.
  let eligible = group.clauses.filter((clause) => !keywordish(clause.kind) && !refsFor(clause).length && clause.kind !== "flipUp" && clause.kind !== "fealty");
  if (!eligible.length) eligible = group.clauses.filter((clause) => !keywordish(clause.kind));
  if (!eligible.length) eligible = group.clauses;

  for (const unit of units) {
    if (!unit.words.length) continue;
    const id = unit.name.startsWith("ability:") ? unit.name.slice(8) : undefined;
    const byRef = id ? group.clauses.filter((clause) => refsFor(clause).includes(id)) : [];
    if (byRef.length) {
      for (const clause of byRef) push(clause.key, unit, "ref");
    } else if (unit.name === "flipUp" && group.clauses.some((clause) => clause.kind === "flipUp")) {
      for (const clause of group.clauses.filter((c) => c.kind === "flipUp")) push(clause.key, unit, "flipUp");
    } else if (unit.name === "thresholdSlack" && group.clauses.some((clause) => clause.kind === "fealty")) {
      for (const clause of group.clauses.filter((c) => c.kind === "fealty")) push(clause.key, unit, "fealty");
    } else if (eligible.length === 1) {
      push(eligible[0]!.key, unit, "exclusive");
    } else {
      for (const clause of eligible) push(clause.key, unit, "shared", eligible.length);
    }
  }

  const clauses: MpClause[] = group.clauses.map((clause) => {
    const text = built.get(pathOf(clause));
    // A clause's own text: the manifest's `clause.text` is the source of truth; `built` only locates reminders.
    const phrases = clause.key === "vanilla" || keywordish(clause.kind) ? [] : findPhrases(clause.text, remindersWithin(clause, text));
    const behavior = words.get(clause.key)!;
    const quantified = phrases.some((phrase) => QUANTIFIED_CATEGORIES.includes(phrase.category));
    return { key: clause.key, mp: quantified ? "quantified" : phrases.length > 0 || behavior.length > 0, phrases, behavior };
  });
  return { id: group.id, name: group.name, printings: group.printings, batch: group.batch, clauses };
}

/** The reminder spans of `clause.text`, located inside its block's built text (the clause text is that block's text). */
function remindersWithin(clause: Clause, built: Built | undefined): Array<[number, number]> {
  return built && built.text === clause.text ? built.reminders : [];
}

/** The whole inventory, one entry per rules group in `clauses.json` order. Deterministic for a given catalog. */
export function buildMpInventory(catalog: CardDefinition[] = CATALOG, groups: RulesGroup[] = buildRulesGroups(catalog)): MpGroup[] {
  const byId = new Map(catalog.map((card) => [card.id, card]));
  return groups.map((group) => inventoryGroup(group, byId.get(group.id)!));
}

/** The text each clause is scanned in, per group — equal to `Clause.text`; exported so the gate can prove it. */
export function clauseTextCheck(groups: RulesGroup[], catalog: CardDefinition[] = CATALOG): string[] {
  const byId = new Map(catalog.map((card) => [card.id, card]));
  const bad: string[] = [];
  for (const group of groups) {
    const card = byId.get(group.id)!;
    if (!card.markup) continue;
    const blocks = parseCardText(card.markup);
    blocks.forEach((block, index) => {
      const inner: Array<[string, CardTextBlock]> = block.type === "grant" ? block.blocks.map((b, i) => [`${index}.${i}`, b]) : [[String(index), block]];
      for (const [path, target] of inner) {
        if (target.type === "keywords") continue;
        const text = buildBlock(target).text;
        const clause = group.clauses.find((c) => c.key.startsWith(`${path}:`));
        if (clause && clause.text !== text) bad.push(`${group.name} ${clause.key}`);
      }
    });
  }
  return bad;
}

// --- Summary ---------------------------------------------------------------------

type Scope = { group: MpGroup; clauses: MpClause[]; phrases: MpPhrase[]; words: MpWord[] };

/** The units a mismatch is judged over: each clause alone, except clauses sharing unlinked data are judged together. */
function scopesOf(group: MpGroup): Scope[] {
  const pooled = new Set<string>();
  const sharedKeys = group.clauses.filter((clause) => clause.behavior.some((word) => word.link === "shared")).map((clause) => clause.key);
  for (const key of sharedKeys) pooled.add(key);
  const scopes: Scope[] = [];
  for (const clause of group.clauses) {
    if (pooled.has(clause.key)) continue;
    scopes.push({ group, clauses: [clause], phrases: clause.phrases, words: clause.behavior });
  }
  if (sharedKeys.length) {
    const clauses = group.clauses.filter((clause) => pooled.has(clause.key));
    const seen = new Set<string>();
    const words: MpWord[] = [];
    for (const clause of clauses)
      for (const word of clause.behavior) {
        const id = word.path;
        if (word.link === "shared" && seen.has(id)) continue;
        seen.add(id);
        words.push(word);
      }
    scopes.push({ group, clauses, phrases: clauses.flatMap((clause) => clause.phrases), words });
  }
  return scopes;
}

export interface Mismatch {
  kind: string;
  group: string;
  name: string;
  clauses: string[];
  detail: string;
}

const OPPONENT_PHRASES: readonly PhraseCategory[] = ["yourOpponent", "anOpponent", "anyOpponent", "thatOpponent", "theirOpponent", "opponentBare"];
/** Categories that name more than one player. */
const MULTI_PHRASES: readonly PhraseCategory[] = ["eachOpponent", "eachPlayer", "eachOtherPlayer", "eachOfYou", "bothPlayers", "playersBare", "xPlayers"];
const NON_DEFAULT_WORDS = new Set(["opponent", "any", "anyPlayer", "activePlayer", ...PLAYER_ITERATING_TYPES]);

export function mismatchesOf(inventory: MpGroup[]): Mismatch[] {
  const out: Mismatch[] = [];
  for (const group of inventory) {
    for (const scope of scopesOf(group)) {
      const printed = scope.phrases.filter((phrase) => !phrase.reminder);
      const categories = new Set(printed.map((phrase) => phrase.category));
      const values = new Set(scope.words.map((word) => word.value));
      const keys = scope.clauses.map((clause) => clause.key);
      const add = (kind: string, detail: string) => out.push({ kind, group: group.id, name: group.name, clauses: keys, detail });
      const iterating = [...values].some((value) => ITERATION_TYPES.has(value));
      for (const category of MULTI_PHRASES) {
        if (!categories.has(category) || iterating) continue;
        const texts = [...new Set(printed.filter((phrase) => phrase.category === category).map((phrase) => phrase.text))].join(" / ");
        add(`${category}-no-iteration`, `printed "${texts}"; data has ${values.size ? [...values].map((value) => `"${value}"`).join(", ") : "no player words"} and no forEachPlayer / alternating iteration`);
      }
      for (const category of OPPONENT_PHRASES) {
        if (categories.has(category) && values.has("opponent")) add(`${category}-vs-opponent`, `printed ${category}; data "opponent" (expected in two-player)`);
      }
      if (printed.length && !values.size) {
        add("printed-no-data-word", `printed ${[...categories].join(", ")}; no player word in the behavior data`);
      }
      const nonDefault = [...values].filter((value) => NON_DEFAULT_WORDS.has(value));
      if (!printed.length && nonDefault.length) {
        add("data-word-no-printed-phrase", `data ${nonDefault.map((value) => `"${value}"`).join(", ")}; no printed player phrase`);
      }
    }
  }
  return out;
}

const EXPECTED_KINDS = (kind: string) => kind.endsWith("-vs-opponent");

function table(rows: string[][], header: string[]): string[] {
  return [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...rows.map((row) => `| ${row.join(" | ")} |`)];
}

const homeSet = (group: MpGroup, catalog: Map<string, CardDefinition>): string => catalog.get(group.id)!.set;

/** `data/card-tests/mp-inventory.md`. */
export function renderMpSummary(inventory: MpGroup[], catalog: CardDefinition[] = CATALOG): string {
  const byId = new Map(catalog.map((card) => [card.id, card]));
  const lines: string[] = [
    "# Multiplayer inventory",
    "",
    "**Generated by `npm run card-tests -- mp-inventory` — do not hand-edit.** How it is built: docs/TESTING.md (Multiplayer inventory).",
    "",
    "Counts are per rules group (printings identical in everything the engine reads count once), attributed to the",
    "group's earliest-released set. \"Distinct cards\" counts distinct card names. Phrases include reminder text unless noted.",
    ""
  ];

  const clauses = inventory.flatMap((group) => group.clauses.map((clause) => ({ group, clause })));
  const total = (pred: (c: MpClause) => boolean) => clauses.filter(({ clause }) => pred(clause)).length;
  lines.push(
    `${inventory.length} rules groups, ${clauses.length} clauses: ${total((c) => c.mp !== false)} with \`mp\` set (${total((c) => c.mp === "quantified")} \`"quantified"\`), ` +
      `${total((c) => c.phrases.length > 0)} with a printed player phrase, ${total((c) => c.behavior.length > 0)} with a behavior player word ` +
      `(${total((c) => c.behavior.some((word) => NON_DEFAULT_WORDS.has(word.value)))} with a word other than controller, self, owner, all or a PlayerRef).`,
    ""
  );

  // Printed phrases by category.
  lines.push("## Printed phrases by category", "");
  const phraseRows: string[][] = [];
  for (const category of PHRASE_CATEGORIES) {
    const hits = inventory.flatMap((group) => group.clauses.flatMap((clause) => clause.phrases.filter((p) => p.category === category).map((p) => ({ group, p }))));
    const names = new Set(hits.map(({ group }) => group.name));
    const reminders = hits.filter(({ p }) => p.reminder).length;
    const examples = [...new Set(hits.map(({ p }) => p.text.toLowerCase()))].sort().slice(0, 4).map((text) => `\`${text}\``).join(", ");
    phraseRows.push([category, String(hits.length), String(reminders), String(names.size), examples]);
  }
  lines.push(...table(phraseRows, ["category", "occurrences", "in reminder", "distinct cards", "forms"]), "");

  // Behavior words.
  lines.push("## Behavior player words", "");
  const wordMap = new Map<string, { n: number; names: Set<string> }>();
  for (const group of inventory) {
    const seen = new Set<string>();
    for (const clause of group.clauses)
      for (const word of clause.behavior) {
        if (seen.has(word.path)) continue; // a shared word is listed on several clauses
        seen.add(word.path);
        const entry = wordMap.get(word.value) ?? { n: 0, names: new Set() };
        entry.n++;
        entry.names.add(group.name);
        wordMap.set(word.value, entry);
      }
  }
  lines.push(
    ...table(
      [...wordMap.entries()].sort((a, b) => b[1].n - a[1].n).map(([value, entry]) => [`\`${value}\``, String(entry.n), String(entry.names.size)]),
      ["value", "occurrences", "distinct cards"]
    ),
    ""
  );
  const linkCounts = new Map<WordLink, number>();
  for (const group of inventory) {
    const seen = new Set<string>();
    for (const clause of group.clauses)
      for (const word of clause.behavior) {
        if (seen.has(word.path)) continue;
        seen.add(word.path);
        linkCounts.set(word.link, (linkCounts.get(word.link) ?? 0) + 1);
      }
  }
  lines.push(
    "Mapping of behavior words to clauses: " +
      (["ref", "flipUp", "fealty", "exclusive", "shared"] as WordLink[]).map((link) => `${link} ${linkCounts.get(link) ?? 0}`).join(", ") +
      ".",
    ""
  );

  // Per set.
  lines.push("## Per set (rules groups by earliest set)", "");
  const sets = [...RELEASE_ORDER, ...new Set(inventory.map((g) => homeSet(g, byId)).filter((s) => !(RELEASE_ORDER as readonly string[]).includes(s)))];
  const setRows: string[][] = [];
  for (const set of sets) {
    const groups = inventory.filter((group) => homeSet(group, byId) === set);
    if (!groups.length) continue;
    const phrases = groups.flatMap((group) => group.clauses.flatMap((clause) => clause.phrases));
    const words = groups.reduce((sum, group) => sum + new Set(group.clauses.flatMap((clause) => clause.behavior.map((word) => word.path))).size, 0);
    const mpNames = new Set(groups.filter((group) => group.clauses.some((clause) => clause.mp !== false)).map((group) => group.name));
    const quantNames = new Set(groups.filter((group) => group.clauses.some((clause) => clause.mp === "quantified")).map((group) => group.name));
    setRows.push([set, String(groups.length), String(phrases.length), String(words), String(mpNames.size), String(quantNames.size)]);
  }
  lines.push(...table(setRows, ["set", "rules groups", "printed phrases", "behavior words", "cards with mp", "cards quantified"]), "");

  // Per set x category.
  lines.push("### Printed phrases per set and category", "");
  const used = PHRASE_CATEGORIES.filter((category) => inventory.some((group) => group.clauses.some((clause) => clause.phrases.some((p) => p.category === category))));
  const matrix: string[][] = [];
  for (const set of sets) {
    const groups = inventory.filter((group) => homeSet(group, byId) === set);
    if (!groups.length) continue;
    matrix.push([set, ...used.map((category) => String(groups.reduce((sum, group) => sum + group.clauses.reduce((s, clause) => s + clause.phrases.filter((p) => p.category === category).length, 0), 0)))]);
  }
  lines.push(...table(matrix, ["set", ...used]), "");

  // Preliminary mismatches.
  const mismatches = mismatchesOf(inventory);
  const kinds = new Map<string, Mismatch[]>();
  for (const mismatch of mismatches) kinds.set(mismatch.kind, [...(kinds.get(mismatch.kind) ?? []), mismatch]);
  lines.push(
    "## Preliminary mismatch list",
    "",
    "Input for later work, not a gate. A clause is judged against its own behavior data; clauses that share unlinked data",
    "(an ability with no `ref`, `onPlay`, `modes`, ...) are judged together as one pool. Printed phrases inside reminders are ignored here.",
    ""
  );
  const kindOrder = (kind: string) => (EXPECTED_KINDS(kind) ? 2 : kind.endsWith("-no-iteration") ? 0 : 1);
  const sortedKinds = [...kinds.keys()].sort((a, b) => kindOrder(a) - kindOrder(b) || a.localeCompare(b));
  lines.push(
    ...table(
      sortedKinds.map((kind) => [`\`${kind}\``, EXPECTED_KINDS(kind) ? "expected in two-player (count only)" : "", String(kinds.get(kind)!.length), String(new Set(kinds.get(kind)!.map((m) => m.name)).size)]),
      ["kind", "note", "clauses / pools", "distinct cards"]
    ),
    ""
  );
  for (const kind of sortedKinds) {
    if (EXPECTED_KINDS(kind)) continue;
    const list = kinds.get(kind)!;
    lines.push(`### \`${kind}\` (${list.length})`, "");
    for (const mismatch of list) lines.push(`- ${mismatch.name} (\`${mismatch.group}\`) ${mismatch.clauses.map((key) => `\`${key}\``).join(", ")} — ${mismatch.detail}`);
    lines.push("");
  }

  // Bare opponents for a human to classify.
  lines.push("## `opponentBare` occurrences", "");
  let bare = 0;
  for (const group of inventory)
    for (const clause of group.clauses)
      for (const phrase of clause.phrases.filter((p) => p.category === "opponentBare")) {
        bare++;
        const text = clauses.find((c) => c.clause === clause)!.group.name;
        lines.push(`- ${text} (\`${group.id}\`) \`${clause.key}\`: "${phrase.text}"${phrase.reminder ? " (reminder)" : ""}`);
      }
  if (!bare) lines.push("(none)");
  lines.push("");
  return lines.join("\n");
}
