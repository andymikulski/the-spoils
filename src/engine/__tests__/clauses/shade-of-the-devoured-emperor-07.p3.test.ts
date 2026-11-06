// Clause tests — batch shade-of-the-devoured-emperor-07, part p3 (groups 14-17, missing clauses only).
// Juice Sale!, Marauding Madster, Rudo Mangod (Dragonweight Champion), Rushing Crushing Blockhead.
// Expectations come from each card's PRINTED text and RULES.md / the CR; engine data is only used to drive the engine.

import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import { buildGame, bank, character, developFaction, item, killTactic, location, play, resolvePendingResponses, tactic, P1, P2 } from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { battleOf, declareAttackBy, declareAttackOpenWindow, finishBattle, playRaw } from "./_battle.js";
import { declareBlockers, fillers, pending, readyResources, zoneOf } from "./_board.js";
import { clause, printing, refused, flipUpNow } from "./_clause.js";
import { attachedCount, endTurn, spentResources } from "./_turn.js";

type Board = ReturnType<typeof duo>;

/** Two-player board with the generic Develop/Restore-capable factions. */
function duo(cards: CardPlacement[], opts: { turn?: number; active?: PlayerId; influence?: number; random?: () => number } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), ...(opts.influence !== undefined ? { influence: opts.influence } : {}) },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    activePlayerId: opts.active ?? P1,
    ...(opts.random ? { random: opts.random } : {}),
    cards
  });
}

const chr = (name: string, over: Partial<CardDefinition> = {}): CardDefinition => character({ name, strength: 2, life: 5, speed: 2, ...over });
const ready = readyResources;
const handOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].hand];
const deckOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].deck];
const discardOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].discard];
const infl = (engine: SpoilsEngine, player: PlayerId): number => engine.state.players[player].influence;
const isDepleted = (engine: SpoilsEngine, cardId: CardInstanceId): boolean => engine.state.cards[cardId].depleted === true;
const destroyedIds = (engine: SpoilsEngine): string[] =>
  engine.getLog().filter((entry) => entry.event?.type === "cardDestroyed").map((entry) => (entry.event as unknown as { cardId: string }).cardId);
const flipUpAs = (engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}): void =>
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });

/** Mulberry32: a deterministic RNG, so shuffles are reproducible. */
const seeded = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const sel = (id: string) => ({ type: "selected" as const, id });
/** A free tactic that picks one card matching `selector` (target id "t") and applies `effects`. */
const pickTactic = (name: string, selector: Record<string, unknown>, effects: unknown[]): CardDefinition =>
  tactic({
    name,
    cost: 0,
    behavior: { abilities: [{ id: `${name}-a`, type: "activated", targets: [{ id: "t", selector, count: 1 }], effects }] } as unknown as CardDefinition["behavior"]
  });
const restoreTactic = () => pickTactic("Refresh", { zone: "play", type: "character", controller: "self" }, [{ type: "restore", target: sel("t") }]);
const discardFromHandTactic = () => pickTactic("Discard It", { zone: "hand", controller: "self" }, [{ type: "moveCard", target: sel("t"), to: "discard" }]);
const bounceTactic = () => pickTactic("Bounce", { zone: "play", type: "character" }, [{ type: "moveCard", target: sel("t"), to: "hand" }]);
const zapResourceTactic = () => pickTactic("Zap Resource", { zone: "play", type: "resource", controller: "self" }, [{ type: "moveCard", target: sel("t"), to: "discard" }]);
const millTactic = () =>
  tactic({
    name: "Mill One",
    cost: 0,
    behavior: { abilities: [{ id: "mill-a", type: "activated", targets: [], effects: [{ type: "mill", player: "controller", count: 1 }] }] } as unknown as CardDefinition["behavior"]
  });
/** Plays a free tactic placed under `key` on `pick`. */
const zap = (b: Board, key: string, pick: string): void => play(b.engine, P1, b.id(key), { selected: { t: [b.id(pick)] } });

// =====================================================================================
// Juice Sale! — tactic, warlord, cost 1, [R][R]
// COST: Pick an opponent's character with the highest strength. (If there is tie, you decide which character is picked.)
// -- EFFECT: This turn, the character cannot block. -- FLIP UP: 2 [R]
// =====================================================================================

const JUICE = "a5290ff5-114a-4ed7-804f-f751a1abf086";

const foe = (key: string, strength: number, over: Partial<CardDefinition> = {}): CardPlacement => ({ key, def: chr(key, { strength, ...over }), owner: P2, zone: "play" });

function juiceBoard(o: { rage?: number; greed?: number; spent?: number; zone?: "hand" | "play"; faceDown?: boolean; turn?: number; active?: PlayerId; cards?: CardPlacement[] } = {}) {
  return duo(
    [
      { key: "js", def: printing(JUICE), owner: P1, zone: o.zone ?? "hand", ...(o.faceDown ? { faceDown: true } : {}) },
      ...bank("rage", o.rage ?? 2, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...spentResources(P1, o.spent ?? 0),
      ...(o.cards ?? [])
    ],
    { turn: o.turn, active: o.active }
  );
}
const cast = (b: Board, pick: string): void => play(b.engine, P1, b.id("js"), { selected: { ch: [b.id(pick)] } });
const flipJuice = (b: Board, pick: string): void => {
  flipUpAs(b.engine, P1, b.id("js"), { ch: [b.id(pick)] });
  resolvePendingResponses(b.engine);
};
const cannotBlock = (b: Board, key: string): boolean => b.engine.getRestrictions(b.id(key)).includes("cannotBlock");
const myAtk = (): CardPlacement => ({ key: "atk", def: chr("Atk", { strength: 1 }), owner: P1, zone: "play" });
const buffedDef = (): CardDefinition =>
  chr("Buffed", {
    strength: 2,
    behavior: { abilities: [{ id: "pump", type: "continuous", modifiers: [{ target: "source", stat: "strength", operation: "add", value: 4 }] }] } as unknown as CardDefinition["behavior"]
  });

// --- 0:ability -----------------------------------------------------------------------

clause(JUICE, "0:ability", "casting it on the opponent's strongest character pays 1, discards the tactic, and only that character cannot block", () => {
  const b = juiceBoard({ cards: [foe("hi", 5), foe("lo", 2)] });
  assert.equal(ready(b.engine, P1), 2);
  cast(b, "hi");
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("js")), "discard");
  assert.equal(ready(b.engine, P1), 1, "cost 1 paid");
  assert.equal(cannotBlock(b, "hi"), true);
  assert.equal(cannotBlock(b, "lo"), false, "only the picked character");
});

/** The printed type line of a card in a board: card type, trade and subtypes. */
const identity = (id: string, type: string, trade: string, subtype: string[]): void => {
  const b = duo([{ key: "x", def: printing(id), owner: P1, zone: "hand" }]);
  const def = b.engine.getDefinition(b.id("x"));
  assert.equal(def.type, type, "printed type");
  assert.equal(def.trade, trade, "printed trade");
  assert.deepEqual([...(def.subtype ?? [])], subtype, "printed subtypes");
};

clause(JUICE, "0:ability", "printed type line: a warlord tactic with no subtype", () => {
  identity(JUICE, "tactic", "warlord", []);
});

clause(JUICE, "0:ability", "in battle this turn the picked character cannot be declared as a blocker, while the weaker character still can", () => {
  const b = juiceBoard({ cards: [myAtk(), foe("hi", 5), foe("lo", 2)] });
  cast(b, "hi");
  declareAttackBy(b.engine, P1, [b.id("atk")]);
  assert.ok(battleOf(b.engine), "a battle is underway");
  refused(() => declareBlockers(b.engine, P2, [b.id("hi")]), "the picked character cannot block");
  refused(() => declareBlockers(b.engine, P2, [b.id("hi"), b.id("lo")]), "nor as part of a blocking group");
  declareBlockers(b.engine, P2, [b.id("lo")]); // control: the other character blocks fine
  finishBattle(b.engine);
  assert.equal(b.engine.state.cards[b.id("lo")].damage, 1, "lo blocked Atk and took its 1 strength");
  assert.equal(b.engine.state.cards[b.id("hi")].damage, 0, "hi never fought");
});

clause(JUICE, "0:ability", "control: without the tactic the same strongest character blocks normally", () => {
  const b = juiceBoard({ cards: [myAtk(), foe("hi", 5), foe("lo", 2)] });
  declareAttackBy(b.engine, P1, [b.id("atk")]);
  declareBlockers(b.engine, P2, [b.id("hi")]);
  finishBattle(b.engine);
  assert.equal(b.engine.state.cards[b.id("hi")].damage, 1, "hi blocked");
});

clause(JUICE, "0:ability", "when characters tie for the highest strength, either may be picked and only the one picked cannot block", () => {
  for (const [pick, other] of [["hiA", "hiB"], ["hiB", "hiA"]] as const) {
    const b = juiceBoard({ cards: [myAtk(), foe("hiA", 5), foe("hiB", 5), foe("lo", 2)] });
    cast(b, pick);
    assert.equal(pending(b.engine), undefined);
    assert.equal(zoneOf(b.engine, b.id("js")), "discard", `picking ${pick} works`);
    assert.equal(cannotBlock(b, pick), true);
    assert.equal(cannotBlock(b, other), false, `${other} (tied) is unaffected`);
    declareAttackBy(b.engine, P1, [b.id("atk")]);
    refused(() => declareBlockers(b.engine, P2, [b.id(pick)]), `${pick} cannot block`);
    declareBlockers(b.engine, P2, [b.id(other)]);
    finishBattle(b.engine);
  }
});

clause(JUICE, "0:ability", "a lower-strength character is not a legal pick, even the second strongest, and the refusal costs nothing", () => {
  const b = juiceBoard({ cards: [foe("hi", 5), foe("mid", 4), foe("lo", 2)] });
  refused(() => cast(b, "mid"), "second strongest is not the highest");
  refused(() => cast(b, "lo"), "weakest is not the highest");
  assert.equal(zoneOf(b.engine, b.id("js")), "hand");
  assert.equal(ready(b.engine, P1), 2, "nothing paid");
  assert.equal(cannotBlock(b, "mid"), false);
  cast(b, "hi"); // positive control
  assert.equal(zoneOf(b.engine, b.id("js")), "discard");
  assert.equal(cannotBlock(b, "hi"), true);
});

clause(JUICE, "0:ability", "only OPPONENT characters: your own strongest character is not a legal pick", () => {
  const b = juiceBoard({ cards: [{ key: "own", def: chr("Own", { strength: 9 }), owner: P1, zone: "play" }, foe("hi", 5), foe("lo", 2)] });
  refused(() => cast(b, "own"), "own character, although the strongest on the table");
  assert.equal(zoneOf(b.engine, b.id("js")), "hand");
  cast(b, "hi");
  assert.equal(cannotBlock(b, "hi"), true);
  assert.equal(cannotBlock(b, "own"), false);
});

clause(JUICE, "0:ability", "'highest' is measured among the opponent's characters in play: stronger cards in their hand or discard don't count and can't be picked; items can't be picked", () => {
  const b = juiceBoard({
    cards: [
      foe("hi", 5),
      { key: "inHand", def: chr("InHand", { strength: 9 }), owner: P2, zone: "hand" },
      { key: "inDiscard", def: chr("InDiscard", { strength: 8 }), owner: P2, zone: "discard" },
      { key: "oppItem", def: item({ name: "Opp Item", strength: 9 }), owner: P2, zone: "play" }
    ]
  });
  refused(() => cast(b, "inHand"), "a card in hand is not in play");
  refused(() => cast(b, "inDiscard"), "a card in the discard pile is not in play");
  refused(() => cast(b, "oppItem"), "an item is not a character");
  assert.equal(zoneOf(b.engine, b.id("js")), "hand");
  cast(b, "hi");
  assert.equal(cannotBlock(b, "hi"), true, "the strongest character IN PLAY is the pick");
});

clause(JUICE, "0:ability", "'highest strength' is the current strength: a printed-weaker character pumped above the printed-stronger one is the legal pick, and the printed-stronger one is not", () => {
  const b = juiceBoard({ cards: [{ key: "buffed", def: buffedDef(), owner: P2, zone: "play" }, foe("plain", 5)] });
  assert.equal(b.engine.getStat(b.id("buffed"), "strength"), 6, "2 printed + 4");
  refused(() => cast(b, "plain"), "5 is no longer the highest");
  cast(b, "buffed");
  assert.equal(cannotBlock(b, "buffed"), true);
  assert.equal(cannotBlock(b, "plain"), false);
});

clause(JUICE, "0:ability", "the pick is part of the cost: with no opposing character in play it cannot be cast", () => {
  const b = juiceBoard({ cards: [{ key: "own", def: chr("Own", { strength: 9 }), owner: P1, zone: "play" }, { key: "oppItem", def: item({ name: "Opp Item" }), owner: P2, zone: "play" }] });
  refused(() => play(b.engine, P1, b.id("js"), {}), "no pick available");
  refused(() => cast(b, "own"), "own character is no substitute");
  assert.equal(zoneOf(b.engine, b.id("js")), "hand");
  assert.equal(ready(b.engine, P1), 2, "nothing paid");
  const ok = juiceBoard({ cards: [foe("hi", 5)] }); // control: one opposing character is enough
  cast(ok, "hi");
  assert.equal(zoneOf(ok.engine, ok.id("js")), "discard");
});

clause(JUICE, "0:ability", "needs [R][R]: one [R] plus another icon (cost payable, threshold short) is refused and nothing is paid", () => {
  const b = juiceBoard({ rage: 1, greed: 1, cards: [foe("hi", 5)] });
  assert.equal(ready(b.engine, P1), 2);
  refused(() => cast(b, "hi"), "only one [R] icon", /threshold/i);
  assert.equal(zoneOf(b.engine, b.id("js")), "hand");
  assert.equal(ready(b.engine, P1), 2);
  assert.equal(cannotBlock(b, "hi"), false);
  const none = juiceBoard({ rage: 0, greed: 4, cards: [foe("hi", 5)] });
  refused(() => cast(none, "hi"), "no [R] at all", /threshold/i);
});

clause(JUICE, "0:ability", "costs 1: with the [R][R] icons present but every resource already spent it is refused", () => {
  const b = juiceBoard({ rage: 0, spent: 2, cards: [foe("hi", 5)] });
  assert.equal(ready(b.engine, P1), 0);
  refused(() => cast(b, "hi"), "nothing left to pay the 1 with");
  assert.equal(zoneOf(b.engine, b.id("js")), "hand");
  assert.equal(cannotBlock(b, "hi"), false);
  const one = juiceBoard({ rage: 2, cards: [foe("hi", 5)] }); // control: exactly the cost and threshold
  cast(one, "hi");
  assert.equal(zoneOf(one.engine, one.id("js")), "discard");
});

clause(JUICE, "0:ability", "as a tactic it can be cast in response while the opponent is attacking", () => {
  const b = juiceBoard({ active: P2, cards: [{ key: "oatk", def: chr("OppAtk", { strength: 1 }), owner: P2, zone: "play" }, foe("hi", 5)] });
  declareAttackOpenWindow(b.engine, P2, [b.id("oatk")]);
  cast(b, "hi");
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("js")), "discard");
  assert.equal(cannotBlock(b, "hi"), true);
});

clause(JUICE, "0:ability", "the 'cannot block' lasts this turn only: it is gone on the opponent's turn and stays gone", () => {
  const b = juiceBoard({ turn: 1, cards: [foe("hi", 5), foe("lo", 2)] });
  cast(b, "hi");
  assert.equal(cannotBlock(b, "hi"), true, "this turn");
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(cannotBlock(b, "hi"), false, "next turn it is over");
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(cannotBlock(b, "hi"), false, "and stays over");
});

// --- 1:flipUp: 2 [R] -----------------------------------------------------------------

clause(JUICE, "1:flipUp", "a face-down Juice Sale! flips up for 2 with a single [R] (itself plus one bank), runs the effect on the pick, and ends in the discard", () => {
  const b = juiceBoard({ zone: "play", faceDown: true, rage: 1, cards: [myAtk(), foe("hi", 5), foe("lo", 2)] });
  assert.equal(b.engine.isResource(b.id("js")), true, "face-down it is a resource");
  assert.equal(ready(b.engine, P1), 2, "one [R] bank plus the face-down card");
  flipJuice(b, "hi");
  assert.equal(pending(b.engine), undefined);
  assert.equal(ready(b.engine, P1), 0, "both resources spent: the flip-up costs 2, not the card's cost 1");
  assert.equal(zoneOf(b.engine, b.id("js")), "discard");
  assert.equal(cannotBlock(b, "hi"), true);
  assert.equal(cannotBlock(b, "lo"), false);
  declareAttackBy(b.engine, P1, [b.id("atk")]);
  refused(() => declareBlockers(b.engine, P2, [b.id("hi")]), "the flipped-up effect keeps hi out of the block");
  declareBlockers(b.engine, P2, [b.id("lo")]);
  finishBattle(b.engine);
});

clause(JUICE, "1:flipUp", "does not overpay: with plenty of resources it spends only 2", () => {
  const b = juiceBoard({ zone: "play", faceDown: true, rage: 5, cards: [foe("hi", 5)] });
  assert.equal(ready(b.engine, P1), 6);
  flipJuice(b, "hi");
  assert.equal(cannotBlock(b, "hi"), true);
  const left = ready(b.engine, P1);
  assert.ok(left === 3 || left === 4, `6 ready - 2 paid (the card may pay for itself, CR 507.4b, or leave the pool when it flips): ${left}`);
});

clause(JUICE, "1:flipUp", "is refused one resource short (the [R] icon is there but spent, so only the face-down card itself can pay) and nothing is paid", () => {
  const b = juiceBoard({ zone: "play", faceDown: true, rage: 0, spent: 1, cards: [foe("hi", 5)] });
  assert.equal(ready(b.engine, P1), 1);
  refused(() => flipJuice(b, "hi"), "cost 2 but only 1 resource available");
  assert.equal(b.engine.state.cards[b.id("js")].faceDown, true, "still face-down");
  assert.equal(zoneOf(b.engine, b.id("js")), "play");
  assert.equal(ready(b.engine, P1), 1);
  assert.equal(cannotBlock(b, "hi"), false);
});

clause(JUICE, "1:flipUp", "needs [R]: plenty of resources with no [R] among them is refused", () => {
  const b = juiceBoard({ zone: "play", faceDown: true, rage: 0, greed: 4, cards: [foe("hi", 5)] });
  assert.equal(ready(b.engine, P1), 5);
  refused(() => flipJuice(b, "hi"), "no [R] icon", /threshold/i);
  assert.equal(b.engine.state.cards[b.id("js")].faceDown, true);
  assert.equal(ready(b.engine, P1), 5, "nothing paid");
  assert.equal(cannotBlock(b, "hi"), false);
});

clause(JUICE, "1:flipUp", "the flipped-up tactic keeps its pick restriction: only the opponent's highest-strength character is legal", () => {
  const b = juiceBoard({ zone: "play", faceDown: true, rage: 2, cards: [{ key: "own", def: chr("Own", { strength: 9 }), owner: P1, zone: "play" }, foe("hi", 5), foe("lo", 2)] });
  refused(() => flipJuice(b, "lo"), "weaker than the opponent's strongest");
  refused(() => flipJuice(b, "own"), "own character");
  assert.equal(b.engine.state.cards[b.id("js")].faceDown, true);
  assert.equal(ready(b.engine, P1), 3, "nothing paid by the refusals");
  flipJuice(b, "hi"); // positive control
  assert.equal(cannotBlock(b, "hi"), true);
  assert.equal(zoneOf(b.engine, b.id("js")), "discard");
});

clause(JUICE, "1:flipUp", "being a tactic, it can be flipped up in response during the opponent's attack", () => {
  const b = juiceBoard({ zone: "play", faceDown: true, rage: 1, active: P2, cards: [{ key: "oatk", def: chr("OppAtk", { strength: 1 }), owner: P2, zone: "play" }, foe("hi", 5)] });
  declareAttackOpenWindow(b.engine, P2, [b.id("oatk")]);
  flipJuice(b, "hi");
  assert.equal(zoneOf(b.engine, b.id("js")), "discard");
  assert.equal(cannotBlock(b, "hi"), true);
});

// =====================================================================================
// Marauding Madster — character, warlord, berserker, cost 1, [R][R][R][R], str 3 / spd 3 / life 4
// COST: Pick a character you control. -- When this card enters play, destroy the picked character.
// -- If this character would be put into your discard pile from anywhere, shuffle it into your deck instead.
// =====================================================================================

const MADSTER = "739a2839-d98f-4ac4-8c2d-8717353f384c";

const mine = (key: string, over: Partial<CardDefinition> = {}, extra: Partial<CardPlacement> = {}): CardPlacement => ({ key, def: chr(key, over), owner: P1, zone: "play", ...extra });

function madBoard(o: { rage?: number; greed?: number; spent?: number; zone?: "hand" | "play" | "deck"; seed?: number; active?: PlayerId; cards?: CardPlacement[] } = {}) {
  return duo(
    [
      { key: "mm", def: printing(MADSTER), owner: P1, zone: o.zone ?? "hand" },
      ...bank("rage", o.rage ?? 4, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...spentResources(P1, o.spent ?? 0),
      ...(o.cards ?? [])
    ],
    { random: seeded(o.seed ?? 1), active: o.active }
  );
}
const castMad = (b: Board, pick: string): void => play(b.engine, P1, b.id("mm"), { selected: { sacrifice: [b.id(pick)] } });

// --- 0:ability -------------------------------------------------------------------------

clause(MADSTER, "0:ability", "casting it pays 1, takes one of my characters as the pick, and Madster enters play with its printed 3 / 3 / 4", () => {
  const b = madBoard({ cards: [mine("a")] });
  assert.equal(ready(b.engine, P1), 4);
  castMad(b, "a");
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("mm")), "play");
  assert.equal(ready(b.engine, P1), 3, "cost 1 paid");
  assert.equal(b.engine.getStat(b.id("mm"), "strength"), 3);
  assert.equal(b.engine.getStat(b.id("mm"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("mm"), "life"), 4);
});

clause(MADSTER, "0:ability", "printed type line: a warlord berserker character", () => {
  identity(MADSTER, "character", "warlord", ["berserker"]);
});

clause(MADSTER, "0:ability", "any character I control may be the pick: either of two, and the other is left alone", () => {
  for (const [pick, keep] of [["a", "b"], ["b", "a"]] as const) {
    const b = madBoard({ cards: [mine("a"), mine("b")] });
    castMad(b, pick);
    assert.equal(zoneOf(b.engine, b.id("mm")), "play");
    assert.equal(zoneOf(b.engine, b.id(pick)), "discard", `${pick} was picked and destroyed`);
    assert.equal(zoneOf(b.engine, b.id(keep)), "play", `${keep} was not picked`);
  }
});

clause(MADSTER, "0:ability", "a depleted or damaged character of mine is a legal pick too", () => {
  const b = madBoard({ cards: [mine("tired", {}, { depleted: true, damage: 2 }), mine("fresh")] });
  castMad(b, "tired");
  assert.equal(zoneOf(b.engine, b.id("tired")), "discard");
  assert.equal(zoneOf(b.engine, b.id("fresh")), "play");
});

clause(MADSTER, "0:ability", "the pick must be a character I control in play: opponent's character, my item, my faction, and my characters in hand / discard are refused (and nothing is paid)", () => {
  const b = madBoard({
    cards: [
      mine("a"),
      { key: "theirs", def: chr("Theirs"), owner: P2, zone: "play" },
      { key: "myItem", def: item({ name: "My Item" }), owner: P1, zone: "play" },
      mine("inHand", {}, { zone: "hand" }),
      mine("inDiscard", {}, { zone: "discard" })
    ]
  });
  for (const bad of ["theirs", "myItem", "inHand", "inDiscard"]) refused(() => castMad(b, bad), `${bad} is not a legal pick`);
  refused(() => play(b.engine, P1, b.id("mm"), { selected: { sacrifice: [b.engine.state.players[P1].factionId!] } }), "a faction is not a legal pick (CR 202.9)");
  assert.equal(zoneOf(b.engine, b.id("mm")), "hand");
  assert.equal(ready(b.engine, P1), 4, "nothing paid by the refusals");
  assert.equal(zoneOf(b.engine, b.id("theirs")), "play");
  castMad(b, "a"); // positive control
  assert.equal(zoneOf(b.engine, b.id("mm")), "play");
  assert.equal(zoneOf(b.engine, b.id("a")), "discard");
});

clause(MADSTER, "0:ability", "the pick is part of the cost: with no character of mine in play it cannot be cast", () => {
  const b = madBoard({ cards: [{ key: "theirs", def: chr("Theirs"), owner: P2, zone: "play" }] });
  refused(() => play(b.engine, P1, b.id("mm"), {}), "nothing to pick");
  refused(() => castMad(b, "theirs"), "the opponent's character is no substitute");
  assert.equal(zoneOf(b.engine, b.id("mm")), "hand");
  assert.equal(ready(b.engine, P1), 4);
  const ok = madBoard({ cards: [mine("a")] }); // control
  castMad(ok, "a");
  assert.equal(zoneOf(ok.engine, ok.id("mm")), "play");
});

clause(MADSTER, "0:ability", "needs [R][R][R][R]: three [R] plus another icon is refused", () => {
  const b = madBoard({ rage: 3, greed: 1, cards: [mine("a")] });
  assert.equal(ready(b.engine, P1), 4);
  refused(() => castMad(b, "a"), "only three [R] icons", /threshold/i);
  assert.equal(zoneOf(b.engine, b.id("mm")), "hand");
  assert.equal(zoneOf(b.engine, b.id("a")), "play");
  assert.equal(ready(b.engine, P1), 4);
  const three = madBoard({ rage: 3, cards: [mine("a")] });
  refused(() => castMad(three, "a"), "three resources are not enough for [R][R][R][R]", /threshold/i);
});

clause(MADSTER, "0:ability", "costs 1: all four [R] present but already spent is refused; unspent four works", () => {
  const b = madBoard({ rage: 0, spent: 4, cards: [mine("a")] });
  assert.equal(ready(b.engine, P1), 0);
  refused(() => castMad(b, "a"), "no resource left to pay 1");
  assert.equal(zoneOf(b.engine, b.id("mm")), "hand");
  assert.equal(zoneOf(b.engine, b.id("a")), "play", "the pick is not destroyed when the cast fails");
  const ok = madBoard({ rage: 4, cards: [mine("a")] });
  castMad(ok, "a");
  assert.equal(zoneOf(ok.engine, ok.id("mm")), "play");
});

// --- 1:rule: destroy the picked character -------------------------------------------------

clause(MADSTER, "1:rule", "when Madster enters play the picked character is destroyed, and nothing else is", () => {
  const b = madBoard({ cards: [mine("a"), mine("b"), { key: "theirs", def: chr("Theirs"), owner: P2, zone: "play" }] });
  castMad(b, "a");
  assert.equal(zoneOf(b.engine, b.id("a")), "discard", "destroyed");
  assert.deepEqual(destroyedIds(b.engine), [b.id("a")], "exactly one destruction, of the pick");
  assert.equal(zoneOf(b.engine, b.id("b")), "play");
  assert.equal(zoneOf(b.engine, b.id("theirs")), "play");
  assert.equal(zoneOf(b.engine, b.id("mm")), "play", "Madster itself survives");
  assert.equal(pending(b.engine), undefined);
});

clause(MADSTER, "1:rule", "the destruction happens as Madster ENTERS play, not when the cost is paid: while it waits to resolve the pick is still in play", () => {
  const b = madBoard({ cards: [mine("a")] });
  playRaw(b.engine, P1, b.id("mm"), { selected: { sacrifice: [b.id("a")] } });
  assert.notEqual(zoneOf(b.engine, b.id("mm")), "play", "Madster has not entered play yet");
  assert.equal(zoneOf(b.engine, b.id("a")), "play", "the picked character is still in play");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("mm")), "play");
  assert.equal(zoneOf(b.engine, b.id("a")), "discard");
});

clause(MADSTER, "1:rule", "a picked character that carries its own destroy replacement is destroyed (its replacement acts), proving a destroy rather than a plain discard", () => {
  const other = madBoard({ zone: "hand", cards: [{ key: "mm2", def: printing(MADSTER), owner: P1, zone: "play" }, ...fillers("dk", 3, P1, "deck")] });
  castMad(other, "mm2");
  assert.deepEqual(destroyedIds(other.engine), [other.id("mm2")]);
  assert.equal(zoneOf(other.engine, other.id("mm2")), "deck", "the picked Madster was destroyed and its own replacement put it in the deck");
});

// --- 2:rule: shuffle into the deck instead of the discard pile -------------------------------

const KILL = "kill";
const placeKill = (): CardPlacement => ({ key: KILL, def: killTactic(), owner: P1, zone: "hand" });

clause(MADSTER, "2:rule", "destroyed by lethal battle damage it is shuffled into the deck, not discarded", () => {
  const b = madBoard({
    zone: "play",
    active: P2,
    cards: [{ key: "oatk", def: chr("BigAtk", { strength: 5 }), owner: P2, zone: "play" }, ...fillers("dk", 4, P1, "deck")]
  });
  declareAttackBy(b.engine, P2, [b.id("oatk")]);
  declareBlockers(b.engine, P1, [b.id("mm")]);
  finishBattle(b.engine);
  assert.equal(zoneOf(b.engine, b.id("mm")), "deck", "5 damage kills the 4-life Madster; it is recycled");
  assert.ok(!discardOf(b.engine, P1).includes(b.id("mm")), "!discardOf(b.engine, P1).includes(b.id(\"mm\"))");
  assert.equal(deckOf(b.engine, P1).length, 5);
});

clause(MADSTER, "2:rule", "control: a Madster that survives its battle (3 damage on 4 life) stays in play and is not recycled", () => {
  const b = madBoard({
    zone: "play",
    active: P2,
    cards: [{ key: "oatk", def: chr("SmallAtk", { strength: 3 }), owner: P2, zone: "play" }, ...fillers("dk", 4, P1, "deck")]
  });
  declareAttackBy(b.engine, P2, [b.id("oatk")]);
  declareBlockers(b.engine, P1, [b.id("mm")]);
  finishBattle(b.engine);
  assert.equal(zoneOf(b.engine, b.id("mm")), "play");
  assert.equal(deckOf(b.engine, P1).length, 4);
});

clause(MADSTER, "2:rule", "destroyed in play: Madster goes into its owner's deck instead of the discard pile (deck grows by one, discard stays empty)", () => {
  const b = madBoard({ zone: "play", cards: [placeKill(), ...fillers("dk", 10, P1, "deck")] });
  assert.equal(deckOf(b.engine, P1).length, 10);
  zap(b, KILL, "mm");
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("mm")), "deck");
  assert.equal(deckOf(b.engine, P1).length, 11);
  assert.ok(deckOf(b.engine, P1).includes(b.id("mm")), "deckOf(b.engine, P1).includes(b.id(\"mm\"))");
  assert.ok(!discardOf(b.engine, P1).includes(b.id("mm")), "not in the discard pile");
  assert.deepEqual(discardOf(b.engine, P1), [b.id(KILL)], "only the tactic itself is in the discard pile");
});

clause(MADSTER, "2:rule", "it is SHUFFLED into the deck: across seeds the other cards' order is not left as it was", () => {
  let shuffled = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const b = madBoard({ zone: "play", seed, cards: [placeKill(), ...fillers("dk", 10, P1, "deck")] });
    const before = deckOf(b.engine, P1);
    zap(b, KILL, "mm");
    const after = deckOf(b.engine, P1);
    assert.equal(after.length, 11, `seed ${seed}: deck grew`);
    assert.deepEqual([...after].sort(), [...before, b.id("mm")].sort(), `seed ${seed}: same cards plus Madster`);
    if (after.filter((c) => c !== b.id("mm")).join() !== before.join()) shuffled++;
  }
  assert.ok(shuffled >= 5, `the deck gets shuffled (changed order in ${shuffled}/8 seeds)`);
});

clause(MADSTER, "2:rule", "'from anywhere': discarded from my hand it goes into my deck instead", () => {
  const b = madBoard({ zone: "hand", cards: [{ key: "dis", def: discardFromHandTactic(), owner: P1, zone: "hand" }, ...fillers("dk", 5, P1, "deck")] });
  zap(b, "dis", "mm");
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("mm")), "deck", "recycled instead of discarded");
  assert.equal(deckOf(b.engine, P1).length, 6);
  assert.ok(!discardOf(b.engine, P1).includes(b.id("mm")), "!discardOf(b.engine, P1).includes(b.id(\"mm\"))");
});

clause(MADSTER, "2:rule", "'from anywhere': milled from the top of my deck it stays in my deck (shuffled) instead of reaching the discard pile", () => {
  const b = madBoard({ zone: "deck", cards: [{ key: "mill", def: millTactic(), owner: P1, zone: "hand" }, ...fillers("dk", 5, P1, "deck")] });
  assert.equal(deckOf(b.engine, P1)[0], b.id("mm"), "setup: Madster is the top card of the deck");
  play(b.engine, P1, b.id("mill"), {});
  assert.equal(pending(b.engine), undefined);
  assert.ok(!discardOf(b.engine, P1).includes(b.id("mm")), "Madster did not reach the discard pile");
  assert.equal(zoneOf(b.engine, b.id("mm")), "deck");
  assert.equal(deckOf(b.engine, P1).length, 6, "all six cards are in the deck");
});

clause(MADSTER, "2:rule", "control: a milled card that is not Madster does reach the discard pile", () => {
  const b = madBoard({ zone: "hand", cards: [{ key: "mill", def: millTactic(), owner: P1, zone: "hand" }, ...fillers("dk", 5, P1, "deck")] });
  const top = deckOf(b.engine, P1)[0];
  play(b.engine, P1, b.id("mill"), {});
  assert.ok(discardOf(b.engine, P1).includes(top), "an ordinary milled card is discarded");
});

clause(MADSTER, "2:rule", "only THIS character is recycled: my other characters and the opponent's go to their discard piles as usual", () => {
  const b = madBoard({ zone: "play", cards: [placeKill(), { key: "kill2", def: killTactic(), owner: P1, zone: "hand" }, mine("ally"), { key: "foe", def: chr("Foe"), owner: P2, zone: "play" }, ...fillers("dk", 3, P1, "deck")] });
  zap(b, KILL, "ally");
  zap(b, "kill2", "foe");
  assert.equal(zoneOf(b.engine, b.id("ally")), "discard", "my other character is simply discarded");
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard", "the opponent's character too");
  assert.ok(discardOf(b.engine, P2).includes(b.id("foe")), "discardOf(b.engine, P2).includes(b.id(\"foe\"))");
  assert.equal(zoneOf(b.engine, b.id("mm")), "play", "Madster is untouched");
  assert.equal(deckOf(b.engine, P1).length, 3);
});

clause(MADSTER, "2:rule", "the opponent's own Madster is recycled into THEIR deck (their deck shuffled), and my deck is left alone", () => {
  for (let seed = 1; seed <= 4; seed++) {
    const b = madBoard({
      zone: "play",
      seed,
      cards: [placeKill(), { key: "mm2", def: printing(MADSTER), owner: P2, zone: "play" }, ...fillers("dk", 8, P1, "deck"), ...fillers("od", 8, P2, "deck")]
    });
    const mineBefore = deckOf(b.engine, P1);
    zap(b, KILL, "mm2");
    assert.equal(zoneOf(b.engine, b.id("mm2")), "deck", `seed ${seed}`);
    assert.equal(deckOf(b.engine, P2).length, 9, "it joined its owner's deck");
    assert.ok(deckOf(b.engine, P2).includes(b.id("mm2")), "deckOf(b.engine, P2).includes(b.id(\"mm2\"))");
    assert.deepEqual(deckOf(b.engine, P1), mineBefore, "my deck is neither shuffled nor changed");
    assert.equal(zoneOf(b.engine, b.id("mm")), "play");
  }
});

clause(MADSTER, "2:rule", "the replacement belongs to Madster: another character that merely shares its name (and has no such text) is discarded normally", () => {
  const b = madBoard({
    zone: "play",
    cards: [placeKill(), { key: "twin", def: chr("Marauding Madster"), owner: P1, zone: "play" }, ...fillers("dk", 3, P1, "deck")]
  });
  zap(b, KILL, "twin");
  assert.equal(zoneOf(b.engine, b.id("twin")), "discard", "no replacement of its own, and Madster's text says 'this character'");
  assert.equal(deckOf(b.engine, P1).length, 3);
});

clause(MADSTER, "2:rule", "only a move into the discard pile is replaced: returned to my hand it simply goes to my hand", () => {
  const b = madBoard({ zone: "play", cards: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }, ...fillers("dk", 3, P1, "deck")] });
  zap(b, "bounce", "mm");
  assert.equal(zoneOf(b.engine, b.id("mm")), "hand");
  assert.equal(deckOf(b.engine, P1).length, 3, "the deck is untouched");
});

clause(MADSTER, "2:rule", "'your discard pile': a Madster I own but the opponent controls is destroyed into MY (its owner's) discard pile, not into a deck, since it would not be put into the controller's discard pile", () => {
  const b = madBoard({
    zone: "hand",
    cards: [placeKill(), { key: "stolen", def: printing(MADSTER), owner: P1, controller: P2, zone: "play" }, ...fillers("dk", 3, P1, "deck"), ...fillers("od", 3, P2, "deck")]
  });
  assert.equal(b.engine.state.cards[b.id("stolen")].controllerId, P2, "setup: the opponent controls my Madster");
  zap(b, KILL, "stolen");
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("stolen")), "discard", "literal reading: it goes to its owner's discard pile, which is not the controller's discard pile");
  assert.equal(deckOf(b.engine, P1).length, 3);
  assert.equal(deckOf(b.engine, P2).length, 3);
});

// =====================================================================================
// Rudo Mangod, Dragonweight Champion — character, warlord, rudo + fighter, cost 4, [R][R][R][R], str 5 / spd 3 / life 5
// UNIQUE RUDOLPHUS -- When this card enters play, deplete all other characters you control. They cannot be restored
// by your faction's RESTORE RULE. -- This character gains 1 strength for each depleted warlord character you control.
// =====================================================================================

const RUDO = "39d69cc2-0af9-4e69-b31f-b7cc964353bb";
const RUDO_1ST = "ae4f6e1e-19c6-4151-be5c-edc185640deb"; // 1st Edition Rudo Mangod: another printing that carries UNIQUE RUDOLPHUS

function rudoBoard(o: { rage?: number; greed?: number; spent?: number; zone?: "hand" | "play"; turn?: number; active?: PlayerId; cards?: CardPlacement[] } = {}) {
  return duo(
    [
      { key: "rudo", def: printing(RUDO), owner: P1, zone: o.zone ?? "hand" },
      ...bank("rage", o.rage ?? 4, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...spentResources(P1, o.spent ?? 0),
      ...(o.cards ?? [])
    ],
    { turn: o.turn, active: o.active }
  );
}
const castRudo = (b: Board): void => play(b.engine, P1, b.id("rudo"), {});
const wl = (key: string, extra: Partial<CardPlacement> = {}, over: Partial<CardDefinition> = {}): CardPlacement => ({ key, def: chr(key, { trade: "warlord", ...over }), owner: P1, zone: "play", ...extra });
const rudoStr = (b: Board): number => b.engine.getStat(b.id("rudo"), "strength");
const keepChoice = (b: Board, keep: string): void =>
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id(keep) } } as never);

// --- 0:unique RUDOLPHUS ------------------------------------------------------------------

clause(RUDO, "0:unique", "controlling a second Rudo makes me choose which to keep: keeping the new one destroys the old one", () => {
  const b = rudoBoard({ cards: [{ key: "old", def: printing(RUDO), owner: P1, zone: "play" }] });
  castRudo(b);
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[]; unique: string };
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses");
  assert.deepEqual([...pc.candidates].sort(), [b.id("old"), b.id("rudo")].sort());
  keepChoice(b, "rudo");
  assert.equal(zoneOf(b.engine, b.id("rudo")), "play");
  assert.equal(zoneOf(b.engine, b.id("old")), "discard", "the other copy is destroyed");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(RUDO, "0:unique", "keeping the old one destroys the new one instead", () => {
  const b = rudoBoard({ cards: [{ key: "old", def: printing(RUDO), owner: P1, zone: "play" }] });
  castRudo(b);
  keepChoice(b, "old");
  assert.equal(zoneOf(b.engine, b.id("old")), "play");
  assert.equal(zoneOf(b.engine, b.id("rudo")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(RUDO, "0:unique", "the identifier is RUDOLPHUS, not the card: another printing of Rudo Mangod in play also forces the choice", () => {
  const b = rudoBoard({ cards: [{ key: "first", def: printing(RUDO_1ST), owner: P1, zone: "play" }] });
  castRudo(b);
  const pc = pending(b.engine) as unknown as { kind: string; candidates: string[] };
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.deepEqual([...pc.candidates].sort(), [b.id("first"), b.id("rudo")].sort());
  keepChoice(b, "rudo");
  assert.equal(zoneOf(b.engine, b.id("first")), "discard");
  assert.equal(zoneOf(b.engine, b.id("rudo")), "play");
});

clause(RUDO, "0:unique", "UNIQUE is per player: the opponent controlling their own Rudo is fine, no choice, both stay", () => {
  const b = rudoBoard({ cards: [{ key: "theirs", def: printing(RUDO), owner: P2, zone: "play" }] });
  castRudo(b);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("rudo")), "play");
  assert.equal(zoneOf(b.engine, b.id("theirs")), "play");
});

clause(RUDO, "0:unique", "a different UNIQUE identifier, or a Rudo that is not in play, never forces a choice", () => {
  const b = rudoBoard({
    cards: [
      { key: "other", def: chr("Other Unique", { unique: "someone-else" }), owner: P1, zone: "play" },
      { key: "inHand", def: printing(RUDO), owner: P1, zone: "hand" },
      { key: "inDiscard", def: printing(RUDO), owner: P1, zone: "discard" }
    ]
  });
  castRudo(b);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("rudo")), "play");
  assert.equal(zoneOf(b.engine, b.id("other")), "play");
  assert.equal(zoneOf(b.engine, b.id("inHand")), "hand");
});

// --- 1:rule: enters-play deplete + restore lock --------------------------------------------

clause(RUDO, "1:rule", "deploys for its printed cost 4 / [R][R][R][R] with printed 5 / 3 / 5, and spends exactly 4", () => {
  const b = rudoBoard({ rage: 4 });
  assert.equal(ready(b.engine, P1), 4);
  castRudo(b);
  assert.equal(zoneOf(b.engine, b.id("rudo")), "play");
  assert.equal(ready(b.engine, P1), 0, "cost 4 paid");
  assert.equal(b.engine.getStat(b.id("rudo"), "strength"), 5);
  assert.equal(b.engine.getStat(b.id("rudo"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("rudo"), "life"), 5);
  assert.equal(isDepleted(b.engine, b.id("rudo")), false, "Rudo itself is not depleted by its own trigger");
});

clause(RUDO, "1:rule", "printed type line: a warlord character with subtypes rudo and fighter", () => {
  identity(RUDO, "character", "warlord", ["rudo", "fighter"]);
});

clause(RUDO, "1:rule", "cannot be deployed one short: three [R], three [R] plus another icon, or four spent resources", () => {
  const three = rudoBoard({ rage: 3 });
  refused(() => castRudo(three), "cost 4 with 3 resources", /threshold|afford|resource|cost/i);
  assert.equal(zoneOf(three.engine, three.id("rudo")), "hand");
  const icons = rudoBoard({ rage: 3, greed: 1 });
  assert.equal(ready(icons.engine, P1), 4);
  refused(() => castRudo(icons), "only three [R] icons", /threshold/i);
  assert.equal(zoneOf(icons.engine, icons.id("rudo")), "hand");
  const spent = rudoBoard({ rage: 0, spent: 4 });
  refused(() => castRudo(spent), "[R] threshold met by spent resources but nothing left to pay with", /Costs cannot be paid/);
  assert.equal(zoneOf(spent.engine, spent.id("rudo")), "hand");
  const spentOk = rudoBoard({ rage: 4, spent: 4 });
  castRudo(spentOk);
  assert.notEqual(zoneOf(spentOk.engine, spentOk.id("rudo")), "hand", "control: the same spent banks plus four ready [R] deploy it");
});

clause(RUDO, "1:rule", "entering play depletes ALL my other characters (ready and already-depleted alike) but not Rudo, the opponent's characters, my items or my resources", () => {
  const b = rudoBoard({
    rage: 5,
    cards: [
      wl("wlReady"),
      mine("plain"),
      mine("alreadyTired", {}, { depleted: true }),
      { key: "foe", def: chr("Foe"), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" }
    ]
  });
  castRudo(b);
  assert.equal(pending(b.engine), undefined);
  assert.equal(isDepleted(b.engine, b.id("wlReady")), true);
  assert.equal(isDepleted(b.engine, b.id("plain")), true);
  assert.equal(isDepleted(b.engine, b.id("alreadyTired")), true);
  assert.equal(isDepleted(b.engine, b.id("rudo")), false, "not itself");
  assert.equal(isDepleted(b.engine, b.id("foe")), false, "not the opponent's");
  assert.equal(isDepleted(b.engine, b.id("gear")), false, "not an item");
  assert.equal(ready(b.engine, P1), 1, "the one spare resource is still ready: resources are not depleted");
});

clause(RUDO, "1:rule", "only Rudo entering triggers it: another character of mine entering later does not deplete anyone", () => {
  const b = rudoBoard({ zone: "play", cards: [mine("ally"), { key: "newcomer", def: chr("Newcomer", { cost: 0 }), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("newcomer"), {});
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("newcomer")), "play");
  assert.equal(isDepleted(b.engine, b.id("ally")), false);
  assert.equal(isDepleted(b.engine, b.id("rudo")), false);
  assert.equal(isDepleted(b.engine, b.id("newcomer")), false);
});

clause(RUDO, "1:rule", "the depleted characters are NOT restored by my Restore Rule, turn after turn, while the rest of the Restore Rule still happens", () => {
  const b = rudoBoard({
    turn: 1,
    cards: [wl("wl"), mine("plain"), mine("alreadyTired", {}, { depleted: true }), { key: "foeTired", def: chr("FoeTired"), owner: P2, zone: "play", depleted: true }]
  });
  castRudo(b);
  assert.equal(attachedCount(b.engine, P1), 4, "the four paid resources are spent (attached)");
  for (let cycle = 1; cycle <= 3; cycle++) {
    endTurn(b.engine, P1);
    assert.equal(isDepleted(b.engine, b.id("foeTired")), false, `cycle ${cycle}: the OPPONENT's Restore Rule restores their own character`);
    endTurn(b.engine, P2);
    assert.equal(b.engine.state.activePlayerId, P1);
    for (const key of ["wl", "plain", "alreadyTired"]) assert.equal(isDepleted(b.engine, b.id(key)), true, `cycle ${cycle}: ${key} stays depleted`);
    assert.equal(isDepleted(b.engine, b.id("rudo")), false);
    assert.equal(attachedCount(b.engine, P1), 0, `cycle ${cycle}: the Restore Rule still detached my resources`);
  }
});

clause(RUDO, "1:rule", "'They' means only the characters it depleted: a character that entered afterwards and is depleted IS restored by the Restore Rule", () => {
  const b = rudoBoard({ turn: 1, cards: [mine("old"), { key: "late", def: chr("Late", { cost: 0 }), owner: P1, zone: "hand" }] });
  castRudo(b);
  play(b.engine, P1, b.id("late"), {});
  b.engine.state.cards[b.id("late")].depleted = true;
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(isDepleted(b.engine, b.id("late")), false, "a later arrival is restored as usual");
  assert.equal(isDepleted(b.engine, b.id("old")), true, "the locked one is not");
});

clause(RUDO, "1:rule", "only the Restore Rule is blocked: an explicit 'restore' effect restores a character Rudo depleted", () => {
  const b = rudoBoard({ cards: [wl("wl"), mine("plain"), { key: "refresh", def: restoreTactic(), owner: P1, zone: "hand" }] });
  castRudo(b);
  assert.equal(isDepleted(b.engine, b.id("wl")), true);
  zap(b, "refresh", "wl");
  assert.equal(isDepleted(b.engine, b.id("wl")), false, "restored by the effect");
  assert.equal(isDepleted(b.engine, b.id("plain")), true, "the other one is still depleted");
});

clause(RUDO, "1:rule", "the lock has no end of its own: the characters stay unrestorable by the Restore Rule even after Rudo has left play", () => {
  const b = rudoBoard({ turn: 1, cards: [wl("wl"), mine("plain"), { key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  castRudo(b);
  zap(b, "kill", "rudo");
  assert.equal(zoneOf(b.engine, b.id("rudo")), "discard", "Rudo is gone");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(isDepleted(b.engine, b.id("wl")), true);
  assert.equal(isDepleted(b.engine, b.id("plain")), true);
});

// --- 2:rule: +1 strength per depleted warlord character you control ---------------------------

clause(RUDO, "2:rule", "no depleted warlord characters: printed strength 5 (other stats unchanged)", () => {
  const b = rudoBoard({ zone: "play", cards: [wl("readyWl"), wl("readyWl2")] });
  assert.equal(rudoStr(b), 5);
  assert.equal(b.engine.getStat(b.id("rudo"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("rudo"), "life"), 5);
});

clause(RUDO, "2:rule", "+1 strength for EACH depleted warlord character I control: one, two, three", () => {
  const b = rudoBoard({ zone: "play", cards: [wl("a", { depleted: true }), wl("b", { depleted: true }), wl("c", { depleted: true }), wl("readyWl")] });
  assert.equal(rudoStr(b), 8, "5 + 3 depleted warlords (the ready one doesn't count)");
  assert.equal(b.engine.getStat(b.id("rudo"), "speed"), 3, "only strength changes");
  assert.equal(b.engine.getStat(b.id("rudo"), "life"), 5);
  const one = rudoBoard({ zone: "play", cards: [wl("a", { depleted: true })] });
  assert.equal(rudoStr(one), 6);
  const two = rudoBoard({ zone: "play", cards: [wl("a", { depleted: true }), wl("b", { depleted: true })] });
  assert.equal(rudoStr(two), 7);
});

clause(RUDO, "2:rule", "only depleted WARLORD CHARACTERS I control IN PLAY count: depleted non-warlords, ready warlords, the opponent's depleted warlords, a depleted warlord item and warlords in hand / discard don't", () => {
  const b = rudoBoard({
    zone: "play",
    cards: [
      mine("gear", { trade: "gearsmith" }, { depleted: true }),
      wl("ready"),
      { key: "theirs", def: chr("TheirWl", { trade: "warlord" }), owner: P2, zone: "play", depleted: true },
      { key: "wlItem", def: item({ name: "Warlord Item", trade: "warlord" }), owner: P1, zone: "play", depleted: true },
      wl("inDiscard", { zone: "discard", depleted: true }),
      wl("inHand", { zone: "hand", depleted: true })
    ]
  });
  assert.equal(rudoStr(b), 5, "none of them counts (nor warlords outside play)");
  const ctl = rudoBoard({ zone: "play", cards: [wl("counts", { depleted: true }), mine("gear", { trade: "gearsmith" }, { depleted: true })] });
  assert.equal(rudoStr(ctl), 6, "control: only the depleted warlord character counts");
});

clause(RUDO, "2:rule", "Rudo is itself a depleted warlord character I control, so when Rudo is depleted it counts itself", () => {
  const alone = rudoBoard({ zone: "play", cards: [] });
  alone.engine.state.cards[alone.id("rudo")].depleted = true;
  assert.equal(rudoStr(alone), 6, "5 + itself");
  const withAlly = rudoBoard({ zone: "play", cards: [wl("a", { depleted: true })] });
  withAlly.engine.state.cards[withAlly.id("rudo")].depleted = true;
  assert.equal(rudoStr(withAlly), 7, "5 + the ally + itself");
});

clause(RUDO, "2:rule", "the bonus tracks the board: restoring a depleted warlord takes the strength back down", () => {
  const b = rudoBoard({ zone: "play", cards: [wl("a", { depleted: true }), wl("b", { depleted: true }), { key: "refresh", def: restoreTactic(), owner: P1, zone: "hand" }] });
  assert.equal(rudoStr(b), 7);
  zap(b, "refresh", "a");
  assert.equal(rudoStr(b), 6);
});

clause(RUDO, "2:rule", "deploying Rudo depletes my warlords and so immediately pumps it: 5 + the number of other warlords it depleted", () => {
  const b = rudoBoard({ cards: [wl("a"), wl("b"), mine("plain", { trade: "gearsmith" })] });
  castRudo(b);
  assert.equal(rudoStr(b), 7, "two warlords depleted by the trigger, the non-warlord adds nothing");
});

// =====================================================================================
// Rushing Crushing Blockhead — character, warlord, berserker, cost 3, [R], str 4 / spd 4 / life 2
// If this card inflicts damage to a faction, destroy this card and inflict 2 damage to your faction.
// -- This character cannot block. -- [R][R][R][R][R][R]: This card loses all other rules text and loses 1 speed.
// =====================================================================================

const RCB = "ef509645-3df1-44fb-955b-069fc0aebe35";

function rcbBoard(o: { rage?: number; greed?: number; spent?: number; foeRage?: number; zone?: "play" | "hand"; turn?: number; active?: PlayerId; cards?: CardPlacement[] } = {}) {
  return duo(
    [
      { key: "rcb", def: printing(RCB), owner: P1, zone: o.zone ?? "play" },
      ...bank("rage", o.rage ?? 0, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...spentResources(P1, o.spent ?? 0),
      ...bank("rage", o.foeRage ?? 0, P2),
      ...(o.cards ?? [])
    ],
    { turn: o.turn, active: o.active }
  );
}
/** P1 attacks the opponent's faction with `attackers`; P2 blocks with `blockers`; the battle is played out. */
function strike(b: Board, attackers: string[], blockers: string[] = [], target?: { type: "card"; cardId: CardInstanceId }): void {
  declareAttackBy(b.engine, P1, attackers.map((k) => b.id(k)), target);
  declareBlockers(b.engine, P2, blockers.map((k) => b.id(k)));
  finishBattle(b.engine);
}
const wall = (): CardPlacement => ({ key: "wall", def: chr("Wall", { strength: 0, life: 9, speed: 1 }), owner: P2, zone: "play" });
/** P2 attacks P1's faction with `oatk`; P1 then holds the blocking decision. */
function underAttack(b: Board): void {
  declareAttackBy(b.engine, P2, [b.id("oatk")]);
  assert.ok(battleOf(b.engine), "a battle is underway");
}
const theirAtk = (): CardPlacement => ({ key: "oatk", def: chr("OppAtk", { strength: 1 }), owner: P2, zone: "play" });

clause(RCB, "0:rule", "deploys for its printed cost 3 and a single [R], with printed 4 / 4 / 2 (one [R] among three resources is enough)", () => {
  const b = rcbBoard({ zone: "hand", rage: 1, greed: 2 });
  assert.equal(ready(b.engine, P1), 3);
  play(b.engine, P1, b.id("rcb"), {});
  assert.equal(zoneOf(b.engine, b.id("rcb")), "play");
  assert.equal(ready(b.engine, P1), 0, "cost 3 paid");
  assert.equal(b.engine.getStat(b.id("rcb"), "strength"), 4);
  assert.equal(b.engine.getStat(b.id("rcb"), "speed"), 4);
  assert.equal(b.engine.getStat(b.id("rcb"), "life"), 2);
});

clause(RCB, "0:rule", "printed type line: a warlord berserker character", () => {
  identity(RCB, "character", "warlord", ["berserker"]);
});

clause(RCB, "0:rule", "cannot be deployed one resource short, with no [R] among enough resources, or with the [R] present but spent", () => {
  const two = rcbBoard({ zone: "hand", rage: 2 });
  refused(() => play(two.engine, P1, two.id("rcb"), {}), "cost 3 with 2 resources");
  assert.equal(zoneOf(two.engine, two.id("rcb")), "hand");
  const noRage = rcbBoard({ zone: "hand", greed: 4 });
  refused(() => play(noRage.engine, P1, noRage.id("rcb"), {}), "no [R] icon", /threshold/i);
  assert.equal(zoneOf(noRage.engine, noRage.id("rcb")), "hand");
  const spent = rcbBoard({ zone: "hand", spent: 3, greed: 2 });
  assert.equal(ready(spent.engine, P1), 2);
  refused(() => play(spent.engine, P1, spent.id("rcb"), {}), "[R] threshold met by spent resources but only 2 ready resources for cost 3", /Costs cannot be paid/);
  assert.equal(zoneOf(spent.engine, spent.id("rcb")), "hand");
  const spentOk = rcbBoard({ zone: "hand", spent: 3, greed: 3 });
  play(spentOk.engine, P1, spentOk.id("rcb"), {});
  assert.notEqual(zoneOf(spentOk.engine, spentOk.id("rcb")), "hand", "control: the same spent banks plus three ready resources deploy it");
});

// --- 0:rule: recoil after hitting a faction --------------------------------------------------

clause(RCB, "0:rule", "unblocked on the opponent's faction: they take its 4, then it is destroyed and my faction takes 2", () => {
  const b = rcbBoard();
  const [mineBefore, theirsBefore] = [infl(b.engine, P1), infl(b.engine, P2)];
  strike(b, ["rcb"]);
  assert.equal(infl(b.engine, P2), theirsBefore - 4, "the opponent's faction took the 4 battle damage");
  assert.equal(zoneOf(b.engine, b.id("rcb")), "discard", "Rushing Crushing Blockhead is destroyed");
  assert.equal(infl(b.engine, P1), mineBefore - 2, "my faction takes exactly 2");
  assert.equal(pending(b.engine), undefined);
});

clause(RCB, "0:rule", "it recoils once however it got there, and only itself is destroyed: its attack partner survives and the partner's damage still lands", () => {
  const b = rcbBoard({ cards: [{ key: "buddy", def: chr("Buddy", { strength: 1 }), owner: P1, zone: "play" }] });
  const [mineBefore, theirsBefore] = [infl(b.engine, P1), infl(b.engine, P2)];
  strike(b, ["rcb", "buddy"]);
  assert.equal(infl(b.engine, P2), theirsBefore - 5, "4 + 1");
  assert.equal(zoneOf(b.engine, b.id("rcb")), "discard");
  assert.equal(zoneOf(b.engine, b.id("buddy")), "play", "the other attacker is not destroyed");
  assert.equal(infl(b.engine, P1), mineBefore - 2, "one recoil of 2, not two");
});

clause(RCB, "0:rule", "it is only about THIS card: another character of mine hitting the faction while Blockhead stays home doesn't destroy it or hurt me", () => {
  const b = rcbBoard({ cards: [{ key: "buddy", def: chr("Buddy", { strength: 3 }), owner: P1, zone: "play" }] });
  const [mineBefore, theirsBefore] = [infl(b.engine, P1), infl(b.engine, P2)];
  strike(b, ["buddy"]);
  assert.equal(infl(b.engine, P2), theirsBefore - 3, "the attack landed");
  assert.equal(zoneOf(b.engine, b.id("rcb")), "play", "Blockhead didn't deal that damage");
  assert.equal(infl(b.engine, P1), mineBefore, "no recoil");
});

clause(RCB, "0:rule", "blocked, it damages a character, not a faction: it survives and my faction is untouched", () => {
  const b = rcbBoard({ cards: [wall()] });
  const [mineBefore, theirsBefore] = [infl(b.engine, P1), infl(b.engine, P2)];
  strike(b, ["rcb"], ["wall"]);
  assert.equal(b.engine.state.cards[b.id("wall")].damage, 4, "the blocker took the damage");
  assert.equal(infl(b.engine, P2), theirsBefore, "their faction took nothing");
  assert.equal(zoneOf(b.engine, b.id("rcb")), "play", "no faction damage, no recoil");
  assert.equal(infl(b.engine, P1), mineBefore);
});

clause(RCB, "0:rule", "damage to a location is not damage to a faction: no recoil", () => {
  const b = rcbBoard({ cards: [{ key: "fort", def: location({ name: "Fort", structure: 9 }), owner: P2, zone: "play" }] });
  const [mineBefore, theirsBefore] = [infl(b.engine, P1), infl(b.engine, P2)];
  strike(b, ["rcb"], [], { type: "card", cardId: b.id("fort") });
  assert.equal(b.engine.state.cards[b.id("fort")].damage, 4, "the location took the damage");
  assert.equal(zoneOf(b.engine, b.id("rcb")), "play");
  assert.equal(infl(b.engine, P1), mineBefore);
  assert.equal(infl(b.engine, P2), theirsBefore);
});

// --- 1:rule: cannot block --------------------------------------------------------------------

clause(RCB, "1:rule", "cannot be declared as a blocker, alone or in a group, while another character of mine can", () => {
  const b = rcbBoard({ active: P2, cards: [theirAtk(), { key: "buddy", def: chr("Buddy"), owner: P1, zone: "play" }] });
  assert.equal(b.engine.getRestrictions(b.id("rcb")).includes("cannotBlock"), true);
  underAttack(b);
  refused(() => declareBlockers(b.engine, P1, [b.id("rcb")]), "Blockhead cannot block");
  refused(() => declareBlockers(b.engine, P1, [b.id("rcb"), b.id("buddy")]), "nor in a group");
  declareBlockers(b.engine, P1, [b.id("buddy")]); // control: its ally blocks fine
  finishBattle(b.engine);
  assert.equal(b.engine.state.cards[b.id("buddy")].damage, 1, "buddy blocked OppAtk");
});

clause(RCB, "1:rule", "it is not restricted from anything else: it still attacks", () => {
  const b = rcbBoard();
  strike(b, ["rcb"]);
  assert.equal(zoneOf(b.engine, b.id("rcb")), "discard", "it attacked and (by its own recoil) died");
});

// --- 2:rule@rrrrrr: loses all other rules text and 1 speed ------------------------------------

clause(RCB, "2:rule@rrrrrr", "with six [R]: speed drops to 3, strength 4 and life 2 are unchanged", () => {
  const b = rcbBoard({ rage: 6 });
  assert.equal(b.engine.getStat(b.id("rcb"), "speed"), 3, "4 - 1");
  assert.equal(b.engine.getStat(b.id("rcb"), "strength"), 4);
  assert.equal(b.engine.getStat(b.id("rcb"), "life"), 2);
});

clause(RCB, "2:rule@rrrrrr", "without six [R] (five [R] plus another icon, or none) it keeps its speed 4 and all its text", () => {
  const five = rcbBoard({ rage: 5, greed: 1 });
  assert.equal(five.engine.getStat(five.id("rcb"), "speed"), 4, "five [R] is not six");
  assert.equal(five.engine.getRestrictions(five.id("rcb")).includes("cannotBlock"), true);
  const none = rcbBoard();
  assert.equal(none.engine.getStat(none.id("rcb"), "speed"), 4);
  assert.equal(none.engine.getRestrictions(none.id("rcb")).includes("cannotBlock"), true);
});

clause(RCB, "2:rule@rrrrrr", "with six [R] it loses its 'cannot block' text: it can be declared as a blocker (control: five [R] cannot)", () => {
  const b = rcbBoard({ rage: 6, active: P2, cards: [theirAtk()] });
  assert.equal(b.engine.getRestrictions(b.id("rcb")).includes("cannotBlock"), false);
  underAttack(b);
  declareBlockers(b.engine, P1, [b.id("rcb")]);
  finishBattle(b.engine);
  assert.equal(b.engine.state.cards[b.id("rcb")].damage, 1, "it blocked OppAtk");
  const five = rcbBoard({ rage: 5, greed: 1, active: P2, cards: [theirAtk()] });
  underAttack(five);
  refused(() => declareBlockers(five.engine, P1, [five.id("rcb")]), "five [R]: still cannot block");
});

clause(RCB, "2:rule@rrrrrr", "with six [R] it loses its recoil text: it hits the faction for 4 and neither dies nor hurts me", () => {
  const b = rcbBoard({ rage: 6 });
  const [mineBefore, theirsBefore] = [infl(b.engine, P1), infl(b.engine, P2)];
  strike(b, ["rcb"]);
  assert.equal(infl(b.engine, P2), theirsBefore - 4, "the damage still lands");
  assert.equal(zoneOf(b.engine, b.id("rcb")), "play", "no self-destruction");
  assert.equal(infl(b.engine, P1), mineBefore, "no damage to my faction");
});

clause(RCB, "2:rule@rrrrrr", "the icons are what count: six spent [R] resources still count, the opponent's six [R] don't", () => {
  const spent = rcbBoard({ rage: 0, spent: 6 });
  assert.equal(ready(spent.engine, P1), 0, "setup: every resource is spent");
  assert.equal(spent.engine.getStat(spent.id("rcb"), "speed"), 3, "icons are never spent (CR 405.6)");
  assert.equal(spent.engine.getRestrictions(spent.id("rcb")).includes("cannotBlock"), false);
  const foes = rcbBoard({ foeRage: 6 });
  assert.equal(foes.engine.getStat(foes.id("rcb"), "speed"), 4, "the opponent's icons don't count");
  assert.equal(foes.engine.getRestrictions(foes.id("rcb")).includes("cannotBlock"), true);
});

clause(RCB, "2:rule@rrrrrr", "the loss is live: losing a sixth [R] brings back the speed and the rules text", () => {
  const b = rcbBoard({ rage: 6, cards: [{ key: "zapper", def: zapResourceTactic(), owner: P1, zone: "hand" }] });
  assert.equal(b.engine.getStat(b.id("rcb"), "speed"), 3);
  const aResource = b.engine.state.players[P1].play.find((c) => b.engine.isResource(c))!;
  play(b.engine, P1, b.id("zapper"), { selected: { t: [aResource] } });
  assert.equal(b.engine.getStat(b.id("rcb"), "speed"), 4, "five [R] left: back to normal speed");
  assert.equal(b.engine.getRestrictions(b.id("rcb")).includes("cannotBlock"), true, "and the text is back");
});
