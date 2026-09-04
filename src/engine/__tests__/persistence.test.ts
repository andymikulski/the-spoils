// Save/load: SpoilsEngine.state is already plain, JSON-serializable data
// (see GameState.rngState's doc comment) — these tests cover the save/load
// wrapper itself (saveGame/loadGame/getSaveSummary, the format-version
// envelope) and GameState.idSeq, the persisted id counter that makes minting
// new ids after a reload safe (see GameState.idSeq's doc comment).
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  CURRENT_SAVE_FORMAT_VERSION,
  getSaveSummary,
  loadGame,
  saveGame,
  SpoilsEngine
} from "../../engine.js";
import type { SerializedGame } from "../../engine.js";
import {
  buildGame,
  character,
  P1,
  P2,
  resolvePendingResponses,
  tactic
} from "./support/fixtures.js";
/** The static card catalog `engine` was built from — excludes any `token-def_*` definitions a `createTokens` effect synthesized at runtime, which a real caller's catalog (e.g. `CARD_CATALOG`) would never contain either. */
function staticCatalogOf(engine: SpoilsEngine) {
  return Object.values(engine.definitions).filter(def => !def.id.startsWith("token-def_"));
}

/** A character whose activated ability puts a fresh token character into play — mints a new CardInstanceId each use. */
const TOKEN_MAKER = character({
  name: "Token Maker",
  behavior: {
    abilities: [
      {
        id: "mk",
        type: "activated",
        costs: [],
        effects: [
          {
            type: "createTokens",
            controller: "controller",
            count: 1,
            token: { name: "Blip", cardType: "character", strength: 1, life: 1 }
          }
        ]
      }
    ]
  }
});

describe("saveGame / loadGame", () => {
  test("round-trips a fresh game through JSON losslessly", () => {
    const { engine } = buildGame({
      cards: [{ key: "front", def: character({ name: "Front Line" }), owner: P1 }]
    });

    const save = saveGame(engine);
    assert.equal(save.formatVersion, CURRENT_SAVE_FORMAT_VERSION);

    // Prove it's actually JSON-safe, not merely structuredClone-safe.
    const roundTripped: SerializedGame = JSON.parse(JSON.stringify(save));
    const restored = loadGame(roundTripped, Object.values(engine.definitions));

    assert.deepEqual(restored.state, JSON.parse(JSON.stringify(engine.state)));
  });

  test("round-trips mid-resolution state — an open response window and its stack item", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "maker", def: TOKEN_MAKER, owner: P1 }]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("maker"),
      abilityId: "mk"
    });

    // Left mid-flight on purpose: the response window is open, nothing has
    // resolved yet, and the token doesn't exist in `state.cards` yet either.
    assert.ok(engine.state.responseWindow);
    assert.equal(engine.state.responseStack.length, 1);
    const tokenCountBefore = Object.values(engine.state.cards).filter(
      c => c.definitionId.startsWith("token-def_")
    ).length;
    assert.equal(tokenCountBefore, 0);

    const save: SerializedGame = JSON.parse(JSON.stringify(saveGame(engine)));
    const restored = loadGame(save, staticCatalogOf(engine));

    assert.deepEqual(restored.state.responseWindow, engine.state.responseWindow);
    assert.deepEqual(restored.state.responseStack, engine.state.responseStack);

    // The resumed game can still finish resolving the in-flight ability.
    resolvePendingResponses(restored);
    const tokenCountAfter = Object.values(restored.state.cards).filter(
      c => c.definitionId.startsWith("token-def_")
    ).length;
    assert.equal(tokenCountAfter, 1);
  });

  test("carries a token permanent's runtime-synthesized definition, so loadGame works against only the static catalog", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "maker", def: TOKEN_MAKER, owner: P1 }]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("maker"),
      abilityId: "mk"
    });
    resolvePendingResponses(engine);

    const save = saveGame(engine);
    assert.equal(save.runtimeDefinitions?.length, 1);
    assert.equal(save.runtimeDefinitions?.[0].name, "Blip");

    // The static catalog alone (no token-def_* entry) would fail without
    // `runtimeDefinitions` — loadGame must merge the two automatically.
    const restored = loadGame(
      JSON.parse(JSON.stringify(save)),
      staticCatalogOf(engine)
    );
    const token = Object.values(restored.state.cards).find(c => c.isToken);
    assert.equal(restored.getDefinition(token!.id).name, "Blip");
  });

  test("a fresh id minted after loading a save continues past every id already in it, never colliding", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "maker", def: TOKEN_MAKER, owner: P1 }]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("maker"),
      abilityId: "mk"
    });
    resolvePendingResponses(engine);

    const idsBeforeSave = new Set(Object.keys(engine.state.cards));
    const idSeqBeforeSave = engine.state.idSeq;

    const save: SerializedGame = JSON.parse(JSON.stringify(saveGame(engine)));
    const restored = loadGame(save, staticCatalogOf(engine));

    assert.equal(restored.state.idSeq, idSeqBeforeSave);

    const makerId = id("maker");
    restored.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: makerId,
      abilityId: "mk"
    });
    resolvePendingResponses(restored);

    const newCardIds = Object.keys(restored.state.cards).filter(cid => !idsBeforeSave.has(cid));
    assert.equal(newCardIds.length, 1);
    assert.ok(restored.state.idSeq > idSeqBeforeSave);
  });

  test("GameState.idSeq is backfilled for a state built before that field existed", () => {
    const { engine } = buildGame({
      cards: [{ key: "front", def: character({ name: "Front Line" }), owner: P1 }]
    });

    const legacyState = structuredClone(engine.state);
    const highestExistingId = Math.max(
      ...Object.keys(legacyState.cards).map(cid => Number(cid.slice(cid.lastIndexOf("_") + 1)))
    );
    delete (legacyState as { idSeq?: number }).idSeq;

    const rebuilt = new SpoilsEngine(Object.values(engine.definitions), legacyState);
    assert.ok(rebuilt.state.idSeq >= highestExistingId);
  });

  test("loadGame rejects a save referencing a definition missing from the supplied catalog", () => {
    const { engine } = buildGame({
      cards: [{ key: "front", def: character({ name: "Front Line" }), owner: P1 }]
    });

    const save = saveGame(engine);
    const definitionsMissingFrontLine = Object.values(engine.definitions).filter(
      def => def.name !== "Front Line"
    );

    assert.throws(
      () => loadGame(save, definitionsMissingFrontLine),
      /Save references card definitions not present/
    );
  });

  test("loadGame rejects a save format newer than this engine understands", () => {
    const { engine } = buildGame({});
    const save = saveGame(engine);
    const fromTheFuture: SerializedGame = {
      ...save,
      formatVersion: CURRENT_SAVE_FORMAT_VERSION + 1
    };

    assert.throws(
      () => loadGame(fromTheFuture, Object.values(engine.definitions)),
      /newer than this engine supports/
    );
  });
});

describe("getSaveSummary", () => {
  test("small, indexable metadata alongside a save, without deserializing it", () => {
    const { engine } = buildGame({
      playerA: { name: "Alice", influence: 20 },
      playerB: { name: "Bob", influence: 18 },
      cards: [{ key: "front", def: tactic({ name: "Secret Plan" }), owner: P1, zone: "hand" }]
    });

    const summary = getSaveSummary(engine);

    assert.equal(summary.turn, 1);
    assert.equal(summary.activePlayerId, P1);
    assert.equal(summary.priorityPlayerId, P1);
    assert.equal(summary.mode, "main");
    assert.equal(summary.winner, undefined);
    assert.deepEqual(
      summary.players.sort((a, b) => a.id.localeCompare(b.id)),
      [
        { id: P1, name: "Alice", influence: 20 },
        { id: P2, name: "Bob", influence: 18 }
      ]
    );
  });
});
