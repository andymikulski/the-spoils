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
 */
export function projectForDigest(state: GameState): Record<string, unknown> {
  const { gameLog: _gameLog, ...rules } = state;
  return rules;
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
