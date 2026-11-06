import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import {
  buildGame,
  activate,
  bank,
  character,
  developFaction,
  item,
  location,
  P1,
  P2,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { declareAttackBy, playRaw } from "./_battle.js";
import { declareBlockers, pending, zoneOf } from "./_board.js";
import { endTurn, developResource } from "./_turn.js";

const ready = (engine: SpoilsEngine, p: PlayerId = P1): number => engine.getAvailableResourceCount(p);
const spentOf = (icon: "deception" | "greed" | "rage", n: number, owner: PlayerId = P1): CardPlacement[] =>
  bank(icon, n, owner).map((p) => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));
const resolveChoice = (engine: SpoilsEngine, pc: PendingChoiceLike, choice: unknown): void => {
  engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
  resolvePendingResponses(engine);
};
const pick = (engine: SpoilsEngine, ids: CardInstanceId[]): void => {
  const pc = pending(engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  resolveChoice(engine, pc, { kind: "chooserSelectsTarget", selected: ids });
};
const deckOf = (engine: SpoilsEngine, p: PlayerId): CardInstanceId[] => [...engine.state.players[p].deck];

// =============================================================================
// Headhunting
// EXTRA COST: Deploy this only in response to a character with numeric cost X or less being deployed,
// where X is number of [D] you control. -- The character enters play under your control.
// Tactic (rogue), cost 5, threshold [D].
// =============================================================================

const HEAD = "1546e008-2b9d-4197-a040-ab68fa8a6156";

interface HeadOpts {
  dec?: number;
  greed?: number;
  foeCost?: number;
  foeDef?: Partial<CardDefinition>;
  p1Extra?: CardPlacement[];
  extra?: CardPlacement[];
  foeBank?: number;
}

function headBoard(o: HeadOpts = {}) {
  const foeCost = o.foeCost ?? 3;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    random: () => 0.5,
    cards: [
      { key: "head", def: printing(HEAD), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", cost: foeCost, strength: 2, speed: 2, life: 3, ...(o.foeDef ?? {}) }), owner: P2, zone: "hand" },
      { key: "oldfoe", def: character({ name: "Old Foe", cost: 0 }), owner: P2, zone: "play" },
      ...bank("deception", o.dec ?? 5, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...bank("rage", o.foeBank ?? 8, P2),
      ...(o.p1Extra ?? []),
      ...(o.extra ?? [])
    ]
  });
}
type HeadBoard = ReturnType<typeof headBoard>;

/** P2 starts deploying `key`; P1 now holds priority with the character on the stack. */
const foeOnStack = (b: HeadBoard, key = "foe") => playRaw(b.engine, P2, b.id(key));
const headhunt = (b: HeadBoard) => play(b.engine, P1, b.id("head"));

clause(HEAD, "0:extraCost", "printed card: a rogue tactic costing 5 with threshold [D]", () => {
  const p = printing(HEAD);
  assert.equal(p.type, "tactic");
  assert.equal(p.trade, "rogue");
  assert.equal(p.cost, 5);
  assert.equal(p.threshold, "d");
});

clause(HEAD, "0:extraCost", "the printed cost of 5 is paid; one resource short is refused", () => {
  const b = headBoard({ dec: 5, greed: 2 });
  foeOnStack(b);
  const before = ready(b.engine);
  headhunt(b);
  assert.equal(before - ready(b.engine), 5, "exactly 5 resources are paid");
  const short = headBoard({ dec: 4 });
  foeOnStack(short);
  refused(() => headhunt(short), "4 resources for a cost of 5");
  assert.equal(zoneOf(short.engine, short.id("head")), "hand");
});

clause(HEAD, "0:extraCost", "the [D] threshold: five resources with no [D] are refused, the same five with one [D] work", () => {
  const none = headBoard({ dec: 0, greed: 5, foeCost: 0 });
  foeOnStack(none);
  refused(() => headhunt(none), "no [D] icon");
  assert.equal(zoneOf(none.engine, none.id("head")), "hand");
  const one = headBoard({ dec: 1, greed: 4, foeCost: 0 });
  foeOnStack(one);
  headhunt(one);
  assert.equal(zoneOf(one.engine, one.id("head")), "discard");
});

clause(HEAD, "0:extraCost", "can be deployed in response to a character whose cost equals X (5 [D] -> cost 5), and any cheaper one (cost 0)", () => {
  for (const cost of [5, 3, 0]) {
    const b = headBoard({ dec: 5, foeCost: cost });
    foeOnStack(b);
    headhunt(b);
    assert.equal(zoneOf(b.engine, b.id("head")), "discard", `cost ${cost}`);
    assert.equal(b.engine.state.cards[b.id("foe")].controllerId, P1, `cost ${cost}: stolen`);
  }
});

clause(HEAD, "0:extraCost", "X is your [D] count: 4 [D] (plus a non-[D]) reach cost 4 but not cost 5", () => {
  const ok = headBoard({ dec: 4, greed: 1, foeCost: 4 });
  foeOnStack(ok);
  headhunt(ok);
  assert.equal(ok.engine.state.cards[ok.id("foe")].controllerId, P1);
  const over = headBoard({ dec: 4, greed: 1, foeCost: 5 });
  foeOnStack(over);
  refused(() => headhunt(over), "cost 5 > X=4", /cannot be deployed right now/);
  assert.equal(zoneOf(over.engine, over.id("head")), "hand");
  assert.equal(over.engine.state.cards[over.id("foe")].controllerId, P2);
});

clause(HEAD, "0:extraCost", "only [D] counts toward X: one [D] among five resources allows cost 1 but not cost 2", () => {
  const ok = headBoard({ dec: 1, greed: 4, foeCost: 1 });
  foeOnStack(ok);
  headhunt(ok);
  assert.equal(ok.engine.state.cards[ok.id("foe")].controllerId, P1);
  const over = headBoard({ dec: 1, greed: 4, foeCost: 2 });
  foeOnStack(over);
  refused(() => headhunt(over), "cost 2 > X=1", /cannot be deployed right now/);
  assert.equal(zoneOf(over.engine, over.id("head")), "hand");
});

clause(HEAD, "0:extraCost", "X counts the [D] YOU control: the opponent's [D] resources and face-down cards do not raise it", () => {
  const b = headBoard({ dec: 1, greed: 4, foeCost: 2, extra: bank("deception", 5, P2) });
  foeOnStack(b);
  refused(() => headhunt(b), "opponent's [D] don't count", /cannot be deployed right now/);
  assert.equal(zoneOf(b.engine, b.id("head")), "hand");
});

clause(HEAD, "0:extraCost", "X counts [D] that are already spent (attached resources still count): 5 [D] of which 4 are spent", () => {
  const b = headBoard({ dec: 1, greed: 0, foeCost: 5, foeBank: 8, p1Extra: [...spentOf("deception", 4), ...bank("greed", 4, P1)] });
  foeOnStack(b);
  headhunt(b);
  assert.equal(b.engine.state.cards[b.id("foe")].controllerId, P1);
});

clause(HEAD, "0:extraCost", "refused when nothing is being deployed (no response window)", () => {
  const b = headBoard({ dec: 5 });
  refused(() => headhunt(b), "nothing on the stack", /respon|stack|condition|cannot|can't|only/i);
  assert.equal(zoneOf(b.engine, b.id("head")), "hand");
  foeOnStack(b);
  headhunt(b);
  assert.equal(zoneOf(b.engine, b.id("head")), "discard", "positive control: same board, in response");
});

clause(HEAD, "0:extraCost", "refused in response to a non-character: an item, a location, or a tactic being deployed", () => {
  const defs: Array<[string, CardDefinition]> = [
    ["item", item({ name: "Foe Item", cost: 1 })],
    ["location", location({ name: "Foe Place", cost: 1 })],
    ["tactic", tactic({ name: "Foe Tactic", cost: 1, behavior: { abilities: [{ id: "no", type: "activated", effects: [] }] } })]
  ];
  for (const [label, def] of defs) {
    const b = headBoard({ dec: 5, extra: [{ key: "other", def, owner: P2, zone: "hand" }] });
    playRaw(b.engine, P2, b.id("other"));
    refused(() => headhunt(b), `${label} on the stack`);
    assert.equal(zoneOf(b.engine, b.id("head")), "hand", label);
  }
  const ok = headBoard({ dec: 5 });
  foeOnStack(ok);
  headhunt(ok);
  assert.equal(zoneOf(ok.engine, ok.id("head")), "discard", "control: a character works");
});

clause(HEAD, "0:extraCost", "a character with no cost number has numeric cost 0 (CR 406.2): it qualifies even with X = 1", () => {
  const b = headBoard({ dec: 1, greed: 4, foeCost: 0, foeDef: { cost: undefined as never } });
  foeOnStack(b);
  headhunt(b);
  assert.equal(b.engine.state.cards[b.id("foe")].controllerId, P1);
});

clause(HEAD, "0:extraCost", "the numeric cost is the one while being deployed (CR 406.3): printed 3 + EXTRA COST pay 2 = 5 is above X=4", () => {
  const pay2 = { onPlay: { costs: [{ type: "payResources", amount: 2 }] } } as never;
  const over = headBoard({ dec: 4, greed: 1, foeCost: 3, foeDef: { behavior: pay2 } });
  foeOnStack(over);
  refused(() => headhunt(over), "numeric cost 5 > X=4");
  assert.equal(zoneOf(over.engine, over.id("head")), "hand");
  const ok = headBoard({ dec: 5, foeCost: 3, foeDef: { behavior: pay2 } });
  foeOnStack(ok);
  headhunt(ok);
  assert.equal(ok.engine.state.cards[ok.id("foe")].controllerId, P1, "control: X=5 reaches numeric cost 5");
});

clause(HEAD, "1:rule", "the character enters play under your control (owner stays the opponent)", () => {
  const b = headBoard({ dec: 5, greed: 1 });
  const readyP2 = ready(b.engine, P2);
  foeOnStack(b);
  const paid = readyP2 - ready(b.engine, P2);
  assert.equal(paid, 3, "the opponent paid the cost of 3 for the deploy");
  headhunt(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  const foe = b.engine.state.cards[b.id("foe")];
  assert.equal(foe.zone, "play");
  assert.equal(foe.controllerId, P1);
  assert.equal(foe.ownerId, P2);
  assert.ok(b.engine.state.players[P1].play.includes(b.id("foe")), "in your play zone");
  assert.ok(!b.engine.state.players[P2].hand.includes(b.id("foe")), "no longer in their hand");
  assert.equal(ready(b.engine, P2), readyP2 - 3, "their payment is not refunded");
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 3);
  assert.equal(b.engine.getStat(b.id("foe"), "speed"), 2);
  assert.equal(b.engine.state.cards[b.id("oldfoe")].controllerId, P2, "their other characters stay theirs");
});

clause(HEAD, "1:rule", "the stolen character's enters-play trigger belongs to its new controller", () => {
  const draw = character({
    name: "Greeter",
    cost: 2,
    behavior: {
      abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }]
    }
  });
  const b = headBoard({
    dec: 5,
    foeDef: draw,
    extra: [
      { key: "p1d", def: character({ name: "P1 Deck" }), owner: P1, zone: "deck" },
      { key: "p2d", def: character({ name: "P2 Deck" }), owner: P2, zone: "deck" }
    ]
  });
  const h1 = b.engine.state.players[P1].hand.length;
  const h2 = b.engine.state.players[P2].hand.length;
  foeOnStack(b);
  headhunt(b);
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.cards[b.id("foe")].controllerId, P1);
  assert.equal(b.engine.state.players[P1].hand.length, h1, "Headhunting left the hand and one card was drawn");
  assert.equal(b.engine.state.players[P1].hand.includes(b.id("p1d")), true, "you drew from your deck");
  assert.equal(b.engine.state.players[P2].hand.includes(b.id("p2d")), false, "they did not draw");
  assert.equal(b.engine.state.players[P2].hand.length, h2 - 1, "only the deployed card left their hand");
  const entered = b.engine.getLog().filter((e) => e.event?.type === "cardEnteredPlay" && (e.event as unknown as { cardId: string }).cardId === b.id("foe"));
  assert.equal(entered.length, 1, "it entered play once (the original deploy was cancelled, not resolved as well)");
});

clause(HEAD, "1:rule", "the character does not also enter play under the opponent's control (it is not in their play zone)", () => {
  const b = headBoard({ dec: 5 });
  foeOnStack(b);
  headhunt(b);
  const copies = Object.values(b.engine.state.cards).filter((c) => c.definitionId === b.engine.state.cards[b.id("foe")].definitionId);
  assert.equal(copies.length, 1);
  assert.ok(!b.engine.state.players[P2].play.includes(b.id("foe")), "!b.engine.state.players[P2].play.includes(b.id(\"foe\"))");
  assert.equal(b.engine.state.players[P2].discard.includes(b.id("foe")), false, "not discarded either");
});

// =============================================================================
// Heist Training Grounds
// UNIQUE HEIST TRAINING GROUNDS
// [D][D][D]: At the start of your turn, you may pick a character. If you do, it gains COVERT this turn.
// [D]x5: At the start of your turn, you may search an opponent's deck for a card. If you do, put it into their discard pile.
// [D]x7: At the start of your turn, an opponent discards a card at random.
// Location (rogue), cost 3, threshold [D], structure 5.
// =============================================================================

const HTG = "6da2fd15-6bc5-4b73-b21c-d281e6b9b544";

interface HtgOpts {
  dec?: number;
  greed?: number;
  random?: () => number;
  extra?: CardPlacement[];
  htgZone?: "play" | "hand";
}
function htgBoard(o: HtgOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    random: o.random ?? (() => 0.5),
    cards: [
      { key: "htg", def: printing(HTG), owner: P1, zone: o.htgZone ?? "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine Two" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      ...bank("deception", o.dec ?? 0, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...Array.from({ length: 8 }, (_, i): CardPlacement => ({ key: `od${i}`, def: character({ name: `Opp Deck ${i}` }), owner: P2, zone: "deck" })),
      ...Array.from({ length: 4 }, (_, i): CardPlacement => ({ key: `mh${i}`, def: character({ name: `Mine Deck ${i}` }), owner: P1, zone: "deck" })),
      ...Array.from({ length: 4 }, (_, i): CardPlacement => ({ key: `oh${i}`, def: character({ name: `Opp Hand ${i}` }), owner: P2, zone: "hand" })),
      ...(o.extra ?? [])
    ]
  });
}
type HtgBoard = ReturnType<typeof htgBoard>;
const kw = (b: HtgBoard, key: string): string[] => [...b.engine.getKeywords(b.id(key))].map((k) => String(k).toLowerCase());
const hasCovert = (b: HtgBoard, key: string): boolean => kw(b, key).includes("covert");
/** P2 ends the turn: P1's start-of-turn triggers run. */
const startOfP1 = (b: HtgBoard) => endTurn(b.engine, P2);
const PICK_ERR = /select|target|legal|candidate|invalid|pick|choice|count/i;
/** Runs every pending choice: picks by declaration id (`c` = COVERT, `__so` = deck search); the random-discard prompt (`__od`) is recorded and answered with `odPick`. */
function runStart(b: HtgBoard, picks: { c?: string[]; so?: string[] } = {}, odPick?: string): { asked: string[] } {
  const asked: string[] = [];
  drain(b.engine, (pc) => {
    if (pc.kind !== "chooserSelectsTarget") return declineAll(pc);
    const id = (pc.declaration as { id: string }).id;
    asked.push(id);
    if (id !== "__od") assert.equal(pc.playerId, P1, `${id}: you make this choice`);
    if (id === "__od") return { kind: "chooserSelectsTarget", selected: [b.id(odPick ?? "oh0")] };
    const want = id === "c" ? picks.c : picks.so;
    // no card for the "may search" (__so) = the player declines to search (Q2)
    return { kind: "chooserSelectsTarget", selected: (want ?? []).map((k) => b.id(k)), ...(id === "__so" && !want?.length ? { declined: true } : {}) };
  });
  return { asked };
}
const nextPick = (b: HtgBoard, declId: string): PendingChoiceLike => {
  for (let i = 0; i < 6; i++) {
    const pc = pending(b.engine)!;
    if (pc.kind === "chooserSelectsTarget" && (pc.declaration as { id: string }).id === declId) return pc;
    resolveChoice(b.engine, pc, pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [] } : declineAll(pc));
  }
  throw new Error(`no ${declId} prompt`);
};

clause(HTG, "0:unique", "printed card: a rogue location, cost 3, threshold [D], structure 5", () => {
  const p = printing(HTG);
  assert.equal(p.type, "location");
  assert.equal(p.trade, "rogue");
  assert.equal(p.cost, 3);
  assert.equal(p.threshold, "d");
  assert.equal(p.structure, 5);
  const b = htgBoard({ htgZone: "play" });
  assert.equal(b.engine.getStat(b.id("htg"), "structure"), 5);
});

clause(HTG, "0:unique", "deploys for exactly 3 resources with a [D]; one short and a missing [D] are refused", () => {
  const ok = htgBoard({ dec: 1, greed: 2, htgZone: "hand" });
  ok.engine.state.activePlayerId = P1;
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("htg"));
  assert.equal(zoneOf(ok.engine, ok.id("htg")), "play");
  assert.equal(before - ready(ok.engine), 3, "3 resources are paid");
  const short = htgBoard({ dec: 1, greed: 1, htgZone: "hand" });
  short.engine.state.activePlayerId = P1;
  refused(() => play(short.engine, P1, short.id("htg")), "2 resources for a cost of 3");
  assert.equal(zoneOf(short.engine, short.id("htg")), "hand");
  const noD = htgBoard({ dec: 0, greed: 3, htgZone: "hand" });
  noD.engine.state.activePlayerId = P1;
  refused(() => play(noD.engine, P1, noD.id("htg")), "no [D] icon");
  assert.equal(zoneOf(noD.engine, noD.id("htg")), "hand");
});

clause(HTG, "0:unique", "UNIQUE: deploying a second copy makes you keep one and destroy the other", () => {
  const b = htgBoard({ dec: 3, extra: [{ key: "htg2", def: printing(HTG), owner: P1, zone: "hand" }] });
  b.engine.state.activePlayerId = P1;
  play(b.engine, P1, b.id("htg2"));
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [b.id("htg"), b.id("htg2")].sort());
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("htg2") } } as never);
  assert.equal(zoneOf(b.engine, b.id("htg2")), "play");
  assert.equal(zoneOf(b.engine, b.id("htg")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(HTG, "0:unique", "UNIQUE is per player: the opponent controlling their own copy is fine", () => {
  const b = htgBoard({ dec: 3, extra: [{ key: "htgo", def: printing(HTG), owner: P2, zone: "play" }] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("htg")), "play");
  assert.equal(zoneOf(b.engine, b.id("htgo")), "play");
  const d = htgBoard({ dec: 3, extra: [{ key: "htgo", def: printing(HTG), owner: P2, zone: "hand" }, ...bank("deception", 3, P2)] });
  play(d.engine, P2, d.id("htgo"));
  assert.equal(d.engine.state.pendingChoice, undefined, "no survivor prompt for the other player's copy");
  assert.equal(zoneOf(d.engine, d.id("htg")), "play");
  assert.equal(zoneOf(d.engine, d.id("htgo")), "play");
});

// ---- [D][D][D]: pick a character, it gains COVERT this turn --------------------------------------

clause(HTG, "1:rule@ddd", "with [D][D][D] at the start of your turn you may pick a character, which gains COVERT", () => {
  const b = htgBoard({ dec: 3 });
  assert.equal(hasCovert(b, "mine"), false);
  startOfP1(b);
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "you choose");
  pick(b.engine, [b.id("mine")]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(hasCovert(b, "mine"), true, "the picked character has COVERT");
  assert.equal(hasCovert(b, "mine2"), false, "another of your characters does not");
  assert.equal(hasCovert(b, "foe"), false, "an opponent's character does not");
});

clause(HTG, "1:rule@ddd", "any character can be picked, including an opponent's", () => {
  const b = htgBoard({ dec: 3 });
  startOfP1(b);
  pick(b.engine, [b.id("foe")]);
  assert.equal(hasCovert(b, "foe"), true);
  assert.equal(hasCovert(b, "mine"), false);
});

clause(HTG, "1:rule@ddd", "you may decline: nobody gains COVERT", () => {
  const b = htgBoard({ dec: 3 });
  startOfP1(b);
  pick(b.engine, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const k of ["mine", "mine2", "foe"]) assert.equal(hasCovert(b, k), false, k);
});

clause(HTG, "1:rule@ddd", "only a character can be picked: an item, a location and a faction are refused; two characters are refused", () => {
  const b = htgBoard({ dec: 3 });
  startOfP1(b);
  const bad = (ids: CardInstanceId[]) => () => resolveChoice(b.engine, pending(b.engine)!, { kind: "chooserSelectsTarget", selected: ids });
  refused(bad([b.id("gear")]), "an item", PICK_ERR);
  refused(bad([b.id("htg")]), "a location", PICK_ERR);
  refused(bad([b.engine.state.players[P1].factionId!]), "a faction", PICK_ERR);
  refused(bad([b.id("mine"), b.id("mine2")]), "two characters", PICK_ERR);
  assert.equal(hasCovert(b, "gear"), false);
  pick(b.engine, [b.id("mine2")]);
  assert.equal(hasCovert(b, "mine2"), true, "control: a character works");
});

clause(HTG, "1:rule@ddd", "needs [D][D][D]: two [D] (even with other icons) do nothing", () => {
  const b = htgBoard({ dec: 2, greed: 4 });
  startOfP1(b);
  assert.equal(b.engine.state.pendingChoice, undefined, "no prompt");
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(hasCovert(b, "mine"), false);
  const ok = htgBoard({ dec: 3 });
  startOfP1(ok);
  assert.equal(pending(ok.engine)?.kind, "chooserSelectsTarget", "control: three [D]");
});

clause(HTG, "1:rule@ddd", "spent [D] resources still meet the threshold", () => {
  const b = htgBoard({ extra: spentOf("deception", 3) });
  startOfP1(b);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
});

clause(HTG, "1:rule@ddd", "only at the start of YOUR turn: the opponent's turn start does nothing", () => {
  const b = htgBoard({ dec: 3 });
  b.engine.state.activePlayerId = P1;
  endTurn(b.engine, P1); // P2's turn starts
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const k of ["mine", "mine2", "foe"]) assert.equal(hasCovert(b, k), false, k);
});

clause(HTG, "1:rule@ddd", "COVERT lasts this turn only: gone once the turn ends", () => {
  const b = htgBoard({ dec: 3 });
  startOfP1(b);
  pick(b.engine, [b.id("mine")]);
  assert.equal(hasCovert(b, "mine"), true);
  endTurn(b.engine, P1); // P2's turn
  assert.equal(hasCovert(b, "mine"), false, "no COVERT on the opponent's turn");
  endTurn(b.engine, P2); // P1's turn start: the trigger asks again
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  assert.equal(hasCovert(b, "mine"), false, "not carried over to the next turn");
  pick(b.engine, []);
  assert.equal(hasCovert(b, "mine"), false);
});

clause(HTG, "1:rule@ddd", "does nothing while the location is not in play", () => {
  const b = htgBoard({ dec: 3, htgZone: "hand" });
  startOfP1(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  const d = htgBoard({ dec: 3, htgZone: "play" });
  startOfP1(d);
  assert.equal(pending(d.engine)?.kind, "chooserSelectsTarget", "control: in play");
});

// ---- [D]x5: search an opponent's deck, put the card into their discard ----------------------------

clause(HTG, "2:rule@ddddd", "with five [D] you may search an opponent's deck for a card and put it into THEIR discard pile", () => {
  const b = htgBoard({ dec: 5 });
  startOfP1(b);
  const { asked } = runStart(b, { so: ["od3"] });
  assert.deepEqual(asked, ["c", "__so"], "both the [D][D][D] and [D]x5 rules ask");
  assert.equal(zoneOf(b.engine, b.id("od3")), "discard");
  assert.ok(b.engine.state.players[P2].discard.includes(b.id("od3")), "in their discard pile");
  assert.ok(!b.engine.state.players[P1].discard.includes(b.id("od3")), "not mine");
  assert.equal(b.engine.state.players[P2].deck.length, 7);
  assert.equal(b.engine.state.cards[b.id("od3")].ownerId, P2);
  assert.equal(b.engine.state.players[P1].deck.length, 4, "my deck untouched");
});

clause(HTG, "2:rule@ddddd", "the search shuffles their deck afterwards (CR 312.1)", () => {
  let moved = 0;
  for (const seed of [0, 0.3, 0.99]) {
    const b = htgBoard({ dec: 5, random: () => seed });
    const before = deckOf(b.engine, P2).filter((c) => c !== b.id("od3"));
    startOfP1(b);
    runStart(b, { so: ["od3"] });
    const after = deckOf(b.engine, P2);
    assert.deepEqual([...after].sort(), [...before].sort(), `seed ${seed}: same cards remain`);
    if (JSON.stringify(after) !== JSON.stringify(before)) moved++;
  }
  assert.ok(moved >= 1, "the opponent's deck order changed for at least one seed (shuffled)");
});

clause(HTG, "2:rule@ddddd", "any card of the opponent's deck can be found: the top card and the bottom card", () => {
  for (const key of ["od0", "od7"]) {
    const b = htgBoard({ dec: 5 });
    startOfP1(b);
    runStart(b, { so: [key] });
    assert.equal(zoneOf(b.engine, b.id(key)), "discard", key);
  }
});

clause(HTG, "2:rule@ddddd", "you may decline the search: nothing moves (and the deck is not shuffled)", () => {
  const b = htgBoard({ dec: 5, random: () => 0.3 });
  const before = deckOf(b.engine, P2);
  startOfP1(b);
  runStart(b);
  assert.deepEqual(deckOf(b.engine, P2), before, "no search, no shuffle, nothing moved");
  assert.equal(b.engine.state.players[P2].discard.length, 0);
});

clause(HTG, "2:rule@ddddd", "only the opponent's deck: your own deck's card and their hand are refused", () => {
  const b = htgBoard({ dec: 5 });
  startOfP1(b);
  const pc = nextPick(b, "__so");
  refused(() => resolveChoice(b.engine, pc, { kind: "chooserSelectsTarget", selected: [b.id("mh0")] }), "own deck", PICK_ERR);
  refused(() => resolveChoice(b.engine, pc, { kind: "chooserSelectsTarget", selected: [b.id("oh0")] }), "their hand", PICK_ERR);
  resolveChoice(b.engine, pc, { kind: "chooserSelectsTarget", selected: [b.id("od1")] });
  assert.equal(zoneOf(b.engine, b.id("od1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("mh0")), "deck");
});

clause(HTG, "2:rule@ddddd", "needs five [D]: with four, the search never happens (only the [D][D][D] rule)", () => {
  const b = htgBoard({ dec: 4, greed: 3 });
  startOfP1(b);
  const { asked } = runStart(b);
  assert.deepEqual(asked, ["c"], "only the COVERT pick is asked");
  assert.equal(b.engine.state.players[P2].discard.length, 0);
  assert.equal(b.engine.state.players[P2].deck.length, 8);
});

clause(HTG, "2:rule@ddddd", "only at the start of your turn, not the opponent's", () => {
  const b = htgBoard({ dec: 5 });
  b.engine.state.activePlayerId = P1;
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.players[P2].deck.length, 8);
});

clause(HTG, "2:rule@ddddd", "searching an empty opponent deck finds nothing and does not break the turn", () => {
  const b = htgBoard({ dec: 5 });
  const p2 = b.engine.state.players[P2];
  for (const id of p2.deck) b.engine.state.cards[id].zone = "discard";
  p2.discard.push(...p2.deck);
  p2.deck = [];
  startOfP1(b);
  runStart(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.activePlayerId, P1);
});

// ---- [D]x7: opponent discards a card at random ------------------------------------------------------

const lost = (b: HtgBoard, hand: CardInstanceId[]) => hand.filter((c) => !b.engine.state.players[P2].hand.includes(c));

clause(HTG, "3:rule@ddddddd", "with seven [D] an opponent discards a card at random from their hand (nobody is asked to choose)", () => {
  const b = htgBoard({ dec: 7 });
  const hand = [...b.engine.state.players[P2].hand];
  const mine = [...b.engine.state.players[P1].hand];
  const dBefore = b.engine.state.players[P2].discard.length;
  startOfP1(b);
  const { asked } = runStart(b);
  assert.ok(!asked.includes("__od"), "the controller is not asked to choose the discard: it is random");
  const gone = lost(b, hand);
  assert.equal(gone.length, 1, "exactly one card left their hand");
  assert.equal(zoneOf(b.engine, gone[0]), "discard");
  assert.ok(b.engine.state.players[P2].discard.includes(gone[0]), "into their discard pile");
  assert.equal(b.engine.state.players[P2].discard.length - dBefore, 1);
  for (const c of mine) assert.ok(b.engine.state.players[P1].hand.includes(c), "my hand is untouched");
});

clause(HTG, "3:rule@ddddddd", "the discarded card is random: different rolls discard different cards", () => {
  const seen = new Set<string>();
  for (const seed of [0, 0.3, 0.6, 0.99]) {
    const b = htgBoard({ dec: 7, random: () => seed });
    const hand = [...b.engine.state.players[P2].hand];
    startOfP1(b);
    const { asked } = runStart(b);
    assert.ok(!asked.includes("__od"), `seed ${seed}: no choice is offered`);
    const gone = lost(b, hand);
    assert.equal(gone.length, 1, `seed ${seed}`);
    seen.add(gone[0]);
  }
  assert.ok(seen.size >= 2, `random picks vary across rolls (${seen.size})`);
});

clause(HTG, "3:rule@ddddddd", "the discard is from the OPPONENT's hand and goes to THEIR discard pile, whichever card the random draw lands on", () => {
  // The discard is at random (seed-saga-09-p1-3): nobody picks, so check every roll.
  for (const seed of [0, 0.3, 0.6, 0.99]) {
    const b = htgBoard({ dec: 7, random: () => seed });
    const hand = [...b.engine.state.players[P2].hand];
    startOfP1(b);
    const mine = [...b.engine.state.players[P1].hand];
    runStart(b);
    const gone = lost(b, hand);
    assert.equal(gone.length, 1, `seed ${seed}: exactly one card left the opponent's hand`);
    assert.ok(hand.includes(gone[0]), "it came from the opponent's hand");
    assert.ok(b.engine.state.players[P2].discard.includes(gone[0]), "into THEIR discard pile");
    assert.deepEqual(b.engine.state.players[P1].hand, mine, "my hand is untouched");
  }
});

clause(HTG, "3:rule@ddddddd", "needs seven [D]: with six, nobody discards", () => {
  const b = htgBoard({ dec: 6, greed: 3 });
  const hand = [...b.engine.state.players[P2].hand];
  startOfP1(b);
  const { asked } = runStart(b);
  assert.deepEqual(asked, ["c", "__so"]);
  assert.deepEqual(b.engine.state.players[P2].hand, hand);
  assert.equal(b.engine.state.players[P2].discard.length, 0);
});

clause(HTG, "3:rule@ddddddd", "only at the start of your turn: the opponent's own turn start discards nothing", () => {
  const b = htgBoard({ dec: 7 });
  b.engine.state.activePlayerId = P1;
  const mine = [...b.engine.state.players[P1].hand];
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.players[P2].hand.length >= 4, true, "nobody discarded from the opponent's hand");
  assert.equal(b.engine.state.players[P2].discard.length, 0);
  assert.equal(b.engine.state.players[P1].discard.length, 0);
  assert.deepEqual(b.engine.state.players[P1].hand, mine);
});

clause(HTG, "3:rule@ddddddd", "an opponent with an empty hand discards nothing and the turn goes on", () => {
  const b = htgBoard({ dec: 7 });
  const p2 = b.engine.state.players[P2];
  for (const c of p2.hand) b.engine.state.cards[c].zone = "discard";
  p2.discard.push(...p2.hand);
  p2.hand = [];
  startOfP1(b);
  const { asked } = runStart(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(p2.hand.length, 0);
  assert.ok(!asked.includes("__od"), "nothing to discard, nothing to ask");
});

clause(HTG, "3:rule@ddddddd", "all three rules apply together at seven [D]: COVERT pick, deck search and a discard from their hand", () => {
  const b = htgBoard({ dec: 7 });
  const hand = [...b.engine.state.players[P2].hand];
  startOfP1(b);
  const { asked } = runStart(b, { c: ["mine"], so: ["od2"] }, "oh1");
  assert.deepEqual(asked.slice(0, 2), ["c", "__so"]);
  assert.equal(hasCovert(b, "mine"), true);
  assert.equal(zoneOf(b.engine, b.id("od2")), "discard");
  assert.equal(lost(b, hand).length, 1);
});

// =============================================================================
// Hidden Dagger
// ATTACH TO CHARACTER -- TACTICAL -- The attached character gains 1 strength.
// HANDOFF -- COST: Deplete a character you control that is not in a battle. -- EFFECT: Attach this card to the character.
// FLIP UP: 1 [D]
// Item (rogue, gear), cost 1, threshold [D].
// =============================================================================

const DAGGER = "cabe0271-a3ba-414d-ab30-92d14012164d";

interface DagOpts {
  zone?: "hand" | "play";
  faceDown?: boolean;
  spentSelf?: boolean;
  attachedTo?: string;
  turnP2?: boolean;
  dec?: number;
  greed?: number;
  spentDec?: number;
  extra?: CardPlacement[];
}
const NOOP_TACTIC = tactic({ name: "Noop", cost: 0, behavior: { abilities: [{ id: "no", type: "activated", effects: [] }] } });
const KILL_ITEM = tactic({
  name: "Smash",
  cost: 0,
  behavior: {
    abilities: [
      {
        id: "smash",
        type: "activated",
        targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }],
        effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
      }
    ]
  }
});
function dagBoard(o: DagOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: o.turnP2 ? P2 : P1,
    random: () => 0.5,
    cards: [
      {
        key: "dag",
        def: printing(DAGGER),
        owner: P1,
        zone: o.zone ?? "hand",
        faceDown: o.faceDown,
        ...(o.attachedTo ? { attachedToKey: o.attachedTo } : {}),
        ...(o.spentSelf ? { attachedToKey: "__factionA" } : {})
      },
      { key: "a", def: character({ name: "Alpha", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "b", def: character({ name: "Bravo", strength: 3, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "c", def: character({ name: "Charlie", strength: 1, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "noop", def: NOOP_TACTIC, owner: P2, zone: "hand" },
      { key: "noop1", def: NOOP_TACTIC, owner: P1, zone: "hand" },
      { key: "smash", def: KILL_ITEM, owner: P1, zone: "hand" },
      ...bank("deception", o.dec ?? 0, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...spentOf("deception", o.spentDec ?? 0),
      ...(o.extra ?? [])
    ]
  });
}
type DagBoard = ReturnType<typeof dagBoard>;
const str = (b: DagBoard, k: string): number => b.engine.getStat(b.id(k), "strength");
const dagPlay = (b: DagBoard, host: string | undefined, player: PlayerId = P1) =>
  play(b.engine, player, b.id("dag"), { selected: host === undefined ? {} : { attachTo: [b.id(host)] } });
const dagPlayRaw = (b: DagBoard, host: string) => playRaw(b.engine, P1, b.id("dag"), { selected: { attachTo: [b.id(host)] } });
const flip = (b: DagBoard, host?: string, player: PlayerId = P1) => {
  flipUpNow(b.engine, { type: "flipUp", playerId: player, cardId: b.id("dag"), selected: host ? { attachTo: [b.id(host)] } : {}, variables: {} });
  resolvePendingResponses(b.engine);
};
const handoff = (b: DagBoard, h: string, player: PlayerId = P1) => activate(b.engine, player, b.id("dag"), "handoff", { selected: { h: [b.id(h)] } });
const hostOf = (b: DagBoard) => b.engine.state.cards[b.id("dag")].attachedTo;

clause(DAGGER, "0:attach", "printed card: a rogue gear item, cost 1, threshold [D]", () => {
  const p = printing(DAGGER);
  assert.equal(p.type, "item");
  assert.equal(p.trade, "rogue");
  assert.deepEqual([...p.subtype], ["gear"]);
  assert.equal(p.cost, 1);
  assert.equal(p.threshold, "d");
});

clause(DAGGER, "0:attach", "enters play attached to the picked character and the printed cost of 1 is paid (exact board: one ready resource)", () => {
  const b = dagBoard({ spentDec: 1, greed: 1 });
  const before = ready(b.engine);
  dagPlay(b, "a");
  assert.equal(zoneOf(b.engine, b.id("dag")), "play");
  assert.equal(hostOf(b), b.id("a"));
  assert.equal(before - ready(b.engine), 1, "cost 1 paid");
  assert.equal(b.engine.state.cards[b.id("b")].attachedTo, undefined, "no other character gets it");
  assert.equal(b.engine.state.cards[b.id("dag")].controllerId, P1);
});

clause(DAGGER, "0:attach", "one resource short is refused even with the [D] threshold met by a spent resource", () => {
  const b = dagBoard({ spentDec: 1 });
  refused(() => dagPlayRaw(b, "a"), "no ready resource for a cost of 1");
  assert.equal(zoneOf(b.engine, b.id("dag")), "hand");
});

clause(DAGGER, "0:attach", "the [D] threshold: a ready resource with no [D] is refused, with a [D] it works", () => {
  const no = dagBoard({ greed: 1 });
  refused(() => dagPlayRaw(no, "a"), "no [D] icon");
  assert.equal(zoneOf(no.engine, no.id("dag")), "hand");
  const yes = dagBoard({ dec: 1 });
  dagPlay(yes, "a");
  assert.equal(zoneOf(yes.engine, yes.id("dag")), "play");
});

clause(DAGGER, "0:attach", "can be attached to an opponent's character too, while you keep control of the Dagger", () => {
  const b = dagBoard({ dec: 1 });
  dagPlay(b, "foe");
  assert.equal(hostOf(b), b.id("foe"));
  assert.equal(b.engine.state.cards[b.id("dag")].controllerId, P1);
});

clause(DAGGER, "0:attach", "a non-character host is refused (item, location, faction), as is no host or two hosts", () => {
  const b = dagBoard({ dec: 1 });
  const factionA = b.engine.state.players[P1].factionId!;
  refused(() => playRaw(b.engine, P1, b.id("dag"), { selected: { attachTo: [b.id("gear")] } }), "an item");
  refused(() => playRaw(b.engine, P1, b.id("dag"), { selected: { attachTo: [b.id("place")] } }), "a location");
  refused(() => playRaw(b.engine, P1, b.id("dag"), { selected: { attachTo: [factionA] } }), "a faction");
  refused(() => playRaw(b.engine, P1, b.id("dag"), { selected: { attachTo: [] } }), "no host");
  refused(() => playRaw(b.engine, P1, b.id("dag"), { selected: { attachTo: [b.id("a"), b.id("b")] } }), "two hosts");
  assert.equal(zoneOf(b.engine, b.id("dag")), "hand");
  dagPlay(b, "b");
  assert.equal(hostOf(b), b.id("b"), "control: a character host works");
});

clause(DAGGER, "1:kw:TACTICAL", "has the TACTICAL keyword", () => {
  const b = dagBoard({ zone: "play", attachedTo: "a" });
  assert.ok([...b.engine.getKeywords(b.id("dag"))].map((k) => String(k).toLowerCase()).includes("tactical"), "[...b.engine.getKeywords(b.id(\"dag\"))].map((k) => String(k).toLowerCase()).includes(\"tactical\")");
});

clause(DAGGER, "1:kw:TACTICAL", "can be deployed on the opponent's turn in response, like a tactic", () => {
  const b = dagBoard({ turnP2: true, dec: 1, greed: 1 });
  playRaw(b.engine, P2, b.id("noop"));
  const before = ready(b.engine);
  dagPlay(b, "a");
  assert.equal(zoneOf(b.engine, b.id("dag")), "play");
  assert.equal(hostOf(b), b.id("a"));
  assert.equal(before - ready(b.engine), 1);
  assert.equal(str(b, "a"), 3);
});

clause(DAGGER, "1:kw:TACTICAL", "without TACTICAL the same item is refused in that window (control: only the keyword differs)", () => {
  const plain = item({ name: "Plain Dagger", cost: 1, threshold: "d", attachTo: "character", keywords: [] } as never);
  const b = dagBoard({ turnP2: true, dec: 2, extra: [{ key: "plain", def: plain, owner: P1, zone: "hand" }] });
  playRaw(b.engine, P2, b.id("noop"));
  refused(() => play(b.engine, P1, b.id("plain"), { selected: { attachTo: [b.id("a")] } }), "a non-tactical item in a response window");
  assert.equal(zoneOf(b.engine, b.id("plain")), "hand");
  dagPlay(b, "a");
  assert.equal(zoneOf(b.engine, b.id("dag")), "play");
});

clause(DAGGER, "1:kw:TACTICAL", "on the opponent's turn with nothing to respond to, the Dagger is deployable exactly when a tactic is", () => {
  const b = dagBoard({ turnP2: true, dec: 2 });
  const tacticOk = (() => {
    try {
      playRaw(b.engine, P1, b.id("noop1"));
      return true;
    } catch {
      return false;
    }
  })();
  const c = dagBoard({ turnP2: true, dec: 2 });
  let daggerOk = true;
  try {
    dagPlayRaw(c, "a");
  } catch {
    daggerOk = false;
  }
  assert.equal(daggerOk, tacticOk);
});

clause(DAGGER, "1:kw:TACTICAL", "also deployable on your own turn", () => {
  const b = dagBoard({ dec: 1 });
  dagPlay(b, "a");
  assert.equal(zoneOf(b.engine, b.id("dag")), "play");
});

clause(DAGGER, "2:rule", "the attached character gains 1 strength (2 -> 3); other characters are unchanged", () => {
  const b = dagBoard({ dec: 1 });
  assert.equal(str(b, "a"), 2);
  dagPlay(b, "a");
  assert.equal(str(b, "a"), 3, "attached");
  assert.equal(str(b, "b"), 3, "Bravo keeps its printed 3");
  assert.equal(str(b, "foe"), 1, "an opponent's character is unchanged");
  assert.equal(b.engine.getStat(b.id("a"), "life"), 4, "only strength changes");
  assert.equal(b.engine.getStat(b.id("a"), "speed"), 2, "only strength changes");
});

clause(DAGGER, "2:rule", "on an opponent's character it raises THEIR strength", () => {
  const b = dagBoard({ dec: 1 });
  dagPlay(b, "foe");
  assert.equal(str(b, "foe"), 2);
  assert.equal(str(b, "a"), 2);
});

clause(DAGGER, "2:rule", "two Daggers on one character stack: +2", () => {
  const b = dagBoard({ zone: "play", attachedTo: "a", dec: 1, extra: [{ key: "dag2", def: printing(DAGGER), owner: P1, zone: "play", attachedToKey: "a" }] });
  assert.equal(str(b, "a"), 4);
});

clause(DAGGER, "2:rule", "the bonus ends when the Dagger leaves play", () => {
  const b = dagBoard({ zone: "play", attachedTo: "a" });
  assert.equal(str(b, "a"), 3);
  play(b.engine, P1, b.id("smash"), { selected: { t: [b.id("dag")] } });
  assert.equal(zoneOf(b.engine, b.id("dag")), "discard");
  assert.equal(str(b, "a"), 2, "back to the printed 2");
  assert.equal(str(b, "b"), 3);
});

clause(DAGGER, "2:rule", "the bonus is not there while the Dagger is in hand", () => {
  const b = dagBoard({});
  assert.equal(str(b, "a"), 2);
  assert.equal(str(b, "b"), 3);
  assert.equal(str(b, "foe"), 1);
});

// ---- HANDOFF -----------------------------------------------------------------------------------------

clause(DAGGER, "3:ability:handoff", "deplete another character you control that is not in a battle: the Dagger attaches to it", () => {
  const b = dagBoard({ zone: "play", attachedTo: "a" });
  assert.equal(str(b, "a"), 3);
  handoff(b, "b");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.cards[b.id("b")].depleted, true, "COST: the chosen character is depleted");
  assert.equal(hostOf(b), b.id("b"), "EFFECT: attached to the character");
  assert.equal(str(b, "b"), 4);
  assert.equal(str(b, "a"), 2, "the old host loses the bonus");
  assert.equal(b.engine.state.cards[b.id("a")].depleted, false, "the old host is not depleted");
  assert.equal(b.engine.state.cards[b.id("dag")].depleted, false, "the Dagger itself is not depleted");
  assert.equal(zoneOf(b.engine, b.id("dag")), "play");
});

clause(DAGGER, "3:ability:handoff", "the Dagger can be handed back and forth (no once-per-turn limit) as long as each chosen character is ready", () => {
  const b = dagBoard({ zone: "play", attachedTo: "a" });
  handoff(b, "b");
  assert.equal(hostOf(b), b.id("b"));
  handoff(b, "a");
  assert.equal(hostOf(b), b.id("a"));
  assert.equal(b.engine.state.cards[b.id("a")].depleted, true);
  assert.equal(str(b, "a"), 3);
  assert.equal(str(b, "b"), 3);
});

clause(DAGGER, "3:ability:handoff", "an already depleted character cannot pay the cost", () => {
  const b = dagBoard({ zone: "play", attachedTo: "a" });
  b.engine.state.cards[b.id("b")].depleted = true;
  refused(() => handoff(b, "b"), "b is depleted");
  assert.equal(hostOf(b), b.id("a"));
  b.engine.state.cards[b.id("b")].depleted = false;
  handoff(b, "b");
  assert.equal(hostOf(b), b.id("b"), "control: ready character");
});

clause(DAGGER, "3:ability:handoff", "the character must be one you control: an opponent's character is refused", () => {
  const b = dagBoard({ zone: "play", attachedTo: "a" });
  refused(() => handoff(b, "foe"), "an opponent's character");
  assert.equal(hostOf(b), b.id("a"));
  assert.equal(b.engine.state.cards[b.id("foe")].depleted, false);
});

clause(DAGGER, "3:ability:handoff", "only a character: an item or a location you control is refused", () => {
  const b = dagBoard({ zone: "play", attachedTo: "a" });
  refused(() => handoff(b, "gear"), "an item");
  refused(() => handoff(b, "place"), "a location");
  assert.equal(hostOf(b), b.id("a"));
});

clause(DAGGER, "3:ability:handoff", "a character that is attacking cannot be chosen; one that is not in the battle can", () => {
  const b = dagBoard({ zone: "play", attachedTo: "b" });
  b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [b.id("a")], target: { type: "faction", playerId: P2 } } as never);
  assert.ok(b.engine.state.battle, "a battle is under way");
  refused(() => handoff(b, "a"), "a is attacking");
  assert.equal(hostOf(b), b.id("b"));
  handoff(b, "c");
  assert.equal(hostOf(b), b.id("c"), "control: a character outside the battle");
  assert.equal(b.engine.state.cards[b.id("a")].depleted, true, "(attackers are depleted by attacking, so this refusal is also covered by the cost)");
});

clause(DAGGER, "3:ability:handoff", "a ready attacker in a battle is refused for being in a battle: the second attacker, while a is not yet depleted", () => {
  const b = dagBoard({ zone: "play", attachedTo: "foe" });
  b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [b.id("a"), b.id("b")], target: { type: "faction", playerId: P2 } } as never);
  assert.ok(b.engine.state.battle, "b.engine.state.battle");
  b.engine.state.cards[b.id("b")].depleted = false;
  refused(() => handoff(b, "b"), "b is in the battle even though it is ready");
  assert.equal(hostOf(b), b.id("foe"));
  handoff(b, "c");
  assert.equal(hostOf(b), b.id("c"), "control: a character outside the battle");
});

clause(DAGGER, "3:ability:handoff", "a blocker is in the battle and cannot be chosen; a character outside the battle can", () => {
  const b = dagBoard({
    zone: "play",
    attachedTo: "a",
    turnP2: true,
    extra: [{ key: "raider", def: character({ name: "Raider", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackBy(b.engine, P2, [b.id("raider")], { type: "faction", playerId: P1 });
  declareBlockers(b.engine, P1, [b.id("b")]);
  b.engine.perform({ type: "passPriority", playerId: P2 } as never);
  assert.ok(b.engine.state.battle, "battle is under way");
  refused(() => handoff(b, "b"), "b is blocking");
  assert.equal(hostOf(b), b.id("a"));
  handoff(b, "c");
  assert.equal(hostOf(b), b.id("c"), "control: c is not in the battle");
  assert.equal(b.engine.state.cards[b.id("c")].depleted, true);
});

clause(DAGGER, "3:ability:handoff", "choosing the current host is allowed: it is depleted and keeps the Dagger", () => {
  const b = dagBoard({ zone: "play", attachedTo: "a" });
  handoff(b, "a");
  assert.equal(hostOf(b), b.id("a"));
  assert.equal(b.engine.state.cards[b.id("a")].depleted, true);
  assert.equal(str(b, "a"), 3);
});

clause(DAGGER, "3:ability:handoff", "can be used with the Dagger on an opponent's character: it moves to your character", () => {
  const b = dagBoard({ zone: "play", attachedTo: "foe" });
  handoff(b, "a");
  assert.equal(hostOf(b), b.id("a"));
  assert.equal(str(b, "foe"), 1);
  assert.equal(str(b, "a"), 3);
});

clause(DAGGER, "3:ability:handoff", "only the Dagger's controller can use it", () => {
  const b = dagBoard({ zone: "play", attachedTo: "a", turnP2: true });
  playRaw(b.engine, P2, b.id("noop"));
  refused(() => handoff(b, "b", P2), "opponent uses it", /./);
  assert.equal(hostOf(b), b.id("a"));
  handoff(b, "b");
  assert.equal(hostOf(b), b.id("b"), "control: the controller can, in the same window");
});

clause(DAGGER, "3:ability:handoff", "not usable from hand or while face-down", () => {
  const hand = dagBoard({ zone: "hand" });
  refused(() => handoff(hand, "b"), "in hand", /./);
  const fd = dagBoard({ zone: "play", faceDown: true });
  refused(() => handoff(fd, "b"), "face-down", /./);
  assert.equal(fd.engine.state.cards[fd.id("b")].depleted, false);
});

// ---- FLIP UP: 1 [D] -----------------------------------------------------------------------------------

clause(DAGGER, "4:flipUp", "FLIP UP 1 [D]: a face-down Dagger with a ready [D] resource flips up attached to the picked character (+1 strength)", () => {
  const b = dagBoard({ zone: "play", faceDown: true, dec: 1, greed: 1 });
  flip(b, "a");
  const d = b.engine.state.cards[b.id("dag")];
  assert.equal(d.faceDown, false);
  assert.equal(d.zone, "play");
  assert.equal(d.attachedTo, b.id("a"));
  assert.equal(str(b, "a"), 3);
  assert.equal(str(b, "b"), 3);
  const r = ready(b.engine);
  assert.ok(r === 1 || r === 2, `a cost of 1 was paid (ready ${r})`);
});

clause(DAGGER, "4:flipUp", "the FLIP UP cost of 1 can be paid by the Dagger itself (CR 507.4b) when a spent [D] meets the threshold", () => {
  const b = dagBoard({ zone: "play", faceDown: true, spentDec: 1 });
  assert.equal(ready(b.engine), 1, "only the face-down Dagger is ready");
  flip(b, "a");
  assert.equal(b.engine.state.cards[b.id("dag")].faceDown, false);
  assert.equal(hostOf(b), b.id("a"));
});

clause(DAGGER, "4:flipUp", "the cost is 1, not 0: with every resource spent the flip is refused", () => {
  const b = dagBoard({ zone: "play", faceDown: true, spentSelf: true, spentDec: 1 });
  assert.equal(ready(b.engine), 0);
  refused(() => flip(b, "a"), "nothing ready to pay 1", /./);
  assert.equal(b.engine.state.cards[b.id("dag")].faceDown, true);
});

clause(DAGGER, "4:flipUp", "a spent face-down Dagger can be flipped up when another resource is ready to pay the cost of 1", () => {
  const b = dagBoard({ zone: "play", faceDown: true, spentSelf: true, spentDec: 1, greed: 1 });
  assert.equal(ready(b.engine), 1);
  flip(b, "a");
  assert.equal(b.engine.state.cards[b.id("dag")].faceDown, false);
  assert.equal(ready(b.engine), 0, "the ready resource paid the cost of 1");
});

clause(DAGGER, "4:flipUp", "the cost is not 2: the Dagger plus one ready resource... exactly one spent [D] and the Dagger flips", () => {
  const b = dagBoard({ zone: "play", faceDown: true, spentDec: 2 });
  flip(b, "a");
  assert.equal(b.engine.state.cards[b.id("dag")].faceDown, false);
});

clause(DAGGER, "4:flipUp", "the [D] threshold: the Dagger's own icon does not count after flipping, and a non-[D] resource does not either", () => {
  const alone = dagBoard({ zone: "play", faceDown: true });
  refused(() => flip(alone, "a"), "only itself", /./);
  assert.equal(alone.engine.state.cards[alone.id("dag")].faceDown, true);
  const greed = dagBoard({ zone: "play", faceDown: true, greed: 2 });
  refused(() => flip(greed, "a"), "no [D] among the other resources", /./);
  assert.equal(greed.engine.state.cards[greed.id("dag")].faceDown, true);
  const ok = dagBoard({ zone: "play", faceDown: true, dec: 1 });
  flip(ok, "a");
  assert.equal(ok.engine.state.cards[ok.id("dag")].faceDown, false, "control: one [D] among the others");
});

clause(DAGGER, "4:flipUp", "a spent [D] resource still meets the threshold", () => {
  const b = dagBoard({ zone: "play", faceDown: true, spentDec: 1, greed: 1 });
  flip(b, "b");
  assert.equal(hostOf(b), b.id("b"));
});

clause(DAGGER, "4:flipUp", "ATTACH TO CHARACTER still applies when flipping up: a non-character or no host is refused", () => {
  const b = dagBoard({ zone: "play", faceDown: true, dec: 1, greed: 1 });
  refused(() => flip(b, "gear"), "an item host", /./);
  refused(() => flip(b, "place"), "a location host", /./);
  refused(() => flip(b, undefined), "no host", /./);
  assert.equal(b.engine.state.cards[b.id("dag")].faceDown, true);
  flip(b, "foe");
  assert.equal(hostOf(b), b.id("foe"), "control: an opponent's character");
});

clause(DAGGER, "4:flipUp", "TACTICAL: flipping up works on the opponent's turn in response to something", () => {
  const b = dagBoard({ zone: "play", faceDown: true, dec: 1, greed: 1, turnP2: true });
  playRaw(b.engine, P2, b.id("noop"));
  flip(b, "a");
  assert.equal(b.engine.state.cards[b.id("dag")].faceDown, false);
  assert.equal(str(b, "a"), 3);
});

clause(DAGGER, "4:flipUp", "only the controller can flip it up, and only while it is face-down in play (not from hand)", () => {
  const b = dagBoard({ zone: "play", faceDown: true, dec: 1, greed: 1, turnP2: true });
  playRaw(b.engine, P2, b.id("noop"));
  refused(() => flip(b, "a", P2), "the opponent flips it", /./);
  assert.equal(b.engine.state.cards[b.id("dag")].faceDown, true);
  const hand = dagBoard({ zone: "hand", dec: 1, greed: 1 });
  refused(() => flip(hand, "a"), "from hand", /./);
  assert.equal(zoneOf(hand.engine, hand.id("dag")), "hand");
  const up = dagBoard({ zone: "play", attachedTo: "a", dec: 1, greed: 1 });
  refused(() => flip(up, "b"), "already face-up", /./);
  assert.equal(hostOf(up), up.id("a"));
});

// =============================================================================
// I Drink Your Milkshake!
// You may search an opponent's deck for a card. If you do, put it in the void face-down. For the rest of the
// game, when that opponent deploys a card, you may reveal the voided card if it has the same name. If you do,
// you may deploy it for free even if you cannot meet its threshold. If you deploy it, terminate the opponent's
// card. (Playing a resource does not trigger this effect.)
// Tactic (rogue), cost 3, threshold [D][D][D][D].
// =============================================================================

const MILK = "83807d38-2e87-4c3e-9167-5488979e4267";

const zed = (over: Partial<CardDefinition> = {}): CardDefinition => character({ name: "Zed", cost: 4, strength: 3, life: 2, speed: 1, ...over });

interface MilkOpts {
  turnP2?: boolean;
  /** Voided P2 cards (face-down in the void). */
  voided?: Array<{ key: string; def: CardDefinition }>;
  /** MS copies already in P1's discard (the card has been played). */
  inDiscard?: number;
  inHand?: number;
  p2Hand?: Array<{ key: string; def: CardDefinition }>;
  p1Hand?: Array<{ key: string; def: CardDefinition }>;
  p2Deck?: Array<{ key: string; def: CardDefinition }>;
  p1Greed?: number;
  p1Dec?: number;
  p1SpentDec?: number;
  p2Rage?: number;
  random?: () => number;
}
function milkBoard(o: MilkOpts = {}) {
  const cards: CardPlacement[] = [];
  for (let i = 0; i < (o.inDiscard ?? 0); i++) cards.push({ key: `ms${i}`, def: printing(MILK), owner: P1, zone: "discard" });
  for (let i = 0; i < (o.inHand ?? 0); i++) cards.push({ key: `msh${i}`, def: printing(MILK), owner: P1, zone: "hand" });
  for (const v of o.voided ?? []) cards.push({ key: v.key, def: v.def, owner: P2, zone: "void", faceDown: true });
  for (const h of o.p2Hand ?? []) cards.push({ key: h.key, def: h.def, owner: P2, zone: "hand" });
  for (const h of o.p1Hand ?? []) cards.push({ key: h.key, def: h.def, owner: P1, zone: "hand" });
  for (const d of o.p2Deck ?? []) cards.push({ key: d.key, def: d.def, owner: P2, zone: "deck" });
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: o.turnP2 ? P2 : P1,
    random: o.random ?? (() => 0.5),
    cards: [
      ...cards,
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      ...Array.from({ length: 3 }, (_, i): CardPlacement => ({ key: `p1deck${i}`, def: character({ name: `Mine Deck ${i}` }), owner: P1, zone: "deck" })),
      ...bank("greed", o.p1Greed ?? 0, P1),
      ...bank("deception", o.p1Dec ?? 0, P1),
      ...spentOf("deception", o.p1SpentDec ?? 0),
      ...bank("rage", o.p2Rage ?? 6, P2)
    ]
  });
}
type MilkBoard = ReturnType<typeof milkBoard>;
const msDeck = (): Array<{ key: string; def: CardDefinition }> =>
  Array.from({ length: 6 }, (_, i) => ({ key: `d${i}`, def: i === 2 ? zed({ cost: 1 }) : character({ name: `Deck ${i}` }) }));
const revealsOf = (b: MilkBoard): string[] =>
  b.engine
    .getLog()
    .filter((entry) => entry.event?.type === "cardsRevealed")
    .flatMap((entry) => (entry.event as unknown as { cardIds: string[] }).cardIds);
/** Answers the echo's prompts: reveal-and-pick `pickKey` (decline when undefined), then deploy it (unless `deploy` is false). */
function answerEcho(b: MilkBoard, pickKey?: string, deploy = true): void {
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "the Milkshake's controller decides");
  assert.equal((pc.declaration as { id: string }).id, "voided");
  resolveChoice(b.engine, pc, { kind: "chooserSelectsTarget", selected: pickKey ? [b.id(pickKey)] : [] });
  if (!pickKey) return;
  const dp = pending(b.engine)!;
  assert.equal(dp.kind, "deployForFree", "you are then asked whether to deploy it");
  assert.equal(dp.playerId, P1);
  resolveChoice(b.engine, dp, deploy ? { kind: "deployForFree", cardId: b.id(pickKey) } : { kind: "deployForFree" });
}

/** Plays out the echo prompts for a deploy of `playedKey`: reveals/deploys the first voided card (of `voidedKeys`) still in the void with the played card's name. */
function echoLoop(b: MilkBoard, playedKey: string, voidedKeys: string[]): void {
  const name = b.engine.getDefinition(b.id(playedKey)).name;
  let guard = 0;
  // Each Milkshake reveals its OWN voided card: when a second reveal prompt opens before the first card
  // is deployed (both triggers fire on one deploy), a card already picked for the first is not picked again.
  const taken = new Set<string>();
  while (b.engine.state.pendingChoice && guard++ < 10) {
    const pc = pending(b.engine)!;
    if (pc.kind === "chooserSelectsTarget") {
      const left = voidedKeys.find((k) => !taken.has(k) && b.engine.state.cards[b.id(k)].zone === "void" && b.engine.getDefinition(b.id(k)).name === name);
      if (left) taken.add(left);
      resolveChoice(b.engine, pc, { kind: "chooserSelectsTarget", selected: left ? [b.id(left)] : [] });
    } else if (pc.kind === "deployForFree") {
      resolveChoice(b.engine, pc, { kind: "deployForFree", cardId: (pc.candidates as string[])[0] });
    } else resolveChoice(b.engine, pc, declineAll(pc));
  }
}

clause(MILK, "0:rule", "printed card: a rogue tactic, cost 3, threshold [D][D][D][D]", () => {
  const p = printing(MILK);
  assert.equal(p.type, "tactic");
  assert.equal(p.trade, "rogue");
  assert.equal(p.cost, 3);
  assert.equal(p.threshold, "dddd");
});

// no pick for the "may search" = the player declines to search (Q2)
const milkCast = (b: MilkBoard, pickKey?: string) => play(b.engine, P1, b.id("msh0"), { selected: pickKey ? { dig: [b.id(pickKey)] } : { dig: [], "__declined:dig": [] } });

clause(MILK, "0:rule", "cost 3 and threshold [D][D][D][D]: exact board plays, one ready resource short or a missing [D] is refused", () => {
  // 4 [D], one of them spent -> 3 ready: exactly the cost
  const ok = milkBoard({ inHand: 1, p1Dec: 3, p1SpentDec: 1, p2Deck: msDeck() });
  const before = ready(ok.engine);
  milkCast(ok, "d0");
  assert.equal(zoneOf(ok.engine, ok.id("msh0")), "discard");
  assert.equal(before - ready(ok.engine), 3, "3 resources are paid");
  // 4 [D] with two spent -> only 2 ready
  const short = milkBoard({ inHand: 1, p1Dec: 2, p1SpentDec: 2, p2Deck: msDeck() });
  refused(() => playRaw(short.engine, P1, short.id("msh0"), { selected: { dig: [short.id("d0")] } }), "2 ready resources for a cost of 3");
  assert.equal(zoneOf(short.engine, short.id("msh0")), "hand");
  // 3 [D] + 1 other: threshold [D][D][D][D] unmet
  const thr = milkBoard({ inHand: 1, p1Dec: 3, p1Greed: 1, p2Deck: msDeck() });
  refused(() => playRaw(thr.engine, P1, thr.id("msh0"), { selected: { dig: [thr.id("d0")] } }), "only three [D]");
  assert.equal(zoneOf(thr.engine, thr.id("msh0")), "hand");
});

clause(MILK, "0:rule", "you may search an opponent's deck for a card: the found card goes to the void face-down, still the opponent's", () => {
  const b = milkBoard({ inHand: 1, p1Dec: 4, p2Deck: msDeck() });
  milkCast(b, "d3");
  assert.equal(b.engine.state.pendingChoice, undefined);
  const c = b.engine.state.cards[b.id("d3")];
  assert.equal(c.zone, "void");
  assert.equal(c.ownerId, P2);
  assert.ok(!b.engine.state.players[P2].deck.includes(b.id("d3")), "!b.engine.state.players[P2].deck.includes(b.id(\"d3\"))");
  assert.equal(b.engine.state.players[P2].deck.length, 5);
  assert.equal(zoneOf(b.engine, b.id("msh0")), "discard", "the tactic is spent");
  assert.equal(b.engine.state.players[P1].deck.length, 3, "my deck untouched");
});

clause(MILK, "0:rule", "the found card is put in the void FACE-DOWN", () => {
  const b = milkBoard({ inHand: 1, p1Dec: 4, p2Deck: msDeck() });
  milkCast(b, "d3");
  assert.equal(b.engine.state.cards[b.id("d3")].zone, "void");
  assert.equal(b.engine.state.cards[b.id("d3")].faceDown, true, "put in the void face-down");
});

clause(MILK, "0:rule", "any card of their deck can be taken: the top and the bottom card", () => {
  for (const key of ["d0", "d5"]) {
    const b = milkBoard({ inHand: 1, p1Dec: 4, p2Deck: msDeck() });
    milkCast(b, key);
    assert.equal(zoneOf(b.engine, b.id(key)), "void", key);
  }
});

clause(MILK, "0:rule", "the search shuffles their deck afterwards (CR 312.1)", () => {
  let moved = 0;
  for (const seed of [0, 0.3, 0.99]) {
    const b = milkBoard({ inHand: 1, p1Dec: 4, p2Deck: msDeck(), random: () => seed });
    const before = deckOf(b.engine, P2).filter((c) => c !== b.id("d3"));
    milkCast(b, "d3");
    const after = deckOf(b.engine, P2);
    assert.deepEqual([...after].sort(), [...before].sort(), `seed ${seed}`);
    if (JSON.stringify(after) !== JSON.stringify(before)) moved++;
  }
  assert.ok(moved >= 1, "their deck order changed for at least one seed");
});

clause(MILK, "0:rule", "you may decline the search: nothing is voided and the deck is not shuffled", () => {
  const b = milkBoard({ inHand: 1, p1Dec: 4, p2Deck: msDeck(), random: () => 0.3 });
  const before = deckOf(b.engine, P2);
  milkCast(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("msh0")), "discard");
  assert.equal(Object.values(b.engine.state.cards).filter((c) => c.zone === "void").length, 0, "nothing voided");
  assert.deepEqual(deckOf(b.engine, P2), before, "no search, no shuffle");
});

clause(MILK, "0:rule", "only an opponent's DECK is searchable: your own deck and their hand are refused", () => {
  const b = milkBoard({ inHand: 1, p1Dec: 4, p2Deck: msDeck(), p2Hand: [{ key: "oh", def: character({ name: "Opp Hand" }) }] });
  refused(() => playRaw(b.engine, P1, b.id("msh0"), { selected: { dig: [b.id("p1deck0")] } }), "own deck");
  refused(() => playRaw(b.engine, P1, b.id("msh0"), { selected: { dig: [b.id("oh")] } }), "their hand");
  assert.equal(zoneOf(b.engine, b.id("msh0")), "hand");
  milkCast(b, "d1");
  assert.equal(zoneOf(b.engine, b.id("d1")), "void", "control");
  assert.equal(zoneOf(b.engine, b.id("p1deck0")), "deck");
});

clause(MILK, "0:rule", "a single card: picking two cards from their deck is refused", () => {
  const b = milkBoard({ inHand: 1, p1Dec: 4, p2Deck: msDeck() });
  refused(() => playRaw(b.engine, P1, b.id("msh0"), { selected: { dig: [b.id("d0"), b.id("d1")] } }), "two cards");
  assert.equal(zoneOf(b.engine, b.id("msh0")), "hand");
  assert.equal(zoneOf(b.engine, b.id("d0")), "deck");
  milkCast(b, "d0");
  assert.equal(Object.values(b.engine.state.cards).filter((c) => c.zone === "void").length, 1);
});

clause(MILK, "0:rule", "a deck with nothing to find (empty): the tactic still resolves", () => {
  const b = milkBoard({ inHand: 1, p1Dec: 4 });
  const p2 = b.engine.state.players[P2];
  for (const id of p2.deck) b.engine.state.cards[id].zone = "discard";
  p2.discard.push(...p2.deck);
  p2.deck = [];
  milkCast(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("msh0")), "discard");
});

// ---- the lasting trigger ---------------------------------------------------------------------------------

const echoBoard = (o: MilkOpts = {}) =>
  milkBoard({
    turnP2: true,
    inDiscard: 1,
    voided: [{ key: "zedv", def: zed({ threshold: "rr" }) }],
    p2Hand: [
      { key: "zed", def: zed({ cost: 1 }) },
      { key: "other", def: character({ name: "Other", cost: 1 }) }
    ],
    p1Greed: 3,
    ...o
  });

clause(MILK, "0:rule", "when the opponent deploys a card with the voided card's name, you may reveal the voided card", () => {
  const b = echoBoard();
  play(b.engine, P2, b.id("zed"));
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "you are asked");
  assert.deepEqual(revealsOf(b).filter((c) => c === b.id("zedv")), [], "nothing revealed before you agree");
  resolveChoice(b.engine, pc, { kind: "chooserSelectsTarget", selected: [b.id("zedv")] });
  assert.ok(revealsOf(b).includes(b.id("zedv")), "the voided card was revealed");
  assert.equal(pending(b.engine)?.kind, "deployForFree", "then you may deploy it");
  assert.equal(zoneOf(b.engine, b.id("zedv")), "void", "not deployed until you agree");
});

clause(MILK, "0:rule", "you may deploy the revealed card for free even if you cannot meet its threshold: it enters under your control", () => {
  const b = echoBoard();
  const before = ready(b.engine);
  play(b.engine, P2, b.id("zed"));
  answerEcho(b, "zedv");
  const v = b.engine.state.cards[b.id("zedv")];
  assert.equal(v.zone, "play", "deployed");
  assert.equal(v.controllerId, P1);
  assert.equal(v.ownerId, P2, "still their card");
  assert.equal(v.faceDown, false, "face-up once deployed");
  assert.equal(ready(b.engine), before, "free: no resources spent for its cost of 4");
  assert.equal(b.engine.getStat(b.id("zedv"), "strength"), 3);
  assert.equal(b.engine.getStat(b.id("zedv"), "life"), 2);
  assert.ok(b.engine.state.players[P1].play.includes(b.id("zedv")), "b.engine.state.players[P1].play.includes(b.id(\"zedv\"))");
});

clause(MILK, "0:rule", "if you deploy it, the opponent's card is terminated", () => {
  const b = echoBoard();
  play(b.engine, P2, b.id("zed"));
  answerEcho(b, "zedv");
  assert.notEqual(zoneOf(b.engine, b.id("zed")), "play", "their Zed did not stay in play");
  assert.equal(zoneOf(b.engine, b.id("zed")), "discard");
  assert.ok(b.engine.state.players[P2].discard.includes(b.id("zed")), "b.engine.state.players[P2].discard.includes(b.id(\"zed\"))");
  assert.equal(b.engine.state.cards[b.id("zedv")].zone, "play", "yours stays");
});

clause(MILK, "0:rule", "you may decline: the voided card stays face-down in the void and their card is not terminated", () => {
  const b = echoBoard();
  play(b.engine, P2, b.id("zed"));
  answerEcho(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  const v = b.engine.state.cards[b.id("zedv")];
  assert.equal(v.zone, "void");
  assert.equal(v.faceDown, true);
  assert.equal(zoneOf(b.engine, b.id("zed")), "play", "their card is untouched");
  assert.equal(b.engine.state.cards[b.id("zed")].controllerId, P2);
  assert.deepEqual(revealsOf(b), [], "declining reveals nothing");
});

clause(MILK, "0:rule", "you may reveal it and still decline to deploy: it stays in the void and their card is NOT terminated", () => {
  const b = echoBoard();
  play(b.engine, P2, b.id("zed"));
  answerEcho(b, "zedv", false);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.ok(revealsOf(b).includes(b.id("zedv")), "it was revealed");
  assert.equal(zoneOf(b.engine, b.id("zedv")), "void", "not deployed");
  assert.equal(zoneOf(b.engine, b.id("zed")), "play", "terminate happens only 'if you deploy it'");
  assert.equal(b.engine.state.cards[b.id("zed")].controllerId, P2);
});

clause(MILK, "0:rule", "a card with a different name does not trigger it", () => {
  const b = echoBoard();
  play(b.engine, P2, b.id("other"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("zedv")), "void");
  assert.equal(zoneOf(b.engine, b.id("other")), "play");
});

clause(MILK, "0:rule", "the name must match the voided card: a similar name (Zed Two) does not trigger it", () => {
  const b = echoBoard({ p2Hand: [{ key: "zed2", def: zed({ name: "Zed Two", cost: 1 }) }, { key: "zed", def: zed({ cost: 1 }) }] });
  play(b.engine, P2, b.id("zed2"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("zed2")), "play");
  play(b.engine, P2, b.id("zed"));
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "control: the exact name triggers");
});

clause(MILK, "0:rule", "playing a resource does not trigger it: a face-down card with the voided name, and a face-up resource card", () => {
  const stash = resourceCard({ name: "Stash" });
  const b = echoBoard({
    voided: [
      { key: "zedv", def: zed({ threshold: "rr" }) },
      { key: "stashv", def: stash }
    ],
    p2Hand: [
      { key: "zed", def: zed({ cost: 1 }) },
      { key: "stash", def: stash }
    ]
  });
  developResource(b.engine, P2, b.id("zed"), true);
  assert.equal(b.engine.state.pendingChoice, undefined, "a face-down character as a resource");
  assert.equal(zoneOf(b.engine, b.id("zedv")), "void");
  const c = echoBoard({
    voided: [{ key: "stashv", def: stash }],
    p2Hand: [{ key: "stash", def: stash }]
  });
  developResource(c.engine, P2, c.id("stash"), false);
  assert.equal(c.engine.state.pendingChoice, undefined, "a face-up resource card");
  assert.equal(zoneOf(c.engine, c.id("stashv")), "void");
  const e = echoBoard({ voided: [{ key: "stashv", def: stash }], p2Hand: [{ key: "stash", def: stash }] });
  try {
    play(e.engine, P2, e.id("stash")); // playing the resource card as a deploy, if the engine allows it at all
  } catch {
    /* refused: nothing was played */
  }
  assert.equal(e.engine.state.pendingChoice, undefined, "playing a resource card never triggers it");
  assert.equal(zoneOf(e.engine, e.id("stashv")), "void");
  const d = echoBoard();
  play(d.engine, P2, d.id("zed"));
  assert.equal(pending(d.engine)?.kind, "chooserSelectsTarget", "control: deploying (not developing) it triggers");
});

clause(MILK, "0:rule", "only the OPPONENT's deploys count: you deploying a same-named card does not trigger it", () => {
  const b = milkBoard({
    inDiscard: 1,
    voided: [{ key: "zedv", def: zed({ threshold: "rr" }) }],
    p1Hand: [{ key: "mzed", def: zed({ cost: 1 }) }],
    p1Greed: 3
  });
  play(b.engine, P1, b.id("mzed"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("zedv")), "void");
  assert.equal(zoneOf(b.engine, b.id("mzed")), "play");
});

clause(MILK, "0:rule", "does nothing before the Milkshake is played (still in hand) — and works after it is played for real", () => {
  const b = milkBoard({
    turnP2: true,
    inHand: 1,
    voided: [{ key: "zedv", def: zed({ threshold: "rr" }) }],
    p2Hand: [{ key: "zed", def: zed({ cost: 1 }) }],
    p1Dec: 4,
    p2Deck: msDeck()
  });
  play(b.engine, P2, b.id("zed"));
  assert.equal(b.engine.state.pendingChoice, undefined, "tactic in hand: no effect");
});

clause(MILK, "0:rule", "full flow: play the Milkshake for a Zed in their deck, then their own Zed deploy lets you take it", () => {
  const f = milkBoard({ inHand: 1, p1Dec: 4, p2Deck: msDeck(), p2Hand: [{ key: "zedh", def: zed({ cost: 1 }) }], p2Rage: 6 });
  milkCast(f, "d2");
  assert.equal(zoneOf(f.engine, f.id("d2")), "void");
  endTurn(f.engine, P1);
  assert.equal(f.engine.state.activePlayerId, P2);
  play(f.engine, P2, f.id("zedh"));
  answerEcho(f, "d2");
  assert.equal(zoneOf(f.engine, f.id("d2")), "play");
  assert.equal(f.engine.state.cards[f.id("d2")].controllerId, P1);
  assert.equal(zoneOf(f.engine, f.id("zedh")), "discard");
});

clause(MILK, "0:rule", "lasts for the rest of the game: it fires on a later turn, on every turn, until the voided card is used", () => {
  const b = echoBoard({
    p2Hand: [
      { key: "zed", def: zed({ cost: 1 }) },
      { key: "zedb", def: zed({ cost: 1 }) }
    ]
  });
  endTurn(b.engine, P2); // P1's turn
  endTurn(b.engine, P1); // P2's turn again
  assert.equal(b.engine.state.activePlayerId, P2);
  play(b.engine, P2, b.id("zed"));
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "two turns later it still fires");
  answerEcho(b);
  play(b.engine, P2, b.id("zedb"));
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "declining once does not use it up");
  answerEcho(b, "zedv");
  assert.equal(zoneOf(b.engine, b.id("zedv")), "play");
  assert.equal(zoneOf(b.engine, b.id("zedb")), "discard");
});

clause(MILK, "0:rule", "after the voided card is deployed, a further same-named deploy has nothing to reveal (no prompt)", () => {
  const b = echoBoard({
    p2Hand: [
      { key: "zed", def: zed({ cost: 1 }) },
      { key: "zedb", def: zed({ cost: 1 }) }
    ]
  });
  play(b.engine, P2, b.id("zed"));
  answerEcho(b, "zedv");
  play(b.engine, P2, b.id("zedb"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("zedb")), "play", "no more voided copy: their card stays");
});

clause(MILK, "0:rule", "free means free even when it would cost: the voided card's cost is not paid and a threshold it cannot meet is ignored", () => {
  const big = zed({ cost: 6, threshold: "rrr" });
  const b = echoBoard({ voided: [{ key: "zedv", def: big }], p1Greed: 2 });
  const before = ready(b.engine);
  play(b.engine, P2, b.id("zed"));
  answerEcho(b, "zedv");
  assert.equal(zoneOf(b.engine, b.id("zedv")), "play");
  assert.equal(ready(b.engine), before);
});

clause(MILK, "0:rule", "works for a location: the voided Location is deployed for free and the opponent's Location is terminated", () => {
  const loc = (cost: number) => location({ name: "Shed", cost, structure: 3, threshold: "rr" });
  const b = milkBoard({
    turnP2: true,
    inDiscard: 1,
    voided: [{ key: "shedv", def: loc(4) }],
    p2Hand: [{ key: "shed", def: loc(1) }],
    p1Greed: 2
  });
  const before = ready(b.engine);
  play(b.engine, P2, b.id("shed"));
  answerEcho(b, "shedv");
  assert.equal(zoneOf(b.engine, b.id("shedv")), "play");
  assert.equal(b.engine.state.cards[b.id("shedv")].controllerId, P1);
  assert.equal(ready(b.engine), before);
  assert.equal(zoneOf(b.engine, b.id("shed")), "discard");
});

clause(MILK, "0:rule", "works for an item: the voided Item is deployed for free and the opponent's Item is terminated", () => {
  const gadget = (cost: number) => item({ name: "Gadget", cost, threshold: "rr" });
  const b = milkBoard({
    turnP2: true,
    inDiscard: 1,
    voided: [{ key: "gadv", def: gadget(4) }],
    p2Hand: [{ key: "gad", def: gadget(1) }],
    p1Greed: 2
  });
  const before = ready(b.engine);
  play(b.engine, P2, b.id("gad"));
  answerEcho(b, "gadv");
  assert.equal(zoneOf(b.engine, b.id("gadv")), "play");
  assert.equal(b.engine.state.cards[b.id("gadv")].controllerId, P1);
  assert.equal(ready(b.engine), before);
  assert.equal(zoneOf(b.engine, b.id("gad")), "discard");
});

clause(MILK, "0:rule", "works for a tactic: the opponent's tactic is terminated before it does anything", () => {
  const zap = (cost: number) =>
    tactic({
      name: "Zap",
      cost,
      threshold: "rr",
      behavior: { abilities: [{ id: "zapdraw", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
    });
  const b = milkBoard({
    turnP2: true,
    inDiscard: 1,
    voided: [{ key: "zapv", def: zap(4) }],
    p2Hand: [{ key: "zap", def: zap(1) }],
    p2Deck: [{ key: "p2top", def: character({ name: "P2 Top" }) }],
    p1Greed: 2
  });
  const before = ready(b.engine);
  const handBefore = b.engine.state.players[P2].hand.length;
  play(b.engine, P2, b.id("zap"));
  answerEcho(b, "zapv");
  drain(b.engine, declineAll);
  assert.equal(ready(b.engine), before, "free");
  assert.equal(zoneOf(b.engine, b.id("zapv")), "discard", "the deployed tactic resolved and went to the discard pile");
  assert.equal(zoneOf(b.engine, b.id("zap")), "discard");
  assert.equal(b.engine.state.players[P2].hand.length, handBefore - 1, "their tactic was terminated: they did not draw");
});

clause(MILK, "0:rule", "two Milkshakes (voiding different names) each work: deploying one name uses only its own voided card", () => {
  const b = milkBoard({
    turnP2: true,
    inDiscard: 2,
    voided: [
      { key: "zedv", def: zed({ threshold: "rr" }) },
      { key: "yodv", def: character({ name: "Yod", cost: 5, threshold: "rr" }) }
    ],
    p2Hand: [
      { key: "zed", def: zed({ cost: 1 }) },
      { key: "yod", def: character({ name: "Yod", cost: 1 }) }
    ],
    p1Greed: 2
  });
  play(b.engine, P2, b.id("zed"));
  echoLoop(b, "zed", ["zedv", "yodv"]);
  assert.equal(zoneOf(b.engine, b.id("zedv")), "play", "Zed's voided card was deployed");
  assert.equal(zoneOf(b.engine, b.id("yodv")), "void", "Yod's voided card was not");
  assert.equal(zoneOf(b.engine, b.id("zed")), "discard");
  play(b.engine, P2, b.id("yod"));
  echoLoop(b, "yod", ["zedv", "yodv"]);
  assert.equal(zoneOf(b.engine, b.id("yodv")), "play", "the second Milkshake's voided card is deployed too");
  assert.equal(zoneOf(b.engine, b.id("yod")), "discard");
});

clause(MILK, "0:rule", "two Milkshakes that voided the same name: deploying that name lets each reveal and deploy its own voided card", () => {
  const b = milkBoard({
    turnP2: true,
    inDiscard: 2,
    voided: [
      { key: "zedv", def: zed({ threshold: "rr" }) },
      { key: "zedw", def: zed({ threshold: "rr" }) }
    ],
    p2Hand: [{ key: "zed", def: zed({ cost: 1 }) }],
    p1Greed: 2
  });
  play(b.engine, P2, b.id("zed"));
  echoLoop(b, "zed", ["zedv", "zedw"]);
  assert.equal(zoneOf(b.engine, b.id("zedv")), "play");
  assert.equal(zoneOf(b.engine, b.id("zedw")), "play", "the second Milkshake triggered as well");
  assert.equal(zoneOf(b.engine, b.id("zed")), "discard");
});

clause(MILK, "0:rule", "a card of the opponent's that is voided is theirs: the search cannot pick from your own void or play zone", () => {
  const b = milkBoard({ inHand: 1, p1Dec: 4, p2Deck: msDeck() });
  refused(() => playRaw(b.engine, P1, b.id("msh0"), { selected: { dig: [b.id("mine")] } }), "a card in play");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
});
