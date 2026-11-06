// Batch r04-damage-control, part 3 (docs/TESTING.md): CR 409 Tokens and CR 411 Face-Down Cards.
// Written from the wording of the Comprehensive Rules, not from the engine.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import { logMessageFor } from "../../../types/log.js";
import {
  buildGame,
  character,
  defaultFactionDefinition,
  factionCard,
  item,
  location,
  P1,
  P2,
  resolvePendingResponses,
  resourceCard,
  tactic
} from "../support/fixtures.js";
import { refused, rule } from "./_rule.js";
import { developPlay, settleTurnStart } from "../support/develop.js";

const REF = (cardId: CardInstanceId) => ({ type: "card", id: cardId }) as const;
const ctx = (sourceId: CardInstanceId, controllerId: PlayerId = P1) => ({ sourceId, controllerId, selected: {} });

const zoneOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId]!.zone;
const counterOf = (engine: SpoilsEngine, cardId: CardInstanceId, name: string) => engine.state.cards[cardId]!.counters[name] ?? 0;
const tokenCount = (engine: SpoilsEngine, cardId: CardInstanceId) => counterOf(engine, cardId, "token");

/** Drains the response window, putting simultaneous triggers in the order offered, and asserts no prompt is left open. */
function settle(engine: SpoilsEngine): void {
  for (let guard = 0; guard < 20; guard++) {
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    const pending = engine.state.pendingChoice;
    if (!pending) return;
    assert.equal(pending.kind, "orderTriggers", `unexpected prompt: ${pending.kind}`);
    const first = pending.triggers[0]!;
    engine.perform({ type: "resolvePendingChoice", playerId: pending.playerId, choice: { kind: "orderTriggers", next: { sourceId: first.sourceId, abilityId: first.abilityId } } });
  }
  assert.fail("the prompts did not settle");
}

function passTurn(engine: SpoilsEngine): void {
  const active = engine.state.activePlayerId;
  engine.perform({ type: "endTurn", playerId: active });
  settle(engine);
  settleTurnStart(engine);
  assert.notEqual(engine.state.activePlayerId, active, "the turn passed to the other player");
}

/** A faction whose Develop Rule can draw or play a resource. */
const developFaction = () =>
  factionCard({
    name: "Developers",
    faction: defaultFactionDefinition({
      turn: {
        restore: { detachResources: true, restoreNonResources: true },
        develop: { choices: [{ type: "draw", count: 1 }, { type: "playResource", count: 1 }] }
      }
    })
  });

/** Counts, on itself, the cards it sees leave play (`left`) and enter play (`entered`). */
const watcher = (name: string) =>
  character({
    name,
    behavior: {
      abilities: [
        { id: "l", type: "triggered", event: "cardMoved", condition: { type: "cardMovedFromZone", zone: "play" }, effects: [{ type: "addCounter", target: "source", counter: "left", amount: 1 }] },
        { id: "e", type: "triggered", event: "cardEnteredPlay", effects: [{ type: "addCounter", target: "source", counter: "entered", amount: 1 }] }
      ]
    }
  });

const SPEC = { name: "Wisp", cardType: "character", strength: 1, life: 2, speed: 3 } as const;

describe("CR 409.1 / 409.2 — tokens on cards", () => {
  rule("CR 409.1", "a token is placed on a card in play, and can be taken off again, one count at a time", () => {
    const { engine, id } = buildGame({ cards: [{ key: "host", def: character({ name: "Host" }), owner: P1 }, { key: "src", def: character({ name: "Src" }), owner: P2 }] });
    engine.resolveEffect({ type: "addCounter", target: REF(id("host")), counter: "token", amount: 2 }, ctx(id("src")));
    assert.equal(tokenCount(engine, id("host")), 2, "two tokens are on the card");
    engine.resolveEffect({ type: "removeCounter", target: REF(id("host")), counter: "token", amount: 1 }, ctx(id("src")));
    assert.equal(tokenCount(engine, id("host")), 1, "one was removed");
    engine.resolveEffect({ type: "removeCounter", target: REF(id("host")), counter: "token", amount: 5 }, ctx(id("src")));
    assert.equal(tokenCount(engine, id("host")), 0, "removing more than there are leaves none, never a negative number");
  });

  rule("CR 409.1", "tokens have no inherent meaning: a card with tokens on it is otherwise unchanged", () => {
    const { engine, id } = buildGame({ cards: [{ key: "host", def: character({ name: "Host", strength: 2, life: 4, speed: 3 }), owner: P1 }, { key: "src", def: character({ name: "Src" }), owner: P2 }] });
    engine.resolveEffect({ type: "addCounter", target: REF(id("host")), counter: "token", amount: 3 }, ctx(id("src")));
    assert.equal(engine.getStat(id("host"), "strength"), 2, "strength is unchanged");
    assert.equal(engine.getStat(id("host"), "life"), 4, "life is unchanged");
    assert.equal(engine.getStat(id("host"), "speed"), 3, "speed is unchanged");
    assert.equal(zoneOf(engine, id("host")), "play", "and it is still in play");
  });

  rule("CR 409.1", "a card explains how it uses tokens in its rules text: here +1 strength for each token on it", () => {
    const grower = character({
      name: "Grower",
      strength: 1,
      behavior: {
        abilities: [
          {
            id: "grow",
            type: "continuous",
            modifiers: [{ target: "source", stat: "strength", operation: "add", value: { type: "counter", target: "source", counter: "token" } }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({ cards: [{ key: "grower", def: grower, owner: P1 }, { key: "plain", def: character({ name: "Plain", strength: 1 }), owner: P1 }, { key: "src", def: character({ name: "Src" }), owner: P2 }] });
    engine.resolveEffect({ type: "addCounter", target: REF(id("grower")), counter: "token", amount: 2 }, ctx(id("src")));
    engine.resolveEffect({ type: "addCounter", target: REF(id("plain")), counter: "token", amount: 2 }, ctx(id("src")));
    assert.equal(engine.getStat(id("grower"), "strength"), 3, "the card that says what its tokens do reads them");
    assert.equal(engine.getStat(id("plain"), "strength"), 1, "a card that says nothing about tokens ignores them");
  });

  for (const to of ["hand", "discard", "deck", "void"] as const) {
    rule("CR 409.2", `tokens on a card that leaves play for the ${to} disappear`, () => {
      const { engine, id } = buildGame({ cards: [{ key: "host", def: character({ name: "Host" }), owner: P2, counters: { token: 3, other: 1 } }, { key: "src", def: character({ name: "Src" }), owner: P1 }] });
      engine.resolveEffect({ type: "moveCard", target: REF(id("host")), to }, ctx(id("src")));
      assert.equal(zoneOf(engine, id("host")), to, `it is in the ${to}`);
      assert.equal(tokenCount(engine, id("host")), 0, "its tokens are gone");
      assert.equal(counterOf(engine, id("host"), "other"), 0, "whatever kind of token they were");
    });
  }

  rule("CR 409.2", "tokens on a card that is destroyed or removed from the game disappear", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P2, counters: { token: 2 } },
        { key: "b", def: character({ name: "B" }), owner: P2, counters: { token: 2 } },
        { key: "src", def: character({ name: "Src" }), owner: P1 }
      ]
    });
    engine.resolveEffect({ type: "destroy", target: REF(id("a")) }, ctx(id("src")));
    engine.resolveEffect({ type: "removeFromGame", target: REF(id("b")) }, ctx(id("src")));
    assert.equal(zoneOf(engine, id("a")), "discard", "destroyed");
    assert.equal(tokenCount(engine, id("a")), 0, "its tokens are gone");
    assert.equal(zoneOf(engine, id("b")), "removed", "removed from the game");
    assert.equal(tokenCount(engine, id("b")), 0, "its tokens are gone");
  });

  rule("CR 409.2", "a card that comes back into play has no tokens", () => {
    const { engine, id } = buildGame({ cards: [{ key: "host", def: character({ name: "Host" }), owner: P1, counters: { token: 3 } }, { key: "src", def: character({ name: "Src" }), owner: P1 }] });
    engine.resolveEffect({ type: "moveCard", target: REF(id("host")), to: "hand" }, ctx(id("src")));
    engine.perform({ type: "playCard", playerId: P1, cardId: id("host") });
    settle(engine);
    assert.equal(zoneOf(engine, id("host")), "play", "it is back in play");
    assert.equal(tokenCount(engine, id("host")), 0, "without its old tokens");
  });

  rule("CR 409.2", "control: tokens stay on a card that remains in play, through turns and a change of control", () => {
    const steal = character({
      name: "Thief",
      behavior: {
        abilities: [
          { id: "steal", type: "activated", targets: [{ id: "t", selector: { controller: "opponent", type: "character" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }] }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "thief", def: steal, owner: P1 },
        { key: "host", def: character({ name: "Host" }), owner: P2, counters: { token: 3 } }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("thief"), abilityId: "steal", selected: { t: [id("host")] } });
    settle(engine);
    passTurn(engine);
    passTurn(engine);
    assert.equal(engine.state.cards[id("host")]!.controllerId, P1, "the card changed hands");
    assert.equal(tokenCount(engine, id("host")), 3, "its tokens stayed");
  });

  rule("CR 409.2", "tokens on a location disappear when it is destroyed, not before", () => {
    const { engine, id } = buildGame({ cards: [{ key: "fort", def: location({ name: "Fort", structure: 2 }), owner: P2, counters: { token: 2 } }, { key: "src", def: character({ name: "Src" }), owner: P1 }] });
    engine.resolveEffect({ type: "dealDamage", target: REF(id("fort")), amount: 1 }, ctx(id("src")));
    assert.equal(tokenCount(engine, id("fort")), 2, "still in play, so the tokens stay");
    engine.resolveEffect({ type: "destroy", target: REF(id("fort")) }, ctx(id("src")));
    assert.equal(tokenCount(engine, id("fort")), 0, "destroyed, so they are gone");
  });
});

describe("CR 409.3 — Card Tokens", () => {
  const makeToken = (engine: SpoilsEngine, sourceId: CardInstanceId, controller: "controller" | "opponent" = "controller", controllerId: PlayerId = P1): CardInstanceId => {
    engine.resolveEffect({ type: "createTokens", controller, count: 1, token: SPEC }, ctx(sourceId, controllerId));
    const token = Object.values(engine.state.cards).find((card) => card.isToken);
    assert.ok(token, "a card token was created");
    return token!.id;
  };

  rule("CR 409.3a", "when a Card Token is destroyed, its attached cards go to the discard pile and the token disappears", () => {
    const { engine, id } = buildGame({ cards: [{ key: "src", def: character({ name: "Src" }), owner: P1 }, { key: "gear", def: item({ name: "Gear", attachTo: "character" }), owner: P1 }] });
    engine.resolveEffect(
      { type: "createTokens", controller: "controller", count: 1, token: SPEC, effects: [{ type: "attachTo", target: REF(id("gear")), to: { type: "selected", id: "__candidate" } }] },
      ctx(id("src"))
    );
    const tokenId = Object.values(engine.state.cards).find((card) => card.isToken)!.id;
    assert.equal(engine.state.cards[id("gear")]!.attachedTo, tokenId, "the gear is attached to the token");
    engine.resolveEffect({ type: "destroy", target: REF(tokenId) }, ctx(id("src")));
    assert.equal(zoneOf(engine, id("gear")), "discard", "the attached card was destroyed with it");
    assert.equal(engine.state.cards[tokenId], undefined, "the token no longer exists");
    assert.ok(!Object.values(engine.state.players).some((player) => player.play.includes(tokenId) || player.discard.includes(tokenId)), "and is in no player's zone");
  });

  rule("CR 409.3a", "when a Card Token is returned to hand, its attached cards leave play in that manner, and the token disappears", () => {
    const { engine, id } = buildGame({ cards: [{ key: "src", def: character({ name: "Src" }), owner: P1 }, { key: "gear", def: item({ name: "Gear", attachTo: "character" }), owner: P1 }] });
    engine.resolveEffect(
      { type: "createTokens", controller: "controller", count: 1, token: SPEC, effects: [{ type: "attachTo", target: REF(id("gear")), to: { type: "selected", id: "__candidate" } }] },
      ctx(id("src"))
    );
    const tokenId = Object.values(engine.state.cards).find((card) => card.isToken)!.id;
    engine.resolveEffect({ type: "moveCard", target: REF(tokenId), to: "hand" }, ctx(id("src")));
    assert.equal(zoneOf(engine, id("gear")), "hand", "the attached card went to its owner's hand: it left play the way the token was sent");
    assert.equal(engine.state.cards[tokenId], undefined, "the token no longer exists, it is not in anyone's hand");
    assert.ok(!engine.state.players[P1].hand.includes(tokenId), "the token is not in a hand");
  });

  rule("CR 409.3a", "when a Card Token is removed from the game, its attached cards are too", () => {
    const { engine, id } = buildGame({ cards: [{ key: "src", def: character({ name: "Src" }), owner: P1 }, { key: "gear", def: item({ name: "Gear", attachTo: "character" }), owner: P2 }] });
    engine.resolveEffect(
      { type: "createTokens", controller: "controller", count: 1, token: SPEC, effects: [{ type: "attachTo", target: REF(id("gear")), to: { type: "selected", id: "__candidate" } }] },
      ctx(id("src"))
    );
    const tokenId = Object.values(engine.state.cards).find((card) => card.isToken)!.id;
    engine.resolveEffect({ type: "removeFromGame", target: REF(tokenId) }, ctx(id("src")));
    assert.equal(zoneOf(engine, id("gear")), "removed", "the attached card left the game in that manner");
    assert.equal(engine.state.cards[tokenId], undefined, "the token no longer exists");
  });

  rule("CR 409.3a", "control: a token that stays in play keeps its attachment", () => {
    const { engine, id } = buildGame({ cards: [{ key: "src", def: character({ name: "Src" }), owner: P1 }, { key: "gear", def: item({ name: "Gear", attachTo: "character" }), owner: P1 }] });
    engine.resolveEffect(
      { type: "createTokens", controller: "controller", count: 1, token: SPEC, effects: [{ type: "attachTo", target: REF(id("gear")), to: { type: "selected", id: "__candidate" } }] },
      ctx(id("src"))
    );
    const tokenId = Object.values(engine.state.cards).find((card) => card.isToken)!.id;
    assert.equal(zoneOf(engine, id("gear")), "play", "the gear is in play");
    assert.equal(engine.state.cards[id("gear")]!.attachedTo, tokenId, "attached to the token");
    assert.ok(engine.state.cards[tokenId], "the token exists");
  });

  rule("CR 409.3b", "the owner of a Card Token is the player who controlled the effect that created it", () => {
    const { engine, id } = buildGame({ cards: [{ key: "src1", def: character({ name: "Src1" }), owner: P1 }, { key: "src2", def: character({ name: "Src2" }), owner: P2 }] });
    const first = makeToken(engine, id("src1"), "controller", P1);
    assert.equal(engine.state.cards[first]!.ownerId, P1, "created by my effect: I own it");
    assert.equal(engine.state.cards[first]!.controllerId, P1, "and control it");
    engine.resolveEffect({ type: "createTokens", controller: "controller", count: 1, token: SPEC }, ctx(id("src2"), P2));
    const second = Object.values(engine.state.cards).find((card) => card.isToken && card.id !== first)!;
    assert.equal(second.ownerId, P2, "created by the opponent's effect: they own it");
  });

  rule(
    "CR 409.3b",
    "a token made by my effect but put into play under my opponent's control is owned by me, the effect's controller",
    () => {
      const { engine, id } = buildGame({ cards: [{ key: "src", def: character({ name: "Src" }), owner: P1 }] });
      engine.resolveEffect({ type: "createTokens", controller: "opponent", count: 1, token: SPEC }, ctx(id("src"), P1));
      const token = Object.values(engine.state.cards).find((card) => card.isToken)!;
      assert.equal(token.controllerId, P2, "the token enters play under my opponent's control");
      assert.equal(token.ownerId, P1, "but its owner is the player who controlled the effect that created it");
    }
  );

  rule("CR 409.3c", "a Micromajig token is a Gearsmith character with 1 strength, 1 life, 3 speed and the majig subtype", () => {
    const { engine, id } = buildGame({ cards: [{ key: "src", def: character({ name: "Src" }), owner: P1 }] });
    engine.resolveEffect(
      { type: "createTokens", controller: "controller", count: 1, token: { name: "Micromajig", cardType: "character", subtype: ["majig"], strength: 1, life: 1, speed: 3 } },
      ctx(id("src"))
    );
    const token = Object.values(engine.state.cards).find((card) => card.isToken)!;
    const definition = engine.getDefinition(token.id);
    assert.equal(definition.name, "Micromajig", "it is a Micromajig");
    assert.equal(definition.type, "character", "a character card");
    assert.equal(definition.trade, "gearsmith", "of the Gearsmith trade");
    assert.ok(definition.subtype.includes("majig"), "with the majig subtype");
    assert.equal(engine.getStat(token.id, "strength"), 1, "1 strength");
    assert.equal(engine.getStat(token.id, "life"), 1, "1 life");
    assert.equal(engine.getStat(token.id, "speed"), 3, "3 speed");
    assert.deepEqual(
      engine.queryCards({ subtype: "majig", controller: "self" }, ctx(id("src"))).map((card) => card.id),
      [token.id],
      "selectors for majigs find it"
    );
  });

  rule("CR 409.3c", "a token without the majig subtype is not a Gearsmith card by default (control)", () => {
    const { engine, id } = buildGame({ cards: [{ key: "src", def: character({ name: "Src" }), owner: P1 }] });
    makeToken(engine, id("src"));
    const token = Object.values(engine.state.cards).find((card) => card.isToken)!;
    assert.notEqual(engine.getDefinition(token.id).trade, "gearsmith", "an ordinary token is not Gearsmith");
    assert.deepEqual(engine.queryCards({ subtype: "majig", controller: "self" }, ctx(id("src"))), [], "and not a majig");
  });
});

describe("CR 411.1 — face-down cards in play are Volition resources", () => {
  rule("CR 411.1", "a face-down card in play is a resource that provides one Volition icon, whatever the card is", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "fd1", def: character({ name: "Hidden Hero" }), owner: P1, faceDown: true },
        { key: "fd2", def: tactic({ name: "Hidden Plan" }), owner: P1, faceDown: true },
        { key: "up", def: character({ name: "Open Hero" }), owner: P1 }
      ]
    });
    assert.equal(engine.isResource(id("fd1")), true, "a face-down character is a resource");
    assert.equal(engine.isResource(id("fd2")), true, "a face-down tactic is a resource");
    assert.equal(engine.isResource(id("up")), false, "control: a face-up character is not");
    assert.deepEqual(engine.getThresholds(P1), { volition: 2 }, "one Volition per face-down card, nothing from the face-up one");
    const resources = engine.queryCards({ controller: "self", type: "resource" }, ctx(id("up"))).map((card) => card.id);
    assert.ok(resources.includes(id("fd1")) && resources.includes(id("fd2")), "selectors for resources find the face-down cards");
    assert.ok(!resources.includes(id("up")), "and not the face-up one");
  });

  rule("CR 411.1", "face-down cards pay a numeric cost like any resource: two pay for a cost of 2, one cannot", () => {
    const costly = tactic({ name: "Costly", cost: 2 });
    const two = buildGame({
      cards: [
        { key: "t", def: costly, owner: P1, zone: "hand" },
        { key: "fd1", def: character({ name: "A" }), owner: P1, faceDown: true },
        { key: "fd2", def: character({ name: "B" }), owner: P1, faceDown: true }
      ]
    });
    two.engine.perform({ type: "playCard", playerId: P1, cardId: two.id("t") });
    settle(two.engine);
    assert.equal(zoneOf(two.engine, two.id("t")), "discard", "the tactic resolved");
    assert.equal(two.engine.getAvailableResourceCount(P1), 0, "both face-down cards were spent");

    const one = buildGame({
      cards: [
        { key: "t", def: costly, owner: P1, zone: "hand" },
        { key: "fd1", def: character({ name: "A" }), owner: P1, faceDown: true }
      ]
    });
    refused(() => one.engine.perform({ type: "playCard", playerId: P1, cardId: one.id("t") }), "one resource short of the cost", /cannot be paid/);
  });

  rule("CR 411.1", "face-down cards of both players count for their own controller only", () => {
    const { engine } = buildGame({
      cards: [
        { key: "mine", def: character({ name: "Mine" }), owner: P1, faceDown: true },
        { key: "theirs1", def: character({ name: "Theirs1" }), owner: P2, faceDown: true },
        { key: "theirs2", def: character({ name: "Theirs2" }), owner: P2, faceDown: true }
      ]
    });
    assert.deepEqual(engine.getThresholds(P1), { volition: 1 }, "my one face-down card");
    assert.deepEqual(engine.getThresholds(P2), { volition: 2 }, "their two");
  });

  rule("CR 411.1", "Note: a face-down card in the Void is not in play, so it is not a resource and provides nothing", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "hero", def: character({ name: "Hero" }), owner: P1 },
        { key: "mover", def: character({ name: "Mover" }), owner: P1 }
      ]
    });
    assert.deepEqual(engine.getThresholds(P1), {}, "no Volition before");
    engine.resolveEffect({ type: "moveCard", target: REF(id("hero")), to: "void", faceDown: true }, ctx(id("mover")));
    assert.equal(zoneOf(engine, id("hero")), "void", "it is in the void");
    assert.equal(engine.state.cards[id("hero")]!.faceDown, true, "face-down");
    assert.equal(engine.isResource(id("hero")), false, "not a resource");
    assert.deepEqual(engine.getThresholds(P1), {}, "providing no Volition");
    assert.equal(engine.getAvailableResourceCount(P1), 0, "and no payment");
  });

  rule("CR 411.1", "a face-down card is a resource, not its printed type: a face-down character cannot attack (a face-up one can: control)", () => {
    const board = (faceDown: boolean) =>
      buildGame({ cards: [{ key: "hero", def: character({ name: "Hero", strength: 2 }), owner: P1, faceDown, zone: "play" }] });
    const down = board(true);
    refused(
      () => down.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [down.id("hero")], target: { type: "faction", playerId: P2 } }),
      "a face-down card attacks"
    );
    const up = board(false);
    up.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [up.id("hero")], target: { type: "faction", playerId: P2 } });
    assert.deepEqual(up.engine.state.battle?.attackingParty, [up.id("hero")], "control: the face-up character attacks");
  });
});

describe("CR 411.2 — the controller may look at the front face", () => {
  rule("CR 411.2", "a card played face-down keeps its front face for its controller; the opponent's view of the log hides it", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "gem", def: character({ name: "Hidden Gem" }), owner: P1, zone: "hand" }]
    });
    developPlay(engine, P1, id("gem"), true);
    const card = engine.state.cards[id("gem")]!;
    assert.equal(card.faceDown, true, "it is face-down in play");
    assert.equal(engine.getDefinition(id("gem")).name, "Hidden Gem", "its front face is still known to the engine");
    assert.equal(engine.getDefinition(id("gem")).type, "character", "front face: a character");
    const played = engine.getLog().find((entry) => entry.event?.type === "resourcePlayed");
    assert.ok(played, "the play was logged");
    assert.match(logMessageFor(played!, P1), /Hidden Gem/, "its controller sees the front face");
    assert.doesNotMatch(logMessageFor(played!, P2), /Hidden Gem/, "the opponent does not");
    assert.match(logMessageFor(played!, P2), /face-down card/, "the opponent only learns that a face-down card was played");
  });

  rule("CR 411.2", "a face-down card that is later flipped up is the card its controller saw", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "fd", def: character({ name: "Secret Hero", strength: 4 }), owner: P1, faceDown: true },
        { key: "src", def: character({ name: "Src" }), owner: P1 }
      ]
    });
    assert.equal(engine.getDefinition(id("fd")).name, "Secret Hero", "front face while face-down");
    engine.resolveEffect({ type: "flipFaceUp", target: REF(id("fd")) }, ctx(id("src")));
    assert.equal(engine.state.cards[id("fd")]!.faceDown, false, "flipped up");
    assert.equal(engine.getDefinition(id("fd")).name, "Secret Hero", "the same card");
    assert.equal(engine.getStat(id("fd"), "strength"), 4, "with the strength it had on its front face");
  });
});

describe("CR 411.3 — flipping a face-down card face-up", () => {
  const hero = () =>
    character({
      name: "Hero",
      strength: 2,
      behavior: { abilities: [{ id: "enter", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "addCounter", target: "source", counter: "arrived", amount: 1 }] }] }
    });

  rule("CR 411.3", "a card flipped face-up stops being a resource: it no longer provides Volition", () => {
    const { engine, id } = buildGame({ cards: [{ key: "fd", def: hero(), owner: P1, faceDown: true }, { key: "src", def: character({ name: "Src" }), owner: P1 }] });
    assert.deepEqual(engine.getThresholds(P1), { volition: 1 }, "before: one Volition");
    assert.equal(engine.isResource(id("fd")), true, "before: a resource");
    engine.resolveEffect({ type: "flipFaceUp", target: REF(id("fd")) }, ctx(id("src")));
    assert.equal(engine.isResource(id("fd")), false, "after: no longer a resource");
    assert.deepEqual(engine.getThresholds(P1), {}, "after: no Volition");
    assert.ok(engine.getCardTypes(id("fd")).includes("character"), "it is a character now");
    assert.equal(zoneOf(engine, id("fd")), "play", "and still in play");
  });

  rule("CR 411.3", "a face-down resource card flipped up provides its own printed icon instead of Volition", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "gem", def: resourceCard({ name: "Gem" }), owner: P1, faceDown: true },
        { key: "src", def: character({ name: "Src" }), owner: P1 }
      ]
    });
    assert.deepEqual(engine.getThresholds(P1), { volition: 1 }, "face-down: Volition");
    engine.resolveEffect({ type: "flipFaceUp", target: REF(id("gem")) }, ctx(id("src")));
    assert.deepEqual(engine.getThresholds(P1), { rage: 1 }, "face-up: its printed icon");
  });

  rule("CR 411.3", "the face-up version is considered to have entered play: its 'enters play' trigger happens, and other cards see it enter", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "fd", def: hero(), owner: P1, faceDown: true },
        { key: "watch", def: watcher("Watcher"), owner: P2 },
        { key: "src", def: character({ name: "Src" }), owner: P1 }
      ]
    });
    const entered = () => counterOf(engine, id("watch"), "entered");
    assert.equal(counterOf(engine, id("fd"), "arrived"), 0, "before: nothing has entered");
    engine.resolveEffect({ type: "flipFaceUp", target: REF(id("fd")) }, ctx(id("src")));
    settle(engine);
    assert.equal(counterOf(engine, id("fd"), "arrived"), 1, "its own enters-play trigger fired");
    assert.equal(entered(), 1, "another card saw a card enter play");
  });

  rule("CR 411.3", "a card flipped up this turn is a completely new card: it cannot attack until its controller has had it since a turn began", () => {
    const board = (flip: boolean) => {
      const built = buildGame({
        cards: [
          { key: "fd", def: hero(), owner: P1, faceDown: true },
          { key: "src", def: character({ name: "Src" }), owner: P1 },
          { key: "veteran", def: character({ name: "Veteran", strength: 2 }), owner: P1 }
        ]
      });
      if (flip) built.engine.resolveEffect({ type: "flipFaceUp", target: REF(built.id("fd")) }, ctx(built.id("src")));
      return built;
    };
    const flipped = board(true);
    refused(
      () => flipped.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [flipped.id("fd")], target: { type: "faction", playerId: P2 } }),
      "the card flipped up this turn attacks"
    );
    const veteran = board(true);
    veteran.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [veteran.id("veteran")], target: { type: "faction", playerId: P2 } });
    assert.deepEqual(battleParty(veteran.engine), [veteran.id("veteran")], "control: a character that has been in play since the turn began attacks");
  });

  rule("CR 411.3", "a flipped-up card is a completely new card: tokens on the face-down card are gone", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "fd", def: hero(), owner: P1, faceDown: true, counters: { token: 2 } },
        { key: "src", def: character({ name: "Src" }), owner: P1 }
      ]
    });
    engine.resolveEffect({ type: "flipFaceUp", target: REF(id("fd")) }, ctx(id("src")));
    settle(engine);
    assert.equal(tokenCount(engine, id("fd")), 0, "the old card left play, so its tokens disappeared (CR 409.2)");
  });

  rule("CR 411.3", "a flipped-up card is a completely new card: it is not still attached to the faction as a spent resource", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "fd", def: resourceCard({ name: "Gem" }), owner: P1, faceDown: true, attachedToKey: "__factionA" },
        { key: "src", def: character({ name: "Src" }), owner: P1 }
      ]
    });
    assert.equal(engine.getAvailableResourceCount(P1), 0, "before: the face-down resource is spent");
    engine.resolveEffect({ type: "flipFaceUp", target: REF(id("fd")) }, ctx(id("src")));
    assert.equal(engine.state.cards[id("fd")]!.attachedTo, undefined, "a new card enters play unattached");
    assert.equal(engine.getAvailableResourceCount(P1), 1, "so the new resource can be used");
  });

  rule("CR 411.3", "a flipped-up card is a completely new card: it enters play restored, not depleted", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "fd", def: hero(), owner: P1, faceDown: true, depleted: true },
        { key: "src", def: character({ name: "Src" }), owner: P1 }
      ]
    });
    engine.resolveEffect({ type: "flipFaceUp", target: REF(id("fd")) }, ctx(id("src")));
    assert.equal(engine.state.cards[id("fd")]!.depleted, false, "a card entering play is not depleted");
  });

  rule("CR 411.3", "a flipped-up card is considered to have left play: other cards' 'a card leaves play' triggers see it (as they do a face-down card destroyed)", () => {
    const board = () =>
      buildGame({
        cards: [
          { key: "fd", def: hero(), owner: P1, faceDown: true },
          { key: "watch", def: watcher("Watcher"), owner: P2 },
          { key: "src", def: character({ name: "Src" }), owner: P1 }
        ]
      });
    const destroyed = board();
    destroyed.engine.resolveEffect({ type: "destroy", target: REF(destroyed.id("fd")) }, ctx(destroyed.id("src")));
    settle(destroyed.engine);
    assert.equal(counterOf(destroyed.engine, destroyed.id("watch"), "left"), 1, "control: the watcher sees a face-down card leave play when it is destroyed");

    const flipped = board();
    flipped.engine.resolveEffect({ type: "flipFaceUp", target: REF(flipped.id("fd")) }, ctx(flipped.id("src")));
    settle(flipped.engine);
    assert.equal(counterOf(flipped.engine, flipped.id("watch"), "left"), 1, "the watcher sees the face-down card leave play when it is flipped up");
  });
});

/** The current battle's attacking party, read through a function so TypeScript keeps no narrowing. */
function battleParty(engine: SpoilsEngine) {
  return engine.state.battle?.attackingParty;
}

describe("CR 411.4 — flipping a face-up card face-down", () => {
  const damaged = () =>
    character({
      name: "Brave",
      life: 5,
      strength: 3,
      behavior: {
        abilities: [{ id: "leave", type: "triggered", event: "cardMoved", condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, { type: "cardMovedFromZone", zone: "play" }] }, effects: [{ type: "addCounter", target: "source", counter: "left", amount: 1 }] }]
      }
    });

  const board = () =>
    buildGame({
      cards: [
        { key: "brave", def: damaged(), owner: P1, damage: 2, depleted: true, counters: { token: 2 } },
        { key: "watch", def: watcher("Watcher"), owner: P2 },
        { key: "src", def: character({ name: "Src" }), owner: P1 }
      ]
    });

  rule("CR 411.4", "a face-up card flipped face-down is considered to have left play: its leave-play trigger happens, and other cards see it leave", () => {
    const { engine, id } = board();
    engine.resolveEffect({ type: "flipFaceDown", target: REF(id("brave")) }, ctx(id("src")));
    settle(engine);
    assert.equal(counterOf(engine, id("brave"), "left"), 1, "its own leaves-play trigger happened");
    assert.equal(counterOf(engine, id("watch"), "left"), 1, "another card saw it leave play");
  });

  rule("CR 411.4", "it becomes a face-down resource: Volition, a resource, no longer a character", () => {
    const { engine, id } = board();
    assert.deepEqual(engine.getThresholds(P1), {}, "before: nothing");
    engine.resolveEffect({ type: "flipFaceDown", target: REF(id("brave")) }, ctx(id("src")));
    assert.equal(engine.state.cards[id("brave")]!.faceDown, true, "face-down");
    assert.equal(engine.isResource(id("brave")), true, "a resource");
    assert.deepEqual(engine.getThresholds(P1), { volition: 1 }, "providing one Volition");
    assert.equal(engine.getCardTypes(id("brave")).includes("character"), false, "no longer a character");
  });

  rule("CR 411.4", "that resource is considered to have entered play as a completely new card: other cards see it enter, and it is a clean card", () => {
    const { engine, id } = board();
    engine.resolveEffect({ type: "flipFaceDown", target: REF(id("brave")) }, ctx(id("src")));
    settle(engine);
    assert.equal(counterOf(engine, id("watch"), "entered"), 1, "another card saw a card enter play");
    const card = engine.state.cards[id("brave")]!;
    assert.equal(card.damage, 0, "no damage carried over");
    assert.equal(card.depleted, false, "not depleted");
    assert.equal(counterOf(engine, id("brave"), "token"), 0, "no tokens carried over");
    assert.equal(card.attachedTo, undefined, "not attached to anything");
    assert.equal(engine.getAvailableResourceCount(P1), 1, "an available resource");
  });

  rule("CR 411.4", "a flipped-down card can be paid with like any resource (it is a new, unspent one)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "brave", def: character({ name: "Brave" }), owner: P1, depleted: true },
        { key: "t", def: tactic({ name: "Cheap", cost: 1 }), owner: P1, zone: "hand" },
        { key: "src", def: character({ name: "Src" }), owner: P1 }
      ]
    });
    refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("t") }), "no resource to pay with yet", /cannot be paid/);
    engine.resolveEffect({ type: "flipFaceDown", target: REF(id("brave")) }, ctx(id("src")));
    engine.perform({ type: "playCard", playerId: P1, cardId: id("t") });
    settle(engine);
    assert.equal(zoneOf(engine, id("t")), "discard", "the new resource paid for the tactic");
  });
});
