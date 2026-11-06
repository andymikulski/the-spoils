// Clause tests: decade-of-deckadence-05 (20 rules groups, 40 clauses).
// Purifier of the Fallen, Quilt of Old Banners, Rantzigite Inquisitor, Rantzigore's Blade, Rapine,
// Rasputin Unleashed, Redonkulous, Research Assistant, Ritual of the Double Monkey, Rusty Pickaxe,
// Scepter of the Chosen, Scrag, Scrapyard, Senior Research Assistant, Shaman of the Fallen,
// Shriever General, Silencer, Silent Succubus, Siluriformes Incarnate, Sixsmith's Disciple.
// Expected behavior comes from the PRINTED text only (the manifest's markup); the engine data is used to DRIVE it.

import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import {
  activate,
  bank,
  buildGame,
  character,
  developFaction,
  item,
  location,
  P1,
  P2,
  play,
  resolvePendingResponses,
  tactic,
  volition
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, declineAll, drain, flipUpNow, printing, refused } from "./_clause.js";
import { declareAttackBy, declareAttackOpenWindow, fight, finishBattle, playRaw } from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, tokensOn, zoneOf } from "./_board.js";
import { attachedCount, endTurn, factionOf, readyCount } from "./_turn.js";

type Game = ReturnType<typeof buildGame>;

// --- shared helpers -------------------------------------------------------------------------------------------

interface BoardOpts {
  active?: PlayerId;
  turn?: number;
  faction?: CardDefinition;
  faction2?: CardDefinition;
  random?: () => number;
}
/** A two-player board; P1 is active on turn 2 unless told otherwise. */
function mk(cards: CardPlacement[], o: BoardOpts = {}): Game {
  return buildGame({
    playerA: { faction: o.faction ?? developFaction() },
    playerB: { faction: o.faction2 ?? developFaction() },
    turn: o.turn ?? 2,
    activePlayerId: o.active ?? P1,
    random: o.random ?? (() => 0.5),
    cards
  });
}
/** Marks already-attached (spent) resources. */
const spent = (ps: CardPlacement[], owner: PlayerId = P1): CardPlacement[] =>
  ps.map((p) => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));
const ICONS = ["rage", "greed", "deception", "elitism", "obsession"] as const;
const rage = (n: number, owner: PlayerId = P1) => bank("rage", n, owner);
const greed = (n: number, owner: PlayerId = P1) => bank("greed", n, owner);
const dec = (n: number, owner: PlayerId = P1) => bank("deception", n, owner);
const elit = (n: number, owner: PlayerId = P1) => bank("elitism", n, owner);
const obs = (n: number, owner: PlayerId = P1) => bank("obsession", n, owner);

const handOf = (e: SpoilsEngine, p: PlayerId): string[] => [...e.state.players[p].hand];
const discardOf = (e: SpoilsEngine, p: PlayerId): string[] => [...e.state.players[p].discard];
const deckOf = (e: SpoilsEngine, p: PlayerId): string[] => [...e.state.players[p].deck];
const influence = (e: SpoilsEngine, p: PlayerId): number => e.state.players[p].influence;
const damageOn = (e: SpoilsEngine, id: CardInstanceId): number => e.state.cards[id].damage ?? 0;
const stat = (g: Game, key: string, s: "strength" | "speed" | "life"): number => g.engine.getStat(g.id(key), s);
const plain = (name: string, over: Partial<CardDefinition> = {}): CardDefinition => character({ name, strength: 1, life: 4, speed: 2, text: "plain", ...over });
const thr = (g: Game, p: PlayerId = P1) => g.engine.getThresholds(p) as Record<string, number | undefined>;
const flipUp = (engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}): void => {
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });
  resolvePendingResponses(engine);
};

/** A free tactic that destroys one chosen character (decl `t`). */
const KILL_CHAR = tactic({
  name: "Slay",
  cost: 0,
  behavior: { abilities: [{ id: "slay", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
});
/** A free tactic that destroys one chosen item (decl `t`). */
const KILL_ITEM = tactic({
  name: "Smash",
  cost: 0,
  behavior: { abilities: [{ id: "smash", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
});
/** A free tactic that destroys one chosen card in play of any type (decl `t`). */
const KILL_ANY = tactic({
  name: "Smite",
  cost: 0,
  behavior: { abilities: [{ id: "smite", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
});
/** A free tactic that puts one chosen character into its owner's hand (decl `t`). */
const BOUNCE = tactic({
  name: "Bounce",
  cost: 0,
  behavior: { abilities: [{ id: "bounce", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
});
/** A free tactic that moves one chosen card in hand to the discard pile (decl `t`). */
const TOSS = tactic({
  name: "Toss",
  cost: 0,
  behavior: { abilities: [{ id: "toss", type: "activated", targets: [{ id: "t", selector: { zone: "hand" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "discard" }] }] }
});
/** A free tactic that mills the top card of its controller's deck into their discard pile. */
const MILL = tactic({
  name: "Grind",
  cost: 0,
  behavior: { abilities: [{ id: "grind", type: "activated", effects: [{ type: "mill", player: "controller", count: 1 }] }] }
});
/** A free tactic with no effect at all. */
const NOOP = (name = "Noop"): CardDefinition => tactic({ name, cost: 0, behavior: { abilities: [{ id: "no", type: "activated", effects: [] }] } });

// ============================================================================================================
// Purifier of the Fallen -- character, universal, mercenary, cost 3, threshold [V], 2 str / 3 spd / 2 life
// When this card enters play, void all discard piles.
// If a card would go to a discard pile from anywhere, void it instead.
// ============================================================================================================
const PURI = "f74f67af-3f00-4937-a79d-7e3c53858d85";

function puriBoard(o: { zone?: "hand" | "play"; res?: CardPlacement[]; extra?: CardPlacement[]; active?: PlayerId } = {}): Game {
  return mk(
    [
      { key: "pu", def: printing(PURI), owner: P1, zone: o.zone ?? "hand" },
      { key: "d1", def: plain("Mine Discard"), owner: P1, zone: "discard" },
      { key: "d2", def: item({ name: "Mine Gear" }), owner: P1, zone: "discard" },
      { key: "d3", def: plain("Their Discard"), owner: P2, zone: "discard" },
      { key: "d4", def: NOOP("Their Spell"), owner: P2, zone: "discard" },
      ...(o.res ?? volition(3, P1)),
      ...(o.extra ?? [])
    ],
    { active: o.active }
  );
}

clause(PURI, "0:rule", "printed card: a universal mercenary character, cost 3, threshold [V], 2 strength / 3 speed / 2 life", () => {
  const def = printing(PURI);
  assert.equal(def.type, "character");
  assert.equal(def.trade, "universal");
  assert.deepEqual([...def.subtype], ["mercenary"]);
  assert.equal(def.cost, 3);
  assert.equal(def.threshold, "v");
  assert.deepEqual([def.strength, def.speed, def.life], [2, 3, 2]);
  const g = puriBoard();
  assert.equal(readyCount(g.engine, P1), 3);
  play(g.engine, P1, g.id("pu"));
  assert.equal(zoneOf(g.engine, g.id("pu")), "play");
  assert.equal(readyCount(g.engine, P1), 0, "exactly 3 paid");
  assert.deepEqual([stat(g, "pu", "strength"), stat(g, "pu", "speed"), stat(g, "pu", "life")], [2, 3, 2]);
});

clause(PURI, "0:rule", "cost 3 [V]: refused with 2 resources, and refused with 3 resources none of which is [V]", () => {
  const short = puriBoard({ res: volition(2, P1) });
  refused(() => play(short.engine, P1, short.id("pu")), "2 resources for cost 3");
  assert.equal(zoneOf(short.engine, short.id("pu")), "hand");
  assert.equal(readyCount(short.engine, P1), 2, "nothing paid");
  const noV = puriBoard({ res: rage(3) });
  refused(() => play(noV.engine, P1, noV.id("pu")), "3 resources but no [V]");
  assert.equal(zoneOf(noV.engine, noV.id("pu")), "hand");
  const spare = puriBoard({ res: [...volition(1, P1), ...rage(3)] });
  play(spare.engine, P1, spare.id("pu"));
  assert.equal(readyCount(spare.engine, P1), 1, "the cost is 3, not 4");
});

clause(PURI, "0:rule", "entering play voids EVERY discard pile: mine and the opponent's, all cards of any type", () => {
  const g = puriBoard({ extra: [{ key: "hc", def: plain("Hand Card"), owner: P2, zone: "hand" }, { key: "pc", def: plain("Play Card"), owner: P2, zone: "play" }] });
  play(g.engine, P1, g.id("pu"));
  assert.equal(pending(g.engine), undefined);
  for (const k of ["d1", "d2", "d3", "d4"]) assert.equal(zoneOf(g.engine, g.id(k)), "void", `${k} was voided`);
  assert.deepEqual(discardOf(g.engine, P1), []);
  assert.deepEqual(discardOf(g.engine, P2), []);
  assert.equal(zoneOf(g.engine, g.id("hc")), "hand", "a card in hand is not touched");
  assert.equal(zoneOf(g.engine, g.id("pc")), "play", "a card in play is not touched");
  assert.equal(zoneOf(g.engine, g.id("pu")), "play");
});

clause(PURI, "0:rule", "it voids the opponent's discard pile even when only the opponent has cards in it, and mine even when only I do", () => {
  const onlyTheirs = mk([
    { key: "pu", def: printing(PURI), owner: P1, zone: "hand" },
    { key: "d3", def: plain("Their Discard"), owner: P2, zone: "discard" },
    ...volition(3, P1)
  ]);
  play(onlyTheirs.engine, P1, onlyTheirs.id("pu"));
  assert.equal(zoneOf(onlyTheirs.engine, onlyTheirs.id("d3")), "void");
  const onlyMine = mk([
    { key: "pu", def: printing(PURI), owner: P1, zone: "hand" },
    { key: "d1", def: plain("Mine Discard"), owner: P1, zone: "discard" },
    ...volition(3, P1)
  ]);
  play(onlyMine.engine, P1, onlyMine.id("pu"));
  assert.equal(zoneOf(onlyMine.engine, onlyMine.id("d1")), "void");
});

clause(PURI, "0:rule", "it triggers on the opponent's Purifier entering as well: both piles are voided", () => {
  const g = mk(
    [
      { key: "pu", def: printing(PURI), owner: P2, zone: "hand" },
      { key: "d1", def: plain("Mine Discard"), owner: P1, zone: "discard" },
      { key: "d3", def: plain("Their Discard"), owner: P2, zone: "discard" },
      ...volition(3, P2)
    ],
    { active: P2 }
  );
  play(g.engine, P2, g.id("pu"));
  assert.equal(zoneOf(g.engine, g.id("d1")), "void");
  assert.equal(zoneOf(g.engine, g.id("d3")), "void");
});

clause(PURI, "0:rule", "only THIS card entering triggers it: with a Purifier in play, another character entering voids nothing already in a pile", () => {
  const g = puriBoard({ zone: "play", extra: [{ key: "van", def: plain("Van", { cost: 0 }), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("van"));
  assert.equal(zoneOf(g.engine, g.id("van")), "play");
  for (const k of ["d1", "d2", "d3", "d4"]) assert.equal(zoneOf(g.engine, g.id(k)), "discard", `${k} stays in its discard pile`);
});

clause(PURI, "0:rule", "it voids the piles when it enters, not when it is merely in hand", () => {
  const g = puriBoard();
  for (const k of ["d1", "d2", "d3", "d4"]) assert.equal(zoneOf(g.engine, g.id(k)), "discard");
});

clause(PURI, "1:rule", "a character of mine destroyed goes to the void instead of my discard pile", () => {
  const g = puriBoard({ zone: "play", extra: [{ key: "mine", def: plain("Mine"), owner: P1, zone: "play" }, { key: "slay", def: KILL_CHAR, owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("slay"), { selected: { t: [g.id("mine")] } });
  assert.equal(zoneOf(g.engine, g.id("mine")), "void");
  assert.ok(!discardOf(g.engine, P1).includes(g.id("mine")), "!discardOf(g.engine, P1).includes(mine)");
});

clause(PURI, "1:rule", "an opponent's character or item destroyed goes to the void, not to their discard pile", () => {
  const g = puriBoard({
    zone: "play",
    extra: [
      { key: "foe", def: plain("Foe"), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Their Gear" }), owner: P2, zone: "play" },
      { key: "slay", def: KILL_CHAR, owner: P1, zone: "hand" },
      { key: "smash", def: KILL_ITEM, owner: P1, zone: "hand" }
    ]
  });
  play(g.engine, P1, g.id("slay"), { selected: { t: [g.id("foe")] } });
  play(g.engine, P1, g.id("smash"), { selected: { t: [g.id("gear")] } });
  assert.equal(zoneOf(g.engine, g.id("foe")), "void");
  assert.equal(zoneOf(g.engine, g.id("gear")), "void");
  assert.deepEqual([...discardOf(g.engine, P2)].sort(), [g.id("d3"), g.id("d4")].sort(), "the opponent's discard pile gained nothing");
});

clause(PURI, "1:rule", "a tactic goes to the void once it resolves, mine and the opponent's, instead of to the discard pile", () => {
  const g = puriBoard({
    zone: "play",
    extra: [
      { key: "foe", def: plain("Foe"), owner: P2, zone: "play" },
      { key: "slay", def: KILL_CHAR, owner: P1, zone: "hand" }
    ]
  });
  play(g.engine, P1, g.id("slay"), { selected: { t: [g.id("foe")] } });
  assert.equal(zoneOf(g.engine, g.id("slay")), "void", "my resolved tactic");
  const h = puriBoard({
    zone: "play",
    active: P2,
    extra: [
      { key: "mine", def: plain("Mine"), owner: P1, zone: "play" },
      { key: "oslay", def: tactic({ ...KILL_CHAR, name: "Their Slay", id: "their-slay" }), owner: P2, zone: "hand" }
    ]
  });
  play(h.engine, P2, h.id("oslay"), { selected: { t: [h.id("mine")] } });
  assert.equal(zoneOf(h.engine, h.id("oslay")), "void", "the opponent's resolved tactic");
  assert.equal(zoneOf(h.engine, h.id("mine")), "void");
});

clause(PURI, "1:rule", "a card discarded from hand by an effect goes to the void", () => {
  const g = puriBoard({
    zone: "play",
    extra: [{ key: "h1", def: plain("Hand One"), owner: P2, zone: "hand" }, { key: "toss", def: TOSS, owner: P1, zone: "hand" }]
  });
  play(g.engine, P1, g.id("toss"), { selected: { t: [g.id("h1")] } });
  assert.equal(zoneOf(g.engine, g.id("h1")), "void");
  assert.deepEqual([...discardOf(g.engine, P2)].sort(), [g.id("d3"), g.id("d4")].sort(), "nothing new in their pile");
});

clause(PURI, "1:rule", "a card milled from the deck goes to the void ('from anywhere')", () => {
  const g = puriBoard({
    zone: "play",
    extra: [...fillers("dk", 3, P1, "deck"), { key: "grind", def: MILL, owner: P1, zone: "hand" }]
  });
  const top = deckOf(g.engine, P1)[0];
  play(g.engine, P1, g.id("grind"));
  assert.equal(zoneOf(g.engine, top), "void");
  assert.equal(deckOf(g.engine, P1).length, 2);
});

clause(PURI, "1:rule", "a character killed in battle goes to the void", () => {
  const g = puriBoard({
    zone: "play",
    extra: [
      { key: "att", def: plain("Attacker", { strength: 4, life: 5 }), owner: P1, zone: "play" },
      { key: "blk", def: plain("Blocker", { strength: 1, life: 2 }), owner: P2, zone: "play" }
    ]
  });
  fight(g.engine, P1, [g.id("att")], { type: "faction", playerId: P2 }, [g.id("blk")]);
  assert.equal(zoneOf(g.engine, g.id("blk")), "void");
  assert.ok(!discardOf(g.engine, P2).includes(g.id("blk")), "!discardOf(g.engine, P2).includes(blk)");
});

clause(PURI, "1:rule", "a card that would go somewhere else is not voided: a character put into its owner's hand stays in hand", () => {
  const g = puriBoard({ zone: "play", extra: [{ key: "mine", def: plain("Mine"), owner: P1, zone: "play" }, { key: "b", def: BOUNCE, owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("b"), { selected: { t: [g.id("mine")] } });
  assert.equal(zoneOf(g.engine, g.id("mine")), "hand");
});

clause(PURI, "1:rule", "the Purifier itself destroyed goes to the void, and once it is gone destroyed cards go to the discard pile again", () => {
  const g = puriBoard({
    zone: "play",
    extra: [
      { key: "mine", def: plain("Mine"), owner: P1, zone: "play" },
      { key: "s1", def: KILL_CHAR, owner: P1, zone: "hand" },
      { key: "s2", def: tactic({ ...KILL_CHAR, name: "Slay Two", id: "slay-two" }), owner: P1, zone: "hand" }
    ]
  });
  play(g.engine, P1, g.id("s1"), { selected: { t: [g.id("pu")] } });
  assert.equal(zoneOf(g.engine, g.id("pu")), "void", "the Purifier is a card that would go to a discard pile");
  play(g.engine, P1, g.id("s2"), { selected: { t: [g.id("mine")] } });
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard", "with the Purifier gone the rule is off");
});

clause(PURI, "1:rule", "the rule is off before the Purifier is in play: a character destroyed with the Purifier still in hand goes to the discard pile", () => {
  const g = puriBoard({ extra: [{ key: "mine", def: plain("Mine"), owner: P1, zone: "play" }, { key: "slay", def: KILL_CHAR, owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("slay"), { selected: { t: [g.id("mine")] } });
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard");
  assert.equal(zoneOf(g.engine, g.id("slay")), "discard");
});

// ============================================================================================================
// Quilt of Old Banners -- item, universal, banner, cost 0
// UNIQUE QUILT -- When this card enters play and at the start of each of your turns, name a non-[V]
// resource icon. X is that icon. Until the start of your next turn, this card gains "PROVIDES: X".
// HAND IT DOWN -- COST: Pay 1. Shuffle this card into its owner's deck. -- EFFECT: Draw a card.
// ============================================================================================================
const QUILT = "30c31351-efd8-4d51-a8b3-187a551ccd43";

function quiltGame(extra: CardPlacement[] = [], o: { quilt?: "hand" | "play"; active?: PlayerId } = {}): Game {
  return mk([{ key: "q", def: printing(QUILT), owner: P1, zone: o.quilt ?? "hand" }, ...extra], { active: o.active ?? P1, turn: (o.active ?? P1) === P1 ? 1 : 2 });
}
const iconTotals = (g: Game, p: PlayerId = P1) => Object.fromEntries(ICONS.map((i) => [i, thr(g, p)[i] ?? 0]));
const zeroIcons = { rage: 0, greed: 0, deception: 0, elitism: 0, obsession: 0 };

clause(QUILT, "0:unique", "printed card: a universal banner item costing 0 with no threshold, deployable with no resources", () => {
  const def = printing(QUILT);
  assert.equal(def.type, "item");
  assert.equal(def.trade, "universal");
  assert.deepEqual([...def.subtype], ["banner"]);
  assert.equal(def.cost, 0);
  assert.ok(!def.threshold, "no threshold");
  const g = quiltGame();
  assert.equal(g.engine.getCardPlayability(P1, g.id("q")).playable, true, "deployable with no resources (cost 0)");
});

clause(QUILT, "0:unique", "UNIQUE QUILT: a second Quilt I control forces me to choose which one to keep; the other is destroyed", () => {
  const g = quiltGame(
    [
      { key: "q2", def: printing(QUILT), owner: P1, zone: "play" },
      { key: "van", def: plain("Van", { cost: 0 }), owner: P1, zone: "hand" }
    ],
    { quilt: "play" }
  );
  play(g.engine, P1, g.id("van"), {});
  const pc = pending(g.engine) as unknown as { kind: string; playerId: string; unique: string; candidates: string[] } | undefined;
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.equal(pc?.playerId, P1);
  assert.equal(pc?.unique, "quilt");
  assert.deepEqual([...(pc?.candidates ?? [])].sort(), [g.id("q"), g.id("q2")].sort());
  answerPending(g.engine, "uniqueSurvivor", { keep: g.id("q2") });
  assert.equal(zoneOf(g.engine, g.id("q2")), "play");
  assert.equal(zoneOf(g.engine, g.id("q")), "discard");
});

clause(QUILT, "0:unique", "the identifier is QUILT: another card of mine carrying UNIQUE QUILT conflicts with it, a card with another identifier does not", () => {
  const same = quiltGame(
    [
      { key: "other", def: character({ name: "OtherQuilt", unique: "quilt" }), owner: P1, zone: "play" },
      { key: "van", def: plain("Van", { cost: 0 }), owner: P1, zone: "hand" }
    ],
    { quilt: "play" }
  );
  play(same.engine, P1, same.id("van"), {});
  assert.equal((pending(same.engine) as unknown as { kind: string } | undefined)?.kind, "uniqueSurvivor");
  const diff = quiltGame(
    [
      { key: "other", def: character({ name: "OtherBanner", unique: "banner" }), owner: P1, zone: "play" },
      { key: "van", def: plain("Van", { cost: 0 }), owner: P1, zone: "hand" }
    ],
    { quilt: "play" }
  );
  play(diff.engine, P1, diff.id("van"), {});
  assert.equal(diff.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(diff.engine, diff.id("q")), "play");
  assert.equal(zoneOf(diff.engine, diff.id("other")), "play");
});

clause(QUILT, "0:unique", "UNIQUE is per player: the opponent's own Quilt does not conflict, and one Quilt alone raises no choice", () => {
  const g = quiltGame(
    [
      { key: "q2", def: printing(QUILT), owner: P2, zone: "play" },
      { key: "van", def: plain("Van", { cost: 0 }), owner: P1, zone: "hand" }
    ],
    { quilt: "play" }
  );
  play(g.engine, P1, g.id("van"), {});
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("q")), "play");
  assert.equal(zoneOf(g.engine, g.id("q2")), "play");
});

clause(QUILT, "0:unique", "deploying a second Quilt from hand while one is in play raises the survivor choice", () => {
  const g = quiltGame([{ key: "q2", def: printing(QUILT), owner: P1, zone: "play" }]);
  play(g.engine, P1, g.id("q"), {});
  drain(g.engine, (pc) => (pc.kind === "nameValue" ? { kind: "nameValue", value: "rage" } : pc.kind === "uniqueSurvivor" ? { kind: "uniqueSurvivor", keep: g.id("q") } : declineAll(pc)));
  assert.equal(zoneOf(g.engine, g.id("q")), "play");
  assert.equal(zoneOf(g.engine, g.id("q2")), "discard", "only one Quilt can stay");
});

clause(QUILT, "1:rule", "entering play puts it in play and asks its controller to name a resource icon (cost 0, no resources needed)", () => {
  const g = quiltGame();
  play(g.engine, P1, g.id("q"), {});
  const pc = pending(g.engine) as unknown as { kind: string; playerId: string; valueKind: string } | undefined;
  assert.equal(zoneOf(g.engine, g.id("q")), "play");
  assert.equal(pc?.kind, "nameValue");
  assert.equal(pc?.playerId, P1, "I name it");
  assert.equal(pc?.valueKind, "resourceIcon");
});

clause(QUILT, "1:rule", "naming each non-[V] icon makes the Quilt provide exactly that one icon (X), one of it", () => {
  for (const icon of ICONS) {
    const g = quiltGame();
    play(g.engine, P1, g.id("q"), {});
    answerPending(g.engine, "nameValue", { value: icon });
    assert.equal(g.engine.state.pendingChoice, undefined);
    assert.deepEqual(iconTotals(g), { ...zeroIcons, [icon]: 1 }, `naming ${icon}`);
    assert.deepEqual(iconTotals(g, P2), zeroIcons, "the opponent gets nothing");
  }
});

clause(QUILT, "1:rule", "the named icon is only an icon: it unlocks a [R] card but adds no resource to pay with", () => {
  const gate = { key: "gate", def: character({ name: "Gate", cost: 0, threshold: "r" }), owner: P1, zone: "hand" as const };
  const g = quiltGame([gate]);
  assert.equal(g.engine.getCardPlayability(P1, g.id("gate")).playable, false, "no [R] before");
  play(g.engine, P1, g.id("q"), {});
  answerPending(g.engine, "nameValue", { value: "rage" });
  assert.equal(g.engine.getCardPlayability(P1, g.id("gate")).playable, true, "[R] met by the Quilt's PROVIDES");
  assert.equal(readyCount(g.engine, P1), 0, "it gives no resource to pay with");
  const other = quiltGame([gate]);
  play(other.engine, P1, other.id("q"), {});
  answerPending(other.engine, "nameValue", { value: "greed" });
  assert.equal(other.engine.getCardPlayability(P1, other.id("gate")).playable, false, "naming greed does not give [R]");
});

clause(QUILT, "1:rule", "[V] can't be named (non-[V] icon only): naming volition is refused and the naming stays open", () => {
  const g = quiltGame();
  play(g.engine, P1, g.id("q"), {});
  refused(() => answerPending(g.engine, "nameValue", { value: "volition" }), "volition is not allowed", /icon|volition|non/i);
  assert.equal(pending(g.engine)?.kind, "nameValue", "the naming is still open");
  answerPending(g.engine, "nameValue", { value: "rage" });
  assert.equal(thr(g).rage, 1);
  assert.equal(thr(g).volition ?? 0, 0, "no volition from the Quilt");
});

clause(QUILT, "1:rule", "only the Quilt itself entering triggers the naming: another card entering does not", () => {
  const g = quiltGame([{ key: "van", def: plain("Van", { cost: 0 }), owner: P1, zone: "hand" }], { quilt: "play" });
  play(g.engine, P1, g.id("van"), {});
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(iconTotals(g), zeroIcons);
});

clause(QUILT, "1:rule", "at the start of each of MY turns I name an icon: it lasts until the start of my next turn and is replaced then; the opponent's turn start asks nothing", () => {
  const g = quiltGame([], { quilt: "play" });
  assert.deepEqual(iconTotals(g), zeroIcons, "nothing named yet");
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(g.engine.state.pendingChoice, undefined, "the opponent's turn start does not ask me");
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  const pc = pending(g.engine) as unknown as { kind: string; playerId: string; valueKind: string } | undefined;
  assert.equal(pc?.kind, "nameValue");
  assert.equal(pc?.playerId, P1);
  assert.equal(pc?.valueKind, "resourceIcon");
  answerPending(g.engine, "nameValue", { value: "greed" });
  assert.deepEqual(iconTotals(g), { ...zeroIcons, greed: 1 });
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(iconTotals(g), { ...zeroIcons, greed: 1 }, "still provided during the opponent's turn (until the start of MY next turn)");
  endTurn(g.engine, P2);
  assert.equal(pending(g.engine)?.kind, "nameValue", "asked again at my next turn start");
  assert.deepEqual(iconTotals(g), zeroIcons, "the old grant ended at the start of my turn");
  answerPending(g.engine, "nameValue", { value: "rage" });
  assert.deepEqual(iconTotals(g), { ...zeroIcons, rage: 1 }, "the new icon replaces the old one");
});

clause(QUILT, "1:rule", "the turn-start naming is asked of the Quilt's controller, not of the opponent whose Quilt it isn't", () => {
  const g = quiltGame([], { quilt: "play", active: P2 });
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(pending(g.engine)?.playerId, P1);
  answerPending(g.engine, "nameValue", { value: "elitism" });
  assert.equal(thr(g, P1).elitism, 1);
  assert.equal(thr(g, P2).elitism ?? 0, 0);
});

clause(QUILT, "1:rule", "the Quilt's PROVIDES ends when it leaves play: nothing is provided after it is destroyed", () => {
  const g = quiltGame([{ key: "smash", def: KILL_ITEM, owner: P1, zone: "hand" }]);
  play(g.engine, P1, g.id("q"), {});
  answerPending(g.engine, "nameValue", { value: "deception" });
  assert.equal(thr(g).deception, 1);
  play(g.engine, P1, g.id("smash"), { selected: { t: [g.id("q")] } });
  assert.equal(zoneOf(g.engine, g.id("q")), "discard");
  assert.deepEqual(iconTotals(g), zeroIcons);
});

clause(QUILT, "2:ability:hand-it-down", "HAND IT DOWN: pays 1, shuffles the Quilt into its owner's deck, and I draw a card", () => {
  const g = quiltGame([...fillers("d", 3, P1, "deck"), ...rage(3)], { quilt: "play" });
  const hand = handOf(g.engine, P1).length;
  const ready = readyCount(g.engine, P1);
  activate(g.engine, P1, g.id("q"), "hand-it-down");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.ok(["deck", "hand"].includes(zoneOf(g.engine, g.id("q"))), "shuffled into the deck (the draw may take it straight back out)");
  assert.equal(readyCount(g.engine, P1), ready - 1, "pays exactly 1");
  assert.equal(handOf(g.engine, P1).length, hand + 1, "draws a card");
  assert.equal(deckOf(g.engine, P1).length, 3, "deck: 3 + Quilt - 1 drawn");
});

clause(QUILT, "2:ability:hand-it-down", "HAND IT DOWN really shuffles: with a fixed random source the deck is reordered and the Quilt did not stay on top", () => {
  const deck = fillers("d", 4, P1, "deck");
  const g = mk([{ key: "q", def: printing(QUILT), owner: P1, zone: "play" }, ...deck, ...rage(1)], { random: () => 0 });
  const top = deckOf(g.engine, P1)[0];
  const before = handOf(g.engine, P1);
  activate(g.engine, P1, g.id("q"), "hand-it-down");
  const drawn = handOf(g.engine, P1).filter((c) => !before.includes(c));
  assert.equal(drawn.length, 1);
  assert.notEqual(drawn[0], g.id("q"), "the Quilt did not stay on top");
  assert.notEqual(drawn[0], top, "the old top card is not simply drawn: the deck was shuffled");
  assert.equal(zoneOf(g.engine, g.id("q")), "deck");
});

clause(QUILT, "2:ability:hand-it-down", "HAND IT DOWN really puts the Quilt into the deck: with no other card in the deck, the draw takes the Quilt back", () => {
  const g = quiltGame(rage(1), { quilt: "play" });
  assert.equal(deckOf(g.engine, P1).length, 0);
  activate(g.engine, P1, g.id("q"), "hand-it-down");
  assert.equal(zoneOf(g.engine, g.id("q")), "hand", "shuffled into the (empty) deck, then drawn");
  assert.equal(readyCount(g.engine, P1), 0, "Pay 1 was paid");
});

clause(QUILT, "2:ability:hand-it-down", "HAND IT DOWN is refused with no resource to pay (also with only spent resources), and leaves the Quilt in play", () => {
  const g = quiltGame([{ key: "d0", def: plain("D0"), owner: P1, zone: "deck" }], { quilt: "play" });
  refused(() => activate(g.engine, P1, g.id("q"), "hand-it-down"), "no resource for Pay 1");
  assert.equal(zoneOf(g.engine, g.id("q")), "play");
  assert.equal(handOf(g.engine, P1).length, 0, "no card drawn");
  const spentOnly = quiltGame([{ key: "d0", def: plain("D0"), owner: P1, zone: "deck" }, ...spent(rage(2))], { quilt: "play" });
  refused(() => activate(spentOnly.engine, P1, spentOnly.id("q"), "hand-it-down"), "only spent resources");
  assert.equal(zoneOf(spentOnly.engine, spentOnly.id("q")), "play");
});

clause(QUILT, "2:ability:hand-it-down", "it goes to its OWNER's deck and its controller draws: P2 controls P1's Quilt", () => {
  const g = mk(
    [
      { key: "q", def: printing(QUILT), owner: P1, controller: P2, zone: "play" },
      ...fillers("a", 1, P1, "deck"),
      ...fillers("b", 2, P2, "deck"),
      ...rage(2, P2)
    ],
    { active: P2 }
  );
  const h1 = handOf(g.engine, P1).length;
  const h2 = handOf(g.engine, P2).length;
  activate(g.engine, P2, g.id("q"), "hand-it-down");
  assert.equal(zoneOf(g.engine, g.id("q")), "deck");
  assert.ok(deckOf(g.engine, P1).includes(g.id("q")), "in its owner's (P1's) deck");
  assert.ok(!deckOf(g.engine, P2).includes(g.id("q")), "not in the controller's deck");
  assert.equal(handOf(g.engine, P2).length, h2 + 1, "the controller draws");
  assert.equal(handOf(g.engine, P1).length, h1, "the owner draws nothing");
});

// ============================================================================================================
// Rantzigite Inquisitor -- character, arcanist, inquisitor, cost 2, threshold [O][O], 2 str / 3 spd / 1 life
// EXTRA COST: You may discard an Arcanist card. If you do, you may deploy this card for free.
// When this card is destroyed, pick an opponent. That opponent discards a card.
// ============================================================================================================
const RANTZ = "c27110b6-26bc-473b-874c-0461819ee0d3";

const arcanistCard = (name: string) => plain(name, { trade: "arcanist", cost: 1 });
function rantzBoard(res: CardPlacement[], extra: CardPlacement[] = []): Game {
  return mk([
    { key: "ri", def: printing(RANTZ), owner: P1, zone: "hand" },
    { key: "arc", def: arcanistCard("Arc One"), owner: P1, zone: "hand" },
    { key: "arc2", def: arcanistCard("Arc Two"), owner: P1, zone: "hand" },
    { key: "rog", def: plain("Rogue Card", { trade: "rogue" }), owner: P1, zone: "hand" },
    { key: "uni", def: plain("Universal Card", { trade: "universal" }), owner: P1, zone: "hand" },
    ...res,
    ...extra
  ]);
}
const castRantz = (g: Game, tossed?: string[]) => play(g.engine, P1, g.id("ri"), { selected: tossed ? { tossed: tossed.map((k) => g.id(k)) } : {} });

clause(RANTZ, "0:extraCost", "printed card: an arcanist inquisitor character, cost 2, threshold [O][O], 2 strength / 3 speed / 1 life; deploys for exactly 2 with no discard", () => {
  const def = printing(RANTZ);
  assert.equal(def.type, "character");
  assert.equal(def.trade, "arcanist");
  assert.deepEqual([...def.subtype], ["inquisitor"]);
  assert.equal(def.cost, 2);
  assert.equal(def.threshold, "oo");
  assert.deepEqual([def.strength, def.speed, def.life], [2, 3, 1]);
  const g = rantzBoard(obs(3));
  castRantz(g);
  assert.equal(zoneOf(g.engine, g.id("ri")), "play");
  assert.equal(readyCount(g.engine, P1), 1, "paid 2 of 3");
  assert.deepEqual([stat(g, "ri", "strength"), stat(g, "ri", "speed"), stat(g, "ri", "life")], [2, 3, 1]);
  assert.equal(zoneOf(g.engine, g.id("arc")), "hand", "no discard happened");
});

clause(RANTZ, "0:extraCost", "without a discard the cost is 2 and the threshold [O][O]: refused one resource short, refused with 2 non-[O] resources", () => {
  const short = rantzBoard(obs(1));
  refused(() => castRantz(short), "1 resource for cost 2");
  assert.equal(zoneOf(short.engine, short.id("ri")), "hand");
  const noO = rantzBoard(rage(3));
  refused(() => castRantz(noO), "no [O] icons");
  assert.equal(zoneOf(noO.engine, noO.id("ri")), "hand");
  const oneO = rantzBoard([...obs(1), ...rage(2)]);
  refused(() => castRantz(oneO), "only one [O]");
  assert.equal(zoneOf(oneO.engine, oneO.id("ri")), "hand");
  const ok = rantzBoard([...obs(2), ...rage(1)]);
  castRantz(ok);
  assert.equal(zoneOf(ok.engine, ok.id("ri")), "play", "control");
});

clause(RANTZ, "0:extraCost", "discarding an Arcanist card from hand deploys it for free: the card is discarded and no resource is paid", () => {
  const g = rantzBoard(obs(2));
  assert.equal(readyCount(g.engine, P1), 2);
  castRantz(g, ["arc"]);
  assert.equal(zoneOf(g.engine, g.id("ri")), "play");
  assert.equal(zoneOf(g.engine, g.id("arc")), "discard", "the Arcanist card was discarded");
  assert.equal(readyCount(g.engine, P1), 2, "free: nothing was paid");
  assert.equal(zoneOf(g.engine, g.id("arc2")), "hand", "only the one card was discarded");
});

clause(RANTZ, "0:extraCost", "free deploy works with nothing ready to pay as long as the threshold [O][O] is met (two spent [O])", () => {
  const g = rantzBoard(spent(obs(2)));
  assert.equal(readyCount(g.engine, P1), 0);
  refused(() => castRantz(g), "cost 2 with nothing ready and no discard");
  assert.equal(zoneOf(g.engine, g.id("ri")), "hand");
  castRantz(g, ["arc"]);
  assert.equal(zoneOf(g.engine, g.id("ri")), "play", "discarded: deployed for free");
  assert.equal(zoneOf(g.engine, g.id("arc")), "discard");
});

clause(RANTZ, "0:extraCost", "free is only the cost: the [O][O] threshold is still required (CR 308.1a), so a discard does not deploy it with no [O] icons", () => {
  const none = rantzBoard(rage(2));
  refused(() => castRantz(none, ["arc"]), "free but no [O][O]");
  assert.equal(zoneOf(none.engine, none.id("ri")), "hand");
  assert.equal(zoneOf(none.engine, none.id("arc")), "hand", "the refused play discarded nothing");
  const bare = rantzBoard([]);
  refused(() => castRantz(bare, ["arc"]), "free but no resources at all");
  assert.equal(zoneOf(bare.engine, bare.id("ri")), "hand");
  const one = rantzBoard(obs(1));
  refused(() => castRantz(one, ["arc"]), "free but only one [O]");
  assert.equal(zoneOf(one.engine, one.id("ri")), "hand");
});

clause(RANTZ, "0:extraCost", "only an ARCANIST card can be discarded: rogue and universal cards in hand are refused (control: an Arcanist card works)", () => {
  for (const bad of ["rog", "uni"]) {
    const g = rantzBoard(obs(2));
    refused(() => castRantz(g, [bad]), `discarding ${bad}`);
    assert.equal(zoneOf(g.engine, g.id("ri")), "hand");
    assert.equal(zoneOf(g.engine, g.id(bad)), "hand");
    assert.equal(readyCount(g.engine, P1), 2, "nothing paid");
  }
  const ok = rantzBoard(obs(2));
  castRantz(ok, ["arc2"]);
  assert.equal(zoneOf(ok.engine, ok.id("ri")), "play");
});

clause(RANTZ, "0:extraCost", "any Arcanist card counts, not only characters: an arcanist item, tactic or second Inquisitor can be discarded", () => {
  const extra: CardPlacement[] = [
    { key: "ai", def: item({ name: "Arcanist Item", trade: "arcanist" }), owner: P1, zone: "hand" },
    { key: "at", def: tactic({ name: "Arcanist Tactic", trade: "arcanist", cost: 1 }), owner: P1, zone: "hand" },
    { key: "ri2", def: printing(RANTZ), owner: P1, zone: "hand" }
  ];
  for (const k of ["ai", "at", "ri2"]) {
    const g = rantzBoard(obs(2), extra);
    castRantz(g, [k]);
    assert.equal(zoneOf(g.engine, g.id("ri")), "play", `discarding ${k}`);
    assert.equal(zoneOf(g.engine, g.id(k)), "discard");
    assert.equal(readyCount(g.engine, P1), 2);
  }
});

clause(RANTZ, "0:extraCost", "the discarded card must come from my hand: an Arcanist card in play, in the discard pile or in the opponent's hand is refused; the card can't discard itself", () => {
  const extra: CardPlacement[] = [
    { key: "inplay", def: arcanistCard("In Play"), owner: P1, zone: "play" },
    { key: "indisc", def: arcanistCard("In Discard"), owner: P1, zone: "discard" },
    { key: "theirs", def: arcanistCard("Theirs"), owner: P2, zone: "hand" }
  ];
  for (const k of ["inplay", "indisc", "theirs"]) {
    const g = rantzBoard(obs(2), extra);
    refused(() => castRantz(g, [k]), `discarding ${k}`);
    assert.equal(zoneOf(g.engine, g.id("ri")), "hand");
  }
  const self = rantzBoard(obs(2));
  refused(() => castRantz(self, ["ri"]), "discarding itself");
  assert.equal(zoneOf(self.engine, self.id("ri")), "hand");
});

clause(RANTZ, "0:extraCost", "you may discard AN Arcanist card: exactly one, so naming two is refused", () => {
  const g = rantzBoard(obs(2));
  refused(() => castRantz(g, ["arc", "arc2"]), "two cards");
  assert.equal(zoneOf(g.engine, g.id("ri")), "hand");
  assert.equal(zoneOf(g.engine, g.id("arc")), "hand");
  assert.equal(zoneOf(g.engine, g.id("arc2")), "hand");
});

clause(RANTZ, "0:extraCost", "the discard is a cost: it is paid when the card is played, before the opponent can respond", () => {
  const g = rantzBoard(obs(2));
  playRaw(g.engine, P1, g.id("ri"), { selected: { tossed: [g.id("arc")] } });
  assert.equal(zoneOf(g.engine, g.id("arc")), "discard", "discarded while the Inquisitor is still waiting for responses");
  assert.equal(readyCount(g.engine, P1), 2, "and nothing was paid");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("ri")), "play");
});

// CR 506.2: replacements don't apply to extra costs, so a card discarded as a cost still reaches the discard pile.
clause(PURI, "1:rule", "a card discarded as a COST (Rantzigite Inquisitor's EXTRA COST) with a Purifier in play goes to the discard pile: replacements don't apply to extra costs (CR 506.2)", () => {
  const g = rantzBoard(obs(2), [{ key: "pu", def: printing(PURI), owner: P1, zone: "play" }]);
  castRantz(g, ["arc"]);
  assert.equal(zoneOf(g.engine, g.id("ri")), "play");
  assert.equal(zoneOf(g.engine, g.id("arc")), "discard");
});

function rantzDeath(oppHand: number, o: { controller?: PlayerId } = {}): Game {
  return mk([
    { key: "ri", def: printing(RANTZ), owner: P1, ...(o.controller ? { controller: o.controller } : {}), zone: "play" },
    { key: "foe", def: plain("Foe"), owner: P2, zone: "play" },
    { key: "slay", def: KILL_CHAR, owner: P1, zone: "hand" },
    ...fillers("oh", oppHand, P2, "hand"),
    ...fillers("mh", 2, P1, "hand")
  ]);
}
const slayRi = (g: Game, t = "ri") => play(g.engine, P1, g.id("slay"), { selected: { t: [g.id(t)] } });

clause(RANTZ, "1:rule", "when it is destroyed the opponent chooses and discards a card from their hand; the rest stay", () => {
  const g = rantzDeath(3);
  slayRi(g);
  const pc = pending(g.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the opponent chooses what they discard");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oh1")] });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("ri")), "discard");
  assert.equal(zoneOf(g.engine, g.id("oh1")), "discard", "their pick went to their discard pile");
  assert.equal(zoneOf(g.engine, g.id("oh0")), "hand");
  assert.equal(zoneOf(g.engine, g.id("oh2")), "hand");
  assert.deepEqual(discardOf(g.engine, P2), [g.id("oh1")]);
  assert.equal(handOf(g.engine, P1).length, 2, "I discard nothing");
});

clause(RANTZ, "1:rule", "the opponent must discard a card: an empty pick is refused while they hold one, and exactly one card is discarded", () => {
  const g = rantzDeath(3);
  slayRi(g);
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [] }), "discarding nothing");
  assert.equal(handOf(g.engine, P2).length, 3, "nothing was discarded by the refused answer");
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget", "the choice is still open");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oh0")] });
  assert.equal(handOf(g.engine, P2).length, 2);
});

clause(RANTZ, "1:rule", "an opponent with an empty hand discards nothing and nothing hangs", () => {
  const g = rantzDeath(0);
  slayRi(g);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("ri")), "discard");
  assert.deepEqual(discardOf(g.engine, P2), []);
});

clause(RANTZ, "1:rule", "an opponent with one card discards that card", () => {
  const g = rantzDeath(1);
  slayRi(g);
  if (pending(g.engine)) answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oh0")] });
  assert.equal(zoneOf(g.engine, g.id("oh0")), "discard");
  assert.equal(pending(g.engine), undefined);
});

clause(RANTZ, "1:rule", "it triggers only when THIS card is destroyed: another character of mine destroyed makes the opponent discard nothing", () => {
  const g = mk([
    { key: "ri", def: printing(RANTZ), owner: P1, zone: "play" },
    { key: "mine", def: plain("Mine"), owner: P1, zone: "play" },
    { key: "slay", def: KILL_CHAR, owner: P1, zone: "hand" },
    ...fillers("oh", 2, P2, "hand")
  ]);
  slayRi(g, "mine");
  assert.equal(pending(g.engine), undefined);
  assert.equal(handOf(g.engine, P2).length, 2);
  assert.equal(zoneOf(g.engine, g.id("ri")), "play");
});

clause(RANTZ, "1:rule", "it does not trigger when the Inquisitor leaves play without being destroyed: put into its owner's hand", () => {
  const g = mk([
    { key: "ri", def: printing(RANTZ), owner: P1, zone: "play" },
    { key: "b", def: BOUNCE, owner: P1, zone: "hand" },
    ...fillers("oh", 2, P2, "hand")
  ]);
  play(g.engine, P1, g.id("b"), { selected: { t: [g.id("ri")] } });
  assert.equal(zoneOf(g.engine, g.id("ri")), "hand");
  assert.equal(pending(g.engine), undefined, "no discard prompt");
  assert.equal(handOf(g.engine, P2).length, 2);
});

clause(RANTZ, "1:rule", "it does not trigger when the Inquisitor is voided from play (not destroyed)", () => {
  const voidIt = tactic({
    name: "Banish",
    cost: 0,
    behavior: { abilities: [{ id: "banish", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "void" }] }] }
  });
  const g = mk([
    { key: "ri", def: printing(RANTZ), owner: P1, zone: "play" },
    { key: "v", def: voidIt, owner: P1, zone: "hand" },
    ...fillers("oh", 2, P2, "hand")
  ]);
  play(g.engine, P1, g.id("v"), { selected: { t: [g.id("ri")] } });
  assert.equal(zoneOf(g.engine, g.id("ri")), "void");
  assert.equal(pending(g.engine), undefined);
  assert.equal(handOf(g.engine, P2).length, 2);
});

clause(RANTZ, "1:rule", "it triggers when the Inquisitor is destroyed in battle too", () => {
  const g = mk([
    { key: "ri", def: printing(RANTZ), owner: P1, zone: "play" },
    { key: "big", def: plain("Big", { strength: 5, life: 5 }), owner: P2, zone: "play" },
    ...fillers("oh", 2, P2, "hand")
  ], { active: P2 });
  declareAttackBy(g.engine, P2, [g.id("big")]);
  declareBlockers(g.engine, P1, [g.id("ri")]);
  finishBattle(g.engine, undefined, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [g.id("oh0")] } : declineAll(pc)));
  assert.equal(zoneOf(g.engine, g.id("ri")), "discard");
  assert.equal(zoneOf(g.engine, g.id("oh0")), "discard", "the attacker (my opponent) discarded");
});

clause(RANTZ, "1:rule", "'pick an opponent' is relative to its controller: when my opponent controls my Inquisitor and it dies, I am the one who discards", () => {
  const g = rantzDeath(2, { controller: P2 });
  slayRi(g);
  const pc = pending(g.engine);
  assert.ok(pc, "a discard is asked");
  assert.equal(pc!.playerId, P1, "the controller's opponent (me) discards");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("mh0")] });
  assert.equal(zoneOf(g.engine, g.id("mh0")), "discard");
  assert.equal(handOf(g.engine, P2).length, 2, "the controller discards nothing");
});

// ============================================================================================================
// Rantzigore's Blade -- item, arcanist, gear, cost 3, threshold [O][O][O]
// ATTACH TO CHARACTER. The attached character gains 2 strength and gains COVERT.
// When you deploy a tactic, if this card is in your discard pile, you may put this card into play
// attached to a character you control.
// ============================================================================================================
const BLADE = "f3d584a6-c733-4f51-b554-0959ab5f6f28";

function bladeBoard(o: { zone?: "hand" | "play" | "discard" | "void"; attached?: string; res?: CardPlacement[]; extra?: CardPlacement[]; active?: PlayerId } = {}): Game {
  return mk(
    [
      { key: "bl", def: printing(BLADE), owner: P1, zone: o.zone ?? "hand", ...(o.attached ? { attachedToKey: o.attached } : {}) },
      { key: "a", def: plain("Alpha", { strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "b", def: plain("Bravo", { strength: 3, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: plain("Foe", { strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      ...(o.res ?? []),
      ...(o.extra ?? [])
    ],
    { active: o.active }
  );
}
const equipBlade = (g: Game, host?: string) => play(g.engine, P1, g.id("bl"), { selected: host === undefined ? {} : { attachTo: [g.id(host)] } });
const bladeHost = (g: Game) => g.engine.state.cards[g.id("bl")].attachedTo;
const hasKw = (g: Game, key: string, kw: string): boolean => g.engine.getKeywords(g.id(key)).map(String).includes(kw);

clause(BLADE, "0:attach", "printed card: an arcanist gear item, cost 3, threshold [O][O][O], ATTACH TO CHARACTER", () => {
  const def = printing(BLADE);
  assert.equal(def.type, "item");
  assert.equal(def.trade, "arcanist");
  assert.deepEqual([...def.subtype], ["gear"]);
  assert.equal(def.cost, 3);
  assert.equal(def.threshold, "ooo");
  assert.equal((def as unknown as { attachTo?: string }).attachTo, "character");
});

clause(BLADE, "0:attach", "deploys attached to the picked character for exactly 3 with [O][O][O]", () => {
  const g = bladeBoard({ res: obs(4) });
  equipBlade(g, "a");
  assert.equal(zoneOf(g.engine, g.id("bl")), "play");
  assert.equal(bladeHost(g), g.id("a"), "attached to the picked character");
  assert.equal(readyCount(g.engine, P1), 1, "exactly 3 paid");
});

clause(BLADE, "0:attach", "the cost is 3, not 2: one resource short (threshold met) is refused, and the threshold needs three [O]", () => {
  const short = bladeBoard({ res: obs(2) });
  refused(() => equipBlade(short, "a"), "2 resources");
  assert.equal(zoneOf(short.engine, short.id("bl")), "hand");
  assert.equal(readyCount(short.engine, P1), 2, "nothing paid");
  const twoO = bladeBoard({ res: [...obs(2), ...rage(2)] });
  refused(() => equipBlade(twoO, "a"), "only two [O]");
  assert.equal(zoneOf(twoO.engine, twoO.id("bl")), "hand");
  const spentO = bladeBoard({ res: [...spent(obs(3)), ...rage(2)] });
  refused(() => equipBlade(spentO, "a"), "three spent [O] meet the threshold but only 2 are ready to pay 3");
  const ok = bladeBoard({ res: [...spent(obs(3)), ...rage(3)] });
  equipBlade(ok, "a");
  assert.equal(zoneOf(ok.engine, ok.id("bl")), "play", "control: threshold from spent, cost from three ready");
  assert.equal(readyCount(ok.engine, P1), 0);
});

clause(BLADE, "0:attach", "ATTACH TO CHARACTER: my or an opponent's character is a legal host; an item, a location and a faction are refused; no host is refused", () => {
  const mine = bladeBoard({ res: obs(3) });
  equipBlade(mine, "b");
  assert.equal(bladeHost(mine), mine.id("b"));
  const theirs = bladeBoard({ res: obs(3) });
  equipBlade(theirs, "foe");
  assert.equal(bladeHost(theirs), theirs.id("foe"), "an opponent's character is a legal host");
  for (const bad of ["gear", "place"]) {
    const g = bladeBoard({ res: obs(3) });
    refused(() => equipBlade(g, bad), `host ${bad}`);
    assert.equal(zoneOf(g.engine, g.id("bl")), "hand");
    assert.equal(readyCount(g.engine, P1), 3, "nothing paid");
  }
  const f = bladeBoard({ res: obs(3) });
  refused(() => play(f.engine, P1, f.id("bl"), { selected: { attachTo: [factionOf(f.engine, P1)] } }), "my faction");
  refused(() => equipBlade(f, undefined), "no host picked");
  assert.equal(zoneOf(f.engine, f.id("bl")), "hand");
});

clause(BLADE, "0:attach", "it cannot be deployed with no character in play to attach to", () => {
  const g = mk([{ key: "bl", def: printing(BLADE), owner: P1, zone: "hand" }, ...obs(3)]);
  refused(() => equipBlade(g, undefined), "no characters");
  assert.equal(zoneOf(g.engine, g.id("bl")), "hand");
  assert.equal(readyCount(g.engine, P1), 3);
});

clause(BLADE, "1:rule", "the attached character gains exactly 2 strength (speed and life unchanged) and COVERT; other characters are unchanged", () => {
  const g = bladeBoard({ zone: "play", attached: "a" });
  assert.deepEqual([stat(g, "a", "strength"), stat(g, "a", "speed"), stat(g, "a", "life")], [4, 2, 4]);
  assert.ok(hasKw(g, "a", "covert"), "the host has COVERT");
  assert.deepEqual([stat(g, "b", "strength"), stat(g, "b", "life")], [3, 4], "another of my characters is unchanged");
  assert.ok(!hasKw(g, "b", "covert"), "!hasKw(g, b, covert)");
  assert.deepEqual([stat(g, "foe", "strength"), stat(g, "foe", "life")], [1, 4]);
  assert.ok(!hasKw(g, "foe", "covert"), "!hasKw(g, foe, covert)");
});

clause(BLADE, "1:rule", "before it is deployed the character has its printed stats and no COVERT; deploying raises them", () => {
  const g = bladeBoard({ res: obs(3) });
  assert.equal(stat(g, "a", "strength"), 2);
  assert.ok(!hasKw(g, "a", "covert"), "!hasKw(g, a, covert)");
  equipBlade(g, "a");
  assert.equal(stat(g, "a", "strength"), 4);
  assert.ok(hasKw(g, "a", "covert"), "hasKw(g, a, covert)");
});

clause(BLADE, "1:rule", "on an opponent's character it buffs and covers that host, not the Blade's controller's characters", () => {
  const g = bladeBoard({ zone: "play", attached: "foe" });
  assert.equal(stat(g, "foe", "strength"), 3);
  assert.ok(hasKw(g, "foe", "covert"), "hasKw(g, foe, covert)");
  assert.equal(stat(g, "a", "strength"), 2);
  assert.ok(!hasKw(g, "a", "covert"), "!hasKw(g, a, covert)");
});

clause(BLADE, "1:rule", "two Blades on one host stack the strength (+4)", () => {
  const g = mk([
    { key: "s1", def: printing(BLADE), owner: P1, zone: "play", attachedToKey: "a" },
    { key: "s2", def: printing(BLADE), owner: P1, zone: "play", attachedToKey: "a" },
    { key: "a", def: plain("Alpha", { strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" }
  ]);
  assert.equal(stat(g, "a", "strength"), 6);
});

clause(BLADE, "1:rule", "COVERT works: a covert host attacking cannot be blocked by a non-covert character", () => {
  const g = bladeBoard({ zone: "play", attached: "a", extra: [{ key: "blk", def: plain("Blocker"), owner: P2, zone: "play" }] });
  declareAttackBy(g.engine, P1, [g.id("a")]);
  refused(() => declareBlockers(g.engine, P2, [g.id("blk")]), "non-covert blocker vs a covert attacker");
  declareBlockers(g.engine, P2, []);
});

clause(BLADE, "1:rule", "the buff and COVERT are gone when the Blade leaves play", () => {
  const g = bladeBoard({ zone: "play", attached: "a", extra: [{ key: "smash", def: KILL_ITEM, owner: P1, zone: "hand" }] });
  assert.equal(stat(g, "a", "strength"), 4);
  play(g.engine, P1, g.id("smash"), { selected: { t: [g.id("bl")] } });
  assert.equal(zoneOf(g.engine, g.id("bl")), "discard");
  assert.equal(stat(g, "a", "strength"), 2, "no longer buffed");
  assert.ok(!hasKw(g, "a", "covert"), "!hasKw(g, a, covert)");
});

const noopOf = (key = "t"): CardPlacement => ({ key, def: NOOP("Free " + key), owner: P1, zone: "hand" });
const returnPick = (g: Game, host: string | undefined) => (pc: { kind: string }): unknown =>
  pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: host ? [g.id(host)] : [] } : declineAll(pc as never);

clause(BLADE, "2:rule", "deploying a tactic with the Blade in my discard pile: I may put it into play attached to a character I control", () => {
  const g = bladeBoard({ zone: "discard", extra: [noopOf()] });
  play(g.engine, P1, g.id("t"));
  const pc = pending(g.engine)!;
  assert.ok(pc, "the 'you may' is offered");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("b")] });
  assert.equal(zoneOf(g.engine, g.id("bl")), "play");
  assert.equal(bladeHost(g), g.id("b"));
  assert.equal(g.engine.state.cards[g.id("bl")].controllerId, P1);
  assert.equal(stat(g, "b", "strength"), 5, "its buff applies to the new host");
  assert.ok(hasKw(g, "b", "covert"), "hasKw(g, b, covert)");
  assert.equal(readyCount(g.engine, P1), 0, "putting it into play costs nothing");
});

clause(BLADE, "2:rule", "putting the Blade into play from the discard pile pays no cost and needs no threshold", () => {
  const g = bladeBoard({ zone: "discard", extra: [noopOf(), ...rage(2)] });
  play(g.engine, P1, g.id("t"));
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("a")] });
  assert.equal(zoneOf(g.engine, g.id("bl")), "play");
  assert.equal(readyCount(g.engine, P1), 2, "no resources spent");
});

clause(BLADE, "2:rule", "it is a 'may': declining (picking no host) leaves the Blade in the discard pile", () => {
  const g = bladeBoard({ zone: "discard", extra: [noopOf()] });
  play(g.engine, P1, g.id("t"));
  assert.ok(pending(g.engine), "offered");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("bl")), "discard");
  assert.equal(stat(g, "a", "strength"), 2);
});

clause(BLADE, "2:rule", "the host must be a character I control: an opponent's character, an item and a location are refused (control: my character works)", () => {
  for (const bad of ["foe", "gear", "place"]) {
    const g = bladeBoard({ zone: "discard", extra: [noopOf()] });
    play(g.engine, P1, g.id("t"));
    refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(bad)] }), `host ${bad}`);
    assert.equal(zoneOf(g.engine, g.id("bl")), "discard");
    answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("a")] });
    assert.equal(zoneOf(g.engine, g.id("bl")), "play", "control");
  }
});

clause(BLADE, "2:rule", "with no character I control the Blade stays in the discard pile and nothing hangs", () => {
  const g = mk([{ key: "bl", def: printing(BLADE), owner: P1, zone: "discard" }, { key: "foe", def: plain("Foe"), owner: P2, zone: "play" }, noopOf()]);
  play(g.engine, P1, g.id("t"));
  if (pending(g.engine)) drain(g.engine, declineAll);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("bl")), "discard");
  assert.equal(zoneOf(g.engine, g.id("t")), "discard", "the tactic resolved");
});

clause(BLADE, "2:rule", "only MY tactic deploys count: when the opponent deploys a tactic nothing is offered", () => {
  const g = bladeBoard({ zone: "discard", active: P2, extra: [{ key: "ot", def: NOOP("Their Free"), owner: P2, zone: "hand" }] });
  play(g.engine, P2, g.id("ot"));
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("bl")), "discard");
});

clause(BLADE, "2:rule", "only tactics: deploying a character or an item does not offer the Blade", () => {
  const g = bladeBoard({
    zone: "discard",
    extra: [{ key: "van", def: plain("Van", { cost: 0 }), owner: P1, zone: "hand" }, { key: "ci", def: item({ name: "Cheap Item", cost: 0 }), owner: P1, zone: "hand" }]
  });
  play(g.engine, P1, g.id("van"));
  assert.equal(pending(g.engine), undefined, "a character is not a tactic");
  play(g.engine, P1, g.id("ci"));
  assert.equal(pending(g.engine), undefined, "an item is not a tactic");
  assert.equal(zoneOf(g.engine, g.id("bl")), "discard");
});

clause(BLADE, "2:rule", "only if the Blade is in my discard pile: in my hand, in play, in the void or in the opponent's discard pile it does nothing", () => {
  for (const zone of ["hand", "play", "void"] as const) {
    const g = bladeBoard({ zone, attached: zone === "play" ? "a" : undefined, extra: [noopOf()] });
    play(g.engine, P1, g.id("t"));
    assert.equal(pending(g.engine), undefined, `blade in ${zone}: nothing offered`);
    assert.equal(zoneOf(g.engine, g.id("bl")), zone);
  }
  const theirs = mk([
    { key: "bl", def: printing(BLADE), owner: P2, zone: "discard" },
    { key: "a", def: plain("Alpha"), owner: P1, zone: "play" },
    noopOf()
  ]);
  play(theirs.engine, P1, theirs.id("t"));
  assert.equal(pending(theirs.engine), undefined, "the opponent's Blade in their discard pile");
  assert.equal(zoneOf(theirs.engine, theirs.id("bl")), "discard");
});

clause(BLADE, "2:rule", "a Blade that was destroyed in play comes back: destroyed item, then my next tactic puts it on a new host", () => {
  const g = bladeBoard({
    zone: "play",
    attached: "a",
    extra: [{ key: "smash", def: KILL_ITEM, owner: P1, zone: "hand" }, noopOf()]
  });
  play(g.engine, P1, g.id("smash"), { selected: { t: [g.id("bl")] } });
  assert.equal(zoneOf(g.engine, g.id("bl")), "discard");
  assert.equal(pending(g.engine), undefined);
  play(g.engine, P1, g.id("t"));
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("b")] });
  assert.equal(zoneOf(g.engine, g.id("bl")), "play");
  assert.equal(bladeHost(g), g.id("b"));
  assert.equal(stat(g, "a", "strength"), 2);
  assert.equal(stat(g, "b", "strength"), 5);
});

clause(BLADE, "2:rule", "it triggers on each tactic: declining once does not stop the next tactic from offering it again", () => {
  const g = bladeBoard({ zone: "discard", extra: [noopOf("t1"), noopOf("t2")] });
  play(g.engine, P1, g.id("t1"));
  answerPending(g.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(zoneOf(g.engine, g.id("bl")), "discard");
  play(g.engine, P1, g.id("t2"));
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("a")] });
  assert.equal(zoneOf(g.engine, g.id("bl")), "play");
  assert.equal(bladeHost(g), g.id("a"));
});

// ============================================================================================================
// Rapine -- tactic, rogue, cost 5, threshold [D][D]
// EXTRA COST: Destroy a character or item you control. Pick a character.
// Take control of the picked character.
// ============================================================================================================
const RAPINE = "f89863b2-754f-4bef-b1d1-c3c132266667";

function rapBoard(res: CardPlacement[], extra: CardPlacement[] = [], o: { active?: PlayerId } = {}): Game {
  return mk(
    [
      { key: "rap", def: printing(RAPINE), owner: P1, zone: "hand" },
      { key: "mine", def: plain("Mine"), owner: P1, zone: "play" },
      { key: "mine2", def: plain("Mine Two"), owner: P1, zone: "play" },
      { key: "mygear", def: item({ name: "My Gear" }), owner: P1, zone: "play" },
      { key: "myplace", def: location({ name: "My Place" }), owner: P1, zone: "play" },
      { key: "foe", def: plain("Foe", { strength: 3, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe2", def: plain("Foe Two"), owner: P2, zone: "play" },
      { key: "foegear", def: item({ name: "Their Gear" }), owner: P2, zone: "play" },
      { key: "foeplace", def: location({ name: "Their Place" }), owner: P2, zone: "play" },
      ...res,
      ...extra
    ],
    o
  );
}
const castRap = (g: Game, sac: string | undefined, pick: string | undefined) =>
  play(g.engine, P1, g.id("rap"), { selected: { ...(sac ? { sac: [g.id(sac)] } : {}), ...(pick ? { c: [g.id(pick)] } : {}) } });
const controllerOf = (g: Game, key: string): PlayerId => g.engine.state.cards[g.id(key)].controllerId as PlayerId;
const RAP_RES = (): CardPlacement[] => [...dec(2), ...rage(3)];

clause(RAPINE, "0:extraCost", "printed card: a rogue tactic, cost 5, threshold [D][D]; deploys for exactly 5 and pays 5", () => {
  const def = printing(RAPINE);
  assert.equal(def.type, "tactic");
  assert.equal(def.trade, "rogue");
  assert.equal(def.cost, 5);
  assert.equal(def.threshold, "dd");
  const g = rapBoard([...RAP_RES(), ...rage(1)]);
  assert.equal(readyCount(g.engine, P1), 6);
  castRap(g, "mine", "foe");
  assert.equal(zoneOf(g.engine, g.id("rap")), "discard", "the resolved tactic is discarded");
  assert.equal(readyCount(g.engine, P1), 1, "exactly 5 paid");
});

clause(RAPINE, "0:extraCost", "cost 5 [D][D]: refused one resource short, refused with only one [D], and a refusal destroys nothing and takes nothing", () => {
  const short = rapBoard([...dec(2), ...rage(2)]);
  refused(() => castRap(short, "mine", "foe"), "4 resources for cost 5");
  assert.equal(zoneOf(short.engine, short.id("mine")), "play", "the sacrifice was not destroyed");
  assert.equal(controllerOf(short, "foe"), P2);
  assert.equal(zoneOf(short.engine, short.id("rap")), "hand");
  assert.equal(readyCount(short.engine, P1), 4);
  const oneD = rapBoard([...dec(1), ...rage(4)]);
  refused(() => castRap(oneD, "mine", "foe"), "only one [D]");
  assert.equal(zoneOf(oneD.engine, oneD.id("mine")), "play");
  const spentD = rapBoard([...spent(dec(2)), ...rage(4)]);
  refused(() => castRap(spentD, "mine", "foe"), "two spent [D] meet the threshold but only 4 are ready to pay 5");
  assert.equal(zoneOf(spentD.engine, spentD.id("mine")), "play");
  const ok = rapBoard([...spent(dec(2)), ...rage(5)]);
  castRap(ok, "mine", "foe");
  assert.equal(controllerOf(ok, "foe"), P1, "control: spent [D][D] for the threshold, five ready to pay");
});

clause(RAPINE, "0:extraCost", "the character or item I destroy is a cost: it is destroyed when Rapine is played, before the opponent can respond, and goes to my discard pile", () => {
  const g = rapBoard(RAP_RES());
  playRaw(g.engine, P1, g.id("rap"), { selected: { sac: [g.id("mine")], c: [g.id("foe")] } });
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard", "destroyed while Rapine still waits for responses");
  assert.equal(readyCount(g.engine, P1), 0, "and the 5 were paid");
  assert.equal(controllerOf(g, "foe"), P2, "control has not changed yet");
  resolvePendingResponses(g.engine);
  assert.equal(controllerOf(g, "foe"), P1);
});

clause(RAPINE, "0:extraCost", "the destroyed card may be a character or an ITEM of mine", () => {
  const ch = rapBoard(RAP_RES());
  castRap(ch, "mine2", "foe");
  assert.equal(zoneOf(ch.engine, ch.id("mine2")), "discard");
  assert.equal(controllerOf(ch, "foe"), P1);
  const it = rapBoard(RAP_RES());
  castRap(it, "mygear", "foe");
  assert.equal(zoneOf(it.engine, it.id("mygear")), "discard");
  assert.equal(controllerOf(it, "foe"), P1);
  assert.equal(zoneOf(it.engine, it.id("mine")), "play", "the other cards are untouched");
});

clause(RAPINE, "0:extraCost", "the destroyed card must be one I control: the opponent's character or item, a location, a faction, and a card in hand are all refused", () => {
  const extra: CardPlacement[] = [{ key: "inhand", def: plain("In Hand"), owner: P1, zone: "hand" }];
  for (const bad of ["foe2", "foegear", "myplace", "foeplace", "inhand"]) {
    const g = rapBoard(RAP_RES(), extra);
    refused(() => castRap(g, bad, "foe"), `sacrificing ${bad}`);
    assert.equal(controllerOf(g, "foe"), P2);
    assert.equal(readyCount(g.engine, P1), 5, "nothing paid");
    assert.equal(zoneOf(g.engine, g.id("rap")), "hand");
  }
  const f = rapBoard(RAP_RES());
  refused(() => play(f.engine, P1, f.id("rap"), { selected: { sac: [factionOf(f.engine, P1)], c: [f.id("foe")] } }), "my faction");
  assert.equal(controllerOf(f, "foe"), P2);
  const none = rapBoard(RAP_RES());
  refused(() => castRap(none, undefined, "foe"), "no card to destroy chosen");
  assert.equal(controllerOf(none, "foe"), P2);
});

clause(RAPINE, "0:extraCost", "with no character or item of mine to destroy Rapine cannot be played", () => {
  const g = mk([
    { key: "rap", def: printing(RAPINE), owner: P1, zone: "hand" },
    { key: "foe", def: plain("Foe"), owner: P2, zone: "play" },
    ...RAP_RES()
  ]);
  refused(() => castRap(g, "foe", "foe"), "I control no character or item");
  assert.equal(controllerOf(g, "foe"), P2);
  assert.equal(zoneOf(g.engine, g.id("rap")), "hand");
  assert.equal(readyCount(g.engine, P1), 5);
});

clause(RAPINE, "0:extraCost", "I must pick a character: no pick, an item, a location and a faction are refused; any character works (control: my own)", () => {
  for (const bad of [undefined, "foegear", "foeplace", "mygear", "myplace"]) {
    const g = rapBoard(RAP_RES());
    refused(() => castRap(g, "mine", bad), `picking ${bad}`);
    assert.equal(zoneOf(g.engine, g.id("mine")), "play", "the sacrifice was not destroyed");
    assert.equal(readyCount(g.engine, P1), 5);
  }
  const f = rapBoard(RAP_RES());
  refused(() => play(f.engine, P1, f.id("rap"), { selected: { sac: [f.id("mine")], c: [factionOf(f.engine, P2)] } }), "the opponent's faction");
  assert.equal(zoneOf(f.engine, f.id("mine")), "play");
  const own = rapBoard(RAP_RES());
  castRap(own, "mine", "mine2");
  assert.equal(controllerOf(own, "mine2"), P1, "picking my own character is legal");
  assert.equal(zoneOf(own.engine, own.id("mine")), "discard");
});

clause(RAPINE, "1:rule", "I take control of the picked character: it is now mine, still owned by the opponent; the opponent's other cards stay theirs", () => {
  const g = rapBoard(RAP_RES());
  castRap(g, "mine", "foe");
  assert.equal(controllerOf(g, "foe"), P1);
  assert.equal(g.engine.state.cards[g.id("foe")].ownerId, P2, "ownership does not change");
  assert.ok(g.engine.state.players[P1].play.includes(g.id("foe")), "it is in my play area");
  assert.ok(!g.engine.state.players[P2].play.includes(g.id("foe")), "!g.engine.state.players[P2].play.includes(foe)");
  assert.equal(controllerOf(g, "foe2"), P2);
  assert.equal(controllerOf(g, "foegear"), P2);
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
});

clause(RAPINE, "1:rule", "control is permanent: it lasts past the end of the turn", () => {
  const g = rapBoard(RAP_RES());
  castRap(g, "mine", "foe");
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(controllerOf(g, "foe"), P1, "still mine on their turn");
  endTurn(g.engine, P2);
  assert.equal(controllerOf(g, "foe"), P1, "and on mine again");
});

clause(RAPINE, "1:rule", "a stolen character that dies goes to its OWNER's discard pile", () => {
  const g = rapBoard(RAP_RES(), [{ key: "slay", def: KILL_CHAR, owner: P1, zone: "hand" }]);
  castRap(g, "mine", "foe");
  play(g.engine, P1, g.id("slay"), { selected: { t: [g.id("foe")] } });
  assert.ok(discardOf(g.engine, P2).includes(g.id("foe")), "in its owner's (P2's) discard pile");
  assert.ok(!discardOf(g.engine, P1).includes(g.id("foe")), "!discardOf(g.engine, P1).includes(foe)");
});

// ============================================================================================================
// Rasputin Unleashed -- character, rogue, performer, cost 3, threshold [D][D][D], 3 str / 4 spd / 1 life
// UNIQUE RASPUTIN, TACTICAL
// When another character enters play under your control, pick an opponent. This turn, the speed of all
// characters that opponent controls is reduced to 0.
// ============================================================================================================
const RASP = "2f870c54-2a0f-470c-a73e-2939196e0853";

function raspBoard(o: { zone?: "hand" | "play"; extra?: CardPlacement[]; active?: PlayerId; res?: CardPlacement[] } = {}): Game {
  return mk(
    [
      { key: "ra", def: printing(RASP), owner: P1, zone: o.zone ?? "play" },
      { key: "mine", def: plain("Mine", { speed: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: plain("Foe", { speed: 3 }), owner: P2, zone: "play" },
      { key: "foe2", def: plain("Foe Two", { speed: 2 }), owner: P2, zone: "play" },
      ...(o.res ?? []),
      ...(o.extra ?? [])
    ],
    { active: o.active }
  );
}
const newChar = (key = "n", owner: PlayerId = P1, over: Partial<CardDefinition> = {}): CardPlacement => ({ key, def: plain("New " + key, { cost: 0, speed: 3, ...over }), owner, zone: "hand" });

clause(RASP, "0:unique", "printed card: a rogue performer character, cost 3, threshold [D][D][D], 3 strength / 4 speed / 1 life; deploys for exactly 3", () => {
  const def = printing(RASP);
  assert.equal(def.type, "character");
  assert.equal(def.trade, "rogue");
  assert.deepEqual([...def.subtype], ["performer"]);
  assert.equal(def.cost, 3);
  assert.equal(def.threshold, "ddd");
  assert.deepEqual([def.strength, def.speed, def.life], [3, 4, 1]);
  assert.equal(def.unique, "rasputin");
  const g = raspBoard({ zone: "hand", res: [...dec(3), ...rage(1)] });
  play(g.engine, P1, g.id("ra"));
  assert.equal(zoneOf(g.engine, g.id("ra")), "play");
  assert.equal(readyCount(g.engine, P1), 1, "paid 3 of 4");
  const short = raspBoard({ zone: "hand", res: [...dec(2), ...rage(2)] });
  refused(() => play(short.engine, P1, short.id("ra")), "only two [D]");
  assert.equal(zoneOf(short.engine, short.id("ra")), "hand");
  const few = raspBoard({ zone: "hand", res: dec(2) });
  refused(() => play(few.engine, P1, few.id("ra")), "two resources");
});

clause(RASP, "0:unique", "UNIQUE RASPUTIN: deploying a second Rasputin while one is in play forces me to keep just one", () => {
  const g = raspBoard({ extra: [{ key: "ra2", def: printing(RASP), owner: P1, zone: "hand" }, ...dec(3)] });
  play(g.engine, P1, g.id("ra2"));
  let sawSurvivor = false;
  drain(g.engine, (pc) => {
    if (pc.kind === "uniqueSurvivor") {
      sawSurvivor = true;
      assert.equal(pc.unique, "rasputin");
      assert.deepEqual([...(pc.candidates as string[])].sort(), [g.id("ra"), g.id("ra2")].sort());
      return { kind: "uniqueSurvivor", keep: g.id("ra") };
    }
    return declineAll(pc);
  });
  assert.ok(sawSurvivor, "a survivor choice was raised");
  assert.equal(zoneOf(g.engine, g.id("ra")), "play");
  assert.equal(zoneOf(g.engine, g.id("ra2")), "discard");
});

clause(RASP, "0:unique", "UNIQUE is per player: the opponent may have their own Rasputin and no choice is raised", () => {
  const g = raspBoard({ extra: [{ key: "ra2", def: printing(RASP), owner: P2, zone: "play" }, newChar()] });
  play(g.engine, P1, g.id("n"));
  assert.notEqual(pending(g.engine)?.kind, "uniqueSurvivor");
  assert.equal(zoneOf(g.engine, g.id("ra")), "play");
  assert.equal(zoneOf(g.engine, g.id("ra2")), "play");
});

clause(RASP, "0:kw:TACTICAL", "it has TACTICAL and can be deployed from hand in the opponent's attack window; an ordinary character cannot", () => {
  const g = mk(
    [
      { key: "ra", def: printing(RASP), owner: P1, zone: "hand" },
      { key: "atk", def: plain("Atk"), owner: P2, zone: "play" },
      { key: "plain", def: plain("Plain", { cost: 0 }), owner: P1, zone: "hand" },
      ...dec(3)
    ],
    { active: P2 }
  );
  assert.ok(g.engine.getKeywords(g.id("ra")).map(String).includes("tactical"), "g.engine.getKeywords(ra).map(String).includes(tactical)");
  assert.ok(!g.engine.getKeywords(g.id("plain")).map(String).includes("tactical"), "control: a plain character is not tactical");
  refused(() => play(g.engine, P1, g.id("ra")), "no window is open on the opponent's turn");
  assert.equal(zoneOf(g.engine, g.id("ra")), "hand");
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  refused(() => play(g.engine, P1, g.id("plain")), "an ordinary character in that window");
  play(g.engine, P1, g.id("ra"));
  assert.equal(zoneOf(g.engine, g.id("ra")), "play", "Rasputin deployed on the opponent's turn");
  assert.equal(readyCount(g.engine, P1), 0, "for its printed cost 3");
});

clause(RASP, "0:kw:TACTICAL", "TACTICAL changes only the timing: the [D][D][D] threshold and cost 3 are still required in the window", () => {
  const g = mk(
    [
      { key: "ra", def: printing(RASP), owner: P1, zone: "hand" },
      { key: "atk", def: plain("Atk"), owner: P2, zone: "play" },
      ...dec(2),
      ...rage(2)
    ],
    { active: P2 }
  );
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  refused(() => play(g.engine, P1, g.id("ra")), "two [D] only");
  assert.equal(zoneOf(g.engine, g.id("ra")), "hand");
});

const slowedBoard = (): Game => raspBoard({ extra: [newChar()] });

clause(RASP, "1:rule", "when another character of mine enters play, ALL the opponent's characters have speed 0 (printed 3 and 2); mine keep their speed", () => {
  const g = slowedBoard();
  assert.deepEqual([stat(g, "foe", "speed"), stat(g, "foe2", "speed")], [3, 2], "before");
  play(g.engine, P1, g.id("n"));
  if (pending(g.engine)) drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("n")), "play");
  assert.equal(stat(g, "foe", "speed"), 0);
  assert.equal(stat(g, "foe2", "speed"), 0);
  assert.equal(stat(g, "mine", "speed"), 3, "my character is unchanged");
  assert.equal(stat(g, "ra", "speed"), 4, "Rasputin is unchanged");
  assert.equal(stat(g, "n", "speed"), 3, "the entering character is unchanged");
});

clause(RASP, "1:rule", "Rasputin's own entry does not trigger it", () => {
  const g = raspBoard({ zone: "hand", res: dec(3) });
  play(g.engine, P1, g.id("ra"));
  if (pending(g.engine)) drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("ra")), "play");
  assert.equal(stat(g, "foe", "speed"), 3);
  assert.equal(stat(g, "foe2", "speed"), 2);
});

clause(RASP, "1:rule", "a character entering under the OPPONENT's control does not trigger it", () => {
  const g = raspBoard({ active: P2, extra: [newChar("on", P2)] });
  play(g.engine, P2, g.id("on"));
  if (pending(g.engine)) drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("on")), "play");
  assert.equal(stat(g, "on", "speed"), 3);
  assert.equal(stat(g, "foe", "speed"), 3);
  assert.equal(stat(g, "mine", "speed"), 3);
});

clause(RASP, "1:rule", "only characters count: an item or a tactic entering does not slow anything", () => {
  const g = raspBoard({
    extra: [{ key: "it", def: item({ name: "New Item", cost: 0 }), owner: P1, zone: "hand" }, { key: "tac", def: NOOP("Free Spell"), owner: P1, zone: "hand" }]
  });
  play(g.engine, P1, g.id("it"));
  play(g.engine, P1, g.id("tac"));
  assert.equal(stat(g, "foe", "speed"), 3);
  assert.equal(stat(g, "foe2", "speed"), 2);
});

clause(RASP, "1:rule", "the effect lasts this turn only: the opponent's characters have their speed back on their own turn", () => {
  const g = slowedBoard();
  play(g.engine, P1, g.id("n"));
  assert.equal(stat(g, "foe", "speed"), 0);
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(stat(g, "foe", "speed"), 3, "restored");
  assert.equal(stat(g, "foe2", "speed"), 2, "restored");
});

clause(RASP, "1:rule", "'pick an opponent' is relative to Rasputin's controller: with the opponent's Rasputin, MY characters are slowed when they deploy another", () => {
  const g = mk(
    [
      { key: "ra", def: printing(RASP), owner: P2, zone: "play" },
      { key: "mine", def: plain("Mine", { speed: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: plain("Foe", { speed: 3 }), owner: P2, zone: "play" },
      newChar("n", P2)
    ],
    { active: P2 }
  );
  play(g.engine, P2, g.id("n"));
  assert.equal(stat(g, "mine", "speed"), 0, "my character is slowed");
  assert.equal(stat(g, "foe", "speed"), 3, "their own are not");
});

clause(RASP, "1:rule", "'this turn, the speed of all characters that opponent controls is reduced to 0' also covers a character the opponent puts into play later this turn", () => {
  const tac = character({ name: "Fast Tactical", strength: 1, life: 3, speed: 3, cost: 0, behavior: { keywords: ["tactical"], abilities: [] } });
  const g = raspBoard({ extra: [newChar(), { key: "late", def: tac, owner: P2, zone: "hand" }] });
  play(g.engine, P1, g.id("n"));
  assert.equal(stat(g, "foe", "speed"), 0);
  declareAttackOpenWindow(g.engine, P1, [g.id("mine")]);
  play(g.engine, P2, g.id("late"));
  assert.equal(zoneOf(g.engine, g.id("late")), "play", "setup: the opponent deployed it this turn");
  assert.equal(stat(g, "late", "speed"), 0, "a character the opponent controls this turn has speed 0");
});

// ============================================================================================================
// Redonkulous -- tactic, arcanist, cost 3, threshold [O][O]
// EXTRA COST: Pick a character.
// If you deployed this card using FLIP UP, that character's controller discards 2 cards. If that character's
// controller has 3 or fewer cards in their hand, void that character.
// FLIP UP: 5 [O][O]
// ============================================================================================================
const REDONK = "95277828-2708-4a76-b7ae-2615d898a7e1";

function redBoard(o: { oppHand?: number; myHand?: number; faceDown?: boolean; res?: CardPlacement[]; extra?: CardPlacement[] } = {}): Game {
  return mk([
    { key: "rd", def: printing(REDONK), owner: P1, zone: o.faceDown ? "play" : "hand", faceDown: o.faceDown },
    { key: "mine", def: plain("Mine"), owner: P1, zone: "play" },
    { key: "foe", def: plain("Foe"), owner: P2, zone: "play" },
    { key: "mygear", def: item({ name: "My Gear" }), owner: P1, zone: "play" },
    { key: "foeplace", def: location({ name: "Their Place" }), owner: P2, zone: "play" },
    ...fillers("oh", o.oppHand ?? 5, P2, "hand"),
    ...fillers("mh", o.myHand ?? 5, P1, "hand"),
    ...(o.res ?? [...obs(2), ...rage(1)]),
    ...(o.extra ?? [])
  ]);
}
const castRed = (g: Game, pick?: string) => play(g.engine, P1, g.id("rd"), { selected: pick ? { char: [g.id(pick)] } : {} });
const flipRed = (g: Game, pick?: string) => flipUp(g.engine, P1, g.id("rd"), pick ? { char: [g.id(pick)] } : {});
const FLIP_RES = (): CardPlacement[] => [...obs(2), ...rage(2)];
const discardTwo = (g: Game, prefix: string) => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(`${prefix}0`), g.id(`${prefix}1`)] });

clause(REDONK, "0:extraCost", "printed card: an arcanist tactic, cost 3, threshold [O][O]; deploys for exactly 3 with a character picked", () => {
  const def = printing(REDONK);
  assert.equal(def.type, "tactic");
  assert.equal(def.trade, "arcanist");
  assert.equal(def.cost, 3);
  assert.equal(def.threshold, "oo");
  const g = redBoard({ res: [...obs(2), ...rage(2)] });
  assert.equal(readyCount(g.engine, P1), 4);
  castRed(g, "foe");
  assert.equal(zoneOf(g.engine, g.id("rd")), "discard");
  assert.equal(readyCount(g.engine, P1), 1, "exactly 3 paid");
});

clause(REDONK, "0:extraCost", "cost 3 [O][O]: refused one resource short, refused with one [O], and a spent [O][O] meets the threshold but cannot pay", () => {
  const short = redBoard({ res: obs(2) });
  refused(() => castRed(short, "foe"), "2 resources for cost 3");
  assert.equal(zoneOf(short.engine, short.id("rd")), "hand");
  assert.equal(readyCount(short.engine, P1), 2);
  const oneO = redBoard({ res: [...obs(1), ...rage(3)] });
  refused(() => castRed(oneO, "foe"), "one [O]");
  assert.equal(zoneOf(oneO.engine, oneO.id("rd")), "hand");
  const spentO = redBoard({ res: [...spent(obs(2)), ...rage(2)] });
  refused(() => castRed(spentO, "foe"), "spent [O][O] but only 2 ready to pay 3");
  const ok = redBoard({ res: [...spent(obs(2)), ...rage(3)] });
  castRed(ok, "foe");
  assert.equal(zoneOf(ok.engine, ok.id("rd")), "discard", "control");
});

clause(REDONK, "0:extraCost", "I must pick a character: mine or the opponent's work; no pick, an item, a location and a faction are refused", () => {
  for (const bad of [undefined, "mygear", "foeplace"]) {
    const g = redBoard();
    refused(() => castRed(g, bad), `pick ${bad}`);
    assert.equal(zoneOf(g.engine, g.id("rd")), "hand");
    assert.equal(readyCount(g.engine, P1), 3, "nothing paid");
  }
  const f = redBoard();
  refused(() => play(f.engine, P1, f.id("rd"), { selected: { char: [factionOf(f.engine, P2)] } }), "a faction");
  for (const ok of ["mine", "foe"]) {
    const g = redBoard({ oppHand: 6, myHand: 6 });
    castRed(g, ok);
    assert.equal(zoneOf(g.engine, g.id("rd")), "discard", `picking ${ok}`);
  }
});

clause(REDONK, "1:rule", "deployed from hand (not FLIP UP) nobody discards: the opponent's hand of 6 is untouched and the character survives", () => {
  const g = redBoard({ oppHand: 6 });
  castRed(g, "foe");
  assert.equal(pending(g.engine), undefined, "no discard prompt");
  assert.equal(handOf(g.engine, P2).length, 6);
  assert.equal(zoneOf(g.engine, g.id("foe")), "play", "6 cards in hand: not voided");
});

clause(REDONK, "1:rule", "deployed from hand: the character is voided if its controller has 3 or fewer cards in hand (3, 0) and survives with 4", () => {
  for (const [hand, voided] of [[3, true], [0, true], [4, false]] as const) {
    const g = redBoard({ oppHand: hand });
    castRed(g, "foe");
    assert.equal(zoneOf(g.engine, g.id("foe")), voided ? "void" : "play", `opponent hand ${hand}`);
    assert.equal(handOf(g.engine, P2).length, hand, "no discard from a normal deploy");
  }
});

clause(REDONK, "1:rule", "the hand check is about the picked character's controller: my own character with my hand at 3 is voided, at 4 survives; the opponent's hand size doesn't matter", () => {
  const small = redBoard({ myHand: 3, oppHand: 6 });
  castRed(small, "mine");
  assert.equal(zoneOf(small.engine, small.id("mine")), "void");
  const big = redBoard({ myHand: 4, oppHand: 0 });
  castRed(big, "mine");
  assert.equal(zoneOf(big.engine, big.id("mine")), "play");
  const theirs = redBoard({ myHand: 0, oppHand: 6 });
  castRed(theirs, "foe");
  assert.equal(zoneOf(theirs.engine, theirs.id("foe")), "play", "my empty hand does not void THEIR character");
});

clause(REDONK, "1:rule", "'void' is the void zone: the voided character is in neither discard pile", () => {
  const g = redBoard({ oppHand: 2 });
  castRed(g, "foe");
  assert.equal(zoneOf(g.engine, g.id("foe")), "void");
  assert.ok(!discardOf(g.engine, P2).includes(g.id("foe")), "!discardOf(g.engine, P2).includes(foe)");
  assert.ok(!discardOf(g.engine, P1).includes(g.id("foe")), "!discardOf(g.engine, P1).includes(foe)");
});

clause(REDONK, "1:rule", "via FLIP UP the character's controller (the opponent) chooses and discards 2 cards; with 6 in hand 4 remain and the character survives", () => {
  const g = redBoard({ faceDown: true, res: FLIP_RES(), oppHand: 6 });
  flipRed(g, "foe");
  const pc = pending(g.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the controller of the picked character discards");
  discardTwo(g, "oh");
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("oh0")), "discard");
  assert.equal(zoneOf(g.engine, g.id("oh1")), "discard");
  assert.equal(handOf(g.engine, P2).length, 4);
  assert.equal(zoneOf(g.engine, g.id("foe")), "play", "4 cards left in hand: not voided");
  assert.equal(handOf(g.engine, P1).length, 5, "I discard nothing");
});

clause(REDONK, "1:rule", "via FLIP UP the hand is checked AFTER the discards: 5 cards -> 3 left -> voided; 4 -> 2 -> voided; 6 -> 4 -> survives", () => {
  for (const [hand, voided] of [[5, true], [4, true], [6, false]] as const) {
    const g = redBoard({ faceDown: true, res: FLIP_RES(), oppHand: hand });
    flipRed(g, "foe");
    discardTwo(g, "oh");
    assert.equal(handOf(g.engine, P2).length, hand - 2);
    assert.equal(zoneOf(g.engine, g.id("foe")), voided ? "void" : "play", `hand ${hand}`);
  }
});

clause(REDONK, "1:rule", "via FLIP UP exactly 2 are discarded: picking one or three cards is refused", () => {
  const g = redBoard({ faceDown: true, res: FLIP_RES(), oppHand: 6 });
  flipRed(g, "foe");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oh0")] }), "only one card");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oh0"), g.id("oh1"), g.id("oh2")] }), "three cards");
  assert.equal(handOf(g.engine, P2).length, 6, "nothing was discarded by the refused answers");
  discardTwo(g, "oh");
  assert.equal(handOf(g.engine, P2).length, 4);
});

clause(REDONK, "1:rule", "via FLIP UP on my own character: I discard 2 (my hand 5 -> 3) and my character is voided", () => {
  const g = redBoard({ faceDown: true, res: FLIP_RES(), myHand: 5, oppHand: 6 });
  flipRed(g, "mine");
  const pc = pending(g.engine)!;
  assert.equal(pc.playerId, P1);
  discardTwo(g, "mh");
  assert.equal(handOf(g.engine, P1).length, 3);
  assert.equal(zoneOf(g.engine, g.id("mine")), "void");
  assert.equal(handOf(g.engine, P2).length, 6, "the opponent discards nothing");
});

clause(REDONK, "1:rule", "via FLIP UP with a controller who holds fewer than 2 cards: they discard what they have and the character is voided", () => {
  const one = redBoard({ faceDown: true, res: FLIP_RES(), oppHand: 1 });
  flipRed(one, "foe");
  if (pending(one.engine)) answerPending(one.engine, "chooserSelectsTarget", { selected: [one.id("oh0")] });
  assert.equal(pending(one.engine), undefined);
  assert.equal(handOf(one.engine, P2).length, 0);
  assert.equal(zoneOf(one.engine, one.id("foe")), "void");
  const none = redBoard({ faceDown: true, res: FLIP_RES(), oppHand: 0 });
  flipRed(none, "foe");
  assert.equal(pending(none.engine), undefined);
  assert.equal(zoneOf(none.engine, none.id("foe")), "void");
});

clause(REDONK, "2:flipUp", "FLIP UP 5 [O][O]: a face-down Redonkulous flips up for exactly 5 with [O][O] and resolves, going to the discard pile", () => {
  const g = redBoard({ faceDown: true, res: FLIP_RES(), oppHand: 6 });
  assert.equal(readyCount(g.engine, P1), 5, "the face-down card itself counts as a resource");
  flipRed(g, "foe");
  if (pending(g.engine)) discardTwo(g, "oh");
  assert.equal(zoneOf(g.engine, g.id("rd")), "discard", "the tactic resolved");
  assert.equal(readyCount(g.engine, P1), 0, "exactly 5 paid");
});

clause(REDONK, "2:flipUp", "FLIP UP is refused one resource short (4) and when the others hold only one [O] (the card's own icon does not count)", () => {
  const short = redBoard({ faceDown: true, res: [...obs(2), ...rage(1)] });
  refused(() => flipRed(short, "foe"), "4 resources for cost 5");
  assert.equal(short.engine.state.cards[short.id("rd")].faceDown, true);
  assert.equal(readyCount(short.engine, P1), 4);
  const oneO = redBoard({ faceDown: true, res: [...obs(1), ...rage(3)] });
  refused(() => flipRed(oneO, "foe"), "only one [O]");
  assert.equal(oneO.engine.state.cards[oneO.id("rd")].faceDown, true);
  const noO = redBoard({ faceDown: true, res: rage(5) });
  refused(() => flipRed(noO, "foe"), "no [O]");
  assert.equal(noO.engine.state.cards[noO.id("rd")].faceDown, true);
  const spentO = redBoard({ faceDown: true, res: [...spent(obs(2)), ...rage(3)] });
  refused(() => flipRed(spentO, "foe"), "spent [O][O] meet the threshold but only 4 are ready (3 + itself) for cost 5");
  const ok = redBoard({ faceDown: true, res: [...spent(obs(2)), ...rage(4)] });
  flipRed(ok, "foe");
  if (pending(ok.engine)) discardTwo(ok, "oh");
  assert.equal(zoneOf(ok.engine, ok.id("rd")), "discard", "control: spent [O][O], 4 ready + itself pay 5");
});

clause(REDONK, "2:flipUp", "FLIP UP still needs its pick: a character is required (no pick, an item or a location is refused) and nothing is paid on a refusal", () => {
  for (const bad of [undefined, "mygear", "foeplace"]) {
    const g = redBoard({ faceDown: true, res: FLIP_RES() });
    refused(() => flipRed(g, bad), `flip pick ${bad}`);
    assert.equal(g.engine.state.cards[g.id("rd")].faceDown, true);
    assert.equal(readyCount(g.engine, P1), 5, "nothing paid");
  }
});

// ============================================================================================================
// Research Assistant -- character, gearsmith, 31f, cost 2, threshold [E][E], 1 str / 2 spd / 1 life
// RESEARCH -- COST: Deplete this card. EFFECT: Reduce the next numeric cost you pay this turn by 1.
// Senior Research Assistant -- character, gearsmith, 31f, cost 4, threshold [E][E], 2 str / 3 spd / 2 life
// RESEARCH -- COST: Deplete this card. EFFECT: Reduce the next numeric cost you pay this turn by 2.
// ============================================================================================================
const RESEARCH = "2293a8a9-0b10-43ef-a03b-82a54c3b1d36";
const SENIOR = "4fa5f004-956f-4526-88be-02d707b417f9";

/** A cheap item whose activated ability costs "Pay 2". */
const PAYER = item({
  name: "Toll Booth",
  cost: 0,
  behavior: { abilities: [{ id: "pay2", type: "activated", costs: [{ type: "payResources", amount: 2 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
});
const costed = (name: string, cost: number, threshold = 0): CardPlacement => ({ key: name, def: plain(name, { cost, threshold: threshold as never }), owner: P1, zone: "hand" });

function researchBoard(id: string, res: CardPlacement[], extra: CardPlacement[] = [], o: { zone?: "play" | "hand" } = {}): Game {
  return mk([
    { key: "ra", def: printing(id), owner: P1, zone: o.zone ?? "play" },
    costed("c1", 1),
    costed("c2", 2),
    costed("c3", 3),
    costed("c4", 4),
    ...res,
    ...extra
  ]);
}
const research = (g: Game) => activate(g.engine, P1, g.id("ra"), "research");
const isDepleted = (g: Game, key: string): boolean => g.engine.state.cards[g.id(key)].depleted === true;

function researchBody(id: string, cost: number, threshold: string, str: number, spd: number, life: number, by: number) {
  const hand = (res: CardPlacement[]) => researchBoard(id, res, [], { zone: "hand" });
  return {
    printed: () => {
      const def = printing(id);
      assert.equal(def.type, "character");
      assert.equal(def.trade, "gearsmith");
      assert.deepEqual([...def.subtype], ["31f"]);
      assert.equal(def.cost, cost);
      assert.equal(def.threshold, threshold);
      assert.deepEqual([def.strength, def.speed, def.life], [str, spd, life]);
      const g = hand(elit(cost + 1));
      play(g.engine, P1, g.id("ra"));
      assert.equal(zoneOf(g.engine, g.id("ra")), "play");
      assert.equal(readyCount(g.engine, P1), 1, `exactly ${cost} paid`);
      assert.deepEqual([stat(g, "ra", "strength"), stat(g, "ra", "speed"), stat(g, "ra", "life")], [str, spd, life]);
      const short = hand(elit(cost - 1));
      refused(() => play(short.engine, P1, short.id("ra")), "one resource short");
      assert.equal(zoneOf(short.engine, short.id("ra")), "hand");
      const noE = hand([...elit(1), ...rage(cost)]);
      refused(() => play(noE.engine, P1, noE.id("ra")), "only one [E]");
      assert.equal(zoneOf(noE.engine, noE.id("ra")), "hand");
    },
    depletes: () => {
      const g = researchBoard(id, rage(3));
      assert.equal(isDepleted(g, "ra"), false);
      research(g);
      assert.equal(isDepleted(g, "ra"), true, "the cost: deplete this card");
      assert.equal(readyCount(g.engine, P1), 3, "RESEARCH costs no resources");
      refused(() => research(g), "already depleted");
      assert.equal(isDepleted(g, "ra"), true);
    },
    reducesNext: () => {
      const g = researchBoard(id, rage(4));
      research(g);
      play(g.engine, P1, g.id("c3"));
      assert.equal(zoneOf(g.engine, g.id("c3")), "play");
      assert.equal(readyCount(g.engine, P1), 4 - (3 - by), `a cost-3 card costs ${3 - by}`);
      const none = researchBoard(id, rage(4));
      play(none.engine, P1, none.id("c3"));
      assert.equal(readyCount(none.engine, P1), 1, "control: with no RESEARCH it costs the full 3");
    },
    onlyNext: () => {
      const g = researchBoard(id, rage(8));
      research(g);
      play(g.engine, P1, g.id("c4"));
      const afterFirst = readyCount(g.engine, P1);
      assert.equal(afterFirst, 8 - Math.max(0, 4 - by), `first deploy: ${Math.max(0, 4 - by)}`);
      play(g.engine, P1, g.id("c2"));
      assert.equal(readyCount(g.engine, P1), afterFirst - 2, "the second deploy pays its full cost 2");
    },
    notBelowZero: () => {
      const g = researchBoard(id, rage(3));
      research(g);
      play(g.engine, P1, g.id("c1"));
      assert.equal(zoneOf(g.engine, g.id("c1")), "play");
      assert.equal(readyCount(g.engine, P1), 3 - Math.max(0, 1 - by), "a cost-1 card cannot cost less than 0");
      if (by === 1) {
        const bigger = researchBoard(id, rage(3));
        research(bigger);
        play(bigger.engine, P1, bigger.id("c2"));
        assert.equal(readyCount(bigger.engine, P1), 2, "a cost-2 card costs 1");
      }
    },
    thresholdKept: () => {
      const gated: CardPlacement = costed("gated", 2, "e" as never);
      const g = researchBoard(id, rage(3), [gated]);
      research(g);
      refused(() => play(g.engine, P1, g.id("gated")), "the reduction does not remove the [E] threshold");
      assert.equal(zoneOf(g.engine, g.id("gated")), "hand");
      const ok = researchBoard(id, [...elit(1), ...rage(2)], [gated]);
      research(ok);
      play(ok.engine, P1, ok.id("gated"));
      assert.equal(zoneOf(ok.engine, ok.id("gated")), "play", "control: with an [E] it deploys");
      assert.equal(readyCount(ok.engine, P1), 3 - Math.max(0, 2 - by));
    },
    thisTurn: () => {
      const g = researchBoard(id, rage(6));
      research(g);
      endTurn(g.engine, P1);
      endTurn(g.engine, P2);
      assert.equal(g.engine.state.activePlayerId, P1);
      const ready = readyCount(g.engine, P1);
      play(g.engine, P1, g.id("c3"));
      assert.equal(readyCount(g.engine, P1), ready - 3, "the reduction ended with the turn: full cost");
    },
    abilityCost: () => {
      const g = researchBoard(id, rage(4), [{ key: "toll", def: PAYER, owner: P1, zone: "play" }]);
      research(g);
      activate(g.engine, P1, g.id("toll"), "pay2");
      assert.equal(readyCount(g.engine, P1), 4 - Math.max(0, 2 - by), `a 'Pay 2' ability cost is a numeric cost: it costs ${Math.max(0, 2 - by)}`);
      play(g.engine, P1, g.id("c2"));
      assert.equal(readyCount(g.engine, P1), 4 - Math.max(0, 2 - by) - 2, "the reduction was used up by the ability cost, so the next card pays in full");
    },
    notTheirs: () => {
      const g = mk([
        { key: "ra", def: printing(id), owner: P1, zone: "play" },
        { key: "mine", def: plain("Mine"), owner: P1, zone: "play" },
        costed("c3", 3),
        { key: "atk", def: plain("Atk"), owner: P1, zone: "play" },
        { key: "foespell", def: tactic({ name: "Their Spell", cost: 2, behavior: { abilities: [{ id: "x", type: "activated", effects: [] }] } }), owner: P2, zone: "hand" },
        ...rage(4),
        ...rage(3, P2)
      ]);
      research(g);
      declareAttackOpenWindow(g.engine, P1, [g.id("atk")]);
      play(g.engine, P2, g.id("foespell"));
      assert.equal(readyCount(g.engine, P2), 1, "the opponent pays its full cost 2: my reduction is not theirs");
      assert.equal(zoneOf(g.engine, g.id("foespell")), "discard");
      declareBlockers(g.engine, P2, []);
      finishBattle(g.engine);
      play(g.engine, P1, g.id("c3"));
      assert.equal(readyCount(g.engine, P1), 4 - Math.max(0, 3 - by), "my reduction was still waiting for MY next cost");
    }
  };
}
const R1 = researchBody(RESEARCH, 2, "ee", 1, 2, 1, 1);
const R2 = researchBody(SENIOR, 4, "ee", 2, 3, 2, 2);

clause(RESEARCH, "0:ability:research", "printed card: a gearsmith 31f character, cost 2, threshold [E][E], 1 strength / 2 speed / 1 life", R1.printed);
clause(RESEARCH, "0:ability:research", "COST: deplete this card (and nothing else): it is depleted, no resource is paid, and a depleted one cannot use RESEARCH again", R1.depletes);
clause(RESEARCH, "0:ability:research", "EFFECT: the next numeric cost I pay this turn is 1 less (a cost-3 card costs 2)", R1.reducesNext);
clause(RESEARCH, "0:ability:research", "only the NEXT cost: the second card deployed pays in full", R1.onlyNext);
clause(RESEARCH, "0:ability:research", "the reduction by 1 applies to a cost-2 card (pays 1) and cannot take a cost-1 card below 0", R1.notBelowZero);
clause(RESEARCH, "0:ability:research", "the reduction touches the numeric cost only, never a threshold", R1.thresholdKept);
clause(RESEARCH, "0:ability:research", "'this turn': the reduction ends with the turn", R1.thisTurn);
clause(RESEARCH, "0:ability:research", "a numeric 'Pay 2' ability cost is a numeric cost too, and the reduction is used up by it", R1.abilityCost);
clause(RESEARCH, "0:ability:research", "the reduction is mine: the opponent paying a numeric cost in response pays in full and doesn't use it up", R1.notTheirs);

clause(SENIOR, "0:ability:research", "printed card: a gearsmith 31f character, cost 4, threshold [E][E], 2 strength / 3 speed / 2 life", R2.printed);
clause(SENIOR, "0:ability:research", "COST: deplete this card (and nothing else): it is depleted, no resource is paid, and a depleted one cannot use RESEARCH again", R2.depletes);
clause(SENIOR, "0:ability:research", "EFFECT: the next numeric cost I pay this turn is 2 less (a cost-3 card costs 1)", R2.reducesNext);
clause(SENIOR, "0:ability:research", "only the NEXT cost: a cost-4 card then pays 2 and the second card deployed pays in full", R2.onlyNext);
clause(SENIOR, "0:ability:research", "a cost-1 card costs 0 and nothing goes below 0; a reduction of 2 on a cost-2 card makes it free", R2.notBelowZero);
clause(SENIOR, "0:ability:research", "the reduction touches the numeric cost only, never a threshold", R2.thresholdKept);
clause(SENIOR, "0:ability:research", "'this turn': the reduction ends with the turn", R2.thisTurn);
clause(SENIOR, "0:ability:research", "a numeric 'Pay 2' ability cost is a numeric cost too: it becomes free, and the reduction is used up by it", R2.abilityCost);
clause(SENIOR, "0:ability:research", "the reduction is mine: the opponent paying a numeric cost in response pays in full and doesn't use it up", R2.notTheirs);

// ============================================================================================================
// Ritual of the Double Monkey -- tactic, arcanist, cost 1, threshold [O]
// An opponent discards a card. If you control [O][O][O], that opponent discards another card.
// If you control [O][O][O][O][O][O][O][O], that opponent discards another card.
// FLIP UP: 2 [O]
// ============================================================================================================
const MONKEY = "a013b3ee-9b2b-4ea2-b30d-90c48cacf17a";

function monkeyBoard(res: CardPlacement[], o: { oppHand?: number; faceDown?: boolean; extra?: CardPlacement[] } = {}): Game {
  return mk([
    { key: "dm", def: printing(MONKEY), owner: P1, zone: o.faceDown ? "play" : "hand", faceDown: o.faceDown },
    ...fillers("oh", o.oppHand ?? 5, P2, "hand"),
    ...fillers("mh", 2, P1, "hand"),
    ...res,
    ...(o.extra ?? [])
  ]);
}
/** Casts the Monkey; each opponent discard prompt is answered with the next card. Returns how many cards they discarded. */
function monkeyRun(g: Game, how: "cast" | "flip" = "cast"): number {
  const before = handOf(g.engine, P2).length;
  if (how === "cast") play(g.engine, P1, g.id("dm"));
  else flipUp(g.engine, P1, g.id("dm"));
  let n = 0;
  while (pending(g.engine) && n < 6) {
    const pc = pending(g.engine)!;
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P2, "the opponent chooses what to discard");
    answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(`oh${n}`)] });
    n++;
  }
  assert.equal(pending(g.engine), undefined);
  assert.equal(before - handOf(g.engine, P2).length, n, "the prompts match the cards that left their hand");
  return n;
}
const icons = (n: number): CardPlacement[] => obs(n);

clause(MONKEY, "0:rule", "printed card: an arcanist tactic, cost 1, threshold [O]; deploys for exactly 1 and is refused with no [O]", () => {
  const def = printing(MONKEY);
  assert.equal(def.type, "tactic");
  assert.equal(def.trade, "arcanist");
  assert.equal(def.cost, 1);
  assert.equal(def.threshold, "o");
  const g = monkeyBoard([...obs(1), ...rage(2)]);
  assert.equal(readyCount(g.engine, P1), 3);
  monkeyRun(g);
  assert.equal(readyCount(g.engine, P1), 2, "exactly 1 paid");
  assert.equal(zoneOf(g.engine, g.id("dm")), "discard");
  const noO = monkeyBoard(rage(3));
  refused(() => play(noO.engine, P1, noO.id("dm")), "no [O]");
  assert.equal(zoneOf(noO.engine, noO.id("dm")), "hand");
  const bare = monkeyBoard([]);
  refused(() => play(bare.engine, P1, bare.id("dm")), "no resources");
  const spentOnly = monkeyBoard(spent(obs(2)));
  refused(() => play(spentOnly.engine, P1, spentOnly.id("dm")), "a spent [O] meets the threshold but nothing is ready to pay 1");
  assert.equal(zoneOf(spentOnly.engine, spentOnly.id("dm")), "hand");
});

clause(MONKEY, "0:rule", "with fewer than three [O] the opponent discards exactly 1 card, their choice; the others stay, and I discard nothing", () => {
  for (const n of [1, 2]) {
    const g = monkeyBoard(icons(n));
    const discarded = monkeyRun(g);
    assert.equal(discarded, 1, `${n} [O]`);
    assert.equal(handOf(g.engine, P2).length, 4);
    assert.equal(zoneOf(g.engine, g.id("oh0")), "discard", "their choice went to their discard pile");
    assert.equal(handOf(g.engine, P1).length, 2, "my hand is untouched");
  }
});

clause(MONKEY, "0:rule", "with three [O] the opponent discards 2 cards (the first plus another), with up to seven [O] still 2", () => {
  for (const n of [3, 4, 7]) {
    const g = monkeyBoard(icons(n));
    assert.equal(monkeyRun(g), 2, `${n} [O]`);
    assert.equal(handOf(g.engine, P2).length, 3);
  }
});

clause(MONKEY, "0:rule", "with eight [O] the opponent discards 3 cards, and more [O] don't add a fourth", () => {
  for (const n of [8, 9, 11]) {
    const g = monkeyBoard(icons(n), { oppHand: 6 });
    assert.equal(monkeyRun(g), 3, `${n} [O]`);
    assert.equal(handOf(g.engine, P2).length, 3);
  }
});

clause(MONKEY, "0:rule", "'control' counts spent [O] too: three spent [O] with a ready Rage paying the cost makes it 2 discards", () => {
  const g = monkeyBoard([...spent(obs(3)), ...rage(1)]);
  assert.equal(monkeyRun(g), 2);
  const eight = monkeyBoard([...spent(obs(8)), ...rage(1)], { oppHand: 6 });
  assert.equal(monkeyRun(eight), 3);
});

clause(MONKEY, "0:rule", "the [O] that pays the cost still counts: exactly three [O], one spent paying the cost, is 2 discards", () => {
  const g = monkeyBoard(obs(3));
  assert.equal(monkeyRun(g), 2);
  assert.equal(readyCount(g.engine, P1), 2);
});

clause(MONKEY, "0:rule", "only [O] icons count: three other icons, or face-down (Volition) cards, don't reach the three-[O] threshold; the opponent's own [O] don't count for me", () => {
  const other = monkeyBoard([...obs(1), ...rage(3), ...greed(3), ...dec(3)]);
  assert.equal(monkeyRun(other), 1);
  const vol = monkeyBoard([...obs(1), ...volition(4, P1)]);
  assert.equal(monkeyRun(vol), 1, "face-down cards provide Volition, not [O]");
  const theirs = monkeyBoard([...obs(1), ...obs(6, P2)]);
  assert.equal(monkeyRun(theirs), 1, "the opponent controls the [O], not me");
});

clause(MONKEY, "0:rule", "an opponent with fewer cards than asked discards what they have and nothing hangs (1 card, 8 [O]: 1 discard)", () => {
  const g = monkeyBoard(icons(8), { oppHand: 1 });
  assert.equal(monkeyRun(g), 1);
  assert.equal(handOf(g.engine, P2).length, 0);
  const two = monkeyBoard(icons(8), { oppHand: 2 });
  assert.equal(monkeyRun(two), 2);
  assert.equal(handOf(two.engine, P2).length, 0);
});

clause(MONKEY, "0:rule", "an opponent with an empty hand discards nothing and nothing hangs", () => {
  const g = monkeyBoard(icons(8), { oppHand: 0 });
  assert.equal(monkeyRun(g), 0);
  assert.equal(zoneOf(g.engine, g.id("dm")), "discard", "the tactic still resolves");
});

clause(MONKEY, "0:rule", "the opponent must discard: an empty pick is refused", () => {
  const g = monkeyBoard(icons(1));
  play(g.engine, P1, g.id("dm"));
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [] }), "declining to discard");
  assert.equal(handOf(g.engine, P2).length, 5);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oh2")] });
  assert.equal(handOf(g.engine, P2).length, 4);
});

clause(MONKEY, "1:flipUp", "FLIP UP 2 [O]: a face-down Monkey flips up for exactly 2 with another [O], and the discards happen (one [O] left: 1 discard)", () => {
  const g = monkeyBoard(obs(1), { faceDown: true });
  assert.equal(readyCount(g.engine, P1), 2, "the face-down card counts as a resource");
  assert.equal(monkeyRun(g, "flip"), 1);
  assert.equal(zoneOf(g.engine, g.id("dm")), "discard");
  assert.equal(readyCount(g.engine, P1), 0, "exactly 2 paid");
});

clause(MONKEY, "1:flipUp", "after a FLIP UP the [O] count is checked too: three [O] -> 2 discards, eight -> 3", () => {
  const three = monkeyBoard(obs(3), { faceDown: true });
  assert.equal(monkeyRun(three, "flip"), 2);
  const eight = monkeyBoard(obs(8), { faceDown: true, oppHand: 6 });
  assert.equal(monkeyRun(eight, "flip"), 3);
});

clause(MONKEY, "1:flipUp", "FLIP UP is refused with only the face-down card itself plus a non-[O] resource (its own icon does not count), and when short of 2 resources", () => {
  const noO = monkeyBoard(rage(2), { faceDown: true });
  refused(() => flipUp(noO.engine, P1, noO.id("dm")), "no [O] among the other resources");
  assert.equal(noO.engine.state.cards[noO.id("dm")].faceDown, true);
  assert.equal(readyCount(noO.engine, P1), 3, "nothing paid");
  const alone = monkeyBoard([], { faceDown: true });
  refused(() => flipUp(alone.engine, P1, alone.id("dm")), "only itself");
  assert.equal(alone.engine.state.cards[alone.id("dm")].faceDown, true);
  const spentO = monkeyBoard(spent(obs(1)), { faceDown: true });
  refused(() => flipUp(spentO.engine, P1, spentO.id("dm")), "a spent [O] meets the threshold but only 1 ready resource for cost 2");
  assert.equal(spentO.engine.state.cards[spentO.id("dm")].faceDown, true);
  const ok = monkeyBoard([...spent(obs(1)), ...rage(1)], { faceDown: true });
  assert.equal(monkeyRun(ok, "flip"), 1, "control: spent [O] for the threshold, Rage + itself pay 2");
});

// ============================================================================================================
// Rusty Pickaxe -- item, rogue, gear, cost 1, threshold [D]
// ATTACH TO CHARACTER. The attached character gains 1 strength and 1 life.
// If this card would be destroyed, flip it face-down under its owner's control instead.
// FLIP UP: 1 [D]
// ============================================================================================================
const PICK = "dc5cc6ec-206e-424a-be0e-aa124bdf933c";

interface PickOpts {
  zone?: "hand" | "play";
  faceDown?: boolean;
  spentSelf?: boolean;
  attachedTo?: string;
  controller?: PlayerId;
  dec?: number;
  greed?: number;
  spentDec?: number;
}
function pickBoard(o: PickOpts = {}): Game {
  return mk([
    {
      key: "pick",
      def: printing(PICK),
      owner: P1,
      zone: o.zone ?? "hand",
      faceDown: o.faceDown,
      ...(o.controller ? { controller: o.controller } : {}),
      ...(o.attachedTo ? { attachedToKey: o.attachedTo } : {}),
      ...(o.spentSelf ? { attachedToKey: "__factionA" } : {})
    },
    { key: "a", def: plain("Alpha", { strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
    { key: "b", def: plain("Bravo", { strength: 3, life: 4, speed: 2 }), owner: P1, zone: "play" },
    { key: "foe", def: plain("Foe", { strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" },
    { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
    { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
    { key: "smash", def: KILL_ITEM, owner: P1, zone: "hand" },
    { key: "slay", def: KILL_CHAR, owner: P1, zone: "hand" },
    ...dec(o.dec ?? 0),
    ...greed(o.greed ?? 0),
    ...spent(dec(o.spentDec ?? 0))
  ]);
}
const pickPlay = (g: Game, host: string | undefined) => play(g.engine, P1, g.id("pick"), { selected: host === undefined ? {} : { attachTo: [g.id(host)] } });
const pickHost = (g: Game) => g.engine.state.cards[g.id("pick")].attachedTo;
const pflip = (g: Game, host?: string) => flipUp(g.engine, P1, g.id("pick"), host ? { attachTo: [g.id(host)] } : {});
const smashPick = (g: Game, target = "pick") => play(g.engine, P1, g.id("smash"), { selected: { t: [g.id(target)] } });

clause(PICK, "0:attach", "printed card: a rogue gear item, cost 1, threshold [D], ATTACH TO CHARACTER", () => {
  const p = printing(PICK);
  assert.equal(p.type, "item");
  assert.equal(p.trade, "rogue");
  assert.deepEqual([...p.subtype], ["gear"]);
  assert.equal(p.cost, 1);
  assert.equal(p.threshold, "d");
  assert.equal((p as unknown as { attachTo?: string }).attachTo, "character");
});

clause(PICK, "0:attach", "deploys attached to the picked character for exactly 1 resource with [D] (a spent [D] meets the threshold, a ready Greed pays)", () => {
  const g = pickBoard({ spentDec: 1, greed: 1 });
  assert.equal(readyCount(g.engine, P1), 1);
  pickPlay(g, "a");
  assert.equal(pending(g.engine), undefined);
  const c = g.engine.state.cards[g.id("pick")];
  assert.equal(c.zone, "play");
  assert.equal(c.faceDown ?? false, false);
  assert.equal(pickHost(g), g.id("a"));
  assert.equal(readyCount(g.engine, P1), 0, "paid exactly 1");
});

clause(PICK, "0:attach", "the cost is 1, not 0 (a spent [D] and nothing ready is refused) and not 2 (a single ready [D] pays, the other resource stays ready)", () => {
  const none = pickBoard({ spentDec: 1 });
  assert.equal(readyCount(none.engine, P1), 0);
  refused(() => pickPlay(none, "a"), "nothing ready to pay 1");
  assert.equal(zoneOf(none.engine, none.id("pick")), "hand");
  const g = pickBoard({ dec: 1, greed: 1 });
  pickPlay(g, "a");
  assert.equal(zoneOf(g.engine, g.id("pick")), "play");
  assert.equal(readyCount(g.engine, P1), 1, "only 1 paid");
});

clause(PICK, "0:attach", "threshold [D]: ready Greed alone is refused", () => {
  const g = pickBoard({ greed: 2 });
  refused(() => pickPlay(g, "a"), "no [D]");
  assert.equal(zoneOf(g.engine, g.id("pick")), "hand");
  assert.equal(readyCount(g.engine, P1), 2, "nothing paid");
});

clause(PICK, "0:attach", "ATTACH TO CHARACTER: a character (mine or an opponent's) is a legal host; an item, a location, a faction and no host are refused", () => {
  const foe = pickBoard({ dec: 1 });
  pickPlay(foe, "foe");
  assert.equal(pickHost(foe), foe.id("foe"), "an opponent's character is a legal host");
  for (const bad of ["gear", "place"]) {
    const g = pickBoard({ dec: 1 });
    refused(() => pickPlay(g, bad), `host ${bad} is not a character`);
    assert.equal(zoneOf(g.engine, g.id("pick")), "hand");
    assert.equal(readyCount(g.engine, P1), 1, "nothing paid");
  }
  const f = pickBoard({ dec: 1 });
  refused(() => play(f.engine, P1, f.id("pick"), { selected: { attachTo: [factionOf(f.engine, P1)] } }), "a faction is not a character");
  assert.equal(zoneOf(f.engine, f.id("pick")), "hand");
  const none = pickBoard({ dec: 1 });
  refused(() => pickPlay(none, undefined), "no host picked");
  assert.equal(zoneOf(none.engine, none.id("pick")), "hand");
});

clause(PICK, "1:rule", "the attached character gains exactly 1 strength and 1 life (speed untouched); other characters are unchanged", () => {
  const g = pickBoard({ dec: 1 });
  assert.deepEqual([stat(g, "a", "strength"), stat(g, "a", "life")], [2, 4]);
  pickPlay(g, "a");
  assert.equal(stat(g, "a", "strength"), 3, "+1 strength");
  assert.equal(stat(g, "a", "life"), 5, "+1 life");
  assert.equal(stat(g, "a", "speed"), 2, "speed is untouched");
  assert.deepEqual([stat(g, "b", "strength"), stat(g, "b", "life")], [3, 4], "Bravo unchanged");
  assert.deepEqual([stat(g, "foe", "strength"), stat(g, "foe", "life")], [1, 4], "Foe unchanged");
});

clause(PICK, "1:rule", "on an opponent's character it buffs that character (the host), not the item's controller's", () => {
  const g = pickBoard({ dec: 1 });
  pickPlay(g, "foe");
  assert.deepEqual([stat(g, "foe", "strength"), stat(g, "foe", "life")], [2, 5]);
  assert.deepEqual([stat(g, "a", "strength"), stat(g, "a", "life")], [2, 4]);
});

clause(PICK, "1:rule", "the +1 life is real while attached (4 damage on 5 life survives) and the buff is gone once the Pickaxe leaves the host", () => {
  const g = pickBoard({ zone: "play", attachedTo: "a" });
  assert.deepEqual([stat(g, "a", "strength"), stat(g, "a", "life")], [3, 5]);
  g.engine.state.cards[g.id("a")].damage = 4;
  assert.equal(zoneOf(g.engine, g.id("a")), "play");
  g.engine.state.cards[g.id("a")].damage = 0;
  smashPick(g);
  assert.deepEqual([stat(g, "a", "strength"), stat(g, "a", "life")], [2, 4], "no longer buffed");
});

clause(PICK, "2:rule", "if the Pickaxe would be destroyed it is flipped face-down in play instead (not in the discard pile)", () => {
  const g = pickBoard({ zone: "play", attachedTo: "a" });
  smashPick(g);
  assert.equal(pending(g.engine), undefined);
  const c = g.engine.state.cards[g.id("pick")];
  assert.equal(c.zone, "play", "still in play");
  assert.equal(c.faceDown, true, "face-down");
  assert.ok(!discardOf(g.engine, P1).includes(g.id("pick")), "not in the discard pile");
  assert.notEqual(pickHost(g), g.id("a"), "no longer attached to the host");
  assert.equal(zoneOf(g.engine, g.id("smash")), "discard", "the destroying tactic resolved");
});

clause(PICK, "2:rule", "the face-down Pickaxe is a resource under its owner's control", () => {
  const g = pickBoard({ zone: "play", attachedTo: "a", dec: 1 });
  assert.equal(readyCount(g.engine, P1), 1);
  smashPick(g);
  assert.equal(g.engine.state.cards[g.id("pick")].faceDown, true);
  assert.equal(g.engine.state.cards[g.id("pick")].controllerId, P1);
  assert.equal(readyCount(g.engine, P1), 2, "a face-down card counts as a resource");
});

clause(PICK, "2:rule", "under its OWNER's control: a Pickaxe I own but an opponent controls comes back face-down under my control", () => {
  const g = pickBoard({ zone: "play", attachedTo: "foe", controller: P2 });
  assert.equal(g.engine.state.cards[g.id("pick")].controllerId, P2, "setup: P2 controls it");
  smashPick(g);
  const c = g.engine.state.cards[g.id("pick")];
  assert.equal(c.zone, "play");
  assert.equal(c.faceDown, true);
  assert.equal(c.ownerId, P1);
  assert.equal(c.controllerId, P1, "under its owner's control");
  assert.equal(readyCount(g.engine, P2), 0, "not one of the opponent's resources");
  assert.deepEqual([stat(g, "foe", "strength"), stat(g, "foe", "life")], [1, 4], "the host lost the buff");
});

clause(PICK, "2:rule", "only the Pickaxe's own destruction is replaced: when its HOST is destroyed the Pickaxe is destroyed with it and flips face-down instead", () => {
  const g = pickBoard({ zone: "play", attachedTo: "a" });
  play(g.engine, P1, g.id("slay"), { selected: { t: [g.id("a")] } });
  assert.equal(zoneOf(g.engine, g.id("a")), "discard", "the host died");
  assert.equal(zoneOf(g.engine, g.id("pick")), "play", "destroyed with its host, so its own replacement applies");
  assert.equal(g.engine.state.cards[g.id("pick")].faceDown, true, "flipped face-down instead");
});

clause(PICK, "2:rule", "destroying a different item leaves the Pickaxe alone, and that item goes to the discard pile as usual", () => {
  const g = pickBoard({ zone: "play", attachedTo: "a" });
  smashPick(g, "gear");
  assert.equal(zoneOf(g.engine, g.id("gear")), "discard");
  assert.equal(g.engine.state.cards[g.id("pick")].faceDown ?? false, false);
  assert.equal(pickHost(g), g.id("a"));
});

clause(PICK, "3:flipUp", "FLIP UP 1 [D]: a face-down Pickaxe with a ready [D] flips up attached to the picked character (+1 strength, +1 life)", () => {
  const g = pickBoard({ zone: "play", faceDown: true, dec: 1, greed: 1 });
  pflip(g, "a");
  const c = g.engine.state.cards[g.id("pick")];
  assert.equal(c.faceDown, false);
  assert.equal(c.zone, "play");
  assert.equal(c.attachedTo, g.id("a"));
  assert.deepEqual([stat(g, "a", "strength"), stat(g, "a", "life")], [3, 5]);
  assert.deepEqual([stat(g, "b", "strength"), stat(g, "b", "life")], [3, 4]);
  assert.equal(readyCount(g.engine, P1), 1, "a cost of 1 was paid: of the 3 ready (Pickaxe, [D], Greed) the face-up Pickaxe is no longer a resource and one other was spent");
  assert.equal(attachedCount(g.engine, P1), 1, "exactly one resource was spent on the cost");
});

clause(PICK, "3:flipUp", "the FLIP UP cost of 1 can be paid by the Pickaxe itself when a spent [D] meets the threshold", () => {
  const g = pickBoard({ zone: "play", faceDown: true, spentDec: 1 });
  assert.equal(readyCount(g.engine, P1), 1, "only the face-down Pickaxe is ready");
  pflip(g, "a");
  assert.equal(g.engine.state.cards[g.id("pick")].faceDown, false);
  assert.equal(pickHost(g), g.id("a"));
});

clause(PICK, "3:flipUp", "the cost is 1, not 0: with every resource spent the flip is refused; a spent face-down Pickaxe flips when another resource is ready to pay", () => {
  const none = pickBoard({ zone: "play", faceDown: true, spentSelf: true, spentDec: 1 });
  assert.equal(readyCount(none.engine, P1), 0);
  refused(() => pflip(none, "a"), "nothing ready to pay 1");
  assert.equal(none.engine.state.cards[none.id("pick")].faceDown, true);
  const g = pickBoard({ zone: "play", faceDown: true, spentSelf: true, spentDec: 1, greed: 1 });
  assert.equal(readyCount(g.engine, P1), 1);
  pflip(g, "a");
  assert.equal(g.engine.state.cards[g.id("pick")].faceDown, false);
  assert.equal(readyCount(g.engine, P1), 0, "the ready resource paid the cost of 1");
});

clause(PICK, "3:flipUp", "the cost is not 2: exactly one resource paid, with the second spent [D] untouched", () => {
  const g = pickBoard({ zone: "play", faceDown: true, spentDec: 2 });
  assert.equal(readyCount(g.engine, P1), 1);
  pflip(g, "a");
  assert.equal(g.engine.state.cards[g.id("pick")].faceDown, false);
});

clause(PICK, "3:flipUp", "the [D] threshold: the Pickaxe's own icon does not count after flipping, and a non-[D] resource does not either", () => {
  const alone = pickBoard({ zone: "play", faceDown: true });
  refused(() => pflip(alone, "a"), "only itself");
  assert.equal(alone.engine.state.cards[alone.id("pick")].faceDown, true);
  const gr = pickBoard({ zone: "play", faceDown: true, greed: 2 });
  refused(() => pflip(gr, "a"), "no [D] among the other resources");
  assert.equal(gr.engine.state.cards[gr.id("pick")].faceDown, true);
  assert.equal(readyCount(gr.engine, P1), 3, "nothing paid");
  const ok = pickBoard({ zone: "play", faceDown: true, dec: 1 });
  pflip(ok, "a");
  assert.equal(ok.engine.state.cards[ok.id("pick")].faceDown, false, "control: one other [D]");
});

clause(PICK, "3:flipUp", "ATTACH TO CHARACTER still applies on FLIP UP: a non-character host is refused (control: an opponent's character is fine)", () => {
  const g = pickBoard({ zone: "play", faceDown: true, dec: 1 });
  refused(() => pflip(g, "gear"), "an item is not a character");
  assert.equal(g.engine.state.cards[g.id("pick")].faceDown, true);
  assert.equal(readyCount(g.engine, P1), 2, "nothing paid");
  refused(() => pflip(g, "place"), "a location is not a character");
  assert.equal(g.engine.state.cards[g.id("pick")].faceDown, true);
  pflip(g, "foe");
  assert.equal(pickHost(g), g.id("foe"), "control");
});

clause(PICK, "3:flipUp", "an item cannot be flipped up in the opponent's response window (it is not a tactic)", () => {
  const g = mk(
    [
      { key: "pick", def: printing(PICK), owner: P1, zone: "play", faceDown: true },
      { key: "a", def: plain("Alpha"), owner: P1, zone: "play" },
      { key: "atk", def: plain("Atk"), owner: P2, zone: "play" },
      ...dec(1)
    ],
    { active: P2 }
  );
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  refused(() => flipUp(g.engine, P1, g.id("pick"), { attachTo: [g.id("a")] }), "FLIP UP of an item in the opponent's window", /flip|deploy|tactic|timing|window/i);
  assert.equal(g.engine.state.cards[g.id("pick")].faceDown, true);
});

// ============================================================================================================
// Scepter of the Chosen -- item, arcanist, cost 4, threshold [O]
// VANISH -- COST: Deplete this card. Pick a character.
// EFFECT: That character's controller may pay 1. If they don't, put that character into its owner's hand.
// ============================================================================================================
const SCEPTER = "56158c3a-fbf9-4bce-8335-e08d91a90406";

function scepterBoard(o: { res?: CardPlacement[]; res2?: CardPlacement[]; depleted?: boolean; zone?: "play" | "hand"; extra?: CardPlacement[] } = {}): Game {
  return mk([
    { key: "sc", def: printing(SCEPTER), owner: P1, zone: o.zone ?? "play", depleted: o.depleted },
    { key: "mine", def: plain("Mine"), owner: P1, zone: "play" },
    { key: "foe", def: plain("Foe", { strength: 2, life: 4 }), owner: P2, zone: "play" },
    { key: "stolen", def: plain("Stolen"), owner: P2, controller: P1, zone: "play" },
    { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
    { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
    ...(o.res ?? []),
    ...(o.res2 ?? []),
    ...(o.extra ?? [])
  ]);
}
const vanish = (g: Game, target?: string) =>
  activate(g.engine, P1, g.id("sc"), "scepter-of-the-chosen-vanish", { selected: target ? { c: [g.id(target)] } : {} });

clause(SCEPTER, "0:ability:scepter-of-the-chosen-vanish", "printed card: an arcanist item, cost 4, threshold [O]; deploys for exactly 4 with an [O]", () => {
  const def = printing(SCEPTER);
  assert.equal(def.type, "item");
  assert.equal(def.trade, "arcanist");
  assert.equal(def.cost, 4);
  assert.equal(def.threshold, "o");
  const g = scepterBoard({ zone: "hand", res: [...obs(1), ...rage(4)] });
  play(g.engine, P1, g.id("sc"));
  assert.equal(zoneOf(g.engine, g.id("sc")), "play");
  assert.equal(readyCount(g.engine, P1), 1, "exactly 4 paid");
  const short = scepterBoard({ zone: "hand", res: [...obs(1), ...rage(2)] });
  refused(() => play(short.engine, P1, short.id("sc")), "3 resources for cost 4");
  assert.equal(zoneOf(short.engine, short.id("sc")), "hand");
  const noO = scepterBoard({ zone: "hand", res: rage(4) });
  refused(() => play(noO.engine, P1, noO.id("sc")), "no [O]");
  assert.equal(zoneOf(noO.engine, noO.id("sc")), "hand");
});

clause(SCEPTER, "0:ability:scepter-of-the-chosen-vanish", "COST: deplete this card: it is depleted as soon as VANISH is used (before the controller decides), even if the character stays", () => {
  const g = scepterBoard({ res2: rage(1, P2) });
  assert.equal(g.engine.state.cards[g.id("sc")].depleted ?? false, false);
  vanish(g, "foe");
  assert.equal(pending(g.engine)?.kind, "mayPay", "the character's controller is asked");
  assert.equal(g.engine.state.cards[g.id("sc")].depleted, true, "depleted already");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(g.engine.state.cards[g.id("sc")].depleted, true, "still depleted after they paid");
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
});

clause(SCEPTER, "0:ability:scepter-of-the-chosen-vanish", "a depleted Scepter cannot use VANISH again", () => {
  const g = scepterBoard({ depleted: true });
  refused(() => vanish(g, "foe"), "the Scepter is depleted");
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
});

clause(SCEPTER, "0:ability:scepter-of-the-chosen-vanish", "VANISH costs me no resources", () => {
  const g = scepterBoard({ res: rage(2) });
  vanish(g, "foe");
  if (pending(g.engine)) drain(g.engine, declineAll);
  assert.equal(readyCount(g.engine, P1), 2);
});

clause(SCEPTER, "0:ability:scepter-of-the-chosen-vanish", "I must pick a character: mine or an opponent's work; no pick, an item, a location and a faction are refused", () => {
  for (const bad of [undefined, "gear", "place"]) {
    const g = scepterBoard();
    refused(() => vanish(g, bad), `pick ${bad}`);
    assert.equal(g.engine.state.cards[g.id("sc")].depleted ?? false, false, "not depleted by a refused use");
  }
  const f = scepterBoard();
  refused(() => activate(f.engine, P1, f.id("sc"), "scepter-of-the-chosen-vanish", { selected: { c: [factionOf(f.engine, P2)] } }), "a faction");
  for (const ok of ["mine", "foe", "stolen"]) {
    const g = scepterBoard({ res: rage(1), res2: rage(1, P2) });
    vanish(g, ok);
    assert.equal(pending(g.engine)?.kind, "mayPay", `picking ${ok}`);
  }
});

clause(SCEPTER, "0:ability:scepter-of-the-chosen-vanish", "the opponent's character: its controller (the opponent) is asked, pays 1 and keeps it; the payment is a real resource", () => {
  const g = scepterBoard({ res: rage(2), res2: rage(2, P2) });
  vanish(g, "foe");
  const pc = pending(g.engine)!;
  assert.equal(pc.kind, "mayPay");
  assert.equal(pc.playerId, P2, "the character's controller decides");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("foe")), "play", "it stays");
  assert.equal(readyCount(g.engine, P2), 1, "they paid exactly 1");
  assert.equal(readyCount(g.engine, P1), 2, "I paid nothing");
  assert.ok(!handOf(g.engine, P2).includes(g.id("foe")), "!handOf(g.engine, P2).includes(foe)");
});

clause(SCEPTER, "0:ability:scepter-of-the-chosen-vanish", "the opponent's character: if they don't pay it goes into its owner's hand", () => {
  const g = scepterBoard({ res2: rage(2, P2) });
  vanish(g, "foe");
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("foe")), "hand");
  assert.ok(handOf(g.engine, P2).includes(g.id("foe")), "in its owner's hand");
  assert.equal(readyCount(g.engine, P2), 2, "nothing was paid");
});

clause(SCEPTER, "0:ability:scepter-of-the-chosen-vanish", "a controller who cannot pay (no resources, or only spent ones) has the character put into its owner's hand", () => {
  for (const res2 of [[] as CardPlacement[], spent(rage(2, P2), P2)]) {
    const g = scepterBoard({ res2 });
    vanish(g, "foe");
    if (pending(g.engine)) drain(g.engine, declineAll);
    assert.equal(zoneOf(g.engine, g.id("foe")), "hand", "could not pay, so it is bounced");
  }
});

clause(SCEPTER, "0:ability:scepter-of-the-chosen-vanish", "my own character: I am the one asked; paying 1 keeps it, not paying puts it into my hand", () => {
  const pay = scepterBoard({ res: rage(2) });
  vanish(pay, "mine");
  const pc = pending(pay.engine)!;
  assert.equal(pc.kind, "mayPay");
  assert.equal(pc.playerId, P1);
  answerPending(pay.engine, "mayPay", { pay: true });
  assert.equal(zoneOf(pay.engine, pay.id("mine")), "play");
  assert.equal(readyCount(pay.engine, P1), 1);
  const dont = scepterBoard({ res: rage(2) });
  vanish(dont, "mine");
  answerPending(dont.engine, "mayPay", { pay: false });
  assert.equal(zoneOf(dont.engine, dont.id("mine")), "hand");
  assert.ok(handOf(dont.engine, P1).includes(dont.id("mine")), "handOf(dont.engine, P1).includes(dont.id(mine))");
  assert.equal(readyCount(dont.engine, P1), 2);
});

clause(SCEPTER, "0:ability:scepter-of-the-chosen-vanish", "a character I took from the opponent: I (its controller) am asked, and unpaid it goes to its OWNER's hand", () => {
  const g = scepterBoard({ res: rage(1), res2: rage(2, P2) });
  vanish(g, "stolen");
  const pc = pending(g.engine)!;
  assert.equal(pc.kind, "mayPay");
  assert.equal(pc.playerId, P1, "its controller, not its owner");
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(zoneOf(g.engine, g.id("stolen")), "hand");
  assert.ok(handOf(g.engine, P2).includes(g.id("stolen")), "its owner (P2) gets it back");
  assert.ok(!handOf(g.engine, P1).includes(g.id("stolen")), "!handOf(g.engine, P1).includes(stolen)");
});

clause(SCEPTER, "0:ability:scepter-of-the-chosen-vanish", "a character that is paid for is untouched: still undamaged and other characters are not moved", () => {
  const g = scepterBoard({ res2: rage(1, P2) });
  vanish(g, "foe");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(damageOn(g.engine, g.id("foe")), 0);
  for (const k of ["mine", "stolen"]) assert.equal(zoneOf(g.engine, g.id(k)), "play");
});

// ============================================================================================================
// Scrag -- tactic, rogue, cost 2, threshold [D][D]
// EXTRA COST: Pick a character. X is its life.
// If the character's controller has at least X cards in their discard pile, destroy the character.
// ============================================================================================================
const SCRAG = "fb663668-19d6-4f14-a48f-6e9ae04e8875";

function scragBoard(o: { myDisc?: number; oppDisc?: number; res?: CardPlacement[]; extra?: CardPlacement[]; foeLife?: number; foeStr?: number } = {}): Game {
  return mk([
    { key: "sg", def: printing(SCRAG), owner: P1, zone: "hand" },
    { key: "foe", def: plain("Foe", { strength: o.foeStr ?? 1, life: o.foeLife ?? 3 }), owner: P2, zone: "play" },
    { key: "mine", def: plain("Mine", { strength: 1, life: 2 }), owner: P1, zone: "play" },
    { key: "stolen", def: plain("Stolen", { strength: 1, life: 2 }), owner: P2, controller: P1, zone: "play" },
    { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
    { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
    ...fillers("md", o.myDisc ?? 0, P1, "discard"),
    ...fillers("od", o.oppDisc ?? 0, P2, "discard"),
    ...(o.res ?? dec(2)),
    ...(o.extra ?? [])
  ]);
}
const castScrag = (g: Game, pick?: string) => play(g.engine, P1, g.id("sg"), { selected: pick ? { c: [g.id(pick)] } : {} });

clause(SCRAG, "0:extraCost", "printed card: a rogue tactic, cost 2, threshold [D][D]; deploys for exactly 2 and goes to the discard pile", () => {
  const def = printing(SCRAG);
  assert.equal(def.type, "tactic");
  assert.equal(def.trade, "rogue");
  assert.equal(def.cost, 2);
  assert.equal(def.threshold, "dd");
  const g = scragBoard({ res: [...dec(2), ...rage(1)] });
  castScrag(g, "foe");
  assert.equal(readyCount(g.engine, P1), 1, "exactly 2 paid");
  assert.equal(zoneOf(g.engine, g.id("sg")), "discard");
  const short = scragBoard({ res: dec(1) });
  refused(() => castScrag(short, "foe"), "1 resource for cost 2");
  assert.equal(zoneOf(short.engine, short.id("sg")), "hand");
  const oneD = scragBoard({ res: [...dec(1), ...rage(2)] });
  refused(() => castScrag(oneD, "foe"), "only one [D]");
  assert.equal(zoneOf(oneD.engine, oneD.id("sg")), "hand");
  const spentD = scragBoard({ res: [...spent(dec(2)), ...rage(1)] });
  refused(() => castScrag(spentD, "foe"), "spent [D][D] but only 1 ready to pay 2");
  const okSpent = scragBoard({ res: [...spent(dec(2)), ...rage(2)] });
  castScrag(okSpent, "foe");
  assert.equal(zoneOf(okSpent.engine, okSpent.id("sg")), "discard", "control");
});

clause(SCRAG, "0:extraCost", "I must pick a character: mine, the opponent's and a stolen one work; no pick, an item, a location and a faction are refused", () => {
  for (const bad of [undefined, "gear", "place"]) {
    const g = scragBoard();
    refused(() => castScrag(g, bad), `pick ${bad}`);
    assert.equal(zoneOf(g.engine, g.id("sg")), "hand");
    assert.equal(readyCount(g.engine, P1), 2, "nothing paid");
  }
  const f = scragBoard();
  refused(() => play(f.engine, P1, f.id("sg"), { selected: { c: [factionOf(f.engine, P2)] } }), "a faction");
  for (const ok of ["foe", "mine", "stolen"]) {
    const g = scragBoard();
    castScrag(g, ok);
    assert.equal(zoneOf(g.engine, g.id("sg")), "discard", `pick ${ok}`);
  }
});

clause(SCRAG, "1:rule", "the character is destroyed when its controller's discard pile has at least X cards, X being its life: 3 life, exactly 3 cards in the pile", () => {
  const g = scragBoard({ oppDisc: 3, foeLife: 3 });
  castScrag(g, "foe");
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard", "destroyed");
  assert.ok(discardOf(g.engine, P2).includes(g.id("foe")), "discardOf(g.engine, P2).includes(foe)");
});

clause(SCRAG, "1:rule", "'at least X': more cards than X also destroys it (5 cards, 3 life)", () => {
  const g = scragBoard({ oppDisc: 5, foeLife: 3 });
  castScrag(g, "foe");
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard");
});

clause(SCRAG, "1:rule", "one card short does nothing: 2 cards in the pile, 3 life, the character stays and Scrag still costs and resolves", () => {
  const g = scragBoard({ oppDisc: 2, foeLife: 3 });
  castScrag(g, "foe");
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
  assert.equal(zoneOf(g.engine, g.id("sg")), "discard", "Scrag resolved");
  assert.equal(readyCount(g.engine, P1), 0, "and was paid for");
});

clause(SCRAG, "1:rule", "X is the character's LIFE, not its strength: 2 life with 2 cards dies even at 5 strength; 5 strength with 4 cards and 6 life survives", () => {
  const dies = scragBoard({ oppDisc: 2, foeLife: 2, foeStr: 5 });
  castScrag(dies, "foe");
  assert.equal(zoneOf(dies.engine, dies.id("foe")), "discard");
  const lives = scragBoard({ oppDisc: 4, foeLife: 6, foeStr: 2 });
  castScrag(lives, "foe");
  assert.equal(zoneOf(lives.engine, lives.id("foe")), "play");
});

clause(SCRAG, "1:rule", "X is its life (printed plus modifiers), not its remaining life: 3 life with 2 damage and 2 cards does not die; a +1 life item makes X 4", () => {
  const dmg = scragBoard({ oppDisc: 2, foeLife: 3 });
  dmg.engine.state.cards[dmg.id("foe")].damage = 2;
  castScrag(dmg, "foe");
  assert.equal(zoneOf(dmg.engine, dmg.id("foe")), "play", "X is 3, only 2 cards");
  const buffed = scragBoard({
    oppDisc: 3,
    foeLife: 3,
    extra: [{ key: "pk", def: printing(PICK), owner: P2, zone: "play", attachedToKey: "foe" }]
  });
  assert.equal(stat(buffed, "foe", "life"), 4, "setup: Pickaxe makes its life 4");
  castScrag(buffed, "foe");
  assert.equal(zoneOf(buffed.engine, buffed.id("foe")), "play", "X is 4, only 3 cards");
});

clause(SCRAG, "1:rule", "only the CHARACTER'S controller's discard pile counts, not mine: my 6 cards don't help against an empty opposing pile", () => {
  const g = scragBoard({ myDisc: 6, oppDisc: 0, foeLife: 2 });
  castScrag(g, "foe");
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
  const opp = scragBoard({ myDisc: 0, oppDisc: 2, foeLife: 2 });
  castScrag(opp, "foe");
  assert.equal(zoneOf(opp.engine, opp.id("foe")), "discard", "their own pile is what counts");
});

clause(SCRAG, "1:rule", "my own character is judged by MY discard pile (its controller's): 2 life, my pile of 2 destroys it, the opponent's pile of 5 does not", () => {
  const mineDies = scragBoard({ myDisc: 2, oppDisc: 0 });
  castScrag(mineDies, "mine");
  assert.equal(zoneOf(mineDies.engine, mineDies.id("mine")), "discard");
  const mineLives = scragBoard({ myDisc: 0, oppDisc: 5 });
  castScrag(mineLives, "mine");
  assert.equal(zoneOf(mineLives.engine, mineLives.id("mine")), "play");
});

clause(SCRAG, "1:rule", "a character I took from the opponent is judged by ITS CONTROLLER's pile (mine), not its owner's", () => {
  const byMe = scragBoard({ myDisc: 2, oppDisc: 0 });
  castScrag(byMe, "stolen");
  assert.equal(zoneOf(byMe.engine, byMe.id("stolen")), "discard", "my pile of 2 counts");
  const byOwner = scragBoard({ myDisc: 0, oppDisc: 5 });
  castScrag(byOwner, "stolen");
  assert.equal(zoneOf(byOwner.engine, byOwner.id("stolen")), "play", "the owner's pile doesn't count");
});

clause(SCRAG, "1:rule", "Scrag itself is not in the pile it counts: my character with 2 life and exactly 1 other card in my pile survives", () => {
  const g = scragBoard({ myDisc: 1, oppDisc: 0 });
  castScrag(g, "mine");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play", "1 card < 2: Scrag does not count itself");
});

// ============================================================================================================
// Scrapyard -- location, gearsmith, cost 3, threshold [E], structure 5
// SCRAPPED -- COST: Destroy a Micromajig token you control.
// EFFECT: Reduce the numeric cost of the next card you deploy this turn by 1.
// ============================================================================================================
const SCRAPYARD = "e756d2ae-8ac6-4b08-af33-553f8add816b";

const micro = (key: string, owner: PlayerId = P1, name = "Micromajig"): CardPlacement => ({
  key,
  def: character({ name, subtype: ["majig"], strength: 1, life: 1, speed: 3, text: "token" }),
  owner,
  zone: "play"
});
function mkTok(cards: CardPlacement[], o: BoardOpts = {}): Game {
  const g = mk(cards, o);
  for (const card of cards) if (card.key.startsWith("mm")) g.engine.state.cards[g.id(card.key)].isToken = true;
  return g;
}
function yardBoard(o: { zone?: "play" | "hand"; res?: CardPlacement[]; extra?: CardPlacement[] } = {}): Game {
  return mkTok([
    { key: "sy", def: printing(SCRAPYARD), owner: P1, zone: o.zone ?? "play" },
    micro("mm1"),
    micro("mm2"),
    micro("mmfoe", P2),
    { key: "card", def: character({ name: "Micromajig", subtype: ["majig"], text: "the real card" }), owner: P1, zone: "play" },
    { key: "other", def: plain("Gearling", { subtype: ["majig"] }), owner: P1, zone: "play" },
    micro("mmother", P1, "Gearling"),
    costed("c1", 1),
    costed("c2", 2),
    costed("c3", 3),
    ...(o.res ?? rage(4)),
    ...(o.extra ?? [])
  ]);
}
const scrap = (g: Game, tok?: string) => activate(g.engine, P1, g.id("sy"), "scrapyard-scrapped", { selected: tok ? { tok: [g.id(tok)] } : {} });
const gone = (g: Game, key: string): boolean => !g.engine.state.cards[g.id(key)] || g.engine.state.cards[g.id(key)].zone !== "play";

clause(SCRAPYARD, "0:ability:scrapyard-scrapped", "printed card: a gearsmith location, cost 3, threshold [E], structure 5; deploys for exactly 3", () => {
  const def = printing(SCRAPYARD);
  assert.equal(def.type, "location");
  assert.equal(def.trade, "gearsmith");
  assert.equal(def.cost, 3);
  assert.equal(def.threshold, "e");
  assert.equal(def.structure, 5);
  const g = yardBoard({ zone: "hand", res: [...elit(1), ...rage(3)] });
  play(g.engine, P1, g.id("sy"));
  assert.equal(zoneOf(g.engine, g.id("sy")), "play");
  assert.equal(readyCount(g.engine, P1), 1, "exactly 3 paid");
  assert.equal((g.engine.getStat as (id: string, stat: string) => number)(g.id("sy"), "structure"), 5);
  const short = yardBoard({ zone: "hand", res: [...elit(1), ...rage(1)] });
  refused(() => play(short.engine, P1, short.id("sy")), "2 resources");
  assert.equal(zoneOf(short.engine, short.id("sy")), "hand");
  const noE = yardBoard({ zone: "hand", res: rage(4) });
  refused(() => play(noE.engine, P1, noE.id("sy")), "no [E]");
  assert.equal(zoneOf(noE.engine, noE.id("sy")), "hand");
});

clause(SCRAPYARD, "0:ability:scrapyard-scrapped", "COST: the Micromajig token I control is destroyed when SCRAPPED is used, before the opponent can respond, and no resource is paid", () => {
  const g = yardBoard();
  assert.equal(readyCount(g.engine, P1), 4);
  g.engine.perform({ type: "activateAbility", playerId: P1, cardId: g.id("sy"), abilityId: "scrapyard-scrapped", selected: { tok: [g.id("mm1")] }, variables: {} });
  assert.ok(gone(g, "mm1"), "the token is gone while SCRAPPED waits for responses");
  assert.equal(readyCount(g.engine, P1), 4, "no resources paid");
  resolvePendingResponses(g.engine);
  assert.ok(!gone(g, "mm2"), "the other token is untouched");
});

clause(SCRAPYARD, "0:ability:scrapyard-scrapped", "the destroyed card must be a Micromajig TOKEN I control: the opponent's token, the real Micromajig card, another token and another card are refused; no token at all is refused", () => {
  for (const bad of ["mmfoe", "card", "mmother", "other"]) {
    const g = yardBoard();
    refused(() => scrap(g, bad), `scrapping ${bad}`);
    assert.ok(!gone(g, bad), `${bad} is still in play`);
    play(g.engine, P1, g.id("c2"));
    assert.equal(readyCount(g.engine, P1), 2, "and no reduction was granted: the card cost its full 2");
  }
  const none = yardBoard();
  refused(() => scrap(none, undefined), "no token chosen");
  const empty = mk([{ key: "sy", def: printing(SCRAPYARD), owner: P1, zone: "play" }, { key: "card", def: character({ name: "Micromajig", subtype: ["majig"] }), owner: P1, zone: "play" }]);
  refused(() => activate(empty.engine, P1, empty.id("sy"), "scrapyard-scrapped", { selected: { tok: [empty.id("card")] } }), "no tokens in play");
});

clause(SCRAPYARD, "0:ability:scrapyard-scrapped", "EFFECT: the next card I deploy this turn costs 1 less (a cost-2 card pays 1, a cost-1 card pays 0)", () => {
  const g = yardBoard();
  scrap(g, "mm1");
  play(g.engine, P1, g.id("c2"));
  assert.equal(zoneOf(g.engine, g.id("c2")), "play");
  assert.equal(readyCount(g.engine, P1), 3, "paid 1 instead of 2");
  const free = yardBoard();
  scrap(free, "mm1");
  play(free.engine, P1, free.id("c1"));
  assert.equal(zoneOf(free.engine, free.id("c1")), "play");
  assert.equal(readyCount(free.engine, P1), 4, "a cost-1 card is free");
  const control = yardBoard();
  play(control.engine, P1, control.id("c2"));
  assert.equal(readyCount(control.engine, P1), 2, "control: without SCRAPPED it costs 2");
});

clause(SCRAPYARD, "0:ability:scrapyard-scrapped", "only the NEXT card: the second deployed card pays in full", () => {
  const g = yardBoard();
  scrap(g, "mm1");
  play(g.engine, P1, g.id("c3"));
  assert.equal(readyCount(g.engine, P1), 2, "the first pays 2");
  play(g.engine, P1, g.id("c2"));
  assert.equal(readyCount(g.engine, P1), 0, "the second pays its full 2");
});

clause(SCRAPYARD, "0:ability:scrapyard-scrapped", "two SCRAPPED in a turn stack: the next card costs 2 less", () => {
  const g = yardBoard();
  scrap(g, "mm1");
  scrap(g, "mm2");
  play(g.engine, P1, g.id("c3"));
  assert.equal(readyCount(g.engine, P1), 3, "a cost-3 card pays 1");
});

clause(SCRAPYARD, "0:ability:scrapyard-scrapped", "it reduces the numeric cost only, never the threshold", () => {
  const gated = { key: "gated", def: plain("Gated", { cost: 2, threshold: "e" as never }), owner: P1, zone: "hand" as const };
  const g = yardBoard({ res: rage(3), extra: [gated] });
  scrap(g, "mm1");
  refused(() => play(g.engine, P1, g.id("gated")), "the [E] threshold still applies");
  assert.equal(zoneOf(g.engine, g.id("gated")), "hand");
  const ok = yardBoard({ res: [...elit(1), ...rage(2)], extra: [gated] });
  scrap(ok, "mm1");
  play(ok.engine, P1, ok.id("gated"));
  assert.equal(zoneOf(ok.engine, ok.id("gated")), "play");
  assert.equal(readyCount(ok.engine, P1), 2, "paid 1 instead of 2");
});

clause(SCRAPYARD, "0:ability:scrapyard-scrapped", "'this turn': the reduction is gone on my next turn", () => {
  const g = yardBoard({ res: rage(6) });
  scrap(g, "mm1");
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  const before = readyCount(g.engine, P1);
  play(g.engine, P1, g.id("c2"));
  assert.equal(readyCount(g.engine, P1), before - 2, "full price again");
});

clause(SCRAPYARD, "0:ability:scrapyard-scrapped", "it is a reduction for the next CARD I deploy, not for an ability cost: a 'Pay 1' ability still pays 1 and the reduction waits for the card", () => {
  const g = yardBoard({ extra: [{ key: "q", def: printing(QUILT), owner: P1, zone: "play" }, ...fillers("dk", 2, P1, "deck")] });
  scrap(g, "mm1");
  activate(g.engine, P1, g.id("q"), "hand-it-down");
  assert.equal(readyCount(g.engine, P1), 3, "the ability cost 1 as printed");
  play(g.engine, P1, g.id("c2"));
  assert.equal(readyCount(g.engine, P1), 2, "the next card still got its 1 off");
});

clause(SCRAPYARD, "0:ability:scrapyard-scrapped", "the reduction is mine: the opponent deploying a card in response pays in full", () => {
  const g = mkTok([
    { key: "sy", def: printing(SCRAPYARD), owner: P1, zone: "play" },
    micro("mm1"),
    { key: "atk", def: plain("Atk"), owner: P1, zone: "play" },
    costed("c3", 3),
    { key: "foespell", def: tactic({ name: "Their Spell", cost: 2, behavior: { abilities: [{ id: "x", type: "activated", effects: [] }] } }), owner: P2, zone: "hand" },
    ...rage(4),
    ...rage(3, P2)
  ]);
  scrap(g, "mm1");
  declareAttackOpenWindow(g.engine, P1, [g.id("atk")]);
  play(g.engine, P2, g.id("foespell"));
  assert.equal(readyCount(g.engine, P2), 1, "the opponent pays its full cost 2");
  declareBlockers(g.engine, P2, []);
  finishBattle(g.engine);
  play(g.engine, P1, g.id("c3"));
  assert.equal(readyCount(g.engine, P1), 2, "my reduction was still waiting: 3 - 1 = 2 paid");
});

// ============================================================================================================
// Shaman of the Fallen -- character, banker, greater mau, cost 1, threshold [G], 1 str / 3 spd / 1 life
// When this card enters play, you may lose 2 influence. If you do, pick a character in your discard pile
// and put it into your hand.
// ============================================================================================================
const SHAMAN = "1c664e6e-c5c2-443b-8ca2-3a29b954dba7";

function shamanBoard(o: { res?: CardPlacement[]; extra?: CardPlacement[]; influence?: number; zone?: "hand" | "play" } = {}): Game {
  const g = mk([
    { key: "sh", def: printing(SHAMAN), owner: P1, zone: o.zone ?? "hand" },
    { key: "c1", def: plain("Back One"), owner: P1, zone: "discard" },
    { key: "c2", def: plain("Back Two"), owner: P1, zone: "discard" },
    { key: "it", def: item({ name: "Dead Gear" }), owner: P1, zone: "discard" },
    { key: "tc", def: NOOP("Dead Spell"), owner: P1, zone: "discard" },
    { key: "oc", def: plain("Their Dead"), owner: P2, zone: "discard" },
    ...(o.res ?? greed(2)),
    ...(o.extra ?? [])
  ]);
  if (o.influence !== undefined) g.engine.state.players[P1].influence = o.influence;
  return g;
}

clause(SHAMAN, "0:rule", "printed card: a banker greater mau character, cost 1, threshold [G], 1 strength / 3 speed / 1 life; deploys for exactly 1", () => {
  const def = printing(SHAMAN);
  assert.equal(def.type, "character");
  assert.equal(def.trade, "banker");
  assert.deepEqual([...def.subtype], ["greater mau"]);
  assert.equal(def.cost, 1);
  assert.equal(def.threshold, "g");
  assert.deepEqual([def.strength, def.speed, def.life], [1, 3, 1]);
  const g = shamanBoard({ res: greed(2) });
  play(g.engine, P1, g.id("sh"));
  assert.equal(zoneOf(g.engine, g.id("sh")), "play");
  assert.equal(readyCount(g.engine, P1), 1, "exactly 1 paid");
  assert.deepEqual([stat(g, "sh", "strength"), stat(g, "sh", "speed"), stat(g, "sh", "life")], [1, 3, 1]);
  const noG = shamanBoard({ res: rage(2) });
  refused(() => play(noG.engine, P1, noG.id("sh")), "no [G]");
  assert.equal(zoneOf(noG.engine, noG.id("sh")), "hand");
  const none = shamanBoard({ res: [] });
  refused(() => play(none.engine, P1, none.id("sh")), "no resources");
});

clause(SHAMAN, "0:rule", "entering play offers me the 'may lose 2 influence'; accepting loses exactly 2 influence and then asks me to pick a character in my discard pile", () => {
  const g = shamanBoard();
  const before = influence(g.engine, P1);
  play(g.engine, P1, g.id("sh"));
  const pc = pending(g.engine)!;
  assert.equal(pc.kind, "mayPay");
  assert.equal(pc.playerId, P1);
  assert.equal(influence(g.engine, P1), before, "nothing lost before I decide");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(influence(g.engine, P1), before - 2, "exactly 2 influence lost");
  const pick = pending(g.engine)!;
  assert.equal(pick.kind, "chooserSelectsTarget");
  assert.equal(pick.playerId, P1);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("c1")] });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("c1")), "hand", "the character is back in my hand");
  assert.equal(zoneOf(g.engine, g.id("c2")), "discard", "only one character");
  assert.equal(influence(g.engine, P2), 30, "the opponent's influence is untouched");
});

clause(SHAMAN, "0:rule", "declining loses nothing and returns nothing, and no pick is asked", () => {
  const g = shamanBoard();
  const before = influence(g.engine, P1);
  play(g.engine, P1, g.id("sh"));
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(pending(g.engine), undefined);
  assert.equal(influence(g.engine, P1), before);
  for (const k of ["c1", "c2", "it", "tc"]) assert.equal(zoneOf(g.engine, g.id(k)), "discard");
  assert.equal(zoneOf(g.engine, g.id("sh")), "play");
});

clause(SHAMAN, "0:rule", "the pick is a CHARACTER in MY discard pile: an item, a tactic and the opponent's character are refused; either of my characters works", () => {
  for (const bad of ["it", "tc", "oc"]) {
    const g = shamanBoard();
    play(g.engine, P1, g.id("sh"));
    answerPending(g.engine, "mayPay", { pay: true });
    refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(bad)] }), `picking ${bad}`);
    assert.equal(zoneOf(g.engine, g.id(bad)), "discard", `${bad} did not move`);
    answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("c2")] });
    assert.equal(zoneOf(g.engine, g.id("c2")), "hand", "control");
  }
});

clause(SHAMAN, "0:rule", "I pick ONE character: picking two is refused", () => {
  const g = shamanBoard();
  play(g.engine, P1, g.id("sh"));
  answerPending(g.engine, "mayPay", { pay: true });
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("c1"), g.id("c2")] }), "two cards");
  assert.equal(zoneOf(g.engine, g.id("c1")), "discard");
  assert.equal(zoneOf(g.engine, g.id("c2")), "discard");
});

clause(SHAMAN, "0:rule", "if I lose the influence I must pick a character: an empty pick is refused while one is in my discard pile", () => {
  const g = shamanBoard();
  play(g.engine, P1, g.id("sh"));
  answerPending(g.engine, "mayPay", { pay: true });
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [] }), "picking nothing");
  assert.equal(zoneOf(g.engine, g.id("c1")), "discard");
});

clause(SHAMAN, "0:rule", "with no character in my discard pile I may still lose the 2 influence, and nothing hangs", () => {
  const g = mk([
    { key: "sh", def: printing(SHAMAN), owner: P1, zone: "hand" },
    { key: "it", def: item({ name: "Dead Gear" }), owner: P1, zone: "discard" },
    ...greed(2)
  ]);
  play(g.engine, P1, g.id("sh"));
  assert.equal(pending(g.engine)?.kind, "mayPay", "the 'you may lose 2 influence' is still offered");
  answerPending(g.engine, "mayPay", { pay: true });
  if (pending(g.engine)) drain(g.engine, declineAll);
  assert.equal(pending(g.engine), undefined);
  assert.equal(influence(g.engine, P1), 28);
  assert.equal(zoneOf(g.engine, g.id("it")), "discard");
});

clause(SHAMAN, "0:rule", "losing influence is a cost I must be able to pay: with 1 influence the 2 cannot be lost and nothing comes back", () => {
  const g = shamanBoard({ influence: 1 });
  play(g.engine, P1, g.id("sh"));
  if (pending(g.engine)?.kind === "mayPay") {
    refused(() => answerPending(g.engine, "mayPay", { pay: true }), "losing 2 influence with 1");
  }
  if (pending(g.engine)) drain(g.engine, declineAll);
  assert.equal(influence(g.engine, P1), 1);
  assert.equal(zoneOf(g.engine, g.id("c1")), "discard");
  assert.equal(zoneOf(g.engine, g.id("c2")), "discard");
});

clause(SHAMAN, "0:rule", "only when THIS card enters play: with a Shaman in play, another character entering offers nothing", () => {
  const g = shamanBoard({ zone: "play", extra: [{ key: "van", def: plain("Van", { cost: 0 }), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("van"));
  assert.equal(pending(g.engine), undefined);
  assert.equal(influence(g.engine, P1), 30);
  assert.equal(zoneOf(g.engine, g.id("c1")), "discard");
});

// ============================================================================================================
// Shriever General -- character, warlord, dragon, cost 6, threshold [R][R][R], 5 str / 3 spd / 4 life
// AGGRO
// When this card enters play, if an opponent's faction lost influence this turn you may inflict 2 damage to
// that faction and pick a character that opponent controls. If you do, inflict 2 damage to it.
// ============================================================================================================
const SHRIEVER = "2ac6e84e-f9c7-4c31-9cbb-c7572cb99858";

/** Items that move influence around (to arrange 'lost influence this turn'). */
const LEVER = item({
  name: "Lever",
  cost: 0,
  behavior: {
    abilities: [
      { id: "drain-opp", type: "activated", effects: [{ type: "modifyInfluence", player: "opponent", amount: -1 }] },
      { id: "boost-opp", type: "activated", effects: [{ type: "modifyInfluence", player: "opponent", amount: 2 }] },
      { id: "drain-me", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount: -1 }] }
    ]
  }
} as never);

function shrBoard(o: { res?: CardPlacement[]; extra?: CardPlacement[]; foeLife?: number } = {}): Game {
  return mk([
    { key: "sg", def: printing(SHRIEVER), owner: P1, zone: "hand" },
    { key: "lever", def: LEVER, owner: P1, zone: "play" },
    { key: "foe", def: plain("Foe", { life: o.foeLife ?? 5 }), owner: P2, zone: "play" },
    { key: "foe2", def: plain("Foe Two", { life: 5 }), owner: P2, zone: "play" },
    { key: "mine", def: plain("Mine", { life: 5 }), owner: P1, zone: "play" },
    { key: "stolen", def: plain("Stolen", { life: 5 }), owner: P2, controller: P1, zone: "play" },
    ...(o.res ?? rage(6)),
    ...(o.extra ?? [])
  ]);
}
const lever = (g: Game, ability: string) => activate(g.engine, P1, g.id("lever"), ability);
const shrAnswer = (g: Game, pay: boolean, pick = "foe") => (pc: { kind: string }): unknown =>
  pc.kind === "mayPay" ? { kind: "mayPay", pay } : pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [g.id(pick)] } : declineAll(pc as never);
const deployShr = (g: Game, pay = true, pick = "foe") => {
  play(g.engine, P1, g.id("sg"));
  drain(g.engine, shrAnswer(g, pay, pick));
};

clause(SHRIEVER, "0:kw:AGGRO", "printed card: a warlord dragon character, cost 6, threshold [R][R][R], 5 strength / 3 speed / 4 life; deploys for exactly 6", () => {
  const def = printing(SHRIEVER);
  assert.equal(def.type, "character");
  assert.equal(def.trade, "warlord");
  assert.deepEqual([...def.subtype], ["dragon"]);
  assert.equal(def.cost, 6);
  assert.equal(def.threshold, "rrr");
  assert.deepEqual([def.strength, def.speed, def.life], [5, 3, 4]);
  const g = shrBoard({ res: rage(7) });
  play(g.engine, P1, g.id("sg"));
  assert.equal(zoneOf(g.engine, g.id("sg")), "play");
  assert.equal(readyCount(g.engine, P1), 1, "exactly 6 paid");
  assert.deepEqual([stat(g, "sg", "strength"), stat(g, "sg", "speed"), stat(g, "sg", "life")], [5, 3, 4]);
  const short = shrBoard({ res: rage(5) });
  refused(() => play(short.engine, P1, short.id("sg")), "5 resources for cost 6");
  assert.equal(zoneOf(short.engine, short.id("sg")), "hand");
  const twoR = shrBoard({ res: [...rage(2), ...greed(4)] });
  refused(() => play(twoR.engine, P1, twoR.id("sg")), "only two [R]");
  assert.equal(zoneOf(twoR.engine, twoR.id("sg")), "hand");
});

clause(SHRIEVER, "0:kw:AGGRO", "AGGRO: it can attack the turn it enters play, which an ordinary character cannot", () => {
  const g = shrBoard({ res: rage(6), extra: [{ key: "plainnew", def: plain("Plain New", { cost: 0 }), owner: P1, zone: "hand" }] });
  assert.ok(g.engine.getKeywords(g.id("sg")).map(String).includes("aggro"), "g.engine.getKeywords(sg).map(String).includes(aggro)");
  play(g.engine, P1, g.id("sg"));
  play(g.engine, P1, g.id("plainnew"));
  refused(() => declareAttackBy(g.engine, P1, [g.id("plainnew")]), "a plain character that just entered cannot attack");
  declareAttackBy(g.engine, P1, [g.id("sg")]);
  assert.ok(g.engine.state.battle, "the Shriever General attacks the turn it entered");
});

clause(SHRIEVER, "1:rule", "if the opponent's faction lost no influence this turn nothing is offered, and nothing is damaged", () => {
  const g = shrBoard();
  play(g.engine, P1, g.id("sg"));
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("sg")), "play");
  assert.equal(influence(g.engine, P2), 30);
  assert.equal(damageOn(g.engine, g.id("foe")), 0);
});

clause(SHRIEVER, "1:rule", "after the opponent's faction lost influence this turn: accepting inflicts 2 damage to their faction and 2 to the picked opposing character", () => {
  const g = shrBoard();
  lever(g, "drain-opp");
  assert.equal(influence(g.engine, P2), 29);
  play(g.engine, P1, g.id("sg"));
  const may = pending(g.engine)!;
  assert.equal(may.kind, "mayPay");
  assert.equal(may.playerId, P1);
  answerPending(g.engine, "mayPay", { pay: true });
  const pick = pending(g.engine)!;
  assert.equal(pick.kind, "chooserSelectsTarget");
  assert.equal(pick.playerId, P1);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("foe")] });
  assert.equal(pending(g.engine), undefined);
  assert.equal(influence(g.engine, P2), 27, "2 damage to their faction");
  assert.equal(damageOn(g.engine, g.id("foe")), 2, "2 damage to the picked character");
  for (const k of ["foe2", "mine", "stolen"]) assert.equal(damageOn(g.engine, g.id(k)), 0, `${k} untouched`);
  assert.equal(influence(g.engine, P1), 30, "my faction is untouched");
});

clause(SHRIEVER, "1:rule", "it is a 'may': declining inflicts no damage at all", () => {
  const g = shrBoard();
  lever(g, "drain-opp");
  deployShr(g, false);
  assert.equal(influence(g.engine, P2), 29);
  assert.equal(damageOn(g.engine, g.id("foe")), 0);
  assert.equal(zoneOf(g.engine, g.id("sg")), "play");
});

clause(SHRIEVER, "1:rule", "the pick must be a character the OPPONENT controls: my own character and the one I took from them are refused (control: either opposing character works)", () => {
  for (const bad of ["mine", "stolen", "sg"]) {
    const g = shrBoard();
    lever(g, "drain-opp");
    play(g.engine, P1, g.id("sg"));
    answerPending(g.engine, "mayPay", { pay: true });
    refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(bad)] }), `picking ${bad}`);
    assert.equal(damageOn(g.engine, g.id(bad)), 0);
    answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("foe2")] });
    assert.equal(damageOn(g.engine, g.id("foe2")), 2, "control");
  }
});

clause(SHRIEVER, "1:rule", "2 damage destroys an opposing character with 2 life or less", () => {
  const g = shrBoard({ foeLife: 2 });
  lever(g, "drain-opp");
  deployShr(g, true, "foe");
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard");
});

clause(SHRIEVER, "1:rule", "the faction takes the 2 damage even when the opponent controls no character", () => {
  const g = mk([
    { key: "sg", def: printing(SHRIEVER), owner: P1, zone: "hand" },
    { key: "lever", def: LEVER, owner: P1, zone: "play" },
    ...rage(6)
  ]);
  lever(g, "drain-opp");
  play(g.engine, P1, g.id("sg"));
  if (pending(g.engine)?.kind === "mayPay") answerPending(g.engine, "mayPay", { pay: true });
  if (pending(g.engine)) drain(g.engine, declineAll);
  assert.equal(influence(g.engine, P2), 27);
});

clause(SHRIEVER, "1:rule", "'lost influence': a gain, and my own faction's loss, don't enable it", () => {
  const g = shrBoard();
  lever(g, "boost-opp");
  lever(g, "drain-me");
  assert.equal(influence(g.engine, P2), 32);
  play(g.engine, P1, g.id("sg"));
  assert.equal(pending(g.engine), undefined, "a gain or my own loss does not enable it");
  assert.equal(influence(g.engine, P2), 32);
});

clause(SHRIEVER, "1:rule", "'this turn': an influence loss on an earlier turn does not enable it", () => {
  const g = shrBoard({ res: rage(6) });
  lever(g, "drain-opp");
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(influence(g.engine, P2), 29);
  play(g.engine, P1, g.id("sg"));
  assert.equal(pending(g.engine), undefined);
  assert.equal(influence(g.engine, P2), 29);
});

clause(SHRIEVER, "1:rule", "battle damage to their faction earlier in the turn counts as the faction losing influence", () => {
  const g = shrBoard({
    extra: [{ key: "att", def: plain("Attacker", { strength: 3, life: 5 }), owner: P1, zone: "play" }]
  });
  declareAttackBy(g.engine, P1, [g.id("att")]);
  declareBlockers(g.engine, P2, []);
  finishBattle(g.engine);
  assert.equal(influence(g.engine, P2), 27, "setup: the unblocked attack hurt their faction");
  play(g.engine, P1, g.id("sg"));
  assert.equal(pending(g.engine)?.kind, "mayPay", "the lost influence enables it");
  answerPending(g.engine, "mayPay", { pay: true });
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("foe")] });
  assert.equal(influence(g.engine, P2), 25);
  assert.equal(damageOn(g.engine, g.id("foe")), 2);
});

clause(SHRIEVER, "1:rule", "only when THIS card enters play: with a Shriever General in play after an influence loss, another character entering offers nothing", () => {
  const g = shrBoard({ extra: [{ key: "van", def: plain("Van", { cost: 0 }), owner: P1, zone: "hand" }] });
  lever(g, "drain-opp");
  play(g.engine, P1, g.id("sg"));
  drain(g.engine, shrAnswer(g, false));
  play(g.engine, P1, g.id("van"));
  assert.equal(pending(g.engine), undefined);
});

// ============================================================================================================
// Silencer -- character, warlord, mercenary, cost 2, threshold [R], 3 str / 2 spd / 2 life
// This card cannot be blocked by characters with a token on them.
// If a character enters play under your opponent's control, you may pay 1. If you do, put a token on it.
// ============================================================================================================
const SIL = "71422ede-b7b7-4d1c-b176-a0bb7d9a8b30";

function silBoard(cards: CardPlacement[], active: PlayerId = P1): Game {
  return mk(cards, { active, turn: active === P1 ? 2 : 3 });
}

clause(SIL, "0:rule", "printed as a 3/2/2 warlord mercenary character costing 2 with [R]; deploys with exactly 2 Rage", () => {
  const p = printing(SIL);
  assert.deepEqual([p.type, p.cost, p.threshold, p.strength, p.speed, p.life], ["character", 2, "r", 3, 2, 2]);
  assert.deepEqual([...p.subtype], ["mercenary"]);
  assert.equal(p.trade, "warlord");
  const make = (res: CardPlacement[]) => silBoard([{ key: "sil", def: p, owner: P1, zone: "hand" }, ...res]);
  const ok = make(rage(2));
  play(ok.engine, P1, ok.id("sil"));
  assert.equal(zoneOf(ok.engine, ok.id("sil")), "play");
  assert.equal(readyCount(ok.engine, P1), 0, "paid exactly 2");
  const one = make(rage(1));
  refused(() => play(one.engine, P1, one.id("sil")), "one short");
  const g2 = make(greed(3));
  refused(() => play(g2.engine, P1, g2.id("sil")), "no [R] icon");
  const g3 = make([...rage(1), ...greed(1)]);
  play(g3.engine, P1, g3.id("sil"));
  assert.equal(zoneOf(g3.engine, g3.id("sil")), "play", "control: one Rage meets the threshold");
});

const silAttack = (p2: CardPlacement[], p1: CardPlacement[] = []): Game => {
  const g = silBoard([{ key: "sil", def: printing(SIL), owner: P1, zone: "play" }, ...p1, ...p2]);
  declareAttackBy(g.engine, P1, [g.id("sil"), ...p1.filter((c) => c.key === "ally").map((c) => g.id(c.key))]);
  return g;
};
const tokened = (key: string, n = 1, owner: PlayerId = P2): CardPlacement => ({ key, def: plain(key), owner, zone: "play", counters: { token: n } });

clause(SIL, "0:rule", "a character with a token on it cannot block this card; one without can", () => {
  const g = silAttack([tokened("tok"), { key: "clean", def: plain("Clean"), owner: P2, zone: "play" }]);
  refused(() => declareBlockers(g.engine, P2, [g.id("tok")]), "tokened blocker");
  declareBlockers(g.engine, P2, [g.id("clean")]);
  assert.equal(pending(g.engine), undefined);
  assert.ok(g.engine.state.battle, "the clean block stood");
});

clause(SIL, "0:rule", "any number of tokens (2) still stops the block; other counter types do not", () => {
  const g = silAttack([tokened("tok2", 2), { key: "oth", def: plain("Oth"), owner: P2, zone: "play", counters: { other: 1 } }]);
  refused(() => declareBlockers(g.engine, P2, [g.id("tok2")]), "two tokens");
  declareBlockers(g.engine, P2, [g.id("oth")]);
  assert.equal(pending(g.engine), undefined);
  assert.ok(g.engine.state.battle, "the block stood");
});

clause(SIL, "0:rule", "the restriction is only about blocking Silencer: a tokened character may block another attacker", () => {
  const g = silBoard([
    { key: "sil", def: printing(SIL), owner: P1, zone: "play" },
    { key: "ally", def: plain("Ally"), owner: P1, zone: "play" },
    tokened("tok")
  ]);
  declareAttackBy(g.engine, P1, [g.id("ally")]);
  declareBlockers(g.engine, P2, [g.id("tok")]);
  assert.equal(pending(g.engine), undefined);
  assert.ok(g.engine.state.battle, "the block stood");
});

clause(SIL, "0:rule", "a tokened character cannot block a party that contains Silencer", () => {
  const g = silAttack([tokened("tok"), { key: "clean", def: plain("Clean"), owner: P2, zone: "play" }], [{ key: "ally", def: plain("Ally"), owner: P1, zone: "play" }]);
  refused(() => declareBlockers(g.engine, P2, [g.id("tok")]), "tokened blocker vs party with Silencer");
  declareBlockers(g.engine, P2, [g.id("clean")]);
});

clause(SIL, "1:rule", "an opponent's character entering play: I may pay 1 and, if I do, it gets a token", () => {
  const g = silBoard([{ key: "sil", def: printing(SIL), owner: P1, zone: "play" }, ...rage(2), newChar("nc", P2)], P2);
  play(g.engine, P2, g.id("nc"));
  const pc = pending(g.engine);
  assert.ok(pc, "I am offered the payment");
  assert.equal(pc!.kind, "mayPay");
  assert.equal(pc!.playerId, P1);
  assert.equal(tokensOn(g.engine, g.id("nc")), 0, "no token before I decide");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(pending(g.engine), undefined);
  assert.equal(tokensOn(g.engine, g.id("nc")), 1);
  assert.equal(readyCount(g.engine, P1), 1, "exactly 1 paid");
  assert.equal(zoneOf(g.engine, g.id("nc")), "play");
});

clause(SIL, "1:rule", "declining the payment leaves the character untagged and costs nothing", () => {
  const g = silBoard([{ key: "sil", def: printing(SIL), owner: P1, zone: "play" }, ...rage(2), newChar("nc", P2)], P2);
  play(g.engine, P2, g.id("nc"));
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(pending(g.engine), undefined);
  assert.equal(tokensOn(g.engine, g.id("nc")), 0);
  assert.equal(readyCount(g.engine, P1), 2);
});

clause(SIL, "1:rule", "with nothing I can pay (only spent resources) the character gets no token", () => {
  const g = silBoard([{ key: "sil", def: printing(SIL), owner: P1, zone: "play" }, ...spent(rage(2)), newChar("nc", P2)], P2);
  play(g.engine, P2, g.id("nc"));
  if (pending(g.engine)) drain(g.engine, declineAll);
  assert.equal(tokensOn(g.engine, g.id("nc")), 0);
  assert.equal(pending(g.engine), undefined);
});

clause(SIL, "1:rule", "my own characters entering do not trigger it", () => {
  const g = silBoard([{ key: "sil", def: printing(SIL), owner: P1, zone: "play" }, ...rage(2), newChar("mine", P1)]);
  play(g.engine, P1, g.id("mine"));
  assert.equal(pending(g.engine), undefined, "my own character: no prompt");
  assert.equal(tokensOn(g.engine, g.id("mine")), 0);
});

clause(SIL, "1:rule", "an item or a location entering under the opponent's control is not a character: no payment prompt, no token", () => {
  for (const [key, def] of [["thing", item({ name: "Thing", cost: 0, text: "plain" })], ["place", location({ name: "Place", cost: 0, text: "plain" })]] as const) {
    const g = silBoard([{ key: "sil", def: printing(SIL), owner: P1, zone: "play" }, ...rage(2), { key, def, owner: P2, zone: "hand" }], P2);
    play(g.engine, P2, g.id(key));
    assert.equal(pending(g.engine), undefined, `${key} is not a character`);
    assert.equal(tokensOn(g.engine, g.id(key)), 0);
  }
});

clause(SIL, "1:rule", "'your opponent' is relative to Silencer's controller: with the opponent's Silencer, my entering character is tagged for them", () => {
  const g = silBoard([{ key: "sil", def: printing(SIL), owner: P2, zone: "play" }, ...rage(2, P2), newChar("nc", P1)]);
  play(g.engine, P1, g.id("nc"));
  const pc = pending(g.engine);
  assert.ok(pc, "the Silencer's controller is offered the payment");
  assert.equal(pc!.playerId, P2);
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(tokensOn(g.engine, g.id("nc")), 1);
});

clause(SIL, "1:rule", "only while Silencer is in play: from hand it triggers nothing", () => {
  const g = silBoard([{ key: "sil", def: printing(SIL), owner: P1, zone: "hand" }, ...rage(2), newChar("nc", P2)], P2);
  play(g.engine, P2, g.id("nc"));
  assert.equal(pending(g.engine), undefined);
  assert.equal(tokensOn(g.engine, g.id("nc")), 0);
});

clause(SIL, "1:rule", "a character I tagged cannot then block Silencer (both clauses together)", () => {
  const g = silBoard([{ key: "sil", def: printing(SIL), owner: P1, zone: "play" }, ...rage(2), newChar("nc", P2)], P2);
  play(g.engine, P2, g.id("nc"));
  answerPending(g.engine, "mayPay", { pay: true });
  endTurn(g.engine, P2);
  declareAttackBy(g.engine, P1, [g.id("sil")]);
  refused(() => declareBlockers(g.engine, P2, [g.id("nc")]), "tagged character cannot block");
});

// ============================================================================================================
// Silent Succubus -- character, arcanist, demon, cost 4, threshold [O][O], 6 str / 1 spd / 6 life
// When you deploy a tactic, destroy this card.
// ============================================================================================================
const SUCC = "3c4a11e2-1a55-4610-9167-1738ae2418a2";

function succBoard(o: { zone?: "hand" | "play"; res?: CardPlacement[]; extra?: CardPlacement[]; active?: PlayerId } = {}): Game {
  return mk(
    [
      { key: "su", def: printing(SUCC), owner: P1, zone: o.zone ?? "play" },
      { key: "foe", def: plain("Foe"), owner: P2, zone: "play" },
      { key: "slay", def: KILL_CHAR, owner: P1, zone: "hand" },
      ...(o.res ?? []),
      ...(o.extra ?? [])
    ],
    { active: o.active }
  );
}

clause(SUCC, "0:rule", "printed card: an arcanist demon character, cost 4, threshold [O][O], 6 strength / 1 speed / 6 life; deploys for exactly 4", () => {
  const def = printing(SUCC);
  assert.equal(def.type, "character");
  assert.equal(def.trade, "arcanist");
  assert.deepEqual([...def.subtype], ["demon"]);
  assert.equal(def.cost, 4);
  assert.equal(def.threshold, "oo");
  assert.deepEqual([def.strength, def.speed, def.life], [6, 1, 6]);
  const g = succBoard({ zone: "hand", res: [...obs(2), ...rage(3)] });
  play(g.engine, P1, g.id("su"));
  assert.equal(zoneOf(g.engine, g.id("su")), "play");
  assert.equal(readyCount(g.engine, P1), 1, "exactly 4 paid");
  assert.deepEqual([stat(g, "su", "strength"), stat(g, "su", "speed"), stat(g, "su", "life")], [6, 1, 6]);
  const short = succBoard({ zone: "hand", res: [...obs(2), ...rage(1)] });
  refused(() => play(short.engine, P1, short.id("su")), "3 resources for cost 4");
  assert.equal(zoneOf(short.engine, short.id("su")), "hand");
  const oneO = succBoard({ zone: "hand", res: [...obs(1), ...rage(4)] });
  refused(() => play(oneO.engine, P1, oneO.id("su")), "only one [O]");
  assert.equal(zoneOf(oneO.engine, oneO.id("su")), "hand");
});

clause(SUCC, "0:rule", "when I deploy a tactic the Succubus is destroyed (it goes to my discard pile) and the tactic still does its job", () => {
  const g = succBoard();
  play(g.engine, P1, g.id("slay"), { selected: { t: [g.id("foe")] } });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("su")), "discard", "destroyed");
  assert.ok(discardOf(g.engine, P1).includes(g.id("su")), "discardOf(g.engine, P1).includes(su)");
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard", "the tactic resolved");
});

clause(SUCC, "0:rule", "it is a trigger on the deploy: a no-effect tactic destroys it too", () => {
  const g = succBoard({ extra: [{ key: "t", def: NOOP("Free"), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("t"));
  assert.equal(zoneOf(g.engine, g.id("su")), "discard");
});

clause(SUCC, "0:rule", "deploying a character, an item or a location does not destroy it", () => {
  const g = succBoard({
    extra: [
      { key: "van", def: plain("Van", { cost: 0 }), owner: P1, zone: "hand" },
      { key: "gear", def: item({ name: "Gear", cost: 0 }), owner: P1, zone: "hand" },
      { key: "place", def: location({ name: "Place", cost: 0 }), owner: P1, zone: "hand" }
    ]
  });
  for (const k of ["van", "gear", "place"]) {
    play(g.engine, P1, g.id(k));
    assert.equal(zoneOf(g.engine, g.id(k)), "play", `${k} deployed`);
    assert.equal(zoneOf(g.engine, g.id("su")), "play", `still alive after ${k}`);
  }
});

clause(SUCC, "0:rule", "only a tactic of MINE: when the opponent deploys a tactic my Succubus stays", () => {
  const g = succBoard({
    active: P2,
    extra: [{ key: "ot", def: NOOP("Their Free"), owner: P2, zone: "hand" }]
  });
  play(g.engine, P2, g.id("ot"));
  assert.equal(zoneOf(g.engine, g.id("su")), "play");
  assert.equal(pending(g.engine), undefined);
});

clause(SUCC, "0:rule", "'you' is its controller: with the opponent controlling my Succubus, THEIR tactic destroys it and mine does not", () => {
  const g = mk(
    [
      { key: "su", def: printing(SUCC), owner: P1, controller: P2, zone: "play" },
      { key: "ot", def: NOOP("Their Free"), owner: P2, zone: "hand" },
      { key: "mt", def: NOOP("My Free"), owner: P1, zone: "hand" }
    ],
    { active: P1 }
  );
  play(g.engine, P1, g.id("mt"));
  assert.equal(zoneOf(g.engine, g.id("su")), "play", "my tactic does not trigger a Succubus I don't control");
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  play(g.engine, P2, g.id("ot"));
  assert.equal(zoneOf(g.engine, g.id("su")), "discard", "its controller deployed a tactic");
});

clause(SUCC, "0:rule", "only while the Succubus is in play: with it in hand, deploying a tactic does nothing to it", () => {
  const g = succBoard({ zone: "hand", extra: [{ key: "t", def: NOOP("Free"), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("t"));
  assert.equal(zoneOf(g.engine, g.id("su")), "hand");
});

clause(SUCC, "0:rule", "two Succubi are each destroyed by one tactic", () => {
  const g = succBoard({ extra: [{ key: "su2", def: printing(SUCC), owner: P1, zone: "play" }, { key: "t", def: NOOP("Free"), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("t"));
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("su")), "discard");
  assert.equal(zoneOf(g.engine, g.id("su2")), "discard");
});

clause(SUCC, "0:rule", "flipping a tactic up is deploying it (CR 507.4a): the Succubus is destroyed", () => {
  const g = succBoard({
    extra: [
      { key: "dm", def: printing(MONKEY), owner: P1, zone: "play", faceDown: true },
      ...obs(1),
      ...fillers("oh", 1, P2, "hand")
    ]
  });
  flipUp(g.engine, P1, g.id("dm"));
  if (pending(g.engine)) drain(g.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [g.id("oh0")] } : declineAll(pc)));
  assert.equal(zoneOf(g.engine, g.id("dm")), "discard", "setup: the Monkey flipped and resolved");
  assert.equal(zoneOf(g.engine, g.id("su")), "discard");
});

// ============================================================================================================
// Siluriformes Incarnate -- character, banker, siluriformes/seraphim/dragon, cost 7, threshold [G][G][G],
// 6 str / 3 spd / 6 life
// UNIQUE SILURIFORMES
// When this card enters play, set your influence to your faction's starting influence.
// INCARNATE: [G][G][G][G] -- COST: Pay 1. -- EFFECT: This turn, this card cannot be picked by tactics or abilities.
// ============================================================================================================
const SILU = "c22da748-842e-4938-9cb8-0d3fe8e3306d";

/** A faction whose starting influence is `n` (the board's default is 30). */
const factionWith = (n: number): CardDefinition => {
  const base = developFaction();
  return developFaction({ faction: { ...base.faction!, startingInfluence: n } });
};
/** An item whose activated ability picks one character and damages it (a picking ABILITY, not a tactic). */
const POKER = item({
  name: "Poker",
  cost: 0,
  behavior: {
    abilities: [{ id: "poke", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }] }]
  }
} as never);
/** A tactic that destroys every character (picks nothing). */
const SWEEP = tactic({
  name: "Sweep",
  cost: 0,
  behavior: { abilities: [{ id: "sweep", type: "activated", effects: [{ type: "forEach", selector: { zone: "play", type: "character" }, effects: [{ type: "destroy", target: { type: "selected", id: "__candidate" } }] }] }] }
} as never);

function siluBoard(o: { zone?: "hand" | "play"; res?: CardPlacement[]; extra?: CardPlacement[]; start?: number; influence?: number; oppInfluence?: number; active?: PlayerId } = {}): Game {
  const g = mk(
    [
      { key: "sl", def: printing(SILU), owner: P1, zone: o.zone ?? "play" },
      { key: "mine", def: plain("Mine"), owner: P1, zone: "play" },
      { key: "foe", def: plain("Foe"), owner: P2, zone: "play" },
      ...(o.res ?? []),
      ...(o.extra ?? [])
    ],
    { faction: factionWith(o.start ?? 22), active: o.active }
  );
  if (o.influence !== undefined) g.engine.state.players[P1].influence = o.influence;
  if (o.oppInfluence !== undefined) g.engine.state.players[P2].influence = o.oppInfluence;
  return g;
}

clause(SILU, "0:unique", "printed card: a banker siluriformes/seraphim/dragon character, cost 7, threshold [G][G][G], 6 strength / 3 speed / 6 life; deploys for exactly 7", () => {
  const def = printing(SILU);
  assert.equal(def.type, "character");
  assert.equal(def.trade, "banker");
  assert.deepEqual([...def.subtype], ["siluriformes", "seraphim", "dragon"]);
  assert.equal(def.cost, 7);
  assert.equal(def.threshold, "ggg");
  assert.deepEqual([def.strength, def.speed, def.life], [6, 3, 6]);
  assert.equal(def.unique, "siluriformes");
  const g = siluBoard({ zone: "hand", res: [...greed(3), ...rage(5)] });
  play(g.engine, P1, g.id("sl"));
  assert.equal(zoneOf(g.engine, g.id("sl")), "play");
  assert.equal(readyCount(g.engine, P1), 1, "exactly 7 paid");
  assert.deepEqual([stat(g, "sl", "strength"), stat(g, "sl", "speed"), stat(g, "sl", "life")], [6, 3, 6]);
  const short = siluBoard({ zone: "hand", res: [...greed(3), ...rage(3)] });
  refused(() => play(short.engine, P1, short.id("sl")), "6 resources for cost 7");
  assert.equal(zoneOf(short.engine, short.id("sl")), "hand");
  const twoG = siluBoard({ zone: "hand", res: [...greed(2), ...rage(6)] });
  refused(() => play(twoG.engine, P1, twoG.id("sl")), "only two [G]");
  assert.equal(zoneOf(twoG.engine, twoG.id("sl")), "hand");
});

clause(SILU, "0:unique", "UNIQUE SILURIFORMES: deploying a second one forces me to keep just one", () => {
  const g = siluBoard({ extra: [{ key: "sl2", def: printing(SILU), owner: P1, zone: "hand" }, ...greed(3), ...rage(4)] });
  play(g.engine, P1, g.id("sl2"));
  let saw = false;
  drain(g.engine, (pc) => {
    if (pc.kind === "uniqueSurvivor") {
      saw = true;
      assert.equal(pc.unique, "siluriformes");
      assert.deepEqual([...(pc.candidates as string[])].sort(), [g.id("sl"), g.id("sl2")].sort());
      return { kind: "uniqueSurvivor", keep: g.id("sl") };
    }
    return declineAll(pc);
  });
  assert.ok(saw, "a survivor choice was raised");
  assert.equal(zoneOf(g.engine, g.id("sl")), "play");
  assert.equal(zoneOf(g.engine, g.id("sl2")), "discard");
});

clause(SILU, "0:unique", "UNIQUE is per player: the opponent may have their own Siluriformes Incarnate", () => {
  const g = siluBoard({ extra: [{ key: "sl2", def: printing(SILU), owner: P2, zone: "play" }, { key: "van", def: plain("Van", { cost: 0 }), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("van"));
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("sl")), "play");
  assert.equal(zoneOf(g.engine, g.id("sl2")), "play");
});

const deploySilu = (g: Game) => {
  play(g.engine, P1, g.id("sl"));
  if (pending(g.engine)) drain(g.engine, declineAll);
};

clause(SILU, "1:rule", "entering play sets my influence UP to my faction's starting influence (10 -> 22)", () => {
  const g = siluBoard({ zone: "hand", res: [...greed(3), ...rage(4)], influence: 10 });
  deploySilu(g);
  assert.equal(zoneOf(g.engine, g.id("sl")), "play");
  assert.equal(influence(g.engine, P1), 22);
});

clause(SILU, "1:rule", "it sets my influence DOWN to the starting influence too (40 -> 22)", () => {
  const g = siluBoard({ zone: "hand", res: [...greed(3), ...rage(4)], influence: 40 });
  deploySilu(g);
  assert.equal(influence(g.engine, P1), 22);
});

clause(SILU, "1:rule", "already at the starting influence nothing changes; the number is MY faction's, whatever the opponent's faction starts at", () => {
  const g = siluBoard({ zone: "hand", res: [...greed(3), ...rage(4)], influence: 22 });
  deploySilu(g);
  assert.equal(influence(g.engine, P1), 22);
  const other = siluBoard({ zone: "hand", res: [...greed(3), ...rage(4)], start: 17, influence: 5 });
  deploySilu(other);
  assert.equal(influence(other.engine, P1), 17, "a faction that starts at 17");
});

clause(SILU, "1:rule", "only MY influence is set: the opponent's influence is untouched", () => {
  const g = siluBoard({ zone: "hand", res: [...greed(3), ...rage(4)], influence: 10, oppInfluence: 7 });
  deploySilu(g);
  assert.equal(influence(g.engine, P1), 22);
  assert.equal(influence(g.engine, P2), 7);
});

clause(SILU, "1:rule", "only when THIS card enters play: with it in play, another character entering leaves my influence alone", () => {
  const g = siluBoard({ extra: [{ key: "van", def: plain("Van", { cost: 0 }), owner: P1, zone: "hand" }], influence: 10 });
  play(g.engine, P1, g.id("van"));
  assert.equal(influence(g.engine, P1), 10);
});

clause(SILU, "2:ability:incarnate", "INCARNATE needs [G][G][G][G] (four [G] icons) and costs exactly 1: four Greed, one paid, three left", () => {
  const g = siluBoard({ res: greed(4) });
  assert.equal(readyCount(g.engine, P1), 4);
  activate(g.engine, P1, g.id("sl"), "incarnate");
  assert.equal(readyCount(g.engine, P1), 3, "exactly 1 paid");
  const three = siluBoard({ res: [...greed(3), ...rage(3)] });
  refused(() => activate(three.engine, P1, three.id("sl"), "incarnate"), "only three [G]");
  assert.equal(readyCount(three.engine, P1), 6, "nothing paid");
});

clause(SILU, "2:ability:incarnate", "the [G][G][G][G] threshold may be met by spent Greed, with another resource paying the 1; but with nothing ready it is refused", () => {
  const ok = siluBoard({ res: [...spent(greed(4)), ...rage(1)] });
  activate(ok.engine, P1, ok.id("sl"), "incarnate");
  assert.equal(readyCount(ok.engine, P1), 0, "the Rage paid the 1");
  const none = siluBoard({ res: spent(greed(4)) });
  refused(() => activate(none.engine, P1, none.id("sl"), "incarnate"), "nothing ready to pay 1");
});

clause(SILU, "2:ability:incarnate", "before INCARNATE the Siluriformes can be picked by a tactic and by an ability", () => {
  const byTactic = siluBoard({ res: greed(4), extra: [{ key: "slay", def: KILL_CHAR, owner: P1, zone: "hand" }] });
  play(byTactic.engine, P1, byTactic.id("slay"), { selected: { t: [byTactic.id("sl")] } });
  assert.equal(zoneOf(byTactic.engine, byTactic.id("sl")), "discard");
  const byAbility = siluBoard({ res: greed(4), extra: [{ key: "poker", def: POKER, owner: P1, zone: "play" }] });
  activate(byAbility.engine, P1, byAbility.id("poker"), "poke", { selected: { t: [byAbility.id("sl")] } });
  assert.equal(damageOn(byAbility.engine, byAbility.id("sl")), 1);
});

clause(SILU, "2:ability:incarnate", "this turn it cannot be picked by a tactic (mine) or by an ability; other characters still can (control)", () => {
  const g = siluBoard({
    res: greed(4),
    extra: [{ key: "slay", def: KILL_CHAR, owner: P1, zone: "hand" }, { key: "poker", def: POKER, owner: P1, zone: "play" }]
  });
  activate(g.engine, P1, g.id("sl"), "incarnate");
  refused(() => play(g.engine, P1, g.id("slay"), { selected: { t: [g.id("sl")] } }), "a tactic picking it");
  assert.equal(zoneOf(g.engine, g.id("sl")), "play");
  assert.equal(zoneOf(g.engine, g.id("slay")), "hand", "the refused tactic stays in hand");
  refused(() => activate(g.engine, P1, g.id("poker"), "poke", { selected: { t: [g.id("sl")] } }), "an ability picking it");
  assert.equal(damageOn(g.engine, g.id("sl")), 0);
  activate(g.engine, P1, g.id("poker"), "poke", { selected: { t: [g.id("mine")] } });
  assert.equal(damageOn(g.engine, g.id("mine")), 1, "control: another character can be picked");
  play(g.engine, P1, g.id("slay"), { selected: { t: [g.id("foe")] } });
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard", "control: and a tactic can pick an opposing character");
});

clause(SILU, "2:ability:incarnate", "protection from the opponent's pick: on their own turn their tactic cannot pick it after INCARNATE, but can before", () => {
  const board = (): Game =>
    mk(
      [
        { key: "sl", def: printing(SILU), owner: P1, zone: "play" },
        { key: "foe", def: plain("Foe"), owner: P2, zone: "play" },
        { key: "oslay", def: tactic({ ...KILL_CHAR, name: "Their Slay", id: "their-slay-2" }), owner: P2, zone: "hand" },
        ...greed(4)
      ],
      { faction: factionWith(22), active: P1 }
    );
  const g = board();
  activate(g.engine, P1, g.id("sl"), "incarnate");
  declareAttackOpenWindow(g.engine, P1, [g.id("sl")]);
  refused(() => play(g.engine, P2, g.id("oslay"), { selected: { t: [g.id("sl")] } }), "the opponent's tactic picking it in response");
  assert.equal(zoneOf(g.engine, g.id("sl")), "play");
  const before = board();
  declareAttackOpenWindow(before.engine, P1, [before.id("sl")]);
  play(before.engine, P2, before.id("oslay"), { selected: { t: [before.id("sl")] } });
  assert.equal(zoneOf(before.engine, before.id("sl")), "discard", "control: without INCARNATE the opponent's tactic can pick it");
});

clause(SILU, "2:ability:incarnate", "it only stops PICKING: a tactic that destroys every character still destroys it", () => {
  const g = siluBoard({ res: greed(4), extra: [{ key: "sweep", def: SWEEP, owner: P1, zone: "hand" }] });
  activate(g.engine, P1, g.id("sl"), "incarnate");
  play(g.engine, P1, g.id("sweep"));
  assert.equal(zoneOf(g.engine, g.id("sl")), "discard", "not picked, so not protected");
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard");
});

clause(SILU, "2:ability:incarnate", "'this turn': on the opponent's turn it can be picked again", () => {
  const g = mk(
    [
      { key: "sl", def: printing(SILU), owner: P1, zone: "play" },
      { key: "oslay", def: tactic({ ...KILL_CHAR, name: "Their Slay", id: "their-slay-3" }), owner: P2, zone: "hand" },
      ...greed(4)
    ],
    { faction: factionWith(22) }
  );
  activate(g.engine, P1, g.id("sl"), "incarnate");
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  play(g.engine, P2, g.id("oslay"), { selected: { t: [g.id("sl")] } });
  assert.equal(zoneOf(g.engine, g.id("sl")), "discard", "the protection ended with my turn");
});

// ============================================================================================================
// Sixsmith's Disciple -- character, gearsmith, dragon/assistant, cost 3, threshold [E][E], 2 str / 3 spd / 3 life
// When this card enters play, you may pick an item in your discard pile. If you do, put the item into your hand.
// ============================================================================================================
const SIX = "699c47f8-12f7-4c0c-a4fd-193f0320a760";

function sixBoard(o: { zone?: "hand" | "play"; res?: CardPlacement[]; extra?: CardPlacement[]; noItems?: boolean } = {}): Game {
  return mk([
    { key: "sd", def: printing(SIX), owner: P1, zone: o.zone ?? "hand" },
    ...(o.noItems ? [] : [{ key: "i1", def: item({ name: "Dead Item One" }), owner: P1, zone: "discard" as const }, { key: "i2", def: item({ name: "Dead Item Two" }), owner: P1, zone: "discard" as const }]),
    { key: "ch", def: plain("Dead Char"), owner: P1, zone: "discard" },
    { key: "tc", def: NOOP("Dead Spell"), owner: P1, zone: "discard" },
    { key: "lc", def: location({ name: "Dead Place" }), owner: P1, zone: "discard" },
    { key: "oi", def: item({ name: "Their Dead Item" }), owner: P2, zone: "discard" },
    ...(o.res ?? elit(3)),
    ...(o.extra ?? [])
  ]);
}

clause(SIX, "0:rule", "printed card: a gearsmith dragon/assistant character, cost 3, threshold [E][E], 2 strength / 3 speed / 3 life; deploys for exactly 3", () => {
  const def = printing(SIX);
  assert.equal(def.type, "character");
  assert.equal(def.trade, "gearsmith");
  assert.deepEqual([...def.subtype], ["dragon", "assistant"]);
  assert.equal(def.cost, 3);
  assert.equal(def.threshold, "ee");
  assert.deepEqual([def.strength, def.speed, def.life], [2, 3, 3]);
  const g = sixBoard({ res: [...elit(2), ...rage(2)] });
  play(g.engine, P1, g.id("sd"));
  if (pending(g.engine)) drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("sd")), "play");
  assert.equal(readyCount(g.engine, P1), 1, "exactly 3 paid");
  assert.deepEqual([stat(g, "sd", "strength"), stat(g, "sd", "speed"), stat(g, "sd", "life")], [2, 3, 3]);
  const short = sixBoard({ res: elit(2) });
  refused(() => play(short.engine, P1, short.id("sd")), "2 resources for cost 3");
  assert.equal(zoneOf(short.engine, short.id("sd")), "hand");
  const oneE = sixBoard({ res: [...elit(1), ...rage(3)] });
  refused(() => play(oneE.engine, P1, oneE.id("sd")), "only one [E]");
  assert.equal(zoneOf(oneE.engine, oneE.id("sd")), "hand");
});

clause(SIX, "0:rule", "entering play lets me pick an item in my discard pile: it goes into my hand, the other item stays", () => {
  const g = sixBoard();
  play(g.engine, P1, g.id("sd"));
  const pc = pending(g.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("i2")] });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("i2")), "hand");
  assert.ok(handOf(g.engine, P1).includes(g.id("i2")), "handOf(g.engine, P1).includes(i2)");
  assert.equal(zoneOf(g.engine, g.id("i1")), "discard", "the other item stays");
  assert.equal(zoneOf(g.engine, g.id("ch")), "discard");
  assert.equal(zoneOf(g.engine, g.id("sd")), "play");
});

clause(SIX, "0:rule", "it is a 'may': picking nothing leaves both items in the discard pile", () => {
  const g = sixBoard();
  play(g.engine, P1, g.id("sd"));
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("i1")), "discard");
  assert.equal(zoneOf(g.engine, g.id("i2")), "discard");
  assert.equal(zoneOf(g.engine, g.id("sd")), "play");
});

clause(SIX, "0:rule", "the pick must be an ITEM in MY discard pile: a character, a tactic, a location and the opponent's item are refused (control: my item works)", () => {
  for (const bad of ["ch", "tc", "lc", "oi"]) {
    const g = sixBoard();
    play(g.engine, P1, g.id("sd"));
    refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(bad)] }), `picking ${bad}`);
    assert.equal(zoneOf(g.engine, g.id(bad)), "discard", `${bad} did not move`);
    answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("i1")] });
    assert.equal(zoneOf(g.engine, g.id("i1")), "hand", "control");
  }
});

clause(SIX, "0:rule", "I pick ONE item: picking both is refused", () => {
  const g = sixBoard();
  play(g.engine, P1, g.id("sd"));
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("i1"), g.id("i2")] }), "two items");
  assert.equal(zoneOf(g.engine, g.id("i1")), "discard");
  assert.equal(zoneOf(g.engine, g.id("i2")), "discard");
});

clause(SIX, "0:rule", "with no item in my discard pile nothing is asked and nothing hangs", () => {
  const g = sixBoard({ noItems: true });
  play(g.engine, P1, g.id("sd"));
  if (pending(g.engine)) drain(g.engine, declineAll);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("sd")), "play");
  assert.equal(handOf(g.engine, P1).length, 0);
});

clause(SIX, "0:rule", "only when THIS card enters play: with a Disciple in play another character entering returns nothing", () => {
  const g = sixBoard({ zone: "play", extra: [{ key: "van", def: plain("Van", { cost: 0 }), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("van"));
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("i1")), "discard");
});

clause(BLADE, "2:rule", "flipping a tactic up is deploying it (CR 507.4a): the Blade in my discard pile is offered then too", () => {
  const g = bladeBoard({
    zone: "discard",
    extra: [{ key: "dm", def: printing(MONKEY), owner: P1, zone: "play", faceDown: true }, ...obs(1), ...fillers("oh", 1, P2, "hand")]
  });
  flipUp(g.engine, P1, g.id("dm"));
  let offered = false;
  drain(g.engine, (pc) => {
    if (pc.kind === "chooserSelectsTarget" && pc.playerId === P1) {
      offered = true;
      return { kind: "chooserSelectsTarget", selected: [g.id("a")] };
    }
    if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [g.id("oh0")] };
    return declineAll(pc);
  });
  assert.equal(zoneOf(g.engine, g.id("dm")), "discard", "setup: the Monkey flipped up and resolved");
  assert.ok(offered, "the Blade was offered");
  assert.equal(zoneOf(g.engine, g.id("bl")), "play");
  assert.equal(bladeHost(g), g.id("a"));
});
