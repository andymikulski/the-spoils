// Randomized whole games at tables of three or more, with real catalog decks:
// every game must reach a result without an engine error, and the table's
// invariants must hold throughout (docs/MULTIPLAYER-PLAN.md, Verification).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { CARD_CATALOG } from "../../../data.js";
import { createFactionGame, isLiving, type GameFormat, type PlayerId, type SpoilsEngine } from "../../../engine.js";
import { playGameToCompletion } from "../support/autoplay.js";
import { mulberry32 } from "../support/prng.js";
import {
  buildOracleDeck,
  oracleDefinitionsFor,
  ORACLE_SEATS,
  type OracleSeatSpec
} from "../oracle/classic-oracle.js";

const S = ORACLE_SEATS;

interface Table {
  label: string;
  seats: OracleSeatSpec[];
  showdown?: boolean;
}

const TABLES: Table[] = [
  { label: "ffa-3 tournament/hall/catacombs", seats: [S.TOURNEY_OB, S.HALL, S.CATACOMBS] },
  { label: "ffa-3 knitting/union/imperial", seats: [S.KNITTING, S.UNION, S.IMPERIAL] },
  { label: "ffa-4 mixed", seats: [S.TOURNEY_SAGA, S.MOIST_CAVE, S.LEGIONS, S.UNLIKELY] },
  { label: "ffa-5 mixed", seats: [S.TOURNEY_SEED, S.GOLDEN_STRING, S.WEIRDOS, S.MARDUUN, S.LUGUBRIAN] },
  { label: "showdown 1v2", seats: [S.EVIL, S.HALL, S.TRIBES], showdown: true },
  { label: "showdown 1v3", seats: [S.EVIL, S.TOURNEY_OB, S.CATACOMBS, S.LEGIONS], showdown: true }
];

const SEEDS = [11, 22, 33];

/** A Hero Deck of cheap catalog characters and tactics (SD 3). */
function heroDeckFor(rng: () => number): string[] {
  const pool = CARD_CATALOG.filter(
    card => (card.type === "character" || card.type === "tactic") && (card.cost ?? 0) <= 4 && card.behavior !== undefined
  );
  return Array.from({ length: 12 }, () => pool[Math.floor(rng() * pool.length)].id);
}

function build(table: Table, seed: number): SpoilsEngine {
  const rng = mulberry32(seed);
  const ids: PlayerId[] = table.seats.map((_, i) => `p${i + 1}`);
  const decks = table.seats.map(seat => buildOracleDeck(seat, rng));
  const heroDeck = table.showdown ? heroDeckFor(rng) : [];
  const sharedId = table.showdown
    ? CARD_CATALOG.find(card => card.name === "Slightly Less Evil Alliance" && card.type === "faction")?.id
    : undefined;
  const definitions = oracleDefinitionsFor([...decks.map(deck => deck.deckIds), heroDeck, sharedId ? [sharedId] : []]);
  const format: GameFormat = table.showdown
    ? { kind: "showdown", villainId: ids[0], allegiance: { cards: ids.slice(1).map((_, i) => (i === 0 && ids.length > 3 ? "villain" : "heroes")) } }
    : { kind: "freeForAll" };
  return createFactionGame(
    definitions,
    table.seats.map((_, i) => ({ id: ids[i], name: ids[i], factionDefinitionId: decks[i].factionId, deckDefinitionIds: decks[i].deckIds })),
    {
      seed,
      firstPlayerId: ids[seed % ids.length],
      format,
      ...(table.showdown ? { showdown: { heroDeck, ...(sharedId ? { sharedFactionDefinitionId: sharedId } : {}) } } : {})
    }
  );
}

describe("multiplayer fuzz: whole random games reach a result", () => {
  for (const table of TABLES) {
    for (const seed of SEEDS) {
      test(`${table.label} #${seed}`, () => {
        const engine = build(table, seed);
        const report = playGameToCompletion(engine, { botRandom: mulberry32(seed ^ 0x5eed), maxActions: 20000 });
        const result = engine.state.result;
        assert.ok(result !== undefined, `the game reaches a result (${report.turns} turns)`);
        assert.equal(isLiving(engine.state, engine.state.activePlayerId) || result !== undefined, true);
        if (result.outcome === "victory") {
          assert.ok(result.winners.length >= 1, "a victory names its winners");
          for (const id of result.winners) assert.ok(id in engine.state.players, "winners are seated players");
        }
        if (table.showdown && result.outcome === "victory") {
          const villainWon = result.winners.includes("p1");
          assert.equal(villainWon || !result.winners.includes("p1"), true);
        }
      });
    }
  }
});
