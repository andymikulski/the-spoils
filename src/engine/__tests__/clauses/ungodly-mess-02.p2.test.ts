// Clause tests: Ungodly Mess batch 02, part p2 (groups 9-13, missing clauses only).
import assert from "node:assert/strict";
import type { SpoilsEngine } from "../../SpoilsEngine.js";
import {
  buildGame,
  autoResolveBattle, bank, character, developFaction, location, play, resolvePendingResponses, resourceCard, tactic, volition, P1, P2
} from "../per-card/_harness.js";
import { declareAttackBy, declareAttackOpenWindow, playRaw } from "./_battle.js";
import { answerPending, pending, zoneOf } from "./_board.js";
import { clause, declineAll, drain, printing, refused, type PendingChoiceLike, flipUpNow } from "./_clause.js";
import { endTurn } from "./_turn.js";

type Cards = NonNullable<NonNullable<Parameters<typeof buildGame>[0]>["cards"]>;
type Def = ReturnType<typeof character>;
const ANY = /[\s\S]*/;
const ready = (e: SpoilsEngine, p: string) => e.getAvailableResourceCount(p as never);
const handOf = (e: SpoilsEngine, p: string) => [...e.state.players[p as never].hand] as string[];
const deckOf = (e: SpoilsEngine, p: string) => [...e.state.players[p as never].deck] as string[];
const noTextChar = (name: string, over: Partial<Def> = {}) => character({ name, text: "no icons", ...over });
const resolveChoice = (e: SpoilsEngine, choice: Record<string, unknown>) => {
  const pc = pending(e)!;
  e.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
};
const pick = (ids: string[]) => ({ kind: "chooserSelectsTarget", selected: ids });
const reveals = (e: SpoilsEngine) => e.getLog().filter(entry => entry.event?.type === "cardsRevealed");
const isDepleted = (e: SpoilsEngine, cardId: string) => e.state.cards[cardId].depleted === true;

// ============================================================================
// Voidal Tactician
// When this card inflicts damage to a faction, you may pay 1. If you do, search that faction's controller's deck for a
// tactic, reveal it and put it into the void. -- When this card is depleted, you may deploy a tactic in the void as
// though it were in your hand without meeting its threshold.
// Character, arcanist, advisor, cost 4, [O][O][O][O], str 2 / spd 3 / life 3.
// ============================================================================
const VT = "a59feec7-7291-40f8-af99-8ca84aa2cb8c";

function vtBoard(o: { obs?: number; extra?: Cards; vt?: "play" | "hand"; noTactics?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "vt", def: printing(VT), owner: P1, zone: o.vt ?? "play" },
      ...bank("obsession", o.obs ?? 2, P1),
      ...(o.noTactics ? [] : [
        { key: "t1", def: tactic({ name: "T1", cost: 0 }), owner: P2, zone: "deck" as const },
        { key: "t2", def: tactic({ name: "T2", cost: 0 }), owner: P2, zone: "deck" as const }
      ]),
      { key: "c1", def: noTextChar("C1"), owner: P2, zone: "deck" },
      { key: "mt", def: tactic({ name: "MyT", cost: 0 }), owner: P1, zone: "deck" },
      ...(o.extra ?? [])
    ]
  });
}
type VtB = ReturnType<typeof vtBoard>;

/** Attack the opposing faction with `attackers` (default the Tactician) and resolve the battle up to the damage triggers. */
function vtHit(b: VtB, attackers: string[] = ["vt"], blockers: string[] = [], blockerPlayer = P2) {
  declareAttackBy(b.engine, P1, attackers.map(k => b.id(k)));
  drain(b.engine, declineAll);
  b.engine.perform({ type: "declareBlockers", playerId: blockerPlayer, blockerIds: blockers.map(k => b.id(k)) });
  autoResolveBattle(b.engine);
}

clause(VT, "0:rule", "printed card: Arcanist advisor character, cost 4, [O][O][O][O], 2/3/3; deploys for exactly 4 with four [O]", () => {
  const p = printing(VT);
  assert.deepEqual([p.type, p.trade, p.subtype, p.cost, p.threshold, p.strength, p.speed, p.life], ["character", "arcanist", ["advisor"], 4, "oooo", 2, 3, 3]);
  const b = vtBoard({ obs: 4, vt: "hand" });
  assert.equal(ready(b.engine, P1), 4);
  play(b.engine, P1, b.id("vt"));
  assert.equal(zoneOf(b.engine, b.id("vt")), "play");
  assert.equal(ready(b.engine, P1), 0, "exactly 4 paid");
  assert.deepEqual([b.engine.getStat(b.id("vt"), "strength"), b.engine.getStat(b.id("vt"), "speed"), b.engine.getStat(b.id("vt"), "life")], [2, 3, 3]);
});

clause(VT, "0:rule", "one resource short (3 [O]) is refused; four resources with only three [O] icons is refused (threshold [O][O][O][O])", () => {
  const b = vtBoard({ obs: 3, vt: "hand" });
  refused(() => play(b.engine, P1, b.id("vt")), "3 resources for cost 4", ANY);
  assert.equal(zoneOf(b.engine, b.id("vt")), "hand");
  assert.equal(ready(b.engine, P1), 3);
  const c = vtBoard({ obs: 3, vt: "hand", extra: bank("rage", 1, P1) });
  assert.equal(ready(c.engine, P1), 4);
  refused(() => play(c.engine, P1, c.id("vt")), "3 [O] + 1 [R] misses the fourth [O]", ANY);
  assert.equal(zoneOf(c.engine, c.id("vt")), "hand");
  const ok = vtBoard({ obs: 4, vt: "hand" });
  play(ok.engine, P1, ok.id("vt"));
  assert.equal(zoneOf(ok.engine, ok.id("vt")), "play", "control: four [O]");
});

clause(VT, "0:rule", "unblocked damage to the faction offers a mayPay (cost 1) to its controller; paying lets them search the damaged faction's controller's deck, reveal the tactic and put it into the void", () => {
  const b = vtBoard({ obs: 2 });
  const before = ready(b.engine, P1);
  vtHit(b);
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "mayPay");
  assert.equal(pc.playerId, P1);
  assert.equal(ready(b.engine, P1), before, "nothing is paid before saying yes");
  assert.equal(zoneOf(b.engine, b.id("t1")), "deck");
  resolveChoice(b.engine, { kind: "mayPay", pay: true });
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(b.engine)?.playerId, P1, "the Tactician's controller searches");
  resolveChoice(b.engine, pick([b.id("t1")]));
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(before - ready(b.engine, P1), 1, "exactly 1 paid");
  assert.equal(zoneOf(b.engine, b.id("t1")), "void");
  assert.equal(b.engine.state.cards[b.id("t1")].ownerId, P2);
  assert.equal(zoneOf(b.engine, b.id("t2")), "deck", "only the one tactic");
  assert.equal(zoneOf(b.engine, b.id("c1")), "deck");
  assert.equal(zoneOf(b.engine, b.id("mt")), "deck", "my own deck is untouched");
  const rev = reveals(b.engine);
  assert.equal(rev.length, 1, "the found tactic is revealed");
  assert.deepEqual((rev[0].event as unknown as { cardIds: string[] }).cardIds, [b.id("t1")]);
});

clause(VT, "0:rule", "declining to pay: nothing is paid, nothing is searched, the tactics stay in the deck", () => {
  const b = vtBoard({ obs: 2 });
  const before = ready(b.engine, P1);
  vtHit(b);
  assert.equal(pending(b.engine)?.kind, "mayPay");
  resolveChoice(b.engine, { kind: "mayPay", pay: false });
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(ready(b.engine, P1), before);
  assert.equal(zoneOf(b.engine, b.id("t1")), "deck");
  assert.equal(zoneOf(b.engine, b.id("t2")), "deck");
});

clause(VT, "0:rule", "the search takes a tactic of the DAMAGED faction's controller's deck only: a non-tactic, a second tactic at once, and my own deck's tactic are all refused", () => {
  const b = vtBoard({ obs: 2 });
  vtHit(b);
  resolveChoice(b.engine, { kind: "mayPay", pay: true });
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  refused(() => resolveChoice(b.engine, pick([b.id("c1")])), "a character is not a tactic", ANY);
  refused(() => resolveChoice(b.engine, pick([b.id("t1"), b.id("t2")])), "only one tactic", ANY);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting");
  resolveChoice(b.engine, pick([b.id("t2")]));
  assert.equal(zoneOf(b.engine, b.id("t2")), "void", "control: a tactic of the opponent's deck works");
  assert.equal(zoneOf(b.engine, b.id("t1")), "deck");
});

clause(VT, "0:rule", "my own deck's tactic is not searchable: only the damaged faction's controller's deck is", () => {
  const b = vtBoard({ obs: 2 });
  vtHit(b);
  resolveChoice(b.engine, { kind: "mayPay", pay: true });
  resolvePendingResponses(b.engine);
  refused(() => resolveChoice(b.engine, pick([b.id("mt")])), "my own deck's tactic", ANY);
  assert.equal(zoneOf(b.engine, b.id("mt")), "deck");
});

clause(VT, "0:rule", "when the opponent's deck holds no tactic, paying still works and nothing is moved to the void (no soft-lock)", () => {
  const b = vtBoard({ obs: 2, noTactics: true });
  const before = ready(b.engine, P1);
  vtHit(b);
  assert.equal(pending(b.engine)?.kind, "mayPay");
  resolveChoice(b.engine, { kind: "mayPay", pay: true });
  resolvePendingResponses(b.engine);
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(before - ready(b.engine, P1), 1, "the pay was made");
  assert.equal(zoneOf(b.engine, b.id("c1")), "deck");
  assert.equal(zoneOf(b.engine, b.id("mt")), "deck");
});

clause(VT, "0:rule", "with no resource to pay 1 the pay cannot be made: no tactic leaves the deck", () => {
  const b = vtBoard({ obs: 0 });
  vtHit(b);
  const pc = pending(b.engine);
  if (pc) {
    refused(() => resolveChoice(b.engine, { kind: "mayPay", pay: true }), "cannot afford 1", ANY);
    drain(b.engine, declineAll);
  }
  assert.equal(zoneOf(b.engine, b.id("t1")), "deck");
  assert.equal(zoneOf(b.engine, b.id("t2")), "deck");
});

clause(VT, "0:rule", "damage to a CHARACTER (blocked) does not trigger it: no pay offer", () => {
  const b = vtBoard({ obs: 2, extra: [{ key: "blk", def: noTextChar("Blk", { strength: 1, life: 6, speed: 1 }), owner: P2, zone: "play" }] });
  vtHit(b, ["vt"], ["blk"]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("t1")), "deck");
  assert.equal(b.engine.state.cards[b.id("blk")].damage ?? 0, 2, "control: it did damage the blocker");
});

clause(VT, "0:rule", "another character of mine inflicting damage to the faction does not trigger it", () => {
  const b = vtBoard({ obs: 2, extra: [{ key: "ally", def: noTextChar("Ally", { strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" }] });
  vtHit(b, ["ally"]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("t1")), "deck");
});

clause(VT, "0:rule", "attacking together with an ally: the Tactician's own faction damage triggers it exactly once", () => {
  const b = vtBoard({ obs: 3, extra: [{ key: "ally", def: noTextChar("Ally", { strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" }] });
  vtHit(b, ["vt", "ally"]);
  assert.equal(pending(b.engine)?.kind, "mayPay");
  resolveChoice(b.engine, { kind: "mayPay", pay: true });
  resolvePendingResponses(b.engine);
  resolveChoice(b.engine, pick([b.id("t1")]));
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined, "no second offer");
  assert.equal(zoneOf(b.engine, b.id("t1")), "void");
});

// --- When this card is depleted ------------------------------------------------

const DEPLETER = () => tactic({
  name: "Depleter",
  cost: 0,
  behavior: { abilities: [{ id: "d", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "deplete", target: { type: "selected", id: "t" } }] }] }
});
function vtVoidBoard(o: { obs?: number; extra?: Cards } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "vt", def: printing(VT), owner: P1, zone: "play" },
      { key: "ally", def: noTextChar("Ally"), owner: P1, zone: "play" },
      { key: "dep", def: DEPLETER(), owner: P1, zone: "hand" },
      { key: "vtac", def: tactic({ name: "Void Tac", cost: 2, threshold: "rr" }), owner: P1, zone: "void" },
      { key: "vtac2", def: tactic({ name: "Void Tac Two", cost: 1, threshold: "gg" }), owner: P1, zone: "void" },
      { key: "vch", def: noTextChar("Void Char"), owner: P1, zone: "void" },
      { key: "ovt", def: tactic({ name: "Their Void Tac", cost: 0 }), owner: P2, zone: "void" },
      { key: "htac", def: tactic({ name: "Hand Tac", cost: 0, threshold: "rr" }), owner: P1, zone: "hand" },
      ...bank("obsession", o.obs ?? 4, P1),
      ...(o.extra ?? [])
    ]
  });
}
type VvB = ReturnType<typeof vtVoidBoard>;
const depleteVt = (b: VvB, who = "vt") => play(b.engine, P1, b.id("dep"), { selected: { t: [b.id(who)] } });

clause(VT, "1:rule", "when it is depleted its controller may deploy one tactic from the void paying its cost, ignoring its threshold [R][R]; the tactic resolves and goes to the discard pile", () => {
  const b = vtVoidBoard();
  const before = ready(b.engine, P1);
  depleteVt(b);
  assert.equal(isDepleted(b.engine, b.id("vt")), true);
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  resolveChoice(b.engine, pick([b.id("vtac")]));
  drain(b.engine, c => (c.kind === "deployForFree" ? { kind: "deployForFree", cardId: b.id("vtac") } : declineAll(c)));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("vtac")), "discard", "the tactic was deployed and resolved");
  assert.equal(before - ready(b.engine, P1), 2, "its printed cost 2 is paid (not free)");
  assert.equal(zoneOf(b.engine, b.id("vtac2")), "void", "only the one tactic");
});

clause(VT, "1:rule", "the threshold exemption is only for the void deploy: the same threshold in hand ([R][R], no Rage) is refused", () => {
  const b = vtVoidBoard();
  refused(() => play(b.engine, P1, b.id("htac")), "threshold [R][R] unmet", ANY);
  assert.equal(zoneOf(b.engine, b.id("htac")), "hand");
});

clause(VT, "1:rule", "you may decline: the tactic stays in the void and nothing is paid; afterwards there is no standing permission to play it from the void", () => {
  const b = vtVoidBoard();
  const before = ready(b.engine, P1);
  depleteVt(b);
  resolveChoice(b.engine, pick([]));
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("vtac")), "void");
  assert.equal(ready(b.engine, P1), before);
  refused(() => play(b.engine, P1, b.id("vtac")), "no ongoing void permission", ANY);
  assert.equal(zoneOf(b.engine, b.id("vtac")), "void");
});

clause(VT, "1:rule", "only a tactic of mine can be picked: a character in my void, the opponent's void tactic, a card in play, and two tactics at once are all refused", () => {
  const b = vtVoidBoard();
  depleteVt(b);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  refused(() => resolveChoice(b.engine, pick([b.id("vch")])), "a character in the void is not a tactic", ANY);
  refused(() => resolveChoice(b.engine, pick([b.id("ovt")])), "the opponent's void tactic", ANY);
  refused(() => resolveChoice(b.engine, pick([b.id("ally")])), "a card in play", ANY);
  refused(() => resolveChoice(b.engine, pick([b.id("htac")])), "a tactic in hand", ANY);
  refused(() => resolveChoice(b.engine, pick([b.id("vtac"), b.id("vtac2")])), "only one tactic", ANY);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  resolveChoice(b.engine, pick([b.id("vtac2")]));
  drain(b.engine, c => (c.kind === "deployForFree" ? { kind: "deployForFree", cardId: b.id("vtac2") } : declineAll(c)));
  assert.equal(zoneOf(b.engine, b.id("vtac2")), "discard", "control: a tactic of my void works");
  assert.equal(zoneOf(b.engine, b.id("ovt")), "void");
  assert.equal(zoneOf(b.engine, b.id("vch")), "void");
});

clause(VT, "1:rule", "the cost is really paid: with only 1 resource a cost-2 tactic cannot be deployed from the void", () => {
  const b = vtVoidBoard({ obs: 1 });
  depleteVt(b);
  try {
    resolveChoice(b.engine, pick([b.id("vtac")]));
    drain(b.engine, c => (c.kind === "deployForFree" ? { kind: "deployForFree", cardId: b.id("vtac") } : declineAll(c)));
  } catch {
    /* refusing the pick is fine */
  }
  assert.equal(zoneOf(b.engine, b.id("vtac")), "void", "still in the void");
  assert.equal(ready(b.engine, P1), 1, "nothing was paid");
});

clause(VT, "1:rule", "depleting another character does not trigger it", () => {
  const b = vtVoidBoard();
  depleteVt(b, "ally");
  assert.equal(isDepleted(b.engine, b.id("ally")), true);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("vtac")), "void");
});

clause(VT, "1:rule", "depletion by attacking triggers it too", () => {
  const b = vtVoidBoard();
  declareAttackBy(b.engine, P1, [b.id("vt")]);
  assert.equal(isDepleted(b.engine, b.id("vt")), true);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(b.engine)?.playerId, P1);
});

// ============================================================================
// Volatile Communion
// EXTRA COST: Choose a number for X. Deplete X characters you control. -- Look at the top X+2 cards of your deck. You may
// put one of those cards into your hand. Put the remaining cards on the bottom of your deck in any order. -- FLIP UP: 1 [O]
// Tactic, arcanist, cost 2, [O].
// ============================================================================
const VC = "9f484c55-827e-4a25-a025-6f91743c7fae";

function vcBoard(o: { obs?: number; rage?: number; flip?: boolean; deck?: number; extra?: Cards } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "vc", def: printing(VC), owner: P1, zone: o.flip ? "play" : "hand", faceDown: o.flip ? true : undefined },
      ...bank("obsession", o.obs ?? 4, P1),
      ...bank("rage", o.rage ?? 0, P1),
      { key: "ch0", def: noTextChar("Ch0"), owner: P1, zone: "play" },
      { key: "ch1", def: noTextChar("Ch1"), owner: P1, zone: "play" },
      { key: "ch2", def: noTextChar("Ch2"), owner: P1, zone: "play" },
      { key: "foe", def: noTextChar("Foe"), owner: P2, zone: "play" },
      { key: "it", def: { ...noTextChar("It"), type: "item" } as Def, owner: P1, zone: "play" },
      ...Array.from({ length: o.deck ?? 8 }, (_, i) => ({ key: `d${i}`, def: noTextChar(`D${i}`), owner: P1, zone: "deck" as const })),
      { key: "od", def: noTextChar("OD"), owner: P2, zone: "deck" },
      ...(o.extra ?? [])
    ]
  });
}
type VcB = ReturnType<typeof vcBoard>;
const vcPlay = (b: VcB, x: number, d: string[]) => play(b.engine, P1, b.id("vc"), { selected: { d: d.map(k => b.id(k)) }, variables: { x } });
const vcFlip = (b: VcB, x: number, d: string[]) =>
  flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("vc"), selected: { d: d.map(k => b.id(k)) }, variables: { x } });
const looked = (b: VcB) => pending(b.engine) as unknown as { kind: string; playerId: string; cardIds: string[]; to?: string };

/** Finish the pending deck look by taking nothing: everything goes on the bottom. */
const vcFinish = (b: VcB) =>
  drain(b.engine, c => (c.kind === "reorderDeck" ? { kind: "reorderDeck", order: [...(c.cardIds as string[])] } : declineAll(c)));
const depletedKeys = (b: VcB) => ["ch0", "ch1", "ch2", "foe", "it"].map(k => isDepleted(b.engine, b.id(k)));

clause(VC, "0:extraCost", "printed card: Arcanist tactic, cost 2, [O]: two [O] resources deploy it for exactly 2; one resource is refused; two [R] resources (no [O]) are refused", () => {
  const p = printing(VC);
  assert.deepEqual([p.type, p.trade, p.cost, p.threshold], ["tactic", "arcanist", 2, "o"]);
  const b = vcBoard({ obs: 2 });
  vcPlay(b, 0, []);
  vcFinish(b);
  assert.equal(zoneOf(b.engine, b.id("vc")), "discard");
  assert.equal(ready(b.engine, P1), 0, "exactly 2 paid");
  const s = vcBoard({ obs: 1 });
  refused(() => vcPlay(s, 0, []), "1 resource for cost 2", ANY);
  assert.equal(zoneOf(s.engine, s.id("vc")), "hand");
  const r = vcBoard({ obs: 0, rage: 2 });
  assert.equal(ready(r.engine, P1), 2);
  refused(() => vcPlay(r, 0, []), "no [O] icon", ANY);
  assert.equal(zoneOf(r.engine, r.id("vc")), "hand");
});

clause(VC, "0:extraCost", "X=2: exactly the two chosen characters are depleted; the unchosen one, the opponent's character and the item are not; the cost of 2 is still paid", () => {
  const b = vcBoard({ obs: 4 });
  vcPlay(b, 2, ["ch0", "ch1"]);
  vcFinish(b);
  assert.deepEqual(depletedKeys(b), [true, true, false, false, false]);
  assert.equal(ready(b.engine, P1), 2, "4 ready minus the cost 2");
});

clause(VC, "0:extraCost", "X=1 depletes exactly the one chosen character", () => {
  const b = vcBoard();
  vcPlay(b, 1, ["ch2"]);
  vcFinish(b);
  assert.deepEqual(depletedKeys(b), [false, false, true, false, false]);
});

clause(VC, "0:extraCost", "X=0 depletes no character", () => {
  const z = vcBoard();
  vcPlay(z, 0, []);
  vcFinish(z);
  assert.deepEqual(depletedKeys(z), [false, false, false, false, false]);
});

clause(VC, "0:extraCost", "X=2 with only one character picked is refused (exactly X characters must be depleted); X=2 with two works", () => {
  const a = vcBoard();
  refused(() => vcPlay(a, 2, ["ch0"]), "X=2 needs two characters", ANY);
  assert.equal(zoneOf(a.engine, a.id("vc")), "hand");
  assert.equal(isDepleted(a.engine, a.id("ch0")), false);
  const ok = vcBoard();
  vcPlay(ok, 2, ["ch0", "ch1"]);
  vcFinish(ok);
  assert.equal(zoneOf(ok.engine, ok.id("vc")), "discard", "control");
});

clause(VC, "0:extraCost", "X=2 with NO character picked is refused", () => {
  const a = vcBoard();
  refused(() => vcPlay(a, 2, []), "X=2 needs two characters", ANY);
  assert.equal(zoneOf(a.engine, a.id("vc")), "hand");
});

clause(VC, "0:extraCost", "X=1 with two characters picked is refused (not more than X)", () => {
  const b = vcBoard();
  refused(() => vcPlay(b, 1, ["ch0", "ch1"]), "X=1 allows one character", ANY);
  assert.equal(zoneOf(b.engine, b.id("vc")), "hand");
  assert.equal(isDepleted(b.engine, b.id("ch0")), false);
  assert.equal(isDepleted(b.engine, b.id("ch1")), false);
});

clause(VC, "0:extraCost", "X=4 when I control only three characters is refused", () => {
  const c = vcBoard();
  refused(() => vcPlay(c, 4, ["ch0", "ch1", "ch2"]), "X=4 with only 3 characters", ANY);
  assert.equal(zoneOf(c.engine, c.id("vc")), "hand");
});

clause(VC, "0:extraCost", "the opponent's character cannot be depleted for the cost", () => {
  const a = vcBoard();
  refused(() => vcPlay(a, 1, ["foe"]), "opponent's character", ANY);
  assert.equal(isDepleted(a.engine, a.id("foe")), false);
  assert.equal(zoneOf(a.engine, a.id("vc")), "hand");
});

clause(VC, "0:extraCost", "a non-character (my item) cannot be depleted for the cost", () => {
  const b = vcBoard();
  refused(() => vcPlay(b, 1, ["it"]), "an item", ANY);
  assert.equal(isDepleted(b.engine, b.id("it")), false);
  assert.equal(zoneOf(b.engine, b.id("vc")), "hand");
});

clause(VC, "0:extraCost", "an already-depleted character cannot pay the deplete cost; a ready one can", () => {
  const c = vcBoard();
  c.engine.state.cards[c.id("ch0")].depleted = true;
  refused(() => vcPlay(c, 1, ["ch0"]), "already depleted", ANY);
  assert.equal(zoneOf(c.engine, c.id("vc")), "hand");
  const ok = vcBoard();
  ok.engine.state.cards[ok.id("ch0")].depleted = true;
  vcPlay(ok, 1, ["ch1"]);
  vcFinish(ok);
  assert.equal(zoneOf(ok.engine, ok.id("vc")), "discard", "control: a ready character works");
});

clause(VC, "0:extraCost", "the X characters are depleted as a cost: already depleted (and the 2 paid) while the deck look is still waiting", () => {
  const b = vcBoard();
  vcPlay(b, 2, ["ch0", "ch1"]);
  assert.equal(looked(b).kind, "reorderDeck");
  assert.deepEqual(depletedKeys(b), [true, true, false, false, false]);
  assert.equal(ready(b.engine, P1), 2, "cost already paid");
});


for (const x of [0, 1, 2]) {
  clause(VC, "1:rule", `X=${x}: its controller looks at exactly the top ${x + 2} cards of their own deck`, () => {
    const b = vcBoard();
    const deck = deckOf(b.engine, P1);
    const opp = deckOf(b.engine, P2);
    vcPlay(b, x, ["ch0", "ch1", "ch2"].slice(0, x));
    const pc = looked(b);
    assert.equal(pc.kind, "reorderDeck");
    assert.equal(pc.playerId, P1);
    assert.deepEqual(pc.cardIds, deck.slice(0, x + 2));
    assert.deepEqual(deckOf(b.engine, P2), opp);
  });
}

clause(VC, "1:rule", "with fewer than X+2 cards in the deck it looks at what is there", () => {
  const b = vcBoard({ deck: 3 });
  const deck = deckOf(b.engine, P1);
  vcPlay(b, 2, ["ch0", "ch1"]);
  assert.deepEqual(looked(b).cardIds, deck);
});

clause(VC, "1:rule", "taking nothing: all the looked-at cards go to the bottom of the deck in the order chosen, the rest of the deck is untouched and the hand does not grow", () => {
  const b = vcBoard();
  const deck = deckOf(b.engine, P1);
  vcPlay(b, 1, ["ch0"]);
  const [a, c, d] = looked(b).cardIds;
  const hand = handOf(b.engine, P1).length;
  resolveChoice(b.engine, { kind: "reorderDeck", order: [d, a, c] });
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(b.engine, P1), [...deck.slice(3), d, a, c]);
  assert.equal(handOf(b.engine, P1).length, hand);
  assert.equal(zoneOf(b.engine, b.id("vc")), "discard");
});

clause(VC, "1:rule", "Volatile Communion: you may put one of the looked-at cards into your hand and the remaining X+1 go to the bottom in any order", () => {
  const b = vcBoard();
  const deck = deckOf(b.engine, P1);
  const handBefore = handOf(b.engine, P1);
  vcPlay(b, 1, ["ch0"]);
  const [a, c, d] = looked(b).cardIds;
  // Take c into the hand; d then a go on the bottom, in that order.
  resolveChoice(b.engine, { kind: "reorderDeck", order: [d, a], hand: [c] });
  resolvePendingResponses(b.engine);
  drain(b.engine, declineAll);
  assert.deepEqual(handOf(b.engine, P1).filter(h => !handBefore.includes(h)), [c], "one of the looked-at cards is in hand");
  assert.deepEqual(deckOf(b.engine, P1), [...deck.slice(3), d, a], "the remaining two are at the bottom in the chosen order");
});

clause(VC, "2:flipUp", "FLIP UP costs 1 (not the printed 2) plus the extra cost; the face-down card may pay for itself; the card resolves and goes to the discard pile", () => {
  const b = vcBoard({ flip: true, obs: 3 });
  assert.equal(ready(b.engine, P1), 4);
  const deck = deckOf(b.engine, P1);
  vcFlip(b, 1, ["ch0"]);
  assert.equal(isDepleted(b.engine, b.id("ch0")), true, "extra cost paid");
  assert.equal(looked(b).kind, "reorderDeck");
  assert.deepEqual(looked(b).cardIds, deck.slice(0, 3), "top X+2 = 3");
  resolveChoice(b.engine, { kind: "reorderDeck", order: [...looked(b).cardIds] });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("vc")), "discard");
  assert.ok([2, 3].includes(ready(b.engine, P1)), "4 ready: 1 paid (by the card itself or a bank) and the flipped card is no longer a resource");
});

clause(VC, "2:flipUp", "FLIP UP costs exactly 1 (X=0): with three other [O] resources exactly one is spent, not 0, 2 or the printed 2", () => {
  const b = vcBoard({ flip: true, obs: 3 });
  assert.equal(ready(b.engine, P1), 4);
  vcFlip(b, 0, []);
  vcFinish(b);
  assert.equal(zoneOf(b.engine, b.id("vc")), "discard");
  assert.equal(ready(b.engine, P1), 2, "one of the three banks spent; the flipped card is no longer a resource");
});

clause(VC, "2:flipUp", "a face-down card alone can pay the 1: with no other resource the cost is payable but the [O] icon is missing so it is refused; one [O] resource makes it work", () => {
  const a = vcBoard({ flip: true, obs: 0, rage: 2 });
  assert.equal(ready(a.engine, P1), 3);
  refused(() => vcFlip(a, 0, []), "no [O] icon besides the card's own", ANY);
  assert.equal(a.engine.state.cards[a.id("vc")].faceDown, true);
  assert.equal(ready(a.engine, P1), 3, "nothing paid");
  const ok = vcBoard({ flip: true, obs: 1 });
  vcFlip(ok, 0, []);
  drain(ok.engine, c => (c.kind === "reorderDeck" ? { kind: "reorderDeck", order: [...(c.cardIds as string[])] } : declineAll(c)));
  assert.equal(zoneOf(ok.engine, ok.id("vc")), "discard", "control");
  assert.ok([0, 1].includes(ready(ok.engine, P1)), "2 ready: 1 paid, the flipped card is no longer a resource");
});

clause(VC, "2:flipUp", "FLIP UP still needs the extra cost: X=1 with no character picked and X=2 with one are refused", () => {
  const a = vcBoard({ flip: true, obs: 2 });
  refused(() => vcFlip(a, 1, []), "no character for X=1", ANY);
  assert.equal(a.engine.state.cards[a.id("vc")].faceDown, true);
  const b = vcBoard({ flip: true, obs: 2 });
  refused(() => vcFlip(b, 2, ["ch0"]), "X=2 with one character", ANY);
  assert.equal(b.engine.state.cards[b.id("vc")].faceDown, true);
  assert.equal(isDepleted(b.engine, b.id("ch0")), false);
});

// ============================================================================
// Wasted Wickedness
// EXTRA COST: Pick a player. X is the number of different types of staple resources they control. Pay X+X. -- That player
// puts X non-resource cards they control into their owner's hand. -- FLIP UP: 1 [O]
// Tactic, arcanist, cost 0, [O][O].
// ============================================================================
const WW = "feb21afe-1749-4041-b5b0-0586c4bc4964";

function wwBoard(o: { obs?: number; mine?: Cards; opp?: Cards; flip?: boolean; oppStaples?: boolean; fd?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ww", def: printing(WW), owner: P1, zone: o.flip ? "play" : "hand", faceDown: o.flip ? true : undefined },
      ...bank("obsession", o.obs ?? 8, P1),
      ...(o.oppStaples === false ? [] : [...bank("rage", 2, P2), ...bank("greed", 1, P2)]),
      ...(o.fd ? volition(2, P2) : []),
      { key: "c1", def: noTextChar("C1"), owner: P2, zone: "play" },
      { key: "c2", def: noTextChar("C2"), owner: P2, zone: "play" },
      { key: "c3", def: noTextChar("C3"), owner: P2, zone: "play" },
      { key: "m1", def: noTextChar("M1"), owner: P1, zone: "play" },
      { key: "m2", def: noTextChar("M2"), owner: P1, zone: "play" },
      { key: "oh", def: noTextChar("OH"), owner: P2, zone: "hand" },
      ...(o.mine ?? []),
      ...(o.opp ?? [])
    ]
  });
}
type WwB = ReturnType<typeof wwBoard>;
const wwPlay = (b: WwB, mode: number) => play(b.engine, P1, b.id("ww"), { mode });
const wwFlip = (b: WwB, mode?: number) =>
  flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("ww"), selected: {}, variables: {}, ...(mode !== undefined ? { mode } : {}) });

clause(WW, "0:extraCost", "printed card: Arcanist tactic, cost 0, [O][O]: with X=0 it is free but still needs two [O]: one [O] and two [R] are refused, two [O] work", () => {
  const p = printing(WW);
  assert.deepEqual([p.type, p.trade, p.cost, p.threshold], ["tactic", "arcanist", 0, "oo"]);
  const one = wwBoard({ obs: 1, oppStaples: false });
  refused(() => wwPlay(one, 0), "one [O] icon for threshold [O][O]", ANY);
  assert.equal(zoneOf(one.engine, one.id("ww")), "hand");
  const rage = wwBoard({ obs: 0, oppStaples: false, mine: bank("rage", 2, P1) });
  refused(() => wwPlay(rage, 0), "no [O] icons", ANY);
  assert.equal(zoneOf(rage.engine, rage.id("ww")), "hand");
  const ok = wwBoard({ obs: 2, oppStaples: false });
  wwPlay(ok, 0);
  drain(ok.engine, declineAll);
  assert.equal(zoneOf(ok.engine, ok.id("ww")), "discard");
  assert.equal(ready(ok.engine, P1), 2, "X=0: nothing paid");
  assert.equal(zoneOf(ok.engine, ok.id("c1")), "play", "X=0: nothing returned");
});

clause(WW, "0:extraCost", "pick the opponent with 2 different staple types (Rage x2, Greed x1): X=2, pay X+X=4 exactly; their face-down resources are not staples", () => {
  const b = wwBoard({ obs: 8 });
  assert.equal(ready(b.engine, P1), 8);
  wwPlay(b, 0);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  assert.equal(ready(b.engine, P1), 4, "paid exactly 4");
});

clause(WW, "0:extraCost", "short by one: X=2 needs 4 resources, 3 are refused with nothing paid; 4 with only one [O] ... still refused; 4 works", () => {
  const s = wwBoard({ obs: 3 });
  refused(() => wwPlay(s, 0), "3 resources for X+X=4", ANY);
  assert.equal(zoneOf(s.engine, s.id("ww")), "hand");
  assert.equal(ready(s.engine, P1), 3);
  const t = wwBoard({ obs: 1, mine: bank("rage", 3, P1) });
  assert.equal(ready(t.engine, P1), 4);
  refused(() => wwPlay(t, 0), "4 resources but only one [O] for threshold [O][O]", ANY);
  assert.equal(zoneOf(t.engine, t.id("ww")), "hand");
  const ok = wwBoard({ obs: 4 });
  wwPlay(ok, 0);
  assert.equal(ready(ok.engine, P1), 0, "control: exactly 4");
});

clause(WW, "0:extraCost", "X counts different TYPES: three Rage resources alone are X=1 (pay 2); Rage+Greed+Deception+Rage is X=3 (pay 6)", () => {
  const one = wwBoard({ obs: 8, oppStaples: false, opp: bank("rage", 3, P2) });
  wwPlay(one, 0);
  assert.equal(ready(one.engine, P1), 6, "X=1, paid 2");
  const three = wwBoard({ obs: 8, oppStaples: false, opp: [...bank("rage", 2, P2), ...bank("greed", 1, P2), ...bank("deception", 1, P2)] });
  wwPlay(three, 0);
  assert.equal(ready(three.engine, P1), 2, "X=3, paid 6");
});

clause(WW, "0:extraCost", "a non-staple resource is not counted: a Rage plus a plain non-staple resource is X=1 (pay 2)", () => {
  const b = wwBoard({
    obs: 8,
    oppStaples: false,
    opp: [...bank("rage", 1, P2), { key: "odd", def: resourceCard({ name: "Odd Resource", resource: { provides: ["rage"], staple: false } }), owner: P2, zone: "play" }]
  });
  wwPlay(b, 0);
  assert.equal(ready(b.engine, P1), 6, "X=1, paid 2");
});

clause(WW, "0:extraCost", "face-down resources are not staple resources of any type: Rage x2 + Greed x1 + two face-down cards is X=2 (pay 4), not 3", () => {
  const b = wwBoard({ obs: 8, fd: true });
  wwPlay(b, 0);
  assert.equal(ready(b.engine, P1), 4, "paid X+X=4");
  assert.equal(pending(b.engine)?.playerId, P2);
  resolveChoice(b.engine, pick([b.id("c1"), b.id("c2")]));
  assert.equal(zoneOf(b.engine, b.id("c1")), "hand");
});

clause(WW, "0:extraCost", "pick yourself: X counts MY staple types (Obsession + Rage = 2), pay X+X=4", () => {
  const b = wwBoard({ obs: 6, mine: bank("rage", 2, P1), oppStaples: false });
  assert.equal(ready(b.engine, P1), 8);
  wwPlay(b, 1);
  assert.equal(ready(b.engine, P1), 4, "X=2, paid 4");
  assert.equal(pending(b.engine)?.playerId, P1);
});

clause(WW, "1:rule", "pick the opponent: THEY choose X=2 of their non-resource cards and put them into their hand; the unchosen one, their resources, their hand and my cards stay", () => {
  const b = wwBoard();
  const oppHand = handOf(b.engine, P2);
  wwPlay(b, 0);
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "that player chooses");
  resolveChoice(b.engine, pick([b.id("c1"), b.id("c3")]));
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("c1")), "hand");
  assert.equal(zoneOf(b.engine, b.id("c3")), "hand");
  assert.equal(zoneOf(b.engine, b.id("c2")), "play");
  assert.deepEqual(handOf(b.engine, P2).filter(h => !oppHand.includes(h)).sort(), [b.id("c1"), b.id("c3")].sort());
  assert.equal(zoneOf(b.engine, b.id("m1")), "play");
  assert.equal(zoneOf(b.engine, b.id("m2")), "play");
  assert.equal(b.engine.state.players[P2].play.filter(c => b.engine.isResource(c)).length, 3, "their resources stay");
  assert.equal(zoneOf(b.engine, b.id("ww")), "discard");
});

clause(WW, "1:rule", "exactly X non-resource cards they control: a resource, their faction, my character, a card in their hand, one card too few and one too many are refused", () => {
  const b = wwBoard();
  wwPlay(b, 0);
  const faction = b.engine.state.players[P2].factionId!;
  const res = b.engine.state.players[P2].play.find(c => b.engine.isResource(c))!;
  refused(() => resolveChoice(b.engine, pick([b.id("c1"), res])), "a resource", ANY);
  refused(() => resolveChoice(b.engine, pick([b.id("c1"), faction])), "their faction", ANY);
  refused(() => resolveChoice(b.engine, pick([b.id("c1"), b.id("m1")])), "my character", ANY);
  refused(() => resolveChoice(b.engine, pick([b.id("c1"), b.id("oh")])), "a card in their hand", ANY);
  refused(() => resolveChoice(b.engine, pick([b.id("c1")])), "X=2 but one card", ANY);
  refused(() => resolveChoice(b.engine, pick([])), "X=2 but none (not optional)", ANY);
  refused(() => resolveChoice(b.engine, pick([b.id("c1"), b.id("c2"), b.id("c3")])), "X=2 but three", ANY);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  resolveChoice(b.engine, pick([b.id("c1"), b.id("c2")]));
  assert.equal(zoneOf(b.engine, b.id("c1")), "hand", "control");
});

clause(WW, "1:rule", "non-resource cards include items and locations they control", () => {
  const b = wwBoard({
    opp: [
      { key: "it", def: { ...noTextChar("It"), type: "item" } as Def, owner: P2, zone: "play" },
      { key: "lo", def: location({ name: "Lo" }), owner: P2, zone: "play" }
    ]
  });
  wwPlay(b, 0);
  resolveChoice(b.engine, pick([b.id("it"), b.id("lo")]));
  assert.equal(zoneOf(b.engine, b.id("it")), "hand");
  assert.equal(zoneOf(b.engine, b.id("lo")), "hand");
});

clause(WW, "1:rule", "a card they control but I own goes to its OWNER's hand (mine), not theirs", () => {
  const b = wwBoard({ opp: [{ key: "stolen", def: noTextChar("Stolen"), owner: P1, zone: "play", controller: P2 }] });
  const mine = handOf(b.engine, P1);
  const theirs = handOf(b.engine, P2);
  wwPlay(b, 0);
  resolveChoice(b.engine, pick([b.id("stolen"), b.id("c1")]));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("stolen")), "hand");
  assert.deepEqual(handOf(b.engine, P1).filter(h => !mine.includes(h)), [b.id("stolen")], "owner's hand");
  assert.equal(handOf(b.engine, P2).includes(b.id("stolen")), false);
  assert.deepEqual(handOf(b.engine, P2).filter(h => !theirs.includes(h)), [b.id("c1")]);
});

clause(WW, "1:rule", "if they control fewer than X non-resource cards, all of them return (no soft-lock)", () => {
  const b = wwBoard({ opp: [] });
  for (const k of ["c2", "c3"]) b.engine.state.cards[b.id(k)].zone = "discard";
  b.engine.state.players[P2].play = b.engine.state.players[P2].play.filter(c => c !== b.id("c2") && c !== b.id("c3"));
  b.engine.state.players[P2].discard.push(b.id("c2"), b.id("c3"));
  wwPlay(b, 0);
  const pc = pending(b.engine);
  if (pc) resolveChoice(b.engine, pick([b.id("c1")]));
  resolvePendingResponses(b.engine);
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("c1")), "hand", "their only non-resource card returned");
});

clause(WW, "1:rule", "pick yourself: I choose X of MY non-resource cards; the opponent's are not affected", () => {
  const b = wwBoard({ obs: 6, mine: bank("rage", 2, P1), oppStaples: false });
  wwPlay(b, 1);
  const pc = pending(b.engine)!;
  assert.equal(pc.playerId, P1);
  const myRes = b.engine.state.players[P1].play.find(c => b.engine.isResource(c))!;
  refused(() => resolveChoice(b.engine, pick([b.id("m1"), myRes])), "my own resource", ANY);
  refused(() => resolveChoice(b.engine, pick([b.id("m1"), b.id("c1")])), "an opponent's card", ANY);
  refused(() => resolveChoice(b.engine, pick([b.id("m1")])), "X=2 needs two", ANY);
  resolveChoice(b.engine, pick([b.id("m1"), b.id("m2")]));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("m1")), "hand");
  assert.equal(zoneOf(b.engine, b.id("m2")), "hand");
  assert.equal(zoneOf(b.engine, b.id("c1")), "play");
  assert.equal(ready(b.engine, P1), 4);
});

clause(WW, "2:flipUp", "FLIP UP pays 1 plus the extra cost X+X=4 (total 5), self included; the effect applies and the card is discarded", () => {
  const b = wwBoard({ flip: true, obs: 4 });
  assert.equal(ready(b.engine, P1), 5);
  wwFlip(b, 0);
  assert.equal(pending(b.engine)?.playerId, P2, "the opponent chooses");
  resolveChoice(b.engine, pick([b.id("c1"), b.id("c2")]));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("c1")), "hand");
  assert.equal(zoneOf(b.engine, b.id("c2")), "hand");
  assert.equal(zoneOf(b.engine, b.id("ww")), "discard");
  assert.equal(ready(b.engine, P1), 0, "5 paid, flipped card gone");
});

clause(WW, "2:flipUp", "FLIP UP is refused one resource short (self + 3 = 4 ready for 5), and needs an [O] icon after flipping (own Volition does not count)", () => {
  const s = wwBoard({ flip: true, obs: 3 });
  assert.equal(ready(s.engine, P1), 4);
  refused(() => wwFlip(s, 0), "4 ready for 1 + 4", ANY);
  assert.equal(s.engine.state.cards[s.id("ww")].faceDown, true);
  assert.equal(ready(s.engine, P1), 4, "nothing paid");
  const t = wwBoard({ flip: true, obs: 0, mine: bank("rage", 4, P1) });
  assert.equal(ready(t.engine, P1), 5);
  refused(() => wwFlip(t, 0), "no [O] icon", ANY);
  assert.equal(t.engine.state.cards[t.id("ww")].faceDown, true);
  const ok = wwBoard({ flip: true, obs: 1, mine: bank("rage", 3, P1) });
  wwFlip(ok, 0);
  resolveChoice(ok.engine, pick([ok.id("c1"), ok.id("c2")]));
  resolvePendingResponses(ok.engine);
  assert.equal(zoneOf(ok.engine, ok.id("ww")), "discard", "control: one [O] suffices");
});

clause(WW, "2:flipUp", "a flipped-up Wasted Wickedness can also pick YOURSELF (X from my staples, I choose my own cards)", () => {
  const b = wwBoard({ flip: true, obs: 6, mine: bank("rage", 2, P1) });
  wwFlip(b, 1);
  const pc = pending(b.engine);
  assert.equal(pc?.playerId, P1, "I choose my own cards");
  resolveChoice(b.engine, pick([b.id("m1"), b.id("m2")]));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("m1")), "hand");
  assert.equal(zoneOf(b.engine, b.id("c1")), "play");
});

// ============================================================================
// Zenobian Mechanics Explained
// EXTRA COST: Choose a character an opponent controls. -- Put the character into its owner's hand. If you control an
// attacking party of at least 2 members, that player discards a card. -- FLIP UP: 4 [O]
// Tactic, arcanist, cost 2, [O][O][O].
// ============================================================================
const ZME = "e1c896c0-6e2b-46af-9dbb-008146423145";

function zmeBoard(o: { obs?: number; flip?: boolean; extra?: Cards; turn?: number; active?: typeof P1 | typeof P2 } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn ?? 2,
    activePlayerId: o.active,
    cards: [
      { key: "zme", def: printing(ZME), owner: P1, zone: o.flip ? "play" : "hand", faceDown: o.flip ? true : undefined },
      ...bank("obsession", o.obs ?? 3, P1),
      { key: "foe1", def: noTextChar("Foe1"), owner: P2, zone: "play" },
      { key: "foe2", def: noTextChar("Foe2"), owner: P2, zone: "play" },
      { key: "fit", def: { ...noTextChar("FIt"), type: "item" } as Def, owner: P2, zone: "play" },
      { key: "mine", def: noTextChar("Mine"), owner: P1, zone: "play" },
      { key: "a1", def: noTextChar("A1", { strength: 1, life: 4, speed: 1 }), owner: P1, zone: "play" },
      { key: "a2", def: noTextChar("A2", { strength: 1, life: 4, speed: 1 }), owner: P1, zone: "play" },
      { key: "a3", def: noTextChar("A3", { strength: 1, life: 4, speed: 1 }), owner: P1, zone: "play" },
      { key: "h1", def: noTextChar("H1"), owner: P2, zone: "hand" },
      { key: "h2", def: noTextChar("H2"), owner: P2, zone: "hand" },
      { key: "ph", def: noTextChar("PH"), owner: P1, zone: "hand" },
      ...(o.extra ?? [])
    ]
  });
}
type ZmB = ReturnType<typeof zmeBoard>;
const zmePlay = (b: ZmB, c: string[]) => play(b.engine, P1, b.id("zme"), { selected: { c: c.map(k => b.id(k)) } });
const zmeFlip = (b: ZmB, c: string[]) =>
  flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("zme"), selected: { c: c.map(k => b.id(k)) }, variables: {} });
/** P1 attacks with `attackers`, and (still holding priority) plays Zenobian Mechanics Explained on `target`. */
function zmeInBattle(b: ZmB, attackers: string[], target: string) {
  b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: attackers.map(k => b.id(k)), target: { type: "faction", playerId: P2 } });
  play(b.engine, P1, b.id("zme"), { selected: { c: [b.id(target)] } });
}

clause(ZME, "0:extraCost", "printed card: Arcanist tactic, cost 2, [O][O][O]: three [O] deploy it for exactly 2; two [O] are refused; three [G] are refused; two [O] + one [G] are refused", () => {
  const p = printing(ZME);
  assert.deepEqual([p.type, p.trade, p.cost, p.threshold], ["tactic", "arcanist", 2, "ooo"]);
  const b = zmeBoard({ obs: 3 });
  zmePlay(b, ["foe1"]);
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("zme")), "discard");
  assert.equal(ready(b.engine, P1), 1, "exactly 2 paid");
  const two = zmeBoard({ obs: 2 });
  refused(() => zmePlay(two, ["foe1"]), "two [O]", ANY);
  assert.equal(zoneOf(two.engine, two.id("zme")), "hand");
  const g = zmeBoard({ obs: 0, extra: bank("greed", 3, P1) });
  refused(() => zmePlay(g, ["foe1"]), "three [G]", ANY);
  const mix = zmeBoard({ obs: 2, extra: bank("greed", 1, P1) });
  assert.equal(ready(mix.engine, P1), 3);
  refused(() => zmePlay(mix, ["foe1"]), "[O][O][G]", ANY);
  assert.equal(zoneOf(mix.engine, mix.id("zme")), "hand");
});

clause(ZME, "0:extraCost", "the choice must be exactly one character an opponent controls: none, my character, their item, their faction, their hand card and two characters are refused", () => {
  const cases: Array<[string, string[]]> = [
    ["no target", []],
    ["my character", ["mine"]],
    ["their item", ["fit"]],
    ["their card in hand", ["h1"]],
    ["two characters", ["foe1", "foe2"]]
  ];
  for (const [why, c] of cases) {
    const b = zmeBoard();
    refused(() => zmePlay(b, c), why, ANY);
    assert.equal(zoneOf(b.engine, b.id("zme")), "hand", why);
    assert.equal(ready(b.engine, P1), 3, `${why}: nothing paid`);
  }
  const f = zmeBoard();
  refused(() => play(f.engine, P1, f.id("zme"), { selected: { c: [f.engine.state.players[P2].factionId!] } }), "their faction", ANY);
  assert.equal(zoneOf(f.engine, f.id("zme")), "hand");
  const ok = zmeBoard();
  zmePlay(ok, ["foe2"]);
  assert.equal(zoneOf(ok.engine, ok.id("zme")), "discard", "control");
});

clause(ZME, "0:extraCost", "a character I own but an opponent controls is a legal choice", () => {
  const b = zmeBoard({ extra: [{ key: "stolen", def: noTextChar("Stolen"), owner: P1, zone: "play", controller: P2 }] });
  zmePlay(b, ["stolen"]);
  assert.equal(zoneOf(b.engine, b.id("zme")), "discard");
});

clause(ZME, "1:rule", "main phase: the chosen character goes to its owner's hand; no discard without an attacking party; other characters stay", () => {
  const b = zmeBoard();
  const hand = handOf(b.engine, P2);
  zmePlay(b, ["foe1"]);
  assert.equal(b.engine.state.pendingChoice, undefined, "no discard prompt");
  assert.equal(zoneOf(b.engine, b.id("foe1")), "hand");
  assert.equal(zoneOf(b.engine, b.id("foe2")), "play");
  assert.deepEqual(handOf(b.engine, P2).sort(), [...hand, b.id("foe1")].sort(), "nothing was discarded");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
});

clause(ZME, "1:rule", "a character I own but an opponent controls goes to ITS OWNER's hand (mine)", () => {
  const b = zmeBoard({ extra: [{ key: "stolen", def: noTextChar("Stolen"), owner: P1, zone: "play", controller: P2 }] });
  const theirs = handOf(b.engine, P2);
  zmePlay(b, ["stolen"]);
  assert.equal(zoneOf(b.engine, b.id("stolen")), "hand");
  assert.equal(handOf(b.engine, P1).includes(b.id("stolen")), true);
  assert.deepEqual(handOf(b.engine, P2), theirs);
});

clause(ZME, "1:rule", "attacking with a party of 2: that player (the opponent) chooses and discards a card, their own choice", () => {
  const b = zmeBoard();
  zmeInBattle(b, ["a1", "a2"], "foe1");
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "that player chooses");
  refused(() => resolveChoice(b.engine, pick([b.id("h1"), b.id("h2")])), "only one card", ANY);
  resolveChoice(b.engine, pick([b.id("h2")]));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foe1")), "hand");
  assert.equal(zoneOf(b.engine, b.id("h2")), "discard");
  assert.equal(zoneOf(b.engine, b.id("h1")), "hand");
  assert.equal(handOf(b.engine, P1).includes(b.id("ph")), true, "my hand untouched");
});

clause(ZME, "1:rule", "a party of 3 also counts (at least 2)", () => {
  const b = zmeBoard();
  zmeInBattle(b, ["a1", "a2", "a3"], "foe1");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(b.engine)?.playerId, P2);
});

clause(ZME, "1:rule", "an attacking party of only 1 member: no discard", () => {
  const b = zmeBoard();
  zmeInBattle(b, ["a1"], "foe1");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("foe1")), "hand");
  assert.equal(zoneOf(b.engine, b.id("h1")), "hand");
  assert.equal(zoneOf(b.engine, b.id("h2")), "hand");
});

clause(ZME, "1:rule", "the discarded card must come from that player's own hand: a card from MY hand is refused", () => {
  const b = zmeBoard();
  zmeInBattle(b, ["a1", "a2"], "foe1");
  assert.equal(pending(b.engine)?.playerId, P2);
  refused(() => resolveChoice(b.engine, pick([b.id("ph")])), "my hand card", ANY);
});

clause(ZME, "1:rule", "the discard is mandatory: the opponent cannot decline it", () => {
  const b = zmeBoard();
  zmeInBattle(b, ["a1", "a2"], "foe1");
  refused(() => resolveChoice(b.engine, pick([])), "must discard a card", ANY);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
});

clause(ZME, "1:rule", "the returned character is in the hand it must discard from: with no other card in hand it has to discard that character", () => {
  const b = zmeBoard();
  for (const k of ["h1", "h2"]) {
    b.engine.state.players[P2].hand = b.engine.state.players[P2].hand.filter(c => c !== b.id(k));
    b.engine.state.cards[b.id(k)].zone = "discard";
    b.engine.state.players[P2].discard.push(b.id(k));
  }
  zmeInBattle(b, ["a1", "a2"], "foe1");
  const pc = pending(b.engine);
  if (pc) resolveChoice(b.engine, pick([b.id("foe1")]));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foe1")), "discard", "it went to hand and was discarded");
});

clause(ZME, "1:rule", "'that player' is the character's owner: for a character I own but an opponent controls, I (the owner) discard from my hand, not the opponent", () => {
  const b = zmeBoard({ extra: [{ key: "stolen", def: noTextChar("Stolen"), owner: P1, zone: "play", controller: P2 }] });
  zmeInBattle(b, ["a1", "a2"], "stolen");
  const pc = pending(b.engine);
  assert.equal(pc?.playerId, P1, "the owner discards");
  resolveChoice(b.engine, pick([b.id("ph")]));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("ph")), "discard");
  assert.equal(zoneOf(b.engine, b.id("h1")), "hand");
});

clause(ZME, "1:rule", "an attacking party I do NOT control does not count: the opponent attacks with 2 and I bounce one of their attackers, no discard", () => {
  const b = zmeBoard({
    active: P2,
    turn: 2,
    extra: [
      { key: "x1", def: noTextChar("X1", { strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
      { key: "x2", def: noTextChar("X2", { strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackOpenWindow(b.engine, P2, [b.id("x1"), b.id("x2")], { type: "faction", playerId: P1 });
  play(b.engine, P1, b.id("zme"), { selected: { c: [b.id("x1")] } });
  assert.equal(b.engine.state.pendingChoice, undefined, "I control no attacking party, so no discard");
  assert.equal(zoneOf(b.engine, b.id("x1")), "hand");
  assert.deepEqual(handOf(b.engine, P2).sort(), [b.id("h1"), b.id("h2"), b.id("x1")].sort());
});

clause(ZME, "2:flipUp", "FLIP UP costs 4 (not the printed 2); the face-down card may pay for itself (self + 3 others); the chosen character returns to hand", () => {
  const b = zmeBoard({ flip: true, obs: 3 });
  assert.equal(ready(b.engine, P1), 4);
  zmeFlip(b, ["foe1"]);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foe1")), "hand");
  assert.equal(zoneOf(b.engine, b.id("zme")), "discard");
  assert.equal(ready(b.engine, P1), 0, "all four paid");
  const many = zmeBoard({ flip: true, obs: 6 });
  zmeFlip(many, ["foe1"]);
  resolvePendingResponses(many.engine);
  assert.ok([2, 3].includes(ready(many.engine, P1)), "7 ready, exactly 4 paid (card itself or banks), flipped card gone");
});

clause(ZME, "2:flipUp", "FLIP UP is refused one resource short (self + 2 = 3 ready), needs an [O] after flipping, and still needs the character choice", () => {
  const s = zmeBoard({ flip: true, obs: 2 });
  assert.equal(ready(s.engine, P1), 3);
  refused(() => zmeFlip(s, ["foe1"]), "3 ready for cost 4", ANY);
  assert.equal(s.engine.state.cards[s.id("zme")].faceDown, true);
  assert.equal(ready(s.engine, P1), 3);
  const g = zmeBoard({ flip: true, obs: 0, extra: bank("greed", 4, P1) });
  assert.equal(ready(g.engine, P1), 5);
  refused(() => zmeFlip(g, ["foe1"]), "no [O] icon", ANY);
  assert.equal(g.engine.state.cards[g.id("zme")].faceDown, true);
  const one = zmeBoard({ flip: true, obs: 1, extra: bank("greed", 3, P1) });
  assert.equal(ready(one.engine, P1), 5);
  zmeFlip(one, ["foe1"]);
  assert.equal(zoneOf(one.engine, one.id("zme")), "discard", "control: a single [O] among greed resources meets [O]");
  const n = zmeBoard({ flip: true, obs: 4 });
  refused(() => zmeFlip(n, []), "no character chosen", ANY);
  refused(() => zmeFlip(n, ["mine"]), "my own character", ANY);
  assert.equal(n.engine.state.cards[n.id("zme")].faceDown, true);
  zmeFlip(n, ["foe1"]);
  assert.equal(zoneOf(n.engine, n.id("zme")), "discard", "control");
});

// ============================================================================
// Zenobia's Tower
// UNIQUE WATCHTOWER. -- At the start of your turn, you may look at the top 2 cards of your deck. If you do, put 1 into your
// hand and 1 on the bottom of your deck. -- When this card is destroyed, you may search your deck for a card named
// "Zenobia's Tower", reveal it, and put it into your hand.
// Location, arcanist, cost 4, [O][O], structure 3.
// ============================================================================
const ZT = "9c0e2ffb-b580-402f-98a3-3fb892384326";

function ztBoard(o: { obs?: number; zt?: "play" | "hand"; active?: typeof P1 | typeof P2; extra?: Cards; copy?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: o.active,
    cards: [
      { key: "zt", def: printing(ZT), owner: P1, zone: o.zt ?? "play" },
      ...bank("obsession", o.obs ?? 4, P1),
      ...(o.copy === false ? [] : [{ key: "zt2", def: printing(ZT), owner: P1, zone: "deck" as const }]),
      { key: "d1", def: noTextChar("D1"), owner: P1, zone: "deck" },
      { key: "d2", def: noTextChar("D2"), owner: P1, zone: "deck" },
      { key: "d3", def: noTextChar("D3"), owner: P1, zone: "deck" },
      { key: "d4", def: noTextChar("D4"), owner: P1, zone: "deck" },
      { key: "ozt", def: printing(ZT), owner: P2, zone: "deck" },
      { key: "od1", def: noTextChar("OD1"), owner: P2, zone: "deck" },
      { key: "od2", def: noTextChar("OD2"), owner: P2, zone: "deck" },
      ...(o.extra ?? [])
    ]
  });
}
type ZtB = ReturnType<typeof ztBoard>;
/** A free tactic that destroys a location. */
const LOC_KILL = () => tactic({
  name: "Loc Kill", cost: 0,
  behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
});
const LOC_BOUNCE = () => tactic({
  name: "Loc Bounce", cost: 0,
  behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
});
const killZt = (b: ZtB, who = "zt") => play(b.engine, P1, b.id("kill"), { selected: { t: [b.id(who)] } });
const killExtra = (): Cards => [{ key: "kill", def: LOC_KILL(), owner: P1, zone: "hand" }];

clause(ZT, "0:unique", "printed card: Arcanist location, cost 4, [O][O], structure 3; deploys for exactly 4; 3 resources and a [O]-less 4 are refused", () => {
  const p = printing(ZT);
  assert.deepEqual([p.type, p.trade, p.cost, p.threshold, p.structure, p.unique], ["location", "arcanist", 4, "oo", 3, "watchtower"]);
  const b = ztBoard({ zt: "hand", obs: 4 });
  play(b.engine, P1, b.id("zt"));
  assert.equal(zoneOf(b.engine, b.id("zt")), "play");
  assert.equal(ready(b.engine, P1), 0, "exactly 4 paid");
  assert.equal(b.engine.getStat(b.id("zt"), "structure"), 3);
  const s = ztBoard({ zt: "hand", obs: 3 });
  refused(() => play(s.engine, P1, s.id("zt")), "3 resources", ANY);
  assert.equal(zoneOf(s.engine, s.id("zt")), "hand");
  const one = ztBoard({ zt: "hand", obs: 1, extra: bank("rage", 3, P1) });
  assert.equal(ready(one.engine, P1), 4);
  refused(() => play(one.engine, P1, one.id("zt")), "one [O] for [O][O]", ANY);
  assert.equal(zoneOf(one.engine, one.id("zt")), "hand");
});

clause(ZT, "0:unique", "WATCHTOWER is a UNIQUE designation: a second Tower makes me keep one (keep the new one: the old one is destroyed)", () => {
  const b = ztBoard({ extra: [{ key: "zt3", def: printing(ZT), owner: P1, zone: "hand" }], copy: false });
  play(b.engine, P1, b.id("zt3"));
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [b.id("zt"), b.id("zt3")].sort());
  resolveChoice(b.engine, { kind: "uniqueSurvivor", keep: b.id("zt3") });
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("zt3")), "play");
  assert.equal(zoneOf(b.engine, b.id("zt")), "discard");
});

clause(ZT, "0:unique", "keeping the old Tower destroys the new one", () => {
  const b = ztBoard({ extra: [{ key: "zt3", def: printing(ZT), owner: P1, zone: "hand" }], copy: false });
  play(b.engine, P1, b.id("zt3"));
  resolveChoice(b.engine, { kind: "uniqueSurvivor", keep: b.id("zt") });
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("zt")), "play");
  assert.equal(zoneOf(b.engine, b.id("zt3")), "discard");
});

clause(ZT, "0:unique", "the designation, not the name, is what counts: another card with UNIQUE WATCHTOWER is a duplicate; one with a different designation is not", () => {
  const dup = ztBoard({
    extra: [{ key: "w", def: location({ name: "Other Watch", unique: "watchtower" } as Partial<Def>), owner: P1, zone: "hand" }],
    copy: false
  });
  play(dup.engine, P1, dup.id("w"));
  assert.equal(pending(dup.engine)?.kind, "uniqueSurvivor");
  const other = ztBoard({ extra: [{ key: "w", def: location({ name: "Other Loc", unique: "something else" } as Partial<Def>), owner: P1, zone: "play" }] });
  assert.equal(other.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(other.engine, other.id("zt")), "play");
  assert.equal(zoneOf(other.engine, other.id("w")), "play");
});

clause(ZT, "0:unique", "the restriction is per player: the opponent may control their own Tower with no choice", () => {
  const b = ztBoard({ extra: [{ key: "ozt2", def: printing(ZT), owner: P2, zone: "play" }] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("zt")), "play");
  assert.equal(zoneOf(b.engine, b.id("ozt2")), "play");
});

// --- At the start of your turn ------------------------------------------------

const toMyTurn = (b: ZtB) => endTurn(b.engine, P2);
// "you may look": the first prompt is the may (option 0 = do not look, option 1 = look).
const acceptLook = (b: ZtB) => {
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption", "the 'you may look' is offered first");
  resolveChoice(b.engine, { kind: "chooserSelectsOption", index: 1 });
  resolvePendingResponses(b.engine);
};

clause(ZT, "1:rule", "at the start of my turn I look at the top 2 cards of my deck (and only those)", () => {
  const b = ztBoard({ active: P2, copy: false });
  const deck = deckOf(b.engine, P1);
  toMyTurn(b);
  acceptLook(b);
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; cardIds: string[]; to?: string };
  assert.equal(pc?.kind, "reorderDeck");
  assert.equal(pc.playerId, P1);
  assert.deepEqual(pc.cardIds, deck.slice(0, 2));
});

clause(ZT, "1:rule", "it does not trigger at the start of the OPPONENT's turn", () => {
  const b = ztBoard({ copy: false });
  assert.equal(b.engine.state.activePlayerId, P1);
  endTurn(b.engine, P1);
  assert.notEqual(pending(b.engine)?.kind, "reorderDeck");
  assert.deepEqual(handOf(b.engine, P1), []);
});

clause(ZT, "1:rule", "it only works while in play: a Tower in my hand does nothing at the start of my turn", () => {
  const b = ztBoard({ active: P2, zt: "hand", copy: false });
  toMyTurn(b);
  assert.notEqual(pending(b.engine)?.kind, "reorderDeck");
});

clause(ZT, "1:rule", "Zenobia's Tower: 'you may look' - the look is optional and can be skipped", () => {
  const b = ztBoard({ active: P2, copy: false });
  const deck = deckOf(b.engine, P1);
  toMyTurn(b);
  // Whatever prompt appears first must let me decline; declining leaves the deck and hand untouched.
  const pc = pending(b.engine);
  assert.ok(pc, "something is offered");
  assert.notEqual(pc!.kind, "reorderDeck", "the first prompt must be a may-yes/no, not an already-forced look");
  drain(b.engine, declineAll);
  assert.deepEqual(deckOf(b.engine, P1).slice(0, deck.length), deck);
});

clause(ZT, "1:rule", "Zenobia's Tower: of the 2 looked-at cards 1 goes into my hand and 1 to the bottom of my deck", () => {
  const b = ztBoard({ active: P2, copy: false });
  const deck = deckOf(b.engine, P1);
  const handBefore = handOf(b.engine, P1);
  toMyTurn(b);
  acceptLook(b);
  const pc = pending(b.engine) as unknown as { cardIds: string[] };
  const [x, y] = pc.cardIds;
  // Take x into the hand, send y to the bottom.
  resolveChoice(b.engine, { kind: "reorderDeck", order: [y], hand: [x] });
  resolvePendingResponses(b.engine);
  drain(b.engine, declineAll);
  assert.deepEqual(handOf(b.engine, P1).filter(h => !handBefore.includes(h)).includes(x), true, "x is in my hand");
  const d = deckOf(b.engine, P1);
  assert.equal(d[d.length - 1], y, "y is at the very bottom");
  assert.equal(d.includes(x), false);
  assert.equal(d.length, deck.length - 1);
});

// --- When this card is destroyed ----------------------------------------------

clause(ZT, "2:rule", "when destroyed I may search my deck for a card named Zenobia's Tower, reveal it and put it into my hand; the rest of the deck stays", () => {
  const b = ztBoard({ extra: killExtra() });
  const deck = deckOf(b.engine, P1);
  killZt(b);
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  assert.equal(zoneOf(b.engine, b.id("zt")), "discard");
  resolveChoice(b.engine, pick([b.id("zt2")]));
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("zt2")), "hand");
  assert.equal(handOf(b.engine, P1).includes(b.id("zt2")), true);
  assert.deepEqual(deckOf(b.engine, P1).sort(), deck.filter(c => c !== b.id("zt2")).sort(), "only the Tower left the deck");
  const rev = reveals(b.engine);
  assert.equal(rev.length, 1, "it is revealed");
  assert.deepEqual((rev[0].event as unknown as { cardIds: string[] }).cardIds, [b.id("zt2")]);
});

clause(ZT, "2:rule", "it is a 'may': I can decline and the copy stays in the deck", () => {
  const b = ztBoard({ extra: killExtra() });
  killZt(b);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  resolveChoice(b.engine, pick([]));
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("zt2")), "deck");
  assert.deepEqual(handOf(b.engine, P1), []);
});

clause(ZT, "2:rule", "only a card NAMED Zenobia's Tower in MY deck can be found: another card of my deck, the opponent's Tower and one Tower copy too many are refused", () => {
  const b = ztBoard({ extra: [...killExtra(), { key: "zt4", def: printing(ZT), owner: P1, zone: "deck" }] });
  killZt(b);
  refused(() => resolveChoice(b.engine, pick([b.id("d1")])), "a card with another name", ANY);
  refused(() => resolveChoice(b.engine, pick([b.id("ozt")])), "the opponent's deck", ANY);
  refused(() => resolveChoice(b.engine, pick([b.id("zt2"), b.id("zt4")])), "only one card", ANY);
  resolveChoice(b.engine, pick([b.id("zt4")]));
  assert.equal(zoneOf(b.engine, b.id("zt4")), "hand", "control");
  assert.equal(zoneOf(b.engine, b.id("zt2")), "deck");
  assert.equal(zoneOf(b.engine, b.id("ozt")), "deck");
});

clause(ZT, "2:rule", "only from the deck: a Tower in my discard pile or hand cannot be found; with none in the deck nothing is fetched and nothing locks up", () => {
  const b = ztBoard({ copy: false, extra: [...killExtra(), { key: "zt5", def: printing(ZT), owner: P1, zone: "discard" }, { key: "zt6", def: printing(ZT), owner: P1, zone: "hand" }] });
  killZt(b);
  if (pending(b.engine)) {
    refused(() => resolveChoice(b.engine, pick([b.id("zt5")])), "discard pile", ANY);
    refused(() => resolveChoice(b.engine, pick([b.id("zt6")])), "hand", ANY);
    drain(b.engine, declineAll);
  }
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("zt5")), "discard");
  assert.equal(zoneOf(b.engine, b.id("zt6")), "hand");
});

clause(ZT, "2:rule", "destroyed in battle by damage (structure 3) it triggers too", () => {
  const b = ztBoard({
    active: P2,
    extra: [{ key: "atk", def: noTextChar("Atk", { strength: 3, life: 5, speed: 3 }), owner: P2, zone: "play" }]
  });
  declareAttackBy(b.engine, P2, [b.id("atk")], { type: "card", cardId: b.id("zt") });
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
  autoResolveBattle(b.engine);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("zt")), "discard");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(b.engine)?.playerId, P1);
});

clause(ZT, "2:rule", "leaving play without being destroyed (returned to hand) does not trigger it", () => {
  const b = ztBoard({ extra: [{ key: "bounce", def: LOC_BOUNCE(), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("zt")] } });
  assert.equal(zoneOf(b.engine, b.id("zt")), "hand");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("zt2")), "deck");
});

clause(ZT, "2:rule", "another location being destroyed does not trigger it", () => {
  const b = ztBoard({ extra: [...killExtra(), { key: "other", def: location({ name: "Other" }), owner: P1, zone: "play" }] });
  killZt(b, "other");
  assert.equal(zoneOf(b.engine, b.id("other")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("zt")), "play");
});

clause(ZT, "2:rule", "when it dies as the loser of the unique rule it still triggers once: choosing the new Tower fetches the deck copy on request", () => {
  const b = ztBoard({ extra: [{ key: "zt3", def: printing(ZT), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("zt3"));
  resolveChoice(b.engine, { kind: "uniqueSurvivor", keep: b.id("zt3") });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("zt")), "discard");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "destroyed: may search");
  resolveChoice(b.engine, pick([b.id("zt2")]));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("zt2")), "hand");
});

// Keep unused-import lint quiet for helpers kept for future edits.
void answerPending;
