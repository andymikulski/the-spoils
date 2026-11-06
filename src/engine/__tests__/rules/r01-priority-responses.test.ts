// Batch r01-priority-responses (docs/TESTING.md): CR 607 Responding to Actions, CR 610 Ending a Turn.
// Written from the wording of the Comprehensive Rules, not from the engine.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { SpoilsEngine, TargetDeclaration } from "../../../engine.js";
import { buildGame, character, P1, P2, resolvePendingResponses, tactic } from "../support/fixtures.js";
import { refused, rule } from "./_rule.js";

const TARGET: TargetDeclaration[] = [{ id: "t", selector: {}, count: 1 }];

/** A tactic with no effect: all that matters is that it is deployed and resolves. */
const blank = (name: string) => tactic({ name });

/** A tactic that deals 1 damage to the opponent's faction. */
const ping = (name: string) =>
  tactic({
    name,
    behavior: { abilities: [{ id: "a", type: "activated", effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 1 }] }] }
  });

/** A character with an activated ability that draws a card. */
const drawer = (name: string) =>
  character({ name, behavior: { abilities: [{ id: "go", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });

/** A tactic that destroys the card picked for target `t`. */
const destroyer = (name: string) =>
  tactic({ name, behavior: { abilities: [{ id: "a", type: "activated", targets: TARGET, effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } });

const zone = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId]!.zone;

describe("CR 607 — responding to actions", () => {
  rule("CR 607.1", "the opponent can respond to a deployed card: they get priority and may deploy a tactic", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "opener", def: blank("Opener"), owner: P1, zone: "hand" },
        { key: "reply", def: blank("Reply"), owner: P2, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("opener") });
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent holds priority");
    engine.perform({ type: "playCard", playerId: P2, cardId: id("reply") });
    assert.equal(engine.state.responseStack.length, 2, "the response is on the stack above the original card");
  });

  rule("CR 607.1", "the opponent can respond to an ability being used", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "source", def: drawer("Source"), owner: P1 },
        { key: "reply", def: blank("Reply"), owner: P2, zone: "hand" }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("source"), abilityId: "go" });
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
    engine.perform({ type: "playCard", playerId: P2, cardId: id("reply") });
    assert.equal(engine.state.responseStack.length, 2);
  });

  rule("CR 607.1", "the opponent can respond to a player announcing the end of their turn", () => {
    const { engine, id } = buildGame({ cards: [{ key: "reply", def: blank("Reply"), owner: P2, zone: "hand" }] });
    engine.perform({ type: "endTurn", playerId: P1 });
    assert.equal(engine.state.responseWindow?.kind, "endTurn");
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
    engine.perform({ type: "playCard", playerId: P2, cardId: id("reply") });
    assert.equal(engine.state.responseStack.length, 1, "the response is waiting to resolve");
    resolvePendingResponses(engine);
    assert.equal(zone(engine, id("reply")), "discard", "the response resolved");
  });

  rule("CR 607.1", "you cannot respond to your own card: the player who deployed it can neither pass nor deploy a tactic onto it", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "opener", def: blank("Opener"), owner: P1, zone: "hand" },
        { key: "mine", def: blank("Mine"), owner: P1, zone: "hand" },
        { key: "theirs", def: blank("Theirs"), owner: P2, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("opener") });
    refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("mine") }), "own tactic as a response to own card", /priority/);
    refused(() => engine.perform({ type: "passPriority", playerId: P1 }), "pass priority on own card", /priority/);
    engine.perform({ type: "playCard", playerId: P2, cardId: id("theirs") });
    assert.equal(engine.state.responseStack.length, 2, "control: the opponent could respond");
  });

  rule("CR 607.1", "you cannot respond to your own ability: the player who used it cannot use another ability on it", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: drawer("A"), owner: P1 },
        { key: "b", def: drawer("B"), owner: P1 },
        { key: "c", def: drawer("C"), owner: P2 }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("a"), abilityId: "go" });
    refused(() => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("b"), abilityId: "go" }), "own ability in response to own ability", /timing|priority/);
    engine.perform({ type: "activateAbility", playerId: P2, cardId: id("c"), abilityId: "go" });
    assert.equal(engine.state.responseStack.length, 2, "control: the opponent could respond");
  });

  rule("CR 607.1", "you cannot respond to your own end-of-turn announcement", () => {
    const { engine, id } = buildGame({ cards: [{ key: "mine", def: blank("Mine"), owner: P1, zone: "hand" }] });
    engine.perform({ type: "endTurn", playerId: P1 });
    refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("mine") }), "own tactic after announcing end of turn", /priority/);
    refused(() => engine.perform({ type: "passPriority", playerId: P1 }), "pass priority after announcing end of turn", /priority/);
  });

  rule("CR 607.2", "a response may be a tactic or an ability", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "opener", def: blank("Opener"), owner: P1, zone: "hand" },
        { key: "source", def: drawer("Source"), owner: P2 }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("opener") });
    engine.perform({ type: "activateAbility", playerId: P2, cardId: id("source"), abilityId: "go" });
    assert.equal(engine.state.responseStack.length, 2, "the ability is a response above the card");
  });

  rule("CR 607.2", "the original action resolves only after the responder has finished responding (passed)", () => {
    const { engine, id } = buildGame({ cards: [{ key: "opener", def: ping("Opener"), owner: P1, zone: "hand" }] });
    const before = engine.state.players[P2].influence;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("opener") });
    assert.equal(engine.state.players[P2].influence, before, "nothing has happened while the opponent may still respond");
    engine.perform({ type: "passPriority", playerId: P2 });
    engine.perform({ type: "advanceFlow" });
    assert.equal(engine.state.players[P2].influence, before - 1, "it resolves once the opponent is done");
  });

  rule("CR 607.2", "once a response resolves the responder may make another response, any number of times, before the original resolves", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: ping("A"), owner: P1, zone: "hand" },
        { key: "r1", def: blank("R1"), owner: P2, zone: "hand" },
        { key: "r2", def: blank("R2"), owner: P2, zone: "hand" },
        { key: "r3", def: blank("R3"), owner: P2, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("a") });
    for (const key of ["r1", "r2", "r3"]) {
      engine.perform({ type: "playCard", playerId: P2, cardId: id(key) });
      engine.perform({ type: "passPriority", playerId: P1 });
      engine.perform({ type: "advanceFlow" });
      assert.equal(zone(engine, id(key)), "discard", `${key} resolved`);
      assert.equal(zone(engine, id("a")), "deploying", "the original action is still waiting");
      assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond again");
    }
    resolvePendingResponses(engine);
    assert.equal(zone(engine, id("a")), "discard");
  });

  rule(["CR 607.2a", "CR 607.2b"], "responses go back and forth and resolve one at a time, last in first out", () => {
    // P1 A, P2 B (to A), P1 C (to B), P2 D (to C): they resolve D, C, B, A.
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: blank("A"), owner: P1, zone: "hand" },
        { key: "b", def: blank("B"), owner: P2, zone: "hand" },
        { key: "c", def: blank("C"), owner: P1, zone: "hand" },
        { key: "d", def: blank("D"), owner: P2, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("a") });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("b") });
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "the original actor may respond to the response");
    engine.perform({ type: "playCard", playerId: P1, cardId: id("c") });
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "and the opponent to that");
    engine.perform({ type: "playCard", playerId: P2, cardId: id("d") });
    assert.equal(engine.state.responseStack.length, 4);

    const resolved: string[] = [];
    while (engine.state.responseWindow) {
      const window = engine.state.responseWindow;
      if (window.phase === "acceptingResponses") engine.perform({ type: "passPriority", playerId: window.priorityPlayerId });
      else {
        engine.perform({ type: "advanceFlow" });
        for (const key of ["d", "c", "b", "a"]) if (zone(engine, id(key)) === "discard" && !resolved.includes(key)) resolved.push(key);
      }
    }
    assert.deepEqual(resolved, ["d", "c", "b", "a"]);
  });

  rule("CR 607.2b", "there is no priority passing: you respond only to the opponent's latest item, and an item resolves before the one beneath it", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: blank("A"), owner: P1, zone: "hand" },
        { key: "b", def: blank("B"), owner: P2, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("a") });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("b") });
    engine.perform({ type: "passPriority", playerId: P1 });
    engine.perform({ type: "advanceFlow" });
    assert.equal(zone(engine, id("b")), "discard", "B resolved first");
    assert.equal(zone(engine, id("a")), "deploying", "A is still beneath");
  });

  rule("CR 607.2c", "triggers cannot be responded to: a trigger resolves immediately with no response window and no stack item", () => {
    const watcher = character({
      name: "Watcher",
      behavior: {
        abilities: [{ id: "t", type: "triggered", event: "turnEnding", effects: [{ type: "modifyInfluence", player: "controller", amount: 3 }] }]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "watcher", def: watcher, owner: P1 },
        { key: "reply", def: blank("Reply"), owner: P2, zone: "hand" }
      ]
    });
    const before = engine.state.players[P1].influence;
    engine.perform({ type: "endTurn", playerId: P1 });
    engine.perform({ type: "passPriority", playerId: P2 });
    engine.perform({ type: "advanceFlow" });
    assert.equal(engine.state.players[P1].influence, before + 3, "the trigger resolved");
    assert.ok(!engine.state.responseStack.some((item) => item.sourceId === id("watcher")), "the trigger was never put on the response stack");
    assert.equal(engine.state.responseStack.length, 0, "no stack item or window is left over for the trigger");
  });

  rule("CR 607.2c", "actions resolve last in, first out, as a stack does", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: blank("A"), owner: P1, zone: "hand" },
        { key: "b", def: blank("B"), owner: P2, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("a") });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("b") });
    assert.deepEqual(engine.state.responseStack.map((item) => item.sourceId), [id("a"), id("b")], "B sits on top of A");
  });
});

describe("CR 610 — ending a turn", () => {
  rule("CR 610.1", "announcing the end of the turn does not end it: the same player is still active until the opponent has had a chance to respond", () => {
    const { engine } = buildGame({ cards: [] });
    const turn = engine.state.turn;
    engine.perform({ type: "endTurn", playerId: P1 });
    assert.equal(engine.state.activePlayerId, P1);
    assert.equal(engine.state.turn, turn);
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent has a chance to respond");
  });

  rule("CR 610.1", "once the opponent's responses are complete the turn ends and the opponent becomes the active player", () => {
    const { engine, id } = buildGame({ cards: [{ key: "reply", def: blank("Reply"), owner: P2, zone: "hand" }] });
    const turn = engine.state.turn;
    engine.perform({ type: "endTurn", playerId: P1 });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("reply") });
    engine.perform({ type: "passPriority", playerId: P1 });
    engine.perform({ type: "advanceFlow" });
    assert.equal(engine.state.activePlayerId, P1, "still P1's turn while the opponent may make more responses");
    assert.equal(engine.state.turn, turn);
    resolvePendingResponses(engine);
    assert.equal(engine.state.activePlayerId, P2);
    assert.equal(engine.state.turn, turn + 1);
  });

  rule("CR 610.1", "the active player cannot take further actions after announcing the end of the turn (control: they can before)", () => {
    const { engine, id } = buildGame({ cards: [{ key: "mine", def: blank("Mine"), owner: P1, zone: "hand" }] });
    // Control: before announcing, the active player can deploy.
    const control = buildGame({ cards: [{ key: "mine", def: blank("Mine"), owner: P1, zone: "hand" }] });
    control.engine.perform({ type: "playCard", playerId: P1, cardId: control.id("mine") });
    assert.equal(control.engine.state.responseStack.length, 1);
    engine.perform({ type: "endTurn", playerId: P1 });
    refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("mine") }), "deploy after announcing end of turn", /priority/);
  });

  rule("CR 610.1a", "end-of-turn triggers do not happen when the end of turn is announced, only after the opponent's responses", () => {
    const watcher = character({
      name: "Watcher",
      behavior: { abilities: [{ id: "t", type: "triggered", event: "turnEnding", effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }] }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "watcher", def: watcher, owner: P1 },
        { key: "reply", def: blank("Reply"), owner: P2, zone: "hand" }
      ]
    });
    const before = engine.state.players[P1].influence;
    engine.perform({ type: "endTurn", playerId: P1 });
    assert.equal(engine.state.players[P1].influence, before, "not at the announcement");
    engine.perform({ type: "playCard", playerId: P2, cardId: id("reply") });
    engine.perform({ type: "passPriority", playerId: P1 });
    engine.perform({ type: "advanceFlow" });
    assert.equal(engine.state.players[P1].influence, before, "not after the opponent's response resolves");
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, before + 1, "at the moment the turn actually ends");
  });

  rule("CR 610.1a", "an end-of-turn trigger's source destroyed by an opponent's response never triggers", () => {
    const watcher = character({
      name: "Watcher",
      behavior: { abilities: [{ id: "t", type: "triggered", event: "turnEnding", effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }] }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "watcher", def: watcher, owner: P1 },
        { key: "kill", def: destroyer("Kill"), owner: P2, zone: "hand" }
      ]
    });
    const before = engine.state.players[P1].influence;
    engine.perform({ type: "endTurn", playerId: P1 });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("kill"), selected: { t: [id("watcher")] } });
    resolvePendingResponses(engine);
    assert.equal(zone(engine, id("watcher")), "discard", "the response destroyed the source");
    assert.equal(engine.state.players[P1].influence, before, "so the trigger never happened");
  });
});
