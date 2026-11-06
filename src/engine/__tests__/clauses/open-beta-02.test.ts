// Clause tests — batch open-beta-02. See docs/TESTING.md and
// `npm run card-tests -- manifest open-beta-02`. Expectations come from each
// card's PRINTED text and RULES.md / the Comprehensive Rules; engine data is
// only used to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  autoResolveBattle,
  bank,
  character,
  developFaction,
  item,
  location,
  play,
  resolvePendingResponses,
  tactic,
  P1,
  P2
} from "../per-card/_harness.js";
import { clause, declineAll, drain, printing } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { developDraw, endTurn } from "./_turn.js";
import type { SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

type Player = typeof P1;
type Def = ReturnType<typeof character>;
type Ids = (key: string) => string;

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: Player = P1) => engine.getAvailableResourceCount(player);

/** Raw `playCard` without draining the response window (use `play` from the harness to drain it). */
function playRaw(engine: SpoilsEngine, player: Player, cardId: string, opts: { selected?: Record<string, string[]>; variables?: Record<string, number> } = {}) {
  engine.perform({ type: "playCard", playerId: player, cardId, selected: opts.selected ?? {}, variables: opts.variables ?? {} } as never);
}

/** Raw `activateAbility` without draining the response window. */
function activateRaw(engine: SpoilsEngine, player: Player, cardId: string, abilityId: string, opts: { selected?: Record<string, string[]>; variables?: Record<string, number> } = {}) {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected: opts.selected ?? {}, variables: opts.variables ?? {} } as never);
}

/** The open pending choice (or undefined). */
const pending = (engine: SpoilsEngine) => engine.state.pendingChoice as unknown as PendingChoiceLike | undefined;

/** Answers the open pending choice and drains any response window it leaves behind. */
function resolveChoice(engine: SpoilsEngine, player: Player, choice: unknown) {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice } as never);
  resolvePendingResponses(engine);
}

/** Tries to answer the open pending choice (without draining), for "this pick is refused" assertions. */
const tryChoice = (engine: SpoilsEngine, player: Player, choice: unknown) => () =>
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice } as never);

const tokens = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId].counters?.token ?? 0;
const zoneOf = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId].zone;
const handOf = (engine: SpoilsEngine, player: Player) => engine.state.players[player].hand;
const deckOf = (engine: SpoilsEngine, player: Player) => engine.state.players[player].deck;
const discardOf = (engine: SpoilsEngine, player: Player) => engine.state.players[player].discard;
const factionIdOf = (engine: SpoilsEngine, player: Player) => engine.state.players[player].factionId!;

/** Every logged event of one type. */
function eventsOf(engine: SpoilsEngine, type: string): Array<Record<string, unknown>> {
  return engine
    .getLog()
    .filter((entry) => (entry as { event?: { type?: string } }).event?.type === type)
    .map((entry) => (entry as unknown as { event: Record<string, unknown> }).event);
}

/** Index in the log of the first event satisfying `test`, or -1. */
function logIndex(engine: SpoilsEngine, test: (event: Record<string, unknown>) => boolean): number {
  return engine.getLog().findIndex((entry) => {
    const event = (entry as { event?: Record<string, unknown> }).event;
    return event !== undefined && test(event);
  });
}

/** A face-down resource placement (any card face-down in play is a Volition resource, CR 411.1). */
function faceDownCard(key: string, owner: Player, name = key): CardPlacement {
  return { key, def: character({ name }), owner, zone: "play", faceDown: true };
}

/** Resources `player` has attached to (spent on) their faction. */
function spent(owner: Player, n: number): CardPlacement[] {
  return bank("rage", n, owner).map((placement) => ({ ...placement, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));
}

/** A free tactic with a play-time `kill` pick (destroys one character). */
const KILLER = () =>
  tactic({
    name: "Killer",
    cost: 0,
    behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });

/** A free tactic that returns one chosen card in play to its owner's hand. */
const BOUNCER = () =>
  tactic({
    name: "Bouncer",
    cost: 0,
    behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });

/** A free tactic that removes one chosen character from the game. */
const REMOVER = () =>
  tactic({
    name: "Remover",
    cost: 0,
    behavior: { abilities: [{ id: "r", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "removeFromGame", target: { type: "selected", id: "t" } }] }] }
  });

/** A free tactic that puts a chosen card from hand into play (never "deploys" it). */
const PUTTER = () =>
  tactic({
    name: "Putter",
    cost: 0,
    behavior: { abilities: [{ id: "p", type: "activated", targets: [{ id: "t", selector: { zone: "hand", type: "character" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });

/** A free tactic: "draw a card". */
const CANTRIP = (name = "Cantrip") =>
  tactic({ name, cost: 0, behavior: { abilities: [{ id: "c", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });

// --- COVERT (shared checks; each COVERT card calls these through its own printing) ---
// COVERT: a party made only of covert characters is a covert party; only covert
// characters may block it, and covert characters may block only covert parties
// (RULES.md 9, CR 507.3).

function covertBoard(printingId: string, attacker: Player) {
  const defender = attacker === P1 ? P2 : P1;
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

function declareAttackBy(engine: SpoilsEngine, player: Player, attackerIds: string[]) {
  const defender = player === P1 ? P2 : P1;
  engine.perform({ type: "declareAttack", playerId: player, attackerIds, target: { type: "faction", playerId: defender } });
  resolvePendingResponses(engine);
}

function covertHasKeyword(printingId: string) {
  const { engine, id } = covertBoard(printingId, P1);
  assert.ok(engine.getKeywords(id("subject")).includes("covert"), "engine.getKeywords(id(\"subject\")).includes(\"covert\")");
  assert.equal(engine.getKeywords(id("plainAlly")).includes("covert"), false, "control: an ordinary character is not covert");
}

function covertCannotBeBlockedByNonCovert(printingId: string) {
  const { engine, id } = covertBoard(printingId, P1);
  declareAttackBy(engine, P1, [id("subject")]);
  assert.throws(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("plainBlocker")] }), "a non-covert character cannot block a covert party");
  assert.throws(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("plainBlocker"), id("covertBlocker")] }), "...nor join a covert blocker in the blocking party");
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("covertBlocker")] });
  assert.deepEqual(engine.state.battle?.blockingParty, [id("covertBlocker")], "a covert character may block it");
}

function covertPartyNeedsEveryMemberCovert(printingId: string) {
  const { engine, id } = covertBoard(printingId, P1);
  declareAttackBy(engine, P1, [id("subject"), id("plainAlly")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("plainBlocker")] });
  assert.deepEqual(engine.state.battle?.blockingParty, [id("plainBlocker")], "with a non-covert party member the party is not covert, so anyone may block");
}

function covertBlocksOnlyCovertParties(printingId: string) {
  // P2 attacks with plain characters; the card under test (P1's, covert) is a would-be blocker
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "subject", def: printing(printingId), owner: P1, zone: "play" },
      { key: "plainBlocker", def: character({ name: "PlainBlocker" }), owner: P1, zone: "play" },
      { key: "plainAttacker", def: character({ name: "PlainAttacker" }), owner: P2, zone: "play" },
      { key: "covertAttacker", def: character({ name: "CovertAttacker", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(engine, P2, [id("plainAttacker")]);
  assert.throws(() => engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("subject")] }), "a covert character may block only a covert party");
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("plainBlocker")] });
  assert.deepEqual(engine.state.battle?.blockingParty, [id("plainBlocker")], "control: a plain character can block the plain attacker");

  const covertParty = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "subject", def: printing(printingId), owner: P1, zone: "play" },
      { key: "covertAttacker", def: character({ name: "CovertAttacker", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(covertParty.engine, P2, [covertParty.id("covertAttacker")]);
  covertParty.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [covertParty.id("subject")] });
  assert.deepEqual(covertParty.engine.state.battle?.blockingParty, [covertParty.id("subject")], "it can block a covert party");
}

// =============================================================================
// Servile Centipede
// When this card enters play, you may search your deck for a tactic. If you do,
// reveal it and put it into your hand. Character, cost 4, threshold [O], 1/3/3.
// =============================================================================

const CENTIPEDE = "d161dd99-3bd1-4fdb-9fdd-924a70f7c0f4";

function centipedeBoard(opts: { zone?: "hand" | "play"; obsession?: number; greed?: number; tacticsInDeck?: boolean; controller?: Player } = {}) {
  const owner = opts.controller ?? P1;
  const other = owner === P1 ? P2 : P1;
  const withTactics = opts.tacticsInDeck !== false;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: owner === P1 ? 1 : 2,
    activePlayerId: owner,
    cards: [
      { key: "sc", def: printing(CENTIPEDE), owner, zone: opts.zone ?? "hand" },
      { key: "c1", def: character({ name: "C1" }), owner, zone: "deck" },
      ...(withTactics ? [{ key: "tacA", def: tactic({ name: "TacA" }), owner, zone: "deck" as const }] : []),
      { key: "c2", def: character({ name: "C2" }), owner, zone: "deck" },
      ...(withTactics ? [{ key: "tacB", def: tactic({ name: "TacB" }), owner, zone: "deck" as const }] : []),
      { key: "c3", def: character({ name: "C3" }), owner, zone: "deck" },
      { key: "c4", def: item({ name: "C4" }), owner, zone: "deck" },
      { key: "c5", def: character({ name: "C5" }), owner, zone: "deck" },
      { key: "handTac", def: tactic({ name: "HandTac" }), owner, zone: "hand" },
      { key: "discTac", def: tactic({ name: "DiscTac" }), owner, zone: "discard" },
      { key: "otherChar", def: character({ name: "OtherChar", cost: 0 }), owner, zone: "hand" },
      { key: "oppTac", def: tactic({ name: "OppTac" }), owner: other, zone: "deck" },
      { key: "oppC1", def: character({ name: "OppC1" }), owner: other, zone: "deck" },
      { key: "oppC2", def: character({ name: "OppC2" }), owner: other, zone: "deck" },
      ...bank("obsession", opts.obsession ?? 4, owner),
      ...bank("greed", opts.greed ?? 0, owner)
    ]
  });
}

/** Plays the Centipede and leaves its search prompt open. */
function playCentipede(opts: Parameters<typeof centipedeBoard>[0] = {}) {
  const built = centipedeBoard(opts);
  const owner = opts?.controller ?? P1;
  play(built.engine, owner, built.id("sc"));
  return { ...built, owner };
}

clause(CENTIPEDE, "0:rule", "deploying it costs 4 and enters play; its controller is then offered a search of their deck for a tactic", () => {
  const { engine, id } = centipedeBoard();
  const before = ready(engine);
  play(engine, P1, id("sc"));
  assert.equal(zoneOf(engine, id("sc")), "play");
  assert.equal(before - ready(engine), 4, "the printed cost of 4 is paid");
  const pc = pending(engine)!;
  assert.equal(pc.kind, "selectTargets", "a search is offered");
  assert.equal(pc.playerId, P1, "to its controller");
  assert.equal(pc.sourceId, id("sc"));
  assert.equal(engine.getStat(id("sc"), "strength"), 1);
  assert.equal(engine.getStat(id("sc"), "life"), 3);
  assert.equal(engine.getStat(id("sc"), "speed"), 3);
});

for (const pick of ["tacA", "tacB"] as const) {
  clause(CENTIPEDE, "0:rule", `searching and picking ${pick}: it goes from the deck to your hand and no other card moves`, () => {
    const { engine, id } = centipedeBoard();
    const handBefore = [...handOf(engine, P1)];
    const deckBefore = [...deckOf(engine, P1)];
    play(engine, P1, id("sc"));
    resolveChoice(engine, P1, { kind: "selectTargets", selected: { target: [id(pick)] } });
    assert.equal(pending(engine), undefined);
    assert.equal(zoneOf(engine, id(pick)), "hand");
    assert.deepEqual([...handOf(engine, P1)].sort(), [...handBefore.filter((c) => c !== id("sc")), id(pick)].sort(), "the hand gains exactly the picked tactic");
    assert.deepEqual([...deckOf(engine, P1)].sort(), deckBefore.filter((c) => c !== id(pick)).sort(), "the rest of the deck is the same cards");
    const other = pick === "tacA" ? "tacB" : "tacA";
    assert.equal(zoneOf(engine, id(other)), "deck", "only ONE tactic is taken");
    assert.equal(zoneOf(engine, id("sc")), "play", "the Centipede stays in play");
  });
}

clause(CENTIPEDE, "0:rule", "'reveal it': the found tactic is revealed to everyone, exactly once, before it goes into your hand", () => {
  const { engine, id } = centipedeBoard();
  play(engine, P1, id("sc"));
  resolveChoice(engine, P1, { kind: "selectTargets", selected: { target: [id("tacB")] } });
  const reveals = eventsOf(engine, "cardsRevealed");
  assert.equal(reveals.length, 1, "one reveal");
  assert.deepEqual(reveals[0].cardIds, [id("tacB")], "exactly the tactic that was found");
  assert.equal(reveals[0].viewerId, "all", "revealed to every player");
  const revealAt = logIndex(engine, (e) => e.type === "cardsRevealed");
  const moveAt = logIndex(engine, (e) => e.type === "cardMoved" && e.cardId === id("tacB") && e.to === "hand");
  assert.ok(revealAt >= 0 && moveAt > revealAt, "revealed first, then put into the hand");
});

clause(CENTIPEDE, "0:rule", "only a TACTIC in YOUR DECK can be found: a character or item in the deck, a tactic in your hand or discard pile, or in the opponent's deck, are refused", () => {
  const { engine, id } = playCentipede();
  const pickOf = (...keys: string[]) => tryChoice(engine, P1, { kind: "selectTargets", selected: { target: keys.map(id) } });
  assert.throws(pickOf("c1"), "a character in the deck");
  assert.throws(pickOf("c4"), "an item in the deck");
  assert.throws(pickOf("handTac"), "a tactic in hand");
  assert.throws(pickOf("discTac"), "a tactic in the discard pile");
  assert.throws(pickOf("oppTac"), "a tactic in the opponent's deck");
  assert.throws(pickOf("tacA", "tacB"), "only one card is found");
  assert.equal(pending(engine)?.kind, "selectTargets", "still waiting for a legal answer");
  assert.equal(zoneOf(engine, id("handTac")), "hand");
  assert.equal(zoneOf(engine, id("oppTac")), "deck");
  pickOf("tacA")();
  assert.equal(zoneOf(engine, id("tacA")), "hand");
});

clause(CENTIPEDE, "0:rule", "'may': declining the search moves nothing, reveals nothing, and leaves the Centipede in play", () => {
  const { engine, id } = playCentipede();
  const handBefore = [...handOf(engine, P1)];
  const deckBefore = [...deckOf(engine, P1)];
  resolveChoice(engine, P1, { kind: "selectTargets", selected: { target: [] } });
  assert.equal(pending(engine), undefined);
  assert.deepEqual([...handOf(engine, P1)].sort(), handBefore.sort(), "the hand is unchanged");
  assert.deepEqual([...deckOf(engine, P1)].sort(), deckBefore.sort(), "no card left the deck");
  assert.equal(eventsOf(engine, "cardsRevealed").length, 0, "nothing was revealed ('If you do')");
  assert.equal(zoneOf(engine, id("tacA")), "deck");
  assert.equal(zoneOf(engine, id("tacB")), "deck");
  assert.equal(zoneOf(engine, id("sc")), "play");
});

clause(CENTIPEDE, "0:rule", "the searched deck is shuffled afterwards (CR 312.1); it is the same cards in a new order", () => {
  const { engine, id } = centipedeBoard();
  const before = deckOf(engine, P1).filter((c) => c !== id("tacA"));
  play(engine, P1, id("sc"));
  resolveChoice(engine, P1, { kind: "selectTargets", selected: { target: [id("tacA")] } });
  const after = deckOf(engine, P1);
  assert.deepEqual([...after].sort(), [...before].sort(), "same cards");
  assert.notDeepEqual(after, before, "in a new order");
});

clause(CENTIPEDE, "0:rule", "only YOUR deck is searched and shuffled: the opponent's deck, hand and discard pile are untouched", () => {
  const { engine, id } = centipedeBoard();
  const oppDeck = [...deckOf(engine, P2)];
  const oppHand = [...handOf(engine, P2)];
  const oppDiscard = [...discardOf(engine, P2)];
  play(engine, P1, id("sc"));
  resolveChoice(engine, P1, { kind: "selectTargets", selected: { target: [id("tacA")] } });
  assert.deepEqual(deckOf(engine, P2), oppDeck, "same cards, same order");
  assert.deepEqual(handOf(engine, P2), oppHand);
  assert.deepEqual(discardOf(engine, P2), oppDiscard);
});

clause(CENTIPEDE, "0:rule", "a deck with no tactic in it: nothing can be found, the hand is unchanged and nothing is revealed", () => {
  const { engine, id } = centipedeBoard({ tacticsInDeck: false });
  const handBefore = [...handOf(engine, P1)];
  play(engine, P1, id("sc"));
  drain(engine, declineAll);
  assert.equal(pending(engine), undefined);
  assert.deepEqual([...handOf(engine, P1)].sort(), handBefore.filter((c) => c !== id("sc")).sort());
  assert.equal(eventsOf(engine, "cardsRevealed").length, 0);
  assert.equal(zoneOf(engine, id("sc")), "play");
});

clause(CENTIPEDE, "0:rule", "it triggers when THIS card enters play, not when other cards do (your own characters, the opponent's)", () => {
  const { engine, id } = centipedeBoard({ zone: "play" });
  const deckBefore = [...deckOf(engine, P1)];
  play(engine, P1, id("otherChar"));
  assert.equal(zoneOf(engine, id("otherChar")), "play");
  assert.equal(pending(engine), undefined, "no search when another card of yours enters play");
  assert.deepEqual(deckOf(engine, P1), deckBefore);

  const theirs = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sc", def: printing(CENTIPEDE), owner: P1, zone: "play" },
      { key: "tac", def: tactic({ name: "Tac" }), owner: P1, zone: "deck" },
      { key: "theirChar", def: character({ name: "TheirChar", cost: 0 }), owner: P2, zone: "hand" }
    ]
  });
  play(theirs.engine, P2, theirs.id("theirChar"));
  assert.equal(pending(theirs.engine), undefined, "no search when the opponent's card enters play");
  assert.equal(zoneOf(theirs.engine, theirs.id("tac")), "deck");
});

clause(CENTIPEDE, "0:rule", "a Centipede already in play does not search again when a second Centipede enters: exactly one search, for the newcomer", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "old", def: printing(CENTIPEDE), owner: P1, zone: "play" },
      { key: "new", def: printing(CENTIPEDE), owner: P1, zone: "hand" },
      { key: "tacA", def: tactic({ name: "TacA" }), owner: P1, zone: "deck" },
      { key: "tacB", def: tactic({ name: "TacB" }), owner: P1, zone: "deck" },
      { key: "c1", def: character({ name: "C1" }), owner: P1, zone: "deck" },
      ...bank("obsession", 4, P1)
    ]
  });
  play(engine, P1, id("new"));
  const pc = pending(engine)!;
  assert.equal(pc.kind, "selectTargets");
  assert.equal(pc.sourceId, id("new"), "the entering Centipede's trigger");
  resolveChoice(engine, P1, { kind: "selectTargets", selected: { target: [id("tacA")] } });
  assert.equal(pending(engine), undefined, "no second search for the Centipede that was already in play");
  assert.equal(zoneOf(engine, id("tacB")), "deck");
});

clause(CENTIPEDE, "0:rule", "a Centipede that is simply in play (never entered) or leaves play does not search", () => {
  const { engine, id } = centipedeBoard({ zone: "play" });
  assert.equal(pending(engine), undefined, "no trigger for a card placed in play");
  const killer = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "sc", def: printing(CENTIPEDE), owner: P1, zone: "play" },
      { key: "killer", def: KILLER(), owner: P1, zone: "hand" },
      { key: "tac", def: tactic({ name: "Tac" }), owner: P1, zone: "deck" }
    ]
  });
  play(killer.engine, P1, killer.id("killer"), { selected: { t: [killer.id("sc")] } });
  drain(killer.engine, declineAll);
  assert.equal(zoneOf(killer.engine, killer.id("sc")), "discard");
  assert.equal(zoneOf(killer.engine, killer.id("tac")), "deck", "leaving play does not search");
  assert.equal(eventsOf(killer.engine, "cardsRevealed").length, 0);
  void engine;
  void id;
});

clause(CENTIPEDE, "0:rule", "'enters play' includes being put into play by an effect, not only being deployed from hand", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "putter", def: PUTTER(), owner: P1, zone: "hand" },
      { key: "sc", def: printing(CENTIPEDE), owner: P1, zone: "hand" },
      { key: "tacA", def: tactic({ name: "TacA" }), owner: P1, zone: "deck" },
      { key: "c1", def: character({ name: "C1" }), owner: P1, zone: "deck" }
    ]
  });
  const before = ready(engine);
  play(engine, P1, id("putter"), { selected: { t: [id("sc")] } });
  assert.equal(zoneOf(engine, id("sc")), "play");
  assert.equal(ready(engine), before, "put into play: no cost paid");
  const pc = pending(engine)!;
  assert.equal(pc.kind, "selectTargets", "the search is offered");
  resolveChoice(engine, P1, { kind: "selectTargets", selected: { target: [id("tacA")] } });
  assert.equal(zoneOf(engine, id("tacA")), "hand");
});

clause(CENTIPEDE, "0:rule", "the controller's deck is searched: a Centipede played by the opponent searches THEIR deck, not its owner's", () => {
  const { engine, id } = centipedeBoard({ controller: P2 });
  // P2 plays "sc" (owned by P2 in this board); P1's deck holds a tactic too.
  const p1Tac = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sc", def: printing(CENTIPEDE), owner: P2, zone: "hand" },
      { key: "mine", def: tactic({ name: "Mine" }), owner: P1, zone: "deck" },
      { key: "theirs", def: tactic({ name: "Theirs" }), owner: P2, zone: "deck" },
      { key: "d", def: character({ name: "D" }), owner: P2, zone: "deck" },
      ...bank("obsession", 4, P2)
    ]
  });
  play(engine, P2, id("sc"));
  const pc = pending(engine)!;
  assert.equal(pc.playerId, P2, "the Centipede's controller searches");
  assert.throws(tryChoice(engine, P2, { kind: "selectTargets", selected: { target: [id("oppTac")] } }), "P1's tactic cannot be found");
  resolveChoice(engine, P2, { kind: "selectTargets", selected: { target: [id("tacA")] } });
  assert.equal(zoneOf(engine, id("tacA")), "hand");
  assert.equal(handOf(engine, P2).includes(id("tacA")), true, "it goes to the searcher's hand");
  assert.equal(zoneOf(engine, id("oppTac")), "deck", "the other player's deck is untouched");

  play(p1Tac.engine, P2, p1Tac.id("sc"));
  resolveChoice(p1Tac.engine, P2, { kind: "selectTargets", selected: { target: [p1Tac.id("theirs")] } });
  assert.equal(zoneOf(p1Tac.engine, p1Tac.id("theirs")), "hand");
  assert.equal(zoneOf(p1Tac.engine, p1Tac.id("mine")), "deck");
});

clause(CENTIPEDE, "0:rule", "is refused one resource short of its cost of 4, and without [O] even with enough other resources", () => {
  const short = centipedeBoard({ obsession: 3 });
  assert.throws(() => playRaw(short.engine, P1, short.id("sc")));
  assert.equal(zoneOf(short.engine, short.id("sc")), "hand", "nothing was played");
  const noThreshold = centipedeBoard({ obsession: 0, greed: 6 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("sc")));
  const exact = centipedeBoard({ obsession: 1, greed: 3 });
  play(exact.engine, P1, exact.id("sc"));
  assert.equal(zoneOf(exact.engine, exact.id("sc")), "play", "[O] plus 4 resources is enough");
  assert.equal(pending(exact.engine)?.kind, "selectTargets");
});

// =============================================================================
// Skimping Ecto-Manipulator
// ENERGIZE -- COST: Deplete this card. Pick a non-resource card you control. --
// EFFECT: Put a token on the card. Character, cost 2, threshold [O], 1/3/1.
// =============================================================================

const SKIMPING = "246e090f-0e1b-47fb-8ee1-d8bce0c865f6";
const ALL_SKIMPING_KEYS = ["se", "ally", "myItem", "myLoc", "foe", "foeItem", "foeLoc", "stolen", "lent", "faceDown", "handCard", "discCard", "deckCard"];

function skimpingBoard(opts: { zone?: "play" | "hand"; depleted?: boolean; obsession?: number; greed?: number; noFaceDown?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "se", def: printing(SKIMPING), owner: P1, zone: opts.zone ?? "play", depleted: opts.depleted },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "myLoc", def: location({ name: "MyLoc" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "foeItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      { key: "foeLoc", def: location({ name: "FoeLoc" }), owner: P2, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 },
      { key: "lent", def: character({ name: "Lent" }), owner: P1, zone: "play", controller: P2 },
      ...(opts.noFaceDown ? [] : [faceDownCard("faceDown", P1)]),
      { key: "handCard", def: character({ name: "HandCard" }), owner: P1, zone: "hand" },
      { key: "discCard", def: character({ name: "DiscCard" }), owner: P1, zone: "discard" },
      { key: "deckCard", def: character({ name: "DeckCard" }), owner: P1, zone: "deck" },
      ...bank("obsession", opts.obsession ?? 3, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

for (const [key, what] of [
  ["ally", "another character of yours"],
  ["myItem", "an item of yours"],
  ["myLoc", "a location of yours"],
  ["stolen", "a character you control but do not own"],
  ["se", "itself"]
] as const) {
  clause(SKIMPING, "0:ability:energize", `depletes this card and puts exactly one token on ${what} (and on nothing else), at no resource cost`, () => {
    const { engine, id } = skimpingBoard();
    const resources = ready(engine);
    activate(engine, P1, id("se"), "energize", { selected: { c: [id(key)] } });
    assert.equal(engine.state.cards[id("se")].depleted, true, "COST: Deplete this card");
    for (const other of ALL_SKIMPING_KEYS) assert.equal(tokens(engine, id(other)), other === key ? 1 : 0, `${other} tokens`);
    assert.equal(ready(engine), resources, "no resources are paid");
    assert.equal(pending(engine), undefined);
  });
}

clause(SKIMPING, "0:ability:energize", "a card that already has tokens gets one more", () => {
  const { engine, id } = skimpingBoard();
  engine.state.cards[id("myItem")].counters = { token: 2 };
  activate(engine, P1, id("se"), "energize", { selected: { c: [id("myItem")] } });
  assert.equal(tokens(engine, id("myItem")), 3);
});

clause(SKIMPING, "0:ability:energize", "only a non-resource card YOU control can be picked: resources, face-down cards, factions, the opponent's cards, and cards outside play are refused (and nothing is depleted)", () => {
  const { engine, id } = skimpingBoard();
  const resourceId = engine.state.players[P1].play.find((c) => engine.getDefinition(c).type === "resource")!;
  assert.ok(resourceId, "resourceId");
  const attempt = (cardId: string) => () => activateRaw(engine, P1, id("se"), "energize", { selected: { c: [cardId] } });
  assert.throws(attempt(resourceId), "a resource");
  assert.throws(attempt(id("faceDown")), "a face-down card is only a resource");
  assert.throws(attempt(factionIdOf(engine, P1)), "your own faction (CR 202.9)");
  assert.throws(attempt(factionIdOf(engine, P2)), "the opponent's faction");
  assert.throws(attempt(id("foe")), "the opponent's character");
  assert.throws(attempt(id("foeItem")), "the opponent's item");
  assert.throws(attempt(id("foeLoc")), "the opponent's location");
  assert.throws(attempt(id("lent")), "a character the opponent controls (even though you own it)");
  assert.throws(attempt(id("handCard")), "a card in your hand");
  assert.throws(attempt(id("discCard")), "a card in your discard pile");
  assert.throws(attempt(id("deckCard")), "a card in your deck");
  assert.throws(() => activateRaw(engine, P1, id("se"), "energize", { selected: {} }), "no pick");
  assert.throws(() => activateRaw(engine, P1, id("se"), "energize", { selected: { c: [id("ally"), id("myItem")] } }), "two picks: only one card gets the token");
  assert.equal(engine.state.cards[id("se")].depleted, false, "a refused activation does not deplete");
  for (const key of ALL_SKIMPING_KEYS) assert.equal(tokens(engine, id(key)), 0, `${key}: no tokens`);
  activate(engine, P1, id("se"), "energize", { selected: { c: [id("ally")] } });
  assert.equal(tokens(engine, id("ally")), 1, "a legal pick is accepted");
});

clause(SKIMPING, "0:ability:energize", "cannot be used while already depleted, and then adds no token", () => {
  const { engine, id } = skimpingBoard({ depleted: true });
  assert.throws(() => activateRaw(engine, P1, id("se"), "energize", { selected: { c: [id("ally")] } }));
  assert.equal(tokens(engine, id("ally")), 0);
  assert.equal(engine.state.cards[id("se")].depleted, true);
});

clause(SKIMPING, "0:ability:energize", "once per untap: a second use the same turn is refused, and it can be used again on your next turn", () => {
  const { engine, id } = skimpingBoard();
  activate(engine, P1, id("se"), "energize", { selected: { c: [id("ally")] } });
  assert.throws(() => activateRaw(engine, P1, id("se"), "energize", { selected: { c: [id("ally")] } }), "depleted: not twice in one turn");
  assert.equal(tokens(engine, id("ally")), 1);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.cards[id("se")].depleted, false, "restored at the start of your turn");
  activate(engine, P1, id("se"), "energize", { selected: { c: [id("ally")] } });
  assert.equal(tokens(engine, id("ally")), 2, "a token on each of two turns");
});

clause(SKIMPING, "0:ability:energize", "can be used the turn it enters play (a character may use its abilities the first turn, CR 204.3a)", () => {
  const { engine, id } = skimpingBoard({ zone: "hand", obsession: 2 });
  play(engine, P1, id("se"));
  assert.equal(zoneOf(engine, id("se")), "play");
  activate(engine, P1, id("se"), "energize", { selected: { c: [id("ally")] } });
  assert.equal(tokens(engine, id("ally")), 1);
  assert.equal(engine.state.cards[id("se")].depleted, true);
});

clause(SKIMPING, "0:ability:energize", "only its controller can use it, and not from your hand", () => {
  const { engine, id } = skimpingBoard();
  assert.throws(() => activateRaw(engine, P2, id("se"), "energize", { selected: { c: [id("foe")] } }), "the opponent cannot");
  assert.equal(engine.state.cards[id("se")].depleted, false);
  const inHand = skimpingBoard({ zone: "hand" });
  assert.throws(() => activateRaw(inHand.engine, P1, inHand.id("se"), "energize", { selected: { c: [inHand.id("ally")] } }), "not from hand");
  assert.equal(tokens(inHand.engine, inHand.id("ally")), 0);
});

clause(SKIMPING, "0:ability:energize", "deploying it costs 2 and needs [O]: refused one short, refused without [O], 1/3/1 in play", () => {
  const short = skimpingBoard({ zone: "hand", obsession: 1, noFaceDown: true });
  assert.throws(() => playRaw(short.engine, P1, short.id("se")));
  const noThreshold = skimpingBoard({ zone: "hand", obsession: 0, greed: 5, noFaceDown: true });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("se")));
  const exact = skimpingBoard({ zone: "hand", obsession: 1, greed: 1, noFaceDown: true });
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("se"));
  assert.equal(zoneOf(exact.engine, exact.id("se")), "play");
  assert.equal(before - ready(exact.engine), 2, "the printed cost of 2 is paid");
  assert.equal(exact.engine.getStat(exact.id("se"), "strength"), 1);
  assert.equal(exact.engine.getStat(exact.id("se"), "speed"), 3);
  assert.equal(exact.engine.getStat(exact.id("se"), "life"), 1);
});

// =============================================================================
// Sneaking Spitspider
// COVERT. Character, cost 3, threshold [O], 2/3/2.
// =============================================================================

const SPITSPIDER = "b1e3515a-37e2-4a23-85f5-52b44c292edd";

clause(SPITSPIDER, "0:kw:COVERT", "has the COVERT keyword, and no other keyword", () => {
  covertHasKeyword(SPITSPIDER);
  const { engine, id } = covertBoard(SPITSPIDER, P1);
  assert.deepEqual(engine.getKeywords(id("subject")), ["covert"], "COVERT is its only keyword (no AGGRO, TACTICAL, ...)");
});
clause(SPITSPIDER, "0:kw:COVERT", "cannot be blocked by non-covert characters; covert characters can block it", () => covertCannotBeBlockedByNonCovert(SPITSPIDER));
clause(SPITSPIDER, "0:kw:COVERT", "a party with a non-covert member is not a covert party", () => covertPartyNeedsEveryMemberCovert(SPITSPIDER));
clause(SPITSPIDER, "0:kw:COVERT", "as a covert character it can block only covert parties", () => covertBlocksOnlyCovertParties(SPITSPIDER));

clause(SPITSPIDER, "0:kw:COVERT", "a covert party containing it, attacking with another covert character, still cannot be blocked by a non-covert character", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "subject", def: printing(SPITSPIDER), owner: P1, zone: "play" },
      { key: "covertAlly", def: character({ name: "CovertAlly", behavior: { keywords: ["covert"] } }), owner: P1, zone: "play" },
      { key: "plain", def: character({ name: "Plain" }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(engine, P1, [id("subject"), id("covertAlly")]);
  assert.throws(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("plain")] }));
});

clause(SPITSPIDER, "0:kw:COVERT", "deploys for 3 with [O] (refused one short or without [O]) and, with no AGGRO, cannot attack the turn it enters", () => {
  const build = (obsession: number, greed: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      cards: [
        { key: "ss", def: printing(SPITSPIDER), owner: P1, zone: "hand" },
        ...bank("obsession", obsession, P1),
        ...bank("greed", greed, P1)
      ]
    });
  const short = build(2, 0);
  assert.throws(() => playRaw(short.engine, P1, short.id("ss")));
  const noThreshold = build(0, 5);
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("ss")));
  const { engine, id } = build(1, 2);
  const before = ready(engine);
  play(engine, P1, id("ss"));
  assert.equal(zoneOf(engine, id("ss")), "play");
  assert.equal(before - ready(engine), 3, "the printed cost of 3 is paid");
  assert.equal(engine.getStat(id("ss"), "strength"), 2);
  assert.equal(engine.getStat(id("ss"), "speed"), 3);
  assert.equal(engine.getStat(id("ss"), "life"), 2);
  assert.throws(() => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("ss")], target: { type: "faction", playerId: P2 } }), "COVERT is not AGGRO: it cannot attack the turn it enters play");
});

// =============================================================================
// Spastic Tentacles
// When this card enters play, both players must put a resource they control
// into its owner's hand. Character, cost 3, threshold [O][O], 2/3/2.
// =============================================================================

const TENTACLES = "9b955719-5c5a-4401-8a40-d41c7390829e";

function tentaclesBoard(opts: { active?: Player; p1?: CardPlacement[]; p2?: CardPlacement[]; zone?: "hand" | "play"; extra?: CardPlacement[] } = {}) {
  const active = opts.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: active === P1 ? 1 : 2,
    activePlayerId: active,
    cards: [
      { key: "st", def: printing(TENTACLES), owner: active, zone: opts.zone ?? "hand" },
      { key: "p1char", def: character({ name: "P1Char" }), owner: P1, zone: "play" },
      { key: "p2char", def: character({ name: "P2Char" }), owner: P2, zone: "play" },
      { key: "p1hand", def: character({ name: "P1Hand" }), owner: P1, zone: "hand" },
      { key: "p2hand", def: character({ name: "P2Hand" }), owner: P2, zone: "hand" },
      ...(opts.p1 ?? bank("obsession", 5, P1)),
      ...(opts.p2 ?? bank("rage", 3, P2)),
      ...(opts.extra ?? [])
    ]
  });
}

const resourcesOf = (engine: SpoilsEngine, player: Player) => engine.state.players[player].play.filter((c) => engine.isResource(c));
const resourcesInHand = (engine: SpoilsEngine, player: Player) => handOf(engine, player).filter((c) => engine.getDefinition(c).type === "resource");

/** Answers the Tentacles prompts: each player puts the first resource of theirs into hand; records who was asked in order. */
function tentaclesPicks(engine: SpoilsEngine, picks?: Partial<Record<Player, string[]>>) {
  const asked: string[] = [];
  drain(engine, (pc) => {
    if (pc.kind !== "chooserSelectsTarget") return declineAll(pc);
    asked.push(pc.playerId);
    const mine = picks?.[pc.playerId as Player] ?? [resourcesOf(engine, pc.playerId as Player)[0]];
    return { kind: "chooserSelectsTarget", selected: mine };
  });
  return asked;
}

clause(TENTACLES, "0:rule", "deploying it costs 3; when it enters play EACH player puts one resource they control into their hand, and no other resource moves", () => {
  const { engine, id } = tentaclesBoard();
  const before = ready(engine);
  const p1Res = resourcesOf(engine, P1).length;
  const p2Res = resourcesOf(engine, P2).length;
  play(engine, P1, id("st"));
  assert.equal(zoneOf(engine, id("st")), "play");
  assert.ok(before - ready(engine) >= 3, "the cost was paid");
  const p1Handful = handOf(engine, P1).length;
  const asked = tentaclesPicks(engine);
  assert.deepEqual(asked, [P1, P2], "both players are asked, one pick each");
  assert.equal(resourcesOf(engine, P1).length, p1Res - 1, "P1 has one resource fewer in play");
  assert.equal(resourcesOf(engine, P2).length, p2Res - 1, "P2 has one resource fewer in play");
  assert.equal(resourcesInHand(engine, P1).length, 1, "P1's resource is in P1's hand");
  assert.equal(resourcesInHand(engine, P2).length, 1, "P2's resource is in P2's hand");
  assert.equal(handOf(engine, P1).length, p1Handful + 1);
  assert.equal(zoneOf(engine, id("st")), "play", "the Tentacles stays in play");
  assert.equal(zoneOf(engine, id("p1char")), "play");
  assert.equal(zoneOf(engine, id("p2char")), "play");
});

clause(TENTACLES, "0:rule", "it costs 3 to deploy (the printed cost is paid before the resources are returned)", () => {
  const { engine, id } = tentaclesBoard({ p1: bank("obsession", 3, P1) });
  const before = ready(engine);
  play(engine, P1, id("st"));
  assert.equal(before - ready(engine), 3, "the printed cost of 3 is paid");
});

clause(TENTACLES, "0:rule", "each player chooses their OWN resource: P1 cannot pick P2's resource, P2 cannot pick P1's", () => {
  const { engine, id } = tentaclesBoard();
  play(engine, P1, id("st"));
  const first = pending(engine)!;
  assert.equal(first.kind, "chooserSelectsTarget");
  assert.equal(first.playerId, P1, "the active player (the one who deployed it) acts first (CR 402.2)");
  const theirs = resourcesOf(engine, P2)[0];
  const mine = resourcesOf(engine, P1)[0];
  assert.throws(tryChoice(engine, P1, { kind: "chooserSelectsTarget", selected: [theirs] }), "P1 cannot put P2's resource into a hand");
  resolveChoice(engine, P1, { kind: "chooserSelectsTarget", selected: [mine] });
  const second = pending(engine)!;
  assert.equal(second.kind, "chooserSelectsTarget");
  assert.equal(second.playerId, P2, "then the other player");
  assert.throws(tryChoice(engine, P2, { kind: "chooserSelectsTarget", selected: [resourcesOf(engine, P1)[0]] }), "P2 cannot put P1's resource into a hand");
  resolveChoice(engine, P2, { kind: "chooserSelectsTarget", selected: [theirs] });
  assert.equal(pending(engine), undefined);
  assert.equal(handOf(engine, P1).includes(mine), true);
  assert.equal(handOf(engine, P2).includes(theirs), true);
});

clause(TENTACLES, "0:rule", "the choice is exactly one RESOURCE, and mandatory: a character, a faction, a card in hand, none, or two are refused", () => {
  const { engine, id } = tentaclesBoard();
  play(engine, P1, id("st"));
  const attempt = (...ids: string[]) => tryChoice(engine, P1, { kind: "chooserSelectsTarget", selected: ids });
  assert.throws(attempt(id("p1char")), "a character is not a resource");
  assert.throws(attempt(factionIdOf(engine, P1)), "a faction");
  assert.throws(attempt(id("p1hand")), "a card in hand");
  assert.throws(attempt(id("st")), "the Tentacles itself");
  assert.throws(attempt(), "'must': picking nothing is refused while you have a resource");
  assert.throws(attempt(...resourcesOf(engine, P1).slice(0, 2)), "two resources");
  assert.equal(pending(engine)?.playerId, P1, "still waiting for P1");
  attempt(resourcesOf(engine, P1)[0])();
});

clause(TENTACLES, "0:rule", "a face-down card is a resource (Volition) and can be the one put into hand; it goes to its owner's hand", () => {
  const { engine, id } = tentaclesBoard({ p1: bank("obsession", 3, P1), p2: [faceDownCard("fd", P2, "Hidden")] });
  play(engine, P1, id("st"));
  tentaclesPicks(engine, { [P1]: [resourcesOf(engine, P1)[0]], [P2]: [id("fd")] });
  assert.equal(zoneOf(engine, id("fd")), "hand");
  assert.equal(handOf(engine, P2).includes(id("fd")), true, "in P2's hand");
  assert.equal(engine.state.cards[id("fd")].faceDown, false, "no longer face-down");
});

clause(TENTACLES, "0:rule", "a resource already attached to (spent on) the faction still counts as 'a resource they control'", () => {
  const { engine, id } = tentaclesBoard({ p1: bank("obsession", 3, P1), p2: spent(P2, 2) });
  const theirs = resourcesOf(engine, P2);
  assert.equal(ready(engine, P2), 0, "P2's resources are all spent");
  play(engine, P1, id("st"));
  tentaclesPicks(engine, { [P2]: [theirs[0]] });
  assert.equal(zoneOf(engine, theirs[0]), "hand", "a spent resource is put into hand");
  assert.equal(resourcesOf(engine, P2).length, 1);
});

clause(TENTACLES, "0:rule", "a player with no resource does nothing, and the other player still puts one into hand", () => {
  // P2 has no resource: only P1 is asked.
  const p2Lacks = tentaclesBoard({ p2: [] });
  play(p2Lacks.engine, P1, p2Lacks.id("st"));
  assert.deepEqual(tentaclesPicks(p2Lacks.engine), [P1], "only the player with a resource is asked");
  assert.equal(resourcesInHand(p2Lacks.engine, P1).length, 1);
  assert.equal(resourcesInHand(p2Lacks.engine, P2).length, 0);
  assert.equal(pending(p2Lacks.engine), undefined);

  // P1 has no resource (the Tentacles is put into play by an effect): only P2 is asked.
  const p1Lacks = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "putter", def: PUTTER(), owner: P1, zone: "hand" },
      { key: "st", def: printing(TENTACLES), owner: P1, zone: "hand" },
      ...bank("rage", 3, P2)
    ]
  });
  play(p1Lacks.engine, P1, p1Lacks.id("putter"), { selected: { t: [p1Lacks.id("st")] } });
  assert.deepEqual(tentaclesPicks(p1Lacks.engine), [P2], "only the player with a resource is asked");
  assert.equal(resourcesInHand(p1Lacks.engine, P2).length, 1);
  assert.equal(resourcesInHand(p1Lacks.engine, P1).length, 0);
  assert.equal(pending(p1Lacks.engine), undefined);
});

clause(TENTACLES, "0:rule", "'into its OWNER's hand': a resource you control but do not own goes to its owner's hand", () => {
  const borrowed = { ...bank("rage", 1, P2)[0], controller: P1 };
  const { engine, id } = tentaclesBoard({ p1: [...bank("obsession", 3, P1), borrowed] });
  play(engine, P1, id("st"));
  tentaclesPicks(engine, { [P1]: [id(borrowed.key)] });
  assert.equal(zoneOf(engine, id(borrowed.key)), "hand");
  assert.equal(handOf(engine, P2).includes(id(borrowed.key)), true, "it went to P2's hand (its owner)");
  assert.equal(handOf(engine, P1).includes(id(borrowed.key)), false, "not to the player who controlled it");
});

clause(TENTACLES, "0:rule", "when the OPPONENT deploys it, both players still act, with the active player (its controller) first", () => {
  const { engine, id } = tentaclesBoard({ active: P2, p1: bank("obsession", 3, P1), p2: bank("obsession", 5, P2) });
  play(engine, P2, id("st"));
  const first = pending(engine)!;
  assert.equal(first.playerId, P2, "the active player acts first (CR 402.2)");
  const asked = tentaclesPicks(engine);
  assert.deepEqual(asked, [P2, P1]);
  assert.equal(resourcesInHand(engine, P1).length, 1, "the other player also put a resource into their hand");
  assert.equal(resourcesInHand(engine, P2).length, 1);
});

clause(TENTACLES, "0:rule", "it triggers when THIS card enters play: not for other cards entering, not when it is placed in play, not when it leaves play", () => {
  const { engine, id } = tentaclesBoard({ zone: "play", extra: [{ key: "cheap", def: character({ name: "Cheap", cost: 0 }), owner: P1, zone: "hand" }, { key: "killer", def: KILLER(), owner: P1, zone: "hand" }] });
  assert.equal(pending(engine), undefined, "placed in play: no trigger");
  play(engine, P1, id("cheap"));
  assert.equal(pending(engine), undefined, "another card entering play: no trigger");
  play(engine, P1, id("killer"), { selected: { t: [id("st")] } });
  assert.equal(pending(engine), undefined, "leaving play: no trigger");
  assert.equal(zoneOf(engine, id("st")), "discard");
  assert.equal(resourcesInHand(engine, P1).length + resourcesInHand(engine, P2).length, 0, "no resource was moved");
});

clause(TENTACLES, "0:rule", "is refused one resource short of its cost of 3, and without [O][O] even with enough other resources", () => {
  const short = tentaclesBoard({ p1: bank("obsession", 2, P1) });
  assert.throws(() => playRaw(short.engine, P1, short.id("st")));
  const noThreshold = tentaclesBoard({ p1: [...bank("obsession", 1, P1), ...bank("greed", 5, P1)] });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("st")));
  const exact = tentaclesBoard({ p1: [...bank("obsession", 2, P1), ...bank("greed", 1, P1)] });
  play(exact.engine, P1, exact.id("st"));
  assert.equal(zoneOf(exact.engine, exact.id("st")), "play");
  assert.equal(exact.engine.getStat(exact.id("st"), "strength"), 2);
  assert.equal(exact.engine.getStat(exact.id("st"), "speed"), 3);
  assert.equal(exact.engine.getStat(exact.id("st"), "life"), 2);
});

// --- "play a non-resource card with cost X or less for free" (shared by Spontaneous Displacement and Stolen Inspiration) ---

/** Hand placements for `owner`, keyed `h:<name>` (P1) or `o:<name>` (P2). */
function handCards(owner: Player, defs: Def[]): CardPlacement[] {
  return defs.map((def) => ({ key: `${owner === P1 ? "h" : "o"}:${def.name}`, def, owner, zone: "hand" as const }));
}

const costed = (name: string, cost: number, extra: Partial<Def> = {}): Def => character({ name, cost, ...extra });

/** A resource card (not a face-down card): never a legal "non-resource card". */
const stapleCard = (name = "Staple"): Def => ({ ...character({ name, cost: 0 }), type: "resource", resource: { provides: ["rage"], staple: true } }) as Def;

/** The names of the cards the open free-play prompt offers (sorted); the prompt must be a deployForFree for `player`. */
function offeredNames(engine: SpoilsEngine, player: Player = P1): string[] {
  const pc = pending(engine);
  assert.equal(pc?.kind, "deployForFree", "the caster is asked whether to play a card for free");
  assert.equal(pc!.playerId, player, "the caster decides on the free play");
  return (pc!.candidates as string[]).map((c) => engine.getDefinition(c).name).sort();
}

/** Takes the free play of `cardId` (or declines when undefined). */
const freePlay = (engine: SpoilsEngine, cardId?: string, player: Player = P1) => resolveChoice(engine, player, { kind: "deployForFree", cardId });

/** Costs 0..9 as cards named H0..H9 in the caster's hand. */
const COST_LADDER = () => Array.from({ length: 10 }, (_, n) => costed(`H${n}`, n));

// =============================================================================
// Spontaneous Displacement
// COST: Pick a non-resource card. X is half that card's cost, rounded up. --
// EFFECT: Put the card into its owner's hand. You may play a non-resource card
// with cost X or less for free. (You still need the proper resource icons.)
// Tactic, cost 4, threshold [O][O][O].
// =============================================================================

const DISPLACEMENT = "13f59198-df1c-4d96-a4f9-25dd1992f4e9";

function displacementBoard(opts: { foeCost?: number; hand?: Def[]; obsession?: number; greed?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "sd", def: printing(DISPLACEMENT), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", cost: 4 }), owner: P1, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem", cost: 1 }), owner: P1, zone: "play" },
      { key: "myLoc", def: location({ name: "MyLoc", cost: 7 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", cost: opts.foeCost ?? 4 }), owner: P2, zone: "play" },
      { key: "foeItem", def: item({ name: "FoeItem", cost: 3 }), owner: P2, zone: "play" },
      { key: "foeLoc", def: location({ name: "FoeLoc", cost: 2 }), owner: P2, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen", cost: 6 }), owner: P2, zone: "play", controller: P1 },
      faceDownCard("faceDown", P2),
      { key: "inDiscard", def: costed("InDiscard", 0), owner: P1, zone: "discard" },
      { key: "inDeck", def: costed("InDeck", 0), owner: P1, zone: "deck" },
      { key: "oppHand", def: costed("OppHand", 0), owner: P2, zone: "hand" },
      ...handCards(P1, opts.hand ?? []),
      ...bank("obsession", opts.obsession ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const displace = (engine: SpoilsEngine, id: Ids, key: string) => play(engine, P1, id("sd"), { selected: { bounced: [id(key)] } });

for (const [key, owner] of [
  ["foe", P2],
  ["foeItem", P2],
  ["foeLoc", P2],
  ["mine", P1],
  ["myItem", P1],
  ["myLoc", P1],
  ["stolen", P2]
] as const) {
  clause(DISPLACEMENT, "0:ability", `pays 4 and puts the picked ${key} into its OWNER's (${owner}) hand; nothing else moves, and the tactic ends in the discard pile`, () => {
    const { engine, id } = displacementBoard();
    const before = ready(engine);
    displace(engine, id, key);
    drain(engine, declineAll);
    assert.equal(before - ready(engine), 4, "the printed cost of 4 is paid");
    assert.equal(zoneOf(engine, id(key)), "hand");
    assert.equal(handOf(engine, owner).includes(id(key)), true, `in ${owner}'s hand`);
    for (const other of ["mine", "myItem", "myLoc", "foe", "foeItem", "foeLoc", "stolen"]) {
      if (other !== key) assert.equal(zoneOf(engine, id(other)), "play", `${other} stays in play`);
    }
    assert.equal(zoneOf(engine, id("sd")), "discard");
  });
}

for (const [cost, x] of [
  [0, 0],
  [1, 1],
  [2, 1],
  [3, 2],
  [4, 2],
  [5, 3],
  [6, 3],
  [7, 4],
  [8, 4],
  [9, 5]
] as const) {
  clause(DISPLACEMENT, "0:ability", `picked card cost ${cost}: X = half rounded up = ${x}, so exactly the hand cards of cost ${x} or less are offered`, () => {
    const { engine, id } = displacementBoard({ foeCost: cost, hand: COST_LADDER() });
    displace(engine, id, "foe");
    const expected = Array.from({ length: x + 1 }, (_, n) => `H${n}`).sort();
    assert.deepEqual(offeredNames(engine), expected);
    assert.throws(tryChoice(engine, P1, { kind: "deployForFree", cardId: id(`h:H${Math.min(x + 1, 9)}`) }), "cost X+1 is refused");
  });
}

clause(DISPLACEMENT, "0:ability", "the picked card is put into hand BEFORE the free play: your own cost-1 card can be replayed straight away", () => {
  const { engine, id } = displacementBoard({ hand: [costed("H0", 0)] });
  displace(engine, id, "myItem");
  assert.equal(zoneOf(engine, id("myItem")), "hand", "already in hand when the prompt opens");
  assert.deepEqual(offeredNames(engine), ["H0", "MyItem"], "cost 1 <= X=1, so the bounced item itself is offered");
  const resources = ready(engine);
  freePlay(engine, id("myItem"));
  assert.equal(zoneOf(engine, id("myItem")), "play", "replayed for free");
  assert.equal(ready(engine), resources, "no resources spent on the free play");
});

clause(DISPLACEMENT, "0:ability", "a bounced card of yours that costs more than X is NOT offered back (a cost-2 card gives X=1)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "sd", def: printing(DISPLACEMENT), owner: P1, zone: "hand" },
      { key: "two", def: costed("Two", 2), owner: P1, zone: "play" },
      { key: "h1", def: costed("H1", 1), owner: P1, zone: "hand" },
      ...bank("obsession", 4, P1)
    ]
  });
  play(engine, P1, id("sd"), { selected: { bounced: [id("two")] } });
  assert.deepEqual(offeredNames(engine), ["H1"], "Two (cost 2) is in hand but costs more than X=1");
});

clause(DISPLACEMENT, "0:ability", "the opponent's bounced card goes to THEIR hand and is not something you can play", () => {
  const { engine, id } = displacementBoard({ foeCost: 0, hand: [costed("H0", 0)] });
  displace(engine, id, "foe");
  assert.equal(handOf(engine, P2).includes(id("foe")), true);
  assert.deepEqual(offeredNames(engine), ["H0"], "only cards in YOUR hand: not Foe (now in the opponent's hand) and not OppHand");
  assert.throws(tryChoice(engine, P1, { kind: "deployForFree", cardId: id("foe") }));
  assert.throws(tryChoice(engine, P1, { kind: "deployForFree", cardId: id("oppHand") }));
});

clause(DISPLACEMENT, "0:ability", "'may': declining plays nothing and spends nothing", () => {
  const { engine, id } = displacementBoard({ hand: [costed("H1", 1), costed("H2", 2)] });
  displace(engine, id, "foe");
  const resources = ready(engine);
  freePlay(engine, undefined);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("h:H1")), "hand");
  assert.equal(zoneOf(engine, id("h:H2")), "hand");
  assert.equal(ready(engine), resources);
  assert.equal(zoneOf(engine, id("foe")), "hand", "the bounce itself still happened");
});

clause(DISPLACEMENT, "0:ability", "the free play really is free, cost X exactly is allowed, and only ONE card is played", () => {
  const { engine, id } = displacementBoard({ foeCost: 4, hand: [costed("Cheap", 1), costed("Exact", 2), costed("TooDear", 3)] });
  displace(engine, id, "foe");
  assert.deepEqual(offeredNames(engine), ["Cheap", "Exact"]);
  assert.throws(tryChoice(engine, P1, { kind: "deployForFree", cardId: id("h:TooDear") }), "cost 3 > X=2");
  const resources = ready(engine);
  freePlay(engine, id("h:Exact"));
  assert.equal(zoneOf(engine, id("h:Exact")), "play");
  assert.equal(ready(engine), resources, "free: no resources spent");
  assert.equal(zoneOf(engine, id("h:Cheap")), "hand", "only one card is played");
  assert.equal(pending(engine), undefined);
});

clause(DISPLACEMENT, "0:ability", "only NON-RESOURCE cards can be played this way: a resource card in hand is never offered, whatever its cost", () => {
  const { engine, id } = displacementBoard({ hand: [costed("Cheap", 1), stapleCard()] });
  displace(engine, id, "foe");
  assert.deepEqual(offeredNames(engine), ["Cheap"]);
  assert.throws(tryChoice(engine, P1, { kind: "deployForFree", cardId: id("h:Staple") }));
});

clause(DISPLACEMENT, "0:ability", "you still need the proper resource icons: a card whose threshold you do not meet is refused, one you meet is played", () => {
  const { engine, id } = displacementBoard({
    hand: [costed("NeedsRage", 1, { threshold: "rr" as never }), costed("NeedsObsession", 1, { threshold: "o" as never })]
  });
  displace(engine, id, "foe");
  assert.ok(offeredNames(engine).includes("NeedsObsession"), "a card whose threshold you meet can be chosen");
  assert.throws(tryChoice(engine, P1, { kind: "deployForFree", cardId: id("h:NeedsRage") }), "no [R] icons: refused");
  assert.equal(zoneOf(engine, id("h:NeedsRage")), "hand");
  freePlay(engine, id("h:NeedsObsession"));
  assert.equal(zoneOf(engine, id("h:NeedsObsession")), "play");
});

clause(DISPLACEMENT, "0:ability", "only cards from YOUR HAND: cards in your deck or discard pile are not offered", () => {
  const { engine, id } = displacementBoard({ foeCost: 4, hand: [costed("InHand", 1)] });
  displace(engine, id, "foe");
  assert.deepEqual(offeredNames(engine), ["InHand"], "InDiscard and InDeck (cost 0) are not in hand");
  assert.throws(tryChoice(engine, P1, { kind: "deployForFree", cardId: id("inDiscard") }));
  assert.throws(tryChoice(engine, P1, { kind: "deployForFree", cardId: id("inDeck") }));
});

for (const [label, def, check] of [
  ["character", costed("Guy", 2), (e: SpoilsEngine, id: Ids) => assert.equal(zoneOf(e, id("h:Guy")), "play")],
  ["item", item({ name: "Widget", cost: 2 }), (e: SpoilsEngine, id: Ids) => assert.equal(zoneOf(e, id("h:Widget")), "play")],
  ["location", location({ name: "Hall", cost: 2, structure: 3 }), (e: SpoilsEngine, id: Ids) => assert.equal(zoneOf(e, id("h:Hall")), "play")],
  [
    "tactic",
    tactic({ name: "Cantrip", cost: 2, behavior: { abilities: [{ id: "c", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } }),
    (e: SpoilsEngine, id: Ids) => {
      assert.equal(zoneOf(e, id("h:Cantrip")), "discard", "a tactic resolves and goes to the discard pile");
      assert.equal(zoneOf(e, id("inDeck")), "hand", "...and its effect happened (it drew the top card)");
    }
  ]
] as const) {
  clause(DISPLACEMENT, "0:ability", `the free play can be a ${label}`, () => {
    const { engine, id } = displacementBoard({ foeCost: 4, hand: [def as Def], extra: [{ key: "d1", def: costed("D1", 0), owner: P1, zone: "deck" }] });
    displace(engine, id, "foe");
    assert.deepEqual(offeredNames(engine), [def.name]);
    freePlay(engine, id(`h:${def.name}`));
    drain(engine, declineAll);
    check(engine, id);
  });
}

clause(DISPLACEMENT, "0:ability", "with nothing playable in hand the bounce still happens and nothing is offered", () => {
  const { engine, id } = displacementBoard({ foeCost: 2, hand: [costed("Huge", 9)] });
  displace(engine, id, "foe");
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("foe")), "hand");
  assert.equal(zoneOf(engine, id("h:Huge")), "hand");
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("sd")), "discard");
});

clause(DISPLACEMENT, "0:ability", "only a non-resource card IN PLAY can be picked: a resource, a face-down card, a faction, or a card in hand, deck or discard pile is refused", () => {
  const { engine, id } = displacementBoard({ hand: [costed("InHand", 0)] });
  const resourceId = engine.state.players[P1].play.find((c) => engine.getDefinition(c).type === "resource")!;
  const attempt = (cardId: string) => () => playRaw(engine, P1, id("sd"), { selected: { bounced: [cardId] } });
  assert.throws(attempt(resourceId), "a face-up resource");
  assert.throws(attempt(id("faceDown")), "a face-down card is only a resource");
  assert.throws(attempt(factionIdOf(engine, P1)), "your faction (CR 202.9)");
  assert.throws(attempt(factionIdOf(engine, P2)), "the opponent's faction");
  assert.throws(attempt(id("h:InHand")), "a card in hand");
  assert.throws(attempt(id("inDiscard")), "a card in the discard pile");
  assert.throws(attempt(id("inDeck")), "a card in the deck");
  assert.throws(() => playRaw(engine, P1, id("sd"), { selected: {} }), "no pick");
  assert.throws(() => playRaw(engine, P1, id("sd"), { selected: { bounced: [id("foe"), id("mine")] } }), "only one card is picked");
  assert.equal(zoneOf(engine, id("sd")), "hand", "a refused play leaves the tactic in hand");
  assert.equal(zoneOf(engine, id("foe")), "play");
  attempt(id("foe"))();
  assert.ok(engine.state.responseWindow, "a legal pick is accepted");
});

clause(DISPLACEMENT, "0:ability", "a card leaving play sheds its damage and depletion", () => {
  const { engine, id } = displacementBoard({ foeCost: 0, hand: [costed("H0", 0)] });
  engine.state.cards[id("foe")].damage = 1;
  engine.state.cards[id("foe")].depleted = true;
  displace(engine, id, "foe");
  freePlay(engine, undefined);
  assert.equal(engine.state.cards[id("foe")].damage ?? 0, 0);
  assert.equal(engine.state.cards[id("foe")].depleted, false);
});

clause(DISPLACEMENT, "0:ability", "a card with tokens loses them when it is put into its owner's hand (CR 409.2)", () => {
  const { engine, id } = displacementBoard({ foeCost: 4 });
  engine.state.cards[id("foe")].counters = { token: 3 };
  displace(engine, id, "foe");
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("foe")), "hand");
  assert.equal(tokens(engine, id("foe")), 0, "tokens disappear when the card leaves play");
});

clause(DISPLACEMENT, "0:ability", "is refused one resource short of its cost of 4, and without [O][O][O] even with enough other resources", () => {
  const short = displacementBoard({ obsession: 3 });
  assert.throws(() => playRaw(short.engine, P1, short.id("sd"), { selected: { bounced: [short.id("foe")] } }));
  assert.equal(zoneOf(short.engine, short.id("foe")), "play");
  const noThreshold = displacementBoard({ obsession: 2, greed: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("sd"), { selected: { bounced: [noThreshold.id("foe")] } }));
  const exact = displacementBoard({ obsession: 3, greed: 1 });
  displace(exact.engine, exact.id, "foe");
  drain(exact.engine, declineAll);
  assert.equal(zoneOf(exact.engine, exact.id("foe")), "hand", "[O][O][O] plus a fourth resource is enough");
});

// =============================================================================
// Stolen Inspiration
// Look at your opponent's hand and pick a non-resource card. Your opponent must
// discard that card.
// You may play a non-resource card with cost X or less for free, where X is
// half the cost of the discarded card, rounded up. (You still need the proper
// resource icons.) Tactic, cost 3, threshold [O][O].
// =============================================================================

const INSPIRATION = "36a4611a-f7c9-4390-930c-46cd0f82569b";

function inspirationBoard(opts: { opp?: Def[]; hand?: Def[]; obsession?: number; greed?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "si", def: printing(INSPIRATION), owner: P1, zone: "hand" },
      ...handCards(P2, opts.opp ?? [costed("Victim", 4), costed("Bystander", 2)]),
      ...handCards(P1, opts.hand ?? []),
      { key: "oppDeck", def: costed("OppDeck", 4), owner: P2, zone: "deck" },
      { key: "oppDiscard", def: costed("OppDiscard", 4), owner: P2, zone: "discard" },
      { key: "oppPlay", def: costed("OppPlay", 4), owner: P2, zone: "play" },
      { key: "myPlay", def: costed("MyPlay", 4), owner: P1, zone: "play" },
      { key: "myDiscard", def: costed("MyDiscard", 0), owner: P1, zone: "discard" },
      ...bank("obsession", opts.obsession ?? 3, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

// E3b: "Look at your opponent's hand and pick" is part of the EFFECT: nothing is picked when the tactic is played; the caster
// picks `key` when it resolves.
const inspire = (engine: SpoilsEngine, id: Ids, key: string) => {
  play(engine, P1, id("si"), { selected: {} });
  resolveChoice(engine, P1, { kind: "chooserSelectsTarget", selected: [id(key)] });
};

clause(INSPIRATION, "0:rule", "pays 3; the picked non-resource card of the opponent's hand is discarded into THEIR discard pile, and no other card moves", () => {
  const { engine, id } = inspirationBoard();
  const before = ready(engine);
  const oppHand = [...handOf(engine, P2)];
  inspire(engine, id, "o:Victim");
  drain(engine, declineAll);
  assert.equal(before - ready(engine), 3, "the printed cost of 3 is paid");
  assert.equal(zoneOf(engine, id("o:Victim")), "discard");
  assert.equal(discardOf(engine, P2).includes(id("o:Victim")), true, "in the opponent's discard pile");
  assert.deepEqual([...handOf(engine, P2)].sort(), oppHand.filter((c) => c !== id("o:Victim")).sort(), "the rest of their hand is untouched");
  assert.equal(zoneOf(engine, id("si")), "discard", "the tactic ends in your discard pile");
});

for (const [label, def] of [
  ["character", costed("Guy", 4)],
  ["item", item({ name: "Widget", cost: 4 })],
  ["location", location({ name: "Hall", cost: 4, structure: 3 })],
  ["tactic", tactic({ name: "Zap", cost: 4 })]
] as const) {
  clause(INSPIRATION, "0:rule", `any non-resource card type can be picked: a ${label} in the opponent's hand`, () => {
    const { engine, id } = inspirationBoard({ opp: [def as Def, costed("Bystander", 2)] });
    inspire(engine, id, `o:${def.name}`);
    drain(engine, declineAll);
    assert.equal(zoneOf(engine, id(`o:${def.name}`)), "discard");
    assert.equal(zoneOf(engine, id("o:Bystander")), "hand");
  });
}

clause(INSPIRATION, "0:rule", "only a NON-RESOURCE card of the OPPONENT'S HAND can be picked: a resource card, your own hand, their deck, discard pile or play are refused", () => {
  const { engine, id } = inspirationBoard({ opp: [costed("Victim", 4), stapleCard()], hand: [costed("Mine", 1)] });
  // The pick is made when the tactic resolves (E3b): a bad answer is refused and leaves the pick open.
  play(engine, P1, id("si"), { selected: {} });
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
  const attempt = (cardId: string) => tryChoice(engine, P1, { kind: "chooserSelectsTarget", selected: [cardId] });
  assert.throws(attempt(id("o:Staple")), "a resource card in the opponent's hand");
  assert.throws(attempt(id("h:Mine")), "a card in your own hand");
  assert.throws(attempt(id("oppDeck")), "a card in their deck");
  assert.throws(attempt(id("oppDiscard")), "a card in their discard pile");
  assert.throws(attempt(id("oppPlay")), "a card they control in play");
  assert.throws(attempt(id("myPlay")), "your own card in play");
  assert.throws(attempt(factionIdOf(engine, P2)), "their faction");
  assert.throws(tryChoice(engine, P1, { kind: "chooserSelectsTarget", selected: [id("o:Victim"), id("o:Staple")] }), "only one card");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "every bad answer left the pick open");
  attempt(id("o:Victim"))();
  assert.equal(zoneOf(engine, id("o:Victim")), "discard", "control: a legal pick is accepted");
});

clause(INSPIRATION, "0:rule", "a resource card in the opponent's hand can never be the card that is discarded", () => {
  const { engine, id } = inspirationBoard({ opp: [stapleCard()] });
  play(engine, P1, id("si"), { selected: {} });
  assert.equal(pending(engine), undefined, "a resource card cannot be picked, so there is nothing to pick");
  assert.equal(zoneOf(engine, id("o:Staple")), "hand");
});

clause(INSPIRATION, "0:rule", "'Look at your opponent's hand and pick' is part of the effect, not a cost: nothing is picked when the tactic is played, the pick happens when it resolves", () => {
  const { engine, id } = inspirationBoard();
  playRaw(engine, P1, id("si"), { selected: {} });
  assert.ok(engine.state.responseWindow, "the tactic is played with no card picked yet; the opponent can respond");
  assert.equal(zoneOf(engine, id("o:Victim")), "hand", "nothing has been picked or discarded before the opponent responds");
  resolvePendingResponses(engine);
  const pc = pending(engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "when it resolves, the caster looks at the opponent's hand and picks");
  assert.equal(pc?.playerId, P1, "YOU pick");
  resolveChoice(engine, P1, { kind: "chooserSelectsTarget", selected: [id("o:Victim")] });
  assert.equal(zoneOf(engine, id("o:Victim")), "discard");
});

clause(INSPIRATION, "0:rule", "the tactic can be responded to by the opponent (an ordinary tactic: no 'cannot respond' text), and nothing is discarded until it resolves", () => {
  const { engine, id } = inspirationBoard();
  playRaw(engine, P1, id("si"), { selected: {} });
  assert.ok(engine.state.responseWindow, "a response window opens");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  assert.equal(zoneOf(engine, id("o:Victim")), "hand", "the card is not discarded until the tactic resolves");
});

for (const [cost, x] of [
  [0, 0],
  [1, 1],
  [2, 1],
  [3, 2],
  [4, 2],
  [5, 3],
  [6, 3],
  [7, 4],
  [9, 5]
] as const) {
  clause(INSPIRATION, "1:rule", `discarded card cost ${cost}: X = half rounded up = ${x}, so exactly the hand cards of cost ${x} or less are offered`, () => {
    const { engine, id } = inspirationBoard({ opp: [costed("Victim", cost)], hand: COST_LADDER() });
    inspire(engine, id, "o:Victim");
    const names = offeredNames(engine);
    assert.deepEqual(names, Array.from({ length: x + 1 }, (_, n) => `H${n}`).sort());
    assert.throws(tryChoice(engine, P1, { kind: "deployForFree", cardId: id(`h:H${Math.min(x + 1, 9)}`) }), "cost X+1 is refused");
  });
}

clause(INSPIRATION, "1:rule", "the free play is free, 'may' is optional, only one card is played, and the discard already happened", () => {
  const { engine, id } = inspirationBoard({ opp: [costed("Victim", 6)], hand: [costed("Cheap", 1), costed("Exact", 3), costed("TooDear", 4)] });
  inspire(engine, id, "o:Victim");
  assert.equal(zoneOf(engine, id("o:Victim")), "discard", "discarded first");
  assert.deepEqual(offeredNames(engine), ["Cheap", "Exact"]);
  const resources = ready(engine);
  freePlay(engine, id("h:Exact"));
  assert.equal(zoneOf(engine, id("h:Exact")), "play");
  assert.equal(ready(engine), resources, "free: no resources spent");
  assert.equal(zoneOf(engine, id("h:Cheap")), "hand", "only one card is played");

  const decline = inspirationBoard({ opp: [costed("Victim", 6)], hand: [costed("Cheap", 1)] });
  inspire(decline.engine, decline.id, "o:Victim");
  freePlay(decline.engine, undefined);
  assert.equal(zoneOf(decline.engine, decline.id("h:Cheap")), "hand", "declined: nothing is played");
  assert.equal(zoneOf(decline.engine, decline.id("o:Victim")), "discard", "the discard still happened");
});

clause(INSPIRATION, "1:rule", "only non-resource cards from YOUR hand: a resource card, your discard pile and the opponent's other hand cards are never offered", () => {
  const { engine, id } = inspirationBoard({ opp: [costed("Victim", 4), costed("TheirCheap", 0)], hand: [costed("Cheap", 1), stapleCard()] });
  inspire(engine, id, "o:Victim");
  assert.deepEqual(offeredNames(engine), ["Cheap"]);
  assert.throws(tryChoice(engine, P1, { kind: "deployForFree", cardId: id("h:Staple") }));
  assert.throws(tryChoice(engine, P1, { kind: "deployForFree", cardId: id("myDiscard") }));
  assert.throws(tryChoice(engine, P1, { kind: "deployForFree", cardId: id("o:TheirCheap") }));
});

clause(INSPIRATION, "1:rule", "you still need the proper resource icons: a card whose threshold you do not meet is refused, one you meet is played", () => {
  const { engine, id } = inspirationBoard({
    opp: [costed("Victim", 4)],
    hand: [costed("NeedsRage", 1, { threshold: "rr" as never }), costed("NeedsObsession", 1, { threshold: "o" as never })]
  });
  inspire(engine, id, "o:Victim");
  assert.ok(offeredNames(engine).includes("NeedsObsession"), "offeredNames(engine).includes(\"NeedsObsession\")");
  assert.throws(tryChoice(engine, P1, { kind: "deployForFree", cardId: id("h:NeedsRage") }), "no [R] icons: refused");
  freePlay(engine, id("h:NeedsObsession"));
  assert.equal(zoneOf(engine, id("h:NeedsObsession")), "play");
  assert.equal(zoneOf(engine, id("h:NeedsRage")), "hand");
});

for (const [label, def, check] of [
  ["character", costed("Guy", 2), (e: SpoilsEngine, id: Ids) => assert.equal(zoneOf(e, id("h:Guy")), "play")],
  ["item", item({ name: "Widget", cost: 2 }), (e: SpoilsEngine, id: Ids) => assert.equal(zoneOf(e, id("h:Widget")), "play")],
  ["location", location({ name: "Hall", cost: 2, structure: 3 }), (e: SpoilsEngine, id: Ids) => assert.equal(zoneOf(e, id("h:Hall")), "play")],
  [
    "tactic",
    tactic({ name: "Cantrip", cost: 2, behavior: { abilities: [{ id: "c", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } }),
    (e: SpoilsEngine, id: Ids) => {
      assert.equal(zoneOf(e, id("h:Cantrip")), "discard", "a tactic resolves and goes to the discard pile");
      assert.equal(zoneOf(e, id("d1")), "hand", "...and its effect happened (it drew a card)");
    }
  ]
] as const) {
  clause(INSPIRATION, "1:rule", `the free play can be a ${label}`, () => {
    const { engine, id } = inspirationBoard({ opp: [costed("Victim", 4)], hand: [def as Def], extra: [{ key: "d1", def: costed("D1", 0), owner: P1, zone: "deck" }] });
    inspire(engine, id, "o:Victim");
    assert.deepEqual(offeredNames(engine), [def.name]);
    freePlay(engine, id(`h:${def.name}`));
    drain(engine, declineAll);
    check(engine, id);
  });
}

clause(INSPIRATION, "1:rule", "with nothing affordable in hand the discard still happens and no card is played", () => {
  const { engine, id } = inspirationBoard({ opp: [costed("Victim", 2)], hand: [costed("Huge", 9)] });
  inspire(engine, id, "o:Victim");
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("o:Victim")), "discard");
  assert.equal(zoneOf(engine, id("h:Huge")), "hand");
  assert.equal(pending(engine), undefined);
});

clause(INSPIRATION, "1:rule", "is refused one resource short of its cost of 3, and without [O][O] even with enough other resources", () => {
  const short = inspirationBoard({ obsession: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("si"), { selected: {} }));
  assert.equal(zoneOf(short.engine, short.id("o:Victim")), "hand");
  const noThreshold = inspirationBoard({ obsession: 1, greed: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("si"), { selected: {} }));
  const exact = inspirationBoard({ obsession: 2, greed: 1 });
  inspire(exact.engine, exact.id, "o:Victim");
  drain(exact.engine, declineAll);
  assert.equal(zoneOf(exact.engine, exact.id("o:Victim")), "discard", "[O][O] plus a third resource is enough");
});

clause(INSPIRATION, "0:rule", "it can be played when the opponent has no non-resource card in hand: the pick is part of the effect, so it just does nothing (no discard, no free play)", () => {
  for (const opp of [[], [stapleCard()]]) {
    const { engine, id } = inspirationBoard({ opp, hand: [costed("Free", 0), costed("Cheap", 1)] });
    const before = ready(engine);
    playRaw(engine, P1, id("si"), { selected: {} });
    resolvePendingResponses(engine);
    assert.equal(pending(engine)?.kind === "deployForFree", false, "nothing was discarded, so there is no X to play a card for");
    assert.equal(before - ready(engine), 3, "the tactic was played and its cost paid");
    assert.equal(zoneOf(engine, id("si")), "discard");
    assert.equal(zoneOf(engine, id("h:Free")), "hand");
    // E3b: test corrected: the board already holds "oppDiscard" in their discard pile, so "nothing was discarded" means only that card is there.
    assert.deepEqual([...discardOf(engine, P2)], [id("oppDiscard")], "nothing joined their discard pile");
  }
});

// =============================================================================
// Very Big Hat of Invisibility
// ATTACH TO CHARACTER. The attached character gains COVERT.
// HANDOFF -- COST: Deplete a character you control that is not in a battle. --
// EFFECT: Attach this card to the character. Item (gear), cost 3, threshold [O].
// =============================================================================

const HAT = "9cb2e1d3-ed72-4fe6-92b2-29629b9bc8cd";

function hatBoard(opts: { hat?: "hand" | "play"; wearer?: string | null; hatOwner?: Player; hatController?: Player; obsession?: number; greed?: number; turn?: number; active?: Player; characters?: boolean; noFaceDown?: boolean; extra?: CardPlacement[] } = {}) {
  const hatZone = opts.hat ?? "play";
  const wearer = opts.wearer === undefined ? "a1" : opts.wearer;
  const chars = opts.characters !== false;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 1,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "hat", def: printing(HAT), owner: opts.hatOwner ?? P1, controller: opts.hatController, zone: hatZone, attachedToKey: hatZone === "play" && wearer && chars ? wearer : undefined },
      ...(chars
        ? [
            { key: "a1", def: character({ name: "A1", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" as const },
            { key: "a2", def: character({ name: "A2", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" as const },
            { key: "a3", def: character({ name: "A3", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" as const },
            { key: "b1", def: character({ name: "B1", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" as const },
            { key: "b2", def: character({ name: "B2", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" as const },
            { key: "b3", def: character({ name: "B3", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" as const },
            { key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play" as const, controller: P1 },
            { key: "lent", def: character({ name: "Lent" }), owner: P1, zone: "play" as const, controller: P2 }
          ]
        : []),
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "myLoc", def: location({ name: "MyLoc" }), owner: P1, zone: "play" },
      ...(opts.noFaceDown ? [] : [faceDownCard("faceDown", P1)]),
      { key: "handChar", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
      { key: "discChar", def: character({ name: "DiscChar" }), owner: P1, zone: "discard" },
      ...bank("obsession", opts.obsession ?? 3, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const hostOf = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId].attachedTo;
const hasCovert = (engine: SpoilsEngine, cardId: string) => engine.getKeywords(cardId).includes("covert");

// --- 0:attach

for (const [target, what] of [
  ["a1", "your own character"],
  ["b1", "the opponent's character"],
  ["stolen", "a character you control but do not own"]
] as const) {
  clause(HAT, "0:attach", `deploying it for 3 attaches it to the chosen character: ${what}`, () => {
    const { engine, id } = hatBoard({ hat: "hand" });
    const before = ready(engine);
    play(engine, P1, id("hat"), { selected: { attachTo: [id(target)] } });
    assert.equal(zoneOf(engine, id("hat")), "play", "the Hat enters play");
    assert.equal(hostOf(engine, id("hat")), id(target), "attached to the chosen character");
    assert.equal(before - ready(engine), 3, "the printed cost of 3 is paid");
    assert.equal(engine.state.cards[id("hat")].controllerId, P1, "you keep control of the Hat");
    for (const other of ["a1", "a2", "b1", "b2"]) {
      if (other !== target) assert.notEqual(hostOf(engine, id("hat")), id(other));
    }
  });
}

clause(HAT, "0:attach", "it attaches to a CHARACTER only: an item, a location, a faction, a resource, a face-down card, or a character outside play is refused", () => {
  const { engine, id } = hatBoard({ hat: "hand" });
  const resourceId = engine.state.players[P1].play.find((c) => engine.getDefinition(c).type === "resource")!;
  const attempt = (cardId: string) => () => playRaw(engine, P1, id("hat"), { selected: { attachTo: [cardId] } });
  assert.throws(attempt(id("myItem")), "an item");
  assert.throws(attempt(id("myLoc")), "a location");
  assert.throws(attempt(factionIdOf(engine, P1)), "your faction");
  assert.throws(attempt(factionIdOf(engine, P2)), "the opponent's faction");
  assert.throws(attempt(resourceId), "a resource");
  assert.throws(attempt(id("faceDown")), "a face-down card is only a resource");
  assert.throws(attempt(id("handChar")), "a character in hand");
  assert.throws(attempt(id("discChar")), "a character in the discard pile");
  assert.throws(() => playRaw(engine, P1, id("hat"), { selected: {} }), "no host chosen");
  assert.throws(() => playRaw(engine, P1, id("hat"), { selected: { attachTo: [id("a1"), id("a2")] } }), "only one host");
  assert.equal(zoneOf(engine, id("hat")), "hand", "a refused play leaves the Hat in hand");
  attempt(id("a1"))();
  assert.ok(engine.state.responseWindow, "a character is accepted");
});

clause(HAT, "0:attach", "with no character in play there is nothing to attach to, so it cannot be deployed", () => {
  const { engine, id } = hatBoard({ hat: "hand", characters: false });
  assert.throws(() => playRaw(engine, P1, id("hat"), { selected: {} }));
  assert.throws(() => playRaw(engine, P1, id("hat"), { selected: { attachTo: [id("myItem")] } }));
  assert.equal(zoneOf(engine, id("hat")), "hand");
});

clause(HAT, "0:attach", "is refused one resource short of its cost of 3, and without [O] even with enough other resources", () => {
  const short = hatBoard({ hat: "hand", obsession: 2, noFaceDown: true });
  assert.throws(() => playRaw(short.engine, P1, short.id("hat"), { selected: { attachTo: [short.id("a1")] } }));
  const noThreshold = hatBoard({ hat: "hand", obsession: 0, greed: 5, noFaceDown: true });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("hat"), { selected: { attachTo: [noThreshold.id("a1")] } }));
  const exact = hatBoard({ hat: "hand", obsession: 1, greed: 2, noFaceDown: true });
  play(exact.engine, P1, exact.id("hat"), { selected: { attachTo: [exact.id("a1")] } });
  assert.equal(hostOf(exact.engine, exact.id("hat")), exact.id("a1"), "[O] plus a third resource is enough");
});

clause(HAT, "0:attach", "when its character is destroyed the Hat leaves play the same way (into its owner's discard pile)", () => {
  const { engine, id } = hatBoard({ extra: [{ key: "killer", def: KILLER(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("killer"), { selected: { t: [id("a1")] } });
  assert.equal(zoneOf(engine, id("a1")), "discard");
  assert.equal(zoneOf(engine, id("hat")), "discard", "CR 301.4: the attached card leaves play with its host");
});

clause(HAT, "0:attach", "when its character is put into its owner's hand the Hat goes to its owner's hand too (CR 301.4a: it leaves play the same way)", () => {
  const { engine, id } = hatBoard({ extra: [{ key: "bouncer", def: BOUNCER(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("bouncer"), { selected: { t: [id("a1")] } });
  assert.equal(zoneOf(engine, id("a1")), "hand");
  assert.equal(zoneOf(engine, id("hat")), "hand", "CR 301.4a: 'put into owner's hand' is a way of leaving play, and the attached card leaves play the same way");
  assert.equal(handOf(engine, P1).includes(id("hat")), true);
  assert.equal(hostOf(engine, id("hat")), undefined);
});

clause(HAT, "0:attach", "when its character is removed from the game the Hat is removed from the game too (CR 301.4a)", () => {
  const { engine, id } = hatBoard({ extra: [{ key: "remover", def: REMOVER(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("remover"), { selected: { t: [id("a1")] } });
  assert.equal(zoneOf(engine, id("a1")), "removed");
  assert.equal(zoneOf(engine, id("hat")), "removed", "it leaves play the same way its host did");
});

clause(HAT, "0:attach", "when its character is put into its owner's deck the Hat goes to its owner's deck too (CR 301.4a)", () => {
  const decker = tactic({
    name: "Decker",
    cost: 0,
    behavior: { abilities: [{ id: "d", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "deck" }] }] }
  });
  const { engine, id } = hatBoard({ extra: [{ key: "decker", def: decker, owner: P1, zone: "hand" }] });
  play(engine, P1, id("decker"), { selected: { t: [id("a1")] } });
  assert.equal(zoneOf(engine, id("a1")), "deck");
  assert.equal(zoneOf(engine, id("hat")), "deck", "CR 301.4a: 'shuffled into owner's deck' is a way of leaving play, and the attached card leaves play the same way");
});

clause(HAT, "0:attach", "if its chosen character is gone by the time the Hat would enter play, the Hat goes to its owner's discard pile instead (CR 507.2c)", () => {
  const { engine, id } = hatBoard({ hat: "hand", extra: [{ key: "theirKiller", def: KILLER(), owner: P2, zone: "hand" }] });
  playRaw(engine, P1, id("hat"), { selected: { attachTo: [id("b1")] } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  playRaw(engine, P2, id("theirKiller"), { selected: { t: [id("b1")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("b1")), "discard", "the opponent destroyed the chosen character in response");
  assert.equal(zoneOf(engine, id("hat")), "discard", "the Hat found no target and went to its owner's discard pile");
  assert.equal(discardOf(engine, P1).includes(id("hat")), true);
  assert.equal(hostOf(engine, id("hat")), undefined);
});

clause(HAT, "0:attach", "the Hat stays attached to its character from turn to turn (it is not detached by the restore rule)", () => {
  const { engine, id } = hatBoard();
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(hostOf(engine, id("hat")), id("a1"));
  assert.equal(zoneOf(engine, id("hat")), "play");
});

// --- 1:rule

clause(HAT, "1:rule", "the attached character gains COVERT; no other character does", () => {
  const { engine, id } = hatBoard();
  assert.equal(hasCovert(engine, id("a1")), true, "the wearer");
  for (const other of ["a2", "a3", "b1", "b2", "stolen", "lent"]) assert.equal(hasCovert(engine, id(other)), false, `${other} is not covert`);
  assert.equal(engine.getKeywords(id("a1")).filter((k) => k === "covert").length, 1, "a card cannot hold two instances of covert");
});

clause(HAT, "1:rule", "no COVERT without the Hat: a control board with the Hat in hand grants nothing", () => {
  const { engine, id } = hatBoard({ hat: "hand" });
  for (const key of ["a1", "a2", "b1"]) assert.equal(hasCovert(engine, id(key)), false, key);
});

clause(HAT, "1:rule", "the opponent's character wearing your Hat is the covert one, not yours", () => {
  const { engine, id } = hatBoard({ wearer: "b1" });
  assert.equal(hasCovert(engine, id("b1")), true);
  assert.equal(hasCovert(engine, id("a1")), false);
});

clause(HAT, "1:rule", "the COVERT is real: a wearer attacking alone cannot be blocked by a non-covert character, but a party with a non-wearer can be", () => {
  const alone = hatBoard({ turn: 2 });
  declareAttackBy(alone.engine, P1, [alone.id("a1")]);
  assert.throws(() => alone.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [alone.id("b1")] }), "a non-covert character cannot block a covert party");
  const party = hatBoard({ turn: 2 });
  declareAttackBy(party.engine, P1, [party.id("a1"), party.id("a2")]);
  party.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [party.id("b1")] });
  assert.deepEqual(party.engine.state.battle?.blockingParty, [party.id("b1")], "with a non-covert member the party is not covert");
  const without = hatBoard({ turn: 2, hat: "hand" });
  declareAttackBy(without.engine, P1, [without.id("a1")]);
  without.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [without.id("b1")] });
  assert.deepEqual(without.engine.state.battle?.blockingParty, [without.id("b1")], "control: without the Hat anyone can block");
});

clause(HAT, "1:rule", "a covert wearer can block only covert parties (the keyword is genuinely granted)", () => {
  const { engine, id } = hatBoard({ turn: 2, active: P2, wearer: "a1" });
  declareAttackBy(engine, P2, [id("b1")]);
  assert.throws(() => engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("a1")] }), "a covert character may block only a covert party");
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("a2")] });
  assert.deepEqual(engine.state.battle?.blockingParty, [id("a2")], "a plain character can block the plain attacker");
});

clause(HAT, "1:rule", "COVERT ends when the Hat leaves play", () => {
  const itemKiller = tactic({
    name: "ItemKiller",
    cost: 0,
    behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = hatBoard({ extra: [{ key: "ik", def: itemKiller, owner: P1, zone: "hand" }] });
  assert.equal(hasCovert(engine, id("a1")), true);
  play(engine, P1, id("ik"), { selected: { t: [id("hat")] } });
  assert.equal(zoneOf(engine, id("hat")), "discard");
  assert.equal(hasCovert(engine, id("a1")), false, "the former wearer is no longer covert");
});

clause(HAT, "1:rule", "a wearer that is already covert holds COVERT only once", () => {
  const covertWearer = buildGame({
    cards: [
      { key: "w", def: character({ name: "W", behavior: { keywords: ["covert"] } }), owner: P1, zone: "play" },
      { key: "hat", def: printing(HAT), owner: P1, zone: "play", attachedToKey: "w" }
    ]
  });
  assert.equal(covertWearer.engine.getKeywords(covertWearer.id("w")).filter((k) => k === "covert").length, 1);
});

// --- 2:ability:hat-handoff

function handoffBoard(opts: Parameters<typeof hatBoard>[0] = {}) {
  return hatBoard(opts);
}

const handoff = (engine: SpoilsEngine, id: Ids, key: string, player: Player = P1) => activate(engine, player, id("hat"), "hat-handoff", { selected: { newWearer: [id(key)] } });

clause(HAT, "2:ability:hat-handoff", "deplete a character you control: the Hat moves to it; the old wearer loses COVERT and the new one has it; the Hat itself stays ready and in play, at no resource cost", () => {
  const { engine, id } = handoffBoard();
  const before = ready(engine);
  handoff(engine, id, "a2");
  assert.equal(engine.state.cards[id("a2")].depleted, true, "COST: the picked character is depleted");
  assert.equal(engine.state.cards[id("a1")].depleted, false, "the old wearer is not depleted");
  assert.equal(engine.state.cards[id("a3")].depleted, false, "other characters are not depleted");
  assert.equal(hostOf(engine, id("hat")), id("a2"), "EFFECT: attached to the picked character");
  assert.equal(hasCovert(engine, id("a2")), true);
  assert.equal(hasCovert(engine, id("a1")), false);
  assert.equal(zoneOf(engine, id("hat")), "play");
  assert.equal(engine.state.cards[id("hat")].depleted, false, "the Hat is not depleted");
  assert.equal(engine.state.cards[id("hat")].controllerId, P1);
  assert.equal(ready(engine), before, "no resources are paid");
});

clause(HAT, "2:ability:hat-handoff", "the picked character may be the one already wearing the Hat: it is depleted and the Hat stays on it", () => {
  const { engine, id } = handoffBoard();
  handoff(engine, id, "a1");
  assert.equal(engine.state.cards[id("a1")].depleted, true);
  assert.equal(hostOf(engine, id("hat")), id("a1"));
  assert.equal(hasCovert(engine, id("a1")), true);
});

clause(HAT, "2:ability:hat-handoff", "it can pull the Hat off an OPPONENT's character onto one of yours", () => {
  const { engine, id } = handoffBoard({ wearer: "b1" });
  assert.equal(hasCovert(engine, id("b1")), true);
  handoff(engine, id, "a2");
  assert.equal(hostOf(engine, id("hat")), id("a2"));
  assert.equal(hasCovert(engine, id("b1")), false);
  assert.equal(hasCovert(engine, id("a2")), true);
});

clause(HAT, "2:ability:hat-handoff", "a character you control but do not own can receive the Hat", () => {
  const { engine, id } = handoffBoard();
  handoff(engine, id, "stolen");
  assert.equal(hostOf(engine, id("hat")), id("stolen"));
  assert.equal(engine.state.cards[id("stolen")].depleted, true);
});

clause(HAT, "2:ability:hat-handoff", "only a character YOU control can be picked: the opponent's character, a character you own but the opponent controls, an item, a location, a faction, a resource, a face-down card, or a card outside play are refused", () => {
  const { engine, id } = handoffBoard();
  const resourceId = engine.state.players[P1].play.find((c) => engine.getDefinition(c).type === "resource")!;
  const attempt = (cardId: string) => () => activateRaw(engine, P1, id("hat"), "hat-handoff", { selected: { newWearer: [cardId] } });
  assert.throws(attempt(id("b2")), "the opponent's character");
  assert.throws(attempt(id("lent")), "a character the opponent controls (even though you own it)");
  assert.throws(attempt(id("myItem")), "an item");
  assert.throws(attempt(id("myLoc")), "a location");
  assert.throws(attempt(factionIdOf(engine, P1)), "your faction");
  assert.throws(attempt(resourceId), "a resource");
  assert.throws(attempt(id("faceDown")), "a face-down card");
  assert.throws(attempt(id("handChar")), "a character in hand");
  assert.throws(attempt(id("discChar")), "a character in the discard pile");
  assert.throws(() => activateRaw(engine, P1, id("hat"), "hat-handoff", { selected: {} }), "no pick");
  assert.throws(() => activateRaw(engine, P1, id("hat"), "hat-handoff", { selected: { newWearer: [id("a2"), id("a3")] } }), "only one character");
  assert.equal(hostOf(engine, id("hat")), id("a1"), "refused activations move nothing");
  for (const key of ["a1", "a2", "a3", "stolen"]) assert.equal(engine.state.cards[id(key)].depleted, false, `${key} was not depleted`);
});

clause(HAT, "2:ability:hat-handoff", "the picked character must be able to be depleted: an already-depleted character is refused, a ready one is fine", () => {
  const { engine, id } = handoffBoard();
  engine.state.cards[id("a2")].depleted = true;
  assert.throws(() => activateRaw(engine, P1, id("hat"), "hat-handoff", { selected: { newWearer: [id("a2")] } }));
  assert.equal(hostOf(engine, id("hat")), id("a1"));
  handoff(engine, id, "a3");
  assert.equal(hostOf(engine, id("hat")), id("a3"));
});

clause(HAT, "2:ability:hat-handoff", "with no ready character of yours it cannot be used", () => {
  const { engine, id } = handoffBoard();
  for (const key of ["a1", "a2", "a3", "stolen"]) engine.state.cards[id(key)].depleted = true;
  for (const key of ["a1", "a2", "a3", "stolen"]) assert.throws(() => activateRaw(engine, P1, id("hat"), "hat-handoff", { selected: { newWearer: [id(key)] } }), key);
  assert.equal(hostOf(engine, id("hat")), id("a1"));
});

clause(HAT, "2:ability:hat-handoff", "can be used again with a different ready character (a1 -> a2 -> a3), each time depleting the new wearer", () => {
  const { engine, id } = handoffBoard();
  handoff(engine, id, "a2");
  handoff(engine, id, "a3");
  assert.equal(hostOf(engine, id("hat")), id("a3"));
  assert.equal(engine.state.cards[id("a2")].depleted, true);
  assert.equal(engine.state.cards[id("a3")].depleted, true);
  assert.equal(hasCovert(engine, id("a3")), true);
  assert.equal(hasCovert(engine, id("a2")), false);
});

clause(HAT, "2:ability:hat-handoff", "a character that is in a battle cannot be the one picked (a ready blocker), but one that is not in the battle can", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "hat", def: printing(HAT), owner: P1, zone: "play", attachedToKey: "a1" },
      { key: "a1", def: character({ name: "A1", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "a2", def: character({ name: "A2", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "a3", def: character({ name: "A3", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "b1", def: character({ name: "B1", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("b1")], target: { type: "faction", playerId: P1 } });
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("a2")] });
  assert.deepEqual(engine.state.battle?.blockingParty, [id("a2")]);
  assert.equal(engine.state.cards[id("a2")].depleted, false, "blocking does not deplete");
  // the attacker passes, then it is the blocker's turn to respond
  while (engine.state.responseWindow && engine.state.responseWindow.priorityPlayerId !== P1) {
    engine.perform({ type: "passPriority", playerId: engine.state.responseWindow.priorityPlayerId });
  }
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "P1 may now respond");
  assert.throws(() => activateRaw(engine, P1, id("hat"), "hat-handoff", { selected: { newWearer: [id("a2")] } }), "a2 is blocking: in a battle");
  assert.equal(hostOf(engine, id("hat")), id("a1"));
  activateRaw(engine, P1, id("hat"), "hat-handoff", { selected: { newWearer: [id("a3")] } });
  resolvePendingResponses(engine);
  assert.equal(hostOf(engine, id("hat")), id("a3"), "a3 is not in the battle");
  assert.equal(engine.state.cards[id("a3")].depleted, true);
});

clause(HAT, "2:ability:hat-handoff", "only the Hat's controller can use it, and not from your hand", () => {
  const { engine, id } = handoffBoard();
  assert.throws(() => activateRaw(engine, P2, id("hat"), "hat-handoff", { selected: { newWearer: [id("b2")] } }), "the opponent cannot");
  assert.equal(hostOf(engine, id("hat")), id("a1"));
  const inHand = handoffBoard({ hat: "hand" });
  assert.throws(() => activateRaw(inHand.engine, P1, inHand.id("hat"), "hat-handoff", { selected: { newWearer: [inHand.id("a2")] } }), "not from hand");
});

clause(HAT, "2:ability:hat-handoff", "the controller of the Hat chooses among THEIR characters: a Hat the opponent controls moves among the opponent's characters", () => {
  const { engine, id } = handoffBoard({ hatOwner: P1, hatController: P2, wearer: "a1", turn: 2, active: P2 });
  handoff(engine, id, "b2", P2);
  assert.equal(hostOf(engine, id("hat")), id("b2"));
  assert.equal(engine.state.cards[id("b2")].depleted, true);
  assert.equal(engine.state.cards[id("hat")].controllerId, P2);
});

// --- shared checks for the two Voidal locations -------------------------------
// Both print: "At the start of your turn, you may put a token on this card." and
// ENERGIZE -- COST: Pay 2. -- EFFECT: Put a token on this card.

const CHAMBER = "d8b3e45e-33a3-4604-ab15-f4fa79418127";
const OBSERVATORY = "2504b869-73ac-4c01-886d-cfda98b15335";

function voidalBoard(printingId: string, opts: { zone?: "play" | "hand"; controller?: Player; tokens?: number; resources?: number; deck?: number; extra?: CardPlacement[] } = {}) {
  const controller = opts.controller ?? P1;
  const inPlay = (opts.zone ?? "play") === "play";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: controller === P1 ? 1 : 2,
    activePlayerId: controller,
    cards: [
      { key: "loc", def: printing(printingId), owner: P1, controller: opts.controller, zone: opts.zone ?? "play", counters: inPlay && opts.tokens ? { token: opts.tokens } : undefined },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play", counters: { token: 2 } },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...Array.from({ length: opts.deck ?? 4 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
      ...Array.from({ length: 3 }, (_, i) => ({ key: `e${i}`, def: character({ name: `E${i}` }), owner: P2, zone: "deck" as const })),
      ...bank("rage", opts.resources ?? 6, controller),
      ...(opts.extra ?? [])
    ]
  });
}

/** The labelled indexes of the start-of-turn "may" prompt for `player`. */
function upkeepOffer(engine: SpoilsEngine, player: Player) {
  const pc = pending(engine);
  assert.equal(pc?.kind, "chooserSelectsOption", "a 'may put a token' choice is offered");
  assert.equal(pc!.playerId, player, "to the card's controller");
  const labels = (pc!.options as Array<{ label?: string }>).map((o) => o.label ?? "");
  const accept = labels.findIndex((l) => /token/i.test(l));
  const decline = labels.findIndex((l) => !/token/i.test(l));
  assert.ok(accept >= 0, "one option puts a token on the card");
  assert.ok(decline >= 0, "one option declines ('may')");
  return { accept, decline };
}

const takeUpkeep = (engine: SpoilsEngine, player: Player, accept: boolean) => {
  const { accept: yes, decline: no } = upkeepOffer(engine, player);
  resolveChoice(engine, player, { kind: "chooserSelectsOption", index: accept ? yes : no });
};

function locUpkeepAccept(printingId: string) {
  const { engine, id } = voidalBoard(printingId);
  endTurn(engine, P1);
  assert.equal(pending(engine), undefined, "nothing at the start of the OPPONENT's turn");
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  takeUpkeep(engine, P1, true);
  assert.equal(tokens(engine, id("loc")), 1, "exactly one token on the location");
  assert.equal(tokens(engine, id("myItem")), 2, "nothing else gets a token");
  assert.equal(tokens(engine, id("ally")), 0);
  assert.equal(pending(engine), undefined);
}

function locUpkeepDecline(printingId: string) {
  const { engine, id } = voidalBoard(printingId, { tokens: 1 });
  endTurn(engine, P1);
  endTurn(engine, P2);
  takeUpkeep(engine, P1, false);
  assert.equal(tokens(engine, id("loc")), 1, "'may': declining adds nothing");
  assert.equal(pending(engine), undefined);
}

function locUpkeepOnlyYourTurn(printingId: string) {
  const { engine, id } = voidalBoard(printingId);
  endTurn(engine, P1); // P2's turn starts
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(pending(engine), undefined, "no prompt at the start of the opponent's turn");
  assert.equal(tokens(engine, id("loc")), 0);
  endTurn(engine, P2);
  assert.equal(pending(engine)?.playerId, P1, "the prompt comes on YOUR turn");
}

function locUpkeepControllersTurn(printingId: string) {
  const { engine, id } = voidalBoard(printingId, { controller: P2 });
  endTurn(engine, P2); // P1's turn begins: P2 controls the location
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(pending(engine), undefined, "its owner gets nothing at the start of their own turn");
  endTurn(engine, P1); // P2's turn begins
  takeUpkeep(engine, P2, true);
  assert.equal(tokens(engine, id("loc")), 1, "its controller may add the token on their turn");
}

function locUpkeepNeedsPlay(printingId: string) {
  const { engine, id } = voidalBoard(printingId, { zone: "hand" });
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(pending(engine), undefined, "a location in hand does nothing at the start of your turn");
  assert.equal(tokens(engine, id("loc")), 0);
}

function locUpkeepAccumulates(printingId: string) {
  const { engine, id } = voidalBoard(printingId);
  for (const expected of [1, 2, 3]) {
    endTurn(engine, P1);
    endTurn(engine, P2);
    takeUpkeep(engine, P1, true);
    assert.equal(tokens(engine, id("loc")), expected, `one token per turn: ${expected}`);
  }
}

function locEnergize(printingId: string, abilityId: string) {
  const { engine, id } = voidalBoard(printingId, { resources: 7 });
  for (const expected of [1, 2, 3]) {
    const before = ready(engine);
    activate(engine, P1, id("loc"), abilityId);
    assert.equal(before - ready(engine), 2, "ENERGIZE costs exactly 2 resources");
    assert.equal(tokens(engine, id("loc")), expected, "one token per use");
  }
  assert.equal(tokens(engine, id("myItem")), 2, "no other card gets a token");
  assert.equal(zoneOf(engine, id("loc")), "play");
}

function locEnergizeRefused(printingId: string, abilityId: string) {
  const short = voidalBoard(printingId, { resources: 1 });
  assert.throws(() => activateRaw(short.engine, P1, short.id("loc"), abilityId), "one resource is short of 2");
  assert.equal(tokens(short.engine, short.id("loc")), 0);
  assert.equal(ready(short.engine), 1, "nothing was paid");
  const none = voidalBoard(printingId, { resources: 0 });
  assert.throws(() => activateRaw(none.engine, P1, none.id("loc"), abilityId), "no resources");
  const exact = voidalBoard(printingId, { resources: 2 });
  activate(exact.engine, P1, exact.id("loc"), abilityId);
  assert.equal(tokens(exact.engine, exact.id("loc")), 1, "exactly 2 resources is enough");
  assert.equal(ready(exact.engine), 0);
}

function locEnergizeAnyResources(printingId: string, abilityId: string) {
  // "Pay 2" has no icon requirement: any two resources, including Volition (face-down cards)
  const { engine, id } = voidalBoard(printingId, { resources: 0, extra: [...bank("greed", 1, P1), faceDownCard("fd", P1)] });
  activate(engine, P1, id("loc"), abilityId);
  assert.equal(tokens(engine, id("loc")), 1);
  assert.equal(ready(engine), 0);
}

function locEnergizeOwnTokens(printingId: string, abilityId: string) {
  const { engine, id } = voidalBoard(printingId, { tokens: 4 });
  activate(engine, P1, id("loc"), abilityId);
  assert.equal(tokens(engine, id("loc")), 5, "adds to the tokens already there");
}

function locEnergizeRestrictions(printingId: string, abilityId: string) {
  const { engine, id } = voidalBoard(printingId);
  assert.throws(() => activateRaw(engine, P2, id("loc"), abilityId), "the opponent cannot use it");
  assert.equal(tokens(engine, id("loc")), 0);
  const inHand = voidalBoard(printingId, { zone: "hand" });
  assert.throws(() => activateRaw(inHand.engine, P1, inHand.id("loc"), abilityId), "not from hand");
  assert.equal(ready(inHand.engine), 6);
}

function locDeploy(printingId: string, cost: number, threshold: string, structure: number) {
  const icon = (n: number) => [...bank("obsession", n, P1)];
  const build = (obsession: number, greed: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "loc", def: printing(printingId), owner: P1, zone: "hand" }, ...icon(obsession), ...bank("greed", greed, P1)]
    });
  const needed = threshold.length;
  const shortOnCost = build(cost - 1, 0);
  assert.throws(() => playRaw(shortOnCost.engine, P1, shortOnCost.id("loc")), "one resource short of the cost");
  const shortOnIcons = build(needed - 1, cost + 3);
  assert.throws(() => playRaw(shortOnIcons.engine, P1, shortOnIcons.id("loc")), "plenty of resources but one icon short of the threshold");
  const exact = build(needed, cost - needed);
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("loc"));
  assert.equal(zoneOf(exact.engine, exact.id("loc")), "play");
  assert.equal(before - ready(exact.engine), cost, `the printed cost of ${cost} is paid`);
  assert.equal(exact.engine.getStat(exact.id("loc"), "structure"), structure, `structure ${structure}`);
  assert.equal(tokens(exact.engine, exact.id("loc")), 0, "enters play with no tokens");
}

function locStructure(printingId: string, structure: number) {
  const hit = tactic({
    name: "Hit",
    cost: 0,
    behavior: { abilities: [{ id: "h", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }] }] }
  });
  const nearly = buildGame({
    cards: [
      { key: "loc", def: printing(printingId), owner: P1, zone: "play", damage: structure - 2 },
      { key: "hit", def: hit, owner: P1, zone: "hand" }
    ]
  });
  play(nearly.engine, P1, nearly.id("hit"), { selected: { t: [nearly.id("loc")] } });
  assert.equal(zoneOf(nearly.engine, nearly.id("loc")), "play", `${structure - 1} damage does not destroy structure ${structure}`);
  const lethal = buildGame({
    cards: [
      { key: "loc", def: printing(printingId), owner: P1, zone: "play", damage: structure - 1 },
      { key: "hit", def: hit, owner: P1, zone: "hand" }
    ]
  });
  play(lethal.engine, P1, lethal.id("hit"), { selected: { t: [lethal.id("loc")] } });
  assert.equal(zoneOf(lethal.engine, lethal.id("loc")), "discard", `${structure} damage destroys it`);
}

// =============================================================================
// Voidal Nullification Chamber
// At the start of your turn, you may put a token on this card.
// ENERGIZE -- COST: Pay 2. -- EFFECT: Put a token on this card.
// DISSOLVE -- COST: Use this only if an even number of characters are in play.
// Remove 4 tokens from this card, pick a character. -- EFFECT: Destroy the
// character. Location, cost 4, threshold [O][O][O], structure 2.
// =============================================================================

clause(CHAMBER, "0:rule", "at the start of your turn you may put a token on it: accepting adds exactly one token (and nothing else gets one)", () => locUpkeepAccept(CHAMBER));
clause(CHAMBER, "0:rule", "'may': declining adds no token", () => locUpkeepDecline(CHAMBER));
clause(CHAMBER, "0:rule", "only at the start of YOUR turn, not the opponent's", () => locUpkeepOnlyYourTurn(CHAMBER));
clause(CHAMBER, "0:rule", "'your turn' is its controller's turn: a Chamber controlled by the opponent prompts them, not its owner", () => locUpkeepControllersTurn(CHAMBER));
clause(CHAMBER, "0:rule", "does nothing while it is not in play (in hand)", () => locUpkeepNeedsPlay(CHAMBER));
clause(CHAMBER, "0:rule", "one token per turn, on every turn: accepting three turns in a row gives 1, 2, 3 tokens", () => locUpkeepAccumulates(CHAMBER));
clause(CHAMBER, "0:rule", "deploys for 4 with [O][O][O] (refused one short, or one icon short) and has structure 2", () => locDeploy(CHAMBER, 4, "ooo", 2));
clause(CHAMBER, "0:rule", "structure 2: one damage leaves it standing, two destroys it", () => locStructure(CHAMBER, 2));

clause(CHAMBER, "1:ability:energize", "ENERGIZE pays exactly 2 resources for exactly one token on the Chamber, every time it is used", () => locEnergize(CHAMBER, "energize"));
clause(CHAMBER, "1:ability:energize", "is refused with fewer than 2 resources (paying nothing) and allowed with exactly 2", () => locEnergizeRefused(CHAMBER, "energize"));
clause(CHAMBER, "1:ability:energize", "'Pay 2' has no icon requirement: any resources (staples of any kind, face-down Volition) will do", () => locEnergizeAnyResources(CHAMBER, "energize"));
clause(CHAMBER, "1:ability:energize", "adds to the tokens already on the Chamber", () => locEnergizeOwnTokens(CHAMBER, "energize"));
clause(CHAMBER, "1:ability:energize", "only its controller can use it, and not from your hand", () => locEnergizeRestrictions(CHAMBER, "energize"));

type DissolveOpts = { mine?: number; foes?: number; tokens?: number; faceDowns?: number; zone?: "play" | "hand"; extra?: CardPlacement[] };

function dissolveBoard(opts: DissolveOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "loc", def: printing(CHAMBER), owner: P1, zone: opts.zone ?? "play", counters: (opts.zone ?? "play") === "play" ? { token: opts.tokens ?? 4 } : undefined },
      ...Array.from({ length: opts.mine ?? 1 }, (_, i) => ({ key: `m${i + 1}`, def: character({ name: `M${i + 1}`, life: 5 }), owner: P1, zone: "play" as const })),
      ...Array.from({ length: opts.foes ?? 1 }, (_, i) => ({ key: `f${i + 1}`, def: character({ name: `F${i + 1}`, life: 5 }), owner: P2, zone: "play" as const })),
      ...Array.from({ length: opts.faceDowns ?? 0 }, (_, i) => faceDownCard(`fd${i + 1}`, P2)),
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "foeItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      { key: "otherLoc", def: location({ name: "OtherLoc" }), owner: P1, zone: "play" },
      { key: "handChar", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
      { key: "discChar", def: character({ name: "DiscChar" }), owner: P1, zone: "discard" },
      ...bank("rage", 3, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const dissolve = (engine: SpoilsEngine, id: Ids, key: string, player: Player = P1) => activate(engine, player, id("loc"), "dissolve", { selected: { c: [id(key)] } });
const dissolveRaw = (engine: SpoilsEngine, id: Ids, key: string, player: Player = P1) => () => activateRaw(engine, player, id("loc"), "dissolve", { selected: { c: [id(key)] } });

for (const [mine, foes] of [
  [1, 1],
  [2, 0],
  [0, 2],
  [2, 2],
  [3, 1],
  [3, 3],
  [4, 2]
] as const) {
  clause(CHAMBER, "2:ability:dissolve", `${mine + foes} characters in play (even: ${mine} yours + ${foes} theirs): allowed, 4 tokens are removed and the picked character is destroyed`, () => {
    const { engine, id } = dissolveBoard({ mine, foes, tokens: 4 });
    const target = foes > 0 ? "f1" : "m1";
    dissolve(engine, id, target);
    assert.equal(tokens(engine, id("loc")), 0, "COST: 4 tokens removed");
    assert.equal(zoneOf(engine, id(target)), "discard", "EFFECT: the character is destroyed");
    assert.equal(zoneOf(engine, id("loc")), "play");
  });
}

for (const [mine, foes] of [
  [1, 0],
  [0, 1],
  [2, 1],
  [1, 2],
  [3, 0],
  [3, 2],
  [4, 1]
] as const) {
  clause(CHAMBER, "2:ability:dissolve", `${mine + foes} characters in play (odd: ${mine} yours + ${foes} theirs): refused, and nothing changes (tokens stay, no character destroyed)`, () => {
    const { engine, id } = dissolveBoard({ mine, foes, tokens: 4 });
    const target = foes > 0 ? "f1" : "m1";
    assert.throws(dissolveRaw(engine, id, target), "Use this only if an even number of characters are in play");
    assert.equal(tokens(engine, id("loc")), 4);
    assert.equal(zoneOf(engine, id(target)), "play");
    assert.equal(engine.state.responseWindow, undefined, "no activation was started");
  });
}

clause(CHAMBER, "2:ability:dissolve", "with no characters in play (zero is even) there is nothing to pick, so it cannot be used", () => {
  const { engine, id } = dissolveBoard({ mine: 0, foes: 0, tokens: 4 });
  assert.throws(() => activateRaw(engine, P1, id("loc"), "dissolve", { selected: {} }));
  assert.equal(tokens(engine, id("loc")), 4);
});

clause(CHAMBER, "2:ability:dissolve", "only CHARACTERS are counted: items, locations, resources and face-down cards do not change the parity", () => {
  const odd = dissolveBoard({ mine: 1, foes: 0, faceDowns: 1, tokens: 4 });
  // 1 character + 1 face-down card + items + another location: still ONE character
  assert.throws(dissolveRaw(odd.engine, odd.id, "m1"), "one real character is odd, whatever else is on the table");
  assert.equal(tokens(odd.engine, odd.id("loc")), 4);
  const even = dissolveBoard({ mine: 2, foes: 0, faceDowns: 1, tokens: 4 });
  dissolve(even.engine, even.id, "m1");
  assert.equal(zoneOf(even.engine, even.id("m1")), "discard", "two real characters (plus a face-down card): even");
});

for (const have of [4, 5, 9]) {
  clause(CHAMBER, "2:ability:dissolve", `removes exactly 4 tokens: from ${have} tokens leaves ${have - 4}`, () => {
    const { engine, id } = dissolveBoard({ tokens: have });
    dissolve(engine, id, "f1");
    assert.equal(tokens(engine, id("loc")), have - 4);
    assert.equal(zoneOf(engine, id("f1")), "discard");
  });
}

for (const have of [0, 1, 3]) {
  clause(CHAMBER, "2:ability:dissolve", `needs 4 tokens: refused with ${have}, and nothing is destroyed`, () => {
    const { engine, id } = dissolveBoard({ tokens: have });
    assert.throws(dissolveRaw(engine, id, "f1"));
    assert.equal(tokens(engine, id("loc")), have, "no tokens removed");
    assert.equal(zoneOf(engine, id("f1")), "play");
  });
}

clause(CHAMBER, "2:ability:dissolve", "any character can be picked, yours or the opponent's: both are destroyed into their owner's discard pile", () => {
  for (const [target, owner] of [
    ["m1", P1],
    ["f1", P2]
  ] as const) {
    const { engine, id } = dissolveBoard({ tokens: 4 });
    dissolve(engine, id, target);
    assert.equal(zoneOf(engine, id(target)), "discard");
    assert.equal(discardOf(engine, owner).includes(id(target)), true, `in ${owner}'s discard pile`);
    const other = target === "m1" ? "f1" : "m1";
    assert.equal(zoneOf(engine, id(other)), "play", "the other character is untouched");
  }
});

clause(CHAMBER, "2:ability:dissolve", "a character you control but do not own, and one you own but the opponent controls, are both characters in play and can be picked", () => {
  const { engine, id } = dissolveBoard({
    mine: 0,
    foes: 0,
    tokens: 4,
    extra: [
      { key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 },
      { key: "lent", def: character({ name: "Lent" }), owner: P1, zone: "play", controller: P2 }
    ]
  });
  dissolve(engine, id, "stolen");
  assert.equal(zoneOf(engine, id("stolen")), "discard");
  assert.equal(discardOf(engine, P2).includes(id("stolen")), true, "it is destroyed into its OWNER's discard pile");
  assert.equal(zoneOf(engine, id("lent")), "play");
});

clause(CHAMBER, "2:ability:dissolve", "only a CHARACTER can be picked: an item, a location (even itself), a faction, a resource, a face-down card, or a card outside play is refused", () => {
  const { engine, id } = dissolveBoard({ mine: 1, foes: 1, tokens: 4, faceDowns: 0, extra: [faceDownCard("fd", P1)] });
  const resourceId = engine.state.players[P1].play.find((c) => engine.getDefinition(c).type === "resource")!;
  const attempt = (cardId: string) => () => activateRaw(engine, P1, id("loc"), "dissolve", { selected: { c: [cardId] } });
  assert.throws(attempt(id("myItem")), "an item");
  assert.throws(attempt(id("foeItem")), "the opponent's item");
  assert.throws(attempt(id("otherLoc")), "another location");
  assert.throws(attempt(id("loc")), "the Chamber itself");
  assert.throws(attempt(factionIdOf(engine, P1)), "your faction");
  assert.throws(attempt(factionIdOf(engine, P2)), "the opponent's faction");
  assert.throws(attempt(resourceId), "a resource");
  assert.throws(attempt(id("fd")), "a face-down card");
  assert.throws(attempt(id("handChar")), "a character in hand");
  assert.throws(attempt(id("discChar")), "a character in the discard pile");
  assert.throws(() => activateRaw(engine, P1, id("loc"), "dissolve", { selected: {} }), "no pick");
  assert.throws(() => activateRaw(engine, P1, id("loc"), "dissolve", { selected: { c: [id("m1"), id("f1")] } }), "only one character");
  assert.equal(tokens(engine, id("loc")), 4, "refused activations remove no tokens");
  dissolve(engine, id, "m1");
  assert.equal(zoneOf(engine, id("m1")), "discard", "a legal pick works");
});

clause(CHAMBER, "2:ability:dissolve", "costs no resources, and the parity is checked each time: after destroying one of 4 characters (3 left) it cannot be used again until the number is even again", () => {
  const { engine, id } = dissolveBoard({ mine: 2, foes: 2, tokens: 8, extra: [] });
  const resources = ready(engine);
  dissolve(engine, id, "f1");
  assert.equal(ready(engine), resources, "no resources are paid");
  assert.equal(tokens(engine, id("loc")), 4);
  assert.throws(dissolveRaw(engine, id, "f2"), "3 characters left: odd");
  assert.equal(tokens(engine, id("loc")), 4);
  // put a character into play (2 + 1 + ... = 4 again) and use it a second time
  const putter = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "loc", def: printing(CHAMBER), owner: P1, zone: "play", counters: { token: 8 } },
      { key: "m1", def: character({ name: "M1" }), owner: P1, zone: "play" },
      { key: "m2", def: character({ name: "M2" }), owner: P1, zone: "play" },
      { key: "f1", def: character({ name: "F1" }), owner: P2, zone: "play" },
      { key: "f2", def: character({ name: "F2" }), owner: P2, zone: "play" },
      { key: "putter", def: PUTTER(), owner: P1, zone: "hand" },
      { key: "newChar", def: character({ name: "NewChar" }), owner: P1, zone: "hand" }
    ]
  });
  dissolve(putter.engine, putter.id, "f1");
  assert.throws(dissolveRaw(putter.engine, putter.id, "f2"), "3 characters: odd");
  play(putter.engine, P1, putter.id("putter"), { selected: { t: [putter.id("newChar")] } });
  assert.equal(zoneOf(putter.engine, putter.id("newChar")), "play");
  dissolve(putter.engine, putter.id, "f2");
  assert.equal(zoneOf(putter.engine, putter.id("f2")), "discard", "4 characters again: allowed");
  assert.equal(tokens(putter.engine, putter.id("loc")), 0, "8 tokens = two uses");
});

clause(CHAMBER, "2:ability:dissolve", "only its controller can use it, and not from your hand", () => {
  const { engine, id } = dissolveBoard();
  assert.throws(dissolveRaw(engine, id, "m1", P2), "the opponent cannot");
  assert.equal(tokens(engine, id("loc")), 4);
  const inHand = dissolveBoard({ zone: "hand" });
  assert.throws(dissolveRaw(inHand.engine, inHand.id, "f1"), "not from hand");
});

// =============================================================================
// Voidal Observatory
// At the start of your turn, you may put a token on this card.
// ENERGIZE -- COST: Pay 2. -- EFFECT: Put a token on this card.
// STUDY -- COST: Remove 3 tokens from this card. -- EFFECT: Draw a card.
// Location, cost 2, threshold [O][O], structure 5.
// =============================================================================

clause(OBSERVATORY, "0:rule", "at the start of your turn you may put a token on it: accepting adds exactly one token (and nothing else gets one)", () => locUpkeepAccept(OBSERVATORY));
clause(OBSERVATORY, "0:rule", "'may': declining adds no token", () => locUpkeepDecline(OBSERVATORY));
clause(OBSERVATORY, "0:rule", "only at the start of YOUR turn, not the opponent's", () => locUpkeepOnlyYourTurn(OBSERVATORY));
clause(OBSERVATORY, "0:rule", "'your turn' is its controller's turn: an Observatory controlled by the opponent prompts them, not its owner", () => locUpkeepControllersTurn(OBSERVATORY));
clause(OBSERVATORY, "0:rule", "does nothing while it is not in play (in hand)", () => locUpkeepNeedsPlay(OBSERVATORY));
clause(OBSERVATORY, "0:rule", "one token per turn, on every turn: accepting three turns in a row gives 1, 2, 3 tokens", () => locUpkeepAccumulates(OBSERVATORY));
clause(OBSERVATORY, "0:rule", "deploys for 2 with [O][O] (refused one short, or one icon short) and has structure 5", () => locDeploy(OBSERVATORY, 2, "oo", 5));
clause(OBSERVATORY, "0:rule", "structure 5: four damage leaves it standing, five destroys it", () => locStructure(OBSERVATORY, 5));

const ENERGIZE_OBS = "voidal-observatory-energize";
const STUDY_OBS = "voidal-observatory-study";

clause(OBSERVATORY, "1:ability:voidal-observatory-energize", "ENERGIZE pays exactly 2 resources for exactly one token on the Observatory, every time it is used", () => locEnergize(OBSERVATORY, ENERGIZE_OBS));
clause(OBSERVATORY, "1:ability:voidal-observatory-energize", "is refused with fewer than 2 resources (paying nothing) and allowed with exactly 2", () => locEnergizeRefused(OBSERVATORY, ENERGIZE_OBS));
clause(OBSERVATORY, "1:ability:voidal-observatory-energize", "'Pay 2' has no icon requirement: any resources (staples of any kind, face-down Volition) will do", () => locEnergizeAnyResources(OBSERVATORY, ENERGIZE_OBS));
clause(OBSERVATORY, "1:ability:voidal-observatory-energize", "adds to the tokens already on the Observatory", () => locEnergizeOwnTokens(OBSERVATORY, ENERGIZE_OBS));
clause(OBSERVATORY, "1:ability:voidal-observatory-energize", "only its controller can use it, and not from your hand", () => locEnergizeRestrictions(OBSERVATORY, ENERGIZE_OBS));

for (const [have, left] of [
  [3, 0],
  [4, 1],
  [5, 2]
] as const) {
  clause(OBSERVATORY, "2:ability:voidal-observatory-study", `STUDY removes exactly 3 tokens (from ${have} leaves ${left}) and draws exactly one card, the top card of your deck`, () => {
    const { engine, id } = voidalBoard(OBSERVATORY, { tokens: have });
    const top = deckOf(engine, P1)[0];
    const handBefore = handOf(engine, P1).length;
    const oppHand = handOf(engine, P2).length;
    const oppDeck = deckOf(engine, P2).length;
    const resources = ready(engine);
    activate(engine, P1, id("loc"), STUDY_OBS);
    assert.equal(tokens(engine, id("loc")), left);
    assert.equal(handOf(engine, P1).length, handBefore + 1, "exactly one card drawn");
    assert.equal(zoneOf(engine, top), "hand", "the top card");
    assert.equal(deckOf(engine, P1).length, 3);
    assert.equal(handOf(engine, P2).length, oppHand, "the opponent does not draw");
    assert.equal(deckOf(engine, P2).length, oppDeck);
    assert.equal(ready(engine), resources, "no resources are paid");
  });
}

for (const have of [0, 1, 2]) {
  clause(OBSERVATORY, "2:ability:voidal-observatory-study", `needs 3 tokens: refused with ${have}, with no card drawn and no tokens removed`, () => {
    const { engine, id } = voidalBoard(OBSERVATORY, { tokens: have });
    const handBefore = handOf(engine, P1).length;
    assert.throws(() => activateRaw(engine, P1, id("loc"), STUDY_OBS));
    assert.equal(tokens(engine, id("loc")), have);
    assert.equal(handOf(engine, P1).length, handBefore);
    assert.equal(deckOf(engine, P1).length, 4);
  });
}

clause(OBSERVATORY, "2:ability:voidal-observatory-study", "with 6 tokens it can be used twice, drawing two cards in all", () => {
  const { engine, id } = voidalBoard(OBSERVATORY, { tokens: 6 });
  const handBefore = handOf(engine, P1).length;
  const [first, second] = deckOf(engine, P1);
  activate(engine, P1, id("loc"), STUDY_OBS);
  activate(engine, P1, id("loc"), STUDY_OBS);
  assert.equal(tokens(engine, id("loc")), 0);
  assert.equal(handOf(engine, P1).length, handBefore + 2);
  assert.equal(zoneOf(engine, first), "hand");
  assert.equal(zoneOf(engine, second), "hand");
  assert.throws(() => activateRaw(engine, P1, id("loc"), STUDY_OBS), "no tokens left");
});

clause(OBSERVATORY, "2:ability:voidal-observatory-study", "with an empty deck the tokens are still removed and you simply fail to draw (CR 306.2)", () => {
  const { engine, id } = voidalBoard(OBSERVATORY, { tokens: 3, deck: 0 });
  const handBefore = handOf(engine, P1).length;
  activate(engine, P1, id("loc"), STUDY_OBS);
  assert.equal(tokens(engine, id("loc")), 0);
  assert.equal(handOf(engine, P1).length, handBefore);
  assert.equal(engine.state.winner ?? null, null, "running out of cards does not lose the game");
});

clause(OBSERVATORY, "2:ability:voidal-observatory-study", "its CONTROLLER draws: an Observatory the opponent controls draws for them, not for its owner", () => {
  const { engine, id } = voidalBoard(OBSERVATORY, { tokens: 3, controller: P2, extra: [] });
  const p1Hand = handOf(engine, P1).length;
  const p2Hand = handOf(engine, P2).length;
  const top = deckOf(engine, P2)[0];
  activate(engine, P2, id("loc"), STUDY_OBS);
  assert.equal(handOf(engine, P2).length, p2Hand + 1);
  assert.equal(zoneOf(engine, top), "hand");
  assert.equal(handOf(engine, P1).length, p1Hand);
});

clause(OBSERVATORY, "2:ability:voidal-observatory-study", "only its controller can use it, and not from your hand", () => {
  const { engine, id } = voidalBoard(OBSERVATORY, { tokens: 3 });
  assert.throws(() => activateRaw(engine, P2, id("loc"), STUDY_OBS), "the opponent cannot");
  assert.equal(tokens(engine, id("loc")), 3);
  const inHand = voidalBoard(OBSERVATORY, { zone: "hand" });
  assert.throws(() => activateRaw(inHand.engine, P1, inHand.id("loc"), STUDY_OBS), "not from hand");
});

clause(OBSERVATORY, "2:ability:voidal-observatory-study", "the tokens come from THIS Observatory: tokens on other cards cannot pay for STUDY", () => {
  const { engine, id } = voidalBoard(OBSERVATORY, { tokens: 2 });
  assert.equal(tokens(engine, id("myItem")), 2);
  assert.throws(() => activateRaw(engine, P1, id("loc"), STUDY_OBS), "2 + 2 tokens elsewhere is still only 2 on the Observatory");
  assert.equal(tokens(engine, id("myItem")), 2);
  assert.equal(tokens(engine, id("loc")), 2);
});

// =============================================================================
// Voidal Perversion
// COST: Pick up to 2 non-resource cards. -- EFFECT: Put up to 2 tokens divided
// however you want on the cards. Then, draw a card.
// Tactic, cost 3, threshold [O].
// =============================================================================

const PERVERSION = "479d78b0-1915-466b-a182-b7579d7c48d4";
const ALL_PERVERSION_KEYS = ["c1", "c2", "c3", "myItem", "myLoc", "foe", "foeItem", "foeLoc", "handChar", "discChar", "deckCard"];

function perversionBoard(opts: { obsession?: number; greed?: number; deck?: number; extra?: CardPlacement[]; noFaceDown?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "vp", def: printing(PERVERSION), owner: P1, zone: "hand" },
      { key: "c1", def: character({ name: "C1" }), owner: P1, zone: "play" },
      { key: "c2", def: character({ name: "C2" }), owner: P1, zone: "play" },
      { key: "c3", def: character({ name: "C3" }), owner: P1, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "myLoc", def: location({ name: "MyLoc" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "foeItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      { key: "foeLoc", def: location({ name: "FoeLoc" }), owner: P2, zone: "play" },
      ...(opts.noFaceDown ? [] : [faceDownCard("faceDown", P2)]),
      { key: "handChar", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
      { key: "discChar", def: character({ name: "DiscChar" }), owner: P1, zone: "discard" },
      ...Array.from({ length: opts.deck ?? 3 }, (_, i) => ({ key: i === 0 ? "deckCard" : `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
      ...Array.from({ length: 3 }, (_, i) => ({ key: `e${i}`, def: character({ name: `E${i}` }), owner: P2, zone: "deck" as const })),
      ...bank("obsession", opts.obsession ?? 3, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const pervert = (engine: SpoilsEngine, id: Ids, picked: string[]) => play(engine, P1, id("vp"), { selected: { picked: picked.map(id) } });
const distribute = (engine: SpoilsEngine, id: Ids, shares: Record<string, number>) =>
  resolveChoice(engine, P1, { kind: "distributeAmong", shares: Object.fromEntries(Object.entries(shares).map(([key, n]) => [id(key), n])) });

for (const [a, b] of [
  [1, 1],
  [2, 0],
  [0, 2]
] as const) {
  clause(PERVERSION, "0:ability", `two picked cards, 2 tokens divided ${a}/${b}: each gets exactly its share, nothing else gets a token, then you draw one card`, () => {
    const { engine, id } = perversionBoard();
    const before = ready(engine);
    const top = deckOf(engine, P1)[0];
    const handBefore = handOf(engine, P1).length;
    pervert(engine, id, ["c1", "foe"]);
    const pc = pending(engine)!;
    assert.equal(pc.kind, "distributeAmong");
    assert.equal(pc.playerId, P1, "the caster divides the tokens");
    distribute(engine, id, { c1: a, foe: b });
    assert.equal(pending(engine), undefined);
    assert.equal(before - ready(engine), 3, "the printed cost of 3 is paid");
    for (const key of ALL_PERVERSION_KEYS) assert.equal(tokens(engine, id(key)), key === "c1" ? a : key === "foe" ? b : 0, `${key} tokens`);
    assert.equal(handOf(engine, P1).length, handBefore - 1 + 1, "the tactic left the hand, one card was drawn");
    assert.equal(zoneOf(engine, top), "hand", "the drawn card is the top of the deck");
    assert.equal(zoneOf(engine, id("vp")), "discard");
  });
}

for (const share of [2, 1]) {
  clause(PERVERSION, "0:ability", `a single picked card can take ${share} token${share === 1 ? "" : "s"} ('up to 2')`, () => {
    const { engine, id } = perversionBoard();
    pervert(engine, id, ["myItem"]);
    distribute(engine, id, { myItem: share });
    assert.equal(tokens(engine, id("myItem")), share);
    for (const key of ALL_PERVERSION_KEYS) if (key !== "myItem") assert.equal(tokens(engine, id(key)), 0, key);
    assert.equal(handOf(engine, P1).includes(id("deckCard")), true, "and the draw happens");
  });
}

clause(PERVERSION, "0:ability", "'up to 2 tokens': you may place only 1 token in all, or none at all, and you still draw", () => {
  const one = perversionBoard();
  pervert(one.engine, one.id, ["c1", "c2"]);
  distribute(one.engine, one.id, { c1: 1 });
  assert.equal(tokens(one.engine, one.id("c1")), 1);
  assert.equal(tokens(one.engine, one.id("c2")), 0);
  assert.equal(zoneOf(one.engine, one.id("deckCard")), "hand", "still draws");
  const none = perversionBoard();
  pervert(none.engine, none.id, ["c1", "c2"]);
  distribute(none.engine, none.id, {});
  assert.equal(tokens(none.engine, none.id("c1")) + tokens(none.engine, none.id("c2")), 0);
  assert.equal(zoneOf(none.engine, none.id("deckCard")), "hand", "still draws");
  assert.equal(pending(none.engine), undefined);
});

clause(PERVERSION, "0:ability", "'up to 2 cards': picking no card at all puts no token anywhere, and you still draw a card", () => {
  const { engine, id } = perversionBoard();
  pervert(engine, id, []);
  drain(engine, declineAll);
  for (const key of ALL_PERVERSION_KEYS) assert.equal(tokens(engine, id(key)), 0, key);
  assert.equal(zoneOf(engine, id("deckCard")), "hand", "'Then, draw a card' happens regardless");
  assert.equal(zoneOf(engine, id("vp")), "discard");
});

clause(PERVERSION, "0:ability", "the tokens cannot add up to more than 2, go to a card that was not picked, or be fractional or negative", () => {
  const { engine, id } = perversionBoard();
  pervert(engine, id, ["c1", "c2"]);
  const attempt = (shares: Record<string, number>) =>
    tryChoice(engine, P1, { kind: "distributeAmong", shares: Object.fromEntries(Object.entries(shares).map(([key, n]) => [id(key), n])) });
  assert.throws(attempt({ c1: 2, c2: 1 }), "3 tokens is more than 2");
  assert.throws(attempt({ c1: 3 }), "3 tokens on one card");
  assert.throws(attempt({ c3: 1 }), "c3 was not picked");
  assert.throws(attempt({ c1: 1, c3: 1 }), "one share to an unpicked card");
  assert.throws(attempt({ c1: 1.5 }), "a fractional share");
  assert.equal(pending(engine)?.kind, "distributeAmong", "still waiting for a legal division");
  attempt({ c1: 1, c2: 1 })();
  assert.equal(tokens(engine, id("c2")), 1);
});

for (const key of ["c1", "myItem", "myLoc", "foe", "foeItem", "foeLoc"]) {
  clause(PERVERSION, "0:ability", `any non-resource card in play can be picked and receive tokens: ${key}`, () => {
    const { engine, id } = perversionBoard();
    pervert(engine, id, [key]);
    distribute(engine, id, { [key]: 2 });
    assert.equal(tokens(engine, id(key)), 2);
  });
}

clause(PERVERSION, "0:ability", "tokens are added to the tokens a card already has", () => {
  const { engine, id } = perversionBoard();
  engine.state.cards[id("c1")].counters = { token: 3 };
  pervert(engine, id, ["c1"]);
  distribute(engine, id, { c1: 2 });
  assert.equal(tokens(engine, id("c1")), 5);
});

clause(PERVERSION, "0:ability", "only non-resource cards IN PLAY can be picked: a resource, a face-down card, a faction, a card in hand, deck or discard pile, three cards, or the same card twice are refused", () => {
  const { engine, id } = perversionBoard();
  const resourceId = engine.state.players[P1].play.find((c) => engine.getDefinition(c).type === "resource")!;
  const attempt = (...cards: string[]) => () => playRaw(engine, P1, id("vp"), { selected: { picked: cards } });
  assert.throws(attempt(resourceId), "a face-up resource");
  assert.throws(attempt(id("faceDown")), "a face-down card is only a resource");
  assert.throws(attempt(factionIdOf(engine, P1)), "your faction");
  assert.throws(attempt(factionIdOf(engine, P2)), "the opponent's faction");
  assert.throws(attempt(id("handChar")), "a card in hand");
  assert.throws(attempt(id("discChar")), "a card in the discard pile");
  assert.throws(attempt(id("deckCard")), "a card in the deck");
  assert.throws(attempt(id("c1"), id("faceDown")), "one legal card and one face-down card");
  assert.throws(attempt(id("c1"), id("c2"), id("c3")), "three cards is more than 'up to 2'");
  assert.throws(attempt(id("c1"), id("c1")), "the same card twice");
  assert.equal(zoneOf(engine, id("vp")), "hand", "refused plays leave the tactic in hand");
  attempt(id("c1"), id("foe"))();
  assert.ok(engine.state.responseWindow, "two legal cards are accepted");
});

clause(PERVERSION, "0:ability", "the cards are picked as a COST (before the opponent can respond): no token is placed and nothing is drawn until the tactic resolves", () => {
  const { engine, id } = perversionBoard();
  playRaw(engine, P1, id("vp"), { selected: { picked: [id("c1"), id("c2")] } });
  assert.ok(engine.state.responseWindow, "the opponent may respond");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  for (const key of ALL_PERVERSION_KEYS) assert.equal(tokens(engine, id(key)), 0, key);
  assert.equal(zoneOf(engine, id("deckCard")), "deck", "nothing drawn yet");
  resolvePendingResponses(engine);
  assert.equal(pending(engine)?.kind, "distributeAmong");
});

clause(PERVERSION, "0:ability", "with an empty deck the tokens are still placed and nothing is drawn (CR 306.2)", () => {
  const { engine, id } = perversionBoard({ deck: 0 });
  const handBefore = handOf(engine, P1).length;
  pervert(engine, id, ["c1"]);
  distribute(engine, id, { c1: 2 });
  assert.equal(tokens(engine, id("c1")), 2);
  assert.equal(handOf(engine, P1).length, handBefore - 1, "only the tactic left the hand");
  assert.equal(engine.state.winner ?? null, null);
});

clause(PERVERSION, "0:ability", "you draw, the opponent does not", () => {
  const { engine, id } = perversionBoard();
  const oppHand = handOf(engine, P2).length;
  const oppDeck = deckOf(engine, P2).length;
  pervert(engine, id, ["c1"]);
  distribute(engine, id, { c1: 1 });
  assert.equal(handOf(engine, P2).length, oppHand);
  assert.equal(deckOf(engine, P2).length, oppDeck);
});

clause(PERVERSION, "0:ability", "is refused one resource short of its cost of 3, and without [O] even with enough other resources", () => {
  const short = perversionBoard({ obsession: 2, noFaceDown: true });
  assert.throws(() => playRaw(short.engine, P1, short.id("vp"), { selected: { picked: [short.id("c1")] } }));
  const noThreshold = perversionBoard({ obsession: 0, greed: 6, noFaceDown: true });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("vp"), { selected: { picked: [noThreshold.id("c1")] } }));
  const exact = perversionBoard({ obsession: 1, greed: 2, noFaceDown: true });
  pervert(exact.engine, exact.id, ["c1"]);
  distribute(exact.engine, exact.id, { c1: 2 });
  assert.equal(tokens(exact.engine, exact.id("c1")), 2, "[O] plus a third resource is enough");
});

// =============================================================================
// Voidal Poisoning
// You may remove any number of tokens from cards you control. Use the tokens
// any way you want to create the following effects any number of times:
// 1 TOKEN - Pick a character. Inflict 1 damage to that character.
// 2 TOKENS - Draw a card.
// 2 TOKENS - Your opponent must discard a card.
// 3 TOKENS - Search your deck for a card and put it into your hand.
// Tactic, cost 3, threshold [O][O][O].
// =============================================================================

const POISONING = "fed9a0cc-cd8d-4633-ba92-d05a94e6acda";

function poisoningBoard(opts: { tokens?: Record<string, number>; deck?: number; oppHand?: number; obsession?: number; greed?: number; extra?: CardPlacement[] } = {}) {
  const t = opts.tokens ?? {};
  const counters = (key: string) => (t[key] ? { token: t[key] } : undefined);
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "poi", def: printing(POISONING), owner: P1, zone: "hand" },
      { key: "k1", def: character({ name: "K1", life: 5 }), owner: P1, zone: "play", counters: counters("k1") },
      { key: "k2", def: character({ name: "K2", life: 5 }), owner: P1, zone: "play", counters: counters("k2") },
      { key: "i1", def: item({ name: "I1" }), owner: P1, zone: "play", counters: counters("i1") },
      { key: "l1", def: location({ name: "L1", structure: 5 }), owner: P1, zone: "play", counters: counters("l1") },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play", counters: counters("foe") },
      { key: "weak", def: character({ name: "Weak", life: 1 }), owner: P2, zone: "play" },
      { key: "foeItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play", counters: counters("foeItem") },
      { key: "stolen", def: character({ name: "Stolen", life: 5 }), owner: P2, zone: "play", controller: P1, counters: counters("stolen") },
      { key: "lent", def: character({ name: "Lent", life: 5 }), owner: P1, zone: "play", controller: P2, counters: counters("lent") },
      { key: "handChar", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
      { key: "discChar", def: character({ name: "DiscChar" }), owner: P1, zone: "discard" },
      ...Array.from({ length: opts.deck ?? 5 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
      ...Array.from({ length: 3 }, (_, i) => ({ key: `e${i}`, def: character({ name: `E${i}` }), owner: P2, zone: "deck" as const })),
      ...handCards(P2, Array.from({ length: opts.oppHand ?? 3 }, (_, i) => costed(`Opp${i}`, 1))),
      ...bank("obsession", opts.obsession ?? 3, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type Menu = { kind: string; playerId: string; options: Array<{ cost: number; label?: string }>; available: Record<string, number> };
const menuOf = (engine: SpoilsEngine) => {
  const pc = pending(engine) as unknown as Menu | undefined;
  assert.equal(pc?.kind, "spendCountersMenu", "the token menu is open");
  return pc!;
};
const DAMAGE = /damage/i;
const DRAW = /draw/i;
const DISCARD = /discard/i;
const SEARCH = /search/i;
const optionFor = (engine: SpoilsEngine, label: RegExp, cost: number) => {
  const menu = menuOf(engine);
  const index = menu.options.findIndex((o) => label.test(o.label ?? ""));
  assert.ok(index >= 0, `an option labelled ${label}`);
  assert.equal(menu.options[index].cost, cost, `${label} costs ${cost} token(s)`);
  return index;
};
const spend = (engine: SpoilsEngine, id: Ids, label: RegExp, cost: number, sources: string[]) =>
  resolveChoice(engine, P1, { kind: "spendCountersMenu", optionIndex: optionFor(engine, label, cost), sources: sources.map(id) });
const stopMenu = (engine: SpoilsEngine) => resolveChoice(engine, P1, { kind: "spendCountersMenu", optionIndex: null });
const castPoisoning = (engine: SpoilsEngine, id: Ids) => play(engine, P1, id("poi"));
/** Answers the chooserSelectsTarget prompt of a spent option. */
const pickTarget = (engine: SpoilsEngine, player: Player, ids: string[]) => resolveChoice(engine, player, { kind: "chooserSelectsTarget", selected: ids });

// --- 0:rule: removing the tokens

clause(POISONING, "0:rule", "'You MAY remove ... any number': stopping at once removes no token and does nothing; the tactic still ends in the discard pile", () => {
  const { engine, id } = poisoningBoard({ tokens: { k1: 3 } });
  const handBefore = handOf(engine, P1).length;
  castPoisoning(engine, id);
  menuOf(engine);
  stopMenu(engine);
  assert.equal(pending(engine), undefined);
  assert.equal(tokens(engine, id("k1")), 3, "no token removed");
  assert.equal(handOf(engine, P1).length, handBefore - 1, "nothing drawn");
  assert.equal(zoneOf(engine, id("poi")), "discard");
});

clause(POISONING, "0:rule", "the token menu offers exactly the four printed effects at their printed token costs: 1, 2, 2 and 3", () => {
  const { engine, id } = poisoningBoard({ tokens: { k1: 3 } });
  castPoisoning(engine, id);
  const menu = menuOf(engine);
  assert.equal(menu.playerId, P1, "you decide how to use the tokens");
  assert.deepEqual(menu.options.map((o) => o.cost), [1, 2, 2, 3]);
  optionFor(engine, DAMAGE, 1);
  optionFor(engine, DRAW, 2);
  optionFor(engine, DISCARD, 2);
  optionFor(engine, SEARCH, 3);
});

clause(POISONING, "0:rule", "tokens may be taken from SEVERAL cards you control (a character, an item, a location): each source loses exactly the tokens named", () => {
  const { engine, id } = poisoningBoard({ tokens: { k1: 1, i1: 1, l1: 1 } });
  castPoisoning(engine, id);
  spend(engine, id, SEARCH, 3, ["k1", "i1", "l1"]);
  pickTarget(engine, P1, [id("d2")]);
  for (const key of ["k1", "i1", "l1"]) assert.equal(tokens(engine, id(key)), 0, `${key} lost its token`);
  assert.equal(zoneOf(engine, id("d2")), "hand");
});

clause(POISONING, "0:rule", "you choose WHICH cards the tokens come from: 2 of 3 tokens from one card, the rest stay where they were", () => {
  const { engine, id } = poisoningBoard({ tokens: { k1: 3, k2: 2 } });
  castPoisoning(engine, id);
  spend(engine, id, DRAW, 2, ["k2", "k2"]);
  assert.equal(tokens(engine, id("k2")), 0);
  assert.equal(tokens(engine, id("k1")), 3, "the other card keeps all its tokens");
  assert.equal(zoneOf(engine, id("d0")), "hand");
});

clause(POISONING, "0:rule", "tokens come only from cards YOU control: the opponent's cards' tokens are not available, a card you control but do not own is, one you own but the opponent controls is not", () => {
  const { engine, id } = poisoningBoard({ tokens: { foe: 2, foeItem: 2, stolen: 1, lent: 2, k1: 1 } });
  castPoisoning(engine, id);
  const menu = menuOf(engine);
  assert.equal(menu.available[id("k1")], 1);
  assert.equal(menu.available[id("stolen")], 1, "a card you control (though the opponent owns it)");
  assert.equal(menu.available[id("foe")], undefined, "the opponent's character");
  assert.equal(menu.available[id("foeItem")], undefined, "the opponent's item");
  assert.equal(menu.available[id("lent")], undefined, "a card the opponent controls (though you own it)");
  assert.throws(tryChoice(engine, P1, { kind: "spendCountersMenu", optionIndex: optionFor(engine, DRAW, 2), sources: [id("foe"), id("foe")] }), "cannot take tokens from the opponent's card");
  assert.throws(tryChoice(engine, P1, { kind: "spendCountersMenu", optionIndex: optionFor(engine, DRAW, 2), sources: [id("lent"), id("lent")] }), "nor from a card the opponent controls");
  assert.equal(tokens(engine, id("foe")), 2);
  spend(engine, id, DRAW, 2, ["stolen", "k1"]);
  assert.equal(tokens(engine, id("stolen")), 0);
  assert.equal(tokens(engine, id("k1")), 0);
});

clause(POISONING, "0:rule", "you cannot name more tokens than a card has, nor the wrong number of tokens for an effect", () => {
  const { engine, id } = poisoningBoard({ tokens: { k1: 1, k2: 5 } });
  castPoisoning(engine, id);
  const draw = optionFor(engine, DRAW, 2);
  const menuChoice = (sources: string[]) => tryChoice(engine, P1, { kind: "spendCountersMenu", optionIndex: draw, sources: sources.map(id) });
  assert.throws(menuChoice(["k1", "k1"]), "k1 has only one token");
  assert.throws(menuChoice(["k2"]), "'2 TOKENS' needs two tokens, not one");
  assert.throws(menuChoice(["k2", "k2", "k2"]), "nor three");
  assert.throws(menuChoice([]), "nor none");
  assert.throws(tryChoice(engine, P1, { kind: "spendCountersMenu", optionIndex: 9, sources: [] }), "no such effect");
  assert.equal(tokens(engine, id("k1")), 1);
  assert.equal(tokens(engine, id("k2")), 5, "refused answers remove nothing");
  assert.equal(menuOf(engine).kind, "spendCountersMenu", "the menu is still open");
});

clause(POISONING, "0:rule", "'any number of times', 'any way you want': 6 tokens pay for 1 + 1 + 2 + 2 (two damage, a draw and a discard); every effect happens, in the order chosen", () => {
  const { engine, id } = poisoningBoard({ tokens: { k1: 6 } });
  const handBefore = handOf(engine, P1).length;
  castPoisoning(engine, id);
  spend(engine, id, DAMAGE, 1, ["k1"]);
  pickTarget(engine, P1, [id("foe")]);
  spend(engine, id, DAMAGE, 1, ["k1"]);
  pickTarget(engine, P1, [id("weak")]);
  spend(engine, id, DRAW, 2, ["k1", "k1"]);
  spend(engine, id, DISCARD, 2, ["k1", "k1"]);
  const asked = pending(engine)!;
  assert.equal(asked.playerId, P2, "the opponent discards");
  pickTarget(engine, P2, [id("o:Opp0")]);
  assert.equal(pending(engine), undefined, "no tokens left: the menu closes by itself");
  assert.equal(tokens(engine, id("k1")), 0);
  assert.equal(engine.state.cards[id("foe")].damage, 1);
  assert.equal(zoneOf(engine, id("weak")), "discard", "1 damage destroys the 1-life character");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1, "tactic out, one card drawn");
  assert.equal(zoneOf(engine, id("o:Opp0")), "discard");
  assert.equal(zoneOf(engine, id("poi")), "discard");
});

clause(POISONING, "0:rule", "the same effect can be created several times: 6 tokens make three draws", () => {
  const { engine, id } = poisoningBoard({ tokens: { k1: 6 } });
  const handBefore = handOf(engine, P1).length;
  castPoisoning(engine, id);
  for (let n = 0; n < 3; n++) spend(engine, id, DRAW, 2, ["k1", "k1"]);
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 3);
  assert.equal(tokens(engine, id("k1")), 0);
  assert.equal(pending(engine), undefined);
});

clause(POISONING, "0:rule", "tokens you do not use stay on their cards, and the menu stays open while an effect is still affordable", () => {
  const { engine, id } = poisoningBoard({ tokens: { k1: 5 } });
  castPoisoning(engine, id);
  spend(engine, id, DRAW, 2, ["k1", "k1"]);
  assert.equal(tokens(engine, id("k1")), 3);
  menuOf(engine);
  stopMenu(engine);
  assert.equal(tokens(engine, id("k1")), 3, "the unused tokens remain");
});

clause(POISONING, "0:rule", "with no tokens on any card you control nothing happens, but the tactic can still be played and ends in the discard pile", () => {
  const { engine, id } = poisoningBoard({ tokens: { foe: 4 } });
  const handBefore = handOf(engine, P1).length;
  castPoisoning(engine, id);
  assert.equal(pending(engine), undefined, "nothing to spend");
  assert.equal(zoneOf(engine, id("poi")), "discard");
  assert.equal(handOf(engine, P1).length, handBefore - 1);
  assert.equal(tokens(engine, id("foe")), 4, "the opponent's tokens are untouched");
});

clause(POISONING, "0:rule", "is refused one resource short of its cost of 3, and without [O][O][O] even with enough other resources", () => {
  const short = poisoningBoard({ tokens: { k1: 3 }, obsession: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("poi")));
  assert.equal(tokens(short.engine, short.id("k1")), 3);
  const noThreshold = poisoningBoard({ tokens: { k1: 3 }, obsession: 2, greed: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("poi")), "only two [O]");
  const exact = poisoningBoard({ tokens: { k1: 3 }, obsession: 3 });
  const before = ready(exact.engine);
  castPoisoning(exact.engine, exact.id);
  assert.equal(before - ready(exact.engine), 3, "the printed cost of 3 is paid");
  assert.equal(menuOf(exact.engine).kind, "spendCountersMenu");
});

// --- 1:rule: 1 TOKEN - Pick a character. Inflict 1 damage to that character.

for (const [key, who] of [
  ["foe", "an opponent's character"],
  ["k1", "your own character"],
  ["stolen", "a character you control but do not own"]
] as const) {
  clause(POISONING, "1:rule", `1 TOKEN: picks ${who} and inflicts exactly 1 damage to it (nothing else is damaged)`, () => {
    const { engine, id } = poisoningBoard({ tokens: { k1: 1 } });
    castPoisoning(engine, id);
    spend(engine, id, DAMAGE, 1, ["k1"]);
    const pc = pending(engine)!;
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P1, "you pick");
    pickTarget(engine, P1, [id(key)]);
    assert.equal(engine.state.cards[id(key)].damage, 1);
    for (const other of ["k1", "k2", "foe", "weak", "stolen", "lent"]) {
      if (other !== key) assert.equal(engine.state.cards[id(other)].damage ?? 0, 0, `${other} undamaged`);
    }
    assert.equal(tokens(engine, id("k1")), 0, "1 token spent");
  });
}

clause(POISONING, "1:rule", "1 token inflicts only 1 damage: a 1-life character is destroyed, a 5-life one survives with 1 damage; two uses on one character make 2", () => {
  const { engine, id } = poisoningBoard({ tokens: { k1: 3 } });
  castPoisoning(engine, id);
  spend(engine, id, DAMAGE, 1, ["k1"]);
  pickTarget(engine, P1, [id("weak")]);
  assert.equal(zoneOf(engine, id("weak")), "discard");
  spend(engine, id, DAMAGE, 1, ["k1"]);
  pickTarget(engine, P1, [id("foe")]);
  spend(engine, id, DAMAGE, 1, ["k1"]);
  pickTarget(engine, P1, [id("foe")]);
  assert.equal(engine.state.cards[id("foe")].damage, 2);
  assert.equal(zoneOf(engine, id("foe")), "play");
});

clause(POISONING, "1:rule", "only a CHARACTER can be picked: an item, a location, a faction, a resource, a face-down card, or a card outside play are refused", () => {
  const { engine, id } = poisoningBoard({ tokens: { k1: 1 }, extra: [faceDownCard("fd", P2)] });
  const resourceId = engine.state.players[P1].play.find((c) => engine.getDefinition(c).type === "resource")!;
  castPoisoning(engine, id);
  spend(engine, id, DAMAGE, 1, ["k1"]);
  const attempt = (...cards: string[]) => tryChoice(engine, P1, { kind: "chooserSelectsTarget", selected: cards });
  assert.throws(attempt(id("i1")), "an item");
  assert.throws(attempt(id("l1")), "a location");
  assert.throws(attempt(factionIdOf(engine, P2)), "the opponent's faction");
  assert.throws(attempt(factionIdOf(engine, P1)), "your faction");
  assert.throws(attempt(resourceId), "a resource");
  assert.throws(attempt(id("fd")), "a face-down card");
  assert.throws(attempt(id("handChar")), "a character in hand");
  assert.throws(attempt(id("discChar")), "a character in the discard pile");
  assert.throws(attempt(id("foe"), id("weak")), "only one character");
  attempt(id("foe"))();
  assert.equal(engine.state.cards[id("foe")].damage, 1);
});

// --- 2:rule: 2 TOKENS - Draw a card.

clause(POISONING, "2:rule", "2 TOKENS: you draw exactly one card, the top card of your deck; the opponent does not", () => {
  const { engine, id } = poisoningBoard({ tokens: { k1: 2 } });
  const top = deckOf(engine, P1)[0];
  const handBefore = handOf(engine, P1).length;
  const oppHand = handOf(engine, P2).length;
  castPoisoning(engine, id);
  spend(engine, id, DRAW, 2, ["k1", "k1"]);
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1);
  assert.equal(zoneOf(engine, top), "hand");
  assert.equal(deckOf(engine, P1).length, 4);
  assert.equal(handOf(engine, P2).length, oppHand);
  assert.equal(tokens(engine, id("k1")), 0, "2 tokens spent");
});

clause(POISONING, "2:rule", "2 TOKENS: with an empty deck the tokens are spent and you simply fail to draw (CR 306.2)", () => {
  const { engine, id } = poisoningBoard({ tokens: { k1: 2 }, deck: 0 });
  const handBefore = handOf(engine, P1).length;
  castPoisoning(engine, id);
  spend(engine, id, DRAW, 2, ["k1", "k1"]);
  assert.equal(handOf(engine, P1).length, handBefore - 1);
  assert.equal(engine.state.winner ?? null, null);
});

// --- 3:rule: 2 TOKENS - Your opponent must discard a card.

clause(POISONING, "3:rule", "2 TOKENS: the OPPONENT chooses a card from their hand and discards it into their discard pile; nothing else is discarded", () => {
  const { engine, id } = poisoningBoard({ tokens: { k1: 2 } });
  const myHand = [...handOf(engine, P1)];
  castPoisoning(engine, id);
  spend(engine, id, DISCARD, 2, ["k1", "k1"]);
  const pc = pending(engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the opponent chooses what to discard");
  pickTarget(engine, P2, [id("o:Opp1")]);
  assert.equal(zoneOf(engine, id("o:Opp1")), "discard");
  assert.equal(discardOf(engine, P2).includes(id("o:Opp1")), true);
  for (const key of ["o:Opp0", "o:Opp2"]) assert.equal(zoneOf(engine, id(key)), "hand", `${key} stays in hand`);
  assert.deepEqual(handOf(engine, P1).filter((c) => c !== id("poi")).sort(), myHand.filter((c) => c !== id("poi")).sort(), "your own hand is untouched");
  assert.equal(tokens(engine, id("k1")), 0, "2 tokens spent");
});

clause(POISONING, "3:rule", "'must discard': the opponent cannot decline, and cannot discard a card that is not in their hand", () => {
  const { engine, id } = poisoningBoard({ tokens: { k1: 2 } });
  castPoisoning(engine, id);
  spend(engine, id, DISCARD, 2, ["k1", "k1"]);
  assert.throws(tryChoice(engine, P2, { kind: "chooserSelectsTarget", selected: [] }), "picking nothing is refused");
  assert.throws(tryChoice(engine, P2, { kind: "chooserSelectsTarget", selected: [id("handChar")] }), "your card");
  assert.throws(tryChoice(engine, P2, { kind: "chooserSelectsTarget", selected: [id("o:Opp0"), id("o:Opp1")] }), "only one card");
  pickTarget(engine, P2, [id("o:Opp0")]);
  assert.equal(zoneOf(engine, id("o:Opp0")), "discard");
});

clause(POISONING, "3:rule", "2 TOKENS: an opponent with an empty hand discards nothing (the tokens are spent)", () => {
  const { engine, id } = poisoningBoard({ tokens: { k1: 2 }, oppHand: 0 });
  castPoisoning(engine, id);
  spend(engine, id, DISCARD, 2, ["k1", "k1"]);
  assert.equal(pending(engine), undefined);
  assert.equal(discardOf(engine, P2).length, 0);
  assert.equal(tokens(engine, id("k1")), 0);
});

// --- 4:rule: 3 TOKENS - Search your deck for a card and put it into your hand.

clause(POISONING, "4:rule", "3 TOKENS: search your deck for ANY card and put it into your hand; the rest of the deck stays", () => {
  for (const pick of ["d0", "d2", "d4"]) {
    const { engine, id } = poisoningBoard({ tokens: { k1: 3 } });
    const deckBefore = [...deckOf(engine, P1)];
    castPoisoning(engine, id);
    spend(engine, id, SEARCH, 3, ["k1", "k1", "k1"]);
    const pc = pending(engine)!;
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P1, "you search");
    pickTarget(engine, P1, [id(pick)]);
    assert.equal(zoneOf(engine, id(pick)), "hand", `${pick} found`);
    assert.deepEqual([...deckOf(engine, P1)].sort(), deckBefore.filter((c) => c !== id(pick)).sort(), "the rest of the deck is the same cards");
    assert.equal(tokens(engine, id("k1")), 0, "3 tokens spent");
  }
});

clause(POISONING, "4:rule", "the search only finds cards of YOUR deck: the opponent's deck, your hand, your discard pile and cards in play are refused", () => {
  const { engine, id } = poisoningBoard({ tokens: { k1: 3 } });
  castPoisoning(engine, id);
  spend(engine, id, SEARCH, 3, ["k1", "k1", "k1"]);
  const attempt = (...cards: string[]) => tryChoice(engine, P1, { kind: "chooserSelectsTarget", selected: cards });
  assert.throws(attempt(id("e0")), "the opponent's deck");
  assert.throws(attempt(id("handChar")), "your hand");
  assert.throws(attempt(id("discChar")), "your discard pile");
  assert.throws(attempt(id("k2")), "a card in play");
  assert.throws(attempt(id("d0"), id("d1")), "only one card");
  attempt(id("d1"))();
  assert.equal(zoneOf(engine, id("d1")), "hand");
});

clause(POISONING, "4:rule", "'Search your deck for a card' is not optional (CR 312.2): with cards in the deck you must find one, you cannot fail the search", () => {
  const { engine, id } = poisoningBoard({ tokens: { k1: 3 } });
  castPoisoning(engine, id);
  spend(engine, id, SEARCH, 3, ["k1", "k1", "k1"]);
  assert.throws(tryChoice(engine, P1, { kind: "chooserSelectsTarget", selected: [] }), "an unconditional 'search for a card' must find a card when the deck has any");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "still waiting for you to pick a card");
});

clause(POISONING, "4:rule", "the searched deck is shuffled afterwards (CR 312.1): same cards, new order", () => {
  const { engine, id } = poisoningBoard({ tokens: { k1: 3 }, deck: 8 });
  const before = deckOf(engine, P1).filter((c) => c !== id("d3"));
  castPoisoning(engine, id);
  spend(engine, id, SEARCH, 3, ["k1", "k1", "k1"]);
  pickTarget(engine, P1, [id("d3")]);
  const after = deckOf(engine, P1);
  assert.deepEqual([...after].sort(), [...before].sort(), "same cards");
  assert.notDeepEqual(after, before, "in a new order");
});

clause(POISONING, "4:rule", "the opponent's deck is not touched by your search", () => {
  const { engine, id } = poisoningBoard({ tokens: { k1: 3 } });
  const theirs = [...deckOf(engine, P2)];
  castPoisoning(engine, id);
  spend(engine, id, SEARCH, 3, ["k1", "k1", "k1"]);
  pickTarget(engine, P1, [id("d0")]);
  assert.deepEqual(deckOf(engine, P2), theirs);
});

clause(POISONING, "4:rule", "with an empty deck the tokens are spent and nothing is found", () => {
  const { engine, id } = poisoningBoard({ tokens: { k1: 3 }, deck: 0 });
  const handBefore = handOf(engine, P1).length;
  castPoisoning(engine, id);
  spend(engine, id, SEARCH, 3, ["k1", "k1", "k1"]);
  drain(engine, declineAll);
  assert.equal(tokens(engine, id("k1")), 0);
  assert.equal(handOf(engine, P1).length, handBefore - 1);
  assert.equal(pending(engine), undefined);
});

// =============================================================================
// Voidal Replication
// EXTRA COST: Your opponents cannot respond to this card. Deploy this only if a
// tactic has been deployed this turn.
// Duplicate the last tactic deployed this turn.
// Tactic, cost 3, threshold [O][O][O].
// =============================================================================

const REPLICATION = "b9e94612-3cbd-44ff-9aac-a553a49c0955";

/** "Opponent's faction loses 1 influence" tactic: a no-target tactic distinguishable from a draw. */
const TAXER = (name = "Taxer") =>
  tactic({ name, cost: 0, behavior: { abilities: [{ id: "tax", type: "activated", effects: [{ type: "modifyInfluence", player: "opponent", amount: -1 }] }] } });

function replicationBoard(opts: { obsession?: number; greed?: number; turn?: number; active?: Player; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 1,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "rep", def: printing(REPLICATION), owner: P1, zone: "hand" },
      { key: "can", def: CANTRIP("Cantrip"), owner: P1, zone: "hand" },
      { key: "tax", def: TAXER(), owner: P1, zone: "hand" },
      { key: "widget", def: item({ name: "Widget", cost: 0 }), owner: P1, zone: "hand" },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...Array.from({ length: 6 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
      ...Array.from({ length: 6 }, (_, i) => ({ key: `e${i}`, def: character({ name: `E${i}` }), owner: P2, zone: "deck" as const })),
      ...bank("obsession", opts.obsession ?? 3, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const influenceOf = (engine: SpoilsEngine, player: Player) => engine.state.players[player].influence;

clause(REPLICATION, "0:extraCost", "'Deploy this only if a tactic has been deployed this turn': refused when none has, and nothing is paid", () => {
  const { engine, id } = replicationBoard();
  const before = ready(engine);
  assert.throws(() => playRaw(engine, P1, id("rep")));
  assert.equal(zoneOf(engine, id("rep")), "hand");
  assert.equal(ready(engine), before, "nothing was paid");
  assert.equal(engine.state.responseWindow, undefined);
});

clause(REPLICATION, "0:extraCost", "allowed once a tactic of yours has been deployed this turn, for its cost of 3", () => {
  const { engine, id } = replicationBoard();
  play(engine, P1, id("can"));
  const before = ready(engine);
  playRaw(engine, P1, id("rep"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("rep")), "discard");
  assert.equal(before - ready(engine), 3, "the printed cost of 3 is paid");
});

clause(REPLICATION, "0:extraCost", "only a TACTIC counts: deploying an item or a character, or using an ability, does not satisfy it", () => {
  const { engine, id } = replicationBoard({
    extra: [{ key: "newChar", def: character({ name: "NewChar", cost: 0 }), owner: P1, zone: "hand" }, { key: "drawer", def: item({ name: "Drawer", behavior: { abilities: [{ id: "dr", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } }), owner: P1, zone: "play" }]
  });
  play(engine, P1, id("widget"));
  assert.throws(() => playRaw(engine, P1, id("rep")), "an item was deployed, not a tactic");
  play(engine, P1, id("newChar"));
  assert.throws(() => playRaw(engine, P1, id("rep")), "a character was deployed, not a tactic");
  activate(engine, P1, id("drawer"), "dr");
  assert.throws(() => playRaw(engine, P1, id("rep")), "an ability was used, not a tactic");
  assert.equal(zoneOf(engine, id("rep")), "hand");
});

clause(REPLICATION, "0:extraCost", "'this turn': a tactic deployed on an earlier turn does not count", () => {
  const { engine, id } = replicationBoard();
  play(engine, P1, id("can"));
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.throws(() => playRaw(engine, P1, id("rep")), "the Cantrip was last turn");
  play(engine, P1, id("tax"));
  playRaw(engine, P1, id("rep"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("rep")), "discard", "a tactic deployed THIS turn does");
});

clause(REPLICATION, "0:extraCost", "a tactic deployed by the OPPONENT this turn counts too (any tactic has been deployed this turn)", () => {
  const { engine, id } = replicationBoard({ extra: [{ key: "theirs", def: CANTRIP("TheirCantrip"), owner: P2, zone: "hand" }] });
  playRaw(engine, P1, id("widget")); // P1 deploys an item; P2 responds with a tactic
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  playRaw(engine, P2, id("theirs"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("widget")), "play");
  assert.equal(zoneOf(engine, id("theirs")), "discard");
  playRaw(engine, P1, id("rep"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("rep")), "discard", "the opponent's tactic satisfied the restriction");
});

clause(REPLICATION, "0:extraCost", "'Your opponents cannot respond to this card': no response window opens for the opponent; it resolves at once", () => {
  const { engine, id } = replicationBoard();
  play(engine, P1, id("can"));
  const handBefore = handOf(engine, P1).length;
  playRaw(engine, P1, id("rep"));
  assert.equal(engine.state.responseWindow, undefined, "no window for the opponent");
  assert.equal(zoneOf(engine, id("rep")), "discard", "it has already resolved");
  assert.equal(handOf(engine, P1).length, handBefore, "...and its duplicate already drew the card (Replication left, one card drawn)");
});

clause(REPLICATION, "0:extraCost", "control: an ordinary tactic does open a response window for the opponent", () => {
  const { engine, id } = replicationBoard();
  playRaw(engine, P1, id("can"));
  assert.ok(engine.state.responseWindow, "an ordinary tactic can be responded to");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
});

clause(REPLICATION, "0:extraCost", "is refused one resource short of its cost of 3, and without [O][O][O] even with enough other resources", () => {
  const short = replicationBoard({ obsession: 2 });
  play(short.engine, P1, short.id("can"));
  assert.throws(() => playRaw(short.engine, P1, short.id("rep")));
  const noThreshold = replicationBoard({ obsession: 2, greed: 5 });
  play(noThreshold.engine, P1, noThreshold.id("can"));
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("rep")), "only two [O]");
  const exact = replicationBoard({ obsession: 3 });
  play(exact.engine, P1, exact.id("can"));
  playRaw(exact.engine, P1, exact.id("rep"));
  assert.equal(zoneOf(exact.engine, exact.id("rep")), "discard");
});

clause(REPLICATION, "1:rule", "duplicates the tactic: a Cantrip's draw happens a second time, for you", () => {
  const { engine, id } = replicationBoard();
  play(engine, P1, id("can"));
  const handAfterCantrip = handOf(engine, P1).length;
  const top = deckOf(engine, P1)[0];
  playRaw(engine, P1, id("rep"));
  resolvePendingResponses(engine);
  assert.equal(handOf(engine, P1).length, handAfterCantrip - 1 + 1, "Replication left the hand, the duplicate drew one card");
  assert.equal(zoneOf(engine, top), "hand", "the duplicate drew the top card");
  assert.equal(handOf(engine, P2).length, 0 + handOf(engine, P2).length, "(the opponent is not involved)");
});

clause(REPLICATION, "1:rule", "duplicates the LAST tactic deployed, not an earlier one: Cantrip then Taxer, then Replication repeats the Taxer only", () => {
  const { engine, id } = replicationBoard();
  play(engine, P1, id("can"));
  play(engine, P1, id("tax"));
  const hand = handOf(engine, P1).length;
  const influence = influenceOf(engine, P2);
  assert.equal(influence, 30 - 1, "the Taxer took 1 influence");
  playRaw(engine, P1, id("rep"));
  resolvePendingResponses(engine);
  assert.equal(influenceOf(engine, P2), influence - 1, "the Taxer was duplicated");
  assert.equal(handOf(engine, P1).length, hand - 1, "the Cantrip was NOT duplicated (no extra draw; only Replication left the hand)");
});

clause(REPLICATION, "1:rule", "...and in the other order the Cantrip is the last tactic: it repeats the draw and not the Taxer", () => {
  const { engine, id } = replicationBoard();
  play(engine, P1, id("tax"));
  play(engine, P1, id("can"));
  const hand = handOf(engine, P1).length;
  const influence = influenceOf(engine, P2);
  playRaw(engine, P1, id("rep"));
  resolvePendingResponses(engine);
  assert.equal(influenceOf(engine, P2), influence, "the Taxer was not repeated");
  assert.equal(handOf(engine, P1).length, hand, "Replication left, the duplicated draw arrived");
});

clause(REPLICATION, "1:rule", "the duplicate is made once and is not Replication itself: the first tactic is repeated exactly once, the duplicate leaves no card behind", () => {
  const { engine, id } = replicationBoard();
  play(engine, P1, id("tax"));
  const cards = Object.keys(engine.state.cards).length;
  const influence = influenceOf(engine, P2);
  playRaw(engine, P1, id("rep"));
  resolvePendingResponses(engine);
  assert.equal(influenceOf(engine, P2), influence - 1, "exactly one more influence lost");
  assert.equal(Object.keys(engine.state.cards).length, cards, "'an invisible copy': no new card exists");
  assert.equal(zoneOf(engine, id("tax")), "discard", "the original stays in the discard pile");
  assert.equal(zoneOf(engine, id("rep")), "discard");
  assert.equal(discardOf(engine, P1).length, 2, "just the two real cards");
});

clause(REPLICATION, "1:rule", "the duplicate costs 0 (CR 307.1): copying your own cost-5 tactic costs only Replication's own 3", () => {
  const expensive = tactic({ name: "Expensive", cost: 5, threshold: "rrr" as never, behavior: { abilities: [{ id: "x", type: "activated", effects: [{ type: "modifyInfluence", player: "opponent", amount: -1 }] }] } });
  const { engine, id } = replicationBoard({
    obsession: 3,
    extra: [{ key: "expensive", def: expensive, owner: P1, zone: "hand" }, ...bank("rage", 5, P1)]
  });
  play(engine, P1, id("expensive"));
  const influence = influenceOf(engine, P2);
  const before = ready(engine);
  assert.equal(before, 3, "only the 3 Obsession are left");
  playRaw(engine, P1, id("rep"));
  resolvePendingResponses(engine);
  assert.equal(before - ready(engine), 3, "Replication costs 3; the copy of the cost-5 tactic costs 0");
  assert.equal(influenceOf(engine, P2), influence - 1, "the copy's effect happened");
});

clause(REPLICATION, "1:rule", "a tactic being deployed counts as deployed: Replication played in response to the opponent's tactic duplicates it for you, needing none of its cost or threshold", () => {
  const expensive = tactic({ name: "Expensive", cost: 5, threshold: "rrr" as never, behavior: { abilities: [{ id: "x", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });
  const { engine, id } = replicationBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "expensive", def: expensive, owner: P2, zone: "hand" }, ...bank("rage", 5, P2)]
  });
  const p1Hand = handOf(engine, P1).length;
  const p2Hand = handOf(engine, P2).length;
  const resources = ready(engine);
  playRaw(engine, P2, id("expensive"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "P1 may respond");
  playRaw(engine, P1, id("rep"));
  assert.equal(resources - ready(engine), 3, "P1 paid only Replication's own 3, not the copy's 5, and has no [R]");
  resolvePendingResponses(engine);
  assert.equal(handOf(engine, P1).length, p1Hand - 1 + 1, "the duplicate drew a card for P1 (the duplicator)");
  assert.equal(handOf(engine, P2).length, p2Hand - 1 + 1, "and the original still resolves: P2 drew one too");
  assert.equal(zoneOf(engine, id("expensive")), "discard");
});

clause(REPLICATION, "1:rule", "a duplicated tactic's extra costs are satisfied again (CR 307.1): duplicating Voidal Webbing makes you pick a character for the copy, which then loses 1 speed", () => {
  const WEBBING_ID = "6f59aeec-488c-416e-8316-ec9eea404f0b";
  const { engine, id } = replicationBoard({
    obsession: 6,
    extra: [
      { key: "web", def: printing(WEBBING_ID), owner: P1, zone: "hand" },
      { key: "b1", def: character({ name: "B1", speed: 4 }), owner: P2, zone: "play" },
      { key: "b2", def: character({ name: "B2", speed: 4 }), owner: P2, zone: "play" }
    ]
  });
  play(engine, P1, id("web"), { selected: { target: [id("b1")] } });
  assert.equal(engine.getStat(id("b1"), "speed"), 3);
  playRaw(engine, P1, id("rep"));
  resolvePendingResponses(engine);
  const pc = pending(engine);
  assert.ok(pc, "the copy's 'Pick a character' cost is satisfied anew: you are asked to pick");
  assert.equal(pc!.playerId, P1);
  const kind = pc!.kind as string;
  if (kind === "selectTargets") resolveChoice(engine, P1, { kind: "selectTargets", selected: { target: [id("b2")] } });
  else resolveChoice(engine, P1, { kind: "chooserSelectsTarget", selected: [id("b2")] });
  assert.equal(engine.getStat(id("b2"), "speed"), 3, "the copy's pick lost 1 speed");
  assert.equal(engine.getStat(id("b1"), "speed"), 3, "the original pick keeps just its own -1");
});

clause(REPLICATION, "1:rule", "duplicating Voidal Webbing makes a second -1 speed happen (the copy is not a no-op)", () => {
  const WEBBING_ID = "6f59aeec-488c-416e-8316-ec9eea404f0b";
  const { engine, id } = replicationBoard({
    obsession: 6,
    extra: [
      { key: "web", def: printing(WEBBING_ID), owner: P1, zone: "hand" },
      { key: "b1", def: character({ name: "B1", speed: 4 }), owner: P2, zone: "play" }
    ]
  });
  play(engine, P1, id("web"), { selected: { target: [id("b1")] } });
  playRaw(engine, P1, id("rep"));
  resolvePendingResponses(engine);
  if (pending(engine)) resolveChoice(engine, P1, pending(engine)!.kind === "selectTargets" ? { kind: "selectTargets", selected: { target: [id("b1")] } } : { kind: "chooserSelectsTarget", selected: [id("b1")] });
  assert.equal(engine.getStat(id("b1"), "speed"), 2, "Webbing twice on the same character: 4 - 1 - 1");
});

clause(REPLICATION, "1:rule", "a duplicated tactic with labelled options lets you choose a new option for the copy (CR 307.2)", () => {
  const modal = tactic({
    name: "Modal",
    cost: 0,
    behavior: {
      modes: [
        { label: "Draw", effects: [{ type: "draw", player: "controller", amount: 1 }] },
        { label: "Tax", effects: [{ type: "modifyInfluence", player: "opponent", amount: -1 }] }
      ]
    }
  });
  const { engine, id } = replicationBoard({ extra: [{ key: "modal", def: modal, owner: P1, zone: "hand" }] });
  play(engine, P1, id("modal"), { mode: 0 });
  const influence = influenceOf(engine, P2);
  playRaw(engine, P1, id("rep"));
  resolvePendingResponses(engine);
  const pc = pending(engine);
  assert.ok(pc, "you are asked which option the duplicate uses");
  assert.equal(pc!.playerId, P1);
  const options = (pc!.options as Array<{ label?: string }> | undefined) ?? [];
  const tax = options.findIndex((o) => /tax/i.test(o.label ?? ""));
  assert.ok(tax >= 0, "both options are offered");
  resolveChoice(engine, P1, { kind: "chooserSelectsOption", index: tax });
  assert.equal(influenceOf(engine, P2), influence - 1, "the copy used the OTHER option (Tax), not the one the original used (Draw)");
});

// =============================================================================
// Voidal Webbing
// COST: Pick a character. -- EFFECT: This turn, the character loses 1 speed.
// Tactic, cost 2, threshold [O].
// =============================================================================

const WEBBING = "6f59aeec-488c-416e-8316-ec9eea404f0b";

function webbingBoard(opts: { obsession?: number; greed?: number; extra?: CardPlacement[]; noFaceDown?: boolean; turn?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 1,
    cards: [
      { key: "web", def: printing(WEBBING), owner: P1, zone: "hand" },
      { key: "web2", def: printing(WEBBING), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 3 }), owner: P2, zone: "play" },
      { key: "slow", def: character({ name: "Slow", strength: 2, life: 3, speed: 1 }), owner: P2, zone: "play" },
      { key: "still", def: character({ name: "Still", strength: 2, life: 3, speed: 0 }), owner: P2, zone: "play" },
      { key: "twinA", def: character({ id: "twin-def", name: "Twin", speed: 3 }), owner: P2, zone: "play" },
      { key: "twinB", def: character({ id: "twin-def", name: "Twin", speed: 3 }), owner: P2, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "myLoc", def: location({ name: "MyLoc" }), owner: P1, zone: "play" },
      ...(opts.noFaceDown ? [] : [faceDownCard("faceDown", P2)]),
      { key: "handChar", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
      { key: "discChar", def: character({ name: "DiscChar" }), owner: P1, zone: "discard" },
      ...bank("obsession", opts.obsession ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const web = (engine: SpoilsEngine, id: Ids, key: string, card = "web") => play(engine, P1, id(card), { selected: { target: [id(key)] } });
const speed = (engine: SpoilsEngine, cardId: string) => engine.getStat(cardId, "speed");

for (const [key, from] of [
  ["foe", 3],
  ["mine", 3]
] as const) {
  clause(WEBBING, "0:ability", `pays 2; the picked character (${key === "foe" ? "the opponent's" : "your own"}) loses exactly 1 speed (${from} -> ${from - 1}); strength and life are unchanged`, () => {
    const { engine, id } = webbingBoard();
    const before = ready(engine);
    web(engine, id, key);
    assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid");
    assert.equal(speed(engine, id(key)), from - 1);
    assert.equal(engine.getStat(id(key), "strength"), 2);
    assert.equal(engine.getStat(id(key), "life"), 3);
    assert.equal(zoneOf(engine, id("web")), "discard");
  });
}

clause(WEBBING, "0:ability", "only the picked character is slowed: other characters, including a same-named one, keep their speed", () => {
  const { engine, id } = webbingBoard();
  web(engine, id, "twinA");
  assert.equal(speed(engine, id("twinA")), 2);
  assert.equal(speed(engine, id("twinB")), 3, "a different card with the same name is unaffected");
  for (const [key, expected] of [["mine", 3], ["foe", 3], ["slow", 1], ["still", 0]] as const) assert.equal(speed(engine, id(key)), expected, key);
});

clause(WEBBING, "0:ability", "two Webbings on one character make it lose 2 speed", () => {
  const { engine, id } = webbingBoard({ obsession: 4 });
  web(engine, id, "foe");
  web(engine, id, "foe", "web2");
  assert.equal(speed(engine, id("foe")), 1, "3 - 1 - 1");
});

clause(WEBBING, "0:ability", "a speed-1 character drops to speed 0", () => {
  const { engine, id } = webbingBoard();
  web(engine, id, "slow");
  assert.equal(speed(engine, id("slow")), 0);
});

clause(WEBBING, "0:ability", "speed cannot go below 0 (CR 410.4): a speed-0 character that loses 1 speed stays at 0", () => {
  const { engine, id } = webbingBoard();
  web(engine, id, "still");
  assert.equal(speed(engine, id("still")), 0, "0 stays 0");
  web(engine, id, "still", "web2");
  assert.equal(speed(engine, id("still")), 0, "still 0 after a second Webbing");
});

clause(WEBBING, "0:ability", "in battle a speed-0 attacker that loses 1 speed is still speed 0 and strikes together with a speed-0 blocker (both are destroyed)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "web", def: printing(WEBBING), owner: P1, zone: "hand" },
      { key: "att", def: character({ name: "Att", strength: 2, life: 2, speed: 0 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 2, life: 2, speed: 0 }), owner: P2, zone: "play" },
      ...bank("obsession", 3, P1)
    ]
  });
  declareAttackBy(engine, P1, [id("att")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
  playRaw(engine, P1, id("web"), { selected: { target: [id("att")] } });
  resolvePendingResponses(engine);
  autoResolveBattle(engine);
  assert.equal(zoneOf(engine, id("att")), "discard", "the attacker took 2 damage");
  assert.equal(zoneOf(engine, id("blk")), "discard", "speed 0 is still speed 0: the blocker assigned its damage in the same round, so it died too");
});

clause(WEBBING, "0:ability", "'this turn': the speed loss lasts until the turn ends and is gone on the next turn", () => {
  const { engine, id } = webbingBoard();
  web(engine, id, "foe");
  assert.equal(speed(engine, id("foe")), 2);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(speed(engine, id("foe")), 3, "restored when the turn ends");
  endTurn(engine, P2);
  assert.equal(speed(engine, id("foe")), 3);
});

clause(WEBBING, "0:ability", "the slowed character really acts later in battle: a speed-2 attacker slowed to 1 is hit first by a speed-2 blocker and dies before dealing damage", () => {
  const build = (webbed: boolean) =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      cards: [
        { key: "web", def: printing(WEBBING), owner: P1, zone: "hand" },
        { key: "att", def: character({ name: "Att", strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" },
        { key: "blk", def: character({ name: "Blk", strength: 2, life: 2, speed: 2 }), owner: P2, zone: "play" },
        ...bank("obsession", 3, P1)
      ]
    });
  void build;
  const control = build(false);
  declareAttackBy(control.engine, P1, [control.id("att")]);
  control.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [control.id("blk")] });
  resolvePendingResponses(control.engine);
  autoResolveBattle(control.engine);
  assert.equal(zoneOf(control.engine, control.id("att")), "discard", "control: equal speeds, both die together");
  assert.equal(zoneOf(control.engine, control.id("blk")), "discard");

  const { engine, id } = build(true);
  declareAttackBy(engine, P1, [id("att")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "P1 acts first in the window before damage");
  playRaw(engine, P1, id("web"), { selected: { target: [id("att")] } });
  resolvePendingResponses(engine);
  assert.equal(speed(engine, id("att")), 1);
  autoResolveBattle(engine);
  assert.equal(zoneOf(engine, id("att")), "discard", "the slowed attacker is destroyed first");
  assert.equal(zoneOf(engine, id("blk")), "play", "the blocker took no damage: the attacker died before it could assign any");
  assert.equal(engine.state.cards[id("blk")].damage ?? 0, 0);
});

clause(WEBBING, "0:ability", "only a CHARACTER in play can be picked: an item, a location, a faction, a resource, a face-down card, or a card outside play are refused", () => {
  const { engine, id } = webbingBoard();
  const resourceId = engine.state.players[P1].play.find((c) => engine.getDefinition(c).type === "resource")!;
  const attempt = (cardId: string) => () => playRaw(engine, P1, id("web"), { selected: { target: [cardId] } });
  assert.throws(attempt(id("myItem")), "an item");
  assert.throws(attempt(id("myLoc")), "a location");
  assert.throws(attempt(factionIdOf(engine, P1)), "your faction");
  assert.throws(attempt(factionIdOf(engine, P2)), "the opponent's faction");
  assert.throws(attempt(resourceId), "a resource");
  assert.throws(attempt(id("faceDown")), "a face-down card is only a resource");
  assert.throws(attempt(id("handChar")), "a character in hand");
  assert.throws(attempt(id("discChar")), "a character in the discard pile");
  assert.throws(() => playRaw(engine, P1, id("web"), { selected: {} }), "no pick");
  assert.throws(() => playRaw(engine, P1, id("web"), { selected: { target: [id("foe"), id("slow")] } }), "only one character");
  assert.equal(zoneOf(engine, id("web")), "hand", "a refused play leaves the tactic in hand");
  attempt(id("foe"))();
  assert.ok(engine.state.responseWindow, "a legal pick is accepted");
});

clause(WEBBING, "0:ability", "the pick is made as a cost, before the opponent responds: the speed loss only happens when the tactic resolves", () => {
  const { engine, id } = webbingBoard();
  playRaw(engine, P1, id("web"), { selected: { target: [id("foe")] } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  assert.equal(speed(engine, id("foe")), 3, "not yet");
  resolvePendingResponses(engine);
  assert.equal(speed(engine, id("foe")), 2);
});

clause(WEBBING, "0:ability", "is refused one resource short of its cost of 2, and without [O] even with enough other resources", () => {
  const short = webbingBoard({ obsession: 1, noFaceDown: true });
  assert.throws(() => playRaw(short.engine, P1, short.id("web"), { selected: { target: [short.id("foe")] } }));
  const noThreshold = webbingBoard({ obsession: 0, greed: 5, noFaceDown: true });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("web"), { selected: { target: [noThreshold.id("foe")] } }));
  const exact = webbingBoard({ obsession: 1, greed: 1, noFaceDown: true });
  web(exact.engine, exact.id, "foe");
  assert.equal(speed(exact.engine, exact.id("foe")), 2, "[O] plus a second resource is enough");
});

// =============================================================================
// Zenobia's Spyglass
// FORESIGHT -- COST: Pay X. -- EFFECT: Look at the top X+X cards of your deck
// and put them back in any order. Item, cost 0, threshold [O].
// =============================================================================

const SPYGLASS = "50279c47-609a-444f-89c9-492d97711e1e";

function spyglassBoard(opts: { zone?: "play" | "hand"; deck?: number; resources?: number; obsession?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "zs", def: printing(SPYGLASS), owner: P1, zone: opts.zone ?? "play" },
      ...Array.from({ length: opts.deck ?? 12 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
      ...Array.from({ length: 8 }, (_, i) => ({ key: `e${i}`, def: character({ name: `E${i}` }), owner: P2, zone: "deck" as const })),
      { key: "handCard", def: character({ name: "HandCard" }), owner: P1, zone: "hand" },
      ...bank("rage", opts.resources ?? 7, P1),
      ...bank("obsession", opts.obsession ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const foresight = (engine: SpoilsEngine, id: Ids, x: number) => activate(engine, P1, id("zs"), "foresight", { variables: { x } });
const foresightRaw = (engine: SpoilsEngine, id: Ids, x: number, player: Player = P1) => () => activateRaw(engine, player, id("zs"), "foresight", { variables: { x } });
const reorderOf = (engine: SpoilsEngine) => {
  const pc = pending(engine);
  assert.equal(pc?.kind, "reorderDeck", "the reorder prompt is open");
  return pc as unknown as { playerId: string; cardIds: string[]; deckOwnerId?: string; to?: string };
};

for (const x of [1, 2, 3]) {
  clause(SPYGLASS, "0:ability:foresight", `X=${x}: pays exactly ${x}, shows exactly the top ${2 * x} cards of YOUR deck, and they go back on top in the order you choose`, () => {
    const { engine, id } = spyglassBoard();
    const deck = [...deckOf(engine, P1)];
    const oppDeck = [...deckOf(engine, P2)];
    const before = ready(engine);
    foresight(engine, id, x);
    assert.equal(before - ready(engine), x, `X=${x} resources are paid`);
    const pc = reorderOf(engine);
    assert.equal(pc.playerId, P1, "you look");
    assert.deepEqual(pc.cardIds, deck.slice(0, 2 * x), `exactly the top ${2 * x} cards, top first`);
    const order = [...pc.cardIds].reverse();
    resolveChoice(engine, P1, { kind: "reorderDeck", order });
    assert.deepEqual(deckOf(engine, P1), [...order, ...deck.slice(2 * x)], "put back on top in your order; the rest untouched");
    assert.deepEqual(deckOf(engine, P2), oppDeck, "the opponent's deck is not involved");
    assert.equal(pending(engine), undefined);
  });
}

clause(SPYGLASS, "0:ability:foresight", "X=0: pays nothing and looks at no cards (X+X = 0): the deck is untouched", () => {
  const { engine, id } = spyglassBoard();
  const deck = [...deckOf(engine, P1)];
  const before = ready(engine);
  foresight(engine, id, 0);
  assert.equal(ready(engine), before, "nothing paid");
  const pc = pending(engine);
  if (pc) {
    assert.equal(pc.kind, "reorderDeck");
    assert.deepEqual((pc as unknown as { cardIds: string[] }).cardIds, [], "no cards are shown");
    resolveChoice(engine, P1, { kind: "reorderDeck", order: [] });
  }
  assert.deepEqual(deckOf(engine, P1), deck);
});

clause(SPYGLASS, "0:ability:foresight", "'any order': any arrangement of the looked-at cards is accepted, including the same order", () => {
  const { engine, id } = spyglassBoard();
  const deck = [...deckOf(engine, P1)];
  foresight(engine, id, 2);
  const [a, b, c, d] = reorderOf(engine).cardIds;
  resolveChoice(engine, P1, { kind: "reorderDeck", order: [c, a, d, b] });
  assert.deepEqual(deckOf(engine, P1).slice(0, 4), [c, a, d, b]);
  assert.deepEqual(deckOf(engine, P1).slice(4), deck.slice(4));
  const same = spyglassBoard();
  foresight(same.engine, same.id, 1);
  const kept = [...reorderOf(same.engine).cardIds];
  resolveChoice(same.engine, P1, { kind: "reorderDeck", order: kept });
  assert.deepEqual(deckOf(same.engine, P1).slice(0, 2), kept, "the same order is a legal order");
});

clause(SPYGLASS, "0:ability:foresight", "the answer must be exactly the looked-at cards: a missing card, a repeated card, a card from deeper in the deck, or from your hand is refused", () => {
  const { engine, id } = spyglassBoard();
  const deck = [...deckOf(engine, P1)];
  foresight(engine, id, 1);
  const [a, b] = reorderOf(engine).cardIds;
  const attempt = (order: string[]) => tryChoice(engine, P1, { kind: "reorderDeck", order });
  assert.throws(attempt([a]), "one card is missing");
  assert.throws(attempt([a, a]), "a card twice");
  assert.throws(attempt([a, deck[2]]), "a card from deeper in the deck");
  assert.throws(attempt([a, id("handCard")]), "a card from the hand");
  assert.throws(attempt([a, b, deck[2]]), "one card too many");
  assert.throws(attempt([]), "none at all");
  assert.equal(pending(engine)?.kind, "reorderDeck", "still waiting for a legal order");
  attempt([b, a])();
  assert.deepEqual(deckOf(engine, P1).slice(0, 2), [b, a]);
});

clause(SPYGLASS, "0:ability:foresight", "a deck shorter than X+X: you look at all of it (and pay X in full)", () => {
  const { engine, id } = spyglassBoard({ deck: 3 });
  const deck = [...deckOf(engine, P1)];
  const before = ready(engine);
  foresight(engine, id, 3);
  assert.equal(before - ready(engine), 3);
  const pc = reorderOf(engine);
  assert.deepEqual(pc.cardIds, deck, "all 3 cards, not 6");
  resolveChoice(engine, P1, { kind: "reorderDeck", order: [...deck].reverse() });
  assert.deepEqual(deckOf(engine, P1), [...deck].reverse());
});

clause(SPYGLASS, "0:ability:foresight", "an empty deck: X is still paid and there is nothing to look at", () => {
  const { engine, id } = spyglassBoard({ deck: 0 });
  const before = ready(engine);
  foresight(engine, id, 2);
  assert.equal(before - ready(engine), 2);
  drain(engine, declineAll);
  assert.equal(pending(engine), undefined);
  assert.equal(deckOf(engine, P1).length, 0);
});

clause(SPYGLASS, "0:ability:foresight", "the cost is X: refused when you cannot pay X, and then nothing is shown or paid", () => {
  const { engine, id } = spyglassBoard({ resources: 2 });
  assert.throws(foresightRaw(engine, id, 3), "X=3 with only 2 resources");
  assert.equal(pending(engine), undefined, "nothing was shown");
  assert.equal(ready(engine), 2, "nothing was paid");
  foresight(engine, id, 2);
  assert.equal(ready(engine), 0, "X=2 uses both");
  assert.equal(reorderOf(engine).cardIds.length, 4);
});

clause(SPYGLASS, "0:ability:foresight", "X must be a whole number of 0 or more: a negative or fractional X is refused", () => {
  const { engine, id } = spyglassBoard();
  assert.throws(foresightRaw(engine, id, -1), "negative");
  assert.throws(foresightRaw(engine, id, 1.5), "fractional");
  assert.equal(ready(engine), 7);
  assert.equal(pending(engine), undefined);
});

clause(SPYGLASS, "0:ability:foresight", "it does not deplete or use itself up: FORESIGHT can be used again right away, each time paying its X", () => {
  const { engine, id } = spyglassBoard();
  foresight(engine, id, 1);
  resolveChoice(engine, P1, { kind: "reorderDeck", order: [...reorderOf(engine).cardIds] });
  foresight(engine, id, 2);
  assert.equal(reorderOf(engine).cardIds.length, 4);
  assert.equal(ready(engine), 7 - 1 - 2);
  assert.equal(engine.state.cards[id("zs")].depleted, false);
});

clause(SPYGLASS, "0:ability:foresight", "only its controller can use it, and not from your hand", () => {
  const { engine, id } = spyglassBoard();
  assert.throws(foresightRaw(engine, id, 1, P2), "the opponent cannot");
  assert.equal(pending(engine), undefined);
  const inHand = spyglassBoard({ zone: "hand" });
  assert.throws(foresightRaw(inHand.engine, inHand.id, 1), "not from hand");
});

clause(SPYGLASS, "0:ability:foresight", "deploying it costs nothing but needs [O]: refused without an Obsession resource", () => {
  const without = spyglassBoard({ zone: "hand", resources: 5, obsession: 0 });
  assert.throws(() => playRaw(without.engine, P1, without.id("zs")), "no [O]");
  const withIt = spyglassBoard({ zone: "hand", resources: 0, obsession: 1 });
  const before = ready(withIt.engine);
  play(withIt.engine, P1, withIt.id("zs"));
  assert.equal(zoneOf(withIt.engine, withIt.id("zs")), "play");
  assert.equal(ready(withIt.engine), before, "cost 0: nothing paid");
});

// =============================================================================
// Amortized Straw Man
// This card enters play with 3 tokens on it.
// This card loses 1 strength and 1 life for each token on it.
// INSTALLMENT PLAN -- COST: Pay 3. -- EFFECT: Remove a token from this card.
// Character (straw man), cost 5, threshold [G][G], 6/3/6.
// =============================================================================

const STRAWMAN = "63f657b1-4396-4f46-b571-ad2258201ad7";

/** A free tactic: put `n` tokens on one chosen card in play. */
const TOKENER = (n: number) =>
  tactic({
    name: `Tokener${n}`,
    cost: 0,
    behavior: { abilities: [{ id: "tok", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "addCounter", target: { type: "selected", id: "t" }, counter: "token", amount: n }] }] }
  });

function strawBoard(opts: { zone?: "play" | "hand"; tokens?: number; damage?: number; greed?: number; rage?: number; extra?: CardPlacement[] } = {}) {
  const zone = opts.zone ?? "play";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "sm", def: printing(STRAWMAN), owner: P1, zone, counters: zone === "play" && opts.tokens ? { token: opts.tokens } : undefined, damage: opts.damage },
      { key: "ally", def: character({ name: "Ally", strength: 3, life: 3, speed: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 3, speed: 3 }), owner: P2, zone: "play" },
      { key: "tok1", def: TOKENER(1), owner: P1, zone: "hand" },
      { key: "tok2", def: TOKENER(2), owner: P1, zone: "hand" },
      { key: "tok3", def: TOKENER(3), owner: P1, zone: "hand" },
      { key: "bounce", def: BOUNCER(), owner: P1, zone: "hand" },
      { key: "putter", def: PUTTER(), owner: P1, zone: "hand" },
      ...bank("greed", opts.greed ?? 0, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const smStats = (engine: SpoilsEngine, cardId: string) => [engine.getStat(cardId, "strength"), engine.getStat(cardId, "life"), engine.getStat(cardId, "speed")];

clause(STRAWMAN, "0:rule", "deploying it costs 5; it enters play with exactly 3 tokens on it, and nothing else gets a token", () => {
  const { engine, id } = strawBoard({ zone: "hand", greed: 5 });
  const before = ready(engine);
  play(engine, P1, id("sm"));
  assert.equal(zoneOf(engine, id("sm")), "play");
  assert.equal(before - ready(engine), 5, "the printed cost of 5 is paid");
  assert.equal(tokens(engine, id("sm")), 3, "exactly 3 tokens");
  assert.equal(tokens(engine, id("ally")), 0);
  assert.equal(tokens(engine, id("foe")), 0);
});

clause(STRAWMAN, "0:rule", "it also gets its 3 tokens when it is put into play by an effect rather than deployed", () => {
  const { engine, id } = strawBoard({ zone: "hand" });
  play(engine, P1, id("putter"), { selected: { t: [id("sm")] } });
  assert.equal(zoneOf(engine, id("sm")), "play");
  assert.equal(tokens(engine, id("sm")), 3);
});

clause(STRAWMAN, "0:rule", "a Straw Man that is simply in play with no tokens placed has none: the tokens come from entering play", () => {
  const { engine, id } = strawBoard({ zone: "play" });
  assert.equal(tokens(engine, id("sm")), 0);
});

clause(STRAWMAN, "0:rule", "a Straw Man that left play and is deployed again enters with exactly 3 tokens, not its old tokens plus 3", () => {
  const { engine, id } = strawBoard({ tokens: 1, greed: 5 });
  play(engine, P1, id("bounce"), { selected: { t: [id("sm")] } });
  assert.equal(zoneOf(engine, id("sm")), "hand");
  play(engine, P1, id("sm"));
  assert.equal(zoneOf(engine, id("sm")), "play");
  assert.equal(tokens(engine, id("sm")), 3, "tokens disappear when a card leaves play (CR 409.2), so it starts again from 3");
});

clause(STRAWMAN, "0:rule", "deploying is refused one resource short of 5, and without [G][G] even with enough other resources", () => {
  const short = strawBoard({ zone: "hand", greed: 4 });
  assert.throws(() => playRaw(short.engine, P1, short.id("sm")));
  const oneGreed = strawBoard({ zone: "hand", greed: 1, rage: 6 });
  assert.throws(() => playRaw(oneGreed.engine, P1, oneGreed.id("sm")), "only one [G]");
  const exact = strawBoard({ zone: "hand", greed: 2, rage: 3 });
  play(exact.engine, P1, exact.id("sm"));
  assert.equal(zoneOf(exact.engine, exact.id("sm")), "play", "[G][G] plus three other resources is enough");
});

for (const n of [0, 1, 2, 3, 4, 5]) {
  clause(STRAWMAN, "1:rule", `with ${n} token${n === 1 ? "" : "s"} it has strength ${6 - n}, life ${6 - n} and its printed speed 3`, () => {
    const { engine, id } = strawBoard({ tokens: n });
    assert.deepEqual(smStats(engine, id("sm")), [6 - n, 6 - n, 3]);
  });
}

clause(STRAWMAN, "1:rule", "the printed stats are 6/3/6 (strength / speed / life) with no tokens", () => {
  const { engine, id } = strawBoard();
  assert.equal(printing(STRAWMAN).strength, 6);
  assert.equal(printing(STRAWMAN).speed, 3);
  assert.equal(printing(STRAWMAN).life, 6);
  assert.deepEqual(smStats(engine, id("sm")), [6, 6, 3]);
});

clause(STRAWMAN, "1:rule", "only THIS card shrinks: other characters are unchanged, and tokens on other cards do not shrink it", () => {
  const { engine, id } = strawBoard({ tokens: 3, extra: [] });
  assert.deepEqual(smStats(engine, id("ally")), [3, 3, 3]);
  assert.deepEqual(smStats(engine, id("foe")), [3, 3, 3]);
  const other = strawBoard({ tokens: 0 });
  other.engine.state.cards[other.id("ally")].counters = { token: 4 };
  assert.deepEqual(smStats(other.engine, other.id("sm")), [6, 6, 3], "tokens on the Ally do not matter");
});

clause(STRAWMAN, "1:rule", "adding tokens shrinks it live: +1 token on a 3-token Straw Man makes it 2/2; removing them restores it", () => {
  const { engine, id } = strawBoard({ tokens: 3 });
  play(engine, P1, id("tok1"), { selected: { t: [id("sm")] } });
  assert.equal(tokens(engine, id("sm")), 4);
  assert.deepEqual(smStats(engine, id("sm")), [2, 2, 3]);
});

clause(STRAWMAN, "1:rule", "at 5 tokens it is a living 1/1", () => {
  const five = strawBoard({ tokens: 3 });
  play(five.engine, P1, five.id("tok2"), { selected: { t: [five.id("sm")] } });
  assert.equal(zoneOf(five.engine, five.id("sm")), "play", "5 tokens: 1 life, alive");
  assert.deepEqual(smStats(five.engine, five.id("sm")), [1, 1, 3]);
});

clause(STRAWMAN, "1:rule", "at 6 tokens its life is 0 and it is destroyed at once (FAQ: a character with 0 life is destroyed)", () => {
  const { engine, id } = strawBoard({ tokens: 3 });
  assert.equal(tokens(engine, id("sm")), 3);
  play(engine, P1, id("tok3"), { selected: { t: [id("sm")] } });
  assert.equal(zoneOf(engine, id("sm")), "discard", "6 tokens: 0 life, 0 damage: damage is equal to life, so it is destroyed");
});

clause(STRAWMAN, "1:rule", "at 7 tokens its life is below 0 and it is destroyed", () => {
  const { engine, id } = strawBoard({ tokens: 4 });
  assert.equal(engine.getStat(id("sm"), "life"), 2, "4 tokens: life 2, still alive");
  play(engine, P1, id("tok3"), { selected: { t: [id("sm")] } });
  assert.equal(zoneOf(engine, id("sm")), "discard", "7 tokens: life -1, destroyed");
});

clause(STRAWMAN, "1:rule", "damage already on it matters when its life shrinks: 2 damage and 4 tokens (life 2) destroys it, 2 damage and 3 tokens (life 3) does not", () => {
  const alive = strawBoard({ tokens: 3, damage: 2 });
  assert.equal(alive.engine.getStat(alive.id("sm"), "life"), 3);
  play(alive.engine, P1, alive.id("tok1"), { selected: { t: [alive.id("ally")] } });
  assert.equal(zoneOf(alive.engine, alive.id("sm")), "play", "life 3 > 2 damage");
  const dies = strawBoard({ tokens: 3, damage: 2 });
  play(dies.engine, P1, dies.id("tok1"), { selected: { t: [dies.id("sm")] } });
  assert.equal(zoneOf(dies.engine, dies.id("sm")), "discard", "life 2 <= 2 damage");
});

clause(STRAWMAN, "2:ability:installment", "INSTALLMENT PLAN pays exactly 3 resources and removes exactly one token (3 -> 2), so the Straw Man grows from 3/3 to 4/4", () => {
  const { engine, id } = strawBoard({ tokens: 3, rage: 4 });
  const before = ready(engine);
  assert.deepEqual(smStats(engine, id("sm")), [3, 3, 3]);
  activate(engine, P1, id("sm"), "installment");
  assert.equal(before - ready(engine), 3, "COST: Pay 3");
  assert.equal(tokens(engine, id("sm")), 2, "EFFECT: a token is removed");
  assert.deepEqual(smStats(engine, id("sm")), [4, 4, 3]);
  assert.equal(engine.state.cards[id("sm")].depleted, false, "it does not deplete");
});

clause(STRAWMAN, "2:ability:installment", "it can be used again, paying 3 each time, until the tokens are gone: 6/6 with none left", () => {
  const { engine, id } = strawBoard({ tokens: 3, rage: 9 });
  for (const [left, stats] of [
    [2, [4, 4, 3]],
    [1, [5, 5, 3]],
    [0, [6, 6, 3]]
  ] as const) {
    const before = ready(engine);
    activate(engine, P1, id("sm"), "installment");
    assert.equal(before - ready(engine), 3);
    assert.equal(tokens(engine, id("sm")), left);
    assert.deepEqual(smStats(engine, id("sm")), stats);
  }
});

clause(STRAWMAN, "2:ability:installment", "'Remove a token' is the EFFECT, not a cost: with no tokens left it can still be used, pays 3, and the token count stays at 0", () => {
  const { engine, id } = strawBoard({ tokens: 0, rage: 3 });
  activate(engine, P1, id("sm"), "installment");
  assert.equal(ready(engine), 0, "the 3 were paid");
  assert.equal(tokens(engine, id("sm")), 0, "no negative tokens");
  assert.deepEqual(smStats(engine, id("sm")), [6, 6, 3]);
});

clause(STRAWMAN, "2:ability:installment", "it removes a token from THIS card only: other cards keep their tokens", () => {
  const { engine, id } = strawBoard({ tokens: 3, rage: 3 });
  engine.state.cards[id("ally")].counters = { token: 2 };
  activate(engine, P1, id("sm"), "installment");
  assert.equal(tokens(engine, id("ally")), 2);
  assert.equal(tokens(engine, id("sm")), 2);
});

clause(STRAWMAN, "2:ability:installment", "is refused with fewer than 3 resources (nothing paid, no token removed), allowed with exactly 3 of any kind (no icon requirement)", () => {
  const short = strawBoard({ tokens: 3, rage: 2 });
  assert.throws(() => activateRaw(short.engine, P1, short.id("sm"), "installment"));
  assert.equal(tokens(short.engine, short.id("sm")), 3);
  assert.equal(ready(short.engine), 2);
  const mixed = strawBoard({ tokens: 3, rage: 1, greed: 1, extra: [faceDownCard("fd", P1)] });
  activate(mixed.engine, P1, mixed.id("sm"), "installment");
  assert.equal(tokens(mixed.engine, mixed.id("sm")), 2, "rage + greed + a face-down resource pay for it");
});

clause(STRAWMAN, "2:ability:installment", "only its controller can use it, and not from your hand", () => {
  const { engine, id } = strawBoard({ tokens: 3, rage: 3 });
  assert.throws(() => activateRaw(engine, P2, id("sm"), "installment"), "the opponent cannot");
  assert.equal(tokens(engine, id("sm")), 3);
  const inHand = strawBoard({ zone: "hand", rage: 3 });
  assert.throws(() => activateRaw(inHand.engine, P1, inHand.id("sm"), "installment"), "not from hand");
});

clause(STRAWMAN, "2:ability:installment", "usable the turn it enters play: deploy it, then remove a token the same turn", () => {
  const { engine, id } = strawBoard({ zone: "hand", greed: 5, rage: 3 });
  play(engine, P1, id("sm"));
  activate(engine, P1, id("sm"), "installment");
  assert.equal(tokens(engine, id("sm")), 2);
});

// =============================================================================
// Armored Keep
// UNIQUE ARMORED KEEP. You may play this card whenever you could play a tactic.
// You do not lose the game when your faction has 0 influence.
// Location, cost 6, threshold [G][G][G], structure 5.
// =============================================================================

const KEEP = "43d085ab-5643-4038-8bd2-526548fd786e";
const TACTICIAN_VACATION = "5ca25182-e910-4f21-97d0-b30298e7d4af";

function keepBoard(opts: { keep?: "hand" | "play"; keepController?: Player; active?: Player; greed?: number; p1Influence?: number; p2Influence?: number; extra?: CardPlacement[] } = {}) {
  const active = opts.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction(), influence: opts.p1Influence },
    playerB: { faction: developFaction(), influence: opts.p2Influence },
    turn: active === P1 ? 1 : 2,
    activePlayerId: active,
    cards: [
      { key: "keep", def: printing(KEEP), owner: P1, controller: opts.keepController, zone: opts.keep ?? "hand" },
      { key: "keep2", def: printing(KEEP), owner: P1, zone: "hand" },
      { key: "oppKeep", def: printing(KEEP), owner: P2, zone: "hand" },
      { key: "widget", def: item({ name: "Widget", cost: 0 }), owner: P1, zone: "hand" },
      { key: "widget2", def: item({ name: "Widget2", cost: 0 }), owner: P1, zone: "hand" },
      { key: "killer", def: KILLER(), owner: P1, zone: "hand" },
      { key: "plainLoc", def: location({ name: "PlainLoc", cost: 0, structure: 3 }), owner: P1, zone: "hand" },
      { key: "a1", def: character({ name: "A1", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "a2", def: character({ name: "A2", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "b1", def: character({ name: "B1", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "theirTac", def: CANTRIP("TheirCantrip"), owner: P2, zone: "hand" },
      { key: "d0", def: character({ name: "D0" }), owner: P2, zone: "deck" },
      ...bank("greed", opts.greed ?? 6, P1),
      ...bank("rage", 4, P2),
      ...(opts.extra ?? [])
    ]
  });
}

// --- 0:unique

clause(KEEP, "0:unique", "playing a second Keep forces you to choose which one to keep; keeping the new one destroys the old", () => {
  const { engine, id } = keepBoard({ keep: "play", greed: 6 });
  play(engine, P1, id("keep2"));
  const pc = pending(engine)!;
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses which copy to keep");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [id("keep"), id("keep2")].sort());
  resolveChoice(engine, P1, { kind: "uniqueSurvivor", keep: id("keep2") });
  assert.equal(zoneOf(engine, id("keep2")), "play");
  assert.equal(zoneOf(engine, id("keep")), "discard", "the other copy is destroyed");
  assert.equal(pending(engine), undefined);
});

clause(KEEP, "0:unique", "keeping the old Keep destroys the new one", () => {
  const { engine, id } = keepBoard({ keep: "play", greed: 6 });
  play(engine, P1, id("keep2"));
  resolveChoice(engine, P1, { kind: "uniqueSurvivor", keep: id("keep") });
  assert.equal(zoneOf(engine, id("keep")), "play");
  assert.equal(zoneOf(engine, id("keep2")), "discard");
});

clause(KEEP, "0:unique", "only YOUR copies count: the opponent may control their own Keep with no choice and no destruction (FAQ)", () => {
  const { engine, id } = keepBoard({ keep: "play", active: P2, greed: 0, extra: [...bank("greed", 6, P2)] });
  play(engine, P2, id("oppKeep"));
  assert.equal(pending(engine), undefined, "no choice is forced");
  assert.equal(zoneOf(engine, id("keep")), "play");
  assert.equal(zoneOf(engine, id("oppKeep")), "play");
});

const stealTactic = () =>
  tactic({
    name: "Steal",
    cost: 0,
    behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location", controller: "opponent" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });

clause(KEEP, "0:unique", "taking control of the opponent's Keep while you control one forces you to choose (a stolen copy counts as yours); the one not kept is destroyed", () => {
  const { engine, id } = keepBoard({ keep: "play", extra: [{ key: "oppPlayKeep", def: printing(KEEP), owner: P2, zone: "play" }, { key: "steal", def: stealTactic(), owner: P1, zone: "hand" }] });
  playRaw(engine, P1, id("steal"), { selected: { t: [id("oppPlayKeep")] } });
  resolvePendingResponses(engine);
  const pc = pending(engine);
  assert.equal(pc?.kind, "uniqueSurvivor", "two Keeps under one player's control");
  assert.equal(pc?.playerId, P1);
  assert.deepEqual([...(pc!.candidates as string[])].sort(), [id("keep"), id("oppPlayKeep")].sort());
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("keep") } } as never);
  assert.equal(zoneOf(engine, id("oppPlayKeep")), "discard", "the stolen copy was not kept: destroyed into its owner's discard pile");
  assert.equal(discardOf(engine, P2).includes(id("oppPlayKeep")), true);
  assert.equal(zoneOf(engine, id("keep")), "play");
});

clause(KEEP, "0:unique", "after the Unique choice forced by a tactic that took control of the opponent's Keep, the tactic finishes resolving and the game carries on", () => {
  const { engine, id } = keepBoard({ keep: "play", extra: [{ key: "oppPlayKeep", def: printing(KEEP), owner: P2, zone: "play" }, { key: "steal", def: stealTactic(), owner: P1, zone: "hand" }] });
  playRaw(engine, P1, id("steal"), { selected: { t: [id("oppPlayKeep")] } });
  resolvePendingResponses(engine);
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("keep") } } as never);
  for (let i = 0; i < 5 && engine.state.responseWindow; i++) {
    const w = engine.state.responseWindow;
    if (w.phase === "acceptingResponses") engine.perform({ type: "passPriority", playerId: w.priorityPlayerId });
    else engine.perform({ type: "advanceFlow" });
  }
  assert.equal(engine.state.responseWindow, undefined, "the response window closes");
  assert.equal(zoneOf(engine, id("steal")), "discard", "the Steal tactic is finished and in its owner's discard pile");
  play(engine, P1, id("widget"));
  assert.equal(zoneOf(engine, id("widget")), "play", "and you can keep playing");
});

clause(KEEP, "0:unique", "deploys for 6 with [G][G][G] (refused one resource short, or one [G] short) and has structure 5", () => {
  const short = keepBoard({ greed: 5 });
  assert.throws(() => playRaw(short.engine, P1, short.id("keep")));
  const noThreshold = keepBoard({ greed: 2, extra: [...bank("rage", 6, P1)] });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("keep")), "only two [G]");
  const exact = keepBoard({ greed: 3, extra: [...bank("rage", 3, P1)] });
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("keep"));
  assert.equal(zoneOf(exact.engine, exact.id("keep")), "play");
  assert.equal(before - ready(exact.engine), 6, "the printed cost of 6 is paid");
  assert.equal(exact.engine.getStat(exact.id("keep"), "structure"), 5);
});

// --- 1:rule: "You may play this card whenever you could play a tactic."

/** P2 (active) attacks P1; P2 passes; P1 now has priority in the battle's response window. */
function opponentAttackWindow(engine: SpoilsEngine, id: Ids) {
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("b1")], target: { type: "faction", playerId: P1 } });
  assert.ok(engine.state.responseWindow, "the attack opens a response window");
  while (engine.state.responseWindow && engine.state.responseWindow.priorityPlayerId !== P1) {
    engine.perform({ type: "passPriority", playerId: engine.state.responseWindow.priorityPlayerId });
  }
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "P1 may respond");
}

clause(KEEP, "1:rule", "it can be played on your own turn like any location", () => {
  const { engine, id } = keepBoard();
  play(engine, P1, id("keep"));
  assert.equal(zoneOf(engine, id("keep")), "play");
});

clause(KEEP, "1:rule", "it can be played in response to the opponent's attack on THEIR turn, and enters play as a location (not the discard pile)", () => {
  const { engine, id } = keepBoard({ active: P2 });
  opponentAttackWindow(engine, id);
  playRaw(engine, P1, id("keep"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("keep")), "play", "a Tactical location resolves into play, not into the discard pile");
  assert.equal(engine.state.cards[id("keep")].controllerId, P1);
  assert.equal(engine.getStat(id("keep"), "structure"), 5);
});

clause(KEEP, "1:rule", "it can be played in response to the opponent's tactic, and resolves (into play) before that tactic does", () => {
  const { engine, id } = keepBoard({ active: P2 });
  const p2Hand = handOf(engine, P2).length;
  playRaw(engine, P2, id("theirTac"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(engine, P1, id("keep"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("keep")), "play");
  assert.equal(zoneOf(engine, id("theirTac")), "discard", "the opponent's tactic resolved afterwards");
  assert.equal(handOf(engine, P2).length, p2Hand - 1 + 1, "and its draw happened");
});

clause(KEEP, "1:rule", "it can be played in response to the opponent announcing the end of their turn", () => {
  const { engine, id } = keepBoard({ active: P2 });
  engine.perform({ type: "endTurn", playerId: P2 });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "P1 may respond to the end-of-turn announcement");
  playRaw(engine, P1, id("keep"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("keep")), "play");
});

clause(KEEP, "1:rule", "control: an ordinary location cannot be played in those windows", () => {
  const { engine, id } = keepBoard({ active: P2 });
  assert.throws(() => playRaw(engine, P1, id("plainLoc")), "no window at all on the opponent's turn");
  opponentAttackWindow(engine, id);
  assert.throws(() => playRaw(engine, P1, id("plainLoc")), "an ordinary location cannot be played in response to an attack");
  assert.equal(zoneOf(engine, id("plainLoc")), "hand");
});

clause(KEEP, "1:rule", "it cannot be played on the opponent's turn when there is nothing to respond to (no moment a tactic could be played)", () => {
  const { engine, id } = keepBoard({ active: P2 });
  assert.throws(() => playRaw(engine, P1, id("keep")));
  assert.equal(zoneOf(engine, id("keep")), "hand");
});

clause(KEEP, "1:rule", "the Keep is played whenever you could play a tactic: its 6 cost and [G][G][G] still apply in response", () => {
  const poor = keepBoard({ active: P2, greed: 5 });
  opponentAttackWindow(poor.engine, poor.id);
  assert.throws(() => playRaw(poor.engine, P1, poor.id("keep")), "one resource short");
  const rich = keepBoard({ active: P2, greed: 6 });
  opponentAttackWindow(rich.engine, rich.id);
  const before = ready(rich.engine);
  playRaw(rich.engine, P1, rich.id("keep"));
  resolvePendingResponses(rich.engine);
  assert.equal(before - ready(rich.engine), 6);
});

clause(KEEP, "1:rule", "Tactician Vacation closes the window for the whole turn, including cards that can be played 'whenever you could play a tactic' (FAQ): the Keep cannot be played in response to the opponent's attack", () => {
  const { engine, id } = keepBoard({ active: P2, extra: [{ key: "vacation", def: printing(TACTICIAN_VACATION), owner: P2, zone: "hand" }] });
  playRaw(engine, P2, id("vacation"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("vacation")), "discard");
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("b1")], target: { type: "faction", playerId: P1 } });
  while (engine.state.responseWindow && engine.state.responseWindow.priorityPlayerId !== P1) {
    engine.perform({ type: "passPriority", playerId: engine.state.responseWindow.priorityPlayerId });
  }
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "P1 has priority in the battle window");
  assert.throws(() => playRaw(engine, P1, id("killer"), { selected: { t: [id("b1")] } }), "control: a real tactic cannot be played after Tactician Vacation");
  assert.throws(() => playRaw(engine, P1, id("keep")), "the tactic window is closed for the turn, so the Keep cannot be played either");
  assert.equal(zoneOf(engine, id("keep")), "hand");
});

clause(KEEP, "1:rule", "...but after Tactician Vacation it can still be played when it normally could be: on your own turn", () => {
  const { engine, id } = keepBoard({ extra: [{ key: "vacation", def: printing(TACTICIAN_VACATION), owner: P1, zone: "hand" }, ...bank("rage", 4, P1)] });
  play(engine, P1, id("vacation"));
  assert.equal(zoneOf(engine, id("vacation")), "discard");
  play(engine, P1, id("keep"));
  assert.equal(zoneOf(engine, id("keep")), "play", "a location can still be played on your own turn");
});

// --- 2:rule: "You do not lose the game when your faction has 0 influence."

/** Triggers a state-based check by taking an ordinary free action. */
const poke = (engine: SpoilsEngine, id: Ids) => play(engine, P1, id("widget"));

clause(KEEP, "2:rule", "with a Keep in play you do not lose at 0 influence: the game goes on and you can keep acting", () => {
  const { engine, id } = keepBoard({ keep: "play", p1Influence: 0 });
  poke(engine, id);
  assert.equal(engine.state.winner ?? null, null, "no winner");
  assert.equal(engine.state.players[P1].influence, 0);
  play(engine, P1, id("widget2"));
  assert.equal(zoneOf(engine, id("widget2")), "play", "you can still act");
});

clause(KEEP, "2:rule", "control: without the Keep you lose at 0 influence", () => {
  const { engine, id } = keepBoard({ keep: "hand", p1Influence: 0 });
  poke(engine, id);
  assert.equal(engine.state.winner, P2);
});

clause(KEEP, "2:rule", "the protection ends when the Keep leaves play: at 0 influence, destroying the Keep loses you the game", () => {
  const raze = tactic({
    name: "RazeIt",
    cost: 0,
    behavior: { abilities: [{ id: "r", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = keepBoard({ keep: "play", p1Influence: 0, extra: [{ key: "raze", def: raze, owner: P1, zone: "hand" }] });
  poke(engine, id);
  assert.equal(engine.state.winner ?? null, null, "protected while the Keep stands");
  play(engine, P1, id("raze"), { selected: { t: [id("keep")] } });
  assert.equal(zoneOf(engine, id("keep")), "discard");
  assert.equal(engine.state.winner, P2, "no Keep, 0 influence: you lose");
});

clause(KEEP, "2:rule", "the protection starts when the Keep enters play: a faction already at 0 influence is only saved once the Keep is in play", () => {
  // A faction cannot sit at 0 influence with the Keep still in hand (it would have lost already), so the board starts at 1.
  const { engine, id } = keepBoard({ keep: "hand", p1Influence: 1 });
  playRaw(engine, P1, id("keep"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("keep")), "play");
  engine.state.players[P1].influence = 0;
  poke(engine, id);
  assert.equal(engine.state.winner ?? null, null, "at 0 influence with the Keep in play you stay in the game");
});

clause(KEEP, "2:rule", "the Keep protects ITS CONTROLLER only: the opponent's faction at 0 influence still loses, even while you control a Keep", () => {
  const { engine, id } = keepBoard({ keep: "play", p2Influence: 0 });
  poke(engine, id);
  assert.equal(engine.state.winner, P1, "the opponent (no Keep) loses at 0 influence");
});

clause(KEEP, "2:rule", "both factions at 0 influence but only you have a Keep: the opponent loses and you win (not a draw)", () => {
  const { engine, id } = keepBoard({ keep: "play", p1Influence: 0, p2Influence: 0 });
  poke(engine, id);
  assert.equal(engine.state.winner, P1);
});

clause(KEEP, "2:rule", "a Keep controlled by the opponent protects them, not its owner: the owner at 0 influence loses", () => {
  const { engine, id } = keepBoard({ keep: "play", keepController: P2, p1Influence: 0 });
  poke(engine, id);
  assert.equal(engine.state.winner, P2, "P1 owns the Keep but P2 controls it, so P1 is unprotected");
});

clause(KEEP, "2:rule", "damage that takes your faction to 0 influence does not lose you the game while you control the Keep (and does lose it without)", () => {
  const build = (withKeep: boolean) =>
    buildGame({
      playerA: { faction: developFaction(), influence: 2 },
      playerB: { faction: developFaction() },
      turn: 2,
      activePlayerId: P2,
      cards: [
        { key: "keep", def: printing(KEEP), owner: P1, zone: withKeep ? "play" : "hand" },
        { key: "att", def: character({ name: "Att", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" }
      ]
    });
  for (const withKeep of [true, false]) {
    const { engine, id } = build(withKeep);
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("att")], target: { type: "faction", playerId: P1 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
    autoResolveBattle(engine);
    assert.ok(engine.state.players[P1].influence <= 0, "the attack took the faction to 0");
    if (withKeep) assert.equal(engine.state.winner ?? null, null, "Keep: still in the game");
    else assert.equal(engine.state.winner, P2, "no Keep: lost");
  }
});

// =============================================================================
// Beatrix Winterbottom
// UNIQUE BEATRIX. If you draw any number of cards, increase the amount by 1.
// While you have at least 10 cards in your hand, if you would draw a card
// instead you don't draw that card.
// Character (mau), cost 5, threshold [G][G][G].
// =============================================================================

const BEATRIX = "bb64ac1b-8361-475a-8598-0dd67ce6222b";

const DRAW_N = (n: number, name = `Draw${n}`) =>
  tactic({ name, cost: 0, behavior: { abilities: [{ id: "d", type: "activated", effects: [{ type: "draw", player: "controller", amount: n }] }] } });
const DRAW_THREE_SEPARATELY = () =>
  tactic({
    name: "ThreeSingles",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "t",
          type: "activated",
          effects: [
            { type: "draw", player: "controller", amount: 1 },
            { type: "draw", player: "controller", amount: 1 },
            { type: "draw", player: "controller", amount: 1 }
          ]
        }
      ]
    }
  });
/** A free tactic: put a card of your deck into your hand without drawing it (a search). */
const TUTOR = () =>
  tactic({
    name: "Tutor",
    cost: 0,
    behavior: { abilities: [{ id: "tu", type: "activated", targets: [{ id: "t", selector: { owner: "self", zone: "deck" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });

/**
 * `hand` is the TOTAL size of P1's hand; `tactics` names the special cards (c1/c2/c3/c0/triple/tutor/killer/bw2) in it, the rest is filler characters
 * (cost 0). P2's hand is `oppHand` cards, `oppTactics` of which are special (oc1 = a Draw-1 tactic, oppBw = a Beatrix).
 */
function beatrixBoard(opts: { bw?: "play" | "hand"; bwController?: Player; hand?: number; tactics?: string[]; oppHand?: number; oppTactics?: string[]; deck?: number; oppDeck?: number; greed?: number; active?: Player; extra?: CardPlacement[] } = {}) {
  const active = opts.active ?? P1;
  const special: Record<string, Def> = {
    c1: DRAW_N(1, "Draw1"),
    c2: DRAW_N(2),
    c3: DRAW_N(3),
    c0: DRAW_N(0),
    triple: DRAW_THREE_SEPARATELY(),
    tutor: TUTOR(),
    killer: KILLER(),
    bw2: printing(BEATRIX)
  };
  const tactics = opts.tactics ?? [];
  const bwInHand = (opts.bw ?? "play") === "hand";
  const handSize = opts.hand ?? 3;
  const filler = handSize - tactics.length - (bwInHand ? 1 : 0);
  assert.ok(filler >= 0, "hand size too small for the requested cards");
  const oppTactics = opts.oppTactics ?? ["oc1"];
  const oppSpecial: Record<string, Def> = { oc1: DRAW_N(1, "OppDraw1"), oppBw: printing(BEATRIX) };
  const oppFiller = (opts.oppHand ?? 3) - oppTactics.length;
  assert.ok(oppFiller >= 0, "oppFiller >= 0");
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: active === P1 ? 1 : 2,
    activePlayerId: active,
    cards: [
      { key: "bw", def: printing(BEATRIX), owner: P1, controller: opts.bwController, zone: opts.bw ?? "play" },
      ...tactics.map((key) => ({ key, def: special[key], owner: P1, zone: "hand" as const })),
      ...Array.from({ length: filler }, (_, i) => ({ key: `h${i}`, def: character({ name: `H${i}`, cost: 0 }), owner: P1, zone: "hand" as const })),
      ...oppTactics.map((key) => ({ key, def: oppSpecial[key], owner: P2, zone: "hand" as const })),
      ...Array.from({ length: oppFiller }, (_, i) => ({ key: `o${i}`, def: character({ name: `O${i}`, cost: 0 }), owner: P2, zone: "hand" as const })),
      ...Array.from({ length: opts.deck ?? 12 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
      ...Array.from({ length: opts.oppDeck ?? 12 }, (_, i) => ({ key: `e${i}`, def: character({ name: `E${i}` }), owner: P2, zone: "deck" as const })),
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

/** The top `n` cards of `player`'s deck. */
const topOf = (engine: SpoilsEngine, player: Player, n: number) => deckOf(engine, player).slice(0, n);

// --- 0:unique

clause(BEATRIX, "0:unique", "playing a second Beatrix forces you to choose which one to keep; the other is destroyed", () => {
  const { engine, id } = beatrixBoard({ greed: 5, tactics: ["bw2"], hand: 1 });
  play(engine, P1, id("bw2"));
  const pc = pending(engine)!;
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...(pc.candidates as string[])].sort(), [id("bw"), id("bw2")].sort());
  resolveChoice(engine, P1, { kind: "uniqueSurvivor", keep: id("bw2") });
  assert.equal(zoneOf(engine, id("bw2")), "play");
  assert.equal(zoneOf(engine, id("bw")), "discard");
  const old = beatrixBoard({ greed: 5, tactics: ["bw2"], hand: 1 });
  play(old.engine, P1, old.id("bw2"));
  resolveChoice(old.engine, P1, { kind: "uniqueSurvivor", keep: old.id("bw") });
  assert.equal(zoneOf(old.engine, old.id("bw")), "play");
  assert.equal(zoneOf(old.engine, old.id("bw2")), "discard", "keeping the old copy destroys the new one");
});

clause(BEATRIX, "0:unique", "only YOUR copies count: the opponent may have their own Beatrix with no choice (FAQ)", () => {
  const { engine, id } = beatrixBoard({ active: P2, oppTactics: ["oppBw"], oppHand: 1, extra: [...bank("greed", 5, P2)] });
  play(engine, P2, id("oppBw"));
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("bw")), "play");
  assert.equal(zoneOf(engine, id("oppBw")), "play");
});

clause(BEATRIX, "0:unique", "deploys for 5 with [G][G][G] (refused one resource short, or one [G] short); printed stats in play", () => {
  const short = beatrixBoard({ bw: "hand", greed: 4 });
  assert.throws(() => playRaw(short.engine, P1, short.id("bw")));
  const noThreshold = beatrixBoard({ bw: "hand", greed: 2, extra: [...bank("rage", 6, P1)] });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("bw")), "only two [G]");
  const exact = beatrixBoard({ bw: "hand", greed: 3, extra: [...bank("rage", 2, P1)] });
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("bw"));
  assert.equal(zoneOf(exact.engine, exact.id("bw")), "play");
  assert.equal(before - ready(exact.engine), 5, "the printed cost of 5 is paid");
  assert.equal(exact.engine.getStat(exact.id("bw"), "strength"), printing(BEATRIX).strength);
  assert.equal(exact.engine.getStat(exact.id("bw"), "speed"), printing(BEATRIX).speed);
  assert.equal(exact.engine.getStat(exact.id("bw"), "life"), printing(BEATRIX).life);
});

// --- 1:rule: "If you draw any number of cards, increase the amount by 1."

clause(BEATRIX, "1:rule", "the Develop Rule draw (1 card) draws 2 cards: the top two of your deck", () => {
  const { engine } = beatrixBoard();
  const top = topOf(engine, P1, 2);
  const hand = handOf(engine, P1).length;
  developDraw(engine, P1);
  assert.equal(handOf(engine, P1).length, hand + 2);
  for (const card of top) assert.equal(zoneOf(engine, card), "hand");
  assert.equal(deckOf(engine, P1).length, 10);
});

for (const [card, n] of [
  ["c1", 1],
  ["c2", 2],
  ["c3", 3]
] as const) {
  clause(BEATRIX, "1:rule", `a card that draws ${n} makes you draw ${n + 1}`, () => {
    const { engine, id } = beatrixBoard({ tactics: [card], hand: 3 });
    const top = topOf(engine, P1, n + 1);
    const hand = handOf(engine, P1).length;
    play(engine, P1, id(card));
    assert.equal(handOf(engine, P1).length, hand - 1 + n + 1, `the tactic left, ${n + 1} cards arrived`);
    for (const c of top) assert.equal(zoneOf(engine, c), "hand");
    assert.equal(deckOf(engine, P1).length, 12 - (n + 1), "no more than that");
  });
}

clause(BEATRIX, "1:rule", "a draw of 0 cards is not 'drawing any number of cards': it stays 0", () => {
  const { engine, id } = beatrixBoard({ tactics: ["c0"], hand: 3 });
  const hand = handOf(engine, P1).length;
  play(engine, P1, id("c0"));
  assert.equal(handOf(engine, P1).length, hand - 1, "nothing drawn");
  assert.equal(deckOf(engine, P1).length, 12);
});

clause(BEATRIX, "1:rule", "each separate 'draw a card' instruction is increased on its own (FAQ): three separate draws of 1 give 6 cards, not 4", () => {
  const { engine, id } = beatrixBoard({ tactics: ["triple"], hand: 3 });
  const hand = handOf(engine, P1).length;
  play(engine, P1, id("triple"));
  assert.equal(handOf(engine, P1).length, hand - 1 + 6);
  assert.equal(deckOf(engine, P1).length, 6);
});

clause(BEATRIX, "1:rule", "only YOUR draws: the opponent's draws are not increased", () => {
  const { engine, id } = beatrixBoard({ active: P2 });
  const hand = handOf(engine, P2).length;
  play(engine, P2, id("oc1"));
  assert.equal(handOf(engine, P2).length, hand - 1 + 1, "the opponent draws exactly 1");
  assert.equal(deckOf(engine, P2).length, 11);
});

clause(BEATRIX, "1:rule", "'you' is the Beatrix's controller: a Beatrix the opponent controls increases THEIR draws, not its owner's", () => {
  const theirs = beatrixBoard({ bwController: P2, active: P2 });
  const p2Hand = handOf(theirs.engine, P2).length;
  play(theirs.engine, P2, theirs.id("oc1"));
  assert.equal(handOf(theirs.engine, P2).length, p2Hand - 1 + 2, "its controller draws 2");
  const mine = beatrixBoard({ bwController: P2, active: P1, tactics: ["c1"], hand: 3 });
  const p1Hand = handOf(mine.engine, P1).length;
  play(mine.engine, P1, mine.id("c1"));
  assert.equal(handOf(mine.engine, P1).length, p1Hand - 1 + 1, "its owner draws just 1");
});

clause(BEATRIX, "1:rule", "no effect while Beatrix is not in play (in hand): a draw of 1 draws 1", () => {
  const { engine } = beatrixBoard({ bw: "hand" });
  const hand = handOf(engine, P1).length;
  developDraw(engine, P1);
  assert.equal(handOf(engine, P1).length, hand + 1);
});

clause(BEATRIX, "1:rule", "the increase ends when Beatrix leaves play", () => {
  const { engine, id } = beatrixBoard({ tactics: ["killer"], hand: 3 });
  play(engine, P1, id("killer"), { selected: { t: [id("bw")] } });
  assert.equal(zoneOf(engine, id("bw")), "discard");
  const hand = handOf(engine, P1).length;
  developDraw(engine, P1);
  assert.equal(handOf(engine, P1).length, hand + 1, "back to drawing 1");
});

clause(BEATRIX, "1:rule", "a deck with fewer cards than the increased amount: you draw what is there and do not lose (CR 306.2)", () => {
  const { engine } = beatrixBoard({ deck: 1 });
  const hand = handOf(engine, P1).length;
  developDraw(engine, P1);
  assert.equal(handOf(engine, P1).length, hand + 1, "only one card was available");
  assert.equal(deckOf(engine, P1).length, 0);
  assert.equal(engine.state.winner ?? null, null);
});

// --- 2:rule: the 10-card hand cap

clause(BEATRIX, "2:rule", "with exactly 10 cards in hand you do not draw: the Develop Rule draw gives no card and the deck is unchanged", () => {
  const { engine } = beatrixBoard({ hand: 10 });
  const deck = [...deckOf(engine, P1)];
  developDraw(engine, P1);
  assert.equal(handOf(engine, P1).length, 10, "no card drawn");
  assert.deepEqual(deckOf(engine, P1), deck, "the deck is untouched");
});

clause(BEATRIX, "2:rule", "with more than 10 cards in hand you still do not draw", () => {
  const { engine } = beatrixBoard({ hand: 14 });
  developDraw(engine, P1);
  assert.equal(handOf(engine, P1).length, 14);
  assert.equal(deckOf(engine, P1).length, 12);
});

clause(BEATRIX, "2:rule", "with 9 cards in hand you do draw: the increased draw of 2 brings you to 11 (the cap is checked when the draw happens, and a draw is a group, CR 306.3)", () => {
  const { engine } = beatrixBoard({ hand: 9 });
  developDraw(engine, P1);
  assert.equal(handOf(engine, P1).length, 11, "2 cards were drawn");
});

clause(BEATRIX, "2:rule", "the count is taken when you would draw: playing a Draw-1 tactic from 11 cards leaves 10 and nothing is drawn; from 10 cards it leaves 9 and 2 are drawn", () => {
  const eleven = beatrixBoard({ hand: 11, tactics: ["c1"] });
  play(eleven.engine, P1, eleven.id("c1"));
  assert.equal(handOf(eleven.engine, P1).length, 10, "the tactic left; the draw was prevented");
  assert.equal(deckOf(eleven.engine, P1).length, 12);

  const ten = beatrixBoard({ hand: 10, tactics: ["c1"] });
  play(ten.engine, P1, ten.id("c1"));
  assert.equal(handOf(ten.engine, P1).length, 9 + 2, "9 cards left, so the (increased) draw of 2 happened");
});

clause(BEATRIX, "2:rule", "it stops applying as soon as your hand drops below 10: from 12 cards a Draw-1 is prevented, then two free plays leave 9 and the Develop draw works again", () => {
  const { engine, id } = beatrixBoard({ hand: 12, tactics: ["c1"] });
  play(engine, P1, id("c1"));
  assert.equal(handOf(engine, P1).length, 11, "11 cards left: prevented");
  assert.equal(deckOf(engine, P1).length, 12);
  play(engine, P1, id("h0"));
  assert.equal(handOf(engine, P1).length, 10);
  play(engine, P1, id("h1"));
  assert.equal(handOf(engine, P1).length, 9);
  developDraw(engine, P1);
  assert.equal(handOf(engine, P1).length, 11, "9 cards: the increased draw of 2 happens");
});

clause(BEATRIX, "2:rule", "only 'if you would draw': a search that puts a card into your hand still works with 10 or more cards in hand", () => {
  const { engine, id } = beatrixBoard({ hand: 11, tactics: ["tutor"] });
  const hand = handOf(engine, P1).length;
  const target = deckOf(engine, P1)[4];
  play(engine, P1, id("tutor"), { selected: { t: [target] } });
  assert.equal(zoneOf(engine, target), "hand", "put into hand without drawing");
  assert.equal(handOf(engine, P1).length, hand - 1 + 1);
});

clause(BEATRIX, "2:rule", "it is YOUR hand that counts: the opponent holding 10+ cards does not stop your draws", () => {
  const { engine } = beatrixBoard({ oppHand: 12 });
  const hand = handOf(engine, P1).length;
  developDraw(engine, P1);
  assert.equal(handOf(engine, P1).length, hand + 2, "still drawing (increased to 2)");
});

clause(BEATRIX, "2:rule", "and it only stops YOUR draws: with 10+ cards in your hand the opponent still draws normally", () => {
  const { engine, id } = beatrixBoard({ hand: 12, active: P2 });
  const hand = handOf(engine, P2).length;
  play(engine, P2, id("oc1"));
  assert.equal(handOf(engine, P2).length, hand - 1 + 1, "the opponent drew exactly 1");
});

clause(BEATRIX, "2:rule", "no cap without Beatrix in play: with 12 cards in hand a Develop draw still draws 1", () => {
  const { engine } = beatrixBoard({ bw: "hand", hand: 12 });
  const hand = handOf(engine, P1).length;
  developDraw(engine, P1);
  assert.equal(handOf(engine, P1).length, hand + 1);
});

clause(BEATRIX, "2:rule", "the cap also stops card-effect draws, whatever the amount: a 'draw 3' played from 12 cards (11 left, still 10 or more) draws nothing", () => {
  const { engine, id } = beatrixBoard({ hand: 12, tactics: ["c3"] });
  play(engine, P1, id("c3"));
  assert.equal(handOf(engine, P1).length, 11, "the tactic left; nothing drawn");
  assert.equal(deckOf(engine, P1).length, 12);
});

// =============================================================================
// Blanching Butcher
// When this card enters play, your faction loses 3 influence.
// If this card blocks, it gains 4 strength and 4 life this turn.
// Character (mercenary, assassin), cost 2, threshold [G].
// =============================================================================

const BUTCHER = "414941d7-e041-41a5-91e1-3141a518bfc5";

function butcherBoard(opts: { zone?: "hand" | "play"; owner?: Player; influence?: number; oppInfluence?: number; greed?: number; extra?: CardPlacement[] } = {}) {
  const owner = opts.owner ?? P1;
  return buildGame({
    playerA: { faction: developFaction(), influence: opts.influence },
    playerB: { faction: developFaction(), influence: opts.oppInfluence },
    turn: owner === P1 ? 1 : 2,
    activePlayerId: owner,
    cards: [
      { key: "bb", def: printing(BUTCHER), owner, zone: opts.zone ?? "hand" },
      { key: "other", def: character({ name: "Other", cost: 0 }), owner, zone: "hand" },
      { key: "putter", def: PUTTER(), owner, zone: "hand" },
      { key: "bouncer", def: BOUNCER(), owner, zone: "hand" },
      { key: "killer", def: KILLER(), owner, zone: "hand" },
      { key: "ally", def: character({ name: "Ally" }), owner, zone: "play" },
      ...bank("greed", opts.greed ?? 2, owner),
      ...(opts.extra ?? [])
    ]
  });
}

clause(BUTCHER, "0:rule", "deploying it costs 2; when it enters play your faction loses exactly 3 influence, and the opponent's is untouched", () => {
  const { engine, id } = butcherBoard();
  const before = ready(engine);
  const mine = engine.state.players[P1].influence;
  const theirs = engine.state.players[P2].influence;
  play(engine, P1, id("bb"));
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("bb")), "play");
  assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid");
  assert.equal(engine.state.players[P1].influence, mine - 3);
  assert.equal(engine.state.players[P2].influence, theirs);
});

clause(BUTCHER, "0:rule", "'your faction' is its controller's: a Butcher deployed by the opponent costs THEIR faction 3 influence", () => {
  const { engine, id } = butcherBoard({ owner: P2 });
  const mine = engine.state.players[P1].influence;
  const theirs = engine.state.players[P2].influence;
  play(engine, P2, id("bb"));
  drain(engine, declineAll);
  assert.equal(engine.state.players[P2].influence, theirs - 3);
  assert.equal(engine.state.players[P1].influence, mine);
});

clause(BUTCHER, "0:rule", "it triggers when it is put into play by an effect too, and again each time it re-enters", () => {
  const { engine, id } = butcherBoard();
  const start = engine.state.players[P1].influence;
  play(engine, P1, id("putter"), { selected: { t: [id("bb")] } });
  assert.equal(engine.state.players[P1].influence, start - 3, "put into play: -3");
  play(engine, P1, id("bouncer"), { selected: { t: [id("bb")] } });
  assert.equal(zoneOf(engine, id("bb")), "hand");
  assert.equal(engine.state.players[P1].influence, start - 3, "leaving play costs nothing");
  play(engine, P1, id("bb"));
  assert.equal(engine.state.players[P1].influence, start - 6, "entering again: another -3");
});

clause(BUTCHER, "0:rule", "it triggers only when THIS card enters play: not for other cards entering, nor when it is simply in play or leaves play", () => {
  const { engine, id } = butcherBoard({ zone: "play" });
  const start = engine.state.players[P1].influence;
  play(engine, P1, id("other"));
  assert.equal(engine.state.players[P1].influence, start, "another card entering play: no loss");
  play(engine, P1, id("killer"), { selected: { t: [id("bb")] } });
  assert.equal(zoneOf(engine, id("bb")), "discard");
  assert.equal(engine.state.players[P1].influence, start, "leaving play: no loss");
});

clause(BUTCHER, "0:rule", "the loss is not damage (CR 408.3b): a 'reduce damage to your faction' effect does not reduce it", () => {
  const shield = item({
    name: "Shield",
    behavior: { abilities: [{ id: "shield", type: "continuous", modifiers: [], damageModifiers: [{ selector: { type: "faction" }, delta: -10 }] }] }
  });
  const zap = tactic({
    name: "Zap",
    cost: 0,
    behavior: { abilities: [{ id: "z", type: "activated", targets: [{ id: "t", selector: { type: "faction", controller: "self" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 5 }] }] }
  });
  const { engine, id } = butcherBoard({ extra: [{ key: "shield", def: shield, owner: P1, zone: "play" }, { key: "zap", def: zap, owner: P1, zone: "hand" }] });
  const start = engine.state.players[P1].influence;
  play(engine, P1, id("zap"), { selected: { t: [factionIdOf(engine, P1)] } });
  assert.equal(engine.state.players[P1].influence, start, "control: the shield prevents damage to the faction");
  play(engine, P1, id("bb"));
  assert.equal(engine.state.players[P1].influence, start - 3, "the full 3 is lost despite the damage shield");
});

clause(BUTCHER, "0:rule", "a faction left at 0 influence loses the game: with 3 influence the Butcher costs you the game, with 4 it does not", () => {
  const three = butcherBoard({ influence: 3 });
  play(three.engine, P1, three.id("bb"));
  assert.equal(three.engine.state.players[P1].influence, 0);
  assert.equal(three.engine.state.winner, P2, "0 influence: you lose");
  const four = butcherBoard({ influence: 4 });
  play(four.engine, P1, four.id("bb"));
  assert.equal(four.engine.state.players[P1].influence, 1);
  assert.equal(four.engine.state.winner ?? null, null);
});

clause(BUTCHER, "0:rule", "with fewer than 3 influence the faction goes to 0 (or below) and loses", () => {
  const { engine, id } = butcherBoard({ influence: 2 });
  play(engine, P1, id("bb"));
  assert.ok(engine.state.players[P1].influence <= 0, "engine.state.players[P1].influence <= 0");
  assert.equal(engine.state.winner, P2);
});

clause(BUTCHER, "0:rule", "is refused one resource short of its cost of 2, and without [G] even with enough other resources", () => {
  const short = butcherBoard({ greed: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("bb")));
  const noThreshold = butcherBoard({ greed: 0, extra: [...bank("rage", 4, P1)] });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("bb")));
  const exact = butcherBoard({ greed: 1, extra: [...bank("rage", 1, P1)] });
  play(exact.engine, P1, exact.id("bb"));
  assert.equal(zoneOf(exact.engine, exact.id("bb")), "play", "[G] plus a second resource is enough");
});

// --- 1:rule: blocking

function butcherBlockBoard(opts: { blockers?: string[]; attackerStrength?: number; attackerLife?: number; attackerSpeed?: number; owner?: Player } = {}) {
  const defender = opts.owner ?? P1;
  const attacker = defender === P1 ? P2 : P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: attacker,
    cards: [
      { key: "bb", def: printing(BUTCHER), owner: defender, zone: "play" },
      { key: "mate", def: character({ name: "Mate", strength: 1, life: 3, speed: 2 }), owner: defender, zone: "play" },
      { key: "att", def: character({ name: "Att", strength: opts.attackerStrength ?? 1, life: opts.attackerLife ?? 5, speed: opts.attackerSpeed ?? 2 }), owner: attacker, zone: "play" },
      { key: "att2", def: character({ name: "Att2", strength: 1, life: 5, speed: 2 }), owner: attacker, zone: "play" }
    ]
  });
}

const butcherStats = (engine: SpoilsEngine, cardId: string) => [engine.getStat(cardId, "strength"), engine.getStat(cardId, "life"), engine.getStat(cardId, "speed")];
const printedButcher = () => [printing(BUTCHER).strength!, printing(BUTCHER).life!, printing(BUTCHER).speed!];

function attackAndBlock(engine: SpoilsEngine, id: Ids, attackers: string[], blockers: string[], attacker: Player = P2) {
  const defender = attacker === P1 ? P2 : P1;
  engine.perform({ type: "declareAttack", playerId: attacker, attackerIds: attackers.map(id), target: { type: "faction", playerId: defender } });
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: defender, blockerIds: blockers.map(id) });
}

clause(BUTCHER, "1:rule", "when it blocks it gains 4 strength and 4 life (printed +4/+4), speed unchanged", () => {
  const { engine, id } = butcherBlockBoard();
  const [str, life, spd] = printedButcher();
  assert.deepEqual(butcherStats(engine, id("bb")), [str, life, spd], "before blocking: printed stats");
  attackAndBlock(engine, id, ["att"], ["bb"]);
  assert.deepEqual(butcherStats(engine, id("bb")), [str + 4, life + 4, spd]);
});

clause(BUTCHER, "1:rule", "it gains the bonus only if IT blocks: not when another character blocks, nor when it attacks", () => {
  const other = butcherBlockBoard();
  attackAndBlock(other.engine, other.id, ["att"], ["mate"]);
  assert.deepEqual(butcherStats(other.engine, other.id("bb")), printedButcher(), "a different blocker was chosen");
  const attacking = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "bb", def: printing(BUTCHER), owner: P1, zone: "play" },
      { key: "b1", def: character({ name: "B1" }), owner: P2, zone: "play" }
    ]
  });
  attacking.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [attacking.id("bb")], target: { type: "faction", playerId: P2 } });
  resolvePendingResponses(attacking.engine);
  attacking.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [attacking.id("b1")] });
  assert.deepEqual(butcherStats(attacking.engine, attacking.id("bb")), printedButcher(), "attacking is not blocking");
});

clause(BUTCHER, "1:rule", "blocking alongside another character: only the Butcher gains the bonus", () => {
  const { engine, id } = butcherBlockBoard();
  attackAndBlock(engine, id, ["att"], ["bb", "mate"]);
  const [str, life, spd] = printedButcher();
  assert.deepEqual(butcherStats(engine, id("bb")), [str + 4, life + 4, spd]);
  assert.deepEqual(butcherStats(engine, id("mate")), [1, 3, 2], "its blocking partner is unchanged");
});

clause(BUTCHER, "1:rule", "'this turn': the bonus lasts through the rest of the turn and is gone when the turn ends", () => {
  const { engine, id } = butcherBlockBoard();
  attackAndBlock(engine, id, ["att"], ["bb"]);
  autoResolveBattle(engine);
  const [str, life, spd] = printedButcher();
  assert.deepEqual(butcherStats(engine, id("bb")), [str + 4, life + 4, spd], "still boosted after the battle, the same turn");
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.deepEqual(butcherStats(engine, id("bb")), printedButcher(), "gone on the next turn");
});

clause(BUTCHER, "1:rule", "the boost matters in the battle: a 5-strength, 5-life, equal-speed attacker is destroyed by the 5-strength Butcher, and the 7-life Butcher survives 5 damage", () => {
  const speed = printing(BUTCHER).speed!;
  const { engine, id } = butcherBlockBoard({ attackerStrength: 5, attackerLife: 5, attackerSpeed: speed });
  attackAndBlock(engine, id, ["att"], ["bb"]);
  autoResolveBattle(engine);
  const [str, life] = printedButcher();
  assert.equal(str + 4 >= 5, true, "test premise: the boosted Butcher can kill a 5-life attacker");
  assert.equal(zoneOf(engine, id("att")), "discard", "the attacker took " + (str + 4) + " damage");
  assert.equal(zoneOf(engine, id("bb")), "play", `the Butcher took 5 damage with ${life + 4} life`);
  assert.equal(engine.state.cards[id("bb")].damage, 5);
});

clause(BUTCHER, "1:rule", "an opposing Butcher blocks too: the bonus follows the Butcher's controller wherever it blocks", () => {
  const { engine, id } = butcherBlockBoard({ owner: P2 });
  attackAndBlock(engine, id, ["att"], ["bb"], P1);
  const [str, life, spd] = printedButcher();
  assert.deepEqual(butcherStats(engine, id("bb")), [str + 4, life + 4, spd]);
});

// =============================================================================
// Swarm of Gnats
// When this card enters or leaves play, your opponent must discard a card.
// Character (lurker), cost 4, threshold [O][O], 2/2/3 (strength / speed / life).
// =============================================================================

const GNATS = "a082e30f-1c66-46ff-97fa-77ca89b0076f";

/** A free tactic dealing `amount` damage to one chosen character. */
const ZAPPER = (amount: number) =>
  tactic({
    name: `Zap${amount}`,
    cost: 0,
    behavior: { abilities: [{ id: "z", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }] }] }
  });
/** A free tactic putting one chosen character into its owner's deck. */
const DECKER = () =>
  tactic({
    name: "Decker",
    cost: 0,
    behavior: { abilities: [{ id: "d", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "deck" }] }] }
  });

function gnatsBoard(opts: { zone?: "hand" | "play"; controller?: Player; oppHand?: number; myHand?: number; obsession?: number; greed?: number; active?: Player; extra?: CardPlacement[] } = {}) {
  const active = opts.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: active === P1 ? 1 : 2,
    activePlayerId: active,
    cards: [
      { key: "sg", def: printing(GNATS), owner: P1, controller: opts.controller, zone: opts.zone ?? "hand" },
      ...Array.from({ length: opts.oppHand ?? 3 }, (_, i) => ({ key: `o${i}`, def: costed(`Opp${i}`, 1), owner: P2, zone: "hand" as const })),
      ...Array.from({ length: opts.myHand ?? 2 }, (_, i) => ({ key: `h${i}`, def: costed(`Mine${i}`, 1), owner: P1, zone: "hand" as const })),
      { key: "ally", def: character({ name: "Ally", cost: 0 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "killer", def: KILLER(), owner: P1, zone: "hand" },
      { key: "bounce", def: BOUNCER(), owner: P1, zone: "hand" },
      { key: "remove", def: REMOVER(), owner: P1, zone: "hand" },
      { key: "decker", def: DECKER(), owner: P1, zone: "hand" },
      { key: "zap3", def: ZAPPER(3), owner: P1, zone: "hand" },
      { key: "putter", def: PUTTER(), owner: P1, zone: "hand" },
      { key: "cheap", def: character({ name: "Cheap", cost: 0 }), owner: P1, zone: "hand" },
      { key: "oppDeck", def: costed("OppDeck", 1), owner: P2, zone: "deck" },
      ...bank("obsession", opts.obsession ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

/** The opponent is asked to discard; answers with `key`. Returns the prompt that was open. */
function gnatsDiscard(engine: SpoilsEngine, id: Ids, key: string, discarder: Player = P2) {
  const pc = pending(engine)!;
  assert.equal(pc?.kind, "chooserSelectsTarget", "a discard choice is open");
  assert.equal(pc.playerId, discarder, "the OPPONENT of the Gnats' controller chooses what to discard");
  resolveChoice(engine, discarder, { kind: "chooserSelectsTarget", selected: [id(key)] });
  return pc;
}

clause(GNATS, "0:rule", "deploying it costs 4; when it enters play the opponent chooses a card from their hand and discards it into their discard pile; nothing else is discarded", () => {
  const { engine, id } = gnatsBoard();
  const before = ready(engine);
  const mine = [...handOf(engine, P1)];
  play(engine, P1, id("sg"));
  assert.equal(zoneOf(engine, id("sg")), "play");
  assert.equal(before - ready(engine), 4, "the printed cost of 4 is paid");
  gnatsDiscard(engine, id, "o1");
  assert.equal(zoneOf(engine, id("o1")), "discard");
  assert.equal(discardOf(engine, P2).includes(id("o1")), true, "in the opponent's discard pile");
  for (const key of ["o0", "o2"]) assert.equal(zoneOf(engine, id(key)), "hand", `${key} stays in hand`);
  assert.deepEqual([...handOf(engine, P1)].sort(), mine.filter((c) => c !== id("sg")).sort(), "your own hand is untouched");
  assert.equal(pending(engine), undefined);
});

clause(GNATS, "0:rule", "'must discard': the opponent cannot decline, cannot discard a card that is not in their hand, and discards exactly one", () => {
  const { engine, id } = gnatsBoard();
  play(engine, P1, id("sg"));
  const attempt = (...cards: string[]) => tryChoice(engine, P2, { kind: "chooserSelectsTarget", selected: cards.map(id) });
  assert.throws(attempt(), "picking nothing is refused");
  assert.throws(attempt("h0"), "a card of the Gnats' controller");
  assert.throws(attempt("foe"), "a card in play");
  assert.throws(attempt("oppDeck"), "a card in their deck");
  assert.throws(attempt("o0", "o1"), "only one card");
  assert.throws(tryChoice(engine, P1, { kind: "chooserSelectsTarget", selected: [id("o0")] }), "the Gnats' controller cannot choose for them");
  assert.equal(pending(engine)?.playerId, P2, "still waiting for the opponent");
  attempt("o2")();
  assert.equal(zoneOf(engine, id("o2")), "discard");
});

clause(GNATS, "0:rule", "any card can be discarded, including a resource card: an opponent holding only a resource card must discard it", () => {
  const staple = stapleCard("Staple");
  const { engine, id } = gnatsBoard({ oppHand: 0, extra: [{ key: "o:Staple", def: staple, owner: P2, zone: "hand" }] });
  play(engine, P1, id("sg"));
  gnatsDiscard(engine, id, "o:Staple");
  assert.equal(zoneOf(engine, id("o:Staple")), "discard");
});

clause(GNATS, "0:rule", "an opponent with no cards in hand discards nothing, and the Gnats still enter play", () => {
  const { engine, id } = gnatsBoard({ oppHand: 0 });
  play(engine, P1, id("sg"));
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("sg")), "play");
  assert.equal(pending(engine), undefined);
  assert.equal(discardOf(engine, P2).length, 0);
});

clause(GNATS, "0:rule", "it triggers when it is put into play by an effect too", () => {
  const { engine, id } = gnatsBoard();
  play(engine, P1, id("putter"), { selected: { t: [id("sg")] } });
  assert.equal(zoneOf(engine, id("sg")), "play");
  gnatsDiscard(engine, id, "o0");
  assert.equal(zoneOf(engine, id("o0")), "discard");
});

clause(GNATS, "0:rule", "'your opponent' is the Gnats' controller's opponent: a Gnats deployed by the opponent makes YOU discard", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sg", def: printing(GNATS), owner: P2, zone: "hand" },
      { key: "m0", def: costed("M0", 1), owner: P1, zone: "hand" },
      { key: "m1", def: costed("M1", 1), owner: P1, zone: "hand" },
      { key: "t0", def: costed("T0", 1), owner: P2, zone: "hand" },
      ...bank("obsession", 4, P2)
    ]
  });
  play(engine, P2, id("sg"));
  const pc = pending(engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "the other player discards");
  resolveChoice(engine, P1, { kind: "chooserSelectsTarget", selected: [id("m1")] });
  assert.equal(zoneOf(engine, id("m1")), "discard");
  assert.equal(zoneOf(engine, id("t0")), "hand", "the Gnats' own controller discards nothing");
});

clause(GNATS, "0:rule", "it triggers only when THIS card enters play: other cards entering (yours or theirs) cause no discard, and nor does a Gnats that was simply placed in play", () => {
  const { engine, id } = gnatsBoard({ zone: "play" });
  assert.equal(pending(engine), undefined, "placed in play: no trigger");
  play(engine, P1, id("cheap"));
  assert.equal(pending(engine), undefined, "another card entering: no discard");
  assert.equal(discardOf(engine, P2).length, 0);
});

for (const [label, tacticKey, extraSelected] of [
  ["destroyed", "killer", "t"],
  ["put into its owner's hand", "bounce", "t"],
  ["removed from the game", "remove", "t"],
  ["put into its owner's deck", "decker", "t"],
  ["destroyed by damage", "zap3", "t"]
] as const) {
  clause(GNATS, "0:rule", `it triggers when it leaves play: ${label}; the opponent then discards a card of their choice`, () => {
    const { engine, id } = gnatsBoard({ zone: "play" });
    play(engine, P1, id(tacticKey), { selected: { [extraSelected]: [id("sg")] } });
    assert.notEqual(zoneOf(engine, id("sg")), "play", "it left play");
    gnatsDiscard(engine, id, "o1");
    assert.equal(zoneOf(engine, id("o1")), "discard");
    for (const key of ["o0", "o2"]) assert.equal(zoneOf(engine, id(key)), "hand", `${key} stays in hand`);
    assert.equal(pending(engine), undefined, "exactly one discard");
  });
}

clause(GNATS, "0:rule", "it triggers when it leaves play by dying in battle (lethal battle damage)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sg", def: printing(GNATS), owner: P1, zone: "play" },
      { key: "att", def: character({ name: "Att", strength: 5, life: 5, speed: 1 }), owner: P2, zone: "play" },
      { key: "t0", def: costed("T0", 1), owner: P2, zone: "hand" },
      { key: "t1", def: costed("T1", 1), owner: P2, zone: "hand" }
    ]
  });
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("att")], target: { type: "faction", playerId: P1 } });
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("sg")] });
  let guard = 0;
  while (!pending(engine) && engine.state.battle && guard++ < 50) {
    if (engine.state.responseWindow) resolvePendingResponses(engine);
    else autoResolveBattle(engine);
  }
  assert.equal(zoneOf(engine, id("sg")), "discard", "the Gnats died in the battle");
  gnatsDiscard(engine, id, "t0");
  assert.equal(zoneOf(engine, id("t0")), "discard");
  assert.equal(zoneOf(engine, id("t1")), "hand");
});

clause(GNATS, "0:rule", "entering AND leaving are two separate triggers: a Gnats that enters and later leaves makes the opponent discard twice in all", () => {
  const { engine, id } = gnatsBoard({ oppHand: 4 });
  play(engine, P1, id("sg"));
  gnatsDiscard(engine, id, "o0");
  play(engine, P1, id("killer"), { selected: { t: [id("sg")] } });
  gnatsDiscard(engine, id, "o1");
  assert.equal(discardOf(engine, P2).length, 2);
  assert.equal(handOf(engine, P2).length, 2);
});

clause(GNATS, "0:rule", "it triggers each time it enters: bouncing it and deploying it again makes the opponent discard on the leave and on the re-entry", () => {
  const { engine, id } = gnatsBoard({ oppHand: 5, obsession: 8 });
  play(engine, P1, id("sg"));
  gnatsDiscard(engine, id, "o0");
  play(engine, P1, id("bounce"), { selected: { t: [id("sg")] } });
  gnatsDiscard(engine, id, "o1");
  play(engine, P1, id("sg"));
  gnatsDiscard(engine, id, "o2");
  assert.equal(discardOf(engine, P2).length, 3);
});

clause(GNATS, "0:rule", "the opponent's own characters entering or leaving play do not trigger YOUR Gnats", () => {
  const { engine, id } = gnatsBoard({ zone: "play", extra: [{ key: "mine2", def: character({ name: "Mine2" }), owner: P1, zone: "play" }] });
  play(engine, P1, id("killer"), { selected: { t: [id("foe")] } });
  assert.equal(zoneOf(engine, id("foe")), "discard");
  assert.equal(pending(engine), undefined, "a different card left play: no discard");
  assert.equal(discardOf(engine, P2).length, 1, "only the destroyed Foe");
});

clause(GNATS, "0:rule", "is refused one resource short of its cost of 4, and without [O][O] even with enough other resources; printed 2/2/3", () => {
  const short = gnatsBoard({ obsession: 3 });
  assert.throws(() => playRaw(short.engine, P1, short.id("sg")));
  const noThreshold = gnatsBoard({ obsession: 1, greed: 6 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("sg")), "only one [O]");
  const exact = gnatsBoard({ obsession: 2, greed: 2 });
  play(exact.engine, P1, exact.id("sg"));
  assert.equal(zoneOf(exact.engine, exact.id("sg")), "play");
  assert.equal(exact.engine.getStat(exact.id("sg"), "strength"), 2);
  assert.equal(exact.engine.getStat(exact.id("sg"), "speed"), 2);
  assert.equal(exact.engine.getStat(exact.id("sg"), "life"), 3);
});

// @@END@@
