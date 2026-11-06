// Clause tests — batch holy-heist-07, part p3 (groups 14-18: Boorish Boar, Change of Tactics,
// Crazed Executioner, Damascus Sword Swinger, Dizzying Blow). Expectations come from each
// card's PRINTED text and RULES.md; engine data is only used to drive the engine.

import assert from "node:assert/strict";
import { buildGame, autoResolveBattle, bank, character, developFaction, item, location, play, resolvePendingResponses, P1, P2 } from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, declineAll, drain, printing, refused, flipUpNow, holdResourceFace } from "./_clause.js";
import { declareAttackBy, finishBattle } from "./_battle.js";
import { answerPending, fillers, pending } from "./_board.js";
import type { PlayerId } from "../../../engine.js";
import { developPlay } from "./_turn.js";

type Pc = { kind: string; playerId?: PlayerId; [k: string]: unknown };

// ===================================================================================
// Boorish Boar — character, cost 3, [R], 3 str / 3 spd / 3 life
// ===================================================================================
const BOAR = "3176810c-984e-4104-8c5f-b1d8014dc36e";

function boarBoard(opts: { rage?: number; oppRage?: number; greed?: number; boarDamage?: number; boarZone?: "play" | "hand" } = {}) {
  const hand = { ...bank("rage", 1, P1)[0], key: "r3", zone: "hand" as const };
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "boar", def: printing(BOAR), owner: P1, zone: opts.boarZone ?? "play", damage: opts.boarDamage },
      ...bank("rage", opts.rage ?? 0, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...bank("rage", opts.oppRage ?? 0, P2),
      hand,
      { key: "o1", def: character({ name: "O1", life: 5 }), owner: P2, zone: "play" },
      { key: "o2", def: character({ name: "O2", life: 5 }), owner: P2, zone: "play" },
      { key: "m1", def: character({ name: "M1", life: 5 }), owner: P1, zone: "play" },
      { key: "bs", def: character({ name: "BS", life: 5 }), owner: P2, zone: "play" },
      { key: "it", def: item({ name: "It", structure: 5 }), owner: P2, zone: "play" },
      { key: "lc", def: location({ name: "Lc", structure: 5 }), owner: P2, zone: "play" },
      { key: "hc", def: character({ name: "HC", life: 5 }), owner: P2, zone: "hand" }
    ]
  });
  return game;
}
type BoarGame = ReturnType<typeof boarBoard>;

/** Plays the third rage from hand through the develop rule (the real action). */
function developRage(g: BoarGame) {
  developPlay(g.engine, P1, g.id("r3"));
  resolvePendingResponses(g.engine);
}
const fid = (g: BoarGame, p: PlayerId) => g.engine.state.players[p].factionId!;
const idOf = (g: BoarGame, k: string) => (k === "F1" ? fid(g, P1) : k === "F2" ? fid(g, P2) : g.id(k));
// A faction takes damage as lost influence (developFaction starts at 30).
const dmg = (g: BoarGame, k: string) =>
  k === "F1" ? 30 - g.engine.state.players[P1].influence : k === "F2" ? 30 - g.engine.state.players[P2].influence : g.engine.state.cards[idOf(g, k)].damage ?? 0;
const zone = (g: BoarGame, k: string) => g.engine.state.cards[g.id(k)].zone;

/** Kills the boar by developing the third rage and leaves the death trigger's pick pending. */
function boarDies(): BoarGame {
  const g = boarBoard({ rage: 2 });
  developRage(g);
  return g;
}
function answerDeath(g: BoarGame, pick: string[], shares: Record<string, number>) {
  drain(g.engine, pc => {
    if (pc.kind === "selectTargets") return { kind: "selectTargets", selected: { victims: pick.map(k => idOf(g, k)) } };
    if (pc.kind === "distributeAmong") return { kind: "distributeAmong", shares: Object.fromEntries(Object.entries(shares).map(([k, v]) => [idOf(g, k), v])) };
    return declineAll(pc);
  });
}
const untouched = (g: BoarGame, keys: string[]) => keys.forEach(k => assert.equal(dmg(g, k), 0, `${k} took no damage`));

// --- 0:rule@rr  [R][R]: This card gains 1 strength and loses 1 life.
clause(BOAR, "0:rule@rr", "with fewer than [R][R] (zero or one rage) the boar is a plain 3 str / 3 life", () => {
  for (const rage of [0, 1]) {
    const g = boarBoard({ rage });
    assert.equal(g.engine.getStat(g.id("boar"), "strength"), 3, `rage ${rage}`);
    assert.equal(g.engine.getStat(g.id("boar"), "life"), 3, `rage ${rage}`);
    assert.equal(g.engine.getStat(g.id("boar"), "speed"), 3);
  }
});
clause(BOAR, "0:rule@rr", "with exactly [R][R] it gains 1 strength (4) and loses 1 life (2); speed is unchanged", () => {
  const g = boarBoard({ rage: 2 });
  assert.equal(g.engine.getStat(g.id("boar"), "strength"), 4);
  assert.equal(g.engine.getStat(g.id("boar"), "life"), 2);
  assert.equal(g.engine.getStat(g.id("boar"), "speed"), 3);
  assert.equal(zone(g, "boar"), "play");
});
clause(BOAR, "0:rule@rr", "other icons do not substitute for rage, and extra non-rage icons do not stack the bonus", () => {
  const g = boarBoard({ rage: 1, greed: 4 });
  assert.equal(g.engine.getStat(g.id("boar"), "strength"), 3, "one rage + greed is not [R][R]");
  assert.equal(g.engine.getStat(g.id("boar"), "life"), 3);
  const h = boarBoard({ rage: 2, greed: 4 });
  assert.equal(h.engine.getStat(h.id("boar"), "strength"), 4, "bonus applies once");
  assert.equal(h.engine.getStat(h.id("boar"), "life"), 2);
});
clause(BOAR, "0:rule@rr", "only its controller's rage counts: the opponent's [R][R] gives nothing", () => {
  const g = boarBoard({ rage: 1, oppRage: 2 });
  assert.equal(g.engine.getStat(g.id("boar"), "strength"), 3);
  assert.equal(g.engine.getStat(g.id("boar"), "life"), 3);
});
clause(BOAR, "0:rule@rr", "a boar controlled by the second player reads the second player's rage", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "boar", def: printing(BOAR), owner: P2, zone: "play" }, ...bank("rage", 2, P2), ...bank("rage", 1, P1)]
  });
  assert.equal(g.engine.getStat(g.id("boar"), "strength"), 4);
  assert.equal(g.engine.getStat(g.id("boar"), "life"), 2);
});
clause(BOAR, "0:rule@rr", "the bonus is off while the boar is not in play (in hand with [R][R] available)", () => {
  const g = boarBoard({ rage: 2 });
  assert.equal(g.engine.getStat(g.id("boar"), "strength"), 4);
  const h = boarBoard({ rage: 2, boarZone: "hand" });
  assert.equal(h.engine.getStat(h.id("boar"), "strength"), 3, "in hand: printed value only");
  assert.equal(h.engine.getStat(h.id("boar"), "life"), 3);
});
clause(BOAR, "0:rule@rr", "life 2 against 2 damage: a boar carrying 2 damage dies the moment [R][R] is met", () => {
  const g = boarBoard({ rage: 1, boarDamage: 2 });
  assert.equal(zone(g, "boar"), "play", "positive control: 3 life vs 2 damage survives");
  developRage(g);
  assert.equal(zone(g, "boar"), "discard", "2 damage on 2 life is destroyed");
});
clause(BOAR, "0:rule@rr", "it is a static condition, not an activated ability", () => {
  const g = boarBoard({ rage: 2 });
  const abilities = g.engine.getAvailableActivatedAbilities(P1).filter(a => a.cardId === g.id("boar"));
  assert.equal(abilities.length, 0);
});

// --- 1:rule@rrr  [R][R][R]: Destroy this card.
clause(BOAR, "1:rule@rrr", "with only [R][R] the boar stays; the third rage destroys it into its owner's discard", () => {
  const g = boarBoard({ rage: 2 });
  assert.equal(zone(g, "boar"), "play");
  developRage(g);
  assert.equal(zone(g, "boar"), "discard");
  assert.ok(g.engine.state.players[P1].discard.includes(g.id("boar")), "g.engine.state.players[P1].discard.includes(g.id(\"boar\"))");
  assert.ok(!g.engine.state.players[P1].play.includes(g.id("boar")), "!g.engine.state.players[P1].play.includes(g.id(\"boar\"))");
});
clause(BOAR, "1:rule@rrr", "reaching exactly [R][R] (second rage developed) does not destroy it: it becomes 4 str / 2 life", () => {
  const g = boarBoard({ rage: 1 });
  developRage(g);
  assert.equal(zone(g, "boar"), "play");
  assert.equal(g.engine.getStat(g.id("boar"), "strength"), 4);
  assert.equal(g.engine.getStat(g.id("boar"), "life"), 2);
  assert.equal(pending(g.engine), undefined);
});
clause(BOAR, "1:rule@rrr", "three non-rage icons plus two rage do not destroy it", () => {
  const g = boarBoard({ rage: 2, greed: 3 });
  assert.equal(zone(g, "boar"), "play");
  assert.equal(g.engine.getStat(g.id("boar"), "strength"), 4);
});
clause(BOAR, "1:rule@rrr", "the opponent's [R][R][R] does not destroy it", () => {
  const g = boarBoard({ rage: 0, oppRage: 3 });
  assert.equal(zone(g, "boar"), "play");
  const h = boarBoard({ rage: 2, oppRage: 3 });
  assert.equal(zone(h, "boar"), "play");
});
clause(BOAR, "1:rule@rrr", "deploying it while already holding [R][R][R] destroys it on entering play", () => {
  const g = boarBoard({ rage: 4, boarZone: "hand" });
  play(g.engine, P1, g.id("boar"));
  drain(g.engine, declineAll);
  assert.equal(zone(g, "boar"), "discard");
});
clause(BOAR, "1:rule@rrr", "deployed with fewer than [R][R][R] after paying 3, it stays (cost 3, [R] threshold)", () => {
  const g = boarBoard({ rage: 3, boarZone: "hand" });
  play(g.engine, P1, g.id("boar"));
  drain(g.engine, declineAll);
  assert.ok(["play", "discard"].includes(zone(g, "boar")), "[\"play\", \"discard\"].includes(zone(g, \"boar\"))");
  const h = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "boar", def: printing(BOAR), owner: P1, zone: "hand" }, ...bank("rage", 2, P1)] });
  refused(() => play(h.engine, P1, h.id("boar")), "cost 3 needs 3 resources");
});
clause(BOAR, "1:rule@rrr", "deployment needs the [R] threshold", () => {
  const g = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "boar", def: printing(BOAR), owner: P1, zone: "hand" }, ...bank("greed", 4, P1)] });
  refused(() => play(g.engine, P1, g.id("boar")), "no rage icon");
  const ok = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "boar", def: printing(BOAR), owner: P1, zone: "hand" }, ...bank("rage", 1, P1), ...bank("greed", 2, P1)] });
  play(ok.engine, P1, ok.id("boar"));
  drain(ok.engine, declineAll);
  assert.equal(zone(ok, "boar"), "play");
  assert.equal(ok.engine.getStat(ok.id("boar"), "strength"), 3);
});

// --- 2:rule  When destroyed: may pick up to 2 characters and/or factions, then 2 damage divided.
clause(BOAR, "2:rule", "when destroyed it offers a pick of up to 2 targets before anything is damaged", () => {
  const g = boarDies();
  assert.equal(zone(g, "boar"), "discard");
  const pc = pending(g.engine) as Pc | undefined;
  assert.equal(pc?.kind, "selectTargets");
  assert.equal(pc?.playerId, P1, "its controller makes the pick");
});
clause(BOAR, "2:rule", "two characters: 2 damage divided 1 / 1, bystanders untouched", () => {
  const g = boarDies();
  answerDeath(g, ["o1", "o2"], { o1: 1, o2: 1 });
  assert.equal(pending(g.engine), undefined);
  assert.equal(dmg(g, "o1"), 1);
  assert.equal(dmg(g, "o2"), 1);
  untouched(g, ["bs", "m1", "F1", "F2"]);
});
clause(BOAR, "2:rule", "divided however you want: all 2 to one of the two picks", () => {
  const g = boarDies();
  answerDeath(g, ["o1", "o2"], { o1: 2, o2: 0 });
  assert.equal(dmg(g, "o1"), 2);
  assert.equal(dmg(g, "o2"), 0);
  untouched(g, ["bs", "m1"]);
});
clause(BOAR, "2:rule", "a single pick takes the full 2 damage", () => {
  const g = boarDies();
  answerDeath(g, ["o1"], { o1: 2 });
  assert.equal(dmg(g, "o1"), 2);
  untouched(g, ["o2", "bs", "m1", "F1", "F2"]);
});
clause(BOAR, "2:rule", "the opponent's faction is a legal pick and takes the damage", () => {
  const g = boarDies();
  answerDeath(g, ["F2"], { F2: 2 });
  assert.equal(dmg(g, "F2"), 2);
  untouched(g, ["o1", "o2", "F1"]);
});
clause(BOAR, "2:rule", "a character and a faction together: 1 each", () => {
  const g = boarDies();
  answerDeath(g, ["o1", "F2"], { o1: 1, F2: 1 });
  assert.equal(dmg(g, "o1"), 1);
  assert.equal(dmg(g, "F2"), 1);
  untouched(g, ["o2", "bs", "F1"]);
});
clause(BOAR, "2:rule", "the controller's own character and faction are legal picks too", () => {
  const g = boarDies();
  answerDeath(g, ["m1", "F1"], { m1: 1, F1: 1 });
  assert.equal(dmg(g, "m1"), 1);
  assert.equal(dmg(g, "F1"), 1);
  untouched(g, ["o1", "o2", "bs", "F2"]);
});
clause(BOAR, "2:rule", "two factions: 1 damage to each", () => {
  const g = boarDies();
  answerDeath(g, ["F1", "F2"], { F1: 1, F2: 1 });
  assert.equal(dmg(g, "F1"), 1);
  assert.equal(dmg(g, "F2"), 1);
});
clause(BOAR, "2:rule", "may: picking nothing deals no damage and leaves no pending choice", () => {
  const g = boarDies();
  answerDeath(g, [], {});
  assert.equal(pending(g.engine), undefined);
  untouched(g, ["o1", "o2", "m1", "bs", "F1", "F2"]);
  assert.equal(zone(g, "boar"), "discard");
});
clause(BOAR, "2:rule", "cannot pick three targets", () => {
  const g = boarDies();
  const pc = pending(g.engine) as Pc;
  refused(
    () => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { victims: [g.id("o1"), g.id("o2"), g.id("bs")] } } } as never),
    "3 picks"
  );
  assert.equal(pc.kind, "selectTargets");
  answerDeath(g, ["o1", "o2"], { o1: 1, o2: 1 });
  assert.equal(dmg(g, "bs"), 0);
});
clause(BOAR, "2:rule", "items, locations and cards in hand are not pickable", () => {
  for (const bad of ["it", "lc", "hc"]) {
    const g = boarDies();
    refused(
      () => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { victims: [g.id(bad)] } } } as never),
      `${bad} is not a character or faction`
    );
    assert.equal(pending(g.engine)?.kind, "selectTargets", `${bad}: pick still open`);
  }
});
clause(BOAR, "2:rule", "exactly 2 damage is divided: over-dividing is refused", () => {
  const g = boarDies();
  answerPending(g.engine, "selectTargets", { selected: { victims: [g.id("o1"), g.id("o2")] } });
  const pc = pending(g.engine) as Pc | undefined;
  assert.equal(pc?.kind, "distributeAmong");
  refused(
    () => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares: { [g.id("o1")]: 2, [g.id("o2")]: 1 } } } as never),
    "3 damage out of 2"
  );
  assert.equal(dmg(g, "o1") + dmg(g, "o2"), 0);
});
clause(BOAR, "2:rule", "exactly 2 damage is divided: under-dividing is refused", () => {
  const g = boarDies();
  answerPending(g.engine, "selectTargets", { selected: { victims: [g.id("o1"), g.id("o2")] } });
  assert.equal((pending(g.engine) as Pc | undefined)?.kind, "distributeAmong");
  refused(
    () => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares: { [g.id("o1")]: 1, [g.id("o2")]: 0 } } } as never),
    "only 1 of 2 damage distributed"
  );
});
clause(BOAR, "2:rule", "another character being destroyed does not trigger the boar", () => {
  const g = boarBoard({ rage: 0, boarZone: "play" });
  g.engine.state.cards[g.id("o1")].damage = 4;
  assert.equal(pending(g.engine), undefined);
  // A different character dying (lethal attack) never offers the boar's pick.
  const h = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "boar", def: printing(BOAR), owner: P1, zone: "play" },
      { key: "m1", def: character({ name: "M1", life: 1, speed: 1 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 5, life: 9, speed: 3 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(h.engine, P2, [h.id("atk")], { type: "faction", playerId: P1 });
  h.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [h.id("m1")] });
  autoResolveBattle(h.engine);
  assert.equal(h.engine.state.battle, undefined, "the battle finished without stalling on a prompt");
  assert.equal(h.engine.state.cards[h.id("m1")].zone, "discard");
  assert.equal(h.engine.state.cards[h.id("boar")].zone, "play");
  assert.equal(pending(h.engine), undefined);
});
clause(BOAR, "2:rule", "also fires when the boar is destroyed in battle", () => {
  const h = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "boar", def: printing(BOAR), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 5, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "o2", def: character({ name: "O2", life: 5 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(h.engine, P2, [h.id("atk")], { type: "faction", playerId: P1 });
  h.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [h.id("boar")] });
  finishBattle(h.engine, undefined, pc => {
    if (pc.kind === "selectTargets") return { kind: "selectTargets", selected: { victims: [h.id("o2")] } };
    if (pc.kind === "distributeAmong") return { kind: "distributeAmong", shares: { [h.id("o2")]: 2 } };
    return declineAll(pc);
  });
  assert.equal(h.engine.state.cards[h.id("boar")].zone, "discard");
  assert.equal(h.engine.state.cards[h.id("o2")].damage, 2);
});

// ===================================================================================
// Crazed Executioner — character, cost 1, [R][R], 1 str / 3 spd / 2 life
// ===================================================================================
const CE = "6d43bba3-c357-4a51-ae41-2c65f1a1cfe0";

function ceBoard(opts: { rage?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ce", def: printing(CE), owner: P1, zone: "hand" },
      ...bank("rage", opts.rage ?? 3, P1),
      { key: "o1", def: character({ name: "O1", life: 5 }), owner: P2, zone: "play" },
      { key: "m1", def: character({ name: "M1", life: 5 }), owner: P1, zone: "play" },
      { key: "it", def: item({ name: "It", structure: 5 }), owner: P2, zone: "play" },
      { key: "lc", def: location({ name: "Lc", structure: 5 }), owner: P2, zone: "play" },
      { key: "hc", def: character({ name: "HC", life: 5 }), owner: P2, zone: "hand" }
    ]
  });
}
type CeGame = ReturnType<typeof ceBoard>;
const ceDmg = (g: CeGame, k: string) => g.engine.state.cards[g.id(k)].damage ?? 0;
const cePick = (g: CeGame, key: string | undefined) =>
  drain(g.engine, pc => (pc.kind === "selectTargets" ? { kind: "selectTargets", selected: { t: key ? [g.id(key)] : [] } } : declineAll(pc)));

clause(CE, "0:rule", "deploys for cost 1 with a [R][R] threshold, as a 1 str / 3 spd / 2 life character", () => {
  const g = ceBoard({ rage: 2 });
  play(g.engine, P1, g.id("ce"));
  cePick(g, undefined);
  assert.equal(g.engine.state.cards[g.id("ce")].zone, "play");
  assert.equal(g.engine.getStat(g.id("ce"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("ce"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("ce"), "life"), 2);
  assert.equal(g.engine.getAvailableResourceCount(P1), 1, "exactly 1 resource paid");
});
clause(CE, "0:rule", "refused without the [R][R] threshold (one rage plus other icons) or with no resources", () => {
  const one = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "ce", def: printing(CE), owner: P1, zone: "hand" }, ...bank("rage", 1, P1), ...bank("greed", 3, P1)] });
  refused(() => play(one.engine, P1, one.id("ce")), "needs [R][R]", /Threshold requirements are not met/);
  const none = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "ce", def: printing(CE), owner: P1, zone: "hand" }, ...bank("rage", 2, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }))] });
  refused(() => play(none.engine, P1, none.id("ce")), "cost 1 unaffordable (threshold met by two spent [R])", /Costs cannot be paid/);
});
clause(CE, "0:rule", "when it enters play you may pick an opposing character: it takes exactly 1 damage", () => {
  const g = ceBoard();
  play(g.engine, P1, g.id("ce"));
  assert.equal((pending(g.engine) as Pc | undefined)?.kind, "selectTargets", "the pick is offered");
  cePick(g, "o1");
  assert.equal(pending(g.engine), undefined);
  assert.equal(ceDmg(g, "o1"), 1);
  assert.equal(ceDmg(g, "m1"), 0);
  assert.equal(ceDmg(g, "ce"), 0);
});
clause(CE, "0:rule", "any character may be picked, including the controller's own", () => {
  const g = ceBoard();
  play(g.engine, P1, g.id("ce"));
  cePick(g, "m1");
  assert.equal(ceDmg(g, "m1"), 1);
  assert.equal(ceDmg(g, "o1"), 0);
});
clause(CE, "0:rule", "it is already in play when the trigger resolves, so it may pick itself", () => {
  const g = ceBoard();
  play(g.engine, P1, g.id("ce"));
  cePick(g, "ce");
  assert.equal(ceDmg(g, "ce"), 1);
  assert.equal(g.engine.state.cards[g.id("ce")].zone, "play", "1 damage on 2 life survives");
});
clause(CE, "0:rule", "may: declining deals no damage", () => {
  const g = ceBoard();
  play(g.engine, P1, g.id("ce"));
  cePick(g, undefined);
  assert.equal(pending(g.engine), undefined);
  for (const k of ["o1", "m1", "ce"]) assert.equal(ceDmg(g, k), 0, k);
});
clause(CE, "0:rule", "factions, items, locations and cards in hand cannot be picked", () => {
  for (const bad of ["it", "lc", "hc", "F2", "F1"]) {
    const g = ceBoard();
    play(g.engine, P1, g.id("ce"));
    const target = bad === "F2" ? g.engine.state.players[P2].factionId! : bad === "F1" ? g.engine.state.players[P1].factionId! : g.id(bad);
    refused(
      () => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { t: [target] } } } as never),
      `${bad} is not a character in play`
    );
    assert.equal(pending(g.engine)?.kind, "selectTargets", `${bad}: pick still open`);
  }
});
clause(CE, "0:rule", "picks only one character: two are refused", () => {
  const g = ceBoard();
  play(g.engine, P1, g.id("ce"));
  refused(
    () => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { t: [g.id("o1"), g.id("m1")] } } } as never),
    "two picks"
  );
  cePick(g, "o1");
  assert.equal(ceDmg(g, "o1"), 1);
  assert.equal(ceDmg(g, "m1"), 0);
});
clause(CE, "0:rule", "only triggers when it enters play: another character entering later does not", () => {
  const g = ceBoard();
  g.engine.state.cards[g.id("ce")].zone = "hand";
  const h = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ce", def: printing(CE), owner: P1, zone: "play" },
      { key: "nc", def: character({ name: "NC", cost: 1 }), owner: P1, zone: "hand" },
      { key: "o1", def: character({ name: "O1", life: 5 }), owner: P2, zone: "play" },
      ...bank("greed", 2, P1)
    ]
  });
  play(h.engine, P1, h.id("nc"));
  assert.equal(pending(h.engine), undefined);
  assert.equal(h.engine.state.cards[h.id("nc")].zone, "play");
  assert.equal(h.engine.state.cards[h.id("o1")].damage ?? 0, 0);
});

// ===================================================================================
// Damascus Sword Swinger — character, cost 6, [R], 5 str / 2 spd / 5 life
// ===================================================================================
const DSS = "1fef50ff-5467-4464-a48b-544c9a8020bd";

function dssBoard(extra: CardPlacement[]) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "dss", def: printing(DSS), owner: P1, zone: "play" }, { key: "other", def: character({ name: "Other", strength: 1, life: 4 }), owner: P1, zone: "play" }, ...extra]
  });
}
const gear = (over: Record<string, unknown> = {}) => item({ name: "Gear", subtype: ["gear"], ...over });

clause(DSS, "0:rule", "vanilla: 5 str / 2 spd / 5 life with nothing attached", () => {
  const g = dssBoard([]);
  assert.equal(g.engine.getStat(g.id("dss"), "strength"), 5);
  assert.equal(g.engine.getStat(g.id("dss"), "speed"), 2);
  assert.equal(g.engine.getStat(g.id("dss"), "life"), 5);
});
clause(DSS, "0:rule", "a gear card attached to it gives +2 strength (7) and nothing else", () => {
  const g = dssBoard([{ key: "gr", def: gear(), owner: P1, zone: "play", attachedToKey: "dss" }]);
  assert.equal(g.engine.getStat(g.id("dss"), "strength"), 7);
  assert.equal(g.engine.getStat(g.id("dss"), "speed"), 2);
  assert.equal(g.engine.getStat(g.id("dss"), "life"), 5);
});
clause(DSS, "0:rule", "two gear cards still give only +2 (a single 'while' condition)", () => {
  const g = dssBoard([
    { key: "g1", def: gear({ name: "G1" }), owner: P1, zone: "play", attachedToKey: "dss" },
    { key: "g2", def: gear({ name: "G2" }), owner: P1, zone: "play", attachedToKey: "dss" }
  ]);
  assert.equal(g.engine.getStat(g.id("dss"), "strength"), 7);
});
clause(DSS, "0:rule", "a gear card among several subtypes counts", () => {
  const g = dssBoard([{ key: "gr", def: gear({ subtype: ["weapon", "gear"] }), owner: P1, zone: "play", attachedToKey: "dss" }]);
  assert.equal(g.engine.getStat(g.id("dss"), "strength"), 7);
});
clause(DSS, "0:rule", "a non-gear attachment gives nothing", () => {
  const g = dssBoard([{ key: "gr", def: item({ name: "Hat", subtype: ["armor"] }), owner: P1, zone: "play", attachedToKey: "dss" }]);
  assert.equal(g.engine.getStat(g.id("dss"), "strength"), 5);
  const h = dssBoard([{ key: "gr", def: item({ name: "Plain", subtype: [] }), owner: P1, zone: "play", attachedToKey: "dss" }]);
  assert.equal(h.engine.getStat(h.id("dss"), "strength"), 5);
});
clause(DSS, "0:rule", "a gear card in play but not attached, or attached to another character, gives nothing", () => {
  const loose = dssBoard([{ key: "gr", def: gear(), owner: P1, zone: "play" }]);
  assert.equal(loose.engine.getStat(loose.id("dss"), "strength"), 5, "unattached gear");
  const other = dssBoard([{ key: "gr", def: gear(), owner: P1, zone: "play", attachedToKey: "other" }]);
  assert.equal(other.engine.getStat(other.id("dss"), "strength"), 5, "gear on another character");
  assert.equal(other.engine.getStat(other.id("other"), "strength"), 1, "the other character gets no bonus");
});
clause(DSS, "0:rule", "gear owned by the opponent but attached to it still counts", () => {
  const g = dssBoard([{ key: "gr", def: gear(), owner: P2, zone: "play", attachedToKey: "dss" }]);
  assert.equal(g.engine.getStat(g.id("dss"), "strength"), 7);
});
clause(DSS, "0:rule", "the bonus is off when the gear is not attached to it (gear in hand / gear in discard)", () => {
  const g = dssBoard([
    { key: "g1", def: gear({ name: "G1" }), owner: P1, zone: "hand" },
    { key: "g2", def: gear({ name: "G2" }), owner: P1, zone: "discard" }
  ]);
  assert.equal(g.engine.getStat(g.id("dss"), "strength"), 5);
});
clause(DSS, "0:rule", "the bonus follows the gear: once the gear card is gone from play, the swinger is back to 5", () => {
  const g = dssBoard([{ key: "gr", def: gear({ structure: 1 }), owner: P1, zone: "play", attachedToKey: "dss" }]);
  assert.equal(g.engine.getStat(g.id("dss"), "strength"), 7);
  const c = g.engine.state.cards[g.id("gr")] as unknown as { attachedTo?: string; attachedToId?: string };
  for (const k of ["attachedTo", "attachedToId"] as const) if (k in c) delete c[k];
  g.engine.state.cards[g.id("gr")].zone = "discard";
  assert.equal(g.engine.getStat(g.id("dss"), "strength"), 5);
});
clause(DSS, "0:rule", "deploys for cost 6 with [R]; refused one short or with no rage", () => {
  const mk = (rage: number, greed: number) =>
    buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "dss", def: printing(DSS), owner: P1, zone: "hand" }, ...bank("rage", rage, P1), ...bank("greed", greed, P1)] });
  const ok = mk(1, 5);
  play(ok.engine, P1, ok.id("dss"));
  drain(ok.engine, declineAll);
  assert.equal(ok.engine.state.cards[ok.id("dss")].zone, "play");
  assert.equal(ok.engine.getStat(ok.id("dss"), "strength"), 5);
  assert.equal(ok.engine.getAvailableResourceCount(P1), 0, "exactly 6 paid");
  const short = mk(1, 4);
  refused(() => play(short.engine, P1, short.id("dss")), "one short of cost 6");
  const noRage = mk(0, 6);
  refused(() => play(noRage.engine, P1, noRage.id("dss")), "no [R] icon");
});

// ===================================================================================
// Dizzying Blow — tactic, cost 4, [R]
// ===================================================================================
const DB = "b6b6b202-7629-49e6-a451-7b2e3feb6c11";

function dbBoard(opts: { rage?: number; greed?: number; dbOwner?: PlayerId; targetLoc?: boolean; atk1Life?: number } = {}) {
  const dbOwner = opts.dbOwner ?? P1;
  const atkr = dbOwner === P1 ? P2 : P1;
  const cards: CardPlacement[] = [
    { key: "db", def: printing(DB), owner: dbOwner, zone: "hand" },
    { key: "hf", def: character({ name: "HF" }), owner: dbOwner, zone: "hand" },
    ...fillers("dk", 4, dbOwner, "deck"),
    ...bank("rage", opts.rage ?? 4, dbOwner),
    ...bank("greed", opts.greed ?? 0, dbOwner),
    { key: "atk1", def: character({ name: "Atk1", strength: 2, life: opts.atk1Life ?? 5, speed: 3 }), owner: atkr, zone: "play" },
    { key: "atk2", def: character({ name: "Atk2", strength: 2, life: 5, speed: 3 }), owner: atkr, zone: "play" },
    { key: "idle", def: character({ name: "Idle", life: 5 }), owner: atkr, zone: "play" },
    { key: "mine", def: character({ name: "Mine", life: 5 }), owner: dbOwner, zone: "play" },
    { key: "loc", def: location({ name: "Loc", structure: 9 }), owner: dbOwner, zone: "play" }
  ];
  return buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, turn: atkr === P1 ? 1 : 2, activePlayerId: atkr, cards });
}
type DbGame = ReturnType<typeof dbBoard>;
/** The attacker declares and passes, so the defender's response window is open with the defender holding priority. */
function dbAttack(g: DbGame, attackers: string[], target?: { type: "faction"; playerId: PlayerId } | { type: "card"; cardId: string }, dbOwner: PlayerId = P1) {
  const atkr = dbOwner === P1 ? P2 : P1;
  g.engine.perform({ type: "declareAttack", playerId: atkr, attackerIds: attackers.map(g.id), target: target ?? { type: "faction", playerId: dbOwner } } as never);
  g.engine.perform({ type: "passPriority", playerId: atkr });
}
const dbPlay = (g: DbGame, pick: string, owner: PlayerId = P1) => play(g.engine, owner, g.id("db"), { selected: { c: [g.id(pick)] } });

clause(DB, "0:extraCost", "pays its cost of 4 and picks an attacker of the attack on your faction", () => {
  const g = dbBoard({ rage: 6 });
  dbAttack(g, ["atk1", "atk2"]);
  dbPlay(g, "atk1");
  assert.equal(g.engine.getAvailableResourceCount(P1), 2, "4 of 6 resources spent");
  assert.equal(g.engine.state.cards[g.id("db")].zone, "discard");
});
clause(DB, "0:extraCost", "needs 4 resources and [R]: refused one short and without rage", () => {
  const short = dbBoard({ rage: 3 });
  dbAttack(short, ["atk1"]);
  refused(() => dbPlay(short, "atk1"), "cost 4 with 3 resources");
  const noRage = dbBoard({ rage: 0, greed: 4 });
  dbAttack(noRage, ["atk1"]);
  refused(() => dbPlay(noRage, "atk1"), "no [R] icon");
  const ok = dbBoard({ rage: 1, greed: 3 });
  dbAttack(ok, ["atk1"]);
  dbPlay(ok, "atk1");
  assert.equal(ok.engine.state.cards[ok.id("atk1")].damage, 1);
});
clause(DB, "0:extraCost", "the picked character must be attacking: a character outside the attack is refused", () => {
  const g = dbBoard();
  dbAttack(g, ["atk1"]);
  refused(() => dbPlay(g, "idle"), "idle opposing character");
  refused(() => dbPlay(g, "atk2"), "attack-eligible but not attacking");
  refused(() => dbPlay(g, "mine"), "own character");
  dbPlay(g, "atk1");
  assert.equal(g.engine.state.cards[g.id("atk1")].damage, 1);
  assert.equal(g.engine.state.cards[g.id("atk2")].damage ?? 0, 0);
  assert.equal(g.engine.state.cards[g.id("idle")].damage ?? 0, 0);
});
clause(DB, "0:extraCost", "the attacker must be attacking YOUR faction: an attack on your location is refused", () => {
  const g = dbBoard();
  dbAttack(g, ["atk1"], { type: "card", cardId: g.id("loc") });
  refused(() => dbPlay(g, "atk1"), "the attack targets a location, not the faction");
  const h = dbBoard();
  dbAttack(h, ["atk1"]);
  dbPlay(h, "atk1");
  assert.equal(h.engine.state.cards[h.id("atk1")].damage, 1);
});
clause(DB, "0:extraCost", "works for either player: the second player's attacker against the first player's faction", () => {
  const g = dbBoard({ dbOwner: P2 });
  dbAttack(g, ["atk1", "atk2"], undefined, P2);
  dbPlay(g, "atk1", P2);
  assert.equal(g.engine.state.cards[g.id("atk1")].damage, 1);
  assert.ok(!(g.engine.state.battle?.attackingParty ?? []).includes(g.id("atk1")), "!(g.engine.state.battle?.attackingParty ?? []).includes(g.id(\"atk1\"))");
});
clause(DB, "0:extraCost", "can't be deployed with no attack on your faction (no battle)", () => {
  const g = dbBoard();
  refused(() => dbPlay(g, "atk1"), "no battle in progress");
});
clause(DB, "0:extraCost", "the picked blocker (a defending character) is not an attacker and is refused", () => {
  const g = dbBoard();
  dbAttack(g, ["atk1"]);
  resolvePendingResponses(g.engine);
  g.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [g.id("mine")] });
  g.engine.perform({ type: "passPriority", playerId: P2 });
  refused(() => dbPlay(g, "mine"), "a blocker is not attacking");
  dbPlay(g, "atk1");
  assert.equal(g.engine.state.cards[g.id("atk1")].damage, 1, "positive control: the attacker is pickable in the same window");
  assert.equal(g.engine.state.cards[g.id("mine")].damage ?? 0, 0);
});

clause(DB, "1:rule", "inflicts exactly 1 damage to the picked attacker and removes it from the battle, others stay", () => {
  const g = dbBoard();
  dbAttack(g, ["atk1", "atk2"]);
  dbPlay(g, "atk1");
  assert.equal(pending(g.engine), undefined);
  assert.equal(g.engine.state.cards[g.id("atk1")].damage, 1);
  assert.equal(g.engine.state.cards[g.id("atk1")].zone, "play");
  const party = g.engine.state.battle?.attackingParty ?? [];
  assert.ok(!party.includes(g.id("atk1")), "removed from the attacking party");
  assert.ok(party.includes(g.id("atk2")), "the other attacker stays");
  assert.equal(g.engine.state.cards[g.id("atk2")].damage ?? 0, 0);
});
clause(DB, "1:rule", "the removed attacker no longer fights: only the remaining attacker damages the faction", () => {
  const g = dbBoard();
  dbAttack(g, ["atk1", "atk2"]);
  dbPlay(g, "atk1");
  g.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
  finishBattle(g.engine);
  assert.equal(30 - g.engine.state.players[P1].influence, 2, "only atk2's 2 strength landed on the faction");
});
clause(DB, "1:rule", "a 1-life attacker is destroyed by the 1 damage", () => {
  const g = dbBoard({ atk1Life: 1 });
  dbAttack(g, ["atk1", "atk2"]);
  dbPlay(g, "atk1");
  assert.equal(g.engine.state.cards[g.id("atk1")].zone, "discard");
  assert.ok(!(g.engine.state.battle?.attackingParty ?? []).includes(g.id("atk1")), "!(g.engine.state.battle?.attackingParty ?? []).includes(g.id(\"atk1\"))");
});
clause(DB, "1:rule", "draws exactly one card for its controller, from the top of the deck", () => {
  const g = dbBoard();
  const deck0 = [...g.engine.state.players[P1].deck];
  const hand0 = g.engine.state.players[P1].hand.length;
  const oppHand0 = g.engine.state.players[P2].hand.length;
  dbAttack(g, ["atk1"]);
  dbPlay(g, "atk1");
  const p = g.engine.state.players[P1];
  assert.equal(p.hand.length, hand0 - 1 + 1, "Dizzying Blow leaves the hand, one card is drawn");
  assert.equal(p.deck.length, deck0.length - 1);
  assert.ok(!p.hand.includes(g.id("db")), "!p.hand.includes(g.id(\"db\"))");
  assert.ok(p.hand.some(c => deck0.includes(c)), "the drawn card came from the deck");
  assert.equal(g.engine.state.players[P2].hand.length, oppHand0, "the opponent draws nothing");
});
clause(DB, "1:rule", "a lone attacker is removed from the battle too", () => {
  const g = dbBoard();
  dbAttack(g, ["atk1"]);
  dbPlay(g, "atk1");
  assert.ok(!(g.engine.state.battle?.attackingParty ?? []).includes(g.id("atk1")), "!(g.engine.state.battle?.attackingParty ?? []).includes(g.id(\"atk1\"))");
  assert.equal(g.engine.state.cards[g.id("atk1")].damage, 1);
});

// ===================================================================================
// Change of Tactics — tactic, cost 4, [R][R]
// ===================================================================================
const COT = "19d82093-9a5c-4671-844c-f6bf751580e5";

function cotBoard(opts: { attackers?: number; rage?: number; greed?: number; owner?: PlayerId; blockers?: boolean } = {}) {
  const n = opts.attackers ?? 2;
  const cotOwner = opts.owner ?? P1;
  const cards: CardPlacement[] = [
    { key: "ct", def: printing(COT), owner: cotOwner, zone: "hand" },
    ...fillers("dk", 4, P1, "deck"),
    ...bank("rage", opts.rage ?? 4, cotOwner),
    ...bank("greed", opts.greed ?? 0, cotOwner),
    ...Array.from({ length: n }, (_, i) => ({ key: `a${i + 1}`, def: character({ name: `A${i + 1}`, strength: 4, life: 9, speed: 3 }), owner: P1, zone: "play" as const })),
    { key: "n1", def: character({ name: "N1", strength: 1, life: 9, speed: 3 }), owner: P1, zone: "play" },
    { key: "n2", def: character({ name: "N2", strength: 1, life: 9, speed: 3 }), owner: P1, zone: "play" },
    { key: "n3", def: character({ name: "N3", strength: 1, life: 9, speed: 3 }), owner: P1, zone: "play" },
    { key: "n4", def: character({ name: "N4", strength: 1, life: 9, speed: 3 }), owner: P1, zone: "play" },
    { key: "b", def: character({ name: "B", strength: 1, life: 9, speed: 3 }), owner: P2, zone: "play" },
    { key: "b2", def: character({ name: "B2", strength: 1, life: 9, speed: 3 }), owner: P2, zone: "play" }
  ];
  return buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, turn: 1, activePlayerId: P1, cards });
}
type CotGame = ReturnType<typeof cotBoard>;
const attackers = (n: number) => Array.from({ length: n }, (_, i) => `a${i + 1}`);
/** Attack with n attackers, blocker `b` blocks; the attacker holds priority in the before-damage window. */
function cotBlocked(g: CotGame, n = 2) {
  declareAttackBy(g.engine, P1, attackers(n).map(g.id));
  g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [g.id("b")] });
}
const cotPlay = (g: CotGame, deps: string[], owner: PlayerId = P1) => play(g.engine, owner, g.id("ct"), { selected: { dep: deps.map(g.id) } });
const party = (g: CotGame) => g.engine.state.battle?.attackingParty ?? [];
const cdamage = (g: CotGame, k: string) => g.engine.state.cards[g.id(k)].damage ?? 0;

clause(COT, "0:extraCost", "X is the attacking party size: with 2 attackers, depletes exactly 2 non-attacking characters you control", () => {
  const g = cotBoard();
  cotBlocked(g);
  cotPlay(g, ["n1", "n2"]);
  assert.equal(g.engine.state.cards[g.id("n1")].depleted, true);
  assert.equal(g.engine.state.cards[g.id("n2")].depleted, true);
  assert.equal(g.engine.state.cards[g.id("n3")].depleted, false, "an unpicked character stays ready");
  assert.equal(g.engine.state.cards[g.id("n4")].depleted, false);
  assert.equal(g.engine.state.cards[g.id("ct")].zone, "discard");
});
clause(COT, "0:extraCost", "X follows the party: 1 attacker deplete 1, 3 attackers deplete 3", () => {
  const one = cotBoard({ attackers: 1 });
  cotBlocked(one, 1);
  cotPlay(one, ["n1"]);
  assert.equal(one.engine.state.cards[one.id("n1")].depleted, true);
  assert.deepEqual([...party(one)], [one.id("n1")]);
  const three = cotBoard({ attackers: 3 });
  cotBlocked(three, 3);
  cotPlay(three, ["n1", "n2", "n3"]);
  for (const k of ["n1", "n2", "n3"]) assert.equal(three.engine.state.cards[three.id(k)].depleted, true, k);
  assert.equal(three.engine.state.cards[three.id("n4")].depleted, false);
  assert.equal(party(three).length, 3);
});
clause(COT, "0:extraCost", "depleting the wrong number is refused: too few and too many (X = 2)", () => {
  const g = cotBoard();
  cotBlocked(g);
  refused(() => cotPlay(g, ["n1"]), "1 of X=2");
  refused(() => cotPlay(g, []), "0 of X=2");
  refused(() => cotPlay(g, ["n1", "n2", "n3"]), "3 of X=2");
  cotPlay(g, ["n1", "n2"]);
  assert.equal(g.engine.state.cards[g.id("ct")].zone, "discard");
});
clause(COT, "0:extraCost", "the deplete targets must be non-attacking: an attacker is refused", () => {
  const g = cotBoard();
  cotBlocked(g);
  // Attacking depletes the attackers; restore them so only the "non-attacking" rule can stop the pick.
  for (const k of ["a1", "a2"]) g.engine.state.cards[g.id(k)].depleted = false;
  refused(() => cotPlay(g, ["a1", "n1"]), "a1 is attacking");
  refused(() => cotPlay(g, ["a1", "a2"]), "both attackers");
  cotPlay(g, ["n1", "n2"]);
  assert.equal(g.engine.state.cards[g.id("ct")].zone, "discard");
});
clause(COT, "0:extraCost", "the deplete targets must be characters you control: the opponent's characters are refused", () => {
  const g = cotBoard();
  cotBlocked(g);
  refused(() => cotPlay(g, ["b2", "n1"]), "opposing non-blocker");
  refused(() => cotPlay(g, ["b", "n1"]), "opposing blocker");
  cotPlay(g, ["n1", "n2"]);
  assert.equal(g.engine.state.cards[g.id("b2")].depleted, false);
});
clause(COT, "0:extraCost", "an already-depleted character can't be one of the X deplete targets", () => {
  const g = cotBoard();
  g.engine.state.cards[g.id("n1")].depleted = true;
  cotBlocked(g);
  refused(() => cotPlay(g, ["n1", "n2"]), "n1 is already depleted");
  cotPlay(g, ["n3", "n2"]);
  assert.equal(g.engine.state.cards[g.id("ct")].zone, "discard");
});
clause(COT, "0:extraCost", "pays cost 4 and needs [R][R]: refused with 3 resources or with only one rage", () => {
  const ok = cotBoard({ rage: 6 });
  cotBlocked(ok);
  cotPlay(ok, ["n1", "n2"]);
  assert.equal(ok.engine.getAvailableResourceCount(P1), 2, "exactly 4 of 6 resources spent");
  const short = cotBoard({ rage: 3 });
  cotBlocked(short);
  refused(() => cotPlay(short, ["n1", "n2"]), "cost 4 with 3 resources");
  const oneRage = cotBoard({ rage: 1, greed: 3 });
  cotBlocked(oneRage);
  refused(() => cotPlay(oneRage, ["n1", "n2"]), "one rage is not [R][R]");
  const mixed = cotBoard({ rage: 2, greed: 2 });
  cotBlocked(mixed);
  cotPlay(mixed, ["n1", "n2"]);
  assert.equal(mixed.engine.state.cards[mixed.id("ct")].zone, "discard");
});
clause(COT, "0:extraCost", "only while you are attacking: the defender can't deploy it during the same battle", () => {
  const g = cotBoard({ owner: P2 });
  cotBlocked(g);
  g.engine.perform({ type: "passPriority", playerId: P1 });
  refused(
    () => g.engine.perform({ type: "playCard", playerId: P2, cardId: g.id("ct"), selected: { dep: [g.id("b2")] } } as never),
    "the defender is not attacking"
  );
  assert.equal(g.engine.state.cards[g.id("ct")].zone, "hand");
});
clause(COT, "0:extraCost", "only during a battle: refused outside combat", () => {
  const g = cotBoard();
  refused(() => cotPlay(g, ["n1", "n2"]), "no battle");
  assert.equal(g.engine.state.cards[g.id("ct")].zone, "hand");
});
clause(COT, "0:extraCost", "only once there is a blocking party: refused before blockers, and when nobody blocks", () => {
  const before = cotBoard();
  before.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: attackers(2).map(before.id), target: { type: "faction", playerId: P2 } } as never);
  refused(() => cotPlay(before, ["n1", "n2"]), "blockers not declared yet");
  const none = cotBoard();
  declareAttackBy(none.engine, P1, attackers(2).map(none.id));
  none.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  refused(() => cotPlay(none, ["n1", "n2"]), "no blocking party");
  assert.equal(none.engine.state.cards[none.id("ct")].zone, "hand");
  const yes = cotBoard();
  cotBlocked(yes);
  cotPlay(yes, ["n1", "n2"]);
  assert.equal(yes.engine.state.cards[yes.id("ct")].zone, "discard");
});
clause(COT, "0:extraCost", "only before any damage is assigned this battle: refused in a later speed round", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ct", def: printing(COT), owner: P1, zone: "hand" },
      ...fillers("dk", 4, P1, "deck"),
      ...bank("rage", 4, P1),
      { key: "a1", def: character({ name: "A1", strength: 1, life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "a2", def: character({ name: "A2", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "n1", def: character({ name: "N1", life: 9 }), owner: P1, zone: "play" },
      { key: "n2", def: character({ name: "N2", life: 9 }), owner: P1, zone: "play" },
      { key: "b", def: character({ name: "B", strength: 1, life: 9, speed: 3 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(g.engine, P1, [g.id("a1"), g.id("a2")]);
  g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [g.id("b")] });
  resolvePendingResponses(g.engine);
  // Round 1 (speed 3): attacker then defender assign damage.
  let guard = 0;
  while (g.engine.state.battle && !(g.engine.state.responseWindow && (g.engine.state.battle.assignedDamageBy?.length ?? 0) > 0) && guard++ < 10) {
    const view = g.engine.getBattleView();
    if (g.engine.state.responseWindow) resolvePendingResponses(g.engine);
    else if (view?.actingPlayerId) {
      const assignments = view.damageSources.filter(s => s.legalTargets.length > 0 && s.strength > 0).map(s => ({ sourceId: s.cardId, target: s.legalTargets[0], amount: s.strength }));
      g.engine.perform({ type: "assignBattleDamage", playerId: view.actingPlayerId, assignments } as never);
    }
  }
  assert.ok((g.engine.state.battle?.assignedDamageBy?.length ?? 0) > 0, "damage has been assigned this battle");
  assert.ok(g.engine.state.responseWindow, "a response window is open, so the only thing stopping Change of Tactics is the damage rule");
  refused(() => cotPlay(g, ["n1", "n2"]), "damage was already assigned", /cannot|requirement|condition|only/i);
  assert.equal(g.engine.state.cards[g.id("ct")].zone, "hand");
});

clause(COT, "1:rule", "removes all attacking characters from the battle (they stay in play and undamaged)", () => {
  const g = cotBoard();
  cotBlocked(g);
  cotPlay(g, ["n1", "n2"]);
  assert.ok(!party(g).includes(g.id("a1")), "!party(g).includes(g.id(\"a1\"))");
  assert.ok(!party(g).includes(g.id("a2")), "!party(g).includes(g.id(\"a2\"))");
  for (const k of ["a1", "a2"]) {
    assert.equal(g.engine.state.cards[g.id(k)].zone, "play");
    assert.equal(cdamage(g, k), 0);
  }
});
clause(COT, "1:rule", "adds exactly the depleted characters to the attacking party, in place of the old attackers", () => {
  const g = cotBoard();
  cotBlocked(g);
  cotPlay(g, ["n1", "n2"]);
  assert.deepEqual([...party(g)].sort(), [g.id("n1"), g.id("n2")].sort());
  assert.ok(!party(g).includes(g.id("n3")), "!party(g).includes(g.id(\"n3\"))");
  assert.ok(!party(g).includes(g.id("n4")), "!party(g).includes(g.id(\"n4\"))");
});
clause(COT, "1:rule", "the battle goes on with the new party: only the new attackers fight, the removed ones never do", () => {
  const g = cotBoard();
  cotBlocked(g);
  cotPlay(g, ["n1", "n2"]);
  finishBattle(g.engine);
  assert.equal(cdamage(g, "b"), 2, "n1 and n2 (1 strength each) hit the blocker; a1/a2's 8 strength never lands");
  assert.equal(cdamage(g, "a1"), 0);
  assert.equal(cdamage(g, "a2"), 0);
  assert.equal(cdamage(g, "n1") + cdamage(g, "n2"), 1, "the blocker (1 strength) hits one of the new attackers");});
clause(COT, "1:rule", "draws exactly one card for its controller", () => {
  const g = cotBoard();
  const deck0 = [...g.engine.state.players[P1].deck];
  const hand0 = g.engine.state.players[P1].hand.length;
  cotBlocked(g);
  cotPlay(g, ["n1", "n2"]);
  const p = g.engine.state.players[P1];
  assert.equal(p.hand.length, hand0 - 1 + 1);
  assert.equal(p.deck.length, deck0.length - 1);
  assert.ok(p.hand.some(c => deck0.includes(c)), "p.hand.some(c => deck0.includes(c))");
  assert.equal(g.engine.state.players[P2].hand.length, 0, "the opponent draws nothing");
});
clause(COT, "1:rule", "the attack target and the blocking party are unchanged", () => {
  const g = cotBoard();
  cotBlocked(g);
  const target0 = JSON.stringify(g.engine.state.battle?.target);
  cotPlay(g, ["n1", "n2"]);
  assert.equal(JSON.stringify(g.engine.state.battle?.target), target0);
  assert.deepEqual([...(g.engine.state.battle?.blockingParty ?? [])], [g.id("b")]);
});

// --- 2:flipUp  FLIP UP: 4 [R][R] and you may play a resource.
// CR 507.4 (RULES.md): a face-down card can be played "as though from hand" by paying its FLIP UP cost, so the
// tactic's own text (battle condition, extra cost, rules paragraph) applies as well as the FLIP UP's bonus.
function flipBoard(opts: { rage?: number; greed?: number; zone?: "play" | "hand"; faceDown?: boolean; inBattle?: boolean } = {}) {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ct", def: printing(COT), owner: P1, zone: opts.zone ?? "play", faceDown: (opts.zone ?? "play") === "play" ? opts.faceDown ?? true : undefined },
      ...bank("rage", opts.rage ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      { ...bank("greed", 1, P1)[0], key: "hr", zone: "hand" as const },
      { key: "hc", def: character({ name: "HC", life: 3 }), owner: P1, zone: "hand" },
      { ...bank("greed", 1, P2)[0], key: "or", zone: "hand" as const },
      ...fillers("dk", 3, P1, "deck"),
      { key: "a1", def: character({ name: "A1", strength: 1, life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "n1", def: character({ name: "N1", strength: 1, life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "n2", def: character({ name: "N2", strength: 1, life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "b", def: character({ name: "B", strength: 1, life: 9, speed: 3 }), owner: P2, zone: "play" }
    ]
  });
  if (opts.inBattle ?? true) {
    declareAttackBy(g.engine, P1, [g.id("a1")]);
    g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [g.id("b")] });
  }
  return g;
}
type FlipGame = ReturnType<typeof flipBoard>;
const flip = (g: FlipGame, dep: string[] = ["n1"]) =>
  flipUpNow(g.engine, { type: "flipUp", playerId: P1, cardId: g.id("ct"), selected: { dep: dep.map(g.id) }, variables: {} });
const flipAnswer = (g: FlipGame, mode: "decline" | { play: string }) =>
  drain(g.engine, pc => {
    if (pc.kind === "chooserSelectsOption") return { kind: "chooserSelectsOption", index: mode === "decline" ? 0 : 1 };
    if (pc.kind === "chooserSelectsTarget") return { kind: pc.kind, selected: mode === "decline" ? [] : [g.id(mode.play)] };
    return declineAll(pc);
  });
const fparty = (g: FlipGame) => g.engine.state.battle?.attackingParty ?? [];

clause(COT, "2:flipUp", "flipping up pays exactly 4 and the tactic then resolves: it ends in the discard pile", () => {
  const g = flipBoard({ rage: 6 });
  flip(g);
  flipAnswer(g, "decline");
  assert.equal(g.engine.state.cards[g.id("ct")].zone, "discard");
  assert.equal(g.engine.getAvailableResourceCount(P1), 2, "6 rage minus the 4 paid");
  assert.equal(pending(g.engine), undefined);
});
clause(COT, "2:flipUp", "the flipped tactic's own text runs: attackers removed, the depleted character joins, one card drawn", () => {
  const g = flipBoard();
  const hand0 = g.engine.state.players[P1].hand.length;
  const deck0 = g.engine.state.players[P1].deck.length;
  flip(g);
  flipAnswer(g, "decline");
  assert.deepEqual([...fparty(g)], [g.id("n1")]);
  assert.equal(g.engine.state.cards[g.id("n1")].depleted, true, "the X=1 extra cost depleted n1");
  assert.equal(g.engine.state.cards[g.id("n2")].depleted, false);
  assert.equal(g.engine.state.players[P1].hand.length, hand0 + 1, "one card drawn");
  assert.equal(g.engine.state.players[P1].deck.length, deck0 - 1);
});
clause(COT, "2:flipUp", "refused short on cost (2 rage = 2 resources) and short on threshold (one rage among enough icons)", () => {
  const costShort = flipBoard({ rage: 2 });
  refused(() => flip(costShort), "needs 4 resources");
  assert.equal(costShort.engine.state.cards[costShort.id("ct")].faceDown, true);
  const thresholdShort = flipBoard({ rage: 1, greed: 5 });
  refused(() => flip(thresholdShort), "needs two rage icons");
  assert.equal(thresholdShort.engine.state.cards[thresholdShort.id("ct")].faceDown, true);
  const exact = flipBoard({ rage: 2, greed: 2 });
  flip(exact);
  flipAnswer(exact, "decline");
  assert.equal(exact.engine.state.cards[exact.id("ct")].zone, "discard");
});
clause(COT, "2:flipUp", "can't be flipped up from hand or when already face-up", () => {
  const hand = flipBoard({ zone: "hand" });
  refused(() => flip(hand), "card in hand");
  const up = flipBoard({ faceDown: false });
  refused(() => flip(up), "already face-up");
  const ok = flipBoard();
  flip(ok);
  flipAnswer(ok, "decline");
  assert.equal(ok.engine.state.cards[ok.id("ct")].zone, "discard");
});
clause(COT, "2:flipUp", "played as though from hand: still only inside a battle you attack in, and its X deplete cost still applies", () => {
  const outside = flipBoard({ inBattle: false });
  refused(() => flip(outside), "no battle");
  const g = flipBoard();
  refused(() => flip(g, []), "X=1 deplete not paid");
  refused(() => flip(g, ["n1", "n2"]), "too many deplete picks");
  refused(() => flip(g, ["a1"]), "an attacker can't be depleted for it");
  assert.equal(g.engine.state.cards[g.id("ct")].faceDown, true);
  flip(g, ["n2"]);
  flipAnswer(g, "decline");
  assert.deepEqual([...fparty(g)], [g.id("n2")]);
});
clause(COT, "2:flipUp", "may: declining plays no resource", () => {
  const g = flipBoard();
  flip(g);
  flipAnswer(g, "decline");
  assert.equal(pending(g.engine), undefined);
  assert.equal(g.engine.state.cards[g.id("hr")].zone, "hand");
  assert.equal(g.engine.state.cards[g.id("hc")].zone, "hand");
  assert.equal(g.engine.state.cards[g.id("or")].zone, "hand");
});
clause(COT, "2:flipUp", "accepting: the chosen resource card from your hand is put into play as a resource", () => {
  const g = flipBoard();
  flip(g);
  flipAnswer(g, { play: "hr" });
  assert.equal(pending(g.engine), undefined);
  assert.equal(g.engine.state.cards[g.id("hr")].zone, "play");
  assert.equal(g.engine.state.cards[g.id("hc")].zone, "hand", "only the chosen card moves");
  assert.equal(g.engine.getAvailableResourceCount(P1), 3, "6 rage minus 4 paid, plus the new greed resource (the flipped tactic is no longer a resource)");
});
clause(COT, "2:flipUp", "any card from hand can be played as a (face-down) resource", () => {
  const g = flipBoard();
  flip(g);
  flipAnswer(g, { play: "hc" });
  assert.equal(g.engine.state.cards[g.id("hc")].zone, "play");
  assert.equal(g.engine.state.cards[g.id("hc")].faceDown, true, "a non-resource card can only be played face-down");
  assert.equal(g.engine.state.cards[g.id("hr")].zone, "hand");
});
clause(COT, "2:flipUp", "a real resource card played by the effect can be played face-down (CR 203.2: you choose)", () => holdResourceFace(() => {
  const g = flipBoard();
  flip(g);
  drain(g.engine, pc => {
    if (pc.kind === "chooserSelectsOption") return { kind: "chooserSelectsOption", index: 1 };
    if (pc.kind === "chooserSelectsTarget") return { kind: pc.kind, selected: [g.id("hr")] };
    if (pc.kind === "playResource" || /face/i.test(JSON.stringify(pc))) return { kind: pc.kind, faceDown: true, index: 1 };
    return declineAll(pc);
  });
  assert.equal(g.engine.state.cards[g.id("hr")].zone, "play");
  assert.equal(g.engine.state.cards[g.id("hr")].faceDown, true, "the player was able to choose face-down");
}));
clause(COT, "2:flipUp", "the resource must come from your own hand: the opponent's hand, your deck and your play are refused", () => {
  const g = flipBoard();
  flip(g);
  assert.equal((pending(g.engine) as Pc).kind, "chooserSelectsOption");
  assert.equal((pending(g.engine) as Pc).playerId, P1, "its controller decides whether to play a resource");
  answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  const pc = pending(g.engine) as Pc;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "its controller picks the resource");
  const deckTop = g.engine.state.players[P1].deck[0];
  for (const bad of [g.id("or"), deckTop, g.id("a1")]) {
    refused(
      () => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: pc.kind, selected: [bad] } } as never),
      `${bad} is not in your hand`
    );
  }
  answerPending(g.engine, pc.kind, { selected: [g.id("hr")] });
  assert.equal(g.engine.state.cards[g.id("hr")].zone, "play");
  assert.equal(g.engine.state.cards[g.id("or")].zone, "hand");
  assert.notEqual(g.engine.state.cards[deckTop].zone, "play", "the deck card was never played as a resource");
  assert.equal(g.engine.state.cards[g.id("a1")].zone, "play");
});
