// Shared drivers and synthetic cards for the r08-turn-deploy batch (CR 601-606). Not a test file.

import assert from "node:assert/strict";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import { character, P1, P2 } from "../support/fixtures.js";
import { settleTurnStart } from "../support/develop.js";

export const other = (player: PlayerId): PlayerId => (player === P1 ? P2 : P1);
export const zoneOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId]!.zone;
export const influence = (engine: SpoilsEngine, player: PlayerId) => engine.state.players[player].influence;

/** Drives response windows to their end WITHOUT settling the start-of-turn triggers: stops at the first pending choice. */
export function passWindows(engine: SpoilsEngine): void {
  for (let guard = 0; engine.state.responseWindow && !engine.state.pendingChoice; guard++) {
    assert.ok(guard < 200, "response windows converge");
    const window = engine.state.responseWindow;
    if (window.phase === "acceptingResponses") engine.perform({ type: "passPriority", playerId: window.priorityPlayerId });
    else engine.perform({ type: "advanceFlow" });
  }
}

/** The active player ends their turn and the opponent passes: stops with the new turn's start-of-turn prompt open (if any). */
export function endTurnToStartOfTurn(engine: SpoilsEngine): void {
  engine.perform({ type: "endTurn", playerId: engine.state.activePlayerId });
  passWindows(engine);
}

/** Passes the turn to the opponent and answers the new turn's start-of-turn prompts (Restore first; the Develop Rule is skipped). */
export function passTurn(engine: SpoilsEngine): void {
  endTurnToStartOfTurn(engine);
  settleTurnStart(engine);
}

/** Plays a started battle out: nobody blocks unless `blockers` says so, every damage source hits its first legal target. */
export function finishBattle(engine: SpoilsEngine): void {
  for (let guard = 0; engine.state.battle && !engine.state.pendingChoice; guard++) {
    assert.ok(guard < 100, "the battle converges");
    if (engine.state.responseWindow) {
      passWindows(engine);
      continue;
    }
    if (engine.state.battle.phase === "finished") {
      engine.perform({ type: "advanceFlow" });
      continue;
    }
    const view = engine.getBattleView();
    if (view?.actingPlayerId) {
      engine.perform({
        type: "assignBattleDamage",
        playerId: view.actingPlayerId,
        assignments: view.damageSources
          .filter((source) => source.legalTargets.length > 0 && source.strength > 0)
          .map((source) => ({ sourceId: source.cardId, target: source.legalTargets[0], amount: source.strength }))
      });
    } else engine.perform({ type: "advanceFlow" });
  }
}

/** The active player attacks the opponent's faction with `attackers`; `blockers` (the defender's) block; the battle is played out. */
export function attackFaction(engine: SpoilsEngine, attackers: CardInstanceId[], blockers: CardInstanceId[] = []): void {
  const attacker = engine.state.activePlayerId;
  engine.perform({ type: "declareAttack", playerId: attacker, attackerIds: attackers, target: { type: "faction", playerId: other(attacker) } });
  passWindows(engine);
  engine.perform({ type: "declareBlockers", playerId: other(attacker), blockerIds: blockers });
  finishBattle(engine);
}

/** The active player uses `cardId`'s ability and the opponent passes. */
export function useAbility(engine: SpoilsEngine, cardId: CardInstanceId, abilityId: string): void {
  engine.perform({ type: "activateAbility", playerId: engine.state.activePlayerId, cardId, abilityId });
  passWindows(engine);
}

/** The active player deploys `cardId` and the opponent passes. */
export function deploy(engine: SpoilsEngine, cardId: CardInstanceId): void {
  engine.perform({ type: "playCard", playerId: engine.state.activePlayerId, cardId });
  passWindows(engine);
}

/** The trigger-resolution lines of the game log, in order. */
export const triggerLog = (engine: SpoilsEngine) =>
  engine.state.gameLog.filter((entry) => entry.marker === "triggerResolving").map((entry) => entry.message);

/** Chooses `sourceId`'s ability as the next trigger of the open `orderTriggers` prompt. */
export function orderNext(engine: SpoilsEngine, sourceId: CardInstanceId): void {
  const pending = engine.state.pendingChoice;
  assert.equal(pending?.kind, "orderTriggers", "an order-your-triggers prompt is open");
  if (pending?.kind !== "orderTriggers") return;
  const trigger = pending.triggers.find((entry) => entry.sourceId === sourceId);
  assert.ok(trigger, "the trigger is one of the batch");
  engine.perform({
    type: "resolvePendingChoice",
    playerId: pending.playerId,
    choice: { kind: "orderTriggers", next: { sourceId, abilityId: trigger!.abilityId } }
  });
}

/** A character with a free, unlimited activated ability ("go") that grants its controller 1 influence. */
export const tapper = (name: string) =>
  character({
    name,
    behavior: { abilities: [{ id: "go", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }] }
  });

/** A character with a free ability ("buff") giving itself +5 strength for `duration`. */
export const buffer = (name: string, duration: "untilEndOfTurn" | "permanent") =>
  character({
    name,
    strength: 1,
    behavior: {
      abilities: [
        {
          id: "buff",
          type: "activated",
          effects: [{ type: "createModifier", target: "source", stat: "strength", operation: "add", value: 5, duration: { type: duration } }]
        }
      ]
    }
  });

/** A character whose "at the start of your turn" trigger gives its controller `amount` influence. */
export const startWatcher = (name: string, amount: number) =>
  character({
    name,
    behavior: {
      abilities: [
        {
          id: "t",
          type: "triggered",
          event: "turnStarted",
          condition: { type: "isActivePlayer" },
          effects: [{ type: "modifyInfluence", player: "controller", amount }]
        }
      ]
    }
  });

/** Chooses the trigger with `abilityId` (e.g. the faction's `restoreRule` / `developRule`) as the next one of the open `orderTriggers` prompt. */
export function orderAbilityNext(engine: SpoilsEngine, abilityId: string): void {
  const pending = engine.state.pendingChoice;
  assert.equal(pending?.kind, "orderTriggers", "an order-your-triggers prompt is open");
  if (pending?.kind !== "orderTriggers") return;
  const trigger = pending.triggers.find((entry) => entry.abilityId === abilityId);
  assert.ok(trigger, `the ${abilityId} trigger is one of the batch`);
  engine.perform({
    type: "resolvePendingChoice",
    playerId: pending.playerId,
    choice: { kind: "orderTriggers", next: { sourceId: trigger!.sourceId, abilityId } }
  });
}
