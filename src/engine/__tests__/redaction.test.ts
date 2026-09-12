// Direct tests of the phase-2a redaction API — see
// docs/multiplayer-architecture.md ("Hidden information / redaction") in
// ~/dev/rotten. These are deliberately independent of any specific card:
// the property under test is "does the redaction function correctly hide
// what RULES.md says is hidden", not any one card's authored behavior.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGame,
  character,
  item,
  P1,
  P2,
  resourceCard
} from "./support/fixtures.js";
import {
  redactStateFor,
  redactFlowViewFor,
  redactLogFor,
  HIDDEN_DEFINITION_ID
} from "../../engine.js";

describe("redactStateFor", () => {
  test("an opponent's hand card is masked; your own hand is not", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "hand" },
        { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "hand" }
      ]
    });

    const asP1 = redactStateFor(engine.state, P1);
    assert.equal(asP1.cards[id("mine")].definitionId, engine.state.cards[id("mine")].definitionId);
    assert.equal(asP1.cards[id("theirs")].definitionId, HIDDEN_DEFINITION_ID);

    // The hidden card kept its real, stable id — only its identity is masked.
    assert.equal(asP1.cards[id("theirs")].id, id("theirs"));
    assert.equal(asP1.cards[id("theirs")].zone, "hand");
  });

  test("an opponent's deck is masked, in order; a player's own deck is not", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        { key: "d2", def: character({ name: "D2" }), owner: P2, zone: "deck" }
      ]
    });

    const asP1 = redactStateFor(engine.state, P1);
    assert.equal(asP1.cards[id("d1")].definitionId, engine.state.cards[id("d1")].definitionId);
    assert.equal(asP1.cards[id("d2")].definitionId, HIDDEN_DEFINITION_ID);
    // Order/count in `PlayerState.deck` is untouched — only content is masked.
    assert.deepEqual(asP1.players[P2].deck, engine.state.players[P2].deck);
  });

  test("a face-down resource is hidden from the opponent but visible to its controller", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "fd", def: resourceCard({ name: "Secret Resource" }), owner: P1, zone: "play", faceDown: true }
      ]
    });

    const asP1 = redactStateFor(engine.state, P1);
    const asP2 = redactStateFor(engine.state, P2);
    assert.equal(asP1.cards[id("fd")].definitionId, engine.state.cards[id("fd")].definitionId);
    assert.equal(asP2.cards[id("fd")].definitionId, HIDDEN_DEFINITION_ID);
  });

  test("face-up in-play, discard, and void cards are visible to everyone", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "play1", def: character({ name: "InPlay" }), owner: P2, zone: "play" },
        { key: "disc1", def: item({ name: "Discarded" }), owner: P2, zone: "discard" },
        { key: "void1", def: item({ name: "Voided" }), owner: P2, zone: "void" }
      ]
    });

    const asP1 = redactStateFor(engine.state, P1);
    for (const key of ["play1", "disc1", "void1"]) {
      assert.equal(asP1.cards[id(key)].definitionId, engine.state.cards[id(key)].definitionId, key);
    }
  });

  test("a spectator sees both players' hands and decks masked", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "h1", def: character({ name: "H1" }), owner: P1, zone: "hand" },
        { key: "h2", def: character({ name: "H2" }), owner: P2, zone: "hand" }
      ]
    });

    const asSpectator = redactStateFor(engine.state, "spectator");
    assert.equal(asSpectator.cards[id("h1")].definitionId, HIDDEN_DEFINITION_ID);
    assert.equal(asSpectator.cards[id("h2")].definitionId, HIDDEN_DEFINITION_ID);
  });

  test("rngState never survives redaction, for any viewer", () => {
    const { engine } = buildGame({ cards: [] });
    engine.state.rngState = 123456789;

    assert.equal(redactStateFor(engine.state, P1).rngState, 0);
    assert.equal(redactStateFor(engine.state, P2).rngState, 0);
    assert.equal(redactStateFor(engine.state, "spectator").rngState, 0);
  });

  test("a grantsReveal override un-hides what it names, for everyone else", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "top", def: character({ name: "Revealed Top" }), owner: P2, zone: "deck" }]
    });

    const revealed = { deckTop: [{ playerId: P2, cardId: id("top") }], hands: [] };
    const asP1 = redactStateFor(engine.state, P1, { revealed });
    assert.equal(asP1.cards[id("top")].definitionId, engine.state.cards[id("top")].definitionId);
  });

  test("mid-resolution continuation state (auctions, coin-flip replace, ...) is stripped, not leaked", () => {
    const { engine } = buildGame({ cards: [] });
    (engine.state as { pendingAuction?: unknown }).pendingAuction = { fake: true };

    const asP1 = redactStateFor(engine.state, P1);
    assert.equal(asP1.pendingAuction, undefined);
  });

  test("state.gameLog is redacted too — not a raw copy riding along inside an otherwise-safe state", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "hidden", def: character({ name: "Secret Card" }), owner: P2, zone: "hand" }]
    });

    engine.state.gameLog = [
      {
        seq: 1,
        turn: 1,
        activePlayerId: P1,
        depth: 0,
        kind: "draw",
        message: "Bob drew Secret Card.",
        event: { type: "cardDrawn", cardId: id("hidden"), playerId: P2 } as never
      }
    ];

    const asP1 = redactStateFor(engine.state, P1);
    assert.equal(asP1.gameLog[0].message, "(hidden)");
  });
});

describe("pendingChoice redaction (shared by redactStateFor / redactFlowViewFor)", () => {
  test("the deciding player sees the full choice; everyone else gets kind + playerId only", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "c1", def: character({ name: "C1" }), owner: P1, zone: "play" }]
    });
    engine.state.pendingChoice = {
      kind: "uniqueSurvivor",
      id: "choice_1",
      playerId: P1,
      unique: "test",
      candidates: [id("c1")]
    };

    const asP1 = redactStateFor(engine.state, P1);
    assert.deepEqual(asP1.pendingChoice, engine.state.pendingChoice);

    const asP2 = redactStateFor(engine.state, P2);
    assert.deepEqual(asP2.pendingChoice, { kind: "uniqueSurvivor", playerId: P1 });

    const flow = engine.getFlowView();
    const flowAsP2 = redactFlowViewFor(flow, P2);
    assert.deepEqual(flowAsP2.pendingChoice, { kind: "uniqueSurvivor", playerId: P1 });
  });
});

describe("redactLogFor", () => {
  test("a log entry referencing a currently-hidden card is genericized; a public one is untouched", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "hidden", def: character({ name: "Secret Card" }), owner: P2, zone: "hand" },
        { key: "public", def: character({ name: "Public Card" }), owner: P1, zone: "play" }
      ]
    });

    engine.state.gameLog = [
      {
        seq: 1,
        turn: 1,
        activePlayerId: P1,
        depth: 0,
        kind: "draw",
        message: "Bob drew Secret Card.",
        event: { type: "cardDrawn", cardId: id("hidden"), playerId: P2 } as never
      },
      {
        seq: 2,
        turn: 1,
        activePlayerId: P1,
        depth: 0,
        kind: "action",
        message: "Alice played Public Card.",
        event: { type: "cardPlayed", cardId: id("public"), playerId: P1 } as never
      }
    ];

    const redacted = redactLogFor(engine.state.gameLog, engine.state.cards, P1);
    assert.equal(redacted[0].message, "(hidden)");
    assert.equal(redacted[1].message, "Alice played Public Card.");
  });

  test("a marker entry (no structured event) passes through unredacted", () => {
    const { engine } = buildGame({ cards: [] });
    engine.state.gameLog = [
      {
        seq: 1,
        turn: 1,
        activePlayerId: P1,
        depth: 1,
        kind: "response",
        message: "Bob is given a chance to respond.",
        marker: "responseWindowOpened"
      }
    ];

    const redacted = redactLogFor(engine.state.gameLog, engine.state.cards, P2);
    assert.equal(redacted[0].message, "Bob is given a chance to respond.");
  });
});
