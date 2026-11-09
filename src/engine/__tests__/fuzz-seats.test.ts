// Fuzz at two to six seats: seeded random games with real catalog decks, the table invariants checked after every
// action (support/fuzz.ts; docs/TESTING.md "Fuzz"). A fixed small set of seeds per seat count runs here; bigger
// sweeps run with `npm run fuzz`. A seed that once failed stays in `REGRESSION_SEEDS` with what it was.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fuzzGame, type FuzzOptions } from "./support/fuzz.js";

const SEATS = [2, 3, 4, 5, 6];

/** Seeds every run plays, per seat count, each to `MAX_ACTIONS` actions. */
const SEEDS: Record<number, number[]> = {
  2: [1],
  3: [1],
  4: [1],
  5: [1],
  6: [1]
};
const MAX_ACTIONS = 90;

/** Seeds that failed once, played to the action where they failed (and a little past it). */
const REGRESSION_SEEDS: Array<{ seats: number; seed: number; maxActions: number; what: string }> = [
  {
    seats: 2,
    seed: 2,
    maxActions: 60,
    what: "the log named a hidden I Drink Your Milkshake! in a deck when its trigger resolved (regressions/trigger-log-hidden-source.test.ts)"
  },
  {
    seats: 4,
    seed: 104,
    maxActions: 296,
    what: "an ability paid for with the user's last influence was put on the stack after the user was eliminated (regressions/ability-cost-eliminates-user.test.ts)"
  },
  {
    seats: 3,
    seed: 29,
    maxActions: 205,
    what: "driver gap: a flip-up cost of two destroyed resources left a second pick the driver tried only four random answers for, none legal"
  }
];

function play(seats: number, seed: number, maxActions: number, options: FuzzOptions = {}): void {
  const result = fuzzGame(seats, seed, { maxActions, ...options });
  assert.ok(
    result.status === "gameOver" || result.status === "capped",
    `${seats} seats, seed ${seed}: ${result.status} ${JSON.stringify(result.violation ?? result.finding)}`
  );
}

describe("fuzz: random games hold the table invariants after every action", () => {
  for (const seats of SEATS) {
    test(`${seats} seats`, () => {
      for (const seed of SEEDS[seats]!) play(seats, seed, MAX_ACTIONS);
    });
  }

  for (const { seats, seed, maxActions, what } of REGRESSION_SEEDS) {
    test(`regression: ${seats} seats, seed ${seed}: ${what}`, () => play(seats, seed, maxActions));
  }
});
