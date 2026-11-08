// Recorded-game replays: the file format, and the one routine that replays a file against the engine and
// compares the digest after every action. Used by the recorder (scripts/record-replays.ts, to verify what
// it just recorded) and by replay-2p.test.ts.

import { loadGame, saveGame, type GameAction, type SpoilsEngine } from "../../../engine.js";
import { DIGEST_LENGTH, digestState } from "./digest.js";
import { CARD_NAME_CATALOG, CATALOG, createEngine, type GameSetupInputs } from "./driver.js";

export const REPLAY_FORMAT_VERSION = 1;

/** One recorded game: how to rebuild it, what was done, and the state digest after setup and after each action. */
export interface ReplayFile {
  formatVersion: number;
  /** The recorder's slot for this game (sets the factions / featured sets), see scripts/record-replays.ts. */
  slot: number;
  driverSeed: number;
  status: "gameOver" | "capped";
  winner?: string;
  turns: number;
  setup: GameSetupInputs;
  actions: GameAction[];
  /** Action counts after which `replay-2p.test.ts` saves the game, loads it back through JSON and carries on (chosen by `findRoundTripPoints`). */
  roundTripAfter: number[];
  /** `actions.length + 1` digests of `DIGEST_LENGTH` hex characters each, concatenated: after setup, then after each action. */
  digests: string;
}

export function digestAt(file: ReplayFile, index: number): string {
  return file.digests.slice(index * DIGEST_LENGTH, (index + 1) * DIGEST_LENGTH);
}

export interface ReplayMismatch {
  /** 0 = right after setup; n = after the n-th action (`actions[n - 1]`). */
  index: number;
  action?: GameAction;
  expected: string;
  actual: string;
  /** Set when the engine threw while performing the action. */
  error?: string;
}

export interface ReplayOptions {
  /** Action counts after which the game is saved, pushed through JSON and loaded back before carrying on. */
  roundTripAfter?: readonly number[];
}

/** Rebuilds the game and performs every logged action; the first digest that differs (or throw) is returned. */
export function replayAgainstDigests(file: ReplayFile, options: ReplayOptions = {}): ReplayMismatch | undefined {
  if (file.digests.length !== (file.actions.length + 1) * DIGEST_LENGTH) {
    return { index: 0, expected: `${file.actions.length + 1} digests`, actual: `${file.digests.length / DIGEST_LENGTH} digests` };
  }
  const roundTrips = new Set(options.roundTripAfter ?? []);
  let engine: SpoilsEngine = createEngine(file.setup);

  const first = digestState(engine.state);
  if (first !== digestAt(file, 0)) return { index: 0, expected: digestAt(file, 0), actual: first };

  for (let i = 0; i < file.actions.length; i++) {
    const action = file.actions[i]!;
    try {
      engine.perform(action);
    } catch (error) {
      return {
        index: i + 1,
        action,
        expected: digestAt(file, i + 1),
        actual: "(threw)",
        error: error instanceof Error ? error.message : String(error)
      };
    }
    const actual = digestState(engine.state);
    if (actual !== digestAt(file, i + 1)) return { index: i + 1, action, expected: digestAt(file, i + 1), actual };

    if (roundTrips.has(i + 1)) {
      const save = JSON.parse(JSON.stringify(saveGame(engine)));
      engine = loadGame(save, CATALOG, undefined, CARD_NAME_CATALOG);
      const reloaded = digestState(engine.state);
      if (reloaded !== actual) {
        return { index: i + 1, action, expected: actual, actual: reloaded, error: "saveGame -> JSON -> loadGame changed the state" };
      }
    }
  }
  return undefined;
}

export interface RoundTripSearch {
  /** Action counts at which a save -> JSON -> load continues to the recorded digests. */
  points: number[];
  /** Action counts that were tried and failed, with the mismatch the loaded game showed. */
  failures: Array<{ index: number; mismatch: ReplayMismatch }>;
}

/**
 * Looks, from each target position onward, for a moment where the game can be saved, pushed through JSON and
 * loaded back, and then plays the next `lookahead` actions to the recorded digests. Plays the file once; each
 * probe forks a throw-away engine from the save, so the main replay is unaffected.
 */
export function findRoundTripPoints(file: ReplayFile, targets: readonly number[], lookahead = 40): RoundTripSearch {
  const points: number[] = [];
  const failures: RoundTripSearch["failures"] = [];
  const pending = [...targets].sort((a, b) => a - b);
  const engine = createEngine(file.setup);

  for (let done = 0; done <= file.actions.length && pending.length > 0; done++) {
    if (done > 0) engine.perform(file.actions[done - 1]!);
    if (done < pending[0]!) continue;

    const save = JSON.parse(JSON.stringify(saveGame(engine)));
    const fork = loadGame(save, CATALOG, undefined, CARD_NAME_CATALOG);
    let mismatch: ReplayMismatch | undefined;
    const reloaded = digestState(fork.state);
    if (reloaded !== digestAt(file, done)) {
      mismatch = { index: done, expected: digestAt(file, done), actual: reloaded, error: "saveGame -> JSON -> loadGame changed the state" };
    }
    for (let i = done; !mismatch && i < Math.min(file.actions.length, done + lookahead); i++) {
      const action = file.actions[i]!;
      try {
        fork.perform(action);
      } catch (error) {
        mismatch = { index: i + 1, action, expected: digestAt(file, i + 1), actual: "(threw)", error: error instanceof Error ? error.message : String(error) };
        break;
      }
      const actual = digestState(fork.state);
      if (actual !== digestAt(file, i + 1)) mismatch = { index: i + 1, action, expected: digestAt(file, i + 1), actual };
    }

    if (!mismatch) {
      points.push(done);
      pending.shift();
    } else {
      failures.push({ index: done, mismatch });
    }
  }
  return { points, failures };
}
