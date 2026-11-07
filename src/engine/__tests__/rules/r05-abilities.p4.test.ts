// Batch r05-abilities (docs/TESTING.md): CR 503 Triggers.
// Written from the wording of the Comprehensive Rules, not from the engine.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine, TriggeredAbility } from "../../../engine.js";
import { buildGame, character, item, P1, P2, resolvePendingResponses, resourceCard, tactic } from "../support/fixtures.js";
import { settleTurnStart } from "../support/develop.js";
import type { BuildGameOptions } from "../support/fixtures.js";
import { refused, rule } from "./_rule.js";

type Placement = NonNullable<BuildGameOptions["cards"]>[number];

const zoneOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId]!.zone;
const influence = (engine: SpoilsEngine, playerId: PlayerId) => engine.state.players[playerId].influence;

/** Face-up rage resources owned by `owner`, keys `<tag>0`, `<tag>1`, ... */
function rageBank(count: number, tag = "bank", owner: PlayerId = P1): Placement[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `${tag}${i}`,
    def: resourceCard({ name: `${tag}${i}`, resource: { provides: ["rage"], staple: true } }),
    owner
  }));
}

/** How many resources `playerId` has spent: cards attached to their faction. */
function spent(engine: SpoilsEngine, playerId: PlayerId): number {
  const factionId = engine.state.players[playerId].factionId;
  return Object.values(engine.state.cards).filter(card => card.attachedTo === factionId && card.zone === "play").length;
}

const blank = (name: string) => tactic({ name });

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

describe("CR 503 — triggers", () => {
  /** "When another card enters play, gain 1 influence" style triggers fire on their event. */
  const onEnter = (amount = 1): TriggeredAbility => ({
    id: "t",
    type: "triggered",
    event: "cardEnteredPlay",
    condition: { type: "sourceIsEventCard" },
    effects: [{ type: "modifyInfluence", player: "controller", amount }]
  });

  rule("CR 503.1", "a trigger happens by itself when its trigger condition happens ('when this card enters play')", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "newcomer", def: character({ name: "Newcomer", behavior: { abilities: [onEnter(2)] } }), owner: P1, zone: "hand" }]
    });
    const before = influence(engine, P1);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("newcomer") });
    resolvePendingResponses(engine);
    assert.equal(influence(engine, P1), before + 2, "the trigger happened with no one using it");
  });

  rule("CR 503.1", "a trigger does not happen when its condition does not: another card entering play does not trigger 'when this card enters play'", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "watcher", def: character({ name: "Watcher", behavior: { abilities: [onEnter(2)] } }), owner: P1 },
        { key: "other", def: character({ name: "Other" }), owner: P1, zone: "hand" },
        { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "hand" }
      ]
    });
    const before = influence(engine, P1);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("other") });
    resolvePendingResponses(engine);
    assert.equal(influence(engine, P1), before, "another card of mine entering play does not trigger it");
    assert.equal(engine.state.pendingChoice, undefined);
  });

  rule("CR 503.1", "a trigger that is already in play when the event happens to another player's card also works: 'when a card enters play' on the opponent's card", () => {
    const watcher = character({
      name: "Watcher",
      behavior: { abilities: [{ id: "t", type: "triggered", event: "cardEnteredPlay", effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }] }
    });
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "watcher", def: watcher, owner: P1 },
        { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "hand" }
      ]
    });
    const before = influence(engine, P1);
    engine.perform({ type: "playCard", playerId: P2, cardId: id("theirs") });
    resolvePendingResponses(engine);
    assert.equal(influence(engine, P1), before + 1, "the non-active player's trigger happened on the opponent's card entering");
  });

  rule("CR 503.1", "an 'at the start of the turn' trigger happens at the start of the turn", () => {
    const watcher = character({
      name: "Watcher",
      behavior: { abilities: [{ id: "t", type: "triggered", event: "turnStarted", effects: [{ type: "modifyInfluence", player: "controller", amount: 4 }] }] }
    });
    const { engine } = buildGame({ cards: [{ key: "watcher", def: watcher, owner: P1 }] });
    const before = influence(engine, P1);
    const turn = engine.state.turn;
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    assert.equal(engine.state.activePlayerId, P2);
    // It triggers at the start of every turn: seats between P1 and P2 start (and end) turns of their own.
    assert.equal(influence(engine, P1), before + 4 * (engine.state.turn - turn), "it triggered at the start of the opponent's turn (any turn start)");
  });

  rule("CR 503.1", "the trigger's instructions are followed immediately, in the middle of resolving something else", () => {
    // The mark starts depleted. The tactic destroys a victim (whose destruction restores the mark), then depletes the mark.
    // If the trigger is followed immediately the mark ends depleted; if it waited for the tactic to finish, it would end restored.
    const restorer: TriggeredAbility = {
      id: "t",
      type: "triggered",
      event: "cardDestroyed",
      effects: [{ type: "forEach", selector: { type: "character", name: "Mark" }, effects: [{ type: "restore", target: { type: "selected", id: "__candidate" } }] }]
    };
    const combo = tactic({
      name: "Combo",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [{ id: "t", selector: { name: "Victim" }, count: 1 }],
            effects: [
              { type: "destroy", target: { type: "selected", id: "t" } },
              { type: "forEach", selector: { type: "character", name: "Mark" }, effects: [{ type: "deplete", target: { type: "selected", id: "__candidate" } }] }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "victim", def: character({ name: "Victim" }), owner: P2 },
        { key: "mark", def: character({ name: "Mark", behavior: { abilities: [restorer] } }), owner: P1, depleted: true },
        { key: "combo", def: combo, owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("combo"), selected: { t: [id("victim")] } });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("victim")), "discard");
    assert.equal(engine.state.cards[id("mark")]!.depleted, true, "the restore trigger happened before the tactic's next effect (deplete)");
  });

  rule("CR 503.1", "a trigger still happens when its source has left play: 'when this card is destroyed' on the card that was just destroyed", () => {
    const dying = character({
      name: "Dying",
      behavior: {
        abilities: [
          {
            id: "t",
            type: "triggered",
            event: "cardDestroyed",
            condition: { type: "sourceIsEventCard" },
            effects: [{ type: "modifyInfluence", player: "controller", amount: 5 }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "dying", def: dying, owner: P1 },
        { key: "kill", def: destroyer("Kill"), owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("kill"), selected: { t: [id("dying")] } });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("dying")), "discard");
    assert.equal(influence(engine, P1), 30, "the trigger followed its instructions although its source had left play");
  });

  rule("CR 503.1", "a trigger follows the text as it was written when it happened: removing its source's text first does not cancel it", () => {
    // At the start of the turn two of the first player's cards trigger. A: remove all rules text from B. B: gain 3 influence.
    // The first player puts A's trigger first; B's trigger already happened, so it still follows B's text as written then.
    const stripA: TriggeredAbility = {
      id: "strip",
      type: "triggered",
      event: "cardEnteredPlay",
      effects: [
        {
          type: "forEach",
          selector: { type: "character", name: "Gain Three" },
          effects: [{ type: "suppressAbilities", target: { type: "selected", id: "__candidate" }, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    };
    const gainB: TriggeredAbility = {
      id: "gain",
      type: "triggered",
      event: "cardEnteredPlay",
      effects: [{ type: "modifyInfluence", player: "controller", amount: 3 }]
    };
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "Stripper", behavior: { abilities: [stripA] } }), owner: P1 },
        { key: "b", def: character({ name: "Gain Three", behavior: { abilities: [gainB] } }), owner: P1 },
        { key: "newcomer", def: character({ name: "Newcomer" }), owner: P1, zone: "hand" }
      ]
    });
    const before = influence(engine, P1);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("newcomer") });
    resolvePendingResponses(engine);
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "orderTriggers", "both triggers happened at once");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "orderTriggers", next: { sourceId: id("a"), abilityId: "strip" } } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(influence(engine, P1), before + 3, "B's trigger followed its text as written when it happened");
  });

  rule("CR 503.1", "a trigger whose source was destroyed by an earlier trigger from the same event still happens", () => {
    const killA: TriggeredAbility = {
      id: "kill",
      type: "triggered",
      event: "cardEnteredPlay",
      effects: [
        { type: "forEach", selector: { type: "character", name: "Gain Three" }, effects: [{ type: "destroy", target: { type: "selected", id: "__candidate" } }] }
      ]
    };
    const gainB: TriggeredAbility = {
      id: "gain",
      type: "triggered",
      event: "cardEnteredPlay",
      effects: [{ type: "modifyInfluence", player: "controller", amount: 3 }]
    };
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "Killer", behavior: { abilities: [killA] } }), owner: P1 },
        { key: "b", def: character({ name: "Gain Three", behavior: { abilities: [gainB] } }), owner: P1 },
        { key: "newcomer", def: character({ name: "Newcomer" }), owner: P1, zone: "hand" }
      ]
    });
    const before = influence(engine, P1);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("newcomer") });
    resolvePendingResponses(engine);
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "orderTriggers", next: { sourceId: id("a"), abilityId: "kill" } } });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("b")), "discard", "the first trigger destroyed B");
    assert.equal(influence(engine, P1), before + 3, "B's trigger had already happened, so it still resolved");
  });

  rule("CR 503.2", "players cannot respond to triggers: a trigger resolves the moment it happens, with no response window and no stack item", () => {
    const hurt: TriggeredAbility = {
      id: "t",
      type: "triggered",
      event: "cardEnteredPlay",
      condition: { type: "sourceIsEventCard" },
      effects: [{ type: "modifyInfluence", player: "opponent", amount: -3 }]
    };
    const { engine, id } = buildGame({
      cards: [
        { key: "newcomer", def: character({ name: "Newcomer", behavior: { abilities: [hurt] } }), owner: P1, zone: "hand" },
        { key: "reply", def: blank("Reply"), owner: P2, zone: "hand" }
      ]
    });
    const before = influence(engine, P2);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("newcomer") });
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond to the card being played");
    assert.equal(influence(engine, P2), before, "the trigger has not happened: the card is still waiting");
    engine.perform({ type: "passPriority", playerId: P2 });
    engine.perform({ type: "advanceFlow" });
    assert.equal(zoneOf(engine, id("newcomer")), "play", "the card resolved");
    assert.equal(influence(engine, P2), before - 3, "its trigger happened at once as the card entered play");
    assert.equal(engine.state.responseWindow, undefined, "no response window was opened for the trigger");
    assert.equal(engine.state.responseStack.length, 0, "and the trigger never sat on the stack");
    refused(
      () => engine.perform({ type: "playCard", playerId: P2, cardId: id("reply") }),
      "the opponent responds to the trigger after it happened",
      /active player|timing|respon|deploy/i
    );
    assert.equal(zoneOf(engine, id("reply")), "hand", "the response was never played");
  });

  rule("CR 503.2", "players cannot respond to a trigger caused by an attack: the trigger happens at the declaration, before the defender's window", () => {
    const raider: TriggeredAbility = {
      id: "t",
      type: "triggered",
      event: "characterAttacked",
      condition: { type: "sourceIsEventCard" },
      effects: [{ type: "modifyInfluence", player: "controller", amount: 2 }]
    };
    const { engine, id } = buildGame({
      cards: [
        { key: "raider", def: character({ name: "Raider", behavior: { abilities: [raider] } }), owner: P1 },
        { key: "reply", def: blank("Reply"), owner: P2, zone: "hand" }
      ]
    });
    const before = influence(engine, P1);
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("raider")], target: { type: "faction", playerId: P2 } });
    assert.equal(influence(engine, P1), before + 2, "the trigger happened as the attack was declared, before anyone could respond");
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "the attacker still holds priority (the window is for the attack, not the trigger)");
    assert.ok(!engine.state.responseStack.some(item => item.sourceId === id("raider")), "the trigger is not an item that can be responded to");
  });

  rule("CR 503.3", "a trigger that happens while a cost is being satisfied waits until all the costs are satisfied", () => {
    // The offering's costs are: destroy a character, then pay 1. The destroyed character's trigger sends every resource
    // back to its owner's hand. If it resolved between the two cost steps, the payment of 1 would find no resource.
    const bouncer: TriggeredAbility = {
      id: "bounce",
      type: "triggered",
      event: "cardDestroyed",
      condition: { type: "sourceIsEventCard" },
      effects: [{ type: "forEach", selector: { type: "resource", controller: "self" }, effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "hand" }] }]
    };
    const offering = tactic({
      name: "Offering",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [{ id: "sac", selector: { controller: "self", type: "character" }, count: 1 }],
            costs: [
              { type: "destroy", target: { type: "selected", id: "sac" } },
              { type: "payResources", amount: 1 }
            ],
            effects: []
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "sac", def: character({ name: "Sacrifice", behavior: { abilities: [bouncer] } }), owner: P1 },
        { key: "offering", def: offering, owner: P1, zone: "hand" },
        ...rageBank(2)
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("offering"), selected: { sac: [id("sac")] } });
    assert.equal(zoneOf(engine, id("sac")), "discard", "the first cost destroyed the character");
    assert.ok(engine.state.responseStack.some(item => item.sourceId === id("offering")), "the second cost was payable, so the card is on the stack");
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("bank0")), "hand", "the waiting trigger resolved after the costs: the resources went to hand");
    assert.equal(zoneOf(engine, id("bank1")), "hand");
  });

  rule("CR 503.3", "a trigger that happens while an ability's cost is being paid waits until the costs are satisfied", () => {
    const bouncer: TriggeredAbility = {
      id: "bounce",
      type: "triggered",
      event: "cardDestroyed",
      condition: { type: "sourceIsEventCard" },
      effects: [{ type: "forEach", selector: { type: "resource", controller: "self" }, effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "hand" }] }]
    };
    const engineCard = item({
      name: "Engine",
      behavior: {
        abilities: [
          {
            id: "go",
            type: "activated",
            targets: [{ id: "sac", selector: { controller: "self", type: "character" }, count: 1 }],
            costs: [
              { type: "destroy", target: { type: "selected", id: "sac" } },
              { type: "payResources", amount: 1 }
            ],
            effects: [{ type: "modifyInfluence", player: "controller", amount: 2 }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "sac", def: character({ name: "Sacrifice", behavior: { abilities: [bouncer] } }), owner: P1 },
        { key: "engine", def: engineCard, owner: P1 },
        ...rageBank(2)
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("engine"), abilityId: "go", selected: { sac: [id("sac")] } });
    assert.equal(engine.state.responseStack.length, 1, "the ability was used: both costs were satisfied");
    resolvePendingResponses(engine);
    assert.equal(influence(engine, P1), 27, "the ability resolved");
    assert.equal(zoneOf(engine, id("bank0")), "hand", "and the waiting trigger resolved afterwards");
  });

  rule("CR 503.3", "control: with no trigger in the way, the same two costs are paid and the resources stay in play", () => {
    const offering = tactic({
      name: "Offering",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [{ id: "sac", selector: { controller: "self", type: "character" }, count: 1 }],
            costs: [
              { type: "destroy", target: { type: "selected", id: "sac" } },
              { type: "payResources", amount: 1 }
            ],
            effects: []
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "sac", def: character({ name: "Sacrifice" }), owner: P1 },
        { key: "offering", def: offering, owner: P1, zone: "hand" },
        ...rageBank(2)
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("offering"), selected: { sac: [id("sac")] } });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("sac")), "discard");
    assert.equal(spent(engine, P1), 1, "the numeric cost of 1 was paid");
    assert.equal(zoneOf(engine, id("bank0")), "play");
  });

  /** A trigger on a Newcomer entering play that sets damage on the character named Mark. */
  const markSetter = (name: string, value: number): CardDefinition =>
    character({
      name,
      behavior: {
        abilities: [
          {
            id: `set${value}`,
            type: "triggered",
            event: "cardEnteredPlay",
            condition: { type: "cardNameIs", target: "eventCard", name: "Newcomer" },
            effects: [
              {
                type: "forEach",
                selector: { type: "character", name: "Mark" },
                effects: [{ type: "setDamage", target: { type: "selected", id: "__candidate" }, amount: value }]
              }
            ]
          }
        ]
      }
    });

  const damageOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId]!.damage;
  const mark = (): Placement => ({ key: "mark", def: character({ name: "Mark", life: 20 }), owner: P1 });
  const newcomer = (owner: PlayerId): Placement => ({ key: "newcomer", def: character({ name: "Newcomer" }), owner, zone: "hand" });

  const answerOrder = (engine: SpoilsEngine, playerId: PlayerId, key: string, abilityId: string, id: (k: string) => CardInstanceId) =>
    engine.perform({ type: "resolvePendingChoice", playerId, choice: { kind: "orderTriggers", next: { sourceId: id(key), abilityId } } });

  rule("CR 503.4", "triggers from cards under one player's control: that player orders them, even when they are not the active player", () => {
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "s1", def: markSetter("Setter 1", 1), owner: P1 },
        { key: "s2", def: markSetter("Setter 2", 2), owner: P1 },
        mark(),
        newcomer(P2)
      ]
    });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("newcomer") });
    resolvePendingResponses(engine);
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "orderTriggers");
    assert.equal(pending?.playerId, P1, "the controller of both triggers decides, not the active player");
    refused(() => answerOrder(engine, P2, "s1", "set1", id), "the active player orders the other player's triggers", /choice|player|not/i);
    answerOrder(engine, P1, "s1", "set1", id);
    resolvePendingResponses(engine);
    assert.equal(damageOf(engine, id("mark")), 2, "s1 first, then s2: the last trigger to happen set 2");
  });

  rule("CR 503.4", "the order the controller picks decides the result (the other order ends the other way)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "s1", def: markSetter("Setter 1", 1), owner: P1 },
        { key: "s2", def: markSetter("Setter 2", 2), owner: P1 },
        mark(),
        newcomer(P1)
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("newcomer") });
    resolvePendingResponses(engine);
    answerOrder(engine, P1, "s2", "set2", id);
    resolvePendingResponses(engine);
    assert.equal(damageOf(engine, id("mark")), 1, "s2 first, then s1: the last trigger to happen set 1");
  });

  rule("CR 503.4", "triggers from cards under both players' control: the active player decides the order (first player active)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "s1", def: markSetter("Setter 1", 1), owner: P1 },
        { key: "s2", def: markSetter("Setter 2", 2), owner: P2 },
        mark(),
        newcomer(P1)
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("newcomer") });
    resolvePendingResponses(engine);
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "orderTriggers");
    assert.equal(pending?.playerId, P1, "the active player orders triggers of both players");
    refused(() => answerOrder(engine, P2, "s2", "set2", id), "the non-active player orders mixed triggers", /choice|player|not/i);
    answerOrder(engine, P1, "s2", "set2", id);
    resolvePendingResponses(engine);
    assert.equal(damageOf(engine, id("mark")), 1, "the active player let the opponent's trigger happen first");
  });

  rule("CR 503.4", "triggers from cards under both players' control: the active player decides the order (second player active)", () => {
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "s1", def: markSetter("Setter 1", 1), owner: P1 },
        { key: "s2", def: markSetter("Setter 2", 2), owner: P2 },
        mark(),
        newcomer(P2)
      ]
    });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("newcomer") });
    resolvePendingResponses(engine);
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "orderTriggers");
    assert.equal(pending?.playerId, P2, "now the second player is the active player and orders them");
    answerOrder(engine, P2, "s1", "set1", id);
    resolvePendingResponses(engine);
    assert.equal(damageOf(engine, id("mark")), 2);
  });

  rule("CR 503.4", "control, not ownership, decides: a card owned by the opponent but controlled by the first player counts as the first player's trigger", () => {
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "s1", def: markSetter("Setter 1", 1), owner: P1 },
        { key: "s2", def: markSetter("Setter 2", 2), owner: P2, controller: P1 },
        mark(),
        newcomer(P2)
      ]
    });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("newcomer") });
    resolvePendingResponses(engine);
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "orderTriggers");
    assert.equal(pending?.playerId, P1, "both triggers are under the first player's control, so the first player orders them");
  });

  rule("CR 503.4", "a single trigger has nothing to order: no prompt, it just happens", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "s1", def: markSetter("Setter 1", 1), owner: P1 }, mark(), newcomer(P1)]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("newcomer") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice, undefined, "no ordering question for one trigger");
    assert.equal(damageOf(engine, id("mark")), 1);
  });

  rule("CR 503.4a", "the order is decided one trigger at a time: after the first is chosen it happens, then the player chooses the next", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "s1", def: markSetter("Setter 1", 1), owner: P1 },
        { key: "s2", def: markSetter("Setter 2", 2), owner: P1 },
        { key: "s3", def: markSetter("Setter 3", 3), owner: P1 },
        mark(),
        newcomer(P1)
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("newcomer") });
    resolvePendingResponses(engine);
    const first = engine.state.pendingChoice;
    assert.equal(first?.kind, "orderTriggers");
    if (first?.kind === "orderTriggers") assert.equal(first.triggers.length, 3, "all three triggers are waiting");
    answerOrder(engine, P1, "s2", "set2", id);
    assert.equal(damageOf(engine, id("mark")), 2, "the chosen trigger happened before the next decision");
    const second = engine.state.pendingChoice;
    assert.equal(second?.kind, "orderTriggers", "the player is asked again which happens next");
    if (second?.kind === "orderTriggers") {
      assert.equal(second.triggers.length, 2, "the two remaining triggers");
      assert.ok(!second.triggers.some(t => t.abilityId === "set2"), "the one that already happened is not offered again");
    }
    answerOrder(engine, P1, "s3", "set3", id);
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice, undefined, "the last remaining trigger happens without a question");
    assert.equal(damageOf(engine, id("mark")), 1, "order s2, s3, s1: the last to happen set 1");
  });

  rule("CR 503.4a", "the order need not be decided ahead of time: the player is not asked for a full ordering of three triggers up front", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "s1", def: markSetter("Setter 1", 1), owner: P1 },
        { key: "s2", def: markSetter("Setter 2", 2), owner: P1 },
        { key: "s3", def: markSetter("Setter 3", 3), owner: P1 },
        mark(),
        newcomer(P1)
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("newcomer") });
    resolvePendingResponses(engine);
    assert.equal(damageOf(engine, id("mark")), 0, "no trigger has happened yet");
    refused(
      () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "orderTriggers", next: { sourceId: id("s1"), abilityId: "set2" } } }),
      "naming a trigger the card does not have",
      /trigger|choice|batch/i
    );
    answerOrder(engine, P1, "s1", "set1", id);
    assert.equal(damageOf(engine, id("mark")), 1, "one trigger happened per decision");
  });
});
