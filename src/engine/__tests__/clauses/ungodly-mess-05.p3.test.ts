// Clause tests, batch ungodly-mess-05, part p3 (groups 11-14, missing clauses only).
// Redecorator Majig, Securitymajig Mark II, Servers Unavailable, Silent Sentinels.
import assert from "node:assert/strict";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import {
  buildGame,
  bank,
  character,
  developFaction,
  item,
  location,
  play,
  resolvePendingResponses,
  tactic,
  P1,
  P2
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import { declareAttackBy, declareAttackOpenWindow, playRaw } from "./_battle.js";
import { declareBlockers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { endTurn } from "./_turn.js";

const RM = "e842c4d8-f856-45b8-8f29-432288edbfe0"; // Redecorator Majig: character gearsmith majig cost 5 "ee" 3/2/5
const SM = "1015da3f-7f05-4838-88ad-ff1de5e8359d"; // Securitymajig Mark II: character gearsmith majig cost 4 "e" 1/3/4
const SU = "b6c2daaf-eb1c-438f-829c-8b66479468f7"; // Servers Unavailable: tactic gearsmith cost 4 "eee"
const SS = "0038a68b-ae48-4fbf-93c2-4e7c15406815"; // Silent Sentinels: character gearsmith warmachine cost 6 "e" 4/2/5

const stats = (e: SpoilsEngine, cardId: CardInstanceId) => [e.getStat(cardId, "strength"), e.getStat(cardId, "speed"), e.getStat(cardId, "life")];
const cardOf = (e: SpoilsEngine, cardId: CardInstanceId) => e.state.cards[cardId];
const flipUp = (e: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}): void =>
  flipUpNow(e, { type: "flipUp", playerId: player, cardId, selected, variables: {} });
const spent = (icon: "elitism" | "rage", n: number, owner: PlayerId = P1): CardPlacement[] =>
  bank(icon, n, owner).map((p) => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

// ============================================================================
// Redecorator Majig -- cost 5 "ee", 3/2/5
// ============================================================================

const loc = (key: string, owner: PlayerId = P2, over: Partial<CardPlacement> = {}): CardPlacement => ({
  key,
  def: location({ name: key, structure: 4 }),
  owner,
  zone: "play",
  ...over
});

function rmBoard(resources: CardPlacement[], extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "rm", def: printing(RM), owner: P1, zone: "hand" }, ...resources, ...extra]
  });
}
const fullRes = () => [...bank("elitism", 2, P1), ...bank("greed", 5, P1)]; // 7 resources, two [E]
type RmBoard = ReturnType<typeof rmBoard>;
function deployRm(b: RmBoard, pick?: string[]) {
  play(b.engine, P1, b.id("rm"), { selected: pick ? { loc: pick.map((k) => b.id(k)) } : {} });
  drain(b.engine, declineAll);
  assert.equal(pending(b.engine), undefined, "no choice left open");
  assert.equal(zoneOf(b.engine, b.id("rm")), "play", "Redecorator Majig was deployed");
}
const destroyTactic = (type: "character" | "location") =>
  tactic({
    name: `Destroy ${type}`,
    cost: 0,
    behavior: { abilities: [{ id: "d", type: "activated", targets: [{ id: "t", selector: { zone: "play", type }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
const restoreTactic = () =>
  tactic({
    name: "Restore location",
    cost: 0,
    behavior: { abilities: [{ id: "r", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "restore", target: { type: "selected", id: "t" } }] }] }
  });
const tacticPlacement = (key: string, def: ReturnType<typeof tactic>): CardPlacement => ({ key, def, owner: P1, zone: "hand" });

clause(RM, "0:extraCost", "deploys for exactly its printed cost 5 with [E][E] (7 resources: 2 stay ready); it is a Gearsmith majig character printed 3/2/5, and with no location picked nothing is depleted", () => {
  const b = rmBoard(fullRes(), [loc("loc")]);
  assert.equal(b.engine.getCardPlayability(P1, b.id("rm")).numericCost, 5);
  assert.equal(readyResources(b.engine, P1), 7);
  deployRm(b);
  assert.equal(readyResources(b.engine, P1), 2, "exactly 5 of the 7 resources were spent");
  assert.deepEqual(b.engine.getCardTypes(b.id("rm")), ["character"]);
  const def = b.engine.getDefinition(b.id("rm"));
  assert.equal(def.trade, "gearsmith");
  assert.deepEqual(def.subtype, ["majig"]);
  assert.deepEqual(stats(b.engine, b.id("rm")), [3, 2, 5]);
  assert.equal(cardOf(b.engine, b.id("loc")).depleted ?? false, false, "the 'may' pick was declined: the location is untouched");
});

clause(RM, "0:extraCost", "is refused one resource short of cost 5 (4 resources, both [E] present) and pays nothing", () => {
  const short = rmBoard([...bank("elitism", 2, P1), ...bank("greed", 2, P1)]);
  refused(() => play(short.engine, P1, short.id("rm")), "cost 5 with 4 resources");
  assert.equal(zoneOf(short.engine, short.id("rm")), "hand");
  assert.equal(readyResources(short.engine, P1), 4, "nothing was paid");
  const ok = rmBoard([...bank("elitism", 2, P1), ...bank("greed", 3, P1)]);
  play(ok.engine, P1, ok.id("rm"));
  assert.equal(zoneOf(ok.engine, ok.id("rm")), "play", "control: 5 resources with [E][E]");
});

clause(RM, "0:extraCost", "needs the [E][E] threshold: enough resources with only one [E] is refused, two [E] works (spent [E] banks count toward the threshold but can't pay)", () => {
  const oneE = rmBoard([...bank("elitism", 1, P1), ...bank("greed", 5, P1)]);
  assert.equal(readyResources(oneE.engine, P1), 6);
  refused(() => play(oneE.engine, P1, oneE.id("rm")), "only one [E]");
  assert.equal(zoneOf(oneE.engine, oneE.id("rm")), "hand");
  assert.equal(readyResources(oneE.engine, P1), 6, "nothing was paid");
  const noE = rmBoard(bank("greed", 6, P1));
  refused(() => play(noE.engine, P1, noE.id("rm")), "no [E]");
  const twoE = rmBoard([...bank("elitism", 2, P1), ...bank("greed", 3, P1)]);
  play(twoE.engine, P1, twoE.id("rm"));
  assert.equal(zoneOf(twoE.engine, twoE.id("rm")), "play", "control: two [E]");
  // One ready [E] plus one SPENT [E] meets the threshold; the spent one cannot pay the cost.
  const mixed = rmBoard([...bank("elitism", 1, P1), ...bank("greed", 4, P1), ...spent("elitism", 1)]);
  assert.equal(readyResources(mixed.engine, P1), 5);
  play(mixed.engine, P1, mixed.id("rm"));
  assert.equal(zoneOf(mixed.engine, mixed.id("rm")), "play", "ready [E] + spent [E] meets [E][E]");
  const spentOnly = rmBoard([...bank("greed", 5, P1), ...spent("elitism", 2)]);
  play(spentOnly.engine, P1, spentOnly.id("rm"));
  assert.equal(zoneOf(spentOnly.engine, spentOnly.id("rm")), "play", "two spent [E] meet the threshold and five ready greed pay the cost");
});

clause(RM, "0:extraCost", "may pick the opponent's location: it is depleted on deployment", () => {
  const b = rmBoard(fullRes(), [loc("loc")]);
  deployRm(b, ["loc"]);
  assert.equal(cardOf(b.engine, b.id("loc")).depleted, true);
  assert.equal(readyResources(b.engine, P1), 2, "the extra cost is not a resource payment: 5 spent");
});

clause(RM, "0:extraCost", "may pick its controller's own location too", () => {
  const b = rmBoard(fullRes(), [loc("mine", P1)]);
  deployRm(b, ["mine"]);
  assert.equal(cardOf(b.engine, b.id("mine")).depleted, true);
});

clause(RM, "0:extraCost", "picks exactly one location: with two in play only the chosen one is depleted, and two cannot be picked", () => {
  const b = rmBoard(fullRes(), [loc("a"), loc("b", P1)]);
  refused(() => play(b.engine, P1, b.id("rm"), { selected: { loc: [b.id("a"), b.id("b")] } }), "two locations picked for 'a location'");
  assert.equal(zoneOf(b.engine, b.id("rm")), "hand");
  assert.equal(readyResources(b.engine, P1), 7, "nothing was paid");
  const ok = rmBoard(fullRes(), [loc("a"), loc("b", P1)]);
  deployRm(ok, ["a"]);
  assert.equal(cardOf(ok.engine, ok.id("a")).depleted, true);
  assert.equal(cardOf(ok.engine, ok.id("b")).depleted ?? false, false, "the other location is not depleted");
});

clause(RM, "0:extraCost", "only a location in play can be picked: a character, an item, a location in hand or in the discard pile is refused", () => {
  const extras: CardPlacement[] = [
    loc("loc"),
    { key: "chr", def: character({ name: "Chr" }), owner: P2, zone: "play" },
    { key: "itm", def: item({ name: "Itm" }), owner: P2, zone: "play" },
    loc("inHand", P2, { zone: "hand" }),
    loc("inDiscard", P2, { zone: "discard" })
  ];
  for (const wrong of ["chr", "itm", "inHand", "inDiscard"]) {
    const b = rmBoard(fullRes(), extras);
    refused(() => play(b.engine, P1, b.id("rm"), { selected: { loc: [b.id(wrong)] } }), `${wrong} is not a location in play`);
    assert.equal(zoneOf(b.engine, b.id("rm")), "hand", `${wrong}: not deployed`);
    assert.equal(cardOf(b.engine, b.id(wrong)).depleted ?? false, false, `${wrong}: not depleted`);
  }
  const ok = rmBoard(fullRes(), extras);
  deployRm(ok, ["loc"]);
  assert.equal(cardOf(ok.engine, ok.id("loc")).depleted, true, "control: the location in play");
});

clause(RM, "1:rule", "while it is in play, the picked location is not restored by its controller's RESTORE RULE at their turn start; an unrelated depleted location is", () => {
  const b = rmBoard(fullRes(), [loc("loc"), loc("other", P2, { depleted: true })]);
  deployRm(b, ["loc"]);
  assert.equal(cardOf(b.engine, b.id("loc")).depleted, true);
  endTurn(b.engine, P1); // P2's turn starts: their Restore Rule runs
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(cardOf(b.engine, b.id("other")).depleted ?? false, false, "control: the unrelated depleted location is restored by the RESTORE RULE");
  assert.equal(cardOf(b.engine, b.id("loc")).depleted, true, "the picked location stays depleted");
  endTurn(b.engine, P2);
  endTurn(b.engine, P1);
  assert.equal(cardOf(b.engine, b.id("loc")).depleted, true, "...turn after turn");
});

clause(RM, "1:rule", "applies to its own controller's location too: it stays depleted through its controller's turn start", () => {
  const b = rmBoard(fullRes(), [loc("mine", P1), loc("otherMine", P1, { depleted: true })]);
  deployRm(b, ["mine"]);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2); // P1's turn starts
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(cardOf(b.engine, b.id("otherMine")).depleted ?? false, false, "control: an unrelated depleted location is restored");
  assert.equal(cardOf(b.engine, b.id("mine")).depleted, true, "the picked location is not restored");
});

clause(RM, "1:rule", "it is the location's CONTROLLER whose RESTORE RULE is blocked: a location owned by the opponent but controlled by me stays depleted at my turn start, and is restored there without the card", () => {
  const b = rmBoard(fullRes(), [loc("stolen", P2, { controller: P1 })]);
  deployRm(b, ["stolen"]);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2); // P1 (its controller) starts a turn
  assert.equal(cardOf(b.engine, b.id("stolen")).depleted, true, "not restored by its controller's RESTORE RULE");
  // control: the same location without Redecorator Majig is restored at its controller's turn start
  const c = rmBoard([], [loc("stolen", P2, { controller: P1, depleted: true })]);
  endTurn(c.engine, P1);
  endTurn(c.engine, P2);
  assert.equal(cardOf(c.engine, c.id("stolen")).depleted ?? false, false, "control: restored at its controller's turn start");
});

clause(RM, "1:rule", "only the RESTORE RULE is blocked: an effect that restores the location still works", () => {
  const b = rmBoard(fullRes(), [loc("loc"), tacticPlacement("rs", restoreTactic())]);
  deployRm(b, ["loc"]);
  assert.equal(cardOf(b.engine, b.id("loc")).depleted, true);
  play(b.engine, P1, b.id("rs"), { selected: { t: [b.id("loc")] } });
  drain(b.engine, declineAll);
  assert.equal(cardOf(b.engine, b.id("loc")).depleted ?? false, false, "restored by an effect");
});

clause(RM, "1:rule", "stops when it leaves play: the location is then restored at its controller's next turn start", () => {
  const b = rmBoard(fullRes(), [loc("loc"), tacticPlacement("kill", destroyTactic("character"))]);
  deployRm(b, ["loc"]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("rm")] } });
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("rm")), "discard");
  assert.equal(cardOf(b.engine, b.id("loc")).depleted, true, "still depleted right after");
  endTurn(b.engine, P1);
  assert.equal(cardOf(b.engine, b.id("loc")).depleted ?? false, false, "restored by the RESTORE RULE again");
});

clause(RM, "1:rule", "does not apply when no location was picked: a depleted location restores normally while it is in play", () => {
  const b = rmBoard(fullRes(), [loc("other", P2, { depleted: true })]);
  deployRm(b);
  endTurn(b.engine, P1);
  assert.equal(cardOf(b.engine, b.id("other")).depleted ?? false, false);
});

clause(RM, "2:rule", "while the picked location is depleted it gains 3 strength and 1 life (6/2/6; speed unchanged)", () => {
  const b = rmBoard(fullRes(), [loc("loc")]);
  deployRm(b, ["loc"]);
  assert.deepEqual(stats(b.engine, b.id("rm")), [6, 2, 6]);
});

clause(RM, "2:rule", "no bonus when the location is not depleted (no pick), and none from other depleted locations", () => {
  const none = rmBoard(fullRes(), [loc("other", P2, { depleted: true })]);
  deployRm(none);
  assert.deepEqual(stats(none.engine, none.id("rm")), [3, 2, 5], "no pick: a depleted location that was not picked gives nothing");
  const picked = rmBoard(fullRes(), [loc("loc"), loc("other", P2, { depleted: true })]);
  deployRm(picked, ["loc"]);
  assert.deepEqual(stats(picked.engine, picked.id("rm")), [6, 2, 6], "bonus once, not per depleted location");
});

clause(RM, "2:rule", "the bonus ends when the location is restored by an effect", () => {
  const b = rmBoard(fullRes(), [loc("loc"), tacticPlacement("rs", restoreTactic())]);
  deployRm(b, ["loc"]);
  assert.deepEqual(stats(b.engine, b.id("rm")), [6, 2, 6]);
  play(b.engine, P1, b.id("rs"), { selected: { t: [b.id("loc")] } });
  drain(b.engine, declineAll);
  assert.equal(cardOf(b.engine, b.id("loc")).depleted ?? false, false);
  assert.deepEqual(stats(b.engine, b.id("rm")), [3, 2, 5]);
});

clause(RM, "2:rule", "the bonus ends when the location leaves play", () => {
  const b = rmBoard(fullRes(), [loc("loc"), tacticPlacement("kill", destroyTactic("location"))]);
  deployRm(b, ["loc"]);
  assert.deepEqual(stats(b.engine, b.id("rm")), [6, 2, 6]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("loc")] } });
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("loc")), "discard");
  assert.deepEqual(stats(b.engine, b.id("rm")), [3, 2, 5]);
});

clause(RM, "2:rule", "the bonus applies only while Redecorator Majig is in play: it reads printed stats after it leaves", () => {
  const b = rmBoard(fullRes(), [loc("loc"), tacticPlacement("kill", destroyTactic("character"))]);
  deployRm(b, ["loc"]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("rm")] } });
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("rm")), "discard");
  assert.deepEqual(stats(b.engine, b.id("rm")), [3, 2, 5]);
});

// FLIP UP: 4 [E][E][E]
function rmFlip(resources: CardPlacement[], extra: CardPlacement[] = [], active: PlayerId = P1) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [{ key: "rm", def: printing(RM), owner: P1, zone: "play", faceDown: true }, ...resources, ...extra]
  });
}

clause(RM, "3:flipUp", "flips up for exactly 4 (itself plus three [E] banks) with [E][E][E]: picks and depletes a location, ends up an upright 6/2/6 character", () => {
  const b = rmFlip(bank("elitism", 3, P1), [loc("loc")]);
  assert.equal(readyResources(b.engine, P1), 4, "3 banks and the face-down Redecorator Majig");
  flipUp(b.engine, P1, b.id("rm"), { loc: [b.id("loc")] });
  drain(b.engine, declineAll);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("rm")), "play");
  assert.equal(cardOf(b.engine, b.id("rm")).faceDown, false);
  assert.deepEqual(b.engine.getCardTypes(b.id("rm")), ["character"]);
  assert.equal(readyResources(b.engine, P1), 0, "all 4 resources were paid");
  assert.equal(cardOf(b.engine, b.id("loc")).depleted, true);
  assert.deepEqual(stats(b.engine, b.id("rm")), [6, 2, 6]);
});

clause(RM, "3:flipUp", "pays exactly 4: with three [E] and three other banks plus itself, 3 resources are left; the pick may be declined", () => {
  const b = rmFlip([...bank("elitism", 3, P1), ...bank("greed", 3, P1)], [loc("loc")]);
  assert.equal(readyResources(b.engine, P1), 7);
  flipUp(b.engine, P1, b.id("rm"));
  drain(b.engine, declineAll);
  assert.equal(cardOf(b.engine, b.id("rm")).faceDown, false);
  assert.equal(readyResources(b.engine, P1), 2, "7 - 4 paid - 1 (it stopped being a resource)");
  assert.equal(cardOf(b.engine, b.id("loc")).depleted ?? false, false);
  assert.deepEqual(stats(b.engine, b.id("rm")), [3, 2, 5]);
});

clause(RM, "3:flipUp", "is refused one resource short of 4 (3 resources including itself), and pays nothing", () => {
  const short = rmFlip(bank("elitism", 2, P1));
  assert.equal(readyResources(short.engine, P1), 3);
  refused(() => flipUp(short.engine, P1, short.id("rm")), "cost 4 with 3 resources");
  assert.equal(cardOf(short.engine, short.id("rm")).faceDown, true, "still face-down");
  assert.equal(readyResources(short.engine, P1), 3, "nothing paid");
  const ok = rmFlip(bank("elitism", 3, P1));
  flipUp(ok.engine, P1, ok.id("rm"));
  assert.equal(cardOf(ok.engine, ok.id("rm")).faceDown, false, "control: 3 banks plus itself");
});

clause(RM, "3:flipUp", "needs [E][E][E] from other resources: its own face-down icon does not count (two [E] banks and two other banks plus itself = 5 resources is refused)", () => {
  const b = rmFlip([...bank("elitism", 2, P1), ...bank("rage", 2, P1)]);
  assert.equal(readyResources(b.engine, P1), 5);
  refused(() => flipUp(b.engine, P1, b.id("rm")), "only two [E]");
  assert.equal(cardOf(b.engine, b.id("rm")).faceDown, true);
  assert.equal(readyResources(b.engine, P1), 5, "nothing paid");
  const ok = rmFlip([...bank("elitism", 3, P1), ...bank("rage", 1, P1)]);
  flipUp(ok.engine, P1, ok.id("rm"));
  assert.equal(cardOf(ok.engine, ok.id("rm")).faceDown, false, "control: three [E]");
});

clause(RM, "3:flipUp", "spent [E] banks count toward the [E][E][E] threshold but cannot pay: 2 ready [E] + 1 spent [E] and itself (3 ready) is short on cost, 3 ready banks + 3 spent works", () => {
  const short = rmFlip([...bank("elitism", 2, P1), ...spent("elitism", 3)]);
  assert.equal(readyResources(short.engine, P1), 3);
  refused(() => flipUp(short.engine, P1, short.id("rm")), "only 3 resources can pay");
  const ok = rmFlip([...bank("elitism", 3, P1), ...spent("elitism", 3)]);
  flipUp(ok.engine, P1, ok.id("rm"));
  assert.equal(cardOf(ok.engine, ok.id("rm")).faceDown, false);
});

clause(RM, "3:flipUp", "a character: refused on the opponent's turn; only a face-down one can be flipped up", () => {
  const theirs = rmFlip(bank("elitism", 3, P1), [], P2);
  refused(() => flipUp(theirs.engine, P1, theirs.id("rm")), "not your turn");
  assert.equal(cardOf(theirs.engine, theirs.id("rm")).faceDown, true);
  const faceUp = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "rm", def: printing(RM), owner: P1, zone: "play" }, ...bank("elitism", 4, P1)]
  });
  refused(() => flipUp(faceUp.engine, P1, faceUp.id("rm")), "already face-up");
  const own = rmFlip(bank("elitism", 3, P1));
  flipUp(own.engine, P1, own.id("rm"));
  assert.equal(cardOf(own.engine, own.id("rm")).faceDown, false, "control: own turn, face-down");
});

// ============================================================================
// Securitymajig Mark II -- cost 4 "e", 1/3/4
// ============================================================================

function smHand(resources: CardPlacement[], extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "sm", def: printing(SM), owner: P1, zone: "hand" }, ...resources, ...extra]
  });
}
function smFlip(resources: CardPlacement[], extra: CardPlacement[] = [], active: PlayerId = P1) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [{ key: "sm", def: printing(SM), owner: P1, zone: "play", faceDown: true }, ...resources, ...extra]
  });
}
const smFlipRes = () => [...bank("elitism", 1, P1), ...bank("rage", 3, P1)]; // 4 banks + itself = 5

clause(SM, "0:rule", "deployed from hand for exactly cost 4 with [E]: it is a Gearsmith majig character printed 1/3/4 and enters play with NO tokens", () => {
  const b = smHand([...bank("elitism", 1, P1), ...bank("greed", 5, P1)]);
  assert.equal(b.engine.getCardPlayability(P1, b.id("sm")).numericCost, 4);
  play(b.engine, P1, b.id("sm"));
  drain(b.engine, declineAll);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("sm")), "play");
  assert.equal(readyResources(b.engine, P1), 2, "exactly 4 of 6 resources were spent");
  assert.deepEqual(b.engine.getCardTypes(b.id("sm")), ["character"]);
  const def = b.engine.getDefinition(b.id("sm"));
  assert.equal(def.trade, "gearsmith");
  assert.deepEqual(def.subtype, ["majig"]);
  assert.equal(tokensOn(b.engine, b.id("sm")), 0, "not deployed using FLIP UP: no tokens");
  assert.deepEqual(stats(b.engine, b.id("sm")), [1, 3, 4]);
});

clause(SM, "0:rule", "is refused one resource short of cost 4 (3 resources with [E]) and without [E] (4 Rage), paying nothing", () => {
  const short = smHand([...bank("elitism", 1, P1), ...bank("greed", 2, P1)]);
  refused(() => play(short.engine, P1, short.id("sm")), "3 resources for cost 4");
  assert.equal(zoneOf(short.engine, short.id("sm")), "hand");
  assert.equal(readyResources(short.engine, P1), 3, "nothing paid");
  const noE = smHand(bank("rage", 5, P1));
  refused(() => play(noE.engine, P1, noE.id("sm")), "no [E]");
  assert.equal(readyResources(noE.engine, P1), 5, "nothing paid");
  const ok = smHand([...bank("elitism", 1, P1), ...bank("greed", 3, P1)]);
  play(ok.engine, P1, ok.id("sm"));
  assert.equal(zoneOf(ok.engine, ok.id("sm")), "play", "control: 4 resources with [E]");
});

clause(SM, "0:rule", "deployed using FLIP UP it enters play with 3 tokens (and so 4 strength)", () => {
  const b = smFlip(smFlipRes());
  flipUp(b.engine, P1, b.id("sm"));
  drain(b.engine, declineAll);
  assert.equal(pending(b.engine), undefined);
  assert.equal(cardOf(b.engine, b.id("sm")).faceDown, false);
  assert.equal(zoneOf(b.engine, b.id("sm")), "play");
  assert.equal(tokensOn(b.engine, b.id("sm")), 3);
  assert.equal(b.engine.getStat(b.id("sm"), "strength"), 4, "1 printed + 1 per token");
});

clause(SM, "0:rule", "the tokens come only from the FLIP UP deploy of this card itself: it gets none when another FLIP UP card is deployed while it is in play, nor when another card enters", () => {
  const flipper = character({ name: "Other Flipper", cost: 1, flipUp: { cost: 1, threshold: "" } } as never);
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "sm", def: printing(SM), owner: P1, zone: "play" },
      { key: "fl", def: flipper, owner: P1, zone: "play", faceDown: true },
      { key: "plain", def: character({ name: "Plain", cost: 1 }), owner: P1, zone: "hand" },
      ...bank("greed", 3, P1)
    ]
  });
  flipUp(b.engine, P1, b.id("fl"));
  drain(b.engine, declineAll);
  assert.equal(cardOf(b.engine, b.id("fl")).faceDown, false, "the other card was deployed using FLIP UP");
  assert.equal(tokensOn(b.engine, b.id("sm")), 0, "Securitymajig Mark II gets nothing");
  play(b.engine, P1, b.id("plain"));
  drain(b.engine, declineAll);
  assert.equal(tokensOn(b.engine, b.id("sm")), 0);
});

clause(SM, "3:flipUp", "FLIP UP cost: pays exactly 5 (4 banks plus itself, 0 left), refused with only 4 resources, and refused without [E] from another resource", () => {
  const b = smFlip(smFlipRes());
  assert.equal(readyResources(b.engine, P1), 5);
  flipUp(b.engine, P1, b.id("sm"));
  drain(b.engine, declineAll);
  assert.equal(readyResources(b.engine, P1), 0, "all 5 paid");
  const more = smFlip([...smFlipRes(), ...bank("greed", 2, P1)]);
  flipUp(more.engine, P1, more.id("sm"));
  drain(more.engine, declineAll);
  // 7 resources incl. itself, cost 5: itself may or may not be one of the five payers (CR 507.4b), so 1 or 2 remain; never 0 or 3
  assert.ok([1, 2].includes(readyResources(more.engine, P1)), "exactly 5 were paid");
  const short = smFlip([...bank("elitism", 1, P1), ...bank("rage", 2, P1)]);
  assert.equal(readyResources(short.engine, P1), 4);
  refused(() => flipUp(short.engine, P1, short.id("sm")), "cost 5 with 4 resources");
  assert.equal(cardOf(short.engine, short.id("sm")).faceDown, true);
  assert.equal(readyResources(short.engine, P1), 4, "nothing paid");
  const noE = smFlip(bank("rage", 4, P1));
  assert.equal(readyResources(noE.engine, P1), 5);
  refused(() => flipUp(noE.engine, P1, noE.id("sm")), "no [E] among the other resources (its own icon does not count)");
  assert.equal(cardOf(noE.engine, noE.id("sm")).faceDown, true);
  assert.equal(readyResources(noE.engine, P1), 5, "nothing paid");
});

clause(SM, "3:flipUp", "flipped up it is an upright 1/3/4 character with 3 tokens (so 4 strength); the threshold [E] may be met by a spent bank; refused on the opponent's turn and when already face-up", () => {
  const b = smFlip([...bank("rage", 4, P1)], [...spent("elitism", 1)]);
  flipUp(b.engine, P1, b.id("sm"));
  drain(b.engine, declineAll);
  assert.equal(cardOf(b.engine, b.id("sm")).faceDown, false, "a spent [E] meets the threshold");
  assert.deepEqual(b.engine.getCardTypes(b.id("sm")), ["character"]);
  assert.equal(b.engine.getStat(b.id("sm"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("sm"), "life"), 4);
  const theirs = smFlip(smFlipRes(), [], P2);
  refused(() => flipUp(theirs.engine, P1, theirs.id("sm")), "not your turn");
  assert.equal(cardOf(theirs.engine, theirs.id("sm")).faceDown, true);
  const faceUp = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "sm", def: printing(SM), owner: P1, zone: "play" }, ...smFlipRes(), ...bank("greed", 2, P1)]
  });
  refused(() => flipUp(faceUp.engine, P1, faceUp.id("sm")), "already face-up");
});

clause(SM, "1:rule", "gains 1 strength for each token on it: 0, 1, 3 and 5 tokens give 1, 2, 4 and 6 strength; speed and life are unchanged", () => {
  for (const n of [0, 1, 3, 5]) {
    const b = buildGame({ cards: [{ key: "sm", def: printing(SM), owner: P1, zone: "play", counters: n ? { token: n } : {} }] });
    assert.deepEqual(stats(b.engine, b.id("sm")), [1 + n, 3, 4], `${n} tokens`);
  }
});

clause(SM, "1:rule", "follows the tokens as they change, counts only its own tokens, and only while in play", () => {
  const b = buildGame({
    cards: [
      { key: "sm", def: printing(SM), owner: P1, zone: "play", counters: { token: 2 } },
      { key: "sm2", def: printing(SM), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2 }), owner: P2, zone: "play", counters: { token: 4 } }
    ]
  });
  assert.equal(b.engine.getStat(b.id("sm"), "strength"), 3);
  assert.equal(b.engine.getStat(b.id("sm2"), "strength"), 1, "another copy with no tokens does not gain from this one's tokens");
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 2, "other cards' tokens give no bonus to it");
  cardOf(b.engine, b.id("sm")).counters = { token: 5 };
  assert.equal(b.engine.getStat(b.id("sm"), "strength"), 6, "more tokens, more strength");
  cardOf(b.engine, b.id("sm")).counters = { token: 0 };
  assert.equal(b.engine.getStat(b.id("sm"), "strength"), 1, "tokens gone, bonus gone");
  const inHand = buildGame({ cards: [{ key: "sm", def: printing(SM), owner: P1, zone: "hand", counters: { token: 3 } }] });
  assert.equal(inHand.engine.getStat(inHand.id("sm"), "strength"), 1, "out of play: printed strength");
});

clause(SM, "2:rule", "can block COVERT parties (keyword canBlockCovert); a plain character can't", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    activePlayerId: P1,
    cards: [
      { key: "sm", def: printing(SM), owner: P2, zone: "play" },
      { key: "plain", def: character({ name: "Plain" }), owner: P2, zone: "play" },
      { key: "cov", def: character({ name: "Cov", behavior: { keywords: ["covert"] } }), owner: P1, zone: "play" }
    ]
  });
  assert.ok(b.engine.getKeywords(b.id("sm")).includes("canBlockCovert"), "b.engine.getKeywords(b.id(\"sm\")).includes(\"canBlockCovert\")");
  assert.equal(b.engine.getKeywords(b.id("plain")).includes("canBlockCovert"), false);
  declareAttackBy(b.engine, P1, [b.id("cov")]);
  refused(() => declareBlockers(b.engine, P2, [b.id("plain")]), "a non-covert character cannot block a covert party");
  declareBlockers(b.engine, P2, [b.id("sm")]);
  assert.deepEqual(b.engine.state.battle?.blockingParty, [b.id("sm")], "Securitymajig Mark II blocks the covert party");
});

clause(SM, "2:rule", "it blocks a party of several COVERT characters, and still blocks an ordinary party", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    activePlayerId: P1,
    cards: [
      { key: "sm", def: printing(SM), owner: P2, zone: "play" },
      { key: "cov1", def: character({ name: "Cov1", behavior: { keywords: ["covert"] } }), owner: P1, zone: "play" },
      { key: "cov2", def: character({ name: "Cov2", behavior: { keywords: ["covert"] } }), owner: P1, zone: "play" }
    ]
  });
  declareAttackBy(b.engine, P1, [b.id("cov1"), b.id("cov2")]);
  declareBlockers(b.engine, P2, [b.id("sm")]);
  assert.deepEqual(b.engine.state.battle?.blockingParty, [b.id("sm")]);
  const plain = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    activePlayerId: P1,
    cards: [
      { key: "sm", def: printing(SM), owner: P2, zone: "play" },
      { key: "atk", def: character({ name: "Atk" }), owner: P1, zone: "play" }
    ]
  });
  declareAttackBy(plain.engine, P1, [plain.id("atk")]);
  declareBlockers(plain.engine, P2, [plain.id("sm")]);
  assert.deepEqual(plain.engine.state.battle?.blockingParty, [plain.id("sm")], "an ordinary attacker can be blocked as usual");
});

clause(SM, "2:rule", "the permission is the card's own: a COVERT party can't be blocked by a plain character beside it", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    activePlayerId: P1,
    cards: [
      { key: "sm", def: printing(SM), owner: P2, zone: "play" },
      { key: "plain", def: character({ name: "Plain" }), owner: P2, zone: "play" },
      { key: "cov", def: character({ name: "Cov", behavior: { keywords: ["covert"] } }), owner: P1, zone: "play" }
    ]
  });
  declareAttackBy(b.engine, P1, [b.id("cov")]);
  refused(() => declareBlockers(b.engine, P2, [b.id("sm"), b.id("plain")]), "a plain character cannot join the blocking party");
  declareBlockers(b.engine, P2, [b.id("sm")]);
  assert.deepEqual(b.engine.state.battle?.blockingParty, [b.id("sm")]);
});

// ============================================================================
// Servers Unavailable -- tactic cost 4 "eee"
// ============================================================================

// P2 (active, turn 2) deploys something; P1 holds Servers Unavailable.
function suBoard(opts: { su?: "hand" | "faceDown"; p1Res?: CardPlacement[]; deploy?: "character" | "item" | "location" | "tactic" } = {}) {
  const deploy = opts.deploy ?? "character";
  const defs = {
    character: character({ name: "Guy", cost: 2 }),
    item: item({ name: "Gadget", cost: 2 }),
    location: location({ name: "Lair", cost: 2, structure: 3 }),
    tactic: tactic({ name: "Zap", cost: 2, })
  };
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [
      { key: "su", def: printing(SU), owner: P1, zone: opts.su === "faceDown" ? "play" : "hand", faceDown: opts.su === "faceDown" ? true : undefined },
      { key: "guy", def: defs[deploy], owner: P2, zone: "hand" },
      { key: "bystander", def: character({ name: "Bystander" }), owner: P2, zone: "play" },
      { key: "spare", def: character({ name: "Spare" }), owner: P2, zone: "hand" },
      ...bank("greed", 3, P2),
      ...(opts.p1Res ?? [...bank("elitism", 3, P1), ...bank("rage", 3, P1)])
    ]
  } as never);
}
const suRespond = (b: ReturnType<typeof suBoard>) => {
  playRaw(b.engine, P2, b.id("guy"));
  b.engine.perform({ type: "playCard", playerId: P1, cardId: b.id("su"), selected: {} } as never);
  resolvePendingResponses(b.engine);
};

clause(SU, "1:rule", "terminates the card being deployed: it goes to the discard pile, its cost stays paid, other cards are untouched, and Servers Unavailable is discarded", () => {
  const b = suBoard();
  suRespond(b);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("guy")), "discard", "the deployed character was terminated");
  assert.equal(zoneOf(b.engine, b.id("bystander")), "play");
  assert.equal(zoneOf(b.engine, b.id("spare")), "hand");
  assert.equal(readyResources(b.engine, P2), 1, "the opponent's 2 resources stay spent");
  assert.equal(zoneOf(b.engine, b.id("su")), "discard");
  assert.deepEqual(b.engine.getCardTypes(b.id("su")), ["tactic"]);
});

for (const kind of ["item", "location", "tactic"] as const) {
  clause(SU, "1:rule", `terminates whatever card is being deployed, not only characters: a ${kind}`, () => {
    const b = suBoard({ deploy: kind });
    suRespond(b);
    assert.equal(zoneOf(b.engine, b.id("guy")), "discard", `the ${kind} was terminated`);
    assert.notEqual(zoneOf(b.engine, b.id("guy")), "play");
    assert.equal(zoneOf(b.engine, b.id("su")), "discard");
    assert.equal(zoneOf(b.engine, b.id("bystander")), "play");
  });
}

clause(SU, "0:extraCost", "may be deployed in response to a card being deployed: without that response it is refused", () => {
  const b = suBoard();
  refused(() => b.engine.perform({ type: "playCard", playerId: P1, cardId: b.id("su"), selected: {} } as never), "nothing is being deployed", /deploy|respon|only|cannot|condition/i);
  assert.equal(zoneOf(b.engine, b.id("su")), "hand");
  assert.equal(readyResources(b.engine, P1), 6, "nothing was paid");
  const ok = suBoard();
  suRespond(ok);
  assert.equal(zoneOf(ok.engine, ok.id("su")), "discard", "control: in response to a deployment it works");
});

clause(SU, "0:extraCost", "CR 607.1: you can never respond to your OWN deploy: refused against a card I am deploying myself (control: the opponent's deploy is answered)", () => {
  const mk = () =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      activePlayerId: P1,
      turn: 1,
      cards: [
        { key: "su", def: printing(SU), owner: P1, zone: "hand" },
        { key: "mine", def: character({ name: "Mine", cost: 2 }), owner: P1, zone: "hand" },
        { key: "theirs", def: character({ name: "Theirs", cost: 2 }), owner: P2, zone: "hand" },
        ...bank("greed", 2, P2),
        ...bank("rage", 2, P1),
        ...bank("elitism", 3, P1),
        ...bank("rage", 3, P1)
      ]
    });
  const own = mk();
  playRaw(own.engine, P1, own.id("mine"));
  refused(() => own.engine.perform({ type: "playCard", playerId: P1, cardId: own.id("su"), selected: {} } as never), "responding to my own deploy is not allowed", /not your priority/i);
  assert.equal(zoneOf(own.engine, own.id("su")), "hand");
  assert.equal(readyResources(own.engine, P1), 6, "(8 minus the 2 for my own deploy) nothing more was paid for the refused Servers Unavailable");
  const foe = mk();
  foe.engine.state.activePlayerId = P2;
  playRaw(foe.engine, P2, foe.id("theirs"));
  foe.engine.perform({ type: "playCard", playerId: P1, cardId: foe.id("su"), selected: {} } as never);
  resolvePendingResponses(foe.engine);
  assert.equal(zoneOf(foe.engine, foe.id("su")), "discard", "control: the opponent's deploy can be answered");
  assert.equal(zoneOf(foe.engine, foe.id("theirs")), "discard");
});

clause(SU, "0:extraCost", "a response to something other than a deployment does not qualify: an attack declaration", () => {
  const mk = () =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      activePlayerId: P2,
      turn: 2,
      cards: [
        { key: "su", def: printing(SU), owner: P1, zone: "hand" },
        { key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" },
        ...bank("elitism", 3, P1),
        ...bank("rage", 3, P1)
      ]
    });
  const b = mk();
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  refused(() => b.engine.perform({ type: "playCard", playerId: P1, cardId: b.id("su"), selected: {} } as never), "an attack is not a card being deployed", /deploy|only|cannot|condition|valid|target/i);
  assert.equal(zoneOf(b.engine, b.id("su")), "hand");
  assert.equal(readyResources(b.engine, P1), 6, "nothing paid");
});

clause(SU, "0:extraCost", "deploys for exactly its printed cost 4 (6 resources: 2 left) and needs [E][E][E]: refused one resource short and with two [E]", () => {
  const ok = suBoard({ p1Res: [...bank("elitism", 3, P1), ...bank("rage", 3, P1)] });
  assert.equal(ok.engine.getAvailableResourceCount(P1), 6);
  playRaw(ok.engine, P2, ok.id("guy"));
  assert.equal(ok.engine.getCardPlayability(P1, ok.id("su")).numericCost, 4);
  ok.engine.perform({ type: "playCard", playerId: P1, cardId: ok.id("su"), selected: {} } as never);
  resolvePendingResponses(ok.engine);
  assert.equal(readyResources(ok.engine, P1), 2, "exactly 4 paid");
  const short = suBoard({ p1Res: bank("elitism", 3, P1) });
  playRaw(short.engine, P2, short.id("guy"));
  refused(() => short.engine.perform({ type: "playCard", playerId: P1, cardId: short.id("su"), selected: {} } as never), "3 resources for cost 4");
  assert.equal(zoneOf(short.engine, short.id("su")), "hand");
  assert.equal(readyResources(short.engine, P1), 3, "nothing paid");
  const twoE = suBoard({ p1Res: [...bank("elitism", 2, P1), ...bank("rage", 4, P1)] });
  playRaw(twoE.engine, P2, twoE.id("guy"));
  refused(() => twoE.engine.perform({ type: "playCard", playerId: P1, cardId: twoE.id("su"), selected: {} } as never), "only [E][E]");
  assert.equal(zoneOf(twoE.engine, twoE.id("su")), "hand");
  assert.equal(readyResources(twoE.engine, P1), 6, "nothing paid");
});

// FLIP UP: 5 [E][E][E] and put a micromajig token into play under your control.
const suFlipRes = () => [...bank("elitism", 3, P1), ...bank("rage", 1, P1)]; // 4 banks + itself = 5
const suFlip = (b: ReturnType<typeof suBoard>) => {
  playRaw(b.engine, P2, b.id("guy"));
  flipUp(b.engine, P1, b.id("su"));
  resolvePendingResponses(b.engine);
};
const tokensIn = (b: ReturnType<typeof suBoard>) => b.engine.state.players[P1].play.filter((c) => cardOf(b.engine, c).isToken || b.engine.getDefinition(c).name === "Micromajig");

clause(SU, "2:flipUp", "flipped up in response to a deployment for exactly 5 (4 banks plus itself): the deployed card is terminated and a Micromajig token character is put into play under the flipper's control", () => {
  const b = suBoard({ su: "faceDown", p1Res: suFlipRes() });
  assert.equal(readyResources(b.engine, P1), 5);
  suFlip(b);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("guy")), "discard", "the deployed card was terminated (the tactic's own effect)");
  assert.equal(readyResources(b.engine, P1), 0, "all 5 paid");
  const toks = tokensIn(b);
  assert.equal(toks.length, 1, "exactly one micromajig token");
  const t = toks[0];
  assert.equal(b.engine.getDefinition(t).name, "Micromajig");
  assert.ok((b.engine.getDefinition(t).subtype ?? []).includes("majig"), "(b.engine.getDefinition(t).subtype ?? []).includes(\"majig\")");
  assert.equal(cardOf(b.engine, t).zone, "play");
  assert.equal(cardOf(b.engine, t).controllerId, P1, "under the flipper's control");
  assert.equal(b.engine.state.players[P2].play.some((c) => b.engine.getDefinition(c).name === "Micromajig"), false, "not the opponent's");
  assert.notEqual(zoneOf(b.engine, b.id("su")), "play", "the tactic is not left in play");
});

clause(SU, "2:flipUp", "the micromajig token put into play is a character (a Micromajig token is a character with the majig subtype)", () => {
  const b = suBoard({ su: "faceDown", p1Res: suFlipRes() });
  suFlip(b);
  const toks = tokensIn(b);
  assert.equal(toks.length, 1);
  assert.deepEqual(b.engine.getCardTypes(toks[0]), ["character"]);
});

clause(SU, "2:flipUp", "with spare resources only 5 are paid (7 resources, 2 left); the token is created once", () => {
  const b = suBoard({ su: "faceDown", p1Res: [...suFlipRes(), ...bank("greed", 2, P1)] });
  assert.equal(readyResources(b.engine, P1), 7);
  suFlip(b);
  assert.ok([1, 2].includes(readyResources(b.engine, P1)), "exactly 5 were paid (itself may be one of the five payers)");
  assert.equal(tokensIn(b).length, 1);
});

clause(SU, "2:flipUp", "is refused one resource short of 5 (4 resources with itself), and with only two [E] (its own icon does not count); nothing is paid and no token appears", () => {
  const short = suBoard({ su: "faceDown", p1Res: bank("elitism", 3, P1) });
  assert.equal(readyResources(short.engine, P1), 4);
  playRaw(short.engine, P2, short.id("guy"));
  refused(() => flipUp(short.engine, P1, short.id("su")), "cost 5 with 4 resources");
  assert.equal(cardOf(short.engine, short.id("su")).faceDown, true);
  assert.equal(readyResources(short.engine, P1), 4, "nothing paid");
  assert.equal(tokensIn(short).length, 0);
  const twoE = suBoard({ su: "faceDown", p1Res: [...bank("elitism", 2, P1), ...bank("rage", 2, P1)] });
  assert.equal(readyResources(twoE.engine, P1), 5);
  playRaw(twoE.engine, P2, twoE.id("guy"));
  refused(() => flipUp(twoE.engine, P1, twoE.id("su")), "only two [E] from other resources");
  assert.equal(cardOf(twoE.engine, twoE.id("su")).faceDown, true);
  assert.equal(readyResources(twoE.engine, P1), 5, "nothing paid");
  assert.equal(tokensIn(twoE).length, 0);
});

clause(SU, "2:flipUp", "its extra cost still applies when flipped up: refused when nothing is being deployed (no terminate, no token)", () => {
  const b = suBoard({ su: "faceDown", p1Res: suFlipRes() });
  refused(() => flipUp(b.engine, P1, b.id("su")), "not in response to a card being deployed");
  assert.equal(cardOf(b.engine, b.id("su")).faceDown, true);
  assert.equal(readyResources(b.engine, P1), 5, "nothing paid");
  assert.equal(tokensIn(b).length, 0);
});

// ============================================================================
// Silent Sentinels -- cost 6 "e", 4/2/5
// ============================================================================

function ssHand(resources: CardPlacement[]) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "ss", def: printing(SS), owner: P1, zone: "hand" }, ...resources]
  });
}

clause(SS, "0:rule", "deploys for exactly its printed cost 6 with [E] (8 resources: 2 left) as a Gearsmith warmachine character printed 4/2/5; refused one short and without [E]", () => {
  const b = ssHand([...bank("elitism", 1, P1), ...bank("greed", 7, P1)]);
  assert.equal(b.engine.getCardPlayability(P1, b.id("ss")).numericCost, 6);
  play(b.engine, P1, b.id("ss"));
  assert.equal(zoneOf(b.engine, b.id("ss")), "play");
  assert.equal(readyResources(b.engine, P1), 2, "exactly 6 of 8 spent");
  assert.deepEqual(b.engine.getCardTypes(b.id("ss")), ["character"]);
  const def = b.engine.getDefinition(b.id("ss"));
  assert.equal(def.trade, "gearsmith");
  assert.deepEqual(def.subtype, ["warmachine"]);
  assert.deepEqual(stats(b.engine, b.id("ss")), [4, 2, 5]);
  const short = ssHand([...bank("elitism", 1, P1), ...bank("greed", 4, P1)]);
  refused(() => play(short.engine, P1, short.id("ss")), "5 resources for cost 6");
  assert.equal(readyResources(short.engine, P1), 5, "nothing paid");
  const noE = ssHand(bank("greed", 7, P1));
  refused(() => play(noE.engine, P1, noE.id("ss")), "no [E]");
  assert.equal(zoneOf(noE.engine, noE.id("ss")), "hand");
  assert.equal(readyResources(noE.engine, P1), 7, "nothing paid");
  const ok = ssHand([...bank("elitism", 1, P1), ...bank("greed", 5, P1)]);
  play(ok.engine, P1, ok.id("ss"));
  assert.equal(zoneOf(ok.engine, ok.id("ss")), "play", "control: exactly 6 with [E]");
});

function mustBoard(opts: { ss?: boolean; active?: PlayerId; elig?: boolean } = {}) {
  const active = opts.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [
      ...(opts.ss === false ? [] : [{ key: "ss", def: printing(SS), owner: P1, zone: "play" as const, attackEligible: false }]),
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play", attackEligible: opts.elig },
      { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "play", attackEligible: opts.elig },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      { key: "lair", def: location({ name: "Lair", structure: 3 }), owner: P1, zone: "play" }
    ]
  } as never);
}
const tryEnd = (b: ReturnType<typeof mustBoard>, p: PlayerId) => () => b.engine.perform({ type: "endTurn", playerId: p });

clause(SS, "0:rule", "all characters (its controller's, the opponent's, itself) must attack if they can; items and locations don't", () => {
  const b = mustBoard();
  for (const k of ["mine", "theirs", "ss"]) assert.ok(b.engine.getRestrictions(b.id(k)).includes("mustAttack"), `${k} must attack`);
  for (const k of ["gear", "lair"]) assert.equal(b.engine.getRestrictions(b.id(k)).includes("mustAttack"), false, `${k} is not a character`);
  const off = mustBoard({ ss: false });
  for (const k of ["mine", "theirs"]) assert.equal(off.engine.getRestrictions(off.id(k)).includes("mustAttack"), false, `control: ${k} without the card`);
});

clause(SS, "0:rule", "a character that can attack must: the active player can't end the turn without attacking with it (literal reading); with an attack declared or without the card the turn ends", () => {
  const b = mustBoard();
  refused(tryEnd(b, P1), "'mine' can attack, so it must", /attack/i);
  assert.equal(b.engine.state.activePlayerId, P1, "still P1's turn");
  const free = mustBoard({ ss: false });
  endTurn(free.engine, P1);
  assert.equal(free.engine.state.activePlayerId, P2, "control: without the card the turn ends");
});

clause(SS, "0:rule", "applies on the opponent's turn to the opponent's characters: they can't end their turn without attacking", () => {
  const b = mustBoard({ active: P2 });
  refused(tryEnd(b, P2), "'theirs' can attack, so it must", /attack/i);
  assert.equal(b.engine.state.activePlayerId, P2);
  const free = mustBoard({ active: P2, ss: false });
  endTurn(free.engine, P2);
  assert.equal(free.engine.state.activePlayerId, P1, "control: without the card the opponent can end the turn");
});

clause(SS, "0:rule", "'if they can': characters that can't attack (not attack-eligible) don't block the end of the turn", () => {
  const b = mustBoard({ elig: false });
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2, "no character can attack, so the turn ends");
});

clause(SS, "0:rule", "a declared attack must include every character that can attack (own and, on their turn, the opponent's); one that can't (summoning sick, depleted) may stay out", () => {
  const mk = (active: PlayerId) =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      activePlayerId: active,
      turn: active === P1 ? 1 : 2,
      cards: [
        { key: "ss", def: printing(SS), owner: P1, zone: "play", attackEligible: false },
        { key: "a", def: character({ name: "A" }), owner: P1, zone: "play" },
        { key: "b", def: character({ name: "B" }), owner: P1, zone: "play" },
        { key: "sick", def: character({ name: "Sick" }), owner: P1, zone: "play", attackEligible: false },
        { key: "tired", def: character({ name: "Tired" }), owner: P1, zone: "play", depleted: true },
        { key: "x", def: character({ name: "X" }), owner: P2, zone: "play" },
        { key: "y", def: character({ name: "Y" }), owner: P2, zone: "play" }
      ]
    } as never);
  const mine = mk(P1);
  refused(() => declareAttackBy(mine.engine, P1, [mine.id("a")]), "'B' can attack and was left out", /must attack/i);
  assert.equal(mine.engine.state.battle, undefined);
  declareAttackBy(mine.engine, P1, [mine.id("a"), mine.id("b")]);
  assert.ok(mine.engine.state.battle, "control: every character that can attack is in; the summoning-sick and depleted ones stay out");
  const theirs = mk(P2);
  refused(() => declareAttackBy(theirs.engine, P2, [theirs.id("x")], { type: "faction", playerId: P1 }), "Y can attack and was left out", /must attack/i);
  declareAttackBy(theirs.engine, P2, [theirs.id("x"), theirs.id("y")]);
  assert.ok(theirs.engine.state.battle, "theirs.engine.state.battle");
  const free = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "a", def: character({ name: "A" }), owner: P1, zone: "play" },
      { key: "b", def: character({ name: "B" }), owner: P1, zone: "play" }
    ]
  });
  declareAttackBy(free.engine, P1, [free.id("a")]);
  assert.ok(free.engine.state.battle, "control: without the card one character may attack alone");
});

clause(SS, "0:rule", "the static rule is on only while Silent Sentinels is in play: from hand it does nothing, and it ends when it leaves play", () => {
  const inHand = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ss", def: printing(SS), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" }
    ]
  });
  assert.equal(inHand.engine.getRestrictions(inHand.id("mine")).includes("mustAttack"), false);
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ss", def: printing(SS), owner: P1, zone: "play", attackEligible: false },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "kill", def: destroyTactic("character"), owner: P1, zone: "hand" }
    ]
  });
  assert.ok(b.engine.getRestrictions(b.id("mine")).includes("mustAttack"), "b.engine.getRestrictions(b.id(\"mine\")).includes(\"mustAttack\")");
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("ss")] } });
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("ss")), "discard");
  assert.equal(b.engine.getRestrictions(b.id("mine")).includes("mustAttack"), false, "off after the card left");
});

function aggroBoard(res: CardPlacement[]) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ss", def: printing(SS), owner: P1, zone: "play", attackEligible: false },
      { key: "other", def: character({ name: "Other" }), owner: P1, zone: "play", attackEligible: false },
      ...res
    ]
  } as never);
}

clause(SS, "1:rule@eee", "with [E][E][E] it has AGGRO and can attack the turn it entered; its allies don't gain it", () => {
  const b = aggroBoard(bank("elitism", 3, P1));
  assert.ok(b.engine.getKeywords(b.id("ss")).includes("aggro"), "b.engine.getKeywords(b.id(\"ss\")).includes(\"aggro\")");
  assert.equal(b.engine.getKeywords(b.id("other")).includes("aggro"), false, "'This card' only");
  refused(() => declareAttackBy(b.engine, P1, [b.id("other")]), "an ally that just entered can't attack", /attack|eligib|summon|enter|turn/i);
  declareAttackBy(b.engine, P1, [b.id("ss")]);
  assert.ok(b.engine.state.battle, "Silent Sentinels attacked on the turn it entered");
});

clause(SS, "1:rule@eee", "without [E][E][E] (only two [E], or three non-[E]) it has no AGGRO and can't attack the turn it entered", () => {
  for (const res of [bank("elitism", 2, P1), [...bank("elitism", 2, P1), ...bank("rage", 3, P1)], bank("rage", 3, P1)]) {
    const b = aggroBoard(res);
    assert.equal(b.engine.getKeywords(b.id("ss")).includes("aggro"), false);
    refused(() => declareAttackBy(b.engine, P1, [b.id("ss")]), "no AGGRO without [E][E][E]", /attack|eligib|summon|enter|turn/i);
    assert.equal(b.engine.state.battle, undefined);
  }
});

clause(SS, "1:rule@eee", "the three [E] may be any mix of ready and spent resources, but must be its controller's", () => {
  const mixed = aggroBoard([...bank("elitism", 1, P1), ...spent("elitism", 2)]);
  assert.ok(mixed.engine.getKeywords(mixed.id("ss")).includes("aggro"), "ready + spent [E]");
  const theirs = aggroBoard(bank("elitism", 3, P2));
  assert.equal(theirs.engine.getKeywords(theirs.id("ss")).includes("aggro"), false, "the opponent's [E] don't count");
  const inHand = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ss", def: printing(SS), owner: P1, zone: "hand" }, ...bank("elitism", 3, P1)]
  });
  assert.equal(inHand.engine.getKeywords(inHand.id("ss")).includes("aggro"), false, "out of play");
});
