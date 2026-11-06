import { describe, test } from "node:test";
import assert from "node:assert/strict";
import cardsJson from "../../data/cards.js";
import { findFactionDeckIssues, type CardDefinition, type FactionDefinition } from "../../engine.js";

const staple = (name: string): CardDefinition =>
  ({ id: `staple-${name}`, name, type: "resource", resource: { provides: [], staple: true } }) as unknown as CardDefinition;
const filler = { id: "filler", name: "Filler", type: "character" } as unknown as CardDefinition;

const faction = (startingResources: FactionDefinition["setup"]["startingResources"]): FactionDefinition =>
  ({ startingInfluence: 20, setup: { startingResources } }) as unknown as FactionDefinition;

describe("findFactionDeckIssues", () => {
  const distinct = faction({ count: 2, stapleOnly: true, distinctStaples: true });

  test("a deck with only one staple kind is flagged for a 2-different-staples faction", () => {
    const issues = findFactionDeckIssues(distinct, [staple("Rage"), staple("Rage"), staple("Rage"), filler], "Defenders of Marduun");
    assert.equal(issues.length, 1, "one issue");
    assert.match(issues[0], /Defenders of Marduun.*2 different staple.*only 1 kind/, "readable message names faction and counts");
  });

  test("a deck with no staples is flagged", () => {
    const issues = findFactionDeckIssues(distinct, [filler]);
    assert.equal(issues.length, 1, "one issue");
    assert.match(issues[0], /only 0 kinds/, "zero kinds reported");
  });

  test("two staple kinds satisfy the rule (kinds are case-insensitive by name)", () => {
    assert.deepEqual(findFactionDeckIssues(distinct, [staple("Rage"), staple("Greed"), filler]), [], "no issues");
    assert.equal(findFactionDeckIssues(distinct, [staple("Rage"), staple("rage")]).length, 1, "same name is one kind");
  });

  test("factions that allow repeats or have no staple rule never report issues", () => {
    assert.deepEqual(findFactionDeckIssues(faction({ count: 2, stapleOnly: true }), [staple("Rage")]), [], "plain staple faction");
    assert.deepEqual(findFactionDeckIssues(faction({ count: 2 }), [filler]), [], "no staple rule");
  });

  test("the real Defenders of Marduun faction flags a single-staple deck", () => {
    const defs = cardsJson as unknown as CardDefinition[];
    const def = defs.find((d) => d.name === "Defenders of Marduun" && d.faction);
    assert.ok(def?.faction, "Defenders of Marduun has faction data");
    assert.equal(findFactionDeckIssues(def.faction, [staple("Rage")], def.name).length, 1, "flagged with one kind");
    assert.deepEqual(findFactionDeckIssues(def.faction, [staple("Rage"), staple("Greed")], def.name), [], "ok with two");
  });
});
