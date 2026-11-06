// Batch r05-abilities (docs/TESTING.md): CR 506 Replacements.
// Written from the wording of the Comprehensive Rules, not from the engine.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine, TriggeredAbility } from "../../../engine.js";
import { buildGame, character, item, P1, P2, resolvePendingResponses, tactic } from "../support/fixtures.js";
import { rule } from "./_rule.js";

const zoneOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId]!.zone;
const influence = (engine: SpoilsEngine, playerId: PlayerId) => engine.state.players[playerId].influence;

/** A tactic that destroys the card picked for target `t`. */
const destroyer = (name: string) =>
  tactic({
    name,
    behavior: {
      abilities: [
        {
          id: "a",
          type: "activated",
          targets: [{ id: "t", selector: {}, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

/** A tactic that inflicts `amount` damage to the card picked for target `t`. */
const damager = (name: string, amount: number) =>
  tactic({
    name,
    behavior: {
      abilities: [
        {
          id: "a",
          type: "activated",
          targets: [{ id: "t", selector: { type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });

/** "If a character you control would be destroyed, instead its controller gains `amount` influence." (the character stays in play) */
const shield = (name: string, amount: number, controlledBy: "self" | "any" = "self") =>
  item({
    name,
    behavior: {
      abilities: [
        {
          id: "ward",
          type: "replacement",
          replaces: { event: "destroy", cardType: "character", controlledBy },
          effects: [{ type: "modifyInfluence", player: "controller", amount }]
        }
      ]
    }
  });

/** Fires (+1 influence to its controller) whenever any card is put into a discard pile. */
const DISCARD_WATCHER: TriggeredAbility = {
  id: "watch",
  type: "triggered",
  event: "cardMoved",
  condition: { type: "cardMovedToZone", zone: "discard" },
  effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }]
};

/** Fires (+1 influence to its controller) whenever any card is destroyed. */
const DESTROY_WATCHER: TriggeredAbility = {
  id: "watch-destroy",
  type: "triggered",
  event: "cardDestroyed",
  effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }]
};

const watcher = (name: string, ability: TriggeredAbility): CardDefinition => item({ name, behavior: { abilities: [ability] } });

/** The first player casts `tacticKey` at `targetKey` and everything resolves. */
function cast(engine: SpoilsEngine, id: (key: string) => CardInstanceId, tacticKey: string, targetKey: string): void {
  engine.perform({ type: "playCard", playerId: P1, cardId: id(tacticKey), selected: { t: [id(targetKey)] } });
  resolvePendingResponses(engine);
}

describe("CR 506 — replacements", () => {
  /** "If this card would be put into your discard pile from play, remove it from the game instead." (the printed example) */
  const fragile = () =>
    character({
      name: "Fragile",
      behavior: {
        abilities: [
          {
            id: "fragile",
            type: "replacement",
            replaces: { event: "moveToZone", zone: "discard", from: "play", controlledBy: "self" },
            condition: { type: "isCard", target: { type: "selected", id: "__candidate" }, other: "source" },
            effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "removed" }]
          }
        ]
      }
    });

  rule("CR 506.1", "example: a card that would go to the discard pile from play is removed from the game instead, never reaching the discard pile", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "fragile", def: fragile(), owner: P1 },
        { key: "watcher", def: watcher("Watcher", DISCARD_WATCHER), owner: P1 },
        { key: "kill", def: destroyer("Kill"), owner: P1, zone: "hand" }
      ]
    });
    const before = influence(engine, P1);
    cast(engine, id, "kill", "fragile");
    assert.equal(zoneOf(engine, id("fragile")), "removed", "it was removed from the game");
    assert.ok(!engine.state.players[P1].discard.includes(id("fragile")), "it is not in the discard pile list");
    assert.equal(influence(engine, P1), before + 1, "only the destroyed tactic reached the discard pile; the replaced card never did");
  });

  rule("CR 506.1", "the replacement only covers what it says: a card moved to the discard pile from the hand is not replaced (control: from play it is)", () => {
    const discardFromHand = tactic({
      name: "Discard It",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [{ id: "t", selector: { zone: "hand", name: "Fragile" }, count: 1 }],
            effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "discard" }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "fragile", def: fragile(), owner: P1, zone: "hand" },
        { key: "discard", def: discardFromHand, owner: P1, zone: "hand" }
      ]
    });
    cast(engine, id, "discard", "fragile");
    assert.equal(zoneOf(engine, id("fragile")), "discard", "from the hand it went to the discard pile as normal");
  });

  rule("CR 506.1", "a replaced event is completely replaced: a destroyed character that is saved was not destroyed, so no 'when a card is destroyed' trigger happens", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "victim", def: character({ name: "Victim" }), owner: P1 },
        { key: "shield", def: shield("Shield", 2), owner: P1 },
        { key: "watcher", def: watcher("Watcher", DESTROY_WATCHER), owner: P1 },
        { key: "kill", def: destroyer("Kill"), owner: P1, zone: "hand" }
      ]
    });
    const before = influence(engine, P1);
    cast(engine, id, "kill", "victim");
    assert.equal(zoneOf(engine, id("victim")), "play", "the destruction did not happen");
    assert.equal(influence(engine, P1), before + 2, "the replacement's effect happened, and the watcher saw no destruction");
  });

  rule("CR 506.1", "control: with no replacement the same destruction happens and the watcher sees it", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "victim", def: character({ name: "Victim" }), owner: P1 },
        { key: "watcher", def: watcher("Watcher", DESTROY_WATCHER), owner: P1 },
        { key: "kill", def: destroyer("Kill"), owner: P1, zone: "hand" }
      ]
    });
    const before = influence(engine, P1);
    cast(engine, id, "kill", "victim");
    assert.equal(zoneOf(engine, id("victim")), "discard");
    assert.equal(influence(engine, P1), before + 1, "one destruction seen");
  });

  rule("CR 506.1", "a replacement applies only to what it names: an opposing character and an item are destroyed normally", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "foe", def: character({ name: "Foe" }), owner: P2 },
        { key: "gizmo", def: item({ name: "Gizmo" }), owner: P1 },
        { key: "shield", def: shield("Shield", 2), owner: P1 },
        { key: "kill1", def: destroyer("Kill 1"), owner: P1, zone: "hand" },
        { key: "kill2", def: destroyer("Kill 2"), owner: P1, zone: "hand" }
      ]
    });
    cast(engine, id, "kill1", "foe");
    assert.equal(zoneOf(engine, id("foe")), "discard", "the opponent's character is not covered by 'a character you control'");
    cast(engine, id, "kill2", "gizmo");
    assert.equal(zoneOf(engine, id("gizmo")), "discard", "an item is not a character");
  });

  // Rule 506.2: replacements do not apply to extra costs.
  const sacrifice = () =>
    tactic({
      name: "Sacrifice",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [{ id: "t", selector: { controller: "self", type: "character" }, count: 1 }],
            costs: [{ type: "destroy", target: { type: "selected", id: "t" } }],
            effects: []
          }
        ]
      }
    });

  rule("CR 506.2", "destroying a card as an extra cost is not replaced: the saved-by-replacement character is destroyed when it is the cost", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "victim", def: character({ name: "Victim" }), owner: P1 },
        { key: "shield", def: shield("Shield", 2), owner: P1 },
        { key: "sacrifice", def: sacrifice(), owner: P1, zone: "hand" }
      ]
    });
    const before = influence(engine, P1);
    cast(engine, id, "sacrifice", "victim");
    assert.equal(zoneOf(engine, id("victim")), "discard", "the cost destroyed it");
    assert.equal(influence(engine, P1), before, "the replacement did not apply to the cost");
  });

  rule("CR 506.2", "control: the same destruction as an effect IS replaced", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "victim", def: character({ name: "Victim" }), owner: P1 },
        { key: "shield", def: shield("Shield", 2), owner: P1 },
        { key: "kill", def: destroyer("Kill"), owner: P1, zone: "hand" }
      ]
    });
    const before = influence(engine, P1);
    cast(engine, id, "kill", "victim");
    assert.equal(zoneOf(engine, id("victim")), "play");
    assert.equal(influence(engine, P1), before + 2);
  });

  const voidInsteadOfDiscard = () =>
    item({
      name: "Void Maw",
      behavior: {
        abilities: [
          {
            id: "maw",
            type: "replacement",
            replaces: { event: "moveToZone", zone: "discard", from: "hand", controlledBy: "self" },
            effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "void" }]
          }
        ]
      }
    });

  rule("CR 506.2", "discarding a card as an extra cost is not replaced ('if you would discard, void it instead' does not apply)", () => {
    const discardCost = tactic({
      name: "Pay With Card",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            costs: [{ type: "discard", id: "d", player: "controller", selector: { zone: "hand", name: "Fodder" }, count: 1 }],
            effects: []
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "maw", def: voidInsteadOfDiscard(), owner: P1 },
        { key: "fodder", def: character({ name: "Fodder" }), owner: P1, zone: "hand" },
        { key: "pay", def: discardCost, owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("pay"), selected: { d: [id("fodder")] } });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("fodder")), "discard", "the discard cost put it in the discard pile");
  });

  rule("CR 506.2", "control: the same hand-to-discard move as an effect is replaced", () => {
    const discardEffect = tactic({
      name: "Discard It",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [{ id: "t", selector: { zone: "hand", name: "Fodder" }, count: 1 }],
            effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "discard" }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "maw", def: voidInsteadOfDiscard(), owner: P1 },
        { key: "fodder", def: character({ name: "Fodder" }), owner: P1, zone: "hand" },
        { key: "tac", def: discardEffect, owner: P1, zone: "hand" }
      ]
    });
    cast(engine, id, "tac", "fodder");
    assert.equal(zoneOf(engine, id("fodder")), "void", "the effect's discard was replaced");
  });

  // Rule 506.2a: attached cards' replacements still apply (the printed Rusty Pickaxe example).
  const pickaxe = () =>
    item({
      name: "Rusty Pickaxe",
      attachTo: "character",
      behavior: {
        abilities: [
          {
            id: "stash",
            type: "replacement",
            replaces: { event: "destroy" },
            condition: { type: "isCard", target: { type: "selected", id: "__candidate" }, other: "source" },
            effects: [{ type: "flipFaceDown", target: { type: "selected", id: "__candidate" } }]
          }
        ]
      }
    });

  const stubbornHost = () =>
    character({
      name: "Stubborn",
      behavior: {
        abilities: [
          {
            id: "stubborn",
            type: "replacement",
            replaces: { event: "destroy", cardType: "character", controlledBy: "self" },
            condition: { type: "isCard", target: { type: "selected", id: "__candidate" }, other: "source" },
            effects: [{ type: "modifyInfluence", player: "controller", amount: 5 }]
          }
        ]
      }
    });

  rule("CR 506.2a", "example: a character destroyed as a cost does not use its own replacement, but its attached Rusty Pickaxe still flips face-down", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: stubbornHost(), owner: P1 },
        { key: "pickaxe", def: pickaxe(), owner: P1, attachedToKey: "host" },
        { key: "sacrifice", def: sacrifice(), owner: P1, zone: "hand" }
      ]
    });
    const before = influence(engine, P1);
    cast(engine, id, "sacrifice", "host");
    assert.equal(zoneOf(engine, id("host")), "discard", "the character was destroyed as a cost: its replacement did not happen");
    assert.equal(influence(engine, P1), before, "the character's replacement (+5) did not apply");
    assert.equal(zoneOf(engine, id("pickaxe")), "play", "the pickaxe's replacement did apply: it is still in play");
    assert.equal(engine.state.cards[id("pickaxe")]!.faceDown, true, "flipped face-down instead of being destroyed");
    assert.equal(engine.state.cards[id("pickaxe")]!.controllerId, P1, "under its owner's control");
  });

  rule("CR 506.2a", "control: when the same character is destroyed by an effect its own replacement applies and the pickaxe is untouched", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: stubbornHost(), owner: P1 },
        { key: "pickaxe", def: pickaxe(), owner: P1, attachedToKey: "host" },
        { key: "kill", def: destroyer("Kill"), owner: P1, zone: "hand" }
      ]
    });
    const before = influence(engine, P1);
    cast(engine, id, "kill", "host");
    assert.equal(zoneOf(engine, id("host")), "play", "the character's own replacement saved it");
    assert.equal(influence(engine, P1), before + 5);
    assert.equal(engine.state.cards[id("pickaxe")]!.attachedTo, id("host"), "the pickaxe is still attached");
    assert.equal(engine.state.cards[id("pickaxe")]!.faceDown, false);
  });

  // Rule 506.3: delayed replacements ("the next ...").
  const nextDestroyed = () =>
    tactic({
      name: "Ward Next",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            effects: [
              {
                type: "installReplacement",
                replaces: { event: "destroy", cardType: "character" },
                duration: { type: "untilEndOfTurn" },
                once: true,
                effects: [{ type: "modifyInfluence", player: "controller", amount: 2 }]
              }
            ]
          }
        ]
      }
    });

  const delayedBoard = () =>
    buildGame({
      cards: [
        { key: "c1", def: character({ name: "Character 1" }), owner: P1 },
        { key: "c2", def: character({ name: "Character 2" }), owner: P1 },
        { key: "gizmo", def: item({ name: "Gizmo" }), owner: P1 },
        { key: "ward", def: nextDestroyed(), owner: P1, zone: "hand" },
        { key: "kill1", def: destroyer("Kill 1"), owner: P1, zone: "hand" },
        { key: "kill2", def: destroyer("Kill 2"), owner: P1, zone: "hand" },
        { key: "kill3", def: destroyer("Kill 3"), owner: P1, zone: "hand" }
      ]
    });

  rule("CR 506.3", "a delayed replacement waits: nothing happens when it is set up", () => {
    const { engine, id } = delayedBoard();
    const before = influence(engine, P1);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("ward") });
    resolvePendingResponses(engine);
    assert.equal(influence(engine, P1), before, "no replacement effect yet");
    assert.equal(zoneOf(engine, id("c1")), "play");
  });

  rule("CR 506.3", "it waits until what it replaces happens: the next character destruction is replaced", () => {
    const { engine, id } = delayedBoard();
    engine.perform({ type: "playCard", playerId: P1, cardId: id("ward") });
    resolvePendingResponses(engine);
    const before = influence(engine, P1);
    cast(engine, id, "kill1", "c1");
    assert.equal(zoneOf(engine, id("c1")), "play", "the destruction was replaced");
    assert.equal(influence(engine, P1), before + 2, "with the replacement's effect");
  });

  rule("CR 506.3", "unrelated events do not use it up: an item destroyed first leaves it waiting for the character", () => {
    const { engine, id } = delayedBoard();
    engine.perform({ type: "playCard", playerId: P1, cardId: id("ward") });
    resolvePendingResponses(engine);
    cast(engine, id, "kill1", "gizmo");
    assert.equal(zoneOf(engine, id("gizmo")), "discard", "the item was destroyed normally");
    const before = influence(engine, P1);
    cast(engine, id, "kill2", "c1");
    assert.equal(zoneOf(engine, id("c1")), "play", "the character's destruction was still replaced");
    assert.equal(influence(engine, P1), before + 2);
  });

  rule("CR 506.3", "'the next': once it has replaced one event it is spent, so the following destruction happens", () => {
    const { engine, id } = delayedBoard();
    engine.perform({ type: "playCard", playerId: P1, cardId: id("ward") });
    resolvePendingResponses(engine);
    cast(engine, id, "kill1", "c1");
    assert.equal(zoneOf(engine, id("c1")), "play");
    const before = influence(engine, P1);
    cast(engine, id, "kill2", "c2");
    assert.equal(zoneOf(engine, id("c2")), "discard", "the second destruction was not replaced");
    assert.equal(influence(engine, P1), before, "and no replacement effect happened");
  });

  // Rule 506.4: several replacements for the same thing.
  const twoShields = (activePlayerId: PlayerId, owners: [PlayerId, PlayerId]) =>
    buildGame({
      activePlayerId,
      cards: [
        { key: "victim", def: character({ name: "Victim" }), owner: P1 },
        { key: "shield1", def: shield("Shield 1", 1, "any"), owner: owners[0] },
        { key: "shield2", def: shield("Shield 2", 10, "any"), owner: owners[1] },
        { key: "kill", def: destroyer("Kill"), owner: activePlayerId, zone: "hand" }
      ]
    });

  rule("CR 506.4", "only one of several replacements applies and the rest are ignored", () => {
    const { engine, id } = twoShields(P1, [P1, P1]);
    const before = influence(engine, P1);
    cast(engine, id, "kill", "victim");
    // Answer a replacement-choice prompt if the engine raised one.
    if (engine.state.pendingChoice?.kind === "chooseReplacement") {
      engine.perform({ type: "resolvePendingChoice", playerId: engine.state.pendingChoice.playerId, choice: { kind: "chooseReplacement", index: 0 } });
      resolvePendingResponses(engine);
    }
    const gained = influence(engine, P1) - before;
    assert.ok(gained === 1 || gained === 10, `exactly one replacement's effect happened (gained ${gained})`);
    assert.equal(zoneOf(engine, id("victim")), "play", "the destruction was replaced once");
  });

  rule("CR 506.4", "all the replacements are under one player's control: that player chooses which one applies", () => {
    const { engine, id } = twoShields(P2, [P1, P1]);
    engine.perform({ type: "playCard", playerId: P2, cardId: id("kill"), selected: { t: [id("victim")] } });
    resolvePendingResponses(engine);
    const pending = engine.state.pendingChoice;
    assert.ok(pending, "the player whose cards the replacements are on is asked which one to apply");
    assert.equal(pending?.playerId, P1, "the controller chooses, although the opponent is the active player");
  });

  rule("CR 506.4", "replacements under both players' control: the active player chooses which one applies (first player active)", () => {
    const { engine, id } = twoShields(P1, [P1, P2]);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("kill"), selected: { t: [id("victim")] } });
    resolvePendingResponses(engine);
    const pending = engine.state.pendingChoice;
    assert.ok(pending, "a choice between the two replacements is offered");
    assert.equal(pending?.playerId, P1, "the active player chooses");
  });

  rule("CR 506.4", "replacements under both players' control: the active player chooses which one applies (second player active)", () => {
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "victim", def: character({ name: "Victim" }), owner: P1 },
        { key: "shield1", def: shield("Shield 1", 1, "any"), owner: P1 },
        { key: "shield2", def: shield("Shield 2", 10, "any"), owner: P2 },
        { key: "kill", def: destroyer("Kill"), owner: P2, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("kill"), selected: { t: [id("victim")] } });
    resolvePendingResponses(engine);
    const pending = engine.state.pendingChoice;
    assert.ok(pending, "a choice between the two replacements is offered");
    assert.equal(pending?.playerId, P2, "the second player is now the active player and chooses");
  });

  rule("CR 506.4", "a delayed replacement that is not chosen is not ignored: it keeps waiting for the next instance", () => {
    // A delayed 'the next character destroyed ...' competes with a permanent shield for one destruction.
    const { engine, id } = buildGame({
      cards: [
        { key: "c1", def: character({ name: "Character 1" }), owner: P1 },
        { key: "shield", def: shield("Shield", 10, "any"), owner: P1 },
        { key: "ward", def: nextDestroyed(), owner: P1, zone: "hand" },
        { key: "kill", def: destroyer("Kill"), owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("ward") });
    resolvePendingResponses(engine);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("kill"), selected: { t: [id("c1")] } });
    resolvePendingResponses(engine);
    const pending = engine.state.pendingChoice;
    assert.ok(pending, "the player chooses between the delayed replacement and the shield");
    assert.equal(engine.state.runtimeReplacements.length, 1, "the delayed replacement has not been spent by being offered");
  });

  /** A delayed replacement and a permanent shield compete for one destruction; the destruction is picked and the pick answered. */
  const pickBetweenDelayedAndShield = (chooseDelayed: boolean) => {
    const { engine, id } = buildGame({
      cards: [
        { key: "c1", def: character({ name: "Character 1" }), owner: P1 },
        { key: "c2", def: character({ name: "Character 2" }), owner: P1 },
        { key: "shield", def: shield("Shield", 10, "any"), owner: P1 },
        { key: "ward", def: nextDestroyed(), owner: P1, zone: "hand" },
        { key: "kill1", def: destroyer("Kill 1"), owner: P1, zone: "hand" },
        { key: "kill2", def: destroyer("Kill 2"), owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("ward") });
    resolvePendingResponses(engine);
    const before = influence(engine, P1);
    cast(engine, id, "kill1", "c1");
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "chooseReplacement");
    const options = pending?.kind === "chooseReplacement" ? pending.options : [];
    assert.equal(options.length, 2, "both replacements are offered");
    const index = options.findIndex((option) => (option.delayed === true) === chooseDelayed);
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooseReplacement", index } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice, undefined, "nothing left to answer");
    assert.equal(zoneOf(engine, id("c1")), "play", "the destruction was replaced");
    return { engine, id, gained: influence(engine, P1) - before };
  };

  rule("CR 506.4", "choosing the permanent replacement applies only it: the delayed one is still waiting and replaces the next instance", () => {
    const { engine, id, gained } = pickBetweenDelayedAndShield(false);
    assert.equal(gained, 10, "only the shield's effect happened");
    assert.equal(engine.state.runtimeReplacements.length, 1, "the unchosen delayed replacement is still waiting");
    cast(engine, id, "kill2", "c2");
    assert.equal(engine.state.pendingChoice?.kind, "chooseReplacement", "it competes with the shield again for the next destruction");
  });

  rule("CR 506.4", "choosing the delayed replacement applies only it and uses it up; the permanent one is ignored for this instance", () => {
    const { engine, gained } = pickBetweenDelayedAndShield(true);
    assert.equal(gained, 2, "only the delayed replacement's effect happened");
    assert.equal(engine.state.runtimeReplacements.length, 0, "the delayed replacement is spent");
  });

  // Rule 506.5: each replacement applies to the same thing at most once.
  const bounceInstead = (name: string) =>
    item({
      name,
      behavior: {
        abilities: [
          {
            id: "bounce",
            type: "replacement",
            replaces: { event: "destroy", cardType: "character" },
            effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "hand" }]
          }
        ]
      }
    });

  const destroyInstead = (name: string) =>
    item({
      name,
      behavior: {
        abilities: [
          {
            id: "destroy",
            type: "replacement",
            replaces: { event: "moveToZone", zone: "hand", from: "play" },
            effects: [{ type: "destroy", target: { type: "selected", id: "__candidate" } }]
          }
        ]
      }
    });

  rule("CR 506.5", "example: 'destroyed -> put into hand instead' and 'put into hand from play -> destroy instead' end the cycle: the card is destroyed", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "victim", def: character({ name: "Victim" }), owner: P1 },
        { key: "toHand", def: bounceInstead("To Hand"), owner: P1 },
        { key: "toDestroy", def: destroyInstead("To Destroy"), owner: P1 },
        { key: "kill", def: destroyer("Kill"), owner: P1, zone: "hand" }
      ]
    });
    cast(engine, id, "kill", "victim");
    assert.equal(engine.state.pendingChoice, undefined, "the cycle did not hang the game");
    assert.equal(zoneOf(engine, id("victim")), "discard", "destruction -> hand -> destruction (each replacement once) ends with the card destroyed");
  });

  rule("CR 506.5", "example: with two copies of 'destroyed -> put into hand instead', each applies once: the card ends up in the hand", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "victim", def: character({ name: "Victim" }), owner: P1 },
        { key: "toHand1", def: bounceInstead("To Hand 1"), owner: P1 },
        { key: "toHand2", def: bounceInstead("To Hand 2"), owner: P1 },
        { key: "toDestroy", def: destroyInstead("To Destroy"), owner: P1 },
        { key: "kill", def: destroyer("Kill"), owner: P1, zone: "hand" }
      ]
    });
    cast(engine, id, "kill", "victim");
    assert.equal(engine.state.pendingChoice, undefined, "no choice is left open");
    assert.equal(zoneOf(engine, id("victim")), "hand", "destroy -> hand (copy 1) -> destroy (the other card) -> hand (copy 2)");
  });

  rule("CR 506.5", "a single replacement is applied only once to the same thing: 'destroyed -> put into hand' does not loop on its own", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "victim", def: character({ name: "Victim" }), owner: P1 },
        { key: "toHand", def: bounceInstead("To Hand"), owner: P1 },
        { key: "kill", def: destroyer("Kill"), owner: P1, zone: "hand" }
      ]
    });
    cast(engine, id, "kill", "victim");
    assert.equal(zoneOf(engine, id("victim")), "hand", "destroyed was replaced by going to hand");
  });

  // Rule 506.6: replacing destruction reduces the damage from the source of the destruction to 0.
  const wounded = () => character({ name: "Wounded", life: 3 });

  rule("CR 506.6", "lethal damage whose destruction is replaced is reduced to 0, so the card does not die again at the next check", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "victim", def: wounded(), owner: P1 },
        { key: "shield", def: shield("Shield", 1), owner: P1 },
        { key: "hit", def: damager("Hit", 3), owner: P1, zone: "hand" }
      ]
    });
    cast(engine, id, "hit", "victim");
    assert.equal(zoneOf(engine, id("victim")), "play", "the destruction was replaced");
    assert.equal(engine.state.cards[id("victim")]!.damage, 0, "all the damage from the source of the destruction was reduced to 0");
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("victim")), "play", "and it is still alive later");
  });

  rule(
    "CR 506.6",
    "damage the card received from other sources earlier is kept; only damage from the source of the destruction is reduced to 0",
    () => {
      const { engine, id } = buildGame({
        cards: [
          { key: "victim", def: wounded(), owner: P1 },
          { key: "shield", def: shield("Shield", 1), owner: P1 },
          { key: "early", def: damager("Early Hit", 1), owner: P1, zone: "hand" },
          { key: "hit", def: damager("Late Hit", 2), owner: P1, zone: "hand" }
        ]
      });
      cast(engine, id, "early", "victim");
      assert.equal(engine.state.cards[id("victim")]!.damage, 1, "one damage from the first source");
      cast(engine, id, "hit", "victim");
      assert.equal(zoneOf(engine, id("victim")), "play", "the lethal total was replaced");
      assert.equal(engine.state.cards[id("victim")]!.damage, 1, "the earlier source's damage stays, the second source's 2 was reduced to 0");
    }
  );

  rule(
    "CR 506.6",
    "a destroy effect that is replaced reduces nothing: its source dealt no damage, so the card keeps the damage it has",
    () => {
      const { engine, id } = buildGame({
        cards: [
          { key: "victim", def: wounded(), owner: P1 },
          { key: "shield", def: shield("Shield", 1), owner: P1 },
          { key: "hurt", def: damager("Hurt", 2), owner: P1, zone: "hand" },
          { key: "kill", def: destroyer("Kill"), owner: P1, zone: "hand" }
        ]
      });
      cast(engine, id, "hurt", "victim");
      assert.equal(engine.state.cards[id("victim")]!.damage, 2, "two damage from the first source");
      cast(engine, id, "kill", "victim");
      assert.equal(zoneOf(engine, id("victim")), "play", "the destroy effect was replaced");
      assert.equal(engine.state.cards[id("victim")]!.damage, 2, "none of the damage came from the destroy effect's source, so none is reduced");
    }
  );
});
