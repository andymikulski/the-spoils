// Clause tests, batch holy-heist-06, part p1 (groups 1-5, missing clauses only).
// Craniata Nester, Deceptive Domain, Don't Trip, Dweedle Tee, Ferret Oil Coating.
import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import {
  buildGame,
  activate,
  autoResolveBattle,
  bank,
  character,
  developFaction,
  item,
  location,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic,
  volition,
  P1,
  P2
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { declareAttackBy, declareAttackOpenWindow, playRaw } from "./_battle.js";
import { pending, readyResources, zoneOf, tokensOn, declareBlockers } from "./_board.js";
import { clause, printing, refused, flipUpNow, holdCostChoices } from "./_clause.js";
import { developResource, endTurn, factionOf } from "./_turn.js";

const NESTER = "1a1d1224-d3ac-4a6f-bf31-01cd5477f1d7"; // Craniata Nester
const DOMAIN = "969913a5-1444-4d50-9225-9e82a30a56a6"; // Deceptive Domain
const TRIP = "1cb45623-65ab-4331-a189-68a57d0e9cdc"; // Don't Trip
const DWEEDLE = "3714b3c6-39af-4c56-a508-ad389be90933"; // Dweedle Tee
const FERRET = "e92ff486-08f4-48c6-b76e-1d866108f1f0"; // Ferret Oil Coating

const ready = (engine: SpoilsEngine, p: PlayerId = P1) => readyResources(engine, p);
const rawFlipUp = (engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}): void =>
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });
const cardOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId];
const deckOf = (engine: SpoilsEngine, p: PlayerId) => [...engine.state.players[p].deck];
const discardOf = (engine: SpoilsEngine, p: PlayerId) => [...engine.state.players[p].discard];
const influence = (engine: SpoilsEngine, p: PlayerId) => engine.state.players[p].influence;
const events = (engine: SpoilsEngine, type: string): Array<Record<string, unknown>> =>
  engine
    .getLog()
    .map((entry) => entry.event as unknown as Record<string, unknown> | undefined)
    .filter((event): event is Record<string, unknown> => !!event && event.type === type);
const lcg = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

// ============================================================================
// Craniata Nester -- cost 3 [DDD], 2/3/2 -- when a card providing at least [V] enters play under your control, may mill
// the opponent's top card; +1/+1 per character card in each opponent's discard pile
// ============================================================================

const resolveOption = (engine: SpoilsEngine, index: number): void =>
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index } } as never);

/** Answers every "may" prompt (counting them): index 1 = do it, 0 = decline. */
function answerMay(engine: SpoilsEngine, index: number): number {
  let n = 0;
  while (pending(engine)?.kind === "chooserSelectsOption" && n < 5) {
    resolveOption(engine, index);
    n++;
  }
  return n;
}

function nesterBoard(opts: { active?: PlayerId; nester?: "play" | "hand"; extra?: CardPlacement[] } = {}) {
  const active = opts.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [
      { key: "cn", def: printing(NESTER), owner: P1, zone: opts.nester ?? "play" },
      { key: "fdCard", def: character({ name: "FdCard" }), owner: P1, zone: "hand" },
      { key: "foeFd", def: character({ name: "FoeFd" }), owner: P2, zone: "hand" },
      { key: "vRes", def: resourceCard({ name: "VRes", resource: { provides: ["volition"], staple: false } }), owner: P1, zone: "hand" },
      { key: "dRes", def: resourceCard({ name: "DRes", resource: { provides: ["deception"], staple: true } }), owner: P1, zone: "hand" },
      { key: "foeVRes", def: resourceCard({ name: "FoeVRes", resource: { provides: ["volition"], staple: false } }), owner: P2, zone: "hand" },
      { key: "walker", def: character({ name: "Walker", cost: 0 }), owner: P1, zone: "hand" },
      { key: "d0", def: character({ name: "D0" }), owner: P2, zone: "deck" },
      { key: "d1", def: character({ name: "D1" }), owner: P2, zone: "deck" },
      { key: "d2", def: character({ name: "D2" }), owner: P2, zone: "deck" },
      { key: "d3", def: character({ name: "D3" }), owner: P2, zone: "deck" },
      { key: "m0", def: character({ name: "M0" }), owner: P1, zone: "deck" },
      { key: "m1", def: character({ name: "M1" }), owner: P1, zone: "deck" },
      ...(opts.extra ?? [])
    ]
  });
}

clause(NESTER, "0:rule", "a card entering play face-down as a resource (it is a Volition resource): you may mill; accepting puts exactly the opponent's top card into THEIR discard pile and nothing else moves", () => {
  const { engine, id } = nesterBoard();
  const oppDeck = deckOf(engine, P2);
  const myDeck = deckOf(engine, P1);
  assert.equal(oppDeck.length, 4);
  developResource(engine, P1, id("fdCard"), true);
  assert.equal(zoneOf(engine, id("fdCard")), "play");
  assert.equal(cardOf(engine, id("fdCard")).faceDown, true);
  assert.equal(pending(engine)?.kind, "chooserSelectsOption", "asked whether to pick an opponent");
  assert.equal(pending(engine)?.playerId, P1, "the Nester's controller decides");
  assert.equal(answerMay(engine, 1), 1, "asked exactly once");
  resolvePendingResponses(engine);
  assert.equal(pending(engine), undefined);
  assert.deepEqual(discardOf(engine, P2), [oppDeck[0]], "the top card of the opponent's deck is in their discard pile");
  assert.deepEqual(deckOf(engine, P2), oppDeck.slice(1), "the rest of their deck is untouched and in order");
  assert.deepEqual(deckOf(engine, P1), myDeck, "my own deck is untouched");
  assert.deepEqual(discardOf(engine, P1), [], "nothing of mine was milled");
});

clause(NESTER, "0:rule", "declining the 'may' mills nothing", () => {
  const { engine, id } = nesterBoard();
  const oppDeck = deckOf(engine, P2);
  developResource(engine, P1, id("fdCard"), true);
  assert.equal(pending(engine)?.kind, "chooserSelectsOption");
  assert.equal(answerMay(engine, 0), 1);
  resolvePendingResponses(engine);
  assert.equal(pending(engine), undefined);
  assert.deepEqual(deckOf(engine, P2), oppDeck, "their deck is unchanged");
  assert.deepEqual(discardOf(engine, P2), []);
});

clause(NESTER, "0:rule", "a face-up resource that provides [V] entering play under your control also triggers it", () => {
  const { engine, id } = nesterBoard();
  const oppDeck = deckOf(engine, P2);
  developResource(engine, P1, id("vRes"), false);
  assert.equal(cardOf(engine, id("vRes")).faceDown, false);
  assert.equal(zoneOf(engine, id("vRes")), "play");
  assert.equal(pending(engine)?.kind, "chooserSelectsOption");
  assert.equal(answerMay(engine, 1), 1, "asked exactly once");
  resolvePendingResponses(engine);
  assert.deepEqual(discardOf(engine, P2), [oppDeck[0]]);
  assert.equal(deckOf(engine, P2).length, 3, "exactly one card milled");
});

clause(NESTER, "0:rule", "a face-up resource that provides only [D] (not [V]) does not trigger it", () => {
  const { engine, id } = nesterBoard();
  const oppDeck = deckOf(engine, P2);
  developResource(engine, P1, id("dRes"), false);
  assert.equal(zoneOf(engine, id("dRes")), "play");
  assert.equal(cardOf(engine, id("dRes")).faceDown, false);
  assert.equal(pending(engine), undefined, "no prompt");
  assert.deepEqual(deckOf(engine, P2), oppDeck);
  assert.deepEqual(discardOf(engine, P2), []);
});

clause(NESTER, "0:rule", "a face-up character (providing nothing) entering play does not trigger it", () => {
  const { engine, id } = nesterBoard();
  const oppDeck = deckOf(engine, P2);
  play(engine, P1, id("walker"));
  assert.equal(zoneOf(engine, id("walker")), "play");
  assert.equal(pending(engine), undefined, "no prompt");
  assert.deepEqual(deckOf(engine, P2), oppDeck);
});

clause(NESTER, "0:rule", "a [V] card entering play under the OPPONENT's control does not trigger it (my Nester only cares about my cards)", () => {
  const { engine, id } = nesterBoard({ active: P2 });
  const oppDeck = deckOf(engine, P2);
  const myDeck = deckOf(engine, P1);
  developResource(engine, P2, id("foeFd"), true);
  assert.equal(zoneOf(engine, id("foeFd")), "play");
  assert.equal(pending(engine), undefined, "no prompt");
  const second = nesterBoard({ active: P2 });
  developResource(second.engine, P2, second.id("foeVRes"), false);
  assert.equal(zoneOf(second.engine, second.id("foeVRes")), "play");
  assert.equal(pending(second.engine), undefined, "an opponent's face-up [V] provider doesn't trigger it either");
  assert.deepEqual(deckOf(engine, P2), oppDeck);
  assert.deepEqual(deckOf(engine, P1), myDeck);
});

clause(NESTER, "0:rule", "does nothing while the Nester is not in play (in hand)", () => {
  const { engine, id } = nesterBoard({ nester: "hand" });
  const oppDeck = deckOf(engine, P2);
  developResource(engine, P1, id("fdCard"), true);
  assert.equal(zoneOf(engine, id("fdCard")), "play");
  assert.equal(pending(engine), undefined, "no prompt");
  assert.deepEqual(deckOf(engine, P2), oppDeck);
});

const putter = (type: "character" | "resource") =>
  tactic({
    name: "Putter",
    cost: 0,
    behavior: {
      abilities: [{ id: "p", type: "activated", targets: [{ id: "t", selector: { zone: "hand", type, owner: "self" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }]
    }
  });

clause(NESTER, "0:rule", "a [V]-providing card put into play by an EFFECT under my control triggers it too (accept mills one, decline mills none); a character put into play that way doesn't", () => {
  const withPut = (kind: "character" | "resource", index: number) => {
    const g = nesterBoard({ extra: [{ key: "put", def: putter(kind), owner: P1, zone: "hand" }] });
    return g;
  };
  const acc = withPut("resource", 1);
  const oppDeck = deckOf(acc.engine, P2);
  play(acc.engine, P1, acc.id("put"), { selected: { t: [acc.id("vRes")] } });
  assert.equal(zoneOf(acc.engine, acc.id("vRes")), "play");
  assert.equal(pending(acc.engine)?.kind, "chooserSelectsOption");
  assert.equal(answerMay(acc.engine, 1), 1, "asked exactly once");
  resolvePendingResponses(acc.engine);
  assert.deepEqual(discardOf(acc.engine, P2), [oppDeck[0]]);
  assert.equal(deckOf(acc.engine, P2).length, 3);
  const dec = withPut("resource", 0);
  const decDeck = deckOf(dec.engine, P2);
  play(dec.engine, P1, dec.id("put"), { selected: { t: [dec.id("vRes")] } });
  assert.equal(answerMay(dec.engine, 0), 1);
  resolvePendingResponses(dec.engine);
  assert.deepEqual(deckOf(dec.engine, P2), decDeck);
  const chr = withPut("character", 0);
  const chrDeck = deckOf(chr.engine, P2);
  play(chr.engine, P1, chr.id("put"), { selected: { t: [chr.id("walker")] } });
  assert.equal(zoneOf(chr.engine, chr.id("walker")), "play");
  assert.equal(pending(chr.engine), undefined, "a character provides nothing");
  assert.deepEqual(deckOf(chr.engine, P2), chrDeck);
});

clause(NESTER, "1:rule", "gains exactly +1 strength and +1 life per character card in the opponent's discard pile (and not speed): 0, 1, 3", () => {
  const stats = (n: number) => {
    const { engine, id } = buildGame({
      cards: [
        { key: "cn", def: printing(NESTER), owner: P1, zone: "play" },
        ...Array.from({ length: n }, (_, i) => ({ key: `g${i}`, def: character({ name: `G${i}` }), owner: P2, zone: "discard" as const }))
      ]
    });
    return [engine.getStat(id("cn"), "strength"), engine.getStat(id("cn"), "life"), engine.getStat(id("cn"), "speed")];
  };
  assert.deepEqual(stats(0), [2, 2, 3]);
  assert.deepEqual(stats(1), [3, 3, 3]);
  assert.deepEqual(stats(3), [5, 5, 3]);
});

clause(NESTER, "1:rule", "counts only CHARACTER cards in an opponent's discard pile: items, tactics and locations there don't count, and neither do my own discard, their hand, deck or play", () => {
  const { engine, id } = buildGame({
    cards: [
      { key: "cn", def: printing(NESTER), owner: P1, zone: "play" },
      { key: "g0", def: character({ name: "G0" }), owner: P2, zone: "discard" },
      { key: "oItem", def: item({ name: "OItem" }), owner: P2, zone: "discard" },
      { key: "oTac", def: tactic({ name: "OTac" }), owner: P2, zone: "discard" },
      { key: "oLoc", def: location({ name: "OLoc" }), owner: P2, zone: "discard" },
      { key: "mine1", def: character({ name: "Mine1" }), owner: P1, zone: "discard" },
      { key: "mine2", def: character({ name: "Mine2" }), owner: P1, zone: "discard" },
      { key: "oHand", def: character({ name: "OHand" }), owner: P2, zone: "hand" },
      { key: "oDeck", def: character({ name: "ODeck" }), owner: P2, zone: "deck" },
      { key: "oPlay", def: character({ name: "OPlay" }), owner: P2, zone: "play" }
    ]
  });
  assert.equal(engine.getStat(id("cn"), "strength"), 3, "only the one opposing character card counts");
  assert.equal(engine.getStat(id("cn"), "life"), 3);
});

clause(NESTER, "1:rule", "'opponent' is relative to the Nester's controller: a Nester I own but my opponent controls counts MY discard pile", () => {
  const { engine, id } = buildGame({
    cards: [
      { key: "cn", def: printing(NESTER), owner: P1, controller: P2, zone: "play" },
      { key: "mine1", def: character({ name: "Mine1" }), owner: P1, zone: "discard" },
      { key: "mine2", def: character({ name: "Mine2" }), owner: P1, zone: "discard" },
      { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "discard" }
    ]
  });
  assert.equal(engine.getStat(id("cn"), "strength"), 4, "its controller's opponent is P1: two characters count, P2's own discard doesn't");
  assert.equal(engine.getStat(id("cn"), "life"), 4);
});

clause(NESTER, "1:rule", "updates as the discard pile changes: milling a character with its own trigger grows it by 1/1, milling a non-character does not", () => {
  const withTop = (def: CardDefinition) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cn", def: printing(NESTER), owner: P1, zone: "play" },
        { key: "fdCard", def: character({ name: "FdCard" }), owner: P1, zone: "hand" },
        { key: "top", def: def, owner: P2, zone: "deck" },
        { key: "next", def: character({ name: "Next" }), owner: P2, zone: "deck" }
      ]
    });
  const chr = withTop(character({ name: "TopChar" }));
  assert.equal(chr.engine.getStat(chr.id("cn"), "strength"), 2);
  developResource(chr.engine, P1, chr.id("fdCard"), true);
  answerMay(chr.engine, 1);
  resolvePendingResponses(chr.engine);
  assert.deepEqual(discardOf(chr.engine, P2), [chr.id("top")]);
  assert.equal(chr.engine.getStat(chr.id("cn"), "strength"), 3);
  assert.equal(chr.engine.getStat(chr.id("cn"), "life"), 3);
  const itm = withTop(item({ name: "TopItem" }));
  developResource(itm.engine, P1, itm.id("fdCard"), true);
  answerMay(itm.engine, 1);
  resolvePendingResponses(itm.engine);
  assert.deepEqual(discardOf(itm.engine, P2), [itm.id("top")]);
  assert.equal(itm.engine.getStat(itm.id("cn"), "strength"), 2, "an item doesn't count");
});

// ============================================================================
// Deceptive Domain -- resource, cost 0, provides [D]; face-down only from hand; FLIP IT [D]
// ============================================================================

function domainBoard(extra: CardPlacement[] = [], opts: { domain?: "hand" | "play"; faceDown?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "dd", def: printing(DOMAIN), owner: P1, zone: opts.domain ?? "play", faceDown: opts.faceDown ?? true },
      { key: "plainRes", def: resourceCard({ name: "PlainRes" }), owner: P1, zone: "hand" },
      ...extra
    ]
  });
}

clause(DOMAIN, "0:rule", "can be played from hand face-down as a resource", () => {
  const { engine, id } = domainBoard([], { domain: "hand", faceDown: false });
  developResource(engine, P1, id("dd"), true);
  assert.equal(zoneOf(engine, id("dd")), "play");
  assert.equal(cardOf(engine, id("dd")).faceDown, true);
});

clause(DOMAIN, "0:rule", "may NOT be played from hand face-up (a control resource card can be)", () => {
  const { engine, id } = domainBoard([], { domain: "hand", faceDown: false });
  developResource(engine, P1, id("dd"), false); // asked to play it face-up: it only plays face-down
  assert.equal(zoneOf(engine, id("dd")), "play");
  assert.equal(cardOf(engine, id("dd")).faceDown, true, "the Domain can only be played face-down");
  developResource(engine, P1, id("plainRes"), false);
  assert.equal(zoneOf(engine, id("plainRes")), "play", "control: an ordinary resource can be played face-up");
  assert.equal(cardOf(engine, id("plainRes")).faceDown, false);
});

clause(DOMAIN, "1:provides", "face-up in play it provides exactly one [D]: it alone pays a cost-1 [D] character, but not a cost-2 one", () => {
  const cheap = character({ name: "Cheap", cost: 1, threshold: "d" as never });
  const dear = character({ name: "Dear", cost: 2, threshold: "d" as never });
  const one = domainBoard([{ key: "c", def: cheap, owner: P1, zone: "hand" }], { faceDown: false });
  assert.equal(ready(one.engine), 1);
  play(one.engine, P1, one.id("c"));
  assert.equal(zoneOf(one.engine, one.id("c")), "play", "[D] from the Domain meets the threshold and pays 1");
  assert.equal(ready(one.engine), 0, "it was spent");
  const two = domainBoard([{ key: "c", def: dear, owner: P1, zone: "hand" }], { faceDown: false });
  refused(() => play(two.engine, P1, two.id("c")), "only one resource for a cost of 2", /Costs cannot be paid/);
  assert.equal(zoneOf(two.engine, two.id("c")), "hand");
  const three = domainBoard([{ key: "c", def: dear, owner: P1, zone: "hand" }, ...bank("rage", 1, P1)], { faceDown: false });
  play(three.engine, P1, three.id("c"));
  assert.equal(zoneOf(three.engine, three.id("c")), "play", "the Domain's [D] plus one other resource pays for cost 2");
  assert.equal(ready(three.engine), 0);
});

clause(DOMAIN, "1:provides", "provides [D] and nothing else: it does not satisfy a [R] threshold", () => {
  const rageChar = character({ name: "RageChar", cost: 1, threshold: "r" as never });
  const b = domainBoard([{ key: "c", def: rageChar, owner: P1, zone: "hand" }], { faceDown: false });
  refused(() => play(b.engine, P1, b.id("c")), "the Domain gives no [R]", /Threshold requirements are not met/);
  assert.equal(zoneOf(b.engine, b.id("c")), "hand");
  const ok = domainBoard([{ key: "c", def: rageChar, owner: P1, zone: "hand" }, ...bank("rage", 1, P1)], { faceDown: false });
  play(ok.engine, P1, ok.id("c"));
  assert.equal(zoneOf(ok.engine, ok.id("c")), "play", "control: a real [R] works");
});

clause(DOMAIN, "1:provides", "face-down it is just a Volition resource: it can't satisfy a [D] threshold, but does pay a [V] one", () => {
  const dChar = character({ name: "DChar", cost: 1, threshold: "d" as never });
  const vChar = character({ name: "VChar", cost: 1, threshold: "v" as never });
  const noD = domainBoard([{ key: "c", def: dChar, owner: P1, zone: "hand" }]);
  refused(() => play(noD.engine, P1, noD.id("c")), "a face-down Domain gives no [D]", /Threshold requirements are not met/);
  assert.equal(zoneOf(noD.engine, noD.id("c")), "hand");
  const v = domainBoard([{ key: "c", def: vChar, owner: P1, zone: "hand" }]);
  play(v.engine, P1, v.id("c"));
  assert.equal(zoneOf(v.engine, v.id("c")), "play", "control: the face-down Domain is a Volition resource");
});

const flipBoard = (locCost: number, banksN: number, extra: CardPlacement[] = []) =>
  domainBoard([
    { key: "loc", def: location({ name: "Loc", cost: locCost }), owner: P2, zone: "play" },
    ...bank("deception", banksN, P1),
    ...extra
  ]);

clause(DOMAIN, "2:ability:flip-it", "cost X+4 where X is the picked location's numeric cost: X=0 pays 4 (of 7 resources), X=3 pays 7", () => {
  const zero = flipBoard(0, 6);
  assert.equal(ready(zero.engine), 7, "6 banks + the face-down Domain itself");
  activate(zero.engine, P1, zero.id("dd"), "flip-it", { selected: { loc: [zero.id("loc")] } });
  assert.equal(pending(zero.engine), undefined);
  assert.equal(ready(zero.engine), 3, "X=0: 4 paid");
  const three = flipBoard(3, 7);
  assert.equal(ready(three.engine), 8);
  activate(three.engine, P1, three.id("dd"), "flip-it", { selected: { loc: [three.id("loc")] } });
  assert.equal(pending(three.engine), undefined);
  assert.equal(ready(three.engine), 1, "X=3: 7 paid");
});

clause(DOMAIN, "2:ability:flip-it", "effect: the Domain is put into play face-up and I take control of the location (its owner stays the same)", () => {
  const b = flipBoard(2, 8);
  assert.equal(cardOf(b.engine, b.id("dd")).faceDown, true);
  assert.equal(cardOf(b.engine, b.id("loc")).controllerId, P2);
  activate(b.engine, P1, b.id("dd"), "flip-it", { selected: { loc: [b.id("loc")] } });
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("dd")), "play", "the Domain is in play");
  assert.equal(cardOf(b.engine, b.id("dd")).faceDown, false, "face-up");
  assert.equal(cardOf(b.engine, b.id("dd")).controllerId, P1);
  assert.equal(zoneOf(b.engine, b.id("loc")), "play");
  assert.equal(cardOf(b.engine, b.id("loc")).controllerId, P1, "I control the location");
  assert.equal(cardOf(b.engine, b.id("loc")).ownerId, P2, "its owner is unchanged");
  assert.ok(b.engine.state.players[P1].play.includes(b.id("loc")), "listed among my cards in play");
  assert.ok(!b.engine.state.players[P2].play.includes(b.id("loc")), "!b.engine.state.players[P2].play.includes(b.id(\"loc\"))");
});

clause(DOMAIN, "2:ability:flip-it", "after flipping, the Domain provides [D] face-up", () => {
  const b = flipBoard(0, 6, [{ key: "c", def: character({ name: "DChar", cost: 1, threshold: "d" as never }), owner: P1, zone: "hand" }]);
  activate(b.engine, P1, b.id("dd"), "flip-it", { selected: { loc: [b.id("loc")] } });
  assert.equal(cardOf(b.engine, b.id("dd")).faceDown, false);
  assert.equal(ready(b.engine), 3, "7 resources (6 banks + the Domain), 4 paid: 3 left");
  play(b.engine, P1, b.id("c"));
  assert.equal(zoneOf(b.engine, b.id("c")), "play", "the flipped Domain's [D] (or a bank's) is available");
});

clause(DOMAIN, "2:ability:flip-it", "I can pick a location I already control", () => {
  const b = domainBoard([
    { key: "mine", def: location({ name: "Mine", cost: 1 }), owner: P1, zone: "play" },
    ...bank("deception", 5, P1)
  ]);
  activate(b.engine, P1, b.id("dd"), "flip-it", { selected: { loc: [b.id("mine")] } });
  assert.equal(cardOf(b.engine, b.id("dd")).faceDown, false);
  assert.equal(cardOf(b.engine, b.id("mine")).controllerId, P1);
  assert.equal(ready(b.engine), 1, "X=1: 5 paid of 6");
});

clause(DOMAIN, "2:ability:flip-it", "is refused one resource short of X+4 (X=3 needs 7, only 6 others), with nothing paid; control with exactly enough", () => {
  const short = flipBoard(3, 5);
  const before = ready(short.engine);
  refused(() => activate(short.engine, P1, short.id("dd"), "flip-it", { selected: { loc: [short.id("loc")] } }), "one short of X+4", /Ability costs cannot be paid/);
  assert.equal(cardOf(short.engine, short.id("dd")).faceDown, true, "still face-down");
  assert.equal(cardOf(short.engine, short.id("loc")).controllerId, P2, "control didn't change");
  assert.equal(ready(short.engine), before, "nothing was paid");
  const exact = flipBoard(3, 7);
  activate(exact.engine, P1, exact.id("dd"), "flip-it", { selected: { loc: [exact.id("loc")] } });
  assert.equal(cardOf(exact.engine, exact.id("loc")).controllerId, P1);
});

// Whether a face-down FLIP IT card may help pay its own cost is an open rules question (SYS-53).
// The literal reading: it is still a ready face-down resource I control while the cost is paid.
clause(DOMAIN, "2:ability:flip-it", "the face-down Domain can help pay its own cost: 3 banks + the Domain is 4 resources for X=0 (4 needed)", () => {
  const b = flipBoard(0, 3);
  assert.equal(ready(b.engine), 4, "setup: 3 banks + the face-down Domain");
  activate(b.engine, P1, b.id("dd"), "flip-it", { selected: { loc: [b.id("loc")] } });
  assert.equal(cardOf(b.engine, b.id("dd")).faceDown, false, "flipped with itself as one of the 4 payers");
});

clause(DOMAIN, "2:ability:flip-it", "4 other resources pay for X=0 whichever way the self-pay question goes", () => {
  const ok = flipBoard(0, 4);
  activate(ok.engine, P1, ok.id("dd"), "flip-it", { selected: { loc: [ok.id("loc")] } });
  assert.equal(cardOf(ok.engine, ok.id("dd")).faceDown, false, "4 other resources work");
});

clause(DOMAIN, "2:ability:flip-it", "needs [D]: 9 Rage resources can't flip it", () => {
  const b = flipBoard(0, 0, bank("rage", 9, P1));
  refused(() => activate(b.engine, P1, b.id("dd"), "flip-it", { selected: { loc: [b.id("loc")] } }), "no [D] threshold", /Ability threshold requirements are not met/);
  assert.equal(cardOf(b.engine, b.id("dd")).faceDown, true);
  assert.equal(cardOf(b.engine, b.id("loc")).controllerId, P2);
  const ok = flipBoard(0, 1, bank("rage", 8, P1));
  activate(ok.engine, P1, ok.id("dd"), "flip-it", { selected: { loc: [ok.id("loc")] } });
  assert.equal(cardOf(ok.engine, ok.id("dd")).faceDown, false, "control: one [D] among them is enough");
});

clause(DOMAIN, "2:ability:flip-it", "usable only while it is a face-down resource: refused face-up in play and in hand", () => {
  const up = flipBoard(0, 6);
  up.engine.state.cards[up.id("dd")].faceDown = false;
  refused(() => activate(up.engine, P1, up.id("dd"), "flip-it", { selected: { loc: [up.id("loc")] } }), "face-up in play", /./);
  assert.equal(cardOf(up.engine, up.id("loc")).controllerId, P2);
  const hand = domainBoard([{ key: "loc", def: location({ name: "Loc", cost: 0 }), owner: P2, zone: "play" }, ...bank("deception", 6, P1)], { domain: "hand", faceDown: false });
  refused(() => activate(hand.engine, P1, hand.id("dd"), "flip-it", { selected: { loc: [hand.id("loc")] } }), "in hand", /./);
  assert.equal(cardOf(hand.engine, hand.id("loc")).controllerId, P2);
});

clause(DOMAIN, "2:ability:flip-it", "must pick exactly one location in play: no pick, two picks, a character, an item, a location in a discard pile are refused", () => {
  const b = flipBoard(0, 8, [
    { key: "loc2", def: location({ name: "Loc2", cost: 0 }), owner: P2, zone: "play" },
    { key: "chr", def: character({ name: "Chr" }), owner: P2, zone: "play" },
    { key: "itm", def: item({ name: "Itm" }), owner: P2, zone: "play" },
    { key: "gone", def: location({ name: "Gone", cost: 0 }), owner: P2, zone: "discard" }
  ]);
  const flip = (picks: string[]) => () => activate(b.engine, P1, b.id("dd"), "flip-it", { selected: { loc: picks.map((k) => b.id(k)) } });
  refused(() => activate(b.engine, P1, b.id("dd"), "flip-it"), "no pick", /requires 1 selection/);
  refused(flip([]), "empty pick", /requires 1 selection/);
  refused(flip(["loc", "loc2"]), "two locations", /requires 1 selection/);
  refused(flip(["chr"]), "a character", /Illegal target/);
  refused(flip(["itm"]), "an item", /Illegal target/);
  refused(flip(["gone"]), "a location in a discard pile", /Illegal target/);
  assert.equal(cardOf(b.engine, b.id("dd")).faceDown, true);
  assert.equal(ready(b.engine), 9, "nothing was paid by the refusals");
  flip(["loc2"])();
  assert.equal(cardOf(b.engine, b.id("loc2")).controllerId, P1, "control: a location works and only it changes hands");
  assert.equal(cardOf(b.engine, b.id("loc")).controllerId, P2);
  assert.equal(cardOf(b.engine, b.id("chr")).controllerId, P2);
});

clause(DOMAIN, "2:ability:flip-it", "Reveal this card: the flip reveals the Domain to everyone", () => {
  const b = flipBoard(0, 6);
  activate(b.engine, P1, b.id("dd"), "flip-it", { selected: { loc: [b.id("loc")] } });
  const revealed = events(b.engine, "cardsRevealed").flatMap((e) => (e.cardIds as string[]) ?? []);
  assert.ok(revealed.includes(b.id("dd")), "the Domain was revealed as part of the cost");
});

// ============================================================================
// Don't Trip -- tactic, cost 3 [DDD]; EXTRA COST pick an attacking character; redirect battle damage; FLIP UP 3 [D]
// ============================================================================

function tripBoard(opts: { active?: PlayerId; resources?: CardPlacement[]; extra?: CardPlacement[]; faceDown?: boolean; trip?: "hand" | "play" } = {}) {
  const active = opts.active ?? P2;
  const foe = active; // the attacker's owner
  const def = opts.active === P1 ? P1 : P2;
  void foe;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: def,
    turn: def === P1 ? 1 : 2,
    cards: [
      { key: "dt", def: printing(TRIP), owner: P1, zone: opts.trip ?? "hand", faceDown: opts.faceDown ?? false },
      { key: "atk", def: character({ name: "Atk", strength: 3, life: 9, speed: 3 }), owner: def, zone: "play" },
      { key: "atk2", def: character({ name: "Atk2", strength: 2, life: 9, speed: 2 }), owner: def, zone: "play" },
      { key: "idle", def: character({ name: "Idle", strength: 1, life: 9 }), owner: def, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 2, life: 9, speed: 2 }), owner: def === P2 ? P1 : P2, zone: "play" },
      { key: "blk2", def: character({ name: "Blk2", strength: 1, life: 9, speed: 1 }), owner: def === P2 ? P1 : P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: def, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: def, zone: "play" },
      ...(opts.resources ?? bank("deception", 5, P1)),
      ...(opts.extra ?? [])
    ]
  });
}

type TripGame = ReturnType<typeof tripBoard>;
const attackInto = (b: TripGame, attackers: string[] = ["atk"], target?: Parameters<typeof declareAttackOpenWindow>[3]) =>
  declareAttackOpenWindow(b.engine, P2, attackers.map((k) => b.id(k)), target);
/** P1 attacks and keeps priority (the attacker holds it first). */
const attackAsP1 = (b: TripGame, attackers: string[] = ["atk"]) =>
  b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: attackers.map((k) => b.id(k)), target: { type: "faction", playerId: P2 } });
const castTrip = (b: TripGame, pick: string[]) => play(b.engine, P1, b.id("dt"), { selected: { c: pick.map((k) => b.id(k)) } });
const settle = (b: TripGame, blockers: string[] = [], split?: Parameters<typeof autoResolveBattle>[1]) => {
  resolvePendingResponses(b.engine);
  if (b.engine.state.battle) {
    b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: blockers.map((k) => b.id(k)) });
    autoResolveBattle(b.engine, split);
    resolvePendingResponses(b.engine);
  }
};

clause(TRIP, "0:extraCost", "the pick must be an attacking character: the attacker is accepted, and exactly 3 [D] resources are paid", () => {
  const b = tripBoard({ resources: bank("deception", 5, P1) });
  attackInto(b);
  assert.equal(ready(b.engine), 5);
  castTrip(b, ["atk"]);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("dt")), "discard", "the tactic resolved into its owner's discard pile");
  assert.equal(ready(b.engine), 2, "cost 3 paid");
});

clause(TRIP, "0:extraCost", "a character that is not attacking can't be picked (a second party member that did attack can; an idle one, a would-be blocker and non-characters can't)", () => {
  const b = tripBoard();
  attackInto(b, ["atk", "atk2"]);
  const cast = (k: string) => () => playRaw(b.engine, P1, b.id("dt"), { selected: { c: [b.id(k)] } });
  refused(cast("idle"), "a character that is not attacking", /Illegal target/);
  refused(cast("blk"), "my own character that isn't attacking", /Illegal target/);
  refused(cast("place"), "a location", /Illegal target/);
  refused(cast("thing"), "an item", /Illegal target/);
  refused(() => playRaw(b.engine, P1, b.id("dt"), { selected: { c: [factionOf(b.engine, P1)] } }), "a faction", /Illegal target/);
  refused(() => playRaw(b.engine, P1, b.id("dt"), {}), "no pick", /requires 1 selection/);
  refused(() => playRaw(b.engine, P1, b.id("dt"), { selected: { c: [] } }), "empty pick", /requires 1 selection/);
  refused(() => playRaw(b.engine, P1, b.id("dt"), { selected: { c: [b.id("atk"), b.id("atk2")] } }), "two picks", /requires 1 selection/);
  assert.equal(zoneOf(b.engine, b.id("dt")), "hand", "nothing resolved");
  assert.equal(ready(b.engine), 5, "nothing was paid");
  castTrip(b, ["atk2"]);
  assert.equal(zoneOf(b.engine, b.id("dt")), "discard", "control: the other attacker works");
});

clause(TRIP, "0:extraCost", "a blocking character is not an attacking character: refused once blocks are declared", () => {
  const b = tripBoard();
  attackInto(b);
  resolvePendingResponses(b.engine);
  declareBlockers(b.engine, P1, [b.id("blk")]);
  if (b.engine.state.priorityPlayerId !== P1) b.engine.perform({ type: "passPriority", playerId: P2 });
  const cast = (k: string) => () => playRaw(b.engine, P1, b.id("dt"), { selected: { c: [b.id(k)] } });
  refused(cast("blk"), "a blocker", /Illegal target/);
  assert.equal(zoneOf(b.engine, b.id("dt")), "hand");
  assert.equal(ready(b.engine), 5);
  castTrip(b, ["atk"]);
  assert.equal(zoneOf(b.engine, b.id("dt")), "discard", "control: the attacker is still pickable after blocks");
});

clause(TRIP, "0:extraCost", "with no battle going on there is no attacking character to pick", () => {
  const b = tripBoard({ active: P1 });
  refused(() => playRaw(b.engine, P1, b.id("dt"), { selected: { c: [b.id("atk")] } }), "no attack has been declared", /Illegal target/);
  assert.equal(zoneOf(b.engine, b.id("dt")), "hand");
  assert.equal(ready(b.engine), 5);
  attackAsP1(b);
  castTrip(b, ["atk"]);
  assert.equal(zoneOf(b.engine, b.id("dt")), "discard", "control: the same pick on the same board works once it is attacking");
});

clause(TRIP, "0:extraCost", "any attacking character may be picked, including my own attacker on my own turn", () => {
  const b = tripBoard({ active: P1 });
  attackAsP1(b);
  castTrip(b, ["atk"]);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("dt")), "discard");
  assert.equal(b.engine.state.players[P1].discard.includes(b.id("dt")), true);
});

clause(TRIP, "0:extraCost", "costs 3 with [D][D][D]: refused with only 2 [D] (plus plenty of Rage), refused with 5 Rage and no [D]; 3 [D] works", () => {
  const two = tripBoard({ resources: [...bank("deception", 2, P1), ...bank("rage", 5, P1)] });
  attackInto(two);
  refused(() => playRaw(two.engine, P1, two.id("dt"), { selected: { c: [two.id("atk")] } }), "2 [D] isn't [D][D][D]", /Threshold requirements are not met/);
  assert.equal(zoneOf(two.engine, two.id("dt")), "hand");
  assert.equal(ready(two.engine), 7);
  const short = tripBoard({ resources: bank("deception", 2, P1) });
  attackInto(short);
  refused(() => playRaw(short.engine, P1, short.id("dt"), { selected: { c: [short.id("atk")] } }), "two resources for a cost of 3", /Threshold requirements are not met/);
  const none = tripBoard({ resources: bank("rage", 5, P1) });
  attackInto(none);
  refused(() => playRaw(none.engine, P1, none.id("dt"), { selected: { c: [none.id("atk")] } }), "no [D] at all", /Threshold requirements are not met/);
  const ok = tripBoard({ resources: bank("deception", 3, P1) });
  attackInto(ok);
  castTrip(ok, ["atk"]);
  assert.equal(zoneOf(ok.engine, ok.id("dt")), "discard");
  assert.equal(ready(ok.engine), 0);
});

const START = 30; // starting influence of the synthetic faction
const influenceLoss = (b: TripGame) => START - influence(b.engine, P1);

clause(TRIP, "1:rule", "an unblocked picked attacker inflicts its battle damage to ITSELF instead of the faction: the faction loses no influence and the attacker takes its own strength (3)", () => {
  const control = tripBoard();
  attackInto(control);
  settle(control);
  assert.equal(influenceLoss(control), 3, "control: without the tactic the faction takes 3");
  const b = tripBoard();
  attackInto(b);
  castTrip(b, ["atk"]);
  settle(b);
  assert.equal(influence(b.engine, P1), START, "the faction was not damaged");
  assert.equal(cardOf(b.engine, b.id("atk")).damage, 3, "the attacker took 3 damage itself");
  assert.equal(zoneOf(b.engine, b.id("atk")), "play");
});

clause(TRIP, "1:rule", "a picked attacker that is blocked hurts itself, not the blocker (blocker only deals its own damage back)", () => {
  const control = tripBoard();
  attackInto(control);
  settle(control, ["blk"]);
  assert.equal(cardOf(control.engine, control.id("blk")).damage, 3, "control: the blocker normally takes 3");
  const b = tripBoard();
  attackInto(b);
  castTrip(b, ["atk"]);
  settle(b, ["blk"]);
  assert.equal(cardOf(b.engine, b.id("blk")).damage ?? 0, 0, "the blocker took nothing");
  assert.equal(cardOf(b.engine, b.id("atk")).damage, 5, "3 of its own damage + 2 struck back by the blocker");
  assert.equal(influence(b.engine, P1), START);
});

clause(TRIP, "1:rule", "double-blocked: neither blocker takes damage from the picked attacker", () => {
  const b = tripBoard();
  attackInto(b);
  castTrip(b, ["atk"]);
  settle(b, ["blk", "blk2"]);
  assert.equal(cardOf(b.engine, b.id("blk")).damage ?? 0, 0);
  assert.equal(cardOf(b.engine, b.id("blk2")).damage ?? 0, 0);
  assert.equal(cardOf(b.engine, b.id("atk")).damage, 6, "3 own + 2 + 1 struck back");
});

clause(TRIP, "1:rule", "only the PICKED character is affected: an unpicked attacker in the same party still damages the faction, and a blocked unpicked one still damages its blocker", () => {
  const b = tripBoard();
  attackInto(b, ["atk", "atk2"]);
  castTrip(b, ["atk"]);
  settle(b);
  assert.equal(influence(b.engine, P1), START - 2, "only Atk2's 2 damage reached the faction");
  assert.equal(cardOf(b.engine, b.id("atk")).damage, 3);
  assert.equal(cardOf(b.engine, b.id("atk2")).damage ?? 0, 0, "Atk2 wasn't redirected");
  const c = tripBoard();
  attackInto(c, ["atk", "atk2"]);
  castTrip(c, ["atk"]);
  settle(c, ["blk"]);
  assert.equal(cardOf(c.engine, c.id("blk")).damage, 2, "the blocker takes only the unpicked Atk2's 2 damage, nothing from the picked Atk");
});

clause(TRIP, "1:rule", "picking Atk2 instead: Atk2 hurts itself while the unpicked Atk still damages the faction", () => {
  const b = tripBoard();
  attackInto(b, ["atk", "atk2"]);
  castTrip(b, ["atk2"]);
  settle(b);
  assert.equal(influence(b.engine, P1), START - 3, "only Atk's 3 damage reached the faction");
  assert.equal(cardOf(b.engine, b.id("atk2")).damage, 2, "Atk2 took its own 2 damage");
  assert.equal(cardOf(b.engine, b.id("atk")).damage ?? 0, 0);
});

clause(TRIP, "1:rule", "only BATTLE damage is redirected: damage the picked attacker deals with an ability outside battle goes to its target as normal", () => {
  const pinger = character({
    name: "Pinger",
    strength: 3,
    life: 9,
    speed: 3,
    behavior: { abilities: [{ id: "ping", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 2 }] }] }
  });
  const b = tripBoard({ extra: [{ key: "pg", def: pinger, owner: P2, zone: "play" }] });
  attackInto(b, ["pg"]);
  playRaw(b.engine, P1, b.id("dt"), { selected: { c: [b.id("pg")] } });
  activate(b.engine, P2, b.id("pg"), "ping", { selected: { t: [b.id("blk")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("dt")), "discard", "the Trip resolved too");
  assert.equal(cardOf(b.engine, b.id("blk")).damage, 2, "ability damage is not battle damage: the target takes it");
  assert.equal(cardOf(b.engine, b.id("pg")).damage ?? 0, 0, "the pinger took nothing from its own ability");
});

clause(TRIP, "1:rule", "the redirect doesn't outlast the turn: the same character attacking again on its next turn deals its damage normally", () => {
  const b = tripBoard();
  attackInto(b);
  castTrip(b, ["atk"]);
  settle(b);
  assert.equal(influence(b.engine, P1), START);
  endTurn(b.engine, P2);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2, "P2's next turn");
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  resolvePendingResponses(b.engine);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
  autoResolveBattle(b.engine);
  resolvePendingResponses(b.engine);
  assert.equal(influence(b.engine, P1), START - 3, "the next attack hurt the faction normally");
});

const faceDownTrip = (resources: CardPlacement[]) => tripBoard({ trip: "play", faceDown: true, resources });

clause(TRIP, "2:flipUp", "a face-down Don't Trip in play flips up for 3 [D] during the opponent's attack: the redirect applies, the tactic resolves to the discard pile and exactly 3 resources are spent", () => {
  const b = faceDownTrip(bank("deception", 4, P1));
  assert.equal(ready(b.engine), 5, "4 banks + the face-down Trip itself");
  attackInto(b);
  rawFlipUp(b.engine, P1, b.id("dt"), { c: [b.id("atk")] });
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine), undefined);
  assert.equal(ready(b.engine), 1, "5 resources: the Trip stops being a resource (-1) and 3 were paid");
  assert.equal(zoneOf(b.engine, b.id("dt")), "discard");
  settle(b);
  assert.equal(influence(b.engine, P1), START, "the attacker's damage was redirected");
  assert.equal(cardOf(b.engine, b.id("atk")).damage, 3);
});

clause(TRIP, "2:flipUp", "the FLIP UP still needs a legal pick: refused with no attacker, and refused for a non-attacking character", () => {
  const none = tripBoard({ active: P1, trip: "play", faceDown: true, resources: bank("deception", 4, P1) });
  refused(() => rawFlipUp(none.engine, P1, none.id("dt"), { c: [none.id("atk")] }), "no attack declared", /Illegal target/);
  assert.equal(cardOf(none.engine, none.id("dt")).faceDown, true);
  assert.equal(ready(none.engine), 5, "nothing paid");
  attackAsP1(none);
  rawFlipUp(none.engine, P1, none.id("dt"), { c: [none.id("atk")] });
  resolvePendingResponses(none.engine);
  assert.equal(cardOf(none.engine, none.id("dt")).faceDown ?? false, false, "control: the same flip works once the pick is attacking");
  const b = faceDownTrip(bank("deception", 4, P1));
  attackInto(b);
  refused(() => rawFlipUp(b.engine, P1, b.id("dt"), { c: [b.id("idle")] }), "a character that isn't attacking", /Illegal target/);
  refused(() => rawFlipUp(b.engine, P1, b.id("dt"), {}), "no pick", /requires 1 selection/);
  assert.equal(cardOf(b.engine, b.id("dt")).faceDown, true);
  assert.equal(ready(b.engine), 5);
});

clause(TRIP, "2:flipUp", "FLIP UP costs exactly 3 including one [D]: refused with only 1 other resource + itself, and with no [D]; exactly enough works", () => {
  const short = faceDownTrip(bank("deception", 1, P1));
  attackInto(short);
  refused(() => rawFlipUp(short.engine, P1, short.id("dt"), { c: [short.id("atk")] }), "two resources for a cost of 3", /FLIP UP costs cannot be paid/);
  assert.equal(cardOf(short.engine, short.id("dt")).faceDown, true);
  const noD = faceDownTrip(bank("rage", 6, P1));
  attackInto(noD);
  refused(() => rawFlipUp(noD.engine, P1, noD.id("dt"), { c: [noD.id("atk")] }), "no [D]", /FLIP UP threshold requirements are not met/);
  assert.equal(cardOf(noD.engine, noD.id("dt")).faceDown, true);
  assert.equal(ready(noD.engine), 7);
  const exact = faceDownTrip([...bank("deception", 1, P1), ...bank("rage", 1, P1)]);
  attackInto(exact);
  rawFlipUp(exact.engine, P1, exact.id("dt"), { c: [exact.id("atk")] });
  resolvePendingResponses(exact.engine);
  assert.equal(zoneOf(exact.engine, exact.id("dt")), "discard", "itself + a [D] + one more resource is exactly 3");
  assert.equal(ready(exact.engine), 0);
});

// ============================================================================
// Dweedle Tee -- cost 2 [D], 1/3/1 clown -- +1/+1 per token; BULGE [VVV]
// ============================================================================

const thr = (t: string | number, name: string) => character({ name, threshold: t as never });

function dweedleBoard(
  deckThresholds: Array<string | number>,
  resources: CardPlacement[] = volition(3, P1),
  opts: { tokens?: number; random?: () => number } = {}
) {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: opts.random,
    cards: [
      { key: "dw", def: printing(DWEEDLE), owner: P1, zone: "play", counters: opts.tokens ? { token: opts.tokens } : undefined },
      ...deckThresholds.map((t, i) => ({ key: `c${i}`, def: thr(t, `C${i}`), owner: P1, zone: "deck" as const })),
      { key: "o0", def: thr("ddd", "O0"), owner: P2, zone: "deck" },
      { key: "o1", def: thr("rr", "O1"), owner: P2, zone: "deck" },
      ...resources
    ]
  });
  return g;
}

clause(DWEEDLE, "0:rule", "gains exactly +1 strength and +1 life per token on it, not speed: 0, 1, 3 tokens", () => {
  const at = (n: number) => {
    const { engine, id } = buildGame({ cards: [{ key: "dw", def: printing(DWEEDLE), owner: P1, zone: "play", counters: n ? { token: n } : undefined }] });
    return [engine.getStat(id("dw"), "strength"), engine.getStat(id("dw"), "life"), engine.getStat(id("dw"), "speed")];
  };
  assert.deepEqual(at(0), [1, 1, 3]);
  assert.deepEqual(at(1), [2, 2, 3]);
  assert.deepEqual(at(3), [4, 4, 3]);
});

clause(DWEEDLE, "0:rule", "only tokens ON this card count: tokens on another card don't", () => {
  const { engine, id } = buildGame({
    cards: [
      { key: "dw", def: printing(DWEEDLE), owner: P1, zone: "play", counters: { token: 1 } },
      { key: "other", def: character({ name: "Other" }), owner: P1, zone: "play", counters: { token: 4 } },
      { key: "foe", def: printing(DWEEDLE), owner: P2, zone: "play", counters: { token: 2 } }
    ]
  });
  assert.equal(engine.getStat(id("dw"), "strength"), 2);
  assert.equal(engine.getStat(id("dw"), "life"), 2);
  assert.equal(engine.getStat(id("foe"), "strength"), 3, "each Dweedle counts its own tokens");
});

const bulge = (g: ReturnType<typeof dweedleBoard>) => activate(g.engine, P1, g.id("dw"), "dweedle-bulge");

clause(DWEEDLE, "1:ability:dweedle-bulge", "pay-3 branch with 5 resources: exactly 3 are spent, Dweedle is depleted, and the deck is NOT shuffled", () => {
  const g = dweedleBoard(["ddd", "g", "rr", "e", "o"], volition(5, P1));
  const before = deckOf(g.engine, P1);
  assert.equal(before[0], g.id("c0"), "c0 is the top card");
  bulge(g);
  assert.equal(pending(g.engine), undefined);
  assert.equal(ready(g.engine), 2, "3 of 5 resources spent");
  assert.equal(cardOf(g.engine, g.id("dw")).depleted, true, "Dweedle is depleted");
  assert.deepEqual([...discardOf(g.engine, P1), ...deckOf(g.engine, P1)], before, "order is unchanged: no shuffle");
});

clause(DWEEDLE, "1:ability:dweedle-bulge", "effect: the top card is revealed (to all) then put into ITS OWNER's discard pile, the rest of the deck stays", () => {
  const g = dweedleBoard(["ddd", "g", "rr"], volition(3, P1));
  bulge(g);
  assert.deepEqual(discardOf(g.engine, P1), [g.id("c0")], "exactly the top card");
  assert.deepEqual(deckOf(g.engine, P1), [g.id("c1"), g.id("c2")]);
  const revealed = events(g.engine, "cardsRevealed");
  assert.deepEqual(revealed.flatMap((e) => (e.cardIds as string[]) ?? []), [g.id("c0")], "revealed exactly the top card");
  for (const e of revealed) assert.equal(e.viewerId, "all");
  assert.equal(deckOf(g.engine, P2).length, 2, "the opponent's deck is untouched");
  assert.deepEqual(discardOf(g.engine, P2), []);
});

clause(DWEEDLE, "1:ability:dweedle-bulge", "tokens put on it equal the revealed card's threshold: [DDD] -> 3 tokens (and +3/+3)", () => {
  const g = dweedleBoard(["ddd", "g"]);
  bulge(g);
  assert.equal(tokensOn(g.engine, g.id("dw")), 3);
  assert.equal(g.engine.getStat(g.id("dw"), "strength"), 4);
  assert.equal(g.engine.getStat(g.id("dw"), "life"), 4);
});

clause(DWEEDLE, "1:ability:dweedle-bulge", "tokens equal the threshold: [RR] -> 2, a single [E] -> 1, mixed [GD] -> 2", () => {
  const rr = dweedleBoard(["rr", "g"]);
  bulge(rr);
  assert.equal(tokensOn(rr.engine, rr.id("dw")), 2);
  const e = dweedleBoard(["e", "g"]);
  bulge(e);
  assert.equal(tokensOn(e.engine, e.id("dw")), 1);
  const gd = dweedleBoard(["gd", "g"]);
  bulge(gd);
  assert.equal(tokensOn(gd.engine, gd.id("dw")), 2);
});

clause(DWEEDLE, "1:ability:dweedle-bulge", "a revealed card with no threshold puts 0 tokens (but is still discarded)", () => {
  const g = dweedleBoard([0, "ddd"]);
  bulge(g);
  assert.equal(tokensOn(g.engine, g.id("dw")), 0);
  assert.deepEqual(discardOf(g.engine, P1), [g.id("c0")]);
  assert.equal(pending(g.engine), undefined);
});

clause(DWEEDLE, "1:ability:dweedle-bulge", "tokens are ADDED to those already on it", () => {
  const g = dweedleBoard(["rr", "g"], volition(3, P1), { tokens: 2 });
  assert.equal(g.engine.getStat(g.id("dw"), "strength"), 3);
  bulge(g);
  assert.equal(tokensOn(g.engine, g.id("dw")), 4);
  assert.equal(g.engine.getStat(g.id("dw"), "strength"), 5);
  assert.equal(g.engine.getStat(g.id("dw"), "life"), 5);
});

clause(DWEEDLE, "1:ability:dweedle-bulge", "uses MY deck's top card, not the opponent's ([DDD] on top of theirs, nothing on mine)", () => {
  const g = dweedleBoard([0, "ddd"]);
  const foeTop = deckOf(g.engine, P2)[0];
  bulge(g);
  assert.equal(tokensOn(g.engine, g.id("dw")), 0, "their [DDD] card isn't the one counted");
  assert.equal(deckOf(g.engine, P2)[0], foeTop);
});

clause(DWEEDLE, "1:ability:dweedle-bulge", "needs [V][V][V]: two Volition + lots of Rage is refused, three non-Volition resources are refused, with nothing spent", () => {
  const two = dweedleBoard(["ddd", "g"], [...volition(2, P1), ...bank("rage", 6, P1)]);
  const readyBefore = ready(two.engine);
  refused(() => bulge(two), "only two [V]", /Ability threshold requirements are not met/);
  assert.equal(cardOf(two.engine, two.id("dw")).depleted, false);
  assert.equal(ready(two.engine), readyBefore);
  assert.equal(deckOf(two.engine, P1).length, 2, "nothing revealed or discarded");
  const none = dweedleBoard(["ddd", "g"], bank("rage", 6, P1));
  refused(() => bulge(none), "no [V] at all", /Ability threshold requirements are not met/);
  assert.equal(tokensOn(none.engine, none.id("dw")), 0);
  const ok = dweedleBoard(["ddd", "g"], [...volition(3, P1), ...bank("rage", 6, P1)]);
  bulge(ok);
  assert.equal(tokensOn(ok.engine, ok.id("dw")), 3, "control: three [V] works");
});

clause(DWEEDLE, "1:ability:dweedle-bulge", "deplete cost: refused while already depleted, and a second use in the same turn is refused", () => {
  const dep = dweedleBoard(["ddd", "g"], volition(5, P1));
  dep.engine.state.cards[dep.id("dw")].depleted = true;
  refused(() => bulge(dep), "already depleted", /Ability costs cannot be paid/);
  assert.equal(tokensOn(dep.engine, dep.id("dw")), 0);
  assert.equal(deckOf(dep.engine, P1).length, 2);
  const twice = dweedleBoard(["ddd", "g"], volition(6, P1));
  bulge(twice);
  refused(() => bulge(twice), "second use while depleted", /Ability costs cannot be paid/);
  assert.equal(tokensOn(twice.engine, twice.id("dw")), 3);
});

clause(DWEEDLE, "1:ability:dweedle-bulge", "the player may choose to shuffle their deck instead of paying 3, even when they can pay", () => holdCostChoices(() => {
  const g = dweedleBoard(["ddd", "g", "rr", "e", "o"], volition(5, P1), { random: lcg(7) });
  const before = deckOf(g.engine, P1);
  bulge(g);
  const c = pending(g.engine);
  assert.ok(c, "a choice between 'pay 3' and 'shuffle your deck' is offered");
  void before;
}));

clause(DWEEDLE, "1:ability:dweedle-bulge", "shuffle branch (when 3 can't be paid): the deck is shuffled BEFORE the reveal, no resources are spent, Dweedle is depleted", () => {
  const g = dweedleBoard(["ddd", "g", "rr", "e", "o", "r"], volition(3, P1), { random: lcg(3) });
  for (const cid of g.engine.state.players[P1].play) if (g.engine.state.cards[cid].faceDown) g.engine.state.cards[cid].attachedTo = factionOf(g.engine, P1);
  const before = deckOf(g.engine, P1);
  assert.equal(ready(g.engine), 0, "all three [V] resources are already spent");
  bulge(g);
  assert.equal(pending(g.engine), undefined);
  assert.equal(cardOf(g.engine, g.id("dw")).depleted, true);
  assert.equal(discardOf(g.engine, P1).length, 1);
  assert.equal(deckOf(g.engine, P1).length, 5);
  assert.deepEqual([...discardOf(g.engine, P1), ...deckOf(g.engine, P1)].sort(), [...before].sort(), "same cards");
  assert.notDeepEqual([...discardOf(g.engine, P1), ...deckOf(g.engine, P1)], before, "the deck was shuffled");
});

clause(DWEEDLE, "1:ability:dweedle-bulge", "with an empty deck there is nothing to reveal: no tokens and no error", () => {
  const g = dweedleBoard([]);
  bulge(g);
  assert.equal(pending(g.engine), undefined);
  assert.equal(tokensOn(g.engine, g.id("dw")), 0);
  assert.deepEqual(discardOf(g.engine, P1), []);
});

// ============================================================================
// Ferret Oil Coating -- item, cost 2 [DD], ATTACH TO CHARACTER; "anything that can pick the attached character must pick it"; FLIP UP 1 [DD]
// ============================================================================

const ownDestroyTactic = (name: string, targetType = "character") =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: targetType as never }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
    }
  });

function ferretBoard(opts: { extra?: CardPlacement[]; ferret?: "hand" | "play"; resources?: CardPlacement[]; faceDown?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "foc", def: printing(FERRET), owner: P1, zone: opts.ferret ?? "hand", faceDown: opts.faceDown },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2" }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "res", def: resourceCard({ name: "Res" }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...(opts.resources ?? [...bank("deception", 2, P1), ...bank("rage", 4, P1)]),
      ...(opts.extra ?? [])
    ]
  });
}

const attachPlay = (b: ReturnType<typeof ferretBoard>, hostKey: string) => play(b.engine, P1, b.id("foc"), { selected: { attachTo: [b.id(hostKey)] } });

clause(FERRET, "0:attach", "attaches to a character: it enters play attached to the picked character (mine or an opponent's) and the printed cost of 2 is paid", () => {
  const b = ferretBoard();
  const before = ready(b.engine);
  attachPlay(b, "mine");
  assert.equal(zoneOf(b.engine, b.id("foc")), "play");
  assert.equal(cardOf(b.engine, b.id("foc")).attachedTo, b.id("mine"));
  assert.equal(before - ready(b.engine), 2, "cost 2 paid");
  assert.equal(cardOf(b.engine, b.id("mine2")).attachedTo, undefined);
  const foe = ferretBoard();
  attachPlay(foe, "foe");
  assert.equal(cardOf(foe.engine, foe.id("foc")).attachedTo, foe.id("foe"), "an opponent's character is a legal host");
  assert.equal(cardOf(foe.engine, foe.id("foc")).controllerId, P1, "I still control the Ferret");
});

clause(FERRET, "0:attach", "refused for a host that is not a character in play: an item, a location, a faction, a face-down card, a resource, a card in hand or discard", () => {
  const b = ferretBoard();
  const attempt = (hostId: string) => () => playRaw(b.engine, P1, b.id("foc"), { selected: { attachTo: [hostId] } });
  refused(attempt(b.id("thing")), "an item", /Illegal target/);
  refused(attempt(b.id("place")), "a location", /Illegal target/);
  refused(attempt(factionOf(b.engine, P1)), "my faction", /Illegal target/);
  refused(attempt(factionOf(b.engine, P2)), "their faction", /Illegal target/);
  refused(attempt(b.id("hidden")), "a face-down card", /Illegal target/);
  refused(attempt(b.id("res")), "a resource", /Illegal target/);
  refused(attempt(b.id("inHand")), "a character in hand", /Illegal target/);
  refused(attempt(b.id("inDiscard")), "a character in a discard pile", /Illegal target/);
  refused(() => playRaw(b.engine, P1, b.id("foc"), { selected: { attachTo: [] } }), "no host", /requires 1 selection/);
  refused(() => playRaw(b.engine, P1, b.id("foc"), {}), "no selection", /requires 1 selection/);
  refused(() => playRaw(b.engine, P1, b.id("foc"), { selected: { attachTo: [b.id("mine"), b.id("mine2")] } }), "two hosts", /requires 1 selection/);
  assert.equal(zoneOf(b.engine, b.id("foc")), "hand", "nothing was played");
  attempt(b.id("mine"))();
  assert.ok(b.engine.state.responseWindow, "control: a character is accepted");
});

clause(FERRET, "0:attach", "costs 2 with [D][D]: refused one resource short and with only one [D]; two [D] works", () => {
  const short = ferretBoard({ resources: bank("deception", 1, P1) });
  refused(() => playRaw(short.engine, P1, short.id("foc"), { selected: { attachTo: [short.id("mine")] } }), "one resource for a cost of 2", /Threshold requirements are not met/);
  const oneD = ferretBoard({ resources: [...bank("deception", 1, P1), ...bank("rage", 5, P1)] });
  refused(() => playRaw(oneD.engine, P1, oneD.id("foc"), { selected: { attachTo: [oneD.id("mine")] } }), "one [D] isn't [D][D]", /Threshold requirements are not met/);
  const ok = ferretBoard({ resources: bank("deception", 2, P1) });
  attachPlay(ok, "mine");
  assert.equal(zoneOf(ok.engine, ok.id("foc")), "play");
  assert.equal(ready(ok.engine), 0);
});

const pickKill = (b: ReturnType<typeof ferretBoard>, key: string, picks: string[]) =>
  play(b.engine, P1, b.id(key), { selected: { t: picks.map((k) => b.id(k)) } });

const withKill = (extra: CardPlacement[] = [], opts: { host?: string } = {}) => {
  const b = ferretBoard({
    ferret: "play",
    extra: [
      { key: "kill", def: ownDestroyTactic("Kill"), owner: P1, zone: "hand" },
      { key: "killItem", def: ownDestroyTactic("KillItem", "item"), owner: P1, zone: "hand" },
      ...extra
    ]
  });
  b.engine.state.cards[b.id("foc")].attachedTo = b.id(opts.host ?? "foe");
  return b;
};

clause(FERRET, "1:rule", "a single-target effect that could pick other characters must pick the attached character (an opponent's host): picking another is refused, picking the host works", () => {
  const b = withKill();
  for (const other of ["mine", "mine2", "foe2"]) refused(() => pickKill(b, "kill", [other]), `${other} is not the attached character`, /Illegal target/);
  assert.equal(zoneOf(b.engine, b.id("kill")), "hand");
  for (const k of ["mine", "mine2", "foe", "foe2"]) assert.equal(zoneOf(b.engine, b.id(k)), "play");
  pickKill(b, "kill", ["foe"]);
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard", "the attached character was picked and destroyed");
  assert.equal(zoneOf(b.engine, b.id("foe2")), "play");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
});

clause(FERRET, "1:rule", "'anything' includes my own effects, and a host I control: I must pick my own host with my own tactic", () => {
  const b = withKill([], { host: "mine" });
  refused(() => pickKill(b, "kill", ["foe"]), "an opponent's character while my host is pickable", /Illegal target/);
  refused(() => pickKill(b, "kill", ["mine2"]), "my other character", /Illegal target/);
  pickKill(b, "kill", ["mine"]);
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
});

clause(FERRET, "1:rule", "control: without the Ferret the same tactic can pick any character", () => {
  const b = withKill();
  b.engine.state.cards[b.id("foc")].attachedTo = undefined;
  b.engine.state.cards[b.id("foc")].zone = "discard";
  pickKill(b, "kill", ["foe2"]);
  assert.equal(zoneOf(b.engine, b.id("foe2")), "discard");
});

clause(FERRET, "1:rule", "an effect that can't pick characters (it picks items) is unaffected, and picking no character at all is refused for a character picker", () => {
  const b = withKill();
  pickKill(b, "killItem", ["thing"]);
  assert.equal(zoneOf(b.engine, b.id("thing")), "discard", "an item isn't the attached character and may be picked freely");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  const c = withKill();
  refused(() => play(c.engine, P1, c.id("kill")), "must pick, and the only legal pick is the host", /requires 1 selection/);
  assert.equal(zoneOf(c.engine, c.id("kill")), "hand");
  pickKill(c, "kill", ["foe"]);
  assert.equal(zoneOf(c.engine, c.id("foe")), "discard", "control: picking the host resolves");
});

clause(FERRET, "1:rule", "an effect with an 'up to one' character pick must still pick the attached character: picking another is refused", () => {
  const upTo = tactic({
    name: "UpTo",
    cost: 0,
    behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1, optional: true }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const b = withKill([{ key: "upTo", def: upTo, owner: P1, zone: "hand" }]);
  refused(() => pickKill(b, "upTo", ["foe2"]), "another character when the host can be picked", /Illegal target/);
  assert.equal(zoneOf(b.engine, b.id("foe2")), "play");
  pickKill(b, "upTo", ["foe"]);
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard");
});

clause(FERRET, "1:rule", "an activated ability's pick (not just tactics) must also pick the attached character", () => {
  const pinger = character({
    name: "Pinger",
    behavior: { abilities: [{ id: "ping", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 2 }] }] }
  });
  const b = withKill([{ key: "pg", def: pinger, owner: P1, zone: "play" }]);
  refused(() => activate(b.engine, P1, b.id("pg"), "ping", { selected: { t: [b.id("foe2")] } }), "another character", /Illegal target/);
  assert.equal(cardOf(b.engine, b.id("foe2")).damage ?? 0, 0);
  activate(b.engine, P1, b.id("pg"), "ping", { selected: { t: [b.id("foe")] } });
  assert.equal(cardOf(b.engine, b.id("foe")).damage, 2);
});

clause(FERRET, "1:rule", "an effect whose pick can't include the host (it only picks MY characters while the host is the opponent's) is unaffected", () => {
  const mineOnly = tactic({
    name: "MineOnly",
    cost: 0,
    behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character", owner: "self" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const b = withKill([{ key: "mineOnly", def: mineOnly, owner: P1, zone: "hand" }]);
  pickKill(b, "mineOnly", ["mine2"]);
  assert.equal(zoneOf(b.engine, b.id("mine2")), "discard", "it can't pick the host, so it picks freely among what it can");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
});

clause(FERRET, "1:rule", "stops applying once the Ferret leaves play: after it is destroyed any character can be picked again", () => {
  const b = withKill([{ key: "ferretKiller", def: ownDestroyTactic("FerretKiller", "item"), owner: P1, zone: "hand" }]);
  refused(() => pickKill(b, "kill", ["foe2"]), "while the Ferret is attached", /Illegal target/);
  pickKill(b, "ferretKiller", ["foc"]);
  assert.equal(zoneOf(b.engine, b.id("foc")), "discard", "the Ferret was destroyed");
  pickKill(b, "kill", ["foe2"]);
  assert.equal(zoneOf(b.engine, b.id("foe2")), "discard", "no longer forced to pick the old host");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
});

clause(FERRET, "2:flipUp", "a face-down Ferret flips up for 1 [D][D], attaching to a picked character, and then forces picks", () => {
  const b = withKill([], {});
  b.engine.state.cards[b.id("foc")].attachedTo = undefined;
  b.engine.state.cards[b.id("foc")].faceDown = true;
  assert.equal(ready(b.engine), 7, "2 [D] + 4 Rage + the face-down Ferret");
  rawFlipUp(b.engine, P1, b.id("foc"), { attachTo: [b.id("foe")] });
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine), undefined);
  assert.equal(cardOf(b.engine, b.id("foc")).faceDown, false);
  assert.equal(cardOf(b.engine, b.id("foc")).attachedTo, b.id("foe"));
  assert.equal(ready(b.engine), 5, "7 resources: the Ferret stops being a resource (-1) and exactly 1 was paid (not the printed cost of 2)");
  refused(() => pickKill(b, "kill", ["foe2"]), "the flipped Ferret forces the pick", /Illegal target/);
});

clause(FERRET, "2:flipUp", "FLIP UP needs [D][D] and 1 resource: refused with one [D], and with no resources besides itself", () => {
  const oneD = ferretBoard({ ferret: "play", faceDown: true, resources: [] });
  assert.equal(ready(oneD.engine), 1, "only the face-down Ferret itself is left");
  refused(() => rawFlipUp(oneD.engine, P1, oneD.id("foc"), { attachTo: [oneD.id("foe")] }), "no [D] and nothing to pay with", /FLIP UP threshold requirements are not met/);
  assert.equal(cardOf(oneD.engine, oneD.id("foc")).faceDown, true);
  const one = ferretBoard({ ferret: "play", faceDown: true, resources: [...bank("deception", 1, P1), ...bank("rage", 4, P1)] });
  refused(() => rawFlipUp(one.engine, P1, one.id("foc"), { attachTo: [one.id("foe")] }), "one [D] isn't [D][D]", /FLIP UP threshold requirements are not met/);
  assert.equal(cardOf(one.engine, one.id("foc")).faceDown, true);
  assert.equal(ready(one.engine), 6, "nothing paid");
  const ok = ferretBoard({ ferret: "play", faceDown: true, resources: bank("deception", 2, P1) });
  rawFlipUp(ok.engine, P1, ok.id("foc"), { attachTo: [ok.id("foe")] });
  resolvePendingResponses(ok.engine);
  assert.equal(cardOf(ok.engine, ok.id("foc")).faceDown, false, "control: two [D] works");
});

clause(FERRET, "2:flipUp", "FLIP UP still has to attach to a character: refused for a non-character host or no host", () => {
  const b = ferretBoard({ ferret: "play", faceDown: true, resources: bank("deception", 3, P1) });
  for (const k of ["thing", "place", "inHand"]) refused(() => rawFlipUp(b.engine, P1, b.id("foc"), { attachTo: [b.id(k)] }), k, /Illegal target/);
  refused(() => rawFlipUp(b.engine, P1, b.id("foc"), {}), "no host", /requires 1 selection/);
  assert.equal(cardOf(b.engine, b.id("foc")).faceDown, true);
  assert.equal(ready(b.engine), 4);
});

// ---- gap-review additions: deploy costs / thresholds, opponent effect-put, location zone ----

const deployBoard = (id: string, resources: CardPlacement[]) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "c", def: printing(id), owner: P1, zone: "hand" }, ...resources]
  });

clause(NESTER, "0:rule", "deploys for exactly 3 with [D][D][D] (printed 2/3/2): 2 [D] plus plenty of Rage is refused, 3 Rage is refused, 4 [D] leaves one resource", () => {
  const ok = deployBoard(NESTER, bank("deception", 4, P1));
  play(ok.engine, P1, ok.id("c"));
  assert.equal(zoneOf(ok.engine, ok.id("c")), "play");
  assert.equal(ready(ok.engine), 1, "exactly 3 of 4 spent");
  assert.deepEqual([ok.engine.getStat(ok.id("c"), "strength"), ok.engine.getStat(ok.id("c"), "life"), ok.engine.getStat(ok.id("c"), "speed")], [2, 2, 3]);
  const two = deployBoard(NESTER, [...bank("deception", 2, P1), ...bank("rage", 5, P1)]);
  refused(() => play(two.engine, P1, two.id("c")), "only 2 [D]", /Threshold requirements are not met/);
  assert.equal(zoneOf(two.engine, two.id("c")), "hand");
  const rage = deployBoard(NESTER, bank("rage", 3, P1));
  refused(() => play(rage.engine, P1, rage.id("c")), "no [D]", /Threshold requirements are not met/);
  const exact = deployBoard(NESTER, bank("deception", 3, P1));
  play(exact.engine, P1, exact.id("c"));
  assert.equal(zoneOf(exact.engine, exact.id("c")), "play", "control: exactly [D][D][D]");
  assert.equal(ready(exact.engine), 0);
});

clause(NESTER, "0:rule", "a [V] provider put into play by an effect under the OPPONENT's control does not trigger my Nester", () => {
  const g = nesterBoard({ active: P2, extra: [{ key: "put", def: putter("resource"), owner: P2, zone: "hand" }] });
  const oppDeck = deckOf(g.engine, P2);
  const myDeck = deckOf(g.engine, P1);
  play(g.engine, P2, g.id("put"), { selected: { t: [g.id("foeVRes")] } });
  assert.equal(zoneOf(g.engine, g.id("foeVRes")), "play");
  assert.equal(pending(g.engine), undefined, "no prompt for my Nester");
  assert.deepEqual(deckOf(g.engine, P2), oppDeck);
  assert.deepEqual(deckOf(g.engine, P1), myDeck);
});

clause(DOMAIN, "2:ability:flip-it", "the picked location must be in play: a location in a hand or a deck is refused (a location in play works)", () => {
  const b = flipBoard(0, 8, [
    { key: "handLoc", def: location({ name: "HandLoc", cost: 0 }), owner: P2, zone: "hand" },
    { key: "deckLoc", def: location({ name: "DeckLoc", cost: 0 }), owner: P2, zone: "deck" },
    { key: "myHandLoc", def: location({ name: "MyHandLoc", cost: 0 }), owner: P1, zone: "hand" }
  ]);
  for (const k of ["handLoc", "deckLoc", "myHandLoc"]) {
    refused(() => activate(b.engine, P1, b.id("dd"), "flip-it", { selected: { loc: [b.id(k)] } }), k, /Illegal target/);
  }
  assert.equal(cardOf(b.engine, b.id("dd")).faceDown, true);
  activate(b.engine, P1, b.id("dd"), "flip-it", { selected: { loc: [b.id("loc")] } });
  assert.equal(cardOf(b.engine, b.id("loc")).controllerId, P1, "control: a location in play works");
});

clause(DWEEDLE, "0:rule", "deploys for exactly 2 with [D] (printed 1/3/1): 5 Rage and no [D] is refused, one resource is refused, 3 resources leave one", () => {
  const ok = deployBoard(DWEEDLE, bank("deception", 3, P1));
  play(ok.engine, P1, ok.id("c"));
  assert.equal(zoneOf(ok.engine, ok.id("c")), "play");
  assert.equal(ready(ok.engine), 1, "exactly 2 of 3 spent");
  assert.deepEqual([ok.engine.getStat(ok.id("c"), "strength"), ok.engine.getStat(ok.id("c"), "life"), ok.engine.getStat(ok.id("c"), "speed")], [1, 1, 3]);
  const rage = deployBoard(DWEEDLE, bank("rage", 5, P1));
  refused(() => play(rage.engine, P1, rage.id("c")), "no [D]", /Threshold requirements are not met/);
  assert.equal(zoneOf(rage.engine, rage.id("c")), "hand");
  const one = deployBoard(DWEEDLE, bank("deception", 1, P1));
  refused(() => play(one.engine, P1, one.id("c")), "one resource for a cost of 2", /Costs cannot be paid/);
  assert.equal(zoneOf(one.engine, one.id("c")), "hand");
  const mixed = deployBoard(DWEEDLE, [...bank("deception", 1, P1), ...bank("rage", 1, P1)]);
  play(mixed.engine, P1, mixed.id("c"));
  assert.equal(zoneOf(mixed.engine, mixed.id("c")), "play", "control: one [D] plus one other is enough");
});
