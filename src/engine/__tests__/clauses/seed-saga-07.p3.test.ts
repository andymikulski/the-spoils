// Clause tests - batch seed-saga-07, part p3 (groups 11-16). Expectations come from each
// card's PRINTED text, RULES.md and the Comprehensive Rules; engine data (ability ids,
// declaration ids, choice kinds) is only used to DRIVE the engine.

import assert from "node:assert/strict";
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
  P1,
  P2
} from "../per-card/_harness.js";
import type { StapleIcon } from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import { declareAttackBy, fightThrough, playRaw } from "./_battle.js";
import { answerPending, fillers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { endTurn } from "./_turn.js";
import type { CardPlacement } from "../support/fixtures.js";
import type { CardInstanceId, PlayerId } from "../../../engine.js";

// --- file-local helpers -------------------------------------------------------

/** `n` of `icon` resources already spent (attached to the faction): they count for thresholds but can't pay. */
const spent = (icon: StapleIcon, n: number, owner: PlayerId = P1): CardPlacement[] =>
  bank(icon, n, owner).map((p) => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

function game(cards: CardPlacement[], o: { influence?: number; active?: PlayerId } = {}) {
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction(), ...(o.influence !== undefined ? { influence: o.influence } : {}) },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    random: () => 0.5,
    cards
  });
}
type G = ReturnType<typeof game>;

const flipRaw = (g: G, key: string, selected: Record<string, CardInstanceId[]> = {}, player: PlayerId = P1) =>
  flipUpNow(g.engine, { type: "flipUp", playerId: player, cardId: g.id(key), selected, variables: {} });
const flip = (g: G, key: string, selected: Record<string, CardInstanceId[]> = {}, player: PlayerId = P1) => {
  flipRaw(g, key, selected, player);
  resolvePendingResponses(g.engine);
};
const hand = (g: G, p: PlayerId = P1) => [...g.engine.state.players[p].hand];
const deck = (g: G, p: PlayerId = P1) => [...g.engine.state.players[p].deck];
const ready = (g: G, p: PlayerId = P1) => readyResources(g.engine, p);
const card = (g: G, key: string) => g.engine.state.cards[g.id(key)];
const inf = (g: G, p: PlayerId = P1) => g.engine.state.players[p].influence;
const attachedToFaction = (g: G, key: string) => card(g, key).attachedTo !== undefined && card(g, key).attachedTo !== null;

/** A free tactic (ability "dmg", pick "t") dealing `n` non-battle damage to a character. */
const zap = (n: number) =>
  tactic({
    name: `Zap ${n}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "dmg",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: n }]
        }
      ]
    }
  });

// =============================================================================
// Repurpose - tactic, gearsmith, cost 4, [E][E]
// EXTRA COST: Pick an item. -- Destroy the item. Draw a card. -- FLIP UP: 2 [E][E]
// =============================================================================
const REPURPOSE = "0a523d2d-718c-4fac-83f0-eca5348d7898";

function repBoard(o: { e?: number; r?: number; spentE?: number; faceDown?: boolean } = {}) {
  return game([
    { key: "x", def: printing(REPURPOSE), owner: P1, zone: o.faceDown ? "play" : "hand", ...(o.faceDown ? { faceDown: true } : {}) },
    { key: "i1", def: item({ name: "Mine" }), owner: P1, zone: "play" },
    { key: "i2", def: item({ name: "Theirs" }), owner: P2, zone: "play" },
    { key: "i3", def: item({ name: "Bystander" }), owner: P1, zone: "play" },
    { key: "c1", def: character({ name: "Chr" }), owner: P1, zone: "play" },
    { key: "ih", def: item({ name: "HandItem" }), owner: P1, zone: "hand" },
    { key: "id", def: item({ name: "DiscItem" }), owner: P1, zone: "discard" },
    ...fillers("dk", 5, P1, "deck"),
    ...(o.e ? bank("elitism", o.e, P1) : []),
    ...(o.r ? bank("rage", o.r, P1) : []),
    ...(o.spentE ? spent("elitism", o.spentE) : [])
  ]);
}
const repPlay = (g: G, pick = "i1") => play(g.engine, P1, g.id("x"), { selected: { it: [g.id(pick)] } });

clause(REPURPOSE, "0:extraCost", "printed: tactic, gearsmith, cost 4, threshold [E][E]; deploys with exactly 4 elitism and pays all 4", () => {
  const g = repBoard({ e: 4 });
  const def = g.engine.getDefinition(g.id("x"));
  assert.deepEqual([def.type, def.trade, def.cost, def.threshold], ["tactic", "gearsmith", 4, "ee"]);
  assert.equal(ready(g), 4);
  repPlay(g);
  assert.equal(zoneOf(g.engine, g.id("x")), "discard", "the tactic resolved");
  assert.equal(ready(g), 0, "all 4 paid");
});

clause(REPURPOSE, "0:extraCost", "cost is not payable one short (3 resources, threshold met)", () => {
  const g = repBoard({ e: 3 });
  refused(() => repPlay(g), "one resource short of cost 4");
  const ok = repBoard({ e: 4 });
  repPlay(ok);
});

clause(REPURPOSE, "0:extraCost", "threshold [E][E] is required: enough resources with one icon short is refused", () => {
  const g = repBoard({ e: 1, r: 3 });
  refused(() => repPlay(g), "only one [E]");
  const g0 = repBoard({ r: 4 });
  refused(() => repPlay(g0), "no [E]");
  const ok = repBoard({ e: 2, r: 2 });
  repPlay(ok);
  assert.equal(zoneOf(ok.engine, ok.id("x")), "discard");
  assert.equal(ready(ok), 0);
});

clause(REPURPOSE, "0:extraCost", "the extra cost picks an item: your own or an opponent's in play", () => {
  for (const pick of ["i1", "i2"]) {
    const g = repBoard({ e: 4 });
    repPlay(g, pick);
    assert.equal(zoneOf(g.engine, g.id(pick)), "discard", `${pick} is destroyed`);
  }
});

clause(REPURPOSE, "0:extraCost", "the pick is required, and must be an item in play (not a character, hand or discard card)", () => {
  const g = repBoard({ e: 4 });
  refused(() => play(g.engine, P1, g.id("x"), { selected: {} }), "no pick");
  refused(() => repPlay(g, "c1"), "a character is not an item");
  refused(() => repPlay(g, "ih"), "an item in hand is not in play");
  refused(() => repPlay(g, "id"), "an item in the discard pile is not in play");
  assert.equal(zoneOf(g.engine, g.id("x")), "hand", "nothing was paid or played");
  assert.equal(ready(g), 4);
  repPlay(g, "i1");
  assert.equal(zoneOf(g.engine, g.id("x")), "discard");
});

clause(REPURPOSE, "0:extraCost", "the pick is exactly one item", () => {
  const g = repBoard({ e: 4 });
  refused(() => play(g.engine, P1, g.id("x"), { selected: { it: [g.id("i1"), g.id("i3")] } }), "two items");
  assert.equal(zoneOf(g.engine, g.id("i1")), "play");
  assert.equal(zoneOf(g.engine, g.id("i3")), "play");
});

clause(REPURPOSE, "1:rule", "destroys the picked item and no other, and draws exactly one card (the top one)", () => {
  const g = repBoard({ e: 4 });
  const top = deck(g)[0];
  const handBefore = hand(g).length;
  const deckBefore = deck(g).length;
  repPlay(g, "i2");
  assert.equal(zoneOf(g.engine, g.id("i2")), "discard", "item destroyed");
  assert.equal(g.engine.state.players[P2].discard.includes(g.id("i2")), true, "to its owner's discard");
  assert.equal(zoneOf(g.engine, g.id("i1")), "play", "other item stays");
  assert.equal(zoneOf(g.engine, g.id("i3")), "play", "other item stays");
  assert.equal(zoneOf(g.engine, g.id("c1")), "play", "character stays");
  assert.equal(zoneOf(g.engine, g.id("x")), "discard");
  assert.equal(hand(g).length, handBefore - 1 + 1, "tactic left hand, one card drawn");
  assert.equal(hand(g).includes(top), true, "the top card was drawn");
  assert.equal(deck(g).length, deckBefore - 1, "exactly one card drawn");
  assert.equal(pending(g.engine), undefined);
});

clause(REPURPOSE, "1:rule", "the controller draws, not the opponent", () => {
  const g = repBoard({ e: 4 });
  const oppHand = hand(g, P2).length;
  repPlay(g, "i2");
  assert.equal(hand(g, P2).length, oppHand);
});

function repFlipBoard(o: { spentE?: number; r?: number; e?: number } = {}) {
  return repBoard({ faceDown: true, spentE: o.spentE ?? 2, r: o.r ?? 1, e: o.e });
}

clause(REPURPOSE, "2:flipUp", "FLIP UP: 2 [E][E] turns the face-down tactic up, destroys the item, draws a card and costs only 2 (not 4)", () => {
  const g = repFlipBoard({ r: 3 });
  const top = deck(g)[0];
  assert.equal(card(g, "x").faceDown, true);
  const before = ready(g);
  flip(g, "x", { it: [g.id("i1")] });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("i1")), "discard", "item destroyed");
  assert.equal(hand(g).includes(top), true, "drew a card");
  assert.equal(card(g, "x").faceDown === true, false, "no longer face-down");
  assert.equal(zoneOf(g.engine, g.id("x")), "discard", "the tactic resolved");
  // 3 rage + itself were ready; it stopped being a resource and 2 were paid: 1 resource remains whatever paid
  assert.ok(ready(g) === before - 3 || ready(g) === before - 2, `paid exactly 2 (ready ${before} -> ${ready(g)})`);
});

clause(REPURPOSE, "2:flipUp", "FLIP UP cost is exactly 2: the card may pay for itself (1 other + itself works), 0 others is one short", () => {
  const ok = repFlipBoard({ r: 1 });
  flip(ok, "x", { it: [ok.id("i1")] });
  assert.equal(zoneOf(ok.engine, ok.id("i1")), "discard", "1 other + itself paid 2");
  const short = repFlipBoard({ r: 0 });
  refused(() => flipRaw(short, "x", { it: [short.id("i1")] }), "only itself (1) to pay a cost of 2");
  assert.equal(zoneOf(short.engine, short.id("i1")), "play");
});

clause(REPURPOSE, "2:flipUp", "FLIP UP threshold [E][E]: refused with one [E] (its own icon does not count)", () => {
  const g = repBoard({ faceDown: true, spentE: 1, r: 4 });
  refused(() => flipRaw(g, "x", { it: [g.id("i1")] }), "one [E] is short of the threshold");
  const none = repBoard({ faceDown: true, r: 4 });
  refused(() => flipRaw(none, "x", { it: [none.id("i1")] }), "no [E]");
  const ok = repBoard({ faceDown: true, spentE: 2, r: 4 });
  flip(ok, "x", { it: [ok.id("i1")] });
  assert.equal(zoneOf(ok.engine, ok.id("i1")), "discard");
});

clause(REPURPOSE, "2:flipUp", "the flipped tactic still needs its item pick (an item in play)", () => {
  const g = repFlipBoard({ r: 3 });
  refused(() => flipRaw(g, "x", {}), "no pick");
  refused(() => flipRaw(g, "x", { it: [g.id("c1")] }), "character");
  assert.equal(card(g, "x").faceDown, true, "still face-down after refusals");
  flip(g, "x", { it: [g.id("i2")] });
  assert.equal(zoneOf(g.engine, g.id("i2")), "discard", "opponent's item can be picked");
});

clause(REPURPOSE, "2:flipUp", "only a face-down card in play can be flipped up", () => {
  const g = repBoard({ spentE: 2, r: 3 });
  refused(() => flipRaw(g, "x", { it: [g.id("i1")] }), "the card is in hand, not a face-down resource");
});

// =============================================================================
// Rewarding Salvage - tactic, gearsmith, cost 4, [E][E]
// EXTRA COST: Pick 2 or fewer items in your discard pile. -- Put the items into your hand.
// FLIP UP: 2 [E][E] and play a resource.
// =============================================================================
const SALVAGE = "c03cacc4-6bcd-4ea4-a213-029153d0389b";

function salBoard(o: { e?: number; r?: number; spentE?: number; faceDown?: boolean } = {}) {
  return game([
    { key: "x", def: printing(SALVAGE), owner: P1, zone: o.faceDown ? "play" : "hand", ...(o.faceDown ? { faceDown: true } : {}) },
    { key: "d1", def: item({ name: "Disc1" }), owner: P1, zone: "discard" },
    { key: "d2", def: item({ name: "Disc2" }), owner: P1, zone: "discard" },
    { key: "d3", def: item({ name: "Disc3" }), owner: P1, zone: "discard" },
    { key: "od", def: item({ name: "OppDisc" }), owner: P2, zone: "discard" },
    { key: "dc", def: character({ name: "DiscChar" }), owner: P1, zone: "discard" },
    { key: "ih", def: item({ name: "HandItem" }), owner: P1, zone: "hand" },
    { key: "ip", def: item({ name: "PlayItem" }), owner: P1, zone: "play" },
    { key: "hc", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
    { key: "hr", def: resourceCard({ name: "HandRes" }), owner: P1, zone: "hand" },
    ...fillers("dk", 3, P1, "deck"),
    ...(o.e ? bank("elitism", o.e, P1) : []),
    ...(o.r ? bank("rage", o.r, P1) : []),
    ...(o.spentE ? spent("elitism", o.spentE) : [])
  ]);
}
const salPlay = (g: G, picks: string[]) => play(g.engine, P1, g.id("x"), { selected: { haul: picks.map((k) => g.id(k)) } });

clause(SALVAGE, "0:extraCost", "printed: tactic, gearsmith, cost 4, threshold [E][E]; deploys with exactly 4 elitism and pays all 4", () => {
  const g = salBoard({ e: 4 });
  const def = g.engine.getDefinition(g.id("x"));
  assert.deepEqual([def.type, def.trade, def.cost, def.threshold], ["tactic", "gearsmith", 4, "ee"]);
  salPlay(g, ["d1"]);
  assert.equal(zoneOf(g.engine, g.id("x")), "discard");
  assert.equal(ready(g), 0);
});

clause(SALVAGE, "0:extraCost", "cost 4 is required (3 refused) and threshold [E][E] is required (one [E] refused)", () => {
  const short = salBoard({ e: 3 });
  refused(() => salPlay(short, ["d1"]), "one resource short");
  const thr = salBoard({ e: 1, r: 3 });
  refused(() => salPlay(thr, ["d1"]), "one icon short");
  const ok = salBoard({ e: 2, r: 2 });
  salPlay(ok, ["d1"]);
  assert.equal(ready(ok), 0);
});

clause(SALVAGE, "0:extraCost", "picks 0, 1 or 2 items in your discard pile, but not 3", () => {
  for (const picks of [[], ["d1"], ["d1", "d2"]]) {
    const g = salBoard({ e: 4 });
    salPlay(g, picks);
    assert.equal(zoneOf(g.engine, g.id("x")), "discard", `${picks.length} picks accepted`);
  }
  const g = salBoard({ e: 4 });
  refused(() => salPlay(g, ["d1", "d2", "d3"]), "three items");
  assert.equal(zoneOf(g.engine, g.id("x")), "hand");
  assert.equal(ready(g), 4, "nothing paid");
});

clause(SALVAGE, "0:extraCost", "the picks must be items in YOUR discard pile", () => {
  const g = salBoard({ e: 4 });
  refused(() => salPlay(g, ["od"]), "opponent's discard item");
  refused(() => salPlay(g, ["dc"]), "a character in the discard pile");
  refused(() => salPlay(g, ["ih"]), "an item in hand");
  refused(() => salPlay(g, ["ip"]), "an item in play");
  refused(() => salPlay(g, ["d1", "od"]), "one good and one opponent pick");
  assert.equal(zoneOf(g.engine, g.id("x")), "hand");
  salPlay(g, ["d1", "d2"]);
  assert.equal(zoneOf(g.engine, g.id("x")), "discard");
});

clause(SALVAGE, "1:rule", "puts the picked items (one or two) into your hand; unpicked discards stay", () => {
  const g = salBoard({ e: 4 });
  salPlay(g, ["d1", "d3"]);
  assert.equal(zoneOf(g.engine, g.id("d1")), "hand");
  assert.equal(zoneOf(g.engine, g.id("d3")), "hand");
  assert.equal(hand(g).includes(g.id("d1")) && hand(g).includes(g.id("d3")), true);
  assert.equal(zoneOf(g.engine, g.id("d2")), "discard", "unpicked item stays");
  assert.equal(zoneOf(g.engine, g.id("od")), "discard", "opponent's stays");
  assert.equal(zoneOf(g.engine, g.id("dc")), "discard", "character stays");
  assert.equal(pending(g.engine), undefined);
  const one = salBoard({ e: 4 });
  salPlay(one, ["d2"]);
  assert.equal(zoneOf(one.engine, one.id("d2")), "hand");
  assert.equal(zoneOf(one.engine, one.id("d1")), "discard");
});

clause(SALVAGE, "1:rule", "with no items picked nothing moves", () => {
  const g = salBoard({ e: 4 });
  const handBefore = hand(g);
  const discBefore = g.engine.state.players[P1].discard.filter((c) => c !== g.id("x"));
  salPlay(g, []);
  assert.deepEqual(hand(g), handBefore.filter((c) => c !== g.id("x")));
  assert.deepEqual(
    g.engine.state.players[P1].discard.filter((c) => c !== g.id("x")),
    discBefore
  );
});

const salFlipBoard = (o: { spentE?: number; r?: number } = {}) => salBoard({ faceDown: true, spentE: o.spentE ?? 2, r: o.r ?? 1 });

clause(SALVAGE, "2:flipUp", "FLIP UP: 2 [E][E] turns it up and resolves the rule (picked discard items go to hand), costing 2 not 4", () => {
  const g = salFlipBoard({ r: 3 });
  const before = ready(g);
  flipRaw(g, "x", { haul: [g.id("d1"), g.id("d2")] });
  // "and play a resource" is not optional (SYS-20), so the test plays a real card from hand (HandRes) instead of declining.
  drain(g.engine, (pc) => ({ kind: pc.kind, selected: pc.kind === "chooserSelectsTarget" ? [g.id("hr")] : [] }));
  assert.equal(zoneOf(g.engine, g.id("d1")), "hand");
  assert.equal(zoneOf(g.engine, g.id("d2")), "hand");
  assert.equal(zoneOf(g.engine, g.id("d3")), "discard");
  assert.equal(card(g, "x").faceDown === true, false);
  assert.equal(zoneOf(g.engine, g.id("x")), "discard");
  assert.ok(ready(g) <= before - 2 + 0 && ready(g) >= before - 3, `paid exactly 2 (ready ${before} -> ${ready(g)})`);
});

clause(SALVAGE, "2:flipUp", "FLIP UP cost is exactly 2 (1 other + itself works; itself alone is one short)", () => {
  const ok = salFlipBoard({ r: 1 });
  flipRaw(ok, "x", { haul: [ok.id("d1")] });
  // "and play a resource" is not optional (SYS-20): play a real card from hand.
  drain(ok.engine, (pc) => ({ kind: pc.kind, selected: pc.kind === "chooserSelectsTarget" ? [ok.id("hr")] : [] }));
  assert.equal(zoneOf(ok.engine, ok.id("d1")), "hand");
  const short = salFlipBoard({ r: 0 });
  refused(() => flipRaw(short, "x", { haul: [short.id("d1")] }), "only itself to pay 2");
  assert.equal(zoneOf(short.engine, short.id("d1")), "discard");
});

clause(SALVAGE, "2:flipUp", "FLIP UP threshold [E][E] is required (one [E] refused, its own icon doesn't count)", () => {
  const g = salBoard({ faceDown: true, spentE: 1, r: 4 });
  refused(() => flipRaw(g, "x", { haul: [] }), "one [E]");
  const none = salBoard({ faceDown: true, r: 4 });
  refused(() => flipRaw(none, "x", { haul: [] }), "no [E]");
  const ok = salBoard({ faceDown: true, spentE: 2, r: 4 });
  flipRaw(ok, "x", { haul: [] });
  // the "and play a resource" pick is part of the cost and is asked before the flip: answering it flips the card
  ok.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [ok.id("hr")] } } as never);
  assert.equal(card(ok, "x").faceDown === true, false);
});

clause(SALVAGE, "2:flipUp", "FLIP UP keeps the extra-cost pick rules (at most 2 items, from your own discard pile)", () => {
  const g = salFlipBoard({ r: 3 });
  refused(() => flipRaw(g, "x", { haul: [g.id("d1"), g.id("d2"), g.id("d3")] }), "three");
  refused(() => flipRaw(g, "x", { haul: [g.id("od")] }), "opponent's discard");
  refused(() => flipRaw(g, "x", { haul: [g.id("dc")] }), "character");
  assert.equal(card(g, "x").faceDown, true);
});

clause(SALVAGE, "2:flipUp", "FLIP UP: and play a resource -- a real resource card from hand enters play", () => {
  const g = salFlipBoard({ r: 3 });
  flipRaw(g, "x", { haul: [] });
  const pc = pending(g.engine) as unknown as { kind: string; playerId: string } | undefined;
  assert.ok(pc, "the player is asked which resource to play");
  assert.equal(pc.playerId, P1);
  answerPending(g.engine, pc.kind, { selected: [g.id("hr")] });
  drain(g.engine, () => ({}));
  assert.equal(zoneOf(g.engine, g.id("hr")), "play", "the resource is played");
  assert.equal(g.engine.isResource(g.id("hr")), true);
});

clause(SALVAGE, "2:flipUp", "FLIP UP: and play a resource -- a non-resource card from hand is played face-down as a resource", () => {
  const g = salFlipBoard({ r: 3 });
  flipRaw(g, "x", { haul: [] });
  const pc = pending(g.engine) as unknown as { kind: string };
  answerPending(g.engine, pc.kind, { selected: [g.id("hc")] });
  drain(g.engine, () => ({}));
  assert.equal(zoneOf(g.engine, g.id("hc")), "play");
  assert.equal(card(g, "hc").faceDown, true, "played face-down as a Volition resource");
  assert.equal(g.engine.isResource(g.id("hc")), true);
  assert.equal(pending(g.engine), undefined);
});

clause(SALVAGE, "2:flipUp", "'and play a resource' is part of the FLIP UP, so it can't be skipped while a card is in hand", () => {
  const g = salFlipBoard({ r: 3 });
  const handBefore = hand(g).length;
  flipRaw(g, "x", { haul: [] });
  const pc = pending(g.engine) as unknown as { kind: string } | undefined;
  assert.ok(pc, "the resource pick is offered");
  refused(() => answerPending(g.engine, pc.kind, { selected: [] }), "declining to play a resource");
  void handBefore;
});

// =============================================================================
// Rune of Concealment - item, gearsmith, cost 2, [E][E]
// PROTECT -- COST: Pay 2. Deplete this card. Pick a character.
// EFFECT: The next time the character would be destroyed by battle damage this turn, if this
// card is in play you may destroy it instead. If you do, reduce the amount of damage already
// inflicted to the character this turn to 0. -- FLIP UP: 0 [E][E]
// =============================================================================
const RUNE = "49cf8e0c-1799-40fa-ba6a-81c6f4dd328f";

function runeBoard(o: { rage?: number; spentE?: number; extraRune?: boolean; cLife?: number; cDamage?: number; active?: PlayerId } = {}) {
  return game(
    [
      { key: "r", def: printing(RUNE), owner: P1, zone: "play" },
      ...(o.extraRune ? [{ key: "r2", def: printing(RUNE), owner: P1, zone: "play" as const }] : []),
      { key: "c", def: character({ name: "Prot", strength: 1, speed: 1, life: o.cLife ?? 2 }), owner: P1, zone: "play", ...(o.cDamage ? { damage: o.cDamage } : {}) },
      { key: "c2", def: character({ name: "Other", strength: 1, speed: 1, life: 2 }), owner: P1, zone: "play" },
      { key: "o", def: character({ name: "Big", strength: 5, speed: 1, life: 6 }), owner: P2, zone: "play" },
      { key: "o2", def: character({ name: "Big2", strength: 5, speed: 1, life: 6 }), owner: P2, zone: "play" },
      { key: "zap", def: zap(9), owner: P1, zone: "hand" },
      ...bank("rage", o.rage ?? 2, P1),
      ...(o.spentE ? spent("elitism", o.spentE) : [])
    ],
    { active: o.active }
  );
}
const protect = (g: G, rune = "r", target = "c") => activate(g.engine, P1, g.id(rune), "protect", { selected: { c: [g.id(target)] } });
/** P1's protected `c` attacks P2's faction and is blocked by P2's Big (strength 5): lethal battle damage. */
const lethalFight = (g: G, blocker = "o") => fightThrough(g.engine, P1, [g.id("c")], { type: "faction", playerId: P2 }, [g.id(blocker)], undefined, (pc) => {
  if (pc.kind === "chooserSelectsOption") return { kind: pc.kind, index: 0 };
  // "you may destroy it instead" is optional (seed-saga-07-p3-2): these fights accept it.
  if (pc.kind === "replacementChoice") return { kind: pc.kind, apply: true };
  // Two Runes both protect the character (CR 506.4): their controller picks which one applies.
  if (pc.kind === "chooseReplacement") return { kind: pc.kind, index: 0 };
  return { kind: pc.kind };
});

clause(RUNE, "0:ability:protect", "printed: item, gearsmith, cost 2, threshold [E][E]; deployed with exactly 2 elitism, refused one short", () => {
  const mk = (e: number, spentOnly = 0) =>
    game([
      { key: "r", def: printing(RUNE), owner: P1, zone: "hand" },
      ...bank("elitism", e, P1),
      ...(spentOnly ? spent("elitism", spentOnly) : [])
    ]);
  const g = mk(2);
  const def = g.engine.getDefinition(g.id("r"));
  assert.deepEqual([def.type, def.trade, def.cost, def.threshold], ["item", "gearsmith", 2, "ee"]);
  play(g.engine, P1, g.id("r"));
  assert.equal(zoneOf(g.engine, g.id("r")), "play");
  assert.equal(ready(g), 0, "paid 2");
  const short = mk(1);
  refused(() => play(short.engine, P1, short.id("r")), "cost 2 with 1 resource");
  const iconShort = game([
    { key: "r", def: printing(RUNE), owner: P1, zone: "hand" },
    ...bank("elitism", 1, P1),
    ...bank("rage", 1, P1)
  ]);
  refused(() => play(iconShort.engine, P1, iconShort.id("r")), "only one [E]");
  const costShort = mk(1, 1); // [E][E] met via a spent one, but only 1 ready resource for cost 2
  refused(() => play(costShort.engine, P1, costShort.id("r")), "cost 2, 1 ready (spent resource can't pay)");
  const ok = mk(2, 0);
  play(ok.engine, P1, ok.id("r"));
});

clause(RUNE, "0:ability:protect", "PROTECT costs pay 2 and deplete this card; refused with 1 resource or while depleted", () => {
  const g = runeBoard({ rage: 2 });
  protect(g);
  assert.equal(card(g, "r").depleted, true, "Rune depleted");
  assert.equal(ready(g), 0, "paid 2");
  const one = runeBoard({ rage: 1 });
  refused(() => protect(one), "one resource");
  assert.equal(card(one, "r").depleted === true, false);
  const dep = runeBoard({ rage: 2 });
  dep.engine.state.cards[dep.id("r")].depleted = true;
  refused(() => protect(dep), "already depleted");
});

clause(RUNE, "0:ability:protect", "PROTECT picks a character (any in play, yours or an opponent's), not an item or a hand card", () => {
  for (const t of ["c", "o"]) {
    const g = runeBoard({ rage: 2 });
    protect(g, "r", t);
    assert.equal(card(g, "r").depleted, true, `${t} accepted`);
  }
  const g = runeBoard({ rage: 2 });
  refused(() => activate(g.engine, P1, g.id("r"), "protect", { selected: { c: [g.id("r")] } }), "an item");
  refused(() => activate(g.engine, P1, g.id("r"), "protect", { selected: { c: [g.id("zap")] } }), "a tactic in hand");
  refused(() => activate(g.engine, P1, g.id("r"), "protect", { selected: {} }), "no pick");
  assert.equal(ready(g), 2, "nothing paid by refusals");
});

clause(RUNE, "0:ability:protect", "the protected character that would be destroyed by battle damage survives; the Rune is destroyed instead and the damage is reduced to 0", () => {
  const g = runeBoard({ rage: 2 });
  protect(g);
  lethalFight(g);
  assert.equal(zoneOf(g.engine, g.id("c")), "play", "the character survives");
  assert.equal(zoneOf(g.engine, g.id("r")), "discard", "the Rune is destroyed instead");
  assert.equal(card(g, "c").damage ?? 0, 0, "damage reduced to 0");
  assert.equal(pending(g.engine), undefined);
});

clause(RUNE, "0:ability:protect", "without PROTECT the same battle destroys the character (control)", () => {
  const g = runeBoard({ rage: 2 });
  lethalFight(g);
  assert.equal(zoneOf(g.engine, g.id("c")), "discard");
  assert.equal(zoneOf(g.engine, g.id("r")), "play");
});

clause(RUNE, "0:ability:protect", "damage already inflicted this turn is reduced to 0 (earlier non-lethal damage included)", () => {
  // 2 non-battle damage this turn first (not lethal), then protected, then lethal battle damage
  const dmg = tactic({
    name: "Zap2",
    cost: 0,
    behavior: { abilities: [{ id: "dmg", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 2 }] }] }
  });
  const k = game([
    { key: "r", def: printing(RUNE), owner: P1, zone: "play" },
    { key: "c", def: character({ name: "Prot", strength: 1, speed: 1, life: 4 }), owner: P1, zone: "play" },
    { key: "o", def: character({ name: "Big", strength: 5, speed: 1, life: 6 }), owner: P2, zone: "play" },
    { key: "z2", def: dmg, owner: P1, zone: "hand" },
    ...bank("rage", 2, P1)
  ]);
  play(k.engine, P1, k.id("z2"), { selected: { t: [k.id("c")] } });
  assert.equal(card(k, "c").damage, 2, "2 damage already inflicted");
  protect(k);
  lethalFight(k);
  assert.equal(zoneOf(k.engine, k.id("c")), "play");
  assert.equal(card(k, "c").damage ?? 0, 0, "ALL damage dealt this turn reduced to 0, not just the battle damage");
  assert.equal(zoneOf(k.engine, k.id("r")), "discard");
});

clause(RUNE, "0:ability:protect", "only the picked character is protected: another character with lethal battle damage dies and the Rune stays", () => {
  const g = runeBoard({ rage: 2 });
  protect(g, "r", "c");
  fightThrough(g.engine, P1, [g.id("c2")], { type: "faction", playerId: P2 }, [g.id("o")], undefined, (pc) => ({ kind: pc.kind, index: 0 }));
  assert.equal(zoneOf(g.engine, g.id("c2")), "discard", "unprotected character destroyed");
  assert.equal(zoneOf(g.engine, g.id("r")), "play", "Rune not used");
});

clause(RUNE, "0:ability:protect", "only battle damage is replaced: non-battle lethal damage still destroys the protected character", () => {
  const g = runeBoard({ rage: 2 });
  protect(g);
  play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("c")] } });
  assert.equal(zoneOf(g.engine, g.id("c")), "discard", "destroyed by non-battle damage");
  assert.equal(zoneOf(g.engine, g.id("r")), "play", "Rune not used");
});

clause(RUNE, "0:ability:protect", "'if this card is in play': when the Rune left play before the lethal damage, the character is destroyed", () => {
  const g = runeBoard({ rage: 2 });
  protect(g);
  // destroy the Rune (an opponent's effect is not needed: remove it through a real destroy tactic)
  const kill = tactic({
    name: "Smash",
    cost: 0,
    behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const k = game([
    { key: "r", def: printing(RUNE), owner: P1, zone: "play" },
    { key: "c", def: character({ name: "Prot", strength: 1, speed: 1, life: 2 }), owner: P1, zone: "play" },
    { key: "o", def: character({ name: "Big", strength: 5, speed: 1, life: 6 }), owner: P2, zone: "play" },
    { key: "smash", def: kill, owner: P1, zone: "hand" },
    ...bank("rage", 2, P1)
  ]);
  void g;
  protect(k);
  play(k.engine, P1, k.id("smash"), { selected: { t: [k.id("r")] } });
  assert.equal(zoneOf(k.engine, k.id("r")), "discard");
  lethalFight(k);
  assert.equal(zoneOf(k.engine, k.id("c")), "discard", "no Rune in play: the character is destroyed");
});

clause(RUNE, "0:ability:protect", "'this turn': the protection is gone next turn (on the opponent's turn the character is destroyed and the Rune untouched)", () => {
  const g = runeBoard({ rage: 2 });
  protect(g);
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  fightThrough(g.engine, P2, [g.id("o")], { type: "faction", playerId: P1 }, [g.id("c")]);
  assert.equal(zoneOf(g.engine, g.id("c")), "discard", "character destroyed next turn");
  assert.equal(zoneOf(g.engine, g.id("r")), "play", "Rune unused");
});

clause(RUNE, "0:ability:protect", "the replacement is optional ('you may'): the controller is asked and can decline, letting the character be destroyed", () => {
  const g = runeBoard({ rage: 2 });
  protect(g);
  declareAttackBy(g.engine, P1, [g.id("c")], { type: "faction", playerId: P2 });
  g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [g.id("o")] });
  // Resolve the battle step by step, stopping at the first pending choice.
  autoResolveBattle(g.engine);
  const pc = pending(g.engine);
  assert.ok(pc, "the controller is asked whether to destroy the Rune instead");
  assert.equal(pc.playerId, P1);
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: declineAll(pc) } as never);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("c")), "discard", "declined: the character is destroyed");
  assert.equal(zoneOf(g.engine, g.id("r")), "play", "declined: the Rune stays");
});

clause(RUNE, "0:ability:protect", "two Runes on one character: each is 'the next time' once -- one lethal battle uses one Rune only", () => {
  const g = runeBoard({ rage: 4, extraRune: true });
  protect(g, "r");
  protect(g, "r2");
  lethalFight(g);
  assert.equal(zoneOf(g.engine, g.id("c")), "play");
  const used = ["r", "r2"].filter((k) => zoneOf(g.engine, g.id(k)) === "discard");
  assert.equal(used.length, 1, "exactly one Rune was used up");
});

clause(RUNE, "1:flipUp", "FLIP UP: 0 [E][E] -- costs nothing, needs [E][E] (its own icon doesn't count), turns the item face up", () => {
  const mk = (spentE: number, r = 0) =>
    game([
      { key: "r", def: printing(RUNE), owner: P1, zone: "play", faceDown: true },
      ...(spentE ? spent("elitism", spentE) : []),
      ...(r ? bank("rage", r, P1) : [])
    ]);
  const ok = mk(2, 0);
  const before = ready(ok);
  flip(ok, "r");
  assert.equal(card(ok, "r").faceDown === true, false, "face up");
  assert.equal(zoneOf(ok.engine, ok.id("r")), "play");
  assert.equal(ok.engine.getCardTypes(ok.id("r")).includes("item"), true);
  assert.equal(ready(ok), before - 1, "only the card itself stopped being a ready resource: nothing paid");
  const spare = mk(2, 3);
  const spareBefore = ready(spare); // 3 rage + the face-down card
  flip(spare, "r");
  assert.equal(ready(spare), spareBefore - 1, "ready rage untouched: the FLIP UP costs 0, so no resource is spent");
  const one = mk(1, 3);
  refused(() => flipRaw(one, "r"), "one [E] short", /FLIP UP threshold requirements are not met/);
  const none = mk(0, 3);
  refused(() => flipRaw(none, "r"), "no [E]");
});

// =============================================================================
// Runic Flee - tactic, gearsmith, cost 0, [E]
// Your faction loses 1 influence. Detach a resource from your faction. If you deployed this
// card using FLIP UP, you may pick a non-resource card. If you do, put a token on that card.
// FLIP UP: 1 [E] and you may play a resource.
// =============================================================================
const FLEE = "623e70e5-d4af-43d0-8163-1f0e12a7c485";
/**
 * The real card's FLIP UP can't be paid at all (finding seed-saga-07-p3-4: its cost is authored as an
 * array). To still pin the REST of the card's behavior, these helpers also build the same card with only
 * that one number repaired (cost 1). Tests using it say "(cost repaired)".
 */
const fleeRepaired = () => {
  const real = printing(FLEE) as unknown as { flipUp: Record<string, unknown> };
  return { ...real, flipUp: { ...real.flipUp, cost: 1 } } as unknown as ReturnType<typeof printing>;
};

function fleeBoard(o: { faceDown?: boolean; spentE?: number; spentR?: number; e?: number; r?: number; repaired?: boolean } = {}) {
  return game(
    [
      { key: "x", def: o.repaired ? fleeRepaired() : printing(FLEE), owner: P1, zone: o.faceDown ? "play" : "hand", ...(o.faceDown ? { faceDown: true } : {}) },
      { key: "c1", def: character({ name: "Chr" }), owner: P1, zone: "play" },
      { key: "oc", def: character({ name: "OppChr" }), owner: P2, zone: "play" },
      { key: "it", def: item({ name: "Itm" }), owner: P1, zone: "play" },
      { key: "hc", def: character({ name: "HandChr" }), owner: P1, zone: "hand" },
      { key: "hr", def: resourceCard({ name: "HandRes" }), owner: P1, zone: "hand" },
      ...(o.spentE ? spent("elitism", o.spentE) : []),
      ...(o.spentR ? spent("rage", o.spentR) : []),
      ...(o.e ? bank("elitism", o.e, P1) : []),
      ...(o.r ? bank("rage", o.r, P1) : [])
    ],
    { influence: 5 }
  );
}
const attachedRes = (g: G) => g.engine.state.players[P1].play.filter((c) => g.engine.state.cards[c].attachedTo && g.engine.isResource(c) && c !== g.id("x"));
type Declared = { kind: string; declaration?: { id: string }; cardIds?: string[] };

/** Answers the card's own prompts (detach "res", token "tok", resource "flipRes") and returns the declaration ids seen, in order. */
function fleeResolve(g: G, o: { detach?: string; token?: string | null; play?: string | null } = {}): string[] {
  const seen: string[] = [];
  let guard = 0;
  while (pending(g.engine) && guard++ < 10) {
    const pc = pending(g.engine) as unknown as Declared;
    const id = pc.declaration?.id ?? pc.kind;
    seen.push(id);
    if (id === "res") answerPending(g.engine, pc.kind, { selected: o.detach ? [o.detach] : attachedRes(g).slice(0, 1) });
    else if (id === "tok") answerPending(g.engine, pc.kind, { selected: o.token ? [g.id(o.token)] : [] });
    else if (id === "flipRes") answerPending(g.engine, pc.kind, { selected: o.play ? [g.id(o.play)] : [] });
    else throw new Error(`unexpected prompt ${pc.kind}/${id}`);
  }
  return seen;
}
const fleeCast = (g: G, o: Parameters<typeof fleeResolve>[1] = {}) => {
  play(g.engine, P1, g.id("x"), { selected: {} });
  return fleeResolve(g, o);
};
const fleeFlip = (g: G, o: Parameters<typeof fleeResolve>[1] = {}) => {
  flipRaw(g, "x", {});
  resolvePendingResponses(g.engine);
  return fleeResolve(g, o);
};

clause(FLEE, "0:rule", "printed: tactic, gearsmith, cost 0, threshold [E]; deployable for free with one [E] resource (spent or ready), refused with none", () => {
  const g = fleeBoard({ spentE: 1 });
  const def = g.engine.getDefinition(g.id("x"));
  assert.deepEqual([def.type, def.trade, def.cost, def.threshold], ["tactic", "gearsmith", 0, "e"]);
  fleeCast(g);
  assert.equal(zoneOf(g.engine, g.id("x")), "discard", "resolved");
  const none = fleeBoard({ spentR: 2, r: 2 });
  refused(() => fleeCast(none), "no [E] icon: threshold unmet");
  assert.equal(zoneOf(none.engine, none.id("x")), "hand");
  assert.equal(inf(none), 5, "a refused deploy changes nothing");
  const ready1 = fleeBoard({ e: 1 });
  fleeCast(ready1);
  assert.equal(zoneOf(ready1.engine, ready1.id("x")), "discard", "a ready [E] also meets the threshold");
  assert.equal(ready(ready1), 1, "cost 0: nothing was paid");
});

clause(FLEE, "0:rule", "your faction loses exactly 1 influence (the opponent's is unchanged)", () => {
  const g = fleeBoard({ spentE: 1 });
  const opp = inf(g, P2);
  fleeCast(g);
  assert.equal(inf(g), 4);
  assert.equal(inf(g, P2), opp);
});

clause(FLEE, "0:rule", "detaches exactly one resource attached to your faction (the chosen one becomes ready), and no other", () => {
  const g = fleeBoard({ spentE: 1, spentR: 2 });
  const [first, second, third] = attachedRes(g);
  assert.equal(attachedRes(g).length, 3);
  const readyBefore = ready(g);
  const seen = fleeCast(g, { detach: second });
  assert.deepEqual(seen, ["res"], "one detach prompt");
  assert.equal(attachedRes(g).length, 2, "exactly one detached");
  assert.equal(attachedRes(g).includes(second), false, "the chosen resource was detached");
  assert.equal(attachedRes(g).includes(first) && attachedRes(g).includes(third), true, "the others stay attached");
  assert.equal(ready(g), readyBefore + 1, "the detached resource is ready again");
});

clause(FLEE, "0:rule", "with a single attached resource that one is detached; with none attached nothing is asked", () => {
  const g = fleeBoard({ spentE: 1 });
  fleeCast(g);
  assert.equal(attachedRes(g).length, 0);
  const n = fleeBoard({ e: 1 });
  const seen = fleeCast(n);
  assert.deepEqual(seen, [], "nothing to detach, no prompt");
  assert.equal(inf(n), 4);
  assert.equal(zoneOf(n.engine, n.id("x")), "discard");
});

clause(FLEE, "0:rule", "only a resource attached to YOUR faction can be detached (not the opponent's)", () => {
  const g = game(
    [
      { key: "x", def: printing(FLEE), owner: P1, zone: "hand" },
      ...spent("elitism", 1),
      { key: "or", def: resourceCard({ name: "OppRes" }), owner: P2, zone: "play", attachedToKey: "__factionB" }
    ],
    { influence: 5 }
  );
  play(g.engine, P1, g.id("x"), { selected: {} });
  const pc = pending(g.engine) as unknown as Declared;
  assert.equal(pc.kind, "chooserSelectsTarget");
  refused(() => answerPending(g.engine, pc.kind, { selected: [g.id("or")] }), "the opponent's attached resource");
  answerPending(g.engine, pc.kind, { selected: attachedRes(g) });
  assert.equal(card(g, "or").attachedTo !== undefined && card(g, "or").attachedTo !== null, true, "opponent's resource still attached");
  assert.equal(attachedRes(g).length, 0);
});

clause(FLEE, "0:rule", "deployed normally (not via FLIP UP): no token pick is offered and no card gets a token", () => {
  const g = fleeBoard({ spentE: 1, spentR: 1 });
  const seen = fleeCast(g);
  assert.deepEqual(seen, ["res"], "only the detach prompt, no token pick");
  assert.equal(pending(g.engine), undefined);
  for (const k of ["c1", "oc", "it"]) assert.equal(tokensOn(g.engine, g.id(k)), 0);
});

clause(FLEE, "0:rule", "(cost repaired) deployed using FLIP UP: you may pick a non-resource card (any controller, character or item) and put one token on it", () => {
  for (const t of ["c1", "oc", "it"]) {
    const g = fleeBoard({ faceDown: true, spentE: 1, spentR: 1, r: 2, repaired: true });
    const seen = fleeFlip(g, { token: t });
    assert.deepEqual(seen, ["flipRes", "res", "tok"], "the FLIP UP resource play, then the detach prompt, then the token pick");
    assert.equal(tokensOn(g.engine, g.id(t)), 1, `${t} got exactly one token`);
    for (const other of ["c1", "oc", "it"].filter((k) => k !== t)) assert.equal(tokensOn(g.engine, g.id(other)), 0, `${other} untouched`);
  }
});

clause(FLEE, "0:rule", "(cost repaired) deployed using FLIP UP: the token pick is optional -- declining puts no token, the rest still happens", () => {
  const g = fleeBoard({ faceDown: true, spentE: 1, spentR: 1, r: 2, repaired: true });
  const [pick, keep] = attachedRes(g);
  const seen = fleeFlip(g, { token: null, detach: pick });
  assert.deepEqual(seen, ["flipRes", "res", "tok"]);
  for (const k of ["c1", "oc", "it"]) assert.equal(tokensOn(g.engine, g.id(k)), 0);
  assert.equal(inf(g), 4, "influence still lost");
  assert.equal(attachedRes(g).includes(pick), false, "the chosen resource was detached");
  assert.equal(attachedRes(g).includes(keep), true, "the other stays attached");
  assert.equal(zoneOf(g.engine, g.id("x")), "discard");
});

clause(FLEE, "0:rule", "(cost repaired) deployed using FLIP UP: still loses 1 influence and detaches exactly one resource", () => {
  const g = fleeBoard({ faceDown: true, spentE: 1, spentR: 2, r: 2, repaired: true });
  const [pick, k1, k2] = attachedRes(g);
  const opp = inf(g, P2);
  fleeFlip(g, { token: "c1", detach: pick });
  assert.equal(inf(g), 4);
  assert.equal(attachedRes(g).includes(pick), false, "exactly the chosen resource detached");
  assert.equal(attachedRes(g).includes(k1) && attachedRes(g).includes(k2), true, "the others stay attached");
  assert.equal(inf(g, P2), opp, "opponent unaffected");
});

clause(FLEE, "0:rule", "(cost repaired) the token can't be put on a resource card, and not on a card outside play", () => {
  const g = fleeBoard({ faceDown: true, spentE: 1, spentR: 1, r: 2, repaired: true });
  flipRaw(g, "x", {});
  const flipRes = pending(g.engine) as unknown as Declared;
  assert.equal(flipRes.declaration?.id, "flipRes", "FLIP UP's optional resource play comes first");
  answerPending(g.engine, flipRes.kind, { selected: [] });
  const det = pending(g.engine) as unknown as Declared;
  assert.equal(det.declaration?.id, "res");
  answerPending(g.engine, det.kind, { selected: attachedRes(g).slice(0, 1) });
  const tok = pending(g.engine) as unknown as Declared;
  assert.equal(tok.declaration?.id, "tok");
  const resource = g.engine.state.players[P1].play.find((c) => c !== g.id("x") && g.engine.isResource(c))!;
  refused(() => answerPending(g.engine, tok.kind, { selected: [resource] }), "a resource is not pickable");
  refused(() => answerPending(g.engine, tok.kind, { selected: [g.id("hc")] }), "a hand card is not pickable");
  answerPending(g.engine, tok.kind, { selected: [g.id("c1")] });
  assert.equal(tokensOn(g.engine, g.id("c1")), 1);
});

clause(FLEE, "0:rule", "(cost repaired) I make the detach pick and the token pick, and the token goes on ONE card only (two picked cards are refused)", () => {
  const g = fleeBoard({ faceDown: true, spentE: 1, spentR: 1, r: 2, repaired: true });
  flipRaw(g, "x", {});
  const flipRes = pending(g.engine) as unknown as Declared;
  assert.equal(flipRes.declaration?.id, "flipRes", "FLIP UP's optional resource play comes first");
  answerPending(g.engine, flipRes.kind, { selected: [] });
  const det = pending(g.engine) as unknown as Declared & { playerId: string };
  assert.equal(det.declaration?.id, "res");
  assert.equal(det.playerId, P1, "I pick which resource to detach");
  answerPending(g.engine, det.kind, { selected: attachedRes(g).slice(0, 1) });
  const tok = pending(g.engine) as unknown as Declared & { playerId: string };
  assert.equal(tok.declaration?.id, "tok");
  assert.equal(tok.playerId, P1, "I pick the card that gets the token");
  refused(() => answerPending(g.engine, tok.kind, { selected: [g.id("c1"), g.id("it")] }), "two cards picked for the token");
  for (const k of ["c1", "it", "oc"]) assert.equal(tokensOn(g.engine, g.id(k)), 0, `${k}: no token from a refused pick`);
  answerPending(g.engine, tok.kind, { selected: [g.id("c1")] });
  assert.equal(tokensOn(g.engine, g.id("c1")), 1, "one card gets the token");
  assert.equal(tokensOn(g.engine, g.id("it")), 0, "and only one");
});

clause(FLEE, "1:flipUp", "FLIP UP: 1 [E] -- the face-down tactic can be flipped up by paying 1 with an [E] in play", () => {
  const g = fleeBoard({ faceDown: true, spentE: 1, r: 2 });
  assert.equal(card(g, "x").faceDown, true);
  fleeFlip(g, { token: null });
  assert.equal(card(g, "x").faceDown === true, false);
  assert.equal(zoneOf(g.engine, g.id("x")), "discard", "resolved");
  assert.equal(inf(g), 4, "its rule ran");
});

clause(FLEE, "1:flipUp", "(cost repaired) FLIP UP: 1 [E] turns the tactic up, resolves its rule and costs 1", () => {
  const g = fleeBoard({ faceDown: true, spentE: 1, r: 2, repaired: true });
  assert.equal(card(g, "x").faceDown, true);
  fleeFlip(g, { token: null });
  assert.equal(card(g, "x").faceDown === true, false);
  assert.equal(zoneOf(g.engine, g.id("x")), "discard", "resolved");
  assert.equal(inf(g), 4, "its rule ran");
});

clause(FLEE, "1:flipUp", "(cost repaired) FLIP UP threshold [E]: refused with no [E] (its own icon doesn't count), allowed with a spent or ready [E]", () => {
  const none = fleeBoard({ faceDown: true, spentR: 1, r: 3, repaired: true });
  refused(() => flipRaw(none, "x"), "no [E] resource", /threshold/i);
  assert.equal(card(none, "x").faceDown, true);
  const spentOk = fleeBoard({ faceDown: true, spentE: 1, r: 3, repaired: true });
  fleeFlip(spentOk, { token: null });
  assert.equal(card(spentOk, "x").faceDown === true, false);
  const readyOk = fleeBoard({ faceDown: true, e: 1, r: 3, repaired: true });
  fleeFlip(readyOk, { token: null });
  assert.equal(card(readyOk, "x").faceDown === true, false);
});

clause(FLEE, "1:flipUp", "(cost repaired) FLIP UP cost is exactly 1: the card itself may pay it (alone it can), and a ready resource pays at most 1", () => {
  const alone = fleeBoard({ faceDown: true, spentE: 1, repaired: true });
  fleeFlip(alone, { token: null });
  assert.equal(card(alone, "x").faceDown === true, false, "itself pays 1 (CR 507.4b)");
  const g = fleeBoard({ faceDown: true, spentE: 1, r: 3, repaired: true });
  const before = ready(g); // 3 rage + the face-down card
  fleeFlip(g, { token: null });
  // 4 ready (3 rage + itself). The detach returns a spent resource (+1); the card leaves the pool (-1); exactly 1 is paid
  // (by a rage, or by the card itself, which is already leaving: either way 3 or 4 remain).
  const after = ready(g);
  assert.ok(after === before - 1 || after === before, `exactly 1 paid (ready ${before} -> ${after})`);
});

clause(FLEE, "1:flipUp", "(cost repaired) FLIP UP: 'and you may play a resource' -- a resource card from hand can be played, or declined", () => {
  const g = fleeBoard({ faceDown: true, spentE: 1, r: 2, repaired: true });
  const seen = fleeFlip(g, { token: null, play: "hr" });
  assert.equal(seen.includes("flipRes") || seen.includes("playResource"), true, "a resource play is offered");
  assert.equal(zoneOf(g.engine, g.id("hr")), "play", "the resource was played");
});

// =============================================================================
// Runic Reinforcement - tactic, gearsmith, cost 2, [E]
// EXTRA COST: Pick a character. -- This turn, the character gains 3 strength and 3 life.
// =============================================================================
const REINF = "0570cd0f-e466-461c-92cd-ad2897a2567f";

function reinfBoard(o: { e?: number; r?: number; spentE?: number } = {}) {
  return game([
    { key: "x", def: printing(REINF), owner: P1, zone: "hand" },
    { key: "c", def: character({ name: "Mine", strength: 2, speed: 3, life: 4 }), owner: P1, zone: "play" },
    { key: "c2", def: character({ name: "Mine2", strength: 1, speed: 1, life: 1 }), owner: P1, zone: "play" },
    { key: "oc", def: character({ name: "Theirs", strength: 4, speed: 2, life: 5 }), owner: P2, zone: "play" },
    { key: "it", def: item({ name: "Itm" }), owner: P1, zone: "play" },
    { key: "hc", def: character({ name: "HandChr" }), owner: P1, zone: "hand" },
    { key: "dc", def: character({ name: "DiscChr" }), owner: P1, zone: "discard" },
    ...(o.e ? bank("elitism", o.e, P1) : []),
    ...(o.r ? bank("rage", o.r, P1) : []),
    ...(o.spentE ? spent("elitism", o.spentE) : [])
  ]);
}
const reinfPlay = (g: G, pick = "c") => play(g.engine, P1, g.id("x"), { selected: { c: [g.id(pick)] } });

clause(REINF, "0:extraCost", "printed: tactic, gearsmith, cost 2, threshold [E]; deploys with 1 [E] + 1 other, pays 2", () => {
  const g = reinfBoard({ e: 1, r: 1 });
  const def = g.engine.getDefinition(g.id("x"));
  assert.deepEqual([def.type, def.trade, def.cost, def.threshold], ["tactic", "gearsmith", 2, "e"]);
  reinfPlay(g);
  assert.equal(zoneOf(g.engine, g.id("x")), "discard");
  assert.equal(ready(g), 0, "paid 2");
});

clause(REINF, "0:extraCost", "cost 2 is required: 1 ready resource is refused even with a spent [E] meeting the threshold", () => {
  const g = reinfBoard({ spentE: 1, r: 1 });
  refused(() => reinfPlay(g), "cost 2, only 1 ready");
  const ok = reinfBoard({ spentE: 1, r: 2 });
  reinfPlay(ok);
  assert.equal(ready(ok), 0);
});

clause(REINF, "0:extraCost", "threshold [E] is required: 2 resources without any [E] is refused", () => {
  const g = reinfBoard({ r: 2 });
  refused(() => reinfPlay(g), "no [E]");
  const ok = reinfBoard({ e: 1, r: 1 });
  reinfPlay(ok);
});

clause(REINF, "0:extraCost", "the extra cost picks a character in play: yours or an opponent's, not an item / hand / discard card", () => {
  for (const pick of ["c", "oc"]) {
    const g = reinfBoard({ e: 2 });
    reinfPlay(g, pick);
    assert.equal(zoneOf(g.engine, g.id("x")), "discard", `${pick} accepted`);
  }
  const g = reinfBoard({ e: 2 });
  refused(() => reinfPlay(g, "it"), "an item");
  refused(() => reinfPlay(g, "hc"), "a character in hand");
  refused(() => reinfPlay(g, "dc"), "a character in the discard pile");
  refused(() => play(g.engine, P1, g.id("x"), { selected: {} }), "no pick");
  refused(() => play(g.engine, P1, g.id("x"), { selected: { c: [g.id("c"), g.id("c2")] } }), "two characters");
  assert.equal(zoneOf(g.engine, g.id("x")), "hand");
  assert.equal(ready(g), 2, "refusals paid nothing");
});

clause(REINF, "1:rule", "the picked character gains exactly +3 strength and +3 life; speed is unchanged", () => {
  const g = reinfBoard({ e: 2 });
  assert.deepEqual([g.engine.getStat(g.id("c"), "strength"), g.engine.getStat(g.id("c"), "speed"), g.engine.getStat(g.id("c"), "life")], [2, 3, 4]);
  reinfPlay(g);
  assert.equal(g.engine.getStat(g.id("c"), "strength"), 5);
  assert.equal(g.engine.getStat(g.id("c"), "life"), 7);
  assert.equal(g.engine.getStat(g.id("c"), "speed"), 3);
});

clause(REINF, "1:rule", "only the picked character is boosted (mine, other mine, theirs)", () => {
  const g = reinfBoard({ e: 2 });
  reinfPlay(g, "c");
  assert.deepEqual([g.engine.getStat(g.id("c2"), "strength"), g.engine.getStat(g.id("c2"), "life")], [1, 1]);
  assert.deepEqual([g.engine.getStat(g.id("oc"), "strength"), g.engine.getStat(g.id("oc"), "life")], [4, 5]);
  const h = reinfBoard({ e: 2 });
  reinfPlay(h, "oc");
  assert.deepEqual([h.engine.getStat(h.id("oc"), "strength"), h.engine.getStat(h.id("oc"), "life"), h.engine.getStat(h.id("oc"), "speed")], [7, 8, 2]);
  assert.deepEqual([h.engine.getStat(h.id("c"), "strength"), h.engine.getStat(h.id("c"), "life")], [2, 4]);
});

clause(REINF, "1:rule", "'this turn': the bonus is gone after the turn ends", () => {
  const g = reinfBoard({ e: 2 });
  reinfPlay(g);
  assert.equal(g.engine.getStat(g.id("c"), "strength"), 5);
  endTurn(g.engine, P1);
  assert.equal(g.engine.getStat(g.id("c"), "strength"), 2);
  assert.equal(g.engine.getStat(g.id("c"), "life"), 4);
});

clause(REINF, "1:rule", "the extra life keeps the character alive through damage that would otherwise be lethal this turn", () => {
  const g = game([
    { key: "x", def: printing(REINF), owner: P1, zone: "hand" },
    { key: "c", def: character({ name: "Mine", strength: 2, speed: 3, life: 4 }), owner: P1, zone: "play" },
    { key: "zap", def: zap(6), owner: P1, zone: "hand" },
    ...bank("elitism", 2, P1)
  ]);
  reinfPlay(g);
  play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("c")] } });
  assert.equal(zoneOf(g.engine, g.id("c")), "play", "6 damage < 7 life");
  const h = game([
    { key: "c", def: character({ name: "Mine", strength: 2, speed: 3, life: 4 }), owner: P1, zone: "play" },
    { key: "zap", def: zap(6), owner: P1, zone: "hand" }
  ]);
  play(h.engine, P1, h.id("zap"), { selected: { t: [h.id("c")] } });
  assert.equal(zoneOf(h.engine, h.id("c")), "discard", "control: 6 damage kills a 4-life character");
});

// =============================================================================
// Runivoltaic Accumulator - item, gearsmith, cost 2, [E]
// When an opponent attacks, you may put a token on this card.
// ENERGIZE -- COST: Pay 2. -- EFFECT: Put a token on this card.
// DISCHARGE -- COST: Pick a character with numeric cost X or less, where X is the number of
// tokens on this card. Destroy this card. -- EFFECT: Destroy the character.
// =============================================================================
const ACC = "c21dbc74-cf52-4375-a701-14c5052cf13e";

function accBoard(o: { tokens?: number; rage?: number; copies?: number; active?: PlayerId; accOwner?: PlayerId } = {}) {
  const owner = o.accOwner ?? P1;
  return game(
    [
      { key: "a", def: printing(ACC), owner, zone: "play", ...(o.tokens ? { counters: { token: o.tokens } } : {}) },
      ...(o.copies && o.copies > 1 ? [{ key: "a2", def: printing(ACC), owner, zone: "play" as const }] : []),
      { key: "mine", def: character({ name: "MyAtk", strength: 1, speed: 1, life: 3 }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "TheirAtk", strength: 1, speed: 1, life: 3 }), owner: P2, zone: "play" },
      { key: "c0", def: character({ name: "Cost0", cost: 0 }), owner: P2, zone: "play" },
      { key: "c1", def: character({ name: "Cost1", cost: 1 }), owner: P2, zone: "play" },
      { key: "c2", def: character({ name: "Cost2", cost: 2 }), owner: P2, zone: "play" },
      { key: "c3", def: character({ name: "Cost3", cost: 3 }), owner: P2, zone: "play" },
      { key: "c4", def: character({ name: "Cost4", cost: 4 }), owner: P2, zone: "play" },
      { key: "mc3", def: character({ name: "MyCost3", cost: 3 }), owner: P1, zone: "play" },
      { key: "itm", def: item({ name: "Itm", cost: 1 }), owner: P2, zone: "play" },
      { key: "loc", def: location({ name: "MyLoc" }), owner: P1, zone: "play" },
      { key: "hc", def: character({ name: "HandChr", cost: 1 }), owner: P2, zone: "hand" },
      ...bank("rage", o.rage ?? 0, P1)
    ],
    { active: o.active }
  );
}
const energize = (g: G, key = "a") => activate(g.engine, P1, g.id(key), "energize", {});
const discharge = (g: G, target: string, key = "a") => activate(g.engine, P1, g.id(key), "discharge", { selected: { c: [g.id(target)] } });
const triggerChoice = (g: G) => pending(g.engine) as unknown as { kind: string; playerId: string; options?: unknown[] } | undefined;

clause(ACC, "0:rule", "printed: item, gearsmith, cost 2, threshold [E]; deployed with 1 [E] + 1 other, refused one short and with no [E]", () => {
  const mk = (e: number, r: number, spentE = 0) =>
    game([
      { key: "a", def: printing(ACC), owner: P1, zone: "hand" },
      ...bank("elitism", e, P1),
      ...bank("rage", r, P1),
      ...(spentE ? spent("elitism", spentE) : [])
    ]);
  const g = mk(1, 1);
  const def = g.engine.getDefinition(g.id("a"));
  assert.deepEqual([def.type, def.trade, def.cost, def.threshold], ["item", "gearsmith", 2, "e"]);
  play(g.engine, P1, g.id("a"));
  assert.equal(zoneOf(g.engine, g.id("a")), "play");
  assert.equal(ready(g), 0, "paid 2");
  const short = mk(1, 0);
  refused(() => play(short.engine, P1, short.id("a")), "cost 2 with 1 resource");
  const noE = mk(0, 2);
  refused(() => play(noE.engine, P1, noE.id("a")), "no [E]");
  const spentOnly = mk(0, 1, 1);
  refused(() => play(spentOnly.engine, P1, spentOnly.id("a")), "cost 2, only 1 ready (spent [E] meets the threshold only)", /Costs cannot be paid/);
});

clause(ACC, "0:rule", "when an opponent attacks you may put a token on it: accepting adds exactly one token", () => {
  const g = accBoard({ active: P2 });
  declareAttackBy(g.engine, P2, [g.id("theirs")], { type: "faction", playerId: P1 });
  const pc = triggerChoice(g);
  assert.ok(pc, "the controller is asked");
  assert.equal(pc.playerId, P1);
  answerPending(g.engine, pc.kind, { index: 1 });
  assert.equal(tokensOn(g.engine, g.id("a")), 1);
});

clause(ACC, "0:rule", "when an opponent attacks you may decline: no token", () => {
  const g = accBoard({ active: P2 });
  declareAttackBy(g.engine, P2, [g.id("theirs")], { type: "faction", playerId: P1 });
  const pc = triggerChoice(g);
  assert.ok(pc, "pc");
  answerPending(g.engine, pc.kind, { index: 0 });
  assert.equal(tokensOn(g.engine, g.id("a")), 0);
  assert.equal(pending(g.engine), undefined);
});

clause(ACC, "0:rule", "an attack on one of my locations also triggers it", () => {
  const g = accBoard({ active: P2 });
  declareAttackBy(g.engine, P2, [g.id("theirs")], { type: "card", cardId: g.id("loc") });
  const pc = triggerChoice(g);
  assert.ok(pc, "asked");
  answerPending(g.engine, pc.kind, { index: 1 });
  assert.equal(tokensOn(g.engine, g.id("a")), 1);
});

clause(ACC, "0:rule", "my own attack does not trigger it (no prompt, no token)", () => {
  const g = accBoard({ active: P1 });
  declareAttackBy(g.engine, P1, [g.id("mine")], { type: "faction", playerId: P2 });
  assert.equal(pending(g.engine), undefined);
  assert.equal(tokensOn(g.engine, g.id("a")), 0);
});

clause(ACC, "0:rule", "an Accumulator controlled by the attacker does not trigger when its controller attacks", () => {
  const g = accBoard({ active: P2, accOwner: P2 });
  declareAttackBy(g.engine, P2, [g.id("theirs")], { type: "faction", playerId: P1 });
  assert.equal(pending(g.engine), undefined);
  assert.equal(tokensOn(g.engine, g.id("a")), 0);
});

clause(ACC, "0:rule", "two Accumulators: both triggers resolve (ordered), each may add its own token", () => {
  const g = accBoard({ active: P2, copies: 2 });
  declareAttackBy(g.engine, P2, [g.id("theirs")], { type: "faction", playerId: P1 });
  let guard = 0;
  while (pending(g.engine) && guard++ < 10) {
    const pc = triggerChoice(g)!;
    if (pc.kind === "orderTriggers") {
      const p = pending(g.engine) as unknown as { triggers: unknown[] };
      g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: pc.kind, next: p.triggers[0] } } as never);
      resolvePendingResponses(g.engine);
    } else {
      answerPending(g.engine, pc.kind, { index: 1 });
    }
  }
  assert.equal(tokensOn(g.engine, g.id("a")), 1);
  assert.equal(tokensOn(g.engine, g.id("a2")), 1);
});

clause(ACC, "1:ability:energize", "ENERGIZE: pay 2, put a token on this card; each use adds one", () => {
  const g = accBoard({ rage: 4 });
  energize(g);
  assert.equal(tokensOn(g.engine, g.id("a")), 1);
  assert.equal(ready(g), 2, "paid exactly 2");
  energize(g);
  assert.equal(tokensOn(g.engine, g.id("a")), 2);
  assert.equal(ready(g), 0);
});

clause(ACC, "1:ability:energize", "ENERGIZE is refused with only 1 ready resource and puts no token", () => {
  const g = accBoard({ rage: 1 });
  refused(() => energize(g), "1 resource for pay 2");
  assert.equal(tokensOn(g.engine, g.id("a")), 0);
  const ok = accBoard({ rage: 2 });
  energize(ok);
  assert.equal(tokensOn(ok.engine, ok.id("a")), 1);
});

clause(ACC, "1:ability:energize", "ENERGIZE adds to existing tokens (not reset) and only to this card", () => {
  const g = accBoard({ rage: 2, tokens: 2, copies: 2 });
  energize(g);
  assert.equal(tokensOn(g.engine, g.id("a")), 3);
  assert.equal(tokensOn(g.engine, g.id("a2")), 0);
});

clause(ACC, "2:ability:discharge", "DISCHARGE: destroy this card (cost) and the picked character with cost <= tokens", () => {
  const g = accBoard({ tokens: 3 });
  discharge(g, "c3");
  assert.equal(zoneOf(g.engine, g.id("a")), "discard", "the Accumulator is destroyed as a cost");
  assert.equal(zoneOf(g.engine, g.id("c3")), "discard", "the character is destroyed");
  for (const k of ["c0", "c1", "c2", "c4", "mc3", "mine", "theirs"]) assert.equal(zoneOf(g.engine, g.id(k)), "play", `${k} untouched`);
  assert.equal(pending(g.engine), undefined);
});

clause(ACC, "2:ability:discharge", "X is the number of tokens: any cost 0..X is valid, X+1 is refused (X = 3)", () => {
  for (const t of ["c0", "c1", "c2", "c3"]) {
    const g = accBoard({ tokens: 3 });
    discharge(g, t);
    assert.equal(zoneOf(g.engine, g.id(t)), "discard", `${t} (cost <= 3) destroyed`);
    assert.equal(zoneOf(g.engine, g.id("a")), "discard");
  }
  const g = accBoard({ tokens: 3 });
  refused(() => discharge(g, "c4"), "cost 4 > 3 tokens");
  assert.equal(zoneOf(g.engine, g.id("a")), "play", "nothing was destroyed by the refusal");
  assert.equal(zoneOf(g.engine, g.id("c4")), "play");
});

clause(ACC, "2:ability:discharge", "X tracks the tokens: with 1 token cost 1 is OK and 2 is refused; with 4 tokens cost 4 is OK", () => {
  const one = accBoard({ tokens: 1 });
  refused(() => discharge(one, "c2"), "cost 2 > 1 token");
  discharge(one, "c1");
  assert.equal(zoneOf(one.engine, one.id("c1")), "discard");
  const four = accBoard({ tokens: 4 });
  discharge(four, "c4");
  assert.equal(zoneOf(four.engine, four.id("c4")), "discard");
});

clause(ACC, "2:ability:discharge", "with 0 tokens only a cost-0 character can be picked", () => {
  const g = accBoard({ tokens: 0 });
  refused(() => discharge(g, "c1"), "cost 1 > 0 tokens");
  discharge(g, "c0");
  assert.equal(zoneOf(g.engine, g.id("c0")), "discard");
  assert.equal(zoneOf(g.engine, g.id("a")), "discard");
});

clause(ACC, "2:ability:discharge", "the pick can be my own character too, but must be a character in play (not an item or a hand card)", () => {
  const g = accBoard({ tokens: 3 });
  discharge(g, "mc3");
  assert.equal(zoneOf(g.engine, g.id("mc3")), "discard");
  const h = accBoard({ tokens: 3 });
  refused(() => discharge(h, "itm"), "an item");
  refused(() => discharge(h, "hc"), "a character in hand");
  refused(() => activate(h.engine, P1, h.id("a"), "discharge", { selected: {} }), "no pick");
  assert.equal(zoneOf(h.engine, h.id("a")), "play");
});
