// The random-play driver's setup builds games at any seat count: a seeded random setup with three or four seats is
// created through `createFactionGame` and reaches the first decision of the setup flow. (No game is played here.)

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createEngine, ELIGIBLE_FACTIONS, randomSetup } from "./support/driver.js";

const union = ELIGIBLE_FACTIONS.find(faction => faction.name === "The Union of Unextraordinary Miners");

describe("driver setup at several seats", () => {
  for (const seats of [3, 4]) {
    test(`${seats} seats: random setups from 40 seeds all build, in the seat order the setup lists`, () => {
      for (let seed = 1; seed <= 40; seed++) {
        const setup = randomSetup(seed, { seats });
        assert.equal(setup.players.length, seats);
        const engine = createEngine(setup);
        assert.deepEqual(engine.getSeats(), setup.players.map(player => player.id), `seed ${seed}: seats are the players in order`);
        const phase = engine.state.setup.phase;
        assert.ok(
          phase === "chooseMatchOpponent" || phase === "chooseStartingResources" || phase === "chooseFirstPlayer" || phase === "mulligan" || phase === "complete",
          `seed ${seed}: setup is at a real step (${phase})`
        );
        if (setup.firstPlayerId !== undefined) {
          assert.equal(engine.state.activePlayerId, setup.firstPlayerId, `seed ${seed}: the named first player goes first`);
        }
      }
    });

    test(`${seats} seats: a Union of Unextraordinary Miners seat is asked for the opponent it matches`, () => {
      assert.ok(union, "the Union is a playable catalog faction");
      for (let seed = 1; seed <= 10; seed++) {
        const setup = randomSetup(seed, { seats, factions: [undefined, union] });
        const engine = createEngine(setup);
        assert.equal(engine.getSeats().length, seats);
        const pending = engine.state.pendingChoice;
        assert.ok(pending?.kind === "choosePlayer" && pending.bind.type === "matchOpponent", `seed ${seed}: setup asks for the Union's opponent`);
        assert.equal(pending.playerId, setup.players[1]!.id);
      }
    });
  }

  test("two seats: the Union has one opponent, so none is asked", () => {
    const setup = randomSetup(7, { seats: 2, factions: [union, undefined] });
    assert.equal(createEngine(setup).state.pendingChoice, undefined, "with one opponent nothing is asked");
  });
});
