// Clause tests: decade-of-deckadence-06 (20 rules groups, 40 clauses), written from the PRINTED text.
// Successful IPO, Sweeping Destruction, Tempered Rage, Temple of Rantzigore, Testudine World Ender,
// Thabbashite Desert Creature, Thabbashite Serpent Rider, The Ministry of Other Smaller Smaller Ministries,
// Tough Crowd, Uhluhtc Unleashed, Unleash the Majigs, Unwelcome Hero, Unwieldy Spy Equipment, Upstart Arcanist,
// Violating Ritual, War Beast, William B. Sixsmith III, Wired Up, Witchclock Necromancy, Wrath of the Mau.

import assert from "node:assert/strict";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import {
  activate,
  bank,
  buildGame,
  character,
  developFaction,
  item,
  location,
  P1,
  P2,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic,
  volition
} from "../per-card/_harness.js";
import {
  covertBlocksOnlyCovertParties,
  covertCannotBeBlockedByNonCovert,
  covertHasKeyword,
  covertPartyNeedsEveryMemberCovert,
  declareAttackBy,
  declareAttackOpenWindow,
  finishBattle,
  playRaw
} from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, zoneOf } from "./_board.js";
import { clause, drain, declineAll, printing, refused, settleState } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { barrenFaction, developResource, endTurn, endTurnRaw, factionOf } from "./_turn.js";
import type { CardPlacement } from "../support/fixtures.js";

const ANY = /[\s\S]*/;
type Cards = CardPlacement[];

const IPO = "5681d785-3939-45ca-8e9f-2f54eddcd221"; // tactic banker cost 6 [G][G][G]
const SD = "a1c0370a-45ab-4ba9-bc6e-5460ed0e3bfb"; // tactic warlord cost 8 [R][R]
const TR = "79e1db0c-a18b-4a66-ad29-1fd522a41f2e"; // resource warlord cost 0, provides [R]
const TEMPLE = "66d4842a-f209-4ff8-bf29-935596d08bb7"; // location arcanist cost 5 [O][O][O] structure 5
const TESTUDINE = "c9cceacd-c581-4e26-97ee-120c3dd99c29"; // character gearsmith cost 5 [E][E] 4/3/3
const TDC = "60129e7c-90d7-44cd-a802-bde674ae0887"; // character arcanist cost 5 [O] 3/3/2
const SERPENT = "19939670-e20b-493f-a86b-56c560b29c8f"; // character rogue cost 4 [D] 3/3/1
const MINISTRY = "03793397-ca23-4bda-b0ec-3a1597874ab8"; // location banker cost 3 [G][G] structure 5
const TOUGH = "c2d79ee7-7f25-451c-b725-de98d75b32c1"; // tactic rogue cost 3 [D][D]
const UHLUHTC = "c82c7e2c-41c8-43d7-9ebe-f9fa03837ca2"; // character arcanist cost 5 [O][O][O] 4/3/3
const UNLEASH = "42c852d1-42d4-47df-aafb-67618aa43abf"; // tactic gearsmith cost 4 [E][E]
const HERO = "2d1c8e0c-5c8e-4c6a-b1d6-e867c28a1334"; // character universal cost 5 [V] 3/3/3
const SPY = "e16fbcd2-890a-4479-a577-9e2bc0ee390b"; // item rogue cost 1 [D]
const UPSTART = "ea562e12-53f2-4da2-831f-fe986b9229cb"; // character arcanist cost 2 [O][O] 2/3/1
const RITUAL = "575ecc83-447b-4e43-9e61-87d6513b7949"; // tactic arcanist cost 3 [O][O][O]
const BEAST = "b8383166-2761-428e-9cdb-c8f9933db2d5"; // character warlord cost 5 [R][R] 5/2/4
const SIXSMITH = "b984f42b-a67d-4a8a-a618-65cc53c0acf5"; // character gearsmith cost 7 [E][E][E] 4/3/4
const WIRED = "98797800-2864-48bc-b8fa-d5be0506b7aa"; // resource gearsmith cost 0, provides [E]
const WITCHCLOCK = "117fa6ae-ecd1-431c-a341-ee268b47937e"; // tactic banker cost 5 [G][G]
const WRATH = "9d295174-c1fa-43e1-b6d1-cca0fa710098"; // tactic banker cost 6 [G][G]

// --- small helpers -----------------------------------------------------------------------------------------------
const ready = (e: SpoilsEngine, p: PlayerId = P1): number => e.getAvailableResourceCount(p);
const handOf = (e: SpoilsEngine, p: PlayerId): string[] => [...e.state.players[p].hand];
const deckOf = (e: SpoilsEngine, p: PlayerId): string[] => [...e.state.players[p].deck];
const discardOf = (e: SpoilsEngine, p: PlayerId): string[] => [...e.state.players[p].discard];
const infl = (e: SpoilsEngine, p: PlayerId): number => e.state.players[p].influence;
const stats = (e: SpoilsEngine, id: CardInstanceId): number[] => [e.getStat(id, "strength"), e.getStat(id, "speed"), e.getStat(id, "life")];
const spent = (icon: "rage" | "greed" | "deception" | "elitism" | "obsession", n: number, owner: PlayerId = P1): Cards =>
  bank(icon, n, owner).map((placement) => ({ ...placement, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));
const resolveChoice = (e: SpoilsEngine, choice: Record<string, unknown>): void => {
  const pc = pending(e)!;
  e.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
};
const pickIds = (ids: string[]) => (pc: PendingChoiceLike) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: ids } : declineAll(pc));
const mk = (cards: Cards, extra: Record<string, unknown> = {}) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, ...extra, cards } as never);
const keepUnique = (e: SpoilsEngine, player: PlayerId, keep: CardInstanceId): void => {
  e.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "uniqueSurvivor", keep } } as never);
  resolvePendingResponses(e);
};
const factionInfluence = (e: SpoilsEngine, p: PlayerId): number => e.getStat(factionOf(e, p), "influence");
/** A free activated "destroy a picked card in play" ability (id `kill`, declaration `t`) on a character. */
const KILLER = () =>
  character({
    name: "Killer",
    strength: 1,
    life: 9,
    behavior: { abilities: [{ id: "kill", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } as never
  });
const printedFacts = (id: string, want: { type: string; trade: string; cost: number; threshold: string; strength?: number; speed?: number; life?: number; structure?: number }): void => {
  const p = printing(id);
  assert.equal(p.type, want.type);
  assert.equal(p.trade, want.trade);
  assert.equal(p.cost, want.cost);
  assert.equal(p.threshold, want.threshold);
  if (want.strength !== undefined) assert.equal(p.strength, want.strength);
  if (want.speed !== undefined) assert.equal(p.speed, want.speed);
  if (want.life !== undefined) assert.equal(p.life, want.life);
  if (want.structure !== undefined) assert.equal(p.structure, want.structure);
};

// =============================================================================================================
// Successful IPO
// Draw 1 card and gain 1 influence for each [G] you control.
// Tactic, banker, cost 6, [G][G][G].
// =============================================================================================================
function ipoBoard(o: { greed?: number; rage?: number; spentGreed?: number; oppGreed?: number; down?: number; deck?: number } = {}) {
  return mk([
    { key: "ipo", def: printing(IPO), owner: P1, zone: "hand" },
    ...bank("greed", o.greed ?? 0, P1),
    ...bank("rage", o.rage ?? 0, P1),
    ...spent("greed", o.spentGreed ?? 0, P1),
    ...volition(o.down ?? 0, P1),
    ...bank("greed", o.oppGreed ?? 0, P2),
    ...fillers("dk", o.deck ?? 12, P1, "deck")
  ]);
}

clause(IPO, "0:rule", "printed card: a banker tactic, cost 6, threshold [G][G][G]", () => {
  printedFacts(IPO, { type: "tactic", trade: "banker", cost: 6, threshold: "ggg" });
});

clause(IPO, "0:rule", "deploys for exactly 6: six resources pay it all; five (threshold met) is refused with nothing paid", () => {
  const ok = ipoBoard({ greed: 3, rage: 3 });
  assert.equal(ready(ok.engine), 6);
  play(ok.engine, P1, ok.id("ipo"));
  assert.equal(zoneOf(ok.engine, ok.id("ipo")), "discard");
  assert.equal(ready(ok.engine), 0, "exactly 6 paid");
  const short = ipoBoard({ greed: 3, rage: 2 });
  refused(() => play(short.engine, P1, short.id("ipo")), "5 ready resources for a cost of 6");
  assert.equal(zoneOf(short.engine, short.id("ipo")), "hand");
  assert.equal(ready(short.engine), 5, "nothing was paid");
  assert.equal(handOf(short.engine, P1).length, 1);
});

clause(IPO, "0:rule", "threshold [G][G][G]: two [G] with plenty of other resources is refused", () => {
  const short = ipoBoard({ greed: 2, rage: 5 });
  assert.equal(ready(short.engine), 7);
  refused(() => play(short.engine, P1, short.id("ipo")), "only two [G]", /threshold|icon/i);
  assert.equal(zoneOf(short.engine, short.id("ipo")), "hand");
  assert.equal(ready(short.engine), 7, "nothing was paid");
  const ok = ipoBoard({ greed: 3, rage: 4 });
  play(ok.engine, P1, ok.id("ipo"));
  assert.equal(zoneOf(ok.engine, ok.id("ipo")), "discard", "control: three [G] is enough");
});

clause(IPO, "0:rule", "draws 1 card and gains 1 influence per [G] I control: 3 [G] draw 3 and gain 3", () => {
  const b = ipoBoard({ greed: 3, rage: 3 });
  const hand0 = handOf(b.engine, P1).length; // the IPO itself
  const deck0 = deckOf(b.engine, P1);
  const inf0 = infl(b.engine, P1);
  play(b.engine, P1, b.id("ipo"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  const hand = handOf(b.engine, P1);
  assert.equal(hand.length, hand0 - 1 + 3, "IPO left the hand, three cards drawn");
  assert.deepEqual(hand, deck0.slice(0, 3), "the top three cards, in order");
  assert.equal(infl(b.engine, P1) - inf0, 3, "gained 3 influence");
  assert.equal(deckOf(b.engine, P1).length, 12 - 3);
});

clause(IPO, "0:rule", "5 [G] draw 5 and gain 5; 4 [G] draw 4 and gain 4 (the count follows the [G] icons)", () => {
  for (const n of [4, 5, 7]) {
    const b = ipoBoard({ greed: n, rage: Math.max(0, 6 - n) });
    const inf0 = infl(b.engine, P1);
    play(b.engine, P1, b.id("ipo"));
    assert.equal(handOf(b.engine, P1).length, n, `${n} [G]: drew ${n}`);
    assert.equal(infl(b.engine, P1) - inf0, n, `${n} [G]: gained ${n}`);
  }
});

clause(IPO, "0:rule", "[G] that were spent to pay for it (and spent [G] already attached) still count: it counts what I control, not what is ready", () => {
  const b = ipoBoard({ spentGreed: 2, greed: 1, rage: 5 });
  const inf0 = infl(b.engine, P1);
  play(b.engine, P1, b.id("ipo"));
  assert.equal(ready(b.engine), 0);
  assert.equal(handOf(b.engine, P1).length, 3, "3 [G] (two already spent) drew 3");
  assert.equal(infl(b.engine, P1) - inf0, 3);
});

clause(IPO, "0:rule", "only [G] I control count: the opponent's Greed, my Rage, and a face-down resource (Volition) do not", () => {
  const b = ipoBoard({ greed: 3, rage: 2, down: 1, oppGreed: 4 });
  const inf0 = infl(b.engine, P1);
  const oppInf0 = infl(b.engine, P2);
  play(b.engine, P1, b.id("ipo"));
  assert.equal(handOf(b.engine, P1).length, 3, "three [G] only");
  assert.equal(infl(b.engine, P1) - inf0, 3);
  assert.equal(infl(b.engine, P2), oppInf0, "the opponent gains nothing");
  assert.equal(handOf(b.engine, P2).length, 0, "the opponent draws nothing");
});

// =============================================================================================================
// Sweeping Destruction
// Destroy all non-resource cards.
// Tactic, warlord, cost 8, [R][R].
// =============================================================================================================
function sdBoard(o: { rage?: number; green?: number; extra?: Cards } = {}) {
  return mk([
    { key: "sd", def: printing(SD), owner: P1, zone: "hand" },
    ...bank("rage", o.rage ?? 8, P1),
    ...bank("greed", o.green ?? 0, P1),
    ...(o.extra ?? [])
  ]);
}

clause(SD, "0:rule", "printed card: a warlord tactic, cost 8, threshold [R][R]; deploys for exactly 8 and is refused one short or without [R][R]", () => {
  printedFacts(SD, { type: "tactic", trade: "warlord", cost: 8, threshold: "rr" });
  const ok = sdBoard({ rage: 2, green: 6 });
  play(ok.engine, P1, ok.id("sd"));
  assert.equal(zoneOf(ok.engine, ok.id("sd")), "discard");
  assert.equal(ready(ok.engine), 0, "exactly 8 paid");
  const short = sdBoard({ rage: 2, green: 5 });
  refused(() => play(short.engine, P1, short.id("sd")), "7 resources for cost 8");
  assert.equal(zoneOf(short.engine, short.id("sd")), "hand");
  assert.equal(ready(short.engine), 7);
  const noIcon = sdBoard({ rage: 1, green: 8 });
  refused(() => play(noIcon.engine, P1, noIcon.id("sd")), "only one [R]", /threshold|icon/i);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("sd")), "hand");
});

clause(SD, "0:rule", "destroys every character, item and location in play, mine and the opponent's, into their owners' discard piles", () => {
  const b = sdBoard({
    extra: [
      { key: "myc", def: character({ name: "MyChar" }), owner: P1, zone: "play" },
      { key: "foec", def: character({ name: "FoeChar" }), owner: P2, zone: "play" },
      { key: "foec2", def: character({ name: "FoeChar2", strength: 5, life: 9 }), owner: P2, zone: "play", depleted: true },
      { key: "myi", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "foei", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      { key: "myl", def: location({ name: "MyPlace", structure: 3 }), owner: P1, zone: "play" },
      { key: "foel", def: location({ name: "FoePlace", structure: 3 }), owner: P2, zone: "play" },
      { key: "att", def: item({ name: "Attached" }), owner: P2, zone: "play", attachedToKey: "foec" }
    ]
  });
  play(b.engine, P1, b.id("sd"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const key of ["myc", "myi", "myl"]) {
    assert.equal(zoneOf(b.engine, b.id(key)), "discard", key);
    assert.ok(discardOf(b.engine, P1).includes(b.id(key)), `${key} is in P1's discard pile`);
  }
  for (const key of ["foec", "foec2", "foei", "foel", "att"]) {
    assert.equal(zoneOf(b.engine, b.id(key)), "discard", key);
    assert.ok(discardOf(b.engine, P2).includes(b.id(key)), `${key} is in P2's discard pile`);
  }
});

clause(SD, "0:rule", "resources are NOT destroyed: face-up staples, a non-staple resource and face-down resources all stay in play, for both players", () => {
  const b = sdBoard({
    rage: 8,
    extra: [
      { key: "foeres", def: resourceCard({ name: "FoeRes", resource: { provides: ["greed"], staple: true } }), owner: P2, zone: "play" },
      { key: "oddres", def: resourceCard({ name: "OddRes", resource: { provides: ["obsession"], staple: false } }), owner: P1, zone: "play" },
      ...volition(2, P1),
      ...volition(1, P2),
      { key: "myc", def: character({ name: "MyChar" }), owner: P1, zone: "play" }
    ]
  });
  const resourcesIn = (p: PlayerId) => b.engine.state.players[p].play.filter((id) => b.engine.isResource(id));
  const mine0 = resourcesIn(P1).length;
  const theirs0 = resourcesIn(P2).length;
  play(b.engine, P1, b.id("sd"));
  assert.equal(zoneOf(b.engine, b.id("myc")), "discard", "control: the character was destroyed");
  assert.equal(resourcesIn(P1).length, mine0, "all my resources are still in play");
  assert.equal(resourcesIn(P2).length, theirs0, "all the opponent's resources are still in play");
  assert.equal(zoneOf(b.engine, b.id("foeres")), "play");
  assert.equal(zoneOf(b.engine, b.id("oddres")), "play");
});

clause(SD, "0:rule", "only cards in play are affected: hand, deck and discard are untouched, and the factions are not destroyed", () => {
  const b = sdBoard({
    extra: [
      { key: "hc", def: character({ name: "HandChar" }), owner: P2, zone: "hand" },
      { key: "dc", def: character({ name: "DeckChar" }), owner: P2, zone: "deck" },
      { key: "xc", def: character({ name: "DiscChar" }), owner: P2, zone: "discard" },
      { key: "myh", def: item({ name: "MyHandItem" }), owner: P1, zone: "hand" },
      { key: "foec", def: character({ name: "FoeChar" }), owner: P2, zone: "play" }
    ]
  });
  play(b.engine, P1, b.id("sd"));
  assert.equal(zoneOf(b.engine, b.id("foec")), "discard", "control: in-play character destroyed");
  assert.equal(zoneOf(b.engine, b.id("hc")), "hand");
  assert.equal(zoneOf(b.engine, b.id("dc")), "deck");
  assert.equal(zoneOf(b.engine, b.id("xc")), "discard");
  assert.equal(zoneOf(b.engine, b.id("myh")), "hand");
  for (const p of [P1, P2]) assert.equal(zoneOf(b.engine, factionOf(b.engine, p)), "play", "the faction stays in play");
});

clause(SD, "0:rule", "a Micromajig-style token character is destroyed too (it leaves play)", () => {
  const maker = character({
    name: "Maker",
    behavior: { abilities: [{ id: "mk", type: "activated", effects: [{ type: "createTokens", controller: "controller", count: 1, token: { name: "Micromajig", cardType: "character", subtype: ["majig"], strength: 1, life: 1, speed: 3 } }] }] } as never
  });
  const b = sdBoard({ extra: [{ key: "mk", def: maker, owner: P1, zone: "play" }] });
  activate(b.engine, P1, b.id("mk"), "mk");
  const tokenIds = Object.values(b.engine.state.cards).filter((c) => (c as { isToken?: boolean }).isToken && c.zone === "play").map((c) => c.id);
  assert.equal(tokenIds.length, 1);
  play(b.engine, P1, b.id("sd"));
  assert.equal(zoneOf(b.engine, b.id("mk")), "discard");
  for (const t of tokenIds) assert.ok(!b.engine.state.cards[t] || b.engine.state.cards[t].zone !== "play", "the token left play");
  assert.equal(b.engine.state.players[P1].play.some((id) => tokenIds.includes(id)), false);
});

// =============================================================================================================
// Tempered Rage
// PROVIDES [R].  FIRE UP -- COST: Use this only while this card is a face-down resource. Reveal this card. Pay 2.
// EFFECT: Put this card into play face-up. X is the number of characters that were destroyed this turn. Each faction loses X influence.
// Resource, warlord, cost 0.
// =============================================================================================================
function trBoard(o: { others?: number; faceDown?: boolean; zone?: "play" | "hand"; extra?: Cards; turn?: number; active?: PlayerId } = {}) {
  return mk(
    [
      { key: "tr", def: printing(TR), owner: P1, zone: o.zone ?? "play", faceDown: o.faceDown ?? true },
      ...bank("greed", o.others ?? 3, P1),
      { key: "killer", def: KILLER(), owner: P1, zone: "play" },
      { key: "a", def: character({ name: "A", life: 2 }), owner: P1, zone: "play" },
      { key: "b", def: character({ name: "B", life: 2 }), owner: P2, zone: "play" },
      { key: "c", def: character({ name: "C", life: 2 }), owner: P2, zone: "play" },
      { key: "it", def: item({ name: "It" }), owner: P2, zone: "play" },
      ...(o.extra ?? [])
    ],
    { turn: o.turn, activePlayerId: o.active }
  );
}
const trKill = (b: ReturnType<typeof trBoard>, key: string) => activate(b.engine, P1, b.id("killer"), "kill", { selected: { t: [b.id(key)] } });
const fireUp = (b: ReturnType<typeof trBoard>) => activate(b.engine, P1, b.id("tr"), "fire-up");

clause(TR, "0:provides", "printed card: a warlord resource, cost 0, that provides exactly one [R] (face-up in play it adds a Rage icon and a ready resource)", () => {
  const p = printing(TR);
  assert.equal(p.type, "resource");
  assert.equal(p.trade, "warlord");
  assert.equal(p.cost, 0);
  const b = trBoard({ others: 0, faceDown: false });
  assert.equal(b.engine.getThresholds(P1).rage, 1, "exactly one [R]");
  assert.equal(b.engine.getThresholds(P1).greed ?? 0, 0);
  assert.equal(ready(b.engine), 1, "a ready resource");
});

clause(TR, "0:provides", "it provides [R] only face-up: face-down it provides Volition instead", () => {
  const b = trBoard({ others: 0, faceDown: true });
  assert.equal(b.engine.getThresholds(P1).rage ?? 0, 0, "no [R] face-down");
  assert.equal(b.engine.getThresholds(P1).volition, 1, "Volition face-down");
});

clause(TR, "0:provides", "developed face-up from hand it enters play providing [R]", () => {
  const b = trBoard({ others: 0, zone: "hand", faceDown: false });
  developResource(b.engine, P1, b.id("tr"), false);
  assert.equal(zoneOf(b.engine, b.id("tr")), "play");
  assert.equal(b.engine.state.cards[b.id("tr")].faceDown, false);
  assert.equal(b.engine.getThresholds(P1).rage, 1);
});

clause(TR, "1:ability:fire-up", "FIRE UP: face-down with 2 other ready resources it pays 2, comes face-up and now provides [R]", () => {
  const b = trBoard({ others: 2 });
  assert.equal(ready(b.engine), 3);
  fireUp(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.cards[b.id("tr")].faceDown, false, "face-up");
  assert.equal(zoneOf(b.engine, b.id("tr")), "play");
  assert.equal(b.engine.getThresholds(P1).rage, 1, "provides [R] now");
  assert.equal(ready(b.engine), 1, "2 resources were paid; the flipped card itself is a ready [R]");
  assert.equal(b.engine.state.cards[b.id("tr")].depleted, false, "the card itself was not the one spent");
});

clause(TR, "1:ability:fire-up", "FIRE UP: the cost is exactly 2 (one resource is not enough, three leaves one over)", () => {
  const short = trBoard({ others: 0 });
  refused(() => fireUp(short), "only the face-down card itself (1 resource) for Pay 2");
  assert.equal(short.engine.state.cards[short.id("tr")].faceDown, true, "still face-down");
  assert.equal(ready(short.engine), 1);
  const long = trBoard({ others: 4 });
  fireUp(long);
  assert.equal(long.engine.state.cards[long.id("tr")].faceDown, false);
  assert.equal(ready(long.engine), 3, "5 ready - 2 paid = 3 (including the flipped card)");
});

clause(TR, "1:ability:fire-up", "FIRE UP: reveals this card as part of the cost", () => {
  const b = trBoard({ others: 2 });
  const before = b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed").length;
  fireUp(b);
  const reveals = b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed");
  assert.ok(reveals.length > before, "a cardsRevealed event was logged");
});

clause(TR, "1:ability:fire-up", "FIRE UP: usable only while face-down - face-up (in play) it is refused and nothing is paid; in hand it is refused too", () => {
  const up = trBoard({ others: 3, faceDown: false });
  refused(() => fireUp(up), "face-up resource", ANY);
  assert.equal(ready(up.engine), 4, "nothing paid");
  const hand = trBoard({ others: 3, zone: "hand", faceDown: false });
  refused(() => fireUp(hand), "in hand", ANY);
  assert.equal(ready(hand.engine), 3);
  const ok = trBoard({ others: 3 });
  fireUp(ok);
  assert.equal(ok.engine.state.cards[ok.id("tr")].faceDown, false, "control: face-down works");
  refused(() => fireUp(ok), "now face-up: can't be used again", ANY);
});

clause(TR, "1:ability:fire-up", "FIRE UP: X = 0 when no character was destroyed this turn - no faction loses influence", () => {
  const b = trBoard({ others: 3 });
  const i1 = factionInfluence(b.engine, P1);
  const i2 = factionInfluence(b.engine, P2);
  fireUp(b);
  assert.equal(b.engine.state.cards[b.id("tr")].faceDown, false);
  assert.equal(factionInfluence(b.engine, P1), i1);
  assert.equal(factionInfluence(b.engine, P2), i2);
});

clause(TR, "1:ability:fire-up", "FIRE UP: each faction (mine AND the opponent's) loses X influence, X = characters destroyed this turn (1, then 3)", () => {
  for (const [kills, keys] of [[1, ["b"]], [3, ["a", "b", "c"]]] as const) {
    const b = trBoard({ others: 3 });
    for (const k of keys) trKill(b, k);
    const i1 = infl(b.engine, P1);
    const i2 = infl(b.engine, P2);
    fireUp(b);
    assert.equal(b.engine.state.cards[b.id("tr")].faceDown, false);
    assert.equal(i1 - infl(b.engine, P1), kills, `my faction lost ${kills}`);
    assert.equal(i2 - infl(b.engine, P2), kills, `the opponent's faction lost ${kills}`);
  }
});

clause(TR, "1:ability:fire-up", "FIRE UP: characters destroyed BEFORE the flip count; a destroyed item does not", () => {
  const b = trBoard({ others: 3 });
  trKill(b, "it");
  assert.equal(zoneOf(b.engine, b.id("it")), "discard");
  const i1 = infl(b.engine, P1);
  fireUp(b);
  assert.equal(infl(b.engine, P1), i1, "an item is not a character");
  const c = trBoard({ others: 3 });
  trKill(c, "it");
  trKill(c, "a");
  trKill(c, "b");
  const j1 = infl(c.engine, P1);
  const j2 = infl(c.engine, P2);
  fireUp(c);
  assert.equal(j1 - infl(c.engine, P1), 2, "two characters, one item destroyed: X = 2");
  assert.equal(j2 - infl(c.engine, P2), 2);
});

clause(TR, "1:ability:fire-up", "FIRE UP: only THIS turn counts - a character destroyed on an earlier turn does not", () => {
  const b = mk(
    [
      { key: "tr", def: printing(TR), owner: P1, zone: "play", faceDown: true },
      ...bank("greed", 3, P1),
      { key: "killer", def: KILLER(), owner: P1, zone: "play" },
      { key: "b", def: character({ name: "B", life: 2 }), owner: P2, zone: "play" }
    ],
    { playerA: { faction: barrenFaction() }, playerB: { faction: barrenFaction() } }
  );
  activate(b.engine, P1, b.id("killer"), "kill", { selected: { t: [b.id("b")] } });
  assert.equal(zoneOf(b.engine, b.id("b")), "discard");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1, "it is my turn again");
  const i1 = infl(b.engine, P1);
  const i2 = infl(b.engine, P2);
  fireUp(b);
  assert.equal(b.engine.state.cards[b.id("tr")].faceDown, false);
  assert.equal(infl(b.engine, P1), i1, "the character died on an earlier turn: X = 0");
  assert.equal(infl(b.engine, P2), i2);
});

// =============================================================================================================
// Temple of Rantzigore
// UNIQUE TEMPLE OF RANTZIGORE. Characters your opponents control lose 1 strength, 1 life, and 1 speed.
// Location, arcanist, cost 5, [O][O][O], structure 5.
// =============================================================================================================
function templeBoard(o: { zone?: "hand" | "play"; obs?: number; extra?: Cards; turn?: number; active?: PlayerId } = {}) {
  return mk(
    [
      { key: "temple", def: printing(TEMPLE), owner: P1, zone: o.zone ?? "play" },
      ...bank("obsession", o.obs ?? 0, P1),
      { key: "mine", def: character({ name: "Mine", strength: 3, speed: 3, life: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 3, speed: 3, life: 3 }), owner: P2, zone: "play" },
      ...(o.extra ?? [])
    ],
    { turn: o.turn, activePlayerId: o.active }
  );
}

clause(TEMPLE, "0:unique", "printed card: an arcanist location, cost 5, threshold [O][O][O], structure 5; deploys for exactly 5 and is refused one short or one [O] short", () => {
  printedFacts(TEMPLE, { type: "location", trade: "arcanist", cost: 5, threshold: "ooo", structure: 5 });
  const ok = templeBoard({ zone: "hand", obs: 5 });
  play(ok.engine, P1, ok.id("temple"));
  assert.equal(zoneOf(ok.engine, ok.id("temple")), "play");
  assert.equal(ready(ok.engine), 0, "exactly 5 paid");
  assert.equal(ok.engine.getStat(ok.id("temple"), "structure"), 5);
  const short = templeBoard({ zone: "hand", obs: 4 });
  refused(() => play(short.engine, P1, short.id("temple")), "4 resources for cost 5");
  assert.equal(zoneOf(short.engine, short.id("temple")), "hand");
  const noIcon = templeBoard({ zone: "hand", obs: 2, extra: bank("greed", 5, P1) });
  refused(() => play(noIcon.engine, P1, noIcon.id("temple")), "two [O] only", /threshold|icon/i);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("temple")), "hand");
});

clause(TEMPLE, "0:unique", "a second Temple of Rantzigore forces a choice: I keep one and the other is destroyed", () => {
  const b = templeBoard({ obs: 5, extra: [{ key: "t2", def: printing(TEMPLE), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("t2"));
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.equal(pc?.playerId, P1, "the controller chooses");
  assert.deepEqual([...(pc?.candidates as string[])].sort(), [b.id("temple"), b.id("t2")].sort());
  keepUnique(b.engine, P1, b.id("t2"));
  assert.equal(zoneOf(b.engine, b.id("t2")), "play");
  assert.equal(zoneOf(b.engine, b.id("temple")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(TEMPLE, "0:unique", "keeping the old Temple destroys the new one", () => {
  const b = templeBoard({ obs: 5, extra: [{ key: "t2", def: printing(TEMPLE), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("t2"));
  keepUnique(b.engine, P1, b.id("temple"));
  assert.equal(zoneOf(b.engine, b.id("temple")), "play");
  assert.equal(zoneOf(b.engine, b.id("t2")), "discard");
});

clause(TEMPLE, "0:unique", "only my own copies count: the opponent may control their own Temple with no choice and no destruction", () => {
  const b = templeBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "t2", def: printing(TEMPLE), owner: P2, zone: "hand" }, ...bank("obsession", 5, P2)]
  });
  play(b.engine, P2, b.id("t2"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("t2")), "play");
  assert.equal(zoneOf(b.engine, b.id("temple")), "play");
});

clause(TEMPLE, "1:rule", "characters my opponent controls lose 1 strength, 1 life and 1 speed; mine are untouched", () => {
  const b = templeBoard();
  assert.deepEqual(stats(b.engine, b.id("mine")), [3, 3, 3], "my character is unaffected");
  assert.deepEqual(stats(b.engine, b.id("foe")), [2, 2, 2], "their character is at -1/-1/-1");
});

clause(TEMPLE, "1:rule", "it is a static rule: stats are back to printed before the Temple is in play and after it leaves play", () => {
  const hand = templeBoard({ zone: "hand", obs: 5 });
  assert.deepEqual(stats(hand.engine, hand.id("foe")), [3, 3, 3], "not yet in play: no effect");
  play(hand.engine, P1, hand.id("temple"));
  assert.deepEqual(stats(hand.engine, hand.id("foe")), [2, 2, 2], "in play: the effect applies");
  const gone = templeBoard({ extra: [{ key: "k", def: KILLER(), owner: P1, zone: "play" }] });
  assert.deepEqual(stats(gone.engine, gone.id("foe")), [2, 2, 2]);
  activate(gone.engine, P1, gone.id("k"), "kill", { selected: { t: [gone.id("temple")] } });
  assert.equal(zoneOf(gone.engine, gone.id("temple")), "discard");
  assert.deepEqual(stats(gone.engine, gone.id("foe")), [3, 3, 3], "Temple gone: stats restored");
});

clause(TEMPLE, "1:rule", "it also applies to characters the opponent puts into play later, and not to locations", () => {
  const b = templeBoard({
    turn: 2,
    active: P2,
    extra: [
      { key: "late", def: character({ name: "Late", strength: 4, speed: 2, life: 5, cost: 0 }), owner: P2, zone: "hand" },
      { key: "mylate", def: character({ name: "MyLate", strength: 4, speed: 2, life: 5, cost: 0 }), owner: P1, zone: "hand" },
      { key: "foeit", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      { key: "foeloc", def: location({ name: "FoePlace", structure: 4 }), owner: P2, zone: "play" }
    ]
  });
  play(b.engine, P2, b.id("late"));
  assert.deepEqual(stats(b.engine, b.id("late")), [3, 1, 4], "a character the opponent deploys later is reduced too");
  assert.equal(b.engine.getStat(b.id("foeloc"), "structure"), 4, "a location is not a character");
  assert.deepEqual(stats(b.engine, b.id("mine")), [3, 3, 3], "my characters are still untouched");
});

clause(TEMPLE, "1:rule", "the reduction stops at 0 (a 0-strength / 0-speed opposing character stays at 0, it does not go negative)", () => {
  const b = templeBoard({ extra: [{ key: "z", def: character({ name: "Zero", strength: 0, speed: 0, life: 2 }), owner: P2, zone: "play" }] });
  assert.equal(b.engine.getStat(b.id("z"), "strength"), 0);
  assert.equal(b.engine.getStat(b.id("z"), "speed"), 0);
  assert.equal(b.engine.getStat(b.id("z"), "life"), 1);
});

clause(TEMPLE, "1:rule", "an opposing character whose life drops to 0 by the Temple is destroyed", () => {
  const b = templeBoard({ extra: [{ key: "frail", def: character({ name: "Frail", strength: 1, speed: 1, life: 1 }), owner: P2, zone: "play" }] });
  assert.equal(b.engine.getStat(b.id("frail"), "life"), 0, "1 life - 1 = 0");
  settleState(b.engine);
  assert.equal(zoneOf(b.engine, b.id("frail")), "discard", "0 life means destroyed");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play", "control: the 3-life character lives");
});

// =============================================================================================================
// Testudine, World Ender
// UNIQUE TESTUDINE. When this card enters play, look at the top 6 cards of your deck. You may choose a character among
// them with numeric cost 3 or less and reveal it. If you do, put that character into play. Put the remaining cards on
// the bottom of your deck in any order.
// Character, gearsmith (testudine, seraphim, dragon), cost 5, [E][E], 4 str / 3 spd / 3 life.
// =============================================================================================================
/** Deck, top to bottom: Gizmo(item 1), Dear(char 4), Cheap(char 3), Free(char 0), Spell(tactic), Two(char 2), | Seventh(char 1), fillers. */
function tdDeck(): Cards {
  return [
    { key: "gizmo", def: item({ name: "Gizmo", cost: 1 }), owner: P1, zone: "deck" },
    { key: "dear", def: character({ name: "Dear", cost: 4 }), owner: P1, zone: "deck" },
    { key: "cheap", def: character({ name: "Cheap", cost: 3 }), owner: P1, zone: "deck" },
    { key: "free", def: character({ name: "Free", cost: 0 }), owner: P1, zone: "deck" },
    { key: "spell", def: tactic({ name: "Spell", cost: 2 }), owner: P1, zone: "deck" },
    { key: "two", def: character({ name: "Two", cost: 2 }), owner: P1, zone: "deck" },
    { key: "seventh", def: character({ name: "Seventh", cost: 1 }), owner: P1, zone: "deck" },
    ...fillers("f", 3, P1, "deck")
  ];
}
function tdBoard(o: { zone?: "hand" | "play"; elitism?: number; deck?: Cards; extra?: Cards } = {}) {
  const b = mk([
    { key: "tw", def: printing(TESTUDINE), owner: P1, zone: o.zone ?? "hand" },
    ...bank("elitism", o.elitism ?? 5, P1),
    ...(o.deck ?? tdDeck()),
    { key: "foedeck", def: character({ name: "FoeDeckChar", cost: 1 }), owner: P2, zone: "deck" },
    ...(o.extra ?? [])
  ]);
  return b;
}
const tdTop6 = (b: ReturnType<typeof tdBoard>): string[] => deckOf(b.engine, P1).slice(0, 6);

clause(TESTUDINE, "0:unique", "printed card: a gearsmith character (testudine, seraphim, dragon), cost 5, [E][E], 4 str / 3 spd / 3 life; exactly 5 deploys it, 4 or two-icons-short are refused", () => {
  printedFacts(TESTUDINE, { type: "character", trade: "gearsmith", cost: 5, threshold: "ee", strength: 4, speed: 3, life: 3 });
  assert.deepEqual([...(printing(TESTUDINE).subtype ?? [])], ["testudine", "seraphim", "dragon"]);
  const ok = tdBoard();
  assert.deepEqual(stats(ok.engine, ok.id("tw")), [4, 3, 3]);
  play(ok.engine, P1, ok.id("tw"));
  assert.equal(zoneOf(ok.engine, ok.id("tw")), "play");
  assert.equal(ready(ok.engine), 0, "exactly 5 paid");
  const short = tdBoard({ elitism: 4 });
  refused(() => play(short.engine, P1, short.id("tw")), "4 resources for cost 5");
  assert.equal(zoneOf(short.engine, short.id("tw")), "hand");
  const noIcon = tdBoard({ elitism: 1, extra: bank("greed", 5, P1) });
  refused(() => play(noIcon.engine, P1, noIcon.id("tw")), "one [E] only", /threshold|icon/i);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("tw")), "hand");
});

clause(TESTUDINE, "0:unique", "a second Testudine forces a choice: I keep one and the other is destroyed", () => {
  const b = tdBoard({ zone: "play", extra: [{ key: "tw2", def: printing(TESTUDINE), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("tw2"));
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.equal(pc?.playerId, P1);
  assert.deepEqual([...(pc?.candidates as string[])].sort(), [b.id("tw"), b.id("tw2")].sort());
  keepUnique(b.engine, P1, b.id("tw"));
  assert.equal(zoneOf(b.engine, b.id("tw")), "play");
  assert.equal(zoneOf(b.engine, b.id("tw2")), "discard");
});

clause(TESTUDINE, "0:unique", "only my own copies count: the opponent may control their own Testudine, and keeping the new one destroys the old", () => {
  const opp = mk(
    [
      { key: "tw", def: printing(TESTUDINE), owner: P1, zone: "play" },
      { key: "tw2", def: printing(TESTUDINE), owner: P2, zone: "hand" },
      ...bank("elitism", 5, P2),
      ...fillers("fd", 8, P2, "deck")
    ],
    { turn: 2, activePlayerId: P2 }
  );
  play(opp.engine, P2, opp.id("tw2"));
  assert.equal(pending(opp.engine)?.kind === "uniqueSurvivor", false, "no unique choice across players");
  assert.equal(zoneOf(opp.engine, opp.id("tw2")), "play");
  assert.equal(zoneOf(opp.engine, opp.id("tw")), "play");
  const mine = tdBoard({ zone: "play", extra: [{ key: "tw2", def: printing(TESTUDINE), owner: P1, zone: "hand" }] });
  play(mine.engine, P1, mine.id("tw2"));
  keepUnique(mine.engine, P1, mine.id("tw2"));
  assert.equal(zoneOf(mine.engine, mine.id("tw2")), "play");
  assert.equal(zoneOf(mine.engine, mine.id("tw")), "discard");
});

clause(TESTUDINE, "1:rule", "on entering play I look at the top 6 cards and may choose a character with cost 3 or less: it is revealed and put into play under my control", () => {
  const b = tdBoard();
  const top6 = tdTop6(b);
  assert.deepEqual(top6, ["gizmo", "dear", "cheap", "free", "spell", "two"].map((k) => b.id(k)), "precondition: the deck order");
  const deck0 = deckOf(b.engine, P1);
  play(b.engine, P1, b.id("tw"));
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I choose");
  const revealsBefore = b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed").length;
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("cheap")] });
  assert.equal(zoneOf(b.engine, b.id("cheap")), "play");
  assert.equal(b.engine.state.cards[b.id("cheap")].controllerId, P1);
  assert.ok(b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed").length > revealsBefore, "the chosen character was revealed");
  const order = pending(b.engine);
  assert.equal(order?.kind, "reorderDeck", "the remaining cards are put on the bottom in an order I choose");
  const ids = order!.cardIds as string[];
  assert.deepEqual([...ids].sort(), [b.id("gizmo"), b.id("dear"), b.id("free"), b.id("spell"), b.id("two")].sort(), "the other five of the six looked at");
  answerPending(b.engine, "reorderDeck", { order: [...ids].reverse() });
  assert.equal(b.engine.state.pendingChoice, undefined);
  const deck = deckOf(b.engine, P1);
  assert.equal(deck.length, deck0.length - 1, "one card left the deck");
  assert.deepEqual(deck.slice(0, 4), deck0.slice(6), "the cards below the top 6 are now on top, in order");
  assert.deepEqual(deck.slice(-5), [...ids].reverse(), "the five remaining cards are on the bottom in my chosen order");
});

clause(TESTUDINE, "1:rule", "the bottom order is MY choice (two different orders give two different decks)", () => {
  const orders: string[][] = [];
  for (const flip of [false, true]) {
    const b = tdBoard();
    play(b.engine, P1, b.id("tw"));
    answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("free")] });
    const ids = pending(b.engine)!.cardIds as string[];
    const chosen = flip ? [...ids].reverse() : [...ids];
    answerPending(b.engine, "reorderDeck", { order: chosen });
    assert.deepEqual(deckOf(b.engine, P1).slice(-5), chosen);
    orders.push(chosen.map((id) => b.engine.state.cards[id].definitionId));
  }
  assert.notDeepEqual(orders[0], orders[1]);
});

clause(TESTUDINE, "1:rule", "numeric cost 3 or less: 0, 2 and 3 can be chosen; 4 cannot; a non-character (item, tactic) cannot", () => {
  const tryPick = (key: string): boolean => {
    const b = tdBoard();
    play(b.engine, P1, b.id("tw"));
    try {
      answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id(key)] });
    } catch {
      assert.equal(zoneOf(b.engine, b.id(key)), "deck", `${key} stayed in the deck`);
      return false;
    }
    return zoneOf(b.engine, b.id(key)) === "play";
  };
  assert.equal(tryPick("cheap"), true, "cost 3 is allowed");
  assert.equal(tryPick("free"), true, "cost 0 is allowed");
  assert.equal(tryPick("two"), true, "cost 2 is allowed");
  assert.equal(tryPick("dear"), false, "cost 4 is not");
  assert.equal(tryPick("gizmo"), false, "an item is not a character");
  assert.equal(tryPick("spell"), false, "a tactic is not a character");
});

clause(TESTUDINE, "1:rule", "only the top 6 cards: a cheap character in 7th place cannot be chosen, nor can an opponent's or a hand/discard card", () => {
  const b = tdBoard({ extra: [{ key: "inhand", def: character({ name: "InHand", cost: 1 }), owner: P1, zone: "hand" }, { key: "indisc", def: character({ name: "InDisc", cost: 1 }), owner: P1, zone: "discard" }] });
  play(b.engine, P1, b.id("tw"));
  for (const key of ["seventh", "foedeck", "inhand", "indisc"]) {
    refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id(key)] }), `${key} is not among the top 6 of my deck`);
    assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the choice is still open");
  }
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("cheap")] });
  assert.equal(zoneOf(b.engine, b.id("cheap")), "play", "control: a legal pick works");
  assert.equal(zoneOf(b.engine, b.id("seventh")), "deck");
});

clause(TESTUDINE, "1:rule", "'a character': choosing two characters is refused", () => {
  const b = tdBoard();
  play(b.engine, P1, b.id("tw"));
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("cheap"), b.id("free")] }), "two characters");
  assert.equal(zoneOf(b.engine, b.id("cheap")), "deck");
  assert.equal(zoneOf(b.engine, b.id("free")), "deck");
});

clause(TESTUDINE, "1:rule", "'You may choose': declining puts all 6 looked-at cards on the bottom (in my order) and nothing enters play", () => {
  const b = tdBoard();
  const deck0 = deckOf(b.engine, P1);
  play(b.engine, P1, b.id("tw"));
  answerPending(b.engine, "chooserSelectsTarget", { selected: [] });
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "reorderDeck");
  const ids = pc!.cardIds as string[];
  assert.equal(ids.length, 6, "all six cards remain");
  answerPending(b.engine, "reorderDeck", { order: [...ids].reverse() });
  for (const key of ["gizmo", "dear", "cheap", "free", "spell", "two"]) assert.equal(zoneOf(b.engine, b.id(key)), "deck", key);
  const deck = deckOf(b.engine, P1);
  assert.equal(deck.length, deck0.length);
  assert.deepEqual(deck.slice(0, 4), deck0.slice(6));
  assert.deepEqual(deck.slice(-6), [...ids].reverse());
});

clause(TESTUDINE, "1:rule", "with no character of cost 3 or less among the top 6 nothing can be chosen: all 6 go to the bottom in my order", () => {
  const deck: Cards = [
    { key: "dear", def: character({ name: "Dear", cost: 4 }), owner: P1, zone: "deck" },
    ...fillers("it", 5, P1, "deck", (i) => item({ name: `Item${i}`, cost: 0 })),
    { key: "seventh", def: character({ name: "Seventh", cost: 1 }), owner: P1, zone: "deck" }
  ];
  const b = tdBoard({ deck });
  play(b.engine, P1, b.id("tw"));
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "reorderDeck", "no pick is offered");
  const ids = pc!.cardIds as string[];
  assert.equal(ids.length, 6);
  answerPending(b.engine, "reorderDeck", { order: [...ids].reverse() });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("seventh")), "deck");
  assert.deepEqual(deckOf(b.engine, P1)[0], b.id("seventh"), "the 7th card is now on top");
  assert.deepEqual(deckOf(b.engine, P1).slice(-6), [...ids].reverse());
});

clause(TESTUDINE, "1:rule", "a deck of fewer than 6 cards: I look at what there is", () => {
  const deck: Cards = [
    { key: "cheap", def: character({ name: "Cheap", cost: 3 }), owner: P1, zone: "deck" },
    { key: "dear", def: character({ name: "Dear", cost: 4 }), owner: P1, zone: "deck" },
    { key: "gizmo", def: item({ name: "Gizmo" }), owner: P1, zone: "deck" }
  ];
  const b = tdBoard({ deck });
  play(b.engine, P1, b.id("tw"));
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("cheap")] });
  assert.equal(zoneOf(b.engine, b.id("cheap")), "play");
  const pc = pending(b.engine);
  if (pc) {
    assert.equal(pc.kind, "reorderDeck");
    assert.equal((pc.cardIds as string[]).length, 2);
    answerPending(b.engine, "reorderDeck", { order: pc.cardIds });
  }
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(deckOf(b.engine, P1).length, 2);
});

clause(TESTUDINE, "1:rule", "it is Testudine's own entering that triggers it: another character entering play (or Testudine already in play) asks nothing", () => {
  const b = tdBoard({ zone: "play", extra: [{ key: "other", def: character({ name: "Other", cost: 0 }), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("other"));
  assert.equal(zoneOf(b.engine, b.id("other")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined, "no look at the deck");
  assert.equal(deckOf(b.engine, P1).length, tdDeck().length);
});

// =============================================================================================================
// Thabbashite Desert Creature
// COVERT. While this card is in your hand, you may reveal this card when a card that provides [V] enters play under
// your control. If you do, you may deploy this card for 2.
// Character, arcanist (monstrosity), cost 5, [O], 3 str / 3 spd / 2 life.
// =============================================================================================================
const vProvider = (name = "VProvider") => character({ name, cost: 1, text: "PROVIDES [V]", resource: { provides: ["volition"], staple: false } } as never);
function tdcBoard(o: { obs?: number; greed?: number; spentO?: number; zone?: "hand" | "discard" | "deck" | "play"; active?: PlayerId; extra?: Cards } = {}) {
  return mk(
    [
      { key: "tdc", def: printing(TDC), owner: P1, zone: o.zone ?? "hand" },
      { key: "prov", def: vProvider(), owner: P1, zone: "hand" },
      { key: "resO", def: resourceCard({ name: "ResO", resource: { provides: ["obsession"], staple: true } }), owner: P1, zone: "hand" },
      { key: "resV", def: resourceCard({ name: "ResV", resource: { provides: ["volition"], staple: false } }), owner: P1, zone: "hand" },
      { key: "fd", def: character({ name: "Fd", text: "no icons" }), owner: P1, zone: "hand" },
      { key: "chr", def: character({ name: "Chr", cost: 1, text: "no icons" }), owner: P1, zone: "hand" },
      { key: "oprov", def: vProvider("OppProv"), owner: P2, zone: "hand" },
      ...bank("obsession", o.obs ?? 4, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...spent("obsession", o.spentO ?? 0, P1),
      ...bank("greed", 3, P2),
      ...fillers("dk", 3, P1, "deck"),
      ...(o.extra ?? [])
    ],
    { activePlayerId: o.active, turn: o.active === P2 ? 2 : undefined }
  );
}
type TdcBoard = ReturnType<typeof tdcBoard>;
const revealCount = (b: TdcBoard) => b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed").length;
/** Drives the card's prompts: `reveal` answers the "may reveal", `deploy` the "may deploy for 2". Returns the kinds seen. */
function tdcAnswer(b: TdcBoard, reveal: boolean, deploy: boolean): string[] {
  const seen: string[] = [];
  let mayPays = 0;
  for (let guard = 0; guard < 8; guard++) {
    const pc = pending(b.engine);
    if (!pc) break;
    seen.push(pc.kind);
    if (pc.kind === "orderTriggers") resolveChoice(b.engine, { kind: "orderTriggers", next: (pc.triggers as unknown[])[0] });
    else if (pc.kind === "mayPay") resolveChoice(b.engine, { kind: "mayPay", pay: mayPays++ === 0 ? reveal : deploy });
    else if (pc.kind === "deployForFree") resolveChoice(b.engine, { kind: "deployForFree", cardId: b.id("tdc") });
    else throw new Error(`unexpected prompt ${pc.kind}`);
    resolvePendingResponses(b.engine);
  }
  return seen;
}
const tdcOffered = (b: TdcBoard): boolean => pending(b.engine)?.kind === "mayPay" && pending(b.engine)?.playerId === P1;

clause(TDC, "0:kw:COVERT", "printed card: an arcanist monstrosity, cost 5, [O], 3 str / 3 spd / 2 life (5 Obsession deploy it, 4 refused, 5 Greed refused)", () => {
  printedFacts(TDC, { type: "character", trade: "arcanist", cost: 5, threshold: "o", strength: 3, speed: 3, life: 2 });
  assert.deepEqual([...(printing(TDC).subtype ?? [])], ["monstrosity"]);
  const ok = tdcBoard({ obs: 5 });
  play(ok.engine, P1, ok.id("tdc"));
  assert.equal(zoneOf(ok.engine, ok.id("tdc")), "play");
  assert.equal(ready(ok.engine), 0, "exactly 5 paid");
  assert.deepEqual(stats(ok.engine, ok.id("tdc")), [3, 3, 2]);
  const short = tdcBoard({ obs: 4 });
  refused(() => play(short.engine, P1, short.id("tdc")), "4 for cost 5");
  const noIcon = tdcBoard({ obs: 0, greed: 5 });
  refused(() => play(noIcon.engine, P1, noIcon.id("tdc")), "no [O]", /threshold|icon/i);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("tdc")), "hand");
});
clause(TDC, "0:kw:COVERT", "COVERT: has the keyword (an ordinary character does not)", () => covertHasKeyword(TDC));
clause(TDC, "0:kw:COVERT", "COVERT: cannot be blocked by non-covert characters", () => covertCannotBeBlockedByNonCovert(TDC));
clause(TDC, "0:kw:COVERT", "COVERT: a party needs every member covert", () => covertPartyNeedsEveryMemberCovert(TDC));
clause(TDC, "0:kw:COVERT", "COVERT: as a blocker it blocks only covert parties", () => covertBlocksOnlyCovertParties(TDC));

clause(TDC, "1:rule", "a card that provides [V] entering play under my control while this is in my hand offers me the reveal", () => {
  const b = tdcBoard();
  play(b.engine, P1, b.id("prov"));
  assert.equal(zoneOf(b.engine, b.id("prov")), "play");
  assert.ok(tdcOffered(b), "a prompt for me");
  assert.equal(zoneOf(b.engine, b.id("tdc")), "hand", "still in hand until I decide");
});

clause(TDC, "1:rule", "'may reveal': declining leaves it in hand, unrevealed, nothing paid and no deploy offered", () => {
  const b = tdcBoard();
  play(b.engine, P1, b.id("prov"));
  const r1 = ready(b.engine);
  const reveals0 = revealCount(b);
  const seen = tdcAnswer(b, false, true);
  assert.deepEqual(seen, ["mayPay"], "only the reveal was asked");
  assert.equal(zoneOf(b.engine, b.id("tdc")), "hand");
  assert.equal(ready(b.engine), r1, "nothing paid");
  assert.equal(revealCount(b), reveals0, "not revealed");
});

clause(TDC, "1:rule", "revealing it and then declining the deploy: it was revealed, stays in hand, nothing is paid", () => {
  const b = tdcBoard();
  play(b.engine, P1, b.id("prov"));
  const r1 = ready(b.engine);
  const reveals0 = revealCount(b);
  tdcAnswer(b, true, false);
  assert.ok(revealCount(b) > reveals0, "the card was revealed");
  assert.equal(zoneOf(b.engine, b.id("tdc")), "hand");
  assert.equal(ready(b.engine), r1, "nothing paid");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(TDC, "1:rule", "revealing and deploying: it is revealed and enters play for exactly 2 (not the printed 5)", () => {
  const b = tdcBoard();
  play(b.engine, P1, b.id("prov"));
  const r1 = ready(b.engine);
  const reveals0 = revealCount(b);
  tdcAnswer(b, true, true);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("tdc")), "play", "deployed");
  assert.equal(b.engine.state.cards[b.id("tdc")].controllerId, P1);
  assert.equal(r1 - ready(b.engine), 2, "paid exactly 2");
  assert.ok(revealCount(b) > reveals0, "the card was revealed");
  assert.deepEqual(stats(b.engine, b.id("tdc")), [3, 3, 2]);
});

clause(TDC, "1:rule", "'for 2' is a real cost: with only 1 ready resource it cannot be deployed, with exactly 2 it can", () => {
  const short = tdcBoard({ obs: 2 });
  play(short.engine, P1, short.id("prov"));
  assert.equal(ready(short.engine), 1);
  try {
    tdcAnswer(short, true, true);
  } catch {
    /* the engine may refuse the payment; the board is inspected below */
  }
  assert.equal(zoneOf(short.engine, short.id("tdc")), "hand", "could not pay 2 with 1 ready resource");
  assert.equal(ready(short.engine), 1, "nothing was paid");
  const ok = tdcBoard({ obs: 3 });
  play(ok.engine, P1, ok.id("prov"));
  assert.equal(ready(ok.engine), 2);
  tdcAnswer(ok, true, true);
  assert.equal(zoneOf(ok.engine, ok.id("tdc")), "play", "control: exactly 2 is enough");
  assert.equal(ready(ok.engine), 0);
});

clause(TDC, "1:rule", "'deploy this card for 2' only replaces the numeric cost: the printed threshold [O] is still required", () => {
  const noO = tdcBoard({ obs: 0, greed: 4 });
  play(noO.engine, P1, noO.id("prov"));
  try {
    tdcAnswer(noO, true, true);
  } catch {
    /* refused: inspected below */
  }
  assert.equal(zoneOf(noO.engine, noO.id("tdc")), "hand", "no [O] icon: it cannot be deployed");
  const ok = tdcBoard({ obs: 0, greed: 4, spentO: 1 });
  play(ok.engine, P1, ok.id("prov"));
  tdcAnswer(ok, true, true);
  assert.equal(zoneOf(ok.engine, ok.id("tdc")), "play", "control: with an [O] icon it is deployed");
});

clause(TDC, "1:rule", "a face-down card developed as a resource (it provides [V]) entering play under my control offers the reveal", () => {
  const b = tdcBoard();
  developResource(b.engine, P1, b.id("fd"), true);
  assert.equal(b.engine.state.cards[b.id("fd")].faceDown, true);
  assert.equal(b.engine.getThresholds(P1).volition, 1, "it provides [V]");
  assert.ok(tdcOffered(b), "a prompt for me");
});

clause(TDC, "1:rule", "a face-up resource that provides [V], developed into play, also offers the reveal", () => {
  const b = tdcBoard();
  developResource(b.engine, P1, b.id("resV"), false);
  assert.equal(b.engine.state.cards[b.id("resV")].faceDown, false);
  assert.equal(b.engine.getThresholds(P1).volition, 1, "it provides [V]");
  assert.ok(tdcOffered(b), "a prompt for me");
});

clause(TDC, "1:rule", "a card that does NOT provide [V] entering play (a face-up Obsession staple, a deployed character) does not trigger it", () => {
  const b = tdcBoard();
  developResource(b.engine, P1, b.id("resO"), false);
  assert.equal(b.engine.state.pendingChoice, undefined, "face-up staple: no [V]");
  assert.equal(zoneOf(b.engine, b.id("tdc")), "hand");
  const c = tdcBoard();
  play(c.engine, P1, c.id("chr"));
  assert.equal(zoneOf(c.engine, c.id("chr")), "play");
  assert.equal(c.engine.state.pendingChoice, undefined, "a character provides no [V]");
  assert.equal(zoneOf(c.engine, c.id("tdc")), "hand");
});

clause(TDC, "1:rule", "only cards entering play under MY control: the opponent deploying a [V] provider does not offer it to me", () => {
  const b = tdcBoard({ active: P2 });
  play(b.engine, P2, b.id("oprov"));
  assert.equal(zoneOf(b.engine, b.id("oprov")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("tdc")), "hand");
});

clause(TDC, "1:rule", "it only works while in my hand: in the discard pile, deck or already in play it is not offered", () => {
  for (const zone of ["discard", "deck", "play"] as const) {
    const b = tdcBoard({ zone });
    play(b.engine, P1, b.id("prov"));
    assert.equal(zoneOf(b.engine, b.id("prov")), "play", zone);
    assert.equal(b.engine.state.pendingChoice, undefined, zone);
    assert.equal(zoneOf(b.engine, b.id("tdc")), zone, zone);
  }
});

// =============================================================================================================
// Thabbashite Serpent Rider
// [V]: This card gains TACTICAL.
// [V][V]: When this card inflicts damage to a character, destroy that character.
// [V][V][V]: When this card enters play, you may pick a character. If you do, inflict 1 damage to the character.
// Character, rogue (rider), cost 4, [D], 3 str / 3 spd / 1 life.
// =============================================================================================================
function srBoard(o: { zone?: "hand" | "play"; v?: number; deception?: number; active?: PlayerId; turn?: number; extra?: Cards } = {}) {
  return mk(
    [
      { key: "sr", def: printing(SERPENT), owner: P1, zone: o.zone ?? "hand" },
      ...bank("deception", o.deception ?? 4, P1),
      ...volition(o.v ?? 0, P1),
      { key: "ally", def: character({ name: "Ally", strength: 3, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      ...(o.extra ?? [])
    ],
    { activePlayerId: o.active, turn: o.turn ?? (o.active === P2 ? 2 : undefined) }
  );
}
type SrBoard = ReturnType<typeof srBoard>;

clause(SERPENT, "0:rule@v", "printed card: a rogue rider, cost 4, [D], 3 str / 3 spd / 1 life (4 resources with [D] deploy it, 3 refused, no [D] refused)", () => {
  printedFacts(SERPENT, { type: "character", trade: "rogue", cost: 4, threshold: "d", strength: 3, speed: 3, life: 1 });
  assert.deepEqual([...(printing(SERPENT).subtype ?? [])], ["rider"]);
  const ok = srBoard({ deception: 4 });
  play(ok.engine, P1, ok.id("sr"));
  assert.equal(zoneOf(ok.engine, ok.id("sr")), "play");
  assert.equal(ready(ok.engine), 0, "exactly 4 paid");
  assert.deepEqual(stats(ok.engine, ok.id("sr")), [3, 3, 1]);
  const short = srBoard({ deception: 3 });
  refused(() => play(short.engine, P1, short.id("sr")), "3 for cost 4");
  const noIcon = srBoard({ deception: 0, extra: bank("greed", 4, P1) });
  refused(() => play(noIcon.engine, P1, noIcon.id("sr")), "no [D]", /threshold|icon/i);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("sr")), "hand");
});

clause(SERPENT, "0:rule@v", "[V]: with one [V] it has TACTICAL; with no [V] it does not (in hand)", () => {
  const with1 = srBoard({ zone: "hand", v: 1 });
  assert.ok(with1.engine.getKeywords(with1.id("sr")).includes("tactical"), "TACTICAL with [V]");
  assert.equal(with1.engine.getKeywords(with1.id("ally")).includes("tactical"), false, "control: another character does not gain it");
  const none = srBoard({ zone: "hand", v: 0 });
  assert.equal(none.engine.getKeywords(none.id("sr")).includes("tactical"), false, "no TACTICAL without [V]");
});

clause(SERPENT, "0:rule@v", "[V]: with a [V] icon it can be deployed from hand in the opponent's response window (TACTICAL)", () => {
  const b = srBoard({ v: 1, active: P2, extra: [{ key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  play(b.engine, P1, b.id("sr"));
  assert.equal(zoneOf(b.engine, b.id("sr")), "play", "deployed on the opponent's turn");
});

clause(SERPENT, "0:rule@v", "without [V] it is an ordinary character: it cannot be deployed in the opponent's response window", () => {
  const b = srBoard({ v: 0, active: P2, extra: [{ key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  refused(() => play(b.engine, P1, b.id("sr")), "not tactical without [V]");
  assert.equal(zoneOf(b.engine, b.id("sr")), "hand");
});

/** The Rider (in play) attacks the opponent's `Foe` (life 9, strength 1, speed 1); Foe blocks. Returns the board after the battle. */
function srAttack(v: number): SrBoard {
  const b = srBoard({ zone: "play", v });
  declareAttackBy(b.engine, P1, [b.id("sr")]);
  declareBlockers(b.engine, P2, [b.id("foe")]);
  finishBattle(b.engine);
  return b;
}

clause(SERPENT, "1:rule@vv", "[V][V]: damage the Rider inflicts to a blocking character destroys it, however tough (attacking)", () => {
  const b = srAttack(2);
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard", "the 9-life blocker was destroyed by 3 damage");
  assert.equal(zoneOf(b.engine, b.id("sr")), "play", "the Rider (speed 3) struck first and lives");
});

clause(SERPENT, "1:rule@vv", "[V][V]: with only one [V] (or none) the damage is just damage", () => {
  for (const v of [0, 1]) {
    const b = srAttack(v);
    assert.equal(zoneOf(b.engine, b.id("foe")), "play", `v=${v}: the blocker survives`);
    assert.equal(b.engine.state.cards[b.id("foe")].damage, 3, `v=${v}: with 3 damage`);
  }
});

clause(SERPENT, "1:rule@vv", "[V][V]: also when the Rider BLOCKS - it destroys the attacking character it damages", () => {
  const b = srBoard({ zone: "play", v: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Atk", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" }] });
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  declareBlockers(b.engine, P1, [b.id("sr")]);
  finishBattle(b.engine);
  assert.equal(zoneOf(b.engine, b.id("atk")), "discard", "the attacker was destroyed");
  const control = srBoard({ zone: "play", v: 1, active: P2, extra: [{ key: "atk", def: character({ name: "Atk", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" }] });
  declareAttackBy(control.engine, P2, [control.id("atk")]);
  declareBlockers(control.engine, P1, [control.id("sr")]);
  finishBattle(control.engine);
  assert.equal(zoneOf(control.engine, control.id("atk")), "play", "control: one [V] does not destroy");
});

clause(SERPENT, "1:rule@vv", "[V][V]: only damage THIS card inflicts - another character's damage in the same battle does not destroy", () => {
  const b = srBoard({ zone: "play", v: 2 });
  declareAttackBy(b.engine, P1, [b.id("ally")]);
  declareBlockers(b.engine, P2, [b.id("foe")]);
  finishBattle(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foe")), "play", "the ally's 3 damage does not destroy a 9-life character");
  assert.equal(b.engine.state.cards[b.id("foe")].damage, 3);
});

clause(SERPENT, "1:rule@vv", "[V][V]: damage to a faction (unblocked) destroys nothing", () => {
  const b = srBoard({ zone: "play", v: 2 });
  const f0 = factionInfluence(b.engine, P2);
  declareAttackBy(b.engine, P1, [b.id("sr")]);
  declareBlockers(b.engine, P2, []);
  finishBattle(b.engine);
  assert.equal(factionInfluence(b.engine, P2), f0 - 3, "3 damage to the faction");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  assert.equal(zoneOf(b.engine, b.id("foe2")), "play");
});

clause(SERPENT, "2:rule@vvv", "[V][V][V]: on entering play I may pick a character; I pick the opponent's and 1 damage is inflicted to it", () => {
  const b = srBoard({ v: 3 });
  play(b.engine, P1, b.id("sr"));
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1, "I pick");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("foe")] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  // 1 damage is inflicted BY the Rider, and with [V][V] its damage destroys the character (the [V][V] rule applies at [V][V][V] too).
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard", "1 damage from this card destroys the character at [V][V]");
});

clause(SERPENT, "2:rule@vvv", "[V][V][V]: I may pick my own character too (it takes the damage); 'you may' - declining inflicts nothing", () => {
  const own = srBoard({ v: 3, extra: [{ key: "mine", def: character({ name: "Mine", strength: 1, life: 5, speed: 1 }), owner: P1, zone: "play" }] });
  play(own.engine, P1, own.id("sr"));
  answerPending(own.engine, "chooserSelectsTarget", { selected: [own.id("mine")] });
  assert.ok(zoneOf(own.engine, own.id("mine")) === "discard" || own.engine.state.cards[own.id("mine")].damage === 1, "my character took the 1 damage");
  const decline = srBoard({ v: 3 });
  play(decline.engine, P1, decline.id("sr"));
  answerPending(decline.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(decline.engine.state.pendingChoice, undefined);
  for (const k of ["foe", "foe2", "ally"]) {
    assert.equal(zoneOf(decline.engine, decline.id(k)), "play", k);
    assert.equal(decline.engine.state.cards[decline.id(k)].damage ?? 0, 0, `${k} took no damage`);
  }
});

clause(SERPENT, "2:rule@vvv", "[V][V][V]: the pick must be a character (an item or a faction is refused) and only one", () => {
  const b = srBoard({ v: 3, extra: [{ key: "it", def: item({ name: "It" }), owner: P2, zone: "play" }] });
  play(b.engine, P1, b.id("sr"));
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("it")] }), "an item");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [factionOf(b.engine, P2)] }), "a faction");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("foe"), b.id("foe2")] }), "two characters");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the choice is still open");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("foe2")] });
  assert.equal(zoneOf(b.engine, b.id("foe")), "play", "control: only the picked character was hit");
});

clause(SERPENT, "2:rule@vvv", "[V][V][V]: with only two [V] (or none) entering play asks nothing and damages nothing", () => {
  for (const v of [0, 2]) {
    const b = srBoard({ v });
    play(b.engine, P1, b.id("sr"));
    assert.equal(zoneOf(b.engine, b.id("sr")), "play");
    assert.equal(b.engine.state.pendingChoice, undefined, `v=${v}: no pick offered`);
    assert.equal(b.engine.state.cards[b.id("foe")].damage ?? 0, 0);
  }
});

clause(SERPENT, "2:rule@vvv", "[V][V][V]: it is the Rider's OWN entering that triggers it - another card entering play asks nothing", () => {
  const b = srBoard({ zone: "play", v: 3, extra: [{ key: "other", def: character({ name: "Other", cost: 0 }), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("other"));
  assert.equal(zoneOf(b.engine, b.id("other")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

// =============================================================================================================
// The Ministry of Other Smaller Smaller Ministries
// Each opponent must pay 2 to form an attacking party.
// Location, banker, cost 3, [G][G], structure 5.
// =============================================================================================================
function minBoard(o: { oppReady?: number; ownReady?: number; ministryOwner?: PlayerId; zone?: "hand" | "play"; extra?: Cards; ownersTurn?: boolean } = {}) {
  const owner = o.ministryOwner ?? P1;
  const other = owner === P1 ? P2 : P1;
  return mk(
    [
      { key: "min", def: printing(MINISTRY), owner, zone: o.zone ?? "play" },
      { key: "atk", def: character({ name: "Atk", strength: 2, life: 4, speed: 2 }), owner: other, zone: "play" },
      { key: "atk2", def: character({ name: "Atk2", strength: 2, life: 4, speed: 2 }), owner: other, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: 2 }), owner, zone: "play" },
      ...bank("greed", o.oppReady ?? 0, other),
      ...bank("greed", o.ownReady ?? 0, owner),
      ...(o.extra ?? [])
    ],
    o.ownersTurn ? { activePlayerId: owner, turn: owner === P2 ? 2 : 1 } : { activePlayerId: other, turn: other === P2 ? 2 : 1 }
  );
}

clause(MINISTRY, "0:rule", "printed card: a banker location, cost 3, [G][G], structure 5; deploys for exactly 3 and is refused one short or one [G] short", () => {
  printedFacts(MINISTRY, { type: "location", trade: "banker", cost: 3, threshold: "gg", structure: 5 });
  const mkHand = (greed: number, rage: number) =>
    mk([{ key: "min", def: printing(MINISTRY), owner: P1, zone: "hand" }, ...bank("greed", greed, P1), ...bank("rage", rage, P1)]);
  const ok = mkHand(2, 1);
  play(ok.engine, P1, ok.id("min"));
  assert.equal(zoneOf(ok.engine, ok.id("min")), "play");
  assert.equal(ready(ok.engine), 0, "exactly 3 paid");
  assert.equal(ok.engine.getStat(ok.id("min"), "structure"), 5);
  const short = mkHand(2, 0);
  refused(() => play(short.engine, P1, short.id("min")), "2 resources for cost 3");
  const noIcon = mkHand(1, 3);
  refused(() => play(noIcon.engine, P1, noIcon.id("min")), "one [G] only", /threshold|icon/i);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("min")), "hand");
});

clause(MINISTRY, "0:rule", "the opponent forming an attacking party pays exactly 2 resources", () => {
  const b = minBoard({ oppReady: 3 });
  assert.equal(ready(b.engine, P2), 3);
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  assert.ok(b.engine.state.battle, "the attack was declared");
  assert.equal(ready(b.engine, P2), 1, "2 paid");
  const exact = minBoard({ oppReady: 2 });
  declareAttackBy(exact.engine, P2, [exact.id("atk")]);
  assert.ok(exact.engine.state.battle, "exact.engine.state.battle");
  assert.equal(ready(exact.engine, P2), 0);
});

clause(MINISTRY, "0:rule", "with fewer than 2 ready resources the opponent cannot form an attacking party (nothing is paid, no battle)", () => {
  for (const n of [0, 1]) {
    const b = minBoard({ oppReady: n });
    refused(() => declareAttackBy(b.engine, P2, [b.id("atk")]), `${n} ready resources`);
    assert.equal(b.engine.state.battle, undefined);
    assert.equal(ready(b.engine, P2), n, "nothing paid");
  }
});

clause(MINISTRY, "0:rule", "one payment per attacking party: a two-character party still pays 2 once", () => {
  const b = minBoard({ oppReady: 3 });
  declareAttackBy(b.engine, P2, [b.id("atk"), b.id("atk2")]);
  assert.ok(b.engine.state.battle, "b.engine.state.battle");
  assert.equal(ready(b.engine, P2), 1, "paid 2, not 4");
});

clause(MINISTRY, "0:rule", "only opponents pay: the Ministry's controller attacks for free, and blocking costs nobody anything", () => {
  const b = mk(
    [
      { key: "min", def: printing(MINISTRY), owner: P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      ...bank("greed", 3, P1),
      ...bank("greed", 3, P2)
    ]
  );
  declareAttackBy(b.engine, P1, [b.id("mine")]);
  assert.ok(b.engine.state.battle, "b.engine.state.battle");
  assert.equal(ready(b.engine, P1), 3, "the controller paid nothing to attack");
  declareBlockers(b.engine, P2, [b.id("foe")]);
  assert.equal(ready(b.engine, P2), 3, "the blocker paid nothing");
  assert.equal(ready(b.engine, P1), 3);
});

clause(MINISTRY, "0:rule", "it is the Ministry's controller's OPPONENT who pays: with the opponent's Ministry I pay to attack", () => {
  const b = minBoard({ ministryOwner: P2, oppReady: 3, ownReady: 3 });
  // the attacker here is P1 (active), the Ministry belongs to P2
  assert.equal(b.engine.state.activePlayerId, P1);
  declareAttackBy(b.engine, P1, [b.id("atk")]);
  assert.ok(b.engine.state.battle, "b.engine.state.battle");
  assert.equal(ready(b.engine, P1), 1, "I paid 2 to attack into the opponent's Ministry");
  assert.equal(ready(b.engine, P2), 3, "the Ministry's controller paid nothing");
});

clause(MINISTRY, "0:rule", "no Ministry in play (still in hand, or destroyed): no payment is required", () => {
  const hand = minBoard({ zone: "hand", oppReady: 0 });
  declareAttackBy(hand.engine, P2, [hand.id("atk")]);
  assert.ok(hand.engine.state.battle, "attacks for free while the Ministry is in hand");
  const gone = minBoard({ oppReady: 0, ownersTurn: true, extra: [{ key: "k", def: KILLER(), owner: P1, zone: "play" }] });
  activate(gone.engine, P1, gone.id("k"), "kill", { selected: { t: [gone.id("min")] } });
  assert.equal(zoneOf(gone.engine, gone.id("min")), "discard");
  endTurn(gone.engine, P1);
  assert.equal(gone.engine.state.activePlayerId, P2);
  declareAttackBy(gone.engine, P2, [gone.id("atk")]);
  assert.ok(gone.engine.state.battle, "after the Ministry left play the attack is free");
});

clause(MINISTRY, "0:rule", "each Ministry is its own requirement: two Ministries make the opponent pay 2 + 2", () => {
  const b = minBoard({ oppReady: 3, extra: [{ key: "min2", def: printing(MINISTRY), owner: P1, zone: "play" }] });
  refused(() => declareAttackBy(b.engine, P2, [b.id("atk")]), "3 ready resources against two Ministries");
  assert.equal(ready(b.engine, P2), 3, "nothing paid");
  const ok = minBoard({ oppReady: 4, extra: [{ key: "min2", def: printing(MINISTRY), owner: P1, zone: "play" }] });
  declareAttackBy(ok.engine, P2, [ok.id("atk")]);
  assert.ok(ok.engine.state.battle, "ok.engine.state.battle");
  assert.equal(ready(ok.engine, P2), 0, "paid 4");
});

// =============================================================================================================
// Tough Crowd
// EXTRA COST: Deploy this only in response to a card being deployed. X is its numeric cost.
// If that card's owner has at least X cards in their discard pile, terminate that card.
// Tactic, rogue, cost 3, [D][D].
// =============================================================================================================
function tcBoard(o: { discard?: number; cost?: number; dec?: number; myDiscard?: number; extra?: Cards; subject?: "char" | "tactic" } = {}) {
  const cost = o.cost ?? 3;
  const subject =
    o.subject === "tactic"
      ? tactic({ name: "Subject", cost, behavior: { abilities: [{ id: "b", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } as never })
      : character({ name: "Subject", cost });
  return mk(
    [
      { key: "tc", def: printing(TOUGH), owner: P1, zone: "hand" },
      ...bank("deception", o.dec ?? 3, P1),
      { key: "g", def: subject, owner: P2, zone: "hand" },
      ...bank("greed", cost, P2),
      ...fillers("x", o.discard ?? 0, P2, "discard"),
      ...fillers("m", o.myDiscard ?? 0, P1, "discard"),
      ...fillers("p2dk", 3, P2, "deck"),
      ...(o.extra ?? [])
    ],
    { activePlayerId: P2, turn: 2 }
  );
}
type TcBoard = ReturnType<typeof tcBoard>;
const tcDeploy = (b: TcBoard) => playRaw(b.engine, P2, b.id("g"));
const tcRespond = (b: TcBoard) => {
  playRaw(b.engine, P1, b.id("tc"));
  resolvePendingResponses(b.engine);
};

clause(TOUGH, "0:extraCost", "printed card: a rogue tactic, cost 3, [D][D]; 3 resources pay exactly, 2 are refused, one [D] is refused", () => {
  printedFacts(TOUGH, { type: "tactic", trade: "rogue", cost: 3, threshold: "dd" });
  const ok = tcBoard({ dec: 4 });
  tcDeploy(ok);
  const before = ready(ok.engine, P1);
  playRaw(ok.engine, P1, ok.id("tc"));
  assert.equal(before - ready(ok.engine, P1), 3, "exactly 3 paid");
  const short = tcBoard({ dec: 2 });
  tcDeploy(short);
  refused(() => playRaw(short.engine, P1, short.id("tc")), "2 resources for cost 3");
  assert.equal(zoneOf(short.engine, short.id("tc")), "hand");
  const noIcon = tcBoard({ dec: 1, extra: bank("greed", 3, P1) });
  tcDeploy(noIcon);
  refused(() => playRaw(noIcon.engine, P1, noIcon.id("tc")), "one [D] only", /threshold|icon/i);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("tc")), "hand");
});

clause(TOUGH, "0:extraCost", "it can only be deployed in response to a card being deployed: with nothing on the stack it is refused", () => {
  const b = tcBoard();
  refused(() => playRaw(b.engine, P1, b.id("tc")), "no card is being deployed", ANY);
  assert.equal(zoneOf(b.engine, b.id("tc")), "hand");
  assert.equal(ready(b.engine, P1), 3, "nothing paid");
  tcDeploy(b);
  playRaw(b.engine, P1, b.id("tc"));
  assert.notEqual(zoneOf(b.engine, b.id("tc")), "hand", "control: in response to the deploy it is played");
});

clause(TOUGH, "0:extraCost", "an ability on the stack is not a card being deployed: it is refused in response to an activated ability", () => {
  const abilityChar = character({
    name: "AbilityGuy",
    behavior: { abilities: [{ id: "poke", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } as never
  });
  const b = tcBoard({ extra: [{ key: "ag", def: abilityChar, owner: P2, zone: "play" }] });
  b.engine.perform({ type: "activateAbility", playerId: P2, cardId: b.id("ag"), abilityId: "poke", selected: {}, variables: {} } as never);
  assert.ok(b.engine.state.responseStack.length > 0, "the ability is on the stack");
  refused(() => playRaw(b.engine, P1, b.id("tc")), "an ability, not a deployed card", ANY);
  assert.equal(zoneOf(b.engine, b.id("tc")), "hand");
});

clause(TOUGH, "1:rule", "X is the deployed card's numeric cost: its owner has 3 cards in the discard pile and the card costs 3 - it is terminated", () => {
  const b = tcBoard({ discard: 3, cost: 3 });
  tcDeploy(b);
  tcRespond(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("g")), "discard", "terminated: it never entered play");
  assert.equal(b.engine.state.cards[b.id("g")].ownerId, P2);
  assert.equal(zoneOf(b.engine, b.id("tc")), "discard");
});

clause(TOUGH, "1:rule", "with MORE than X cards in the discard pile it is terminated too ('at least')", () => {
  const b = tcBoard({ discard: 6, cost: 3 });
  tcDeploy(b);
  tcRespond(b);
  assert.equal(zoneOf(b.engine, b.id("g")), "discard");
});

clause(TOUGH, "1:rule", "with one fewer than X (2 cards, cost 3) it is NOT terminated: the deployed card enters play and Tough Crowd is spent", () => {
  const b = tcBoard({ discard: 2, cost: 3 });
  tcDeploy(b);
  tcRespond(b);
  assert.equal(zoneOf(b.engine, b.id("g")), "play", "the card was not terminated");
  assert.equal(zoneOf(b.engine, b.id("tc")), "discard", "Tough Crowd was still played and discarded");
});

clause(TOUGH, "1:rule", "X scales with the cost: a 5-cost card needs 5 discards (4 fails, 5 terminates)", () => {
  const four = tcBoard({ discard: 4, cost: 5 });
  tcDeploy(four);
  tcRespond(four);
  assert.equal(zoneOf(four.engine, four.id("g")), "play");
  const five = tcBoard({ discard: 5, cost: 5 });
  tcDeploy(five);
  tcRespond(five);
  assert.equal(zoneOf(five.engine, five.id("g")), "discard");
});

clause(TOUGH, "1:rule", "it is the card's OWNER's discard pile that counts, not mine", () => {
  const b = tcBoard({ discard: 2, myDiscard: 6, cost: 3 });
  tcDeploy(b);
  tcRespond(b);
  assert.equal(zoneOf(b.engine, b.id("g")), "play", "the owner has only 2 cards in their discard pile");
});

clause(TOUGH, "1:rule", "X = 0 for a cost-0 card: an empty discard pile is 'at least 0', so it is terminated", () => {
  const b = tcBoard({ discard: 0, cost: 0 });
  tcDeploy(b);
  tcRespond(b);
  assert.equal(zoneOf(b.engine, b.id("g")), "discard");
});

clause(TOUGH, "1:rule", "it terminates a deployed tactic too: the tactic's effect does not happen", () => {
  const b = tcBoard({ discard: 2, cost: 2, subject: "tactic" });
  const hand0 = handOf(b.engine, P2).length;
  tcDeploy(b);
  tcRespond(b);
  assert.equal(zoneOf(b.engine, b.id("g")), "discard");
  assert.equal(handOf(b.engine, P2).length, hand0 - 1, "the tactic left the hand and its 'draw a card' did not happen");
  const ok = tcBoard({ discard: 1, cost: 2, subject: "tactic" });
  const h1 = handOf(ok.engine, P2).length;
  tcDeploy(ok);
  tcRespond(ok);
  assert.equal(handOf(ok.engine, P2).length, h1, "control: not terminated (1 < 2), the tactic drew its card");
});

// =============================================================================================================
// Uhluhtc Unleashed
// UNIQUE UHLUHTC. When this card enters play, if it was deployed from your hand, pick an opponent and then choose one of the following:
// OPTION 1 -- Look at that player's hand and choose a non-resource card in it. That player discards that card.
// OPTION 2 -- That player must destroy a character they control.
// Character, arcanist (uhluhtc, seraphim, dragon), cost 5, [O][O][O], 4 str / 3 spd / 3 life.
// =============================================================================================================
const RAISE = () =>
  tactic({
    name: "Raise",
    cost: 0,
    behavior: {
      abilities: [{ id: "r", type: "activated", targets: [{ id: "c", selector: { owner: "self", zone: "discard", type: "character" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "c" }, controller: "controller" }] }]
    } as never
  });
function uhBoard(o: { zone?: "hand" | "play" | "discard"; obs?: number; oppHand?: "mixed" | "resources" | "none"; foes?: 0 | 1 | 2; extra?: Cards } = {}) {
  const hand: Cards =
    o.oppHand === "none"
      ? []
      : o.oppHand === "resources"
        ? [
            { key: "r1", def: resourceCard({ name: "OppRes1", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" },
            { key: "r2", def: resourceCard({ name: "OppRes2", resource: { provides: ["greed"], staple: true } }), owner: P2, zone: "hand" }
          ]
        : [
            { key: "hc", def: character({ name: "HandChar" }), owner: P2, zone: "hand" },
            { key: "ht", def: tactic({ name: "HandTactic" }), owner: P2, zone: "hand" },
            { key: "hr", def: resourceCard({ name: "HandRes", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" }
          ];
  const foes = o.foes ?? 2;
  return mk([
    { key: "uh", def: printing(UHLUHTC), owner: P1, zone: o.zone ?? "hand" },
    ...bank("obsession", o.obs ?? 5, P1),
    ...hand,
    { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
    ...(foes >= 1 ? ([{ key: "foe1", def: character({ name: "Foe1" }), owner: P2, zone: "play" }] as Cards) : []),
    ...(foes >= 2 ? ([{ key: "foe2", def: character({ name: "Foe2" }), owner: P2, zone: "play" }] as Cards) : []),
    { key: "foeit", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
    ...(o.extra ?? [])
  ]);
}
type UhBoard = ReturnType<typeof uhBoard>;
const uhOptions = (b: UhBoard): unknown => (pending(b.engine) as { options?: unknown } | undefined)?.options;

clause(UHLUHTC, "0:unique", "printed card: an arcanist (uhluhtc, seraphim, dragon), cost 5, [O][O][O], 4 str / 3 spd / 3 life; exactly 5 deploys it, 4 or one [O] short are refused", () => {
  printedFacts(UHLUHTC, { type: "character", trade: "arcanist", cost: 5, threshold: "ooo", strength: 4, speed: 3, life: 3 });
  assert.deepEqual([...(printing(UHLUHTC).subtype ?? [])], ["uhluhtc", "seraphim", "dragon"]);
  const ok = uhBoard();
  assert.deepEqual(stats(ok.engine, ok.id("uh")), [4, 3, 3]);
  play(ok.engine, P1, ok.id("uh"));
  assert.equal(zoneOf(ok.engine, ok.id("uh")), "play");
  assert.equal(ready(ok.engine), 0, "exactly 5 paid");
  const short = uhBoard({ obs: 4 });
  refused(() => play(short.engine, P1, short.id("uh")), "4 resources for cost 5");
  assert.equal(zoneOf(short.engine, short.id("uh")), "hand");
  const noIcon = uhBoard({ obs: 2, extra: bank("greed", 5, P1) });
  refused(() => play(noIcon.engine, P1, noIcon.id("uh")), "two [O] only", /threshold|icon/i);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("uh")), "hand");
});

clause(UHLUHTC, "0:unique", "a second Uhluhtc Unleashed forces a choice: I keep one and the other is destroyed", () => {
  const b = uhBoard({ extra: [{ key: "uh2", def: printing(UHLUHTC), owner: P1, zone: "play" }] });
  play(b.engine, P1, b.id("uh"));
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.equal(pc?.playerId, P1);
  assert.deepEqual([...(pc?.candidates as string[])].sort(), [b.id("uh"), b.id("uh2")].sort());
  keepUnique(b.engine, P1, b.id("uh2"));
  assert.equal(zoneOf(b.engine, b.id("uh2")), "play");
  assert.equal(zoneOf(b.engine, b.id("uh")), "discard");
});

clause(UHLUHTC, "0:unique", "only my own copies count: the opponent may control their own Uhluhtc Unleashed with no unique choice", () => {
  const b = mk(
    [
      { key: "uh", def: printing(UHLUHTC), owner: P1, zone: "play" },
      { key: "uh2", def: printing(UHLUHTC), owner: P2, zone: "hand" },
      ...bank("obsession", 5, P2)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  play(b.engine, P2, b.id("uh2"));
  assert.notEqual(pending(b.engine)?.kind, "uniqueSurvivor");
  assert.equal(zoneOf(b.engine, b.id("uh2")), "play");
  assert.equal(zoneOf(b.engine, b.id("uh")), "play");
});

clause(UHLUHTC, "1:rule", "deployed from my hand: I choose between the two options (a prompt for me)", () => {
  const b = uhBoard();
  play(b.engine, P1, b.id("uh"));
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsOption");
  assert.equal(pc?.playerId, P1, "I choose the option");
  assert.equal((uhOptions(b) as unknown[] | undefined)?.length ?? pc?.optionCount, 2, "two options");
});

clause(UHLUHTC, "1:rule", "it triggers only when deployed from hand: put into play from the discard pile by an effect, nothing is asked or done", () => {
  const b = uhBoard({ zone: "discard", extra: [{ key: "raise", def: RAISE(), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("raise"), { selected: { c: [b.id("uh")] } });
  assert.equal(zoneOf(b.engine, b.id("uh")), "play", "it entered play");
  assert.equal(b.engine.state.pendingChoice, undefined, "no option prompt");
  assert.equal(handOf(b.engine, P2).length, 3, "the opponent's hand is untouched");
  assert.equal(zoneOf(b.engine, b.id("foe1")), "play");
  assert.equal(zoneOf(b.engine, b.id("foe2")), "play");
});

clause(UHLUHTC, "1:rule", "it is Uhluhtc's own entering that triggers it: another card entering play (with Uhluhtc already in play) asks nothing", () => {
  const b = uhBoard({ zone: "play", extra: [{ key: "other", def: character({ name: "Other", cost: 0 }), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("other"));
  assert.equal(zoneOf(b.engine, b.id("other")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(UHLUHTC, "2:option:OPTION 1", "OPTION 1: I look at the opponent's hand, choose a non-resource card, and they discard exactly that card", () => {
  const b = uhBoard();
  play(b.engine, P1, b.id("uh"));
  answerPending(b.engine, "chooserSelectsOption", { index: 0 });
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1, "I choose the card");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("ht")] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("ht")), "discard");
  assert.ok(discardOf(b.engine, P2).includes(b.id("ht")), "in THEIR discard pile");
  assert.equal(zoneOf(b.engine, b.id("hc")), "hand", "the other cards stay");
  assert.equal(zoneOf(b.engine, b.id("hr")), "hand");
  assert.equal(zoneOf(b.engine, b.id("foe1")), "play", "OPTION 2 did not happen");
  assert.equal(zoneOf(b.engine, b.id("foe2")), "play");
});

clause(UHLUHTC, "2:option:OPTION 1", "OPTION 1: a resource card in their hand cannot be chosen; only one card may be chosen", () => {
  const b = uhBoard();
  play(b.engine, P1, b.id("uh"));
  answerPending(b.engine, "chooserSelectsOption", { index: 0 });
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("hr")] }), "a resource card");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("hc"), b.id("ht")] }), "two cards");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("mine")] }), "a card in play");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still open");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("hc")] });
  assert.equal(zoneOf(b.engine, b.id("hc")), "discard", "control: a non-resource card is chosen");
  assert.equal(zoneOf(b.engine, b.id("hr")), "hand");
});

clause(UHLUHTC, "2:option:OPTION 1", "OPTION 1: with only resource cards (or nothing) in their hand, nothing is discarded and the game goes on", () => {
  for (const oppHand of ["resources", "none"] as const) {
    const b = uhBoard({ oppHand });
    const n0 = handOf(b.engine, P2).length;
    play(b.engine, P1, b.id("uh"));
    if (pending(b.engine)?.kind === "chooserSelectsOption") answerPending(b.engine, "chooserSelectsOption", { index: 0 });
    if (pending(b.engine)?.kind === "chooserSelectsTarget") answerPending(b.engine, "chooserSelectsTarget", { selected: [] });
    assert.equal(b.engine.state.pendingChoice, undefined, oppHand);
    assert.equal(handOf(b.engine, P2).length, n0, `${oppHand}: nothing discarded`);
    assert.equal(zoneOf(b.engine, b.id("uh")), "play");
  }
});

clause(UHLUHTC, "3:option:OPTION 2", "OPTION 2: the opponent must destroy a character THEY control, and they choose which", () => {
  const b = uhBoard();
  play(b.engine, P1, b.id("uh"));
  answerPending(b.engine, "chooserSelectsOption", { index: 1 });
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P2, "the opponent chooses");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("mine")] }), "my character");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("uh")] }), "Uhluhtc itself");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("foeit")] }), "their item");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [] }), "a mandatory destruction cannot be skipped");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("foe1"), b.id("foe2")] }), "only one");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("foe2")] });
  assert.equal(zoneOf(b.engine, b.id("foe2")), "discard");
  assert.equal(zoneOf(b.engine, b.id("foe1")), "play", "only the chosen one");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  assert.equal(zoneOf(b.engine, b.id("uh")), "play");
  assert.equal(handOf(b.engine, P2).length, 3, "OPTION 1 did not happen");
});

clause(UHLUHTC, "3:option:OPTION 2", "OPTION 2: with exactly one character they control it is destroyed; with none nothing happens (their item is not a character)", () => {
  const one = uhBoard({ foes: 1 });
  play(one.engine, P1, one.id("uh"));
  answerPending(one.engine, "chooserSelectsOption", { index: 1 });
  if (pending(one.engine)?.kind === "chooserSelectsTarget") answerPending(one.engine, "chooserSelectsTarget", { selected: [one.id("foe1")] });
  assert.equal(zoneOf(one.engine, one.id("foe1")), "discard");
  assert.equal(zoneOf(one.engine, one.id("mine")), "play");
  const none = uhBoard({ foes: 0 });
  play(none.engine, P1, none.id("uh"));
  answerPending(none.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(none.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(none.engine, none.id("foeit")), "play", "an item is not a character");
  assert.equal(zoneOf(none.engine, none.id("mine")), "play");
});

// =============================================================================================================
// Unleash the Majigs
// Put 3 Micromajig tokens into play.
// Tactic, gearsmith, cost 4, [E][E].
// =============================================================================================================
const tokensOf = (e: SpoilsEngine, p: PlayerId): CardInstanceId[] =>
  Object.values(e.state.cards)
    .filter((c) => (c as { isToken?: boolean }).isToken && c.zone === "play" && c.controllerId === p)
    .map((c) => c.id);
function unBoard(o: { elitism?: number; extra?: Cards } = {}) {
  return mk([{ key: "um", def: printing(UNLEASH), owner: P1, zone: "hand" }, ...bank("elitism", o.elitism ?? 4, P1), ...(o.extra ?? [])]);
}

clause(UNLEASH, "0:rule", "printed card: a gearsmith tactic, cost 4, [E][E]; exactly 4 deploys it, 3 or one [E] short are refused", () => {
  printedFacts(UNLEASH, { type: "tactic", trade: "gearsmith", cost: 4, threshold: "ee" });
  const ok = unBoard();
  play(ok.engine, P1, ok.id("um"));
  assert.equal(zoneOf(ok.engine, ok.id("um")), "discard");
  assert.equal(ready(ok.engine), 0, "exactly 4 paid");
  const short = unBoard({ elitism: 3 });
  refused(() => play(short.engine, P1, short.id("um")), "3 resources for cost 4");
  assert.equal(zoneOf(short.engine, short.id("um")), "hand");
  assert.equal(tokensOf(short.engine, P1).length, 0);
  const noIcon = unBoard({ elitism: 1, extra: bank("greed", 4, P1) });
  refused(() => play(noIcon.engine, P1, noIcon.id("um")), "one [E] only", /threshold|icon/i);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("um")), "hand");
});

clause(UNLEASH, "0:rule", "puts exactly 3 Micromajig tokens into play under my control (none for the opponent)", () => {
  const b = unBoard();
  play(b.engine, P1, b.id("um"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  const mine = tokensOf(b.engine, P1);
  assert.equal(mine.length, 3, "three tokens");
  assert.equal(tokensOf(b.engine, P2).length, 0, "the opponent gets none");
  for (const t of mine) {
    assert.equal(b.engine.getDefinition(t).name, "Micromajig");
    assert.ok(b.engine.state.players[P1].play.includes(t), "in my play zone");
    assert.equal(b.engine.state.cards[t].ownerId, P1, "I own the tokens (CR 409.3b)");
  }
  assert.equal(new Set(mine).size, 3, "three distinct tokens");
});

clause(UNLEASH, "0:rule", "each token is a Micromajig: a character with 1 strength, 1 life, 3 speed and the 'majig' subtype (CR 409.3c: a Gearsmith character)", () => {
  const b = unBoard();
  play(b.engine, P1, b.id("um"));
  for (const t of tokensOf(b.engine, P1)) {
    assert.deepEqual(b.engine.getCardTypes(t), ["character"]);
    assert.deepEqual(stats(b.engine, t), [1, 3, 1]);
    assert.ok((b.engine.getDefinition(t).subtype ?? []).includes("majig"), "subtype majig");
    assert.equal(b.engine.getDefinition(t).trade, "gearsmith", "Micromajig tokens are Gearsmith characters");
  }
});

clause(UNLEASH, "0:rule", "playing it twice puts 6 tokens into play (3 each time)", () => {
  const b = mk([
    { key: "um", def: printing(UNLEASH), owner: P1, zone: "hand" },
    { key: "um2", def: printing(UNLEASH), owner: P1, zone: "hand" },
    ...bank("elitism", 8, P1)
  ]);
  play(b.engine, P1, b.id("um"));
  assert.equal(tokensOf(b.engine, P1).length, 3);
  play(b.engine, P1, b.id("um2"));
  assert.equal(tokensOf(b.engine, P1).length, 6);
});

// =============================================================================================================
// Unwelcome Hero
// TACTICAL. While this card is in play, ignore all triggers that begin with "when this card enters play" or "when this card leaves play".
// Character, universal (outcast, vigilante), cost 5, [V], 3 str / 3 spd / 3 life.
// =============================================================================================================
const etbInfluence = (name: string) =>
  character({
    name,
    cost: 0,
    life: 4,
    behavior: { abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "modifyInfluence", player: "controller", amount: -1 }] }] } as never
  });
const ltpInfluence = (name: string) =>
  character({
    name,
    cost: 0,
    life: 4,
    behavior: {
      abilities: [{ id: "ltp", type: "triggered", event: "cardMoved", condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, { type: "cardMovedFromZone", zone: "play" }] }, effects: [{ type: "modifyInfluence", player: "controller", amount: -1 }] }]
    } as never
  });
const watcher = () =>
  character({
    name: "Watcher",
    cost: 0,
    life: 4,
    behavior: { abilities: [{ id: "watch", type: "triggered", event: "cardEnteredPlay", condition: { type: "eventCardControlledBy", player: "controller" }, effects: [{ type: "modifyInfluence", player: "controller", amount: -1 }] }] } as never
  });
function heroBoard(o: { zone?: "hand" | "play"; owner?: PlayerId; extra?: Cards; v?: number; others?: number; active?: PlayerId } = {}) {
  const owner = o.owner ?? P1;
  return mk(
    [
      { key: "hero", def: printing(HERO), owner, zone: o.zone ?? "play" },
      ...volition(o.v ?? 0, owner),
      ...bank("greed", o.others ?? 0, owner),
      ...(o.extra ?? [])
    ],
    { activePlayerId: o.active, turn: o.active === P2 ? 2 : undefined }
  );
}

clause(HERO, "0:kw:TACTICAL", "printed card: a universal outcast vigilante, cost 5, [V], 3 str / 3 spd / 3 life; 5 resources incl. one face-down [V] deploy it, 4 are refused, 5 without [V] are refused", () => {
  printedFacts(HERO, { type: "character", trade: "universal", cost: 5, threshold: "v", strength: 3, speed: 3, life: 3 });
  assert.deepEqual([...(printing(HERO).subtype ?? [])], ["outcast", "vigilante"]);
  const ok = heroBoard({ zone: "hand", v: 1, others: 4 });
  play(ok.engine, P1, ok.id("hero"));
  assert.equal(zoneOf(ok.engine, ok.id("hero")), "play");
  assert.equal(ready(ok.engine), 0, "exactly 5 paid");
  assert.deepEqual(stats(ok.engine, ok.id("hero")), [3, 3, 3]);
  const short = heroBoard({ zone: "hand", v: 1, others: 3 });
  refused(() => play(short.engine, P1, short.id("hero")), "4 resources for cost 5");
  const noIcon = heroBoard({ zone: "hand", v: 0, others: 5 });
  refused(() => play(noIcon.engine, P1, noIcon.id("hero")), "no [V]", /threshold|icon/i);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("hero")), "hand");
});

clause(HERO, "0:kw:TACTICAL", "TACTICAL: has the keyword (an ordinary character does not) and can be deployed in the opponent's response window; an ordinary character cannot", () => {
  const b = heroBoard({
    zone: "hand",
    v: 1,
    others: 4,
    active: P2,
    extra: [
      { key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" },
      { key: "plain", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" }
    ]
  });
  assert.ok(b.engine.getKeywords(b.id("hero")).includes("tactical"), "b.engine.getKeywords(b.id(hero)).includes(tactical)");
  assert.equal(b.engine.getKeywords(b.id("plain")).includes("tactical"), false, "control: an ordinary character is not tactical");
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  refused(() => play(b.engine, P1, b.id("plain")), "an ordinary character in a response window");
  assert.equal(zoneOf(b.engine, b.id("plain")), "hand");
  play(b.engine, P1, b.id("hero"));
  assert.equal(zoneOf(b.engine, b.id("hero")), "play", "the Hero was deployed on the opponent's turn");
});

clause(HERO, "1:rule", "with the Hero in play, a character's own 'when this card enters play' trigger is ignored (mine and the opponent's); without the Hero it fires", () => {
  const withHero = heroBoard({
    extra: [
      { key: "mine", def: etbInfluence("MineEtb"), owner: P1, zone: "hand" },
      { key: "theirs", def: etbInfluence("TheirEtb"), owner: P2, zone: "hand" }
    ]
  });
  const a0 = infl(withHero.engine, P1);
  play(withHero.engine, P1, withHero.id("mine"));
  assert.equal(zoneOf(withHero.engine, withHero.id("mine")), "play");
  assert.equal(infl(withHero.engine, P1), a0, "my enters-play trigger was ignored");
  const opp = heroBoard({ active: P2, extra: [{ key: "theirs", def: etbInfluence("TheirEtb"), owner: P2, zone: "hand" }] });
  const b0 = infl(opp.engine, P2);
  play(opp.engine, P2, opp.id("theirs"));
  assert.equal(zoneOf(opp.engine, opp.id("theirs")), "play");
  assert.equal(infl(opp.engine, P2), b0, "the opponent's enters-play trigger was ignored too");
  // control: no Hero in play
  const noHero = heroBoard({ zone: "hand", extra: [{ key: "mine", def: etbInfluence("MineEtb"), owner: P1, zone: "hand" }] });
  const c0 = infl(noHero.engine, P1);
  play(noHero.engine, P1, noHero.id("mine"));
  assert.equal(infl(noHero.engine, P1), c0 - 1, "control: without the Hero the trigger fires");
});

clause(HERO, "1:rule", "a real card's 'When this card enters play' text is ignored: Testudine deployed with the Hero in play does not look at the deck", () => {
  const b = heroBoard({
    extra: [
      { key: "tw", def: printing(TESTUDINE), owner: P1, zone: "hand" },
      ...bank("elitism", 5, P1),
      { key: "cheap", def: character({ name: "Cheap", cost: 1 }), owner: P1, zone: "deck" },
      ...fillers("f", 6, P1, "deck")
    ]
  });
  play(b.engine, P1, b.id("tw"));
  assert.equal(zoneOf(b.engine, b.id("tw")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined, "no look at the top 6");
  assert.equal(zoneOf(b.engine, b.id("cheap")), "deck");
});

clause(HERO, "1:rule", "a 'when this card leaves play' trigger is ignored while the Hero is in play, and fires without it", () => {
  const b = heroBoard({
    active: P1,
    extra: [
      { key: "leaver", def: ltpInfluence("Leaver"), owner: P2, zone: "play" },
      { key: "k", def: KILLER(), owner: P1, zone: "play" }
    ]
  });
  const i0 = infl(b.engine, P2);
  activate(b.engine, P1, b.id("k"), "kill", { selected: { t: [b.id("leaver")] } });
  assert.equal(zoneOf(b.engine, b.id("leaver")), "discard");
  assert.equal(infl(b.engine, P2), i0, "its leaves-play trigger was ignored");
  const ctrl = heroBoard({
    zone: "hand",
    active: P1,
    extra: [
      { key: "leaver", def: ltpInfluence("Leaver"), owner: P2, zone: "play" },
      { key: "k", def: KILLER(), owner: P1, zone: "play" }
    ]
  });
  const j0 = infl(ctrl.engine, P2);
  activate(ctrl.engine, P1, ctrl.id("k"), "kill", { selected: { t: [ctrl.id("leaver")] } });
  assert.equal(zoneOf(ctrl.engine, ctrl.id("leaver")), "discard");
  assert.equal(infl(ctrl.engine, P2), j0 - 1, "control: with the Hero only in hand the trigger fires");
});

clause(HERO, "1:rule", "a real card's 'When this card leaves play' text is ignored: William B. Sixsmith III leaving play with the Hero in play makes nobody discard", () => {
  const b = heroBoard({
    active: P1,
    extra: [
      { key: "ss", def: printing(SIXSMITH), owner: P1, zone: "play" },
      { key: "k", def: KILLER(), owner: P1, zone: "play" },
      ...fillers("h", 3, P1, "hand")
    ]
  });
  activate(b.engine, P1, b.id("k"), "kill", { selected: { t: [b.id("ss")] } });
  assert.equal(zoneOf(b.engine, b.id("ss")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined, "no discard prompt");
  assert.equal(handOf(b.engine, P1).length, 3);
});

clause(HERO, "1:rule", "only triggers that BEGIN with those words are ignored: another card's 'whenever a card enters play' trigger still fires", () => {
  const b = heroBoard({
    active: P1,
    extra: [
      { key: "w", def: watcher(), owner: P1, zone: "play" },
      { key: "new", def: character({ name: "New", cost: 0 }), owner: P1, zone: "hand" }
    ]
  });
  const i0 = infl(b.engine, P1);
  play(b.engine, P1, b.id("new"));
  assert.equal(zoneOf(b.engine, b.id("new")), "play");
  assert.equal(infl(b.engine, P1), i0 - 1, "the watcher's trigger still fires");
});

clause(HERO, "1:rule", "the effect lasts only while the Hero is in play: once it leaves play, enters-play triggers fire again", () => {
  const b = heroBoard({
    active: P1,
    extra: [
      { key: "k", def: KILLER(), owner: P1, zone: "play" },
      { key: "mine", def: etbInfluence("MineEtb"), owner: P1, zone: "hand" }
    ]
  });
  activate(b.engine, P1, b.id("k"), "kill", { selected: { t: [b.id("hero")] } });
  assert.equal(zoneOf(b.engine, b.id("hero")), "discard");
  const i0 = infl(b.engine, P1);
  play(b.engine, P1, b.id("mine"));
  assert.equal(infl(b.engine, P1), i0 - 1, "the trigger fires again");
});

clause(HERO, "1:rule", "it also works when the opponent controls the Hero (the printed words name no owner)", () => {
  const b = heroBoard({ owner: P2, extra: [{ key: "mine", def: etbInfluence("MineEtb"), owner: P1, zone: "hand" }] });
  const i0 = infl(b.engine, P1);
  play(b.engine, P1, b.id("mine"));
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  assert.equal(infl(b.engine, P1), i0, "ignored even though the Hero is the opponent's");
});

// =============================================================================================================
// Unwieldy Spy Equipment
// ATTACH TO CHARACTER. The attached character gains COVERT.
// When the attached character inflicts battle damage to a faction, draw a card.
// Item, rogue (gear), cost 1, [D].
// =============================================================================================================
function spyBoard(o: { zone?: "hand" | "play"; host?: "mine" | "foe" | "none"; deception?: number; active?: PlayerId; extra?: Cards; deck?: number } = {}) {
  const host = o.host ?? "mine";
  return mk(
    [
      { key: "spy", def: printing(SPY), owner: P1, zone: o.zone ?? "hand", ...(o.zone === "play" && host !== "none" ? { attachedToKey: host } : {}) },
      ...bank("deception", o.deception ?? 1, P1),
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 3 }), owner: P1, zone: "play" },
      ...fillers("dk", o.deck ?? 6, P1, "deck"),
      ...fillers("dk2", 6, P2, "deck"),
      ...(o.extra ?? [])
    ],
    { activePlayerId: o.active, turn: o.active === P2 ? 2 : undefined }
  );
}
type SpyBoard = ReturnType<typeof spyBoard>;
const spyHost = (b: SpyBoard) => b.engine.state.cards[b.id("spy")].attachedTo;
const spyDeploy = (b: SpyBoard, host: string | undefined) => play(b.engine, P1, b.id("spy"), { selected: host === undefined ? {} : { attachTo: [b.id(host)] } });

clause(SPY, "0:attach", "printed card: a rogue gear item, cost 1, [D]; deploys attached to the picked character for exactly 1, refused with no [D] or no resource", () => {
  printedFacts(SPY, { type: "item", trade: "rogue", cost: 1, threshold: "d" });
  assert.deepEqual([...(printing(SPY).subtype ?? [])], ["gear"]);
  assert.equal((printing(SPY) as unknown as { attachTo?: string }).attachTo, "character");
  const b = spyBoard({ deception: 2 });
  spyDeploy(b, "mine");
  assert.equal(zoneOf(b.engine, b.id("spy")), "play");
  assert.equal(spyHost(b), b.id("mine"), "attached to the picked character");
  assert.equal(ready(b.engine), 1, "exactly 1 paid");
  const noRes = spyBoard({ deception: 0 });
  refused(() => spyDeploy(noRes, "mine"), "no resources");
  const noIcon = spyBoard({ deception: 0, extra: bank("greed", 3, P1) });
  refused(() => spyDeploy(noIcon, "mine"), "no [D]", /threshold|icon/i);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("spy")), "hand");
});

clause(SPY, "0:attach", "ATTACH TO CHARACTER: any character (mine or an opponent's) is a legal host; an item, a location, a faction or no host is refused", () => {
  const foe = spyBoard();
  spyDeploy(foe, "foe");
  assert.equal(spyHost(foe), foe.id("foe"), "an opponent's character is a legal host");
  for (const key of ["gear", "place"]) {
    const b = spyBoard();
    refused(() => spyDeploy(b, key), `host ${key}`);
    assert.equal(zoneOf(b.engine, b.id("spy")), "hand");
    assert.equal(ready(b.engine), 1, "nothing paid");
  }
  const f = spyBoard();
  refused(() => play(f.engine, P1, f.id("spy"), { selected: { attachTo: [factionOf(f.engine, P1)] } }), "my faction");
  refused(() => play(f.engine, P1, f.id("spy"), { selected: { attachTo: [factionOf(f.engine, P2)] } }), "the opponent's faction");
  refused(() => spyDeploy(f, undefined), "no host picked");
  assert.equal(zoneOf(f.engine, f.id("spy")), "hand");
});

clause(SPY, "1:rule", "the attached character gains COVERT; other characters do not; it is gone when the item leaves play", () => {
  const b = spyBoard({ zone: "play", host: "mine", extra: [{ key: "k", def: KILLER(), owner: P1, zone: "play" }] });
  assert.ok(b.engine.getKeywords(b.id("mine")).includes("covert"), "host is COVERT");
  assert.equal(b.engine.getKeywords(b.id("ally")).includes("covert"), false, "another character is not");
  assert.equal(b.engine.getKeywords(b.id("foe")).includes("covert"), false);
  const before = spyBoard({ zone: "hand" });
  assert.equal(before.engine.getKeywords(before.id("mine")).includes("covert"), false, "not before it is attached");
  activate(b.engine, P1, b.id("k"), "kill", { selected: { t: [b.id("spy")] } });
  assert.equal(zoneOf(b.engine, b.id("spy")), "discard");
  assert.equal(b.engine.getKeywords(b.id("mine")).includes("covert"), false, "COVERT is gone with the item");
});

clause(SPY, "1:rule", "COVERT in battle: the host cannot be blocked by a non-covert character, a covert one can block it", () => {
  const mkB = () =>
    spyBoard({
      zone: "play",
      host: "mine",
      extra: [{ key: "cb", def: character({ name: "CovertBlocker", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }]
    });
  const a = mkB();
  declareAttackBy(a.engine, P1, [a.id("mine")]);
  refused(() => declareBlockers(a.engine, P2, [a.id("foe")]), "a non-covert blocker", /block|covert/i);
  declareBlockers(a.engine, P2, [a.id("cb")]);
  assert.deepEqual(a.engine.state.battle?.blockingParty, [a.id("cb")], "a covert character may block");
  const ctrl = spyBoard({ zone: "play", host: "mine" });
  declareAttackBy(ctrl.engine, P1, [ctrl.id("ally")]);
  declareBlockers(ctrl.engine, P2, [ctrl.id("foe")]);
  assert.deepEqual(ctrl.engine.state.battle?.blockingParty, [ctrl.id("foe")], "control: the ally (no item) can be blocked by anyone");
});

clause(SPY, "2:rule", "when the attached character inflicts battle damage to a faction, I draw a card", () => {
  const b = spyBoard({ zone: "play", host: "mine" });
  const hand0 = handOf(b.engine, P1).length;
  const f0 = factionInfluence(b.engine, P2);
  declareAttackBy(b.engine, P1, [b.id("mine")]);
  declareBlockers(b.engine, P2, []);
  finishBattle(b.engine);
  assert.equal(f0 - factionInfluence(b.engine, P2), 2, "2 damage to the faction");
  assert.equal(handOf(b.engine, P1).length, hand0 + 1, "drew exactly one card");
});

clause(SPY, "2:rule", "blocked (damage to a character, none to the faction): no card is drawn", () => {
  const b = spyBoard({ zone: "play", host: "mine", extra: [{ key: "cb", def: character({ name: "CovertBlocker", strength: 0, life: 9, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }] });
  const hand0 = handOf(b.engine, P1).length;
  declareAttackBy(b.engine, P1, [b.id("mine")]);
  declareBlockers(b.engine, P2, [b.id("cb")]);
  finishBattle(b.engine);
  assert.equal(b.engine.state.cards[b.id("cb")].damage, 2, "the blocker took the damage");
  assert.equal(handOf(b.engine, P1).length, hand0, "no draw");
});

clause(SPY, "2:rule", "another character (without the item) damaging a faction draws nothing, even in the same party", () => {
  const b = spyBoard({ zone: "play", host: "mine" });
  const hand0 = handOf(b.engine, P1).length;
  declareAttackBy(b.engine, P1, [b.id("ally")]);
  declareBlockers(b.engine, P2, []);
  finishBattle(b.engine);
  assert.equal(handOf(b.engine, P1).length, hand0, "the ally has no item: no draw");
  const both = spyBoard({ zone: "play", host: "mine" });
  const h1 = handOf(both.engine, P1).length;
  declareAttackBy(both.engine, P1, [both.id("mine"), both.id("ally")]);
  declareBlockers(both.engine, P2, []);
  finishBattle(both.engine);
  assert.equal(handOf(both.engine, P1).length, h1 + 1, "control: the host in the party draws once");
});

clause(SPY, "2:rule", "when the attached character is an opponent's: it is the item's controller (me) who draws when THEIR character damages my faction", () => {
  const b = spyBoard({ zone: "play", host: "foe", active: P2 });
  const mine0 = handOf(b.engine, P1).length;
  const theirs0 = handOf(b.engine, P2).length;
  declareAttackBy(b.engine, P2, [b.id("foe")]);
  assert.ok(b.engine.getKeywords(b.id("foe")).includes("covert"), "their host is COVERT");
  declareBlockers(b.engine, P1, []);
  finishBattle(b.engine);
  assert.equal(handOf(b.engine, P1).length + handOf(b.engine, P2).length, mine0 + theirs0 + 1, "exactly one card was drawn");
  assert.equal(handOf(b.engine, P1).length, mine0 + 1, "the item's controller draws");
});

// =============================================================================================================
// Upstart Arcanist
// COVERT. At the start of your turn, you may reveal the top card of your deck. If you do and it is a tactic, you may put it into your hand.
// Character, arcanist (entrepreneur), cost 2, [O][O], 2 str / 3 spd / 1 life.
// =============================================================================================================
function upBoard(top: "tactic" | "character" | "item" | "location" | "resource" | "none", o: { zone?: "play" | "hand" | "discard" } = {}) {
  const topDef =
    top === "tactic"
      ? tactic({ name: "TopSpell", cost: 2 })
      : top === "character"
        ? character({ name: "TopGuy" })
        : top === "item"
          ? item({ name: "TopItem" })
          : top === "location"
            ? location({ name: "TopPlace", structure: 2 })
            : resourceCard({ name: "TopRes", resource: { provides: ["rage"], staple: true } });
  const b = buildGame({
    playerA: { faction: barrenFaction() },
    playerB: { faction: barrenFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "up", def: printing(UPSTART), owner: P1, zone: o.zone ?? "play" },
      ...(top === "none" ? [] : [{ key: "top", def: topDef, owner: P1, zone: "deck" as const }]),
      ...fillers("f", 3, P1, "deck"),
      { key: "p2top", def: tactic({ name: "OppSpell" }), owner: P2, zone: "deck" },
      ...fillers("g", 3, P2, "deck")
    ]
  });
  if (top !== "none") {
    const d = b.engine.state.players[P1].deck;
    d.splice(d.indexOf(b.id("top")), 1);
    d.unshift(b.id("top"));
  }
  return b;
}
type UpBoard = ReturnType<typeof upBoard>;
/** Ends the opponent's turn so MY turn starts, answering trigger ordering up to the Arcanist's own prompt. */
function upStartMyTurn(b: UpBoard): void {
  endTurnRaw(b.engine, P2);
  for (let guard = 0; guard < 6; guard++) {
    const pc = pending(b.engine);
    if (pc?.kind !== "orderTriggers") break;
    const triggers = pc.triggers as Array<{ abilityId: string }>;
    resolveChoice(b.engine, { kind: "orderTriggers", next: triggers.find((t) => t.abilityId === "arcanist-sot") ?? triggers[0] });
  }
}
const upRevealCount = (b: UpBoard) => b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed").length;

clause(UPSTART, "0:kw:COVERT", "printed card: an arcanist entrepreneur, cost 2, [O][O], 2 str / 3 spd / 1 life; deploys for exactly 2, refused one short or with one [O]", () => {
  printedFacts(UPSTART, { type: "character", trade: "arcanist", cost: 2, threshold: "oo", strength: 2, speed: 3, life: 1 });
  assert.deepEqual([...(printing(UPSTART).subtype ?? [])], ["entrepreneur"]);
  const mkHand = (obs: number, greed: number) => mk([{ key: "up", def: printing(UPSTART), owner: P1, zone: "hand" }, ...bank("obsession", obs, P1), ...bank("greed", greed, P1)]);
  const ok = mkHand(3, 0);
  play(ok.engine, P1, ok.id("up"));
  assert.equal(zoneOf(ok.engine, ok.id("up")), "play");
  assert.equal(ready(ok.engine), 1, "exactly 2 paid");
  assert.deepEqual(stats(ok.engine, ok.id("up")), [2, 3, 1]);
  const short = mkHand(1, 0);
  refused(() => play(short.engine, P1, short.id("up")), "1 resource for cost 2");
  const noIcon = mkHand(1, 3);
  refused(() => play(noIcon.engine, P1, noIcon.id("up")), "one [O] only", /threshold|icon/i);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("up")), "hand");
});
clause(UPSTART, "0:kw:COVERT", "COVERT: has the keyword (an ordinary character does not)", () => covertHasKeyword(UPSTART));
clause(UPSTART, "0:kw:COVERT", "COVERT: cannot be blocked by non-covert characters", () => covertCannotBeBlockedByNonCovert(UPSTART));
clause(UPSTART, "0:kw:COVERT", "COVERT: a party needs every member covert", () => covertPartyNeedsEveryMemberCovert(UPSTART));
clause(UPSTART, "0:kw:COVERT", "COVERT: as a blocker it blocks only covert parties", () => covertBlocksOnlyCovertParties(UPSTART));

clause(UPSTART, "1:rule", "at the start of my turn I may reveal the top card; if it is a tactic I may put it into my hand", () => {
  const b = upBoard("tactic");
  const r0 = upRevealCount(b);
  upStartMyTurn(b);
  assert.equal(b.engine.state.activePlayerId, P1, "my turn");
  const first = pending(b.engine);
  assert.equal(first?.kind, "mayPay", "a reveal offer");
  assert.equal(first?.playerId, P1);
  answerPending(b.engine, "mayPay", { pay: true });
  assert.ok(upRevealCount(b) > r0, "the top card was revealed");
  const second = pending(b.engine);
  assert.equal(second?.kind, "mayPay", "a take-it offer because it is a tactic");
  answerPending(b.engine, "mayPay", { pay: true });
  assert.equal(zoneOf(b.engine, b.id("top")), "hand");
  assert.ok(handOf(b.engine, P1).includes(b.id("top")), "handOf(b.engine, P1).includes(b.id(top))");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(UPSTART, "1:rule", "a revealed tactic may be declined: it stays on top of my deck", () => {
  const b = upBoard("tactic");
  upStartMyTurn(b);
  answerPending(b.engine, "mayPay", { pay: true });
  answerPending(b.engine, "mayPay", { pay: false });
  assert.equal(zoneOf(b.engine, b.id("top")), "deck");
  assert.equal(deckOf(b.engine, P1)[0], b.id("top"), "still the top card");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(UPSTART, "1:rule", "'you may reveal': declining reveals nothing and takes nothing, even though the top card is a tactic", () => {
  const b = upBoard("tactic");
  const r0 = upRevealCount(b);
  upStartMyTurn(b);
  answerPending(b.engine, "mayPay", { pay: false });
  assert.equal(upRevealCount(b), r0, "nothing revealed");
  assert.equal(zoneOf(b.engine, b.id("top")), "deck");
  assert.equal(b.engine.state.pendingChoice, undefined, "no take-it offer");
});

clause(UPSTART, "1:rule", "a revealed non-tactic (character, item, location, resource) is revealed but stays on top: no take-it offer", () => {
  for (const top of ["character", "item", "location", "resource"] as const) {
    const b = upBoard(top);
    const r0 = upRevealCount(b);
    upStartMyTurn(b);
    answerPending(b.engine, "mayPay", { pay: true });
    assert.ok(upRevealCount(b) > r0, `${top}: revealed`);
    assert.equal(b.engine.state.pendingChoice, undefined, `${top}: no second offer`);
    assert.equal(zoneOf(b.engine, b.id("top")), "deck", top);
    assert.equal(deckOf(b.engine, P1)[0], b.id("top"), `${top}: still on top`);
  }
});

clause(UPSTART, "1:rule", "only at the start of MY turn: the opponent's turn start offers me nothing", () => {
  const b = buildGame({
    playerA: { faction: barrenFaction() },
    playerB: { faction: barrenFaction() },
    turn: 1,
    activePlayerId: P1,
    cards: [
      { key: "up", def: printing(UPSTART), owner: P1, zone: "play" },
      { key: "top", def: tactic({ name: "TopSpell" }), owner: P1, zone: "deck" },
      ...fillers("f", 3, P1, "deck"),
      ...fillers("g", 3, P2, "deck")
    ]
  });
  const d = b.engine.state.players[P1].deck;
  d.splice(d.indexOf(b.id("top")), 1);
  d.unshift(b.id("top"));
  endTurnRaw(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  const pc = pending(b.engine);
  assert.ok(!pc || pc.playerId !== P1, "no prompt for me on the opponent's turn start");
  assert.equal(zoneOf(b.engine, b.id("top")), "deck");
});

clause(UPSTART, "1:rule", "it only works while in play: in hand or the discard pile it offers nothing at my turn start", () => {
  for (const zone of ["hand", "discard"] as const) {
    const b = upBoard("tactic", { zone });
    upStartMyTurn(b);
    assert.equal(b.engine.state.activePlayerId, P1);
    assert.equal(b.engine.state.pendingChoice, undefined, zone);
    assert.equal(zoneOf(b.engine, b.id("top")), "deck", zone);
  }
});

clause(UPSTART, "1:rule", "an empty deck: the reveal finds no tactic and nothing breaks", () => {
  const b = buildGame({
    playerA: { faction: barrenFaction() },
    playerB: { faction: barrenFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [{ key: "up", def: printing(UPSTART), owner: P1, zone: "play" }, ...fillers("g", 3, P2, "deck")]
  });
  assert.equal(deckOf(b.engine, P1).length, 0);
  upStartMyTurn(b as unknown as UpBoard);
  if (pending(b.engine)?.kind === "mayPay") answerPending(b.engine, "mayPay", { pay: true });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(handOf(b.engine, P1).length, 0);
});

// =============================================================================================================
// Violating Ritual
// EXTRA COST: Pick an opponent. -- That opponent discards 2 cards. Draw a card.
// Tactic, arcanist, cost 3, [O][O][O].
// =============================================================================================================
function vrBoard(o: { obs?: number; oppHand?: number; myHand?: number; deck?: number; extra?: Cards } = {}) {
  return mk([
    { key: "vr", def: printing(RITUAL), owner: P1, zone: "hand" },
    ...bank("obsession", o.obs ?? 3, P1),
    ...fillers("oh", o.oppHand ?? 3, P2, "hand"),
    ...fillers("mh", o.myHand ?? 2, P1, "hand"),
    ...fillers("dk", o.deck ?? 5, P1, "deck"),
    ...fillers("odk", 3, P2, "deck"),
    ...(o.extra ?? [])
  ]);
}
type VrBoard = ReturnType<typeof vrBoard>;

clause(RITUAL, "0:extraCost", "printed card: an arcanist tactic, cost 3, [O][O][O]; exactly 3 deploys it (no target needs picking: the opponent is picked as the cost), 2 or two [O] are refused", () => {
  printedFacts(RITUAL, { type: "tactic", trade: "arcanist", cost: 3, threshold: "ooo" });
  const ok = vrBoard();
  const before = ready(ok.engine);
  playRaw(ok.engine, P1, ok.id("vr"));
  assert.equal(before - ready(ok.engine), 3, "exactly 3 paid when played");
  const short = vrBoard({ obs: 2 });
  refused(() => play(short.engine, P1, short.id("vr")), "2 resources for cost 3");
  assert.equal(zoneOf(short.engine, short.id("vr")), "hand");
  assert.equal(handOf(short.engine, P2).length, 3, "nothing happened");
  const noIcon = vrBoard({ obs: 2, extra: bank("greed", 4, P1) });
  refused(() => play(noIcon.engine, P1, noIcon.id("vr")), "two [O] only", /threshold|icon/i);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("vr")), "hand");
});

clause(RITUAL, "0:extraCost", "the opponent is the one picked: they are the one who discards, and my own hand is untouched", () => {
  const b = vrBoard();
  const mine0 = handOf(b.engine, P1).length;
  play(b.engine, P1, b.id("vr"));
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P2, "the opponent chooses what they discard");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("oh0"), b.id("oh1")] });
  assert.equal(discardOf(b.engine, P1).some((id) => handOf(b.engine, P1).includes(id)), false);
  assert.equal(handOf(b.engine, P1).filter((id) => id.length > 0).length, mine0 - 1 + 1, "my hand: the Ritual left, I drew one");
  for (const k of ["mh0", "mh1"]) assert.equal(zoneOf(b.engine, b.id(k)), "hand", `${k} is still in my hand`);
});

clause(RITUAL, "1:rule", "that opponent discards 2 cards of THEIR choice into their discard pile; the third stays in hand", () => {
  const b = vrBoard();
  play(b.engine, P1, b.id("vr"));
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("oh0")] }), "only one card");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("oh0"), b.id("oh1"), b.id("oh2")] }), "three cards");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("mh0"), b.id("oh0")] }), "one of MY cards");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [] }), "a mandatory discard");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still open");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("oh2"), b.id("oh0")] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual([b.id("oh0"), b.id("oh2")].sort(), discardOf(b.engine, P2).sort(), "exactly the two chosen are in THEIR discard pile");
  assert.equal(zoneOf(b.engine, b.id("oh1")), "hand");
  assert.equal(handOf(b.engine, P2).length, 1);
});

clause(RITUAL, "1:rule", "I draw a card after the discard: exactly one, from the top of my deck", () => {
  const b = vrBoard();
  const top = deckOf(b.engine, P1)[0];
  const hand0 = handOf(b.engine, P1).length;
  const deck0 = deckOf(b.engine, P1).length;
  play(b.engine, P1, b.id("vr"));
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("oh0"), b.id("oh1")] });
  assert.equal(handOf(b.engine, P1).length, hand0 - 1 + 1, "the Ritual left my hand, one card drawn");
  assert.ok(handOf(b.engine, P1).includes(top), "the top card of my deck");
  assert.equal(deckOf(b.engine, P1).length, deck0 - 1);
  assert.equal(handOf(b.engine, P2).length, 1, "the opponent drew nothing");
});

clause(RITUAL, "1:rule", "an opponent with exactly 2 cards discards both; with 1 card discards that one; with none nothing happens - and I draw in every case", () => {
  for (const n of [2, 1, 0]) {
    const b = vrBoard({ oppHand: n });
    const mine0 = handOf(b.engine, P1).length;
    play(b.engine, P1, b.id("vr"));
    for (let guard = 0; guard < 3 && pending(b.engine); guard++) {
      const pc = pending(b.engine)!;
      assert.equal(pc.playerId, P2);
      const ids = handOf(b.engine, P2).slice(0, 2);
      answerPending(b.engine, "chooserSelectsTarget", { selected: ids });
    }
    assert.equal(b.engine.state.pendingChoice, undefined, `n=${n}`);
    assert.equal(handOf(b.engine, P2).length, 0, `n=${n}: they have nothing left`);
    assert.equal(discardOf(b.engine, P2).length, n, `n=${n}: all ${n} went to their discard pile`);
    assert.equal(handOf(b.engine, P1).length, mine0, `n=${n}: I drew a card (the Ritual left)`);
  }
});

// =============================================================================================================
// War Beast
// This card cannot be blocked by parties of less than 2 members.
// Character, warlord (beast), cost 5, [R][R], 5 str / 2 spd / 4 life.
// =============================================================================================================
function beastBoard(o: { foes?: number; active?: PlayerId; extra?: Cards } = {}) {
  return mk(
    [
      { key: "beast", def: printing(BEAST), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 4, speed: 2 }), owner: P1, zone: "play" },
      ...Array.from({ length: o.foes ?? 3 }, (_, i) => ({ key: `b${i + 1}`, def: character({ name: `Blocker${i + 1}`, strength: 1, life: 6, speed: 2 }), owner: P2, zone: "play" as const })),
      ...(o.extra ?? [])
    ],
    { activePlayerId: o.active, turn: o.active === P2 ? 2 : undefined }
  );
}

clause(BEAST, "0:rule", "printed card: a warlord beast, cost 5, [R][R], 5 str / 2 spd / 4 life; exactly 5 deploys it, 4 or one [R] are refused", () => {
  printedFacts(BEAST, { type: "character", trade: "warlord", cost: 5, threshold: "rr", strength: 5, speed: 2, life: 4 });
  assert.deepEqual([...(printing(BEAST).subtype ?? [])], ["beast"]);
  const mkHand = (rage: number, greed: number) => mk([{ key: "beast", def: printing(BEAST), owner: P1, zone: "hand" }, ...bank("rage", rage, P1), ...bank("greed", greed, P1)]);
  const ok = mkHand(2, 3);
  play(ok.engine, P1, ok.id("beast"));
  assert.equal(zoneOf(ok.engine, ok.id("beast")), "play");
  assert.equal(ready(ok.engine), 0, "exactly 5 paid");
  assert.deepEqual(stats(ok.engine, ok.id("beast")), [5, 2, 4]);
  const short = mkHand(2, 2);
  refused(() => play(short.engine, P1, short.id("beast")), "4 resources for cost 5");
  const noIcon = mkHand(1, 4);
  refused(() => play(noIcon.engine, P1, noIcon.id("beast")), "one [R] only", /threshold|icon/i);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("beast")), "hand");
});

clause(BEAST, "0:rule", "a party of ONE blocker cannot block it (refused; the battle is not blocked)", () => {
  const b = beastBoard();
  declareAttackBy(b.engine, P1, [b.id("beast")]);
  refused(() => declareBlockers(b.engine, P2, [b.id("b1")]), "a single blocker", /block|member|party/i);
  assert.deepEqual(b.engine.state.battle?.blockingParty ?? [], [], "no blocking party was set");
});

clause(BEAST, "0:rule", "a party of 2 or 3 members can block it", () => {
  for (const n of [2, 3]) {
    const b = beastBoard();
    declareAttackBy(b.engine, P1, [b.id("beast")]);
    const ids = ["b1", "b2", "b3"].slice(0, n).map((k) => b.id(k));
    declareBlockers(b.engine, P2, ids);
    assert.deepEqual([...(b.engine.state.battle?.blockingParty ?? [])].sort(), [...ids].sort(), `${n} blockers`);
  }
});

clause(BEAST, "0:rule", "declaring no blockers at all is still fine", () => {
  const b = beastBoard();
  const f0 = factionInfluence(b.engine, P2);
  declareAttackBy(b.engine, P1, [b.id("beast")]);
  declareBlockers(b.engine, P2, []);
  finishBattle(b.engine);
  assert.equal(f0 - factionInfluence(b.engine, P2), 5, "5 damage to the faction");
});

clause(BEAST, "0:rule", "a Beast in a party with an ally: the party cannot be blocked by a single blocker either, but can by two", () => {
  const one = beastBoard();
  declareAttackBy(one.engine, P1, [one.id("beast"), one.id("ally")]);
  refused(() => declareBlockers(one.engine, P2, [one.id("b1")]), "one blocker against a party containing the Beast", /block|member|party/i);
  const two = beastBoard();
  declareAttackBy(two.engine, P1, [two.id("beast"), two.id("ally")]);
  declareBlockers(two.engine, P2, [two.id("b1"), two.id("b2")]);
  assert.equal(two.engine.state.battle?.blockingParty?.length, 2);
});

clause(BEAST, "0:rule", "it is a restriction of THIS card only: a party without the Beast can be blocked by a single character", () => {
  const b = beastBoard();
  declareAttackBy(b.engine, P1, [b.id("ally")]);
  declareBlockers(b.engine, P2, [b.id("b1")]);
  assert.deepEqual(b.engine.state.battle?.blockingParty, [b.id("b1")]);
});

clause(BEAST, "0:rule", "the Beast itself can block alone: the restriction is about being blocked, not blocking", () => {
  const b = beastBoard({ active: P2, extra: [{ key: "atk", def: character({ name: "Atk", strength: 1, life: 6, speed: 2 }), owner: P2, zone: "play" }] });
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  declareBlockers(b.engine, P1, [b.id("beast")]);
  assert.deepEqual(b.engine.state.battle?.blockingParty, [b.id("beast")]);
});

// =============================================================================================================
// William B. Sixsmith III
// UNIQUE SIXSMITH. When this card enters play, you may search your deck for an item card and a character card and reveal
// them. If you do, put them in your hand. -- When this card leaves play, discard 2 cards.
// Character, gearsmith (sixsmith, dragon, inventor), cost 7, [E][E][E], 4 str / 3 spd / 4 life.
// =============================================================================================================
function shuffledWithConstant(items: string[], value: number): string[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(value * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
function ssDeck(o: { chars?: boolean } = {}): Cards {
  return [
    { key: "sword", def: item({ name: "Sword", cost: 1 }), owner: P1, zone: "deck" },
    { key: "shield", def: item({ name: "Shield", cost: 1 }), owner: P1, zone: "deck" },
    ...(o.chars === false ? [] : ([{ key: "guy", def: character({ name: "Guy", cost: 2 }), owner: P1, zone: "deck" }, { key: "gal", def: character({ name: "Gal", cost: 9 }), owner: P1, zone: "deck" }] as Cards)),
    { key: "spell", def: tactic({ name: "Spell" }), owner: P1, zone: "deck" },
    { key: "place", def: location({ name: "Place", structure: 2 }), owner: P1, zone: "deck" },
    ...fillers("f", 3, P1, "deck"),
    { key: "foeitem", def: item({ name: "FoeItem" }), owner: P2, zone: "deck" },
    { key: "foechar", def: character({ name: "FoeChar" }), owner: P2, zone: "deck" }
  ];
}
function ssBoard(o: { zone?: "hand" | "play"; elitism?: number; deck?: Cards; hand?: number; extra?: Cards; active?: PlayerId } = {}) {
  return mk(
    [
      { key: "ss", def: printing(SIXSMITH), owner: P1, zone: o.zone ?? "hand" },
      ...bank("elitism", o.elitism ?? 7, P1),
      ...(o.deck ?? ssDeck()),
      ...fillers("h", o.hand ?? 3, P1, "hand"),
      ...fillers("oh", 2, P2, "hand"),
      ...(o.extra ?? [])
    ],
    { random: () => 0.3, activePlayerId: o.active, turn: o.active === P2 ? 2 : undefined }
  );
}
type SsBoard = ReturnType<typeof ssBoard>;
/** Answers the search prompts: `it` for the item declaration, `ch` for the character declaration (whichever comes first). */
function ssSearch(b: SsBoard, itemKey: string | undefined, charKey: string | undefined): string[] {
  const seen: string[] = [];
  for (let guard = 0; guard < 4; guard++) {
    const pc = pending(b.engine);
    if (!pc) break;
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P1);
    const declId = (pc.declaration as { id: string }).id;
    seen.push(declId);
    const key = declId === "it" ? itemKey : charKey;
    answerPending(b.engine, "chooserSelectsTarget", { selected: key ? [b.id(key)] : [] });
  }
  return seen;
}

clause(SIXSMITH, "0:unique", "printed card: a gearsmith (sixsmith, dragon, inventor), cost 7, [E][E][E], 4 str / 3 spd / 4 life; exactly 7 deploys it, 6 or two [E] are refused", () => {
  printedFacts(SIXSMITH, { type: "character", trade: "gearsmith", cost: 7, threshold: "eee", strength: 4, speed: 3, life: 4 });
  assert.deepEqual([...(printing(SIXSMITH).subtype ?? [])], ["sixsmith", "dragon", "inventor"]);
  const ok = ssBoard();
  assert.deepEqual(stats(ok.engine, ok.id("ss")), [4, 3, 4]);
  play(ok.engine, P1, ok.id("ss"));
  assert.equal(zoneOf(ok.engine, ok.id("ss")), "play");
  assert.equal(ready(ok.engine), 0, "exactly 7 paid");
  const short = ssBoard({ elitism: 6 });
  refused(() => play(short.engine, P1, short.id("ss")), "6 resources for cost 7");
  assert.equal(zoneOf(short.engine, short.id("ss")), "hand");
  const noIcon = ssBoard({ elitism: 2, extra: bank("greed", 7, P1) });
  refused(() => play(noIcon.engine, P1, noIcon.id("ss")), "two [E] only", /threshold|icon/i);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("ss")), "hand");
});

clause(SIXSMITH, "0:unique", "a second Sixsmith forces a choice: I keep one and the other is destroyed", () => {
  const b = ssBoard({ zone: "play", extra: [{ key: "ss2", def: printing(SIXSMITH), owner: P1, zone: "hand" }, ...bank("elitism", 7, P1)] });
  play(b.engine, P1, b.id("ss2"));
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.equal(pc?.playerId, P1);
  assert.deepEqual([...(pc?.candidates as string[])].sort(), [b.id("ss"), b.id("ss2")].sort());
});

clause(SIXSMITH, "0:unique", "only my own copies count: the opponent may control their own Sixsmith", () => {
  const b = mk(
    [
      { key: "ss", def: printing(SIXSMITH), owner: P1, zone: "play" },
      { key: "ss2", def: printing(SIXSMITH), owner: P2, zone: "hand" },
      ...bank("elitism", 7, P2),
      ...fillers("odk", 3, P2, "deck"),
      ...fillers("oh", 3, P2, "hand")
    ],
    { turn: 2, activePlayerId: P2 }
  );
  play(b.engine, P2, b.id("ss2"));
  assert.notEqual(pending(b.engine)?.kind, "uniqueSurvivor");
  assert.equal(zoneOf(b.engine, b.id("ss2")), "play");
  assert.equal(zoneOf(b.engine, b.id("ss")), "play");
});

clause(SIXSMITH, "1:rule", "on entering play I search my deck for an item and a character, reveal them and put both into my hand; the deck is shuffled", () => {
  const b = ssBoard();
  const deck0 = deckOf(b.engine, P1);
  const hand0 = handOf(b.engine, P1).length;
  const r0 = b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed").length;
  play(b.engine, P1, b.id("ss"));
  const seen = ssSearch(b, "sword", "guy");
  assert.equal(seen.length, 2, "two picks were offered (an item, a character)");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("sword")), "hand");
  assert.equal(zoneOf(b.engine, b.id("guy")), "hand");
  assert.equal(handOf(b.engine, P1).length, hand0 - 1 + 2, "Sixsmith left the hand, two cards arrived");
  assert.ok(b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed").length > r0, "the found cards were revealed");
  const rest = deck0.filter((id) => id !== b.id("sword") && id !== b.id("guy"));
  assert.equal(deckOf(b.engine, P1).length, rest.length, "two cards left the deck");
  assert.deepEqual([...deckOf(b.engine, P1)].sort(), [...rest].sort(), "nothing else left the deck");
  assert.deepEqual(deckOf(b.engine, P1), shuffledWithConstant(rest, 0.3), "the deck was shuffled after the search");
  assert.equal(zoneOf(b.engine, b.id("shield")), "deck", "the other item stayed");
  assert.equal(zoneOf(b.engine, b.id("gal")), "deck", "the other character stayed");
});

clause(SIXSMITH, "1:rule", "'an item card and a character card': each pick must be of its type - a tactic/location/character as the item, an item/tactic as the character, or the opponent's deck, is refused", () => {
  const b = ssBoard();
  play(b.engine, P1, b.id("ss"));
  const first = pending(b.engine)!;
  const firstDecl = (first.declaration as { id: string }).id;
  const itemSlot = firstDecl === "it";
  const wrongForFirst = itemSlot ? ["spell", "place", "guy", "foeitem"] : ["spell", "sword", "place", "foechar"];
  for (const k of wrongForFirst) {
    refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id(k)] }), `${k} in the ${itemSlot ? "item" : "character"} slot`);
    assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still open");
  }
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: itemSlot ? [b.id("sword"), b.id("shield")] : [b.id("guy"), b.id("gal")] }), "two of a kind");
  assert.equal(zoneOf(b.engine, b.id("sword")), "deck");
  assert.equal(zoneOf(b.engine, b.id("guy")), "deck");
});

clause(SIXSMITH, "1:rule", "'you may': declining both picks leaves the deck and hand as they were", () => {
  const b = ssBoard();
  const deck0 = deckOf(b.engine, P1);
  play(b.engine, P1, b.id("ss"));
  ssSearch(b, undefined, undefined);
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const k of ["sword", "shield", "guy", "gal"]) assert.equal(zoneOf(b.engine, b.id(k)), "deck", k);
  assert.equal(handOf(b.engine, P1).length, 3, "no cards arrived");
  assert.equal(deckOf(b.engine, P1).length, deck0.length);
});

clause(SIXSMITH, "1:rule", "with no character card in my deck the item is still found (a search may find less than everything it names)", () => {
  const b = ssBoard({ deck: ssDeck({ chars: false }) });
  play(b.engine, P1, b.id("ss"));
  ssSearch(b, "shield", undefined);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("shield")), "hand");
  assert.equal(zoneOf(b.engine, b.id("sword")), "deck");
});

clause(SIXSMITH, "1:rule", "it is Sixsmith's own entering that triggers it: another character entering play asks nothing", () => {
  const b = ssBoard({ zone: "play", extra: [{ key: "other", def: character({ name: "Other", cost: 0 }), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("other"));
  assert.equal(zoneOf(b.engine, b.id("other")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined, "no search");
});

const SS_KILL = () =>
  tactic({
    name: "Slay",
    cost: 0,
    behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } as never
  });
const SS_BOUNCE = () =>
  tactic({
    name: "Bounce",
    cost: 0,
    behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] } as never
  });

clause(SIXSMITH, "2:rule", "when it leaves play (destroyed) I discard 2 cards of MY choice from my hand", () => {
  const b = ssBoard({ zone: "play", active: P2, extra: [{ key: "slay", def: SS_KILL(), owner: P2, zone: "hand" }] });
  play(b.engine, P2, b.id("slay"), { selected: { t: [b.id("ss")] } });
  assert.equal(zoneOf(b.engine, b.id("ss")), "discard");
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1, "I choose");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("h0")] }), "only one card");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("h0"), b.id("h1"), b.id("h2")] }), "three cards");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("h0"), b.id("oh0")] }), "the opponent's card");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("h2"), b.id("h0")] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(discardOf(b.engine, P1).filter((id) => id !== b.id("ss")).sort(), [b.id("h0"), b.id("h2")].sort());
  assert.equal(zoneOf(b.engine, b.id("h1")), "hand");
  assert.equal(handOf(b.engine, P2).length, 2 + 0, "the opponent's hand is untouched (their Slay was played)");
});

clause(SIXSMITH, "2:rule", "leaving play to my hand (bounced) is leaving play too: I discard 2 cards", () => {
  const b = ssBoard({ zone: "play", active: P2, extra: [{ key: "bnc", def: SS_BOUNCE(), owner: P2, zone: "hand" }] });
  play(b.engine, P2, b.id("bnc"), { selected: { t: [b.id("ss")] } });
  assert.equal(zoneOf(b.engine, b.id("ss")), "hand");
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "the discard prompt");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("h0"), b.id("h1")] });
  assert.equal(zoneOf(b.engine, b.id("h0")), "discard");
  assert.equal(zoneOf(b.engine, b.id("h1")), "discard");
});

clause(SIXSMITH, "2:rule", "with fewer than 2 cards in hand I discard what I have: one card, or nothing", () => {
  const one = ssBoard({ zone: "play", hand: 1, active: P2, extra: [{ key: "slay", def: SS_KILL(), owner: P2, zone: "hand" }] });
  play(one.engine, P2, one.id("slay"), { selected: { t: [one.id("ss")] } });
  if (pending(one.engine)) answerPending(one.engine, "chooserSelectsTarget", { selected: [one.id("h0")] });
  assert.equal(one.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(one.engine, one.id("h0")), "discard");
  const none = ssBoard({ zone: "play", hand: 0, active: P2, extra: [{ key: "slay", def: SS_KILL(), owner: P2, zone: "hand" }] });
  play(none.engine, P2, none.id("slay"), { selected: { t: [none.id("ss")] } });
  assert.equal(none.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(none.engine, none.id("ss")), "discard");
});

clause(SIXSMITH, "2:rule", "no discard while it stays in play, and another character leaving play does not make me discard", () => {
  const b = ssBoard({
    zone: "play",
    active: P2,
    extra: [
      { key: "slay", def: SS_KILL(), owner: P2, zone: "hand" },
      { key: "victim", def: character({ name: "Victim" }), owner: P2, zone: "play" }
    ]
  });
  play(b.engine, P2, b.id("slay"), { selected: { t: [b.id("victim")] } });
  assert.equal(zoneOf(b.engine, b.id("victim")), "discard");
  assert.equal(zoneOf(b.engine, b.id("ss")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(handOf(b.engine, P1).length, 3, "my hand is untouched");
});

// =============================================================================================================
// Wired Up
// PROVIDES [E]. When a Micromajig token enters play under your control, lose 1 influence. Micromajig tokens you control gain AGGRO.
// Resource, gearsmith, cost 0.
// =============================================================================================================
const MAKER = (n: number) =>
  character({
    name: "Maker",
    strength: 1,
    life: 9,
    speed: 1,
    behavior: { abilities: [{ id: "mk", type: "activated", effects: [{ type: "createTokens", controller: "controller", count: n, token: { name: "Micromajig", cardType: "character", subtype: ["majig"], strength: 1, life: 1, speed: 3 } }] }] } as never
  });
function wuBoard(o: { zone?: "play" | "hand"; faceDown?: boolean; owner?: PlayerId; n?: number; extra?: Cards; active?: PlayerId } = {}) {
  return mk(
    [
      { key: "wu", def: printing(WIRED), owner: o.owner ?? P1, zone: o.zone ?? "play", faceDown: o.faceDown },
      { key: "mk", def: MAKER(o.n ?? 2), owner: P1, zone: "play" },
      { key: "mk2", def: MAKER(o.n ?? 2), owner: P2, zone: "play" },
      { key: "plain", def: character({ name: "Plainguy" }), owner: P1, zone: "play" },
      { key: "realmm", def: character({ name: "Micromajig" }), owner: P1, zone: "play" },
      ...(o.extra ?? [])
    ],
    { activePlayerId: o.active, turn: o.active === P2 ? 2 : undefined }
  );
}
type WuBoard = ReturnType<typeof wuBoard>;
const wuMake = (b: WuBoard, who: PlayerId = P1) => activate(b.engine, who, b.id(who === P1 ? "mk" : "mk2"), "mk");

clause(WIRED, "0:provides", "printed card: a gearsmith resource, cost 0, that provides exactly one [E] (face-up it adds an Elitism icon and a ready resource; face-down it gives Volition instead)", () => {
  const p = printing(WIRED);
  assert.equal(p.type, "resource");
  assert.equal(p.trade, "gearsmith");
  assert.equal(p.cost, 0);
  const up = wuBoard();
  assert.equal(up.engine.getThresholds(P1).elitism, 1, "exactly one [E]");
  assert.equal(ready(up.engine), 1);
  const down = wuBoard({ faceDown: true });
  assert.equal(down.engine.getThresholds(P1).elitism ?? 0, 0, "no [E] face-down");
  assert.equal(down.engine.getThresholds(P1).volition, 1);
});

clause(WIRED, "0:provides", "developed face-up from hand it enters play providing [E]", () => {
  const b = wuBoard({ zone: "hand" });
  developResource(b.engine, P1, b.id("wu"), false);
  assert.equal(zoneOf(b.engine, b.id("wu")), "play");
  assert.equal(b.engine.state.cards[b.id("wu")].faceDown, false);
  assert.equal(b.engine.getThresholds(P1).elitism, 1);
});

clause(WIRED, "1:rule", "each Micromajig token entering play under my control makes me lose 1 influence (2 tokens: 2, then 3 more tokens: 3)", () => {
  const b = wuBoard({ n: 2 });
  const i0 = infl(b.engine, P1);
  wuMake(b);
  assert.equal(tokensOf(b.engine, P1).length, 2);
  assert.equal(i0 - infl(b.engine, P1), 2, "lost 1 per token");
  const c = wuBoard({ n: 3 });
  const j0 = infl(c.engine, P1);
  wuMake(c);
  assert.equal(tokensOf(c.engine, P1).length, 3);
  assert.equal(j0 - infl(c.engine, P1), 3);
});

clause(WIRED, "1:rule", "the loss applies to my faction only; the opponent loses nothing", () => {
  const b = wuBoard();
  const o0 = infl(b.engine, P2);
  wuMake(b);
  assert.equal(infl(b.engine, P2), o0);
});

clause(WIRED, "1:rule", "Micromajig tokens I control gain AGGRO; an ordinary character, a real card named Micromajig, and the opponent's tokens do not", () => {
  const b = wuBoard({ n: 1 });
  wuMake(b);
  const mine = tokensOf(b.engine, P1);
  assert.equal(mine.length, 1);
  assert.ok(b.engine.getKeywords(mine[0]).includes("aggro"), "my token has AGGRO");
  const opp = wuBoard({ n: 1, active: P2 });
  wuMake(opp, P2);
  const theirs = tokensOf(opp.engine, P2);
  assert.equal(theirs.length, 1);
  assert.equal(opp.engine.getKeywords(theirs[0]).includes("aggro"), false, "the opponent's token does not");
  assert.equal(b.engine.getKeywords(b.id("plain")).includes("aggro"), false, "an ordinary character does not");
  assert.equal(b.engine.getKeywords(b.id("realmm")).includes("aggro"), false, "a non-token card named Micromajig does not");
});

clause(WIRED, "1:rule", "AGGRO is real: a token created this turn can attack at once with Wired Up in play, but not without it", () => {
  const withWu = wuBoard({ n: 1 });
  wuMake(withWu);
  const [tok] = tokensOf(withWu.engine, P1);
  declareAttackBy(withWu.engine, P1, [tok]);
  assert.ok(withWu.engine.state.battle, "the new token attacked");
  const without = wuBoard({ n: 1, zone: "hand" });
  wuMake(without);
  const [tok2] = tokensOf(without.engine, P1);
  assert.equal(without.engine.getKeywords(tok2).includes("aggro"), false);
  refused(() => declareAttackBy(without.engine, P1, [tok2]), "a token that entered this turn has no AGGRO");
  assert.equal(without.engine.state.battle, undefined);
});

clause(WIRED, "1:rule", "the opponent's tokens entering play cost me nothing (and cost them nothing)", () => {
  const b = wuBoard({ n: 2, active: P2 });
  const i0 = infl(b.engine, P1);
  const o0 = infl(b.engine, P2);
  wuMake(b, P2);
  assert.equal(tokensOf(b.engine, P2).length, 2);
  assert.equal(infl(b.engine, P1), i0);
  assert.equal(infl(b.engine, P2), o0);
});

clause(WIRED, "1:rule", "only a Micromajig TOKEN entering counts: an ordinary character or a real card named Micromajig entering play costs no influence", () => {
  const b = wuBoard({
    extra: [
      { key: "inhand", def: character({ name: "Micromajig", cost: 0 }), owner: P1, zone: "hand" },
      { key: "inhand2", def: character({ name: "Other Guy", cost: 0 }), owner: P1, zone: "hand" }
    ]
  });
  const i0 = infl(b.engine, P1);
  play(b.engine, P1, b.id("inhand"));
  play(b.engine, P1, b.id("inhand2"));
  assert.equal(infl(b.engine, P1), i0);
});

clause(WIRED, "1:rule", "it does nothing face-down or in hand: no influence loss and no AGGRO", () => {
  for (const [zone, faceDown] of [["play", true], ["hand", false]] as const) {
    const b = wuBoard({ zone, faceDown, n: 1 });
    const i0 = infl(b.engine, P1);
    wuMake(b);
    const [tok] = tokensOf(b.engine, P1);
    assert.equal(infl(b.engine, P1), i0, `${zone}/${faceDown}: no loss`);
    assert.equal(b.engine.getKeywords(tok).includes("aggro"), false, `${zone}/${faceDown}: no AGGRO`);
  }
});

clause(WIRED, "1:rule", "an opponent's Wired Up does not affect my tokens", () => {
  const b = wuBoard({ owner: P2, n: 1 });
  const i0 = infl(b.engine, P1);
  const o0 = infl(b.engine, P2);
  wuMake(b);
  const [tok] = tokensOf(b.engine, P1);
  assert.equal(infl(b.engine, P1), i0);
  assert.equal(infl(b.engine, P2), o0);
  assert.equal(b.engine.getKeywords(tok).includes("aggro"), false);
});

clause(WIRED, "1:rule", "when Wired Up leaves play both parts stop: new tokens cost nothing and existing ones lose AGGRO", () => {
  const b = wuBoard({ n: 1, extra: [{ key: "k", def: KILLER(), owner: P1, zone: "play" }] });
  wuMake(b);
  const [tok] = tokensOf(b.engine, P1);
  assert.ok(b.engine.getKeywords(tok).includes("aggro"), "b.engine.getKeywords(tok).includes(aggro)");
  activate(b.engine, P1, b.id("k"), "kill", { selected: { t: [b.id("wu")] } });
  assert.equal(zoneOf(b.engine, b.id("wu")), "discard");
  assert.equal(b.engine.getKeywords(tok).includes("aggro"), false, "AGGRO is gone");
  const i0 = infl(b.engine, P1);
  wuMake(b);
  assert.equal(infl(b.engine, P1), i0, "no more influence loss");
});

// =============================================================================================================
// Witchclock Necromancy
// EXTRA COST: Pick a character in your discard pile. -- Put the character into play under your control.
// Tactic, banker, cost 5, [G][G].
// =============================================================================================================
function wcBoard(o: { greed?: number; extra?: Cards; noOwn?: boolean } = {}) {
  return mk([
    { key: "wc", def: printing(WITCHCLOCK), owner: P1, zone: "hand" },
    ...bank("greed", o.greed ?? 5, P1),
    ...(o.noOwn ? [] : ([{ key: "dead", def: character({ name: "Dead", strength: 3, life: 3, speed: 2, cost: 9 }), owner: P1, zone: "discard" }, { key: "dead2", def: character({ name: "Dead2" }), owner: P1, zone: "discard" }] as Cards)),
    { key: "ditem", def: item({ name: "DiscItem" }), owner: P1, zone: "discard" },
    { key: "foedead", def: character({ name: "FoeDead" }), owner: P2, zone: "discard" },
    { key: "handc", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
    { key: "playc", def: character({ name: "PlayChar" }), owner: P1, zone: "play" },
    ...(o.extra ?? [])
  ]);
}
type WcBoard = ReturnType<typeof wcBoard>;
const wcPlay = (b: WcBoard, key: string | undefined) => play(b.engine, P1, b.id("wc"), { selected: key ? { c: [b.id(key)] } : {} });

clause(WITCHCLOCK, "0:extraCost", "printed card: a banker tactic, cost 5, [G][G]; exactly 5 deploys it, 4 or one [G] are refused (nothing paid or moved)", () => {
  printedFacts(WITCHCLOCK, { type: "tactic", trade: "banker", cost: 5, threshold: "gg" });
  const ok = wcBoard();
  const before = ready(ok.engine);
  playRaw(ok.engine, P1, ok.id("wc"), { selected: { c: [ok.id("dead")] } });
  assert.equal(before - ready(ok.engine), 5, "exactly 5 paid when played");
  const short = wcBoard({ greed: 4 });
  refused(() => wcPlay(short, "dead"), "4 resources for cost 5");
  assert.equal(zoneOf(short.engine, short.id("wc")), "hand");
  assert.equal(zoneOf(short.engine, short.id("dead")), "discard");
  const noIcon = wcBoard({ greed: 1, extra: bank("rage", 4, P1) });
  refused(() => wcPlay(noIcon, "dead"), "one [G] only", /threshold|icon/i);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("wc")), "hand");
});

clause(WITCHCLOCK, "0:extraCost", "the pick is part of the cost: I must pick a character in MY discard pile - not the opponent's, an item, a card in hand or in play, none, or two", () => {
  for (const [key, why] of [["foedead", "the opponent's discard pile"], ["ditem", "an item"], ["handc", "a card in my hand"], ["playc", "a card in play"]] as const) {
    const b = wcBoard();
    refused(() => wcPlay(b, key), why);
    assert.equal(zoneOf(b.engine, b.id("wc")), "hand", why);
    assert.equal(ready(b.engine), 5, `${why}: nothing paid`);
    assert.equal(zoneOf(b.engine, b.id(key)), key === "handc" ? "hand" : key === "playc" ? "play" : "discard");
  }
  const none = wcBoard();
  refused(() => wcPlay(none, undefined), "no pick");
  assert.equal(zoneOf(none.engine, none.id("wc")), "hand");
  const two = wcBoard();
  refused(() => play(two.engine, P1, two.id("wc"), { selected: { c: [two.id("dead"), two.id("dead2")] } }), "two characters");
  assert.equal(zoneOf(two.engine, two.id("dead")), "discard");
  const ok = wcBoard();
  wcPlay(ok, "dead2");
  assert.equal(zoneOf(ok.engine, ok.id("dead2")), "play", "control: a character in my discard pile is fine");
});

clause(WITCHCLOCK, "0:extraCost", "with no character in my discard pile it cannot be played at all (nothing is paid)", () => {
  const b = wcBoard({ noOwn: true });
  refused(() => wcPlay(b, "foedead"), "only the opponent's character is in a discard pile");
  refused(() => wcPlay(b, "ditem"), "only an item in my discard pile");
  refused(() => wcPlay(b, undefined), "nothing to pick");
  assert.equal(zoneOf(b.engine, b.id("wc")), "hand");
  assert.equal(ready(b.engine), 5);
});

clause(WITCHCLOCK, "1:rule", "the picked character is put into play under my control (not deployed: its cost 9 is not paid), and the tactic is spent", () => {
  const b = wcBoard();
  wcPlay(b, "dead");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("dead")), "play");
  assert.equal(b.engine.state.cards[b.id("dead")].controllerId, P1);
  assert.ok(b.engine.state.players[P1].play.includes(b.id("dead")), "b.engine.state.players[P1].play.includes(b.id(dead))");
  assert.equal(discardOf(b.engine, P1).includes(b.id("dead")), false, "it left the discard pile");
  assert.equal(zoneOf(b.engine, b.id("wc")), "discard");
  assert.equal(ready(b.engine), 0, "only the tactic's 5 was paid, not the character's cost of 9");
  assert.deepEqual(stats(b.engine, b.id("dead")), [3, 2, 3]);
  assert.equal(zoneOf(b.engine, b.id("dead2")), "discard", "the other character stayed");
});

clause(WITCHCLOCK, "1:rule", "the character really enters play: its own 'when this card enters play' trigger fires", () => {
  const etb = etbInfluence("Revenant");
  const b = wcBoard({ extra: [{ key: "rev", def: etb, owner: P1, zone: "discard" }] });
  const i0 = infl(b.engine, P1);
  wcPlay(b, "rev");
  assert.equal(zoneOf(b.engine, b.id("rev")), "play");
  assert.equal(infl(b.engine, P1), i0 - 1, "its enters-play trigger fired");
});

// =============================================================================================================
// Wrath of the Mau
// EXTRA COST: Deploy this only during your turn and not during a battle. -- Destroy all characters.
// Tactic, banker, cost 6, [G][G].
// =============================================================================================================
function wmBoard(o: { greed?: number; active?: PlayerId; extra?: Cards } = {}) {
  return mk(
    [
      { key: "wm", def: printing(WRATH), owner: P1, zone: "hand" },
      ...bank("greed", o.greed ?? 6, P1),
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play", depleted: true },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 9, life: 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play" },
      { key: "mygear", def: item({ name: "MyGear" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 3 }), owner: P2, zone: "play" },
      { key: "hc", def: character({ name: "HandChar" }), owner: P2, zone: "hand" },
      { key: "dc", def: character({ name: "DiscChar" }), owner: P2, zone: "discard" },
      ...volition(1, P2),
      ...(o.extra ?? [])
    ],
    { activePlayerId: o.active, turn: o.active === P2 ? 2 : undefined }
  );
}

clause(WRATH, "0:extraCost", "printed card: a banker tactic, cost 6, [G][G]; exactly 6 deploys it, 5 or one [G] are refused", () => {
  printedFacts(WRATH, { type: "tactic", trade: "banker", cost: 6, threshold: "gg" });
  const ok = wmBoard();
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("wm"));
  assert.equal(before - ready(ok.engine), 6, "exactly 6 paid");
  const short = wmBoard({ greed: 5 });
  refused(() => play(short.engine, P1, short.id("wm")), "5 resources for cost 6");
  assert.equal(zoneOf(short.engine, short.id("wm")), "hand");
  assert.equal(zoneOf(short.engine, short.id("mine")), "play", "nothing was destroyed");
  const noIcon = wmBoard({ greed: 1, extra: bank("rage", 5, P1) });
  refused(() => play(noIcon.engine, P1, noIcon.id("wm")), "one [G] only", /threshold|icon/i);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("wm")), "hand");
});

clause(WRATH, "0:extraCost", "during my own turn with no battle it can be deployed", () => {
  const b = wmBoard();
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(b.engine.state.battle, undefined);
  play(b.engine, P1, b.id("wm"));
  assert.equal(zoneOf(b.engine, b.id("wm")), "discard", "played");
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
});

clause(WRATH, "0:extraCost", "NOT during the opponent's turn: in their attack's response window it is refused (nothing paid), while on my turn it works", () => {
  const b = wmBoard({ active: P2, extra: [{ key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  refused(() => playRaw(b.engine, P1, b.id("wm")), "the opponent's turn, in a battle window");
  assert.equal(zoneOf(b.engine, b.id("wm")), "hand");
  assert.equal(ready(b.engine), 6, "nothing paid");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  const quiet = wmBoard({ active: P2, extra: [{ key: "pl", def: character({ name: "Pl", cost: 0 }), owner: P2, zone: "hand" }] });
  playRaw(quiet.engine, P2, quiet.id("pl"));
  refused(() => playRaw(quiet.engine, P1, quiet.id("wm")), "the opponent's turn, responding to their deploy");
  assert.equal(zoneOf(quiet.engine, quiet.id("wm")), "hand");
});

clause(WRATH, "0:extraCost", "NOT during a battle: refused right after I declare an attack (the battle exists), allowed once the battle is over", () => {
  const b = wmBoard();
  b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [b.id("mine")], target: { type: "faction", playerId: P2 } } as never);
  assert.ok(b.engine.state.battle, "a battle is on");
  refused(() => playRaw(b.engine, P1, b.id("wm")), "during my own battle");
  assert.equal(zoneOf(b.engine, b.id("wm")), "hand");
  assert.equal(ready(b.engine), 6, "nothing paid");
  resolvePendingResponses(b.engine);
  declareBlockers(b.engine, P2, []);
  finishBattle(b.engine);
  assert.equal(b.engine.state.battle, undefined);
  play(b.engine, P1, b.id("wm"));
  assert.equal(zoneOf(b.engine, b.id("wm")), "discard", "after the battle it can be deployed");
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard");
});

clause(WRATH, "1:rule", "destroys ALL characters in play, mine and the opponent's, depleted or not, into their owners' discard piles", () => {
  const b = wmBoard();
  play(b.engine, P1, b.id("wm"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const k of ["mine", "mine2"]) {
    assert.equal(zoneOf(b.engine, b.id(k)), "discard", k);
    assert.ok(discardOf(b.engine, P1).includes(b.id(k)), `${k} is in my discard pile`);
  }
  for (const k of ["foe", "foe2"]) {
    assert.equal(zoneOf(b.engine, b.id(k)), "discard", k);
    assert.ok(discardOf(b.engine, P2).includes(b.id(k)), `${k} is in their discard pile`);
  }
});

clause(WRATH, "1:rule", "only characters: items, locations, resources (face-up and face-down), factions and cards in hand / discard are untouched", () => {
  const b = wmBoard();
  play(b.engine, P1, b.id("wm"));
  for (const k of ["gear", "mygear", "place"]) assert.equal(zoneOf(b.engine, b.id(k)), "play", k);
  assert.equal(zoneOf(b.engine, b.id("hc")), "hand");
  assert.equal(zoneOf(b.engine, b.id("dc")), "discard");
  for (const p of [P1, P2]) assert.equal(zoneOf(b.engine, factionOf(b.engine, p)), "play");
  assert.equal(b.engine.state.players[P2].play.filter((id) => b.engine.isResource(id)).length, 1, "their face-down resource is still in play");
  assert.equal(b.engine.state.players[P1].play.filter((id) => b.engine.isResource(id)).length, 6, "my six Greed were SPENT, not destroyed, so they are still resources in play");
});

clause(WRATH, "1:rule", "Micromajig tokens (characters) are destroyed too", () => {
  const b = wmBoard({ extra: [{ key: "maker", def: MAKER(2), owner: P1, zone: "play" }] });
  activate(b.engine, P1, b.id("maker"), "mk");
  assert.equal(tokensOf(b.engine, P1).length, 2);
  const toks = tokensOf(b.engine, P1);
  play(b.engine, P1, b.id("wm"));
  assert.equal(zoneOf(b.engine, b.id("maker")), "discard");
  for (const t of toks) assert.ok(!b.engine.state.cards[t] || b.engine.state.cards[t].zone !== "play", "the token left play");
  assert.equal(b.engine.state.players[P1].play.some((id) => toks.includes(id)), false);
});

// =============================================================================================================
// Extra edge tests (added after the first full run)
// =============================================================================================================
clause(IPO, "0:rule", "[G] provided by a non-resource card I control (a character that provides [G]) also counts as a [G] I control", () => {
  const withProv = mk([
    { key: "ipo", def: printing(IPO), owner: P1, zone: "hand" },
    ...bank("greed", 3, P1),
    ...bank("rage", 3, P1),
    { key: "prov", def: character({ name: "GreedProvider", text: "PROVIDES [G]", resource: { provides: ["greed"], staple: false } } as never), owner: P1, zone: "play" },
    ...fillers("dk", 12, P1, "deck")
  ]);
  assert.equal(withProv.engine.getThresholds(P1).greed, 4, "precondition: 4 [G] icons");
  const inf0 = infl(withProv.engine, P1);
  play(withProv.engine, P1, withProv.id("ipo"));
  assert.equal(handOf(withProv.engine, P1).length, 4, "4 [G]: drew 4");
  assert.equal(infl(withProv.engine, P1) - inf0, 4);
});

clause(TR, "1:ability:fire-up", "FIRE UP: a face-down Tempered Rage that is SPENT (attached to my faction) is still a face-down resource and can be fired up", () => {
  const b = mk([
    { key: "tr", def: printing(TR), owner: P1, zone: "play", faceDown: true, attachedToKey: "__factionA" },
    ...bank("greed", 3, P1)
  ]);
  activate(b.engine, P1, b.id("tr"), "fire-up");
  assert.equal(b.engine.state.cards[b.id("tr")].faceDown, false, "flipped face-up");
  const otherReady = b.engine.state.players[P1].play.filter((id) => id !== b.id("tr") && b.engine.isResource(id) && !b.engine.state.cards[id].attachedTo).length;
  assert.equal(otherReady, 1, "2 of the 3 other ready resources were paid");
});

clause(TEMPLE, "1:rule", "deploying the Temple destroys an opposing character whose life it brings to 0, and leaves my own 1-life character alone", () => {
  const b = templeBoard({
    zone: "hand",
    obs: 5,
    extra: [
      { key: "frail", def: character({ name: "Frail", strength: 1, speed: 1, life: 1 }), owner: P2, zone: "play" },
      { key: "myfrail", def: character({ name: "MyFrail", strength: 1, speed: 1, life: 1 }), owner: P1, zone: "play" }
    ]
  });
  play(b.engine, P1, b.id("temple"));
  assert.equal(zoneOf(b.engine, b.id("temple")), "play");
  assert.equal(zoneOf(b.engine, b.id("frail")), "discard", "the 1-life opposing character died");
  assert.equal(zoneOf(b.engine, b.id("myfrail")), "play", "my own 1-life character is unaffected");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play", "the 3-life opposing character survives");
});

clause(SPY, "1:rule", "when the host character is destroyed the item goes to its owner's discard pile (it cannot stay attached to nothing)", () => {
  const b = spyBoard({ zone: "play", host: "mine", extra: [{ key: "k", def: KILLER(), owner: P1, zone: "play" }] });
  activate(b.engine, P1, b.id("k"), "kill", { selected: { t: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  assert.equal(zoneOf(b.engine, b.id("spy")), "discard");
});

clause(SPY, "2:rule", "'battle damage': damage the host inflicts to a faction by an EFFECT (not in battle) draws nothing", () => {
  const zapper = character({
    name: "Zapper",
    strength: 2,
    life: 3,
    speed: 2,
    behavior: { abilities: [{ id: "zap", type: "activated", effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 1 }] }] } as never
  });
  const b = mk([
    { key: "spy", def: printing(SPY), owner: P1, zone: "play", attachedToKey: "z" },
    { key: "z", def: zapper, owner: P1, zone: "play" },
    ...fillers("dk", 5, P1, "deck")
  ]);
  const hand0 = handOf(b.engine, P1).length;
  const f0 = factionInfluence(b.engine, P2);
  activate(b.engine, P1, b.id("z"), "zap");
  assert.equal(f0 - factionInfluence(b.engine, P2), 1, "the effect damaged the faction");
  assert.equal(handOf(b.engine, P1).length, hand0, "but it was not battle damage: no draw");
});

// =============================================================================================================
// Unwelcome Hero: the most literal reading of the printed text is tested
// =============================================================================================================
const destroyedInfluence = (name: string) =>
  character({
    name,
    cost: 0,
    life: 4,
    behavior: { abilities: [{ id: "death", type: "triggered", event: "cardDestroyed", condition: { type: "sourceIsEventCard" }, effects: [{ type: "modifyInfluence", player: "controller", amount: -1 }] }] } as never
  });
const SCAVENGEMAJIG = "d82edc8c-2381-40fa-bb15-8700a3462775"; // character gearsmith cost 4 [E][E][E]: "When this card enters or leaves play, you may pick an item in your discard pile ..."

clause(HERO, "1:rule", "only the exact words count: a 'when this card is destroyed' trigger (not 'enters play' / 'leaves play') still fires with the Hero in play", () => {
  const b = heroBoard({
    active: P1,
    extra: [
      { key: "mortal", def: destroyedInfluence("Mortal"), owner: P2, zone: "play" },
      { key: "k", def: KILLER(), owner: P1, zone: "play" }
    ]
  });
  const i0 = infl(b.engine, P2);
  activate(b.engine, P1, b.id("k"), "kill", { selected: { t: [b.id("mortal")] } });
  assert.equal(zoneOf(b.engine, b.id("mortal")), "discard");
  assert.equal(infl(b.engine, P2), i0 - 1, "the destroyed-trigger fired");
});

clause(HERO, "1:rule", "a trigger that begins 'When this card enters OR leaves play' does not begin with either quoted phrase, so it is not ignored (Scavengemajig still asks)", () => {
  const b = heroBoard({
    active: P1,
    extra: [
      { key: "sm", def: printing(SCAVENGEMAJIG), owner: P1, zone: "hand" },
      ...bank("elitism", 4, P1),
      { key: "sword", def: item({ name: "Sword" }), owner: P1, zone: "discard" }
    ]
  });
  play(b.engine, P1, b.id("sm"));
  assert.equal(zoneOf(b.engine, b.id("sm")), "play");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "Scavengemajig's 'enters or leaves play' trigger was not ignored");
});

clause(HERO, "1:rule", "cards that leave play at the same moment as the Hero (a sweeper) still have their leaves-play triggers ignored, whichever is moved first", () => {
  for (const heroFirst of [true, false]) {
    const heroP: Cards = [{ key: "hero", def: printing(HERO), owner: P1, zone: "play" }];
    const leaverP: Cards = [{ key: "leaver", def: ltpInfluence("Leaver"), owner: P2, zone: "play" }];
    const b = mk(
      [
        { key: "wm", def: printing(WRATH), owner: P1, zone: "hand" },
        ...bank("greed", 6, P1),
        ...(heroFirst ? [...heroP, ...leaverP] : [...leaverP, ...heroP])
      ]
    );
    const i0 = infl(b.engine, P2);
    play(b.engine, P1, b.id("wm"));
    assert.equal(zoneOf(b.engine, b.id("hero")), "discard", `heroFirst=${heroFirst}`);
    assert.equal(zoneOf(b.engine, b.id("leaver")), "discard", `heroFirst=${heroFirst}`);
    assert.equal(infl(b.engine, P2), i0, `heroFirst=${heroFirst}: the leaver's trigger is ignored because the Hero was in play when they left together`);
  }
});

// @@END@@

// @@END@@

// @@END@@

// @@END@@
