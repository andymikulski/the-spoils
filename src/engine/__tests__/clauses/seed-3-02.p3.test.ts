// Clause tests, batch seed-3-02, part p3 (groups 10-13): Shieldmane Grandchest, The Great Wall of
// Keeping Stuff Out, The Stone of Triumph, The Evil Alliance. Every expectation comes from the PRINTED text.

import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import { buildGame, activate, bank, character, developFaction, item, killTactic, location, P1, P2, play, resolvePendingResponses, resourceCard, tactic, volition } from "../per-card/_harness.js";
import { declareAttackOpenWindow, fight, fightThrough } from "./_battle.js";
import { answerPending, pending, zoneOf } from "./_board.js";
import { clause, exempt, printing, refused, flipUpNow, holdResourceFace } from "./_clause.js";
import { defaultFactionDefinition, factionCard } from "../support/fixtures.js";
import { attachedCount, developDraw, developResource, endTurn, factionOf, readyCount, setupGame, spentResources, developOffers, endTurnRaw, developDrawLeft } from "./_turn.js";
import { chooseDevelopOption, isDevelopChoice, settleTurnStart } from "../support/develop.js";
import * as sd from "./_showdown.js";

type Cards = NonNullable<NonNullable<Parameters<typeof buildGame>[0]>["cards"]>;

const GRAND = "452bed36-af64-4986-905b-6074fd01437b"; // character . warlord . cost 8 . [R] . 6/3/6 -- UNIQUE GRANDCHEST -- reduce battle damage to your characters by 2; increase battle damage to opposing characters by 2
const AXE = "b57044fc-e7a2-409d-bbf2-2dbe4e93519e"; // Axeclaw Grandchest: character . cost 4 . [D][D][D] -- UNIQUE GRANDCHEST
const WALL = "8866ccbf-a8dc-4c2f-8dbc-4d879b5b10cf"; // location . warlord . cost 5 . [R][R][R][R] . structure 2 -- If a player plays a tactic, terminate it and inflict 1 damage to this card.
const STONE = "dc1f0f31-d593-4619-8af1-9a66cd544e5c"; // item . warlord . cost 3 . [R] -- If a character you control is destroyed, you may pay 1. If you do, search your deck for a card with the same name, reveal it, and put it on top of your deck.
const EVIL = "9dc309f4-d43f-4515-841e-ed982ce026e7"; // faction . Universal (Showdown)

/** Both players get a faction that can develop (draw or play a resource). */
const factions = () => ({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() } });

/** Deterministic pseudo-random source (LCG) for shuffles. */
const lcg = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const ch = (name: string, strength: number, life: number, speed = 1): CardDefinition => character({ name, strength, life, speed });
const influence = (engine: SpoilsEngine, p: PlayerId): number => engine.state.players[p].influence;
const dmg = (engine: SpoilsEngine, id: CardInstanceId): number => engine.state.cards[id].damage ?? 0;

/** A free tactic that deals `amount` (non-battle) damage to a chosen character in play. */
const dmgTactic = (amount: number): CardDefinition =>
  tactic({
    name: `Zap${amount}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "z",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });

/** A free tactic that destroys a chosen item in play. */
const killItem = (): CardDefinition =>
  tactic({
    name: "KillItem",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "k",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

// =====================================================================================
// Shieldmane Grandchest
// =====================================================================================

/** A battle board: `attacker` is the active player. */
const battleBoard = (attacker: PlayerId, cards: Cards, random?: () => number) =>
  buildGame({ ...factions(), turn: 2, activePlayerId: attacker, random, cards });

// --- 0:unique -------------------------------------------------------------------------------

const deployBoard = (extra: Cards = [], resources: Cards = bank("rage", 8, P1)) =>
  buildGame({ ...factions(), cards: [{ key: "new", def: printing(GRAND), owner: P1, zone: "hand" }, ...resources, ...extra] });

clause(GRAND, "0:unique", "deploys for its printed cost 8 and [R] threshold with printed stats 6 strength / 3 speed / 6 life; refused one resource short or without Rage", () => {
  const ok = deployBoard([], [...bank("rage", 1, P1), ...bank("greed", 7, P1)]); // one [R] icon is all [R] needs
  assert.equal(readyCount(ok.engine, P1), 8);
  play(ok.engine, P1, ok.id("new"));
  assert.equal(zoneOf(ok.engine, ok.id("new")), "play");
  assert.equal(readyCount(ok.engine, P1), 0, "all 8 are paid");
  assert.equal(ok.engine.getStat(ok.id("new"), "strength"), 6);
  assert.equal(ok.engine.getStat(ok.id("new"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("new"), "life"), 6);

  const short = deployBoard([], bank("rage", 7, P1));
  refused(() => play(short.engine, P1, short.id("new")), "7 resources can't pay cost 8", /pay|afford|resource|cost/i);
  assert.equal(zoneOf(short.engine, short.id("new")), "hand");

  const wrongIcon = deployBoard([], bank("greed", 8, P1));
  refused(() => play(wrongIcon.engine, P1, wrongIcon.id("new")), "[R] threshold not met by Greed", /threshold|icon|rage/i);
  assert.equal(zoneOf(wrongIcon.engine, wrongIcon.id("new")), "hand");
});

clause(GRAND, "0:unique", "UNIQUE GRANDCHEST: deploying a second one makes me choose which to keep; keeping the new one destroys the old one", () => {
  const { engine, id } = deployBoard([{ key: "old", def: printing(GRAND), owner: P1, zone: "play" }]);
  play(engine, P1, id("new"));
  const pc = pending(engine)!;
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "I choose");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [id("old"), id("new")].sort());
  answerPending(engine, "uniqueSurvivor", { keep: id("new") });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("new")), "play");
  assert.equal(zoneOf(engine, id("old")), "discard", "the extra copy is destroyed");
});

clause(GRAND, "0:unique", "keeping the old one destroys the new one instead", () => {
  const { engine, id } = deployBoard([{ key: "old", def: printing(GRAND), owner: P1, zone: "play" }]);
  play(engine, P1, id("new"));
  answerPending(engine, "uniqueSurvivor", { keep: id("old") });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("old")), "play");
  assert.equal(zoneOf(engine, id("new")), "discard");
});

clause(GRAND, "0:unique", "the identifier is GRANDCHEST: Axeclaw Grandchest (also UNIQUE GRANDCHEST) conflicts with it", () => {
  const { engine, id } = deployBoard([{ key: "axe", def: printing(AXE), owner: P1, zone: "play" }]);
  play(engine, P1, id("new"));
  const pc = pending(engine)!;
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [id("axe"), id("new")].sort());
  answerPending(engine, "uniqueSurvivor", { keep: id("axe") });
  assert.equal(zoneOf(engine, id("axe")), "play");
  assert.equal(zoneOf(engine, id("new")), "discard");
});

clause(GRAND, "0:unique", "a character with a different unique identifier does not conflict", () => {
  const { engine, id } = deployBoard([{ key: "other", def: character({ name: "Other Unique", unique: "other" }), owner: P1, zone: "play" }]);
  play(engine, P1, id("new"));
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("new")), "play");
  assert.equal(zoneOf(engine, id("other")), "play");
});

clause(GRAND, "0:unique", "the restriction is per player: my opponent may control their own Grandchest at the same time", () => {
  const { engine, id } = deployBoard([{ key: "theirs", def: printing(GRAND), owner: P2, zone: "play" }]);
  play(engine, P1, id("new"));
  assert.equal(pending(engine), undefined, "no survivor choice");
  assert.equal(zoneOf(engine, id("new")), "play");
  assert.equal(zoneOf(engine, id("theirs")), "play");
});

// --- 1:rule (my characters) ---------------------------------------------------------------

/** P2 attacks my faction with a `strength` character; my `blk` blocks. Returns the damage on my blocker. */
function damageToMyBlocker(strength: number, withGrandchest = true): number {
  const { engine, id } = battleBoard(P2, [
    ...(withGrandchest ? [{ key: "gc", def: printing(GRAND), owner: P1, zone: "play" as const }] : []),
    { key: "blk", def: ch("Blocker", 1, 20), owner: P1, zone: "play" },
    { key: "atk", def: ch("Attacker", strength, 20, 2), owner: P2, zone: "play" }
  ]);
  fight(engine, P2, [id("atk")], { type: "faction", playerId: P1 }, [id("blk")]);
  return dmg(engine, id("blk"));
}

clause(GRAND, "1:rule", "battle damage inflicted to a character I control is reduced by 2 (5 -> 3, 9 -> 7), and only with Grandchest in play", () => {
  assert.equal(damageToMyBlocker(5, false), 5, "control: no Grandchest, full damage");
  assert.equal(damageToMyBlocker(5), 3);
  assert.equal(damageToMyBlocker(9), 7);
  assert.equal(damageToMyBlocker(3), 1);
});

clause(GRAND, "1:rule", "the reduction cannot go below 0: damage of 2 or 1 becomes 0 and the character takes none", () => {
  assert.equal(damageToMyBlocker(2), 0);
  assert.equal(damageToMyBlocker(1), 0);
});

clause(GRAND, "1:rule", "also reduces damage to my ATTACKING characters", () => {
  const { engine, id } = battleBoard(P1, [
    { key: "gc", def: printing(GRAND), owner: P1, zone: "play" },
    { key: "atk", def: ch("My Attacker", 3, 20, 2), owner: P1, zone: "play" },
    { key: "blk", def: ch("Their Blocker", 6, 20), owner: P2, zone: "play" }
  ]);
  fight(engine, P1, [id("atk")], { type: "faction", playerId: P2 }, [id("blk")]);
  assert.equal(dmg(engine, id("atk")), 4, "6 - 2");
});

clause(GRAND, "1:rule", "reduces damage to Shieldmane Grandchest itself (a character I control)", () => {
  const { engine, id } = battleBoard(P2, [
    { key: "gc", def: printing(GRAND), owner: P1, zone: "play" },
    { key: "atk", def: ch("Attacker", 5, 30, 2), owner: P2, zone: "play" }
  ]);
  fight(engine, P2, [id("atk")], { type: "faction", playerId: P1 }, [id("gc")]);
  assert.equal(dmg(engine, id("gc")), 3, "5 - 2");
  assert.equal(zoneOf(engine, id("gc")), "play");
});

clause(GRAND, "1:rule", "does not reduce battle damage to my faction (unblocked attack): the full 5 influence is lost", () => {
  const { engine, id } = battleBoard(P2, [
    { key: "gc", def: printing(GRAND), owner: P1, zone: "play" },
    { key: "atk", def: ch("Attacker", 5, 20, 2), owner: P2, zone: "play" }
  ]);
  const before = influence(engine, P1);
  fight(engine, P2, [id("atk")], { type: "faction", playerId: P1 }, []);
  assert.equal(before - influence(engine, P1), 5);
});

clause(GRAND, "1:rule", "does not reduce battle damage to a location I control (not a character)", () => {
  const { engine, id } = battleBoard(P2, [
    { key: "gc", def: printing(GRAND), owner: P1, zone: "play" },
    { key: "loc", def: location({ name: "My Place", structure: 12 }), owner: P1, zone: "play" },
    { key: "atk", def: ch("Attacker", 5, 20, 2), owner: P2, zone: "play" }
  ]);
  fight(engine, P2, [id("atk")], { type: "card", cardId: id("loc") }, []);
  assert.equal(dmg(engine, id("loc")), 5);
});

clause(GRAND, "1:rule", "only BATTLE damage: damage from a tactic to my character is not reduced", () => {
  const { engine, id } = battleBoard(P2, [
    { key: "gc", def: printing(GRAND), owner: P1, zone: "play" },
    { key: "mine", def: ch("Mine", 1, 20), owner: P1, zone: "play" },
    { key: "zap", def: dmgTactic(4), owner: P2, zone: "hand" }
  ]);
  play(engine, P2, id("zap"), { selected: { t: [id("mine")] } });
  assert.equal(dmg(engine, id("mine")), 4);
});

clause(GRAND, "1:rule", "static: no reduction while it is in hand, none once it has been destroyed", () => {
  const hand = battleBoard(P2, [
    { key: "gc", def: printing(GRAND), owner: P1, zone: "hand" },
    { key: "blk", def: ch("Blocker", 1, 20), owner: P1, zone: "play" },
    { key: "atk", def: ch("Attacker", 5, 20, 2), owner: P2, zone: "play" }
  ]);
  fight(hand.engine, P2, [hand.id("atk")], { type: "faction", playerId: P1 }, [hand.id("blk")]);
  assert.equal(dmg(hand.engine, hand.id("blk")), 5, "in hand: full damage");

  const dead = battleBoard(P2, [
    { key: "gc", def: printing(GRAND), owner: P1, zone: "play" },
    { key: "blk", def: ch("Blocker", 1, 20), owner: P1, zone: "play" },
    { key: "atk", def: ch("Attacker", 5, 20, 2), owner: P2, zone: "play" },
    { key: "kill", def: killTactic(), owner: P2, zone: "hand" }
  ]);
  play(dead.engine, P2, dead.id("kill"), { selected: { t: [dead.id("gc")] } });
  assert.equal(zoneOf(dead.engine, dead.id("gc")), "discard");
  fight(dead.engine, P2, [dead.id("atk")], { type: "faction", playerId: P1 }, [dead.id("blk")]);
  assert.equal(dmg(dead.engine, dead.id("blk")), 5, "after it leaves play: full damage");
  assert.equal(dmg(dead.engine, dead.id("atk")), 1, "and no increase to the opposing attacker either");
});

clause(GRAND, "1:rule", "damage from several characters of the same speed is summed, then reduced once (3+3 -> 4)", () => {
  const { engine, id } = battleBoard(P2, [
    { key: "gc", def: printing(GRAND), owner: P1, zone: "play" },
    { key: "blk", def: ch("Blocker", 1, 30), owner: P1, zone: "play" },
    { key: "a1", def: ch("Attacker 1", 3, 20, 2), owner: P2, zone: "play" },
    { key: "a2", def: ch("Attacker 2", 3, 20, 2), owner: P2, zone: "play" }
  ]);
  fight(engine, P2, [id("a1"), id("a2")], { type: "faction", playerId: P1 }, [id("blk")]);
  assert.equal(dmg(engine, id("blk")), 4, "(3 + 3) - 2, a single amount (CR 609.1f)");
});

clause(GRAND, "1:rule", "damage at different speeds is two separate infliction steps, each reduced (4 at speed 3 and 4 at speed 1 -> 2 + 2)", () => {
  const { engine, id } = battleBoard(P2, [
    { key: "gc", def: printing(GRAND), owner: P1, zone: "play" },
    { key: "blk", def: ch("Blocker", 1, 30), owner: P1, zone: "play" },
    { key: "fast", def: ch("Fast", 4, 20, 3), owner: P2, zone: "play" },
    { key: "slow", def: ch("Slow", 4, 20, 1), owner: P2, zone: "play" }
  ]);
  fight(engine, P2, [id("fast"), id("slow")], { type: "faction", playerId: P1 }, [id("blk")]);
  assert.equal(dmg(engine, id("blk")), 4, "(4 - 2) + (4 - 2)");
});

// --- 2:rule (opposing characters) ---------------------------------------------------------------

/** I attack with a `strength` character; the opponent's `blk` blocks. Returns the damage on their blocker. */
function damageToTheirBlocker(strength: number, withGrandchest = true): number {
  const { engine, id } = battleBoard(P1, [
    ...(withGrandchest ? [{ key: "gc", def: printing(GRAND), owner: P1, zone: "play" as const }] : []),
    { key: "atk", def: ch("My Attacker", strength, 20, 2), owner: P1, zone: "play" },
    { key: "blk", def: ch("Their Blocker", 1, 30), owner: P2, zone: "play" }
  ]);
  fight(engine, P1, [id("atk")], { type: "faction", playerId: P2 }, [id("blk")]);
  return dmg(engine, id("blk"));
}

clause(GRAND, "2:rule", "battle damage inflicted to a character my opponent controls is increased by 2 (3 -> 5, 1 -> 3), and only with Grandchest in play", () => {
  assert.equal(damageToTheirBlocker(3, false), 3, "control: no Grandchest, printed damage");
  assert.equal(damageToTheirBlocker(3), 5);
  assert.equal(damageToTheirBlocker(1), 3);
  assert.equal(damageToTheirBlocker(7), 9);
});

clause(GRAND, "2:rule", "an attempt to inflict 0 damage inflicts nothing, so nothing is increased (CR 408.1)", () => {
  assert.equal(damageToTheirBlocker(0), 0);
});

clause(GRAND, "2:rule", "also increases damage to the opponent's ATTACKING characters", () => {
  const { engine, id } = battleBoard(P2, [
    { key: "gc", def: printing(GRAND), owner: P1, zone: "play" },
    { key: "blk", def: ch("My Blocker", 2, 20), owner: P1, zone: "play" },
    { key: "atk", def: ch("Their Attacker", 3, 20, 2), owner: P2, zone: "play" }
  ]);
  fight(engine, P2, [id("atk")], { type: "faction", playerId: P1 }, [id("blk")]);
  assert.equal(dmg(engine, id("atk")), 4, "2 + 2");
});

clause(GRAND, "2:rule", "does not increase battle damage to the opponent's faction (unblocked): exactly 3 influence is lost", () => {
  const { engine, id } = battleBoard(P1, [
    { key: "gc", def: printing(GRAND), owner: P1, zone: "play" },
    { key: "atk", def: ch("My Attacker", 3, 20, 2), owner: P1, zone: "play" }
  ]);
  const before = influence(engine, P2);
  fight(engine, P1, [id("atk")], { type: "faction", playerId: P2 }, []);
  assert.equal(before - influence(engine, P2), 3);
});

clause(GRAND, "2:rule", "does not increase battle damage to an opponent's location (not a character)", () => {
  const { engine, id } = battleBoard(P1, [
    { key: "gc", def: printing(GRAND), owner: P1, zone: "play" },
    { key: "atk", def: ch("My Attacker", 3, 20, 2), owner: P1, zone: "play" },
    { key: "loc", def: location({ name: "Their Place", structure: 12 }), owner: P2, zone: "play" }
  ]);
  fight(engine, P1, [id("atk")], { type: "card", cardId: id("loc") }, []);
  assert.equal(dmg(engine, id("loc")), 3);
});

clause(GRAND, "2:rule", "only BATTLE damage: damage from a tactic to an opponent's character is not increased", () => {
  const { engine, id } = battleBoard(P1, [
    { key: "gc", def: printing(GRAND), owner: P1, zone: "play" },
    { key: "theirs", def: ch("Theirs", 1, 20), owner: P2, zone: "play" },
    { key: "zap", def: dmgTactic(4), owner: P1, zone: "hand" }
  ]);
  play(engine, P1, id("zap"), { selected: { t: [id("theirs")] } });
  assert.equal(dmg(engine, id("theirs")), 4);
});

clause(GRAND, "2:rule", "static: no increase while in hand or after it was destroyed", () => {
  const hand = battleBoard(P1, [
    { key: "gc", def: printing(GRAND), owner: P1, zone: "hand" },
    { key: "atk", def: ch("My Attacker", 3, 20, 2), owner: P1, zone: "play" },
    { key: "blk", def: ch("Their Blocker", 1, 30), owner: P2, zone: "play" }
  ]);
  fight(hand.engine, P1, [hand.id("atk")], { type: "faction", playerId: P2 }, [hand.id("blk")]);
  assert.equal(dmg(hand.engine, hand.id("blk")), 3, "in hand: printed damage");

  const dead = battleBoard(P1, [
    { key: "gc", def: printing(GRAND), owner: P1, zone: "play" },
    { key: "atk", def: ch("My Attacker", 3, 20, 2), owner: P1, zone: "play" },
    { key: "blk", def: ch("Their Blocker", 1, 30), owner: P2, zone: "play" },
    { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
  ]);
  play(dead.engine, P1, dead.id("kill"), { selected: { t: [dead.id("gc")] } });
  assert.equal(zoneOf(dead.engine, dead.id("gc")), "discard");
  fight(dead.engine, P1, [dead.id("atk")], { type: "faction", playerId: P2 }, [dead.id("blk")]);
  assert.equal(dmg(dead.engine, dead.id("blk")), 3, "after it leaves play: printed damage");
  assert.equal(dmg(dead.engine, dead.id("atk")), 1, "and my character's damage isn't reduced either");
});

clause(GRAND, "2:rule", "damage from several characters of the same speed is summed, then increased once (3+3 -> 8)", () => {
  const { engine, id } = battleBoard(P1, [
    { key: "gc", def: printing(GRAND), owner: P1, zone: "play" },
    { key: "a1", def: ch("Attacker 1", 3, 20, 2), owner: P1, zone: "play" },
    { key: "a2", def: ch("Attacker 2", 3, 20, 2), owner: P1, zone: "play" },
    { key: "blk", def: ch("Their Blocker", 1, 30), owner: P2, zone: "play" }
  ]);
  fight(engine, P1, [id("a1"), id("a2")], { type: "faction", playerId: P2 }, [id("blk")]);
  assert.equal(dmg(engine, id("blk")), 8, "(3 + 3) + 2");
});

clause(GRAND, ["1:rule", "2:rule"], "an opponent's Grandchest works from their side: it reduces damage to THEIR characters and increases damage to MINE", () => {
  const { engine, id } = battleBoard(P2, [
    { key: "theirGc", def: printing(GRAND), owner: P2, zone: "play" },
    { key: "blk", def: ch("My Blocker", 2, 30), owner: P1, zone: "play" },
    { key: "atk", def: ch("Their Attacker", 5, 20, 2), owner: P2, zone: "play" }
  ]);
  fight(engine, P2, [id("atk")], { type: "faction", playerId: P1 }, [id("blk")]);
  assert.equal(dmg(engine, id("blk")), 7, "my character takes 5 + 2 from their Grandchest");
  assert.equal(dmg(engine, id("atk")), 0, "their character takes 2 - 2 = 0");
});

clause(GRAND, ["1:rule", "2:rule"], "one Grandchest on each side: the +2 and -2 cancel for every character", () => {
  const { engine, id } = battleBoard(P2, [
    { key: "gc", def: printing(GRAND), owner: P1, zone: "play" },
    { key: "theirGc", def: printing(GRAND), owner: P2, zone: "play" },
    { key: "blk", def: ch("My Blocker", 4, 30), owner: P1, zone: "play" },
    { key: "atk", def: ch("Their Attacker", 6, 30, 2), owner: P2, zone: "play" }
  ]);
  fight(engine, P2, [id("atk")], { type: "faction", playerId: P1 }, [id("blk")]);
  assert.equal(dmg(engine, id("blk")), 6, "6 + 2 - 2");
  assert.equal(dmg(engine, id("atk")), 4, "4 + 2 - 2");
});

// =====================================================================================
// The Great Wall of Keeping Stuff Out
// =====================================================================================

/** A cost-2 tactic that draws its controller a card (so "its effect did not happen" is observable). */
const drawTactic = (name = "Draw1"): CardDefinition =>
  tactic({
    name,
    cost: 2,
    behavior: { abilities: [{ id: "d", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });

const wallBoard = (extra: Cards = [], wallOwner: PlayerId = P1, activePlayerId: PlayerId = P1, wallZone: "play" | "hand" = "play") =>
  buildGame({
    ...factions(),
    activePlayerId,
    turn: activePlayerId === P1 ? 1 : 2,
    cards: [
      { key: "wall", def: printing(WALL), owner: wallOwner, zone: wallZone },
      ...fillers("p1deck", 4, P1),
      ...fillers("p2deck", 4, P2),
      ...bank("rage", 6, P1),
      ...bank("rage", 6, P2),
      ...extra
    ]
  });

function fillers(prefix: string, n: number, owner: PlayerId): Cards {
  return Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: character({ name: `${prefix} ${i}` }), owner, zone: "deck" as const }));
}

clause(WALL, "0:rule", "a tactic I play is terminated (goes to my discard, its effect does not happen), the wall takes 1 damage, and the cost was still paid", () => {
  const { engine, id } = wallBoard([{ key: "t", def: drawTactic(), owner: P1, zone: "hand" }]);
  const handBefore = engine.state.players[P1].hand.length;
  const readyBefore = readyCount(engine, P1);
  play(engine, P1, id("t"));
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("t")), "discard", "terminated: into its owner's discard pile");
  assert.equal(engine.state.players[P1].hand.length, handBefore - 1, "the tactic left the hand and its draw did not happen");
  assert.equal(engine.state.players[P1].deck.length, 4, "nothing was drawn");
  assert.equal(dmg(engine, id("wall")), 1);
  assert.equal(readyBefore - readyCount(engine, P1), 2, "the tactic's cost 2 was paid when it was played");
  assert.equal(zoneOf(engine, id("wall")), "play");
});

clause(WALL, "0:rule", "a tactic whose effect would destroy my opponent's character does nothing: the character survives", () => {
  const { engine, id } = wallBoard([
    { key: "k", def: killTactic(), owner: P1, zone: "hand" },
    { key: "victim", def: character({ name: "Victim" }), owner: P2, zone: "play" }
  ]);
  play(engine, P1, id("k"), { selected: { t: [id("victim")] } });
  assert.equal(zoneOf(engine, id("k")), "discard");
  assert.equal(zoneOf(engine, id("victim")), "play", "terminated: the destroy never happens");
  assert.equal(dmg(engine, id("wall")), 1);
});

clause(WALL, "0:rule", "'a player': a tactic my opponent plays on their own turn is terminated too, and damages the wall", () => {
  const { engine, id } = wallBoard(
    [
      { key: "k", def: killTactic(), owner: P2, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" }
    ],
    P1,
    P2
  );
  play(engine, P2, id("k"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("k")), "discard");
  assert.ok(engine.state.players[P2].discard.includes(id("k")), "into its owner's (my opponent's) discard pile");
  assert.equal(zoneOf(engine, id("mine")), "play", "my character is safe");
  assert.equal(dmg(engine, id("wall")), 1, "the wall (mine) takes the damage");
});

clause(WALL, "0:rule", "'a player': works when the wall is under my opponent's control and I play the tactic", () => {
  const { engine, id } = wallBoard([{ key: "t", def: drawTactic(), owner: P1, zone: "hand" }], P2);
  play(engine, P1, id("t"));
  assert.equal(zoneOf(engine, id("t")), "discard");
  assert.equal(engine.state.players[P1].deck.length, 4, "no draw");
  assert.equal(dmg(engine, id("wall")), 1);
});

clause(WALL, "0:rule", "a tactic my opponent plays in response during MY turn is terminated as well", () => {
  const { engine, id } = wallBoard([
    { key: "atk", def: character({ name: "Attacker", strength: 1, life: 2, speed: 1 }), owner: P1, zone: "play" },
    { key: "t", def: drawTactic(), owner: P2, zone: "hand" }
  ]);
  declareAttackOpenWindow(engine, P1, [id("atk")]);
  play(engine, P2, id("t"));
  assert.equal(zoneOf(engine, id("t")), "discard");
  assert.equal(engine.state.players[P2].deck.length, 4, "no card drawn");
  assert.equal(dmg(engine, id("wall")), 1);
});

clause(WALL, "0:rule", "each tactic deals 1 damage: the second one destroys the wall (structure 2), and a third tactic then resolves normally", () => {
  const { engine, id } = wallBoard([
    { key: "t1", def: drawTactic("T1"), owner: P1, zone: "hand" },
    { key: "t2", def: drawTactic("T2"), owner: P1, zone: "hand" },
    { key: "t3", def: drawTactic("T3"), owner: P1, zone: "hand" }
  ]);
  play(engine, P1, id("t1"));
  assert.equal(dmg(engine, id("wall")), 1);
  assert.equal(zoneOf(engine, id("wall")), "play");
  play(engine, P1, id("t2"));
  assert.equal(zoneOf(engine, id("wall")), "discard", "2 damage on structure 2: destroyed");
  assert.equal(engine.state.players[P1].deck.length, 4, "neither of the first two drew");
  play(engine, P1, id("t3"));
  assert.equal(zoneOf(engine, id("t3")), "discard");
  assert.equal(engine.state.players[P1].deck.length, 3, "with the wall gone, the third tactic draws");
});

clause(WALL, "0:rule", "only tactics: deploying a character or an item, and using an ability, does not terminate anything or damage the wall", () => {
  const { engine, id } = wallBoard([
    { key: "c", def: character({ name: "Newcomer", cost: 1 }), owner: P1, zone: "hand" },
    { key: "i", def: item({ name: "Gadget", cost: 1 }), owner: P1, zone: "hand" },
    {
      key: "tool",
      def: item({
        name: "Tool",
        behavior: { abilities: [{ id: "u", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
      }),
      owner: P1,
      zone: "play"
    }
  ]);
  play(engine, P1, id("c"));
  play(engine, P1, id("i"));
  activate(engine, P1, id("tool"), "u");
  assert.equal(zoneOf(engine, id("c")), "play");
  assert.equal(zoneOf(engine, id("i")), "play");
  assert.equal(engine.state.players[P1].deck.length, 3, "the ability resolved and drew");
  assert.equal(dmg(engine, id("wall")), 0);
});

clause(WALL, "0:rule", "static: while the wall is not in play (in hand) a tactic resolves normally", () => {
  const { engine, id } = wallBoard([{ key: "t", def: drawTactic(), owner: P1, zone: "hand" }], P1, P1, "hand");
  play(engine, P1, id("t"));
  assert.equal(engine.state.players[P1].deck.length, 3, "drew a card");
  assert.equal(zoneOf(engine, id("t")), "discard");
  assert.equal(dmg(engine, id("wall")), 0, "the wall in hand takes nothing");
});

// =====================================================================================
// The Stone of Triumph
// =====================================================================================

const heroDef = (defId: string, name = "Hero"): CardDefinition => character({ id: defId, name, strength: 1, life: 3, speed: 1 });

/** Stone + a Hero in play, same-named Heroes (and others) in the deck, a kill tactic in hand, 3 Rage. */
const stoneBoard = (opts: { attacker?: PlayerId; rage?: number; stoneZone?: "play" | "hand"; extra?: Cards; random?: () => number } = {}) =>
  buildGame({
    ...factions(),
    ...(opts.attacker ? { turn: 2, activePlayerId: opts.attacker } : {}),
    random: opts.random ?? lcg(11),
    cards: [
      { key: "stone", def: printing(STONE), owner: P1, zone: opts.stoneZone ?? "play" },
      { key: "hero", def: heroDef("s302p3-hero-play"), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "f0", def: character({ name: "Filler 0" }), owner: P1, zone: "deck" },
      { key: "copyA", def: heroDef("s302p3-hero-a"), owner: P1, zone: "deck" },
      { key: "f1", def: character({ name: "Filler 1" }), owner: P1, zone: "deck" },
      { key: "f2", def: character({ name: "Filler 2" }), owner: P1, zone: "deck" },
      { key: "copyB", def: heroDef("s302p3-hero-b"), owner: P1, zone: "deck" },
      { key: "villain", def: heroDef("s302p3-villain", "Villain"), owner: P1, zone: "deck" },
      { key: "f3", def: character({ name: "Filler 3" }), owner: P1, zone: "deck" },
      { key: "f4", def: character({ name: "Filler 4" }), owner: P1, zone: "deck" },
      { key: "f5", def: character({ name: "Filler 5" }), owner: P1, zone: "deck" },
      ...bank("rage", opts.rage ?? 3, P1),
      ...(opts.extra ?? [])
    ]
  });

const DECK_KEYS = ["f0", "copyA", "f1", "f2", "copyB", "villain", "f3", "f4", "f5"];
const revealEvents = (engine: SpoilsEngine) => engine.getLog().filter((e) => e.event?.type === "cardsRevealed");

clause(STONE, "0:rule", "when my character is destroyed I get the option to pay 1; paying 1 resource, then picking a same-named card from my deck puts it on top, revealed", () => {
  const { engine, id } = stoneBoard();
  const ready = readyCount(engine, P1);
  play(engine, P1, id("kill"), { selected: { t: [id("hero")] } });
  assert.equal(zoneOf(engine, id("hero")), "discard");
  const mp = pending(engine)!;
  assert.equal(mp.kind, "mayPay");
  assert.equal(mp.playerId, P1);
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(ready - readyCount(engine, P1), 1, "exactly 1 resource is paid");
  const pick = pending(engine)!;
  assert.equal(pick.kind, "chooserSelectsTarget");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("copyA")] });
  assert.equal(pending(engine), undefined);
  assert.equal(engine.state.players[P1].deck[0], id("copyA"), "on top of my deck");
  assert.equal(zoneOf(engine, id("copyA")), "deck");
  assert.equal(engine.state.players[P1].deck.length, DECK_KEYS.length, "no card was added or lost");
  assert.deepEqual([...engine.state.players[P1].deck].sort(), DECK_KEYS.map(id).sort());
  const reveals = revealEvents(engine);
  assert.equal(reveals.length, 1, "revealed once");
  const ev = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual(ev.cardIds, [id("copyA")]);
  assert.equal(ev.viewerId, "all", "revealed to everyone");
});

clause(STONE, "0:rule", "either same-named card in the deck can be found (the second copy, from deeper in the deck, goes on top)", () => {
  const { engine, id } = stoneBoard();
  play(engine, P1, id("kill"), { selected: { t: [id("hero")] } });
  answerPending(engine, "mayPay", { pay: true });
  answerPending(engine, "chooserSelectsTarget", { selected: [id("copyB")] });
  assert.equal(engine.state.players[P1].deck[0], id("copyB"));
  assert.deepEqual([...engine.state.players[P1].deck].sort(), DECK_KEYS.map(id).sort());
});

clause(STONE, "0:rule", "'may pay 1': declining pays nothing, searches nothing, reveals nothing and leaves the deck as it was", () => {
  const { engine, id } = stoneBoard();
  const ready = readyCount(engine, P1);
  const deck = [...engine.state.players[P1].deck];
  play(engine, P1, id("kill"), { selected: { t: [id("hero")] } });
  answerPending(engine, "mayPay", { pay: false });
  assert.equal(pending(engine), undefined, "no search once the payment is declined");
  assert.equal(readyCount(engine, P1), ready);
  assert.deepEqual(engine.state.players[P1].deck, deck, "deck untouched, not even shuffled");
  assert.equal(revealEvents(engine).length, 0);
  assert.equal(zoneOf(engine, id("hero")), "discard");
});

clause(STONE, "0:rule", "I can't pay 1 with no resources: the search does not happen", () => {
  const { engine, id } = stoneBoard({ rage: 0 });
  const deck = [...engine.state.players[P1].deck];
  play(engine, P1, id("kill"), { selected: { t: [id("hero")] } });
  const pc = pending(engine);
  if (pc) {
    assert.equal(pc.kind, "mayPay");
    refused(() => answerPending(engine, "mayPay", { pay: true }), "paying 1 with nothing to pay with", /pay|afford|resource/i);
    answerPending(engine, "mayPay", { pay: false });
  }
  assert.equal(pending(engine), undefined);
  assert.deepEqual(engine.state.players[P1].deck, deck);
  assert.equal(revealEvents(engine).length, 0);
});

clause(STONE, "0:rule", "the search is for the SAME NAME as the destroyed character: only the same-named cards are pickable", () => {
  const { engine, id } = stoneBoard();
  play(engine, P1, id("kill"), { selected: { t: [id("hero")] } });
  answerPending(engine, "mayPay", { pay: true });
  const pc = pending(engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  for (const wrong of ["villain", "f0", "f3"]) {
    refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id(wrong)] }), `${wrong} has a different name`);
    assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  }
  answerPending(engine, "chooserSelectsTarget", { selected: [id("copyB")] });
  assert.equal(engine.state.players[P1].deck[0], id("copyB"));
});

clause(STONE, "0:rule", "the name searched for is the destroyed character's own: destroying a Villain finds the Villain, not a Hero", () => {
  const { engine, id } = stoneBoard({
    extra: [
      { key: "vIn", def: heroDef("s302p3-villain-play", "Villain"), owner: P1, zone: "play" }
    ]
  });
  play(engine, P1, id("kill"), { selected: { t: [id("vIn")] } });
  answerPending(engine, "mayPay", { pay: true });
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("copyA")] }), "a Hero is not named Villain");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("villain")] });
  assert.equal(engine.state.players[P1].deck[0], id("villain"));
});

clause(STONE, "0:rule", "searching may fail: after paying I may pick nothing even though matches exist; nothing moves or is revealed", () => {
  const { engine, id } = stoneBoard();
  const ready = readyCount(engine, P1);
  const deck = [...engine.state.players[P1].deck];
  play(engine, P1, id("kill"), { selected: { t: [id("hero")] } });
  answerPending(engine, "mayPay", { pay: true });
  answerPending(engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(pending(engine), undefined);
  assert.equal(ready - readyCount(engine, P1), 1, "the 1 was still paid");
  assert.deepEqual([...engine.state.players[P1].deck].sort(), [...deck].sort(), "no card left or entered the deck");
  assert.equal(revealEvents(engine).length, 0, "nothing found, nothing revealed");
});

clause(STONE, "0:rule", "with no same-named card in the deck, paying finds nothing and the deck keeps all its cards", () => {
  const { engine, id } = stoneBoard({
    extra: [{ key: "solo", def: heroDef("s302p3-solo", "Solo"), owner: P1, zone: "play" }]
  });
  const deck = [...engine.state.players[P1].deck];
  play(engine, P1, id("kill"), { selected: { t: [id("solo")] } });
  answerPending(engine, "mayPay", { pay: true });
  if (pending(engine)) answerPending(engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(pending(engine), undefined);
  assert.deepEqual([...engine.state.players[P1].deck].sort(), [...deck].sort());
  assert.equal(revealEvents(engine).length, 0);
});

clause(STONE, "0:rule", "(control) the same seeded random does reorder a deck when something shuffles it", () => {
  const { engine, id } = stoneBoard({
    random: lcg(5),
    extra: [
      {
        key: "shuf",
        def: tactic({ name: "Shuffler", cost: 0, behavior: { abilities: [{ id: "s", type: "activated", effects: [{ type: "shuffleDeck", player: "controller" }] }] } }),
        owner: P1,
        zone: "hand"
      }
    ]
  });
  const before = [...engine.state.players[P1].deck];
  play(engine, P1, id("shuf"));
  assert.notDeepEqual(engine.state.players[P1].deck, before);
  assert.deepEqual([...engine.state.players[P1].deck].sort(), [...before].sort());
});

clause(STONE, "0:rule", "a searched deck is shuffled afterwards (CR 312.1): the found card is on top and the rest is in a new order", () => {
  const { engine, id } = stoneBoard({ random: lcg(5) });
  const before = [...engine.state.players[P1].deck];
  play(engine, P1, id("kill"), { selected: { t: [id("hero")] } });
  answerPending(engine, "mayPay", { pay: true });
  answerPending(engine, "chooserSelectsTarget", { selected: [id("copyA")] });
  const after = engine.state.players[P1].deck;
  assert.equal(after[0], id("copyA"));
  const restBefore = before.filter((c) => c !== id("copyA"));
  assert.notDeepEqual(after.slice(1), restBefore, "the rest of the deck was shuffled");
  assert.deepEqual([...after.slice(1)].sort(), [...restBefore].sort());
});

clause(STONE, "0:rule", "only characters: when an item I control is destroyed the Stone does nothing", () => {
  const { engine, id } = stoneBoard({
    extra: [
      { key: "gizmo", def: item({ name: "Hero" }), owner: P1, zone: "play" },
      { key: "ki", def: killItem(), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("ki"), { selected: { t: [id("gizmo")] } });
  assert.equal(zoneOf(engine, id("gizmo")), "discard");
  assert.equal(pending(engine), undefined);
});

clause(STONE, "0:rule", "only characters I control: a destroyed opposing character does nothing", () => {
  const { engine, id } = stoneBoard({
    extra: [{ key: "theirs", def: heroDef("s302p3-their-hero"), owner: P2, zone: "play" }]
  });
  play(engine, P1, id("kill"), { selected: { t: [id("theirs")] } });
  assert.equal(zoneOf(engine, id("theirs")), "discard");
  assert.equal(pending(engine), undefined);
});

clause(STONE, "0:rule", "a character that is destroyed while the Stone is in my hand (not in play) does nothing", () => {
  const { engine, id } = stoneBoard({ stoneZone: "hand" });
  play(engine, P1, id("kill"), { selected: { t: [id("hero")] } });
  assert.equal(zoneOf(engine, id("hero")), "discard");
  assert.equal(pending(engine), undefined);
});

clause(STONE, "0:rule", "a character controlled by me but owned by my opponent counts as 'a character you control' and searches MY deck", () => {
  const { engine, id } = stoneBoard({
    extra: [{ key: "loaned", def: heroDef("s302p3-loaned", "Hero"), owner: P2, controller: P1, zone: "play" }]
  });
  play(engine, P1, id("kill"), { selected: { t: [id("loaned")] } });
  assert.equal(pending(engine)?.kind, "mayPay");
  assert.equal(pending(engine)?.playerId, P1);
  answerPending(engine, "mayPay", { pay: true });
  answerPending(engine, "chooserSelectsTarget", { selected: [id("copyA")] });
  assert.equal(engine.state.players[P1].deck[0], id("copyA"));
});

clause(STONE, "0:rule", "works for the opponent too: a Stone they control triggers when THEIR character is destroyed, using their resources and deck", () => {
  const g = buildGame({
    ...factions(),
    cards: [
      { key: "stone", def: printing(STONE), owner: P2, zone: "play" },
      { key: "hero", def: heroDef("s302p3-p2-hero"), owner: P2, zone: "play" },
      { key: "copy", def: heroDef("s302p3-p2-copy"), owner: P2, zone: "deck" },
      { key: "other", def: character({ name: "Other" }), owner: P2, zone: "deck" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      ...bank("rage", 2, P2)
    ]
  });
  const ready = readyCount(g.engine, P2);
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("hero")] } });
  assert.equal(pending(g.engine)?.playerId, P2, "their Stone, their choice");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(ready - readyCount(g.engine, P2), 1);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("copy")] });
  assert.equal(g.engine.state.players[P2].deck[0], g.id("copy"));
});

clause(STONE, "0:rule", "a character that dies in battle is 'destroyed' too: the Stone triggers", () => {
  const { engine, id } = stoneBoard({
    attacker: P2,
    extra: [{ key: "atk", def: ch("Brute", 5, 9, 2), owner: P2, zone: "play" }]
  });
  fightThrough(engine, P2, [id("atk")], { type: "faction", playerId: P1 }, [id("hero")], undefined, (pc) => {
    assert.equal(pc.kind, "mayPay");
    return { kind: "mayPay", pay: false };
  });
  assert.equal(zoneOf(engine, id("hero")), "discard");
});

clause(STONE, "0:rule", "each destroyed character triggers it separately (two characters destroyed on two plays -> two chances to pay)", () => {
  const { engine, id } = stoneBoard({
    extra: [
      { key: "kill2", def: killTactic(), owner: P1, zone: "hand" },
      { key: "villainIn", def: heroDef("s302p3-villain-in", "Villain"), owner: P1, zone: "play" }
    ]
  });
  const ready = readyCount(engine, P1);
  play(engine, P1, id("kill"), { selected: { t: [id("hero")] } });
  answerPending(engine, "mayPay", { pay: true });
  answerPending(engine, "chooserSelectsTarget", { selected: [id("copyA")] });
  play(engine, P1, id("kill2"), { selected: { t: [id("villainIn")] } });
  answerPending(engine, "mayPay", { pay: true });
  answerPending(engine, "chooserSelectsTarget", { selected: [id("villain")] });
  assert.equal(ready - readyCount(engine, P1), 2, "paid 1 each time");
  assert.equal(engine.state.players[P1].deck[0], id("villain"), "the later search sits on top");
});

clause(STONE, "0:rule", "a search that finds nothing (I pick no card) still shuffles the searched deck (CR 312.1)", () => {
  const { engine, id } = stoneBoard({ random: lcg(5) });
  const before = [...engine.state.players[P1].deck];
  play(engine, P1, id("kill"), { selected: { t: [id("hero")] } });
  answerPending(engine, "mayPay", { pay: true });
  answerPending(engine, "chooserSelectsTarget", { selected: [] });
  assert.notDeepEqual(engine.state.players[P1].deck, before, "the searched deck was shuffled even though nothing was found");
  assert.deepEqual([...engine.state.players[P1].deck].sort(), [...before].sort());
});

// =====================================================================================
// The Evil Alliance
// =====================================================================================

const RAGE = printing("3be26b3f-2c78-4d0c-8849-0b4ca48951fd");
const GREED = printing("61766da9-6482-4ecb-8306-becda47294ec");
const DECEPTION = printing("ebcdd443-efdf-4a16-a0b9-b1307cd13d0b");
const ELITISM = printing("b4ddcf43-e508-4a11-9953-697acdcaf116");
/** A resource card that is NOT a staple. */
const ODD = resourceCard({ id: "s302p3-odd", name: "Odd Resource", resource: { provides: ["elitism"], staple: false } });
const FILLER = character({ id: "s302p3-filler", name: "Filler" });
const repeat = (def: CardDefinition, n: number): CardDefinition[] => Array.from({ length: n }, () => def);

/** A plain opponent: 2 staples, 7 going first / 8 going second, a normal Develop Rule, 20 influence. */
const PLAIN_OPP = factionCard({
  id: "s302p3-plain-opp",
  name: "Plain Opponent",
  faction: defaultFactionDefinition({
    startingInfluence: 20,
    setup: {
      startingResources: { count: 2, stapleOnly: true },
      openingHand: { goingFirst: 7, goingSecond: 8 },
      mulligan: { count: 1, mode: "replaceAny" }
    },
    turn: {
      restore: { detachResources: true, restoreNonResources: true },
      develop: { choices: [{ type: "draw", count: 1 }, { type: "playResource", count: 1 }] }
    }
  })
});
const oppSeat = () => ({ faction: PLAIN_OPP, deck: [RAGE, RAGE, ...repeat(FILLER, 40)] });
const evilSeat = (deck: CardDefinition[] = [RAGE, GREED, ...repeat(FILLER, 40)]) => ({ faction: printing(EVIL), deck });

const playCards = (engine: SpoilsEngine, pid: PlayerId): CardInstanceId[] =>
  engine.state.players[pid].play.filter((c) => engine.getDefinition(c).type !== "faction");
const namesIn = (engine: SpoilsEngine, ids: CardInstanceId[]): string[] => ids.map((c) => engine.getDefinition(c).name).sort();
const handSize = (engine: SpoilsEngine, pid: PlayerId): number => engine.state.players[pid].hand.length;

/** Both players keep their opening hands: setup finishes and the first turn starts. */
function startGame(engine: SpoilsEngine): void {
  engine.perform({ type: "mulligan", playerId: P1, cardIds: [] } as never);
  engine.perform({ type: "mulligan", playerId: P2, cardIds: [] } as never);
  resolvePendingResponses(engine);
}

// --- 0:rule  X / influence ----------------------------------------------------------------------

clause(EVIL, "0:rule", "in a two-player game I have one opponent, so X = 1 and I start with 15 + 10 x 1 = 25 influence (the opponent's own faction sets theirs)", () => {
  const engine = setupGame(evilSeat(), oppSeat());
  assert.equal(influence(engine, P1), 25);
  assert.equal(influence(engine, P2), 20);
  const both = setupGame(evilSeat(), evilSeat());
  assert.equal(influence(both, P1), 25);
  assert.equal(influence(both, P2), 25);
});

clause(EVIL, "0:rule", "X is the number of opponents: with two opponents (X = 2) I start with 15 + 10 x 2 = 35 influence, with three (X = 3) 45; the Heroes keep their own faction's 20", () => {
  const two = sd.showdownGame({ heroes: 2 });
  assert.equal(influence(two, sd.VILLAIN), 35);
  assert.equal(influence(two, sd.H1), 20);
  assert.equal(influence(two, sd.H2), 20);
  const three = sd.showdownGame({ heroes: 3 });
  assert.equal(influence(three, sd.VILLAIN), 45);
  assert.equal(influence(three, sd.H3), 20);
});

// --- 1:rule:STARTING RESOURCES  "Any 1+X staple resources" ---------------------------------------

clause(EVIL, "1:rule:STARTING RESOURCES", "with X = 1 I start with exactly 2 staple resources in play, face-up, taken from my deck; the opponent starts with their own 2", () => {
  const deck = [RAGE, GREED, ...repeat(FILLER, 40)];
  const engine = setupGame(evilSeat(deck), oppSeat());
  const mine = playCards(engine, P1);
  assert.deepEqual(namesIn(engine, mine), ["Greed", "Rage"]);
  for (const c of mine) assert.equal(engine.state.cards[c].faceDown, false, "staples go in face-up");
  assert.equal(engine.getThresholds(P1).rage, 1);
  assert.equal(engine.getThresholds(P1).greed, 1);
  assert.equal(readyCount(engine, P1), 2, "both are resources I can pay with");
  assert.equal(engine.state.players[P1].deck.length, 42 - 2 - 7, "the starting resources came out of the deck (7 going first)");
  assert.equal(playCards(engine, P2).length, 2);
});

clause(EVIL, "1:rule:STARTING RESOURCES", "only STAPLE resources: non-staple resource cards and other cards are never taken, even when they sit on top of the deck", () => {
  const deck = [ODD, ODD, FILLER, ODD, RAGE, FILLER, DECEPTION, ...repeat(FILLER, 40)];
  const engine = setupGame(evilSeat(deck), oppSeat());
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Deception", "Rage"]);
  assert.equal(readyCount(engine, P1), 2);
});

clause(EVIL, "1:rule:STARTING RESOURCES", "'Any' staples: when my deck has several staple kinds I get to choose which 2 (only staples are offered), and my pick is what starts in play", () => {
  const deck = [RAGE, GREED, DECEPTION, ELITISM, ODD, ...repeat(FILLER, 40)];
  const engine = setupGame(evilSeat(deck), oppSeat(), { choose: true });
  assert.equal(engine.state.setup.phase, "chooseStartingResources", "I am asked which staples to start with");
  const choice = engine.getStartingResourceChoice(P1);
  assert.ok(choice, "the choice is mine");
  assert.equal(choice.count, 2, "1 + X = 2");
  const offered = choice.candidateCardIds.map((c) => engine.getDefinition(c).name).sort();
  assert.deepEqual(offered, ["Deception", "Elitism", "Greed", "Rage"], "staples only: not the non-staple resource");
  const pick = (name: string) => choice.candidateCardIds.find((c) => engine.getDefinition(c).name === name)!;
  refused(() => engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: [pick("Rage")] }), "1 is not 2", /choose|exactly|2|count/i);
  refused(() => engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: [pick("Rage"), pick("Greed"), pick("Elitism")] }), "3 is not 2", /choose|exactly|2|count/i);
  const odd = engine.state.players[P1].deck.find((c) => engine.getDefinition(c).name === "Odd Resource")!;
  refused(() => engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: [pick("Rage"), odd] }), "a non-staple can't be chosen", /staple|candidate|choose|legal/i);
  engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: [pick("Deception"), pick("Elitism")] });
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Deception", "Elitism"]);
  assert.equal(engine.getThresholds(P1).deception, 1);
  assert.equal(engine.getThresholds(P1).elitism, 1);
});

clause(EVIL, "1:rule:STARTING RESOURCES", "X is the number of opponents: with two opponents (X = 2) I start with 1 + 2 = 3 staple resources, with three (X = 3) 4 -- all staples, face-up", () => {
  const two = sd.showdownGame({ heroes: 2 });
  const mine = playCards(two, sd.VILLAIN);
  assert.deepEqual(namesIn(two, mine), ["Deception", "Greed", "Rage"], "the first three staples of the deck, in deck order");
  assert.ok(mine.every((id) => !two.state.cards[id].faceDown), "face-up");
  assert.equal(playCards(sd.showdownGame({ heroes: 3 }), sd.VILLAIN).length, 4);
  // The Heroes' own faction says six (not scaled by their one opponent, the Villain).
  assert.equal(playCards(two, sd.H1).length, 6);
});

// --- 2:rule:STARTING DRAW  "7 going first, 8 going second" ---------------------------------------

clause(EVIL, "2:rule:STARTING DRAW", "I draw 7 cards going first and 8 going second; the opponent keeps their own 8 / 7", () => {
  const first = setupGame(evilSeat(), oppSeat(), { first: P1 });
  assert.equal(handSize(first, P1), 7);
  assert.equal(handSize(first, P2), 8);
  const second = setupGame(evilSeat(), oppSeat(), { first: P2 });
  assert.equal(handSize(second, P1), 8);
  assert.equal(handSize(second, P2), 7);
});

// --- 3:rule:RESTORE RULE ----------------------------------------------------------------------------

const topOfDeck = (label: string, owner: PlayerId = P1): Cards =>
  Array.from({ length: 10 }, (_, i) => ({ key: `${label}${i}`, def: character({ name: `${label} ${i}` }), owner, zone: "deck" as const }));

function restoreBoard(active: PlayerId) {
  return buildGame({
    playerA: { faction: printing(EVIL) },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [
      { key: "mineChar", def: character({ name: "My Depleted Character" }), owner: P1, depleted: true },
      { key: "mineItem", def: item({ name: "My Depleted Item" }), owner: P1, depleted: true },
      { key: "mineReady", def: character({ name: "My Ready Character" }), owner: P1 },
      ...spentResources(P1, 3),
      ...volition(1, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })),
      ...bank("greed", 2, P1), // not attached: stays that way
      { key: "theirChar", def: character({ name: "Their Depleted Character" }), owner: P2, depleted: true },
      { key: "theirItem", def: item({ name: "Their Depleted Item" }), owner: P2, depleted: true },
      { key: "stolenIn", def: character({ name: "Stolen In" }), owner: P2, controller: P1, depleted: true },
      { key: "stolenOut", def: character({ name: "Stolen Out" }), owner: P1, controller: P2, depleted: true },
      ...spentResources(P2, 2),
      ...topOfDeck("mydeck", P1),
      ...topOfDeck("theirdeck", P2)
    ]
  });
}

clause(EVIL, "3:rule:RESTORE RULE", "at the start of my turn my depleted cards (also ones I control but don't own) are restored and every resource is detached from my faction", () => {
  const { engine, id } = restoreBoard(P2);
  assert.equal(attachedCount(engine, P1), 4, "3 rage + 1 face-down resource are attached before my turn");
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.cards[id("mineChar")].depleted, false);
  assert.equal(engine.state.cards[id("mineItem")].depleted, false);
  assert.equal(engine.state.cards[id("mineReady")].depleted, false);
  assert.equal(engine.state.cards[id("stolenIn")].depleted, false, "a depleted card I control is mine to restore");
  assert.equal(attachedCount(engine, P1), 0, "every resource is detached from my faction (face-up and face-down)");
  assert.equal(readyCount(engine, P1), 6, "all six of my resources are ready again");
});

clause(EVIL, "3:rule:RESTORE RULE", "'your': the opponent's depleted cards stay depleted, their resources stay attached, and so does a card I own but the opponent controls", () => {
  const { engine, id } = restoreBoard(P2);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("theirChar")].depleted, true);
  assert.equal(engine.state.cards[id("theirItem")].depleted, true);
  assert.equal(engine.state.cards[id("stolenOut")].depleted, true);
  assert.equal(attachedCount(engine, P2), 2);
});

clause(EVIL, "3:rule:RESTORE RULE", "only at the start of MY turn: nothing of mine restores at the start of the opponent's turn", () => {
  const { engine, id } = restoreBoard(P1);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.cards[id("mineChar")].depleted, true);
  assert.equal(engine.state.cards[id("mineItem")].depleted, true);
  assert.equal(engine.state.cards[id("stolenIn")].depleted, true);
  assert.equal(attachedCount(engine, P1), 4);
  assert.equal(engine.state.cards[id("theirChar")].depleted, false, "(the opponent's own restore ran for them)");
  assert.equal(attachedCount(engine, P2), 0);
});

// --- 4:rule:DEVELOP RULE  "draw a card or play a resource. Repeat this X-1 times." -----------------

/**
 * X - 1: the Develop Rule repeats once per opponent beyond the first (X = the opponents at the start of the game). Zero in the
 * two-player games these boards are written for; a bigger table seats more opponents, so the rule is offered that many more times.
 */
const repeatsOf = (engine: SpoilsEngine): number => Object.keys(engine.state.players).length - 2;
/** Uses the Develop Rule's remaining repeats (draws; it cannot be skipped) and returns how many there were. */
function drawRemaining(engine: SpoilsEngine): number {
  let n = 0;
  for (let id = engine.state.pendingChoice?.id; n < 10; n++) {
    developDrawLeft(engine); // (a rule opened by hand carries no ability id, so it is recognised by its option labels)
    if (engine.state.pendingChoice?.id === id) break;
    id = engine.state.pendingChoice?.id;
  }
  return n;
}

const developBoard = (active: PlayerId = P1) =>
  buildGame({
    playerA: { faction: printing(EVIL) },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [
      { key: "handRes", def: resourceCard({ name: "Hand Resource", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
      { key: "handRes2", def: resourceCard({ name: "Hand Resource 2", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" },
      { key: "handChar", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" },
      ...topOfDeck("mydeck", P1),
      ...topOfDeck("theirdeck", P2),
      { key: "theirHand", def: character({ name: "Their Hand Card" }), owner: P2, zone: "hand" }
    ]
  });

clause(EVIL, "4:rule:DEVELOP RULE", "I may draw a card (the top of my deck) as my Develop Rule; nobody else draws and no resource is played", () => {
  const { engine, id } = developBoard();
  const handBefore = handSize(engine, P1);
  const deckBefore = [...engine.state.players[P1].deck];
  const theirHand = handSize(engine, P2);
  assert.ok(developOffers(engine, P1).length > 0, "the Develop Rule offers something");
  developDraw(engine, P1);
  assert.equal(handSize(engine, P1), handBefore + 1);
  assert.equal(engine.state.cards[id("mydeck0")].zone, "hand");
  assert.deepEqual(engine.state.players[P1].deck, deckBefore.slice(1));
  assert.equal(handSize(engine, P2), theirHand);
  assert.equal(playCards(engine, P1).length, 0);
});

clause(EVIL, "4:rule:DEVELOP RULE", "or play a resource card face-up: it is in play providing its icon, nothing is drawn, and only one resource is played", () => {
  const { engine, id } = developBoard();
  const handBefore = handSize(engine, P1);
  const deckBefore = [...engine.state.players[P1].deck];
  developResource(engine, P1, id("handRes"), false);
  assert.equal(engine.state.cards[id("handRes")].zone, "play");
  assert.equal(engine.state.cards[id("handRes")].faceDown, false);
  assert.equal(engine.getThresholds(P1).greed, 1);
  assert.equal(handSize(engine, P1), handBefore - 1);
  assert.deepEqual(engine.state.players[P1].deck, deckBefore, "no card was drawn");
  assert.equal(engine.state.cards[id("handRes2")].zone, "hand");
});

clause(EVIL, "4:rule:DEVELOP RULE", "any card may be played face-down as a resource (Volition) -- including an actual resource card, which then gives Volition rather than its icon; a non-resource can't go face-up", () => {
  const a = developBoard();
  developResource(a.engine, P1, a.id("handChar"), true);
  assert.equal(a.engine.state.cards[a.id("handChar")].zone, "play");
  assert.equal(a.engine.state.cards[a.id("handChar")].faceDown, true);
  assert.equal(a.engine.getThresholds(P1).volition, 1);
  const b = developBoard();
  developResource(b.engine, P1, b.id("handRes"), true);
  assert.equal(b.engine.state.cards[b.id("handRes")].faceDown, true);
  assert.equal(b.engine.getThresholds(P1).volition, 1);
  assert.equal(b.engine.getThresholds(P1).greed ?? 0, 0);
  const c = developBoard();
  developResource(c.engine, P1, c.id("handChar"), false); // asked to play it face-up
  assert.equal(c.engine.state.cards[c.id("handChar")].zone, "play");
  assert.equal(c.engine.state.cards[c.id("handChar")].faceDown, true, "a non-resource can't be played face-up: it enters face-down");
  assert.equal(drawRemaining(c.engine), repeatsOf(c.engine), "that was the Develop Rule's one resource play (then only its X - 1 repeats)");
  assert.equal(c.engine.state.pendingChoice, undefined);
});

clause(EVIL, "4:rule:DEVELOP RULE", "'draw a card OR play a resource': not both (X - 1 = 0 repeats with one opponent), so a second use in the same turn is refused either way round", () => {
  const a = developBoard();
  developDraw(a.engine, P1);
  assert.equal(drawRemaining(a.engine), repeatsOf(a.engine), "already developed this turn: nothing more is offered beyond the X - 1 repeats");
  assert.equal(a.engine.state.pendingChoice, undefined, "already developed this turn: nothing more is offered");
  assert.equal(a.engine.state.cards[a.id("handRes")].zone, "hand");
  const b = developBoard();
  const deck = [...b.engine.state.players[P1].deck];
  developResource(b.engine, P1, b.id("handRes"), false);
  const bRepeats = drawRemaining(b.engine);
  assert.equal(bRepeats, repeatsOf(b.engine), "already developed this turn: nothing more is offered beyond the X - 1 repeats");
  assert.equal(b.engine.state.pendingChoice, undefined, "already developed this turn: nothing more is offered");
  assert.deepEqual(b.engine.state.players[P1].deck, deck.slice(bRepeats), "only the repeats drew");
  const c = developBoard();
  developDraw(c.engine, P1);
  assert.equal(drawRemaining(c.engine), repeatsOf(c.engine));
  assert.equal(c.engine.state.pendingChoice, undefined, "a second draw is not offered");
  const d = developBoard();
  developResource(d.engine, P1, d.id("handRes"), false);
  assert.equal(drawRemaining(d.engine), repeatsOf(d.engine));
  assert.equal(d.engine.state.pendingChoice, undefined, "a second resource play is not offered");
  assert.equal(d.engine.state.cards[d.id("handRes2")].zone, "hand");
});

clause(EVIL, "4:rule:DEVELOP RULE", "only on my own turn, optional, and available again every turn", () => {
  const off = developBoard();
  const offHand = off.engine.state.players[P1].hand.length;
  endTurnRaw(off.engine, P1); // the opponent's turn starts
  const offPending = off.engine.state.pendingChoice as unknown as { playerId: string } | undefined;
  assert.equal(offPending?.playerId, P2, "only the player whose turn it is gets a Develop Rule to use");
  settleTurnStart(off.engine, "draw");
  assert.equal(off.engine.state.players[P1].hand.length, offHand, "I draw nothing at the opponent's turn start");
  assert.equal(off.engine.state.cards[off.id("handRes")].zone, "hand");

  const { engine } = developBoard();
  const hand = handSize(engine, P1);
  endTurn(engine, P1); // skipped entirely
  assert.equal(handSize(engine, P1), hand, "skipping it gives nothing");
  endTurnRaw(engine, P2);
  settleTurnStart(engine, "draw");
  assert.equal(engine.state.activePlayerId, P1);
  const uses = repeatsOf(engine) + 1; // the rule and its X - 1 repeats
  assert.equal(handSize(engine, P1), hand + uses, "the Develop Rule is offered again at the start of my next turn");
  endTurn(engine, P1);
  endTurnRaw(engine, P2);
  settleTurnStart(engine, "draw");
  assert.equal(handSize(engine, P1), hand + 2 * uses, "renews every turn");
});

/** Orders the turn start's triggers (Restore first) until the Develop Rule's option prompt is pending. */
function toDevelopPrompt(engine: SpoilsEngine): void {
  for (let guard = 0; guard < 10; guard++) {
    const prompt = engine.state.pendingChoice;
    if (prompt?.kind !== "orderTriggers") return;
    const next = prompt.triggers.find((t) => t.abilityId === "restoreRule") ?? prompt.triggers[0];
    engine.perform({ type: "resolvePendingChoice", playerId: prompt.playerId, choice: { kind: "orderTriggers", next } });
  }
}

clause(EVIL, "4:rule:DEVELOP RULE", "X is the number of opponents: with two opponents (X = 2) the Develop Rule repeats X - 1 = 1 time, so I develop twice per turn: a draw and then a resource play, and no third", () => {
  const engine = sd.showdownGame({ heroes: 2, rawStart: true });
  assert.equal(engine.state.activePlayerId, sd.VILLAIN);
  const hand = handSize(engine, sd.VILLAIN);
  const inPlay = playCards(engine, sd.VILLAIN).length;
  toDevelopPrompt(engine);
  assert.ok(isDevelopChoice(engine.state.pendingChoice), "the first draw-or-resource");
  chooseDevelopOption(engine, sd.VILLAIN, /^Draw /);
  assert.ok(isDevelopChoice(engine.state.pendingChoice), "a second draw-or-resource is offered");
  chooseDevelopOption(engine, sd.VILLAIN, /^Play /);
  const played = engine.state.players[sd.VILLAIN].hand[0];
  engine.perform({ type: "resolvePendingChoice", playerId: sd.VILLAIN, choice: { kind: "chooserSelectsTarget", selected: [played], faceDown: true } });
  toDevelopPrompt(engine);
  assert.ok(!isDevelopChoice(engine.state.pendingChoice), "no third develop (X - 1 = 1 repeat)");
  assert.equal(handSize(engine, sd.VILLAIN), hand, "one card drawn, one played");
  assert.equal(playCards(engine, sd.VILLAIN).length, inPlay + 1, "and the resource is in play");
});

clause(EVIL, "4:rule:DEVELOP RULE", "with three opponents (X = 3) I develop three times (draw a card or play a resource, repeated twice); a Hero's own Develop Rule is still once", () => {
  const engine = sd.showdownGame({ heroes: 3, rawStart: true });
  const hand = handSize(engine, sd.VILLAIN);
  toDevelopPrompt(engine);
  for (let i = 0; i < 3; i++) {
    assert.ok(isDevelopChoice(engine.state.pendingChoice), `develop ${i + 1} of 3 is offered`);
    chooseDevelopOption(engine, sd.VILLAIN, /^Draw /);
  }
  toDevelopPrompt(engine);
  assert.ok(!isDevelopChoice(engine.state.pendingChoice), "no fourth develop");
  assert.equal(handSize(engine, sd.VILLAIN), hand + 3);
  // A Hero: one opponent (the Villain), a plain Develop Rule.
  const hero = sd.showdownGame({ heroes: 3, first: sd.H1, rawStart: true });
  toDevelopPrompt(hero);
  chooseDevelopOption(hero, sd.H1, /^Draw /);
  assert.ok(!isDevelopChoice(hero.state.pendingChoice), "a Hero develops once");
  assert.equal(handSize(hero, sd.H1), 1);
});

// --- 5:ability DRAW  "Pay 3. Draw a card." ---------------------------------------------------------

const abilityBoard = (resources: number, extra: Cards = []) =>
  buildGame({
    playerA: { faction: printing(EVIL) },
    playerB: { faction: developFaction() },
    cards: [
      ...bank("rage", resources, P1),
      ...topOfDeck("mydeck", P1),
      ...topOfDeck("theirdeck", P2),
      { key: "handRes", def: resourceCard({ name: "Hand Resource", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
      { key: "handChar", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" },
      { key: "theirHand", def: resourceCard({ name: "Their Hand Resource", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" },
      ...extra
    ]
  });

function activateFaction(engine: SpoilsEngine, pid: PlayerId, abilityId: string, owner: PlayerId = pid): void {
  engine.perform({ type: "activateAbility", playerId: pid, cardId: factionOf(engine, owner), abilityId, selected: {}, variables: {} } as never);
  resolvePendingResponses(engine);
}

function pickFromHand(engine: SpoilsEngine, pid: PlayerId, cardId: CardInstanceId | undefined): void {
  const pc = pending(engine);
  assert.ok(pc, "the ability asks which card to play");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, pid, "the user of the ability chooses");
  engine.perform({ type: "resolvePendingChoice", playerId: pid, choice: { kind: "chooserSelectsTarget", selected: cardId ? [cardId] : [] } } as never);
  resolvePendingResponses(engine);
}

clause(EVIL, "5:ability", "DRAW pays exactly 3 resources (attached to the faction) and draws exactly one card, the top of my deck; the opponent draws nothing", () => {
  const { engine, id } = abilityBoard(5);
  const handBefore = handSize(engine, P1);
  const deckBefore = [...engine.state.players[P1].deck];
  activateFaction(engine, P1, "evil-draw");
  assert.equal(readyCount(engine, P1), 2, "3 of 5 paid");
  assert.equal(attachedCount(engine, P1), 3);
  assert.equal(handSize(engine, P1), handBefore + 1);
  assert.equal(engine.state.cards[id("mydeck0")].zone, "hand");
  assert.deepEqual(engine.state.players[P1].deck, deckBefore.slice(1));
  assert.equal(handSize(engine, P2), 1);
  assert.equal(engine.state.cards[factionOf(engine, P1)].depleted, false, "no deplete is printed");
});

clause(EVIL, "5:ability", "DRAW is refused when the 3 can't be paid (2 resources; 4 with 2 already spent; none) and nothing is drawn or half-paid", () => {
  const two = abilityBoard(2);
  const hand = handSize(two.engine, P1);
  refused(() => activateFaction(two.engine, P1, "evil-draw"), "only 2 resources", /cannot be paid/);
  assert.equal(handSize(two.engine, P1), hand);
  assert.equal(attachedCount(two.engine, P1), 0);
  assert.equal(readyCount(two.engine, P1), 2);
  const spent = abilityBoard(4);
  for (const rid of spent.engine.getAvailableResourceIds(P1).slice(0, 2)) spent.engine.state.cards[rid].attachedTo = factionOf(spent.engine, P1);
  assert.equal(readyCount(spent.engine, P1), 2);
  refused(() => activateFaction(spent.engine, P1, "evil-draw"), "only 2 unspent", /cannot be paid/);
  const none = abilityBoard(0);
  refused(() => activateFaction(none.engine, P1, "evil-draw"), "no resources", /cannot be paid/);
  const exact = abilityBoard(3);
  activateFaction(exact.engine, P1, "evil-draw");
  assert.equal(handSize(exact.engine, P1), hand + 1, "positive control: exactly 3 is enough");
});

clause(EVIL, "5:ability", "DRAW has no printed limit (usable again the same turn) and is separate from the Develop Rule in both orders", () => {
  const rep = abilityBoard(7);
  const hand = handSize(rep.engine, P1);
  activateFaction(rep.engine, P1, "evil-draw");
  activateFaction(rep.engine, P1, "evil-draw");
  assert.equal(handSize(rep.engine, P1), hand + 2);
  assert.equal(attachedCount(rep.engine, P1), 6);
  assert.equal(readyCount(rep.engine, P1), 1);
  const a = abilityBoard(3);
  activateFaction(a.engine, P1, "evil-draw");
  assert.ok(developOffers(a.engine, P1).length > 0, "using the ability doesn't use up the Develop Rule");
  developDraw(a.engine, P1);
  assert.equal(handSize(a.engine, P1), hand + 2);
  const b = abilityBoard(3);
  developDraw(b.engine, P1);
  const bRepeats = drawRemaining(b.engine); // the rule's X - 1 repeats (none at a two-player table) must be used before anything else
  activateFaction(b.engine, P1, "evil-draw");
  assert.equal(handSize(b.engine, P1), hand + 2 + bRepeats);
});

clause(EVIL, "5:ability", "only the faction's controller can use DRAW: the opponent can't use mine", () => {
  const { engine } = buildGame({
    playerA: { faction: printing(EVIL) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [...bank("rage", 6, P2), ...bank("rage", 6, P1), ...topOfDeck("theirdeck", P2)]
  });
  const theirHand = handSize(engine, P2);
  refused(() => activateFaction(engine, P2, "evil-draw", P1), "not their faction", /do not control/i);
  assert.equal(handSize(engine, P2), theirHand);
  assert.equal(attachedCount(engine, P2), 0);
});

// --- 6:ability RESOURCE  "Pay 3. Play a resource." -------------------------------------------------

clause(EVIL, "6:ability", "RESOURCE pays exactly 3 resources, then plays a resource card I pick from my hand face-up (providing its icon), drawing nothing", () => {
  const { engine, id } = abilityBoard(5);
  const handBefore = handSize(engine, P1);
  const deckBefore = [...engine.state.players[P1].deck];
  activateFaction(engine, P1, "evil-resource");
  assert.equal(attachedCount(engine, P1), 3, "exactly 3 paid");
  pickFromHand(engine, P1, id("handRes"));
  assert.equal(engine.state.cards[id("handRes")].zone, "play");
  assert.equal(engine.state.cards[id("handRes")].faceDown, false);
  assert.equal(engine.getThresholds(P1).greed, 1);
  assert.equal(handSize(engine, P1), handBefore - 1);
  assert.deepEqual(engine.state.players[P1].deck, deckBefore);
  assert.equal(engine.state.cards[id("handChar")].zone, "hand", "only the chosen card was played");
  assert.equal(readyCount(engine, P1), 5 - 3 + 1, "the new resource is ready to pay for things");
});

clause(EVIL, "6:ability", "RESOURCE can play any card from my hand as a resource: a non-resource goes in face-down and gives Volition", () => {
  const { engine, id } = abilityBoard(3);
  activateFaction(engine, P1, "evil-resource");
  pickFromHand(engine, P1, id("handChar"));
  assert.equal(engine.state.cards[id("handChar")].zone, "play");
  assert.equal(engine.state.cards[id("handChar")].faceDown, true);
  assert.equal(engine.getThresholds(P1).volition, 1);
  assert.equal(engine.state.cards[id("handRes")].zone, "hand");
});

clause(EVIL, "6:ability", "'Play a resource' lets me choose face-up or face-down for an actual resource card (any card may be played face-down)", () => holdResourceFace(() => {
  const { engine, id } = abilityBoard(3);
  activateFaction(engine, P1, "evil-resource");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("handRes")] } } as never);
  resolvePendingResponses(engine);
  const asked = engine.state.pendingChoice !== undefined && engine.state.cards[id("handRes")].zone === "hand";
  const faceDown = engine.state.cards[id("handRes")].zone === "play" && engine.state.cards[id("handRes")].faceDown;
  assert.ok(asked || faceDown, "after picking an actual resource card the player must get to say face-up or face-down; the engine put it in play face-up without asking");
}));

clause(EVIL, "6:ability", "RESOURCE plays a card from MY hand only: the opponent's hand card and a card of my deck are not legal picks", () => {
  const { engine, id } = abilityBoard(3);
  activateFaction(engine, P1, "evil-resource");
  for (const bad of ["theirHand", "mydeck0"]) {
    refused(
      () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id(bad)] } } as never),
      `${bad} is not in my hand`,
      /Illegal target/
    );
  }
  assert.equal(engine.state.cards[id("theirHand")].zone, "hand");
  assert.equal(engine.state.cards[id("mydeck0")].zone, "deck");
});

clause(EVIL, "6:ability", "RESOURCE is refused when the 3 can't be paid (2 resources, none), and then no resource is played", () => {
  const { engine, id } = abilityBoard(2);
  refused(() => activateFaction(engine, P1, "evil-resource"), "only 2 resources", /cannot be paid/);
  assert.equal(pending(engine), undefined);
  assert.equal(engine.state.cards[id("handRes")].zone, "hand");
  assert.equal(attachedCount(engine, P1), 0);
  assert.equal(readyCount(engine, P1), 2);
  const none = abilityBoard(0);
  refused(() => activateFaction(none.engine, P1, "evil-resource"), "no resources", /cannot be paid/);
});

clause(EVIL, "6:ability", "RESOURCE has no printed limit (usable again, the new resource helps pay) and is separate from the Develop Rule", () => {
  const { engine, id } = abilityBoard(6);
  activateFaction(engine, P1, "evil-resource");
  pickFromHand(engine, P1, id("handRes"));
  activateFaction(engine, P1, "evil-resource");
  pickFromHand(engine, P1, id("handChar"));
  assert.equal(engine.state.cards[id("handRes")].zone, "play");
  assert.equal(engine.state.cards[id("handChar")].zone, "play");
  assert.equal(attachedCount(engine, P1), 6);
  const sep = abilityBoard(3);
  activateFaction(sep.engine, P1, "evil-resource");
  pickFromHand(sep.engine, P1, sep.id("handRes"));
  assert.ok(developOffers(sep.engine, P1).length > 0, "the ability's resource play isn't the Develop Rule's");
  developResource(sep.engine, P1, sep.id("handChar"), true);
  assert.equal(sep.engine.state.cards[sep.id("handChar")].zone, "play");
});

clause(EVIL, "6:ability", "only the faction's controller can use RESOURCE", () => {
  const { engine, id } = buildGame({
    playerA: { faction: printing(EVIL) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [
      ...bank("rage", 8, P2),
      { key: "theirHand", def: resourceCard({ name: "Their Hand Resource", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" }
    ]
  });
  refused(() => activateFaction(engine, P2, "evil-resource", P1), "not their faction", /do not control/i);
  assert.equal(engine.state.cards[id("theirHand")].zone, "hand");
  assert.equal(attachedCount(engine, P2), 0);
});

clause(EVIL, "6:ability", "'Play a resource' is not a 'may': after paying 3 with a card in hand I must play one (picking nothing is refused)", () => {
  const { engine } = abilityBoard(3);
  activateFaction(engine, P1, "evil-resource");
  refused(
    () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [] } } as never),
    "must play a resource when there is a card in hand to play",
    /select|choose|must|required|exactly/i
  );
});

// --- 7:ability ENTICEMENT -------------------------------------------------------------------------

/** The printed ENTICEMENT ability on `pid`'s faction card, found by its name. */
function enticement(engine: SpoilsEngine, pid: PlayerId = P1) {
  return (engine.getFactionDefinition(pid)?.abilities ?? []).find((a) => (a.name ?? "").toLowerCase() === "enticement");
}

clause(EVIL, "7:ability", "ENTICEMENT exists on the faction and, during my turn, plays a resource from my hand (drawing X-1 = 0 cards with one opponent)", () => {
  const { engine, id } = abilityBoard(0);
  const ability = enticement(engine);
  assert.ok(ability, "the Evil Alliance has no ENTICEMENT ability");
  const hand = handSize(engine, P1);
  activateFaction(engine, P1, ability.id);
  pickFromHand(engine, P1, id("handRes"));
  assert.equal(engine.state.cards[id("handRes")].zone, "play");
  assert.equal(handSize(engine, P1), hand - 1 + repeatsOf(engine), "X - 1 cards drawn (0 with one opponent), one played");
  if (engine.state.format.kind !== "showdown") assert.equal(engine.state.showdown, undefined, "a game that is not a Showdown has no Hero Deck or Temptation Pile: that step does nothing");
});

clause(EVIL, "7:ability", "ENTICEMENT can be used only once per turn", () => {
  const { engine, id } = abilityBoard(0);
  const ability = enticement(engine);
  assert.ok(ability, "the Evil Alliance has no ENTICEMENT ability");
  activateFaction(engine, P1, ability.id);
  pickFromHand(engine, P1, id("handRes"));
  refused(() => activateFaction(engine, P1, ability.id), "once per turn", /each turn/i);
});

clause(EVIL, "7:ability", "ENTICEMENT can be used only during my own turn", () => {
  const { engine } = buildGame({
    playerA: { faction: printing(EVIL) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [{ key: "handRes", def: resourceCard({ name: "Hand Resource", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" }]
  });
  const ability = enticement(engine);
  assert.ok(ability, "the Evil Alliance has no ENTICEMENT ability");
  refused(() => activateFaction(engine, P1, ability.id), "not my turn", /timing/i);
});

/** The Villain uses ENTICEMENT and plays the first card of their hand as the resource. */
function enticeNow(engine: SpoilsEngine): void {
  const ability = enticement(engine, sd.VILLAIN);
  assert.ok(ability, "the Evil Alliance has no ENTICEMENT ability");
  const card = engine.state.players[sd.VILLAIN].hand[0];
  sd.useAbility(engine, sd.VILLAIN, ability.id, undefined, sd.factionOfPlayer(engine, sd.VILLAIN));
  pickFromHand(engine, sd.VILLAIN, card);
}

clause(EVIL, "7:ability", "ENTICEMENT draws X-1 cards: one with two Heroes (X = 2), two with three (X = 3), and then plays a resource", () => {
  for (const heroes of [2, 3]) {
    const engine = sd.showdownGame({ heroes });
    const hand = handSize(engine, sd.VILLAIN);
    const inPlay = playCards(engine, sd.VILLAIN).length;
    enticeNow(engine);
    assert.equal(handSize(engine, sd.VILLAIN), hand + (heroes - 1) - 1, `${heroes} Heroes: X - 1 = ${heroes - 1} drawn, one played as a resource`);
    assert.equal(playCards(engine, sd.VILLAIN).length, inPlay + 1, `${heroes} Heroes: one more resource in play`);
  }
});

clause(EVIL, "7:ability", "ENTICEMENT puts the top card of the Hero deck into the Temptation Pile (one card per use, the pile keeps growing)", () => {
  const engine = sd.showdownGame({ heroes: 2, heroDeck: [sd.CHAMPION, sd.CHAMPION, sd.BOON] });
  assert.deepEqual(sd.pileOf(engine), [], "the Temptation Pile starts empty");
  const [top, second, third] = sd.heroDeckOf(engine);
  enticeNow(engine);
  assert.deepEqual(sd.pileOf(engine), [top], "the top card of the Hero deck is in the pile");
  assert.deepEqual(sd.heroDeckOf(engine), [second, third], "and no longer in the Hero deck");
  refused(() => enticeNow(engine), "once per turn, in a Showdown game too", /each turn/i);
  sd.advanceTo(engine, sd.VILLAIN);
  enticeNow(engine);
  assert.deepEqual(sd.pileOf(engine), [top, second], "my next turn adds the next card");
  assert.deepEqual(sd.heroDeckOf(engine), [third]);
});

clause(EVIL, "7:ability", "ENTICEMENT with an empty Hero deck still draws and plays its resource: the Temptation Pile step finds no card", () => {
  const engine = sd.showdownGame({ heroes: 2 });
  sd.exhaustHeroDeck(engine);
  const hand = handSize(engine, sd.VILLAIN);
  enticeNow(engine);
  assert.deepEqual(sd.pileOf(engine), []);
  assert.equal(handSize(engine, sd.VILLAIN), hand, "drew X - 1 = 1, played one");
});

clause(EVIL, "7:ability", "only the Villain can use ENTICEMENT, and only on their own turn: a Hero cannot use it from the Villain's faction", () => {
  const engine = sd.showdownGame({ heroes: 2, first: sd.H1 });
  const ability = enticement(engine, sd.VILLAIN)!;
  refused(
    () => sd.useAbility(engine, sd.H1, ability.id, undefined, sd.factionOfPlayer(engine, sd.VILLAIN)),
    "a Hero doesn't control the Villain's faction",
    /do not control/i
  );
  refused(
    () => sd.useAbility(engine, sd.VILLAIN, ability.id, undefined, sd.factionOfPlayer(engine, sd.VILLAIN)),
    "it is a Hero's turn",
    /timing/i
  );
  assert.deepEqual(sd.pileOf(engine), []);
});

// --- 8:rule:DARING GAMBIT --------------------------------------------------------------------------

/**
 * Two Heroes, a Hero deck of two Champions, and Hero 1's whole deck is Brutes ("pick a faction you don't control:
 * inflict 4 damage to it"). The Villain has used ENTICEMENT `pile` times (one per Villain turn); it is Hero 1's turn
 * with a Brute in play.
 */
function gambitTable(pile: number) {
  const engine = sd.showdownGame({ heroes: 2, heroDeck: [sd.CHAMPION, sd.CHAMPION], heroFill: { [sd.H1]: sd.BRUTE } });
  for (let i = 0; i < pile; i++) {
    if (i > 0) sd.advanceTo(engine, sd.VILLAIN);
    enticeNow(engine);
  }
  sd.advanceTo(engine, sd.H1);
  const brute = engine.state.players[sd.H1].hand[0];
  play(engine, sd.H1, brute);
  assert.equal(engine.state.cards[brute].zone, "play");
  return { engine, brute };
}
const smash = (engine: SpoilsEngine, brute: CardInstanceId, victim: PlayerId): void =>
  activate(engine, sd.H1, brute, "smash", { selected: { f: [sd.factionOfPlayer(engine, victim)] } });
const claimedBy = (engine: SpoilsEngine, ids: CardInstanceId[], owner: PlayerId): boolean =>
  ids.every((c) => engine.state.cards[c].zone === "play" && engine.state.cards[c].controllerId === owner);

clause(EVIL, "8:rule:DARING GAMBIT", "a Hero that inflicts at least 7 damage to another Hero this turn claims the entire Temptation Pile: 4 is not enough, 4 + 4 is", () => {
  const { engine, brute } = gambitTable(1);
  const pile = [...sd.pileOf(engine)];
  assert.equal(pile.length, 1);
  smash(engine, brute, sd.H2);
  assert.equal(engine.state.players[sd.H2].influence, 16, "4 damage to the other Hero's faction");
  assert.deepEqual(sd.pileOf(engine), pile, "4 damage is below 7: the pile is untouched");
  smash(engine, brute, sd.H2);
  assert.equal(engine.state.players[sd.H2].influence, 12);
  assert.deepEqual(sd.pileOf(engine), [], "8 damage in a turn: the pile is claimed");
  assert.ok(claimedBy(engine, pile, sd.H1), "by the damaging Hero, who now controls the card in play");
  smash(engine, brute, sd.H2);
  assert.deepEqual(sd.pileOf(engine), [], "nothing left to claim");
});

clause(EVIL, "8:rule:DARING GAMBIT", "the damaging Hero claims the ENTIRE Temptation Pile (every card in it)", () => {
  const { engine, brute } = gambitTable(2);
  const pile = [...sd.pileOf(engine)];
  assert.equal(pile.length, 2);
  smash(engine, brute, sd.H2);
  smash(engine, brute, sd.H2);
  assert.deepEqual(sd.pileOf(engine), []);
  assert.ok(claimedBy(engine, pile, sd.H1), "both cards are Hero 1's");
});

clause(EVIL, "8:rule:DARING GAMBIT", "damage to the Villain is not damage to another Hero: even 8 claims nothing", () => {
  const { engine, brute } = gambitTable(1);
  const pile = [...sd.pileOf(engine)];
  smash(engine, brute, sd.VILLAIN);
  smash(engine, brute, sd.VILLAIN);
  assert.equal(engine.state.players[sd.VILLAIN].influence, 27, "35 - 8: the damage was dealt");
  assert.deepEqual(sd.pileOf(engine), pile);
});

clause(EVIL, "8:rule:DARING GAMBIT", "'this turn': 4 damage on one turn and 4 on a later turn do not add up", () => {
  const { engine, brute } = gambitTable(1);
  const pile = [...sd.pileOf(engine)];
  smash(engine, brute, sd.H2);
  sd.advanceTo(engine, sd.H1);
  assert.equal(engine.state.cards[brute].zone, "play");
  smash(engine, brute, sd.H2);
  assert.equal(engine.state.players[sd.H2].influence, 12, "8 damage in all");
  assert.deepEqual(sd.pileOf(engine), pile, "but never 7 in one turn");
});

// --- 9:rule:OMNIPOTENCE ----------------------------------------------------------------------------

exempt(EVIL, "10:rule", "A reminder only (\"See the included Showdown rules card\"): it points at a physical rules card, has no rules text of its own, and so nothing for the engine to do or a test to observe.");

const omniBoard = (faction: CardDefinition, cards: Cards, resources: Cards = bank("greed", 6, P1)) =>
  buildGame({ playerA: { faction }, playerB: { faction: developFaction() }, cards: [...cards, ...resources] });

clause(EVIL, "9:rule:OMNIPOTENCE", "I can deploy a card whose threshold I have no icons for, still paying its cost; a normal faction can't", () => {
  const def = character({ name: "Triple Rage", cost: 2, threshold: "rrr" });
  const { engine, id } = omniBoard(printing(EVIL), [{ key: "c", def, owner: P1, zone: "hand" }]);
  assert.equal(engine.getThresholds(P1).rage ?? 0, 0, "I have no Rage icons");
  play(engine, P1, id("c"));
  assert.equal(zoneOf(engine, id("c")), "play");
  assert.equal(readyCount(engine, P1), 4, "the cost 2 is still paid");
  assert.equal(engine.getThresholds(P1).rage ?? 0, 0, "and OMNIPOTENCE doesn't conjure icons");

  const plain = omniBoard(developFaction(), [{ key: "c", def, owner: P1, zone: "hand" }]);
  refused(() => play(plain.engine, P1, plain.id("c")), "control: a normal faction lacks [R][R][R]", /threshold/i);
  assert.equal(zoneOf(plain.engine, plain.id("c")), "hand");
});

clause(EVIL, "9:rule:OMNIPOTENCE", "it waives thresholds only, not costs: I can't deploy a cost-2 card with one resource", () => {
  const def = character({ name: "Triple Rage", cost: 2, threshold: "rrr" });
  const { engine, id } = omniBoard(printing(EVIL), [{ key: "c", def, owner: P1, zone: "hand" }], bank("greed", 1, P1));
  refused(() => play(engine, P1, id("c")), "one resource short", /pay|afford|resource|cost/i);
  assert.equal(zoneOf(engine, id("c")), "hand");
});

clause(EVIL, "9:rule:OMNIPOTENCE", "it covers every icon and every card type: mixed-icon items, locations and tactics deploy with no matching icons", () => {
  const cards: Cards = [
    { key: "mix", def: character({ name: "Mixed", cost: 1, threshold: "rrggddeeoo" }), owner: P1, zone: "hand" },
    { key: "it", def: item({ name: "Gem", cost: 1, threshold: "eee" }), owner: P1, zone: "hand" },
    { key: "lo", def: location({ name: "Keep", cost: 1, threshold: "ooo", structure: 3 }), owner: P1, zone: "hand" },
    { key: "ta", def: tactic({ name: "Trick", cost: 1, threshold: "ddd" }), owner: P1, zone: "hand" }
  ];
  const { engine, id } = omniBoard(printing(EVIL), cards);
  for (const key of ["mix", "it", "lo"]) {
    play(engine, P1, id(key));
    assert.equal(zoneOf(engine, id(key)), "play", `${key} deployed`);
  }
  play(engine, P1, id("ta"));
  assert.equal(zoneOf(engine, id("ta")), "discard", "the tactic was played");
  assert.equal(readyCount(engine, P1), 2, "4 cards at cost 1 were paid");
});

clause(EVIL, "9:rule:OMNIPOTENCE", "an activated ability gated by a threshold can be used without the icons (and not by a normal faction)", () => {
  const def = (name: string) =>
    item({
      name,
      behavior: { abilities: [{ id: "go", type: "activated", threshold: "ooo", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
    });
  const cards = (): Cards => [{ key: "tool", def: def("Tool"), owner: P1, zone: "play" }, ...topOfDeck("d", P1)];
  const omni = omniBoard(printing(EVIL), cards());
  activate(omni.engine, P1, omni.id("tool"), "go");
  assert.equal(omni.engine.state.players[P1].hand.length, 1, "drew a card");
  const plain = omniBoard(developFaction(), cards());
  refused(() => activate(plain.engine, P1, plain.id("tool"), "go"), "control: no [O][O][O]", /threshold/i);
  assert.equal(plain.engine.state.players[P1].hand.length, 0);
});

clause(EVIL, "9:rule:OMNIPOTENCE", "FLIP UP thresholds are met too: a face-down card flips up for its cost with no matching icons", () => {
  const def = character({ name: "Flippable", flipUp: { cost: 1, threshold: "eee" } });
  const flipped = (faction: CardDefinition) => {
    const { engine, id } = omniBoard(faction, [{ key: "card", def, owner: P1, zone: "play", faceDown: true }]);
    try {
      flipUpNow(engine, { type: "flipUp", playerId: P1, cardId: id("card"), selected: {} });
      resolvePendingResponses(engine);
    } catch {
      /* refused */
    }
    return engine.state.cards[id("card")].faceDown === false;
  };
  assert.equal(flipped(printing(EVIL)), true);
  assert.equal(flipped(developFaction()), false, "control: a normal faction lacks [E][E][E]");
});

clause(EVIL, "9:rule:OMNIPOTENCE", "a threshold paragraph on a card of mine is on without the icons (and off for a normal faction)", () => {
  const para = character({
    name: "Paragraph",
    strength: 1,
    life: 3,
    speed: 1,
    behavior: {
      abilities: [
        { id: "para", type: "continuous", condition: { type: "meetsThreshold", threshold: "rrr" }, modifiers: [{ target: "source", stat: "life", operation: "add", value: 3 }] }
      ]
    }
  });
  const lifeOf = (faction: CardDefinition) => {
    const { engine, id } = omniBoard(faction, [{ key: "card", def: para, owner: P1, zone: "play" }]);
    return engine.getStat(id("card"), "life");
  };
  assert.equal(lifeOf(printing(EVIL)), 6);
  assert.equal(lifeOf(developFaction()), 3, "control: threshold unmet, paragraph off");
});

clause(EVIL, "9:rule:OMNIPOTENCE", "it is MY faction's rule: my opponent (a normal faction) still needs the icons for their own cards", () => {
  const def = character({ name: "Triple Rage", cost: 2, threshold: "rrr" });
  const { engine, id } = buildGame({
    playerA: { faction: printing(EVIL) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [{ key: "c", def, owner: P2, zone: "hand" }, ...bank("greed", 6, P2)]
  });
  refused(() => play(engine, P2, id("c")), "the opponent lacks [R][R][R]", /threshold/i);
  assert.equal(zoneOf(engine, id("c")), "hand");
});

// --- deploy costs / thresholds / printed structure of the two non-character cards ---------------

const deployOnly = (def: CardDefinition, resources: Cards) =>
  buildGame({ ...factions(), cards: [{ key: "c", def, owner: P1, zone: "hand" }, ...resources] });

clause(WALL, "0:rule", "deploys for its printed cost 5 with threshold [R][R][R][R] and structure 2; refused one resource short, with only 3 Rage icons, or with Greed instead", () => {
  const ok = deployOnly(printing(WALL), bank("rage", 5, P1));
  play(ok.engine, P1, ok.id("c"));
  assert.equal(zoneOf(ok.engine, ok.id("c")), "play");
  assert.equal(readyCount(ok.engine, P1), 0, "all 5 paid");
  assert.equal(ok.engine.getStat(ok.id("c"), "structure"), 2);
  const short = deployOnly(printing(WALL), bank("rage", 4, P1));
  refused(() => play(short.engine, P1, short.id("c")), "4 resources can't pay cost 5", /pay|afford|resource|cost/i);
  const threeRage = deployOnly(printing(WALL), [...bank("rage", 3, P1), ...bank("greed", 2, P1)]);
  refused(() => play(threeRage.engine, P1, threeRage.id("c")), "only 3 Rage icons for [R][R][R][R]", /threshold|icon|rage/i);
  const greed = deployOnly(printing(WALL), bank("greed", 5, P1));
  refused(() => play(greed.engine, P1, greed.id("c")), "no Rage", /threshold|icon|rage/i);
  assert.equal(zoneOf(greed.engine, greed.id("c")), "hand");
});

clause(STONE, "0:rule", "deploys for its printed cost 3 with threshold [R]; refused one resource short or with Greed instead", () => {
  const ok = deployOnly(printing(STONE), [...bank("rage", 1, P1), ...bank("greed", 2, P1)]); // one [R] icon is all [R] needs
  play(ok.engine, P1, ok.id("c"));
  assert.equal(zoneOf(ok.engine, ok.id("c")), "play");
  assert.equal(readyCount(ok.engine, P1), 0, "all 3 paid");
  const short = deployOnly(printing(STONE), bank("rage", 2, P1));
  refused(() => play(short.engine, P1, short.id("c")), "2 resources can't pay cost 3", /pay|afford|resource|cost/i);
  const greed = deployOnly(printing(STONE), bank("greed", 3, P1));
  refused(() => play(greed.engine, P1, greed.id("c")), "no Rage", /threshold|icon|rage/i);
  assert.equal(zoneOf(greed.engine, greed.id("c")), "hand");
});

clause(STONE, "0:rule", "static: once the Stone itself has been destroyed, a destroyed character of mine no longer triggers it", () => {
  const { engine, id } = stoneBoard({ extra: [{ key: "ki", def: killItem(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("ki"), { selected: { t: [id("stone")] } });
  assert.equal(zoneOf(engine, id("stone")), "discard");
  assert.equal(pending(engine), undefined);
  play(engine, P1, id("kill"), { selected: { t: [id("hero")] } });
  assert.equal(zoneOf(engine, id("hero")), "discard");
  assert.equal(pending(engine), undefined, "no prompt: the Stone is gone");
});
