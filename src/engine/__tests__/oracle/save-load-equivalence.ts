// A game saved at any moment and loaded again plays on exactly as the original: each oracle game is played to the
// end, and before every action the policy takes, the game is saved, put through JSON, loaded into a fresh engine,
// and the same action is performed on both. They must agree on whether the action is accepted, and on the whole
// state afterwards. Covers what the engine keeps between actions (queued triggers, last-known information, damage
// bookkeeping) and the objects the state shares between places (`SerializedGame.sharedObjects`).

import { loadGame, saveGame, type GameAction } from "../../../engine.js";
import { playGameToCompletion } from "../support/autoplay.js";
import { mulberry32 } from "../support/prng.js";
import { ORACLE_GAMES, buildOracleEngine, type OracleGameSpec } from "./classic-oracle.js";

/** Key-sorted JSON with undefined dropped, so states compare by content. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([x], [y]) => (x < y ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The first place two states differ, for the failure message. */
function firstDifference(live: unknown, loaded: unknown, path = "state"): string | undefined {
  if (stable(live) === stable(loaded)) return undefined;
  if (live && loaded && typeof live === "object" && typeof loaded === "object") {
    for (const key of new Set([...Object.keys(live), ...Object.keys(loaded)])) {
      const difference = firstDifference(
        (live as Record<string, unknown>)[key],
        (loaded as Record<string, unknown>)[key],
        `${path}.${key}`
      );
      if (difference) return difference;
    }
  }
  return `${path}: live ${stable(live)?.slice(0, 300)} / loaded ${stable(loaded)?.slice(0, 300)}`;
}

/** Plays `spec` to the end, checking a save/load before every action. The first disagreement, or `undefined`. */
export function saveLoadDivergence(spec: OracleGameSpec): string | undefined {
  const engine = buildOracleEngine(spec);
  // The catalog a caller would load with: the definitions minted for tokens travel in the save itself.
  const catalog = Object.values(engine.definitions).filter(def => !def.id.startsWith("token-def_"));
  let depth = 0;
  let actions = 0;
  let divergence: string | undefined;
  const perform = engine.perform.bind(engine);
  engine.perform = (action: GameAction): void => {
    if (depth > 0 || divergence) {
      perform(action);
      return;
    }
    actions++;
    const loaded = loadGame(JSON.parse(JSON.stringify(saveGame(engine))), catalog);
    let loadedError: string | undefined;
    try {
      loaded.perform(structuredClone(action));
    } catch (error) {
      loadedError = (error as Error).message;
    }
    depth++;
    let liveError: unknown;
    try {
      perform(action);
    } catch (error) {
      liveError = error;
    } finally {
      depth--;
    }
    const liveMessage = liveError === undefined ? undefined : (liveError as Error).message;
    const where = `${spec.label}, action ${actions} ${JSON.stringify(action)}`;
    if (liveMessage !== loadedError) {
      divergence = `${where}: the live game ${liveMessage ? `refused it (${liveMessage})` : "accepted it"}, the loaded one ${loadedError ? `refused it (${loadedError})` : "accepted it"}`;
    } else {
      const difference = firstDifference(engine.state, loaded.state);
      if (difference) divergence = `${where}: ${difference}`;
    }
    if (liveError !== undefined) throw liveError;
  };
  playGameToCompletion(engine, { botRandom: mulberry32(spec.seed ^ 0x5eed), maxActions: 6000, reserve: spec.reserve });
  return divergence;
}

/** Shard `index` (0-based) of `count`: the oracle games split across test files so they run in parallel. */
export function saveLoadShard(index: number, count: number): OracleGameSpec[] {
  return ORACLE_GAMES.filter((_, i) => i % count === index);
}
