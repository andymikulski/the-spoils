// Read-only queries that explain what the UI cannot see for itself:
//  A. CardPlayability.blockedBy (+ getNamedValues): WHY a hand / void card is dead — a runtime play ban (Tactician
//     Vacation), a named-card ban (Incriminating Photograph), plain timing — from the very gate deployCard throws at;
//  B. getPendingDelayedEffects + the "effectScheduled" log line: scheduleEffect riders (Gilded Yurt, Imperial Palace,
//     Drill Instructor), Monstrous Lassitude's skipped Restore Rule, Mutiny Grant's timed take-control;
//  C. canViewerSeeVoidedCard: the face-down cards Pant Swipe voided are visible to whoever voided them.
// Each listing is checked against what perform() really does, so a reason and a refusal cannot drift.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  activate,
  bank,
  buildGame,
  character,
  developFaction,
  play,
  resolvePendingResponses,
  tactic,
  P1,
  P2
} from "./per-card/_harness.js";
import { zoneOf } from "./clauses/_board.js";
import { declineAll, drain, printing } from "./clauses/_clause.js";

const PHOTOGRAPH = "56375ba1-9493-4aa8-972e-e73b5b789207";
const VACATION = "f5b4db56-d972-48de-b1b5-7f16b7d427aa";
const YURT = "07df2997-8872-48c4-bbd6-3c03d2aaddc1";
const PALACE = "35670758-9d3b-4047-9948-16815d4e9181";
const DRILL_INSTRUCTOR = "6a477977-867b-4cdc-acc0-1d3f00923031";
const MONSTROUS_LASSITUDE = "99ed6205-1f9e-4d62-a1ae-f9038449db17";
const MUTINY_GRANT = "1dc62434-5a69-44ce-acde-488436a14de8";
const PANT_SWIPE_REMOVES = "0fae8376-e4e6-4f0c-ae33-8be60ca717a9";
const PANT_SWIPE_VOIDS = "3a9ab0e7-b3f3-4956-8f82-be8f0916a9da";

/** The message `perform` throws when it refuses to play `cardId`. */
function refusal(engine: ReturnType<typeof buildGame>["engine"], playerId: string, cardId: string): string {
  try {
    engine.perform({ type: "playCard", playerId, cardId, selected: {} } as never);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected the play to be refused");
}

const logLines = (engine: ReturnType<typeof buildGame>["engine"]) => engine.state.gameLog.map(e => e.message);

// ---------------------------------------------------------------------------
// A. blockedBy
// ---------------------------------------------------------------------------

describe("CardPlayability.blockedBy: a named-card ban (Incriminating Photograph)", () => {
  function photoGame() {
    const g = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      cards: [
        { key: "photo", def: printing(PHOTOGRAPH), owner: P1, zone: "hand" },
        { key: "banned", def: character({ name: "Banned", cost: 0 }), owner: P1, zone: "hand" },
        { key: "fine", def: character({ name: "Fine", cost: 0 }), owner: P1, zone: "hand" },
        ...bank("deception", 4, P1)
      ] as never
    });
    play(g.engine, P1, g.id("photo"), {});
    drain(g.engine, pc => (pc.kind === "nameValue" ? { kind: "nameValue", value: "Banned" } : declineAll(pc)));
    return g;
  }

  test("the banned hand card says why (kind, source, the name) with the engine's own refusal text", () => {
    const g = photoGame();
    const banned = g.engine.getCardPlayability(P1, g.id("banned"));
    assert.equal(banned.playable, false);
    assert.equal(banned.legalTiming, false);
    assert.equal(banned.blockedBy?.kind, "namedBan");
    assert.equal(banned.blockedBy?.sourceId, g.id("photo"));
    assert.equal(banned.blockedBy?.namedValue, "Banned");
    assert.equal(banned.blockedBy?.text, refusal(g.engine, P1, g.id("banned")), "same text deployCard throws");

    const fine = g.engine.getCardPlayability(P1, g.id("fine"));
    assert.equal(fine.playable, true);
    assert.equal(fine.blockedBy, undefined, "a playable card carries no reason");
  });

  test("getNamedValues says what the Photograph named; a card that named nothing reads empty", () => {
    const g = photoGame();
    assert.deepEqual(Object.values(g.engine.getNamedValues(g.id("photo"))), ["Banned"]);
    assert.deepEqual(g.engine.getNamedValues(g.id("fine")), {});
    // A copy: editing it does not touch the game.
    g.engine.getNamedValues(g.id("photo")).extra = "x";
    assert.deepEqual(Object.values(g.engine.getNamedValues(g.id("photo"))), ["Banned"]);
  });
});

describe("CardPlayability.blockedBy: a runtime play ban (Tactician Vacation) and timing", () => {
  function vacationGame() {
    const g = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      cards: [
        { key: "tv", def: printing(VACATION), owner: P1, zone: "hand" },
        { key: "trick", def: tactic({ name: "Trick", cost: 0 }), owner: P1, zone: "hand" },
        { key: "body", def: character({ name: "Body", cost: 0 }), owner: P1, zone: "hand" },
        { key: "theirs", def: tactic({ name: "Theirs", cost: 0 }), owner: P2, zone: "hand" },
        ...bank("rage", 8, P1)
      ] as never
    });
    return g;
  }

  test("before the ban: tactics are fine; the opponent's card is blocked by timing only", () => {
    const g = vacationGame();
    assert.equal(g.engine.getCardPlayability(P1, g.id("trick")).blockedBy, undefined);
    const theirs = g.engine.getCardPlayability(P2, g.id("theirs"));
    assert.equal(theirs.blockedBy?.kind, "timing");
    assert.equal(theirs.blockedBy?.sourceId, undefined, "plain timing has no source card");
    assert.equal(theirs.blockedBy?.text, refusal(g.engine, P2, g.id("theirs")));
  });

  test("after it resolves: tactics are blocked by the Vacation (and name it); characters are not", () => {
    const g = vacationGame();
    play(g.engine, P1, g.id("tv"), {});
    drain(g.engine, declineAll);
    resolvePendingResponses(g.engine);
    assert.equal(zoneOf(g.engine, g.id("tv")) === "hand", false, "the Vacation was played");

    const trick = g.engine.getCardPlayability(P1, g.id("trick"));
    assert.equal(trick.playable, false);
    assert.equal(trick.blockedBy?.kind, "playRestriction");
    assert.equal(trick.blockedBy?.sourceId, g.id("tv"), "the runtime ban remembers its source");
    assert.equal(trick.blockedBy?.text, "You cannot play tactic cards right now.");
    assert.equal(trick.blockedBy?.text, refusal(g.engine, P1, g.id("trick")));

    assert.equal(g.engine.getCardPlayability(P1, g.id("body")).blockedBy, undefined, "only tactics are banned");
  });
});

describe("CardPlayability.blockedBy reaches cards played from outside the hand", () => {
  test("a Pant Swipe card named by an Incriminating Photograph is listed, dead, and says why", () => {
    const g = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      random: () => 0,
      turn: 2,
      cards: [
        { key: "photo", def: printing(PHOTOGRAPH), owner: P1, zone: "hand" },
        { key: "swipe", def: printing(PANT_SWIPE_REMOVES), owner: P1, zone: "hand" },
        ...bank("deception", 11, P1),
        ...["o1", "o2", "o3", "o4", "o5"].map(key => ({
          key,
          def: character({ name: key, cost: 1, threshold: "rr" }),
          owner: P2,
          zone: "deck" as const
        }))
      ] as never
    });
    play(g.engine, P1, g.id("photo"), {});
    drain(g.engine, pc => (pc.kind === "nameValue" ? { kind: "nameValue", value: "o1" } : declineAll(pc)));
    play(g.engine, P1, g.id("swipe"));
    resolvePendingResponses(g.engine);

    const listed = g.engine.getPlayableFromOutsideHand(P1);
    assert.equal(listed.length, 4);
    const named = listed.find(l => l.cardId === g.id("o1"))!;
    assert.equal(named.playability.playable, false);
    assert.equal(named.playability.blockedBy?.kind, "namedBan");
    assert.equal(named.playability.blockedBy?.sourceId, g.id("photo"));
    assert.equal(named.playability.fromZone, "removed");
    assert.equal(named.playability.blockedBy?.text, refusal(g.engine, P1, g.id("o1")));
    for (const other of listed.filter(l => l !== named)) {
      assert.equal(other.playability.blockedBy, undefined);
      assert.equal(other.playability.playable, true);
    }
  });
});

// ---------------------------------------------------------------------------
// B. delayed effects
// ---------------------------------------------------------------------------

describe("getPendingDelayedEffects: Gilded Yurt", () => {
  function yurtGame() {
    return buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      activePlayerId: P1,
      cards: [
        { key: "yurt", def: printing(YURT), owner: P1, zone: "play" },
        { key: "a", def: character({ name: "Alpha", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
        ...bank("greed", 3, P1)
      ] as never
    });
  }

  test("nothing is pending, then CHILLAX schedules the return: listed, logged, and gone once it fires", () => {
    const g = yurtGame();
    assert.deepEqual(g.engine.getPendingDelayedEffects(), []);
    assert.deepEqual(g.engine.getPendingDelayedEffects(P1), []);

    activate(g.engine, P1, g.id("yurt"), "yurt-chillax", { selected: { v: [g.id("a")] } });
    drain(g.engine, declineAll);
    assert.equal(zoneOf(g.engine, g.id("a")), "removed");

    const pendingNow = g.engine.getPendingDelayedEffects(P1);
    assert.equal(pendingNow.length, 1);
    const entry = pendingNow[0];
    assert.equal(entry.kind, "scheduledEffect");
    assert.equal(entry.sourceId, g.id("yurt"));
    assert.equal(entry.controllerId, P1);
    assert.equal(entry.when, "startOfNextTurn");
    assert.equal(entry.turn, g.engine.state.turn + 2, "P1 is the active player: its next turn is two turns on");
    assert.deepEqual(entry.affectedCardIds, [g.id("a")]);
    assert.match(entry.text, /^Gilded Yurt: the start of .*'s next turn$/);
    assert.deepEqual(g.engine.getPendingDelayedEffects(P2), [], "the opponent controls none of it");
    assert.equal(g.engine.getPendingDelayedEffects().length, 1);

    const scheduled = g.engine.state.gameLog.find(e => e.event?.type === "effectScheduled");
    assert.ok(scheduled, "the scheduling is in the game log");
    assert.equal(scheduled.kind, "info");
    assert.match(scheduled.message, /^Gilded Yurt sets up a delayed effect for the start of .*'s next turn$/);

    // Two end-turns later it fires and the list empties.
    g.engine.perform({ type: "endTurn", playerId: P1 } as never);
    drain(g.engine, declineAll);
    assert.equal(g.engine.getPendingDelayedEffects(P1).length, 1, "still waiting during the opponent's turn");
    g.engine.perform({ type: "endTurn", playerId: P2 } as never);
    drain(g.engine, declineAll);
    assert.equal(zoneOf(g.engine, g.id("a")), "play", "back in play");
    assert.deepEqual(g.engine.getPendingDelayedEffects(), []);
  });

  test("a face-down card is never named in the description or the log", () => {
    const g = yurtGame();
    g.engine.state.cards[g.id("yurt")].faceDown = true;
    g.engine.state.scheduledEffects.push({
      id: "s-x",
      when: "endOfTurn",
      turnScheduled: g.engine.state.turn,
      sourceId: g.id("yurt"),
      controllerId: P1,
      effects: []
    } as never);
    assert.equal(g.engine.getPendingDelayedEffects(P1)[0].text, "a face-down card: the end of the turn");
  });
});

describe("getPendingDelayedEffects: Imperial Palace and Drill Instructor", () => {
  test("Palace: paying at the end of my turn schedules the return for my next turn", () => {
    const g = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      random: () => 0.5,
      turn: 2,
      activePlayerId: P1,
      cards: [
        { key: "pal", def: printing(PALACE), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C", strength: 2, life: 4 }), owner: P1, zone: "play" },
        ...bank("greed", 3, P1)
      ] as never
    });
    g.engine.perform({ type: "endTurn", playerId: P1 } as never);
    drain(g.engine, pc =>
      pc.kind === "mayPay"
        ? ({ kind: "mayPay", pay: true } as never)
        : pc.kind === "chooserSelectsTarget"
          ? ({ kind: "chooserSelectsTarget", selected: [g.id("c")] } as never)
          : declineAll(pc)
    );
    assert.equal(zoneOf(g.engine, g.id("c")), "void");
    const list = g.engine.getPendingDelayedEffects(P1);
    assert.equal(list.length, 1);
    assert.equal(list[0].sourceId, g.id("pal"));
    assert.equal(list[0].when, "startOfNextTurn");
    assert.equal(list[0].turn, 4, "P1's next turn after the opponent's turn 3");
    assert.deepEqual(list[0].affectedCardIds, [g.id("c")]);
  });

  test("Drill Instructor: the buff is scheduled for the start of the next turn", () => {
    const g = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      activePlayerId: P1,
      cards: [
        { key: "di", def: printing(DRILL_INSTRUCTOR), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" },
        ...bank("rage", 6, P1)
      ] as never
    });
    play(g.engine, P1, g.id("di"), {});
    drain(g.engine, pc =>
      pc.kind === "selectTargets" ? ({ kind: "selectTargets", selected: { pick: [g.id("c")] } } as never) : declineAll(pc)
    );
    const list = g.engine.getPendingDelayedEffects(P1);
    assert.equal(list.length, 1);
    assert.equal(list[0].sourceId, g.id("di"));
    assert.equal(list[0].when, "startOfTheNextTurn");
    assert.equal(list[0].turn, g.engine.state.turn + 1);
    assert.deepEqual(list[0].affectedCardIds, [g.id("c")]);
    assert.match(list[0].text, /^Drill Instructor: the start of the next turn$/);
  });
});

describe("getPendingDelayedEffects: skipped Restore Rule and timed take-control", () => {
  test("Monstrous Lassitude: my next Restore Rule is skipped, and the entry is consumed at that turn", () => {
    const g = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      activePlayerId: P1,
      cards: [{ key: "ml", def: printing(MONSTROUS_LASSITUDE), owner: P1, zone: "hand" }, ...bank("obsession", 4, P1)] as never
    });
    play(g.engine, P1, g.id("ml"), {});
    drain(g.engine, declineAll);
    const list = g.engine.getPendingDelayedEffects(P1);
    assert.equal(list.length, 1);
    assert.equal(list[0].kind, "restoreRuleSkip");
    assert.equal(list[0].controllerId, P1);
    assert.equal(list[0].turn, g.engine.state.turn + 2);
    assert.equal(list[0].sourceId, undefined, "the engine does not record a source for restore skips");
    assert.deepEqual(g.engine.getPendingDelayedEffects(P2), []);
    g.engine.perform({ type: "endTurn", playerId: P1 } as never);
    drain(g.engine, declineAll);
    g.engine.perform({ type: "endTurn", playerId: P2 } as never);
    drain(g.engine, declineAll);
    assert.deepEqual(g.engine.getPendingDelayedEffects(), [], "the skip was used up");
  });

  test("per-card restore flags and borrowed cards are listed with the card they touch", () => {
    const g = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      activePlayerId: P1,
      cards: [
        { key: "a", def: character({ name: "Alpha" }), owner: P1, zone: "play" },
        { key: "b", def: character({ name: "Bravo" }), owner: P2, zone: "play" },
        { key: "c", def: character({ name: "Charlie" }), owner: P1, zone: "play" }
      ] as never
    });
    g.engine.state.cards[g.id("a")].skipNextRestore = true;
    g.engine.state.cards[g.id("b")].restoreLocked = true;
    g.engine.state.cards[g.id("c")].borrowedUntilEndOfTurn = true;
    const byKind = Object.fromEntries(g.engine.getPendingDelayedEffects().map(e => [e.kind, e]));
    assert.deepEqual(byKind.skipNextRestore.affectedCardIds, [g.id("a")]);
    assert.equal(byKind.skipNextRestore.turn, g.engine.state.turn + 2, "P1 is active: its next Restore Rule is two turns on");
    assert.equal(byKind.restoreLock.when, "whileInPlay");
    assert.equal(byKind.restoreLock.controllerId, P2);
    assert.equal(byKind.removeAtEndOfTurn.when, "endOfTurn");
    assert.equal(byKind.removeAtEndOfTurn.turn, g.engine.state.turn);
    // Filtering by player follows control of the affected card.
    assert.deepEqual(
      g.engine.getPendingDelayedEffects(P2).map(e => e.kind),
      ["restoreLock"]
    );
  });

  test("Mutiny Grant: the stolen character is listed as returning at the end of the turn", () => {
    const g = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      activePlayerId: P1,
      cards: [
        { key: "mg", def: printing(MUTINY_GRANT), owner: P1, zone: "hand" },
        { key: "foe", def: character({ name: "Foe", cost: 1 }), owner: P2, zone: "play" },
        ...bank("greed", 3, P1)
      ] as never
    });
    play(g.engine, P1, g.id("mg"), { selected: { pick: [g.id("foe")] } });
    drain(g.engine, declineAll);
    assert.equal(g.engine.state.cards[g.id("foe")].controllerId, P1, "taken");
    const list = g.engine.getPendingDelayedEffects(P2);
    assert.equal(list.length, 1);
    assert.equal(list[0].kind, "controlReturn");
    assert.equal(list[0].controllerId, P2, "it goes back to the opponent");
    assert.equal(list[0].when, "endOfTurn");
    assert.equal(list[0].turn, g.engine.state.turn);
    assert.deepEqual(list[0].affectedCardIds, [g.id("foe")]);
    assert.match(list[0].text, /^Foe returns to .* at the end of the turn$/);
    // The thief also sees it (it acts on a card the thief controls right now).
    assert.equal(g.engine.getPendingDelayedEffects(P1).length, 1);
  });
});

// ---------------------------------------------------------------------------
// C. face-down voided cards
// ---------------------------------------------------------------------------

describe("canViewerSeeVoidedCard: Pant Swipe's face-down void", () => {
  function swipeGame(printingId: string) {
    const g = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      random: () => 0,
      cards: [
        { key: "swipe", def: printing(printingId), owner: P1, zone: "hand" },
        { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "void" },
        ...bank("deception", 8, P1),
        ...["o1", "o2", "o3", "o4", "o5"].map(key => ({
          key,
          def: character({ name: key, cost: 1, threshold: "rr" }),
          owner: P2,
          zone: "deck" as const
        }))
      ] as never
    });
    play(g.engine, P1, g.id("swipe"));
    resolvePendingResponses(g.engine);
    return g;
  }

  test("the player who voided them looks; the opponent does not; a face-up void card is public", () => {
    const g = swipeGame(PANT_SWIPE_VOIDS);
    for (const key of ["o1", "o2", "o3", "o4"]) {
      assert.equal(g.engine.state.cards[g.id(key)].faceDown, true);
      assert.equal(g.engine.canViewerSeeVoidedCard(P1, g.id(key)), true, "the Pant Swipe player may look");
      assert.equal(g.engine.canViewerSeeVoidedCard(P2, g.id(key)), false, "their owner is not told they may");
    }
    assert.equal(g.engine.canViewerSeeVoidedCard(P2, g.id("mine")), true, "face-up void cards are public");
    assert.equal(g.engine.canViewerSeeVoidedCard(P2, g.id("o5")), true, "not a void card: not this query's business");
  });

  test("the record goes with the card: once deployed (or moved on) nothing is hidden", () => {
    const g = swipeGame(PANT_SWIPE_VOIDS);
    play(g.engine, P1, g.id("o1"));
    drain(g.engine, declineAll);
    assert.equal(zoneOf(g.engine, g.id("o1")), "play");
    assert.equal(g.engine.state.cards[g.id("o1")].faceDownBy, undefined);
    assert.equal(g.engine.canViewerSeeVoidedCard(P2, g.id("o1")), true);
  });

  test("the removed-from-game printing: hidden from the owner only if the card is actually face-down", () => {
    const g = swipeGame(PANT_SWIPE_REMOVES);
    const faceDown = g.engine.state.cards[g.id("o1")].faceDown;
    assert.equal(g.engine.canViewerSeeVoidedCard(P2, g.id("o1")), !faceDown, "hidden from the owner only while face-down");
    assert.equal(g.engine.canViewerSeeVoidedCard(P1, g.id("o1")), true, "the Pant Swipe player always sees them");
  });
});

// ---------------------------------------------------------------------------
// The log line is log-only: 2-player play is otherwise untouched
// ---------------------------------------------------------------------------

describe("effectScheduled is log-only", () => {
  test("the scheduling does not count as a game event (no tally) and does not break a log-less engine", () => {
    const g = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      activePlayerId: P1,
      cards: [
        { key: "yurt", def: printing(YURT), owner: P1, zone: "play" },
        { key: "a", def: character({ name: "Alpha" }), owner: P1, zone: "play" },
        ...bank("greed", 3, P1)
      ] as never
    });
    g.engine.setLogEnabled(false);
    activate(g.engine, P1, g.id("yurt"), "yurt-chillax", { selected: { v: [g.id("a")] } });
    drain(g.engine, declineAll);
    assert.equal(g.engine.getPendingDelayedEffects(P1).length, 1);
    assert.ok(!logLines(g.engine).some(m => m.includes("delayed effect")), "logging off: no line");
    assert.equal(
      Object.keys(g.engine.state.turnEventTally).some(k => k.startsWith("effectScheduled")),
      false,
      "never emitted through the trigger system"
    );
  });
});
