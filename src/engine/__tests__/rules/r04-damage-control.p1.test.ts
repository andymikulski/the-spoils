// Batch r04-damage-control, part 1 (docs/TESTING.md): CR 408 Damage.
// Written from the wording of the Comprehensive Rules, not from the engine.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardInstanceId, PlayerId, SpoilsEngine, TargetDeclaration } from "../../../engine.js";
import { autoResolveBattle, buildGame, character, location, P1, P2, resolvePendingResponses, tactic } from "../support/fixtures.js";
import { rule, ruleExempt } from "./_rule.js";
import { settleTurnStart } from "../support/develop.js";

const T = { type: "selected", id: "t" } as const;
const PICK: TargetDeclaration[] = [{ id: "t", selector: {}, count: 1 }];
const OPP_FACTION = { type: "factionOf", player: "opponent" } as const;
const OWN_FACTION = { type: "factionOf", player: "controller" } as const;

/** A character whose ability `zap` deals `amount` damage to the picked card. */
const zapper = (name: string, amount: number) =>
  character({ name, behavior: { abilities: [{ id: "zap", type: "activated", targets: PICK, effects: [{ type: "dealDamage", target: T, amount }] }] } });

/** A character whose abilities deal `amount` damage to the opponent's faction (`zapOpp`) or to its own faction (`zapOwn`). */
const factionZapper = (name: string, amount: number) =>
  character({
    name,
    behavior: {
      abilities: [
        { id: "zapOpp", type: "activated", effects: [{ type: "dealDamage", target: OPP_FACTION, amount }] },
        { id: "zapOwn", type: "activated", effects: [{ type: "dealDamage", target: OWN_FACTION, amount }] }
      ]
    }
  });

/** Counts every damage event it hears (`heard`), sums their amounts (`dmg`), and splits them into battle (`battle`) and effect (`effect`) damage. */
const watcher = (name: string) =>
  character({
    name,
    behavior: {
      abilities: [
        {
          id: "w",
          type: "triggered",
          event: "damageDealt",
          effects: [
            { type: "addCounter", target: "source", counter: "heard", amount: 1 },
            { type: "addCounter", target: "source", counter: "dmg", amount: { type: "eventDamageAmount" } },
            {
              type: "if",
              condition: { type: "damageIsBattle" },
              effects: [{ type: "addCounter", target: "source", counter: "battle", amount: 1 }],
              elseEffects: [{ type: "addCounter", target: "source", counter: "effect", amount: 1 }]
            }
          ]
        }
      ]
    }
  });

/** A continuous damage modifier: `delta` added to damage inflicted to cards matching `selector`. */
const aura = (name: string, delta: number, selector: object, battleOnly = false) =>
  character({
    name,
    behavior: { abilities: [{ id: "m", type: "continuous", modifiers: [], damageModifiers: [{ selector: selector as never, delta, ...(battleOnly ? { battleOnly: true } : {}) }] }] }
  });

/** A "destroy -> put a shield counter on it instead" replacement. */
const guard = (name: string, life: number) =>
  character({
    name,
    life,
    behavior: {
      abilities: [
        { id: "guard", type: "replacement", replaces: { event: "destroy" }, effects: [{ type: "addCounter", target: { type: "selected", id: "__candidate" }, counter: "shield", amount: 1 }] }
      ]
    }
  });

const guardLocation = (name: string, structure: number) =>
  location({
    name,
    structure,
    behavior: {
      abilities: [
        { id: "guard", type: "replacement", replaces: { event: "destroy" }, effects: [{ type: "addCounter", target: { type: "selected", id: "__candidate" }, counter: "shield", amount: 1 }] }
      ]
    }
  });

function activate(engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, abilityId: string, picked?: CardInstanceId): void {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected: picked ? { t: [picked] } : {} });
  settle(engine);
}

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

const damageOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId]!.damage;
const zoneOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId]!.zone;
const counter = (engine: SpoilsEngine, cardId: CardInstanceId, name: string) => engine.state.cards[cardId]!.counters[name] ?? 0;
const influence = (engine: SpoilsEngine, player: PlayerId) => engine.state.players[player].influence;
const battleOf = (engine: SpoilsEngine) => engine.state.battle;

/** The `damageDealt` events logged so far. */
function dealt(engine: SpoilsEngine) {
  const events: Array<{ sourceId?: CardInstanceId; targetId: CardInstanceId; amount: number; battle?: boolean }> = [];
  for (const entry of engine.getLog()) if (entry.event?.type === "damageDealt") events.push(entry.event);
  return events;
}

/** `attacker` attacks `target` with `attackerIds`; the defender declares `blockerIds`; the battle is resolved with each source assigning its full strength to its first legal target. */
function fight(
  engine: SpoilsEngine,
  attackerIds: CardInstanceId[],
  target: { type: "faction"; playerId: PlayerId } | { type: "card"; cardId: CardInstanceId },
  blockerIds: CardInstanceId[],
  attacker: PlayerId = P1,
  defender: PlayerId = P2
): void {
  engine.perform({ type: "declareAttack", playerId: attacker, attackerIds, target });
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: defender, blockerIds });
  for (let guard = 0; guard < 20 && (battleOf(engine) || engine.state.pendingChoice); guard++) {
    if (engine.state.pendingChoice) settle(engine);
    else autoResolveBattle(engine);
  }
  assert.equal(battleOf(engine), undefined, "the battle is over");
}

function passTurn(engine: SpoilsEngine): void {
  const active = engine.state.activePlayerId;
  engine.perform({ type: "endTurn", playerId: active });
  resolvePendingResponses(engine);
  settleTurnStart(engine);
  assert.notEqual(engine.state.activePlayerId, active, "the turn passed to the other player");
}

const ctx = (engine: SpoilsEngine, sourceId: CardInstanceId, controllerId: PlayerId = P1) => ({ sourceId, controllerId, selected: {} });
const REF = (cardId: CardInstanceId) => ({ type: "card", id: cardId }) as const;

describe("CR 408.1 — an attempt to inflict 0 damage", () => {
  rule(["CR 408.1", "CR 408.1a"], "0 damage to a character inflicts no damage and triggers nothing (1 damage does both: control)", () => {
    const zero = buildGame({
      cards: [
        { key: "z", def: zapper("Zero", 0), owner: P1 },
        { key: "victim", def: character({ name: "Victim", life: 3 }), owner: P2 },
        { key: "w", def: watcher("Watcher"), owner: P2 }
      ]
    });
    activate(zero.engine, P1, zero.id("z"), "zap", zero.id("victim"));
    assert.equal(damageOf(zero.engine, zero.id("victim")), 0, "no damage was inflicted");
    assert.equal(counter(zero.engine, zero.id("w"), "heard"), 0, "nothing triggered off damage");
    assert.deepEqual(dealt(zero.engine), [], "no damage event happened");

    const one = buildGame({
      cards: [
        { key: "z", def: zapper("One", 1), owner: P1 },
        { key: "victim", def: character({ name: "Victim", life: 3 }), owner: P2 },
        { key: "w", def: watcher("Watcher"), owner: P2 }
      ]
    });
    activate(one.engine, P1, one.id("z"), "zap", one.id("victim"));
    assert.equal(damageOf(one.engine, one.id("victim")), 1, "control: 1 damage is inflicted");
    assert.equal(counter(one.engine, one.id("w"), "heard"), 1, "control: and it triggers");
  });

  rule(["CR 408.1", "CR 408.1a"], "0 damage to a faction costs no influence and triggers nothing", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "z", def: factionZapper("Zero", 0), owner: P1 },
        { key: "w", def: watcher("Watcher"), owner: P2 }
      ]
    });
    activate(engine, P1, id("z"), "zapOpp");
    assert.equal(influence(engine, P2), 25, "the faction lost nothing");
    assert.equal(counter(engine, id("w"), "heard"), 0, "nothing triggered");
  });

  rule("CR 408.1", "an increase cannot turn 0 damage into damage: the attempt stays 0 (an increase on 1 damage works: control)", () => {
    const board = (amount: number) =>
      buildGame({
        cards: [
          { key: "z", def: zapper("Zapper", amount), owner: P1 },
          { key: "victim", def: character({ name: "Victim", life: 9 }), owner: P2 },
          { key: "boost", def: aura("Boost", 2, { controller: "self", type: "character" }), owner: P2 },
          { key: "w", def: watcher("Watcher"), owner: P2 }
        ]
      });
    const zero = board(0);
    activate(zero.engine, P1, zero.id("z"), "zap", zero.id("victim"));
    assert.equal(damageOf(zero.engine, zero.id("victim")), 0, "0 damage plus an increase is still 0");
    assert.equal(counter(zero.engine, zero.id("w"), "heard"), 0, "and triggers nothing");

    const one = board(1);
    activate(one.engine, P1, one.id("z"), "zap", one.id("victim"));
    assert.equal(damageOf(one.engine, one.id("victim")), 3, "control: 1 damage is increased by 2");
  });

  rule("CR 408.1b", "battle damage of 0: the source still counts as having inflicted it, so the resolution loop ends and the slower sources go on", () => {
    // A speed-3 attacker with 0 strength assigns nothing; the speed-1 attacker is still resolved afterwards and the battle ends.
    const { engine, id } = buildGame({
      cards: [
        { key: "fast", def: character({ name: "Fast", strength: 0, speed: 3 }), owner: P1 },
        { key: "slow", def: character({ name: "Slow", strength: 2, speed: 1 }), owner: P1 },
        { key: "blocker", def: character({ name: "Blocker", strength: 0, speed: 1, life: 5 }), owner: P2 },
        { key: "w", def: watcher("Watcher"), owner: P2 }
      ]
    });
    fight(engine, [id("fast"), id("slow")], { type: "faction", playerId: P2 }, [id("blocker")]);
    assert.equal(damageOf(engine, id("blocker")), 2, "the slower attacker's damage was inflicted after the 0-damage step");
    assert.equal(counter(engine, id("w"), "heard"), 1, "only the real damage triggered anything");
    assert.equal(engine.state.cards[id("fast")]!.depleted, true, "the battle ran to its end: survivors are depleted");
    assert.equal(engine.state.cards[id("slow")]!.depleted, true, "the battle ran to its end: survivors are depleted");
  });

  rule(["CR 408.1", "CR 408.1a", "CR 408.1b"], "a lone 0-strength attacker on an unblocked faction attack: no influence lost, no trigger, battle ends", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "meek", def: character({ name: "Meek", strength: 0, speed: 2 }), owner: P1 },
        { key: "w", def: watcher("Watcher"), owner: P2 }
      ]
    });
    fight(engine, [id("meek")], { type: "faction", playerId: P2 }, []);
    assert.equal(influence(engine, P2), 25, "no influence was lost");
    assert.equal(counter(engine, id("w"), "heard"), 0, "no damage trigger happened");
    assert.deepEqual(dealt(engine), [], "no damage event was recorded");
  });
});

describe("CR 408.2 — damage greater than 0: increases and reductions, then triggers", () => {
  const board = (amount: number, deltas: number[], life = 9) =>
    buildGame({
      cards: [
        { key: "z", def: zapper("Zapper", amount), owner: P1 },
        { key: "victim", def: character({ name: "Victim", life }), owner: P2 },
        { key: "w", def: watcher("Watcher"), owner: P2 },
        ...deltas.map((delta, index) => ({ key: `aura${index}`, def: aura(`Aura${index}`, delta, { controller: "self" as const, type: "character" as const }), owner: P2 }))
      ]
    });

  rule("CR 408.2", "a reduction is applied to the damage before it is inflicted (3 damage reduced by 1 is 2)", () => {
    const { engine, id } = board(3, [-1]);
    activate(engine, P1, id("z"), "zap", id("victim"));
    assert.equal(damageOf(engine, id("victim")), 2, "2 damage was inflicted");
  });

  rule("CR 408.2", "an increase is applied to the damage before it is inflicted (3 damage increased by 1 is 4)", () => {
    const { engine, id } = board(3, [1]);
    activate(engine, P1, id("z"), "zap", id("victim"));
    assert.equal(damageOf(engine, id("victim")), 4, "4 damage was inflicted");
  });

  rule("CR 408.2", "increases and reductions together are all applied (+2 and -1 on 3 damage is 4)", () => {
    const { engine, id } = board(3, [2, -1]);
    activate(engine, P1, id("z"), "zap", id("victim"));
    assert.equal(damageOf(engine, id("victim")), 4, "the net adjustment is +1");
  });

  rule("CR 408.2", "damage with no modifiers is inflicted as is (control)", () => {
    const { engine, id } = board(3, []);
    activate(engine, P1, id("z"), "zap", id("victim"));
    assert.equal(damageOf(engine, id("victim")), 3, "3 damage was inflicted");
  });

  rule("CR 408.2", "a reduction larger than the damage leaves 0, never a negative amount (no healing)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "z", def: zapper("Zapper", 2), owner: P1 },
        { key: "victim", def: character({ name: "Victim", life: 9 }), owner: P2, damage: 1 },
        { key: "ward", def: aura("Ward", -5, { controller: "self", type: "character" }), owner: P2 }
      ]
    });
    activate(engine, P1, id("z"), "zap", id("victim"));
    assert.equal(damageOf(engine, id("victim")), 1, "the damage already on the card stays; the new damage is 0");
  });

  rule("CR 408.2", "a reduction applies only to damage inflicted to what it names: the same damage to a card outside its scope is not reduced", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "z", def: zapper("Zapper", 3), owner: P1 },
        { key: "mine", def: character({ name: "Mine", life: 9 }), owner: P1 },
        { key: "ward", def: aura("Ward", -1, { controller: "self", type: "character" }), owner: P2 },
        { key: "theirs", def: character({ name: "Theirs", life: 9 }), owner: P2 }
      ]
    });
    activate(engine, P1, id("z"), "zap", id("mine"));
    assert.equal(damageOf(engine, id("mine")), 3, "the opponent's ward does not touch my character");
    activate(engine, P1, id("z"), "zap", id("theirs"));
    assert.equal(damageOf(engine, id("theirs")), 2, "control: it does touch theirs");
  });

  rule(["CR 408.2", "CR 408.2b"], "triggers see the adjusted amount, once the increases and reductions are applied", () => {
    const reduced = board(3, [-1]);
    activate(reduced.engine, P1, reduced.id("z"), "zap", reduced.id("victim"));
    assert.equal(counter(reduced.engine, reduced.id("w"), "heard"), 1, "the trigger happened once");
    assert.equal(counter(reduced.engine, reduced.id("w"), "dmg"), 2, "it saw the reduced amount");
    assert.deepEqual(dealt(reduced.engine).map((event) => event.amount), [2], "the damage event carries the adjusted amount");

    const raised = board(3, [1]);
    activate(raised.engine, P1, raised.id("z"), "zap", raised.id("victim"));
    assert.equal(counter(raised.engine, raised.id("w"), "dmg"), 4, "it saw the increased amount");
  });

  rule("CR 408.2b", "when the final amount is greater than 0 all appropriate triggers occur: every watcher fires", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "z", def: zapper("Zapper", 2), owner: P1 },
        { key: "victim", def: character({ name: "Victim", life: 9 }), owner: P2 },
        { key: "w1", def: watcher("Watcher1"), owner: P1 },
        { key: "w2", def: watcher("Watcher2"), owner: P2 }
      ]
    });
    activate(engine, P1, id("z"), "zap", id("victim"));
    assert.equal(counter(engine, id("w1"), "heard"), 1, "the first watcher triggered");
    assert.equal(counter(engine, id("w2"), "heard"), 1, "the second watcher triggered");
  });

  rule("CR 408.2a", "when the adjusted amount is 0 nothing further happens: no damage, no trigger (effect damage)", () => {
    const { engine, id } = board(1, [-1]);
    activate(engine, P1, id("z"), "zap", id("victim"));
    assert.equal(damageOf(engine, id("victim")), 0, "no damage");
    assert.equal(counter(engine, id("w"), "heard"), 0, "no trigger");
    assert.deepEqual(dealt(engine), [], "no damage event");
  });

  rule(["CR 408.2a", "CR 408.1b"], "battle damage reduced to 0: nothing further happens, but the source counts as having inflicted it and the loop goes on", () => {
    const setup = (ward: boolean) =>
      buildGame({
        cards: [
          { key: "fast", def: character({ name: "Fast", strength: 2, speed: 3 }), owner: P1 },
          { key: "slow", def: character({ name: "Slow", strength: 2, speed: 1 }), owner: P1 },
          { key: "blocker", def: character({ name: "Blocker", strength: 0, speed: 1, life: 9 }), owner: P2 },
          { key: "w", def: watcher("Watcher"), owner: P2 },
          ...(ward ? [{ key: "ward", def: aura("Ward", -5, { controller: "self", type: "character" }, true), owner: P2, attackEligible: false }] : [])
        ]
      });
    const warded = setup(true);
    fight(warded.engine, [warded.id("fast"), warded.id("slow")], { type: "faction", playerId: P2 }, [warded.id("blocker")]);
    assert.equal(damageOf(warded.engine, warded.id("blocker")), 0, "all battle damage was reduced to 0");
    assert.equal(counter(warded.engine, warded.id("w"), "heard"), 0, "nothing triggered");
    assert.deepEqual(dealt(warded.engine), [], "no damage event was recorded");

    const open = setup(false);
    fight(open.engine, [open.id("fast"), open.id("slow")], { type: "faction", playerId: P2 }, [open.id("blocker")]);
    assert.equal(damageOf(open.engine, open.id("blocker")), 4, "control: without the ward 2 + 2 damage lands");
  });

  rule("CR 408.2a", "battle damage to a faction reduced to 0 costs no influence", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "raider", def: character({ name: "Raider", strength: 3 }), owner: P1 },
        { key: "ward", def: aura("Ward", -3, { controller: "self", type: "faction" }, true), owner: P2, attackEligible: false },
        { key: "w", def: watcher("Watcher"), owner: P2 }
      ]
    });
    fight(engine, [id("raider")], { type: "faction", playerId: P2 }, []);
    assert.equal(influence(engine, P2), 25, "the faction lost nothing");
    assert.equal(counter(engine, id("w"), "heard"), 0, "nothing triggered");
  });
});

describe("CR 408.3 — damage to a faction", () => {
  rule("CR 408.3", "damage inflicted to a faction makes it lose an equal amount of influence", () => {
    const { engine, id } = buildGame({ cards: [{ key: "z", def: factionZapper("Zapper", 4), owner: P1 }] });
    activate(engine, P1, id("z"), "zapOpp");
    assert.equal(influence(engine, P2), 21, "the opponent's faction lost 4");
    assert.equal(influence(engine, P1), 25, "mine is untouched");
  });

  rule("CR 408.3", "a faction takes damage from any source, including its own controller's (their own faction loses influence)", () => {
    const { engine, id } = buildGame({ cards: [{ key: "z", def: factionZapper("Zapper", 3), owner: P1 }] });
    activate(engine, P1, id("z"), "zapOwn");
    assert.equal(influence(engine, P1), 22, "my own faction lost 3");
    assert.equal(influence(engine, P2), 25, "the opponent's did not");
  });

  rule("CR 408.3", "a faction carries no damage markers: it loses influence only", () => {
    const { engine, id } = buildGame({ cards: [{ key: "z", def: factionZapper("Zapper", 4), owner: P1 }] });
    activate(engine, P1, id("z"), "zapOpp");
    const faction = engine.state.players[P2].factionId!;
    assert.equal(damageOf(engine, faction), 0, "the faction card holds no damage");
  });

  rule("CR 408.3", "the influence lost equals the damage after increases and reductions", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "z", def: factionZapper("Zapper", 4), owner: P1 },
        { key: "ward", def: aura("Ward", -1, { controller: "self", type: "faction" }), owner: P2 }
      ]
    });
    activate(engine, P1, id("z"), "zapOpp");
    assert.equal(influence(engine, P2), 22, "4 damage reduced by 1 costs 3 influence");
  });

  rule("CR 408.3", "battle damage to a faction costs that much influence", () => {
    const { engine, id } = buildGame({ cards: [{ key: "raider", def: character({ name: "Raider", strength: 3 }), owner: P1 }] });
    fight(engine, [id("raider")], { type: "faction", playerId: P2 }, []);
    assert.equal(influence(engine, P2), 22, "3 battle damage cost 3 influence");
  });

  rule("CR 408.3a", "once the faction has 0 influence its owner loses the game", () => {
    const { engine, id } = buildGame({ playerB: { influence: 3 }, cards: [{ key: "z", def: factionZapper("Zapper", 3), owner: P1 }] });
    assert.equal(engine.state.winner, undefined, "nobody has won yet");
    activate(engine, P1, id("z"), "zapOpp");
    assert.equal(influence(engine, P2), 0, "the faction is at 0 influence");
    assert.equal(engine.state.winner, P1, "the opponent won");
  });

  rule("CR 408.3a", "one influence short of 0 is not a loss; the next point is", () => {
    const { engine, id } = buildGame({ playerB: { influence: 3 }, cards: [{ key: "z", def: factionZapper("Zapper", 2), owner: P1 }] });
    activate(engine, P1, id("z"), "zapOpp");
    assert.equal(influence(engine, P2), 1, "1 influence is left");
    assert.equal(engine.state.winner, undefined, "the game goes on");
    activate(engine, P1, id("z"), "zapOpp");
    assert.equal(influence(engine, P2), 0, "now at 0 (never negative)");
    assert.equal(engine.state.winner, P1, "the opponent won");
  });

  rule("CR 408.3a", "damage beyond the faction's influence still leaves 0 and a loss", () => {
    const { engine, id } = buildGame({ playerB: { influence: 3 }, cards: [{ key: "z", def: factionZapper("Zapper", 7), owner: P1 }] });
    activate(engine, P1, id("z"), "zapOpp");
    assert.equal(influence(engine, P2), 0, "influence stops at 0");
    assert.equal(engine.state.winner, P1, "the opponent won");
  });

  rule("CR 408.3a", "damaging your own faction to 0 loses you the game", () => {
    const { engine, id } = buildGame({ playerA: { influence: 2 }, cards: [{ key: "z", def: factionZapper("Zapper", 2), owner: P1 }] });
    activate(engine, P1, id("z"), "zapOwn");
    assert.equal(engine.state.winner, P2, "the other player won");
  });

  rule("CR 408.3a", "losing the last influence to battle damage loses the game", () => {
    const { engine, id } = buildGame({ playerB: { influence: 2 }, cards: [{ key: "raider", def: character({ name: "Raider", strength: 2 }), owner: P1 }] });
    fight(engine, [id("raider")], { type: "faction", playerId: P2 }, []);
    assert.equal(engine.state.winner, P1, "the attacker won");
  });

  rule("CR 408.3b", "Example: 'faction loses 2 influence' is not damage, so 'reduce damage to a faction by 1' does not affect it", () => {
    const board = () =>
      buildGame({
        cards: [
          { key: "loser", def: character({ name: "Loser", behavior: { abilities: [{ id: "go", type: "activated", effects: [{ type: "modifyInfluence", player: "opponent", amount: -2 }] }] } }), owner: P1 },
          { key: "ward", def: aura("Ward", -1, { controller: "self", type: "faction" }), owner: P2 },
          { key: "z", def: factionZapper("Zapper", 2), owner: P1 },
          { key: "w", def: watcher("Watcher"), owner: P2 }
        ]
      });
    const loss = board();
    activate(loss.engine, P1, loss.id("loser"), "go");
    assert.equal(influence(loss.engine, P2), 23, "the faction still loses 2 influence");
    assert.equal(counter(loss.engine, loss.id("w"), "heard"), 0, "and no damage was inflicted, so no damage trigger");

    const damage = board();
    activate(damage.engine, P1, damage.id("z"), "zapOpp");
    assert.equal(influence(damage.engine, P2), 24, "control: 2 damage is reduced to 1 by the same card");
  });

  rule("CR 408.3b", "a damage shield does not absorb an influence loss (it absorbs damage: control)", () => {
    const board = () =>
      buildGame({
        cards: [
          { key: "src", def: character({ name: "Source" }), owner: P1 },
          { key: "guardian", def: character({ name: "Guardian" }), owner: P2 }
        ]
      });
    const loss = board();
    loss.engine.resolveEffect({ type: "preventDamage", target: OWN_FACTION, amount: 5, mode: "reduce" }, ctx(loss.engine, loss.id("guardian"), P2));
    assert.equal(loss.engine.state.damageShields.length, 1, "the shield is up");
    loss.engine.resolveEffect({ type: "modifyInfluence", player: "opponent", amount: -2 }, ctx(loss.engine, loss.id("src"), P1));
    assert.equal(influence(loss.engine, P2), 23, "the influence loss went through the shield untouched");
    assert.equal(loss.engine.state.damageShields.length, 1, "and did not use the shield up");

    const damage = board();
    damage.engine.resolveEffect({ type: "preventDamage", target: OWN_FACTION, amount: 5, mode: "reduce" }, ctx(damage.engine, damage.id("guardian"), P2));
    damage.engine.resolveEffect({ type: "dealDamage", target: OPP_FACTION, amount: 2 }, ctx(damage.engine, damage.id("src"), P1));
    assert.equal(influence(damage.engine, P2), 25, "control: 2 damage is absorbed by the shield");
  });
});

describe("CR 408.4 — lethal damage to a character", () => {
  const board = (life: number, amount: number) =>
    buildGame({
      cards: [
        { key: "z", def: zapper("Zapper", amount), owner: P1 },
        { key: "victim", def: character({ name: "Victim", life }), owner: P2 }
      ]
    });

  rule("CR 408.4", "damage below the character's life leaves it in play with that damage", () => {
    const { engine, id } = board(3, 2);
    activate(engine, P1, id("z"), "zap", id("victim"));
    assert.equal(zoneOf(engine, id("victim")), "play", "it survives");
    assert.equal(damageOf(engine, id("victim")), 2, "carrying 2 damage");
  });

  rule("CR 408.4", "damage equal to the character's life destroys it", () => {
    const { engine, id } = board(3, 3);
    activate(engine, P1, id("z"), "zap", id("victim"));
    assert.equal(zoneOf(engine, id("victim")), "discard", "it was destroyed");
  });

  rule("CR 408.4", "damage greater than the character's life destroys it", () => {
    const { engine, id } = board(3, 5);
    activate(engine, P1, id("z"), "zap", id("victim"));
    assert.equal(zoneOf(engine, id("victim")), "discard", "it was destroyed");
  });

  rule("CR 408.4", "damage received in the same turn adds up: 2 then 1 destroys a life-3 character", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "two", def: zapper("Two", 2), owner: P1 },
        { key: "one", def: zapper("One", 1), owner: P1 },
        { key: "victim", def: character({ name: "Victim", life: 3 }), owner: P2 }
      ]
    });
    activate(engine, P1, id("two"), "zap", id("victim"));
    assert.equal(zoneOf(engine, id("victim")), "play", "after 2 it is alive");
    activate(engine, P1, id("one"), "zap", id("victim"));
    assert.equal(zoneOf(engine, id("victim")), "discard", "the third point destroys it");
  });

  rule("CR 408.4", "it is destroyed immediately: an effect that follows the damage already sees it destroyed", () => {
    const hitter = character({
      name: "Hitter",
      behavior: {
        abilities: [
          {
            id: "hit",
            type: "activated",
            targets: PICK,
            effects: [
              { type: "dealDamage", target: T, amount: 3 },
              { type: "if", condition: { type: "targetInZone", target: T, zone: "discard" }, effects: [{ type: "modifyInfluence", player: "controller", amount: 5 }] }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "hitter", def: hitter, owner: P1 },
        { key: "victim", def: character({ name: "Victim", life: 3 }), owner: P2 }
      ]
    });
    activate(engine, P1, id("hitter"), "hit", id("victim"));
    assert.equal(influence(engine, P1), 30, "the follow-up effect saw the victim already in the discard pile");
  });

  rule("CR 408.4", "a life reduction that brings the life down to the damage destroys the character", () => {
    const shrink = character({
      name: "Shrinker",
      behavior: {
        abilities: [
          { id: "shrink", type: "activated", targets: PICK, effects: [{ type: "createModifier", target: T, stat: "life", operation: "add", value: -1, duration: { type: "untilEndOfTurn" } }] }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "shrink", def: shrink, owner: P1 },
        { key: "victim", def: character({ name: "Victim", life: 3 }), owner: P2, damage: 2 }
      ]
    });
    activate(engine, P1, id("shrink"), "shrink", id("victim"));
    assert.equal(zoneOf(engine, id("victim")), "discard", "2 damage on a life-2 character is lethal");
  });

  rule("CR 408.4", "a character with 0 life carries damage >= life from the start and is destroyed (ruling Q6)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "z", def: zapper("Zapper", 0), owner: P1 },
        { key: "victim", def: character({ name: "Victim", life: 0 }), owner: P2 }
      ]
    });
    activate(engine, P1, id("z"), "zap", id("victim"));
    assert.equal(zoneOf(engine, id("victim")), "discard", "0 damage >= 0 life destroys it");
  });

  rule(["CR 408.4", "CR 408.4a"], "only the current turn's damage counts: damage is healed when a new turn begins, for both players' characters", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "z", def: zapper("Zapper", 2), owner: P1 },
        { key: "mine", def: character({ name: "Mine", life: 3 }), owner: P1 },
        { key: "theirs", def: character({ name: "Theirs", life: 3 }), owner: P2 }
      ]
    });
    activate(engine, P1, id("z"), "zap", id("mine"));
    activate(engine, P1, id("z"), "zap", id("theirs"));
    assert.equal(damageOf(engine, id("mine")), 2, "damaged this turn");
    assert.equal(damageOf(engine, id("theirs")), 2, "damaged this turn");
    passTurn(engine);
    assert.equal(damageOf(engine, id("mine")), 0, "healed when the new turn began");
    assert.equal(damageOf(engine, id("theirs")), 0, "healed when the new turn began");
  });

  rule(["CR 408.4", "CR 408.4a"], "damage from a previous turn does not combine with this turn's: 2 + 2 over two turns does not destroy a life-3 character", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "z", def: zapper("Zapper", 2), owner: P1 },
        { key: "victim", def: character({ name: "Victim", life: 3 }), owner: P2 }
      ]
    });
    activate(engine, P1, id("z"), "zap", id("victim"));
    passTurn(engine);
    passTurn(engine);
    activate(engine, P1, id("z"), "zap", id("victim"));
    assert.equal(zoneOf(engine, id("victim")), "play", "only this turn's 2 damage counts");
    assert.equal(damageOf(engine, id("victim")), 2, "carrying just 2");
  });

  rule("CR 408.4a", "locations are not healed by a new turn (control for the character rule)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "z", def: zapper("Zapper", 2), owner: P1 },
        { key: "fort", def: location({ name: "Fort", structure: 5 }), owner: P2 }
      ]
    });
    activate(engine, P1, id("z"), "zap", id("fort"));
    passTurn(engine);
    assert.equal(damageOf(engine, id("fort")), 2, "the location keeps its damage");
  });
});

describe("CR 408.4b — a replaced destruction reduces the damage from the source of the destruction", () => {
  rule("CR 408.4b", "a character whose lethal-damage destruction is replaced has that damage reduced to 0 and survives", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "z", def: zapper("Zapper", 9), owner: P1 },
        { key: "victim", def: guard("Guard", 3), owner: P2 }
      ]
    });
    activate(engine, P1, id("z"), "zap", id("victim"));
    assert.equal(zoneOf(engine, id("victim")), "play", "the destruction was replaced");
    assert.equal(counter(engine, id("victim"), "shield"), 1, "the replacement happened once");
    assert.equal(damageOf(engine, id("victim")), 0, "the damage from the destroyer was reduced to 0");
  });

  rule(
    "CR 408.4b",
    "only the damage from the source of the destruction is reduced: damage another source dealt earlier stays",
    () => {
      const { engine, id } = buildGame({
        cards: [
          { key: "x", def: zapper("SourceX", 2), owner: P1 },
          { key: "y", def: zapper("SourceY", 2), owner: P1 },
          { key: "victim", def: guard("Guard", 4), owner: P2 }
        ]
      });
      activate(engine, P1, id("x"), "zap", id("victim"));
      assert.equal(damageOf(engine, id("victim")), 2, "2 damage from X");
      activate(engine, P1, id("y"), "zap", id("victim"));
      assert.equal(zoneOf(engine, id("victim")), "play", "Y's damage put it over its limit but the destruction was replaced");
      assert.equal(counter(engine, id("victim"), "shield"), 1, "the replacement happened");
      assert.equal(damageOf(engine, id("victim")), 2, "Y's damage was reduced to 0; X's 2 damage stays");
    }
  );

  rule(
    "CR 408.4b",
    "a replaced destruction that did not come from damage reduces no damage: damage the card already has stays",
    () => {
      const killer = tactic({
        name: "Killer",
        behavior: { abilities: [{ id: "a", type: "activated", targets: PICK, effects: [{ type: "destroy", target: T }] }] }
      });
      const { engine, id } = buildGame({
        cards: [
          { key: "killer", def: killer, owner: P1, zone: "hand" },
          { key: "victim", def: guard("Guard", 4), owner: P2, damage: 1 }
        ]
      });
      engine.perform({ type: "playCard", playerId: P1, cardId: id("killer"), selected: { t: [id("victim")] } });
      resolvePendingResponses(engine);
      assert.equal(counter(engine, id("victim"), "shield"), 1, "the destruction was replaced");
      assert.equal(damageOf(engine, id("victim")), 1, "the destroyer dealt no damage, so none was reduced");
    }
  );
});

describe("CR 408.5 — damage to a location", () => {
  const fortBoard = (structure: number, amount: number, damage = 0) =>
    buildGame({
      cards: [
        { key: "z", def: zapper("Zapper", amount), owner: P1 },
        { key: "fort", def: location({ name: "Fort", structure }), owner: P2, damage }
      ]
    });

  rule("CR 408.5", "damage below the structure leaves the location in play", () => {
    const { engine, id } = fortBoard(3, 2);
    activate(engine, P1, id("z"), "zap", id("fort"));
    assert.equal(zoneOf(engine, id("fort")), "play", "it survives");
  });

  rule("CR 408.5", "damage equal to the structure destroys the location", () => {
    const { engine, id } = fortBoard(3, 3);
    activate(engine, P1, id("z"), "zap", id("fort"));
    assert.equal(zoneOf(engine, id("fort")), "discard", "it was destroyed");
  });

  rule("CR 408.5", "damage greater than the structure destroys the location", () => {
    const { engine, id } = fortBoard(3, 4);
    activate(engine, P1, id("z"), "zap", id("fort"));
    assert.equal(zoneOf(engine, id("fort")), "discard", "it was destroyed");
  });

  rule("CR 408.5", "markers received over several turns add up (they are not cleared by a new turn)", () => {
    const { engine, id } = fortBoard(3, 2);
    activate(engine, P1, id("z"), "zap", id("fort"));
    passTurn(engine);
    passTurn(engine);
    assert.equal(damageOf(engine, id("fort")), 2, "the markers are still there");
    activate(engine, P1, id("z"), "zap", id("fort"));
    assert.equal(zoneOf(engine, id("fort")), "discard", "2 + 2 markers exceed the structure of 3");
  });

  rule("CR 408.5", "a location structure reduced to the damage it has destroys it", () => {
    const shrink = character({
      name: "Shrinker",
      behavior: {
        abilities: [
          { id: "shrink", type: "activated", targets: PICK, effects: [{ type: "createModifier", target: T, stat: "structure", operation: "add", value: -1, duration: { type: "untilEndOfTurn" } }] }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "shrink", def: shrink, owner: P1 },
        { key: "fort", def: location({ name: "Fort", structure: 3 }), owner: P2, damage: 2 }
      ]
    });
    activate(engine, P1, id("shrink"), "shrink", id("fort"));
    assert.equal(zoneOf(engine, id("fort")), "discard", "2 damage on a structure-2 location is lethal");
  });

  rule("CR 408.5b", "removing damage markers lowers the total: the location then survives damage that would have destroyed it", () => {
    const healer = character({
      name: "Healer",
      behavior: { abilities: [{ id: "heal", type: "activated", targets: PICK, effects: [{ type: "healDamage", target: T, amount: 1 }] }] }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "healer", def: healer, owner: P2 },
        { key: "one", def: zapper("One", 1), owner: P1 },
        { key: "fort", def: location({ name: "Fort", structure: 3 }), owner: P2, damage: 2 }
      ]
    });
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    activate(engine, P2, id("healer"), "heal", id("fort"));
    assert.equal(damageOf(engine, id("fort")), 1, "one marker was removed");
    passTurn(engine);
    activate(engine, P1, id("one"), "zap", id("fort"));
    assert.equal(zoneOf(engine, id("fort")), "play", "1 + 1 = 2 markers: still standing (without the heal 2 + 1 would have destroyed it)");
    activate(engine, P1, id("one"), "zap", id("fort"));
    assert.equal(zoneOf(engine, id("fort")), "discard", "the third marker destroys it");
  });

  rule("CR 408.5c", "a location whose destruction is replaced gets none of that damage as markers", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "z", def: zapper("Zapper", 3), owner: P1 },
        { key: "fort", def: guardLocation("Guarded Fort", 3), owner: P2 }
      ]
    });
    activate(engine, P1, id("z"), "zap", id("fort"));
    assert.equal(zoneOf(engine, id("fort")), "play", "the destruction was replaced");
    assert.equal(counter(engine, id("fort"), "shield"), 1, "the replacement happened");
    assert.equal(damageOf(engine, id("fort")), 0, "the location got no markers from that damage");
  });

  rule(
    "CR 408.5c",
    "a replaced location destruction removes only the markers from that source: markers from an earlier source stay",
    () => {
      const { engine, id } = buildGame({
        cards: [
          { key: "x", def: zapper("SourceX", 1), owner: P1 },
          { key: "y", def: zapper("SourceY", 2), owner: P1 },
          { key: "fort", def: guardLocation("Guarded Fort", 3), owner: P2 }
        ]
      });
      activate(engine, P1, id("x"), "zap", id("fort"));
      activate(engine, P1, id("y"), "zap", id("fort"));
      assert.equal(counter(engine, id("fort"), "shield"), 1, "the destruction was replaced");
      assert.equal(damageOf(engine, id("fort")), 1, "Y's 2 markers are gone; X's 1 marker stays");
    }
  );

  rule("CR 408.5d", "damage inflicted to a location gives it that many damage markers", () => {
    const { engine, id } = fortBoard(9, 4);
    activate(engine, P1, id("z"), "zap", id("fort"));
    assert.equal(damageOf(engine, id("fort")), 4, "4 markers");
    activate(engine, P1, id("z"), "zap", id("fort"));
    assert.equal(damageOf(engine, id("fort")), 8, "and 4 more");
  });

  rule("CR 408.5d", "battle damage to a location also gives it markers", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "raider", def: character({ name: "Raider", strength: 2 }), owner: P1 },
        { key: "fort", def: location({ name: "Fort", structure: 9 }), owner: P2 }
      ]
    });
    fight(engine, [id("raider")], { type: "card", cardId: id("fort") }, []);
    assert.equal(damageOf(engine, id("fort")), 2, "2 markers from the battle");
  });

  ruleExempt("CR 408.5a", "Advice on how to track markers physically (pen and paper or a die); the engine's damage counter is covered by CR 408.5d tests.");
});

describe("CR 408.6 — battle damage", () => {
  rule(["CR 408.6", "CR 408.6a"], "damage inflicted in a battle's damage step is battle damage; damage from an effect is not", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "raider", def: character({ name: "Raider", strength: 2 }), owner: P1 },
        { key: "z", def: zapper("Zapper", 1), owner: P1 },
        { key: "victim", def: character({ name: "Victim", life: 9, strength: 0 }), owner: P2 },
        { key: "w", def: watcher("Watcher"), owner: P2 }
      ]
    });
    activate(engine, P1, id("z"), "zap", id("victim"));
    assert.equal(counter(engine, id("w"), "effect"), 1, "an effect's damage is not battle damage");
    assert.equal(counter(engine, id("w"), "battle"), 0, "an effect's damage is not battle damage");
    fight(engine, [id("raider")], { type: "faction", playerId: P2 }, [id("victim")]);
    assert.equal(counter(engine, id("w"), "battle"), 1, "the damage from the battle's damage step is battle damage");
    assert.equal(counter(engine, id("w"), "effect"), 1, "and it is not counted as effect damage");
    assert.deepEqual(dealt(engine).map((event) => Boolean(event.battle)), [false, true], "the damage events are labelled accordingly");
  });

  rule("CR 408.6a", "battle damage works like regular damage: markers on a character, lethal when it reaches the life", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "raider", def: character({ name: "Raider", strength: 2 }), owner: P1 },
        { key: "tough", def: character({ name: "Tough", life: 3, strength: 0 }), owner: P2 },
        { key: "frail", def: character({ name: "Frail", life: 2, strength: 0 }), owner: P2 }
      ]
    });
    fight(engine, [id("raider")], { type: "faction", playerId: P2 }, [id("tough")]);
    assert.equal(damageOf(engine, id("tough")), 2, "2 markers of damage");
    assert.equal(zoneOf(engine, id("tough")), "play", "below its life: it survives");
    const lethal = buildGame({
      cards: [
        { key: "raider", def: character({ name: "Raider", strength: 2 }), owner: P1 },
        { key: "frail", def: character({ name: "Frail", life: 2, strength: 0 }), owner: P2 }
      ]
    });
    fight(lethal.engine, [lethal.id("raider")], { type: "faction", playerId: P2 }, [lethal.id("frail")]);
    assert.equal(zoneOf(lethal.engine, lethal.id("frail")), "discard", "equal to its life: destroyed");
  });

  rule("CR 408.6a", "an all-damage modifier applies to battle damage too, but a battle-only one does not apply to effect damage", () => {
    const board = (battleOnly: boolean) =>
      buildGame({
        cards: [
          { key: "raider", def: character({ name: "Raider", strength: 3 }), owner: P1 },
          { key: "z", def: zapper("Zapper", 3), owner: P1 },
          { key: "victim", def: character({ name: "Victim", life: 9, strength: 0 }), owner: P2 },
          { key: "ward", def: aura("Ward", -1, { controller: "self", type: "character" }, battleOnly), owner: P2, attackEligible: false }
        ]
      });
    const all = board(false);
    fight(all.engine, [all.id("raider")], { type: "faction", playerId: P2 }, [all.id("victim")]);
    assert.equal(damageOf(all.engine, all.id("victim")), 2, "a general reduction reduced the battle damage");

    const only = board(true);
    activate(only.engine, P1, only.id("z"), "zap", only.id("victim"));
    assert.equal(damageOf(only.engine, only.id("victim")), 3, "a battle-only reduction leaves effect damage alone");
    passTurn(only.engine);
    passTurn(only.engine);
    fight(only.engine, [only.id("raider")], { type: "faction", playerId: P2 }, [only.id("victim")]);
    assert.equal(damageOf(only.engine, only.id("victim")), 2, "control: but it reduces battle damage");
  });
});

describe("CR 408.7 — the source of damage", () => {
  const sourcedZapper = (name: string, amount: number) =>
    character({
      name,
      behavior: {
        abilities: [
          { id: "zap", type: "activated", targets: PICK, effects: [{ type: "dealDamage", target: T, amount }] },
          { id: "mine", type: "triggered", event: "damageDealt", condition: { type: "sourceIsDamageSource" }, effects: [{ type: "addCounter", target: "source", counter: "dealt", amount: { type: "eventDamageAmount" } }] }
        ]
      }
    });

  rule("CR 408.7", "a card that instructs you to inflict damage is the source of that damage", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: sourcedZapper("A", 2), owner: P1 },
        { key: "bystander", def: sourcedZapper("Bystander", 1), owner: P1 },
        { key: "victim", def: character({ name: "Victim", life: 9 }), owner: P2 }
      ]
    });
    activate(engine, P1, id("a"), "zap", id("victim"));
    assert.deepEqual(dealt(engine).map((event) => event.sourceId), [id("a")], "the instructing card is the source");
    assert.equal(counter(engine, id("a"), "dealt"), 2, "the source sees that it dealt the damage");
    assert.equal(counter(engine, id("bystander"), "dealt"), 0, "another card does not");
  });

  rule("CR 408.7", "a tactic that instructs damage is the source of it", () => {
    const ping = tactic({ name: "Ping", behavior: { abilities: [{ id: "a", type: "activated", effects: [{ type: "dealDamage", target: OPP_FACTION, amount: 2 }] }] } });
    const { engine, id } = buildGame({ cards: [{ key: "ping", def: ping, owner: P1, zone: "hand" }] });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("ping") });
    resolvePendingResponses(engine);
    assert.deepEqual(dealt(engine).map((event) => event.sourceId), [id("ping")], "the tactic is the source");
    assert.equal(influence(engine, P2), 23, "the damage was inflicted");
  });

  rule("CR 408.7", "for battle damage the source is the character which assigned it, each side's own characters", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "attacker", def: sourcedZapper("Attacker", 0), owner: P1 },
        { key: "blocker", def: sourcedZapper("Blocker", 0), owner: P2 },
        { key: "bystander", def: sourcedZapper("Bystander", 0), owner: P2 }
      ]
    });
    fight(engine, [id("attacker")], { type: "faction", playerId: P2 }, [id("blocker")]);
    const events = dealt(engine);
    assert.ok(events.every((event) => event.battle), "all of it is battle damage");
    const bySource = (source: CardInstanceId) => events.filter((event) => event.sourceId === source).map((event) => event.targetId);
    assert.deepEqual(bySource(id("attacker")), [id("blocker")], "the attacking character is the source of the damage to the blocker");
    assert.deepEqual(bySource(id("blocker")), [id("attacker")], "the blocking character is the source of the damage to the attacker");
    assert.deepEqual(bySource(id("bystander")), [], "a character that took no part is the source of nothing");
    assert.equal(counter(engine, id("attacker"), "dealt"), 1, "the attacker's own source trigger fired");
    assert.equal(counter(engine, id("bystander"), "dealt"), 0, "the bystander's did not");
  });
});

describe("CR 408.8 — destroyed by the damage that put it over its limit", () => {
  const prober = (amount: number) =>
    character({
      name: "Prober",
      behavior: {
        abilities: [
          {
            id: "hit",
            type: "activated",
            targets: PICK,
            effects: [
              { type: "dealDamage", target: T, amount },
              { type: "if", condition: { type: "destroyedByDamage", target: T }, effects: [{ type: "modifyInfluence", player: "controller", amount: 5 }] }
            ]
          }
        ]
      }
    });

  rule("CR 408.8", "Example: a life-4 character with 3 damage that receives 1 more is destroyed by that damage", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "prober", def: prober(1), owner: P1 },
        { key: "victim", def: character({ name: "Victim", life: 4 }), owner: P2, damage: 3 }
      ]
    });
    activate(engine, P1, id("prober"), "hit", id("victim"));
    assert.equal(zoneOf(engine, id("victim")), "discard", "it is destroyed");
    assert.equal(influence(engine, P1), 30, "it was considered destroyed by that damage");
  });

  rule("CR 408.8", "damage that does not put it over its limit does not destroy it (control)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "prober", def: prober(1), owner: P1 },
        { key: "victim", def: character({ name: "Victim", life: 4 }), owner: P2, damage: 2 }
      ]
    });
    activate(engine, P1, id("prober"), "hit", id("victim"));
    assert.equal(zoneOf(engine, id("victim")), "play", "3 damage on a life-4 character");
    assert.equal(influence(engine, P1), 25, "so it was not destroyed by that damage");
  });

  rule("CR 408.8", "a location put over its structure is destroyed by that damage", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "prober", def: prober(1), owner: P1 },
        { key: "fort", def: location({ name: "Fort", structure: 3 }), owner: P2, damage: 2 }
      ]
    });
    activate(engine, P1, id("prober"), "hit", id("fort"));
    assert.equal(zoneOf(engine, id("fort")), "discard", "it is destroyed");
    assert.equal(influence(engine, P1), 30, "by that damage");
  });

  rule("CR 408.8", "a destruction that is not from damage is not 'destroyed by damage'", () => {
    const destroyer = character({
      name: "Destroyer",
      behavior: {
        abilities: [
          {
            id: "kill",
            type: "activated",
            targets: PICK,
            effects: [
              { type: "destroy", target: T },
              { type: "if", condition: { type: "destroyedByDamage", target: T }, effects: [{ type: "modifyInfluence", player: "controller", amount: 5 }] }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "destroyer", def: destroyer, owner: P1 },
        { key: "victim", def: character({ name: "Victim", life: 4 }), owner: P2, damage: 1 }
      ]
    });
    activate(engine, P1, id("destroyer"), "kill", id("victim"));
    assert.equal(zoneOf(engine, id("victim")), "discard", "it was destroyed");
    assert.equal(influence(engine, P1), 25, "but not by damage");
  });
});

describe("CR 408.9 — changing game areas reduces the damage to 0", () => {
  const MOVES = ["hand", "discard", "deck", "void"] as const;

  for (const to of MOVES) {
    rule("CR 408.9", `a damaged character moved from play to the ${to} has no damage`, () => {
      const { engine, id } = buildGame({
        cards: [
          { key: "mover", def: character({ name: "Mover" }), owner: P1 },
          { key: "victim", def: character({ name: "Victim", life: 5 }), owner: P2, damage: 3 }
        ]
      });
      engine.resolveEffect({ type: "moveCard", target: REF(id("victim")), to }, ctx(engine, id("mover")));
      assert.equal(zoneOf(engine, id("victim")), to, `it is in the ${to}`);
      assert.equal(damageOf(engine, id("victim")), 0, "its damage was reduced to 0");
    });
  }

  rule("CR 408.9", "a damaged character removed from the game has no damage", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "mover", def: character({ name: "Mover" }), owner: P1 },
        { key: "victim", def: character({ name: "Victim", life: 5 }), owner: P2, damage: 3 }
      ]
    });
    engine.resolveEffect({ type: "removeFromGame", target: REF(id("victim")) }, ctx(engine, id("mover")));
    assert.equal(zoneOf(engine, id("victim")), "removed", "it left the game");
    assert.equal(damageOf(engine, id("victim")), 0, "its damage was reduced to 0");
  });

  rule("CR 408.9", "a damaged character that is destroyed has no damage in the discard pile", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "mover", def: character({ name: "Mover" }), owner: P1 },
        { key: "victim", def: character({ name: "Victim", life: 5 }), owner: P2, damage: 3 }
      ]
    });
    engine.resolveEffect({ type: "destroy", target: REF(id("victim")) }, ctx(engine, id("mover")));
    assert.equal(zoneOf(engine, id("victim")), "discard", "it was destroyed");
    assert.equal(damageOf(engine, id("victim")), 0, "its damage was reduced to 0");
  });

  rule("CR 408.9", "a character that returns to play after leaving it comes back undamaged", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "mover", def: character({ name: "Mover" }), owner: P1 },
        { key: "victim", def: character({ name: "Victim", life: 5 }), owner: P1, damage: 3 }
      ]
    });
    engine.resolveEffect({ type: "moveCard", target: REF(id("victim")), to: "hand" }, ctx(engine, id("mover")));
    engine.perform({ type: "playCard", playerId: P1, cardId: id("victim") });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("victim")), "play", "it is back in play");
    assert.equal(damageOf(engine, id("victim")), 0, "with no damage");
  });

  rule("CR 408.9", "a location with markers that leaves play has none when it returns", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "mover", def: character({ name: "Mover" }), owner: P1 },
        { key: "fort", def: location({ name: "Fort", structure: 5 }), owner: P1, damage: 3 }
      ]
    });
    engine.resolveEffect({ type: "moveCard", target: REF(id("fort")), to: "hand" }, ctx(engine, id("mover")));
    assert.equal(damageOf(engine, id("fort")), 0, "its markers were removed");
    engine.perform({ type: "playCard", playerId: P1, cardId: id("fort") });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("fort")), "play", "it is back in play");
    assert.equal(damageOf(engine, id("fort")), 0, "with no markers");
  });

  rule("CR 408.9", "flipping a damaged character face-down (it leaves play and re-enters as a resource) clears its damage", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "mover", def: character({ name: "Mover" }), owner: P1 },
        { key: "victim", def: character({ name: "Victim", life: 5 }), owner: P2, damage: 3 }
      ]
    });
    engine.resolveEffect({ type: "flipFaceDown", target: REF(id("victim")) }, ctx(engine, id("mover")));
    assert.equal(engine.state.cards[id("victim")]!.faceDown, true, "it is face-down");
    assert.equal(damageOf(engine, id("victim")), 0, "its damage was reduced to 0");
  });

  rule("CR 408.9", "a card that does not change areas keeps its damage: a change of control is not an area change (control)", () => {
    const steal = character({
      name: "Thief",
      behavior: { abilities: [{ id: "steal", type: "activated", targets: PICK, effects: [{ type: "takeControl", target: T, controller: "controller" }] }] }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "thief", def: steal, owner: P1 },
        { key: "victim", def: character({ name: "Victim", life: 5 }), owner: P2, damage: 3 }
      ]
    });
    activate(engine, P1, id("thief"), "steal", id("victim"));
    assert.equal(engine.state.cards[id("victim")]!.controllerId, P1, "I control it now");
    assert.equal(damageOf(engine, id("victim")), 3, "it is still in play, still damaged");
  });
});
