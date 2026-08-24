// End-to-end proof that a real preconstructed-deck game can be played
// through the public engine surface (perform()/getFlowView()) from faction
// setup all the way to a winner — not just the individual rules unit tests
// elsewhere in this directory exercise in isolation.
//
// This is the engine's "ready to port to a UI/3D renderer" gate: if a full
// game between the two real precon decks (with their real, converted
// behaviors) can't be driven to completion — mulligans, develop, main-phase
// play, activated/triggered abilities, multi-round battles with response
// windows on both sides, and every kind of GameState.pendingChoice — through
// nothing but GameAction objects, the engine isn't done yet.
//
// The "player" is a generic policy bot (support/autoplay.ts) that never
// special-cases a card: it always asks the engine itself (via a
// simulate-on-a-clone probe, same pattern SpoilsEngine.canPayCosts uses
// internally) whether a candidate action is legal before committing to it.
// That's what makes this a test of the *engine*, not of a hand-scripted
// sequence of moves that happens to match today's card data.
//
// Every random element is seeded (see support/prng.ts) — deck shuffles, the
// engine's own dice-roll effects, and the bot's own decisions — so a run is
// exactly reproducible.

import { test } from "node:test";
import assert from "node:assert/strict";

import cardsJson from "../../data/cards.js";
import arcanistDeckIds from "../../data/decks/arcanist-ids.js";
import warlordDeckIds from "../../data/decks/warlord-ids.js";
import {
  type CardDefinition,
  type CardDefinitionId,
  type PlayerId,
  createTwoPlayerFactionGame
} from "../../engine.js";
import { mulberry32 } from "./support/prng.js";
import { playGameToCompletion, type AutoplayReport } from "./support/autoplay.js";

const CARD_CATALOG = cardsJson as CardDefinition[];

/** Trim the 2101-card catalog down to just what these two precons reference — the game only needs these, and it keeps every simulate-on-a-clone probe the bot runs cheap. */
function definitionsFor(...deckIdLists: CardDefinitionId[][]): CardDefinition[] {
  const needed = new Set(deckIdLists.flat());
  const byId = new Map(CARD_CATALOG.map(card => [card.id, card]));

  const definitions = [...needed].map(id => {
    const definition = byId.get(id);
    assert.ok(definition, `data/cards.json is missing referenced card '${id}'.`);
    return definition!;
  });

  assert.ok(definitions.length > 0, "No definitions resolved for the requested decks.");
  return definitions;
}

function playGame(seed: number, firstPlayerId: PlayerId): AutoplayReport {
  const definitions = definitionsFor(arcanistDeckIds, warlordDeckIds);

  const engine = createTwoPlayerFactionGame(
    definitions,
    { id: "arcanist", name: "Arcanist Player", deckDefinitionIds: arcanistDeckIds },
    { id: "warlord", name: "Warlord Player", deckDefinitionIds: warlordDeckIds },
    { firstPlayerId, random: mulberry32(seed) }
  );

  return playGameToCompletion(engine, { botRandom: mulberry32(seed ^ 0x5eed) });
}

test("full game: arcanist vs warlord precons play to completion through the public engine surface", () => {
  const report = playGame(1, "arcanist");

  assert.ok(
    report.winner === "arcanist" || report.winner === "warlord" || report.winner === "draw",
    `Expected a decided game, got winner=${String(report.winner)}`
  );

  // The interesting claim isn't just "a winner appeared" (see RULES.md §11) —
  // it's that every major subsystem was actually exercised along the way.
  assert.ok(report.turns >= 2, "Game ended implausibly early.");
  assert.ok(report.cardsPlayed > 10, `Expected substantial play, got ${report.cardsPlayed} cards played.`);
  assert.ok(report.attacksDeclared > 0, "No battles were ever declared.");
  assert.ok(report.resourcesPlayed > 0 || report.draws > 0, "Neither player ever developed.");
  assert.ok(
    report.totalResponses > 0,
    "No responses (tactics/abilities played into a response window) ever happened."
  );
  assert.ok(
    report.maxResponsesInWindow >= 2,
    `Expected at least one response window with multiple responses added to it ` +
      `(proves both sides can respond within the same battle/action window), got ${report.maxResponsesInWindow}.`
  );

  const pendingKinds = Object.keys(report.pendingChoicesResolved);
  assert.ok(
    pendingKinds.length > 0,
    "No GameState.pendingChoice of any kind was ever raised — player decision points weren't exercised."
  );

  console.log("full-game report (seed=1, arcanist first):", JSON.stringify(report, null, 2));
});

test("full game: same seed produces an identical outcome (deterministic RNG)", () => {
  const first = playGame(7, "warlord");
  const second = playGame(7, "warlord");

  assert.deepEqual(second, first, "Two runs with the same seed diverged — RNG isn't fully deterministic.");
});

test("full game: a different seed / starting player still reaches a winner", () => {
  const report = playGame(42, "warlord");

  assert.ok(
    report.winner === "arcanist" || report.winner === "warlord" || report.winner === "draw",
    `Expected a decided game, got winner=${String(report.winner)}`
  );
  assert.ok(report.cardsPlayed > 10, `Expected substantial play, got ${report.cardsPlayed} cards played.`);

  console.log("full-game report (seed=42, warlord first):", JSON.stringify(report, null, 2));
});

test("full game: a broad seed sweep always reaches a winner (shakes out rare edge cases)", () => {
  const seeds = [2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377];
  const failures: string[] = [];

  for (const seed of seeds) {
    const firstPlayerId: PlayerId = seed % 2 === 0 ? "arcanist" : "warlord";
    try {
      const report = playGame(seed, firstPlayerId);
      if (report.winner !== "arcanist" && report.winner !== "warlord" && report.winner !== "draw") {
        failures.push(`seed ${seed}: no decided winner (got ${String(report.winner)})`);
      }
    } catch (err) {
      failures.push(`seed ${seed}: ${(err as Error).message}`);
    }
  }

  assert.deepEqual(failures, [], `${failures.length}/${seeds.length} seeds failed:\n${failures.join("\n")}`);
});
