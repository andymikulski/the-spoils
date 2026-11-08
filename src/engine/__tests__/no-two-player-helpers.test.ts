// A static guard (docs/MULTIPLAYER-PLAN.md, ground rule 3): the engine has no "the opponent" helper that assumes exactly
// two players. Every place that means "your opponent" says which one (`opponentOf` with the block's selection), every
// place that means "every opponent" iterates `getOpponents`, and every place that means a seat uses the seat helpers.
// The guard reads the engine's non-test sources and fails if a two-player shortcut reappears.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ENGINE_DIR = fileURLToPath(new URL("../", import.meta.url));

/** The engine's own sources: every `.ts` file under `src/engine` outside `__tests__`. */
const sources = readdirSync(ENGINE_DIR, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith(".ts"))
  .map(entry => ({ name: entry.name, text: readFileSync(`${ENGINE_DIR}${entry.name}`, "utf8") }));

/** Strips comments, so a sentence in a doc comment never trips (or hides) a code pattern. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, " ")).replace(/\/\/.*$/gm, "");
}

const FORBIDDEN: Array<{ name: string; pattern: RegExp; why: string }> = [
  {
    name: "getOpponent",
    pattern: /\bgetOpponent\b/,
    why: 'the "exactly one other player" helper: use opponentOf(controller, opponentId) for "your opponent" or getOpponents(player) for every opponent'
  },
  {
    name: "two-player assertion",
    pattern: /exactly two players/i,
    why: "the engine runs a game of any number of players"
  },
  {
    name: "find the one other player",
    pattern: /players\)\s*\.find\(\s*\(?(\w+)\)?\s*=>\s*\1\.id\s*!==/,
    why: "picks an arbitrary other player: select the block's opponent or iterate getOpponents"
  },
  {
    name: "destructure the two players",
    pattern: /const\s*\[\s*\w+\s*,\s*\w+\s*\]\s*=\s*Object\.(values|keys)\([^)]*players\)/,
    why: "assumes the table has exactly two players: use the seat helpers"
  },
  {
    name: "first or second player by index",
    pattern: /Object\.(values|keys)\([^)]*\.players\)\s*\[\s*[01]\s*\]/,
    why: "assumes which player is where: use getSeats / getPlayersInSeatOrder"
  }
];

describe("no two-player helper in the engine sources", () => {
  assert.ok(sources.some(source => source.name === "SpoilsEngine.ts"), "the guard found the engine sources");
  for (const { name, pattern, why } of FORBIDDEN) {
    test(`${name} does not appear (${why})`, () => {
      const hits = sources.filter(source => pattern.test(code(source.text))).map(source => source.name);
      assert.deepEqual(hits, [], `${name} found in: ${hits.join(", ")}`);
    });
  }

  test("the guard catches each pattern it forbids", () => {
    assert.ok(FORBIDDEN[0]!.pattern.test("this.getOpponent(playerId).id"));
    assert.ok(!FORBIDDEN[0]!.pattern.test("this.getOpponents(playerId)"));
    assert.ok(FORBIDDEN[2]!.pattern.test("Object.values(this.state.players).find(player => player.id !== playerId)"));
    assert.ok(!FORBIDDEN[2]!.pattern.test("Object.values(this.state.players).find(player => player.factionId === id)"));
    assert.ok(FORBIDDEN[3]!.pattern.test("const [first, second] = Object.values(this.state.players);"));
    assert.ok(FORBIDDEN[4]!.pattern.test("Object.values(state.players)[1]"));
  });
});
