import assert from "node:assert/strict";
import { buildGame, activate, bank, character, developFaction, item, location, P1, P2, play } from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, refused } from "./_clause.js";
import { declareAttackBy, fight, fightThrough, finishBattle, playRaw } from "./_battle.js";
import { endTurn, factionOf, spentResources } from "./_turn.js";

type Cards = NonNullable<Parameters<typeof buildGame>[0]>["cards"];
type Engine = ReturnType<typeof buildGame>["engine"];
const ready = (e: Engine, p: string = P1) => e.getAvailableResourceCount(p as never);
const zone = (e: Engine, cardId: string) => e.state.cards[cardId].zone;
const dmg = (e: Engine, cardId: string) => e.state.cards[cardId].damage ?? 0;
const tryAct = (engine: Engine, fn: () => void) => { try { fn(); } catch { /* refused */ } void engine; };

// ============================================================================
// Invade! -- tactic, warlord, cost 2, [R][R]
// EXTRA COST: Pick a character. -- This turn, the character cannot block.
// REUSE: [R][R] -- COST: Use this only while this card is a face-down resource. Reveal this card. Pay 4. Discard a card. Pick a character. -- EFFECT: This turn, the character cannot block.
// ============================================================================
const INVADE = "f98061c7-7dd2-4163-947f-a59367118f57";
function invadeBoard(o: { rage?: number; greed?: number; spent?: number; turn?: P } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "t", def: printing(INVADE), owner: P1, zone: "hand" },
      { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" },
      { key: "ob", def: character({ name: "OB" }), owner: P2, zone: "play" },
      { key: "mc", def: character({ name: "MC", strength: 1 }), owner: P1, zone: "play" },
      { key: "it", def: item({ name: "It" }), owner: P2, zone: "play" },
      { key: "dc", def: character({ name: "DC" }), owner: P2, zone: "discard" },
      ...bank("rage", o.rage ?? 2, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...spentResources(P1, o.spent ?? 0)
    ] as Cards
  });
}
type P = typeof P1 | typeof P2;
const cast = (b: ReturnType<typeof invadeBoard>, key = "oc") => {
  play(b.engine, P1, b.id("t"), { selected: { mark: [b.id(key)] } });
  drain(b.engine, declineAll);
};
const blocked = (e: Engine, id: string) => e.getRestrictions(id).includes("cannotBlock" as never);

clause(INVADE, "0:extraCost", "printed card: tactic, warlord, cost 2, threshold rr", () => {
  const p = printing(INVADE);
  assert.equal(p.type, "tactic");
  assert.equal(p.trade, "warlord");
  assert.equal(p.cost, 2);
  assert.equal(p.threshold, "rr");
});
clause(INVADE, "0:extraCost", "exactly the printed cost of 2 is paid (rr threshold met), card is used up", () => {
  const b = invadeBoard({ rage: 4 });
  assert.equal(ready(b.engine), 4);
  cast(b);
  assert.equal(ready(b.engine), 2, "cost 2 paid");
  assert.equal(zone(b.engine, b.id("t")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
});
clause(INVADE, "0:extraCost", "two rage is exactly enough; spending leaves nothing", () => {
  const b = invadeBoard({ rage: 2 });
  cast(b);
  assert.equal(ready(b.engine), 0);
  assert.ok(blocked(b.engine, b.id("oc")), "blocked(b.engine, b.id(\"oc\"))");
});
clause(INVADE, "0:extraCost", "one resource short of the cost is refused (threshold met by spent icons), the same board with enough works", () => {
  const short = invadeBoard({ spent: 2, rage: 1 });
  refused(() => play(short.engine, P1, short.id("t"), { selected: { mark: [short.id("oc")] } }), "only 1 ready resource for cost 2");
  assert.equal(blocked(short.engine, short.id("oc")), false);
  const ok = invadeBoard({ spent: 2, rage: 2 });
  cast(ok);
  assert.ok(blocked(ok.engine, ok.id("oc")), "blocked(ok.engine, ok.id(\"oc\"))");
  assert.equal(ready(ok.engine), 0);
});
clause(INVADE, "0:extraCost", "threshold rr: one rage short is refused even with enough resources; two rage works", () => {
  const short = invadeBoard({ rage: 1, greed: 3 });
  refused(() => play(short.engine, P1, short.id("t"), { selected: { mark: [short.id("oc")] } }), "only one rage icon");
  const none = invadeBoard({ rage: 0, greed: 4 });
  refused(() => play(none.engine, P1, none.id("t"), { selected: { mark: [none.id("oc")] } }), "no rage icon");
  const ok = invadeBoard({ rage: 2, greed: 2 });
  cast(ok);
  assert.ok(blocked(ok.engine, ok.id("oc")), "blocked(ok.engine, ok.id(\"oc\"))");
  assert.equal(ready(ok.engine), 2);
});
clause(INVADE, "0:extraCost", "icons of spent (attached) resources count toward the rr threshold", () => {
  const b = invadeBoard({ spent: 2, rage: 0, greed: 2 });
  cast(b);
  assert.ok(blocked(b.engine, b.id("oc")), "blocked(b.engine, b.id(\"oc\"))");
  assert.equal(ready(b.engine), 0);
});
clause(INVADE, "0:extraCost", "picks a character: either player's character can be picked", () => {
  const theirs = invadeBoard();
  cast(theirs, "oc");
  assert.ok(blocked(theirs.engine, theirs.id("oc")), "blocked(theirs.engine, theirs.id(\"oc\"))");
  const mine = invadeBoard();
  cast(mine, "mc");
  assert.ok(blocked(mine.engine, mine.id("mc")), "blocked(mine.engine, mine.id(\"mc\"))");
  assert.equal(blocked(mine.engine, mine.id("oc")), false);
});
clause(INVADE, "0:extraCost", "a non-character (item), a character outside play and no pick at all are refused", () => {
  const a = invadeBoard();
  refused(() => play(a.engine, P1, a.id("t"), { selected: { mark: [a.id("it")] } }), "an item is not a character");
  assert.equal(zone(a.engine, a.id("t")), "hand");
  const b = invadeBoard();
  refused(() => play(b.engine, P1, b.id("t"), { selected: { mark: [b.id("dc")] } }), "a discarded character is not in play");
  const c = invadeBoard();
  refused(() => play(c.engine, P1, c.id("t"), { selected: {} }), "the pick is a cost; no pick is refused");
  const d = invadeBoard();
  refused(() => play(d.engine, P1, d.id("t"), { selected: { mark: [d.id("oc"), d.id("ob")] } }), "exactly one character");
  assert.equal(ready(d.engine), 2, "nothing paid on refusals");
});

clause(INVADE, "1:rule", "the picked character gains cannot-block; no other character does", () => {
  const b = invadeBoard();
  assert.equal(blocked(b.engine, b.id("oc")), false, "control: can block before");
  cast(b);
  assert.ok(blocked(b.engine, b.id("oc")), "blocked(b.engine, b.id(\"oc\"))");
  assert.equal(blocked(b.engine, b.id("ob")), false);
  assert.equal(blocked(b.engine, b.id("mc")), false);
});
function attackBoard(invade: boolean, blockerKey: string) {
  const b = invadeBoard({ rage: 2 });
  if (invade) cast(b, "oc");
  declareAttackBy(b.engine, P1, [b.id("mc")]);
  return { b, run: () => b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id(blockerKey)] } as never) };
}
clause(INVADE, "1:rule", "this turn: the picked character is refused as a blocker in a battle (control: it blocks without the tactic)", () => {
  const ctl = attackBoard(false, "oc");
  ctl.run();
  finishBattle(ctl.b.engine);
  assert.equal(dmg(ctl.b.engine, ctl.b.id("oc")), 1, "control: OC blocked MC and took its 1 damage");
  const { b, run } = attackBoard(true, "oc");
  refused(run, "cannot block", /block/i);
  assert.equal(dmg(b.engine, b.id("oc")), 0);
});
clause(INVADE, "1:rule", "this turn: another character can still block when the picked one cannot", () => {
  const { b, run } = attackBoard(true, "ob");
  run();
  finishBattle(b.engine);
  assert.equal(dmg(b.engine, b.id("ob")), 1, "OB blocked MC");
  assert.equal(dmg(b.engine, b.id("oc")), 0);
});
clause(INVADE, "1:rule", "'this turn': the restriction is gone after the turn ends", () => {
  const b = invadeBoard();
  cast(b);
  assert.ok(blocked(b.engine, b.id("oc")), "blocked(b.engine, b.id(\"oc\"))");
  endTurn(b.engine, P1);
  assert.equal(blocked(b.engine, b.id("oc")), false);
});

function reuseBoard(o: { rage?: number; greed?: number; spent?: number; hand?: number; faceDown?: boolean; zone?: "play" | "hand" | "discard" } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "t", def: printing(INVADE), owner: P1, zone: o.zone ?? "play", faceDown: o.faceDown ?? true },
      { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" },
      { key: "ob", def: character({ name: "OB" }), owner: P2, zone: "play" },
      { key: "mc", def: character({ name: "MC", strength: 1 }), owner: P1, zone: "play" },
      { key: "it", def: item({ name: "It" }), owner: P2, zone: "play" },
      ...Array.from({ length: o.hand ?? 2 }, (_, i) => ({ key: `h${i}`, def: character({ name: `H${i}` }), owner: P1, zone: "hand" as const })),
      ...bank("rage", o.rage ?? 4, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...spentResources(P1, o.spent ?? 0)
    ] as Cards
  });
}
const reuse = (b: ReturnType<typeof reuseBoard>, mark = "oc", toll = "h0") =>
  activate(b.engine, P1, b.id("t"), "reuse", { selected: { mark2: [b.id(mark)], toll: [b.id(toll)] } });

clause(INVADE, "2:ability:reuse", "from a face-down resource with rr and 4 other resources: pays 4, discards the chosen card, picked character cannot block", () => {
  const b = reuseBoard({ rage: 4 });
  const handBefore = b.engine.state.players[P1].hand.length;
  reuse(b, "oc", "h1");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.ok(blocked(b.engine, b.id("oc")), "EFFECT: the character cannot block");
  assert.equal(blocked(b.engine, b.id("ob")), false);
  assert.equal(zone(b.engine, b.id("h1")), "discard", "COST: the chosen card is discarded");
  assert.equal(zone(b.engine, b.id("h0")), "hand", "the other card stays in hand");
  assert.equal(b.engine.state.players[P1].hand.length, handBefore - 1);
  assert.equal(zone(b.engine, b.id("t")), "play", "nothing in the text moves the REUSE card: it stays a resource");
});
clause(INVADE, "2:ability:reuse", "COST: pay 4 (and no more or less): 8 banks leave 4 or 5 ready; the card stays a face-down resource", () => {
  const b = reuseBoard({ rage: 8 });
  assert.equal(ready(b.engine), 9, "8 banks plus the face-down card itself");
  reuse(b);
  const after = ready(b.engine);
  assert.ok(after === 4 || after === 5, `4 paid (card may pay for itself) -> ${after}`);
});
clause(INVADE, "2:ability:reuse", "COST: pay 4 is unaffordable with only 2 banks + the card (3 total), refused; nothing else happens", () => {
  const b = reuseBoard({ rage: 2 });
  refused(() => reuse(b), "only 3 resources");
  assert.equal(blocked(b.engine, b.id("oc")), false);
  assert.equal(zone(b.engine, b.id("h0")), "hand");
  const c = reuseBoard({ rage: 1, greed: 1 });
  refused(() => reuse(c), "only 3 resources incl. threshold-short");
  const ok = reuseBoard({ rage: 4 });
  reuse(ok);
  assert.ok(blocked(ok.engine, ok.id("oc")), "control: 4 banks is enough");
});
clause(INVADE, "2:ability:reuse", "threshold [R][R]: four greed banks pay the 4 but there is no rage, refused; rr plus two greed works", () => {
  const b = reuseBoard({ rage: 0, greed: 4 });
  refused(() => reuse(b), "no rage icons");
  assert.equal(blocked(b.engine, b.id("oc")), false);
  const one = reuseBoard({ rage: 1, greed: 4 });
  refused(() => reuse(one), "one rage icon");
  const ok = reuseBoard({ rage: 2, greed: 2 });
  reuse(ok);
  assert.ok(blocked(ok.engine, ok.id("oc")), "blocked(ok.engine, ok.id(\"oc\"))");
});
clause(INVADE, "2:ability:reuse", "spent (attached) rage icons count toward the threshold of REUSE", () => {
  const b = reuseBoard({ rage: 0, greed: 4, spent: 2 });
  reuse(b);
  assert.ok(blocked(b.engine, b.id("oc")), "blocked(b.engine, b.id(\"oc\"))");
});
clause(INVADE, "2:ability:reuse", "COST: needs a card in hand to discard; the discard must come from the hand", () => {
  const empty = reuseBoard({ hand: 0 });
  refused(() => activate(empty.engine, P1, empty.id("t"), "reuse", { selected: { mark2: [empty.id("oc")] } }), "no card to discard");
  assert.equal(blocked(empty.engine, empty.id("oc")), false);
  const wrong = reuseBoard();
  refused(() => reuse(wrong, "oc", "mc"), "a character in play is not a card in hand");
  assert.equal(zone(wrong.engine, wrong.id("mc")), "play");
  const none = reuseBoard();
  refused(() => activate(none.engine, P1, none.id("t"), "reuse", { selected: { mark2: [none.id("oc")] } }), "no discard chosen");
  const ok = reuseBoard({ hand: 1 });
  reuse(ok);
  assert.equal(zone(ok.engine, ok.id("h0")), "discard", "control: a card in hand to discard");
  assert.equal(ok.engine.state.players[P1].hand.length, 0);
});
clause(INVADE, "2:ability:reuse", "COST: use only while this card is a face-down resource: refused from hand and from discard", () => {
  for (const [z, fd] of [["hand", false], ["discard", false]] as const) {
    const b = reuseBoard({ zone: z, faceDown: fd });
    refused(() => reuse(b), `card is in ${z} face-${fd ? "down" : "up"}`);
    assert.equal(blocked(b.engine, b.id("oc")), false);
  }
  const ok = reuseBoard();
  reuse(ok);
  assert.ok(blocked(ok.engine, ok.id("oc")), "blocked(ok.engine, ok.id(\"oc\"))");
});
clause(INVADE, "2:ability:reuse", "COST: reveal this card (a cardsRevealed event for the REUSE card)", () => {
  const b = reuseBoard();
  reuse(b);
  const revealed = b.engine.getLog().some((e) => e.event?.type === "cardsRevealed" && ((e.event as unknown as { cardIds: string[] }).cardIds ?? []).includes(b.id("t")));
  assert.ok(revealed, "the REUSE card is revealed");
});
clause(INVADE, "2:ability:reuse", "COST/EFFECT: pick a character: either player's; an item, a discarded character, none, or two are refused", () => {
  const mine = reuseBoard();
  reuse(mine, "mc");
  assert.ok(blocked(mine.engine, mine.id("mc")), "blocked(mine.engine, mine.id(\"mc\"))");
  assert.equal(blocked(mine.engine, mine.id("oc")), false);
  const item1 = reuseBoard();
  refused(() => reuse(item1, "it"), "an item is not a character");
  const none = reuseBoard();
  refused(() => activate(none.engine, P1, none.id("t"), "reuse", { selected: { toll: [none.id("h0")] } }), "no character picked");
  const two = reuseBoard();
  refused(() => activate(two.engine, P1, two.id("t"), "reuse", { selected: { mark2: [two.id("oc"), two.id("ob")], toll: [two.id("h0")] } }), "two characters");
  assert.equal(zone(two.engine, two.id("h0")), "hand");
});
clause(INVADE, "2:ability:reuse", "EFFECT: this turn only; and the picked character really cannot block", () => {
  const b = reuseBoard();
  reuse(b);
  declareAttackBy(b.engine, P1, [b.id("mc")]);
  refused(() => b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("oc")] } as never), "cannot block", /block/i);
  const ctl = reuseBoard();
  reuse(ctl);
  declareAttackBy(ctl.engine, P1, [ctl.id("mc")]);
  ctl.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [ctl.id("ob")] } as never);
  const end = reuseBoard();
  reuse(end);
  endTurn(end.engine, P1);
  assert.equal(blocked(end.engine, end.id("oc")), false, "restriction gone next turn");
});

// ============================================================================
// Lordly Stables -- location, warlord, cost 3, [R][R], structure 3
// When an attacking character you control inflicts battle damage to a character, increase the amount by 1.
// ============================================================================
const STABLES = "ceb39eb7-cad9-4368-b79b-8d301ef33ab0";
const PING = {
  abilities: [{
    id: "ping", type: "activated",
    targets: [{ id: "tg", count: 1, selector: { type: "character" } }],
    effects: [{ type: "dealDamage", target: { type: "selected", id: "tg" }, amount: 1 }]
  }]
};
function stablesBoard(o: { stables?: boolean; foeStables?: boolean; turn?: P; rage?: number; greed?: number; second?: boolean; atkController?: P } = {}) {
  const active = o.turn ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: 3,
    cards: [
      { key: "ls", def: printing(STABLES), owner: P1, zone: o.stables === false ? "hand" : "play" },
      ...(o.second ? [{ key: "ls2", def: printing(STABLES), owner: P1, zone: "play" as const }] : []),
      ...(o.foeStables ? [{ key: "fls", def: printing(STABLES), owner: P2, zone: "play" as const }] : []),
      { key: "a", def: character({ name: "A", strength: 2, life: 9, speed: 1, ...({ behavior: PING } as object) }), owner: active === P1 ? P1 : P2, zone: "play", controller: o.atkController },
      { key: "a2", def: character({ name: "A2", strength: 1, life: 9, speed: 1 }), owner: active === P1 ? P1 : P2, zone: "play" },
      { key: "b", def: character({ name: "B", strength: 1, life: 9, speed: 1 }), owner: active === P1 ? P2 : P1, zone: "play" },
      { key: "loc", def: location({ name: "Loc", structure: 9 }), owner: active === P1 ? P2 : P1, zone: "play" },
      ...bank("rage", o.rage ?? 3, P1),
      ...bank("greed", o.greed ?? 0, P1)
    ] as Cards
  });
}
const defender = (b: ReturnType<typeof stablesBoard>) => (b.engine.state.activePlayerId === P1 ? P2 : P1);

clause(STABLES, "0:rule", "printed card: location, warlord, cost 3, threshold rr, structure 3", () => {
  const b = stablesBoard();
  const p = printing(STABLES);
  assert.equal(p.type, "location");
  assert.equal(p.trade, "warlord");
  assert.equal(p.cost, 3);
  assert.equal(p.threshold, "rr");
  assert.equal(b.engine.getStat(b.id("ls"), "structure"), 3);
});
clause(STABLES, "0:rule", "deploys for exactly 3 with rr; 2 ready or one rage short is refused", () => {
  const ok = stablesBoard({ stables: false, rage: 3 });
  play(ok.engine, P1, ok.id("ls"));
  drain(ok.engine, declineAll);
  assert.equal(zone(ok.engine, ok.id("ls")), "play");
  assert.equal(ready(ok.engine), 0, "3 paid");
  const short = stablesBoard({ stables: false, rage: 2 });
  refused(() => play(short.engine, P1, short.id("ls")), "only 2 ready for cost 3");
  const sp = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ls", def: printing(STABLES), owner: P1, zone: "hand" }, ...spentResources(P1, 2), ...bank("rage", 2, P1)]
  });
  refused(() => play(sp.engine, P1, sp.id("ls")), "2 ready, 2 spent: cost 3 short though threshold met");
  const th = stablesBoard({ stables: false, rage: 1, greed: 3 });
  refused(() => play(th.engine, P1, th.id("ls")), "one rage short of rr", /Threshold requirements are not met/);
  const th2 = stablesBoard({ stables: false, rage: 2, greed: 1 });
  play(th2.engine, P1, th2.id("ls"));
  assert.equal(zone(th2.engine, th2.id("ls")), "play");
});
function blockedFight(b: ReturnType<typeof stablesBoard>, atkKey = "a") {
  const att = b.engine.state.activePlayerId as P;
  fightThrough(b.engine, att, [b.id(atkKey)], { type: "faction", playerId: defender(b) }, [b.id("b")]);
}
clause(STABLES, "0:rule", "an attacking character you control inflicts 1 extra battle damage to a character it fights (str 2 -> 3)", () => {
  const b = stablesBoard();
  blockedFight(b);
  assert.equal(dmg(b.engine, b.id("b")), 3);
});
clause(STABLES, "0:rule", "without Lordly Stables in play the same fight deals the printed amount (control)", () => {
  const b = stablesBoard({ stables: false });
  blockedFight(b);
  assert.equal(dmg(b.engine, b.id("b")), 2);
});
clause(STABLES, "0:rule", "only the attacker's damage is increased: the blocker's damage to the attacker is not", () => {
  const b = stablesBoard();
  blockedFight(b);
  assert.equal(dmg(b.engine, b.id("a")), 1);
});
clause(STABLES, "0:rule", "damage to something other than a character (an unblocked faction) is not increased", () => {
  const b = stablesBoard();
  const before = b.engine.state.players[P2].influence;
  fightThrough(b.engine, P1, [b.id("a")], { type: "faction", playerId: P2 }, []);
  const lost = before - b.engine.state.players[P2].influence;
  const ctl = stablesBoard({ stables: false });
  const before2 = ctl.engine.state.players[P2].influence;
  fightThrough(ctl.engine, P1, [ctl.id("a")], { type: "faction", playerId: P2 }, []);
  assert.equal(lost, 2, "str 2 attacker unblocked");
  assert.equal(before2 - ctl.engine.state.players[P2].influence, 2);
});
clause(STABLES, "0:rule", "damage to an attacked location is not increased", () => {
  const b = stablesBoard();
  fightThrough(b.engine, P1, [b.id("a")], { type: "card", cardId: b.id("loc") }, []);
  assert.equal(dmg(b.engine, b.id("loc")), 2);
});
clause(STABLES, "0:rule", "each attacker in a party gets +1: two attackers vs one blocker deal 2+1 and 1+1 = 5", () => {
  const b = stablesBoard();
  fightThrough(b.engine, P1, [b.id("a"), b.id("a2")], { type: "faction", playerId: P2 }, [b.id("b")]);
  assert.equal(dmg(b.engine, b.id("b")), 5);
});
clause(STABLES, "0:rule", "two Lordly Stables stack: +2", () => {
  const b = stablesBoard({ second: true });
  blockedFight(b);
  assert.equal(dmg(b.engine, b.id("b")), 4);
});
clause(STABLES, "0:rule", "'you control': the opponent's Stables does not boost my attacker; their Stables boosts their own attacker", () => {
  const b = stablesBoard({ stables: false, foeStables: true });
  blockedFight(b);
  assert.equal(dmg(b.engine, b.id("b")), 2, "opponent's Stables does not help P1");
  const c = stablesBoard({ turn: P2, stables: false, foeStables: true });
  // On P2's turn the "foe" is P1; P2 owns the attacker but the Stables sits with P2 now.
  assert.equal(c.engine.state.activePlayerId, P2);
  const d = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    turn: 3,
    cards: [
      { key: "fls", def: printing(STABLES), owner: P2, zone: "play" },
      { key: "a", def: character({ name: "A", strength: 2, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "b", def: character({ name: "B", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" }
    ] as Cards
  });
  fightThrough(d.engine, P2, [d.id("a")], { type: "faction", playerId: P1 }, [d.id("b")]);
  assert.equal(dmg(d.engine, d.id("b")), 3, "P2's own Stables boosts P2's attacker");
});
clause(STABLES, "0:rule", "my Stables does not boost the opponent's attacking character (their turn)", () => {
  const b = stablesBoard({ turn: P2 });
  blockedFight(b);
  assert.equal(dmg(b.engine, b.id("b")), 2);
});
clause(STABLES, "0:rule", "my Stables and my BLOCKING character: its damage to the opposing attacker is not increased (only attackers)", () => {
  const b = stablesBoard({ turn: P2 });
  fightThrough(b.engine, P2, [b.id("a")], { type: "faction", playerId: P1 }, [b.id("b")]);
  assert.equal(dmg(b.engine, b.id("a")), 1, "blocker strength 1, no bonus");
  assert.equal(dmg(b.engine, b.id("b")), 2, "their attacker (no Stables of theirs) is not boosted either");
});
clause(STABLES, "0:rule", "a character I control but do not own counts as 'a character you control'", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P1,
    turn: 3,
    cards: [
      { key: "ls", def: printing(STABLES), owner: P1, zone: "play" },
      { key: "a", def: character({ name: "A", strength: 2, life: 9, speed: 1 }), owner: P2, controller: P1, zone: "play" },
      { key: "b", def: character({ name: "B", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" }
    ] as Cards
  });
  fightThrough(b.engine, P1, [b.id("a")], { type: "faction", playerId: P2 }, [b.id("b")]);
  assert.equal(dmg(b.engine, b.id("b")), 3);
});
clause(STABLES, "0:rule", "not in play (in hand, or discarded) it does nothing; leaving play turns it off", () => {
  const hand = stablesBoard({ stables: false });
  blockedFight(hand);
  assert.equal(dmg(hand.engine, hand.id("b")), 2);
  const b = stablesBoard();
  b.engine.state.cards[b.id("ls")].zone = "discard";
  const arr = b.engine.state.players[P1].play;
  const i = arr.indexOf(b.id("ls"));
  if (i >= 0) arr.splice(i, 1);
  b.engine.state.players[P1].discard.push(b.id("ls"));
  blockedFight(b);
  assert.equal(dmg(b.engine, b.id("b")), 2);
});
clause(STABLES, "0:rule", "damage not dealt as battle damage (an attacking character's ability) is not increased", () => {
  const b = stablesBoard();
  declareAttackBy(b.engine, P1, [b.id("a")]);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("b")] } as never);
  activate(b.engine, P1, b.id("a"), "ping", { selected: { tg: [b.id("b")] } });
  assert.equal(dmg(b.engine, b.id("b")), 1, "1 ability damage, not 2");
});

// ============================================================================
// Manful Skirmish -- tactic, warlord, cost 4, [R][R]
// EXTRA COST: Pick 3 characters. -- Deplete one of the characters. Inflict 1 damage to another one of the characters.
// The remaining character gains 2 strength this turn. Draw a card.
// ============================================================================
const SKIRMISH = "bb5999f5-f3d4-4df2-aa37-1c7c140d55a6";
function skBoard(o: { rage?: number; greed?: number; spent?: number; y1Life?: number; extraChars?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: () => 0.3,
    cards: [
      { key: "t", def: printing(SKIRMISH), owner: P1, zone: "hand" },
      { key: "x1", def: character({ name: "X1", strength: 3, life: 3 }), owner: P1, zone: "play" },
      { key: "x2", def: character({ name: "X2", strength: 3, life: 3 }), owner: P1, zone: "play" },
      { key: "y1", def: character({ name: "Y1", strength: 3, life: o.y1Life ?? 3 }), owner: P2, zone: "play" },
      { key: "z1", def: character({ name: "Z1", strength: 3, life: 3 }), owner: P2, zone: "play" },
      { key: "it", def: item({ name: "It" }), owner: P2, zone: "play" },
      { key: "dc", def: character({ name: "DC" }), owner: P2, zone: "discard" },
      { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
      { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" },
      ...bank("rage", o.rage ?? 4, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...spentResources(P1, o.spent ?? 0)
    ] as Cards
  });
}
type SkB = ReturnType<typeof skBoard>;
/** Plays the tactic on `picks`, answering the three role prompts in order with `roles` (keys). */
function skPlay(b: SkB, picks: string[], roles: string[]) {
  play(b.engine, P1, b.id("t"), { selected: { cs: picks.map(b.id) } });
  const queue = roles.map(b.id);
  drain(b.engine, (pc) => {
    if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [queue.shift()] };
    return declineAll(pc);
  });
}
const KEYS = ["x1", "x2", "y1"];
const perms: string[][] = [];
for (const a of KEYS) for (const b of KEYS) for (const c of KEYS) if (a !== b && b !== c && a !== c) perms.push([a, b, c]);

clause(SKIRMISH, "0:extraCost", "printed card: tactic, warlord, cost 4, threshold rr", () => {
  const p = printing(SKIRMISH);
  assert.equal(p.type, "tactic");
  assert.equal(p.trade, "warlord");
  assert.equal(p.cost, 4);
  assert.equal(p.threshold, "rr");
});
clause(SKIRMISH, "0:extraCost", "exactly the printed cost of 4 is paid; 6 banks leave 2; the tactic is used up", () => {
  const b = skBoard({ rage: 6 });
  skPlay(b, KEYS, ["x1", "x2", "y1"]);
  assert.equal(ready(b.engine), 2);
  assert.equal(zone(b.engine, b.id("t")), "discard");
});
clause(SKIRMISH, "0:extraCost", "one resource short of 4 is refused (3 ready + 2 spent rage), 4 ready works", () => {
  const short = skBoard({ rage: 3, spent: 2 });
  refused(() => play(short.engine, P1, short.id("t"), { selected: { cs: KEYS.map(short.id) } }), "3 ready for cost 4");
  assert.equal(zone(short.engine, short.id("t")), "hand");
  const ok = skBoard({ rage: 4, spent: 2 });
  skPlay(ok, KEYS, ["x1", "x2", "y1"]);
  assert.equal(ready(ok.engine), 0);
});
clause(SKIRMISH, "0:extraCost", "threshold rr: one rage short or none is refused even with 4 ready; rr + 2 greed works", () => {
  const one = skBoard({ rage: 1, greed: 3 });
  refused(() => play(one.engine, P1, one.id("t"), { selected: { cs: KEYS.map(one.id) } }), "one rage icon");
  const none = skBoard({ rage: 0, greed: 4 });
  refused(() => play(none.engine, P1, none.id("t"), { selected: { cs: KEYS.map(none.id) } }), "no rage icon");
  const ok = skBoard({ rage: 2, greed: 2 });
  skPlay(ok, KEYS, ["x1", "x2", "y1"]);
  assert.equal(zone(ok.engine, ok.id("t")), "discard");
  const spent = skBoard({ rage: 0, greed: 4, spent: 2 });
  skPlay(spent, KEYS, ["x1", "x2", "y1"]);
  assert.equal(zone(spent.engine, spent.id("t")), "discard", "spent rage icons count toward the threshold");
});
clause(SKIRMISH, "0:extraCost", "picks exactly 3 characters, of either player: any mix of mine and theirs is accepted", () => {
  const a = skBoard();
  skPlay(a, ["x1", "y1", "z1"], ["x1", "y1", "z1"]);
  assert.equal(zone(a.engine, a.id("t")), "discard");
  const b = skBoard();
  skPlay(b, ["x1", "x2", "z1"], ["z1", "x2", "x1"]);
  assert.equal(zone(b.engine, b.id("t")), "discard");
});
clause(SKIRMISH, "0:extraCost", "fewer than 3, more than 3, an item, a discarded character or no pick are refused; nothing is paid", () => {
  const cases: Array<[string, string[]]> = [
    ["two characters", ["x1", "x2"]],
    ["four characters", ["x1", "x2", "y1", "z1"]],
    ["an item in the trio", ["x1", "x2", "it"]],
    ["a discarded character in the trio", ["x1", "x2", "dc"]],
    ["none", []]
  ];
  for (const [why, picks] of cases) {
    const b = skBoard();
    refused(() => play(b.engine, P1, b.id("t"), { selected: { cs: picks.map(b.id) } }), why);
    assert.equal(zone(b.engine, b.id("t")), "hand", why);
    assert.equal(ready(b.engine), 4, `${why}: nothing paid`);
  }
  const dup = skBoard();
  refused(() => play(dup.engine, P1, dup.id("t"), { selected: { cs: [dup.id("x1"), dup.id("x1"), dup.id("x2")] } }), "the same character twice");
});
clause(SKIRMISH, "0:extraCost", "with only two characters in play the tactic cannot be played", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "t", def: printing(SKIRMISH), owner: P1, zone: "hand" },
      { key: "x1", def: character({ name: "X1" }), owner: P1, zone: "play" },
      { key: "y1", def: character({ name: "Y1" }), owner: P2, zone: "play" },
      ...bank("rage", 4, P1)
    ] as Cards
  });
  refused(() => play(b.engine, P1, b.id("t"), { selected: { cs: [b.id("x1"), b.id("y1")] } }), "only two characters");
});

for (const [d, h, s] of perms) {
  clause(SKIRMISH, "1:rule", `roles ${d} depleted / ${h} damaged 1 / ${s} gets +2 strength; others untouched; draws 1`, () => {
    const b = skBoard();
    const handBefore = b.engine.state.players[P1].hand.length;
    const top = b.engine.state.players[P1].deck[0];
    skPlay(b, KEYS, [d, h, s]);
    assert.equal(b.engine.state.pendingChoice, undefined);
    for (const k of KEYS) {
      assert.equal(b.engine.state.cards[b.id(k)].depleted, k === d, `${k} depleted`);
      assert.equal(dmg(b.engine, b.id(k)), k === h ? 1 : 0, `${k} damage`);
      assert.equal(b.engine.getStat(b.id(k), "strength"), k === s ? 5 : 3, `${k} strength`);
      assert.equal(zone(b.engine, b.id(k)), "play");
    }
    assert.equal(b.engine.state.cards[b.id("z1")].depleted, false, "unpicked untouched");
    assert.equal(b.engine.getStat(b.id("z1"), "strength"), 3);
    assert.equal(dmg(b.engine, b.id("z1")), 0);
    assert.equal(b.engine.state.players[P1].hand.length, handBefore - 1 + 1, "tactic left hand, one card drawn");
    assert.equal(b.engine.state.players[P1].hand.includes(top), true, "the top card was drawn");
  });
}
clause(SKIRMISH, "1:rule", "the same character cannot fill two roles (deplete one, damage ANOTHER, the REMAINING one)", () => {
  const b = skBoard();
  play(b.engine, P1, b.id("t"), { selected: { cs: KEYS.map(b.id) } });
  const seen: string[] = [];
  let guard = 0;
  while (b.engine.state.pendingChoice && guard++ < 10) {
    const pc = b.engine.state.pendingChoice as unknown as { kind: string; playerId: string };
    if (pc.kind !== "chooserSelectsTarget") { drain(b.engine, declineAll); break; }
    seen.push("p");
    // always pick x1 again
    try {
      b.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsTarget", selected: [b.id("x1")] } } as never);
    } catch { seen.push("refused"); break; }
  }
  const x1 = b.engine.state.cards[b.id("x1")];
  const roles = (x1.depleted ? 1 : 0) + (dmg(b.engine, b.id("x1")) > 0 ? 1 : 0) + (b.engine.getStat(b.id("x1"), "strength") > 3 ? 1 : 0);
  assert.ok(seen.includes("refused") || roles <= 1, `x1 filled ${roles} roles`);
});
clause(SKIRMISH, "1:rule", "damage 1 destroys a life-1 character (to the discard pile) and the other roles still resolve", () => {
  const b = skBoard({ y1Life: 1 });
  skPlay(b, KEYS, ["x1", "y1", "x2"]);
  assert.equal(zone(b.engine, b.id("y1")), "discard");
  assert.equal(b.engine.state.cards[b.id("x1")].depleted, true);
  assert.equal(b.engine.getStat(b.id("x2"), "strength"), 5);
});
clause(SKIRMISH, "1:rule", "'this turn': +2 strength is gone after the turn ends; the damage and depleted state follow normal rules", () => {
  const b = skBoard();
  skPlay(b, KEYS, ["x1", "x2", "y1"]);
  assert.equal(b.engine.getStat(b.id("y1"), "strength"), 5);
  endTurn(b.engine, P1);
  assert.equal(b.engine.getStat(b.id("y1"), "strength"), 3);
});

// ============================================================================
// Mass Confusion -- tactic, warlord, cost 0, [R][R]
// EXTRA COST: Choose a number for X. Pay X. Pick a player. Pick X characters that player controls.
// Inflict Y damage divided however you want to the characters, where Y is the number of characters that player controls minus the number of characters you control.
// ============================================================================
const CONFUSION = "da25a463-78da-4428-8d6b-eab6a76ade7c";
function mcBoard(o: { opp?: number; mine?: number; rage?: number; greed?: number; spent?: number; life?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: () => 0.3,
    cards: [
      { key: "t", def: printing(CONFUSION), owner: P1, zone: "hand" },
      ...Array.from({ length: o.opp ?? 4 }, (_, i) => ({ key: `o${i}`, def: character({ name: `O${i}`, life: o.life ?? 6 }), owner: P2, zone: "play" as const })),
      ...Array.from({ length: o.mine ?? 1 }, (_, i) => ({ key: `m${i}`, def: character({ name: `M${i}`, life: o.life ?? 6 }), owner: P1, zone: "play" as const })),
      { key: "oit", def: item({ name: "OIt" }), owner: P2, zone: "play" },
      ...bank("rage", o.rage ?? 4, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...spentResources(P1, o.spent ?? 0)
    ] as Cards
  });
}
type McB = ReturnType<typeof mcBoard>;
/** Plays with X, picking `picks`; the division `shares` (key -> n) is given when a distributeAmong prompt appears. */
/** The selections for Mass Confusion: "Pick a player" (`pl`, a faction -- the opponent unless `who` says otherwise) and the characters (`cs`). */
const mcSel = (b: McB, picks: string[], who: P = P2) => ({ pl: [factionOf(b.engine, who)], cs: picks.map(b.id) });
function mcPlay(b: McB, x: number, picks: string[], shares: Record<string, number> = {}) {
  play(b.engine, P1, b.id("t"), { selected: mcSel(b, picks, picks[0]?.startsWith("m") ? P1 : P2), variables: { x } });
  const mapped: Record<string, number> = {};
  for (const [k, n] of Object.entries(shares)) mapped[b.id(k)] = n;
  let seen: number | undefined;
  drain(b.engine, (pc) => {
    if (pc.kind === "distributeAmong") { seen = pc.amount as number; return { kind: "distributeAmong", shares: mapped }; }
    return declineAll(pc);
  });
  return seen;
}
const damages = (b: McB, keys: string[]) => keys.map((k) => dmg(b.engine, b.id(k)));

clause(CONFUSION, "0:extraCost", "printed card: tactic, warlord, cost 0, threshold rr", () => {
  const p = printing(CONFUSION);
  assert.equal(p.type, "tactic");
  assert.equal(p.trade, "warlord");
  assert.equal(p.cost, 0);
  assert.equal(p.threshold, "rr");
});
clause(CONFUSION, "0:extraCost", "printed cost 0: with X = 0 nothing is paid and the tactic is used up", () => {
  const b = mcBoard({ rage: 2 });
  mcPlay(b, 0, []);
  assert.equal(ready(b.engine), 2, "no resources paid");
  assert.equal(zone(b.engine, b.id("t")), "discard");
  assert.deepEqual(damages(b, ["o0", "o1", "o2", "o3", "m0"]), [0, 0, 0, 0, 0]);
});
clause(CONFUSION, "0:extraCost", "threshold rr: one rage or none is refused even for X = 0; spent rage icons count", () => {
  const one = mcBoard({ rage: 1, greed: 3 });
  refused(() => play(one.engine, P1, one.id("t"), { selected: mcSel(one, []), variables: { x: 0 } }), "one rage icon");
  const none = mcBoard({ rage: 0, greed: 3 });
  refused(() => play(none.engine, P1, none.id("t"), { selected: mcSel(none, []), variables: { x: 0 } }), "no rage icon");
  const ok = mcBoard({ rage: 2, greed: 1 });
  mcPlay(ok, 0, []);
  assert.equal(zone(ok.engine, ok.id("t")), "discard");
  const sp = mcBoard({ rage: 0, greed: 1, spent: 2 });
  mcPlay(sp, 0, []);
  assert.equal(zone(sp.engine, sp.id("t")), "discard");
});
for (const x of [1, 2, 3]) {
  clause(CONFUSION, "0:extraCost", `X = ${x}: pays exactly ${x} (above the printed cost 0) and needs ${x} opposing characters picked`, () => {
    const b = mcBoard({ rage: 6 });
    const picks = ["o0", "o1", "o2"].slice(0, x);
    const shares: Record<string, number> = { [picks[0]]: 3 };
    mcPlay(b, x, picks, shares);
    assert.equal(ready(b.engine), 6 - x, `X=${x} paid`);
    assert.equal(zone(b.engine, b.id("t")), "discard");
  });
}
clause(CONFUSION, "0:extraCost", "X resources must be affordable: X = 5 with 4 ready is refused, X = 4 works", () => {
  const b = mcBoard({ rage: 4, opp: 5 });
  refused(() => play(b.engine, P1, b.id("t"), { selected: mcSel(b, ["o0", "o1", "o2", "o3", "o4"]), variables: { x: 5 } }), "cannot pay 5");
  const ok = mcBoard({ rage: 4, opp: 5 });
  mcPlay(ok, 4, ["o0", "o1", "o2", "o3"], { o0: 4 });
  assert.equal(ready(ok.engine), 0);
});
clause(CONFUSION, "0:extraCost", "X must be a non-negative whole number", () => {
  const neg = mcBoard();
  refused(() => play(neg.engine, P1, neg.id("t"), { selected: mcSel(neg, []), variables: { x: -1 } }), "negative X");
  const frac = mcBoard();
  refused(() => play(frac.engine, P1, frac.id("t"), { selected: mcSel(frac, ["o0"]), variables: { x: 0.5 } }), "fractional X");
});
clause(CONFUSION, "0:extraCost", "exactly X characters must be picked: too few or too many is refused", () => {
  const few = mcBoard();
  refused(() => play(few.engine, P1, few.id("t"), { selected: mcSel(few, ["o0"]), variables: { x: 2 } }), "1 pick for X=2");
  const many = mcBoard();
  refused(() => play(many.engine, P1, many.id("t"), { selected: mcSel(many, ["o0", "o1"]), variables: { x: 1 } }), "2 picks for X=1");
  const none = mcBoard();
  refused(() => play(none.engine, P1, none.id("t"), { selected: mcSel(none, []), variables: { x: 1 } }), "0 picks for X=1");
  assert.equal(ready(none.engine), 4);
});
clause(CONFUSION, "0:extraCost", "the picked characters are the player's characters in play: an item or a card in hand is refused", () => {
  const it = mcBoard();
  refused(() => play(it.engine, P1, it.id("t"), { selected: mcSel(it, ["oit"]), variables: { x: 1 } }), "an item is not a character");
  const same = mcBoard();
  refused(() => play(same.engine, P1, same.id("t"), { selected: mcSel(same, ["o0", "o0"]), variables: { x: 2 } }), "the same character twice");
});
clause(CONFUSION, "0:extraCost", "'Pick a player': the player may be me; my own characters can be picked (Y = 0)", () => {
  const b = mcBoard({ mine: 3 });
  mcPlay(b, 1, ["m0"], {});
  assert.equal(zone(b.engine, b.id("t")), "discard", "own character pick accepted");
  assert.deepEqual(damages(b, ["m0", "m1", "m2"]), [0, 0, 0], "Y = 3 - 3 = 0");
});

clause(CONFUSION, "1:rule", "Y = 4 - 1 = 3 divided among 2 picked: 3/0, 2/1, 1/2 and 0/3 all work; unpicked and mine take nothing", () => {
  for (const [a, c] of [[3, 0], [2, 1], [1, 2], [0, 3]]) {
    const b = mcBoard();
    assert.equal(mcPlay(b, 2, ["o0", "o1"], { o0: a, o1: c }), 3, "Y = 4 - 1 to divide");
    assert.deepEqual(damages(b, ["o0", "o1", "o2", "o3", "m0"]), [a, c, 0, 0, 0], `${a}/${c}`);
    assert.equal(b.engine.state.pendingChoice, undefined);
  }
});
clause(CONFUSION, "1:rule", "Y counts ALL characters each side controls, not only the picked: opp 5 vs mine 2 -> Y = 3 on 1 pick", () => {
  const b = mcBoard({ opp: 5, mine: 2 });
  assert.equal(mcPlay(b, 1, ["o4"], { o4: 3 }), 3, "Y = 5 - 2");
  assert.equal(dmg(b.engine, b.id("o4")), 3);
});
clause(CONFUSION, "1:rule", "Y changes with the board: opp 3 vs mine 0 -> 3; opp 6 vs mine 1 -> 5", () => {
  const a = mcBoard({ opp: 3, mine: 0 });
  assert.equal(mcPlay(a, 1, ["o0"], { o0: 3 }), 3, "Y = 3 - 0");
  assert.equal(dmg(a.engine, a.id("o0")), 3);
  const b = mcBoard({ opp: 6, mine: 1 });
  assert.equal(mcPlay(b, 2, ["o0", "o1"], { o0: 2, o1: 3 }), 5, "Y = 6 - 1");
  assert.deepEqual(damages(b, ["o0", "o1"]), [2, 3]);
});
clause(CONFUSION, "1:rule", "a share that does not add up to Y is refused (cannot under- or over-divide)", () => {
  const under = mcBoard();
  play(under.engine, P1, under.id("t"), { selected: mcSel(under, ["o0", "o1"]), variables: { x: 2 } });
  const pc = under.engine.state.pendingChoice as unknown as { kind: string; playerId: string } | undefined;
  assert.equal(pc?.kind, "distributeAmong");
  refused(() => under.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares: { [under.id("o0")]: 1, [under.id("o1")]: 1 } } } as never), "2 of 3 divided");
  refused(() => under.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares: { [under.id("o0")]: 3, [under.id("o1")]: 1 } } } as never), "4 of 3 divided");
  refused(() => under.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares: { [under.id("o0")]: 4, [under.id("o1")]: -1 } } } as never), "negative share");
  assert.deepEqual(damages(under, ["o0", "o1"]), [0, 0]);
});
clause(CONFUSION, "1:rule", "I choose the division (the controller is asked)", () => {
  const b = mcBoard();
  play(b.engine, P1, b.id("t"), { selected: mcSel(b, ["o0", "o1"]), variables: { x: 2 } });
  const pc = b.engine.state.pendingChoice as unknown as { kind: string; playerId: string };
  assert.equal(pc.kind, "distributeAmong");
  assert.equal(pc.playerId, P1);
});
clause(CONFUSION, "1:rule", "Y = 0 (equal numbers): no damage at all; Y negative (fewer opposing characters): no damage, nothing healed", () => {
  const eq = mcBoard({ opp: 2, mine: 2 });
  const amtEq = mcPlay(eq, 1, ["o0"], { o0: 0 });
  assert.ok((amtEq ?? 0) <= 0, "Y = 0: nothing to divide");
  assert.deepEqual(damages(eq, ["o0", "o1", "m0", "m1"]), [0, 0, 0, 0]);
  const neg = mcBoard({ opp: 1, mine: 3 });
  neg.engine.state.cards[neg.id("o0")].damage = 2;
  const amtNeg = mcPlay(neg, 1, ["o0"], { o0: 0 });
  assert.ok((amtNeg ?? 0) <= 0, "Y negative: nothing to divide");
  assert.equal(dmg(neg.engine, neg.id("o0")), 2, "no healing, no negative damage");
  assert.equal(zone(neg.engine, neg.id("t")), "discard");
});
clause(CONFUSION, "1:rule", "damage destroys a character whose life it reaches; the rest survive", () => {
  const b = mcBoard({ life: 2 });
  mcPlay(b, 2, ["o0", "o1"], { o0: 2, o1: 1 });
  assert.equal(zone(b.engine, b.id("o0")), "discard");
  assert.equal(zone(b.engine, b.id("o1")), "play");
  assert.equal(dmg(b.engine, b.id("o1")), 1);
});
clause(CONFUSION, "1:rule", "damage adds to damage already marked", () => {
  const b = mcBoard();
  b.engine.state.cards[b.id("o0")].damage = 1;
  mcPlay(b, 1, ["o0"], { o0: 3 });
  assert.equal(dmg(b.engine, b.id("o0")), 4);
});

// ============================================================================
// Necromantic Healer -- character, warlord, sorceress, cost 2, [R], 1/1/3
// When battle damage is inflicted to a character in a party with this card, reduce the amount by 1. (This includes this character.)
// ============================================================================
const HEALER = "12a2d154-da7d-4eab-8934-7083116bec83";
type Split = (s: { cardId: string; legalTargets: unknown[]; strength: number }) => Array<{ sourceId: string; target: unknown; amount: number }>;
function healBoard(o: { turn?: P; healers?: number; healerZone?: "play" | "discard"; foeHealer?: boolean; defend?: boolean } = {}) {
  const active = o.turn ?? P1;
  const foe = active === P1 ? P2 : P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: 3,
    random: () => 0.3,
    cards: [
      ...Array.from({ length: o.healers ?? 1 }, (_, i) => ({ key: `h${i}`, def: printing(HEALER), owner: o.defend ? foe : active, zone: o.healerZone ?? ("play" as const) })),
      { key: "al", def: character({ name: "Ally", strength: 1, life: 6, speed: 1 }), owner: o.defend ? foe : active, zone: "play" },
      { key: "plain", def: character({ name: "Plain", strength: 1, life: 3, speed: 1 }), owner: o.defend ? foe : active, zone: "play" },
      { key: "bk", def: character({ name: "Brute", strength: 3, life: 20, speed: 1 }), owner: o.defend ? active : foe, zone: "play" },
      { key: "bk2", def: character({ name: "Brute2", strength: 1, life: 20, speed: 1 }), owner: o.defend ? active : foe, zone: "play" },
      ...(o.foeHealer ? [{ key: "fh", def: printing(HEALER), owner: foe, zone: "play" as const }] : []),
      ...bank("rage", 2, P1)
    ] as Cards
  });
}
const fightWith = (b: ReturnType<typeof healBoard>, attackers: string[], blockers: string[], split?: Split) => {
  const att = b.engine.state.activePlayerId as P;
  const def = att === P1 ? P2 : P1;
  fightThrough(b.engine, att, attackers.map(b.id), { type: "faction", playerId: def }, blockers.map(b.id), split as never);
};
const onto = (b: ReturnType<typeof healBoard>, from: string, to: Record<string, number>): Split => (s) =>
  s.cardId === b.id(from)
    ? Object.entries(to).map(([k, n]) => ({ sourceId: s.cardId, target: { type: "card" as const, cardId: b.id(k) }, amount: n }))
    : s.legalTargets.length > 0 && s.strength > 0
      ? [{ sourceId: s.cardId, target: s.legalTargets[0], amount: s.strength }]
      : [];

clause(HEALER, "0:rule", "printed card: character, warlord, sorceress, cost 2, [R], strength 1 / speed 1 / life 3", () => {
  const b = healBoard();
  const p = printing(HEALER);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "warlord");
  assert.ok((p.subtype as string[]).includes("sorceress"), "(p.subtype as string[]).includes(\"sorceress\")");
  assert.equal(p.cost, 2);
  assert.equal(p.threshold, "r");
  assert.equal(b.engine.getStat(b.id("h0"), "strength"), 1);
  assert.equal(b.engine.getStat(b.id("h0"), "speed"), 1);
  assert.equal(b.engine.getStat(b.id("h0"), "life"), 3);
});
clause(HEALER, "0:rule", "deploys for exactly 2 with one rage; one resource short or no rage is refused", () => {
  const mk = (rage: number, greed: number, spent = 0) => buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "h", def: printing(HEALER), owner: P1, zone: "hand" }, ...bank("rage", rage, P1), ...bank("greed", greed, P1), ...spentResources(P1, spent)] as Cards
  });
  const ok = mk(2, 0);
  play(ok.engine, P1, ok.id("h"));
  drain(ok.engine, declineAll);
  assert.equal(zone(ok.engine, ok.id("h")), "play");
  assert.equal(ready(ok.engine), 0, "cost 2 paid");
  const mixed = mk(1, 1);
  play(mixed.engine, P1, mixed.id("h"));
  assert.equal(zone(mixed.engine, mixed.id("h")), "play", "one rage is enough for the threshold");
  const short = mk(1, 0, 1);
  refused(() => play(short.engine, short.engine.state.players[P1].hand.length ? P1 : P1, short.id("h")), "1 ready for cost 2");
  const noRage = mk(0, 2);
  refused(() => play(noRage.engine, P1, noRage.id("h")), "no rage icon");
});
clause(HEALER, "0:rule", "healer alone in a party: 3 battle damage becomes 2 and it survives (control: a 3-life character without it dies)", () => {
  const b = healBoard();
  fightWith(b, ["h0"], ["bk"]);
  assert.equal(dmg(b.engine, b.id("h0")), 2);
  assert.equal(zone(b.engine, b.id("h0")), "play");
  const c = healBoard();
  fightWith(c, ["plain"], ["bk"]);
  assert.equal(zone(c.engine, c.id("plain")), "discard", "control: unprotected 3-life dies to 3");
});
clause(HEALER, "0:rule", "(This includes this character) 1 battle damage to the healer itself becomes 0", () => {
  const b = healBoard();
  fightWith(b, ["h0"], ["bk2"]);
  assert.equal(dmg(b.engine, b.id("h0")), 0);
});
clause(HEALER, "0:rule", "another character in a party with the healer (attacking together) takes 1 less: 3 -> 2", () => {
  const b = healBoard();
  fightWith(b, ["h0", "al"], ["bk"], onto(b, "bk", { al: 3 }));
  assert.equal(dmg(b.engine, b.id("al")), 2);
  assert.equal(dmg(b.engine, b.id("h0")), 0);
});
clause(HEALER, "0:rule", "each damage instance is reduced by 1 separately: 3 split 1 to the healer and 2 to the ally -> 0 and 1", () => {
  const b = healBoard();
  fightWith(b, ["h0", "al"], ["bk"], onto(b, "bk", { h0: 1, al: 2 }));
  assert.equal(dmg(b.engine, b.id("h0")), 0);
  assert.equal(dmg(b.engine, b.id("al")), 1);
});
clause(HEALER, "0:rule", "also works for a blocking party: the healer and an ally block together, damage to the ally is reduced", () => {
  const b = healBoard({ defend: true });
  fightWith(b, ["bk"], ["h0", "al"], onto(b, "bk", { al: 3 }));
  assert.equal(dmg(b.engine, b.id("al")), 2);
});
clause(HEALER, "0:rule", "a character NOT in a party with the healer takes full damage (healer idle at home)", () => {
  const b = healBoard();
  fightWith(b, ["al"], ["bk"]);
  assert.equal(dmg(b.engine, b.id("al")), 3);
  assert.equal(dmg(b.engine, b.id("h0")), 0);
});
clause(HEALER, "0:rule", "the opposing characters in the battle are not in the healer's party: they take full damage", () => {
  const b = healBoard();
  fightWith(b, ["h0"], ["bk"]);
  assert.equal(dmg(b.engine, b.id("bk")), 1, "healer deals its printed 1 to the blocker");
});
clause(HEALER, "0:rule", "an opposing healer protects only its own party (the blocker with it takes less, my attacker takes full)", () => {
  const b = healBoard({ foeHealer: true });
  fightWith(b, ["al"], ["bk", "fh"], onto(b, "al", { bk: 1 }));
  assert.equal(dmg(b.engine, b.id("bk")), 0, "bk is in a party with the opposing healer: 1 -> 0");
  assert.equal(dmg(b.engine, b.id("al")), 4, "my attacker is not in that party: Brute 3 + healer 1, no reduction");
});
clause(HEALER, "0:rule", "two healers in one party stack: 3 damage to the ally -> 1", () => {
  const b = healBoard({ healers: 2 });
  fightWith(b, ["h0", "h1", "al"], ["bk"], onto(b, "bk", { al: 3 }));
  assert.equal(dmg(b.engine, b.id("al")), 1);
});
clause(HEALER, "0:rule", "a healer that is not in play does nothing (it is in the discard pile)", () => {
  const b = healBoard({ healerZone: "discard" });
  fightWith(b, ["al"], ["bk"]);
  assert.equal(dmg(b.engine, b.id("al")), 3);
});
for (const victim of ["h0", "pinger"]) {
  clause(HEALER, "0:rule", `only battle damage is reduced: ability damage to party member ${victim} during the battle is not`, () => {
    const b = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "h0", def: printing(HEALER), owner: P1, zone: "play" },
        { key: "pinger", def: character({ name: "Pinger", strength: 1, life: 5, speed: 1, ...({ behavior: PING } as object) }), owner: P1, zone: "play" },
        { key: "bk", def: character({ name: "Brute", strength: 1, life: 20, speed: 1 }), owner: P2, zone: "play" }
      ] as Cards
    });
    declareAttackBy(b.engine, P1, [b.id("h0"), b.id("pinger")]);
    b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("bk")] } as never);
    activate(b.engine, P1, b.id("pinger"), "ping", { selected: { tg: [b.id(victim)] } });
    assert.equal(dmg(b.engine, b.id(victim)), 1, "ability damage is not reduced");
  });
}
clause(HEALER, "0:rule", "only battle damage is reduced: ability damage to the healer is not", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "h0", def: printing(HEALER), owner: P1, zone: "play" },
      { key: "pinger", def: character({ name: "Pinger", strength: 1, life: 5, ...({ behavior: PING } as object) }), owner: P1, zone: "play" }
    ] as Cards
  });
  activate(b.engine, P1, b.id("pinger"), "ping", { selected: { tg: [b.id("h0")] } });
  assert.equal(dmg(b.engine, b.id("h0")), 1);
});

// ============================================================================
// Perforate -- tactic, warlord, cost 2, [R][R]
// EXTRA COST: Choose a number for X. Pay X. Pick a character. -- Inflict X damage to the character.
// ============================================================================
const PERFORATE = "99b26c1c-d69b-4e98-913b-3fa8a4683184";
function pfBoard(o: { rage?: number; greed?: number; spent?: number; life?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: () => 0.3,
    cards: [
      { key: "t", def: printing(PERFORATE), owner: P1, zone: "hand" },
      { key: "oc", def: character({ name: "OC", life: o.life ?? 5 }), owner: P2, zone: "play" },
      { key: "ob", def: character({ name: "OB", life: 5 }), owner: P2, zone: "play" },
      { key: "mc", def: character({ name: "MC", life: o.life ?? 5 }), owner: P1, zone: "play" },
      { key: "it", def: item({ name: "It" }), owner: P2, zone: "play" },
      { key: "dc", def: character({ name: "DC" }), owner: P2, zone: "discard" },
      ...bank("rage", o.rage ?? 8, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...spentResources(P1, o.spent ?? 0)
    ] as Cards
  });
}
type PfB = ReturnType<typeof pfBoard>;
const pf = (b: PfB, x: number, key = "oc") => {
  play(b.engine, P1, b.id("t"), { selected: { c: [b.id(key)] }, variables: { x } });
  drain(b.engine, declineAll);
};
clause(PERFORATE, "0:extraCost", "printed card: tactic, warlord, cost 2, threshold rr", () => {
  const p = printing(PERFORATE);
  assert.equal(p.type, "tactic");
  assert.equal(p.trade, "warlord");
  assert.equal(p.cost, 2);
  assert.equal(p.threshold, "rr");
});
clause(PERFORATE, "0:extraCost", "X = 0 pays exactly the printed 2; the tactic is used up", () => {
  const b = pfBoard({ rage: 2 });
  pf(b, 0);
  assert.equal(ready(b.engine), 0);
  assert.equal(zone(b.engine, b.id("t")), "discard");
});
for (const x of [1, 2, 4]) {
  clause(PERFORATE, "0:extraCost", `X = ${x}: pays 2 + ${x} = ${2 + x}`, () => {
    const b = pfBoard({ rage: 8 });
    pf(b, x);
    assert.equal(ready(b.engine), 8 - 2 - x);
  });
}
clause(PERFORATE, "0:extraCost", "one short of 2 + X is refused (spent rage keeps the threshold met); exact works", () => {
  const short = pfBoard({ spent: 2, rage: 3 });
  refused(() => play(short.engine, P1, short.id("t"), { selected: { c: [short.id("oc")] }, variables: { x: 2 } }), "3 ready for 2 + 2");
  assert.equal(zone(short.engine, short.id("t")), "hand");
  assert.equal(dmg(short.engine, short.id("oc")), 0);
  const ok = pfBoard({ spent: 2, rage: 4 });
  pf(ok, 2);
  assert.equal(dmg(ok.engine, ok.id("oc")), 2);
  assert.equal(ready(ok.engine), 0);
  const base = pfBoard({ spent: 2, rage: 1 });
  refused(() => play(base.engine, P1, base.id("t"), { selected: { c: [base.id("oc")] }, variables: { x: 0 } }), "1 ready for printed cost 2");
});
clause(PERFORATE, "0:extraCost", "threshold rr: one rage short or none is refused even with plenty of resources; spent rage counts", () => {
  const one = pfBoard({ rage: 1, greed: 7 });
  refused(() => play(one.engine, P1, one.id("t"), { selected: { c: [one.id("oc")] }, variables: { x: 1 } }), "one rage icon");
  const none = pfBoard({ rage: 0, greed: 8 });
  refused(() => play(none.engine, P1, none.id("t"), { selected: { c: [none.id("oc")] }, variables: { x: 1 } }), "no rage icon");
  const ok = pfBoard({ rage: 2, greed: 2 });
  pf(ok, 1);
  assert.equal(dmg(ok.engine, ok.id("oc")), 1);
  const sp = pfBoard({ rage: 0, greed: 3, spent: 2 });
  pf(sp, 1);
  assert.equal(dmg(sp.engine, sp.id("oc")), 1);
});
clause(PERFORATE, "0:extraCost", "X must be a non-negative whole number: negative and fractional are refused", () => {
  const neg = pfBoard();
  refused(() => play(neg.engine, P1, neg.id("t"), { selected: { c: [neg.id("oc")] }, variables: { x: -1 } }), "negative X");
  assert.equal(dmg(neg.engine, neg.id("oc")), 0);
  const frac = pfBoard();
  refused(() => play(frac.engine, P1, frac.id("t"), { selected: { c: [frac.id("oc")] }, variables: { x: 1.5 } }), "fractional X");
  assert.equal(ready(frac.engine), 8);
});
clause(PERFORATE, "0:extraCost", "pick a character: either player's character; an item, a discarded character, none or two are refused", () => {
  const mine = pfBoard();
  pf(mine, 2, "mc");
  assert.equal(dmg(mine.engine, mine.id("mc")), 2);
  const it = pfBoard();
  refused(() => play(it.engine, P1, it.id("t"), { selected: { c: [it.id("it")] }, variables: { x: 1 } }), "an item");
  const dc = pfBoard();
  refused(() => play(dc.engine, P1, dc.id("t"), { selected: { c: [dc.id("dc")] }, variables: { x: 1 } }), "discarded character");
  const none = pfBoard();
  refused(() => play(none.engine, P1, none.id("t"), { selected: { c: [] }, variables: { x: 1 } }), "no pick");
  const two = pfBoard();
  refused(() => play(two.engine, P1, two.id("t"), { selected: { c: [two.id("oc"), two.id("ob")] }, variables: { x: 1 } }), "two picks");
  assert.equal(ready(two.engine), 8);
});
clause(PERFORATE, "0:extraCost", "X is paid when the tactic is played (costs are already gone while it waits to resolve)", () => {
  const b = pfBoard({ rage: 6 });
  playRaw(b.engine, P1, b.id("t"), { selected: { c: [b.id("oc")] }, variables: { x: 3 } });
  assert.equal(ready(b.engine), 1, "2 + 3 paid up front");
  assert.equal(b.engine.state.cards[b.id("t")].zone === "hand", false);
});
for (const x of [0, 1, 3, 4]) {
  clause(PERFORATE, "1:rule", `X = ${x}: inflicts exactly ${x} damage to the picked character, nothing to others`, () => {
    const b = pfBoard();
    pf(b, x);
    assert.equal(dmg(b.engine, b.id("oc")), x);
    assert.equal(zone(b.engine, b.id("oc")), "play");
    assert.equal(dmg(b.engine, b.id("ob")), 0);
    assert.equal(dmg(b.engine, b.id("mc")), 0);
  });
}
clause(PERFORATE, "1:rule", "X equal to the life destroys it; X one below life leaves it alive", () => {
  const dead = pfBoard();
  pf(dead, 5);
  assert.equal(zone(dead.engine, dead.id("oc")), "discard");
  const alive = pfBoard();
  pf(alive, 4);
  assert.equal(zone(alive.engine, alive.id("oc")), "play");
  const big = pfBoard();
  pf(big, 6);
  assert.equal(zone(big.engine, big.id("oc")), "discard");
});
clause(PERFORATE, "1:rule", "damage adds to damage already marked, and my own picked character takes it too", () => {
  const b = pfBoard();
  b.engine.state.cards[b.id("oc")].damage = 2;
  pf(b, 2);
  assert.equal(dmg(b.engine, b.id("oc")), 4);
  const m = pfBoard();
  pf(m, 5, "mc");
  assert.equal(zone(m.engine, m.id("mc")), "discard");
});

void tryAct;
void fight;
