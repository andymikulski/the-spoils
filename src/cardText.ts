/* cardText.ts
 *
 * The package's "./card-text" export: the structured rules-text markup
 * carried on `CardDefinition.markup`, its parsed tree, and the plain-text
 * projection back to printed text. A card's `text` stays the printed
 * original (archival, never rewritten from markup); `markup` labels what
 * each piece of that text *is* — a keyword line, a named ability and its
 * COST/EFFECT, reminder text, an inline keyword reference — so a renderer
 * can style and place the pieces instead of re-deriving them from the
 * " -- " separator convention. Separate from ./engine.ts because the rules
 * engine reads `markup` only for the `textMentionsIcon` condition (`text` only as its fallback for a definition without markup), and from ./data.ts so a renderer can parse
 * markup without pulling in the card catalog.
 *
 * Markup is a small, closed XML-like vocabulary (docs/CARD-DATA.md
 * has the full reference):
 *
 *   <keywords><kw>TACTICAL</kw>, <unique>IOHANE</unique></keywords>
 *   <rule when="oooo"><kw>COVERT</kw></rule>
 *   <extra-cost>Pick a character.</extra-cost>
 *   <ability name="MAKE VANISH" threshold="e" ref="make-vanish">
 *     <cost>Deplete this card. Pay 5.</cost><effect>Put that character into the void.</effect>
 *   </ability>
 *   <option label="OPTION 2"><extra-cost>Pick a character.</extra-cost><rule>...</rule></option>
 *
 * Only `<name attr="value">` / `</name>` are syntax: there are no entities,
 * comments or self-closing tags, and text may contain any character except
 * `<`. Attribute values are double-quoted, or single-quoted when the value
 * itself contains `"` (`name='"ENHANCE"'`). Printed labels ("COST:",
 * "UNIQUE ", "ATTACH TO ", reminder parentheses, a grant's quotes) are
 * implied by the tag and re-added by `cardTextToPlain`. Resource icons stay
 * as their printed `[R]`/`[G]`/... tokens in text and parse to `icon` nodes.
 */

import type { ResourceIcon } from "./types/cards.js";

export type CardTextInline =
  | { type: "text"; text: string }
  | { type: "icon"; icon: ResourceIcon }
  /** `<kw>` — a keyword (COVERT, TACTICAL, AGGRO), as a keyword line entry or mentioned in a sentence. */
  | { type: "keyword"; text: string }
  /** `<unique>` — a Unique designation ("PLUCK" for "UNIQUE PLUCK"), printed with the "UNIQUE " prefix. */
  | { type: "unique"; text: string }
  /** `<attach>` — an "Attach to" restriction ("CHARACTER" for "ATTACH TO CHARACTER"). */
  | { type: "attach"; text: string }
  /** `<term>` — an all-caps rules term mentioned in a sentence (FLIP UP, RESTORE RULE, PROVIDES, ...). */
  | { type: "term"; text: string }
  /** `<card>` — a card named in the text ("named “Uhluhtc Niudla”"); surrounding quotes stay plain text. */
  | { type: "cardName"; text: string }
  /** `<subtype>` — a subtype named in the text ("'majig' characters"); surrounding quotes stay plain text. */
  | { type: "subtype"; text: string }
  /** `<reminder>` — parenthetical reminder/aside text, printed inside "(" ")". */
  | { type: "reminder"; children: CardTextInline[] };

export interface CardTextAbilityPart {
  /** `<cost>` ("COST: "), `<extra-cost>` ("EXTRA COST: ") or `<effect>` ("EFFECT: "). */
  type: "cost" | "extraCost" | "effect";
  children: CardTextInline[];
}

export type CardTextBlock =
  /** `<keywords>` — a keyword-style line: keywords, Unique designations, "Attach to" restrictions. */
  | { type: "keywords"; children: CardTextInline[] }
  /**
   * `<rule>` — a rules paragraph. `name` is a printed label ("STARTING DRAW",
   * printed "STARTING DRAW: ..."); `when` an icon gate ("[O][O][O][O]: ...");
   * `ref` the `AbilityDefinition.id` (on the same card) it describes.
   */
  | { type: "rule"; name?: string; when?: ResourceIcon[]; ref?: string; children: CardTextInline[] }
  /** `<extra-cost>` — a card's EXTRA COST (a tactic's, or a permanent's on-play cost). */
  | { type: "extraCost"; children: CardTextInline[] }
  /**
   * `<ability>` — a printed named/costed ability: header (`name`, optional
   * per-ability `threshold`) plus its COST / EXTRA COST / EFFECT parts. `ref`
   * is the `AbilityDefinition.id` (on the same card) it describes.
   */
  | { type: "ability"; name?: string; threshold?: ResourceIcon[]; ref?: string; parts: CardTextAbilityPart[] }
  /** `<effect>` — a card-level "EFFECT: ..." (a tactic's effect printed with its label). */
  | { type: "effect"; children: CardTextInline[] }
  /** `<option>` — one branch of a modal choice ("OPTION 1", "2 TOKENS"), holding that branch's blocks. */
  | { type: "option"; label: string; blocks: CardTextBlock[] }
  /**
   * `<grant>` — quoted rules text this card gives to other cards ("The
   * attached character gains the following rules text: “...”"), printed
   * inside quotes. Its abilities belong to the recipients, not this card.
   */
  | { type: "grant"; blocks: CardTextBlock[] }
  /** `<flip-up>` — "FLIP UP: <cost>". */
  | { type: "flipUp"; children: CardTextInline[] }
  /** `<provides>` — "PROVIDES: <icons>". */
  | { type: "provides"; children: CardTextInline[] }
  /** `<fealty>` — "FEALTY: ...". */
  | { type: "fealty"; children: CardTextInline[] };

/** Keywords `<kw>` may contain (compared case-insensitively). */
export const CARD_TEXT_KEYWORDS: readonly string[] = ["COVERT", "TACTICAL", "AGGRO"];

export class CardTextParseError extends Error {
  constructor(
    message: string,
    /** Character offset into the markup string. */
    readonly offset: number
  ) {
    super(`${message} (at offset ${offset})`);
    this.name = "CardTextParseError";
  }
}

const ICON_BY_LETTER: Record<string, ResourceIcon> = {
  r: "rage",
  g: "greed",
  d: "deception",
  e: "elitism",
  o: "obsession",
  v: "volition"
};

const LETTER_BY_ICON: Record<ResourceIcon, string> = {
  rage: "r",
  greed: "g",
  deception: "d",
  elitism: "e",
  obsession: "o",
  volition: "v"
};

const ICON_TOKEN = /\[([RGDEOV])\]/g;

type LeafInlineType = "keyword" | "unique" | "attach" | "term" | "cardName" | "subtype";

const LEAF_INLINE_TAGS: Record<string, LeafInlineType> = {
  kw: "keyword",
  unique: "unique",
  attach: "attach",
  term: "term",
  card: "cardName",
  subtype: "subtype"
};

const TAG_BY_LEAF_TYPE: Record<LeafInlineType, string> = {
  keyword: "kw",
  unique: "unique",
  attach: "attach",
  term: "term",
  cardName: "card",
  subtype: "subtype"
};

const PLAIN_PREFIX_BY_LEAF_TYPE: Partial<Record<LeafInlineType, string>> = {
  unique: "UNIQUE ",
  attach: "ATTACH TO "
};

type InlineBlockType = "keywords" | "extraCost" | "effect" | "flipUp" | "provides" | "fealty";

const INLINE_BLOCK_TAGS: Record<string, InlineBlockType> = {
  keywords: "keywords",
  "extra-cost": "extraCost",
  effect: "effect",
  "flip-up": "flipUp",
  provides: "provides",
  fealty: "fealty"
};

const TAG_BY_INLINE_BLOCK_TYPE: Record<InlineBlockType, string> = {
  keywords: "keywords",
  extraCost: "extra-cost",
  effect: "effect",
  flipUp: "flip-up",
  provides: "provides",
  fealty: "fealty"
};

const PLAIN_LABEL_BY_INLINE_BLOCK_TYPE: Record<InlineBlockType, string> = {
  keywords: "",
  extraCost: "EXTRA COST: ",
  effect: "EFFECT: ",
  flipUp: "FLIP UP: ",
  provides: "PROVIDES: ",
  fealty: "FEALTY: "
};

const ABILITY_PART_TAGS: Record<string, CardTextAbilityPart["type"]> = {
  cost: "cost",
  "extra-cost": "extraCost",
  effect: "effect"
};

const TAG_BY_ABILITY_PART: Record<CardTextAbilityPart["type"], string> = {
  cost: "cost",
  extraCost: "extra-cost",
  effect: "effect"
};

const PLAIN_LABEL_BY_ABILITY_PART: Record<CardTextAbilityPart["type"], string> = {
  cost: "COST: ",
  extraCost: "EXTRA COST: ",
  effect: "EFFECT: "
};

const ALLOWED_ATTRIBUTES: Record<string, readonly string[]> = {
  rule: ["name", "when", "ref"],
  ability: ["name", "threshold", "ref"],
  option: ["label"]
};

// -----------------------------------------------------------------------------
// Tokenizer
// -----------------------------------------------------------------------------

/** Every match of global `pattern` in `text` (`String#matchAll` is past this package's ES2019 lib). */
function execAll(pattern: RegExp, text: string): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  for (let match = global.exec(text); match; match = global.exec(text)) matches.push(match);
  return matches;
}

type Token =
  | { kind: "open"; name: string; attrs: Record<string, string>; offset: number }
  | { kind: "close"; name: string; offset: number }
  | { kind: "text"; text: string; offset: number };

const TAG_PATTERN = /<(\/?)([a-z][a-z-]*)((?:\s+[a-z]+=(?:"[^"]*"|'[^']*'))*)\s*>/y;
const ATTRIBUTE_PATTERN = /([a-z]+)=(?:"([^"]*)"|'([^']*)')/g;

function tokenize(markup: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < markup.length) {
    const lt = markup.indexOf("<", index);
    if (lt === -1) {
      tokens.push({ kind: "text", text: markup.slice(index), offset: index });
      break;
    }
    if (lt > index) tokens.push({ kind: "text", text: markup.slice(index, lt), offset: index });
    TAG_PATTERN.lastIndex = lt;
    const match = TAG_PATTERN.exec(markup);
    if (!match) throw new CardTextParseError("Malformed tag", lt);
    const [whole, slash, name, rawAttrs] = match;
    if (slash) {
      if (rawAttrs.trim()) throw new CardTextParseError(`Closing tag </${name}> cannot have attributes`, lt);
      tokens.push({ kind: "close", name, offset: lt });
    } else {
      const attrs: Record<string, string> = {};
      for (const [, key, doubleQuoted, singleQuoted] of execAll(ATTRIBUTE_PATTERN, rawAttrs)) {
        if (key in attrs) throw new CardTextParseError(`Duplicate attribute "${key}" on <${name}>`, lt);
        attrs[key] = doubleQuoted ?? singleQuoted;
      }
      tokens.push({ kind: "open", name, attrs, offset: lt });
    }
    index = lt + whole.length;
  }
  return tokens;
}

// -----------------------------------------------------------------------------
// Parser
// -----------------------------------------------------------------------------

class Cursor {
  private index = 0;
  constructor(private readonly tokens: Token[]) {}
  peek(): Token | undefined {
    return this.tokens[this.index];
  }
  next(): Token | undefined {
    return this.tokens[this.index++];
  }
}

function textToInline(text: string): CardTextInline[] {
  const nodes: CardTextInline[] = [];
  let last = 0;
  for (const match of execAll(ICON_TOKEN, text)) {
    const at = match.index ?? 0;
    if (at > last) nodes.push({ type: "text", text: text.slice(last, at) });
    nodes.push({ type: "icon", icon: ICON_BY_LETTER[match[1].toLowerCase()] });
    last = at + match[0].length;
  }
  if (last < text.length) nodes.push({ type: "text", text: text.slice(last) });
  return nodes;
}

function checkAttributes(token: Extract<Token, { kind: "open" }>): void {
  const allowed = ALLOWED_ATTRIBUTES[token.name] ?? [];
  for (const key of Object.keys(token.attrs)) {
    if (!allowed.includes(key)) throw new CardTextParseError(`<${token.name}> does not take a "${key}" attribute`, token.offset);
    if (token.attrs[key] === "") throw new CardTextParseError(`<${token.name}> has an empty "${key}" attribute`, token.offset);
  }
}

function parseIcons(value: string, token: Extract<Token, { kind: "open" }>, attr: string): ResourceIcon[] {
  if (!/^[rgdeov]+$/.test(value)) {
    throw new CardTextParseError(`<${token.name} ${attr}> must be resource letters (rgdeov), got "${value}"`, token.offset);
  }
  return value.split("").map((letter) => ICON_BY_LETTER[letter]);
}

/** Parses inline content up to (and consuming) `</closing>`. */
function parseInline(cursor: Cursor, closing: string, openOffset: number, allowReminder: boolean): CardTextInline[] {
  const nodes: CardTextInline[] = [];
  for (;;) {
    const token = cursor.next();
    if (!token) throw new CardTextParseError(`Unclosed <${closing}>`, openOffset);
    if (token.kind === "text") {
      nodes.push(...textToInline(token.text));
    } else if (token.kind === "close") {
      if (token.name !== closing) throw new CardTextParseError(`Expected </${closing}>, found </${token.name}>`, token.offset);
      return nodes;
    } else if (token.name in LEAF_INLINE_TAGS) {
      checkAttributes(token);
      const type = LEAF_INLINE_TAGS[token.name];
      const content = cursor.next();
      if (content?.kind !== "text" || !content.text.trim()) {
        throw new CardTextParseError(`<${token.name}> must contain plain text`, token.offset);
      }
      const close = cursor.next();
      if (close?.kind !== "close" || close.name !== token.name) {
        throw new CardTextParseError(`<${token.name}> must contain only plain text and be closed`, token.offset);
      }
      if (type === "keyword" && !CARD_TEXT_KEYWORDS.includes(content.text.toUpperCase())) {
        throw new CardTextParseError(`Unknown keyword <kw>${content.text}</kw>`, token.offset);
      }
      nodes.push({ type, text: content.text });
    } else if (token.name === "reminder") {
      if (!allowReminder) throw new CardTextParseError("<reminder> cannot be nested", token.offset);
      checkAttributes(token);
      const children = parseInline(cursor, "reminder", token.offset, false);
      if (!children.length) throw new CardTextParseError("Empty <reminder>", token.offset);
      nodes.push({ type: "reminder", children });
    } else {
      throw new CardTextParseError(`<${token.name}> is not allowed inside <${closing}>`, token.offset);
    }
  }
}

/** Trims the outer edges of a block's inline content and rejects it if empty. */
function blockContent(nodes: CardTextInline[], tag: string, offset: number): CardTextInline[] {
  const first = nodes[0];
  if (first?.type === "text") {
    const text = first.text.trimStart();
    if (text) nodes[0] = { type: "text", text };
    else nodes.shift();
  }
  const last = nodes[nodes.length - 1];
  if (last?.type === "text") {
    const text = last.text.trimEnd();
    if (text) nodes[nodes.length - 1] = { type: "text", text };
    else nodes.pop();
  }
  if (!nodes.length) throw new CardTextParseError(`Empty <${tag}>`, offset);
  return nodes;
}

function parseAbility(cursor: Cursor, open: Extract<Token, { kind: "open" }>): CardTextBlock {
  const parts: CardTextAbilityPart[] = [];
  for (;;) {
    const token = cursor.next();
    if (!token) throw new CardTextParseError("Unclosed <ability>", open.offset);
    if (token.kind === "text") {
      if (token.text.trim()) throw new CardTextParseError("Text directly inside <ability> must be in <cost>/<extra-cost>/<effect>", token.offset);
      continue;
    }
    if (token.kind === "close") {
      if (token.name !== "ability") throw new CardTextParseError(`Expected </ability>, found </${token.name}>`, token.offset);
      break;
    }
    const partType = ABILITY_PART_TAGS[token.name];
    if (!partType) throw new CardTextParseError(`<${token.name}> is not allowed inside <ability>`, token.offset);
    checkAttributes(token);
    parts.push({ type: partType, children: blockContent(parseInline(cursor, token.name, token.offset, true), token.name, token.offset) });
  }
  if (!parts.length) throw new CardTextParseError("<ability> needs at least one <cost>, <extra-cost> or <effect>", open.offset);
  const { name, threshold, ref } = open.attrs;
  return {
    type: "ability",
    ...(name !== undefined && { name }),
    ...(threshold !== undefined && { threshold: parseIcons(threshold, open, "threshold") }),
    ...(ref !== undefined && { ref }),
    parts
  };
}

/**
 * Parses blocks up to (and consuming) `</closing>`, or to the end of input
 * at the top level (`closing` undefined). `<grant>` can't nest.
 */
function parseBlocks(cursor: Cursor, closing: string | undefined, openOffset: number, allowGrant: boolean): CardTextBlock[] {
  const blocks: CardTextBlock[] = [];
  for (;;) {
    const token = cursor.next();
    if (!token) {
      if (closing) throw new CardTextParseError(`Unclosed <${closing}>`, openOffset);
      return blocks;
    }
    if (token.kind === "text") {
      if (token.text.trim()) throw new CardTextParseError("Text must be inside a block tag", token.offset);
      continue;
    }
    if (token.kind === "close") {
      if (token.name !== closing) throw new CardTextParseError(`Unexpected </${token.name}>`, token.offset);
      if (!blocks.length) throw new CardTextParseError(`Empty <${closing}>`, openOffset);
      return blocks;
    }
    checkAttributes(token);
    if (token.name === "ability") {
      blocks.push(parseAbility(cursor, token));
      continue;
    }
    if (token.name === "rule") {
      const children = blockContent(parseInline(cursor, "rule", token.offset, true), "rule", token.offset);
      const { name, when, ref } = token.attrs;
      blocks.push({
        type: "rule",
        ...(name !== undefined && { name }),
        ...(when !== undefined && { when: parseIcons(when, token, "when") }),
        ...(ref !== undefined && { ref }),
        children
      });
      continue;
    }
    if (token.name === "option") {
      if (token.attrs.label === undefined) throw new CardTextParseError('<option> needs a "label" attribute', token.offset);
      blocks.push({ type: "option", label: token.attrs.label, blocks: parseBlocks(cursor, "option", token.offset, allowGrant) });
      continue;
    }
    if (token.name === "grant") {
      if (!allowGrant) throw new CardTextParseError("<grant> cannot be nested", token.offset);
      blocks.push({ type: "grant", blocks: parseBlocks(cursor, "grant", token.offset, false) });
      continue;
    }
    const inlineBlock = INLINE_BLOCK_TAGS[token.name];
    if (!inlineBlock) throw new CardTextParseError(`<${token.name}> is not a block tag`, token.offset);
    const children = blockContent(parseInline(cursor, token.name, token.offset, true), token.name, token.offset);
    blocks.push({ type: inlineBlock, children });
  }
}

/**
 * Parses card markup into its block tree. Throws `CardTextParseError` on
 * anything outside the vocabulary — unknown tags or attributes, bad nesting,
 * text outside a block, an unknown `<kw>`.
 */
export function parseCardText(markup: string): CardTextBlock[] {
  return parseBlocks(new Cursor(tokenize(markup)), undefined, 0, true);
}

// -----------------------------------------------------------------------------
// Serializer
// -----------------------------------------------------------------------------

function escapeText(text: string): string {
  if (text.includes("<")) throw new Error(`Card text cannot contain "<": ${text}`);
  return text;
}

function attribute(key: string, value: string | undefined): string {
  if (value === undefined) return "";
  if (!value.includes('"')) return ` ${key}="${value}"`;
  if (!value.includes("'")) return ` ${key}='${value}'`;
  throw new Error(`Card markup attribute cannot contain both quote characters: ${value}`);
}

function iconLetters(icons: ResourceIcon[] | undefined): string | undefined {
  return icons?.map((icon) => LETTER_BY_ICON[icon]).join("");
}

function serializeInline(nodes: CardTextInline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return escapeText(node.text);
        case "icon":
          return `[${LETTER_BY_ICON[node.icon].toUpperCase()}]`;
        case "reminder":
          return `<reminder>${serializeInline(node.children)}</reminder>`;
        default: {
          const tag = TAG_BY_LEAF_TYPE[node.type];
          return `<${tag}>${escapeText(node.text)}</${tag}>`;
        }
      }
    })
    .join("");
}

/**
 * Serializes a block tree back to markup. Compact (no whitespace between
 * blocks) by default — the form stored on `CardDefinition.markup`; `pretty`
 * puts each block, and each ability part, on its own line for reading.
 */
export function serializeCardText(blocks: CardTextBlock[], options: { pretty?: boolean } = {}): string {
  return serializeBlocks(blocks, options.pretty ? "\n" : "");
}

function serializeBlocks(blocks: CardTextBlock[], newline: string): string {
  const indented = newline && `${newline}  `;
  return blocks
    .map((block) => {
      switch (block.type) {
        case "ability": {
          const attrs =
            attribute("name", block.name) + attribute("threshold", iconLetters(block.threshold)) + attribute("ref", block.ref);
          const parts = block.parts
            .map((part) => {
              const tag = TAG_BY_ABILITY_PART[part.type];
              return `${indented}<${tag}>${serializeInline(part.children)}</${tag}>`;
            })
            .join("");
          return `<ability${attrs}>${parts}${newline}</ability>`;
        }
        case "rule": {
          const attrs = attribute("name", block.name) + attribute("when", iconLetters(block.when)) + attribute("ref", block.ref);
          return `<rule${attrs}>${serializeInline(block.children)}</rule>`;
        }
        case "option":
          return `<option${attribute("label", block.label)}>${indented}${serializeBlocks(block.blocks, indented)}${newline}</option>`;
        case "grant":
          return `<grant>${indented}${serializeBlocks(block.blocks, indented)}${newline}</grant>`;
        default: {
          const tag = TAG_BY_INLINE_BLOCK_TYPE[block.type];
          return `<${tag}>${serializeInline(block.children)}</${tag}>`;
        }
      }
    })
    .join(newline);
}

// -----------------------------------------------------------------------------
// Plain-text projection
// -----------------------------------------------------------------------------

/** Plain text of inline content, with each tag's implied printed prefix/parentheses restored. */
export function cardTextInlineToPlain(nodes: CardTextInline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return node.text;
        case "icon":
          return `[${LETTER_BY_ICON[node.icon].toUpperCase()}]`;
        case "reminder":
          return `(${cardTextInlineToPlain(node.children)})`;
        default:
          return (PLAIN_PREFIX_BY_LEAF_TYPE[node.type] ?? "") + node.text;
      }
    })
    .join("");
}

function iconTokens(icons: ResourceIcon[]): string {
  return icons.map((icon) => `[${LETTER_BY_ICON[icon].toUpperCase()}]`).join("");
}

function blockToPlain(block: CardTextBlock): string {
  switch (block.type) {
    case "ability": {
      const header = [block.name, block.threshold && iconTokens(block.threshold)].filter(Boolean).join(": ");
      const parts = block.parts.map((part) => PLAIN_LABEL_BY_ABILITY_PART[part.type] + cardTextInlineToPlain(part.children));
      return [header, ...parts].filter(Boolean).join(" -- ");
    }
    case "rule": {
      const label = [block.name, block.when && iconTokens(block.when)].filter(Boolean).join(": ");
      const body = cardTextInlineToPlain(block.children);
      return label ? `${label}: ${body}` : body;
    }
    case "option":
      return `${block.label} -- ${block.blocks.map(blockToPlain).join(" -- ")}`;
    case "grant":
      return `"${block.blocks.map(blockToPlain).join(" -- ")}"`;
    default:
      return PLAIN_LABEL_BY_INLINE_BLOCK_TYPE[block.type] + cardTextInlineToPlain(block.children);
  }
}

/**
 * Projects markup (or a parsed tree) back to printed-style plain text, using
 * the " -- " separator convention of `CardDefinition.text`.
 */
export function cardTextToPlain(markup: string | CardTextBlock[]): string {
  const blocks = typeof markup === "string" ? parseCardText(markup) : markup;
  return blocks.map(blockToPlain).join(" -- ");
}

/**
 * Canonical form for checking markup against a card's archival `text`:
 * every run of " -- " / ":" separators becomes one " | " and whitespace
 * collapses, so the comparison ignores separator style ("OPTION 1 -- x" vs
 * "OPTION 1: x") but nothing else — every word and every other punctuation
 * mark must survive, in order.
 */
export function normalizeCardTextForComparison(text: string): string {
  return text
    .replace(/(?:\s*(?:--|:)\s*)+/g, " | ")
    .replace(/\s+/g, " ")
    .trim();
}
