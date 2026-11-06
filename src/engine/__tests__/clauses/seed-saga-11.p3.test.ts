// Clause tests, batch seed-saga-11, part p3 (groups 13-16, missing clauses only):
// Chain Reaction, Conscientious Objector, Draconarius Slitherform, Dragon Archer.
// Every expectation is read from the PRINTED text.

import assert from "node:assert/strict";
import {
  buildGame,
  activate,
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
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import { fillers, pending, readyResources, zoneOf } from "./_board.js";
import { declareAttackBy, declareAttackOpenWindow, finishBattle, playRaw } from "./_battle.js";
import { spentResources } from "./_turn.js";
import type { CardPlacement } from "../support/fixtures.js";
import type { SpoilsEngine } from "../../SpoilsEngine.js";

const CR = "f84bb22e-e599-4eb5-88ed-03519f86366b"; // Chain Reaction
const CO = "191268f8-8737-4286-a8e6-1fb970eca821"; // Conscientious Objector
const DS = "b6a07adb-0334-454a-a8d4-019dabbdcc8b"; // Draconarius Slitherform
const DA = "e6c6a708-bb38-4de1-8a5f-d63e328ab4f8"; // Dragon Archer

type Choice = Parameters<typeof declineAll>[0];
type Cfg = Parameters<typeof buildGame>[0];

const mk = (cards: CardPlacement[], extra: Partial<NonNullable<Cfg>> = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    random: () => 0.5,
    cards,
    ...extra
  } as never);
type B = ReturnType<typeof mk>;

const START_INFLUENCE = 30;
const fdmg = (e: SpoilsEngine, p: typeof P1 | typeof P2) => START_INFLUENCE - e.state.players[p].influence; // faction damage = lost influence
const dmg = (b: B, key: string) => b.engine.state.cards[b.id(key)].damage ?? 0;
const hand = (e: SpoilsEngine, p: typeof P1 | typeof P2) => [...e.state.players[p].hand];
const noPending = (b: B) => assert.equal(b.engine.state.pendingChoice, undefined, "no pending choice is open");

const pickTargets = (b: B, ids: string[]) => {
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: ids } } as never);
  resolvePendingResponses(b.engine);
};
const distribute = (shares: Record<string, number>) => (pc: Choice) =>
  pc.kind === "distributeAmong" ? { kind: "distributeAmong", shares } : declineAll(pc);
const flip = (e: SpoilsEngine, p: typeof P1 | typeof P2, cardId: string, selected: Record<string, string[]> = {}) =>
  flipUpNow(e, { type: "flipUp", playerId: p, cardId, selected, variables: {} });

const killTactic = (name: string, kind: "character" | "location") =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "k",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: kind }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 99 }]
        }
      ]
    }
  } as never);
const buffItem = (name: string, value: number) =>
  item({
    name,
    attachTo: "character",
    behavior: { abilities: [{ id: "buff", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value }] }] }
  } as never);

// ===================================================================
// Chain Reaction
// ===================================================================

interface CrOpts {
  locStructure?: number;
  locDamage?: number;
  foeLife?: number;
  foeDamage?: number;
  rage?: number;
  noChars?: boolean;
  extra?: CardPlacement[];
}
const crBoard = (o: CrOpts = {}) =>
  mk([
    { key: "cr", def: printing(CR), owner: P1, zone: "hand" },
    { key: "loc", def: location({ name: "Loc", structure: o.locStructure ?? 3 }), owner: P2, zone: "play", damage: o.locDamage },
    { key: "myloc", def: location({ name: "MyLoc", structure: 5 }), owner: P1, zone: "play" },
    ...(o.noChars
      ? []
      : ([
          { key: "foe", def: character({ name: "Foe", life: o.foeLife ?? 3 }), owner: P2, zone: "play", damage: o.foeDamage },
          { key: "ally", def: character({ name: "Ally", life: o.foeLife ?? 3 }), owner: P1, zone: "play" },
          { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play" }
        ] as CardPlacement[])),
    { key: "dis", def: location({ name: "DisLoc" }), owner: P2, zone: "discard" },
    ...fillers("p1d", 3, P1, "deck"),
    ...fillers("p2d", 3, P2, "deck"),
    ...bank("rage", o.rage ?? 1, P1),
    ...(o.extra ?? [])
  ]);
const crCast = (b: B, loc = "loc") => play(b.engine, P1, b.id("cr"), { selected: { l: [b.id(loc)] } });
/** Cast and, if the location died and I am asked for a character, decline. */
const crCastDone = (b: B, loc = "loc") => {
  crCast(b, loc);
  if (pending(b.engine)?.kind === "chooserSelectsTarget") pickTargets(b, []);
};

clause(CR, "0:extraCost", "is a tactic costing 0 with threshold [R]; plays with one [R] resource, refused with none or with only other icons", () => {
  const p = printing(CR);
  assert.equal(p.type, "tactic");
  assert.equal(p.cost, 0);
  assert.equal(p.threshold, "r");
  const ok = crBoard();
  crCastDone(ok);
  assert.equal(zoneOf(ok.engine, ok.id("cr")), "discard", "positive control: with [R] it resolves");
  const none = crBoard({ rage: 0 });
  refused(() => crCast(none), "no resources at all");
  const wrong = crBoard({ rage: 0, extra: bank("greed", 3, P1) });
  refused(() => crCast(wrong), "only [G] resources do not meet threshold [R]");
});

clause(CR, "0:extraCost", "costs nothing to play: no resource is spent", () => {
  const b = crBoard({ rage: 2 });
  const before = readyResources(b.engine, P1);
  crCastDone(b);
  assert.equal(readyResources(b.engine, P1), before, "cost 0 spends no resource");
});

clause(CR, "0:extraCost", "the cost is picking a location: no pick is refused", () => {
  const b = crBoard();
  refused(() => play(b.engine, P1, b.id("cr"), {}), "no location picked");
  assert.equal(zoneOf(b.engine, b.id("cr")), "hand", "the card is still in hand");
  assert.equal(dmg(b, "loc"), 0);
  crCastDone(b); // positive control
  assert.equal(zoneOf(b.engine, b.id("cr")), "discard");
});

clause(CR, "0:extraCost", "the picked location may be any player's: an opponent's and my own both work", () => {
  const theirs = crBoard();
  crCastDone(theirs, "loc");
  assert.equal(zoneOf(theirs.engine, theirs.id("loc")), "discard", "opponent's location destroyed");
  const mine = crBoard({ extra: [{ key: "myloc2", def: location({ name: "MyLoc2", structure: 3 }), owner: P1, zone: "play" }] });
  crCastDone(mine, "myloc2");
  assert.equal(zoneOf(mine.engine, mine.id("myloc2")), "discard", "my own location is a legal pick and takes the damage");
  assert.equal(dmg(mine, "loc"), 0, "the other location is untouched");
});

clause(CR, "0:extraCost", "only a location in play can be picked: characters, items and out-of-play locations are refused", () => {
  const b = crBoard();
  refused(() => crCast(b, "foe"), "a character is not a location");
  refused(() => crCast(b, "ally"), "my character is not a location");
  refused(() => crCast(b, "gear"), "an item is not a location");
  refused(() => crCast(b, "dis"), "a location in the discard pile is not in play");
  assert.equal(zoneOf(b.engine, b.id("cr")), "hand");
  crCastDone(b); // positive control
  assert.equal(zoneOf(b.engine, b.id("cr")), "discard");
});

clause(CR, "1:rule", "inflicts 3 damage to the location and destroys it when it has structure 3", () => {
  const b = crBoard({ locStructure: 3 });
  crCastDone(b);
  assert.equal(zoneOf(b.engine, b.id("loc")), "discard", "3 damage destroys structure 3");
  assert.equal(zoneOf(b.engine, b.id("cr")), "discard", "the tactic is discarded after resolving");
});

clause(CR, "1:rule", "a location that survives the 3 damage keeps the damage and nothing else happens (no pick, no faction damage, no draw)", () => {
  const b = crBoard({ locStructure: 4 });
  const handBefore = hand(b.engine, P1);
  crCast(b);
  noPending(b);
  assert.equal(zoneOf(b.engine, b.id("loc")), "play", "structure 4 survives 3 damage");
  assert.equal(dmg(b, "loc"), 3, "exactly 3 damage inflicted");
  assert.equal(dmg(b, "foe"), 0, "no character was damaged");
  assert.equal(dmg(b, "ally"), 0);
  assert.equal(fdmg(b.engine, P2), 0, "no faction damage");
  assert.equal(hand(b.engine, P1).length, handBefore.length - 1, "no card drawn (only the tactic left the hand)");
});

clause(CR, "1:rule", "damage already on the location counts: structure 4 with 1 damage is destroyed by the 3", () => {
  const b = crBoard({ locStructure: 4, locDamage: 1 });
  crCast(b);
  assert.equal(zoneOf(b.engine, b.id("loc")), "discard");
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "destroyed by that damage, so I may pick a character");
});

clause(CR, "1:rule", "a location with structure 2 is destroyed too", () => {
  const b = crBoard({ locStructure: 2 });
  crCast(b);
  assert.equal(zoneOf(b.engine, b.id("loc")), "discard");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
});

clause(CR, "1:rule", "when the location is destroyed its controller-of-the-tactic (me) may pick a character", () => {
  const b = crBoard();
  crCast(b);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1, "I choose");
  pickTargets(b, [b.id("foe")]);
  noPending(b);
  assert.equal(dmg(b, "foe"), 2, "2 damage inflicted to the picked character");
});

clause(CR, "1:rule", "the picked character can be mine as well as the opponent's", () => {
  const b = crBoard();
  crCast(b);
  pickTargets(b, [b.id("ally")]);
  assert.equal(dmg(b, "ally"), 2);
  assert.equal(dmg(b, "foe"), 0);
});

clause(CR, "1:rule", "only a character may be picked: items and locations are refused", () => {
  const b = crBoard();
  crCast(b);
  refused(() => pickTargets(b, [b.id("gear")]), "an item is not a character");
  refused(() => pickTargets(b, [b.id("myloc")]), "a location is not a character");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the choice is still open");
  pickTargets(b, [b.id("foe")]); // positive control
  assert.equal(dmg(b, "foe"), 2);
});

clause(CR, "0:extraCost", "is a warlord tactic with no character stats and no subtype", () => {
  const b = crBoard();
  const def = b.engine.getDefinition(b.id("cr"));
  assert.equal(def.type, "tactic", "printed type is tactic");
  assert.equal(def.trade, "warlord", "printed trade is warlord");
  assert.deepEqual([...(def.subtype ?? [])], [], "no printed subtype");
});

clause(CR, "1:rule", "'you may pick a character': only ONE character may be picked, two are refused", () => {
  const b = crBoard();
  crCast(b);
  refused(() => pickTargets(b, [b.id("foe"), b.id("ally")]), "a second character is not allowed");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the choice is still open");
  pickTargets(b, [b.id("foe")]);
  assert.equal(dmg(b, "foe"), 2, "positive control: one pick works");
  assert.equal(dmg(b, "ally"), 0, "the other character was not hit");
});

clause(CR, "1:rule", "picking the character is optional (\"you may\"): declining deals no character damage, no faction damage, no draw", () => {
  const b = crBoard({ foeLife: 2 });
  const handBefore = hand(b.engine, P1);
  crCast(b);
  pickTargets(b, []);
  noPending(b);
  assert.equal(dmg(b, "foe"), 0);
  assert.equal(dmg(b, "ally"), 0);
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  assert.equal(fdmg(b.engine, P2), 0);
  assert.equal(hand(b.engine, P1).length, handBefore.length - 1, "nothing drawn");
});

clause(CR, "1:rule", "a character that survives the 2 damage (life 3): no faction damage and no draw", () => {
  const b = crBoard({ foeLife: 3 });
  const handBefore = hand(b.engine, P1);
  crCast(b);
  pickTargets(b, [b.id("foe")]);
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  assert.equal(fdmg(b.engine, P2), 0, "not destroyed, so no faction damage");
  assert.equal(hand(b.engine, P1).length, handBefore.length - 1, "not destroyed, so no draw");
});

clause(CR, "1:rule", "a character destroyed by the 2 damage (life 2): 1 damage to the opponent's faction and I draw a card", () => {
  const b = crBoard({ foeLife: 2 });
  const top = b.engine.state.players[P1].deck[0];
  const handBefore = hand(b.engine, P1);
  const deckBefore = b.engine.state.players[P1].deck.length;
  const p2HandBefore = hand(b.engine, P2).length;
  crCast(b);
  pickTargets(b, [b.id("foe")]);
  noPending(b);
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard", "destroyed");
  assert.equal(fdmg(b.engine, P2), 1, "exactly 1 damage to the opponent's faction");
  assert.equal(fdmg(b.engine, P1), 0, "my own faction is not damaged");
  assert.equal(hand(b.engine, P1).length, handBefore.length, "tactic left, one card drawn");
  assert.ok(hand(b.engine, P1).includes(top), "the top card of MY deck was drawn");
  assert.equal(b.engine.state.players[P1].deck.length, deckBefore - 1, "exactly one card drawn");
  assert.equal(hand(b.engine, P2).length, p2HandBefore, "the opponent drew nothing");
});

clause(CR, "1:rule", "prior damage counts for the character too: life 3 with 1 damage is destroyed by the 2", () => {
  const b = crBoard({ foeLife: 3, foeDamage: 1 });
  crCast(b);
  pickTargets(b, [b.id("foe")]);
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard");
  assert.equal(fdmg(b.engine, P2), 1);
});

clause(CR, "1:rule", "a destroyed character of MINE still damages the OPPONENT's faction (not mine) and I draw", () => {
  const b = crBoard({ foeLife: 2 });
  const handBefore = hand(b.engine, P1).length;
  crCast(b);
  pickTargets(b, [b.id("ally")]);
  assert.equal(zoneOf(b.engine, b.id("ally")), "discard");
  assert.equal(fdmg(b.engine, P2), 1);
  assert.equal(fdmg(b.engine, P1), 0);
  assert.equal(hand(b.engine, P1).length, handBefore, "drew a card");
  assert.equal(dmg(b, "foe"), 0, "the other character is untouched");
});

clause(CR, "1:rule", "character life 1 is destroyed by the 2 damage as well", () => {
  const b = crBoard({ foeLife: 1 });
  crCast(b);
  pickTargets(b, [b.id("foe")]);
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard");
  assert.equal(fdmg(b.engine, P2), 1);
});

clause(CR, "1:rule", "with no characters in play the tactic still resolves, with no damage to the faction and no draw", () => {
  const b = crBoard({ noChars: true });
  const handBefore = hand(b.engine, P1).length;
  crCast(b);
  drain(b.engine, declineAll);
  noPending(b);
  assert.equal(zoneOf(b.engine, b.id("loc")), "discard");
  assert.equal(fdmg(b.engine, P2), 0);
  assert.equal(hand(b.engine, P1).length, handBefore - 1);
});

const flipBoard = (cards: CardPlacement[], active = P1 as typeof P1 | typeof P2, foeLife = 3) =>
  mk(
    [
      { key: "cr", def: printing(CR), owner: P1, zone: "play", faceDown: true },
      { key: "foe", def: character({ name: "Foe", life: foeLife }), owner: P2, zone: "play" },
      { key: "loc", def: location({ name: "Loc", structure: 3 }), owner: P2, zone: "play" },
      ...fillers("p1d", 3, P1, "deck"),
      ...cards
    ],
    { activePlayerId: active }
  );
const flipCr = (b: B, p: typeof P1 | typeof P2 = P1) => {
  flip(b.engine, p, b.id("cr"), { l: [b.id("loc")] });
  resolvePendingResponses(b.engine);
};
const crSpent = () => spentResources(P1, 1);

clause(CR, "2:flipUp", "FLIP UP plays it from face-down as a resource: pays 1 (the card itself, with [R] attached for the threshold) and resolves the rule on the picked location", () => {
  const b = flipBoard(crSpent());
  flipCr(b);
  assert.equal(zoneOf(b.engine, b.id("loc")), "discard", "the 3 damage destroyed the picked location");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "its rule text ran: I may pick a character");
  assert.equal(zoneOf(b.engine, b.id("cr")) === "play" && b.engine.state.cards[b.id("cr")].faceDown === true, false, "it is no longer a face-down resource");
  pickTargets(b, [b.id("foe")]);
  assert.equal(dmg(b, "foe"), 2);
  assert.equal(zoneOf(b.engine, b.id("cr")), "discard", "a tactic ends in the discard pile");
});

clause(CR, "2:flipUp", "FLIP UP with ready [R] resources works and the cost is paid", () => {
  const b = flipBoard(bank("rage", 3, P1));
  const before = readyResources(b.engine, P1);
  flipCr(b);
  assert.equal(zoneOf(b.engine, b.id("loc")), "discard");
  pickTargets(b, []);
  const after = readyResources(b.engine, P1);
  assert.ok(before - after >= 0 && before - after <= 2, `ready count ${before} -> ${after} (the flipped card itself was one of the ready resources)`);
});

clause(CR, "2:flipUp", "FLIP UP then resolves a full chain: destroying a character draws a card and hits the opponent's faction", () => {
  const b = flipBoard(crSpent(), P1, 2);
  const top = b.engine.state.players[P1].deck[0];
  flipCr(b);
  pickTargets(b, [b.id("foe")]);
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard");
  assert.equal(fdmg(b.engine, P2), 1);
  assert.ok(hand(b.engine, P1).includes(top), "drew the top card");
});

clause(CR, "2:flipUp", "FLIP UP needs the [R] threshold: ready [G] resources alone are refused (with [R] attached it works)", () => {
  const b = flipBoard(bank("greed", 3, P1));
  refused(() => flipCr(b), "threshold [R] not met");
  assert.equal(b.engine.state.cards[b.id("cr")].faceDown, true);
  assert.equal(zoneOf(b.engine, b.id("loc")), "play");
  const ok = flipBoard([...bank("greed", 1, P1), ...crSpent()]);
  flipCr(ok);
  assert.equal(zoneOf(ok.engine, ok.id("loc")), "discard", "positive control: [R] attached + 1 ready");
});

clause(CR, "2:flipUp", "FLIP UP: the face-down card alone (no [R] anywhere) does not meet the [R] threshold", () => {
  const b = flipBoard([]);
  refused(() => flipCr(b), "no [R] resource");
  assert.equal(b.engine.state.cards[b.id("cr")].faceDown, true);
});

clause(CR, "2:flipUp", "FLIP UP still needs its location pick (the card's extra cost)", () => {
  const b = flipBoard(crSpent());
  refused(() => flip(b.engine, P1, b.id("cr")), "no location picked");
  refused(() => flip(b.engine, P1, b.id("cr"), { l: [b.id("foe")] }), "a character is not a location");
  assert.equal(b.engine.state.cards[b.id("cr")].faceDown, true);
  flipCr(b); // positive control
  assert.equal(zoneOf(b.engine, b.id("loc")), "discard");
});

clause(CR, "2:flipUp", "only the controller can FLIP UP it", () => {
  const b = flipBoard([...bank("rage", 2, P1), ...bank("rage", 2, P2)]);
  refused(() => flipCr(b, P2), "the opponent cannot flip my card");
  assert.equal(b.engine.state.cards[b.id("cr")].faceDown, true);
  flipCr(b);
  assert.equal(zoneOf(b.engine, b.id("loc")), "discard");
});

clause(CR, "2:flipUp", "it is a tactic, so it can be flipped up inside the opponent's response window", () => {
  const b = mk(
    [
      { key: "cr", def: printing(CR), owner: P1, zone: "play", faceDown: true },
      { key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" },
      { key: "loc", def: location({ name: "Loc", structure: 3 }), owner: P2, zone: "play" },
      ...bank("rage", 3, P1)
    ],
    { activePlayerId: P2 }
  );
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  flip(b.engine, P1, b.id("cr"), { l: [b.id("loc")] });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("loc")), "discard", "tactics may be flipped up in a window");
});

// ===================================================================
// Conscientious Objector
// ===================================================================

interface CoOpts {
  rage?: number;
  extra?: CardPlacement[];
}
const coBoard = (o: CoOpts = {}) =>
  mk([
    { key: "co", def: printing(CO), owner: P1, zone: "hand" },
    { key: "loc1", def: location({ name: "Loc1" }), owner: P1, zone: "play" },
    { key: "loc2", def: location({ name: "Loc2" }), owner: P1, zone: "play" },
    { key: "oloc", def: location({ name: "OLoc" }), owner: P2, zone: "play" },
    { key: "ally", def: character({ name: "Ally", strength: 2, life: 4 }), owner: P1, zone: "play" },
    { key: "foe", def: character({ name: "Foe", strength: 1, life: 6 }), owner: P2, zone: "play" },
    { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
    { key: "k1", def: killTactic("KillLoc1", "location"), owner: P1, zone: "hand" },
    { key: "k2", def: killTactic("KillLoc2", "location"), owner: P1, zone: "hand" },
    ...bank("rage", o.rage ?? 6, P1),
    ...(o.extra ?? [])
  ]);
const coCast = (b: B, loc = "loc1") => play(b.engine, P1, b.id("co"), { selected: { anchor: [b.id(loc)] } });
const eligible = (b: B, key: string) => {
  b.engine.state.cards[b.id(key)].attackEligibleTurn = b.engine.state.turn;
};

clause(CO, "0:kw:TACTICAL", "is a 6/3/6 pacifist warlord character costing 2 [R][R] with TACTICAL", () => {
  const p = printing(CO);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "warlord");
  assert.deepEqual([...(p.subtype ?? [])], ["pacifist"]);
  assert.equal(p.cost, 2);
  assert.equal(p.threshold, "rr");
  const b = coBoard();
  coCast(b);
  assert.equal(b.engine.getStat(b.id("co"), "strength"), 6);
  assert.equal(b.engine.getStat(b.id("co"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("co"), "life"), 6);
  assert.ok(b.engine.getKeywords(b.id("co")).includes("tactical"), "b.engine.getKeywords(b.id(\"co\")).includes(\"tactical\")");
});

clause(CO, "0:kw:TACTICAL", "deploys with exactly 2 [R][R]; refused one resource short and one [R] short", () => {
  const exact = coBoard({ rage: 2 });
  coCast(exact);
  assert.equal(zoneOf(exact.engine, exact.id("co")), "play");
  const oneShort = coBoard({ rage: 1 });
  refused(() => coCast(oneShort), "cost 2 with only 1 resource");
  assert.equal(zoneOf(oneShort.engine, oneShort.id("co")), "hand");
  const iconShort = coBoard({ rage: 1, extra: bank("greed", 1, P1) });
  refused(() => coCast(iconShort), "2 resources but only one [R]");
  // isolate the cost with already-spent [R]: threshold met, cost not
  const costShort = coBoard({ rage: 0, extra: [...spentResources(P1, 2), ...bank("rage", 1, P1)] });
  refused(() => coCast(costShort), "threshold met by spent resources but only 1 ready for cost 2", /Costs cannot be paid/);
  const costOk = coBoard({ rage: 0, extra: [...spentResources(P1, 2), ...bank("rage", 2, P1)] });
  coCast(costOk);
  assert.equal(zoneOf(costOk.engine, costOk.id("co")), "play");
});

clause(CO, "0:kw:TACTICAL", "TACTICAL: it can be deployed in response to the opponent's attack, which an ordinary character cannot", () => {
  const mkWin = (def: ReturnType<typeof printing>) => {
    const b = mk(
      [
        { key: "c", def, owner: P1, zone: "hand" },
        { key: "loc1", def: location({ name: "Loc1" }), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 1 }), owner: P2, zone: "play" },
        ...bank("rage", 4, P1)
      ],
      { activePlayerId: P2 }
    );
    declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
    return b;
  };
  const plain = mkWin(character({ name: "Plain", cost: 1 }) as never);
  refused(() => playRaw(plain.engine, P1, plain.id("c"), {}), "an ordinary character cannot be deployed in a window");
  const tac = mkWin(printing(CO));
  playRaw(tac.engine, P1, tac.id("c"), { selected: { anchor: [tac.id("loc1")] } });
  resolvePendingResponses(tac.engine);
  assert.equal(zoneOf(tac.engine, tac.id("c")), "play", "TACTICAL character was deployed during the opponent's window");
});

clause(CO, "1:extraCost", "the cost is picking a location I control: none is refused", () => {
  const b = coBoard();
  refused(() => play(b.engine, P1, b.id("co"), {}), "no location picked");
  assert.equal(zoneOf(b.engine, b.id("co")), "hand");
  coCast(b);
  assert.equal(zoneOf(b.engine, b.id("co")), "play");
});

clause(CO, "1:extraCost", "any location I control can be picked (either of two)", () => {
  const a = coBoard();
  coCast(a, "loc1");
  assert.equal(zoneOf(a.engine, a.id("co")), "play");
  const c = coBoard();
  coCast(c, "loc2");
  assert.equal(zoneOf(c.engine, c.id("co")), "play");
});

clause(CO, "1:extraCost", "an opponent's location cannot be picked", () => {
  const b = coBoard();
  refused(() => coCast(b, "oloc"), "location I do not control");
  assert.equal(zoneOf(b.engine, b.id("co")), "hand");
});

clause(CO, "1:extraCost", "only locations can be picked: characters and items are refused", () => {
  const b = coBoard();
  refused(() => coCast(b, "ally"), "a character is not a location");
  refused(() => coCast(b, "gear"), "an item is not a location");
  assert.equal(zoneOf(b.engine, b.id("co")), "hand");
});

clause(CO, "1:extraCost", "a location not in play (in my discard pile) cannot be picked", () => {
  const b = coBoard({ extra: [{ key: "dloc", def: location({ name: "DLoc" }), owner: P1, zone: "discard" }] });
  refused(() => coCast(b, "dloc"), "location in the discard pile");
  assert.equal(zoneOf(b.engine, b.id("co")), "hand");
});

clause(CO, "2:rule", "while the picked location is in play, this card cannot attack", () => {
  const b = coBoard();
  coCast(b);
  eligible(b, "co");
  refused(() => declareAttackBy(b.engine, P1, [b.id("co")]), "cannot attack with the picked location in play", /cannot attack/i);
  assert.equal(b.engine.state.battle, undefined);
  // control: my other character can attack
  declareAttackBy(b.engine, P1, [b.id("ally")]);
  assert.ok(b.engine.state.battle, "the ally's attack is a legal attack");
});

clause(CO, "2:rule", "while the picked location is in play, it cannot be in an attacking party with another character", () => {
  const b = coBoard();
  coCast(b);
  eligible(b, "co");
  refused(() => declareAttackBy(b.engine, P1, [b.id("ally"), b.id("co")]), "a party containing it is illegal", /cannot attack/i);
  assert.equal(b.engine.state.battle, undefined);
  assert.equal(b.engine.state.cards[b.id("ally")].depleted, false, "nothing was depleted by the rejected declaration");
});

clause(CO, "2:rule", "once the picked location leaves play, this card can attack", () => {
  const b = coBoard();
  coCast(b);
  eligible(b, "co");
  play(b.engine, P1, b.id("k1"), { selected: { t: [b.id("loc1")] } });
  assert.equal(zoneOf(b.engine, b.id("loc1")), "discard", "the picked location is destroyed");
  declareAttackBy(b.engine, P1, [b.id("co")]);
  assert.ok(b.engine.state.battle, "it attacked");
});

clause(CO, "2:rule", "a different location leaving play does not free it (only the PICKED one counts)", () => {
  const b = coBoard();
  coCast(b, "loc1");
  eligible(b, "co");
  play(b.engine, P1, b.id("k2"), { selected: { t: [b.id("loc2")] } });
  assert.equal(zoneOf(b.engine, b.id("loc2")), "discard");
  assert.equal(zoneOf(b.engine, b.id("loc1")), "play");
  refused(() => declareAttackBy(b.engine, P1, [b.id("co")]), "picked location is still in play", /cannot attack/i);
});

clause(CO, "2:rule", "the restriction does not come back once the location is gone, even if another location enters later", () => {
  const b = coBoard({ extra: [{ key: "loc3", def: location({ name: "Loc3", cost: 0 }), owner: P1, zone: "hand" }] });
  coCast(b, "loc1");
  eligible(b, "co");
  play(b.engine, P1, b.id("k1"), { selected: { t: [b.id("loc1")] } });
  play(b.engine, P1, b.id("loc3"));
  assert.equal(zoneOf(b.engine, b.id("loc3")), "play");
  declareAttackBy(b.engine, P1, [b.id("co")]);
  assert.ok(b.engine.state.battle, "b.engine.state.battle");
});

clause(CO, "2:rule", "it also cannot block while the picked location is in play, but my other characters can", () => {
  // The anchor only exists when it was picked as part of the deploy; deploy it at instant speed in the attack window.
  const build = (destroyFirst: boolean) => {
    const b = mk(
      [
        { key: "co", def: printing(CO), owner: P1, zone: "hand" },
        { key: "loc1", def: location({ name: "Loc1" }), owner: P1, zone: "play" },
        { key: "ally", def: character({ name: "Ally", life: 4 }), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 1, life: 5 }), owner: P2, zone: "play" },
        { key: "kloc", def: killTactic("KillLoc", "location"), owner: P2, zone: "hand" },
        ...bank("rage", 3, P1),
        ...bank("rage", 3, P2)
      ],
      { activePlayerId: P2 }
    );
    declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
    playRaw(b.engine, P1, b.id("co"), { selected: { anchor: [b.id("loc1")] } });
    if (destroyFirst) {
      // the opponent responds to my Objector by destroying the picked location
      playRaw(b.engine, P2, b.id("kloc"), { selected: { t: [b.id("loc1")] } });
    }
    resolvePendingResponses(b.engine);
    assert.equal(zoneOf(b.engine, b.id("co")), "play");
    assert.equal(zoneOf(b.engine, b.id("loc1")), destroyFirst ? "discard" : "play");
    return b;
  };
  const restricted = build(false);
  refused(() => restricted.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [restricted.id("co")] }), "cannot block with the picked location in play", /cannot block/i);
  restricted.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [restricted.id("ally")] });
  assert.ok(restricted.engine.state.battle, "control: the ally may block");
  const freed = build(true);
  freed.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [freed.id("co")] });
  assert.ok(freed.engine.state.battle, "with the picked location gone it may block");
});

const coFlipBoard = (cards: CardPlacement[], active = P1 as typeof P1 | typeof P2) =>
  mk(
    [
      { key: "co", def: printing(CO), owner: P1, zone: "play", faceDown: true },
      { key: "loc1", def: location({ name: "Loc1" }), owner: P1, zone: "play" },
      { key: "oloc", def: location({ name: "OLoc" }), owner: P2, zone: "play" },
      { key: "kloc", def: killTactic("KillLoc", "location"), owner: P1, zone: "hand" },
      ...cards
    ],
    { activePlayerId: active }
  );
const flipCo = (b: B, loc = "loc1", p: typeof P1 | typeof P2 = P1) => {
  flip(b.engine, p, b.id("co"), { anchor: [b.id(loc)] });
  resolvePendingResponses(b.engine);
};
const coUp = (b: B) => b.engine.state.cards[b.id("co")].faceDown !== true && zoneOf(b.engine, b.id("co")) === "play";

clause(CO, "3:flipUp", "FLIP UP costs 2 [R][R]: exact (spent [R][R] + one other ready + itself) plays it face up", () => {
  const b = coFlipBoard([...spentResources(P1, 2), ...bank("greed", 1, P1)]);
  flipCo(b);
  assert.equal(coUp(b), true, "flipped up and in play");
  noPending(b);
});

clause(CO, "3:flipUp", "FLIP UP is refused one short of the cost (threshold met by spent [R][R], only itself can pay)", () => {
  const b = coFlipBoard(spentResources(P1, 2));
  refused(() => flipCo(b), "cost 2 but only the card itself can pay");
  assert.equal(b.engine.state.cards[b.id("co")].faceDown, true);
});

clause(CO, "3:flipUp", "FLIP UP is refused when the [R][R] threshold is not met (one [R] + ready [G]); works with [R][R]", () => {
  const b = coFlipBoard([...bank("rage", 1, P1), ...bank("greed", 3, P1)]);
  refused(() => flipCo(b), "only one [R]");
  assert.equal(b.engine.state.cards[b.id("co")].faceDown, true);
  const ok = coFlipBoard([...bank("rage", 2, P1), ...bank("greed", 1, P1)]);
  flipCo(ok);
  assert.equal(coUp(ok), true, "positive control with [R][R]");
});

clause(CO, "3:flipUp", "flipped up it still needs its picked location (extra cost): a location I control is required", () => {
  const b = coFlipBoard([...bank("rage", 3, P1)]);
  refused(() => flip(b.engine, P1, b.id("co")), "no location picked");
  refused(() => flipCo(b, "oloc"), "an opponent's location is not legal");
  assert.equal(b.engine.state.cards[b.id("co")].faceDown, true);
  flipCo(b);
  assert.equal(coUp(b), true);
});

clause(CO, "3:flipUp", "a flipped-up Objector is bound to the picked location just like a hand-deployed one: it cannot attack until that location leaves", () => {
  const b = coFlipBoard([...bank("rage", 3, P1)]);
  flipCo(b);
  eligible(b, "co");
  refused(() => declareAttackBy(b.engine, P1, [b.id("co")]), "picked location in play", /cannot attack/i);
  play(b.engine, P1, b.id("kloc"), { selected: { t: [b.id("loc1")] } });
  declareAttackBy(b.engine, P1, [b.id("co")]);
  assert.ok(b.engine.state.battle, "b.engine.state.battle");
});

clause(CO, "3:flipUp", "only the controller can FLIP UP it", () => {
  const b = coFlipBoard([...bank("rage", 3, P1), ...bank("rage", 3, P2)]);
  refused(() => flipCo(b, "loc1", P2), "the opponent cannot flip my card");
  assert.equal(b.engine.state.cards[b.id("co")].faceDown, true);
});

clause(CO, "3:flipUp", "flip up on my own turn works; it is TACTICAL so it is also allowed in the opponent's window", () => {
  const w = mk(
    [
      { key: "co", def: printing(CO), owner: P1, zone: "play", faceDown: true },
      { key: "loc1", def: location({ name: "Loc1" }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" },
      ...bank("rage", 4, P1)
    ],
    { activePlayerId: P2 }
  );
  declareAttackOpenWindow(w.engine, P2, [w.id("atk")]);
  flip(w.engine, P1, w.id("co"), { anchor: [w.id("loc1")] });
  resolvePendingResponses(w.engine);
  assert.equal(coUp(w), true, "TACTICAL: a flip-up deploy follows the card's own timing");
});

// ===================================================================
// Draconarius Slitherform
// ===================================================================

interface DsOpts {
  rage?: number;
  foes?: number;
  foeLife?: number;
  foeStrength?: number;
  extra?: CardPlacement[];
  dsZone?: "play" | "hand";
}
const dsBoard = (o: DsOpts = {}) =>
  mk([
    { key: "ds", def: printing(DS), owner: P1, zone: o.dsZone ?? "play" },
    { key: "ally", def: character({ name: "Ally", strength: 1, life: 9 }), owner: P1, zone: "play" },
    ...Array.from({ length: o.foes ?? 2 }, (_, i) => ({
      key: `foe${i + 1}`,
      def: character({ name: `Foe${i + 1}`, strength: o.foeStrength ?? 1, life: o.foeLife ?? 10, speed: 1 }),
      owner: P2,
      zone: "play" as const
    })),
    ...bank("rage", o.rage ?? 0, P1),
    ...(o.extra ?? [])
  ]);

clause(DS, "0:unique", "is a 4/3/3 seraphim dragon warlord costing 6 [R][R][R]; deploys exactly, refused short on cost or on [R]", () => {
  const p = printing(DS);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "warlord");
  assert.deepEqual([...(p.subtype ?? [])], ["seraphim", "dragon"]);
  assert.equal(p.cost, 6);
  assert.equal(p.threshold, "rrr");
  const ok = dsBoard({ dsZone: "hand", rage: 6 });
  play(ok.engine, P1, ok.id("ds"));
  assert.equal(zoneOf(ok.engine, ok.id("ds")), "play");
  assert.equal(ok.engine.getStat(ok.id("ds"), "strength"), 4);
  assert.equal(ok.engine.getStat(ok.id("ds"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("ds"), "life"), 3);
  const short = dsBoard({ dsZone: "hand", rage: 5 });
  refused(() => play(short.engine, P1, short.id("ds")), "5 resources for cost 6");
  const icon = dsBoard({ dsZone: "hand", rage: 2, extra: bank("greed", 4, P1) });
  refused(() => play(icon.engine, P1, icon.id("ds")), "only two [R] for threshold [R][R][R]");
  const costShort = dsBoard({ dsZone: "hand", rage: 0, extra: [...spentResources(P1, 3), ...bank("rage", 5, P1)] });
  refused(() => play(costShort.engine, P1, costShort.id("ds")), "threshold met by spent, 5 ready for cost 6", /Costs cannot be paid/);
  const costOk = dsBoard({ dsZone: "hand", rage: 0, extra: [...spentResources(P1, 3), ...bank("rage", 6, P1)] });
  play(costOk.engine, P1, costOk.id("ds"));
  assert.equal(zoneOf(costOk.engine, costOk.id("ds")), "play");
});

clause(DS, "0:unique", "UNIQUE DRACONARIUS: deploying a second copy while controlling one forces a choice; keeping the new one destroys the old", () => {
  const b = dsBoard({ rage: 6, extra: [{ key: "ds2", def: printing(DS), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("ds2"));
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.equal(pc?.playerId, P1, "the controller chooses");
  assert.deepEqual([...(pc?.candidates as string[])].sort(), [b.id("ds"), b.id("ds2")].sort());
  drain(b.engine, (c) => (c.kind === "uniqueSurvivor" ? { kind: "uniqueSurvivor", keep: b.id("ds2") } : distribute({ [b.id("foe1")]: 4 })(c)));
  assert.equal(zoneOf(b.engine, b.id("ds2")), "play");
  assert.equal(zoneOf(b.engine, b.id("ds")), "discard");
});

clause(DS, "0:unique", "keeping the old copy destroys the new one", () => {
  const b = dsBoard({ rage: 6, extra: [{ key: "ds2", def: printing(DS), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("ds2"));
  drain(b.engine, (c) => (c.kind === "uniqueSurvivor" ? { kind: "uniqueSurvivor", keep: b.id("ds") } : distribute({ [b.id("foe1")]: 4 })(c)));
  assert.equal(zoneOf(b.engine, b.id("ds")), "play");
  assert.equal(zoneOf(b.engine, b.id("ds2")), "discard");
});

clause(DS, "0:unique", "the identifier is DRACONARIUS: another card with that identifier conflicts, one with a different identifier does not", () => {
  const same = dsBoard({
    rage: 6,
    extra: [{ key: "twin", def: character({ name: "Twin", cost: 0, unique: "draconarius" } as never), owner: P1, zone: "hand" }]
  });
  play(same.engine, P1, same.id("twin"));
  const pc = pending(same.engine);
  assert.equal(pc?.kind, "uniqueSurvivor", "same identifier forces the choice");
  assert.deepEqual([...(pc?.candidates as string[])].sort(), [same.id("ds"), same.id("twin")].sort());
  const other = dsBoard({
    rage: 6,
    extra: [{ key: "twin", def: character({ name: "Twin", cost: 0, unique: "somebody else" } as never), owner: P1, zone: "hand" }]
  });
  play(other.engine, P1, other.id("twin"));
  noPending(other);
  assert.equal(zoneOf(other.engine, other.id("twin")), "play");
  assert.equal(zoneOf(other.engine, other.id("ds")), "play");
});

clause(DS, "0:unique", "the opponent may control their own Draconarius Slitherform with no choice", () => {
  const b = dsBoard({
    rage: 0,
    extra: [{ key: "ds2", def: printing(DS), owner: P2, zone: "hand" }, ...bank("rage", 6, P2)]
  });
  b.engine.state.activePlayerId = P2;
  play(b.engine, P2, b.id("ds2"));
  noPending(b);
  assert.equal(zoneOf(b.engine, b.id("ds2")), "play");
  assert.equal(zoneOf(b.engine, b.id("ds")), "play");
});

clause(DS, "0:unique", "the copy destroyed by UNIQUE is 'destroyed', so its death trigger fires", () => {
  const b = dsBoard({ rage: 6, extra: [{ key: "ds2", def: printing(DS), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("ds2"));
  drain(b.engine, (c) => (c.kind === "uniqueSurvivor" ? { kind: "uniqueSurvivor", keep: b.id("ds2") } : distribute({ [b.id("foe1")]: 3, [b.id("foe2")]: 1 })(c)));
  assert.equal(dmg(b, "foe1"), 3);
  assert.equal(dmg(b, "foe2"), 1);
});

// --- when blocked ---

const dsAttack = (b: B, blockers: string[]) => {
  declareAttackBy(b.engine, P1, [b.id("ds")]);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: blockers.map((k) => b.id(k)) });
};

clause(DS, "1:rule", "when blocked by one character, I distribute X = its strength 4 and the whole 4 can go to the blocker", () => {
  const b = dsBoard({ foes: 2 });
  dsAttack(b, ["foe1"]);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "distributeAmong");
  assert.equal(pc?.playerId, P1, "the DS controller divides");
  assert.equal(pc?.amount, 4, "X is this card's strength");
  drain(b.engine, distribute({ [b.id("foe1")]: 4 }));
  assert.equal(dmg(b, "foe1"), 4, "4 damage to the blocker before combat damage");
  assert.equal(dmg(b, "foe2"), 0, "a character that did not block is not damaged");
  assert.equal(dmg(b, "ally"), 0, "my characters are not damaged");
});

clause(DS, "1:rule", "a blocking party of two: the 4 is divided however I want (3/1)", () => {
  const b = dsBoard({ foes: 3 });
  dsAttack(b, ["foe1", "foe2"]);
  assert.equal(pending(b.engine)?.kind, "distributeAmong");
  drain(b.engine, distribute({ [b.id("foe1")]: 3, [b.id("foe2")]: 1 }));
  assert.equal(dmg(b, "foe1"), 3);
  assert.equal(dmg(b, "foe2"), 1);
  assert.equal(dmg(b, "foe3"), 0, "the non-blocker is untouched");
});

clause(DS, "1:rule", "any split is allowed: 4/0, 0/4 and 2/2 across the blocking party", () => {
  for (const [a, c] of [[4, 0], [0, 4], [2, 2]]) {
    const b = dsBoard({ foes: 3 });
    dsAttack(b, ["foe1", "foe2"]);
    drain(b.engine, distribute({ [b.id("foe1")]: a, [b.id("foe2")]: c }));
    assert.equal(dmg(b, "foe1"), a, `split ${a}/${c}`);
    assert.equal(dmg(b, "foe2"), c, `split ${a}/${c}`);
    assert.equal(dmg(b, "foe3"), 0);
  }
});

clause(DS, "1:rule", "the damage cannot go to a character outside the blocking party", () => {
  const b = dsBoard({ foes: 3 });
  dsAttack(b, ["foe1", "foe2"]);
  refused(
    () => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares: { [b.id("foe3")]: 4 } } } as never),
    "foe3 did not block"
  );
  refused(
    () => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares: { [b.id("ally")]: 4 } } } as never),
    "my own character is not in the blocking party"
  );
  drain(b.engine, distribute({ [b.id("foe1")]: 4 })); // positive control
  assert.equal(dmg(b, "foe1"), 4);
});

clause(DS, "1:rule", "exactly X must be inflicted: over-dividing (5 of 4) is refused", () => {
  const b = dsBoard({ foes: 2 });
  dsAttack(b, ["foe1", "foe2"]);
  refused(
    () => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares: { [b.id("foe1")]: 3, [b.id("foe2")]: 2 } } } as never),
    "over-dividing X=4"
  );
  drain(b.engine, distribute({ [b.id("foe1")]: 2, [b.id("foe2")]: 2 }));
  assert.equal(dmg(b, "foe1") + dmg(b, "foe2"), 4);
});

clause(DS, "1:rule", "exactly X must be inflicted: under-dividing (3 of 4) is refused", () => {
  const b = dsBoard({ foes: 2 });
  dsAttack(b, ["foe1", "foe2"]);
  refused(
    () => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares: { [b.id("foe1")]: 2, [b.id("foe2")]: 1 } } } as never),
    "under-dividing X=4"
  );
});

clause(DS, "1:rule", "damage that kills the blocker destroys it", () => {
  const b = dsBoard({ foes: 1, foeLife: 4 });
  dsAttack(b, ["foe1"]);
  drain(b.engine, distribute({ [b.id("foe1")]: 4 }));
  assert.equal(zoneOf(b.engine, b.id("foe1")), "discard");
});

clause(DS, "1:rule", "no trigger when not blocked", () => {
  const b = dsBoard({ foes: 1 });
  declareAttackBy(b.engine, P1, [b.id("ds")]);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  assert.notEqual(pending(b.engine)?.kind, "distributeAmong", "an unblocked attack does not trigger");
  assert.equal(dmg(b, "foe1"), 0);
});

clause(DS, "1:rule", "no trigger when ANOTHER of my characters is blocked", () => {
  const b = dsBoard({ foes: 1 });
  declareAttackBy(b.engine, P1, [b.id("ally")]);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("foe1")] });
  assert.notEqual(pending(b.engine)?.kind, "distributeAmong", "this card was not blocked");
  assert.equal(dmg(b, "foe1"), 0);
});

clause(DS, "1:rule", "X is this card's CURRENT strength: +2 from an attached item gives X = 6", () => {
  const b = dsBoard({ foes: 2, extra: [{ key: "buff", def: buffItem("Buff", 2), owner: P1, zone: "play", attachedToKey: "ds" }] });
  assert.equal(b.engine.getStat(b.id("ds"), "strength"), 6);
  dsAttack(b, ["foe1"]);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "distributeAmong");
  assert.equal(pc?.amount, 6, "X is this card's strength (6)");
  drain(b.engine, distribute({ [b.id("foe1")]: 6 }));
  assert.equal(dmg(b, "foe1"), 6);
});

clause(DS, "1:rule", "X follows a reduced strength: -2 gives X = 2", () => {
  const b = dsBoard({ foes: 2, extra: [{ key: "debuff", def: buffItem("Debuff", -2), owner: P1, zone: "play", attachedToKey: "ds" }] });
  assert.equal(b.engine.getStat(b.id("ds"), "strength"), 2);
  dsAttack(b, ["foe1"]);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "distributeAmong");
  assert.equal(pc?.amount, 2);
  drain(b.engine, distribute({ [b.id("foe1")]: 2 }));
  assert.equal(dmg(b, "foe1"), 2);
});

// --- when destroyed ---

const dsKilled = (b: B) => {
  b.engine.state.activePlayerId = P2;
  play(b.engine, P2, b.id("kill"), { selected: { t: [b.id("ds")] } });
};
const withKiller = (o: DsOpts = {}) =>
  dsBoard({ ...o, extra: [{ key: "kill", def: killTactic("Kill", "character"), owner: P2, zone: "hand" }, ...(o.extra ?? [])] });

clause(DS, "2:rule", "when destroyed, I divide X = 4 among the opponent's characters (3/1)", () => {
  const b = withKiller({ foes: 2 });
  dsKilled(b);
  assert.equal(zoneOf(b.engine, b.id("ds")), "discard");
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "distributeAmong");
  assert.equal(pc?.playerId, P1, "I, the controller of the destroyed card, divide the damage");
  assert.equal(pc?.amount, 4);
  drain(b.engine, distribute({ [b.id("foe1")]: 3, [b.id("foe2")]: 1 }));
  assert.equal(dmg(b, "foe1"), 3);
  assert.equal(dmg(b, "foe2"), 1);
  assert.equal(dmg(b, "ally"), 0, "my own character is not damaged");
});

clause(DS, "2:rule", "X is this card's strength as it was when destroyed: a +2 attached item gives X = 6, divided among the opponent's characters", () => {
  const b = withKiller({ foes: 2, extra: [{ key: "buff", def: buffItem("Buff", 2), owner: P1, zone: "play", attachedToKey: "ds" }] });
  assert.equal(b.engine.getStat(b.id("ds"), "strength"), 6, "control: buffed to 6 before it dies");
  dsKilled(b);
  assert.equal(zoneOf(b.engine, b.id("ds")), "discard");
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "distributeAmong");
  assert.equal(pc?.amount, 6, "X is this card's (buffed) strength, not the printed 4");
  drain(b.engine, distribute({ [b.id("foe1")]: 4, [b.id("foe2")]: 2 }));
  assert.equal(dmg(b, "foe1"), 4);
  assert.equal(dmg(b, "foe2"), 2);
});

clause(DS, "2:rule", "any split of the 4 works: all on one character, or 2/2", () => {
  for (const [a, c] of [[4, 0], [0, 4], [2, 2]]) {
    const b = withKiller({ foes: 2 });
    dsKilled(b);
    drain(b.engine, distribute({ [b.id("foe1")]: a, [b.id("foe2")]: c }));
    assert.equal(dmg(b, "foe1"), a);
    assert.equal(dmg(b, "foe2"), c);
  }
});

clause(DS, "2:rule", "damage cannot go to my own characters; over-dividing is refused", () => {
  const b = withKiller({ foes: 2 });
  dsKilled(b);
  refused(
    () => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares: { [b.id("ally")]: 4 } } } as never),
    "my own character is not an opponent's character"
  );
  refused(
    () => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares: { [b.id("foe1")]: 3, [b.id("foe2")]: 2 } } } as never),
    "over-dividing"
  );
  drain(b.engine, distribute({ [b.id("foe1")]: 1, [b.id("foe2")]: 3 }));
  assert.equal(dmg(b, "foe1"), 1);
  assert.equal(dmg(b, "foe2"), 3);
});

clause(DS, "2:rule", "under-dividing (3 of 4) the death damage is refused", () => {
  const b = withKiller({ foes: 2 });
  dsKilled(b);
  refused(
    () => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares: { [b.id("foe1")]: 3 } } } as never),
    "under-dividing"
  );
});

clause(DS, "2:rule", "with one opposing character the whole 4 lands on it and can destroy it", () => {
  const b = withKiller({ foes: 1, foeLife: 4 });
  dsKilled(b);
  drain(b.engine, distribute({ [b.id("foe1")]: 4 }));
  assert.equal(zoneOf(b.engine, b.id("foe1")), "discard");
});

clause(DS, "2:rule", "with no opposing characters nothing happens and nothing is asked", () => {
  const b = withKiller({ foes: 0 });
  dsKilled(b);
  drain(b.engine, declineAll);
  noPending(b);
  assert.equal(zoneOf(b.engine, b.id("ds")), "discard");
  assert.equal(dmg(b, "ally"), 0);
});

clause(DS, "2:rule", "it triggers only for its own destruction: my other character dying deals no damage", () => {
  const b = withKiller({ foes: 1 });
  b.engine.state.activePlayerId = P2;
  play(b.engine, P2, b.id("kill"), { selected: { t: [b.id("ally")] } });
  assert.equal(zoneOf(b.engine, b.id("ally")), "discard");
  assert.notEqual(pending(b.engine)?.kind, "distributeAmong");
  assert.equal(dmg(b, "foe1"), 0);
});

clause(DS, "2:rule", "destroyed in battle while blocking, it still deals its X to the attacker's side", () => {
  const b = dsBoard({ foes: 2, foeStrength: 5 });
  b.engine.state.activePlayerId = P2;
  declareAttackBy(b.engine, P2, [b.id("foe1")]);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("ds")] });
  const answer = (c: Choice) => (c.kind === "distributeAmong" ? { kind: "distributeAmong", shares: { [b.id("foe2")]: 4 } } : declineAll(c));
  finishBattle(b.engine, undefined, answer);
  assert.equal(dmg(b, "foe2"), 4, "death trigger damage landed on the other opposing character");
});

// ===================================================================
// Dragon Archer
// ===================================================================

interface DaOpts {
  rage?: number;
  extra?: CardPlacement[];
  foeStrength?: number;
  foeLife?: number;
}
const daBoard = (o: DaOpts = {}) =>
  mk([
    { key: "da", def: printing(DA), owner: P1, zone: "hand" },
    { key: "foe", def: character({ name: "Foe", strength: o.foeStrength ?? 2, life: o.foeLife ?? 5 }), owner: P2, zone: "play" },
    { key: "ally", def: character({ name: "Ally", strength: 2, life: 5 }), owner: P1, zone: "play" },
    { key: "bystander", def: character({ name: "Bystander", strength: 2, life: 5 }), owner: P2, zone: "play" },
    { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play" },
    { key: "loc", def: location({ name: "Loc" }), owner: P2, zone: "play" },
    { key: "hc", def: character({ name: "HandChar" }), owner: P2, zone: "hand" },
    { key: "dc", def: character({ name: "DiscChar" }), owner: P2, zone: "discard" },
    ...bank("rage", o.rage ?? 5, P1),
    ...(o.extra ?? [])
  ]);
const daCast = (b: B, pick?: string) => play(b.engine, P1, b.id("da"), pick ? { selected: { c: [b.id(pick)] } } : {});

clause(DA, "0:extraCost", "is a 3/3/5 dragon warlord costing 5 [R][R]; deploys exactly, refused short on cost or [R]", () => {
  const p = printing(DA);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "warlord");
  assert.deepEqual([...(p.subtype ?? [])], ["dragon"]);
  assert.equal(p.cost, 5);
  assert.equal(p.threshold, "rr");
  const ok = daBoard({ rage: 5 });
  daCast(ok);
  assert.equal(zoneOf(ok.engine, ok.id("da")), "play");
  assert.equal(ok.engine.getStat(ok.id("da"), "strength"), 3);
  assert.equal(ok.engine.getStat(ok.id("da"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("da"), "life"), 5);
  const short = daBoard({ rage: 4 });
  refused(() => daCast(short), "4 resources for cost 5");
  const icon = daBoard({ rage: 1, extra: bank("greed", 4, P1) });
  refused(() => daCast(icon), "only one [R] for [R][R]");
  const costShort = daBoard({ rage: 0, extra: [...spentResources(P1, 2), ...bank("rage", 4, P1)] });
  refused(() => daCast(costShort), "threshold met by spent, 4 ready for cost 5", /Costs cannot be paid/);
  const costOk = daBoard({ rage: 0, extra: [...spentResources(P1, 2), ...bank("rage", 5, P1)] });
  daCast(costOk);
  assert.equal(zoneOf(costOk.engine, costOk.id("da")), "play");
});

clause(DA, "0:extraCost", "picking a character is optional: it can be deployed with no pick", () => {
  const b = daBoard();
  daCast(b);
  assert.equal(zoneOf(b.engine, b.id("da")), "play");
  noPending(b);
});

clause(DA, "0:extraCost", "at most one character may be picked: two picks are refused", () => {
  const b = daBoard();
  refused(() => play(b.engine, P1, b.id("da"), { selected: { c: [b.id("foe"), b.id("bystander")] } }), "two characters picked");
  assert.equal(zoneOf(b.engine, b.id("da")), "hand");
  daCast(b, "foe");
  assert.equal(zoneOf(b.engine, b.id("da")), "play");
});

clause(DA, "0:extraCost", "the pick can be an opponent's character or my own", () => {
  const a = daBoard();
  daCast(a, "foe");
  assert.equal(zoneOf(a.engine, a.id("da")), "play");
  assert.equal(dmg(a, "foe"), 3, "the picked opposing character took Y = 3");
  const c = daBoard();
  daCast(c, "ally");
  assert.equal(zoneOf(c.engine, c.id("da")), "play");
  assert.equal(dmg(c, "ally"), 3, "my own character can be picked and takes 3");
});

clause(DA, "0:extraCost", "only a character in play can be picked: items, locations and cards in hand or discard are refused", () => {
  const b = daBoard();
  refused(() => daCast(b, "gear"), "an item is not a character");
  refused(() => daCast(b, "loc"), "a location is not a character");
  refused(() => daCast(b, "hc"), "a character in a hand is not in play");
  refused(() => daCast(b, "dc"), "a character in the discard pile is not in play");
  assert.equal(zoneOf(b.engine, b.id("da")), "hand");
  daCast(b, "foe"); // positive control
  assert.equal(zoneOf(b.engine, b.id("da")), "play");
});

clause(DA, "1:rule", "with a picked character: this card takes X = that character's strength (2) and the character takes Y = this card's strength (3)", () => {
  const b = daBoard({ foeStrength: 2, foeLife: 5 });
  daCast(b, "foe");
  noPending(b);
  assert.equal(dmg(b, "da"), 2, "X = 2 damage to this card");
  assert.equal(dmg(b, "foe"), 3, "Y = 3 damage to the picked character");
  assert.equal(zoneOf(b.engine, b.id("da")), "play");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  assert.equal(dmg(b, "bystander"), 0, "other characters are untouched");
  assert.equal(dmg(b, "ally"), 0);
});

clause(DA, "1:rule", "without a pick nothing is damaged", () => {
  const b = daBoard({ foeStrength: 4 });
  daCast(b);
  assert.equal(dmg(b, "da"), 0);
  assert.equal(dmg(b, "foe"), 0);
  assert.equal(dmg(b, "ally"), 0);
  assert.equal(dmg(b, "bystander"), 0);
});

clause(DA, "1:rule", "X scales with the picked character's strength: strength 4 deals 4 to this card (survives, life 5)", () => {
  const b = daBoard({ foeStrength: 4, foeLife: 9 });
  daCast(b, "foe");
  assert.equal(dmg(b, "da"), 4);
  assert.equal(zoneOf(b.engine, b.id("da")), "play");
  assert.equal(dmg(b, "foe"), 3);
});

clause(DA, "1:rule", "a picked character of strength 5 destroys this card (life 5) while still taking 3", () => {
  const b = daBoard({ foeStrength: 5, foeLife: 9 });
  daCast(b, "foe");
  assert.equal(zoneOf(b.engine, b.id("da")), "discard", "5 damage destroys life 5");
  assert.equal(dmg(b, "foe"), 3, "the character still took Y = 3");
});

clause(DA, "1:rule", "a picked character of strength 0 deals 0 to this card", () => {
  const b = daBoard({ foeStrength: 0, foeLife: 9 });
  daCast(b, "foe");
  assert.equal(dmg(b, "da"), 0);
  assert.equal(dmg(b, "foe"), 3);
});

clause(DA, "1:rule", "Y damage can destroy the picked character: life 3 dies, life 4 survives", () => {
  const dies = daBoard({ foeLife: 3, foeStrength: 1 });
  daCast(dies, "foe");
  assert.equal(zoneOf(dies.engine, dies.id("foe")), "discard");
  assert.equal(dmg(dies, "da"), 1, "this card took X = 1");
  const lives = daBoard({ foeLife: 4, foeStrength: 1 });
  daCast(lives, "foe");
  assert.equal(zoneOf(lives.engine, lives.id("foe")), "play");
  assert.equal(dmg(lives, "foe"), 3);
});

clause(DA, "1:rule", "X uses the picked character's CURRENT strength (+2 from an attached item gives 4)", () => {
  const b = daBoard({
    foeStrength: 2,
    foeLife: 9,
    extra: [{ key: "buff", def: buffItem("Buff", 2), owner: P2, zone: "play", attachedToKey: "foe" }]
  });
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 4);
  daCast(b, "foe");
  assert.equal(dmg(b, "da"), 4, "X = 4");
  assert.equal(dmg(b, "foe"), 3);
});

clause(DA, "1:rule", "Y uses this card's CURRENT strength (+1 from my aura gives 4), and X is the picked opponent's", () => {
  const aura = location({
    name: "Aura",
    behavior: { abilities: [{ id: "aura", type: "continuous", modifiers: [{ selector: { type: "character", controller: "self" }, stat: "strength", operation: "add", value: 1 }] }] }
  } as never);
  const b = daBoard({
    foeLife: 9,
    extra: [{ key: "aura", def: aura, owner: P1, zone: "play" }]
  });
  daCast(b, "foe");
  assert.equal(b.engine.getStat(b.id("da"), "strength"), 4);
  assert.equal(dmg(b, "da"), 2, "X = the opponent's strength 2");
  assert.equal(dmg(b, "foe"), 4, "Y = this card's strength 4");
});

clause(DA, "1:rule", "it triggers only for itself: a later character entering play damages nothing", () => {
  const b = daBoard({ extra: [{ key: "late", def: character({ name: "Late", cost: 0 }), owner: P1, zone: "hand" }] });
  daCast(b, "foe");
  const da1 = dmg(b, "da");
  const foe1 = dmg(b, "foe");
  play(b.engine, P1, b.id("late"));
  assert.equal(zoneOf(b.engine, b.id("late")), "play");
  assert.equal(dmg(b, "da"), da1, "no extra damage to this card");
  assert.equal(dmg(b, "foe"), foe1, "no extra damage to the picked character");
  assert.equal(dmg(b, "late"), 0);
});

clause(DA, "1:rule", "a second Dragon Archer entering with its own pick only affects its own pick", () => {
  const b = daBoard({ rage: 10, extra: [{ key: "da2", def: printing(DA), owner: P1, zone: "hand" }] });
  daCast(b, "foe");
  const foeDmg = dmg(b, "foe");
  play(b.engine, P1, b.id("da2"), { selected: { c: [b.id("bystander")] } });
  assert.equal(dmg(b, "bystander"), 3, "the second archer's pick took 3");
  assert.equal(dmg(b, "foe"), foeDmg, "the first archer's pick was not hit again");
  assert.equal(dmg(b, "da2"), 2);
  assert.equal(dmg(b, "da"), 2, "the first archer took nothing more");
});

void activate;
