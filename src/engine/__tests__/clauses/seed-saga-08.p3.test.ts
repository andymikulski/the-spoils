// Batch seed-saga-08, part p3 (groups 12-17, clauses not covered elsewhere).
// Every test is written from the PRINTED text of the printing under test.

import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, SpoilsEngine } from "../../../engine.js";
import { buildGame, activate, bank, character, developFaction, item, location, P1, P2, play, resourceCard, tactic, volition } from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, printing, refused, flipUpNow } from "./_clause.js";
import { declareAttackBy, declareAttackOpenWindow, fight } from "./_battle.js";
import { answerPending, pending, readyResources, zoneOf } from "./_board.js";
import { endTurn } from "./_turn.js";

type Pid = typeof P1 | typeof P2;
type Pc = { kind: string; playerId: string; [k: string]: unknown };

const BUCK = "be1f9d58-c075-4bc4-9ca1-235ab980cb3c"; // Duskfall Buckgrif -- TACTICAL, UNIQUE BUCKGRIF -- SNEAK
const EOD = "6bccbbec-9b1d-4091-b711-33e05c00446c"; // Essence of Deception
const FH = "01ee5f0f-1c90-4fe0-9d79-2c8d081e59ae"; // Fired Hand
const KNIFE = "00186a1f-1215-4e64-9163-8f1ff603bbee"; // Flailing Knife
const DEN = "0a6c2548-8c2a-4352-a8ea-b97257aa2ac7"; // Gambling Den
const GUT = "1b0d88a8-85a2-4da6-83a9-19898059fc52"; // Guttersnipe

const pc = (engine: SpoilsEngine): Pc | undefined => pending(engine) as unknown as Pc | undefined;
const deckOf = (engine: SpoilsEngine, p: Pid): CardInstanceId[] => [...engine.state.players[p].deck];
const handOf = (engine: SpoilsEngine, p: Pid): CardInstanceId[] => [...engine.state.players[p].hand];
const stat = (engine: SpoilsEngine, c: CardInstanceId, s: "strength" | "speed" | "life" | "structure") => engine.getStat(c, s);
const kws = (engine: SpoilsEngine, c: CardInstanceId): string[] => engine.getKeywords(c) as unknown as string[];

/** `n` resources of `icon` for `owner`, already spent (attached to the faction): they count toward thresholds but can't pay. */
const spent = (icon: "rage" | "greed" | "deception" | "elitism" | "obsession", n: number, owner: Pid): CardPlacement[] =>
  bank(icon, n, owner).map((p) => ({ ...p, key: `${p.key}_sp`, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

const duo = (cards: CardPlacement[], o: { turn?: number; active?: Pid } = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards,
    random: () => 0.3,
    ...(o.turn ? { turn: o.turn, activePlayerId: o.active ?? (o.turn % 2 === 1 ? P1 : P2) } : {})
  });

/** A free tactic: destroys the one picked card in play (any type). Cast with `selected: { t: [...] }`. */
const killer = (name: string): CardDefinition =>
  tactic({
    name,
    cost: 0,
    behavior: { abilities: [{ id: "kill", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
/** A free tactic: returns the one picked card in play to its owner's hand. */
const bouncer = (name: string): CardDefinition =>
  tactic({
    name,
    cost: 0,
    behavior: { abilities: [{ id: "bounce", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });

const fillerDeck = (prefix: string, n: number, owner: Pid): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: character({ name: `${prefix}${i}` }), owner, zone: "deck" as const }));

// =====================================================================================
// Duskfall Buckgrif -- TACTICAL, UNIQUE BUCKGRIF -- SNEAK (COST: Pay 1. EFFECT: gains COVERT this turn.)
// =====================================================================================

const buckBoard = (extra: CardPlacement[] = [], o: { buck?: "hand" | "play"; turn?: number; active?: Pid } = {}) =>
  duo([{ key: "buck", def: printing(BUCK), owner: P1, zone: o.buck ?? "play" }, ...extra], { turn: o.turn, active: o.active });

clause(BUCK, "0:kw:TACTICAL", "deploys from hand for the printed cost 3 and threshold [D][D][D], with printed stats 3 / 4 / 3 and subtypes seraphim, dragon", () => {
  const mk = (cards: CardPlacement[]) => buckBoard(cards, { buck: "hand" });
  const short = mk(bank("deception", 2, P1));
  refused(() => play(short.engine, P1, short.id("buck")), "cost 3 with only 2 resources");
  assert.equal(zoneOf(short.engine, short.id("buck")), "hand");
  const thr = mk([...bank("deception", 2, P1), ...bank("rage", 1, P1)]);
  refused(() => play(thr.engine, P1, thr.id("buck")), "three resources but only two [D] of [D][D][D]", /threshold/i);
  assert.equal(zoneOf(thr.engine, thr.id("buck")), "hand");
  const costOnly = mk([...bank("deception", 2, P1), ...spent("deception", 1, P1)]);
  refused(() => play(costOnly.engine, P1, costOnly.id("buck")), "the threshold is met (a spent [D] counts) but only 2 resources can pay the cost of 3", /Costs cannot be paid/);
  assert.equal(zoneOf(costOnly.engine, costOnly.id("buck")), "hand");
  const ok = mk(bank("deception", 3, P1));
  const before = readyResources(ok.engine, P1);
  play(ok.engine, P1, ok.id("buck"));
  assert.equal(zoneOf(ok.engine, ok.id("buck")), "play");
  assert.equal(before - readyResources(ok.engine, P1), 3, "three resources paid");
  assert.deepEqual([stat(ok.engine, ok.id("buck"), "strength"), stat(ok.engine, ok.id("buck"), "speed"), stat(ok.engine, ok.id("buck"), "life")], [3, 4, 3]);
  const def = ok.engine.getDefinition(ok.id("buck"));
  assert.equal(def.type, "character");
  assert.deepEqual([...def.subtype].sort(), ["dragon", "seraphim"]);
});

clause(BUCK, "0:kw:TACTICAL", "the card has the TACTICAL keyword (a plain character does not)", () => {
  const { engine, id } = buckBoard([{ key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "play" }]);
  assert.ok(kws(engine, id("buck")).includes("tactical"), "kws(engine, id(\"buck\")).includes(\"tactical\")");
  assert.equal(kws(engine, id("plain")).includes("tactical"), false, "control: an ordinary character is not tactical");
});

clause(BUCK, "0:kw:TACTICAL", "it can be deployed from hand whenever a tactic could be (the opponent's attack window); an ordinary character and the no-window case are refused", () => {
  const { engine, id } = buckBoard(
    [
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 6, speed: 2 }), owner: P2, zone: "play" },
      { key: "plain", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" },
      ...bank("deception", 3, P1)
    ],
    { buck: "hand", turn: 2, active: P2 }
  );
  refused(() => play(engine, P1, id("buck")), "the opponent's turn with no response window open");
  assert.equal(zoneOf(engine, id("buck")), "hand");
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  refused(() => play(engine, P1, id("plain")), "a non-tactical character can't be deployed on the opponent's turn");
  assert.equal(zoneOf(engine, id("plain")), "hand");
  const before = readyResources(engine, P1);
  play(engine, P1, id("buck"));
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("buck")), "play", "the TACTICAL character can");
  assert.equal(before - readyResources(engine, P1), 3, "still pays the full cost 3");
});

clause(BUCK, "0:kw:TACTICAL", "TACTICAL changes the timing only: the [D][D][D] threshold is still required in the window", () => {
  const mk = (cards: CardPlacement[]) => {
    const b = buckBoard([{ key: "atk", def: character({ name: "Atk", strength: 1, life: 6, speed: 2 }), owner: P2, zone: "play" }, ...cards], { buck: "hand", turn: 2, active: P2 });
    declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
    return b;
  };
  const short = mk([...bank("deception", 2, P1), ...bank("rage", 3, P1)]);
  refused(() => play(short.engine, P1, short.id("buck")), "only two [D]", /threshold/i);
  assert.equal(zoneOf(short.engine, short.id("buck")), "hand");
  const ok = mk(bank("deception", 3, P1));
  play(ok.engine, P1, ok.id("buck"));
  assert.equal(zoneOf(ok.engine, ok.id("buck")), "play");
});

clause(BUCK, "0:unique", "a second Buckgrif under my control: I choose which to keep (keep the new one: the old one is destroyed)", () => {
  const { engine, id } = duo([
    { key: "buck", def: printing(BUCK), owner: P1, zone: "play" },
    { key: "buck2", def: printing(BUCK), owner: P1, zone: "hand" },
    ...bank("deception", 3, P1)
  ]);
  play(engine, P1, id("buck2"));
  const p = pc(engine)!;
  assert.equal(p.kind, "uniqueSurvivor");
  assert.equal(p.playerId, P1);
  assert.deepEqual([...(p.candidates as string[])].sort(), [id("buck"), id("buck2")].sort());
  answerPending(engine, "uniqueSurvivor", { keep: id("buck2") });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("buck2")), "play");
  assert.equal(zoneOf(engine, id("buck")), "discard", "the other copy is destroyed");
});

clause(BUCK, "0:unique", "keeping the old copy destroys the new one; a bystander is not a legal survivor", () => {
  const { engine, id } = duo([
    { key: "buck", def: printing(BUCK), owner: P1, zone: "play" },
    { key: "buck2", def: printing(BUCK), owner: P1, zone: "hand" },
    { key: "bystander", def: character({ name: "Bystander" }), owner: P1, zone: "play" },
    ...bank("deception", 3, P1)
  ]);
  play(engine, P1, id("buck2"));
  refused(() => answerPending(engine, "uniqueSurvivor", { keep: id("bystander") }), "a bystander is not a copy", /./);
  assert.equal(zoneOf(engine, id("bystander")), "play");
  assert.ok(pending(engine), "still waiting for a real answer");
  answerPending(engine, "uniqueSurvivor", { keep: id("buck") });
  assert.equal(zoneOf(engine, id("buck")), "play");
  assert.equal(zoneOf(engine, id("buck2")), "discard");
});

clause(BUCK, "0:unique", "UNIQUE is per player (the opponent may control their own Buckgrif with no choice); a different unique identifier never conflicts", () => {
  const { engine, id } = duo(
    [
      { key: "buck", def: printing(BUCK), owner: P1, zone: "play" },
      { key: "buck2", def: printing(BUCK), owner: P2, zone: "hand" },
      ...bank("deception", 3, P2)
    ],
    { turn: 2, active: P2 }
  );
  play(engine, P2, id("buck2"));
  assert.equal(pending(engine), undefined, "no survivor choice");
  assert.equal(zoneOf(engine, id("buck")), "play");
  assert.equal(zoneOf(engine, id("buck2")), "play");
  const other = duo([
    { key: "buck", def: printing(BUCK), owner: P1, zone: "play" },
    { key: "o", def: character({ name: "Other Unique", unique: "someoneelse", cost: 0 }), owner: P1, zone: "hand" }
  ]);
  play(other.engine, P1, other.id("o"));
  assert.equal(pending(other.engine), undefined);
  assert.equal(zoneOf(other.engine, other.id("buck")), "play");
});

const sneakBoard = (o: { rage?: number; spentRage?: number } = {}) =>
  buckBoard([
    { key: "plainBlocker", def: character({ name: "PlainBlocker" }), owner: P2, zone: "play" },
    { key: "covertBlocker", def: character({ name: "CovertBlocker", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" },
    ...bank("rage", o.rage ?? 1, P1),
    ...spent("rage", o.spentRage ?? 0, P1)
  ]);

clause(BUCK, "1:ability:sneak", "COST: pay 1 resource; EFFECT: this card gains COVERT", () => {
  const { engine, id } = sneakBoard({ rage: 3 });
  assert.equal(kws(engine, id("buck")).includes("covert"), false, "no COVERT before");
  const before = readyResources(engine, P1);
  activate(engine, P1, id("buck"), "sneak");
  assert.equal(before - readyResources(engine, P1), 1, "exactly 1 resource paid");
  assert.ok(kws(engine, id("buck")).includes("covert"), "kws(engine, id(\"buck\")).includes(\"covert\")");
  assert.ok(kws(engine, id("buck")).includes("tactical"), "its other keyword is untouched");
});

clause(BUCK, "1:ability:sneak", "refused when no resource is ready to pay 1", () => {
  const none = sneakBoard({ rage: 0, spentRage: 2 });
  refused(() => activate(none.engine, P1, none.id("buck"), "sneak"), "only spent resources", /cannot be paid|resource|pay|afford/i);
  assert.equal(kws(none.engine, none.id("buck")).includes("covert"), false);
  const ok = sneakBoard({ rage: 1, spentRage: 2 });
  activate(ok.engine, P1, ok.id("buck"), "sneak");
  assert.ok(kws(ok.engine, ok.id("buck")).includes("covert"), "control: one ready resource is enough");
});

clause(BUCK, "1:ability:sneak", "with COVERT it attacks alone: a non-covert character can't block it, a covert one can; without Sneak a plain character can block", () => {
  const { engine, id } = sneakBoard();
  activate(engine, P1, id("buck"), "sneak");
  declareAttackBy(engine, P1, [id("buck")]);
  assert.throws(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("plainBlocker")] }), "a non-covert character cannot block");
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("covertBlocker")] });
  assert.deepEqual(engine.state.battle?.blockingParty, [id("covertBlocker")]);
  const control = sneakBoard();
  declareAttackBy(control.engine, P1, [control.id("buck")]);
  control.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [control.id("plainBlocker")] });
  assert.deepEqual(control.engine.state.battle?.blockingParty, [control.id("plainBlocker")], "control: without Sneak anyone can block");
});

clause(BUCK, "1:ability:sneak", "COVERT lasts this turn only", () => {
  const { engine, id } = sneakBoard();
  activate(engine, P1, id("buck"), "sneak");
  assert.ok(kws(engine, id("buck")).includes("covert"), "kws(engine, id(\"buck\")).includes(\"covert\")");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(kws(engine, id("buck")).includes("covert"), false, "gone at the end of the turn");
  endTurn(engine, P2);
  assert.equal(kws(engine, id("buck")).includes("covert"), false, "and it stays gone on my next turn");
});

clause(BUCK, "1:ability:sneak", "it can be used on the opponent's turn inside a response window: it gains COVERT there too, and the cost is paid", () => {
  const { engine, id } = buckBoard(
    [{ key: "atk", def: character({ name: "Atk", strength: 1, life: 6, speed: 2 }), owner: P2, zone: "play" }, ...bank("rage", 2, P1)],
    { turn: 2, active: P2 }
  );
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  const before = readyResources(engine, P1);
  activate(engine, P1, id("buck"), "sneak");
  assert.ok(kws(engine, id("buck")).includes("covert"), "kws(engine, id(\"buck\")).includes(\"covert\")");
  assert.equal(before - readyResources(engine, P1), 1);
});

// =====================================================================================
// Essence of Deception -- choose one of three options as this card's rules text
// =====================================================================================

type EodOpts = { dd?: number; spentD?: number; rage?: number; turn?: number; active?: Pid; extra?: CardPlacement[]; oppDeck?: number };
const eodBoard = (o: EodOpts = {}) =>
  duo(
    [
      { key: "eod", def: printing(EOD), owner: P1, zone: "hand" },
      ...bank("deception", o.dd ?? 2, P1),
      ...spent("deception", o.spentD ?? 0, P1),
      ...bank("rage", o.rage ?? 0, P1),
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" },
      ...fillerDeck("o", o.oppDeck ?? 5, P2),
      ...fillerDeck("p", 4, P1),
      ...(o.extra ?? [])
    ],
    { turn: o.turn, active: o.active }
  );

clause(EOD, "0:rule", "is a tactic costing 1 with threshold [D][D]: refused with the cost unaffordable or the threshold short, and the cost is paid", () => {
  const ok = eodBoard({ dd: 2 });
  assert.equal(ok.engine.getDefinition(ok.id("eod")).type, "tactic");
  const before = readyResources(ok.engine, P1);
  play(ok.engine, P1, ok.id("eod"), { mode: 1, selected: { c: [ok.id("foe")] } });
  assert.equal(before - readyResources(ok.engine, P1), 1, "cost 1 paid");
  assert.equal(zoneOf(ok.engine, ok.id("eod")), "discard", "the tactic goes to the discard pile");
  const exact = eodBoard({ dd: 1, spentD: 1 });
  play(exact.engine, P1, exact.id("eod"), { mode: 1, selected: { c: [exact.id("foe")] } });
  assert.equal(zoneOf(exact.engine, exact.id("eod")), "discard", "a spent [D] counts toward the threshold; one ready resource pays the cost");
  const noCost = eodBoard({ dd: 0, spentD: 2 });
  refused(() => play(noCost.engine, P1, noCost.id("eod"), { mode: 1, selected: { c: [noCost.id("foe")] } }), "threshold met by spent [D] but nothing can pay cost 1", /Costs cannot be paid/);
  assert.equal(zoneOf(noCost.engine, noCost.id("eod")), "hand");
  const thr = eodBoard({ dd: 1, rage: 1 });
  refused(() => play(thr.engine, P1, thr.id("eod"), { mode: 1, selected: { c: [thr.id("foe")] } }), "two resources but only one [D]", /threshold/i);
  assert.equal(zoneOf(thr.engine, thr.id("eod")), "hand");
});

clause(EOD, "0:rule", "exactly one option is chosen: a mode index outside OPTION 1-3 is refused, and an option applies none of the others", () => {
  const bad = eodBoard();
  refused(() => play(bad.engine, P1, bad.id("eod"), { mode: 3, selected: { c: [bad.id("foe")] } }), "there are only three options");
  assert.equal(zoneOf(bad.engine, bad.id("eod")), "hand");
  // OPTION 2 only: no search, no destruction of a damaged character, only the speed
  const b = eodBoard();
  const oppDeck = deckOf(b.engine, P2);
  play(b.engine, P1, b.id("eod"), { mode: 1, selected: { c: [b.id("foe")] } });
  assert.equal(pending(b.engine), undefined);
  assert.deepEqual(deckOf(b.engine, P2), oppDeck, "OPTION 1 did not also happen");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play", "OPTION 3 did not also happen");
  assert.equal(stat(b.engine, b.id("foe"), "speed"), 3);
});

const searchOpp = (b: ReturnType<typeof eodBoard>, pick: string | undefined) => {
  play(b.engine, P1, b.id("eod"), { mode: 0 });
  const p = pc(b.engine)!;
  assert.equal(p.kind, "chooserSelectsTarget");
  assert.equal(p.playerId, P1, "the tactic's controller searches");
  answerPending(b.engine, "chooserSelectsTarget", { selected: pick ? [b.id(pick)] : [] });
};

clause(EOD, "1:option:OPTION 1", "searches the opponent's deck for a card and puts it into THEIR discard pile; nothing else of theirs or mine moves", () => {
  const b = eodBoard();
  const oppDeck = deckOf(b.engine, P2);
  const myDeck = deckOf(b.engine, P1);
  const myDiscard = [...b.engine.state.players[P1].discard];
  const oppDiscard = [...b.engine.state.players[P2].discard];
  const myHand = handOf(b.engine, P1).filter((c) => c !== b.id("eod"));
  searchOpp(b, "o3");
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("o3")), "discard");
  assert.deepEqual([...b.engine.state.players[P2].discard].sort(), [...oppDiscard, b.id("o3")].sort(), "it is in the OPPONENT's discard pile");
  assert.deepEqual(deckOf(b.engine, P2).slice().sort(), oppDeck.filter((c) => c !== b.id("o3")).sort(), "the other four stay in their deck");
  assert.deepEqual(deckOf(b.engine, P1), myDeck, "my deck untouched");
  assert.deepEqual([...b.engine.state.players[P1].discard].filter((c) => c !== b.id("eod")), myDiscard, "my discard pile only gained the tactic");
  assert.deepEqual(handOf(b.engine, P1), myHand);
  assert.equal(stat(b.engine, b.id("foe"), "speed"), 2, "OPTION 2 did not also happen");
});

clause(EOD, "1:option:OPTION 1", "any card of the opponent's deck can be picked (first and last); my deck's cards, their hand and board are not searchable", () => {
  for (const key of ["o0", "o4"]) {
    const b = eodBoard();
    searchOpp(b, key);
    assert.equal(zoneOf(b.engine, b.id(key)), "discard", `${key} can be picked`);
  }
  for (const key of ["p0", "inHand", "foe", "inDiscard"]) {
    const b = eodBoard();
    play(b.engine, P1, b.id("eod"), { mode: 0 });
    refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id(key)] }), `${key} is not in the opponent's deck`);
    if (key === "inDiscard") assert.equal(b.engine.state.players[P2].discard.length, 1, "their discard pile is unchanged");
    else assert.notEqual(zoneOf(b.engine, b.id(key)), "discard", `${key} stays put`);
  }
});

clause(EOD, "1:option:OPTION 1", "exactly one card is searched for: picking two is refused, and only the one picked card moves", () => {
  const b = eodBoard();
  play(b.engine, P1, b.id("eod"), { mode: 0 });
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("o1"), b.id("o2")] }), "only one card");
  assert.equal(zoneOf(b.engine, b.id("o1")), "deck");
  assert.equal(zoneOf(b.engine, b.id("o2")), "deck");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("o1")] });
  assert.equal(b.engine.state.players[P2].discard.length, 2, "exactly one card added to their discard pile (one was already there)");
  assert.equal(deckOf(b.engine, P2).length, 4);
});

clause(EOD, "1:option:OPTION 1", "the opponent's deck is shuffled after the search (CR 312.1), whether a card was found or not; a failed search puts nothing into the discard pile", () => {
  const found = eodBoard();
  const before = deckOf(found.engine, P2);
  searchOpp(found, "o4");
  const afterFound = deckOf(found.engine, P2);
  assert.notDeepEqual(afterFound, before.filter((c) => c !== found.id("o4")), "shuffled after a found search");
  // W2.4 (SYS-20): OPTION 1 is an unconditional search, so with cards in the deck it can no longer be failed (CR 312.2).
  // (This used to assert the shuffle after a failed search; whether a declined search shuffles is ruling Q2 (data/rule-tests/rulings.md), so it is not asserted here.)
  const failed = eodBoard();
  const beforeFail = deckOf(failed.engine, P2);
  const discardBefore = [...failed.engine.state.players[P2].discard];
  refused(() => searchOpp(failed, undefined), "the unconditional search must find a card while the deck has any");
  assert.deepEqual([...failed.engine.state.players[P2].discard], discardBefore, "nothing discarded by the refused pick");
  assert.deepEqual(deckOf(failed.engine, P2), beforeFail, "the deck is untouched by the refused pick");
});

clause(EOD, "1:option:OPTION 1", "an empty opponent deck: the search finds nothing and the tactic still resolves", () => {
  const b = eodBoard({ oppDeck: 0 });
  play(b.engine, P1, b.id("eod"), { mode: 0 });
  if (pc(b.engine)) answerPending(b.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("eod")), "discard");
  assert.equal(deckOf(b.engine, P2).length, 0);
});

clause(EOD, "2:option:OPTION 2", "EXTRA COST: pick a character (any controller); EFFECT: it gains 1 speed", () => {
  for (const [key, was] of [["mine", 2], ["foe", 2]] as const) {
    const b = eodBoard();
    assert.equal(stat(b.engine, b.id(key), "speed"), was);
    play(b.engine, P1, b.id("eod"), { mode: 1, selected: { c: [b.id(key)] } });
    assert.equal(stat(b.engine, b.id(key), "speed"), was + 1, `${key} gained 1 speed`);
    const otherKey = key === "mine" ? "foe" : "mine";
    assert.equal(stat(b.engine, b.id(otherKey), "speed"), 2, "the other character is unaffected");
    assert.equal(stat(b.engine, b.id(key), "strength"), 2, "only speed changed");
    assert.equal(stat(b.engine, b.id(key), "life"), 5, "only speed changed");
  }
});

clause(EOD, "2:option:OPTION 2", "the picked card must be a character IN PLAY: items, locations and characters in hand or discard are refused, and a target is required", () => {
  for (const key of ["thing", "place", "inHand", "inDiscard"]) {
    const b = eodBoard();
    refused(() => play(b.engine, P1, b.id("eod"), { mode: 1, selected: { c: [b.id(key)] } }), `${key} is not a character in play`);
    assert.equal(zoneOf(b.engine, b.id("eod")), "hand", `${key}: the tactic wasn't cast`);
  }
  const none = eodBoard();
  refused(() => play(none.engine, P1, none.id("eod"), { mode: 1 }), "OPTION 2 needs its picked character");
  assert.equal(zoneOf(none.engine, none.id("eod")), "hand");
});

clause(EOD, "2:option:OPTION 2", "the speed bonus lasts this turn only", () => {
  const b = eodBoard();
  play(b.engine, P1, b.id("eod"), { mode: 1, selected: { c: [b.id("mine")] } });
  assert.equal(stat(b.engine, b.id("mine"), "speed"), 3);
  endTurn(b.engine, P1);
  assert.equal(stat(b.engine, b.id("mine"), "speed"), 2, "back to printed speed after the turn");
});

clause(EOD, "2:option:OPTION 2", "the pick is part of the cost: the cost is already paid while the tactic waits for responses", () => {
  const b = eodBoard();
  const before = readyResources(b.engine, P1);
  b.engine.perform({ type: "playCard", playerId: P1, cardId: b.id("eod"), selected: { c: [b.id("mine")] }, variables: {}, mode: 1 } as never);
  assert.equal(before - readyResources(b.engine, P1), 1, "cost 1 paid on cast");
  assert.equal(zoneOf(b.engine, b.id("eod")) === "hand", false, "the tactic left the hand");
});

/** P1 attacks with A (blocked by B); both survive with 1 damage. Then C is undamaged and D carries preset damage. */
const damagedBoard = (o: { eodOwner?: Pid } = {}) =>
  eodBoard({
    extra: [
      { key: "A", def: character({ name: "A", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "B", def: character({ name: "B", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "C", def: character({ name: "C", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "D", def: character({ name: "D", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play", damage: 1 }
    ]
  });
const afterBattle = () => {
  const b = damagedBoard();
  fight(b.engine, P1, [b.id("A")], { type: "faction", playerId: P2 }, [b.id("B")]);
  assert.equal(pending(b.engine), undefined);
  assert.equal(b.engine.state.cards[b.id("B")].damage, 1, "B was damaged in the battle");
  assert.equal(zoneOf(b.engine, b.id("B")), "play");
  return b;
};

clause(EOD, "3:option:OPTION 3", "EFFECT: a picked character that has had damage inflicted this turn is destroyed (both sides' characters)", () => {
  const b = afterBattle();
  play(b.engine, P1, b.id("eod"), { mode: 2, selected: { c: [b.id("B")] } });
  assert.equal(zoneOf(b.engine, b.id("B")), "discard", "damaged this turn: destroyed");
  assert.equal(zoneOf(b.engine, b.id("A")), "play", "A is untouched");
  const mine = afterBattle();
  play(mine.engine, P1, mine.id("eod"), { mode: 2, selected: { c: [mine.id("A")] } });
  assert.equal(zoneOf(mine.engine, mine.id("A")), "discard", "my own damaged character is destroyed too");
  assert.equal(zoneOf(mine.engine, mine.id("B")), "play");
});

clause(EOD, "3:option:OPTION 3", "an undamaged character, and one whose damage predates this turn (preset), is NOT destroyed; the tactic is still spent", () => {
  const b = afterBattle();
  play(b.engine, P1, b.id("eod"), { mode: 2, selected: { c: [b.id("C")] } });
  assert.equal(zoneOf(b.engine, b.id("C")), "play", "no damage this turn: stays");
  assert.equal(zoneOf(b.engine, b.id("eod")), "discard");
  const d = afterBattle();
  play(d.engine, P1, d.id("eod"), { mode: 2, selected: { c: [d.id("D")] } });
  assert.equal(zoneOf(d.engine, d.id("D")), "play", "damage that was not inflicted this turn doesn't count");
});

clause(EOD, "3:option:OPTION 3", "damage inflicted on an earlier turn doesn't count: the character damaged last turn survives", () => {
  const b = afterBattle();
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  play(b.engine, P1, b.id("eod"), { mode: 2, selected: { c: [b.id("B")] } });
  assert.equal(zoneOf(b.engine, b.id("B")), "play", "damaged last turn, not this turn");
});

clause(EOD, "3:option:OPTION 3", "the pick must be a character in play (items, locations, hand and discard cards refused) and is required; no search or speed happens", () => {
  for (const key of ["thing", "place", "inHand", "inDiscard"]) {
    const b = afterBattle();
    refused(() => play(b.engine, P1, b.id("eod"), { mode: 2, selected: { c: [b.id(key)] } }), `${key} is not a character in play`);
    assert.equal(zoneOf(b.engine, b.id("eod")), "hand");
  }
  const none = afterBattle();
  refused(() => play(none.engine, P1, none.id("eod"), { mode: 2 }), "OPTION 3 needs its picked character");
  const b = afterBattle();
  const oppDeck = deckOf(b.engine, P2);
  play(b.engine, P1, b.id("eod"), { mode: 2, selected: { c: [b.id("B")] } });
  assert.deepEqual(deckOf(b.engine, P2), oppDeck, "OPTION 1 did not also happen");
  assert.equal(stat(b.engine, b.id("C"), "speed"), 2, "OPTION 2 did not also happen");
});

// =====================================================================================
// Fired Hand
// =====================================================================================

const fhBoard = (o: { fh?: Partial<CardPlacement>; extra?: CardPlacement[]; turn?: number; active?: Pid } = {}) =>
  duo(
    [
      { key: "fh", def: printing(FH), owner: P1, zone: "play", ...(o.fh ?? {}) },
      { key: "killer", def: killer("Killer"), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      ...(o.extra ?? [])
    ],
    { turn: o.turn, active: o.active }
  );

const kill = (b: ReturnType<typeof fhBoard>, target: string) => play(b.engine, P1, b.id("killer"), { selected: { t: [b.id(target)] } });

clause(FH, "0:rule", "deploys from hand for the printed cost 6 and threshold [D], with printed stats 5 / 3 / 4 and subtype miner", () => {
  const mk = (cards: CardPlacement[]) => duo([{ key: "fh", def: printing(FH), owner: P1, zone: "hand" }, ...cards]);
  const short = mk([...bank("deception", 1, P1), ...bank("rage", 4, P1)]);
  refused(() => play(short.engine, P1, short.id("fh")), "cost 6 with only 5 resources");
  const noThr = mk(bank("rage", 6, P1));
  refused(() => play(noThr.engine, P1, noThr.id("fh")), "six resources but no [D]", /threshold/i);
  const costOnly = mk([...bank("rage", 5, P1), ...spent("deception", 1, P1)]);
  refused(() => play(costOnly.engine, P1, costOnly.id("fh")), "threshold met by a spent [D], but only 5 can pay", /Costs cannot be paid/);
  const ok = mk([...bank("deception", 1, P1), ...bank("rage", 5, P1)]);
  const before = readyResources(ok.engine, P1);
  play(ok.engine, P1, ok.id("fh"));
  assert.equal(zoneOf(ok.engine, ok.id("fh")), "play");
  assert.equal(before - readyResources(ok.engine, P1), 6, "six paid");
  assert.deepEqual([stat(ok.engine, ok.id("fh"), "strength"), stat(ok.engine, ok.id("fh"), "speed"), stat(ok.engine, ok.id("fh"), "life")], [5, 3, 4]);
  const def = ok.engine.getDefinition(ok.id("fh"));
  assert.equal(def.type, "character");
  assert.deepEqual([...def.subtype], ["miner"]);
});

clause(FH, "0:rule", "destroyed by an effect: it is not discarded; it is flipped face-down, stays in play, under its owner's control (a resource again)", () => {
  const b = fhBoard();
  assert.equal(b.engine.state.cards[b.id("fh")].faceDown, false);
  assert.equal(b.engine.isResource(b.id("fh")), false, "a face-up character is not a resource");
  kill(b, "fh");
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("fh")), "play", "still in play, not the discard pile");
  assert.equal(b.engine.state.cards[b.id("fh")].faceDown, true, "face-down");
  assert.equal(b.engine.state.cards[b.id("fh")].controllerId, P1, "under its owner's control");
  assert.equal(b.engine.state.players[P1].discard.includes(b.id("fh")), false);
  assert.equal(b.engine.isResource(b.id("fh")), true, "as a face-down card it is a resource again");
});

clause(FH, "0:rule", "control: another character destroyed by the same effect goes to the discard pile", () => {
  const b = fhBoard();
  kill(b, "mine");
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  assert.equal(zoneOf(b.engine, b.id("fh")), "play");
  assert.equal(b.engine.state.cards[b.id("fh")].faceDown, false, "Fired Hand itself untouched");
});

clause(FH, "0:rule", "destroyed by lethal battle damage (blocking): it ends face-down in play, not in the discard pile", () => {
  const b = fhBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Atk", strength: 9, life: 9, speed: 2 }), owner: P2, zone: "play" }]
  });
  fight(b.engine, P2, [b.id("atk")], { type: "faction", playerId: P1 }, [b.id("fh")]);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("fh")), "play", "not destroyed to the discard pile");
  assert.equal(b.engine.state.cards[b.id("fh")].faceDown, true);
  assert.equal(b.engine.state.cards[b.id("fh")].controllerId, P1);
});

clause(FH, "0:rule", "controlled by the opponent (owner P1, controller P2) when destroyed: it comes back face-down under its OWNER's control", () => {
  const b = fhBoard({ fh: { controller: P2 } });
  assert.equal(b.engine.state.cards[b.id("fh")].controllerId, P2);
  kill(b, "fh");
  assert.equal(zoneOf(b.engine, b.id("fh")), "play");
  assert.equal(b.engine.state.cards[b.id("fh")].faceDown, true);
  assert.equal(b.engine.state.cards[b.id("fh")].controllerId, P1, "under its owner's control");
});

const pvBoard = (o: { rage?: number; fh?: Partial<CardPlacement>; hand?: number; extra?: CardPlacement[] } = {}) =>
  fhBoard({
    fh: { faceDown: true, ...(o.fh ?? {}) },
    extra: [
      ...bank("rage", o.rage ?? 2, P1),
      ...Array.from({ length: o.hand ?? 2 }, (_, i) => ({ key: `h${i}`, def: character({ name: `H${i}` }), owner: P1, zone: "hand" as const })),
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" },
      ...(o.extra ?? [])
    ]
  });
const petty = (b: ReturnType<typeof pvBoard>, target = "foe", toss = "h0") =>
  activate(b.engine, P1, b.id("fh"), "petty-vengeance", { selected: { c: [b.id(target)], toss: [b.id(toss)] } });

clause(FH, "1:ability:petty-vengeance", "usable while face-down: pays 1, discards the chosen card from hand, and the picked character loses 1 life", () => {
  const b = pvBoard();
  const ready = readyResources(b.engine, P1);
  const handBefore = handOf(b.engine, P1);
  petty(b, "foe", "h1");
  assert.equal(pending(b.engine), undefined);
  assert.equal(ready - readyResources(b.engine, P1), 1, "Pay 1: exactly one resource spent");
  assert.equal(zoneOf(b.engine, b.id("h1")), "discard", "the chosen card was discarded");
  assert.equal(zoneOf(b.engine, b.id("h0")), "hand", "only one card discarded");
  assert.equal(handOf(b.engine, P1).length, handBefore.length - 1);
  assert.equal(stat(b.engine, b.id("foe"), "life"), 2, "life 3 -> 2");
  assert.equal(stat(b.engine, b.id("mine"), "life"), 3, "other characters unaffected");
  assert.equal(stat(b.engine, b.id("foe"), "strength"), 2, "only life changed");
  assert.equal(b.engine.state.cards[b.id("fh")].faceDown, true, "revealing doesn't flip it face-up");
});

clause(FH, "1:ability:petty-vengeance", "COST: Reveal this card (it is revealed to everyone)", () => {
  const b = pvBoard();
  petty(b);
  const reveals = b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed");
  const ids = reveals.flatMap((e) => (e.event as unknown as { cardIds: string[] }).cardIds);
  assert.ok(ids.includes(b.id("fh")), "Fired Hand was revealed as part of the cost");
});

clause(FH, "1:ability:petty-vengeance", "the pick can be any character in play (mine too); items, locations and non-play cards are refused", () => {
  const mine = pvBoard();
  petty(mine, "mine");
  assert.equal(stat(mine.engine, mine.id("mine"), "life"), 2, "my own character may be picked");
  for (const key of ["thing", "place", "inDiscard", "h1"]) {
    const b = pvBoard();
    refused(() => petty(b, key), `${key} is not a character in play`);
    assert.equal(zoneOf(b.engine, b.id("h0")), "hand", `${key}: no card discarded`);
  }
});

clause(FH, "1:ability:petty-vengeance", "the discard cost takes a card from MY hand only: the opponent's hand card, a card in a discard pile and a card in play are refused", () => {
  const extra: CardPlacement[] = [
    { key: "oh", def: character({ name: "OppHand" }), owner: P2, zone: "hand" },
    { key: "md", def: character({ name: "MyDisc" }), owner: P1, zone: "discard" }
  ];
  for (const toss of ["oh", "md", "thing", "foe"]) {
    const b = pvBoard({ extra });
    refused(() => petty(b, "foe", toss), `${toss} is not a card in my hand`);
    assert.equal(stat(b.engine, b.id("foe"), "life"), 3, `${toss}: no life lost`);
    assert.equal(zoneOf(b.engine, b.id("h0")), "hand", `${toss}: my hand untouched`);
  }
  const ok = pvBoard({ extra });
  petty(ok, "foe", "h1");
  assert.equal(zoneOf(ok.engine, ok.id("h1")), "discard", "control: a card of my hand pays it");
});

clause(FH, "1:ability:petty-vengeance", "the life loss lasts this turn only; a damaged character that drops to its reduced life is destroyed", () => {
  const b = pvBoard();
  petty(b);
  assert.equal(stat(b.engine, b.id("foe"), "life"), 2);
  endTurn(b.engine, P1);
  assert.equal(stat(b.engine, b.id("foe"), "life"), 3, "back to printed life after the turn");
  const lethal = pvBoard({ extra: [{ key: "hurt", def: character({ name: "Hurt", life: 3 }), owner: P2, zone: "play", damage: 2 }] });
  petty(lethal, "hurt");
  assert.equal(zoneOf(lethal.engine, lethal.id("hurt")), "discard", "damage 2 >= life 2");
  const ok = pvBoard({ extra: [{ key: "hurt", def: character({ name: "Hurt", life: 3 }), owner: P2, zone: "play", damage: 1 }] });
  petty(ok, "hurt");
  assert.equal(zoneOf(ok.engine, ok.id("hurt")), "play", "damage 1 < life 2");
});

clause(FH, "1:ability:petty-vengeance", "refused while this card is face-up in play, or in hand (it must be a face-down resource)", () => {
  const up = pvBoard({ fh: { faceDown: false } });
  refused(() => petty(up), "face-up Fired Hand", /face|ability|activ/i);
  assert.equal(stat(up.engine, up.id("foe"), "life"), 3);
  assert.equal(zoneOf(up.engine, up.id("h0")), "hand");
  const inHand = pvBoard({ fh: { zone: "hand", faceDown: false } });
  refused(() => petty(inHand), "in hand");
  assert.equal(stat(inHand.engine, inHand.id("foe"), "life"), 3);
  const ok = pvBoard();
  petty(ok);
  assert.equal(stat(ok.engine, ok.id("foe"), "life"), 2, "control: face-down works");
});

clause(FH, "1:ability:petty-vengeance", "COST: Pay 1 (refused when no resource is ready) and Discard a card (refused with an empty hand / no card chosen)", () => {
  const noPay = pvBoard({ rage: 0, fh: { attachedToKey: "__factionA" } });
  refused(() => petty(noPay), "no ready resource to pay 1 (Fired Hand itself is spent)");
  assert.equal(stat(noPay.engine, noPay.id("foe"), "life"), 3);
  assert.equal(zoneOf(noPay.engine, noPay.id("h0")), "hand", "nothing discarded");
  const oneSpare = pvBoard({ rage: 1, fh: { attachedToKey: "__factionA" } });
  petty(oneSpare);
  assert.equal(stat(oneSpare.engine, oneSpare.id("foe"), "life"), 2, "control: one ready resource pays");
  assert.equal(readyResources(oneSpare.engine, P1), 0);
  const noHand = pvBoard({ hand: 0 });
  refused(() => activate(noHand.engine, P1, noHand.id("fh"), "petty-vengeance", { selected: { c: [noHand.id("foe")] } }), "nothing to discard");
  assert.equal(stat(noHand.engine, noHand.id("foe"), "life"), 3);
  const noPick = pvBoard();
  refused(() => activate(noPick.engine, P1, noPick.id("fh"), "petty-vengeance", { selected: { c: [noPick.id("foe")] } }), "no card chosen to discard");
  assert.equal(stat(noPick.engine, noPick.id("foe"), "life"), 3);
  const noTarget = pvBoard();
  refused(() => activate(noTarget.engine, P1, noTarget.id("fh"), "petty-vengeance", { selected: { toss: [noTarget.id("h0")] } }), "no character picked");
  assert.equal(zoneOf(noTarget.engine, noTarget.id("h0")), "hand");
});

// =====================================================================================
// Flailing Knife
// =====================================================================================

const TYPES = ["character", "item", "location", "tactic", "resource"] as const;
const typedDef = (type: (typeof TYPES)[number], name: string): CardDefinition =>
  type === "character" ? character({ name }) : type === "item" ? item({ name }) : type === "location" ? location({ name }) : type === "tactic" ? tactic({ name }) : resourceCard({ name });

const knifeBoard = (o: { topType?: (typeof TYPES)[number]; knife?: Partial<CardPlacement>; extra?: CardPlacement[] } = {}) =>
  duo([
    { key: "host", def: character({ name: "Host", strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play" },
    { key: "other", def: character({ name: "Other", strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play" },
    { key: "foe", def: character({ name: "Foe", strength: 2, life: 5, speed: 2 }), owner: P2, zone: "play" },
    { key: "knife", def: printing(KNIFE), owner: P1, zone: "play", attachedToKey: "host", ...(o.knife ?? {}) },
    { key: "top", def: typedDef(o.topType ?? "character", "Top"), owner: P1, zone: "deck" },
    ...fillerDeck("d", 3, P1),
    { key: "killer", def: killer("Killer"), owner: P1, zone: "hand" },
    { key: "bouncer", def: bouncer("Bouncer"), owner: P1, zone: "hand" },
    ...(o.extra ?? [])
  ]);

const killKnife = (b: ReturnType<typeof knifeBoard>, target = "knife") => play(b.engine, P1, b.id("killer"), { selected: { t: [b.id(target)] } });

clause(KNIFE, "0:attach", "deploys from hand for the printed cost 3 and threshold [D] as an item (gear), attached to a character of my choice", () => {
  const mk = (cards: CardPlacement[]) =>
    duo([
      { key: "knife", def: printing(KNIFE), owner: P1, zone: "hand" },
      { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
      ...cards
    ]);
  const short = mk([...bank("deception", 1, P1), ...bank("rage", 1, P1)]);
  refused(() => play(short.engine, P1, short.id("knife"), { selected: { attachTo: [short.id("host")] } }), "cost 3 with only 2 resources");
  const noThr = mk(bank("rage", 3, P1));
  refused(() => play(noThr.engine, P1, noThr.id("knife"), { selected: { attachTo: [noThr.id("host")] } }), "no [D]", /threshold/i);
  const costOnly = mk([...bank("rage", 2, P1), ...spent("deception", 1, P1)]);
  refused(() => play(costOnly.engine, P1, costOnly.id("knife"), { selected: { attachTo: [costOnly.id("host")] } }), "threshold met by a spent [D]; 2 resources can't pay 3");
  assert.equal(zoneOf(costOnly.engine, costOnly.id("knife")), "hand");
  const ok = mk([...bank("deception", 1, P1), ...bank("rage", 2, P1)]);
  const before = readyResources(ok.engine, P1);
  play(ok.engine, P1, ok.id("knife"), { selected: { attachTo: [ok.id("host")] } });
  assert.equal(zoneOf(ok.engine, ok.id("knife")), "play");
  assert.equal(before - readyResources(ok.engine, P1), 3, "three paid");
  assert.equal(ok.engine.state.cards[ok.id("knife")].attachedTo, ok.id("host"));
  const def = ok.engine.getDefinition(ok.id("knife"));
  assert.equal(def.type, "item");
  assert.deepEqual([...def.subtype], ["gear"]);
});

clause(KNIFE, "0:attach", "may attach to any character (mine or the opponent's), but not to an item or location, nor be deployed without a host", () => {
  const mk = () =>
    duo([
      { key: "knife", def: printing(KNIFE), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...bank("deception", 3, P1)
    ]);
  for (const key of ["mine", "foe"]) {
    const b = mk();
    play(b.engine, P1, b.id("knife"), { selected: { attachTo: [b.id(key)] } });
    assert.equal(b.engine.state.cards[b.id("knife")].attachedTo, b.id(key), `attaches to ${key}`);
  }
  for (const key of ["thing", "place"]) {
    const b = mk();
    refused(() => play(b.engine, P1, b.id("knife"), { selected: { attachTo: [b.id(key)] } }), `${key} is not a character`);
    assert.equal(zoneOf(b.engine, b.id("knife")), "hand");
  }
  const none = mk();
  refused(() => play(none.engine, P1, none.id("knife")), "no host chosen");
  assert.equal(zoneOf(none.engine, none.id("knife")), "hand");
});

clause(KNIFE, "1:rule", "the attached character gains 2 strength; nobody else does", () => {
  const b = knifeBoard();
  assert.equal(stat(b.engine, b.id("host"), "strength"), 4, "2 + 2");
  assert.equal(stat(b.engine, b.id("other"), "strength"), 2, "an unattached character is unaffected");
  assert.equal(stat(b.engine, b.id("foe"), "strength"), 2);
  assert.equal(stat(b.engine, b.id("host"), "life"), 5, "only strength");
  assert.equal(stat(b.engine, b.id("host"), "speed"), 2, "only strength");
  const onFoe = knifeBoard({ knife: { attachedToKey: "foe" } });
  assert.equal(stat(onFoe.engine, onFoe.id("foe"), "strength"), 4, "attached to the opponent's character: they get the strength");
  assert.equal(stat(onFoe.engine, onFoe.id("host"), "strength"), 2);
});

clause(KNIFE, "1:rule", "two knives on one character stack (+4); the bonus is gone once the knife has left play", () => {
  const two = knifeBoard({ extra: [{ key: "knife2", def: printing(KNIFE), owner: P1, zone: "play", attachedToKey: "host" }] });
  assert.equal(stat(two.engine, two.id("host"), "strength"), 6, "2 + 2 + 2");
  const b = knifeBoard({ extra: [] });
  play(b.engine, P1, b.id("bouncer"), { selected: { t: [b.id("knife")] } });
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("knife")), "hand");
  assert.equal(stat(b.engine, b.id("host"), "strength"), 2, "bonus gone");
});

const choose = (b: ReturnType<typeof knifeBoard>, type: (typeof TYPES)[number]) => {
  const p = pc(b.engine)!;
  assert.equal(p.kind, "chooserSelectsOption");
  assert.equal(p.playerId, P1);
  const labels = (p.options as { label: string }[]).map((o) => o.label);
  const index = labels.indexOf(type);
  assert.ok(index >= 0, `option ${type} offered (${labels.join(",")})`);
  answerPending(b.engine, "chooserSelectsOption", { index });
};

clause(KNIFE, "2:rule", "when it goes from play to my discard pile I am asked for a card type, from the card types character, item, location, tactic, resource", () => {
  const b = knifeBoard();
  killKnife(b);
  assert.equal(zoneOf(b.engine, b.id("knife")), "discard");
  const p = pc(b.engine)!;
  assert.equal(p.kind, "chooserSelectsOption");
  assert.equal(p.playerId, P1, "I choose");
  const labels = (p.options as { label: string }[]).map((o) => o.label);
  for (const t of TYPES) assert.ok(labels.includes(t), `${t} offered`);
});

for (const type of TYPES) {
  clause(KNIFE, "2:rule", `choosing ${type} and the top card IS a ${type}: the knife is put into play attached to the character I choose; the revealed card goes to the bottom`, () => {
    const b = knifeBoard({ topType: type });
    const deckBefore = deckOf(b.engine, P1);
    assert.equal(deckBefore[0], b.id("top"), "setup: the typed card is on top");
    killKnife(b);
    choose(b, type);
    const host = pc(b.engine)!;
    assert.equal(host.kind, "chooserSelectsTarget");
    assert.equal(host.playerId, P1);
    const revealed = b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed").flatMap((e) => (e.event as unknown as { cardIds: string[] }).cardIds);
    assert.ok(revealed.includes(b.id("top")), "the top card was revealed");
    answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("other")] });
    assert.equal(pending(b.engine), undefined);
    assert.equal(zoneOf(b.engine, b.id("knife")), "play", "back in play");
    assert.equal(b.engine.state.cards[b.id("knife")].attachedTo, b.id("other"), "attached to the chosen character");
    assert.equal(stat(b.engine, b.id("other"), "strength"), 4, "and it grants +2 again");
    assert.equal(stat(b.engine, b.id("host"), "strength"), 2, "the old host no longer has it");
    const after = deckOf(b.engine, P1);
    assert.equal(after[after.length - 1], b.id("top"), "the revealed top card went to the bottom");
    assert.equal(after.length, deckBefore.length);
    assert.deepEqual(after.slice(0, -1), deckBefore.slice(1), "the rest keep their order");
  });
}

clause(KNIFE, "2:rule", "choosing a type the top card is NOT: the knife stays in the discard pile and the revealed top card still goes to the bottom", () => {
  for (const [chosen, topType] of [["item", "character"], ["character", "item"], ["resource", "location"]] as const) {
    const b = knifeBoard({ topType });
    const deckBefore = deckOf(b.engine, P1);
    killKnife(b);
    choose(b, chosen);
    assert.equal(pending(b.engine), undefined, `${chosen} vs ${topType}: no host prompt`);
    assert.equal(zoneOf(b.engine, b.id("knife")), "discard", "stays in the discard pile");
    const after = deckOf(b.engine, P1);
    assert.equal(after[after.length - 1], deckBefore[0], "the top card went to the bottom");
    assert.deepEqual(after.slice(0, -1), deckBefore.slice(1));
  }
});

clause(KNIFE, "2:rule", "the new host can be any character (the opponent's too), but not an item or location", () => {
  const b = knifeBoard({ extra: [{ key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" }, { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" }] });
  killKnife(b);
  choose(b, "character");
  for (const key of ["thing", "place"]) refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id(key)] }), `${key} is not a character`);
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("foe")] });
  assert.equal(b.engine.state.cards[b.id("knife")].attachedTo, b.id("foe"), "attached to the opponent's character");
  assert.equal(zoneOf(b.engine, b.id("knife")), "play");
});

clause(KNIFE, "2:rule", "the host being destroyed also puts the knife into the discard pile, which triggers it (it comes back on a hit)", () => {
  const b = knifeBoard();
  play(b.engine, P1, b.id("killer"), { selected: { t: [b.id("host")] } });
  assert.equal(zoneOf(b.engine, b.id("host")), "discard");
  assert.equal(zoneOf(b.engine, b.id("knife")), "discard", "the knife follows its host into the discard pile");
  choose(b, "character");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("other")] });
  assert.equal(zoneOf(b.engine, b.id("knife")), "play");
  assert.equal(b.engine.state.cards[b.id("knife")].attachedTo, b.id("other"));
});

clause(KNIFE, "2:rule", "\"you may choose a card type\": I can decline (and then nothing is revealed)", () => {
  const b = knifeBoard();
  const deckBefore = deckOf(b.engine, P1);
  killKnife(b);
  const p = pc(b.engine)!;
  assert.equal(p.kind, "chooserSelectsOption");
  const labels = (p.options as { label: string }[]).map((o) => o.label);
  assert.ok(labels.length > TYPES.length || labels.some((l) => /decline|no|skip|none/i.test(l)), `a decline option exists (offered: ${labels.join(",")})`);
  const declineIndex = labels.findIndex((l) => /decline|no|skip|none/i.test(l));
  answerPending(b.engine, "chooserSelectsOption", { index: declineIndex });
  assert.equal(zoneOf(b.engine, b.id("knife")), "discard");
  assert.equal(b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed").length, 0, "nothing revealed");
  // Q22 (literal): "Put the top card of your deck on the bottom." is its own sentence (no "if you do"), so it still happens after declining.
  const deckAfter = deckOf(b.engine, P1);
  assert.equal(deckAfter[deckAfter.length - 1], deckBefore[0], "the top card went to the bottom although the choice was declined");
  assert.equal(deckAfter[0], deckBefore[1], "the next card is now on top");
});

clause(KNIFE, "2:rule", "the card type chosen is revealed along with the top card (a cardsRevealed event for the top card, to everyone)", () => {
  const b = knifeBoard();
  const top = b.id("top");
  killKnife(b);
  choose(b, "item");
  const reveals = b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed");
  const ids = reveals.flatMap((e) => (e.event as unknown as { cardIds: string[] }).cardIds);
  assert.ok(ids.includes(top), "the top card was revealed");
  assert.equal((reveals[reveals.length - 1].event as unknown as { viewerId: string }).viewerId, "all");
});

clause(KNIFE, "2:rule", "only the TOP card of my deck is revealed, for every chosen type (exactly one card is shown)", () => {
  for (const type of TYPES) {
    const b = knifeBoard({ topType: type });
    killKnife(b);
    choose(b, type);
    const revealed = b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed").flatMap((e) => (e.event as unknown as { cardIds: string[] }).cardIds);
    assert.deepEqual(revealed, [b.id("top")], `${type}: exactly the top card is revealed`);
  }
});

for (const type of TYPES) {
  clause(KNIFE, "2:rule", `choosing ${type} and hitting: the new host is ONE character (two picked is refused) and a character only (an item is refused)`, () => {
    const b = knifeBoard({ topType: type, extra: [{ key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" }] });
    killKnife(b);
    choose(b, type);
    refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("other"), b.id("foe")] }), "two hosts picked");
    refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("thing")] }), "an item as the host");
    assert.equal(zoneOf(b.engine, b.id("knife")), "discard", "still in the discard pile");
    answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("other")] });
    assert.equal(b.engine.state.cards[b.id("knife")].attachedTo, b.id("other"), "control: one character host works");
  });

  clause(KNIFE, "2:rule", `choosing ${type} and hitting: the knife IS put into play attached to a character, so choosing no host is refused`, () => {
    const b = knifeBoard({ topType: type });
    killKnife(b);
    choose(b, type);
    refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [] }), "put it into play attached to a character: a host is required");
    assert.equal(zoneOf(b.engine, b.id("knife")), "discard", "the knife has not been left in the discard pile by a declined host");
  });
}

clause(KNIFE, "2:rule", "it triggers only when put into the discard pile FROM PLAY: discarded from my hand it raises no choice", () => {
  const discarder = tactic({
    name: "Discarder",
    cost: 0,
    behavior: { abilities: [{ id: "dd", type: "activated", targets: [{ id: "t", selector: { zone: "hand", type: "item" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "discard" }] }] }
  });
  const b = knifeBoard({
    extra: [
      { key: "hk", def: printing(KNIFE), owner: P1, zone: "hand" },
      { key: "disc", def: discarder, owner: P1, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("disc"), { selected: { t: [b.id("hk")] } });
  assert.equal(zoneOf(b.engine, b.id("hk")), "discard", "the hand knife was discarded");
  assert.equal(pending(b.engine), undefined, "no card-type choice: it did not come from play");
});

clause(KNIFE, "2:rule", "it does NOT trigger for other cards: another item destroyed, or the knife leaving play to hand, raise no choice", () => {
  const b = knifeBoard({ extra: [{ key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" }] });
  killKnife(b, "thing");
  assert.equal(zoneOf(b.engine, b.id("thing")), "discard");
  assert.equal(pending(b.engine), undefined, "another item going to the discard pile doesn't trigger the knife");
  assert.equal(zoneOf(b.engine, b.id("knife")), "play");
  const bounced = knifeBoard();
  play(bounced.engine, P1, bounced.id("bouncer"), { selected: { t: [bounced.id("knife")] } });
  assert.equal(zoneOf(bounced.engine, bounced.id("knife")), "hand");
  assert.equal(pending(bounced.engine), undefined, "leaving play to hand is not going to the discard pile");
});

clause(KNIFE, "2:rule", "it triggers for the pile's owner when the knife is controlled by the opponent: the owner (whose discard pile it enters) is asked", () => {
  const b = knifeBoard({ knife: { controller: P2, attachedToKey: "foe" } });
  killKnife(b);
  assert.equal(zoneOf(b.engine, b.id("knife")), "discard");
  assert.equal(b.engine.state.players[P1].discard.includes(b.id("knife")), true, "it goes to its owner's discard pile");
  const p = pc(b.engine);
  assert.ok(p, "a type choice is raised");
  assert.equal(p.kind, "chooserSelectsOption");
  assert.equal(p.playerId, P1, "the player whose discard pile it entered chooses");
});

// =====================================================================================
// Gambling Den
// =====================================================================================

const denBoard = (o: { top?: CardDefinition; second?: CardDefinition; den?: Partial<CardPlacement>; resP1?: number; resP2?: number; extra?: CardPlacement[] } = {}) =>
  duo([
    { key: "den", def: printing(DEN), owner: P1, zone: "play", ...(o.den ?? {}) },
    { key: "top", def: o.top ?? character({ name: "Top", cost: 3 }), owner: P1, zone: "deck" },
    ...(o.second ? [{ key: "second", def: o.second, owner: P1, zone: "deck" as const }] : []),
    ...fillerDeck("a", 4, P1),
    ...fillerDeck("b", 4, P2),
    ...Array.from({ length: o.resP1 ?? 1 }, (_, i) => ({ key: `r1_${i}`, def: resourceCard({ name: `R1_${i}` }), owner: P1, zone: "hand" as const })),
    ...Array.from({ length: o.resP2 ?? 1 }, (_, i) => ({ key: `r2_${i}`, def: resourceCard({ name: `R2_${i}` }), owner: P2, zone: "hand" as const })),
    ...(o.extra ?? [])
  ]);
/** P1's turn ends, P2's turn ends: P1's next turn starts (the Den's trigger). */
const toMyTurn = (b: ReturnType<typeof denBoard>) => {
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
};
const optionIndex = (p: Pc, label: RegExp) => (p.options as { label: string }[]).findIndex((o) => label.test(o.label));

clause(DEN, "0:rule", "deploys from hand for the printed cost 0 and threshold [D], as a location with structure 4", () => {
  const mk = (cards: CardPlacement[]) => duo([{ key: "den", def: printing(DEN), owner: P1, zone: "hand" }, ...cards]);
  const noThr = mk(bank("rage", 2, P1));
  refused(() => play(noThr.engine, P1, noThr.id("den")), "no [D] icon", /threshold/i);
  assert.equal(zoneOf(noThr.engine, noThr.id("den")), "hand");
  const ok = mk(bank("deception", 1, P1));
  const before = readyResources(ok.engine, P1);
  play(ok.engine, P1, ok.id("den"));
  assert.equal(zoneOf(ok.engine, ok.id("den")), "play");
  assert.equal(readyResources(ok.engine, P1), before, "cost 0: nothing paid");
  assert.equal(stat(ok.engine, ok.id("den"), "structure"), 4);
  assert.equal(ok.engine.getDefinition(ok.id("den")).type, "location");
  const spentOnly = mk(spent("deception", 1, P1));
  play(spentOnly.engine, P1, spentOnly.id("den"));
  assert.equal(zoneOf(spentOnly.engine, spentOnly.id("den")), "play", "a spent [D] still meets the threshold at cost 0");
});

clause(DEN, "0:rule", "at the start of MY turn it reveals my top card (to everyone) and leaves it on top; it does not trigger at the opponent's turn start", () => {
  const b = denBoard({ top: character({ name: "Top", cost: 3 }) });
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(pending(b.engine), undefined, "the opponent's turn start: no Den trigger");
  assert.equal(b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed").length, 0);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  const reveals = b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed");
  assert.equal(reveals.length, 1, "revealed once");
  const ev = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual(ev.cardIds, [b.id("top")], "the top card of MY deck");
  assert.equal(ev.viewerId, "all");
  assert.equal(deckOf(b.engine, P1)[0], b.id("top"), "still on top (revealing doesn't move it)");
});

// E11: corrected per the user's ruling (Q52, 2026-10-21): with no card to reveal the ability cannot continue to the
// numeric-cost check, so neither the draw branch nor the "Otherwise" resource branch happens.
clause(DEN, "0:rule", "my deck is empty at my turn start: nothing is revealed, so the ability cannot continue: no draw offer and no resource offer", () => {
  const b = duo([
    { key: "den", def: printing(DEN), owner: P1, zone: "play" },
    ...fillerDeck("b", 4, P2),
    { key: "r1", def: resourceCard({ name: "R1" }), owner: P1, zone: "hand" },
    { key: "r2", def: resourceCard({ name: "R2" }), owner: P2, zone: "hand" }
  ]);
  assert.equal(deckOf(b.engine, P1).length, 0, "setup: my deck is empty");
  toMyTurn(b);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed").length, 0, "nothing to reveal");
  assert.equal(pc(b.engine), undefined, "no draw offer and no resource offer for either player");
  assert.equal(zoneOf(b.engine, b.id("r1")), "hand", "my resource card stays in my hand");
  assert.equal(zoneOf(b.engine, b.id("r2")), "hand", "their resource card stays in their hand");
});

clause(DEN, "0:rule", "the opponent's deck being empty does not stop my Den: my top card is still revealed and the draw prompts appear", () => {
  const b = duo([
    { key: "den", def: printing(DEN), owner: P1, zone: "play" },
    { key: "top", def: character({ name: "Top", cost: 2 }), owner: P1, zone: "deck" },
    ...fillerDeck("a", 4, P1)
  ]);
  assert.equal(deckOf(b.engine, P2).length, 0, "setup: the opponent's deck is empty");
  toMyTurn(b);
  const reveals = b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed").flatMap((e) => (e.event as unknown as { cardIds: string[] }).cardIds);
  assert.deepEqual(reveals, [b.id("top")], "my top card was revealed");
  const first = pc(b.engine);
  assert.ok(first, "a prompt is offered");
  assert.ok(optionIndex(first!, /draw/i) >= 0, "the draw branch (cost 2 <= 3)");
});

clause(DEN, "0:rule", "my deck is empty but the opponent's is not: the opponent's top card is never the one revealed (no reveal of their deck)", () => {
  const b = duo([
    { key: "den", def: printing(DEN), owner: P1, zone: "play" },
    ...fillerDeck("b", 4, P2)
  ]);
  const oppTop = deckOf(b.engine, P2)[0];
  toMyTurn(b);
  const revealed = b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed").flatMap((e) => (e.event as unknown as { cardIds: string[] }).cardIds);
  assert.ok(!revealed.includes(oppTop), "the opponent's top card is not revealed by my Den");
});

clause(DEN, "0:rule", "top card with numeric cost 3 or less: each player may draw a card (me first, then the opponent), each deciding for themselves", () => {
  for (const cost of [0, 1, 3]) {
    const b = denBoard({ top: character({ name: "Top", cost }) });
    const h1 = handOf(b.engine, P1).length;
    const h2 = handOf(b.engine, P2).length;
    const myTop = deckOf(b.engine, P1)[0];
    const oppTop = deckOf(b.engine, P2)[0];
    toMyTurn(b);
    const first = pc(b.engine)!;
    assert.equal(first.kind, "chooserSelectsOption", `cost ${cost}`);
    assert.equal(first.playerId, P1, "I decide first");
    assert.ok(optionIndex(first, /draw/i) >= 0, "optionIndex(first, /draw/i) >= 0");
    assert.equal(optionIndex(first, /resource/i), -1, "it's the draw branch");
    answerPending(b.engine, "chooserSelectsOption", { index: optionIndex(first, /draw/i) });
    const second = pc(b.engine)!;
    assert.equal(second.kind, "chooserSelectsOption");
    assert.equal(second.playerId, P2, "then the opponent");
    answerPending(b.engine, "chooserSelectsOption", { index: optionIndex(second, /draw/i) });
    assert.equal(pending(b.engine), undefined);
    assert.equal(handOf(b.engine, P1).length, h1 + 1, "I drew one");
    assert.equal(handOf(b.engine, P2).length, h2 + 1, "they drew one");
    assert.ok(handOf(b.engine, P1).includes(myTop), "from my deck's top");
    assert.ok(handOf(b.engine, P2).includes(oppTop), "from their deck");
  }
});

clause(DEN, "0:rule", "each player 'may' draw: either can decline independently (the other still draws)", () => {
  const run = (meDraw: boolean, oppDraw: boolean) => {
    const b = denBoard({ top: character({ name: "Top", cost: 3 }) });
    const h1 = handOf(b.engine, P1).length;
    const h2 = handOf(b.engine, P2).length;
    toMyTurn(b);
    const first = pc(b.engine)!;
    answerPending(b.engine, "chooserSelectsOption", { index: optionIndex(first, meDraw ? /draw/i : /decline/i) });
    const second = pc(b.engine)!;
    assert.equal(second.playerId, P2);
    answerPending(b.engine, "chooserSelectsOption", { index: optionIndex(second, oppDraw ? /draw/i : /decline/i) });
    assert.equal(pending(b.engine), undefined);
    assert.equal(handOf(b.engine, P1).length, h1 + (meDraw ? 1 : 0), `me draw=${meDraw}`);
    assert.equal(handOf(b.engine, P2).length, h2 + (oppDraw ? 1 : 0), `opp draw=${oppDraw}`);
    if (!meDraw) assert.equal(deckOf(b.engine, P1)[0], b.id("top"), "declined: the top card is still there");
  };
  run(true, false);
  run(false, true);
  run(false, false);
});

clause(DEN, "0:rule", "top card with cost above 3: each player may play a resource (not draw); I choose first, then the opponent, each from their own hand", () => {
  for (const cost of [4, 7]) {
    const b = denBoard({ top: character({ name: "Top", cost }) });
    const res1 = b.engine.state.players[P1].play.length;
    const res2 = b.engine.state.players[P2].play.length;
    const h1 = handOf(b.engine, P1).length;
    toMyTurn(b);
    const first = pc(b.engine)!;
    assert.equal(first.kind, "chooserSelectsOption", `cost ${cost}`);
    assert.equal(first.playerId, P1);
    assert.equal(optionIndex(first, /draw/i), -1, "not the draw branch");
    const yes = optionIndex(first, /resource/i);
    assert.ok(yes >= 0, "a play-a-resource option");
    answerPending(b.engine, "chooserSelectsOption", { index: yes });
    // drive the resource-play prompt(s) for me, then the opponent's
    let guard = 0;
    while (pc(b.engine) && guard++ < 8) {
      const p = pc(b.engine)!;
      if (p.kind === "chooserSelectsOption") {
        const i = optionIndex(p, /resource/i);
        answerPending(b.engine, "chooserSelectsOption", { index: i >= 0 ? i : 0 });
      } else if (p.kind === "chooserSelectsTarget") {
        // accepting "play a resource" asks which card of that player's own hand to play (SYS-33)
        answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id(p.playerId === P1 ? "r1_0" : "r2_0")] });
      } else break;
    }
    if (pc(b.engine)) assert.fail(`unexpected pending ${JSON.stringify(pc(b.engine))}`);
    assert.equal(handOf(b.engine, P1).length <= h1, true, "no card drawn");
    assert.ok(b.engine.state.players[P1].play.length >= res1, "b.engine.state.players[P1].play.length >= res1");
    assert.ok(b.engine.state.players[P2].play.length >= res2, "b.engine.state.players[P2].play.length >= res2");
  }
});

clause(DEN, "0:rule", "'Otherwise' is decided on the revealed card only: after both players draw a cost-3 top card, the NEW top card (cost 6) must not start the resource branch", () => {
  const b = denBoard({ top: character({ name: "Top", cost: 3 }), second: character({ name: "Second", cost: 6 }) });
  toMyTurn(b);
  const seen: string[] = [];
  let guard = 0;
  while (pc(b.engine) && guard++ < 10) {
    const p = pc(b.engine)!;
    const draw = optionIndex(p, /draw/i);
    seen.push(`${p.playerId}:${draw >= 0 ? "draw" : "resource"}`);
    answerPending(b.engine, "chooserSelectsOption", { index: draw >= 0 ? draw : optionIndex(p, /decline/i) });
  }
  assert.deepEqual(seen, [`${P1}:draw`, `${P2}:draw`], "only the two draw prompts: the Den revealed only one card");
  assert.equal(b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed").length, 1);
});

clause(DEN, "0:rule", "the extra-cost and draw branches are exclusive: a cost-3 top never offers resource play; a cost-4 top never draws", () => {
  const draw = denBoard({ top: character({ name: "Top", cost: 3 }) });
  toMyTurn(draw);
  assert.equal(optionIndex(pc(draw.engine)!, /resource/i), -1);
  const res = denBoard({ top: character({ name: "Top", cost: 4 }) });
  const h = handOf(res.engine, P1).length;
  toMyTurn(res);
  assert.equal(optionIndex(pc(res.engine)!, /draw/i), -1);
  assert.equal(handOf(res.engine, P1).length, h, "nothing drawn");
});

clause(DEN, "0:rule", "a real resource card on top has printed numeric cost 0 (3 or less): the draw branch, not the resource branch", () => {
  const b = denBoard({ top: printing("61766da9-6482-4ecb-8306-becda47294ec") });
  toMyTurn(b);
  const first = pc(b.engine)!;
  assert.equal(first.kind, "chooserSelectsOption");
  assert.ok(optionIndex(first, /draw/i) >= 0, "optionIndex(first, /draw/i) >= 0");
  assert.equal(optionIndex(first, /resource/i), -1);
});

clause(DEN, "0:rule", "may play a resource: a resource played this way can be played face-down or face-up (SYS-7 check) and the declining player plays nothing", () => {
  const b = denBoard({ top: character({ name: "Top", cost: 5 }) });
  toMyTurn(b);
  const first = pc(b.engine)!;
  answerPending(b.engine, "chooserSelectsOption", { index: optionIndex(first, /decline/i) });
  const second = pc(b.engine)!;
  assert.equal(second.playerId, P2);
  const before = b.engine.state.players[P2].play.length;
  answerPending(b.engine, "chooserSelectsOption", { index: optionIndex(second, /decline/i) });
  assert.equal(pending(b.engine), undefined);
  assert.equal(b.engine.state.players[P1].play.filter((c) => c === b.id("r1_0")).length, 0, "I declined: no resource played");
  assert.equal(b.engine.state.players[P2].play.length, before, "they declined: nothing played");
  assert.equal(zoneOf(b.engine, b.id("r1_0")), "hand");
  assert.equal(zoneOf(b.engine, b.id("r2_0")), "hand");
});

clause(DEN, "0:rule", "may play a resource, accepted: each player's own resource card from hand enters play (I play mine, they play theirs)", () => {
  const b = denBoard({ top: character({ name: "Top", cost: 5 }) });
  toMyTurn(b);
  const first = pc(b.engine)!;
  assert.equal(first.playerId, P1);
  answerPending(b.engine, "chooserSelectsOption", { index: optionIndex(first, /resource/i) });
  const second = pc(b.engine)!;
  assert.equal(second.playerId, P2);
  answerPending(b.engine, "chooserSelectsOption", { index: optionIndex(second, /resource/i) });
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("r1_0")), "play", "my resource was played");
  assert.equal(zoneOf(b.engine, b.id("r2_0")), "play", "their resource was played");
});

clause(DEN, "0:rule", "only the accepting player plays a resource: I accept and the opponent declines (theirs stays in hand)", () => {
  const b = denBoard({ top: character({ name: "Top", cost: 5 }) });
  toMyTurn(b);
  answerPending(b.engine, "chooserSelectsOption", { index: optionIndex(pc(b.engine)!, /resource/i) });
  answerPending(b.engine, "chooserSelectsOption", { index: optionIndex(pc(b.engine)!, /decline/i) });
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("r1_0")), "play", "my resource was played");
  assert.equal(zoneOf(b.engine, b.id("r2_0")), "hand", "theirs stays in hand");
});

clause(DEN, "0:rule", "two Gambling Dens each trigger at the start of my turn (each reveals and each player may draw twice in all)", () => {
  const b = denBoard({ top: character({ name: "Top", cost: 2 }), extra: [{ key: "den2", def: printing(DEN), owner: P1, zone: "play" }] });
  const h1 = handOf(b.engine, P1).length;
  const h2 = handOf(b.engine, P2).length;
  toMyTurn(b);
  let guard = 0;
  while (pc(b.engine) && guard++ < 12) {
    const p = pc(b.engine)!;
    if (p.kind === "orderTriggers") answerPending(b.engine, "orderTriggers", { next: (p.triggers as unknown[])[0] });
    else answerPending(b.engine, "chooserSelectsOption", { index: optionIndex(p, /draw/i) });
  }
  assert.equal(pending(b.engine), undefined);
  assert.equal(b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed").length, 2, "each Den revealed a top card");
  assert.equal(handOf(b.engine, P1).length, h1 + 2, "I drew once per Den");
  assert.equal(handOf(b.engine, P2).length, h2 + 2, "they drew once per Den");
});

clause(DEN, "0:rule", "it only works while in play: after it is destroyed nothing happens at my turn start", () => {
  const b = denBoard({ top: character({ name: "Top", cost: 2 }), extra: [{ key: "killer", def: killer("Killer"), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("killer"), { selected: { t: [b.id("den")] } });
  assert.equal(zoneOf(b.engine, b.id("den")), "discard");
  toMyTurn(b);
  assert.equal(pending(b.engine), undefined);
  assert.equal(b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed").length, 0);
});

clause(DEN, "0:rule", "'your turn' follows the controller: a Den owned by me but controlled by the opponent reveals THEIR top card at THEIR turn start, not mine", () => {
  const b = denBoard({ top: character({ name: "Top", cost: 2 }), den: { controller: P2 } });
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  const reveals = b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed");
  assert.equal(reveals.length, 1, "the controller's turn start triggers it");
  const ids = (reveals[0].event as unknown as { cardIds: string[] }).cardIds;
  assert.deepEqual(ids, [deckOf(b.engine, P2)[0]], "their top card, not mine");
  const first = pc(b.engine)!;
  assert.equal(first.playerId, P2, "the active player decides first");
  while (pc(b.engine)) answerPending(b.engine, "chooserSelectsOption", { index: 0 });
  endTurn(b.engine, P2);
  assert.equal(b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed").length, 1, "my turn start: no trigger");
  assert.equal(pending(b.engine), undefined);
});

// =====================================================================================
// Guttersnipe -- TACTICAL, FLIP UP: 0 [D][D]
// =====================================================================================

const gutBoard = (extra: CardPlacement[] = [], o: { gut?: Partial<CardPlacement>; turn?: number; active?: Pid } = {}) =>
  duo(
    [
      { key: "gut", def: printing(GUT), owner: P1, zone: "play", ...(o.gut ?? {}) },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 6, speed: 2 }), owner: P2, zone: "play" },
      ...extra
    ],
    { turn: o.turn, active: o.active }
  );
const flipUp = (engine: SpoilsEngine, c: CardInstanceId, p: Pid = P1) => flipUpNow(engine, { type: "flipUp", playerId: p, cardId: c, selected: {}, variables: {} });

clause(GUT, "0:kw:TACTICAL", "deploys from hand for the printed cost 1 and threshold [D][D], with printed stats 1 / 4 / 1 and subtype outcast", () => {
  const mk = (cards: CardPlacement[]) => gutBoard(cards, { gut: { zone: "hand" } });
  const short = mk(spent("deception", 2, P1));
  refused(() => play(short.engine, P1, short.id("gut")), "threshold met by spent [D]s, but nothing ready to pay cost 1", /Costs cannot be paid/);
  assert.equal(zoneOf(short.engine, short.id("gut")), "hand");
  const thr = mk([...bank("deception", 1, P1), ...bank("rage", 1, P1)]);
  refused(() => play(thr.engine, P1, thr.id("gut")), "only one [D] of [D][D]", /threshold/i);
  assert.equal(zoneOf(thr.engine, thr.id("gut")), "hand");
  const ok = mk(bank("deception", 2, P1));
  const before = readyResources(ok.engine, P1);
  play(ok.engine, P1, ok.id("gut"));
  assert.equal(zoneOf(ok.engine, ok.id("gut")), "play");
  assert.equal(before - readyResources(ok.engine, P1), 1, "cost 1 paid");
  assert.deepEqual([stat(ok.engine, ok.id("gut"), "strength"), stat(ok.engine, ok.id("gut"), "speed"), stat(ok.engine, ok.id("gut"), "life")], [1, 4, 1]);
  const def = ok.engine.getDefinition(ok.id("gut"));
  assert.equal(def.type, "character");
  assert.deepEqual([...def.subtype], ["outcast"]);
  const mixed = mk([...spent("deception", 1, P1), ...bank("deception", 1, P1)]);
  play(mixed.engine, P1, mixed.id("gut"));
  assert.equal(zoneOf(mixed.engine, mixed.id("gut")), "play", "a spent [D] plus one ready [D]: threshold met, cost paid by the ready one");
});

clause(GUT, "0:kw:TACTICAL", "the card has the TACTICAL keyword (a plain character does not)", () => {
  const { engine, id } = gutBoard([{ key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "play" }]);
  assert.ok(kws(engine, id("gut")).includes("tactical"), "kws(engine, id(\"gut\")).includes(\"tactical\")");
  assert.equal(kws(engine, id("plain")).includes("tactical"), false, "control: an ordinary character is not tactical");
});

clause(GUT, "0:kw:TACTICAL", "it can be deployed from hand whenever a tactic could be (the opponent's attack window); an ordinary character and the no-window case are refused", () => {
  const { engine, id } = gutBoard([{ key: "plain", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" }, ...bank("deception", 2, P1)], {
    gut: { zone: "hand" },
    turn: 2,
    active: P2
  });
  refused(() => play(engine, P1, id("gut")), "the opponent's turn with no response window open");
  assert.equal(zoneOf(engine, id("gut")), "hand");
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  refused(() => play(engine, P1, id("plain")), "a non-tactical character can't be deployed on the opponent's turn");
  assert.equal(zoneOf(engine, id("plain")), "hand");
  const before = readyResources(engine, P1);
  play(engine, P1, id("gut"));
  assert.equal(zoneOf(engine, id("gut")), "play");
  assert.equal(before - readyResources(engine, P1), 1);
});

clause(GUT, "0:kw:TACTICAL", "TACTICAL changes the timing only: the [D][D] threshold is still required in the window", () => {
  const mk = (cards: CardPlacement[]) => {
    const b = gutBoard(cards, { gut: { zone: "hand" }, turn: 2, active: P2 });
    declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
    return b;
  };
  const short = mk([...bank("deception", 1, P1), ...bank("rage", 2, P1)]);
  refused(() => play(short.engine, P1, short.id("gut")), "only one [D]", /threshold/i);
  const ok = mk(bank("deception", 2, P1));
  play(ok.engine, P1, ok.id("gut"));
  assert.equal(zoneOf(ok.engine, ok.id("gut")), "play");
});

clause(GUT, "1:flipUp", "a face-down Guttersnipe is flipped face-up for cost 0 with [D][D] in play; nothing is paid", () => {
  const b = gutBoard(bank("deception", 2, P1), { gut: { faceDown: true } });
  assert.equal(b.engine.state.cards[b.id("gut")].faceDown, true);
  flipUp(b.engine, b.id("gut"));
  assert.equal(b.engine.state.cards[b.id("gut")].faceDown, false, "face-up");
  assert.equal(zoneOf(b.engine, b.id("gut")), "play");
  assert.equal(readyResources(b.engine, P1), 2, "cost 0: both [D] resources are still ready");
  assert.deepEqual([stat(b.engine, b.id("gut"), "strength"), stat(b.engine, b.id("gut"), "speed"), stat(b.engine, b.id("gut"), "life")], [1, 4, 1]);
});

clause(GUT, "1:flipUp", "refused when the [D][D] threshold is short (one [D], other icons, or only the face-down card itself), and not flipped", () => {
  const one = gutBoard([...bank("deception", 1, P1), ...bank("rage", 3, P1)], { gut: { faceDown: true } });
  refused(() => flipUp(one.engine, one.id("gut")), "one [D] of [D][D]", /threshold/i);
  assert.equal(one.engine.state.cards[one.id("gut")].faceDown, true);
  const alone = gutBoard(volition(2, P1), { gut: { faceDown: true } });
  refused(() => flipUp(alone.engine, alone.id("gut")), "Volition resources provide no [D]", /threshold/i);
  assert.equal(alone.engine.state.cards[alone.id("gut")].faceDown, true);
  const ok = gutBoard([...bank("deception", 1, P1), ...bank("deception", 1, P1).map((p, i) => ({ ...p, key: `${p.key}x${i}` }))], { gut: { faceDown: true } });
  flipUp(ok.engine, ok.id("gut"));
  assert.equal(ok.engine.state.cards[ok.id("gut")].faceDown, false, "control: two [D] flips it");
});

clause(GUT, "1:flipUp", "spent [D] resources still count toward the threshold at cost 0", () => {
  const b = gutBoard(spent("deception", 2, P1), { gut: { faceDown: true } });
  flipUp(b.engine, b.id("gut"));
  assert.equal(b.engine.state.cards[b.id("gut")].faceDown, false);
});

clause(GUT, "1:flipUp", "only a face-down card in play can be flipped up: a face-up Guttersnipe and one in hand are refused", () => {
  const up = gutBoard(bank("deception", 2, P1));
  refused(() => flipUp(up.engine, up.id("gut")), "already face-up");
  const inHand = gutBoard(bank("deception", 2, P1), { gut: { zone: "hand" } });
  refused(() => flipUp(inHand.engine, inHand.id("gut")), "in hand, not a face-down resource");
  assert.equal(zoneOf(inHand.engine, inHand.id("gut")), "hand");
});

clause(GUT, "1:flipUp", "being TACTICAL, it may be flipped up on the opponent's turn inside a response window, but not on their turn outside one", () => {
  const closed = gutBoard(bank("deception", 2, P1), { gut: { faceDown: true }, turn: 2, active: P2 });
  refused(() => flipUp(closed.engine, closed.id("gut")), "the opponent's turn, no window open");
  assert.equal(closed.engine.state.cards[closed.id("gut")].faceDown, true);
  const open = gutBoard(bank("deception", 2, P1), { gut: { faceDown: true }, turn: 2, active: P2 });
  declareAttackOpenWindow(open.engine, P2, [open.id("atk")]);
  flipUp(open.engine, open.id("gut"));
  assert.equal(open.engine.state.cards[open.id("gut")].faceDown, false, "flipped up in the opponent's window");
});

clause(GUT, "1:flipUp", "an opponent can't flip up my face-down card", () => {
  const b = gutBoard(bank("deception", 2, P1), { gut: { faceDown: true } });
  refused(() => flipUp(b.engine, b.id("gut"), P2), "not their card");
  assert.equal(b.engine.state.cards[b.id("gut")].faceDown, true);
});
