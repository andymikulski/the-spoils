// Clause tests, batch ungodly-mess-04, part p2 (groups 8-12, missing clauses only).
// War Racketeer, Whistleblower Policy, Yenassa Shipping LLP (2 printings), Acrolosian Outpost #30016968A, Animated Scrap Heap.
import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import {
  buildGame,
  activate,
  bank,
  character,
  developFaction,
  item,
  killTactic,
  bounceTactic,
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
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { answerPending, fillers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { declareAttackBy, declareAttackOpenWindow, playRaw } from "./_battle.js";
import { endTurn } from "./_turn.js";

const WAR_RACKETEER = "a49c3c32-ad10-4ffe-8814-aa68ddb666fa"; // character banker cost 7 "gg" 5/3/8 mau, tough guy -- ETB draw per character in play; UNDER THE TABLE
const WHISTLE = "d8c5ed80-7717-49e6-b881-a626bb7e6007"; // tactic banker cost 2 "g" -- EXTRA COST may pick a location (+3 damage); FLIP UP draws per different staple; FLIP UP 3 [G]
const YENASSA_A = "453a6b4d-a4c3-46f7-a9cc-9e043cde9f50"; // character banker vehicle cost 1 "ggg" 1/3/1 -- UNIQUE LLP; +2/+2 per opposing item; items upkeep; FLIP UP 1 [G][G][G]
const YENASSA_B = "684d5f70-bf07-4b3a-95bc-c06c4aa11c81"; // second printing of Yenassa Shipping, LLP
const OUTPOST = "22fd7a13-1319-40e8-8e95-33e90cc5d376"; // location gearsmith cost 1 "e" structure 2 -- SNUB: pay 2, deplete: search for Elitism
const SCRAP = "a10449eb-dac0-46c8-b6d7-23581550ac74"; // character gearsmith golem, majig cost 0 "eeee" 1/3/1 -- X tokens; +1/+1 per token; EXPAND pay 3

const ready = (engine: SpoilsEngine, player: PlayerId): number => readyResources(engine, player);
const handOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => engine.state.players[player].hand;
const deckOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => engine.state.players[player].deck;
const damageOf = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId].damage ?? 0;
const hasKeyword = (engine: SpoilsEngine, cardId: CardInstanceId, keyword: string): boolean => (engine.getKeywords(cardId) as string[]).includes(keyword);
const isDepleted = (engine: SpoilsEngine, cardId: CardInstanceId): boolean => engine.state.cards[cardId].depleted === true;

const rawFlipUp = (engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}): void =>
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });

/** Fisher-Yates exactly as the engine does it, fed by a constant random source (to predict a shuffle). */
function shuffledWithConstant(items: string[], value: number): string[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(value * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ============================================================================
// War Racketeer -- character banker cost 7 "gg", 5/3/8, mau + tough guy
// ============================================================================

const wrDef = (): CardDefinition => printing(WAR_RACKETEER);

interface WrOpts {
  wr?: "hand" | "play";
  greed?: number;
  rage?: number;
  hand?: number;
  deck?: number;
  active?: PlayerId;
  wrDamage?: number;
  extra?: CardPlacement[];
}

function wrBoard(o: WrOpts = {}) {
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [
      { key: "wr", def: wrDef(), owner: P1, zone: o.wr ?? "hand", ...(o.wrDamage ? { damage: o.wrDamage } : {}) },
      ...fillers("h", o.hand ?? 2, P1, "hand"),
      ...fillers("d", o.deck ?? 8, P1, "deck"),
      ...bank("greed", o.greed ?? 7, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.extra ?? [])
    ]
  });
}
type WrGame = ReturnType<typeof wrBoard>;

/** The board for the enters-play rule: one character each side, plus things that are NOT characters in play. */
const wrCrowd = (): CardPlacement[] => [
  { key: "c1", def: character({ name: "C1" }), owner: P1, zone: "play" },
  { key: "c2", def: character({ name: "C2" }), owner: P2, zone: "play" },
  { key: "i1", def: item({ name: "I1" }), owner: P2, zone: "play" },
  { key: "l1", def: location({ name: "L1" }), owner: P1, zone: "play" },
  { key: "fd", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
  { key: "ch", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
  { key: "cd", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" }
];

clause(WAR_RACKETEER, "0:rule", "costs 7 with [G][G]: seven Greed are all spent, and it enters play as a character with printed 5/3/8 (mau, tough guy, banker)", () => {
  const g = wrBoard({ greed: 7, rage: 2 });
  assert.equal(g.engine.getCardPlayability(P1, g.id("wr")).numericCost, 7);
  play(g.engine, P1, g.id("wr"));
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("wr")), "play");
  assert.equal(ready(g.engine, P1), 2, "exactly 7 of the 9 resources were spent");
  assert.deepEqual(g.engine.getCardTypes(g.id("wr")), ["character"]);
  assert.equal(g.engine.getStat(g.id("wr"), "strength"), 5);
  assert.equal(g.engine.getStat(g.id("wr"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("wr"), "life"), 8);
  assert.equal(printing(WAR_RACKETEER).trade, "banker");
  assert.deepEqual([...(printing(WAR_RACKETEER).subtype ?? [])].sort(), ["mau", "tough guy"]);
  assert.equal(printing(WAR_RACKETEER).cost, 7);
  assert.equal(printing(WAR_RACKETEER).threshold, "gg");
});

clause(WAR_RACKETEER, "0:rule", "refused one resource short: six Greed cannot deploy a cost-7 character and nothing is spent", () => {
  const short = wrBoard({ greed: 6 });
  refused(() => play(short.engine, P1, short.id("wr")), "six resources for a cost of seven");
  assert.equal(zoneOf(short.engine, short.id("wr")), "hand");
  assert.equal(ready(short.engine, P1), 6, "nothing was paid");
  const enough = wrBoard({ greed: 7 });
  play(enough.engine, P1, enough.id("wr"));
  assert.equal(zoneOf(enough.engine, enough.id("wr")), "play", "control: seven resources work");
});

clause(WAR_RACKETEER, "0:rule", "needs [G][G]: seven resources with a single Greed are refused, two Greed among five Rage are enough", () => {
  const one = wrBoard({ greed: 1, rage: 6 });
  refused(() => play(one.engine, P1, one.id("wr")), "only one [G]");
  assert.equal(zoneOf(one.engine, one.id("wr")), "hand");
  assert.equal(ready(one.engine, P1), 7);
  const none = wrBoard({ greed: 0, rage: 7 });
  refused(() => play(none.engine, P1, none.id("wr")), "no [G]");
  const two = wrBoard({ greed: 2, rage: 5 });
  play(two.engine, P1, two.id("wr"));
  assert.equal(zoneOf(two.engine, two.id("wr")), "play", "control: [G][G] plus five other resources");
});

clause(WAR_RACKETEER, "0:rule", "when it enters play its controller draws one card for each character in play, counting itself and both players' characters (3 here)", () => {
  const g = wrBoard({ extra: wrCrowd() });
  const top = deckOf(g.engine, P1).slice(0, 3);
  const handBefore = handOf(g.engine, P1).length;
  play(g.engine, P1, g.id("wr"));
  assert.equal(pending(g.engine), undefined);
  assert.equal(handOf(g.engine, P1).length, handBefore - 1 + 3, "War Racketeer + C1 + C2 are the 3 characters in play");
  for (const card of top) assert.equal(zoneOf(g.engine, card), "hand", "the top three cards were the ones drawn");
  assert.equal(deckOf(g.engine, P1).length, 5);
});

clause(WAR_RACKETEER, "0:rule", "the count follows the board: no other character means 1 card, five others means 6", () => {
  const alone = wrBoard({});
  play(alone.engine, P1, alone.id("wr"));
  assert.equal(handOf(alone.engine, P1).length, 2 + 1, "2 in hand, 1 drawn for itself");
  const crowd = wrBoard({
    deck: 10,
    extra: [
      ...Array.from({ length: 3 }, (_, i) => ({ key: `m${i}`, def: character({ name: `M${i}` }), owner: P1, zone: "play" as const })),
      ...Array.from({ length: 2 }, (_, i) => ({ key: `o${i}`, def: character({ name: `O${i}` }), owner: P2, zone: "play" as const }))
    ]
  });
  play(crowd.engine, P1, crowd.id("wr"));
  assert.equal(handOf(crowd.engine, P1).length, 2 + 6, "five others plus itself");
});

clause(WAR_RACKETEER, "0:rule", "only characters in play are counted: items, locations, face-down cards and characters in hand or discard are not", () => {
  const g = wrBoard({ extra: wrCrowd() });
  play(g.engine, P1, g.id("wr"));
  assert.equal(handOf(g.engine, P1).length, 2 + 3, "only C1, C2 and the Racketeer itself");
  assert.equal(zoneOf(g.engine, g.id("ch")), "hand");
});

clause(WAR_RACKETEER, "0:rule", "it triggers only when THIS card enters play: another character entering later draws nothing", () => {
  const g = wrBoard({
    wr: "play",
    greed: 0,
    extra: [{ key: "newbie", def: character({ name: "Newbie", cost: 0 }), owner: P1, zone: "hand" }]
  });
  const handBefore = handOf(g.engine, P1).length;
  play(g.engine, P1, g.id("newbie"));
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("newbie")), "play");
  assert.equal(handOf(g.engine, P1).length, handBefore - 1, "only the played card left the hand; nothing was drawn");
  assert.equal(deckOf(g.engine, P1).length, 8);
});

// -- UNDER THE TABLE -----------------------------------------------------------

/** The id the discard cost is keyed by in `selected` (read from the printed data, never hard-coded in the engine). */
const discardCostKey = (engine: SpoilsEngine, cardId: CardInstanceId): string => {
  const ability = engine.getDefinition(cardId).behavior?.abilities?.find((a) => a.id === "under-the-table") as { costs?: Array<{ id?: string }> } | undefined;
  return String(ability?.costs?.[0]?.id ?? "dc");
};

const underTheTable = (g: WrGame, discardKey: string, player: PlayerId = P1): void =>
  activate(g.engine, player, g.id("wr"), "under-the-table", { selected: { [discardCostKey(g.engine, g.id("wr"))]: [g.id(discardKey)] } });


clause(WAR_RACKETEER, "1:ability:under-the-table", "COST: discard 1 card. The chosen card goes from hand to the discard pile, the other card stays, and the ability resolves", () => {
  const g = wrBoard({ wr: "play" });
  underTheTable(g, "h1");
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("h1")), "discard", "the chosen card is discarded");
  assert.equal(zoneOf(g.engine, g.id("h0")), "hand", "the other card stays");
  assert.equal(handOf(g.engine, P1).length, 1, "exactly one card discarded");
  assert.equal(g.engine.getStat(g.id("wr"), "strength"), 6, "and the effect resolved");
});

clause(WAR_RACKETEER, "1:ability:under-the-table", "either hand card can be the one discarded", () => {
  for (const key of ["h0", "h1"]) {
    const g = wrBoard({ wr: "play" });
    underTheTable(g, key);
    assert.equal(zoneOf(g.engine, g.id(key)), "discard", `${key} was discarded`);
    assert.equal(g.engine.getStat(g.id("wr"), "life"), 7);
  }
});

clause(WAR_RACKETEER, "1:ability:under-the-table", "cannot be used with no card to discard (empty hand); with one card it works", () => {
  const empty = wrBoard({ wr: "play", hand: 0 });
  refused(
    () => activate(empty.engine, P1, empty.id("wr"), "under-the-table", { selected: { [discardCostKey(empty.engine, empty.id("wr"))]: [] } }),
    "nothing to discard",
    /cost|discard/i
  );
  assert.equal(empty.engine.getStat(empty.id("wr"), "strength"), 5, "nothing happened");
  const one = wrBoard({ wr: "play", hand: 1 });
  underTheTable(one, "h0");
  assert.equal(one.engine.getStat(one.id("wr"), "strength"), 6, "control: with a card in hand it works");
});

clause(WAR_RACKETEER, "1:ability:under-the-table", "only a card in YOUR hand can be discarded: the opponent's hand card is refused", () => {
  const g = wrBoard({ wr: "play", extra: [{ key: "oh", def: character({ name: "OppHand" }), owner: P2, zone: "hand" }] });
  refused(() => underTheTable(g, "oh"), "the opponent's card is not a legal discard", /discard|selection|cost/i);
  assert.equal(zoneOf(g.engine, g.id("oh")), "hand");
  assert.equal(g.engine.getStat(g.id("wr"), "strength"), 5);
  underTheTable(g, "h0");
  assert.equal(g.engine.getStat(g.id("wr"), "strength"), 6, "control: own card works");
});

clause(WAR_RACKETEER, "1:ability:under-the-table", "this turn it loses 1 life (8 to 7), gains 1 strength (5 to 6) and COVERT; speed is untouched", () => {
  const g = wrBoard({ wr: "play" });
  assert.equal(hasKeyword(g.engine, g.id("wr"), "covert"), false, "no COVERT before");
  underTheTable(g, "h0");
  assert.equal(g.engine.getStat(g.id("wr"), "life"), 7);
  assert.equal(g.engine.getStat(g.id("wr"), "strength"), 6);
  assert.equal(g.engine.getStat(g.id("wr"), "speed"), 3);
  assert.ok(hasKeyword(g.engine, g.id("wr"), "covert"), "COVERT gained");
});

clause(WAR_RACKETEER, "1:ability:under-the-table", "all three changes last this turn only: gone once the turn ends and still gone on its controller's next turn", () => {
  const g = wrBoard({ wr: "play" });
  underTheTable(g, "h0");
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(g.engine.getStat(g.id("wr"), "life"), 8, "life back to 8");
  assert.equal(g.engine.getStat(g.id("wr"), "strength"), 5, "strength back to 5");
  assert.equal(hasKeyword(g.engine, g.id("wr"), "covert"), false, "COVERT gone");
  endTurn(g.engine, P2);
  assert.equal(g.engine.getStat(g.id("wr"), "life"), 8);
  assert.equal(g.engine.getStat(g.id("wr"), "strength"), 5);
  assert.equal(hasKeyword(g.engine, g.id("wr"), "covert"), false);
});

clause(WAR_RACKETEER, "1:ability:under-the-table", "it can be used again: two activations stack (life 6, strength 7) at the cost of two cards", () => {
  const g = wrBoard({ wr: "play" });
  underTheTable(g, "h0");
  underTheTable(g, "h1");
  assert.equal(handOf(g.engine, P1).length, 0);
  assert.equal(g.engine.getStat(g.id("wr"), "life"), 6);
  assert.equal(g.engine.getStat(g.id("wr"), "strength"), 7);
});

clause(WAR_RACKETEER, "1:ability:under-the-table", "the changes apply to War Racketeer only, not to another character", () => {
  const g = wrBoard({
    wr: "play",
    extra: [{ key: "ally", def: character({ name: "Ally", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" }]
  });
  underTheTable(g, "h0");
  assert.equal(g.engine.getStat(g.id("ally"), "strength"), 2);
  assert.equal(g.engine.getStat(g.id("ally"), "life"), 3);
  assert.equal(hasKeyword(g.engine, g.id("ally"), "covert"), false);
});

clause(WAR_RACKETEER, "1:ability:under-the-table", "the lost life counts against damage: with 7 damage on it, life 7 destroys it", () => {
  const g = wrBoard({ wr: "play", wrDamage: 7 });
  assert.equal(zoneOf(g.engine, g.id("wr")), "play", "control: 7 damage on life 8 survives");
  underTheTable(g, "h0");
  assert.equal(zoneOf(g.engine, g.id("wr")), "discard", "7 damage on life 7 destroys it");
});

clause(WAR_RACKETEER, "1:ability:under-the-table", "the opponent cannot use it", () => {
  const g = wrBoard({ wr: "play", extra: [...fillers("oh", 1, P2, "hand")] });
  refused(() => underTheTable(g, "oh0", P2), "not the Racketeer's controller", /control|priority|ability|not/i);
  assert.equal(g.engine.getStat(g.id("wr"), "strength"), 5);
  underTheTable(g, "h0");
  assert.equal(g.engine.getStat(g.id("wr"), "strength"), 6, "control: the controller can");
});

const covertBlockBoard = (activate_: boolean) => {
  const g = wrBoard({
    wr: "play",
    extra: [
      { key: "plain", def: character({ name: "Plain", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "cov", def: character({ name: "Cov", strength: 1, life: 4, speed: 2, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }
    ]
  });
  if (activate_) underTheTable(g, "h0");
  declareAttackBy(g.engine, P1, [g.id("wr")]);
  return g;
};

clause(WAR_RACKETEER, "1:ability:under-the-table", "with COVERT it cannot be blocked by a non-covert character, a covert character can block it; without the ability an ordinary one can block", () => {
  const without = covertBlockBoard(false);
  assert.doesNotThrow(() => without.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [without.id("plain")] }), "control: unactivated, a non-covert blocker is fine");
  const covert = covertBlockBoard(true);
  assert.throws(() => covert.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [covert.id("plain")] }), "non-covert cannot block a covert attacker");
  assert.doesNotThrow(() => covert.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [covert.id("cov")] }), "a covert character can block it");
});

// ============================================================================
// Whistleblower Policy -- tactic banker cost 2 "g"
// ============================================================================

interface WpOpts {
  wp?: "hand" | "faceDown";
  greed?: number;
  rage?: number;
  deception?: number;
  obsession?: number;
  mineStructure?: number;
  mineDamage?: number;
  theirsDamage?: number;
  active?: PlayerId;
  extra?: CardPlacement[];
}

function wpBoard(o: WpOpts = {}) {
  const active = o.active ?? P1;
  const wp = o.wp ?? "hand";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [
      { key: "wp", def: printing(WHISTLE), owner: P1, zone: wp === "hand" ? "hand" : "play", ...(wp === "faceDown" ? { faceDown: true } : {}) },
      { key: "mine", def: location({ name: "My Hall", structure: o.mineStructure ?? 6 }), owner: P1, zone: "play", damage: o.mineDamage ?? 0 },
      { key: "theirs", def: location({ name: "Their Hall", structure: 6 }), owner: P2, zone: "play", damage: o.theirsDamage ?? 0 },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "myItem", def: item({ name: "My Item" }), owner: P1, zone: "play" },
      { key: "fdLoc", def: location({ name: "Hidden Hall", structure: 6 }), owner: P2, zone: "play", faceDown: true },
      { key: "handLoc", def: location({ name: "Hand Hall", structure: 6 }), owner: P2, zone: "hand" },
      { key: "discLoc", def: location({ name: "Ruined Hall", structure: 6 }), owner: P2, zone: "discard" },
      ...fillers("h", 2, P1, "hand"),
      ...fillers("d", 8, P1, "deck"),
      ...bank("greed", o.greed ?? 2, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...bank("deception", o.deception ?? 0, P1),
      ...bank("obsession", o.obsession ?? 0, P1),
      ...(o.extra ?? [])
    ]
  });
}
type WpGame = ReturnType<typeof wpBoard>;

const playWp = (g: WpGame, pick?: string): void => {
  play(g.engine, P1, g.id("wp"), { selected: pick ? { loc: [g.id(pick)] } : {} });
  drain(g.engine, declineAll);
};
const flipWp = (g: WpGame, pick: string | undefined, player: PlayerId = P1): void => rawFlipUp(g.engine, player, g.id("wp"), pick ? { loc: [g.id(pick)] } : {});
const flipWpDone = (g: WpGame, pick?: string): void => {
  flipWp(g, pick);
  resolvePendingResponses(g.engine);
  drain(g.engine, declineAll);
};

clause(WHISTLE, "0:extraCost", "costs 2 with [G]: refused with 1 resource and with two Rage, exact Greed plus another works, only 2 are spent; it is a banker tactic with no subtype", () => {
  const one = wpBoard({ greed: 1 });
  refused(() => playWp(one, "mine"), "one resource for a cost of two");
  assert.equal(zoneOf(one.engine, one.id("wp")), "hand");
  assert.equal(ready(one.engine, P1), 1, "nothing was paid");
  const noG = wpBoard({ greed: 0, rage: 2 });
  refused(() => playWp(noG, "mine"), "two Rage and no [G]");
  assert.equal(ready(noG.engine, P1), 2);
  const exact = wpBoard({ greed: 1, rage: 1 });
  playWp(exact, "mine");
  assert.equal(ready(exact.engine, P1), 0, "exactly 2 paid");
  assert.equal(zoneOf(exact.engine, exact.id("wp")), "discard");
  const spare = wpBoard({ greed: 2, rage: 3 });
  playWp(spare, "mine");
  assert.equal(ready(spare.engine, P1), 3, "5 - 2");
  assert.deepEqual(spare.engine.getCardTypes(spare.id("wp")), ["tactic"]);
  assert.equal(printing(WHISTLE).trade, "banker");
  assert.deepEqual(printing(WHISTLE).subtype ?? [], []);
  assert.equal(printing(WHISTLE).cost, 2);
  assert.equal(printing(WHISTLE).threshold, "g");
});

clause(WHISTLE, "0:extraCost", "the location pick is optional: it can be played with no pick, and then no location is damaged", () => {
  const g = wpBoard({ mineDamage: 2, theirsDamage: 1 });
  playWp(g);
  assert.equal(zoneOf(g.engine, g.id("wp")), "discard", "the tactic resolved");
  assert.equal(damageOf(g.engine, g.id("mine")), 2);
  assert.equal(damageOf(g.engine, g.id("theirs")), 1);
  assert.equal(ready(g.engine, P1), 0, "its cost was paid");
});

clause(WHISTLE, "0:extraCost", "it can also be played with no location in play at all", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "wp", def: printing(WHISTLE), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...bank("greed", 2, P1)
    ]
  });
  play(g.engine, P1, g.id("wp"), { selected: {} });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("wp")), "discard");
  assert.equal(ready(g.engine, P1), 0);
});

clause(WHISTLE, "0:extraCost", "any location in play can be picked, mine or the opponent's", () => {
  for (const pick of ["mine", "theirs"]) {
    const g = wpBoard();
    playWp(g, pick);
    assert.equal(zoneOf(g.engine, g.id("wp")), "discard", `${pick}: it resolved`);
    assert.equal(damageOf(g.engine, g.id(pick)), 3, `${pick}: 3 damage markers`);
  }
});

clause(WHISTLE, "0:extraCost", "only a location in play can be picked: a character, an item, a faction, a face-down card, a location in hand or in discard are refused", () => {
  const g = wpBoard();
  const attempt = (cardId: CardInstanceId, why: string) => {
    refused(() => play(g.engine, P1, g.id("wp"), { selected: { loc: [cardId] } }), why);
    assert.equal(zoneOf(g.engine, g.id("wp")), "hand", `${why}: still in hand`);
    assert.equal(ready(g.engine, P1), 2, `${why}: nothing paid`);
  };
  attempt(g.id("foe"), "a character");
  attempt(g.id("myItem"), "an item");
  attempt(g.engine.state.players[P2].factionId!, "a faction");
  attempt(g.id("fdLoc"), "a face-down card");
  attempt(g.id("handLoc"), "a location in the opponent's hand");
  attempt(g.id("discLoc"), "a location in the discard pile");
  play(g.engine, P1, g.id("wp"), { selected: { loc: [g.id("theirs")] } });
  drain(g.engine, declineAll);
  assert.equal(damageOf(g.engine, g.id("theirs")), 3, "control: a real location is accepted");
});

clause(WHISTLE, "0:extraCost", "at most one location is picked: two picks are refused", () => {
  const g = wpBoard();
  refused(() => play(g.engine, P1, g.id("wp"), { selected: { loc: [g.id("mine"), g.id("theirs")] } }), "two locations");
  assert.equal(zoneOf(g.engine, g.id("wp")), "hand");
  assert.equal(ready(g.engine, P1), 2);
});

clause(WHISTLE, "0:extraCost", "the pick is part of the cost: the 2 resources are already paid and the location untouched while the tactic waits for responses", () => {
  const g = wpBoard();
  playRaw(g.engine, P1, g.id("wp"), { selected: { loc: [g.id("mine")] } });
  assert.equal(ready(g.engine, P1), 0, "both resources paid at play time");
  assert.ok(g.engine.state.responseWindow, "waiting for responses");
  assert.equal(damageOf(g.engine, g.id("mine")), 0, "nothing has happened to the location yet");
  resolvePendingResponses(g.engine);
  assert.equal(damageOf(g.engine, g.id("mine")), 3);
});

clause(WHISTLE, "1:rule", "a picked location gets exactly 3 damage markers, stacking on markers already there (2 becomes 5), and only the picked one", () => {
  const fresh = wpBoard();
  playWp(fresh, "mine");
  assert.equal(damageOf(fresh.engine, fresh.id("mine")), 3);
  assert.equal(damageOf(fresh.engine, fresh.id("theirs")), 0, "the other location is untouched");
  const stacked = wpBoard({ mineDamage: 2, theirsDamage: 2 });
  playWp(stacked, "theirs");
  assert.equal(damageOf(stacked.engine, stacked.id("theirs")), 5);
  assert.equal(damageOf(stacked.engine, stacked.id("mine")), 2, "the unpicked one stays at 2");
});

clause(WHISTLE, "1:rule", "3 markers that reach a location's structure destroy it (3 on structure 3, 1 + 3 on 4); one short survives", () => {
  const exact = wpBoard({ mineStructure: 3 });
  playWp(exact, "mine");
  assert.equal(zoneOf(exact.engine, exact.id("mine")), "discard", "3 damage on structure 3");
  const over = wpBoard({ mineStructure: 4, mineDamage: 1 });
  playWp(over, "mine");
  assert.equal(zoneOf(over.engine, over.id("mine")), "discard", "1 + 3 on structure 4");
  const short = wpBoard({ mineStructure: 4 });
  playWp(short, "mine");
  assert.equal(zoneOf(short.engine, short.id("mine")), "play", "control: 3 on structure 4 survives");
  assert.equal(damageOf(short.engine, short.id("mine")), 3);
});

clause(WHISTLE, "1:rule", "with no location picked nothing is damaged, even with a location in play", () => {
  const g = wpBoard({ mineDamage: 1, theirsDamage: 1 });
  playWp(g);
  assert.equal(damageOf(g.engine, g.id("mine")), 1);
  assert.equal(damageOf(g.engine, g.id("theirs")), 1);
  assert.equal(damageOf(g.engine, g.id("foe")), 0);
});

clause(WHISTLE, "1:rule", "deployed from the hand (not by FLIP UP) it draws no cards, however many staples are in play and whether or not a location was picked", () => {
  for (const pick of ["mine", undefined]) {
    const g = wpBoard({ greed: 2, rage: 2, deception: 2, obsession: 1 });
    const before = handOf(g.engine, P1).length;
    playWp(g, pick);
    assert.equal(handOf(g.engine, P1).length, before - 1, `pick ${pick}: only the tactic left the hand`);
    assert.equal(deckOf(g.engine, P1).length, 8, "nothing drawn");
  }
});

// -- the FLIP UP branch of the rule --------------------------------------------

clause(WHISTLE, "1:rule", "deployed with FLIP UP it draws one card for each DIFFERENT staple resource you control: Greed, Rage and Deception make 3", () => {
  const g = wpBoard({ wp: "faceDown", greed: 2, rage: 2, deception: 2 });
  const top = deckOf(g.engine, P1).slice(0, 3);
  const before = handOf(g.engine, P1).length;
  flipWpDone(g);
  assert.equal(handOf(g.engine, P1).length, before + 3);
  for (const card of top) assert.equal(zoneOf(g.engine, card), "hand", "the top three cards were drawn");
  assert.equal(zoneOf(g.engine, g.id("wp")), "discard");
});

clause(WHISTLE, "1:rule", "'different' counts kinds, not copies: four Greed alone draw 1, two kinds draw 2, all five kinds draw 5", () => {
  const four = wpBoard({ wp: "faceDown", greed: 4 });
  flipWpDone(four);
  assert.equal(handOf(four.engine, P1).length, 2 + 1, "one kind");
  const two = wpBoard({ wp: "faceDown", greed: 3, rage: 3 });
  flipWpDone(two);
  assert.equal(handOf(two.engine, P1).length, 2 + 2, "two kinds");
  const five = wpBoard({
    wp: "faceDown",
    greed: 1,
    rage: 1,
    deception: 1,
    obsession: 1,
    extra: bank("elitism", 1, P1)
  });
  flipWpDone(five);
  assert.equal(handOf(five.engine, P1).length, 2 + 5, "five kinds");
});

clause(WHISTLE, "1:rule", "only staples YOU control count: the opponent's staples and non-staple resources do not", () => {
  const g = wpBoard({
    wp: "faceDown",
    greed: 2,
    extra: [
      ...bank("elitism", 2, P2),
      { key: "odd", def: resourceCard({ name: "Odd Resource", resource: { provides: ["rage"], staple: false } }), owner: P1, zone: "play" }
    ]
  });
  flipWpDone(g);
  assert.equal(handOf(g.engine, P1).length, 2 + 1, "only your Greed counts");
});

clause(WHISTLE, "1:rule", "face-down resources are not staple resources (a face-down card is a nameless Volition resource): two face-down cards add no kind", () => {
  const g = wpBoard({ wp: "faceDown", greed: 2, extra: volition(2, P1) });
  flipWpDone(g);
  assert.equal(handOf(g.engine, P1).length, 2 + 1, "only the Greed counts; the face-down cards are not staples");
});

clause(WHISTLE, "1:rule", "a staple resource the opponent controls but I own does not matter; one I own but the opponent controls does not count, one I control does", () => {
  const g = wpBoard({
    wp: "faceDown",
    greed: 2,
    extra: [
      { key: "stolen", def: resourceCard({ name: "Elitism", resource: { provides: ["elitism"], staple: true } }), owner: P1, zone: "play", controller: P2 },
      { key: "borrowed", def: resourceCard({ name: "Rage", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "play", controller: P1 }
    ]
  });
  flipWpDone(g);
  assert.equal(handOf(g.engine, P1).length, 2 + 2, "Greed plus the Rage I control; the Elitism I own does not count");
});

clause(WHISTLE, "1:rule", "FLIP UP with a location picked does both: 3 damage markers AND the draws", () => {
  const g = wpBoard({ wp: "faceDown", greed: 2, rage: 1 });
  flipWpDone(g, "theirs");
  assert.equal(damageOf(g.engine, g.id("theirs")), 3);
  assert.equal(handOf(g.engine, P1).length, 2 + 2, "Greed and Rage");
});

clause(WHISTLE, "1:rule", "FLIP UP with no location picked draws but damages nothing", () => {
  const g = wpBoard({ wp: "faceDown", greed: 2, rage: 1, mineDamage: 1, theirsDamage: 1 });
  flipWpDone(g);
  assert.equal(handOf(g.engine, P1).length, 2 + 2);
  assert.equal(damageOf(g.engine, g.id("mine")), 1);
  assert.equal(damageOf(g.engine, g.id("theirs")), 1);
});

// -- FLIP UP: 3 [G] ------------------------------------------------------------

clause(WHISTLE, "2:flipUp", "a face-down Whistleblower flips up for 3 with [G], itself among the 3 resources: it resolves and ends in the discard pile", () => {
  const g = wpBoard({ wp: "faceDown", greed: 2 });
  assert.equal(ready(g.engine, P1), 3, "setup: the face-down card and two Greed");
  flipWp(g, "mine");
  resolvePendingResponses(g.engine);
  assert.equal(pending(g.engine), undefined);
  assert.equal(damageOf(g.engine, g.id("mine")), 3);
  assert.equal(zoneOf(g.engine, g.id("wp")), "discard");
  assert.equal(ready(g.engine, P1), 0, "all 3 were spent, the face-down card itself among them");
});

clause(WHISTLE, "2:flipUp", "pays exactly 3 and no more: with extra resources the others stay ready", () => {
  const g = wpBoard({ wp: "faceDown", greed: 2, rage: 3 });
  assert.equal(ready(g.engine, P1), 6);
  flipWpDone(g, "mine");
  assert.equal(ready(g.engine, P1), 2, "6 resources: the face-down card leaves the pool and 3 others are spent");
});

clause(WHISTLE, "2:flipUp", "is refused short of 3: itself plus one Greed, and nothing is paid", () => {
  const g = wpBoard({ wp: "faceDown", greed: 1 });
  refused(() => flipWp(g, "mine"), "2 resources for 3");
  assert.equal(g.engine.state.cards[g.id("wp")].faceDown, true);
  assert.equal(ready(g.engine, P1), 2);
  assert.equal(damageOf(g.engine, g.id("mine")), 0);
  const ok = wpBoard({ wp: "faceDown", greed: 1, rage: 1 });
  flipWpDone(ok, "mine");
  assert.equal(zoneOf(ok.engine, ok.id("wp")), "discard", "control: itself + Greed + Rage is exactly 3");
});

clause(WHISTLE, "2:flipUp", "needs [G] among the other resources: itself plus two Rage (three resources, no Greed) is refused", () => {
  const g = wpBoard({ wp: "faceDown", greed: 0, rage: 2 });
  refused(() => flipWp(g, "mine"), "no [G]");
  assert.equal(g.engine.state.cards[g.id("wp")].faceDown, true);
  assert.equal(ready(g.engine, P1), 3);
  assert.equal(damageOf(g.engine, g.id("mine")), 0, "nothing happened");
  const withG = wpBoard({ wp: "faceDown", greed: 1, rage: 1 });
  flipWpDone(withG, "mine");
  assert.equal(damageOf(withG.engine, withG.id("mine")), 3, "control: one Greed is enough");
});

clause(WHISTLE, "2:flipUp", "the flipped-up tactic still has its optional pick: only a location is accepted, and it may be skipped", () => {
  const g = wpBoard({ wp: "faceDown", greed: 2 });
  refused(() => flipWp(g, "foe"), "a character is not a location");
  refused(() => flipWp(g, "handLoc"), "a location in hand is not in play");
  assert.equal(g.engine.state.cards[g.id("wp")].faceDown, true);
  assert.equal(ready(g.engine, P1), 3, "refusals paid nothing");
  flipWpDone(g);
  assert.equal(zoneOf(g.engine, g.id("wp")), "discard", "skipping the pick works");
  assert.equal(damageOf(g.engine, g.id("mine")), 0);
});

clause(WHISTLE, "2:flipUp", "FLIP UP does not change when a tactic can be played: refused on the opponent's turn outside a response window, allowed in response to their attack", () => {
  const g = wpBoard({ wp: "faceDown", greed: 2, active: P2 });
  refused(() => flipWp(g, "mine"), "nothing to respond to yet");
  assert.equal(g.engine.state.cards[g.id("wp")].faceDown, true);
  assert.equal(ready(g.engine, P1), 3, "nothing was paid");
  g.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [g.id("foe")], target: { type: "faction", playerId: P1 } });
  g.engine.perform({ type: "passPriority", playerId: P2 });
  flipWp(g, "mine");
  resolvePendingResponses(g.engine);
  assert.equal(damageOf(g.engine, g.id("mine")), 3, "flipped up in response to the attack");
});

clause(WHISTLE, "2:flipUp", "only its controller can flip it, and only while it is face-down in play", () => {
  const theirs = wpBoard({ wp: "faceDown", greed: 2, extra: bank("greed", 3, P2) });
  refused(() => flipWp(theirs, "mine", P2), "the opponent cannot flip my card");
  assert.equal(theirs.engine.state.cards[theirs.id("wp")].faceDown, true);
  const inHand = wpBoard({ wp: "hand", greed: 3 });
  refused(() => flipWp(inHand, "mine"), "in hand it is not a face-down resource");
  assert.equal(zoneOf(inHand.engine, inHand.id("wp")), "hand");
});

// ============================================================================
// Yenassa Shipping, LLP -- two printings. UNIQUE LLP; cost 1 "ggg"; 1/3/1 vehicle.
// ============================================================================

interface YsOpts {
  ys?: "play" | "hand" | "faceDown" | "none";
  ysController?: PlayerId;
  greed?: number;
  rage?: number;
  p2greed?: number;
  active?: PlayerId;
  ysDamage?: number;
  extra?: CardPlacement[];
}

function ysBoard(pid: string, o: YsOpts = {}) {
  const active = o.active ?? P1;
  const ys = o.ys ?? "play";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [
      ...(ys === "none"
        ? []
        : [
            {
              key: "ys",
              def: printing(pid),
              owner: o.ysController ?? P1,
              zone: ys === "hand" ? ("hand" as const) : ("play" as const),
              ...(ys === "faceDown" ? { faceDown: true } : {}),
              ...(o.ysDamage ? { damage: o.ysDamage } : {})
            }
          ]),
      ...bank("greed", o.greed ?? 0, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...bank("greed", o.p2greed ?? 0, P2),
      ...(o.extra ?? [])
    ]
  });
}
type YsGame = ReturnType<typeof ysBoard>;

const otherPrinting = (pid: string): string => (pid === YENASSA_A ? YENASSA_B : YENASSA_A);
const plainItem = (key: string, owner: PlayerId, controller?: PlayerId): CardPlacement => ({
  key,
  def: item({ name: `Item ${key}` }),
  owner,
  zone: "play",
  ...(controller ? { controller } : {})
});

const ysCost = (pid: string) => () => {
  const g = ysBoard(pid, { ys: "hand", greed: 3, rage: 2 });
  assert.equal(g.engine.getCardPlayability(P1, g.id("ys")).numericCost, 1);
  play(g.engine, P1, g.id("ys"));
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("ys")), "play");
  assert.equal(ready(g.engine, P1), 4, "exactly 1 of the 5 resources was spent");
  assert.deepEqual(g.engine.getCardTypes(g.id("ys")), ["character"]);
  assert.equal(g.engine.getStat(g.id("ys"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("ys"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("ys"), "life"), 1);
  assert.equal(printing(pid).trade, "banker");
  assert.deepEqual(printing(pid).subtype ?? [], ["vehicle"]);
  assert.equal(printing(pid).cost, 1);
  assert.equal(printing(pid).threshold, "ggg");
  const none = ysBoard(pid, { ys: "hand", greed: 0 });
  refused(() => play(none.engine, P1, none.id("ys")), "no resources at all");
  assert.equal(zoneOf(none.engine, none.id("ys")), "hand");
};

const ysThreshold = (pid: string) => () => {
  const two = ysBoard(pid, { ys: "hand", greed: 2, rage: 3 });
  refused(() => play(two.engine, P1, two.id("ys")), "only [G][G]");
  assert.equal(zoneOf(two.engine, two.id("ys")), "hand");
  assert.equal(ready(two.engine, P1), 5, "nothing paid");
  const none = ysBoard(pid, { ys: "hand", greed: 0, rage: 5 });
  refused(() => play(none.engine, P1, none.id("ys")), "no Greed");
  const three = ysBoard(pid, { ys: "hand", greed: 3 });
  play(three.engine, P1, three.id("ys"));
  assert.equal(zoneOf(three.engine, three.id("ys")), "play", "control: [G][G][G] exactly");
  assert.equal(ready(three.engine, P1), 2, "cost 1 paid");
};

clause(YENASSA_A, "0:unique", "deploys for exactly cost 1 with [G][G][G], enters as a printed 1/3/1 banker vehicle character", ysCost(YENASSA_A));
clause(YENASSA_B, "0:unique", "deploys for exactly cost 1 with [G][G][G], enters as a printed 1/3/1 banker vehicle character", ysCost(YENASSA_B));
clause(YENASSA_A, "0:unique", "needs [G][G][G]: two Greed (or five Rage) are refused", ysThreshold(YENASSA_A));
clause(YENASSA_B, "0:unique", "needs [G][G][G]: two Greed (or five Rage) are refused", ysThreshold(YENASSA_B));

const keepChoice = (g: YsGame, keepKey: string): void =>
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id(keepKey) } } as never);

const ysUniqueSame = (pid: string) => () => {
  const g = ysBoard(pid, { ys: "play", greed: 3, extra: [{ key: "ys2", def: printing(pid), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("ys2"));
  const pc = pending(g.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses");
  assert.deepEqual([...pc.candidates].sort(), [g.id("ys"), g.id("ys2")].sort());
  keepChoice(g, "ys2");
  assert.equal(zoneOf(g.engine, g.id("ys2")), "play");
  assert.equal(zoneOf(g.engine, g.id("ys")), "discard", "the other copy is destroyed");
  assert.equal(pending(g.engine), undefined);
};

const ysUniqueKeepOld = (pid: string) => () => {
  const g = ysBoard(pid, { ys: "play", greed: 3, extra: [{ key: "ys2", def: printing(pid), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("ys2"));
  keepChoice(g, "ys");
  assert.equal(zoneOf(g.engine, g.id("ys")), "play");
  assert.equal(zoneOf(g.engine, g.id("ys2")), "discard", "choosing the old one destroys the new one");
  assert.equal(pending(g.engine), undefined);
};

const ysUniqueCross = (pid: string) => () => {
  const g = ysBoard(pid, { ys: "play", greed: 3, extra: [{ key: "ys2", def: printing(otherPrinting(pid)), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("ys2"));
  const pc = pending(g.engine) as unknown as { kind: string };
  assert.equal(pc?.kind, "uniqueSurvivor", "the other printing of Yenassa is also an LLP");
  keepChoice(g, "ys2");
  assert.equal(zoneOf(g.engine, g.id("ys")), "discard");
  assert.equal(zoneOf(g.engine, g.id("ys2")), "play");
};

const ysUniquePerPlayer = (pid: string) => () => {
  const g = ysBoard(pid, {
    ys: "play",
    greed: 3,
    extra: [
      { key: "theirs", def: printing(pid), owner: P2, zone: "play" },
      { key: "ys2", def: character({ name: "Other Vehicle", cost: 0 }), owner: P1, zone: "hand" }
    ]
  });
  assert.equal(pending(g.engine), undefined, "the opponent controlling their own LLP is not a duplicate");
  assert.equal(zoneOf(g.engine, g.id("ys")), "play");
  assert.equal(zoneOf(g.engine, g.id("theirs")), "play");
  play(g.engine, P1, g.id("ys2"));
  assert.equal(pending(g.engine), undefined, "control: a card without LLP triggers nothing");
};

const ysUniqueOnlyOne = (pid: string) => () => {
  const g = ysBoard(pid, { ys: "none", greed: 3, extra: [{ key: "ys1", def: printing(pid), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("ys1"));
  assert.equal(pending(g.engine), undefined, "a single copy raises no choice");
  assert.equal(zoneOf(g.engine, g.id("ys1")), "play");
};

clause(YENASSA_A, "0:unique", "a second copy makes the controller keep one: keeping the new one destroys the old one", ysUniqueSame(YENASSA_A));
clause(YENASSA_B, "0:unique", "a second copy makes the controller keep one: keeping the new one destroys the old one", ysUniqueSame(YENASSA_B));
clause(YENASSA_A, "0:unique", "keeping the old one destroys the new one", ysUniqueKeepOld(YENASSA_A));
clause(YENASSA_B, "0:unique", "keeping the old one destroys the new one", ysUniqueKeepOld(YENASSA_B));
clause(YENASSA_A, "0:unique", "the two printings share the LLP restriction", ysUniqueCross(YENASSA_A));
clause(YENASSA_B, "0:unique", "the two printings share the LLP restriction", ysUniqueCross(YENASSA_B));
clause(YENASSA_A, "0:unique", "the restriction is per player: the opponent may control their own LLP, and a lone copy raises no choice", () => {
  ysUniquePerPlayer(YENASSA_A)();
  ysUniqueOnlyOne(YENASSA_A)();
});
clause(YENASSA_B, "0:unique", "the restriction is per player: the opponent may control their own LLP, and a lone copy raises no choice", () => {
  ysUniquePerPlayer(YENASSA_B)();
  ysUniqueOnlyOne(YENASSA_B)();
});

// -- "gains 2 strength and 2 life for each item your opponents control" -----------

const ysScale = (pid: string) => () => {
  for (const n of [0, 1, 2, 3]) {
    const g = ysBoard(pid, { extra: Array.from({ length: n }, (_, i) => plainItem(`t${i}`, P2)) });
    assert.equal(g.engine.getStat(g.id("ys"), "strength"), 1 + 2 * n, `${n} opposing items: strength`);
    assert.equal(g.engine.getStat(g.id("ys"), "life"), 1 + 2 * n, `${n} opposing items: life`);
    assert.equal(g.engine.getStat(g.id("ys"), "speed"), 3, `${n}: speed untouched`);
  }
};

const ysOnlyOpposing = (pid: string) => () => {
  const g = ysBoard(pid, {
    extra: [
      plainItem("mine1", P1),
      plainItem("mine2", P1),
      { key: "oc", def: character({ name: "OppChar" }), owner: P2, zone: "play" },
      { key: "ol", def: location({ name: "OppLoc" }), owner: P2, zone: "play" },
      { key: "ofd", def: item({ name: "Hidden Item" }), owner: P2, zone: "play", faceDown: true },
      { key: "ohand", def: item({ name: "Hand Item" }), owner: P2, zone: "hand" },
      { key: "odisc", def: item({ name: "Discarded Item" }), owner: P2, zone: "discard" },
      plainItem("t0", P2)
    ]
  });
  assert.equal(g.engine.getStat(g.id("ys"), "strength"), 3, "only the one face-up opposing item in play counts");
  assert.equal(g.engine.getStat(g.id("ys"), "life"), 3);
};

const ysControlNotOwner = (pid: string) => () => {
  const g = ysBoard(pid, { extra: [plainItem("stolen", P1, P2), plainItem("lent", P2, P1)] });
  assert.equal(g.engine.getStat(g.id("ys"), "strength"), 3, "an item I own but the opponent controls counts; one I own's neighbour that I control does not");
  assert.equal(g.engine.getStat(g.id("ys"), "life"), 3);
};

const ysOpponentSide = (pid: string) => () => {
  const g = ysBoard(pid, { ysController: P2, extra: [plainItem("a", P1), plainItem("b", P1), plainItem("c", P1), plainItem("mine", P2)] });
  assert.equal(g.engine.getStat(g.id("ys"), "strength"), 1 + 6, "controlled by P2, the opposing items are P1's three");
  assert.equal(g.engine.getStat(g.id("ys"), "life"), 1 + 6);
};

const ysTracks = (pid: string) => () => {
  const kill = tactic({
    name: "Kill Item",
    cost: 0,
    behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const g = ysBoard(pid, { extra: [plainItem("t0", P2), plainItem("t1", P2), { key: "kill", def: kill, owner: P1, zone: "hand" }] });
  assert.equal(g.engine.getStat(g.id("ys"), "strength"), 5);
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("t0")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("t0")), "discard");
  assert.equal(g.engine.getStat(g.id("ys"), "strength"), 3, "one fewer opposing item, 2 fewer strength");
  assert.equal(g.engine.getStat(g.id("ys"), "life"), 3, "and 2 fewer life");
};

const ysLifeDrop = (pid: string) => () => {
  const kill = tactic({
    name: "Kill Item",
    cost: 0,
    behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const g = ysBoard(pid, { ysDamage: 2, extra: [plainItem("t0", P2), { key: "kill", def: kill, owner: P1, zone: "hand" }] });
  assert.equal(zoneOf(g.engine, g.id("ys")), "play", "life 3 with 2 damage survives");
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("t0")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("ys")), "discard", "the bonus life is gone, so 2 damage on life 1 destroys it");
};

const ysFaceDownNoBonus = (pid: string) => () => {
  const g = ysBoard(pid, { ys: "faceDown", extra: [plainItem("t0", P2)] });
  assert.equal(g.engine.state.cards[g.id("ys")].faceDown, true);
  assert.equal(zoneOf(g.engine, g.id("ys")), "play");
  const hand = ysBoard(pid, { ys: "hand", extra: [plainItem("t0", P2)] });
  assert.equal(hand.engine.getStat(hand.id("ys"), "strength"), 1, "in hand it has its printed strength, no bonus");
  assert.equal(hand.engine.getStat(hand.id("ys"), "life"), 1);
};

const ysLeaves = (pid: string) => () => {
  const g = ysBoard(pid, { extra: [plainItem("t0", P2), plainItem("t1", P2), { key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  assert.equal(g.engine.getStat(g.id("ys"), "strength"), 5);
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("ys")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("ys")), "discard");
  assert.equal(g.engine.getStat(g.id("ys"), "strength"), 1, "in the discard pile it reads printed stats, no bonus");
  assert.equal(g.engine.getStat(g.id("ys"), "life"), 1);
};

clause(YENASSA_A, "1:rule", "gains +2/+2 for each item the opponent controls: 0, 1, 2, 3 items give 1/1, 3/3, 5/5, 7/7 (speed stays 3)", ysScale(YENASSA_A));
clause(YENASSA_B, "1:rule", "gains +2/+2 for each item the opponent controls: 0, 1, 2, 3 items give 1/1, 3/3, 5/5, 7/7 (speed stays 3)", ysScale(YENASSA_B));
clause(YENASSA_A, "1:rule", "only face-up items the opponent controls in play count: my items, their characters, locations, face-down and hand / discard items do not", ysOnlyOpposing(YENASSA_A));
clause(YENASSA_B, "1:rule", "only face-up items the opponent controls in play count: my items, their characters, locations, face-down and hand / discard items do not", ysOnlyOpposing(YENASSA_B));
clause(YENASSA_A, "1:rule", "control, not ownership, decides: my item under their control counts, their item under my control does not", ysControlNotOwner(YENASSA_A));
clause(YENASSA_B, "1:rule", "control, not ownership, decides: my item under their control counts, their item under my control does not", ysControlNotOwner(YENASSA_B));
clause(YENASSA_A, "1:rule", "controlled by the second player the opposing items are the first player's", ysOpponentSide(YENASSA_A));
clause(YENASSA_B, "1:rule", "controlled by the second player the opposing items are the first player's", ysOpponentSide(YENASSA_B));
clause(YENASSA_A, "1:rule", "the bonus tracks the board: destroying an opposing item lowers strength and life by 2 each", ysTracks(YENASSA_A));
clause(YENASSA_B, "1:rule", "the bonus tracks the board: destroying an opposing item lowers strength and life by 2 each", ysTracks(YENASSA_B));
clause(YENASSA_A, "1:rule", "losing the bonus life while damaged destroys it (2 damage on life 3, then the item leaves)", ysLifeDrop(YENASSA_A));
clause(YENASSA_B, "1:rule", "losing the bonus life while damaged destroys it (2 damage on life 3, then the item leaves)", ysLifeDrop(YENASSA_B));
clause(YENASSA_A, "1:rule", "the bonus is off when it is not a face-up card in play (face-down, in hand)", ysFaceDownNoBonus(YENASSA_A));
clause(YENASSA_B, "1:rule", "the bonus is off when it is not a face-up card in play (face-down, in hand)", ysFaceDownNoBonus(YENASSA_B));
clause(YENASSA_A, "1:rule", "once it has left play the bonus is gone", ysLeaves(YENASSA_A));
clause(YENASSA_B, "1:rule", "once it has left play the bonus is gone", ysLeaves(YENASSA_B));

// -- "All items gain: At the start of your turn, you may pay 1. If you don't, destroy this card." --

const mayPayAnswer = (pay: boolean) => (pc: PendingChoiceLike): unknown => (pc.kind === "mayPay" ? { kind: "mayPay", pay } : declineAll(pc));

/** P2's turn is active; ending it starts P1's. P1 has two Greed, P2 has two Greed; one item each side (plus a P1 character and location). */
function ysUpkeepBoard(pid: string, o: YsOpts = {}) {
  return ysBoard(pid, {
    active: P2,
    greed: 2,
    p2greed: 2,
    ...o,
    extra: [
      plainItem("m1", P1),
      plainItem("t1", P2),
      { key: "mc", def: character({ name: "MyChar" }), owner: P1, zone: "play" },
      { key: "ml", def: location({ name: "MyLoc" }), owner: P1, zone: "play" },
      ...(o.extra ?? [])
    ]
  });
}

const ysUpkeepPay = (pid: string) => () => {
  const g = ysUpkeepBoard(pid);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1, "P1's turn started");
  const pc = pending(g.engine) as unknown as { kind: string; playerId: string; cost: Array<{ type: string; amount: number }> };
  assert.equal(pc?.kind, "mayPay", "the item asks its controller");
  assert.equal(pc.playerId, P1);
  assert.deepEqual(pc.cost.map((c) => [c.type, c.amount]), [["payResources", 1]], "the price is exactly 1");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(pending(g.engine), undefined, "exactly one prompt: only P1's item, not P1's character, location or P2's item");
  assert.equal(zoneOf(g.engine, g.id("m1")), "play", "paid, so the item stays");
  assert.equal(zoneOf(g.engine, g.id("t1")), "play", "the opponent's item is not affected on my turn");
  assert.equal(ready(g.engine, P1), 1, "exactly 1 of 2 Greed was spent");
  assert.equal(zoneOf(g.engine, g.id("mc")), "play");
  assert.equal(zoneOf(g.engine, g.id("ml")), "play");
};

const ysUpkeepDecline = (pid: string) => () => {
  const g = ysUpkeepBoard(pid);
  endTurn(g.engine, P2);
  assert.equal(pending(g.engine)?.kind, "mayPay");
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("m1")), "discard", "not paying destroys the item");
  assert.equal(ready(g.engine, P1), 2, "nothing was spent");
  assert.equal(zoneOf(g.engine, g.id("t1")), "play");
  assert.equal(zoneOf(g.engine, g.id("ys")), "play", "only the item is destroyed");
};

const ysUpkeepOpp = (pid: string) => () => {
  const g = ysUpkeepBoard(pid);
  endTurn(g.engine, P2);
  answerPending(g.engine, "mayPay", { pay: true });
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  const pc = pending(g.engine) as unknown as { kind: string; playerId: string };
  assert.equal(pc?.kind, "mayPay", "the opponent's item asks at the start of THEIR turn");
  assert.equal(pc.playerId, P2, "the item's controller is asked");
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(zoneOf(g.engine, g.id("t1")), "discard", "their item is destroyed when they don't pay");
  assert.equal(zoneOf(g.engine, g.id("m1")), "play", "my paid item is not touched on their turn");
};

const ysUpkeepBroke = (pid: string) => () => {
  const g = ysUpkeepBoard(pid, { greed: 0 });
  endTurn(g.engine, P2);
  drain(g.engine, mayPayAnswer(false));
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("m1")), "discard", "with nothing to pay, you don't, so it is destroyed");
};

const ysUpkeepEveryItem = (pid: string) => () => {
  const paying = ysUpkeepBoard(pid, { greed: 3, extra: [plainItem("m2", P1), plainItem("m3", P1)] });
  endTurn(paying.engine, P2);
  drain(paying.engine, mayPayAnswer(true));
  assert.equal(pending(paying.engine), undefined);
  for (const key of ["m1", "m2", "m3"]) assert.equal(zoneOf(paying.engine, paying.id(key)), "play", `${key} stays when paid`);
  assert.equal(ready(paying.engine, P1), 0, "three items, three Greed");
  const declining = ysUpkeepBoard(pid, { greed: 3, extra: [plainItem("m2", P1), plainItem("m3", P1)] });
  endTurn(declining.engine, P2);
  drain(declining.engine, mayPayAnswer(false));
  for (const key of ["m1", "m2", "m3"]) assert.equal(zoneOf(declining.engine, declining.id(key)), "discard", `${key} destroyed when not paid`);
  assert.equal(ready(declining.engine, P1), 3);
};

const ysUpkeepTheirYs = (pid: string) => () => {
  const g = ysUpkeepBoard(pid, { ysController: P2 });
  endTurn(g.engine, P2);
  assert.equal(pending(g.engine)?.kind, "mayPay", "All items, whoever controls Yenassa: my item still has the rule");
  assert.equal(pending(g.engine)?.playerId, P1);
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(zoneOf(g.engine, g.id("m1")), "discard");
};

const ysUpkeepStolen = (pid: string) => () => {
  const g = ysUpkeepBoard(pid, { extra: [plainItem("loan", P2, P1)] });
  endTurn(g.engine, P2);
  const seen: string[] = [];
  drain(g.engine, (pc) => {
    if (pc.kind === "mayPay") seen.push(pc.playerId);
    return mayPayAnswer(false)(pc);
  });
  assert.deepEqual(seen, [P1, P1], "both items P1 controls ask P1, including the one P2 owns");
  assert.equal(zoneOf(g.engine, g.id("loan")), "discard");
};

const ysUpkeepLate = (pid: string) => () => {
  const g = ysBoard(pid, {
    greed: 2,
    p2greed: 2,
    extra: [{ key: "late", def: item({ name: "Late Item", cost: 0 }), owner: P1, zone: "hand" }]
  });
  play(g.engine, P1, g.id("late"));
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("late")), "play");
  endTurn(g.engine, P1);
  assert.equal(pending(g.engine), undefined, "it is not an item controller's turn start for P2");
  endTurn(g.engine, P2);
  assert.equal(pending(g.engine)?.kind, "mayPay", "an item that entered after Yenassa also has the rule");
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(zoneOf(g.engine, g.id("late")), "discard");
};

const ysUpkeepGone = (pid: string) => () => {
  const control = ysUpkeepBoard(pid, { ys: "none" });
  endTurn(control.engine, P2);
  assert.equal(pending(control.engine), undefined, "control: with no Yenassa, items have no such rule");
  assert.equal(zoneOf(control.engine, control.id("m1")), "play");
  const g = ysUpkeepBoard(pid, { extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  play(g.engine, P2, g.id("kill"), { selected: { t: [g.id("ys")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("ys")), "discard");
  endTurn(g.engine, P2);
  assert.equal(pending(g.engine), undefined, "Yenassa is gone, so the rule is gone");
  assert.equal(zoneOf(g.engine, g.id("m1")), "play");
};

clause(YENASSA_A, "2:rule", "an item asks its controller 'pay 1?' at the start of that controller's turn; paying spends exactly 1 and keeps it (other cards are not asked)", ysUpkeepPay(YENASSA_A));
clause(YENASSA_B, "2:rule", "an item asks its controller 'pay 1?' at the start of that controller's turn; paying spends exactly 1 and keeps it (other cards are not asked)", ysUpkeepPay(YENASSA_B));
clause(YENASSA_A, "2:rule", "not paying destroys the item and nothing else, and spends nothing", ysUpkeepDecline(YENASSA_A));
clause(YENASSA_B, "2:rule", "not paying destroys the item and nothing else, and spends nothing", ysUpkeepDecline(YENASSA_B));
clause(YENASSA_A, "2:rule", "'your turn' is the item controller's: the opponent's item asks the opponent at the start of their turn", ysUpkeepOpp(YENASSA_A));
clause(YENASSA_B, "2:rule", "'your turn' is the item controller's: the opponent's item asks the opponent at the start of their turn", ysUpkeepOpp(YENASSA_B));
clause(YENASSA_A, "2:rule", "unable to pay (no resources) means you don't: the item is destroyed", ysUpkeepBroke(YENASSA_A));
clause(YENASSA_B, "2:rule", "unable to pay (no resources) means you don't: the item is destroyed", ysUpkeepBroke(YENASSA_B));
clause(YENASSA_A, "2:rule", "every item has the rule independently: three items, three payments or three destructions", ysUpkeepEveryItem(YENASSA_A));
clause(YENASSA_B, "2:rule", "every item has the rule independently: three items, three payments or three destructions", ysUpkeepEveryItem(YENASSA_B));
clause(YENASSA_A, "2:rule", "it does not matter who controls Yenassa: an item on the other side has the rule too", ysUpkeepTheirYs(YENASSA_A));
clause(YENASSA_B, "2:rule", "it does not matter who controls Yenassa: an item on the other side has the rule too", ysUpkeepTheirYs(YENASSA_B));
clause(YENASSA_A, "2:rule", "the controller, not the owner, is asked about an item", ysUpkeepStolen(YENASSA_A));
clause(YENASSA_B, "2:rule", "the controller, not the owner, is asked about an item", ysUpkeepStolen(YENASSA_B));
clause(YENASSA_A, "2:rule", "an item that enters play after Yenassa also gains the rule", ysUpkeepLate(YENASSA_A));
clause(YENASSA_B, "2:rule", "an item that enters play after Yenassa also gains the rule", ysUpkeepLate(YENASSA_B));
clause(YENASSA_A, "2:rule", "the rule exists only while Yenassa is in play: without it, or once it is destroyed, items are not asked", ysUpkeepGone(YENASSA_A));
clause(YENASSA_B, "2:rule", "the rule exists only while Yenassa is in play: without it, or once it is destroyed, items are not asked", ysUpkeepGone(YENASSA_B));

// -- FLIP UP: 1 [G][G][G] -------------------------------------------------------

const ysFlip = (g: YsGame, player: PlayerId = P1): void => rawFlipUp(g.engine, player, g.id("ys"));

const ysFlipWorks = (pid: string) => () => {
  const g = ysBoard(pid, { ys: "faceDown", greed: 3, rage: 2, extra: [plainItem("t0", P2)] });
  assert.equal(ready(g.engine, P1), 6, "setup: the face-down card, three Greed and two Rage");
  ysFlip(g);
  resolvePendingResponses(g.engine);
  assert.equal(pending(g.engine), undefined);
  assert.equal(g.engine.state.cards[g.id("ys")].faceDown, false, "turned face-up");
  assert.equal(zoneOf(g.engine, g.id("ys")), "play");
  assert.deepEqual(g.engine.getCardTypes(g.id("ys")), ["character"]);
  assert.equal(g.engine.getStat(g.id("ys"), "strength"), 3, "1 + 2 for the opposing item");
  assert.equal(ready(g.engine, P1), 4, "6 resources: the card leaves the pool and exactly 1 of the other 5 is spent for the cost of 1");
};

const ysFlipThreshold = (pid: string) => () => {
  const two = ysBoard(pid, { ys: "faceDown", greed: 2, rage: 2 });
  refused(() => ysFlip(two), "only [G][G] among the other resources");
  assert.equal(two.engine.state.cards[two.id("ys")].faceDown, true);
  assert.equal(ready(two.engine, P1), 5, "nothing paid");
  const none = ysBoard(pid, { ys: "faceDown", greed: 0, rage: 5 });
  refused(() => ysFlip(none), "no [G]");
  assert.equal(none.engine.state.cards[none.id("ys")].faceDown, true);
  const ok = ysBoard(pid, { ys: "faceDown", greed: 3 });
  ysFlip(ok);
  resolvePendingResponses(ok.engine);
  assert.equal(ok.engine.state.cards[ok.id("ys")].faceDown, false, "control: [G][G][G] among the others");
};

const ysFlipOwnIconNoCount = (pid: string) => () => {
  const g = ysBoard(pid, { ys: "faceDown", greed: 2 });
  assert.equal(ready(g.engine, P1), 3, "the face-down card makes it three resources");
  refused(() => ysFlip(g), "its own icon does not count towards [G][G][G]");
  assert.equal(g.engine.state.cards[g.id("ys")].faceDown, true);
};

const ysFlipWhen = (pid: string) => () => {
  const off = ysBoard(pid, { ys: "faceDown", greed: 3, active: P2, extra: [{ key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }] });
  refused(() => ysFlip(off), "not my turn and no window");
  assert.equal(off.engine.state.cards[off.id("ys")].faceDown, true);
  assert.equal(ready(off.engine, P1), 4, "nothing was paid");
  const mine = ysBoard(pid, { ys: "faceDown", greed: 3 });
  ysFlip(mine);
  resolvePendingResponses(mine.engine);
  assert.equal(mine.engine.state.cards[mine.id("ys")].faceDown, false, "control: on my own turn it works");
};

const ysFlipWindow = (pid: string) => () => {
  const off = ysBoard(pid, { ys: "faceDown", greed: 3, active: P2, extra: [{ key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(off.engine, P2, [off.id("foe")]);
  refused(() => ysFlip(off), "a non-tactic cannot be flipped up in the opponent's response window");
  assert.equal(off.engine.state.cards[off.id("ys")].faceDown, true);
  assert.equal(ready(off.engine, P1), 4, "nothing was paid");
};

const ysFlipWho = (pid: string) => () => {
  const theirs = ysBoard(pid, { ys: "faceDown", greed: 3, p2greed: 3 });
  refused(() => ysFlip(theirs, P2), "the opponent cannot flip my card");
  assert.equal(theirs.engine.state.cards[theirs.id("ys")].faceDown, true);
  const inHand = ysBoard(pid, { ys: "hand", greed: 3 });
  refused(() => ysFlip(inHand), "in hand it is not face-down in play");
  assert.equal(zoneOf(inHand.engine, inHand.id("ys")), "hand");
};

clause(YENASSA_A, "3:flipUp", "a face-down Yenassa flips up for 1 with [G][G][G] among the others and becomes a face-up character", ysFlipWorks(YENASSA_A));
clause(YENASSA_B, "3:flipUp", "a face-down Yenassa flips up for 1 with [G][G][G] among the others and becomes a face-up character", ysFlipWorks(YENASSA_B));
clause(YENASSA_A, "3:flipUp", "refused without [G][G][G]: two Greed and no Greed are refused, nothing paid", ysFlipThreshold(YENASSA_A));
clause(YENASSA_B, "3:flipUp", "refused without [G][G][G]: two Greed and no Greed are refused, nothing paid", ysFlipThreshold(YENASSA_B));
clause(YENASSA_A, "3:flipUp", "its own icon does not count towards the threshold (CR 507.4b): itself plus two Greed is refused", ysFlipOwnIconNoCount(YENASSA_A));
clause(YENASSA_B, "3:flipUp", "its own icon does not count towards the threshold (CR 507.4b): itself plus two Greed is refused", ysFlipOwnIconNoCount(YENASSA_B));
clause(YENASSA_A, "3:flipUp", "a non-tactic cannot be flipped on the opponent's turn outside a window, but can on my own turn", ysFlipWhen(YENASSA_A));
clause(YENASSA_B, "3:flipUp", "a non-tactic cannot be flipped on the opponent's turn outside a window, but can on my own turn", ysFlipWhen(YENASSA_B));
clause(YENASSA_A, "3:flipUp", "a non-tactic cannot be flipped up inside the opponent's response window", ysFlipWindow(YENASSA_A));
clause(YENASSA_B, "3:flipUp", "a non-tactic cannot be flipped up inside the opponent's response window", ysFlipWindow(YENASSA_B));
clause(YENASSA_A, "3:flipUp", "only its controller can flip it, and only while it is face-down in play", ysFlipWho(YENASSA_A));
clause(YENASSA_B, "3:flipUp", "only its controller can flip it, and only while it is face-down in play", ysFlipWho(YENASSA_B));

// ============================================================================
// Acrolosian Outpost #30016968A -- location gearsmith cost 1 "e" structure 2
// ============================================================================

interface OutpostOpts {
  outpost?: "play" | "hand";
  elitism?: number;
  rage?: number;
  deckElitism?: number;
  random?: () => number;
  extra?: CardPlacement[];
}

const elitismCard = (): CardDefinition => resourceCard({ name: "Elitism", resource: { provides: ["elitism"], staple: true } });

function outpostBoard(o: OutpostOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    ...(o.random ? { random: o.random } : {}),
    cards: [
      { key: "out", def: printing(OUTPOST), owner: P1, zone: o.outpost ?? "play" },
      ...Array.from({ length: o.deckElitism ?? 1 }, (_, i) => ({ key: `eli${i}`, def: elitismCard(), owner: P1, zone: "deck" as const })),
      { key: "rageCard", def: resourceCard({ name: "Rage", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "deck" },
      { key: "near", def: character({ name: "Elitism Overlord" }), owner: P1, zone: "deck" },
      ...fillers("d", 3, P1, "deck"),
      { key: "oppEli", def: elitismCard(), owner: P2, zone: "deck" },
      { key: "handEli", def: elitismCard(), owner: P1, zone: "hand" },
      { key: "discEli", def: elitismCard(), owner: P1, zone: "discard" },
      ...bank("elitism", o.elitism ?? 2, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.extra ?? [])
    ]
  });
}
type OutpostGame = ReturnType<typeof outpostBoard>;

/** Activates SNUB and answers the search with `pick` (card keys) or declines. */
const snub = (g: OutpostGame, pick: string[] | undefined): void => {
  activate(g.engine, P1, g.id("out"), "snub");
  drain(g.engine, (pc) =>
    pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: (pick ?? []).map((k) => g.id(k)) } : declineAll(pc)
  );
};

clause(OUTPOST, "0:ability:snub", "deploys for exactly its printed cost 1 with [E]: one Elitism is spent, it enters as a gearsmith location with structure 2; refused with no resources or no [E]", () => {
  const g = outpostBoard({ outpost: "hand", elitism: 3 });
  assert.equal(g.engine.getCardPlayability(P1, g.id("out")).numericCost, 1);
  play(g.engine, P1, g.id("out"));
  assert.equal(zoneOf(g.engine, g.id("out")), "play");
  assert.equal(ready(g.engine, P1), 2, "exactly 1 of 3 spent");
  assert.deepEqual(g.engine.getCardTypes(g.id("out")), ["location"]);
  assert.equal(g.engine.getStat(g.id("out"), "structure"), 2);
  assert.equal(printing(OUTPOST).trade, "gearsmith");
  assert.equal(printing(OUTPOST).cost, 1);
  assert.equal(printing(OUTPOST).threshold, "e");
  const none = outpostBoard({ outpost: "hand", elitism: 0 });
  refused(() => play(none.engine, P1, none.id("out")), "no resources");
  assert.equal(zoneOf(none.engine, none.id("out")), "hand");
  const wrongIcon = outpostBoard({ outpost: "hand", elitism: 0, rage: 3 });
  refused(() => play(wrongIcon.engine, P1, wrongIcon.id("out")), "no [E]");
  assert.equal(ready(wrongIcon.engine, P1), 3);
});

clause(OUTPOST, "0:ability:snub", "COST: pay exactly 2 and deplete the Outpost; both happen on use", () => {
  const g = outpostBoard({ elitism: 4 });
  assert.equal(isDepleted(g.engine, g.id("out")), false);
  snub(g, ["eli0"]);
  assert.equal(ready(g.engine, P1), 2, "exactly 2 of 4 spent");
  assert.equal(isDepleted(g.engine, g.id("out")), true, "the Outpost is depleted");
});

clause(OUTPOST, "0:ability:snub", "is refused with 1 resource and when the Outpost is already depleted; exactly 2 resources is enough", () => {
  const one = outpostBoard({ elitism: 1 });
  refused(() => snub(one, ["eli0"]), "1 resource for pay 2");
  assert.equal(ready(one.engine, P1), 1, "nothing paid");
  assert.equal(isDepleted(one.engine, one.id("out")), false);
  assert.equal(zoneOf(one.engine, one.id("eli0")), "deck");
  const dep = outpostBoard({ elitism: 4 });
  dep.engine.state.cards[dep.id("out")].depleted = true;
  refused(() => snub(dep, ["eli0"]), "already depleted");
  assert.equal(ready(dep.engine, P1), 4, "nothing paid");
  const exact = outpostBoard({ elitism: 2 });
  snub(exact, ["eli0"]);
  assert.equal(zoneOf(exact.engine, exact.id("eli0")), "hand", "control: exactly 2 works");
  assert.equal(ready(exact.engine, P1), 0);
});

clause(OUTPOST, "0:ability:snub", "can be used once per untapping: a second use the same turn is refused because the Outpost is depleted", () => {
  const g = outpostBoard({ elitism: 4, deckElitism: 2 });
  snub(g, ["eli0"]);
  refused(() => snub(g, ["eli1"]), "depleted by the first use");
  assert.equal(zoneOf(g.engine, g.id("eli1")), "deck");
  assert.equal(ready(g.engine, P1), 2);
});

clause(OUTPOST, "0:ability:snub", "searches the deck for a card named Elitism: the Elitism goes to hand, from the deck, and nothing else moves", () => {
  const g = outpostBoard({ elitism: 2 });
  const deckBefore = [...deckOf(g.engine, P1)];
  const handBefore = [...handOf(g.engine, P1)];
  snub(g, ["eli0"]);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("eli0")), "hand");
  assert.deepEqual([...deckOf(g.engine, P1)].sort(), deckBefore.filter((c) => c !== g.id("eli0")).sort(), "only the Elitism left the deck");
  assert.deepEqual([...handOf(g.engine, P1)].sort(), [...handBefore, g.id("eli0")].sort(), "the hand only gained it");
});

clause(OUTPOST, "0:ability:snub", "only a card NAMED Elitism can be found: other resources, a similarly named card, a copy in hand, discard or the opponent's deck are refused", () => {
  const g = outpostBoard({ elitism: 2 });
  activate(g.engine, P1, g.id("out"), "snub");
  const tryPick = (key: string, why: string) =>
    refused(
      () => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [g.id(key)] } } as never),
      why,
      /select|target|legal|candidate|illegal|pick|choice/i
    );
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget", "the search prompt is open");
  tryPick("rageCard", "a resource not named Elitism");
  tryPick("near", "a card named 'Elitism Overlord'");
  tryPick("handEli", "an Elitism in hand");
  tryPick("discEli", "an Elitism in the discard pile");
  tryPick("oppEli", "an Elitism in the opponent's deck");
  tryPick("d0", "an arbitrary card");
  drain(g.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [g.id("eli0")] } : declineAll(pc)));
  assert.equal(zoneOf(g.engine, g.id("eli0")), "hand", "control: the real Elitism is accepted");
  assert.equal(zoneOf(g.engine, g.id("oppEli")), "deck");
});

clause(OUTPOST, "0:ability:snub", "finds exactly ONE card even when the deck holds several Elitism: the chosen one moves and the others stay", () => {
  const g = outpostBoard({ elitism: 2, deckElitism: 3 });
  snub(g, ["eli1"]);
  assert.equal(zoneOf(g.engine, g.id("eli1")), "hand", "the chosen copy");
  assert.equal(zoneOf(g.engine, g.id("eli0")), "deck");
  assert.equal(zoneOf(g.engine, g.id("eli2")), "deck");
  const two = outpostBoard({ elitism: 2, deckElitism: 3 });
  activate(two.engine, P1, two.id("out"), "snub");
  refused(
    () => two.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [two.id("eli0"), two.id("eli1")] } } as never),
    "two cards for 'a card'",
    /select|target|legal|count|too many|pick|choice/i
  );
});

clause(OUTPOST, "0:ability:snub", "the found card is revealed to everyone", () => {
  const g = outpostBoard({ elitism: 2 });
  snub(g, ["eli0"]);
  const reveals = g.engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
  assert.equal(reveals.length, 1, "one reveal");
  const ev = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual(ev.cardIds, [g.id("eli0")], "exactly the found card");
  assert.equal(ev.viewerId, "all", "revealed to everyone");
});

clause(OUTPOST, "0:ability:snub", "the controller's own deck is searched, never the opponent's: with Elitism only in the opponent's deck nothing can be found", () => {
  const g = outpostBoard({ elitism: 2, deckElitism: 0 });
  const oppDeck = [...deckOf(g.engine, P2)];
  snub(g, ["oppEli"]);
  assert.equal(zoneOf(g.engine, g.id("oppEli")), "deck", "the opponent's Elitism stays");
  assert.deepEqual(deckOf(g.engine, P2), oppDeck);
  assert.equal(zoneOf(g.engine, g.id("handEli")), "hand");
});

clause(OUTPOST, "0:ability:snub", "with no Elitism in the deck the search finds nothing: costs are still paid, the hand is unchanged", () => {
  const g = outpostBoard({ elitism: 2, deckElitism: 0 });
  const hand = [...handOf(g.engine, P1)];
  snub(g, undefined);
  assert.equal(pending(g.engine), undefined);
  assert.deepEqual([...handOf(g.engine, P1)], hand, "nothing added");
  assert.equal(isDepleted(g.engine, g.id("out")), true, "still depleted");
  assert.equal(ready(g.engine, P1), 0, "still paid 2");
});

clause(OUTPOST, "0:ability:snub", "a search for a named card may be failed on purpose (CR 312.2): declining leaves the Elitism in the deck", () => {
  const g = outpostBoard({ elitism: 2, deckElitism: 1 });
  snub(g, undefined);
  assert.equal(zoneOf(g.engine, g.id("eli0")), "deck", "declined, so it stays");
  assert.equal(pending(g.engine), undefined);
  assert.equal(ready(g.engine, P1), 0);
});

clause(OUTPOST, "0:ability:snub", "the deck is shuffled after a successful search (CR 312.1)", () => {
  const g = outpostBoard({ elitism: 2, random: () => 0 });
  const before = [...deckOf(g.engine, P1)];
  snub(g, ["eli0"]);
  const unshuffled = before.filter((c) => c !== g.id("eli0"));
  assert.deepEqual([...deckOf(g.engine, P1)].sort(), [...unshuffled].sort(), "the same cards remain");
  assert.deepEqual(deckOf(g.engine, P1), shuffledWithConstant(unshuffled, 0), "and they were shuffled");
});

clause(OUTPOST, "0:ability:snub", "the deck is shuffled after a FAILED search too (CR 312.1: a searched deck is shuffled afterwards)", () => {
  const none = outpostBoard({ elitism: 2, deckElitism: 0, random: () => 0 });
  const before = [...deckOf(none.engine, P1)];
  snub(none, undefined);
  assert.deepEqual([...deckOf(none.engine, P1)].sort(), [...before].sort(), "same cards");
  assert.deepEqual(deckOf(none.engine, P1), shuffledWithConstant(before, 0), "no Elitism in the deck: still shuffled");
  const declined = outpostBoard({ elitism: 2, deckElitism: 1, random: () => 0 });
  const before2 = [...deckOf(declined.engine, P1)];
  snub(declined, undefined);
  assert.deepEqual(deckOf(declined.engine, P1), shuffledWithConstant(before2, 0), "declined with Elitism present: still shuffled");
});

clause(OUTPOST, "0:ability:snub", "only the controller can use it", () => {
  const g = outpostBoard({ elitism: 2, extra: bank("elitism", 3, P2) });
  refused(() => activate(g.engine, P2, g.id("out"), "snub"), "the opponent cannot use my Outpost", /control|priority|ability|not/i);
  assert.equal(isDepleted(g.engine, g.id("out")), false);
  snub(g, ["eli0"]);
  assert.equal(zoneOf(g.engine, g.id("eli0")), "hand", "control: the controller can");
});

// ============================================================================
// Animated Scrap Heap -- character gearsmith golem, majig cost 0 "eeee" 1/3/1
// ============================================================================

interface AshOpts {
  ash?: "hand" | "play";
  elitism?: number;
  rage?: number;
  tokens?: number;
  extra?: CardPlacement[];
  active?: PlayerId;
}

function ashBoard(o: AshOpts = {}) {
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [
      { key: "ash", def: printing(SCRAP), owner: P1, zone: o.ash ?? "hand", ...(o.tokens ? { counters: { token: o.tokens } } : {}) },
      ...bank("elitism", o.elitism ?? 4, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.extra ?? [])
    ]
  });
}
type AshGame = ReturnType<typeof ashBoard>;

const castAsh = (g: AshGame, x: number): void => {
  play(g.engine, P1, g.id("ash"), { variables: { x } });
  drain(g.engine, declineAll);
};

clause(SCRAP, "0:extraCost", "costs 0 plus X: with X = 0 only the threshold is needed and nothing is spent; it is a gearsmith golem majig character, printed 1/3/1", () => {
  const g = ashBoard({ elitism: 4 });
  assert.equal(g.engine.getCardPlayability(P1, g.id("ash")).numericCost, 0);
  castAsh(g, 0);
  assert.equal(zoneOf(g.engine, g.id("ash")), "play");
  assert.equal(ready(g.engine, P1), 4, "X = 0 pays nothing");
  assert.deepEqual(g.engine.getCardTypes(g.id("ash")), ["character"]);
  assert.equal(g.engine.getStat(g.id("ash"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("ash"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("ash"), "life"), 1);
  assert.equal(printing(SCRAP).trade, "gearsmith");
  assert.deepEqual([...(printing(SCRAP).subtype ?? [])].sort(), ["golem", "majig"]);
  assert.equal(printing(SCRAP).cost, 0);
  assert.equal(printing(SCRAP).threshold, "eeee");
});

clause(SCRAP, "0:extraCost", "needs [E][E][E][E]: three Elitism plus Rage is refused even for X = 0, four Elitism is enough", () => {
  const three = ashBoard({ elitism: 3, rage: 5 });
  refused(() => castAsh(three, 0), "only [E][E][E]");
  assert.equal(zoneOf(three.engine, three.id("ash")), "hand");
  assert.equal(ready(three.engine, P1), 8, "nothing paid");
  const none = ashBoard({ elitism: 0, rage: 6 });
  refused(() => castAsh(none, 0), "no [E]");
  const four = ashBoard({ elitism: 4 });
  castAsh(four, 0);
  assert.equal(zoneOf(four.engine, four.id("ash")), "play", "control: [E][E][E][E]");
});

clause(SCRAP, "0:extraCost", "pays exactly X: X = 1, 2 and 3 with 4 Elitism and 4 Rage leave 7, 6 and 5 ready", () => {
  for (const x of [1, 2, 3]) {
    const g = ashBoard({ elitism: 4, rage: 4 });
    castAsh(g, x);
    assert.equal(zoneOf(g.engine, g.id("ash")), "play", `X=${x}`);
    assert.equal(ready(g.engine, P1), 8 - x, `X=${x}: exactly ${x} spent`);
  }
});

clause(SCRAP, "0:extraCost", "X can use up everything but is capped by what you have: X = 4 with four resources works, X = 5 is refused with nothing paid", () => {
  const over = ashBoard({ elitism: 4 });
  refused(() => castAsh(over, 5), "X = 5 with four resources");
  assert.equal(zoneOf(over.engine, over.id("ash")), "hand");
  assert.equal(ready(over.engine, P1), 4, "nothing paid");
  const all = ashBoard({ elitism: 4 });
  castAsh(all, 4);
  assert.equal(zoneOf(all.engine, all.id("ash")), "play");
  assert.equal(ready(all.engine, P1), 0);
  assert.equal(tokensOn(all.engine, all.id("ash")), 4);
});

clause(SCRAP, "0:extraCost", "X must be a whole number of at least 0: -1 is refused", () => {
  const g = ashBoard({ elitism: 4, rage: 2 });
  refused(() => castAsh(g, -1), "negative X");
  assert.equal(zoneOf(g.engine, g.id("ash")), "hand");
  assert.equal(ready(g.engine, P1), 6);
});

clause(SCRAP, "0:extraCost", "X must be a whole number (CR 410.2): 1.5 is refused", () => {
  const g = ashBoard({ elitism: 4, rage: 2 });
  refused(() => castAsh(g, 1.5), "fractional X");
  assert.equal(zoneOf(g.engine, g.id("ash")), "hand");
  assert.equal(ready(g.engine, P1), 6);
});

clause(SCRAP, "0:extraCost", "X is part of the cost: the X resources are already paid while the card waits for responses", () => {
  const g = ashBoard({ elitism: 4, rage: 3 });
  playRaw(g.engine, P1, g.id("ash"), { variables: { x: 2 } });
  assert.equal(ready(g.engine, P1), 5, "X = 2 already paid at play time");
});

clause(SCRAP, "1:rule", "it enters play with X tokens on it: X = 0, 1, 3 give 0, 1, 3 tokens", () => {
  for (const x of [0, 1, 3]) {
    const g = ashBoard({ elitism: 4, rage: 3 });
    castAsh(g, x);
    assert.equal(tokensOn(g.engine, g.id("ash")), x, `X=${x}`);
  }
});

clause(SCRAP, "1:rule", "the tokens come from X alone: a second Heap cast with another X has its own count", () => {
  const g = ashBoard({ elitism: 4, rage: 4, extra: [{ key: "ash2", def: printing(SCRAP), owner: P1, zone: "hand" }] });
  castAsh(g, 2);
  play(g.engine, P1, g.id("ash2"), { variables: { x: 1 } });
  drain(g.engine, declineAll);
  assert.equal(tokensOn(g.engine, g.id("ash")), 2);
  assert.equal(tokensOn(g.engine, g.id("ash2")), 1);
});

clause(SCRAP, "1:rule", "tokens are not kept when it leaves play: bounced and cast again with X = 0 it has no tokens and printed stats", () => {
  const g = ashBoard({
    elitism: 4,
    rage: 4,
    extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }]
  });
  castAsh(g, 3);
  assert.equal(tokensOn(g.engine, g.id("ash")), 3);
  play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("ash")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("ash")), "hand");
  castAsh(g, 0);
  assert.equal(zoneOf(g.engine, g.id("ash")), "play");
  assert.equal(tokensOn(g.engine, g.id("ash")), 0, "no tokens carried over");
  assert.equal(g.engine.getStat(g.id("ash"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("ash"), "life"), 1);
});

clause(SCRAP, "2:rule", "gains +1 strength and +1 life per token: 0, 1, 2, 5 tokens give 1/1, 2/2, 3/3, 6/6 (speed stays 3)", () => {
  for (const n of [0, 1, 2, 5]) {
    const g = ashBoard({ ash: "play", tokens: n });
    assert.equal(g.engine.getStat(g.id("ash"), "strength"), 1 + n, `${n} tokens: strength`);
    assert.equal(g.engine.getStat(g.id("ash"), "life"), 1 + n, `${n} tokens: life`);
    assert.equal(g.engine.getStat(g.id("ash"), "speed"), 3, `${n} tokens: speed untouched`);
  }
});

clause(SCRAP, "2:rule", "only tokens ON IT count: another character's tokens do not change it, and its tokens do not change another character", () => {
  const g = ashBoard({
    ash: "play",
    tokens: 2,
    extra: [
      { key: "other", def: character({ name: "Other", strength: 2, life: 2, speed: 2 }), owner: P2, zone: "play", counters: { token: 4 } },
      { key: "ash2", def: printing(SCRAP), owner: P1, zone: "play" }
    ]
  });
  assert.equal(g.engine.getStat(g.id("ash"), "strength"), 3);
  assert.equal(g.engine.getStat(g.id("ash2"), "strength"), 1, "a second Heap with no tokens stays 1/1");
  assert.equal(g.engine.getStat(g.id("ash2"), "life"), 1);
  assert.equal(g.engine.getStat(g.id("other"), "strength"), 2, "its tokens do not boost others");
  assert.equal(g.engine.getStat(g.id("other"), "life"), 2);
});

clause(SCRAP, "2:rule", "the bonus applies to the life that decides damage: 2 tokens give life 3, so 2 damage survives and 3 destroys it", () => {
  const survive = ashBoard({ ash: "play", tokens: 2 });
  survive.engine.state.cards[survive.id("ash")].damage = 2;
  assert.equal(survive.engine.getStat(survive.id("ash"), "life"), 3);
  assert.equal(zoneOf(survive.engine, survive.id("ash")), "play", "2 damage on life 3");
  const dies = ashBoard({ ash: "play", tokens: 2, extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(dies.engine, P1, dies.id("kill"), { selected: { t: [dies.id("ash")] } });
  drain(dies.engine, declineAll);
  assert.equal(zoneOf(dies.engine, dies.id("ash")), "discard", "control: destroyable");
});

clause(SCRAP, "3:ability:expand", "COST: pay exactly 3; EFFECT: one token goes on it (+1/+1)", () => {
  const g = ashBoard({ ash: "play", elitism: 5 });
  activate(g.engine, P1, g.id("ash"), "expand");
  assert.equal(pending(g.engine), undefined);
  assert.equal(ready(g.engine, P1), 2, "exactly 3 of 5 spent");
  assert.equal(tokensOn(g.engine, g.id("ash")), 1);
  assert.equal(g.engine.getStat(g.id("ash"), "strength"), 2);
  assert.equal(g.engine.getStat(g.id("ash"), "life"), 2);
  assert.equal(g.engine.getStat(g.id("ash"), "speed"), 3);
});

clause(SCRAP, "3:ability:expand", "adds to tokens already there and can be repeated: 2 tokens + 2 uses = 4 tokens, 6 resources spent", () => {
  const g = ashBoard({ ash: "play", elitism: 6, tokens: 2 });
  activate(g.engine, P1, g.id("ash"), "expand");
  activate(g.engine, P1, g.id("ash"), "expand");
  assert.equal(tokensOn(g.engine, g.id("ash")), 4);
  assert.equal(ready(g.engine, P1), 0);
  assert.equal(g.engine.getStat(g.id("ash"), "strength"), 5);
  assert.equal(g.engine.getStat(g.id("ash"), "life"), 5);
  assert.equal(isDepleted(g.engine, g.id("ash")), false, "its cost has no deplete");
});

clause(SCRAP, "3:ability:expand", "is refused with only 2 resources and pays nothing; exactly 3 works", () => {
  const short = ashBoard({ ash: "play", elitism: 2 });
  refused(() => activate(short.engine, P1, short.id("ash"), "expand"), "2 resources for pay 3");
  assert.equal(ready(short.engine, P1), 2, "nothing paid");
  assert.equal(tokensOn(short.engine, short.id("ash")), 0);
  const exact = ashBoard({ ash: "play", elitism: 3 });
  activate(exact.engine, P1, exact.id("ash"), "expand");
  assert.equal(tokensOn(exact.engine, exact.id("ash")), 1, "control: exactly 3 works");
  assert.equal(ready(exact.engine, P1), 0);
});

clause(SCRAP, "3:ability:expand", "any resources pay (no threshold): three Rage are enough", () => {
  const g = ashBoard({ ash: "play", elitism: 0, rage: 3 });
  activate(g.engine, P1, g.id("ash"), "expand");
  assert.equal(tokensOn(g.engine, g.id("ash")), 1);
  assert.equal(ready(g.engine, P1), 0);
});

clause(SCRAP, "3:ability:expand", "puts the token on THIS card only: a second Heap is unchanged", () => {
  const g = ashBoard({ ash: "play", elitism: 3, extra: [{ key: "ash2", def: printing(SCRAP), owner: P1, zone: "play", counters: { token: 1 } }] });
  activate(g.engine, P1, g.id("ash"), "expand");
  assert.equal(tokensOn(g.engine, g.id("ash")), 1);
  assert.equal(tokensOn(g.engine, g.id("ash2")), 1, "the other Heap still has 1");
  assert.equal(g.engine.getStat(g.id("ash2"), "strength"), 2);
});

clause(SCRAP, "3:ability:expand", "only its controller can use it", () => {
  const g = ashBoard({ ash: "play", elitism: 3, extra: bank("elitism", 3, P2) });
  refused(() => activate(g.engine, P2, g.id("ash"), "expand"), "the opponent cannot expand my Heap", /control|priority|ability|not/i);
  assert.equal(tokensOn(g.engine, g.id("ash")), 0);
  activate(g.engine, P1, g.id("ash"), "expand");
  assert.equal(tokensOn(g.engine, g.id("ash")), 1, "control: the controller can");
});
