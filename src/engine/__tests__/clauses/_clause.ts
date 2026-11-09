// Helpers for the clause-coverage suite (docs/TESTING.md): one test per
// printed clause of every rules group (`_manifest.ts`), each written from the
// card's PRINTED text and asserting what that text says happens.
//
// A card that doesn't do what its text says is a broken card, and a broken
// card is a failing test — no exceptions for cards the engine claims to
// support.
//
//   clause(printingId, key | keys, title, fn)
//       A test proving the engine does what the clause says.
//   clauseMismatch(printingId, key | keys, findingId, title, fn)
//       The same test, for a clause the engine is known to get wrong. It is
//       an ordinary test — it FAILS until the card is fixed — tagged with the
//       finding that explains it (data/card-tests/findings/<batch>.md), so
//       every red test is traceable. The assertion is never weakened.
//       `npm run card-tests -- report` lists recorded vs unrecorded failures
//       and markers whose test now passes (finding fixed: drop the marker).
//   clauseUnimplemented(printingId, key | keys, reason, title, fn)
//       Only for printings data/card-fidelity.json marks `stub` / `partial`
//       — the few cards the engine knowingly doesn't support (they are
//       blocked from play). Runs as `todo`. The gate rejects it anywhere else.
//   exempt(printingId, key | keys, reason)
//       Declares a clause that has no engine behavior to test. Not a test.
//
// The printing id must be a string literal or a same-file `const NAME =
// "<id>"`; keys, finding ids and reasons must be string literals:
// `_coverage.test.ts` and the CLI find coverage by scanning the source.
//
// Multiplayer clause tests (clauses/mp/*.test.ts) use their own helpers, which the
// `mp-coverage.test.ts` gate enumerates at load time (no source scan, so tests may be
// generated in loops over seat counts):
//   mpClause(printingId, key | keys, seats, title, fn)
//       A `seats`-seat test of the clause (the gate counts 3 and 4). The title is free text.
//   mpClauseMismatch(printingId, key | keys, seats, findingId, title, fn)
//       The same, for a clause the engine is known to get wrong (as clauseMismatch).
//   mpExempt(printingId, key | keys, reason)
//       Declares an `mp` clause that has no multiplayer behavior to test, at any seat count.
//
// Board-building helpers come from ../per-card/_harness.ts; `printing(id)`
// gives the exact catalog printing under test.

import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { test } from "node:test";
import { CATALOG } from "./_manifest.js";
import { resolvePendingResponses } from "../support/fixtures.js";
import { holdCostChoices, holdResourceFace, holds, withoutDevelopChoices } from "./_hold.js";
import { DEVELOP_RULE_ABILITY_ID } from "../../../engine.js";
import type { CardDefinition, SpoilsEngine } from "../../../engine.js";
import { SpoilsEngine as EngineClass } from "../../SpoilsEngine.js";

const BY_ID = new Map(CATALOG.map((card) => [card.id, card]));

// --- prompts the suite answers by itself unless a test is about them ------------
//
// Three prompts were added when player choices stopped being made by the engine (E6):
//  * "play a resource" with an actual resource card asks face-up / face-down (a `playResource` pending choice, CR 203.2);
//  * a cost that destroys "a token / resource / card you control" asks WHICH one (a `chooserSelectsTarget` whose declaration
//    id starts with `__costDestroy`), when more than one card qualifies;
//  * a `oneOf` cost ("Pay 1 or destroy a token") asks which branch (a `chooserSelectsOption` carrying `resumeVariable`),
//    when more than one branch can be paid.
// Almost every test only cares that the cost is paid / the resource is in play, so after every `perform` the suite answers
// these three itself the way the old engine did (resource face-up, the first qualifying card, the first payable branch).
// A test about a prompt itself wraps its steps in `holdResourceFace(() => ...)` / `holdCostChoices(() => ...)` to see and
// answer it.
export { holdResourceFace, holdCostChoices };
type AutoPrompt = {
  kind: string;
  playerId: string;
  declaration?: { id: string; selector: unknown };
  context?: unknown;
  resumeAction?: { selected?: Record<string, string[]> };
  resumeVariable?: string;
  optionCount?: number;
};
{
  const proto = EngineClass.prototype as unknown as { perform(action: unknown): void; targetCandidates(selector: unknown, context: unknown, pickerId: string): Array<{ id: string }> };
  const original = proto.perform;
  proto.perform = function (this: SpoilsEngine, action: unknown): void {
    original.call(this, action);
    const engine = this as unknown as typeof proto;
    let guard = 0;
    while (guard++ < 30) {
      const pc = this.state.pendingChoice as unknown as AutoPrompt | undefined;
      if (!pc) break;
      if (!holds.face && pc.kind === "playResource") {
        original.call(this, { type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "playResource", faceDown: false } });
      } else if (!holds.cost && pc.kind === "chooserSelectsTarget" && pc.resumeAction && pc.declaration?.id.startsWith("__costDestroy")) {
        const taken = new Set(Object.entries(pc.resumeAction.selected ?? {}).filter(([key]) => key.startsWith("__costDestroy")).flatMap(([, ids]) => ids));
        // Numeric costs are paid LAST (CR 406.3a), so a player destroying "a resource" keeps the ready ones for
        // the payment: offer the spent (attached) cards first, and if the play is refused with one, the next.
        const all = engine
          .targetCandidates(pc.declaration.selector, pc.context, pc.playerId)
          .filter((card) => !taken.has(card.id));
        const spentFirst = [...all].sort(
          (a, b) => Number((b as unknown as { attachedTo?: string }).attachedTo !== undefined) - Number((a as unknown as { attachedTo?: string }).attachedTo !== undefined)
        );
        if (spentFirst.length === 0) break;
        let answered = false;
        for (const candidate of spentFirst) {
          try {
            original.call(this, { type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsTarget", selected: [candidate.id] } });
            answered = true;
            break;
          } catch {
            /* that card cannot be destroyed for this play: try the next one */
          }
        }
        if (!answered) break;
      } else if (!holds.cost && pc.kind === "chooserSelectsOption" && pc.resumeVariable) {
        let answered = false;
        for (let index = 0; index < (pc.optionCount ?? 0) && !answered; index++) {
          try {
            original.call(this, { type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsOption", index } });
            answered = true;
          } catch {
            /* that branch cannot be paid: try the next one */
          }
        }
        if (!answered) break;
      } else {
        break;
      }
    }
  };
}

/** The exact catalog printing `id` — the card under test. Throws on an unknown id. */
export function printing(id: string): CardDefinition {
  const card = BY_ID.get(id);
  if (!card) throw new Error(`No printing with id ${id}`);
  return card;
}

type Keys = string | readonly string[];

function title(printingId: string, keys: Keys, text: string): string {
  const card = BY_ID.get(printingId);
  const keyList = (typeof keys === "string" ? [keys] : keys).join(" ");
  return `${card ? `${card.name} (${card.set})` : printingId} [${keyList}] ${text}`;
}

/** Runs the engine's continuous state-based check once, for a board that was set straight into play (no action has run it yet): a card placed at 0 life is destroyed, as in a real game. */
export function settleState(engine: SpoilsEngine): void {
  (engine as unknown as { checkStateBasedActions(): void }).checkStateBasedActions();
}

// --- multiplayer enumeration --------------------------------------------------------
//
// While `collectMpClauses` loads the clauses/mp test files, the helpers below record each call and register no
// test, so the gate can list every multiplayer test without running (or double-running) any of them.

/** One multiplayer clause test (or exemption) as called from a clauses/mp test file. */
export interface MpClauseRef {
  fn: "mpClause" | "mpClauseMismatch" | "mpExempt";
  printingId: string;
  keys: string[];
  /** The table size the test runs at; undefined for an exemption (covers every size). */
  seats?: number;
  title?: string;
  /** mpClauseMismatch: the finding id. mpExempt: the reason. */
  note?: string;
}

let collecting: MpClauseRef[] | undefined;

/** Runs `load` (which imports the mp test files) and returns every multiplayer helper call it made; no test is registered meanwhile. */
export async function collectMpClauses(load: () => Promise<unknown>): Promise<MpClauseRef[]> {
  collecting = [];
  try {
    await load();
    return collecting;
  } finally {
    collecting = undefined;
  }
}

/** A test that the engine does what clause `keys` of printing `printingId` says. */
export function clause(printingId: string, keys: Keys, text: string, fn: () => void | Promise<void>): void {
  if (collecting) return;
  test(title(printingId, keys, text), fn);
}

const asList = (keys: Keys): string[] => (typeof keys === "string" ? [keys] : [...keys]);

function checkSeats(fn: string, printingId: string, seats: number): void {
  if (!Number.isInteger(seats) || seats < 2 || seats > 6) throw new Error(`${fn}(): ${printingId} seats must be a table size from 2 to 6, got ${seats}`);
}

/** A test, at a `seats`-seat table (the gate counts 3 and 4; 2 covers a table down to one opponent), that the engine does what clause `keys` of printing `printingId` says for several opponents. */
export function mpClause(printingId: string, keys: Keys, seats: number, text: string, fn: () => void | Promise<void>): void {
  checkSeats("mpClause", printingId, seats);
  if (collecting) {
    collecting.push({ fn: "mpClause", printingId, keys: asList(keys), seats, title: text });
    return;
  }
  test(title(printingId, keys, text), fn);
}

/** An mpClause test the engine is known to fail: an ordinary failing test tagged with its finding (as clauseMismatch). */
export function mpClauseMismatch(printingId: string, keys: Keys, seats: number, findingId: string, text: string, fn: () => void | Promise<void>): void {
  checkSeats("mpClauseMismatch", printingId, seats);
  if (collecting) {
    collecting.push({ fn: "mpClauseMismatch", printingId, keys: asList(keys), seats, title: text, note: findingId });
    return;
  }
  test(`${title(printingId, keys, text)} — MISMATCH ${findingId}`, fn);
}

/** Declares `mp` clause `keys` as having no multiplayer behavior for the engine to do, at any table size; `reason` says why. */
export function mpExempt(printingId: string, keys: Keys, reason: string): void {
  if (!BY_ID.has(printingId)) throw new Error(`mpExempt(): no printing with id ${printingId}`);
  if (!reason.trim()) throw new Error(`mpExempt(): ${printingId} needs a reason`);
  collecting?.push({ fn: "mpExempt", printingId, keys: asList(keys), note: reason });
}

/** A clause test the engine is known to fail — an ordinary (failing) test tagged with its finding. See the file header. */
export function clauseMismatch(
  printingId: string,
  keys: Keys,
  findingId: string,
  text: string,
  fn: () => void | Promise<void>
): void {
  if (collecting) return;
  test(`${title(printingId, keys, text)} — MISMATCH ${findingId}`, fn);
}

/** A clause of a `stub` / `partial` fidelity printing the engine knowingly doesn't support — runs as `todo`. See the file header. */
export function clauseUnimplemented(
  printingId: string,
  keys: Keys,
  reason: string,
  text: string,
  fn: () => void | Promise<void>
): void {
  if (collecting) return;
  test(`${title(printingId, keys, text)} — UNIMPLEMENTED`, { todo: `UNIMPLEMENTED: ${reason}` }, fn);
}

/** Declares clause `keys` as having nothing for the engine to do; `reason` says why. */
export function exempt(printingId: string, keys: Keys, reason: string): void {
  if (!BY_ID.has(printingId)) throw new Error(`exempt(): no printing with id ${printingId}`);
  if (!reason.trim()) throw new Error(`exempt(): ${printingId} needs a reason`);
}

/**
 * Asserts the engine REFUSES `fn` for a game-rules reason. A bare
 * `assert.throws` also passes when the throw is "It is not your priority",
 * an unknown card id, or a TypeError from a broken test, so a refusal test
 * can pass for the wrong reason. This rejects those. `pattern`, if given,
 * must match the error message, and replaces the wrong-reason check: use it
 * when one of those IS the right reason (e.g. /priority/ for "you can't
 * respond to your own action"). (From the open-beta-06 pilot.)
 */
/** Refusal audit: with CLAUSE_REFUSAL_LOG=<file>, every refusal is appended there as a JSON line. */
function logRefusal(why: string, pattern: RegExp | undefined, message: string): void {
  const site = (new Error().stack ?? "").split("\n").find((line) => /clauses[\\/][^\\/]+\.test\.ts/.test(line) && !/_clause\.ts/.test(line));
  const where = site?.match(/clauses[\\/]([^\\/]+\.test\.ts):(\d+)/);
  appendFileSync(
    process.env.CLAUSE_REFUSAL_LOG!,
    JSON.stringify({ file: where?.[1], line: where ? Number(where[2]) : undefined, why, pattern: pattern?.source ?? null, message }) + "\n"
  );
}

export function refused(fn: () => unknown, why = "the engine refuses it", pattern?: RegExp): void {
  assert.throws(
    () => {
      fn();
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (process.env.CLAUSE_REFUSAL_LOG) logRefusal(why, pattern, message);
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


/**
 * Performs a FLIP UP and then lets it resolve: flipping up is deploying the card (CR 507.4a), so it sits on the response
 * stack until the opponent passes. Passes for the responder and advances once, resolving only the flipped card. Tests
 * about the response window itself use a raw `engine.perform` instead.
 */
let holdFlipUps = false;
/** Runs `fn` with `flipUpNow` leaving the flipped card on the stack (for tests about the FLIP UP response window). */
export function holdFlipUp(fn: () => void): void {
  holdFlipUps = true;
  try {
    fn();
  } finally {
    holdFlipUps = false;
  }
}
export function flipUpNow(engine: SpoilsEngine, action: unknown): void {
  engine.perform(action as never);
  if (holdFlipUps) return;
  const st = engine.state;
  const top = st.responseStack[st.responseStack.length - 1];
  const win = st.responseWindow;
  if (top && top.kind === "card" && top.sourceId === (action as { cardId: string }).cardId && win?.phase === "acceptingResponses" && !st.pendingChoice) {
    engine.perform({ type: "passPriority", playerId: win.priorityPlayerId } as never);
    engine.perform({ type: "advanceFlow" } as never);
  }
}

// --- pending-choice driving (same helpers the per-card set files define) -----

export type PendingChoiceLike = { kind: string; playerId: string; [key: string]: unknown };

/** Whether `pc` is the Develop Rule's option prompt (a real turn start raises it): the `developRule` trigger's `chooserSelectsOption`. */
export const isDevelopRuleOffer = (pc: { kind: string; [key: string]: unknown }): boolean =>
  pc.kind === "chooserSelectsOption" && (pc.context as { abilityId?: string } | undefined)?.abilityId === DEVELOP_RULE_ABILITY_ID;
/** The option that draws, on a Develop Rule prompt (the Develop Rule cannot be skipped: it draws or plays a resource). */
const drawDevelopIndex = (pc: { [key: string]: unknown }): number =>
  ((pc.options as Array<{ label?: string }>) ?? []).findIndex((o) => /^Draw /.test(o.label ?? ""));

export { withoutDevelopChoices };

/** Answers open pending choices with `answerFor` until none is left (or `budget` runs out), draining response windows between. */
export function drain(engine: SpoilsEngine, answerFor: (pc: PendingChoiceLike) => unknown, budget = 40): void {
  let n = 0;
  let stuck = 0;
  // Let an open response window (e.g. the one after "end turn") close first: end-of-turn triggers
  // fire only when the turn actually ends (CR 610.1a), so their prompts come after that window.
  if (!engine.state.pendingChoice && engine.state.responseWindow?.kind === "endTurn") resolvePendingResponses(engine);
  while (engine.state.pendingChoice && n++ < budget) {
    const pc = engine.state.pendingChoice as unknown as PendingChoiceLike;
    const before = JSON.stringify(pc);
    // A turn start's Develop Rule is offered alongside the cards' own start-of-turn prompts: it is not what `answerFor` drives, so draw.
    const choice = isDevelopRuleOffer(pc) ? { kind: "chooserSelectsOption", index: drawDevelopIndex(pc) } : answerFor(pc);
    const answer = (): void => {
      engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
      resolvePendingResponses(engine);
    };
    if (isDevelopRuleOffer(pc)) answer();
    else withoutDevelopChoices(engine, answer);
    // Fail fast when the answer can't get past the prompt (the same prompt comes back unchanged), instead of spinning
    // until the budget runs out. A small budget used to step one prompt at a time still works.
    stuck = engine.state.pendingChoice && JSON.stringify(engine.state.pendingChoice) === before ? stuck + 1 : 0;
    if (stuck >= 3) throw new Error(`drain(): the answer doesn't get past a pending "${pc.kind}" for ${pc.playerId}`);
  }
}

/** The "say no / pick nothing / take the default" answer for any pending choice kind. */
export const declineAll = (pc: { kind: string; [key: string]: unknown }): unknown => {
  switch (pc.kind) {
    case "mayPay":
      return { kind: "mayPay", pay: false };
    case "alternatingPay":
      return { kind: "alternatingPay", pay: false };
    case "anyPlayerMayPay":
      return { kind: "anyPlayerMayPay", pay: false };
    case "chooserSelectsTarget":
      return { kind: "chooserSelectsTarget", selected: [] };
    case "chooserSelectsOption":
      // the turn start's Develop Rule cannot be declined: it draws
      return { kind: "chooserSelectsOption", index: isDevelopRuleOffer(pc) ? drawDevelopIndex(pc) : 0 };
    case "selectTargets": {
      const selected: Record<string, string[]> = {};
      for (const d of (pc.declarations as { id: string }[] | undefined) ?? []) selected[d.id] = [];
      return { kind: "selectTargets", selected };
    }
    case "selectDeployTargets": {
      const selected: Record<string, string[]> = {};
      for (const d of (pc.declarations as { id: string }[] | undefined) ?? []) selected[d.id] = [];
      return { kind: "selectDeployTargets", selected };
    }
    case "distributeAmong":
      return { kind: "distributeAmong", shares: {} };
    case "chooseNumber":
      return { kind: "chooseNumber", value: (pc.min as number) ?? 0 };
    case "reorderDeck": {
      // "put one of them into your hand" (intoHand): take the fewest the card allows, the rest go to the bottom in order
      const intoHand = pc.intoHand as { min: number } | undefined;
      if (intoHand) {
        const ids = [...((pc.cardIds as string[]) ?? [])];
        return { kind: "reorderDeck", order: ids.slice(intoHand.min), hand: ids.slice(0, intoHand.min) };
      }
      return {
        kind: "reorderDeck",
        // "up to the top N" / "you may put it on the bottom": declining is looking at (moving) none of them
        order: pc.to === "split" || pc.upTo === true ? [] : [...((pc.cardIds as string[]) ?? [])],
        bottom: pc.to === "split" ? [...((pc.cardIds as string[]) ?? [])] : undefined
      };
    }
    case "orderTriggers":
      return { kind: "orderTriggers", next: ((pc.triggers as unknown[]) ?? [])[0] };
    case "replacementChoice":
      return { kind: "replacementChoice", apply: false };
    case "chooseReplacement":
      return { kind: "chooseReplacement", index: 0 };
    case "millInsteadOfDamage":
      return { kind: "millInsteadOfDamage", count: 0 };
    case "coinFlipReplace":
      return { kind: "coinFlipReplace", reflip: false };
    case "nameValue":
      return { kind: "nameValue", value: pc.valueKind === "resourceIcon" ? "rage" : pc.valueKind === "trade" ? "warlord" : "Nonexistent" };
    case "playResource":
      return { kind: "playResource", faceDown: false };
    case "deployForFree":
      return { kind: "deployForFree" };
    case "spendCountersMenu":
      return { kind: "spendCountersMenu", done: true };
    default:
      return { kind: pc.kind };
  }
};
