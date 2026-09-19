import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  autoResolveBattle,
  buildGame,
  character,
  item,
  P1,
  P2,
  resolvePendingResponses,
  resourceCard,
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
    // the decline names what was on offer, so consecutive passes don't read alike
    assert.equal(passed.message, "Bob passes — no response to Spark");
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

  test("every battle-flow player action is logged — each pass names its window, blocks and damage assignments show", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "attacker", def: character({ name: "Raider", strength: 3 }), owner: P1 }
      ]
    });

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("attacker")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine); // §608.1c window: P1 then P2 pass
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine); // §609.1a + §609.1e windows, damage assignment

    const log = engine.getLog();

    // An unblocked one-attacker battle opens three two-sided response
    // windows; each decline says which one it was, so six "passes" lines
    // don't look like a stuck loop.
    const passes = log.filter(e => e.marker === "priorityPassed").map(e => e.message);
    assert.deepEqual(passes, [
      "Alice passes — no response to the attack",
      "Bob passes — no response to the attack",
      "Alice passes — no response before battle damage is assigned",
      "Bob passes — no response before battle damage is assigned",
      "Alice passes — no response before battle damage is dealt",
      "Bob passes — no response before battle damage is dealt"
    ]);

    const blockers = log.find(e => e.marker === "blockersDeclared");
    assert.ok(blockers, "the block declaration was logged");
    assert.equal(blockers.kind, "battle");
    assert.equal(blockers.message, "Bob declares no blockers");

    const assigned = log.find(e => e.marker === "battleDamageAssigned");
    assert.ok(assigned, "the damage assignment was logged");
    assert.equal(assigned.kind, "battle");
    assert.equal(assigned.message, "Raider assigns 3 battle damage to Bob's faction");

    // still marker-backed and gap-free
    log.forEach((entry, i) => {
      assert.equal(entry.seq, i + 1);
      assert.equal(Number(!!entry.event) + Number(!!entry.marker), 1);
    });
  });

  test("a pass made while a response sits on the stack names that item, not the battle window it's nested in", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "attacker", def: character({ name: "Raider", strength: 3 }), owner: P1 },
        { key: "bravo", def: tactic({ name: "Bravo" }), owner: P2, zone: "hand" },
        { key: "charlie", def: tactic({ name: "Charlie" }), owner: P1, zone: "hand" }
      ]
    });

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("attacker")],
      target: { type: "faction", playerId: P2 }
    });
    // §608.1c window: the attacker declines at the top level, the defender
    // responds, the attacker responds to that, and both then decline in turn.
    engine.perform({ type: "passPriority", playerId: P1 });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("bravo") });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("charlie") });
    engine.perform({ type: "passPriority", playerId: P2 }); // to Charlie
    engine.perform({ type: "advanceFlow" });
    engine.perform({ type: "passPriority", playerId: P1 }); // to Bravo — a second chance to respond to it
    engine.perform({ type: "advanceFlow" });
    engine.perform({ type: "passPriority", playerId: P2 }); // top level again, empty stack

    const passes = engine
      .getLog()
      .filter(e => e.marker === "priorityPassed")
      .map(e => e.message);
    assert.deepEqual(passes, [
      "Alice passes — no response to the attack",
      "Bob passes — no response to Charlie",
      "Alice passes — no response to Bravo",
      "Bob passes — no response to the attack"
    ]);
  });

  test("a resolved tactic's trip to the discard pile is logged — 'resolves' alone doesn't say where the card went", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "spell", def: tactic({ name: "Spark" }), owner: P1, zone: "hand" },
        { key: "chump", def: character({ name: "Chump" }), owner: P2 }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("spell") });
    resolvePendingResponses(engine);

    assert.ok(engine.state.players[P1].discard.includes(id("spell")), "tactic is in discard");

    const disposed = engine
      .getLog()
      .find(e => e.event?.type === "cardMoved" && e.message.includes("Spark"));
    assert.ok(disposed, "the tactic's move to the discard pile was logged");
    assert.equal(disposed.kind, "zone");
    assert.equal(disposed.message, "Spark moves from play to discard");

    // ...and after the "resolves" marker, not before it.
    const log = engine.getLog();
    const resolvedIdx = log.findIndex(e => e.marker === "stackItemResolving");
    assert.ok(log.indexOf(disposed) > resolvedIdx);
  });

  test("an 'Attach to X' card's enter-play line names the host it attached to", () => {
    const buffGear = item({
      name: "Buff Gear",
      attachTo: "character",
      behavior: {
        abilities: [
          {
            id: "buff",
            type: "continuous",
            modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 2 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "spider", def: character({ name: "Sneaking Spitspider", strength: 2 }), owner: P1 },
        { key: "gear", def: buffGear, owner: P2, zone: "hand" }
      ]
    });

    // The only legal attach target on the board is the opponent's character.
    engine.perform({
      type: "playCard",
      playerId: P2,
      cardId: id("gear"),
      selected: { attachTo: [id("spider")] }
    });
    resolvePendingResponses(engine);

    const entered = engine.getLog().find(e => e.event?.type === "cardEnteredPlay");
    assert.ok(entered, "enter-play was logged");
    assert.equal(entered.message, "Buff Gear enters play attached to Sneaking Spitspider");
  });

  test("an attachTo effect re-homing an in-play item is logged as its own line", () => {
    const relocator = item({
      name: "Relocator",
      attachTo: "character",
      behavior: {
        abilities: [
          {
            id: "move-it",
            name: "Move It",
            type: "activated",
            costs: [{ type: "payResources", amount: 1 }],
            targets: [
              { id: "dest", selector: { controller: "self", zone: "play", type: "character" }, count: 1 }
            ],
            effects: [{ type: "attachTo", target: "source", to: { type: "selected", id: "dest" } }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "Alpha" }), owner: P1 },
        { key: "b", def: character({ name: "Bravo" }), owner: P1 },
        { key: "gear", def: relocator, owner: P1, attachedToKey: "a" },
        { key: "r1", def: resourceCard({ name: "R1" }), owner: P1 }
      ]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("gear"),
      abilityId: "move-it",
      selected: { dest: [id("b")] }
    });
    resolvePendingResponses(engine);

    const attached = engine.getLog().find(e => e.event?.type === "cardAttached");
    assert.ok(attached, "the re-attach was logged");
    assert.equal(attached.kind, "zone");
    assert.equal(attached.message, "Relocator attaches to Bravo");
  });

  test("a non-damage influence change is logged — 'X loses/gains N influence'", () => {
    const burn = tactic({
      name: "Influence Burn",
      behavior: {
        abilities: [
          {
            id: "burn",
            type: "activated",
            effects: [{ type: "modifyInfluence", player: "opponent", amount: -3 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      playerB: { influence: 25 },
      cards: [{ key: "burn", def: burn, owner: P1, zone: "hand" }]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("burn") });
    resolvePendingResponses(engine);

    const inf = engine.getLog().find(e => e.event?.type === "influenceChanged");
    assert.ok(inf, "the influence change was logged");
    assert.equal(inf.message, "Bob's faction loses 3 influence (now 22)");
  });

  test("a createModifier stat change is logged — the reader can see why a stat moved", () => {
    const debuff = tactic({
      name: "Wither",
      behavior: {
        abilities: [
          {
            id: "wither",
            type: "activated",
            targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [
              {
                type: "createModifier",
                target: { type: "selected", id: "t" },
                stat: "strength",
                operation: "add",
                value: -2,
                duration: { type: "untilEndOfTurn" }
              }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "wither", def: debuff, owner: P1, zone: "hand" },
        { key: "grunt", def: character({ name: "Grunt", strength: 5 }), owner: P2 }
      ]
    });

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("wither"),
      selected: { t: [id("grunt")] }
    });
    resolvePendingResponses(engine);

    const mod = engine.getLog().find(e => e.event?.type === "statModified");
    assert.ok(mod, "the stat change was logged");
    assert.equal(mod.message, "Grunt gets -2 strength");
  });

  test("the game ending is logged — a faction at 0 influence is the whole point of the game", () => {
    const finisher = tactic({
      name: "Finisher",
      behavior: {
        abilities: [
          {
            id: "k",
            type: "activated",
            effects: [{ type: "modifyInfluence", player: "opponent", amount: -5 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      playerB: { influence: 3 },
      cards: [{ key: "k", def: finisher, owner: P1, zone: "hand" }]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("k") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.winner, P1);
    const over = engine.getLog().find(e => e.event?.type === "gameEnded");
    assert.ok(over, "the game-over was logged");
    assert.equal(over.message, "Game over — Alice wins");
  });

  test("a card's own rolled variable is logged — 'flip a coin; X is 1 or 2' otherwise leaves no trace", () => {
    const gamble = tactic({
      name: "Gamble",
      behavior: {
        abilities: [
          {
            id: "gamble",
            type: "activated",
            variables: { x: { type: "random", min: 1, max: 2 } },
            effects: [{ type: "modifyInfluence", player: "opponent", amount: -1 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [{ key: "g", def: gamble, owner: P1, zone: "hand" }]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("g") });
    resolvePendingResponses(engine);

    const rolled = engine.getLog().find(e => e.event?.type === "variableRolled");
    assert.ok(rolled, "the roll was logged");
    assert.equal(rolled.kind, "info");
    assert.match(rolled.message, /^Gamble flips a coin: X is [12]$/);
    assert.ok(
      rolled.event?.type === "variableRolled" &&
        rolled.event.name === "x" &&
        rolled.event.value >= 1 &&
        rolled.event.value <= 2
    );
    // the roll is an EXTRA COST — paid as the card is played, so it lands
    // before the card starts resolving off the stack.
    const log = engine.getLog();
    assert.ok(log.indexOf(rolled) < log.findIndex(e => e.marker === "stackItemResolving"));
  });

  test("a player-chosen bounded variable ('pick a number for X, X <= [O] you control') is logged with its pick and range", () => {
    const desolate = tactic({
      name: "Desolate",
      behavior: {
        abilities: [
          {
            id: "desolate",
            type: "activated",
            variableBounds: {
              x: { max: { type: "resourceIcons", player: "controller", icon: "obsession" } }
            },
            effects: [
              { type: "modifyInfluence", player: "controller", amount: { type: "variable", id: "x" } }
            ]
          }
        ]
      }
    });
    const obs = () =>
      resourceCard({
        name: "Obsession",
        id: "o-log",
        resource: { provides: ["obsession"], staple: true }
      });

    const { engine, id } = buildGame({
      cards: [
        { key: "des", def: desolate, owner: P1, zone: "hand" },
        { key: "o1", def: obs(), owner: P1 },
        { key: "o2", def: obs(), owner: P1 }
      ],
      playerA: { influence: 20 }
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("des"), variables: { x: 2 } });
    resolvePendingResponses(engine);

    const chosen = engine.getLog().find(e => e.event?.type === "variableChosen");
    assert.ok(chosen, "the pick was logged");
    assert.equal(chosen.kind, "info");
    assert.equal(chosen.depth, 0);
    assert.equal(chosen.message, "Alice picks X = 2 for Desolate (0–2)");
    assert.ok(
      chosen.event?.type === "variableChosen" &&
        chosen.event.name === "x" &&
        chosen.event.playerId === P1 &&
        chosen.event.value === 2 &&
        chosen.event.min === 0 &&
        chosen.event.max === 2
    );
    // the pick is an EXTRA COST — settled as the card is played, so it lands
    // before the card starts resolving off the stack.
    const log = engine.getLog();
    assert.ok(log.indexOf(chosen) < log.findIndex(e => e.marker === "stackItemResolving"));
  });

  test("a rolled variable outside the 1–2 coin range reads as a die roll over its bounds", () => {
    const spread = tactic({
      name: "Spread",
      behavior: {
        abilities: [
          {
            id: "spread",
            type: "activated",
            variables: { n: { type: "random", min: 1, max: 3 } },
            effects: [{ type: "modifyInfluence", player: "opponent", amount: -1 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [{ key: "s", def: spread, owner: P1, zone: "hand" }]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("s") });
    resolvePendingResponses(engine);

    const rolled = engine.getLog().find(e => e.event?.type === "variableRolled");
    assert.ok(rolled);
    assert.match(rolled.message, /^Spread rolls N = [123] \(1–3\)$/);
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
