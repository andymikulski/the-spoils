// Batch r02-battle, part 3 (docs/TESTING.md): CR 609 Resolving a Battle.
// Written from the wording of the Comprehensive Rules, not from the engine.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { BattleDamageAssignment, CardDefinition, CardInstanceId, SpoilsEngine } from "../../../engine.js";
import { autoResolveBattle, buildGame, character, item, location, P1, P2, resolvePendingResponses, tactic } from "../support/fixtures.js";
import { refused, rule } from "./_rule.js";

type Abilities = NonNullable<NonNullable<CardDefinition["behavior"]>["abilities"]>;
type Game = ReturnType<typeof buildGame>;

const FACTION_P2 = { type: "faction", playerId: P2 } as const;
const cardTarget = (cardId: CardInstanceId) => ({ type: "card", cardId }) as const;

function attack(engine: SpoilsEngine, attackers: CardInstanceId[], target: { type: "faction"; playerId: string } | { type: "card"; cardId: CardInstanceId } = FACTION_P2): void {
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: attackers, target });
}

function settle(engine: SpoilsEngine): void {
  for (let guard = 0; engine.state.responseStack.length > 0 && !engine.state.pendingChoice; guard++) {
    assert.ok(guard < 50, "the response stack settles");
    const window = engine.state.responseWindow!;
    if (window.phase === "acceptingResponses") engine.perform({ type: "passPriority", playerId: window.priorityPlayerId });
    else engine.perform({ type: "advanceFlow" });
  }
}

function use(engine: SpoilsEngine, playerId: string, cardId: CardInstanceId, abilityId: string, selected?: Record<string, CardInstanceId[]>): void {
  engine.perform({ type: "activateAbility", playerId, cardId, abilityId, ...(selected ? { selected } : {}) });
  settle(engine);
}

function deploy(engine: SpoilsEngine, playerId: string, cardId: CardInstanceId): void {
  engine.perform({ type: "playCard", playerId, cardId });
  settle(engine);
}

const mark = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId]!.counters.mark ?? 0;

const gadget = (name: string, abilities: Abilities): CardDefinition => item({ name, behavior: { abilities } });

const markSelf = (id: string): Abilities[number] => ({ id, type: "activated", effects: [{ type: "addCounter", target: "source", counter: "mark", amount: 1 }] });

const ping = (name: string): CardDefinition =>
  tactic({ name, behavior: { abilities: [{ id: "a", type: "activated", effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 1 }] }] } });

/** An item whose ability `id` adds `value` to `stat` of the picked character until end of turn. */
const pumper = (name: string, stat: "strength" | "speed" | "life", value: number): CardDefinition =>
  gadget(name, [
    {
      id: "go",
      type: "activated",
      targets: [{ id: "t", selector: { type: "character", zone: "play" }, count: 1 }],
      effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat, operation: "add", value, duration: { type: "untilEndOfTurn" } }]
    }
  ]);

const destroyer = (name: string): CardDefinition =>
  gadget(name, [
    { id: "go", type: "activated", targets: [{ id: "t", selector: { type: "character", zone: "play" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }
  ]);

/** Declares the attack and the blockers, leaving the battle in the pre-damage tactics step. */
function startBattle(game: Game, attackers: string[], blockers: string[], target: Parameters<typeof attack>[2] = FACTION_P2): void {
  attack(game.engine, attackers.map((key) => game.id(key)), target);
  resolvePendingResponses(game.engine);
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: blockers.map((key) => game.id(key)) });
}

/** Both players pass the open response window(s): the battle moves on to the next assignment (or its end). */
const closeWindows = (engine: SpoilsEngine): void => resolvePendingResponses(engine);

/** Both players pass the one open response window and it closes; whatever the battle opens next is left alone. */
function endWindow(engine: SpoilsEngine): void {
  const windowId = engine.state.responseWindow!.id;
  while (engine.state.responseWindow?.id === windowId && engine.state.responseWindow.phase === "acceptingResponses") {
    engine.perform({ type: "passPriority", playerId: engine.state.responseWindow.priorityPlayerId });
  }
  if (engine.state.responseWindow?.id === windowId) engine.perform({ type: "advanceFlow" });
}

const assign = (engine: SpoilsEngine, playerId: string, ...parts: Array<[CardInstanceId, BattleDamageAssignment["target"], number]>): void =>
  engine.perform({ type: "assignBattleDamage", playerId, assignments: parts.map(([sourceId, target, amount]) => ({ sourceId, target, amount })) });

const battleOf = (engine: SpoilsEngine) => engine.state.battle;

/** Plays the rest of the battle out (each source puts its full strength on its first legal target), recording each assignment step. */
function playOut(engine: SpoilsEngine): Array<{ speed: number; phase: string; sources: CardInstanceId[] }> {
  const steps: Array<{ speed: number; phase: string; sources: CardInstanceId[] }> = [];
  closeWindows(engine);
  for (let guard = 0; guard < 40; guard++) {
    const battle = battleOf(engine);
    if (!battle || battle.phase === "finished") break;
    const view = engine.getBattleView()!;
    steps.push({ speed: view.speed!, phase: battle.phase, sources: view.damageSources.map((source) => source.cardId) });
    const parts = view.damageSources
      .filter((source) => source.strength > 0 && source.legalTargets.length > 0)
      .map((source) => ({ sourceId: source.cardId, target: source.legalTargets[0]!, amount: source.strength }));
    engine.perform({ type: "assignBattleDamage", playerId: view.actingPlayerId!, assignments: parts });
    closeWindows(engine);
  }
  return steps;
}

describe("CR 609.1 — the resolution steps, in order", () => {
  rule("CR 609.1", "a battle round runs: tactics, attacker's damage, blocker's damage, tactics, infliction", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 2, life: 5, speed: 1 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 1, life: 5, speed: 1 }), owner: P2 }
      ]
    });
    startBattle({ engine, id }, ["a"], ["b"]);
    assert.equal(battleOf(engine)?.phase, "beforeDamageResponse", "step A: tactics and abilities");
    assert.equal(engine.state.responseWindow?.kind, "battleBeforeDamage");
    closeWindows(engine);
    assert.equal(battleOf(engine)?.phase, "attackerDamageAssignment", "steps B and C: the attacker's damage is assigned");
    assert.equal(engine.getBattleView()?.speed, 1, "at the speed level just found");
    assign(engine, P1, [id("a"), cardTarget(id("b")), 2]);
    assert.equal(battleOf(engine)?.phase, "defenderDamageAssignment", "step D: then the blocker's damage");
    assign(engine, P2, [id("b"), cardTarget(id("a")), 1]);
    assert.equal(battleOf(engine)?.phase, "afterDamageResponse", "step E: tactics and abilities again");
    assert.equal(engine.state.responseWindow?.kind, "battleAfterDamage");
    assert.equal(engine.state.cards[id("b")]!.damage, 0, "nothing has been inflicted yet");
    closeWindows(engine);
    assert.equal(engine.state.cards[id("b")]!.damage, 2, "step F: the damage is inflicted");
    assert.equal(engine.state.cards[id("a")]!.damage, 1, "to both sides");
    assert.equal(battleOf(engine)?.phase, "finished", "steps G and H: nobody is left to assign, so the battle ends");
  });

  rule("CR 609.1", "damage cannot be assigned while tactics and abilities may still be used", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 2 }), owner: P1 },
        { key: "b", def: character({ name: "B", life: 5 }), owner: P2 }
      ]
    });
    startBattle({ engine, id }, ["a"], ["b"]);
    refused(() => assign(engine, P1, [id("a"), cardTarget(id("b")), 2]), "assigning during the pre-damage tactics step", /response window is open/);
    closeWindows(engine);
    assign(engine, P1, [id("a"), cardTarget(id("b")), 2]);
    assert.equal(battleOf(engine)?.attackerAssignments.length, 1, "control: once the step is over the assignment is accepted");
  });
});

describe("CR 609.1a — tactics and abilities before damage", () => {
  const board = () =>
    buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 1 }), owner: P1 },
        { key: "b", def: character({ name: "B", life: 9 }), owner: P2 },
        { key: "g1", def: gadget("Gadget1", [markSelf("go")]), owner: P1 },
        { key: "g2", def: gadget("Gadget2", [markSelf("go")]), owner: P2 },
        { key: "t1", def: ping("Ping1"), owner: P1, zone: "hand" },
        { key: "t2", def: ping("Ping2"), owner: P1, zone: "hand" },
        { key: "t3", def: ping("Ping3"), owner: P2, zone: "hand" },
        { key: "t4", def: ping("Ping4"), owner: P2, zone: "hand" }
      ]
    });

  rule("CR 609.1a", "the attacking player may deploy tactics and use abilities as many times as they want, first", () => {
    const game = board();
    const { engine, id } = game;
    const before = engine.state.players[P2].influence;
    startBattle(game, ["a"], ["b"]);
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "the attacker holds the window first");
    refused(() => engine.perform({ type: "activateAbility", playerId: P2, cardId: id("g2"), abilityId: "go" }), "the defender acting before the attacker finishes", /timing|priority/);
    for (let n = 1; n <= 3; n++) {
      use(engine, P1, id("g1"), "go");
      assert.equal(mark(engine, id("g1")), n, `ability use ${n}`);
    }
    deploy(engine, P1, id("t1"));
    deploy(engine, P1, id("t2"));
    assert.equal(engine.state.players[P2].influence, before - 2, "and two tactics");
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "the attacker still holds the window");
  });

  rule("CR 609.1a", "then the defending player may deploy tactics and use abilities as many times as they want", () => {
    const game = board();
    const { engine, id } = game;
    const before = engine.state.players[P1].influence;
    startBattle(game, ["a"], ["b"]);
    engine.perform({ type: "passPriority", playerId: P1 });
    refused(() => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("g1"), abilityId: "go" }), "the attacker acting after passing", /timing|priority/);
    for (let n = 1; n <= 3; n++) {
      use(engine, P2, id("g2"), "go");
      assert.equal(mark(engine, id("g2")), n, `ability use ${n}`);
    }
    deploy(engine, P2, id("t3"));
    deploy(engine, P2, id("t4"));
    assert.equal(engine.state.players[P1].influence, before - 2, "and two tactics");
    assert.equal(battleOf(engine)?.phase, "beforeDamageResponse", "the damage has not been assigned yet");
  });

  rule("CR 609.1a", "every speed level begins with its own round of tactics and abilities, attacker first", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "fast", def: character({ name: "Fast", strength: 1, speed: 2 }), owner: P1 },
        { key: "slow", def: character({ name: "Slow", strength: 1, speed: 1 }), owner: P1 },
        { key: "b", def: character({ name: "B", life: 9, speed: 0 }), owner: P2 },
        { key: "g1", def: gadget("Gadget1", [markSelf("go")]), owner: P1 }
      ]
    });
    startBattle({ engine, id }, ["fast", "slow"], ["b"]);
    closeWindows(engine);
    assert.equal(engine.getBattleView()?.speed, 2, "the speed-2 round");
    assign(engine, P1, [id("fast"), cardTarget(id("b")), 1]);
    endWindow(engine);
    assert.equal(battleOf(engine)?.phase, "beforeDamageResponse", "the next speed level opens another tactics step");
    assert.equal(engine.state.responseWindow?.kind, "battleBeforeDamage");
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "attacker first again");
    use(engine, P1, id("g1"), "go");
    assert.equal(mark(engine, id("g1")), 1, "and the attacker can use an ability in it");
  });
});

describe("CR 609.1b — speed level", () => {
  rule("CR 609.1b", "X is the highest speed among characters that have not assigned: the rounds run from fastest to slowest across both parties", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a1", def: character({ name: "A1", strength: 1, life: 9, speed: 3 }), owner: P1 },
        { key: "a2", def: character({ name: "A2", strength: 1, life: 9, speed: 1 }), owner: P1 },
        { key: "b1", def: character({ name: "B1", strength: 1, life: 9, speed: 2 }), owner: P2 }
      ]
    });
    startBattle({ engine, id }, ["a1", "a2"], ["b1"]);
    const steps = playOut(engine);
    assert.deepEqual(
      steps.map((step) => [step.speed, step.phase, step.sources]),
      [
        [3, "attackerDamageAssignment", [id("a1")]],
        [2, "defenderDamageAssignment", [id("b1")]],
        [1, "attackerDamageAssignment", [id("a2")]]
      ],
      "speed 3 (attacker), then 2 (the blocker), then 1 (the other attacker)"
    );
  });

  rule("CR 609.1b", "characters that have already assigned are not considered: X drops after the fastest has assigned", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 1, life: 9, speed: 4 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 1, life: 9, speed: 1 }), owner: P2 }
      ]
    });
    startBattle({ engine, id }, ["a"], ["b"]);
    closeWindows(engine);
    assert.equal(engine.getBattleView()?.speed, 4, "the fastest character's level first");
    assign(engine, P1, [id("a"), cardTarget(id("b")), 1]);
    closeWindows(engine);
    assert.equal(engine.getBattleView()?.speed, 1, "then the highest speed among those that have not assigned");
    assert.deepEqual(engine.getBattleView()?.damageSources.map((source) => source.cardId), [id("b")], "the character that already assigned is not a source again");
  });

  rule("CR 609.1b", "the fastest character may be a blocker: then only the defender assigns in the first round", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 1, life: 9, speed: 1 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 2, life: 9, speed: 3 }), owner: P2 }
      ]
    });
    startBattle({ engine, id }, ["a"], ["b"]);
    closeWindows(engine);
    assert.equal(battleOf(engine)?.phase, "defenderDamageAssignment", "no attacker has speed 3, so the defender goes alone");
    assert.equal(engine.getBattleView()?.speed, 3);
    assert.equal(engine.getBattleView()?.actingPlayerId, P2);
  });

  rule("CR 609.1b", "X is found after the tactics step: a speed change in it changes which characters assign first", () => {
    const build = () =>
      buildGame({
        cards: [
          { key: "a", def: character({ name: "A", strength: 1, life: 9, speed: 2 }), owner: P1 },
          { key: "b", def: character({ name: "B", strength: 1, life: 9, speed: 1 }), owner: P2 },
          { key: "up", def: pumper("Speed Up", "speed", 5), owner: P1 }
        ]
      });
    const control = build();
    startBattle(control, ["a"], ["b"]);
    closeWindows(control.engine);
    assert.equal(control.engine.getBattleView()?.speed, 2, "control: without a change the attacker (speed 2) goes first");
    assert.equal(battleOf(control.engine)?.phase, "attackerDamageAssignment");

    const { engine, id } = build();
    startBattle({ engine, id }, ["a"], ["b"]);
    use(engine, P1, id("up"), "go", { t: [id("b")] });
    closeWindows(engine);
    assert.equal(engine.getBattleView()?.speed, 6, "the blocker pumped to speed 6 sets X");
    assert.equal(battleOf(engine)?.phase, "defenderDamageAssignment", "so the blocker assigns first");
  });

  rule("CR 609.1b", "a character with speed 0 still assigns, at level 0 after the faster ones", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 1, life: 9, speed: 0 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 1, life: 9, speed: 2 }), owner: P2 }
      ]
    });
    startBattle({ engine, id }, ["a"], ["b"]);
    const steps = playOut(engine);
    assert.deepEqual(steps.map((step) => step.speed), [2, 0], "level 2 then level 0");
    assert.equal(engine.state.cards[id("b")]!.damage, 1, "the speed-0 character dealt its damage");
  });

  rule("CR 609.1b", "characters of equal speed share a level, wherever they are", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a1", def: character({ name: "A1", strength: 1, life: 9, speed: 2 }), owner: P1 },
        { key: "a2", def: character({ name: "A2", strength: 1, life: 9, speed: 2 }), owner: P1 },
        { key: "b1", def: character({ name: "B1", strength: 1, life: 9, speed: 2 }), owner: P2 }
      ]
    });
    startBattle({ engine, id }, ["a1", "a2"], ["b1"]);
    const steps = playOut(engine);
    assert.deepEqual(
      steps.map((step) => [step.speed, step.phase, [...step.sources].sort()]),
      [
        [2, "attackerDamageAssignment", [id("a1"), id("a2")].sort()],
        [2, "defenderDamageAssignment", [id("b1")]]
      ],
      "one level: both attackers, then the blocker"
    );
    assert.equal(battleOf(engine)?.rounds.length, 1, "in a single round");
  });
});

describe("CR 609.1c — assign attacker's damage", () => {
  const duel = (strength: number) =>
    buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength, life: 9, speed: 2 }), owner: P1 },
        { key: "b1", def: character({ name: "B1", strength: 0, life: 9, speed: 1 }), owner: P2 },
        { key: "b2", def: character({ name: "B2", strength: 0, life: 9, speed: 1 }), owner: P2 },
        { key: "bystander", def: character({ name: "Bystander", strength: 0, life: 9, speed: 1 }), owner: P2 }
      ]
    });
  const open = (game: Game, blockers: string[]) => {
    startBattle(game, ["a"], blockers);
    closeWindows(game.engine);
  };

  rule("CR 609.1c", "an attacker assigns damage equal to its strength, divided however the attacking player wants, among the blocking party", () => {
    for (const [first, second] of [[2, 3], [4, 1], [1, 4], [5, 0]]) {
      const game = duel(5);
      const { engine, id } = game;
      open(game, ["b1", "b2"]);
      const parts: Array<[CardInstanceId, BattleDamageAssignment["target"], number]> = [[id("a"), cardTarget(id("b1")), first!]];
      if (second) parts.push([id("a"), cardTarget(id("b2")), second]);
      assign(engine, P1, ...parts);
      autoResolveBattle(engine);
      assert.equal(engine.state.cards[id("b1")]!.damage, first, `split ${first}/${second}: first blocker`);
      assert.equal(engine.state.cards[id("b2")]!.damage, second, `split ${first}/${second}: second blocker`);
    }
  });

  rule("CR 609.1c", "the damage assigned must be exactly the attacker's strength: one too few and one too many are refused", () => {
    const attempt = (amounts: number[]) => {
      const game = duel(5);
      open(game, ["b1", "b2"]);
      const { engine, id } = game;
      const targets = [id("b1"), id("b2")];
      assign(engine, P1, ...amounts.map((amount, index) => [id("a"), cardTarget(targets[index]!), amount] as [CardInstanceId, BattleDamageAssignment["target"], number]));
    };
    refused(() => attempt([2, 2]), "assigning 4 of 5", /must assign exactly 5/);
    refused(() => attempt([3, 3]), "assigning 6 of 5", /must assign exactly 5/);
    refused(() => attempt([]), "assigning nothing", /must assign exactly 5/);
    attempt([3, 2]);
  });

  rule("CR 609.1c", "attackers assign to the blocking party: not to the faction, to their own characters, or to a character that did not block", () => {
    const attempt = (target: (id: Game["id"]) => BattleDamageAssignment["target"]) => {
      const game = duel(2);
      open(game, ["b1"]);
      assign(game.engine, P1, [game.id("a"), target(game.id), 2]);
      return game;
    };
    refused(() => attempt(() => FACTION_P2), "the faction while a blocking party stands", /Illegal battle-damage target/);
    refused(() => attempt((id) => cardTarget(id("a"))), "the attacker's own character", /Illegal battle-damage target/);
    refused(() => attempt((id) => cardTarget(id("bystander"))), "a character that did not block", /Illegal battle-damage target/);
    const game = attempt((id) => cardTarget(id("b1")));
    assert.equal(battleOf(game.engine)?.attackerAssignments[0]?.amount, 2, "control: the blocker is a legal target");
  });

  rule("CR 609.1c", "all attackers of speed X assign, each its own strength", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a1", def: character({ name: "A1", strength: 2, speed: 2 }), owner: P1 },
        { key: "a2", def: character({ name: "A2", strength: 3, speed: 2 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 0, life: 9, speed: 1 }), owner: P2 }
      ]
    });
    startBattle({ engine, id }, ["a1", "a2"], ["b"]);
    closeWindows(engine);
    assert.deepEqual(engine.getBattleView()?.damageSources.map((source) => source.cardId).sort(), [id("a1"), id("a2")].sort(), "both are sources in this round");
    refused(() => assign(engine, P1, [id("a1"), cardTarget(id("b")), 2]), "assigning for only one of the two attackers", /must assign exactly 3/);
    assign(engine, P1, [id("a1"), cardTarget(id("b")), 2], [id("a2"), cardTarget(id("b")), 3]);
    autoResolveBattle(engine);
    assert.equal(engine.state.cards[id("b")]!.damage, 5, "both attackers' damage landed");
  });

  rule("CR 609.1c", "attackers of another speed do not assign in this round", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "fast", def: character({ name: "Fast", strength: 2, speed: 3 }), owner: P1 },
        { key: "slow", def: character({ name: "Slow", strength: 3, speed: 1 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 0, life: 9, speed: 0 }), owner: P2 }
      ]
    });
    startBattle({ engine, id }, ["fast", "slow"], ["b"]);
    closeWindows(engine);
    refused(
      () => assign(engine, P1, [id("fast"), cardTarget(id("b")), 2], [id("slow"), cardTarget(id("b")), 3]),
      "assigning for an attacker whose speed is below X",
      /not part of the current speed group/
    );
    assign(engine, P1, [id("fast"), cardTarget(id("b")), 2]);
    assert.equal(battleOf(engine)?.attackerAssignments.length, 1, "control: only the speed-3 attacker assigned");
  });

  rule("CR 609.1c", "the attacking player makes the attackers' assignment, not the defender", () => {
    const game = duel(2);
    open(game, ["b1"]);
    refused(() => assign(game.engine, P2, [game.id("a"), cardTarget(game.id("b1")), 2]), "the defender assigning the attacker's damage", /not this player's damage assignment/);
    assign(game.engine, P1, [game.id("a"), cardTarget(game.id("b1")), 2]);
    assert.equal(battleOf(game.engine)?.attackerAssignments.length, 1, "control: the attacking player can");
  });

  rule("CR 609.1c", "if there are no members left in the blocking party the attacker assigns to the target of the attack: a faction", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "fast", def: character({ name: "Fast", strength: 5, speed: 3 }), owner: P1 },
        { key: "slow", def: character({ name: "Slow", strength: 2, speed: 1 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 1, life: 2, speed: 1 }), owner: P2 }
      ]
    });
    const before = engine.state.players[P2].influence;
    startBattle({ engine, id }, ["fast", "slow"], ["b"]);
    closeWindows(engine);
    assign(engine, P1, [id("fast"), cardTarget(id("b")), 5]);
    closeWindows(engine);
    assert.equal(engine.state.cards[id("b")]!.zone, "discard", "the only blocker died in the first round");
    assert.equal(battleOf(engine)?.phase, "attackerDamageAssignment", "the slow attacker assigns next");
    assert.deepEqual(engine.getBattleView()?.damageSources[0]?.legalTargets, [FACTION_P2], "its only legal target is the attacked faction");
    refused(() => assign(engine, P1, [id("slow"), cardTarget(id("b")), 2]), "assigning to the dead blocker", /Illegal battle-damage target/);
    assign(engine, P1, [id("slow"), FACTION_P2, 2]);
    closeWindows(engine);
    assert.equal(engine.state.players[P2].influence, before - 2, "the faction lost influence equal to the damage");
  });

  rule("CR 609.1c", "if there are no members left in the blocking party the attacker assigns to the target of the attack: a location", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "fast", def: character({ name: "Fast", strength: 5, speed: 3 }), owner: P1 },
        { key: "slow", def: character({ name: "Slow", strength: 2, speed: 1 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 1, life: 2, speed: 1 }), owner: P2 },
        { key: "fort", def: location({ name: "Fort", structure: 9 }), owner: P2 }
      ]
    });
    startBattle({ engine, id }, ["fast", "slow"], ["b"], cardTarget(id("fort")));
    closeWindows(engine);
    refused(() => assign(engine, P1, [id("fast"), cardTarget(id("fort")), 5]), "the location while the blocker stands", /Illegal battle-damage target/);
    assign(engine, P1, [id("fast"), cardTarget(id("b")), 5]);
    closeWindows(engine);
    assert.deepEqual(engine.getBattleView()?.damageSources[0]?.legalTargets, [cardTarget(id("fort"))], "the location is now the only legal target");
    assign(engine, P1, [id("slow"), cardTarget(id("fort")), 2]);
    closeWindows(engine);
    assert.equal(engine.state.cards[id("fort")]!.damage, 2, "the location took the damage");
  });

  rule("CR 609.1c", "with no blocking party at all the attackers assign to the target", () => {
    const { engine, id } = buildGame({ cards: [{ key: "a", def: character({ name: "A", strength: 3 }), owner: P1 }] });
    startBattle({ engine, id }, ["a"], []);
    closeWindows(engine);
    assert.deepEqual(engine.getBattleView()?.damageSources[0]?.legalTargets, [FACTION_P2], "the faction is the only target");
    assign(engine, P1, [id("a"), FACTION_P2, 3]);
    assert.equal(battleOf(engine)?.attackerAssignments[0]?.amount, 3);
  });

  rule("CR 609.1c", "the damage equals the attacker's strength as it stands when damage is assigned, after any change in the tactics step", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 2, speed: 2 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 0, life: 9, speed: 1 }), owner: P2 },
        { key: "up", def: pumper("Strength Up", "strength", 3), owner: P1 }
      ]
    });
    startBattle({ engine, id }, ["a"], ["b"]);
    use(engine, P1, id("up"), "go", { t: [id("a")] });
    closeWindows(engine);
    assert.equal(engine.getBattleView()?.damageSources[0]?.strength, 5, "the view reports the new strength");
    refused(() => assign(engine, P1, [id("a"), cardTarget(id("b")), 2]), "assigning the old strength", /must assign exactly 5/);
    assign(engine, P1, [id("a"), cardTarget(id("b")), 5]);
    autoResolveBattle(engine);
    assert.equal(engine.state.cards[id("b")]!.damage, 5);
  });

  rule("CR 609.1c", "a character with 0 strength assigns no damage but has assigned", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 0, speed: 1 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 0, life: 9, speed: 1 }), owner: P2 }
      ]
    });
    startBattle({ engine, id }, ["a"], ["b"]);
    closeWindows(engine);
    assert.equal(engine.getBattleView()?.damageSources[0]?.cardId, id("a"), "the character is still a source for its level");
    assign(engine, P1);
    assert.ok(battleOf(engine)?.assignedDamageBy.includes(id("a")), "and counts as having assigned");
    autoResolveBattle(engine);
    assert.equal(engine.state.cards[id("b")]!.damage, 0, "no damage was dealt");
  });
});

describe("CR 609.1d — assign blocker's damage", () => {
  const brawl = () =>
    buildGame({
      cards: [
        { key: "a1", def: character({ name: "A1", strength: 0, life: 9, speed: 1 }), owner: P1 },
        { key: "a2", def: character({ name: "A2", strength: 0, life: 9, speed: 1 }), owner: P1 },
        { key: "idle", def: character({ name: "Idle", strength: 0, life: 9, speed: 1 }), owner: P1 },
        { key: "b1", def: character({ name: "B1", strength: 4, life: 9, speed: 1 }), owner: P2 },
        { key: "b2", def: character({ name: "B2", strength: 2, life: 9, speed: 1 }), owner: P2 }
      ]
    });
  /** Both attackers have no damage to assign; the defender is up. */
  const defenderTurn = (blockers: string[]) => {
    const game = brawl();
    startBattle(game, ["a1", "a2"], blockers);
    closeWindows(game.engine);
    assign(game.engine, P1);
    return game;
  };

  rule("CR 609.1d", "a blocker assigns damage equal to its strength, divided however the defending player wants, among the attacking party", () => {
    for (const [first, second] of [[1, 3], [3, 1], [4, 0]]) {
      const { engine, id } = defenderTurn(["b1"]);
      assert.equal(battleOf(engine)?.phase, "defenderDamageAssignment", "the defender is assigning");
      const parts: Array<[CardInstanceId, BattleDamageAssignment["target"], number]> = [[id("b1"), cardTarget(id("a1")), first!]];
      if (second) parts.push([id("b1"), cardTarget(id("a2")), second]);
      assign(engine, P2, ...parts);
      closeWindows(engine);
      assert.equal(engine.state.cards[id("a1")]!.damage, first, `split ${first}/${second}: first attacker`);
      assert.equal(engine.state.cards[id("a2")]!.damage, second, `split ${first}/${second}: second attacker`);
    }
  });

  rule("CR 609.1d", "the blocker's assignment must total its strength exactly", () => {
    const attempt = (amounts: number[]) => {
      const { engine, id } = defenderTurn(["b1"]);
      assign(engine, P2, ...amounts.map((amount, index) => [id("b1"), cardTarget(id(index === 0 ? "a1" : "a2")), amount] as [CardInstanceId, BattleDamageAssignment["target"], number]));
    };
    refused(() => attempt([1, 2]), "assigning 3 of 4", /must assign exactly 4/);
    refused(() => attempt([3, 2]), "assigning 5 of 4", /must assign exactly 4/);
    attempt([2, 2]);
  });

  rule("CR 609.1d", "blockers assign to the attacking party only: not to the target of the attack, their own side, or an attacker-side character that did not attack", () => {
    const attempt = (target: (id: Game["id"]) => BattleDamageAssignment["target"]) => {
      const game = defenderTurn(["b1"]);
      assign(game.engine, P2, [game.id("b1"), target(game.id), 4]);
    };
    refused(() => attempt(() => ({ type: "faction", playerId: P1 })), "the attacking player's faction", /Illegal battle-damage target/);
    refused(() => attempt((id) => cardTarget(id("b2"))), "a character of its own side", /Illegal battle-damage target/);
    refused(() => attempt((id) => cardTarget(id("idle"))), "a character that did not attack", /Illegal battle-damage target/);
    attempt((id) => cardTarget(id("a1")));
  });

  rule("CR 609.1d", "the defending player makes the blockers' assignment, not the attacker", () => {
    const game = defenderTurn(["b1"]);
    refused(() => assign(game.engine, P1, [game.id("b1"), cardTarget(game.id("a1")), 4]), "the attacking player assigning the blocker's damage", /not this player's damage assignment/);
    assign(game.engine, P2, [game.id("b1"), cardTarget(game.id("a1")), 4]);
    assert.equal(battleOf(game.engine)?.defenderAssignments[0]?.amount, 4, "control: the defender can");
  });

  rule("CR 609.1d", "all blockers of speed X assign, each its own strength", () => {
    const { engine, id } = defenderTurn(["b1", "b2"]);
    assert.deepEqual(engine.getBattleView()?.damageSources.map((source) => source.cardId).sort(), [id("b1"), id("b2")].sort(), "both blockers are sources");
    refused(() => assign(engine, P2, [id("b1"), cardTarget(id("a1")), 4]), "assigning for only one of the two blockers", /must assign exactly 2/);
    assign(engine, P2, [id("b1"), cardTarget(id("a1")), 4], [id("b2"), cardTarget(id("a1")), 2]);
    closeWindows(engine);
    assert.equal(engine.state.cards[id("a1")]!.damage, 6, "both blockers' damage landed");
  });

  rule("CR 609.1d", "blockers of another speed do not assign in this round", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 0, life: 9, speed: 0 }), owner: P1 },
        { key: "fast", def: character({ name: "Fast", strength: 2, life: 9, speed: 3 }), owner: P2 },
        { key: "slow", def: character({ name: "Slow", strength: 3, life: 9, speed: 1 }), owner: P2 }
      ]
    });
    startBattle({ engine, id }, ["a"], ["fast", "slow"]);
    closeWindows(engine);
    refused(() => assign(engine, P2, [id("fast"), cardTarget(id("a")), 2], [id("slow"), cardTarget(id("a")), 3]), "assigning for a blocker below X", /not part of the current speed group/);
    assign(engine, P2, [id("fast"), cardTarget(id("a")), 2]);
    assert.equal(battleOf(engine)?.defenderAssignments.length, 1, "control: only the speed-3 blocker assigned");
  });

  rule("CR 609.1d", "the attacker's damage is assigned before the blocker's damage at the same speed", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 1, life: 9, speed: 2 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 1, life: 9, speed: 2 }), owner: P2 }
      ]
    });
    startBattle({ engine, id }, ["a"], ["b"]);
    closeWindows(engine);
    assert.equal(battleOf(engine)?.phase, "attackerDamageAssignment", "attacker first");
    refused(() => assign(engine, P2, [id("b"), cardTarget(id("a")), 1]), "the blocker assigning first", /not this player's damage assignment/);
    assign(engine, P1, [id("a"), cardTarget(id("b")), 1]);
    assert.equal(battleOf(engine)?.phase, "defenderDamageAssignment", "then the defender");
  });
});

describe("CR 609.1e — tactics and abilities after assignment", () => {
  const duel = () =>
    buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 2, life: 9, speed: 1 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 0, life: 3, speed: 1 }), owner: P2 },
        { key: "g1", def: gadget("Gadget1", [markSelf("go")]), owner: P1 },
        { key: "g2", def: gadget("Gadget2", [markSelf("go")]), owner: P2 },
        { key: "t1", def: ping("Ping1"), owner: P1, zone: "hand" },
        { key: "t3", def: ping("Ping3"), owner: P2, zone: "hand" },
        { key: "life", def: pumper("Life Up", "life", 5), owner: P2 },
        { key: "str", def: pumper("Strength Up", "strength", 4), owner: P1 },
        { key: "kill", def: destroyer("Killer"), owner: P2 }
      ]
    });
  const toAfterDamage = (game: Game) => {
    startBattle(game, ["a"], ["b"]);
    closeWindows(game.engine);
    assign(game.engine, P1, [game.id("a"), cardTarget(game.id("b")), 2]);
    assign(game.engine, P2);
    assert.equal(game.engine.state.responseWindow?.kind, "battleAfterDamage", "the post-assignment window is open");
  };

  rule("CR 609.1e", "the attacking player may deploy tactics and use abilities as many times as they want, then the defending player may do the same", () => {
    const game = duel();
    const { engine, id } = game;
    toAfterDamage(game);
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "the attacker first");
    refused(() => engine.perform({ type: "activateAbility", playerId: P2, cardId: id("g2"), abilityId: "go" }), "the defender acting first", /timing|priority/);
    use(engine, P1, id("g1"), "go");
    use(engine, P1, id("g1"), "go");
    deploy(engine, P1, id("t1"));
    assert.equal(mark(engine, id("g1")), 2, "two ability uses");
    engine.perform({ type: "passPriority", playerId: P1 });
    use(engine, P2, id("g2"), "go");
    use(engine, P2, id("g2"), "go");
    deploy(engine, P2, id("t3"));
    assert.equal(mark(engine, id("g2")), 2, "the defender's two ability uses");
  });

  rule("CR 609.1e", "what is done in this step happens before the assigned damage is inflicted", () => {
    const game = duel();
    const { engine, id } = game;
    toAfterDamage(game);
    assert.equal(engine.state.cards[id("b")]!.damage, 0, "not inflicted yet");
    engine.perform({ type: "passPriority", playerId: P1 });
    use(engine, P2, id("life"), "go", { t: [id("b")] });
    closeWindows(engine);
    assert.equal(engine.state.cards[id("b")]!.damage, 2, "the damage landed after the life boost");
    assert.equal(engine.state.cards[id("b")]!.zone, "play", "so the blocker (life 3 + 5) survived 2 damage");
  });

  rule("CR 609.1e", "assigned damage stays as assigned: a strength boost in this step does not enlarge it", () => {
    const game = duel();
    const { engine, id } = game;
    toAfterDamage(game);
    use(engine, P1, id("str"), "go", { t: [id("a")] });
    assert.equal(engine.getStat(id("a"), "strength"), 6, "the attacker is stronger now");
    closeWindows(engine);
    assert.equal(engine.state.cards[id("b")]!.damage, 2, "but it assigned 2 and 2 is what lands");
  });

  rule("CR 609.1f", "assigned damage is still inflicted when its source leaves play after assigning", () => {
    const game = duel();
    const { engine, id } = game;
    toAfterDamage(game);
    engine.perform({ type: "passPriority", playerId: P1 });
    use(engine, P2, id("kill"), "go", { t: [id("a")] });
    assert.equal(engine.state.cards[id("a")]!.zone, "discard", "the attacker was destroyed in response");
    closeWindows(engine);
    assert.equal(engine.state.cards[id("b")]!.damage, 2, "all assigned battle damage is inflicted");
  });
});

describe("CR 609.1f — damage infliction", () => {
  rule("CR 609.1f", "all assigned battle damage is inflicted simultaneously: two characters destroy each other", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 3, life: 3, speed: 1 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 3, life: 3, speed: 1 }), owner: P2 }
      ]
    });
    startBattle({ engine, id }, ["a"], ["b"]);
    autoResolveBattle(engine);
    assert.equal(engine.state.cards[id("a")]!.zone, "discard", "A took B's damage even though B died too");
    assert.equal(engine.state.cards[id("b")]!.zone, "discard", "B took A's damage even though A died too");
  });

  rule("CR 609.1f", "damage from several characters to the same character is a single amount: they add up to destroy it", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a1", def: character({ name: "A1", strength: 2, speed: 1 }), owner: P1 },
        { key: "a2", def: character({ name: "A2", strength: 2, speed: 1 }), owner: P1 },
        { key: "a3", def: character({ name: "A3", strength: 2, speed: 1 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 0, life: 6, speed: 1 }), owner: P2 }
      ]
    });
    startBattle({ engine, id }, ["a1", "a2", "a3"], ["b"]);
    autoResolveBattle(engine);
    assert.equal(engine.state.cards[id("b")]!.zone, "discard", "2 + 2 + 2 is lethal to a life-6 character");
  });

  rule("CR 609.1f", "damage from several characters to the same faction is a single amount of influence loss", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a1", def: character({ name: "A1", strength: 3 }), owner: P1 },
        { key: "a2", def: character({ name: "A2", strength: 4 }), owner: P1 }
      ]
    });
    const before = engine.state.players[P2].influence;
    startBattle({ engine, id }, ["a1", "a2"], []);
    autoResolveBattle(engine);
    assert.equal(engine.state.players[P2].influence, before - 7, "3 + 4 influence lost");
  });

  rule("CR 609.1f", "damage from several characters to the same location is a single amount", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a1", def: character({ name: "A1", strength: 3 }), owner: P1 },
        { key: "a2", def: character({ name: "A2", strength: 4 }), owner: P1 },
        { key: "fort", def: location({ name: "Fort", structure: 7 }), owner: P2 }
      ]
    });
    startBattle({ engine, id }, ["a1", "a2"], [], cardTarget(id("fort")));
    autoResolveBattle(engine);
    assert.equal(engine.state.cards[id("fort")]!.zone, "discard", "3 + 4 destroys a structure-7 location");
  });

  rule("CR 609.1f", "the sum is inflicted as a single amount: a reduction of 1 applies once to the total, not once per source", () => {
    const warded = character({
      name: "Warded",
      strength: 0,
      life: 20,
      speed: 1,
      behavior: { abilities: [{ id: "ward", type: "continuous", modifiers: [], damageModifiers: [{ selector: { controller: "self", type: "character" }, battleOnly: true, delta: -1 }] }] }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "a1", def: character({ name: "A1", strength: 3, speed: 1 }), owner: P1 },
        { key: "a2", def: character({ name: "A2", strength: 3, speed: 1 }), owner: P1 },
        { key: "b", def: warded, owner: P2 }
      ]
    });
    startBattle({ engine, id }, ["a1", "a2"], ["b"]);
    autoResolveBattle(engine);
    assert.equal(engine.state.cards[id("b")]!.damage, 5, "(3 + 3) - 1 = 5, not (3 - 1) + (3 - 1) = 4");
  });

  rule("CR 609.1f", "damage to different things in one step is inflicted together", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a1", def: character({ name: "A1", strength: 4, life: 9, speed: 1 }), owner: P1 },
        { key: "a2", def: character({ name: "A2", strength: 0, life: 9, speed: 1 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 3, life: 9, speed: 1 }), owner: P2 }
      ]
    });
    startBattle({ engine, id }, ["a1", "a2"], ["b"]);
    closeWindows(engine);
    assign(engine, P1, [id("a1"), cardTarget(id("b")), 4]);
    assign(engine, P2, [id("b"), cardTarget(id("a1")), 1], [id("b"), cardTarget(id("a2")), 2]);
    assert.equal(engine.state.cards[id("a1")]!.damage + engine.state.cards[id("a2")]!.damage + engine.state.cards[id("b")]!.damage, 0, "nothing is inflicted until the step ends");
    closeWindows(engine);
    assert.equal(engine.state.cards[id("b")]!.damage, 4);
    assert.equal(engine.state.cards[id("a1")]!.damage, 1);
    assert.equal(engine.state.cards[id("a2")]!.damage, 2);
  });
});

describe("CR 609.1g — repeat", () => {
  rule("CR 609.1g", "steps A through F repeat once per speed level until everyone has assigned", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a1", def: character({ name: "A1", strength: 1, life: 9, speed: 3 }), owner: P1 },
        { key: "a2", def: character({ name: "A2", strength: 1, life: 9, speed: 2 }), owner: P1 },
        { key: "b1", def: character({ name: "B1", strength: 1, life: 9, speed: 1 }), owner: P2 }
      ]
    });
    startBattle({ engine, id }, ["a1", "a2"], ["b1"]);
    playOut(engine);
    assert.deepEqual(battleOf(engine)?.rounds.map((round) => round.speed), [3, 2, 1], "three rounds, one per speed level");
    assert.deepEqual(battleOf(engine)?.rounds.map((round) => round.assignedBy), [[id("a1")], [id("a2")], [id("b1")]], "each character assigned in its own round");
    assert.equal(battleOf(engine)?.phase, "finished");
  });

  rule("CR 609.1g", "a character assigns only once even if its speed is raised afterwards", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 2, life: 9, speed: 2 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 1, life: 9, speed: 1 }), owner: P2 },
        { key: "up", def: pumper("Speed Up", "speed", 5), owner: P1 }
      ]
    });
    startBattle({ engine, id }, ["a"], ["b"]);
    closeWindows(engine);
    assign(engine, P1, [id("a"), cardTarget(id("b")), 2]);
    endWindow(engine);
    assert.equal(battleOf(engine)?.phase, "beforeDamageResponse", "the speed-1 round's tactics step");
    use(engine, P1, id("up"), "go", { t: [id("a")] });
    closeWindows(engine);
    assert.equal(engine.getBattleView()?.speed, 1, "X is the blocker's speed; the character that assigned is no longer considered");
    assert.deepEqual(engine.getBattleView()?.damageSources.map((source) => source.cardId), [id("b")]);
    autoResolveBattle(engine);
    assert.equal(engine.state.cards[id("b")]!.damage, 2, "the attacker dealt its damage exactly once");
  });

  rule("CR 609.1g", "a character no longer in play when its turn to assign comes does not assign, and the repeat ends without it", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "fast", def: character({ name: "Fast", strength: 5, life: 9, speed: 3 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 4, life: 2, speed: 1 }), owner: P2 }
      ]
    });
    startBattle({ engine, id }, ["fast"], ["b"]);
    const steps = playOut(engine);
    assert.equal(engine.state.cards[id("b")]!.zone, "discard", "the blocker died in the first round");
    assert.deepEqual(steps.map((step) => step.speed), [3], "no round was held for it");
    assert.equal(engine.state.cards[id("fast")]!.damage, 0, "and it dealt no damage");
    assert.equal(battleOf(engine)?.phase, "finished", "the battle is over");
  });

  rule("CR 609.1g", "the same holds for an attacker destroyed before it assigns", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "slow", def: character({ name: "Slow", strength: 4, life: 1, speed: 1 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 5, life: 9, speed: 3 }), owner: P2 }
      ]
    });
    const before = engine.state.players[P2].influence;
    startBattle({ engine, id }, ["slow"], ["b"]);
    const steps = playOut(engine);
    assert.deepEqual(steps.map((step) => [step.speed, step.phase]), [[3, "defenderDamageAssignment"]], "only the blocker's round was held");
    assert.equal(engine.state.cards[id("slow")]!.zone, "discard");
    assert.equal(engine.state.cards[id("b")]!.damage, 0, "the dead attacker dealt nothing");
    assert.equal(engine.state.players[P2].influence, before, "and nothing reached the faction");
  });

  rule("CR 609.1g", "a battle with every character's speed equal resolves in a single repeat", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 1, life: 9, speed: 2 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 1, life: 9, speed: 2 }), owner: P2 }
      ]
    });
    startBattle({ engine, id }, ["a"], ["b"]);
    playOut(engine);
    assert.equal(battleOf(engine)?.rounds.length, 1);
  });
});

describe("CR 609.1h — end", () => {
  rule("CR 609.1h", "all surviving characters in the battle are depleted: attackers and blockers", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 1, life: 9, speed: 1 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 1, life: 9, speed: 1 }), owner: P2 },
        { key: "idle", def: character({ name: "Idle" }), owner: P2 },
        { key: "mine", def: character({ name: "Mine" }), owner: P1 }
      ]
    });
    startBattle({ engine, id }, ["a"], ["b"]);
    assert.equal(engine.state.cards[id("b")]!.depleted, false, "the blocker is ready going into the battle");
    playOut(engine);
    assert.equal(engine.state.cards[id("a")]!.depleted, true, "the surviving attacker is depleted");
    assert.equal(engine.state.cards[id("b")]!.depleted, true, "the surviving blocker is depleted");
    assert.equal(engine.state.cards[id("idle")]!.depleted, false, "a character that took no part is not");
    assert.equal(engine.state.cards[id("mine")]!.depleted, false, "neither is an attacker-side one that stayed home");
  });

  rule("CR 609.1h", "blockers are not depleted until the end: still ready in the middle of the battle", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 1, life: 9, speed: 3 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 1, life: 9, speed: 1 }), owner: P2 }
      ]
    });
    startBattle({ engine, id }, ["a"], ["b"]);
    closeWindows(engine);
    assign(engine, P1, [id("a"), cardTarget(id("b")), 1]);
    endWindow(engine);
    assert.equal(battleOf(engine)?.phase, "beforeDamageResponse", "the battle is still going");
    assert.equal(engine.state.cards[id("b")]!.depleted, false, "so the blocker is not depleted yet");
    autoResolveBattle(engine);
    assert.equal(engine.state.cards[id("b")]!.depleted, true, "depleted when the battle ends");
  });

  rule("CR 609.1h", "characters that did not survive are not depleted, they are gone", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 5, life: 9, speed: 1 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 0, life: 2, speed: 1 }), owner: P2 }
      ]
    });
    startBattle({ engine, id }, ["a"], ["b"]);
    playOut(engine);
    assert.equal(engine.state.cards[id("b")]!.zone, "discard", "the blocker was destroyed");
    assert.equal(engine.state.cards[id("b")]!.depleted, false, "and sits in the discard pile as a fresh card, not a depleted one");
    assert.equal(engine.state.cards[id("a")]!.depleted, true, "the survivor is depleted");
  });

  rule("CR 609.1h", "a character removed from the battle is not a character in the battle, so it is not depleted at the end", () => {
    const remover = gadget("Remover", [
      { id: "go", type: "activated", targets: [{ id: "t", selector: { type: "character", zone: "play" }, count: 1 }], effects: [{ type: "removeFromBattle", target: { type: "selected", id: "t" } }] }
    ]);
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 1, life: 9, speed: 1 }), owner: P1 },
        { key: "b1", def: character({ name: "B1", strength: 1, life: 9, speed: 1 }), owner: P2 },
        { key: "b2", def: character({ name: "B2", strength: 1, life: 9, speed: 1 }), owner: P2 },
        { key: "rem", def: remover, owner: P1 }
      ]
    });
    startBattle({ engine, id }, ["a"], ["b1", "b2"]);
    use(engine, P1, id("rem"), "go", { t: [id("b2")] });
    playOut(engine);
    assert.equal(engine.state.cards[id("b1")]!.depleted, true, "the remaining blocker is depleted");
    assert.equal(engine.state.cards[id("b2")]!.depleted, false, "the removed blocker is not");
  });

  rule("CR 609.1h", "the ending happens after the repeat finishes, and the battle is then over", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 1, life: 9, speed: 1 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 1, life: 9, speed: 1 }), owner: P2 }
      ]
    });
    startBattle({ engine, id }, ["a"], ["b"]);
    autoResolveBattle(engine);
    assert.equal(engine.state.battle, undefined, "no battle is left");
    assert.equal(engine.state.cards[id("a")]!.depleted && engine.state.cards[id("b")]!.depleted, true, "both survivors stayed depleted");
  });
});

describe("CR 609.2 — nothing left to assign to", () => {
  rule("CR 609.2", "an attacking party of many speeds at a location: once the first wave destroys it the rest assign nothing, but have assigned, and the battle ends", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "first", def: character({ name: "First", strength: 2, speed: 3 }), owner: P1 },
        { key: "second", def: character({ name: "Second", strength: 4, speed: 2 }), owner: P1 },
        { key: "third", def: character({ name: "Third", strength: 6, speed: 1 }), owner: P1 },
        { key: "fort", def: location({ name: "Fort", structure: 2 }), owner: P2 }
      ]
    });
    const before = engine.state.players[P2].influence;
    startBattle({ engine, id }, ["first", "second", "third"], [], cardTarget(id("fort")));
    closeWindows(engine);
    assign(engine, P1, [id("first"), cardTarget(id("fort")), 2]);
    closeWindows(engine);
    assert.equal(engine.state.cards[id("fort")]!.zone, "discard", "the first wave destroyed the location");
    assert.equal(engine.getBattleView()?.speed, 2, "the speed-2 character's turn to assign");
    assert.deepEqual(engine.getBattleView()?.damageSources[0]?.legalTargets, [], "it has nothing to assign to");
    refused(() => assign(engine, P1, [id("second"), FACTION_P2, 4]), "assigning to the faction instead", /no legal damage target/);
    assign(engine, P1);
    assert.ok(battleOf(engine)?.assignedDamageBy.includes(id("second")), "it is considered to have assigned");
    closeWindows(engine);
    assert.equal(engine.getBattleView()?.speed, 1, "then the speed-1 character");
    assign(engine, P1);
    closeWindows(engine);
    assert.equal(battleOf(engine)?.phase, "finished", "the battle ended rather than repeating forever");
    assert.equal(battleOf(engine)?.rounds.length, 3, "after exactly one round per speed level");
    assert.equal(engine.state.players[P2].influence, before, "no damage went to the faction");
    assert.deepEqual(battleOf(engine)?.rounds.flatMap((round) => round.inflicted), [{ sourceId: id("first"), target: cardTarget(id("fort")), amount: 2 }], "only the first wave inflicted damage");
  });

  rule("CR 609.2", "blockers with no attackers left to assign to do nothing but count as having assigned", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 0, life: 1, speed: 3 }), owner: P1 },
        { key: "fast", def: character({ name: "Fast", strength: 2, life: 9, speed: 3 }), owner: P2 },
        { key: "slow", def: character({ name: "Slow", strength: 4, life: 9, speed: 1 }), owner: P2 }
      ]
    });
    startBattle({ engine, id }, ["a"], ["fast", "slow"]);
    closeWindows(engine);
    assign(engine, P1);
    assign(engine, P2, [id("fast"), cardTarget(id("a")), 2]);
    closeWindows(engine);
    assert.equal(engine.state.cards[id("a")]!.zone, "discard", "the only attacker died in the first round");
    assert.equal(battleOf(engine)?.phase, "defenderDamageAssignment", "the slow blocker's turn");
    assert.deepEqual(engine.getBattleView()?.damageSources[0]?.legalTargets, [], "it has nothing to assign to");
    assign(engine, P2);
    closeWindows(engine);
    assert.equal(battleOf(engine)?.phase, "finished", "the battle ends");
    assert.ok(battleOf(engine)?.assignedDamageBy.includes(id("slow")), "the slow blocker is considered to have assigned");
  });

  rule("CR 609.2", "a character with something to assign to must assign: it is only the empty case that does nothing", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 3, speed: 1 }), owner: P1 },
        { key: "fort", def: location({ name: "Fort", structure: 9 }), owner: P2 }
      ]
    });
    startBattle({ engine, id }, ["a"], [], cardTarget(id("fort")));
    closeWindows(engine);
    refused(() => assign(engine, P1), "assigning nothing with a target available", /must assign exactly 3/);
    assign(engine, P1, [id("a"), cardTarget(id("fort")), 3]);
    assert.equal(battleOf(engine)?.attackerAssignments.length, 1, "control: the full assignment is accepted");
  });
});
