// Clause tests — batch seed-3-01, part p3 (groups 14-18: 94r913 My 908570pp3r5,
// Ensmallment Ray, Hilarious Refrigerator Alarm, Merbegon the Insatiable
// Taxidermist, Notion Sickness). See docs/TESTING.md and
// `npm run card-tests -- manifest seed-3-01 --groups 14-18 --missing`.
// Expectations come from each card's PRINTED text; engine data is only used to
// drive the engine.

import assert from "node:assert/strict";
import {
  buildGame,
  bank,
  character,
  developFaction,
  drawerChar,
  item,
  killTactic,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic,
  P1,
  P2
} from "../per-card/_harness.js";
import type { StapleIcon } from "../per-card/_harness.js";
import { clause, drain, declineAll, printing, refused, flipUpNow } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { battleOf, declareAttackBy } from "./_battle.js";
import { pending, readyResources, zoneOf } from "./_board.js";
import { endTurn, factionOf } from "./_turn.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

type Icons = Partial<Record<StapleIcon, number>>;

/** Staple resources for `owner`, e.g. `res({ elitism: 2, rage: 3 })`. */
const res = (icons: Icons, owner: PlayerId = P1): CardPlacement[] =>
  (Object.entries(icons) as Array<[StapleIcon, number]>).flatMap(([icon, n]) => bank(icon, n, owner));

/** Resources not yet attached to anything (what a numeric cost draws from). */
const ready = (engine: SpoilsEngine, player: PlayerId = P1): number => readyResources(engine, player);

const handOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].hand];
const deckOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].deck];

/** Both factions can develop (draw or play a resource). */
const devBoard = (cards: CardPlacement[], extra: Parameters<typeof buildGame>[0] = {}) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, ...extra, cards });

/** Raw `flipUp` WITHOUT draining the response window. */
function flipUpRaw(engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}, variables: Record<string, number> = {}): void {
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables });
}

/** Raw `playCard` WITHOUT draining the response window. */
function castRaw(engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}, variables: Record<string, number> = {}): void {
  engine.perform({ type: "playCard", playerId: player, cardId, selected, variables } as never);
}

/** The open pending choice, asserting its kind. */
function expectPending(engine: SpoilsEngine, kind: string): PendingChoiceLike {
  const pc = pending(engine);
  assert.ok(pc, `expected an open pending choice of kind ${kind}, found none`);
  assert.equal(pc.kind, kind);
  return pc;
}

/** A tactic that draws one card for its controller (so a player can really play it). */
const drawTactic = (name: string, cost: number, extra: Partial<CardDefinition> = {}): CardDefinition =>
  tactic({
    name,
    cost,
    behavior: { abilities: [{ id: "draw1", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] },
    ...extra
  });

/** A free tactic that destroys one chosen item in play (decl `t`). */
const itemKiller = (): CardDefinition =>
  tactic({
    name: "Item Killer",
    cost: 0,
    behavior: {
      abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
    }
  });

/** `n` plain cards for `owner`'s deck (deck order = array order, index 0 is the top). */
const deckCards = (prefix: string, n: number, owner: PlayerId = P1): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: character({ name: `${prefix.toUpperCase()}${i}` }), owner, zone: "deck" as const }));

// =====================================================================================
// 94r913 My 908570pp3r5
// =====================================================================================

const POP = "9bc47884-f956-41d4-8a57-e6c3e377b8d9"; // tactic, cost 3, threshold e -- COST: If you played this card using FLIP UP X is 4, otherwise X is 2. Pick X or fewer characters. -- EFFECT: This turn, the characters must attack if they can. Draw a card. -- FLIP UP: 2 [E]

interface PopOpts {
  pop?: "hand" | "faceDown";
  elitism?: number;
  rage?: number;
  /** spent (already attached) [E] resources: they meet thresholds but are not ready to pay */
  spentElitism?: number;
  extra?: CardPlacement[];
  /** override the placements of the P1 character `b` */
  b?: Partial<CardPlacement>;
}

/** P1 holds Poppers (in hand or face-down); P1 has characters a, b, c; P2 has o1, o2; P1 has a 3-card deck. */
function popBoard(o: PopOpts = {}) {
  const faceDown = o.pop === "faceDown";
  return devBoard([
    { key: "pop", def: printing(POP), owner: P1, zone: faceDown ? "play" : "hand", faceDown },
    { key: "a", def: character({ name: "Alpha", strength: 2, life: 2 }), owner: P1, zone: "play" },
    { key: "b", def: character({ name: "Bravo", strength: 2, life: 2 }), owner: P1, zone: "play", ...(o.b ?? {}) },
    { key: "c", def: character({ name: "Charlie", strength: 2, life: 2 }), owner: P1, zone: "play" },
    { key: "o1", def: character({ name: "Oscar", strength: 2, life: 2 }), owner: P2, zone: "play" },
    { key: "o2", def: character({ name: "Papa", strength: 2, life: 2 }), owner: P2, zone: "play" },
    ...deckCards("d", 3),
    ...res({ elitism: o.elitism ?? 5, rage: o.rage ?? 0 }),
    ...res({ elitism: o.spentElitism ?? 0 }).map((p) => ({ ...p, attachedToKey: "__factionA" })),
    ...(o.extra ?? [])
  ]);
}
type PopGame = ReturnType<typeof popBoard>;
const popPlay = (g: PopGame, picks: string[]): void => play(g.engine, P1, g.id("pop"), { selected: { picked: picks.map((k) => g.id(k)) } });
const popFlip = (g: PopGame, picks: string[]): void => flipUpRaw(g.engine, P1, g.id("pop"), { picked: picks.map((k) => g.id(k)) });
const mustAttack = (g: PopGame, key: string): boolean => g.engine.getRestrictions(g.id(key)).includes("mustAttack");

clause(POP, "0:ability", "COST 3 [E]: playing it pays exactly 3, then the 2 picked characters (mine and the opponent's) must attack this turn and I draw the top card; unpicked characters are untouched", () => {
  const g = popBoard({ elitism: 5 });
  const top = deckOf(g.engine, P1)[0];
  assert.deepEqual(handOf(g.engine, P1), [g.id("pop")]);
  assert.equal(ready(g.engine), 5);
  popPlay(g, ["a", "o1"]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(ready(g.engine), 2, "the numeric cost 3 was paid");
  assert.equal(zoneOf(g.engine, g.id("pop")), "discard", "a resolved tactic goes to its owner's discard pile");
  assert.deepEqual(handOf(g.engine, P1), [top], "drew exactly the top card of my deck");
  assert.equal(deckOf(g.engine, P1).length, 2);
  assert.equal(mustAttack(g, "a"), true, "my picked character must attack");
  assert.equal(mustAttack(g, "o1"), true, "the opponent's picked character must attack too (the picker has no controller restriction)");
  for (const k of ["b", "c", "o2"]) assert.equal(mustAttack(g, k), false, `unpicked ${k} is not forced to attack`);
});

clause(POP, "0:ability", "X is 2 when played normally: 'X or fewer' accepts 1 and 0 picked characters (and still draws a card), but 3 picks are refused", () => {
  const g3 = popBoard();
  refused(() => popPlay(g3, ["a", "b", "c"]), "3 picks with X = 2");
  assert.equal(zoneOf(g3.engine, g3.id("pop")), "hand", "the refused play left the card in hand");
  assert.equal(ready(g3.engine), 5, "nothing was paid");
  assert.equal(mustAttack(g3, "a"), false);

  const g2 = popBoard();
  popPlay(g2, ["b", "c"]);
  assert.equal(mustAttack(g2, "b") && mustAttack(g2, "c"), true, "control: exactly X = 2 picks is fine");

  const g1 = popBoard();
  popPlay(g1, ["c"]);
  assert.equal(mustAttack(g1, "c"), true);
  assert.equal(mustAttack(g1, "a"), false);
  assert.equal(handOf(g1.engine, P1).length, 1, "drew a card");

  const g0 = popBoard();
  const top = deckOf(g0.engine, P1)[0];
  popPlay(g0, []);
  assert.equal(g0.engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(g0.engine, P1), [top], "picking no characters still draws a card");
  assert.equal(zoneOf(g0.engine, g0.id("pop")), "discard");
  for (const k of ["a", "b", "c", "o1", "o2"]) assert.equal(mustAttack(g0, k), false, `${k}`);
});

clause(POP, "0:ability", "only characters in play can be picked: an item, a character in hand and a character in a discard pile are refused", () => {
  const extra: CardPlacement[] = [
    { key: "it", def: item({ name: "Gadget" }), owner: P1, zone: "play" },
    { key: "hc", def: character({ name: "HandGuy" }), owner: P1, zone: "hand" },
    { key: "dc", def: character({ name: "BinGuy" }), owner: P2, zone: "discard" }
  ];
  for (const k of ["it", "hc", "dc"]) {
    const g = popBoard({ extra });
    refused(() => popPlay(g, ["a", k]), `picking ${k}`);
    assert.equal(zoneOf(g.engine, g.id("pop")), "hand", `refused play of ${k} left the card in hand`);
    assert.equal(mustAttack(g, "a"), false);
  }
  const ok = popBoard({ extra });
  popPlay(ok, ["a", "o2"]);
  assert.equal(zoneOf(ok.engine, ok.id("pop")), "discard", "control: two characters in play are fine");
});

clause(POP, "0:ability", "costs 3 numeric and needs an [E]: refused with only 2 resources, refused with no [E] among plenty of other resources", () => {
  const short = popBoard({ elitism: 2 });
  refused(() => popPlay(short, ["a"]), "2 resources for cost 3");
  assert.equal(zoneOf(short.engine, short.id("pop")), "hand");
  assert.equal(ready(short.engine), 2);

  const noE = popBoard({ elitism: 0, rage: 6 });
  refused(() => popPlay(noE, ["a"]), "no [E] for threshold e");
  assert.equal(zoneOf(noE.engine, noE.id("pop")), "hand");
  assert.equal(ready(noE.engine), 6);

  const ok = popBoard({ elitism: 1, rage: 2 });
  popPlay(ok, ["a"]);
  assert.equal(zoneOf(ok.engine, ok.id("pop")), "discard", "control: one [E] plus two other resources is enough");
  assert.equal(ready(ok.engine), 0);
});

clause(POP, "0:ability", "the picked characters must attack: a declared attack that leaves out an eligible picked character is refused, one that includes them (or leaves out only unpicked ones) is fine", () => {
  const g = popBoard();
  popPlay(g, ["a", "b"]);
  refused(() => declareAttackBy(g.engine, P1, [g.id("a"), g.id("c")]), "b is picked and eligible but left out", /must attack/);
  refused(() => declareAttackBy(g.engine, P1, [g.id("c")]), "neither picked character attacks", /must attack/);
  assert.equal(battleOf(g.engine), undefined, "no battle started by the refused declarations");
  assert.equal(g.engine.state.cards[g.id("a")].depleted, false, "refusals deplete nothing");
  declareAttackBy(g.engine, P1, [g.id("a"), g.id("b")]);
  assert.ok(battleOf(g.engine), "attacking with exactly the picked characters (unpicked c stays home) is legal");
  assert.equal(g.engine.state.cards[g.id("c")].depleted, false);
});

clause(POP, "0:ability", "'if they can': a picked character that cannot attack (depleted or not yet eligible) is not forced, so the others may attack alone", () => {
  const sick = popBoard({ b: { attackEligible: false } });
  popPlay(sick, ["a", "b"]);
  refused(() => declareAttackBy(sick.engine, P1, [sick.id("c")]), "a is picked, eligible and left out", /must attack/);
  declareAttackBy(sick.engine, P1, [sick.id("a")]);
  assert.ok(battleOf(sick.engine), "b is not eligible to attack this turn, so only a is required");

  const tired = popBoard({ b: { depleted: true } });
  popPlay(tired, ["a", "b"]);
  declareAttackBy(tired.engine, P1, [tired.id("a")]);
  assert.ok(battleOf(tired.engine), "b is depleted, so only a is required");
});

clause(POP, "0:ability", "a picked character that can attack may not simply sit out the turn: ending the turn without attacking is refused", () => {
  const g = popBoard();
  popPlay(g, ["a"]);
  refused(() => endTurn(g.engine, P1), "a must attack if it can", /attack/);
  assert.equal(g.engine.state.activePlayerId, P1, "still my turn");
});

clause(POP, "0:ability", "'this turn': the must-attack restriction is gone after the turn ends, for my characters and the opponent's", () => {
  const g = popBoard({ b: { attackEligible: false } });
  popPlay(g, ["b", "o1"]);
  assert.equal(mustAttack(g, "b") && mustAttack(g, "o1"), true);
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(mustAttack(g, "b"), false, "my picked character is free again");
  assert.equal(mustAttack(g, "o1"), false, "the opponent's picked character is free again");
});

clause(POP, "0:ability", "played with FLIP UP, X is 4: four characters can be picked and must attack, a fifth pick is refused", () => {
  const five = popBoard({ pop: "faceDown", elitism: 3 });
  refused(() => popFlip(five, ["a", "b", "c", "o1", "o2"]), "5 picks with X = 4");
  assert.equal(five.engine.state.cards[five.id("pop")].faceDown, true, "still face-down after the refusal");
  assert.equal(ready(five.engine), 4);

  const g = popBoard({ pop: "faceDown", elitism: 3 });
  const top = deckOf(g.engine, P1)[0];
  popFlip(g, ["a", "b", "o1", "o2"]);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  for (const k of ["a", "b", "o1", "o2"]) assert.equal(mustAttack(g, k), true, `${k} must attack`);
  assert.equal(mustAttack(g, "c"), false);
  assert.deepEqual(handOf(g.engine, P1), [top], "and I drew a card");
  assert.equal(zoneOf(g.engine, g.id("pop")), "discard");
});

clause(POP, "0:ability", "played with FLIP UP, fewer than X is fine too: 3 picks and 0 picks both work", () => {
  const g3 = popBoard({ pop: "faceDown", elitism: 3 });
  popFlip(g3, ["a", "b", "c"]);
  resolvePendingResponses(g3.engine);
  assert.equal(mustAttack(g3, "a") && mustAttack(g3, "b") && mustAttack(g3, "c"), true);
  assert.equal(mustAttack(g3, "o1"), false);

  const g0 = popBoard({ pop: "faceDown", elitism: 3 });
  popFlip(g0, []);
  resolvePendingResponses(g0.engine);
  assert.equal(handOf(g0.engine, P1).length, 1, "still draws");
  assert.equal(zoneOf(g0.engine, g0.id("pop")), "discard");
});

clause(POP, "1:flipUp", "FLIP UP costs 2 (not the printed 3): [E] plus the face-down card itself is enough, and the card is spent", () => {
  const g = popBoard({ pop: "faceDown", elitism: 1 });
  assert.equal(ready(g.engine), 2, "one [E] and the face-down card's Volition");
  popFlip(g, ["a"]);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("pop")), "discard", "the tactic resolved");
  assert.equal(ready(g.engine), 0, "both resources were used");
  assert.equal(mustAttack(g, "a"), true, "and its text ran");
});

clause(POP, "1:flipUp", "FLIP UP does not over-charge: with plenty of resources it takes 2, not 3", () => {
  const g = popBoard({ pop: "faceDown", elitism: 5 });
  assert.equal(ready(g.engine), 6);
  popFlip(g, ["a"]);
  resolvePendingResponses(g.engine);
  assert.ok(ready(g.engine) >= 3, `2 paid plus the face-down card leaving the resource row is at most 3 gone, ${ready(g.engine)} left of 6`);
  assert.ok(ready(g.engine) <= 4, "ready(g.engine) <= 4");
});

clause(POP, "1:flipUp", "FLIP UP is refused one resource short (only the face-down card is ready) and without an [E]", () => {
  const short = popBoard({ pop: "faceDown", elitism: 0, spentElitism: 2 });
  assert.equal(ready(short.engine), 1, "only the face-down card is ready; the spent [E] still meet the threshold");
  refused(() => popFlip(short, ["a"]), "1 ready resource for a FLIP UP cost of 2");
  assert.equal(short.engine.state.cards[short.id("pop")].faceDown, true);
  assert.equal(mustAttack(short, "a"), false);

  const noE = popBoard({ pop: "faceDown", elitism: 0, rage: 5 });
  refused(() => popFlip(noE, ["a"]), "no [E] for the FLIP UP threshold");
  assert.equal(noE.engine.state.cards[noE.id("pop")].faceDown, true);
  assert.equal(ready(noE.engine), 6, "nothing was paid");
  assert.equal(mustAttack(noE, "a"), false);

  const ok = popBoard({ pop: "faceDown", elitism: 1 });
  popFlip(ok, ["a"]);
  resolvePendingResponses(ok.engine);
  assert.equal(zoneOf(ok.engine, ok.id("pop")), "discard", "control: one [E] plus the face-down card works");
});

// =====================================================================================
// Ensmallment Ray
// =====================================================================================

const RAY = "39c7dc51-bbf8-4d1c-aca7-40ebbb7bd2b7"; // item, cost 4, threshold eee -- When this card enters play, draw a card. -- Reduce the numeric cost of characters you play by 2, to a minimum of 1. -- All your characters lose 1 strength and 1 life.

interface RayOpts {
  ray?: "hand" | "play";
  elitism?: number;
  rage?: number;
  extra?: CardPlacement[];
}

/** P1 holds the Ray (hand or in play) with a 3-card deck. */
function rayBoard(o: RayOpts = {}) {
  return devBoard([
    { key: "ray", def: printing(RAY), owner: P1, zone: o.ray ?? "hand" },
    ...deckCards("d", 3),
    ...res({ elitism: o.elitism ?? 6, rage: o.rage ?? 0 }),
    ...(o.extra ?? [])
  ]);
}
type RayGame = ReturnType<typeof rayBoard>;
const cost = (g: RayGame, key: string, player: PlayerId = P1): number | undefined => g.engine.getCardPlayability(player, g.id(key)).numericCost;
const str = (g: RayGame, key: string): number => g.engine.getStat(g.id(key), "strength");
const life = (g: RayGame, key: string): number => g.engine.getStat(g.id(key), "life");

clause(RAY, "0:rule", "deploying costs 4 and needs [E][E][E]: playing it pays exactly 4, and refuses 3 resources or only two [E]", () => {
  const g = rayBoard({ elitism: 6 });
  play(g.engine, P1, g.id("ray"));
  assert.equal(zoneOf(g.engine, g.id("ray")), "play");
  assert.equal(ready(g.engine), 2, "4 of 6 resources were paid");

  const three = rayBoard({ elitism: 3 });
  refused(() => play(three.engine, P1, three.id("ray")), "3 resources for cost 4");
  assert.equal(zoneOf(three.engine, three.id("ray")), "hand");

  const twoE = rayBoard({ elitism: 2, rage: 4 });
  refused(() => play(twoE.engine, P1, twoE.id("ray")), "only two [E] for threshold eee");
  assert.equal(zoneOf(twoE.engine, twoE.id("ray")), "hand");
  assert.equal(ready(twoE.engine), 6);

  const ok = rayBoard({ elitism: 3, rage: 1 });
  play(ok.engine, P1, ok.id("ray"));
  assert.equal(zoneOf(ok.engine, ok.id("ray")), "play", "control: three [E] and one other resource is enough");
});

clause(RAY, "0:rule", "when it enters play I draw a card: the top card of my deck (and the Ray leaves my hand)", () => {
  const g = rayBoard();
  const top = deckOf(g.engine, P1)[0];
  assert.deepEqual(handOf(g.engine, P1), [g.id("ray")]);
  play(g.engine, P1, g.id("ray"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(g.engine, P1), [top], "exactly one card drawn, the top one");
  assert.equal(deckOf(g.engine, P1).length, 2);
});

clause(RAY, "0:rule", "only when THIS card enters: another item, character or tactic entering while the Ray is in play draws nothing", () => {
  const g = rayBoard({
    ray: "play",
    extra: [
      { key: "gadget", def: item({ name: "Gadget", cost: 0 }), owner: P1, zone: "hand" },
      { key: "guy", def: character({ name: "Guy", cost: 0 }), owner: P1, zone: "hand" },
      { key: "spell", def: tactic({ name: "Spell", cost: 0 }), owner: P1, zone: "hand" }
    ]
  });
  assert.equal(handOf(g.engine, P1).length, 3);
  play(g.engine, P1, g.id("gadget"));
  play(g.engine, P1, g.id("guy"));
  play(g.engine, P1, g.id("spell"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(handOf(g.engine, P1).length, 0, "three cards played, none drawn");
  assert.equal(deckOf(g.engine, P1).length, 3);
});

const RAY_COSTS = [0, 1, 2, 3, 4, 6] as const;
const RAY_REDUCED = [0, 1, 1, 1, 2, 4] as const; // 0 stays 0 (CR §410.5); the minimum of 1 applies to everything else

const rayHand = (): CardPlacement[] => RAY_COSTS.map((c, i) => ({ key: `ch${i}`, def: character({ name: `Hand${c}`, cost: c }), owner: P1, zone: "hand" as const }));

clause(RAY, "1:rule", "characters I play cost 2 less, to a minimum of 1: printed costs 1, 2, 3, 4 and 6 become 1, 1, 1, 2 and 4", () => {
  const g = rayBoard({ ray: "play", extra: rayHand() });
  RAY_COSTS.forEach((c, i) => {
    if (c > 0) assert.equal(cost(g, `ch${i}`), RAY_REDUCED[i], `a printed cost-${c} character costs ${RAY_REDUCED[i]}`);
  });
});

clause(RAY, "1:rule", "a printed cost-0 character stays at 0: the minimum of 1 never raises a cost already below it (CR 410.5)", () => {
  const g = rayBoard({ ray: "play", extra: rayHand() });
  assert.equal(cost(g, "ch0"), 0);
});

clause(RAY, "1:rule", "without the Ray in play the same characters cost their printed numbers", () => {
  const g = rayBoard({ ray: "hand", extra: rayHand() });
  RAY_COSTS.forEach((c, i) => assert.equal(cost(g, `ch${i}`), c, `cost-${c} character`));
});

clause(RAY, "1:rule", "only characters: items and tactics keep their printed cost", () => {
  const g = rayBoard({
    ray: "play",
    extra: [
      { key: "gadget", def: item({ name: "Gadget", cost: 4 }), owner: P1, zone: "hand" },
      { key: "spell", def: tactic({ name: "Spell", cost: 3 }), owner: P1, zone: "hand" },
      { key: "guy", def: character({ name: "Guy", cost: 4 }), owner: P1, zone: "hand" }
    ]
  });
  assert.equal(cost(g, "gadget"), 4);
  assert.equal(cost(g, "spell"), 3);
  assert.equal(cost(g, "guy"), 2, "control: the character is discounted");
});

clause(RAY, "1:rule", "only characters YOU play: the opponent's characters cost their printed number", () => {
  const g = rayBoard({
    ray: "play",
    extra: [
      { key: "mine", def: character({ name: "Mine", cost: 4 }), owner: P1, zone: "hand" },
      { key: "theirs", def: character({ name: "Theirs", cost: 4 }), owner: P2, zone: "hand" },
      ...res({ rage: 6 }, P2)
    ]
  });
  assert.equal(cost(g, "mine"), 2);
  assert.equal(cost(g, "theirs", P2), 4);
});

clause(RAY, "1:rule", "the discount is really paid: a cost-4 character deploys for 2 resources and is refused for 1", () => {
  const rich = rayBoard({ ray: "play", elitism: 2, extra: [{ key: "guy", def: character({ name: "Guy", cost: 4 }), owner: P1, zone: "hand" }] });
  play(rich.engine, P1, rich.id("guy"));
  assert.equal(zoneOf(rich.engine, rich.id("guy")), "play");
  assert.equal(ready(rich.engine), 0, "exactly 2 paid");

  const poor = rayBoard({ ray: "play", elitism: 1, extra: [{ key: "guy", def: character({ name: "Guy", cost: 4 }), owner: P1, zone: "hand" }] });
  refused(() => play(poor.engine, P1, poor.id("guy")), "1 resource for a cost-2 character");
  assert.equal(zoneOf(poor.engine, poor.id("guy")), "hand");
});

clause(RAY, "1:rule", "the discount ends when the Ray leaves play, and a character is again charged its printed cost", () => {
  const g = rayBoard({
    ray: "play",
    extra: [
      { key: "guy", def: character({ name: "Guy", cost: 4 }), owner: P1, zone: "hand" },
      { key: "killer", def: itemKiller(), owner: P1, zone: "hand" }
    ]
  });
  assert.equal(cost(g, "guy"), 2);
  play(g.engine, P1, g.id("killer"), { selected: { t: [g.id("ray")] } });
  assert.equal(zoneOf(g.engine, g.id("ray")), "discard");
  assert.equal(cost(g, "guy"), 4, "back to the printed cost");
  assert.equal(cost(g, "guy"), 4, "and still after another look");
});

const shrinkBoard = (rayZone: "hand" | "play" = "play") =>
  rayBoard({
    ray: rayZone,
    extra: [
      { key: "m1", def: character({ name: "Mine3", strength: 3, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "m2", def: character({ name: "Mine5", strength: 5, life: 4, speed: 4 }), owner: P1, zone: "play" },
      { key: "o1", def: character({ name: "Theirs", strength: 3, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "hand1", def: character({ name: "InHand", strength: 3, life: 3, speed: 2 }), owner: P1, zone: "hand" }
    ]
  });

clause(RAY, "2:rule", "all my characters in play lose exactly 1 strength and 1 life (speed is untouched); the opponent's characters and cards in my hand are unaffected", () => {
  const g = shrinkBoard("play");
  assert.deepEqual([str(g, "m1"), life(g, "m1"), g.engine.getStat(g.id("m1"), "speed")], [2, 2, 2]);
  assert.deepEqual([str(g, "m2"), life(g, "m2"), g.engine.getStat(g.id("m2"), "speed")], [4, 3, 4]);
  assert.deepEqual([str(g, "o1"), life(g, "o1")], [3, 3], "the opponent's character is untouched");
  assert.deepEqual([str(g, "hand1"), life(g, "hand1")], [3, 3], "a character in my hand is untouched");
});

clause(RAY, "2:rule", "it applies to characters that enter later, and to a character that is already in play when the Ray enters", () => {
  const g = shrinkBoard("hand");
  assert.deepEqual([str(g, "m1"), life(g, "m1")], [3, 3], "no Ray in play yet");
  play(g.engine, P1, g.id("ray"));
  assert.deepEqual([str(g, "m1"), life(g, "m1")], [2, 2], "shrunk once the Ray entered");
  const late = rayBoard({ ray: "play", elitism: 6, extra: [{ key: "late", def: character({ name: "Late", cost: 2, strength: 3, life: 3 }), owner: P1, zone: "hand" }] });
  play(late.engine, P1, late.id("late"));
  assert.equal(zoneOf(late.engine, late.id("late")), "play");
  assert.deepEqual([str(late, "late"), life(late, "late")], [2, 2], "a character played after the Ray is smaller too");
});

clause(RAY, "2:rule", "the shrink ends when the Ray leaves play", () => {
  const g = rayBoard({
    ray: "play",
    extra: [
      { key: "m1", def: character({ name: "Mine3", strength: 3, life: 3 }), owner: P1, zone: "play" },
      { key: "killer", def: itemKiller(), owner: P1, zone: "hand" }
    ]
  });
  assert.deepEqual([str(g, "m1"), life(g, "m1")], [2, 2]);
  play(g.engine, P1, g.id("killer"), { selected: { t: [g.id("ray")] } });
  assert.equal(zoneOf(g.engine, g.id("ray")), "discard");
  assert.deepEqual([str(g, "m1"), life(g, "m1")], [3, 3], "back to the printed 3/3");
});

clause(RAY, "2:rule", "a character with 1 life dies when the Ray makes it 0 life (the opponent's 1-life character does not)", () => {
  const g = rayBoard({
    ray: "hand",
    extra: [
      { key: "frail", def: character({ name: "Frail", strength: 2, life: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 1 }), owner: P2, zone: "play" }
    ]
  });
  play(g.engine, P1, g.id("ray"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("foe")), "play", "the opponent's 1-life character is unaffected");
  assert.equal(zoneOf(g.engine, g.id("frail")), "discard", "1 life minus 1 is 0 life: destroyed");
});

clause(RAY, "2:rule", "a 0-strength character stays at 0 strength (a stat never goes below 0) while its life still drops by 1", () => {
  const g = rayBoard({ ray: "play", extra: [{ key: "weak", def: character({ name: "Weak", strength: 0, life: 3 }), owner: P1, zone: "play" }] });
  assert.equal(str(g, "weak"), 0, "0 strength does not go negative");
  assert.equal(life(g, "weak"), 2);
});

clause(RAY, "2:rule", "two Rays stack: each takes 1 strength and 1 life from my characters", () => {
  const g = rayBoard({
    ray: "play",
    extra: [
      { key: "ray2", def: printing(RAY), owner: P1, zone: "play" },
      { key: "m1", def: character({ name: "Mine5", strength: 5, life: 5 }), owner: P1, zone: "play" }
    ]
  });
  assert.deepEqual([str(g, "m1"), life(g, "m1")], [3, 3]);
});

// =====================================================================================
// Hilarious Refrigerator Alarm
// =====================================================================================

const ALM = "febadb33-11cf-4dec-815b-5e86d03488f0"; // tactic, cost 2, threshold ee -- All unresolved cards are terminated. -- If an opponent played at least 2 cards with the same name this turn, put up to 2 Micromajig tokens into play under your control. Otherwise, each opponent may put 3 Micromajig tokens into play under their control. -- FLIP UP: 2 [E][E] and you may play a resource.

interface AlmOpts {
  alarm?: "hand" | "faceDown";
  elitism?: number;
  rage?: number;
  spentElitism?: number;
  active?: PlayerId;
  extra?: CardPlacement[];
}

/** P1 holds the Alarm (hand or face-down). P2 is the active player by default (turn 2) with a resolved Veteran in play. */
function almBoard(o: AlmOpts = {}) {
  const faceDown = o.alarm === "faceDown";
  const active = o.active ?? P2;
  const spent = res({ elitism: o.spentElitism ?? 0 }).map((p) => ({ ...p, attachedToKey: "__factionA" }));
  return devBoard(
    [
      { key: "alm", def: printing(ALM), owner: P1, zone: faceDown ? "play" : "hand", faceDown },
      { key: "vet", def: character({ name: "Veteran" }), owner: P2, zone: "play" },
      ...deckCards("d", 3, P1),
      ...deckCards("e", 3, P2),
      ...res({ elitism: o.elitism ?? 2, rage: o.rage ?? 0 }),
      ...spent,
      ...res({ rage: 6 }, P2),
      ...(o.extra ?? [])
    ],
    active === P2 ? { turn: 2, activePlayerId: P2 } : {}
  );
}
type AlmGame = ReturnType<typeof almBoard>;

interface AlmScript {
  /** how many of the "up to 2" tokens I take (default 2) */
  tokens?: number;
  /** whether the opponent accepts the 3 tokens (default true) */
  oppAccepts?: boolean;
  /** the hand card to play as a resource with FLIP UP (default: none) */
  resource?: string;
}
const seen: string[] = [];
/** Answers every pending choice the Alarm raises according to `s`; unknown kinds fail loudly. */
const almAnswers = (g: AlmGame, s: AlmScript = {}) => (pc: PendingChoiceLike): unknown => {
  seen.push(`${pc.kind}/${pc.playerId === P1 ? "P1" : "P2"}`);
  if (pc.kind === "mayPay") return { kind: "mayPay", pay: pc.playerId === P2 ? s.oppAccepts !== false : true };
  if (pc.kind === "chooseNumber") return { kind: "chooseNumber", value: s.tokens ?? 2 };
  if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: s.resource ? [g.id(s.resource)] : [] };
  throw new Error(`unexpected pending choice ${pc.kind} for ${pc.playerId}`);
};
/** Finishes everything the Alarm has open (response windows first, then its prompts). */
const almFinish = (g: AlmGame, s: AlmScript = {}): void => {
  resolvePendingResponses(g.engine);
  drain(g.engine, almAnswers(g, s));
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined, "everything was answered");
};
const named = (g: AlmGame, owner: PlayerId, name: string): CardInstanceId[] =>
  g.engine.state.players[owner].play.filter((c) => g.engine.getDefinition(c).name === name);

const twin = (key: string): CardPlacement => ({ key, def: character({ name: "Twin", cost: 0 }), owner: P2, zone: "hand" });
const other = (key: string, name: string): CardPlacement => ({ key, def: character({ name, cost: 0 }), owner: P2, zone: "hand" });
const bait = (): CardPlacement => ({ key: "bait", def: drawTactic("Bait", 0), owner: P2, zone: "hand" });

/** P2 (active) casts `bait`, P1 answers with the Alarm; both still on the stack. */
function almOnBait(g: AlmGame): void {
  castRaw(g.engine, P2, g.id("bait"));
  castRaw(g.engine, P1, g.id("alm"));
}

clause(ALM, "0:rule", "terminates the unresolved card it was played against: the opponent's tactic never resolves (no draw) and goes to their discard pile, while the Alarm itself resolves", () => {
  const g = almBoard({ extra: [bait()] });
  const e = handOf(g.engine, P2).length;
  almOnBait(g);
  almFinish(g, { oppAccepts: false });
  assert.equal(zoneOf(g.engine, g.id("bait")), "discard");
  assert.equal(handOf(g.engine, P2).length, e - 1, "bait left the hand and drew nothing");
  assert.equal(zoneOf(g.engine, g.id("alm")), "discard", "the Alarm itself resolved normally");
  assert.equal(zoneOf(g.engine, g.id("vet")), "play", "an already-resolved card is not touched");

  const c = almBoard({ extra: [bait()] });
  castRaw(c.engine, P2, c.id("bait"));
  resolvePendingResponses(c.engine);
  assert.equal(handOf(c.engine, P2).length, e, "control: without the Alarm the bait draws a card");
});

clause(ALM, "0:rule", "terminates ALL unresolved cards, including my own and several at once: both a tactic of mine and a tactic of the opponent's underneath it", () => {
  const g = almBoard({
    active: P1,
    elitism: 4,
    extra: [
      { key: "mine", def: drawTactic("Mine", 0), owner: P1, zone: "hand" },
      { key: "theirs", def: drawTactic("Theirs", 0), owner: P2, zone: "hand" }
    ]
  });
  castRaw(g.engine, P1, g.id("mine"));
  castRaw(g.engine, P2, g.id("theirs"));
  castRaw(g.engine, P1, g.id("alm"));
  almFinish(g, { oppAccepts: false });
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard");
  assert.equal(zoneOf(g.engine, g.id("theirs")), "discard");
  assert.deepEqual(handOf(g.engine, P1), [], "my own terminated tactic drew nothing either (hand held only the Alarm and Mine)");
  assert.equal(handOf(g.engine, P2).length, 0, "and neither did the opponent's");
  assert.equal(deckOf(g.engine, P1).length, 3);
  assert.equal(deckOf(g.engine, P2).length, 3);
});

clause(ALM, "0:rule", "terminates an unresolved character too: it never enters play and goes to its owner's discard pile", () => {
  const g = almBoard({ extra: [other("big", "Incoming")] });
  castRaw(g.engine, P2, g.id("big"));
  castRaw(g.engine, P1, g.id("alm"));
  almFinish(g, { oppAccepts: false });
  assert.equal(zoneOf(g.engine, g.id("big")), "discard");
  assert.equal(named(g, P2, "Incoming").length, 0);
});

clause(ALM, "1:rule", "the opponent played 2 cards with the same name this turn: I put 2 Micromajig tokens into play under MY control and the opponent gets none", () => {
  const g = almBoard({ extra: [twin("t1"), twin("t2"), bait()] });
  play(g.engine, P2, g.id("t1"));
  play(g.engine, P2, g.id("t2"));
  almOnBait(g);
  almFinish(g, { tokens: 2 });
  assert.equal(named(g, P1, "Micromajig").length, 2, "two tokens for me");
  assert.equal(named(g, P2, "Micromajig").length, 0, "none for the opponent (no 'otherwise' branch)");
  for (const t of named(g, P1, "Micromajig")) {
    assert.equal(g.engine.state.cards[t].controllerId, P1);
    assert.ok(g.engine.hasCardType(t, "character"), "a Micromajig token is a character");
  }
  assert.equal(zoneOf(g.engine, g.id("bait")), "discard", "and the unresolved bait was terminated");
});

clause(ALM, "1:rule", "'up to 2': I may take just 1 token, or none", () => {
  for (const n of [1, 0]) {
    const g = almBoard({ extra: [twin("t1"), twin("t2"), bait()] });
    play(g.engine, P2, g.id("t1"));
    play(g.engine, P2, g.id("t2"));
    almOnBait(g);
    almFinish(g, { tokens: n });
    assert.equal(named(g, P1, "Micromajig").length, n, `${n} token(s) for me`);
    assert.equal(named(g, P2, "Micromajig").length, 0);
  }
});

clause(ALM, "1:rule", "otherwise (the opponent's two cards have different names): the opponent may put 3 Micromajig tokens into play under THEIR control, and I get none", () => {
  const g = almBoard({ extra: [other("x1", "Alpha"), other("x2", "Beta"), bait()] });
  play(g.engine, P2, g.id("x1"));
  play(g.engine, P2, g.id("x2"));
  almOnBait(g);
  almFinish(g, { oppAccepts: true });
  assert.equal(named(g, P2, "Micromajig").length, 3, "three tokens for the opponent");
  assert.equal(named(g, P1, "Micromajig").length, 0, "none for me");
  for (const t of named(g, P2, "Micromajig")) assert.equal(g.engine.state.cards[t].controllerId, P2);
});

clause(ALM, "1:rule", "otherwise: the opponent may decline, then nobody gets tokens", () => {
  const g = almBoard({ extra: [other("x1", "Alpha"), other("x2", "Beta"), bait()] });
  play(g.engine, P2, g.id("x1"));
  play(g.engine, P2, g.id("x2"));
  almOnBait(g);
  almFinish(g, { oppAccepts: false });
  assert.equal(named(g, P2, "Micromajig").length, 0);
  assert.equal(named(g, P1, "Micromajig").length, 0);
});

clause(ALM, "1:rule", "only one card played by the opponent this turn is not 'at least 2 with the same name': the 'otherwise' branch applies", () => {
  const g = almBoard({ extra: [bait()] });
  almOnBait(g);
  almFinish(g, { oppAccepts: true, tokens: 2 });
  assert.equal(named(g, P2, "Micromajig").length, 3, "the opponent is the one offered tokens");
  assert.equal(named(g, P1, "Micromajig").length, 0);
});

clause(ALM, "1:rule", "the two same-name cards must be the OPPONENT's: two same-name cards played by me do not count", () => {
  const g = almBoard({
    active: P1,
    elitism: 4,
    extra: [
      { key: "m1", def: character({ name: "Twin", cost: 0 }), owner: P1, zone: "hand" },
      { key: "m2", def: character({ name: "Twin", cost: 0 }), owner: P1, zone: "hand" },
      { key: "mine", def: drawTactic("Mine", 0), owner: P1, zone: "hand" },
      { key: "theirs", def: drawTactic("Theirs", 0), owner: P2, zone: "hand" }
    ]
  });
  play(g.engine, P1, g.id("m1"));
  play(g.engine, P1, g.id("m2"));
  castRaw(g.engine, P1, g.id("mine"));
  castRaw(g.engine, P2, g.id("theirs"));
  castRaw(g.engine, P1, g.id("alm"));
  almFinish(g, { oppAccepts: true, tokens: 2 });
  assert.equal(named(g, P1, "Micromajig").length, 0, "I get no tokens");
  assert.equal(named(g, P2, "Micromajig").length, 3, "the opponent (who played only one card) is offered 3");
});

clause(ALM, "0:rule", "deploying from hand costs 2 and needs [E][E]: refused with one resource, refused with only one [E] among plenty of resources, fine with [E][E]", () => {
  const short = almBoard({ active: P1, elitism: 1 });
  refused(() => castRaw(short.engine, P1, short.id("alm")), "1 resource for cost 2");
  assert.equal(zoneOf(short.engine, short.id("alm")), "hand");
  assert.equal(ready(short.engine), 1);

  const oneE = almBoard({ active: P1, elitism: 1, rage: 5 });
  refused(() => castRaw(oneE.engine, P1, oneE.id("alm")), "one [E] for threshold ee");
  assert.equal(zoneOf(oneE.engine, oneE.id("alm")), "hand");
  assert.equal(ready(oneE.engine), 6);

  const ok = almBoard({ active: P1, elitism: 2, rage: 1 });
  castRaw(ok.engine, P1, ok.id("alm"));
  almFinish(ok, { oppAccepts: false });
  assert.equal(zoneOf(ok.engine, ok.id("alm")), "discard", "control: [E][E] plus one other resource");
  assert.equal(ready(ok.engine), 1, "exactly 2 paid");
});

clause(ALM, "2:flipUp", "FLIP UP costs 2 [E][E]: with exactly [E][E] plus the face-down card it flips up, terminates what is unresolved and the Alarm resolves", () => {
  const g = almBoard({ alarm: "faceDown", active: P1, elitism: 2 });
  assert.equal(ready(g.engine), 3);
  flipUpRaw(g.engine, P1, g.id("alm"));
  almFinish(g, { oppAccepts: false });
  assert.equal(zoneOf(g.engine, g.id("alm")), "discard", "the flipped-up tactic resolved");
  assert.ok(ready(g.engine) <= 1, "2 resources were paid");
});

clause(ALM, "2:flipUp", "FLIP UP is refused with only one [E] (plenty of other resources) and one resource short", () => {
  const oneE = almBoard({ alarm: "faceDown", active: P1, elitism: 1, rage: 5 });
  refused(() => flipUpRaw(oneE.engine, P1, oneE.id("alm")), "one [E] for [E][E]");
  assert.equal(oneE.engine.state.cards[oneE.id("alm")].faceDown, true);
  assert.equal(ready(oneE.engine), 7, "nothing was paid");

  const short = almBoard({ alarm: "faceDown", active: P1, elitism: 0, spentElitism: 2 });
  assert.equal(ready(short.engine), 1, "only the face-down card is ready");
  refused(() => flipUpRaw(short.engine, P1, short.id("alm")), "1 ready resource for a FLIP UP cost of 2");
  assert.equal(short.engine.state.cards[short.id("alm")].faceDown, true);

  const ok = almBoard({ alarm: "faceDown", active: P1, elitism: 1, spentElitism: 1 });
  flipUpRaw(ok.engine, P1, ok.id("alm"));
  almFinish(ok, { oppAccepts: false });
  assert.equal(zoneOf(ok.engine, ok.id("alm")), "discard", "control: spent [E] still meets the threshold, one ready [E] plus the card pays 2");
});

clause(ALM, "2:flipUp", "and you may play a resource: a card from my hand enters play as a resource (a non-resource card goes face-down)", () => {
  const g = almBoard({
    alarm: "faceDown",
    active: P1,
    elitism: 2,
    extra: [
      { key: "junk", def: character({ name: "Junk", cost: 5 }), owner: P1, zone: "hand" },
      { key: "keep", def: character({ name: "Keep", cost: 5 }), owner: P1, zone: "hand" }
    ]
  });
  const before = ready(g.engine);
  flipUpRaw(g.engine, P1, g.id("alm"));
  almFinish(g, { resource: "junk", oppAccepts: false });
  assert.equal(zoneOf(g.engine, g.id("junk")), "play", "the chosen card entered play");
  assert.equal(g.engine.state.cards[g.id("junk")].faceDown, true, "a character can only be played face-down");
  assert.ok(g.engine.isResource(g.id("junk")), "as a resource");
  assert.equal(zoneOf(g.engine, g.id("keep")), "hand", "only the one card");
  assert.ok(ready(g.engine) >= before - 3 + 1, "the new resource is ready");
});

clause(ALM, "2:flipUp", "and you may play a resource: a real resource card from my hand may be played too", () => {
  const g = almBoard({
    alarm: "faceDown",
    active: P1,
    elitism: 2,
    extra: [{ key: "gem", def: resourceCard({ name: "Spare Gem" }), owner: P1, zone: "hand" }]
  });
  flipUpRaw(g.engine, P1, g.id("alm"));
  almFinish(g, { resource: "gem", oppAccepts: false });
  assert.equal(zoneOf(g.engine, g.id("gem")), "play");
  assert.ok(g.engine.isResource(g.id("gem")), "g.engine.isResource(g.id(\"gem\"))");
});

clause(ALM, "2:flipUp", "the resource is ONE card from MY hand: two cards, the opponent's hand card and a card in my discard pile are all refused", () => {
  const g = almBoard({
    alarm: "faceDown",
    active: P1,
    elitism: 2,
    extra: [
      { key: "j1", def: character({ name: "Junk1", cost: 5 }), owner: P1, zone: "hand" },
      { key: "j2", def: character({ name: "Junk2", cost: 5 }), owner: P1, zone: "hand" },
      { key: "theirs", def: character({ name: "Theirs", cost: 5 }), owner: P2, zone: "hand" },
      { key: "bin", def: character({ name: "Bin", cost: 5 }), owner: P1, zone: "discard" }
    ]
  });
  flipUpRaw(g.engine, P1, g.id("alm"));
  resolvePendingResponses(g.engine);
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  const choose = (...keys: string[]): void =>
    g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsTarget", selected: keys.map((k) => g.id(k)) } } as never);
  refused(() => choose("j1", "j2"), "two resources");
  refused(() => choose("theirs"), "the opponent's hand card");
  refused(() => choose("bin"), "a card in my discard pile");
  assert.equal(zoneOf(g.engine, g.id("j1")), "hand");
  choose("j1");
  almFinish(g, { oppAccepts: false });
  assert.equal(zoneOf(g.engine, g.id("j1")), "play", "control: one card from my hand");
  assert.equal(zoneOf(g.engine, g.id("j2")), "hand");
  assert.equal(zoneOf(g.engine, g.id("theirs")), "hand");
});

clause(ALM, "2:flipUp", "'you may' play a resource: I can decline and my hand stays as it was", () => {
  const g = almBoard({
    alarm: "faceDown",
    active: P1,
    elitism: 2,
    extra: [{ key: "junk", def: character({ name: "Junk", cost: 5 }), owner: P1, zone: "hand" }]
  });
  seen.length = 0;
  flipUpRaw(g.engine, P1, g.id("alm"));
  almFinish(g, { oppAccepts: false });
  assert.equal(zoneOf(g.engine, g.id("junk")), "hand");
  assert.ok(seen.some((s) => s.startsWith("chooserSelectsTarget")), `the resource prompt was offered, saw ${seen.join(", ")}`);
});

clause(ALM, "2:flipUp", "the resource play is part of FLIP UP only: playing the Alarm from hand offers no resource play", () => {
  const g = almBoard({
    active: P1,
    elitism: 2,
    extra: [{ key: "junk", def: character({ name: "Junk", cost: 5 }), owner: P1, zone: "hand" }]
  });
  seen.length = 0;
  play(g.engine, P1, g.id("alm"));
  almFinish(g, { resource: "junk", oppAccepts: false });
  assert.equal(zoneOf(g.engine, g.id("junk")), "hand", "nothing was played as a resource");
  assert.ok(!seen.some((s) => s.startsWith("chooserSelectsTarget")), `no resource prompt, saw ${seen.join(", ")}`);
});

clause(ALM, "2:flipUp", "flipping it up also runs its normal text: with the opponent having played two same-name cards I get 2 tokens", () => {
  const h = almBoard({
    alarm: "faceDown",
    active: P1,
    elitism: 2,
    extra: [
      { key: "mine1", def: drawTactic("Mine1", 0), owner: P1, zone: "hand" },
      { key: "mine2", def: drawTactic("Mine2", 0), owner: P1, zone: "hand" },
      { key: "tw1", def: drawTactic("Twin", 0), owner: P2, zone: "hand" },
      { key: "tw2", def: drawTactic("Twin", 0), owner: P2, zone: "hand" }
    ]
  });
  castRaw(h.engine, P1, h.id("mine1"));
  castRaw(h.engine, P2, h.id("tw1"));
  resolvePendingResponses(h.engine);
  castRaw(h.engine, P1, h.id("mine2"));
  castRaw(h.engine, P2, h.id("tw2"));
  resolvePendingResponses(h.engine);
  flipUpRaw(h.engine, P1, h.id("alm"));
  almFinish(h, { tokens: 2 });
  assert.equal(named(h, P1, "Micromajig").length, 2);
  assert.equal(named(h, P2, "Micromajig").length, 0);
});

// =====================================================================================
// Merbegon, the Insatiable Taxidermist
// =====================================================================================

const MER = "4172616c-2e3a-480e-b178-1f85e72d8f9e"; // character, cost 5, threshold eeee, str 5 / spd 3 / life 5 -- UNIQUE MERBEGON -- This card can attack even if it has not been in play under your control since the start of the turn. -- If a character enters play under your control, you may destroy that character. If you do, X is that character's strength and Y is that character's life. You may pick a character. If you do, it gains X strength and Y life this turn.

interface MerOpts {
  mer?: "hand" | "play";
  elitism?: number;
  rage?: number;
  active?: PlayerId;
  extra?: CardPlacement[];
}

/** P1 has Merbegon (`mer`), a 1/1 `bm` and a hand character `food` (cost 1, 3/5); P2 has a 2/2 `o1`. */
function merBoard(o: MerOpts = {}) {
  const active = o.active ?? P1;
  return devBoard(
    [
      { key: "mer", def: printing(MER), owner: P1, zone: o.mer ?? "play" },
      { key: "bm", def: character({ name: "BuffMe", strength: 1, life: 1 }), owner: P1, zone: "play" },
      { key: "food", def: character({ name: "Food", cost: 1, strength: 3, life: 5 }), owner: P1, zone: "hand" },
      { key: "o1", def: character({ name: "Theirs", strength: 2, life: 2 }), owner: P2, zone: "play" },
      ...deckCards("d", 3, P1),
      ...deckCards("e", 3, P2),
      ...res({ elitism: o.elitism ?? 10, rage: o.rage ?? 0 }),
      ...res({ rage: 6 }, P2),
      ...(o.extra ?? [])
    ],
    active === P2 ? { turn: 2, activePlayerId: P2 } : {}
  );
}
type MerGame = ReturnType<typeof merBoard>;
interface MerScript {
  /** answer to "may destroy" (default: decline) */
  destroy?: boolean;
  /** key of the character to pick for the buff (default: pick none) */
  pick?: string;
  /** which Unique copy to keep */
  keep?: string;
  log?: string[];
}
const merAnswers = (g: MerGame, s: MerScript = {}) => (pc: PendingChoiceLike): unknown => {
  s.log?.push(pc.kind);
  switch (pc.kind) {
    case "mayPay":
      return { kind: "mayPay", pay: s.destroy ?? false };
    case "chooserSelectsTarget":
      return { kind: "chooserSelectsTarget", selected: s.pick ? [g.id(s.pick)] : [] };
    case "uniqueSurvivor":
      return { kind: "uniqueSurvivor", keep: g.id(s.keep ?? "mer") };
    case "orderTriggers":
      return declineAll(pc);
    default:
      throw new Error(`unexpected pending choice ${pc.kind} for ${pc.playerId}`);
  }
};
const merFinish = (g: MerGame, s: MerScript = {}): void => {
  resolvePendingResponses(g.engine);
  drain(g.engine, merAnswers(g, s));
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined, "everything was answered");
};
const merStats = (g: MerGame, key: string): [number, number] => [g.engine.getStat(g.id(key), "strength"), g.engine.getStat(g.id(key), "life")];

clause(MER, "0:unique", "UNIQUE MERBEGON: with one in play, deploying a second makes me choose which to keep; keeping the original destroys the new one", () => {
  const g = merBoard({ extra: [{ key: "mer2", def: printing(MER), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("mer2"));
  const log: string[] = [];
  merFinish(g, { keep: "mer", log });
  assert.ok(log.includes("uniqueSurvivor"), `asked which to keep (saw ${log.join(", ")})`);
  assert.equal(zoneOf(g.engine, g.id("mer")), "play");
  assert.equal(zoneOf(g.engine, g.id("mer2")), "discard");
});

clause(MER, "0:unique", "UNIQUE MERBEGON: I may keep the new copy instead, and then the original is destroyed", () => {
  const g = merBoard({ extra: [{ key: "mer2", def: printing(MER), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("mer2"));
  merFinish(g, { keep: "mer2" });
  assert.equal(zoneOf(g.engine, g.id("mer2")), "play");
  assert.equal(zoneOf(g.engine, g.id("mer")), "discard");
});

clause(MER, "0:unique", "UNIQUE is per player: the opponent controlling their own Merbegon does not conflict with mine", () => {
  const g = merBoard({ mer: "hand", extra: [{ key: "theirMer", def: printing(MER), owner: P2, zone: "play" }] });
  play(g.engine, P1, g.id("mer"));
  merFinish(g);
  assert.equal(zoneOf(g.engine, g.id("mer")), "play");
  assert.equal(zoneOf(g.engine, g.id("theirMer")), "play");
});

clause(MER, "1:rule", "deploying costs 5 and needs [E][E][E][E]; its stats are 5 strength / 3 speed / 5 life", () => {
  const g = merBoard({ mer: "hand", elitism: 6 });
  play(g.engine, P1, g.id("mer"));
  merFinish(g);
  assert.equal(zoneOf(g.engine, g.id("mer")), "play");
  assert.equal(ready(g.engine), 1, "5 of 6 resources were paid");
  assert.deepEqual([g.engine.getStat(g.id("mer"), "strength"), g.engine.getStat(g.id("mer"), "speed"), g.engine.getStat(g.id("mer"), "life")], [5, 3, 5]);

  const four = merBoard({ mer: "hand", elitism: 4 });
  refused(() => play(four.engine, P1, four.id("mer")), "4 resources for cost 5");
  assert.equal(zoneOf(four.engine, four.id("mer")), "hand");

  const threeE = merBoard({ mer: "hand", elitism: 3, rage: 5 });
  refused(() => play(threeE.engine, P1, threeE.id("mer")), "three [E] for threshold eeee");
  assert.equal(zoneOf(threeE.engine, threeE.id("mer")), "hand");
  assert.equal(ready(threeE.engine), 8);

  const ok = merBoard({ mer: "hand", elitism: 4, rage: 1 });
  play(ok.engine, P1, ok.id("mer"));
  merFinish(ok);
  assert.equal(zoneOf(ok.engine, ok.id("mer")), "play", "control: four [E] plus one other resource");
});

clause(MER, "1:rule", "it can attack the turn it enters play, while an ordinary character that entered this turn cannot", () => {
  const g = merBoard({ mer: "hand", extra: [{ key: "plain", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("mer"));
  merFinish(g);
  play(g.engine, P1, g.id("plain"));
  merFinish(g);
  refused(() => declareAttackBy(g.engine, P1, [g.id("plain")]), "Plain entered this turn and has no AGGRO", /AGGRO|start the turn/);
  refused(() => declareAttackBy(g.engine, P1, [g.id("mer"), g.id("plain")]), "Plain cannot join the attack", /AGGRO|start the turn/);
  assert.equal(battleOf(g.engine), undefined);
  declareAttackBy(g.engine, P1, [g.id("mer")]);
  assert.ok(battleOf(g.engine), "Merbegon attacks the turn it entered");
  assert.equal(g.engine.state.cards[g.id("mer")].depleted, true);
});

clause(MER, "1:rule", "an ordinary character already in play from before the turn can attack alongside it", () => {
  const g = merBoard({ mer: "hand" });
  play(g.engine, P1, g.id("mer"));
  merFinish(g);
  declareAttackBy(g.engine, P1, [g.id("mer"), g.id("bm")]);
  assert.ok(battleOf(g.engine), "Merbegon and the veteran BuffMe attack together");
});

clause(MER, "2:rule", "a character entering under my control: I may destroy it, X = its strength and Y = its life, and the character I pick gains +X/+Y", () => {
  const g = merBoard();
  assert.deepEqual(merStats(g, "bm"), [1, 1]);
  play(g.engine, P1, g.id("food"));
  const log: string[] = [];
  merFinish(g, { destroy: true, pick: "bm", log });
  assert.ok(log.includes("mayPay"), `offered the may-destroy (saw ${log.join(", ")})`);
  assert.equal(zoneOf(g.engine, g.id("food")), "discard", "the entering character was destroyed");
  assert.deepEqual(merStats(g, "bm"), [4, 6], "BuffMe 1/1 gained 3 strength and 5 life");
  assert.deepEqual(merStats(g, "mer"), [5, 5], "Merbegon itself is unchanged");
});

clause(MER, "2:rule", "X and Y come from the destroyed character: a 1 strength / 2 life entrant gives +1/+2 (picked from the opponent's side)", () => {
  const g = merBoard({ extra: [{ key: "snack", def: character({ name: "Snack", cost: 0, strength: 1, life: 2 }), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("snack"));
  merFinish(g, { destroy: true, pick: "o1" });
  assert.equal(zoneOf(g.engine, g.id("snack")), "discard");
  assert.deepEqual(merStats(g, "o1"), [3, 4], "the opponent's 2/2 gained +1/+2: any character may be picked");
  assert.deepEqual(merStats(g, "bm"), [1, 1]);
});

clause(MER, "2:rule", "the pick must be a character in play: an item of mine, a character in a discard pile and a character in my hand are refused", () => {
  const g = merBoard({
    extra: [
      { key: "gadget", def: item({ name: "Gadget", cost: 0 }), owner: P1, zone: "play" },
      { key: "bin", def: character({ name: "Bin" }), owner: P2, zone: "discard" },
      { key: "spare", def: character({ name: "Spare" }), owner: P1, zone: "hand" }
    ]
  });
  play(g.engine, P1, g.id("food"));
  const may = expectPending(g.engine, "mayPay");
  g.engine.perform({ type: "resolvePendingChoice", playerId: may.playerId, choice: { kind: "mayPay", pay: true } } as never);
  resolvePendingResponses(g.engine);
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  const choose = (key: string): void =>
    g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsTarget", selected: [g.id(key)] } } as never);
  refused(() => choose("gadget"), "an item is not a character");
  refused(() => choose("bin"), "a character in a discard pile");
  refused(() => choose("spare"), "a character in my hand");
  choose("bm");
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(merStats(g, "bm"), [4, 6], "control: a character in play can be picked");
});

clause(MER, "2:rule", "the pick may be Merbegon itself", () => {
  const g = merBoard();
  play(g.engine, P1, g.id("food"));
  merFinish(g, { destroy: true, pick: "mer" });
  assert.deepEqual(merStats(g, "mer"), [8, 10]);
  assert.deepEqual(merStats(g, "bm"), [1, 1]);
});

clause(MER, "2:rule", "'may destroy': declining leaves the character in play, no one is buffed and nothing more is asked", () => {
  const g = merBoard();
  play(g.engine, P1, g.id("food"));
  const log: string[] = [];
  merFinish(g, { destroy: false, pick: "bm", log });
  assert.equal(zoneOf(g.engine, g.id("food")), "play", "the character stays");
  assert.deepEqual(merStats(g, "bm"), [1, 1]);
  assert.deepEqual(log, ["mayPay"], "only the may-destroy question was asked");
});

clause(MER, "2:rule", "'you may pick a character': after destroying I can pick no one and nobody gains anything", () => {
  const g = merBoard();
  play(g.engine, P1, g.id("food"));
  merFinish(g, { destroy: true });
  assert.equal(zoneOf(g.engine, g.id("food")), "discard");
  assert.deepEqual(merStats(g, "bm"), [1, 1]);
  assert.deepEqual(merStats(g, "o1"), [2, 2]);
  assert.deepEqual(merStats(g, "mer"), [5, 5]);
});

clause(MER, "2:rule", "'this turn': the gained strength and life are gone after the turn ends", () => {
  const g = merBoard();
  play(g.engine, P1, g.id("food"));
  merFinish(g, { destroy: true, pick: "bm" });
  assert.deepEqual(merStats(g, "bm"), [4, 6]);
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.deepEqual(merStats(g, "bm"), [1, 1], "back to 1/1");
});

clause(MER, "2:rule", "a token character entering under my control counts: I may destroy it and buff a character by its stats", () => {
  const maker = tactic({
    name: "Blip Maker",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "mk",
          type: "activated",
          effects: [{ type: "createTokens", controller: "controller", count: 1, token: { name: "Blip", cardType: "character", subtype: [], strength: 2, life: 3, speed: 1 } }]
        }
      ]
    }
  });
  const g = merBoard({ extra: [{ key: "maker", def: maker, owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("maker"));
  merFinish(g, { destroy: true, pick: "bm" });
  assert.equal(g.engine.state.players[P1].play.filter((c) => g.engine.getDefinition(c).name === "Blip").length, 0, "the token was destroyed");
  assert.deepEqual(merStats(g, "bm"), [3, 4], "BuffMe gained the token's 2 strength and 3 life");
});

clause(MER, "2:rule", "only characters trigger it: an item entering under my control asks nothing and stays in play", () => {
  const g = merBoard({ extra: [{ key: "gadget", def: item({ name: "Gadget", cost: 0 }), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("gadget"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("gadget")), "play");
});

clause(MER, "2:rule", "only characters trigger it: a tactic played under my control asks nothing", () => {
  const g = merBoard({ extra: [{ key: "spell", def: tactic({ name: "Spell", cost: 0 }), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("spell"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("spell")), "discard");
});

clause(MER, "2:rule", "only under MY control: a character entering under the opponent's control asks nothing", () => {
  const g = merBoard({ active: P2, extra: [{ key: "theirs2", def: character({ name: "Newcomer", cost: 0, strength: 2, life: 2 }), owner: P2, zone: "hand" }] });
  play(g.engine, P2, g.id("theirs2"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("theirs2")), "play");
});

clause(MER, "2:rule", "'a character': Merbegon's own entry does not trigger it (user ruling 2026-10-27): it must already be in play when a character enters", () => {
  const g = merBoard({ mer: "hand" });
  play(g.engine, P1, g.id("mer"));
  assert.equal(g.engine.state.pendingChoice, undefined, "Merbegon's own entry offers no may-destroy");
  assert.equal(zoneOf(g.engine, g.id("mer")), "play");
  assert.deepEqual(merStats(g, "bm"), [1, 1]);
});

// =====================================================================================
// Notion Sickness
// =====================================================================================

const NOT = "4e50b7ed-2a4e-4bd7-aac3-fbc97b2574c7"; // tactic, cost 3, threshold ee -- COST: Pick a card you control with an ability in its rules text. -- EFFECT: You may use one of the card's abilities. If you do, the effect happens twice instead of once. Destroy the card.

interface NotOpts {
  elitism?: number;
  rage?: number;
  extra?: CardPlacement[];
  /** my faction (default: the plain develop faction) */
  faction?: CardDefinition;
}

/** P1 holds Notion Sickness; P1 has a Drawer (`drawer`, ability draw1) and a vanilla `plain`; P2 has its own Drawer `oppDrawer`. */
function notBoard(o: NotOpts = {}) {
  return devBoard(
    [
    { key: "ns", def: printing(NOT), owner: P1, zone: "hand" },
    { key: "drawer", def: drawerChar(), owner: P1, zone: "play" },
    { key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "play" },
    { key: "oppDrawer", def: drawerChar({ name: "OppDrawer" }), owner: P2, zone: "play" },
    { key: "victim", def: character({ name: "Victim", strength: 1, life: 5 }), owner: P2, zone: "play" },
    ...deckCards("d", 6, P1),
    ...deckCards("e", 3, P2),
    ...res({ elitism: o.elitism ?? 6, rage: o.rage ?? 0 }),
    ...(o.extra ?? [])
    ],
    o.faction ? { playerA: { faction: o.faction } } : {}
  );
}
type NotGame = ReturnType<typeof notBoard>;
interface NotScript {
  /** ability to use; "none" declines (default: none) */
  use?: string;
  /** key (to be mapped to ids) of the picks for a targeted ability, per declaration */
  selected?: Record<string, string[]>;
  log?: string[];
}
const notAnswers = (g: NotGame, s: NotScript = {}) => (pc: PendingChoiceLike): unknown => {
  s.log?.push(pc.kind);
  if (pc.kind === "useTargetAbility") {
    if (!s.use) return { kind: "useTargetAbility" };
    const selected: Record<string, CardInstanceId[]> = {};
    for (const [decl, keys] of Object.entries(s.selected ?? {})) selected[decl] = keys.map((k) => g.id(k));
    return { kind: "useTargetAbility", abilityId: s.use, selected };
  }
  throw new Error(`unexpected pending choice ${pc.kind} for ${pc.playerId}`);
};
const notPlay = (g: NotGame, pick: string, s: NotScript = {}): void => {
  play(g.engine, P1, g.id("ns"), { selected: { pick: [g.id(pick)] } });
  drain(g.engine, notAnswers(g, s));
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined, "everything was answered");
};

clause(NOT, "0:ability", "pick my Drawer and use its 'draw a card' ability: the effect happens twice (two cards), the Drawer is destroyed, Notion Sickness is spent for exactly 3", () => {
  const g = notBoard();
  const top2 = deckOf(g.engine, P1).slice(0, 2);
  assert.deepEqual(handOf(g.engine, P1), [g.id("ns")]);
  notPlay(g, "drawer", { use: "draw1" });
  assert.deepEqual(handOf(g.engine, P1), top2, "drew exactly two cards, the top two");
  assert.equal(zoneOf(g.engine, g.id("drawer")), "discard", "the picked card was destroyed");
  assert.equal(zoneOf(g.engine, g.id("ns")), "discard");
  assert.equal(ready(g.engine), 3, "the numeric cost 3 was paid");
  assert.equal(zoneOf(g.engine, g.id("plain")), "play", "other cards are untouched");
});

clause(NOT, "0:ability", "'you may use': declining draws nothing, but the picked card is still destroyed", () => {
  const g = notBoard();
  const log: string[] = [];
  notPlay(g, "drawer", { log });
  assert.ok(log.includes("useTargetAbility"), `offered the use (saw ${log.join(", ")})`);
  assert.deepEqual(handOf(g.engine, P1), [], "no card drawn");
  assert.equal(zoneOf(g.engine, g.id("drawer")), "discard", "'Destroy the card' is not conditional on using an ability");
  assert.equal(zoneOf(g.engine, g.id("ns")), "discard");
});

clause(NOT, "0:ability", "'one of the card's abilities': with two abilities I choose which one is used twice, and only that one", () => {
  const twoAbilities = character({
    name: "Swiss",
    behavior: {
      abilities: [
        { id: "draw1", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] },
        {
          id: "mk",
          type: "activated",
          costs: [],
          effects: [{ type: "createTokens", controller: "controller", count: 1, token: { name: "Blip", cardType: "character", subtype: [], strength: 1, life: 1, speed: 1 } }]
        }
      ]
    }
  });
  const blips = (g: NotGame): number => g.engine.state.players[P1].play.filter((c) => g.engine.getDefinition(c).name === "Blip").length;

  const tokens = notBoard({ extra: [{ key: "swiss", def: twoAbilities, owner: P1, zone: "play" }] });
  notPlay(tokens, "swiss", { use: "mk" });
  assert.equal(blips(tokens), 2, "the token ability happened twice");
  assert.deepEqual(handOf(tokens.engine, P1), [], "the draw ability was not used");
  assert.equal(zoneOf(tokens.engine, tokens.id("swiss")), "discard");

  const cards = notBoard({ extra: [{ key: "swiss", def: twoAbilities, owner: P1, zone: "play" }] });
  notPlay(cards, "swiss", { use: "draw1" });
  assert.equal(handOf(cards.engine, P1).length, 2, "the draw ability happened twice");
  assert.equal(blips(cards), 0, "the token ability was not used");
});

clause(NOT, "0:ability", "the ability's own cost is paid once, only its effect happens twice", () => {
  const payer = character({
    name: "Payer",
    behavior: { abilities: [{ id: "pay1", type: "activated", costs: [{ type: "payResources", amount: 1 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const g = notBoard({ elitism: 4, extra: [{ key: "payer", def: payer, owner: P1, zone: "play" }] });
  assert.equal(ready(g.engine), 4);
  notPlay(g, "payer", { use: "pay1" });
  assert.equal(handOf(g.engine, P1).length, 2, "two cards drawn");
  assert.equal(ready(g.engine), 0, "3 for Notion Sickness plus the ability's pay 1, once");
  assert.equal(zoneOf(g.engine, g.id("payer")), "discard");
});

clause(NOT, "0:ability", "a targeted ability is used twice on the chosen target", () => {
  const pinger = character({
    name: "Pinger",
    behavior: {
      abilities: [
        {
          id: "ping",
          type: "activated",
          costs: [],
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }]
        }
      ]
    }
  });
  const g = notBoard({ extra: [{ key: "pinger", def: pinger, owner: P1, zone: "play" }] });
  notPlay(g, "pinger", { use: "ping", selected: { t: ["victim"] } });
  assert.equal(g.engine.state.cards[g.id("victim")].damage, 2, "1 damage twice");
  assert.equal(zoneOf(g.engine, g.id("pinger")), "discard");
});

clause(NOT, "0:ability", "the card picked may be an item with an ability, not just a character", () => {
  const gizmo = item({
    name: "Gizmo",
    behavior: { abilities: [{ id: "draw1", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const g = notBoard({ extra: [{ key: "gizmo", def: gizmo, owner: P1, zone: "play" }] });
  notPlay(g, "gizmo", { use: "draw1" });
  assert.equal(handOf(g.engine, P1).length, 2);
  assert.equal(zoneOf(g.engine, g.id("gizmo")), "discard");
});

clause(NOT, "0:ability", "the picked card must be mine, in play, and have an ability: the opponent's Drawer, a vanilla card of mine and a Drawer in my hand are refused", () => {
  const cases: Array<[string, CardPlacement[]]> = [
    ["oppDrawer", []],
    ["plain", []],
    ["handDrawer", [{ key: "handDrawer", def: drawerChar({ name: "HandDrawer" }), owner: P1, zone: "hand" }]]
  ];
  for (const [pick, extra] of cases) {
    const g = notBoard({ extra });
    refused(() => play(g.engine, P1, g.id("ns"), { selected: { pick: [g.id(pick)] } }), `picking ${pick}`);
    assert.equal(zoneOf(g.engine, g.id("ns")), "hand", `${pick}: the refused play left Notion Sickness in hand`);
    assert.equal(ready(g.engine), 6, `${pick}: nothing was paid`);
    assert.equal(zoneOf(g.engine, g.id(pick)), pick === "handDrawer" ? "hand" : "play", `${pick}: untouched`);
  }
  const ok = notBoard();
  notPlay(ok, "drawer", { use: "draw1" });
  assert.equal(zoneOf(ok.engine, ok.id("ns")), "discard", "control: my Drawer is a legal pick");
});

clause(NOT, "0:ability", "a pick is required: playing it with no card picked is refused", () => {
  const g = notBoard();
  refused(() => play(g.engine, P1, g.id("ns"), { selected: { pick: [] } }), "no pick");
  assert.equal(zoneOf(g.engine, g.id("ns")), "hand");
  assert.equal(ready(g.engine), 6);
});

clause(NOT, "0:ability", "costs 3 numeric and needs [E][E]: refused with 2 resources, refused with only one [E]", () => {
  const short = notBoard({ elitism: 2 });
  refused(() => play(short.engine, P1, short.id("ns"), { selected: { pick: [short.id("drawer")] } }), "2 resources for cost 3");
  assert.equal(zoneOf(short.engine, short.id("ns")), "hand");
  assert.equal(zoneOf(short.engine, short.id("drawer")), "play");

  const oneE = notBoard({ elitism: 1, rage: 5 });
  refused(() => play(oneE.engine, P1, oneE.id("ns"), { selected: { pick: [oneE.id("drawer")] } }), "one [E] for threshold ee");
  assert.equal(zoneOf(oneE.engine, oneE.id("ns")), "hand");
  assert.equal(ready(oneE.engine), 6);

  const ok = notBoard({ elitism: 2, rage: 1 });
  notPlay(ok, "drawer", { use: "draw1" });
  assert.equal(zoneOf(ok.engine, ok.id("ns")), "discard", "control: [E][E] plus one other resource");
});

clause(NOT, "0:ability", "'an ability' is an activated ability (rules answer Q33): a card of mine with only a triggered ability is not a legal pick, and nothing happens", () => {
  const watcher = item({
    name: "Watcher",
    behavior: { abilities: [{ id: "w", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const g = notBoard({ extra: [{ key: "watcher", def: watcher, owner: P1, zone: "play" }] });
  refused(() => play(g.engine, P1, g.id("ns"), { selected: { pick: [g.id("watcher")] } }), "picking a card with only a triggered ability");
  assert.equal(g.engine.state.pendingChoice, undefined, "nothing is pending");
  assert.equal(zoneOf(g.engine, g.id("ns")), "hand", "Notion Sickness was not played");
  assert.equal(zoneOf(g.engine, g.id("watcher")), "play", "the triggered-only card is untouched");
  assert.equal(ready(g.engine), 6, "no resources were spent");
  assert.deepEqual(handOf(g.engine, P1), [g.id("ns")], "nothing was drawn");
});

clause(NOT, "0:ability", "a faction cannot be picked even if it has an ability (CR 202.9: factions are only picked when an effect names them)", () => {
  const withAbility = developFaction({
    behavior: { abilities: [{ id: "fdraw", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const g = notBoard({ faction: withAbility });
  refused(() => play(g.engine, P1, g.id("ns"), { selected: { pick: [factionOf(g.engine, P1)] } }), "picking my faction");
  assert.equal(zoneOf(g.engine, g.id("ns")), "hand");
  assert.equal(ready(g.engine), 6);
  assert.deepEqual(handOf(g.engine, P1), [g.id("ns")]);
});

clause(NOT, "0:ability", "if the picked card is destroyed in response, Notion Sickness resolves without using any ability (nothing is drawn) and nothing gets stuck", () => {
  const g = notBoard({ extra: [{ key: "zap", def: killTactic(), owner: P2, zone: "hand" }, ...res({ rage: 1 }, P2)] });
  castRaw(g.engine, P1, g.id("ns"), { pick: [g.id("drawer")] });
  castRaw(g.engine, P2, g.id("zap"), { t: [g.id("drawer")] });
  resolvePendingResponses(g.engine);
  drain(g.engine, notAnswers(g, { use: "draw1" }));
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("drawer")), "discard", "destroyed by the response");
  assert.equal(zoneOf(g.engine, g.id("ns")), "discard", "Notion Sickness still resolved");
  assert.deepEqual(handOf(g.engine, P1), [], "a card that left play has no ability to use");
});

clause(MER, "2:rule", "Merbegon must be in play: with it still in my hand a character entering asks nothing", () => {
  const g = merBoard({ mer: "hand" });
  play(g.engine, P1, g.id("food"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("food")), "play");
  assert.equal(zoneOf(g.engine, g.id("mer")), "hand");
});

clause(RAY, "1:rule", "only the NUMERIC cost is reduced: the threshold is still required", () => {
  const guy = character({ name: "RageGuy", cost: 4, threshold: "rr" });
  const noRage = rayBoard({ ray: "play", elitism: 2, extra: [{ key: "guy", def: guy, owner: P1, zone: "hand" }] });
  refused(() => play(noRage.engine, P1, noRage.id("guy")), "two resources but no [R] for threshold rr");
  assert.equal(zoneOf(noRage.engine, noRage.id("guy")), "hand");
  const rage = rayBoard({ ray: "play", elitism: 0, rage: 2, extra: [{ key: "guy", def: guy, owner: P1, zone: "hand" }] });
  play(rage.engine, P1, rage.id("guy"));
  assert.equal(zoneOf(rage.engine, rage.id("guy")), "play", "control: two [R] pay the reduced cost 2 and meet the threshold");
});

clause(ALM, "2:flipUp", "flipping it up in response to the opponent's card terminates that card too, and I may still play a resource", () => {
  const g = almBoard({
    alarm: "faceDown",
    elitism: 2,
    extra: [bait(), { key: "junk", def: character({ name: "Junk", cost: 5 }), owner: P1, zone: "hand" }]
  });
  castRaw(g.engine, P2, g.id("bait"));
  flipUpRaw(g.engine, P1, g.id("alm"));
  almFinish(g, { resource: "junk", oppAccepts: false });
  assert.equal(zoneOf(g.engine, g.id("bait")), "discard", "the unresolved bait was terminated");
  assert.equal(handOf(g.engine, P2).length, 0, "and drew nothing");
  assert.equal(zoneOf(g.engine, g.id("junk")), "play", "the resource was played");
  assert.equal(zoneOf(g.engine, g.id("alm")), "discard");
});
