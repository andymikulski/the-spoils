// Clause tests: ungodly-mess-08, part p1 (groups 1-4, missing clauses only).
// Wary Reunion, Arcane Ambush, Quilt of Old Banners, Soulsearcher.

import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId } from "../../../engine.js";
import { buildGame, activate, bank, character, developFaction, item, location, play, tactic, volition, P1, P2 } from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, printing, refused, flipUpNow } from "./_clause.js";
import { declareAttackBy, declareAttackOpenWindow } from "./_battle.js";
import { answerPending, declareBlockers, pending, zoneOf } from "./_board.js";
import { endTurn, readyCount } from "./_turn.js";

type Game = ReturnType<typeof buildGame>;

/** Marks already-attached (spent) resources. */
const spent = (ps: CardPlacement[], owner: PlayerId = P1): CardPlacement[] =>
  ps.map((p) => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

// ============================================================================
// Wary Reunion -- tactic, rogue, cost 1, threshold [D][D]
// EXTRA COST: Pick a character. -- Remove the character from the game if it has X life or less,
// where X is the number of different trades you control. -- FLIP UP: 2 [D]
// ============================================================================
const WARY = "a6c17ded-973a-4bc4-b458-179f5e1c723e";

const ch = (name: string, trade: CardDefinition["trade"], life = 5) => character({ name, trade, life });
/** P1 controls rogue x2 + warlord characters, plus universal staple banks => distinct trades {rogue, warlord, universal} = 3. */
const waryMine = (): CardPlacement[] => [
  { key: "r1", def: ch("R1", "rogue"), owner: P1, zone: "play" },
  { key: "r2", def: ch("R2", "rogue"), owner: P1, zone: "play" },
  { key: "w1", def: ch("W1", "warlord"), owner: P1, zone: "play" }
];
const waryRes = (): CardPlacement[] => [...bank("deception", 2, P1), ...bank("rage", 1, P1)];

function waryGame(
  o: {
    life?: number;
    damage?: number;
    mine?: CardPlacement[];
    res?: CardPlacement[];
    theirs?: CardPlacement[];
    faction?: CardDefinition;
    fd?: boolean;
    tgtTrade?: CardDefinition["trade"];
  } = {}
): Game {
  return buildGame({
    playerA: { faction: o.faction ?? developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "wr", def: printing(WARY), owner: P1, zone: o.fd ? "play" : "hand", faceDown: o.fd },
      ...(o.mine ?? waryMine()),
      ...(o.res ?? waryRes()),
      ...(o.theirs ?? []),
      { key: "tgt", def: character({ name: "Tgt", trade: o.tgtTrade ?? "banker", life: o.life ?? 3 }), owner: P2, zone: "play", damage: o.damage }
    ]
  });
}
const castWary = (g: Game, pick = "tgt") => play(g.engine, P1, g.id("wr"), { selected: { c: [g.id(pick)] } });
const flipWary = (g: Game, pick?: string) =>
  flipUpNow(g.engine, { type: "flipUp", playerId: P1, cardId: g.id("wr"), selected: pick ? { c: [g.id(pick)] } : {}, variables: {} });

clause(WARY, "0:extraCost", "printed card: a rogue tactic costing 1 with [D][D]; deploys with exactly 1 resource while meeting [D][D] and pays only 1", () => {
  const def = printing(WARY);
  assert.equal(def.type, "tactic");
  assert.equal(def.trade, "rogue");
  assert.deepEqual(def.subtype ?? [], []);
  assert.equal(def.cost, 1);
  assert.equal(def.threshold, "dd");
  const g = waryGame();
  const before = readyCount(g.engine, P1);
  assert.equal(before, 3);
  castWary(g);
  assert.equal(readyCount(g.engine, P1), before - 1, "exactly 1 resource is paid");
  assert.equal(zoneOf(g.engine, g.id("wr")), "discard", "the tactic goes to the discard pile once resolved");
});

clause(WARY, "0:extraCost", "cost 1 is isolated from the [D][D] threshold: two SPENT [D] meet the threshold but cannot pay; one ready resource pays", () => {
  const none = waryGame({ res: spent(bank("deception", 2, P1)) });
  refused(() => castWary(none), "threshold met by spent [D][D] but nothing ready to pay the cost 1", /Costs cannot be paid/);
  assert.equal(zoneOf(none.engine, none.id("wr")), "hand");
  const one = waryGame({ res: [...spent(bank("deception", 2, P1)), ...bank("rage", 1, P1)] });
  castWary(one);
  assert.equal(zoneOf(one.engine, one.id("tgt")), "removed", "cost 1 paid by the ready rage resource, [D][D] counted from the spent icons");
  assert.equal(readyCount(one.engine, P1), 0);
});

clause(WARY, "0:extraCost", "needs the [D][D] threshold: one [D] icon (with plenty of other resources) is refused; two [D] works", () => {
  const short = waryGame({ res: [...bank("deception", 1, P1), ...bank("rage", 5, P1)] });
  refused(() => castWary(short), "only one [D] icon for a [D][D] card");
  assert.equal(zoneOf(short.engine, short.id("wr")), "hand");
  assert.equal(zoneOf(short.engine, short.id("tgt")), "play");
  const ok = waryGame({ res: [...bank("deception", 2, P1), ...bank("rage", 5, P1)] });
  castWary(ok);
  assert.equal(zoneOf(ok.engine, ok.id("tgt")), "removed");
});

clause(WARY, "0:extraCost", "needs at least 1 resource even with the threshold met only by spent icons, and no resources at all is refused", () => {
  const g = waryGame({ res: [] });
  refused(() => castWary(g), "no resources");
});

clause(WARY, "0:extraCost", "EXTRA COST: a character must be picked -- no pick is refused, and a non-character (item / faction) pick is refused", () => {
  const g = waryGame({ theirs: [{ key: "it", def: item({ name: "It" }), owner: P2, zone: "play" }] });
  refused(() => play(g.engine, P1, g.id("wr"), { selected: {} }), "no character picked");
  refused(() => play(g.engine, P1, g.id("wr"), { selected: { c: [g.id("it")] } }), "an item is not a character");
  refused(() => play(g.engine, P1, g.id("wr"), { selected: { c: [g.engine.state.players[P2].factionId!] } }), "a faction is not a character");
  assert.equal(zoneOf(g.engine, g.id("wr")), "hand", "nothing was cast");
  castWary(g);
  assert.equal(zoneOf(g.engine, g.id("tgt")), "removed", "positive control: a character pick works");
});

clause(WARY, "0:extraCost", "any character can be picked: your own character as well as an opponent's", () => {
  const g = waryGame({ mine: [{ key: "mine", def: ch("Mine", "rogue", 1), owner: P1, zone: "play" }] });
  castWary(g, "mine");
  assert.equal(zoneOf(g.engine, g.id("mine")), "removed", "own life-1 character (X = rogue + universal = 2) is removed");
  assert.equal(zoneOf(g.engine, g.id("tgt")), "play", "the opponent's character was not picked");
});

clause(WARY, "1:rule", "removes the picked character from the game when its life <= X (X = 3 here: rogue, warlord, universal); a higher life stays", () => {
  for (const life of [1, 2, 3]) {
    const g = waryGame({ life });
    castWary(g);
    assert.equal(g.engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(g.engine, g.id("tgt")), "removed", `life ${life} <= 3 is removed from the game (not discarded)`);
    assert.ok(!g.engine.state.players[P2].discard.includes(g.id("tgt")), "!g.engine.state.players[P2].discard.includes(g.id(\"tgt\"))");
  }
  for (const life of [4, 5, 9]) {
    const g = waryGame({ life });
    castWary(g);
    assert.equal(g.engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(g.engine, g.id("tgt")), "play", `life ${life} > 3 stays in play`);
    assert.equal(zoneOf(g.engine, g.id("wr")), "discard", "the tactic is still spent");
  }
});

clause(WARY, "1:rule", "X is the number of DIFFERENT trades: two rogues count once, so three rogues + universal banks give X = 2", () => {
  const mine = [
    { key: "r1", def: ch("R1", "rogue"), owner: P1, zone: "play" as const },
    { key: "r2", def: ch("R2", "rogue"), owner: P1, zone: "play" as const },
    { key: "r3", def: ch("R3", "rogue"), owner: P1, zone: "play" as const }
  ];
  const two = waryGame({ mine, life: 2 });
  castWary(two);
  assert.equal(zoneOf(two.engine, two.id("tgt")), "removed", "life 2 <= X=2");
  const three = waryGame({ mine, life: 3 });
  castWary(three);
  assert.equal(zoneOf(three.engine, three.id("tgt")), "play", "life 3 > X=2 (duplicates are not counted)");
});

clause(WARY, "1:rule", "X changes with the board: only universal banks and one warlord gives X = 2 (life 2 removed, life 3 stays)", () => {
  const mine = [{ key: "w1", def: ch("W1", "warlord"), owner: P1, zone: "play" as const }];
  const hit = waryGame({ mine, life: 2 });
  castWary(hit);
  assert.equal(zoneOf(hit.engine, hit.id("tgt")), "removed");
  const miss = waryGame({ mine, life: 3 });
  castWary(miss);
  assert.equal(zoneOf(miss.engine, miss.id("tgt")), "play");
});

clause(WARY, "1:rule", "X counts only trades YOU control: opponent's banker / arcanist / gearsmith / warlord cards and the picked card add nothing", () => {
  const theirs: CardPlacement[] = [
    { key: "t-ban", def: ch("TBan", "banker"), owner: P2, zone: "play" },
    { key: "t-arc", def: ch("TArc", "arcanist"), owner: P2, zone: "play" },
    { key: "t-gear", def: ch("TGear", "gearsmith"), owner: P2, zone: "play" },
    { key: "t-war", def: ch("TWar", "warlord"), owner: P2, zone: "play" },
    { key: "t-item", def: item({ name: "TItem", trade: "gearsmith" }), owner: P2, zone: "play" }
  ];
  const mine = [{ key: "r1", def: ch("R1", "rogue"), owner: P1, zone: "play" as const }];
  const stay = waryGame({ mine, theirs, life: 3, tgtTrade: "arcanist" });
  castWary(stay);
  assert.equal(zoneOf(stay.engine, stay.id("tgt")), "play", "X = rogue + universal = 2, so life 3 stays despite 5 opposing trades");
  const go = waryGame({ mine, theirs, life: 2 });
  castWary(go);
  assert.equal(zoneOf(go.engine, go.id("tgt")), "removed");
});

clause(WARY, "1:rule", "X counts the trades of all your cards in play (items too), not cards in your hand or deck", () => {
  const mine: CardPlacement[] = [
    { key: "r1", def: ch("R1", "rogue"), owner: P1, zone: "play" },
    { key: "h-arc", def: ch("HArc", "arcanist"), owner: P1, zone: "hand" },
    { key: "d-gear", def: ch("DGear", "gearsmith"), owner: P1, zone: "deck" },
    { key: "disc-ban", def: ch("DiscBan", "banker"), owner: P1, zone: "discard" }
  ];
  const noItem = waryGame({ mine, life: 3 });
  castWary(noItem);
  assert.equal(zoneOf(noItem.engine, noItem.id("tgt")), "play", "rogue + universal = 2 (hand / deck / discard cards do not count)");
  const withItem = waryGame({ mine: [...mine, { key: "it", def: item({ name: "ItemB", trade: "banker" }), owner: P1, zone: "play" }], life: 3 });
  castWary(withItem);
  assert.equal(zoneOf(withItem.engine, withItem.id("tgt")), "removed", "a banker item adds a third trade");
});

clause(WARY, "1:rule", "your faction card is not one of the trades counted (CR 202.9: factions are excluded from a selector that does not name them)", () => {
  const faction = developFaction({ trade: "gearsmith" });
  const mine = [{ key: "r1", def: ch("R1", "rogue"), owner: P1, zone: "play" as const }];
  const g = waryGame({ faction, mine, life: 3 });
  castWary(g);
  assert.equal(zoneOf(g.engine, g.id("tgt")), "play", "X = rogue + universal = 2, a gearsmith faction would make it 3");
  const g2 = waryGame({ faction, mine, life: 2 });
  castWary(g2);
  assert.equal(zoneOf(g2.engine, g2.id("tgt")), "removed");
});

clause(WARY, "1:rule", "'has X life or less' compares the character's current life stat: damage does not lower it", () => {
  const g = waryGame({ life: 4, damage: 2 });
  castWary(g);
  assert.equal(zoneOf(g.engine, g.id("tgt")), "play", "life 4 (2 damage on it) is still 4 life");
  const h = waryGame({ life: 3, damage: 2 });
  castWary(h);
  assert.equal(zoneOf(h.engine, h.id("tgt")), "removed", "life 3 with 2 damage is life 3 <= 3");
});

clause(WARY, "1:rule", "only the picked character is affected", () => {
  const g = waryGame({ theirs: [{ key: "other", def: ch("Other", "banker", 1), owner: P2, zone: "play" }] });
  castWary(g);
  assert.equal(zoneOf(g.engine, g.id("tgt")), "removed");
  assert.equal(zoneOf(g.engine, g.id("other")), "play");
  assert.equal(zoneOf(g.engine, g.id("r1")), "play");
});

clause(WARY, "2:flipUp", "FLIP UP 2 [D]: pays the cost (itself plus one [D] bank) and flips up, resolving the removal on the picked character", () => {
  const g = waryGame({ fd: true, res: bank("deception", 1, P1), life: 2 });
  assert.equal(readyCount(g.engine, P1), 2, "the face-down card is a resource itself");
  flipWary(g, "tgt");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("tgt")), "removed", "life 2 <= X (rogue, warlord, universal = 3)");
  assert.equal(zoneOf(g.engine, g.id("wr")), "discard");
  assert.equal(readyCount(g.engine, P1), 0, "both resources paid: exactly 2");
});

clause(WARY, "2:flipUp", "FLIP UP pays exactly 2 (not the 1 of a normal cast): with 2 extra banks, flipping consumes the card itself plus the 2 paid (itself may be one of them)", () => {
  const g = waryGame({ fd: true, res: [...bank("deception", 1, P1), ...bank("rage", 2, P1)], life: 2 });
  assert.equal(readyCount(g.engine, P1), 4);
  flipWary(g, "tgt");
  const after = readyCount(g.engine, P1);
  assert.ok(after === 2 || after === 1, `4 resources, cost 2, the card leaves the pool: ${after} left (2 if it paid for itself, 1 if two banks paid)`);
  const attachedBanks = g.engine.state.players[P1].play.filter((cid) => g.engine.isResource(cid) && g.engine.state.cards[cid].attachedTo).length;
  assert.equal(attachedBanks, after === 2 ? 1 : 2, "the amount paid is exactly 2 in total");
});

clause(WARY, "2:flipUp", "FLIP UP the removal still honours X: a life-4 character stays when X = 3", () => {
  const g = waryGame({ fd: true, res: bank("deception", 1, P1), life: 4 });
  flipWary(g, "tgt");
  assert.equal(zoneOf(g.engine, g.id("tgt")), "play");
  assert.equal(zoneOf(g.engine, g.id("wr")), "discard");
});

clause(WARY, "2:flipUp", "FLIP UP is refused one resource short (itself alone), and short of the [D] threshold (its own volition does not count)", () => {
  const alone = waryGame({ fd: true, res: [] });
  refused(() => flipWary(alone, "tgt"), "only the face-down card itself = 1 resource, cost 2");
  assert.equal(alone.engine.state.cards[alone.id("wr")].faceDown, true);
  const noIcon = waryGame({ fd: true, res: bank("rage", 2, P1) });
  refused(() => flipWary(noIcon, "tgt"), "3 resources but no [D] icon");
  assert.equal(noIcon.engine.state.cards[noIcon.id("wr")].faceDown, true);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("tgt")), "play");
  const ok = waryGame({ fd: true, res: bank("deception", 1, P1) });
  flipWary(ok, "tgt");
  assert.equal(ok.engine.state.cards[ok.id("wr")].faceDown, false, "positive control");
});

clause(WARY, "2:flipUp", "FLIP UP cost is 2 even when the [D] threshold is met by a spent icon: itself alone (1 ready) is refused", () => {
  const g = waryGame({ fd: true, res: spent(bank("deception", 1, P1)), life: 2 });
  assert.equal(readyCount(g.engine, P1), 1);
  refused(() => flipWary(g, "tgt"), "cost 2 with only 1 ready resource");
  assert.equal(g.engine.state.cards[g.id("wr")].faceDown, true);
  assert.equal(zoneOf(g.engine, g.id("tgt")), "play");
});

clause(WARY, "2:flipUp", "FLIP UP threshold [D] counts a SPENT [D] bank while a ready rage bank plus itself pays the cost", () => {
  const g = waryGame({ fd: true, res: [...spent(bank("deception", 1, P1)), ...bank("rage", 1, P1)], life: 2 });
  flipWary(g, "tgt");
  assert.equal(zoneOf(g.engine, g.id("tgt")), "removed");
});

clause(WARY, "2:flipUp", "FLIP UP still needs the EXTRA COST pick: refused with no pick or with a non-character", () => {
  const g = waryGame({ fd: true, res: bank("deception", 1, P1), theirs: [{ key: "it", def: item({ name: "It" }), owner: P2, zone: "play" }] });
  refused(() => flipWary(g), "no character picked");
  refused(() => flipWary(g, "it"), "item picked");
  assert.equal(g.engine.state.cards[g.id("wr")].faceDown, true);
  flipWary(g, "tgt");
  assert.equal(zoneOf(g.engine, g.id("tgt")), "removed");
});

clause(WARY, "2:flipUp", "a tactic's FLIP UP is allowed inside an opponent's response window (it is a tactic)", () => {
  const g = waryGame({
    fd: true,
    res: bank("deception", 1, P1),
    life: 2,
    theirs: [{ key: "foe", def: ch("Foe", "banker"), owner: P2, zone: "play" }]
  });
  g.engine.state.activePlayerId = P2;
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  flipWary(g, "tgt");
  assert.equal(zoneOf(g.engine, g.id("tgt")), "removed");
});

// ============================================================================
// Arcane Ambush -- tactic, universal, cost 6, threshold [V][V][V][V]
// EXTRA COST: Play this only during your turn. Pick a faction. -- Destroy all items and locations.
// If you control cards with 'JO', 'EUSTACE', 'PLUCK', 'RUDOLPHUS', and 'IGNATIOUS', inflict 15
// damage to the faction and each character that faction's controller controls. -- FLIP UP: 6 [O][G][E][D][R]
// ============================================================================
const AMBUSH = "da838cc5-e3ac-4b39-b017-41f3bff5ec1b";
const DESIG = ["jo", "eustace", "pluck", "rudolphus", "ignatious"] as const;

const dChar = (d: string, owner: PlayerId = P1, controller?: PlayerId): CardPlacement => ({
  key: `u_${d}_${owner}`,
  def: character({ name: d.toUpperCase(), life: 20, unique: d }),
  owner,
  controller,
  zone: "play"
});

function ambushGame(
  o: {
    have?: readonly string[];
    res?: CardPlacement[];
    fd?: boolean;
    extra?: CardPlacement[];
    active?: PlayerId;
  } = {}
): Game {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: o.active ?? P1,
    turn: (o.active ?? P1) === P1 ? 1 : 2,
    cards: [
      { key: "amb", def: printing(AMBUSH), owner: P1, zone: o.fd ? "play" : "hand", faceDown: o.fd },
      ...(o.res ?? [...volition(4, P1), ...bank("rage", 2, P1)]),
      ...(o.have ?? DESIG).map((d) => dChar(d)),
      { key: "p1c", def: character({ name: "P1C", life: 20 }), owner: P1, zone: "play" },
      { key: "p2c", def: character({ name: "P2C", life: 20 }), owner: P2, zone: "play" },
      { key: "p2d", def: character({ name: "P2D", life: 15 }), owner: P2, zone: "play" },
      { key: "p2e", def: character({ name: "P2E", life: 16 }), owner: P2, zone: "play" },
      { key: "p2own1", def: character({ name: "P2Own1", life: 20 }), owner: P2, controller: P1, zone: "play" },
      { key: "p1own2", def: character({ name: "P1Own2", life: 20 }), owner: P1, controller: P2, zone: "play" },
      { key: "i1", def: item({ name: "I1" }), owner: P1, zone: "play" },
      { key: "i2", def: item({ name: "I2" }), owner: P2, zone: "play" },
      { key: "l1", def: location({ name: "L1" }), owner: P1, zone: "play" },
      { key: "l2", def: location({ name: "L2" }), owner: P2, zone: "play" },
      { key: "ih", def: item({ name: "IH" }), owner: P1, zone: "hand" },
      ...(o.extra ?? [])
    ]
  });
}
const fac = (g: Game, p: PlayerId) => g.engine.state.players[p].factionId!;
const castAmbush = (g: Game, p: PlayerId = P2) => play(g.engine, P1, g.id("amb"), { selected: { f: [fac(g, p)] } });
const flipAmbush = (g: Game, p: PlayerId = P2) =>
  flipUpNow(g.engine, { type: "flipUp", playerId: P1, cardId: g.id("amb"), selected: { f: [fac(g, p)] }, variables: {} });
const dmg = (g: Game, key: string) => g.engine.state.cards[g.id(key)].damage ?? 0;
const ALL_KEYS = ["p1c", "p2c", "p2e", "p2own1", "p1own2", ...DESIG.map((d) => `u_${d}_${P1}`)];

function assertItemsAndLocationsGone(g: Game) {
  for (const k of ["i1", "i2", "l1", "l2"]) assert.equal(zoneOf(g.engine, g.id(k)), "discard", `${k} destroyed`);
  assert.equal(zoneOf(g.engine, g.id("ih")), "hand", "an item in hand is not in play");
  for (const k of ["p1c", "p2c", "p2e", "p2own1", "p1own2"]) assert.equal(zoneOf(g.engine, g.id(k)), "play", `${k} (a character) is not destroyed`);
}

clause(AMBUSH, "0:extraCost", "printed card: a universal tactic costing 6 with [V][V][V][V]; deploys with exactly 4 face-down + 2 other resources and pays 6", () => {
  const def = printing(AMBUSH);
  assert.equal(def.type, "tactic");
  assert.equal(def.trade, "universal");
  assert.equal(def.cost, 6);
  assert.equal(def.threshold, "vvvv");
  const g = ambushGame();
  assert.equal(readyCount(g.engine, P1), 6);
  castAmbush(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(readyCount(g.engine, P1), 0, "all 6 resources paid");
  assert.equal(zoneOf(g.engine, g.id("amb")), "discard");
});

clause(AMBUSH, "0:extraCost", "is refused one resource short (4 face-down + 1 rage) and short of [V][V][V][V] (3 face-down + 3 rage)", () => {
  const cost = ambushGame({ res: [...volition(4, P1), ...bank("rage", 1, P1)] });
  refused(() => castAmbush(cost), "5 resources, cost 6");
  assert.equal(zoneOf(cost.engine, cost.id("amb")), "hand");
  assert.equal(zoneOf(cost.engine, cost.id("i1")), "play");
  const thr = ambushGame({ res: [...volition(3, P1), ...bank("rage", 3, P1)] });
  refused(() => castAmbush(thr), "6 resources but only three [V]");
  assert.equal(zoneOf(thr.engine, thr.id("amb")), "hand");
  assert.equal(zoneOf(thr.engine, thr.id("i2")), "play");
});

clause(AMBUSH, "0:extraCost", "EXTRA COST: a faction must be picked -- no pick or a character pick is refused; either player's faction is allowed", () => {
  const g = ambushGame();
  refused(() => play(g.engine, P1, g.id("amb"), { selected: {} }), "no faction picked");
  refused(() => play(g.engine, P1, g.id("amb"), { selected: { f: [g.id("p2c")] } }), "a character is not a faction");
  assert.equal(zoneOf(g.engine, g.id("amb")), "hand");
  castAmbush(g, P2);
  assert.equal(zoneOf(g.engine, g.id("amb")), "discard", "P2's faction accepted");
  const own = ambushGame();
  castAmbush(own, P1);
  assert.equal(zoneOf(own.engine, own.id("amb")), "discard", "own faction accepted");
});

clause(AMBUSH, "0:extraCost", "Play this only during your turn: refused in the opponent's turn (response window), allowed in your own", () => {
  const extra = (): CardPlacement[] => [{ key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" }, { key: "ctl", def: tactic({ name: "Ctl", cost: 0 }), owner: P1, zone: "hand" }];
  const ctl = ambushGame({ active: P2, extra: extra() });
  declareAttackOpenWindow(ctl.engine, P2, [ctl.id("foe")]);
  play(ctl.engine, P1, ctl.id("ctl"), {});
  assert.equal(zoneOf(ctl.engine, ctl.id("ctl")), "discard", "positive control: another tactic can be played in this window");
  const g = ambushGame({ active: P2, extra: extra() });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  refused(() => castAmbush(g), "not my turn", /cannot be deployed/i);
  assert.equal(zoneOf(g.engine, g.id("amb")), "hand");
  assert.equal(zoneOf(g.engine, g.id("i1")), "play");
  assert.equal(readyCount(g.engine, P1), 6, "nothing was paid");
  const mine = ambushGame();
  castAmbush(mine);
  assert.equal(zoneOf(mine.engine, mine.id("amb")), "discard");
});

clause(AMBUSH, "1:rule", "destroys every item and location (both players'), but not characters, resources, items in hand or the factions", () => {
  const g = ambushGame({ have: [] });
  const infl = [g.engine.state.players[P1].influence, g.engine.state.players[P2].influence];
  castAmbush(g);
  assertItemsAndLocationsGone(g);
  for (const k of ALL_KEYS.filter((x) => !x.startsWith("u_"))) assert.equal(dmg(g, k), 0, `${k}: no damage without the five designations`);
  assert.deepEqual([g.engine.state.players[P1].influence, g.engine.state.players[P2].influence], infl);
  assert.equal(g.engine.state.players[P1].play.filter((id) => g.engine.isResource(id)).length, 6, "resources untouched");
});

clause(AMBUSH, "1:rule", "with all five designations (JO, EUSTACE, PLUCK, RUDOLPHUS, IGNATIOUS): 15 damage to the picked faction and to the characters it controls", () => {
  const g = ambushGame();
  const before = g.engine.state.players[P2].influence;
  const mine = g.engine.state.players[P1].influence;
  castAmbush(g, P2);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assertItemsAndLocationsGone(g);
  assert.equal(g.engine.state.players[P2].influence, before - 15, "15 damage to the picked faction");
  assert.equal(g.engine.state.players[P1].influence, mine, "my faction untouched");
  assert.equal(dmg(g, "p2c"), 15);
  assert.equal(dmg(g, "p2e"), 15);
  assert.equal(zoneOf(g.engine, g.id("p2e")), "play", "life 16 survives 15 damage");
  assert.equal(dmg(g, "p1own2"), 15, "a P1-owned card P2 controls takes it");
  assert.equal(zoneOf(g.engine, g.id("p2d")), "discard", "life 15 dies to 15 damage");
});

clause(AMBUSH, "1:rule", "15 damage goes only to characters the picked faction's controller controls (P2's faction picked: my characters are untouched)", () => {
  const g = ambushGame();
  castAmbush(g, P2);
  for (const k of ["p1c", "p2own1", ...DESIG.map((d) => `u_${d}_${P1}`)]) assert.equal(dmg(g, k), 0, `${k}: not controlled by the picked faction's controller`);
});

clause(AMBUSH, "1:rule", "picking my own faction: my faction takes 15 and my characters (including a P2-owned card I control) are damaged", () => {
  const g = ambushGame();
  const mine = g.engine.state.players[P1].influence;
  const theirs = g.engine.state.players[P2].influence;
  castAmbush(g, P1);
  assert.equal(g.engine.state.players[P1].influence, mine - 15);
  assert.equal(g.engine.state.players[P2].influence, theirs);
  for (const k of ["p1c", "p2own1", ...DESIG.map((d) => `u_${d}_${P1}`)]) assert.equal(dmg(g, k), 15, `${k} damaged`);
  assertItemsAndLocationsGone(g);
});

clause(AMBUSH, "1:rule", "picking my own faction: the opponent's characters (and the card of mine that P2 controls) are not damaged", () => {
  const g = ambushGame();
  castAmbush(g, P1);
  for (const k of ["p2c", "p2e", "p1own2"]) assert.equal(dmg(g, k), 0, `${k} not damaged`);
  assert.equal(zoneOf(g.engine, g.id("p2d")), "play", "P2's life-15 character is not hit");
});

clause(AMBUSH, "1:rule", "all five designations are required: missing any single one gives no damage (items and locations still destroyed)", () => {
  for (const missing of DESIG) {
    const g = ambushGame({ have: DESIG.filter((d) => d !== missing) });
    const before = g.engine.state.players[P2].influence;
    castAmbush(g);
    assertItemsAndLocationsGone(g);
    assert.equal(g.engine.state.players[P2].influence, before, `without ${missing}: no faction damage`);
    for (const k of ["p2c", "p2e", "p1own2"]) assert.equal(dmg(g, k), 0, `without ${missing}: ${k} undamaged`);
    assert.equal(zoneOf(g.engine, g.id("p2d")), "play");
  }
});

clause(AMBUSH, "1:rule", "a second card with the same designation does not substitute for a missing one", () => {
  const g = ambushGame({ have: ["jo", "eustace", "pluck", "rudolphus"], extra: [{ ...dChar("jo"), key: "jo2", def: character({ name: "Jo2", life: 20, unique: "jo" }) }] });
  const before = g.engine.state.players[P2].influence;
  castAmbush(g);
  assert.equal(g.engine.state.players[P2].influence, before);
  assert.equal(dmg(g, "p2c"), 0);
});

clause(AMBUSH, "1:rule", "'cards you control': an opponent-controlled designation does not count, a card I own-but-they-control does not count, and one I control but do not own does", () => {
  const four = ["jo", "eustace", "pluck", "rudolphus"];
  const theirs = ambushGame({ have: four, extra: [dChar("ignatious", P2)] });
  const b1 = theirs.engine.state.players[P2].influence;
  castAmbush(theirs);
  assert.equal(theirs.engine.state.players[P2].influence, b1, "P2 controls IGNATIOUS: not mine");
  assert.equal(dmg(theirs, "p2c"), 0);
  const stolenAway = ambushGame({ have: four, extra: [dChar("ignatious", P1, P2)] });
  const b2 = stolenAway.engine.state.players[P2].influence;
  castAmbush(stolenAway);
  assert.equal(stolenAway.engine.state.players[P2].influence, b2, "I own IGNATIOUS but P2 controls it");
  const borrowed = ambushGame({ have: four, extra: [dChar("ignatious", P2, P1)] });
  const b3 = borrowed.engine.state.players[P2].influence;
  castAmbush(borrowed);
  assert.equal(borrowed.engine.state.players[P2].influence, b3 - 15, "P2 owns IGNATIOUS but I control it");
});

clause(AMBUSH, "1:rule", "for EACH of the five designations, holding it only under the opponent's control (while I control the other four) gives no damage", () => {
  for (const d of DESIG) {
    const g = ambushGame({ have: DESIG.filter((x) => x !== d), extra: [dChar(d, P2)] });
    const before = g.engine.state.players[P2].influence;
    castAmbush(g);
    assert.equal(g.engine.state.players[P2].influence, before, `${d} controlled by P2`);
    assert.equal(dmg(g, "p2c"), 0, `${d} controlled by P2`);
  }
});

clause(AMBUSH, "1:rule", "designations only count on cards in play: one in hand gives no damage", () => {
  const g = ambushGame({ have: ["jo", "eustace", "pluck", "rudolphus"], extra: [{ key: "ign-hand", def: character({ name: "IgnH", life: 20, unique: "ignatious" }), owner: P1, zone: "hand" }] });
  const before = g.engine.state.players[P2].influence;
  castAmbush(g);
  assert.equal(g.engine.state.players[P2].influence, before);
});

clause(AMBUSH, "1:rule", "the destruction comes first: a designation on an item or location is destroyed before the 'if you control' check, so no damage", () => {
  const four = ["jo", "eustace", "pluck", "rudolphus"];
  const onItem = ambushGame({ have: four, extra: [{ key: "ign-item", def: item({ name: "IgnItem", unique: "ignatious" }), owner: P1, zone: "play" }] });
  const b1 = onItem.engine.state.players[P2].influence;
  castAmbush(onItem);
  assert.equal(zoneOf(onItem.engine, onItem.id("ign-item")), "discard");
  assert.equal(onItem.engine.state.players[P2].influence, b1, "item with IGNATIOUS was already destroyed");
  const onLoc = ambushGame({ have: four, extra: [{ key: "ign-loc", def: location({ name: "IgnLoc", unique: "ignatious" }), owner: P1, zone: "play" }] });
  const b2 = onLoc.engine.state.players[P2].influence;
  castAmbush(onLoc);
  assert.equal(onLoc.engine.state.players[P2].influence, b2);
});

clause(AMBUSH, "2:flipUp", "FLIP UP 6 [O][G][E][D][R]: itself + five staple banks pay exactly 6, and the effect resolves (items and locations destroyed, 15 damage with the designations)", () => {
  const res = [...bank("obsession", 1, P1), ...bank("greed", 1, P1), ...bank("elitism", 1, P1), ...bank("deception", 1, P1), ...bank("rage", 1, P1)];
  const g = ambushGame({ fd: true, res });
  assert.equal(readyCount(g.engine, P1), 6);
  const before = g.engine.state.players[P2].influence;
  flipAmbush(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(readyCount(g.engine, P1), 0, "exactly 6 paid");
  assertItemsAndLocationsGone(g);
  assert.equal(g.engine.state.players[P2].influence, before - 15);
  assert.equal(zoneOf(g.engine, g.id("amb")), "discard");
});

clause(AMBUSH, "2:flipUp", "FLIP UP is refused one resource short (a SPENT icon meets the threshold but cannot pay) and one icon short (rage missing, 6 resources)", () => {
  const icons = (rageSpent: boolean) => {
    const rage = bank("rage", 1, P1);
    return [...bank("obsession", 1, P1), ...bank("greed", 1, P1), ...bank("elitism", 1, P1), ...bank("deception", 1, P1), ...(rageSpent ? spent(rage) : rage)];
  };
  const costShort = ambushGame({ fd: true, res: icons(true) });
  refused(() => flipAmbush(costShort), "itself + 4 ready banks = 5 < 6 (the spent rage still meets [R])");
  assert.equal(costShort.engine.state.cards[costShort.id("amb")].faceDown, true);
  assert.equal(zoneOf(costShort.engine, costShort.id("i1")), "play");
  const thrShort = ambushGame({ fd: true, res: [...bank("obsession", 1, P1), ...bank("greed", 1, P1), ...bank("elitism", 1, P1), ...bank("deception", 2, P1)] });
  assert.equal(readyCount(thrShort.engine, P1), 6);
  refused(() => flipAmbush(thrShort), "6 resources but no [R] (its own volition does not count)");
  assert.equal(thrShort.engine.state.cards[thrShort.id("amb")].faceDown, true);
  const ok = ambushGame({ fd: true, res: icons(false) });
  flipAmbush(ok);
  assert.equal(zoneOf(ok.engine, ok.id("i1")), "discard", "positive control");
});

clause(AMBUSH, "2:flipUp", "FLIP UP still needs the faction pick and 'only during your turn'", () => {
  const res = [...bank("obsession", 1, P1), ...bank("greed", 1, P1), ...bank("elitism", 1, P1), ...bank("deception", 1, P1), ...bank("rage", 1, P1)];
  const g = ambushGame({ fd: true, res });
  refused(() => flipUpNow(g.engine, { type: "flipUp", playerId: P1, cardId: g.id("amb"), selected: {}, variables: {} }), "no faction picked");
  refused(() => flipUpNow(g.engine, { type: "flipUp", playerId: P1, cardId: g.id("amb"), selected: { f: [g.id("p2c")] }, variables: {} }), "character, not a faction");
  assert.equal(g.engine.state.cards[g.id("amb")].faceDown, true);
  const opp = ambushGame({ fd: true, res, active: P2, extra: [{ key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(opp.engine, P2, [opp.id("foe")]);
  refused(() => flipAmbush(opp), "not my turn", /flipped up/i);
  assert.equal(opp.engine.state.cards[opp.id("amb")].faceDown, true);
  assert.equal(zoneOf(opp.engine, opp.id("i1")), "play");
});

// ============================================================================
// Quilt of Old Banners -- item, universal, banner, cost 0
// UNIQUE QUILT -- When this card enters play and at the start of each of your turns, name a non-[V]
// resource icon. X is that icon. Until the start of your next turn, this card gains "PROVIDES: X".
// HAND IT DOWN -- COST: Pay 1. Shuffle this card into its owner's deck. -- EFFECT: Draw a card.
// ============================================================================
const QUILT = "769df66e-d77d-409e-bb1b-abef698edf54";
const ICONS = ["rage", "greed", "deception", "elitism", "obsession"] as const;

function quiltGame(extra: CardPlacement[] = [], o: { quilt?: "hand" | "play"; active?: PlayerId } = {}): Game {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: o.active ?? P1,
    turn: (o.active ?? P1) === P1 ? 1 : 2,
    cards: [{ key: "q", def: printing(QUILT), owner: P1, zone: o.quilt ?? "hand" }, ...extra]
  });
}
const thr = (g: Game, p: PlayerId = P1) => g.engine.getThresholds(p) as Record<string, number | undefined>;
const iconTotals = (g: Game) => Object.fromEntries(ICONS.map((i) => [i, thr(g)[i] ?? 0]));
const zeroIcons = { rage: 0, greed: 0, deception: 0, elitism: 0, obsession: 0 };

clause(QUILT, "0:unique", "UNIQUE QUILT: a second Quilt I control forces me to choose which one to keep; the other is destroyed", () => {
  const g = quiltGame(
    [
      { key: "q2", def: printing(QUILT), owner: P1, zone: "play" },
      { key: "van", def: character({ name: "Van", cost: 0 }), owner: P1, zone: "hand" }
    ],
    { quilt: "play" }
  );
  play(g.engine, P1, g.id("van"), {});
  const pc = pending(g.engine) as unknown as { kind: string; playerId: string; unique: string; candidates: string[] } | undefined;
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.equal(pc?.playerId, P1);
  assert.deepEqual([...(pc?.candidates ?? [])].sort(), [g.id("q"), g.id("q2")].sort());
  answerPending(g.engine, "uniqueSurvivor", { keep: g.id("q2") });
  assert.equal(zoneOf(g.engine, g.id("q2")), "play");
  assert.equal(zoneOf(g.engine, g.id("q")), "discard");
});

clause(QUILT, "0:unique", "printed card: a universal item (banner) costing 0 with no threshold, deployable with no resources", () => {
  const def = printing(QUILT);
  assert.equal(def.type, "item");
  assert.equal(def.trade, "universal");
  assert.deepEqual(def.subtype, ["banner"]);
  assert.equal(def.cost, 0);
  assert.ok(!def.threshold, "no threshold");
  const g = quiltGame();
  assert.equal(g.engine.getCardPlayability(P1, g.id("q")).playable, true, "deployable with no resources (cost 0)");
});

clause(QUILT, "0:unique", "the identifier is QUILT: any other card I control carrying UNIQUE QUILT conflicts with it, a card with another identifier does not", () => {
  const same = quiltGame(
    [
      { key: "other", def: character({ name: "OtherQuilt", unique: "quilt" }), owner: P1, zone: "play" },
      { key: "van", def: character({ name: "Van", cost: 0 }), owner: P1, zone: "hand" }
    ],
    { quilt: "play" }
  );
  play(same.engine, P1, same.id("van"), {});
  const pc = pending(same.engine) as unknown as { kind: string; unique: string } | undefined;
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.equal(pc?.unique, "quilt");
  const diff = quiltGame(
    [
      { key: "other", def: character({ name: "OtherBanner", unique: "banner" }), owner: P1, zone: "play" },
      { key: "van", def: character({ name: "Van", cost: 0 }), owner: P1, zone: "hand" }
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
      { key: "van", def: character({ name: "Van", cost: 0 }), owner: P1, zone: "hand" }
    ],
    { quilt: "play" }
  );
  play(g.engine, P1, g.id("van"), {});
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("q")), "play");
  assert.equal(zoneOf(g.engine, g.id("q2")), "play");
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

clause(QUILT, "1:rule", "naming each non-[V] icon makes Quilt provide exactly that one icon (X), one of it", () => {
  for (const icon of ICONS) {
    const g = quiltGame();
    play(g.engine, P1, g.id("q"), {});
    answerPending(g.engine, "nameValue", { value: icon });
    assert.equal(g.engine.state.pendingChoice, undefined);
    assert.deepEqual(iconTotals(g), { ...zeroIcons, [icon]: 1 }, `naming ${icon}`);
    assert.equal(thr(g, P2)[icon] ?? 0, 0, "the opponent gets nothing");
  }
});

clause(QUILT, "1:rule", "the icon counts toward thresholds only (CR 311.1): it unlocks a [R] card but adds no resource to pay with", () => {
  const gate = { key: "gate", def: character({ name: "Gate", cost: 0, threshold: "r" }), owner: P1, zone: "hand" as const };
  const g = quiltGame([gate]);
  assert.equal(g.engine.getCardPlayability(P1, g.id("gate")).playable, false, "no [R] before");
  play(g.engine, P1, g.id("q"), {});
  answerPending(g.engine, "nameValue", { value: "rage" });
  assert.equal(g.engine.getCardPlayability(P1, g.id("gate")).playable, true, "[R] met by Quilt's PROVIDES");
  assert.equal(readyCount(g.engine, P1), 0, "it gives no resource to pay with");
  const other = quiltGame([gate]);
  play(other.engine, P1, other.id("q"), {});
  answerPending(other.engine, "nameValue", { value: "greed" });
  assert.equal(other.engine.getCardPlayability(P1, other.id("gate")).playable, false, "naming greed does not give [R]");
});

clause(QUILT, "1:rule", "[V] can't be named (non-[V] icon only): naming volition is refused", () => {
  const g = quiltGame();
  play(g.engine, P1, g.id("q"), {});
  refused(() => answerPending(g.engine, "nameValue", { value: "volition" }), "volition is not allowed", /icon|volition|non/i);
  assert.equal(pending(g.engine)?.kind, "nameValue", "the naming is still open");
  answerPending(g.engine, "nameValue", { value: "rage" });
  assert.equal(thr(g).rage, 1);
  assert.equal(thr(g).volition ?? 0, 0, "no volition from the Quilt");
});

clause(QUILT, "1:rule", "only Quilt itself entering play triggers the naming: another card entering does not", () => {
  const g = quiltGame([{ key: "van", def: character({ name: "Van", cost: 0 }), owner: P1, zone: "hand" }], { quilt: "play" });
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

clause(QUILT, "1:rule", "the turn-start naming is asked of the Quilt's controller, not of the opponent on the opponent's turn", () => {
  const g = quiltGame([], { quilt: "play", active: P2 });
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(pending(g.engine)?.playerId, P1);
  answerPending(g.engine, "nameValue", { value: "elitism" });
  assert.equal(thr(g, P1).elitism, 1);
  assert.equal(thr(g, P2).elitism ?? 0, 0);
});

clause(QUILT, "2:ability:hand-it-down", "HAND IT DOWN: pays 1, shuffles Quilt into its owner's deck, and I draw a card", () => {
  const deck = Array.from({ length: 3 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const }));
  const g = quiltGame([...deck, ...bank("rage", 3, P1)], { quilt: "play" });
  const hand = g.engine.state.players[P1].hand.length;
  const ready = readyCount(g.engine, P1);
  activate(g.engine, P1, g.id("q"), "hand-it-down");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.ok(["deck", "hand"].includes(zoneOf(g.engine, g.id("q"))), "shuffled into the deck (the draw may take it straight back out)");
  assert.notEqual(zoneOf(g.engine, g.id("q")), "play");
  assert.equal(readyCount(g.engine, P1), ready - 1, "pays exactly 1");
  assert.equal(g.engine.state.players[P1].hand.length, hand + 1, "draws a card");
  assert.equal(g.engine.state.players[P1].deck.length, 3, "deck: 3 + Quilt - 1 drawn");
});

clause(QUILT, "2:ability:hand-it-down", "HAND IT DOWN shuffles: the deck is reordered, so the draw is neither the Quilt dropped on top nor the old top card", () => {
  const deck = Array.from({ length: 4 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const }));
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: () => 0,
    cards: [{ key: "q", def: printing(QUILT), owner: P1, zone: "play" }, ...deck, ...bank("rage", 1, P1)]
  });
  const top = g.engine.state.players[P1].deck[0];
  const handBefore = [...g.engine.state.players[P1].hand];
  activate(g.engine, P1, g.id("q"), "hand-it-down");
  const drawn = g.engine.state.players[P1].hand.filter((c) => !handBefore.includes(c));
  assert.equal(drawn.length, 1);
  assert.notEqual(drawn[0], g.id("q"), "the Quilt did not stay on top");
  assert.notEqual(drawn[0], top, "the old top card is not simply drawn: the deck was shuffled");
  assert.equal(zoneOf(g.engine, g.id("q")), "deck");
});

clause(QUILT, "2:ability:hand-it-down", "HAND IT DOWN really puts Quilt into the deck: with no other card in the deck, the draw takes Quilt itself back", () => {
  const g = quiltGame(bank("rage", 1, P1), { quilt: "play" });
  assert.equal(g.engine.state.players[P1].deck.length, 0);
  activate(g.engine, P1, g.id("q"), "hand-it-down");
  assert.equal(zoneOf(g.engine, g.id("q")), "hand", "shuffled into the (empty) deck, then drawn");
  assert.equal(readyCount(g.engine, P1), 0, "Pay 1 was paid");
});

clause(QUILT, "2:ability:hand-it-down", "HAND IT DOWN is refused with no resource to pay, and leaves Quilt in play", () => {
  const g = quiltGame([{ key: "d0", def: character({ name: "D0" }), owner: P1, zone: "deck" }], { quilt: "play" });
  refused(() => activate(g.engine, P1, g.id("q"), "hand-it-down"), "no resource for Pay 1");
  assert.equal(zoneOf(g.engine, g.id("q")), "play");
  const spentOnly = quiltGame([{ key: "d0", def: character({ name: "D0" }), owner: P1, zone: "deck" }, ...spent(bank("rage", 2, P1))], { quilt: "play" });
  refused(() => activate(spentOnly.engine, P1, spentOnly.id("q"), "hand-it-down"), "only spent resources");
  assert.equal(zoneOf(spentOnly.engine, spentOnly.id("q")), "play");
});

clause(QUILT, "2:ability:hand-it-down", "it goes to its OWNER's deck and its controller draws: P2 controls P1's Quilt", () => {
  const p1deck = [{ key: "a0", def: character({ name: "A0" }), owner: P1, zone: "deck" as const }];
  const p2deck = Array.from({ length: 2 }, (_, i) => ({ key: `b${i}`, def: character({ name: `B${i}` }), owner: P2, zone: "deck" as const }));
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [{ key: "q", def: printing(QUILT), owner: P1, controller: P2, zone: "play" }, ...p1deck, ...p2deck, ...bank("rage", 2, P2)]
  });
  const h1 = g.engine.state.players[P1].hand.length;
  const h2 = g.engine.state.players[P2].hand.length;
  activate(g.engine, P2, g.id("q"), "hand-it-down");
  assert.equal(zoneOf(g.engine, g.id("q")), "deck");
  assert.ok(g.engine.state.players[P1].deck.includes(g.id("q")), "in its owner's (P1's) deck");
  assert.ok(!g.engine.state.players[P2].deck.includes(g.id("q")), "!g.engine.state.players[P2].deck.includes(g.id(\"q\"))");
  assert.equal(g.engine.state.players[P2].hand.length, h2 + 1, "the controller draws");
  assert.equal(g.engine.state.players[P1].hand.length, h1, "the owner draws nothing");
});

// ============================================================================
// Soulsearcher -- character, universal, changeling, cost 2, threshold [V], 1 str / 3 spd / 1 life
// [O]: COVERT. [G]: +2 life. [E]: AGGRO. [D]: +1 speed. [R]: +2 strength.
// ============================================================================
const SOUL = "8fef5e5f-e9ba-4738-808e-3f97577664e7";
const ICON_OF = { o: "obsession", g: "greed", e: "elitism", d: "deception", r: "rage" } as const;
type K = keyof typeof ICON_OF;
const KEYS: K[] = ["o", "g", "e", "d", "r"];

function soulGame(res: CardPlacement[], o: { zone?: "play" | "hand" | "discard"; eligible?: boolean; extra?: CardPlacement[] } = {}): Game {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "ss", def: printing(SOUL), owner: P1, zone: o.zone ?? "play", attackEligible: o.eligible }, ...res, ...(o.extra ?? [])]
  });
}
const resOf = (...ks: K[]) => ks.flatMap((k) => bank(ICON_OF[k], 1, P1));
function sheet(g: Game) {
  const kw = g.engine.getKeywords(g.id("ss")).map(String);
  return {
    str: g.engine.getStat(g.id("ss"), "strength"),
    spd: g.engine.getStat(g.id("ss"), "speed"),
    life: g.engine.getStat(g.id("ss"), "life"),
    covert: kw.includes("covert"),
    aggro: kw.includes("aggro")
  };
}
const PRINTED = { str: 1, spd: 3, life: 1, covert: false, aggro: false };
const EXPECT: Record<K, Partial<typeof PRINTED>> = {
  o: { covert: true },
  g: { life: 3 },
  e: { aggro: true },
  d: { spd: 4 },
  r: { str: 3 }
};

clause(SOUL, "0:rule@o", "printed card: a universal changeling character, cost 2, threshold [V], 1 strength / 3 speed / 1 life with no icon bonus", () => {
  const def = printing(SOUL);
  assert.equal(def.type, "character");
  assert.equal(def.trade, "universal");
  assert.deepEqual(def.subtype, ["changeling"]);
  assert.equal(def.cost, 2);
  assert.equal(def.threshold, "v");
  const g = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ss", def: printing(SOUL), owner: P1, zone: "hand" }, ...volition(2, P1)]
  });
  play(g.engine, P1, g.id("ss"), {});
  assert.equal(zoneOf(g.engine, g.id("ss")), "play");
  assert.equal(readyCount(g.engine, P1), 0, "exactly 2 paid");
  assert.deepEqual(sheet(g), PRINTED);
});

clause(SOUL, "0:rule@o", "is refused one resource short (one face-down) and short of [V] (two rage banks)", () => {
  const short = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "ss", def: printing(SOUL), owner: P1, zone: "hand" }, ...volition(1, P1)] });
  refused(() => play(short.engine, P1, short.id("ss"), {}), "1 resource, cost 2");
  assert.equal(zoneOf(short.engine, short.id("ss")), "hand");
  const noV = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "ss", def: printing(SOUL), owner: P1, zone: "hand" }, ...bank("rage", 2, P1)] });
  refused(() => play(noV.engine, P1, noV.id("ss"), {}), "2 resources but no [V]");
  assert.equal(zoneOf(noV.engine, noV.id("ss")), "hand");
});


const withOnly = (k: K): ReturnType<typeof sheet> => ({ ...PRINTED, ...EXPECT[k] });
const withAllBut = (k: K): ReturnType<typeof sheet> => ({ ...PRINTED, ...Object.assign({}, ...KEYS.filter((x) => x !== k).map((x) => EXPECT[x])) });

const soulOnly = (k: K) => () => {
  assert.deepEqual(sheet(soulGame([])), PRINTED, "no icons");
  assert.deepEqual(sheet(soulGame(resOf(k))), withOnly(k), `${ICON_OF[k]} alone`);
};
const soulOthers = (k: K) => () => {
  assert.deepEqual(sheet(soulGame(resOf(...KEYS.filter((x) => x !== k)))), withAllBut(k), `all but ${ICON_OF[k]}`);
  assert.deepEqual(sheet(soulGame(resOf(...KEYS))), { str: 3, spd: 4, life: 3, covert: true, aggro: true }, "all five icons");
};
const soulCount = (k: K) => () => {
  const icon = ICON_OF[k];
  assert.deepEqual(sheet(soulGame(bank(icon, 3, P1))), withOnly(k), "three icons give the bonus once");
  assert.deepEqual(sheet(soulGame(spent(bank(icon, 1, P1)))), withOnly(k), "a spent (attached) icon still meets the threshold");
  assert.deepEqual(sheet(soulGame(bank(icon, 2, P2))), PRINTED, "only the opponent has the icon");
};
const soulZone = () => () => {
  for (const zone of ["hand", "discard"] as const) assert.deepEqual(sheet(soulGame(resOf(...KEYS), { zone })), PRINTED, zone);
  assert.deepEqual(sheet(soulGame(resOf(...KEYS))), { str: 3, spd: 4, life: 3, covert: true, aggro: true }, "positive control: in play");
};
clause(SOUL, "0:rule@o", "[O] (obsession) alone gives exactly its bonus and none of the others; with no icon the card is printed 1/3/1", soulOnly("o"));
clause(SOUL, "0:rule@o", "[O] the other four icons never give the obsession bonus, and all five icons give all five bonuses", soulOthers("o"));
clause(SOUL, "0:rule@o", "[O] the bonus is applied once however many obsession icons I have, counts spent icons, and ignores the opponent's icons", soulCount("o"));
clause(SOUL, "0:rule@o", "[O] the bonus applies only in play: in hand or discard the card has printed stats even with every icon", soulZone());

clause(SOUL, "1:rule@g", "[G] (greed) alone gives exactly its bonus and none of the others; with no icon the card is printed 1/3/1", soulOnly("g"));
clause(SOUL, "1:rule@g", "[G] the other four icons never give the greed bonus, and all five icons give all five bonuses", soulOthers("g"));
clause(SOUL, "1:rule@g", "[G] the bonus is applied once however many greed icons I have, counts spent icons, and ignores the opponent's icons", soulCount("g"));
clause(SOUL, "1:rule@g", "[G] the bonus applies only in play: in hand or discard the card has printed stats even with every icon", soulZone());

clause(SOUL, "2:rule@e", "[E] (elitism) alone gives exactly its bonus and none of the others; with no icon the card is printed 1/3/1", soulOnly("e"));
clause(SOUL, "2:rule@e", "[E] the other four icons never give the elitism bonus, and all five icons give all five bonuses", soulOthers("e"));
clause(SOUL, "2:rule@e", "[E] the bonus is applied once however many elitism icons I have, counts spent icons, and ignores the opponent's icons", soulCount("e"));
clause(SOUL, "2:rule@e", "[E] the bonus applies only in play: in hand or discard the card has printed stats even with every icon", soulZone());

clause(SOUL, "3:rule@d", "[D] (deception) alone gives exactly its bonus and none of the others; with no icon the card is printed 1/3/1", soulOnly("d"));
clause(SOUL, "3:rule@d", "[D] the other four icons never give the deception bonus, and all five icons give all five bonuses", soulOthers("d"));
clause(SOUL, "3:rule@d", "[D] the bonus is applied once however many deception icons I have, counts spent icons, and ignores the opponent's icons", soulCount("d"));
clause(SOUL, "3:rule@d", "[D] the bonus applies only in play: in hand or discard the card has printed stats even with every icon", soulZone());

clause(SOUL, "4:rule@r", "[R] (rage) alone gives exactly its bonus and none of the others; with no icon the card is printed 1/3/1", soulOnly("r"));
clause(SOUL, "4:rule@r", "[R] the other four icons never give the rage bonus, and all five icons give all five bonuses", soulOthers("r"));
clause(SOUL, "4:rule@r", "[R] the bonus is applied once however many rage icons I have, counts spent icons, and ignores the opponent's icons", soulCount("r"));
clause(SOUL, "4:rule@r", "[R] the bonus applies only in play: in hand or discard the card has printed stats even with every icon", soulZone());

clause(SOUL, "0:rule@o", "[O]: the COVERT it gains makes the party unblockable by non-COVERT characters; without [O] the same blocker may block", () => {
  const extra = (): CardPlacement[] => [{ key: "blk", def: character({ name: "Blk", life: 5 }), owner: P2, zone: "play" }];
  const covert = soulGame(resOf("o"), { extra: extra() });
  declareAttackBy(covert.engine, P1, [covert.id("ss")]);
  refused(() => declareBlockers(covert.engine, P2, [covert.id("blk")]), "a non-COVERT blocker cannot block a COVERT attacker", /covert/i);
  const plain = soulGame(resOf("g"), { extra: extra() });
  declareAttackBy(plain.engine, P1, [plain.id("ss")]);
  declareBlockers(plain.engine, P2, [plain.id("blk")]);
  assert.ok(plain.engine.state.battle, "positive control: without [O] the blocker may block");
});

clause(SOUL, "2:rule@e", "[E]: the AGGRO it gains lets it attack the turn it entered; without [E] it can't", () => {
  const aggro = soulGame(resOf("e"), { eligible: false });
  declareAttackBy(aggro.engine, P1, [aggro.id("ss")]);
  assert.ok(aggro.engine.state.battle, "attacks with [E]");
  const none = soulGame(resOf("o", "g", "d", "r"), { eligible: false });
  refused(() => declareAttackBy(none.engine, P1, [none.id("ss")]), "summoning sick without AGGRO", /does not have AGGRO/);
  assert.equal(none.engine.state.battle, undefined);
});

clause(SOUL, "3:rule@d", "[D]: the +1 speed is real battle speed -- exactly 4, a stat other characters with speed 3 do not have", () => {
  const g = soulGame(resOf("d"), { extra: [{ key: "x", def: character({ name: "X", speed: 3 }), owner: P2, zone: "play" }] });
  assert.equal(g.engine.getStat(g.id("ss"), "speed"), 4);
  assert.equal(g.engine.getStat(g.id("x"), "speed"), 3);
});
