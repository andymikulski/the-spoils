import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  CardTextParseError,
  cardTextToPlain,
  normalizeCardTextForComparison,
  parseCardText,
  serializeCardText,
  type CardTextBlock
} from "../cardText.js";
import type { CardDefinition } from "../engine.js";

const ABRAM =
  '<keywords><unique>PLUCK</unique></keywords>' +
  "<fealty>While this card is in your hand, reduce this card's threshold requirement by any 3 resource icons.</fealty>" +
  '<ability name="MAKE VANISH" ref="make-vanish"><cost>Deplete this card. Pay 5.</cost><effect>Put that character into the void.</effect></ability>';

describe("parseCardText", () => {
  test("parses blocks, ability parts and inline tags into a typed tree", () => {
    assert.deepEqual(parseCardText(ABRAM), [
      { type: "keywords", children: [{ type: "unique", text: "PLUCK" }] },
      {
        type: "fealty",
        children: [{ type: "text", text: "While this card is in your hand, reduce this card's threshold requirement by any 3 resource icons." }]
      },
      {
        type: "ability",
        name: "MAKE VANISH",
        ref: "make-vanish",
        parts: [
          { type: "cost", children: [{ type: "text", text: "Deplete this card. Pay 5." }] },
          { type: "effect", children: [{ type: "text", text: "Put that character into the void." }] }
        ]
      }
    ] satisfies CardTextBlock[]);
  });

  test("turns printed icon tokens into icon nodes and reads icon attributes", () => {
    const [gate, ability] = parseCardText(
      '<rule when="oo"><kw>COVERT</kw> costs [E][V].</rule><ability name="RECUR" threshold="ggg"><cost>Pay 1.</cost></ability>'
    );
    assert.deepEqual(gate, {
      type: "rule",
      when: ["obsession", "obsession"],
      children: [
        { type: "keyword", text: "COVERT" },
        { type: "text", text: " costs " },
        { type: "icon", icon: "elitism" },
        { type: "icon", icon: "volition" },
        { type: "text", text: "." }
      ]
    });
    assert.deepEqual((ability as Extract<CardTextBlock, { type: "ability" }>).threshold, ["greed", "greed", "greed"]);
  });

  test("options and grants hold blocks", () => {
    const [option, grant] = parseCardText(
      '<option label="OPTION 2"><extra-cost>Pick a character.</extra-cost><effect>Draw a card.</effect></option>' +
        '<grant><rule>All your characters gain 1 strength.</rule></grant>'
    );
    assert.equal(option.type, "option");
    assert.deepEqual(
      (option as Extract<CardTextBlock, { type: "option" }>).blocks.map((block) => block.type),
      ["extraCost", "effect"]
    );
    assert.equal(grant.type, "grant");
  });

  test("single-quoted attribute values may contain double quotes", () => {
    const [ability] = parseCardText(`<ability name='"ENHANCE"'><cost>Pay 3.</cost></ability>`);
    assert.equal((ability as Extract<CardTextBlock, { type: "ability" }>).name, '"ENHANCE"');
  });

  test("ignores whitespace between blocks and trims block edges", () => {
    assert.deepEqual(parseCardText(ABRAM), parseCardText(serializeCardText(parseCardText(ABRAM), { pretty: true })));
    assert.deepEqual(parseCardText("\n  <rule>  Draw a card.  </rule>\n"), [{ type: "rule", children: [{ type: "text", text: "Draw a card." }] }]);
  });

  const rejects: Array<[string, string]> = [
    ["unknown tag", "<rule>Draw <bold>a</bold> card.</rule>"],
    ["unknown attribute", '<rule size="2">Draw a card.</rule>'],
    ["text outside a block", "Draw a card."],
    ["inline tag at the top level", "<kw>COVERT</kw>"],
    ["unclosed block", "<rule>Draw a card."],
    ["mismatched close", "<rule>Draw a card.</effect>"],
    ["unknown keyword", "<rule>gains <kw>FLYING</kw></rule>"],
    ["nested reminder", "<rule><reminder>a <reminder>b</reminder></reminder></rule>"],
    ["nested grant", "<grant><grant><rule>x</rule></grant></grant>"],
    ["option without a label", "<option><rule>x</rule></option>"],
    ["empty block", "<rule> </rule>"],
    ["bad icon letters", '<ability name="X" threshold="q"><cost>Pay 1.</cost></ability>'],
    ["ability without parts", '<ability name="X"></ability>'],
    ["text loose inside an ability", '<ability name="X">Pay 1.</ability>'],
    ["leaf tag holding a tag", "<rule><unique><kw>COVERT</kw></unique></rule>"],
    ["malformed tag", "<rule>x</rule><rule"]
  ];
  for (const [label, markup] of rejects) {
    test(`rejects ${label}`, () => {
      assert.throws(() => parseCardText(markup), CardTextParseError);
    });
  }
});

describe("serializeCardText", () => {
  test("compact serialization round-trips exactly", () => {
    assert.equal(serializeCardText(parseCardText(ABRAM)), ABRAM);
  });
});

describe("cardTextToPlain", () => {
  test("restores printed labels, prefixes, parentheses and quotes", () => {
    const markup =
      '<keywords><kw>TACTICAL</kw>, <unique>IOHANE</unique></keywords>' +
      "<keywords><attach>CHARACTER</attach></keywords>" +
      '<rule name="STARTING DRAW">8 going first.</rule>' +
      '<rule when="oooo"><kw>COVERT</kw></rule>' +
      "<extra-cost>Pick a character. <reminder>You still pay its costs.</reminder></extra-cost>" +
      '<ability name="HELPING PAW" threshold="d"><cost>Pay 4.</cost><effect>Draw a card.</effect></ability>' +
      '<option label="OPTION 1"><rule>Discard a card.</rule></option>' +
      "<rule>The attached character gains the following rules text:</rule>" +
      "<grant><rule>A.</rule><rule>B.</rule></grant>" +
      "<flip-up>4 [E]</flip-up>";
    assert.equal(
      cardTextToPlain(markup),
      "TACTICAL, UNIQUE IOHANE -- ATTACH TO CHARACTER -- STARTING DRAW: 8 going first. -- [O][O][O][O]: COVERT -- " +
        "EXTRA COST: Pick a character. (You still pay its costs.) -- HELPING PAW: [D] -- COST: Pay 4. -- EFFECT: Draw a card. -- " +
        'OPTION 1 -- Discard a card. -- The attached character gains the following rules text: -- "A. -- B." -- FLIP UP: 4 [E]'
    );
  });
});

describe("normalizeCardTextForComparison", () => {
  test("ignores separator style and whitespace", () => {
    assert.equal(normalizeCardTextForComparison("OPTION 1: x"), normalizeCardTextForComparison("OPTION 1 -- x"));
    assert.equal(
      normalizeCardTextForComparison('rules text: "A -- B."'),
      normalizeCardTextForComparison('rules text: -- "A -- B."')
    );
  });

  test("keeps words and other punctuation significant", () => {
    assert.notEqual(normalizeCardTextForComparison("Draw a card."), normalizeCardTextForComparison("Draw a card"));
    assert.notEqual(normalizeCardTextForComparison("the the card"), normalizeCardTextForComparison("the card"));
  });
});

describe("catalog markup", () => {
  const readData = <T>(path: string): T => JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"));
  const cards = readData<CardDefinition[]>("../../data/cards.json");
  /** Corrected rules text, by printing id, for printings whose archival `text` doesn't match their card (docs/CARD-DATA.md). */
  const corrections = readData<Record<string, { text: string; reason: string }>>("../../data/card-audit/corrections.json");
  const rulesText = (card: CardDefinition) => corrections[card.id]?.text ?? card.text;

  test("every correction is keyed by a real printing id and gives a reason", () => {
    const ids = new Set(cards.map((card) => card.id));
    for (const [id, correction] of Object.entries(corrections)) {
      assert.ok(ids.has(id), `${id} is not a printing id`);
      assert.ok(correction.reason.trim(), `${id} has no reason`);
    }
  });

  test("every card's markup parses, round-trips to its rules text, and refs its own abilities", () => {
    const problems: string[] = [];
    for (const card of cards) {
      if (card.markup === undefined) continue;
      if (!rulesText(card).trim()) {
        problems.push(`${card.name} (${card.set}): markup on a card with no text`);
        continue;
      }
      let blocks: CardTextBlock[];
      try {
        blocks = parseCardText(card.markup);
      } catch (error) {
        problems.push(`${card.name} (${card.set}): ${(error as Error).message}`);
        continue;
      }
      if (normalizeCardTextForComparison(cardTextToPlain(blocks)) !== normalizeCardTextForComparison(rulesText(card))) {
        problems.push(`${card.name} (${card.set}): markup does not round-trip to text`);
      }
      const ids = new Set((card.behavior?.abilities ?? []).map((ability) => ability.id));
      for (const ref of card.markup.matchAll(/ ref="([^"]*)"/g)) {
        if (!ids.has(ref[1])) problems.push(`${card.name} (${card.set}): ref "${ref[1]}" is not one of its abilities`);
      }
    }
    assert.deepEqual(problems, []);
  });
});
