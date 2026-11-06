// Helpers for the rules-coverage suite (docs/TESTING.md): at least one test per
// atom of the Comprehensive Rules and the Rules FAQ (`_atoms.ts`), each written
// from the rule's WORDING and asserting what that wording says happens.
//
// A rule the engine doesn't follow is a failing test: the engine is checked
// against the rules, not the rules against the engine.
//
//   rule(ids, title, fn)
//       A test that the engine follows the rule(s).
//   ruleMismatch(ids, findingId, title, fn)
//       The same test, for a rule the engine is known to get wrong. It is an
//       ordinary test that FAILS until the engine is fixed, tagged with the
//       finding that explains it (data/rule-tests/findings/<batch>.md). The
//       assertion is never weakened.
//   ruleOpen(ids, questionId, title, fn)
//       The rules documents don't settle this. Runs as `todo` and applies
//       nothing until the user answers question `questionId`
//       (data/rule-tests/QUESTIONS.md).
//   ruleExempt(ids, reason)
//       Declares atoms with no engine behavior to test (policy, physical card
//       layout, definitions fully covered by other atoms). Not a test; the
//       lead reviews every one.
//
// Ids are string literals such as "CR 408.3b" or "FAQ 7"; findings, questions
// and reasons are string literals too: `_coverage.test.ts` and the CLI find
// coverage by scanning the source.
//
// Unlike the clause suite this file does NOT answer the engine's prompts for
// the test: a rule test sees every pending choice and answers it itself.
// Board-building helpers come from ../support/fixtures.ts.

import assert from "node:assert/strict";
import { test } from "node:test";

type Ids = string | readonly string[];

function title(ids: Ids, text: string): string {
  return `[${(typeof ids === "string" ? [ids] : ids).join(" ")}] ${text}`;
}

/** A test that the engine follows the rule(s) `ids`. */
export function rule(ids: Ids, text: string, fn: () => void | Promise<void>): void {
  test(title(ids, text), fn);
}

/** A rule test the engine is known to fail: an ordinary (failing) test tagged with its finding. See the file header. */
export function ruleMismatch(ids: Ids, findingId: string, text: string, fn: () => void | Promise<void>): void {
  test(`${title(ids, text)} — MISMATCH ${findingId}`, fn);
}

/** A rule the documents leave open: runs as `todo` until the user answers `questionId`. */
export function ruleOpen(ids: Ids, questionId: string, text: string, fn: () => void | Promise<void>): void {
  test(`${title(ids, text)} — OPEN ${questionId}`, { todo: `OPEN: ${questionId}` }, fn);
}

/** Declares atoms `ids` as having nothing for the engine to do; `reason` says why. */
export function ruleExempt(ids: Ids, reason: string): void {
  if (!reason.trim()) throw new Error(`ruleExempt(): ${String(ids)} needs a reason`);
}

/**
 * Asserts the engine REFUSES `fn` for a game-rules reason. A bare
 * `assert.throws` also passes on "It is not your priority", an unknown card id
 * or a TypeError from a broken test, so a refusal test can pass for the wrong
 * reason. This rejects those. `pattern`, if given, must match the message and
 * replaces the wrong-reason check: use it when one of those IS the right
 * reason (e.g. /priority/ for "you can't respond to your own action").
 * Pair every refusal with a positive control that shows the same action works
 * when the rule's condition is met.
 */
export function refused(fn: () => unknown, why: string, pattern?: RegExp): void {
  assert.throws(
    () => {
      fn();
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.ok(!(error instanceof TypeError), `${why}: the test threw a TypeError (${message})`);
      if (pattern) {
        assert.match(message, pattern, `${why}: unexpected refusal reason (${message})`);
      } else {
        assert.ok(
          !/priority|not found|unknown|undefined|already ended|did not converge/i.test(message),
          `${why}: refused for the wrong reason (${message})`
        );
      }
      return true;
    },
    why
  );
}
