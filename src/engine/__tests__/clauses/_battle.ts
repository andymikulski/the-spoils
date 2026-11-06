// Shared battle / keyword helpers for clause tests (docs/TESTING.md),
// from the open-beta-01 pilot. The COVERT checks are whole clause bodies:
// call them inside your own `clause(...)` so coverage stays visible in your
// batch file, e.g.
//
//   clause(MY_CARD, "0:kw:COVERT", "cannot be blocked by non-covert characters; covert ones can", () => covertCannotBeBlockedByNonCovert(MY_CARD));

import assert from "node:assert/strict";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import { autoResolveBattle, buildGame, character, developFaction, P1, P2, resolvePendingResponses } from "../per-card/_harness.js";
import { declineAll, drain, printing, type PendingChoiceLike } from "./_clause.js";

const other = (player: PlayerId): PlayerId => (player === P1 ? P2 : P1);

/** Raw `playCard` WITHOUT draining the response window — for asserting what's true while the card waits for responses. (`play` from the harness drains it.) */
export function playRaw(
  engine: SpoilsEngine,
  player: PlayerId,
  cardId: CardInstanceId,
  opts: { selected?: Record<string, CardInstanceId[]>; variables?: Record<string, number>; mode?: number } = {}
): void {
  engine.perform({
    type: "playCard",
    playerId: player,
    cardId,
    selected: opts.selected ?? {},
    variables: opts.variables ?? {},
    ...(opts.mode !== undefined ? { mode: opts.mode } : {})
  } as never);
}

/** The current battle, read through a function so TypeScript doesn't keep a narrowing from an earlier assertion. */
export const battleOf = (engine: SpoilsEngine) => engine.state.battle;

/** `player` attacks the opponent's faction (or `target`) with `attackerIds`; the declaration's response window is drained, so blockers can be declared next. */
export function declareAttackBy(
  engine: SpoilsEngine,
  player: PlayerId,
  attackerIds: CardInstanceId[],
  target: { type: "faction"; playerId: PlayerId } | { type: "card"; cardId: CardInstanceId } = { type: "faction", playerId: other(player) }
): void {
  engine.perform({ type: "declareAttack", playerId: player, attackerIds, target });
  resolvePendingResponses(engine);
}

/**
 * `player` attacks and passes priority, leaving the declaration's response
 * window OPEN with the defender holding priority — so the defender can use an
 * ability or play a tactic before blockers (`declareAttackBy` drains that
 * window). Afterwards drive the window yourself (`passPriority`, `advanceFlow`,
 * or `resolvePendingResponses`). From the 1st-edition-02 pilot.
 */
export function declareAttackOpenWindow(
  engine: SpoilsEngine,
  player: PlayerId,
  attackerIds: CardInstanceId[],
  target: { type: "faction"; playerId: PlayerId } | { type: "card"; cardId: CardInstanceId } = { type: "faction", playerId: other(player) }
): void {
  engine.perform({ type: "declareAttack", playerId: player, attackerIds, target });
  engine.perform({ type: "passPriority", playerId: player });
}

/** A whole battle: attack, the defender declares `blockers` (possibly none), and it resolves (`autoResolveBattle`). */
export function fight(
  engine: SpoilsEngine,
  attacker: PlayerId,
  attackers: CardInstanceId[],
  target: { type: "faction"; playerId: PlayerId } | { type: "card"; cardId: CardInstanceId },
  blockers: CardInstanceId[]
): void {
  declareAttackBy(engine, attacker, attackers, target);
  engine.perform({ type: "declareBlockers", playerId: other(attacker), blockerIds: blockers });
  autoResolveBattle(engine);
}

/**
 * Drives the current battle to its end, answering any pending choice on the
 * way with `answer` (default `declineAll`) — `autoResolveBattle` alone stalls,
 * without an error, on "order your triggers" prompts (two same-player
 * triggers at once). Asserts the battle finished. From the
 * 1st-edition-part-2-03 pilot.
 */
export function finishBattle(
  engine: SpoilsEngine,
  split?: Parameters<typeof autoResolveBattle>[1],
  answer: (pc: PendingChoiceLike) => unknown = declineAll
): void {
  let guard = 0;
  while ((engine.state.battle || engine.state.pendingChoice) && guard++ < 30) {
    if (engine.state.pendingChoice) drain(engine, answer);
    else autoResolveBattle(engine, split);
  }
  assert.equal(engine.state.battle, undefined, "the battle finished");
}

/** `fight`, but robust to pending choices (trigger ordering etc.) during the battle — see `finishBattle`. */
export function fightThrough(
  engine: SpoilsEngine,
  attacker: PlayerId,
  attackers: CardInstanceId[],
  target: { type: "faction"; playerId: PlayerId } | { type: "card"; cardId: CardInstanceId },
  blockers: CardInstanceId[],
  split?: Parameters<typeof autoResolveBattle>[1],
  answer?: (pc: PendingChoiceLike) => unknown
): void {
  declareAttackBy(engine, attacker, attackers, target);
  engine.perform({ type: "declareBlockers", playerId: other(attacker), blockerIds: blockers });
  finishBattle(engine, split, answer);
}

// --- COVERT (RULES.md §9, CR 507.3): a party made only of covert characters is a
// covert party; only covert characters may block it, and covert characters may
// block only covert parties. ----------------------------------------------------

function covertBoard(printingId: string, attacker: PlayerId) {
  const defender = other(attacker);
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: attacker,
    cards: [
      { key: "subject", def: printing(printingId), owner: attacker, zone: "play" },
      { key: "plainAlly", def: character({ name: "PlainAlly" }), owner: attacker, zone: "play" },
      { key: "plainBlocker", def: character({ name: "PlainBlocker" }), owner: defender, zone: "play" },
      { key: "covertBlocker", def: character({ name: "CovertBlocker", behavior: { keywords: ["covert"] } }), owner: defender, zone: "play" }
    ]
  });
}

/** The printing (in play) has COVERT; an ordinary character doesn't. */
export function covertHasKeyword(printingId: string): void {
  const { engine, id } = covertBoard(printingId, P1);
  assert.ok(engine.getKeywords(id("subject")).includes("covert"), "engine.getKeywords(id(\"subject\")).includes(\"covert\")");
  assert.equal(engine.getKeywords(id("plainAlly")).includes("covert"), false, "control: an ordinary character is not covert");
}

/** Attacking alone, it can't be blocked by a non-covert character (alone or alongside a covert one); a covert character can block it. */
export function covertCannotBeBlockedByNonCovert(printingId: string): void {
  const { engine, id } = covertBoard(printingId, P1);
  declareAttackBy(engine, P1, [id("subject")]);
  assert.throws(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("plainBlocker")] }), "a non-covert character cannot block a covert party");
  assert.throws(
    () => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("plainBlocker"), id("covertBlocker")] }),
    "...nor join a covert blocker in the blocking party"
  );
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("covertBlocker")] });
  assert.deepEqual(engine.state.battle?.blockingParty, [id("covertBlocker")], "a covert character may block it");
}

/** With a non-covert party member the party isn't covert, so anyone may block. */
export function covertPartyNeedsEveryMemberCovert(printingId: string): void {
  const { engine, id } = covertBoard(printingId, P1);
  declareAttackBy(engine, P1, [id("subject"), id("plainAlly")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("plainBlocker")] });
  assert.deepEqual(engine.state.battle?.blockingParty, [id("plainBlocker")], "a party with a non-covert member is not a covert party");
}

/** As a would-be blocker it can block only covert parties. */
export function covertBlocksOnlyCovertParties(printingId: string): void {
  const plain = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "subject", def: printing(printingId), owner: P1, zone: "play" },
      { key: "plainBlocker", def: character({ name: "PlainBlocker" }), owner: P1, zone: "play" },
      { key: "plainAttacker", def: character({ name: "PlainAttacker" }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(plain.engine, P2, [plain.id("plainAttacker")]);
  assert.throws(() => plain.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [plain.id("subject")] }), "a covert character may block only a covert party");
  plain.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [plain.id("plainBlocker")] });
  assert.deepEqual(plain.engine.state.battle?.blockingParty, [plain.id("plainBlocker")], "control: a plain character can block the plain attacker");

  const covert = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "subject", def: printing(printingId), owner: P1, zone: "play" },
      { key: "covertAttacker", def: character({ name: "CovertAttacker", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(covert.engine, P2, [covert.id("covertAttacker")]);
  covert.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [covert.id("subject")] });
  assert.deepEqual(covert.engine.state.battle?.blockingParty, [covert.id("subject")], "it can block a covert party");
}
