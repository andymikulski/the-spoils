import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  bank,
  character,
  developFaction,
  item,
  play,
  resourceCard,
  tactic,
  P1,
  P2
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, drain, printing, refused, flipUpNow } from "./_clause.js";
import { declareAttackOpenWindow, fightThrough, finishBattle } from "./_battle.js";
import { declareBlockers, fillers, pending, zoneOf } from "./_board.js";
import { endTurn } from "./_turn.js";

const ABRAM = "01df169f-77e2-4b6e-bb7c-cf0b7c84d6e9"; // Abram Ka-darbo Alakazin
const ALLEY = "cda94ae8-2baa-4b34-8ef4-f1df6554daf9"; // Apparition Alley
const URCHIN = "a138d554-4fdb-4234-9362-d120f7b13bd2"; // Camouflaged Urchin
const SKULL = "4897e844-426b-4333-bc8b-3377d4ff6339"; // Candy Skull Commander
const FUNHOUSE = "b58eb946-a9fe-4661-bc06-c4607cc448cd"; // Carnival Funhouse
const WHIP = "2f3399c9-e12b-423d-88e7-e23850939fab"; // Carnival Whipmaster

type Cards = CardPlacement[];
type Icon = "rage" | "greed" | "deception" | "elitism" | "obsession";
const factionKey = (owner: string) => (owner === P1 ? "__factionA" : "__factionB");
/** `n` already-spent (attached to the faction) resources: they count toward a threshold but cannot pay. */
const spent = (icon: Icon, n: number, owner: string = P1): Cards =>
  bank(icon, n, owner as never).map((p) => ({ ...p, attachedToKey: factionKey(owner) }));
const rdy = (e: { getAvailableResourceCount: (p: never) => number }, p: string = P1) => e.getAvailableResourceCount(p as never);
const res = (key: string, icon: string, trade: string, owner: string = P1, staple = true): CardPlacement => ({
  key,
  def: resourceCard({ id: `p2-res-${key}`, name: `Res ${key}`, trade, resource: { provides: [icon], staple } } as never),
  owner: owner as never,
  zone: "play"
});
const mayAnswer = (pay: boolean) => (pc: { kind: string; [k: string]: unknown }) =>
  pc.kind === "mayPay" ? { kind: "mayPay", pay } : { kind: "chooserSelectsOption", index: 0 };

// --- generic printed cost / threshold / stats checks (one body per printing) ---------------------------------
const deployBoard = (id: string, extra: Cards, hand = true) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "c", def: printing(id), owner: P1, zone: hand ? "hand" : "play" }, ...extra]
  });
type Sel = Record<string, string[]> | undefined;
const mapSel = (sel: Sel, idOf: (k: string) => string) =>
  sel ? { selected: Object.fromEntries(Object.entries(sel).map(([k, v]) => [k, v.map((x) => idOf(x))])) } : {};
const costExact = (id: string, cost: number, icon: Icon, n: number, extra: Cards = [], selected?: Sel) => () => {
  const g = deployBoard(id, [...spent(icon, n), ...bank("rage", cost, P1), ...extra]);
  play(g.engine, P1, g.id("c"), mapSel(selected, g.id));
  assert.notEqual(zoneOf(g.engine, g.id("c")), "hand", "deployed with exactly the printed cost");
  assert.equal(rdy(g.engine), 0, `exactly ${cost} was paid`);
};
const costShort = (id: string, cost: number, icon: Icon, n: number, extra: Cards = [], selected?: Sel) => () => {
  const g = deployBoard(id, [...spent(icon, n), ...bank("rage", cost - 1, P1), ...extra]);
  refused(() => play(g.engine, P1, g.id("c"), mapSel(selected, g.id)), `cost ${cost} with ${cost - 1} ready`);
  assert.equal(zoneOf(g.engine, g.id("c")), "hand");
};
const thrShort = (id: string, cost: number, icon: Icon, n: number, extra: Cards = [], selected?: Sel) => () => {
  const g = deployBoard(id, [...spent(icon, n - 1), ...bank("rage", cost, P1), ...extra]);
  refused(() => play(g.engine, P1, g.id("c"), mapSel(selected, g.id)), `${n - 1} of ${n} threshold icons`);
  assert.equal(zoneOf(g.engine, g.id("c")), "hand");
};

// =====================================================================================================
// Abram Ka-darbo Alakazin
// =====================================================================================================
const abram = (o: { zone?: "hand" | "play"; banks?: Cards; extra?: Cards; random?: () => number; id?: string } = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: o.random,
    cards: [
      { key: "ab", def: printing(o.id ?? ABRAM), owner: P1, zone: o.zone ?? "play" },
      ...(o.banks ?? bank("rage", 8, P1)),
      ...(o.extra ?? [])
    ]
  });
type AB = ReturnType<typeof abram>;
const foeChar = (key = "foe", owner: string = P2): CardPlacement => ({ key, def: character({ name: key.toUpperCase(), strength: 2, life: 4, speed: 2 }), owner: owner as never, zone: "play" });
const vanish = (g: AB, target: string) => activate(g.engine, P1, g.id("ab"), "make-vanish", { selected: { c: [g.id(target)] } });
const reappear = (g: AB) => activate(g.engine, P1, g.id("ab"), "make-reappear", {});
// MAKE REAPPEAR asks its controller which voided character returns (a real pick, even with one candidate).
const pickReappear = (g: AB, key: string) =>
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [g.id(key)] } } as never);
const ready = (g: AB) => {
  g.engine.state.cards[g.id("ab")].depleted = false;
};

clause(ABRAM, "0:unique", "printed: rogue character pluck/performer/blade of questionable morality, cost 3, threshold dddd, str 1 / spd 4 / life 1, UNIQUE PLUCK", () => {
  const p = printing(ABRAM);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "rogue");
  assert.deepEqual(p.subtype, ["pluck", "performer", "blade of questionable morality"]);
  assert.equal(p.cost, 3);
  assert.equal(p.threshold, "dddd");
  assert.equal((p as unknown as { unique?: string }).unique, "pluck");
  const g = abram();
  assert.equal(g.engine.getStat(g.id("ab"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("ab"), "speed"), 4);
  assert.equal(g.engine.getStat(g.id("ab"), "life"), 1);
});

clause(ABRAM, "0:unique", "deploys for exactly 3 (4 deception icons, 3 paid), refused with 2 ready, refused with only 3 deception icons", () => {
  costExact(ABRAM, 3, "deception", 4)();
  costShort(ABRAM, 3, "deception", 4)();
  thrShort(ABRAM, 3, "deception", 4)();
  const g = abram({ zone: "hand", banks: bank("deception", 4, P1) });
  play(g.engine, P1, g.id("ab"));
  assert.equal(zoneOf(g.engine, g.id("ab")), "play");
  assert.equal(rdy(g.engine), 1);
});

clause(ABRAM, "0:unique", "UNIQUE PLUCK: a second PLUCK I control forces a survivor choice and destroys the loser", () => {
  const g = abram({ zone: "hand", banks: bank("deception", 4, P1), extra: [{ key: "ab2", def: printing(ABRAM), owner: P1, zone: "play" }] });
  play(g.engine, P1, g.id("ab"));
  const pc = pending(g.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [g.id("ab"), g.id("ab2")].sort());
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("ab") } } as never);
  assert.equal(zoneOf(g.engine, g.id("ab")), "play");
  assert.equal(zoneOf(g.engine, g.id("ab2")), "discard");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(ABRAM, "0:unique", "an opponent controlling a PLUCK does not trigger UNIQUE for me; neither does a non-PLUCK", () => {
  const g = abram({
    zone: "hand",
    banks: bank("deception", 4, P1),
    extra: [{ key: "ab2", def: printing(ABRAM), owner: P2, zone: "play" }, foeChar("mine", P1)]
  });
  play(g.engine, P1, g.id("ab"));
  assert.equal(g.engine.state.pendingChoice, undefined, "no survivor choice");
  assert.equal(zoneOf(g.engine, g.id("ab")), "play");
  assert.equal(zoneOf(g.engine, g.id("ab2")), "play");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play");
});

// FEALTY
const abramHand = (staples: Cards) => abram({ zone: "hand", banks: [], extra: staples });
clause(ABRAM, "1:fealty", "with 4 staple resources of 4 different trades one deception icon is enough for dddd (cost 3 still paid)", () => {
  const g = abramHand([res("fd", "deception", "rogue"), res("fr", "rage", "banker"), res("fg", "greed", "arcanist"), res("fo", "elitism", "warlord")]);
  play(g.engine, P1, g.id("ab"));
  assert.equal(zoneOf(g.engine, g.id("ab")), "play");
  assert.equal(rdy(g.engine), 1, "exactly the printed cost 3 is paid");
});

clause(ABRAM, "1:fealty", "the reduction is only 3 icons: 4 different trades with no deception icon is refused", () => {
  const g = abramHand([res("fd", "obsession", "rogue"), res("fr", "rage", "banker"), res("fg", "greed", "arcanist"), res("fo", "elitism", "warlord")]);
  refused(() => play(g.engine, P1, g.id("ab")), "0 deception icons");
  assert.equal(zoneOf(g.engine, g.id("ab")), "hand");
});

clause(ABRAM, "1:fealty", "only 3 different trades among my staples gives no reduction", () => {
  const g = abramHand([res("fd", "deception", "rogue"), res("fr", "rage", "banker"), res("fg", "greed", "banker"), res("fo", "elitism", "arcanist")]);
  refused(() => play(g.engine, P1, g.id("ab")), "3 trades");
  assert.equal(zoneOf(g.engine, g.id("ab")), "hand");
});

clause(ABRAM, "1:fealty", "the resources must be staples: a non-staple resource is not the 4th trade", () => {
  const g = abramHand([res("fd", "deception", "rogue"), res("fr", "rage", "banker"), res("fg", "greed", "arcanist"), res("fo", "elitism", "warlord", P1, false)]);
  refused(() => play(g.engine, P1, g.id("ab")), "non-staple 4th trade");
  assert.equal(zoneOf(g.engine, g.id("ab")), "hand");
});

clause(ABRAM, "1:fealty", "only resources I control count: an opponent's staple of a 4th trade gives no reduction", () => {
  const g = abramHand([res("fd", "deception", "rogue"), res("fr", "rage", "banker"), res("fg", "greed", "banker"), res("fo", "elitism", "arcanist"), res("theirs", "elitism", "warlord", P2)]);
  refused(() => play(g.engine, P1, g.id("ab")), "opponent's resource");
  assert.equal(zoneOf(g.engine, g.id("ab")), "hand");
});

clause(ABRAM, "1:fealty", "5 different trades (at least 4) still reduce", () => {
  const g = abramHand([res("fd", "deception", "rogue"), res("fr", "rage", "banker"), res("fg", "greed", "arcanist"), res("fo", "elitism", "warlord"), res("f5", "obsession", "gearsmith")]);
  play(g.engine, P1, g.id("ab"));
  assert.equal(zoneOf(g.engine, g.id("ab")), "play");
  assert.equal(rdy(g.engine), 2);
});

clause(ABRAM, "1:fealty", "no reduction without the 4 trades: plenty of rage resources do not meet dddd", () => {
  const h = abram({ zone: "hand", banks: bank("rage", 6, P1) });
  refused(() => play(h.engine, P1, h.id("ab")), "no reduction without 4 trades");
  assert.equal(zoneOf(h.engine, h.id("ab")), "hand");
});

// MAKE VANISH
clause(ABRAM, "2:ability:make-vanish", "pays 5, depletes Alakazin and puts an opponent's character into the void", () => {
  const g = abram({ banks: bank("rage", 5, P1), extra: [foeChar()] });
  vanish(g, "foe");
  assert.equal(zoneOf(g.engine, g.id("foe")), "void");
  assert.equal(g.engine.state.cards[g.id("ab")].depleted, true, "deplete cost");
  assert.equal(rdy(g.engine), 0, "pay 5");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(ABRAM, "2:ability:make-vanish", "any character can be picked: my own other character, and itself", () => {
  const g = abram({ extra: [foeChar("mine", P1), foeChar("foe")] });
  vanish(g, "mine");
  assert.equal(zoneOf(g.engine, g.id("mine")), "void");
  assert.equal(zoneOf(g.engine, g.id("foe")), "play", "only the picked character");
  const h = abram();
  vanish(h, "ab");
  assert.equal(zoneOf(h.engine, h.id("ab")), "void", "literally 'a character': Alakazin itself");
});

clause(ABRAM, "2:ability:make-vanish", "a non-character (item) or a character in hand cannot be picked", () => {
  const g = abram({ extra: [foeChar(), { key: "it", def: item({ name: "Thing" }), owner: P2, zone: "play" }, { key: "hc", def: character({ name: "HandC" }), owner: P2, zone: "hand" }] });
  refused(() => vanish(g, "it"), "item");
  refused(() => vanish(g, "hc"), "character in hand");
  assert.equal(zoneOf(g.engine, g.id("it")), "play");
  assert.equal(zoneOf(g.engine, g.id("hc")), "hand");
  assert.equal(g.engine.state.cards[g.id("ab")].depleted ?? false, false, "nothing paid by the refusals");
  vanish(g, "foe");
  assert.equal(zoneOf(g.engine, g.id("foe")), "void", "control");
});

clause(ABRAM, "2:ability:make-vanish", "refused with only 4 ready resources (pay 5), nothing partially paid", () => {
  const g = abram({ banks: bank("rage", 4, P1), extra: [foeChar()] });
  refused(() => vanish(g, "foe"), "pay 5 with 4");
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
  assert.equal(g.engine.state.cards[g.id("ab")].depleted ?? false, false);
  assert.equal(rdy(g.engine), 4);
});

clause(ABRAM, "2:ability:make-vanish", "refused while Alakazin is depleted", () => {
  const g = abram({ extra: [foeChar()] });
  g.engine.state.cards[g.id("ab")].depleted = true;
  refused(() => vanish(g, "foe"), "depleted");
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
  ready(g);
  vanish(g, "foe");
  assert.equal(zoneOf(g.engine, g.id("foe")), "void", "control");
});

// MAKE REAPPEAR
clause(ABRAM, "3:ability:make-reappear", "pays 1, depletes, and puts a character this card voided into play under my control (my own)", () => {
  const g = abram({ banks: bank("rage", 6, P1), extra: [foeChar("mine", P1)] });
  vanish(g, "mine");
  ready(g);
  reappear(g);
  // "a character voided by this card" is the controller's pick (SYS-54): asked even with a single candidate
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [g.id("mine")] } } as never);
  assert.equal(zoneOf(g.engine, g.id("mine")), "play");
  assert.equal(g.engine.state.cards[g.id("mine")].controllerId, P1);
  assert.equal(g.engine.state.cards[g.id("ab")].depleted, true);
  assert.equal(rdy(g.engine), 0, "pay 5 then pay 1");
});

clause(ABRAM, "3:ability:make-reappear", "an OPPONENT's character that Alakazin voided comes back under MY control", () => {
  const g = abram({ extra: [foeChar()] });
  vanish(g, "foe");
  ready(g);
  reappear(g);
  pickReappear(g, "foe");
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
  assert.equal(g.engine.state.cards[g.id("foe")].controllerId, P1, "under my control");
  assert.equal(g.engine.state.cards[g.id("foe")].ownerId, P2, "still the opponent's card");
});

clause(ABRAM, "3:ability:make-reappear", "only a character voided BY THIS CARD can return, not other cards in my void", () => {
  for (const r of [0, 0.99]) {
    const g = abram({
      random: () => r,
      extra: [foeChar("mine", P1), { key: "stale", def: character({ name: "Stale" }), owner: P1, zone: "void" }]
    });
    vanish(g, "mine");
    ready(g);
    reappear(g);
    refused(() => pickReappear(g, "stale"), "a character Alakazin did not void is not a legal pick");
    pickReappear(g, "mine");
    assert.equal(zoneOf(g.engine, g.id("stale")), "void", "not voided by Alakazin: stays in the void");
    assert.equal(zoneOf(g.engine, g.id("mine")), "play");
  }
});

clause(ABRAM, "3:ability:make-reappear", "with two characters voided by this card, I choose which returns", () => {
  const g = abram({ banks: bank("rage", 12, P1), extra: [foeChar("m1", P1), foeChar("m2", P1)] });
  vanish(g, "m1");
  ready(g);
  vanish(g, "m2");
  ready(g);
  reappear(g);
  const pc = pending(g.engine) as unknown as { playerId: string } | undefined;
  assert.ok(pc, "a choice is offered");
  assert.equal(pc!.playerId, P1);
});

clause(ABRAM, "3:ability:make-reappear", "with nothing voided by it, nothing enters play and nothing soft-locks", () => {
  const g = abram({ extra: [{ key: "stale", def: character({ name: "Stale" }), owner: P1, zone: "void" }] });
  const before = [...g.engine.state.players[P1].play];
  reappear(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual([...g.engine.state.players[P1].play], before);
  assert.equal(zoneOf(g.engine, g.id("stale")), "void");
});

// -- T3c9 mutation pass: the second Abram printing plays exactly like the first ---------------------------------
const ABRAM_B = "cfa555a9-7c42-44f0-8787-d3b61fd3621e";
const abramB = (o: { zone?: "hand" | "play"; banks?: Cards; extra?: Cards } = {}) => abram({ ...o, id: ABRAM_B });

clause(ABRAM_B, "0:unique", "second printing: rogue pluck/performer/blade of questionable morality, str 1 / spd 4 / life 1, cost 3 [D][D][D][D]; deploys for exactly 3, refused one short either way", () => {
  const p = printing(ABRAM_B);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "rogue");
  assert.deepEqual(p.subtype, ["pluck", "performer", "blade of questionable morality"]);
  assert.equal(p.cost, 3);
  assert.equal(p.threshold, "dddd");
  const g = abramB();
  assert.equal(g.engine.getStat(g.id("ab"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("ab"), "speed"), 4);
  assert.equal(g.engine.getStat(g.id("ab"), "life"), 1);
  costExact(ABRAM_B, 3, "deception", 4)();
  costShort(ABRAM_B, 3, "deception", 4)();
  thrShort(ABRAM_B, 3, "deception", 4)();
});

clause(ABRAM_B, "0:unique", "second printing: UNIQUE PLUCK is shared with the first printing: a second PLUCK forces a survivor choice", () => {
  const g = abramB({ zone: "hand", banks: bank("deception", 4, P1), extra: [{ key: "ab2", def: printing(ABRAM), owner: P1, zone: "play" }] });
  play(g.engine, P1, g.id("ab"));
  const pc = pending(g.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [g.id("ab"), g.id("ab2")].sort());
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("ab2") } } as never);
  assert.equal(zoneOf(g.engine, g.id("ab")), "discard");
  assert.equal(zoneOf(g.engine, g.id("ab2")), "play");
});

clause(ABRAM_B, "1:fealty", "second printing: with 4 staples of 4 different trades one [D] is enough (cost 3 paid); 3 trades or no [D] is refused", () => {
  const g = abramB({ zone: "hand", banks: [], extra: [res("fd", "deception", "rogue"), res("fr", "rage", "banker"), res("fg", "greed", "arcanist"), res("fo", "elitism", "warlord")] });
  play(g.engine, P1, g.id("ab"));
  assert.equal(zoneOf(g.engine, g.id("ab")), "play");
  assert.equal(rdy(g.engine), 1, "exactly the printed cost 3 is paid");
  const none = abramB({ zone: "hand", banks: [], extra: [res("fd", "obsession", "rogue"), res("fr", "rage", "banker"), res("fg", "greed", "arcanist"), res("fo", "elitism", "warlord")] });
  refused(() => play(none.engine, P1, none.id("ab")), "0 deception icons");
  const three = abramB({ zone: "hand", banks: [], extra: [res("fd", "deception", "rogue"), res("fr", "rage", "banker"), res("fg", "greed", "arcanist"), res("f2", "rage", "banker")] });
  refused(() => play(three.engine, P1, three.id("ab")), "only 3 different trades: no reduction");
  assert.equal(zoneOf(three.engine, three.id("ab")), "hand");
});

clause(ABRAM_B, "1:fealty", "second printing: the 4 trades must be staples I control: a non-staple or an opponent's staple as the 4th trade gives no reduction", () => {
  const ns = abramB({ zone: "hand", banks: [], extra: [res("fd", "deception", "rogue"), res("fr", "rage", "banker"), res("fg", "greed", "arcanist"), res("fo", "elitism", "warlord", P1, false)] });
  refused(() => play(ns.engine, P1, ns.id("ab")), "non-staple 4th trade");
  assert.equal(zoneOf(ns.engine, ns.id("ab")), "hand");
  const theirs = abramB({ zone: "hand", banks: [], extra: [res("fd", "deception", "rogue"), res("fr", "rage", "banker"), res("fg", "greed", "banker"), res("fo", "elitism", "arcanist"), res("theirs", "elitism", "warlord", P2)] });
  refused(() => play(theirs.engine, P1, theirs.id("ab")), "opponent's resource");
  assert.equal(zoneOf(theirs.engine, theirs.id("ab")), "hand");
  const five = abramB({ zone: "hand", banks: [], extra: [res("fd", "deception", "rogue"), res("fr", "rage", "banker"), res("fg", "greed", "arcanist"), res("fo", "elitism", "warlord"), res("f5", "obsession", "gearsmith")] });
  play(five.engine, P1, five.id("ab"));
  assert.equal(zoneOf(five.engine, five.id("ab")), "play", "control: 5 trades reduce");
});

clause(ABRAM_B, "2:ability:make-vanish", "second printing: pay 5 and deplete to void a character (any, mine included); refused with 4 ready, depleted, or an item", () => {
  const g = abramB({ banks: bank("rage", 5, P1), extra: [foeChar()] });
  vanish(g, "foe");
  assert.equal(zoneOf(g.engine, g.id("foe")), "void");
  assert.equal(g.engine.state.cards[g.id("ab")].depleted, true, "deplete cost");
  assert.equal(rdy(g.engine), 0, "pay 5");
  const own = abramB({ extra: [foeChar("mine", P1)] });
  vanish(own, "mine");
  assert.equal(zoneOf(own.engine, own.id("mine")), "void", "my own character can be voided");
  const four = abramB({ banks: bank("rage", 4, P1), extra: [foeChar()] });
  refused(() => vanish(four, "foe"), "pay 5 with 4 ready");
  assert.equal(zoneOf(four.engine, four.id("foe")), "play");
  const dep = abramB({ extra: [foeChar()] });
  dep.engine.state.cards[dep.id("ab")].depleted = true;
  refused(() => vanish(dep, "foe"), "depleted");
  const it = abramB({ extra: [{ key: "it", def: item({ name: "Thing" }), owner: P2, zone: "play" }] });
  refused(() => vanish(it, "it"), "an item is not a character");
});

clause(ABRAM_B, "3:ability:make-reappear", "second printing: pay 1 and deplete; I choose one character this card voided (an opponent's comes back under my control); other void cards stay", () => {
  const g = abramB({ banks: bank("rage", 12, P1), extra: [foeChar("m1", P1), foeChar("m2"), { key: "stale", def: character({ name: "Stale" }), owner: P1, zone: "void" }] });
  vanish(g, "m1");
  ready(g);
  vanish(g, "m2");
  ready(g);
  const before = rdy(g.engine);
  reappear(g);
  const pc = pending(g.engine) as unknown as { playerId: string } | undefined;
  assert.equal(pc?.playerId, P1, "I choose");
  refused(() => pickReappear(g, "stale"), "not voided by this card");
  refused(
    () => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [] } } as never),
    "the pick is mandatory"
  );
  refused(
    () => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [g.id("m1"), g.id("m2")] } } as never),
    "exactly one character"
  );
  pickReappear(g, "m2");
  assert.equal(zoneOf(g.engine, g.id("m2")), "play");
  assert.equal(g.engine.state.cards[g.id("m2")].controllerId, P1, "under my control");
  assert.equal(g.engine.state.cards[g.id("m2")].ownerId, P2, "still the opponent's card");
  assert.equal(zoneOf(g.engine, g.id("m1")), "void", "the other voided character stays");
  assert.equal(zoneOf(g.engine, g.id("stale")), "void");
  assert.equal(rdy(g.engine), before - 1, "pay 1");
  assert.equal(g.engine.state.cards[g.id("ab")].depleted, true, "deplete cost");
  const dep = abramB({ extra: [foeChar("mine", P1)] });
  vanish(dep, "mine");
  refused(() => reappear(dep), "still depleted");
  const poor = abramB({ banks: bank("rage", 5, P1), extra: [foeChar("mine", P1)] });
  vanish(poor, "mine");
  ready(poor);
  refused(() => reappear(poor), "no resource left to pay 1");
});

clause(ABRAM, "3:ability:make-reappear", "(T3c9) the return is mandatory and exactly one: an empty pick and a pick of two voided characters are refused, then one returns", () => {
  const g = abram({ banks: bank("rage", 12, P1), extra: [foeChar("m1", P1), foeChar("m2", P1)] });
  vanish(g, "m1");
  ready(g);
  vanish(g, "m2");
  ready(g);
  reappear(g);
  refused(
    () => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [] } } as never),
    "a voided character must be returned: the pick is not optional"
  );
  refused(
    () => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [g.id("m1"), g.id("m2")] } } as never),
    "only one character returns"
  );
  pickReappear(g, "m1");
  assert.equal(zoneOf(g.engine, g.id("m1")), "play", "the picked character returns");
  assert.equal(zoneOf(g.engine, g.id("m2")), "void", "the other stays voided");
});

clause(ABRAM, "3:ability:make-reappear", "refused while depleted; refused with no resource to pay 1", () => {
  const g = abram({ banks: bank("rage", 1, P1), extra: [foeChar("mine", P1)] });
  g.engine.state.cards[g.id("ab")].depleted = true;
  refused(() => reappear(g), "depleted");
  const h = abram({ banks: [], extra: [foeChar("mine", P1)] });
  refused(() => reappear(h), "no resource for pay 1");
  assert.equal(h.engine.state.cards[h.id("ab")].depleted ?? false, false, "nothing paid");
  ready(g);
  reappear(g);
  assert.equal(rdy(g.engine), 0, "control: pay 1");
});

// =====================================================================================================
// Apparition Alley
// =====================================================================================================
const alley = (o: { depleted?: boolean; extra?: Cards } = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "al", def: printing(ALLEY), owner: P1, zone: "play", depleted: o.depleted },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "it", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      ...(o.extra ?? [])
    ]
  });
const woosh = (g: ReturnType<typeof alley>, t: string) => activate(g.engine, P1, g.id("al"), "woosh", { selected: { c: [g.id(t)] } });

clause(ALLEY, "0:ability:woosh", "printed: rogue location, cost 3, threshold dd, structure 3; deploys for exactly 3 with dd, refused one short either way", () => {
  const p = printing(ALLEY);
  assert.equal(p.type, "location");
  assert.equal(p.trade, "rogue");
  assert.equal(p.cost, 3);
  assert.equal(p.threshold, "dd");
  assert.equal((p as unknown as { structure: number }).structure, 3);
  costExact(ALLEY, 3, "deception", 2)();
  costShort(ALLEY, 3, "deception", 2)();
  thrShort(ALLEY, 3, "deception", 2)();
});

clause(ALLEY, "0:ability:woosh", "the location is depleted and the picked character gains 1 speed", () => {
  const g = alley();
  assert.equal(g.engine.getStat(g.id("mine"), "speed"), 3);
  woosh(g, "mine");
  assert.equal(g.engine.getStat(g.id("mine"), "speed"), 4);
  assert.equal(g.engine.state.cards[g.id("al")].depleted, true);
  assert.equal(g.engine.getStat(g.id("foe"), "speed"), 2, "other characters unaffected");
  assert.equal(g.engine.getStat(g.id("mine"), "strength"), 2);
  assert.equal(g.engine.getStat(g.id("mine"), "life"), 3);
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(ALLEY, "0:ability:woosh", "any character can be picked, an opponent's included; an item cannot", () => {
  const g = alley();
  woosh(g, "foe");
  assert.equal(g.engine.getStat(g.id("foe"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("mine"), "speed"), 3);
  const h = alley();
  refused(() => woosh(h, "it"), "an item is not a character");
  assert.equal(h.engine.state.cards[h.id("al")].depleted ?? false, false);
});

clause(ALLEY, "0:ability:woosh", "refused while depleted; a second use after readying stacks to +2", () => {
  const g = alley({ depleted: true });
  refused(() => woosh(g, "mine"), "depleted");
  assert.equal(g.engine.getStat(g.id("mine"), "speed"), 3);
  const h = alley();
  woosh(h, "mine");
  h.engine.state.cards[h.id("al")].depleted = false;
  woosh(h, "mine");
  assert.equal(h.engine.getStat(h.id("mine"), "speed"), 5);
});

clause(ALLEY, "0:ability:woosh", "(T3c9) the speed bonus lasts the whole turn, not just one battle", () => {
  const g = alley();
  woosh(g, "mine");
  fightThrough(g.engine, P1, [g.id("mine")], { type: "faction", playerId: P2 }, []);
  assert.equal(g.engine.state.battle, undefined, "the battle is over");
  assert.equal(g.engine.getStat(g.id("mine"), "speed"), 4, "still +1 after the battle");
});

clause(ALLEY, "0:ability:woosh", "the speed bonus lasts this turn only", () => {
  const g = alley();
  woosh(g, "mine");
  assert.equal(g.engine.getStat(g.id("mine"), "speed"), 4);
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.getStat(g.id("mine"), "speed"), 3, "back to printed speed");
});

// =====================================================================================================
// Camouflaged Urchin
// =====================================================================================================
const poke = (name = "Poke") =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "k",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "strength", operation: "add", value: 1, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  } as never);
const urchin = (o: { depleted?: boolean; owner?: string; controller?: string; active?: string; extra?: Cards } = {}) => {
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: active === P1 ? 1 : 2,
    activePlayerId: active as never,
    cards: [
      { key: "u", def: printing(URCHIN), owner: (o.owner ?? P1) as never, controller: o.controller as never, zone: "play", depleted: o.depleted },
      { key: "p1", def: poke("PokeA"), owner: P1, zone: "hand" },
      { key: "p2", def: poke("PokeB"), owner: P2, zone: "hand" },
      ...(o.extra ?? [])
    ]
  });
};
type UR = ReturnType<typeof urchin>;
const pokeBy = (g: UR, who: string, t = "u") => play(g.engine, who as never, g.id(who === P1 ? "p1" : "p2"), { selected: { t: [g.id(t)] } });
const str = (g: UR, k = "u") => g.engine.getStat(g.id(k), "strength");

clause(URCHIN, "0:rule", "printed: rogue martial artist character, cost 2, threshold d, str 1 / spd 4 / life 1", () => {
  const p = printing(URCHIN);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "rogue");
  assert.deepEqual(p.subtype, ["martial artist"]);
  assert.equal(p.cost, 2);
  assert.equal(p.threshold, "d");
  const g = urchin();
  assert.equal(g.engine.getStat(g.id("u"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("u"), "speed"), 4);
  assert.equal(g.engine.getStat(g.id("u"), "life"), 1);
});

clause(URCHIN, "0:rule", "deploys for exactly 2 with a d icon; refused with 1 ready; refused with no d icon", () => {
  costExact(URCHIN, 2, "deception", 1)();
  costShort(URCHIN, 2, "deception", 1)();
  const t = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "c", def: printing(URCHIN), owner: P1, zone: "hand" }, ...bank("rage", 3, P1)] });
  refused(() => play(t.engine, P1, t.id("c")), "no deception icon");
  assert.equal(zoneOf(t.engine, t.id("c")), "hand");
});

clause(URCHIN, "0:rule", "while depleted the opponent cannot pick it, I still can", () => {
  const g = urchin({ depleted: true, active: P2 });
  refused(() => pokeBy(g, P2), "opponent picking a depleted Urchin");
  assert.equal(str(g), 1);
  assert.equal(zoneOf(g.engine, g.id("p2")), "hand", "the tactic was not cast");
  assert.ok(g.engine.getRestrictions(g.id("u")).includes("cannotBePickedByOpponents"), "g.engine.getRestrictions(g.id(\"u\")).includes(\"cannotBePickedByOpponents\")");
  const h = urchin({ depleted: true, active: P1 });
  pokeBy(h, P1);
  assert.equal(str(h), 2, "my own pick of my depleted Urchin works");
});

clause(URCHIN, "0:rule", "while ready (not depleted) the opponent can pick it", () => {
  const g = urchin({ active: P2 });
  pokeBy(g, P2);
  assert.equal(str(g), 2);
  assert.ok(!g.engine.getRestrictions(g.id("u")).includes("cannotBePickedByOpponents"), "!g.engine.getRestrictions(g.id(\"u\")).includes(\"cannotBePickedByOpponents\")");
});

clause(URCHIN, "0:rule", "turns on when it becomes depleted and off when it readies", () => {
  const g = urchin({ active: P2 });
  assert.ok(!g.engine.getRestrictions(g.id("u")).includes("cannotBePickedByOpponents"), "!g.engine.getRestrictions(g.id(\"u\")).includes(\"cannotBePickedByOpponents\")");
  g.engine.state.cards[g.id("u")].depleted = true;
  assert.ok(g.engine.getRestrictions(g.id("u")).includes("cannotBePickedByOpponents"), "g.engine.getRestrictions(g.id(\"u\")).includes(\"cannotBePickedByOpponents\")");
  refused(() => pokeBy(g, P2), "depleted again");
  g.engine.state.cards[g.id("u")].depleted = false;
  assert.ok(!g.engine.getRestrictions(g.id("u")).includes("cannotBePickedByOpponents"), "!g.engine.getRestrictions(g.id(\"u\")).includes(\"cannotBePickedByOpponents\")");
  pokeBy(g, P2);
  assert.equal(str(g), 2);
});

clause(URCHIN, "0:rule", "it protects only itself, and the restriction is gone once the Urchin leaves play", () => {
  const g = urchin({ depleted: true, active: P2, extra: [{ key: "o", def: character({ name: "Other", strength: 1 }), owner: P1, zone: "play", depleted: true }] });
  pokeBy(g, P2, "o");
  assert.equal(str(g, "o"), 2, "other depleted character is pickable");
  const killT = tactic({
    name: "Kill",
    cost: 0,
    behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  } as never);
  const h = urchin({ depleted: true, active: P1, extra: [{ key: "kill", def: killT, owner: P1, zone: "hand" }] });
  play(h.engine, P1, h.id("kill"), { selected: { t: [h.id("u")] } });
  assert.equal(zoneOf(h.engine, h.id("u")), "discard");
  assert.ok(!h.engine.getRestrictions(h.id("u")).includes("cannotBePickedByOpponents"), "off after leaving play");
});

clause(URCHIN, "0:rule", "'your opponents' is relative to the controller: a stolen depleted Urchin is unpickable by its owner", () => {
  const g = urchin({ depleted: true, owner: P2, controller: P1, active: P2 });
  refused(() => pokeBy(g, P2), "the owner is now the controller's opponent");
  const h = urchin({ depleted: true, owner: P2, controller: P1, active: P1 });
  pokeBy(h, P1);
  assert.equal(str(h), 2, "the controller can pick it");
});

// FLIP UP
const flipBoard = (o: { banks?: Cards; active?: string; spentSelf?: boolean } = {}) => {
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: active === P1 ? 1 : 2,
    activePlayerId: active as never,
    cards: [
      { key: "u", def: printing(URCHIN), owner: P1, zone: "play", faceDown: true, ...(o.spentSelf ? { attachedToKey: "__factionA" } : {}) },
      { key: "a", def: character({ name: "Attacker" }), owner: P2, zone: "play" },
      ...(o.banks ?? [])
    ]
  });
};
const flip = (g: ReturnType<typeof flipBoard>) =>
  flipUpNow(g.engine, { type: "flipUp", playerId: P1, cardId: g.id("u"), selected: {}, variables: {} });

clause(URCHIN, "1:flipUp", "FLIP UP 1 [D]: with a d icon and a resource, it flips up into a face-up character with printed stats, paying exactly 1", () => {
  const g = flipBoard({ banks: bank("deception", 3, P1) });
  assert.equal(g.engine.state.cards[g.id("u")].faceDown, true);
  flip(g);
  const c = g.engine.state.cards[g.id("u")];
  assert.equal(c.faceDown, false);
  assert.equal(c.zone, "play");
  assert.equal(g.engine.getStat(g.id("u"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("u"), "speed"), 4);
  assert.equal(g.engine.getStat(g.id("u"), "life"), 1);
  // CR 507.4b: the Urchin may pay for its own FLIP UP, so the payer is rule-neutral: either one bank was spent (2 ready) or the Urchin paid itself (3 ready).
  const paidByBank = rdy(g.engine) === 2;
  const paidByItself = rdy(g.engine) === 3 && g.engine.state.cards[g.id("u")].attachedTo !== undefined;
  assert.ok(paidByBank || paidByItself, `exactly 1 resource was paid, by a bank or by the Urchin itself (ready banks ${rdy(g.engine)})`);
  assert.equal(g.engine.isResource(g.id("u")), false);
});

clause(URCHIN, "1:flipUp", "the card may pay its own cost: with only a spent d icon and itself it still flips", () => {
  const g = flipBoard({ banks: spent("deception", 1) });
  flip(g);
  assert.equal(g.engine.state.cards[g.id("u")].faceDown, false);
});

clause(URCHIN, "1:flipUp", "refused when nothing is left to pay 1: a spent d icon and the Urchin itself spent (also SYS-36 territory)", () => {
  const g = flipBoard({ banks: spent("deception", 1), spentSelf: true });
  assert.throws(() => flip(g));
  assert.equal(g.engine.state.cards[g.id("u")].faceDown, true);
});

clause(URCHIN, "1:flipUp", "needs a [D] icon: rage banks cannot meet the threshold, and the Urchin's own icon does not count", () => {
  const g = flipBoard({ banks: bank("rage", 3, P1) });
  assert.throws(() => flip(g));
  assert.equal(g.engine.state.cards[g.id("u")].faceDown, true);
  assert.equal(rdy(g.engine), 4, "nothing paid");
  const h = flipBoard({});
  assert.throws(() => flip(h));
  assert.equal(h.engine.state.cards[h.id("u")].faceDown, true);
});

clause(URCHIN, "1:flipUp", "a non-tactic FLIP UP is refused inside an opponent's response window", () => {
  const g = flipBoard({ active: P2, banks: bank("deception", 3, P1) });
  declareAttackOpenWindow(g.engine, P2, [g.id("a")]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.throws(() => flip(g));
  assert.equal(g.engine.state.cards[g.id("u")].faceDown, true);
});

clause(URCHIN, "1:flipUp", "control: on my own turn the same board flips up", () => {
  const g = flipBoard({ active: P1, banks: bank("deception", 3, P1) });
  flip(g);
  assert.equal(g.engine.state.cards[g.id("u")].faceDown, false);
});

// =====================================================================================================
// Candy Skull Commander
// =====================================================================================================
const flipTactic = () =>
  tactic({
    name: "Toss",
    cost: 0,
    behavior: { abilities: [{ id: "c", type: "activated", effects: [{ type: "flipCoin", winEffects: [], loseEffects: [] }] }] }
  } as never);
const skull = (o: { random?: () => number; banks?: Cards; active?: string; extra?: Cards } = {}) => {
  const active = o.active ?? P2;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: active === P1 ? 1 : 2,
    activePlayerId: active as never,
    random: o.random ?? (() => 0),
    cards: [
      { key: "s", def: printing(SKULL), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "a", def: character({ name: "Attacker", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "mya", def: character({ name: "MyAttacker", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "toss1", def: flipTactic(), owner: P1, zone: "hand" },
      { key: "toss2", def: flipTactic(), owner: P2, zone: "hand" },
      ...fillers("d", 4, P1, "deck"),
      ...fillers("e", 4, P2, "deck"),
      ...(o.banks ?? bank("rage", 3, P1)),
      ...(o.extra ?? [])
    ]
  });
};
type SK = ReturnType<typeof skull>;
const sp = (g: SK, k: string) => g.engine.getStat(g.id(k), "speed");
const hand = (g: SK, p: string = P1) => g.engine.state.players[p as never].hand.length;
const flips = (g: SK) => g.engine.getLog().filter((e) => (e.event as { type?: string } | undefined)?.type === "coinFlipped").length;
/** Opponent forms an attacking party; answer the may-pay as given. */
const attackAnswering = (g: SK, pay: boolean, attacker = "a", who: string = P2) => {
  g.engine.perform({ type: "declareAttack", playerId: who as never, attackerIds: [g.id(attacker)], target: { type: "faction", playerId: (who === P1 ? P2 : P1) as never } } as never);
  drain(g.engine, mayAnswer(pay) as never);
};

clause(SKULL, "0:rule", "printed: rogue vigilante character, cost 3, threshold dd, str 3 / spd 3 / life 2", () => {
  const p = printing(SKULL);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "rogue");
  assert.deepEqual(p.subtype, ["vigilante"]);
  assert.equal(p.cost, 3);
  assert.equal(p.threshold, "dd");
  const g = skull();
  assert.equal(g.engine.getStat(g.id("s"), "strength"), 3);
  assert.equal(g.engine.getStat(g.id("s"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("s"), "life"), 2);
  costExact(SKULL, 3, "deception", 2)();
  costShort(SKULL, 3, "deception", 2)();
  thrShort(SKULL, 3, "deception", 2)();
});

clause(SKULL, "0:rule", "opponent forms an attacking party, I pay 2, win the flip: all my characters gain 1 speed (not the opponent's)", () => {
  const g = skull({ random: () => 0 });
  attackAnswering(g, true);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(rdy(g.engine), 1, "paid 2 of 3");
  assert.equal(sp(g, "s"), 4);
  assert.equal(sp(g, "ally"), 3);
  assert.equal(sp(g, "mya"), 3);
  assert.equal(sp(g, "a"), 2, "opponent's character unaffected");
});

clause(SKULL, "0:rule", "I lose the flip: I paid 2 but nobody gains speed", () => {
  const g = skull({ random: () => 0.99 });
  attackAnswering(g, true);
  assert.equal(rdy(g.engine), 1, "still paid");
  assert.equal(flips(g), 1, "a coin was flipped");
  assert.equal(sp(g, "s"), 3);
  assert.equal(sp(g, "ally"), 2);
});

clause(SKULL, "0:rule", "declining the payment: nothing paid, no flip, no speed", () => {
  const g = skull({ random: () => 0 });
  attackAnswering(g, false);
  assert.equal(rdy(g.engine), 3);
  assert.equal(sp(g, "s"), 3);
  assert.equal(sp(g, "ally"), 2);
  assert.equal(flips(g), 0, "no coin flipped");
});

clause(SKULL, "0:rule", "pay 2 is required: with only 1 ready resource it cannot be paid and nothing speeds up", () => {
  const g = skull({ random: () => 0, banks: bank("rage", 1, P1) });
  attackAnswering(g, true);
  assert.equal(sp(g, "s"), 3);
  assert.equal(sp(g, "ally"), 2);
  assert.equal(flips(g), 0);
  assert.equal(rdy(g.engine), 1);
});

clause(SKULL, "0:rule", "does not trigger when I form the attacking party myself", () => {
  const g = skull({ random: () => 0, active: P1 });
  g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("mya")], target: { type: "faction", playerId: P2 } } as never);
  assert.equal(g.engine.state.pendingChoice, undefined, "no may-pay for me");
  assert.equal(rdy(g.engine), 3);
  assert.equal(sp(g, "s"), 3);
});

clause(SKULL, "0:rule", "the speed bonus lasts this turn only", () => {
  const g = skull({ random: () => 0 });
  attackAnswering(g, true);
  assert.equal(sp(g, "ally"), 3);
  declareBlockers(g.engine, P1, []);
  finishBattle(g.engine);
  endTurn(g.engine, P2);
  endTurn(g.engine, P1);
  assert.equal(sp(g, "ally"), 2, "gone after the turn");
  assert.equal(sp(g, "s"), 3);
});

clause(SKULL, "0:rule", "(T3c9) only CHARACTERS gain the speed (not my item), and it lasts the whole turn, not just the battle", () => {
  const g = skull({ random: () => 0, extra: [{ key: "myitem", def: item({ name: "MyItem" }), owner: P1, zone: "play" }] });
  const itemSpeed = sp(g, "myitem");
  attackAnswering(g, true);
  assert.equal(sp(g, "ally"), 3, "my character gains 1 speed");
  assert.equal(sp(g, "myitem"), itemSpeed, "my item is not a character: no speed");
  declareBlockers(g.engine, P1, []);
  finishBattle(g.engine);
  assert.equal(g.engine.state.battle, undefined, "the battle is over");
  assert.equal(sp(g, "ally"), 3, "still +1 after the battle: it lasts this turn");
  assert.equal(sp(g, "s"), 4, "Candy Skull Commander too");
});

clause(SKULL, "0:rule", "after paying 2 I MAY flip a coin: declining the flip is possible", () => {
  const g = skull({ random: () => 0 });
  g.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [g.id("a")], target: { type: "faction", playerId: P1 } } as never);
  const pc1 = pending(g.engine) as unknown as { kind: string; playerId: string };
  g.engine.perform({ type: "resolvePendingChoice", playerId: pc1.playerId, choice: { kind: "mayPay", pay: true } } as never);
  const pc2 = pending(g.engine) as unknown as { kind: string; playerId: string } | undefined;
  assert.ok(pc2, "a may-flip prompt is offered after paying");
  assert.equal(pc2!.playerId, P1);
});

// second rule
const dBanks = (readyN: number, spentN = 0) => [...bank("deception", readyN, P1), ...spent("deception", spentN)];

clause(SKULL, "1:rule@dddddd", "with 6 deception icons, a coin flip lets me pay 1 and draw a card (opponent's flip)", () => {
  const g = skull({ active: P2, banks: dBanks(7), random: () => 0 });
  const h0 = hand(g);
  const o0 = hand(g, P2);
  play(g.engine, P2, g.id("toss2"), {});
  const pc = pending(g.engine) as unknown as { kind: string; playerId: string };
  assert.equal(pc.kind, "mayPay");
  assert.equal(pc.playerId, P1);
  drain(g.engine, mayAnswer(true) as never);
  assert.equal(hand(g), h0 + 1, "drew a card");
  assert.equal(rdy(g.engine), 6, "paid exactly 1");
  assert.equal(hand(g, P2), o0 - 1, "opponent only lost the cast tactic (drew nothing)");
});

clause(SKULL, "1:rule@dddddd", "it fires on my own flip too, win or lose; declining leaves everything", () => {
  for (const r of [0, 0.99]) {
    const g = skull({ active: P1, banks: dBanks(7), random: () => r });
    const h0 = hand(g);
    play(g.engine, P1, g.id("toss1"), {});
    drain(g.engine, mayAnswer(true) as never);
    assert.equal(hand(g), h0, `net: cast tactic (-1) + drew one (+1) on flip result ${r}`);
    assert.equal(rdy(g.engine), 6);
  }
  const d = skull({ active: P1, banks: dBanks(7) });
  const h1 = hand(d);
  play(d.engine, P1, d.id("toss1"), {});
  drain(d.engine, mayAnswer(false) as never);
  assert.equal(hand(d), h1 - 1);
  assert.equal(rdy(d.engine), 7);
});

clause(SKULL, "1:rule@dddddd", "needs 6 deception icons: 5 deception plus rage does not trigger", () => {
  const g = skull({ active: P1, banks: [...bank("deception", 5, P1), ...bank("rage", 2, P1)], random: () => 0 });
  play(g.engine, P1, g.id("toss1"), {});
  assert.equal(g.engine.state.pendingChoice, undefined, "no prompt");
  assert.equal(rdy(g.engine), 7);
});

clause(SKULL, "1:rule@dddddd", "spent icons count toward the 6; with nothing ready to pay 1 there is nothing to draw with", () => {
  const g = skull({ active: P1, banks: dBanks(1, 5), random: () => 0 });
  const h0 = hand(g);
  play(g.engine, P1, g.id("toss1"), {});
  drain(g.engine, mayAnswer(true) as never);
  assert.equal(hand(g), h0, "5 spent + 1 ready deception = 6 icons; the ready one pays 1 (cast -1, draw +1)");
  const s = skull({ active: P1, banks: dBanks(0, 6), random: () => 0 });
  const h1 = hand(s);
  play(s.engine, P1, s.id("toss1"), {});
  drain(s.engine, mayAnswer(true) as never);
  assert.equal(hand(s), h1 - 1, "cannot pay 1: no draw");
});

clause(SKULL, "1:rule@dddddd", "pay 1 draws exactly one card, not two", () => {
  const g = skull({ active: P2, banks: dBanks(9), random: () => 0 });
  const h0 = hand(g);
  play(g.engine, P2, g.id("toss2"), {});
  drain(g.engine, mayAnswer(true) as never);
  assert.equal(hand(g) - h0, 1);
  assert.equal(rdy(g.engine), 8);
});

clause(SKULL, "1:rule@dddddd", "Skull's own first rule flip also triggers it: pay 2, flip, then pay 1 and draw (3 spent in all)", () => {
  const g = skull({ active: P2, banks: dBanks(7), random: () => 0 });
  const h0 = hand(g);
  attackAnswering(g, true);
  assert.equal(hand(g), h0 + 1);
  assert.equal(rdy(g.engine), 4, "2 + 1 spent");
  assert.equal(sp(g, "ally"), 3, "and the win still sped my characters up");
});

// =====================================================================================================
// Carnival Funhouse
// =====================================================================================================
const fun = (o: { zone?: "hand" | "play"; banks?: Cards; extra?: Cards } = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "fh", def: printing(FUNHOUSE), owner: P1, zone: o.zone ?? "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 5, speed: 3 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 7, life: 8, speed: 9 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 4, life: 1, speed: 6 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", strength: 5, life: 6, speed: 7 }), owner: P1, zone: "play" },
      ...(o.banks ?? [...spent("deception", 2), ...bank("rage", 4, P1)]),
      ...(o.extra ?? [])
    ]
  });
type FH = ReturnType<typeof fun>;
const castFun = (g: FH, a = "foe", b = "mine") => play(g.engine, P1, g.id("fh"), { selected: { a: [g.id(a)], b: [g.id(b)] } });
const trio = (g: FH, k: string) => [g.engine.getStat(g.id(k), "strength"), g.engine.getStat(g.id(k), "life"), g.engine.getStat(g.id(k), "speed")];

clause(FUNHOUSE, "0:rule", "printed: rogue location, cost 4, threshold dd, structure 4; deploys for exactly 4, refused one short either way", () => {
  const p = printing(FUNHOUSE);
  assert.equal(p.type, "location");
  assert.equal(p.trade, "rogue");
  assert.equal(p.cost, 4);
  assert.equal(p.threshold, "dd");
  assert.equal((p as unknown as { structure: number }).structure, 4);
  const extra: Cards = [
    { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
    { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" }
  ];
  const sel = { a: ["foe"], b: ["mine"] };
  costExact(FUNHOUSE, 4, "deception", 2, extra, sel)();
  costShort(FUNHOUSE, 4, "deception", 2, extra, sel)();
  thrShort(FUNHOUSE, 4, "deception", 2, extra, sel)();
});

clause(FUNHOUSE, "0:rule", "on entering play I pick one opposing and one of my characters; only those two are affected", () => {
  const g = fun();
  castFun(g);
  assert.equal(zoneOf(g.engine, g.id("fh")), "play");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(trio(g, "foe2"), [7, 8, 9], "unpicked opposing character");
  assert.deepEqual(trio(g, "mine2"), [5, 6, 7], "unpicked own character");
});

clause(FUNHOUSE, "0:rule", "both picks are enforced: the first must be an opponent's character, the second mine; one each", () => {
  const g = fun();
  refused(() => castFun(g, "mine2", "mine"), "both picks mine");
  refused(() => castFun(g, "foe", "foe2"), "both picks theirs");
  refused(() => castFun(g, "mine", "foe"), "picks swapped between controllers");
  refused(() => play(g.engine, P1, g.id("fh"), { selected: { a: [g.id("foe"), g.id("foe2")], b: [g.id("mine")] } }), "two opposing picks");
  assert.equal(zoneOf(g.engine, g.id("fh")), "hand");
  castFun(g);
  assert.equal(zoneOf(g.engine, g.id("fh")), "play", "control");
});

clause(FUNHOUSE, "0:rule", "(T3c9) only characters can be picked: an item is refused for either pick", () => {
  const g = fun({
    extra: [
      { key: "fi", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      { key: "mi", def: item({ name: "MyItem" }), owner: P1, zone: "play" }
    ]
  });
  refused(() => castFun(g, "fi", "mine"), "the opponent's item is not a character");
  refused(() => castFun(g, "foe", "mi"), "my item is not a character");
  assert.equal(zoneOf(g.engine, g.id("fh")), "hand");
  castFun(g);
  assert.equal(zoneOf(g.engine, g.id("fh")), "play", "control: two characters work");
});

clause(FUNHOUSE, "1:rule", "switches strength, life and speed between the two picked characters", () => {
  const g = fun();
  assert.deepEqual(trio(g, "foe"), [2, 5, 3]);
  assert.deepEqual(trio(g, "mine"), [4, 1, 6]);
  castFun(g);
  assert.deepEqual(trio(g, "foe"), [4, 1, 6], "theirs now has mine's str/life/spd");
  assert.deepEqual(trio(g, "mine"), [2, 5, 3], "mine now has theirs");
});

clause(FUNHOUSE, "1:rule", "a different pair switches: foe2 and mine2 swap and the others keep their stats", () => {
  const g = fun();
  castFun(g, "foe2", "mine2");
  assert.deepEqual(trio(g, "foe2"), [5, 6, 7]);
  assert.deepEqual(trio(g, "mine2"), [7, 8, 9]);
  assert.deepEqual(trio(g, "foe"), [2, 5, 3]);
  assert.deepEqual(trio(g, "mine"), [4, 1, 6]);
});

clause(FUNHOUSE, "1:rule", "lasts as long as Funhouse is in play: when it leaves play both characters read their own stats again", () => {
  const raze = tactic({
    name: "Raze",
    cost: 0,
    behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  } as never);
  const g = fun({ extra: [{ key: "raze", def: raze, owner: P1, zone: "hand" }] });
  castFun(g);
  assert.deepEqual(trio(g, "foe"), [4, 1, 6]);
  play(g.engine, P1, g.id("raze"), { selected: { t: [g.id("fh")] } });
  assert.equal(zoneOf(g.engine, g.id("fh")), "discard");
  assert.deepEqual(trio(g, "foe"), [2, 5, 3], "restored");
  assert.deepEqual(trio(g, "mine"), [4, 1, 6], "restored");
});

clause(FUNHOUSE, "1:rule", "a stat boost applied after the switch stacks on the switched value", () => {
  const boost = tactic({
    name: "Boost",
    cost: 0,
    behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "strength", operation: "add", value: 2, duration: { type: "untilEndOfTurn" } }] }] }
  } as never);
  const g = fun({ extra: [{ key: "boost", def: boost, owner: P1, zone: "hand" }] });
  castFun(g);
  play(g.engine, P1, g.id("boost"), { selected: { t: [g.id("mine")] } });
  assert.equal(g.engine.getStat(g.id("mine"), "strength"), 4, "switched 2 + boost 2");
});

// =====================================================================================================
// Carnival Whipmaster
// =====================================================================================================
const whip = (o: { zone?: "hand" | "play"; opp?: Cards; mine?: Cards; banks?: Cards; active?: string } = {}) => {
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: active === P1 ? 1 : 2,
    activePlayerId: active as never,
    cards: [
      { key: "w", def: printing(WHIP), owner: P1, zone: o.zone ?? "play" },
      { key: "f1", def: character({ name: "F1", strength: 2, life: 3, speed: 3 }), owner: P2, zone: "play" },
      { key: "f2", def: character({ name: "F2", strength: 1, life: 1, speed: 1 }), owner: P2, zone: "play" },
      { key: "i1", def: item({ name: "I1" }), owner: P2, zone: "play" },
      { key: "i2", def: item({ name: "I2" }), owner: P2, zone: "play" },
      { key: "m", def: character({ name: "M" }), owner: P1, zone: "play" },
      { key: "mi", def: item({ name: "MI" }), owner: P1, zone: "play" },
      ...(o.banks ?? []),
      ...(o.opp ?? []),
      ...(o.mine ?? [])
    ]
  });
};
type WH = ReturnType<typeof whip>;
const steal = (g: WH, ch = "f1", it = "i1") => activate(g.engine, P1, g.id("w"), "grand-theft", { selected: { ch: [g.id(ch)], it: [g.id(it)] } });
const ctl = (g: WH, k: string) => g.engine.state.cards[g.id(k)].controllerId;

clause(WHIP, "0:kw:TACTICAL", "has the tactical keyword and can be deployed in the opponent's response window like a tactic", () => {
  const g = whip({ zone: "hand", active: P2, banks: [...spent("deception", 2), ...bank("rage", 4, P1)], mine: [{ key: "a", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  assert.ok(g.engine.getKeywords(g.id("w")).includes("tactical"), "g.engine.getKeywords(g.id(\"w\")).includes(\"tactical\")");
  declareAttackOpenWindow(g.engine, P2, [g.id("a")]);
  play(g.engine, P1, g.id("w"));
  assert.equal(zoneOf(g.engine, g.id("w")), "play", "deployed during the opponent's attack");
});

clause(WHIP, "0:kw:TACTICAL", "a character without TACTICAL cannot be deployed in the same window", () => {
  const g = whip({
    zone: "hand",
    active: P2,
    banks: [...spent("deception", 2), ...bank("rage", 4, P1)],
    mine: [{ key: "a", def: character({ name: "Attacker" }), owner: P2, zone: "play" }, { key: "plain", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" }]
  });
  declareAttackOpenWindow(g.engine, P2, [g.id("a")]);
  refused(() => play(g.engine, P1, g.id("plain")), "non-tactical character in the opponent's window");
  assert.equal(zoneOf(g.engine, g.id("plain")), "hand");
});

clause(WHIP, "0:kw:TACTICAL", "printed: rogue performer character, cost 4, threshold dd, str 3 / spd 4 / life 3; deploys for exactly 4, refused one short either way", () => {
  const p = printing(WHIP);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "rogue");
  assert.deepEqual(p.subtype, ["performer"]);
  assert.equal(p.cost, 4);
  assert.equal(p.threshold, "dd");
  const g = whip();
  assert.equal(g.engine.getStat(g.id("w"), "strength"), 3);
  assert.equal(g.engine.getStat(g.id("w"), "speed"), 4);
  assert.equal(g.engine.getStat(g.id("w"), "life"), 3);
  costExact(WHIP, 4, "deception", 2)();
  costShort(WHIP, 4, "deception", 2)();
  thrShort(WHIP, 4, "deception", 2)();
});

clause(WHIP, "1:ability:grand-theft", "destroys itself as the cost and takes control of one opposing character and one opposing item", () => {
  const g = whip();
  steal(g);
  assert.equal(zoneOf(g.engine, g.id("w")), "discard", "COST: destroyed");
  assert.equal(ctl(g, "f1"), P1);
  assert.equal(ctl(g, "i1"), P1);
  assert.equal(g.engine.state.cards[g.id("f1")].ownerId, P2, "ownership unchanged");
  assert.equal(ctl(g, "f2"), P2, "other opposing character untouched");
  assert.equal(ctl(g, "i2"), P2, "other opposing item untouched");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(WHIP, "1:ability:grand-theft", "any opposing character and item can be chosen (second ones too)", () => {
  const g = whip();
  steal(g, "f2", "i2");
  assert.equal(ctl(g, "f2"), P1);
  assert.equal(ctl(g, "i2"), P1);
  assert.equal(ctl(g, "f1"), P2);
  assert.equal(ctl(g, "i1"), P2);
});

clause(WHIP, "1:ability:grand-theft", "the stolen cards are in my play area and keep their stats", () => {
  const g = whip();
  steal(g);
  assert.ok(g.engine.state.players[P1].play.includes(g.id("f1")), "g.engine.state.players[P1].play.includes(g.id(\"f1\"))");
  assert.ok(g.engine.state.players[P1].play.includes(g.id("i1")), "g.engine.state.players[P1].play.includes(g.id(\"i1\"))");
  assert.ok(!g.engine.state.players[P2].play.includes(g.id("f1")), "!g.engine.state.players[P2].play.includes(g.id(\"f1\"))");
  assert.equal(g.engine.getStat(g.id("f1"), "strength"), 2);
});

clause(WHIP, "1:ability:grand-theft", "must take one of each type: my own cards and wrong-type picks are refused", () => {
  const g = whip();
  refused(() => steal(g, "m", "i1"), "my own character as the character");
  refused(() => steal(g, "f1", "mi"), "my own item as the item");
  refused(() => steal(g, "i1", "i2"), "two items, no character");
  refused(() => steal(g, "f1", "f2"), "two characters, no item");
  assert.equal(zoneOf(g.engine, g.id("w")), "play", "Whipmaster not destroyed by refusals");
  steal(g);
  assert.equal(zoneOf(g.engine, g.id("w")), "discard", "control");
});

clause(WHIP, "1:ability:grand-theft", "with no opposing item (or no opposing character) it cannot be used; Whipmaster is not destroyed", () => {
  const noItem = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "w", def: printing(WHIP), owner: P1, zone: "play" },
      { key: "f1", def: character({ name: "F1" }), owner: P2, zone: "play" }
    ]
  });
  assert.throws(() => activate(noItem.engine, P1, noItem.id("w"), "grand-theft", { selected: { ch: [noItem.id("f1")] } }));
  assert.equal(zoneOf(noItem.engine, noItem.id("w")), "play");
  assert.equal(noItem.engine.state.cards[noItem.id("f1")].controllerId, P2);
  const noChar = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "w", def: printing(WHIP), owner: P1, zone: "play" },
      { key: "i1", def: item({ name: "I1" }), owner: P2, zone: "play" }
    ]
  });
  assert.throws(() => activate(noChar.engine, P1, noChar.id("w"), "grand-theft", { selected: { it: [noChar.id("i1")] } }));
  assert.equal(zoneOf(noChar.engine, noChar.id("w")), "play");
  assert.equal(noChar.engine.state.cards[noChar.id("i1")].controllerId, P2);
});

clause(FUNHOUSE, "1:rule", "the switch is not a this-turn effect: it is still in place after a full round of turns", () => {
  const g = fun();
  castFun(g);
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.deepEqual(trio(g, "foe"), [4, 1, 6]);
  assert.deepEqual(trio(g, "mine"), [2, 5, 3]);
  assert.equal(zoneOf(g.engine, g.id("fh")), "play");
});
