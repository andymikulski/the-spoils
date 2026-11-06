// Batch r08-turn-deploy, part 3 (docs/TESTING.md): CR 604 Deploying a Card.
// Written from the wording of the Comprehensive Rules, not from the engine.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { SpoilsEngine } from "../../../engine.js";
import { buildGame, character, item, location, P1, P2, resourceCard, tactic } from "../support/fixtures.js";
import type { CardPlacement } from "../support/fixtures.js";
import { refused, rule } from "./_rule.js";
import { orderNext, passWindows, triggerLog, zoneOf } from "./r08-turn-deploy.shared.js";

/** `n` face-up Rage resources for `owner`, keys `<prefix>0..`. */
const rage = (n: number, owner = P1, prefix = "rage"): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({
    key: `${prefix}${i}`,
    def: resourceCard({ name: `${prefix}${i}`, resource: { provides: ["rage"], staple: true } }),
    owner
  }));

/** The resources attached to `player`'s faction (spent). */
const spent = (engine: SpoilsEngine, player = P1) =>
  engine.state.players[player].play.filter((cardId) => engine.state.cards[cardId].attachedTo === engine.state.players[player].factionId);

/** Everything a failed action must leave untouched. */
const snapshot = (engine: SpoilsEngine) =>
  JSON.stringify({
    players: engine.state.players,
    cards: engine.state.cards,
    stack: engine.state.responseStack,
    window: engine.state.responseWindow,
    pending: engine.state.pendingChoice,
    log: engine.state.gameLog.length
  });

/** A character that counts the "influenceChanged" events it sees, noting how many resources were spent when each trigger resolved. */
const costWatcher = (name: string) =>
  character({
    name,
    behavior: {
      abilities: [
        {
          id: "w",
          type: "triggered",
          event: "influenceChanged",
          effects: [{ type: "addCounter", target: "source", counter: "seen", amount: 1 }]
        }
      ]
    }
  });

/** A character that counts each card played. */
const playWatcher = (name: string) =>
  character({
    name,
    behavior: { abilities: [{ id: "w", type: "triggered", event: "cardPlayed", effects: [{ type: "addCounter", target: "source", counter: "seen", amount: 1 }] }] }
  });

/** A character that counts each card entering play. */
const enterWatcher = (name: string) =>
  character({
    name,
    behavior: { abilities: [{ id: "w", type: "triggered", event: "cardEnteredPlay", effects: [{ type: "addCounter", target: "source", counter: "seen", amount: 1 }] }] }
  });

/** A character whose deploy costs the player 1 influence twice, as extra costs. */
const twoLossCost = (name: string) =>
  character({ name, behavior: { onPlay: { costs: [{ type: "loseInfluence", amount: 1 }, { type: "loseInfluence", amount: 1 }] } } });

describe("CR 604.1a — selection", () => {
  rule("CR 604.1a", "the card must be in the deploying player's hand: a card in the deck, the discard pile or the opponent's hand cannot be deployed", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
        { key: "inDeck", def: character({ name: "InDeck" }), owner: P1, zone: "deck" },
        { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
        { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "hand" }
      ]
    });
    refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("inDeck") }), "a card in the deck", /must be in your hand/);
    refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("inDiscard") }), "a card in the discard pile", /must be in your hand/);
    refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("theirs") }), "a card in the opponent's hand", /do not control/);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("inHand") });
    assert.equal(zoneOf(engine, id("inHand")), "deploying", "control: a card in hand can be deployed");
  });

  rule("CR 604.1a", "a card already in play cannot be selected for deploying", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "inPlay", def: character({ name: "InPlay" }), owner: P1 },
        { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" }
      ]
    });
    refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("inPlay") }), "a card already in play", /must be in your hand/);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("inHand") });
    assert.equal(zoneOf(engine, id("inHand")), "deploying");
  });

  rule("CR 604.1a", "a resource card is not a non-resource card: it cannot be deployed from the hand", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "res", def: resourceCard({ name: "Res" }), owner: P1, zone: "hand" },
        { key: "chr", def: character({ name: "Chr" }), owner: P1, zone: "hand" }
      ]
    });
    refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("res") }), "deploying a resource card", /Resource cards can only be played/);
    assert.equal(zoneOf(engine, id("res")), "hand");
    engine.perform({ type: "playCard", playerId: P1, cardId: id("chr") });
    assert.equal(zoneOf(engine, id("chr")), "deploying", "control: a non-resource card deploys");
  });

  rule("CR 604.1a", "every non-resource card type can be chosen: character, item, location and tactic", () => {
    for (const make of [character, item, location, tactic]) {
      const { engine, id } = buildGame({ cards: [{ key: "c", def: make({ name: "C" }), owner: P1, zone: "hand" }] });
      engine.perform({ type: "playCard", playerId: P1, cardId: id("c") });
      assert.equal(zoneOf(engine, id("c")), "deploying", `a ${engine.getDefinition(id("c")).type} can be selected`);
    }
  });
});

describe("CR 604.1b — threshold", () => {
  rule("CR 604.1b", "a card whose threshold is met can be played: exactly the icons required", () => {
    const { engine, id } = buildGame({
      cards: [...rage(2), { key: "c", def: character({ name: "C", threshold: "rr" }), owner: P1, zone: "hand" }]
    });
    assert.equal(engine.getCardPlayability(P1, id("c")).thresholdMet, true);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("c") });
    assert.equal(zoneOf(engine, id("c")), "deploying");
  });

  rule("CR 604.1b", "one icon short of the threshold: the card cannot be played, and nothing changes", () => {
    const { engine, id } = buildGame({
      cards: [...rage(1), { key: "c", def: character({ name: "C", threshold: "rr" }), owner: P1, zone: "hand" }]
    });
    assert.equal(engine.getCardPlayability(P1, id("c")).thresholdMet, false);
    const before = snapshot(engine);
    refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("c") }), "one Rage short of [R][R]", /Threshold/);
    assert.equal(snapshot(engine), before, "nothing happened");
  });

  rule("CR 604.1b", "the right icons are needed, not just enough icons: two Greed do not meet a Rage threshold", () => {
    const greed = Array.from({ length: 2 }, (_, i) => ({
      key: `greed${i}`,
      def: resourceCard({ name: `Greed${i}`, resource: { provides: ["greed"], staple: true } }),
      owner: P1
    }));
    const { engine, id } = buildGame({ cards: [...greed, { key: "c", def: character({ name: "C", threshold: "rr" }), owner: P1, zone: "hand" }] });
    refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("c") }), "Greed icons for a Rage threshold", /Threshold/);
  });

  rule("CR 604.1b", "a card with no threshold needs no icons", () => {
    const { engine, id } = buildGame({ cards: [{ key: "c", def: character({ name: "C" }), owner: P1, zone: "hand" }] });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("c") });
    assert.equal(zoneOf(engine, id("c")), "deploying");
  });

  rule("CR 604.1b", "a mixed threshold needs every icon: [R][G] with Rage only is not met, with both it is", () => {
    const mixed = character({ name: "Mixed", threshold: "rg" });
    const short = buildGame({ cards: [...rage(2), { key: "c", def: mixed, owner: P1, zone: "hand" }] });
    refused(() => short.engine.perform({ type: "playCard", playerId: P1, cardId: short.id("c") }), "Rage only for [R][G]", /Threshold/);
    const ok = buildGame({
      cards: [
        ...rage(1),
        { key: "g", def: resourceCard({ name: "G", resource: { provides: ["greed"], staple: true } }), owner: P1 },
        { key: "c", def: mixed, owner: P1, zone: "hand" }
      ]
    });
    ok.engine.perform({ type: "playCard", playerId: P1, cardId: ok.id("c") });
    assert.equal(zoneOf(ok.engine, ok.id("c")), "deploying");
  });

  rule("CR 604.1b", "a face-down card provides the Volition icon, so it meets a Volition threshold", () => {
    const withFaceDown = buildGame({
      cards: [
        { key: "fd", def: character({ name: "Down" }), owner: P1, faceDown: true },
        { key: "c", def: character({ name: "C", threshold: "v" }), owner: P1, zone: "hand" }
      ]
    });
    withFaceDown.engine.perform({ type: "playCard", playerId: P1, cardId: withFaceDown.id("c") });
    assert.equal(zoneOf(withFaceDown.engine, withFaceDown.id("c")), "deploying");
    const without = buildGame({ cards: [...rage(2), { key: "c", def: character({ name: "C", threshold: "v" }), owner: P1, zone: "hand" }] });
    refused(() => without.engine.perform({ type: "playCard", playerId: P1, cardId: without.id("c") }), "no Volition icon", /Threshold/);
  });

  rule("CR 604.1b", "the threshold is checked before any cost: a card that fails it pays nothing", () => {
    const { engine, id } = buildGame({
      cards: [...rage(2), { key: "c", def: character({ name: "C", cost: 1, threshold: "gg" }), owner: P1, zone: "hand" }]
    });
    refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("c") }), "threshold unmet with an affordable cost", /Threshold/);
    assert.equal(spent(engine).length, 0, "no resource was spent");
    assert.equal(zoneOf(engine, id("c")), "hand");
  });

  rule("CR 604.1b", "resource icons are only checked, never spent, by a threshold: two cards with the same threshold can both be played from the same resources", () => {
    const { engine, id } = buildGame({
      cards: [
        ...rage(2),
        { key: "a", def: character({ name: "A", threshold: "rr" }), owner: P1, zone: "hand" },
        { key: "b", def: character({ name: "B", threshold: "rr" }), owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("a") });
    passWindows(engine);
    assert.equal(spent(engine).length, 0, "the threshold spent nothing");
    engine.perform({ type: "playCard", playerId: P1, cardId: id("b") });
    passWindows(engine);
    assert.equal(zoneOf(engine, id("a")), "play");
    assert.equal(zoneOf(engine, id("b")), "play");
  });
});

describe("CR 604.1c — play", () => {
  rule("CR 604.1c", "the card is put face-up into the being-deployed area: out of the hand, not yet in play, on the response stack", () => {
    const { engine, id } = buildGame({ cards: [{ key: "c", def: character({ name: "C" }), owner: P1, zone: "hand" }] });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("c") });
    const card = engine.state.cards[id("c")];
    assert.equal(card.zone, "deploying");
    assert.equal(card.faceDown, false, "face-up");
    assert.ok(!engine.state.players[P1].hand.includes(id("c")), "out of the hand");
    assert.ok(!engine.state.players[P1].play.includes(id("c")), "not in play yet");
    assert.deepEqual(engine.state.responseStack.map((item) => item.sourceId), [id("c")], "waiting on the stack");
  });

  rule("CR 604.1c", "a tactic is also put into the being-deployed area face-up", () => {
    const { engine, id } = buildGame({ cards: [{ key: "t", def: tactic({ name: "T" }), owner: P1, zone: "hand" }] });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("t") });
    assert.equal(engine.state.cards[id("t")].zone, "deploying");
    assert.equal(engine.state.cards[id("t")].faceDown, false);
  });
});

describe("CR 604.1d — costs", () => {
  rule("CR 604.1d", "the numeric cost is paid when the card is played, before any response: that many resources are spent", () => {
    const { engine, id } = buildGame({ cards: [...rage(3), { key: "c", def: character({ name: "C", cost: 2 }), owner: P1, zone: "hand" }] });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("c") });
    assert.equal(zoneOf(engine, id("c")), "deploying", "still waiting for responses");
    assert.equal(spent(engine).length, 2, "exactly the numeric cost was spent");
    assert.equal(engine.getAvailableResourceCount(P1), 1);
  });

  rule("CR 604.1d", "a card with no numeric cost spends no resources", () => {
    const { engine, id } = buildGame({ cards: [...rage(3), { key: "c", def: character({ name: "C" }), owner: P1, zone: "hand" }] });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("c") });
    assert.equal(spent(engine).length, 0);
  });

  rule("CR 604.1d", "an extra cost listed in the rules text is paid when the card is played", () => {
    const costly = character({ name: "Costly", behavior: { onPlay: { costs: [{ type: "loseInfluence", amount: 3 }] } } });
    const { engine, id } = buildGame({ cards: [{ key: "c", def: costly, owner: P1, zone: "hand" }] });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("c") });
    assert.equal(engine.state.players[P1].influence, 22, "3 influence was paid at once");
  });

  rule("CR 604.1d", "a discard extra cost is paid at play: the chosen card is in the discard pile while the card waits for responses", () => {
    const costly = character({
      name: "Costly",
      behavior: { onPlay: { costs: [{ type: "discard", id: "d", player: "controller", selector: {}, count: 1 }] } }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "c", def: costly, owner: P1, zone: "hand" },
        { key: "fodder", def: character({ name: "Fodder" }), owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("c"), selected: { d: [id("fodder")] } });
    assert.equal(zoneOf(engine, id("fodder")), "discard");
    assert.equal(zoneOf(engine, id("c")), "deploying");
  });

  rule("CR 604.1d", "the cost includes both the numeric cost and the extra costs: both are paid", () => {
    const costly = character({ name: "Costly", cost: 1, behavior: { onPlay: { costs: [{ type: "loseInfluence", amount: 2 }] } } });
    const { engine, id } = buildGame({ cards: [...rage(2), { key: "c", def: costly, owner: P1, zone: "hand" }] });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("c") });
    assert.equal(spent(engine).length, 1, "the numeric cost");
    assert.equal(engine.state.players[P1].influence, 23, "the extra cost");
  });

  rule(
    ["CR 604.1d"],
    "a trigger that occurs while the extra costs are paid waits until all the costs have been satisfied: both influence losses happen before the trigger resolves",
    () => {
      const { engine, id } = buildGame({
        cards: [
          { key: "w", def: costWatcher("Watch"), owner: P1 },
          { key: "c", def: twoLossCost("Costly"), owner: P1, zone: "hand" }
        ]
      });
      engine.perform({ type: "playCard", playerId: P1, cardId: id("c") });
      const lines = engine.state.gameLog.map((entry) => entry.marker ?? entry.message);
      const firstTrigger = lines.indexOf("triggerResolving");
      const losses = lines.map((line, index) => (/loses 1 influence/.test(line) ? index : -1)).filter((index) => index >= 0);
      assert.equal(losses.length, 2, "both costs were paid");
      assert.ok(firstTrigger > losses[1], "the trigger resolved only after the second cost was paid");
    }
  );

  rule(
    ["CR 604.1d"],
    "a trigger that occurs while the extra cost is paid waits for the numeric cost too: the spent resource is attached by the time it resolves",
    () => {
      const spentCounter = character({
        name: "SpentCounter",
        behavior: {
          abilities: [
            {
              id: "w",
              type: "triggered",
              event: "influenceChanged",
              effects: [
                {
                  type: "addCounter",
                  target: "source",
                  counter: "spent",
                  amount: { type: "count", selector: { type: "resource", controller: "self", zone: "play", attachedToFaction: true } }
                }
              ]
            }
          ]
        }
      });
      const costly = character({ name: "Costly", cost: 1, behavior: { onPlay: { costs: [{ type: "loseInfluence", amount: 1 }] } } });
      const { engine, id } = buildGame({
        cards: [...rage(2), { key: "w", def: spentCounter, owner: P1 }, { key: "c", def: costly, owner: P1, zone: "hand" }]
      });
      engine.perform({ type: "playCard", playerId: P1, cardId: id("c") });
      assert.equal(engine.state.cards[id("w")].counters.spent, 1, "when the trigger resolved the numeric cost had been paid");
    }
  );
});

describe("CR 604.1e — legality", () => {
  rule("CR 604.1e", "a numeric cost that cannot be paid makes the play illegal and leaves everything as it was", () => {
    const { engine, id } = buildGame({ cards: [...rage(1), { key: "c", def: character({ name: "C", cost: 2 }), owner: P1, zone: "hand" }] });
    const before = snapshot(engine);
    refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("c") }), "cost 2 with 1 resource", /Costs cannot be paid/);
    assert.equal(snapshot(engine), before, "nothing was paid or moved");
  });

  rule("CR 604.1e", "the exact cost is affordable (boundary of the previous test)", () => {
    const { engine, id } = buildGame({ cards: [...rage(2), { key: "c", def: character({ name: "C", cost: 2 }), owner: P1, zone: "hand" }] });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("c") });
    assert.equal(spent(engine).length, 2);
  });

  rule("CR 604.1e", "when a later cost cannot be satisfied, the costs already payable are not paid: everything is undone", () => {
    const stuck = character({
      name: "Stuck",
      cost: 1,
      behavior: {
        onPlay: {
          costs: [
            { type: "loseInfluence", amount: 2 },
            { type: "discard", id: "d", player: "controller", selector: {}, count: 1 }
          ]
        }
      }
    });
    const { engine, id } = buildGame({ cards: [...rage(2), { key: "c", def: stuck, owner: P1, zone: "hand" }] });
    const before = snapshot(engine);
    refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("c") }), "a discard cost with no card to discard");
    assert.equal(snapshot(engine), before, "influence, resources and card are all as before");
    assert.equal(engine.state.players[P1].influence, 25);
  });

  rule("CR 604.1e", "control: the same card is played once the discard cost can be satisfied", () => {
    const stuck = character({
      name: "Stuck",
      cost: 1,
      behavior: {
        onPlay: {
          costs: [
            { type: "loseInfluence", amount: 2 },
            { type: "discard", id: "d", player: "controller", selector: {}, count: 1 }
          ]
        }
      }
    });
    const { engine, id } = buildGame({
      cards: [...rage(2), { key: "c", def: stuck, owner: P1, zone: "hand" }, { key: "fodder", def: character({ name: "Fodder" }), owner: P1, zone: "hand" }]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("c"), selected: { d: [id("fodder")] } });
    assert.equal(engine.state.players[P1].influence, 23);
    assert.equal(spent(engine).length, 1);
    assert.equal(zoneOf(engine, id("fodder")), "discard");
  });

  rule("CR 604.1e", "triggers that occurred while an illegal play was being attempted are terminated: none resolves", () => {
    const stuck = character({
      name: "Stuck",
      behavior: {
        onPlay: {
          costs: [
            { type: "loseInfluence", amount: 1 },
            { type: "discard", id: "d", player: "controller", selector: {}, count: 1 }
          ]
        }
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "w", def: costWatcher("Watch"), owner: P1 },
        { key: "p", def: playWatcher("PlayWatch"), owner: P1 },
        { key: "c", def: stuck, owner: P1, zone: "hand" }
      ]
    });
    refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("c") }), "an unpayable discard cost");
    assert.equal(engine.state.cards[id("w")].counters.seen ?? 0, 0, "the influence trigger never resolved");
    assert.equal(engine.state.cards[id("p")].counters.seen ?? 0, 0, "the card-played trigger never resolved");
    assert.equal(triggerLog(engine).length, 0, "no trigger resolved at all");
  });
});

describe("CR 604.1f — triggers", () => {
  rule("CR 604.1f", "triggers that occurred while the card was being played happen together after the costs: both appear in one batch, before anyone can respond", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "w1", def: playWatcher("W1"), owner: P1 },
        { key: "w2", def: playWatcher("W2"), owner: P1 },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "hand" },
        { key: "reply", def: tactic({ name: "Reply" }), owner: P2, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("c") });
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "orderTriggers", "the two pending triggers are ordered together");
    if (pending?.kind !== "orderTriggers") return;
    assert.deepEqual(pending.triggers.map((trigger) => trigger.sourceId).sort(), [id("w1"), id("w2")].sort());
    refused(() => engine.perform({ type: "playCard", playerId: P2, cardId: id("reply") }), "responding before the triggers have happened", /pending choice/);
    orderNext(engine, id("w2"));
    assert.equal(engine.state.cards[id("w1")].counters.seen, 1);
    assert.equal(engine.state.cards[id("w2")].counters.seen, 1);
    engine.perform({ type: "playCard", playerId: P2, cardId: id("reply") });
    assert.equal(engine.state.responseStack.length, 2, "once the triggers have happened the opponent can respond");
  });

  rule("CR 604.1f", "a single trigger from the play happens before the opponent's response window can be used", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "w", def: playWatcher("W"), owner: P1 },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("c") });
    assert.equal(engine.state.cards[id("w")].counters.seen, 1, "the trigger has already happened when the play returns");
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  });
});

describe("CR 604.1g — responses", () => {
  rule("CR 604.1g", "after the card is played the opponent gets to respond; the card has not resolved while they may", () => {
    const ping = tactic({
      name: "Ping",
      behavior: { abilities: [{ id: "a", type: "activated", effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 2 }] }] }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "ping", def: ping, owner: P1, zone: "hand" },
        { key: "reply", def: tactic({ name: "Reply" }), owner: P2, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("ping") });
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent holds priority");
    assert.equal(engine.state.players[P2].influence, 25, "the tactic has not resolved");
    refused(() => engine.perform({ type: "passPriority", playerId: P1 }), "the player waits for the opponent", /priority/);
    engine.perform({ type: "playCard", playerId: P2, cardId: id("reply") });
    assert.equal(engine.state.responseStack.length, 2, "control: the opponent responded");
  });

  rule("CR 604.1g", "the card resolves only when the opponent has finished responding (passes)", () => {
    const ping = tactic({
      name: "Ping",
      behavior: { abilities: [{ id: "a", type: "activated", effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 2 }] }] }
    });
    const { engine, id } = buildGame({ cards: [{ key: "ping", def: ping, owner: P1, zone: "hand" }] });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("ping") });
    engine.perform({ type: "passPriority", playerId: P2 });
    engine.perform({ type: "advanceFlow" });
    assert.equal(engine.state.players[P2].influence, 23);
  });
});

describe("CR 604.1h — resolution", () => {
  rule("CR 604.1h", "a character resolves into play under its player's control", () => {
    const { engine, id } = buildGame({ cards: [{ key: "c", def: character({ name: "C" }), owner: P1, zone: "hand" }] });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("c") });
    passWindows(engine);
    assert.equal(zoneOf(engine, id("c")), "play");
    assert.equal(engine.state.cards[id("c")].controllerId, P1);
    assert.ok(engine.state.players[P1].play.includes(id("c")), "in the player's play list");
  });

  rule("CR 604.1h", "an item resolves into play under its player's control", () => {
    const { engine, id } = buildGame({ cards: [{ key: "i", def: item({ name: "I" }), owner: P1, zone: "hand" }] });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("i") });
    passWindows(engine);
    assert.equal(zoneOf(engine, id("i")), "play");
    assert.equal(engine.state.cards[id("i")].controllerId, P1);
  });

  rule("CR 604.1h", "a location resolves into play under its player's control", () => {
    const { engine, id } = buildGame({ cards: [{ key: "l", def: location({ name: "L" }), owner: P1, zone: "hand" }] });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("l") });
    passWindows(engine);
    assert.equal(zoneOf(engine, id("l")), "play");
    assert.equal(engine.state.cards[id("l")].controllerId, P1);
  });

  rule("CR 604.1h", "a tactic follows its instructions and goes to its owner's discard pile", () => {
    const ping = tactic({
      name: "Ping",
      behavior: { abilities: [{ id: "a", type: "activated", effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 2 }] }] }
    });
    const { engine, id } = buildGame({ cards: [{ key: "ping", def: ping, owner: P1, zone: "hand" }] });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("ping") });
    passWindows(engine);
    assert.equal(engine.state.players[P2].influence, 23, "the instructions were followed");
    assert.equal(zoneOf(engine, id("ping")), "discard");
    assert.ok(engine.state.players[P1].discard.includes(id("ping")), "in its owner's discard pile");
    assert.ok(!engine.state.players[P1].play.includes(id("ping")), "a tactic never enters play");
  });

  rule("CR 604.1h", "a tactic that does nothing still goes to the discard pile", () => {
    const { engine, id } = buildGame({ cards: [{ key: "t", def: tactic({ name: "Blank" }), owner: P1, zone: "hand" }] });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("t") });
    passWindows(engine);
    assert.equal(zoneOf(engine, id("t")), "discard");
  });

  rule("CR 604.1h", "a non-tactic is not put into the discard pile when it resolves", () => {
    const { engine, id } = buildGame({ cards: [{ key: "c", def: character({ name: "C" }), owner: P1, zone: "hand" }] });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("c") });
    passWindows(engine);
    assert.equal(engine.state.players[P1].discard.length, 0);
  });
});

describe("CR 604.2 — effects that let you deploy a card", () => {
  const gift = () =>
    tactic({
      name: "Gift",
      behavior: { abilities: [{ id: "a", type: "activated", effects: [{ type: "deployForFree", player: "controller", maxCost: 5, free: true }] }] }
    });
  const giftBoard = () =>
    buildGame({
      cards: [
        { key: "gift", def: gift(), owner: P1, zone: "hand" },
        { key: "chr", def: character({ name: "Chr" }), owner: P1, zone: "hand" },
        { key: "res", def: resourceCard({ name: "Res" }), owner: P1, zone: "hand" }
      ]
    });
  const resolveGift = (engine: SpoilsEngine, giftId: string) => {
    engine.perform({ type: "playCard", playerId: P1, cardId: giftId });
    engine.perform({ type: "passPriority", playerId: P2 });
    engine.perform({ type: "advanceFlow" });
  };

  rule("CR 604.2", "an effect that lets you deploy a card deploys a non-resource card by the usual steps: the character is offered and ends up in play", () => {
    const { engine, id } = giftBoard();
    resolveGift(engine, id("gift"));
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "deployForFree");
    if (pending?.kind !== "deployForFree") return;
    assert.ok(pending.candidates.includes(id("chr")), "the character is a candidate");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id("chr") } });
    assert.equal(zoneOf(engine, id("chr")), "play");
  });

  rule("CR 604.2", "the deploy steps still apply to a card an effect lets you deploy: its threshold must be met", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "gift", def: gift(), owner: P1, zone: "hand" },
        { key: "gated", def: character({ name: "Gated", threshold: "rr" }), owner: P1, zone: "hand" }
      ]
    });
    resolveGift(engine, id("gift"));
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "deployForFree");
    refused(
      () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id("gated") } }),
      "deploying a card whose threshold is unmet through an effect",
      /Threshold/
    );
  });

  rule(
    ["CR 604.2", "CR 605.2"],
    "an effect that lets you deploy a card can only deploy a non-resource card: a resource card in hand is not offered and cannot be chosen",
    () => {
      const { engine, id } = giftBoard();
      resolveGift(engine, id("gift"));
      const pending = engine.state.pendingChoice;
      assert.equal(pending?.kind, "deployForFree");
      if (pending?.kind !== "deployForFree") return;
      assert.ok(!pending.candidates.includes(id("res")), "the resource card is not a candidate");
      refused(
        () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id("res") } }),
        "deploying a resource card through a deploy effect"
      );
      assert.equal(zoneOf(engine, id("res")), "hand");
    }
  );
});

describe("CR 604.3 — cards entering play from deploying", () => {
  rule("CR 604.3", "all triggers off the deployed card entering play happen together: one batch", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "w1", def: enterWatcher("W1"), owner: P1 },
        { key: "w2", def: enterWatcher("W2"), owner: P1 },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("c") });
    passWindows(engine);
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "orderTriggers", "the two entering-play triggers are one batch");
    if (pending?.kind !== "orderTriggers") return;
    assert.deepEqual(pending.triggers.map((trigger) => trigger.sourceId).sort(), [id("w1"), id("w2")].sort());
    orderNext(engine, id("w1"));
    assert.equal(engine.state.cards[id("w1")].counters.seen, 1);
    assert.equal(engine.state.cards[id("w2")].counters.seen, 1);
  });

  rule("CR 604.3", "triggers belonging to both players happen together too, and the active player orders them", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "mine", def: enterWatcher("Mine"), owner: P1 },
        { key: "theirs", def: enterWatcher("Theirs"), owner: P2 },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("c") });
    passWindows(engine);
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "orderTriggers");
    assert.equal(pending?.playerId, P1, "the active player decides the order");
    if (pending?.kind !== "orderTriggers") return;
    assert.deepEqual(pending.triggers.map((trigger) => trigger.sourceId).sort(), [id("mine"), id("theirs")].sort());
  });

  rule("CR 604.3", "a single entering-play trigger needs no ordering and has happened when the card has resolved", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "w", def: enterWatcher("W"), owner: P1 },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("c") });
    passWindows(engine);
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(engine.state.cards[id("w")].counters.seen, 1);
  });
});

describe("CR 604.1 — the steps of deploying", () => {
  rule("CR 604.1", "deploying runs selection, threshold, play, costs, responses and resolution in that order", () => {
    const { engine, id } = buildGame({
      cards: [
        ...rage(2),
        { key: "c", def: character({ name: "C", cost: 1, threshold: "r" }), owner: P1, zone: "hand" },
        { key: "reply", def: tactic({ name: "Reply" }), owner: P2, zone: "hand" }
      ]
    });
    // Selection: the card is in the hand. Threshold: met. Nothing has happened yet.
    assert.equal(zoneOf(engine, id("c")), "hand");
    assert.equal(spent(engine).length, 0);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("c") });
    // Play and costs: in the being-deployed area, the cost already paid.
    assert.equal(zoneOf(engine, id("c")), "deploying");
    assert.equal(spent(engine).length, 1);
    // Responses: the opponent holds priority and the card has not resolved.
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
    assert.equal(zoneOf(engine, id("c")), "deploying");
    // Resolution: after the opponent passes the card is in play.
    engine.perform({ type: "passPriority", playerId: P2 });
    engine.perform({ type: "advanceFlow" });
    assert.equal(zoneOf(engine, id("c")), "play");
    assert.equal(spent(engine).length, 1, "the cost stays paid");
  });

  rule("CR 604.1", "the threshold step comes before the costs and the play step: a card that fails the threshold never reaches the being-deployed area", () => {
    const { engine, id } = buildGame({ cards: [{ key: "c", def: character({ name: "C", threshold: "g" }), owner: P1, zone: "hand" }] });
    refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("c") }), "threshold unmet", /Threshold/);
    assert.equal(zoneOf(engine, id("c")), "hand");
    assert.equal(engine.state.responseStack.length, 0);
  });
});
