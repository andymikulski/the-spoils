import assert from "node:assert/strict";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import {
  buildGame,
  activate,
  bank,
  character,
  developFaction,
  drawerChar,
  item,
  killTactic,
  P1,
  P2,
  play,
  resolvePendingResponses,
  tactic
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, declineAll, drain, printing, refused } from "./_clause.js";
import { fightThrough, playRaw } from "./_battle.js";
import { fillers, pending, zoneOf } from "./_board.js";
import { endTurn, spentResources } from "./_turn.js";

type Pc = { kind: string; playerId: PlayerId; [k: string]: any };
type Board = ReturnType<typeof buildGame>;

const ready = (e: SpoilsEngine, p: PlayerId = P1): number => e.getAvailableResourceCount(p);
const inf = (e: SpoilsEngine, p: PlayerId): number => e.state.players[p].influence;
const dmg = (b: Board, key: string): number => b.engine.state.cards[b.id(key)].damage ?? 0;
const pcOf = (e: SpoilsEngine): Pc | undefined => pending(e) as unknown as Pc | undefined;
const resolveChoice = (e: SpoilsEngine, choice: Record<string, unknown>): void => {
  const pc = pcOf(e)!;
  e.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
  resolvePendingResponses(e);
};
const pickTargets = (e: SpoilsEngine, ids: CardInstanceId[]): void => {
  assert.equal(pcOf(e)?.kind, "chooserSelectsTarget");
  resolveChoice(e, { kind: "chooserSelectsTarget", selected: ids });
};
const MSG = /afford|resource|threshold|cost|pay|icon|enough/i;

// ---------------------------------------------------------------------------------------------
// Shared deploy / UNIQUE checks
// ---------------------------------------------------------------------------------------------

function deployChecks(
  id: string,
  cost: number,
  ok: CardPlacement[],
  oneShort: CardPlacement[],
  iconShort: CardPlacement[]
): void {
  const mk = (cards: CardPlacement[]) =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      random: () => 0.5,
      cards: [{ key: "c", def: printing(id), owner: P1, zone: "hand" }, ...cards]
    });
  const a = mk(ok);
  const before = ready(a.engine);
  play(a.engine, P1, a.id("c"));
  assert.equal(a.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(a.engine, a.id("c")), "play", "deploys with exactly enough");
  assert.equal(before - ready(a.engine), cost, `pays exactly ${cost}`);
  const s = mk(oneShort);
  refused(() => play(s.engine, P1, s.id("c")), `one short of cost ${cost}`, MSG);
  assert.equal(zoneOf(s.engine, s.id("c")), "hand");
  const t = mk(iconShort);
  refused(() => play(t.engine, P1, t.id("c")), "threshold not met", MSG);
  assert.equal(zoneOf(t.engine, t.id("c")), "hand");
}

function uniqueChecks(id: string, otherId: string): void {
  const mk = (extra: CardPlacement[]) =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      random: () => 0.5,
      cards: [...bank("rage", 5, P1), ...bank("rage", 5, P2), ...extra]
    });
  // a second copy / the other Elzibeth: keep one, the other is destroyed
  const b = mk([
    { key: "a", def: printing(otherId), owner: P1, zone: "play" },
    { key: "b", def: printing(id), owner: P1, zone: "hand" }
  ]);
  play(b.engine, P1, b.id("b"));
  const pc = pcOf(b.engine)!;
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [b.id("a"), b.id("b")].sort());
  resolveChoice(b.engine, { kind: "uniqueSurvivor", keep: b.id("b") });
  assert.equal(zoneOf(b.engine, b.id("b")), "play");
  assert.equal(zoneOf(b.engine, b.id("a")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
  // keep the original instead
  const c = mk([
    { key: "a", def: printing(otherId), owner: P1, zone: "play" },
    { key: "b", def: printing(id), owner: P1, zone: "hand" }
  ]);
  play(c.engine, P1, c.id("b"));
  resolveChoice(c.engine, { kind: "uniqueSurvivor", keep: c.id("a") });
  assert.equal(zoneOf(c.engine, c.id("a")), "play");
  assert.equal(zoneOf(c.engine, c.id("b")), "discard");
  // UNIQUE is per player: the opponent's copy neither prompts nor is removed
  const d = mk([
    { key: "a", def: printing(otherId), owner: P2, zone: "play" },
    { key: "b", def: printing(id), owner: P1, zone: "hand" }
  ]);
  play(d.engine, P1, d.id("b"));
  assert.equal(d.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(d.engine, d.id("a")), "play");
  assert.equal(zoneOf(d.engine, d.id("b")), "play");
  // another name is not affected
  const e = mk([
    { key: "a", def: character({ name: "Somebody Else", unique: "somebody else" }), owner: P1, zone: "play" },
    { key: "b", def: printing(id), owner: P1, zone: "hand" }
  ]);
  play(e.engine, P1, e.id("b"));
  assert.equal(e.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(e.engine, e.id("a")), "play");
}

// =============================================================================================
// Drill Garrison -- location (warlord), cost 3, threshold [R], structure 5
// =============================================================================================

const DG = "6d4b0079-550c-4cea-a2a0-ff889c523ab2";

interface DgOpts {
  rage?: number;
  greed?: number;
  spent?: number;
  dgZone?: "play" | "hand" | "discard";
  dgController?: PlayerId;
  p2Rage?: number;
}
function dgBoard(o: DgOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    random: () => 0.5,
    cards: [
      { key: "dg", def: printing(DG), owner: P1, zone: o.dgZone ?? "play", ...(o.dgController ? { controller: o.dgController } : {}) },
      { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine Two", life: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe Two", life: 2 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      { key: "gone", def: character({ name: "Gone", life: 5 }), owner: P2, zone: "discard" },
      ...bank("rage", o.rage ?? 0, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...spentResources(P1, o.spent ?? 0),
      ...bank("rage", o.p2Rage ?? 0, P2),
      ...fillers("pd", 4, P1, "deck"),
      ...fillers("qd", 4, P2, "deck")
    ]
  });
}
type DgBoard = ReturnType<typeof dgBoard>;
const startOfP1 = (b: Board) => endTurn(b.engine, P2);

interface Plan {
  opt?: number;
  deplete?: CardInstanceId[];
  damage?: CardInstanceId[];
}
/** Answers every prompt of the start-of-turn triggers; returns which prompts appeared (sorted). */
function runStart(b: Board, plan: Plan = {}): string[] {
  const seen: string[] = [];
  drain(b.engine, (raw) => {
    const pc = raw as unknown as Pc;
    if (pc.kind === "orderTriggers") return { kind: "orderTriggers", next: pc.triggers[0] };
    if (pc.kind === "chooserSelectsOption") {
      seen.push(`option:${pc.playerId}`);
      return { kind: pc.kind, index: plan.opt ?? 0 };
    }
    if (pc.kind === "chooserSelectsTarget") {
      const fx = JSON.stringify(pc.effects);
      const k = fx.includes('"deplete"') ? "deplete" : fx.includes('"dealDamage"') ? "damage2" : "other";
      seen.push(`${k}:${pc.playerId}`);
      return { kind: pc.kind, selected: (k === "deplete" ? plan.deplete : plan.damage) ?? [] };
    }
    throw new Error(`unexpected prompt ${pc.kind}`);
  });
  return seen.sort();
}

clause(DG, "0:unique", "printed card: a warlord location, cost 3, threshold [R], structure 5, UNIQUE", () => {
  const p = printing(DG);
  assert.equal(p.type, "location");
  assert.equal(p.trade, "warlord");
  const b = dgBoard();
  assert.equal(b.engine.getStat(b.id("dg"), "structure"), 5);
  assert.equal(b.engine.getDefinition(b.id("dg")).unique, "drill garrison");
});

clause(DG, "0:unique", "deploys for exactly 3 resources with one [R]; one short and no [R] are refused", () => {
  deployChecks(
    DG,
    3,
    [...bank("rage", 1, P1), ...bank("greed", 2, P1)],
    [...bank("rage", 1, P1), ...bank("greed", 1, P1)],
    bank("greed", 3, P1)
  );
  // a spent [R] still supplies the threshold; the cost is paid by ready resources
  deployChecks(
    DG,
    3,
    [...spentResources(P1, 1), ...bank("greed", 3, P1)],
    [...spentResources(P1, 1), ...bank("greed", 2, P1)],
    bank("greed", 3, P1)
  );
});

clause(DG, "0:unique", "UNIQUE: a second Drill Garrison makes you keep one; the opponent's copy is separate", () => {
  uniqueChecks(DG, DG);
});

clause(DG, "1:rule@rrr", "with [R][R][R] at the start of your turn you may inflict 1 damage to the opponent's faction", () => {
  const acc = dgBoard({ rage: 3 });
  startOfP1(acc);
  const pc = pcOf(acc.engine)!;
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P1, "the controller chooses");
  assert.equal(acc.engine.state.activePlayerId, P1);
  const i0 = inf(acc.engine, P2);
  const mine0 = inf(acc.engine, P1);
  resolveChoice(acc.engine, { kind: "chooserSelectsOption", index: 1 });
  assert.equal(acc.engine.state.pendingChoice, undefined);
  assert.equal(inf(acc.engine, P2), i0 - 1, "the opponent's faction takes exactly 1");
  assert.equal(inf(acc.engine, P1), mine0, "not your own faction");
  for (const k of ["mine", "mine2", "foe", "foe2"]) assert.equal(dmg(acc, k), 0, `${k} takes nothing`);
  const dec = dgBoard({ rage: 3 });
  startOfP1(dec);
  const d0 = inf(dec.engine, P2);
  resolveChoice(dec.engine, { kind: "chooserSelectsOption", index: 0 });
  assert.equal(dec.engine.state.pendingChoice, undefined);
  assert.equal(inf(dec.engine, P2), d0, "declining inflicts nothing");
  assert.equal(inf(dec.engine, P1), mine0);
});

clause(DG, "1:rule@rrr", "needs three [R]: two [R], or three non-[R] resources, do nothing", () => {
  const few = dgBoard({ rage: 2 });
  startOfP1(few);
  assert.equal(few.engine.state.pendingChoice, undefined, "two [R]");
  assert.equal(inf(few.engine, P2), 30);
  const mixed = dgBoard({ rage: 2, greed: 3 });
  startOfP1(mixed);
  assert.equal(mixed.engine.state.pendingChoice, undefined, "two [R] + three [G]");
  const ok = dgBoard({ rage: 3 });
  startOfP1(ok);
  assert.equal(pcOf(ok.engine)?.kind, "chooserSelectsOption", "control: three [R]");
  const more = dgBoard({ rage: 3, greed: 2 });
  startOfP1(more);
  assert.deepEqual(runStart(more, { opt: 1 }), ["option:p1"], "extra non-[R] resources change nothing");
  assert.equal(inf(more.engine, P2), 29);
});

clause(DG, "1:rule@rrr", "spent [R] resources still meet the threshold", () => {
  const b = dgBoard({ spent: 3 });
  startOfP1(b);
  assert.deepEqual(runStart(b, { opt: 1 }), ["option:p1"]);
  assert.equal(inf(b.engine, P2), 29);
});

clause(DG, "1:rule@rrr", "only at the start of YOUR turn, only while in play, once per turn", () => {
  const opp = dgBoard({ rage: 3 });
  opp.engine.state.activePlayerId = P1;
  endTurn(opp.engine, P1); // P2's turn begins
  assert.equal(opp.engine.state.activePlayerId, P2);
  assert.equal(opp.engine.state.pendingChoice, undefined, "the opponent's turn start does nothing");
  assert.equal(inf(opp.engine, P2), 30);
  assert.equal(inf(opp.engine, P1), 30);
  const hand = dgBoard({ rage: 3, dgZone: "hand" });
  startOfP1(hand);
  assert.equal(hand.engine.state.pendingChoice, undefined, "in hand");
  const gy = dgBoard({ rage: 3, dgZone: "discard" });
  startOfP1(gy);
  assert.equal(gy.engine.state.pendingChoice, undefined, "in the discard pile");
  const again = dgBoard({ rage: 3 });
  startOfP1(again);
  resolveChoice(again.engine, { kind: "chooserSelectsOption", index: 1 });
  assert.equal(inf(again.engine, P2), 29);
  endTurn(again.engine, P1);
  assert.equal(again.engine.state.pendingChoice, undefined, "no prompt on the opponent's turn");
  endTurn(again.engine, P2);
  assert.equal(pcOf(again.engine)?.kind, "chooserSelectsOption", "asks again on your next turn");
  resolveChoice(again.engine, { kind: "chooserSelectsOption", index: 1 });
  assert.equal(inf(again.engine, P2), 28);
});

clause(DG, "1:rule@rrr", "'your turn' is its controller's: a Garrison you control but the opponent owns triggers on your turn and hits the other player", () => {
  const b = dgBoard({ dgController: P2, p2Rage: 3 });
  b.engine.state.activePlayerId = P1;
  endTurn(b.engine, P1); // P2's turn
  const pc = pcOf(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P2, "its controller chooses");
  resolveChoice(b.engine, { kind: "chooserSelectsOption", index: 1 });
  assert.equal(inf(b.engine, P1), 29, "the controller's opponent is hit");
  assert.equal(inf(b.engine, P2), 30);
  // the owner's resources are irrelevant when someone else controls it
  const c = dgBoard({ dgController: P2, rage: 3 });
  c.engine.state.activePlayerId = P1;
  endTurn(c.engine, P1);
  assert.equal(c.engine.state.pendingChoice, undefined, "the controller's [R] count, not the owner's");
});

clause(DG, "1:rule@rrr", "with [R][R][R] only the damage prompt appears (no pick prompts)", () => {
  const b = dgBoard({ rage: 4 });
  startOfP1(b);
  assert.deepEqual(runStart(b, { opt: 1 }), ["option:p1"]);
  assert.equal(inf(b.engine, P2), 29);
});

clause(DG, "2:rule@rrrrr", "with five [R] you may pick a character and deplete it (yours or the opponent's)", () => {
  const foe = dgBoard({ rage: 5 });
  startOfP1(foe);
  const seen = runStart(foe, { deplete: [foe.id("foe")] });
  assert.deepEqual(seen, ["deplete:p1", "option:p1"], "the 3-[R] option still appears, plus one pick");
  assert.equal(foe.engine.state.cards[foe.id("foe")].depleted, true);
  assert.equal(dmg(foe, "foe"), 0, "depleting deals no damage");
  for (const k of ["mine", "mine2", "foe2"]) assert.notEqual(foe.engine.state.cards[foe.id(k)].depleted, true, `${k} stays ready`);
  const own = dgBoard({ rage: 5 });
  startOfP1(own);
  runStart(own, { deplete: [own.id("mine")] });
  assert.equal(own.engine.state.cards[own.id("mine")].depleted, true);
  assert.notEqual(own.engine.state.cards[own.id("foe")].depleted, true);
  assert.equal(inf(own.engine, P2), 30, "the option was declined, so no faction damage");
});

clause(DG, "2:rule@rrrrr", "the pick is optional: declining depletes nothing", () => {
  const b = dgBoard({ rage: 5 });
  startOfP1(b);
  runStart(b, {});
  for (const k of ["mine", "mine2", "foe", "foe2"]) assert.notEqual(b.engine.state.cards[b.id(k)].depleted, true, k);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(DG, "2:rule@rrrrr", "only characters in play can be picked: items, discard-pile characters and the faction are refused", () => {
  const mk = () => {
    const b = dgBoard({ rage: 5 });
    startOfP1(b);
    // advance through the option prompt
    if (pcOf(b.engine)?.kind === "orderTriggers") resolveChoice(b.engine, { kind: "orderTriggers", next: pcOf(b.engine)!.triggers[0] });
    if (pcOf(b.engine)?.kind === "chooserSelectsOption") resolveChoice(b.engine, { kind: "chooserSelectsOption", index: 0 });
    return b;
  };
  const probe = (key: string | undefined) => {
    const b = mk();
    assert.equal(pcOf(b.engine)?.kind, "chooserSelectsTarget");
    const id = key === "faction" ? b.engine.state.players[P2].factionId! : b.id(key!);
    return () => pickTargets(b.engine, [id]);
  };
  refused(probe("gear"), "an item is not a character");
  refused(probe("gone"), "a character in the discard pile is not in play");
  refused(probe("faction"), "a faction is not a character");
  const ok = mk();
  pickTargets(ok.engine, [ok.id("foe2")]);
  assert.equal(ok.engine.state.cards[ok.id("foe2")].depleted, true, "control: a character in play");
});

clause(DG, "2:rule@rrrrr", "needs five [R]: four [R] gives no pick prompt; spent [R] count", () => {
  const four = dgBoard({ rage: 4, greed: 3 });
  startOfP1(four);
  assert.deepEqual(runStart(four), ["option:p1"], "four [R] + three [G]");
  const spent = dgBoard({ rage: 2, spent: 3 });
  startOfP1(spent);
  assert.deepEqual(runStart(spent, { deplete: [spent.id("foe")] }), ["deplete:p1", "option:p1"], "two ready + three spent [R]");
  assert.equal(spent.engine.state.cards[spent.id("foe")].depleted, true);
});

clause(DG, "2:rule@rrrrr", "only at the start of your turn and only while in play", () => {
  const opp = dgBoard({ rage: 5 });
  opp.engine.state.activePlayerId = P1;
  endTurn(opp.engine, P1);
  assert.equal(opp.engine.state.pendingChoice, undefined);
  const hand = dgBoard({ rage: 5, dgZone: "hand" });
  startOfP1(hand);
  assert.equal(hand.engine.state.pendingChoice, undefined);
  const ok = dgBoard({ rage: 5 });
  startOfP1(ok);
  assert.ok(pcOf(ok.engine), "pcOf(ok.engine)");
});

/** Advances the start-of-turn prompts (order / option) until the pick prompt for `want` is pending. */
function dgPickPrompt(b: Board, want: "deplete" | "dealDamage"): void {
  for (let i = 0; i < 10; i++) {
    const pc = pcOf(b.engine);
    assert.ok(pc, `a prompt is pending while looking for the ${want} pick`);
    if (pc.kind === "orderTriggers") resolveChoice(b.engine, { kind: "orderTriggers", next: pc.triggers[0] });
    else if (pc.kind === "chooserSelectsOption") resolveChoice(b.engine, { kind: "chooserSelectsOption", index: 0 });
    else if (pc.kind === "chooserSelectsTarget") {
      if (JSON.stringify(pc.effects).includes(`"${want}"`)) return;
      resolveChoice(b.engine, { kind: "chooserSelectsTarget", selected: [] });
    } else throw new Error(`unexpected prompt ${pc.kind}`);
  }
  throw new Error(`no ${want} pick prompt appeared`);
}

clause(DG, "2:rule@rrrrr", "'pick a character' means ONE character: picking two at once is refused, one is fine", () => {
  const two = dgBoard({ rage: 5 });
  startOfP1(two);
  dgPickPrompt(two, "deplete");
  refused(() => pickTargets(two.engine, [two.id("foe"), two.id("foe2")]), "two characters picked for a single-character pick");
  for (const k of ["foe", "foe2"]) assert.notEqual(two.engine.state.cards[two.id(k)].depleted, true, `${k} was not depleted by the refused pick`);
  const one = dgBoard({ rage: 5 });
  startOfP1(one);
  dgPickPrompt(one, "deplete");
  pickTargets(one.engine, [one.id("foe")]);
  assert.equal(one.engine.state.cards[one.id("foe")].depleted, true, "control: a single pick works");
  assert.notEqual(one.engine.state.cards[one.id("foe2")].depleted, true, "only the one picked character is depleted");
});

clause(DG, "3:rule@rrrrrrr", "with seven [R] you may pick a character and it takes 2 damage (yours or the opponent's)", () => {
  const foe = dgBoard({ rage: 7 });
  startOfP1(foe);
  const seen = runStart(foe, { damage: [foe.id("foe")] });
  assert.deepEqual(seen, ["damage2:p1", "deplete:p1", "option:p1"], "all three rules are live at 7 [R]");
  assert.equal(dmg(foe, "foe"), 2, "exactly 2 damage");
  assert.equal(foe.engine.state.cards[foe.id("foe")].depleted !== true, true, "the 2-damage target is not depleted (that pick was declined)");
  assert.equal(zoneOf(foe.engine, foe.id("foe")), "play", "life 5 survives 2");
  for (const k of ["mine", "mine2", "foe2"]) assert.equal(dmg(foe, k), 0, k);
  const own = dgBoard({ rage: 7 });
  startOfP1(own);
  runStart(own, { damage: [own.id("mine")] });
  assert.equal(dmg(own, "mine"), 2);
  assert.equal(dmg(own, "foe"), 0);
});

clause(DG, "3:rule@rrrrrrr", "'pick a character' means ONE character: picking two at once is refused, one is fine", () => {
  const two = dgBoard({ rage: 7 });
  startOfP1(two);
  dgPickPrompt(two, "dealDamage");
  refused(() => pickTargets(two.engine, [two.id("foe"), two.id("foe2")]), "two characters picked for a single-character pick");
  for (const k of ["foe", "foe2"]) assert.equal(dmg(two, k), 0, `${k} took no damage from the refused pick`);
  const one = dgBoard({ rage: 7 });
  startOfP1(one);
  dgPickPrompt(one, "dealDamage");
  pickTargets(one.engine, [one.id("foe")]);
  assert.equal(dmg(one, "foe"), 2, "control: a single pick takes 2 damage");
  assert.equal(dmg(one, "foe2"), 0, "only the one picked character takes damage");
});

clause(DG, "3:rule@rrrrrrr", "2 damage destroys a life-2 character; declining inflicts nothing", () => {
  const b = dgBoard({ rage: 7 });
  startOfP1(b);
  runStart(b, { damage: [b.id("foe2")] });
  assert.equal(zoneOf(b.engine, b.id("foe2")), "discard");
  const own = dgBoard({ rage: 7 });
  startOfP1(own);
  runStart(own, { damage: [own.id("mine2")] });
  assert.equal(zoneOf(own.engine, own.id("mine2")), "discard");
  const dec = dgBoard({ rage: 7 });
  startOfP1(dec);
  runStart(dec, {});
  for (const k of ["mine", "mine2", "foe", "foe2"]) assert.equal(dmg(dec, k), 0, k);
  assert.equal(zoneOf(dec.engine, dec.id("foe2")), "play");
});

clause(DG, "3:rule@rrrrrrr", "all three rules stack at seven [R]: faction damage, deplete one, 2 damage to another", () => {
  const b = dgBoard({ rage: 7 });
  startOfP1(b);
  runStart(b, { opt: 1, deplete: [b.id("mine")], damage: [b.id("foe")] });
  assert.equal(inf(b.engine, P2), 29);
  assert.equal(b.engine.state.cards[b.id("mine")].depleted, true);
  assert.equal(dmg(b, "mine"), 0);
  assert.equal(dmg(b, "foe"), 2);
  assert.notEqual(b.engine.state.cards[b.id("foe")].depleted, true);
});

clause(DG, "3:rule@rrrrrrr", "needs seven [R]: six [R] gives no damage-pick; only picks characters in play", () => {
  const six = dgBoard({ rage: 6, greed: 3 });
  startOfP1(six);
  assert.deepEqual(runStart(six, { damage: [six.id("foe")] }), ["deplete:p1", "option:p1"]);
  assert.equal(dmg(six, "foe"), 0);
  const spent = dgBoard({ rage: 3, spent: 4 });
  startOfP1(spent);
  assert.deepEqual(runStart(spent, { damage: [spent.id("foe")] }), ["damage2:p1", "deplete:p1", "option:p1"], "spent [R] count");
  assert.equal(dmg(spent, "foe"), 2);
  const toDamagePick = () => {
    const b = dgBoard({ rage: 7 });
    startOfP1(b);
    for (let i = 0; i < 10; i++) {
      const pc = pcOf(b.engine)!;
      if (pc.kind === "chooserSelectsTarget" && JSON.stringify(pc.effects).includes('"dealDamage"')) return b;
      resolveChoice(
        b.engine,
        pc.kind === "orderTriggers"
          ? { kind: pc.kind, next: pc.triggers[0] }
          : pc.kind === "chooserSelectsOption"
            ? { kind: pc.kind, index: 0 }
            : { kind: pc.kind, selected: [] }
      );
    }
    throw new Error("no damage pick reached");
  };
  for (const [key, why] of [["gear", "an item"], ["gone", "a character in the discard pile"]] as const) {
    const b = toDamagePick();
    refused(() => pickTargets(b.engine, [b.id(key)]), why, /target|select|invalid|illegal|character/i);
  }
  const ok = toDamagePick();
  pickTargets(ok.engine, [ok.id("foe")]);
  assert.equal(dmg(ok, "foe"), 2, "control: a character in play");
});
clause(DG, "3:rule@rrrrrrr", "only at the start of your turn and only while in play", () => {
  const opp = dgBoard({ rage: 7 });
  opp.engine.state.activePlayerId = P1;
  endTurn(opp.engine, P1);
  assert.equal(opp.engine.state.pendingChoice, undefined);
  const hand = dgBoard({ rage: 7, dgZone: "hand" });
  startOfP1(hand);
  assert.equal(hand.engine.state.pendingChoice, undefined);
});

// =============================================================================================
// Ecneret, The Expendable One -- character (warlord fighter soldier) cost 5, [R][R][R][R], 4/3/4
// =============================================================================================

const EC = "c01d8a16-a49a-46b0-92ec-749e44604904";

interface EcOpts {
  active?: PlayerId;
}
function ecBoard(o: EcOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: o.active ?? P2,
    random: () => 0.5,
    cards: [
      { key: "ec", def: printing(EC), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 2 }), owner: P1, zone: "play" },
      { key: "ally2", def: character({ name: "Ally Two", strength: 1, life: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 2 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      { key: "later", def: character({ name: "Later", strength: 1, life: 1, cost: 0 }), owner: P1, zone: "hand" },
      { key: "killOpp", def: killTactic({ name: "Kill Opp" }), owner: P2, zone: "hand" },
      { key: "killOwn", def: killTactic({ name: "Kill Own" }), owner: P1, zone: "hand" },
      {
        key: "bounce",
        def: tactic({
          name: "Bounce",
          cost: 0,
          behavior: {
            abilities: [
              {
                id: "b",
                type: "activated",
                targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
                effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
              }
            ]
          }
        }),
        owner: P2,
        zone: "hand"
      },
      { key: "noop", def: tactic({ name: "Noop", cost: 0, behavior: { abilities: [{ id: "n", type: "activated", effects: [] }] } }), owner: P1, zone: "hand" },
      ...bank("rage", 4, P1),
      ...bank("rage", 4, P2),
      ...fillers("pd", 3, P1, "deck"),
      ...fillers("qd", 3, P2, "deck")
    ]
  });
}
type EcBoard = ReturnType<typeof ecBoard>;
const str = (b: Board, k: string) => b.engine.getStat(b.id(k), "strength");
const life = (b: Board, k: string) => b.engine.getStat(b.id(k), "life");
const oppKillsEcneret = (b: EcBoard) => {
  play(b.engine, P2, b.id("killOpp"), { selected: { t: [b.id("ec")] } });
  drain(b.engine, declineAll);
};

clause(EC, "0:unique", "printed card: a warlord fighter/soldier, cost 5, threshold [R][R][R][R], 4 strength / 3 speed / 4 life", () => {
  const p = printing(EC);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "warlord");
  assert.deepEqual([...p.subtype].sort(), ["fighter", "soldier"]);
  const b = ecBoard();
  assert.equal(str(b, "ec"), 4);
  assert.equal(b.engine.getStat(b.id("ec"), "speed"), 3);
  assert.equal(life(b, "ec"), 4);
  assert.equal(b.engine.getDefinition(b.id("ec")).unique, "ecneret");
});

clause(EC, "0:unique", "deploys for exactly 5 resources with four [R]; one short and an [R] short are refused", () => {
  deployChecks(EC, 5, [...bank("rage", 4, P1), ...bank("greed", 1, P1)], bank("rage", 4, P1), [...bank("rage", 3, P1), ...bank("greed", 2, P1)]);
  deployChecks(EC, 5, bank("rage", 5, P1), [...bank("rage", 3, P1), ...bank("greed", 1, P1)], [...bank("rage", 2, P1), ...bank("greed", 3, P1)]);
});

clause(EC, "0:unique", "UNIQUE: a second Ecneret makes you keep one; the opponent's copy is separate", () => {
  uniqueChecks(EC, EC);
});

clause(EC, "1:rule", "destroyed by an opposing card: every character you control gains +2 strength and +2 life", () => {
  const b = ecBoard();
  oppKillsEcneret(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("ec")), "discard");
  assert.equal(str(b, "ally"), 4, "2 + 2");
  assert.equal(life(b, "ally"), 4, "2 + 2");
  assert.equal(str(b, "ally2"), 3, "1 + 2");
  assert.equal(life(b, "ally2"), 5, "3 + 2");
  assert.equal(str(b, "foe"), 2, "the opponent's character is unchanged");
  assert.equal(life(b, "foe"), 2);
});

clause(EC, "1:rule", "only characters present when it resolves, and only characters you control: later arrivals, items and the opponent's are untouched", () => {
  const b = ecBoard();
  oppKillsEcneret(b);
  b.engine.state.activePlayerId = P1;
  play(b.engine, P1, b.id("later"));
  assert.equal(zoneOf(b.engine, b.id("later")), "play");
  assert.equal(str(b, "later"), 1, "a character that arrives afterwards gets no bonus");
  assert.equal(life(b, "later"), 1);
  assert.equal(str(b, "foe"), 2);
  assert.equal(life(b, "foe"), 2);
});

clause(EC, "1:rule", "only CHARACTERS you control gain the bonus: an item you control gets no strength or life", () => {
  const b = ecBoard();
  const gearStr = str(b, "gear");
  const gearLife = life(b, "gear");
  oppKillsEcneret(b);
  assert.equal(str(b, "ally"), 4, "control: a character you control did gain +2 strength");
  assert.equal(str(b, "gear"), gearStr, "an item's strength is unchanged");
  assert.equal(life(b, "gear"), gearLife, "an item's life is unchanged");
});

clause(EC, "1:rule", "the bonus lasts until the END of your next turn (killed on the opponent's turn)", () => {
  const b = ecBoard();
  oppKillsEcneret(b);
  assert.equal(str(b, "ally"), 4);
  endTurn(b.engine, P2); // your turn begins
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(str(b, "ally"), 4, "still +2 strength during your next turn");
  assert.equal(life(b, "ally"), 4, "still +2 life during your next turn");
  endTurn(b.engine, P1); // ... and gone once it ends
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(str(b, "ally"), 2, "gone after the end of your next turn");
  assert.equal(life(b, "ally"), 2);
  assert.equal(str(b, "ally2"), 1);
  endTurn(b.engine, P2);
  assert.equal(str(b, "ally"), 2, "stays gone");
});

clause(EC, "1:rule", "destroyed during your own turn the bonus lasts through the opponent's turn and your NEXT turn", () => {
  const b = ecBoard({ active: P1 });
  playRaw(b.engine, P1, b.id("noop"));
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId ?? P2, P2);
  play(b.engine, P2, b.id("killOpp"), { selected: { t: [b.id("ec")] } });
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("ec")), "discard");
  assert.equal(str(b, "ally"), 4, "bonus right away");
  endTurn(b.engine, P1); // the opponent's turn
  assert.equal(str(b, "ally"), 4, "still on during the opponent's turn");
  endTurn(b.engine, P2); // your next turn
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(str(b, "ally"), 4, "still on during your next turn");
  assert.equal(life(b, "ally"), 4);
  endTurn(b.engine, P1);
  assert.equal(str(b, "ally"), 2, "gone after the end of your next turn");
  assert.equal(life(b, "ally"), 2);
});

clause(EC, "1:rule", "destroyed by an opposing character in battle also counts as destroyed by an opposing card", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    random: () => 0.5,
    cards: [
      { key: "ec", def: printing(EC), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 2 }), owner: P1, zone: "play" },
      { key: "wall", def: character({ name: "Wall", strength: 6, life: 6 }), owner: P2, zone: "play" },
      ...fillers("pd", 3, P1, "deck"),
      ...fillers("qd", 3, P2, "deck")
    ]
  });
  fightThrough(b.engine, P1, [b.id("ec")], { type: "faction", playerId: P2 }, [b.id("wall")]);
  assert.equal(zoneOf(b.engine, b.id("ec")), "discard");
  assert.equal(str(b, "ally"), 4);
  assert.equal(life(b, "ally"), 4);
});

clause(EC, "1:rule", "NOT when destroyed by your own card", () => {
  const b = ecBoard({ active: P1 });
  play(b.engine, P1, b.id("killOwn"), { selected: { t: [b.id("ec")] } });
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("ec")), "discard");
  assert.equal(str(b, "ally"), 2, "no bonus when you destroy it yourself");
  assert.equal(life(b, "ally"), 2);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(EC, "1:rule", "NOT when it leaves play without being destroyed, or when another character is destroyed", () => {
  const b = ecBoard();
  play(b.engine, P2, b.id("bounce"), { selected: { t: [b.id("ec")] } });
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("ec")), "hand");
  assert.equal(str(b, "ally"), 2, "returned to hand: no bonus");
  const c = ecBoard();
  play(c.engine, P2, c.id("killOpp"), { selected: { t: [c.id("ally")] } });
  drain(c.engine, declineAll);
  assert.equal(zoneOf(c.engine, c.id("ally")), "discard");
  assert.equal(zoneOf(c.engine, c.id("ec")), "play");
  assert.equal(str(c, "ally2"), 1, "another character dying gives nothing");
  assert.equal(str(c, "ec"), 4);
  assert.equal(c.engine.state.pendingChoice, undefined);
});

// =============================================================================================
// Elzibeth, Counter Imperial Countess -- character (warlord sorceress) cost 4, [R][R][R], 2/3/4
// =============================================================================================

const ELC = "472869a7-6459-4c1c-bf08-b7b9c6ce81fd";
const ELM = "591397e5-8bfc-40ec-bf0b-f3050b724b22";

interface ElcOpts {
  rage?: number;
  depleted?: boolean;
  active?: PlayerId;
}
function elcBoard(o: ElcOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: o.active ?? P1,
    random: () => 0.5,
    cards: [
      { key: "el", def: printing(ELC), owner: P1, zone: "play", ...(o.depleted ? { depleted: true } : {}) },
      { key: "ward", def: character({ name: "Ward", life: 3 }), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other", life: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 3, strength: 6 }), owner: P2, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen", life: 3 }), owner: P2, controller: P1, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      { key: "gone", def: character({ name: "Gone", life: 3 }), owner: P1, zone: "discard" },
      { key: "killA", def: killTactic({ name: "Kill A" }), owner: P1, zone: "hand" },
      { key: "killB", def: killTactic({ name: "Kill B" }), owner: P2, zone: "hand" },
      ...bank("rage", o.rage ?? 5, P1),
      ...bank("rage", 3, P2),
      ...fillers("pd", 3, P1, "deck"),
      ...fillers("qd", 3, P2, "deck")
    ]
  });
}
type ElcBoard = ReturnType<typeof elcBoard>;
const ward = (b: ElcBoard, key: string) => activate(b.engine, P1, b.id("el"), "keepemcoming", { selected: { ward: [b.id(key)] } });
const killWith = (b: ElcBoard, killer: string, player: PlayerId, victim: string) => {
  play(b.engine, player, b.id(killer), { selected: { t: [b.id(victim)] } });
  drain(b.engine, declineAll);
};

clause(ELC, "0:unique", "printed card: a warlord sorceress, cost 4, threshold [R][R][R], 2 strength / 3 speed / 4 life", () => {
  const p = printing(ELC);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "warlord");
  assert.deepEqual([...p.subtype], ["sorceress"]);
  const b = elcBoard();
  assert.equal(str(b, "el"), 2);
  assert.equal(b.engine.getStat(b.id("el"), "speed"), 3);
  assert.equal(life(b, "el"), 4);
  assert.equal(b.engine.getDefinition(b.id("el")).unique, "elzibeth");
});

clause(ELC, "0:unique", "deploys for exactly 4 resources with three [R]; one short and an [R] short are refused", () => {
  deployChecks(ELC, 4, [...bank("rage", 3, P1), ...bank("greed", 1, P1)], bank("rage", 3, P1), [...bank("rage", 2, P1), ...bank("greed", 2, P1)]);
  deployChecks(ELC, 4, bank("rage", 4, P1), [...bank("rage", 2, P1), ...bank("greed", 1, P1)], bank("greed", 4, P1));
});

clause(ELC, "0:unique", "UNIQUE ELZIBETH: shares its name with Elzibeth, Military Sorceress; a second copy or the other Elzibeth makes you keep one", () => {
  uniqueChecks(ELC, ELC);
  uniqueChecks(ELC, ELM);
});

clause(ELC, "1:ability:keepemcoming", "COST: pays 3 resources, depletes this card, and picks a character", () => {
  const b = elcBoard();
  const before = ready(b.engine);
  playRawActivate(b, "ward");
  assert.equal(before - ready(b.engine), 3, "Pay 3");
  assert.equal(b.engine.state.cards[b.id("el")].depleted, true, "Deplete this card");
});
function playRawActivate(b: ElcBoard, key: string) {
  ward(b, key);
}

clause(ELC, "1:ability:keepemcoming", "can't be used with only 2 resources, while depleted, or without a picked character", () => {
  const ok = elcBoard({ rage: 3 });
  ward(ok, "ward");
  assert.equal(ok.engine.state.cards[ok.id("el")].depleted, true, "control: exactly 3 resources");
  const short = elcBoard({ rage: 2 });
  refused(() => ward(short, "ward"), "only 2 resources", MSG);
  assert.notEqual(short.engine.state.cards[short.id("el")].depleted, true);
  const dep = elcBoard({ depleted: true });
  refused(() => ward(dep, "ward"), "depleted", /deplete|ready|exhaust|cost/i);
  const none = elcBoard();
  refused(() => activate(none.engine, P1, none.id("el"), "keepemcoming", { selected: {} }), "no character picked", /target|select|pick|character/i);
  assert.equal(ready(none.engine), 5);
  const spent = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "el", def: printing(ELC), owner: P1, zone: "play" },
      { key: "ward", def: character({ name: "Ward", life: 3 }), owner: P1, zone: "play" },
      ...bank("rage", 2, P1),
      ...spentResources(P1, 2)
    ]
  });
  refused(() => activate(spent.engine, P1, spent.id("el"), "keepemcoming", { selected: { ward: [spent.id("ward")] } }), "spent resources can't pay", MSG);
});

clause(ELC, "1:ability:keepemcoming", "the pick must be a character in play: items and discard-pile characters are refused; yours, the opponent's and herself are fine", () => {
  const item1 = elcBoard();
  refused(() => ward(item1, "gear"), "an item", /target|select|invalid|illegal|character/i);
  const gone = elcBoard();
  refused(() => ward(gone, "gone"), "discard pile", /target|select|invalid|illegal|character/i);
  for (const key of ["ward", "foe", "stolen", "el"]) {
    const b = elcBoard();
    ward(b, key);
    assert.equal(b.engine.state.cards[b.id("el")].depleted, true, `${key} is pickable`);
  }
});

clause(ELC, "1:ability:keepemcoming", "the picked character, if it would be destroyed this turn, goes on top of its owner's deck instead", () => {
  const b = elcBoard();
  const deck0 = [...b.engine.state.players[P1].deck];
  ward(b, "ward");
  killWith(b, "killA", P1, "ward");
  assert.equal(zoneOf(b.engine, b.id("ward")), "deck", "not in the discard pile");
  const deck1 = b.engine.state.players[P1].deck;
  assert.equal(deck1[0], b.id("ward"), "on top");
  assert.deepEqual(deck1.slice(1), deck0, "the rest of the deck is untouched and in order");
  assert.equal(b.engine.state.players[P1].discard.includes(b.id("ward")), false);
  assert.equal(b.engine.state.pendingChoice, undefined, "no optional prompt: 'instead' is mandatory");
});

clause(ELC, "1:ability:keepemcoming", "it is drawn next from the top of the deck", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "el", def: printing(ELC), owner: P1, zone: "play" },
      { key: "ward", def: character({ name: "Ward", life: 3 }), owner: P1, zone: "play" },
      { key: "drawer", def: drawerChar(), owner: P1, zone: "play" },
      { key: "killA", def: killTactic({ name: "Kill A" }), owner: P1, zone: "hand" },
      ...bank("rage", 4, P1),
      ...fillers("pd", 3, P1, "deck")
    ]
  });
  activate(b.engine, P1, b.id("el"), "keepemcoming", { selected: { ward: [b.id("ward")] } });
  play(b.engine, P1, b.id("killA"), { selected: { t: [b.id("ward")] } });
  drain(b.engine, declineAll);
  activate(b.engine, P1, b.id("drawer"), "draw1", {});
  assert.ok(b.engine.state.players[P1].hand.includes(b.id("ward")), "the warded character is the card drawn");
});

clause(ELC, "1:ability:keepemcoming", "only the picked character is protected; others are destroyed normally", () => {
  const b = elcBoard();
  ward(b, "ward");
  killWith(b, "killA", P1, "other");
  assert.equal(zoneOf(b.engine, b.id("other")), "discard");
  assert.equal(zoneOf(b.engine, b.id("ward")), "play", "the warded character is untouched until destroyed");
});

clause(ELC, "1:ability:keepemcoming", "an opponent's character goes to ITS OWNER's deck, also when you control it", () => {
  const b = elcBoard();
  const p1deck = [...b.engine.state.players[P1].deck];
  const p2deck = [...b.engine.state.players[P2].deck];
  ward(b, "stolen"); // owned by P2, controlled by P1
  killWith(b, "killA", P1, "stolen");
  assert.equal(zoneOf(b.engine, b.id("stolen")), "deck");
  assert.equal(b.engine.state.players[P2].deck[0], b.id("stolen"), "top of the owner's deck");
  assert.deepEqual(b.engine.state.players[P1].deck, p1deck, "your own deck is unchanged");
  assert.deepEqual(b.engine.state.players[P2].deck.slice(1), p2deck);
  const c = elcBoard();
  ward(c, "foe");
  killWith(c, "killA", P1, "foe");
  assert.equal(c.engine.state.players[P2].deck[0], c.id("foe"), "the opponent's own character");
});

clause(ELC, "1:ability:keepemcoming", "also replaces destruction by battle damage", () => {
  const b = elcBoard();
  b.engine.state.cards[b.id("foe")].damage = 0;
  ward(b, "ward");
  fightThrough(b.engine, P1, [b.id("ward")], { type: "faction", playerId: P2 }, [b.id("foe")]);
  assert.equal(zoneOf(b.engine, b.id("ward")), "deck", "destroyed in battle -> top of the deck instead");
  assert.equal(b.engine.state.players[P1].deck[0], b.id("ward"));
});

clause(ELC, "1:ability:keepemcoming", "lasts this turn only: it is over once the turn ends", () => {
  const same = elcBoard();
  ward(same, "ward");
  killWith(same, "killA", P1, "ward");
  assert.equal(zoneOf(same.engine, same.id("ward")), "deck", "still active later in the same turn");
  const b = elcBoard();
  ward(b, "ward");
  endTurn(b.engine, P1); // P2's turn
  assert.equal(b.engine.state.activePlayerId, P2);
  killWith(b, "killB", P2, "ward");
  assert.equal(zoneOf(b.engine, b.id("ward")), "discard", "the next turn it is destroyed normally");
  assert.equal(b.engine.state.players[P1].deck.includes(b.id("ward")), false);
});

// =============================================================================================
// Elzibeth, Military Sorceress -- character (warlord sorceress) cost 4, [R][R][R], 1/3/3
// =============================================================================================

interface ElmOpts {
  rage?: number;
  depleted?: boolean;
}
function elmBoard(o: ElmOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    random: () => 0.5,
    cards: [
      { key: "el", def: printing(ELM), owner: P1, zone: "play", ...(o.depleted ? { depleted: true } : {}) },
      { key: "dead", def: character({ name: "Dead", life: 3 }), owner: P1, zone: "discard" },
      { key: "dead2", def: character({ name: "Dead Two", life: 3 }), owner: P1, zone: "discard" },
      { key: "deadItem", def: item({ name: "Dead Item" }), owner: P1, zone: "discard" },
      { key: "deadTac", def: tactic({ name: "Dead Tactic", cost: 0 }), owner: P1, zone: "discard" },
      { key: "foeDead", def: character({ name: "Foe Dead", life: 3 }), owner: P2, zone: "discard" },
      { key: "alive", def: character({ name: "Alive", life: 3 }), owner: P1, zone: "play" },
      { key: "inHand", def: character({ name: "In Hand", life: 3 }), owner: P1, zone: "hand" },
      { key: "drawer", def: drawerChar(), owner: P1, zone: "play" },
      ...bank("rage", o.rage ?? 4, P1),
      ...fillers("pd", 3, P1, "deck"),
      ...fillers("qd", 3, P2, "deck")
    ]
  });
}
type ElmBoard = ReturnType<typeof elmBoard>;
const reanimate = (b: ElmBoard, key: string) => activate(b.engine, P1, b.id("el"), "reanimate", { selected: { c: [b.id(key)] } });

clause(ELM, "0:unique", "printed card: a warlord sorceress, cost 4, threshold [R][R][R], 1 strength / 3 speed / 3 life", () => {
  const p = printing(ELM);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "warlord");
  assert.deepEqual([...p.subtype], ["sorceress"]);
  const b = elmBoard();
  assert.equal(str(b, "el"), 1);
  assert.equal(b.engine.getStat(b.id("el"), "speed"), 3);
  assert.equal(life(b, "el"), 3);
  assert.equal(b.engine.getDefinition(b.id("el")).unique, "elzibeth");
});

clause(ELM, "0:unique", "deploys for exactly 4 resources with three [R]; one short and an [R] short are refused", () => {
  deployChecks(ELM, 4, [...bank("rage", 3, P1), ...bank("greed", 1, P1)], bank("rage", 3, P1), [...bank("rage", 2, P1), ...bank("greed", 2, P1)]);
  deployChecks(ELM, 4, bank("rage", 4, P1), [...bank("rage", 2, P1), ...bank("greed", 1, P1)], bank("greed", 4, P1));
});

clause(ELM, "0:unique", "UNIQUE ELZIBETH: a second copy or the other Elzibeth makes you keep one", () => {
  uniqueChecks(ELM, ELM);
  uniqueChecks(ELM, ELC);
});

clause(ELM, "1:ability:reanimate", "COST: pays 2 resources, depletes this card, and picks a character in your discard pile", () => {
  const b = elmBoard();
  const before = ready(b.engine);
  reanimate(b, "dead");
  assert.equal(before - ready(b.engine), 2, "Pay 2");
  assert.equal(b.engine.state.cards[b.id("el")].depleted, true, "Deplete this card");
});

clause(ELM, "1:ability:reanimate", "can't be used with 1 resource, while depleted, with spent resources, or without a pick", () => {
  const ok = elmBoard({ rage: 2 });
  reanimate(ok, "dead");
  assert.equal(zoneOf(ok.engine, ok.id("dead")), "deck", "control: exactly 2 resources");
  const short = elmBoard({ rage: 1 });
  refused(() => reanimate(short, "dead"), "only 1 resource", MSG);
  assert.equal(zoneOf(short.engine, short.id("dead")), "discard");
  const dep = elmBoard({ depleted: true });
  refused(() => reanimate(dep, "dead"), "depleted", /deplete|ready|exhaust|cost/i);
  assert.equal(zoneOf(dep.engine, dep.id("dead")), "discard");
  const none = elmBoard();
  refused(() => activate(none.engine, P1, none.id("el"), "reanimate", { selected: {} }), "no pick", /target|select|pick|character/i);
  assert.equal(ready(none.engine), 4);
  const sp = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "el", def: printing(ELM), owner: P1, zone: "play" },
      { key: "dead", def: character({ name: "Dead", life: 3 }), owner: P1, zone: "discard" },
      ...bank("rage", 1, P1),
      ...spentResources(P1, 2)
    ]
  });
  refused(() => activate(sp.engine, P1, sp.id("el"), "reanimate", { selected: { c: [sp.id("dead")] } }), "spent resources can't pay", MSG);
});

clause(ELM, "1:ability:reanimate", "only a CHARACTER in YOUR discard pile can be picked", () => {
  const bad: [string, string][] = [
    ["deadItem", "an item in your discard pile"],
    ["deadTac", "a tactic in your discard pile"],
    ["foeDead", "a character in the opponent's discard pile"],
    ["alive", "a character in play"],
    ["inHand", "a character in your hand"]
  ];
  for (const [key, why] of bad) {
    const b = elmBoard();
    refused(() => reanimate(b, key), why, /target|select|invalid|illegal|character|zone/i);
    assert.equal(b.engine.state.cards[b.id("el")].depleted === true, false, `${why}: nothing was paid`);
    assert.equal(ready(b.engine), 4, `${why}: nothing was paid`);
  }
  const ok = elmBoard();
  reanimate(ok, "dead");
  assert.equal(zoneOf(ok.engine, ok.id("dead")), "deck", "control: your own discarded character");
});

clause(ELM, "1:ability:reanimate", "the picked character goes on top of its owner's deck (not shuffled; the rest of the deck keeps its order)", () => {
  const b = elmBoard();
  const deck0 = [...b.engine.state.players[P1].deck];
  const p2deck = [...b.engine.state.players[P2].deck];
  reanimate(b, "dead2");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("dead2")), "deck");
  assert.equal(b.engine.state.players[P1].deck[0], b.id("dead2"), "on top");
  assert.deepEqual(b.engine.state.players[P1].deck.slice(1), deck0, "order of the rest untouched (no shuffle)");
  assert.equal(b.engine.state.players[P1].discard.includes(b.id("dead2")), false);
  assert.ok(b.engine.state.players[P1].discard.includes(b.id("dead")), "the other discarded character stays");
  assert.equal(b.engine.state.players[P1].hand.includes(b.id("dead2")), false, "not put into hand");
  assert.deepEqual(b.engine.state.players[P2].deck, p2deck, "the opponent's deck is untouched");
  activate(b.engine, P1, b.id("drawer"), "draw1", {});
  assert.ok(b.engine.state.players[P1].hand.includes(b.id("dead2")), "the next card drawn");
});

// =============================================================================================
// Enduring Swordsman -- character (warlord soldier) cost 1, [R][R], 1/3/1
// =============================================================================================

const SW = "a636b431-a0e8-4c00-b6e9-1ea700fa03fb";

interface SwOpts {
  active?: PlayerId;
}
function swBoard(o: SwOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: o.active ?? P1,
    random: () => 0.5,
    cards: [
      { key: "sw", def: printing(SW), owner: P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 3 }), owner: P1, zone: "play" },
      { key: "weak", def: character({ name: "Weak", life: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 3 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      { key: "gone", def: character({ name: "Gone", life: 3 }), owner: P2, zone: "discard" },
      { key: "killA", def: killTactic({ name: "Kill A" }), owner: P1, zone: "hand" },
      { key: "killB", def: killTactic({ name: "Kill B" }), owner: P2, zone: "hand" },
      {
        key: "bounce",
        def: tactic({
          name: "Bounce",
          cost: 0,
          behavior: {
            abilities: [
              {
                id: "b",
                type: "activated",
                targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
                effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
              }
            ]
          }
        }),
        owner: P1,
        zone: "hand"
      },
      ...bank("rage", 3, P1),
      ...bank("rage", 3, P2),
      ...fillers("pd", 3, P1, "deck"),
      ...fillers("qd", 3, P2, "deck")
    ]
  });
}
type SwBoard = ReturnType<typeof swBoard>;
const swDies = (b: SwBoard) => play(b.engine, P1, b.id("killA"), { selected: { t: [b.id("sw")] } });

clause(SW, "0:rule", "printed card: a warlord soldier, cost 1, threshold [R][R], 1 strength / 3 speed / 1 life", () => {
  const p = printing(SW);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "warlord");
  assert.deepEqual([...p.subtype], ["soldier"]);
  const b = swBoard();
  assert.equal(str(b, "sw"), 1);
  assert.equal(b.engine.getStat(b.id("sw"), "speed"), 3);
  assert.equal(life(b, "sw"), 1);
});

clause(SW, "0:rule", "deploys for exactly 1 resource while two [R] are present (spent ones count); [R] short and cost short are refused", () => {
  deployChecks(SW, 1, [...bank("rage", 1, P1), ...spentResources(P1, 1)], spentResources(P1, 2), bank("rage", 1, P1));
  deployChecks(SW, 1, bank("rage", 2, P1), [...bank("greed", 3, P1)], [...bank("rage", 1, P1), ...bank("greed", 2, P1)]);
});

clause(SW, "0:rule", "when it leaves play (destroyed) you may pick a character and it takes 1 damage", () => {
  const foe = swBoard();
  swDies(foe);
  assert.equal(zoneOf(foe.engine, foe.id("sw")), "discard");
  const pc = pcOf(foe.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "its controller picks");
  pickTargets(foe.engine, [foe.id("foe")]);
  assert.equal(foe.engine.state.pendingChoice, undefined);
  assert.equal(dmg(foe, "foe"), 1, "exactly 1 damage");
  assert.equal(zoneOf(foe.engine, foe.id("foe")), "play");
  assert.equal(dmg(foe, "mine"), 0);
  const own = swBoard();
  swDies(own);
  pickTargets(own.engine, [own.id("mine")]);
  assert.equal(dmg(own, "mine"), 1, "it can be one of your own characters");
  assert.equal(dmg(own, "foe"), 0);
});

clause(SW, "0:rule", "the pick is optional: declining inflicts no damage", () => {
  const b = swBoard();
  swDies(b);
  pickTargets(b.engine, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const k of ["mine", "weak", "foe"]) assert.equal(dmg(b, k), 0, k);
});

clause(SW, "0:rule", "1 damage destroys a life-1 character", () => {
  const b = swBoard();
  swDies(b);
  pickTargets(b.engine, [b.id("weak")]);
  assert.equal(zoneOf(b.engine, b.id("weak")), "discard");
});

clause(SW, "0:rule", "only characters in play can be picked: items, discard-pile characters and itself are refused", () => {
  const run = (key: string) => {
    const b = swBoard();
    swDies(b);
    return () => pickTargets(b.engine, [b.id(key)]);
  };
  refused(run("gear"), "an item", /target|select|invalid|illegal|character/i);
  refused(run("gone"), "a character in the discard pile", /target|select|invalid|illegal|character/i);
  refused(run("sw"), "the card that just left play", /target|select|invalid|illegal|character/i);
  const two = swBoard();
  swDies(two);
  refused(() => pickTargets(two.engine, [two.id("foe"), two.id("mine")]), "only one character", /target|select|invalid|illegal|count|character/i);
});

clause(SW, "0:rule", "it triggers on every way of leaving play: returned to hand, or destroyed by the opponent", () => {
  const b = swBoard();
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("sw")] } });
  assert.equal(zoneOf(b.engine, b.id("sw")), "hand");
  assert.equal(pcOf(b.engine)?.kind, "chooserSelectsTarget", "bounced -> prompt");
  pickTargets(b.engine, [b.id("foe")]);
  assert.equal(dmg(b, "foe"), 1);
  const o = swBoard({ active: P2 });
  play(o.engine, P2, o.id("killB"), { selected: { t: [o.id("sw")] } });
  const pc = pcOf(o.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "still the Swordsman's controller picks");
  pickTargets(o.engine, [o.id("foe")]);
  assert.equal(dmg(o, "foe"), 1);
});

clause(SW, "0:rule", "does not trigger when other cards leave play, or when it enters play", () => {
  const b = swBoard();
  play(b.engine, P1, b.id("killA"), { selected: { t: [b.id("mine")] } });
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  assert.equal(zoneOf(b.engine, b.id("sw")), "play");
  assert.equal(dmg(b, "foe"), 0);
  const c = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "sw", def: printing(SW), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", life: 3 }), owner: P2, zone: "play" },
      ...bank("rage", 2, P1)
    ]
  });
  play(c.engine, P1, c.id("sw"));
  assert.equal(zoneOf(c.engine, c.id("sw")), "play");
  assert.equal(c.engine.state.pendingChoice, undefined, "entering play does nothing");
  assert.equal(dmg(c, "foe"), 0);
});

clause(SW, "0:rule", "two Swordsmen leaving together each trigger once (both prompt, 1 damage each)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    random: () => 0.5,
    cards: [
      { key: "sw", def: printing(SW), owner: P1, zone: "play" },
      { key: "sw2", def: printing(SW), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      { key: "killA", def: killTactic({ name: "Kill A" }), owner: P1, zone: "hand" },
      { key: "killA2", def: killTactic({ name: "Kill A2" }), owner: P1, zone: "hand" },
      ...bank("rage", 3, P1)
    ]
  });
  play(b.engine, P1, b.id("killA"), { selected: { t: [b.id("sw")] } });
  pickTargets(b.engine, [b.id("foe")]);
  assert.equal(dmg(b, "foe"), 1, "only the leaving Swordsman triggered");
  assert.equal(b.engine.state.pendingChoice, undefined);
  play(b.engine, P1, b.id("killA2"), { selected: { t: [b.id("sw2")] } });
  pickTargets(b.engine, [b.id("foe")]);
  assert.equal(dmg(b, "foe"), 2);
});

// =============================================================================================
// Epic Smackdown -- tactic (warlord), cost 3, threshold [R][R]
// =============================================================================================

const ES = "74da08f9-ea6b-4ac6-af80-2734f1860cae";

interface EsOpts {
  own?: number;
  opp?: number;
  rage?: number;
  greed?: number;
  spent?: number;
  extra?: CardPlacement[];
}
function esBoard(o: EsOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    random: () => 0.5,
    cards: [
      { key: "es", def: printing(ES), owner: P1, zone: "hand" },
      ...Array.from({ length: o.own ?? 3 }, (_, i): CardPlacement => ({ key: `a${i}`, def: character({ name: `Own ${i}` }), owner: P1, zone: "play" })),
      ...Array.from({ length: o.opp ?? 3 }, (_, i): CardPlacement => ({ key: `f${i}`, def: character({ name: `Foe ${i}` }), owner: P2, zone: "play" })),
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      { key: "gearO", def: item({ name: "Gear O" }), owner: P2, zone: "play" },
      { key: "dead", def: character({ name: "Dead" }), owner: P1, zone: "discard" },
      { key: "deadO", def: character({ name: "Dead O" }), owner: P2, zone: "discard" },
      ...bank("rage", o.rage ?? 3, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...spentResources(P1, o.spent ?? 0),
      ...fillers("pd", 4, P1, "deck"),
      ...fillers("qd", 4, P2, "deck"),
      ...fillers("ph", 2, P1, "hand"),
      ...fillers("qh", 2, P2, "hand"),
      ...(o.extra ?? [])
    ]
  });
}
type EsBoard = ReturnType<typeof esBoard>;
const esPlay = (b: EsBoard, x: number, sac: string[]) =>
  play(b.engine, P1, b.id("es"), { selected: { sacX: sac.map((k) => b.id(k)) }, variables: { x } });
const esRaw = (b: EsBoard, x: number, sac: string[]) =>
  playRaw(b.engine, P1, b.id("es"), { selected: { sacX: sac.map((k) => b.id(k)) }, variables: { x } });
const hand = (b: Board, p: PlayerId) => [...b.engine.state.players[p].hand];

clause(ES, "0:extraCost", "printed card: a warlord tactic, cost 3, threshold [R][R]", () => {
  const p = printing(ES);
  assert.equal(p.type, "tactic");
  assert.equal(p.trade, "warlord");
});

clause(ES, "0:extraCost", "pays exactly 3 resources with two [R]; one short, one [R] short, and spent [R] vs ready are checked", () => {
  const a = esBoard({ rage: 2, greed: 1, opp: 0 });
  const before = ready(a.engine);
  esPlay(a, 1, ["a0"]);
  assert.equal(zoneOf(a.engine, a.id("es")), "discard", "resolved");
  assert.equal(before - ready(a.engine), 3, "pays exactly 3");
  const s = esBoard({ rage: 2, greed: 0 });
  refused(() => esPlay(s, 1, ["a0"]), "one short of 3", MSG);
  assert.equal(zoneOf(s.engine, s.id("es")), "hand");
  assert.equal(zoneOf(s.engine, s.id("a0")), "play", "no sacrifice when it can't be cast");
  const t = esBoard({ rage: 1, greed: 2 });
  refused(() => esPlay(t, 1, ["a0"]), "one [R] short of the threshold", MSG);
  assert.equal(zoneOf(t.engine, t.id("es")), "hand");
  const g = esBoard({ rage: 0, greed: 3 });
  refused(() => esPlay(g, 1, ["a0"]), "no [R] at all", MSG);
  // spent [R] count towards the threshold, but only ready resources pay the cost
  const sp = esBoard({ rage: 0, greed: 3, spent: 2, opp: 0 });
  const b4 = ready(sp.engine);
  esPlay(sp, 1, ["a0"]);
  assert.equal(zoneOf(sp.engine, sp.id("es")), "discard", "two spent [R] + three ready [G]");
  assert.equal(b4 - ready(sp.engine), 3);
  const sp2 = esBoard({ rage: 0, greed: 2, spent: 2 });
  refused(() => esPlay(sp2, 1, ["a0"]), "spent resources can't pay the cost", MSG);
  assert.equal(zoneOf(sp2.engine, sp2.id("es")), "hand");
});

clause(ES, "0:extraCost", "Destroy X characters you control: the chosen characters are destroyed as part of casting", () => {
  const b = esBoard();
  esRaw(b, 2, ["a0", "a2"]);
  assert.equal(zoneOf(b.engine, b.id("a0")), "discard", "already destroyed while the tactic waits (cost)");
  assert.equal(zoneOf(b.engine, b.id("a2")), "discard");
  assert.equal(zoneOf(b.engine, b.id("a1")), "play", "the unchosen one stays");
  assert.equal(zoneOf(b.engine, b.id("f0")), "play", "the effect has not resolved yet");
  resolvePendingResponses(b.engine);
});

clause(ES, "0:extraCost", "X may be 0, 1, 2 or 3: exactly X characters of yours are destroyed", () => {
  for (const x of [0, 1, 2, 3]) {
    const b = esBoard();
    const keys = ["a0", "a1", "a2"].slice(0, x);
    esPlay(b, x, keys);
    if (pcOf(b.engine)) pickTargets(b.engine, [b.id("f0"), b.id("f1"), b.id("f2")].slice(0, x));
    const dead = ["a0", "a1", "a2"].filter((k) => zoneOf(b.engine, b.id(k)) === "discard");
    assert.deepEqual(dead, keys, `X=${x}`);
    assert.equal(zoneOf(b.engine, b.id("gear")), "play", "items are not characters");
  }
});

clause(ES, "0:extraCost", "the sacrificed characters are DESTROYED (their destroy triggers fire), as are the opponent's", () => {
  const martyr = (name: string) =>
    character({
      name,
      behavior: {
        abilities: [
          { id: "m", type: "triggered", event: "cardDestroyed", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }
        ]
      }
    });
  const b = esBoard({
    own: 0,
    opp: 1,
    extra: [
      { key: "m1", def: martyr("Martyr One"), owner: P1, zone: "play" },
      { key: "m2", def: martyr("Martyr Two"), owner: P2, zone: "play" }
    ]
  });
  const h1 = hand(b, P1).length;
  const h2 = hand(b, P2).length;
  esPlay(b, 1, ["m1"]);
  assert.equal(pcOf(b.engine)?.playerId, P2);
  pickTargets(b.engine, [b.id("m2")]);
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("m1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("m2")), "discard");
  assert.equal(hand(b, P1).length, h1 - 1 + 1 + 1, "tactic leaves, sacrificed martyr draws, Draw a card");
  assert.equal(hand(b, P2).length, h2 + 1, "the opponent's destroyed martyr draws for them");
});

clause(ES, "0:extraCost", "the X characters must be YOUR characters in play: opponent's, items, discard-pile cards are refused", () => {
  const cases: [string, string][] = [
    ["f0", "the opponent's character"],
    ["gear", "an item"],
    ["dead", "a character in your discard pile"]
  ];
  for (const [key, why] of cases) {
    const b = esBoard();
    refused(() => esPlay(b, 1, [key]), why, /target|select|invalid|illegal|character|control/i);
    assert.equal(zoneOf(b.engine, b.id("es")), "hand", why);
    assert.equal(zoneOf(b.engine, b.id("f0")), "play", why);
  }
  const ok = esBoard();
  esPlay(ok, 1, ["a1"]);
  assert.equal(zoneOf(ok.engine, ok.id("a1")), "discard", "control");
});

clause(ES, "0:extraCost", "exactly X must be chosen: fewer, more, or more than you control are refused", () => {
  const few = esBoard();
  refused(() => esPlay(few, 2, ["a0"]), "X=2 with 1 chosen", /target|select|count|invalid|illegal|character/i);
  assert.equal(zoneOf(few.engine, few.id("a0")), "play");
  const many = esBoard();
  refused(() => esPlay(many, 1, ["a0", "a1"]), "X=1 with 2 chosen", /target|select|count|invalid|illegal|character/i);
  assert.equal(zoneOf(many.engine, many.id("a0")), "play");
  const over = esBoard({ own: 2 });
  refused(() => esPlay(over, 3, ["a0", "a1"]), "X=3 with only 2 characters", /target|select|count|invalid|illegal|character|enough/i);
  assert.equal(zoneOf(over.engine, over.id("a0")), "play");
  const none = esBoard({ own: 0 });
  refused(() => esPlay(none, 1, []), "X=1 with no characters", /target|select|count|invalid|illegal|character|enough/i);
  assert.equal(zoneOf(none.engine, none.id("es")), "hand");
});

clause(ES, "0:extraCost", "X is a number you choose: it must be chosen, and negative or fractional values are refused", () => {
  const noX = esBoard();
  refused(
    () => play(noX.engine, P1, noX.id("es"), { selected: { sacX: [noX.id("a0")] }, variables: {} }),
    "no X chosen",
    /variable|number|choose|\bx\b|target|select|count/i
  );
  assert.equal(zoneOf(noX.engine, noX.id("a0")), "play");
  const neg = esBoard();
  refused(() => esPlay(neg, -1, []), "X=-1", /variable|number|\bx\b|bound|invalid|negative|integer|count|target|select/i);
  assert.equal(zoneOf(neg.engine, neg.id("f0")), "play");
  assert.equal(zoneOf(neg.engine, neg.id("es")), "hand");
  const frac = esBoard();
  refused(() => esPlay(frac, 1.5, ["a0"]), "X=1.5", /variable|number|\bx\b|bound|invalid|integer|count|target|select/i);
  assert.equal(zoneOf(frac.engine, frac.id("a0")), "play");
  assert.equal(zoneOf(frac.engine, frac.id("es")), "hand");
});

clause(ES, "1:rule", "an opponent with MORE than X characters chooses X of them to destroy; the rest survive", () => {
  const b = esBoard({ own: 3, opp: 3 });
  const h1 = hand(b, P1).length;
  const top = b.engine.state.players[P1].deck[0];
  esPlay(b, 1, ["a0"]);
  const pc = pcOf(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the opponent chooses");
  pickTargets(b.engine, [b.id("f1")]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("f1")), "discard", "their pick is destroyed");
  assert.equal(zoneOf(b.engine, b.id("f0")), "play");
  assert.equal(zoneOf(b.engine, b.id("f2")), "play");
  assert.equal(zoneOf(b.engine, b.id("a0")), "discard");
  assert.equal(zoneOf(b.engine, b.id("a1")), "play");
  assert.equal(zoneOf(b.engine, b.id("gearO")), "play", "items are not touched");
  assert.equal(hand(b, P1).length, h1, "-1 tactic +1 drawn");
  assert.ok(hand(b, P1).includes(top), "you drew the top card of your deck");
  assert.equal(hand(b, P2).length, 2, "the opponent draws nothing");
});

clause(ES, "1:rule", "X=2 against three: the opponent picks two (any two), one survives", () => {
  for (const pick of [["f0", "f1"], ["f1", "f2"], ["f0", "f2"]]) {
    const b = esBoard({ own: 3, opp: 3 });
    esPlay(b, 2, ["a0", "a1"]);
    const pc = pcOf(b.engine)!;
    assert.equal(pc.playerId, P2);
    pickTargets(b.engine, pick.map((k) => b.id(k)));
    for (const k of ["f0", "f1", "f2"]) assert.equal(zoneOf(b.engine, b.id(k)), pick.includes(k) ? "discard" : "play", `${pick} -> ${k}`);
    assert.equal(zoneOf(b.engine, b.id("a2")), "play");
  }
});

clause(ES, "1:rule", "the opponent must pick exactly X of THEIR OWN characters in play", () => {
  const mk = () => {
    const b = esBoard({ own: 3, opp: 3 });
    esPlay(b, 2, ["a0", "a1"]);
    assert.equal(pcOf(b.engine)?.kind, "chooserSelectsTarget");
    return b;
  };
  const bad: [string[], string][] = [
    [["f0"], "only 1 of 2"],
    [["f0", "f1", "f2"], "3 of 2"],
    [[], "none"],
    [["f0", "a2"], "one of the caster's characters"],
    [["f0", "gearO"], "an item"],
    [["f0", "deadO"], "a discard-pile card"]
  ];
  for (const [keys, why] of bad) {
    const b = mk();
    refused(() => pickTargets(b.engine, keys.map((k) => b.id(k))), why, /target|select|count|invalid|illegal|character|exactly/i);
    assert.equal(zoneOf(b.engine, b.id("a2")), "play", why);
  }
});

clause(ES, "1:rule", "an opponent with exactly X characters destroys all of them", () => {
  const b = esBoard({ own: 3, opp: 2 });
  esPlay(b, 2, ["a0", "a1"]);
  if (pcOf(b.engine)) pickTargets(b.engine, [b.id("f0"), b.id("f1")]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("f0")), "discard");
  assert.equal(zoneOf(b.engine, b.id("f1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("gearO")), "play");
  assert.equal(zoneOf(b.engine, b.id("a2")), "play");
});

clause(ES, "1:rule", "an opponent with FEWER than X characters: all of their characters are destroyed (no choice), and you still draw", () => {
  const b = esBoard({ own: 3, opp: 1 });
  const top = b.engine.state.players[P1].deck[0];
  esPlay(b, 3, ["a0", "a1", "a2"]);
  assert.equal(b.engine.state.pendingChoice, undefined, "nothing to choose");
  assert.equal(zoneOf(b.engine, b.id("f0")), "discard");
  assert.equal(zoneOf(b.engine, b.id("gearO")), "play");
  assert.ok(hand(b, P1).includes(top), "Draw a card");
  const c = esBoard({ own: 3, opp: 2 });
  esPlay(c, 3, ["a0", "a1", "a2"]);
  assert.equal(c.engine.state.pendingChoice, undefined, "2 < 3: all destroyed without a choice");
  assert.equal(zoneOf(c.engine, c.id("f0")), "discard");
  assert.equal(zoneOf(c.engine, c.id("f1")), "discard");
  assert.equal(zoneOf(c.engine, c.id("a0")), "discard");
});

clause(ES, "1:rule", "an opponent with no characters loses nothing; you still draw a card", () => {
  const b = esBoard({ own: 3, opp: 0 });
  const top = b.engine.state.players[P1].deck[0];
  esPlay(b, 1, ["a0"]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("a0")), "discard");
  assert.equal(zoneOf(b.engine, b.id("gearO")), "play");
  assert.ok(hand(b, P1).includes(top), "hand(b, P1).includes(top)");
  assert.equal(hand(b, P2).length, 2);
});

clause(ES, "1:rule", "X=0: the opponent is not asked to choose 0 characters", () => {
  const b = esBoard({ own: 3, opp: 3 });
  esPlay(b, 0, []);
  assert.equal(b.engine.state.pendingChoice, undefined, "no prompt to destroy 0 characters");
});

clause(ES, "1:rule", "X=0: nobody loses a character, but you still draw a card", () => {
  const b = esBoard({ own: 3, opp: 3 });
  const top = b.engine.state.players[P1].deck[0];
  esPlay(b, 0, []);
  if (pcOf(b.engine)) {
    assert.equal(pcOf(b.engine)!.playerId, P2);
    pickTargets(b.engine, []);
  }
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const k of ["a0", "a1", "a2", "f0", "f1", "f2"]) assert.equal(zoneOf(b.engine, b.id(k)), "play", k);
  assert.equal(zoneOf(b.engine, b.id("es")), "discard");
  assert.ok(hand(b, P1).includes(top), "Draw a card");
  assert.equal(hand(b, P2).length, 2);
});

clause(ES, "1:rule", "X=3 against five: the opponent picks three, two remain; Draw a card", () => {
  const b = esBoard({ own: 3, opp: 5 });
  const top = b.engine.state.players[P1].deck[0];
  esPlay(b, 3, ["a0", "a1", "a2"]);
  assert.equal(pcOf(b.engine)?.playerId, P2);
  pickTargets(b.engine, [b.id("f0"), b.id("f2"), b.id("f4")]);
  const alive = ["f0", "f1", "f2", "f3", "f4"].filter((k) => zoneOf(b.engine, b.id(k)) === "play");
  assert.deepEqual(alive, ["f1", "f3"]);
  for (const k of ["a0", "a1", "a2"]) assert.equal(zoneOf(b.engine, b.id(k)), "discard");
  assert.ok(hand(b, P1).includes(top), "hand(b, P1).includes(top)");
});
