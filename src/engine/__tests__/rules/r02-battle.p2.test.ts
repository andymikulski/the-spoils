// Batch r02-battle, part 2 (docs/TESTING.md): CR 608 Attacking.
// Written from the wording of the Comprehensive Rules, not from the engine.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, SpoilsEngine } from "../../../engine.js";
import { autoResolveBattle, buildGame, character, item, location, P1, P2, resolvePendingResponses, tactic } from "../support/fixtures.js";
import { refused, rule, ruleMismatch } from "./_rule.js";

type Abilities = NonNullable<NonNullable<CardDefinition["behavior"]>["abilities"]>;

const FACTION_P2 = { type: "faction", playerId: P2 } as const;

function attack(engine: SpoilsEngine, attackers: CardInstanceId[], target: { type: "faction"; playerId: string } | { type: "card"; cardId: CardInstanceId } = FACTION_P2): void {
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: attackers, target });
}

const toBlocking = (engine: SpoilsEngine): void => resolvePendingResponses(engine);

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

/** Deploys a tactic from hand and lets it (and anything on top of it) resolve, returning to the window it was deployed in. */
function deploy(engine: SpoilsEngine, playerId: string, cardId: CardInstanceId): void {
  engine.perform({ type: "playCard", playerId, cardId });
  settle(engine);
}

const mark = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId]!.counters.mark ?? 0;

const gadget = (name: string, abilities: Abilities): CardDefinition => item({ name, behavior: { abilities } });

const markSelf = (id: string): Abilities[number] => ({ id, type: "activated", effects: [{ type: "addCounter", target: "source", counter: "mark", amount: 1 }] });

/** A tactic that deals 1 damage to the opponent's faction. */
const ping = (name: string): CardDefinition =>
  tactic({ name, behavior: { abilities: [{ id: "a", type: "activated", effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 1 }] }] } });

/** A permanent that marks itself whenever the battle starts or a character is declared as an attacker. */
const watcher = (name: string): CardDefinition =>
  gadget(name, [
    { id: "started", type: "triggered", event: "battleStarted", effects: [{ type: "addCounter", target: "source", counter: "mark", amount: 1 }] },
    { id: "attacked", type: "triggered", event: "characterAttacked", effects: [{ type: "addCounter", target: "source", counter: "mark", amount: 10 }] }
  ]);

describe("CR 608.1 — the attack sequence", () => {
  rule("CR 608.1", "an attack goes: announcement, attackers, responses, blockers, resolution, in that order", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "blk", def: character({ name: "Blk" }), owner: P2 }
      ]
    });
    assert.equal((engine.state as { battle?: unknown }).battle, undefined, "nothing is attacking at first");
    attack(engine, [id("a")]);
    assert.equal(engine.state.battle?.phase, "afterAttackersResponse", "the attack is announced and the attackers chosen; the response step is next");
    assert.equal(engine.state.responseWindow?.kind, "battleAfterAttackers", "the responses step is open");
    refused(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] }), "declaring blockers during the responses step", /Responses must finish/);
    resolvePendingResponses(engine);
    assert.equal(engine.state.battle?.phase, "blocking", "after the responses the defender chooses blockers");
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
    assert.equal(engine.state.battle?.phase, "beforeDamageResponse", "after the blockers the battle is resolved");
  });
});

describe("CR 608.1a — announcement", () => {
  rule("CR 608.1a", "the attacker may choose the opponent's faction or an opponent's location to attack", () => {
    const build = () =>
      buildGame({
        cards: [
          { key: "a", def: character({ name: "A" }), owner: P1 },
          { key: "fort", def: location({ name: "Fort" }), owner: P2 }
        ]
      });
    const faction = build();
    attack(faction.engine, [faction.id("a")], FACTION_P2);
    assert.deepEqual(faction.engine.state.battle?.target, FACTION_P2, "the faction can be attacked");
    const loc = build();
    attack(loc.engine, [loc.id("a")], { type: "card", cardId: loc.id("fort") });
    assert.deepEqual(loc.engine.state.battle?.target, { type: "card", cardId: loc.id("fort") }, "the location can be attacked");
  });

  rule("CR 608.1a", "a faction or location you control cannot be chosen, nor can a card that is neither", () => {
    const build = () =>
      buildGame({
        cards: [
          { key: "a", def: character({ name: "A" }), owner: P1 },
          { key: "mine", def: location({ name: "Mine" }), owner: P1 },
          { key: "item", def: item({ name: "Item" }), owner: P2 }
        ]
      });
    {
      const { engine, id } = build();
      refused(() => attack(engine, [id("a")], { type: "faction", playerId: P1 }), "own faction", /own faction/);
    }
    {
      const { engine, id } = build();
      refused(() => attack(engine, [id("a")], { type: "card", cardId: id("mine") }), "own location", /own location/);
    }
    {
      const { engine, id } = build();
      refused(() => attack(engine, [id("a")], { type: "card", cardId: id("item") }), "an opposing item", /faction or location/);
    }
  });

  rule("CR 608.1a", "if no target is chosen, the attack defaults to the opponent's faction", () => {
    const { engine, id } = buildGame({ cards: [{ key: "a", def: character({ name: "A" }), owner: P1 }] });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("a")] });
    assert.deepEqual(engine.state.battle?.target, FACTION_P2, "the opponent's faction is attacked by default");
  });

  rule("CR 608.1a", "an attack can only be announced by the player whose turn it is", () => {
    const build = () =>
      buildGame({
        cards: [{ key: "b", def: character({ name: "B" }), owner: P2 }]
      });
    const { engine, id } = build();
    refused(() => engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("b")], target: { type: "faction", playerId: P1 } }), "attacking on the opponent's turn", /active player/);
    assert.equal(engine.state.battle, undefined, "no battle began");
    const control = buildGame({ cards: [{ key: "b", def: character({ name: "B" }), owner: P2 }], activePlayerId: P2, turn: 2 });
    control.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [control.id("b")], target: { type: "faction", playerId: P1 } });
    assert.ok(control.engine.state.battle, "control: the active player can attack");
  });

  rule("CR 608.1a", "an attack cannot be announced while a battle is already under way", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "a2", def: character({ name: "A2" }), owner: P1 }
      ]
    });
    attack(engine, [id("a")]);
    resolvePendingResponses(engine);
    refused(() => attack(engine, [id("a2")]), "a second attack in the blocking step", /Battle already in progress/);
    assert.deepEqual(engine.state.battle?.attackingParty, [id("a")], "the battle is unchanged");
    assert.equal(engine.state.cards[id("a2")]!.depleted, false, "the second character was not depleted");
  });

  rule("CR 608.1a", "an attack cannot be announced while a response window is open", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "opener", def: ping("Opener"), owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("opener") });
    refused(() => attack(engine, [id("a")]), "attacking while a tactic is awaiting responses", /response window|Responses/);
    resolvePendingResponses(engine);
    attack(engine, [id("a")]);
    assert.ok(engine.state.battle, "control: once the window has closed the attack is legal");
  });

  rule("CR 608.1a", "with no potential attackers the battle ends at once: nothing triggers", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "w", def: watcher("Watcher"), owner: P1 },
        { key: "tired", def: character({ name: "Tired" }), owner: P1, depleted: true },
        { key: "fresh", def: character({ name: "Fresh" }), owner: P1, attackEligible: false }
      ]
    });
    refused(() => attack(engine, []), "announcing an attack with no attackers", /No attackers/);
    refused(() => attack(engine, [id("tired")]), "the only candidate is depleted", /Depleted/);
    refused(() => attack(engine, [id("fresh")]), "the only candidate arrived this turn", /did not start the turn/);
    assert.equal(engine.state.battle, undefined, "no battle exists");
    assert.equal(mark(engine, id("w")), 0, "nothing triggered as a result of the attack");
    assert.equal(engine.state.cards[id("fresh")]!.depleted, false, "no character was depleted");
  });

  rule("CR 608.1a", "a valid attack does trigger the watcher (control for the no-attackers case)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "w", def: watcher("Watcher"), owner: P1 },
        { key: "a", def: character({ name: "A" }), owner: P1 }
      ]
    });
    attack(engine, [id("a")]);
    assert.equal(mark(engine, id("w")), 11, "battle start (1) and one attacker declared (10) triggered");
  });

  rule("CR 608.1a", "an effect preventing the attack ends it before anything triggers: a faction that cannot be attacked", () => {
    const court = location({
      name: "High Court",
      behavior: { abilities: [{ id: "ward", type: "continuous", modifiers: [], preventsAttackOnFaction: { player: "self" } }] }
    });
    const build = (withCourt: boolean) =>
      buildGame({
        cards: [
          { key: "w", def: watcher("Watcher"), owner: P1 },
          { key: "a", def: character({ name: "A" }), owner: P1 },
          ...(withCourt ? [{ key: "court", def: court, owner: P2 }] : [])
        ]
      });
    const prevented = build(true);
    refused(() => attack(prevented.engine, [prevented.id("a")]), "attacking a faction an effect protects", /cannot be attacked/);
    assert.equal(prevented.engine.state.battle, undefined, "no battle began");
    assert.equal(mark(prevented.engine, prevented.id("w")), 0, "nothing triggered");
    assert.equal(prevented.engine.state.cards[prevented.id("a")]!.depleted, false, "the would-be attacker stayed ready");
    const control = build(false);
    attack(control.engine, [control.id("a")]);
    assert.ok(control.engine.state.battle, "control: without the effect the attack is legal");
  });

  rule("CR 608.1a", "an effect preventing the attack ends it before anything triggers: a character that cannot attack", () => {
    const mittens = character({
      name: "Muzzled",
      behavior: { abilities: [{ id: "r", type: "continuous", modifiers: [], restrictions: [{ target: "source", restriction: "cannotAttack" }] }] }
    });
    const build = (def: CardDefinition) =>
      buildGame({
        cards: [
          { key: "w", def: watcher("Watcher"), owner: P1 },
          { key: "a", def, owner: P1 }
        ]
      });
    const prevented = build(mittens);
    refused(() => attack(prevented.engine, [prevented.id("a")]), "a character that cannot attack", /cannot attack/);
    assert.equal(prevented.engine.state.battle, undefined, "no battle began");
    assert.equal(mark(prevented.engine, prevented.id("w")), 0, "nothing triggered");
    const control = build(character({ name: "Free" }));
    attack(control.engine, [control.id("a")]);
    assert.ok(control.engine.state.battle, "control: an ordinary character can attack");
  });

  rule("CR 608.1a", "an effect preventing the attack ends it before anything triggers: a limit of one attack per turn", () => {
    const passage = location({
      name: "Narrow Passage",
      behavior: { abilities: [{ id: "limit", type: "continuous", modifiers: [], attackLimitPerTurn: 1 }] }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "w", def: watcher("Watcher"), owner: P1 },
        { key: "passage", def: passage, owner: P2 },
        { key: "a1", def: character({ name: "A1" }), owner: P1 },
        { key: "a2", def: character({ name: "A2" }), owner: P1 }
      ]
    });
    attack(engine, [id("a1")]);
    toBlocking(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    const marksAfterFirst = mark(engine, id("w"));
    assert.equal(marksAfterFirst, 11, "the first attack triggered normally");
    refused(() => attack(engine, [id("a2")]), "a second attack this turn", /maximum number of times/);
    assert.equal(engine.state.battle, undefined, "no second battle began");
    assert.equal(mark(engine, id("w")), marksAfterFirst, "nothing triggered for the refused attack");
    assert.equal(engine.state.cards[id("a2")]!.depleted, false, "the second would-be attacker stayed ready");
  });
});

describe("CR 608.1b — attackers", () => {
  const eligibleBoard = () =>
    buildGame({
      cards: [
        { key: "a1", def: character({ name: "A1" }), owner: P1 },
        { key: "a2", def: character({ name: "A2" }), owner: P1 },
        { key: "a3", def: character({ name: "A3" }), owner: P1 },
        { key: "idle", def: character({ name: "Idle" }), owner: P1 }
      ]
    });

  rule("CR 608.1b", "one or more characters you control can be chosen as attackers: one, two or three", () => {
    for (const count of [1, 2, 3]) {
      const { engine, id } = eligibleBoard();
      const chosen = ["a1", "a2", "a3"].slice(0, count).map((key) => id(key));
      attack(engine, chosen);
      assert.deepEqual(engine.state.battle?.attackingParty, chosen, `${count} attacker(s) form the attacking party`);
    }
  });

  rule("CR 608.1b", "choosing no attackers is not an attack", () => {
    const { engine } = eligibleBoard();
    refused(() => attack(engine, []), "an attack with no characters", /No attackers/);
    assert.equal(engine.state.battle, undefined);
  });

  rule("CR 608.1b", "the attackers are depleted, the characters that did not attack are not", () => {
    const { engine, id } = eligibleBoard();
    assert.equal(engine.state.cards[id("a1")]!.depleted, false, "ready before the attack");
    attack(engine, [id("a1"), id("a2")]);
    assert.equal(engine.state.cards[id("a1")]!.depleted, true, "attacker 1 is depleted");
    assert.equal(engine.state.cards[id("a2")]!.depleted, true, "attacker 2 is depleted");
    assert.equal(engine.state.cards[id("a3")]!.depleted, false, "a character that stayed home is still ready");
    assert.equal(engine.state.cards[id("idle")]!.depleted, false, "so is the other");
  });

  rule("CR 608.1b", "a depleted character cannot attack", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "tired", def: character({ name: "Tired" }), owner: P1, depleted: true },
        { key: "ready", def: character({ name: "Ready" }), owner: P1 }
      ]
    });
    refused(() => attack(engine, [id("tired")]), "a depleted attacker", /Depleted/);
    refused(() => attack(engine, [id("ready"), id("tired")]), "a depleted attacker among ready ones", /Depleted/);
    assert.equal(engine.state.cards[id("ready")]!.depleted, false, "the rejected declaration depleted nobody");
    attack(engine, [id("ready")]);
    assert.ok(engine.state.battle, "control: the ready character can attack");
  });

  rule("CR 608.1b", "a character you have not controlled since the start of the turn cannot attack: one that entered play this turn", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "fresh", def: character({ name: "Fresh" }), owner: P1, attackEligible: false }]
    });
    refused(() => attack(engine, [id("fresh")]), "a character that entered play this turn", /did not start the turn/);
  });

  rule("CR 608.1b", "a character deployed from hand this turn cannot attack, but could next turn", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "recruit", def: character({ name: "Recruit" }), owner: P1, zone: "hand" },
        { key: "veteran", def: character({ name: "Veteran" }), owner: P1 }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("recruit") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("recruit")]!.zone, "play", "the recruit is in play");
    refused(() => attack(engine, [id("recruit")]), "attacking with a character deployed this turn", /did not start the turn/);
    attack(engine, [id("veteran")]);
    assert.ok(engine.state.battle, "control: a character that was in play at the start of the turn can attack");
  });

  rule("CR 608.1b", "a character whose control changed this turn cannot attack for its new controller", () => {
    const thief = gadget("Thief", [
      {
        id: "steal",
        type: "activated",
        targets: [{ id: "t", selector: { controller: "opponent", type: "character" }, count: 1 }],
        effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
      }
    ]);
    const { engine, id } = buildGame({
      cards: [
        { key: "thief", def: thief, owner: P1 },
        { key: "loot", def: character({ name: "Loot" }), owner: P2, attackEligible: false },
        { key: "mine", def: character({ name: "Mine" }), owner: P1 }
      ]
    });
    use(engine, P1, id("thief"), "steal", { t: [id("loot")] });
    assert.equal(engine.state.cards[id("loot")]!.controllerId, P1, "P1 controls the stolen character");
    refused(() => attack(engine, [id("loot")]), "attacking with a character taken this turn", /did not start the turn/);
    attack(engine, [id("mine")]);
    assert.ok(engine.state.battle, "control: a character P1 held all turn can attack");
  });

  rule("CR 608.1b", "a character that left your control and came back this turn has not been controlled since the start of the turn, so it cannot attack", () => {
    const swap = gadget("Swapper", [
      {
        id: "gift",
        type: "activated",
        targets: [{ id: "t", selector: { controller: "self", type: "character" }, count: 1 }],
        effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "opponent" }]
      },
      {
        id: "steal",
        type: "activated",
        targets: [{ id: "t", selector: { controller: "opponent", type: "character" }, count: 1 }],
        effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
      }
    ]);
    const { engine, id } = buildGame({
      cards: [
        { key: "swap", def: swap, owner: P1 },
        { key: "x", def: character({ name: "X" }), owner: P1 }
      ]
    });
    use(engine, P1, id("swap"), "gift", { t: [id("x")] });
    assert.equal(engine.state.cards[id("x")]!.controllerId, P2, "the opponent had control of X for a while");
    use(engine, P1, id("swap"), "steal", { t: [id("x")] });
    assert.equal(engine.state.cards[id("x")]!.controllerId, P1, "P1 controls X again");
    refused(() => attack(engine, [id("x")]), "attacking with a character whose control was interrupted this turn", /did not start the turn/);
  });

  rule("CR 608.1b", "only characters you control can be chosen: not the opponent's, not an item, not a face-down card", () => {
    const build = () =>
      buildGame({
        cards: [
          { key: "mine", def: character({ name: "Mine" }), owner: P1 },
          { key: "foe", def: character({ name: "Foe" }), owner: P2 },
          { key: "thing", def: item({ name: "Thing" }), owner: P1 },
          { key: "hidden", def: character({ name: "Hidden" }), owner: P1, faceDown: true }
        ]
      });
    for (const [key, why, pattern] of [
      ["foe", "the opponent's character", /do not control/],
      ["thing", "an item", /Only characters/],
      ["hidden", "a face-down card", /Only characters/]
    ] as const) {
      const { engine, id } = build();
      refused(() => attack(engine, [id(key)]), why, pattern);
      assert.equal(engine.state.battle, undefined, `${why}: no battle began`);
    }
    const { engine, id } = build();
    attack(engine, [id("mine")]);
    assert.ok(engine.state.battle, "control: a character you control can attack");
  });

  rule("CR 608.1b", "the same character cannot be chosen twice", () => {
    const { engine, id } = eligibleBoard();
    refused(() => attack(engine, [id("a1"), id("a1")]), "a duplicated attacker", /more than once/);
    assert.equal(engine.state.cards[id("a1")]!.depleted, false, "nothing was depleted");
    attack(engine, [id("a1"), id("a2")]);
    assert.ok(engine.state.battle, "control: two distinct characters are fine");
  });

  rule("CR 608.1b", "the chosen attackers form the attacking party", () => {
    const { engine, id } = eligibleBoard();
    attack(engine, [id("a2"), id("a3")]);
    assert.deepEqual(engine.state.battle?.attackingParty, [id("a2"), id("a3")]);
    assert.deepEqual(engine.getBattleView()?.attackingParty, [id("a2"), id("a3")], "as reported by the battle view");
  });
});

describe("CR 608.1c — tactics and abilities before blockers", () => {
  const board = (extra: Parameters<typeof buildGame>[0] = {}) =>
    buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "g1", def: gadget("Gadget1", [markSelf("go")]), owner: P1 },
        { key: "g2", def: gadget("Gadget2", [markSelf("go")]), owner: P2 },
        { key: "t1", def: ping("Ping1"), owner: P1, zone: "hand" },
        { key: "t2", def: ping("Ping2"), owner: P1, zone: "hand" },
        { key: "t3", def: ping("Ping3"), owner: P2, zone: "hand" },
        { key: "t4", def: ping("Ping4"), owner: P2, zone: "hand" },
        { key: "blk", def: character({ name: "Blk" }), owner: P2 },
        ...(extra.cards ?? [])
      ]
    });

  rule("CR 608.1c", "the attacking player acts first in the step; the defender cannot until the attacker has finished", () => {
    const { engine, id } = board();
    attack(engine, [id("a")]);
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "the attacker holds the window first");
    refused(() => engine.perform({ type: "activateAbility", playerId: P2, cardId: id("g2"), abilityId: "go" }), "the defender using an ability before the attacker finishes", /timing|priority/);
    refused(() => engine.perform({ type: "playCard", playerId: P2, cardId: id("t3") }), "the defender deploying a tactic before the attacker finishes", /priority/);
    engine.perform({ type: "passPriority", playerId: P1 });
    use(engine, P2, id("g2"), "go");
    assert.equal(mark(engine, id("g2")), 1, "control: after the attacker is finished the defender can");
  });

  rule("CR 608.1c", "the attacking player may use abilities as many times as they want", () => {
    const { engine, id } = board();
    attack(engine, [id("a")]);
    for (let n = 1; n <= 4; n++) {
      use(engine, P1, id("g1"), "go");
      assert.equal(mark(engine, id("g1")), n, `ability use ${n} resolved`);
      assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "and the attacker still holds the window");
    }
  });

  rule("CR 608.1c", "the attacking player may deploy tactics as many times as they want", () => {
    const { engine, id } = board();
    const before = engine.state.players[P2].influence;
    attack(engine, [id("a")]);
    deploy(engine, P1, id("t1"));
    assert.equal(engine.state.players[P2].influence, before - 1, "the first tactic resolved");
    deploy(engine, P1, id("t2"));
    assert.equal(engine.state.players[P2].influence, before - 2, "the second tactic resolved");
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "the attacker still holds the window");
  });

  rule("CR 608.1c", "then the defending player may deploy tactics and use abilities as many times as they want", () => {
    const { engine, id } = board();
    const before = engine.state.players[P1].influence;
    attack(engine, [id("a")]);
    engine.perform({ type: "passPriority", playerId: P1 });
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the defender now holds the window");
    use(engine, P2, id("g2"), "go");
    use(engine, P2, id("g2"), "go");
    use(engine, P2, id("g2"), "go");
    assert.equal(mark(engine, id("g2")), 3, "three ability uses");
    deploy(engine, P2, id("t3"));
    deploy(engine, P2, id("t4"));
    assert.equal(engine.state.players[P1].influence, before - 2, "and two tactics");
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the defender still holds the window");
  });

  rule("CR 608.1c", "once the attacker has passed they cannot act again in this step", () => {
    const { engine, id } = board();
    attack(engine, [id("a")]);
    engine.perform({ type: "passPriority", playerId: P1 });
    refused(() => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("g1"), abilityId: "go" }), "the attacker acting after passing", /timing|priority/);
    refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("t1") }), "the attacker deploying after passing", /priority/);
  });

  rule("CR 608.1c", "blockers are chosen only after both players have finished", () => {
    const { engine, id } = board();
    attack(engine, [id("a")]);
    engine.perform({ type: "passPriority", playerId: P1 });
    refused(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] }), "blocking while the defender may still respond", /Responses must finish/);
    engine.perform({ type: "passPriority", playerId: P2 });
    engine.perform({ type: "advanceFlow" });
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
    assert.deepEqual(engine.state.battle?.blockingParty, [id("blk")], "control: once both have finished the block is accepted");
  });

  const joinBlocking = (): CardDefinition =>
    gadget("Joiner", [
      { id: "join", type: "activated", targets: [{ id: "t", selector: { type: "character", zone: "play" }, count: 1 }], effects: [{ type: "addToBattle", target: { type: "selected", id: "t" }, side: "blocking" }] }
    ]);
  /** A character that marks itself whenever a blocking party is formed with at least one character. */
  const formationWatcher = (name: string): CardDefinition =>
    character({ name, behavior: { abilities: [{ id: "formed", type: "triggered", event: "blockingPartyFormed", effects: [{ type: "addCounter", target: "source", counter: "mark", amount: 1 }] }] } });

  rule("CR 608.1c", "a character added to the blocking party during the step becomes the blocking party if no blocking party is formed next", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 2 }), owner: P1 },
        { key: "j", def: joinBlocking(), owner: P2 },
        { key: "ally", def: character({ name: "Ally", life: 5 }), owner: P2 }
      ]
    });
    const before = engine.state.players[P2].influence;
    attack(engine, [id("a")]);
    engine.perform({ type: "passPriority", playerId: P1 });
    use(engine, P2, id("j"), "join", { t: [id("ally")] });
    engine.perform({ type: "passPriority", playerId: P2 });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    assert.deepEqual(engine.state.battle?.blockingParty, [id("ally")], "the added character is the blocking party");
    autoResolveBattle(engine);
    assert.equal(engine.state.cards[id("ally")]!.damage, 2, "the attacker's damage went to the added blocker");
    assert.equal(engine.state.players[P2].influence, before, "not to the faction");
  });

  rule("CR 608.1c", "effects that apply to the formation of a blocking party do not happen when only an added character blocks", () => {
    const build = (declare: boolean) => {
      const game = buildGame({
        cards: [
          { key: "a", def: character({ name: "A" }), owner: P1 },
          { key: "j", def: joinBlocking(), owner: P2 },
          { key: "ally", def: character({ name: "Ally", life: 5 }), owner: P2 },
          { key: "watch", def: formationWatcher("Watch"), owner: P2 },
          { key: "declared", def: character({ name: "Declared" }), owner: P2 }
        ]
      });
      attack(game.engine, [game.id("a")]);
      engine_passAndJoin(game);
      game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: declare ? [game.id("declared")] : [] });
      return game;
    };
    const engine_passAndJoin = ({ engine, id }: ReturnType<typeof buildGame>) => {
      engine.perform({ type: "passPriority", playerId: P1 });
      use(engine, P2, id("j"), "join", { t: [id("ally")] });
      engine.perform({ type: "passPriority", playerId: P2 });
      resolvePendingResponses(engine);
    };
    const none = build(false);
    assert.deepEqual(none.engine.state.battle?.blockingParty, [none.id("ally")], "the added character blocks");
    assert.equal(mark(none.engine, none.id("watch")), 0, "no blocking party was formed, so formation triggers did not happen");
    const some = build(true);
    assert.equal(mark(some.engine, some.id("watch")), 1, "control: a declared blocking party does trigger them");
  });

  rule("CR 608.1c", "a character added to the blocking party during the step is added to the party formed in the next step", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "j", def: joinBlocking(), owner: P2 },
        { key: "ally", def: character({ name: "Ally", life: 5 }), owner: P2 },
        { key: "declared", def: character({ name: "Declared", life: 5 }), owner: P2 },
        { key: "watch", def: character({ name: "Watch", life: 5, behavior: { abilities: [{ id: "formed", type: "triggered", event: "blockingPartyFormed", effects: [{ type: "addCounter", target: "source", counter: "mark", amount: 1 }] }] } }), owner: P2 }
      ]
    });
    attack(engine, [id("a")]);
    engine.perform({ type: "passPriority", playerId: P1 });
    use(engine, P2, id("j"), "join", { t: [id("ally")] });
    engine.perform({ type: "passPriority", playerId: P2 });
    resolvePendingResponses(engine);
    assert.equal(mark(engine, id("watch")), 0, "the party is not formed yet when the character is added");
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("declared")] });
    assert.deepEqual([...engine.state.battle!.blockingParty].sort(), [id("ally"), id("declared")].sort(), "the declared blocker and the added character are both in the blocking party");
    assert.equal(mark(engine, id("watch")), 1, "the party was formed once, by the declaration");
  });

  rule("CR 608.1c", "a party restriction that applies when a blocking party is formed is not checked for a character that is merely added", () => {
    const lonely = character({
      name: "Pack Animal",
      life: 5,
      behavior: { abilities: [{ id: "pack", type: "continuous", modifiers: [], partyRestriction: { role: "blocking", minMembers: 2 } }] }
    });
    const build = () =>
      buildGame({
        cards: [
          { key: "a", def: character({ name: "A" }), owner: P1 },
          { key: "j", def: joinBlocking(), owner: P2 },
          { key: "pack", def: lonely, owner: P2 }
        ]
      });
    const control = build();
    attack(control.engine, [control.id("a")]);
    toBlocking(control.engine);
    refused(() => control.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [control.id("pack")] }), "forming a blocking party of one with the restricted character", /at least 2/);
    const { engine, id } = build();
    attack(engine, [id("a")]);
    engine.perform({ type: "passPriority", playerId: P1 });
    use(engine, P2, id("j"), "join", { t: [id("pack")] });
    engine.perform({ type: "passPriority", playerId: P2 });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    assert.deepEqual(engine.state.battle?.blockingParty, [id("pack")], "the restricted character is the blocking party; no party was formed to restrict");
  });
});

describe("CR 608.1d — blockers", () => {
  const board = () =>
    buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 2 }), owner: P1 },
        { key: "b1", def: character({ name: "B1", life: 5 }), owner: P2 },
        { key: "b2", def: character({ name: "B2", life: 5 }), owner: P2 },
        { key: "b3", def: character({ name: "B3", life: 5 }), owner: P2 }
      ]
    });
  const declare = (game: ReturnType<typeof buildGame>, keys: string[]) => {
    attack(game.engine, [game.id("a")]);
    toBlocking(game.engine);
    game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: keys.map((key) => game.id(key)) });
  };

  rule("CR 608.1d", "the defending player may choose one or more non-depleted characters they control to block: one, two or three", () => {
    for (const keys of [["b1"], ["b1", "b2"], ["b1", "b2", "b3"]]) {
      const game = board();
      declare(game, keys);
      assert.deepEqual(game.engine.state.battle?.blockingParty, keys.map((key) => game.id(key)), `${keys.length} blocker(s) form the blocking party`);
    }
  });

  rule("CR 608.1d", "if no blockers are chosen there is no blocking party and the attack hits its target", () => {
    const game = board();
    const before = game.engine.state.players[P2].influence;
    declare(game, []);
    assert.deepEqual(game.engine.state.battle?.blockingParty, [], "no blocking party");
    autoResolveBattle(game.engine);
    assert.equal(game.engine.state.players[P2].influence, before - 2, "the faction took the unblocked damage");
    for (const key of ["b1", "b2", "b3"]) assert.equal(game.engine.state.cards[game.id(key)]!.damage, 0, `${key} took nothing`);
  });

  rule("CR 608.1d", "a depleted character cannot be chosen to block", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "tired", def: character({ name: "Tired" }), owner: P2, depleted: true },
        { key: "ready", def: character({ name: "Ready" }), owner: P2 }
      ]
    });
    attack(engine, [id("a")]);
    toBlocking(engine);
    refused(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("tired")] }), "a depleted blocker", /Depleted/);
    refused(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("ready"), id("tired")] }), "a depleted blocker among ready ones", /Depleted/);
    assert.deepEqual(engine.state.battle?.blockingParty, [], "the rejected declarations formed no party");
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("ready")] });
    assert.deepEqual(engine.state.battle?.blockingParty, [id("ready")], "control: the ready character can block");
  });

  rule("CR 608.1d", "only characters can be chosen to block: not an item, not a face-down card", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "thing", def: item({ name: "Thing" }), owner: P2 },
        { key: "hidden", def: character({ name: "Hidden" }), owner: P2, faceDown: true },
        { key: "ready", def: character({ name: "Ready" }), owner: P2 }
      ]
    });
    attack(engine, [id("a")]);
    toBlocking(engine);
    refused(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("thing")] }), "an item as blocker", /Only characters/);
    refused(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("hidden")] }), "a face-down card as blocker", /face-down/);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("ready")] });
    assert.deepEqual(engine.state.battle?.blockingParty, [id("ready")], "control: a character can block");
  });

  rule("CR 608.1d", "a blocker need not have been in play since the start of the turn", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "newcomer", def: character({ name: "Newcomer" }), owner: P2, attackEligible: false }
      ]
    });
    attack(engine, [id("a")]);
    toBlocking(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("newcomer")] });
    assert.deepEqual(engine.state.battle?.blockingParty, [id("newcomer")]);
  });

  rule("CR 608.1d", "the same character cannot be chosen twice", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "b", def: character({ name: "B" }), owner: P2 }
      ]
    });
    attack(engine, [id("a")]);
    toBlocking(engine);
    refused(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b"), id("b")] }), "a duplicated blocker", /more than once/);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b")] });
    assert.deepEqual(engine.state.battle?.blockingParty, [id("b")], "control: once is fine");
  });

  rule("CR 608.1d", "blocking does not deplete the blockers (they are depleted when the battle ends)", () => {
    const game = board();
    declare(game, ["b1", "b2"]);
    assert.equal(game.engine.state.cards[game.id("b1")]!.depleted, false, "b1 is still ready after blocking");
    assert.equal(game.engine.state.cards[game.id("b2")]!.depleted, false, "b2 is still ready after blocking");
  });

  rule("CR 608.1d", "the blockers are asked for only once: they cannot be declared again after the party is formed", () => {
    const game = board();
    declare(game, ["b1"]);
    refused(() => game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [game.id("b2")] }), "declaring blockers a second time", /not accepting blockers|Responses must finish/);
    assert.deepEqual(game.engine.state.battle?.blockingParty, [game.id("b1")], "the blocking party is unchanged");
  });
});

describe("CR 608.1e — resolution", () => {
  rule("CR 608.1e", "after blockers are chosen the battle is resolved: the damage steps begin", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 2 }), owner: P1 },
        { key: "b", def: character({ name: "B", life: 5 }), owner: P2 }
      ]
    });
    attack(engine, [id("a")]);
    toBlocking(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b")] });
    assert.equal(engine.state.battle?.phase, "beforeDamageResponse", "the resolution begins with the pre-damage tactics step");
    assert.equal(engine.state.responseWindow?.kind, "battleBeforeDamage");
    assert.equal(engine.state.cards[id("b")]!.damage, 0, "no damage has been dealt yet");
    autoResolveBattle(engine);
    assert.equal(engine.state.cards[id("b")]!.damage, 2, "the resolution dealt the damage");
    assert.equal(engine.state.battle, undefined, "and ended the battle");
  });

  rule("CR 608.1e", "an unblocked attack is also resolved", () => {
    const { engine, id } = buildGame({ cards: [{ key: "a", def: character({ name: "A", strength: 2 }), owner: P1 }] });
    const before = engine.state.players[P2].influence;
    attack(engine, [id("a")]);
    toBlocking(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    assert.equal(engine.state.battle?.phase, "beforeDamageResponse", "with no blockers the resolution still begins");
    autoResolveBattle(engine);
    assert.equal(engine.state.players[P2].influence, before - 2);
  });
});
