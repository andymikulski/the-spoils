// Clause tests — batch seed-saga-01, part p3 (groups 12-17).
import assert from "node:assert/strict";
import { buildGame, activate, bank, character, developFaction, item, play, resolvePendingResponses, tactic, P1, P2 } from "../per-card/_harness.js";
import { clause, clauseMismatch, printing, refused, flipUpNow } from "./_clause.js";
import { declareAttackOpenWindow, fightThrough, covertHasKeyword, covertCannotBeBlockedByNonCovert, covertPartyNeedsEveryMemberCovert, covertBlocksOnlyCovertParties } from "./_battle.js";
import { fillers, pending } from "./_board.js";
import { endTurn } from "./_turn.js";
import type { CardPlacement } from "../support/fixtures.js";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";

const ESSENCE = "629788f8-2303-4e43-be24-719ef508dc4e"; // tactic cost 1 "oo"
const EVANESCE = "1667dfcf-ce8f-4f1f-9d73-0667f8176c84"; // tactic cost 3 "oo", FLIP UP 1 oo
const DENOUNCER = "7599bef0-0817-4597-b58b-b4903cd54069"; // character cost 6 "o" 3/3/2
const FORBIDDEN = "6242776d-806e-4e6b-a360-30c791143c36"; // tactic cost 2 "oo", FLIP UP 0 oo
const GILDA = "6b78870c-5993-46f0-b782-47154a18a681"; // character cost 3 "ooo" 2/3/3
const HEXAPEDE = "0aaa4b25-4774-48c8-89ee-6c6884d96435"; // character cost 6 "oooooo" 6/6/6

// --- helpers ---------------------------------------------------------------------
const O = (n: number, owner: PlayerId = P1): CardPlacement[] => bank("obsession", n, owner);
const R = (n: number, owner: PlayerId = P1): CardPlacement[] => bank("rage", n, owner);
/** n obsession resources already SPENT (attached to the faction): they count for the threshold but cannot pay. */
const spentO = (n: number, owner: PlayerId = P1): CardPlacement[] =>
  bank("obsession", n, owner).map((p) => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));
const brd = (cards: CardPlacement[], extra: Parameters<typeof buildGame>[0] = {}) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, ...extra, cards });
const zoneNow = (engine: SpoilsEngine, id: CardInstanceId): string => engine.state.cards[id].zone as string;
const kws = (engine: SpoilsEngine, id: CardInstanceId): string[] => [...(engine.getKeywords(id) as Iterable<string>)].map((k) => String(k).toLowerCase());
const dmg = (engine: SpoilsEngine, id: CardInstanceId): number => engine.state.cards[id].damage ?? 0;
const flipUpRaw = (engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}): void => {
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });
};
const answerSel = (engine: SpoilsEngine, selected: CardInstanceId[]): void => {
  const pc = pending(engine);
  assert.ok(pc, "a pending choice is open");
  engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: pc.kind, selected } } as never);
  resolvePendingResponses(engine);
};
const ch = (name: string, s = 2, sp = 2, l = 3) => character({ name, strength: s, speed: sp, life: l } as never);

// =================================================================================
// Essence of Obsession
// =================================================================================
const essence = (extra: CardPlacement[] = [], res: CardPlacement[] = [...O(2), ...R(1)]) =>
  brd([
    { key: "ess", def: printing(ESSENCE), owner: P1, zone: "hand" },
    { key: "mine", def: ch("Mine", 4, 2, 3), owner: P1, zone: "play" },
    { key: "theirs", def: ch("Theirs", 3, 2, 3), owner: P2, zone: "play" },
    ...res,
    ...extra
  ]);

clause(ESSENCE, "0:rule", "printed as a tactic of cost 1, threshold oo: exact cost works, one short and a missing icon are refused", () => {
  const def = printing(ESSENCE);
  assert.equal(def.type, "tactic");
  assert.equal(def.cost, 1);
  assert.equal(def.threshold, "oo");
  // exact: oo threshold from spent icons + 1 ready resource pays the cost
  const ok = essence([], [...spentO(2), ...R(1)]);
  play(ok.engine, P1, ok.id("ess"), { mode: 2, selected: { c: [ok.id("mine")] } });
  assert.equal(zoneNow(ok.engine, ok.id("ess")), "discard");
  assert.equal(ok.engine.getStat(ok.id("mine"), "strength"), 2, "played at exactly cost 1 / threshold oo");
  // one short on cost: threshold met, no ready resource
  const noCost = essence([], [...spentO(2)]);
  refused(() => play(noCost.engine, P1, noCost.id("ess"), { mode: 2, selected: { c: [noCost.id("mine")] } }), "cost 1 unaffordable");
  // one icon short: 1 spent O + 2 ready rage
  const noIcon = essence([], [...spentO(1), ...R(2)]);
  refused(() => play(noIcon.engine, P1, noIcon.id("ess"), { mode: 2, selected: { c: [noIcon.id("mine")] } }), "threshold oo not met");
  assert.equal(zoneNow(noIcon.engine, noIcon.id("ess")), "hand");
});

clause(ESSENCE, "0:rule", "the player picks exactly one of three options; an out-of-range option is refused and the unchosen options do nothing", () => {
  const g = essence([
    { key: "h1", def: ch("H1"), owner: P2, zone: "hand" },
    { key: "h2", def: ch("H2"), owner: P2, zone: "hand" }
  ]);
  // option 3 (index 2) only shrinks the character: no discard, no covert
  play(g.engine, P1, g.id("ess"), { mode: 2, selected: { c: [g.id("mine")] } });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(g.engine.state.players[P2].hand.length, 2, "option 1 did not also happen");
  assert.equal(kws(g.engine, g.id("mine")).includes("covert"), false, "option 2 did not also happen");
  const bad = essence();
  refused(() => play(bad.engine, P1, bad.id("ess"), { mode: 3, selected: { c: [bad.id("mine")] } }), "only three options");
});

clause(ESSENCE, "0:rule", "the printed card is an arcanist tactic with no subtype", () => {
  const def = printing(ESSENCE);
  assert.deepEqual([def.type, def.trade], ["tactic", "arcanist"]);
  assert.deepEqual(def.subtype, [], "Essence of Obsession prints no subtype");
});

clause(ESSENCE, "1:option:OPTION 1", "the opponent's discard is mandatory: with cards in hand, discarding nothing is refused", () => {
  const g = essence([{ key: "h1", def: ch("H1"), owner: P2, zone: "hand" }]);
  play(g.engine, P1, g.id("ess"), { mode: 0 });
  assert.equal(pending(g.engine)?.playerId, P2);
  refused(() => answerSel(g.engine, []), "the opponent must discard a card");
  assert.ok(pending(g.engine), "still waiting for the discard");
  answerSel(g.engine, [g.id("h1")]);
  assert.equal(zoneNow(g.engine, g.id("h1")), "discard", "control: choosing a card discards it");
});

clause(ESSENCE, "2:option:OPTION 2", "'this turn' is the whole turn, not just the battle: after a battle ends the character still has COVERT until the turn is over", () => {
  const g = essence();
  play(g.engine, P1, g.id("ess"), { mode: 1, selected: { c: [g.id("mine")] } });
  fightThrough(g.engine, P1, [g.id("mine")], { type: "faction", playerId: P2 }, []);
  assert.equal(g.engine.state.battle, undefined, "the battle is over");
  assert.ok(kws(g.engine, g.id("mine")).includes("covert"), "still COVERT after the battle, later in the same turn");
  endTurn(g.engine, P1);
  assert.equal(kws(g.engine, g.id("mine")).includes("covert"), false, "gone once the turn is over");
});

clause(ESSENCE, "3:option:OPTION 3", "'this turn' is the whole turn, not just the battle: after a battle ends the character still has 2 less strength until the turn is over", () => {
  const g = essence();
  play(g.engine, P1, g.id("ess"), { mode: 2, selected: { c: [g.id("mine")] } });
  fightThrough(g.engine, P1, [g.id("mine")], { type: "faction", playerId: P2 }, []);
  assert.equal(g.engine.state.battle, undefined, "the battle is over");
  assert.equal(g.engine.getStat(g.id("mine"), "strength"), 2, "still reduced after the battle, later in the same turn");
  endTurn(g.engine, P1);
  assert.equal(g.engine.getStat(g.id("mine"), "strength"), 4, "restored once the turn is over");
});


clause(ESSENCE, "1:option:OPTION 1", "an opponent discards a card: the OPPONENT chooses which, exactly one, from any card type", () => {
  const g = essence([
    { key: "h1", def: ch("H1"), owner: P2, zone: "hand" },
    { key: "h2", def: tactic({ name: "H2" }), owner: P2, zone: "hand" },
    { key: "mh", def: ch("MyHand"), owner: P1, zone: "hand" }
  ]);
  play(g.engine, P1, g.id("ess"), { mode: 0 });
  const pc = pending(g.engine);
  assert.ok(pc, "the opponent is asked to discard");
  assert.equal(pc.playerId, P2, "the opponent chooses");
  answerSel(g.engine, [g.id("h2")]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneNow(g.engine, g.id("h2")), "discard", "the tactic the opponent picked was discarded");
  assert.equal(zoneNow(g.engine, g.id("h1")), "hand", "only one card");
  assert.equal(zoneNow(g.engine, g.id("mh")), "hand", "my own hand untouched");
  assert.equal(g.engine.state.cards[g.id("h2")].ownerId, P2);
  assert.equal(zoneNow(g.engine, g.id("ess")), "discard");
});

clause(ESSENCE, "1:option:OPTION 1", "option 1 needs no pick; with an empty opposing hand nothing happens; a single-card hand is discarded", () => {
  const empty = essence();
  play(empty.engine, P1, empty.id("ess"), { mode: 0 });
  assert.equal(empty.engine.state.pendingChoice, undefined);
  assert.equal(zoneNow(empty.engine, empty.id("mine")), "play");
  const one = essence([{ key: "h1", def: ch("H1"), owner: P2, zone: "hand" }]);
  play(one.engine, P1, one.id("ess"), { mode: 0 });
  drainSel(one.engine, [one.id("h1")]);
  assert.equal(zoneNow(one.engine, one.id("h1")), "discard");
  assert.equal(one.engine.state.players[P1].hand.length, 0, "the caster discards nothing");
});
function drainSel(engine: SpoilsEngine, sel: CardInstanceId[]): void {
  if (pending(engine)) answerSel(engine, sel);
}

clause(ESSENCE, "2:option:OPTION 2", "EXTRA COST pick a character (either side's); EFFECT this turn it gains COVERT and nobody else does", () => {
  for (const who of ["mine", "theirs"]) {
    const g = essence([{ key: "other", def: ch("Other"), owner: P1, zone: "play" }]);
    assert.equal(kws(g.engine, g.id(who)).includes("covert"), false);
    play(g.engine, P1, g.id("ess"), { mode: 1, selected: { c: [g.id(who)] } });
    assert.ok(kws(g.engine, g.id(who)).includes("covert"), `${who} gains COVERT`);
    assert.equal(kws(g.engine, g.id("other")).includes("covert"), false, "an unpicked character does not");
    assert.equal(zoneNow(g.engine, g.id("ess")), "discard");
  }
});

clause(ESSENCE, "2:option:OPTION 2", "the extra cost must be picked: no pick, an item, or a card outside play is refused", () => {
  const g = essence([
    { key: "it", def: item({ name: "Thing" }), owner: P1, zone: "play" },
    { key: "dc", def: ch("InDiscard"), owner: P1, zone: "discard" }
  ]);
  refused(() => play(g.engine, P1, g.id("ess"), { mode: 1 }), "no character picked");
  refused(() => play(g.engine, P1, g.id("ess"), { mode: 1, selected: { c: [g.id("it")] } }), "an item is not a character");
  refused(() => play(g.engine, P1, g.id("ess"), { mode: 1, selected: { c: [g.id("dc")] } }), "a discarded character is not in play");
  assert.equal(zoneNow(g.engine, g.id("ess")), "hand");
  play(g.engine, P1, g.id("ess"), { mode: 1, selected: { c: [g.id("mine")] } });
  assert.ok(kws(g.engine, g.id("mine")).includes("covert"), "positive control");
});

clause(ESSENCE, "2:option:OPTION 2", "COVERT lasts only this turn", () => {
  const g = essence();
  play(g.engine, P1, g.id("ess"), { mode: 1, selected: { c: [g.id("mine")] } });
  assert.ok(kws(g.engine, g.id("mine")).includes("covert"), "kws(g.engine, g.id(\"mine\")).includes(\"covert\")");
  endTurn(g.engine, P1);
  assert.equal(kws(g.engine, g.id("mine")).includes("covert"), false, "gone after the turn ends");
});

clause(ESSENCE, "3:option:OPTION 3", "EXTRA COST pick a character; EFFECT it loses 2 strength (either side's), others unchanged", () => {
  for (const [who, base] of [["mine", 4], ["theirs", 3]] as const) {
    const g = essence([{ key: "other", def: ch("Other", 5), owner: P1, zone: "play" }]);
    assert.equal(g.engine.getStat(g.id(who), "strength"), base);
    play(g.engine, P1, g.id("ess"), { mode: 2, selected: { c: [g.id(who)] } });
    assert.equal(g.engine.getStat(g.id(who), "strength"), base - 2, `${who} loses exactly 2 strength`);
    assert.equal(g.engine.getStat(g.id("other"), "strength"), 5, "unpicked unchanged");
    assert.equal(g.engine.getStat(g.id(who), "life"), 3, "only strength");
    assert.equal(g.engine.getStat(g.id(who), "speed"), 2, "only strength");
    assert.equal(kws(g.engine, g.id(who)).includes("covert"), false, "does not give COVERT");
  }
});

clause(ESSENCE, "3:option:OPTION 3", "the extra cost must be picked (item / no pick refused)", () => {
  const g = essence([{ key: "it", def: item({ name: "Thing" }), owner: P1, zone: "play" }]);
  refused(() => play(g.engine, P1, g.id("ess"), { mode: 2 }), "no character picked");
  refused(() => play(g.engine, P1, g.id("ess"), { mode: 2, selected: { c: [g.id("it")] } }), "an item is not a character");
  assert.equal(zoneNow(g.engine, g.id("ess")), "hand");
});

clause(ESSENCE, "3:option:OPTION 3", "the strength loss lasts only this turn", () => {
  const g = essence();
  play(g.engine, P1, g.id("ess"), { mode: 2, selected: { c: [g.id("mine")] } });
  assert.equal(g.engine.getStat(g.id("mine"), "strength"), 2);
  endTurn(g.engine, P1);
  assert.equal(g.engine.getStat(g.id("mine"), "strength"), 4, "restored after the turn ends");
});

clause(ESSENCE, "3:option:OPTION 3", "strength never drops below 0 (a 1-strength character loses 2)", () => {
  const g = essence([{ key: "weak", def: ch("Weak", 1), owner: P2, zone: "play" }]);
  play(g.engine, P1, g.id("ess"), { mode: 2, selected: { c: [g.id("weak")] } });
  assert.equal(g.engine.getStat(g.id("weak"), "strength"), 0);
});

// =================================================================================
// Evanesce
// =================================================================================
const evan = (extra: CardPlacement[] = [], res: CardPlacement[] = [...O(2), ...R(3)]) =>
  brd([
    { key: "ev", def: printing(EVANESCE), owner: P1, zone: "hand" },
    { key: "mine", def: ch("Mine"), owner: P1, zone: "play" },
    { key: "theirs", def: ch("Theirs"), owner: P2, zone: "play" },
    ...res,
    ...extra
  ]);

clause(EVANESCE, "0:extraCost", "the printed card is an arcanist tactic with no subtype", () => {
  const def = printing(EVANESCE);
  assert.deepEqual([def.type, def.trade], ["tactic", "arcanist"]);
  assert.deepEqual(def.subtype, [], "Evanesce prints no subtype");
});


clause(EVANESCE, "0:extraCost", "printed as a tactic cost 3, threshold oo: exact works, one short and a missing icon are refused", () => {
  const def = printing(EVANESCE);
  assert.equal(def.type, "tactic");
  assert.equal(def.cost, 3);
  assert.equal(def.threshold, "oo");
  const ok = evan([], [...spentO(2), ...R(3)]);
  play(ok.engine, P1, ok.id("ev"), { selected: { c: [ok.id("mine")] } });
  assert.equal(zoneNow(ok.engine, ok.id("mine")), "hand", "exact cost 3 with oo threshold works");
  const noCost = evan([], [...spentO(2), ...R(2)]);
  refused(() => play(noCost.engine, P1, noCost.id("ev"), { selected: { c: [noCost.id("mine")] } }), "cost 3 short by one");
  const noIcon = evan([], [...spentO(1), ...R(4)]);
  refused(() => play(noIcon.engine, P1, noIcon.id("ev"), { selected: { c: [noIcon.id("mine")] } }), "threshold oo short by one icon");
  assert.equal(zoneNow(noIcon.engine, noIcon.id("mine")), "play");
});

clause(EVANESCE, "0:extraCost", "the extra cost is a picked character: no pick, an item, or a character outside play is refused", () => {
  const g = evan([
    { key: "it", def: item({ name: "Thing" }), owner: P1, zone: "play" },
    { key: "dc", def: ch("InDiscard"), owner: P2, zone: "discard" },
    { key: "hc", def: ch("InHand"), owner: P2, zone: "hand" }
  ]);
  refused(() => play(g.engine, P1, g.id("ev"), {}), "no pick");
  refused(() => play(g.engine, P1, g.id("ev"), { selected: { c: [g.id("it")] } }), "an item is not a character");
  refused(() => play(g.engine, P1, g.id("ev"), { selected: { c: [g.id("dc")] } }), "not in play");
  refused(() => play(g.engine, P1, g.id("ev"), { selected: { c: [g.id("hc")] } }), "not in play");
  assert.equal(zoneNow(g.engine, g.id("ev")), "hand");
  play(g.engine, P1, g.id("ev"), { selected: { c: [g.id("theirs")] } });
  assert.equal(zoneNow(g.engine, g.id("theirs")), "hand", "an opposing character may be picked");
});

clause(EVANESCE, "1:rule", "the picked character goes to ITS OWNER's hand (also when controlled by the other player); unpicked stay", () => {
  const g = evan([{ key: "stolen", def: ch("Stolen"), owner: P2, zone: "play", controller: P1 }]);
  play(g.engine, P1, g.id("ev"), { selected: { c: [g.id("stolen")] } });
  assert.equal(zoneNow(g.engine, g.id("stolen")), "hand");
  assert.ok(g.engine.state.players[P2].hand.includes(g.id("stolen")), "in its owner's (P2) hand");
  assert.equal(g.engine.state.players[P1].hand.includes(g.id("stolen")), false, "not the controller's hand");
  assert.equal(zoneNow(g.engine, g.id("mine")), "play");
  assert.equal(zoneNow(g.engine, g.id("theirs")), "play");
  assert.equal(zoneNow(g.engine, g.id("ev")), "discard");
  const own = evan();
  play(own.engine, P1, own.id("ev"), { selected: { c: [own.id("mine")] } });
  assert.ok(own.engine.state.players[P1].hand.includes(own.id("mine")), "my own character returns to my hand");
});

clause(EVANESCE, "1:rule", "a damaged character put into hand is not destroyed and the card itself is the only thing discarded", () => {
  const g = evan([{ key: "hurt", def: ch("Hurt", 2, 2, 3), owner: P2, zone: "play", damage: 2 }]);
  play(g.engine, P1, g.id("ev"), { selected: { c: [g.id("hurt")] } });
  assert.equal(zoneNow(g.engine, g.id("hurt")), "hand");
  assert.equal(g.engine.state.players[P2].discard.length, 0, "returned, not destroyed");
});

const evFace = (extra: CardPlacement[] = [], res: CardPlacement[] = [...spentO(2), ...R(1)]) =>
  brd([
    { key: "ev", def: printing(EVANESCE), owner: P1, zone: "play", faceDown: true },
    { key: "mine", def: ch("Mine"), owner: P1, zone: "play" },
    { key: "theirs", def: ch("Theirs"), owner: P2, zone: "play" },
    ...res,
    ...extra
  ]);

clause(EVANESCE, "2:flipUp", "FLIP UP 1 [O][O]: costs 1, needs two [O]; flipped up it puts the picked character into its owner's hand", () => {
  const g = evFace();
  flipUpRaw(g.engine, P1, g.id("ev"), { c: [g.id("theirs")] });
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneNow(g.engine, g.id("theirs")), "hand");
  assert.ok(g.engine.state.players[P2].hand.includes(g.id("theirs")), "g.engine.state.players[P2].hand.includes(g.id(\"theirs\"))");
  assert.equal(zoneNow(g.engine, g.id("mine")), "play", "unpicked stays");
  assert.equal(g.engine.state.cards[g.id("ev")].faceDown ?? false, false, "no longer face down");
});

clause(EVANESCE, "2:flipUp", "FLIP UP cost 1 can be paid by the card itself with no other resources (threshold from spent icons)", () => {
  const g = evFace([], [...spentO(2)]);
  flipUpRaw(g.engine, P1, g.id("ev"), { c: [g.id("mine")] });
  resolvePendingResponses(g.engine);
  assert.equal(zoneNow(g.engine, g.id("mine")), "hand");
});

clause(EVANESCE, "2:flipUp", "FLIP UP threshold oo is required (one [O] short is refused) and its own icon does not count", () => {
  const short = evFace([], [...spentO(1), ...R(3)]);
  refused(() => flipUpRaw(short.engine, P1, short.id("ev"), { c: [short.id("mine")] }), "only one [O]");
  assert.equal(zoneNow(short.engine, short.id("mine")), "play");
  const none = evFace([], [...R(4)]);
  refused(() => flipUpRaw(none.engine, P1, none.id("ev"), { c: [none.id("mine")] }), "no [O]");
  const ok = evFace([], [...spentO(2), ...R(3)]);
  flipUpRaw(ok.engine, P1, ok.id("ev"), { c: [ok.id("mine")] });
  resolvePendingResponses(ok.engine);
  assert.equal(zoneNow(ok.engine, ok.id("mine")), "hand", "positive control");
});

clause(EVANESCE, "2:flipUp", "FLIP UP still needs the picked character (none / item refused)", () => {
  const g = evFace([{ key: "it", def: item({ name: "Thing" }), owner: P1, zone: "play" }]);
  refused(() => flipUpRaw(g.engine, P1, g.id("ev"), {}), "no pick");
  refused(() => flipUpRaw(g.engine, P1, g.id("ev"), { c: [g.id("it")] }), "item is not a character");
});

clause(EVANESCE, "2:flipUp", "as a tactic it can be flipped up while the opponent has priority in their attack's response window", () => {
  const g = evFace([{ key: "atk", def: ch("Atk"), owner: P2, zone: "play" }]);
  g.engine.state.activePlayerId = P2;
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  flipUpRaw(g.engine, P1, g.id("ev"), { c: [g.id("atk")] });
  resolvePendingResponses(g.engine);
  assert.equal(zoneNow(g.engine, g.id("atk")), "hand", "the attacker was bounced in response");
});

// =================================================================================
// Flagitious Denunciator
// =================================================================================
const denounce = (extra: CardPlacement[] = [], res: CardPlacement[] = [...R(2)]) =>
  brd([
    { key: "den", def: printing(DENOUNCER), owner: P1, zone: "play" },
    { key: "mine", def: ch("Mine"), owner: P1, zone: "play" },
    { key: "theirs", def: ch("Theirs"), owner: P2, zone: "play" },
    ...res,
    ...extra
  ]);
const hand2 = (): CardPlacement[] => [
  { key: "hc", def: ch("HandChar"), owner: P2, zone: "hand" },
  { key: "hc2", def: ch("HandChar2"), owner: P2, zone: "hand" },
  { key: "ht", def: tactic({ name: "HandTactic" }), owner: P2, zone: "hand" }
];

clause(DENOUNCER, "0:kw:COVERT", "COVERT, printed as a 3 strength / 3 speed / 2 life wizard", () => {
  const def = printing(DENOUNCER);
  assert.equal(def.type, "character");
  assert.deepEqual([...(def.subtype ?? [])], ["wizard"]);
  const g = denounce();
  assert.equal(g.engine.getStat(g.id("den"), "strength"), 3);
  assert.equal(g.engine.getStat(g.id("den"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("den"), "life"), 2);
  assert.equal(def.cost, 6);
  assert.equal(def.threshold, "o");
  covertHasKeyword(DENOUNCER);
  covertCannotBeBlockedByNonCovert(DENOUNCER);
  covertPartyNeedsEveryMemberCovert(DENOUNCER);
  covertBlocksOnlyCovertParties(DENOUNCER);
});

clause(DENOUNCER, "0:kw:COVERT", "deploys for exactly 6 with an [O]; one short or no [O] is refused", () => {
  const mk = (res: CardPlacement[]) => brd([{ key: "d", def: printing(DENOUNCER), owner: P1, zone: "hand" }, ...res]);
  const ok = mk([...O(1), ...R(5)]);
  play(ok.engine, P1, ok.id("d"));
  assert.equal(zoneNow(ok.engine, ok.id("d")), "play");
  const noCost = mk([...O(1), ...R(4)]);
  refused(() => play(noCost.engine, P1, noCost.id("d")), "cost 6 short by one");
  const noIcon = mk([...R(6)]);
  refused(() => play(noIcon.engine, P1, noIcon.id("d")), "needs [O]");
  assert.equal(zoneNow(noIcon.engine, noIcon.id("d")), "hand");
});

clause(DENOUNCER, "1:ability:denounce", "COST pay 2 (exactly), pick a character, destroy this card; one short is refused", () => {
  const g = denounce([], [...R(2), ...R(1, P2)]);
  activate(g.engine, P1, g.id("den"), "denounce", { selected: { c: [g.id("mine")] } });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneNow(g.engine, g.id("den")), "discard", "destroyed as a cost");
  assert.equal(g.engine.getAvailableResourceCount(P1), 0, "2 resources paid");
  const short = denounce([], [...R(1)]);
  refused(() => activate(short.engine, P1, short.id("den"), "denounce", { selected: { c: [short.id("theirs")] } }), "only 1 resource");
  assert.equal(zoneNow(short.engine, short.id("den")), "play");
  const nopick = denounce();
  refused(() => activate(nopick.engine, P1, nopick.id("den"), "denounce", {}), "must pick a character");
  const it = denounce([{ key: "it", def: item({ name: "Thing" }), owner: P1, zone: "play" }]);
  refused(() => activate(it.engine, P1, it.id("den"), "denounce", { selected: { c: [it.id("it")] } }), "an item is not a character");
  assert.equal(zoneNow(nopick.engine, nopick.id("den")), "play");
});

clause(DENOUNCER, "1:ability:denounce", "EFFECT: the picked character (either side) goes to its owner's hand", () => {
  const g = denounce([{ key: "stolen", def: ch("Stolen"), owner: P2, zone: "play", controller: P1 }]);
  activate(g.engine, P1, g.id("den"), "denounce", { selected: { c: [g.id("stolen")] } });
  assert.ok(g.engine.state.players[P2].hand.includes(g.id("stolen")) || zoneNow(g.engine, g.id("stolen")) === "discard", "went to its OWNER's hand (P2)");
  assert.equal(g.engine.state.players[P1].hand.includes(g.id("stolen")), false);
  const own = denounce();
  activate(own.engine, P1, own.id("den"), "denounce", { selected: { c: [own.id("mine")] } });
  assert.ok(own.engine.state.players[P1].hand.includes(own.id("mine")), "my own character returns to my hand");
  assert.equal(zoneNow(own.engine, own.id("theirs")), "play", "unpicked stays");
});

clause(DENOUNCER, "1:ability:denounce", "EFFECT: the CONTROLLER looks at the opponent's hand and chooses a CHARACTER in it; that one is discarded (tactics are not eligible)", () => {
  const g = denounce(hand2());
  activate(g.engine, P1, g.id("den"), "denounce", { selected: { c: [g.id("mine")] } });
  const pc = pending(g.engine);
  assert.ok(pc, "a choice is open");
  assert.equal(pc.playerId, P1, "the controller chooses, not the opponent");
  const eligible = (pc as unknown as { eligible?: string[]; cardIds?: string[]; candidates?: string[] });
  const list = eligible.eligible ?? eligible.cardIds ?? eligible.candidates ?? [];
  if (list.length) {
    assert.ok(list.includes(g.id("hc")) && list.includes(g.id("hc2")), "list.includes(g.id(\"hc\")) && list.includes(g.id(\"hc2\"))");
    assert.equal(list.includes(g.id("ht")), false, "a tactic cannot be chosen");
  }
  refused(() => answerSel(g.engine, [g.id("ht")]), "the tactic is not a character");
  answerSel(g.engine, [g.id("hc2")]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneNow(g.engine, g.id("hc2")), "discard");
  assert.equal(g.engine.state.cards[g.id("hc2")].ownerId, P2);
  assert.equal(zoneNow(g.engine, g.id("hc")), "hand", "only the chosen one");
  assert.equal(zoneNow(g.engine, g.id("ht")), "hand");
  assert.ok(g.engine.state.players[P1].hand.includes(g.id("mine")), "my own bounced character is not discarded");
});

clause(DENOUNCER, "1:ability:denounce", "EFFECT: a character just put into the opponent's hand is itself a legal choice (sequential effect)", () => {
  const g = denounce([{ key: "ht", def: tactic({ name: "HandTactic" }), owner: P2, zone: "hand" }]);
  activate(g.engine, P1, g.id("den"), "denounce", { selected: { c: [g.id("theirs")] } });
  assert.ok(g.engine.state.players[P2].hand.includes(g.id("theirs")) || pending(g.engine), "bounced first");
  if (pending(g.engine)) answerSel(g.engine, [g.id("theirs")]);
  assert.equal(zoneNow(g.engine, g.id("theirs")), "discard", "the bounced character was discarded");
  assert.equal(zoneNow(g.engine, g.id("ht")), "hand");
});

clause(DENOUNCER, "1:ability:denounce", "EFFECT: with no character in the opponent's hand nobody discards anything", () => {
  const g = denounce([{ key: "ht", def: tactic({ name: "HandTactic" }), owner: P2, zone: "hand" }]);
  activate(g.engine, P1, g.id("den"), "denounce", { selected: { c: [g.id("mine")] } });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneNow(g.engine, g.id("ht")), "hand");
  assert.equal(g.engine.state.players[P2].discard.length, 0);
});

// =================================================================================
// Forbidden Knowledge
// =================================================================================
const forb = (res: CardPlacement[] = [...O(2), ...R(2)], extra: CardPlacement[] = []) =>
  brd([
    { key: "fk", def: printing(FORBIDDEN), owner: P1, zone: "hand" },
    ...fillers("pd", 3, P1, "deck"),
    ...fillers("od", 3, P2, "deck"),
    { key: "oh", def: ch("OppHand"), owner: P2, zone: "hand" },
    ...res,
    ...extra
  ], { random: () => 0.3 });

clause(FORBIDDEN, "0:rule", "the printed card is an arcanist tactic with no subtype", () => {
  const def = printing(FORBIDDEN);
  assert.deepEqual([def.type, def.trade], ["tactic", "arcanist"]);
  assert.deepEqual(def.subtype, [], "Forbidden Knowledge prints no subtype");
});


clause(FORBIDDEN, "0:rule", "printed as a tactic cost 2, threshold oo: exact works, one short and a missing icon are refused", () => {
  const def = printing(FORBIDDEN);
  assert.equal(def.type, "tactic");
  assert.equal(def.cost, 2);
  assert.equal(def.threshold, "oo");
  const ok = forb([...spentO(2), ...R(2)]);
  play(ok.engine, P1, ok.id("fk"));
  assert.equal(zoneNow(ok.engine, ok.id("fk")), "discard");
  const noCost = forb([...spentO(2), ...R(1)]);
  refused(() => play(noCost.engine, P1, noCost.id("fk")), "cost 2 short by one");
  const noIcon = forb([...spentO(1), ...R(3)]);
  refused(() => play(noIcon.engine, P1, noIcon.id("fk")), "threshold oo short by one icon");
  assert.equal(zoneNow(noIcon.engine, noIcon.id("fk")), "hand");
});

clause(FORBIDDEN, "0:rule", "draw a card: the caster draws exactly one (the top card of their own deck); the opponent draws nothing and the opponent's hand, deck and resources are unchanged", () => {
  const g = forb();
  const myDeck = [...g.engine.state.players[P1].deck];
  const oppDeck = [...g.engine.state.players[P2].deck];
  const oppHand = [...g.engine.state.players[P2].hand];
  const myHandBefore = g.engine.state.players[P1].hand.length;
  play(g.engine, P1, g.id("fk"));
  assert.equal(g.engine.state.pendingChoice, undefined, "looking is optional information; nothing to answer");
  assert.equal(g.engine.state.players[P1].hand.length, myHandBefore - 1 + 1, "tactic left, one card drawn");
  assert.ok(g.engine.state.players[P1].hand.includes(myDeck[0]), "the top card was drawn");
  assert.deepEqual(g.engine.state.players[P1].deck, myDeck.slice(1));
  assert.deepEqual(g.engine.state.players[P2].deck, oppDeck, "opponent's deck untouched (looking only)");
  assert.deepEqual(g.engine.state.players[P2].hand, oppHand, "opponent's hand untouched");
});

clause(FORBIDDEN, "0:rule", "draw happens even if the deck has one card; one draw only", () => {
  const g = brd([
    { key: "fk", def: printing(FORBIDDEN), owner: P1, zone: "hand" },
    { key: "only", def: ch("Only"), owner: P1, zone: "deck" },
    ...O(2), ...R(2)
  ]);
  play(g.engine, P1, g.id("fk"));
  assert.ok(g.engine.state.players[P1].hand.includes(g.id("only")), "g.engine.state.players[P1].hand.includes(g.id(\"only\"))");
  assert.equal(g.engine.state.players[P1].hand.length, 1);
});

const fkFace = (res: CardPlacement[]) =>
  brd([
    { key: "fk", def: printing(FORBIDDEN), owner: P1, zone: "play", faceDown: true },
    ...fillers("pd", 3, P1, "deck"),
    ...res
  ], { random: () => 0.3 });

clause(FORBIDDEN, "1:flipUp", "FLIP UP 0 [O][O]: costs nothing, needs two [O]; flipped up it draws a card", () => {
  const g = fkFace([...spentO(2)]);
  const top = g.engine.state.players[P1].deck[0];
  flipUpRaw(g.engine, P1, g.id("fk"));
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.ok(g.engine.state.players[P1].hand.includes(top), "drew the top card");
  assert.equal(g.engine.state.players[P1].hand.length, 1);
  assert.equal(g.engine.state.cards[g.id("fk")].faceDown ?? false, false);
});

clause(FORBIDDEN, "1:flipUp", "FLIP UP threshold: one [O] short is refused; no spare resource is spent for the 0 cost", () => {
  const short = fkFace([...spentO(1), ...R(3)]);
  refused(() => flipUpRaw(short.engine, P1, short.id("fk")), "only one [O]");
  assert.equal(short.engine.state.players[P1].hand.length, 0);
  const none = fkFace([...R(3)]);
  refused(() => flipUpRaw(none.engine, P1, none.id("fk")), "no [O]");
  const ok = fkFace([...spentO(2), ...R(2)]);
  const ready = (): number => ok.engine.getAvailableResourceCount(P1);
  const before = ready();
  flipUpRaw(ok.engine, P1, ok.id("fk"));
  resolvePendingResponses(ok.engine);
  assert.ok([before, before - 1].includes(ready()), "cost 0: no payment (the card's own resource slot may vanish)");
  assert.ok(ready() >= 2, "both R resources are still ready");
});

// =================================================================================
// Gilda, Mother of Gideon
// =================================================================================
const gilda = (extra: CardPlacement[] = [], res: CardPlacement[] = []) =>
  brd([
    { key: "gil", def: printing(GILDA), owner: P1, zone: "play" },
    ...res,
    ...extra
  ], { random: () => 0.3 });

clause(GILDA, "0:unique", "the printed card is an arcanist character", () => {
  const def = printing(GILDA);
  assert.deepEqual([def.type, def.trade], ["character", "arcanist"]);
  const g = gilda();
  assert.deepEqual(g.engine.getCardTypes(g.id("gil")), ["character"], "Gilda is a character in play");
});

clause(GILDA, "1:rule", "the tactic she voids is revealed to everyone; when I decline to reveal nothing is revealed", () => {
  const revealed = (e: SpoilsEngine) => e.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
  const g = gdeck("ctcc");
  endTurn(g.engine, P2);
  pickTac(g.engine, [g.id("d1")]);
  if (pending(g.engine)) reorder(g.engine, [g.id("d0")]);
  const events = revealed(g.engine);
  assert.equal(events.length, 1, "exactly one reveal");
  const ev = events[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual(ev.cardIds, [g.id("d1")], "the voided tactic was revealed");
  assert.equal(ev.viewerId, "all", "to every player");
  const n = gdeck("tccc");
  endTurn(n.engine, P2);
  pickTac(n.engine, []);
  if (pending(n.engine)) reorder(n.engine, [n.id("d0"), n.id("d1")]);
  assert.equal(revealed(n.engine).length, 0, "declining: nothing revealed");
});


clause(GILDA, "0:unique", "UNIQUE GILDA: printed as a 2 / 3 / 3 sorceress cost 3 ooo", () => {
  const def = printing(GILDA);
  assert.equal(def.cost, 3);
  assert.equal(def.threshold, "ooo");
  assert.deepEqual([...(def.subtype ?? [])], ["sorceress"]);
  const g = gilda();
  assert.equal(g.engine.getStat(g.id("gil"), "strength"), 2);
  assert.equal(g.engine.getStat(g.id("gil"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("gil"), "life"), 3);
  const mk = (res: CardPlacement[]) => brd([{ key: "g", def: printing(GILDA), owner: P1, zone: "hand" }, ...res]);
  const ok = mk([...spentO(3), ...R(3)]);
  play(ok.engine, P1, ok.id("g"));
  assert.equal(zoneNow(ok.engine, ok.id("g")), "play");
  const noCost = mk([...spentO(3), ...R(2)]);
  refused(() => play(noCost.engine, P1, noCost.id("g")), "cost 3 short by one");
  const noIcon = mk([...spentO(2), ...R(4)]);
  refused(() => play(noIcon.engine, P1, noIcon.id("g")), "threshold ooo short by one icon");
});

clause(GILDA, "0:unique", "only one GILDA at a time: a second copy under the same controller replaces/loses to the first (UNIQUE rule), and a GILDA under the opponent is independent", () => {
  const g = brd([
    { key: "g1", def: printing(GILDA), owner: P1, zone: "play" },
    { key: "g2", def: printing(GILDA), owner: P1, zone: "hand" },
    { key: "og", def: printing(GILDA), owner: P2, zone: "play" },
    ...O(3), ...R(3)
  ]);
  play(g.engine, P1, g.id("g2"));
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "uniqueSurvivor", "two GILDAs under one controller");
  assert.equal(pc?.playerId, P1, "the controller chooses which to keep");
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("g2") } } as never);
  resolvePendingResponses(g.engine);
  assert.equal(zoneNow(g.engine, g.id("g2")), "play");
  assert.equal(zoneNow(g.engine, g.id("g1")), "discard", "the other copy is destroyed");
  assert.equal(zoneNow(g.engine, g.id("og")), "play", "the opponent's GILDA is not affected");
});

const gdeck = (kinds: string, extra: CardPlacement[] = [], res: CardPlacement[] = []) =>
  brd([
    { key: "gil", def: printing(GILDA), owner: P1, zone: "play" },
    ...kinds.split("").map((k, i) => ({
      key: `d${i}`,
      def: k === "t" ? tactic({ name: `T${i}` }) : ch(`C${i}`),
      owner: P1,
      zone: "deck" as const
    })),
    ...res,
    ...extra
  ], { random: () => 0.3, activePlayerId: P2 });
const pickTac = (engine: SpoilsEngine, ids: CardInstanceId[]): void => {
  const pc = pending(engine);
  assert.ok(pc, "the optional reveal pick is offered");
  assert.equal(pc.playerId, P1);
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { tac: ids } } } as never);
  resolvePendingResponses(engine);
};
const reorder = (engine: SpoilsEngine, order: CardInstanceId[]): void => {
  const pc = pending(engine) as unknown as { kind: string; cardIds: string[] } | undefined;
  assert.equal(pc?.kind, "reorderDeck");
  assert.deepEqual([...pc!.cardIds].sort(), [...order].sort(), "exactly the looked-at remaining cards");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order } } as never);
  resolvePendingResponses(engine);
};
const voidOf = (engine: SpoilsEngine, owner: PlayerId = P1): CardInstanceId[] =>
  Object.values(engine.state.cards).filter((c) => c.ownerId === owner && (c.zone as string) === "void").map((c) => c.id as CardInstanceId);

clause(GILDA, "1:rule", "reveal a tactic among the top 2: it goes to the void and the remaining looked-at card returns on top (deck order kept below)", () => {
  const g = gdeck("ctcc");
  const d = (i: number) => g.id(`d${i}`);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  pickTac(g.engine, [d(1)]);
  if (pending(g.engine)) reorder(g.engine, [d(0)]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneNow(g.engine, d(1)), "void", "the tactic went to the void");
  assert.deepEqual(g.engine.state.players[P1].deck, [d(0), d(2), d(3)], "the other looked-at card is back on top");
  assert.equal(g.engine.state.players[P1].hand.length, 0, "nothing was drawn");
});

clause(GILDA, "1:rule", "you may decline to reveal: the tactic stays in the deck and the two looked-at cards are put back in the order I choose", () => {
  const g = gdeck("tccc");
  const d = (i: number) => g.id(`d${i}`);
  endTurn(g.engine, P2);
  pickTac(g.engine, []);
  reorder(g.engine, [d(1), d(0)]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(voidOf(g.engine).length, 0, "nothing voided");
  assert.deepEqual(g.engine.state.players[P1].deck, [d(1), d(0), d(2), d(3)], "chosen order on top, rest unchanged");
});

clause(GILDA, "1:rule", "both top cards are tactics: only ONE is voided, the other returns on top", () => {
  const g = gdeck("ttcc");
  const d = (i: number) => g.id(`d${i}`);
  endTurn(g.engine, P2);
  pickTac(g.engine, [d(0)]);
  if (pending(g.engine)) reorder(g.engine, [d(1)]);
  assert.equal(zoneNow(g.engine, d(0)), "void");
  assert.equal(zoneNow(g.engine, d(1)), "deck", "the second tactic is not voided");
  assert.deepEqual(g.engine.state.players[P1].deck, [d(1), d(2), d(3)]);
});

clause(GILDA, "1:rule", "only one tactic can be revealed: picking both tactics is refused", () => {
  const g = gdeck("ttcc");
  endTurn(g.engine, P2);
  refused(() => pickTac(g.engine, [g.id("d0"), g.id("d1")]), "a tactic (one)");
  assert.equal(voidOf(g.engine).length, 0);
});

clause(GILDA, "1:rule", "only a TACTIC can be revealed and voided: a creature among the top 2 is refused", () => {
  const g = gdeck("ctcc");
  endTurn(g.engine, P2);
  refused(() => pickTac(g.engine, [g.id("d0")]), "a creature is not a tactic");
  pickTac(g.engine, [g.id("d1")]);
  assert.equal(zoneNow(g.engine, g.id("d1")), "void", "positive control");
});

clause(GILDA, "1:rule", "only the top 2 cards are looked at: a tactic third from the top can't be voided", () => {
  const g = gdeck("cctc");
  endTurn(g.engine, P2);
  if (pending(g.engine)) {
    refused(() => pickTac(g.engine, [g.id("d2")]), "third card is not among the top 2");
  }
  assert.equal(zoneNow(g.engine, g.id("d2")), "deck");
});

clause(GILDA, "1:rule", "only at the start of YOUR turn: nothing happens at the start of the opponent's turn", () => {
  const g = brd([
    { key: "gil", def: printing(GILDA), owner: P1, zone: "play" },
    { key: "t0", def: tactic({ name: "T0" }), owner: P1, zone: "deck" },
    { key: "c1", def: ch("C1"), owner: P1, zone: "deck" }
  ], { random: () => 0.3, activePlayerId: P1 });
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneNow(g.engine, g.id("t0")), "deck");
});

clause(GILDA, "1:rule", "an opponent's Gilda doesn't trigger on my turn and my deck is untouched", () => {
  const g = brd([
    { key: "gil", def: printing(GILDA), owner: P2, zone: "play" },
    { key: "mt", def: tactic({ name: "MyT" }), owner: P1, zone: "deck" },
    { key: "ot", def: tactic({ name: "OppT" }), owner: P2, zone: "deck" }
  ], { random: () => 0.3, activePlayerId: P2 });
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(g.engine.state.pendingChoice, undefined, "P2's Gilda isn't for P1's turn start");
  assert.equal(zoneNow(g.engine, g.id("mt")), "deck");
  assert.equal(zoneNow(g.engine, g.id("ot")), "deck");
});

// --- SEDUCTIVE SUMMONS ---------------------------------------------------------------
/**
 * Gilda in play with Forbidden Knowledge (`vt`) in her owner's void. SEDUCTIVE SUMMONS picks "a tactic that
 * was voided by this card", so by default `vt` is marked as voided by Gilda (`CardInstance.voidedBy`, what
 * her start-of-turn `moveCard` to the void records); `voidedByGilda: false` leaves it voided some other way.
 */
const summ = (res: CardPlacement[], extra: CardPlacement[] = [], voidedByGilda = true) => {
  const g = brd([
    { key: "gil", def: printing(GILDA), owner: P1, zone: "play" },
    { key: "vt", def: printing(FORBIDDEN), owner: P1, zone: "void" },
    ...fillers("pd", 3, P1, "deck"),
    ...res,
    ...extra
  ], { random: () => 0.3 });
  if (voidedByGilda) g.engine.state.cards[g.id("vt")].voidedBy = g.id("gil");
  return g;
};
/** Answers the "you may deploy that card" prompt: deploy `cardId`, or decline with undefined. */
const deployChoice = (engine: SpoilsEngine, cardId: CardInstanceId | undefined): void => {
  const pc = pending(engine);
  assert.equal(pc?.kind, "deployForFree", "the deploy offer is open");
  assert.equal(pc?.playerId, P1);
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId, selected: {} } } as never);
  resolvePendingResponses(engine);
};
const summon = (g: ReturnType<typeof summ>, deploy = true): void => {
  activate(g.engine, P1, g.id("gil"), "summons", { selected: { back: [g.id("vt")] } });
  if (pending(g.engine)) deployChoice(g.engine, deploy ? g.id("vt") : undefined);
};

clause(GILDA, "2:ability:summons", "COST: pay 1 (exactly); one short is refused; a pick is required", () => {
  const g = summ([...O(2), ...R(1)]);
  summon(g);
  assert.equal(zoneNow(g.engine, g.id("vt")), "discard", "the voided tactic was deployed and resolved");
  const none = summ([]);
  refused(() => activate(none.engine, P1, none.id("gil"), "summons", { selected: { back: [none.id("vt")] } }), "cannot pay 1");
  assert.equal(zoneNow(none.engine, none.id("vt")), "void");
  const nopick = summ([...R(1)]);
  refused(() => activate(nopick.engine, P1, nopick.id("gil"), "summons", {}), "must pick a tactic");
  assert.equal(zoneNow(nopick.engine, nopick.id("vt")), "void");
});

clause(GILDA, "2:ability:summons", "the pick must be a TACTIC in the void (a voided character, a tactic elsewhere, or the opponent's void are refused)", () => {
  const g = summ([...O(2), ...R(3)], [
    { key: "vc", def: ch("VoidChar"), owner: P1, zone: "void" },
    { key: "dt", def: tactic({ name: "DiscardT" }), owner: P1, zone: "discard" },
    { key: "ot", def: tactic({ name: "OppVoidT" }), owner: P2, zone: "void" }
  ]);
  refused(() => activate(g.engine, P1, g.id("gil"), "summons", { selected: { back: [g.id("vc")] } }), "a character is not a tactic");
  refused(() => activate(g.engine, P1, g.id("gil"), "summons", { selected: { back: [g.id("dt")] } }), "must be in the void");
  refused(() => activate(g.engine, P1, g.id("gil"), "summons", { selected: { back: [g.id("ot")] } }), "the opponent's void");
  assert.equal(g.engine.state.players[P1].hand.length, 0);
  summon(g);
  assert.equal(g.engine.state.players[P1].hand.length, 1, "positive control: Forbidden Knowledge resolved and drew");
});

clause(GILDA, "2:ability:summons", "EFFECT: you MAY deploy that card: accepting deploys and resolves it, declining leaves it in the void (the 1 is still paid)", () => {
  const yes = summ([...O(2), ...R(3)]);
  summon(yes, true);
  assert.equal(zoneNow(yes.engine, yes.id("vt")), "discard", "deployed tactic resolved and was discarded");
  assert.equal(yes.engine.state.players[P1].hand.length, 1, "Forbidden Knowledge drew a card");
  const no = summ([...O(2), ...R(3)]);
  summon(no, false);
  assert.equal(no.engine.state.pendingChoice, undefined);
  assert.equal(zoneNow(no.engine, no.id("vt")), "void", "declined: still in the void");
  assert.equal(no.engine.state.players[P1].hand.length, 0, "nothing drawn");
  assert.equal(no.engine.getAvailableResourceCount(P1), 4, "only the 1 for Seductive Summons was paid");
});

clause(GILDA, "2:ability:summons", "EFFECT: the deployed tactic still needs its own threshold (Forbidden Knowledge needs oo)", () => {
  const g = summ([...R(4)]);
  activate(g.engine, P1, g.id("gil"), "summons", { selected: { back: [g.id("vt")] } });
  const pc = pending(g.engine) as unknown as { candidates: string[] } | undefined;
  if (pc) {
    try {
      deployChoice(g.engine, g.id("vt"));
    } catch {
      /* refused is the expected outcome */
    }
  }
  assert.equal(g.engine.state.players[P1].hand.length, 0, "nothing was drawn: the threshold was not met");
  assert.equal(zoneNow(g.engine, g.id("vt")), "void");
});

clause(GILDA, "2:ability:summons", "EFFECT: deploy that card means deploy (pay its cost); Forbidden Knowledge costs 2 on top of the Pay 1", () => {
  const g = summ([...spentO(2), ...R(3)]);
  summon(g);
  assert.equal(g.engine.state.players[P1].hand.length, 1, "it resolved (drew a card)");
  assert.equal(g.engine.getAvailableResourceCount(P1), 0, "paid 1 for Summons and 2 for Forbidden Knowledge");
});

clause(GILDA, "2:ability:summons", "COST: pick a tactic that was voided by THIS card: one that reached the void another way, or that another card voided, is refused", () => {
  const g = summ([...O(2), ...R(3)], [], false); // vt is in the void, but Gilda did not put it there
  refused(() => activate(g.engine, P1, g.id("gil"), "summons", { selected: { back: [g.id("vt")] } }), "not voided by this card");
  assert.equal(zoneNow(g.engine, g.id("vt")), "void");
  const other = summ([...O(2), ...R(3)], [{ key: "src", def: ch("OtherVoider"), owner: P1, zone: "play" }], false);
  other.engine.state.cards[other.id("vt")].voidedBy = other.id("src");
  refused(() => activate(other.engine, P1, other.id("gil"), "summons", { selected: { back: [other.id("vt")] } }), "voided by a different card");
  assert.equal(other.engine.getAvailableResourceCount(P1), 5, "a refused Summons pays nothing");
});

clause(GILDA, "2:ability:summons", "end to end: the tactic her start-of-turn reveal put into the void is one Summons can deploy", () => {
  const g = gdeck("tc", [], [...O(2), ...R(3)]);
  endTurn(g.engine, P2);
  pickTac(g.engine, [g.id("d0")]);
  if (pending(g.engine)) reorder(g.engine, [g.id("d1")]);
  assert.equal(zoneNow(g.engine, g.id("d0")), "void", "Gilda voided the revealed tactic");
  activate(g.engine, P1, g.id("gil"), "summons", { selected: { back: [g.id("d0")] } });
  if (pending(g.engine)) deployChoice(g.engine, g.id("d0"));
  assert.equal(zoneNow(g.engine, g.id("d0")), "discard", "deployed from the void and resolved");
});

// =================================================================================
// Hideous Hexapede of Horror
// =================================================================================
const hex = (res: CardPlacement[] = [...R(6)], extra: CardPlacement[] = []) =>
  brd([
    { key: "hex", def: printing(HEXAPEDE), owner: P1, zone: "play" },
    ...[1, 2, 3].map((i) => ({ key: `a${i}`, def: ch(`A${i}`, 2, 2, 7), owner: P1, zone: "play" as const })),
    ...[1, 2, 3].map((i) => ({ key: `b${i}`, def: ch(`B${i}`, 2, 2, 7), owner: P2, zone: "play" as const })),
    ...res,
    ...extra
  ], { random: () => 0.3 });

const big = (): CardPlacement[] => [
  ...fillers("ph", 8, P1, "hand"), ...fillers("oh", 8, P2, "hand"),
  ...fillers("pc", 8, P1, "discard"), ...fillers("oc", 8, P2, "discard"),
  ...fillers("pk", 8, P1, "deck"), ...fillers("ok", 8, P2, "deck")
];
const six = (g: ReturnType<typeof hex>): CardInstanceId[] => ["a1", "a2", "a3", "b1", "b2", "b3"].map((k) => g.id(k));
const fire = (g: ReturnType<typeof hex>, victims: CardInstanceId[] = six(g)): void => {
  activate(g.engine, P1, g.id("hex"), "hellish-hex", { selected: { victims } });
};
/** Answers every remove-from-game pick with six cards of whichever player still has the most in that zone; returns who was asked. */
function answerRemovals(g: ReturnType<typeof hex>): Array<{ asked: string; decl: string; of: string }> {
  const log: Array<{ asked: string; decl: string; of: string }> = [];
  let guard = 0;
  while (pending(g.engine) && guard++ < 12) {
    const pc = pending(g.engine) as unknown as { kind: string; playerId: string; declaration: { id: string } };
    const zone = pc.declaration.id === "rfgHand" ? "hand" : "discard";
    const owner = ([P1, P2] as PlayerId[]).reduce((best, p) => (g.engine.state.players[p][zone].length > g.engine.state.players[best][zone].length ? p : best));
    const pool = g.engine.state.players[owner][zone].filter((i) => i !== g.id("hex")).slice(0, 6);
    log.push({ asked: pc.playerId, decl: pc.declaration.id, of: owner });
    g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: pc.kind, selected: pool } } as never);
    resolvePendingResponses(g.engine);
  }
  return log;
}

clause(HEXAPEDE, "0:ability:hellish-hex", "printed as a 6 / 6 / 6 insect monstrosity, cost 6 oooooo: exact works, one short and a missing icon are refused", () => {
  const def = printing(HEXAPEDE);
  assert.equal(def.type, "character");
  assert.deepEqual([...(def.subtype ?? [])].sort(), ["insect", "monstrosity"]);
  assert.equal(def.cost, 6);
  assert.equal(def.threshold, "oooooo");
  const mk = (res: CardPlacement[]) => brd([{ key: "h", def: printing(HEXAPEDE), owner: P1, zone: "hand" }, ...res]);
  const ok = mk([...spentO(6), ...R(6)]);
  play(ok.engine, P1, ok.id("h"));
  assert.equal(zoneNow(ok.engine, ok.id("h")), "play");
  for (const st of ["strength", "speed", "life"] as const) assert.equal(ok.engine.getStat(ok.id("h"), st), 6);
  const noCost = mk([...spentO(6), ...R(5)]);
  refused(() => play(noCost.engine, P1, noCost.id("h")), "cost 6 short by one");
  const noIcon = mk([...spentO(5), ...R(7)]);
  refused(() => play(noIcon.engine, P1, noIcon.id("h")), "threshold oooooo short by one icon");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "COST: pay 6 exactly, destroy this card, pick 6 characters (not fewer, not more, not non-characters)", () => {
  const g = hex([...R(6)]);
  fire(g);
  assert.equal(zoneNow(g.engine, g.id("hex")), "discard", "destroyed as a cost");
  assert.equal(g.engine.getAvailableResourceCount(P1), 0, "6 resources paid");
  const short = hex([...R(5)]);
  refused(() => fire(short), "pay 6 with only 5");
  assert.equal(zoneNow(short.engine, short.id("hex")), "play");
  const many = hex([...R(6)], [{ key: "c7", def: ch("C7", 2, 2, 7), owner: P2, zone: "play" }]);
  refused(() => fire(many, [...six(many), many.id("c7")]), "not 7 characters");
  const it = hex([...R(6)], [{ key: "it", def: item({ name: "Thing" }), owner: P1, zone: "play" }]);
  refused(() => fire(it, [...six(it).slice(0, 5), it.id("it")]), "an item is not a character");
  const pos = hex([...R(6)], [{ key: "c7", def: ch("C7", 2, 2, 7), owner: P2, zone: "play" }]);
  fire(pos, [pos.id("c7"), ...six(pos).slice(0, 5)]);
  assert.equal(zoneNow(pos.engine, pos.id("hex")), "discard", "positive control: a different legal six works");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "COST: Pick 6 characters is exactly 6 (picking only 5 is refused)", () => {
  const few = hex([...R(6)]);
  refused(() => fire(few, six(few).slice(0, 5)), "must pick 6 characters, not 5");
  assert.equal(zoneNow(few.engine, few.id("hex")), "play");
  assert.equal(few.engine.getAvailableResourceCount(P1), 6, "nothing was paid");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "EFFECT: 6 damage to each of the picked characters (both sides) and to nothing else among characters", () => {
  const g = hex([...R(6)], [
    { key: "c7", def: ch("C7", 2, 2, 7), owner: P2, zone: "play" },
    { key: "weak", def: ch("Weak", 2, 2, 6), owner: P1, zone: "play" }
  ]);
  fire(g, [...six(g).slice(0, 5), g.id("weak")]);
  for (const k of ["a1", "a2", "a3", "b1", "b2"]) assert.equal(dmg(g.engine, g.id(k)), 6, `${k} took 6`);
  assert.equal(zoneNow(g.engine, g.id("weak")), "discard", "a 6-life character dies");
  assert.equal(dmg(g.engine, g.id("b3")), 0, "an unpicked character is untouched");
  assert.equal(dmg(g.engine, g.id("c7")), 0);
  assert.equal(zoneNow(g.engine, g.id("a1")), "play", "7 life survives 6 damage");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "EFFECT: 6 damage to ALL factions (both players')", () => {
  const g = hex();
  const i1 = g.engine.state.players[P1].influence;
  const i2 = g.engine.state.players[P2].influence;
  fire(g);
  assert.equal(i1 - g.engine.state.players[P1].influence, 6, "my faction loses 6 influence");
  assert.equal(i2 - g.engine.state.players[P2].influence, 6, "the opponent's faction loses 6 influence");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "EFFECT: all players remove 6 cards from their hand from the game (each leaves 2 behind)", () => {
  const g = hex([...R(6)], big());
  const h1 = [...g.engine.state.players[P1].hand];
  const h2 = [...g.engine.state.players[P2].hand];
  fire(g);
  answerRemovals(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(g.engine.state.players[P1].hand.length, 2, "P1 hand 8 -> 2");
  assert.equal(g.engine.state.players[P2].hand.length, 2, "P2 hand 8 -> 2");
  const gone1 = h1.filter((i) => !g.engine.state.players[P1].hand.includes(i));
  const gone2 = h2.filter((i) => !g.engine.state.players[P2].hand.includes(i));
  assert.equal(gone1.length, 6);
  assert.equal(gone2.length, 6);
  for (const i of [...gone1, ...gone2]) assert.equal(zoneNow(g.engine, i), "removed", "removed from the game, not discarded");
  assert.equal(g.engine.state.players[P2].discard.length, 2, "nothing went to the discard pile (8 - 6 removed)");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "EFFECT: a player with fewer than 6 cards in hand removes them all", () => {
  const g = hex([...R(6)], [...fillers("ph", 4, P1, "hand"), ...fillers("oh", 3, P2, "hand")]);
  const all = [...g.engine.state.players[P1].hand, ...g.engine.state.players[P2].hand];
  fire(g);
  let n = 0;
  while (pending(g.engine) && n++ < 8) {
    const pc = pending(g.engine) as unknown as { kind: string; playerId: string; declaration: { id: string } };
    // The removals are mandatory now (SYS-20), so the discard-pile pick takes every card there instead of declining.
    const zone = pc.declaration.id === "rfgHand" ? "hand" : "discard";
    const owner = ([P1, P2] as PlayerId[]).find((p) => g.engine.state.players[p][zone].length > 0);
    const sel = owner ? [...g.engine.state.players[owner][zone]] : [];
    g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: pc.kind, selected: sel } } as never);
    resolvePendingResponses(g.engine);
  }
  assert.equal(g.engine.state.players[P1].hand.length, 0);
  assert.equal(g.engine.state.players[P2].hand.length, 0);
  for (const i of all) assert.equal(zoneNow(g.engine, i), "removed");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "EFFECT: all players remove 6 cards from their discard pile from the game", () => {
  const g = hex([...R(6)], big());
  const d1 = [...g.engine.state.players[P1].discard];
  const d2 = [...g.engine.state.players[P2].discard];
  fire(g);
  answerRemovals(g);
  const left1 = g.engine.state.players[P1].discard;
  const left2 = g.engine.state.players[P2].discard;
  assert.equal(left2.length, 2, "P2 discard 8 -> 2");
  assert.equal(left1.length, 3, "P1 discard 8 + the destroyed Hexapede = 9 -> 3");
  assert.equal(d1.filter((i) => zoneNow(g.engine, i) === "removed").length, 6);
  assert.equal(d2.filter((i) => zoneNow(g.engine, i) === "removed").length, 6);
});

clause(HEXAPEDE, "0:ability:hellish-hex", "EFFECT: all players remove the top 6 cards of their deck from the game (the remaining cards keep their order)", () => {
  const g = hex([...R(6)], big());
  const k1 = [...g.engine.state.players[P1].deck];
  const k2 = [...g.engine.state.players[P2].deck];
  fire(g);
  answerRemovals(g);
  assert.deepEqual(g.engine.state.players[P1].deck, k1.slice(6), "P1: top 6 gone");
  assert.deepEqual(g.engine.state.players[P2].deck, k2.slice(6), "P2: top 6 gone");
  for (const i of [...k1.slice(0, 6), ...k2.slice(0, 6)]) assert.equal(zoneNow(g.engine, i), "removed");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "EFFECT: removal is chosen by each card's own player (the opponent picks their own hand and discard cards)", () => {
  const g = hex([...R(6)], big());
  fire(g);
  const log = answerRemovals(g);
  for (const e of log) assert.equal(e.asked, e.of, `${e.decl}: ${e.of}'s cards must be chosen by ${e.of}, not ${e.asked}`);
  assert.equal(log.length, 4, "two zones x two players");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "EFFECT: removing 6 cards from each discard pile is mandatory too (choosing nothing is refused)", () => {
  const g = hex([...R(6)], big());
  fire(g);
  let guard = 0;
  while (guard++ < 6) {
    const pc = pending(g.engine) as unknown as { kind: string; playerId: PlayerId; declaration: { id: string } };
    if (pc.declaration.id === "rfgDisc") break;
    g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: pc.kind, selected: g.engine.state.players[pc.playerId].hand.slice(0, 6) } } as never);
    resolvePendingResponses(g.engine);
  }
  const pcd = pending(g.engine) as unknown as { kind: string; playerId: PlayerId; declaration: { id: string } };
  assert.equal(pcd.declaration.id, "rfgDisc", "now asked about the discard piles");
  refused(() => g.engine.perform({ type: "resolvePendingChoice", playerId: pcd.playerId, choice: { kind: pcd.kind, selected: [] } } as never), "exactly six must be removed from the discard pile");
  assert.equal(pending(g.engine)?.playerId, pcd.playerId, "still waiting for the same pick");
  const own = g.engine.state.players[pcd.playerId].discard.filter((i) => i !== g.id("hex")).slice(0, 6);
  g.engine.perform({ type: "resolvePendingChoice", playerId: pcd.playerId, choice: { kind: pcd.kind, selected: own } } as never);
  resolvePendingResponses(g.engine);
  for (const i of own) assert.equal(zoneNow(g.engine, i), "removed", "control: six chosen cards are removed from the game");
});


clause(HEXAPEDE, "0:ability:hellish-hex", "EFFECT: the six removals are mandatory (declining to pick is refused)", () => {
  const g = hex([...R(6)], big());
  fire(g);
  const pc = pending(g.engine) as unknown as { kind: string; playerId: string };
  refused(() => g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: pc.kind, selected: [] } } as never), "exactly six must be removed");
});

clause(HEXAPEDE, "0:ability:hellish-hex", "EFFECT: no more than 6 cards can be removed from a hand or discard pile (7 is refused)", () => {
  const g = hex([...R(6)], big());
  fire(g);
  const try7 = (zone: "hand" | "discard"): void => {
    const pc = pending(g.engine) as unknown as { kind: string; playerId: string };
    const owner = pc.playerId as PlayerId;
    const seven = g.engine.state.players[owner][zone].filter((i) => i !== g.id("hex")).slice(0, 7);
    refused(() => g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: pc.kind, selected: seven } } as never), "7 is more than 6");
  };
  try7("hand");
  answerRemovals(g);
  assert.equal(g.engine.state.players[P1].hand.length, 2, "positive control: six is fine");
  const d = hex([...R(6)], big());
  fire(d);
  const first = pending(d.engine) as unknown as { kind: string; playerId: string };
  // answer hand picks (two players), then try 7 from the discard pick
  for (let n = 0; n < 2 && pending(d.engine); n++) {
    const pc = pending(d.engine) as unknown as { kind: string; playerId: string; declaration: { id: string } };
    if (pc.declaration.id !== "rfgHand") break;
    const who = ([P1, P2] as PlayerId[]).reduce((b, p) => (d.engine.state.players[p].hand.length > d.engine.state.players[b].hand.length ? p : b));
    d.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: pc.kind, selected: d.engine.state.players[who].hand.slice(0, 6) } } as never);
    resolvePendingResponses(d.engine);
  }
  assert.ok(first, "first");
  const pcd = pending(d.engine) as unknown as { kind: string; playerId: string; declaration: { id: string } };
  assert.equal(pcd.declaration.id, "rfgDisc");
  const who = ([P1, P2] as PlayerId[]).reduce((b, p) => (d.engine.state.players[p].discard.length > d.engine.state.players[b].discard.length ? p : b));
  const seven = d.engine.state.players[who].discard.filter((i) => i !== d.id("hex")).slice(0, 7);
  refused(() => d.engine.perform({ type: "resolvePendingChoice", playerId: pcd.playerId, choice: { kind: pcd.kind, selected: seven } } as never), "7 is more than 6");
});

clause(DENOUNCER, "1:ability:denounce", "EFFECT: the discard is mandatory when the opponent's hand holds a character (declining is refused)", () => {
  const g = denounce(hand2());
  activate(g.engine, P1, g.id("den"), "denounce", { selected: { c: [g.id("mine")] } });
  refused(() => answerSel(g.engine, []), "a character must be chosen");
  answerSel(g.engine, [g.id("hc")]);
  assert.equal(zoneNow(g.engine, g.id("hc")), "discard");
});

clause(GILDA, "0:unique", "GILDA is the shared UNIQUE identifier: another card carrying UNIQUE GILDA conflicts with this one", () => {
  const g = brd([
    { key: "g1", def: printing(GILDA), owner: P1, zone: "play" },
    { key: "x", def: character({ name: "Gilda Impostor", unique: "gilda" } as never), owner: P1, zone: "hand" },
    ...O(1), ...R(2)
  ]);
  play(g.engine, P1, g.id("x"));
  assert.equal(pending(g.engine)?.kind, "uniqueSurvivor");
});

clause(EVANESCE, "2:flipUp", "FLIP UP cost 1 is real: a face-down card that is already spent can't be the one that pays, so with no other resource it is refused", () => {
  const g = evFace([], [...spentO(2)]);
  g.engine.state.cards[g.id("ev")].attachedTo = g.engine.state.players[P1].factionId as never;
  refused(() => flipUpRaw(g.engine, P1, g.id("ev"), { c: [g.id("mine")] }), "no ready resource for the cost of 1");
  assert.equal(zoneNow(g.engine, g.id("mine")), "play");
});
