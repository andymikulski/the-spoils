import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { CARD_CATALOG, ARCANIST_DECK, WARLORD_DECK, SEED3_SAMPLER_DECK } from "../../data.js";
import {
  DEFAULT_MAX_COPIES,
  deckFactionFace,
  findDeckConstructionIssues,
  getMaxCopies,
  getMinimumDeckSize,
  resolveDeckCards,
  type CardDefinition,
  type DeckConstructionIssue
} from "../../engine.js";
import { isStapleResourceDefinition } from "../utilities.js";

const byName = (name: string, set?: string): CardDefinition => {
  const card = CARD_CATALOG.find(c => c.name === name && (!set || c.set === set));
  assert.ok(card, `${name} (${set ?? "any"}) is in the catalog`);
  return card;
};
const byId = (id: string): CardDefinition => {
  const card = CARD_CATALOG.find(c => c.id === id);
  assert.ok(card, `${id} is in the catalog`);
  return card;
};
const times = (card: CardDefinition, n: number): CardDefinition[] => Array.from({ length: n }, () => card);
const kinds = (issues: DeckConstructionIssue[]) => issues.map(i => i.kind);

const FACTION = byName("The Tournament Faction", "1st Edition");
const OTHER_FACTION = byName("The Tournament Faction", "Holy Heist");
const RAGE = byName("Rage", "1st Edition");
const PARTY_CLOWNS_SEED_2 = byName("Party Clowns", "Seed 2");
const PARTY_CLOWNS_SAGA = byName("Party Clowns", "Seed Saga");
const CROW = byName("Crow With Fists");
const normalCard = (() => {
  const card = CARD_CATALOG.find(c => c.type === "character" && getMaxCopies(c) === 4);
  assert.ok(card);
  return card;
})();
const otherNormalCard = CARD_CATALOG.find(c => c.type === "character" && c.id !== normalCard.id && getMaxCopies(c) === 4)!;

/** A decklist of `size` cards: the faction, 2 staples, then filler at 4 copies each (the faction card is part of `size`). */
function legalDeck(size = 60): CardDefinition[] {
  const cards: CardDefinition[] = [FACTION, RAGE, byName("Greed", "1st Edition")];
  const pool = CARD_CATALOG.filter(c => c.type === "character" && getMaxCopies(c) === 4);
  for (let i = 0; cards.length < size; i++) cards.push(pool[Math.floor(i / 4)]!);
  return cards;
}

describe("getMaxCopies", () => {
  test("a normal card is limited to 4 copies", () => {
    assert.equal(getMaxCopies(normalCard), 4);
    assert.equal(DEFAULT_MAX_COPIES, 4);
  });

  test("staple resources are unlimited", () => {
    assert.equal(getMaxCopies(RAGE), null);
    for (const name of ["Obsession", "Greed", "Elitism", "Deception", "Rage"]) {
      assert.equal(getMaxCopies(byName(name, "1st Edition")), null, name);
    }
  });

  test("Party Clowns and Crow With Fists are unlimited from the deckLimit data", () => {
    for (const card of [PARTY_CLOWNS_SEED_2, PARTY_CLOWNS_SAGA, CROW]) {
      assert.equal(card.deckLimit, "unlimited", `${card.name} (${card.set}) carries the flag`);
      assert.equal(getMaxCopies(card), null, `${card.name} (${card.set})`);
    }
  });

  test("over the whole catalog only staples and the flagged printings are unlimited", () => {
    const unlimited = CARD_CATALOG.filter(c => getMaxCopies(c) === null);
    for (const card of unlimited) {
      assert.ok(isStapleResourceDefinition(card) || card.deckLimit === "unlimited", `${card.name} (${card.set}) is unlimited`);
    }
    for (const card of CARD_CATALOG) {
      if (isStapleResourceDefinition(card) || card.deckLimit === "unlimited") continue;
      assert.equal(getMaxCopies(card), 4, `${card.name} (${card.set})`);
    }
    const flagged = CARD_CATALOG.filter(c => c.deckLimit === "unlimited").map(c => `${c.name} (${c.set})`).sort();
    assert.deepEqual(flagged, ["Crow With Fists (Ungodly Mess)", "Party Clowns (Seed 2)", "Party Clowns (Seed Saga)"]);
  });

  test("the flag is on exactly the printings whose markup prints the sentence (and agrees with the old text rule)", () => {
    const printed = /you may include as many copies of this card in your deck as you want/i;
    for (const card of CARD_CATALOG) {
      assert.equal(card.deckLimit === "unlimited", printed.test(card.markup ?? ""), `${card.name} (${card.set}) markup`);
      assert.equal(card.deckLimit === "unlimited", printed.test(card.text), `${card.name} (${card.set}) text`);
    }
  });
});

describe("getMinimumDeckSize", () => {
  test("no rule (undefined) with no faction or a faction that prints no minimum", () => {
    assert.equal(getMinimumDeckSize(), undefined);
    assert.equal(getMinimumDeckSize(FACTION), undefined);
    assert.equal(getMinimumDeckSize(FACTION.faction), undefined);
  });

  test("The Society of Magical Propriety prints 300, and it is the only faction that does", () => {
    const society = byName("The Society of Magical Propriety");
    assert.match(society.text, /MINIMUM DECK SIZE: 300 cards/);
    assert.equal(society.faction?.minimumDeckSize, 300);
    assert.equal(getMinimumDeckSize(society), 300);
    assert.equal(getMinimumDeckSize(society.faction), 300);
    const printers = CARD_CATALOG.filter(c => /MINIMUM DECK SIZE/.test(c.markup ?? "")).map(c => c.id);
    const flagged = CARD_CATALOG.filter(c => c.faction?.minimumDeckSize !== undefined).map(c => c.id);
    assert.deepEqual(flagged, printers, "the field is on exactly the printings whose markup prints the rule");
  });
});

describe("findDeckConstructionIssues", () => {
  test("a legal deck has no issues", () => {
    assert.deepEqual(findDeckConstructionIssues(legalDeck()), []);
  });

  test("empty", () => {
    const issues = findDeckConstructionIssues([]);
    assert.deepEqual(kinds(issues), ["empty", "factionCount"]);
    assert.match(issues[0]!.message, /empty/i);
  });

  test("unknownCard: one issue per distinct id, and they count toward the size", () => {
    const deck = legalDeck(58);
    const issues = findDeckConstructionIssues(deck, { unknownCardIds: ["nope", "nope", "also-nope"] });
    assert.deepEqual(kinds(issues), ["unknownCard", "unknownCard"]);
    assert.deepEqual(issues.map(i => i.cardId), ["nope", "also-nope"]);
    assert.ok(issues.every(i => i.message.length > 0));
    // 57 non-faction known + 3 unknown = 60 >= 60: no minimumSize issue
    assert.ok(!kinds(findDeckConstructionIssues(deck, { unknownCardIds: ["a", "b", "c"], minimumSize: 60 })).includes("minimumSize"));
    const withFewer = findDeckConstructionIssues(deck, { unknownCardIds: ["a", "b"], minimumSize: 60 });
    assert.ok(kinds(withFewer).includes("minimumSize"), "57 + 2 = 59 is short");
  });

  test("resolveDeckCards splits known and unknown ids", () => {
    const { cards, unknownCardIds } = resolveDeckCards([FACTION.id, "nope", RAGE.id, RAGE.id], CARD_CATALOG);
    assert.deepEqual(cards.map(c => c.id), [FACTION.id, RAGE.id, RAGE.id]);
    assert.deepEqual(unknownCardIds, ["nope"]);
    const viaLookup = resolveDeckCards([RAGE.id, "x"], id => (id === RAGE.id ? RAGE : undefined));
    assert.equal(viaLookup.cards.length, 1);
    assert.deepEqual(viaLookup.unknownCardIds, ["x"]);
  });

  test("factionCount: 0, 1 and 2 faction cards", () => {
    const body = legalDeck().slice(1);
    const none = findDeckConstructionIssues(body, { minimumSize: false });
    assert.deepEqual(kinds(none), ["factionCount"]);
    assert.match(none[0]!.message, /exactly one faction card, found 0/);

    assert.deepEqual(findDeckConstructionIssues([FACTION, ...body], { minimumSize: false }), []);

    const two = findDeckConstructionIssues([FACTION, OTHER_FACTION, ...body], { minimumSize: false });
    assert.deepEqual(kinds(two), ["factionCount"]);
    assert.match(two[0]!.message, /exactly one faction card, found 2/);
    // two copies of the same faction card also count as two
    assert.deepEqual(kinds(findDeckConstructionIssues([FACTION, FACTION, ...body], { minimumSize: false })), ["factionCount"]);
  });

  test("copyLimit: normal card (4 ok, 5 over), staple, Party Clowns and Crow With Fists", () => {
    const base = [FACTION, RAGE, byName("Greed", "1st Edition")];
    const opts = { minimumSize: false } as const;

    assert.deepEqual(findDeckConstructionIssues([...base, ...times(normalCard, 4)], opts), [], "4 copies");
    const five = findDeckConstructionIssues([...base, ...times(normalCard, 5)], opts);
    assert.deepEqual(kinds(five), ["copyLimit"]);
    assert.equal(five[0]!.cardId, normalCard.id);
    assert.match(five[0]!.message, new RegExp(`5 copies of ${normalCard.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*4-copy`));

    assert.deepEqual(findDeckConstructionIssues([...base, ...times(RAGE, 30)], opts), [], "30 Rage");
    assert.deepEqual(findDeckConstructionIssues([...base, ...times(PARTY_CLOWNS_SEED_2, 12)], opts), [], "12 Party Clowns (Seed 2)");
    assert.deepEqual(findDeckConstructionIssues([...base, ...times(PARTY_CLOWNS_SAGA, 12)], opts), [], "12 Party Clowns (Saga)");
    assert.deepEqual(findDeckConstructionIssues([...base, ...times(CROW, 12)], opts), [], "12 Crow With Fists");

    // limits are per card name: two over-limit cards give two issues, in first-seen order
    const two = findDeckConstructionIssues([...base, ...times(otherNormalCard, 5), ...times(normalCard, 6)], opts);
    assert.deepEqual(two.map(i => i.cardId), [otherNormalCard.id, normalCard.id]);
  });

  test("minimumSize: no general rule; only an explicit size applies, and the faction card does not count", () => {
    assert.deepEqual(findDeckConstructionIssues(legalDeck(5)), [], "a tiny deck is constructible: there is no general minimum");
    const deck = legalDeck(60); // faction + 59 others
    assert.deepEqual(findDeckConstructionIssues(deck, { minimumSize: 59 }), [], "59 non-faction cards meet 59");
    const short = findDeckConstructionIssues(deck, { minimumSize: 60 });
    assert.deepEqual(kinds(short), ["minimumSize"], "60 cards including the faction is only 59 in the deck");
    assert.match(short[0]!.message, /at least 60 cards besides its faction card, found 59/);
    assert.deepEqual(findDeckConstructionIssues(deck, { minimumSize: false }), []);
    assert.deepEqual(findDeckConstructionIssues(legalDeck(61), { minimumSize: 60 }), []);
  });

  test("minimumSize: a faction's own minimum applies (synthetic override); false skips it", () => {
    const big = { ...FACTION, faction: { ...FACTION.faction!, minimumDeckSize: 100 } } as CardDefinition;
    const issues = findDeckConstructionIssues([big, ...legalDeck(100).slice(1)]);
    assert.deepEqual(kinds(issues), ["minimumSize"]);
    assert.match(issues[0]!.message, /at least 100 cards besides its faction card, found 99/);
    assert.deepEqual(findDeckConstructionIssues([big, ...legalDeck(101).slice(1)]), []);
    assert.deepEqual(findDeckConstructionIssues([big, ...legalDeck(10).slice(1)], { minimumSize: false }), []);
  });

  test("minimumSize: The Society of Magical Propriety needs 300 non-faction cards", () => {
    const society = byName("The Society of Magical Propriety");
    const pool = CARD_CATALOG.filter(c => c.type === "character" && getMaxCopies(c) === 4);
    const body = (n: number): CardDefinition[] => Array.from({ length: n }, (_, i) => pool[Math.floor(i / 4)]!);
    const under = findDeckConstructionIssues([society, ...body(299)]);
    assert.deepEqual(kinds(under), ["minimumSize"]);
    assert.match(under[0]!.message, /at least 300 cards besides its faction card, found 299/);
    assert.deepEqual(findDeckConstructionIssues([society, ...body(300)]), [], "300 non-faction cards");
    assert.deepEqual(kinds(findDeckConstructionIssues(body(300))), ["factionCount"], "no faction card: no faction minimum");
  });

  test("factionRule: a faction needing 2 different staples is flagged once and can be skipped", () => {
    const heroes = byName("Unlikely Heroes");
    const body = legalDeck().slice(3); // no staples at all
    const oneKind = [heroes, RAGE, ...body];
    const issues = findDeckConstructionIssues(oneKind, { minimumSize: false });
    assert.deepEqual(kinds(issues), ["factionRule"]);
    assert.match(issues[0]!.message, /Unlikely Heroes.*2 different staple/);
    assert.deepEqual(findDeckConstructionIssues(oneKind, { minimumSize: false, factionRules: false }), []);
    assert.deepEqual(findDeckConstructionIssues([heroes, RAGE, byName("Greed", "1st Edition"), ...body], { minimumSize: false }), []);
  });

  test("the order is empty, unknown, factionCount, copyLimit, minimumSize, factionRule", () => {
    const heroes = byName("Unlikely Heroes");
    const deck = [heroes, heroes, ...times(normalCard, 5)];
    const issues = findDeckConstructionIssues(deck, { unknownCardIds: ["nope"] });
    assert.deepEqual(kinds(issues), ["unknownCard", "factionCount", "copyLimit"]);
    const heroesDeck = [heroes, ...times(normalCard, 5)];
    assert.deepEqual(kinds(findDeckConstructionIssues(heroesDeck, { minimumSize: 10 })), ["copyLimit", "minimumSize", "factionRule"]);
  });
});

describe("copy limit agrees with the printed-text rule", () => {
  // The copy rule stated independently of the engine: a staple resource, or a card whose
  // printed text has the "as many copies" sentence, is unlimited; everything else 4.
  const printed = /you may include as many copies of this card in your deck/i;
  const expectedMax = (card: CardDefinition): number | null =>
    card.type === "resource" &&
    (card.resource?.staple === true || ["obsession", "greed", "elitism", "deception", "rage"].includes(card.name.toLowerCase()))
      ? null
      : printed.test(card.text)
        ? null
        : 4;

  test("getMaxCopies equals the printed-text rule on every printing", () => {
    for (const card of CARD_CATALOG) {
      assert.equal(getMaxCopies(card), expectedMax(card), `${card.name} (${card.set})`);
    }
  });

  test("the bundled decks are constructible (size aside) and report the same copy-limit verdict as the printed-text rule", () => {
    for (const [name, ids] of [
      ["ARCANIST_DECK", ARCANIST_DECK],
      ["WARLORD_DECK", WARLORD_DECK],
      ["SEED3_SAMPLER_DECK", SEED3_SAMPLER_DECK]
    ] as const) {
      const { cards, unknownCardIds } = resolveDeckCards(ids, CARD_CATALOG);
      assert.deepEqual(unknownCardIds, [], `${name} ids all known`);
      const issues = findDeckConstructionIssues(cards, { minimumSize: false });
      // expected verdict
      const tally = new Map<string, number>();
      for (const c of cards) tally.set(c.id, (tally.get(c.id) ?? 0) + 1);
      const expectedOver = [...tally].filter(([id, n]) => {
        const max = expectedMax(byId(id));
        return max !== null && n > max;
      }).map(([id]) => id);
      assert.deepEqual(issues.filter(i => i.kind === "copyLimit").map(i => i.cardId), expectedOver, `${name} copy limit`);
      const factions = cards.filter(c => c.type === "faction").length;
      assert.equal(issues.some(i => i.kind === "factionCount"), factions !== 1, `${name} faction count`);
      assert.ok(!issues.some(i => i.kind === "unknownCard" || i.kind === "empty"), `${name}`);
    }
  });
});

describe("deckFactionFace (Counter-Imperial Army)", () => {
  const imperial = byName("Imperial Army");
  const counter = byName("Counter-Imperial Army");

  test("either side of the double-sided card resolves to the printed starting face, from flipsTo data", () => {
    assert.equal(deckFactionFace(counter, CARD_CATALOG).id, imperial.id);
    assert.equal(deckFactionFace(counter, id => CARD_CATALOG.find(c => c.id === id)).id, imperial.id);
    assert.equal(deckFactionFace(imperial, CARD_CATALOG).id, imperial.id);
  });

  test("other cards and factions are returned as they are", () => {
    assert.equal(deckFactionFace(FACTION, CARD_CATALOG), FACTION);
    assert.equal(deckFactionFace(normalCard, CARD_CATALOG), normalCard);
  });

  test("only Counter-Imperial Army is startsFlipped in the catalog", () => {
    const flipped = CARD_CATALOG.filter(c => c.faction?.setup.startsFlipped).map(c => c.name);
    assert.deepEqual(flipped, ["Counter-Imperial Army"]);
  });
});
