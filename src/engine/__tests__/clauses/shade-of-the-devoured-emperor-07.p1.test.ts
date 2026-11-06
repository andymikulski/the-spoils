// Clause tests — batch shade-of-the-devoured-emperor-07, part p1 (groups 1-8, missing clauses only).
// Expectations come from each card's PRINTED text and RULES.md / the CR; engine data is only used to drive the engine.

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
  location,
  play,
  resolvePendingResponses,
  tactic,
  volition,
  P1,
  P2
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { battleOf, declareAttackBy, declareAttackOpenWindow, finishBattle, playRaw } from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, readyResources, zoneOf } from "./_board.js";
import { clause, printing, refused, flipUpNow } from "./_clause.js";
import { endTurn } from "./_turn.js";

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
const dmg = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId].damage;
const isDepleted = (engine: SpoilsEngine, cardId: CardInstanceId): boolean => engine.state.cards[cardId].depleted;
const handOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].hand];
const deckOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].deck];
const discardOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].discard];
const FACTION = (player: PlayerId) => ({ type: "faction", playerId: player }) as const;
const flipUpAs = (engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}): void =>
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });
const revealLog = (engine: SpoilsEngine) =>
  engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed").map((entry) => entry.event as unknown as { cardIds: CardInstanceId[]; viewerId: string });

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

// =====================================================================================
// B.A.S.E. Jump — tactic, warlord, cost 3, [R]
// EXTRA COST: Pick a location. Pick a character. -- Inflict X damage to the character, where X is the
// location's structure. Draw a card. -- FLIP UP: 3 [R]
// =====================================================================================

const BASE = "2f5d63f6-0f6e-4af9-9732-c15f65606f96";

function baseBoard(o: { zone?: "hand" | "play"; faceDown?: boolean; rage?: number; greed?: number; structure?: number; locDamage?: number; life?: number; noLoc?: boolean; active?: PlayerId; cards?: CardPlacement[] } = {}) {
  return duo(
    [
      { key: "bj", def: printing(BASE), owner: P1, zone: o.zone ?? "hand", faceDown: o.faceDown ? true : undefined },
      ...(o.noLoc ? [] : [{ key: "loc", def: location({ name: "Tower", structure: o.structure ?? 4 }), owner: P2, zone: "play" as const, damage: o.locDamage ?? 0 }]),
      { key: "ch", def: chr("Target", { life: o.life ?? 10 }), owner: P2, zone: "play" },
      { key: "by", def: chr("Bystander", { life: 10 }), owner: P2, zone: "play" },
      ...fillers("dk", 3, P1, "deck"),
      ...bank("rage", o.rage ?? 3, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...(o.cards ?? [])
    ],
    { active: o.active }
  );
}
const baseCast = (b: Board, loc = "loc", ch = "ch"): void => play(b.engine, P1, b.id("bj"), { selected: { loc: [b.id(loc)], ch: [b.id(ch)] } });

clause(BASE, "0:ability", "inflicts the picked location's structure as damage to the picked character (structure 4, then 7), pays the printed cost 3, draws exactly the top card, and goes to the discard", () => {
  for (const structure of [4, 7]) {
    const b = baseBoard({ structure, rage: 4 });
    const top = deckOf(b.engine, P1)[0];
    const before = ready(b.engine, P1);
    baseCast(b);
    assert.equal(pending(b.engine), undefined);
    assert.equal(dmg(b.engine, b.id("ch")), structure, `structure ${structure} damage to the character`);
    assert.equal(dmg(b.engine, b.id("loc")), 0, "the location itself takes no damage");
    assert.equal(dmg(b.engine, b.id("by")), 0, "an unpicked character is untouched");
    assert.equal(before - ready(b.engine, P1), 3, "printed cost 3 paid, no more");
    assert.equal(zoneOf(b.engine, b.id("bj")), "discard");
    assert.deepEqual(handOf(b.engine, P1), [top], "drew exactly the top card of the deck");
    assert.equal(deckOf(b.engine, P1).length, 2);
  }
});

clause(BASE, "0:ability", "a character with life not above X is destroyed and the card is still drawn; one more life survives with X damage", () => {
  const dead = baseBoard({ structure: 4, life: 4 });
  const top = deckOf(dead.engine, P1)[0];
  baseCast(dead);
  assert.equal(zoneOf(dead.engine, dead.id("ch")), "discard", "life 4 against 4 damage: destroyed");
  assert.deepEqual(handOf(dead.engine, P1), [top], "the draw still happens");
  const alive = baseBoard({ structure: 4, life: 5 });
  baseCast(alive);
  assert.equal(zoneOf(alive.engine, alive.id("ch")), "play");
  assert.equal(dmg(alive.engine, alive.id("ch")), 4);
});

clause(BASE, "0:ability", "X is the location's structure (5) even when that location already has 2 damage on it", () => {
  const b = baseBoard({ structure: 5, locDamage: 2 });
  baseCast(b);
  assert.equal(dmg(b.engine, b.id("ch")), 5, "the structure value, not the remaining 3");
  assert.equal(dmg(b.engine, b.id("loc")), 2, "the location is not damaged further");
});

clause(BASE, "0:ability", "the location and the character may belong to either player: my own location and my own character work too", () => {
  const b = baseBoard({
    cards: [
      { key: "mloc", def: location({ name: "Mine", structure: 2 }), owner: P1, zone: "play" },
      { key: "mch", def: chr("Mine", { life: 10 }), owner: P1, zone: "play" }
    ]
  });
  baseCast(b, "mloc", "mch");
  assert.equal(dmg(b.engine, b.id("mch")), 2);
  assert.equal(dmg(b.engine, b.id("ch")), 0);
  assert.equal(dmg(b.engine, b.id("mloc")), 0);
});

clause(BASE, "0:ability", "both picks are required and typed: a non-location for the location, a non-character for the character, a card out of play, or a missing pick is refused", () => {
  const mk = () =>
    baseBoard({
      cards: [
        { key: "it", def: item({ name: "Gadget" }), owner: P2, zone: "play" },
        { key: "hc", def: chr("InHand"), owner: P2, zone: "hand" },
        { key: "dc", def: chr("InDiscard"), owner: P2, zone: "discard" },
        { key: "hl", def: location({ name: "HandLoc", structure: 3 }), owner: P2, zone: "hand" }
      ]
    });
  const cases: Array<[string, string[], string[]]> = [
    ["a character as the location", ["ch"], ["ch"]],
    ["an item as the location", ["it"], ["ch"]],
    ["a location in hand as the location", ["hl"], ["ch"]],
    ["a location as the character", ["loc"], ["loc"]],
    ["an item as the character", ["loc"], ["it"]],
    ["a character in hand as the character", ["loc"], ["hc"]],
    ["a character in the discard as the character", ["loc"], ["dc"]],
    ["no location picked", [], ["ch"]],
    ["no character picked", ["loc"], []]
  ];
  for (const [why, loc, ch] of cases) {
    const b = mk();
    const before = ready(b.engine, P1);
    refused(() => play(b.engine, P1, b.id("bj"), { selected: { loc: loc.map((k) => b.id(k)), ch: ch.map((k) => b.id(k)) } }), why);
    assert.equal(zoneOf(b.engine, b.id("bj")), "hand", `${why}: still in hand`);
    assert.equal(ready(b.engine, P1), before, `${why}: nothing paid`);
    assert.equal(dmg(b.engine, b.id("ch")), 0, `${why}: no damage`);
  }
  const ok = mk();
  baseCast(ok);
  assert.equal(dmg(ok.engine, ok.id("ch")), 4, "control: the legal picks work on the same board");
});

/** The printed type line: card type, trade and subtypes. */
const identity = (b: Board, key: string, type: string, trade: string, subtype: string[]): void => {
  const def = b.engine.getDefinition(b.id(key));
  assert.equal(def.type, type, `${key}: printed type`);
  assert.equal(def.trade, trade, `${key}: printed trade`);
  assert.deepEqual([...(def.subtype ?? [])], subtype, `${key}: printed subtypes`);
};

clause(BASE, "0:ability", "printed type line: a warlord tactic with no subtype", () => {
  identity(baseBoard(), "bj", "tactic", "warlord", []);
});

clause(BASE, "0:ability", "cannot be played when there is no location in play to pick (control: with a location it can)", () => {
  const none = baseBoard({ noLoc: true });
  refused(() => play(none.engine, P1, none.id("bj"), { selected: { ch: [none.id("ch")] } }), "no location in play");
  assert.equal(zoneOf(none.engine, none.id("bj")), "hand");
  assert.equal(dmg(none.engine, none.id("ch")), 0);
  const ok = baseBoard();
  baseCast(ok);
  assert.equal(dmg(ok.engine, ok.id("ch")), 4);
});

clause(BASE, "0:ability", "costs exactly 3 and needs [R]: two resources, or three resources with no [R], are refused (control: three with a [R])", () => {
  const short = baseBoard({ rage: 2 });
  refused(() => baseCast(short), "2 resources for cost 3");
  assert.equal(zoneOf(short.engine, short.id("bj")), "hand");
  assert.equal(dmg(short.engine, short.id("ch")), 0);
  const noRage = baseBoard({ rage: 0, greed: 5 });
  refused(() => baseCast(noRage), "five [G] but no [R]", /threshold/i);
  assert.equal(zoneOf(noRage.engine, noRage.id("bj")), "hand");
  const exact = baseBoard({ rage: 1, greed: 2 });
  baseCast(exact);
  assert.equal(dmg(exact.engine, exact.id("ch")), 4, "a single [R] among three resources is enough");
  assert.equal(ready(exact.engine, P1), 0);
});

clause(BASE, "0:ability", "as a tactic it can be played in response during the opponent's attack", () => {
  const b = baseBoard({ active: P2, rage: 3, cards: [{ key: "atk", def: chr("Atk"), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  baseCast(b);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("bj")), "discard");
  assert.equal(dmg(b.engine, b.id("ch")), 4);
});

// --- FLIP UP: 3 [R] ----------------------------------------------------------------

const flipBase = (b: Board): void => {
  flipUpAs(b.engine, P1, b.id("bj"), { loc: [b.id("loc")], ch: [b.id("ch")] });
  resolvePendingResponses(b.engine);
};

clause(BASE, "1:flipUp", "a face-down B.A.S.E. Jump flips up as a play: it pays 3 (two [R] banks and itself, CR 507.4b), deals the structure damage, draws, and ends in the discard", () => {
  const b = baseBoard({ zone: "play", faceDown: true, rage: 2, structure: 6 });
  assert.equal(b.engine.isResource(b.id("bj")), true, "face-down it is a resource");
  assert.equal(ready(b.engine, P1), 3, "two [R] banks plus the face-down card");
  const top = deckOf(b.engine, P1)[0];
  flipBase(b);
  assert.equal(pending(b.engine), undefined);
  assert.equal(ready(b.engine, P1), 0, "all three resources spent");
  assert.equal(dmg(b.engine, b.id("ch")), 6, "the tactic's effect ran with X = the location's structure");
  assert.deepEqual(handOf(b.engine, P1), [top], "and it drew a card");
  assert.equal(zoneOf(b.engine, b.id("bj")), "discard");
});

clause(BASE, "1:flipUp", "needs only ONE [R]: a single [R] bank with two [G] banks (and itself) flips up, paying 3", () => {
  const b = baseBoard({ zone: "play", faceDown: true, rage: 1, greed: 2 });
  assert.equal(ready(b.engine, P1), 4, "one [R] bank, two [G] banks and the face-down card");
  flipBase(b);
  assert.equal(pending(b.engine), undefined);
  assert.equal(b.engine.state.cards[b.id("bj")].faceDown, false, "flipped up");
  assert.equal(zoneOf(b.engine, b.id("bj")), "discard", "played and discarded");
  assert.equal(dmg(b.engine, b.id("ch")), 4, "the tactic's effect ran (X = structure 4)");
});

clause(BASE, "1:flipUp", "does not overpay: with plenty of resources it spends only 3", () => {
  const b = baseBoard({ zone: "play", faceDown: true, rage: 5 });
  assert.equal(ready(b.engine, P1), 6);
  flipBase(b);
  assert.equal(dmg(b.engine, b.id("ch")), 4);
  const left = ready(b.engine, P1);
  assert.ok(left === 2 || left === 3, `6 ready - 3 paid (- the card itself if a bank paid): ${left}`);
});

clause(BASE, "1:flipUp", "is refused one resource short (one [R] bank plus the card is only 2) and nothing is paid", () => {
  const b = baseBoard({ zone: "play", faceDown: true, rage: 1 });
  assert.equal(ready(b.engine, P1), 2);
  refused(() => flipBase(b), "cost 3 but only 2 resources");
  assert.equal(b.engine.state.cards[b.id("bj")].faceDown, true, "still face-down");
  assert.equal(zoneOf(b.engine, b.id("bj")), "play");
  assert.equal(ready(b.engine, P1), 2);
  assert.equal(dmg(b.engine, b.id("ch")), 0);
});

clause(BASE, "1:flipUp", "needs [R]: three or more resources with no [R] among them is refused", () => {
  const b = baseBoard({ zone: "play", faceDown: true, rage: 0, greed: 4 });
  assert.equal(ready(b.engine, P1), 5);
  refused(() => flipBase(b), "no [R] icon", /threshold/i);
  assert.equal(b.engine.state.cards[b.id("bj")].faceDown, true);
  assert.equal(ready(b.engine, P1), 5, "nothing paid");
  assert.equal(dmg(b.engine, b.id("ch")), 0);
});

// =====================================================================================
// Barracks of Precipitancy — location, warlord, cost 4, [R][R][R], structure 5
// GO TIME! / AT ANY COST!
// =====================================================================================

const BOP = "ab8e1b7d-a47b-4ffa-a8ff-0536a17627ca";
const BB = "1ce692f6-4dff-4d0e-a195-d0df9de5eb47";

type DeckKind = "character" | "item" | "location" | "tactic";
const deckCard = (kind: DeckKind, i: number, over: Partial<CardDefinition> = {}): CardDefinition => {
  const name = `Dk${i}`;
  switch (kind) {
    case "character":
      return chr(name, { cost: 3, ...over });
    case "item":
      return item({ name, ...over });
    case "location":
      return location({ name, structure: 3, ...over });
    case "tactic":
      return tactic({ name, ...over });
  }
};

function bopBoard(o: { kind?: DeckKind; size?: number; seed?: number; depleted?: boolean; damage?: number; rage?: number; deck?: CardDefinition[]; cards?: CardPlacement[] } = {}) {
  const defs = o.deck ?? Array.from({ length: o.size ?? 8 }, (_, i) => deckCard(o.kind ?? "character", i));
  return duo(
    [
      { key: "bop", def: printing(BOP), owner: P1, zone: "play", depleted: o.depleted ? true : undefined, damage: o.damage },
      ...defs.map((def, i) => ({ key: `dk${i}`, def, owner: P1, zone: "deck" as const })),
      { key: "foe", def: chr("Foe", { life: 10 }), owner: P2, zone: "play" },
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.cards ?? [])
    ],
    { random: seeded(o.seed ?? 1) }
  );
}
const goTime = (b: Board): void => activate(b.engine, P1, b.id("bop"), "bop-gotime");
const enteredFrom = (b: Board, before: CardInstanceId[]): CardInstanceId[] => before.filter((c) => zoneOf(b.engine, c) === "play");

clause(BOP, "0:ability:bop-gotime", "depletes Barracks as its cost, then puts one revealed character from the top of the deck into play under my control, revealing it to everyone and spending nothing", () => {
  const b = bopBoard({ rage: 2 });
  const orig = deckOf(b.engine, P1);
  const readyBefore = ready(b.engine, P1);
  assert.equal(isDepleted(b.engine, b.id("bop")), false);
  goTime(b);
  assert.equal(pending(b.engine), undefined);
  assert.equal(isDepleted(b.engine, b.id("bop")), true, "COST: deplete this card");
  const entered = enteredFrom(b, orig);
  assert.equal(entered.length, 1, "exactly one character entered play");
  assert.equal(b.engine.state.cards[entered[0]].controllerId, P1);
  assert.equal(b.engine.state.cards[entered[0]].ownerId, P1);
  assert.equal(deckOf(b.engine, P1).length, 7);
  assert.equal(deckOf(b.engine, P1).includes(entered[0]), false);
  assert.deepEqual(handOf(b.engine, P1), [], "nothing was drawn");
  assert.equal(ready(b.engine, P1), readyBefore, "the character was put into play, not deployed: no resources spent");
  const reveals = revealLog(b.engine);
  assert.equal(reveals.length, 1, "one reveal");
  assert.deepEqual(reveals[0].cardIds, entered, "the revealed card is the one that entered play");
  assert.equal(reveals[0].viewerId, "all", "revealed to everyone");
});

clause(BOP, "0:ability:bop-gotime", "printed card: a warlord location with no subtype, structure 5, cost 4 and [R][R][R]; deploys with exactly that, refused one resource short or with only two [R]", () => {
  const mkBop = (rage: number, greed: number): Board => duo([{ key: "bop", def: printing(BOP), owner: P1, zone: "hand" }, ...bank("rage", rage, P1), ...bank("greed", greed, P1)]);
  const ok = mkBop(3, 1);
  const before = ready(ok.engine, P1);
  play(ok.engine, P1, ok.id("bop"));
  assert.equal(zoneOf(ok.engine, ok.id("bop")), "play", "deployed with exactly [R][R][R] among four resources");
  assert.equal(before - ready(ok.engine, P1), 4, "printed cost 4 paid");
  identity(ok, "bop", "location", "warlord", []);
  assert.equal(ok.engine.getStat(ok.id("bop"), "structure"), 5, "printed structure 5");
  const short = mkBop(3, 0);
  refused(() => play(short.engine, P1, short.id("bop")), "3 resources for cost 4");
  assert.equal(zoneOf(short.engine, short.id("bop")), "hand");
  const twoR = mkBop(2, 4);
  refused(() => play(twoR.engine, P1, twoR.id("bop")), "only two [R] for [R][R][R]", /threshold/i);
  assert.equal(zoneOf(twoR.engine, twoR.id("bop")), "hand");
});

clause(BOP, "0:ability:bop-gotime", "the deck is shuffled before the reveal: over 12 seeds the card put into play varies and is not always the original top", () => {
  const picked = new Set<number>();
  let originalTop = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const b = bopBoard({ seed });
    const orig = deckOf(b.engine, P1);
    goTime(b);
    const entered = enteredFrom(b, orig);
    assert.equal(entered.length, 1);
    const index = orig.indexOf(entered[0]);
    picked.add(index);
    if (index === 0) originalTop++;
    assert.deepEqual([...deckOf(b.engine, P1), ...entered].sort(), [...orig].sort(), "the deck keeps every other card");
  }
  assert.ok(picked.size >= 4, `a shuffled deck reveals varied cards (saw ${[...picked].join(",")})`);
  assert.ok(originalTop < 12, "the original top card is not always the one revealed");
});

clause(BOP, "0:ability:bop-gotime", "a revealed non-character (item, location or tactic) goes to the bottom of the deck instead: nothing enters play and the deck keeps its size", () => {
  for (const kind of ["item", "location", "tactic"] as const) {
    const b = bopBoard({ kind, seed: 3 });
    const orig = deckOf(b.engine, P1);
    const playBefore = [...b.engine.state.players[P1].play];
    goTime(b);
    assert.equal(pending(b.engine), undefined);
    assert.equal(isDepleted(b.engine, b.id("bop")), true, `${kind}: still depleted (cost paid)`);
    const reveals = revealLog(b.engine);
    assert.equal(reveals.length, 1, `${kind}: revealed`);
    const [revealed] = reveals[0].cardIds;
    assert.deepEqual([...b.engine.state.players[P1].play], playBefore, `${kind}: nothing entered play`);
    const deck = deckOf(b.engine, P1);
    assert.equal(deck.length, 8, `${kind}: the deck keeps its size`);
    assert.equal(deck[deck.length - 1], revealed, `${kind}: the revealed card is on the bottom`);
    assert.equal(zoneOf(b.engine, revealed), "deck");
    assert.deepEqual([...deck].sort(), [...orig].sort());
  }
});

clause(BOP, "0:ability:bop-gotime", "both branches follow the revealed card's type: over 16 seeds of a mixed deck characters enter play and everything else goes to the bottom", () => {
  let chars = 0;
  let others = 0;
  for (let seed = 1; seed <= 16; seed++) {
    const defs = Array.from({ length: 8 }, (_, i) => (i % 2 === 0 ? deckCard("character", i) : deckCard("item", i)));
    const b = bopBoard({ deck: defs, seed });
    const orig = deckOf(b.engine, P1);
    goTime(b);
    const [revealed] = revealLog(b.engine)[0].cardIds;
    if (orig.indexOf(revealed) % 2 === 0) {
      chars++;
      assert.equal(zoneOf(b.engine, revealed), "play", `seed ${seed}: the character entered play`);
      assert.equal(deckOf(b.engine, P1).length, 7);
    } else {
      others++;
      assert.equal(zoneOf(b.engine, revealed), "deck", `seed ${seed}: the item stayed in the deck`);
      assert.equal(deckOf(b.engine, P1)[7], revealed, `seed ${seed}: on the bottom`);
      assert.equal(deckOf(b.engine, P1).length, 8);
    }
  }
  assert.ok(chars > 0 && others > 0, `both branches were exercised (${chars} characters, ${others} others)`);
});

clause(BOP, "0:ability:bop-gotime", "'put into play' means it really enters play: a revealed Battle-Ready Back-Breaker runs its enters-play trigger", () => {
  const b = bopBoard({ deck: [printing(BB)] });
  goTime(b);
  assert.equal(pending(b.engine)?.kind, "selectTargets", "Back-Breaker's 'when this card enters play' trigger fired");
  answerPending(b.engine, "selectTargets", { selected: { pick: [b.id("foe")] } });
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("dk0")), "play");
  assert.equal(isDepleted(b.engine, b.id("foe")), true, "its trigger depleted the picked character");
});

clause(BOP, "0:ability:bop-gotime", "can only be used while ready: a depleted Barracks is refused and the deck is untouched (control: ready works)", () => {
  const b = bopBoard({ depleted: true });
  const orig = deckOf(b.engine, P1);
  refused(() => goTime(b), "deplete cost can't be paid twice");
  assert.deepEqual(deckOf(b.engine, P1), orig, "no shuffle, no reveal");
  assert.equal(revealLog(b.engine).length, 0);
  const ok = bopBoard();
  goTime(ok);
  assert.equal(isDepleted(ok.engine, ok.id("bop")), true);
});

clause(BOP, "0:ability:bop-gotime", "the character can attack the turn it enters play, although a character deployed normally that turn cannot", () => {
  const b = bopBoard({ cards: [{ key: "fresh", def: chr("Fresh", { cost: 0 }), owner: P1, zone: "hand" }] });
  const orig = deckOf(b.engine, P1);
  play(b.engine, P1, b.id("fresh"));
  assert.equal(zoneOf(b.engine, b.id("fresh")), "play");
  refused(() => declareAttackBy(b.engine, P1, [b.id("fresh")]), "deployed this turn: summoning sick");
  goTime(b);
  const [entered] = enteredFrom(b, orig);
  const nextTop = deckOf(b.engine, P1)[0];
  assert.equal(b.engine.getKeywords(nextTop).includes("aggro"), false, "the grant must not land on the deck's next top card");
  declareAttackBy(b.engine, P1, [entered]);
  assert.deepEqual(battleOf(b.engine)?.attackingParty, [entered], "the Barracks character is attacking");
});

clause(BOP, "0:ability:bop-gotime", "'can attack' lasts the whole turn: after another battle of mine has finished, the Barracks character can still attack", () => {
  const b = bopBoard({ cards: [{ key: "atk", def: chr("Atk"), owner: P1, zone: "play" }] });
  const orig = deckOf(b.engine, P1);
  goTime(b);
  const [entered] = enteredFrom(b, orig);
  declareAttackBy(b.engine, P1, [b.id("atk")]);
  declareBlockers(b.engine, P2, []);
  finishBattle(b.engine);
  assert.equal(b.engine.state.battle, undefined, "the first battle is over");
  declareAttackBy(b.engine, P1, [entered]);
  assert.deepEqual(battleOf(b.engine)?.attackingParty, [entered], "the Barracks character attacks in a second battle of the same turn");
});

clause(BOP, "0:ability:bop-gotime", "if that character is still in play at the end of the turn it is removed from the game (not discarded); older characters stay", () => {
  const b = bopBoard({ cards: [{ key: "old", def: chr("Old"), owner: P1, zone: "play" }] });
  const orig = deckOf(b.engine, P1);
  goTime(b);
  const [entered] = enteredFrom(b, orig);
  assert.equal(zoneOf(b.engine, entered), "play", "still in play during the turn");
  endTurn(b.engine, P1);
  assert.equal(zoneOf(b.engine, entered), "removed", "removed from the game at the end of the turn");
  assert.equal(discardOf(b.engine, P1).includes(entered), false);
  assert.equal(zoneOf(b.engine, b.id("old")), "play", "a character already in play is not removed");
});

clause(BOP, "0:ability:bop-gotime", "if that character leaves play (destroyed by a tactic) it is removed from the game instead of staying in the discard", () => {
  const b = bopBoard({ cards: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  const orig = deckOf(b.engine, P1);
  goTime(b);
  const [entered] = enteredFrom(b, orig);
  play(b.engine, P1, b.id("kill"), { selected: { t: [entered] } });
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, entered), "removed", "gone from the game");
  assert.equal(discardOf(b.engine, P1).includes(entered), false, "not in the discard pile");
});

clause(BOP, "0:ability:bop-gotime", "if that character is returned to its owner's hand it leaves play too: it is removed from the game instead of ending up in hand", () => {
  const bounce = tactic({
    name: "Bounce",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "b",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    }
  });
  const b = bopBoard({ cards: [{ key: "bounce", def: bounce, owner: P1, zone: "hand" }] });
  const orig = deckOf(b.engine, P1);
  goTime(b);
  const [entered] = enteredFrom(b, orig);
  play(b.engine, P1, b.id("bounce"), { selected: { t: [entered] } });
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, entered), "removed", "removed from the game rather than returned to hand");
  assert.equal(handOf(b.engine, P1).includes(entered), false);
});

clause(BOP, "0:ability:bop-gotime", "if that character dies to lethal damage (state-based death, not a destroy effect) it is removed from the game too", () => {
  const zap = tactic({
    name: "Zap",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "z",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 5 }]
        }
      ]
    }
  });
  const b = bopBoard({
    deck: Array.from({ length: 4 }, (_, i) => deckCard("character", i, { life: 3 })),
    cards: [{ key: "zap", def: zap, owner: P1, zone: "hand" }]
  });
  const orig = deckOf(b.engine, P1);
  goTime(b);
  const [entered] = enteredFrom(b, orig);
  play(b.engine, P1, b.id("zap"), { selected: { t: [entered] } });
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, entered), "removed", "killed by damage: removed from the game");
  assert.equal(discardOf(b.engine, P1).includes(entered), false);
});

clause(BOP, "1:ability:bop-anycost", "pays 2 resources, inflicts 3 damage to Barracks itself, and restores it (depleted becomes ready)", () => {
  const b = bopBoard({ depleted: true, rage: 3 });
  const before = ready(b.engine, P1);
  activate(b.engine, P1, b.id("bop"), "bop-anycost");
  assert.equal(pending(b.engine), undefined);
  assert.equal(before - ready(b.engine, P1), 2, "pay 2");
  assert.equal(dmg(b.engine, b.id("bop")), 3, "inflict 3 damage to this card");
  assert.equal(isDepleted(b.engine, b.id("bop")), false, "restored");
  assert.equal(zoneOf(b.engine, b.id("bop")), "play", "3 damage on structure 5 does not destroy it");
});

clause(BOP, "1:ability:bop-anycost", "lets GO TIME! be used twice in one turn: two characters enter play and both are removed from the game at the end of the turn", () => {
  const b = bopBoard({ rage: 2 });
  const orig = deckOf(b.engine, P1);
  goTime(b);
  activate(b.engine, P1, b.id("bop"), "bop-anycost");
  assert.equal(isDepleted(b.engine, b.id("bop")), false);
  goTime(b);
  const entered = enteredFrom(b, orig);
  assert.equal(entered.length, 2, "two characters came from the deck");
  assert.equal(isDepleted(b.engine, b.id("bop")), true);
  assert.equal(dmg(b.engine, b.id("bop")), 3);
  endTurn(b.engine, P1);
  for (const c of entered) assert.equal(zoneOf(b.engine, c), "removed");
});

clause(BOP, "1:ability:bop-anycost", "is refused when 2 resources can't be paid (1 of 2), changing nothing", () => {
  const b = bopBoard({ depleted: true, rage: 1 });
  refused(() => activate(b.engine, P1, b.id("bop"), "bop-anycost"), "pay 2 with only 1 resource");
  assert.equal(dmg(b.engine, b.id("bop")), 0, "no damage inflicted");
  assert.equal(isDepleted(b.engine, b.id("bop")), true, "not restored");
  assert.equal(ready(b.engine, P1), 1);
});

clause(BOP, "1:ability:bop-anycost", "the 3 damage is real: with 2 damage already on it (structure 5) the cost destroys Barracks, and a second use from full health also finishes it", () => {
  const hurt = bopBoard({ depleted: true, rage: 2, damage: 2 });
  activate(hurt.engine, P1, hurt.id("bop"), "bop-anycost");
  assert.equal(zoneOf(hurt.engine, hurt.id("bop")), "discard", "2 + 3 damage reaches structure 5");
  const twice = bopBoard({ depleted: true, rage: 4 });
  activate(twice.engine, P1, twice.id("bop"), "bop-anycost");
  assert.equal(zoneOf(twice.engine, twice.id("bop")), "play");
  activate(twice.engine, P1, twice.id("bop"), "bop-anycost");
  assert.equal(zoneOf(twice.engine, twice.id("bop")), "discard", "3 + 3 damage destroys it");
});

clause(BOP, "1:ability:bop-anycost", "has no 'only when depleted' restriction: used while ready it still pays 2 and takes 3 damage, and stays ready", () => {
  const b = bopBoard({ rage: 2 });
  const before = ready(b.engine, P1);
  activate(b.engine, P1, b.id("bop"), "bop-anycost");
  assert.equal(before - ready(b.engine, P1), 2);
  assert.equal(dmg(b.engine, b.id("bop")), 3);
  assert.equal(isDepleted(b.engine, b.id("bop")), false);
});

// =====================================================================================
// Battle-Ready Back-Breaker — character, warlord, berserker, cost 4, [R][R], str 3 / spd 3 / life 2
// When this card enters play you may pick a character. If you do, deplete that character.
// =====================================================================================

function bbBoard(o: { zone?: "hand" | "play"; rage?: number; greed?: number; cards?: CardPlacement[] } = {}) {
  return duo([
    { key: "bb", def: printing(BB), owner: P1, zone: o.zone ?? "hand" },
    { key: "mine", def: chr("Mine"), owner: P1, zone: "play" },
    { key: "foe", def: chr("Foe"), owner: P2, zone: "play" },
    { key: "foe2", def: chr("Foe2"), owner: P2, zone: "play" },
    { key: "it", def: item({ name: "Gadget" }), owner: P2, zone: "play" },
    { key: "lc", def: location({ name: "Tower", structure: 4 }), owner: P2, zone: "play" },
    { key: "hc", def: chr("InHand"), owner: P2, zone: "hand" },
    { key: "dc", def: chr("InDiscard"), owner: P2, zone: "discard" },
    ...bank("rage", o.rage ?? 4, P1),
    ...bank("greed", o.greed ?? 0, P1),
    ...(o.cards ?? [])
  ]);
}
const deployBB = (b: Board): void => {
  play(b.engine, P1, b.id("bb"), {});
  assert.equal(pending(b.engine)?.kind, "selectTargets", "the enters-play trigger asks for a pick");
};
const pickBB = (b: Board, key: string): void => {
  answerPending(b.engine, "selectTargets", { selected: { pick: [b.id(key)] } });
  assert.equal(pending(b.engine), undefined);
};

clause(BB, "0:rule", "deploys for its printed cost 4 and [R][R] with stats str 3 / spd 3 / life 2, refused one resource short or with a single [R]", () => {
  const b = bbBoard({ rage: 4 });
  const before = ready(b.engine, P1);
  deployBB(b);
  pickBB(b, "foe");
  assert.equal(zoneOf(b.engine, b.id("bb")), "play");
  assert.equal(before - ready(b.engine, P1), 4, "four resources spent");
  assert.equal(b.engine.getStat(b.id("bb"), "strength"), 3);
  assert.equal(b.engine.getStat(b.id("bb"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("bb"), "life"), 2);
  const short = bbBoard({ rage: 3 });
  refused(() => play(short.engine, P1, short.id("bb"), {}), "3 resources for cost 4");
  assert.equal(zoneOf(short.engine, short.id("bb")), "hand");
  const oneR = bbBoard({ rage: 1, greed: 5 });
  refused(() => play(oneR.engine, P1, oneR.id("bb"), {}), "only one [R]", /threshold/i);
  assert.equal(zoneOf(oneR.engine, oneR.id("bb")), "hand");
  const exact = bbBoard({ rage: 2, greed: 2 });
  deployBB(exact);
  pickBB(exact, "foe");
  assert.equal(zoneOf(exact.engine, exact.id("bb")), "play", "control: exactly [R][R] among four resources is enough");
});

clause(BB, "0:rule", "when it enters play I may pick an opponent's character and that character is depleted; nothing else is", () => {
  const b = bbBoard();
  deployBB(b);
  pickBB(b, "foe");
  assert.equal(isDepleted(b.engine, b.id("foe")), true);
  assert.equal(isDepleted(b.engine, b.id("foe2")), false, "an unpicked opposing character is not depleted");
  assert.equal(isDepleted(b.engine, b.id("mine")), false, "my other character is not depleted");
  assert.equal(isDepleted(b.engine, b.id("bb")), false, "Back-Breaker itself is not depleted");
});

clause(BB, "0:rule", "printed type line: a warlord berserker character", () => {
  identity(bbBoard(), "bb", "character", "warlord", ["berserker"]);
});

clause(BB, "0:rule", "'you may pick a character': at most ONE character, two are refused", () => {
  const b = bbBoard();
  deployBB(b);
  refused(() => answerPending(b.engine, "selectTargets", { selected: { pick: [b.id("foe"), b.id("foe2")] } }), "two characters picked");
  assert.equal(pending(b.engine)?.kind, "selectTargets", "the pick is still open");
  pickBB(b, "foe");
  assert.equal(isDepleted(b.engine, b.id("foe")), true, "control: one pick works");
  assert.equal(isDepleted(b.engine, b.id("foe2")), false, "the other character is not depleted");
});

clause(BB, "0:rule", "any character may be picked: one of mine is depleted too", () => {
  const b = bbBoard();
  deployBB(b);
  pickBB(b, "mine");
  assert.equal(isDepleted(b.engine, b.id("mine")), true);
  assert.equal(isDepleted(b.engine, b.id("foe")), false);
});

clause(BB, "0:rule", "Back-Breaker itself is a legal pick (it is a character in play when the trigger resolves) and depletes itself", () => {
  const b = bbBoard();
  deployBB(b);
  pickBB(b, "bb");
  assert.equal(isDepleted(b.engine, b.id("bb")), true);
  assert.equal(isDepleted(b.engine, b.id("foe")), false);
});

clause(BB, "0:rule", "'you may': declining the pick depletes nothing and Back-Breaker still enters play", () => {
  const b = bbBoard();
  deployBB(b);
  answerPending(b.engine, "selectTargets", { selected: { pick: [] } });
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("bb")), "play");
  for (const key of ["mine", "foe", "foe2", "bb"]) assert.equal(isDepleted(b.engine, b.id(key)), false, `${key} not depleted`);
});

clause(BB, "0:rule", "only characters in play can be picked: an item, a location, a faction, a card in hand and a card in the discard are refused", () => {
  const b = bbBoard();
  deployBB(b);
  const picks: Array<[string, CardInstanceId]> = [
    ["an item", b.id("it")],
    ["a location", b.id("lc")],
    ["the opposing faction", b.engine.state.players[P2].factionId!],
    ["my faction", b.engine.state.players[P1].factionId!],
    ["a character in hand", b.id("hc")],
    ["a character in the discard", b.id("dc")]
  ];
  for (const [why, target] of picks) {
    refused(() => answerPending(b.engine, "selectTargets", { selected: { pick: [target] } }), why);
    assert.equal(pending(b.engine)?.kind, "selectTargets", `${why}: the pick is still open`);
  }
  pickBB(b, "foe2");
  assert.equal(isDepleted(b.engine, b.id("foe2")), true, "control: a character in play is accepted");
  assert.equal(isDepleted(b.engine, b.id("it")), false);
  assert.equal(isDepleted(b.engine, b.id("lc")), false);
});

clause(BB, "0:rule", "picking an already-depleted character leaves it depleted and resolves cleanly", () => {
  const b = bbBoard({ cards: [{ key: "tired", def: chr("Tired"), owner: P2, zone: "play", depleted: true }] });
  deployBB(b);
  pickBB(b, "tired");
  assert.equal(isDepleted(b.engine, b.id("tired")), true);
  assert.equal(zoneOf(b.engine, b.id("tired")), "play");
});

clause(BB, "0:rule", "only triggers when this card enters play: another character entering later, mine or theirs, does not prompt", () => {
  const b = bbBoard({
    zone: "play",
    cards: [
      { key: "plain", def: chr("Plain", { cost: 1 }), owner: P1, zone: "hand" },
      { key: "p2hand", def: chr("P2Hand", { cost: 0 }), owner: P2, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("plain"));
  assert.equal(zoneOf(b.engine, b.id("plain")), "play");
  assert.equal(pending(b.engine), undefined, "no prompt: only the Back-Breaker's own entry triggers it");
  for (const key of ["mine", "foe", "foe2", "bb", "plain"]) assert.equal(isDepleted(b.engine, b.id(key)), false, `${key} not depleted`);
});

// =====================================================================================
// Bloating Bask — character, warlord, dragon, cost 4, [R], str 4 / spd 2 / life 3
// [R][R][R][R][R][R]: This card gains 1 strength, 1 life and 1 speed.
// =====================================================================================

const BASK = "3db20240-f5a5-4fd9-925d-39b32cab7618";
const DC = "c842afad-8ee7-4e59-bb42-f06f51bf7bf6";

function baskBoard(o: { rage?: number; greed?: number; foeRage?: number; cards?: CardPlacement[]; baskOwner?: PlayerId } = {}) {
  return duo([
    { key: "bask", def: printing(BASK), owner: o.baskOwner ?? P1, controller: P1, zone: "play" },
    { key: "other", def: chr("Other"), owner: P1, zone: "play" },
    ...bank("rage", o.rage ?? 0, P1),
    ...bank("greed", o.greed ?? 0, P1),
    ...bank("rage", o.foeRage ?? 0, P2),
    ...(o.cards ?? [])
  ]);
}
const baskStats = (b: Board): number[] => ["strength", "speed", "life"].map((s) => b.engine.getStat(b.id("bask"), s as "strength"));

clause(BASK, "0:rule@rrrrrr", "with six [R] it gains 1 strength, 1 speed and 1 life: 5 / 3 / 4 instead of the printed 4 / 2 / 3", () => {
  const b = baskBoard({ rage: 6 });
  assert.deepEqual(baskStats(b), [5, 3, 4]);
  assert.equal(b.engine.getStat(b.id("other"), "strength"), 2, "another character gains nothing");
});

clause(BASK, "0:rule@rrrrrr", "printed card: a warlord dragon character, cost 4 and [R]; deploys with one [R] among four resources, refused one short or with no [R], and enters as 4 / 2 / 3", () => {
  const mkBask = (rage: number, greed: number): Board => duo([{ key: "bask", def: printing(BASK), owner: P1, zone: "hand" }, ...bank("rage", rage, P1), ...bank("greed", greed, P1)]);
  const ok = mkBask(1, 3);
  const before = ready(ok.engine, P1);
  play(ok.engine, P1, ok.id("bask"));
  assert.equal(zoneOf(ok.engine, ok.id("bask")), "play", "deployed with a single [R] among four resources");
  assert.equal(before - ready(ok.engine, P1), 4, "printed cost 4 paid");
  identity(ok, "bask", "character", "warlord", ["dragon"]);
  assert.deepEqual(baskStats(ok), [4, 2, 3], "printed 4 / 2 / 3");
  const short = mkBask(1, 2);
  refused(() => play(short.engine, P1, short.id("bask")), "3 resources for cost 4");
  assert.equal(zoneOf(short.engine, short.id("bask")), "hand");
  const noR = mkBask(0, 4);
  refused(() => play(noR.engine, P1, noR.id("bask")), "no [R]", /threshold/i);
  assert.equal(zoneOf(noR.engine, noR.id("bask")), "hand");
});

clause(BASK, "0:rule@rrrrrr", "with fewer than six [R] it keeps its printed 4 / 2 / 3 (five, one, none)", () => {
  for (const rage of [5, 1, 0]) assert.deepEqual(baskStats(baskBoard({ rage })), [4, 2, 3], `${rage} [R]`);
});

clause(BASK, "0:rule@rrrrrr", "the bonus does not scale: twelve [R] still gives only +1 / +1 / +1", () => {
  assert.deepEqual(baskStats(baskBoard({ rage: 12 })), [5, 3, 4]);
});

clause(BASK, "0:rule@rrrrrr", "only [R] counts: six resources that are not all [R] (five [R] + [G], three [R] + three [G], six [G]) do not switch it on", () => {
  assert.deepEqual(baskStats(baskBoard({ rage: 5, greed: 1 })), [4, 2, 3]);
  assert.deepEqual(baskStats(baskBoard({ rage: 3, greed: 3 })), [4, 2, 3]);
  assert.deepEqual(baskStats(baskBoard({ rage: 0, greed: 6 })), [4, 2, 3]);
  assert.deepEqual(baskStats(baskBoard({ rage: 6, greed: 3 })), [5, 3, 4], "control: six [R] plus other icons still counts");
});

clause(BASK, "0:rule@rrrrrr", "the opponent's [R] don't count: I have five and they have six, so it stays 4 / 2 / 3", () => {
  assert.deepEqual(baskStats(baskBoard({ rage: 5, foeRage: 6 })), [4, 2, 3]);
});

clause(BASK, "0:rule@rrrrrr", "the threshold is its controller's: a Bask owned by the opponent but controlled by me counts MY six [R]", () => {
  assert.deepEqual(baskStats(baskBoard({ rage: 6, baskOwner: P2 })), [5, 3, 4]);
  assert.deepEqual(baskStats(baskBoard({ rage: 0, foeRage: 6, baskOwner: P2 })), [4, 2, 3], "the owner's six [R] don't help while I control it");
});

clause(BASK, "0:rule@rrrrrr", "switches off again when the [R] go away: three banks plus Cadencer's AGITATE (+3 [R] this turn) turn it on, and it's off after the turn ends", () => {
  const b = baskBoard({
    rage: 3,
    cards: [{ key: "dc", def: printing(DC), owner: P1, zone: "play" }, ...volition(1)]
  });
  assert.deepEqual(baskStats(b), [4, 2, 3], "only three [R]");
  activate(b.engine, P1, b.id("dc"), "dc-agitate");
  assert.equal(b.engine.getThresholds(P1).rage, 6, "three banks + the granted PROVIDES [R][R][R]");
  assert.deepEqual(baskStats(b), [5, 3, 4], "six [R]: switched on");
  endTurn(b.engine, P1);
  assert.equal(b.engine.getThresholds(P1).rage, 3, "the grant ended with the turn");
  assert.deepEqual(baskStats(b), [4, 2, 3], "and the bonus is off again");
});

// =====================================================================================
// Bloody Fisted Fanatic — character, warlord, fighter, cost 7, [R][R][R], str 8 / spd 3 / life 4 — no rules text
// =====================================================================================

const FANATIC = "ea07095a-1dfc-453c-915d-eb72106b5b4e";
function fanaticBoard(o: { rage?: number; greed?: number } = {}) {
  return duo([{ key: "bff", def: printing(FANATIC), owner: P1, zone: "hand" }, ...bank("rage", o.rage ?? 0, P1), ...bank("greed", o.greed ?? 0, P1)]);
}

clause(FANATIC, "vanilla", "deploys for exactly its printed cost 7 (seven resources spent) with printed stats str 8 / spd 3 / life 4, no keywords, no abilities, nothing to pick", () => {
  const b = fanaticBoard({ rage: 3, greed: 5 });
  const before = ready(b.engine, P1);
  play(b.engine, P1, b.id("bff"));
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("bff")), "play");
  assert.equal(before - ready(b.engine, P1), 7, "seven resources spent, no more");
  assert.deepEqual(b.engine.getCardTypes(b.id("bff")), ["character"]);
  assert.equal(b.engine.getStat(b.id("bff"), "strength"), 8);
  assert.equal(b.engine.getStat(b.id("bff"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("bff"), "life"), 4);
  assert.deepEqual(b.engine.getKeywords(b.id("bff")), [], "no keywords");
  assert.deepEqual(
    b.engine.getAvailableActivatedAbilities(P1).filter((a) => a.cardId === b.id("bff")),
    [],
    "no activated abilities"
  );
});

clause(FANATIC, "vanilla", "printed type line: a warlord fighter character", () => {
  identity(fanaticBoard(), "bff", "character", "warlord", ["fighter"]);
});

clause(FANATIC, "vanilla", "is refused one resource short (6 of 7) and stays in hand", () => {
  const b = fanaticBoard({ rage: 3, greed: 3 });
  refused(() => play(b.engine, P1, b.id("bff")), "6 resources for cost 7");
  assert.equal(zoneOf(b.engine, b.id("bff")), "hand");
  assert.equal(ready(b.engine, P1), 6, "nothing was paid");
});

clause(FANATIC, "vanilla", "needs [R][R][R]: plenty of resources with fewer than three [R] is refused (control: exactly three [R])", () => {
  const two = fanaticBoard({ rage: 2, greed: 8 });
  refused(() => play(two.engine, P1, two.id("bff")), "only two [R]", /threshold/i);
  assert.equal(zoneOf(two.engine, two.id("bff")), "hand");
  const none = fanaticBoard({ greed: 10 });
  refused(() => play(none.engine, P1, none.id("bff")), "no [R] at all", /threshold/i);
  assert.equal(zoneOf(none.engine, none.id("bff")), "hand");
  const ok = fanaticBoard({ rage: 3, greed: 4 });
  play(ok.engine, P1, ok.id("bff"));
  assert.equal(zoneOf(ok.engine, ok.id("bff")), "play", "control: [R][R][R] and seven resources");
});

// =====================================================================================
// Confrontational Conflagration — tactic, warlord, cost 1, [R]
// EXTRA COST: Play this only during your turn not during a battle. Pick a character you control. Pick a
// character an opponent controls. You may pick a location. -- If the picked character you control is a
// "dragon", X is 2 times its strength, otherwise X is its strength. Inflict X damage to each picked card.
// -- FLIP UP: 1 [R][R][R]
// =====================================================================================

const CONF = "25d8789e-b481-4c1d-aae5-8c3cb2d22786";

function confBoard(o: { zone?: "hand" | "play"; faceDown?: boolean; rage?: number; greed?: number; active?: PlayerId; mine?: Partial<CardDefinition>; theirs?: Partial<CardDefinition>; cards?: CardPlacement[] } = {}) {
  return duo(
    [
      { key: "cf", def: printing(CONF), owner: P1, zone: o.zone ?? "hand", faceDown: o.faceDown ? true : undefined },
      { key: "mine", def: chr("Mine", { strength: 3, life: 10, ...o.mine }), owner: P1, zone: "play" },
      { key: "theirs", def: chr("Theirs", { strength: 5, life: 10, ...o.theirs }), owner: P2, zone: "play" },
      { key: "loc", def: location({ name: "Tower", structure: 20 }), owner: P2, zone: "play" },
      { key: "by1", def: chr("MyBystander", { life: 10 }), owner: P1, zone: "play" },
      { key: "by2", def: chr("TheirBystander", { life: 10 }), owner: P2, zone: "play" },
      { key: "loc2", def: location({ name: "MyTower", structure: 20 }), owner: P1, zone: "play" },
      { key: "it1", def: item({ name: "MyGadget" }), owner: P1, zone: "play" },
      { key: "it2", def: item({ name: "TheirGadget" }), owner: P2, zone: "play" },
      { key: "hc1", def: chr("MyInHand"), owner: P1, zone: "hand" },
      { key: "hc2", def: chr("TheirInHand"), owner: P2, zone: "hand" },
      { key: "dc2", def: chr("TheirInDiscard"), owner: P2, zone: "discard" },
      ...bank("rage", o.rage ?? 3, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...(o.cards ?? [])
    ],
    { active: o.active }
  );
}
const confSel = (b: Board, mine: string[], theirs: string[], loc?: string[] | null): Record<string, CardInstanceId[]> => ({
  mine: mine.map((k) => b.id(k)),
  theirs: theirs.map((k) => b.id(k)),
  ...(loc ? { loc: loc.map((k) => b.id(k)) } : {})
});
const confCast = (b: Board, mine = "mine", theirs = "theirs", loc: string[] | null = ["loc"]): void =>
  play(b.engine, P1, b.id("cf"), { selected: confSel(b, [mine], [theirs], loc) });
const untouched = (b: Board, keys: string[]): void => {
  for (const k of keys) assert.equal(dmg(b.engine, b.id(k)), 0, `${k} takes no damage`);
};

clause(CONF, "0:ability", "a non-dragon: X is its strength, and the character I control, the opposing character and the picked location each take X (strength 3, then 6); the printed cost 1 is paid and it goes to the discard", () => {
  for (const strength of [3, 6]) {
    const b = confBoard({ mine: { strength } });
    const before = ready(b.engine, P1);
    confCast(b);
    assert.equal(pending(b.engine), undefined);
    assert.equal(dmg(b.engine, b.id("mine")), strength, "my own character takes X");
    assert.equal(dmg(b.engine, b.id("theirs")), strength, "the opposing character takes X (its own strength 5 is irrelevant)");
    assert.equal(dmg(b.engine, b.id("loc")), strength, "the picked location takes X");
    untouched(b, ["by1", "by2", "loc2"]);
    assert.equal(before - ready(b.engine, P1), 1, "printed cost 1 paid");
    assert.equal(zoneOf(b.engine, b.id("cf")), "discard");
  }
});

clause(CONF, "0:ability", "printed type line: a warlord tactic with no subtype", () => {
  identity(confBoard(), "cf", "tactic", "warlord", []);
});

clause(CONF, "0:ability", "'you may pick a location': at most ONE location, two are refused", () => {
  const b = confBoard();
  refused(() => play(b.engine, P1, b.id("cf"), { selected: confSel(b, ["mine"], ["theirs"], ["loc", "loc2"]) }), "two locations picked");
  assert.equal(zoneOf(b.engine, b.id("cf")), "hand");
  untouched(b, ["mine", "theirs", "loc", "loc2"]);
  confCast(b, "mine", "theirs", ["loc"]);
  assert.equal(dmg(b.engine, b.id("loc")), 3, "control: one location works");
  assert.equal(dmg(b.engine, b.id("loc2")), 0, "the other location is untouched");
});

clause(CONF, "0:ability", "the location is optional: with none picked only the two characters take damage and nothing is left pending", () => {
  const b = confBoard();
  confCast(b, "mine", "theirs", null);
  assert.equal(pending(b.engine), undefined);
  assert.equal(dmg(b.engine, b.id("mine")), 3);
  assert.equal(dmg(b.engine, b.id("theirs")), 3);
  untouched(b, ["loc", "loc2", "by1", "by2"]);
  assert.equal(zoneOf(b.engine, b.id("cf")), "discard");
});

clause(CONF, "0:ability", "the picked location may be my own as well as the opponent's", () => {
  const b = confBoard();
  confCast(b, "mine", "theirs", ["loc2"]);
  assert.equal(dmg(b.engine, b.id("loc2")), 3);
  untouched(b, ["loc"]);
  assert.equal(dmg(b.engine, b.id("theirs")), 3);
});

clause(CONF, "0:ability", "if my picked character is a \"dragon\", X is 2 times its strength (3 gives 6, 2 gives 4, a second subtype still counts); other subtypes (drake, dragonling, none) are not doubled", () => {
  const cases: Array<[string[], number, number]> = [
    [["dragon"], 3, 6],
    [["dragon"], 2, 4],
    [["soldier", "dragon"], 3, 6],
    [["drake"], 3, 3],
    [["dragonling"], 3, 3],
    [[], 3, 3]
  ];
  for (const [subtype, strength, x] of cases) {
    const b = confBoard({ mine: { subtype, strength } });
    confCast(b);
    const label = `${JSON.stringify(subtype)} strength ${strength}`;
    assert.equal(dmg(b.engine, b.id("theirs")), x, `${label}: opposing character takes ${x}`);
    assert.equal(dmg(b.engine, b.id("mine")), x, `${label}: my character takes ${x}`);
    assert.equal(dmg(b.engine, b.id("loc")), x, `${label}: the location takes ${x}`);
  }
});

clause(CONF, "0:ability", "'its strength' is the current strength: a Bloating Bask (printed 4, 5 with six [R]) doubles to 10, not 8", () => {
  const b = confBoard({ rage: 6, theirs: { life: 20 }, cards: [{ key: "bask", def: printing(BASK), owner: P1, zone: "play" }] });
  assert.equal(b.engine.getStat(b.id("bask"), "strength"), 5);
  confCast(b, "bask");
  assert.equal(dmg(b.engine, b.id("theirs")), 10, "2 x current strength 5");
  assert.equal(dmg(b.engine, b.id("loc")), 10);
  assert.equal(zoneOf(b.engine, b.id("bask")), "discard", "the dragon takes the 10 itself and dies (life 4)");
});

clause(CONF, "0:ability", "only MY picked character's subtype counts: an opposing dragon is not doubled, and X ignores the opposing character's strength", () => {
  const b = confBoard({ theirs: { subtype: ["dragon"], strength: 5 } });
  confCast(b);
  assert.equal(dmg(b.engine, b.id("theirs")), 3);
  assert.equal(dmg(b.engine, b.id("loc")), 3);
});

clause(CONF, "0:ability", "each picked card means mine too: a character of mine with life 3 and strength 3 is destroyed while the opposing character and location still take 3", () => {
  const b = confBoard({ mine: { strength: 3, life: 3 } });
  confCast(b);
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard", "my own character is destroyed by its own strength");
  assert.equal(dmg(b.engine, b.id("theirs")), 3);
  assert.equal(dmg(b.engine, b.id("loc")), 3);
});

clause(CONF, "0:ability", "the opposing character is destroyed when X reaches its life, and mine still takes the damage", () => {
  const b = confBoard({ theirs: { life: 2 } });
  confCast(b);
  assert.equal(zoneOf(b.engine, b.id("theirs")), "discard");
  assert.equal(dmg(b.engine, b.id("mine")), 3);
  assert.equal(dmg(b.engine, b.id("loc")), 3);
});

clause(CONF, "0:ability", "play only during your turn: refused on the opponent's turn even in a response window where another tactic works", () => {
  const b = confBoard({
    active: P2,
    cards: [
      { key: "pk", def: killTactic({ name: "FoeKill" }), owner: P2, zone: "hand" },
      { key: "ctl", def: killTactic({ name: "Ctl" }), owner: P1, zone: "hand" }
    ]
  });
  playRaw(b.engine, P2, b.id("pk"), { selected: { t: [b.id("by2")] } });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "I may respond");
  assert.equal(b.engine.state.battle, undefined, "no battle: only the turn restriction applies");
  refused(() => playRaw(b.engine, P1, b.id("cf"), { selected: confSel(b, ["mine"], ["theirs"], ["loc"]) }), "the opponent's turn");
  assert.equal(zoneOf(b.engine, b.id("cf")), "hand");
  untouched(b, ["mine", "theirs", "loc"]);
  playRaw(b.engine, P1, b.id("ctl"), { selected: { t: [b.id("by1")] } });
  assert.equal(b.engine.state.cards[b.id("ctl")].zone === "hand", false, "control: another tactic can be played in that same window");
});

clause(CONF, "0:ability", "play only not during a battle: refused while my own attack is underway (even on my turn), allowed once it is over", () => {
  const b = confBoard({ cards: [{ key: "atk", def: chr("Atk"), owner: P1, zone: "play" }] });
  declareAttackBy(b.engine, P1, [b.id("atk")]);
  assert.ok(battleOf(b.engine), "a battle is underway");
  refused(() => confCast(b), "during a battle");
  assert.equal(zoneOf(b.engine, b.id("cf")), "hand");
  untouched(b, ["mine", "theirs", "loc"]);
  declareBlockers(b.engine, P2, []);
  finishBattle(b.engine);
  assert.equal(b.engine.state.battle, undefined, "the battle is over");
  confCast(b);
  assert.equal(zoneOf(b.engine, b.id("cf")), "discard", "control: after the battle it plays");
  assert.equal(dmg(b.engine, b.id("theirs")), 3);
});

clause(CONF, "0:ability", "play only not during a battle: with priority in my own battle (blockers declared) another tactic can be played but Conflagration is refused for the battle restriction", () => {
  const b = confBoard({
    cards: [
      { key: "atk", def: chr("Atk"), owner: P1, zone: "play" },
      { key: "ctl", def: killTactic({ name: "Ctl" }), owner: P1, zone: "hand" }
    ]
  });
  declareAttackBy(b.engine, P1, [b.id("atk")]);
  declareBlockers(b.engine, P2, []);
  assert.ok(b.engine.state.battle, "a battle is underway");
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "I hold priority, so only the rule can refuse it");
  refused(() => confCast(b), "during a battle", /cannot be deployed right now/);
  assert.equal(zoneOf(b.engine, b.id("cf")), "hand");
  untouched(b, ["mine", "theirs", "loc"]);
  playRaw(b.engine, P1, b.id("ctl"), { selected: { t: [b.id("by2")] } });
  assert.notEqual(zoneOf(b.engine, b.id("ctl")), "hand", "control: another tactic can be played with that same priority");
});

clause(CONF, "0:ability", "costs exactly 1 and needs [R]: no resources, or three [G] and no [R], is refused (control: a single [R])", () => {
  const none = confBoard({ rage: 0 });
  refused(() => confCast(none), "no resources");
  assert.equal(zoneOf(none.engine, none.id("cf")), "hand");
  untouched(none, ["mine", "theirs", "loc"]);
  const noR = confBoard({ rage: 0, greed: 3 });
  refused(() => confCast(noR), "[G] resources but no [R]", /threshold/i);
  assert.equal(zoneOf(noR.engine, noR.id("cf")), "hand");
  const one = confBoard({ rage: 1 });
  confCast(one);
  assert.equal(ready(one.engine, P1), 0, "exactly 1 spent");
  assert.equal(dmg(one.engine, one.id("theirs")), 3);
});

clause(CONF, "0:ability", "the picks are enforced: a character I control (not an opposing, item, location, hand or discard card) for the first, an opposing character for the second, a location for the third", () => {
  const cases: Array<[string, string[], string[], string[] | null]> = [
    ["an opposing character as mine", ["theirs"], ["theirs"], ["loc"]],
    ["an item of mine as mine", ["it1"], ["theirs"], ["loc"]],
    ["a location of mine as mine", ["loc2"], ["theirs"], ["loc"]],
    ["a character of mine in hand as mine", ["hc1"], ["theirs"], ["loc"]],
    ["my own character as theirs", ["mine"], ["by1"], ["loc"]],
    ["an opposing item as theirs", ["mine"], ["it2"], ["loc"]],
    ["an opposing location as theirs", ["mine"], ["loc"], ["loc"]],
    ["an opposing character in hand as theirs", ["mine"], ["hc2"], ["loc"]],
    ["an opposing character in the discard as theirs", ["mine"], ["dc2"], ["loc"]],
    ["a character as the location", ["mine"], ["theirs"], ["by2"]],
    ["an item as the location", ["mine"], ["theirs"], ["it2"]],
    ["no character of mine", [], ["theirs"], ["loc"]],
    ["no opposing character", ["mine"], [], ["loc"]]
  ];
  for (const [why, mine, theirs, loc] of cases) {
    const b = confBoard();
    const before = ready(b.engine, P1);
    refused(() => play(b.engine, P1, b.id("cf"), { selected: confSel(b, mine, theirs, loc) }), why);
    assert.equal(zoneOf(b.engine, b.id("cf")), "hand", `${why}: still in hand`);
    assert.equal(ready(b.engine, P1), before, `${why}: nothing paid`);
    untouched(b, ["mine", "theirs", "loc", "by1", "by2"]);
  }
  const ok = confBoard();
  confCast(ok);
  assert.equal(dmg(ok.engine, ok.id("theirs")), 3, "control: the legal picks work");
});

clause(CONF, "0:ability", "'control' decides the picks, not ownership: a character I control but the opponent owns counts as mine, and one they control but I own counts as theirs", () => {
  const cards: CardPlacement[] = [
    { key: "stolen", def: chr("Stolen", { strength: 4, life: 10 }), owner: P2, controller: P1, zone: "play" },
    { key: "lent", def: chr("Lent", { life: 10 }), owner: P1, controller: P2, zone: "play" }
  ];
  const ok = confBoard({ cards });
  confCast(ok, "stolen", "lent");
  assert.equal(dmg(ok.engine, ok.id("stolen")), 4);
  assert.equal(dmg(ok.engine, ok.id("lent")), 4);
  const bad1 = confBoard({ cards });
  refused(() => confCast(bad1, "lent", "theirs"), "a character I own but they control is not mine");
  const bad2 = confBoard({ cards });
  refused(() => confCast(bad2, "mine", "stolen"), "a character they own but I control is not theirs");
  assert.equal(zoneOf(bad2.engine, bad2.id("cf")), "hand");
});

// --- FLIP UP: 1 [R][R][R] -------------------------------------------------------------

const flipConf = (b: Board, mine = "mine", theirs = "theirs", loc: string[] | null = ["loc"]): void => {
  flipUpAs(b.engine, P1, b.id("cf"), confSel(b, [mine], [theirs], loc));
  resolvePendingResponses(b.engine);
};

clause(CONF, "1:flipUp", "a face-down Conflagration with three [R] banks flips up as a play: it pays 1, deals X to each picked card, and ends in the discard", () => {
  const b = confBoard({ zone: "play", faceDown: true, rage: 3 });
  assert.equal(b.engine.isResource(b.id("cf")), true, "face-down it is a resource");
  assert.equal(ready(b.engine, P1), 4, "three [R] banks plus the face-down card");
  flipConf(b);
  assert.equal(pending(b.engine), undefined);
  assert.equal(dmg(b.engine, b.id("mine")), 3);
  assert.equal(dmg(b.engine, b.id("theirs")), 3);
  assert.equal(dmg(b.engine, b.id("loc")), 3);
  untouched(b, ["by1", "by2", "loc2"]);
  assert.equal(zoneOf(b.engine, b.id("cf")), "discard");
  const left = ready(b.engine, P1);
  assert.ok(left === 2 || left === 3, `4 ready - 1 paid (- the card itself if a bank paid): ${left}`);
});

clause(CONF, "1:flipUp", "the flip-up runs the same effect: a dragon of mine doubles X to 2 times its strength", () => {
  const b = confBoard({ zone: "play", faceDown: true, rage: 3, mine: { subtype: ["dragon"], strength: 3 } });
  flipConf(b);
  assert.equal(dmg(b.engine, b.id("theirs")), 6);
  assert.equal(dmg(b.engine, b.id("mine")), 6);
  assert.equal(dmg(b.engine, b.id("loc")), 6);
});

clause(CONF, "1:flipUp", "needs [R][R][R]: two [R] among plenty of resources is refused, nothing is paid and the card stays face-down", () => {
  const b = confBoard({ zone: "play", faceDown: true, rage: 2, greed: 6 });
  assert.equal(ready(b.engine, P1), 9);
  refused(() => flipConf(b), "only two [R]", /threshold/i);
  assert.equal(b.engine.state.cards[b.id("cf")].faceDown, true);
  assert.equal(zoneOf(b.engine, b.id("cf")), "play");
  assert.equal(ready(b.engine, P1), 9, "nothing paid");
  untouched(b, ["mine", "theirs", "loc"]);
});

clause(CONF, "1:flipUp", "is still refused during a battle (flipping up does not change when a card may be played)", () => {
  const b = confBoard({ zone: "play", faceDown: true, rage: 3, cards: [{ key: "atk", def: chr("Atk"), owner: P1, zone: "play" }] });
  declareAttackBy(b.engine, P1, [b.id("atk")]);
  assert.ok(battleOf(b.engine), "a battle is underway");
  refused(() => flipConf(b), "during a battle");
  assert.equal(b.engine.state.cards[b.id("cf")].faceDown, true);
  untouched(b, ["mine", "theirs", "loc"]);
});

// =====================================================================================
// Discordant Cadencer — character, warlord, soldier, cost 3, [R], str 2 / spd 3 / life 2
// AGITATE -- COST: Pay 1. Lose 2 influence. -- EFFECT: This turn, this card gains " PROVIDES: [R][R][R] ".
// -- [R][R][R][R][R][R]: This card gains 2 strength.
// =====================================================================================

function dcBoard(o: { vol?: number; rage?: number; greed?: number; foeRage?: number; influence?: number; cards?: CardPlacement[] } = {}) {
  return duo(
    [
      { key: "dc", def: printing(DC), owner: P1, zone: "play" },
      { key: "other", def: chr("Other"), owner: P1, zone: "play" },
      ...volition(o.vol ?? 0),
      ...bank("rage", o.rage ?? 0, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...bank("rage", o.foeRage ?? 0, P2),
      ...(o.cards ?? [])
    ],
    { influence: o.influence }
  );
}
const agitate = (b: Board): void => activate(b.engine, P1, b.id("dc"), "dc-agitate");
const rageOf = (b: Board, player: PlayerId = P1): number => b.engine.getThresholds(player).rage ?? 0;
const influenceOf = (b: Board, player: PlayerId = P1): number => b.engine.state.players[player].influence;

clause(DC, "0:ability:dc-agitate", "pays 1 resource and loses 2 influence, then the Cadencer provides [R][R][R] (rage 0 to 3; no other icon, nothing for the opponent)", () => {
  const b = dcBoard({ vol: 2, influence: 10 });
  const before = ready(b.engine, P1);
  assert.equal(rageOf(b), 0);
  agitate(b);
  assert.equal(pending(b.engine), undefined);
  assert.equal(before - ready(b.engine, P1), 1, "pay 1");
  assert.equal(influenceOf(b), 8, "lose 2 influence");
  assert.equal(rageOf(b), 3, "PROVIDES: [R][R][R]");
  assert.equal(b.engine.getThresholds(P1).greed ?? 0, 0, "no other icon");
  assert.equal(rageOf(b, P2), 0, "the opponent gets nothing");
});

clause(DC, "0:ability:dc-agitate", "the provided [R][R][R] is real: a card needing [R][R][R] is refused before AGITATE and can be deployed after it", () => {
  const needs = chr("NeedsRage", { cost: 1, threshold: "rrr" });
  const b = dcBoard({ vol: 3, cards: [{ key: "n3", def: needs, owner: P1, zone: "hand" }] });
  refused(() => play(b.engine, P1, b.id("n3")), "no [R] among three Volition resources", /threshold/i);
  assert.equal(zoneOf(b.engine, b.id("n3")), "hand");
  agitate(b);
  play(b.engine, P1, b.id("n3"));
  assert.equal(zoneOf(b.engine, b.id("n3")), "play", "the Cadencer's [R][R][R] met the threshold");
});

clause(DC, "0:ability:dc-agitate", "lasts this turn only: still provided later in the turn, gone once the turn ends (and not back on the following turns)", () => {
  const b = dcBoard({ vol: 2 });
  agitate(b);
  assert.equal(rageOf(b), 3);
  endTurn(b.engine, P1);
  assert.equal(rageOf(b), 0, "gone after my turn");
  endTurn(b.engine, P2);
  assert.equal(rageOf(b), 0, "and still gone on my next turn");
  assert.equal(zoneOf(b.engine, b.id("dc")), "play");
});

clause(DC, "0:ability:dc-agitate", "two uses stack literally: the card gains PROVIDES twice, [R] x6 in total, for 2 resources and 4 influence", () => {
  const b = dcBoard({ vol: 2, influence: 10 });
  agitate(b);
  agitate(b);
  assert.equal(rageOf(b), 6);
  assert.equal(influenceOf(b), 6);
  assert.equal(ready(b.engine, P1), 0);
});

clause(DC, "0:ability:dc-agitate", "is refused with no resource to pay: nothing changes (control: with one resource it works)", () => {
  const b = dcBoard({ vol: 0, influence: 10 });
  refused(() => agitate(b), "pay 1 with no resources");
  assert.equal(influenceOf(b), 10);
  assert.equal(rageOf(b), 0);
  const ok = dcBoard({ vol: 1, influence: 10 });
  agitate(ok);
  assert.equal(rageOf(ok), 3);
});

clause(DC, "0:ability:dc-agitate", "is refused when the faction can't lose 2 influence (it has 1): nothing is paid (control: 3 influence works)", () => {
  const b = dcBoard({ vol: 2, influence: 1 });
  refused(() => agitate(b), "lose 2 influence with only 1");
  assert.equal(influenceOf(b), 1);
  assert.equal(ready(b.engine, P1), 2, "no resource paid");
  assert.equal(rageOf(b), 0);
  const ok = dcBoard({ vol: 2, influence: 3 });
  agitate(ok);
  assert.equal(influenceOf(ok), 1);
  assert.equal(rageOf(ok), 3);
});

clause(DC, "0:ability:dc-agitate", "printed card: a warlord soldier character, cost 3 and [R]; deploys with one [R] among three resources, refused one short or with no [R]", () => {
  const mkDc = (rage: number, greed: number): Board => duo([{ key: "dc", def: printing(DC), owner: P1, zone: "hand" }, ...bank("rage", rage, P1), ...bank("greed", greed, P1)]);
  const ok = mkDc(1, 2);
  const before = ready(ok.engine, P1);
  play(ok.engine, P1, ok.id("dc"));
  assert.equal(zoneOf(ok.engine, ok.id("dc")), "play", "deployed with a single [R] among three resources");
  assert.equal(before - ready(ok.engine, P1), 3, "printed cost 3 paid");
  identity(ok, "dc", "character", "warlord", ["soldier"]);
  assert.deepEqual(["strength", "speed", "life"].map((s) => ok.engine.getStat(ok.id("dc"), s as "strength")), [2, 3, 2], "printed 2 / 3 / 2");
  const short = mkDc(1, 1);
  refused(() => play(short.engine, P1, short.id("dc")), "2 resources for cost 3");
  assert.equal(zoneOf(short.engine, short.id("dc")), "hand");
  const noR = mkDc(0, 3);
  refused(() => play(noR.engine, P1, noR.id("dc")), "no [R]", /threshold/i);
  assert.equal(zoneOf(noR.engine, noR.id("dc")), "hand");
});

clause(DC, "1:rule@rrrrrr", "with six [R] it gains 2 strength (4 / 3 / 2: only strength changes); with five, one or none it keeps 2 / 3 / 2", () => {
  const six = dcBoard({ rage: 6 });
  assert.deepEqual(["strength", "speed", "life"].map((s) => six.engine.getStat(six.id("dc"), s as "strength")), [4, 3, 2]);
  assert.equal(six.engine.getStat(six.id("other"), "strength"), 2, "another character gains nothing");
  for (const rage of [5, 1, 0]) {
    const b = dcBoard({ rage });
    assert.equal(b.engine.getStat(b.id("dc"), "strength"), 2, `${rage} [R]`);
  }
});

clause(DC, "1:rule@rrrrrr", "gains 2, not more, with twelve [R]; only [R] counts and the opponent's [R] don't", () => {
  const twelve = dcBoard({ rage: 12 });
  assert.equal(twelve.engine.getStat(twelve.id("dc"), "strength"), 4);
  const mixed = dcBoard({ rage: 3, greed: 3 });
  assert.equal(mixed.engine.getStat(mixed.id("dc"), "strength"), 2, "three [R] + three [G] is not six [R]");
  const foe = dcBoard({ rage: 5, foeRage: 6 });
  assert.equal(foe.engine.getStat(foe.id("dc"), "strength"), 2, "the opponent's six [R] don't count for me");
});

clause(DC, "1:rule@rrrrrr", "switches on with AGITATE's own [R][R][R] (three banks + three provided) and off again when the turn ends", () => {
  const b = dcBoard({ rage: 3, vol: 1 });
  assert.equal(b.engine.getStat(b.id("dc"), "strength"), 2, "only three [R]");
  agitate(b);
  assert.equal(rageOf(b), 6);
  assert.equal(b.engine.getStat(b.id("dc"), "strength"), 4, "six [R]: +2 strength");
  endTurn(b.engine, P1);
  assert.equal(rageOf(b), 3);
  assert.equal(b.engine.getStat(b.id("dc"), "strength"), 2, "back to the printed strength once the threshold lapses");
});

// =====================================================================================
// Drill Instructor — character, warlord, soldier, cost 3, [R], str 2 / spd 3 / life 2
// TACTICAL -- EXTRA COST: Play this only not during a battle. -- When this card enters play, pick another
// character. At the start of the next turn that character gains 3 strength for that turn.
// =====================================================================================

const DRILL = "6a477977-867b-4cdc-acc0-1d3f00923031";

function drillBoard(o: { zone?: "hand" | "play"; rage?: number; greed?: number; active?: PlayerId; noOthers?: boolean; cards?: CardPlacement[] } = {}) {
  return duo(
    [
      { key: "di", def: printing(DRILL), owner: P1, zone: o.zone ?? "hand" },
      ...(o.noOthers
        ? []
        : [
            { key: "mine", def: chr("Mine"), owner: P1, zone: "play" as const },
            { key: "foe", def: chr("Foe"), owner: P2, zone: "play" as const },
            { key: "foe2", def: chr("Foe2"), owner: P2, zone: "play" as const },
            { key: "it", def: item({ name: "Gadget" }), owner: P2, zone: "play" as const },
            { key: "lc", def: location({ name: "Tower", structure: 4 }), owner: P2, zone: "play" as const },
            { key: "hc", def: chr("InHand"), owner: P2, zone: "hand" as const },
            { key: "dc", def: chr("InDiscard"), owner: P2, zone: "discard" as const }
          ]),
      ...bank("rage", o.rage ?? 3, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...(o.cards ?? [])
    ],
    { active: o.active }
  );
}
const deployDI = (b: Board, key = "di"): void => {
  play(b.engine, P1, b.id(key), {});
  assert.equal(pending(b.engine)?.kind, "selectTargets", "the enters-play trigger asks for a pick");
};
const pickDI = (b: Board, target: string): void => {
  answerPending(b.engine, "selectTargets", { selected: { pick: [b.id(target)] } });
  assert.equal(pending(b.engine), undefined);
};
const str = (b: Board, key: string): number => b.engine.getStat(b.id(key), "strength");

clause(DRILL, "0:kw:TACTICAL", "the card has the TACTICAL keyword (an ordinary character does not)", () => {
  const b = drillBoard({ cards: [{ key: "plain", def: chr("Plain"), owner: P1, zone: "play" }] });
  assert.ok(b.engine.getKeywords(b.id("di")).includes("tactical"), "b.engine.getKeywords(b.id(\"di\")).includes(\"tactical\")");
  assert.equal(b.engine.getKeywords(b.id("plain")).includes("tactical"), false, "control: an ordinary character is not tactical");
});

clause(DRILL, "0:kw:TACTICAL", "it deploys in a response window on the opponent's turn (outside a battle), paying 3; an ordinary character cannot", () => {
  const b = drillBoard({
    active: P2,
    cards: [
      { key: "pk", def: killTactic({ name: "FoeKill" }), owner: P2, zone: "hand" },
      { key: "plain", def: chr("Plain", { cost: 0 }), owner: P1, zone: "hand" }
    ]
  });
  playRaw(b.engine, P2, b.id("pk"), { selected: { t: [b.id("foe2")] } });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "I may respond");
  assert.equal(b.engine.state.battle, undefined, "no battle in progress");
  refused(() => play(b.engine, P1, b.id("plain")), "an ordinary character can't be deployed on the opponent's turn");
  assert.equal(zoneOf(b.engine, b.id("plain")), "hand");
  const before = ready(b.engine, P1);
  play(b.engine, P1, b.id("di"), {});
  assert.equal(zoneOf(b.engine, b.id("di")), "play", "deployed on the opponent's turn");
  assert.equal(before - ready(b.engine, P1), 3, "printed cost 3 paid");
});

clause(DRILL, "1:ability", "deploys for its printed cost 3 and [R] with stats str 2 / spd 3 / life 2; refused one short or with no [R]", () => {
  const b = drillBoard({ rage: 3 });
  const before = ready(b.engine, P1);
  deployDI(b);
  pickDI(b, "mine");
  assert.equal(before - ready(b.engine, P1), 3);
  assert.equal(str(b, "di"), 2);
  assert.equal(b.engine.getStat(b.id("di"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("di"), "life"), 2);
  const short = drillBoard({ rage: 2 });
  refused(() => play(short.engine, P1, short.id("di"), {}), "2 resources for cost 3");
  assert.equal(zoneOf(short.engine, short.id("di")), "hand");
  const noR = drillBoard({ rage: 0, greed: 5 });
  refused(() => play(noR.engine, P1, noR.id("di"), {}), "no [R]", /threshold/i);
  assert.equal(zoneOf(noR.engine, noR.id("di")), "hand");
});

clause(DRILL, "1:ability", "printed type line: a warlord soldier character; one [R] among three resources is enough for the [R] threshold", () => {
  const b = drillBoard({ rage: 1, greed: 2 });
  identity(b, "di", "character", "warlord", ["soldier"]);
  const before = ready(b.engine, P1);
  deployDI(b);
  pickDI(b, "foe");
  assert.equal(zoneOf(b.engine, b.id("di")), "play", "deployed with a single [R]");
  assert.equal(before - ready(b.engine, P1), 3, "printed cost 3 paid");
});

clause(DRILL, "1:ability", "play only not during a battle: refused during my own attack, and refused in the opponent's attack window even though it is TACTICAL; allowed once the battle is over", () => {
  const mine = drillBoard({ cards: [{ key: "atk", def: chr("Atk"), owner: P1, zone: "play" }] });
  declareAttackBy(mine.engine, P1, [mine.id("atk")]);
  assert.ok(battleOf(mine.engine), "a battle is underway");
  refused(() => play(mine.engine, P1, mine.id("di"), {}), "during my own battle");
  assert.equal(zoneOf(mine.engine, mine.id("di")), "hand");
  declareBlockers(mine.engine, P2, []);
  finishBattle(mine.engine);
  assert.equal(mine.engine.state.battle, undefined);
  deployDI(mine);
  pickDI(mine, "mine");
  assert.equal(zoneOf(mine.engine, mine.id("di")), "play", "control: outside a battle it deploys");

  const theirs = drillBoard({
    active: P2,
    cards: [
      { key: "patk", def: chr("PAtk"), owner: P2, zone: "play" },
      { key: "ctl", def: killTactic({ name: "Ctl" }), owner: P1, zone: "hand" }
    ]
  });
  declareAttackOpenWindow(theirs.engine, P2, [theirs.id("patk")]);
  assert.ok(battleOf(theirs.engine), "the opponent's attack is a battle");
  refused(() => play(theirs.engine, P1, theirs.id("di"), {}), "during the opponent's battle");
  assert.equal(zoneOf(theirs.engine, theirs.id("di")), "hand");
  playRaw(theirs.engine, P1, theirs.id("ctl"), { selected: { t: [theirs.id("foe2")] } });
  assert.equal(theirs.engine.state.cards[theirs.id("ctl")].zone === "hand", false, "control: a tactic can be played in that window");
});

clause(DRILL, "2:rule", "pick another character of mine: nothing changes at once, it gains 3 strength at the start of the next turn only (2 to 5 to 2), and unpicked characters gain nothing", () => {
  const b = drillBoard();
  deployDI(b);
  pickDI(b, "mine");
  assert.equal(str(b, "mine"), 2, "no immediate bonus");
  endTurn(b.engine, P1);
  assert.equal(str(b, "mine"), 5, "+3 during the next turn");
  assert.equal(str(b, "foe"), 2);
  assert.equal(str(b, "foe2"), 2);
  assert.equal(str(b, "di"), 2, "Drill Instructor itself gains nothing");
  endTurn(b.engine, P2);
  assert.equal(str(b, "mine"), 2, "'for that turn': the bonus is over");
});

clause(DRILL, "2:rule", "the picked character may be an opponent's: it gets the +3 at the start of the next turn (theirs) and mine stay unchanged", () => {
  const b = drillBoard();
  deployDI(b);
  pickDI(b, "foe");
  assert.equal(str(b, "foe"), 2);
  endTurn(b.engine, P1);
  assert.equal(str(b, "foe"), 5);
  assert.equal(str(b, "foe2"), 2);
  assert.equal(str(b, "mine"), 2);
  endTurn(b.engine, P2);
  assert.equal(str(b, "foe"), 2);
});

clause(DRILL, "2:rule", "'another' character: Drill Instructor itself, items, locations, factions, and cards in hand or the discard can't be picked; the pick is mandatory", () => {
  const b = drillBoard();
  deployDI(b);
  const picks: Array<[string, CardInstanceId]> = [
    ["Drill Instructor itself", b.id("di")],
    ["an item", b.id("it")],
    ["a location", b.id("lc")],
    ["the opposing faction", b.engine.state.players[P2].factionId!],
    ["my faction", b.engine.state.players[P1].factionId!],
    ["a character in hand", b.id("hc")],
    ["a character in the discard", b.id("dc")]
  ];
  for (const [why, target] of picks) {
    refused(() => answerPending(b.engine, "selectTargets", { selected: { pick: [target] } }), why);
    assert.equal(pending(b.engine)?.kind, "selectTargets", `${why}: the pick is still open`);
  }
  refused(() => answerPending(b.engine, "selectTargets", { selected: { pick: [] } }), "the pick is not optional while another character exists");
  assert.equal(pending(b.engine)?.kind, "selectTargets");
  pickDI(b, "foe2");
  assert.equal(zoneOf(b.engine, b.id("di")), "play", "control: a legal pick is accepted");
  assert.equal(pending(b.engine), undefined);
});

clause(DRILL, "2:rule", "another character with the same NAME is still 'another': a second Drill Instructor (mine or the opponent's) can be picked", () => {
  const second = drillBoard({ cards: [{ key: "di2", def: printing(DRILL), owner: P1, zone: "play" }] });
  deployDI(second);
  pickDI(second, "di2");
  endTurn(second.engine, P1);
  assert.equal(str(second, "di2"), 5, "my other Drill Instructor gained 3");
  const theirs = drillBoard({ cards: [{ key: "di3", def: printing(DRILL), owner: P2, zone: "play" }] });
  deployDI(theirs);
  pickDI(theirs, "di3");
  endTurn(theirs.engine, P1);
  assert.equal(str(theirs, "di3"), 5, "the opponent's Drill Instructor gained 3");
});

clause(DRILL, "2:rule", "with no other character in play there is nothing to pick: no prompt, it simply enters play, and the next turn starts cleanly", () => {
  const b = drillBoard({ noOthers: true });
  play(b.engine, P1, b.id("di"), {});
  assert.equal(pending(b.engine), undefined, "no pick offered");
  assert.equal(zoneOf(b.engine, b.id("di")), "play");
  endTurn(b.engine, P1);
  assert.equal(str(b, "di"), 2);
});

clause(DRILL, "2:rule", "only triggers when this card enters play: another character entering later does not prompt or buff", () => {
  const b = drillBoard({
    zone: "play",
    cards: [{ key: "plain", def: chr("Plain", { cost: 1 }), owner: P1, zone: "hand" }]
  });
  play(b.engine, P1, b.id("plain"));
  assert.equal(zoneOf(b.engine, b.id("plain")), "play");
  assert.equal(pending(b.engine), undefined);
  endTurn(b.engine, P1);
  for (const k of ["mine", "foe", "foe2", "di", "plain"]) assert.equal(str(b, k), 2, `${k} unchanged`);
});

clause(DRILL, "2:rule", "if the picked character has left play by the start of the next turn nothing happens and nobody else gains the bonus", () => {
  const b = drillBoard({ cards: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  deployDI(b);
  pickDI(b, "foe");
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard");
  endTurn(b.engine, P1);
  for (const k of ["mine", "foe2", "di"]) assert.equal(str(b, k), 2, `${k} unchanged`);
});

/** Strength of `key` at the start of each of the next `n` turns, ending my turn first and then each player's in turn. */
const strengthEachTurn = (b: Board, key: string, n: number): number[] => {
  const seen: number[] = [];
  for (let i = 0; i < n; i++) {
    endTurn(b.engine, i % 2 === 0 ? P1 : P2);
    seen.push(str(b, key));
  }
  return seen;
};

clause(DRILL, "2:rule", "whichever turn it lands on, the picked character (mine or the opponent's) gains exactly 3 strength for that one turn only: [5,2] or [2,5], then 2 again", () => {
  for (const target of ["mine", "foe"]) {
    const b = drillBoard();
    deployDI(b);
    pickDI(b, target);
    assert.equal(str(b, target), 2, `${target}: no bonus yet`);
    const seen = strengthEachTurn(b, target, 3);
    assert.ok(
      (seen[0] === 5 && seen[1] === 2) || (seen[0] === 2 && seen[1] === 5),
      `${target}: exactly one of the next two turns has +3 (saw ${seen.join(",")})`
    );
    assert.equal(seen[2], 2, `${target}: the bonus lasts a single turn`);
  }
});

clause(DRILL, "2:rule", "two Drill Instructors on the same character give +3 each, +6 in total, for one turn only", () => {
  const b = drillBoard({ rage: 6, cards: [{ key: "di2", def: printing(DRILL), owner: P1, zone: "hand" }] });
  deployDI(b);
  pickDI(b, "mine");
  deployDI(b, "di2");
  pickDI(b, "mine");
  const seen = strengthEachTurn(b, "mine", 3);
  assert.ok((seen[0] === 8 && seen[1] === 2) || (seen[0] === 2 && seen[1] === 8), `+6 on exactly one of the next two turns (saw ${seen.join(",")})`);
  assert.equal(seen[2], 2);
});

clause(DRILL, "2:rule", "two Drill Instructors picking the same character stack: +6 strength for that turn", () => {
  const b = drillBoard({ rage: 6, cards: [{ key: "di2", def: printing(DRILL), owner: P1, zone: "hand" }] });
  deployDI(b);
  pickDI(b, "mine");
  deployDI(b, "di2");
  pickDI(b, "mine");
  endTurn(b.engine, P1);
  assert.equal(str(b, "mine"), 8, "2 + 3 + 3");
  endTurn(b.engine, P2);
  assert.equal(str(b, "mine"), 2);
});
