import assert from "node:assert/strict";
import type { SpoilsEngine } from "../../SpoilsEngine.js";
import {
  buildGame,
  activate,
  bank,
  character,
  developFaction,
  item,
  killTactic,
  location,
  play,
  resolvePendingResponses,
  tactic,
  volition,
  P1,
  P2
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, printing, refused, flipUpNow } from "./_clause.js";
import { declareAttackBy, declareAttackOpenWindow } from "./_battle.js";
import { answerPending, fillers, pending, zoneOf } from "./_board.js";
import { attachedCount, endTurn, spentResources } from "./_turn.js";

const BOOST = "591002be-11b3-41b6-b406-0f34e7a6695c"; // God's Blessing of Boost
const GOR = "c257a1c0-f7f4-4bfc-a82a-5b63999808d0"; // Gor-blach the Endowed
const FORT = "2585fca5-dea5-4753-a6ca-80c53328ec76"; // Gosche's Restoration Fortress
const VOID = "410f05f6-5595-4aee-bc1a-8cce18ed809c"; // Gosche's Voidal Frequency Emission

type Cards = CardPlacement[];
const ILLEGAL = /Illegal target/;
const TIMING = /current timing/;
const ready = (e: SpoilsEngine, p: string) => e.getAvailableResourceCount(p as never);
const passTurn = (e: SpoilsEngine) => endTurn(e, e.state.activePlayerId as never);
const dmg = (e: SpoilsEngine, id: string) => e.state.cards[id].damage ?? 0;
const tokens = (e: SpoilsEngine, id: string) => e.state.cards[id].counters?.token ?? 0;
const choose = (e: SpoilsEngine, playerId: string, selected: string[]) =>
  e.perform({ type: "resolvePendingChoice", playerId, choice: { kind: "chooserSelectsTarget", selected } } as never);

/* ====================================================================== */
/* God's Blessing of Boost — tactic · warlord · mutation · cost 6 · [R][R][R] */
/* ====================================================================== */
interface BoostOpts {
  rage?: number;
  obs?: number;
  attached?: string;
  turn?: number;
  active?: typeof P1 | typeof P2;
  extra?: Cards;
  lifeAlly?: number;
}
function boostBoard(o: BoostOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn ?? 2,
    activePlayerId: o.active ?? P1,
    cards: [
      o.attached
        ? { key: "bl", def: printing(BOOST), owner: P1, zone: "play", attachedToKey: o.attached }
        : { key: "bl", def: printing(BOOST), owner: P1, zone: "hand" },
      { key: "host", def: character({ name: "Host", strength: 2, life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: o.lifeAlly ?? 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 2, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play" },
      { key: "loc", def: location({ name: "Loc" }), owner: P1, zone: "play" },
      ...bank("rage", o.rage ?? 3, P1),
      ...bank("obsession", o.obs ?? 3, P1),
      ...fillers("d", 3, P1, "deck"),
      ...fillers("e", 3, P2, "deck"),
      ...(o.extra ?? [])
    ]
  });
}
type BB = ReturnType<typeof boostBoard>;
const castBoost = (b: BB, host = "host") => play(b.engine, P1, b.id("bl"), { selected: { attachTo: [b.id(host)] } });
const str = (b: BB, k: string) => b.engine.getStat(b.id(k), "strength");
const smashDef = () =>
  tactic({
    name: "SmashBoost",
    cost: 0,
    behavior: {
      abilities: [{ id: "x", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
    }
  } as never);

clause(BOOST, "0:unique", "is a warlord mutation tactic with printed cost 6, threshold rrr, UNIQUE BLESSING", () => {
  const p = printing(BOOST);
  assert.equal(p.type, "tactic");
  assert.equal(p.trade, "warlord");
  assert.deepEqual(p.subtype, ["mutation"]);
  assert.equal(p.cost, 6);
  assert.equal(p.threshold, "rrr");
  assert.equal((p as unknown as { unique?: string }).unique, "blessing");
});

clause(BOOST, "0:unique", "costs exactly 6: castable with 6 resources, all spent; refused with 5", () => {
  const b = boostBoard();
  castBoost(b);
  assert.equal(attachedCount(b.engine, P1), 6);
  assert.equal(zoneOf(b.engine, b.id("bl")), "play");
  const s = boostBoard({ rage: 3, obs: 2 });
  refused(() => castBoost(s), "cost 6 with 5 resources");
  assert.equal(zoneOf(s.engine, s.id("bl")), "hand");
});

clause(BOOST, "0:unique", "threshold rrr: three rage among the six works, two does not", () => {
  const ok = boostBoard({ rage: 3, obs: 3 });
  castBoost(ok);
  assert.equal(ok.engine.state.cards[ok.id("bl")].attachedTo, ok.id("host"));
  const b = boostBoard({ rage: 2, obs: 4 });
  refused(() => castBoost(b), "rr short of rrr", /Threshold requirements are not met/);
  assert.equal(zoneOf(b.engine, b.id("bl")), "hand");
  const none = boostBoard({ rage: 0, obs: 6 });
  refused(() => castBoost(none), "no r at all");
  const more = boostBoard({ rage: 6, obs: 0 });
  castBoost(more);
  assert.equal(zoneOf(more.engine, more.id("bl")), "play", "six rage also works");
});

const secondBoost: Cards = [
  { key: "bl2", def: printing(BOOST), owner: P1, zone: "hand" },
  { key: "host2", def: character({ name: "Host2", life: 9 }), owner: P1, zone: "play" }
];

clause(BOOST, "0:unique", "you cannot control two BLESSINGs: a second copy forces a choice and the loser is destroyed", () => {
  const b = boostBoard({ attached: "host", extra: secondBoost });
  play(b.engine, P1, b.id("bl2"), { selected: { attachTo: [b.id("host2")] } });
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [b.id("bl"), b.id("bl2")].sort());
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("bl2") } } as never);
  assert.equal(zoneOf(b.engine, b.id("bl2")), "play");
  assert.equal(zoneOf(b.engine, b.id("bl")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(BOOST, "0:unique", "choosing the old Blessing keeps it and destroys the new one", () => {
  const b = boostBoard({ attached: "host", extra: secondBoost });
  play(b.engine, P1, b.id("bl2"), { selected: { attachTo: [b.id("host2")] } });
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("bl") } } as never);
  assert.equal(zoneOf(b.engine, b.id("bl")), "play");
  assert.equal(zoneOf(b.engine, b.id("bl2")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(BOOST, "0:unique", "UNIQUE is per player: the opponent may control their own Blessing; a different unique name is no duplicate", () => {
  const other = boostBoard({
    attached: "host",
    extra: [{ key: "oth", def: item({ name: "OtherUnique", unique: "something else" } as never), owner: P1, zone: "play" }]
  });
  assert.equal(other.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(other.engine, other.id("bl")), "play");
  const b = boostBoard({
    attached: "host",
    turn: 3,
    active: P2,
    extra: [
      { key: "bl2", def: printing(BOOST), owner: P2, zone: "hand" },
      ...bank("rage", 3, P2),
      ...bank("obsession", 3, P2)
    ]
  });
  play(b.engine, P2, b.id("bl2"), { selected: { attachTo: [b.id("foe")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("bl")), "play");
  assert.equal(zoneOf(b.engine, b.id("bl2")), "play");
});

clause(BOOST, "0:unique", "another card with the BLESSING designation counts as a duplicate", () => {
  const b = boostBoard({
    attached: "host",
    extra: [{ key: "fake", def: item({ name: "OtherBlessing", unique: "blessing" } as never), owner: P1, zone: "hand" }]
  });
  play(b.engine, P1, b.id("fake"), {});
  assert.equal(pending(b.engine)?.kind, "uniqueSurvivor");
});

clause(BOOST, "1:attach", "attaches to the chosen own character and stays in play attached (not discarded)", () => {
  const b = boostBoard();
  castBoost(b);
  assert.equal(zoneOf(b.engine, b.id("bl")), "play");
  assert.equal(b.engine.state.cards[b.id("bl")].attachedTo, b.id("host"));
  const c = boostBoard();
  castBoost(c, "ally");
  assert.equal(c.engine.state.cards[c.id("bl")].attachedTo, c.id("ally"), "attaches to the one chosen");
});

clause(BOOST, "1:attach", "may attach to an opponent's character too (ATTACH TO CHARACTER names no controller)", () => {
  const b = boostBoard();
  castBoost(b, "foe");
  assert.equal(b.engine.state.cards[b.id("bl")].attachedTo, b.id("foe"));
  assert.equal(zoneOf(b.engine, b.id("bl")), "play");
});

clause(BOOST, "1:attach", "refused for a non-character host: item, location, faction, face-down card", () => {
  const b = boostBoard({ extra: [{ key: "fd", def: character({ name: "FD" }), owner: P1, zone: "play", faceDown: true }] });
  refused(() => castBoost(b, "itm"), "item host");
  refused(() => castBoost(b, "loc"), "location host");
  refused(() => play(b.engine, P1, b.id("bl"), { selected: { attachTo: [b.engine.state.players[P2].factionId!] } }), "faction host");
  refused(() => castBoost(b, "fd"), "face-down host");
  assert.equal(zoneOf(b.engine, b.id("bl")), "hand");
  assert.equal(attachedCount(b.engine, P1), 0, "nothing paid");
  castBoost(b);
  assert.equal(b.engine.state.cards[b.id("bl")].attachedTo, b.id("host"), "control");
});

clause(BOOST, "2:rule", "entering play inflicts exactly 1 damage to every character of both players, including the host", () => {
  const b = boostBoard();
  castBoost(b);
  for (const k of ["host", "ally", "foe", "foe2"]) assert.equal(dmg(b.engine, b.id(k)), 1, `${k} took 1`);
  assert.equal(dmg(b.engine, b.id("itm")), 0, "items are not characters");
  assert.equal(dmg(b.engine, b.id("loc")), 0, "locations are not characters");
});

clause(BOOST, "2:rule", "the damage reaches characters whose life is 1 (they are destroyed) and an opponent's host", () => {
  const b = boostBoard({ lifeAlly: 1 });
  castBoost(b, "foe");
  assert.equal(zoneOf(b.engine, b.id("ally")), "discard", "life-1 character dies");
  assert.equal(dmg(b.engine, b.id("host")), 1);
  assert.equal(dmg(b.engine, b.id("foe")), 1);
  assert.equal(dmg(b.engine, b.id("foe2")), 1);
});

clause(BOOST, "2:rule", "the enters-play damage is not the faction's, and happens once only (not when other cards enter, not at turn start)", () => {
  const b = boostBoard({
    extra: [{ key: "late", def: character({ name: "Late", life: 9, cost: 0 }), owner: P1, zone: "hand" }]
  });
  const inf1 = b.engine.state.players[P1].influence;
  const inf2 = b.engine.state.players[P2].influence;
  castBoost(b);
  assert.equal(b.engine.state.players[P1].influence, inf1);
  assert.equal(b.engine.state.players[P2].influence, inf2);
  play(b.engine, P1, b.id("late"), {});
  assert.equal(dmg(b.engine, b.id("late")), 0, "a character entering later is not hit by the enters-play text");
  assert.equal(dmg(b.engine, b.id("host")), 1, "no second ETB hit");
  assert.equal(dmg(b.engine, b.id("foe")), 1);
});

clause(BOOST, "3:rule", "the attached character gains the text only while the Blessing is attached: not before casting", () => {
  const b = boostBoard();
  assert.equal(str(b, "host"), 2);
  assert.equal(str(b, "ally"), 2);
  passTurn(b.engine);
  passTurn(b.engine);
  assert.equal(dmg(b.engine, b.id("host")), 0, "nothing before the Blessing is cast");
  castBoost(b);
  assert.equal(str(b, "host"), 3, "after casting the text applies");
});

clause(BOOST, "4.0:grant-rule", "at the start of EACH turn (mine and the opponent's) inflicts 1 damage to all my characters, not the opponent's, not items", () => {
  const b = boostBoard({ attached: "host" });
  passTurn(b.engine); // P2's turn begins
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(dmg(b.engine, b.id("host")), 1, "start of the opponent's turn");
  assert.equal(dmg(b.engine, b.id("ally")), 1);
  assert.equal(dmg(b.engine, b.id("foe")), 0, "opponent's characters are not hit");
  assert.equal(dmg(b.engine, b.id("foe2")), 0);
  assert.equal(dmg(b.engine, b.id("itm")), 0);
  passTurn(b.engine); // P1's turn begins
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(dmg(b.engine, b.id("host")), 1, "start of my turn (damage was cleared at the start of the turn, then 1 inflicted)");
  assert.equal(dmg(b.engine, b.id("ally")), 1);
  assert.equal(dmg(b.engine, b.id("foe")), 0);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(BOOST, "4.0:grant-rule", "exactly 1 damage per turn start (not 2: the text is granted once)", () => {
  const b = boostBoard({ attached: "host" });
  passTurn(b.engine);
  passTurn(b.engine);
  passTurn(b.engine);
  assert.equal(dmg(b.engine, b.id("host")), 1, "never 2: damage clears at turn start, then exactly 1");
  assert.equal(dmg(b.engine, b.id("ally")), 1);
  assert.equal(dmg(b.engine, b.id("foe")), 0);
});

clause(BOOST, "4.0:grant-rule", "the damage kills a character whose life is 1", () => {
  const b = boostBoard({ attached: "host", lifeAlly: 1 });
  assert.equal(zoneOf(b.engine, b.id("ally")), "play");
  passTurn(b.engine);
  assert.equal(zoneOf(b.engine, b.id("ally")), "discard", "damage 1 on life 1");
  assert.equal(zoneOf(b.engine, b.id("host")), "play");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
});

clause(BOOST, "4.0:grant-rule", "the text is gone once the Blessing is destroyed: no more turn-start damage", () => {
  const b = boostBoard({ attached: "host", extra: [{ key: "sm", def: smashDef(), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("sm"), { selected: { t: [b.id("bl")] } });
  assert.equal(zoneOf(b.engine, b.id("bl")), "discard");
  passTurn(b.engine);
  passTurn(b.engine);
  assert.equal(dmg(b.engine, b.id("host")), 0);
  assert.equal(dmg(b.engine, b.id("ally")), 0);
});

clause(BOOST, "4.0:grant-rule", "the text is gone when the host leaves play", () => {
  const b = boostBoard({ attached: "host", extra: [{ key: "k", def: killTactic(), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("k"), { selected: { t: [b.id("host")] } });
  assert.equal(zoneOf(b.engine, b.id("host")), "discard");
  passTurn(b.engine);
  passTurn(b.engine);
  assert.equal(dmg(b.engine, b.id("ally")), 0, "no damage without a host");
});

clause(BOOST, "4.0:grant-rule", "the granted text belongs to the HOST: on an opponent's character 'your characters' are the host controller's", () => {
  const b = boostBoard({ attached: "foe" });
  passTurn(b.engine);
  assert.equal(dmg(b.engine, b.id("foe")), 1, "the host's controller's characters take the damage");
  assert.equal(dmg(b.engine, b.id("foe2")), 1);
  assert.equal(dmg(b.engine, b.id("host")), 0, "the Blessing's caster's characters do not");
  assert.equal(dmg(b.engine, b.id("ally")), 0);
});

clause(BOOST, "4.1:grant-rule", "all my characters gain 1 strength (host, others, and ones entering later), not the opponent's", () => {
  const b = boostBoard({
    extra: [{ key: "late", def: character({ name: "Late", strength: 4, life: 9, cost: 0 }), owner: P1, zone: "hand" }]
  });
  castBoost(b);
  assert.equal(str(b, "host"), 3);
  assert.equal(str(b, "ally"), 3);
  assert.equal(str(b, "foe"), 2, "opponent's characters unchanged");
  assert.equal(str(b, "foe2"), 2);
  assert.equal(b.engine.getStat(b.id("host"), "life"), 9, "only strength changes");
  assert.equal(b.engine.getStat(b.id("host"), "speed"), 3);
  play(b.engine, P1, b.id("late"), {});
  assert.equal(str(b, "late"), 5, "a character entering later also gains 1");
});

clause(BOOST, "4.1:grant-rule", "the strength bonus is +1 exactly (does not stack) and ends when the Blessing leaves play", () => {
  const b = boostBoard({ attached: "host", extra: [{ key: "sm", def: smashDef(), owner: P1, zone: "hand" }] });
  assert.equal(str(b, "host"), 3);
  assert.equal(str(b, "ally"), 3);
  play(b.engine, P1, b.id("sm"), { selected: { t: [b.id("bl")] } });
  assert.equal(str(b, "host"), 2);
  assert.equal(str(b, "ally"), 2);
  assert.equal(str(b, "host"), 2, "stays off");
});

clause(BOOST, "4.1:grant-rule", "the strength bonus ends when the host leaves play", () => {
  const b = boostBoard({ attached: "host", extra: [{ key: "k", def: killTactic(), owner: P1, zone: "hand" }] });
  assert.equal(str(b, "ally"), 3);
  play(b.engine, P1, b.id("k"), { selected: { t: [b.id("host")] } });
  assert.equal(str(b, "ally"), 2);
});

clause(BOOST, "4.1:grant-rule", "on an opponent's host, 'your characters' are the host controller's: the strength goes to them", () => {
  const b = boostBoard({ attached: "foe" });
  assert.equal(str(b, "foe"), 3);
  assert.equal(str(b, "foe2"), 3);
  assert.equal(str(b, "host"), 2);
  assert.equal(str(b, "ally"), 2);
});

/* ====================================================================== */
/* Gor-blach the Endowed — character · warlord · fighter, tough guy · cost 5 · [R] · 4/3/5 */
/* ====================================================================== */
interface GorOpts {
  vol?: number;
  rage?: number;
  turn?: number;
  active?: typeof P1 | typeof P2;
  extra?: Cards;
  gorDepleted?: boolean;
  atkStr?: number;
}
function gorBoard(o: GorOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn ?? 2,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "gb", def: printing(GOR), owner: P1, zone: "play", depleted: o.gorDepleted },
      { key: "a1", def: character({ name: "A1", strength: o.atkStr ?? 2, life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "a2", def: character({ name: "A2", strength: 3, life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "idle", def: character({ name: "Idle", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 0, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      ...volition(o.vol ?? 6, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...fillers("d", 3, P1, "deck"),
      ...fillers("e", 3, P2, "deck"),
      ...(o.extra ?? [])
    ]
  });
}
type GB = ReturnType<typeof gorBoard>;
/** P1 attacks with `atkKeys`, P2 blocks with blk; the board is then in the blocked state with priority. */
function blocked(o: GorOpts = {}, atkKeys: string[] = ["a1"]): GB {
  const b = gorBoard(o);
  declareAttackBy(b.engine, P1, atkKeys.map(k => b.id(k)));
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("blk")] });
  return b;
}
const getInThere = (b: GB, pick: string[]) => activate(b.engine, P1, b.id("gb"), "get-in-there", { selected: { c: pick.map(k => b.id(k)) } });
const infl = (b: GB, p: string) => b.engine.state.players[p as never].influence;

clause(GOR, "0:unique", "is a warlord fighter / tough guy character with printed cost 5, threshold r, 4 str / 3 spd / 5 life, UNIQUE GOR-BLACH", () => {
  const b = gorBoard();
  const p = printing(GOR);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "warlord");
  assert.deepEqual([...(p.subtype ?? [])].sort(), ["fighter", "tough guy"]);
  assert.equal(p.cost, 5);
  assert.equal(p.threshold, "r");
  assert.equal((p as unknown as { unique?: string }).unique, "gor-blach");
  assert.equal(b.engine.getStat(b.id("gb"), "strength"), 4);
  assert.equal(b.engine.getStat(b.id("gb"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("gb"), "life"), 5);
});

function gorHandBoard(rage: number, obs: number, extra: Cards = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "gb", def: printing(GOR), owner: P1, zone: "hand" },
      ...bank("rage", rage, P1),
      ...bank("obsession", obs, P1),
      ...extra
    ]
  });
}

clause(GOR, "0:unique", "costs exactly 5: deployable with 5 resources (all spent), refused with 4", () => {
  const b = gorHandBoard(1, 4);
  play(b.engine, P1, b.id("gb"), {});
  assert.equal(zoneOf(b.engine, b.id("gb")), "play");
  assert.equal(attachedCount(b.engine, P1), 5);
  const s = gorHandBoard(1, 3);
  refused(() => play(s.engine, P1, s.id("gb"), {}), "cost 5 with 4 resources");
  assert.equal(zoneOf(s.engine, s.id("gb")), "hand");
});

clause(GOR, "0:unique", "threshold r: five resources with no Rage are refused, one Rage among five works", () => {
  const none = gorHandBoard(0, 5);
  refused(() => play(none.engine, P1, none.id("gb"), {}), "no [R] icon");
  assert.equal(zoneOf(none.engine, none.id("gb")), "hand");
  const ok = gorHandBoard(1, 4);
  play(ok.engine, P1, ok.id("gb"), {});
  assert.equal(zoneOf(ok.engine, ok.id("gb")), "play");
});

clause(GOR, "0:unique", "you cannot control two Gor-blachs: a second copy forces a choice, either may survive", () => {
  const extra: Cards = [{ key: "old", def: printing(GOR), owner: P1, zone: "play" }];
  const b = gorHandBoard(5, 0, extra);
  play(b.engine, P1, b.id("gb"), {});
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [b.id("gb"), b.id("old")].sort());
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("gb") } } as never);
  assert.equal(zoneOf(b.engine, b.id("gb")), "play");
  assert.equal(zoneOf(b.engine, b.id("old")), "discard");
  const c = gorHandBoard(5, 0, extra);
  play(c.engine, P1, c.id("gb"), {});
  c.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: c.id("old") } } as never);
  assert.equal(zoneOf(c.engine, c.id("old")), "play");
  assert.equal(zoneOf(c.engine, c.id("gb")), "discard");
});

clause(GOR, "0:unique", "UNIQUE is per player: the opponent may control their own Gor-blach", () => {
  const o = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "mine", def: printing(GOR), owner: P1, zone: "play" },
      { key: "theirs", def: printing(GOR), owner: P2, zone: "hand" },
      ...bank("rage", 5, P2)
    ],
    activePlayerId: P2
  });
  play(o.engine, P2, o.id("theirs"), {});
  assert.equal(o.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(o.engine, o.id("mine")), "play");
  assert.equal(zoneOf(o.engine, o.id("theirs")), "play");
});

clause(GOR, "1:ability:get-in-there", "pays X = the blocked character's strength, destroys it, hits the opponent's faction for X and Gor-blach for X (X = 2)", () => {
  const b = blocked({ vol: 3 });
  const inf2 = infl(b, P2);
  const inf1 = infl(b, P1);
  assert.equal(ready(b.engine, P1), 3);
  getInThere(b, ["a1"]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("a1")), "discard", "the blocked character is destroyed");
  assert.equal(infl(b, P2), inf2 - 2, "X damage to the opponent's faction");
  assert.equal(infl(b, P1), inf1, "not to my own faction");
  assert.equal(dmg(b.engine, b.id("gb")), 2, "X damage to Gor-blach");
  assert.equal(zoneOf(b.engine, b.id("gb")), "play");
  assert.equal(ready(b.engine, P1), 1, "exactly X = 2 resources paid");
});

clause(GOR, "1:ability:get-in-there", "X follows the strength of the pick (X = 3)", () => {
  const b = blocked({ vol: 3 }, ["a2"]);
  const inf2 = infl(b, P2);
  getInThere(b, ["a2"]);
  assert.equal(zoneOf(b.engine, b.id("a2")), "discard");
  assert.equal(infl(b, P2), inf2 - 3);
  assert.equal(dmg(b.engine, b.id("gb")), 3);
  assert.equal(ready(b.engine, P1), 0, "X = 3 paid");
});

clause(GOR, "1:ability:get-in-there", "X is the strength as modified (printed 2 plus a +1 aura = 3)", () => {
  const aura = item({
    name: "Aura",
    behavior: {
      abilities: [
        { id: "au", type: "continuous", modifiers: [{ selector: { controller: "self", type: "character" }, stat: "strength", operation: "add", value: 1 }] }
      ]
    }
  } as never);
  const b = blocked({ vol: 4, extra: [{ key: "aura", def: aura, owner: P1, zone: "play" }] });
  assert.equal(b.engine.getStat(b.id("a1"), "strength"), 3);
  const inf2 = infl(b, P2);
  getInThere(b, ["a1"]);
  assert.equal(infl(b, P2), inf2 - 3);
  assert.equal(dmg(b.engine, b.id("gb")), 3);
  assert.equal(ready(b.engine, P1), 1);
});

clause(GOR, "1:ability:get-in-there", "X = 0 (strength 0): destroys the character, no damage to either, pays nothing", () => {
  const b = blocked({ vol: 3, atkStr: 0 });
  const inf2 = infl(b, P2);
  getInThere(b, ["a1"]);
  assert.equal(zoneOf(b.engine, b.id("a1")), "discard");
  assert.equal(infl(b, P2), inf2);
  assert.equal(dmg(b.engine, b.id("gb")), 0);
  assert.equal(ready(b.engine, P1), 3);
});

clause(GOR, "1:ability:get-in-there", "the damage to Gor-blach is real: X = 4 leaves it alive with 4 damage, X = 5 destroys it (life 5)", () => {
  const four = blocked({ vol: 6, atkStr: 4 });
  getInThere(four, ["a1"]);
  assert.equal(dmg(four.engine, four.id("gb")), 4);
  assert.equal(zoneOf(four.engine, four.id("gb")), "play");
  const five = blocked({ vol: 6, atkStr: 5 });
  const inf2 = infl(five, P2);
  getInThere(five, ["a1"]);
  assert.equal(infl(five, P2), inf2 - 5);
  assert.equal(zoneOf(five.engine, five.id("a1")), "discard");
  assert.equal(zoneOf(five.engine, five.id("gb")), "discard", "5 damage on life 5 destroys Gor-blach");
});

clause(GOR, "1:ability:get-in-there", "COST: deplete this card — it is depleted afterwards, and refused when already depleted", () => {
  const b = blocked({ vol: 3 });
  assert.equal(b.engine.state.cards[b.id("gb")].depleted ?? false, false);
  getInThere(b, ["a1"]);
  assert.equal(b.engine.state.cards[b.id("gb")].depleted, true);
  const d = blocked({ vol: 3, gorDepleted: true });
  refused(() => getInThere(d, ["a1"]), "Gor-blach is depleted");
  assert.equal(zoneOf(d.engine, d.id("a1")), "play");
  assert.equal(ready(d.engine, P1), 3, "nothing paid");
  const ok = blocked({ vol: 3 });
  getInThere(ok, ["a1"]);
  assert.equal(zoneOf(ok.engine, ok.id("a1")), "discard", "control: ready Gor-blach works");
});

clause(GOR, "1:ability:get-in-there", "COST: Pay X — refused when X (4) exceeds the resources (3), nothing happens", () => {
  const b = blocked({ vol: 3, atkStr: 4 });
  refused(() => getInThere(b, ["a1"]), "cannot pay X = 4 with 3 resources");
  assert.equal(zoneOf(b.engine, b.id("a1")), "play");
  assert.equal(b.engine.state.cards[b.id("gb")].depleted ?? false, false, "Gor-blach not depleted");
  assert.equal(ready(b.engine, P1), 3);
  const ok = blocked({ vol: 4, atkStr: 4 });
  getInThere(ok, ["a1"]);
  assert.equal(zoneOf(ok.engine, ok.id("a1")), "discard", "control: 4 resources pay X = 4");
});

clause(GOR, "1:ability:get-in-there", "threshold [V][V][V]: three Volition needed — two Volition plus other icons is refused", () => {
  const b = blocked({ vol: 2, rage: 3 });
  refused(() => getInThere(b, ["a1"]), "only two [V]");
  assert.equal(zoneOf(b.engine, b.id("a1")), "play");
  assert.equal(ready(b.engine, P1), 5, "nothing paid");
  const none = blocked({ vol: 0, rage: 5 });
  refused(() => getInThere(none, ["a1"]), "no [V]");
  const ok = blocked({ vol: 3, rage: 0 });
  getInThere(ok, ["a1"]);
  assert.equal(zoneOf(ok.engine, ok.id("a1")), "discard", "control: three [V]");
  const mixed = blocked({ vol: 3, rage: 2 });
  getInThere(mixed, ["a1"]);
  assert.equal(zoneOf(mixed.engine, mixed.id("a1")), "discard", "control: three [V] plus Rage");
});

clause(GOR, "1:ability:get-in-there", "a blocked character: usable once the attacker has been blocked, not before blockers are declared", () => {
  const pre = gorBoard({ vol: 3 });
  declareAttackBy(pre.engine, P1, [pre.id("a1")]);
  refused(() => getInThere(pre, ["a1"]), "attacker not yet blocked (before blockers)", TIMING);
  assert.equal(zoneOf(pre.engine, pre.id("a1")), "play");
  assert.equal(ready(pre.engine, P1), 3);
  const ok = blocked({ vol: 3 });
  getInThere(ok, ["a1"]);
  assert.equal(zoneOf(ok.engine, ok.id("a1")), "discard", "control: blocked");
});

clause(GOR, "1:ability:get-in-there", "an attacker that nobody blocked is not a 'blocked character': refused", () => {
  const none = gorBoard({ vol: 3 });
  declareAttackBy(none.engine, P1, [none.id("a1")]);
  none.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  refused(() => getInThere(none, ["a1"]), "unblocked attacker", ILLEGAL);
  assert.equal(zoneOf(none.engine, none.id("a1")), "play");
  assert.equal(ready(none.engine, P1), 3, "nothing paid");
});

clause(GOR, "1:ability:get-in-there", "the pick must be a character I control: the opponent's blocker is refused", () => {
  const b = blocked({ vol: 6 });
  refused(() => getInThere(b, ["blk"]), "opponent's blocker", ILLEGAL);
  assert.equal(zoneOf(b.engine, b.id("blk")), "play");
  assert.equal(ready(b.engine, P1), 6);
  getInThere(b, ["a1"]);
  assert.equal(zoneOf(b.engine, b.id("a1")), "discard", "control");
});

clause(GOR, "1:ability:get-in-there", "the pick must be in the battle: an idle character of mine is refused", () => {
  const b = blocked({ vol: 6 });
  refused(() => getInThere(b, ["idle"]), "idle character", ILLEGAL);
  refused(() => getInThere(b, ["gb"]), "Gor-blach itself, not blocked", ILLEGAL);
  assert.equal(zoneOf(b.engine, b.id("idle")), "play");
  assert.equal(ready(b.engine, P1), 6);
  getInThere(b, ["a1"]);
  assert.equal(zoneOf(b.engine, b.id("a1")), "discard", "control");
  assert.equal(zoneOf(b.engine, b.id("idle")), "play");
});

clause(GOR, "1:ability:get-in-there", "a blocking character of mine is not a 'blocked character': refused, as is the opponent's blocked attacker", () => {
  const b = gorBoard({ vol: 6, turn: 3, active: P2 });
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("idle")] });
  const win = b.engine.state.responseWindow as unknown as { priorityPlayerId: string };
  b.engine.perform({ type: "passPriority", playerId: win.priorityPlayerId as never });
  assert.equal((b.engine.state.responseWindow as unknown as { priorityPlayerId: string }).priorityPlayerId, P1, "I now hold priority");
  refused(() => activate(b.engine, P1, b.id("gb"), "get-in-there", { selected: { c: [b.id("idle")] } }), "my blocker", ILLEGAL);
  refused(() => activate(b.engine, P1, b.id("gb"), "get-in-there", { selected: { c: [b.id("atk")] } }), "their blocked attacker", ILLEGAL);
  assert.equal(zoneOf(b.engine, b.id("idle")), "play");
  assert.equal(zoneOf(b.engine, b.id("atk")), "play");
  assert.equal(ready(b.engine, P1), 6);
});

clause(GOR, "1:ability:get-in-there", "a party blocked together: any member I control is a blocked character (X = its own strength)", () => {
  const b = blocked({ vol: 6 }, ["a1", "a2"]);
  const inf2 = infl(b, P2);
  getInThere(b, ["a2"]);
  assert.equal(zoneOf(b.engine, b.id("a2")), "discard");
  assert.equal(zoneOf(b.engine, b.id("a1")), "play", "only the pick is destroyed");
  assert.equal(infl(b, P2), inf2 - 3);
});

clause(GOR, "1:ability:get-in-there", "no pick at all is refused", () => {
  const b = blocked({ vol: 6 });
  refused(() => activate(b.engine, P1, b.id("gb"), "get-in-there", { selected: {} }), "no pick");
  assert.equal(ready(b.engine, P1), 6);
  assert.equal(b.engine.state.cards[b.id("gb")].depleted ?? false, false);
});

/* ====================================================================== */
/* Gosche's Restoration Fortress — location · warlord · cost 2 · [R] · structure 2 */
/* ====================================================================== */
interface FortOpts {
  rage?: number;
  tokTok?: number;
  fortOwner?: typeof P1 | typeof P2;
  fortZone?: "play" | "hand";
  fortDepleted?: boolean;
  extra?: Cards;
}
function fortBoard(o: FortOpts = {}) {
  const fo = o.fortOwner ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "fort", def: printing(FORT), owner: fo, zone: o.fortZone ?? "play", depleted: o.fortDepleted },
      { key: "tok", def: character({ name: "Tok", strength: 3, life: 9 }), owner: P1, zone: "play", counters: { token: o.tokTok ?? 1 } },
      { key: "plain", def: character({ name: "Plain", strength: 3, life: 9 }), owner: P1, zone: "play" },
      { key: "mylow", def: character({ name: "MyLow", strength: 1, life: 9 }), owner: P1, zone: "play", depleted: true },
      { key: "low", def: character({ name: "Low", strength: 2, life: 9 }), owner: P2, zone: "play", depleted: true },
      { key: "eq", def: character({ name: "Eq", strength: 3, life: 9 }), owner: P2, zone: "play", depleted: true },
      { key: "high", def: character({ name: "High", strength: 4, life: 9 }), owner: P2, zone: "play", depleted: true },
      { key: "foeTok", def: character({ name: "FoeTok", strength: 3, life: 9 }), owner: P2, zone: "play", counters: { token: 1 } },
      { key: "gy", def: character({ name: "Gy", strength: 1, life: 9 }), owner: P1, zone: "discard", depleted: true },
      { key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      ...bank("rage", o.rage ?? 4, P1),
      ...fillers("d", 3, P1, "deck"),
      ...fillers("e", 3, P2, "deck"),
      ...(o.extra ?? [])
    ]
  });
}
type FB = ReturnType<typeof fortBoard>;
const killIt = (b: FB, k: string) => play(b.engine, P1, b.id("kill"), { selected: { t: [b.id(k)] } });
const isDep = (b: FB, k: string) => b.engine.state.cards[b.id(k)].depleted ?? false;
const implant = (b: FB, pick: string[]) => activate(b.engine, P1, b.id("fort"), "seed", { selected: { c: pick.map(k => b.id(k)) } });

clause(FORT, "0:rule", "is a warlord location with printed cost 2, threshold r, structure 2", () => {
  const b = fortBoard();
  const p = printing(FORT);
  assert.equal(p.type, "location");
  assert.equal(p.trade, "warlord");
  assert.equal(p.cost, 2);
  assert.equal(p.threshold, "r");
  assert.equal(b.engine.getStat(b.id("fort"), "structure"), 2);
});

function fortHand(rage: number, obs: number) {
  return buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [{ key: "fort", def: printing(FORT), owner: P1, zone: "hand" }, ...bank("rage", rage, P1), ...bank("obsession", obs, P1)]
  });
}
clause(FORT, "0:rule", "costs exactly 2 with at least one [R]: 2 resources work (spent), 1 is refused, 2 without Rage is refused", () => {
  const ok = fortHand(1, 1);
  play(ok.engine, P1, ok.id("fort"), {});
  assert.equal(zoneOf(ok.engine, ok.id("fort")), "play");
  assert.equal(attachedCount(ok.engine, P1), 2);
  const one = fortHand(1, 0);
  refused(() => play(one.engine, P1, one.id("fort"), {}), "cost 2 with 1 resource");
  assert.equal(zoneOf(one.engine, one.id("fort")), "hand");
  const norage = fortHand(0, 2);
  refused(() => play(norage.engine, P1, norage.id("fort"), {}), "no [R]");
  assert.equal(zoneOf(norage.engine, norage.id("fort")), "hand");
});

clause(FORT, "0:rule", "my token character leaving play: I may pick a character with LESS strength than it had (any controller) and restore it", () => {
  const b = fortBoard();
  killIt(b, "tok");
  assert.equal(zoneOf(b.engine, b.id("tok")), "discard");
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string };
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "the Fortress's controller chooses");
  choose(b.engine, P1, [b.id("low")]);
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(isDep(b, "low"), false, "the picked character is restored");
  assert.equal(isDep(b, "mylow"), true, "others stay depleted");
  assert.equal(isDep(b, "eq"), true);
  assert.equal(isDep(b, "high"), true);
});

clause(FORT, "0:rule", "may pick my own lower-strength character too", () => {
  const b = fortBoard();
  killIt(b, "tok");
  choose(b.engine, P1, [b.id("mylow")]);
  resolvePendingResponses(b.engine);
  assert.equal(isDep(b, "mylow"), false);
  assert.equal(isDep(b, "low"), true);
});

clause(FORT, "0:rule", "strength must be strictly LESS: an equal (3) or greater (4) strength pick is refused", () => {
  const b = fortBoard();
  killIt(b, "tok");
  refused(() => choose(b.engine, P1, [b.id("eq")]), "equal strength");
  refused(() => choose(b.engine, P1, [b.id("high")]), "greater strength");
  refused(() => choose(b.engine, P1, [b.id("low"), b.id("mylow")]), "two picks: it restores a character, one pick");
  assert.equal(isDep(b, "eq"), true);
  assert.equal(isDep(b, "high"), true);
  choose(b.engine, P1, [b.id("low")]);
  resolvePendingResponses(b.engine);
  assert.equal(isDep(b, "low"), false, "control: lower strength");
});

clause(FORT, "0:rule", "the pick is a character in play: a character in my discard pile is refused", () => {
  const b = fortBoard();
  killIt(b, "tok");
  refused(() => choose(b.engine, P1, [b.id("gy")]), "discard-pile character");
  refused(() => choose(b.engine, P1, [b.id("itm")]), "an item");
  assert.equal(isDep(b, "gy"), true);
  choose(b.engine, P1, [b.id("low")]);
  resolvePendingResponses(b.engine);
  assert.equal(isDep(b, "low"), false, "control");
});

clause(FORT, "0:rule", "'may': the controller can decline, and then nothing is restored", () => {
  const b = fortBoard();
  killIt(b, "tok");
  choose(b.engine, P1, []);
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const k of ["low", "mylow", "eq", "high"]) assert.equal(isDep(b, k), true, `${k} stays depleted`);
});

clause(FORT, "0:rule", "'had': the strength the leaving character HAD in play counts (printed 3 plus +2 aura = 5 lets a strength-4 character be picked)", () => {
  const aura = item({
    name: "Aura",
    behavior: {
      abilities: [{ id: "au", type: "continuous", modifiers: [{ selector: { controller: "self", type: "character" }, stat: "strength", operation: "add", value: 2 }] }]
    }
  } as never);
  const b = fortBoard({ extra: [{ key: "aura", def: aura, owner: P1, zone: "play" }] });
  assert.equal(b.engine.getStat(b.id("tok"), "strength"), 5);
  killIt(b, "tok");
  choose(b.engine, P1, [b.id("high")]);
  resolvePendingResponses(b.engine);
  assert.equal(isDep(b, "high"), false, "4 < 5 (strength it had)");
  assert.equal(isDep(b, "eq"), true);
});

clause(FORT, "0:rule", "leaves play by any route: returning to hand triggers it too", () => {
  const bounce = tactic({
    name: "BounceF",
    cost: 0,
    behavior: {
      abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }]
    }
  } as never);
  const b = fortBoard({ extra: [{ key: "bn", def: bounce, owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("bn"), { selected: { t: [b.id("tok")] } });
  assert.equal(zoneOf(b.engine, b.id("tok")), "hand");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  choose(b.engine, P1, [b.id("low")]);
  resolvePendingResponses(b.engine);
  assert.equal(isDep(b, "low"), false);
});

clause(FORT, "0:rule", "a character with several tokens triggers it once", () => {
  const b = fortBoard({ tokTok: 3 });
  killIt(b, "tok");
  choose(b.engine, P1, [b.id("low")]);
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined, "no second prompt");
  assert.equal(isDep(b, "low"), false);
});

clause(FORT, "0:rule", "does NOT trigger for a character of mine without a token", () => {
  const b = fortBoard();
  killIt(b, "plain");
  assert.equal(zoneOf(b.engine, b.id("plain")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const k of ["low", "mylow", "eq", "high"]) assert.equal(isDep(b, k), true);
});

clause(FORT, "0:rule", "does NOT trigger for a non-character of mine with a token (an item) leaving play: only characters count", () => {
  const smashAny = tactic({
    name: "SmashAny",
    cost: 0,
    behavior: {
      abilities: [{ id: "sm", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
    }
  });
  const b = fortBoard({
    extra: [
      { key: "tokItem", def: item({ name: "TokItem", strength: 5 }), owner: P1, zone: "play", counters: { token: 1 } },
      { key: "smashAny", def: smashAny, owner: P1, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("smashAny"), { selected: { t: [b.id("tokItem")] } });
  assert.equal(zoneOf(b.engine, b.id("tokItem")), "discard", "the item left play");
  assert.equal(b.engine.state.pendingChoice, undefined, "no restore pick offered for an item");
  for (const k of ["low", "mylow", "eq", "high"]) assert.equal(isDep(b, k), true, `${k} stays depleted`);
});

clause(FORT, "0:rule", "does NOT trigger for an opponent's token character leaving play", () => {
  const b = fortBoard();
  killIt(b, "foeTok");
  assert.equal(zoneOf(b.engine, b.id("foeTok")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const k of ["low", "mylow", "eq", "high"]) assert.equal(isDep(b, k), true);
});

clause(FORT, "0:rule", "'you control' is the Fortress's controller: an opponent's Fortress ignores my token character", () => {
  const b = fortBoard({ fortOwner: P2 });
  killIt(b, "tok");
  assert.equal(zoneOf(b.engine, b.id("tok")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const k of ["low", "mylow", "eq", "high"]) assert.equal(isDep(b, k), true);
});

clause(FORT, "0:rule", "does nothing while the Fortress is not in play (in hand)", () => {
  const b = fortBoard({ fortZone: "hand" });
  killIt(b, "tok");
  assert.equal(zoneOf(b.engine, b.id("tok")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(isDep(b, "low"), true);
});

clause(FORT, "0:rule", "stops once the Fortress itself has left play", () => {
  const b = fortBoard({ extra: [{ key: "sm", def: smashDef(), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("sm"), { selected: { t: [b.id("fort")] } });
  assert.equal(zoneOf(b.engine, b.id("fort")), "discard");
  killIt(b, "tok");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(isDep(b, "low"), true);
});

clause(FORT, "1:ability:seed", "IMPLANT: pays 2, depletes the Fortress, puts exactly one token on the picked character of mine", () => {
  const b = fortBoard({ rage: 3 });
  assert.equal(tokens(b.engine, b.id("plain")), 0);
  implant(b, ["plain"]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(tokens(b.engine, b.id("plain")), 1);
  assert.equal(isDep(b, "fort"), true);
  assert.equal(ready(b.engine, P1), 1, "exactly 2 of 3 paid");
  assert.equal(tokens(b.engine, b.id("tok")), 1, "other characters untouched");
});

clause(FORT, "1:ability:seed", "a second token stacks on a character that already has one", () => {
  const b = fortBoard();
  implant(b, ["tok"]);
  assert.equal(tokens(b.engine, b.id("tok")), 2);
});

clause(FORT, "1:ability:seed", "needs 2 resources: refused with 1, Fortress stays ready", () => {
  const b = fortBoard({ rage: 1 });
  refused(() => implant(b, ["plain"]), "Pay 2 with 1 resource");
  assert.equal(tokens(b.engine, b.id("plain")), 0);
  assert.equal(isDep(b, "fort"), false);
  assert.equal(ready(b.engine, P1), 1);
  const ok = fortBoard({ rage: 2 });
  implant(ok, ["plain"]);
  assert.equal(tokens(ok.engine, ok.id("plain")), 1, "control: exactly 2");
});

clause(FORT, "1:ability:seed", "refused while the Fortress is depleted", () => {
  const b = fortBoard({ fortDepleted: true });
  refused(() => implant(b, ["plain"]), "depleted");
  assert.equal(tokens(b.engine, b.id("plain")), 0);
  assert.equal(ready(b.engine, P1), 4, "nothing paid");
});

clause(FORT, "1:ability:seed", "the pick must be a character I control: the opponent's character, an item and no pick are refused", () => {
  const b = fortBoard();
  refused(() => implant(b, ["low"]), "opponent's character");
  refused(() => implant(b, ["itm"]), "item");
  refused(() => activate(b.engine, P1, b.id("fort"), "seed", { selected: {} }), "no pick");
  assert.equal(tokens(b.engine, b.id("low")), 0);
  assert.equal(isDep(b, "fort"), false);
  assert.equal(ready(b.engine, P1), 4);
  implant(b, ["plain"]);
  assert.equal(tokens(b.engine, b.id("plain")), 1, "control");
});

clause(FORT, "1:ability:seed", "IMPLANT then loss: the implanted character triggers the restoration when it leaves play", () => {
  const b = fortBoard();
  implant(b, ["plain"]);
  killIt(b, "plain");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  choose(b.engine, P1, [b.id("low")]);
  resolvePendingResponses(b.engine);
  assert.equal(isDep(b, "low"), false);
});

/* ====================================================================== */
/* Gosche's Voidal Frequency Emission — tactic · warlord · cost 3 · [R] · FLIP UP: 2 [R] */
/* ====================================================================== */
interface VoidOpts {
  rage?: number;
  obs?: number;
  extra?: Cards;
  faceDown?: boolean;
  bare?: boolean;
  turn?: number;
  active?: typeof P1 | typeof P2;
}
function voidBoard(o: VoidOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn ?? 2,
    activePlayerId: o.active ?? P1,
    cards: [
      o.faceDown
        ? { key: "vo", def: printing(VOID), owner: P1, zone: "play", faceDown: true }
        : { key: "vo", def: printing(VOID), owner: P1, zone: "hand" },
      ...(o.bare
        ? []
        : ([
            { key: "dead", def: character({ name: "Dead", strength: 2, life: 3 }), owner: P1, zone: "discard" },
            { key: "dead2", def: character({ name: "Dead2", strength: 2, life: 3 }), owner: P1, zone: "discard" }
          ] as Cards)),
      { key: "spell", def: tactic({ name: "Spell" }), owner: P1, zone: "discard" },
      { key: "odead", def: character({ name: "ODead", strength: 2, life: 3 }), owner: P2, zone: "discard" },
      { key: "hc", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
      { key: "pc", def: character({ name: "PlayChar" }), owner: P1, zone: "play" },
      ...bank("rage", o.rage ?? 1, P1),
      ...bank("obsession", o.obs ?? 2, P1),
      ...fillers("d", 4, P1, "deck"),
      ...fillers("e", 3, P2, "deck"),
      ...(o.extra ?? [])
    ]
  });
}
type VB = ReturnType<typeof voidBoard>;
const castVoid = (b: VB, pick: string[] = ["dead"]) => play(b.engine, P1, b.id("vo"), { selected: { c: pick.map(k => b.id(k)) } });
const flipV = (b: VB, pick: string[] = ["dead"], player: string = P1) =>
  flipUpNow(b.engine, { type: "flipUp", playerId: player, cardId: b.id("vo"), selected: { c: pick.map(k => b.id(k)) }, variables: {} });
const deckOf = (b: VB) => [...b.engine.state.players[P1].deck];

clause(VOID, "0:extraCost", "is a warlord tactic with printed cost 3 and threshold r", () => {
  const b = voidBoard();
  const p = printing(VOID);
  assert.equal(p.type, "tactic");
  assert.equal(p.trade, "warlord");
  assert.equal(p.cost, 3);
  assert.equal(p.threshold, "r");
  assert.equal(zoneOf(b.engine, b.id("vo")), "hand");
});

clause(VOID, "0:extraCost", "costs exactly 3: castable with 3 resources (all spent), refused with 2; needs an [R] among them", () => {
  const b = voidBoard({ rage: 1, obs: 2 });
  castVoid(b);
  answerPending(b.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(zoneOf(b.engine, b.id("vo")), "discard");
  assert.equal(attachedCount(b.engine, P1), 3);
  const two = voidBoard({ rage: 1, obs: 1 });
  refused(() => castVoid(two), "cost 3 with 2 resources");
  assert.equal(zoneOf(two.engine, two.id("vo")), "hand");
  const norage = voidBoard({ rage: 0, obs: 3 });
  refused(() => castVoid(norage), "no [R]");
  assert.equal(zoneOf(norage.engine, norage.id("vo")), "hand");
});

clause(VOID, "0:extraCost", "EXTRA COST: needs a character in MY discard pile — none, or no pick, is refused", () => {
  const b = voidBoard();
  refused(() => play(b.engine, P1, b.id("vo"), { selected: {} }), "no pick");
  assert.equal(zoneOf(b.engine, b.id("vo")), "hand");
  assert.equal(attachedCount(b.engine, P1), 0, "nothing paid");
  const empty = voidBoard({ bare: true });
  refused(() => play(empty.engine, P1, empty.id("vo"), { selected: { c: [empty.id("spell")] } }), "no character in my discard pile");
  refused(() => play(empty.engine, P1, empty.id("vo"), { selected: {} }), "no character, no pick");
  assert.equal(zoneOf(empty.engine, empty.id("vo")), "hand");
  assert.equal(attachedCount(empty.engine, P1), 0);
});

clause(VOID, "0:extraCost", "the pick must be a character in my discard pile: opponent's discard, a non-character, hand, and play are refused", () => {
  const b = voidBoard();
  refused(() => castVoid(b, ["odead"]), "opponent's discard pile");
  refused(() => castVoid(b, ["spell"]), "tactic in my discard pile");
  refused(() => castVoid(b, ["hc"]), "character in hand");
  refused(() => castVoid(b, ["pc"]), "character in play");
  assert.equal(zoneOf(b.engine, b.id("vo")), "hand");
  assert.equal(attachedCount(b.engine, P1), 0);
  castVoid(b, ["dead2"]);
  answerPending(b.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(zoneOf(b.engine, b.id("vo")), "discard", "control: own discard character");
});

clause(VOID, "1:rule", "draws a card, then puts the character on TOP of the deck (the drawn card is the old top, not the character)", () => {
  const b = voidBoard();
  const before = deckOf(b);
  const handBefore = b.engine.state.players[P1].hand.length;
  castVoid(b);
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string };
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P1);
  answerPending(b.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.players[P1].hand.length, handBefore, "the tactic left the hand, one card was drawn");
  assert.ok(b.engine.state.players[P1].hand.includes(before[0]), "drew the old top card");
  assert.deepEqual(deckOf(b), [b.id("dead"), ...before.slice(1)], "the character is now the top card, rest in order");
  assert.equal(zoneOf(b.engine, b.id("dead")), "deck");
  assert.equal(zoneOf(b.engine, b.id("dead2")), "discard", "the other discard character is untouched");
  assert.equal(zoneOf(b.engine, b.id("vo")), "discard", "the tactic resolves to the discard pile");
});

clause(VOID, "1:rule", "alternatively puts the character into play face-down as a resource under my control", () => {
  const b = voidBoard();
  const before = deckOf(b);
  const handBefore = b.engine.state.players[P1].hand.length;
  const res = ready(b.engine, P1);
  castVoid(b);
  const spent = res - ready(b.engine, P1);
  answerPending(b.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(b.engine.state.pendingChoice, undefined);
  const c = b.engine.state.cards[b.id("dead")];
  assert.equal(c.zone, "play");
  assert.equal(c.faceDown, true, "face-down");
  assert.equal(c.controllerId ?? P1, P1);
  assert.equal(c.ownerId ?? P1, P1);
  assert.deepEqual(deckOf(b), before.slice(1), "not on the deck; one card drawn");
  assert.equal(b.engine.state.players[P1].hand.length, handBefore, "still draws a card");
  assert.ok(b.engine.state.players[P1].hand.includes(before[0]), "b.engine.state.players[P1].hand.includes(before[0])");
  assert.equal(spent, 3);
  assert.equal(ready(b.engine, P1), res - 3 + 1, "the new face-down card is a ready resource (3 paid, 1 gained)");
  assert.equal(zoneOf(b.engine, b.id("dead2")), "discard");
});

clause(VOID, "1:rule", "the face-down character is a usable Volition resource", () => {
  const b = voidBoard({ rage: 1, obs: 2 });
  castVoid(b);
  assert.equal(ready(b.engine, P1), 0, "everything paid");
  answerPending(b.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(ready(b.engine, P1), 1, "the face-down character is a ready resource");
});

clause(VOID, "1:rule", "the choice belongs to the controller (me), and both options are offered", () => {
  const b = voidBoard();
  castVoid(b);
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; options?: Array<{ label?: string }> };
  assert.equal(pc.playerId, P1);
  assert.equal(pc.options?.length, 2);
});

clause(VOID, "2:flipUp", "FLIP UP: 2 [R] — pays 2 with [R], resolves the tactic (draw + choose) on a picked discard character, then goes to the discard pile", () => {
  const b = voidBoard({ faceDown: true, rage: 1, obs: 3 });
  const before = deckOf(b);
  const res = ready(b.engine, P1);
  assert.equal(res, 5, "face-down card + 4 banks");
  flipV(b);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption");
  answerPending(b.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("vo")), "discard");
  assert.ok(b.engine.state.players[P1].hand.includes(before[0]), "drew a card");
  assert.deepEqual(deckOf(b), [b.id("dead"), ...before.slice(1)], "character on top of the deck");
  const left = ready(b.engine, P1);
  assert.ok(left === 2 || left === 3, `2 paid (either the card itself or banks); ${left} left of 5`);
});

clause(VOID, "2:flipUp", "FLIP UP resolves the second option too: the character goes into play face-down", () => {
  const b = voidBoard({ faceDown: true, rage: 1, obs: 1 });
  flipV(b);
  answerPending(b.engine, "chooserSelectsOption", { index: 1 });
  const c = b.engine.state.cards[b.id("dead")];
  assert.equal(c.zone, "play");
  assert.equal(c.faceDown, true);
  assert.equal(zoneOf(b.engine, b.id("vo")), "discard");
});

clause(VOID, "2:flipUp", "FLIP UP cost is exactly 2: the card may pay for itself (1 [R] bank + itself works); one short is refused", () => {
  const ok = voidBoard({ faceDown: true, rage: 1, obs: 0 });
  assert.equal(ready(ok.engine, P1), 2);
  flipV(ok);
  answerPending(ok.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(zoneOf(ok.engine, ok.id("vo")), "discard", "N-1 others + itself pays 2");
  const short = voidBoard({ faceDown: true, rage: 0, obs: 0, extra: [] });
  // only the face-down card itself: 1 resource, no [R]
  refused(() => flipV(short), "1 resource, cost 2");
  assert.equal(short.engine.state.cards[short.id("vo")].faceDown, true);
  assert.equal(zoneOf(short.engine, short.id("vo")), "play");
});

clause(VOID, "2:flipUp", "FLIP UP cost 2 is isolated from the threshold: a SPENT [R] satisfies the threshold but cannot pay, so the face-down card alone (1 ready) is refused", () => {
  const b = voidBoard({ faceDown: true, rage: 0, obs: 0, extra: spentResources(P1, 1) });
  assert.equal(ready(b.engine, P1), 1, "only the face-down card is ready");
  refused(() => flipV(b), "cost 2 with 1 ready resource");
  assert.equal(b.engine.state.cards[b.id("vo")].faceDown, true);
  assert.equal(zoneOf(b.engine, b.id("vo")), "play");
  const ok = voidBoard({ faceDown: true, rage: 0, obs: 1, extra: spentResources(P1, 1) });
  flipV(ok);
  answerPending(ok.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(zoneOf(ok.engine, ok.id("vo")), "discard", "control: 2 ready resources and a spent [R] for the threshold");
});

clause(VOID, "2:flipUp", "FLIP UP threshold [R]: plenty of resources but no Rage is refused, nothing paid", () => {
  const b = voidBoard({ faceDown: true, rage: 0, obs: 4 });
  assert.equal(ready(b.engine, P1), 5);
  refused(() => flipV(b), "no [R]");
  assert.equal(b.engine.state.cards[b.id("vo")].faceDown, true);
  assert.equal(zoneOf(b.engine, b.id("vo")), "play");
  assert.equal(ready(b.engine, P1), 5, "nothing paid");
  assert.equal(zoneOf(b.engine, b.id("dead")), "discard");
  const ok = voidBoard({ faceDown: true, rage: 1, obs: 3 });
  flipV(ok);
  answerPending(ok.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(zoneOf(ok.engine, ok.id("vo")), "discard", "control: one [R] is enough");
});

clause(VOID, "2:flipUp", "FLIP UP still needs the extra cost pick: no pick, the opponent's discard, a non-character and a hand character are refused", () => {
  const b = voidBoard({ faceDown: true, rage: 1, obs: 3 });
  refused(() => flipV(b, []), "no pick");
  refused(() => flipV(b, ["odead"]), "opponent's discard pile");
  refused(() => flipV(b, ["spell"]), "a tactic");
  refused(() => flipV(b, ["hc"]), "a hand character");
  assert.equal(b.engine.state.cards[b.id("vo")].faceDown, true);
  assert.equal(ready(b.engine, P1), 5);
  flipV(b, ["dead2"]);
  answerPending(b.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(zoneOf(b.engine, b.id("vo")), "discard", "control");
  assert.equal(deckOf(b)[0], b.id("dead2"));
});

clause(VOID, "2:flipUp", "as a tactic it may be flipped up inside the opponent's response window", () => {
  const b = voidBoard({
    faceDown: true,
    rage: 1,
    obs: 3,
    turn: 3,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  flipV(b);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption");
  answerPending(b.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(zoneOf(b.engine, b.id("vo")), "discard");
  assert.equal(deckOf(b)[0], b.id("dead"));
});
