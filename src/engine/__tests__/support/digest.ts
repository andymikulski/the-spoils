// A stable digest of a game's rules state, for replay tests (replay-2p.test.ts).
//
// The digest is SHA-256 of a canonical JSON rendering of `projectForDigest(state)`:
// object keys sorted, `undefined` values dropped (as JSON.stringify drops them),
// non-finite numbers rendered as null (as JSON does). Two states that differ in
// anything a rule can read produce different digests; the same state reached by a
// live game, a JSON round trip or a rebuilt-and-replayed game produces the same one.

import { createHash } from "node:crypto";
import type { GameState } from "../../../engine.js";

/** Hex characters kept from the SHA-256 (64 bits: ample for a few hundred thousand comparisons). */
export const DIGEST_LENGTH = 16;

/**
 * The part of `GameState` the digest covers. Every exclusion belongs here, each with its reason.
 *
 * - `gameLog`: the running log is a human-readable narration of events (wording, ordering of
 *   informational lines, per-viewer redaction text). No rule reads it, so a change in log wording
 *   is not a change in rules behavior and must not invalidate recorded replays.
 *
 * - `engineMemory`: what the engine carries between actions that no other field holds (waiting triggers,
 *   last-known information about departed cards). It joined the state after the corpus was recorded, when it
 *   was still engine-instance memory, so the recorded digests cannot cover it. It is derived from the actions
 *   already digested, and anything in it that changes what a rule does shows up in the digest of the very next
 *   step it affects. One part of it was in the recorded digests and stays covered: the resolution contexts of
 *   the parked effect frames, which the recording held inline in each frame (and in each frame's stack item).
 *   They are put back inline here, and the `contextId` that now names them is left out.
 *
 * Multiplayer bookkeeping that carries no information at two seats (docs/MULTIPLAYER-PLAN.md,
 * "Replay digest"). Each is fully determined by the rest of the state when there are two players,
 * so leaving it out cannot hide a two-player behavior change:
 *
 * - `seats`: with two players there is one possible circle; "clockwise from X" is the other player
 *   whichever way the two entries are ordered.
 * - `responseWindow.passed`: who has declined the top item. At two seats only the one opponent can
 *   decline, and their pass is already visible as the window's `phase` turning to "resolving".
 * - `responseWindow.resumeWith`: the maker of the item being resolved. At two seats that is always
 *   the opponent of the controller of the item beneath it, which `priorityPlayerId` then shows.
 * - `players[*].eliminated`: at two seats a player is eliminated only as the game ends, which
 *   `winner` already records.
 * - `createdBy` on lasting records (`CreatedByPlayer`): who created the record. It is read only when that
 *   player is eliminated and the game goes on, which never happens at two seats (the first loss ends the game).
 */
/** The `GameState` lists whose records carry `createdBy` (`CreatedByPlayer`). */
const CREATED_BY_RECORDS = [
  "modifiers",
  "keywordGrants",
  "keywordSuppressions",
  "playerKeywordGrants",
  "abilitySuppressions",
  "restrictions",
  "costReductions",
  "thresholdReductions",
  "numericCostModifiers",
  "outgoingDamageModifiers",
  "playRestrictions",
  "resourceGrants",
  "provideGrants",
  "cardTypeGrants",
  "subtypeGrants",
  "damageShields",
  "battleDamageTransforms",
  "damagePreventionWindows",
  "destructionRestrictionWindows",
  "controlGrants",
  "abilityGrants",
  "blockRestrictionGrants",
  "mustBlockGrants",
  "partyRestrictionGrants",
  "voidPlayGrants"
] as const satisfies ReadonlyArray<keyof GameState>;

export function projectForDigest(state: GameState): Record<string, unknown> {
  const { gameLog: _gameLog, seats: _seats, engineMemory: _engineMemory, ...rules } = state;
  const players: Record<string, unknown> = {};
  for (const [id, player] of Object.entries(state.players)) {
    const { eliminated: _eliminated, ...rest } = player;
    players[id] = rest;
  }
  const projected: Record<string, unknown> = { ...rules, players };
  projected.pendingEffectFrames = state.pendingEffectFrames.map(parked => {
    const { contextId, finishStackItem, ...frame } = parked;
    const context = state.engineMemory.contexts[contextId];
    return {
      ...frame,
      context,
      ...(finishStackItem ? { finishStackItem: { ...finishStackItem, effects: parked.effects, context } } : {})
    };
  });
  if (state.pendingCoinFlip) {
    const { contextId, ...flip } = state.pendingCoinFlip;
    projected.pendingCoinFlip = { ...flip, context: state.engineMemory.contexts[contextId] };
  }
  if (state.pendingChoice && "contextId" in state.pendingChoice) {
    const { contextId: _contextId, ...choice } = state.pendingChoice;
    projected.pendingChoice = choice;
  }
  if (state.responseWindow) {
    const { passed: _passed, resumeWith: _resumeWith, ...window } = state.responseWindow;
    projected.responseWindow = window;
  }
  for (const key of CREATED_BY_RECORDS) {
    projected[key] = (state[key] as Array<{ createdBy?: string }>).map(({ createdBy: _createdBy, ...record }) => record);
  }
  return projected;
}

const keyText = new Map<string, string>();

function quoted(key: string): string {
  let text = keyText.get(key);
  if (text === undefined) {
    text = JSON.stringify(key);
    if (keyText.size < 20000) keyText.set(key, text);
  }
  return text;
}

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      return Number.isFinite(value) ? String(value) : "null";
    case "boolean":
      return value ? "true" : "false";
    case "bigint":
      return value.toString();
    case "object":
      break;
    default:
      return "null";
  }

  if (Array.isArray(value)) {
    let text = "[";
    for (let i = 0; i < value.length; i++) {
      if (i > 0) text += ",";
      text += canonicalize(value[i]);
    }
    return text + "]";
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  let text = "{";
  let first = true;
  for (const key of keys) {
    const entry = record[key];
    if (entry === undefined || typeof entry === "function" || typeof entry === "symbol") continue;
    if (!first) text += ",";
    first = false;
    text += quoted(key) + ":" + canonicalize(entry);
  }
  return text + "}";
}

/** Canonical JSON text of any plain-data value (sorted keys, `undefined` properties dropped). */
export function canonicalJson(value: unknown): string {
  return canonicalize(value);
}

/** The digest of a game state: truncated SHA-256 of the canonical JSON of `projectForDigest(state)`. */
export function digestState(state: GameState): string {
  return createHash("sha256")
    .update(canonicalJson(projectForDigest(state)))
    .digest("hex")
    .slice(0, DIGEST_LENGTH);
}
