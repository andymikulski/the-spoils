// Batch r08-turn-deploy, part 2 (docs/TESTING.md): CR 602 Start of Turn, CR 603 During a Turn.
// Written from the wording of the Comprehensive Rules, not from the engine.

import { describe } from "node:test";
import assert from "node:assert/strict";
import { buildGame, character, item, location, P1, P2, tactic } from "../support/fixtures.js";
import { refused, rule } from "./_rule.js";
import { settleTurnStart } from "../support/develop.js";
import {
  attackFaction,
  buffer,
  deploy,
  endTurnToStartOfTurn,
  influence,
  orderAbilityNext,
  orderNext,
  passTurn,
  passWindows,
  startWatcher,
  tapper,
  triggerLog,
  useAbility,
  zoneOf
} from "./r08-turn-deploy.shared.js";

// ===========================================================================
// CR 602 — start of turn
// ===========================================================================

describe("CR 602.1 — the start of turn is a single point of time", () => {
  rule("CR 602.1", "damage clearing, the end of this-turn effects and attack eligibility have all happened before the first start-of-turn trigger resolves", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "hurt", def: character({ name: "Hurt", life: 3 }), owner: P1, damage: 2 },
        { key: "buffed", def: buffer("Buffed", "untilEndOfTurn"), owner: P1 },
        { key: "theirs", def: character({ name: "Theirs", life: 3 }), owner: P2, damage: 1, attackEligible: false },
        { key: "watcher", def: startWatcher("Watcher", 1), owner: P2 },
        { key: "watcher2", def: startWatcher("Watcher2", 1), owner: P2 }
      ]
    });
    useAbility(engine, id("buffed"), "buff");
    assert.equal(engine.getStat(id("buffed"), "strength"), 6, "control: the buff is active during the turn");
    const before = influence(engine, P2);
    endTurnToStartOfTurn(engine);
    assert.equal(engine.state.pendingChoice?.kind, "orderTriggers", "the start-of-turn triggers are waiting");
    assert.equal(influence(engine, P2), before, "no start-of-turn trigger has resolved yet");
    assert.equal(engine.state.cards[id("hurt")].damage, 0, "P1's damage is already cleared");
    assert.equal(engine.state.cards[id("theirs")].damage, 0, "P2's damage is already cleared");
    assert.equal(engine.getStat(id("buffed"), "strength"), 1, "the this-turn buff is already over");
    assert.equal(engine.state.cards[id("theirs")].attackEligibleTurn, engine.state.turn, "P2's character is already eligible to attack");
  });

  rule("CR 602.1", "the start of turn is not a trigger: the trigger batch holds the cards' own start-of-turn triggers (and the faction's Restore and Develop Rules) and nothing for the clean-up", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "hurt", def: character({ name: "Hurt" }), owner: P2, damage: 2 },
        { key: "w1", def: startWatcher("W1", 1), owner: P2 },
        { key: "w2", def: startWatcher("W2", 2), owner: P2 }
      ]
    });
    endTurnToStartOfTurn(engine);
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "orderTriggers");
    if (pending?.kind !== "orderTriggers") return;
    // User ruling 2026-10-27: the faction's Restore Rule and Develop Rule are start-of-turn triggers of the faction card,
    // so they are in the batch beside the two watchers - but there is still nothing for the clean-up itself.
    const factionId = engine.state.players[P2].factionId!;
    const sources = pending.triggers.map((trigger) => `${trigger.sourceId}:${trigger.abilityId}`).sort();
    assert.deepEqual(
      sources,
      [`${id("w1")}:t`, `${id("w2")}:t`, `${factionId}:restoreRule`, `${factionId}:developRule`].sort(),
      "the two watchers and the faction's Restore and Develop Rules; no trigger for the clean-up"
    );
    assert.equal(engine.state.cards[id("hurt")].damage, 0, "yet the clean-up happened");
  });

  rule("CR 602.1", "the start of turn is not a phase or step: no response window is opened for it", () => {
    const { engine } = buildGame({ cards: [{ key: "hurt", def: character({ name: "Hurt" }), owner: P2, damage: 2 }] });
    endTurnToStartOfTurn(engine);
    assert.equal(engine.state.responseWindow, undefined, "nobody can respond to the start of the turn");
    assert.equal(engine.state.activePlayerId, P2);
  });
});

describe("CR 602.1a — damage on characters is cleared", () => {
  rule("CR 602.1a", "all damage on characters is reset to 0 at the start of a turn, both players' characters", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "p1a", def: character({ name: "P1A", life: 5 }), owner: P1, damage: 4 },
        { key: "p1b", def: character({ name: "P1B", life: 5 }), owner: P1, damage: 1 },
        { key: "p2a", def: character({ name: "P2A", life: 5 }), owner: P2, damage: 3 },
        { key: "p2b", def: character({ name: "P2B", life: 5 }), owner: P2, damage: 0 }
      ]
    });
    passTurn(engine);
    for (const key of ["p1a", "p1b", "p2a", "p2b"]) assert.equal(engine.state.cards[id(key)].damage, 0, `${key} has no damage`);
  });

  rule("CR 602.1a", "damage is not cleared earlier: it stays through the turn and through the announcement of its end", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "hurt", def: character({ name: "Hurt", life: 5 }), owner: P1, damage: 3 },
        { key: "tapper", def: tapper("Tapper"), owner: P1 }
      ]
    });
    useAbility(engine, id("tapper"), "go");
    assert.equal(engine.state.cards[id("hurt")].damage, 3, "still damaged after turn actions");
    engine.perform({ type: "endTurn", playerId: P1 });
    assert.equal(engine.state.cards[id("hurt")].damage, 3, "still damaged while the end of the turn is only announced");
    passWindows(engine);
    assert.equal(engine.state.cards[id("hurt")].damage, 0, "cleared when the next turn starts");
  });

  rule("CR 602.1a", "damage a character took in battle is cleared when the next turn starts", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "attacker", def: character({ name: "Attacker", strength: 2, life: 5 }), owner: P1 },
        { key: "blocker", def: character({ name: "Blocker", strength: 0, life: 5 }), owner: P2, attackEligible: false }
      ]
    });
    attackFaction(engine, [id("attacker")], [id("blocker")]);
    assert.equal(engine.state.cards[id("blocker")].damage, 2, "control: the blocker took 2 damage in the battle");
    passTurn(engine);
    assert.equal(engine.state.cards[id("blocker")].damage, 0, "cleared at the start of the next turn");
  });

  rule("CR 602.1a", "only damage on characters is cleared: a location keeps the damage it has received", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "place", def: location({ name: "Place", structure: 5 }), owner: P2, damage: 2 },
        { key: "hurt", def: character({ name: "Hurt", life: 5 }), owner: P2, damage: 2 }
      ]
    });
    passTurn(engine);
    assert.equal(engine.state.cards[id("hurt")].damage, 0, "control: the character was cleared");
    assert.equal(engine.state.cards[id("place")].damage, 2, "the location's damage markers remain");
  });
});

describe("CR 602.1b — this-turn effects end", () => {
  rule("CR 602.1b", "an effect that lasts 'this turn' is active for the rest of the turn and over when the next turn starts", () => {
    const { engine, id } = buildGame({ cards: [{ key: "buffed", def: buffer("Buffed", "untilEndOfTurn"), owner: P1 }] });
    assert.equal(engine.getStat(id("buffed"), "strength"), 1);
    useAbility(engine, id("buffed"), "buff");
    assert.equal(engine.getStat(id("buffed"), "strength"), 6, "active this turn");
    engine.perform({ type: "endTurn", playerId: P1 });
    assert.equal(engine.getStat(id("buffed"), "strength"), 6, "still active while the end of the turn is only announced");
    passWindows(engine);
    assert.equal(engine.getStat(id("buffed"), "strength"), 1, "over at the start of the next turn");
  });

  rule("CR 602.1b", "an effect without a 'this turn' duration is not ended by the start of a turn", () => {
    const { engine, id } = buildGame({ cards: [{ key: "buffed", def: buffer("Buffed", "permanent"), owner: P1 }] });
    useAbility(engine, id("buffed"), "buff");
    assert.equal(engine.getStat(id("buffed"), "strength"), 6);
    passTurn(engine);
    assert.equal(engine.getStat(id("buffed"), "strength"), 6, "a lasting effect survives the turn change");
  });

  rule("CR 602.1b", "a this-turn effect created by the other player in response also ends at the start of the next turn", () => {
    const { engine, id } = buildGame({ cards: [{ key: "theirs", def: buffer("Theirs", "untilEndOfTurn"), owner: P2 }] });
    engine.perform({ type: "endTurn", playerId: P1 });
    engine.perform({ type: "activateAbility", playerId: P2, cardId: id("theirs"), abilityId: "buff" });
    engine.perform({ type: "passPriority", playerId: P1 });
    engine.perform({ type: "advanceFlow" });
    assert.equal(engine.getStat(id("theirs"), "strength"), 6, "the response resolved while P1's turn is still ending");
    passWindows(engine);
    assert.equal(engine.getStat(id("theirs"), "strength"), 1, "ended when the next turn started");
  });

  rule("CR 602.1b", "the player whose turn is starting is not special: a this-turn effect made on your own turn is over when your next turn starts too", () => {
    const { engine, id } = buildGame({ cards: [{ key: "buffed", def: buffer("Buffed", "untilEndOfTurn"), owner: P1 }] });
    useAbility(engine, id("buffed"), "buff");
    passTurn(engine);
    passTurn(engine);
    assert.equal(engine.state.activePlayerId, P1);
    assert.equal(engine.getStat(id("buffed"), "strength"), 1, "it did not come back");
  });
});

describe("CR 602.1c — attack eligibility", () => {
  rule("CR 602.1c", "a character in play under the active player's control at the start of the turn can attack that turn", () => {
    const { engine, id } = buildGame({ cards: [{ key: "vet", def: character({ name: "Vet", strength: 2 }), owner: P1 }] });
    passTurn(engine);
    passTurn(engine);
    assert.equal(engine.state.activePlayerId, P1);
    const before = influence(engine, P2);
    attackFaction(engine, [id("vet")]);
    assert.equal(influence(engine, P2), before - 2, "the attack was allowed and dealt its 2 damage");
  });

  rule("CR 602.1c", "a character that enters play during the turn was not in play at the start of it, so it cannot attack that turn", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "vet", def: character({ name: "Vet" }), owner: P1 },
        { key: "rookie", def: character({ name: "Rookie" }), owner: P1, zone: "hand" }
      ]
    });
    deploy(engine, id("rookie"));
    assert.equal(zoneOf(engine, id("rookie")), "play", "the rookie is in play");
    refused(
      () => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("rookie")], target: { type: "faction", playerId: P2 } }),
      "attacking with a character that entered play this turn"
    );
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("vet")], target: { type: "faction", playerId: P2 } });
    assert.ok(engine.state.battle, "control: a character that started the turn in play can attack");
  });

  rule("CR 602.1c", "a character that entered play on the previous turn is eligible when its controller's next turn starts", () => {
    const { engine, id } = buildGame({ cards: [{ key: "rookie", def: character({ name: "Rookie", strength: 3 }), owner: P1, zone: "hand" }] });
    deploy(engine, id("rookie"));
    passTurn(engine);
    passTurn(engine);
    const before = influence(engine, P2);
    attackFaction(engine, [id("rookie")]);
    assert.equal(influence(engine, P2), before - 3);
  });

  rule("CR 602.1c", "the opponent's characters are not eligible on my turn: only cards under the active player's control are", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "mine", def: character({ name: "Mine" }), owner: P1 },
        { key: "theirs", def: character({ name: "Theirs" }), owner: P2 }
      ]
    });
    passTurn(engine);
    passTurn(engine);
    assert.equal(engine.state.activePlayerId, P1);
    assert.equal(engine.state.cards[id("mine")].attackEligibleTurn, engine.state.turn, "mine: eligible this turn");
    assert.equal(engine.state.cards[id("theirs")].attackEligibleTurn, undefined, "theirs: not eligible on my turn");
  });

  rule("CR 602.1c", "eligibility follows control, not ownership: a character I own but my opponent controls is not eligible, one I control but they own is", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "lent", def: character({ name: "Lent" }), owner: P1, controller: P2 },
        { key: "borrowed", def: character({ name: "Borrowed" }), owner: P2, controller: P1 }
      ]
    });
    passTurn(engine);
    passTurn(engine);
    assert.equal(engine.state.activePlayerId, P1);
    refused(
      () => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("lent")], target: { type: "faction", playerId: P2 } }),
      "attacking with a character the opponent controls"
    );
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("borrowed")], target: { type: "faction", playerId: P2 } });
    assert.ok(engine.state.battle, "control: the borrowed character, which I control, can attack");
  });
});

describe("CR 602.2 — start-of-turn triggers", () => {
  const board = () =>
    buildGame({
      cards: [
        { key: "a", def: startWatcher("Aaa", 1), owner: P2 },
        { key: "b", def: startWatcher("Bbb", 2), owner: P2 }
      ]
    });

  rule("CR 602.2", "every start-of-turn trigger of the new active player happens: all of them appear in the one batch and all resolve", () => {
    const { engine, id } = board();
    endTurnToStartOfTurn(engine);
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "orderTriggers");
    if (pending?.kind !== "orderTriggers") return;
    assert.ok(pending.triggers.some((trigger) => trigger.sourceId === id("a")), "Aaa's trigger is in the batch");
    assert.ok(pending.triggers.some((trigger) => trigger.sourceId === id("b")), "Bbb's trigger is in the batch");
    // User ruling 2026-10-27: Restore and Develop are start-of-turn triggers too, in the very same batch.
    assert.ok(pending.triggers.some((trigger) => trigger.abilityId === "restoreRule"), "the Restore Rule is in the batch");
    assert.ok(pending.triggers.some((trigger) => trigger.abilityId === "developRule"), "the Develop Rule is in the batch");
    const before = influence(engine, P2);
    orderNext(engine, id("a"));
    orderNext(engine, id("b"));
    orderAbilityNext(engine, "restoreRule"); // the last trigger of the batch (Develop) follows on its own
    passWindows(engine);
    settleTurnStart(engine);
    passWindows(engine);
    assert.equal(engine.state.pendingChoice, undefined, "the batch is finished");
    assert.equal(influence(engine, P2), before + 3, "both triggers resolved");
  });

  rule("CR 602.2", "the active player decides the order the triggers resolve in: choosing Bbb first resolves Bbb first", () => {
    const { engine, id } = board();
    endTurnToStartOfTurn(engine);
    orderNext(engine, id("b"));
    orderNext(engine, id("a")); // Restore and Develop (the rest of the batch) are answered in the order offered
    settleTurnStart(engine);
    passWindows(engine);
    const lines = triggerLog(engine).filter((line) => /Aaa|Bbb/.test(line));
    assert.deepEqual(lines.map((line) => line.slice(0, 3)), ["Bbb", "Aaa"]);
  });

  rule("CR 602.2", "the same batch resolves in the opposite order when the active player picks the other trigger first", () => {
    const { engine, id } = board();
    endTurnToStartOfTurn(engine);
    orderNext(engine, id("a"));
    orderNext(engine, id("b")); // Restore and Develop (the rest of the batch) are answered in the order offered
    settleTurnStart(engine);
    passWindows(engine);
    const lines = triggerLog(engine).filter((line) => /Aaa|Bbb/.test(line));
    assert.deepEqual(lines.map((line) => line.slice(0, 3)), ["Aaa", "Bbb"]);
  });

  rule("CR 602.2", "it is the active player who orders them: the player whose turn is starting is asked, and the other player cannot answer", () => {
    const { engine, id } = board();
    endTurnToStartOfTurn(engine);
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "orderTriggers");
    assert.equal(pending?.playerId, P2, "the new active player is asked");
    refused(
      () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "orderTriggers", next: { sourceId: id("a"), abilityId: "t" } } }),
      "the inactive player orders the active player's triggers"
    );
    orderNext(engine, id("a"));
    assert.ok(triggerLog(engine).some((line) => line.startsWith("Aaa")), "control: the active player's answer is taken");
  });

  rule("CR 602.2", "start-of-turn triggers belong to the turn that is starting: a trigger conditioned on its controller's turn does not fire on the opponent's turn", () => {
    const { engine } = buildGame({ cards: [{ key: "mine", def: startWatcher("Mine", 5), owner: P1 }] });
    const before = influence(engine, P1);
    passTurn(engine);
    assert.equal(influence(engine, P1), before, "P2's turn start does not trigger P1's 'at the start of your turn'");
    passTurn(engine);
    assert.equal(influence(engine, P1), before + 5, "P1's own turn start does");
  });
});

// ===========================================================================
// CR 603 — during a turn
// ===========================================================================

describe("CR 603.1 — the active player", () => {
  rule("CR 603.1", "the active player is the player taking the current turn, and it passes to the opponent when the turn ends", () => {
    const { engine } = buildGame({});
    assert.equal(engine.state.activePlayerId, P1);
    passTurn(engine);
    assert.equal(engine.state.activePlayerId, P2);
    assert.equal(engine.state.turn, 2);
    passTurn(engine);
    assert.equal(engine.state.activePlayerId, P1);
    assert.equal(engine.state.turn, 3);
  });

  rule("CR 603.1", "the seat taking the turn is whoever is active, not a fixed seat: with the second seat active it is that player who acts", () => {
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [{ key: "c", def: character({ name: "C" }), owner: P2, zone: "hand" }]
    });
    deploy(engine, id("c"));
    assert.equal(zoneOf(engine, id("c")), "play", "the active player (seat 2) deployed");
  });
});

describe("CR 603.2 — the actions of a turn", () => {
  const richBoard = () =>
    buildGame({
      cards: [
        { key: "tap", def: tapper("Tap"), owner: P1 },
        { key: "a", def: character({ name: "A", strength: 2 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 3 }), owner: P1 },
        { key: "c1", def: character({ name: "C1" }), owner: P1, zone: "hand" },
        { key: "c2", def: character({ name: "C2" }), owner: P1, zone: "hand" },
        { key: "c3", def: item({ name: "C3" }), owner: P1, zone: "hand" },
        { key: "t1", def: tactic({ name: "T1" }), owner: P1, zone: "hand" }
      ]
    });

  rule("CR 603.2", "the active player may take the actions in any order: deploy, ability, attack, deploy, ability, attack, end the turn", () => {
    const { engine, id } = richBoard();
    deploy(engine, id("c1"));
    useAbility(engine, id("tap"), "go");
    attackFaction(engine, [id("a")]);
    deploy(engine, id("c3"));
    useAbility(engine, id("tap"), "go");
    attackFaction(engine, [id("b")]);
    assert.equal(zoneOf(engine, id("c1")), "play");
    assert.equal(zoneOf(engine, id("c3")), "play");
    assert.equal(influence(engine, P2), 25 - 2 - 3, "both attacks hit");
    assert.equal(influence(engine, P1), 25 + 2, "both ability uses happened");
    engine.perform({ type: "endTurn", playerId: P1 });
    assert.equal(engine.state.responseWindow?.kind, "endTurn", "and the turn can then be ended");
  });

  rule("CR 603.2", "the opposite order works too: attack first, then abilities, then deploying, then end the turn", () => {
    const { engine, id } = richBoard();
    attackFaction(engine, [id("a")]);
    useAbility(engine, id("tap"), "go");
    deploy(engine, id("t1"));
    deploy(engine, id("c2"));
    assert.equal(zoneOf(engine, id("t1")), "discard", "the tactic was deployed and resolved");
    assert.equal(zoneOf(engine, id("c2")), "play");
    assert.equal(influence(engine, P2), 25 - 2);
    assert.equal(influence(engine, P1), 25 + 1);
  });

  rule("CR 603.2", "as many times as they want: the same ability can be used again and again", () => {
    const { engine, id } = richBoard();
    for (let i = 0; i < 4; i++) useAbility(engine, id("tap"), "go");
    assert.equal(influence(engine, P1), 25 + 4);
  });

  rule("CR 603.2", "as many times as they want: any number of cards can be deployed in a turn", () => {
    const { engine, id } = richBoard();
    deploy(engine, id("c1"));
    deploy(engine, id("c2"));
    deploy(engine, id("c3"));
    deploy(engine, id("t1"));
    assert.deepEqual([zoneOf(engine, id("c1")), zoneOf(engine, id("c2")), zoneOf(engine, id("c3")), zoneOf(engine, id("t1"))], ["play", "play", "play", "discard"]);
  });

  rule("CR 603.2", "as many times as they want: more than one attack in a turn, each with a different character", () => {
    const { engine, id } = richBoard();
    attackFaction(engine, [id("a")]);
    attackFaction(engine, [id("b")]);
    assert.equal(influence(engine, P2), 25 - 2 - 3);
  });

  rule("CR 603.2a", "deploying a card is a turn action of the active player: a character from hand ends up in play", () => {
    const { engine, id } = richBoard();
    assert.equal(zoneOf(engine, id("c1")), "hand");
    deploy(engine, id("c1"));
    assert.equal(zoneOf(engine, id("c1")), "play");
  });

  rule("CR 603.2a", "the inactive player cannot deploy a card on the active player's turn (control: the active player can)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "hand" },
        { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "hand" }
      ]
    });
    refused(() => engine.perform({ type: "playCard", playerId: P2, cardId: id("theirs") }), "the inactive player deploys a character on the opponent's turn");
    assert.equal(zoneOf(engine, id("theirs")), "hand");
    deploy(engine, id("mine"));
    assert.equal(zoneOf(engine, id("mine")), "play");
  });

  rule("CR 603.2b", "using an ability is a turn action of the active player", () => {
    const { engine, id } = richBoard();
    useAbility(engine, id("tap"), "go");
    assert.equal(influence(engine, P1), 26);
  });

  rule("CR 603.2b", "the inactive player cannot use an ability on the active player's turn, outside a response (control: the active player can)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "mine", def: tapper("Mine"), owner: P1 },
        { key: "theirs", def: tapper("Theirs"), owner: P2 }
      ]
    });
    refused(() => engine.perform({ type: "activateAbility", playerId: P2, cardId: id("theirs"), abilityId: "go" }), "the inactive player uses an ability with nothing to respond to");
    assert.equal(influence(engine, P2), 25);
    useAbility(engine, id("mine"), "go");
    assert.equal(influence(engine, P1), 26);
  });

  rule("CR 603.2c", "attacking is a turn action of the active player", () => {
    const { engine, id } = richBoard();
    attackFaction(engine, [id("a")]);
    assert.equal(influence(engine, P2), 23);
  });

  rule("CR 603.2c", "the inactive player cannot attack on the active player's turn (control: the active player can)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "mine", def: character({ name: "Mine" }), owner: P1 },
        { key: "theirs", def: character({ name: "Theirs" }), owner: P2 }
      ]
    });
    refused(
      () => engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("theirs")], target: { type: "faction", playerId: P1 } }),
      "the inactive player attacks"
    );
    assert.equal(engine.state.battle, undefined);
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("mine")], target: { type: "faction", playerId: P2 } });
    assert.ok(engine.state.battle, "control: the active player attacks");
  });

  rule("CR 603.2d", "ending the turn is a turn action of the active player and hands the turn to the opponent", () => {
    const { engine } = buildGame({});
    passTurn(engine);
    assert.equal(engine.state.activePlayerId, P2);
  });

  rule("CR 603.2d", "the inactive player cannot end the turn (control: the active player can)", () => {
    const { engine } = buildGame({});
    refused(() => engine.perform({ type: "endTurn", playerId: P2 }), "the inactive player ends the active player's turn");
    assert.equal(engine.state.activePlayerId, P1);
    engine.perform({ type: "endTurn", playerId: P1 });
    assert.equal(engine.state.responseWindow?.kind, "endTurn");
  });

  rule("CR 603.2d", "the turn can be ended only once: a second end-of-turn while the first is announced is refused", () => {
    const { engine } = buildGame({});
    engine.perform({ type: "endTurn", playerId: P1 });
    refused(() => engine.perform({ type: "endTurn", playerId: P1 }), "ending the turn twice", /response window/);
    passWindows(engine);
    assert.equal(engine.state.turn, 2, "the turn ended exactly once");
  });

  rule("CR 603.2d", "after the turn has ended the player who ended it cannot end a turn again: it is the opponent's turn now", () => {
    const { engine } = buildGame({});
    passTurn(engine);
    refused(() => engine.perform({ type: "endTurn", playerId: P1 }), "the previous active player ends the opponent's turn", /active player/);
    engine.perform({ type: "endTurn", playerId: P2 });
    assert.equal(engine.state.responseWindow?.kind, "endTurn", "control: the new active player may end their own turn");
  });
});
