// Bystander mode (SPOILS_BYSTANDER=1): every two-player `buildGame` board gets
// a third, passive seat, so the whole suite also checks that a game with more
// than two players behaves exactly like the two-player game its test was
// written for when the extra player stays out of it.
//
// The wrapper keeps each test's two-player meaning: "your opponent" is the
// other original player (`opponentId` on plays / abilities, the answer to a
// `chooseOpponent` prompt, an attack's default target), the bystander passes
// whenever it is offered priority, declines whatever it is asked, and plays
// out its own turns by ending them. A test that fails only in this mode has
// found something a third player's mere presence changes.

import type { GameAction, PlayerId, SpoilsEngine } from "../../../engine.js";

export const BYSTANDER: PlayerId = "p3";

export function bystanderModeOn(): boolean {
  return process.env.SPOILS_BYSTANDER === "1";
}

/** Wraps `engine.perform` so the bystander seat stays out of the way (see the file header). */
export function withBystander(engine: SpoilsEngine, first: PlayerId, second: PlayerId): SpoilsEngine {
  const real = engine.perform.bind(engine);
  const classicOpponent = (playerId: PlayerId): PlayerId | undefined =>
    playerId === first ? second : playerId === second ? first : undefined;

  const settle = (): void => {
    for (let guard = 0; guard < 200; guard++) {
      const state = engine.state;
      if (state.result) return;
      const pending = state.pendingChoice;
      if (pending?.kind === "chooseOpponent") {
        const opponentId = classicOpponent(pending.playerId) ?? pending.candidates[0];
        if (!pending.candidates.includes(opponentId)) return;
        real({ type: "resolvePendingChoice", playerId: pending.playerId, choice: { kind: "chooseOpponent", opponentId } });
        continue;
      }
      if (pending?.playerId === BYSTANDER) {
        if (pending.kind === "anyPlayerMayPay" || pending.kind === "mayPay") {
          real({ type: "resolvePendingChoice", playerId: BYSTANDER, choice: { kind: pending.kind, pay: false } as never });
          continue;
        }
        if (pending.kind === "orderTriggers") {
          real({ type: "resolvePendingChoice", playerId: BYSTANDER, choice: { kind: "orderTriggers", next: pending.triggers[0] } });
          continue;
        }
        return;
      }
      if (pending) return;
      const window = state.responseWindow;
      if (window) {
        const bystandersTurnEnding = window.continuation.type === "endTurn" && window.continuation.playerId === BYSTANDER;
        if (window.phase === "acceptingResponses" && (window.priorityPlayerId === BYSTANDER || bystandersTurnEnding)) {
          real({ type: "passPriority", playerId: window.priorityPlayerId });
          continue;
        }
        if (window.phase === "resolving" && bystandersTurnEnding) {
          real({ type: "advanceFlow" });
          continue;
        }
        return;
      }
      if (state.activePlayerId === BYSTANDER && !state.battle && state.responseStack.length === 0) {
        real({ type: "endTurn", playerId: BYSTANDER });
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
    settle();
  };
  return engine;
}
