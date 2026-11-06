// Batch r02-battle, part 1 (docs/TESTING.md): CR 302 Battle Terms and CR 412 Unblockability.
// Written from the wording of the Comprehensive Rules, not from the engine.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, SpoilsEngine } from "../../../engine.js";
import { autoResolveBattle, buildGame, character, item, location, P1, P2, resolvePendingResponses } from "../support/fixtures.js";
import { refused, rule, ruleMismatch } from "./_rule.js";

type Abilities = NonNullable<NonNullable<CardDefinition["behavior"]>["abilities"]>;

const FACTION_P2 = { type: "faction", playerId: P2 } as const;

/** P1 declares an attack on `target` (P2's faction by default) with the given characters. */
function attack(engine: SpoilsEngine, attackers: CardInstanceId[], target: { type: "faction"; playerId: string } | { type: "card"; cardId: CardInstanceId } = FACTION_P2): void {
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: attackers, target });
}

/** Both players pass every response window until blockers are asked for (or the battle ends). */
const toBlocking = (engine: SpoilsEngine): void => resolvePendingResponses(engine);

/** Resolves everything on the response stack, leaving the window open for the player who had priority before. */
function settle(engine: SpoilsEngine): void {
  for (let guard = 0; engine.state.responseStack.length > 0 && !engine.state.pendingChoice; guard++) {
    assert.ok(guard < 50, "the response stack settles");
    const window = engine.state.responseWindow!;
    if (window.phase === "acceptingResponses") engine.perform({ type: "passPriority", playerId: window.priorityPlayerId });
    else engine.perform({ type: "advanceFlow" });
  }
}

/** Uses an ability and lets it resolve, returning to the response window it was used in. */
function use(engine: SpoilsEngine, playerId: string, cardId: CardInstanceId, abilityId: string, selected?: Record<string, CardInstanceId[]>): void {
  engine.perform({ type: "activateAbility", playerId, cardId, abilityId, ...(selected ? { selected } : {}) });
  settle(engine);
}

const mark = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId]!.counters.mark ?? 0;

/** A permanent whose abilities are the given ones (an item stays in play and is usable in any response window it has priority in). */
const gadget = (name: string, abilities: Abilities): CardDefinition => item({ name, behavior: { abilities } });

/** Puts a "mark" counter on the source: a free, visible effect for abilities used to probe timing and targeting. */
const markSelf = (id: string): Abilities[number] => ({ id, type: "activated", effects: [{ type: "addCounter", target: "source", counter: "mark", amount: 1 }] });

/** Activated ability `id` that marks the one picked character matching `conditions`. */
const markPicked = (id: string, conditions: object[]): Abilities[number] =>
  ({
    id,
    type: "activated",
    targets: [{ id: "t", selector: { type: "character", zone: "play", conditions }, count: 1 }],
    effects: [{ type: "addCounter", target: { type: "selected", id: "t" }, counter: "mark", amount: 1 }]
  }) as Abilities[number];

const candidate = { type: "selected", id: "__candidate" } as const;

describe("CR 302 — target of the attack, being attacked, attacking and defending player", () => {
  rule("CR 302.1", "the target of an attack on a faction is that faction", () => {
    const { engine, id } = buildGame({ cards: [{ key: "a", def: character({ name: "A" }), owner: P1 }] });
    attack(engine, [id("a")]);
    assert.deepEqual(engine.state.battle?.target, FACTION_P2, "the battle's target is the attacked faction");
    assert.deepEqual(engine.getBattleView()?.target, FACTION_P2, "and the battle view reports it");
  });

  rule("CR 302.1", "the target of an attack on a location is that location", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "fort", def: location({ name: "Fort" }), owner: P2 }
      ]
    });
    attack(engine, [id("a")], { type: "card", cardId: id("fort") });
    assert.deepEqual(engine.state.battle?.target, { type: "card", cardId: id("fort") }, "the location is the target");
  });

  rule("CR 302.1", "the target of the attack is the thing that takes the unblocked damage (faction loses influence, location takes damage)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 2 }), owner: P1 },
        { key: "fort", def: location({ name: "Fort", structure: 9 }), owner: P2 }
      ]
    });
    const before = engine.state.players[P2].influence;
    attack(engine, [id("a")], { type: "card", cardId: id("fort") });
    toBlocking(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);
    assert.equal(engine.state.cards[id("fort")]!.damage, 2, "the targeted location took the damage");
    assert.equal(engine.state.players[P2].influence, before, "the faction, not being the target, lost nothing");
  });

  rule("CR 302.1", "only a faction or a location can be the target: a character, an own faction and an own location are refused", () => {
    const build = () =>
      buildGame({
        cards: [
          { key: "a", def: character({ name: "A" }), owner: P1 },
          { key: "foe", def: character({ name: "Foe" }), owner: P2 },
          { key: "mine", def: location({ name: "Mine" }), owner: P1 },
          { key: "theirs", def: location({ name: "Theirs" }), owner: P2 }
        ]
      });
    {
      const { engine, id } = build();
      refused(() => attack(engine, [id("a")], { type: "card", cardId: id("foe") }), "attacking a character", /opposing faction or location/);
    }
    {
      const { engine, id } = build();
      refused(() => attack(engine, [id("a")], { type: "faction", playerId: P1 }), "attacking your own faction", /own faction/);
    }
    {
      const { engine, id } = build();
      refused(() => attack(engine, [id("a")], { type: "card", cardId: id("mine") }), "attacking your own location", /own location/);
    }
    {
      const { engine, id } = build();
      attack(engine, [id("a")], { type: "card", cardId: id("theirs") });
      assert.ok(engine.state.battle, "control: an opposing location is a legal target");
    }
  });

  rule("CR 302.2", "a player is being attacked when their faction is the target of the attack", () => {
    const { engine, id } = buildGame({ cards: [{ key: "a", def: character({ name: "A" }), owner: P1 }] });
    attack(engine, [id("a")]);
    assert.equal(engine.state.battle?.defenderPlayerId, P2, "P2 is the player being attacked");
  });

  rule("CR 302.2", "a player is being attacked when a location they control is the target of the attack", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "fort", def: location({ name: "Fort" }), owner: P2 }
      ]
    });
    attack(engine, [id("a")], { type: "card", cardId: id("fort") });
    assert.equal(engine.state.battle?.defenderPlayerId, P2, "the controller of the targeted location is being attacked");
  });

  rule("CR 302.2", "being attacked follows control, not ownership: a location P2 controls but P1 owns can be attacked by P1 and P2 is the one attacked", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "stolen", def: location({ name: "Stolen" }), owner: P1, controller: P2 }
      ]
    });
    attack(engine, [id("a")], { type: "card", cardId: id("stolen") });
    assert.equal(engine.state.battle?.defenderPlayerId, P2, "the controller is being attacked");
  });

  rule("CR 302.2", "a location P1 controls but P2 owns is not an opposing location for P1 to attack", () => {
    const build = (controller: string) =>
      buildGame({
        cards: [
          { key: "a", def: character({ name: "A" }), owner: P1 },
          { key: "loc", def: location({ name: "Loc" }), owner: P2, controller }
        ]
      });
    const refusal = build(P1);
    refused(() => attack(refusal.engine, [refusal.id("a")], { type: "card", cardId: refusal.id("loc") }), "attacking a location you control", /own location/);
    const control = build(P2);
    attack(control.engine, [control.id("a")], { type: "card", cardId: control.id("loc") });
    assert.ok(control.engine.state.battle, "control: when P2 controls it the attack is legal");
  });

  rule("CR 302.2", "only the player being attacked may declare the blockers", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "mine", def: character({ name: "Mine" }), owner: P1, depleted: false },
        { key: "blk", def: character({ name: "Blk" }), owner: P2 }
      ]
    });
    attack(engine, [id("a")]);
    toBlocking(engine);
    refused(() => engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("mine")] }), "the attacking player declaring blockers", /Only the defending player/);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
    assert.deepEqual(engine.state.battle?.blockingParty, [id("blk")], "control: the player being attacked can");
  });

  rule("CR 302.3", "the attacking player is the player that started the battle", () => {
    const { engine, id } = buildGame({ cards: [{ key: "a", def: character({ name: "A" }), owner: P1 }] });
    assert.equal((engine.state as { battle?: unknown }).battle, undefined, "no battle yet");
    attack(engine, [id("a")]);
    assert.equal(engine.state.battle?.attackerPlayerId, P1, "P1 started it and is the attacking player");
    assert.equal(engine.getBattleView()?.attackerPlayerId, P1);
  });

  rule(["CR 302.3", "CR 302.4"], "an ability usable only while you are attacking (or defending) is usable by exactly the attacking (defending) player", () => {
    const asAttacker = { ...markSelf("asAttacker"), condition: { type: "battleRole", role: "attacker" } } as Abilities[number];
    const asDefender = { ...markSelf("asDefender"), condition: { type: "battleRole", role: "defender" } } as Abilities[number];
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "g1", def: gadget("Gadget1", [asAttacker, asDefender]), owner: P1 },
        { key: "g2", def: gadget("Gadget2", [asAttacker, asDefender]), owner: P2 }
      ]
    });
    attack(engine, [id("a")]);
    // P1 (the attacking player) holds priority first.
    refused(() => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("g1"), abilityId: "asDefender" }), "the attacking player using a defending-player ability", /condition is not satisfied/);
    use(engine, P1, id("g1"), "asAttacker");
    assert.equal(mark(engine, id("g1")), 1, "the attacking player could use the attacking-player ability");
    engine.perform({ type: "passPriority", playerId: P1 });
    // Now P2 (the defending player) holds priority.
    refused(() => engine.perform({ type: "activateAbility", playerId: P2, cardId: id("g2"), abilityId: "asAttacker" }), "the defending player using an attacking-player ability", /condition is not satisfied/);
    use(engine, P2, id("g2"), "asDefender");
    assert.equal(mark(engine, id("g2")), 1, "the defending player could use the defending-player ability");
  });

  rule("CR 302.4", "the defending player is the player being attacked during the current battle", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "fort", def: location({ name: "Fort" }), owner: P2 }
      ]
    });
    attack(engine, [id("a")], { type: "card", cardId: id("fort") });
    assert.equal(engine.state.battle?.defenderPlayerId, P2, "the location's controller is the defending player");
    assert.equal(engine.getBattleView()?.defenderPlayerId, P2);
  });
});

describe("CR 302 — battle parties", () => {
  rule("CR 302.5", "a battle party is a group of characters working together: several attackers form one party", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a1", def: character({ name: "A1" }), owner: P1 },
        { key: "a2", def: character({ name: "A2" }), owner: P1 },
        { key: "a3", def: character({ name: "A3" }), owner: P1 },
        { key: "idle", def: character({ name: "Idle" }), owner: P1 }
      ]
    });
    attack(engine, [id("a1"), id("a2"), id("a3")]);
    assert.deepEqual(engine.state.battle?.attackingParty, [id("a1"), id("a2"), id("a3")], "exactly the declared characters are in the party");
    assert.ok(!engine.state.battle?.attackingParty.includes(id("idle")), "a character that did not attack is not in it");
  });

  rule("CR 302.5", "a party can be a single character", () => {
    const { engine, id } = buildGame({ cards: [{ key: "a", def: character({ name: "A" }), owner: P1 }] });
    attack(engine, [id("a")]);
    assert.deepEqual(engine.state.battle?.attackingParty, [id("a")]);
  });

  rule("CR 302.5", "the declared blockers form a party and a character that did not block is not in it", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "b1", def: character({ name: "B1" }), owner: P2 },
        { key: "b2", def: character({ name: "B2" }), owner: P2 },
        { key: "idle", def: character({ name: "Idle" }), owner: P2 }
      ]
    });
    attack(engine, [id("a")]);
    toBlocking(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b1"), id("b2")] });
    assert.deepEqual(engine.state.battle?.blockingParty, [id("b1"), id("b2")], "the blocking party is the two blockers");
    assert.ok(!engine.state.battle?.blockingParty.includes(id("idle")), "the idle character is in no party");
  });

  rule("CR 302.6", "the attacking party is under the attacking player's control and cannot contain the opponent's characters", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "foe", def: character({ name: "Foe" }), owner: P2 }
      ]
    });
    refused(() => attack(engine, [id("a"), id("foe")]), "attacking with a character the opponent controls", /do not control/);
    attack(engine, [id("a")]);
    assert.ok(
      engine.state.battle!.attackingParty.every((cardId) => engine.state.cards[cardId]!.controllerId === P1),
      "control: every member of the attacking party is controlled by the attacking player"
    );
  });

  rule("CR 302.7", "the blocking party is under the defending player's control and cannot contain the attacking player's characters", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "mine", def: character({ name: "Mine" }), owner: P1 },
        { key: "blk", def: character({ name: "Blk" }), owner: P2 }
      ]
    });
    attack(engine, [id("a")]);
    toBlocking(engine);
    refused(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("mine")] }), "the defender blocking with the attacker's character", /do not control/);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
    assert.ok(
      engine.state.battle!.blockingParty.every((cardId) => engine.state.cards[cardId]!.controllerId === P2),
      "control: every member of the blocking party is controlled by the defending player"
    );
  });

  rule("CR 302.7", "with no blockers declared there is no blocking party", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "blk", def: character({ name: "Blk" }), owner: P2 }
      ]
    });
    attack(engine, [id("a")]);
    toBlocking(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    assert.deepEqual(engine.state.battle?.blockingParty, [], "the blocking party is empty");
  });
});

describe("CR 302 — during a battle, in a battle, attacking and blocking characters", () => {
  const duringBattle = character({
    name: "Battle Bard",
    behavior: { abilities: [{ id: "c", type: "continuous", condition: { type: "battleActive" }, modifiers: [{ target: "source", stat: "strength", operation: "add", value: 2 }] }] }
  });

  rule("CR 302.8", "a battle lasts from the moment the attack is announced until it is fully resolved", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 1 }), owner: P1 },
        { key: "bard", def: duringBattle, owner: P1 }
      ]
    });
    assert.equal(engine.getStat(id("bard"), "strength"), 1, "before any attack there is no battle");
    attack(engine, [id("a")]);
    assert.equal(engine.getStat(id("bard"), "strength"), 3, "the battle exists as soon as the attack is announced");
    toBlocking(engine);
    assert.equal(engine.getStat(id("bard"), "strength"), 3, "and while blockers are chosen");
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    assert.equal(engine.getStat(id("bard"), "strength"), 3, "and while the battle is being resolved");
    autoResolveBattle(engine);
    assert.equal(engine.state.battle, undefined, "the battle is gone once resolved");
    assert.equal(engine.getStat(id("bard"), "strength"), 1, "and with it the during-a-battle effect");
  });

  rule("CR 302.8", "an attack that is refused never starts a battle", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "bard", def: duringBattle, owner: P1 },
        { key: "tired", def: character({ name: "Tired" }), owner: P1, depleted: true }
      ]
    });
    refused(() => attack(engine, [id("tired")]), "a depleted character cannot attack", /Depleted/);
    assert.equal(engine.getStat(id("bard"), "strength"), 1, "no battle began");
  });

  const inBattleBard = character({
    name: "In-Battle Bard",
    behavior: {
      abilities: [{ id: "c", type: "continuous", condition: { type: "inBattle", target: "source" }, modifiers: [{ target: "source", stat: "strength", operation: "add", value: 2 }] }]
    }
  });

  rule("CR 302.9", "a character is in a battle while it is a member of an attacking party", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "atk", def: inBattleBard, owner: P1 },
        { key: "bystander", def: inBattleBard, owner: P1 }
      ]
    });
    assert.equal(engine.getStat(id("atk"), "strength"), 1, "not in a battle before the attack");
    attack(engine, [id("atk")]);
    assert.equal(engine.getStat(id("atk"), "strength"), 3, "an attacker is in the battle");
    assert.equal(engine.getStat(id("bystander"), "strength"), 1, "a character in neither party is not");
  });

  rule("CR 302.9", "a character is in a battle while it is a member of a blocking party", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "blk", def: inBattleBard, owner: P2 },
        { key: "bystander", def: inBattleBard, owner: P2 }
      ]
    });
    attack(engine, [id("a")]);
    toBlocking(engine);
    assert.equal(engine.getStat(id("blk"), "strength"), 1, "a would-be blocker is not in the battle before it blocks");
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
    assert.equal(engine.getStat(id("blk"), "strength"), 3, "a blocker is in the battle");
    assert.equal(engine.getStat(id("bystander"), "strength"), 1, "a character that did not block is not");
  });

  rule("CR 302.9", "a character that is no longer a member of its party (removed from the battle) is no longer in the battle", () => {
    const remover = gadget("Remover", [
      { id: "go", type: "activated", targets: [{ id: "t", selector: { type: "character", zone: "play" }, count: 1 }], effects: [{ type: "removeFromBattle", target: { type: "selected", id: "t" } }] }
    ]);
    const { engine, id } = buildGame({
      cards: [
        { key: "atk", def: inBattleBard, owner: P1 },
        { key: "rem", def: remover, owner: P1 }
      ]
    });
    attack(engine, [id("atk")]);
    assert.equal(engine.getStat(id("atk"), "strength"), 3, "in the battle");
    use(engine, P1, id("rem"), "go", { t: [id("atk")] });
    assert.equal(engine.getStat(id("atk"), "strength"), 1, "no longer in the battle once removed from its party");
  });

  rule("CR 302.10", "the opposing party is the battle party under your opponent's control", () => {
    const reader = character({
      name: "Reader",
      strength: 1,
      behavior: { abilities: [{ id: "c", type: "continuous", modifiers: [{ target: "source", stat: "strength", operation: "add", value: { type: "battlePartySize", side: "opposingParty" } }] }] }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "a1", def: reader, owner: P1 },
        { key: "a2", def: reader, owner: P1 },
        { key: "b1", def: reader, owner: P2 },
        { key: "b2", def: reader, owner: P2 },
        { key: "b3", def: reader, owner: P2 },
        { key: "idle", def: reader, owner: P2 }
      ]
    });
    attack(engine, [id("a1"), id("a2")]);
    toBlocking(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b1"), id("b2"), id("b3")] });
    assert.equal(engine.getStat(id("a1"), "strength"), 1 + 3, "an attacker's opposing party is the 3-member blocking party");
    assert.equal(engine.getStat(id("a2"), "strength"), 1 + 3, "for every attacker");
    assert.equal(engine.getStat(id("b1"), "strength"), 1 + 2, "a blocker's opposing party is the 2-member attacking party");
    assert.equal(engine.getStat(id("b3"), "strength"), 1 + 2, "for every blocker");
    assert.equal(engine.getStat(id("idle"), "strength"), 1, "a character in neither party has no opposing party");
  });

  rule("CR 302.10", "an opposing party that has not been formed is empty (attacker before blockers are declared)", () => {
    const reader = character({
      name: "Reader",
      strength: 1,
      behavior: { abilities: [{ id: "c", type: "continuous", modifiers: [{ target: "source", stat: "strength", operation: "add", value: { type: "battlePartySize", side: "opposingParty" } }] }] }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: reader, owner: P1 },
        { key: "b", def: reader, owner: P2 }
      ]
    });
    attack(engine, [id("a")]);
    assert.equal(engine.getStat(id("a"), "strength"), 1, "no blocking party yet: nothing opposes the attacker");
    toBlocking(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    assert.equal(engine.getStat(id("a"), "strength"), 1, "no blockers declared: still no opposing party");
    assert.equal(engine.getStat(id("b"), "strength"), 1, "a would-be blocker that did not block is in no party, so nothing opposes it either");
  });

  const picker = (name: string, conditions: object[]) => gadget(name, [markPicked("pick", conditions)]);
  const attackerCondition = { type: "inBattle", target: candidate, role: "attacker" };
  const blockerCondition = { type: "inBattle", target: candidate, role: "blocker" };

  rule("CR 302.12", "a character is attacking while it is a member of an attacking party", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "atk", def: character({ name: "Atk" }), owner: P1 },
        { key: "idle", def: character({ name: "Idle" }), owner: P1 },
        { key: "foe", def: character({ name: "Foe" }), owner: P2 },
        { key: "p", def: picker("Picker", [attackerCondition]), owner: P1 }
      ]
    });
    attack(engine, [id("atk")]);
    refused(() => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("p"), abilityId: "pick", selected: { t: [id("idle")] } }), "picking a character that is not attacking", /Illegal target/);
    refused(() => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("p"), abilityId: "pick", selected: { t: [id("foe")] } }), "picking a character of the other player that is not attacking", /Illegal target/);
    use(engine, P1, id("p"), "pick", { t: [id("atk")] });
    assert.equal(mark(engine, id("atk")), 1, "control: the attacking character is a legal pick");
  });

  rule("CR 302.12", "an attacking character is still attacking once depleted by the attack, and stops attacking when removed from the party", () => {
    const remover = gadget("Remover", [
      { id: "go", type: "activated", targets: [{ id: "t", selector: { type: "character", zone: "play" }, count: 1 }], effects: [{ type: "removeFromBattle", target: { type: "selected", id: "t" } }] }
    ]);
    const { engine, id } = buildGame({
      cards: [
        { key: "atk", def: character({ name: "Atk" }), owner: P1 },
        { key: "other", def: character({ name: "Other" }), owner: P1 },
        { key: "p", def: picker("Picker", [attackerCondition]), owner: P1 },
        { key: "rem", def: remover, owner: P1 }
      ]
    });
    attack(engine, [id("atk"), id("other")]);
    assert.equal(engine.state.cards[id("atk")]!.depleted, true, "attacking depleted it");
    use(engine, P1, id("p"), "pick", { t: [id("atk")] });
    assert.equal(mark(engine, id("atk")), 1, "a depleted attacker is still an attacking character");
    use(engine, P1, id("rem"), "go", { t: [id("atk")] });
    refused(() => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("p"), abilityId: "pick", selected: { t: [id("atk")] } }), "picking an attacker removed from the battle", /Illegal target/);
    use(engine, P1, id("p"), "pick", { t: [id("other")] });
    assert.equal(mark(engine, id("other")), 1, "control: the remaining attacker is still attacking");
  });

  rule("CR 302.13", "a character is blocking while it is a member of a blocking party", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "blk", def: character({ name: "Blk" }), owner: P2 },
        { key: "idle", def: character({ name: "Idle" }), owner: P2 },
        { key: "p", def: picker("Picker", [blockerCondition]), owner: P1 }
      ]
    });
    attack(engine, [id("a")]);
    toBlocking(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
    refused(() => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("p"), abilityId: "pick", selected: { t: [id("idle")] } }), "picking a character that is not blocking", /Illegal target/);
    refused(() => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("p"), abilityId: "pick", selected: { t: [id("a")] } }), "picking an attacking character as a blocker", /Illegal target/);
    use(engine, P1, id("p"), "pick", { t: [id("blk")] });
    assert.equal(mark(engine, id("blk")), 1, "control: the blocking character is a legal pick");
  });

  rule("CR 302.13", "a character that could block but was not declared is not blocking, and an undeclared battle has no blocking character", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "blk", def: character({ name: "Blk" }), owner: P2 },
        { key: "p", def: picker("Picker", [blockerCondition]), owner: P1 }
      ]
    });
    attack(engine, [id("a")]);
    refused(() => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("p"), abilityId: "pick", selected: { t: [id("blk")] } }), "picking a blocker before any block is declared", /Illegal target/);
  });

  rule("CR 302.14", "in a party with: any member of the party meets the criterion, even the character doing the check", () => {
    const shares = { type: "sharesBattlePartyWithSource", target: candidate };
    const linker = character({ name: "Linker", behavior: { abilities: [markPicked("link", [shares])] } });
    const { engine, id } = buildGame({
      cards: [
        { key: "linker", def: linker, owner: P1 },
        { key: "mate", def: character({ name: "Mate" }), owner: P1 },
        { key: "idle", def: character({ name: "Idle" }), owner: P1 },
        { key: "foe", def: character({ name: "Foe" }), owner: P2 }
      ]
    });
    attack(engine, [id("linker"), id("mate")]);
    refused(() => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("linker"), abilityId: "link", selected: { t: [id("idle")] } }), "picking a character in no party", /Illegal target/);
    use(engine, P1, id("linker"), "link", { t: [id("linker")] });
    assert.equal(mark(engine, id("linker")), 1, "a card may pick itself as a character in a party with itself");
    use(engine, P1, id("linker"), "link", { t: [id("mate")] });
    assert.equal(mark(engine, id("mate")), 1, "and a party-mate");
  });

  rule("CR 302.14", "in a party with: a member of the opposing party is not in a party with the card", () => {
    const shares = { type: "sharesBattlePartyWithSource", target: candidate };
    const linker = character({ name: "Linker", behavior: { abilities: [markPicked("link", [shares])] } });
    const { engine, id } = buildGame({
      cards: [
        { key: "linker", def: linker, owner: P1 },
        { key: "blk", def: character({ name: "Blk" }), owner: P2 },
        { key: "blk2", def: character({ name: "Blk2" }), owner: P2 }
      ]
    });
    attack(engine, [id("linker")]);
    toBlocking(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk"), id("blk2")] });
    refused(() => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("linker"), abilityId: "link", selected: { t: [id("blk")] } }), "picking a member of the opposing party", /Illegal target/);
    use(engine, P1, id("linker"), "link", { t: [id("linker")] });
    assert.equal(mark(engine, id("linker")), 1, "control: itself is still a legal pick");
  });

  rule("CR 302.14", "in a party with: a blocker is in a party with the other blockers and with itself", () => {
    const shares = { type: "sharesBattlePartyWithSource", target: candidate };
    const linker = character({ name: "Linker", behavior: { abilities: [markPicked("link", [shares])] } });
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "linker", def: linker, owner: P2 },
        { key: "mate", def: character({ name: "Mate" }), owner: P2 }
      ]
    });
    attack(engine, [id("a")]);
    toBlocking(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("linker"), id("mate")] });
    engine.perform({ type: "passPriority", playerId: P1 });
    refused(() => engine.perform({ type: "activateAbility", playerId: P2, cardId: id("linker"), abilityId: "link", selected: { t: [id("a")] } }), "picking the attacker from the blocking party", /Illegal target/);
    use(engine, P2, id("linker"), "link", { t: [id("linker")] });
    use(engine, P2, id("linker"), "link", { t: [id("mate")] });
    assert.equal(mark(engine, id("linker")), 1, "itself");
    assert.equal(mark(engine, id("mate")), 1, "and the other blocker");
  });
});

describe("CR 302.11 — covert party", () => {
  const covert = (name: string) => character({ name, behavior: { keywords: ["covert"] } });
  /** Covert until it loses covert (a "loss" counter, put there by its own ability). */
  const covertLoser = (name: string) =>
    character({
      name,
      behavior: {
        keywords: ["covert"],
        abilities: [
          { id: "lose", type: "activated", effects: [{ type: "addCounter", target: "source", counter: "loss", amount: 1 }] },
          {
            id: "suppress",
            type: "continuous",
            condition: { type: "counterCompare", target: "source", counter: "loss", operator: ">=", value: 1 },
            modifiers: [],
            suppressKeywords: [{ target: "source", keyword: "covert" }]
          }
        ]
      }
    });
  const block = (engine: SpoilsEngine, blockers: CardInstanceId[]) => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: blockers });

  rule("CR 302.11", "an attacking party containing only covert characters is a covert party: only covert characters can block it", () => {
    const build = () =>
      buildGame({
        cards: [
          { key: "c1", def: covert("C1"), owner: P1 },
          { key: "c2", def: covert("C2"), owner: P1 },
          { key: "plain", def: character({ name: "Plain" }), owner: P2 },
          { key: "cb", def: covert("CB"), owner: P2 }
        ]
      });
    const refusal = build();
    attack(refusal.engine, [refusal.id("c1"), refusal.id("c2")]);
    toBlocking(refusal.engine);
    refused(() => block(refusal.engine, [refusal.id("plain")]), "a non-covert character blocking a covert party", /COVERT/);
    const control = build();
    attack(control.engine, [control.id("c1"), control.id("c2")]);
    toBlocking(control.engine);
    block(control.engine, [control.id("cb")]);
    assert.deepEqual(control.engine.state.battle?.blockingParty, [control.id("cb")], "control: a covert character can block a covert party");
  });

  rule("CR 302.11", "a party with a member that lacks covert is not a covert party", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "c1", def: covert("C1"), owner: P1 },
        { key: "plain1", def: character({ name: "Plain1" }), owner: P1 },
        { key: "plain", def: character({ name: "Plain" }), owner: P2 }
      ]
    });
    attack(engine, [id("c1"), id("plain1")]);
    toBlocking(engine);
    block(engine, [id("plain")]);
    assert.deepEqual(engine.state.battle?.blockingParty, [id("plain")], "a non-covert character may block a party that is not entirely covert");
  });

  rule("CR 302.11", "a lone attacker without covert is not a covert party", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "plain", def: character({ name: "Plain" }), owner: P2 }
      ]
    });
    attack(engine, [id("a")]);
    toBlocking(engine);
    block(engine, [id("plain")]);
    assert.deepEqual(engine.state.battle?.blockingParty, [id("plain")]);
  });

  rule("CR 302.11", "the party is covert only while ALL its members are: removing the one non-covert member makes it a covert party", () => {
    const remover = gadget("Remover", [
      { id: "go", type: "activated", targets: [{ id: "t", selector: { type: "character", zone: "play" }, count: 1 }], effects: [{ type: "removeFromBattle", target: { type: "selected", id: "t" } }] }
    ]);
    const { engine, id } = buildGame({
      cards: [
        { key: "c1", def: covert("C1"), owner: P1 },
        { key: "plain1", def: character({ name: "Plain1" }), owner: P1 },
        { key: "rem", def: remover, owner: P1 },
        { key: "plain", def: character({ name: "Plain" }), owner: P2 }
      ]
    });
    attack(engine, [id("c1"), id("plain1")]);
    use(engine, P1, id("rem"), "go", { t: [id("plain1")] });
    toBlocking(engine);
    refused(() => block(engine, [id("plain")]), "blocking the party that is now only covert characters", /COVERT/);
  });

  rule("CR 302.11a", "if a member of a covert party loses covert, the party immediately isn't covert anymore", () => {
    const build = () =>
      buildGame({
        cards: [
          { key: "c1", def: covertLoser("C1"), owner: P1 },
          { key: "c2", def: covert("C2"), owner: P1 },
          { key: "plain", def: character({ name: "Plain" }), owner: P2 }
        ]
      });
    const control = build();
    attack(control.engine, [control.id("c1"), control.id("c2")]);
    toBlocking(control.engine);
    refused(() => block(control.engine, [control.id("plain")]), "the party is still covert while nobody has lost covert", /COVERT/);

    const { engine, id } = build();
    attack(engine, [id("c1"), id("c2")]);
    use(engine, P1, id("c1"), "lose");
    assert.equal(engine.hasKeyword(id("c1"), "covert"), false, "the member lost covert");
    toBlocking(engine);
    block(engine, [id("plain")]);
    assert.deepEqual(engine.state.battle?.blockingParty, [id("plain")], "the party isn't covert anymore, so a non-covert character may block it");
  });

  rule("CR 302.11b", "if the party loses covert after blockers were declared, the blocks that were already made are unaffected", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "c1", def: covertLoser("C1"), owner: P1 },
        { key: "cb", def: covert("CB"), owner: P2 },
        { key: "cb2", def: covert("CB2"), owner: P2 }
      ]
    });
    attack(engine, [id("c1")]);
    toBlocking(engine);
    block(engine, [id("cb"), id("cb2")]);
    // A covert character is only allowed to block a covert party, yet once the party has lost covert the existing block stands.
    use(engine, P1, id("c1"), "lose");
    assert.equal(engine.hasKeyword(id("c1"), "covert"), false, "the party is no longer covert");
    assert.deepEqual(engine.state.battle?.blockingParty, [id("cb"), id("cb2")], "both blockers are still blocking");
    assert.equal(engine.state.battle?.phase, "beforeDamageResponse", "and the battle carries on");
    autoResolveBattle(engine);
    assert.equal(engine.state.cards[id("c1")]!.damage, 2, "the blockers dealt their damage (1 each) to the party they blocked");
  });

  rule("CR 302.11b", "if a non-covert party becomes covert after blockers were declared, the blocks already made are unaffected", () => {
    const granter = gadget("Granter", [
      { id: "go", type: "activated", targets: [{ id: "t", selector: { type: "character", zone: "play" }, count: 1 }], effects: [{ type: "grantKeyword", target: { type: "selected", id: "t" }, keyword: "covert", duration: { type: "untilEndOfTurn" } }] }
    ]);
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "g", def: granter, owner: P1 },
        { key: "plain", def: character({ name: "Plain" }), owner: P2 }
      ]
    });
    attack(engine, [id("a")]);
    toBlocking(engine);
    block(engine, [id("plain")]);
    use(engine, P1, id("g"), "go", { t: [id("a")] });
    assert.equal(engine.hasKeyword(id("a"), "covert"), true, "the party became covert");
    assert.deepEqual(engine.state.battle?.blockingParty, [id("plain")], "the non-covert blocker is still blocking");
  });
});

describe("CR 302.15 — removed from battle", () => {
  const remover = () =>
    gadget("Remover", [
      { id: "go", type: "activated", targets: [{ id: "t", selector: { type: "character", zone: "play" }, count: 1 }], effects: [{ type: "removeFromBattle", target: { type: "selected", id: "t" } }] }
    ]);

  rule("CR 302.15", "a character removed from battle is no longer part of its attacking party and takes no further part", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a1", def: character({ name: "A1", strength: 3 }), owner: P1 },
        { key: "a2", def: character({ name: "A2", strength: 2 }), owner: P1 },
        { key: "rem", def: remover(), owner: P1 }
      ]
    });
    const before = engine.state.players[P2].influence;
    attack(engine, [id("a1"), id("a2")]);
    use(engine, P1, id("rem"), "go", { t: [id("a1")] });
    assert.deepEqual(engine.state.battle?.attackingParty, [id("a2")], "it left the party");
    toBlocking(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);
    assert.equal(engine.state.players[P2].influence, before - 2, "only the remaining attacker's damage was dealt");
  });

  rule("CR 302.15", "a character removed from battle is no longer part of its blocking party and is not a legal damage target", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 3 }), owner: P1 },
        { key: "b1", def: character({ name: "B1", life: 5 }), owner: P2 },
        { key: "b2", def: character({ name: "B2", life: 5 }), owner: P2 },
        { key: "rem", def: remover(), owner: P1 }
      ]
    });
    attack(engine, [id("a")]);
    toBlocking(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b1"), id("b2")] });
    use(engine, P1, id("rem"), "go", { t: [id("b1")] });
    assert.deepEqual(engine.state.battle?.blockingParty, [id("b2")], "it left the blocking party");
    resolvePendingResponses(engine);
    const view = engine.getBattleView()!;
    assert.deepEqual(view.damageSources[0]?.legalTargets, [{ type: "card", cardId: id("b2") }], "only the remaining blocker can be assigned damage");
  });

  rule("CR 302.15", "the battle view drops a blocker destroyed mid-battle at once, not only when damage comes", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 3 }), owner: P1 },
        { key: "b1", def: character({ name: "B1", life: 5 }), owner: P2 },
        { key: "b2", def: character({ name: "B2", life: 5 }), owner: P2 },
        {
          key: "kill",
          def: gadget("Killer", [
            { id: "go", type: "activated", targets: [{ id: "t", selector: { type: "character", zone: "play" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }
          ]),
          owner: P1
        }
      ]
    });
    attack(engine, [id("a")]);
    toBlocking(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b1"), id("b2")] });
    use(engine, P1, id("kill"), "go", { t: [id("b1")] });
    assert.equal(engine.state.cards[id("b1")]?.zone, "discard", "control: the blocker was destroyed");
    assert.deepEqual(engine.getBattleView()?.blockingParty, [id("b2")], "the view no longer lists the destroyed blocker");
  });

  rule("CR 302.15", "a removed character does not assign battle damage", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 1 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 4, life: 5 }), owner: P2 },
        { key: "rem", def: remover(), owner: P1 }
      ]
    });
    attack(engine, [id("a")]);
    toBlocking(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b")] });
    use(engine, P1, id("rem"), "go", { t: [id("b")] });
    autoResolveBattle(engine);
    assert.equal(engine.state.cards[id("a")]!.damage, 0, "the removed blocker dealt no battle damage");
  });

  rule("CR 302.15", "battle damage already assigned to a character that is then removed from battle is not inflicted", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 3, speed: 1 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 0, life: 5, speed: 1 }), owner: P2 },
        { key: "rem", def: remover(), owner: P1 }
      ]
    });
    attack(engine, [id("a")]);
    toBlocking(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b")] });
    resolvePendingResponses(engine);
    engine.perform({ type: "assignBattleDamage", playerId: P1, assignments: [{ sourceId: id("a"), target: { type: "card", cardId: id("b") }, amount: 3 }] });
    engine.perform({ type: "assignBattleDamage", playerId: P2, assignments: [] });
    assert.equal(engine.state.responseWindow?.kind, "battleAfterDamage", "the damage is assigned but not yet inflicted");
    use(engine, P1, id("rem"), "go", { t: [id("b")] });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("b")]!.damage, 0, "the damage assigned to the removed character was not inflicted");
  });

  rule("CR 302.15", "battle damage assigned to a character that stays in the battle is inflicted (control for the removal case)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 3, speed: 1 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 0, life: 5, speed: 1 }), owner: P2 }
      ]
    });
    attack(engine, [id("a")]);
    toBlocking(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b")] });
    autoResolveBattle(engine);
    assert.equal(engine.state.cards[id("b")]!.damage, 3, "the assigned damage landed");
  });

  rule("CR 302.15", "battle damage already assigned to an attacker that is then removed from battle is not inflicted", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 0, life: 5, speed: 1 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 3, life: 5, speed: 1 }), owner: P2 },
        { key: "rem", def: remover(), owner: P1 }
      ]
    });
    attack(engine, [id("a")]);
    toBlocking(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b")] });
    resolvePendingResponses(engine);
    engine.perform({ type: "assignBattleDamage", playerId: P1, assignments: [] });
    engine.perform({ type: "assignBattleDamage", playerId: P2, assignments: [{ sourceId: id("b"), target: { type: "card", cardId: id("a") }, amount: 3 }] });
    assert.equal(engine.state.responseWindow?.kind, "battleAfterDamage", "the damage is assigned but not yet inflicted");
    use(engine, P1, id("rem"), "go", { t: [id("a")] });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("a")]!.damage, 0, "the damage assigned to the removed attacker was not inflicted");
  });

  rule("CR 302.15", "when every blocker is removed from battle there is no blocking party left, so the attackers' damage goes to the target", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 3 }), owner: P1 },
        { key: "b", def: character({ name: "B", life: 5 }), owner: P2 },
        { key: "rem", def: remover(), owner: P1 }
      ]
    });
    const before = engine.state.players[P2].influence;
    attack(engine, [id("a")]);
    toBlocking(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b")] });
    use(engine, P1, id("rem"), "go", { t: [id("b")] });
    autoResolveBattle(engine);
    assert.equal(engine.state.players[P2].influence, before - 3, "the faction took the damage");
    assert.equal(engine.state.cards[id("b")]!.damage, 0, "the removed blocker took none");
  });
});

describe("CR 412.1 — unblockability", () => {
  const unblockable = (name: string) => character({ name, behavior: { keywords: ["cannotBeBlocked"] } });
  const block = (engine: SpoilsEngine, blockers: CardInstanceId[]) => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: blockers });

  rule("CR 412.1", "a party of only unblockable characters cannot be blocked: the defender may not form a blocking party", () => {
    const build = (def: CardDefinition) =>
      buildGame({
        cards: [
          { key: "a", def, owner: P1 },
          { key: "blk", def: character({ name: "Blk" }), owner: P2 }
        ]
      });
    const refusal = build(unblockable("Ghost"));
    attack(refusal.engine, [refusal.id("a")]);
    toBlocking(refusal.engine);
    refused(() => block(refusal.engine, [refusal.id("blk")]), "blocking an unblockable party", /cannot be blocked/);
    const control = build(character({ name: "Plain" }));
    attack(control.engine, [control.id("a")]);
    toBlocking(control.engine);
    block(control.engine, [control.id("blk")]);
    assert.deepEqual(control.engine.state.battle?.blockingParty, [control.id("blk")], "control: the same blocker may block an ordinary party");
  });

  rule("CR 412.1", "an unblockable party goes through unblocked: the defender declares no blockers and takes the damage", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: unblockable("Ghost"), owner: P1 },
        { key: "blk", def: character({ name: "Blk" }), owner: P2 }
      ]
    });
    const before = engine.state.players[P2].influence;
    attack(engine, [id("a")]);
    toBlocking(engine);
    block(engine, []);
    assert.deepEqual(engine.state.battle?.blockingParty, [], "no blocking party");
    autoResolveBattle(engine);
    assert.equal(engine.state.players[P2].influence, before - 1, "the unblockable attacker's damage reached the faction");
  });

  rule("CR 412.1", "every member of a party of several unblockable characters is unblockable", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "g1", def: unblockable("G1"), owner: P1 },
        { key: "g2", def: unblockable("G2"), owner: P1 },
        { key: "blk", def: character({ name: "Blk" }), owner: P2 }
      ]
    });
    attack(engine, [id("g1"), id("g2")]);
    toBlocking(engine);
    refused(() => block(engine, [id("blk")]), "blocking a party of two unblockable characters", /cannot be blocked/);
  });

  rule("CR 412.1", "a party containing a character that can be blocked is not unblockable, even with an unblockable member", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "g", def: unblockable("Ghost"), owner: P1 },
        { key: "plain", def: character({ name: "Plain" }), owner: P1 },
        { key: "blk", def: character({ name: "Blk" }), owner: P2 }
      ]
    });
    attack(engine, [id("g"), id("plain")]);
    toBlocking(engine);
    block(engine, [id("blk")]);
    assert.deepEqual(engine.state.battle?.blockingParty, [id("blk")], "the mixed party can be blocked");
  });

  rule("CR 412.1", "while a member of a party of only unblockable characters: removing the blockable member makes the rest unblockable", () => {
    const remover = gadget("Remover", [
      { id: "go", type: "activated", targets: [{ id: "t", selector: { type: "character", zone: "play" }, count: 1 }], effects: [{ type: "removeFromBattle", target: { type: "selected", id: "t" } }] }
    ]);
    const { engine, id } = buildGame({
      cards: [
        { key: "g", def: unblockable("Ghost"), owner: P1 },
        { key: "plain", def: character({ name: "Plain" }), owner: P1 },
        { key: "rem", def: remover, owner: P1 },
        { key: "blk", def: character({ name: "Blk" }), owner: P2 }
      ]
    });
    attack(engine, [id("g"), id("plain")]);
    use(engine, P1, id("rem"), "go", { t: [id("plain")] });
    toBlocking(engine);
    refused(() => block(engine, [id("blk")]), "blocking the party that is now only unblockable", /cannot be blocked/);
  });

  rule("CR 412.1", "an unblockable character that joins a blockable party does not make it unblockable (and an unblockable party stops being so when a blockable character joins)", () => {
    const joiner = gadget("Joiner", [
      { id: "go", type: "activated", targets: [{ id: "t", selector: { type: "character", zone: "play" }, count: 1 }], effects: [{ type: "addToBattle", target: { type: "selected", id: "t" }, side: "attacking" }] }
    ]);
    const { engine, id } = buildGame({
      cards: [
        { key: "g", def: unblockable("Ghost"), owner: P1 },
        { key: "reserve", def: character({ name: "Reserve" }), owner: P1, depleted: true },
        { key: "joiner", def: joiner, owner: P1 },
        { key: "blk", def: character({ name: "Blk" }), owner: P2 }
      ]
    });
    attack(engine, [id("g")]);
    use(engine, P1, id("joiner"), "go", { t: [id("reserve")] });
    assert.deepEqual(engine.state.battle?.attackingParty, [id("g"), id("reserve")], "a blockable character joined the party");
    toBlocking(engine);
    block(engine, [id("blk")]);
    assert.deepEqual(engine.state.battle?.blockingParty, [id("blk")], "the party is blockable now");
  });

  rule("CR 412.1", "a character that gains cannot-be-blocked during the battle makes an all-unblockable party unblockable", () => {
    const granter = gadget("Granter", [
      { id: "go", type: "activated", targets: [{ id: "t", selector: { type: "character", zone: "play" }, count: 1 }], effects: [{ type: "grantKeyword", target: { type: "selected", id: "t" }, keyword: "cannotBeBlocked", duration: { type: "untilEndOfTurn" } }] }
    ]);
    const build = (grant: boolean) => {
      const game = buildGame({
        cards: [
          { key: "a", def: character({ name: "A" }), owner: P1 },
          { key: "g", def: granter, owner: P1 },
          { key: "blk", def: character({ name: "Blk" }), owner: P2 }
        ]
      });
      attack(game.engine, [game.id("a")]);
      if (grant) use(game.engine, P1, game.id("g"), "go", { t: [game.id("a")] });
      toBlocking(game.engine);
      return game;
    };
    const withGrant = build(true);
    refused(() => block(withGrant.engine, [withGrant.id("blk")]), "blocking after the party gained cannot be blocked", /cannot be blocked/);
    const without = build(false);
    block(without.engine, [without.id("blk")]);
    assert.deepEqual(without.engine.state.battle?.blockingParty, [without.id("blk")], "control: without the grant the block is legal");
  });

  rule("CR 412.1", "cards that add characters into the blocking party still block an unblockable party", () => {
    const joiner = gadget("Joiner", [
      { id: "go", type: "activated", targets: [{ id: "t", selector: { type: "character", zone: "play" }, count: 1 }], effects: [{ type: "addToBattle", target: { type: "selected", id: "t" }, side: "blocking" }] }
    ]);
    const { engine, id } = buildGame({
      cards: [
        { key: "g", def: unblockable("Ghost"), owner: P1 },
        { key: "j", def: joiner, owner: P2 },
        { key: "ally", def: character({ name: "Ally", life: 5 }), owner: P2 }
      ]
    });
    const before = engine.state.players[P2].influence;
    attack(engine, [id("g")]);
    engine.perform({ type: "passPriority", playerId: P1 });
    use(engine, P2, id("j"), "go", { t: [id("ally")] });
    engine.perform({ type: "passPriority", playerId: P2 });
    resolvePendingResponses(engine);
    block(engine, []);
    assert.deepEqual(engine.state.battle?.blockingParty, [id("ally")], "the added character is the blocking party");
    autoResolveBattle(engine);
    assert.equal(engine.state.cards[id("ally")]!.damage, 1, "the unblockable character's damage went to the added blocker");
    assert.equal(engine.state.players[P2].influence, before, "not to the faction");
  });
});
