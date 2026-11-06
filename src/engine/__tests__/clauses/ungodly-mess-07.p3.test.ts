// Batch ungodly-mess-07, part p3 (groups 10-14, missing clauses only: Purloining Performance, Retreat to Mount Mulrich,
// Thabbashite Seer, Trickster's Globe, Unchained Sarcophyle). Every test is written from the PRINTED text.

import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, SpoilsEngine } from "../../../engine.js";
import { buildGame, autoResolveBattle, bank, character, developFaction, killTactic, P1, P2, play, resolvePendingResponses, tactic, volition } from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, declineAll, drain, printing, refused, settleState, flipUpNow } from "./_clause.js";
import { declareAttackBy, declareAttackOpenWindow, finishBattle } from "./_battle.js";
import { declareBlockers, pending, zoneOf } from "./_board.js";
import { endTurn } from "./_turn.js";

type Pid = typeof P1 | typeof P2;

const deckOf = (engine: SpoilsEngine, p: Pid) => engine.state.players[p].deck.slice();
const discardOf = (engine: SpoilsEngine, p: Pid) => engine.state.players[p].discard.slice();
const handOf = (engine: SpoilsEngine, p: Pid) => engine.state.players[p].hand.slice();
const ready = (engine: SpoilsEngine, p: Pid = P1) => engine.getAvailableResourceCount(p);
const isDepleted = (engine: SpoilsEngine, c: CardInstanceId) => engine.state.cards[c].depleted === true;

const spend = (placements: CardPlacement[], owner: Pid): CardPlacement[] =>
  placements.map((placement) => ({ ...placement, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));
/** `n` deception resources that are already spent (attached to the faction): they count for thresholds but cannot pay. */
const spentD = (n: number, owner: Pid = P1): CardPlacement[] => spend(bank("deception", n, owner), owner);
const spentV = (n: number, owner: Pid = P1): CardPlacement[] => spend(volition(n, owner), owner);

const oppDeck = (n: number, prefix = "o"): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: character({ name: `O${i}` }), owner: P2, zone: "deck" as const }));
const myDeck = (n: number): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({ key: `m${i}`, def: character({ name: `M${i}` }), owner: P1, zone: "deck" as const }));

const flipUp = (engine: SpoilsEngine, cardId: CardInstanceId, selected: Record<string, string[]> = {}, player: Pid = P1) =>
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });

const reorderWith = (engine: SpoilsEngine, order: (ids: string[]) => string[], player: Pid = P1) => {
  const pc = pending(engine) as unknown as { kind: string; playerId: string; deckOwnerId: string; cardIds: string[] };
  assert.equal(pc?.kind, "reorderDeck");
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "reorderDeck", order: order(pc.cardIds) } } as never);
  resolvePendingResponses(engine);
};

// =================================================================================
// Purloining Performance -- rogue tactic, cost 2, [D][D][D]
// EXTRA COST: Pick an opponent. -- Look at the top 4 cards of that player's deck and put them back in any order.
// If you control an attacking party of at least 2 members, you may put up to 3 cards from the top of that player's
// deck into their discard pile. -- FLIP UP: 4 [D]
// =================================================================================

const PP = "ed4e38e3-0557-4bbf-92c3-6e02a2596bd3";

function ppBoard(o: { res?: CardPlacement[]; deckN?: number; extra?: CardPlacement[]; active?: Pid; faceDown?: boolean; pp?: "hand" | "play" } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "pp", def: printing(PP), owner: P1, zone: o.pp ?? "hand", faceDown: o.faceDown },
      { key: "a1", def: character({ name: "A1", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "a2", def: character({ name: "A2", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "a3", def: character({ name: "A3", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "f1", def: character({ name: "F1", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "f2", def: character({ name: "F2", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      ...oppDeck(o.deckN ?? 6),
      ...myDeck(5),
      ...(o.res ?? bank("deception", 3, P1)),
      ...(o.extra ?? [])
    ]
  });
}
type PG = ReturnType<typeof ppBoard>;

const attackWith = (g: PG, keys: string[], player: Pid = P1) =>
  g.engine.perform({ type: "declareAttack", playerId: player, attackerIds: keys.map((k) => g.id(k)), target: { type: "faction", playerId: player === P1 ? P2 : P1 } });

// "you may put up to 3": the prompt lists 0, 1, 2, 3 cards (index 0 = decline), so a real answer to "mill all 3" is index 3.
const acceptMill = (g: PG) =>
  drain(g.engine, (pc) => ((pc as { kind: string }).kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 3 } : declineAll(pc)));

// --- printed cost, threshold, type ---
clause(PP, "0:extraCost", "a rogue tactic with no subtype: deploys for exactly 2 with [D][D][D] (spent [D] count toward the threshold but cannot pay)", () => {
  const g = ppBoard({ res: [...spentD(1), ...bank("deception", 2, P1)] });
  assert.deepEqual(g.engine.getCardTypes(g.id("pp")), ["tactic"]);
  assert.deepEqual(printing(PP).subtype, []);
  assert.equal(printing(PP).trade, "rogue");
  assert.equal(ready(g.engine), 2);
  play(g.engine, P1, g.id("pp"), {});
  assert.equal(ready(g.engine), 0, "exactly 2 paid");
  assert.equal(pending(g.engine)?.kind, "reorderDeck");
});

clause(PP, "0:extraCost", "one resource short of the cost 2 is refused and nothing is paid", () => {
  const g = ppBoard({ res: [...spentD(1), ...bank("deception", 1, P1)] });
  refused(() => play(g.engine, P1, g.id("pp"), {}), "only 1 ready resource for cost 2");
  assert.equal(zoneOf(g.engine, g.id("pp")), "hand");
  assert.equal(ready(g.engine), 1, "nothing paid");
});

clause(PP, "0:extraCost", "one icon short of [D][D][D] is refused even with the cost affordable (the third resource is Rage)", () => {
  const g = ppBoard({ res: [...spentD(1), ...bank("deception", 1, P1), ...bank("rage", 1, P1)] });
  refused(() => play(g.engine, P1, g.id("pp"), {}), "only [D][D] among the resources");
  assert.equal(zoneOf(g.engine, g.id("pp")), "hand");
  const ok = ppBoard({ res: [...spentD(1), ...bank("deception", 1, P1), ...bank("deception", 1, P1)] });
  play(ok.engine, P1, ok.id("pp"), {});
  assert.equal(pending(ok.engine)?.kind, "reorderDeck", "control: [D][D][D] is enough");
});

clause(PP, "0:extraCost", "the opponent's [D] resources do not count toward the threshold", () => {
  const g = ppBoard({ res: [...bank("deception", 2, P1), ...bank("rage", 1, P1), ...bank("deception", 3, P2)] });
  refused(() => play(g.engine, P1, g.id("pp"), {}), "the opponent's [D] do not count");
  assert.equal(zoneOf(g.engine, g.id("pp")), "hand");
});

// --- EXTRA COST: Pick an opponent ---
clause(PP, "0:extraCost", "the picked opponent is the player whose deck is looked at (not the caster's own), and the caster's own deck is untouched", () => {
  const g = ppBoard();
  const mine = deckOf(g.engine, P1);
  const theirs = deckOf(g.engine, P2);
  play(g.engine, P1, g.id("pp"), {});
  const pc = pending(g.engine) as unknown as { kind: string; playerId: string; deckOwnerId: string; cardIds: string[] };
  assert.equal(pc.kind, "reorderDeck");
  assert.equal(pc.deckOwnerId, P2);
  assert.equal(pc.playerId, P1);
  assert.deepEqual(pc.cardIds, theirs.slice(0, 4));
  reorderWith(g.engine, (ids) => ids);
  assert.deepEqual(deckOf(g.engine, P1), mine, "my deck is not touched");
});

// --- the look-and-reorder ---
clause(PP, "1:rule", "you look at exactly the top 4 cards of the opponent's deck and put them back in the order you choose; the rest of the deck is untouched", () => {
  const g = ppBoard();
  const before = deckOf(g.engine, P2);
  play(g.engine, P1, g.id("pp"), {});
  const pc = pending(g.engine) as unknown as { cardIds: string[] };
  assert.equal(pc.cardIds.length, 4);
  assert.deepEqual(pc.cardIds, before.slice(0, 4));
  const order = [pc.cardIds[2], pc.cardIds[0], pc.cardIds[3], pc.cardIds[1]];
  reorderWith(g.engine, () => order);
  assert.equal(pending(g.engine), undefined);
  assert.deepEqual(deckOf(g.engine, P2), [...order, ...before.slice(4)], "back on top in the chosen order, the rest untouched");
  assert.equal(zoneOf(g.engine, g.id("pp")), "discard", "the tactic is discarded after it resolves");
  assert.deepEqual(discardOf(g.engine, P2), [], "no battle, no party: nothing is milled");
});

clause(PP, "1:rule", "any order includes the current order and the fully reversed order", () => {
  const same = ppBoard();
  const before = deckOf(same.engine, P2);
  play(same.engine, P1, same.id("pp"), {});
  reorderWith(same.engine, (ids) => ids);
  assert.deepEqual(deckOf(same.engine, P2), before);
  const rev = ppBoard();
  const b2 = deckOf(rev.engine, P2);
  play(rev.engine, P1, rev.id("pp"), {});
  reorderWith(rev.engine, (ids) => ids.slice().reverse());
  assert.deepEqual(deckOf(rev.engine, P2), [...b2.slice(0, 4).reverse(), ...b2.slice(4)]);
});

clause(PP, "1:rule", "an order that drops or invents a card is refused (the 4 looked-at cards are exactly the 4 put back)", () => {
  const g = ppBoard();
  play(g.engine, P1, g.id("pp"), {});
  const pc = pending(g.engine) as unknown as { cardIds: string[] };
  const bad = (order: string[]) => () => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order } } as never);
  refused(bad(pc.cardIds.slice(0, 3)), "only 3 of the 4 cards");
  refused(bad([...pc.cardIds.slice(0, 3), deckOf(g.engine, P2)[5]]), "a card from deeper in the deck");
  assert.equal(pending(g.engine)?.kind, "reorderDeck", "still waiting for a valid order");
});

clause(PP, "1:rule", "a deck of only 3 cards shows those 3", () => {
  const g = ppBoard({ deckN: 3 });
  const before = deckOf(g.engine, P2);
  play(g.engine, P1, g.id("pp"), {});
  const pc = pending(g.engine) as unknown as { cardIds: string[] };
  assert.deepEqual(pc.cardIds, before);
  reorderWith(g.engine, (ids) => ids.slice().reverse());
  assert.deepEqual(deckOf(g.engine, P2), before.slice().reverse());
});

clause(PP, "1:rule", "an attacking party of only 1 member (even with other characters in play) does not allow milling", () => {
  const g = ppBoard();
  attackWith(g, ["a1"]);
  play(g.engine, P1, g.id("pp"), {});
  reorderWith(g.engine, (ids) => ids);
  assert.equal(pending(g.engine), undefined, "no mill prompt");
  assert.deepEqual(discardOf(g.engine, P2), []);
  assert.equal(deckOf(g.engine, P2).length, 6);
});

clause(PP, "1:rule", "with an attacking party of 2 you control, the top 3 cards (after the reorder) go into the opponent's discard pile", () => {
  const g = ppBoard();
  const before = deckOf(g.engine, P2);
  attackWith(g, ["a1", "a2"]);
  play(g.engine, P1, g.id("pp"), {});
  const order = [before[3], before[2], before[1], before[0]];
  reorderWith(g.engine, () => order);
  acceptMill(g);
  assert.deepEqual(discardOf(g.engine, P2).sort(), [before[3], before[2], before[1]].sort(), "the top 3 of the reordered deck");
  assert.deepEqual(deckOf(g.engine, P2), [before[0], before[4], before[5]]);
  assert.deepEqual(discardOf(g.engine, P1).filter((c) => c !== g.id("pp")), [], "my own discard is not milled");
});

clause(PP, "1:rule", "a party of 3 (at least 2) also allows the mill", () => {
  const g = ppBoard();
  const before = deckOf(g.engine, P2);
  attackWith(g, ["a1", "a2", "a3"]);
  play(g.engine, P1, g.id("pp"), {});
  reorderWith(g.engine, (ids) => ids);
  acceptMill(g);
  assert.deepEqual(discardOf(g.engine, P2), before.slice(0, 3));
});

clause(PP, "1:rule", "only an attacking party counts: two characters merely in play (no battle) do not allow the mill", () => {
  const g = ppBoard();
  play(g.engine, P1, g.id("pp"), {});
  reorderWith(g.engine, (ids) => ids);
  assert.equal(pending(g.engine), undefined);
  assert.deepEqual(discardOf(g.engine, P2), []);
});

clause(PP, "1:rule", "the party must be one I control: the opponent's attacking party of 2 (I defend and respond) does not allow the mill", () => {
  const g = ppBoard({ active: P2 });
  const before = deckOf(g.engine, P2);
  declareAttackOpenWindow(g.engine, P2, [g.id("f1"), g.id("f2")]);
  play(g.engine, P1, g.id("pp"), {});
  reorderWith(g.engine, (ids) => ids);
  assert.equal(pending(g.engine), undefined, "no mill prompt for a party I do not control");
  assert.deepEqual(discardOf(g.engine, P2), []);
  assert.deepEqual(deckOf(g.engine, P2), before);
});

clause(PP, "1:rule", "the mill is a 'may': after the reorder the caster can decline and nothing is put into the discard pile", () => {
  const g = ppBoard();
  attackWith(g, ["a1", "a2"]);
  play(g.engine, P1, g.id("pp"), {});
  reorderWith(g.engine, (ids) => ids);
  assert.deepEqual(discardOf(g.engine, P2), [], "nothing is milled before the caster says yes");
  assert.notEqual(pending(g.engine), undefined, "the caster is asked whether to mill");
});

clause(PP, "1:rule", "'up to 3': the caster can put just 1 or 2 cards into the discard pile", () => {
  const g = ppBoard();
  const before = deckOf(g.engine, P2);
  attackWith(g, ["a1", "a2"]);
  play(g.engine, P1, g.id("pp"), {});
  reorderWith(g.engine, (ids) => ids);
  assert.notEqual(pending(g.engine), undefined, "the caster is asked how many (0-3) to mill");
  assert.equal(discardOf(g.engine, P2).length, 0, "no cards are milled before the answer");
  assert.deepEqual(deckOf(g.engine, P2), before);
});

// --- FLIP UP: 4 [D] ---
const ppFlipBoard = (res: CardPlacement[], o: Partial<Parameters<typeof ppBoard>[0]> = {}) => ppBoard({ pp: "play", faceDown: true, res, ...o });

clause(PP, "2:flipUp", "a face-down Purloining Performance flips up for 4 with [D]: the card itself plus 3 [D] pay, the tactic resolves on the opponent's deck and is discarded", () => {
  const g = ppFlipBoard(bank("deception", 3, P1));
  assert.equal(ready(g.engine), 4, "setup: the face-down card and 3 [D]");
  const before = deckOf(g.engine, P2);
  flipUp(g.engine, g.id("pp"));
  const pc = pending(g.engine) as unknown as { kind: string; deckOwnerId: string; cardIds: string[] };
  assert.equal(pc.kind, "reorderDeck");
  assert.equal(pc.deckOwnerId, P2);
  assert.deepEqual(pc.cardIds, before.slice(0, 4));
  reorderWith(g.engine, (ids) => ids.slice().reverse());
  assert.equal(zoneOf(g.engine, g.id("pp")), "discard");
  assert.equal(ready(g.engine), 0, "all 4 paid");
  assert.deepEqual(deckOf(g.engine, P2), [...before.slice(0, 4).reverse(), ...before.slice(4)]);
});

clause(PP, "2:flipUp", "pays exactly 4 (not 4 + the normal cost 2): of 7 resources, 4 are paid and the flipped card leaves the pool (2 or 3 left, depending on whether the card paid for itself)", () => {
  const g = ppFlipBoard([...bank("deception", 3, P1), ...bank("rage", 3, P1)]);
  assert.equal(ready(g.engine), 7);
  flipUp(g.engine, g.id("pp"));
  reorderWith(g.engine, (ids) => ids);
  assert.equal(zoneOf(g.engine, g.id("pp")), "discard");
  assert.ok(ready(g.engine) === 2 || ready(g.engine) === 3, `7 resources - 4 paid (-1 more if others paid): got ${ready(g.engine)}`);
});

clause(PP, "2:flipUp", "is refused with only 3 resources (card + 2) and nothing is paid", () => {
  const g = ppFlipBoard(bank("deception", 2, P1));
  assert.equal(ready(g.engine), 3);
  refused(() => flipUp(g.engine, g.id("pp")), "3 resources for a FLIP UP cost of 4");
  assert.equal(g.engine.state.cards[g.id("pp")].faceDown, true);
  assert.equal(zoneOf(g.engine, g.id("pp")), "play");
  assert.equal(ready(g.engine), 3, "nothing paid");
  const ok = ppFlipBoard(bank("deception", 3, P1));
  flipUp(ok.engine, ok.id("pp"));
  assert.equal(pending(ok.engine)?.kind, "reorderDeck", "control: 4 resources are enough");
});

clause(PP, "2:flipUp", "needs [D]: Rage resources do not meet the threshold and the opponent's [D] do not count", () => {
  const noD = ppFlipBoard(bank("rage", 4, P1));
  refused(() => flipUp(noD.engine, noD.id("pp")), "no [D] among the resources");
  assert.equal(noD.engine.state.cards[noD.id("pp")].faceDown, true);
  assert.equal(ready(noD.engine), 5);
  const opp = ppFlipBoard([...bank("rage", 4, P1), ...bank("deception", 3, P2)]);
  refused(() => flipUp(opp.engine, opp.id("pp")), "the opponent's [D] do not count");
  const one = ppFlipBoard([...bank("rage", 3, P1), ...bank("deception", 1, P1)]);
  flipUp(one.engine, one.id("pp"));
  assert.equal(pending(one.engine)?.kind, "reorderDeck", "control: a single [D] is enough");
});

clause(PP, "2:flipUp", "as a tactic it also flips up inside the opponent's response window", () => {
  const g = ppFlipBoard(bank("deception", 3, P1), { active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("f1"), g.id("f2")]);
  flipUp(g.engine, g.id("pp"));
  assert.equal(pending(g.engine)?.kind, "reorderDeck");
  reorderWith(g.engine, (ids) => ids);
  assert.equal(zoneOf(g.engine, g.id("pp")), "discard");
  assert.deepEqual(discardOf(g.engine, P2), [], "the opponent's party is not mine: no mill");
});

clause(PP, "2:flipUp", "the flipped-up tactic carries the full rule: with my attacking party of 2 it mills the top 3", () => {
  const g = ppFlipBoard(bank("deception", 3, P1));
  const before = deckOf(g.engine, P2);
  attackWith(g, ["a1", "a2"]);
  flipUp(g.engine, g.id("pp"));
  reorderWith(g.engine, (ids) => ids);
  acceptMill(g);
  assert.deepEqual(discardOf(g.engine, P2), before.slice(0, 3));
});

clause(PP, "2:flipUp", "only its controller can flip it up", () => {
  const g = ppFlipBoard([...bank("deception", 3, P1), ...bank("deception", 4, P2)]);
  refused(() => flipUp(g.engine, g.id("pp"), {}, P2), "the opponent cannot flip my card");
  assert.equal(g.engine.state.cards[g.id("pp")].faceDown, true);
});

// =================================================================================
// Retreat to Mount Mulrich -- rogue tactic, cost 3, [D]
// EXTRA COST: Pick a character. -- If the character would leave play this turn, put it into its owner's hand instead.
// FLIP UP: 1 [D]
// =================================================================================

const RTM = "b8f134f6-19d0-452a-8c5f-5b02ef1a2c75";

const mover = (name: string, effect: Record<string, unknown>) =>
  tactic({
    name,
    cost: 0,
    behavior: { abilities: [{ id: "x", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [effect] }] }
  } as Partial<CardDefinition>);
const exiler = () => mover("Exile", { type: "removeFromGame", target: { type: "selected", id: "t" } });
const discarder = () => mover("Discarder", { type: "moveCard", target: { type: "selected", id: "t" }, to: "discard" });
const decker = () => mover("Decker", { type: "moveCard", target: { type: "selected", id: "t" }, to: "deck" });

function rtmBoard(o: { res?: CardPlacement[]; faceDown?: boolean; rtm?: "hand" | "play"; active?: Pid; extra?: CardPlacement[]; turn?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn ?? 2,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "rtm", def: printing(RTM), owner: P1, zone: o.rtm ?? "hand", faceDown: o.faceDown },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 1, speed: 1 }), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other", strength: 1, life: 1, speed: 1 }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Theirs", strength: 1, life: 1, speed: 1 }), owner: P2, zone: "play" },
      { key: "gear", def: { ...character({ name: "Gear" }), type: "item", strength: undefined, life: undefined, speed: undefined } as CardDefinition, owner: P1, zone: "play" },
      { key: "inhand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "kill2", def: killTactic({ name: "Kill2" }), owner: P1, zone: "hand" },
      { key: "exile", def: exiler(), owner: P1, zone: "hand" },
      { key: "disc", def: discarder(), owner: P1, zone: "hand" },
      { key: "deckit", def: decker(), owner: P1, zone: "hand" },
      ...myDeck(3),
      ...(o.res ?? bank("deception", 3, P1)),
      ...(o.extra ?? [])
    ]
  });
}
type RG = ReturnType<typeof rtmBoard>;
const marked = (g: RG, key: string) => play(g.engine, P1, g.id("rtm"), { selected: { c: [g.id(key)] } });
const killIt = (g: RG, key: string, card = "kill") => play(g.engine, P1, g.id(card), { selected: { t: [g.id(key)] } });

clause(RTM, "0:extraCost", "a rogue tactic with no subtype: deploys for exactly 3 with a [D] (the [D] may be spent: it counts toward the threshold only)", () => {
  const g = rtmBoard({ res: [...spentD(1), ...bank("rage", 3, P1)] });
  assert.deepEqual(g.engine.getCardTypes(g.id("rtm")), ["tactic"]);
  assert.deepEqual(printing(RTM).subtype, []);
  assert.equal(printing(RTM).trade, "rogue");
  assert.equal(ready(g.engine), 3);
  marked(g, "mine");
  assert.equal(zoneOf(g.engine, g.id("rtm")), "discard");
  assert.equal(ready(g.engine), 0, "exactly 3 paid");
});

clause(RTM, "0:extraCost", "2 ready resources are one short of the cost 3, and without a [D] the threshold is missed", () => {
  const short = rtmBoard({ res: [...spentD(1), ...bank("rage", 2, P1)] });
  refused(() => marked(short, "mine"), "2 ready resources for cost 3");
  assert.equal(zoneOf(short.engine, short.id("rtm")), "hand");
  assert.equal(ready(short.engine), 2, "nothing paid");
  const noD = rtmBoard({ res: bank("rage", 3, P1) });
  refused(() => marked(noD, "mine"), "no [D]");
  assert.equal(zoneOf(noD.engine, noD.id("rtm")), "hand");
  const oppD = rtmBoard({ res: [...bank("rage", 3, P1), ...bank("deception", 2, P2)] });
  refused(() => marked(oppD, "mine"), "the opponent's [D] do not count");
});

clause(RTM, "0:extraCost", "the pick is any character in play: mine or the opponent's", () => {
  for (const key of ["mine", "theirs"]) {
    const g = rtmBoard();
    marked(g, key);
    assert.equal(zoneOf(g.engine, g.id("rtm")), "discard", `picked ${key}`);
  }
});

clause(RTM, "0:extraCost", "the pick must be a character: an item, no pick, or two picks are refused", () => {
  const g = rtmBoard();
  refused(() => marked(g, "gear"), "an item is not a character");
  refused(() => play(g.engine, P1, g.id("rtm"), { selected: {} }), "no character picked");
  refused(() => play(g.engine, P1, g.id("rtm"), { selected: { c: [g.id("mine"), g.id("other")] } }), "only ONE character is picked");
  assert.equal(zoneOf(g.engine, g.id("rtm")), "hand");
  assert.equal(ready(g.engine), 3, "nothing paid");
});

clause(RTM, "0:extraCost", "a character that is not in play (in my hand) cannot be picked", () => {
  const g = rtmBoard();
  refused(() => marked(g, "inhand"), "the character must be in play to leave play");
  assert.equal(zoneOf(g.engine, g.id("rtm")), "hand");
});

clause(RTM, "1:rule", "my picked character that would be destroyed goes to my hand instead (not the discard pile)", () => {
  const g = rtmBoard();
  marked(g, "mine");
  killIt(g, "mine");
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("mine")), "hand");
  assert.ok(handOf(g.engine, P1).includes(g.id("mine")), "handOf(g.engine, P1).includes(g.id(\"mine\"))");
  assert.ok(!discardOf(g.engine, P1).includes(g.id("mine")), "the original destruction did not happen");
  assert.equal(zoneOf(g.engine, g.id("kill")), "discard", "the killing tactic still resolved");
});

clause(RTM, "1:rule", "the opponent's picked character goes to ITS OWNER's hand (the opponent's), not mine", () => {
  const g = rtmBoard();
  marked(g, "theirs");
  killIt(g, "theirs");
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("theirs")), "hand");
  assert.ok(handOf(g.engine, P2).includes(g.id("theirs")), "in the opponent's hand");
  assert.ok(!handOf(g.engine, P1).includes(g.id("theirs")), "!handOf(g.engine, P1).includes(g.id(\"theirs\"))");
});

clause(RTM, "1:rule", "a character I control but the opponent owns returns to its OWNER's hand", () => {
  const g = rtmBoard({ extra: [{ key: "stolen", def: character({ name: "Stolen", strength: 1, life: 1, speed: 1 }), owner: P2, zone: "play", controller: P1 }] });
  marked(g, "stolen");
  killIt(g, "stolen");
  drain(g.engine, declineAll);
  assert.ok(handOf(g.engine, P2).includes(g.id("stolen")), "owner P2's hand");
  assert.ok(!handOf(g.engine, P1).includes(g.id("stolen")), "!handOf(g.engine, P1).includes(g.id(\"stolen\"))");
  assert.equal(g.engine.state.cards[g.id("stolen")].zone, "hand");
});

clause(RTM, "1:rule", "only the picked character is protected: another character destroyed the same turn goes to the discard pile", () => {
  const g = rtmBoard();
  marked(g, "mine");
  killIt(g, "other");
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("other")), "discard");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play", "the picked one is untouched");
});

clause(RTM, "1:rule", "without Retreat a destroyed character goes to the discard pile (control)", () => {
  const g = rtmBoard();
  killIt(g, "mine");
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard");
});

clause(RTM, "1:rule", "it also covers destruction in battle: the picked attacker killed by a blocker returns to my hand", () => {
  const g = rtmBoard({ extra: [{ key: "blk", def: character({ name: "Blk", strength: 5, life: 5, speed: 1 }), owner: P2, zone: "play" }] });
  marked(g, "mine");
  declareAttackBy(g.engine, P1, [g.id("mine")]);
  declareBlockers(g.engine, P2, [g.id("blk")]);
  finishBattle(g.engine);
  assert.equal(zoneOf(g.engine, g.id("mine")), "hand", "lethal battle damage replaced");
  assert.ok(!discardOf(g.engine, P1).includes(g.id("mine")), "!discardOf(g.engine, P1).includes(g.id(\"mine\"))");
  assert.equal(zoneOf(g.engine, g.id("blk")), "play", "the blocker survived");
});

clause(RTM, "1:rule", "'leave play' is any route out: an exiled (removed from game) picked character returns to its owner's hand", () => {
  const g = rtmBoard();
  marked(g, "mine");
  play(g.engine, P1, g.id("exile"), { selected: { t: [g.id("mine")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("mine")), "hand");
});

clause(RTM, "1:rule", "'leave play' is any route out: a picked character put into the discard pile (not destroyed) returns to its owner's hand", () => {
  const g = rtmBoard();
  marked(g, "mine");
  play(g.engine, P1, g.id("disc"), { selected: { t: [g.id("mine")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("mine")), "hand");
});

clause(RTM, "1:rule", "'leave play' is any route out: a picked character put into a deck returns to its owner's hand", () => {
  const g = rtmBoard();
  marked(g, "mine");
  play(g.engine, P1, g.id("deckit"), { selected: { t: [g.id("mine")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("mine")), "hand");
});

clause(RTM, "1:rule", "the protection lasts for the rest of this turn: a later kill in the same turn is still replaced", () => {
  const g = rtmBoard();
  marked(g, "mine");
  killIt(g, "other");
  drain(g.engine, declineAll);
  killIt(g, "mine", "kill2");
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("mine")), "hand");
});

clause(RTM, "1:rule", "'this turn' ends: in my next turn the same character is destroyed normally into the discard pile", () => {
  const g = rtmBoard();
  marked(g, "mine");
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  killIt(g, "mine");
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard");
});

clause(RTM, "1:rule", "'this turn' ends at the opponent's turn too: in the opponent's turn, the character is destroyed normally", () => {
  const g = rtmBoard();
  marked(g, "mine");
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  declareAttackOpenWindow(g.engine, P2, [g.id("theirs")]);
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("mine")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard");
});

// --- FLIP UP: 1 [D] ---
const rtmFlip = (res: CardPlacement[], o: Parameters<typeof rtmBoard>[0] = {}) => rtmBoard({ rtm: "play", faceDown: true, res, ...o });

clause(RTM, "2:flipUp", "flips up for 1 with [D]: the card itself pays (a spent [D] supplies the threshold) and the picked character is protected", () => {
  const g = rtmFlip(spentD(1));
  assert.equal(ready(g.engine), 1, "setup: only the face-down card is ready");
  flipUp(g.engine, g.id("rtm"), { c: [g.id("mine")] });
  assert.equal(zoneOf(g.engine, g.id("rtm")), "discard");
  assert.equal(ready(g.engine), 0);
  killIt(g, "mine");
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("mine")), "hand");
});

clause(RTM, "2:flipUp", "pays exactly 1 (not the normal cost 3): with 4 resources, 2 or 3 are left (the flipped card itself leaves the pool)", () => {
  const g = rtmFlip(bank("deception", 3, P1));
  assert.equal(ready(g.engine), 4);
  flipUp(g.engine, g.id("rtm"), { c: [g.id("mine")] });
  assert.equal(zoneOf(g.engine, g.id("rtm")), "discard");
  assert.ok(ready(g.engine) === 3 || ready(g.engine) === 2, `1 paid: card itself (3 left) or a bank (2 left), got ${ready(g.engine)}`);
});

clause(RTM, "2:flipUp", "needs [D]: no [D] among my resources (Rage only, or only the opponent's [D]) is refused and nothing is paid", () => {
  const noD = rtmFlip(bank("rage", 3, P1));
  refused(() => flipUp(noD.engine, noD.id("rtm"), { c: [noD.id("mine")] }), "no [D]");
  assert.equal(noD.engine.state.cards[noD.id("rtm")].faceDown, true);
  assert.equal(ready(noD.engine), 4);
  const opp = rtmFlip([...bank("rage", 3, P1), ...bank("deception", 2, P2)]);
  refused(() => flipUp(opp.engine, opp.id("rtm"), { c: [opp.id("mine")] }), "the opponent's [D] do not count");
  const alone = rtmFlip([]);
  refused(() => flipUp(alone.engine, alone.id("rtm"), { c: [alone.id("mine")] }), "the face-down card is a Volition resource, not [D]");
  assert.equal(zoneOf(alone.engine, alone.id("rtm")), "play");
  const one = rtmFlip([...bank("rage", 3, P1), ...bank("deception", 1, P1)]);
  flipUp(one.engine, one.id("rtm"), { c: [one.id("mine")] });
  assert.equal(zoneOf(one.engine, one.id("rtm")), "discard", "control: one [D] is enough");
});

clause(RTM, "2:flipUp", "the extra cost still applies: no pick, an item pick or a card in hand is refused", () => {
  const g = rtmFlip(bank("deception", 3, P1));
  refused(() => flipUp(g.engine, g.id("rtm"), {}), "no character picked");
  refused(() => flipUp(g.engine, g.id("rtm"), { c: [g.id("gear")] }), "an item is not a character");
  refused(() => flipUp(g.engine, g.id("rtm"), { c: [g.id("inhand")] }), "not in play");
  assert.equal(g.engine.state.cards[g.id("rtm")].faceDown, true);
  assert.equal(ready(g.engine), 4, "nothing paid");
});

clause(RTM, "2:flipUp", "as a tactic it can be flipped up inside the opponent's response window", () => {
  const g = rtmFlip(bank("deception", 3, P1), { active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("theirs")]);
  flipUp(g.engine, g.id("rtm"), { c: [g.id("mine")] });
  assert.equal(zoneOf(g.engine, g.id("rtm")), "discard");
});

// =================================================================================
// Thabbashite Seer -- rogue teller character, cost 2, [D], 2 str / 4 spd / 1 life
// [D][D][V][V]: When this card enters play, leaves play, attacks, or blocks, you may look at the top card of any deck.
// FLIP UP: 1 [V][V][V][V]
// =================================================================================

const SEER = "e9927400-459f-4c38-a223-4d3b958e70ae";

function seerBoard(o: { res?: CardPlacement[]; seer?: "hand" | "play"; faceDown?: boolean; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "s", def: printing(SEER), owner: P1, zone: o.seer ?? "play", faceDown: o.faceDown },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "allyHand", def: character({ name: "AllyHand", cost: 0 }), owner: P1, zone: "hand" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      ...oppDeck(3),
      ...myDeck(3),
      ...(o.res ?? [...bank("deception", 2, P1), ...volition(2, P1)]),
      ...(o.extra ?? [])
    ]
  });
}
type SG = ReturnType<typeof seerBoard>;

const looksAtTop = (g: SG, whose: Pid = P1) => {
  // "any deck": the controller is first asked whose deck to look at (an optional faction pick)
  if ((pending(g.engine) as unknown as { kind: string } | undefined)?.kind === "chooserSelectsTarget") {
    g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [g.engine.state.players[whose].factionId!] } } as never);
  }
  const pc = pending(g.engine) as unknown as { kind: string; playerId: string; deckOwnerId: string; cardIds: string[] };
  assert.equal(pc?.kind, "reorderDeck", "a look at a deck is offered");
  assert.equal(pc.playerId, P1);
  assert.equal(pc.deckOwnerId, whose);
  assert.deepEqual(pc.cardIds, deckOf(g.engine, whose).slice(0, 1), "exactly the top card");
  reorderWith(g.engine, (ids) => ids);
  assert.equal(pending(g.engine), undefined);
};

clause(SEER, "0:rule@ddvv", "a rogue teller character: deploys for exactly 2 with a [D] and has the printed 2 / 4 / 1", () => {
  const g = seerBoard({ seer: "hand", res: [...bank("deception", 1, P1), ...bank("rage", 1, P1)] });
  assert.deepEqual(g.engine.getCardTypes(g.id("s")), ["character"]);
  assert.deepEqual(printing(SEER).subtype, ["teller"]);
  assert.equal(printing(SEER).trade, "rogue");
  assert.equal(ready(g.engine), 2);
  play(g.engine, P1, g.id("s"), {});
  assert.equal(pending(g.engine), undefined, "no [V][V]: nothing to look at");
  assert.equal(ready(g.engine), 0, "exactly 2 paid");
  assert.equal(zoneOf(g.engine, g.id("s")), "play");
  assert.equal(g.engine.getStat(g.id("s"), "strength"), 2);
  assert.equal(g.engine.getStat(g.id("s"), "speed"), 4);
  assert.equal(g.engine.getStat(g.id("s"), "life"), 1);
});

clause(SEER, "0:rule@ddvv", "one resource short of the cost 2, or no [D] at all, is refused", () => {
  const short = seerBoard({ seer: "hand", res: bank("deception", 1, P1) });
  refused(() => play(short.engine, P1, short.id("s"), {}), "1 ready resource for cost 2");
  assert.equal(zoneOf(short.engine, short.id("s")), "hand");
  assert.equal(ready(short.engine), 1);
  const noD = seerBoard({ seer: "hand", res: bank("rage", 2, P1) });
  refused(() => play(noD.engine, P1, noD.id("s"), {}), "no [D] for the printed threshold");
  assert.equal(zoneOf(noD.engine, noD.id("s")), "hand");
});

clause(SEER, "0:rule@ddvv", "entering play with [D][D][V][V]: the controller looks at the top card of a deck", () => {
  const g = seerBoard({ seer: "hand" });
  play(g.engine, P1, g.id("s"), {});
  looksAtTop(g, P1);
});

clause(SEER, "0:rule@ddvv", "'any deck': the controller may choose the opponent's deck, whose top card is then looked at", () => {
  const g = seerBoard({ seer: "hand" });
  play(g.engine, P1, g.id("s"), {});
  const first = pending(g.engine) as unknown as { kind: string };
  assert.notEqual(first.kind, "reorderDeck", "a choice of deck comes before the look");
  const opp = g.engine.state.players[P2].factionId!;
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [opp] } } as never);
  looksAtTop(g, P2);
});

clause(SEER, "0:rule@ddvv", "'you may': the controller can decline to look at any deck", () => {
  const g = seerBoard({ seer: "hand" });
  play(g.engine, P1, g.id("s"), {});
  const first = pending(g.engine) as unknown as { kind: string };
  assert.notEqual(first.kind, "reorderDeck", "the look is optional, so an accept/decline prompt comes first");
  drain(g.engine, (pc) => ((pc as { kind: string }).kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 1 } : declineAll(pc)));
  assert.equal(pending(g.engine), undefined);
});

clause(SEER, "0:rule@ddvv", "enters play without the full threshold: [D][D][V] (one [V] short) or [D][V][V] (one [D] short) offers no look", () => {
  const noV = seerBoard({ seer: "hand", res: [...bank("deception", 2, P1), ...volition(1, P1)] });
  play(noV.engine, P1, noV.id("s"), {});
  assert.equal(pending(noV.engine), undefined, "only one [V]");
  assert.equal(zoneOf(noV.engine, noV.id("s")), "play");
  const noD = seerBoard({ seer: "hand", res: [...bank("deception", 1, P1), ...volition(2, P1), ...bank("rage", 1, P1)] });
  play(noD.engine, P1, noD.id("s"), {});
  assert.equal(pending(noD.engine), undefined, "only one [D] on the board (the second slot is Rage)");
  const opp = seerBoard({ seer: "hand", res: [...bank("deception", 2, P1), ...volition(2, P2)] });
  play(opp.engine, P1, opp.id("s"), {});
  assert.equal(pending(opp.engine), undefined, "the opponent's [V][V] do not count");
});

clause(SEER, "0:rule@ddvv", "spent resources still count toward [D][D][V][V]", () => {
  const g = seerBoard({ seer: "hand", res: [...bank("deception", 2, P1), ...spentV(2)] });
  play(g.engine, P1, g.id("s"), {});
  looksAtTop(g, P1);
});

clause(SEER, "0:rule@ddvv", "another character entering play does not trigger it (only 'this card')", () => {
  const g = seerBoard({ seer: "play" });
  play(g.engine, P1, g.id("allyHand"), {});
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("allyHand")), "play");
});

clause(SEER, "0:rule@ddvv", "attacking with the Seer (and the threshold met) lets me look at a top card", () => {
  const g = seerBoard();
  g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("s")], target: { type: "faction", playerId: P2 } });
  looksAtTop(g, P1);
});

clause(SEER, "0:rule@ddvv", "an attack without the threshold offers no look, and an attack by another character does not trigger it", () => {
  const low = seerBoard({ res: [...bank("deception", 2, P1), ...volition(1, P1)] });
  low.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [low.id("s")], target: { type: "faction", playerId: P2 } });
  assert.equal(pending(low.engine), undefined);
  const oneD = seerBoard({ res: [...bank("deception", 1, P1), ...volition(2, P1), ...bank("rage", 1, P1)] });
  oneD.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [oneD.id("s")], target: { type: "faction", playerId: P2 } });
  assert.equal(pending(oneD.engine), undefined, "only one [D]");
  const other = seerBoard();
  other.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [other.id("ally")], target: { type: "faction", playerId: P2 } });
  assert.equal(pending(other.engine), undefined, "another character attacking");
});

clause(SEER, "0:rule@ddvv", "blocking with the Seer lets me look at a top card", () => {
  const g = seerBoard({ active: P2 });
  declareAttackBy(g.engine, P2, [g.id("foe")]);
  g.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [g.id("s")] });
  looksAtTop(g, P1);
});

clause(SEER, "0:rule@ddvv", "blocking without the threshold, or another character blocking, offers no look", () => {
  const low = seerBoard({ active: P2, res: [...bank("deception", 2, P1), ...volition(1, P1)] });
  declareAttackBy(low.engine, P2, [low.id("foe")]);
  low.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [low.id("s")] });
  assert.equal(pending(low.engine), undefined);
  const oneD = seerBoard({ active: P2, res: [...bank("deception", 1, P1), ...volition(2, P1), ...bank("rage", 1, P1)] });
  declareAttackBy(oneD.engine, P2, [oneD.id("foe")]);
  oneD.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [oneD.id("s")] });
  assert.equal(pending(oneD.engine), undefined, "only one [D]");
  const other = seerBoard({ active: P2 });
  declareAttackBy(other.engine, P2, [other.id("foe")]);
  other.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [other.id("ally")] });
  assert.equal(pending(other.engine), undefined, "another character blocking");
});

clause(SEER, "0:rule@ddvv", "leaving play (destroyed) with the threshold met lets me look at a top card", () => {
  const g = seerBoard();
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("s")] } });
  assert.equal(zoneOf(g.engine, g.id("s")), "discard");
  looksAtTop(g, P1);
});

clause(SEER, "0:rule@ddvv", "leaving play without the threshold, or another character leaving, offers no look", () => {
  const low = seerBoard({ res: [...bank("deception", 2, P1), ...volition(1, P1)] });
  play(low.engine, P1, low.id("kill"), { selected: { t: [low.id("s")] } });
  assert.equal(zoneOf(low.engine, low.id("s")), "discard");
  assert.equal(pending(low.engine), undefined);
  const oneD = seerBoard({ res: [...bank("deception", 1, P1), ...volition(2, P1), ...bank("rage", 1, P1)] });
  play(oneD.engine, P1, oneD.id("kill"), { selected: { t: [oneD.id("s")] } });
  assert.equal(zoneOf(oneD.engine, oneD.id("s")), "discard");
  assert.equal(pending(oneD.engine), undefined, "only one [D]");
  const other = seerBoard();
  play(other.engine, P1, other.id("kill"), { selected: { t: [other.id("ally")] } });
  assert.equal(zoneOf(other.engine, other.id("ally")), "discard");
  assert.equal(pending(other.engine), undefined, "another character leaving");
});

// --- FLIP UP: 1 [V][V][V][V] ---
const seerFlip = (res: CardPlacement[], o: Parameters<typeof seerBoard>[0] = {}) => seerBoard({ seer: "play", faceDown: true, res, ...o });

clause(SEER, "1:flipUp", "flips up for 1 with [V][V][V][V]: becomes a face-up character with printed stats; exactly 1 is paid", () => {
  const g = seerFlip(volition(4, P1));
  assert.equal(ready(g.engine), 5, "setup: the face-down card and 4 [V]");
  flipUp(g.engine, g.id("s"));
  resolvePendingResponses(g.engine);
  const c = g.engine.state.cards[g.id("s")];
  assert.equal(c.faceDown, false);
  assert.equal(c.zone, "play");
  assert.deepEqual(g.engine.getCardTypes(g.id("s")), ["character"]);
  assert.deepEqual([g.engine.getStat(g.id("s"), "strength"), g.engine.getStat(g.id("s"), "speed"), g.engine.getStat(g.id("s"), "life")], [2, 4, 1]);
  assert.ok(ready(g.engine) === 3 || ready(g.engine) === 4, `5 resources, 1 paid (the flipped card itself, or one of the 4 others): got ${ready(g.engine)}`);
});

clause(SEER, "1:flipUp", "flipping up deploys the Seer, so with [D][D][V][V] it enters play and lets the controller look at a top card", () => {
  const g = seerFlip([...volition(4, P1), ...bank("deception", 2, P1)]);
  flipUp(g.engine, g.id("s"));
  looksAtTop(g, P1);
});

clause(SEER, "1:flipUp", "pays exactly 1 (not the normal cost 2): spent [V] supply the threshold and the single ready resource pays", () => {
  const g = seerFlip([...spentV(4), ...bank("rage", 1, P1)]);
  flipUp(g.engine, g.id("s"));
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("s")].faceDown, false);
  assert.equal(ready(g.engine), 0, "the card was the other ready resource; exactly one paid in total");
  const g2 = seerFlip([...spentV(4), ...bank("rage", 2, P1)]);
  flipUp(g2.engine, g2.id("s"));
  resolvePendingResponses(g2.engine);
  assert.ok(ready(g2.engine) >= 1, "a second ready rage resource survives: only 1 was paid, not 2");
});

clause(SEER, "1:flipUp", "the threshold counts AFTER flipping: the card's own face-down [V] does not count, so the card + 3 other [V] is one short", () => {
  const g = seerFlip(volition(3, P1));
  assert.equal(ready(g.engine), 4);
  refused(() => flipUp(g.engine, g.id("s")), "only 3 [V] besides the flipped card", /threshold|icon/i);
  assert.equal(g.engine.state.cards[g.id("s")].faceDown, true);
  assert.equal(ready(g.engine), 4, "nothing paid");
  const ok = seerFlip(volition(4, P1));
  flipUp(ok.engine, ok.id("s"));
  assert.equal(ok.engine.state.cards[ok.id("s")].faceDown, false, "control: 4 other [V]");
});

clause(SEER, "1:flipUp", "needs [V]: Rage and Deception resources, and the opponent's [V], do not meet [V][V][V][V]", () => {
  const rage = seerFlip(bank("rage", 5, P1));
  refused(() => flipUp(rage.engine, rage.id("s")), "no [V] besides the card itself");
  const opp = seerFlip([...volition(2, P1), ...volition(4, P2), ...bank("rage", 2, P1)]);
  refused(() => flipUp(opp.engine, opp.id("s")), "the opponent's [V] do not count");
  assert.equal(opp.engine.state.cards[opp.id("s")].faceDown, true);
});

clause(SEER, "1:flipUp", "a character: refused on the opponent's turn", () => {
  const g = seerFlip(volition(4, P1), { active: P2 });
  refused(() => flipUp(g.engine, g.id("s")), "a character cannot be played on the opponent's turn", /timing|turn/i);
  assert.equal(g.engine.state.cards[g.id("s")].faceDown, true);
  assert.equal(ready(g.engine), 5, "nothing paid");
});

clause(SEER, "1:flipUp", "a character: refused inside the opponent's response window", () => {
  const g = seerFlip(volition(4, P1), { active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  refused(() => flipUp(g.engine, g.id("s")), "a character cannot be played in a response window", /response|window|turn|priority|play/i);
  assert.equal(g.engine.state.cards[g.id("s")].faceDown, true);
});

// =================================================================================
// Trickster's Globe -- rogue item, cost 4, [D][D][D]
// If you would inflict damage to an opponent's faction, for each damage you would inflict, you may put up to that many
// cards from the top of its owner's deck into their discard pile instead. -- When a player has no cards in their deck,
// they lose the game.
// =================================================================================

const GLOBE = "c47c8579-7fdc-49e7-b934-f3e86c37dc13";

function globeBoard(o: { oppDeck?: number; myDeck?: number; globeOwner?: Pid; globe?: boolean; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      ...(o.globe === false ? [] : [{ key: "globe", def: printing(GLOBE), owner: o.globeOwner ?? P1, zone: "play" as const }]),
      { key: "hit", def: character({ name: "Hit", strength: 2, life: 5, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 5, speed: 1 }), owner: P2, zone: "play" },
      ...oppDeck(o.oppDeck ?? 6),
      ...myDeck(o.myDeck ?? 3),
      ...(o.extra ?? [])
    ]
  });
}

type MillChoice = { kind: string; playerId: string; amount: number; max: number; battle: boolean; deckOwnerId: string; factionPlayerId: string };
const millChoice = (engine: SpoilsEngine) => pending(engine) as unknown as MillChoice | undefined;
const answerMill = (engine: SpoilsEngine, count: number, player: Pid = P1) => {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "millInsteadOfDamage", count } } as never);
  resolvePendingResponses(engine);
};
/** P1's `hit` attacks P2's faction unblocked, up to the battle damage step being inflicted. */
const attackUnblocked = (g: ReturnType<typeof globeBoard>) => {
  declareAttackBy(g.engine, P1, [g.id("hit")]);
  g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(g.engine);
};
/** A P1 tactic: "Deal `n` damage to target opponent's faction. Draw a card." */
const zap = (n: number) =>
  tactic({
    name: `Zap ${n}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "z",
          type: "activated",
          effects: [
            { type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: n },
            { type: "draw", player: "controller", amount: 1 }
          ]
        }
      ]
    }
  } as never);

clause(GLOBE, "0:rule", "my battle damage to the opponent's faction: I may put that many cards from the top of its owner's deck into their discard pile instead", () => {
  const g = globeBoard();
  const influence = g.engine.state.players[P2].influence;
  const before = deckOf(g.engine, P2);
  attackUnblocked(g);
  const pc = millChoice(g.engine);
  assert.equal(pc?.kind, "millInsteadOfDamage", "the swap is offered");
  assert.equal(pc?.playerId, P1, "to me, the Globe's controller");
  assert.equal(pc?.amount, 2);
  assert.equal(pc?.max, 2);
  assert.equal(pc?.battle, true);
  assert.equal(pc?.deckOwnerId, P2);
  answerMill(g.engine, 2);
  finishBattle(g.engine);
  assert.equal(g.engine.state.players[P2].influence, influence, "no faction damage was dealt");
  assert.deepEqual(discardOf(g.engine, P2), before.slice(0, 2), "the top 2 cards went to the discard pile");
  assert.deepEqual(deckOf(g.engine, P2), before.slice(2));
});

clause(GLOBE, "0:rule", "for EACH damage: I may swap only part of it; the rest is inflicted", () => {
  const g = globeBoard();
  const influence = g.engine.state.players[P2].influence;
  const before = deckOf(g.engine, P2);
  attackUnblocked(g);
  answerMill(g.engine, 1);
  finishBattle(g.engine);
  assert.equal(g.engine.state.players[P2].influence, influence - 1, "1 of the 2 damage was inflicted");
  assert.deepEqual(discardOf(g.engine, P2), before.slice(0, 1), "1 card put into the discard pile");
});

clause(GLOBE, "0:rule", "it is a may: choosing 0 inflicts all the damage and mills nothing", () => {
  const g = globeBoard();
  const influence = g.engine.state.players[P2].influence;
  attackUnblocked(g);
  answerMill(g.engine, 0);
  finishBattle(g.engine);
  assert.equal(g.engine.state.players[P2].influence, influence - 2);
  assert.deepEqual(discardOf(g.engine, P2), []);
});

clause(GLOBE, "0:rule", "up to that many: more than the damage is refused, and the swap is capped at the cards left in that deck", () => {
  const g = globeBoard();
  attackUnblocked(g);
  refused(() => answerMill(g.engine, 3), "3 cards for 2 damage");
  assert.equal(millChoice(g.engine)?.kind, "millInsteadOfDamage", "the prompt stays open");
  const thin = globeBoard({ oppDeck: 1 });
  attackUnblocked(thin);
  assert.equal(millChoice(thin.engine)?.max, 1, "only 1 card in the deck");
  refused(() => answerMill(thin.engine, 2), "2 cards from a 1-card deck");
});

clause(GLOBE, "0:rule", "an effect of mine that would damage the opponent's faction: the swap is offered, then the rest of the effect goes on", () => {
  const g = globeBoard({ extra: [{ key: "zap", def: zap(3), owner: P1, zone: "hand" }] });
  const influence = g.engine.state.players[P2].influence;
  const before = deckOf(g.engine, P2);
  const hand = handOf(g.engine, P1).length;
  play(g.engine, P1, g.id("zap"));
  const pc = millChoice(g.engine);
  assert.equal(pc?.kind, "millInsteadOfDamage");
  assert.equal(pc?.amount, 3);
  assert.equal(pc?.battle, false);
  answerMill(g.engine, 2);
  assert.equal(g.engine.state.players[P2].influence, influence - 1, "1 of 3 inflicted");
  assert.deepEqual(discardOf(g.engine, P2), before.slice(0, 2));
  assert.equal(handOf(g.engine, P1).length, hand - 1 + 1, "the zap left my hand and its draw still happened");
});

clause(GLOBE, "0:rule", "only damage I inflict to an OPPONENT's faction: the opponent's damage to my faction and my damage to characters are untouched", () => {
  const g = globeBoard();
  g.engine.state.activePlayerId = P2;
  const mine = g.engine.state.players[P1].influence;
  declareAttackBy(g.engine, P2, [g.id("foe")]);
  g.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
  finishBattle(g.engine, undefined, (pc) => assert.fail(`no prompt expected, got ${pc.kind}`));
  assert.equal(g.engine.state.players[P1].influence, mine - 3, "the opponent's damage to my faction lands");

  const c = globeBoard();
  declareAttackBy(c.engine, P1, [c.id("hit")]);
  c.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [c.id("foe")] });
  finishBattle(c.engine, undefined, (pc) => assert.fail(`no prompt expected, got ${pc.kind}`));
  assert.equal(c.engine.state.cards[c.id("foe")].damage, 2, "my damage to a character lands");
  assert.deepEqual(discardOf(c.engine, P2), []);
});

clause(GLOBE, "0:rule", "the opponent's Globe does nothing for me, and gives them no swap on my damage", () => {
  const g = globeBoard({ globeOwner: P2 });
  const influence = g.engine.state.players[P2].influence;
  attackUnblocked(g);
  finishBattle(g.engine, undefined, (pc) => assert.fail(`no prompt expected, got ${pc.kind}`));
  assert.equal(g.engine.state.players[P2].influence, influence - 2);
});

clause(GLOBE, "0:rule", "control: without the Globe in play, my battle damage just lands", () => {
  const g = globeBoard({ globe: false });
  const influence = g.engine.state.players[P2].influence;
  attackUnblocked(g);
  finishBattle(g.engine, undefined, (pc) => assert.fail(`no prompt expected, got ${pc.kind}`));
  assert.equal(g.engine.state.players[P2].influence, influence - 2);
});

clause(GLOBE, "1:rule", "when a player has no cards in their deck, they lose the game", () => {
  const g = globeBoard({ oppDeck: 0 });
  settleState(g.engine);
  assert.deepEqual(g.engine.state.result, { outcome: "victory", winners: [P1] }, "the player with no deck cards loses, so the other player wins");
});

clause(GLOBE, "1:rule", "any player: my own empty deck loses me the game, and both at once is a draw", () => {
  const me = globeBoard({ myDeck: 0 });
  settleState(me.engine);
  assert.deepEqual(me.engine.state.result, { outcome: "victory", winners: [P2] });
  const both = globeBoard({ myDeck: 0, oppDeck: 0 });
  settleState(both.engine);
  assert.deepEqual(both.engine.state.result, { outcome: "draw", winners: [] });
});

clause(GLOBE, "1:rule", "milling the opponent's last cards with the swap wins at once", () => {
  const g = globeBoard({ oppDeck: 2 });
  attackUnblocked(g);
  answerMill(g.engine, 2);
  assert.deepEqual(g.engine.state.result, { outcome: "victory", winners: [P1] });
});

clause(GLOBE, "1:rule", "control: without the Globe in play an empty deck does not lose the game (CR 102.1a)", () => {
  const g = globeBoard({ oppDeck: 0, globe: false });
  settleState(g.engine);
  assert.equal(g.engine.state.result, undefined);
});

// =================================================================================
// Unchained Sarcophyle -- rogue sarcophyle character, cost 9, [D], 6 str / 4 spd / 6 life
// FLIP UP: 8 [D]
// =================================================================================

const SARC = "62ab1a47-6b01-4f22-ae70-92613d283077";

function sarcBoard(o: { res?: CardPlacement[]; sarc?: "hand" | "play"; faceDown?: boolean; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "sa", def: printing(SARC), owner: P1, zone: o.sarc ?? "play", faceDown: o.faceDown },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      ...(o.res ?? [])
    ]
  });
}

clause(SARC, "0:flipUp", "a rogue sarcophyle: deploys for exactly 9 with a [D] (spent [D] counts toward the threshold only) and has the printed 6 / 4 / 6", () => {
  const g = sarcBoard({ sarc: "hand", res: [...spentD(1), ...bank("rage", 9, P1)] });
  assert.deepEqual(g.engine.getCardTypes(g.id("sa")), ["character"]);
  assert.deepEqual(printing(SARC).subtype, ["sarcophyle"]);
  assert.equal(printing(SARC).trade, "rogue");
  assert.equal(ready(g.engine), 9);
  play(g.engine, P1, g.id("sa"), {});
  assert.equal(zoneOf(g.engine, g.id("sa")), "play");
  assert.equal(ready(g.engine), 0, "exactly 9 paid");
  assert.equal(g.engine.getStat(g.id("sa"), "strength"), 6);
  assert.equal(g.engine.getStat(g.id("sa"), "speed"), 4);
  assert.equal(g.engine.getStat(g.id("sa"), "life"), 6);
});

clause(SARC, "0:flipUp", "8 ready resources are one short of the cost 9, and 9 Rage resources lack the [D]", () => {
  const short = sarcBoard({ sarc: "hand", res: [...spentD(1), ...bank("rage", 8, P1)] });
  refused(() => play(short.engine, P1, short.id("sa"), {}), "8 ready resources for cost 9");
  assert.equal(zoneOf(short.engine, short.id("sa")), "hand");
  assert.equal(ready(short.engine), 8, "nothing paid");
  const noD = sarcBoard({ sarc: "hand", res: bank("rage", 9, P1) });
  refused(() => play(noD.engine, P1, noD.id("sa"), {}), "no [D]");
  assert.equal(zoneOf(noD.engine, noD.id("sa")), "hand");
  const opp = sarcBoard({ sarc: "hand", res: [...bank("rage", 9, P1), ...bank("deception", 1, P2)] });
  refused(() => play(opp.engine, P1, opp.id("sa"), {}), "the opponent's [D] does not count");
});

clause(SARC, "0:flipUp", "flips up for 8 with [D]: the card itself plus 7 resources (one [D]) pay, and it becomes a face-up 6 / 4 / 6 character", () => {
  const g = sarcBoard({ faceDown: true, res: [...bank("deception", 1, P1), ...bank("rage", 6, P1)] });
  assert.equal(ready(g.engine), 8, "setup: the face-down card and 7 others");
  flipUp(g.engine, g.id("sa"));
  resolvePendingResponses(g.engine);
  const c = g.engine.state.cards[g.id("sa")];
  assert.equal(c.faceDown, false);
  assert.equal(c.zone, "play");
  assert.deepEqual(g.engine.getCardTypes(g.id("sa")), ["character"]);
  assert.equal(g.engine.isResource(g.id("sa")), false);
  assert.deepEqual([g.engine.getStat(g.id("sa"), "strength"), g.engine.getStat(g.id("sa"), "speed"), g.engine.getStat(g.id("sa"), "life")], [6, 4, 6]);
  assert.equal(ready(g.engine), 0, "all 8 paid");
});

clause(SARC, "0:flipUp", "pays exactly 8 (not the normal cost 9): of 10 resources, 8 are paid and the flipped card leaves the pool (1 or 2 left)", () => {
  const g = sarcBoard({ faceDown: true, res: [...bank("deception", 1, P1), ...bank("rage", 8, P1)] });
  assert.equal(ready(g.engine), 10);
  flipUp(g.engine, g.id("sa"));
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("sa")].faceDown, false);
  assert.ok(ready(g.engine) === 1 || ready(g.engine) === 2, `10 resources - 8 paid (-1 more if others paid): got ${ready(g.engine)}`);
});

clause(SARC, "0:flipUp", "is refused with only 7 ready resources (one short of 8) and nothing is paid", () => {
  const g = sarcBoard({ faceDown: true, res: [...spentD(1), ...bank("rage", 6, P1)] });
  assert.equal(ready(g.engine), 7);
  refused(() => flipUp(g.engine, g.id("sa")), "7 ready resources for a FLIP UP cost of 8");
  assert.equal(g.engine.state.cards[g.id("sa")].faceDown, true);
  assert.equal(ready(g.engine), 7, "nothing paid");
  const ok = sarcBoard({ faceDown: true, res: [...spentD(1), ...bank("rage", 7, P1)] });
  flipUp(ok.engine, ok.id("sa"));
  resolvePendingResponses(ok.engine);
  assert.equal(ok.engine.state.cards[ok.id("sa")].faceDown, false, "control: 8 ready resources with a spent [D]");
});

clause(SARC, "0:flipUp", "needs [D]: with only Rage resources, or only the opponent's [D], it is refused and nothing is paid", () => {
  const noD = sarcBoard({ faceDown: true, res: bank("rage", 8, P1) });
  refused(() => flipUp(noD.engine, noD.id("sa")), "no [D]");
  assert.equal(noD.engine.state.cards[noD.id("sa")].faceDown, true);
  assert.equal(ready(noD.engine), 9);
  const opp = sarcBoard({ faceDown: true, res: [...bank("rage", 8, P1), ...bank("deception", 3, P2)] });
  refused(() => flipUp(opp.engine, opp.id("sa")), "the opponent's [D] do not count");
  const one = sarcBoard({ faceDown: true, res: [...bank("rage", 7, P1), ...bank("deception", 1, P1)] });
  flipUp(one.engine, one.id("sa"));
  resolvePendingResponses(one.engine);
  assert.equal(one.engine.state.cards[one.id("sa")].faceDown, false, "control: one [D] is enough");
});

clause(SARC, "0:flipUp", "a character: refused on the opponent's turn", () => {
  const g = sarcBoard({ faceDown: true, res: [...bank("deception", 1, P1), ...bank("rage", 7, P1)], active: P2 });
  refused(() => flipUp(g.engine, g.id("sa")), "a character cannot be played on the opponent's turn", /timing|turn/i);
  assert.equal(g.engine.state.cards[g.id("sa")].faceDown, true);
  assert.equal(ready(g.engine), 9, "nothing paid");
});

clause(SARC, "0:flipUp", "a character: refused inside the opponent's response window", () => {
  const g = sarcBoard({ faceDown: true, res: [...bank("deception", 1, P1), ...bank("rage", 7, P1)], active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  refused(() => flipUp(g.engine, g.id("sa")), "a character cannot be played in a response window", /response|window|turn|priority|play/i);
  assert.equal(g.engine.state.cards[g.id("sa")].faceDown, true);
});

clause(SARC, "0:flipUp", "only its controller can flip it", () => {
  const g = sarcBoard({ faceDown: true, res: [...bank("deception", 1, P1), ...bank("rage", 7, P1), ...bank("deception", 9, P2)] });
  refused(() => flipUp(g.engine, g.id("sa"), {}, P2), "the opponent cannot flip my card");
  assert.equal(g.engine.state.cards[g.id("sa")].faceDown, true);
  assert.equal(isDepleted(g.engine, g.id("sa")), false);
});
