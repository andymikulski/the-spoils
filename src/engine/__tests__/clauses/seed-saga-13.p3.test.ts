import assert from "node:assert/strict";
import { buildGame, activate, autoResolveBattle, bank, character, developFaction, item, location, P1, P2, play, tactic } from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import { declareAttackBy, declareAttackOpenWindow, finishBattle, fightThrough, playRaw } from "./_battle.js";
import { pending } from "./_board.js";
import { spentResources } from "./_turn.js";

type Cards = NonNullable<Parameters<typeof buildGame>[0]>["cards"];
type Engine = ReturnType<typeof buildGame>["engine"];
type PC = { kind: string; [k: string]: unknown };
const ready = (e: Engine, p: string = P1) => e.getAvailableResourceCount(p as never);
const zone = (e: Engine, cardId: string) => e.state.cards[cardId].zone;
const dmg = (e: Engine, cardId: string) => e.state.cards[cardId].damage ?? 0;
const ctl = (e: Engine, cardId: string) => e.state.cards[cardId].controllerId;
const handLen = (e: Engine, p: string = P1) => e.state.players[p as typeof P1].hand.length;
const payAns = (pay: boolean) => (pc: PC): unknown => (pc.kind === "mayPay" ? { kind: "mayPay", pay } : declineAll(pc as never));
const resolve = (e: Engine, choice: unknown, p: string = P1) => e.perform({ type: "resolvePendingChoice", playerId: p, choice } as never);
const hasEvent = (e: Engine, type: string, cardId: string) =>
  e.getLog().some((l) => l.event?.type === type && (l.event as unknown as { cardId?: string }).cardId === cardId);

/** A free tactic that destroys any one card in play (id `k`, decl `t`). */
const killAny = () =>
  tactic({
    name: "KillAny",
    cost: 0,
    behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  } as never);
/** A free tactic that deals 5 damage to one character. */
const zap = () =>
  tactic({
    name: "Zap",
    cost: 0,
    behavior: { abilities: [{ id: "z", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 5 }] }] }
  } as never);
const kill = (e: Engine, id: (k: string) => string, killKey: string, targetKey: string, answer: (pc: PC) => unknown = payAns(false)) => {
  play(e, P1, id(killKey), { selected: { t: [id(targetKey)] } });
  drain(e, answer as never);
};

// ============================================================================
// Storm the Gates -- tactic, warlord, cost 1, [R][R]
// EXTRA COST: Destroy a character you own. Pick a character your opponent owns. -- Inflict 5 damage to the character. If the character was destroyed by that damage, draw a card. -- FLIP UP: 1 [R]
// ============================================================================
const STORM = "6e733b56-222d-4d95-9be4-9c0a2056b1fa";
const SOLDIER = "cbc0a4fc-877d-46a2-95b4-13541b77a623";
function stormBoard(o: { rage?: number; greed?: number; spent?: number; markLife?: number; faceDown?: boolean; noSac?: boolean; markDef?: ReturnType<typeof character> } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: () => 0.5,
    cards: [
      o.faceDown
        ? { key: "t", def: printing(STORM), owner: P1, zone: "play", faceDown: true }
        : { key: "t", def: printing(STORM), owner: P1, zone: "hand" },
      ...(o.noSac ? [] : [
        { key: "sac", def: character({ name: "Sac", life: 2 }), owner: P1, zone: "play" },
        { key: "sac2", def: character({ name: "Sac2", life: 2 }), owner: P1, zone: "play" }
      ]),
      { key: "mark", def: o.markDef ?? character({ name: "Mark", life: o.markLife ?? 3 }), owner: P2, zone: "play" },
      { key: "mark2", def: character({ name: "Mark2", life: 9 }), owner: P2, zone: "play" },
      { key: "oit", def: item({ name: "OIt" }), owner: P2, zone: "play" },
      { key: "mit", def: item({ name: "MIt" }), owner: P1, zone: "play" },
      { key: "hc", def: character({ name: "HC" }), owner: P1, zone: "hand" },
      { key: "ohc", def: character({ name: "OHC" }), owner: P2, zone: "hand" },
      { key: "d0", def: character({ name: "D0" }), owner: P1, zone: "deck" },
      { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
      { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" },
      ...bank("rage", o.rage ?? 2, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...spentResources(P1, o.spent ?? 0)
    ] as Cards
  });
}
type SB = ReturnType<typeof stormBoard>;
const stormSel = (b: SB, sac = "sac", mark = "mark") => ({ sac: [b.id(sac)], mark: [b.id(mark)] });
const stormCast = (b: SB, sac = "sac", mark = "mark") => {
  play(b.engine, P1, b.id("t"), { selected: stormSel(b, sac, mark) });
  drain(b.engine, declineAll);
};
const stormFlip = (b: SB, sac = "sac", mark = "mark") => {
  flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("t"), selected: stormSel(b, sac, mark), variables: {} });
  drain(b.engine, declineAll);
};
const drawn = (b: SB) => ["d0", "d1", "d2"].filter((k) => zone(b.engine, b.id(k)) === "hand").length;

clause(STORM, "0:extraCost", "printed card: tactic, warlord, cost 1, threshold rr, no stats", () => {
  const p = printing(STORM);
  assert.equal(p.type, "tactic");
  assert.equal(p.trade, "warlord");
  assert.equal(p.cost, 1);
  assert.equal(p.threshold, "rr");
});
clause(STORM, "0:extraCost", "the printed cost 1 is paid exactly (2 rage leaves 1 ready); the tactic is used up", () => {
  const b = stormBoard({ rage: 2 });
  assert.equal(ready(b.engine), 2);
  stormCast(b);
  assert.equal(ready(b.engine), 1, "cost 1 paid, not 0 and not 2");
  assert.equal(zone(b.engine, b.id("t")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
});
clause(STORM, "0:extraCost", "one resource short of cost 1 is refused (rr met by spent icons); the same board with one ready rage works", () => {
  const short = stormBoard({ spent: 2, rage: 0 });
  refused(() => play(short.engine, P1, short.id("t"), { selected: stormSel(short) }), "no ready resource for cost 1");
  assert.equal(zone(short.engine, short.id("sac")), "play", "nothing destroyed on a refusal");
  assert.equal(dmg(short.engine, short.id("mark")), 0);
  const ok = stormBoard({ spent: 2, rage: 1 });
  stormCast(ok);
  assert.equal(zone(ok.engine, ok.id("mark")), "discard");
  assert.equal(ready(ok.engine), 0);
});
clause(STORM, "0:extraCost", "threshold rr: one rage icon short is refused even with plenty of resources; two rage icons work", () => {
  const one = stormBoard({ rage: 1, greed: 3 });
  refused(() => play(one.engine, P1, one.id("t"), { selected: stormSel(one) }), "only one rage icon");
  const none = stormBoard({ rage: 0, greed: 4 });
  refused(() => play(none.engine, P1, none.id("t"), { selected: stormSel(none) }), "no rage icon");
  assert.equal(zone(none.engine, none.id("sac")), "play");
  const ok = stormBoard({ rage: 2, greed: 2 });
  stormCast(ok);
  assert.equal(zone(ok.engine, ok.id("mark")), "discard");
  const mixed = stormBoard({ rage: 1, greed: 1, spent: 1 });
  stormCast(mixed);
  assert.equal(zone(mixed.engine, mixed.id("mark")), "discard", "a spent rage icon counts toward the threshold");
});
clause(STORM, "0:extraCost", "EXTRA COST destroys the chosen character you own as a cost (it is gone before the tactic resolves), and only that one", () => {
  const b = stormBoard({ markLife: 9 });
  playRaw(b.engine, P1, b.id("t"), { selected: stormSel(b, "sac2") });
  assert.equal(zone(b.engine, b.id("sac2")), "discard", "the sacrifice is already paid");
  assert.equal(zone(b.engine, b.id("sac")), "play", "the other own character is untouched");
  assert.equal(zone(b.engine, b.id("mit")), "play");
  drain(b.engine, declineAll);
  assert.equal(zone(b.engine, b.id("sac")), "play");
});
clause(STORM, "0:extraCost", "the sacrifice must be a character you own in play: the opponent's character, your item, a hand character and nothing are refused", () => {
  const control = stormBoard();
  stormCast(control);
  assert.equal(zone(control.engine, control.id("sac")), "discard");
  for (const bad of ["mark2", "mit", "oit", "hc"]) {
    const b = stormBoard();
    refused(() => play(b.engine, P1, b.id("t"), { selected: { sac: [b.id(bad)], mark: [b.id("mark")] } }), `${bad} is not an own character in play`);
    assert.equal(zone(b.engine, b.id("t")), "hand");
    assert.equal(zone(b.engine, b.id(bad)), bad === "hc" ? "hand" : "play", "nothing destroyed");
    assert.equal(ready(b.engine), 2, "nothing paid");
  }
  const none = stormBoard();
  refused(() => play(none.engine, P1, none.id("t"), { selected: { mark: [none.id("mark")] } }), "no sacrifice chosen");
  const two = stormBoard();
  refused(() => play(two.engine, P1, two.id("t"), { selected: { sac: [two.id("sac"), two.id("sac2")], mark: [two.id("mark")] } }), "exactly one sacrifice");
  assert.equal(zone(two.engine, two.id("sac")), "play");
  const alone = stormBoard({ noSac: true });
  refused(() => play(alone.engine, P1, alone.id("t"), { selected: { mark: [alone.id("mark")] } }), "no character of yours to destroy");
});
clause(STORM, "0:extraCost", "the target must be a character the opponent owns in play: your own character, an item, a hand character and nothing are refused", () => {
  for (const bad of ["sac2", "oit", "mit", "ohc", "hc"]) {
    const b = stormBoard();
    refused(() => play(b.engine, P1, b.id("t"), { selected: { sac: [b.id("sac")], mark: [b.id(bad)] } }), `${bad} is not an opponent character in play`);
    assert.equal(zone(b.engine, b.id("sac")), "play", "the sacrifice is not paid when the target is illegal");
    assert.equal(dmg(b.engine, b.id(bad)), 0);
  }
  const none = stormBoard();
  refused(() => play(none.engine, P1, none.id("t"), { selected: { sac: [none.id("sac")] } }), "no target picked");
  const two = stormBoard();
  refused(() => play(two.engine, P1, two.id("t"), { selected: { sac: [two.id("sac")], mark: [two.id("mark"), two.id("mark2")] } }), "exactly one target");
  assert.equal(zone(two.engine, two.id("sac")), "play");
  const ok = stormBoard();
  stormCast(ok, "sac", "mark2");
  assert.equal(dmg(ok.engine, ok.id("mark2")), 5, "either opposing character can be picked");
});

clause(STORM, "1:rule", "inflicts 5 damage to the picked character (life 9 survives with exactly 5 damage) and draws nothing when it survives", () => {
  const b = stormBoard({ markLife: 9 });
  const before = handLen(b.engine);
  stormCast(b);
  assert.equal(zone(b.engine, b.id("mark")), "play");
  assert.equal(dmg(b.engine, b.id("mark")), 5);
  assert.equal(dmg(b.engine, b.id("mark2")), 0, "the other opposing character is untouched");
  assert.equal(handLen(b.engine), before - 1, "only the tactic left the hand: no draw");
  assert.equal(drawn(b), 0);
});
clause(STORM, "1:rule", "5 damage destroys a life-5 character (damage reaches its life) and a life-3 one: you draw exactly one card", () => {
  for (const life of [3, 5]) {
    const b = stormBoard({ markLife: life });
    const before = handLen(b.engine);
    stormCast(b);
    assert.equal(zone(b.engine, b.id("mark")), "discard", `life ${life} destroyed`);
    assert.equal(handLen(b.engine), before - 1 + 1, "tactic out, one card drawn");
    assert.equal(drawn(b), 1);
    assert.equal(b.engine.state.players[P1].deck.length, 2);
    assert.equal(dmg(b.engine, b.id("mark2")), 0);
  }
});
clause(STORM, "1:rule", "a life-6 character survives 5 damage: no draw; the same board with life 5 draws", () => {
  const six = stormBoard({ markLife: 6 });
  stormCast(six);
  assert.equal(zone(six.engine, six.id("mark")), "play");
  assert.equal(drawn(six), 0);
  const five = stormBoard({ markLife: 5 });
  stormCast(five);
  assert.equal(drawn(five), 1);
});
clause(STORM, "1:rule", "the draw is only for the opponent's character destroyed by that damage: preset damage that makes the 5 lethal still draws, the sacrifice never draws on its own", () => {
  const b = stormBoard({ markLife: 9 });
  b.engine.state.cards[b.id("mark")].damage = 4;
  stormCast(b);
  assert.equal(zone(b.engine, b.id("mark")), "discard", "4 + 5 >= 9");
  assert.equal(drawn(b), 1);
  const noKill = stormBoard({ markLife: 9 });
  stormCast(noKill);
  assert.equal(drawn(noKill), 0, "the destroyed sacrifice does not draw a card");
});
clause(STORM, "1:rule", "a target that is replaced instead of destroyed (Surplus Soldier) is not destroyed by the damage, so no card is drawn", () => {
  const b = stormBoard({ markDef: printing(SOLDIER) as never });
  stormCast(b);
  assert.equal(zone(b.engine, b.id("mark")), "play", "the replacement flipped it face-down instead");
  assert.equal(b.engine.state.cards[b.id("mark")].faceDown, true);
  assert.equal(drawn(b), 0, "it was not destroyed, so no draw");
});

clause(STORM, "2:flipUp", "FLIP UP 1 [R] from a face-down resource: one rage icon is enough (not rr); the effect resolves; net cost is 1 (not 1 + the card's cost 1)", () => {
  const b = stormBoard({ faceDown: true, rage: 3, markLife: 3 });
  assert.equal(ready(b.engine), 4, "3 banks + the face-down card");
  stormFlip(b);
  assert.equal(zone(b.engine, b.id("sac")), "discard", "EXTRA COST still paid");
  assert.equal(zone(b.engine, b.id("mark")), "discard", "5 damage destroyed it");
  assert.equal(drawn(b), 1, "the draw rider runs");
  const left = ready(b.engine);
  assert.ok(left === 2 || left === 3, `the flip costs 1 (the card may pay for itself and leaves the pool either way), not 1 + the card's cost -> ${left}`);
  assert.equal(zone(b.engine, b.id("t")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
});
clause(STORM, "2:flipUp", "FLIP UP threshold is [R] only: a single rage bank works where the normal deploy needs rr; zero rage icons is refused", () => {
  const one = stormBoard({ faceDown: true, rage: 1, greed: 2 });
  stormFlip(one);
  assert.equal(zone(one.engine, one.id("mark")), "discard");
  const none = stormBoard({ faceDown: true, rage: 0, greed: 3 });
  refused(() => stormFlip(none), "no rage icon for FLIP UP");
  assert.equal(zone(none.engine, none.id("mark")), "play");
  assert.equal(zone(none.engine, none.id("sac")), "play");
  assert.equal(none.engine.state.cards[none.id("t")].faceDown, true);
});
clause(STORM, "2:flipUp", "FLIP UP cost 1: the card may pay for itself (spent rage satisfies the threshold, which its own icon never does)", () => {
  const selfPay = stormBoard({ faceDown: true, rage: 0, spent: 1 });
  assert.equal(ready(selfPay.engine), 1, "only the face-down card is ready");
  stormFlip(selfPay);
  assert.equal(zone(selfPay.engine, selfPay.id("mark")), "discard", "it paid its own FLIP UP cost");
  const noIcon = stormBoard({ faceDown: true, rage: 0, spent: 0 });
  refused(() => stormFlip(noIcon), "its own icon does not count for the threshold");
  assert.equal(noIcon.engine.state.cards[noIcon.id("t")].faceDown, true);
});
clause(STORM, "2:flipUp", "FLIP UP still needs the EXTRA COST picks (sacrifice and target): refused without them or with illegal ones", () => {
  const b = stormBoard({ faceDown: true, rage: 3 });
  const fu = (selected: Record<string, string[]>) => () => flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("t"), selected, variables: {} });
  refused(fu({ mark: [b.id("mark")] }), "no sacrifice");
  refused(fu({ sac: [b.id("sac")] }), "no target");
  refused(fu({ sac: [b.id("sac")], mark: [b.id("sac2")] }), "target must be an opponent's character");
  refused(fu({ sac: [b.id("mark2")], mark: [b.id("mark")] }), "sacrifice must be your own");
  assert.equal(b.engine.state.cards[b.id("t")].faceDown, true);
  assert.equal(zone(b.engine, b.id("sac")), "play");
  fu({ sac: [b.id("sac")], mark: [b.id("mark")] })();
  assert.equal(zone(b.engine, b.id("sac")), "discard", "positive control: legal picks work");
});
clause(STORM, "2:flipUp", "FLIP UP only works on a face-down card in play: a face-up hand card and a face-up card in play are refused", () => {
  const hand = stormBoard({ rage: 3 });
  refused(() => flipUpNow(hand.engine, { type: "flipUp", playerId: P1, cardId: hand.id("t"), selected: stormSel(hand), variables: {} }), "the card is in hand, not a face-down resource");
  assert.equal(zone(hand.engine, hand.id("mark")), "play");
  const down = stormBoard({ faceDown: true, rage: 3 });
  stormFlip(down);
  assert.equal(zone(down.engine, down.id("mark")), "discard", "positive control: the face-down copy flips up");
});

// ============================================================================
// Surplus Soldier -- character, warlord, soldier, cost 1, [R][R], 1/3/1
// If this card would be destroyed, flip it face-down under its owner's control instead.
// ============================================================================
function soldierBoard(o: { rage?: number; greed?: number; spent?: number; inHand?: boolean; controller?: typeof P1 | typeof P2; turn?: number; active?: typeof P1 | typeof P2 } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: () => 0.5,
    turn: o.turn,
    activePlayerId: o.active,
    cards: [
      o.inHand
        ? { key: "s", def: printing(SOLDIER), owner: P1, zone: "hand" }
        : { key: "s", def: printing(SOLDIER), owner: P1, zone: "play", controller: o.controller ?? P1 },
      { key: "s2", def: printing(SOLDIER), owner: P1, zone: "play" },
      { key: "o", def: character({ name: "Ordinary", life: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 4 }), owner: P2, zone: "play" },
      { key: "kill", def: killAny(), owner: P1, zone: "hand" },
      { key: "zap", def: zap(), owner: P1, zone: "hand" },
      ...bank("rage", o.rage ?? 0, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...spentResources(P1, o.spent ?? 0)
    ] as Cards
  });
}
clause(SOLDIER, "0:rule", "printed card: character, warlord, soldier, cost 1, threshold rr, 1 strength / 3 speed / 1 life", () => {
  const b = soldierBoard({ inHand: true, rage: 2 });
  const s = b.id("s");
  play(b.engine, P1, s, {});
  drain(b.engine, declineAll);
  assert.equal(zone(b.engine, s), "play");
  assert.equal(b.engine.getStat(s, "strength"), 1);
  assert.equal(b.engine.getStat(s, "speed"), 3);
  assert.equal(b.engine.getStat(s, "life"), 1);
  const p = printing(SOLDIER);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "warlord");
  assert.deepEqual([...(p.subtype ?? [])], ["soldier"]);
  assert.equal(p.cost, 1);
  assert.equal(p.threshold, "rr");
  assert.equal(ready(b.engine), 1, "cost 1 paid");
});
clause(SOLDIER, "0:rule", "deploy: one resource short is refused (rr met by spent icons), and one rage icon is refused with plenty of other resources", () => {
  const short = soldierBoard({ inHand: true, spent: 2, rage: 0 });
  refused(() => play(short.engine, P1, short.id("s"), {}), "cost 1 with nothing ready");
  const ok = soldierBoard({ inHand: true, spent: 2, rage: 1 });
  play(ok.engine, P1, ok.id("s"), {});
  assert.equal(zone(ok.engine, ok.id("s")), "play");
  const thr = soldierBoard({ inHand: true, rage: 1, greed: 3 });
  refused(() => play(thr.engine, P1, thr.id("s"), {}), "one rage icon, threshold rr");
  const thrOk = soldierBoard({ inHand: true, rage: 2, greed: 1 });
  play(thrOk.engine, P1, thrOk.id("s"), {});
  assert.equal(zone(thrOk.engine, thrOk.id("s")), "play");
});
clause(SOLDIER, "0:rule", "when destroyed it is flipped face-down in play under its owner's control instead (not put in the discard pile), and it becomes a resource", () => {
  const b = soldierBoard();
  const before = ready(b.engine);
  kill(b.engine, b.id, "kill", "s");
  const c = b.engine.state.cards[b.id("s")];
  assert.equal(c.zone, "play", "still in play");
  assert.equal(c.faceDown, true, "face-down");
  assert.equal(ctl(b.engine, b.id("s")), P1, "under its owner's control");
  assert.equal(ready(b.engine), before + 1, "a face-down card is a resource for its owner");
  assert.equal(ready(b.engine, P2), 0);
  assert.ok(!b.engine.state.players[P1].discard.includes(b.id("s")), "not in the discard pile");
  assert.ok(!hasEvent(b.engine, "cardDestroyed", b.id("s")), "it was never destroyed");
  assert.equal(b.engine.state.pendingChoice, undefined);
});
clause(SOLDIER, "0:rule", "control returns to the OWNER: an opponent-controlled Soldier destroyed flips face-down under its owner (the opponent does not keep it)", () => {
  const b = soldierBoard({ controller: P2 });
  assert.equal(b.engine.state.cards[b.id("s")].controllerId, P2, "starts under the opponent's control");
  const p1Before = ready(b.engine, P1);
  const p2Before = ready(b.engine, P2);
  kill(b.engine, b.id, "kill", "s");
  const c = b.engine.state.cards[b.id("s")];
  assert.equal(c.zone, "play");
  assert.equal(c.faceDown, true);
  assert.equal(ctl(b.engine, b.id("s")), P1, "back under its owner's control");
  assert.equal(ready(b.engine, P1), p1Before + 1);
  assert.equal(ready(b.engine, P2), p2Before, "the opponent gains no resource");
});
clause(SOLDIER, "0:rule", "lethal damage is replaced too: the Soldier flips face-down and sheds its damage", () => {
  const b = soldierBoard();
  kill(b.engine, b.id, "zap", "s");
  const c = b.engine.state.cards[b.id("s")];
  assert.equal(c.zone, "play");
  assert.equal(c.faceDown, true);
  assert.equal(c.damage ?? 0, 0);
  assert.equal(ctl(b.engine, b.id("s")), P1);
});
clause(SOLDIER, "0:rule", "battle destruction is replaced too (Soldier blocks and takes lethal damage)", () => {
  const b = soldierBoard({ turn: 2, active: P2 });
  const sid = b.id("s");
  declareAttackBy(b.engine, P2, [b.id("foe")]);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [sid] } as never);
  finishBattle(b.engine);
  const c = b.engine.state.cards[sid];
  assert.equal(c.zone, "play");
  assert.equal(c.faceDown, true);
  assert.equal(ctl(b.engine, sid), P1);
});
clause(SOLDIER, "0:rule", "only 'this card' is replaced: another Soldier and an ordinary character are still destroyed or untouched", () => {
  const b = soldierBoard();
  kill(b.engine, b.id, "kill", "o");
  assert.equal(zone(b.engine, b.id("o")), "discard", "an ordinary character is destroyed normally");
  assert.equal(b.engine.state.cards[b.id("s")].faceDown ?? false, false, "the other Soldier is untouched");
  const c = soldierBoard();
  kill(c.engine, c.id, "zap", "s");
  assert.equal(c.engine.state.cards[c.id("s")].faceDown, true);
  assert.equal(c.engine.state.cards[c.id("s2")].faceDown ?? false, false, "the second Soldier stays face-up");
  assert.equal(zone(c.engine, c.id("s2")), "play");
  kill(c.engine, c.id, "kill", "s2");
  assert.equal(c.engine.state.cards[c.id("s2")].faceDown, true, "the second Soldier has its own replacement");
});

// ============================================================================
// The Emperor Barduse -- character, warlord, emperor barduse / dragon, cost 8, [R]x6, 7/2/7
// UNIQUE EMPEROR BARDUSE -- When this card enters play, you may pick any number of characters. If you do, inflict X damage divided however you want to the characters, where X is twice the number of dragon characters you control. -- All your other "dragon" characters gain 1 strength and 1 life.
// ============================================================================
const BARD = "dfaf41b9-0c69-490b-98be-14ab8a996c11";
const dragon = (name: string, over: object = {}) => character({ name, subtype: ["dragon"], strength: 2, life: 3, ...over } as never);
function bardBoard(o: { rage?: number; greed?: number; spent?: number; inPlay?: boolean; extra?: Cards } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: () => 0.5,
    cards: [
      { key: "b", def: printing(BARD), owner: P1, zone: o.inPlay ? "play" : "hand" },
      { key: "o", def: character({ name: "O", life: 8 }), owner: P2, zone: "play" },
      { key: "o2", def: character({ name: "O2", life: 8 }), owner: P2, zone: "play" },
      { key: "m", def: character({ name: "M", life: 8 }), owner: P1, zone: "play" },
      { key: "it", def: item({ name: "It" }), owner: P2, zone: "play" },
      { key: "hc", def: character({ name: "HC" }), owner: P1, zone: "hand" },
      { key: "dc", def: character({ name: "DC" }), owner: P2, zone: "discard" },
      { key: "kill", def: killAny(), owner: P1, zone: "hand" },
      ...(o.extra ?? []),
      ...bank("rage", o.rage ?? 8, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...spentResources(P1, o.spent ?? 0)
    ] as Cards
  });
}
type BB = ReturnType<typeof bardBoard>;
const bardOpen = (b: BB) => {
  play(b.engine, P1, b.id("b"), {});
  const pc = pending(b.engine) as PC | undefined;
  assert.equal(pc?.kind, "selectTargets", "the enters-play trigger asks which characters to pick");
};
const bardPick = (b: BB, picked: string[]) => resolve(b.engine, { kind: "selectTargets", selected: { picked: picked.map(b.id) } });
/** Deploys Barduse and picks `picked`; returns the X offered (or undefined when no distribution is asked). */
const bardEnter = (b: BB, picked: string[], shares?: Record<string, number>): number | undefined => {
  bardOpen(b);
  bardPick(b, picked);
  const pc = pending(b.engine) as PC | undefined;
  if (picked.length === 0) {
    assert.equal(pc, undefined, "no pick, no damage to divide");
    return undefined;
  }
  assert.equal(pc?.kind, "distributeAmong");
  assert.equal(pc?.playerId, P1, "you divide the damage");
  const x = pc?.amount as number;
  const mapped: Record<string, number> = {};
  for (const [k, n] of Object.entries(shares ?? {})) mapped[b.id(k)] = n;
  resolve(b.engine, { kind: "distributeAmong", shares: mapped });
  drain(b.engine, declineAll);
  return x;
};

clause(BARD, "0:unique", "printed card: character, warlord, emperor barduse + dragon, cost 8, threshold rrrrrr, 7 strength / 2 speed / 7 life", () => {
  const b = bardBoard({ rage: 8, extra: [] });
  bardEnter(b, []);
  const id = b.id("b");
  assert.equal(zone(b.engine, id), "play");
  assert.equal(b.engine.getStat(id, "strength"), 7);
  assert.equal(b.engine.getStat(id, "speed"), 2);
  assert.equal(b.engine.getStat(id, "life"), 7);
  const p = printing(BARD);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "warlord");
  assert.deepEqual([...(p.subtype ?? [])].sort(), ["dragon", "emperor barduse"]);
  assert.equal(p.cost, 8);
  assert.equal(p.threshold, "rrrrrr");
  assert.equal(ready(b.engine), 0, "cost 8 paid in full");
});
clause(BARD, "0:unique", "deploy: one resource short of 8 is refused (six spent rage icons isolate the cost); exactly 8 ready works", () => {
  const short = bardBoard({ spent: 6, rage: 7 });
  refused(() => play(short.engine, P1, short.id("b"), {}), "7 ready for cost 8");
  assert.equal(zone(short.engine, short.id("b")), "hand");
  const ok = bardBoard({ spent: 6, rage: 8 });
  bardEnter(ok, []);
  assert.equal(zone(ok.engine, ok.id("b")), "play");
  assert.equal(ready(ok.engine), 0);
});
clause(BARD, "0:unique", "threshold [R]x6: five rage icons are refused with enough total resources; six work (spent icons count)", () => {
  const five = bardBoard({ rage: 5, greed: 5 });
  refused(() => play(five.engine, P1, five.id("b"), {}), "only five rage icons");
  const six = bardBoard({ rage: 6, greed: 2 });
  bardEnter(six, []);
  assert.equal(zone(six.engine, six.id("b")), "play");
  const spent = bardBoard({ rage: 2, greed: 6, spent: 4 });
  bardEnter(spent, []);
  assert.equal(zone(spent.engine, spent.id("b")), "play");
  const fiveSpent = bardBoard({ rage: 1, greed: 7, spent: 4 });
  refused(() => play(fiveSpent.engine, P1, fiveSpent.id("b"), {}), "5 rage icons including spent");
});
clause(BARD, "0:unique", "UNIQUE: a second Barduse under your control forces you to keep one and destroy the other; the opponent's own copy is fine", () => {
  const b = bardBoard({ extra: [{ key: "b2", def: printing(BARD), owner: P1, zone: "play" }] as Cards });
  play(b.engine, P1, b.id("b"), {});
  const seen: string[] = [];
  for (let i = 0; i < 6 && pending(b.engine); i++) {
    const pc = pending(b.engine) as PC;
    seen.push(pc.kind);
    if (pc.kind === "selectTargets") bardPick(b, []);
    else if (pc.kind === "uniqueSurvivor") resolve(b.engine, { kind: "uniqueSurvivor", keep: b.id("b2") });
    else break;
  }
  assert.ok(seen.includes("uniqueSurvivor"), `Unique raises the survivor choice (saw ${seen.join(",")})`);
  assert.equal(zone(b.engine, b.id("b2")), "play", "the kept copy");
  assert.equal(zone(b.engine, b.id("b")), "discard", "the other copy is destroyed");
  const opp = bardBoard({ extra: [{ key: "ob", def: printing(BARD), owner: P2, zone: "play" }] as Cards });
  bardOpen(opp);
  bardPick(opp, []);
  assert.equal(pending(opp.engine), undefined, "no survivor choice for different controllers");
  assert.equal(zone(opp.engine, opp.id("ob")), "play");
  assert.equal(zone(opp.engine, opp.id("b")), "play");
});

clause(BARD, "1:rule", "alone, X is twice the 1 dragon you control (Barduse itself) = 2, divided among the picked characters", () => {
  const b = bardBoard();
  const x = bardEnter(b, ["o"], { o: 2 });
  assert.equal(x, 2);
  assert.equal(dmg(b.engine, b.id("o")), 2);
  assert.equal(dmg(b.engine, b.id("o2")), 0, "unpicked characters take nothing");
  assert.equal(dmg(b.engine, b.id("m")), 0);
});
clause(BARD, "1:rule", "X counts only dragons you control: one more own dragon makes X 4, two make X 6; opposing dragons, non-dragons and dragons outside play do not count", () => {
  const one = bardBoard({ extra: [{ key: "d1", def: dragon("D1"), owner: P1, zone: "play" }] as Cards });
  assert.equal(bardEnter(one, ["o"], { o: 4 }), 4);
  const two = bardBoard({ extra: [{ key: "d1", def: dragon("D1"), owner: P1, zone: "play" }, { key: "d2", def: dragon("D2"), owner: P1, zone: "play" }] as Cards });
  assert.equal(bardEnter(two, ["o"], { o: 6 }), 6);
  assert.equal(dmg(two.engine, two.id("o")), 6);
  const noise = bardBoard({
    extra: [
      { key: "od", def: dragon("OD"), owner: P2, zone: "play" },
      { key: "nd", def: character({ name: "ND", subtype: ["soldier"] }), owner: P1, zone: "play" },
      { key: "hd", def: dragon("HD"), owner: P1, zone: "hand" },
      { key: "dd", def: dragon("DD"), owner: P1, zone: "discard" },
      { key: "cd", def: dragon("CD"), owner: P2, zone: "play", controller: P1 }
    ] as Cards
  });
  assert.equal(bardEnter(noise, ["o"], { o: 4 }), 4, "Barduse + the dragon of yours that the opponent owns = 2 dragons");
});
clause(BARD, "1:rule", "an opponent-owned dragon under your control counts (control, not ownership); an own dragon under the opponent's control does not", () => {
  const b = bardBoard({ extra: [{ key: "cd", def: dragon("CD"), owner: P2, zone: "play", controller: P1 }, { key: "xd", def: dragon("XD"), owner: P1, zone: "play", controller: P2 }] as Cards });
  assert.equal(bardEnter(b, ["o"], { o: 4 }), 4);
});
clause(BARD, "1:rule", "the damage may be divided however you want: 3 and 1 among two picked characters, all on one, or split across own and opposing characters", () => {
  const b = bardBoard({ extra: [{ key: "d1", def: dragon("D1"), owner: P1, zone: "play" }] as Cards });
  bardEnter(b, ["o", "o2"], { o: 3, o2: 1 });
  assert.equal(dmg(b.engine, b.id("o")), 3);
  assert.equal(dmg(b.engine, b.id("o2")), 1);
  const mixed = bardBoard({ extra: [{ key: "d1", def: dragon("D1"), owner: P1, zone: "play" }] as Cards });
  bardEnter(mixed, ["o", "m"], { o: 1, m: 3 });
  assert.equal(dmg(mixed.engine, mixed.id("o")), 1);
  assert.equal(dmg(mixed.engine, mixed.id("m")), 3, "your own character can be picked");
  const all = bardBoard({ extra: [{ key: "d1", def: dragon("D1"), owner: P1, zone: "play" }] as Cards });
  bardEnter(all, ["o2"], { o2: 4 });
  assert.equal(dmg(all.engine, all.id("o2")), 4);
});
clause(BARD, "1:rule", "damage that reaches a picked character's life destroys it", () => {
  const b = bardBoard({ extra: [{ key: "w", def: character({ name: "Weak", life: 2 }), owner: P2, zone: "play" }] as Cards });
  bardEnter(b, ["w", "o"], { w: 2 });
  assert.equal(zone(b.engine, b.id("w")), "discard");
  assert.equal(zone(b.engine, b.id("o")), "play");
});
clause(BARD, "1:rule", "'divided': handing out more than X is refused", () => {
  const over = bardBoard({ extra: [{ key: "d1", def: dragon("D1"), owner: P1, zone: "play" }] as Cards });
  bardOpen(over);
  bardPick(over, ["o", "o2"]);
  refused(() => resolve(over.engine, { kind: "distributeAmong", shares: { [over.id("o")]: 3, [over.id("o2")]: 2 } }), "5 > X=4", /./);
  assert.equal(dmg(over.engine, over.id("o")), 0, "nothing dealt by the refused division");
  resolve(over.engine, { kind: "distributeAmong", shares: { [over.id("o")]: 3, [over.id("o2")]: 1 } });
  assert.equal(dmg(over.engine, over.id("o")), 3, "the exact division is accepted");
  assert.equal(dmg(over.engine, over.id("o2")), 1);
});
clause(BARD, "1:rule", "'divided': handing out less than X (3 of 4) is refused", () => {
  const under = bardBoard({ extra: [{ key: "d1", def: dragon("D1"), owner: P1, zone: "play" }] as Cards });
  bardOpen(under);
  bardPick(under, ["o", "o2"]);
  refused(() => resolve(under.engine, { kind: "distributeAmong", shares: { [under.id("o")]: 1, [under.id("o2")]: 2 } }), "3 < X=4", /./);
  assert.equal(dmg(under.engine, under.id("o")), 0);
});
clause(BARD, "1:rule", "the pick is 'any number', and may be none: picking nothing deals no damage and opens no division", () => {
  const b = bardBoard({ extra: [{ key: "d1", def: dragon("D1"), owner: P1, zone: "play" }] as Cards });
  assert.equal(bardEnter(b, []), undefined);
  for (const k of ["o", "o2", "m", "d1", "b"]) assert.equal(dmg(b.engine, b.id(k)), 0, `${k} undamaged`);
  assert.equal(zone(b.engine, b.id("b")), "play");
});
clause(BARD, "1:rule", "the pick: every character in play is pickable (own, opposing, Barduse itself); items, hand and discard cards are refused", () => {
  const all = bardBoard();
  bardOpen(all);
  bardPick(all, ["o", "o2", "m", "b"]);
  assert.equal((pending(all.engine) as PC).kind, "distributeAmong");
  assert.equal(((pending(all.engine) as PC).targets as string[]).length, 4);
  for (const bad of ["it", "hc", "dc"]) {
    const b = bardBoard();
    bardOpen(b);
    refused(() => bardPick(b, [bad]), `${bad} is not a character in play`);
  }
  const itself = bardBoard();
  bardEnter(itself, ["b"], { b: 2 });
  assert.equal(dmg(itself.engine, itself.id("b")), 2, "Barduse can damage itself");
});
clause(BARD, "1:rule", "the trigger is only for this card entering: another character entering later asks nothing", () => {
  const b = bardBoard({ inPlay: true });
  b.engine.state.cards[b.id("hc")].zone = "hand";
  play(b.engine, P1, b.id("hc"), {});
  drain(b.engine, declineAll);
  assert.equal(zone(b.engine, b.id("hc")), "play");
  assert.equal(pending(b.engine), undefined, "no pick prompt for another card");
  for (const k of ["o", "m", "hc"]) assert.equal(dmg(b.engine, b.id(k)), 0);
});

const auraBoard = (extra: Cards = [], inPlay = true) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: () => 0.5,
    cards: [
      { key: "b", def: printing(BARD), owner: P1, zone: "play", faceDown: !inPlay, ...(inPlay ? {} : { attachedToKey: "__factionA" }) },
      { key: "d1", def: dragon("D1"), owner: P1, zone: "play" },
      { key: "d2", def: dragon("D2", { strength: 4, life: 5 }), owner: P1, zone: "play" },
      { key: "od", def: dragon("OD"), owner: P2, zone: "play" },
      { key: "nd", def: character({ name: "ND", subtype: ["soldier"], strength: 2, life: 3 }), owner: P1, zone: "play" },
      { key: "kill", def: killAny(), owner: P1, zone: "hand" },
      ...extra
    ] as Cards
  });
clause(BARD, "2:rule", "your other dragons get +1 strength and +1 life; Barduse itself stays 7/7", () => {
  const { engine, id } = auraBoard();
  assert.equal(engine.getStat(id("d1"), "strength"), 3);
  assert.equal(engine.getStat(id("d1"), "life"), 4);
  assert.equal(engine.getStat(id("d2"), "strength"), 5);
  assert.equal(engine.getStat(id("d2"), "life"), 6);
  assert.equal(engine.getStat(id("d1"), "speed"), 1, "speed is not changed");
  assert.equal(engine.getStat(id("b"), "strength"), 7, "not itself");
  assert.equal(engine.getStat(id("b"), "life"), 7, "not itself");
});
clause(BARD, "2:rule", "only dragons you control: an opposing dragon and a non-dragon of yours are unchanged", () => {
  const { engine, id } = auraBoard();
  assert.equal(engine.getStat(id("od"), "strength"), 2);
  assert.equal(engine.getStat(id("od"), "life"), 3);
  assert.equal(engine.getStat(id("nd"), "strength"), 2);
  assert.equal(engine.getStat(id("nd"), "life"), 3);
});
clause(BARD, "2:rule", "control decides: an opponent-owned dragon under your control gets the bonus, your dragon under the opponent's control does not", () => {
  const { engine, id } = auraBoard([
    { key: "cd", def: dragon("CD"), owner: P2, zone: "play", controller: P1 },
    { key: "xd", def: dragon("XD"), owner: P1, zone: "play", controller: P2 }
  ] as Cards);
  assert.equal(engine.getStat(id("cd"), "strength"), 3);
  assert.equal(engine.getStat(id("cd"), "life"), 4);
  assert.equal(engine.getStat(id("xd"), "strength"), 2);
  assert.equal(engine.getStat(id("xd"), "life"), 3);
});
clause(BARD, "2:rule", "'other' is this card, not its name: another dragon that merely shares Barduse's name still gets +1/+1", () => {
  const { engine, id } = auraBoard([{ key: "twin", def: dragon("The Emperor Barduse"), owner: P1, zone: "play" }] as Cards);
  assert.equal(engine.getStat(id("twin"), "strength"), 3);
  assert.equal(engine.getStat(id("twin"), "life"), 4);
});
clause(BARD, "2:rule", "the bonus ends when Barduse leaves play, and a face-down Barduse resource grants nothing", () => {
  const b = auraBoard();
  assert.equal(b.engine.getStat(b.id("d1"), "strength"), 3);
  kill(b.engine, b.id, "kill", "b");
  assert.equal(zone(b.engine, b.id("b")), "discard");
  assert.equal(b.engine.getStat(b.id("d1"), "strength"), 2, "bonus gone");
  assert.equal(b.engine.getStat(b.id("d1"), "life"), 3);
  assert.equal(b.engine.getStat(b.id("d2"), "life"), 5);
  const down = auraBoard([], false);
  assert.equal(down.engine.getStat(down.id("d1"), "strength"), 2, "face-down resource: no static ability");
  assert.equal(down.engine.getStat(down.id("d1"), "life"), 3);
});
clause(BARD, "2:rule", "each controller's Barduse boosts only their own dragons", () => {
  const { engine, id } = auraBoard([{ key: "ob", def: printing(BARD), owner: P2, zone: "play" }] as Cards);
  assert.equal(engine.getStat(id("od"), "strength"), 3, "the opponent's dragon gets the opponent's bonus");
  assert.equal(engine.getStat(id("od"), "life"), 4);
  assert.equal(engine.getStat(id("d1"), "strength"), 3, "yours gets exactly one bonus");
  assert.equal(engine.getStat(id("ob"), "strength"), 7, "the opposing Barduse does not boost your Barduse");
  assert.equal(engine.getStat(id("b"), "strength"), 7, "your Barduse is not boosted by the opposing one");
});

// ============================================================================
// The Emperor Born -- tactic, warlord, cost 0, [R]
// EXTRA COST: Deploy this only not during a battle. Pick a character in your discard pile. -- You may deploy the character.
// REUSE: [R] -- COST: Use this only while this card is a face-down resource. Reveal this card. Pay 4. Pick a character in your discard pile. Discard a card. -- EFFECT: You may deploy the character.
// ============================================================================
const BORN = "f41f27d3-af88-4782-b024-39c8a6e9620a";
const noop = () => tactic({ name: "Noop", cost: 0, behavior: { abilities: [{ id: "n", type: "activated", effects: [] }] } } as never);
function bornBoard(o: { extra?: Cards; rage?: number; greed?: number; spent?: number; reuse?: boolean; zone?: "play" | "hand" | "discard"; faceDown?: boolean; turn?: number; active?: typeof P1 | typeof P2; hand?: number } = {}) {
  const z = o.zone ?? (o.reuse ? "play" : "hand");
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: () => 0.5,
    turn: o.turn,
    activePlayerId: o.active,
    cards: [
      { key: "t", def: printing(BORN), owner: P1, zone: z, faceDown: o.faceDown ?? !!o.reuse },
      { key: "dc", def: character({ name: "DC", cost: 2 }), owner: P1, zone: "discard" },
      { key: "dc0", def: character({ name: "DC0", cost: 0 }), owner: P1, zone: "discard" },
      { key: "dc0b", def: character({ name: "DC0b", cost: 0 }), owner: P1, zone: "discard" },
      { key: "dg", def: character({ name: "DG", cost: 1, threshold: "gg" } as never), owner: P1, zone: "discard" },
      { key: "odc", def: character({ name: "ODC", cost: 0 }), owner: P2, zone: "discard" },
      { key: "idc", def: item({ name: "IDC", cost: 0 }), owner: P1, zone: "discard" },
      { key: "hc", def: character({ name: "HC", cost: 0 }), owner: P1, zone: "hand" },
      { key: "pc", def: character({ name: "PC", cost: 0 }), owner: P1, zone: "play" },
      { key: "att", def: character({ name: "Att", strength: 1, life: 4 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 4 }), owner: P2, zone: "play" },
      ...(o.extra ?? []),
      ...Array.from({ length: o.hand ?? 2 }, (_, i) => ({ key: `h${i}`, def: character({ name: `H${i}` }), owner: P1, zone: "hand" as const })),
      ...bank("rage", o.rage ?? 2, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...spentResources(P1, o.spent ?? 0)
    ] as Cards
  });
}
type NB = ReturnType<typeof bornBoard>;
/** Answers a pending deploy offer: accept `key`, or decline when null; drains the rest. */
const bornDeploy = (b: NB, key: string | null) => {
  const pc = pending(b.engine) as PC | undefined;
  if (pc?.kind === "deployForFree") resolve(b.engine, key ? { kind: "deployForFree", cardId: b.id(key) } : { kind: "deployForFree" });
  drain(b.engine, declineAll);
};
const bornCast = (b: NB, pick = "dc0", deploy: string | null = pick) => {
  play(b.engine, P1, b.id("t"), { selected: { back: [b.id(pick)] } });
  bornDeploy(b, deploy);
};
const bornReuse = (b: NB, pick = "dc0", toll = "h0", deploy: string | null = pick) => {
  activate(b.engine, P1, b.id("t"), "reuse", { selected: { back2: [b.id(pick)], toll: [b.id(toll)] } });
  bornDeploy(b, deploy);
};

clause(BORN, "0:extraCost", "printed card: tactic, warlord, cost 0, threshold r, no FLIP UP", () => {
  const p = printing(BORN);
  assert.equal(p.type, "tactic");
  assert.equal(p.trade, "warlord");
  assert.equal(p.cost, 0);
  assert.equal(p.threshold, "r");
  assert.equal((p as { flipUp?: unknown }).flipUp, undefined);
});
clause(BORN, "0:extraCost", "cost 0: casting spends nothing (the free character stays free of cost); the tactic ends in the discard pile", () => {
  const b = bornBoard({ rage: 2 });
  bornCast(b, "dc0", null);
  assert.equal(ready(b.engine), 2, "no resource spent");
  assert.equal(zone(b.engine, b.id("t")), "discard");
  assert.equal(zone(b.engine, b.id("dc0")), "discard", "declined: it stays in the discard pile");
});
clause(BORN, "0:extraCost", "threshold [R]: needs a rage icon (greed only is refused), a spent rage icon counts, with cost 0 and no ready resource", () => {
  const none = bornBoard({ rage: 0, greed: 3 });
  refused(() => play(none.engine, P1, none.id("t"), { selected: { back: [none.id("dc0")] } }), "no rage icon");
  assert.equal(zone(none.engine, none.id("t")), "hand");
  const spent = bornBoard({ rage: 0, spent: 1 });
  bornCast(spent);
  assert.equal(zone(spent.engine, spent.id("dc0")), "play", "a spent rage icon meets [R]");
  const one = bornBoard({ rage: 1, greed: 2 });
  bornCast(one);
  assert.equal(zone(one.engine, one.id("dc0")), "play");
});
clause(BORN, "0:extraCost", "Deploy this only not during a battle: refused while you attack, refused when you are defending; the same board works once the battle is over", () => {
  const atk = bornBoard();
  declareAttackBy(atk.engine, P1, [atk.id("att")]);
  assert.ok(atk.engine.state.battle, "a battle is under way");
  refused(() => play(atk.engine, P1, atk.id("t"), { selected: { back: [atk.id("dc0")] } }), "not during a battle", /battle/i);
  assert.equal(zone(atk.engine, atk.id("t")), "hand");
  assert.equal(zone(atk.engine, atk.id("dc0")), "discard");
  atk.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] } as never);
  finishBattle(atk.engine);
  bornCast(atk);
  assert.equal(zone(atk.engine, atk.id("dc0")), "play", "after the battle it works");
  const def = bornBoard({ turn: 2, active: P2 });
  declareAttackOpenWindow(def.engine, P2, [def.id("foe")]);
  assert.ok(def.engine.state.battle, "def.engine.state.battle");
  refused(() => play(def.engine, P1, def.id("t"), { selected: { back: [def.id("dc0")] } }), "defender in a battle");
  assert.equal(zone(def.engine, def.id("t")), "hand");
  assert.equal(zone(def.engine, def.id("dc0")), "discard");
  const ctl = bornBoard({ turn: 2, active: P2, extra: [{ key: "noop", def: noop(), owner: P2, zone: "hand" }] as Cards });
  playRaw(ctl.engine, P2, ctl.id("noop"), {});
  assert.equal(ctl.engine.state.battle, undefined, "a response window but no battle");
  bornCast(ctl);
  assert.equal(zone(ctl.engine, ctl.id("dc0")), "play", "the same defender with no battle can deploy it");
});
clause(BORN, "0:extraCost", "the pick must be a character of yours in your discard pile: the opponent's discard, an item, a hand card, a card in play and nothing are refused", () => {
  for (const bad of ["odc", "idc", "hc", "pc"]) {
    const b = bornBoard();
    refused(() => play(b.engine, P1, b.id("t"), { selected: { back: [b.id(bad)] } }), `${bad} is not a character in your discard pile`);
    assert.equal(zone(b.engine, b.id("t")), "hand");
  }
  const none = bornBoard();
  refused(() => play(none.engine, P1, none.id("t"), { selected: {} }), "no pick");
  const two = bornBoard();
  refused(() => play(two.engine, P1, two.id("t"), { selected: { back: [two.id("dc0"), two.id("dc0b")] } }), "exactly one pick");
  const ok = bornBoard();
  bornCast(ok, "dc0b");
  assert.equal(zone(ok.engine, ok.id("dc0b")), "play", "any character of yours in the discard pile can be picked");
});

clause(BORN, "1:rule", "'You may deploy': accepting puts the picked character into play, paying its cost 2 (not free); only the picked one is deployed", () => {
  const b = bornBoard({ rage: 5 });
  bornCast(b, "dc");
  assert.equal(zone(b.engine, b.id("dc")), "play");
  assert.equal(ctl(b.engine, b.id("dc")), P1);
  assert.equal(ready(b.engine), 3, "its cost 2 was paid");
  assert.equal(zone(b.engine, b.id("dc0")), "discard", "other discarded characters stay");
  assert.equal(zone(b.engine, b.id("dg")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
});
clause(BORN, "1:rule", "'You may': declining leaves the character in the discard pile and pays nothing", () => {
  const b = bornBoard({ rage: 5 });
  bornCast(b, "dc", null);
  assert.equal(zone(b.engine, b.id("dc")), "discard");
  assert.equal(ready(b.engine), 5);
  assert.equal(zone(b.engine, b.id("t")), "discard");
});
/** Casts Born on `pick`, then tries to accept the deploy offer for it: must be refused (`pattern`), after which declining leaves it in the discard pile. */
const bornCannotDeploy = (b: NB, pick: string, pattern: RegExp) => {
  play(b.engine, P1, b.id("t"), { selected: { back: [b.id(pick)] } });
  assert.equal((pending(b.engine) as PC | undefined)?.kind, "deployForFree", "the deploy is offered");
  refused(() => resolve(b.engine, { kind: "deployForFree", cardId: b.id(pick) }), "cannot pay for / meet the threshold of the character", pattern);
  assert.equal(zone(b.engine, b.id(pick)), "discard", "refused: still in the discard pile");
  bornDeploy(b, null);
  assert.equal(zone(b.engine, b.id(pick)), "discard");
};
clause(BORN, "1:rule", "deploying pays the picked character's cost: with 1 resource a cost-2 character cannot be deployed and stays in the discard pile", () => {
  const b = bornBoard({ rage: 1 });
  bornCannotDeploy(b, "dc", /Costs cannot be paid/);
  assert.equal(ready(b.engine), 1, "nothing spent");
  const exact = bornBoard({ rage: 2 });
  bornCast(exact, "dc");
  assert.equal(zone(exact.engine, exact.id("dc")), "play");
  assert.equal(ready(exact.engine), 0);
});
clause(BORN, "1:rule", "deploying meets the character's own threshold: a [G][G] character cannot be deployed with rage only, but can with greed", () => {
  const b = bornBoard({ rage: 3 });
  bornCannotDeploy(b, "dg", /Threshold/);
  assert.equal(ready(b.engine), 3);
  const ok = bornBoard({ rage: 1, greed: 2 });
  bornCast(ok, "dg");
  assert.equal(zone(ok.engine, ok.id("dg")), "play");
  assert.equal(ready(ok.engine), 2, "cost 1 paid");
});

clause(BORN, "2:ability:reuse", "REUSE from a face-down resource: reveals, pays 4, discards the chosen card, deploys the picked character (cost paid) and the card stays a face-down resource", () => {
  const b = bornBoard({ reuse: true, rage: 6 });
  assert.equal(ready(b.engine), 7, "6 banks + the face-down card");
  const hand = handLen(b.engine);
  bornReuse(b, "dc", "h1");
  assert.equal(zone(b.engine, b.id("dc")), "play", "EFFECT: deployed");
  assert.equal(zone(b.engine, b.id("h1")), "discard", "COST: the chosen card is discarded");
  assert.equal(zone(b.engine, b.id("h0")), "hand");
  assert.equal(handLen(b.engine), hand - 1);
  assert.equal(zone(b.engine, b.id("t")), "play", "REUSE only reveals the card: it stays a face-down resource");
  assert.equal(b.engine.state.cards[b.id("t")].faceDown, true);
  assert.equal(ready(b.engine), 1, "4 + the deploy cost 2 paid from the pool of 7");
  assert.equal(b.engine.state.pendingChoice, undefined);
  const revealed = b.engine.getLog().some((e) => e.event?.type === "cardsRevealed" && ((e.event as unknown as { cardIds: string[] }).cardIds ?? []).includes(b.id("t")));
  assert.ok(revealed, "COST: Reveal this card");
});
clause(BORN, "2:ability:reuse", "REUSE EFFECT 'may deploy': declining keeps the character in the discard pile, but the 4 and the discard were already paid", () => {
  const b = bornBoard({ reuse: true, rage: 6 });
  bornReuse(b, "dc", "h0", null);
  assert.equal(zone(b.engine, b.id("dc")), "discard");
  assert.equal(zone(b.engine, b.id("h0")), "discard", "the cost is not refunded");
  assert.equal(ready(b.engine), 3, "only the 4 paid from the pool of 7");
});
clause(BORN, "2:ability:reuse", "REUSE COST pay 4: with banks + the card itself = 4 it works, with 3 it is refused and nothing is discarded", () => {
  const ok = bornBoard({ reuse: true, rage: 3 });
  assert.equal(ready(ok.engine), 4);
  bornReuse(ok, "dc0", "h0");
  assert.equal(zone(ok.engine, ok.id("dc0")), "play");
  assert.equal(zone(ok.engine, ok.id("h0")), "discard");
  const short = bornBoard({ reuse: true, rage: 2 });
  refused(() => bornReuse(short), "only 3 resources");
  assert.equal(zone(short.engine, short.id("dc0")), "discard");
  assert.equal(zone(short.engine, short.id("h0")), "hand");
  const mixed = bornBoard({ reuse: true, rage: 1, greed: 1 });
  refused(() => bornReuse(mixed), "3 resources incl. threshold", /Ability costs cannot be paid\./);
});
clause(BORN, "2:ability:reuse", "REUSE threshold [R]: greed only is refused, rage works, and a spent rage icon counts", () => {
  const none = bornBoard({ reuse: true, rage: 0, greed: 4 });
  refused(() => bornReuse(none), "no rage icon");
  assert.equal(zone(none.engine, none.id("dc0")), "discard");
  const spent = bornBoard({ reuse: true, rage: 0, greed: 4, spent: 1 });
  bornReuse(spent);
  assert.equal(zone(spent.engine, spent.id("dc0")), "play");
  const rage = bornBoard({ reuse: true, rage: 1, greed: 3 });
  bornReuse(rage);
  assert.equal(zone(rage.engine, rage.id("dc0")), "play");
});
clause(BORN, "2:ability:reuse", "REUSE COST: needs a card in your hand to discard, taken from the hand only", () => {
  const empty = bornBoard({ reuse: true, rage: 4, hand: 0 });
  empty.engine.state.cards[empty.id("hc")].zone = "play";
  refused(() => activate(empty.engine, P1, empty.id("t"), "reuse", { selected: { back2: [empty.id("dc0")] } }), "no card to discard");
  assert.equal(zone(empty.engine, empty.id("dc0")), "discard");
  const wrong = bornBoard({ reuse: true, rage: 4 });
  refused(() => bornReuse(wrong, "dc0", "pc"), "a character in play is not a card in hand");
  assert.equal(zone(wrong.engine, wrong.id("pc")), "play");
  const none = bornBoard({ reuse: true, rage: 4 });
  refused(() => activate(none.engine, P1, none.id("t"), "reuse", { selected: { back2: [none.id("dc0")] } }), "no discard chosen");
  const ok = bornBoard({ reuse: true, rage: 4 });
  bornReuse(ok, "dc0", "h1");
  assert.equal(zone(ok.engine, ok.id("dc0")), "play", "positive control: with a hand card chosen it works");
  assert.equal(zone(ok.engine, ok.id("h1")), "discard");
});
clause(BORN, "2:ability:reuse", "REUSE: use only while this card is a face-down resource - refused from hand and from the discard pile", () => {
  for (const [z, fd] of [["hand", false], ["discard", false]] as const) {
    const b = bornBoard({ reuse: true, zone: z, faceDown: fd, rage: 6 });
    refused(() => bornReuse(b), `card is in ${z} face-${fd ? "down" : "up"}`);
    assert.equal(zone(b.engine, b.id("dc0")), "discard");
  }
  const ok = bornBoard({ reuse: true, rage: 6 });
  bornReuse(ok);
  assert.equal(zone(ok.engine, ok.id("dc0")), "play");
});
clause(BORN, "2:ability:reuse", "REUSE pick: a character of yours in your discard pile only (not the opponent's discard, an item, hand or play)", () => {
  for (const bad of ["odc", "idc", "hc", "pc"]) {
    const b = bornBoard({ reuse: true, rage: 6 });
    refused(() => bornReuse(b, bad), `${bad} is not a character in your discard pile`);
    assert.equal(zone(b.engine, b.id("h0")), "hand", "no discard cost was paid");
  }
  const none = bornBoard({ reuse: true, rage: 6 });
  refused(() => activate(none.engine, P1, none.id("t"), "reuse", { selected: { toll: [none.id("h0")] } }), "no pick");
  const ok = bornBoard({ reuse: true, rage: 6 });
  bornReuse(ok, "dc0b");
  assert.equal(zone(ok.engine, ok.id("dc0b")), "play");
  assert.equal(zone(ok.engine, ok.id("dc0")), "discard");
});
clause(BORN, "2:ability:reuse", "REUSE deploy pays the picked character's cost and respects its threshold: a cost-2 character with only 6 resources left unaffordable, a [G][G] one needs greed", () => {
  const dear = bornBoard({ reuse: true, rage: 4 });
  activate(dear.engine, P1, dear.id("t"), "reuse", { selected: { back2: [dear.id("dc")], toll: [dear.id("h0")] } });
  refused(() => resolve(dear.engine, { kind: "deployForFree", cardId: dear.id("dc") }), "4 paid, nothing left for the cost-2 character", /Costs cannot be paid/);
  assert.equal(zone(dear.engine, dear.id("dc")), "discard");
  const thr = bornBoard({ reuse: true, rage: 8 });
  activate(thr.engine, P1, thr.id("t"), "reuse", { selected: { back2: [thr.id("dg")], toll: [thr.id("h0")] } });
  refused(() => resolve(thr.engine, { kind: "deployForFree", cardId: thr.id("dg") }), "no greed icons", /Threshold/);
  assert.equal(zone(thr.engine, thr.id("dg")), "discard");
  const ok = bornBoard({ reuse: true, rage: 4, greed: 2 });
  bornReuse(ok, "dg");
  assert.equal(zone(ok.engine, ok.id("dg")), "play");
});

// ============================================================================
// The Enemy's Head -- item, warlord, cost 4, [R][R]
// When a character an opponent controls is destroyed, you may pay 1. If you do, put a token on this card. -- Characters you control gain 1 strength for each token on this card.
// ============================================================================
const HEAD = "bfd10394-2019-4c7c-87b5-11cf033a2869";
function headBoard(o: { rage?: number; two?: boolean; inHand?: boolean; greed?: number; spent?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: () => 0.5,
    cards: [
      { key: "h", def: printing(HEAD), owner: P1, zone: o.inHand ? "hand" : "play" },
      ...(o.two ? [{ key: "h2", def: printing(HEAD), owner: P1, zone: "play" }] : []),
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 5 }), owner: P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 5 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 5 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 2, life: 5 }), owner: P2, zone: "play" },
      { key: "oit", def: item({ name: "OIt" }), owner: P2, zone: "play" },
      { key: "cap", def: character({ name: "Cap", strength: 2, life: 5 }), owner: P1, zone: "play", controller: P2 },
      { key: "cap2", def: character({ name: "Cap2", strength: 2, life: 5 }), owner: P2, zone: "play", controller: P1 },
      { key: "k1", def: killAny(), owner: P1, zone: "hand" },
      { key: "k2", def: killAny(), owner: P1, zone: "hand" },
      { key: "k3", def: killAny(), owner: P1, zone: "hand" },
      ...bank("rage", o.rage ?? 4, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...spentResources(P1, o.spent ?? 0)
    ] as Cards
  });
}
type HB = ReturnType<typeof headBoard>;
const tokens = (b: HB, key = "h") => b.engine.state.cards[b.id(key)].counters?.token ?? 0;
const str = (b: HB, key: string) => b.engine.getStat(b.id(key), "strength");

clause(HEAD, "0:rule", "printed card: item, warlord, cost 4, threshold rr", () => {
  const p = printing(HEAD);
  assert.equal(p.type, "item");
  assert.equal(p.trade, "warlord");
  assert.equal(p.cost, 4);
  assert.equal(p.threshold, "rr");
  const b = headBoard({ inHand: true, rage: 4 });
  play(b.engine, P1, b.id("h"), {});
  drain(b.engine, declineAll);
  assert.equal(zone(b.engine, b.id("h")), "play");
  assert.equal(ready(b.engine), 0, "cost 4 paid in full");
  assert.equal(tokens(b), 0, "enters with no tokens");
});
clause(HEAD, "0:rule", "deploy: 3 ready (cost 4 isolated by spent rr) is refused, 4 works; one rage icon is refused with plenty of resources", () => {
  const short = headBoard({ inHand: true, spent: 2, rage: 3 });
  refused(() => play(short.engine, P1, short.id("h"), {}), "3 ready for cost 4");
  assert.equal(zone(short.engine, short.id("h")), "hand");
  const ok = headBoard({ inHand: true, spent: 2, rage: 4 });
  play(ok.engine, P1, ok.id("h"), {});
  assert.equal(zone(ok.engine, ok.id("h")), "play");
  const thr = headBoard({ inHand: true, rage: 1, greed: 5 });
  refused(() => play(thr.engine, P1, thr.id("h"), {}), "one rage icon, threshold rr");
  const thrOk = headBoard({ inHand: true, rage: 2, greed: 2 });
  play(thrOk.engine, P1, thrOk.id("h"), {});
  assert.equal(zone(thrOk.engine, thrOk.id("h")), "play");
});
clause(HEAD, "0:rule", "an opposing character is destroyed: you may pay 1 and the Head gets a token; the 1 is spent", () => {
  const b = headBoard();
  kill(b.engine, b.id, "k1", "foe", payAns(true));
  assert.equal(zone(b.engine, b.id("foe")), "discard");
  assert.equal(tokens(b), 1);
  assert.equal(ready(b.engine), 3, "exactly 1 paid");
  assert.equal(b.engine.state.pendingChoice, undefined);
});
clause(HEAD, "0:rule", "'you may pay 1': declining pays nothing and adds no token", () => {
  const b = headBoard();
  kill(b.engine, b.id, "k1", "foe", payAns(false));
  assert.equal(zone(b.engine, b.id("foe")), "discard");
  assert.equal(tokens(b), 0);
  assert.equal(ready(b.engine), 4);
});
clause(HEAD, "0:rule", "'if you do': with nothing to pay with, no token is added", () => {
  const b = headBoard({ rage: 0, spent: 2 });
  assert.equal(ready(b.engine), 0);
  kill(b.engine, b.id, "k1", "foe", payAns(true));
  assert.equal(zone(b.engine, b.id("foe")), "discard");
  assert.equal(tokens(b), 0, "unaffordable: no token");
  assert.equal(b.engine.state.pendingChoice, undefined);
});
clause(HEAD, "0:rule", "each destroyed opposing character adds one token (3 kills = 3 tokens, 3 paid)", () => {
  const b = headBoard({ rage: 6 });
  kill(b.engine, b.id, "k1", "foe", payAns(true));
  kill(b.engine, b.id, "k2", "foe2", payAns(true));
  kill(b.engine, b.id, "k3", "cap", payAns(true));
  assert.equal(tokens(b), 3);
  assert.equal(ready(b.engine), 3);
});
clause(HEAD, "0:rule", "only characters an OPPONENT controls: your own character, a character you control (even opponent-owned) and an opposing item do not trigger it", () => {
  const own = headBoard();
  kill(own.engine, own.id, "k1", "mine", payAns(true));
  assert.equal(zone(own.engine, own.id("mine")), "discard");
  assert.equal(tokens(own), 0);
  const stolen = headBoard();
  kill(stolen.engine, stolen.id, "k1", "cap2", payAns(true));
  assert.equal(zone(stolen.engine, stolen.id("cap2")), "discard");
  assert.equal(tokens(stolen), 0, "opponent-owned but you control it: no trigger");
  const itm = headBoard();
  kill(itm.engine, itm.id, "k1", "oit", payAns(true));
  assert.equal(zone(itm.engine, itm.id("oit")), "discard");
  assert.equal(tokens(itm), 0, "an item is not a character");
  assert.equal(ready(itm.engine), 4);
  const held = headBoard();
  kill(held.engine, held.id, "k1", "cap", payAns(true));
  assert.equal(tokens(held), 1, "owned by you but controlled by the opponent: triggers");
});
clause(HEAD, "0:rule", "'should not trigger' cases leave no pending choice", () => {
  const b = headBoard();
  play(b.engine, P1, b.id("k1"), { selected: { t: [b.id("mine")] } });
  assert.equal(b.engine.state.pendingChoice, undefined, "no pay prompt for your own character");
  const o = headBoard();
  play(o.engine, P1, o.id("k1"), { selected: { t: [o.id("foe")] } });
  const pc = pending(o.engine) as PC | undefined;
  assert.equal(pc?.kind, "mayPay", "the opposing kill offers the payment");
});
clause(HEAD, "0:rule", "a character destroyed in battle triggers it too", () => {
  const strong = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: () => 0.5,
    cards: [
      { key: "h", def: printing(HEAD), owner: P1, zone: "play" },
      { key: "big", def: character({ name: "Big", strength: 6, life: 5 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 0, life: 2 }), owner: P2, zone: "play" },
      ...bank("rage", 3, P1)
    ] as Cards
  });
  fightThrough(strong.engine, P1, [strong.id("big")], { type: "faction", playerId: P2 }, [strong.id("foe")], undefined, payAns(true) as never);
  assert.equal(zone(strong.engine, strong.id("foe")), "discard");
  assert.equal(strong.engine.state.cards[strong.id("h")].counters?.token ?? 0, 1);
  assert.equal(ready(strong.engine), 2);
});
clause(HEAD, "0:rule", "two Heads each trigger on the same death: each may pay 1 and gets its own token", () => {
  const b = headBoard({ two: true, rage: 4 });
  kill(b.engine, b.id, "k1", "foe", payAns(true));
  assert.equal(tokens(b, "h"), 1);
  assert.equal(tokens(b, "h2"), 1);
  assert.equal(ready(b.engine), 2, "1 paid per Head");
});

clause(HEAD, "1:rule", "with no tokens the Head grants nothing; each token gives your characters +1 strength (1 token +1, 2 tokens +2)", () => {
  const b = headBoard({ rage: 4 });
  assert.equal(str(b, "ally"), 2);
  assert.equal(str(b, "mine"), 1);
  kill(b.engine, b.id, "k1", "foe", payAns(true));
  assert.equal(str(b, "ally"), 3);
  assert.equal(str(b, "mine"), 2);
  kill(b.engine, b.id, "k2", "foe2", payAns(true));
  assert.equal(str(b, "ally"), 4);
  assert.equal(str(b, "mine"), 3);
  assert.equal(b.engine.getStat(b.id("ally"), "life"), 5, "only strength changes");
});
clause(HEAD, "1:rule", "only characters you control gain it: the opponent's characters do not; a character you control but do not own does", () => {
  const b = headBoard({ rage: 4 });
  kill(b.engine, b.id, "k1", "foe", payAns(true));
  assert.equal(str(b, "foe2"), 2, "opposing character unchanged");
  assert.equal(str(b, "cap"), 2, "owned by you but controlled by the opponent: unchanged");
  assert.equal(str(b, "cap2"), 3, "controlled by you: +1");
});
clause(HEAD, "1:rule", "a token on a Head that left play no longer grants strength; two Heads' tokens add up", () => {
  const b = headBoard({ two: true, rage: 4 });
  kill(b.engine, b.id, "k1", "foe", payAns(true));
  assert.equal(str(b, "ally"), 4, "1 token on each Head = +2");
  kill(b.engine, b.id, "k2", "h", payAns(false));
  assert.equal(zone(b.engine, b.id("h")), "discard");
  assert.equal(str(b, "ally"), 3, "only the other Head's token remains");
  kill(b.engine, b.id, "k3", "h2", payAns(false));
  assert.equal(str(b, "ally"), 2, "back to printed strength");
  assert.equal(str(b, "mine"), 1);
});

// ============================================================================
// Virtuous Razer -- character, warlord, soldier + vandal, cost 3, [R], 3/3/1
// When this card inflicts battle damage, you may pick a location. If you do, inflict the same amount of damage to that location.
// ============================================================================
const RAZER = "3aedd8f9-5b52-4995-b1f5-1dfc4dd9b98b";
function razerBoard(o: { rage?: number; greed?: number; spent?: number; inHand?: boolean; defender?: boolean; blockerStr?: number; blockerLife?: number; extra?: Cards } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: () => 0.5,
    turn: o.defender ? 2 : undefined,
    activePlayerId: o.defender ? P2 : undefined,
    cards: [
      { key: "r", def: printing(RAZER), owner: P1, zone: o.inHand ? "hand" : "play" },
      { key: "bl", def: character({ name: "BL", life: o.blockerLife ?? 5, strength: o.blockerStr ?? 0 }), owner: P2, zone: "play" },
      { key: "bl2", def: character({ name: "BL2", life: 5, strength: 0 }), owner: P2, zone: "play" },
      { key: "ally", def: character({ name: "Ally", life: 5, strength: 2 }), owner: P1, zone: "play" },
      { key: "L1", def: location({ name: "L1", structure: 5 } as never), owner: P2, zone: "play" },
      { key: "L2", def: location({ name: "L2", structure: 5 } as never), owner: P1, zone: "play" },
      { key: "S", def: location({ name: "Small", structure: 2 } as never), owner: P2, zone: "play" },
      { key: "oit", def: item({ name: "OIt" }), owner: P2, zone: "play" },
      ...(o.extra ?? []),
      ...bank("rage", o.rage ?? 0, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...spentResources(P1, o.spent ?? 0)
    ] as Cards
  });
}
type RB = ReturnType<typeof razerBoard>;
/** Razer attacks the opponent's faction, `bl` blocks; answers each location prompt with `pick` (null = decline). Returns the number of prompts. */
function razerFight(b: RB, pick: string | null, blockers: string[] = ["bl"], attackers: string[] = ["r"]): number {
  let prompts = 0;
  fightThrough(b.engine, P1, attackers.map(b.id), { type: "faction", playerId: P2 }, blockers.map(b.id), undefined, ((pc: PC) => {
    if (pc.kind === "chooserSelectsTarget") {
      prompts++;
      return { kind: pc.kind, selected: pick ? [b.id(pick)] : [] };
    }
    return declineAll(pc as never);
  }) as never);
  return prompts;
}

clause(RAZER, "0:rule", "printed card: character, warlord, soldier + vandal, cost 3, threshold r, 3 strength / 3 speed / 1 life", () => {
  const b = razerBoard({ inHand: true, rage: 3 });
  play(b.engine, P1, b.id("r"), {});
  drain(b.engine, declineAll);
  const r = b.id("r");
  assert.equal(zone(b.engine, r), "play");
  assert.equal(b.engine.getStat(r, "strength"), 3);
  assert.equal(b.engine.getStat(r, "speed"), 3);
  assert.equal(b.engine.getStat(r, "life"), 1);
  const p = printing(RAZER);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "warlord");
  assert.deepEqual([...(p.subtype ?? [])].sort(), ["soldier", "vandal"]);
  assert.equal(p.cost, 3);
  assert.equal(p.threshold, "r");
  assert.equal(ready(b.engine), 0, "cost 3 paid");
});
clause(RAZER, "0:rule", "deploy: 2 ready for cost 3 is refused (spent icon isolates the cost), 3 works; greed only is refused for [R]", () => {
  const short = razerBoard({ inHand: true, spent: 1, rage: 2 });
  refused(() => play(short.engine, P1, short.id("r"), {}), "2 ready for cost 3");
  assert.equal(zone(short.engine, short.id("r")), "hand");
  const ok = razerBoard({ inHand: true, spent: 1, rage: 3 });
  play(ok.engine, P1, ok.id("r"), {});
  assert.equal(zone(ok.engine, ok.id("r")), "play");
  const thr = razerBoard({ inHand: true, greed: 5 });
  refused(() => play(thr.engine, P1, thr.id("r"), {}), "no rage icon");
  const thrOk = razerBoard({ inHand: true, rage: 1, greed: 2 });
  play(thrOk.engine, P1, thrOk.id("r"), {});
  assert.equal(zone(thrOk.engine, thrOk.id("r")), "play");
});
clause(RAZER, "0:rule", "Razer inflicts battle damage to a blocker: you may pick a location and it takes the same 3 damage (the blocker takes 3 too)", () => {
  const b = razerBoard();
  assert.equal(razerFight(b, "L1"), 1);
  assert.equal(dmg(b.engine, b.id("bl")), 3, "battle damage to the blocker");
  assert.equal(dmg(b.engine, b.id("L1")), 3, "the same amount to the location");
  assert.equal(zone(b.engine, b.id("L1")), "play");
  assert.equal(dmg(b.engine, b.id("L2")), 0, "other locations untouched");
  assert.equal(dmg(b.engine, b.id("S")), 0);
});
clause(RAZER, "0:rule", "'you may': declining the pick inflicts no damage to any location", () => {
  const b = razerBoard();
  assert.equal(razerFight(b, null), 1);
  assert.equal(dmg(b.engine, b.id("bl")), 3);
  for (const k of ["L1", "L2", "S"]) assert.equal(dmg(b.engine, b.id(k)), 0, `${k} undamaged`);
});
clause(RAZER, "0:rule", "any location can be picked, yours or the opponent's; a location with structure at most 3 is destroyed", () => {
  const mine = razerBoard();
  razerFight(mine, "L2");
  assert.equal(dmg(mine.engine, mine.id("L2")), 3, "your own location can be picked");
  const small = razerBoard();
  razerFight(small, "S");
  assert.equal(zone(small.engine, small.id("S")), "discard", "3 damage destroys structure 2");
});
clause(RAZER, "0:rule", "the pick must be a location: a character, an item and the blocker itself are refused", () => {
  for (const bad of ["bl2", "oit", "ally"]) {
    const b = razerBoard();
    declareAttackBy(b.engine, P1, [b.id("r")]);
    b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("bl")] } as never);
    autoResolveBattle(b.engine);
    const pc = pending(b.engine) as PC | undefined;
    assert.equal(pc?.kind, "chooserSelectsTarget", "the location pick is offered");
    refused(() => resolve(b.engine, { kind: "chooserSelectsTarget", selected: [b.id(bad)] }), `${bad} is not a location`);
    assert.equal(dmg(b.engine, b.id(bad)), 0, "the refused pick dealt nothing");
    refused(() => resolve(b.engine, { kind: "chooserSelectsTarget", selected: [b.id("L1"), b.id("L2")] }), "only one location may be picked");
    assert.equal(dmg(b.engine, b.id("L2")), 0);
    resolve(b.engine, { kind: "chooserSelectsTarget", selected: [b.id("L1")] });
    assert.equal(dmg(b.engine, b.id("L1")), 3, "a location is accepted");
  }
});
clause(RAZER, "0:rule", "'the same amount': the amount follows the damage inflicted - 5 when Razer has 5 strength (two Enemy's Head tokens)", () => {
  const b = razerBoard({
    blockerLife: 9,
    extra: [
      { key: "head", def: printing(HEAD), owner: P1, zone: "play", counters: { token: 2 } },
      { key: "L3", def: location({ name: "L3", structure: 9 } as never), owner: P2, zone: "play" }
    ] as Cards
  });
  assert.equal(b.engine.getStat(b.id("r"), "strength"), 5);
  razerFight(b, "L3");
  assert.equal(dmg(b.engine, b.id("bl")), 5);
  assert.equal(dmg(b.engine, b.id("L3")), 5, "same amount as inflicted, not a fixed 3");
});
clause(RAZER, "0:rule", "only damage THIS card inflicts triggers it: an ally in the same party does not add a prompt or damage", () => {
  const b = razerBoard({ blockerLife: 9 });
  const prompts = razerFight(b, "L1", ["bl"], ["r", "ally"]);
  assert.equal(prompts, 1, "one prompt: only Razer's damage");
  assert.equal(dmg(b.engine, b.id("L1")), 3, "Razer's 3, not the ally's 2 or the sum");
  assert.equal(dmg(b.engine, b.id("bl")), 5, "3 + 2 on the blocker");
});
clause(RAZER, "0:rule", "damage dealt TO Razer does not trigger it: a blocker with strength 2 that hits Razer adds no extra prompt", () => {
  const b = razerBoard({ blockerStr: 2 });
  const prompts = razerFight(b, "L1");
  assert.equal(prompts, 1, "only Razer's own damage prompts");
  assert.equal(dmg(b.engine, b.id("L1")), 3);
  assert.equal(zone(b.engine, b.id("r")), "discard", "Razer (life 1) is destroyed but its damage still counted");
});
clause(RAZER, "0:rule", "Razer blocking also inflicts battle damage and triggers", () => {
  const b = razerBoard({ defender: true, extra: [{ key: "att", def: character({ name: "Att", strength: 0, life: 5 }), owner: P2, zone: "play" }] as Cards });
  declareAttackBy(b.engine, P2, [b.id("att")]);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("r")] } as never);
  let prompts = 0;
  finishBattle(b.engine, undefined, ((pc: PC) => {
    if (pc.kind === "chooserSelectsTarget") {
      prompts++;
      return { kind: pc.kind, selected: [b.id("L1")] };
    }
    return declineAll(pc as never);
  }) as never);
  assert.equal(prompts, 1);
  assert.equal(dmg(b.engine, b.id("att")), 3);
  assert.equal(dmg(b.engine, b.id("L1")), 3);
});
clause(RAZER, "0:rule", "Razer's damage to a faction in an unblocked attack is battle damage too: the location prompt appears", () => {
  const b = razerBoard();
  let prompts = 0;
  const inf = b.engine.state.players[P2].influence;
  fightThrough(b.engine, P1, [b.id("r")], { type: "faction", playerId: P2 }, [], undefined, ((pc: PC) => {
    if (pc.kind === "chooserSelectsTarget") {
      prompts++;
      return { kind: pc.kind, selected: [b.id("L1")] };
    }
    return declineAll(pc as never);
  }) as never);
  assert.ok(b.engine.state.players[P2].influence < inf, "the faction took battle damage");
  assert.equal(prompts, 1);
  assert.equal(dmg(b.engine, b.id("L1")), 3);
});
clause(RAZER, "0:rule", "Razer's battle damage to an attacked LOCATION is battle damage too: you may pick another location for the same amount", () => {
  const b = razerBoard();
  let prompts = 0;
  fightThrough(b.engine, P1, [b.id("r")], { type: "card", cardId: b.id("L1") }, [], undefined, ((pc: PC) => {
    if (pc.kind === "chooserSelectsTarget") {
      prompts++;
      return { kind: pc.kind, selected: [b.id("S")] };
    }
    return declineAll(pc as never);
  }) as never);
  assert.equal(dmg(b.engine, b.id("L1")), 3, "the attacked location took 3");
  assert.equal(prompts, 1, "Razer's damage to a location is still battle damage");
  assert.equal(zone(b.engine, b.id("S")), "discard", "the picked location took the same 3");
});
clause(RAZER, "0:rule", "damage split across two blockers prompts per instance and the picked location takes the full amount inflicted", () => {
  const b = razerBoard();
  const prompts = razerFight(b, "L1", ["bl", "bl2"]);
  const inflicted = dmg(b.engine, b.id("bl")) + dmg(b.engine, b.id("bl2"));
  assert.equal(inflicted, 3);
  assert.ok(prompts >= 1, "prompts >= 1");
  assert.equal(dmg(b.engine, b.id("L1")), 3, "the location takes the total inflicted");
});
clause(RAZER, "0:rule", "no trigger when Razer is not in the battle: another character's damage leaves the Razer idle", () => {
  const b = razerBoard();
  const prompts = razerFight(b, "L1", ["bl"], ["ally"]);
  assert.equal(prompts, 0);
  assert.equal(dmg(b.engine, b.id("L1")), 0);
  assert.equal(dmg(b.engine, b.id("bl")), 2);
});

void zone;
void handLen;
