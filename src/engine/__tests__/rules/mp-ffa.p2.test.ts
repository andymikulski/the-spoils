// Multiplayer (free-for-all) rules, part 2: responding, priority and ending a turn.
// Atoms: data/rule-tests/source/multiplayer.txt (batch mp-ffa): MPX-respond, MPX-priority, MPX-endturn, MPX-turn.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { SpoilsEngine } from "../../../engine.js";
import { buildGame, character, noDevelopFaction, P1, P2, P3, P4, resolvePendingResponses, tactic } from "../support/fixtures.js";
import { refused, rule } from "./_rule.js";

const blank = (name: string) => tactic({ name });

/** Three seats whose factions have no develop rule, so turns can be passed around without start-of-turn prompts. */
const plainSeats = (count: number) => ({
  playerA: { faction: noDevelopFaction() },
  playerB: { faction: noDevelopFaction() },
  extraPlayers: Array.from({ length: count - 2 }, () => ({ faction: noDevelopFaction() }))
});

const priority = (engine: SpoilsEngine) => engine.state.responseWindow?.priorityPlayerId;
const pass = (engine: SpoilsEngine, playerId: string) => engine.perform({ type: "passPriority", playerId });

describe("MPX-priority — the top item is offered clockwise to everyone but its controller", () => {
  rule(["MPX-respond", "MPX-priority"], "3 seats: P1's card is offered to P2, then P3, and resolves once both have passed", () => {
    const { engine, id } = buildGame({
      extraPlayers: [{}],
      cards: [{ key: "opener", def: blank("Opener"), owner: P1, zone: "hand" }]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("opener") });
    assert.equal(priority(engine), P2, "first offer goes to the seat after P1");
    pass(engine, P2);
    assert.equal(engine.state.responseWindow?.phase, "acceptingResponses", "P3 has not had the offer yet");
    assert.equal(priority(engine), P3, "then clockwise to P3");
    assert.equal(engine.state.responseStack.length, 1, "nothing resolved after one pass");
    pass(engine, P3);
    assert.equal(engine.state.responseWindow?.phase, "resolving", "every other player passed in a row");
    engine.perform({ type: "advanceFlow" });
    assert.equal(engine.state.cards[id("opener")].zone, "discard", "the tactic resolved");
    assert.equal(engine.state.responseWindow, undefined, "the window closed");
  });

  rule("MPX-priority", "4 seats: the offer runs P2, P3, P4 and never reaches the controller", () => {
    const { engine, id } = buildGame({
      extraPlayers: [{}, {}],
      cards: [{ key: "opener", def: blank("Opener"), owner: P1, zone: "hand" }]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("opener") });
    const offered: string[] = [];
    while (engine.state.responseWindow?.phase === "acceptingResponses") {
      const who = priority(engine)!;
      offered.push(who);
      pass(engine, who);
    }
    assert.deepEqual(offered, [P2, P3, P4], "clockwise from P1's left, P1 skipped");
  });

  rule("MPX-priority", "a response restarts the offer from the responder's left; afterwards the responder answers the item beneath first", () => {
    const { engine, id } = buildGame({
      extraPlayers: [{}],
      cards: [
        { key: "opener", def: blank("Opener"), owner: P1, zone: "hand" },
        { key: "reply", def: blank("Reply"), owner: P3, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("opener") });
    pass(engine, P2);
    assert.equal(priority(engine), P3, "P3 is offered P1's card");
    engine.perform({ type: "playCard", playerId: P3, cardId: id("reply") });
    assert.equal(engine.state.responseStack.length, 2, "P3's reply is on top");
    assert.equal(priority(engine), P1, "the reply is offered first to the seat after P3: P1");
    pass(engine, P1);
    assert.equal(priority(engine), P2, "then P2 (P2's earlier pass was on a different item)");
    pass(engine, P2);
    assert.equal(engine.state.responseWindow?.phase, "resolving", "P3's reply resolves");
    engine.perform({ type: "advanceFlow" });
    assert.equal(engine.state.cards[id("reply")].zone, "discard", "the reply resolved");
    assert.equal(engine.state.responseStack.length, 1, "P1's card is still waiting");
    assert.equal(priority(engine), P3, "the maker of the resolved reply is offered P1's card first (CR 607.2)");
    pass(engine, P3);
    assert.equal(priority(engine), P2, "then the rest clockwise, skipping the controller P1: P2 again");
    pass(engine, P2);
    assert.equal(engine.state.responseWindow?.phase, "resolving", "everyone else passed in a row on P1's card");
  });

  rule("MPX-respond", "you cannot respond to your own item, even at 3 seats", () => {
    const { engine, id } = buildGame({
      extraPlayers: [{}],
      cards: [
        { key: "opener", def: blank("Opener"), owner: P1, zone: "hand" },
        { key: "own", def: blank("Own"), owner: P1, zone: "hand" },
        { key: "reply", def: blank("Reply"), owner: P2, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("opener") });
    refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("own") }), "the controller may not respond to their own card", /priority/i);
    engine.perform({ type: "playCard", playerId: P2, cardId: id("reply") });
    assert.equal(engine.state.responseStack.length, 2, "control: an opponent holding the offer may respond");
  });

  rule(["MPX-priority", "MPX-elim"], "a player who has lost is never offered the item", () => {
    const { engine, id } = buildGame({
      extraPlayers: [{}, {}],
      cards: [{ key: "opener", def: blank("Opener"), owner: P1, zone: "hand" }]
    });
    engine.state.players[P3].eliminated = { turn: 1 };
    engine.perform({ type: "playCard", playerId: P1, cardId: id("opener") });
    assert.equal(priority(engine), P2, "P2 first");
    pass(engine, P2);
    assert.equal(priority(engine), P4, "P3 is skipped");
    pass(engine, P4);
    assert.equal(engine.state.responseWindow?.phase, "resolving", "P2 and P4 are everyone left");
  });
});

describe("MPX-endturn / MPX-turn — ending a turn and passing it clockwise", () => {
  rule(["MPX-endturn", "MPX-turn"], "3 seats: every other player may respond to the end of P1's turn, then the turn passes to P2, then P3, then P1", () => {
    const { engine } = buildGame(plainSeats(3));
    engine.perform({ type: "endTurn", playerId: P1 });
    assert.equal(priority(engine), P2, "P2 answers the end of turn first");
    pass(engine, P2);
    assert.equal(priority(engine), P3, "then P3");
    resolvePendingResponses(engine);
    assert.equal(engine.state.activePlayerId, P2, "the turn passes to the seat after P1");
    engine.perform({ type: "endTurn", playerId: P2 });
    assert.equal(priority(engine), P3, "P3 answers P2's end of turn first");
    pass(engine, P3);
    assert.equal(priority(engine), P1, "then P1");
    resolvePendingResponses(engine);
    assert.equal(engine.state.activePlayerId, P3, "then P3's turn");
    engine.perform({ type: "endTurn", playerId: P3 });
    resolvePendingResponses(engine);
    assert.equal(engine.state.activePlayerId, P1, "and around to P1");
  });

  rule(["MPX-turn", "MPX-seat"], "the turn skips a player who has lost", () => {
    const { engine } = buildGame(plainSeats(3));
    engine.state.players[P2].eliminated = { turn: 1 };
    engine.perform({ type: "endTurn", playerId: P1 });
    assert.equal(priority(engine), P3, "only P3 answers");
    pass(engine, P3);
    resolvePendingResponses(engine);
    assert.equal(engine.state.activePlayerId, P3, "P2's seat is skipped");
  });
});

describe("MPX-attack — whom you may attack", () => {
  const attacker = () => character({ name: "Attacker", strength: 1, life: 2, speed: 1 });

  rule("MPX-attack", "you may attack any opponent's faction, but not an unknown player or one who has lost", () => {
    const build = () =>
      buildGame({ ...plainSeats(3), cards: [{ key: "atk", def: attacker(), owner: P1, zone: "play" }] });
    const ok = build();
    ok.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [ok.id("atk")], target: { type: "faction", playerId: P3 } });
    assert.equal(ok.engine.state.battle?.defenderPlayerId, P3, "control: P3, not the seat after P1, can be attacked");

    const unknown = build();
    refused(
      () => unknown.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [unknown.id("atk")], target: { type: "faction", playerId: "nobody" } }),
      "an attack must name a player in the game",
      /Unknown player/
    );

    const lost = build();
    lost.engine.state.players[P3].eliminated = { turn: 1 };
    refused(
      () => lost.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [lost.id("atk")], target: { type: "faction", playerId: P3 } }),
      "a player who has lost cannot be attacked",
      /out of the game/
    );
  });
});

describe("MPX-attack-default — no default target with two or more opponents", () => {
  rule(["MPX-attack-default", "CR 608.1a"], "3 seats: an attack naming no target is refused; once one opponent is left it defaults to that faction", () => {
    const build = () =>
      buildGame({ ...plainSeats(3), cards: [{ key: "atk", def: character({ name: "Attacker", strength: 1, life: 2, speed: 1 }), owner: P1, zone: "play" }] });
    const two = build();
    refused(
      () => two.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [two.id("atk")] }),
      "two opponents: the attacker must choose",
      /Choose a target/
    );
    const one = build();
    one.engine.state.players[P2].eliminated = { turn: 1 };
    one.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [one.id("atk")] });
    assert.equal(one.engine.state.battle?.defenderPlayerId, P3, "control: the only opponent left is the default");
  });
});
