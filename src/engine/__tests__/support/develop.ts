// Test helpers for the faction Develop Rule. The rule is a start-of-turn trigger (CR 202.8, 602.2): in a real game
// it is queued with the turn's other `turnStarted` triggers and offers its choices as a `chooserSelectsOption`.
// Fixture games are built mid-turn (no real turn start ever ran), so these helpers open the rule the same way
// the trigger does and then answer the prompts it raises with ordinary `resolvePendingChoice` actions.

import { DEVELOP_RULE_ABILITY_ID } from "../../../engine.js";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";

/** Whether `pending` is the Develop Rule's option prompt (the `developRule` trigger's `chooserSelectsOption`). */
export function isDevelopChoice(pending: SpoilsEngine["state"]["pendingChoice"]): boolean {
  return pending?.kind === "chooserSelectsOption" && pending.context.abilityId === DEVELOP_RULE_ABILITY_ID;
}

/** Opens the Develop Rule for `playerId`, as its start-of-turn trigger would: leaves the option prompt pending. */
export function openDevelop(engine: SpoilsEngine, playerId: PlayerId): void {
  const factionId = engine.state.players[playerId].factionId;
  if (!factionId) throw new Error(`${playerId} has no faction card.`);
  (engine as unknown as { resolveEffect(effect: object, context: object): void }).resolveEffect(
    { type: "developRule" },
    { sourceId: factionId, controllerId: playerId, selected: {} }
  );
}

function pickOption(engine: SpoilsEngine, playerId: PlayerId, label: string | RegExp): void {
  const pending = engine.state.pendingChoice;
  if (pending?.kind !== "chooserSelectsOption") {
    throw new Error(`Expected the Develop Rule's option prompt, found ${pending?.kind ?? "nothing"}.`);
  }
  const index = pending.options.findIndex(option =>
    typeof label === "string" ? option.label === label : label.test(option.label ?? "")
  );
  if (index < 0) {
    throw new Error(
      `No Develop Rule option "${String(label)}"; offered: ${pending.options.map(o => o.label).join(", ")}.`
    );
  }
  engine.perform({ type: "resolvePendingChoice", playerId, choice: { kind: "chooserSelectsOption", index } });
}

/** Draw via the Develop Rule. */
export function developDraw(engine: SpoilsEngine, playerId: PlayerId): void {
  openDevelop(engine, playerId);
  pickOption(engine, playerId, /^Draw /);
}

/**
 * Play `cardId` from hand as the Develop Rule's resource, face-down or face-up. A lone hand card is not asked
 * about; otherwise the pick and the face prompt are answered.
 */
export function developPlay(
  engine: SpoilsEngine,
  playerId: PlayerId,
  cardId: CardInstanceId,
  faceDown = false
): void {
  openDevelop(engine, playerId);
  pickOption(engine, playerId, /^Play /);
  let pending = engine.state.pendingChoice;
  if (pending?.kind === "chooserSelectsTarget") {
    engine.perform({
      type: "resolvePendingChoice",
      playerId,
      choice: { kind: "chooserSelectsTarget", selected: [cardId], faceDown }
    });
    pending = engine.state.pendingChoice;
  }
  if (pending?.kind === "playResource") {
    engine.perform({ type: "resolvePendingChoice", playerId, choice: { kind: "playResource", faceDown } });
  }
}

/**
 * Answers what a real turn start raises, until something else is pending: the order of the faction's Restore Rule
 * and Develop Rule (Restore first, then any other trigger in the order offered), then the Develop Rule's options
 * (the Develop Rule cannot be skipped: it draws). A resource-play is left to `developPlay`, which needs a card.
 */
export function settleTurnStart(engine: SpoilsEngine, _develop: "draw" = "draw"): void {
  for (let guard = 0; guard < 20; guard++) {
    const pending = engine.state.pendingChoice;
    if (!pending) return;
    if (pending.kind === "orderTriggers") {
      const next =
        pending.triggers.find(trigger => trigger.abilityId === "restoreRule") ?? pending.triggers[0];
      engine.perform({
        type: "resolvePendingChoice",
        playerId: pending.playerId,
        choice: { kind: "orderTriggers", next }
      });
    } else if (
      pending.kind === "chooserSelectsOption" &&
      isDevelopChoice(pending)
    ) {
      pickOption(engine, pending.playerId, /^Draw /);
    } else {
      return;
    }
  }
}

/** Answers the Develop Rule's option prompt that is already pending (a real turn start) with the option labelled `label`. */
export function chooseDevelopOption(engine: SpoilsEngine, playerId: PlayerId, label: string | RegExp): void {
  pickOption(engine, playerId, label);
}

/**
 * A REAL turn start: orders the pending start-of-turn triggers (Restore, then the Develop Rule, then the rest),
 * then plays `cardId` as the Develop Rule's resource, as `developPlay` does for a fixture.
 */
export function developPlayAtTurnStart(
  engine: SpoilsEngine,
  playerId: PlayerId,
  cardId: CardInstanceId,
  faceDown = false
): void {
  for (let guard = 0; guard < 20; guard++) {
    const pending = engine.state.pendingChoice;
    if (pending?.kind !== "orderTriggers") break;
    const next =
      pending.triggers.find(trigger => trigger.abilityId === "restoreRule") ??
      pending.triggers.find(trigger => trigger.abilityId === "developRule") ??
      pending.triggers[0];
    engine.perform({ type: "resolvePendingChoice", playerId, choice: { kind: "orderTriggers", next } });
  }
  pickOption(engine, playerId, /^Play /);
  let pending = engine.state.pendingChoice;
  if (pending?.kind === "chooserSelectsTarget") {
    engine.perform({
      type: "resolvePendingChoice",
      playerId,
      choice: { kind: "chooserSelectsTarget", selected: [cardId], faceDown }
    });
    pending = engine.state.pendingChoice;
  }
  if (pending?.kind === "playResource") {
    engine.perform({ type: "resolvePendingChoice", playerId, choice: { kind: "playResource", faceDown } });
  }
}

/**
 * A REAL turn start: orders the pending start-of-turn triggers (Restore first, then the rest in the order offered)
 * until the Develop Rule's option prompt is open, and returns its labels (the prompt is left pending, so a test can
 * answer it with `chooseDevelopOption`). Throws if the Develop Rule never asks.
 */
export function orderUntilDevelopPrompt(engine: SpoilsEngine): string[] {
  for (let guard = 0; guard < 20; guard++) {
    const pending = engine.state.pendingChoice;
    if (pending?.kind === "chooserSelectsOption" && isDevelopChoice(pending)) {
      return pending.options.map(option => option.label ?? "");
    }
    if (pending?.kind !== "orderTriggers") {
      throw new Error(`Expected the turn start's trigger order or Develop Rule, found ${pending?.kind ?? "nothing"}.`);
    }
    const next = pending.triggers.find(trigger => trigger.abilityId === "restoreRule") ?? pending.triggers[0];
    engine.perform({ type: "resolvePendingChoice", playerId: pending.playerId, choice: { kind: "orderTriggers", next } });
  }
  throw new Error("The Develop Rule's options never came up.");
}
