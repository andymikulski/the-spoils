// Batch seed-3-02, part p2 (groups 5-9, clauses not covered elsewhere).
// Every test is written from the PRINTED text of the printing under test.

import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, SpoilsEngine } from "../../../engine.js";
import { buildGame, activate, bank, character, developFaction, item, killTactic, location, P1, P2, play, resolvePendingResponses, tactic, volition } from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, declineAll, drain, printing, refused } from "./_clause.js";
import { battleOf, declareAttackBy, declareAttackOpenWindow, fightThrough, playRaw } from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, tokensOn, zoneOf } from "./_board.js";
import { endTurn, factionOf } from "./_turn.js";

type Pid = typeof P1 | typeof P2;
type Icon = "obsession" | "greed" | "elitism" | "deception" | "rage";
type Game = ReturnType<typeof buildGame>;
const handOf = (engine: SpoilsEngine, p: Pid): CardInstanceId[] => [...engine.state.players[p].hand];
const deckOf = (engine: SpoilsEngine, p: Pid): CardInstanceId[] => [...engine.state.players[p].deck];
const discardOf = (engine: SpoilsEngine, p: Pid): CardInstanceId[] => [...engine.state.players[p].discard];
const damageOf = (engine: SpoilsEngine, c: CardInstanceId): number => engine.state.cards[c].damage;
const controllerOf = (engine: SpoilsEngine, c: CardInstanceId) => engine.state.cards[c].controllerId;
const eventsOf = (engine: SpoilsEngine, type: string): Array<Record<string, unknown>> =>
  engine
    .getLog()
    .map((entry) => entry.event as unknown as Record<string, unknown> | undefined)
    .filter((event): event is Record<string, unknown> => !!event && event.type === type);

/** A tactic that does nothing: playing it opens a response window for the opponent. */
const nothingTactic = () => tactic({ name: "Nothing", cost: 0 });
/** "Destroy target <type> in play" (cost 0). */
const destroyTactic = (type: "character" | "item" | "location" = "character") =>
  tactic({
    name: `Destroy ${type}`,
    cost: 0,
    behavior: {
      abilities: [
        { id: "d", type: "activated", targets: [{ id: "t", selector: { zone: "play", type }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }
      ]
    }
  });
/** "Inflict <amount> damage to target character" (cost 0). */
const zapTactic = (amount: number) =>
  tactic({
    name: `Zap ${amount}`,
    cost: 0,
    behavior: {
      abilities: [
        { id: "z", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }] }
      ]
    }
  });
/** "Put a token on target character" (cost 0). */
const addTokenTactic = () =>
  tactic({
    name: "Add Token",
    cost: 0,
    behavior: {
      abilities: [
        { id: "a", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "addCounter", target: { type: "selected", id: "t" }, counter: "token", amount: 1 }] }
      ]
    }
  });
/** "Return target character to its owner's hand" (cost 0). */
const bounceTactic = () =>
  tactic({
    name: "Bounce",
    cost: 0,
    behavior: {
      abilities: [
        { id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }
      ]
    }
  });

/** `n` resources of `icon` for `owner`, the first `spent` of them already spent (attached to the owner's faction). */
function bankSpent(icon: Icon, n: number, spent: number, owner: Pid = P1): CardPlacement[] {
  return bank(icon, n, owner).map((placement, index) => (index < spent ? { ...placement, attachedToKey: owner === P1 ? "__factionA" : "__factionB" } : placement));
}

// --- UNIQUE (RULES.md §9, CR 507.5): shared board and bodies --------------------

function uniqueBoard(pid: string, icon: Icon, n: number, over: { oldCounters?: Record<string, number>; noOld?: boolean; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      ...(over.noOld ? [] : [{ key: "old", def: printing(pid), owner: P1, zone: "play" as const, counters: over.oldCounters ?? {} }]),
      { key: "new", def: printing(pid), owner: P1, zone: "hand" },
      ...bank(icon, n, P1),
      ...(over.extra ?? [])
    ]
  });
}
const keepSurvivor = (engine: SpoilsEngine, keep: CardInstanceId): void =>
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep } } as never);

function uniqueKeepNew(pid: string, icon: Icon, n: number, oldCounters: Record<string, number> = {}): void {
  const g = uniqueBoard(pid, icon, n, { oldCounters });
  play(g.engine, P1, g.id("new"));
  const pc = pending(g.engine);
  assert.ok(pc, "a choice is pending");
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [g.id("old"), g.id("new")].sort());
  keepSurvivor(g.engine, g.id("new"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("new")), "play");
  assert.equal(zoneOf(g.engine, g.id("old")), "discard", "the extra copy is destroyed");
}
function uniqueKeepOld(pid: string, icon: Icon, n: number, oldCounters: Record<string, number> = {}): void {
  const g = uniqueBoard(pid, icon, n, { oldCounters });
  play(g.engine, P1, g.id("new"));
  assert.equal(pending(g.engine)?.kind, "uniqueSurvivor");
  keepSurvivor(g.engine, g.id("old"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("old")), "play");
  assert.equal(zoneOf(g.engine, g.id("new")), "discard");
  for (const [counter, count] of Object.entries(oldCounters)) assert.equal(g.engine.state.cards[g.id("old")].counters[counter], count, "the survivor keeps its counters");
}
function uniqueBystanderRefused(pid: string, icon: Icon, n: number): void {
  const g = uniqueBoard(pid, icon, n, { extra: [{ key: "by", def: character({ name: "Bystander" }), owner: P1, zone: "play" }] });
  play(g.engine, P1, g.id("new"));
  assert.equal(pending(g.engine)?.kind, "uniqueSurvivor");
  refused(() => keepSurvivor(g.engine, g.id("by")), "a bystander cannot be the survivor", /unique|survivor|candidate|keep|choice/i);
  assert.equal(zoneOf(g.engine, g.id("by")), "play");
  assert.equal(pending(g.engine)?.kind, "uniqueSurvivor", "still waiting for a legal choice");
  keepSurvivor(g.engine, g.id("new"));
  assert.equal(g.engine.state.pendingChoice, undefined, "control: a real candidate is accepted");
}
/** UNIQUE is per player and per identifier: the opponent's own copy and a different identifier are no problem. */
function uniqueScope(pid: string, icon: Icon, n: number): void {
  const theirs = uniqueBoard(pid, icon, n, { noOld: true, extra: [{ key: "theirs", def: printing(pid), owner: P2, zone: "play" }] });
  play(theirs.engine, P1, theirs.id("new"));
  assert.equal(theirs.engine.state.pendingChoice, undefined, "the opponent's copy does not count against me");
  assert.equal(zoneOf(theirs.engine, theirs.id("new")), "play");
  assert.equal(zoneOf(theirs.engine, theirs.id("theirs")), "play");
  const diff = uniqueBoard(pid, icon, n, { noOld: true, extra: [{ key: "other", def: character({ name: "Other Unique", unique: "somethingelse" }), owner: P1, zone: "play" }] });
  play(diff.engine, P1, diff.id("new"));
  assert.equal(diff.engine.state.pendingChoice, undefined, "a different identifier is not a second copy");
  assert.equal(zoneOf(diff.engine, diff.id("other")), "play");
  const two = uniqueBoard(pid, icon, n);
  play(two.engine, P1, two.id("new"));
  assert.equal(pending(two.engine)?.kind, "uniqueSurvivor", "control: my own second copy does prompt");
}
/** Once the survivor is chosen the deployment finishes: no stuck response window. */
function uniqueFinishes(pid: string, icon: Icon, n: number): void {
  const g = uniqueBoard(pid, icon, n);
  play(g.engine, P1, g.id("new"));
  assert.equal(pending(g.engine)?.kind, "uniqueSurvivor");
  keepSurvivor(g.engine, g.id("new"));
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.responseWindow, undefined, "no stuck response window");
  assert.equal(g.engine.state.pendingChoice, undefined);
}

/** Attacks with `atk` (P1) and tries to block it with `blk` (P2): true when the block is legal. */
function canBlock(game: Game, atkKey: string, blkKey: string): boolean {
  declareAttackBy(game.engine, P1, [game.id(atkKey)]);
  try {
    declareBlockers(game.engine, P2, [game.id(blkKey)]);
  } catch {
    return false;
  }
  return (battleOf(game.engine)?.blockingParty ?? []).includes(game.id(blkKey));
}

// =================================================================================
// Iohane, the Convex
// UNIQUE IOHANE. You may play this card whenever you could play a tactic. At the start of your turn, flip a coin. If you win, draw a card.
// SNEAK -- COST: Pay 1. -- EFFECT: This card gains COVERT this turn.
// Character, rogue, subtype iohane / sword of great justice, cost 1, threshold [D][D][D], 2/4/2 (str/spd/life).
// =================================================================================

const IOHANE = "eb80e2c7-ee2b-4699-b621-85b3576453e1";
const WIN = () => 0; // the coin is won when random() < 0.5
const LOSE = () => 0.99;

function ioBoard(opts: { deception?: number; rage?: number; spent?: number; active?: Pid; ioZone?: "hand" | "play"; random?: () => number; tactics?: boolean; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    random: opts.random,
    cards: [
      { key: "io", def: printing(IOHANE), owner: P1, zone: opts.ioZone ?? "hand" },
      ...bankSpent("deception", opts.deception ?? 3, opts.spent ?? 0, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...(opts.tactics === false
        ? []
        : [
            { key: "nothing", def: nothingTactic(), owner: P2, zone: "hand" as const },
            { key: "plain", def: character({ name: "PlainChar", cost: 0 }), owner: P1, zone: "hand" as const },
            { key: "oppAtk", def: character({ name: "OppAttacker", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" as const }
          ]),
      ...(opts.extra ?? [])
    ]
  });
}

clause(IOHANE, "0:unique", "has UNIQUE IOHANE: a second Iohane under my control makes me choose one to keep; keeping the new one destroys the old one", () => uniqueKeepNew(IOHANE, "deception", 3));
clause(IOHANE, "0:unique", "I can keep the older Iohane instead; the new one is destroyed", () => uniqueKeepOld(IOHANE, "deception", 3));
clause(IOHANE, "0:unique", "only a candidate can be kept: an unrelated card is refused and the choice stays open", () => uniqueBystanderRefused(IOHANE, "deception", 3));
clause(IOHANE, "0:unique", "UNIQUE is per player and per identifier: the opponent's own Iohane and a different identifier are no problem", () => uniqueScope(IOHANE, "deception", 3));
clause(IOHANE, "0:unique", "after I choose which Iohane to keep, the deployment finishes: the response window closes", () => uniqueFinishes(IOHANE, "deception", 3));

clause(IOHANE, "1:rule", "she has TACTICAL (an ordinary character does not), in hand", () => {
  const { engine, id } = ioBoard();
  assert.ok(engine.getKeywords(id("io")).includes("tactical"), "engine.getKeywords(id(\"io\")).includes(\"tactical\")");
  assert.equal(engine.getKeywords(id("plain")).includes("tactical"), false, "control: an ordinary character has no TACTICAL");
});

clause(IOHANE, "1:rule", "whenever a tactic could be played (in response on the opponent's turn) I can play her from my hand: she enters play under my control as a 2/4/2 and the cost of 1 is paid", () => {
  const g = ioBoard({ active: P2 });
  playRaw(g.engine, P2, g.id("nothing"));
  playRaw(g.engine, P1, g.id("io"));
  resolvePendingResponses(g.engine);
  const { engine, id } = g;
  assert.equal(zoneOf(engine, id("io")), "play");
  assert.equal(controllerOf(engine, id("io")), P1);
  assert.equal(engine.getStat(id("io"), "strength"), 2);
  assert.equal(engine.getStat(id("io"), "speed"), 4);
  assert.equal(engine.getStat(id("io"), "life"), 2);
  assert.equal(engine.getAvailableResourceCount(P1), 2, "one of my three resources was spent");
});

clause(IOHANE, "1:rule", "when no tactic could be played (the opponent's turn, nothing to respond to) she cannot be played; an ordinary character cannot be played in a response window", () => {
  const { engine, id } = ioBoard({ active: P2 });
  refused(() => playRaw(engine, P1, id("io")), "no window is open for me, and it is not my turn");
  assert.equal(zoneOf(engine, id("io")), "hand");
  playRaw(engine, P2, id("nothing"));
  refused(() => playRaw(engine, P1, id("plain")), "an ordinary character is not a tactic: not deployable in a response window");
  assert.equal(zoneOf(engine, id("plain")), "hand");
  playRaw(engine, P1, id("io"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("io")), "play", "control: she herself is deployable in the same window");
});

clause(IOHANE, "1:rule", "'may': on my own turn I can still play her at normal timing", () => {
  const { engine, id } = ioBoard({ active: P1 });
  play(engine, P1, id("io"));
  assert.equal(zoneOf(engine, id("io")), "play");
  assert.equal(engine.getAvailableResourceCount(P1), 2);
});

clause(IOHANE, "1:rule", "when the opponent declares an attack (response window) I can play her in response", () => {
  const g = ioBoard({ active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("oppAtk")]);
  playRaw(g.engine, P1, g.id("io"));
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("io")), "play", "deployed in the attack-declaration window");
  assert.equal(controllerOf(g.engine, g.id("io")), P1);
  declareBlockers(g.engine, P1, [g.id("io")]);
  assert.deepEqual(battleOf(g.engine)?.blockingParty, [g.id("io")], "and she can block the attack she was played against");
});

clause(IOHANE, "1:rule", "her cost of 1 is paid: with all three [D] resources already spent (threshold still met) she is refused, with one ready resource she is played", () => {
  const spent = ioBoard({ active: P2, spent: 3 });
  playRaw(spent.engine, P2, spent.id("nothing"));
  refused(() => playRaw(spent.engine, P1, spent.id("io")), "nothing left to pay the cost of 1 with", /cost|resource|afford|pay/i);
  assert.equal(zoneOf(spent.engine, spent.id("io")), "hand");
  const one = ioBoard({ active: P2, spent: 2 });
  playRaw(one.engine, P2, one.id("nothing"));
  playRaw(one.engine, P1, one.id("io"));
  resolvePendingResponses(one.engine);
  assert.equal(zoneOf(one.engine, one.id("io")), "play", "control: one ready resource is enough");
  assert.equal(one.engine.getAvailableResourceCount(P1), 0);
});

clause(IOHANE, "1:rule", "her threshold [D][D][D] is required at tactic timing: two [D] plus a rage, or three rage, are refused; three [D] are enough", () => {
  for (const [deception, rage] of [[2, 1], [0, 3], [1, 5]] as const) {
    const g = ioBoard({ active: P2, deception, rage });
    playRaw(g.engine, P2, g.id("nothing"));
    refused(() => playRaw(g.engine, P1, g.id("io")), `${deception} deception + ${rage} rage does not meet [D][D][D]`, /threshold|icon/i);
    assert.equal(zoneOf(g.engine, g.id("io")), "hand");
  }
  const ok = ioBoard({ active: P2, deception: 3, rage: 2 });
  playRaw(ok.engine, P2, ok.id("nothing"));
  playRaw(ok.engine, P1, ok.id("io"));
  resolvePendingResponses(ok.engine);
  assert.equal(zoneOf(ok.engine, ok.id("io")), "play", "control: three deception icons meet the threshold");
});

// --- At the start of your turn, flip a coin. If you win, draw a card. ------------

function ioCoinBoard(random: () => number, opts: { active?: Pid; ioZone?: "hand" | "play"; ioController?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P2,
    random,
    cards: [
      { key: "io", def: printing(IOHANE), owner: P1, controller: opts.ioController ?? P1, zone: opts.ioZone ?? "play" },
      ...fillers("md", 5, P1, "deck"),
      ...fillers("mh", 2, P1, "hand"),
      ...fillers("od", 5, P2, "deck"),
      ...fillers("oh", 2, P2, "hand")
    ]
  });
}

clause(IOHANE, "2:rule", "coin WON at the start of my turn: I draw exactly one card, the top card of my deck", () => {
  const { engine } = ioCoinBoard(WIN);
  const hand = handOf(engine, P1);
  const deck = deckOf(engine, P1);
  const oppHand = handOf(engine, P2);
  endTurn(engine, P2); // my turn starts
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(engine, P1), [...hand, deck[0]], "the top card of my deck joined my hand");
  assert.deepEqual(deckOf(engine, P1), deck.slice(1));
  assert.equal(handOf(engine, P2).length, oppHand.length + 0, "the opponent drew nothing");
});

clause(IOHANE, "2:rule", "coin LOST at the start of my turn: I draw nothing", () => {
  const { engine } = ioCoinBoard(LOSE);
  const hand = handOf(engine, P1);
  const deck = deckOf(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(engine, P1), hand);
  assert.deepEqual(deckOf(engine, P1), deck);
});

clause(IOHANE, "2:rule", "only at the start of MY turn: at the opponent's turn start no coin is flipped and I draw nothing, even with a winning coin", () => {
  const { engine } = ioCoinBoard(WIN, { active: P1 });
  const hand = handOf(engine, P1);
  const oppHand = handOf(engine, P2);
  endTurn(engine, P1); // the opponent's turn starts
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(engine, P1), hand, "I drew nothing at the opponent's turn start");
  assert.deepEqual(handOf(engine, P2), oppHand, "and neither did the opponent");
  assert.equal(eventsOf(engine, "coinFlipped").length + eventsOf(engine, "variableRolled").length, 0, "no coin was flipped at all");
});

clause(IOHANE, "2:rule", "it triggers every one of my turns while she is in play", () => {
  const { engine } = ioCoinBoard(WIN);
  const hand = handOf(engine, P1).length;
  endTurn(engine, P2); // my turn 1
  endTurn(engine, P1);
  endTurn(engine, P2); // my turn 2
  assert.equal(handOf(engine, P1).length, hand + 2, "one card at each of my two turn starts");
});

clause(IOHANE, "2:rule", "she must be in play: from my hand no coin is flipped and nothing is drawn, even with a winning coin", () => {
  const { engine } = ioCoinBoard(WIN, { ioZone: "hand" });
  const hand = handOf(engine, P1).length;
  endTurn(engine, P2);
  assert.equal(handOf(engine, P1).length, hand, "the hand is unchanged");
  assert.equal(deckOf(engine, P1).length, 5);
});

clause(IOHANE, "2:rule", "'your turn' is her controller's turn: a stolen Iohane draws for the player who controls her, not for her owner", () => {
  const { engine } = ioCoinBoard(WIN, { active: P1, ioController: P2 });
  const mine = handOf(engine, P1);
  const theirs = handOf(engine, P2);
  const theirDeck = deckOf(engine, P2);
  endTurn(engine, P1); // P2 (her controller) starts a turn
  assert.deepEqual(handOf(engine, P2), [...theirs, theirDeck[0]], "the controller draws");
  assert.deepEqual(handOf(engine, P1), mine, "the owner does not");
});

clause(IOHANE, "2:rule", "'flip a coin' is a real coin flip: the game records a coin flip by me, won or lost", () => {
  const won = ioCoinBoard(WIN);
  endTurn(won.engine, P2);
  const wonFlips = eventsOf(won.engine, "coinFlipped");
  assert.equal(wonFlips.length, 1, "exactly one coin was flipped");
  assert.equal(wonFlips[0].playerId, P1, "by me");
  assert.equal(wonFlips[0].won, true);
  const lost = ioCoinBoard(LOSE);
  endTurn(lost.engine, P2);
  const lostFlips = eventsOf(lost.engine, "coinFlipped");
  assert.equal(lostFlips.length, 1);
  assert.equal(lostFlips[0].won, false);
});

// --- SNEAK ----------------------------------------------------------------------

clause(IOHANE, "3:ability:iohane-sneak", "COST: Pay 1 — one resource is spent. EFFECT: she gains COVERT (before: not covert; another character is not affected)", () => {
  const { engine, id } = ioBoard({ ioZone: "play", extra: [{ key: "other", def: character({ name: "Other" }), owner: P1, zone: "play" }] });
  assert.equal(engine.getKeywords(id("io")).includes("covert"), false, "no COVERT before");
  assert.equal(engine.getAvailableResourceCount(P1), 3);
  activate(engine, P1, id("io"), "iohane-sneak");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.getAvailableResourceCount(P1), 2, "exactly one resource was paid");
  assert.ok(engine.getKeywords(id("io")).includes("covert"), "she gains COVERT");
  assert.equal(engine.getKeywords(id("other")).includes("covert"), false, "only 'this card' gains it");
  assert.equal(engine.state.cards[id("io")].depleted, false, "the cost is Pay 1 only: she is not depleted");
});

clause(IOHANE, "3:ability:iohane-sneak", "the cost must be payable: with every resource spent it is refused and she stays non-covert; with exactly one ready resource it works and leaves none", () => {
  const spent = ioBoard({ ioZone: "play", spent: 3 });
  refused(() => activate(spent.engine, P1, spent.id("io"), "iohane-sneak"), "no ready resource to Pay 1 with", /resource|pay|afford|cost/i);
  assert.equal(spent.engine.getKeywords(spent.id("io")).includes("covert"), false);
  const one = ioBoard({ ioZone: "play", spent: 2 });
  activate(one.engine, P1, one.id("io"), "iohane-sneak");
  assert.ok(one.engine.getKeywords(one.id("io")).includes("covert"), "control: one ready resource is enough");
  assert.equal(one.engine.getAvailableResourceCount(P1), 0);
});

clause(IOHANE, "3:ability:iohane-sneak", "no hidden cost: it can be used while she is depleted", () => {
  const { engine, id } = ioBoard({ ioZone: "play" });
  engine.state.cards[id("io")].depleted = true;
  activate(engine, P1, id("io"), "iohane-sneak");
  assert.ok(engine.getKeywords(id("io")).includes("covert"), "engine.getKeywords(id(\"io\")).includes(\"covert\")");
  assert.equal(engine.getAvailableResourceCount(P1), 2);
});

clause(IOHANE, "3:ability:iohane-sneak", "COVERT lasts this turn only: gone when the turn ends and still gone on my next turn", () => {
  const { engine, id } = ioBoard({ ioZone: "play", tactics: false });
  activate(engine, P1, id("io"), "iohane-sneak");
  assert.ok(engine.getKeywords(id("io")).includes("covert"), "engine.getKeywords(id(\"io\")).includes(\"covert\")");
  endTurn(engine, P1); // the opponent's turn
  assert.equal(engine.getKeywords(id("io")).includes("covert"), false, "the opponent's turn: no longer covert");
  endTurn(engine, P2); // my next turn
  assert.equal(engine.getKeywords(id("io")).includes("covert"), false, "my next turn: still not covert");
});

clause(IOHANE, "3:ability:iohane-sneak", "the COVERT is real in battle: after SNEAK a non-covert character cannot block her; without SNEAK it can", () => {
  const control = ioBoard({ ioZone: "play", extra: [{ key: "blk", def: character({ name: "Blocker" }), owner: P2, zone: "play" }] });
  assert.equal(canBlock(control, "io", "blk"), true, "control: an ordinary attacker can be blocked");
  const sneaky = ioBoard({ ioZone: "play", extra: [{ key: "blk", def: character({ name: "Blocker" }), owner: P2, zone: "play" }] });
  activate(sneaky.engine, P1, sneaky.id("io"), "iohane-sneak");
  assert.equal(canBlock(sneaky, "io", "blk"), false, "a COVERT attacker cannot be blocked by a non-covert character");
});

// =================================================================================
// Ipsighast, the Lustful
// UNIQUE IPSIGHAST. EXHUMATION -- COST: Pay 3. Pick a character in an opponent's discard pile. -- EFFECT: Remove that character from the game. This turn, this
// card gains COVERT. You may put the top 3 cards of that opponent's deck into their discard pile.
// Character, rogue, subtype ipsighast / demon knight, cost 3, threshold [D][D][D], 3/4/3.
// =================================================================================

const IPSI = "3b6e1bd0-98bb-423e-adcd-eda67697c487";

function ipsiBoard(opts: { deception?: number; oppDeck?: number; noCorpses?: boolean; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "ip", def: printing(IPSI), owner: P1, zone: "play" },
      ...(opts.noCorpses
        ? []
        : [
            { key: "corpse", def: character({ name: "Corpse" }), owner: P2, zone: "discard" as const },
            { key: "corpse2", def: character({ name: "Corpse Two" }), owner: P2, zone: "discard" as const }
          ]),
      ...fillers("od", opts.oppDeck ?? 5, P2, "deck"),
      ...fillers("md", 3, P1, "deck"),
      ...bank("deception", opts.deception ?? 3, P1),
      ...(opts.extra ?? [])
    ]
  });
}
const exhume = (g: Game, pick = "corpse") => activate(g.engine, P1, g.id("ip"), "ipsighast-exhume", { selected: { c: [g.id(pick)] } });

clause(IPSI, "0:unique", "has UNIQUE IPSIGHAST: a second Ipsighast under my control makes me choose one to keep; keeping the new one destroys the old one", () => uniqueKeepNew(IPSI, "deception", 3));
clause(IPSI, "0:unique", "I can keep the older Ipsighast instead; the new one is destroyed", () => uniqueKeepOld(IPSI, "deception", 3));
clause(IPSI, "0:unique", "only a candidate can be kept: an unrelated card is refused and the choice stays open", () => uniqueBystanderRefused(IPSI, "deception", 3));
clause(IPSI, "0:unique", "UNIQUE is per player and per identifier: the opponent's own Ipsighast and a different identifier are no problem", () => uniqueScope(IPSI, "deception", 3));
clause(IPSI, "0:unique", "after I choose which Ipsighast to keep, the deployment finishes: the response window closes", () => uniqueFinishes(IPSI, "deception", 3));

clause(IPSI, "1:ability:ipsighast-exhume", "COST: Pay 3 — three resources are spent (of five, two stay ready) and the ability resolves", () => {
  const g = ipsiBoard({ deception: 5 });
  assert.equal(g.engine.getAvailableResourceCount(P1), 5);
  exhume(g);
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(g.engine.getAvailableResourceCount(P1), 2, "exactly three were paid");
  assert.equal(zoneOf(g.engine, g.id("corpse")), "removed");
});

clause(IPSI, "1:ability:ipsighast-exhume", "the cost must be payable: with two resources it is refused and nothing happens; with exactly three it works", () => {
  const short = ipsiBoard({ deception: 2 });
  refused(() => exhume(short), "two resources are one short of Pay 3", /resource|pay|afford|cost/i);
  assert.equal(zoneOf(short.engine, short.id("corpse")), "discard");
  assert.equal(short.engine.getKeywords(short.id("ip")).includes("covert"), false);
  assert.equal(short.engine.getAvailableResourceCount(P1), 2);
  const exact = ipsiBoard({ deception: 3 });
  exhume(exact);
  answerPending(exact.engine, "mayPay", { pay: false });
  assert.equal(zoneOf(exact.engine, exact.id("corpse")), "removed");
  assert.equal(exact.engine.getAvailableResourceCount(P1), 0);
});

clause(IPSI, "1:ability:ipsighast-exhume", "Pick a character in an opponent's discard pile: any such character is pickable; own discard, other zones and non-characters are refused", () => {
  const extra: CardPlacement[] = [
    { key: "mine", def: character({ name: "MyCorpse" }), owner: P1, zone: "discard" },
    { key: "oppHand", def: character({ name: "OppHand" }), owner: P2, zone: "hand" },
    { key: "oppPlay", def: character({ name: "OppPlay" }), owner: P2, zone: "play" },
    { key: "oppDeckChar", def: character({ name: "OppDeckChar" }), owner: P2, zone: "deck" },
    { key: "oppItem", def: item({ name: "OppItem" }), owner: P2, zone: "discard" },
    { key: "oppTactic", def: tactic({ name: "OppTactic" }), owner: P2, zone: "discard" }
  ];
  for (const bad of ["mine", "oppHand", "oppPlay", "oppDeckChar", "oppItem", "oppTactic"]) {
    const g = ipsiBoard({ extra });
    refused(() => exhume(g, bad), `${bad} is not a character in an opponent's discard pile`);
    assert.equal(g.engine.getAvailableResourceCount(P1), 3, "a refused activation spends nothing");
    assert.equal(g.engine.state.cards[g.id(bad)].zone === "removed", false, `${bad} was not removed`);
  }
  for (const good of ["corpse", "corpse2"]) {
    const g = ipsiBoard({ extra });
    exhume(g, good);
    answerPending(g.engine, "mayPay", { pay: false });
    assert.equal(zoneOf(g.engine, g.id(good)), "removed", `${good} is pickable`);
  }
  const none = ipsiBoard({ noCorpses: true, extra });
  refused(() => activate(none.engine, P1, none.id("ip"), "ipsighast-exhume", { selected: {} }), "no character in an opponent's discard pile to pick");
  refused(() => activate(none.engine, P1, none.id("ip"), "ipsighast-exhume", { selected: { c: [] } }), "the pick is required");
});

clause(IPSI, "1:ability:ipsighast-exhume", "EFFECT: the picked character is removed from the game — not left in, or moved to, any pile — and the other discards stay", () => {
  const g = ipsiBoard();
  exhume(g);
  answerPending(g.engine, "mayPay", { pay: false });
  const { engine, id } = g;
  assert.equal(zoneOf(engine, id("corpse")), "removed");
  assert.equal(discardOf(engine, P2).includes(id("corpse")), false);
  assert.equal(handOf(engine, P2).includes(id("corpse")), false);
  assert.equal(deckOf(engine, P2).includes(id("corpse")), false);
  assert.equal(zoneOf(engine, id("corpse2")), "discard", "the other character in the pile is untouched");
  assert.deepEqual(discardOf(engine, P2), [id("corpse2")]);
});

clause(IPSI, "1:ability:ipsighast-exhume", "EFFECT: this turn, she gains COVERT (not before)", () => {
  const g = ipsiBoard({ extra: [{ key: "other", def: character({ name: "Other" }), owner: P1, zone: "play" }] });
  assert.equal(g.engine.getKeywords(g.id("ip")).includes("covert"), false);
  exhume(g);
  answerPending(g.engine, "mayPay", { pay: false });
  assert.ok(g.engine.getKeywords(g.id("ip")).includes("covert"), "g.engine.getKeywords(g.id(\"ip\")).includes(\"covert\")");
  assert.equal(g.engine.getKeywords(g.id("other")).includes("covert"), false, "only 'this card'");
});

clause(IPSI, "1:ability:ipsighast-exhume", "COVERT lasts this turn only: gone at the end of the turn and on my next turn", () => {
  const g = ipsiBoard();
  exhume(g);
  answerPending(g.engine, "mayPay", { pay: false });
  assert.ok(g.engine.getKeywords(g.id("ip")).includes("covert"), "g.engine.getKeywords(g.id(\"ip\")).includes(\"covert\")");
  endTurn(g.engine, P1);
  assert.equal(g.engine.getKeywords(g.id("ip")).includes("covert"), false, "the opponent's turn");
  endTurn(g.engine, P2);
  assert.equal(g.engine.getKeywords(g.id("ip")).includes("covert"), false, "my next turn");
});

clause(IPSI, "1:ability:ipsighast-exhume", "the COVERT is real in battle: after EXHUMATION a non-covert character cannot block her; without it, it can", () => {
  const blocker: CardPlacement = { key: "blk", def: character({ name: "Blocker" }), owner: P2, zone: "play" };
  const control = ipsiBoard({ extra: [blocker] });
  assert.equal(canBlock(control, "ip", "blk"), true, "control: an ordinary attacker can be blocked");
  const covert = ipsiBoard({ extra: [blocker] });
  exhume(covert);
  answerPending(covert.engine, "mayPay", { pay: false });
  assert.equal(canBlock(covert, "ip", "blk"), false, "a COVERT attacker cannot be blocked by a non-covert character");
});

clause(IPSI, "1:ability:ipsighast-exhume", "'You may put the top 3 cards...': I (the controller) am asked; accepting puts exactly the opponent's top 3 into their discard pile", () => {
  const g = ipsiBoard({ oppDeck: 5 });
  const top = deckOf(g.engine, P2);
  const mine = deckOf(g.engine, P1);
  exhume(g);
  const pc = pending(g.engine);
  assert.ok(pc, "a choice is pending");
  assert.equal(pc.kind, "mayPay");
  assert.equal(pc.playerId, P1, "I decide, not the opponent");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(g.engine, P2), top.slice(3), "the opponent's deck lost exactly its top 3 cards");
  const discard = discardOf(g.engine, P2);
  assert.deepEqual(top.slice(0, 3).filter((c) => !discard.includes(c)), [], "all three were put into their discard pile");
  assert.equal(discard.length, 4, "the three milled cards plus the character that was already there");
  assert.deepEqual(deckOf(g.engine, P1), mine, "my own deck is untouched");
  assert.equal(zoneOf(g.engine, g.id("corpse")), "removed", "the exhumed character is still removed from the game, not milled");
});

clause(IPSI, "1:ability:ipsighast-exhume", "'You may': declining mills nothing, but the character is still removed and she still gains COVERT", () => {
  const g = ipsiBoard({ oppDeck: 5 });
  const top = deckOf(g.engine, P2);
  exhume(g);
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(g.engine, P2), top, "the opponent's deck is untouched");
  assert.deepEqual(discardOf(g.engine, P2), [g.id("corpse2")]);
  assert.equal(zoneOf(g.engine, g.id("corpse")), "removed");
  assert.ok(g.engine.getKeywords(g.id("ip")).includes("covert"), "g.engine.getKeywords(g.id(\"ip\")).includes(\"covert\")");
});

clause(IPSI, "1:ability:ipsighast-exhume", "with fewer than 3 cards in their deck, accepting puts all of them into their discard pile (no error)", () => {
  const g = ipsiBoard({ oppDeck: 2 });
  const top = deckOf(g.engine, P2);
  exhume(g);
  answerPending(g.engine, "mayPay", { pay: true });
  assert.deepEqual(deckOf(g.engine, P2), []);
  const discard = discardOf(g.engine, P2);
  assert.deepEqual(top.filter((c) => !discard.includes(c)), []);
});

// =================================================================================
// Unscrupuls of Victory
// If you control at least [O][O], your opponent discards 1 card. If you control at least [G][G], draw 1 card. If you control at least [E][E], put 1 Micromajig token
// into play under your control. If you control at least [D][D], search your opponent's deck for 1 card and put it into their discard pile. If you control at
// least [R][R], you may pick a character. If you do, inflict 2 damage to it.
// Tactic, universal, cost 2.
// =================================================================================

const UV = "b91d33d1-aeed-4953-b57b-463204b25bc6";
type Icons = Partial<Record<Icon, number>>;
const ICONS: Icon[] = ["obsession", "greed", "elitism", "deception", "rage"];
const TWO_EACH: Icons = { obsession: 2, greed: 2, elitism: 2, deception: 2, rage: 2 };
const ONE_EACH: Icons = { obsession: 1, greed: 1, elitism: 1, deception: 1, rage: 1 };

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function uvBoard(icons: Icons, opts: { theirs?: Icons; faceDown?: number; oppHand?: number; oppDeck?: number; theirsLife?: number; random?: () => number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: opts.random,
    cards: [
      { key: "uv", def: printing(UV), owner: P1, zone: "hand" },
      ...fillers("oh", opts.oppHand ?? 3, P2, "hand"),
      ...fillers("od", opts.oppDeck ?? 5, P2, "deck"),
      ...fillers("md", 3, P1, "deck"),
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 5 }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Theirs", strength: 1, life: opts.theirsLife ?? 5 }), owner: P2, zone: "play" },
      ...ICONS.flatMap((icon) => bank(icon, icons[icon] ?? 0, P1)),
      ...ICONS.flatMap((icon) => bank(icon, opts.theirs?.[icon] ?? 0, P2)),
      ...volition(opts.faceDown ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

/** Plays the tactic and answers each prompt by its declaration id; returns who was asked what, in order. */
function uvRun(g: Game, picks: { d1?: string; d2?: string; d3?: string | null } = {}): Array<{ declaration: string; playerId: string }> {
  const seen: Array<{ declaration: string; playerId: string }> = [];
  playRaw(g.engine, P1, g.id("uv"));
  resolvePendingResponses(g.engine);
  drain(g.engine, (pc) => {
    const declaration = (pc.declaration as { id: string }).id;
    seen.push({ declaration, playerId: pc.playerId });
    const key = (picks as Record<string, string | null | undefined>)[declaration];
    return { kind: "chooserSelectsTarget", selected: key ? [g.id(key)] : [] };
  });
  return seen;
}

function uvState(g: Game) {
  const { engine, id } = g;
  const st = engine.state;
  return {
    myHand: st.players[P1].hand.length,
    myDeck: st.players[P1].deck.length,
    myDiscard: st.players[P1].discard.length,
    oppHand: st.players[P2].hand.length,
    oppDeck: st.players[P2].deck.length,
    oppDiscard: st.players[P2].discard.length,
    micromajigs: Object.values(st.cards).filter((c) => c.zone === "play" && engine.getDefinition(c.id).name === "Micromajig").length,
    mineDamage: st.cards[id("mine")].damage,
    theirsDamage: st.cards[id("theirs")].damage
  };
}
/** Nothing happened except that the tactic was played and went to my discard pile. */
const UV_NOTHING = { myHand: 0, myDeck: 3, myDiscard: 1, oppHand: 3, oppDeck: 5, oppDiscard: 0, micromajigs: 0, mineDamage: 0, theirsDamage: 0 };

clause(UV, "0:rule", "the tactic costs 2: refused with one resource, played with exactly two (both spent), and it ends up in my discard pile", () => {
  const short = uvBoard({ rage: 1 });
  refused(() => playRaw(short.engine, P1, short.id("uv")), "one resource is short of the cost of 2", /cost|resource|afford|pay/i);
  assert.equal(zoneOf(short.engine, short.id("uv")), "hand");
  assert.equal(short.engine.getCardPlayability(P1, short.id("uv")).playable, false);
  const exact = uvBoard({ rage: 1, deception: 1 });
  assert.equal(exact.engine.getAvailableResourceCount(P1), 2);
  uvRun(exact);
  assert.equal(zoneOf(exact.engine, exact.id("uv")), "discard");
  assert.equal(exact.engine.getAvailableResourceCount(P1), 0, "both resources were spent");
  assert.deepEqual(uvState(exact), UV_NOTHING);
});

clause(UV, "0:rule", "[O][O]: your opponent discards exactly 1 card — the opponent chooses it, from their hand, into their discard pile; nothing else happens", () => {
  const g = uvBoard({ obsession: 2, rage: 1 });
  const seen = uvRun(g, { d1: "oh1" });
  assert.deepEqual(seen, [{ declaration: "d1", playerId: P2 }], "only the opponent is asked, once");
  assert.deepEqual(uvState(g), { ...UV_NOTHING, oppHand: 2, oppDiscard: 1 });
  assert.equal(zoneOf(g.engine, g.id("oh1")), "discard", "the card they chose");
  assert.equal(zoneOf(g.engine, g.id("oh0")), "hand");
  assert.equal(zoneOf(g.engine, g.id("oh2")), "hand");
});

clause(UV, "0:rule", "[O][O]: the discard must be of a card in THEIR hand — the opponent cannot discard from their deck, and I cannot choose for them", () => {
  const g = uvBoard({ obsession: 2, rage: 1 }, { extra: [{ key: "myHandCard", def: character({ name: "MyHandCard" }), owner: P1, zone: "hand" }] });
  playRaw(g.engine, P1, g.id("uv"));
  resolvePendingResponses(g.engine);
  const pc = pending(g.engine)!;
  assert.equal(pc.playerId, P2);
  const answer = (playerId: string, card: string) => g.engine.perform({ type: "resolvePendingChoice", playerId, choice: { kind: "chooserSelectsTarget", selected: [g.id(card)] } } as never);
  refused(() => answer(P2, "od0"), "a card in their deck is not in their hand");
  refused(() => answer(P2, "myHandCard"), "my hand card is not theirs to discard");
  refused(() => answer(P1, "oh0"), "I am not the one who chooses");
  assert.equal(pending(g.engine)?.playerId, P2, "still waiting for the opponent");
  answer(P2, "oh0");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("oh0")), "discard", "control: a card from their hand is accepted");
  assert.equal(zoneOf(g.engine, g.id("myHandCard")), "hand");
});

clause(UV, "0:rule", "[O][O]: with an empty opponent hand there is nothing to discard and the tactic still resolves", () => {
  const g = uvBoard({ obsession: 2, rage: 1 }, { oppHand: 0 });
  uvRun(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(uvState(g), { ...UV_NOTHING, oppHand: 0 });
});

clause(UV, "0:rule", "[G][G]: I draw exactly 1 card, the top of my deck; the opponent draws nothing; nothing else happens", () => {
  const g = uvBoard({ greed: 2, rage: 1 });
  const top = deckOf(g.engine, P1)[0];
  const seen = uvRun(g);
  assert.deepEqual(seen, [], "no prompts");
  assert.deepEqual(uvState(g), { ...UV_NOTHING, myHand: 1, myDeck: 2 });
  assert.deepEqual(handOf(g.engine, P1), [top]);
});

clause(UV, "0:rule", "[E][E]: I put exactly 1 Micromajig token into play under my control (a Gearsmith majig character, 1 strength / 1 life / 3 speed)", () => {
  const g = uvBoard({ elitism: 2, rage: 1 });
  const before = new Set(Object.keys(g.engine.state.cards));
  uvRun(g);
  assert.deepEqual(uvState(g), { ...UV_NOTHING, micromajigs: 1 });
  const token = Object.values(g.engine.state.cards).find((c) => !before.has(c.id) && c.zone === "play");
  assert.ok(token, "a new card is in play");
  const def = g.engine.getDefinition(token.id);
  assert.equal(def.name, "Micromajig");
  assert.equal(def.type, "character");
  assert.equal(token.controllerId, P1, "under my control");
  assert.equal(token.ownerId, P1);
  assert.equal(g.engine.getStat(token.id, "strength"), 1);
  assert.equal(g.engine.getStat(token.id, "life"), 1);
  assert.equal(g.engine.getStat(token.id, "speed"), 3);
  assert.ok((def.subtype ?? []).includes("majig"), "majig subtype");
});

clause(UV, "0:rule", "[E][E]: the Micromajig token is a Gearsmith character (the reminder text on every Micromajig card: 'Treat Micromajig tokens as Gearsmith character cards')", () => {
  const g = uvBoard({ elitism: 2, rage: 1 });
  const before = new Set(Object.keys(g.engine.state.cards));
  uvRun(g);
  const token = Object.values(g.engine.state.cards).find((c) => !before.has(c.id) && c.zone === "play");
  assert.ok(token, "a new card is in play");
  assert.equal(g.engine.getDefinition(token.id).trade, "gearsmith", "a Gearsmith character card");
});

clause(UV, "0:rule", "[D][D]: I search the opponent's deck for 1 card (my choice) and it goes into THEIR discard pile; their deck loses exactly that card", () => {
  const g = uvBoard({ deception: 2, rage: 1 });
  const deck = deckOf(g.engine, P2);
  const pick = deck[3];
  const seen = uvRun(g, { d2: "od3" });
  assert.deepEqual(seen, [{ declaration: "d2", playerId: P1 }], "I choose, once");
  assert.deepEqual(uvState(g), { ...UV_NOTHING, oppDeck: 4, oppDiscard: 1 });
  assert.deepEqual(discardOf(g.engine, P2), [pick], "the chosen card is in their discard pile");
  assert.deepEqual([...deckOf(g.engine, P2)].sort(), deck.filter((c) => c !== pick).sort(), "the rest of their deck is still there");
  assert.equal(handOf(g.engine, P1).includes(pick), false, "it did not come to my hand");
});

clause(UV, "0:rule", "[D][D]: the searched deck is shuffled afterwards (CR 312.1) — theirs, not mine", () => {
  let reordered = 0;
  for (const seed of [1, 2, 3]) {
    const g = uvBoard({ deception: 2, rage: 1 }, { oppDeck: 8, random: seeded(seed) });
    const before = deckOf(g.engine, P2).filter((c) => c !== g.id("od0"));
    const mine = deckOf(g.engine, P1);
    uvRun(g, { d2: "od0" });
    const after = deckOf(g.engine, P2);
    assert.deepEqual([...after].sort(), [...before].sort(), "same cards");
    if (after.join() !== before.join()) reordered++;
    assert.deepEqual(deckOf(g.engine, P1), mine, "my deck order is untouched");
  }
  assert.ok(reordered >= 1, "their deck was shuffled after the search");
});

clause(UV, "0:rule", "[D][D]: the search is of THEIR deck only and the card must be in it — my own deck, their hand and their discard are refused", () => {
  const g = uvBoard({ deception: 2, rage: 1 }, { extra: [{ key: "oppDisc", def: character({ name: "OppDiscarded" }), owner: P2, zone: "discard" }] });
  playRaw(g.engine, P1, g.id("uv"));
  resolvePendingResponses(g.engine);
  assert.equal(pending(g.engine)?.playerId, P1);
  const answer = (card: string[]) => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: card.map((c) => g.id(c)) } } as never);
  refused(() => answer(["md0"]), "my own deck is not theirs");
  refused(() => answer(["oh0"]), "their hand is not their deck");
  refused(() => answer(["oppDisc"]), "their discard pile is not their deck");
  refused(() => answer(["od0", "od1"]), "only 1 card");
  refused(() => answer([]), "there is no search criteria to fail, so 1 card must be found");
  answer(["od2"]);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("od2")), "discard", "control: a card from their deck is accepted");
});

clause(UV, "0:rule", "[D][D]: with their deck empty there is nothing to find; the tactic still resolves and nothing is lost", () => {
  const g = uvBoard({ deception: 2, rage: 1 }, { oppDeck: 0 });
  uvRun(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(uvState(g), { ...UV_NOTHING, oppDeck: 0 });
});

clause(UV, "0:rule", "[R][R]: 'you may pick a character. If you do, inflict 2 damage to it' — picking the opponent's character: exactly 2 damage to it and no one else", () => {
  const g = uvBoard({ rage: 2, greed: 1 });
  const seen = uvRun(g, { d3: "theirs" });
  assert.deepEqual(seen, [{ declaration: "d3", playerId: P1 }], "I choose, once");
  assert.deepEqual(uvState(g), { ...UV_NOTHING, theirsDamage: 2 });
  assert.equal(zoneOf(g.engine, g.id("theirs")), "play", "a 5-life character survives 2 damage");
});

clause(UV, "0:rule", "[R][R]: any character — my own is a legal pick too (exactly 2 damage to it)", () => {
  const g = uvBoard({ rage: 2, greed: 1 });
  uvRun(g, { d3: "mine" });
  assert.deepEqual(uvState(g), { ...UV_NOTHING, mineDamage: 2 });
});

clause(UV, "0:rule", "[R][R]: 'you may': picking nothing deals no damage to anyone", () => {
  const g = uvBoard({ rage: 2, greed: 1 });
  const seen = uvRun(g, { d3: null });
  assert.deepEqual(seen, [{ declaration: "d3", playerId: P1 }], "I was asked");
  assert.deepEqual(uvState(g), UV_NOTHING);
});

clause(UV, "0:rule", "[R][R]: 2 damage destroys a character with 2 life", () => {
  const g = uvBoard({ rage: 2, greed: 1 }, { theirsLife: 2 });
  uvRun(g, { d3: "theirs" });
  assert.equal(zoneOf(g.engine, g.id("theirs")), "discard");
});

clause(UV, "0:rule", "[R][R]: only a character in play is pickable — an item, a location, a faction, and characters in hand or discard are refused", () => {
  const extra: CardPlacement[] = [
    { key: "gizmo", def: item({ name: "Gizmo" }), owner: P2, zone: "play" },
    { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
    { key: "inHand", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
    { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" }
  ];
  const g = uvBoard({ rage: 2, greed: 1 }, { extra });
  playRaw(g.engine, P1, g.id("uv"));
  resolvePendingResponses(g.engine);
  const pc = pending(g.engine)!;
  assert.equal(pc.playerId, P1);
  const answer = (ids: string[]) => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: ids } } as never);
  for (const bad of [g.id("gizmo"), g.id("place"), g.id("inHand"), g.id("inDiscard"), factionOf(g.engine, P2), factionOf(g.engine, P1)]) {
    refused(() => answer([bad]), "not a character in play");
  }
  refused(() => answer([g.id("mine"), g.id("theirs")]), "only one character");
  assert.equal(damageOf(g.engine, g.id("gizmo")), 0);
  answer([g.id("theirs")]);
  resolvePendingResponses(g.engine);
  assert.equal(damageOf(g.engine, g.id("theirs")), 2, "control: a character in play is accepted");
});

clause(UV, "0:rule", "each paragraph is gated on its own two icons: one of each icon does nothing (even if the opponent controls plenty), and only the tactic is spent", () => {
  const g = uvBoard(ONE_EACH, { theirs: TWO_EACH });
  const seen = uvRun(g);
  assert.deepEqual(seen, [], "no prompts");
  assert.deepEqual(uvState(g), UV_NOTHING);
  assert.equal(g.engine.getAvailableResourceCount(P1), 3);
});

clause(UV, "0:rule", "'at least': three icons still discard exactly 1 card (not one per extra icon)", () => {
  const g = uvBoard({ obsession: 3, rage: 1 });
  const seen = uvRun(g, { d1: "oh0" });
  assert.deepEqual(seen, [{ declaration: "d1", playerId: P2 }]);
  assert.deepEqual(uvState(g), { ...UV_NOTHING, oppHand: 2, oppDiscard: 1 });
});

clause(UV, "0:rule", "face-down cards only provide Volition: three face-down resources never meet any [X][X] condition", () => {
  const g = uvBoard({}, { faceDown: 3 });
  assert.equal(g.engine.getAvailableResourceCount(P1), 3);
  const seen = uvRun(g);
  assert.deepEqual(seen, []);
  assert.deepEqual(uvState(g), UV_NOTHING);
});

clause(UV, "0:rule", "'control': resources spent to pay the cost still count — [O][O] only, both spent paying for the tactic, still makes the opponent discard", () => {
  const g = uvBoard({ obsession: 2 });
  assert.equal(g.engine.getAvailableResourceCount(P1), 2);
  const seen = uvRun(g, { d1: "oh0" });
  assert.equal(g.engine.getAvailableResourceCount(P1), 0, "both were spent on the cost");
  assert.deepEqual(seen, [{ declaration: "d1", playerId: P2 }]);
  assert.deepEqual(uvState(g), { ...UV_NOTHING, oppHand: 2, oppDiscard: 1 });
});

clause(UV, "0:rule", "all five conditions met: everything happens in one resolution, in printed order (they discard, I draw, token, search, damage)", () => {
  const g = uvBoard(TWO_EACH);
  const top = deckOf(g.engine, P1)[0];
  const seen = uvRun(g, { d1: "oh0", d2: "od1", d3: "theirs" });
  assert.deepEqual(seen, [
    { declaration: "d1", playerId: P2 },
    { declaration: "d2", playerId: P1 },
    { declaration: "d3", playerId: P1 }
  ]);
  assert.deepEqual(uvState(g), { ...UV_NOTHING, myHand: 1, myDeck: 2, oppHand: 2, oppDiscard: 2, oppDeck: 4, micromajigs: 1, theirsDamage: 2 });
  assert.deepEqual(handOf(g.engine, P1), [top]);
  assert.equal(zoneOf(g.engine, g.id("oh0")), "discard");
  assert.equal(zoneOf(g.engine, g.id("od1")), "discard");
});

// =================================================================================
// Giada, the Elegant
// UNIQUE GIADA. This card loses 1 strength and 1 life for each token on it. If this card would be destroyed by an opposing card or effect, you may put a token on it
// instead. If you do, deplete it and remove it from combat.
// Character, warlord, subtype giada / sword of great justice, cost 4, threshold [R][R][R], 3/3/3 (str/spd/life).
// =================================================================================

const GIADA = "0b67c755-4053-4bfb-9aef-e3a990501e0d";

function giBoard(opts: { tokens?: number; active?: Pid; mine?: CardPlacement[]; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P2,
    cards: [
      { key: "gi", def: printing(GIADA), owner: P1, zone: "play", counters: opts.tokens ? { token: opts.tokens } : {} },
      ...(opts.extra ?? [])
    ]
  });
}
const replacementPrompt = (g: Game) => {
  const pc = pending(g.engine);
  assert.ok(pc, "I am offered the replacement");
  assert.equal(pc.kind, "replacementChoice");
  assert.equal(pc.playerId, P1, "her controller decides");
  return pc;
};

clause(GIADA, "0:unique", "has UNIQUE GIADA: a second Giada under my control makes me choose one to keep; keeping the new one destroys the old one — her own protection does not save the extra copy", () => uniqueKeepNew(GIADA, "rage", 4, { token: 1 }));
clause(GIADA, "0:unique", "I can keep the older Giada instead (with her tokens); the new one is destroyed", () => uniqueKeepOld(GIADA, "rage", 4, { token: 1 }));
clause(GIADA, "0:unique", "only a candidate can be kept: an unrelated card is refused and the choice stays open", () => uniqueBystanderRefused(GIADA, "rage", 4));
clause(GIADA, "0:unique", "UNIQUE is per player and per identifier: the opponent's own Giada and a different identifier are no problem", () => uniqueScope(GIADA, "rage", 4));
clause(GIADA, "0:unique", "after I choose which Giada to keep, the deployment finishes: the response window closes", () => uniqueFinishes(GIADA, "rage", 4));

clause(GIADA, "1:rule", "loses 1 strength and 1 life for each token: 0 tokens 3/3, 1 token 2/2, 2 tokens 1/1 — speed stays 3", () => {
  for (const [tokens, strength, life] of [[0, 3, 3], [1, 2, 2], [2, 1, 1]] as const) {
    const { engine, id } = giBoard({ tokens });
    assert.equal(engine.getStat(id("gi"), "strength"), strength, `${tokens} tokens: strength`);
    assert.equal(engine.getStat(id("gi"), "life"), life, `${tokens} tokens: life`);
    assert.equal(engine.getStat(id("gi"), "speed"), 3, `${tokens} tokens: speed`);
  }
});

clause(GIADA, "1:rule", "'this card' and 'on it': another character's tokens are unaffected, and tokens on another character don't weaken her", () => {
  const { engine, id } = giBoard({ extra: [{ key: "other", def: character({ name: "Other", strength: 3, life: 3, speed: 3 }), owner: P1, zone: "play", counters: { token: 2 } }] });
  assert.equal(engine.getStat(id("other"), "strength"), 3);
  assert.equal(engine.getStat(id("other"), "life"), 3);
  assert.equal(engine.getStat(id("gi"), "strength"), 3, "her own tokens only");
  assert.equal(engine.getStat(id("gi"), "life"), 3);
});

clause(GIADA, "1:rule", "it follows the tokens as they change: each token added by an effect lowers strength and life by 1 at once", () => {
  const { engine, id } = giBoard({ active: P1, extra: [{ key: "add1", def: addTokenTactic(), owner: P1, zone: "hand" }, { key: "add2", def: addTokenTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("add1"), { selected: { t: [id("gi")] } });
  assert.equal(tokensOn(engine, id("gi")), 1);
  assert.equal(engine.getStat(id("gi"), "strength"), 2);
  assert.equal(engine.getStat(id("gi"), "life"), 2);
  play(engine, P1, id("add2"), { selected: { t: [id("gi")] } });
  assert.equal(engine.getStat(id("gi"), "strength"), 1);
  assert.equal(engine.getStat(id("gi"), "life"), 1);
});

clause(GIADA, "1:rule", "and back: each token removed gives 1 strength and 1 life back", () => {
  const unTokenTactic = () =>
    tactic({
      name: "Remove Token",
      cost: 0,
      behavior: {
        abilities: [
          { id: "r", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "removeCounter", target: { type: "selected", id: "t" }, counter: "token", amount: 1 }] }
        ]
      }
    });
  const { engine, id } = giBoard({ active: P1, tokens: 2, extra: [{ key: "r1", def: unTokenTactic(), owner: P1, zone: "hand" }, { key: "r2", def: unTokenTactic(), owner: P1, zone: "hand" }] });
  assert.equal(engine.getStat(id("gi"), "life"), 1);
  play(engine, P1, id("r1"), { selected: { t: [id("gi")] } });
  assert.equal(tokensOn(engine, id("gi")), 1);
  assert.equal(engine.getStat(id("gi"), "strength"), 2);
  assert.equal(engine.getStat(id("gi"), "life"), 2);
  play(engine, P1, id("r2"), { selected: { t: [id("gi")] } });
  assert.equal(engine.getStat(id("gi"), "strength"), 3);
  assert.equal(engine.getStat(id("gi"), "life"), 3);
});

clause(GIADA, "1:rule", "the lost life is real: with 1 token (life 2) 1 damage from my own card leaves her, 2 damage destroys her; without a token 2 damage does not", () => {
  const one = giBoard({ active: P1, tokens: 1, extra: [{ key: "z1", def: zapTactic(1), owner: P1, zone: "hand" }, { key: "z2", def: zapTactic(1), owner: P1, zone: "hand" }] });
  play(one.engine, P1, one.id("z1"), { selected: { t: [one.id("gi")] } });
  assert.equal(zoneOf(one.engine, one.id("gi")), "play", "1 damage < life 2");
  assert.equal(damageOf(one.engine, one.id("gi")), 1);
  play(one.engine, P1, one.id("z2"), { selected: { t: [one.id("gi")] } });
  assert.equal(one.engine.state.pendingChoice, undefined, "my own card is not an opposing card: no replacement offered");
  assert.equal(zoneOf(one.engine, one.id("gi")), "discard", "2 damage >= life 2");
  const none = giBoard({ active: P1, tokens: 0, extra: [{ key: "z", def: zapTactic(2), owner: P1, zone: "hand" }] });
  play(none.engine, P1, none.id("z"), { selected: { t: [none.id("gi")] } });
  assert.equal(zoneOf(none.engine, none.id("gi")), "play", "control: with no tokens 2 damage < life 3");
});

clause(GIADA, "1:rule", "the lost strength is real in battle: with 1 token (strength 2) she deals 2 damage as a blocker, not 3", () => {
  const g = giBoard({
    tokens: 1,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" }]
  });
  fightThrough(g.engine, P2, [g.id("atk")], { type: "faction", playerId: P1 }, [g.id("gi")]);
  assert.equal(damageOf(g.engine, g.id("atk")), 2, "2 damage dealt (strength 3 - 1 token)");
  assert.equal(zoneOf(g.engine, g.id("gi")), "play");
});

clause(GIADA, "1:rule", "with 3 tokens she has 0 life (3 - 3) and is destroyed as soon as the state is checked", () => {
  const g = giBoard({ active: P1, tokens: 3, extra: [{ key: "n", def: nothingTactic(), owner: P1, zone: "hand" }] });
  assert.equal(g.engine.getStat(g.id("gi"), "life"), 0, "control: 3 life - 3 tokens");
  play(g.engine, P1, g.id("n"));
  assert.equal(zoneOf(g.engine, g.id("gi")), "discard", "a character with 0 life is destroyed (CR 408.4: damage 0 >= life 0)");
});

clause(GIADA, "2:rule", "destroyed by the opponent's card: I am offered the replacement; accepting puts a token on her, she is depleted and stays in play", () => {
  const g = giBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  play(g.engine, P2, g.id("kill"), { selected: { t: [g.id("gi")] } });
  replacementPrompt(g);
  answerPending(g.engine, "replacementChoice", { apply: true });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("gi")), "play", "not destroyed");
  assert.equal(tokensOn(g.engine, g.id("gi")), 1, "a token");
  assert.equal(g.engine.state.cards[g.id("gi")].depleted, true, "depleted");
  assert.equal(g.engine.getStat(g.id("gi"), "strength"), 2, "and the token already weakens her");
  assert.equal(g.engine.getStat(g.id("gi"), "life"), 2);
  assert.equal(zoneOf(g.engine, g.id("kill")), "discard", "the tactic itself resolved");
});

clause(GIADA, "2:rule", "'you may': declining the replacement lets her be destroyed — no token, discard pile", () => {
  const g = giBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  play(g.engine, P2, g.id("kill"), { selected: { t: [g.id("gi")] } });
  replacementPrompt(g);
  answerPending(g.engine, "replacementChoice", { apply: false });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("gi")), "discard");
  assert.equal(tokensOn(g.engine, g.id("gi")), 0);
});

clause(GIADA, "2:rule", "only an OPPOSING card: destroyed by my own card she is simply destroyed — no replacement offered", () => {
  const g = giBoard({ active: P1, extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("gi")] } });
  assert.equal(g.engine.state.pendingChoice, undefined, "no prompt");
  assert.equal(zoneOf(g.engine, g.id("gi")), "discard");
  assert.equal(tokensOn(g.engine, g.id("gi")), 0);
});

clause(GIADA, "2:rule", "only if SHE would be destroyed: the opponent destroying another character of mine offers nothing and leaves her untouched", () => {
  const g = giBoard({
    extra: [
      { key: "other", def: character({ name: "Other" }), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P2, zone: "hand" }
    ]
  });
  play(g.engine, P2, g.id("kill"), { selected: { t: [g.id("other")] } });
  assert.equal(g.engine.state.pendingChoice, undefined, "no prompt");
  assert.equal(zoneOf(g.engine, g.id("other")), "discard");
  assert.equal(tokensOn(g.engine, g.id("gi")), 0);
  assert.equal(g.engine.state.cards[g.id("gi")].depleted, false);
});

clause(GIADA, "2:rule", "the replacement can be used again and again: a second opposing kill makes it 2 tokens (1/1)", () => {
  const g = giBoard({ extra: [{ key: "kill1", def: killTactic(), owner: P2, zone: "hand" }, { key: "kill2", def: killTactic(), owner: P2, zone: "hand" }] });
  play(g.engine, P2, g.id("kill1"), { selected: { t: [g.id("gi")] } });
  answerPending(g.engine, "replacementChoice", { apply: true });
  play(g.engine, P2, g.id("kill2"), { selected: { t: [g.id("gi")] } });
  replacementPrompt(g);
  answerPending(g.engine, "replacementChoice", { apply: true });
  assert.equal(zoneOf(g.engine, g.id("gi")), "play");
  assert.equal(tokensOn(g.engine, g.id("gi")), 2);
  assert.equal(g.engine.getStat(g.id("gi"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("gi"), "life"), 1);
});

clause(GIADA, "2:rule", "destroyed by an opposing card's damage: the replacement applies, and the damage that would have killed her is reduced to 0 (CR 506.6)", () => {
  const g = giBoard({ extra: [{ key: "zap", def: zapTactic(3), owner: P2, zone: "hand" }] });
  play(g.engine, P2, g.id("zap"), { selected: { t: [g.id("gi")] } });
  replacementPrompt(g);
  answerPending(g.engine, "replacementChoice", { apply: true });
  assert.equal(zoneOf(g.engine, g.id("gi")), "play");
  assert.equal(tokensOn(g.engine, g.id("gi")), 1);
  assert.equal(damageOf(g.engine, g.id("gi")), 0, "the lethal damage was reduced to 0");
  assert.equal(g.engine.state.cards[g.id("gi")].depleted, true);
});

clause(GIADA, "2:rule", "destroyed by an opposing character in battle: replaced — token, depleted, still in play, lethal damage reduced to 0", () => {
  const g = giBoard({ extra: [{ key: "atk", def: character({ name: "Brute", strength: 5, life: 10, speed: 3 }), owner: P2, zone: "play" }] });
  fightThrough(g.engine, P2, [g.id("atk")], { type: "faction", playerId: P1 }, [g.id("gi")], undefined, (pc) =>
    pc.kind === "replacementChoice" ? { kind: "replacementChoice", apply: true } : declineAll(pc)
  );
  assert.equal(zoneOf(g.engine, g.id("gi")), "play", "survived the lethal battle damage");
  assert.equal(tokensOn(g.engine, g.id("gi")), 1);
  assert.equal(damageOf(g.engine, g.id("gi")), 0, "the damage was reduced to 0");
  assert.equal(g.engine.state.cards[g.id("gi")].depleted, true);
  assert.equal(damageOf(g.engine, g.id("atk")), 3, "she still struck back (strength 3)");
});

clause(GIADA, "2:rule", "'remove it from combat' as a blocker: after accepting she is no longer in the blocking party, depleted, with a token", () => {
  const g = giBoard({
    extra: [
      { key: "atk", def: character({ name: "Attacker", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P2, zone: "hand" }
    ]
  });
  declareAttackBy(g.engine, P2, [g.id("atk")]);
  declareBlockers(g.engine, P1, [g.id("gi")]);
  assert.deepEqual(battleOf(g.engine)?.blockingParty, [g.id("gi")], "she is blocking");
  playRaw(g.engine, P2, g.id("kill"), { selected: { t: [g.id("gi")] } });
  resolvePendingResponses(g.engine);
  replacementPrompt(g);
  answerPending(g.engine, "replacementChoice", { apply: true });
  assert.equal(zoneOf(g.engine, g.id("gi")), "play");
  assert.equal(tokensOn(g.engine, g.id("gi")), 1);
  assert.equal(g.engine.state.cards[g.id("gi")].depleted, true);
  assert.equal((battleOf(g.engine)?.blockingParty ?? []).includes(g.id("gi")), false, "removed from combat");
});

clause(GIADA, "2:rule", "'remove it from combat' as an attacker: after accepting she is no longer in the attacking party", () => {
  const g = giBoard({ active: P1, extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  declareAttackOpenWindow(g.engine, P1, [g.id("gi")]);
  assert.deepEqual(battleOf(g.engine)?.attackingParty, [g.id("gi")], "she is attacking");
  playRaw(g.engine, P2, g.id("kill"), { selected: { t: [g.id("gi")] } });
  resolvePendingResponses(g.engine);
  replacementPrompt(g);
  answerPending(g.engine, "replacementChoice", { apply: true });
  assert.equal(zoneOf(g.engine, g.id("gi")), "play");
  assert.equal(tokensOn(g.engine, g.id("gi")), 1);
  assert.equal(g.engine.state.cards[g.id("gi")].depleted, true);
  assert.equal((battleOf(g.engine)?.attackingParty ?? []).includes(g.id("gi")), false, "removed from combat");
});

// =================================================================================
// Octo-Ba-Ba, the Devourer
// UNIQUE OCTO-BA-BA. If a character your opponent controls is destroyed, put a token on this card.
// DEVOUR -- COST: Pay 3. Deplete this card. Remove a token from this card. Pick a character or location. -- EFFECT: Inflict 3 damage to the character or location.
// Character, warlord, subtype octo-ba-ba / sword of great justice, cost 5, threshold [R][R][R], 3/3/6.
// =================================================================================

const OCTO = "60ce2f1b-bb70-4195-a6db-e0caa629ce2a";

function octoBoard(opts: { tokens?: number; rage?: number; depleted?: boolean; active?: Pid; octoZone?: "play" | "hand"; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "octo", def: printing(OCTO), owner: P1, zone: opts.octoZone ?? "play", depleted: opts.depleted ?? false, counters: opts.tokens ? { token: opts.tokens } : {} },
      ...bank("rage", opts.rage ?? 3, P1),
      ...(opts.extra ?? [])
    ]
  });
}
const prey = (name = "Prey", life = 3): CardDefinition => character({ name, life });

clause(OCTO, "0:unique", "has UNIQUE OCTO-BA-BA: a second Octo-Ba-Ba under my control makes me choose one to keep; keeping the new one destroys the old one", () => uniqueKeepNew(OCTO, "rage", 5, { token: 1 }));
clause(OCTO, "0:unique", "I can keep the older Octo-Ba-Ba instead (with her tokens); the new one is destroyed", () => uniqueKeepOld(OCTO, "rage", 5, { token: 1 }));
clause(OCTO, "0:unique", "only a candidate can be kept: an unrelated card is refused and the choice stays open", () => uniqueBystanderRefused(OCTO, "rage", 5));
clause(OCTO, "0:unique", "UNIQUE is per player and per identifier: the opponent's own Octo-Ba-Ba and a different identifier are no problem", () => uniqueScope(OCTO, "rage", 5));
clause(OCTO, "0:unique", "after I choose which Octo-Ba-Ba to keep, the deployment finishes: the response window closes", () => uniqueFinishes(OCTO, "rage", 5));

clause(OCTO, "1:rule", "a character my opponent controls is destroyed (by my card): a token on this card, exactly one", () => {
  const g = octoBoard({ extra: [{ key: "prey", def: prey(), owner: P2, zone: "play" }, { key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  assert.equal(tokensOn(g.engine, g.id("octo")), 0);
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("prey")] } });
  assert.equal(zoneOf(g.engine, g.id("prey")), "discard");
  assert.equal(tokensOn(g.engine, g.id("octo")), 1);
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(OCTO, "1:rule", "it doesn't matter who destroys it: the opponent destroying their own character also gives me a token", () => {
  const g = octoBoard({ active: P2, extra: [{ key: "prey", def: prey(), owner: P2, zone: "play" }, { key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  play(g.engine, P2, g.id("kill"), { selected: { t: [g.id("prey")] } });
  assert.equal(zoneOf(g.engine, g.id("prey")), "discard");
  assert.equal(tokensOn(g.engine, g.id("octo")), 1);
});

clause(OCTO, "1:rule", "each destroyed character gives a token: two kills make two tokens", () => {
  const g = octoBoard({
    extra: [
      { key: "p1", def: prey("P1"), owner: P2, zone: "play" },
      { key: "p2", def: prey("P2"), owner: P2, zone: "play" },
      { key: "k1", def: killTactic(), owner: P1, zone: "hand" },
      { key: "k2", def: killTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(g.engine, P1, g.id("k1"), { selected: { t: [g.id("p1")] } });
  play(g.engine, P1, g.id("k2"), { selected: { t: [g.id("p2")] } });
  assert.equal(tokensOn(g.engine, g.id("octo")), 2);
});

clause(OCTO, "1:rule", "a character destroyed in battle damage counts too", () => {
  const g = octoBoard({
    extra: [
      { key: "big", def: character({ name: "Big", strength: 5, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blocker", strength: 1, life: 2, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  fightThrough(g.engine, P1, [g.id("big")], { type: "faction", playerId: P2 }, [g.id("blk")]);
  assert.equal(zoneOf(g.engine, g.id("blk")), "discard", "the blocker died");
  assert.equal(tokensOn(g.engine, g.id("octo")), 1);
});

clause(OCTO, "1:rule", "only characters my OPPONENT controls: my own character being destroyed gives no token", () => {
  const g = octoBoard({ extra: [{ key: "mine", def: prey("Mine"), owner: P1, zone: "play" }, { key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("mine")] } });
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard");
  assert.equal(tokensOn(g.engine, g.id("octo")), 0);
});

clause(OCTO, "1:rule", "'controls', not 'owns': my character that the opponent controls gives a token, the opponent's character that I control does not", () => {
  const g = octoBoard({
    extra: [
      { key: "stolenFromMe", def: prey("StolenFromMe"), owner: P1, controller: P2, zone: "play" },
      { key: "stolenByMe", def: prey("StolenByMe"), owner: P2, controller: P1, zone: "play" },
      { key: "k1", def: killTactic(), owner: P1, zone: "hand" },
      { key: "k2", def: killTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(g.engine, P1, g.id("k1"), { selected: { t: [g.id("stolenByMe")] } });
  assert.equal(zoneOf(g.engine, g.id("stolenByMe")), "discard");
  assert.equal(tokensOn(g.engine, g.id("octo")), 0, "I controlled it: no token");
  play(g.engine, P1, g.id("k2"), { selected: { t: [g.id("stolenFromMe")] } });
  assert.equal(zoneOf(g.engine, g.id("stolenFromMe")), "discard");
  assert.equal(tokensOn(g.engine, g.id("octo")), 1, "the opponent controlled it: token");
});

clause(OCTO, "1:rule", "only characters: an opponent's item or location destroyed gives no token", () => {
  const g = octoBoard({
    extra: [
      { key: "gizmo", def: item({ name: "Gizmo" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 2 }), owner: P2, zone: "play" },
      { key: "kItem", def: destroyTactic("item"), owner: P1, zone: "hand" },
      { key: "kLoc", def: destroyTactic("location"), owner: P1, zone: "hand" }
    ]
  });
  play(g.engine, P1, g.id("kItem"), { selected: { t: [g.id("gizmo")] } });
  assert.equal(zoneOf(g.engine, g.id("gizmo")), "discard");
  play(g.engine, P1, g.id("kLoc"), { selected: { t: [g.id("place")] } });
  assert.equal(zoneOf(g.engine, g.id("place")), "discard");
  assert.equal(tokensOn(g.engine, g.id("octo")), 0);
});

clause(OCTO, "1:rule", "only 'destroyed': an opponent's character returned to hand gives no token", () => {
  const g = octoBoard({ extra: [{ key: "prey", def: prey(), owner: P2, zone: "play" }, { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("prey")] } });
  assert.equal(zoneOf(g.engine, g.id("prey")), "hand");
  assert.equal(tokensOn(g.engine, g.id("octo")), 0);
});

clause(OCTO, "1:rule", "the card must be in play: with Octo-Ba-Ba in my hand a destroyed opposing character gives her nothing", () => {
  const g = octoBoard({ octoZone: "hand", extra: [{ key: "prey", def: prey(), owner: P2, zone: "play" }, { key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("prey")] } });
  assert.equal(zoneOf(g.engine, g.id("prey")), "discard");
  assert.equal(tokensOn(g.engine, g.id("octo")), 0);
});

// --- DEVOUR -----------------------------------------------------------------------

const devourExtras = (): CardPlacement[] => [
  { key: "oppChar", def: character({ name: "OppChar", life: 10 }), owner: P2, zone: "play" },
  { key: "myChar", def: character({ name: "MyChar", life: 10 }), owner: P1, zone: "play" },
  { key: "oppLoc", def: location({ name: "OppPlace", structure: 10 }), owner: P2, zone: "play" },
  { key: "myLoc", def: location({ name: "MyPlace", structure: 10 }), owner: P1, zone: "play" },
  { key: "oppItem", def: item({ name: "OppItem" }), owner: P2, zone: "play" },
  { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
  { key: "oppHandChar", def: character({ name: "OppHandChar" }), owner: P2, zone: "hand" },
  { key: "oppDiscChar", def: character({ name: "OppDiscChar" }), owner: P2, zone: "discard" }
];
const devour = (g: Game, target: string) => activate(g.engine, P1, g.id("octo"), "octo-devour", { selected: { t: [g.id(target)] } });

clause(OCTO, "2:ability:octo-devour", "COST: Pay 3, Deplete this card, Remove a token — all paid; EFFECT: exactly 3 damage to the picked character", () => {
  const g = octoBoard({ tokens: 1, rage: 5, extra: devourExtras() });
  assert.equal(g.engine.getAvailableResourceCount(P1), 5);
  devour(g, "oppChar");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(g.engine.getAvailableResourceCount(P1), 2, "exactly 3 of 5 resources were paid");
  assert.equal(g.engine.state.cards[g.id("octo")].depleted, true, "deplete this card");
  assert.equal(tokensOn(g.engine, g.id("octo")), 0, "the token was removed");
  assert.equal(damageOf(g.engine, g.id("oppChar")), 3, "3 damage");
  assert.equal(damageOf(g.engine, g.id("myChar")), 0, "no one else was hurt");
});

clause(OCTO, "2:ability:octo-devour", "Remove 'a token': with 2 tokens exactly one is removed", () => {
  const g = octoBoard({ tokens: 2, extra: devourExtras() });
  devour(g, "oppChar");
  assert.equal(tokensOn(g.engine, g.id("octo")), 1);
  assert.equal(damageOf(g.engine, g.id("oppChar")), 3);
});

clause(OCTO, "2:ability:octo-devour", "Remove a token: with no token it is refused (nothing is spent, nothing happens); with one token it works", () => {
  const none = octoBoard({ tokens: 0, extra: devourExtras() });
  refused(() => devour(none, "oppChar"), "no token to remove", /token|counter|cost/i);
  assert.equal(none.engine.getAvailableResourceCount(P1), 3, "nothing spent");
  assert.equal(none.engine.state.cards[none.id("octo")].depleted, false);
  assert.equal(damageOf(none.engine, none.id("oppChar")), 0);
  const one = octoBoard({ tokens: 1, extra: devourExtras() });
  devour(one, "oppChar");
  assert.equal(damageOf(one.engine, one.id("oppChar")), 3, "control");
});

clause(OCTO, "2:ability:octo-devour", "Deplete this card: while she is depleted it is refused; after she was restored it works", () => {
  const dep = octoBoard({ tokens: 1, depleted: true, extra: devourExtras() });
  refused(() => devour(dep, "oppChar"), "she is already depleted", /cost/i);
  assert.equal(tokensOn(dep.engine, dep.id("octo")), 1, "the token is kept");
  assert.equal(dep.engine.getAvailableResourceCount(P1), 3);
  assert.equal(damageOf(dep.engine, dep.id("oppChar")), 0);
  const ok = octoBoard({ tokens: 1, depleted: false, extra: devourExtras() });
  devour(ok, "oppChar");
  assert.equal(ok.engine.state.cards[ok.id("octo")].depleted, true, "control");
});

clause(OCTO, "2:ability:octo-devour", "Pay 3: with only 2 resources it is refused (token and untapped state kept); with exactly 3 it works and leaves none", () => {
  const short = octoBoard({ tokens: 1, rage: 2, extra: devourExtras() });
  refused(() => devour(short, "oppChar"), "two resources are one short of Pay 3", /resource|pay|afford|cost/i);
  assert.equal(tokensOn(short.engine, short.id("octo")), 1);
  assert.equal(short.engine.state.cards[short.id("octo")].depleted, false);
  assert.equal(damageOf(short.engine, short.id("oppChar")), 0);
  const exact = octoBoard({ tokens: 1, rage: 3, extra: devourExtras() });
  devour(exact, "oppChar");
  assert.equal(exact.engine.getAvailableResourceCount(P1), 0);
  assert.equal(damageOf(exact.engine, exact.id("oppChar")), 3);
});

clause(OCTO, "2:ability:octo-devour", "Pick a character or location: any character or location in play can be picked — the opponent's or mine, even Octo-Ba-Ba herself; each takes exactly 3 damage", () => {
  for (const target of ["oppChar", "myChar", "oppLoc", "myLoc", "octo"]) {
    const g = octoBoard({ tokens: 1, extra: devourExtras() });
    devour(g, target);
    assert.equal(g.engine.state.pendingChoice, undefined, target);
    assert.equal(damageOf(g.engine, g.id(target)), 3, `${target} took exactly 3 damage`);
    assert.equal(zoneOf(g.engine, g.id(target)), "play", `${target} survives 3 damage`);
  }
});

clause(OCTO, "2:ability:octo-devour", "the pick is of a character or location IN PLAY: items, cards in hand or discard and factions are refused and nothing is spent", () => {
  for (const target of ["oppItem", "myItem", "oppHandChar", "oppDiscChar", "oppFaction", "myFaction"]) {
    const g = octoBoard({ tokens: 1, extra: devourExtras() });
    const targetId = target === "oppFaction" ? factionOf(g.engine, P2) : target === "myFaction" ? factionOf(g.engine, P1) : g.id(target);
    refused(() => activate(g.engine, P1, g.id("octo"), "octo-devour", { selected: { t: [targetId] } }), `${target} is not a character or location in play`);
    assert.equal(tokensOn(g.engine, g.id("octo")), 1, "token kept");
    assert.equal(g.engine.getAvailableResourceCount(P1), 3, "nothing spent");
    assert.equal(g.engine.state.cards[g.id("octo")].depleted, false);
  }
});

clause(OCTO, "2:ability:octo-devour", "Pick a character or location: exactly one — none, or two, is refused", () => {
  const none = octoBoard({ tokens: 1, extra: devourExtras() });
  refused(() => activate(none.engine, P1, none.id("octo"), "octo-devour", { selected: {} }), "a pick is required");
  assert.equal(tokensOn(none.engine, none.id("octo")), 1);
  const two = octoBoard({ tokens: 1, extra: devourExtras() });
  refused(() => activate(two.engine, P1, two.id("octo"), "octo-devour", { selected: { t: [two.id("oppChar"), two.id("myChar")] } }), "only one pick");
  assert.equal(damageOf(two.engine, two.id("oppChar")), 0);
  assert.equal(damageOf(two.engine, two.id("myChar")), 0);
});

clause(OCTO, "2:ability:octo-devour", "3 damage destroys a character with 3 life, and that opposing character's destruction feeds her a token again", () => {
  const g = octoBoard({ tokens: 1, extra: [{ key: "prey", def: prey("Prey", 3), owner: P2, zone: "play" }] });
  devour(g, "prey");
  assert.equal(zoneOf(g.engine, g.id("prey")), "discard");
  assert.equal(tokensOn(g.engine, g.id("octo")), 1, "the token paid was regained from the kill");
});

clause(OCTO, "2:ability:octo-devour", "3 damage destroys a location with structure 3", () => {
  const g = octoBoard({ tokens: 1, extra: [{ key: "place", def: location({ name: "Shack", structure: 3 }), owner: P2, zone: "play" }] });
  devour(g, "place");
  assert.equal(zoneOf(g.engine, g.id("place")), "discard");
});
