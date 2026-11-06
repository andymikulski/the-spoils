// A. the log-only `deckShuffled` event (once per in-play shuffle, never at setup, no effect on the game);
// B. getPlayerEffects: effects that apply to a whole player (cost / threshold reductions, resource grants, runtime play
//    bans, player keyword grants, skipped Restore Rules, draw modifiers, preventsDefeat, emptyDeckLoses).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTwoPlayerFactionGame } from "../../engine.js";
import {
  banks,
  buildGame,
  character,
  developFaction,
  play,
  resolvePendingResponses,
  P1,
  P2
} from "./per-card/_harness.js";
import { activate } from "./per-card/_harness.js";
import { declineAll, drain, printing } from "./clauses/_clause.js";
import { character as fxCharacter, defaultFactionDefinition, factionCard } from "./support/fixtures.js";

const KEEN_STRATAGEM = "210c93ab-9cc2-45a8-9e8e-0aec15e38f54";
const I_GOT_THE_GEAR = "97a5cad1-4663-414c-b230-9348968f6fb1";
const LEET_1337 = "64b33dfe-3811-4466-a7b4-5ffa7a680687";
const LEET_31337 = "b7d1ede1-afad-43f3-bc68-66d3d5c523b1";
const CLOCKMAN = "0146d330-33ea-4847-8d52-25810a946e40";
const HASTY_PURSUIT = "8f8af0b4-2e83-48e5-9c84-4fdcecfbbbd1";
const BEATRIX = "d584c808-1bc9-43c7-b67d-d8e00d00e1f4";
const ARMORED_KEEP = "fb95db39-dc7b-404d-9c2d-4aeaa4f079ee";
const TRICKSTERS_GLOBE = "c47c8579-7fdc-49e7-b934-f3e86c37dc13";
const MONSTROUS_LASSITUDE = "99ed6205-1f9e-4d62-a1ae-f9038449db17";
const TACTICIAN_VACATION = "f5b4db56-d972-48de-b1b5-7f16b7d427aa";

const turnGame = (cards: unknown[], extra: Record<string, unknown> = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: cards as never,
    ...extra
  });

/** A small deterministic PRNG so two runs draw the same numbers. */
function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const shuffles = (engine: { state: { gameLog: Array<{ message: string; event?: { type: string; playerId?: string } }> } }) =>
  engine.state.gameLog.filter(e => e.event?.type === "deckShuffled");

// ---------------------------------------------------------------------------
// A. deckShuffled
// ---------------------------------------------------------------------------

describe("deckShuffled (log-only)", () => {
  const stapleDeck = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      key: `s${i}`,
      def: character({ name: `Filler${i}` }),
      owner: P1,
      zone: "deck" as const
    }));

  function stratagemGame(random: () => number) {
    return turnGame(
      [
        { key: "ks", def: printing(KEEN_STRATAGEM), owner: P1, zone: "hand" },
        ...banks(2, P1),
        ...stapleDeck(6)
      ],
      { random }
    );
  }

  test("a search-then-shuffle emits exactly one event, for the searcher", () => {
    const g = stratagemGame(mulberry(1));
    play(g.engine, P1, g.id("ks"), {});
    drain(g.engine, declineAll);
    const found = shuffles(g.engine);
    assert.equal(found.length, 1);
    assert.equal((found[0].event as { playerId: string }).playerId, P1);
    assert.match(found[0].message, /shuffles their deck/);
  });

  test("not emitted for the game-setup shuffles", () => {
    const filler = fxCharacter({ name: "Filler", life: 2 });
    const faction = factionCard({ name: "Plain", faction: defaultFactionDefinition() });
    const engine = createTwoPlayerFactionGame(
      [faction, filler],
      { id: P1, name: "Alice", factionDefinitionId: faction.id, deckDefinitionIds: Array(10).fill(filler.id) },
      { id: P2, name: "Bob", factionDefinitionId: faction.id, deckDefinitionIds: Array(10).fill(filler.id) },
      { firstPlayerId: P1, seed: 99 }
    );
    assert.equal(shuffles(engine).length, 0);
  });

  test("log-only: the game is identical (state, RNG, deck order) with the log on or off", () => {
    const run = (log: boolean) => {
      const g = turnGame(
        [
          { key: "ks", def: printing(KEEN_STRATAGEM), owner: P1, zone: "hand" },
          { key: "gear", def: printing(I_GOT_THE_GEAR), owner: P1, zone: "hand" },
          ...banks(3, P1),
          ...stapleDeck(8)
        ],
        { random: mulberry(7) }
      );
      g.engine.setLogEnabled(log);
      play(g.engine, P1, g.id("ks"), {});
      drain(g.engine, pc => (pc.kind === "chooserSelectsTarget" ? declineAll(pc) : declineAll(pc)));
      play(g.engine, P1, g.id("gear"), {});
      drain(g.engine, declineAll);
      // Ids come from a process-wide counter, so compare by card name per zone (deck ORDER included).
      const st = g.engine.state;
      const named = (ids: string[]) => ids.map(id => g.engine.getDefinition(id).name);
      const state = {
        turn: st.turn,
        players: Object.fromEntries(
          Object.entries(st.players).map(([pid, pl]) => [
            pid,
            { deck: named(pl.deck), hand: named(pl.hand), discard: named(pl.discard), influence: pl.influence }
          ])
        )
      };
      return { state, shuffled: shuffles(g.engine).length };
    };
    const on = run(true);
    const off = run(false);
    assert.deepEqual(on.state, off.state);
    assert.equal(off.shuffled, 0, "log off: nothing recorded");
  });
});

// ---------------------------------------------------------------------------
// B. getPlayerEffects
// ---------------------------------------------------------------------------

describe("getPlayerEffects", () => {
  test("empty on a plain board", () => {
    const g = turnGame([...banks(1, P1)]);
    assert.deepEqual(g.engine.getPlayerEffects(P1), []);
    assert.deepEqual(g.engine.getPlayerEffects(P2), []);
  });

  test("1337!: a pending cost reduction, and it vanishes once spent", () => {
    const g = turnGame([
      { key: "leet", def: printing(LEET_1337), owner: P1, zone: "hand" },
      { key: "c", def: character({ name: "Pricey", cost: 2 }), owner: P1, zone: "hand" },
      { key: "d", def: character({ name: "Deck" }), owner: P1, zone: "deck" },
      ...banks(3, P1)
    ]);
    play(g.engine, P1, g.id("leet"), {});
    drain(g.engine, pc => (pc.kind === "chooseNumber" ? { kind: "chooseNumber", value: 2 } : declineAll(pc)));
    const [e] = g.engine.getPlayerEffects(P1);
    assert.equal(e.kind, "costReduction");
    assert.equal(e.amount, 2);
    assert.equal(e.playerId, P1);
    assert.equal(e.duration, "nextTime");
    assert.deepEqual(g.engine.getPlayerEffects(P2), []);
    play(g.engine, P1, g.id("c"), {});
    assert.deepEqual(g.engine.getPlayerEffects(P1), []);
  });

  test("31337!: phantom resource icons this turn", () => {
    const g = turnGame([{ key: "l", def: printing(LEET_31337), owner: P1, zone: "hand" }, ...banks(3, P1)]);
    play(g.engine, P1, g.id("l"), {});
    const grants = g.engine.getPlayerEffects(P1).filter(e => e.kind === "resourceGrant");
    assert.equal(grants.length, 1);
    assert.equal(grants[0].amount, 4);
    assert.equal(grants[0].icon, "elitism");
    assert.equal(grants[0].duration, "thisTurn");
  });

  test("Clockman Skydocks: a persistent threshold reduction", () => {
    const g = turnGame([
      { key: "cs", def: printing(CLOCKMAN), owner: P1, zone: "play" },
      ...banks(2, P1)
    ]);
    activate(g.engine, P1, g.id("cs"), "cs-bday");
    drain(g.engine, pc => (pc.kind === "nameValue" ? { kind: "nameValue", value: "rage" } : declineAll(pc)));
    const [e] = g.engine.getPlayerEffects(P1);
    assert.equal(e.kind, "thresholdReduction");
    assert.equal(e.icon, "rage");
    assert.equal(e.amount, 1);
    assert.equal(e.duration, "untilSpent");
  });

  test("Tactician Vacation: a runtime play ban with its source", () => {
    const g = turnGame([
      { key: "tv", def: printing(TACTICIAN_VACATION), owner: P1, zone: "hand" },
      ...banks(4, P1)
    ]);
    play(g.engine, P1, g.id("tv"), {});
    const bans = g.engine.getPlayerEffects(P1).filter(e => e.kind === "playRestriction");
    assert.ok(bans.length >= 1);
    assert.equal(bans[0].cardType, "tactic");
    assert.equal(bans[0].sourceId, g.id("tv"));
    assert.equal(bans[0].duration, "thisTurn");
    assert.match(bans[0].text, /cannot play tactic/);
  });

  test("Hasty Pursuit: a player-wide keyword grant", () => {
    const g = turnGame([
      { key: "hp", def: printing(HASTY_PURSUIT), owner: P1, zone: "hand" },
      ...banks(3, P1)
    ]);
    play(g.engine, P1, g.id("hp"), {});
    const [e] = g.engine.getPlayerEffects(P1);
    assert.equal(e.kind, "keywordGrant");
    assert.equal(e.keyword, "aggro");
    assert.equal(e.sourceId, g.id("hp"));
  });

  test("Monstrous Lassitude: a skipped Restore Rule", () => {
    const g = turnGame([
      { key: "ml", def: printing(MONSTROUS_LASSITUDE), owner: P1, zone: "hand" },
      ...banks(3, P1)
    ]);
    play(g.engine, P1, g.id("ml"), {});
    const skip = g.engine.getPlayerEffects(P1).find(e => e.kind === "restoreRuleSkip");
    assert.ok(skip);
    assert.equal(typeof skip.untilTurn, "number");
    assert.equal(g.engine.getPlayerEffects(P2).length, 0);
  });

  test("in-play continuous: Beatrix (draw +1), Armored Keep, Trickster's Globe (both players)", () => {
    const g = turnGame([
      { key: "bea", def: printing(BEATRIX), owner: P1, zone: "play" },
      { key: "keep", def: printing(ARMORED_KEEP), owner: P1, zone: "play" },
      { key: "globe", def: printing(TRICKSTERS_GLOBE), owner: P1, zone: "play" }
    ]);
    const mine = g.engine.getPlayerEffects(P1);
    const draw = mine.find(e => e.kind === "drawModifier");
    assert.equal(draw?.amount, 1);
    assert.equal(draw?.sourceId, g.id("bea"));
    assert.equal(draw?.duration, "whileSourceInPlay");
    assert.ok(mine.some(e => e.kind === "preventsDefeat" && e.sourceId === g.id("keep")));
    assert.ok(mine.some(e => e.kind === "emptyDeckLoses" && e.sourceId === g.id("globe")));

    const theirs = g.engine.getPlayerEffects(P2).map(e => e.kind);
    assert.deepEqual(theirs, ["emptyDeckLoses"], "only the all-player rule reaches the opponent");
  });

  test("a face-down source stays hidden", () => {
    const g = turnGame([{ key: "keep", def: printing(ARMORED_KEEP), owner: P1, zone: "play", faceDown: true }]);
    assert.deepEqual(g.engine.getPlayerEffects(P1), [], "face-down: its text is off");
  });
});

void resolvePendingResponses;
