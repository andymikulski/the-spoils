// Table-mode matrix (SPOILS_TABLE=classic|ffa3|ffa4|showdown): every two-player
// `buildGame` board is re-seated at a bigger table, so the whole suite also
// checks that a game with more players behaves exactly like the two-player
// game its test was written for when the extra players stay out of it.
//
//   ffa3      P1, P2, B1                (one extra seat after the two)
//   ffa4      P1, B1, P2, B2            (extra seats between them)
//   showdown  P1 Villain; P2, B1, B2 loyal Heroes
//
// The wrapper keeps each test's two-player meaning: "your opponent" is the
// other original player (`opponentId` on plays / abilities, the answer to a
// `chooseOpponent` prompt, an attack's default target); the extra players
// pass whenever offered priority, decline whatever they are asked and end
// their own turns; and the game's result is judged between the two original
// players alone (an extra seat never keeps a decided game going or shares a
// win). A test that fails only in a table mode has found something a bigger
// table changes.

import type { GameAction, GameFormat, GameResult, PlayerId, SpoilsEngine } from "../../../engine.js";
import { handlePendingChoice, type AutoplayReport } from "./autoplay.js";
import { mulberry32 } from "./prng.js";

export type TableMode = "classic" | "ffa3" | "ffa4" | "showdown";

export const BYSTANDERS: readonly PlayerId[] = ["b1", "b2"];

export function tableMode(): TableMode {
  const mode = process.env.SPOILS_TABLE ?? (process.env.SPOILS_BYSTANDER === "1" ? "ffa3" : "classic");
  if (mode === "classic" || mode === "ffa3" || mode === "ffa4" || mode === "showdown") return mode;
  throw new Error(`Unknown SPOILS_TABLE '${mode}'.`);
}

/** The seat order for `mode` around the two original players, and its table format. */
export function tableSeats(mode: TableMode, first: PlayerId, second: PlayerId): { seats: PlayerId[]; format?: GameFormat } {
  switch (mode) {
    case "classic":
      return { seats: [first, second] };
    case "ffa3":
      return { seats: [first, second, BYSTANDERS[0]] };
    case "ffa4":
      return { seats: [first, BYSTANDERS[0], second, BYSTANDERS[1]] };
    case "showdown":
      return {
        seats: [first, second, BYSTANDERS[0], BYSTANDERS[1]],
        format: { kind: "showdown", villainId: first, allegiance: { cards: ["heroes", "heroes", "heroes"] } }
      };
  }
}

/** Wraps `engine` so the extra seats stay out of the way (see the file header). */
export function withBystanders(engine: SpoilsEngine, first: PlayerId, second: PlayerId): SpoilsEngine {
  const real = engine.perform.bind(engine);
  const extra = new Set(engine.state.turnOrder.filter(id => id !== first && id !== second));
  const classicOpponent = (playerId: PlayerId): PlayerId | undefined =>
    playerId === first ? second : playerId === second ? first : undefined;

  // The result between the two original players alone: the extra seats count as already out, and never win.
  const internals = engine as unknown as { resultIfOut(out: readonly PlayerId[]): GameResult | undefined };
  const resultIfOut = internals.resultIfOut.bind(engine);
  internals.resultIfOut = out => {
    const result = resultIfOut([...out, ...extra]);
    if (!result || result.outcome === "draw") return result;
    const winners = result.winners.filter(id => !extra.has(id));
    return winners.length > 0 ? { outcome: "victory", winners } : { outcome: "draw", winners: [] };
  };

  const botRandom = mulberry32(7);
  const botReport = { pendingChoicesResolved: {} } as unknown as AutoplayReport;
  let settling = false;

  const settle = (): void => {
    for (let guard = 0; guard < 400; guard++) {
      const state = engine.state;
      if (state.result) return;
      const pending = state.pendingChoice;
      if (pending?.kind === "chooseOpponent") {
        // An original player names the other original player; an extra seat
        // prefers another extra seat, keeping the original two out of it.
        const wanted = classicOpponent(pending.playerId);
        const opponentId =
          wanted !== undefined && pending.candidates.includes(wanted)
            ? wanted
            : (pending.candidates.find(id => extra.has(id)) ?? pending.candidates[0]);
        real({ type: "resolvePendingChoice", playerId: pending.playerId, choice: { kind: "chooseOpponent", opponentId } });
        continue;
      }
      // During an extra seat's turn — a turn the two-player game never has —
      // every prompt is answered for whoever it asks.
      if (pending && (extra.has(pending.playerId) || extra.has(state.activePlayerId))) {
        // Payment offers are declined outright; anything else an extra seat
        // must decide (its own start-of-turn prompts) is answered as the
        // autoplay bot would.
        if (pending.kind === "anyPlayerMayPay" || pending.kind === "mayPay") {
          real({ type: "resolvePendingChoice", playerId: pending.playerId, choice: { kind: pending.kind, pay: false } as never });
          continue;
        }
        if (pending.kind === "auctionBid") {
          real({ type: "resolvePendingChoice", playerId: pending.playerId, choice: { kind: "auctionBid", bid: 0 } });
          continue;
        }
        // An original player asked something during an extra seat's turn
        // declines whatever it may, so its board stays as in the two-player game.
        if (!extra.has(pending.playerId) && pending.kind === "chooserSelectsTarget" && pending.declaration.optional) {
          real({ type: "resolvePendingChoice", playerId: pending.playerId, choice: { kind: "chooserSelectsTarget", selected: [] } });
          continue;
        }
        const before = pending.id;
        settling = true;
        try {
          handlePendingChoice(engine, pending, botRandom, botReport);
        } finally {
          settling = false;
        }
        if (engine.state.pendingChoice?.id === before) return;
        continue;
      }
      if (pending) return;
      const window = state.responseWindow;
      if (window) {
        const extraTurnEnding = window.continuation.type === "endTurn" && extra.has(window.continuation.playerId);
        if (window.phase === "acceptingResponses" && (extra.has(window.priorityPlayerId) || extraTurnEnding)) {
          real({ type: "passPriority", playerId: window.priorityPlayerId });
          continue;
        }
        if (window.phase === "resolving" && extraTurnEnding) {
          real({ type: "advanceFlow" });
          continue;
        }
        return;
      }
      if (extra.has(state.activePlayerId) && !state.battle && state.responseStack.length === 0) {
        real({ type: "endTurn", playerId: state.activePlayerId });
        continue;
      }
      return;
    }
  };

  (engine as { perform: (action: GameAction) => void }).perform = (action: GameAction) => {
    let next = action;
    if (
      (next.type === "playCard" || next.type === "activateAbility" || next.type === "flipUp") &&
      next.opponentId === undefined
    ) {
      const opponentId = classicOpponent(next.playerId);
      if (opponentId !== undefined) next = { ...next, opponentId };
    }
    if (next.type === "declareAttack" && !next.target) {
      const opponentId = classicOpponent(next.playerId);
      if (opponentId !== undefined) next = { ...next, target: { type: "faction", playerId: opponentId } };
    }
    real(next);
    if (!settling) settle();
  };
  return engine;
}
