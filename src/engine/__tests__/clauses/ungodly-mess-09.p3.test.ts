// Clause tests — batch ungodly-mess-09, part p3 (groups 12-16, missing clauses).
// Expectations come from each card's PRINTED text and RULES.md; engine data only drives the engine.

import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  autoResolveBattle,
  bank,
  character,
  developFaction,
  item,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic,
  volition,
  P1,
  P2
} from "../per-card/_harness.js";
import { clause, declineAll, printing, refused, flipUpNow } from "./_clause.js";
import { declareAttackBy } from "./_battle.js";
import { pending, zoneOf } from "./_board.js";
import { endTurn } from "./_turn.js";
import type { SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

const HEADSHOT = "e98c5fe5-ad44-4541-94fe-ddc9eca924c7"; // Headshot
const TROOPER = "a85e6362-b472-4c31-9722-dd7f3ba82ce2"; // Malevolent Trooper
const RIFLEMAN = "b82e3c40-da1d-46ca-9abe-280924f3204c"; // Readied Rifleman
const RUDO = "f3c70039-bc5b-4aa5-b7fa-40705949b8b3"; // Rudo Mangod, Fightful Adonis
const SALVO = "7283e02e-9dde-459e-8d8d-ffa7cb3e0367"; // Salvo Sarume

type Cards = CardPlacement[];
type Pid = typeof P1 | typeof P2;
const ANY = /[\s\S]*/;
const ready = (e: SpoilsEngine, p: Pid = P1) => e.getAvailableResourceCount(p);
const dmg = (e: SpoilsEngine, id: string) => (e.state.cards[id as never] as unknown as { damage?: number }).damage ?? 0;
const inf = (e: SpoilsEngine, p: Pid) => e.state.players[p].influence;
const isDepleted = (e: SpoilsEngine, id: string) => e.state.cards[id as never].depleted === true;
const handOf = (e: SpoilsEngine, p: Pid) => [...e.state.players[p].hand] as string[];
const deckOf = (e: SpoilsEngine, p: Pid) => [...e.state.players[p].deck] as string[];
const passTurn = (e: SpoilsEngine) => endTurn(e, e.state.activePlayerId as never);
const factionKey = (owner: string) => (owner === P1 ? "__factionA" : "__factionB");
const att = (icon: "rage" | "greed", n: number, owner: Pid = P1): Cards =>
  bank(icon, n, owner).map((p) => ({ ...p, attachedToKey: factionKey(owner) }));
const pend = (e: SpoilsEngine) => pending(e) as unknown as { kind: string; playerId: string } | undefined;
const answerChoice = (e: SpoilsEngine, choice: Record<string, unknown>) => {
  const pc = pend(e)!;
  e.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
  resolvePendingResponses(e);
};
const selectIds = (e: SpoilsEngine, ids: string[]) => answerChoice(e, { kind: "chooserSelectsTarget", selected: ids });
const revealedIds = (e: SpoilsEngine) =>
  e.getLog().filter((entry) => entry.event?.type === "cardsRevealed").flatMap((entry) => (entry.event as unknown as { cardIds: string[] }).cardIds);
const res = (key: string, icon: string, trade: string, owner: Pid = P1, staple = true): CardPlacement => ({
  key,
  def: resourceCard({ id: `p3-res-${key}`, name: `Res ${key}`, trade, resource: { provides: [icon], staple } } as never),
  owner,
  zone: "play"
});
const smash = () =>
  tactic({
    name: "Smash",
    cost: 0,
    behavior: { abilities: [{ id: "x", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  } as never);
const refresh = () =>
  tactic({
    name: "Refresh",
    cost: 0,
    behavior: { abilities: [{ id: "r", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "restore", target: { type: "selected", id: "t" } }] }] }
  } as never);

/** Deploy checks: exact cost+threshold works, one short on cost / one icon short are refused. */
function deployChecks(cid: string, cost: number, icon: "rage", icons: number, endZone: string, extra: Cards = [], sel: (id: (k: string) => string) => Record<string, string[]> = () => ({})) {
  const mk = (cards: Cards) =>
    buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, cards: [{ key: "c", def: printing(cid), owner: P1, zone: "hand" }, ...cards, ...extra] });
  const exact = mk([...bank(icon, cost, P1), ...att(icon, Math.max(0, icons - cost))]);
  play(exact.engine, P1, exact.id("c"), { selected: sel(exact.id) });
  assert.equal(zoneOf(exact.engine, exact.id("c")), endZone, "control: exact cost and threshold deploys");
  assert.equal(ready(exact.engine), 0, "exactly the printed cost was paid");
  const short = mk([...bank(icon, cost - 1, P1), ...att(icon, icons)]);
  refused(() => play(short.engine, P1, short.id("c"), { selected: sel(short.id) }), "cost one short (threshold met by spent icons)");
  assert.equal(zoneOf(short.engine, short.id("c")), "hand");
  if (icons <= cost) {
    const minimal = mk([...bank(icon, icons, P1), ...bank("greed", cost - icons, P1)]);
    play(minimal.engine, P1, minimal.id("c"), { selected: sel(minimal.id) });
    assert.equal(zoneOf(minimal.engine, minimal.id("c")), endZone, "control: only the printed number of icons is needed, not more");
  }
  const nIcon = Math.min(icons - 1, cost);
  const noIcon = mk([...bank(icon, nIcon, P1), ...bank("greed", cost - nIcon, P1)]);
  refused(() => play(noIcon.engine, P1, noIcon.id("c"), { selected: sel(noIcon.id) }), "one icon short (cost covered)");
  assert.equal(zoneOf(noIcon.engine, noIcon.id("c")), "hand");
}

// ============================================================================
// Headshot — tactic · warlord · cost 3 · [R]
// ============================================================================

const victim = (name: string, life: number, extra: Record<string, unknown> = {}) => character({ name, strength: 1, speed: 1, life, ...extra } as never);
function hsBoard(o: { rage?: number; greed?: number; faceDown?: boolean; extra?: Cards } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "hs", def: printing(HEADSHOT), owner: P1, zone: o.faceDown ? "play" : "hand", faceDown: o.faceDown },
      ...bank("rage", o.rage ?? 3, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...["v1", "v2", "v3", "v4", "v5"].map((k) => ({ key: k, def: victim(k, 1), owner: P2, zone: "play" as const })),
      { key: "t2", def: victim("T2", 2), owner: P2, zone: "play" },
      { key: "t3", def: victim("T3", 3), owner: P2, zone: "play" },
      { key: "mine", def: victim("Mine", 1), owner: P1, zone: "play" },
      { key: "it", def: item({ name: "Gear" }), owner: P2, zone: "play" },
      { key: "inhand", def: victim("InHand", 1), owner: P2, zone: "hand" },
      ...(o.extra ?? [])
    ]
  });
}
type HsBoard = ReturnType<typeof hsBoard>;
const shoot = (b: HsBoard, first: string) => play(b.engine, P1, b.id("hs"), { selected: { c: [b.id(first)] } });
const flipHs = (b: HsBoard, selected: Record<string, string[]>) =>
  flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("hs"), selected, variables: {} });
const chain = (b: HsBoard, key: string) => {
  const pc = pend(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", `a pick is offered for ${key}`);
  assert.equal(pc?.playerId, P1, "the Headshot player makes every follow-up pick");
  selectIds(b.engine, [b.id(key)]);
};

clause(HEADSHOT, "0:extraCost", "printed: warlord tactic, cost 3, [R]: deploys with exactly 3 incl. a rage; 2 resources or no rage are refused", () => {
  const p = printing(HEADSHOT);
  assert.equal(p.type, "tactic");
  assert.equal(p.trade, "warlord");
  deployChecks(HEADSHOT, 3, "rage", 1, "discard", [{ key: "tv", def: victim("TV", 2), owner: P2, zone: "play" }], (id) => ({ c: [id("tv")] }));
});

clause(HEADSHOT, "0:extraCost", "the extra cost picks one character: an enemy or my own is accepted, nothing is paid for a refused pick", () => {
  for (const k of ["v1", "mine", "t2"]) {
    const b = hsBoard();
    shoot(b, k);
    if (pend(b.engine)) selectIds(b.engine, []);
    assert.equal(zoneOf(b.engine, b.id("hs")), "discard", `picking ${k} plays the tactic`);
    assert.equal(ready(b.engine), 0, "cost 3 paid");
  }
  const b = hsBoard();
  refused(() => play(b.engine, P1, b.id("hs"), { selected: {} }), "no character picked", ANY);
  refused(() => shoot(b, "it"), "an item is not a character", ANY);
  refused(() => play(b.engine, P1, b.id("hs"), { selected: { c: [b.engine.state.players[P2].factionId as string] } }), "a faction is not a character", ANY);
  refused(() => shoot(b, "inhand"), "a character in hand is not pickable", ANY);
  refused(() => play(b.engine, P1, b.id("hs"), { selected: { c: [b.id("v1"), b.id("v2")] } }), "one character only", ANY);
  assert.equal(zoneOf(b.engine, b.id("hs")), "hand");
  assert.equal(ready(b.engine), 3, "nothing paid on refusal");
  shoot(b, "t2");
  assert.equal(zoneOf(b.engine, b.id("hs")), "discard", "control: a legal pick works");
});

clause(HEADSHOT, "1:rule", "inflicts exactly 1 damage to the picked character, and only to it; a survivor ends the effect", () => {
  for (const [k, life] of [["t2", 2], ["t3", 3]] as const) {
    const b = hsBoard();
    shoot(b, k);
    assert.equal(dmg(b.engine, b.id(k)), 1, `${k} (life ${life}) took exactly 1`);
    assert.equal(zoneOf(b.engine, b.id(k)), "play");
    assert.equal(b.engine.state.pendingChoice, undefined, "not destroyed: no follow-up pick");
    for (const o of ["v1", "v2", "mine"]) assert.equal(dmg(b.engine, b.id(o)), 0, `${o} untouched`);
    assert.equal(zoneOf(b.engine, b.id("v1")), "play");
  }
  const own = hsBoard();
  shoot(own, "mine");
  assert.equal(zoneOf(own.engine, own.id("mine")), "discard", "my own character can be shot");
});

clause(HEADSHOT, "1:rule", "'destroyed by that damage': a character already holding damage dies and offers a pick; a survivor with prior damage does not", () => {
  const dead = hsBoard({ extra: [{ key: "hurt", def: victim("Hurt", 2), owner: P2, zone: "play", damage: 1 }] });
  shoot(dead, "hurt");
  assert.equal(zoneOf(dead.engine, dead.id("hurt")), "discard");
  assert.equal(pend(dead.engine)?.kind, "chooserSelectsTarget");
  const live = hsBoard({ extra: [{ key: "tough", def: victim("Tough", 3), owner: P2, zone: "play", damage: 1 }] });
  shoot(live, "tough");
  assert.equal(dmg(live.engine, live.id("tough")), 2);
  assert.equal(live.engine.state.pendingChoice, undefined, "survived: no pick");
});

clause(HEADSHOT, "1:rule", "when the target is destroyed, its controller's opponent is not asked: the Headshot player may pick any character, or decline", () => {
  const b = hsBoard();
  shoot(b, "v1");
  assert.equal(zoneOf(b.engine, b.id("v1")), "discard");
  const pc = pend(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1);
  selectIds(b.engine, []);
  assert.equal(b.engine.state.pendingChoice, undefined, "declined: the effect ends");
  for (const o of ["v2", "t2", "mine"]) assert.equal(dmg(b.engine, b.id(o)), 0, `${o} untouched when declined`);
  assert.equal(zoneOf(b.engine, b.id("hs")), "discard");
  for (const k of ["v2", "t3", "mine"]) {
    const c = hsBoard();
    shoot(c, "v1");
    chain(c, k);
    assert.equal(dmg(c.engine, c.id(k)) + (zoneOf(c.engine, c.id(k)) === "discard" ? 1 : 0), 1, `${k} took 1 damage from the follow-up`);
  }
});

clause(HEADSHOT, "1:rule", "the follow-up pick is a character in play: an item, a faction, the destroyed one and a hand card are refused", () => {
  const b = hsBoard();
  shoot(b, "v1");
  refused(() => selectIds(b.engine, [b.id("it")]), "item", ANY);
  refused(() => selectIds(b.engine, [b.engine.state.players[P2].factionId as string]), "faction", ANY);
  refused(() => selectIds(b.engine, [b.id("v1")]), "the destroyed character", ANY);
  refused(() => selectIds(b.engine, [b.id("inhand")]), "a character in hand", ANY);
  assert.equal(pend(b.engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  selectIds(b.engine, [b.id("v2")]);
  assert.equal(zoneOf(b.engine, b.id("v2")), "discard", "control: a legal pick works");
});

clause(HEADSHOT, "2:rule", "the first repeat: a second kill is offered one more pick", () => {
  const b = hsBoard();
  shoot(b, "v1");
  chain(b, "v2");
  assert.equal(zoneOf(b.engine, b.id("v2")), "discard", "the repeat killed v2");
  // v2 died, so the second repeat is offered too (up to three more times); decline it.
  assert.equal(pend(b.engine)?.kind, "chooserSelectsTarget", "a third pick is offered after the second kill");
  selectIds(b.engine, []);
  assert.equal(pend(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("hs")), "discard");
});

clause(HEADSHOT, "2:rule", "the effect repeats up to three more times: four kills in a row, then it stops (a fifth is never offered)", () => {
  const b = hsBoard();
  shoot(b, "v1");
  chain(b, "v2");
  chain(b, "v3");
  chain(b, "v4");
  for (const k of ["v1", "v2", "v3", "v4"]) assert.equal(zoneOf(b.engine, b.id(k)), "discard", `${k} destroyed`);
  assert.equal(b.engine.state.pendingChoice, undefined, "no fifth pick");
  assert.equal(zoneOf(b.engine, b.id("v5")), "play");
  assert.equal(dmg(b.engine, b.id("v5")), 0);
  assert.equal(zoneOf(b.engine, b.id("hs")), "discard");
});

clause(HEADSHOT, "2:rule", "the chain ends when the second target survives or the player declines the repeat", () => {
  const survive = hsBoard();
  shoot(survive, "v1");
  chain(survive, "t2");
  assert.equal(dmg(survive.engine, survive.id("t2")), 1);
  assert.equal(survive.engine.state.pendingChoice, undefined, "second target survived: stop");
  const dec = hsBoard();
  shoot(dec, "v1");
  selectIds(dec.engine, []);
  assert.equal(dec.engine.state.pendingChoice, undefined, "declined the first repeat");
  assert.equal(zoneOf(dec.engine, dec.id("v2")), "play");
});

clause(HEADSHOT, "2:rule", "the fourth hit deals exactly 1 damage: a life-3 fourth target after three kills ends with 1 damage and survives", () => {
  const b = hsBoard();
  shoot(b, "v1");
  chain(b, "v2");
  chain(b, "v3");
  chain(b, "t3");
  assert.equal(dmg(b.engine, b.id("t3")), 1, "the fourth hit deals 1");
  assert.equal(zoneOf(b.engine, b.id("t3")), "play", "a life-3 character survives 1 damage");
  assert.equal(b.engine.state.pendingChoice, undefined, "the chain is over");
  const two = hsBoard();
  shoot(two, "v1");
  chain(two, "v2");
  chain(two, "v3");
  chain(two, "t2");
  assert.equal(dmg(two.engine, two.id("t2")), 1, "1 damage, not 2, so a life-2 fourth target survives");
  assert.equal(zoneOf(two.engine, two.id("t2")), "play", "a life-2 character survives the fourth hit");
});

clause(HEADSHOT, "2:rule", "every follow-up pick is ONE character: two characters in the second, third or fourth pick are refused", () => {
  const b = hsBoard();
  shoot(b, "v1");
  refused(() => selectIds(b.engine, [b.id("v2"), b.id("v3")]), "two characters in the second pick");
  assert.equal(zoneOf(b.engine, b.id("v2")), "play", "v2 untouched by the refused pick");
  assert.equal(zoneOf(b.engine, b.id("v3")), "play", "v3 untouched by the refused pick");
  chain(b, "v2");
  refused(() => selectIds(b.engine, [b.id("v3"), b.id("v4")]), "two characters in the third pick");
  assert.equal(zoneOf(b.engine, b.id("v3")), "play", "v3 untouched by the refused pick");
  assert.equal(zoneOf(b.engine, b.id("v4")), "play", "v4 untouched by the refused pick");
  chain(b, "v3");
  refused(() => selectIds(b.engine, [b.id("v4"), b.id("v5")]), "two characters in the fourth pick");
  assert.equal(zoneOf(b.engine, b.id("v4")), "play", "v4 untouched by the refused pick");
  assert.equal(zoneOf(b.engine, b.id("v5")), "play", "v5 untouched by the refused pick");
  chain(b, "v4");
  assert.equal(zoneOf(b.engine, b.id("v4")), "discard", "control: a single pick works");
});

clause(HEADSHOT, "2:rule", "the third and fourth hits are offered; each deals 1 and the chain ends on a survivor or a decline", () => {
  const third = hsBoard();
  shoot(third, "v1");
  chain(third, "v2");
  chain(third, "t3");
  assert.equal(dmg(third.engine, third.id("t3")), 1, "third hit deals 1");
  assert.equal(third.engine.state.pendingChoice, undefined, "third target survived: stop");
  const dec = hsBoard();
  shoot(dec, "v1");
  chain(dec, "v2");
  assert.equal(pend(dec.engine)?.kind, "chooserSelectsTarget", "a third pick is offered");
  selectIds(dec.engine, []);
  assert.equal(dec.engine.state.pendingChoice, undefined, "declined the third hit");
  assert.equal(dmg(dec.engine, dec.id("v3")), 0);
  const dec3 = hsBoard();
  shoot(dec3, "v1");
  chain(dec3, "v2");
  chain(dec3, "v3");
  selectIds(dec3.engine, []);
  assert.equal(dec3.engine.state.pendingChoice, undefined, "declined the fourth hit");
  assert.equal(zoneOf(dec3.engine, dec3.id("v4")), "play");
  assert.equal(dmg(dec3.engine, dec3.id("v4")), 0);
});

clause(HEADSHOT, "3:flipUp", "FLIP UP 4 [R]: four resources incl. itself flips and shoots the picked character, then goes to the discard pile", () => {
  const b = hsBoard({ rage: 3, faceDown: true });
  assert.equal(ready(b.engine), 4, "three banks plus the face-down card");
  flipHs(b, { c: [b.id("t2")] });
  resolvePendingResponses(b.engine);
  assert.equal(dmg(b.engine, b.id("t2")), 1, "the body resolved");
  assert.equal(zoneOf(b.engine, b.id("hs")), "discard");
  assert.equal(ready(b.engine), 0, "all four paid");
  const k = hsBoard({ rage: 3, faceDown: true });
  flipHs(k, { c: [k.id("v1")] });
  resolvePendingResponses(k.engine);
  chain(k, "v2");
  assert.equal(zoneOf(k.engine, k.id("v2")), "discard", "the repeats work from a FLIP UP too");
});

clause(HEADSHOT, "3:flipUp", "FLIP UP is refused with only three resources, or with no [R] among four", () => {
  const short = hsBoard({ rage: 2, faceDown: true });
  refused(() => flipHs(short, { c: [short.id("v1")] }), "cost short", ANY);
  assert.equal(short.engine.state.cards[short.id("hs")].faceDown, true);
  assert.equal(zoneOf(short.engine, short.id("hs")), "play");
  assert.equal(ready(short.engine), 3, "nothing paid");
  const noIcon = hsBoard({ rage: 0, greed: 3, faceDown: true });
  assert.equal(ready(noIcon.engine), 4);
  refused(() => flipHs(noIcon, { c: [noIcon.id("v1")] }), "no [R]", ANY);
  assert.equal(noIcon.engine.state.cards[noIcon.id("hs")].faceDown, true);
  const ok = hsBoard({ rage: 1, greed: 2, faceDown: true });
  flipHs(ok, { c: [ok.id("t2")] });
  resolvePendingResponses(ok.engine);
  assert.equal(zoneOf(ok.engine, ok.id("hs")), "discard", "control: one [R] among four is enough");
});

clause(HEADSHOT, "3:flipUp", "FLIP UP still needs the extra cost pick of a character, and spares are not spent", () => {
  const b = hsBoard({ rage: 5, faceDown: true });
  refused(() => flipHs(b, {}), "no pick", ANY);
  refused(() => flipHs(b, { c: [b.id("it")] }), "an item", ANY);
  assert.equal(b.engine.state.cards[b.id("hs")].faceDown, true);
  flipHs(b, { c: [b.id("v1")] });
  resolvePendingResponses(b.engine);
  const left = ready(b.engine);
  assert.ok(left === 1 || left === 2, `four paid out of six (itself may be one of them), ready ${left}`);
});

// ============================================================================
// Malevolent Trooper — character · warlord · soldier · cost 3 · [R][R] · 2/3/2
// ============================================================================

function trBoard(o: { rage?: number; trDepleted?: boolean; extra?: Cards } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "tr", def: printing(TROOPER), owner: P1, zone: "play", depleted: o.trDepleted },
      ...bank("rage", o.rage ?? 3, P1),
      { key: "a", def: victim("A", 2, { strength: 1 }), owner: P1, zone: "play" },
      { key: "b", def: victim("B", 2, { strength: 1 }), owner: P1, zone: "play" },
      { key: "dep", def: victim("Dep", 2), owner: P1, zone: "play", depleted: true },
      { key: "foe", def: victim("Foe", 2), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      ...(o.extra ?? [])
    ]
  });
}
type TrBoard = ReturnType<typeof trBoard>;
const push = (b: TrBoard, key: string, player: Pid = P1) => activate(b.engine, player, b.id("tr"), "push", { selected: { c: [b.id(key)] } });

clause(TROOPER, "0:ability:push", "printed: warlord soldier character, 2 strength / 3 speed / 2 life, cost 3 with [R][R]", () => {
  const b = trBoard();
  assert.equal(b.engine.getStat(b.id("tr"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("tr"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("tr"), "life"), 2);
  const p = printing(TROOPER);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "warlord");
  assert.deepEqual([...p.subtype!], ["soldier"]);
  deployChecks(TROOPER, 3, "rage", 2, "play");
});

clause(TROOPER, "0:ability:push", "PUSH pays exactly 1, depletes the picked character and gives this card +2 strength", () => {
  const b = trBoard();
  assert.equal(ready(b.engine), 3);
  push(b, "a");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(ready(b.engine), 2, "COST: pay exactly 1");
  assert.equal(isDepleted(b.engine, b.id("a")), true, "COST: the picked character is depleted");
  assert.equal(isDepleted(b.engine, b.id("b")), false, "only the picked one");
  assert.equal(isDepleted(b.engine, b.id("tr")), false, "Trooper itself stays ready");
  assert.equal(b.engine.getStat(b.id("tr"), "strength"), 4, "2 + 2");
  assert.equal(b.engine.getStat(b.id("a"), "strength"), 1, "the depleted character gains nothing");
  assert.equal(b.engine.getStat(b.id("b"), "strength"), 1);
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 1);
});

clause(TROOPER, "0:ability:push", "the bonus lasts this turn only", () => {
  const b = trBoard();
  push(b, "a");
  assert.equal(b.engine.getStat(b.id("tr"), "strength"), 4);
  passTurn(b.engine);
  assert.equal(b.engine.getStat(b.id("tr"), "strength"), 2, "gone at the end of the turn");
  passTurn(b.engine);
  assert.equal(b.engine.getStat(b.id("tr"), "strength"), 2, "and it does not come back");
});

clause(TROOPER, "0:ability:push", "two activations stack: +4, with two characters depleted and 2 paid", () => {
  const b = trBoard();
  push(b, "a");
  push(b, "b");
  assert.equal(b.engine.getStat(b.id("tr"), "strength"), 6);
  assert.equal(ready(b.engine), 1, "2 paid");
  assert.equal(isDepleted(b.engine, b.id("a")) && isDepleted(b.engine, b.id("b")), true);
});

clause(TROOPER, "0:ability:push", "any character I control can be depleted, including Trooper itself; a depleted Trooper can still PUSH", () => {
  const self = trBoard();
  push(self, "tr");
  assert.equal(isDepleted(self.engine, self.id("tr")), true);
  assert.equal(self.engine.getStat(self.id("tr"), "strength"), 4);
  const dep = trBoard({ trDepleted: true });
  push(dep, "a");
  assert.equal(dep.engine.getStat(dep.id("tr"), "strength"), 4, "the ability has no 'deplete this card' cost");
});

clause(TROOPER, "0:ability:push", "refused when the cost cannot be paid: no resource, or an enemy / depleted / non-character / missing pick", () => {
  const none = trBoard({ rage: 0 });
  refused(() => push(none, "a"), "cannot pay 1", ANY);
  assert.equal(isDepleted(none.engine, none.id("a")), false);
  assert.equal(none.engine.getStat(none.id("tr"), "strength"), 2);
  const b = trBoard();
  refused(() => push(b, "foe"), "an enemy character", ANY);
  refused(() => push(b, "dep"), "an already depleted character", ANY);
  refused(() => push(b, "gear"), "an item", ANY);
  refused(() => activate(b.engine, P1, b.id("tr"), "push", { selected: {} }), "no pick", ANY);
  assert.equal(ready(b.engine), 3, "nothing paid by the refusals");
  assert.equal(b.engine.getStat(b.id("tr"), "strength"), 2);
  assert.equal(isDepleted(b.engine, b.id("foe")), false);
  push(b, "a");
  assert.equal(b.engine.getStat(b.id("tr"), "strength"), 4, "control: a legal activation works");
});

clause(TROOPER, "0:ability:push", "only the controller can use it", () => {
  const b = trBoard({ extra: bank("rage", 2, P2) });
  refused(() => activate(b.engine, P2, b.id("tr"), "push", { selected: { c: [b.id("foe")] } }), "the opponent cannot activate it", ANY);
  assert.equal(b.engine.getStat(b.id("tr"), "strength"), 2);
  assert.equal(isDepleted(b.engine, b.id("foe")), false);
});

// ============================================================================
// Readied Rifleman — character · warlord · soldier · cost 3 · [R] · 2/3/3
// ============================================================================

function rfBoard(o: { rfDepleted?: boolean; allyDepleted?: boolean; extra?: Cards } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: 10 },
    playerB: { faction: developFaction(), influence: 10 },
    cards: [
      { key: "rf", def: printing(RIFLEMAN), owner: P1, zone: "play", depleted: o.rfDepleted },
      { key: "ally", def: victim("Ally", 3), owner: P1, zone: "play", depleted: o.allyDepleted },
      { key: "foe", def: victim("Foe", 3), owner: P2, zone: "play" },
      ...(o.extra ?? [])
    ]
  });
}
const toMyNextTurn = (e: SpoilsEngine) => {
  passTurn(e);
  passTurn(e);
};

clause(RIFLEMAN, "0:rule", "printed: warlord soldier character, 2 strength / 3 speed / 3 life, cost 3 with [R]", () => {
  const b = rfBoard();
  assert.equal(b.engine.getStat(b.id("rf"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("rf"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("rf"), "life"), 3);
  const p = printing(RIFLEMAN);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "warlord");
  assert.deepEqual([...p.subtype!], ["soldier"]);
  deployChecks(RIFLEMAN, 3, "rage", 1, "play");
});

clause(RIFLEMAN, "0:rule", "restored by an effect: its controller may pick a faction and it takes exactly 1 damage (either faction)", () => {
  for (const [fac, mine, theirs] of [[P2, 10, 9], [P1, 9, 10]] as const) {
    const b = rfBoard({ rfDepleted: true, extra: [{ key: "rf0", def: refresh(), owner: P1, zone: "hand" }] });
    play(b.engine, P1, b.id("rf0"), { selected: { t: [b.id("rf")] } });
    assert.equal(isDepleted(b.engine, b.id("rf")), false, "restored");
    const pc = pend(b.engine);
    assert.equal(pc?.kind, "chooserSelectsTarget");
    assert.equal(pc?.playerId, P1, "its controller picks");
    selectIds(b.engine, [b.engine.state.players[fac].factionId as string]);
    assert.equal(b.engine.state.pendingChoice, undefined);
    assert.equal(inf(b.engine, P1), mine, `P1 influence after hitting ${fac}`);
    assert.equal(inf(b.engine, P2), theirs, `P2 influence after hitting ${fac}`);
    assert.equal(dmg(b.engine, b.id("foe")), 0, "no character is hurt");
  }
});

clause(RIFLEMAN, "0:rule", "'a faction': ONE faction only, picking both is refused (control: one is accepted)", () => {
  const b = rfBoard({ rfDepleted: true, extra: [{ key: "rf0", def: refresh(), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("rf0"), { selected: { t: [b.id("rf")] } });
  refused(() => selectIds(b.engine, [b.engine.state.players[P1].factionId as string, b.engine.state.players[P2].factionId as string]), "two factions in one pick");
  assert.equal(inf(b.engine, P1), 10, "my faction untouched by the refused pick");
  assert.equal(inf(b.engine, P2), 10, "their faction untouched by the refused pick");
  selectIds(b.engine, [b.engine.state.players[P2].factionId as string]);
  assert.equal(inf(b.engine, P2), 9, "control: one faction takes 1");
  assert.equal(inf(b.engine, P1), 10, "the other is untouched");
});

clause(RIFLEMAN, "0:rule", "'you may': declining deals no damage to either faction", () => {
  const b = rfBoard({ rfDepleted: true, extra: [{ key: "rf0", def: refresh(), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("rf0"), { selected: { t: [b.id("rf")] } });
  assert.equal(pend(b.engine)?.kind, "chooserSelectsTarget");
  selectIds(b.engine, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(inf(b.engine, P1), 10);
  assert.equal(inf(b.engine, P2), 10);
});

clause(RIFLEMAN, "0:rule", "only a faction can be picked: a character is refused", () => {
  const b = rfBoard({ rfDepleted: true, extra: [{ key: "rf0", def: refresh(), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("rf0"), { selected: { t: [b.id("rf")] } });
  refused(() => selectIds(b.engine, [b.id("foe")]), "a character", ANY);
  refused(() => selectIds(b.engine, [b.id("ally")]), "a character", ANY);
  assert.equal(pend(b.engine)?.kind, "chooserSelectsTarget", "still waiting");
  selectIds(b.engine, [b.engine.state.players[P2].factionId as string]);
  assert.equal(inf(b.engine, P2), 9, "control: a faction works");
});

clause(RIFLEMAN, "0:rule", "only when THIS card is restored: restoring another character, or a card that is not depleted, offers nothing", () => {
  const other = rfBoard({ rfDepleted: false, allyDepleted: true, extra: [{ key: "rf0", def: refresh(), owner: P1, zone: "hand" }] });
  play(other.engine, P1, other.id("rf0"), { selected: { t: [other.id("ally")] } });
  assert.equal(isDepleted(other.engine, other.id("ally")), false, "the ally was restored");
  assert.equal(other.engine.state.pendingChoice, undefined, "another character restored: no pick");
  assert.equal(inf(other.engine, P2), 10);
  const foe = rfBoard({ rfDepleted: false, extra: [{ key: "rf0", def: refresh(), owner: P1, zone: "hand" }, { key: "fd", def: victim("FoeDep", 3), owner: P2, zone: "play", depleted: true }] });
  play(foe.engine, P1, foe.id("rf0"), { selected: { t: [foe.id("fd")] } });
  assert.equal(foe.engine.state.pendingChoice, undefined, "an enemy restored: no pick");
  const ready = rfBoard({ rfDepleted: false, extra: [{ key: "rf0", def: refresh(), owner: P1, zone: "hand" }] });
  play(ready.engine, P1, ready.id("rf0"), { selected: { t: [ready.id("rf")] } });
  assert.equal(ready.engine.state.pendingChoice, undefined, "restoring an undepleted card does nothing");
  assert.equal(inf(ready.engine, P1), 10);
  assert.equal(inf(ready.engine, P2), 10);
});

clause(RIFLEMAN, "0:rule", "restored by the normal restore step at the start of my turn: I may pick a faction, 1 damage", () => {
  const b = rfBoard({ rfDepleted: true });
  toMyNextTurn(b.engine);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(isDepleted(b.engine, b.id("rf")), false, "restored at the start of my turn");
  const pc = pend(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "a faction pick is offered");
  assert.equal(pc?.playerId, P1);
  selectIds(b.engine, [b.engine.state.players[P2].factionId as string]);
  assert.equal(inf(b.engine, P2), 9);
  assert.equal(inf(b.engine, P1), 10);
});

clause(RIFLEMAN, "0:rule", "the normal restore step: no pick when Rifleman was not depleted", () => {
  const b = rfBoard({ rfDepleted: false, allyDepleted: true });
  toMyNextTurn(b.engine);
  assert.equal(isDepleted(b.engine, b.id("ally")), false, "the ally restored");
  assert.equal(b.engine.state.pendingChoice, undefined, "Rifleman was not restored: no pick");
  assert.equal(inf(b.engine, P2), 10);
});

// ============================================================================
// Rudo Mangod, Fightful Adonis — character · warlord · rudo + blade of questionable morality · cost 3 · [R]x4 · 1/3/3
// ============================================================================

const trades = ["warlord", "arcanist", "gearsmith", "universal"] as const;
function rdBoard(o: { zone?: "play" | "hand"; cards?: Cards; turn?: number; random?: () => number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn,
    ...(o.random ? { random: o.random } : {}),
    cards: [{ key: "rd", def: printing(RUDO), owner: P1, zone: o.zone ?? "play" }, ...(o.cards ?? [])]
  });
}

clause(RUDO, "0:unique", "printed: warlord rudo / blade of questionable morality character, 1 strength / 3 speed / 3 life, cost 3 with [R][R][R][R]", () => {
  const b = rdBoard();
  assert.equal(b.engine.getStat(b.id("rd"), "strength"), 1);
  assert.equal(b.engine.getStat(b.id("rd"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("rd"), "life"), 3);
  const p = printing(RUDO);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "warlord");
  assert.deepEqual([...p.subtype!], ["rudo", "blade of questionable morality"]);
  deployChecks(RUDO, 3, "rage", 4, "play");
});

clause(RUDO, "0:unique", "a second Rudo makes me choose which copy to keep (new or old); the other is destroyed", () => {
  for (const keep of ["rd2", "rd"] as const) {
    const b = rdBoard({ cards: [{ key: "rd2", def: printing(RUDO), owner: P1, zone: "hand" }, ...bank("rage", 3, P1), ...att("rage", 1)] });
    play(b.engine, P1, b.id("rd2"));
    const pc = pend(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
    assert.equal(pc.kind, "uniqueSurvivor");
    assert.equal(pc.playerId, P1);
    assert.deepEqual([...pc.candidates].sort(), [b.id("rd"), b.id("rd2")].sort());
    answerChoice(b.engine, { kind: "uniqueSurvivor", keep: b.id(keep) });
    const other = keep === "rd" ? "rd2" : "rd";
    assert.equal(zoneOf(b.engine, b.id(keep)), "play");
    assert.equal(zoneOf(b.engine, b.id(other)), "discard");
  }
});

clause(RUDO, "0:unique", "the designation is RUDOLPHUS: any card with that designation is a duplicate; another designation, or the opponent's copy, is not", () => {
  const dup = rdBoard({ cards: [{ key: "x", def: victim("Other Rudolphus", 2, { unique: "rudolphus" }), owner: P1, zone: "hand" }, ...bank("rage", 0, P1)] });
  play(dup.engine, P1, dup.id("x"));
  assert.equal(pend(dup.engine)?.kind, "uniqueSurvivor", "same designation, different name");
  const diff = rdBoard({ cards: [{ key: "x", def: victim("Ignatious", 2, { unique: "ignatious" }), owner: P1, zone: "hand" }] });
  play(diff.engine, P1, diff.id("x"));
  assert.equal(diff.engine.state.pendingChoice, undefined, "other designation is fine");
  assert.equal(zoneOf(diff.engine, diff.id("x")), "play");
  const opp = rdBoard({ cards: [{ key: "rd2", def: printing(RUDO), owner: P2, zone: "play" }, { key: "x", def: victim("Rudolphus", 2, { unique: "rudolphus" }), owner: P1, zone: "hand" }] });
  play(opp.engine, P1, opp.id("x"));
  assert.equal(pend(opp.engine)?.kind, "uniqueSurvivor", "my own copy still conflicts with Rudo");
  const theirs = rdBoard({ cards: [{ key: "rd2", def: printing(RUDO), owner: P2, zone: "play" }] });
  assert.equal(theirs.engine.state.pendingChoice, undefined, "the opponent's Rudo does not conflict with mine");
  assert.equal(zoneOf(theirs.engine, theirs.id("rd")), "play");
  assert.equal(zoneOf(theirs.engine, theirs.id("rd2")), "play");
});

function fealtyBoard(staples: Cards, ready: Cards = []) {
  return rdBoard({ zone: "hand", cards: [...staples, ...ready] });
}
const fourTrades = (icons: string[], owner: Pid = P1): Cards => icons.map((ic, i) => res(`s${i}`, ic, trades[i], owner));

clause(RUDO, "1:fealty", "in hand with 4 staple resources of 4 different trades, the threshold shrinks by 3 icons: one [R] among four is enough for cost 3", () => {
  const b = fealtyBoard(fourTrades(["rage", "greed", "greed", "greed"]));
  assert.equal(ready(b.engine), 4);
  play(b.engine, P1, b.id("rd"));
  assert.equal(zoneOf(b.engine, b.id("rd")), "play");
  assert.equal(ready(b.engine), 1, "cost 3 still paid in full");
  const two = fealtyBoard(fourTrades(["rage", "rage", "greed", "greed"]));
  play(two.engine, P1, two.id("rd"));
  assert.equal(zoneOf(two.engine, two.id("rd")), "play", "any icons: two [R] is also fine");
});

clause(RUDO, "1:fealty", "the reduction is 3 icons, not 4: with no [R] at all, Rudo is still refused", () => {
  const b = fealtyBoard(fourTrades(["greed", "greed", "greed", "greed"]));
  assert.equal(ready(b.engine), 4);
  refused(() => play(b.engine, P1, b.id("rd")), "no rage icon", ANY);
  assert.equal(zoneOf(b.engine, b.id("rd")), "hand");
});

clause(RUDO, "1:fealty", "needs 4 DIFFERENT trades: four staples of only three trades keep the full threshold", () => {
  const same = fealtyBoard([res("s0", "rage", "warlord"), res("s1", "greed", "arcanist"), res("s2", "greed", "gearsmith"), res("s3", "greed", "warlord")]);
  assert.equal(ready(same.engine), 4);
  refused(() => play(same.engine, P1, same.id("rd")), "only 3 trades", ANY);
  assert.equal(zoneOf(same.engine, same.id("rd")), "hand");
  const ok = fealtyBoard(fourTrades(["rage", "greed", "greed", "greed"]));
  play(ok.engine, P1, ok.id("rd"));
  assert.equal(zoneOf(ok.engine, ok.id("rd")), "play", "control: 4 trades");
});

clause(RUDO, "1:fealty", "needs STAPLE resources I control: a non-staple among the four, or resources the opponent controls, don't count", () => {
  const nonStaple = fealtyBoard([res("s0", "rage", "warlord"), res("s1", "greed", "arcanist"), res("s2", "greed", "gearsmith"), res("s3", "greed", "universal", P1, false)]);
  assert.equal(ready(nonStaple.engine), 4);
  refused(() => play(nonStaple.engine, P1, nonStaple.id("rd")), "a non-staple resource", ANY);
  const theirs = fealtyBoard([res("s0", "rage", "warlord"), res("s1", "greed", "arcanist"), res("s2", "greed", "gearsmith"), ...fourTrades(["greed"], P2).map((p) => ({ ...p, key: "o0", def: res("o0", "greed", "universal", P2).def }))]);
  assert.equal(ready(theirs.engine), 3);
  refused(() => play(theirs.engine, P1, theirs.id("rd")), "only 3 of my own staples", ANY);
});

clause(RUDO, "1:fealty", "only while this card is in hand: in play it is simply on the board (no threshold re-check), and 3 staples never reduce it", () => {
  const three = fealtyBoard(fourTrades(["rage", "greed", "greed"]));
  refused(() => play(three.engine, P1, three.id("rd")), "cost short and 3 trades only", ANY);
  const exactSpent = fealtyBoard([res("s0", "rage", "warlord"), res("s1", "greed", "arcanist"), res("s2", "greed", "gearsmith"), res("s3", "greed", "universal")], [{ key: "x", def: victim("X", 1), owner: P1, zone: "hand" }]);
  play(exactSpent.engine, P1, exactSpent.id("rd"));
  assert.equal(zoneOf(exactSpent.engine, exactSpent.id("rd")), "play");
});

function rallyBoard(o: { rage?: number } = {}) {
  return rdBoard({
    turn: 2,
    cards: [
      ...bank("rage", o.rage ?? 3, P1),
      { key: "ally", def: victim("Ally", 3), owner: P1, zone: "play" },
      { key: "allyd", def: victim("AllyDepleted", 3), owner: P1, zone: "play", depleted: true },
      { key: "foe", def: victim("Foe", 3), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" }
    ]
  });
}
type RallyBoard = ReturnType<typeof rallyBoard>;
const rudoAttacks = (b: RallyBoard, attackers = ["rd"]) => declareAttackBy(b.engine, P1, attackers.map((k) => b.id(k)));

clause(RUDO, "2:rule", "when Rudo attacks I may pay 2: every character I control gains 2 strength (Rudo, attackers, idle and depleted ones), nobody else", () => {
  const b = rallyBoard();
  rudoAttacks(b);
  const pc = pend(b.engine);
  assert.equal(pc?.kind, "mayPay");
  assert.equal(pc?.playerId, P1);
  answerChoice(b.engine, { kind: "mayPay", pay: true });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(ready(b.engine), 1, "exactly 2 paid");
  assert.equal(b.engine.getStat(b.id("rd"), "strength"), 3, "1 + 2");
  assert.equal(b.engine.getStat(b.id("ally"), "strength"), 3, "1 + 2");
  assert.equal(b.engine.getStat(b.id("allyd"), "strength"), 3, "a depleted character too");
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 1, "the opponent's character is untouched");
});

clause(RUDO, "2:rule", "'if you do': declining the payment pays nothing and gives nothing", () => {
  const b = rallyBoard();
  rudoAttacks(b);
  answerChoice(b.engine, { kind: "mayPay", pay: false });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(ready(b.engine), 3);
  assert.equal(b.engine.getStat(b.id("rd"), "strength"), 1);
  assert.equal(b.engine.getStat(b.id("ally"), "strength"), 1);
});

clause(RUDO, "2:rule", "with only 1 resource I cannot pay 2: there is no payment to choose (no prompt), nothing is spent and no strength is gained; with exactly 2 the prompt is offered", () => {
  const b = rallyBoard({ rage: 1 });
  rudoAttacks(b);
  // "you may pay 2. If you do ...": paying is impossible, so the "if you do" never happens. Pinned outcome: the trigger resolves with no prompt.
  assert.equal(b.engine.state.pendingChoice, undefined, "no mayPay is offered when 2 cannot be paid");
  assert.equal(ready(b.engine), 1, "nothing spent");
  assert.equal(b.engine.getStat(b.id("rd"), "strength"), 1);
  assert.equal(b.engine.getStat(b.id("ally"), "strength"), 1);
  assert.equal(b.engine.getStat(b.id("allyd"), "strength"), 1);
  const exact = rallyBoard({ rage: 2 });
  rudoAttacks(exact);
  assert.equal(pend(exact.engine)?.kind, "mayPay", "control: with exactly 2 ready the payment is offered");
});

clause(RUDO, "2:rule", "the +2 lasts until the end of the turn", () => {
  const b = rallyBoard();
  rudoAttacks(b);
  answerChoice(b.engine, { kind: "mayPay", pay: true });
  assert.equal(b.engine.getStat(b.id("ally"), "strength"), 3);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] } as never);
  autoResolveBattle(b.engine);
  assert.equal(b.engine.state.battle, undefined);
  assert.equal(b.engine.getStat(b.id("ally"), "strength"), 3, "still +2 later this turn");
  passTurn(b.engine);
  assert.equal(b.engine.getStat(b.id("rd"), "strength"), 1, "Rudo back to 1");
  assert.equal(b.engine.getStat(b.id("ally"), "strength"), 1, "ally back to 1");
  assert.equal(b.engine.getStat(b.id("allyd"), "strength"), 1);
});

clause(RUDO, "2:rule", "only when RUDO attacks: another character attacking alone offers nothing; attacking together with Rudo offers exactly one payment", () => {
  const alone = rallyBoard();
  rudoAttacks(alone, ["ally"]);
  assert.equal(alone.engine.state.pendingChoice, undefined, "Rudo did not attack");
  assert.equal(ready(alone.engine), 3);
  assert.equal(alone.engine.getStat(alone.id("ally"), "strength"), 1);
  const both = rallyBoard();
  rudoAttacks(both, ["rd", "ally"]);
  assert.equal(pend(both.engine)?.kind, "mayPay");
  answerChoice(both.engine, { kind: "mayPay", pay: true });
  assert.equal(both.engine.state.pendingChoice, undefined, "just one prompt");
  assert.equal(ready(both.engine), 1, "2 paid once");
  assert.equal(both.engine.getStat(both.id("ally"), "strength"), 3);
});

// --- legacy -----------------------------------------------------------------
const wl = (name: string, over: Record<string, unknown> = {}) => victim(name, 2, { trade: "warlord", ...over });
function legacyBoard(o: { cards?: Cards; random?: () => number } = {}) {
  return rdBoard({
    turn: 2,
    ...(o.random ? { random: o.random } : {}),
    cards: [
      { key: "sm", def: smash(), owner: P1, zone: "hand" },
      { key: "ally", def: victim("Ally", 2), owner: P1, zone: "play" },
      { key: "d0", def: victim("Filler0", 2, { trade: "arcanist" }), owner: P1, zone: "deck" },
      { key: "w1", def: wl("W1"), owner: P1, zone: "deck" },
      { key: "d1", def: victim("Filler1", 2, { trade: "arcanist" }), owner: P1, zone: "deck" },
      { key: "w2", def: wl("W2"), owner: P1, zone: "deck" },
      { key: "d2", def: victim("Filler2", 2, { trade: "gearsmith" }), owner: P1, zone: "deck" },
      { key: "wi", def: item({ name: "WarlordItem", trade: "warlord" } as never), owner: P1, zone: "deck" },
      { key: "wt", def: tactic({ name: "WarlordTactic", trade: "warlord" } as never), owner: P1, zone: "deck" },
      { key: "d3", def: victim("Filler3", 2, { trade: "arcanist" }), owner: P1, zone: "deck" },
      { key: "ow", def: wl("OppWarlord"), owner: P2, zone: "deck" },
      { key: "wh", def: wl("HandWarlord"), owner: P1, zone: "hand" },
      ...(o.cards ?? [])
    ]
  });
}
type LegacyBoard = ReturnType<typeof legacyBoard>;
const killRudo = (b: LegacyBoard, victimKey = "rd") => play(b.engine, P1, b.id("sm"), { selected: { t: [b.id(victimKey)] } });

clause(RUDO, "3:rule", "when Rudo is destroyed I may search my deck for a warlord character and reveal it", () => {
  const b = legacyBoard();
  const before = deckOf(b.engine, P1);
  killRudo(b);
  assert.equal(zoneOf(b.engine, b.id("rd")), "discard");
  const pc = pend(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1);
  selectIds(b.engine, [b.id("w2")]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual([...deckOf(b.engine, P1)].sort(), [...before].sort(), "the deck keeps exactly the same cards");
  assert.deepEqual(revealedIds(b.engine), [b.id("w2")], "it was revealed");
  assert.equal(zoneOf(b.engine, b.id("w2")), "deck", "put back into the deck, not into hand");
  assert.deepEqual(handOf(b.engine, P1), [b.id("wh")], "hand unchanged");
});

clause(RUDO, "3:rule", "the search finds ONE card: picking two warlords is refused (control: one is accepted)", () => {
  const b = legacyBoard();
  killRudo(b);
  refused(() => selectIds(b.engine, [b.id("w1"), b.id("w2")]), "two warlords in one search", ANY);
  assert.equal(pend(b.engine)?.kind, "chooserSelectsTarget", "the search is still open");
  assert.deepEqual(revealedIds(b.engine), [], "nothing revealed by the refused pick");
  selectIds(b.engine, [b.id("w1")]);
  assert.deepEqual(revealedIds(b.engine), [b.id("w1")], "control: one warlord is found");
});

clause(RUDO, "3:rule", "the search shuffles the deck (CR 312.1): below the found warlord the other cards are reordered, none lost", () => {
  const b = legacyBoard({ random: () => 0 });
  const before = deckOf(b.engine, P1);
  killRudo(b);
  selectIds(b.engine, [b.id("w2")]);
  const after = deckOf(b.engine, P1);
  assert.equal(after[0], b.id("w2"), "the found warlord is on top");
  assert.deepEqual([...after].sort(), [...before].sort(), "no card lost");
  assert.notEqual(after.slice(1).join(), before.filter((c) => c !== b.id("w2")).join(), "the rest of the deck was shuffled");
});

clause(RUDO, "3:rule", "the found warlord is put on top of my deck", () => {
  const b = legacyBoard();
  killRudo(b);
  selectIds(b.engine, [b.id("w2")]);
  assert.equal(deckOf(b.engine, P1)[0], b.id("w2"), "the found warlord is on top of the deck");
  const c = legacyBoard();
  killRudo(c);
  selectIds(c.engine, [c.id("w1")]);
  assert.equal(deckOf(c.engine, P1)[0], c.id("w1"), "also for another warlord");
});

clause(RUDO, "3:rule", "only a WARLORD CHARACTER in MY deck can be found: another trade, a warlord item/tactic, the opponent's deck and my hand are refused", () => {
  const b = legacyBoard();
  killRudo(b);
  refused(() => selectIds(b.engine, [b.id("d1")]), "a non-warlord character", ANY);
  refused(() => selectIds(b.engine, [b.id("wi")]), "a warlord item", ANY);
  refused(() => selectIds(b.engine, [b.id("wt")]), "a warlord tactic", ANY);
  refused(() => selectIds(b.engine, [b.id("ow")]), "the opponent's deck", ANY);
  refused(() => selectIds(b.engine, [b.id("wh")]), "a card in hand", ANY);
  assert.equal(pend(b.engine)?.kind, "chooserSelectsTarget", "still waiting");
  selectIds(b.engine, [b.id("w1")]);
  assert.deepEqual(revealedIds(b.engine), [b.id("w1")], "control: a warlord character works");
});

clause(RUDO, "3:rule", "'you may': declining reveals nothing and loses no card from the deck", () => {
  const b = legacyBoard();
  const before = deckOf(b.engine, P1);
  killRudo(b);
  selectIds(b.engine, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual([...deckOf(b.engine, P1)].sort(), [...before].sort());
  assert.deepEqual(revealedIds(b.engine), [], "nothing revealed");
});

clause(RUDO, "3:rule", "'you may': declining the search leaves the deck in exactly its old order (no search happened, no shuffle)", () => {
  const b = legacyBoard();
  const before = deckOf(b.engine, P1);
  killRudo(b);
  selectIds(b.engine, []);
  assert.deepEqual(deckOf(b.engine, P1), before, "same cards in the same order");
});

clause(RUDO, "3:rule", "a deck with no warlord character: nothing is found, nothing moves, nothing is revealed", () => {
  const b = rdBoard({
    turn: 2,
    cards: [
      { key: "sm", def: smash(), owner: P1, zone: "hand" },
      { key: "d0", def: victim("Filler0", 2, { trade: "arcanist" }), owner: P1, zone: "deck" },
      { key: "d1", def: victim("Filler1", 2, { trade: "arcanist" }), owner: P1, zone: "deck" },
      { key: "wi", def: item({ name: "WarlordItem", trade: "warlord" } as never), owner: P1, zone: "deck" }
    ]
  });
  killRudo(b as unknown as LegacyBoard);
  if (pend(b.engine)) selectIds(b.engine, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual([...deckOf(b.engine, P1)].sort(), [b.id("d0"), b.id("d1"), b.id("wi")].sort());
  assert.deepEqual(revealedIds(b.engine), []);
});

clause(RUDO, "3:rule", "only when RUDO is destroyed: another of my characters dying, or Rudo leaving play another way, offers no search", () => {
  const ally = legacyBoard();
  killRudo(ally, "ally");
  assert.equal(zoneOf(ally.engine, ally.id("ally")), "discard");
  assert.equal(ally.engine.state.pendingChoice, undefined, "an ally died: no search");
  const bounce = legacyBoard({
    cards: [
      {
        key: "bn",
        def: tactic({
          name: "Bounce",
          cost: 0,
          behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
        } as never),
        owner: P1,
        zone: "hand"
      }
    ]
  });
  play(bounce.engine, P1, bounce.id("bn"), { selected: { t: [bounce.id("rd")] } });
  assert.equal(zoneOf(bounce.engine, bounce.id("rd")), "hand", "returned to hand, not destroyed");
  assert.equal(bounce.engine.state.pendingChoice, undefined, "no search");
});

// ============================================================================
// Salvo Sarume — character · warlord · dragon · cost 4 · [R][R] · 3/3/2
// ============================================================================

function svBoard(o: { owner?: Pid; extra?: Cards } = {}) {
  const me = o.owner ?? P1;
  const you = me === P1 ? P2 : P1;
  return buildGame({
    playerA: { faction: developFaction(), influence: 10 },
    playerB: { faction: developFaction(), influence: 10 },
    turn: 2,
    activePlayerId: me,
    cards: [
      { key: "sv", def: printing(SALVO), owner: me, zone: "play" },
      ...bank("rage", 2, me).map((p, i) => ({ ...p, key: `myres${i}` })),
      { key: "myfd", def: bank("greed", 1, me)[0].def, owner: me, zone: "play", faceDown: true },
      { ...att("rage", 1, me)[0], key: "mysp" },
      { ...bank("rage", 1, you)[0], key: "theirres" },
      { key: "ally", def: victim("Ally", 2), owner: me, zone: "play" },
      { key: "weak", def: victim("Weak", 1), owner: me, zone: "play", depleted: true },
      { key: "foe", def: victim("Foe", 3), owner: you, zone: "play" },
      { key: "foefrag", def: victim("FoeFragile", 1), owner: you, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: me, zone: "play" },
      { key: "wall", def: victim("Wall", 9, { strength: 1 }), owner: you, zone: "play" },
      ...(o.extra ?? [])
    ]
  });
}
type SvBoard = ReturnType<typeof svBoard>;
/** Salvo (or `attackers`) attacks the faction unblocked and the battle runs until the first pending choice. */
function salvoHits(b: SvBoard, attackers = ["sv"], by: Pid = P1) {
  const you = by === P1 ? P2 : P1;
  declareAttackBy(b.engine, by, attackers.map((k) => b.id(k)));
  b.engine.perform({ type: "declareBlockers", playerId: you, blockerIds: [] } as never);
  autoResolveBattle(b.engine);
}
const hurtAny = (b: SvBoard, keys: string[]) => keys.filter((k) => zoneOf(b.engine, b.id(k)) === "discard" || dmg(b.engine, b.id(k)) > 0);

clause(SALVO, "0:rule", "printed: warlord dragon character, 3 strength / 3 speed / 2 life, cost 4 with [R][R]", () => {
  const b = svBoard();
  assert.equal(b.engine.getStat(b.id("sv"), "strength"), 3);
  assert.equal(b.engine.getStat(b.id("sv"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("sv"), "life"), 2);
  const p = printing(SALVO);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "warlord");
  assert.deepEqual([...p.subtype!], ["dragon"]);
  deployChecks(SALVO, 4, "rage", 2, "play");
});

clause(SALVO, "0:rule", "battle damage to a faction: I may put a resource I control into its owner's hand, then every character takes 1 damage", () => {
  const b = svBoard();
  salvoHits(b);
  const pc = pend(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1);
  assert.equal(inf(b.engine, P2), 7, "the 3 battle damage hit the faction");
  selectIds(b.engine, [b.id("myres0")]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("myres0")), "hand", "the resource returned to its owner's hand");
  assert.ok(handOf(b.engine, P1).includes(b.id("myres0")), "handOf(b.engine, P1).includes(b.id(\"myres0\"))");
  assert.equal(dmg(b.engine, b.id("sv")), 1, "Salvo itself is also a character");
  assert.equal(dmg(b.engine, b.id("ally")), 1, "my idle character");
  assert.equal(dmg(b.engine, b.id("foe")), 1, "the enemy character");
  assert.equal(zoneOf(b.engine, b.id("weak")), "discard", "life 1 character destroyed (depleted or not)");
  assert.equal(zoneOf(b.engine, b.id("foefrag")), "discard", "life 1 enemy destroyed");
  assert.equal(dmg(b.engine, b.id("wall")), 1, "exactly 1 each");
  assert.equal(zoneOf(b.engine, b.id("gear")), "play", "items are not characters");
  assert.equal(dmg(b.engine, b.id("gear")), 0, "the item took no damage");
  assert.equal(dmg(b.engine, b.id("myres1")), 0, "resources took no damage");
  assert.equal(inf(b.engine, P1), 10, "my faction untouched by the barrage");
  assert.equal(inf(b.engine, P2), 7, "factions take no extra damage");
});

clause(SALVO, "0:rule", "'a resource': ONE resource only, picking two is refused (control: one is accepted)", () => {
  const b = svBoard();
  salvoHits(b);
  refused(() => selectIds(b.engine, [b.id("myres0"), b.id("myres1")]), "two resources in one pick");
  assert.equal(zoneOf(b.engine, b.id("myres0")), "play", "myres0 untouched by the refused pick");
  assert.equal(zoneOf(b.engine, b.id("myres1")), "play", "myres1 untouched by the refused pick");
  assert.equal(dmg(b.engine, b.id("ally")), 0, "no damage dealt by the refused pick");
  selectIds(b.engine, [b.id("myres0")]);
  assert.equal(zoneOf(b.engine, b.id("myres0")), "hand", "control: one resource returned");
  assert.equal(zoneOf(b.engine, b.id("myres1")), "play", "the other stays");
});

clause(SALVO, "0:rule", "'you may': declining returns no resource and deals no damage", () => {
  const b = svBoard();
  salvoHits(b);
  selectIds(b.engine, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("myres0")), "play");
  assert.equal(zoneOf(b.engine, b.id("myres1")), "play");
  assert.deepEqual(hurtAny(b, ["sv", "ally", "weak", "foe", "foefrag", "wall"]), [], "no damage to anyone");
  assert.equal(inf(b.engine, P2), 7, "the battle damage itself still happened");
});

clause(SALVO, "0:rule", "the resource must be one I control: the opponent's resource is refused; face-down and spent resources of mine are allowed", () => {
  const b = svBoard();
  salvoHits(b);
  refused(() => selectIds(b.engine, [b.id("theirres")]), "the opponent's resource", ANY);
  refused(() => selectIds(b.engine, [b.id("ally")]), "a character", ANY);
  refused(() => selectIds(b.engine, [b.id("gear")]), "an item", ANY);
  assert.equal(pend(b.engine)?.kind, "chooserSelectsTarget", "still waiting");
  selectIds(b.engine, [b.id("myfd")]);
  assert.equal(zoneOf(b.engine, b.id("myfd")), "hand", "a face-down resource of mine");
  assert.equal(dmg(b.engine, b.id("ally")), 1);
  const sp = svBoard();
  salvoHits(sp);
  selectIds(sp.engine, [sp.id("mysp")]);
  assert.equal(zoneOf(sp.engine, sp.id("mysp")), "hand", "a spent resource of mine");
});

clause(SALVO, "0:rule", "the resource goes to ITS OWNER's hand: a resource I control but the opponent owns returns to their hand", () => {
  const b = svBoard({ extra: [{ ...bank("rage", 1, P2)[0], key: "stolen", controller: P1 }] });
  salvoHits(b);
  selectIds(b.engine, [b.id("stolen")]);
  assert.equal(zoneOf(b.engine, b.id("stolen")), "hand");
  assert.ok(handOf(b.engine, P2).includes(b.id("stolen")), "in the owner's hand");
  assert.ok(!handOf(b.engine, P1).includes(b.id("stolen")), "not in mine");
  assert.equal(dmg(b.engine, b.id("foe")), 1, "and the barrage still follows");
});

clause(SALVO, "0:rule", "only battle damage to a FACTION by THIS card: a blocked Salvo, or another attacker hitting the faction, offers nothing", () => {
  const blocked = svBoard();
  declareAttackBy(blocked.engine, P1, [blocked.id("sv")]);
  blocked.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [blocked.id("wall")] } as never);
  autoResolveBattle(blocked.engine);
  assert.equal(blocked.engine.state.pendingChoice, undefined, "damage went to a character, not a faction");
  assert.equal(zoneOf(blocked.engine, blocked.id("myres0")), "play");
  assert.equal(inf(blocked.engine, P2), 10);
  const other = svBoard();
  salvoHits(other, ["ally"]);
  assert.equal(other.engine.state.pendingChoice, undefined, "Salvo did not hit the faction");
  assert.equal(inf(other.engine, P2), 9, "the ally hit the faction for 1");
  assert.equal(zoneOf(other.engine, other.id("myres0")), "play");
});

clause(SALVO, "0:rule", "the opponent's Salvo works for its controller: their resource is returned, mine is not offered", () => {
  const b = svBoard({ owner: P2 });
  salvoHits(b, ["sv"], P2);
  const pc = pend(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P2);
  refused(() => selectIds(b.engine, [b.id("theirres")]), "the other player's resource", ANY);
  selectIds(b.engine, [b.id("myres0")]);
  assert.ok(handOf(b.engine, P2).includes(b.id("myres0")), "handOf(b.engine, P2).includes(b.id(\"myres0\"))");
  assert.equal(dmg(b.engine, b.id("sv")), 1);
  assert.equal(inf(b.engine, P1), 7);
});

// Keep the unused helper imports honest.
void declineAll;
void volition;
void tactic;
