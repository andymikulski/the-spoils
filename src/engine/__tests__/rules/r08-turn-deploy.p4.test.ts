// Batch r08-turn-deploy, part 4 (docs/TESTING.md): CR 605 Playing a Resource, CR 606 Using an Ability.
// Written from the wording of the Comprehensive Rules, not from the engine.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import { buildGame, character, P1, P2, resourceCard, tactic } from "../support/fixtures.js";
import type { CardPlacement } from "../support/fixtures.js";
import { refused, rule } from "./_rule.js";
import { orderNext, passWindows, triggerLog, zoneOf } from "./r08-turn-deploy.shared.js";

const rage = (n: number, owner: PlayerId = P1, prefix = "rage"): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({
    key: `${prefix}${i}`,
    def: resourceCard({ name: `${prefix}${i}`, resource: { provides: ["rage"], staple: true } }),
    owner
  }));

const spent = (engine: SpoilsEngine, player: PlayerId = P1) =>
  engine.state.players[player].play.filter((cardId) => engine.state.cards[cardId].attachedTo === engine.state.players[player].factionId);

const snapshot = (engine: SpoilsEngine) =>
  JSON.stringify({
    players: engine.state.players,
    cards: engine.state.cards,
    stack: engine.state.responseStack,
    window: engine.state.responseWindow,
    pending: engine.state.pendingChoice,
    log: engine.state.gameLog.length
  });

// ===========================================================================
// CR 605 — playing a resource
// ===========================================================================

/** A tactic whose only instruction is "play a resource". */
const REZ = tactic({ name: "Rez", behavior: { abilities: [{ id: "a", type: "activated", effects: [{ type: "playResource" }] }] } });

/** Plays `rezId`, lets it resolve, and leaves the engine at the first prompt of the resource play (or none). */
function runRez(engine: SpoilsEngine, rezId: CardInstanceId): void {
  engine.perform({ type: "playCard", playerId: P1, cardId: rezId });
  engine.perform({ type: "passPriority", playerId: P2 });
  engine.perform({ type: "advanceFlow" });
}

/** Picks `cardId` for the open "choose a card from your hand" prompt of a resource play. */
function choose(engine: SpoilsEngine, cardId: CardInstanceId): void {
  const pending = engine.state.pendingChoice;
  assert.equal(pending?.kind, "chooserSelectsTarget", "the player is asked to choose a card from their hand");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [cardId] } });
}

/** Answers the facing prompt of a resource play. */
function face(engine: SpoilsEngine, faceDown: boolean): void {
  assert.equal(engine.state.pendingChoice?.kind, "playResource", "the player is asked which side to play it");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "playResource", faceDown } });
}

const resourceWatcher = (name: string) =>
  character({
    name,
    behavior: {
      abilities: [
        {
          id: "w",
          type: "triggered",
          event: "resourcePlayed",
          effects: [
            {
              type: "addCounter",
              target: "source",
              counter: "inPlayWhenSeen",
              amount: { type: "count", selector: { type: "resource", controller: "self", zone: "play" } }
            },
            { type: "addCounter", target: "source", counter: "seen", amount: 1 }
          ]
        }
      ]
    }
  });

const enterWatcher = (name: string) =>
  character({
    name,
    behavior: { abilities: [{ id: "w", type: "triggered", event: "cardEnteredPlay", effects: [{ type: "addCounter", target: "source", counter: "seen", amount: 1 }] }] }
  });

describe("CR 605.1a — selection", () => {
  rule("CR 605.1a", "any card in the hand may be chosen: a character, a tactic or a resource card each end up in play as a resource", () => {
    const defs: CardDefinition[] = [character({ name: "Chr" }), tactic({ name: "Tac" }), resourceCard({ name: "Res" })];
    for (const def of defs) {
      const { engine, id } = buildGame({
        cards: [
          { key: "rez", def: REZ, owner: P1, zone: "hand" },
          { key: "pick", def, owner: P1, zone: "hand" },
          { key: "other", def: character({ name: "Other" }), owner: P1, zone: "hand" }
        ]
      });
      runRez(engine, id("rez"));
      choose(engine, id("pick"));
      if (engine.state.pendingChoice) face(engine, false);
      assert.equal(zoneOf(engine, id("pick")), "play", `a ${def.type} card played as a resource is in play`);
      assert.equal(zoneOf(engine, id("other")), "hand", "the card not chosen stays in hand");
    }
  });

  rule("CR 605.1a", "a hand with a single card has nothing to choose: that card is the one played", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "rez", def: REZ, owner: P1, zone: "hand" },
        { key: "only", def: character({ name: "Only" }), owner: P1, zone: "hand" }
      ]
    });
    runRez(engine, id("rez"));
    assert.equal(engine.state.pendingChoice, undefined, "no choice was needed");
    assert.equal(zoneOf(engine, id("only")), "play");
  });

  rule("CR 605.1a", "an empty hand: nothing is played and nothing goes wrong", () => {
    const { engine, id } = buildGame({ cards: [{ key: "rez", def: REZ, owner: P1, zone: "hand" }] });
    runRez(engine, id("rez"));
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(engine, id("rez")), "discard", "the instruction was carried out as far as possible");
    assert.deepEqual(engine.state.players[P1].play, [engine.state.players[P1].factionId], "only the faction is in play: no resource was played");
  });

  rule("CR 605.1a", "the card is chosen from the player's own hand: a card in the deck or the opponent's hand cannot be chosen", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "rez", def: REZ, owner: P1, zone: "hand" },
        { key: "a", def: character({ name: "A" }), owner: P1, zone: "hand" },
        { key: "b", def: character({ name: "B" }), owner: P1, zone: "hand" },
        { key: "inDeck", def: character({ name: "InDeck" }), owner: P1, zone: "deck" },
        { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "hand" }
      ]
    });
    runRez(engine, id("rez"));
    for (const key of ["inDeck", "theirs"]) {
      refused(
        () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id(key)] } }),
        `choosing ${key}`
      );
    }
    assert.equal(zoneOf(engine, id("inDeck")), "deck");
    assert.equal(zoneOf(engine, id("theirs")), "hand");
    choose(engine, id("a"));
    assert.equal(zoneOf(engine, id("a")), "play", "control: a card from the hand is accepted");
  });
});

describe("CR 605.1b — facing", () => {
  rule("CR 605.1b", "an actual resource card can be played face-up: it is in play face-up and provides its own icon", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "rez", def: REZ, owner: P1, zone: "hand" },
        { key: "res", def: resourceCard({ name: "Res", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" },
        { key: "other", def: character({ name: "Other" }), owner: P1, zone: "hand" }
      ]
    });
    runRez(engine, id("rez"));
    choose(engine, id("res"));
    face(engine, false);
    assert.equal(engine.state.cards[id("res")].faceDown, false);
    assert.equal(engine.getThresholds(P1).rage, 1, "its Rage icon");
    assert.equal(engine.getThresholds(P1).volition ?? 0, 0, "not Volition");
  });

  rule("CR 605.1b", "any card can be played face-down, an actual resource card included: it provides Volition, not its own icon", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "rez", def: REZ, owner: P1, zone: "hand" },
        { key: "res", def: resourceCard({ name: "Res", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" },
        { key: "other", def: character({ name: "Other" }), owner: P1, zone: "hand" }
      ]
    });
    runRez(engine, id("rez"));
    choose(engine, id("res"));
    face(engine, true);
    assert.equal(engine.state.cards[id("res")].faceDown, true);
    assert.equal(engine.getThresholds(P1).volition, 1, "Volition");
    assert.equal(engine.getThresholds(P1).rage ?? 0, 0);
  });

  rule("CR 605.1b", "a card that is not a resource card can only be played face-down", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "rez", def: REZ, owner: P1, zone: "hand" },
        { key: "chr", def: character({ name: "Chr" }), owner: P1, zone: "hand" },
        { key: "other", def: character({ name: "Other" }), owner: P1, zone: "hand" }
      ]
    });
    const faces = engine.getResourcePlayFaces(P1, id("chr"));
    assert.equal(faces.canFaceUp, false, "not face-up");
    assert.equal(faces.canFaceDown, true, "face-down is allowed");
    runRez(engine, id("rez"));
    choose(engine, id("chr"));
    assert.equal(engine.state.pendingChoice, undefined, "there is no facing to choose");
    assert.equal(engine.state.cards[id("chr")].faceDown, true);
    assert.equal(engine.getThresholds(P1).volition, 1);
  });

  rule("CR 605.1b", "a resource card offers both sides (boundary of the previous test)", () => {
    const { engine, id } = buildGame({ cards: [{ key: "res", def: resourceCard({ name: "Res" }), owner: P1, zone: "hand" }] });
    const faces = engine.getResourcePlayFaces(P1, id("res"));
    assert.equal(faces.canFaceUp, true);
    assert.equal(faces.canFaceDown, true);
  });
});

describe("CR 605.1c — while you play a resource", () => {
  rule("CR 605.1c", "a 'while you play a resource' trigger happens when a resource is played", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "rez", def: REZ, owner: P1, zone: "hand" },
        { key: "w", def: resourceWatcher("Watch"), owner: P1 },
        { key: "chr", def: character({ name: "Chr" }), owner: P1, zone: "hand" }
      ]
    });
    runRez(engine, id("rez"));
    assert.equal(engine.state.cards[id("w")].counters.seen, 1);
  });

  rule("CR 605.1c", "the trigger belongs to playing a resource: putting a card into play as a resource without playing it does not trigger it", () => {
    const putter = tactic({ name: "Putter", behavior: { abilities: [{ id: "a", type: "activated", effects: [{ type: "playResource", putIntoPlay: true }] }] } });
    const { engine, id } = buildGame({
      cards: [
        { key: "put", def: putter, owner: P1, zone: "hand" },
        { key: "w", def: resourceWatcher("Watch"), owner: P1 },
        { key: "chr", def: character({ name: "Chr" }), owner: P1, zone: "hand" }
      ]
    });
    runRez(engine, id("put"));
    assert.equal(zoneOf(engine, id("chr")), "play", "control: the card was put into play as a resource");
    assert.equal(engine.state.cards[id("w")].counters.seen ?? 0, 0, "but no resource was played");
  });

  rule(
    ["CR 605.1c"],
    "the trigger happens after the card is selected but BEFORE the resource enters play: the played card is not yet in play when it resolves",
    () => {
      const { engine, id } = buildGame({
        cards: [
          { key: "rez", def: REZ, owner: P1, zone: "hand" },
          { key: "w", def: resourceWatcher("Watch"), owner: P1 },
          { key: "chr", def: character({ name: "Chr" }), owner: P1, zone: "hand" }
        ]
      });
      runRez(engine, id("rez"));
      assert.equal(engine.state.cards[id("w")].counters.seen, 1, "the trigger resolved");
      assert.equal(engine.state.cards[id("w")].counters.inPlayWhenSeen, 0, "no resource was in play yet when it resolved");
    }
  );
});

describe("CR 605.1d — play", () => {
  rule("CR 605.1d", "the selected card leaves the hand and goes into play on the chosen side, under the player's control", () => {
    for (const faceDown of [false, true]) {
      const { engine, id } = buildGame({
        cards: [
          { key: "rez", def: REZ, owner: P1, zone: "hand" },
          { key: "res", def: resourceCard({ name: "Res" }), owner: P1, zone: "hand" },
          { key: "other", def: character({ name: "Other" }), owner: P1, zone: "hand" }
        ]
      });
      runRez(engine, id("rez"));
      choose(engine, id("res"));
      face(engine, faceDown);
      const card = engine.state.cards[id("res")];
      assert.equal(card.zone, "play");
      assert.equal(card.faceDown, faceDown, `played ${faceDown ? "face-down" : "face-up"}`);
      assert.equal(card.controllerId, P1);
      assert.ok(!engine.state.players[P1].hand.includes(id("res")), "left the hand");
      assert.ok(engine.state.players[P1].play.includes(id("res")), "in the play list");
    }
  });

  rule("CR 605.1d", "a resource that has just been played is ready to be spent: it is not attached to the faction", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "rez", def: REZ, owner: P1, zone: "hand" },
        { key: "res", def: resourceCard({ name: "Res" }), owner: P1, zone: "hand" },
        { key: "other", def: character({ name: "Other" }), owner: P1, zone: "hand" }
      ]
    });
    runRez(engine, id("rez"));
    choose(engine, id("res"));
    face(engine, false);
    assert.equal(engine.getAvailableResourceCount(P1), 1);
  });
});

describe("CR 605.2 — only an effect plays a resource", () => {
  rule("CR 605.2", "a resource card cannot be deployed as a card (control: an effect can play it as a resource)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "rez", def: REZ, owner: P1, zone: "hand" },
        { key: "res", def: resourceCard({ name: "Res" }), owner: P1, zone: "hand" },
        { key: "other", def: character({ name: "Other" }), owner: P1, zone: "hand" }
      ]
    });
    refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("res") }), "playing a resource without an effect", /Resource cards can only be played/);
    assert.equal(zoneOf(engine, id("res")), "hand");
    runRez(engine, id("rez"));
    choose(engine, id("res"));
    face(engine, false);
    assert.equal(zoneOf(engine, id("res")), "play", "control: the effect played it");
  });

  rule("CR 605.2", "nothing in a plain turn plays a resource: ending the turn and attacking leave the hand as it was", () => {
    const { engine, id } = buildGame({ cards: [{ key: "res", def: resourceCard({ name: "Res" }), owner: P1, zone: "hand" }] });
    engine.perform({ type: "endTurn", playerId: P1 });
    passWindows(engine);
    assert.equal(zoneOf(engine, id("res")), "hand");
  });
});

describe("CR 605.3 — entering play", () => {
  rule("CR 605.3", "all triggers off a resource entering play happen together: one batch", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "rez", def: REZ, owner: P1, zone: "hand" },
        { key: "w1", def: enterWatcher("W1"), owner: P1 },
        { key: "w2", def: enterWatcher("W2"), owner: P1 },
        { key: "chr", def: character({ name: "Chr" }), owner: P1, zone: "hand" }
      ]
    });
    runRez(engine, id("rez"));
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "orderTriggers", "the two entering-play triggers are one batch");
    if (pending?.kind !== "orderTriggers") return;
    assert.ok(pending.triggers.some((trigger) => trigger.sourceId === id("w1")), "W1 is in the batch");
    assert.ok(pending.triggers.some((trigger) => trigger.sourceId === id("w2")), "W2 is in the batch");
    orderNext(engine, id("w2"));
    for (let guard = 0; engine.state.pendingChoice && guard < 5; guard++) {
      const choice = engine.state.pendingChoice;
      if (choice.kind === "orderTriggers") orderNext(engine, choice.triggers[0].sourceId);
      else break;
    }
    assert.equal(engine.state.cards[id("w1")].counters.seen, 1);
    assert.equal(engine.state.cards[id("w2")].counters.seen, 1);
  });

  rule("CR 605.3", "a single entering-play trigger happens when the resource enters", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "rez", def: REZ, owner: P1, zone: "hand" },
        { key: "w", def: enterWatcher("W"), owner: P1 },
        { key: "chr", def: character({ name: "Chr" }), owner: P1, zone: "hand" }
      ]
    });
    runRez(engine, id("rez"));
    assert.equal(engine.state.cards[id("w")].counters.seen, 1);
  });
});

describe("CR 605.1 — the steps of playing a resource", () => {
  rule("CR 605.1", "playing a resource runs selection, facing and play in that order: the card is chosen from the hand, then the side, then it enters play", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "rez", def: REZ, owner: P1, zone: "hand" },
        { key: "res", def: resourceCard({ name: "Res" }), owner: P1, zone: "hand" },
        { key: "other", def: character({ name: "Other" }), owner: P1, zone: "hand" }
      ]
    });
    runRez(engine, id("rez"));
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget", "selection first");
    assert.equal(zoneOf(engine, id("res")), "hand");
    choose(engine, id("res"));
    assert.equal(engine.state.pendingChoice?.kind, "playResource", "then facing");
    assert.equal(zoneOf(engine, id("res")), "hand", "still in hand while the side is undecided");
    face(engine, true);
    assert.equal(zoneOf(engine, id("res")), "play", "then it enters play");
    assert.equal(engine.state.cards[id("res")].faceDown, true);
  });
});

// ===========================================================================
// CR 606 — using an ability
// ===========================================================================

/** A character ("go") with an ability that gives its controller 1 influence, with optional extras. */
function source(name: string, extra: Partial<Extract<NonNullable<CardDefinition["behavior"]>["abilities"], unknown[]>[number]> = {}): CardDefinition {
  return character({
    name,
    behavior: { abilities: [{ id: "go", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }], ...extra } as never] }
  });
}

const influence = (engine: SpoilsEngine, player: PlayerId) => engine.state.players[player].influence;

const lossWatcher = (name: string) =>
  character({
    name,
    behavior: { abilities: [{ id: "w", type: "triggered", event: "influenceChanged", condition: { type: "isActivePlayer" }, effects: [{ type: "addCounter", target: "source", counter: "seen", amount: 1 }] }] }
  });

describe("CR 606.1a — selection", () => {
  rule("CR 606.1a", "an ability on a card you control can be chosen", () => {
    const { engine, id } = buildGame({ cards: [{ key: "s", def: source("S"), owner: P1 }] });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("s"), abilityId: "go" });
    passWindows(engine);
    assert.equal(influence(engine, P1), 26);
  });

  rule("CR 606.1a", "an ability on a card your opponent controls cannot be chosen", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "mine", def: source("Mine"), owner: P1 },
        { key: "theirs", def: source("Theirs"), owner: P2 }
      ]
    });
    refused(() => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("theirs"), abilityId: "go" }), "using the opponent's ability");
    assert.equal(influence(engine, P2), 25);
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("mine"), abilityId: "go" });
    assert.equal(engine.state.responseStack.length, 1, "control: my own ability works");
  });

  rule("CR 606.1a", "control, not ownership, decides: a card you own but your opponent controls cannot be used by you, one you control but do not own can", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "lent", def: source("Lent"), owner: P1, controller: P2 },
        { key: "borrowed", def: source("Borrowed"), owner: P2, controller: P1 }
      ]
    });
    refused(() => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("lent"), abilityId: "go" }), "using an ability on a card I own but do not control");
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("borrowed"), abilityId: "go" });
    passWindows(engine);
    assert.equal(influence(engine, P1), 26, "the borrowed card's ability resolved for its controller");
  });

  rule("CR 606.1a", "in special cases an ability on a card you own that is not in play can be used: an ability that works from the discard pile", () => {
    const recur = source("Recur", { activationZone: "discard" });
    const { engine, id } = buildGame({ cards: [{ key: "r", def: recur, owner: P1, zone: "discard" }] });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("r"), abilityId: "go" });
    passWindows(engine);
    assert.equal(influence(engine, P1), 26);
  });

  rule("CR 606.1a", "an ability not marked for another zone cannot be used from the hand or the discard pile; one on a card you do not own cannot be used from their discard pile", () => {
    const plain = source("Plain");
    const recur = source("Recur", { activationZone: "discard" });
    const { engine, id } = buildGame({
      cards: [
        { key: "inHand", def: plain, owner: P1, zone: "hand" },
        { key: "inDiscard", def: plain, owner: P1, zone: "discard" },
        { key: "theirRecur", def: recur, owner: P2, zone: "discard" }
      ]
    });
    refused(() => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("inHand"), abilityId: "go" }), "an in-play ability from the hand");
    refused(() => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("inDiscard"), abilityId: "go" }), "an in-play ability from the discard pile");
    refused(() => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("theirRecur"), abilityId: "go" }), "the opponent's discard-pile ability");
    assert.equal(influence(engine, P1), 25);
  });
});

describe("CR 606.1b — threshold", () => {
  rule("CR 606.1b", "an ability whose threshold is met can be used, and the icons are not spent", () => {
    const { engine, id } = buildGame({ cards: [...rage(2), { key: "s", def: source("S", { threshold: "rr" }), owner: P1 }] });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("s"), abilityId: "go" });
    passWindows(engine);
    assert.equal(influence(engine, P1), 26);
    assert.equal(spent(engine).length, 0, "the threshold spent nothing");
  });

  rule("CR 606.1b", "one icon short of the ability's threshold: it cannot be used, and nothing changes", () => {
    const { engine, id } = buildGame({ cards: [...rage(1), { key: "s", def: source("S", { threshold: "rr" }), owner: P1 }] });
    const before = snapshot(engine);
    refused(() => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("s"), abilityId: "go" }), "[R][R] ability with one Rage", /threshold/i);
    assert.equal(snapshot(engine), before);
  });

  rule("CR 606.1b", "an ability without a threshold needs no icons", () => {
    const { engine, id } = buildGame({ cards: [{ key: "s", def: source("S"), owner: P1 }] });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("s"), abilityId: "go" });
    assert.equal(engine.state.responseStack.length, 1);
  });

  rule("CR 606.1b", "the threshold is checked before the costs: a failed threshold pays nothing", () => {
    const { engine, id } = buildGame({
      cards: [...rage(2), { key: "s", def: source("S", { threshold: "gg", costs: [{ type: "payResources", amount: 1 }] }), owner: P1 }]
    });
    refused(() => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("s"), abilityId: "go" }), "threshold unmet with an affordable cost", /threshold/i);
    assert.equal(spent(engine).length, 0);
  });
});

describe("CR 606.1c — costs", () => {
  rule("CR 606.1c", "the numeric cost is paid when the ability is used, before any response", () => {
    const { engine, id } = buildGame({ cards: [...rage(3), { key: "s", def: source("S", { costs: [{ type: "payResources", amount: 2 }] }), owner: P1 }] });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("s"), abilityId: "go" });
    assert.equal(spent(engine).length, 2, "two resources spent");
    assert.equal(influence(engine, P1), 25, "the effect has not happened yet");
  });

  rule("CR 606.1c", "an extra cost is paid when the ability is used: depleting the source", () => {
    const { engine, id } = buildGame({ cards: [{ key: "s", def: source("S", { costs: [{ type: "deplete", target: "source" }] }), owner: P1 }] });
    assert.equal(engine.state.cards[id("s")].depleted, false);
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("s"), abilityId: "go" });
    assert.equal(engine.state.cards[id("s")].depleted, true, "depleted as the cost");
  });

  rule("CR 606.1c", "both the numeric cost and the extra costs are paid", () => {
    const { engine, id } = buildGame({
      cards: [
        ...rage(2),
        { key: "s", def: source("S", { costs: [{ type: "payResources", amount: 1 }, { type: "loseInfluence", amount: 2 }, { type: "deplete", target: "source" }] }), owner: P1 }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("s"), abilityId: "go" });
    assert.equal(spent(engine).length, 1);
    assert.equal(influence(engine, P1), 23);
    assert.equal(engine.state.cards[id("s")].depleted, true);
  });

  rule(
    ["CR 606.1c"],
    "a trigger that occurs while the ability's costs are paid waits until all the costs have been satisfied: both influence losses happen before the trigger resolves",
    () => {
      const { engine, id } = buildGame({
        cards: [
          { key: "w", def: lossWatcher("Watch"), owner: P1 },
          { key: "s", def: source("S", { costs: [{ type: "loseInfluence", amount: 1 }, { type: "loseInfluence", amount: 1 }] }), owner: P1 }
        ]
      });
      engine.perform({ type: "activateAbility", playerId: P1, cardId: id("s"), abilityId: "go" });
      const lines = engine.state.gameLog.map((entry) => entry.marker ?? entry.message);
      const firstTrigger = lines.indexOf("triggerResolving");
      const losses = lines.map((line, index) => (/loses 1 influence/.test(line) ? index : -1)).filter((index) => index >= 0);
      assert.equal(losses.length, 2, "both costs were paid");
      assert.ok(firstTrigger > losses[1], "the trigger resolved only after the second cost was paid");
    }
  );

  rule(
    ["CR 606.1c"],
    "a trigger that occurs while an extra cost is paid waits for the numeric cost too: the spent resource is attached by the time it resolves",
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
      const { engine, id } = buildGame({
        cards: [
          ...rage(2),
          { key: "w", def: spentCounter, owner: P1 },
          { key: "s", def: source("S", { costs: [{ type: "loseInfluence", amount: 1 }, { type: "payResources", amount: 1 }] }), owner: P1 }
        ]
      });
      engine.perform({ type: "activateAbility", playerId: P1, cardId: id("s"), abilityId: "go" });
      assert.equal(engine.state.cards[id("w")].counters.spent, 1, "when the trigger resolved the numeric cost had been paid");
    }
  );
});

describe("CR 606.1d — legality", () => {
  rule("CR 606.1d", "a numeric cost that cannot be paid makes using the ability illegal and leaves everything as it was", () => {
    const { engine, id } = buildGame({ cards: [...rage(1), { key: "s", def: source("S", { costs: [{ type: "payResources", amount: 2 }] }), owner: P1 }] });
    const before = snapshot(engine);
    refused(() => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("s"), abilityId: "go" }), "cost 2 with 1 resource", /costs cannot be paid/i);
    assert.equal(snapshot(engine), before);
  });

  rule("CR 606.1d", "the exact numeric cost can be paid (boundary of the previous test)", () => {
    const { engine, id } = buildGame({ cards: [...rage(2), { key: "s", def: source("S", { costs: [{ type: "payResources", amount: 2 }] }), owner: P1 }] });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("s"), abilityId: "go" });
    assert.equal(spent(engine).length, 2);
  });

  rule("CR 606.1d", "an extra cost that cannot be paid makes it illegal: a depleted source cannot pay 'deplete this card'", () => {
    const { engine, id } = buildGame({ cards: [{ key: "s", def: source("S", { costs: [{ type: "deplete", target: "source" }] }), owner: P1, depleted: true }] });
    const before = snapshot(engine);
    refused(() => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("s"), abilityId: "go" }), "deplete cost on a depleted source");
    assert.equal(snapshot(engine), before);
  });

  rule("CR 606.1d", "when a later cost cannot be satisfied the earlier costs are undone: nothing stays paid", () => {
    const { engine, id } = buildGame({
      cards: [
        ...rage(2),
        { key: "s", def: source("S", { costs: [{ type: "loseInfluence", amount: 2 }, { type: "payResources", amount: 1 }, { type: "deplete", target: "source" }] }), owner: P1, depleted: true }
      ]
    });
    const before = snapshot(engine);
    refused(() => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("s"), abilityId: "go" }), "a later cost that cannot be paid");
    assert.equal(snapshot(engine), before, "influence, resources and the source are all as before");
    assert.equal(influence(engine, P1), 25);
    assert.equal(spent(engine).length, 0);
  });

  rule("CR 606.1d", "triggers that occurred while an illegal use was attempted are terminated: none resolves", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "w", def: lossWatcher("Watch"), owner: P1 },
        { key: "s", def: source("S", { costs: [{ type: "loseInfluence", amount: 1 }, { type: "deplete", target: "source" }] }), owner: P1, depleted: true }
      ]
    });
    refused(() => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("s"), abilityId: "go" }), "an unpayable deplete cost");
    assert.equal(engine.state.cards[id("w")].counters.seen ?? 0, 0);
    assert.equal(triggerLog(engine).length, 0, "no trigger resolved");
  });
});

describe("CR 606.1e — triggers", () => {
  rule("CR 606.1e", "triggers pending from the cost payment happen together once the costs are paid: two of them form one batch before anyone responds", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "w1", def: lossWatcher("W1"), owner: P1 },
        { key: "w2", def: lossWatcher("W2"), owner: P1 },
        { key: "s", def: source("S", { costs: [{ type: "loseInfluence", amount: 1 }] }), owner: P1 },
        { key: "reply", def: tactic({ name: "Reply" }), owner: P2, zone: "hand" }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("s"), abilityId: "go" });
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "orderTriggers", "the two triggers are ordered together");
    if (pending?.kind !== "orderTriggers") return;
    assert.deepEqual(pending.triggers.map((trigger) => trigger.sourceId).sort(), [id("w1"), id("w2")].sort());
    refused(() => engine.perform({ type: "playCard", playerId: P2, cardId: id("reply") }), "responding before the triggers have happened", /pending choice/);
    orderNext(engine, id("w1"));
    assert.equal(engine.state.cards[id("w1")].counters.seen, 1);
    assert.equal(engine.state.cards[id("w2")].counters.seen, 1);
    engine.perform({ type: "playCard", playerId: P2, cardId: id("reply") });
    assert.equal(engine.state.responseStack.length, 2, "afterwards the opponent can respond");
  });

  rule(
    ["CR 606.1e"],
    "with two costs that each cause a trigger, the pending triggers happen together after the costs: four triggers form one batch",
    () => {
      const { engine, id } = buildGame({
        cards: [
          { key: "w1", def: lossWatcher("W1"), owner: P1 },
          { key: "w2", def: lossWatcher("W2"), owner: P1 },
          { key: "s", def: source("S", { costs: [{ type: "loseInfluence", amount: 1 }, { type: "loseInfluence", amount: 1 }] }), owner: P1 }
        ]
      });
      engine.perform({ type: "activateAbility", playerId: P1, cardId: id("s"), abilityId: "go" });
      const pending = engine.state.pendingChoice;
      assert.equal(pending?.kind, "orderTriggers");
      if (pending?.kind !== "orderTriggers") return;
      assert.equal(pending.triggers.length, 4, "both influence losses were paid first, so the four triggers are one batch");
      assert.equal(influence(engine, P1), 23, "both costs were paid when the batch was offered");
    }
  );

  rule("CR 606.1e", "a single trigger from the cost has happened by the time the opponent can respond", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "w", def: lossWatcher("W"), owner: P1 },
        { key: "s", def: source("S", { costs: [{ type: "loseInfluence", amount: 1 }] }), owner: P1 }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("s"), abilityId: "go" });
    assert.equal(engine.state.cards[id("w")].counters.seen, 1);
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  });
});

describe("CR 606.1f / 606.1g — responses and resolution", () => {
  rule("CR 606.1f", "after the costs the opponent may respond to the ability: they hold priority and the ability has not resolved", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "s", def: source("S"), owner: P1 },
        { key: "reply", def: tactic({ name: "Reply" }), owner: P2, zone: "hand" }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("s"), abilityId: "go" });
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
    assert.equal(influence(engine, P1), 25, "not resolved while the opponent may respond");
    refused(() => engine.perform({ type: "passPriority", playerId: P1 }), "the user waits for the opponent", /priority/);
    engine.perform({ type: "playCard", playerId: P2, cardId: id("reply") });
    assert.equal(engine.state.responseStack.length, 2, "control: the opponent responded to the ability");
  });

  rule("CR 606.1g", "the ability resolves after the opponent has finished responding, following its effect", () => {
    const { engine, id } = buildGame({ cards: [{ key: "s", def: source("S"), owner: P1 }] });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("s"), abilityId: "go" });
    engine.perform({ type: "passPriority", playerId: P2 });
    engine.perform({ type: "advanceFlow" });
    assert.equal(influence(engine, P1), 26);
    assert.equal(engine.state.responseStack.length, 0);
  });

  rule("CR 606.1g", "the ability still resolves, as written when it was used, even if its source left play in response", () => {
    const killer = tactic({
      name: "Killer",
      behavior: {
        abilities: [{ id: "a", type: "activated", targets: [{ id: "t", selector: {}, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "s", def: source("S"), owner: P1 },
        { key: "kill", def: killer, owner: P2, zone: "hand" }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("s"), abilityId: "go" });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("kill"), selected: { t: [id("s")] } });
    passWindows(engine);
    assert.equal(zoneOf(engine, id("s")), "discard", "the source was destroyed in response");
    assert.equal(influence(engine, P1), 26, "its ability resolved anyway");
  });
});

describe("CR 606.1 — the steps of using an ability", () => {
  rule("CR 606.1", "using an ability runs selection, threshold, costs, responses and resolution in that order", () => {
    const { engine, id } = buildGame({
      cards: [
        ...rage(2),
        { key: "s", def: source("S", { threshold: "r", costs: [{ type: "payResources", amount: 1 }] }), owner: P1 },
        { key: "reply", def: tactic({ name: "Reply" }), owner: P2, zone: "hand" }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("s"), abilityId: "go" });
    assert.equal(spent(engine).length, 1, "costs are paid at the start");
    assert.equal(influence(engine, P1), 25, "and the ability has not resolved");
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
    engine.perform({ type: "passPriority", playerId: P2 });
    engine.perform({ type: "advanceFlow" });
    assert.equal(influence(engine, P1), 26, "resolution comes last");
  });

  rule("CR 606.1", "the threshold step comes before the costs: an ability that fails its threshold does not reach the response step", () => {
    const { engine, id } = buildGame({ cards: [{ key: "s", def: source("S", { threshold: "g" }), owner: P1 }] });
    refused(() => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("s"), abilityId: "go" }), "threshold unmet", /threshold/i);
    assert.equal(engine.state.responseStack.length, 0);
    assert.equal(engine.state.responseWindow, undefined);
  });
});
