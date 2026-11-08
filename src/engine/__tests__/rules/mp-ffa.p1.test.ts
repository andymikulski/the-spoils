// Multiplayer (free-for-all) rules, part 1: seats and seat order.
// Atoms: data/rule-tests/source/multiplayer.txt (batch mp-ffa).

import { describe } from "node:test";
import assert from "node:assert/strict";
import { buildGame, P1, P2, P3, P4 } from "../support/fixtures.js";
import { rule } from "./_rule.js";

describe("MPX-seat — seat order and clockwise", () => {
  rule("MPX-seat", "seats run in the order the players were given; clockwise from a seat wraps past the last seat", () => {
    const { engine } = buildGame({ extraPlayers: [{}, {}] });
    assert.deepEqual(engine.getSeats(), [P1, P2, P3, P4], "seat order is setup order");
    assert.deepEqual(engine.getPlayersInSeatOrder(), [P1, P2, P3, P4], "from the first seat");
    assert.deepEqual(engine.getPlayersInSeatOrder(P3), [P3, P4, P1, P2], "clockwise from P3 wraps to P1");
  });

  rule("MPX-seat", "a player's opponents are every other player still in the game, clockwise from the seat on their left", () => {
    const { engine } = buildGame({ extraPlayers: [{}, {}] });
    assert.deepEqual(engine.getOpponents(P1), [P2, P3, P4], "P1's opponents start at P2");
    assert.deepEqual(engine.getOpponents(P3), [P4, P1, P2], "P3's opponents start at P4");
  });

  rule("MPX-seat", "a player who has lost is skipped everywhere in seat order and is nobody's opponent", () => {
    const { engine } = buildGame({ extraPlayers: [{}, {}] });
    engine.state.players[P3].eliminated = { turn: 1 };
    assert.equal(engine.isEliminated(P3), true, "P3 is out");
    assert.equal(engine.isEliminated(P2), false, "control: P2 is in");
    assert.deepEqual(engine.getSeats(), [P1, P2, P3, P4], "P3 keeps a seat in the record");
    assert.deepEqual(engine.getPlayersInSeatOrder(P2), [P2, P4, P1], "clockwise from P2 skips P3");
    assert.deepEqual(engine.getOpponents(P1), [P2, P4], "P3 is no longer an opponent");
  });

  rule("MPX-seat", "with exactly two players, clockwise from either player is the other player", () => {
    const { engine } = buildGame();
    assert.deepEqual(engine.getSeats(), [P1, P2], "two seats");
    assert.deepEqual(engine.getOpponents(P1), [P2], "P1's only opponent");
    assert.deepEqual(engine.getOpponents(P2), [P1], "P2's only opponent");
  });
});
