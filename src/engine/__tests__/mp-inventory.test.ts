// Gate for the multiplayer inventory (docs/TESTING.md, "Multiplayer inventory"):
// data/card-tests/mp-inventory.{json,md} are regenerated in memory and compared,
// so they can never go stale against the catalog or the clause manifest, and the
// inventory joins 1:1 with data/card-tests/clauses.json.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CATALOG, buildRulesGroups, type RulesGroup } from "./clauses/_manifest.js";
import { PLAYER_FIELDS, buildMpInventory, clauseTextCheck, findPhrases, renderMpSummary } from "./clauses/_mpInventory.js";

const DATA = fileURLToPath(new URL("../../../data/card-tests/", import.meta.url));
const read = (name: string): string => readFileSync(DATA + name, "utf8").replace(/\r\n/g, "\n");

const inventory = buildMpInventory();

describe("multiplayer inventory", () => {
  test("data/card-tests/mp-inventory.json is current (run `npm run card-tests -- mp-inventory`)", () => {
    const expected = JSON.stringify(inventory, null, 2) + "\n";
    assert.ok(expected === read("mp-inventory.json"), "mp-inventory.json is stale: run `npm run card-tests -- mp-inventory`");
  });

  test("data/card-tests/mp-inventory.md is current (run `npm run card-tests -- mp-inventory`)", () => {
    assert.ok(renderMpSummary(inventory) === read("mp-inventory.md"), "mp-inventory.md is stale: run `npm run card-tests -- mp-inventory`");
  });

  test("joins 1:1 with data/card-tests/clauses.json by (printing id, clause key)", () => {
    const manifest = JSON.parse(read("clauses.json")) as RulesGroup[];
    assert.deepEqual(
      inventory.map((group) => ({ id: group.id, printings: group.printings, batch: group.batch, keys: group.clauses.map((clause) => clause.key) })),
      manifest.map((group) => ({ id: group.id, printings: group.printings, batch: group.batch, keys: group.clauses.map((clause) => clause.key) }))
    );
  });

  test("phrases are scanned in exactly the clause text the manifest records", () => {
    assert.deepEqual(clauseTextCheck(buildRulesGroups()), []);
  });

  test("every player word in the behavior data sits in a field the inventory reads", () => {
    const unread: string[] = [];
    const walk = (value: unknown, path: string, key: string) => {
      if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${path}[${index}]`, key));
      else if (value && typeof value === "object") for (const [k, child] of Object.entries(value)) walk(child, `${path}.${k}`, k);
      else if ((value === "opponent" || value === "anyPlayer" || value === "activePlayer") && !PLAYER_FIELDS.has(key)) unread.push(`${path} = ${String(value)}`);
    };
    for (const card of CATALOG) walk({ behavior: card.behavior, faction: card.faction, flipUp: card.flipUp }, card.name, "");
    assert.deepEqual(unread, [], "add the field to PLAYER_FIELDS in clauses/_mpInventory.ts");
  });

  test("the phrase matcher categorizes each player phrase", () => {
    const cats = (text: string) => findPhrases(text).map((p) => `${p.category}:${p.text}`);
    assert.deepEqual(cats("Your opponent's turn. Your opponent draws."), ["yourOpponent:Your opponent's", "yourOpponent:Your opponent"]);
    assert.deepEqual(cats("An opponent's character; an opponent picks."), ["anOpponent:An opponent's", "anOpponent:an opponent"]);
    assert.deepEqual(cats("Each opponent, your opponents, all opponents, each of your opponents, your opponents' decks."), [
      "eachOpponent:Each opponent",
      "eachOpponent:your opponents",
      "eachOpponent:all opponents",
      "eachOpponent:each of your opponents",
      "eachOpponent:your opponents'"
    ]);
    assert.deepEqual(cats("Both players draw. Each player, all players, every player's hand."), [
      "bothPlayers:Both players",
      "eachPlayer:Each player",
      "eachPlayer:all players",
      "eachPlayer:every player's"
    ]);
    assert.deepEqual(cats("Any player or a player; another player, the other player, other players."), [
      "anyPlayer:Any player",
      "anyPlayer:a player",
      "anotherPlayer:another player",
      "anotherPlayer:the other player",
      "anotherPlayer:other players"
    ]);
    assert.deepEqual(cats("The active player switches seats. Each other player, each of you, either deck."), [
      "activePlayer:The active player",
      "seat:seats",
      "eachOtherPlayer:Each other player",
      "eachOfYou:each of you",
      "eitherDeck:either deck"
    ]);
    assert.deepEqual(cats("Terminate the opponent's card, that opponent's, their opponent, any opponent."), [
      "opponentBare:opponent's",
      "thatOpponent:that opponent's",
      "theirOpponent:their opponent",
      "anyOpponent:any opponent"
    ]);
    assert.deepEqual(cats("The ’Opponent’ and your opponent’s card."), ["opponentBare:Opponent", "yourOpponent:your opponent’s"]);
    assert.deepEqual(cats("EXIT STAGE RIGHT: nothing here, and the opposing party."), []);
  });

  test("reminder text is flagged, not dropped", () => {
    const text = "Draw a card. (Your opponent does not.) Your opponent discards.";
    const start = text.indexOf("(");
    const phrases = findPhrases(text, [[start, text.indexOf(")") + 1]]);
    assert.deepEqual(
      phrases.map((phrase) => [phrase.category, phrase.reminder === true]),
      [
        ["yourOpponent", true],
        ["yourOpponent", false]
      ]
    );
  });
});
