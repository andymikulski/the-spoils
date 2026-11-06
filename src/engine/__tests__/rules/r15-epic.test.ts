// Batch r15-epic (docs/TESTING.md): the printed Epic Rules insert, EP 1-4
// (docs/rules/epic-rules.md, RULES.md section 15).
// Written from the wording of the rules, not from the engine. Synthetic
// fixtures only: rarity "epic" and "e-sle" definitions stand in for the
// catalog's epic printings.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, DeckConstructionOptions } from "../../../engine.js";
import { findDeckConstructionIssues, isEpicCard } from "../../../engine.js";
import { character, factionCard } from "../support/fixtures.js";
import { rule } from "./_rule.js";

const times = (card: CardDefinition, n: number): CardDefinition[] => Array.from({ length: n }, () => card);
const issuesOf = (cards: readonly CardDefinition[], options: DeckConstructionOptions = {}) =>
  findDeckConstructionIssues(cards, { minimumSize: false, factionRules: false, ...options });
const kinds = (cards: readonly CardDefinition[], options: DeckConstructionOptions = {}) =>
  issuesOf(cards, options).map(issue => issue.kind);

const faction = factionCard({ name: "Plain Faction" });
const epic = character({ name: "Epic Hero", rarity: "epic" });
const common = character({ name: "Common Hero", rarity: "common" });

describe("EP 1 - what makes a card epic", () => {
  rule("EP 1", "a card whose rarity mark reads EPIC is epic", () => {
    assert.equal(isEpicCard(character({ rarity: "epic" })), true);
    assert.equal(isEpicCard(character({ rarity: "EPIC" })), true, "the mark is printed in capitals");
    assert.equal(isEpicCard(factionCard({ rarity: "epic" })), true, "a faction card can be epic too");
  });

  rule("EP 1", "a card whose rarity mark reads E-SLE (the Showdown factions) is also epic", () => {
    assert.equal(isEpicCard(factionCard({ rarity: "e-sle" })), true);
    assert.equal(isEpicCard(factionCard({ rarity: "E-SLE" })), true);
  });

  rule("EP 1", "a card with any other rarity mark is not epic", () => {
    for (const rarity of ["common", "uncommon", "rare", "super-rare", "ultra-rare", "uber", "fixed", "promo", ""]) {
      assert.equal(isEpicCard(character({ rarity })), false, rarity || "(empty)");
    }
  });

  rule("EP 1", "epic status is what the deck rules act on: an epic and an e-sle card are both held to the epic restrictions, a rare one is not", () => {
    for (const rarity of ["epic", "e-sle"]) {
      assert.deepEqual(kinds([factionCard({ rarity })], { play: "limited" }), ["epicInLimited"], rarity);
    }
    assert.deepEqual(kinds([factionCard({ rarity: "rare" })], { play: "limited" }), [], "control: a non-epic faction is fine");
  });
});

describe("EP 2 - at most 1 copy of each epic card in Constructed", () => {
  rule("EP 2", "a Constructed deck may include 1 copy of an epic card", () => {
    assert.deepEqual(kinds([faction, epic, ...times(common, 4)]), []);
  });

  rule("EP 2", "a second copy of an epic card breaks the 1-copy limit, and 5 copies is still just that card over the limit", () => {
    const two = issuesOf([faction, ...times(epic, 2)]);
    assert.deepEqual(two.map(i => i.kind), ["epicCopyLimit"]);
    assert.equal(two[0]!.cardId, epic.id);
    assert.equal(two[0]!.count, 2);
    assert.equal(two[0]!.max, 1);
    assert.deepEqual(kinds([faction, ...times(epic, 5)]), ["epicCopyLimit"]);
  });

  rule("EP 2", "the limit applies to each epic card separately: one copy each of two different epic cards is legal", () => {
    const other = character({ name: "Other Epic Hero", rarity: "e-sle" });
    assert.deepEqual(kinds([faction, epic, other]), []);
    assert.deepEqual(kinds([faction, ...times(epic, 2), other]), ["epicCopyLimit"], "only the duplicated card is flagged");
  });

  rule("EP 2", "copies of the same epic card are counted across printings", () => {
    const reprint = character({ name: "Epic Hero", rarity: "epic", set: "Other" });
    assert.deepEqual(kinds([faction, epic, reprint]), ["epicCopyLimit"]);
  });

  rule("EP 2", "an epic card is held to 1 copy even when a card flag would otherwise let a deck hold any number", () => {
    const flagged = character({ name: "Epic Clown", rarity: "epic", deckLimit: "unlimited" });
    assert.deepEqual(kinds([faction, flagged]), [], "control: one copy is fine");
    assert.deepEqual(kinds([faction, ...times(flagged, 3)]), ["epicCopyLimit"]);
  });

  rule("EP 2", "the limit is only for epic cards: a non-epic card keeps its normal limit beside an epic card", () => {
    assert.deepEqual(kinds([faction, epic, ...times(common, 4)]), []);
    assert.deepEqual(kinds([faction, epic, ...times(common, 5)]), ["copyLimit"], "the fifth common copy breaks the ordinary limit");
  });
});

describe("EP 3 - no epic cards in Limited", () => {
  rule("EP 3", "an epic card in a Limited deck is not allowed, while the same deck is fine in Constructed", () => {
    const deck = [faction, epic, ...times(common, 3)];
    const issues = issuesOf(deck, { play: "limited" });
    assert.deepEqual(issues.map(i => i.kind), ["epicInLimited"]);
    assert.equal(issues[0]!.cardId, epic.id);
    assert.deepEqual(kinds(deck), [], "control: Constructed allows it");
    assert.deepEqual(kinds(deck, { play: "constructed" }), []);
  });

  rule("EP 3", "a Limited deck with no epic card has no epic issue", () => {
    assert.deepEqual(kinds([faction, ...times(common, 3)], { play: "limited" }), []);
  });

  rule("EP 3", "several copies of an epic card in Limited are reported once for the card", () => {
    assert.deepEqual(kinds([faction, ...times(epic, 3)], { play: "limited" }), ["epicInLimited"]);
  });

  rule("EP 3", "an epic faction card is not allowed in Limited either", () => {
    const epicFaction = factionCard({ name: "Epic Faction", rarity: "e-sle" });
    const issues = issuesOf([epicFaction, common], { play: "limited" });
    assert.deepEqual(issues.map(i => i.kind), ["epicInLimited"]);
    assert.equal(issues[0]!.cardId, epicFaction.id);
    assert.deepEqual(kinds([epicFaction, common]), [], "control: Constructed allows it");
  });
});

describe("EP 4 - no epic cards in tournament play unless it is an epic tournament", () => {
  rule("EP 4", "a tournament that is not an epic tournament does not allow an epic card (whether epic is absent or false)", () => {
    for (const tournament of [{}, { epic: false }]) {
      const issues = issuesOf([faction, epic, common], { tournament });
      assert.deepEqual(issues.map(i => i.kind), ["epicInTournament"], JSON.stringify(tournament));
      assert.equal(issues[0]!.cardId, epic.id);
    }
    const epicFaction = factionCard({ name: "Epic Faction", rarity: "e-sle" });
    assert.deepEqual(kinds([epicFaction, common], { tournament: {} }), ["epicInTournament"], "an epic faction card counts too");
  });

  rule("EP 4", "an epic tournament allows epic cards, though the 1-copy limit still holds", () => {
    assert.deepEqual(kinds([faction, epic, common], { tournament: { epic: true } }), []);
    assert.deepEqual(kinds([faction, ...times(epic, 2)], { tournament: { epic: true } }), ["epicCopyLimit"]);
  });

  rule("EP 4", "a deck without epic cards is fine in any tournament, and outside tournaments epic cards are allowed (casual play)", () => {
    assert.deepEqual(kinds([faction, ...times(common, 4)], { tournament: {} }), []);
    assert.deepEqual(kinds([faction, epic, common]), [], "no tournament: casual play");
  });

  rule(["EP 3", "EP 4"], "the Limited and tournament restrictions are independent and both apply to a Limited tournament deck", () => {
    assert.deepEqual(kinds([faction, epic], { play: "limited", tournament: {} }), ["epicInLimited", "epicInTournament"]);
    assert.deepEqual(kinds([faction, epic], { play: "limited", tournament: { epic: true } }), ["epicInLimited"], "an epic tournament does not lift the Limited ban");
  });
});
