import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { CARD_CATALOG } from "../../data.js";
import {
  EPIC_MAX_COPIES,
  findDeckConstructionIssues,
  isEpicCard,
  type CardDefinition,
  type DeckConstructionOptions
} from "../../engine.js";
import { character, factionCard } from "./support/fixtures.js";

const times = (card: CardDefinition, n: number): CardDefinition[] => Array.from({ length: n }, () => card);
const check = (cards: readonly CardDefinition[], options: DeckConstructionOptions = {}) =>
  findDeckConstructionIssues(cards, { minimumSize: false, factionRules: false, ...options });

const faction = factionCard({ name: "Plain Faction" });
const epic = character({ name: "Epic Hero", rarity: "epic" });
const common = character({ name: "Common Hero" });

describe("isEpicCard (EP 1)", () => {
  test("rarity epic and e-sle are epic, case-insensitively", () => {
    assert.equal(isEpicCard(character({ rarity: "epic" })), true);
    assert.equal(isEpicCard(character({ rarity: "e-sle" })), true);
    assert.equal(isEpicCard(character({ rarity: "EPIC" })), true);
    assert.equal(isEpicCard(character({ rarity: "E-SLE" })), true);
  });

  test("any other rarity is not epic", () => {
    for (const rarity of ["common", "uncommon", "rare", "super-rare", "ultra-rare", "uber", "fixed", "promo", ""]) {
      assert.equal(isEpicCard(character({ rarity })), false, rarity || "(empty)");
    }
  });
});

describe("epic deck legality", () => {
  test("EP 2: a Constructed deck may hold 1 copy of an epic card", () => {
    assert.equal(EPIC_MAX_COPIES, 1);
    assert.deepEqual(check([faction, epic, ...times(common, 4)]), []);
  });

  test("EP 2: a second copy is exactly one epicCopyLimit issue, not also a copyLimit", () => {
    const issues = check([faction, ...times(epic, 2)]);
    assert.deepEqual(issues.map(i => i.kind), ["epicCopyLimit"]);
    assert.equal(issues[0]!.cardId, epic.id);
    assert.equal(issues[0]!.count, 2);
    assert.equal(issues[0]!.max, 1);
    assert.match(issues[0]!.message, /Epic Hero/);
  });

  test("EP 2: 5 copies of an epic card is still a single issue, and the count is by name across printings", () => {
    assert.deepEqual(check([faction, ...times(epic, 5)]).map(i => i.kind), ["epicCopyLimit"]);
    const reprint = character({ name: "Epic Hero", rarity: "epic", set: "Other" });
    assert.deepEqual(check([faction, epic, reprint]).map(i => i.kind), ["epicCopyLimit"]);
  });

  test("EP 2: an epic card that is also unlimited-by-flag is still held to 1 copy", () => {
    const flagged = character({ name: "Epic Clown", rarity: "epic", deckLimit: "unlimited" });
    assert.deepEqual(check([faction, ...times(flagged, 3)]).map(i => i.kind), ["epicCopyLimit"]);
  });

  test("EP 2: non-epic cards keep the normal copy limit alongside an epic card", () => {
    const issues = check([faction, epic, ...times(common, 5)]);
    assert.deepEqual(issues.map(i => i.kind), ["copyLimit"]);
    assert.equal(issues[0]!.cardId, common.id);
  });

  test("EP 3: epic cards are not allowed in Limited", () => {
    const issues = check([faction, epic, ...times(common, 3)], { play: "limited" });
    assert.deepEqual(issues.map(i => i.kind), ["epicInLimited"]);
    assert.equal(issues[0]!.cardId, epic.id);
    assert.deepEqual(check([faction, ...times(common, 3)], { play: "limited" }), []);
  });

  test("EP 3: in Limited several copies of an epic card are one epicInLimited issue", () => {
    assert.deepEqual(check([faction, ...times(epic, 3)], { play: "limited" }).map(i => i.kind), ["epicInLimited"]);
  });

  test("EP 3: an epic faction card is not allowed in Limited either", () => {
    const epicFaction = factionCard({ name: "Epic Faction", rarity: "e-sle" });
    const issues = check([epicFaction, common], { play: "limited" });
    assert.deepEqual(issues.map(i => i.kind), ["epicInLimited"]);
    assert.equal(issues[0]!.cardId, epicFaction.id);
    assert.deepEqual(check([epicFaction, common]), [], "Constructed allows it");
  });

  test("EP 4: epic cards are not allowed in a tournament that is not an epic tournament", () => {
    for (const tournament of [{}, { epic: false }]) {
      const issues = check([faction, epic, common], { tournament });
      assert.deepEqual(issues.map(i => i.kind), ["epicInTournament"], JSON.stringify(tournament));
      assert.equal(issues[0]!.cardId, epic.id);
    }
    const epicFaction = factionCard({ name: "Epic Faction", rarity: "e-sle" });
    assert.deepEqual(check([epicFaction, common], { tournament: {} }).map(i => i.kind), ["epicInTournament"]);
  });

  test("EP 4: an epic tournament allows epic cards (still 1 copy each)", () => {
    assert.deepEqual(check([faction, epic, common], { tournament: { epic: true } }), []);
    assert.deepEqual(check([faction, ...times(epic, 2)], { tournament: { epic: true } }).map(i => i.kind), ["epicCopyLimit"]);
  });

  test("EP 4: a deck without epic cards is fine in any tournament", () => {
    assert.deepEqual(check([faction, ...times(common, 4)], { tournament: {} }), []);
  });

  test("the restrictions compose: Limited tournament with a duplicated epic card", () => {
    const issues = check([faction, ...times(epic, 2)], { play: "limited", tournament: {} });
    assert.deepEqual(issues.map(i => i.kind), ["epicInLimited", "epicInTournament"]);
  });

  test("defaults are unchanged: casual Constructed allows an epic card, and no options means no epic issue", () => {
    assert.deepEqual(findDeckConstructionIssues([faction, epic, common], { minimumSize: false }), []);
    assert.deepEqual(check([faction, epic, common], { play: "constructed" }), []);
  });
});

describe("catalog epic data", () => {
  test("the epic definitions are exactly the seven epic factions", () => {
    const names = [...new Set(CARD_CATALOG.filter(isEpicCard).map(c => c.name))].sort();
    assert.deepEqual(
      names,
      [
        "Counter-Imperial Army",
        "Imperial Army",
        "Slightly Less Evil Alliance",
        "The Evil Alliance",
        "The Knitting Coalition",
        "The Society of Magical Propriety",
        "The Union of Unextraordinary Miners"
      ].sort()
    );
    for (const card of CARD_CATALOG.filter(isEpicCard)) {
      assert.equal(card.type, "faction", `${card.name} is a faction card`);
      assert.match(card.rarity, /^(epic|e-sle)$/);
    }
  });

  test("the catalog's only rarities spelled epic are lowercase epic and e-sle", () => {
    const rarities = new Set(CARD_CATALOG.map(c => c.rarity).filter(r => /epic|e-sle/i.test(r)));
    assert.deepEqual([...rarities].sort(), ["e-sle", "epic"]);
  });

  test("a real epic faction deck is legal in Constructed and flagged in Limited and plain tournaments", () => {
    const society = CARD_CATALOG.find(c => c.name === "The Society of Magical Propriety")!;
    assert.deepEqual(check([society]).map(i => i.kind), []);
    assert.deepEqual(check([society], { play: "limited" }).map(i => i.kind), ["epicInLimited"]);
    assert.deepEqual(check([society], { tournament: {} }).map(i => i.kind), ["epicInTournament"]);
  });
});
