// Clause tests — batch seed-saga-09 part p3. Expectations come from PRINTED text and RULES.md; engine data only drives the engine.

import assert from "node:assert/strict";
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
  P1,
  P2
} from "../per-card/_harness.js";
import type { StapleIcon } from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { declareAttackOpenWindow, fightThrough, playRaw } from "./_battle.js";
import { fillers, pending, readyResources, zoneOf } from "./_board.js";
import { endTurn } from "./_turn.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

type Icons = Partial<Record<StapleIcon, number>>;

/** Staple resources for `owner`, e.g. `res({ deception: 2, rage: 3 })`. */
const res = (icons: Icons, owner: PlayerId = P1): CardPlacement[] =>
  (Object.entries(icons) as Array<[StapleIcon, number]>).flatMap(([icon, n]) => bank(icon, n, owner));

/** The same, but already spent (attached to `owner`'s faction): they count for thresholds, not for "pay N". */
const spent = (icons: Icons, owner: PlayerId = P1): CardPlacement[] =>
  res(icons, owner).map((placement) => ({ ...placement, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

const ready = (engine: SpoilsEngine, player: PlayerId = P1): number => readyResources(engine, player);
const handOf = (engine: SpoilsEngine, p: PlayerId): CardInstanceId[] => [...engine.state.players[p].hand];
const deckOf = (engine: SpoilsEngine, p: PlayerId): CardInstanceId[] => [...engine.state.players[p].deck];
const controllerOf = (engine: SpoilsEngine, cardId: CardInstanceId): PlayerId => engine.state.cards[cardId].controllerId;
const isDepleted = (engine: SpoilsEngine, cardId: CardInstanceId): boolean => engine.state.cards[cardId].depleted === true;

const devBoard = (cards: CardPlacement[], extra: Parameters<typeof buildGame>[0] = {}) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, random: () => 0.5, ...extra, cards });

/** Answers the open pending choice (if any) with `choice`, then closes response windows. */
function choose(engine: SpoilsEngine, choice: unknown): void {
  const pc = engine.state.pendingChoice as unknown as PendingChoiceLike;
  assert.ok(pc, "expected an open pending choice");
  engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
  resolvePendingResponses(engine);
}

function expectPending(engine: SpoilsEngine, kind: string): PendingChoiceLike {
  const pc = pending(engine);
  assert.ok(pc, `expected an open pending choice of kind ${kind}, found none`);
  assert.equal(pc.kind, kind);
  return pc;
}

function actRaw(engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, abilityId: string, selected: Record<string, CardInstanceId[]> = {}): void {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected, variables: {} } as never);
}

function flipUpRaw(engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}): void {
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });
}

const ch = (name: string, over: Partial<CardDefinition> = {}): CardDefinition => character({ name, cost: 1, ...over });

/** Deploy `defId` from hand with exactly `placements` as resources: did it enter play, and what did it cost. */
function deployProbe(defId: string, placements: CardPlacement[]): { entered: boolean; paid: number; refusedPlay: boolean } {
  const { engine, id } = devBoard([
    { key: "c", def: printing(defId), owner: P1, zone: "hand" },
    ...fillers("dk", 3, P1, "deck", (i) => ch(`Deck ${i}`)),
    ...placements
  ]);
  const before = ready(engine);
  let refusedPlay = false;
  try {
    playRaw(engine, P1, id("c"));
    resolvePendingResponses(engine);
  } catch {
    refusedPlay = true;
  }
  return { entered: zoneOf(engine, id("c")) === "play", paid: before - ready(engine), refusedPlay };
}

// =============================================================================
// Overindulge (Seed Saga) — Tactic, rogue, cost 2, [D][D]
//   Choose one of the following as this card's rules text:
//   OPTION 1 -- EXTRA COST: Pick a character. This turn, the character loses 2 life.
//   OPTION 2 -- EXTRA COST: Pick a character. This turn, the character loses 1 life. Draw a card.
// =============================================================================

const OVER = "21840b4b-3197-421d-ac75-1c4812b1131c";

function overBoard(extra: CardPlacement[] = [], resources: CardPlacement[] = res({ deception: 2 })) {
  return devBoard([
    { key: "ov", def: printing(OVER), owner: P1, zone: "hand" },
    { key: "mine", def: ch("Mine", { strength: 1, life: 4, speed: 1 }), owner: P1, zone: "play" },
    { key: "theirs", def: ch("Theirs", { strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
    { key: "other", def: ch("Other", { strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
    { key: "it", def: item({ name: "Gadget" }), owner: P2, zone: "play" },
    { key: "hc", def: ch("In Hand"), owner: P2, zone: "hand" },
    ...fillers("dk", 4, P1, "deck", (i) => ch(`Deck ${i}`)),
    ...fillers("od", 3, P2, "deck", (i) => ch(`OppDeck ${i}`)),
    ...resources,
    ...extra
  ]);
}

const overCast = (b: ReturnType<typeof overBoard>, mode: number, target: string, key = "ov") =>
  play(b.engine, P1, b.id(key), { mode, selected: { c: [b.id(target)] } });
const lifeOf = (b: ReturnType<typeof overBoard>, key: string) => b.engine.getStat(b.id(key), "life");

clause(OVER, "0:rule", "printed cost 2 / [D][D] tactic: exactly [D][D] casts and pays 2; one resource short, one [D] short and a cost short with spent icons are refused", () => {
  const def = printing(OVER);
  assert.equal(def.type, "tactic");
  assert.equal(def.trade, "rogue");
  const castWith = (placements: CardPlacement[]) => {
    const b = overBoard([], placements);
    const before = ready(b.engine);
    let ok = true;
    try {
      overCast(b, 0, "theirs");
    } catch {
      ok = false;
    }
    return { ok, paid: before - ready(b.engine), life: lifeOf(b, "theirs") };
  };
  assert.deepEqual(castWith(res({ deception: 2 })), { ok: true, paid: 2, life: 2 }, "exactly [D][D] pays 2");
  assert.equal(castWith(res({ deception: 1 })).ok, false, "one resource short");
  assert.equal(castWith(res({ deception: 1, rage: 1 })).ok, false, "two resources but one [D]");
  assert.equal(castWith(res({ rage: 4 })).ok, false, "no [D]");
  assert.equal(castWith([...spent({ deception: 2 }), ...res({ rage: 1 })]).ok, false, "threshold met by spent icons but only 1 ready: cost is 2");
  assert.deepEqual(castWith([...spent({ deception: 2 }), ...res({ rage: 2 })]), { ok: true, paid: 2, life: 2 }, "spent icons satisfy the threshold, 2 ready pay the cost");
});

clause(OVER, "0:rule", "choose one of two rules texts: mode 0 and mode 1 differ; a third mode does not exist", () => {
  const b0 = overBoard();
  overCast(b0, 0, "theirs");
  assert.equal(lifeOf(b0, "theirs"), 2, "option 1 is -2 life");
  assert.equal(handOf(b0.engine, P1).length, 0, "option 1 draws nothing");
  const b1 = overBoard();
  overCast(b1, 1, "theirs");
  assert.equal(lifeOf(b1, "theirs"), 3, "option 2 is -1 life");
  assert.equal(handOf(b1.engine, P1).length, 1, "option 2 draws a card");
  const b2 = overBoard();
  refused(() => overCast(b2, 2, "theirs"), "there is no third option");
  assert.equal(zoneOf(b2.engine, b2.id("ov")), "hand", "still in hand after the refusal");
});

function overOption(key: string, mode: number, loss: number, draws: number) {
  const tag = `option ${mode + 1}`;
  clause(OVER, key, `${tag}: you may pick your own or an opponent's character; only the picked one loses ${loss} life; the others keep 4`, () => {
    for (const target of ["theirs", "mine"]) {
      const b = overBoard();
      overCast(b, mode, target);
      assert.equal(b.engine.state.pendingChoice, undefined);
      assert.equal(lifeOf(b, target), 4 - loss, `${target} loses ${loss}`);
      for (const k of ["mine", "theirs", "other"].filter((x) => x !== target)) assert.equal(lifeOf(b, k), 4, `${k} untouched`);
      assert.equal(zoneOf(b.engine, b.id("ov")), "discard", "the tactic resolved");
    }
  });

  clause(OVER, key, `${tag}: EXTRA COST pick must be a character: items, cards in hand and no pick are refused`, () => {
    const b = overBoard();
    refused(() => overCast(b, mode, "it"), "an item is not a character");
    refused(() => overCast(b, mode, "hc"), "a character in hand is not in play");
    refused(() => play(b.engine, P1, b.id("ov"), { mode }), "no pick at all");
    assert.equal(zoneOf(b.engine, b.id("ov")), "hand");
    assert.equal(ready(b.engine), 2, "nothing paid by the refusals");
    overCast(b, mode, "theirs"); // positive control
    assert.equal(lifeOf(b, "theirs"), 4 - loss);
  });

  clause(OVER, key, `${tag}: the life loss lasts this turn only and is gone next turn`, () => {
    const b = overBoard();
    overCast(b, mode, "theirs");
    assert.equal(lifeOf(b, "theirs"), 4 - loss);
    endTurn(b.engine, P1);
    assert.equal(lifeOf(b, "theirs"), 4, "life back to 4 after the turn ends");
    endTurn(b.engine, P2);
    assert.equal(lifeOf(b, "theirs"), 4);
  });

  clause(OVER, key, `${tag}: the card loses ${loss} life as a stat, so damage >= reduced life destroys it and damage below does not`, () => {
    const dies = overBoard([], res({ deception: 2 }));
    dies.engine.state.cards[dies.id("theirs")].damage = 4 - loss;
    overCast(dies, mode, "theirs");
    assert.equal(zoneOf(dies.engine, dies.id("theirs")), "discard", `damage ${4 - loss} on life ${4 - loss} destroys`);
    const lives = overBoard([], res({ deception: 2 }));
    lives.engine.state.cards[lives.id("theirs")].damage = 3 - loss;
    overCast(lives, mode, "theirs");
    assert.equal(zoneOf(lives.engine, lives.id("theirs")), "play", "one damage below the new life survives");
  });

  clause(OVER, key, `${tag}: ${draws ? "draws exactly one card" : "draws no card"} for the caster and not for the opponent`, () => {
    const b = overBoard();
    const topA = deckOf(b.engine, P1)[0];
    const oppHand = handOf(b.engine, P2).length;
    overCast(b, mode, "theirs");
    assert.deepEqual(handOf(b.engine, P1), draws ? [topA] : [], draws ? "the top card of your deck" : "empty hand");
    assert.equal(deckOf(b.engine, P1).length, draws ? 3 : 4);
    assert.equal(handOf(b.engine, P2).length, oppHand, "opponent hand unchanged");
  });
}
overOption("1:option:OPTION 1", 0, 2, 0);
overOption("2:option:OPTION 2", 1, 1, 1);

clause(OVER, "1:option:OPTION 1", "option 1: a 2-life character is reduced to 0 life this turn and is destroyed (0 life is lethal)", () => {
  const b = overBoard([{ key: "weak", def: ch("Weak", { strength: 1, life: 2, speed: 1 }), owner: P2, zone: "play" }]);
  overCast(b, 0, "weak");
  assert.equal(zoneOf(b.engine, b.id("weak")), "discard", "2 life - 2 = 0 life is lethal");
});

clause(OVER, "1:option:OPTION 1", "option 1: two casts on the same character stack to -4", () => {
  const s = overBoard(
    [
      { key: "ov2", def: printing(OVER), owner: P1, zone: "hand" },
      { key: "big", def: ch("Big", { strength: 1, life: 6, speed: 1 }), owner: P2, zone: "play" },
      ...res({ deception: 2 })
    ],
    res({ deception: 2 })
  );
  overCast(s, 0, "big");
  overCast(s, 0, "big", "ov2");
  assert.equal(lifeOf(s, "big"), 2, "6 - 2 - 2");
});

clause(OVER, "2:option:OPTION 2", "option 2: a 1-life character is reduced to 0 life and is destroyed (0 life is lethal)", () => {
  const b = overBoard([{ key: "weak", def: ch("Weak", { strength: 1, life: 1, speed: 1 }), owner: P2, zone: "play" }]);
  overCast(b, 1, "weak");
  assert.equal(zoneOf(b.engine, b.id("weak")), "discard", "1 life - 1 = 0 life is lethal");
});

clause(OVER, "2:option:OPTION 2", "option 2: two casts on the same character stack to -2 and draw two cards", () => {
  const s = overBoard(
    [
      { key: "ov2", def: printing(OVER), owner: P1, zone: "hand" },
      { key: "big", def: ch("Big", { strength: 1, life: 6, speed: 1 }), owner: P2, zone: "play" },
      ...res({ deception: 2 })
    ],
    res({ deception: 2 })
  );
  overCast(s, 1, "big");
  overCast(s, 1, "big", "ov2");
  assert.equal(lifeOf(s, "big"), 4, "6 - 1 - 1");
  assert.equal(handOf(s.engine, P1).length, 2, "two draws");
});

// =============================================================================
// Palm Glom (Seed Saga) — Tactic, rogue, cost 6, [D][D][D][D][D][D]
//   EXTRA COST: Pick a character or item. Take control of the character or item. Draw a card.
// =============================================================================

const GLOM = "56e4b21f-ce64-4abe-badf-3752f005af27";

function glomBoard(resources: CardPlacement[] = [...spent({ deception: 6 }), ...res({ rage: 6 })], extra: CardPlacement[] = []) {
  return devBoard([
    { key: "pg", def: printing(GLOM), owner: P1, zone: "hand" },
    { key: "mine", def: ch("Mine"), owner: P1, zone: "play" },
    { key: "ec", def: ch("Their Char", { strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
    { key: "ei", def: item({ name: "Their Item" }), owner: P2, zone: "play" },
    { key: "el", def: location({ name: "Their Place" }), owner: P2, zone: "play" },
    { key: "dc", def: ch("Discarded"), owner: P2, zone: "discard" },
    { key: "hc", def: ch("In Hand"), owner: P2, zone: "hand" },
    ...fillers("dk", 4, P1, "deck", (i) => ch(`Deck ${i}`)),
    ...fillers("od", 3, P2, "deck", (i) => ch(`OppDeck ${i}`)),
    ...resources,
    ...extra
  ]);
}
const glomCast = (b: ReturnType<typeof glomBoard>, target: string) => play(b.engine, P1, b.id("pg"), { selected: { t: [b.id(target)] } });

clause(GLOM, "0:extraCost", "printed cost 6 / six [D] tactic: exactly 6 casts and pays 6; one resource short, one [D] short, or cost short behind spent icons is refused", () => {
  const def = printing(GLOM);
  assert.equal(def.type, "tactic");
  assert.equal(def.trade, "rogue");
  const castWith = (placements: CardPlacement[]) => {
    const b = glomBoard(placements);
    const before = ready(b.engine);
    let ok = true;
    try {
      glomCast(b, "ec");
    } catch {
      ok = false;
    }
    return { ok, paid: before - ready(b.engine), ctrl: controllerOf(b.engine, b.id("ec")) };
  };
  assert.deepEqual(castWith(res({ deception: 6 })), { ok: true, paid: 6, ctrl: P1 }, "exactly six [D]");
  assert.equal(castWith(res({ deception: 5 })).ok, false, "five resources: one short");
  assert.equal(castWith(res({ deception: 5, rage: 1 })).ok, false, "six resources but five [D]");
  assert.equal(castWith(res({ rage: 8 })).ok, false, "no [D]");
  assert.equal(castWith([...spent({ deception: 6 }), ...res({ rage: 5 })]).ok, false, "threshold via spent icons, 5 ready: cost is 6");
  assert.deepEqual(castWith([...spent({ deception: 6 }), ...res({ rage: 6 })]), { ok: true, paid: 6, ctrl: P1 }, "spent icons for threshold, 6 ready for the cost");
});

clause(GLOM, "0:extraCost", "the pick can be an opponent's character, an opponent's item, or your own character; a location, a discarded card, a card in hand and no pick are refused", () => {
  for (const target of ["ec", "ei", "mine"]) {
    const b = glomBoard();
    glomCast(b, target);
    assert.equal(b.engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(b.engine, b.id(target)), "play", `${target} legal pick`);
    assert.equal(controllerOf(b.engine, b.id(target)), P1);
  }
  const b = glomBoard();
  refused(() => glomCast(b, "el"), "a location is neither a character nor an item");
  refused(() => glomCast(b, "dc"), "a card in the discard pile is not in play");
  refused(() => glomCast(b, "hc"), "a card in hand is not in play");
  refused(() => play(b.engine, P1, b.id("pg")), "the pick is a required extra cost");
  assert.equal(zoneOf(b.engine, b.id("pg")), "hand");
  assert.equal(ready(b.engine), 6, "no resources paid by the refusals");
  assert.equal(controllerOf(b.engine, b.id("el")), P2, "the location stays with its owner");
});

clause(GLOM, "1:rule", "takes control of the picked character: you control it, the opponent no longer does, and it stays in play (still owned by the opponent)", () => {
  const b = glomBoard();
  glomCast(b, "ec");
  assert.equal(controllerOf(b.engine, b.id("ec")), P1);
  assert.equal(b.engine.state.cards[b.id("ec")].ownerId, P2, "ownership does not change");
  assert.ok(b.engine.state.players[P1].play.includes(b.id("ec")), "in your play zone");
  assert.ok(!b.engine.state.players[P2].play.includes(b.id("ec")), "out of the opponent's play zone");
  assert.equal(controllerOf(b.engine, b.id("ei")), P2, "the unpicked item is untouched");
  assert.equal(controllerOf(b.engine, b.id("mine")), P1);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(controllerOf(b.engine, b.id("ec")), P1, "control has no duration: still yours two turns later");
});

clause(GLOM, "1:rule", "takes control of the picked item", () => {
  const b = glomBoard();
  glomCast(b, "ei");
  assert.equal(controllerOf(b.engine, b.id("ei")), P1);
  assert.ok(b.engine.state.players[P1].play.includes(b.id("ei")), "b.engine.state.players[P1].play.includes(b.id(\"ei\"))");
  assert.equal(controllerOf(b.engine, b.id("ec")), P2, "the unpicked character is untouched");
});

clause(GLOM, "1:rule", "draws exactly one card for the caster and none for the opponent", () => {
  const b = glomBoard();
  const top = deckOf(b.engine, P1)[0];
  const oppHand = handOf(b.engine, P2).length;
  glomCast(b, "ec");
  assert.deepEqual(handOf(b.engine, P1), [top], "the top card of your deck");
  assert.equal(deckOf(b.engine, P1).length, 3);
  assert.equal(handOf(b.engine, P2).length, oppHand);
  const own = glomBoard();
  glomCast(own, "mine");
  assert.equal(handOf(own.engine, P1).length, 1, "drawing is not conditional on the pick being the opponent's");
});

// =============================================================================
// Pant Swipe (Seed Saga) — Tactic, rogue, cost 7, [D][D][D]
//   Put the top 4 cards of an opponent's deck into the void face-down. (You are still allowed to look at them.)
//   For the rest of the game, you may deploy the voided cards as though they were in your hand even if you cannot meet their threshold.
//   FLIP UP: 5 [D][D][D]
// =============================================================================

const SWIPE = "3a9ab0e7-b3f3-4956-8f82-be8f0916a9da";
const swipeLoot = (name: string): CardDefinition => ch(name, { threshold: "ee" });

function swipeBoard(opts: { oppDeck?: number; resources?: CardPlacement[]; extra?: CardPlacement[]; swipeZone?: "hand" | "play"; active?: PlayerId } = {}) {
  const faceDown = opts.swipeZone === "play";
  return devBoard(
    [
      { key: "ps", def: printing(SWIPE), owner: P1, zone: opts.swipeZone ?? "hand", ...(faceDown ? { faceDown: true } : {}) },
      ...fillers("t", opts.oppDeck ?? 6, P2, "deck", (i) => swipeLoot(`Loot ${i}`)),
      ...fillers("dk", 3, P1, "deck", (i) => ch(`Deck ${i}`)),
      { key: "old", def: swipeLoot("Old Void"), owner: P2, zone: "void" },
      { key: "phand", def: swipeLoot("P2 Hand"), owner: P2, zone: "hand" },
      ...(opts.resources ?? [...res({ deception: 3 }), ...res({ rage: 4 })]),
      ...(opts.extra ?? [])
    ],
    opts.active ? { activePlayerId: opts.active } : {}
  );
}
const tops = (b: ReturnType<typeof swipeBoard>, n: number) => Array.from({ length: n }, (_, i) => b.id(`t${i}`));
/** Casts with the top 4 selected explicitly (the printed text has no choice to make). */
const swipeCast = (b: ReturnType<typeof swipeBoard>) => play(b.engine, P1, b.id("ps"), { selected: { voided: deckOf(b.engine, P2).slice(0, 4) } });

clause(SWIPE, "0:rule", "printed cost 7 / [D][D][D] tactic: exactly 3 [D] + 4 other casts and pays 7; one short, one [D] short, or cost short behind spent icons is refused", () => {
  const def = printing(SWIPE);
  assert.equal(def.type, "tactic");
  assert.equal(def.trade, "rogue");
  const castWith = (placements: CardPlacement[]) => {
    const b = swipeBoard({ resources: placements });
    const before = ready(b.engine);
    let ok = true;
    try {
      swipeCast(b);
    } catch {
      ok = false;
    }
    return { ok, paid: before - ready(b.engine), voided: b.engine.state.cards[b.id("t0")].zone === "void" };
  };
  assert.deepEqual(castWith([...res({ deception: 3 }), ...res({ rage: 4 })]), { ok: true, paid: 7, voided: true }, "exactly 7 with [D][D][D]");
  assert.equal(castWith([...res({ deception: 3 }), ...res({ rage: 3 })]).ok, false, "6 resources: one short");
  assert.equal(castWith([...res({ deception: 2 }), ...res({ rage: 5 })]).ok, false, "7 resources but only two [D]");
  assert.equal(castWith(res({ rage: 8 })).ok, false, "no [D]");
  assert.equal(castWith([...spent({ deception: 3 }), ...res({ rage: 6 })]).ok, false, "threshold via spent icons, 6 ready: cost is 7");
  assert.deepEqual(castWith([...spent({ deception: 3 }), ...res({ rage: 7 })]), { ok: true, paid: 7, voided: true }, "spent icons for threshold, 7 ready for the cost");
});

clause(SWIPE, "0:rule", "puts exactly the top 4 cards of the opponent's deck into the void, face-down; the rest of their deck and your own deck are untouched", () => {
  const b = swipeBoard();
  const myDeck = deckOf(b.engine, P1);
  const oppDeck = deckOf(b.engine, P2);
  assert.deepEqual(oppDeck, tops(b, 6), "deck order is t0 (top) .. t5");
  swipeCast(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const i of [0, 1, 2, 3]) {
    assert.equal(zoneOf(b.engine, b.id(`t${i}`)), "void", `t${i} is voided`);
  }
  assert.deepEqual(deckOf(b.engine, P2), [b.id("t4"), b.id("t5")], "the 5th and 6th cards stay, in order");
  assert.deepEqual(deckOf(b.engine, P1), myDeck, "your deck is untouched");
  assert.equal(zoneOf(b.engine, b.id("phand")), "hand");
  assert.equal(zoneOf(b.engine, b.id("ps")), "discard", "the tactic resolved");
});

clause(SWIPE, "0:rule", "the four voided cards are face-down", () => {
  const b = swipeBoard();
  swipeCast(b);
  for (const i of [0, 1, 2, 3]) {
    assert.equal(zoneOf(b.engine, b.id(`t${i}`)), "void");
    assert.equal(b.engine.state.cards[b.id(`t${i}`)].faceDown, true, `t${i} is face-down`);
  }
});

clause(SWIPE, "0:rule", "casting puts the top 4 cards into the void with no selection made (there is nothing to choose)", () => {
  const b = swipeBoard();
  play(b.engine, P1, b.id("ps"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const i of [0, 1, 2, 3]) assert.equal(zoneOf(b.engine, b.id(`t${i}`)), "void", `t${i} voided`);
  assert.deepEqual(deckOf(b.engine, P2), [b.id("t4"), b.id("t5")]);
});

clause(SWIPE, "0:rule", "naming fewer than 4 cards still voids the whole top 4", () => {
  const few = swipeBoard();
  play(few.engine, P1, few.id("ps"), { selected: { voided: [few.id("t0"), few.id("t1")] } });
  assert.equal(zoneOf(few.engine, few.id("t0")) === "void" && zoneOf(few.engine, few.id("t3")) === "void", true, "all four are voided even when only two were named");
});

clause(SWIPE, "0:rule", "cards other than the top 4 cannot be named instead", () => {
  // There is no choice to make (the top 4 are fixed), so naming other cards changes nothing: only the top 4 are voided.
  const wrong = swipeBoard();
  play(wrong.engine, P1, wrong.id("ps"), { selected: { voided: [wrong.id("t2"), wrong.id("t3"), wrong.id("t4"), wrong.id("t5")] } });
  for (const i of [0, 1, 2, 3]) assert.equal(zoneOf(wrong.engine, wrong.id(`t${i}`)), "void", `t${i} (top 4) is voided whatever was named`);
  assert.equal(zoneOf(wrong.engine, wrong.id("t4")), "deck", "the 5th card is out of reach");
  assert.equal(zoneOf(wrong.engine, wrong.id("t5")), "deck", "the 6th card is out of reach");
});

clause(SWIPE, "0:rule", "an opponent's deck with fewer than 4 cards: all of it is voided without error; with exactly 4, the deck empties", () => {
  const short = swipeBoard({ oppDeck: 3 });
  swipeCast(short);
  assert.equal(short.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(short.engine, P2), [], "all three voided");
  for (const i of [0, 1, 2]) assert.equal(zoneOf(short.engine, short.id(`t${i}`)), "void");
  const four = swipeBoard({ oppDeck: 4 });
  swipeCast(four);
  assert.deepEqual(deckOf(four.engine, P2), []);
  for (const i of [0, 1, 2, 3]) assert.equal(zoneOf(four.engine, four.id(`t${i}`)), "void");
});

// The reminder text ("You are still allowed to look at them") is information-only: the engine has no hidden-information
// layer, so nothing observable depends on it beyond the cards being face-down in the void (asserted above).

clause(SWIPE, "1:rule", "you may deploy a voided card as though in hand even without meeting its threshold: it costs its printed cost and enters under your control", () => {
  const b = swipeBoard({ extra: res({ rage: 3 }) });
  swipeCast(b);
  assert.equal(ready(b.engine), 3, "three ready rage left");
  play(b.engine, P1, b.id("t0"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("t0")), "play");
  assert.equal(controllerOf(b.engine, b.id("t0")), P1, "you control it");
  assert.equal(b.engine.state.cards[b.id("t0")].ownerId, P2);
  assert.equal(ready(b.engine), 2, "its printed cost 1 was paid: the threshold is waived, the cost is not");
  play(b.engine, P1, b.id("t3"));
  assert.equal(zoneOf(b.engine, b.id("t3")), "play", "every one of the 4 voided cards is deployable");
});

clause(SWIPE, "1:rule", "the cost must still be paid: with no ready resources a voided card cannot be deployed", () => {
  const b = swipeBoard();
  swipeCast(b);
  assert.equal(ready(b.engine), 0);
  refused(() => play(b.engine, P1, b.id("t1")), "cannot pay cost 1");
  assert.equal(zoneOf(b.engine, b.id("t1")), "void");
});

clause(SWIPE, "1:rule", "only the 4 cards voided by Pant Swipe are covered: other void cards, deck cards and opponent hand cards are not deployable", () => {
  const b = swipeBoard({ extra: res({ rage: 3 }) });
  swipeCast(b);
  refused(() => play(b.engine, P1, b.id("old")), "a card already in the void before the swipe is not granted");
  refused(() => play(b.engine, P1, b.id("t4")), "the fifth card is still in the deck");
  refused(() => play(b.engine, P1, b.id("phand")), "an opponent's hand card");
  play(b.engine, P1, b.id("t2")); // positive control
  assert.equal(zoneOf(b.engine, b.id("t2")), "play");
});

clause(SWIPE, "1:rule", "before the swipe resolves nothing is deployable from the void; the permission is yours alone (the opponent cannot deploy their own voided cards)", () => {
  const before = swipeBoard({ extra: res({ rage: 3 }) });
  refused(() => play(before.engine, P1, before.id("old")), "no grant before the swipe");
  const b = swipeBoard({ extra: [...res({ rage: 3 }), ...res({ rage: 3 }, P2)] });
  swipeCast(b);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  refused(() => play(b.engine, P2, b.id("t1")), "the opponent was not granted the permission");
  assert.equal(zoneOf(b.engine, b.id("t1")), "void");
});

clause(SWIPE, "1:rule", "for the rest of the game: still deployable several turns later and after Pant Swipe left the stack", () => {
  const b = swipeBoard({ extra: res({ rage: 3 }) });
  swipeCast(b);
  assert.equal(zoneOf(b.engine, b.id("ps")), "discard");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  play(b.engine, P1, b.id("t0"));
  assert.equal(zoneOf(b.engine, b.id("t0")), "play", "two turns later it still works");
  assert.equal(controllerOf(b.engine, b.id("t0")), P1);
});

clause(SWIPE, "2:flipUp", "FLIP UP 5 [D][D][D]: flips up with 4 other resources plus itself paying, voiding the top 4 and granting the deploy permission", () => {
  const b = swipeBoard({ swipeZone: "play", resources: [...res({ deception: 3 }), ...res({ rage: 1 })], extra: res({ rage: 2 }) });
  flipUpRaw(b.engine, P1, b.id("ps"), { voided: tops(b, 4) });
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const i of [0, 1, 2, 3]) assert.equal(zoneOf(b.engine, b.id(`t${i}`)), "void", `t${i} voided by the flip-up`);
  assert.deepEqual(deckOf(b.engine, P2), [b.id("t4"), b.id("t5")]);
  assert.equal(zoneOf(b.engine, b.id("ps")), "discard", "the tactic is done after it resolves");
  assert.ok(ready(b.engine) <= 2 && ready(b.engine) >= 1, "5 paid out of 7 ready (itself included): 2 left, or 1 if the card kept itself");
  play(b.engine, P1, b.id("t0"));
  assert.equal(zoneOf(b.engine, b.id("t0")), "play", "the grant works after a flip-up too");
});

clause(SWIPE, "2:flipUp", "FLIP UP cost is exactly 5: one short is refused; the threshold needs three [D] other than the card itself; spent icons do not pay", () => {
  const exact = swipeBoard({ swipeZone: "play", resources: [...res({ deception: 3 }), ...res({ rage: 1 })] });
  flipUpRaw(exact.engine, P1, exact.id("ps"), { voided: tops(exact, 4) });
  resolvePendingResponses(exact.engine);
  assert.equal(zoneOf(exact.engine, exact.id("t0")), "void", "3 [D] + 1 + itself = exactly 5 works");
  const short = swipeBoard({ swipeZone: "play", resources: [...res({ deception: 3 })] });
  refused(() => flipUpRaw(short.engine, P1, short.id("ps"), { voided: tops(short, 4) }), "3 banks + itself = 4 < 5");
  assert.equal(zoneOf(short.engine, short.id("t0")), "deck");
  const iconShort = swipeBoard({ swipeZone: "play", resources: [...res({ deception: 2 }), ...res({ rage: 2 })] });
  refused(() => flipUpRaw(iconShort.engine, P1, iconShort.id("ps"), { voided: tops(iconShort, 4) }), "5 ready but only two [D]: the card's own icon does not count");
  assert.equal(zoneOf(iconShort.engine, iconShort.id("t0")), "deck");
  const costShort = swipeBoard({ swipeZone: "play", resources: [...spent({ deception: 3 }), ...res({ rage: 3 })] });
  refused(() => flipUpRaw(costShort.engine, P1, costShort.id("ps"), { voided: tops(costShort, 4) }), "threshold met by spent icons but only 3 + itself = 4 ready", /FLIP UP costs cannot be paid\./);
  assert.equal(zoneOf(costShort.engine, costShort.id("t0")), "deck");
  const costOk = swipeBoard({ swipeZone: "play", resources: [...spent({ deception: 3 }), ...res({ rage: 4 })] });
  flipUpRaw(costOk.engine, P1, costOk.id("ps"), { voided: tops(costOk, 4) });
  resolvePendingResponses(costOk.engine);
  assert.equal(zoneOf(costOk.engine, costOk.id("t0")), "void", "spent icons satisfy the threshold, 4 + itself pay 5");
});

clause(SWIPE, "2:flipUp", "FLIP UP is a tactic's: allowed in the opponent's response window, refused on the opponent's turn with no window open", () => {
  const b = swipeBoard({
    swipeZone: "play",
    resources: [...res({ deception: 3 }), ...res({ rage: 1 })],
    active: P2,
    extra: [{ key: "atk", def: ch("Raider", { strength: 2, life: 2, speed: 2 }), owner: P2, zone: "play" }]
  });
  refused(() => flipUpRaw(b.engine, P1, b.id("ps"), { voided: tops(b, 4) }), "no response window open on the opponent's turn", /timing|active player/);
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  flipUpRaw(b.engine, P1, b.id("ps"), { voided: tops(b, 4) });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("t0")), "void", "flipped up in response to the attack");
});

// =============================================================================
// Peculate (Seed Saga) — Tactic, rogue, cost 0, [D][D][D]
//   EXTRA COST: Pick a character, item, or location in an opponent's discard pile. Pay X, where X is its numeric cost.
//   Put the card into play under your control.
// =============================================================================

const PEC = "613fbe92-3cd5-479e-9381-438f6455f76a";

function pecBoard(readyRage: number, threshold: CardPlacement[] = spent({ deception: 3 })) {
  return devBoard([
    { key: "pc", def: printing(PEC), owner: P1, zone: "hand" },
    { key: "c0", def: ch("Free Char", { cost: 0 }), owner: P2, zone: "discard" },
    { key: "c2", def: ch("Two Char", { cost: 2, strength: 2, life: 2, speed: 2 }), owner: P2, zone: "discard" },
    { key: "i3", def: item({ name: "Three Item", cost: 3 }), owner: P2, zone: "discard" },
    { key: "l1", def: location({ name: "One Place", cost: 1 }), owner: P2, zone: "discard" },
    { key: "tc", def: tactic({ name: "Dead Tactic", cost: 1 }), owner: P2, zone: "discard" },
    { key: "mine", def: ch("My Discard", { cost: 1 }), owner: P1, zone: "discard" },
    { key: "inplay", def: ch("In Play", { cost: 1 }), owner: P2, zone: "play" },
    { key: "hc", def: ch("In Hand", { cost: 1 }), owner: P2, zone: "hand" },
    ...fillers("dk", 3, P1, "deck", (i) => ch(`Deck ${i}`)),
    ...threshold,
    ...res({ rage: readyRage })
  ]);
}
const pecCast = (b: ReturnType<typeof pecBoard>, target: string) => play(b.engine, P1, b.id("pc"), { selected: { loot: [b.id(target)] } });

clause(PEC, "0:extraCost", "printed cost 0 / [D][D][D] tactic: needs three [D]; the pick's X is the only cost; two [D] is refused", () => {
  const def = printing(PEC);
  assert.equal(def.type, "tactic");
  assert.equal(def.trade, "rogue");
  const free = pecBoard(0);
  const before = ready(free.engine);
  pecCast(free, "c0");
  assert.equal(zoneOf(free.engine, free.id("c0")), "play", "cost 0 target, 0 resources: [D][D][D] alone casts it");
  assert.equal(before - ready(free.engine), 0, "the tactic's own cost is 0");
  const iconShort = pecBoard(5, spent({ deception: 2 }));
  refused(() => pecCast(iconShort, "c0"), "only two [D]");
  assert.equal(zoneOf(iconShort.engine, iconShort.id("c0")), "discard");
  const noIcons = pecBoard(5, []);
  refused(() => pecCast(noIcons, "c0"), "no [D] at all");
  const readyIcons = pecBoard(0, res({ deception: 3 }));
  pecCast(readyIcons, "c0");
  assert.equal(zoneOf(readyIcons.engine, readyIcons.id("c0")), "play", "ready [D] count for the threshold too");
});

clause(PEC, "0:extraCost", "pays X equal to the picked card's numeric cost: 0, 1, 2 and 3 for a character, location, character and item", () => {
  for (const [target, x] of [["c0", 0], ["l1", 1], ["c2", 2], ["i3", 3]] as const) {
    const b = pecBoard(4);
    const before = ready(b.engine);
    pecCast(b, target);
    assert.equal(zoneOf(b.engine, b.id(target)), "play", `${target} enters play`);
    assert.equal(before - ready(b.engine), x, `${target} costs X=${x}`);
  }
});

clause(PEC, "0:extraCost", "X is already paid when the cast is made (before it resolves)", () => {
  const b = pecBoard(4);
  const before = ready(b.engine);
  playRaw(b.engine, P1, b.id("pc"), { selected: { loot: [b.id("c2")] } });
  assert.equal(before - ready(b.engine), 2, "the extra cost is paid on casting");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("c2")), "play");
});

clause(PEC, "0:extraCost", "one resource short of X is refused and nothing moves or is paid; exactly X works", () => {
  const b = pecBoard(1);
  refused(() => pecCast(b, "c2"), "needs 2, has 1");
  assert.equal(zoneOf(b.engine, b.id("c2")), "discard");
  assert.equal(zoneOf(b.engine, b.id("pc")), "hand");
  assert.equal(ready(b.engine), 1, "nothing paid");
  refused(() => pecCast(pecBoard(2), "i3"), "needs 3, has 2");
  const ok = pecBoard(2);
  pecCast(ok, "c2");
  assert.equal(zoneOf(ok.engine, ok.id("c2")), "play", "exactly X");
  assert.equal(ready(ok.engine), 0);
});

clause(PEC, "0:extraCost", "the pick must be a character, item or location in an OPPONENT's discard pile: your own discard, their tactics, their play zone and hand are refused; no pick is refused", () => {
  const b = pecBoard(4);
  refused(() => pecCast(b, "mine"), "your own discard pile");
  refused(() => pecCast(b, "tc"), "a tactic is not a character, item or location");
  refused(() => pecCast(b, "inplay"), "a card in play");
  refused(() => pecCast(b, "hc"), "a card in hand");
  refused(() => play(b.engine, P1, b.id("pc")), "extra cost pick is required");
  assert.equal(zoneOf(b.engine, b.id("pc")), "hand");
  assert.equal(ready(b.engine), 4);
  for (const target of ["c2", "i3", "l1", "c0"]) {
    const ok = pecBoard(4);
    pecCast(ok, target);
    assert.equal(zoneOf(ok.engine, ok.id(target)), "play", `${target} is a legal pick`);
  }
});

clause(PEC, "1:rule", "puts the card into play under your control (a character, an item and a location); the opponent keeps ownership; other discards stay", () => {
  for (const target of ["c2", "i3", "l1"]) {
    const b = pecBoard(4);
    pecCast(b, target);
    assert.equal(b.engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(b.engine, b.id(target)), "play");
    assert.equal(controllerOf(b.engine, b.id(target)), P1, `${target} is yours`);
    assert.equal(b.engine.state.cards[b.id(target)].ownerId, P2);
    assert.ok(b.engine.state.players[P1].play.includes(b.id(target)), "b.engine.state.players[P1].play.includes(b.id(target))");
    assert.ok(!b.engine.state.players[P2].discard.includes(b.id(target)), "left their discard pile");
    for (const other of ["c0", "c2", "i3", "l1"].filter((k) => k !== target)) assert.equal(zoneOf(b.engine, b.id(other)), "discard", `${other} stays in the discard pile`);
  }
  const b = pecBoard(4);
  pecCast(b, "c2");
  assert.equal(b.engine.getStat(b.id("c2"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("c2"), "life"), 2);
  assert.equal(zoneOf(b.engine, b.id("pc")), "discard");
});

// =============================================================================
// Rigged Tables (Seed Saga) — Item, rogue, cost 0, [D][D]
//   SIZE UP -- COST: Deplete this card. Look at the top card of any deck.
//   RIG -- COST: Pay 1. Put the top card of any deck on the bottom.
//   WALK AWAY -- COST: Pay 1. Destroy this card. Draw a card.
// =============================================================================

const TABLES = "4c1790d7-4cc7-4df5-aa33-2e7369bd960d";

function tablesBoard(readyRage = 2, extra: CardPlacement[] = [], zone: "play" | "hand" = "play") {
  return devBoard([
    { key: "rt", def: printing(TABLES), owner: P1, zone },
    ...fillers("a", 3, P1, "deck", (i) => ch(`Mine ${i}`)),
    ...fillers("b", 3, P2, "deck", (i) => ch(`Theirs ${i}`)),
    ...spent({ deception: 2 }),
    ...res({ rage: readyRage }),
    ...extra
  ]);
}

clause(TABLES, "0:ability:size-up", "printed cost 0 / [D][D] item: [D][D] (even spent) deploys it for free; one [D] short is refused", () => {
  const def = printing(TABLES);
  assert.equal(def.type, "item");
  assert.equal(def.trade, "rogue");
  const free = deployProbe(TABLES, spent({ deception: 2 }));
  assert.deepEqual([free.entered, free.paid], [true, 0], "[D][D] with nothing ready: cost 0");
  const ready3 = deployProbe(TABLES, [...res({ deception: 2 }), ...res({ rage: 3 })]);
  assert.deepEqual([ready3.entered, ready3.paid], [true, 0], "extra resources are not spent");
  const oneD = deployProbe(TABLES, [...res({ deception: 1 }), ...res({ rage: 3 })]);
  assert.equal(oneD.entered, false, "one [D] only");
  assert.equal(oneD.refusedPlay, true);
  const none = deployProbe(TABLES, res({ rage: 4 }));
  assert.equal(none.entered, false, "no [D]");
});

const sizeUp = (b: ReturnType<typeof tablesBoard>, deckIndex: number) => {
  actRaw(b.engine, P1, b.id("rt"), "size-up");
  resolvePendingResponses(b.engine);
  const pc = expectPending(b.engine, "chooserSelectsOption");
  assert.equal(pc.playerId, P1, "the controller chooses which deck");
  choose(b.engine, { kind: "chooserSelectsOption", index: deckIndex });
};

clause(TABLES, "0:ability:size-up", "SIZE UP: deplete cost; you choose a deck and look at exactly its top card (yours or the opponent's); neither deck changes", () => {
  for (const [idx, owner, deckKeys] of [[0, P1, ["a0", "a1", "a2"]], [1, P2, ["b0", "b1", "b2"]]] as const) {
    const b = tablesBoard();
    sizeUp(b, idx);
    assert.equal(isDepleted(b.engine, b.id("rt")), true, "COST: deplete this card");
    const pc = expectPending(b.engine, "reorderDeck");
    assert.equal(pc.playerId, P1, "you look");
    assert.deepEqual(pc.cardIds, [b.id(deckKeys[0])], `only the top card of ${owner}'s deck`);
    drain(b.engine, declineAll);
    assert.equal(b.engine.state.pendingChoice, undefined);
    assert.deepEqual(deckOf(b.engine, P1), ["a0", "a1", "a2"].map((k) => b.id(k)), "your deck unchanged");
    assert.deepEqual(deckOf(b.engine, P2), ["b0", "b1", "b2"].map((k) => b.id(k)), "their deck unchanged");
    assert.equal(ready(b.engine), 2, "no resources paid");
  }
});

clause(TABLES, "0:ability:size-up", "SIZE UP cannot be used while depleted, and cannot be used by the opponent on their own turn", () => {
  const b = tablesBoard();
  b.engine.state.cards[b.id("rt")].depleted = true;
  refused(() => actRaw(b.engine, P1, b.id("rt"), "size-up"), "depleted", /deplet|ready|cost/i);
  const c = tablesBoard();
  actRaw(c.engine, P1, c.id("rt"), "size-up"); // positive control
  assert.equal(isDepleted(c.engine, c.id("rt")), true);
  const o = tablesBoard(2, [], "play");
  endTurn(o.engine, P1);
  refused(() => actRaw(o.engine, P2, o.id("rt"), "size-up"), "not P2's card", /control|priority|window|turn|not/i);
});

clause(TABLES, "1:ability:rig", "RIG: pay 1; you choose a deck and its top card goes to the bottom; the other deck is untouched; the item is not depleted", () => {
  const mine = tablesBoard();
  actRaw(mine.engine, P1, mine.id("rt"), "rig");
  resolvePendingResponses(mine.engine);
  choose(mine.engine, { kind: "chooserSelectsOption", index: 0 });
  assert.equal(mine.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(mine.engine, P1), ["a1", "a2", "a0"].map((k) => mine.id(k)), "your top card went to the bottom");
  assert.deepEqual(deckOf(mine.engine, P2), ["b0", "b1", "b2"].map((k) => mine.id(k)), "their deck untouched");
  assert.equal(ready(mine.engine), 1, "COST: pay exactly 1");
  assert.equal(isDepleted(mine.engine, mine.id("rt")), false, "RIG does not deplete");
  const theirs = tablesBoard();
  actRaw(theirs.engine, P1, theirs.id("rt"), "rig");
  resolvePendingResponses(theirs.engine);
  choose(theirs.engine, { kind: "chooserSelectsOption", index: 1 });
  assert.deepEqual(deckOf(theirs.engine, P2), ["b1", "b2", "b0"].map((k) => theirs.id(k)), "their top card went to the bottom");
  assert.deepEqual(deckOf(theirs.engine, P1), ["a0", "a1", "a2"].map((k) => theirs.id(k)), "your deck untouched");
  assert.equal(ready(theirs.engine), 1);
});

clause(TABLES, "1:ability:rig", "RIG needs 1 ready resource and works while the item is depleted", () => {
  const none = tablesBoard(0);
  refused(() => actRaw(none.engine, P1, none.id("rt"), "rig"), "no ready resource to pay 1");
  assert.deepEqual(deckOf(none.engine, P1), ["a0", "a1", "a2"].map((k) => none.id(k)));
  const dep = tablesBoard(1);
  dep.engine.state.cards[dep.id("rt")].depleted = true;
  actRaw(dep.engine, P1, dep.id("rt"), "rig");
  resolvePendingResponses(dep.engine);
  choose(dep.engine, { kind: "chooserSelectsOption", index: 0 });
  assert.deepEqual(deckOf(dep.engine, P1), ["a1", "a2", "a0"].map((k) => dep.id(k)), "works depleted");
  assert.equal(ready(dep.engine), 0);
});

clause(TABLES, "2:ability:walk-away", "WALK AWAY: pay 1 and destroy this card, then you draw a card (the top of your deck)", () => {
  const b = tablesBoard();
  const top = deckOf(b.engine, P1)[0];
  activate(b.engine, P1, b.id("rt"), "walk-away");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("rt")), "discard", "COST: destroyed");
  assert.equal(ready(b.engine), 1, "COST: exactly 1 paid");
  assert.deepEqual(handOf(b.engine, P1), [top], "drew exactly the top card");
  assert.equal(deckOf(b.engine, P1).length, 2);
  assert.equal(deckOf(b.engine, P2).length, 3, "their deck untouched");
});

clause(TABLES, "2:ability:walk-away", "WALK AWAY with no ready resource is refused and the item stays; it works while depleted", () => {
  const none = tablesBoard(0);
  refused(() => actRaw(none.engine, P1, none.id("rt"), "walk-away"), "cannot pay 1");
  assert.equal(zoneOf(none.engine, none.id("rt")), "play");
  assert.deepEqual(handOf(none.engine, P1), []);
  const dep = tablesBoard(1);
  dep.engine.state.cards[dep.id("rt")].depleted = true;
  activate(dep.engine, P1, dep.id("rt"), "walk-away");
  assert.equal(zoneOf(dep.engine, dep.id("rt")), "discard", "depleted does not matter");
  assert.equal(handOf(dep.engine, P1).length, 1);
});

// =============================================================================
// Rosy Palmer, and Her Five Friends (Seed Saga) — Character, rogue, dancer, cost 6, [D][D], 4/4/4
//   UNIQUE ROSY
//   When this card is destroyed, reveal the top 5 cards of an opponent's deck. You may choose a revealed character.
//   If you do, put it into play under your control. That player puts the remaining cards on the bottom of their deck in any order.
// =============================================================================

const ROSY = "fdfd2018-584b-4fa7-b9d9-e29f7961337a";

/** Opponent deck x0..x7: x0 char, x1 item, x2 char, x3 tactic, x4 char, x5 char (6th card), x6 char, x7 item. */
function rosyDeck(owner: PlayerId): CardPlacement[] {
  const defs: CardDefinition[] = [
    ch("X0", { strength: 3, life: 3 }),
    item({ name: "X1" }),
    ch("X2", { strength: 2, life: 2 }),
    tactic({ name: "X3" }),
    ch("X4"),
    ch("X5"),
    ch("X6"),
    item({ name: "X7" })
  ];
  return defs.map((def, i) => ({ key: `x${i}`, def, owner, zone: "deck" as const }));
}

function rosyBoard(opts: { extra?: CardPlacement[]; mineIsP2?: boolean; deckCards?: CardPlacement[] } = {}) {
  const rosyOwner = opts.mineIsP2 ? P2 : P1;
  const other = opts.mineIsP2 ? P1 : P2;
  return devBoard(
    [
      { key: "ro", def: printing(ROSY), owner: rosyOwner, zone: "play" },
      { key: "kill", def: killTactic(), owner: rosyOwner, zone: "hand" },
      { key: "bystander", def: ch("Bystander"), owner: rosyOwner, zone: "play" },
      ...(opts.deckCards ?? rosyDeck(other)),
      ...fillers("mk", 3, rosyOwner, "deck", (i) => ch(`Own ${i}`)),
      ...(opts.extra ?? [])
    ],
    opts.mineIsP2 ? { activePlayerId: P2 } : {}
  );
}
const rosyKill = (b: ReturnType<typeof rosyBoard>, target = "ro", player: PlayerId = P1) =>
  play(b.engine, player, b.id("kill"), { selected: { t: [b.id(target)] } });

/** Answer script: pick `grab` (or nothing) for the chooserSelectsTarget; reorder the bottom cards as `order` (default reversed). */
function rosyAnswers(b: ReturnType<typeof rosyBoard>, grab: string | null, order?: string[]) {
  const seen: PendingChoiceLike[] = [];
  const answer = (pc: PendingChoiceLike): unknown => {
    seen.push(pc);
    if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: grab ? [b.id(grab)] : [] };
    if (pc.kind === "reorderDeck") {
      const ids = [...(pc.cardIds as string[])];
      return { kind: "reorderDeck", order: order ? order.map((k) => b.id(k)) : ids.reverse() };
    }
    return declineAll(pc);
  };
  return { answer, seen };
}

clause(ROSY, "0:unique", "printed cost 6 / [D][D]: exactly 6 resources with two [D] deploys and pays 6; one short, one [D] short, or cost short behind spent icons is refused", () => {
  const ok = deployProbe(ROSY, [...res({ deception: 2 }), ...res({ rage: 4 })]);
  assert.deepEqual([ok.entered, ok.paid], [true, 6]);
  assert.equal(deployProbe(ROSY, [...res({ deception: 2 }), ...res({ rage: 3 })]).entered, false, "five resources: one short");
  assert.equal(deployProbe(ROSY, [...res({ deception: 1 }), ...res({ rage: 5 })]).entered, false, "six resources, one [D]");
  assert.equal(deployProbe(ROSY, res({ rage: 7 })).entered, false, "no [D]");
  assert.equal(deployProbe(ROSY, [...spent({ deception: 2 }), ...res({ rage: 5 })]).entered, false, "threshold via spent icons, 5 ready: cost is 6");
  const spentOk = deployProbe(ROSY, [...spent({ deception: 2 }), ...res({ rage: 6 })]);
  assert.deepEqual([spentOk.entered, spentOk.paid], [true, 6]);
});

clause(ROSY, "0:unique", "is a rogue dancer character with strength 4, life 4, speed 4", () => {
  const b = rosyBoard();
  const def = b.engine.getDefinition(b.id("ro"));
  assert.equal(def.type, "character");
  assert.equal(def.trade, "rogue");
  assert.deepEqual(def.subtype, ["dancer"]);
  assert.deepEqual([b.engine.getStat(b.id("ro"), "strength"), b.engine.getStat(b.id("ro"), "life"), b.engine.getStat(b.id("ro"), "speed")], [4, 4, 4]);
});

clause(ROSY, "0:unique", "UNIQUE ROSY: deploying a second Rosy asks the controller which to keep; the other is destroyed", () => {
  for (const keepNew of [true, false]) {
    const b = rosyBoard({ extra: [{ key: "ro2", def: printing(ROSY), owner: P1, zone: "hand" }, ...res({ deception: 2 }), ...res({ rage: 4 })] });
    play(b.engine, P1, b.id("ro2"));
    const pc = expectPending(b.engine, "uniqueSurvivor");
    assert.equal(pc.playerId, P1, "the controller chooses");
    assert.deepEqual([...(pc.candidates as string[])].sort(), [b.id("ro"), b.id("ro2")].sort());
    // answer the survivor choice only; the destroyed copy's own trigger then asks its follow-up questions
    choose(b.engine, { kind: "uniqueSurvivor", keep: b.id(keepNew ? "ro2" : "ro") });
    assert.equal(zoneOf(b.engine, b.id(keepNew ? "ro" : "ro2")), "discard", "the other copy is destroyed");
    assert.equal(zoneOf(b.engine, b.id(keepNew ? "ro2" : "ro")), "play");
  }
});

clause(ROSY, "0:unique", "UNIQUE is per player: the opponent may control their own Rosy at the same time with no choice", () => {
  const b = rosyBoard({ extra: [{ key: "ro2", def: printing(ROSY), owner: P2, zone: "play" }] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("ro")), "play");
  assert.equal(zoneOf(b.engine, b.id("ro2")), "play");
});

clause(ROSY, "1:rule", "when destroyed: reveals the top 5 of the opponent's deck and you choose one revealed character, which enters play under your control", () => {
  const b = rosyBoard();
  rosyKill(b);
  assert.equal(zoneOf(b.engine, b.id("ro")), "discard");
  const pc = expectPending(b.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "you choose");
  const { answer } = rosyAnswers(b, "x2");
  drain(b.engine, answer);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("x2")), "play", "the chosen revealed character is in play");
  assert.equal(controllerOf(b.engine, b.id("x2")), P1, "under your control");
  assert.equal(b.engine.state.cards[b.id("x2")].ownerId, P2);
  assert.ok(b.engine.state.players[P1].play.includes(b.id("x2")), "b.engine.state.players[P1].play.includes(b.id(\"x2\"))");
});

clause(ROSY, "1:rule", "only the top 5 are revealed: the 6th and later characters are not choosable; items and tactics among the 5 are not choosable", () => {
  const picks = (grab: string) => {
    const b = rosyBoard();
    rosyKill(b);
    const pc = expectPending(b.engine, "chooserSelectsTarget");
    try {
      choose(b.engine, { kind: "chooserSelectsTarget", selected: [b.id(grab)] });
    } catch {
      return { ok: false, b, pc };
    }
    return { ok: zoneOf(b.engine, b.id(grab)) === "play", b, pc };
  };
  for (const legal of ["x0", "x2", "x4"]) assert.equal(picks(legal).ok, true, `${legal} is a revealed character`);
  for (const illegal of ["x1", "x3", "x5", "x6", "x7"]) {
    const r = picks(illegal);
    assert.equal(r.ok, false, `${illegal} is not a revealed character`);
    assert.notEqual(zoneOf(r.b.engine, r.b.id(illegal)), "play");
  }
});

clause(ROSY, "1:rule", "you choose at most one revealed character: picking two is refused and nothing is taken", () => {
  const b = rosyBoard();
  rosyKill(b);
  expectPending(b.engine, "chooserSelectsTarget");
  refused(() => choose(b.engine, { kind: "chooserSelectsTarget", selected: [b.id("x0"), b.id("x2")] }), "two characters picked");
  assert.deepEqual(["x0", "x2"].map((k) => zoneOf(b.engine, b.id(k))), ["deck", "deck"]);
  choose(b.engine, { kind: "chooserSelectsTarget", selected: [b.id("x0")] }); // positive control
  assert.equal(zoneOf(b.engine, b.id("x0")), "play");
});

clause(ROSY, "1:rule", "reveals exactly the top 5 cards of the opponent's deck (a reveal event naming x0..x4 and their owner), not your own deck", () => {
  const b = rosyBoard();
  rosyKill(b);
  const reveals = b.engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed").map((entry) => entry.event as unknown as { cardIds: string[]; ownerId: string });
  assert.equal(reveals.length, 1);
  assert.deepEqual(reveals[0].cardIds, ["x0", "x1", "x2", "x3", "x4"].map((k) => b.id(k)), "the top five, in order");
  assert.equal(reveals[0].ownerId, P2, "the opponent's deck");
});

clause(ROSY, "0:unique", "UNIQUE ROSY only conflicts with another Rosy: a character with a different UNIQUE name coexists without a choice", () => {
  const b = rosyBoard({ extra: [{ key: "other", def: ch("Other Unique", { unique: "somebody-else" } as Partial<CardDefinition>), owner: P1, zone: "play" }] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("ro")), "play");
  assert.equal(zoneOf(b.engine, b.id("other")), "play");
});

clause(ROSY, "1:rule", "'You may': declining takes nothing, and every one of the 5 revealed cards goes to the bottom of their deck", () => {
  const b = rosyBoard();
  rosyKill(b);
  const { answer } = rosyAnswers(b, null, ["x0", "x1", "x2", "x3", "x4"]);
  drain(b.engine, answer);
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const i of [0, 2, 4]) assert.notEqual(zoneOf(b.engine, b.id(`x${i}`)), "play", `x${i} not taken`);
  assert.deepEqual(deckOf(b.engine, P2), ["x5", "x6", "x7", "x0", "x1", "x2", "x3", "x4"].map((k) => b.id(k)), "6th..8th on top, the revealed 5 on the bottom in the chosen order");
});

clause(ROSY, "1:rule", "the remaining 4 revealed cards go to the bottom of the opponent's deck, in the order THEY choose; the chosen card is gone from the deck", () => {
  const b = rosyBoard();
  rosyKill(b);
  const { answer, seen } = rosyAnswers(b, "x2", ["x4", "x3", "x1", "x0"]);
  drain(b.engine, answer);
  const reorder = seen.find((pc) => pc.kind === "reorderDeck");
  assert.ok(reorder, "a reorder prompt was shown");
  assert.equal(reorder.playerId, P2, "that player puts the remaining cards on the bottom");
  assert.deepEqual([...(reorder.cardIds as string[])].sort(), ["x0", "x1", "x3", "x4"].map((k) => b.id(k)).sort(), "only the 4 remaining revealed cards");
  assert.deepEqual(deckOf(b.engine, P2), ["x5", "x6", "x7", "x4", "x3", "x1", "x0"].map((k) => b.id(k)), "unrevealed cards on top, then the chosen order");
  assert.deepEqual(deckOf(b.engine, P1).length, 3, "your own deck is not touched");
});

clause(ROSY, "1:rule", "a different order is honoured (not always the original or reversed one)", () => {
  const b = rosyBoard();
  rosyKill(b);
  const { answer } = rosyAnswers(b, "x0", ["x3", "x1", "x4", "x2"]);
  drain(b.engine, answer);
  assert.deepEqual(deckOf(b.engine, P2), ["x5", "x6", "x7", "x3", "x1", "x4", "x2"].map((k) => b.id(k)));
  assert.equal(controllerOf(b.engine, b.id("x0")), P1);
});

clause(ROSY, "1:rule", "triggers for the controller whoever owns it: a Rosy controlled by the opponent reveals YOUR deck's top 5 for them", () => {
  const b = rosyBoard({ mineIsP2: true });
  rosyKill(b, "ro", P2);
  const pc = expectPending(b.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the Rosy's controller chooses");
  const { answer } = rosyAnswers(b, "x2");
  drain(b.engine, answer);
  assert.equal(zoneOf(b.engine, b.id("x2")), "play");
  assert.equal(controllerOf(b.engine, b.id("x2")), P2);
  assert.equal(deckOf(b.engine, P2).length, 3, "the Rosy controller's own deck is untouched");
  assert.equal(deckOf(b.engine, P1).length, 7, "revealed 5, 1 taken: the 7 other cards remain");
});

clause(ROSY, "1:rule", "a smaller deck: with only 3 cards, reveals those 3 and the choice is among them", () => {
  const small = rosyDeck(P2).slice(0, 3);
  const b = rosyBoard({ deckCards: small });
  rosyKill(b);
  const { answer } = rosyAnswers(b, "x2");
  drain(b.engine, answer);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("x2")), "play");
  assert.deepEqual(deckOf(b.engine, P2).length, 2);
});

clause(ROSY, "1:rule", "does not trigger when another card is destroyed", () => {
  const b = rosyBoard();
  const before = deckOf(b.engine, P2);
  rosyKill(b, "bystander");
  assert.equal(zoneOf(b.engine, b.id("bystander")), "discard");
  assert.equal(zoneOf(b.engine, b.id("ro")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(b.engine, P2), before, "no reveal, no reorder");
});

clause(ROSY, "1:rule", "triggers when destroyed in battle too, not only by a tactic", () => {
  const b = rosyBoard({ extra: [{ key: "atk", def: ch("Brute", { strength: 9, life: 9, speed: 1 }), owner: P2, zone: "play" }] });
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  fightThrough(b.engine, P2, [b.id("atk")], { type: "faction", playerId: P1 }, [b.id("ro")], undefined, rosyAnswers(b, "x2").answer);
  assert.equal(zoneOf(b.engine, b.id("ro")), "discard", "Rosy died in the fight");
  drain(b.engine, rosyAnswers(b, "x2").answer);
  assert.equal(zoneOf(b.engine, b.id("x2")), "play", "its trigger took a character");
});
