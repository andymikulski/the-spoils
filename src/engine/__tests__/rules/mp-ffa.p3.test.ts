// Multiplayer (free-for-all) rules, part 3: losing, winning, drawing and elimination.
// Atoms: data/rule-tests/source/multiplayer.txt (batch mp-ffa): MPX-win, MPX-simul, MPX-elim, MPX-elim-timing;
// rulings RQ-mp-3, RQ-mp-7, RQ-mp-9, RQ-mp-12, RQ-mp-13, RQ-mp-14 (data/rule-tests/rulings.md).

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, PlayerId, SpoilsEngine } from "../../../engine.js";
import {
  buildGame,
  character,
  item,
  noDevelopFaction,
  P1,
  P2,
  P3,
  P4,
  resolvePendingResponses,
  tactic,
  type CardPlacement
} from "../support/fixtures.js";
import { refused, rule } from "./_rule.js";

const SEATS = [P1, P2, P3, P4];
const ACTIVATED = (effects: unknown[]) =>
  ({ abilities: [{ id: "go", type: "activated", effects }] }) as CardDefinition["behavior"];

/** `amount` influence off the named player's faction ("loses N influence"). */
const loses = (playerId: PlayerId, amount: number) => ({
  type: "modifyInfluence" as const,
  player: { type: "player" as const, id: playerId },
  amount: -amount
});
const gains = (playerId: PlayerId, amount: number) => ({ ...loses(playerId, -amount) });

/** A tactic whose one ability runs `effects` in order. */
const spell = (name: string, effects: unknown[]) => tactic({ name, behavior: ACTIVATED(effects) });
/** A tactic that picks one card ("t") and runs `effects` on it. */
const T = { type: "selected", id: "t" } as const;
const pickSpell = (name: string, effects: unknown[]) =>
  tactic({
    name,
    behavior: { abilities: [{ id: "go", type: "activated", targets: [{ id: "t", selector: {}, count: 1 }], effects }] } as CardDefinition["behavior"]
  });
const blank = (name: string) => tactic({ name });

/** A character whose triggered ability runs `effects` whenever `event` happens. */
const watcher = (name: string, event: string, effects: unknown[], extra: Record<string, unknown> = {}) =>
  character({
    name,
    strength: 1,
    life: 3,
    speed: 1,
    behavior: { abilities: [{ id: "watch", type: "triggered", event, effects, ...extra }] } as CardDefinition["behavior"]
  });

/** `seats` players whose factions have no develop rule, each at `influence` unless named otherwise. */
function table(seats: number, cards: CardPlacement[] = [], influence: Partial<Record<PlayerId, number>> = {}) {
  const seat = (id: PlayerId) => ({ faction: noDevelopFaction(), influence: influence[id] ?? 10 });
  return buildGame({
    playerA: seat(P1),
    playerB: seat(P2),
    extraPlayers: SEATS.slice(2, seats).map(seat),
    cards
  });
}

/** Plays `cardId` for `playerId` and lets every response window close. */
function play(engine: SpoilsEngine, playerId: PlayerId, cardId: string): void {
  engine.perform({ type: "playCard", playerId, cardId });
  resolvePendingResponses(engine);
}

const factionZone = (engine: SpoilsEngine, playerId: PlayerId) =>
  engine.state.cards[engine.state.players[playerId].factionId!]?.zone;

const priority = (engine: SpoilsEngine) => engine.state.responseWindow?.priorityPlayerId;
const pass = (engine: SpoilsEngine, playerId: PlayerId) => engine.perform({ type: "passPriority", playerId });

/** Attacks `defender`'s faction with `attackerId`; the battle runs to its end with every damage source assigned. */
function attackFaction(engine: SpoilsEngine, attackerId: string, defender: PlayerId, onWindow?: () => void): void {
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [attackerId], target: { type: "faction", playerId: defender } });
  onWindow?.();
  for (let guard = 0; engine.state.battle && guard < 60; guard++) {
    if (engine.state.pendingChoice) throw new Error(`unexpected choice ${engine.state.pendingChoice.kind}`);
    if (engine.state.responseWindow) {
      resolvePendingResponses(engine);
      continue;
    }
    const battle = engine.state.battle;
    if (battle.phase === "blocking") {
      engine.perform({ type: "declareBlockers", playerId: battle.defenderPlayerId, blockerIds: [] });
      continue;
    }
    const view = engine.getBattleView();
    if (view?.actingPlayerId) {
      engine.perform({
        type: "assignBattleDamage",
        playerId: view.actingPlayerId,
        assignments: view.damageSources
          .filter(s => s.strength > 0 && s.legalTargets.length > 0)
          .map(s => ({ sourceId: s.cardId, target: s.legalTargets[0]!, amount: s.strength }))
      });
    } else {
      engine.perform({ type: "advanceFlow" });
    }
  }
  assert.equal(engine.state.battle, undefined, "the battle ran to its end");
}

for (const seats of [3, 4]) {
  const others = SEATS.slice(2, seats);

  describe(`MPX-win / MPX-elim at ${seats} seats — a loss removes only that player`, () => {
    rule(["MPX-win", "MPX-elim"], `${seats} seats: a faction at 0 eliminates its owner and the game goes on`, () => {
      const { engine, id } = table(seats, [{ key: "hit", def: spell("Hit", [loses(P2, 10)]), owner: P1, zone: "hand" }]);
      play(engine, P1, id("hit"));
      assert.equal(engine.state.players[P2].influence, 0, "P2's faction is at 0");
      assert.deepEqual(engine.state.players[P2].eliminated, { turn: engine.state.turn }, "P2 is out, as of this turn");
      assert.equal(engine.state.winner, undefined, "two or more players are still in: no result yet");
      assert.deepEqual(engine.getOpponents(P1), others, "P2 is nobody's opponent any more");
      assert.equal(factionZone(engine, P2), "removed", "P2's faction left the game with them");
      assert.ok(
        engine.state.gameLog.some(entry => entry.message.includes("is out of the game")),
        "the log records the elimination"
      );
    });

    rule(["MPX-win", "MPX-simul"], `${seats} seats: one card taking every opponent to 0 wins the game for its controller`, () => {
      const { engine, id } = table(seats, [
        { key: "sweep", def: spell("Sweep", SEATS.slice(1, seats).map(p => loses(p, 10))), owner: P1, zone: "hand" }
      ]);
      play(engine, P1, id("sweep"));
      assert.equal(engine.state.winner, P1, "every other player lost at the same time: P1 is the last one standing");
    });

    rule(["MPX-win", "MPX-simul", "CR 102.2"], `${seats} seats: every player still in losing in one unit is a draw`, () => {
      const { engine, id } = table(seats, [
        { key: "doom", def: spell("Doom", SEATS.slice(0, seats).map(p => loses(p, 10))), owner: P1, zone: "hand" }
      ]);
      play(engine, P1, id("doom"));
      assert.equal(engine.state.winner, "draw", "nobody is left: a draw between them");
    });

    rule(["MPX-simul"], `${seats} seats: reaching 0 is final — a later effect of the same card raising the faction does not save the player`, () => {
      const { engine, id } = table(seats, [
        { key: "tease", def: spell("Tease", [loses(P2, 10), gains(P2, 5)]), owner: P1, zone: "hand" }
      ]);
      play(engine, P1, id("tease"));
      assert.equal(engine.state.players[P2].influence, 5, "the faction was raised again within the unit");
      assert.ok(engine.state.players[P2].eliminated, "P2 still lost: it reached 0 during the unit");
      assert.equal(engine.state.players[P3].eliminated, undefined, "control: P3 is untouched");
    });

    rule(["MPX-simul", "MPX-win"], `${seats} seats: losses in different units are eliminated one unit at a time`, () => {
      const cards = [
        { key: "a", def: spell("First", [loses(P2, 10)]), owner: P1, zone: "hand" as const },
        ...others.map((p, i) => ({ key: `b${i}`, def: spell(`Next ${i}`, [loses(p, 10)]), owner: P1, zone: "hand" as const }))
      ];
      const { engine, id } = table(seats, cards);
      play(engine, P1, id("a"));
      assert.ok(engine.state.players[P2].eliminated, "P2 out after the first card");
      assert.equal(engine.state.winner, undefined, "the game goes on");
      others.forEach((p, i) => {
        play(engine, P1, id(`b${i}`));
        assert.ok(engine.state.players[p].eliminated || engine.state.winner === P1, `${p} out after its own card`);
      });
      assert.equal(engine.state.winner, P1, "the last loss leaves P1 alone");
    });
  });

  describe(`MPX-elim at ${seats} seats — what elimination does`, () => {
    rule(["MPX-elim", "CR 403.6a", "CR 301.4"], `${seats} seats: every card the player owns leaves the game, from every game area, with what is attached to it`, () => {
      const { engine, id } = table(seats, [
        { key: "hit", def: spell("Hit", [loses(P2, 10)]), owner: P1, zone: "hand" },
        { key: "hand", def: blank("In Hand"), owner: P2, zone: "hand" },
        { key: "deck", def: blank("In Deck"), owner: P2, zone: "deck" },
        { key: "discard", def: blank("Discarded"), owner: P2, zone: "discard" },
        { key: "body", def: character({ name: "Body", strength: 1, life: 2, speed: 1 }), owner: P2 },
        { key: "lent", def: character({ name: "Lent", strength: 1, life: 2, speed: 1 }), owner: P2, controller: P3 },
        { key: "gear", def: item({ name: "Gear", attachTo: "character" } as Partial<CardDefinition>), owner: P3, attachedToKey: "body" },
        { key: "keep", def: character({ name: "Keep", strength: 1, life: 2, speed: 1 }), owner: P3 }
      ]);
      play(engine, P1, id("hit"));
      for (const key of ["hand", "deck", "discard", "body", "lent"]) {
        assert.equal(engine.state.cards[id(key)].zone, "removed", `P2's ${key} card is out of the game`);
      }
      assert.ok(!engine.state.players[P3].play.includes(id("lent")), "a card P2 owns leaves even while another player controls it");
      assert.equal(engine.state.cards[id("gear")].zone, "removed", "P3's gear attached to P2's character left play the same way (CR 301.4)");
      assert.equal(engine.state.cards[id("keep")].zone, "play", "control: P3's own character stays");
    });

    rule(["MPX-elim"], `${seats} seats: every card the player controls but doesn't own goes back to its owner, staying in play`, () => {
      const { engine, id } = table(seats, [
        { key: "hit", def: spell("Hit", [loses(P2, 10)]), owner: P1, zone: "hand" },
        { key: "stolen", def: character({ name: "Stolen", strength: 1, life: 2, speed: 1 }), owner: P3, controller: P2 }
      ]);
      play(engine, P1, id("hit"));
      const stolen = engine.state.cards[id("stolen")];
      assert.equal(stolen.zone, "play", "it stays where it is");
      assert.equal(stolen.controllerId, P3, "its owner controls it again");
      assert.ok(engine.state.players[P3].play.includes(stolen.id), "it is filed under its owner's cards in play");
    });

    rule(["MPX-elim"], `${seats} seats: the player's items on the response stack are removed without resolving; the others still resolve`, () => {
      const { engine, id } = table(seats, [
        { key: "opener", def: blank("Opener"), owner: P1, zone: "hand" },
        { key: "retort", def: spell("Retort", [gains(P2, 7)]), owner: P2, zone: "hand" },
        { key: "finisher", def: spell("Finisher", [loses(P2, 10)]), owner: P3, zone: "hand" }
      ]);
      engine.perform({ type: "playCard", playerId: P1, cardId: id("opener") });
      engine.perform({ type: "playCard", playerId: P2, cardId: id("retort") });
      // P2's Retort is offered clockwise from P2: P3 is first.
      assert.equal(priority(engine), P3, "P3 holds the offer on P2's Retort");
      engine.perform({ type: "playCard", playerId: P3, cardId: id("finisher") });
      resolvePendingResponses(engine);
      assert.ok(engine.state.players[P2].eliminated, "Finisher took P2 to 0");
      assert.equal(engine.state.players[P2].influence, 0, "Retort never resolved: P2 gained nothing");
      assert.equal(engine.state.cards[id("retort")].zone, "removed", "P2's card left the game with them");
      assert.equal(engine.state.cards[id("opener")].zone, "discard", "control: P1's Opener still resolved");
      assert.equal(engine.state.responseWindow, undefined, "the window closed normally");
    });

    rule(["MPX-elim"], `${seats} seats: the lasting effects the player created end; another player's stay`, () => {
      const pump = (name: string) =>
        pickSpell(name, [{ type: "createModifier", target: T, stat: "strength", operation: "add", value: 2, duration: { type: "untilEndOfTurn" } }]);
      const { engine, id } = table(seats, [
        { key: "opener", def: blank("Opener"), owner: P1, zone: "hand" },
        { key: "target", def: character({ name: "Target", strength: 2, life: 3, speed: 1 }), owner: P3 },
        { key: "pump2", def: pump("P2's Pump"), owner: P2, zone: "hand" },
        { key: "pump3", def: pump("P3's Pump"), owner: P3, zone: "hand" },
        { key: "finisher", def: spell("Finisher", [loses(P2, 10)]), owner: P1, zone: "hand" }
      ]);
      const targetId = id("target");
      engine.perform({ type: "playCard", playerId: P1, cardId: id("opener") });
      engine.perform({ type: "playCard", playerId: P2, cardId: id("pump2"), selected: { t: [targetId] } });
      resolvePendingResponses(engine);
      assert.deepEqual(
        engine.state.modifiers.filter(m => m.targetId === targetId).map(m => m.createdBy),
        [P2],
        "the modifier records who created it"
      );
      engine.perform({ type: "playCard", playerId: P1, cardId: id("finisher") });
      // Finisher is still waiting for its responses; P3 adds a pump of their own first.
      while (priority(engine) !== P3) pass(engine, priority(engine)!);
      engine.perform({ type: "playCard", playerId: P3, cardId: id("pump3"), selected: { t: [targetId] } });
      resolvePendingResponses(engine);
      const strength = () => engine.getStat(targetId, "strength");
      assert.ok(engine.state.players[P2].eliminated, "Finisher took P2 to 0");
      assert.equal(strength(), 4, "P2's +2 ended with P2; P3's own +2 still applies (2 + 2)");
      assert.deepEqual(
        engine.state.modifiers.filter(m => m.targetId === targetId).map(m => m.createdBy),
        [P3],
        "only the modifier P3 created is left"
      );
    });

    rule(["MPX-elim"], `${seats} seats: nothing triggers on the cards that leave the game with the player`, () => {
      const counter = { type: "addCounter", target: "source", counter: "seen", amount: 1 };
      const { engine, id } = table(seats, [
        { key: "hit", def: spell("Hit", [loses(P2, 10)]), owner: P1, zone: "hand" },
        { key: "body", def: character({ name: "Body", strength: 1, life: 2, speed: 1 }), owner: P2 },
        {
          key: "eye",
          def: watcher("Eye", "cardMoved", [counter], { condition: { type: "cardMovedFromZone", zone: "play" } }),
          owner: P3
        },
        { key: "doomed", def: character({ name: "Doomed", strength: 1, life: 2, speed: 1 }), owner: P3 },
        { key: "kill", def: pickSpell("Kill", [{ type: "destroy", target: T }]), owner: P1, zone: "hand" }
      ]);
      play(engine, P1, id("hit"));
      assert.equal(engine.state.cards[id("body")].zone, "removed", "P2's character left the game");
      assert.equal(engine.state.cards[id("eye")].counters.seen ?? 0, 0, "P3's 'when a card leaves play' did not trigger (RQ-mp-12)");
      // Control: the same watcher does see an ordinary departure.
      engine.perform({ type: "playCard", playerId: P1, cardId: id("kill"), selected: { t: [id("doomed")] } });
      resolvePendingResponses(engine);
      assert.equal(engine.state.cards[id("doomed")].zone, "discard", "Kill destroyed P3's character");
      assert.equal(engine.state.cards[id("eye")].counters.seen, 1, "control: an ordinary departure triggers it");
    });

    rule(["MPX-elim-timing", "MPX-simul", "MPX-order", "CR 503.1"], `${seats} seats: triggers the eliminating battle damage sets off resolve inside its unit, the defender's included; the defender is still out`, () => {
      const counter = { type: "addCounter", target: "source", counter: "seen", amount: 1 };
      const { engine, id } = table(
        seats,
        [
          { key: "brute", def: character({ name: "Brute", strength: 5, life: 5, speed: 1 }), owner: P1 },
          // Battle damage to a faction is a `damageDealt` event (it is not an influence-changing effect).
          { key: "spite", def: watcher("Spite", "damageDealt", [gains(P2, 9)]), owner: P2 },
          { key: "eye", def: watcher("Eye", "damageDealt", [counter]), owner: P3 }
        ],
        { [P2]: 5 }
      );
      engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("brute")], target: { type: "faction", playerId: P2 } });
      let ordered = false;
      for (let guard = 0; engine.state.battle && guard < 60; guard++) {
        const choice = engine.state.pendingChoice;
        if (choice?.kind === "orderTriggers") {
          // Triggers from two players' cards: the active player orders them (MPX-order).
          assert.equal(choice.playerId, P1, "the active player orders P2's and P3's triggers");
          ordered = true;
          engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "orderTriggers", next: { sourceId: id("eye"), abilityId: "watch" } } });
          continue;
        }
        if (engine.state.responseWindow) {
          resolvePendingResponses(engine);
          continue;
        }
        if (engine.state.battle.phase === "blocking") {
          engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
          continue;
        }
        const view = engine.getBattleView();
        if (view?.actingPlayerId) {
          engine.perform({
            type: "assignBattleDamage",
            playerId: view.actingPlayerId,
            assignments: view.damageSources
              .filter(s => s.strength > 0 && s.legalTargets.length > 0)
              .map(s => ({ sourceId: s.cardId, target: s.legalTargets[0]!, amount: s.strength }))
          });
        } else {
          engine.perform({ type: "advanceFlow" });
        }
      }
      assert.ok(ordered, "both triggers were set off by the damage and waited to be ordered");
      assert.equal(engine.state.cards[id("eye")].counters.seen, 1, "P3's trigger resolved");
      assert.equal(engine.state.players[P2].influence, 9, "P2's own trigger resolved too, inside the unit (CR 503.1)");
      assert.ok(engine.state.players[P2].eliminated, "P2 is out all the same: their faction reached 0 during the unit (RQ-r11-4)");
      assert.equal(engine.state.cards[id("spite")].zone, "removed", "P2's cards left the game when the unit ended");
      assert.equal(engine.state.activePlayerId, P1, "it is still P1's turn");
    });

    rule(["MPX-elim", "MPX-elim-timing"], `${seats} seats: a player who has lost takes no further actions`, () => {
      const { engine, id } = table(seats, [
        { key: "hit", def: spell("Hit", [loses(P2, 10)]), owner: P1, zone: "hand" },
        { key: "late", def: blank("Late"), owner: P2, zone: "hand" }
      ]);
      play(engine, P1, id("hit"));
      refused(() => engine.perform({ type: "passPriority", playerId: P2 }), "an eliminated player may not pass priority", /out of the game/);
      engine.perform({ type: "endTurn", playerId: P1 });
      assert.notEqual(priority(engine), P2, "P2 is not offered the end of P1's turn");
      resolvePendingResponses(engine);
      assert.equal(engine.state.activePlayerId, P3, "the turn skips P2's seat");
    });

    rule(["MPX-elim", "MPX-attack", "CR 609.2"], `${seats} seats: a defender eliminated during the battle forms no blocking party and takes no damage; the battle ends normally`, () => {
      const { engine, id } = table(seats, [
        { key: "brute", def: character({ name: "Brute", strength: 3, life: 5, speed: 1 }), owner: P1 },
        { key: "guard", def: character({ name: "Guard", strength: 1, life: 5, speed: 1 }), owner: P2 },
        { key: "finisher", def: spell("Finisher", [loses(P2, 10)]), owner: P3, zone: "hand" }
      ]);
      attackFaction(engine, id("brute"), P2, () => {
        // After attackers are declared: P1 passes, P2 passes, then P3 eliminates P2.
        while (priority(engine) !== P3) pass(engine, priority(engine)!);
        engine.perform({ type: "playCard", playerId: P3, cardId: id("finisher") });
      });
      assert.ok(engine.state.players[P2].eliminated, "Finisher took P2 out mid-battle");
      assert.equal(engine.state.cards[id("guard")].zone, "removed", "P2's character left with them, so nobody blocked");
      assert.equal(engine.state.cards[id("brute")].zone, "play", "the attacker survived");
      assert.equal(engine.state.players[P3].influence, 10, "no other player took the damage");
      assert.equal(engine.state.activePlayerId, P1, "P1's turn goes on");
      engine.perform({ type: "endTurn", playerId: P1 });
      resolvePendingResponses(engine);
      assert.equal(engine.state.activePlayerId, P3, "and then passes to P3, skipping P2");
    });
  });

  describe(`RQ-mp-14 at ${seats} seats — the active player is eliminated`, () => {
    rule(["MPX-elim", "MPX-turn"], `${seats} seats: the turn ends at once and everything in progress is dropped`, () => {
      const { engine, id } = table(seats, [
        { key: "opener", def: blank("Opener"), owner: P1, zone: "hand" },
        { key: "retort", def: spell("Retort", [loses(P3, 1)]), owner: P2, zone: "hand" },
        { key: "finisher", def: spell("Finisher", [loses(P1, 10)]), owner: P3, zone: "hand" }
      ]);
      const turn = engine.state.turn;
      engine.perform({ type: "playCard", playerId: P1, cardId: id("opener") });
      engine.perform({ type: "playCard", playerId: P2, cardId: id("retort") });
      assert.equal(priority(engine), P3, "P3 is offered P2's Retort");
      engine.perform({ type: "playCard", playerId: P3, cardId: id("finisher") });
      resolvePendingResponses(engine);
      assert.ok(engine.state.players[P1].eliminated, "Finisher took the active player to 0");
      assert.equal(engine.state.winner, undefined, "the others play on");
      assert.equal(engine.state.cards[id("finisher")].zone, "discard", "Finisher itself resolved");
      assert.equal(engine.state.cards[id("retort")].zone, "discard", "P2's Retort was removed without resolving, to its owner's discard pile");
      assert.equal(engine.state.players[P3].influence, 10, "Retort's effect never happened");
      assert.equal(engine.state.cards[id("opener")].zone, "removed", "P1's Opener left the game with P1");
      assert.equal(engine.state.responseStack.length, 0, "the stack is empty");
      assert.equal(engine.state.responseWindow, undefined, "no window is left open");
      assert.equal(engine.state.activePlayerId, P2, "the next seat's turn has started");
      assert.equal(engine.state.turn, turn + 1, "a new turn");
      engine.perform({ type: "endTurn", playerId: P2 });
      resolvePendingResponses(engine);
      assert.equal(engine.state.activePlayerId, P3, "turns go on clockwise");
    });

    rule(["MPX-elim"], `${seats} seats: the eliminated player's "at end of turn" delayed effects never happen`, () => {
      const { engine, id } = table(seats, [
        {
          key: "later",
          def: spell("Later", [{ type: "scheduleEffect", when: "endOfTurn", effects: [gains(P1, 20)] }]),
          owner: P1,
          zone: "hand"
        },
        { key: "finisher", def: spell("Finisher", [loses(P1, 10)]), owner: P2, zone: "hand" }
      ]);
      play(engine, P1, id("later"));
      const scheduled = engine.state.scheduledEffects.length;
      engine.perform({ type: "endTurn", playerId: P1 });
      engine.perform({ type: "playCard", playerId: P2, cardId: id("finisher") });
      resolvePendingResponses(engine);
      assert.ok(scheduled >= 1, "the delayed effect was scheduled");
      assert.ok(engine.state.players[P1].eliminated, "P1 was eliminated in response to ending their turn");
      assert.equal(engine.state.players[P1].influence, 0, "the end-of-turn effect never resolved");
      assert.equal(engine.state.scheduledEffects.length, 0, "nothing is left waiting");
      assert.equal(engine.state.activePlayerId, P2, "P2's turn has started");
    });
  });
}

describe("RQ-mp-13 — losses from nested units, in the order factions first reached 0", () => {
  rule(["MPX-simul"], "3 seats: P1's card takes P2 to 0; a trigger nested inside it then takes P1 and P3 to 0 — P2 is out first, then P1 and P3 together: a draw", () => {
    // Spite resolves inside Hit (CR 503.1). Its unit ends first, but P2 reached 0 first, in Hit's unit.
    const spite = watcher("Spite", "influenceChanged", [
      { type: "destroy", target: "source" },
      loses(P1, 10),
      loses(P3, 10)
    ]);
    const { engine, id } = table(3, [
      { key: "hit", def: spell("Hit", [loses(P2, 10)]), owner: P1, zone: "hand" },
      { key: "spite", def: spite, owner: P3 }
    ]);
    play(engine, P1, id("hit"));
    assert.equal(engine.state.players[P1].influence, 0, "the nested trigger took P1 to 0");
    assert.equal(engine.state.players[P3].influence, 0, "and P3");
    assert.equal(engine.state.winner, "draw", "P2 was eliminated first; P1 and P3 then lost together, leaving nobody");
  });

  rule(["MPX-simul"], "4 seats: the same, with P4 left: P2 is out first, then P1 and P3, and P4 wins", () => {
    const spite = watcher("Spite", "influenceChanged", [
      { type: "destroy", target: "source" },
      loses(P1, 10),
      loses(P3, 10)
    ]);
    const { engine, id } = table(4, [
      { key: "hit", def: spell("Hit", [loses(P2, 10)]), owner: P1, zone: "hand" },
      { key: "spite", def: spite, owner: P3 }
    ]);
    play(engine, P1, id("hit"));
    assert.equal(engine.state.winner, P4, "P4 is the last one standing");
  });
});
