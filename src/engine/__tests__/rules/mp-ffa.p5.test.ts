// Multiplayer (free-for-all) rules, part 5: battles, Unique and trigger / replacement ordering.
// Atoms: data/rule-tests/source/multiplayer.txt (batch mp-ffa): MPX-attack, MPX-battle-window, MPX-unique, MPX-order.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine, TriggeredAbility } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";
import {
  autoResolveBattle,
  buildGame,
  character,
  factionCard,
  defaultFactionDefinition,
  item,
  location,
  noDevelopFaction,
  P1,
  P2,
  P3,
  P4,
  resolvePendingResponses,
  tactic
} from "../support/fixtures.js";
import { refused, rule } from "./_rule.js";

const SEATS = [P1, P2, P3, P4];

/** `count` seats whose factions have no develop rule, so nobody is prompted at the start of a turn. */
const plainSeats = (count: number) => ({
  playerA: { faction: noDevelopFaction() },
  playerB: { faction: noDevelopFaction() },
  extraPlayers: Array.from({ length: count - 2 }, () => ({ faction: noDevelopFaction() }))
});

/** Factions with neither a restore rule nor a develop rule: nothing of theirs is triggered at the start of a turn. */
const quietFaction = () =>
  factionCard({
    faction: defaultFactionDefinition({
      turn: { restore: { detachResources: false, restoreNonResources: false }, develop: { choices: [] } }
    })
  });
const quietSeats = (count: number) => ({
  playerA: { faction: quietFaction() },
  playerB: { faction: quietFaction() },
  extraPlayers: Array.from({ length: count - 2 }, () => ({ faction: quietFaction() }))
});

const blank = (name: string) => tactic({ name });
const pass = (engine: SpoilsEngine, playerId: PlayerId) => engine.perform({ type: "passPriority", playerId });
const priority = (engine: SpoilsEngine) => engine.state.responseWindow?.priorityPlayerId;
const influence = (engine: SpoilsEngine, playerId: PlayerId) => engine.state.players[playerId].influence;
const zoneOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId]!.zone;

type Placement = CardPlacement;

/** Declares `attackerKey` (P1's) at `target`; the battle's windows are still open. */
function attack(
  engine: SpoilsEngine,
  attackerId: CardInstanceId,
  target: { type: "faction"; playerId: PlayerId } | { type: "card"; cardId: CardInstanceId },
  attackerPlayer: PlayerId = P1
): void {
  engine.perform({ type: "declareAttack", playerId: attackerPlayer, attackerIds: [attackerId], target });
}

/** Passes every response window until the blocking step is reached. */
function toBlocking(engine: SpoilsEngine): void {
  resolvePendingResponses(engine);
  assert.equal(engine.state.battle?.phase, "blocking", "the battle waits for blockers");
}

/** The players who hold priority, in order, while each passes with nothing to say, until the window closes. */
function windowOrder(engine: SpoilsEngine): PlayerId[] {
  const order: PlayerId[] = [];
  while (engine.state.responseWindow?.phase === "acceptingResponses") {
    const who = priority(engine)!;
    order.push(who);
    pass(engine, who);
  }
  // Everyone has passed: the window closes into the next step of the battle.
  if (engine.state.responseWindow?.phase === "resolving") engine.perform({ type: "advanceFlow" });
  return order;
}

/** Everyone else passes on the top item and it resolves; the window stays open for whoever may still act. */
function resolveTop(engine: SpoilsEngine): void {
  while (engine.state.responseWindow?.phase === "acceptingResponses" && engine.state.responseStack.length > 0) {
    pass(engine, priority(engine)!);
  }
  engine.perform({ type: "advanceFlow" });
}

for (const seats of [3, 4]) {
  const players = SEATS.slice(0, seats);
  const last = players[seats - 1];

  describe(`MPX-attack — whom a battle is against, ${seats} seats`, () => {
    rule("MPX-attack", `${seats} seats: any opponent's faction may be attacked and its owner defends, whichever seat it is in`, () => {
      for (const target of players.slice(1)) {
        const { engine, id } = buildGame({
          ...plainSeats(seats),
          cards: [{ key: "atk", def: character({ name: "Attacker" }), owner: P1 }]
        });
        attack(engine, id("atk"), { type: "faction", playerId: target });
        assert.equal(engine.state.battle?.attackerPlayerId, P1, `attacker, target ${target}`);
        assert.equal(engine.state.battle?.defenderPlayerId, target, `the defending player is the faction's controller (${target})`);
      }
    });

    rule("MPX-attack", `${seats} seats: you cannot attack your own faction`, () => {
      const { engine, id } = buildGame({
        ...plainSeats(seats),
        cards: [{ key: "atk", def: character({ name: "Attacker" }), owner: P1 }]
      });
      refused(() => attack(engine, id("atk"), { type: "faction", playerId: P1 }), "own faction", /own faction/);
    });

    rule("MPX-attack", `${seats} seats: the attack options list every other player's faction and every location the attacker does not control`, () => {
      const { engine, id } = buildGame({
        ...plainSeats(seats),
        cards: [
          { key: "atk", def: character({ name: "Attacker" }), owner: P1 },
          { key: "farLocation", def: location({ name: "Far" }), owner: P2, controller: last },
          { key: "nearLocation", def: location({ name: "Near" }), owner: P2 },
          { key: "myLocation", def: location({ name: "Mine" }), owner: P1 },
          { key: "heldLocation", def: location({ name: "Held" }), owner: P2, controller: P1 }
        ]
      });
      const options = engine.getAttackOptions(P1);
      assert.deepEqual(
        options.targets.filter(t => t.type === "faction").map(t => (t as { playerId: PlayerId }).playerId),
        players.slice(1),
        "every other player's faction"
      );
      assert.deepEqual(
        options.targets.filter(t => t.type === "card").map(t => (t as { cardId: CardInstanceId }).cardId).sort(),
        [id("farLocation"), id("nearLocation")].sort(),
        "locations by control: the one P1 owns but does not control is attackable, the one it controls is not"
      );
      engine.state.players[last].eliminated = { turn: 1 };
      assert.deepEqual(
        engine.getAttackOptions(P1).targets.filter(t => t.type === "faction").map(t => (t as { playerId: PlayerId }).playerId),
        players.slice(1, -1),
        "a player who has lost cannot be attacked"
      );
    });

    rule("MPX-attack", `${seats} seats: a location the attacker does not own but a third player controls is attacked, and that player defends`, () => {
      const { engine, id } = buildGame({
        ...plainSeats(seats),
        cards: [
          { key: "atk", def: character({ name: "Attacker", strength: 2 }), owner: P1 },
          // Owned by P2, controlled by P3 (control was taken); P1 controls neither.
          { key: "fort", def: location({ name: "Fort", structure: 5 }), owner: P2, controller: P3 }
        ]
      });
      attack(engine, id("atk"), { type: "card", cardId: id("fort") });
      assert.equal(engine.state.battle?.defenderPlayerId, P3, "control, not ownership, decides the defending player");
      toBlocking(engine);
      assert.equal(engine.getBlockOptions()?.playerId, P3, "the blocking step is P3's");
      engine.perform({ type: "declareBlockers", playerId: P3, blockerIds: [] });
      autoResolveBattle(engine);
      assert.equal(engine.state.cards[id("fort")].damage, 2, "the location took the damage");
      assert.equal(influence(engine, P3), 25, "its controller's faction took none");
      assert.equal(influence(engine, P2), 25, "nor did its owner's");
    });

    rule("MPX-attack", `${seats} seats: a location the attacker owns but another player controls may be attacked; one the attacker controls may not`, () => {
      const { engine, id } = buildGame({
        ...plainSeats(seats),
        cards: [
          { key: "atk", def: character({ name: "Attacker" }), owner: P1 },
          { key: "stolen", def: location({ name: "Stolen" }), owner: P1, controller: P2 },
          { key: "held", def: location({ name: "Held" }), owner: P2, controller: P1 }
        ]
      });
      refused(() => attack(engine, id("atk"), { type: "card", cardId: id("held") }), "a location P1 controls", /own location/);
      attack(engine, id("atk"), { type: "card", cardId: id("stolen") });
      assert.equal(engine.state.battle?.defenderPlayerId, P2, "control, not ownership: P2 defends its stolen location");
    });

    rule("MPX-attack", `${seats} seats: only the player controlling the target is being attacked; a bystander's characters cannot block`, () => {
      const { engine, id } = buildGame({
        ...plainSeats(seats),
        cards: [
          { key: "atk", def: character({ name: "Attacker" }), owner: P1 },
          { key: "defender", def: character({ name: "Defender" }), owner: last },
          { key: "bystanderA", def: character({ name: "Bystander A" }), owner: P2 },
          ...(seats === 4 ? [{ key: "bystanderB", def: character({ name: "Bystander B" }), owner: P3 }] : [])
        ].map(p => p as Placement)
      });
      attack(engine, id("atk"), { type: "faction", playerId: last });
      toBlocking(engine);
      assert.equal(engine.getBlockOptions()?.playerId, last, "the blocking step belongs to the defending player");
      assert.deepEqual(engine.getBlockOptions()?.blockers, [id("defender")], "only the defender's character could block");
      refused(
        () => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("bystanderA")] }),
        "a bystander cannot form a blocking party",
        /Only the defending player can block/
      );
      refused(
        () => engine.perform({ type: "declareBlockers", playerId: last, blockerIds: [id("bystanderA")] }),
        "the defending player cannot use another player's character",
        /do not control that blocker/
      );
      refused(
        () => engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("defender")] }),
        "the attacker cannot form the blocking party",
        /Only the defending player can block/
      );
      engine.perform({ type: "declareBlockers", playerId: last, blockerIds: [id("defender")] });
      assert.deepEqual(engine.state.battle?.blockingParty, [id("defender")], "control: the defending player's own character blocks");
    });

    rule("MPX-attack", `${seats} seats: a bystander's character is never added to the blocking party, depleted or not`, () => {
      const addToBlock = (name: string): CardDefinition =>
        tactic({
          name,
          behavior: {
            abilities: [
              {
                id: "press",
                type: "activated",
                targets: [{ id: "c", selector: { zone: "play", type: "character" }, count: 1 }],
                effects: [{ type: "addToBattle", target: { type: "selected", id: "c" }, side: "blocking" }]
              }
            ]
          }
        });
      const { engine, id } = buildGame({
        ...plainSeats(seats),
        cards: [
          { key: "atk", def: character({ name: "Attacker" }), owner: P1 },
          { key: "defender", def: character({ name: "Defender" }), owner: last },
          { key: "mine", def: character({ name: "Bystander's", life: 5 }), owner: P2 },
          { key: "tired", def: character({ name: "Bystander's Tired", life: 5 }), owner: P2, depleted: true },
          { key: "gangA", def: addToBlock("Press Gang A"), owner: P2, zone: "hand" },
          { key: "gangB", def: addToBlock("Press Gang B"), owner: P2, zone: "hand" },
          { key: "ownAdd", def: addToBlock("Reinforce"), owner: last, zone: "hand" },
          { key: "reserve", def: character({ name: "Reserve", life: 5 }), owner: last }
        ]
      });
      attack(engine, id("atk"), { type: "faction", playerId: last });
      toBlocking(engine);
      engine.perform({ type: "declareBlockers", playerId: last, blockerIds: [id("defender")] });
      // In the window before damage the defender's own reserve can be added, but P2 (a bystander) cannot add its characters.
      assert.equal(engine.state.responseWindow?.phase, "acceptingResponses", "a window opens before damage");
      assert.equal(priority(engine), P1);
      pass(engine, P1);
      assert.equal(priority(engine), last);
      engine.perform({ type: "playCard", playerId: last, cardId: id("ownAdd"), selected: { c: [id("reserve")] } });
      resolveTop(engine);
      assert.deepEqual(engine.state.battle?.blockingParty, [id("defender"), id("reserve")], "control: the defending player's own character joins");
      pass(engine, last);
      assert.equal(priority(engine), P2, "P2's window");
      engine.perform({ type: "playCard", playerId: P2, cardId: id("gangA"), selected: { c: [id("mine")] } });
      resolveTop(engine);
      assert.deepEqual(engine.state.battle?.blockingParty, [id("defender"), id("reserve")], "the effect is terminated (CR 407.6)");
      engine.perform({ type: "playCard", playerId: P2, cardId: id("gangB"), selected: { c: [id("tired")] } });
      resolveTop(engine);
      assert.deepEqual(engine.state.battle?.blockingParty, [id("defender"), id("reserve")], "depleted or not");
    });

    rule("MPX-attack", `${seats} seats: "cannot be blocked" stops the defending player and nobody else may block either`, () => {
      const { engine, id } = buildGame({
        ...plainSeats(seats),
        cards: [
          { key: "atk", def: character({ name: "Ghost", behavior: { keywords: ["cannotBeBlocked"] } }), owner: P1 },
          { key: "defender", def: character({ name: "Defender" }), owner: last },
          { key: "bystander", def: character({ name: "Bystander" }), owner: P2 }
        ]
      });
      attack(engine, id("atk"), { type: "faction", playerId: last });
      toBlocking(engine);
      const options = engine.getBlockOptions();
      assert.equal(options?.canBlock, false, "no blocking party can be formed");
      assert.deepEqual(options?.blockers, [], "nobody");
      refused(
        () => engine.perform({ type: "declareBlockers", playerId: last, blockerIds: [id("defender")] }),
        "the defender cannot block it",
        /cannot be blocked/
      );
      refused(
        () => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("bystander")] }),
        "a bystander cannot block it either",
        /Only the defending player can block/
      );
      engine.perform({ type: "declareBlockers", playerId: last, blockerIds: [] });
      assert.deepEqual(engine.state.battle?.blockingParty, [], "control: no blocking party");
    });

    rule("MPX-attack", `${seats} seats: battle damage goes to the defending player only`, () => {
      const { engine, id } = buildGame({
        ...plainSeats(seats),
        cards: [{ key: "atk", def: character({ name: "Attacker", strength: 4 }), owner: P1 }]
      });
      attack(engine, id("atk"), { type: "faction", playerId: P2 });
      toBlocking(engine);
      engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
      autoResolveBattle(engine);
      assert.equal(influence(engine, P2), 21, "the defender lost 4");
      for (const other of players.filter(p => p !== P2)) assert.equal(influence(engine, other), 25, `${other} lost nothing`);
    });

    rule("MPX-attack", `${seats} seats: a blocked attack damages the defender's blocker and leaves every faction alone`, () => {
      const { engine, id } = buildGame({
        ...plainSeats(seats),
        cards: [
          { key: "atk", def: character({ name: "Attacker", strength: 2, life: 5 }), owner: P1 },
          { key: "wall", def: character({ name: "Wall", strength: 1, life: 5 }), owner: last }
        ]
      });
      attack(engine, id("atk"), { type: "faction", playerId: last });
      toBlocking(engine);
      engine.perform({ type: "declareBlockers", playerId: last, blockerIds: [id("wall")] });
      autoResolveBattle(engine);
      assert.equal(engine.state.cards[id("wall")].damage, 2, "the blocker took the damage");
      assert.equal(engine.state.cards[id("atk")].damage, 1, "the attacker took the blocker's");
      for (const p of players) assert.equal(influence(engine, p), 25, `${p}'s faction is untouched`);
    });

    rule("MPX-attack", `${seats} seats: only the attacker and the defender assign battle damage`, () => {
      const { engine, id } = buildGame({
        ...plainSeats(seats),
        cards: [
          { key: "atk", def: character({ name: "Attacker", strength: 2 }), owner: P1 },
          { key: "wall", def: character({ name: "Wall", strength: 1, life: 5 }), owner: last }
        ]
      });
      attack(engine, id("atk"), { type: "faction", playerId: last });
      toBlocking(engine);
      engine.perform({ type: "declareBlockers", playerId: last, blockerIds: [id("wall")] });
      resolvePendingResponses(engine);
      assert.equal(engine.state.battle?.phase, "attackerDamageAssignment");
      const view = engine.getBattleView();
      assert.equal(view?.actingPlayerId, P1, "the attacker assigns first");
      const source = view!.damageSources[0];
      const assignments = [{ sourceId: source.cardId, target: source.legalTargets[0], amount: source.strength }];
      for (const bystander of players.filter(p => p !== P1 && p !== last)) {
        refused(
          () => engine.perform({ type: "assignBattleDamage", playerId: bystander, assignments }),
          "a bystander cannot assign damage",
          /./
        );
      }
      engine.perform({ type: "assignBattleDamage", playerId: P1, assignments });
      assert.equal(engine.getBattleView()?.actingPlayerId, last, "then the defending player assigns");
    });

    rule("MPX-attack", `${seats} seats: each attack is its own battle; one turn's attacks may target different players`, () => {
      const { engine, id } = buildGame({
        ...plainSeats(seats),
        cards: [
          { key: "a1", def: character({ name: "First", strength: 1 }), owner: P1 },
          { key: "a2", def: character({ name: "Second", strength: 2 }), owner: P1 },
          { key: "a3", def: character({ name: "Third", strength: 3 }), owner: P1 }
        ]
      });
      attack(engine, id("a1"), { type: "faction", playerId: P2 });
      toBlocking(engine);
      engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
      autoResolveBattle(engine);
      assert.equal(engine.getBattleView(), undefined, "the first battle is over");
      attack(engine, id("a2"), { type: "faction", playerId: last });
      assert.equal(engine.state.battle?.defenderPlayerId, last, "the second battle has its own defending player");
      assert.deepEqual(engine.state.battle?.attackingParty, [id("a2")], "and its own attacking party");
      toBlocking(engine);
      engine.perform({ type: "declareBlockers", playerId: last, blockerIds: [] });
      autoResolveBattle(engine);
      if (seats === 4) {
        attack(engine, id("a3"), { type: "faction", playerId: P3 });
        toBlocking(engine);
        engine.perform({ type: "declareBlockers", playerId: P3, blockerIds: [] });
        autoResolveBattle(engine);
        assert.equal(influence(engine, P3), 22, "third battle hit the third seat");
      }
      assert.equal(influence(engine, P2), 24, "first battle hit P2 alone");
      assert.equal(influence(engine, last), 23, "second battle hit the last seat alone");
    });

    rule("MPX-attack", `${seats} seats: a location taken by a third player mid-battle stops being the target (CR 407.5)`, () => {
      const steal = item({
        name: "Usurper",
        behavior: {
          abilities: [
            {
              id: "usurp",
              type: "activated",
              targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }],
              effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
            }
          ]
        }
      });
      const { engine, id } = buildGame({
        ...plainSeats(seats),
        cards: [
          { key: "atk", def: character({ name: "Attacker", strength: 2 }), owner: P1 },
          { key: "fort", def: location({ name: "Fort", structure: 5 }), owner: P2 },
          { key: "usurper", def: steal, owner: last }
        ]
      });
      attack(engine, id("atk"), { type: "card", cardId: id("fort") });
      assert.equal(engine.state.battle?.defenderPlayerId, P2, "P2 controls the location when the attack is declared");
      while (priority(engine) !== last) pass(engine, priority(engine)!);
      engine.perform({ type: "activateAbility", playerId: last, cardId: id("usurper"), abilityId: "usurp", selected: { t: [id("fort")] } });
      resolveTop(engine);
      assert.equal(engine.state.cards[id("fort")].controllerId, last, "the last seat took control");
      resolvePendingResponses(engine);
      engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
      autoResolveBattle(engine);
      assert.equal(engine.state.cards[id("fort")].damage, 0, "the location is no longer the target: no damage to it");
      for (const p of players) assert.equal(influence(engine, p), 25, "and none to any faction");
    });
  });

  describe(`MPX-battle-window — who may deploy and use abilities in a battle, ${seats} seats`, () => {
    const board = (defender: PlayerId, extra: Placement[] = []) =>
      buildGame({
        ...plainSeats(seats),
        cards: [{ key: "atk", def: character({ name: "Attacker", strength: 1 }), owner: P1 }, ...extra]
      });

    rule("MPX-battle-window", `${seats} seats: the attacker, then the defender, then the others clockwise from the defender, in every battle window`, () => {
      for (const defender of players.slice(1)) {
        const { engine, id } = board(defender);
        attack(engine, id("atk"), { type: "faction", playerId: defender });
        const clockwiseFromDefender = [...players.slice(players.indexOf(defender)), ...players.slice(0, players.indexOf(defender))];
        const expected = [P1, defender, ...clockwiseFromDefender.filter(p => p !== P1 && p !== defender)];
        assert.deepEqual(windowOrder(engine), expected, `after the attackers (defender ${defender})`);
        assert.equal(engine.state.battle?.phase, "blocking", "then the blocking step");
        engine.perform({ type: "declareBlockers", playerId: defender, blockerIds: [] });
        // The window before damage runs in the same order (CR 609.1a).
        assert.equal(engine.state.responseWindow?.phase, "acceptingResponses");
        assert.deepEqual(windowOrder(engine), expected, `before damage (defender ${defender})`);
      }
    });

    rule("MPX-battle-window", "4 seats: attacker in seat 1, defender in seat 3: seat 1, seat 3, seat 4, seat 2", () => {
      if (seats !== 4) return;
      const { engine, id } = board(P3);
      attack(engine, id("atk"), { type: "faction", playerId: P3 });
      assert.deepEqual(windowOrder(engine), [P1, P3, P4, P2], "the order after the defender is clockwise from the defender");
    });

    rule("MPX-battle-window", `${seats} seats: each player in turn can respond in their window, and the response is offered to everyone but its maker`, () => {
      const defender = last;
      const expected = [P1, defender, ...[...players.slice(players.indexOf(defender)), ...players.slice(0, players.indexOf(defender))].filter(p => p !== P1 && p !== defender)];
      const extra: Placement[] = players.map(p => ({ key: `t-${p}`, def: blank(`Tactic of ${p}`), owner: p, zone: "hand" as const }));
      const { engine, id } = board(defender, extra);
      attack(engine, id("atk"), { type: "faction", playerId: defender });
      const seen: PlayerId[] = [];
      while (engine.state.responseWindow?.phase === "acceptingResponses") {
        const who = priority(engine)!;
        seen.push(who);
        engine.perform({ type: "playCard", playerId: who, cardId: id(`t-${who}`) });
        const offered: PlayerId[] = [];
        while (engine.state.responseWindow?.phase === "acceptingResponses" && engine.state.responseStack.length > 0) {
          offered.push(priority(engine)!);
          pass(engine, priority(engine)!);
        }
        assert.ok(!offered.includes(who), `${who} is not offered their own tactic`);
        assert.equal(offered.length, seats - 1, `every other player is offered ${who}'s tactic`);
        engine.perform({ type: "advanceFlow" });
        assert.equal(zoneOf(engine, id(`t-${who}`)), "discard", `${who}'s tactic resolved`);
        assert.equal(priority(engine), who, `${who} still holds their window after the tactic resolves`);
        pass(engine, who);
      }
      if (engine.state.responseWindow?.phase === "resolving") engine.perform({ type: "advanceFlow" });
      assert.deepEqual(seen, expected, "each player had their one window, in order");
      assert.equal(engine.state.battle?.phase, "blocking");
    });

    rule("MPX-battle-window", `${seats} seats: a player's window does not reopen once the next player has begun theirs`, () => {
      const defender = last;
      const { engine, id } = board(defender, [{ key: "late", def: blank("Late"), owner: P1, zone: "hand" }]);
      attack(engine, id("atk"), { type: "faction", playerId: defender });
      pass(engine, P1);
      assert.equal(priority(engine), defender, "the defender's window");
      refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("late") }), "the attacker's window is over", /priority/i);
    });

    rule("MPX-battle-window", `${seats} seats: the blocking step is not a window: nobody but the defender acts in it`, () => {
      const { engine, id } = board(last, [{ key: "bystanderTactic", def: blank("Bystander Tactic"), owner: P2, zone: "hand" }]);
      attack(engine, id("atk"), { type: "faction", playerId: last });
      toBlocking(engine);
      assert.equal(engine.state.responseWindow, undefined, "no response window is open");
      refused(
        () => engine.perform({ type: "playCard", playerId: P2, cardId: id("bystanderTactic") }),
        "a bystander cannot deploy while blockers are declared",
        /./
      );
    });
  });
}

describe("MPX-battle-window — three players", () => {
  rule("MPX-battle-window", "3 seats: the order is the attacker, the defender, then the one other player", () => {
    const { engine, id } = buildGame({ ...plainSeats(3), cards: [{ key: "atk", def: character({ name: "Attacker" }), owner: P1 }] });
    attack(engine, id("atk"), { type: "faction", playerId: P3 });
    assert.deepEqual(windowOrder(engine), [P1, P3, P2]);
  });

  rule("MPX-battle-window", "a player who has lost has no window", () => {
    const { engine, id } = buildGame({ ...plainSeats(4), cards: [{ key: "atk", def: character({ name: "Attacker" }), owner: P1 }] });
    engine.state.players[P4].eliminated = { turn: 1 };
    attack(engine, id("atk"), { type: "faction", playerId: P3 });
    assert.deepEqual(windowOrder(engine), [P1, P3, P2], "P4 is skipped");
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("MPX-unique — Unique with several players", () => {
  const unique = (name: string) => character({ name, id: `unique-${name}`, unique: "dup" });
  const thief = item({
    name: "Thief",
    behavior: {
      abilities: [
        {
          id: "steal",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });

  for (const seats of [3, 4]) {
    const players = SEATS.slice(0, seats);
    const copies = (): Placement[] => players.map(p => ({ key: `dup-${p}`, def: unique(`Dup ${p}`), owner: p }));
    const pendingKind = (engine: SpoilsEngine) => engine.state.pendingChoice?.kind;

    rule("MPX-unique", `${seats} seats: every player may control their own copy of a unique card at the same time`, () => {
      const { engine, id } = buildGame({
        ...plainSeats(seats),
        cards: [...copies(), { key: "poke", def: blank("Poke"), owner: P1, zone: "hand" }]
      });
      engine.perform({ type: "playCard", playerId: P1, cardId: id("poke") });
      resolvePendingResponses(engine);
      assert.equal(engine.state.pendingChoice, undefined, "no keep-one choice is raised");
      for (const p of players) assert.equal(zoneOf(engine, id(`dup-${p}`)), "play", `${p}'s copy stays in play`);
    });

    rule("MPX-unique", `${seats} seats: a player who plays a copy while others control theirs is not forced to choose`, () => {
      const { engine, id } = buildGame({
        ...plainSeats(seats),
        cards: [...copies().filter(c => c.owner !== P1), { key: "mine", def: unique("Dup p1"), owner: P1, zone: "hand" }]
      });
      engine.perform({ type: "playCard", playerId: P1, cardId: id("mine") });
      resolvePendingResponses(engine);
      assert.equal(engine.state.pendingChoice, undefined, "only the cards one player controls count");
      assert.equal(zoneOf(engine, id("mine")), "play");
    });

    rule("MPX-unique", `${seats} seats: a player who comes to control two copies chooses which one to keep, and the rest are destroyed`, () => {
      const { engine, id } = buildGame({
        ...plainSeats(seats),
        activePlayerId: P3,
        cards: [...copies(), { key: "thief", def: thief, owner: P3 }]
      });
      engine.perform({ type: "activateAbility", playerId: P3, cardId: id("thief"), abilityId: "steal", selected: { t: [id("dup-p1")] } });
      resolvePendingResponses(engine);
      assert.equal(pendingKind(engine), "uniqueSurvivor", "P3 now controls two copies");
      const pending = engine.state.pendingChoice;
      assert.equal(pending?.playerId, P3, "the player who controls both chooses");
      assert.deepEqual(
        pending?.kind === "uniqueSurvivor" ? [...pending.candidates].sort() : [],
        [id("dup-p1"), id("dup-p3")].sort(),
        "the two copies P3 controls are the candidates"
      );
      refused(
        () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("dup-p1") } }),
        "the previous controller does not choose",
        /./
      );
      engine.perform({ type: "resolvePendingChoice", playerId: P3, choice: { kind: "uniqueSurvivor", keep: id("dup-p3") } });
      assert.equal(zoneOf(engine, id("dup-p3")), "play", "the kept copy stays");
      assert.equal(zoneOf(engine, id("dup-p1")), "discard", "the other is destroyed");
      for (const p of players.filter(q => q !== P1 && q !== P3)) assert.equal(zoneOf(engine, id(`dup-${p}`)), "play", `${p}'s own copy is untouched`);
    });

    rule("MPX-unique", `${seats} seats: the player may instead keep the copy they took control of`, () => {
      const { engine, id } = buildGame({
        ...plainSeats(seats),
        activePlayerId: P3,
        cards: [...copies(), { key: "thief", def: thief, owner: P3 }]
      });
      engine.perform({ type: "activateAbility", playerId: P3, cardId: id("thief"), abilityId: "steal", selected: { t: [id("dup-p1")] } });
      resolvePendingResponses(engine);
      engine.perform({ type: "resolvePendingChoice", playerId: P3, choice: { kind: "uniqueSurvivor", keep: id("dup-p1") } });
      assert.equal(zoneOf(engine, id("dup-p1")), "play");
      assert.equal(engine.state.cards[id("dup-p1")].controllerId, P3, "P3 keeps the one they took");
      assert.equal(zoneOf(engine, id("dup-p3")), "discard", "their own is destroyed");
      assert.equal(pendingKind(engine), undefined);
    });

    rule("MPX-unique", `${seats} seats: control of a copy taken from a third player's table is judged against the taker's own copy only`, () => {
      // P3 takes P2's copy; P1 and (at 4 seats) P4 keep theirs.
      const { engine, id } = buildGame({
        ...plainSeats(seats),
        activePlayerId: P3,
        cards: [...copies(), { key: "thief", def: thief, owner: P3 }]
      });
      engine.perform({ type: "activateAbility", playerId: P3, cardId: id("thief"), abilityId: "steal", selected: { t: [id("dup-p2")] } });
      resolvePendingResponses(engine);
      assert.equal(pendingKind(engine), "uniqueSurvivor");
      assert.equal(engine.state.pendingChoice?.playerId, P3);
      engine.perform({ type: "resolvePendingChoice", playerId: P3, choice: { kind: "uniqueSurvivor", keep: id("dup-p3") } });
      assert.equal(zoneOf(engine, id("dup-p2")), "discard");
      assert.equal(zoneOf(engine, id("dup-p1")), "play", "P1's copy is not part of the conflict");
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------------

describe("MPX-order — ordering simultaneous triggers and replacements", () => {
  /** Fires on any card entering play and gives its controller `amount` influence. */
  const enterWatcher = (name: string, amount: number): CardDefinition =>
    item({
      name,
      behavior: {
        abilities: [
          {
            id: `watch-${name}`,
            type: "triggered",
            event: "cardEnteredPlay",
            effects: [{ type: "modifyInfluence", player: "controller", amount }]
          } satisfies TriggeredAbility
        ]
      }
    });

  const orderChoice = (engine: SpoilsEngine) => {
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "orderTriggers", "an ordering choice is raised");
    return pending as Extract<NonNullable<typeof pending>, { kind: "orderTriggers" }>;
  };
  const pick = (engine: SpoilsEngine, playerId: PlayerId, sourceId: CardInstanceId, abilityId: string) =>
    engine.perform({ type: "resolvePendingChoice", playerId, choice: { kind: "orderTriggers", next: { sourceId, abilityId } } });

  for (const seats of [3, 4]) {
    const players = SEATS.slice(0, seats);
    const last = players[seats - 1];

    rule("MPX-order", `${seats} seats: simultaneous triggers all from one player's cards are ordered by that player, even when they are not the active player`, () => {
      const { engine, id } = buildGame({
        ...plainSeats(seats),
        cards: [
          { key: "w1", def: enterWatcher("One", 1), owner: last },
          { key: "w2", def: enterWatcher("Two", 10), owner: last },
          { key: "play", def: character({ name: "Entrant" }), owner: P1, zone: "hand" }
        ]
      });
      engine.perform({ type: "playCard", playerId: P1, cardId: id("play") });
      resolvePendingResponses(engine);
      const choice = orderChoice(engine);
      assert.equal(choice.playerId, last, "the player whose cards they are orders them, not the active player (P1)");
      refused(() => pick(engine, P1, id("w1"), "watch-One"), "the active player does not order another player's triggers", /./);
      pick(engine, last, id("w2"), "watch-Two");
      assert.equal(influence(engine, last), 36, "both resolved");
    });

    rule("MPX-order", `${seats} seats: triggers from two or more players' cards are ordered by the active player, who controls none of them`, () => {
      const { engine, id } = buildGame({
        ...plainSeats(seats),
        cards: [
          { key: "wB", def: enterWatcher("B", 2), owner: P2 },
          { key: "wC", def: enterWatcher("C", 3), owner: last },
          { key: "play", def: character({ name: "Entrant" }), owner: P1, zone: "hand" }
        ]
      });
      engine.perform({ type: "playCard", playerId: P1, cardId: id("play") });
      resolvePendingResponses(engine);
      const choice = orderChoice(engine);
      assert.equal(choice.playerId, P1, "the active player decides although P1 controls neither");
      refused(() => pick(engine, last, id("wC"), "watch-C"), "a player whose cards are among them but who is not active", /./);
      pick(engine, P1, id("wC"), "watch-C");
      assert.equal(influence(engine, last), 28, "the picked trigger resolved");
      assert.equal(influence(engine, P2), 27, "and the other resolved too");
    });

    rule("MPX-order", `${seats} seats: the order is decided one trigger at a time, and the deciding player stays the same`, () => {
      const { engine, id } = buildGame({
        ...plainSeats(seats),
        cards: [
          { key: "wA", def: enterWatcher("A", 1), owner: P2 },
          { key: "wB", def: enterWatcher("B", 10), owner: P2 },
          { key: "wC", def: enterWatcher("C", 100), owner: last },
          { key: "play", def: character({ name: "Entrant" }), owner: P1, zone: "hand" }
        ]
      });
      const base = Object.fromEntries(players.map(p => [p, influence(engine, p)]));
      engine.perform({ type: "playCard", playerId: P1, cardId: id("play") });
      resolvePendingResponses(engine);
      const first = orderChoice(engine);
      assert.equal(first.playerId, P1, "the cards belong to two players: the active player decides");
      assert.equal(first.triggers.length, 3, "all three wait");
      pick(engine, P1, id("wC"), "watch-C");
      assert.equal(influence(engine, last) - base[last], 100, "the picked trigger has already resolved");
      assert.equal(influence(engine, P2) - base[P2], 0, "the others have not");
      const second = orderChoice(engine);
      assert.equal(second.triggers.length, 2, "two remain");
      assert.equal(second.playerId, P1, "both left are P2's, but the order of the whole set is still the active player's (CR 503.4a)");
      refused(() => pick(engine, P2, id("wA"), "watch-A"), "P2 does not take over the ordering", /./);
      pick(engine, P1, id("wB"), "watch-B");
      assert.equal(engine.state.pendingChoice, undefined, "the last one needs no choice");
      assert.equal(influence(engine, P2) - base[P2], 11, "B then A resolved");
    });

    rule("MPX-order", `${seats} seats: start-of-turn triggers of every player are ordered by the active player`, () => {
      const startWatcher = (name: string, amount: number): CardDefinition =>
        item({
          name,
          behavior: {
            abilities: [
              { id: `start-${name}`, type: "triggered", event: "turnStarted", effects: [{ type: "modifyInfluence", player: "controller", amount }] }
            ]
          }
        });
      const { engine, id } = buildGame({
        ...quietSeats(seats),
        cards: [
          { key: "sB", def: startWatcher("B", 1), owner: P1 },
          { key: "sC", def: startWatcher("C", 10), owner: last },
          { key: "sD", def: startWatcher("D", 100), owner: P3 === last ? P1 : P3 }
        ]
      });
      engine.perform({ type: "endTurn", playerId: P1 });
      resolvePendingResponses(engine);
      assert.equal(engine.state.activePlayerId, P2, "P2's turn begins");
      const choice = orderChoice(engine);
      assert.equal(choice.playerId, P2, "the active player orders everyone's start-of-turn triggers, controlling none");
      assert.equal(choice.triggers.length, 3, "all three players' triggers are in the one batch");
      pick(engine, P2, id("sC"), "start-C");
      assert.equal(influence(engine, last), 35, "the picked one resolved first");
    });

    rule("MPX-order", `${seats} seats: replacements for the same thing from one player's cards are chosen by that player`, () => {
      const shield = (name: string, amount: number) =>
        item({
          name,
          behavior: {
            abilities: [
              {
                id: `ward-${name}`,
                type: "replacement",
                replaces: { event: "destroy", cardType: "character", controlledBy: "any" },
                effects: [{ type: "modifyInfluence", player: "controller", amount }]
              }
            ]
          }
        });
      const killer = tactic({
        name: "Kill",
        behavior: {
          abilities: [
            {
              id: "a",
              type: "activated",
              targets: [{ id: "t", selector: { type: "character" }, count: 1 }],
              effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
            }
          ]
        }
      });
      const { engine, id } = buildGame({
        ...plainSeats(seats),
        cards: [
          { key: "victim", def: character({ name: "Victim" }), owner: P2 },
          { key: "s1", def: shield("S1", 1), owner: last },
          { key: "s2", def: shield("S2", 10), owner: last },
          { key: "kill", def: killer, owner: P1, zone: "hand" }
        ]
      });
      engine.perform({ type: "playCard", playerId: P1, cardId: id("kill"), selected: { t: [id("victim")] } });
      resolvePendingResponses(engine);
      const pending = engine.state.pendingChoice;
      assert.equal(pending?.kind, "chooseReplacement", "a choice between the replacements");
      assert.equal(pending?.playerId, last, "the player whose cards they are chooses, not the active player");
    });

    rule("MPX-order", `${seats} seats: replacements from two or more players' cards are chosen by the active player, who controls none`, () => {
      const shield = (name: string, amount: number) =>
        item({
          name,
          behavior: {
            abilities: [
              {
                id: `ward-${name}`,
                type: "replacement",
                replaces: { event: "destroy", cardType: "character", controlledBy: "any" },
                effects: [{ type: "modifyInfluence", player: "controller", amount }]
              }
            ]
          }
        });
      const killer = tactic({
        name: "Kill",
        behavior: {
          abilities: [
            {
              id: "a",
              type: "activated",
              targets: [{ id: "t", selector: { type: "character" }, count: 1 }],
              effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
            }
          ]
        }
      });
      const { engine, id } = buildGame({
        ...plainSeats(seats),
        cards: [
          { key: "victim", def: character({ name: "Victim" }), owner: P2 },
          { key: "s1", def: shield("S1", 1), owner: P2 },
          { key: "s2", def: shield("S2", 10), owner: last },
          { key: "kill", def: killer, owner: P1, zone: "hand" }
        ]
      });
      engine.perform({ type: "playCard", playerId: P1, cardId: id("kill"), selected: { t: [id("victim")] } });
      resolvePendingResponses(engine);
      const pending = engine.state.pendingChoice;
      assert.equal(pending?.kind, "chooseReplacement");
      assert.equal(pending?.playerId, P1, "the active player chooses");
      const options = pending?.kind === "chooseReplacement" ? pending.options : [];
      const index = options.findIndex(option => option.sourceId === id("s2"));
      assert.ok(index >= 0, "both shields are offered");
      engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooseReplacement", index } });
      resolvePendingResponses(engine);
      assert.equal(influence(engine, last), 35, "the chosen replacement applied");
      assert.equal(influence(engine, P2), 25, "the other was ignored");
      assert.equal(zoneOf(engine, id("victim")), "play", "the destruction was replaced");
    });

    rule("MPX-order", `${seats} seats: a delayed replacement that is not chosen keeps waiting`, () => {
      const shield = item({
        name: "Shield",
        behavior: {
          abilities: [
            {
              id: "ward",
              type: "replacement",
              replaces: { event: "destroy", cardType: "character", controlledBy: "any" },
              effects: [{ type: "modifyInfluence", player: "controller", amount: 10 }]
            }
          ]
        }
      });
      const ward = tactic({
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
      const killer = tactic({
        name: "Kill",
        behavior: {
          abilities: [
            {
              id: "a",
              type: "activated",
              targets: [{ id: "t", selector: { type: "character" }, count: 1 }],
              effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
            }
          ]
        }
      });
      const { engine, id } = buildGame({
        ...plainSeats(seats),
        cards: [
          { key: "victim", def: character({ name: "Victim" }), owner: P2 },
          { key: "shield", def: shield, owner: last },
          { key: "ward", def: ward, owner: P2, zone: "hand" },
          { key: "kill", def: killer, owner: P1, zone: "hand" }
        ]
      });
      // P1 destroys the victim; P2 answers by setting up the delayed replacement, which resolves first.
      engine.perform({ type: "playCard", playerId: P1, cardId: id("kill"), selected: { t: [id("victim")] } });
      engine.perform({ type: "playCard", playerId: P2, cardId: id("ward") });
      resolvePendingResponses(engine);
      const pending = engine.state.pendingChoice;
      assert.equal(pending?.kind, "chooseReplacement", "the delayed replacement and the shield compete");
      assert.equal(pending?.playerId, P1, "the active player chooses between two players' replacements");
      const options = pending?.kind === "chooseReplacement" ? pending.options : [];
      const shieldIndex = options.findIndex(option => !option.delayed);
      engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooseReplacement", index: shieldIndex } });
      resolvePendingResponses(engine);
      assert.equal(influence(engine, last), 35, "the shield applied");
      assert.equal(engine.state.runtimeReplacements.length, 1, "the unchosen delayed replacement still waits");
    });
  }
});
