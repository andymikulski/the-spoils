// Heuristic converter from a card's archival " -- "-separated `text` to
// structured markup (src/cardText.ts), plus ability-ref linking and the
// round-trip check every generated or hand-written markup must pass.
// Migration tooling — see CARD-MARKUP-PROGRESS.md.

import type { CardDefinition, ResourceIcon } from "../../src/types/index.js";
import {
  CARD_TEXT_KEYWORDS,
  cardTextToPlain,
  normalizeCardTextForComparison,
  parseCardText,
  serializeCardText,
  type CardTextAbilityPart,
  type CardTextBlock,
  type CardTextInline
} from "../../src/cardText.js";

export interface ConvertContext {
  cardNames: Set<string>;
  /** An unquoted card name after "named " ("a card named Deception"), longest name first. */
  namedCardPattern: RegExp;
  /** Lowercased subtypes across the catalog. */
  subtypes: Set<string>;
}

export interface CardConversion {
  markup: string;
  /** Things a reviewer should look at; the markup is still valid. */
  flags: string[];
  /** The markup is wrong (doesn't parse, or doesn't round-trip to `text`). */
  errors: string[];
}

export function buildContext(cards: CardDefinition[]): ConvertContext {
  const subtypes = new Set<string>();
  for (const card of cards) for (const subtype of card.subtype) subtypes.add(subtype.toLowerCase());
  const cardNames = new Set(cards.map((card) => card.name));
  const alternatives = [...cardNames]
    .sort((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return { cardNames, namedCardPattern: new RegExp(`(?<=(?<!\\p{L})named )(?:${alternatives.join("|")})(?!\\p{L})`, "gu"), subtypes };
}

// -----------------------------------------------------------------------------
// Inline content
// -----------------------------------------------------------------------------

const ICON_RUN = "(?:\\[[RGDEOV]\\])+";
const CAPS_WORD = "[\\p{Lu}0-9]+(?:['’\\-][\\p{Lu}0-9]+)*";
/** Case-insensitive: the few lowercase uses ("this card gains tactical") are all keyword grants. */
const KEYWORD_PATTERN = new RegExp(`(?<!\\p{L})(${CARD_TEXT_KEYWORDS.join("|")})(?!\\p{L})`, "giu");
const UNIQUE_REF_PATTERN = new RegExp(`(?<!\\p{L})UNIQUE ((?:${CAPS_WORD})(?: ${CAPS_WORD})*)(?!\\p{Ll})`, "gu");
const ATTACH_REF_PATTERN = /(?<!\p{L})ATTACH TO (\p{Lu}+(?: \p{Lu}+)*)(?!\p{Ll})/gu;
const RULES_TERMS = [
  "FLIP UP",
  "FLIP IT",
  "RESTORE RULE",
  "Restore Rule",
  "DEVELOP RULE",
  "Develop Rule",
  "STARTING DRAW",
  "STARTING RESOURCES",
  "EXTRA COST",
  "PROVIDES",
  "UNIQUE"
];
const TERM_PATTERN = new RegExp(`(?<!\\p{L})(${RULES_TERMS.join("|")})(?!\\p{L})`, "gu");
/** An unquoted lowercase subtype naming a kind of card: "a gear card", "node characters", "the majig subtype". */
const SUBTYPE_MENTION_PATTERN =
  /(?<![\p{L}'"])(\p{Ll}[\p{Ll}\-]*)( (?:cards?|characters?|items?|locations?|tokens?|subtype)(?!\p{L}))/gu;
const LEFTOVER_CAPS = /(?<!\p{L})\p{Lu}{2,}(?:[ \-']\p{Lu}{2,})*(?!\p{Ll})/gu;

type Transform = (match: RegExpMatchArray) => CardTextInline[] | null;

/** Applies `pattern` to every plain-text node, replacing matches `transform` accepts. */
function transformText(nodes: CardTextInline[], pattern: RegExp, transform: Transform): CardTextInline[] {
  const out: CardTextInline[] = [];
  for (const node of nodes) {
    if (node.type !== "text") {
      out.push(node);
      continue;
    }
    let last = 0;
    for (const match of node.text.matchAll(pattern)) {
      const replacement = transform(match);
      if (!replacement) continue;
      const at = match.index ?? 0;
      if (at > last) out.push({ type: "text", text: node.text.slice(last, at) });
      out.push(...replacement);
      last = at + match[0].length;
    }
    if (last < node.text.length) out.push({ type: "text", text: node.text.slice(last) });
  }
  return mergeText(out);
}

function mergeText(nodes: CardTextInline[]): CardTextInline[] {
  const out: CardTextInline[] = [];
  for (const node of nodes) {
    const prev = out[out.length - 1];
    if (node.type === "text" && prev?.type === "text") out[out.length - 1] = { type: "text", text: prev.text + node.text };
    else if (node.type !== "text" || node.text) out.push(node);
  }
  return out;
}

type LeafType = "unique" | "attach" | "keyword" | "term" | "cardName" | "subtype";

const leaf = (type: LeafType, text: string): CardTextInline => ({ type, text });
const quoted = (quote: string, type: LeafType, text: string): CardTextInline[] => [
  { type: "text", text: quote },
  leaf(type, text),
  { type: "text", text: quote }
];

function convertInline(text: string, ctx: ConvertContext, flags: string[], allowReminder = true): CardTextInline[] {
  let nodes: CardTextInline[] = [{ type: "text", text }];
  if (allowReminder) {
    nodes = transformText(nodes, /\(([^()]*)\)/g, (match) =>
      /\p{Ll}{2,}/u.test(match[1]) ? [{ type: "reminder", children: convertInline(match[1], ctx, flags, false) }] : null
    );
  }
  nodes = transformText(nodes, /"([^"]+)"/g, (match) => {
    if (ctx.cardNames.has(match[1])) return quoted('"', "cardName", match[1]);
    if (ctx.subtypes.has(match[1].toLowerCase())) return quoted('"', "subtype", match[1]);
    return null;
  });
  nodes = transformText(nodes, ctx.namedCardPattern, (match) => [leaf("cardName", match[0])]);
  nodes = transformText(nodes, /(?<!\p{L})'(\p{Ll}[\p{Ll} \-]*?)'(?!\p{L})/gu, (match) =>
    ctx.subtypes.has(match[1].toLowerCase()) ? quoted("'", "subtype", match[1]) : null
  );
  nodes = transformText(nodes, SUBTYPE_MENTION_PATTERN, (match) =>
    ctx.subtypes.has(match[1]) ? [leaf("subtype", match[1]), { type: "text", text: match[2] }] : null
  );
  nodes = transformText(nodes, UNIQUE_REF_PATTERN, (match) => [leaf("unique", match[1])]);
  nodes = transformText(nodes, ATTACH_REF_PATTERN, (match) => [leaf("attach", match[1])]);
  nodes = transformText(nodes, KEYWORD_PATTERN, (match) => [leaf("keyword", match[1])]);
  nodes = transformText(nodes, TERM_PATTERN, (match) => [leaf("term", match[1])]);
  for (const node of nodes) {
    if (node.type !== "text") continue;
    for (const match of node.text.matchAll(LEFTOVER_CAPS)) flags.push(`unmarked caps "${match[0]}"`);
  }
  return nodes;
}

// -----------------------------------------------------------------------------
// Segments -> blocks
// -----------------------------------------------------------------------------

const NAME_CHARS = "[\\p{Lu}0-9 '’,&!?.$\\-]";
/** "MAKE VANISH", "HELPING PAW: [D]", "\"ENHANCE\"" — a whole segment naming the ability that follows. */
const HEADER = new RegExp(`^("?\\p{Lu}${NAME_CHARS}*?"?|\\$+${NAME_CHARS}*?)(?::\\s*(${ICON_RUN}))?$`, "u");
const PART_LABEL = /^(COST|EXTRA COST|EFFECT):\s*/;
const OPTION_LABEL = /^(OPTION \d+|(?:AT LEAST )?\d+ TOKENS?)(?::\s*(.+))?$/;
const NAMED_RULE = new RegExp(`^("?\\p{Lu}${NAME_CHARS}*?"?):\\s+(.*)$`, "u");
const ICON_GATE = new RegExp(`^(${ICON_RUN}):\\s*(.*)$`);
const SECTION_BLOCKS: Array<[RegExp, "extraCost" | "effect" | "flipUp" | "provides" | "fealty"]> = [
  [/^EXTRA COST:\s*/, "extraCost"],
  [/^EFFECT:\s*/, "effect"],
  [/^FLIP UP:\s*/, "flipUp"],
  [/^PROVIDES:\s*/, "provides"],
  [/^FEALTY:\s*/, "fealty"]
];

const ICON_BY_TOKEN: Record<string, ResourceIcon> = {
  R: "rage",
  G: "greed",
  D: "deception",
  E: "elitism",
  O: "obsession",
  V: "volition"
};

function iconsOf(run: string): ResourceIcon[] {
  return [...run.matchAll(/\[([RGDEOV])\]/g)].map((match) => ICON_BY_TOKEN[match[1]]);
}

const hasLowercase = (text: string) => /\p{Ll}/u.test(text);
const quoteCount = (text: string) => (text.match(/"/g) ?? []).length;

/** A whole segment that's only keywords / Unique designations / Attach-to restrictions (plus an optional reminder). */
function keywordLine(segment: string, ctx: ConvertContext, flags: string[]): CardTextInline[] | null {
  const reminderMatch = segment.match(/^(.*?)\s*(\([^()]*\))$/);
  const head = reminderMatch ? reminderMatch[1] : segment;
  if (!head) return null;
  const nodes: CardTextInline[] = [];
  for (const [i, item] of head.split(", ").entries()) {
    if (i > 0) nodes.push({ type: "text", text: ", " });
    if (CARD_TEXT_KEYWORDS.includes(item)) nodes.push({ type: "keyword", text: item });
    else if (/^UNIQUE [^\p{Ll},()"]+$/u.test(item)) nodes.push({ type: "unique", text: item.slice("UNIQUE ".length) });
    else if (/^ATTACH TO \p{Lu}+(?: \p{Lu}+)*$/u.test(item)) nodes.push({ type: "attach", text: item.slice("ATTACH TO ".length) });
    else return null;
  }
  if (reminderMatch) nodes.push({ type: "text", text: " " }, ...convertInline(reminderMatch[2], ctx, flags));
  return nodes;
}

/** Card-level segments that end an option's body rather than belonging to it. */
function endsOption(segment: string, ctx: ConvertContext): boolean {
  return OPTION_LABEL.test(segment) || /^(FLIP UP|PROVIDES|FEALTY):/.test(segment) || keywordLine(segment, ctx, []) !== null;
}

/**
 * Quoted rules text that spans " -- " separators ("...gains the following
 * rules text: “A -- B”") is cut out as one grant item; everything else
 * stays one segment per item.
 */
type Item = { kind: "segment"; text: string } | { kind: "grant"; text: string };

function itemize(segments: string[], flags: string[]): Item[] {
  const items: Item[] = [];
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (quoteCount(segment) % 2 === 0) {
      items.push({ kind: "segment", text: segment });
      continue;
    }
    let end = i + 1;
    while (end < segments.length && quoteCount(segments[end]) % 2 === 0) end++;
    if (end === segments.length) {
      flags.push(`unbalanced quote in "${segment}"`);
      items.push({ kind: "segment", text: segment });
      continue;
    }
    const open = segment.lastIndexOf('"');
    const close = segments[end].indexOf('"');
    const intro = segment.slice(0, open).trim();
    const trailing = segments[end].slice(close + 1).trim();
    if (trailing) {
      flags.push(`text after a quoted grant: "${trailing}"`);
      items.push({ kind: "segment", text: segment });
      continue;
    }
    if (intro) items.push({ kind: "segment", text: intro });
    const inner = [segment.slice(open + 1), ...segments.slice(i + 1, end), segments[end].slice(0, close)];
    items.push({ kind: "grant", text: inner.map((part) => part.trim()).join(" -- ") });
    i = end;
  }
  return items;
}

export function convertText(text: string, ctx: ConvertContext): { blocks: CardTextBlock[]; flags: string[] } {
  const flags: string[] = [];
  const blocks = convertItems(itemize(text.split(" -- ").map((segment) => segment.trim()), flags), ctx, flags, true);
  return { blocks, flags };
}

function convertItems(items: Item[], ctx: ConvertContext, flags: string[], topLevel: boolean): CardTextBlock[] {
  const blocks: CardTextBlock[] = [];
  const inline = (segment: string) => convertInline(segment, ctx, flags);
  const segmentAt = (index: number) => (items[index]?.kind === "segment" ? items[index].text : undefined);

  const takeParts = (start: number): { parts: CardTextAbilityPart[]; next: number } => {
    const parts: CardTextAbilityPart[] = [];
    let i = start;
    for (let segment = segmentAt(i); segment !== undefined; segment = segmentAt(i)) {
      const label = segment.match(PART_LABEL);
      if (!label) break;
      const type = label[1] === "COST" ? "cost" : label[1] === "EFFECT" ? "effect" : "extraCost";
      if (parts.length && parts[parts.length - 1].type === "effect" && type !== "effect") break;
      parts.push({ type, children: inline(segment.slice(label[0].length)) });
      i++;
    }
    return { parts, next: i };
  };

  for (let i = 0; i < items.length; ) {
    const item = items[i];
    if (item.kind === "grant") {
      if (!topLevel) flags.push("quoted grant nested in an option");
      blocks.push({ type: "grant", blocks: convertItems(itemize(item.text.split(" -- "), flags), ctx, flags, false) });
      i++;
      continue;
    }
    const segment = item.text;
    const next = segmentAt(i + 1);

    const keywords = keywordLine(segment, ctx, flags);
    if (keywords) {
      blocks.push({ type: "keywords", children: keywords });
      i++;
      continue;
    }

    const option = segment.match(OPTION_LABEL);
    if (option) {
      if (option[2] !== undefined) {
        blocks.push({ type: "option", label: option[1], blocks: convertItems([{ kind: "segment", text: option[2] }], ctx, flags, false) });
        i++;
        continue;
      }
      let end = i + 1;
      while (end < items.length && !(items[end].kind === "segment" && endsOption(items[end].text, ctx))) end++;
      if (end === i + 1) {
        flags.push(`option "${option[1]}" has no body`);
        blocks.push({ type: "rule", children: inline(segment) });
        i++;
        continue;
      }
      if (end - i > 2 && (end === items.length || !OPTION_LABEL.test(items[end].text))) {
        flags.push(`last option "${option[1]}" body spans ${end - i - 1} segments — check where it ends`);
      }
      blocks.push({ type: "option", label: option[1], blocks: convertItems(items.slice(i + 1, end), ctx, flags, false) });
      i = end;
      continue;
    }

    const section = SECTION_BLOCKS.find(([pattern]) => pattern.test(segment));
    if (section) {
      const [pattern, type] = section;
      blocks.push({ type, children: inline(segment.replace(pattern, "")) });
      i++;
      continue;
    }

    if (/^COST:/.test(segment)) {
      const { parts, next: after } = takeParts(i);
      blocks.push({ type: "ability", parts });
      i = after;
      continue;
    }

    const header = segment.match(HEADER);
    if (header && next !== undefined && PART_LABEL.test(next)) {
      const { parts, next: after } = takeParts(i + 1);
      blocks.push({
        type: "ability",
        name: header[1],
        ...(header[2] && { threshold: iconsOf(header[2]) }),
        parts
      });
      i = after;
      continue;
    }

    const gate = segment.match(ICON_GATE);
    if (gate) {
      blocks.push({ type: "rule", when: iconsOf(gate[1]), children: inline(gate[2]) });
      i++;
      continue;
    }

    const named = segment.match(NAMED_RULE);
    if (named && !hasLowercase(named[1]) && named[1].replace(/"/g, "").length > 1) {
      blocks.push({ type: "rule", name: named[1], children: inline(named[2]) });
      i++;
      continue;
    }

    if (header && !header[2] && next !== undefined && hasLowercase(next) && !PART_LABEL.test(next)) {
      flags.push(`standalone header "${header[1]}" merged with the paragraph after it`);
      blocks.push({ type: "rule", name: header[1], children: inline(next) });
      i += 2;
      continue;
    }

    if (!hasLowercase(segment)) flags.push(`unclassified caps line "${segment}"`);
    blocks.push({ type: "rule", children: inline(segment) });
    i++;
  }

  return blocks;
}

// -----------------------------------------------------------------------------
// Ability-ref linking
// -----------------------------------------------------------------------------

const nameKey = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]/g, "");

type AbilityBlock = Extract<CardTextBlock, { type: "ability" }>;
type RefBlock = Extract<CardTextBlock, { type: "ability" | "rule" }>;

/** Blocks this card's own refs can sit on — everything except the contents of a `<grant>`. */
function ownBlocks(blocks: CardTextBlock[]): RefBlock[] {
  return blocks.flatMap((block): RefBlock[] => {
    if (block.type === "option") return ownBlocks(block.blocks);
    if (block.type === "ability" || block.type === "rule") return [block];
    return [];
  });
}

/**
 * Points each `<ability>` block at the card's matching activated ability:
 * by name, then by an id containing the name ("RECUR" -> `recur`), then —
 * when the leftover counts line up — by position. A tactic's first
 * activated ability is its own play ability (the EXTRA COST + effect), so
 * it's never a candidate. Refs already present (hand-written overrides) are
 * kept when they resolve on this card. Abilities inside a `<grant>` belong
 * to the recipients and are never linked.
 */
export function linkAbilityRefs(blocks: CardTextBlock[], card: CardDefinition, flags: string[]): void {
  const abilities = card.behavior?.abilities ?? [];
  const ids = new Set(abilities.map((ability) => ability.id));
  const activated = abilities.filter((ability) => ability.type === "activated");
  const pool = card.type === "tactic" ? activated.slice(1) : activated;
  const own = ownBlocks(blocks);
  const abilityBlocks = own.filter((block): block is AbilityBlock => block.type === "ability");

  const used = new Set<string>();
  for (const block of own) {
    if (block.ref === undefined) continue;
    if (ids.has(block.ref)) used.add(block.ref);
    else {
      flags.push(`ref "${block.ref}" is not an ability on this card; relinking`);
      delete block.ref;
    }
  }

  const matchers: Array<(block: AbilityBlock, ability: (typeof pool)[number]) => boolean> = [
    (block, ability) => !!ability.name && nameKey(ability.name) === nameKey(block.name!),
    (block, ability) => nameKey(ability.id).includes(nameKey(block.name!))
  ];
  for (const matches of matchers) {
    for (const block of abilityBlocks) {
      if (block.ref !== undefined || !block.name || !nameKey(block.name)) continue;
      const match = pool.find((ability) => !used.has(ability.id) && matches(block, ability));
      if (match) {
        block.ref = match.id;
        used.add(match.id);
      }
    }
  }

  const unlinked = abilityBlocks.filter((block) => block.ref === undefined);
  const leftover = pool.filter((ability) => !used.has(ability.id));
  if (!unlinked.length) return;
  if (unlinked.length === leftover.length) {
    unlinked.forEach((block, index) => {
      block.ref = leftover[index].id;
      flags.push(`positional link ${block.name ?? "(unnamed)"} -> ${leftover[index].id}`);
    });
    return;
  }
  for (const block of unlinked) flags.push(`unlinked ability "${block.name ?? "(unnamed)"}"`);
  if (leftover.length) flags.push(`unmatched activated abilities: ${leftover.map((ability) => ability.id).join(", ")}`);
}

// -----------------------------------------------------------------------------
// Whole-card conversion + verification
// -----------------------------------------------------------------------------

/** Errors for markup that doesn't parse or doesn't round-trip to the card's `text`. */
export function verifyMarkup(markup: string, card: CardDefinition): string[] {
  let blocks: CardTextBlock[];
  try {
    blocks = parseCardText(markup);
  } catch (error) {
    return [`parse error: ${(error as Error).message}`];
  }
  const errors: string[] = [];
  const expected = normalizeCardTextForComparison(card.text);
  const actual = normalizeCardTextForComparison(cardTextToPlain(blocks));
  if (actual !== expected) {
    let at = 0;
    while (at < expected.length && expected[at] === actual[at]) at++;
    errors.push(
      `round-trip mismatch at ${at}: text "…${expected.slice(Math.max(0, at - 20), at + 30)}…" vs markup "…${actual.slice(Math.max(0, at - 20), at + 30)}…"`
    );
  }
  const ids = new Set((card.behavior?.abilities ?? []).map((ability) => ability.id));
  for (const block of ownBlocks(blocks)) {
    if (block.ref !== undefined && !ids.has(block.ref)) errors.push(`ref "${block.ref}" is not an ability on this card`);
  }
  return errors;
}

/**
 * Markup for one card: the hand-written `override` when there is one,
 * otherwise the heuristic conversion of `text`; refs linked for this exact
 * printing either way. `null` for cards with no rules text.
 */
export function convertCard(card: CardDefinition, ctx: ConvertContext, override?: string): CardConversion | null {
  if (!card.text.trim()) return null;
  const flags: string[] = [];
  let blocks: CardTextBlock[];
  if (override !== undefined) {
    try {
      blocks = parseCardText(override);
    } catch (error) {
      return { markup: override, flags, errors: [`override parse error: ${(error as Error).message}`] };
    }
  } else {
    const converted = convertText(card.text, ctx);
    blocks = converted.blocks;
    flags.push(...converted.flags);
  }
  linkAbilityRefs(blocks, card, flags);
  const markup = serializeCardText(blocks);
  return { markup, flags, errors: verifyMarkup(markup, card) };
}
