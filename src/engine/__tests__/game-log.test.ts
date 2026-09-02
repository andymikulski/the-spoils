import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGame,
  character,
  P1,
  P2,
  resolvePendingResponses,
  tactic
} from "./support/fixtures.js";

/** Leading-whitespace length of a line. */
function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

describe("game log — a running, toggleable record of everything that happens", () => {
  test("records draws, deploys, resolution and turn structure in emit order with gap-free seq numbers", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "spell", def: tactic({ name: "Spark" }), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "Deckcard 1" }), owner: P1, zone: "deck" },
        { key: "d2", def: character({ name: "Deckcard 2" }), owner: P1, zone: "deck" }
      ]
    });

    engine.perform({ type: "chooseDevelop", playerId: P1, choice: { type: "draw" } });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("spell") });
    resolvePendingResponses(engine);

    const log = engine.getLog();
    assert.ok(log.length > 0, "expected log entries");

    // seq is 1-based, gap-free, strictly increasing; metadata is always populated.
    log.forEach((entry, i) => {
      assert.equal(entry.seq, i + 1, `entry ${i} seq`);
      assert.equal(entry.turn, 1);
      assert.equal(entry.activePlayerId, P1);
      assert.ok(entry.message.length > 0);
      // exactly one of event / marker is set
      assert.equal(Number(!!entry.event) + Number(!!entry.marker), 1);
    });

    const drew = log.find(e => e.event?.type === "cardsDrawn");
    assert.ok(drew, "draw was logged");
    assert.equal(drew.kind, "draw");
    assert.match(drew.message, /draws 1 card/);
    assert.equal(drew.depth, 0);

    const played = log.find(e => e.event?.type === "cardPlayed");
    assert.ok(played, "deploy was logged");
    assert.equal(played.kind, "action");
    assert.equal(played.depth, 0);
    assert.match(played.message, /plays Spark/);

    const resolved = log.find(e => e.marker === "stackItemResolving");
    assert.ok(resolved, "stack resolution was logged");
    assert.equal(resolved.kind, "resolution");
    assert.match(resolved.message, /Spark resolves/);
  });

  test("setLogEnabled(false) stops recording; re-enabling resumes without losing history", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: tactic({ name: "Alpha" }), owner: P1, zone: "hand" },
        { key: "b", def: tactic({ name: "Bravo" }), owner: P1, zone: "hand" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("a") });
    resolvePendingResponses(engine);
    const afterFirst = engine.getLog().length;
    assert.ok(afterFirst > 0);

    engine.setLogEnabled(false);
    assert.equal(engine.isLogEnabled(), false);

    engine.perform({ type: "playCard", playerId: P1, cardId: id("b") });
    resolvePendingResponses(engine);
    assert.equal(engine.getLog().length, afterFirst, "nothing recorded while disabled");

    engine.setLogEnabled(true);
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    assert.ok(engine.getLog().length > afterFirst, "recording resumed");
    // the earlier entries are still there, seq still gap-free
    engine.getLog().forEach((entry, i) => assert.equal(entry.seq, i + 1));
  });

  test("a decline is recorded so a game reads end-to-end — 'X passes', before what it lets resolve", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "spell", def: tactic({ name: "Spark" }), owner: P1, zone: "hand" }]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("spell") });
    // P2 has the open response window; they decline explicitly.
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
    engine.perform({ type: "passPriority", playerId: P2 });
    resolvePendingResponses(engine);

    const log = engine.getLog();

    const passed = log.find(e => e.marker === "priorityPassed");
    assert.ok(passed, "the pass was logged");
    assert.equal(passed.kind, "info");
    assert.equal(passed.message, "Bob passes");
    // marker-backed, like the other structural entries
    assert.equal(Number(!!passed.event) + Number(!!passed.marker), 1);

    // The decline is logged before the item it let through starts resolving.
    const resolvedIdx = log.findIndex(e => e.marker === "stackItemResolving");
    assert.ok(log.indexOf(passed) < resolvedIdx);
  });

  test("a response nests one level deeper than what it answers; the stack unwinds LIFO in the log", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "alpha", def: tactic({ name: "Alpha" }), owner: P1, zone: "hand" },
        { key: "bravo", def: tactic({ name: "Bravo" }), owner: P2, zone: "hand" },
        { key: "charlie", def: tactic({ name: "Charlie" }), owner: P1, zone: "hand" }
      ]
    });

    // P1 acts; P2 responds; P1 responds to that response.
    engine.perform({ type: "playCard", playerId: P1, cardId: id("alpha") });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("bravo") });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("charlie") });
    resolvePendingResponses(engine);

    const log = engine.getLog();

    const depthOfPlay = (name: string) =>
      log.find(e => e.event?.type === "cardPlayed" && e.message.includes(name))!.depth;

    assert.equal(depthOfPlay("Alpha"), 0);
    assert.equal(depthOfPlay("Bravo"), 1);
    assert.equal(depthOfPlay("Charlie"), 2);

    // "Bravo" was a response — categorized as such, not as a turn action.
    const bravoPlay = log.find(
      e => e.event?.type === "cardPlayed" && e.message.includes("Bravo")
    )!;
    assert.equal(bravoPlay.kind, "response");
    assert.match(bravoPlay.message, /in response/);

    // Exactly one "may respond" bracket — the window is reused, not reopened.
    assert.equal(log.filter(e => e.marker === "responseWindowOpened").length, 1);

    // Resolution markers unwind last-in first-out: Charlie (2), Bravo (1), Alpha (0).
    const resolveDepths = log
      .filter(e => e.marker === "stackItemResolving")
      .map(e => e.depth);
    assert.deepEqual(resolveDepths, [2, 1, 0]);
  });

  test("formatLog indents each line by its depth so nested responses read as nested", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "alpha", def: tactic({ name: "Alpha" }), owner: P1, zone: "hand" },
        { key: "bravo", def: tactic({ name: "Bravo" }), owner: P2, zone: "hand" },
        { key: "charlie", def: tactic({ name: "Charlie" }), owner: P1, zone: "hand" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("alpha") });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("bravo") });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("charlie") });
    resolvePendingResponses(engine);

    const lines = engine.formatLog().split("\n");
    const line = (needle: string) => lines.find(l => l.includes(needle))!;

    assert.ok(indentOf(line("plays Bravo in response")) > indentOf(line("plays Alpha")));
    assert.ok(
      indentOf(line("plays Charlie in response")) > indentOf(line("plays Bravo in response"))
    );
    assert.ok(indentOf(line("Charlie resolves")) > indentOf(line("Alpha resolves")));

    // sinceSeq tails the log
    const tail = engine.formatLog({ sinceSeq: engine.getLog().length - 1 }).split("\n");
    assert.equal(tail.length, 1);
  });

  test("the log is plain serializable data — it round-trips through JSON", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "spell", def: tactic({ name: "Spark" }), owner: P1, zone: "hand" }]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("spell") });
    resolvePendingResponses(engine);

    const roundTripped = JSON.parse(JSON.stringify(engine.state)).gameLog;
    assert.deepEqual(roundTripped, engine.state.gameLog);
  });
});
