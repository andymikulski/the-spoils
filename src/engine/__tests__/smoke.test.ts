import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGame, character, P1, P2 } from "./support/fixtures.js";

test("smoke: fixture builds a running game with placed cards", () => {
  const { engine, id } = buildGame({
    cards: [
      { key: "attacker", def: character({ name: "Attacker" }), owner: P1 },
      { key: "defender", def: character({ name: "Defender" }), owner: P2 }
    ]
  });

  assert.equal(engine.state.players[P1].influence, 25);
  assert.equal(engine.state.players[P2].influence, 25);
  assert.equal(engine.state.cards[id("attacker")].zone, "play");
  assert.equal(engine.state.cards[id("attacker")].controllerId, P1);
  assert.equal(engine.getFlowView().turnPhase, "main");
});
