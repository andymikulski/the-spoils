// GameState.rngState makes the engine's single RNG stream (deck shuffles,
// coin flips, `{type:"random"}` expressions/targets) a first-class,
// serializable part of the game rather than a side channel:
//   - createTwoPlayerFactionGame's `seed` option seeds one continuous stream
//     that both faction setup *and* subsequent real gameplay draw from.
//   - a dry-run legality/affordability probe (canPayCosts's simulate-on-a-
//     clone pattern) must never advance the real game's stream.
//   - saving/cloning GameState and resuming a fresh engine from it continues
//     the exact same random sequence.
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { createTwoPlayerFactionGame, randomSeed, SpoilsEngine } from "../../engine.js";
import {
  buildGame,
  character,
  defaultFactionDefinition,
  factionCard,
  P1,
  P2,
  resolvePendingResponses
} from "./support/fixtures.js";

const FILLER = character({ name: "Filler", life: 2 });

/** A faction whose own card can flip a "coin" (a random counter in [1, 1e6]) on demand, with no mulligan so setup completes straight into turn 1's develop step. */
const COIN_FLIP_FACTION = factionCard({
  name: "Flippers",
  faction: defaultFactionDefinition(),
  behavior: {
    abilities: [
      {
        id: "flip",
        type: "activated",
        costs: [],
        effects: [
          {
            type: "addCounter",
            target: "source",
            counter: "flip",
            amount: { type: "random", min: 1, max: 1_000_000 }
          }
        ]
      }
    ]
  }
});

function deckOf(count: number) {
  return Array.from({ length: count }, () => FILLER.id);
}

/**
 * Card ids are minted from a global, ever-increasing counter (`nextId`), so
 * two separately-built engines never share raw id values even with an
 * identical seed. Cards within one player's deck *are* a contiguous id
 * range in creation order though, so sorting recovers that pre-shuffle
 * order — letting us compare the shuffle permutation itself instead of the
 * (meaningless, counter-offset-dependent) raw ids.
 */
function shufflePattern(deck: string[]): number[] {
  const byCreationOrder = (id: string) => Number(id.slice(id.lastIndexOf("_") + 1));
  const sorted = [...deck].sort((a, b) => byCreationOrder(a) - byCreationOrder(b));
  return deck.map(id => sorted.indexOf(id));
}

/** Builds a game with the given seed and flips the faction's own coin once, returning the roll. */
function seededCoinFlip(seed: number): number {
  const engine = createTwoPlayerFactionGame(
    [COIN_FLIP_FACTION, FILLER],
    { id: P1, name: "Alice", factionDefinitionId: COIN_FLIP_FACTION.id, deckDefinitionIds: deckOf(10) },
    { id: P2, name: "Bob", factionDefinitionId: COIN_FLIP_FACTION.id, deckDefinitionIds: deckOf(10) },
    { firstPlayerId: P1, seed }
  );

  // No mulligan configured, so setup completed straight into turn 1/develop.
  engine.perform({ type: "chooseDevelop", playerId: P1, choice: { type: "draw" } });

  const factionId = engine.state.players[P1].factionId!;
  engine.perform({ type: "activateAbility", playerId: P1, cardId: factionId, abilityId: "flip" });
  resolvePendingResponses(engine);

  return engine.state.cards[factionId].counters.flip;
}

describe("seeded RNG (GameState.rngState)", () => {
  test("createTwoPlayerFactionGame's seed determines deck shuffle order", () => {
    const a = createTwoPlayerFactionGame(
      [COIN_FLIP_FACTION, FILLER],
      { id: P1, name: "Alice", factionDefinitionId: COIN_FLIP_FACTION.id, deckDefinitionIds: deckOf(10) },
      { id: P2, name: "Bob", factionDefinitionId: COIN_FLIP_FACTION.id, deckDefinitionIds: deckOf(10) },
      { firstPlayerId: P1, seed: 12345 }
    );
    const b = createTwoPlayerFactionGame(
      [COIN_FLIP_FACTION, FILLER],
      { id: P1, name: "Alice", factionDefinitionId: COIN_FLIP_FACTION.id, deckDefinitionIds: deckOf(10) },
      { id: P2, name: "Bob", factionDefinitionId: COIN_FLIP_FACTION.id, deckDefinitionIds: deckOf(10) },
      { firstPlayerId: P1, seed: 12345 }
    );

    assert.deepEqual(shufflePattern(a.state.players[P1].deck), shufflePattern(b.state.players[P1].deck));
    assert.deepEqual(shufflePattern(a.state.players[P2].deck), shufflePattern(b.state.players[P2].deck));
  });

  test("the same seed produces the same in-game coin flip, through the real gameplay path (not just setup)", () => {
    // Before the fix, createTwoPlayerFactionGame seeded only the setup-time
    // shuffle; the engine constructed underneath it fell back to raw
    // Math.random for everything else, so this would be flaky.
    assert.equal(seededCoinFlip(777), seededCoinFlip(777));
  });

  test("a freshly built game always carries a usable rngState, even without an explicit seed", () => {
    const engine = createTwoPlayerFactionGame(
      [COIN_FLIP_FACTION, FILLER],
      { id: P1, name: "Alice", factionDefinitionId: COIN_FLIP_FACTION.id, deckDefinitionIds: deckOf(10) },
      { id: P2, name: "Bob", factionDefinitionId: COIN_FLIP_FACTION.id, deckDefinitionIds: deckOf(10) }
    );

    assert.equal(typeof engine.state.rngState, "number");
  });

  test("dry-run legality/affordability checks never advance the real game's rngState", () => {
    const RANDOM_COST_CHAR = character({
      name: "Expensive Gambit",
      behavior: {
        abilities: [
          {
            id: "gambit",
            type: "activated",
            costs: [{ type: "payResources", amount: { type: "random", min: 1, max: 1_000_000 } }],
            effects: []
          }
        ]
      }
    });

    const { engine } = buildGame({
      cards: [{ key: "gambit", def: RANDOM_COST_CHAR, owner: P1, zone: "play" }]
    });

    const before = engine.state.rngState;

    // getAvailableActivatedAbilities runs canPayCosts (which evaluates the
    // random cost amount) against a structuredClone probe for every
    // activated ability in play — repeatedly, since a UI/bot would poll it.
    for (let i = 0; i < 5; i++) {
      engine.getAvailableActivatedAbilities(P1);
    }

    assert.equal(engine.state.rngState, before, "A dry-run probe must not consume the real engine's RNG draws.");
  });

  test("cloning GameState (save) and resuming a fresh engine from it continues the same random sequence", () => {
    const live = createTwoPlayerFactionGame(
      [COIN_FLIP_FACTION, FILLER],
      { id: P1, name: "Alice", factionDefinitionId: COIN_FLIP_FACTION.id, deckDefinitionIds: deckOf(10) },
      { id: P2, name: "Bob", factionDefinitionId: COIN_FLIP_FACTION.id, deckDefinitionIds: deckOf(10) },
      { firstPlayerId: P1, seed: 99 }
    );
    live.perform({ type: "chooseDevelop", playerId: P1, choice: { type: "draw" } });

    // Simulate "save game" then "load it into two independent sessions".
    const saved = structuredClone(live.state);
    const resumedA = new SpoilsEngine(Object.values(live.definitions), structuredClone(saved));
    const resumedB = new SpoilsEngine(Object.values(live.definitions), structuredClone(saved));

    const factionId = resumedA.state.players[P1].factionId!;
    assert.equal(factionId, resumedB.state.players[P1].factionId);

    resumedA.perform({ type: "activateAbility", playerId: P1, cardId: factionId, abilityId: "flip" });
    resolvePendingResponses(resumedA);

    resumedB.perform({ type: "activateAbility", playerId: P1, cardId: factionId, abilityId: "flip" });
    resolvePendingResponses(resumedB);

    assert.equal(
      resumedA.state.cards[factionId].counters.flip,
      resumedB.state.cards[factionId].counters.flip
    );
  });

  test("randomSeed() produces a plain, differing 32-bit-range value each call", () => {
    const seeds = new Set(Array.from({ length: 20 }, () => randomSeed()));

    for (const seed of seeds) {
      assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff);
    }
    // 20 draws colliding would indicate the generator isn't actually random.
    assert.ok(seeds.size > 1);
  });
});
