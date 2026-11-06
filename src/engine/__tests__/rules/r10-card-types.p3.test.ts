// Batch r10-card-types (docs/TESTING.md), part 3: CR 204 Characters, CR 205 Tactics, CR 206 Items.
// Written from the wording of the Comprehensive Rules, not from the engine.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, CardType, PendingChoice, SpoilsEngine } from "../../../engine.js";
import {
  autoResolveBattle,
  buildGame,
  character,
  item,
  location,
  P1,
  P2,
  resolvePendingResponses,
  tactic
} from "../support/fixtures.js";
import { refused, rule } from "./_rule.js";
import { settleTurnStart } from "../support/develop.js";

const zone = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId]!.zone;

/** Deploys a card and lets every response window close. */
function deploy(engine: SpoilsEngine, player: string, cardId: string, extra: Record<string, unknown> = {}): void {
  engine.perform({ type: "playCard", playerId: player, cardId, ...extra } as never);
  resolvePendingResponses(engine);
}

/** The player ends their turn and the opponent passes: the next turn starts. */
function passTurn(engine: SpoilsEngine, player: string): void {
  engine.perform({ type: "endTurn", playerId: player });
  resolvePendingResponses(engine);
  settleTurnStart(engine);
}

/** A character whose ability deals `amount` damage to the picked card matching `selector`. */
const zapper = (name: string, amount: number, selector: Record<string, unknown> = { controller: "opponent", type: "character" }) =>
  character({
    name,
    behavior: {
      abilities: [
        {
          id: "z",
          type: "activated",
          targets: [{ id: "t", selector, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });

function zap(engine: SpoilsEngine, by: string, victim: string, player: string = P1): void {
  engine.perform({ type: "activateAbility", playerId: player, cardId: by, abilityId: "z", selected: { t: [victim] } });
  resolvePendingResponses(engine);
}

/** A tactic with no effect. */
const blank = (name: string) => tactic({ name });

/** A tactic that makes `player` "deploy a <type>" (or any card) for free when it resolves. */
const muster = (name: string, type?: CardType) =>
  tactic({
    name,
    behavior: {
      abilities: [
        { id: "m", type: "activated", effects: [{ type: "deployForFree", player: "controller", maxCost: 9, ...(type ? { selector: { type, zone: "hand" } } : {}) }] }
      ]
    }
  });

const pending = (engine: SpoilsEngine): PendingChoice | undefined => engine.state.pendingChoice;

/** Attacks with `attackers`, closes the declaration window, declares `blockers` and fights the battle out. */
function fight(
  engine: SpoilsEngine,
  attackers: string[],
  target: { type: "faction"; playerId: string } | { type: "card"; cardId: string },
  blockers: string[] = []
): void {
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: attackers, target });
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: blockers });
  autoResolveBattle(engine);
}

/** P1 attacks the opposing faction and passes priority, so P2 holds priority in the declaration window. */
function attackAndPass(engine: SpoilsEngine, attackers: string[]): void {
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: attackers, target: { type: "faction", playerId: P2 } });
  engine.perform({ type: "passPriority", playerId: P1 });
}

describe("CR 204 — characters", () => {
  const timingBody = (label: string, make: (o?: Partial<CardDefinition>) => CardDefinition) => () => {
    const own = buildGame({ cards: [{ key: "c", def: make({ name: "C" }), owner: P1, zone: "hand" }] });
    assert.equal(own.engine.getCardPlayability(P1, own.id("c")).legalTiming, true, "my turn: legal timing");
    deploy(own.engine, P1, own.id("c"));
    assert.equal(zone(own.engine, own.id("c")), "play", "deployed on my turn");

    const theirs = buildGame({ cards: [{ key: "c", def: make({ name: "C" }), owner: P2, zone: "hand" }] });
    assert.equal(theirs.engine.getCardPlayability(P2, theirs.id("c")).legalTiming, false, "on the opponent's turn: not legal");
    refused(
      () => theirs.engine.perform({ type: "playCard", playerId: P2, cardId: theirs.id("c") }),
      `a ${label} from the non-active player's hand`,
      /Only the active player/
    );

    const window = buildGame({
      cards: [
        { key: "atk", def: character({ name: "Atk" }), owner: P1 },
        { key: "c", def: make({ name: "C" }), owner: P2, zone: "hand" }
      ]
    });
    attackAndPass(window.engine, [window.id("atk")]);
    assert.equal(window.engine.state.responseWindow?.priorityPlayerId, P2, "the defender holds priority");
    refused(
      () => window.engine.perform({ type: "playCard", playerId: P2, cardId: window.id("c") }),
      `a ${label} in a response window`,
      /Only tactics or TACTICAL/
    );
  };
  const effectDeployBody = (label: string, make: (o?: Partial<CardDefinition>) => CardDefinition) => () => {
    for (const generic of [false, true]) {
      const { engine, id } = buildGame({
        cards: [
          { key: "atk", def: character({ name: "Atk" }), owner: P1 },
          { key: "muster", def: muster("Muster", generic ? undefined : (label as CardType)), owner: P2, zone: "hand" },
          { key: "thing", def: make({ name: "Thing", cost: 3 }), owner: P2, zone: "hand" }
        ]
      });
      attackAndPass(engine, [id("atk")]);
      engine.perform({ type: "playCard", playerId: P2, cardId: id("muster") });
      resolvePendingResponses(engine);
      assert.equal(pending(engine)?.kind, "deployForFree", "the effect offers the deployment as it resolves");
      engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "deployForFree", cardId: id("thing") } });
      resolvePendingResponses(engine);
      assert.equal(engine.state.activePlayerId, P1, "it is still the opponent's turn");
      assert.equal(zone(engine, id("thing")), "play", `the ${label} was deployed on the opponent's turn (${generic ? "deploy a card" : `deploy a ${label}`})`);
      assert.equal(engine.state.cards[id("thing")]!.controllerId, P2, "under the control of the effect's controller");
    }
  };
  const resolvesBody = (label: string, make: (o?: Partial<CardDefinition>) => CardDefinition) => () => {
    const { engine, id } = buildGame({ cards: [{ key: "c", def: make({ name: "C" }), owner: P1, zone: "hand" }] });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("c") });
    assert.equal(zone(engine, id("c")), "deploying", "not in play while it may still be responded to");
    resolvePendingResponses(engine);
    assert.equal(zone(engine, id("c")), "play", "put into play once it resolves");
    assert.ok(engine.state.players[P1].play.includes(id("c")), "it is in its controller's play area");
  };

  rule("CR 204.1", "a character is deployed from hand during your own turn; the opponent cannot deploy one from hand on your turn, not even holding priority in a response window", timingBody("character", character));
  rule("CR 206.1", "an item is deployed from hand during your own turn; the opponent cannot deploy one from hand on your turn, not even holding priority in a response window", timingBody("item", item));
  rule("CR 207.1", "a location is deployed from hand during your own turn; the opponent cannot deploy one from hand on your turn, not even holding priority in a response window", timingBody("location", location));

  rule("CR 204.1", "'deploy a card' / 'deploy a character' deploys it when the effect resolves even on the opponent's turn (example)", effectDeployBody("character", character));
  rule("CR 206.1", "'deploy a card' / 'deploy an item' deploys it when the effect resolves even on the opponent's turn (example)", effectDeployBody("item", item));
  rule("CR 207.1", "'deploy a card' / 'deploy a location' deploys it when the effect resolves even on the opponent's turn (example)", effectDeployBody("location", location));

  rule("CR 204.2", "when a character resolves it is put into play: it waits while the opponent may respond, then enters play", resolvesBody("character", character));
  rule("CR 206.2", "when an item resolves it is put into play: it waits while the opponent may respond, then enters play", resolvesBody("item", item));
  rule("CR 207.2", "when a location resolves it is put into play: it waits while the opponent may respond, then enters play", resolvesBody("location", location));

  rule("CR 204.2a", "a character enters play under the control of the player who deployed it", () => {
    const { engine, id } = buildGame({ cards: [{ key: "c", def: character({ name: "C" }), owner: P1, zone: "hand" }] });
    deploy(engine, P1, id("c"));
    assert.equal(engine.state.cards[id("c")]!.controllerId, P1, "deployed by P1, controlled by P1");
    assert.equal(engine.state.cards[id("c")]!.ownerId, P1, "and owned by P1");
  });

  rule("CR 204.2a", "a character put into play by an effect enters under the control of the effect's controller, not the other player", () => {
    const grave = tactic({
      name: "Raise",
      behavior: {
        abilities: [
          {
            id: "r",
            type: "activated",
            targets: [{ id: "t", selector: { type: "character", zone: "discard", owner: "any" }, count: 1 }],
            effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "raise", def: grave, owner: P1, zone: "hand" },
        { key: "corpse", def: character({ name: "Corpse" }), owner: P2, zone: "discard" }
      ]
    });
    deploy(engine, P1, id("raise"), { selected: { t: [id("corpse")] } });
    assert.equal(zone(engine, id("corpse")), "play", "put into play");
    assert.equal(engine.state.cards[id("corpse")]!.controllerId, P1, "under the effect controller's control");
    assert.equal(engine.state.cards[id("corpse")]!.ownerId, P2, "while the owner is unchanged");
  });

  rule("CR 204.3", "a character cannot attack unless it started the turn in play under your control; one that did can", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "veteran", def: character({ name: "Veteran" }), owner: P1 },
        { key: "recruit", def: character({ name: "Recruit" }), owner: P1, attackEligible: false }
      ]
    });
    refused(
      () => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("recruit")], target: { type: "faction", playerId: P2 } }),
      "attacking with a character that did not start the turn in play",
      /did not start the turn/
    );
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("veteran")], target: { type: "faction", playerId: P2 } });
    assert.deepEqual(engine.state.battle?.attackingParty, [id("veteran")], "control: the veteran attacks");
  });

  rule("CR 204.3", "a character deployed this turn cannot attack this turn but can attack on its controller's next turn", () => {
    const { engine, id } = buildGame({ cards: [{ key: "c", def: character({ name: "C", cost: 0 }), owner: P1, zone: "hand" }] });
    deploy(engine, P1, id("c"));
    refused(
      () => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("c")], target: { type: "faction", playerId: P2 } }),
      "attacking the turn it was deployed",
      /did not start the turn/
    );
    passTurn(engine, P1);
    passTurn(engine, P2);
    assert.equal(engine.state.activePlayerId, P1, "my next turn");
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("c")], target: { type: "faction", playerId: P2 } });
    assert.deepEqual(engine.state.battle?.attackingParty, [id("c")], "now it started the turn in play, so it attacks");
  });

  rule("CR 204.3", "a character takes part in combat only while in play: one in hand or discard cannot attack", () => {
    for (const where of ["hand", "discard"] as const) {
      const { engine, id } = buildGame({
        cards: [
          { key: "c", def: character({ name: "C" }), owner: P1, zone: where },
          { key: "ok", def: character({ name: "Ok" }), owner: P1 }
        ]
      });
      refused(
        () => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("c")], target: { type: "faction", playerId: P2 } }),
        `attacking with a character in the ${where}`,
        /Attacker must be in play/
      );
      engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("ok")], target: { type: "faction", playerId: P2 } });
      assert.ok(engine.state.battle, "control: the one in play attacks");
    }
  });

  rule("CR 204.3", "a character deployed on its controller's turn blocks on the opponent's very next turn: no waiting turn is needed", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "atk", def: character({ name: "Atk", strength: 1 }), owner: P1 },
        { key: "wall", def: character({ name: "Wall", life: 5 }), owner: P2, zone: "hand", attackEligible: false }
      ],
      activePlayerId: P2
    });
    deploy(engine, P2, id("wall"));
    passTurn(engine, P2);
    assert.equal(engine.state.activePlayerId, P1, "the opponent's turn: the wall entered play on the previous turn");
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("wall")] });
    assert.deepEqual(engine.state.battle?.blockingParty, [id("wall")], "a character that has been in play since the opponent's previous turn blocks");
  });

  rule("CR 204.3", "a character that is not in play cannot block", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "atk", def: character({ name: "Atk" }), owner: P1 },
        { key: "ghost", def: character({ name: "Ghost" }), owner: P2, zone: "hand" },
        { key: "wall", def: character({ name: "Wall" }), owner: P2 }
      ]
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    refused(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("ghost")] }), "blocking with a character in hand", /Blocker must be in play/);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("wall")] });
    assert.deepEqual(engine.state.battle?.blockingParty, [id("wall")], "control: a character in play blocks");
  });

  rule("CR 204.3", "a character gained from the opponent this turn did not start the turn under your control, so it cannot attack", () => {
    const steal = tactic({
      name: "Steal",
      behavior: {
        abilities: [
          {
            id: "s",
            type: "activated",
            targets: [{ id: "t", selector: { type: "character", controller: "opponent" }, count: 1 }],
            effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "steal", def: steal, owner: P1, zone: "hand" },
        { key: "loot", def: character({ name: "Loot" }), owner: P2, attackEligible: false },
        { key: "mine", def: character({ name: "Mine" }), owner: P1 }
      ]
    });
    deploy(engine, P1, id("steal"), { selected: { t: [id("loot")] } });
    assert.equal(engine.state.cards[id("loot")]!.controllerId, P1, "control changed");
    refused(
      () => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("loot")], target: { type: "faction", playerId: P2 } }),
      "attacking with a character gained this turn",
      /did not start the turn/
    );
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("mine")], target: { type: "faction", playerId: P2 } });
    assert.ok(engine.state.battle, "control: my own character attacks");
  });

  rule("CR 204.3a", "a character can use its abilities the turn it enters play, including one whose cost depletes it", () => {
    const smith = character({
      name: "Smith",
      cost: 0,
      behavior: {
        abilities: [
          { id: "free", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] },
          { id: "tap", type: "activated", costs: [{ type: "deplete", target: "source" }], effects: [{ type: "modifyInfluence", player: "controller", amount: 2 }] }
        ]
      }
    });
    const { engine, id } = buildGame({ cards: [{ key: "smith", def: smith, owner: P1, zone: "hand" }] });
    deploy(engine, P1, id("smith"));
    refused(
      () => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("smith")], target: { type: "faction", playerId: P2 } }),
      "attacking the turn it entered play",
      /did not start the turn/
    );
    const before = engine.state.players[P1].influence;
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("smith"), abilityId: "free" });
    resolvePendingResponses(engine);
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("smith"), abilityId: "tap" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, before + 3, "both abilities were used the turn the character entered play");
    assert.equal(engine.state.cards[id("smith")]!.depleted, true, "including the one that depletes it");
  });

  rule("CR 204.3b", "a character put into play by an effect at the start of the turn cannot attack that turn", () => {
    const banner = item({
      name: "Muster Banner",
      behavior: {
        abilities: [
          {
            id: "dawn",
            type: "triggered",
            event: "turnStarted",
            condition: { type: "eventPlayerIs", player: "controller" },
            effects: [{ type: "deployForFree", player: "controller", maxCost: 9, selector: { type: "character", zone: "hand" } }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "banner", def: banner, owner: P1 },
        { key: "veteran", def: character({ name: "Veteran" }), owner: P1 },
        { key: "recruit", def: character({ name: "Recruit" }), owner: P1, zone: "hand" }
      ],
      activePlayerId: P2
    });
    passTurn(engine, P2);
    assert.equal(engine.state.activePlayerId, P1, "my turn has started");
    assert.equal(pending(engine)?.kind, "deployForFree", "the start-of-turn effect offers the deployment");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id("recruit") } });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    assert.equal(zone(engine, id("recruit")), "play", "deployed by the start-of-turn effect");
    refused(
      () => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("recruit")], target: { type: "faction", playerId: P2 } }),
      "attacking with a character put into play at the start of the turn",
      /did not start the turn/
    );
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("veteran")], target: { type: "faction", playerId: P2 } });
    assert.ok(engine.state.battle, "control: the veteran that was in play at the start of the turn attacks");
  });

  rule("CR 204.4", "a character has strength, life and speed", () => {
    const { engine, id } = buildGame({ cards: [{ key: "c", def: character({ name: "C", strength: 3, life: 6, speed: 2 }), owner: P1 }] });
    assert.deepEqual(
      [engine.getStat(id("c"), "strength"), engine.getStat(id("c"), "life"), engine.getStat(id("c"), "speed")],
      [3, 6, 2],
      "STR, LIFE and SPD as printed"
    );
  });

  rule("CR 204.4a", "strength is how much damage a character inflicts in battle: a blocked attacker puts exactly its strength on the blocker, and an unblocked one costs the faction its strength in influence", () => {
    for (const strength of [1, 2, 4]) {
      const blocked = buildGame({
        cards: [
          { key: "atk", def: character({ name: "Atk", strength, life: 9 }), owner: P1 },
          { key: "wall", def: character({ name: "Wall", strength: 0, life: 9 }), owner: P2 }
        ]
      });
      fight(blocked.engine, [blocked.id("atk")], { type: "faction", playerId: P2 }, [blocked.id("wall")]);
      assert.equal(blocked.engine.state.cards[blocked.id("wall")]!.damage, strength, `strength ${strength} inflicts ${strength}`);
    }
    const open = buildGame({ cards: [{ key: "atk", def: character({ name: "Atk", strength: 3 }), owner: P1 }] });
    const before = open.engine.state.players[P2].influence;
    fight(open.engine, [open.id("atk")], { type: "faction", playerId: P2 });
    assert.equal(open.engine.state.players[P2].influence, before - 3, "unblocked: the faction loses influence equal to the strength");
  });

  rule("CR 204.4b", "life is how much damage it takes to destroy a character: life-1 damage in battle leaves it standing, life destroys it", () => {
    for (const [strength, survives] of [[2, true], [3, false]] as const) {
      const { engine, id } = buildGame({
        cards: [
          { key: "atk", def: character({ name: "Atk", strength, life: 9 }), owner: P1 },
          { key: "wall", def: character({ name: "Wall", strength: 0, life: 3 }), owner: P2 }
        ]
      });
      fight(engine, [id("atk")], { type: "faction", playerId: P2 }, [id("wall")]);
      assert.equal(zone(engine, id("wall")), survives ? "play" : "discard", `${strength} damage against life 3`);
    }
  });

  rule("CR 204.4c", "speed defines when a character's damage is inflicted: a faster character destroys a slower one before it can hurt back", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "fast", def: character({ name: "Fast", strength: 3, life: 3, speed: 3 }), owner: P1 },
        { key: "slow", def: character({ name: "Slow", strength: 3, life: 3, speed: 1 }), owner: P2 }
      ]
    });
    fight(engine, [id("fast")], { type: "faction", playerId: P2 }, [id("slow")]);
    assert.equal(zone(engine, id("slow")), "discard", "the slower blocker was destroyed");
    assert.equal(zone(engine, id("fast")), "play", "the faster attacker never took damage");
    assert.equal(engine.state.cards[id("fast")]!.damage, 0, "because the slower character was destroyed before its damage was inflicted");
  });

  rule("CR 204.4c", "the faster side is the one that strikes first whichever side it is on", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "slow", def: character({ name: "Slow", strength: 3, life: 3, speed: 1 }), owner: P1 },
        { key: "fast", def: character({ name: "Fast", strength: 3, life: 3, speed: 3 }), owner: P2 }
      ]
    });
    fight(engine, [id("slow")], { type: "faction", playerId: P2 }, [id("fast")]);
    assert.equal(zone(engine, id("slow")), "discard", "the slower attacker was destroyed");
    assert.equal(engine.state.cards[id("fast")]!.damage, 0, "the faster blocker took nothing");
  });

  rule("CR 204.4c", "characters of equal speed inflict their damage at the same time, so both can be destroyed", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 3, life: 3, speed: 2 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 3, life: 3, speed: 2 }), owner: P2 }
      ]
    });
    fight(engine, [id("a")], { type: "faction", playerId: P2 }, [id("b")]);
    assert.equal(zone(engine, id("a")), "discard", "A took B's damage");
    assert.equal(zone(engine, id("b")), "discard", "B took A's damage");
  });

  rule("CR 204.5", "damage equal to life destroys a character at once; one less leaves it in play; more than life destroys it too", () => {
    for (const [amount, survives] of [[2, true], [3, false], [5, false]] as const) {
      const { engine, id } = buildGame({
        cards: [
          { key: "z", def: zapper("Z", amount), owner: P1 },
          { key: "victim", def: character({ name: "Victim", life: 3 }), owner: P2 }
        ]
      });
      zap(engine, id("z"), id("victim"));
      assert.equal(zone(engine, id("victim")), survives ? "play" : "discard", `${amount} damage against life 3`);
      if (survives) assert.equal(engine.state.cards[id("victim")]!.damage, 2, "the damage stays on the character");
    }
  });

  rule("CR 204.5", "damage received in one turn adds up: two hits of 2 destroy a life-3 character on the second hit", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "z", def: zapper("Z", 2), owner: P1 },
        { key: "victim", def: character({ name: "Victim", life: 3 }), owner: P2 }
      ]
    });
    zap(engine, id("z"), id("victim"));
    assert.equal(zone(engine, id("victim")), "play", "after the first hit (2 of 3)");
    zap(engine, id("z"), id("victim"));
    assert.equal(zone(engine, id("victim")), "discard", "the second hit made 4 damage this turn");
  });

  rule("CR 204.5", "only damage received in a single turn counts: damage from an earlier turn is forgotten", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "z", def: zapper("Z", 2), owner: P1 },
        { key: "victim", def: character({ name: "Victim", life: 3 }), owner: P2 }
      ]
    });
    zap(engine, id("z"), id("victim"));
    assert.equal(engine.state.cards[id("victim")]!.damage, 2, "damaged this turn");
    passTurn(engine, P1);
    passTurn(engine, P2);
    assert.equal(engine.state.cards[id("victim")]!.damage, 0, "a new turn: the damage is gone");
    zap(engine, id("z"), id("victim"));
    assert.equal(zone(engine, id("victim")), "play", "2 more damage in this turn does not add to last turn's");
  });

  rule("CR 204.5", "a character is destroyed immediately when its life is lowered to the damage it has already received", () => {
    const curse = item({
      name: "Curse",
      cost: 0,
      behavior: {
        abilities: [
          {
            id: "c",
            type: "continuous",
            modifiers: [{ selector: { controller: "opponent", type: "character" }, stat: "life", operation: "add", value: -1 }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "curse", def: curse, owner: P1, zone: "hand" },
        { key: "wounded", def: character({ name: "Wounded", life: 3 }), owner: P2, damage: 2 },
        { key: "fresh", def: character({ name: "Fresh", life: 3 }), owner: P2 }
      ]
    });
    assert.equal(zone(engine, id("wounded")), "play", "before: 2 damage against life 3");
    deploy(engine, P1, id("curse"));
    assert.equal(zone(engine, id("wounded")), "discard", "2 damage against life 2: destroyed without waiting for anything");
    assert.equal(zone(engine, id("fresh")), "play", "an undamaged character is unaffected");
    assert.equal(engine.getStat(id("fresh"), "life"), 2, "the curse really did lower life by 1");
  });
});

describe("CR 205 — tactics", () => {
  const gain = (name: string, amount = 1) =>
    tactic({ name, behavior: { abilities: [{ id: "g", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount }] }] } });

  rule("CR 205.1", "a tactic can be deployed during your own turn", () => {
    const { engine, id } = buildGame({ cards: [{ key: "t", def: gain("T", 2), owner: P1, zone: "hand" }] });
    const before = engine.state.players[P1].influence;
    deploy(engine, P1, id("t"));
    assert.equal(engine.state.players[P1].influence, before + 2, "it resolved");
  });

  rule("CR 205.1", "a tactic can be deployed in response to the opponent's action even when it is not your turn", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "opener", def: blank("Opener"), owner: P1, zone: "hand" },
        { key: "reply", def: gain("Reply", 2), owner: P2, zone: "hand" }
      ]
    });
    const before = engine.state.players[P2].influence;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("opener") });
    assert.equal(engine.state.activePlayerId, P1, "not P2's turn");
    engine.perform({ type: "playCard", playerId: P2, cardId: id("reply") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P2].influence, before + 2, "the response resolved");
    assert.equal(zone(engine, id("reply")), "discard", "and left the hand");
  });

  rule("CR 205.1", "without an action to respond to, the non-active player cannot deploy a tactic (control: once the opponent acts they can)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "reply", def: blank("Reply"), owner: P2, zone: "hand" },
        { key: "opener", def: blank("Opener"), owner: P1, zone: "hand" }
      ]
    });
    refused(
      () => engine.perform({ type: "playCard", playerId: P2, cardId: id("reply") }),
      "a tactic on the opponent's turn with nothing to respond to",
      /Only the active player/
    );
    engine.perform({ type: "playCard", playerId: P1, cardId: id("opener") });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("reply") });
    assert.equal(engine.state.responseStack.length, 2, "control: with an action on the stack it is accepted");
  });

  rule("CR 205.1", "tactics can be deployed at special times during battles: when attackers are declared and when blockers are declared", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "atk", def: character({ name: "Atk" }), owner: P1 },
        { key: "wall", def: character({ name: "Wall", life: 9 }), owner: P2 },
        { key: "atkTactic", def: gain("AtkTactic"), owner: P1, zone: "hand" },
        { key: "defTactic", def: gain("DefTactic"), owner: P2, zone: "hand" }
      ]
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk")], target: { type: "faction", playerId: P2 } });
    assert.ok(engine.state.battle, "a battle is under way");
    engine.perform({ type: "passPriority", playerId: P1 });
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "after attackers are declared the defender may respond");
    engine.perform({ type: "playCard", playerId: P2, cardId: id("defTactic") });
    resolvePendingResponses(engine);
    assert.equal(zone(engine, id("defTactic")), "discard", "the defender's tactic was deployed during the battle");

    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("wall")] });
    assert.ok(engine.state.responseWindow, "after blockers are declared a window opens");
    const holder = engine.state.responseWindow!.priorityPlayerId;
    const tacticKey = holder === P1 ? "atkTactic" : "defTactic";
    assert.equal(holder, P1, "the attacker acts first after blockers");
    engine.perform({ type: "playCard", playerId: P1, cardId: id(tacticKey) });
    resolvePendingResponses(engine);
    assert.equal(zone(engine, id("atkTactic")), "discard", "the attacker's tactic was deployed after blockers were declared");
  });

  rule("CR 205.2", "when a tactic resolves its instructions are followed and it goes to its owner's discard pile (not into play)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "mine", def: gain("Mine", 2), owner: P1, zone: "hand" },
        { key: "theirs", def: gain("Theirs", 3), owner: P2, zone: "hand" }
      ]
    });
    const p1 = engine.state.players[P1].influence;
    const p2 = engine.state.players[P2].influence;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("mine") });
    assert.equal(engine.state.players[P1].influence, p1, "nothing happens before it resolves");
    assert.equal(zone(engine, id("mine")), "deploying", "and it is not yet in the discard pile");
    engine.perform({ type: "playCard", playerId: P2, cardId: id("theirs") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, p1 + 2, "P1's instructions were followed");
    assert.equal(engine.state.players[P2].influence, p2 + 3, "P2's instructions were followed");
    assert.equal(zone(engine, id("mine")), "discard", "P1's tactic is in the discard pile");
    assert.ok(engine.state.players[P1].discard.includes(id("mine")), "specifically its owner's discard pile");
    assert.ok(engine.state.players[P2].discard.includes(id("theirs")), "P2's tactic is in P2's discard pile");
    assert.ok(!engine.state.players[P1].play.includes(id("mine")), "a tactic never enters play");
  });
});
