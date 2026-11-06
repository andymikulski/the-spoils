// Clause tests — batch 1st-edition-part-2-05 (1st Edition Part 2 rogue cards,
// Cheats McGuillicutty to Unexpected Boobysnake). See docs/TESTING.md and
// `npm run card-tests -- manifest 1st-edition-part-2-05`. Expectations come from
// each card's PRINTED text (markup) and RULES.md / the Comprehensive Rules; engine
// data (ability ids, declaration ids, choice kinds) is only used to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame as harnessBuildGame,
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
import { clause, declineAll, drain, printing, refused } from "./_clause.js";
import { battleOf, declareAttackBy, fight, playRaw } from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, zoneOf } from "./_board.js";
import { endTurn, factionOf, developPlay } from "./_turn.js";
import type { CardDefinition, CardInstanceId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";
import { developDraw } from "../support/develop.js";

// --- file-local helpers -------------------------------------------------------

/** A small deterministic PRNG (mulberry32): every board gets its own fixed stream, so no outcome depends on an unseeded random. */
function seededRandom(seed = 20261016): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `buildGame` with a seeded random source unless a test passes its own (coin flips, shuffles and random picks are all fixed). */
const buildGame: typeof harnessBuildGame = (options = {}) => harnessBuildGame({ ...options, random: options.random ?? seededRandom() });

type Pid = typeof P1 | typeof P2;

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: Pid = P1) => engine.getAvailableResourceCount(player);
const influence = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].influence;
const handOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].hand;
const deckOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].deck;
const discardOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].discard;
const isDepleted = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].depleted;
const controllerOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].controllerId;
const keywordsOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.getKeywords(cardId) as string[];
const hasKeyword = (engine: SpoilsEngine, cardId: CardInstanceId, keyword: string) => keywordsOf(engine, cardId).includes(keyword);
const stats = (engine: SpoilsEngine, cardId: CardInstanceId) => [engine.getStat(cardId, "strength"), engine.getStat(cardId, "life"), engine.getStat(cardId, "speed")];

/** A seeded RNG that always wins a coin flip (`random() < 0.5`) / always loses it. */
const WIN = () => 0.1;
const LOSE = () => 0.9;

/** The coin flips the log has recorded so far. */
const coinFlips = (engine: SpoilsEngine) =>
  engine
    .getLog()
    .filter((entry) => entry.event?.type === "coinFlipped")
    .map((entry) => {
      const ev = entry.event as unknown as { playerId: string; won: boolean };
      return { playerId: ev.playerId, won: ev.won };
    });

/** Raw `activateAbility` WITHOUT draining the response window. */
function activateRaw(engine: SpoilsEngine, player: Pid, cardId: CardInstanceId, abilityId: string, selected: Record<string, CardInstanceId[]> = {}, variables: Record<string, number> = {}) {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected, variables } as never);
}

/** P2 (the active player) attacks P1's faction with `attackerId` and passes: P1 now holds priority in the battle's response window. */
function openDefenderWindow(engine: SpoilsEngine, attackerId: CardInstanceId): void {
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [attackerId], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
}

/** A free tactic that draws a card (id `d`), for "play the top card" style checks. */
const freeDrawTactic = (name = "FreeDraw"): CardDefinition =>
  tactic({ name, cost: 0, behavior: { abilities: [{ id: "d", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });

/** A free character-killing tactic (id `k`, declaration `t`). */
const killTactic = (): CardDefinition =>
  tactic({
    name: "Kill",
    cost: 0,
    behavior: {
      abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
    }
  });

/**
 * The deploy-cost checks every printed card has: it needs its numeric cost (one
 * short is refused), its threshold (enough resources of the wrong icon is
 * refused) and it pays exactly the printed cost. `make` builds a board with the
 * printing in P1's hand (key `me`) and the given resources.
 */
function deployChecks(
  make: (res: { deception: number; greed: number }) => { engine: SpoilsEngine; id: (key: string) => CardInstanceId },
  cost: number,
  thresholdIcons: number,
  selected: (id: (key: string) => CardInstanceId) => Record<string, CardInstanceId[]> = () => ({})
) {
  if (cost > 0 && cost - 1 >= thresholdIcons) {
    const short = make({ deception: cost - 1, greed: 0 });
    refused(() => playRaw(short.engine, P1, short.id("me"), { selected: selected(short.id) }), `one resource short of ${cost}`);
    assert.equal(zoneOf(short.engine, short.id("me")), "hand", "nothing was played");
  }
  const noIcons = make({ deception: thresholdIcons - 1, greed: cost + 4 });
  refused(() => playRaw(noIcons.engine, P1, noIcons.id("me"), { selected: selected(noIcons.id) }), `${thresholdIcons - 1} Deception icons is below the threshold even with ${cost + 4} Greed`);
  assert.equal(zoneOf(noIcons.engine, noIcons.id("me")), "hand");

  const total = Math.max(cost, thresholdIcons);
  const exact = make({ deception: total, greed: 0 });
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("me"), { selected: selected(exact.id) });
  assert.equal(before - ready(exact.engine), cost, `exactly ${cost} is paid`);
  assert.equal(ready(exact.engine), total - cost);
  return exact;
}

/** The fillers for a deck: `n` plain characters, top first. */
const deckOfFillers = (prefix: string, n: number, owner: Pid) => fillers(prefix, n, owner, "deck");

// --- Cheats McGuillicutty ----------------------------------------------------
// UNIQUE PLUCK -- The top card of your deck is revealed at all times. --
// BOTTOM DEAL -- COST: Pay 1. EFFECT: Put the top card of your deck on the bottom. --
// CHEAT -- COST: Deplete this card. EFFECT: You may look at and play the top card of
// your deck. -- CHANGE COSTUME -- COST: Pay 3. Shuffle this card into its owner's
// deck. EFFECT: Search your deck for a "pluck" card with a different name than this
// card and put it into play.
// Character, rogue, subtype pluck / grifter, cost 6, threshold [D][D], 2/1/3.

const CHEATS = "0af6286e-db1d-44c2-9e23-38ccc3f558e9";
const PLUCK_CARD = "f4ccc8f6-f59d-47f3-8972-48d83770de94"; // Pluck (1st Edition): UNIQUE PLUCK, subtype pluck

interface CheatsOpts {
  deception?: number;
  greed?: number;
  depleted?: boolean;
  deck?: CardPlacement[];
  oppDeck?: number;
  random?: () => number;
  turn?: number;
  active?: Pid;
  extra?: CardPlacement[];
  cheatsOwner?: Pid;
  cheatsController?: Pid;
  cheatsZone?: "play" | "hand";
}

/** Cheats in play for P1 (key `cm`), `deception` Deception resources, a 5-card deck (m0 on top) and a 4-card opposing deck (o0 on top). */
function cheatsBoard(opts: CheatsOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: opts.random,
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "cm", def: printing(CHEATS), owner: opts.cheatsOwner ?? P1, controller: opts.cheatsController, zone: opts.cheatsZone ?? "play", depleted: opts.depleted },
      ...bank("deception", opts.deception ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.deck ?? deckOfFillers("m", 5, P1)),
      ...deckOfFillers("o", opts.oppDeck ?? 4, P2),
      ...(opts.extra ?? [])
    ]
  });
}

const cheatsInHand = (opts: { deception?: number; greed?: number } = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "me", def: printing(CHEATS), owner: P1, zone: "hand" }, ...bank("deception", opts.deception ?? 8, P1), ...bank("greed", opts.greed ?? 0, P1)]
  });

clause(CHEATS, "0:unique", "it has the printed 2/1/3 stats, is a pluck grifter and carries the UNIQUE designation 'pluck'", () => {
  const def = printing(CHEATS);
  assert.equal(def.unique, "pluck");
  assert.deepEqual(def.subtype, ["pluck", "grifter"]);
  const { engine, id } = cheatsBoard();
  assert.deepEqual(stats(engine, id("cm")), [2, 1, 3]);
});

clause(CHEATS, "0:unique", "pays exactly 6, needs [D][D], and is refused one resource short or with Deception below the threshold", () => {
  const exact = deployChecks((res) => cheatsInHand(res), 6, 2);
  assert.equal(zoneOf(exact.engine, exact.id("me")), "play");
});

clause(CHEATS, "0:unique", "a second Cheats McGuillicutty entering play under the same controller makes them choose which to keep: keep the new one", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "old", def: printing(CHEATS), owner: P1, zone: "play" },
      { key: "new", def: printing(CHEATS), owner: P1, zone: "hand" },
      ...bank("deception", 6, P1)
    ]
  });
  play(engine, P1, id("new"));
  const pc = pending(engine)!;
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "its controller chooses");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [id("old"), id("new")].sort());
  answerPending(engine, "uniqueSurvivor", { keep: id("new") });
  assert.equal(zoneOf(engine, id("new")), "play");
  assert.equal(zoneOf(engine, id("old")), "discard", "the other copy is destroyed");
  assert.equal(pending(engine), undefined);
});

clause(CHEATS, "0:unique", "...keep the old one: the new copy is destroyed", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "old", def: printing(CHEATS), owner: P1, zone: "play" },
      { key: "new", def: printing(CHEATS), owner: P1, zone: "hand" },
      ...bank("deception", 6, P1)
    ]
  });
  play(engine, P1, id("new"));
  answerPending(engine, "uniqueSurvivor", { keep: id("old") });
  assert.equal(zoneOf(engine, id("old")), "play");
  assert.equal(zoneOf(engine, id("new")), "discard");
});

clause(CHEATS, "0:unique", "the designation is PLUCK, not the name: any other UNIQUE PLUCK card (Pluck) conflicts with Cheats", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "cm", def: printing(CHEATS), owner: P1, zone: "play" },
      { key: "pluck", def: printing(PLUCK_CARD), owner: P1, zone: "hand" },
      ...bank("deception", 6, P1)
    ]
  });
  play(engine, P1, id("pluck"));
  const pc = pending(engine)!;
  assert.equal(pc.kind, "uniqueSurvivor", "Cheats and Pluck share UNIQUE PLUCK");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [id("cm"), id("pluck")].sort());
  answerPending(engine, "uniqueSurvivor", { keep: id("cm") });
  assert.equal(zoneOf(engine, id("cm")), "play");
  assert.equal(zoneOf(engine, id("pluck")), "discard");
});

clause(CHEATS, "0:unique", "UNIQUE is per player: the opponent may control their own Cheats with no choice and no destruction", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "mine", def: printing(CHEATS), owner: P1, zone: "play" },
      { key: "theirs", def: printing(CHEATS), owner: P2, zone: "hand" },
      ...bank("deception", 6, P2)
    ]
  });
  play(engine, P2, id("theirs"));
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("mine")), "play");
  assert.equal(zoneOf(engine, id("theirs")), "play");
});

clause(CHEATS, "0:unique", "a second copy in hand, deck or discard pile is no conflict", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "cm", def: printing(CHEATS), owner: P1, zone: "play" },
      { key: "inHand", def: printing(CHEATS), owner: P1, zone: "hand" },
      { key: "inDeck", def: printing(CHEATS), owner: P1, zone: "deck" },
      { key: "inDiscard", def: printing(CHEATS), owner: P1, zone: "discard" }
    ]
  });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("cm")), "play");
});

clause(CHEATS, "0:unique", "after the first copy is destroyed, a new one enters play with no conflict", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "old", def: printing(CHEATS), owner: P1, zone: "discard" },
      { key: "new", def: printing(CHEATS), owner: P1, zone: "hand" },
      ...bank("deception", 6, P1)
    ]
  });
  play(engine, P1, id("new"));
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("new")), "play");
});

clause(CHEATS, "0:unique", "the survivor choice must name one of the conflicting copies, not an unrelated card", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "old", def: printing(CHEATS), owner: P1, zone: "play" },
      { key: "new", def: printing(CHEATS), owner: P1, zone: "hand" },
      { key: "bystander", def: character({ name: "Bystander" }), owner: P1, zone: "play" },
      ...bank("deception", 6, P1)
    ]
  });
  play(engine, P1, id("new"));
  refused(() => answerPending(engine, "uniqueSurvivor", { keep: id("bystander") }), "an unrelated card cannot be the survivor");
  assert.equal(zoneOf(engine, id("bystander")), "play");
  assert.ok(pending(engine), "still waiting for a real answer");
  answerPending(engine, "uniqueSurvivor", { keep: id("old") });
  assert.equal(pending(engine), undefined);
});

// 1:rule -- The top card of your deck is revealed at all times.

const deckTopReveals = (engine: SpoilsEngine) => engine.getFlowView().revealed.deckTop;

clause(CHEATS, "1:rule", "while Cheats is in play its controller's top card is revealed; the entry names exactly that card", () => {
  const { engine, id } = cheatsBoard();
  assert.deepEqual(deckTopReveals(engine), [{ playerId: P1, cardId: id("m0") }]);
  assert.equal(deckOf(engine, P1)[0], id("m0"), "control: m0 is the top card");
});

clause(CHEATS, "1:rule", "the opponent's top card is NOT revealed ('your deck')", () => {
  const { engine, id } = cheatsBoard();
  assert.equal(deckTopReveals(engine).some((e) => e.playerId === P2), false);
  assert.equal(deckTopReveals(engine).some((e) => e.cardId === id("o0")), false);
});

clause(CHEATS, "1:rule", "with no Cheats in play nothing is revealed (control)", () => {
  const { engine } = buildGame({ playerA: { faction: developFaction() }, cards: [...deckOfFillers("m", 3, P1), ...deckOfFillers("o", 3, P2)] });
  assert.deepEqual(deckTopReveals(engine), []);
});

clause(CHEATS, "1:rule", "Cheats in hand, in the deck or in the discard pile reveals nothing: it only works in play", () => {
  for (const zone of ["hand", "deck", "discard"] as const) {
    const { engine } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "cm", def: printing(CHEATS), owner: P1, zone }, ...deckOfFillers("m", 3, P1)]
    });
    assert.deepEqual(deckTopReveals(engine), [], `Cheats in ${zone}`);
  }
});

clause(CHEATS, "1:rule", "at all times: the revealed card follows the top of the deck as it changes (drawing, BOTTOM DEAL)", () => {
  const { engine, id } = cheatsBoard();
  assert.equal(deckTopReveals(engine)[0].cardId, id("m0"));
  developDraw(engine, P1);
  assert.equal(zoneOf(engine, id("m0")), "hand", "control: the top card was drawn");
  assert.deepEqual(deckTopReveals(engine), [{ playerId: P1, cardId: id("m1") }], "the new top card is revealed");
  activate(engine, P1, id("cm"), "bottomdeal");
  assert.deepEqual(deckTopReveals(engine), [{ playerId: P1, cardId: id("m2") }], "and again after the top card is moved to the bottom");
});

clause(CHEATS, "1:rule", "an empty deck has no top card to reveal", () => {
  const { engine } = cheatsBoard({ deck: [] });
  assert.deepEqual(deckTopReveals(engine), []);
});

clause(CHEATS, "1:rule", "the reveal ends when Cheats leaves play", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "cm", def: printing(CHEATS), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      ...deckOfFillers("m", 3, P1)
    ]
  });
  assert.equal(deckTopReveals(engine).length, 1);
  play(engine, P1, id("kill"), { selected: { t: [id("cm")] } });
  assert.equal(zoneOf(engine, id("cm")), "discard");
  assert.deepEqual(deckTopReveals(engine), []);
});

clause(CHEATS, "1:rule", "'your deck' is the controller's: Cheats controlled by the opponent reveals THEIR top card, not the owner's", () => {
  const { engine, id } = cheatsBoard({ cheatsOwner: P1, cheatsController: P2 });
  const reveals = deckTopReveals(engine);
  assert.deepEqual(reveals, [{ playerId: P2, cardId: id("o0") }]);
});

clause(CHEATS, "1:rule", "face-down it is just a resource with no rules text: nothing is revealed", () => {
  const { engine } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "cm", def: printing(CHEATS), owner: P1, zone: "play", faceDown: true }, ...deckOfFillers("m", 3, P1)]
  });
  assert.deepEqual(deckTopReveals(engine), []);
});

// 2:ability:bottomdeal -- COST: Pay 1. EFFECT: Put the top card of your deck on the bottom.

clause(CHEATS, "2:ability:bottomdeal", "the top card goes to the bottom; every other card moves up one place in the same order", () => {
  const { engine, id } = cheatsBoard();
  const before = [...deckOf(engine, P1)];
  assert.equal(before.length, 5);
  assert.equal(before[0], id("m0"));
  activate(engine, P1, id("cm"), "bottomdeal");
  assert.deepEqual(deckOf(engine, P1), [...before.slice(1), before[0]]);
  assert.equal(zoneOf(engine, id("m0")), "deck", "it stays in the deck");
});

clause(CHEATS, "2:ability:bottomdeal", "pays exactly 1 resource and does not deplete Cheats", () => {
  const { engine, id } = cheatsBoard();
  const before = ready(engine);
  activate(engine, P1, id("cm"), "bottomdeal");
  assert.equal(before - ready(engine), 1, "pay 1");
  assert.equal(isDepleted(engine, id("cm")), false, "no deplete cost");
  assert.equal(zoneOf(engine, id("cm")), "play");
});

clause(CHEATS, "2:ability:bottomdeal", "only my deck: the opponent's deck, both hands and both discard piles are untouched", () => {
  const { engine, id } = cheatsBoard();
  const oppDeck = [...deckOf(engine, P2)];
  const hands = [[...handOf(engine, P1)], [...handOf(engine, P2)]];
  activate(engine, P1, id("cm"), "bottomdeal");
  assert.deepEqual(deckOf(engine, P2), oppDeck);
  assert.deepEqual([[...handOf(engine, P1)], [...handOf(engine, P2)]], hands);
  assert.deepEqual(discardOf(engine, P1), []);
  assert.deepEqual(discardOf(engine, P2), []);
});

clause(CHEATS, "2:ability:bottomdeal", "can be used again and again: each use pays 1 and rotates the deck one more place", () => {
  const { engine, id } = cheatsBoard();
  const before = [...deckOf(engine, P1)];
  const r0 = ready(engine);
  activate(engine, P1, id("cm"), "bottomdeal");
  activate(engine, P1, id("cm"), "bottomdeal");
  activate(engine, P1, id("cm"), "bottomdeal");
  assert.deepEqual(deckOf(engine, P1), [...before.slice(3), ...before.slice(0, 3)]);
  assert.equal(r0 - ready(engine), 3, "three uses, 1 each");
});

clause(CHEATS, "2:ability:bottomdeal", "refused with no resource to pay; fine with exactly one", () => {
  const none = cheatsBoard({ deception: 0 });
  refused(() => activate(none.engine, P1, none.id("cm"), "bottomdeal"), "cannot pay 1");
  assert.equal(deckOf(none.engine, P1)[0], none.id("m0"), "nothing moved");
  const one = cheatsBoard({ deception: 1 });
  activate(one.engine, P1, one.id("cm"), "bottomdeal");
  assert.equal(deckOf(one.engine, P1)[4], one.id("m0"));
  assert.equal(ready(one.engine), 0);
});

clause(CHEATS, "2:ability:bottomdeal", "any resource pays the 1, not only Deception", () => {
  const { engine, id } = cheatsBoard({ deception: 0, greed: 1 });
  activate(engine, P1, id("cm"), "bottomdeal");
  assert.equal(deckOf(engine, P1)[4], id("m0"));
});

clause(CHEATS, "2:ability:bottomdeal", "a depleted Cheats can still use it (no deplete in the cost)", () => {
  const { engine, id } = cheatsBoard({ depleted: true });
  activate(engine, P1, id("cm"), "bottomdeal");
  assert.equal(deckOf(engine, P1)[4], id("m0"));
});

clause(CHEATS, "2:ability:bottomdeal", "a one-card deck stays as it is; an empty deck is harmless", () => {
  const one = cheatsBoard({ deck: deckOfFillers("m", 1, P1) });
  activate(one.engine, P1, one.id("cm"), "bottomdeal");
  assert.deepEqual(deckOf(one.engine, P1), [one.id("m0")]);
  assert.equal(zoneOf(one.engine, one.id("m0")), "deck");
});

clause(CHEATS, "2:ability:bottomdeal", "the opponent cannot use my Cheats' ability", () => {
  const { engine, id } = cheatsBoard({ turn: 2, active: P2, extra: [{ key: "attacker", def: character({ name: "Attacker", life: 9 }), owner: P2, zone: "play" }, ...bank("deception", 3, P2)] });
  openDefenderWindow(engine, id("attacker"));
  refused(() => activateRaw(engine, P2, id("cm"), "bottomdeal"), "P2 does not control Cheats");
  assert.equal(deckOf(engine, P1)[0], id("m0"));
});

clause(CHEATS, "2:ability:bottomdeal", "usable in response on the opponent's turn", () => {
  const { engine, id } = cheatsBoard({ turn: 2, active: P2, extra: [{ key: "attacker", def: character({ name: "Attacker", life: 9 }), owner: P2, zone: "play" }] });
  const before = [...deckOf(engine, P1)];
  openDefenderWindow(engine, id("attacker"));
  activateRaw(engine, P1, id("cm"), "bottomdeal");
  resolvePendingResponses(engine);
  assert.deepEqual(deckOf(engine, P1), [...before.slice(1), before[0]]);
});

// 3:ability:cheat -- COST: Deplete this card. EFFECT: You may look at and play the top card of your deck.

const topCharacter = (opts: { cost?: number; threshold?: string; name?: string; type?: "character" | "item" | "tactic" | "resource" } = {}): CardPlacement => {
  const name = opts.name ?? "TopCard";
  const common = { name, cost: opts.cost ?? 2, ...(opts.threshold ? { threshold: opts.threshold as never } : {}) };
  const def =
    opts.type === "item"
      ? item(common)
      : opts.type === "tactic"
        ? freeDrawTactic(name)
        : opts.type === "resource"
          ? resourceCard({ name, cost: 0 })
          : character({ ...common, strength: 2, life: 2, speed: 2 });
  return { key: "top", def, owner: P1, zone: "deck" };
};

const cheatBoard = (top: CardPlacement, opts: CheatsOpts = {}) => cheatsBoard({ ...opts, deck: [top, ...deckOfFillers("m", 4, P1)] });

const playTop = (engine: SpoilsEngine, cardId: CardInstanceId | undefined) => {
  const pc = pending(engine)!;
  assert.equal(pc.kind, "deployForFree", "I am offered the top card");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId } } as never);
  resolvePendingResponses(engine);
};

clause(CHEATS, "3:ability:cheat", "the cost is depleting Cheats: it is depleted after use and no resource is spent by the cost", () => {
  const { engine, id } = cheatBoard(topCharacter());
  const before = ready(engine);
  activateRaw(engine, P1, id("cm"), "cheat");
  assert.equal(isDepleted(engine, id("cm")), true);
  assert.equal(ready(engine), before, "no resources paid for the activation itself");
});

clause(CHEATS, "3:ability:cheat", "refused when Cheats is already depleted", () => {
  const { engine, id } = cheatBoard(topCharacter(), { depleted: true });
  refused(() => activateRaw(engine, P1, id("cm"), "cheat"), "cannot deplete a depleted card");
  assert.equal(deckOf(engine, P1)[0], id("top"));
  assert.equal(pending(engine), undefined);
});

clause(CHEATS, "3:ability:cheat", "can only be used once per untap: the second use in a turn is refused", () => {
  const { engine, id } = cheatBoard(topCharacter({ cost: 1 }));
  activate(engine, P1, id("cm"), "cheat");
  playTop(engine, undefined);
  refused(() => activate(engine, P1, id("cm"), "cheat"), "Cheats is depleted now");
});

clause(CHEATS, "3:ability:cheat", "I may play the top card: a character on top is deployed, paying its numeric cost, under my control", () => {
  const { engine, id } = cheatBoard(topCharacter({ cost: 2 }));
  const before = ready(engine);
  activate(engine, P1, id("cm"), "cheat");
  playTop(engine, id("top"));
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("top")), "play");
  assert.equal(controllerOf(engine, id("top")), P1);
  assert.equal(before - ready(engine), 2, "it is played, not put into play for free: its cost of 2 is paid");
});

clause(CHEATS, "3:ability:cheat", "the top card is gone from the deck and the next card is the new top", () => {
  const { engine, id } = cheatBoard(topCharacter({ cost: 1 }));
  activate(engine, P1, id("cm"), "cheat");
  playTop(engine, id("top"));
  assert.equal(deckOf(engine, P1).length, 4);
  assert.equal(deckOf(engine, P1)[0], id("m0"));
  assert.deepEqual(deckTopReveals(engine), [{ playerId: P1, cardId: id("m0") }]);
});

clause(CHEATS, "3:ability:cheat", "'may': declining plays nothing, leaves the card on top of the deck and spends no resources (Cheats stays depleted)", () => {
  const { engine, id } = cheatBoard(topCharacter({ cost: 2 }));
  const before = ready(engine);
  const deck = [...deckOf(engine, P1)];
  activate(engine, P1, id("cm"), "cheat");
  playTop(engine, undefined);
  assert.equal(pending(engine), undefined);
  assert.deepEqual(deckOf(engine, P1), deck, "the deck is untouched");
  assert.equal(zoneOf(engine, id("top")), "deck");
  assert.equal(ready(engine), before);
  assert.equal(isDepleted(engine, id("cm")), true, "the cost was paid regardless");
});

clause(CHEATS, "3:ability:cheat", "only the TOP card can be played: the second card of the deck is refused", () => {
  const { engine, id } = cheatBoard(topCharacter({ cost: 1 }));
  activate(engine, P1, id("cm"), "cheat");
  refused(
    () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id("m0") } } as never),
    "the second card is not the top card"
  );
  assert.equal(zoneOf(engine, id("m0")), "deck");
  playTop(engine, id("top"));
  assert.equal(zoneOf(engine, id("top")), "play", "control: the top card is playable");
});

clause(CHEATS, "3:ability:cheat", "a card in hand, in play, or in the opponent's deck cannot be played with it", () => {
  const { engine, id } = cheatBoard(topCharacter({ cost: 1 }), {
    extra: [{ key: "inHand", def: character({ name: "InHand", cost: 1 }), owner: P1, zone: "hand" }]
  });
  activate(engine, P1, id("cm"), "cheat");
  for (const key of ["inHand", "o0"]) {
    refused(
      () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id(key) } } as never),
      `${key} is not the top card of my deck`
    );
  }
  assert.equal(zoneOf(engine, id("inHand")), "hand");
  assert.equal(zoneOf(engine, id("o0")), "deck");
});

clause(CHEATS, "3:ability:cheat", "the top card must be affordable: a cost-5 card with 3 resources cannot be played, and I can still decline", () => {
  const { engine, id } = cheatBoard(topCharacter({ cost: 5 }), { deception: 3 });
  activate(engine, P1, id("cm"), "cheat");
  refused(
    () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id("top") } } as never),
    "cost 5 with 3 resources"
  );
  assert.equal(zoneOf(engine, id("top")), "deck");
  assert.equal(ready(engine), 3);
  playTop(engine, undefined);
  assert.equal(zoneOf(engine, id("top")), "deck");
});

clause(CHEATS, "3:ability:cheat", "exactly affordable: a cost-3 card with exactly 3 resources is played and uses all of them", () => {
  const { engine, id } = cheatBoard(topCharacter({ cost: 3 }), { deception: 3 });
  activate(engine, P1, id("cm"), "cheat");
  playTop(engine, id("top"));
  assert.equal(zoneOf(engine, id("top")), "play");
  assert.equal(ready(engine), 0);
});

clause(CHEATS, "3:ability:cheat", "the top card's threshold still applies: a [R][R] card with only Deception cannot be played, with [R][R] it can", () => {
  const noRage = cheatBoard(topCharacter({ cost: 1, threshold: "rr" }), { deception: 6 });
  activate(noRage.engine, P1, noRage.id("cm"), "cheat");
  refused(
    () => noRage.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: noRage.id("top") } } as never),
    "no Rage icons"
  );
  assert.equal(zoneOf(noRage.engine, noRage.id("top")), "deck");
  const withRage = cheatBoard(topCharacter({ cost: 1, threshold: "rr" }), { deception: 2, extra: bank("rage", 2, P1) });
  activate(withRage.engine, P1, withRage.id("cm"), "cheat");
  playTop(withRage.engine, withRage.id("top"));
  assert.equal(zoneOf(withRage.engine, withRage.id("top")), "play");
});

clause(CHEATS, "3:ability:cheat", "an item on top can be played too: it enters play for its cost", () => {
  const { engine, id } = cheatBoard(topCharacter({ cost: 2, type: "item", name: "TopItem" }));
  const before = ready(engine);
  activate(engine, P1, id("cm"), "cheat");
  playTop(engine, id("top"));
  assert.equal(zoneOf(engine, id("top")), "play");
  assert.equal(controllerOf(engine, id("top")), P1);
  assert.equal(before - ready(engine), 2);
});

clause(CHEATS, "3:ability:cheat", "a tactic on top can be played: its effect happens and it ends in my discard pile", () => {
  const { engine, id } = cheatBoard(topCharacter({ type: "tactic", name: "TopTactic" }));
  const handBefore = handOf(engine, P1).length;
  activate(engine, P1, id("cm"), "cheat");
  playTop(engine, id("top"));
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("top")), "discard", "the tactic resolved and was discarded");
  assert.equal(handOf(engine, P1).length, handBefore + 1, "its 'draw a card' happened");
  assert.equal(zoneOf(engine, id("m0")), "hand", "the card drawn was the next top card");
});

clause(CHEATS, "3:ability:cheat", "a resource on top: it is not offered, because an effect that lets you deploy a card deploys only a non-resource card (CR 604.2; 'You can't play resources with this ability')", () => {
  const { engine, id } = cheatBoard(topCharacter({ type: "resource", name: "TopStaple" }));
  activate(engine, P1, id("cm"), "cheat");
  assert.equal(pending(engine)?.kind, undefined, "nothing is offered: the only candidate is a resource card");
  assert.equal(zoneOf(engine, id("top")), "deck", "the resource stays on top of the deck");
});

clause(CHEATS, "3:ability:cheat", "the played character enters under my control but may not attack this turn (it was not in play at the start of the turn)", () => {
  const { engine, id } = cheatBoard(topCharacter({ cost: 1 }), { turn: 2 });
  activate(engine, P1, id("cm"), "cheat");
  playTop(engine, id("top"));
  assert.equal(zoneOf(engine, id("top")), "play");
  refused(() => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("top")], target: { type: "faction", playerId: P2 } }), "a freshly deployed character cannot attack", /did not start the turn in play/);
});

clause(CHEATS, "3:ability:cheat", "the effect only looks at my own deck: the opponent's top card is never offered", () => {
  const { engine, id } = cheatBoard(topCharacter({ cost: 1 }));
  activate(engine, P1, id("cm"), "cheat");
  const pc = pending(engine)!;
  assert.equal(pc.kind, "deployForFree");
  assert.deepEqual(pc.candidates, [id("top")]);
});

clause(CHEATS, "3:ability:cheat", "usable on the opponent's turn in response: the top card can be played (a tactic here)", () => {
  const { engine, id } = cheatBoard(topCharacter({ type: "tactic", name: "TopTactic" }), {
    turn: 2,
    active: P2,
    extra: [{ key: "attacker", def: character({ name: "Attacker", life: 9 }), owner: P2, zone: "play" }]
  });
  openDefenderWindow(engine, id("attacker"));
  activateRaw(engine, P1, id("cm"), "cheat");
  resolvePendingResponses(engine);
  const pc = pending(engine)!;
  assert.equal(pc.kind, "deployForFree");
  assert.equal(isDepleted(engine, id("cm")), true);
});

clause(CHEATS, "3:ability:cheat", "with an empty deck there is nothing to play and nothing breaks", () => {
  const { engine, id } = cheatsBoard({ deck: [] });
  activate(engine, P1, id("cm"), "cheat");
  assert.equal(engine.state.pendingChoice === undefined || pending(engine)?.kind === "deployForFree", true);
  if (pending(engine)) playTop(engine, undefined);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("cm")), "play");
});

// 4:ability:costume -- COST: Pay 3. Shuffle this card into its owner's deck.
// EFFECT: Search your deck for a "pluck" card with a different name than this card and put it into play.

const pluckDef = (name: string, extra: Partial<CardDefinition> = {}): CardDefinition => character({ name, subtype: ["pluck", "grifter"], strength: 2, life: 2, speed: 2, ...extra });

function costumeBoard(opts: CheatsOpts & { deckExtra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: opts.random,
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "cm", def: printing(CHEATS), owner: opts.cheatsOwner ?? P1, controller: opts.cheatsController, zone: "play", depleted: opts.depleted },
      ...bank("deception", opts.deception ?? 6, P1),
      { key: "pluckA", def: pluckDef("Pluck Alpha"), owner: P1, zone: "deck" },
      { key: "pluckB", def: pluckDef("Pluck Beta"), owner: P1, zone: "deck" },
      { key: "plain", def: character({ name: "Plain Joe" }), owner: P1, zone: "deck" },
      { key: "thief", def: character({ name: "Thief Not Pluck", subtype: ["thief"] }), owner: P1, zone: "deck" },
      { key: "cheats2", def: printing(CHEATS), owner: P1, zone: "deck" },
      ...(opts.deckExtra ?? []),
      ...deckOfFillers("o", 3, P2),
      ...(opts.extra ?? [])
    ]
  });
}

const costumeUse = (engine: SpoilsEngine, id: (key: string) => CardInstanceId) => {
  activate(engine, P1, id("cm"), "costume", { selected: { self: [id("cm")] } });
  const pc = pending(engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget", "the search prompts the controller");
  assert.equal(pc.playerId, P1);
  return pc;
};

const searchPick = (engine: SpoilsEngine, selected: CardInstanceId[]) => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected } } as never);

clause(CHEATS, "4:ability:costume", "pays exactly 3 resources", () => {
  const { engine, id } = costumeBoard();
  const before = ready(engine);
  activate(engine, P1, id("cm"), "costume", { selected: { self: [id("cm")] } });
  assert.equal(before - ready(engine), 3, "pay 3");
});

clause(CHEATS, "4:ability:costume", "refused with only 2 resources; allowed with exactly 3", () => {
  const short = costumeBoard({ deception: 2 });
  refused(() => activate(short.engine, P1, short.id("cm"), "costume", { selected: { self: [short.id("cm")] } }), "cannot pay 3 with 2 resources");
  assert.equal(zoneOf(short.engine, short.id("cm")), "play", "Cheats is not shuffled away when the cost can't be paid");
  assert.equal(ready(short.engine), 2);
  const exact = costumeBoard({ deception: 3 });
  activate(exact.engine, P1, exact.id("cm"), "costume", { selected: { self: [exact.id("cm")] } });
  assert.equal(zoneOf(exact.engine, exact.id("cm")), "deck");
});

clause(CHEATS, "4:ability:costume", "the cost shuffles Cheats itself into its owner's deck (not the discard pile, not the hand)", () => {
  const { engine, id } = costumeBoard();
  activate(engine, P1, id("cm"), "costume", { selected: { self: [id("cm")] } });
  assert.equal(zoneOf(engine, id("cm")), "deck");
  assert.ok(deckOf(engine, P1).includes(id("cm")), "it is in P1's deck");
  assert.equal(discardOf(engine, P1).includes(id("cm")), false);
  assert.equal(handOf(engine, P1).includes(id("cm")), false);
});

clause(CHEATS, "4:ability:costume", "the cost's shuffle really happens: the deck is randomized when Cheats goes into it", () => {
  let calls = 0;
  const { engine, id } = costumeBoard({ random: () => (++calls, 0.3) });
  assert.equal(calls, 0, "control: nothing shuffled yet");
  activate(engine, P1, id("cm"), "costume", { selected: { self: [id("cm")] } });
  assert.ok(calls > 0, "the deck was shuffled to pay the cost");
});

clause(CHEATS, "4:ability:costume", "search: only 'pluck' cards with a different name can be found; the pluck candidates are all offered", () => {
  const { engine, id } = costumeBoard();
  const pc = costumeUse(engine, id);
  const offered = new Set(((pc as unknown as { candidates?: string[] }).candidates ?? []) as string[]);
  // The prompt may not list its candidates; try the legal picks and the illegal ones.
  if (offered.size > 0) {
    assert.ok(offered.has(id("pluckA")) && offered.has(id("pluckB")), "offered.has(id(\"pluckA\")) && offered.has(id(\"pluckB\"))");
    assert.equal(offered.has(id("plain")), false);
    assert.equal(offered.has(id("thief")), false);
    assert.equal(offered.has(id("cheats2")), false);
  }
  refused(() => searchPick(engine, [id("plain")]), "a non-pluck card cannot be found");
  refused(() => searchPick(engine, [id("thief")]), "a thief that is not a pluck cannot be found");
  refused(() => searchPick(engine, [id("cheats2")]), "another Cheats McGuillicutty has the same name");
  refused(() => searchPick(engine, [id("o0")]), "the opponent's deck is not searched");
  searchPick(engine, [id("pluckB")]);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("pluckB")), "play", "a pluck with a different name works");
});

clause(CHEATS, "4:ability:costume", "the found card is put into play under my control, and nothing else comes with it", () => {
  const { engine, id } = costumeBoard();
  costumeUse(engine, id);
  searchPick(engine, [id("pluckA")]);
  resolvePendingResponses(engine);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("pluckA")), "play");
  assert.equal(controllerOf(engine, id("pluckA")), P1);
  assert.equal(zoneOf(engine, id("pluckB")), "deck");
  assert.equal(zoneOf(engine, id("cm")), "deck", "Cheats stays in the deck");
});

clause(CHEATS, "4:ability:costume", "it is put into play, not deployed: no resources are paid for the found card", () => {
  const { engine, id } = costumeBoard({ deception: 6, deckExtra: [{ key: "dear", def: pluckDef("Pluck Dear", { cost: 5 }), owner: P1, zone: "deck" }] });
  const before = ready(engine);
  costumeUse(engine, id);
  searchPick(engine, [id("dear")]);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("dear")), "play");
  assert.equal(before - ready(engine), 3, "only the 3 for the ability: the cost-5 card came into play for free");
});

clause(CHEATS, "4:ability:costume", "the cards searched past are not moved: the deck keeps every other card", () => {
  const { engine, id } = costumeBoard();
  const others = ["pluckB", "plain", "thief", "cheats2"].map(id);
  costumeUse(engine, id);
  searchPick(engine, [id("pluckA")]);
  resolvePendingResponses(engine);
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...others, id("cm")].sort(), "my deck = the unchosen cards + Cheats");
});

clause(CHEATS, "4:ability:costume", "the deck is shuffled after the search (CR 312.1)", () => {
  let calls = 0;
  const { engine, id } = costumeBoard({ random: () => (++calls, 0.7) });
  costumeUse(engine, id);
  const afterCost = calls;
  searchPick(engine, [id("pluckA")]);
  resolvePendingResponses(engine);
  assert.ok(calls > afterCost, "searched, so the deck is shuffled");
});

clause(CHEATS, "4:ability:costume", "Cheats itself is shuffled in before the search but cannot be found (same name), even when it is the only pluck", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "cm", def: printing(CHEATS), owner: P1, zone: "play" }, ...bank("deception", 3, P1), ...deckOfFillers("m", 3, P1)]
  });
  activate(engine, P1, id("cm"), "costume", { selected: { self: [id("cm")] } });
  const pc = pending(engine);
  if (pc) {
    refused(() => searchPick(engine, [id("cm")]), "Cheats cannot fetch itself");
    drain(engine, declineAll);
  }
  assert.equal(zoneOf(engine, id("cm")), "deck", "it stays in the deck");
  assert.equal(pending(engine), undefined);
});

clause(CHEATS, "4:ability:costume", "pluck cards in my hand, discard pile or already in play are not found", () => {
  const { engine, id } = costumeBoard({
    extra: [
      { key: "handPluck", def: pluckDef("Pluck Hand"), owner: P1, zone: "hand" },
      { key: "discPluck", def: pluckDef("Pluck Discard"), owner: P1, zone: "discard" },
      { key: "playPluck", def: pluckDef("Pluck InPlay"), owner: P1, zone: "play" }
    ]
  });
  costumeUse(engine, id);
  for (const key of ["handPluck", "discPluck", "playPluck"]) refused(() => searchPick(engine, [id(key)]), `${key} is not in my deck`);
  searchPick(engine, [id("pluckA")]);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("pluckA")), "play");
  assert.equal(zoneOf(engine, id("handPluck")), "hand");
  assert.equal(zoneOf(engine, id("discPluck")), "discard");
});

clause(CHEATS, "4:ability:costume", "it finds exactly one card: two picks are refused", () => {
  const { engine, id } = costumeBoard();
  costumeUse(engine, id);
  refused(() => searchPick(engine, [id("pluckA"), id("pluckB")]), "'a pluck card' is one card");
  assert.equal(zoneOf(engine, id("pluckA")), "deck");
  assert.equal(zoneOf(engine, id("pluckB")), "deck");
  searchPick(engine, [id("pluckA")]);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("pluckA")), "play");
});

clause(CHEATS, "4:ability:costume", "a search with a specific criterion may fail (CR 312.2): finding nothing is allowed and puts nothing into play", () => {
  const { engine, id } = costumeBoard();
  costumeUse(engine, id);
  searchPick(engine, []);
  resolvePendingResponses(engine);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("pluckA")), "deck");
  assert.equal(zoneOf(engine, id("pluckB")), "deck");
  assert.equal(zoneOf(engine, id("cm")), "deck", "the cost was still paid: Cheats is in the deck");
});

clause(CHEATS, "4:ability:costume", "a found UNIQUE PLUCK card does not conflict with Cheats, which has left play: no choice is asked", () => {
  const { engine, id } = costumeBoard({ deckExtra: [{ key: "realPluck", def: printing(PLUCK_CARD), owner: P1, zone: "deck" }] });
  costumeUse(engine, id);
  searchPick(engine, [id("realPluck")]);
  resolvePendingResponses(engine);
  assert.equal(pending(engine), undefined, "no uniqueSurvivor prompt");
  assert.equal(zoneOf(engine, id("realPluck")), "play");
  assert.equal(zoneOf(engine, id("cm")), "deck");
});

clause(CHEATS, "4:ability:costume", "the found card is not deployed, so it can be a card Cheats could not otherwise afford: its enters-play ability still fires", () => {
  const etb = pluckDef("Pluck Etb", {
    cost: 9,
    behavior: { abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const { engine, id } = costumeBoard({ deckExtra: [{ key: "etb", def: etb, owner: P1, zone: "deck" }] });
  const handBefore = handOf(engine, P1).length;
  costumeUse(engine, id);
  searchPick(engine, [id("etb")]);
  resolvePendingResponses(engine);
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("etb")), "play");
  assert.equal(handOf(engine, P1).length, handBefore + 1, "its 'when this enters play' ability triggered");
});

clause(CHEATS, "4:ability:costume", "'its owner's deck': a Cheats I control but the opponent owns is shuffled into the OWNER's deck, while I search MY deck", () => {
  const { engine, id } = costumeBoard({ cheatsOwner: P2, cheatsController: P1 });
  costumeUse(engine, id);
  assert.equal(zoneOf(engine, id("cm")), "deck");
  assert.ok(deckOf(engine, P2).includes(id("cm")), "it went into its owner's (the opponent's) deck");
  assert.equal(deckOf(engine, P1).includes(id("cm")), false, "not into mine");
  searchPick(engine, [id("pluckA")]);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("pluckA")), "play");
  assert.equal(controllerOf(engine, id("pluckA")), P1);
});

clause(CHEATS, "4:ability:costume", "the opponent's deck is only searched/shuffled if it is the owner's deck: with my own Cheats their deck keeps its order", () => {
  const { engine, id } = costumeBoard();
  const oppDeck = [...deckOf(engine, P2)];
  costumeUse(engine, id);
  searchPick(engine, [id("pluckA")]);
  resolvePendingResponses(engine);
  assert.deepEqual(deckOf(engine, P2), oppDeck);
});

clause(CHEATS, "4:ability:costume", "usable on the opponent's turn in response; the found card enters under my control", () => {
  const { engine, id } = costumeBoard({ turn: 2, active: P2, extra: [{ key: "attacker", def: character({ name: "Attacker", life: 9 }), owner: P2, zone: "play" }] });
  openDefenderWindow(engine, id("attacker"));
  activateRaw(engine, P1, id("cm"), "costume", { self: [id("cm")] });
  resolvePendingResponses(engine);
  const pc = pending(engine);
  assert.ok(pc && pc.kind === "chooserSelectsTarget", "pc && pc.kind === \"chooserSelectsTarget\"");
  searchPick(engine, [id("pluckA")]);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("pluckA")), "play");
  assert.equal(controllerOf(engine, id("pluckA")), P1);
});

clause(CHEATS, "4:ability:costume", "CHANGE COSTUME is offered as an available ability when Cheats can pay 3 (a player never has to name 'this card')", () => {
  const { engine, id } = costumeBoard();
  const offered = engine.getAvailableActivatedAbilities(P1).filter((a) => a.cardId === id("cm")).map((a) => a.ability.id);
  assert.ok(offered.includes("bottomdeal"), "control: BOTTOM DEAL is offered");
  assert.ok(offered.includes("cheat"), "control: CHEAT is offered");
  assert.ok(offered.includes("costume"), "CHANGE COSTUME is offered");
});

clause(CHEATS, "4:ability:costume", "'Shuffle this card' names no card to pick: the ability can be activated with no selection at all", () => {
  const { engine, id } = costumeBoard();
  activate(engine, P1, id("cm"), "costume");
  assert.equal(zoneOf(engine, id("cm")), "deck", "Cheats shuffled itself into the deck");
  const pc = pending(engine);
  assert.ok(pc && pc.kind === "chooserSelectsTarget", "and the search began");
});

// --- Clockman Pickpocket / Cute Cutpurse (shared "cannot be blocked" paragraph) ----------
// While your opponent controls an item and this card is the only member of an
// attacking party, this card cannot be blocked.

const PICKPOCKET = "cc55231b-da46-435a-95ef-d26fc8de31c0";
const CUTPURSE = "46d4519b-b2ff-4306-9489-9ce28ecc3a5b";

const smashItemTactic = (): CardDefinition =>
  tactic({
    name: "SmashItem",
    cost: 0,
    behavior: {
      abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
    }
  });

/** The thief (key `subject`, P1's, attack-eligible) on P1's turn 2, plus `extra`. */
function thiefBoard(printingId: string, extra: CardPlacement[] = [], opts: { random?: () => number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: opts.random,
    turn: 2,
    activePlayerId: P1,
    cards: [{ key: "subject", def: printing(printingId), owner: P1, zone: "play" }, ...extra]
  });
}

const gadget = (owner: Pid = P2, key = "gadget", controller?: Pid, name = "Gadget"): CardPlacement => ({ key, def: item({ name, cost: 2 }), owner, controller, zone: "play" });
const guard = (key = "guard", owner: Pid = P2): CardPlacement => ({ key, def: character({ name: `Guard ${key}`, strength: 1, life: 6, speed: 1 }), owner, zone: "play" });

const tryBlock = (engine: SpoilsEngine, blockers: CardInstanceId[], player: Pid = P2) => engine.perform({ type: "declareBlockers", playerId: player, blockerIds: blockers });

function unblockableAloneWithItem(printingId: string) {
  const { engine, id } = thiefBoard(printingId, [gadget(), guard("g1"), guard("g2")]);
  declareAttackBy(engine, P1, [id("subject")]);
  assert.equal(hasKeyword(engine, id("subject"), "cannotBeBlocked"), true, "the attacker cannot be blocked");
  refused(() => tryBlock(engine, [id("g1")]), "a single blocker is refused");
  refused(() => tryBlock(engine, [id("g1"), id("g2")]), "a blocking party of two is refused");
  assert.deepEqual(battleOf(engine)?.blockingParty ?? [], [], "nobody is blocking");
  tryBlock(engine, []);
  assert.ok(battleOf(engine), "control: declaring no blockers is accepted and the battle goes on");
}

function blockableWithoutOpponentItem(printingId: string) {
  const { engine, id } = thiefBoard(printingId, [guard("g1")]);
  declareAttackBy(engine, P1, [id("subject")]);
  assert.equal(hasKeyword(engine, id("subject"), "cannotBeBlocked"), false);
  tryBlock(engine, [id("g1")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("g1")], "with no item on their side, they may block");
}

function blockableWhenOnlyMyItem(printingId: string) {
  const { engine, id } = thiefBoard(printingId, [gadget(P1, "mine"), guard("g1")]);
  declareAttackBy(engine, P1, [id("subject")]);
  tryBlock(engine, [id("g1")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("g1")], "my own item does not count: 'your opponent controls an item'");
}

function blockableInAParty(printingId: string) {
  const { engine, id } = thiefBoard(printingId, [gadget(), guard("g1"), { key: "ally", def: character({ name: "Ally", strength: 1, life: 2, speed: 1 }), owner: P1, zone: "play" }]);
  declareAttackBy(engine, P1, [id("subject"), id("ally")]);
  assert.equal(hasKeyword(engine, id("subject"), "cannotBeBlocked"), false, "not the only member of the party");
  tryBlock(engine, [id("g1")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("g1")], "an attacking party of two can be blocked");
}

function blockableWhenItemGoneBeforeBlocks(printingId: string) {
  const { engine, id } = thiefBoard(printingId, [gadget(), guard("g1"), { key: "smash", def: smashItemTactic(), owner: P1, zone: "hand" }]);
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("subject")], target: { type: "faction", playerId: P2 } });
  assert.equal(hasKeyword(engine, id("subject"), "cannotBeBlocked"), true, "while they control an item it cannot be blocked");
  playRaw(engine, P1, id("smash"), { selected: { t: [id("gadget")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("gadget")), "discard", "control: their item was destroyed");
  assert.equal(hasKeyword(engine, id("subject"), "cannotBeBlocked"), false, "'while': the moment they control no item it can be blocked");
  tryBlock(engine, [id("g1")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("g1")]);
}

function onlyItemsCount(printingId: string) {
  const { engine, id } = thiefBoard(printingId, [
    { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
    { key: "hidden", def: item({ name: "HiddenItem" }), owner: P2, zone: "play", faceDown: true },
    guard("g1"),
    ...bank("rage", 2, P2)
  ]);
  declareAttackBy(engine, P1, [id("subject")]);
  assert.equal(hasKeyword(engine, id("subject"), "cannotBeBlocked"), false, "characters, locations, resources and face-down cards are not items");
  tryBlock(engine, [id("g1")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("g1")]);
}

function itemControlMatters(printingId: string) {
  const stolenFromMe = thiefBoard(printingId, [gadget(P1, "g", P2), guard("g1")]);
  declareAttackBy(stolenFromMe.engine, P1, [stolenFromMe.id("subject")]);
  assert.equal(hasKeyword(stolenFromMe.engine, stolenFromMe.id("subject"), "cannotBeBlocked"), true, "an item the opponent controls counts even if I own it");
  refused(() => tryBlock(stolenFromMe.engine, [stolenFromMe.id("g1")]), "controlled by the opponent => unblockable");

  const iControlTheirs = thiefBoard(printingId, [gadget(P2, "g", P1), guard("g1")]);
  declareAttackBy(iControlTheirs.engine, P1, [iControlTheirs.id("subject")]);
  assert.equal(hasKeyword(iControlTheirs.engine, iControlTheirs.id("subject"), "cannotBeBlocked"), false, "an item I control doesn't count even if they own it");
  tryBlock(iControlTheirs.engine, [iControlTheirs.id("g1")]);
  assert.deepEqual(battleOf(iControlTheirs.engine)?.blockingParty, [iControlTheirs.id("g1")]);
}

function notUnblockableOutsideAttack(printingId: string) {
  const { engine, id } = thiefBoard(printingId, [gadget()]);
  assert.equal(hasKeyword(engine, id("subject"), "cannotBeBlocked"), false, "not attacking: no keyword");
}

function onlyTheThiefIsProtected(printingId: string) {
  const { engine, id } = thiefBoard(printingId, [gadget(), guard("g1"), { key: "ally", def: character({ name: "Ally", strength: 1, life: 2, speed: 1 }), owner: P1, zone: "play" }]);
  declareAttackBy(engine, P1, [id("ally")]);
  assert.equal(hasKeyword(engine, id("ally"), "cannotBeBlocked"), false, "another character attacking alone is not unblockable");
  tryBlock(engine, [id("g1")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("g1")]);
}

function twoThievesAreEachBlockable(printingId: string) {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "a", def: printing(printingId), owner: P1, zone: "play" },
      { key: "b", def: printing(printingId), owner: P1, zone: "play" },
      gadget(),
      guard("g1")
    ]
  });
  declareAttackBy(engine, P1, [id("a"), id("b")]);
  assert.equal(hasKeyword(engine, id("a"), "cannotBeBlocked") || hasKeyword(engine, id("b"), "cannotBeBlocked"), false, "neither is the ONLY member of the party");
  tryBlock(engine, [id("g1")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("g1")]);
}

function oppositeSideWorks(printingId: string) {
  // The thief belongs to P2 and attacks P1: "your opponent" is now P1.
  const withP1Item = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [{ key: "subject", def: printing(printingId), owner: P2, zone: "play" }, gadget(P1, "theirs"), gadget(P2, "mine"), guard("g1", P1)]
  });
  withP1Item.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [withP1Item.id("subject")], target: { type: "faction", playerId: P1 } });
  resolvePendingResponses(withP1Item.engine);
  refused(() => tryBlock(withP1Item.engine, [withP1Item.id("g1")], P1), "P1 controls an item, so P2's thief cannot be blocked");

  const onlyOwnItem = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [{ key: "subject", def: printing(printingId), owner: P2, zone: "play" }, gadget(P2, "mine"), guard("g1", P1)]
  });
  onlyOwnItem.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [onlyOwnItem.id("subject")], target: { type: "faction", playerId: P1 } });
  resolvePendingResponses(onlyOwnItem.engine);
  tryBlock(onlyOwnItem.engine, [onlyOwnItem.id("g1")], P1);
  assert.deepEqual(battleOf(onlyOwnItem.engine)?.blockingParty, [onlyOwnItem.id("g1")], "only P2's own item exists: P1 may block");
}

function attackingALocationStillUnblockable(printingId: string) {
  const { engine, id } = thiefBoard(printingId, [gadget(), { key: "place", def: location({ name: "Place", structure: 5 }), owner: P2, zone: "play" }, guard("g1")]);
  declareAttackBy(engine, P1, [id("subject")], { type: "card", cardId: id("place") });
  assert.equal(hasKeyword(engine, id("subject"), "cannotBeBlocked"), true, "attacking a location, the attacking party is still just this card");
  refused(() => tryBlock(engine, [id("g1")]), "unblockable against a location attack too");
}

clause(PICKPOCKET, "0:rule", "alone in the attacking party while the opponent controls an item: no blocker, single or party, is accepted", () => unblockableAloneWithItem(PICKPOCKET));
clause(PICKPOCKET, "0:rule", "no item on the opponent's side: a plain character may block it", () => blockableWithoutOpponentItem(PICKPOCKET));
clause(PICKPOCKET, "0:rule", "only MY item in play: the condition is the opponent controlling an item, so it can be blocked", () => blockableWhenOnlyMyItem(PICKPOCKET));
clause(PICKPOCKET, "0:rule", "not the only member of the party (an ally attacks with it): it can be blocked", () => blockableInAParty(PICKPOCKET));
clause(PICKPOCKET, "0:rule", "'While': the moment the opponent's last item is destroyed (before blockers) it can be blocked again", () => blockableWhenItemGoneBeforeBlocks(PICKPOCKET));
clause(PICKPOCKET, "0:rule", "only items count: a location, a face-down card, resources and characters on the opponent's side do not", () => onlyItemsCount(PICKPOCKET));
clause(PICKPOCKET, "0:rule", "'controls': an item I own but the opponent controls counts; an item they own but I control does not", () => itemControlMatters(PICKPOCKET));
clause(PICKPOCKET, "0:rule", "it is only unblockable while attacking: not before an attack is declared", () => notUnblockableOutsideAttack(PICKPOCKET));
clause(PICKPOCKET, "0:rule", "it protects only itself: another character attacking alone while the opponent has an item can be blocked", () => onlyTheThiefIsProtected(PICKPOCKET));
clause(PICKPOCKET, "0:rule", "two of them attacking together are a party of two: neither is the only member, so they can be blocked", () => twoThievesAreEachBlockable(PICKPOCKET));
clause(PICKPOCKET, "0:rule", "'your opponent' is relative to the thief's controller: the opponent's thief is unblockable when I control an item, blockable when only they do", () => oppositeSideWorks(PICKPOCKET));
clause(PICKPOCKET, "0:rule", "attacking a location alone it is just as unblockable", () => attackingALocationStillUnblockable(PICKPOCKET));

clause(CUTPURSE, "0:rule", "alone in the attacking party while the opponent controls an item: no blocker, single or party, is accepted", () => unblockableAloneWithItem(CUTPURSE));
clause(CUTPURSE, "0:rule", "no item on the opponent's side: a plain character may block it", () => blockableWithoutOpponentItem(CUTPURSE));
clause(CUTPURSE, "0:rule", "only MY item in play: the condition is the opponent controlling an item, so it can be blocked", () => blockableWhenOnlyMyItem(CUTPURSE));
clause(CUTPURSE, "0:rule", "not the only member of the party (an ally attacks with it): it can be blocked", () => blockableInAParty(CUTPURSE));
clause(CUTPURSE, "0:rule", "'While': the moment the opponent's last item is destroyed (before blockers) it can be blocked again", () => blockableWhenItemGoneBeforeBlocks(CUTPURSE));
clause(CUTPURSE, "0:rule", "only items count: a location, a face-down card, resources and characters on the opponent's side do not", () => onlyItemsCount(CUTPURSE));
clause(CUTPURSE, "0:rule", "'controls': an item I own but the opponent controls counts; an item they own but I control does not", () => itemControlMatters(CUTPURSE));
clause(CUTPURSE, "0:rule", "it is only unblockable while attacking: not before an attack is declared", () => notUnblockableOutsideAttack(CUTPURSE));
clause(CUTPURSE, "0:rule", "it protects only itself: another character attacking alone while the opponent has an item can be blocked", () => onlyTheThiefIsProtected(CUTPURSE));
clause(CUTPURSE, "0:rule", "two of them attacking together are a party of two: neither is the only member, so they can be blocked", () => twoThievesAreEachBlockable(CUTPURSE));
clause(CUTPURSE, "0:rule", "'your opponent' is relative to the thief's controller: the opponent's thief is unblockable when I control an item, blockable when only they do", () => oppositeSideWorks(CUTPURSE));
clause(CUTPURSE, "0:rule", "attacking a location alone it is just as unblockable", () => attackingALocationStillUnblockable(CUTPURSE));

clause(PICKPOCKET, "0:rule", "pays exactly 1, needs [D], and has the printed 1/1/3 stats", () => {
  const exact = deployChecks(
    (res) =>
      buildGame({
        playerA: { faction: developFaction() },
        cards: [{ key: "me", def: printing(PICKPOCKET), owner: P1, zone: "hand" }, ...bank("deception", res.deception, P1), ...bank("greed", res.greed, P1)]
      }),
    1,
    1
  );
  assert.equal(zoneOf(exact.engine, exact.id("me")), "play");
  assert.deepEqual(stats(exact.engine, exact.id("me")), [1, 1, 3]);
});

clause(CUTPURSE, "0:rule", "pays exactly 4, needs [D], and has the printed 3/2/3 stats", () => {
  const exact = deployChecks(
    (res) =>
      buildGame({
        playerA: { faction: developFaction() },
        cards: [{ key: "me", def: printing(CUTPURSE), owner: P1, zone: "hand" }, ...bank("deception", res.deception, P1), ...bank("greed", res.greed, P1)]
      }),
    4,
    1
  );
  assert.equal(zoneOf(exact.engine, exact.id("me")), "play");
  assert.deepEqual(stats(exact.engine, exact.id("me")), [3, 2, 3]);
});

// --- Clockman Pickpocket 1:rule -- If this card inflicts damage to a faction, your opponent
// must pick an item they control. If they do, take control of that item and destroy this card.

/** The Pickpocket attacks P2's faction unblocked; returns once battle damage has been assigned (a pick is pending when the rule fires). */
function pickpocketHits(extra: CardPlacement[], opts: { allies?: boolean } = {}) {
  const game = thiefBoard(PICKPOCKET, extra);
  const attackers = [game.id("subject"), ...(opts.allies ? [game.id("ally")] : [])];
  fight(game.engine, P1, attackers, { type: "faction", playerId: P2 }, []);
  return game;
}

const pickItem = (engine: SpoilsEngine, player: Pid, selected: CardInstanceId[]) => answerPending(engine, "chooserSelectsTarget", { selected });

clause(PICKPOCKET, "1:rule", "damage to the faction: the opponent picks one of their items, I take control of it and the Pickpocket is destroyed", () => {
  const { engine, id } = pickpocketHits([gadget()]);
  const pc = pending(engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the OPPONENT picks");
  pickItem(engine, P2, [id("gadget")]);
  assert.equal(controllerOf(engine, id("gadget")), P1, "I control the item");
  assert.equal(zoneOf(engine, id("gadget")), "play", "it stays in play");
  assert.equal(engine.state.cards[id("gadget")].ownerId, P2, "ownership never changes");
  assert.equal(zoneOf(engine, id("subject")), "discard", "the Pickpocket is destroyed");
  assert.equal(pending(engine), undefined);
});

clause(PICKPOCKET, "1:rule", "the faction really takes the 1 damage (influence 30 -> 29) as well", () => {
  const { engine, id } = pickpocketHits([gadget()]);
  pickItem(engine, P2, [id("gadget")]);
  assert.equal(influence(engine, P2), 29);
});

clause(PICKPOCKET, "1:rule", "the opponent chooses WHICH item: with two items either may be the one taken, the other stays", () => {
  for (const [takenKey, keptKey] of [["a", "b"], ["b", "a"]] as const) {
    const { engine, id } = pickpocketHits([gadget(P2, "a", undefined, "ItemA"), gadget(P2, "b", undefined, "ItemB")]);
    pickItem(engine, P2, [id(takenKey)]);
    assert.equal(controllerOf(engine, id(takenKey)), P1);
    assert.equal(controllerOf(engine, id(keptKey)), P2, "the other item is untouched");
  }
});

clause(PICKPOCKET, "1:rule", "I cannot make the pick for them: the pick belongs to the opponent", () => {
  const { engine, id } = pickpocketHits([gadget()]);
  refused(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("gadget")] } } as never), "P1 may not choose for P2");
  assert.equal(controllerOf(engine, id("gadget")), P2);
});

clause(PICKPOCKET, "1:rule", "'must pick': the opponent cannot decline while they have an item", () => {
  const { engine, id } = pickpocketHits([gadget()]);
  refused(() => pickItem(engine, P2, []), "an empty pick is refused");
  assert.ok(pending(engine), "still waiting for the pick");
  assert.equal(zoneOf(engine, id("subject")), "play", "the Pickpocket is not destroyed by a declined pick");
  pickItem(engine, P2, [id("gadget")]);
  assert.equal(controllerOf(engine, id("gadget")), P1);
});

clause(PICKPOCKET, "1:rule", "only an ITEM THEY control can be picked: not my item, their character, their location or their face-down card", () => {
  const { engine, id } = pickpocketHits([
    gadget(),
    gadget(P1, "mine", undefined, "MyItem"),
    guard("g1"),
    { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
    { key: "hidden", def: item({ name: "HiddenItem" }), owner: P2, zone: "play", faceDown: true }
  ]);
  for (const key of ["mine", "g1", "place", "hidden"]) {
    refused(() => pickItem(engine, P2, [id(key)]), `${key} is not an item P2 controls`);
  }
  assert.equal(controllerOf(engine, id("mine")), P1);
  pickItem(engine, P2, [id("gadget")]);
  assert.equal(controllerOf(engine, id("gadget")), P1);
});

clause(PICKPOCKET, "1:rule", "'they control': an item P2 controls but P1 owns can be picked; one P1 controls but P2 owns cannot", () => {
  const { engine, id } = pickpocketHits([gadget(P1, "ownedByMe", P2, "OwnedByMe"), gadget(P2, "ownedByThem", P1, "OwnedByThem")]);
  refused(() => pickItem(engine, P2, [id("ownedByThem")]), "I control it already");
  pickItem(engine, P2, [id("ownedByMe")]);
  assert.equal(controllerOf(engine, id("ownedByMe")), P1, "taken from its controller P2");
  assert.equal(engine.state.cards[id("ownedByMe")].ownerId, P1);
});

clause(PICKPOCKET, "1:rule", "no item to pick: nothing is taken and the Pickpocket is NOT destroyed ('if they do')", () => {
  const { engine, id } = pickpocketHits([guard("g1")]);
  assert.equal(pending(engine), undefined, "no pick is offered");
  assert.equal(zoneOf(engine, id("subject")), "play");
  assert.equal(influence(engine, P2), 29, "the damage was still inflicted");
});

clause(PICKPOCKET, "1:rule", "only damage to a FACTION triggers it: a blocker taking its damage does not (it is blockable in a party)", () => {
  const harmless: CardPlacement = { key: "g1", def: character({ name: "HarmlessGuard", strength: 0, life: 6, speed: 1 }), owner: P2, zone: "play" };
  const game = thiefBoard(PICKPOCKET, [gadget(), harmless, { key: "ally", def: character({ name: "Ally", strength: 1, life: 2, speed: 1 }), owner: P1, zone: "play" }]);
  fight(game.engine, P1, [game.id("subject"), game.id("ally")], { type: "faction", playerId: P2 }, [game.id("g1")]);
  drain(game.engine, declineAll);
  assert.equal(game.engine.state.cards[game.id("g1")].damage, 2, "control: the blocker took the damage");
  assert.equal(pending(game.engine), undefined);
  assert.equal(controllerOf(game.engine, game.id("gadget")), P2, "no theft");
  assert.equal(zoneOf(game.engine, game.id("subject")), "play", "the Pickpocket survives");
});

clause(PICKPOCKET, "1:rule", "attacking a location (damage to a location, not a faction) never triggers it", () => {
  const game = thiefBoard(PICKPOCKET, [gadget(), { key: "place", def: location({ name: "Place", structure: 5 }), owner: P2, zone: "play" }]);
  fight(game.engine, P1, [game.id("subject")], { type: "card", cardId: game.id("place") }, []);
  drain(game.engine, declineAll);
  assert.equal(game.engine.state.cards[game.id("place")].damage, 1, "control: the location took the damage");
  assert.equal(controllerOf(game.engine, game.id("gadget")), P2);
  assert.equal(zoneOf(game.engine, game.id("subject")), "play");
});

clause(PICKPOCKET, "1:rule", "'this card inflicts': a different attacker's damage to the faction does not trigger it", () => {
  const game = thiefBoard(PICKPOCKET, [gadget(), { key: "ally", def: character({ name: "Ally", strength: 2, life: 2, speed: 1 }), owner: P1, zone: "play" }]);
  fight(game.engine, P1, [game.id("ally")], { type: "faction", playerId: P2 }, []);
  drain(game.engine, declineAll);
  assert.equal(influence(game.engine, P2), 28, "control: the ally's 2 damage landed");
  assert.equal(pending(game.engine), undefined);
  assert.equal(controllerOf(game.engine, game.id("gadget")), P2);
  assert.equal(zoneOf(game.engine, game.id("subject")), "play", "the Pickpocket at home is untouched");
});

clause(PICKPOCKET, "1:rule", "in a party with an ally that also hits the faction, it fires once: one item is taken, the Pickpocket (only) is destroyed", () => {
  const game = pickpocketHits(
    [gadget(P2, "a", undefined, "ItemA"), gadget(P2, "b", undefined, "ItemB"), { key: "ally", def: character({ name: "Ally", strength: 1, life: 2, speed: 1 }), owner: P1, zone: "play" }],
    { allies: true }
  );
  const { engine, id } = game;
  assert.equal(influence(engine, P2), 29, "the Pickpocket (speed 3) hit first");
  pickItem(engine, P2, [id("a")]);
  autoResolveBattle(engine);
  assert.equal(influence(engine, P2), 28, "then the ally (speed 1) hit the faction as well");
  assert.equal(pending(engine), undefined, "one theft only");
  assert.equal(controllerOf(engine, id("a")), P1);
  assert.equal(controllerOf(engine, id("b")), P2);
  assert.equal(zoneOf(engine, id("subject")), "discard");
  assert.equal(zoneOf(engine, id("ally")), "play");
});

clause(PICKPOCKET, "1:rule", "the Pickpocket goes to its owner's discard pile", () => {
  const { engine, id } = pickpocketHits([gadget()]);
  pickItem(engine, P2, [id("gadget")]);
  assert.ok(discardOf(engine, P1).includes(id("subject")), "discardOf(engine, P1).includes(id(\"subject\"))");
});

clause(PICKPOCKET, "1:rule", "if the Pickpocket deals no damage (0 strength) there is no 'inflicts damage' and nothing happens", () => {
  const weaken = tactic({
    name: "Weaken",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "w",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "strength", operation: "add", value: -1, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });
  const game = thiefBoard(PICKPOCKET, [gadget(), { key: "weaken", def: weaken, owner: P1, zone: "hand" }]);
  play(game.engine, P1, game.id("weaken"), { selected: { t: [game.id("subject")] } });
  assert.equal(game.engine.getStat(game.id("subject"), "strength"), 0, "control: 0 strength");
  fight(game.engine, P1, [game.id("subject")], { type: "faction", playerId: P2 }, []);
  drain(game.engine, declineAll);
  assert.equal(influence(game.engine, P2), 30, "no damage");
  assert.equal(controllerOf(game.engine, game.id("gadget")), P2, "nothing stolen");
  assert.equal(zoneOf(game.engine, game.id("subject")), "play");
});

clause(PICKPOCKET, "1:rule", "'your opponent' is relative to the controller: the opponent's own Pickpocket makes ME pick an item I control, and THEY take it", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [{ key: "subject", def: printing(PICKPOCKET), owner: P2, zone: "play" }, gadget(P1, "mine", undefined, "MyItem"), gadget(P2, "theirs", undefined, "TheirItem")]
  });
  fight(game.engine, P2, [game.id("subject")], { type: "faction", playerId: P1 }, []);
  const pc = pending(game.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I am the one who must pick");
  refused(() => pickItem(game.engine, P1, [game.id("theirs")]), "not an item I control");
  pickItem(game.engine, P1, [game.id("mine")]);
  assert.equal(controllerOf(game.engine, game.id("mine")), P2, "they now control my item");
  assert.equal(zoneOf(game.engine, game.id("subject")), "discard");
});

clause(PICKPOCKET, "1:rule", "a Pickpocket I control but the opponent owns: it is destroyed into ITS OWNER's discard pile after the theft", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [{ key: "subject", def: printing(PICKPOCKET), owner: P2, controller: P1, zone: "play" }, gadget()]
  });
  fight(game.engine, P1, [game.id("subject")], { type: "faction", playerId: P2 }, []);
  pickItem(game.engine, P2, [game.id("gadget")]);
  assert.equal(controllerOf(game.engine, game.id("gadget")), P1);
  assert.ok(discardOf(game.engine, P2).includes(game.id("subject")), "owner's discard pile");
});

// --- Cute Cutpurse 1:rule -- If this card inflicts damage to a faction, you must pick an
// item your opponent controls. Destroy that item.

function cutpurseHits(extra: CardPlacement[], opts: { allies?: boolean } = {}) {
  const game = thiefBoard(CUTPURSE, extra);
  const attackers = [game.id("subject"), ...(opts.allies ? [game.id("ally")] : [])];
  fight(game.engine, P1, attackers, { type: "faction", playerId: P2 }, []);
  return game;
}

clause(CUTPURSE, "1:rule", "damage to the faction: I pick one of the opponent's items and it is destroyed (to its owner's discard pile); the Cutpurse survives", () => {
  const { engine, id } = cutpurseHits([gadget()]);
  const pc = pending(engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I pick");
  pickItem(engine, P1, [id("gadget")]);
  assert.equal(zoneOf(engine, id("gadget")), "discard");
  assert.ok(discardOf(engine, P2).includes(id("gadget")), "discardOf(engine, P2).includes(id(\"gadget\"))");
  assert.equal(zoneOf(engine, id("subject")), "play", "the Cutpurse is not destroyed");
  assert.equal(pending(engine), undefined);
});

clause(CUTPURSE, "1:rule", "the faction takes the 3 damage too (influence 30 -> 27)", () => {
  const { engine, id } = cutpurseHits([gadget()]);
  pickItem(engine, P1, [id("gadget")]);
  assert.equal(influence(engine, P2), 27);
});

clause(CUTPURSE, "1:rule", "I choose which of two items is destroyed; the other stays", () => {
  for (const [goneKey, keptKey] of [["a", "b"], ["b", "a"]] as const) {
    const { engine, id } = cutpurseHits([gadget(P2, "a", undefined, "ItemA"), gadget(P2, "b", undefined, "ItemB")]);
    pickItem(engine, P1, [id(goneKey)]);
    assert.equal(zoneOf(engine, id(goneKey)), "discard");
    assert.equal(zoneOf(engine, id(keptKey)), "play");
    assert.equal(controllerOf(engine, id(keptKey)), P2);
  }
});

clause(CUTPURSE, "1:rule", "the opponent cannot make the pick for me", () => {
  const { engine, id } = cutpurseHits([gadget()]);
  refused(() => engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [id("gadget")] } } as never), "P2 may not choose");
  assert.equal(zoneOf(engine, id("gadget")), "play");
});

clause(CUTPURSE, "1:rule", "'must pick': I cannot decline while they have an item", () => {
  const { engine, id } = cutpurseHits([gadget()]);
  refused(() => pickItem(engine, P1, []), "an empty pick is refused");
  assert.ok(pending(engine), "still waiting for the pick");
  assert.equal(zoneOf(engine, id("gadget")), "play");
  pickItem(engine, P1, [id("gadget")]);
  assert.equal(zoneOf(engine, id("gadget")), "discard");
});

clause(CUTPURSE, "1:rule", "only an ITEM THE OPPONENT CONTROLS can be picked: not my item, their character, their location or their face-down card", () => {
  const { engine, id } = cutpurseHits([
    gadget(),
    gadget(P1, "mine", undefined, "MyItem"),
    guard("g1"),
    { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
    { key: "hidden", def: item({ name: "HiddenItem" }), owner: P2, zone: "play", faceDown: true }
  ]);
  for (const key of ["mine", "g1", "place", "hidden"]) {
    refused(() => pickItem(engine, P1, [id(key)]), `${key} cannot be picked`);
  }
  assert.equal(zoneOf(engine, id("mine")), "play");
  pickItem(engine, P1, [id("gadget")]);
  assert.equal(zoneOf(engine, id("gadget")), "discard");
});

clause(CUTPURSE, "1:rule", "exactly one item: two picks are refused", () => {
  const { engine, id } = cutpurseHits([gadget(P2, "a", undefined, "ItemA"), gadget(P2, "b", undefined, "ItemB")]);
  refused(() => pickItem(engine, P1, [id("a"), id("b")]), "'an item' is one item");
  assert.equal(zoneOf(engine, id("a")), "play");
  assert.equal(zoneOf(engine, id("b")), "play");
});

clause(CUTPURSE, "1:rule", "'controls': an item I own but the opponent controls can be picked and is destroyed into MY discard pile (its owner's)", () => {
  const { engine, id } = cutpurseHits([gadget(P1, "ownedByMe", P2, "OwnedByMe"), gadget(P2, "ownedByThem", P1, "OwnedByThem")]);
  refused(() => pickItem(engine, P1, [id("ownedByThem")]), "I control it");
  pickItem(engine, P1, [id("ownedByMe")]);
  assert.equal(zoneOf(engine, id("ownedByMe")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("ownedByMe")), "discardOf(engine, P1).includes(id(\"ownedByMe\"))");
  assert.equal(zoneOf(engine, id("ownedByThem")), "play");
});

clause(CUTPURSE, "1:rule", "no item to pick: nothing is destroyed and no pick is offered", () => {
  const { engine, id } = cutpurseHits([guard("g1")]);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("g1")), "play", "their character is not an item");
  assert.equal(zoneOf(engine, id("subject")), "play");
  assert.equal(influence(engine, P2), 27, "the damage was still inflicted");
});

clause(CUTPURSE, "1:rule", "an item attached to a character is still an item the opponent controls: it can be picked and destroyed", () => {
  const { engine, id } = cutpurseHits([
    guard("host"),
    { key: "gear", def: item({ name: "Gear", subtype: ["gear"] }), owner: P2, zone: "play", attachedToKey: "host" }
  ]);
  const pc = pending(engine);
  assert.ok(pc && pc.kind === "chooserSelectsTarget", "the attached gear is a legal pick");
  pickItem(engine, P1, [id("gear")]);
  assert.equal(zoneOf(engine, id("gear")), "discard");
  assert.equal(zoneOf(engine, id("host")), "play");
});

clause(CUTPURSE, "1:rule", "only damage to a FACTION triggers it: damage to a blocker does not", () => {
  const game = thiefBoard(CUTPURSE, [gadget(), guard("g1"), { key: "ally", def: character({ name: "Ally", strength: 1, life: 2, speed: 1 }), owner: P1, zone: "play" }]);
  fight(game.engine, P1, [game.id("subject"), game.id("ally")], { type: "faction", playerId: P2 }, [game.id("g1")]);
  drain(game.engine, declineAll);
  assert.equal(pending(game.engine), undefined);
  assert.equal(zoneOf(game.engine, game.id("gadget")), "play", "no item destroyed");
});

clause(CUTPURSE, "1:rule", "attacking a location (not a faction) never triggers it", () => {
  const game = thiefBoard(CUTPURSE, [gadget(), { key: "place", def: location({ name: "Place", structure: 9 }), owner: P2, zone: "play" }]);
  fight(game.engine, P1, [game.id("subject")], { type: "card", cardId: game.id("place") }, []);
  drain(game.engine, declineAll);
  assert.equal(game.engine.state.cards[game.id("place")].damage, 3, "control: the location took the 3 damage");
  assert.equal(zoneOf(game.engine, game.id("gadget")), "play");
});

clause(CUTPURSE, "1:rule", "'this card inflicts': a different attacker's damage to the faction does not trigger it", () => {
  const game = thiefBoard(CUTPURSE, [gadget(), { key: "ally", def: character({ name: "Ally", strength: 2, life: 2, speed: 1 }), owner: P1, zone: "play" }]);
  fight(game.engine, P1, [game.id("ally")], { type: "faction", playerId: P2 }, []);
  drain(game.engine, declineAll);
  assert.equal(influence(game.engine, P2), 28);
  assert.equal(pending(game.engine), undefined);
  assert.equal(zoneOf(game.engine, game.id("gadget")), "play");
});

clause(CUTPURSE, "1:rule", "in a party with an ally that also hits the faction it fires once: one item destroyed", () => {
  const { engine, id } = cutpurseHits(
    [gadget(P2, "a", undefined, "ItemA"), gadget(P2, "b", undefined, "ItemB"), { key: "ally", def: character({ name: "Ally", strength: 1, life: 2, speed: 1 }), owner: P1, zone: "play" }],
    { allies: true }
  );
  assert.equal(influence(engine, P2), 27, "the Cutpurse (speed 3) hit first");
  pickItem(engine, P1, [id("a")]);
  autoResolveBattle(engine);
  assert.equal(influence(engine, P2), 26, "then the ally (speed 1) hit the faction as well: 3 + 1 damage");
  assert.equal(pending(engine), undefined, "a single pick only");
  assert.equal(zoneOf(engine, id("a")), "discard");
  assert.equal(zoneOf(engine, id("b")), "play");
});

clause(CUTPURSE, "1:rule", "'your opponent' is relative to the controller: the opponent's own Cutpurse makes THEM pick one of MY items and destroy it", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [{ key: "subject", def: printing(CUTPURSE), owner: P2, zone: "play" }, gadget(P1, "mine", undefined, "MyItem"), gadget(P2, "theirs", undefined, "TheirItem")]
  });
  fight(game.engine, P2, [game.id("subject")], { type: "faction", playerId: P1 }, []);
  const pc = pending(game.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the Cutpurse's controller picks");
  refused(() => pickItem(game.engine, P2, [game.id("theirs")]), "not an item their opponent controls");
  pickItem(game.engine, P2, [game.id("mine")]);
  assert.equal(zoneOf(game.engine, game.id("mine")), "discard");
  assert.equal(zoneOf(game.engine, game.id("theirs")), "play");
});

// --- Counter Attack ------------------------------------------------------------
// COST: Play this only during your opponent's turn and not during a battle.
// EFFECT: Attack your opponent. Draw a card. (This effect only allows you to attack
// once. You must resolve the battle before you draw the card.)
// Tactic, rogue, cost 3, threshold [D][D].

const COUNTER_ATTACK = "65bd9386-5d61-415a-be45-5d50b5b369a5";

const nothingTactic = (): CardDefinition =>
  tactic({ name: "Nothing", cost: 0, behavior: { abilities: [{ id: "n", type: "activated", effects: [] }] } });

interface CounterOpts {
  deception?: number;
  greed?: number;
  extra?: CardPlacement[];
  mineEligible?: boolean;
  active?: Pid;
  random?: () => number;
}

/** P2's turn 2. P1 holds Counter Attack, characters a1 (2/3/3), a2 (1/3/2) and a bystander; P2 has a Nothing tactic and blockers foe (1/3/1), foe2. */
function counterBoard(opts: CounterOpts = {}) {
  const eligible = opts.mineEligible !== false;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P2,
    random: opts.random,
    cards: [
      { key: "ca", def: printing(COUNTER_ATTACK), owner: P1, zone: "hand" },
      { key: "a1", def: character({ name: "A1", strength: 2, life: 3, speed: 3 }), owner: P1, zone: "play", attackEligible: eligible },
      { key: "a2", def: character({ name: "A2", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play", attackEligible: eligible },
      { key: "by", def: character({ name: "Bystander", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play", attackEligible: eligible },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play", attackEligible: false },
      { key: "foe2", def: character({ name: "Foe2", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play", attackEligible: false },
      { key: "nothing", def: nothingTactic(), owner: P2, zone: "hand" },
      ...deckOfFillers("m", 4, P1),
      ...deckOfFillers("o", 3, P2),
      ...bank("deception", opts.deception ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

/** P2 plays `Nothing`, so P1 holds priority in a response window on P2's turn with no battle. */
function openOpponentWindow(game: ReturnType<typeof counterBoard>) {
  playRaw(game.engine, P2, game.id("nothing"));
  assert.equal(game.engine.state.responseWindow?.priorityPlayerId, P1, "control: I hold priority in a window on the opponent's turn");
}

/** Plays Counter Attack with `atk` as attackers and lets the responses finish; returns with the battle waiting for blockers. */
function playCounterAttack(game: ReturnType<typeof counterBoard>, atk: string[]) {
  playRaw(game.engine, P1, game.id("ca"), { selected: { atk: atk.map(game.id) } });
  resolvePendingResponses(game.engine);
}

clause(COUNTER_ATTACK, "0:ability", "played in a response window on the opponent's turn: I attack their faction with the chosen characters, which deplete", () => {
  const game = counterBoard();
  const { engine, id } = game;
  openOpponentWindow(game);
  playCounterAttack(game, ["a1"]);
  const battle = battleOf(engine)!;
  assert.ok(battle, "a battle began");
  assert.equal(battle.attackerPlayerId, P1, "I am the attacker");
  assert.equal(battle.defenderPlayerId, P2, "against my opponent");
  assert.deepEqual(battle.target, { type: "faction", playerId: P2 }, "targeting their faction");
  assert.deepEqual(battle.attackingParty, [id("a1")], "exactly the chosen character attacks");
  assert.equal(isDepleted(engine, id("a1")), true, "attacking depletes it");
  assert.equal(isDepleted(engine, id("a2")), false, "the unchosen character does not");
});

clause(COUNTER_ATTACK, "0:ability", "an unblocked attack deals its damage to their faction and the turn player is still P2 afterwards", () => {
  const game = counterBoard();
  const { engine, id } = game;
  openOpponentWindow(game);
  playCounterAttack(game, ["a1"]);
  declareAttackBlockers(engine, []);
  autoResolveBattle(engine);
  assert.equal(influence(engine, P2), 28, "a1 (strength 2) hit the faction");
  assert.equal(engine.state.activePlayerId, P2, "it is still their turn");
  assert.equal(battleOf(engine), undefined, "the battle is over");
});

function declareAttackBlockers(engine: SpoilsEngine, blockers: CardInstanceId[]) {
  // The defender (P2) declares blockers once the response windows have closed.
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: blockers });
}

clause(COUNTER_ATTACK, "0:ability", "the opponent may block with their characters and normal battle damage is dealt between the parties", () => {
  const game = counterBoard();
  const { engine, id } = game;
  openOpponentWindow(game);
  playCounterAttack(game, ["a1"]);
  declareAttackBlockers(engine, [id("foe")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("foe")]);
  autoResolveBattle(engine);
  assert.equal(battleOf(engine), undefined, "the battle resolved");
});

clause(COUNTER_ATTACK, "0:ability", "...and the damage is real: the blocker takes the attacker's strength (life 3, strength 2 -> 2 damage, survives)", () => {
  const game = counterBoard();
  const { engine, id } = game;
  openOpponentWindow(game);
  playCounterAttack(game, ["a1"]);
  declareAttackBlockers(engine, [id("foe")]);
  autoResolveBattle(engine);
  assert.equal(zoneOf(engine, id("foe")), "play");
  assert.equal(engine.state.cards[id("foe")].damage, 2);
  assert.equal(engine.state.cards[id("a1")].damage, 1, "the blocker (strength 1) hit back");
  assert.equal(influence(engine, P2), 30, "the blocked attack did not touch the faction");
});

clause(COUNTER_ATTACK, "0:ability", "I choose how many attack: several characters form one attacking party", () => {
  const game = counterBoard();
  const { engine, id } = game;
  openOpponentWindow(game);
  playCounterAttack(game, ["a1", "a2"]);
  assert.deepEqual([...battleOf(engine)!.attackingParty].sort(), [id("a1"), id("a2")].sort());
  assert.equal(isDepleted(engine, id("a1")) && isDepleted(engine, id("a2")), true);
  assert.equal(isDepleted(engine, id("by")), false);
  declareAttackBlockers(engine, []);
  autoResolveBattle(engine);
  assert.equal(influence(engine, P2), 27, "2 + 1 damage");
});

clause(COUNTER_ATTACK, "0:ability", "there is no limit on the number of attackers: ten characters can all attack", () => {
  const tenMore = Array.from({ length: 10 }, (_, i): CardPlacement => ({ key: `army${i}`, def: character({ name: `Army${i}`, strength: 1, life: 2, speed: 1 }), owner: P1, zone: "play" }));
  const game = counterBoard({ extra: tenMore });
  const { engine, id } = game;
  openOpponentWindow(game);
  playCounterAttack(game, tenMore.map((p) => p.key));
  assert.equal(battleOf(engine)?.attackingParty.length, 10, "all ten attack");
  declareAttackBlockers(engine, []);
  autoResolveBattle(engine);
  assert.equal(influence(engine, P2), 20);
  assert.equal(isDepleted(engine, id("army9")), true);
});

clause(COUNTER_ATTACK, "0:ability", "only my own characters can be picked as attackers: not the opponent's, and not a non-character", () => {
  const game = counterBoard({ extra: [{ key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" }] });
  const { engine, id } = game;
  openOpponentWindow(game);
  refused(() => playRaw(engine, P1, id("ca"), { selected: { atk: [id("foe")] } }), "an opponent's character cannot attack for me");
  refused(() => playRaw(engine, P1, id("ca"), { selected: { atk: [id("gear")] } }), "an item cannot attack");
  assert.equal(zoneOf(engine, id("ca")), "hand", "nothing was played");
});

clause(COUNTER_ATTACK, "0:ability", "a character that is already depleted cannot attack", () => {
  const game = counterBoard({ extra: [{ key: "tired", def: character({ name: "Tired", strength: 5, life: 3, speed: 3 }), owner: P1, zone: "play", depleted: true }] });
  const { engine, id } = game;
  openOpponentWindow(game);
  playCounterAttack(game, ["tired"]);
  const battle = battleOf(engine);
  assert.equal(battle?.attackingParty.includes(id("tired")) ?? false, false, "a depleted character is not in the attacking party");
});

clause(COUNTER_ATTACK, "0:ability", "a character that was not under my control since the start of the turn cannot attack (CR 204.3)", () => {
  const game = counterBoard({ mineEligible: false });
  const { engine, id } = game;
  openOpponentWindow(game);
  playCounterAttack(game, ["a1"]);
  const battle = battleOf(engine);
  assert.equal(battle?.attackingParty.includes(id("a1")) ?? false, false, "a character that just entered play cannot attack");
});

clause(COUNTER_ATTACK, "0:ability", "the battle is resolved BEFORE the card is drawn: no card is drawn while the battle is still going", () => {
  const game = counterBoard();
  const { engine, id } = game;
  const handBefore = handOf(engine, P1).length; // includes Counter Attack itself
  openOpponentWindow(game);
  playCounterAttack(game, ["a1"]);
  assert.equal(handOf(engine, P1).length, handBefore - 1, "Counter Attack left the hand; nothing drawn yet");
  declareAttackBlockers(engine, [id("foe")]);
  assert.equal(handOf(engine, P1).length, handBefore - 1, "still no draw after blockers are declared");
  assert.equal(zoneOf(engine, id("m0")), "deck", "the top card is still on top");
  autoResolveBattle(engine);
  assert.equal(zoneOf(engine, id("m0")), "hand", "once the battle is resolved, the top card is drawn");
  assert.equal(handOf(engine, P1).length, handBefore, "exactly one card was drawn");
});

clause(COUNTER_ATTACK, "0:ability", "draw happens after the battle even when the attack is blocked and nobody dies; exactly one card", () => {
  const game = counterBoard();
  const { engine, id } = game;
  const deckBefore = deckOf(engine, P1).length;
  openOpponentWindow(game);
  playCounterAttack(game, ["a1", "a2"]);
  declareAttackBlockers(engine, [id("foe"), id("foe2")]);
  autoResolveBattle(engine);
  assert.equal(deckOf(engine, P1).length, deckBefore - 1);
  assert.equal(handOf(engine, P2).length, 0, "the opponent drew nothing (their only card, the Nothing tactic, was played)");
});

clause(COUNTER_ATTACK, "0:ability", "the draw is mine and nobody else's, and the tactic ends in my discard pile", () => {
  const game = counterBoard();
  const { engine, id } = game;
  const oppDeck = deckOf(engine, P2).length;
  openOpponentWindow(game);
  playCounterAttack(game, ["a1"]);
  declareAttackBlockers(engine, []);
  autoResolveBattle(engine);
  assert.equal(deckOf(engine, P2).length, oppDeck, "their deck is untouched");
  assert.equal(zoneOf(engine, id("ca")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("ca")), "discardOf(engine, P1).includes(id(\"ca\"))");
});

clause(COUNTER_ATTACK, "0:ability", "it pays exactly 3 and needs [D][D]; refused one resource short or without the threshold", () => {
  const short = counterBoard({ deception: 2 });
  openOpponentWindow(short);
  refused(() => playRaw(short.engine, P1, short.id("ca"), { selected: { atk: [short.id("a1")] } }), "2 resources < 3");
  assert.equal(zoneOf(short.engine, short.id("ca")), "hand");

  const noIcons = counterBoard({ deception: 1, greed: 8 });
  openOpponentWindow(noIcons);
  refused(() => playRaw(noIcons.engine, P1, noIcons.id("ca"), { selected: { atk: [noIcons.id("a1")] } }), "one Deception is below [D][D]");

  const exact = counterBoard({ deception: 3 });
  openOpponentWindow(exact);
  const before = ready(exact.engine);
  playRaw(exact.engine, P1, exact.id("ca"), { selected: { atk: [exact.id("a1")] } });
  assert.equal(before - ready(exact.engine), 3, "exactly 3 is paid");
});

clause(COUNTER_ATTACK, "0:ability", "'only during your opponent's turn': refused on my own turn, even with a response window open for me", () => {
  const mine = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "ca", def: printing(COUNTER_ATTACK), owner: P1, zone: "hand" },
      { key: "a1", def: character({ name: "A1", strength: 2, life: 3, speed: 3 }), owner: P1, zone: "play" },
      ...bank("deception", 6, P1)
    ]
  });
  refused(() => playRaw(mine.engine, P1, mine.id("ca"), { selected: { atk: [mine.id("a1")] } }), "my own turn");
  assert.equal(zoneOf(mine.engine, mine.id("ca")), "hand");
  assert.equal(battleOf(mine.engine), undefined);
});

clause(COUNTER_ATTACK, "0:ability", "'not during a battle': refused while a battle (their attack) is under way, allowed in a non-battle window", () => {
  const game = counterBoard({ extra: [{ key: "raider", def: character({ name: "Raider", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" }] });
  const { engine, id } = game;
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("raider")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  assert.ok(battleOf(engine), "control: a battle is under way and I can act");
  refused(() => playRaw(engine, P1, id("ca"), { selected: { atk: [id("a1")] } }), "during a battle");
  assert.equal(zoneOf(engine, id("ca")), "hand");
});

clause(COUNTER_ATTACK, "0:ability", "it can be played in response to the opponent announcing the end of their turn", () => {
  const game = counterBoard();
  const { engine, id } = game;
  engine.perform({ type: "endTurn", playerId: P2 });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "control: I may respond to the end of turn");
  playRaw(engine, P1, id("ca"), { selected: { atk: [id("a1")] } });
  resolvePendingResponses(engine);
  assert.ok(battleOf(engine), "the counter attack happens");
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("a1")]);
});

clause(COUNTER_ATTACK, "0:ability", "the card it was played in response to is not lost: the opponent's tactic still resolves and is discarded after the battle", () => {
  const game = counterBoard();
  const { engine, id } = game;
  openOpponentWindow(game);
  playCounterAttack(game, ["a1"]);
  declareAttackBlockers(engine, []);
  autoResolveBattle(engine);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("nothing")), "discard", "their tactic ended in their discard pile, not stuck in 'deploying'");
});

clause(COUNTER_ATTACK, "0:ability", "it only allows one attack: after the battle I cannot attack again, and the characters stay depleted", () => {
  const game = counterBoard();
  const { engine, id } = game;
  openOpponentWindow(game);
  playCounterAttack(game, ["a1"]);
  declareAttackBlockers(engine, []);
  autoResolveBattle(engine);
  resolvePendingResponses(engine);
  assert.equal(battleOf(engine), undefined);
  assert.equal(isDepleted(engine, id("a1")), true, "the attacker stays depleted");
  assert.equal(isDepleted(engine, id("a2")), false);
  refused(() => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("a2")], target: { type: "faction", playerId: P2 } }), "it is not my turn, so I cannot attack again");
});

clause(COUNTER_ATTACK, "0:ability", "the attacker chooses nothing about the target: it can only be 'your opponent' (their faction), never a location", () => {
  const game = counterBoard({ extra: [{ key: "place", def: location({ name: "Place", structure: 4 }), owner: P2, zone: "play" }] });
  const { engine, id } = game;
  openOpponentWindow(game);
  playCounterAttack(game, ["a1"]);
  assert.deepEqual(battleOf(engine)?.target, { type: "faction", playerId: P2 });
  declareAttackBlockers(engine, []);
  autoResolveBattle(engine);
  assert.equal(engine.state.cards[id("place")].damage, 0);
  assert.equal(influence(engine, P2), 28);
});

clause(COUNTER_ATTACK, "0:ability", "attackers destroyed in the battle: the draw still happens afterwards", () => {
  const killer = character({ name: "Killer", strength: 9, life: 9, speed: 5 });
  const game = counterBoard({ extra: [{ key: "killer", def: killer, owner: P2, zone: "play", attackEligible: false }] });
  const { engine, id } = game;
  openOpponentWindow(game);
  playCounterAttack(game, ["a1"]);
  declareAttackBlockers(engine, [id("killer")]);
  autoResolveBattle(engine);
  assert.equal(zoneOf(engine, id("a1")), "discard", "control: my attacker died");
  assert.equal(zoneOf(engine, id("m0")), "hand", "and I still drew");
});

// --- shared: a tactic / permanent in P1's hand with `deception` Deception resources --------------

interface HandOpts {
  deception?: number;
  greed?: number;
  random?: () => number;
  turn?: number;
  active?: Pid;
  extra?: CardPlacement[];
  key?: string;
}

/** The printing under test in P1's hand (key `me` unless `opts.key`), the usual Develop factions, `deception` Deception resources (default 14). */
function handBoard(printingId: string, opts: HandOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: opts.random,
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: opts.key ?? "me", def: printing(printingId), owner: P1, zone: "hand" },
      ...bank("deception", opts.deception ?? 14, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

/** A free tactic that adds `amount` to a stat of one picked character until end of turn (id `pump`, declaration `t`). */
const statTactic = (stat: "strength" | "life" | "speed", amount: number, name = `Pump${stat}${amount}`): CardDefinition =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pump",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat, operation: "add", value: amount, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });

// --- Early Retirement ----------------------------------------------------------------------
// COST: Pick a character you control. X is that character's strength. Destroy the character.
// EFFECT: Draw X cards.   Tactic, rogue, cost 5, threshold [D][D].

const RETIREMENT = "bc40724d-186f-4cf2-88da-ca8b8e648865";

function retirementBoard(opts: HandOpts & { strength?: number; deck?: number } = {}) {
  return handBoard(RETIREMENT, {
    ...opts,
    extra: [
      { key: "c", def: character({ name: "Retiree", strength: opts.strength ?? 3, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "d", def: character({ name: "Bystander", strength: 4, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 6, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...deckOfFillers("m", opts.deck ?? 8, P1),
      ...deckOfFillers("o", 4, P2),
      ...(opts.extra ?? [])
    ]
  });
}

clause(RETIREMENT, "0:ability", "the picked character is destroyed (into its owner's discard pile) and I draw cards equal to its strength", () => {
  const { engine, id } = retirementBoard({ strength: 3 });
  const deck = [...deckOf(engine, P1)];
  const handBefore = handOf(engine, P1).length;
  play(engine, P1, id("me"), { selected: { pick: [id("c")] } });
  assert.equal(zoneOf(engine, id("c")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("c")), "discardOf(engine, P1).includes(id(\"c\"))");
  assert.deepEqual(handOf(engine, P1).filter((card) => deck.includes(card)), deck.slice(0, 3), "exactly the top 3 cards were drawn, in order");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 3);
  assert.equal(zoneOf(engine, id("me")), "discard", "the tactic ends in my discard pile");
});

clause(RETIREMENT, "0:ability", "X is the strength: 0, 1, 2 and 5 draw exactly that many cards", () => {
  for (const x of [0, 1, 2, 5]) {
    const { engine, id } = retirementBoard({ strength: x });
    const deckBefore = deckOf(engine, P1).length;
    play(engine, P1, id("me"), { selected: { pick: [id("c")] } });
    assert.equal(deckBefore - deckOf(engine, P1).length, x, `X = ${x}`);
    assert.equal(zoneOf(engine, id("c")), "discard", `the strength-${x} character is destroyed regardless`);
  }
});

clause(RETIREMENT, "0:ability", "X counts the strength as modified: a character pumped to 3 (printed 1) draws 3", () => {
  const { engine, id } = retirementBoard({ strength: 1, extra: [{ key: "pump", def: statTactic("strength", 2), owner: P1, zone: "hand" }] });
  play(engine, P1, id("pump"), { selected: { t: [id("c")] } });
  assert.equal(engine.getStat(id("c"), "strength"), 3, "control: pumped");
  const deckBefore = deckOf(engine, P1).length;
  play(engine, P1, id("me"), { selected: { pick: [id("c")] } });
  assert.equal(deckBefore - deckOf(engine, P1).length, 3);
});

clause(RETIREMENT, "0:ability", "only the picked character is destroyed: my other character and the opponent's stay", () => {
  const { engine, id } = retirementBoard();
  play(engine, P1, id("me"), { selected: { pick: [id("c")] } });
  assert.equal(zoneOf(engine, id("d")), "play");
  assert.equal(zoneOf(engine, id("foe")), "play");
});

clause(RETIREMENT, "0:ability", "the pick must be a character I control: an opponent's character, an item, a location and a face-down card are refused", () => {
  const { engine, id } = retirementBoard({
    extra: [
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden", strength: 5 }), owner: P1, zone: "play", faceDown: true }
    ]
  });
  for (const key of ["foe", "gear", "place", "hidden"]) {
    refused(() => playRaw(engine, P1, id("me"), { selected: { pick: [id(key)] } }), `${key} cannot be picked`);
  }
  refused(() => playRaw(engine, P1, id("me"), { selected: { pick: [factionOf(engine, P1)] } }), "my faction cannot be picked");
  refused(() => playRaw(engine, P1, id("me"), { selected: {} }), "a pick is required");
  assert.equal(zoneOf(engine, id("me")), "hand", "nothing was played");
  assert.equal(zoneOf(engine, id("foe")), "play");
});

clause(RETIREMENT, "0:ability", "exactly one character: two picks are refused", () => {
  const { engine, id } = retirementBoard();
  refused(() => playRaw(engine, P1, id("me"), { selected: { pick: [id("c"), id("d")] } }), "'a character'");
  assert.equal(zoneOf(engine, id("c")), "play");
  assert.equal(zoneOf(engine, id("d")), "play");
});

clause(RETIREMENT, "0:ability", "a character I control but the opponent owns can be picked: it is destroyed into ITS OWNER's discard pile, X is its strength, and I draw", () => {
  const { engine, id } = retirementBoard({
    extra: [{ key: "stolen", def: character({ name: "Stolen", strength: 4, life: 3, speed: 2 }), owner: P2, controller: P1, zone: "play" }]
  });
  const deckBefore = deckOf(engine, P1).length;
  play(engine, P1, id("me"), { selected: { pick: [id("stolen")] } });
  assert.equal(zoneOf(engine, id("stolen")), "discard");
  assert.ok(discardOf(engine, P2).includes(id("stolen")), "the opponent's discard pile");
  assert.equal(deckBefore - deckOf(engine, P1).length, 4, "I drew 4");
});

clause(RETIREMENT, "0:ability", "the draw is mine; the opponent's hand and deck are untouched", () => {
  const { engine, id } = retirementBoard();
  const oppDeck = [...deckOf(engine, P2)];
  const oppHand = [...handOf(engine, P2)];
  play(engine, P1, id("me"), { selected: { pick: [id("c")] } });
  assert.deepEqual(deckOf(engine, P2), oppDeck);
  assert.deepEqual(handOf(engine, P2), oppHand);
});

clause(RETIREMENT, "0:ability", "X larger than my deck: I draw what is there and nothing breaks", () => {
  const { engine, id } = retirementBoard({ strength: 5, deck: 2 });
  play(engine, P1, id("me"), { selected: { pick: [id("c")] } });
  assert.equal(deckOf(engine, P1).length, 0);
  assert.equal(zoneOf(engine, id("c")), "discard");
  assert.equal(pending(engine), undefined);
});

clause(RETIREMENT, "0:ability", "pays exactly 5, needs [D][D], and is refused one resource short or without the threshold", () => {
  const exact = deployChecks(
    (res) => retirementBoard({ deception: res.deception, greed: res.greed }),
    5,
    2,
    (id) => ({ pick: [id("c")] })
  );
  assert.equal(zoneOf(exact.engine, exact.id("c")), "discard");
});

clause(RETIREMENT, "0:ability", "the destroy is a COST: the picked character is already in the discard pile while the opponent can still respond", () => {
  const { engine, id } = retirementBoard();
  playRaw(engine, P1, id("me"), { selected: { pick: [id("c")] } });
  assert.ok(engine.state.responseWindow, "control: the tactic is on the stack awaiting responses");
  assert.equal(zoneOf(engine, id("c")), "discard", "'Destroy the character' is paid when the card is played");
  assert.equal(deckOf(engine, P1).length, 8, "...and nothing is drawn yet");
});

clause(RETIREMENT, "0:ability", "X is fixed when the cost is paid: the opponent cannot pump the (already destroyed) character to change X", () => {
  const pump = statTactic("strength", 3);
  const { engine, id } = retirementBoard({ strength: 3, extra: [{ key: "pump", def: pump, owner: P2, zone: "hand" }] });
  playRaw(engine, P1, id("me"), { selected: { pick: [id("c")] } });
  refused(() => playRaw(engine, P2, id("pump"), { selected: { t: [id("c")] } }), "the character is already destroyed, so it cannot be picked");
  resolvePendingResponses(engine);
  assert.equal(deckOf(engine, P1).length, 5, "X stays 3: three cards drawn");
});

clause(RETIREMENT, "0:ability", "the destroyed character cannot be saved in response (e.g. by bouncing it): it is already gone and X is already known", () => {
  const bounce = tactic({
    name: "Bounce",
    cost: 0,
    behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });
  const { engine, id } = retirementBoard({ strength: 4, extra: [{ key: "bounce", def: bounce, owner: P2, zone: "hand" }] });
  playRaw(engine, P1, id("me"), { selected: { pick: [id("c")] } });
  refused(() => playRaw(engine, P2, id("bounce"), { selected: { t: [id("c")] } }), "already destroyed");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("c")), "discard");
  assert.equal(deckOf(engine, P1).length, 4, "four cards drawn");
});

// --- Epic Turncoat Maneuver ---------------------------------------------------------------
// COST: Destroy 2 characters you control. Pick 4 or fewer characters.
// EFFECT: Take control of the picked characters.   Tactic, rogue, cost 13, threshold [D]x6.

const TURNCOAT = "613f3fc5-6ef5-49e9-aec2-2c69cd9ffcdd";

function turncoatBoard(opts: HandOpts = {}) {
  const foes = ["o1", "o2", "o3", "o4", "o5"].map(
    (key, i): CardPlacement => ({ key, def: character({ name: `Foe${i + 1}`, strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" })
  );
  return handBoard(TURNCOAT, {
    deception: 20,
    ...opts,
    extra: [
      { key: "s1", def: character({ name: "Sac1", strength: 1, life: 2, speed: 1 }), owner: P1, zone: "play" },
      { key: "s2", def: character({ name: "Sac2", strength: 1, life: 2, speed: 1 }), owner: P1, zone: "play" },
      { key: "s3", def: character({ name: "Sac3", strength: 1, life: 2, speed: 1 }), owner: P1, zone: "play" },
      ...foes,
      ...(opts.extra ?? [])
    ]
  });
}

clause(TURNCOAT, "0:ability", "destroys the 2 chosen characters of mine (to their owners' discard piles) and takes control of the picked characters", () => {
  const { engine, id } = turncoatBoard();
  play(engine, P1, id("me"), { selected: { sac: [id("s1"), id("s2")], picks: [id("o1"), id("o2")] } });
  assert.equal(zoneOf(engine, id("s1")), "discard");
  assert.equal(zoneOf(engine, id("s2")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("s1")) && discardOf(engine, P1).includes(id("s2")), "discardOf(engine, P1).includes(id(\"s1\")) && discardOf(engine, P1).includes(id(\"s2\"))");
  assert.equal(zoneOf(engine, id("s3")), "play", "the third of my characters is not destroyed");
  for (const key of ["o1", "o2"]) {
    assert.equal(zoneOf(engine, id(key)), "play");
    assert.equal(controllerOf(engine, id(key)), P1, `${key} is mine now`);
    assert.equal(engine.state.cards[id(key)].ownerId, P2, "ownership never changes");
  }
  assert.equal(zoneOf(engine, id("me")), "discard");
});

clause(TURNCOAT, "0:ability", "only the picked characters change sides: the unpicked opponent characters stay theirs", () => {
  const { engine, id } = turncoatBoard();
  play(engine, P1, id("me"), { selected: { sac: [id("s1"), id("s2")], picks: [id("o1")] } });
  assert.equal(controllerOf(engine, id("o1")), P1);
  for (const key of ["o2", "o3", "o4", "o5"]) assert.equal(controllerOf(engine, id(key)), P2, key);
});

clause(TURNCOAT, "0:ability", "'4 or fewer': picking 1, 2, 3 and exactly 4 characters all work", () => {
  for (const n of [1, 2, 3, 4]) {
    const { engine, id } = turncoatBoard();
    const picks = ["o1", "o2", "o3", "o4"].slice(0, n);
    play(engine, P1, id("me"), { selected: { sac: [id("s1"), id("s2")], picks: picks.map(id) } });
    for (const key of picks) assert.equal(controllerOf(engine, id(key)), P1, `${n} picks: ${key}`);
    assert.equal(controllerOf(engine, id("o5")), P2);
  }
});

clause(TURNCOAT, "0:ability", "a fifth pick is refused ('4 or fewer')", () => {
  const { engine, id } = turncoatBoard();
  refused(
    () => playRaw(engine, P1, id("me"), { selected: { sac: [id("s1"), id("s2")], picks: ["o1", "o2", "o3", "o4", "o5"].map(id) } }),
    "five picks"
  );
  assert.equal(zoneOf(engine, id("me")), "hand");
  assert.equal(zoneOf(engine, id("s1")), "play", "and nothing was destroyed");
});

clause(TURNCOAT, "0:ability", "the pick can be any characters, mine included: picking my own character just leaves it mine", () => {
  const { engine, id } = turncoatBoard();
  play(engine, P1, id("me"), { selected: { sac: [id("s1"), id("s2")], picks: [id("s3"), id("o1")] } });
  assert.equal(controllerOf(engine, id("s3")), P1);
  assert.equal(controllerOf(engine, id("o1")), P1);
  assert.equal(zoneOf(engine, id("s3")), "play");
});

clause(TURNCOAT, "0:ability", "it must destroy exactly 2 of MY characters: one, three, or an opponent's character are refused", () => {
  const { engine, id } = turncoatBoard();
  refused(() => playRaw(engine, P1, id("me"), { selected: { sac: [id("s1")], picks: [id("o1")] } }), "only one");
  refused(() => playRaw(engine, P1, id("me"), { selected: { sac: [id("s1"), id("s2"), id("s3")], picks: [id("o1")] } }), "three");
  refused(() => playRaw(engine, P1, id("me"), { selected: { sac: [id("s1"), id("o2")], picks: [id("o1")] } }), "an opponent's character");
  refused(() => playRaw(engine, P1, id("me"), { selected: { picks: [id("o1")] } }), "none");
  assert.equal(zoneOf(engine, id("me")), "hand");
  for (const key of ["s1", "s2", "s3", "o1", "o2"]) assert.equal(zoneOf(engine, id(key)), "play", `${key} untouched`);
});

clause(TURNCOAT, "0:ability", "with only one character of mine in play the card cannot be played (two must be destroyed)", () => {
  const { engine, id } = handBoard(TURNCOAT, {
    deception: 20,
    extra: [
      { key: "lonely", def: character({ name: "Lonely" }), owner: P1, zone: "play" },
      { key: "o1", def: character({ name: "Foe" }), owner: P2, zone: "play" }
    ]
  });
  refused(() => playRaw(engine, P1, id("me"), { selected: { sac: [id("lonely")], picks: [id("o1")] } }), "one character cannot pay for two", /Target 'sac' requires 2 selection/);
  assert.equal(zoneOf(engine, id("lonely")), "play");
});

clause(TURNCOAT, "0:ability", "the same character cannot be destroyed twice to pay for both", () => {
  const { engine, id } = turncoatBoard();
  refused(() => playRaw(engine, P1, id("me"), { selected: { sac: [id("s1"), id("s1")], picks: [id("o1")] } }), "the same card twice");
  assert.equal(zoneOf(engine, id("s1")), "play");
});

clause(TURNCOAT, "0:ability", "only characters: items, locations, face-down cards and factions cannot be picked", () => {
  const { engine, id } = turncoatBoard({
    extra: [
      { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true }
    ]
  });
  for (const key of ["gear", "place", "hidden"]) {
    refused(() => playRaw(engine, P1, id("me"), { selected: { sac: [id("s1"), id("s2")], picks: [id(key)] } }), `${key} cannot be picked`);
  }
  refused(() => playRaw(engine, P1, id("me"), { selected: { sac: [id("s1"), id("s2")], picks: [factionOf(engine, P2)] } }), "a faction cannot be picked");
  assert.equal(zoneOf(engine, id("s1")), "play");
});

clause(TURNCOAT, "0:ability", "a character destroyed for the cost cannot also be one of the picks (it is gone before the pick)", () => {
  const { engine, id } = turncoatBoard();
  refused(() => playRaw(engine, P1, id("me"), { selected: { sac: [id("s1"), id("s2")], picks: [id("s1")] } }), "s1 is destroyed as a cost");
  assert.equal(zoneOf(engine, id("s1")), "play", "nothing was paid");
});

clause(TURNCOAT, "0:ability", "control is permanent: it survives the end of the turn", () => {
  const { engine, id } = turncoatBoard();
  play(engine, P1, id("me"), { selected: { sac: [id("s1"), id("s2")], picks: [id("o1")] } });
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(controllerOf(engine, id("o1")), P1, "still mine after both turns");
});

clause(TURNCOAT, "0:ability", "the destroy is a COST: both characters are already in the discard pile while the opponent can still respond", () => {
  const { engine, id } = turncoatBoard();
  playRaw(engine, P1, id("me"), { selected: { sac: [id("s1"), id("s2")], picks: [id("o1")] } });
  assert.ok(engine.state.responseWindow, "control: awaiting responses");
  assert.equal(zoneOf(engine, id("s1")), "discard");
  assert.equal(zoneOf(engine, id("s2")), "discard");
  assert.equal(controllerOf(engine, id("o1")), P2, "...but control has not changed yet");
});

clause(TURNCOAT, "0:ability", "pays exactly 13, needs six [D], and is refused one resource short or with Deception below the threshold", () => {
  deployChecks(
    (res) => turncoatBoard({ deception: res.deception, greed: res.greed }),
    13,
    6,
    (id) => ({ sac: [id("s1"), id("s2")], picks: [id("o1")] })
  );
});

// --- Fool's Gold ------------------------------------------------------------------------------
// TRADE -- COST: Pick an item your opponent controls. Pay X, where X is that card's numeric
// cost. Destroy this card. EFFECT: Take control of the item.   Item, rogue, cost 2, threshold [D][D].

const FOOLS_GOLD = "d2ef3385-bff6-42cf-8045-e5568e59efdf";

function goldBoard(opts: { deception?: number; targetCost?: number; extra?: CardPlacement[]; turn?: number; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "fg", def: printing(FOOLS_GOLD), owner: P1, zone: "play" },
      { key: "it", def: item({ name: "TheirItem", cost: opts.targetCost ?? 2 }), owner: P2, zone: "play" },
      { key: "mine", def: item({ name: "MyItem", cost: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", cost: 1 }), owner: P2, zone: "play" },
      ...bank("deception", opts.deception ?? 8, P1),
      ...(opts.extra ?? [])
    ]
  });
}

clause(FOOLS_GOLD, "0:ability:trade", "pays X = the item's numeric cost (2), destroys Fool's Gold, and I take control of the item", () => {
  const { engine, id } = goldBoard({ targetCost: 2 });
  const before = ready(engine);
  activate(engine, P1, id("fg"), "trade", { selected: { pick: [id("it")] } });
  assert.equal(before - ready(engine), 2, "X = 2");
  assert.equal(zoneOf(engine, id("fg")), "discard", "Fool's Gold is destroyed");
  assert.ok(discardOf(engine, P1).includes(id("fg")), "discardOf(engine, P1).includes(id(\"fg\"))");
  assert.equal(controllerOf(engine, id("it")), P1);
  assert.equal(engine.state.cards[id("it")].ownerId, P2, "ownership never changes");
  assert.equal(zoneOf(engine, id("it")), "play");
});

clause(FOOLS_GOLD, "0:ability:trade", "X follows the picked item's cost: 0, 1, 4 and 6 are paid exactly", () => {
  for (const cost of [0, 1, 4, 6]) {
    const { engine, id } = goldBoard({ targetCost: cost, deception: 9 });
    const before = ready(engine);
    activate(engine, P1, id("fg"), "trade", { selected: { pick: [id("it")] } });
    assert.equal(before - ready(engine), cost, `item of cost ${cost}`);
    assert.equal(controllerOf(engine, id("it")), P1, `taken at cost ${cost}`);
  }
});

clause(FOOLS_GOLD, "0:ability:trade", "refused when I cannot pay X: an item of cost 5 with 4 resources; allowed with exactly 5", () => {
  const poor = goldBoard({ targetCost: 5, deception: 4 });
  refused(() => activate(poor.engine, P1, poor.id("fg"), "trade", { selected: { pick: [poor.id("it")] } }), "5 > 4");
  assert.equal(zoneOf(poor.engine, poor.id("fg")), "play", "Fool's Gold is not destroyed by a failed attempt");
  assert.equal(controllerOf(poor.engine, poor.id("it")), P2);
  const exact = goldBoard({ targetCost: 5, deception: 5 });
  activate(exact.engine, P1, exact.id("fg"), "trade", { selected: { pick: [exact.id("it")] } });
  assert.equal(controllerOf(exact.engine, exact.id("it")), P1);
  assert.equal(ready(exact.engine), 0);
});

clause(FOOLS_GOLD, "0:ability:trade", "only an item the OPPONENT controls: my own item, their character and Fool's Gold itself are refused", () => {
  const { engine, id } = goldBoard();
  refused(() => activate(engine, P1, id("fg"), "trade", { selected: { pick: [id("mine")] } }), "my own item");
  refused(() => activate(engine, P1, id("fg"), "trade", { selected: { pick: [id("foe")] } }), "a character");
  refused(() => activate(engine, P1, id("fg"), "trade", { selected: { pick: [id("fg")] } }), "itself");
  refused(() => activate(engine, P1, id("fg"), "trade", { selected: {} }), "a pick is required");
  assert.equal(zoneOf(engine, id("fg")), "play");
  assert.equal(controllerOf(engine, id("mine")), P1);
});

clause(FOOLS_GOLD, "0:ability:trade", "a location or face-down card of the opponent is not an item", () => {
  const { engine, id } = goldBoard({
    extra: [
      { key: "place", def: location({ name: "Place", cost: 1 }), owner: P2, zone: "play" },
      { key: "hidden", def: item({ name: "HiddenItem", cost: 1 }), owner: P2, zone: "play", faceDown: true }
    ]
  });
  refused(() => activate(engine, P1, id("fg"), "trade", { selected: { pick: [id("place")] } }), "a location");
  refused(() => activate(engine, P1, id("fg"), "trade", { selected: { pick: [id("hidden")] } }), "a face-down item is just a resource");
});

clause(FOOLS_GOLD, "0:ability:trade", "an item I own but the opponent controls counts as 'an item your opponent controls'", () => {
  const { engine, id } = goldBoard({ extra: [{ key: "loaned", def: item({ name: "Loaned", cost: 3 }), owner: P1, controller: P2, zone: "play" }] });
  const before = ready(engine);
  activate(engine, P1, id("fg"), "trade", { selected: { pick: [id("loaned")] } });
  assert.equal(before - ready(engine), 3);
  assert.equal(controllerOf(engine, id("loaned")), P1);
});

clause(FOOLS_GOLD, "0:ability:trade", "it takes exactly one item: two picks are refused", () => {
  const { engine, id } = goldBoard({ extra: [{ key: "it2", def: item({ name: "TheirItem2", cost: 1 }), owner: P2, zone: "play" }] });
  refused(() => activate(engine, P1, id("fg"), "trade", { selected: { pick: [id("it"), id("it2")] } }), "one item only");
  assert.equal(controllerOf(engine, id("it")), P2);
  assert.equal(controllerOf(engine, id("it2")), P2);
});

clause(FOOLS_GOLD, "0:ability:trade", "the destroy is a COST: Fool's Gold is already in the discard pile while the opponent can still respond", () => {
  const { engine, id } = goldBoard();
  activateRaw(engine, P1, id("fg"), "trade", { pick: [id("it")] });
  assert.ok(engine.state.responseWindow, "control: awaiting responses");
  assert.equal(zoneOf(engine, id("fg")), "discard");
  assert.equal(controllerOf(engine, id("it")), P2, "control has not changed yet");
});

clause(FOOLS_GOLD, "0:ability:trade", "the payment is a cost too: the resources are already spent while the opponent can still respond", () => {
  const { engine, id } = goldBoard({ targetCost: 3 });
  const before = ready(engine);
  activateRaw(engine, P1, id("fg"), "trade", { pick: [id("it")] });
  assert.equal(before - ready(engine), 3);
  assert.ok(engine.state.responseWindow, "engine.state.responseWindow");
});

clause(FOOLS_GOLD, "0:ability:trade", "usable on the opponent's turn in response to something: I take the item then", () => {
  const { engine, id } = goldBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "attacker", def: character({ name: "Attacker", life: 9 }), owner: P2, zone: "play" }]
  });
  openDefenderWindow(engine, id("attacker"));
  activateRaw(engine, P1, id("fg"), "trade", { pick: [id("it")] });
  resolvePendingResponses(engine);
  assert.equal(controllerOf(engine, id("it")), P1);
});

clause(FOOLS_GOLD, "0:ability:trade", "pays exactly 2 to deploy, needs [D][D], and has no stats of its own", () => {
  const exact = deployChecks((res) => handBoard(FOOLS_GOLD, { deception: res.deception, greed: res.greed }), 2, 2);
  assert.equal(zoneOf(exact.engine, exact.id("me")), "play");
});

// --- Forcible Depredator -------------------------------------------------------------------------
// PLUNDER -- COST: Pay 2. Discard a card. Deplete this card. EFFECT: Put the top 3 cards of your
// opponent's deck into their discard pile.   Character, rogue, cost 5, threshold [D][D], 3/3/3.

const DEPREDATOR = "a1716f04-f2d4-454f-917f-0b55eb9fbb73";

function depredatorBoard(opts: { deception?: number; oppDeck?: number; hand?: number; depleted?: boolean; turn?: number; active?: Pid; extra?: CardPlacement[]; eligible?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "fd", def: printing(DEPREDATOR), owner: P1, zone: "play", depleted: opts.depleted, attackEligible: opts.eligible },
      ...fillers("h", opts.hand ?? 2, P1, "hand"),
      ...deckOfFillers("m", 4, P1),
      ...deckOfFillers("o", opts.oppDeck ?? 6, P2),
      ...fillers("oh", 2, P2, "hand"),
      ...bank("deception", opts.deception ?? 6, P1),
      ...(opts.extra ?? [])
    ]
  });
}

clause(DEPREDATOR, "0:ability:plunder", "the top 3 cards of the opponent's deck go to their discard pile, in order; the rest of their deck stays", () => {
  const { engine, id } = depredatorBoard();
  const oppDeck = [...deckOf(engine, P2)];
  activate(engine, P1, id("fd"), "plunder", { selected: { d: [id("h0")] } });
  assert.deepEqual([...discardOf(engine, P2)].sort(), oppDeck.slice(0, 3).sort(), "exactly the top 3");
  assert.deepEqual(deckOf(engine, P2), oppDeck.slice(3), "the rest of the deck is untouched and in order");
  for (const cardId of oppDeck.slice(0, 3)) assert.equal(engine.state.cards[cardId].zone, "discard");
});

clause(DEPREDATOR, "0:ability:plunder", "the cost: pays exactly 2, discards the chosen card from my hand to my discard pile, and depletes Forcible Depredator", () => {
  const { engine, id } = depredatorBoard();
  const before = ready(engine);
  activate(engine, P1, id("fd"), "plunder", { selected: { d: [id("h1")] } });
  assert.equal(before - ready(engine), 2, "pay 2");
  assert.equal(zoneOf(engine, id("h1")), "discard", "the chosen card was discarded");
  assert.ok(discardOf(engine, P1).includes(id("h1")), "into my discard pile");
  assert.equal(zoneOf(engine, id("h0")), "hand", "the other card in hand stays");
  assert.equal(isDepleted(engine, id("fd")), true, "this card is depleted");
});

clause(DEPREDATOR, "0:ability:plunder", "the costs are paid when it is activated, before the opponent can respond", () => {
  const { engine, id } = depredatorBoard();
  const before = ready(engine);
  const oppDiscard = discardOf(engine, P2).length;
  activateRaw(engine, P1, id("fd"), "plunder", { d: [id("h0")] });
  assert.ok(engine.state.responseWindow, "control: awaiting responses");
  assert.equal(before - ready(engine), 2);
  assert.equal(zoneOf(engine, id("h0")), "discard");
  assert.equal(isDepleted(engine, id("fd")), true);
  assert.equal(discardOf(engine, P2).length, oppDiscard, "the effect (the mill) has not happened yet");
});

clause(DEPREDATOR, "0:ability:plunder", "only the opponent's deck is milled: my deck and both hands are untouched", () => {
  const { engine, id } = depredatorBoard();
  const myDeck = [...deckOf(engine, P1)];
  const oppHand = [...handOf(engine, P2)];
  activate(engine, P1, id("fd"), "plunder", { selected: { d: [id("h0")] } });
  assert.deepEqual(deckOf(engine, P1), myDeck);
  assert.deepEqual(handOf(engine, P2), oppHand);
  assert.equal(discardOf(engine, P1).length, 1, "only the card I discarded");
});

clause(DEPREDATOR, "0:ability:plunder", "refused with fewer than 2 resources; allowed with exactly 2", () => {
  const poor = depredatorBoard({ deception: 1 });
  refused(() => activate(poor.engine, P1, poor.id("fd"), "plunder", { selected: { d: [poor.id("h0")] } }), "cannot pay 2");
  assert.equal(zoneOf(poor.engine, poor.id("h0")), "hand", "the discard was not paid");
  assert.equal(isDepleted(poor.engine, poor.id("fd")), false);
  const exact = depredatorBoard({ deception: 2 });
  activate(exact.engine, P1, exact.id("fd"), "plunder", { selected: { d: [exact.id("h0")] } });
  assert.equal(discardOf(exact.engine, P2).length, 3);
});

clause(DEPREDATOR, "0:ability:plunder", "a card must be discarded: refused with no discard chosen, or with an empty hand", () => {
  const none = depredatorBoard();
  refused(() => activate(none.engine, P1, none.id("fd"), "plunder", { selected: {} }), "no discard chosen");
  assert.equal(discardOf(none.engine, P2).length, 0);
  const emptyHand = depredatorBoard({ hand: 0 });
  refused(() => activate(emptyHand.engine, P1, emptyHand.id("fd"), "plunder", { selected: {} }), "nothing to discard");
  assert.equal(isDepleted(emptyHand.engine, emptyHand.id("fd")), false);
});

clause(DEPREDATOR, "0:ability:plunder", "the discard must be from MY hand: the opponent's hand, my deck and a card in play are refused; exactly one card", () => {
  const { engine, id } = depredatorBoard();
  refused(() => activate(engine, P1, id("fd"), "plunder", { selected: { d: [id("oh0")] } }), "the opponent's hand");
  refused(() => activate(engine, P1, id("fd"), "plunder", { selected: { d: [id("m0")] } }), "my deck");
  refused(() => activate(engine, P1, id("fd"), "plunder", { selected: { d: [id("fd")] } }), "a card in play");
  refused(() => activate(engine, P1, id("fd"), "plunder", { selected: { d: [id("h0"), id("h1")] } }), "two cards");
  assert.equal(zoneOf(engine, id("oh0")), "hand");
  assert.equal(zoneOf(engine, id("h0")), "hand");
  assert.equal(zoneOf(engine, id("h1")), "hand");
});

clause(DEPREDATOR, "0:ability:plunder", "an already depleted Depredator cannot pay the deplete cost", () => {
  const { engine, id } = depredatorBoard({ depleted: true });
  refused(() => activate(engine, P1, id("fd"), "plunder", { selected: { d: [id("h0")] } }), "already depleted");
  assert.equal(zoneOf(engine, id("h0")), "hand");
  assert.equal(discardOf(engine, P2).length, 0);
});

clause(DEPREDATOR, "0:ability:plunder", "once per untap: a second use the same turn is refused; after my next turn starts it can be used again", () => {
  const { engine, id } = depredatorBoard({ hand: 3, oppDeck: 9 });
  activate(engine, P1, id("fd"), "plunder", { selected: { d: [id("h0")] } });
  refused(() => activate(engine, P1, id("fd"), "plunder", { selected: { d: [id("h1")] } }), "depleted until restored");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(isDepleted(engine, id("fd")), false, "restored at the start of my turn");
  activate(engine, P1, id("fd"), "plunder", { selected: { d: [id("h1")] } });
  assert.equal(discardOf(engine, P2).length, 6, "3 + 3");
});

clause(DEPREDATOR, "0:ability:plunder", "an opponent's deck of fewer than 3 cards is emptied; an empty deck is harmless", () => {
  const two = depredatorBoard({ oppDeck: 2 });
  activate(two.engine, P1, two.id("fd"), "plunder", { selected: { d: [two.id("h0")] } });
  assert.equal(deckOf(two.engine, P2).length, 0);
  assert.equal(discardOf(two.engine, P2).length, 2);
  const none = depredatorBoard({ oppDeck: 0 });
  activate(none.engine, P1, none.id("fd"), "plunder", { selected: { d: [none.id("h0")] } });
  assert.equal(discardOf(none.engine, P2).length, 0);
  assert.equal(pending(none.engine), undefined);
});

clause(DEPREDATOR, "0:ability:plunder", "an ability may be used the turn the character enters play (summoning sickness only stops attacking)", () => {
  const { engine, id } = depredatorBoard({ eligible: false });
  activate(engine, P1, id("fd"), "plunder", { selected: { d: [id("h0")] } });
  assert.equal(discardOf(engine, P2).length, 3);
});

clause(DEPREDATOR, "0:ability:plunder", "usable on the opponent's turn in response", () => {
  const { engine, id } = depredatorBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "attacker", def: character({ name: "Attacker", life: 9 }), owner: P2, zone: "play" }]
  });
  openDefenderWindow(engine, id("attacker"));
  activateRaw(engine, P1, id("fd"), "plunder", { d: [id("h0")] });
  resolvePendingResponses(engine);
  assert.equal(discardOf(engine, P2).length, 3);
});

clause(DEPREDATOR, "0:ability:plunder", "the opponent cannot use it", () => {
  const { engine, id } = depredatorBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "attacker", def: character({ name: "Attacker", life: 9 }), owner: P2, zone: "play" }, ...bank("deception", 4, P2)]
  });
  openDefenderWindow(engine, id("attacker"));
  refused(() => activateRaw(engine, P2, id("fd"), "plunder", { d: [id("oh0")] }), "P2 does not control it");
  assert.equal(discardOf(engine, P1).length, 0);
});

clause(DEPREDATOR, "0:ability:plunder", "pays exactly 5, needs [D][D], and has the printed 3/3/3 stats", () => {
  const exact = deployChecks((res) => handBoard(DEPREDATOR, { deception: res.deception, greed: res.greed }), 5, 2);
  assert.equal(zoneOf(exact.engine, exact.id("me")), "play");
  assert.deepEqual(stats(exact.engine, exact.id("me")), [3, 3, 3]);
});

// --- Fwing! ---------------------------------------------------------------------------------------
// COST: Pick a character. EFFECT: This turn, the character gains 1 speed. Flip a coin. If you
// win, the character also gains 1 strength this turn.   Tactic, rogue, cost 2, threshold [D].

const FWING = "e3d4cdea-9072-43f9-945d-e651067608d2";

function fwingBoard(opts: HandOpts = {}) {
  return handBoard(FWING, {
    ...opts,
    extra: [
      { key: "c", def: character({ name: "Pickee", strength: 2, life: 4, speed: 3 }), owner: P1, zone: "play" },
      { key: "d", def: character({ name: "Other", strength: 2, life: 4, speed: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 3 }), owner: P2, zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}

clause(FWING, "0:ability", "the picked character gains exactly 1 speed this turn (whatever the coin does)", () => {
  for (const random of [WIN, LOSE]) {
    const { engine, id } = fwingBoard({ random });
    play(engine, P1, id("me"), { selected: { pick: [id("c")] } });
    assert.equal(engine.getStat(id("c"), "speed"), 4);
    assert.equal(engine.getStat(id("c"), "life"), 4, "life untouched");
  }
});

clause(FWING, "0:ability", "winning the coin flip: the character also gains 1 strength this turn", () => {
  const { engine, id } = fwingBoard({ random: WIN });
  play(engine, P1, id("me"), { selected: { pick: [id("c")] } });
  assert.deepEqual(coinFlips(engine), [{ playerId: P1, won: true }], "I flipped, once, and won");
  assert.equal(engine.getStat(id("c"), "strength"), 3);
  assert.equal(engine.getStat(id("c"), "speed"), 4);
});

clause(FWING, "0:ability", "losing the coin flip: no extra strength (only the speed)", () => {
  const { engine, id } = fwingBoard({ random: LOSE });
  play(engine, P1, id("me"), { selected: { pick: [id("c")] } });
  assert.deepEqual(coinFlips(engine), [{ playerId: P1, won: false }]);
  assert.equal(engine.getStat(id("c"), "strength"), 2);
  assert.equal(engine.getStat(id("c"), "speed"), 4);
});

clause(FWING, "0:ability", "only the picked character: another of mine and an opponent's character are unchanged", () => {
  const { engine, id } = fwingBoard({ random: WIN });
  play(engine, P1, id("me"), { selected: { pick: [id("c")] } });
  for (const key of ["d", "foe"]) assert.deepEqual(stats(engine, id(key)), [2, 4, 3], key);
});

clause(FWING, "0:ability", "the pick may be an opponent's character (the card says 'a character'): it gets the speed and, on a win, the strength", () => {
  const { engine, id } = fwingBoard({ random: WIN });
  play(engine, P1, id("me"), { selected: { pick: [id("foe")] } });
  assert.deepEqual(stats(engine, id("foe")), [3, 4, 4]);
  assert.deepEqual(stats(engine, id("c")), [2, 4, 3]);
});

clause(FWING, "0:ability", "the coin is flipped when the tactic resolves, not when it is played", () => {
  const { engine, id } = fwingBoard({ random: WIN });
  playRaw(engine, P1, id("me"), { selected: { pick: [id("c")] } });
  assert.equal(coinFlips(engine).length, 0, "no flip while the opponent can still respond");
  resolvePendingResponses(engine);
  assert.equal(coinFlips(engine).length, 1);
});

clause(FWING, "0:ability", "'this turn': both gains end with the turn", () => {
  const { engine, id } = fwingBoard({ random: WIN });
  play(engine, P1, id("me"), { selected: { pick: [id("c")] } });
  assert.deepEqual(stats(engine, id("c")), [3, 4, 4]);
  endTurn(engine, P1);
  assert.deepEqual(stats(engine, id("c")), [2, 4, 3], "gone when the turn ends");
  endTurn(engine, P2);
  assert.deepEqual(stats(engine, id("c")), [2, 4, 3]);
});

clause(FWING, "0:ability", "played on the opponent's turn the gains last until the end of THAT turn", () => {
  const { engine, id } = fwingBoard({
    random: WIN,
    turn: 2,
    active: P2,
    extra: [{ key: "attacker", def: character({ name: "Attacker", life: 9 }), owner: P2, zone: "play" }]
  });
  openDefenderWindow(engine, id("attacker"));
  playRaw(engine, P1, id("me"), { selected: { pick: [id("c")] } });
  resolvePendingResponses(engine);
  assert.deepEqual(stats(engine, id("c")), [3, 4, 4]);
});

clause(FWING, "0:ability", "two Fwing! on one character stack: +2 speed", () => {
  const { engine, id } = fwingBoard({ random: LOSE, extra: [{ key: "me2", def: printing(FWING), owner: P1, zone: "hand" }] });
  play(engine, P1, id("me"), { selected: { pick: [id("c")] } });
  play(engine, P1, id("me2"), { selected: { pick: [id("c")] } });
  assert.equal(engine.getStat(id("c"), "speed"), 5);
});

clause(FWING, "0:ability", "the extra speed matters in battle: a speed-1 attacker with 3 strength kills a speed-1, 3-life blocker first and survives", () => {
  const board = (withFwing: boolean) =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      random: LOSE,
      turn: 2,
      activePlayerId: P1,
      cards: [
        { key: "me", def: printing(FWING), owner: P1, zone: "hand" },
        { key: "atk", def: character({ name: "Attacker", strength: 3, life: 1, speed: 1 }), owner: P1, zone: "play" },
        { key: "blk", def: character({ name: "Blocker", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
        ...bank("deception", 4, P1)
      ]
    });
  const slow = board(false);
  fight(slow.engine, P1, [slow.id("atk")], { type: "faction", playerId: P2 }, [slow.id("blk")]);
  assert.equal(zoneOf(slow.engine, slow.id("atk")), "discard", "control: at equal speed they strike together and the 1-life attacker dies");
  assert.equal(zoneOf(slow.engine, slow.id("blk")), "discard");

  const fast = board(true);
  play(fast.engine, P1, fast.id("me"), { selected: { pick: [fast.id("atk")] } });
  fight(fast.engine, P1, [fast.id("atk")], { type: "faction", playerId: P2 }, [fast.id("blk")]);
  assert.equal(zoneOf(fast.engine, fast.id("blk")), "discard", "the blocker died");
  assert.equal(zoneOf(fast.engine, fast.id("atk")), "play", "the faster attacker struck first and was never hit");
});

clause(FWING, "0:ability", "the pick must be a character: an item, a location, a face-down card and a faction are refused", () => {
  const { engine, id } = fwingBoard({
    extra: [
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true }
    ]
  });
  for (const key of ["gear", "place", "hidden"]) refused(() => playRaw(engine, P1, id("me"), { selected: { pick: [id(key)] } }), `${key} cannot be picked`);
  refused(() => playRaw(engine, P1, id("me"), { selected: { pick: [factionOf(engine, P2)] } }), "a faction");
  refused(() => playRaw(engine, P1, id("me"), { selected: {} }), "a pick is required");
  assert.equal(zoneOf(engine, id("me")), "hand");
});

clause(FWING, "0:ability", "exactly one character: two picks are refused", () => {
  const { engine, id } = fwingBoard();
  refused(() => playRaw(engine, P1, id("me"), { selected: { pick: [id("c"), id("d")] } }), "'a character'");
  assert.equal(zoneOf(engine, id("me")), "hand");
});

clause(FWING, "0:ability", "pays exactly 2, needs [D], and is refused one resource short or without the threshold", () => {
  deployChecks((res) => fwingBoard({ deception: res.deception, greed: res.greed }), 2, 1, (id) => ({ pick: [id("c")] }));
});

clause(FWING, "0:ability", "the tactic ends in my discard pile", () => {
  const { engine, id } = fwingBoard({ random: WIN });
  play(engine, P1, id("me"), { selected: { pick: [id("c")] } });
  assert.equal(zoneOf(engine, id("me")), "discard");
});

// --- Gang Leader -------------------------------------------------------------------------------------
// When this card enters play, all your characters gain 1 speed this turn.
// Character, rogue, cost 3, threshold [D][D], 2/2/3.

const GANG_LEADER = "7c184d94-6d66-4d27-947d-87e6bb03d997";

function leaderBoard(opts: HandOpts = {}) {
  return handBoard(GANG_LEADER, {
    ...opts,
    extra: [
      { key: "a", def: character({ name: "Ally1", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "b", def: character({ name: "Ally2", strength: 2, life: 3, speed: 5 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}

clause(GANG_LEADER, "0:rule", "when it enters play every character I control gains exactly 1 speed", () => {
  const { engine, id } = leaderBoard();
  play(engine, P1, id("me"));
  assert.equal(engine.getStat(id("a"), "speed"), 3);
  assert.equal(engine.getStat(id("b"), "speed"), 6);
});

clause(GANG_LEADER, "0:rule", "...including the Gang Leader itself (it is one of my characters when it enters play): speed 3 -> 4", () => {
  const { engine, id } = leaderBoard();
  play(engine, P1, id("me"));
  assert.equal(zoneOf(engine, id("me")), "play");
  assert.equal(engine.getStat(id("me"), "speed"), 4);
});

clause(GANG_LEADER, "0:rule", "only speed: strength and life of my characters are unchanged", () => {
  const { engine, id } = leaderBoard();
  play(engine, P1, id("me"));
  assert.deepEqual(stats(engine, id("a")).slice(0, 2), [2, 3]);
  assert.deepEqual(stats(engine, id("b")).slice(0, 2), [2, 3]);
  assert.deepEqual(stats(engine, id("me")).slice(0, 2), [2, 2]);
});

clause(GANG_LEADER, "0:rule", "the opponent's characters gain nothing ('all YOUR characters')", () => {
  const { engine, id } = leaderBoard();
  play(engine, P1, id("me"));
  assert.deepEqual(stats(engine, id("foe")), [2, 3, 2]);
});

clause(GANG_LEADER, "0:rule", "'this turn': the speed bonus ends with the turn", () => {
  const { engine, id } = leaderBoard();
  play(engine, P1, id("me"));
  endTurn(engine, P1);
  assert.equal(engine.getStat(id("a"), "speed"), 2);
  assert.equal(engine.getStat(id("me"), "speed"), 3);
  endTurn(engine, P2);
  assert.equal(engine.getStat(id("a"), "speed"), 2);
});

clause(GANG_LEADER, "0:rule", "a character that enters play later this turn does not get the bonus (it is not a character 'in play' when the Leader entered)", () => {
  const { engine, id } = leaderBoard({ extra: [{ key: "late", def: character({ name: "Late", cost: 1, speed: 2 }), owner: P1, zone: "hand" }] });
  play(engine, P1, id("me"));
  play(engine, P1, id("late"));
  assert.equal(zoneOf(engine, id("late")), "play");
  assert.equal(engine.getStat(id("late"), "speed"), 2);
});

clause(GANG_LEADER, "0:rule", "it fires when the Leader itself enters play, not when another card does: my other character entering play gives nothing", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "gl", def: printing(GANG_LEADER), owner: P1, zone: "play" },
      { key: "late", def: character({ name: "Late", cost: 1, speed: 2 }), owner: P1, zone: "hand" },
      ...bank("deception", 2, P1)
    ]
  });
  assert.equal(engine.getStat(id("gl"), "speed"), 3);
  play(engine, P1, id("late"));
  assert.equal(engine.getStat(id("gl"), "speed"), 3, "no trigger from another card");
  assert.equal(engine.getStat(id("late"), "speed"), 2);
});

clause(GANG_LEADER, "0:rule", "an opponent's Gang Leader entering play speeds up THEIR characters only", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "gl", def: printing(GANG_LEADER), owner: P2, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", speed: 2 }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Theirs", speed: 2 }), owner: P2, zone: "play" },
      ...bank("deception", 4, P2)
    ]
  });
  play(engine, P2, id("gl"));
  assert.equal(engine.getStat(id("theirs"), "speed"), 3);
  assert.equal(engine.getStat(id("mine"), "speed"), 2);
});

clause(GANG_LEADER, "0:rule", "the bonus is real in battle: a speed-1 attacker with 3 strength strikes first against a speed-1 blocker", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "gl", def: printing(GANG_LEADER), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Attacker", strength: 3, life: 1, speed: 1 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blocker", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
      ...bank("deception", 4, P1)
    ]
  });
  play(engine, P1, id("gl"));
  fight(engine, P1, [id("atk")], { type: "faction", playerId: P2 }, [id("blk")]);
  assert.equal(zoneOf(engine, id("blk")), "discard");
  assert.equal(zoneOf(engine, id("atk")), "play", "speed 2 beat the blocker's speed 1");
});

clause(GANG_LEADER, "0:rule", "pays exactly 3, needs [D][D], and has the printed 2/2/3 stats", () => {
  const exact = deployChecks((res) => leaderBoard({ deception: res.deception, greed: res.greed }), 3, 2);
  assert.equal(zoneOf(exact.engine, exact.id("me")), "play");
  assert.deepEqual(stats(exact.engine, exact.id("me")).slice(0, 2), [2, 2]);
});

// --- Hasty Sarcophyle ---------------------------------------------------------------------------------
// (no rules text)   Character, rogue, subtype sarcophyle, cost 5, threshold [D][D], 3/3/5.

const HASTY = "8bb9e0ba-178d-43d3-ae6e-0f5a57a43e8d";

clause(HASTY, "vanilla", "deploys for exactly 5, needs [D][D], and is refused one short or with Deception below the threshold", () => {
  const exact = deployChecks((res) => handBoard(HASTY, { deception: res.deception, greed: res.greed }), 5, 2);
  assert.equal(zoneOf(exact.engine, exact.id("me")), "play");
});

clause(HASTY, "vanilla", "has its printed stats 3 strength / 3 life / 5 speed in play, and is a sarcophyle character with no abilities", () => {
  const { engine, id } = buildGame({ cards: [{ key: "hs", def: printing(HASTY), owner: P1, zone: "play" }] });
  assert.deepEqual(stats(engine, id("hs")), [3, 3, 5]);
  const def = printing(HASTY);
  assert.equal(def.type, "character");
  assert.deepEqual(def.subtype, ["sarcophyle"]);
  assert.deepEqual(keywordsOf(engine, id("hs")), [], "no keywords");
  assert.deepEqual(engine.getAvailableActivatedAbilities(P1).filter((a) => a.cardId === id("hs")), [], "no abilities");
});

clause(HASTY, "vanilla", "nothing happens when it enters play: no prompts, no coin flips, no stat changes", () => {
  const { engine, id } = handBoard(HASTY, { deception: 6, extra: [{ key: "ally", def: character({ name: "Ally", speed: 2 }), owner: P1, zone: "play" }] });
  play(engine, P1, id("me"));
  assert.equal(pending(engine), undefined);
  assert.equal(coinFlips(engine).length, 0);
  assert.equal(engine.getStat(id("ally"), "speed"), 2);
  assert.equal(isDepleted(engine, id("me")), false);
});

clause(HASTY, "vanilla", "its speed of 5 orders battle damage: it strikes before a speed-3 blocker", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "hs", def: printing(HASTY), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blocker", strength: 9, life: 3, speed: 3 }), owner: P2, zone: "play" }
    ]
  });
  fight(engine, P1, [id("hs")], { type: "faction", playerId: P2 }, [id("blk")]);
  assert.equal(zoneOf(engine, id("blk")), "discard", "3 strength kills the 3-life blocker first");
  assert.equal(zoneOf(engine, id("hs")), "play", "and it was never hit");
});

// --- Hollow Moose -----------------------------------------------------------------------------------
// This card enters play under your opponent's control. -- At the start of your turn, your faction
// loses 1 influence. -- INFILTRATE -- COST: Destroy another item or character you control.
// EFFECT: Your opponent takes control of this card.   Item, rogue, cost 0, threshold [D][D].

const MOOSE = "9fb327c0-257b-4685-98ca-de282c1dc6d7";

interface MooseOpts {
  /** Who controls the Moose in play (default P2: it was deployed by P1). */
  controller?: Pid;
  owner?: Pid;
  zone?: "play" | "hand" | "discard";
  turn?: number;
  active?: Pid;
  influenceP1?: number;
  influenceP2?: number;
  extra?: CardPlacement[];
}

function mooseBoard(opts: MooseOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: opts.influenceP1 ?? 30 },
    playerB: { faction: developFaction(), influence: opts.influenceP2 ?? 30 },
    turn: opts.turn ?? 2,
    activePlayerId: opts.active ?? P2,
    cards: [
      { key: "moose", def: printing(MOOSE), owner: opts.owner ?? P1, controller: opts.controller ?? P2, zone: opts.zone ?? "play" },
      ...deckOfFillers("m", 4, P1),
      ...deckOfFillers("o", 4, P2),
      ...(opts.extra ?? [])
    ]
  });
}

const sacItem = (owner: Pid, key = "sacItem", controller?: Pid): CardPlacement => ({ key, def: item({ name: `Sac ${key}` }), owner, controller, zone: "play" });
const sacChar = (owner: Pid, key = "sacChar", controller?: Pid): CardPlacement => ({ key, def: character({ name: `Sac ${key}` }), owner, controller, zone: "play" });

const putIntoPlayTactic = (): CardDefinition =>
  tactic({
    name: "PutIn",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "p",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", owner: "self" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });

clause(MOOSE, "0:rule", "deployed by me, it enters play under MY OPPONENT's control (I still own it)", () => {
  const { engine, id } = handBoard(MOOSE, { deception: 2 });
  play(engine, P1, id("me"));
  assert.equal(zoneOf(engine, id("me")), "play");
  assert.equal(controllerOf(engine, id("me")), P2);
  assert.equal(engine.state.cards[id("me")].ownerId, P1);
  assert.ok(engine.state.players[P2].play.includes(id("me")), "it is in the opponent's play area");
  assert.equal(engine.state.players[P1].play.includes(id("me")), false);
});

clause(MOOSE, "0:rule", "deployed by the opponent, it enters play under MY control", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [{ key: "moose", def: printing(MOOSE), owner: P2, zone: "hand" }, ...bank("deception", 2, P2)]
  });
  play(engine, P2, id("moose"));
  assert.equal(zoneOf(engine, id("moose")), "play");
  assert.equal(controllerOf(engine, id("moose")), P1, "the deployer's opponent controls it");
  assert.equal(engine.state.cards[id("moose")].ownerId, P2);
});

clause(MOOSE, "0:rule", "it enters play under the opponent's control however it enters: put into play by an effect it is still theirs", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "moose", def: printing(MOOSE), owner: P1, zone: "hand" },
      { key: "putin", def: putIntoPlayTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("putin"), { selected: { t: [id("moose")] } });
  assert.equal(zoneOf(engine, id("moose")), "play");
  assert.equal(controllerOf(engine, id("moose")), P2);
});

clause(MOOSE, "0:rule", "it is not under their control before it enters play (hand) and the opponent cannot use it from my hand", () => {
  const { engine, id } = mooseBoard({ zone: "hand", controller: P1 });
  assert.equal(controllerOf(engine, id("moose")), P1);
  assert.equal(zoneOf(engine, id("moose")), "hand");
});

clause(MOOSE, "0:rule", "costs nothing (cost 0) but still needs [D][D]: refused with one Deception, fine with two", () => {
  const exact = deployChecks((res) => handBoard(MOOSE, { deception: res.deception, greed: res.greed }), 0, 2);
  assert.equal(zoneOf(exact.engine, exact.id("me")), "play");
  assert.equal(ready(exact.engine), 2, "nothing was spent");
});

clause(MOOSE, "1:rule", "at the start of the CONTROLLER's turn their faction loses exactly 1 influence (30 -> 29)", () => {
  const { engine } = mooseBoard({ turn: 1, active: P1 });
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2, "control: P2's turn began");
  assert.equal(influence(engine, P2), 29);
  assert.equal(influence(engine, P1), 30, "the owner's faction is unaffected");
});

clause(MOOSE, "1:rule", "...and not at the start of the OWNER's turn while the opponent controls it", () => {
  const { engine } = mooseBoard({ turn: 2, active: P2 });
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1, "control: P1's turn began");
  assert.equal(influence(engine, P1), 30);
  assert.equal(influence(engine, P2), 30);
});

clause(MOOSE, "1:rule", "once per own turn: three of the controller's turns cost 3 influence", () => {
  const { engine } = mooseBoard({ turn: 1, active: P1 });
  for (let i = 0; i < 3; i++) {
    endTurn(engine, P1);
    endTurn(engine, P2);
  }
  assert.equal(influence(engine, P2), 27);
  assert.equal(influence(engine, P1), 30);
});

clause(MOOSE, "1:rule", "it is the controller's turn that counts: when I control the Moose it drains ME at the start of my turn, not them", () => {
  const { engine } = mooseBoard({ controller: P1, owner: P2, turn: 2, active: P2 });
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(influence(engine, P1), 29);
  assert.equal(influence(engine, P2), 30);
});

clause(MOOSE, "1:rule", "two Moose under the same controller drain 2 per turn", () => {
  const { engine } = mooseBoard({ turn: 1, active: P1, extra: [{ key: "moose2", def: printing(MOOSE), owner: P1, controller: P2, zone: "play" }] });
  endTurn(engine, P1);
  drain(engine, declineAll); // two copies of the same trigger: the controller orders them
  assert.equal(influence(engine, P2), 28);
});

clause(MOOSE, "1:rule", "a Moose in hand or in the discard pile drains nobody", () => {
  for (const zone of ["hand", "discard"] as const) {
    const { engine } = mooseBoard({ zone, controller: P1, turn: 1, active: P1 });
    endTurn(engine, P1);
    endTurn(engine, P2);
    assert.equal(influence(engine, P1), 30, `in ${zone}: P1`);
    assert.equal(influence(engine, P2), 30, `in ${zone}: P2`);
  }
});

clause(MOOSE, "1:rule", "it is an influence LOSS, not damage: it is not reduced by a damage shield", () => {
  const shield = item({
    name: "Shield",
    behavior: { abilities: [{ id: "s", type: "continuous", modifiers: [], damageModifiers: [{ selector: { type: "faction", controller: "self" }, delta: -5 }] }] }
  });
  const { engine } = mooseBoard({ turn: 1, active: P1, extra: [{ key: "shield", def: shield, owner: P2, zone: "play" }] });
  endTurn(engine, P1);
  assert.equal(influence(engine, P2), 29, "still loses exactly 1");
});

clause(MOOSE, "1:rule", "a faction at 1 influence loses the game when the Moose drains it to 0", () => {
  const { engine } = mooseBoard({ turn: 1, active: P1, influenceP2: 1 });
  endTurn(engine, P1);
  assert.equal(influence(engine, P2), 0);
  assert.equal(engine.state.winner, P1, "P2's faction is at 0 influence: P1 wins");
});

clause(MOOSE, "2:ability:infiltrate", "destroys another item I control (to its owner's discard pile) and the opponent takes control of the Moose", () => {
  const { engine, id } = mooseBoard({ extra: [sacItem(P2)] });
  activate(engine, P2, id("moose"), "infiltrate", { selected: { sac: [id("sacItem")] } });
  assert.equal(zoneOf(engine, id("sacItem")), "discard");
  assert.ok(discardOf(engine, P2).includes(id("sacItem")), "discardOf(engine, P2).includes(id(\"sacItem\"))");
  assert.equal(controllerOf(engine, id("moose")), P1, "passed to the opponent of the old controller");
  assert.equal(zoneOf(engine, id("moose")), "play", "the Moose stays in play");
});

clause(MOOSE, "2:ability:infiltrate", "...or another CHARACTER I control", () => {
  const { engine, id } = mooseBoard({ extra: [sacChar(P2)] });
  activate(engine, P2, id("moose"), "infiltrate", { selected: { sac: [id("sacChar")] } });
  assert.equal(zoneOf(engine, id("sacChar")), "discard");
  assert.equal(controllerOf(engine, id("moose")), P1);
});

clause(MOOSE, "2:ability:infiltrate", "'another': the Moose cannot destroy itself to pay", () => {
  const { engine, id } = mooseBoard({ extra: [sacItem(P2)] });
  refused(() => activate(engine, P2, id("moose"), "infiltrate", { selected: { sac: [id("moose")] } }), "it is not 'another' item");
  assert.equal(zoneOf(engine, id("moose")), "play");
  assert.equal(controllerOf(engine, id("moose")), P2);
});

clause(MOOSE, "2:ability:infiltrate", "only an item or character I control: not the opponent's, a location, a face-down card or a tactic", () => {
  const { engine, id } = mooseBoard({
    extra: [
      sacItem(P1, "theirsItem"),
      sacChar(P1, "theirsChar"),
      sacItem(P2),
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true }
    ]
  });
  for (const key of ["theirsItem", "theirsChar", "place", "hidden"]) {
    refused(() => activate(engine, P2, id("moose"), "infiltrate", { selected: { sac: [id(key)] } }), `${key} cannot be destroyed for the cost`);
  }
  assert.equal(controllerOf(engine, id("moose")), P2);
  assert.equal(zoneOf(engine, id("theirsItem")), "play");
  activate(engine, P2, id("moose"), "infiltrate", { selected: { sac: [id("sacItem")] } });
  assert.equal(controllerOf(engine, id("moose")), P1, "control: the legal pick works");
});

clause(MOOSE, "2:ability:infiltrate", "with nothing else to destroy it cannot be used", () => {
  const { engine, id } = mooseBoard();
  refused(() => activate(engine, P2, id("moose"), "infiltrate", { selected: {} }), "no other item or character");
  assert.equal(controllerOf(engine, id("moose")), P2);
});

clause(MOOSE, "2:ability:infiltrate", "exactly one card is destroyed: two picks are refused", () => {
  const { engine, id } = mooseBoard({ extra: [sacItem(P2, "one"), sacChar(P2, "two")] });
  refused(() => activate(engine, P2, id("moose"), "infiltrate", { selected: { sac: [id("one"), id("two")] } }), "one card");
  assert.equal(zoneOf(engine, id("one")), "play");
  assert.equal(zoneOf(engine, id("two")), "play");
});

clause(MOOSE, "2:ability:infiltrate", "only its controller can use it: the owner, who does not control it, cannot", () => {
  const { engine, id } = mooseBoard({ turn: 1, active: P1, extra: [sacItem(P1, "mineItem"), sacChar(P1, "mineChar")] });
  refused(() => activate(engine, P1, id("moose"), "infiltrate", { selected: { sac: [id("mineItem")] } }), "P1 does not control the Moose");
  assert.equal(zoneOf(engine, id("mineItem")), "play");
  assert.equal(controllerOf(engine, id("moose")), P2);
});

clause(MOOSE, "2:ability:infiltrate", "the cost (destroy) is paid when activated, the control change comes after the opponent could respond", () => {
  const { engine, id } = mooseBoard({ extra: [sacItem(P2)] });
  activateRaw(engine, P2, id("moose"), "infiltrate", { sac: [id("sacItem")] });
  assert.ok(engine.state.responseWindow, "control: awaiting responses");
  assert.equal(zoneOf(engine, id("sacItem")), "discard", "destroyed as a cost");
  assert.equal(controllerOf(engine, id("moose")), P2, "control has not passed yet");
  resolvePendingResponses(engine);
  assert.equal(controllerOf(engine, id("moose")), P1);
});

clause(MOOSE, "2:ability:infiltrate", "it passes back and forth: the new controller can infiltrate again by destroying their own card", () => {
  const { engine, id } = mooseBoard({ extra: [sacItem(P2), sacItem(P1, "mineItem")] });
  activate(engine, P2, id("moose"), "infiltrate", { selected: { sac: [id("sacItem")] } });
  assert.equal(controllerOf(engine, id("moose")), P1);
  endTurn(engine, P2);
  activate(engine, P1, id("moose"), "infiltrate", { selected: { sac: [id("mineItem")] } });
  assert.equal(controllerOf(engine, id("moose")), P2, "and back");
});

clause(MOOSE, "2:ability:infiltrate", "after it moves, the influence loss follows the new controller", () => {
  const { engine, id } = mooseBoard({ extra: [sacItem(P2)] });
  activate(engine, P2, id("moose"), "infiltrate", { selected: { sac: [id("sacItem")] } });
  endTurn(engine, P2);
  assert.equal(influence(engine, P1), 29, "P1 controls the Moose now and loses 1 at the start of their turn");
  assert.equal(influence(engine, P2), 30);
});

clause(MOOSE, "2:ability:infiltrate", "a character I control but the opponent owns goes to its OWNER's discard pile when destroyed for the cost", () => {
  const { engine, id } = mooseBoard({ extra: [sacChar(P1, "borrowed", P2)] });
  activate(engine, P2, id("moose"), "infiltrate", { selected: { sac: [id("borrowed")] } });
  assert.ok(discardOf(engine, P1).includes(id("borrowed")), "discardOf(engine, P1).includes(id(\"borrowed\"))");
});

// --- Hulking Vigilante --------------------------------------------------------------------------------
// If you control any other characters you own, destroy this card.
// Character, rogue, subtype outcast / vigilante, cost 3, threshold [D]x5, 5/5/4.

const VIGILANTE = "fb4fb0b3-e4ee-42f9-9a28-b184729fce40";

clause(VIGILANTE, "0:rule", "alone (no other character I own and control) it stays in play with its printed 5/5/4 stats", () => {
  const { engine, id } = handBoard(VIGILANTE, { deception: 5 });
  play(engine, P1, id("me"));
  assert.equal(zoneOf(engine, id("me")), "play");
  assert.deepEqual(stats(engine, id("me")), [5, 5, 4]);
});

clause(VIGILANTE, "0:rule", "entering play while I control another character I own: it is destroyed (into my discard pile)", () => {
  const { engine, id } = handBoard(VIGILANTE, { deception: 5, extra: [{ key: "other", def: character({ name: "Other" }), owner: P1, zone: "play" }] });
  play(engine, P1, id("me"));
  assert.equal(zoneOf(engine, id("me")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("me")), "discardOf(engine, P1).includes(id(\"me\"))");
  assert.equal(zoneOf(engine, id("other")), "play", "the other character is untouched");
});

clause(VIGILANTE, "0:rule", "it is checked continuously: a second character entering play later destroys the Vigilante", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "vig", def: printing(VIGILANTE), owner: P1, zone: "play" },
      { key: "late", def: character({ name: "Late", cost: 1 }), owner: P1, zone: "hand" },
      ...bank("deception", 2, P1)
    ]
  });
  assert.equal(zoneOf(engine, id("vig")), "play", "control: alone");
  play(engine, P1, id("late"));
  assert.equal(zoneOf(engine, id("late")), "play");
  assert.equal(zoneOf(engine, id("vig")), "discard", "the Vigilante is destroyed once I control another character I own");
});

clause(VIGILANTE, "0:rule", "the other character can arrive any way, e.g. put into play by an effect, and still destroys it", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "vig", def: printing(VIGILANTE), owner: P1, zone: "play" },
      { key: "late", def: character({ name: "Late" }), owner: P1, zone: "hand" },
      { key: "putin", def: putIntoPlayTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("putin"), { selected: { t: [id("late")] } });
  assert.equal(zoneOf(engine, id("late")), "play");
  assert.equal(zoneOf(engine, id("vig")), "discard");
});

clause(VIGILANTE, "0:rule", "the opponent's characters do not count", () => {
  const { engine, id } = handBoard(VIGILANTE, { deception: 5, extra: [{ key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }] });
  play(engine, P1, id("me"));
  assert.equal(zoneOf(engine, id("me")), "play");
});

clause(VIGILANTE, "0:rule", "a character I control but do NOT own does not count", () => {
  const { engine, id } = handBoard(VIGILANTE, { deception: 5, extra: [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, controller: P1, zone: "play" }] });
  play(engine, P1, id("me"));
  assert.equal(zoneOf(engine, id("me")), "play", "I control it but 'you own' fails");
});

clause(VIGILANTE, "0:rule", "a character I own but the opponent controls does not count", () => {
  const { engine, id } = handBoard(VIGILANTE, { deception: 5, extra: [{ key: "lent", def: character({ name: "Lent" }), owner: P1, controller: P2, zone: "play" }] });
  play(engine, P1, id("me"));
  assert.equal(zoneOf(engine, id("me")), "play", "I own it but do not control it");
});

clause(VIGILANTE, "0:rule", "items, locations and face-down cards are not characters: they do not count", () => {
  const { engine, id } = handBoard(VIGILANTE, {
    deception: 5,
    extra: [
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P1, zone: "play", faceDown: true }
    ]
  });
  play(engine, P1, id("me"));
  assert.equal(zoneOf(engine, id("me")), "play");
});

clause(VIGILANTE, "0:rule", "a character in my hand, deck or discard pile does not count", () => {
  const { engine, id } = handBoard(VIGILANTE, {
    deception: 5,
    extra: [
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDeck", def: character({ name: "InDeck" }), owner: P1, zone: "deck" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" }
    ]
  });
  play(engine, P1, id("me"));
  assert.equal(zoneOf(engine, id("me")), "play");
});

clause(VIGILANTE, "0:rule", "regaining control of a character I own destroys the Vigilante: the lent character comes home", () => {
  const takeBack = tactic({
    name: "TakeBack",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "tb",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "vig", def: printing(VIGILANTE), owner: P1, zone: "play" },
      { key: "lent", def: character({ name: "Lent" }), owner: P1, controller: P2, zone: "play" },
      { key: "takeback", def: takeBack, owner: P1, zone: "hand" }
    ]
  });
  assert.equal(zoneOf(engine, id("vig")), "play", "control: the lent character doesn't count");
  play(engine, P1, id("takeback"), { selected: { t: [id("lent")] } });
  assert.equal(controllerOf(engine, id("lent")), P1);
  assert.equal(zoneOf(engine, id("vig")), "discard", "now I control another character I own");
});

clause(VIGILANTE, "0:rule", "the opponent's own characters entering play do not destroy MY Vigilante", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "vig", def: printing(VIGILANTE), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", cost: 1 }), owner: P2, zone: "hand" },
      ...bank("deception", 2, P2)
    ]
  });
  play(engine, P2, id("foe"));
  assert.equal(zoneOf(engine, id("foe")), "play");
  assert.equal(zoneOf(engine, id("vig")), "play");
});

clause(VIGILANTE, "0:rule", "two Vigilantes cannot both stay in play: each is 'another character you own' for the other", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "vig1", def: printing(VIGILANTE), owner: P1, zone: "play" },
      { key: "vig2", def: printing(VIGILANTE), owner: P1, zone: "hand" },
      ...bank("deception", 5, P1)
    ]
  });
  play(engine, P1, id("vig2"));
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("vig1")) === "play" && zoneOf(engine, id("vig2")) === "play", false, "at least one is destroyed");
});

clause(VIGILANTE, "0:rule", "pays exactly 3 and needs five [D]: refused with four Deception even with plenty of other resources", () => {
  const exact = deployChecks((res) => handBoard(VIGILANTE, { deception: res.deception, greed: res.greed }), 3, 5);
  assert.equal(zoneOf(exact.engine, exact.id("me")), "play");
  assert.equal(ready(exact.engine), 2);
});

// --- Impeccable Timing -----------------------------------------------------------------------------------
// COST: Pick a depleted character. EFFECT: If the character has 4 life or less, destroy it.
// Tactic, rogue, cost 3, threshold [D].

const IMPECCABLE = "5d4a643f-9f1a-4d2c-815b-0c720598045f";

function timingBoard(opts: HandOpts & { life?: number; owner?: Pid; depleted?: boolean } = {}) {
  return handBoard(IMPECCABLE, {
    ...opts,
    extra: [
      { key: "t", def: character({ name: "Target", strength: 2, life: opts.life ?? 4, speed: 2 }), owner: opts.owner ?? P2, zone: "play", depleted: opts.depleted ?? true },
      { key: "fresh", def: character({ name: "Fresh", strength: 2, life: 2, speed: 2 }), owner: P2, zone: "play", depleted: false },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play", depleted: true },
      ...(opts.extra ?? [])
    ]
  });
}

clause(IMPECCABLE, "0:ability", "a depleted character with exactly 4 life is destroyed", () => {
  const { engine, id } = timingBoard({ life: 4 });
  play(engine, P1, id("me"), { selected: { pick: [id("t")] } });
  assert.equal(zoneOf(engine, id("t")), "discard");
  assert.equal(zoneOf(engine, id("me")), "discard", "the tactic is spent");
});

clause(IMPECCABLE, "0:ability", "life 1, 2, 3 and 4 all die", () => {
  for (const life of [1, 2, 3, 4]) {
    const { engine, id } = timingBoard({ life });
    play(engine, P1, id("me"), { selected: { pick: [id("t")] } });
    assert.equal(zoneOf(engine, id("t")), "discard", `life ${life}`);
  }
});

clause(IMPECCABLE, "0:ability", "life 5 or more: the character survives (still depleted, still in play)", () => {
  for (const life of [5, 6, 9]) {
    const { engine, id } = timingBoard({ life });
    play(engine, P1, id("me"), { selected: { pick: [id("t")] } });
    assert.equal(zoneOf(engine, id("t")), "play", `life ${life}`);
    assert.equal(isDepleted(engine, id("t")), true);
    assert.equal(zoneOf(engine, id("me")), "discard", "the tactic is spent anyway");
  }
});

clause(IMPECCABLE, "0:ability", "life is checked as the stat: a character boosted from 4 to 5 life before the tactic survives", () => {
  const { engine, id } = timingBoard({ life: 4, extra: [{ key: "lifeUp", def: statTactic("life", 1), owner: P1, zone: "hand" }] });
  play(engine, P1, id("lifeUp"), { selected: { t: [id("t")] } });
  assert.equal(engine.getStat(id("t"), "life"), 5, "control: 5 life now");
  play(engine, P1, id("me"), { selected: { pick: [id("t")] } });
  assert.equal(zoneOf(engine, id("t")), "play");
});

clause(IMPECCABLE, "0:ability", "the life is checked when the tactic RESOLVES: the owner boosting a life-4 character to 6 in response saves it", () => {
  const { engine, id } = timingBoard({ life: 4, extra: [{ key: "lifeUp", def: statTactic("life", 2), owner: P2, zone: "hand" }] });
  playRaw(engine, P1, id("me"), { selected: { pick: [id("t")] } });
  playRaw(engine, P2, id("lifeUp"), { selected: { t: [id("t")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("t"), "life"), 6, "control: the response resolved");
  assert.equal(zoneOf(engine, id("t")), "play", "6 life: not destroyed");
});

clause(IMPECCABLE, "0:ability", "...and lowering a life-5 character to 3 in response gets it destroyed", () => {
  const { engine, id } = timingBoard({ life: 5, extra: [{ key: "lifeDown", def: statTactic("life", -2), owner: P2, zone: "hand" }] });
  playRaw(engine, P1, id("me"), { selected: { pick: [id("t")] } });
  playRaw(engine, P2, id("lifeDown"), { selected: { t: [id("t")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("t"), "life"), 3);
  assert.equal(zoneOf(engine, id("t")), "discard");
});

clause(IMPECCABLE, "0:ability", "only a DEPLETED character can be picked: an untapped one is refused", () => {
  const { engine, id } = timingBoard();
  refused(() => playRaw(engine, P1, id("me"), { selected: { pick: [id("fresh")] } }), "not depleted");
  assert.equal(zoneOf(engine, id("me")), "hand");
  playRaw(engine, P1, id("me"), { selected: { pick: [id("t")] } });
  assert.ok(engine.state.responseWindow, "control: a depleted character is accepted");
});

clause(IMPECCABLE, "0:ability", "it can be my own depleted character too ('a depleted character')", () => {
  const { engine, id } = timingBoard();
  play(engine, P1, id("me"), { selected: { pick: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "discard", "my 2-life depleted character was destroyed");
});

clause(IMPECCABLE, "0:ability", "only characters: a depleted item, a location, a face-down card and a faction are refused", () => {
  const { engine, id } = timingBoard({
    extra: [
      { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play", depleted: true },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play", depleted: true },
      { key: "hidden", def: character({ name: "Hidden", life: 1 }), owner: P2, zone: "play", faceDown: true, depleted: true }
    ]
  });
  for (const key of ["gear", "place", "hidden"]) refused(() => playRaw(engine, P1, id("me"), { selected: { pick: [id(key)] } }), `${key} cannot be picked`);
  refused(() => playRaw(engine, P1, id("me"), { selected: { pick: [factionOf(engine, P2)] } }), "a faction");
  refused(() => playRaw(engine, P1, id("me"), { selected: {} }), "a pick is required");
  assert.equal(zoneOf(engine, id("me")), "hand");
});

clause(IMPECCABLE, "0:ability", "exactly one character: two picks are refused, and only the picked one dies", () => {
  const { engine, id } = timingBoard({ extra: [{ key: "t2", def: character({ name: "Target2", life: 2 }), owner: P2, zone: "play", depleted: true }] });
  refused(() => playRaw(engine, P1, id("me"), { selected: { pick: [id("t"), id("t2")] } }), "one pick");
  play(engine, P1, id("me"), { selected: { pick: [id("t")] } });
  assert.equal(zoneOf(engine, id("t")), "discard");
  assert.equal(zoneOf(engine, id("t2")), "play");
  assert.equal(zoneOf(engine, id("mine")), "play");
});

clause(IMPECCABLE, "0:ability", "damage does not matter, only life: a depleted 5-life character carrying 4 damage survives", () => {
  const { engine, id } = timingBoard({ life: 5 });
  engine.state.cards[id("t")].damage = 4;
  play(engine, P1, id("me"), { selected: { pick: [id("t")] } });
  assert.equal(zoneOf(engine, id("t")), "play");
});

clause(IMPECCABLE, "0:ability", "pays exactly 3, needs [D], and is refused one resource short or without the threshold", () => {
  deployChecks((res) => timingBoard({ deception: res.deception, greed: res.greed }), 3, 1, (id) => ({ pick: [id("t")] }));
});

clause(IMPECCABLE, "0:ability", "usable on the opponent's turn in response (e.g. to their attack, hitting a character that attacked and is now depleted)", () => {
  const { engine, id } = timingBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "attacker", def: character({ name: "Attacker", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" }]
  });
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("attacker")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  assert.equal(isDepleted(engine, id("attacker")), true, "attacking depleted it");
  playRaw(engine, P1, id("me"), { selected: { pick: [id("attacker")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("attacker")), "discard", "the 3-life depleted attacker is destroyed");
});

// --- Late Addition ------------------------------------------------------------------------------------------
// You may play a character card from your hand. Draw a card. (You still pay all the character's costs.)
// Tactic, rogue, cost 1, threshold [D].

const LATE_ADDITION = "e987b8e3-7218-4978-bf82-1fe8fc39627c";

function lateBoard(opts: HandOpts & { guyCost?: number } = {}) {
  return handBoard(LATE_ADDITION, {
    deception: 4,
    ...opts,
    extra: [
      { key: "guy", def: character({ name: "Guy", cost: opts.guyCost ?? 2, strength: 2, life: 2, speed: 2 }), owner: P1, zone: "hand" },
      { key: "guy2", def: character({ name: "Guy2", cost: 1, strength: 1, life: 1, speed: 1 }), owner: P1, zone: "hand" },
      { key: "gear", def: item({ name: "Gear", cost: 1 }), owner: P1, zone: "hand" },
      { key: "spell", def: tactic({ name: "Spell", cost: 1, behavior: { abilities: [{ id: "s", type: "activated", effects: [] }] } }), owner: P1, zone: "hand" },
      { key: "staple", def: resourceCard({ name: "Staple" }), owner: P1, zone: "hand" },
      { key: "theirs", def: character({ name: "Theirs", cost: 1 }), owner: P2, zone: "hand" },
      ...deckOfFillers("m", 5, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const lateChoose = (engine: SpoilsEngine, cardId: CardInstanceId | undefined) => {
  const pc = pending(engine)!;
  assert.equal(pc.kind, "deployForFree", "I am asked which character to play");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId } } as never);
  resolvePendingResponses(engine);
};

clause(LATE_ADDITION, "0:rule", "I may play a character from my hand, paying all its costs, and it enters play (Late Addition costs 1, Guy costs 2)", () => {
  const { engine, id } = lateBoard();
  const before = ready(engine);
  play(engine, P1, id("me"));
  lateChoose(engine, id("guy"));
  assert.equal(zoneOf(engine, id("guy")), "play");
  assert.equal(controllerOf(engine, id("guy")), P1);
  assert.equal(before - ready(engine), 3, "1 for Late Addition + 2 for the character: the character is NOT free");
  assert.equal(zoneOf(engine, id("me")), "discard");
});

clause(LATE_ADDITION, "0:rule", "...then I draw a card: exactly one, the top of my deck", () => {
  const { engine, id } = lateBoard();
  const deckBefore = deckOf(engine, P1).length;
  play(engine, P1, id("me"));
  lateChoose(engine, id("guy"));
  assert.equal(deckBefore - deckOf(engine, P1).length, 1);
  assert.equal(zoneOf(engine, id("m0")), "hand", "the top card");
});

clause(LATE_ADDITION, "0:rule", "'may': declining the character still draws the card, and spends nothing but the 1", () => {
  const { engine, id } = lateBoard();
  const before = ready(engine);
  play(engine, P1, id("me"));
  lateChoose(engine, undefined);
  assert.equal(zoneOf(engine, id("guy")), "hand");
  assert.equal(before - ready(engine), 1);
  assert.equal(zoneOf(engine, id("m0")), "hand", "I still drew");
  assert.equal(zoneOf(engine, id("me")), "discard");
});

clause(LATE_ADDITION, "0:rule", "only character cards are offered: not items, tactics, resources or the opponent's cards", () => {
  const { engine, id } = lateBoard();
  play(engine, P1, id("me"));
  const pc = pending(engine)!;
  const offered = (pc.candidates as string[]).slice().sort();
  assert.deepEqual(offered, [id("guy"), id("guy2")].sort(), "only my two characters");
  for (const key of ["gear", "spell", "staple", "theirs"]) {
    refused(
      () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id(key) } } as never),
      `${key} is not a character card in my hand`
    );
  }
  assert.equal(zoneOf(engine, id("gear")), "hand");
  assert.equal(zoneOf(engine, id("theirs")), "hand");
});

clause(LATE_ADDITION, "0:rule", "a character in my deck or discard pile is not 'from your hand'", () => {
  const { engine, id } = lateBoard({
    extra: [
      { key: "inDiscard", def: character({ name: "InDiscard", cost: 1 }), owner: P1, zone: "discard" },
      { key: "inDeck", def: character({ name: "InDeck", cost: 1 }), owner: P1, zone: "deck" }
    ]
  });
  play(engine, P1, id("me"));
  const offered = pending(engine)!.candidates as string[];
  assert.equal(offered.includes(id("inDiscard")), false);
  assert.equal(offered.includes(id("inDeck")), false);
});

clause(LATE_ADDITION, "0:rule", "I still pay the character's costs: a character I cannot afford (cost 5 with 3 resources left) cannot be played, but I can still decline and draw", () => {
  const { engine, id } = lateBoard({ guyCost: 5, deception: 4 });
  play(engine, P1, id("me"));
  refused(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id("guy") } } as never), "cost 5, only 3 left");
  assert.equal(zoneOf(engine, id("guy")), "hand");
  lateChoose(engine, undefined);
  assert.equal(zoneOf(engine, id("m0")), "hand", "the draw still happens");
});

clause(LATE_ADDITION, "0:rule", "exactly affordable: the character costing everything that's left is played", () => {
  const { engine, id } = lateBoard({ guyCost: 3, deception: 4 });
  play(engine, P1, id("me"));
  lateChoose(engine, id("guy"));
  assert.equal(zoneOf(engine, id("guy")), "play");
  assert.equal(ready(engine), 0);
});

clause(LATE_ADDITION, "0:rule", "the character's threshold still applies: a [R][R] character with only Deception cannot be played", () => {
  const { engine, id } = lateBoard({ extra: [{ key: "ragey", def: character({ name: "Ragey", cost: 1, threshold: "rr" as never }), owner: P1, zone: "hand" }] });
  play(engine, P1, id("me"));
  refused(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id("ragey") } } as never), "no Rage icons");
  assert.equal(zoneOf(engine, id("ragey")), "hand");
});

clause(LATE_ADDITION, "0:rule", "without any character in hand it simply draws", () => {
  const { engine, id } = lateBoard();
  for (const key of ["guy", "guy2"]) engine.state.players[P1].hand = engine.state.players[P1].hand.filter((c) => c !== id(key));
  play(engine, P1, id("me"));
  drain(engine, declineAll);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("m0")), "hand", "drew the top card");
});

clause(LATE_ADDITION, "0:rule", "a played character cannot attack the turn it enters play", () => {
  const { engine, id } = lateBoard({ turn: 2 });
  play(engine, P1, id("me"));
  lateChoose(engine, id("guy"));
  refused(() => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("guy")], target: { type: "faction", playerId: P2 } }), "just entered play", /did not start the turn in play/);
});

clause(LATE_ADDITION, "0:rule", "the opponent's deck and hand are untouched", () => {
  const { engine, id } = lateBoard();
  const oppHand = [...handOf(engine, P2)];
  play(engine, P1, id("me"));
  lateChoose(engine, id("guy"));
  assert.deepEqual(handOf(engine, P2), oppHand);
});

clause(LATE_ADDITION, "0:rule", "pays exactly 1, needs [D], and is refused with no resource or without the threshold", () => {
  deployChecks((res) => lateBoard({ deception: res.deception, greed: res.greed }), 1, 1);
});

// --- Martial Artist / Martial Arts Trainee (shared "cannot pick" paragraph) ---------------------------------------
// Your opponent cannot pick this card.

const MARTIAL_ARTIST = "b2ceefd9-cf5e-459b-adba-6c0f3a806c58";
const TRAINEE = "3142de68-bfda-45ce-b3a6-c1b085f51664";

/** The printing (key `ma`) in play for P1, P2 holding a kill tactic and a pump tactic, plus an ordinary character `plain` to compare against. */
function elusiveBoard(printingId: string, extra: CardPlacement[] = [], opts: { active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: opts.active ?? P2,
    cards: [
      { key: "ma", def: printing(printingId), owner: P1, zone: "play" },
      { key: "plain", def: character({ name: "Plain", life: 5 }), owner: P1, zone: "play" },
      { key: "kill2", def: killTactic(), owner: P2, zone: "hand" },
      { key: "kill1", def: killTactic(), owner: P1, zone: "hand" },
      ...extra
    ]
  });
}

function opponentCannotPickWithTactic(printingId: string) {
  const { engine, id } = elusiveBoard(printingId);
  refused(() => playRaw(engine, P2, id("kill2"), { selected: { t: [id("ma")] } }), "the opponent cannot pick it");
  assert.equal(zoneOf(engine, id("ma")), "play");
  assert.equal(zoneOf(engine, id("kill2")), "hand", "nothing was played");
  play(engine, P2, id("kill2"), { selected: { t: [id("plain")] } });
  assert.equal(zoneOf(engine, id("plain")), "discard", "control: the opponent can pick my other character");
  assert.equal(zoneOf(engine, id("ma")), "play");
}

function iCanPickMyOwn(printingId: string) {
  const { engine, id } = elusiveBoard(printingId, [], { active: P1 });
  play(engine, P1, id("kill1"), { selected: { t: [id("ma")] } });
  assert.equal(zoneOf(engine, id("ma")), "discard", "its own controller can pick it");
}

function opponentCannotPickWithAbility(printingId: string) {
  const sniper = character({
    name: "Sniper",
    behavior: {
      abilities: [
        {
          id: "snipe",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }]
        }
      ]
    }
  });
  const { engine, id } = elusiveBoard(printingId, [{ key: "sniper", def: sniper, owner: P2, zone: "play" }]);
  refused(() => activateRaw(engine, P2, id("sniper"), "snipe", { t: [id("ma")] }), "an ability cannot pick it");
  activate(engine, P2, id("sniper"), "snipe", { selected: { t: [id("plain")] } });
  assert.equal(engine.state.cards[id("plain")].damage, 1, "control: the same ability can pick my other character");
  assert.equal(engine.state.cards[id("ma")].damage, 0);
}

function opponentCannotPickByChoosing(printingId: string) {
  const chooser = tactic({
    name: "ChooseOne",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "c",
          type: "activated",
          effects: [
            {
              type: "chooserSelectsTarget",
              chooser: "controller",
              declaration: { id: "pick", selector: { zone: "play", type: "character" }, count: 1 },
              effects: [{ type: "destroy", target: { type: "selected", id: "pick" } }]
            }
          ]
        }
      ]
    }
  });
  const { engine, id } = elusiveBoard(printingId, [{ key: "chooser", def: chooser, owner: P2, zone: "hand" }]);
  play(engine, P2, id("chooser"));
  const pc = pending(engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2);
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("ma")] }), "an effect-driven choice cannot pick it either");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("plain")] });
  assert.equal(zoneOf(engine, id("plain")), "discard");
  assert.equal(zoneOf(engine, id("ma")), "play");
}

function opponentSweepsStillHit(printingId: string) {
  const sweep = tactic({
    name: "Sweep",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "sw",
          type: "activated",
          effects: [{ type: "forEach", selector: { type: "character" }, effects: [{ type: "dealDamage", target: { type: "selected", id: "__candidate" }, amount: 1 }] }]
        }
      ]
    }
  });
  const { engine, id } = elusiveBoard(printingId, [{ key: "sweep", def: sweep, owner: P2, zone: "hand" }]);
  const life = printing(printingId).life!;
  play(engine, P2, id("sweep"));
  assert.equal(engine.state.cards[id("plain")].damage, 1, "control: my other character took the 1 damage");
  if (life <= 1) assert.equal(zoneOf(engine, id("ma")), "discard", "'cannot pick' does not protect a 1-life character from an effect that hits every character");
  else assert.equal(engine.state.cards[id("ma")].damage, 1, "'cannot pick' does not protect it from an effect that hits every character");
}

function opponentCannotAttachToIt(printingId: string) {
  const hat = item({ name: "Hat", cost: 0, subtype: ["gear"], attachTo: "character" });
  const { engine, id } = elusiveBoard(printingId, [{ key: "hat", def: hat, owner: P2, zone: "hand" }]);
  refused(() => playRaw(engine, P2, id("hat"), { selected: { attachTo: [id("ma")] } }), "an opponent's ATTACH TO picks the host, which they cannot pick");
  assert.equal(zoneOf(engine, id("hat")), "hand");
  play(engine, P2, id("hat"), { selected: { attachTo: [id("plain")] } });
  assert.equal(engine.state.cards[id("hat")].attachedTo, id("plain"), "control: they can attach it to my other character");
}

function controllerIsTheOwnersOpponent(printingId: string) {
  // The card is OWNED by P1 but CONTROLLED by P2: its "opponent" is P1 (the opponent of its controller).
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ma", def: printing(printingId), owner: P1, controller: P2, zone: "play" },
      { key: "kill1", def: killTactic(), owner: P1, zone: "hand" },
      { key: "kill2", def: killTactic(), owner: P2, zone: "hand" }
    ]
  });
  refused(() => playRaw(engine, P1, id("kill1"), { selected: { t: [id("ma")] } }), "P1 is now the opponent of its controller");
  assert.equal(zoneOf(engine, id("kill1")), "hand");
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  play(engine, P2, id("kill2"), { selected: { t: [id("ma")] } });
  assert.equal(zoneOf(engine, id("ma")), "discard", "its controller P2 can pick it");
}

function noEffectOutsidePlay(printingId: string) {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [
      { key: "ma", def: printing(printingId), owner: P1, zone: "play", faceDown: true },
      { key: "wipe", def: tactic({ name: "WipeResource", cost: 0, behavior: { abilities: [{ id: "w", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "resource" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P2, zone: "hand" }
    ]
  });
  play(engine, P2, id("wipe"), { selected: { t: [id("ma")] } });
  assert.equal(zoneOf(engine, id("ma")), "discard", "face-down it is just a resource with no rules text: the opponent can pick it");
}

clause(MARTIAL_ARTIST, "0:rule", "the opponent's tactic cannot pick it (refused), while it can pick my other characters", () => opponentCannotPickWithTactic(MARTIAL_ARTIST));
clause(MARTIAL_ARTIST, "0:rule", "its own controller can pick it", () => iCanPickMyOwn(MARTIAL_ARTIST));
clause(MARTIAL_ARTIST, "0:rule", "the opponent's activated ability cannot pick it", () => opponentCannotPickWithAbility(MARTIAL_ARTIST));
clause(MARTIAL_ARTIST, "0:rule", "an effect-driven choice by the opponent cannot pick it either", () => opponentCannotPickByChoosing(MARTIAL_ARTIST));
clause(MARTIAL_ARTIST, "0:rule", "an effect that hits every character without picking still hits it", () => opponentSweepsStillHit(MARTIAL_ARTIST));
clause(MARTIAL_ARTIST, "0:rule", "the opponent cannot ATTACH TO it (attaching picks the host)", () => opponentCannotAttachToIt(MARTIAL_ARTIST));
clause(MARTIAL_ARTIST, "0:rule", "'your opponent' is relative to the controller: the owner who doesn't control it cannot pick it, its controller can", () => controllerIsTheOwnersOpponent(MARTIAL_ARTIST));
clause(MARTIAL_ARTIST, "0:rule", "face-down it is only a resource with no rules text, so the protection does not apply", () => noEffectOutsidePlay(MARTIAL_ARTIST));

clause(TRAINEE, "0:rule", "the opponent's tactic cannot pick it (refused), while it can pick my other characters", () => opponentCannotPickWithTactic(TRAINEE));
clause(TRAINEE, "0:rule", "its own controller can pick it", () => iCanPickMyOwn(TRAINEE));
clause(TRAINEE, "0:rule", "the opponent's activated ability cannot pick it", () => opponentCannotPickWithAbility(TRAINEE));
clause(TRAINEE, "0:rule", "an effect-driven choice by the opponent cannot pick it either", () => opponentCannotPickByChoosing(TRAINEE));
clause(TRAINEE, "0:rule", "an effect that hits every character without picking still hits it", () => opponentSweepsStillHit(TRAINEE));
clause(TRAINEE, "0:rule", "the opponent cannot ATTACH TO it (attaching picks the host)", () => opponentCannotAttachToIt(TRAINEE));
clause(TRAINEE, "0:rule", "'your opponent' is relative to the controller: the owner who doesn't control it cannot pick it, its controller can", () => controllerIsTheOwnersOpponent(TRAINEE));
clause(TRAINEE, "0:rule", "face-down it is only a resource with no rules text, so the protection does not apply", () => noEffectOutsidePlay(TRAINEE));

clause(MARTIAL_ARTIST, "0:rule", "pays exactly 6, needs [D][D], and has the printed 4/3/4 stats", () => {
  const exact = deployChecks((res) => handBoard(MARTIAL_ARTIST, { deception: res.deception, greed: res.greed }), 6, 2);
  assert.equal(zoneOf(exact.engine, exact.id("me")), "play");
  assert.deepEqual(stats(exact.engine, exact.id("me")), [4, 3, 4]);
});

clause(TRAINEE, "0:rule", "pays exactly 3, needs [D][D], and has the printed 2/1/4 stats", () => {
  const exact = deployChecks((res) => handBoard(TRAINEE, { deception: res.deception, greed: res.greed }), 3, 2);
  assert.equal(zoneOf(exact.engine, exact.id("me")), "play");
  assert.deepEqual(stats(exact.engine, exact.id("me")), [2, 1, 4]);
});

// --- Martial Arts Master ----------------------------------------------------------------------------
// While this card is in a battle, it gains X strength, where X is this card's speed minus the highest
// speed among characters in the opposing party.   Character, rogue, cost 4, threshold [D][D], 1/3/6.

const MASTER = "9a90a89c-c3ef-4c6c-b185-b34813a75b54";

/** A character of the opposing side with the given speed (harmless: 0 strength, lots of life). */
const speedster = (key: string, owner: Pid, speed: number, extra: Partial<CardDefinition> = {}): CardPlacement => ({
  key,
  def: character({ name: `Speed${speed} ${key}`, strength: 0, life: 9, speed, ...extra }),
  owner,
  zone: "play"
});

/** P1 attacks with the Master (key `ma`) and optional allies; P2 blocks with the given characters. Returns with blockers declared. */
function masterAttacks(blockers: CardPlacement[], opts: { allies?: CardPlacement[]; extra?: CardPlacement[]; blockWith?: string[]; masterDef?: CardDefinition } = {}) {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [{ key: "ma", def: opts.masterDef ?? printing(MASTER), owner: P1, zone: "play" }, ...(opts.allies ?? []), ...blockers, ...(opts.extra ?? [])]
  });
  declareAttackBy(game.engine, P1, ["ma", ...(opts.allies ?? []).map((a) => a.key)].map(game.id));
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: (opts.blockWith ?? blockers.map((b) => b.key)).map(game.id) });
  return game;
}

/** P2 attacks with the given characters; P1 blocks with the Master. Returns with blockers declared. */
function masterBlocks(attackers: CardPlacement[], opts: { extra?: CardPlacement[] } = {}) {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [{ key: "ma", def: printing(MASTER), owner: P1, zone: "play" }, ...attackers, ...(opts.extra ?? [])]
  });
  declareAttackBy(game.engine, P2, attackers.map((a) => game.id(a.key)));
  game.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [game.id("ma")] });
  return game;
}

clause(MASTER, "0:rule", "outside a battle it has just its printed 1 strength (and 3 life, 6 speed)", () => {
  const { engine, id } = buildGame({ cards: [{ key: "ma", def: printing(MASTER), owner: P1, zone: "play" }, speedster("foe", P2, 2)] });
  assert.deepEqual(stats(engine, id("ma")), [1, 3, 6]);
});

clause(MASTER, "0:rule", "attacking and blocked by a speed-2 character: X = 6 - 2 = 4, so strength 5", () => {
  const { engine, id } = masterAttacks([speedster("b1", P2, 2)]);
  assert.equal(engine.getStat(id("ma"), "strength"), 5);
  assert.equal(engine.getStat(id("ma"), "speed"), 6, "speed itself does not change");
});

clause(MASTER, "0:rule", "X follows the opposing speed: 0, 1, 3, 5 give strength 7, 6, 4, 2", () => {
  for (const [speed, expected] of [[0, 7], [1, 6], [3, 4], [5, 2]] as const) {
    const { engine, id } = masterAttacks([speedster("b1", P2, speed)]);
    assert.equal(engine.getStat(id("ma"), "strength"), expected, `opposing speed ${speed}`);
  }
});

clause(MASTER, "0:rule", "equally fast opposition (speed 6): X = 0, strength stays 1", () => {
  const { engine, id } = masterAttacks([speedster("b1", P2, 6)]);
  assert.equal(engine.getStat(id("ma"), "strength"), 1);
});

clause(MASTER, "0:rule", "the HIGHEST speed in the opposing party counts: blockers of speed 2 and 4 give X = 2 (strength 3)", () => {
  const { engine, id } = masterAttacks([speedster("b1", P2, 2), speedster("b2", P2, 4)]);
  assert.equal(engine.getStat(id("ma"), "strength"), 3);
});

clause(MASTER, "0:rule", "a faster opposing party pushes X below 0: the Master loses strength, never below 0 (CR 410.4)", () => {
  const { engine, id } = masterAttacks([speedster("b1", P2, 8)]);
  assert.equal(engine.getStat(id("ma"), "strength"), 0, "1 + (6 - 8) = -1 stays at 0");
});

clause(MASTER, "0:rule", "...so with a faster blocker the Master deals no damage at all", () => {
  const blocker = speedster("b1", P2, 8, { life: 4, strength: 0 });
  const game = masterAttacks([blocker]);
  autoResolveBattle(game.engine);
  assert.equal(game.engine.state.cards[game.id("b1")].damage, 0);
});

clause(MASTER, "0:rule", "only the OPPOSING party counts: a fast ally in the Master's own party is ignored", () => {
  const { engine, id } = masterAttacks([speedster("b1", P2, 2)], { allies: [speedster("ally", P1, 9)] });
  assert.equal(engine.getStat(id("ma"), "strength"), 5, "6 - 2, not 6 - 9");
});

clause(MASTER, "0:rule", "characters not in the battle are ignored: a speed-9 bystander on their side does not reduce X", () => {
  const { engine, id } = masterAttacks([speedster("b1", P2, 2)], { extra: [speedster("bystander", P2, 9), speedster("mine", P1, 9)] });
  assert.equal(engine.getStat(id("ma"), "strength"), 5);
});

clause(MASTER, "0:rule", "also while BLOCKING: blocking a speed-3 attacker gives X = 3 (strength 4)", () => {
  const { engine, id } = masterBlocks([speedster("atk", P2, 3)]);
  assert.equal(engine.getStat(id("ma"), "strength"), 4);
});

clause(MASTER, "0:rule", "blocking a party of speeds 1 and 5: the highest (5) counts, X = 1 (strength 2)", () => {
  const { engine, id } = masterBlocks([speedster("a1", P2, 1), speedster("a2", P2, 5)]);
  assert.equal(engine.getStat(id("ma"), "strength"), 2);
});

clause(MASTER, "0:rule", "it uses the Master's CURRENT speed: a +1 speed boost raises X by one", () => {
  const boostGame = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [{ key: "ma", def: printing(MASTER), owner: P1, zone: "play" }, { key: "boost", def: statTactic("speed", 1), owner: P1, zone: "hand" }, speedster("b1", P2, 2)]
  });
  declareAttackBy(boostGame.engine, P1, [boostGame.id("ma")]);
  boostGame.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [boostGame.id("b1")] });
  assert.equal(boostGame.engine.getStat(boostGame.id("ma"), "strength"), 5);
  playRaw(boostGame.engine, P1, boostGame.id("boost"), { selected: { t: [boostGame.id("ma")] } });
  resolvePendingResponses(boostGame.engine);
  assert.equal(boostGame.engine.getStat(boostGame.id("ma"), "speed"), 7);
  assert.equal(boostGame.engine.getStat(boostGame.id("ma"), "strength"), 6, "X = 7 - 2 = 5");
});

clause(MASTER, "0:rule", "it tracks the opposition's speed live: slowing the blocker by 1 in response raises the Master's strength by 1", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [{ key: "ma", def: printing(MASTER), owner: P1, zone: "play" }, { key: "slow", def: statTactic("speed", -1), owner: P1, zone: "hand" }, speedster("b1", P2, 3)]
  });
  declareAttackBy(game.engine, P1, [game.id("ma")]);
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [game.id("b1")] });
  assert.equal(game.engine.getStat(game.id("ma"), "strength"), 4, "6 - 3 = 3, plus 1");
  playRaw(game.engine, P1, game.id("slow"), { selected: { t: [game.id("b1")] } });
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.getStat(game.id("b1"), "speed"), 2);
  assert.equal(game.engine.getStat(game.id("ma"), "strength"), 5);
});

clause(MASTER, "0:rule", "the bonus is real damage: 5 strength (vs speed 2) kills a 5-life blocker before it can strike", () => {
  const blocker = speedster("b1", P2, 2, { life: 5, strength: 9 });
  const game = masterAttacks([blocker]);
  autoResolveBattle(game.engine);
  assert.equal(zoneOf(game.engine, game.id("b1")), "discard", "5 damage kills the 5-life blocker");
  assert.equal(zoneOf(game.engine, game.id("ma")), "play", "the faster Master struck first: it took no damage");
  assert.equal(game.engine.state.cards[game.id("ma")].damage, 0);
});

clause(MASTER, "0:rule", "unblocked and a battle over, the bonus ends: it is back to strength 1", () => {
  const game = masterAttacks([speedster("b1", P2, 2)]);
  autoResolveBattle(game.engine);
  assert.equal(battleOf(game.engine), undefined);
  assert.equal(game.engine.getStat(game.id("ma"), "strength"), 1);
});

clause(MASTER, "0:rule", "a Master in play but NOT in the battle gets nothing (another character of mine attacks and is blocked)", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [{ key: "ma", def: printing(MASTER), owner: P1, zone: "play" }, speedster("ally", P1, 3), speedster("b1", P2, 2)]
  });
  declareAttackBy(game.engine, P1, [game.id("ally")]);
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [game.id("b1")] });
  assert.equal(game.engine.getStat(game.id("ma"), "strength"), 1);
});

clause(MASTER, "0:rule", "two Martial Arts Masters facing each other: each is as fast as the other, X = 0, strength 1", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [{ key: "ma", def: printing(MASTER), owner: P1, zone: "play" }, { key: "ma2", def: printing(MASTER), owner: P2, zone: "play" }]
  });
  declareAttackBy(game.engine, P1, [game.id("ma")]);
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [game.id("ma2")] });
  assert.equal(game.engine.getStat(game.id("ma"), "strength"), 1);
  assert.equal(game.engine.getStat(game.id("ma2"), "strength"), 1);
});

clause(MASTER, "0:rule", "pays exactly 4, needs [D][D], and has the printed 1/3/6 stats", () => {
  const exact = deployChecks((res) => handBoard(MASTER, { deception: res.deception, greed: res.greed }), 4, 2);
  assert.equal(zoneOf(exact.engine, exact.id("me")), "play");
  assert.deepEqual(stats(exact.engine, exact.id("me")), [1, 3, 6]);
});

// --- Master Thief -------------------------------------------------------------------------------------------
// If this card is destroyed, you may pick a character, item, location, or resource in your opponent's
// discard pile. If you do, put that card into play under your control.
// Character, rogue, subtype thief, cost 8, threshold [D][D][D], 4/3/4.

const MASTER_THIEF = "bfe0fbb0-079e-4f9a-ada8-b0d18e2be880";

const loot = {
  char: { key: "lootChar", def: character({ name: "LootChar", strength: 2, life: 2, speed: 2 }), owner: P2, zone: "discard" } as CardPlacement,
  item: { key: "lootItem", def: item({ name: "LootItem" }), owner: P2, zone: "discard" } as CardPlacement,
  place: { key: "lootPlace", def: location({ name: "LootPlace", structure: 3 }), owner: P2, zone: "discard" } as CardPlacement,
  staple: { key: "lootStaple", def: resourceCard({ name: "LootStaple" }), owner: P2, zone: "discard" } as CardPlacement,
  spell: { key: "lootSpell", def: tactic({ name: "LootSpell", cost: 1, behavior: { abilities: [{ id: "s", type: "activated", effects: [] }] } }), owner: P2, zone: "discard" } as CardPlacement
};

function heistBoard(opts: { extra?: CardPlacement[]; theirs?: boolean; withLoot?: boolean } = {}) {
  const lootCards = opts.withLoot === false ? [] : Object.values(loot);
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.theirs ? 2 : 1,
    activePlayerId: opts.theirs ? P2 : P1,
    cards: [
      { key: "mt", def: printing(MASTER_THIEF), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: opts.theirs ? P2 : P1, zone: "hand" },
      ...lootCards,
      { key: "myDisc", def: character({ name: "MyDiscard" }), owner: P1, zone: "discard" },
      { key: "theirHand", def: character({ name: "TheirHand" }), owner: P2, zone: "hand" },
      { key: "theirDeck", def: character({ name: "TheirDeck" }), owner: P2, zone: "deck" },
      { key: "theirPlay", def: character({ name: "TheirPlay" }), owner: P2, zone: "play" },
      ...deckOfFillers("m", 3, P1),
      ...(opts.extra ?? [])
    ]
  });
}

/** Destroys the Master Thief with the Kill tactic; stops at the owner's pick. */
function killThief(game: ReturnType<typeof heistBoard>, theirs = false) {
  play(game.engine, theirs ? P2 : P1, game.id("kill"), { selected: { t: [game.id("mt")] } });
}

const heistPick = (engine: SpoilsEngine, selected: CardInstanceId[]) => answerPending(engine, "chooserSelectsTarget", { selected });

clause(MASTER_THIEF, "0:rule", "destroyed: I may pick a character in the opponent's discard pile and it enters play under MY control", () => {
  const game = heistBoard();
  killThief(game);
  assert.equal(zoneOf(game.engine, game.id("mt")), "discard", "control: the Thief is destroyed");
  const pc = pending(game.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I choose");
  heistPick(game.engine, [game.id("lootChar")]);
  assert.equal(zoneOf(game.engine, game.id("lootChar")), "play");
  assert.equal(controllerOf(game.engine, game.id("lootChar")), P1);
  assert.equal(game.engine.state.cards[game.id("lootChar")].ownerId, P2, "ownership never changes");
});

clause(MASTER_THIEF, "0:rule", "...an ITEM works too", () => {
  const game = heistBoard();
  killThief(game);
  heistPick(game.engine, [game.id("lootItem")]);
  assert.equal(zoneOf(game.engine, game.id("lootItem")), "play");
  assert.equal(controllerOf(game.engine, game.id("lootItem")), P1);
});

clause(MASTER_THIEF, "0:rule", "...a LOCATION works too", () => {
  const game = heistBoard();
  killThief(game);
  heistPick(game.engine, [game.id("lootPlace")]);
  assert.equal(zoneOf(game.engine, game.id("lootPlace")), "play");
  assert.equal(controllerOf(game.engine, game.id("lootPlace")), P1);
});

clause(MASTER_THIEF, "0:rule", "...and a RESOURCE: it enters play under my control as a real resource, giving me one more resource to spend", () => {
  const game = heistBoard();
  const before = ready(game.engine);
  killThief(game);
  heistPick(game.engine, [game.id("lootStaple")]);
  assert.equal(zoneOf(game.engine, game.id("lootStaple")), "play");
  assert.equal(controllerOf(game.engine, game.id("lootStaple")), P1);
  assert.equal(game.engine.isResource(game.id("lootStaple")), true);
  assert.equal(ready(game.engine) - before, 1, "it provides a resource I can pay with");
});

clause(MASTER_THIEF, "0:rule", "a TACTIC in their discard pile cannot be picked", () => {
  const game = heistBoard();
  killThief(game);
  refused(() => heistPick(game.engine, [game.id("lootSpell")]), "tactics are not on the list");
  assert.equal(zoneOf(game.engine, game.id("lootSpell")), "discard");
  heistPick(game.engine, [game.id("lootChar")]);
  assert.equal(zoneOf(game.engine, game.id("lootChar")), "play");
});

clause(MASTER_THIEF, "0:rule", "only THEIR discard pile: my own discard pile, their hand, their deck and their cards in play cannot be picked", () => {
  const game = heistBoard();
  killThief(game);
  for (const key of ["myDisc", "theirHand", "theirDeck", "theirPlay", "mt"]) {
    refused(() => heistPick(game.engine, [game.id(key)]), `${key} is not in their discard pile`);
  }
  heistPick(game.engine, [game.id("lootItem")]);
  assert.equal(zoneOf(game.engine, game.id("lootItem")), "play");
});

clause(MASTER_THIEF, "0:rule", "'you may': declining takes nothing", () => {
  const game = heistBoard();
  killThief(game);
  heistPick(game.engine, []);
  assert.equal(pending(game.engine), undefined);
  for (const key of ["lootChar", "lootItem", "lootPlace", "lootStaple"]) assert.equal(zoneOf(game.engine, game.id(key)), "discard", key);
});

clause(MASTER_THIEF, "0:rule", "'a ... card': exactly one card is taken; two picks are refused", () => {
  const game = heistBoard();
  killThief(game);
  refused(() => heistPick(game.engine, [game.id("lootChar"), game.id("lootItem")]), "one card only");
  assert.equal(zoneOf(game.engine, game.id("lootChar")), "discard");
  assert.equal(zoneOf(game.engine, game.id("lootItem")), "discard");
  heistPick(game.engine, [game.id("lootChar")]);
  assert.equal(zoneOf(game.engine, game.id("lootItem")), "discard", "the other stays");
});

clause(MASTER_THIEF, "0:rule", "the Master Thief itself ends in my discard pile (it is the destroyed card), not in play", () => {
  const game = heistBoard();
  killThief(game);
  heistPick(game.engine, [game.id("lootChar")]);
  assert.ok(discardOf(game.engine, P1).includes(game.id("mt")), "discardOf(game.engine, P1).includes(game.id(\"mt\"))");
});

clause(MASTER_THIEF, "0:rule", "nothing eligible in their discard pile: no prompt and nothing happens", () => {
  const game = heistBoard({ withLoot: false });
  killThief(game);
  assert.equal(pending(game.engine), undefined);
  assert.equal(zoneOf(game.engine, game.id("mt")), "discard");
});

clause(MASTER_THIEF, "0:rule", "only tactics in their discard pile: nothing can be picked, no prompt", () => {
  const game = heistBoard({ withLoot: false, extra: [loot.spell] });
  killThief(game);
  assert.equal(pending(game.engine), undefined);
  assert.equal(zoneOf(game.engine, game.id("lootSpell")), "discard");
});

clause(MASTER_THIEF, "0:rule", "the opponent destroying it triggers it just the same: I (its controller) still choose", () => {
  const game = heistBoard({ theirs: true });
  killThief(game, true);
  const pc = pending(game.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "its controller chooses");
  heistPick(game.engine, [game.id("lootItem")]);
  assert.equal(controllerOf(game.engine, game.id("lootItem")), P1);
});

clause(MASTER_THIEF, "0:rule", "destroyed in BATTLE too: blocking a big attacker kills it, and the trigger still fires", () => {
  const fightGame = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "mt", def: printing(MASTER_THIEF), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Brute", strength: 9, life: 9, speed: 9 }), owner: P2, zone: "play" },
      loot.item
    ]
  });
  declareAttackBy(fightGame.engine, P2, [fightGame.id("atk")]);
  fightGame.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [fightGame.id("mt")] });
  autoResolveBattle(fightGame.engine);
  assert.equal(zoneOf(fightGame.engine, fightGame.id("mt")), "discard", "control: the Thief died in battle");
  const pc = pending(fightGame.engine)!;
  assert.equal(pc?.kind, "chooserSelectsTarget");
  heistPick(fightGame.engine, [fightGame.id("lootItem")]);
  assert.equal(controllerOf(fightGame.engine, fightGame.id("lootItem")), P1);
});

clause(MASTER_THIEF, "0:rule", "leaving play any way other than being destroyed does not trigger it: returned to my hand", () => {
  const bounce = tactic({
    name: "Bounce",
    cost: 0,
    behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });
  const game = heistBoard({ extra: [{ key: "bounce", def: bounce, owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("bounce"), { selected: { t: [game.id("mt")] } });
  assert.equal(zoneOf(game.engine, game.id("mt")), "hand", "control: bounced");
  assert.equal(pending(game.engine), undefined);
  assert.equal(zoneOf(game.engine, game.id("lootChar")), "discard");
});

clause(MASTER_THIEF, "0:rule", "...removed from the game does not trigger it either", () => {
  const exile = tactic({
    name: "Exile",
    cost: 0,
    behavior: { abilities: [{ id: "x", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "removeFromGame", target: { type: "selected", id: "t" } }] }] }
  });
  const game = heistBoard({ extra: [{ key: "exile", def: exile, owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("exile"), { selected: { t: [game.id("mt")] } });
  assert.equal(zoneOf(game.engine, game.id("mt")), "removed", "control: removed from the game");
  assert.equal(pending(game.engine), undefined);
  assert.equal(zoneOf(game.engine, game.id("lootChar")), "discard");
});

clause(MASTER_THIEF, "0:rule", "destroyed face-down it is only a resource: no trigger", () => {
  const wipe = tactic({
    name: "WipeResource",
    cost: 0,
    behavior: { abilities: [{ id: "w", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "resource" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "mt", def: printing(MASTER_THIEF), owner: P1, zone: "play", faceDown: true },
      { key: "wipe", def: wipe, owner: P1, zone: "hand" },
      loot.item
    ]
  });
  play(game.engine, P1, game.id("wipe"), { selected: { t: [game.id("mt")] } });
  assert.equal(zoneOf(game.engine, game.id("mt")), "discard", "control: destroyed");
  assert.equal(pending(game.engine), undefined);
  assert.equal(zoneOf(game.engine, game.id("lootItem")), "discard");
});

clause(MASTER_THIEF, "0:rule", "the picked card's own enters-play ability fires (it genuinely enters play)", () => {
  const etb = character({
    name: "LootEtb",
    behavior: { abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const game = heistBoard({ withLoot: false, extra: [{ key: "lootEtb", def: etb, owner: P2, zone: "discard" }] });
  killThief(game);
  const handBefore = handOf(game.engine, P1).length;
  heistPick(game.engine, [game.id("lootEtb")]);
  drain(game.engine, declineAll);
  assert.equal(zoneOf(game.engine, game.id("lootEtb")), "play");
  assert.equal(handOf(game.engine, P1).length, handBefore + 1, "its 'when this enters play, draw' resolved for me");
});

clause(MASTER_THIEF, "0:rule", "pays exactly 8, needs [D][D][D], and has the printed 4/3/4 stats", () => {
  const exact = deployChecks((res) => handBoard(MASTER_THIEF, { deception: res.deception, greed: res.greed }), 8, 3);
  assert.equal(zoneOf(exact.engine, exact.id("me")), "play");
  assert.deepEqual(stats(exact.engine, exact.id("me")), [4, 3, 4]);
});

// --- Mendacious Brigand ---------------------------------------------------------------------------------------
// If this card is blocked, you may pick a blocking character and a character your opponent controls that is
// not in a battle. If you do, remove the blocking character from the battle and add the other character to
// the blocking party.   Character, rogue, subtype thief, cost 2, threshold [D], 2/1/2.

const BRIGAND = "fd6ca900-19ab-4786-b4db-7e3c7dbac204";

/** A harmless defender (0 strength) so the Brigand survives the battle. */
const defender = (key: string, owner: Pid = P2, extra: Partial<CardDefinition> = {}): CardPlacement => ({
  key,
  def: character({ name: `Def ${key}`, strength: 0, life: 5, speed: 1, ...extra }),
  owner,
  zone: "play"
});

/** P1 attacks with the Brigand (and `allies`), P2 blocks with `blockWith`; returns with the Brigand's trigger waiting for its picks. */
function brigandBlocked(extra: CardPlacement[], blockWith: string[], opts: { allies?: CardPlacement[] } = {}) {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [{ key: "br", def: printing(BRIGAND), owner: P1, zone: "play" }, ...(opts.allies ?? []), ...extra]
  });
  declareAttackBy(game.engine, P1, ["br", ...(opts.allies ?? []).map((a) => a.key)].map(game.id));
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: blockWith.map(game.id) });
  return game;
}

const brigandPick = (engine: SpoilsEngine, blk: CardInstanceId[], add: CardInstanceId[]) => answerPending(engine, "selectTargets", { selected: { blk, add } });

clause(BRIGAND, "0:rule", "blocked: I pick the blocker and an idle opposing character; the blocker leaves the battle and the idle one blocks instead", () => {
  const { engine, id } = brigandBlocked([defender("b1"), defender("idle")], ["b1"]);
  const pc = pending(engine)!;
  assert.equal(pc.kind, "selectTargets");
  assert.equal(pc.playerId, P1, "I (the Brigand's controller) choose");
  brigandPick(engine, [id("b1")], [id("idle")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("idle")], "the idle character is the blocking party now");
  assert.equal(zoneOf(engine, id("b1")), "play", "the removed blocker is not destroyed");
});

clause(BRIGAND, "0:rule", "with two blockers only the picked one is replaced; the other keeps blocking", () => {
  const { engine, id } = brigandBlocked([defender("b1"), defender("b2"), defender("idle")], ["b1", "b2"]);
  brigandPick(engine, [id("b1")], [id("idle")]);
  assert.deepEqual([...(battleOf(engine)?.blockingParty ?? [])].sort(), [id("b2"), id("idle")].sort());
});

clause(BRIGAND, "0:rule", "damage follows the swap: the Brigand's damage lands on the added character, not on the removed blocker", () => {
  const { engine, id } = brigandBlocked([defender("b1"), defender("idle")], ["b1"]);
  brigandPick(engine, [id("b1")], [id("idle")]);
  autoResolveBattle(engine);
  assert.equal(engine.state.cards[id("idle")].damage, 2, "the Brigand's 2 damage hit the swapped-in blocker");
  assert.equal(engine.state.cards[id("b1")].damage, 0, "the removed blocker took none");
  assert.equal(influence(engine, P2), 30, "the attack was still blocked: the faction took nothing");
});

clause(BRIGAND, "0:rule", "'you may': picking neither leaves the block exactly as it was", () => {
  const { engine, id } = brigandBlocked([defender("b1"), defender("idle")], ["b1"]);
  brigandPick(engine, [], []);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("b1")]);
  assert.equal(pending(engine), undefined);
});

clause(BRIGAND, "0:rule", "'if you do' needs both picks: only a blocker, or only an idle character, changes nothing", () => {
  const onlyBlocker = brigandBlocked([defender("b1"), defender("idle")], ["b1"]);
  brigandPick(onlyBlocker.engine, [onlyBlocker.id("b1")], []);
  assert.deepEqual(battleOf(onlyBlocker.engine)?.blockingParty, [onlyBlocker.id("b1")], "the blocker was not removed without a replacement");

  const onlyAdd = brigandBlocked([defender("b1"), defender("idle")], ["b1"]);
  brigandPick(onlyAdd.engine, [], [onlyAdd.id("idle")]);
  assert.deepEqual(battleOf(onlyAdd.engine)?.blockingParty, [onlyAdd.id("b1")], "the idle character was not added without removing a blocker");
});

clause(BRIGAND, "0:rule", "the first pick must be a BLOCKING character: an idle one, an attacker or a character of mine is refused", () => {
  const { engine, id } = brigandBlocked([defender("b1"), defender("idle"), defender("mine", P1)], ["b1"]);
  refused(() => brigandPick(engine, [id("idle")], [id("idle")]), "an idle character is not blocking");
  refused(() => brigandPick(engine, [id("br")], [id("idle")]), "the attacking Brigand is not a blocker");
  refused(() => brigandPick(engine, [id("mine")], [id("idle")]), "my character is not a blocker");
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("b1")]);
  assert.ok(pending(engine), "still waiting for a legal answer");
  brigandPick(engine, [id("b1")], [id("idle")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("idle")], "control: the legal pair works");
});

clause(BRIGAND, "0:rule", "the second pick must be a character my OPPONENT controls: mine is refused", () => {
  const { engine, id } = brigandBlocked([defender("b1"), defender("idle"), defender("mine", P1)], ["b1"]);
  refused(() => brigandPick(engine, [id("b1")], [id("mine")]), "my own character cannot be added to their blocking party");
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("b1")]);
});

clause(BRIGAND, "0:rule", "...and must NOT be in a battle: another current blocker or an attacker is refused", () => {
  const { engine, id } = brigandBlocked([defender("b1"), defender("b2"), defender("idle")], ["b1", "b2"]);
  refused(() => brigandPick(engine, [id("b1")], [id("b2")]), "b2 is already in the battle");
  refused(() => brigandPick(engine, [id("b1")], [id("br")]), "the Brigand is in the battle");
  assert.deepEqual([...(battleOf(engine)?.blockingParty ?? [])].sort(), [id("b1"), id("b2")].sort());
});

clause(BRIGAND, "0:rule", "only characters: an idle item, location or face-down card cannot be added", () => {
  const { engine, id } = brigandBlocked(
    [
      defender("b1"),
      defender("idle"),
      { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true }
    ],
    ["b1"]
  );
  for (const key of ["gear", "place", "hidden"]) refused(() => brigandPick(engine, [id("b1")], [id(key)]), `${key} is not a character`);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("b1")]);
});

clause(BRIGAND, "0:rule", "a character the opponent controls but I own counts as 'a character your opponent controls'", () => {
  const lent = brigandBlocked([defender("b1"), { key: "lent", def: character({ name: "Lent", strength: 0, life: 5, speed: 1 }), owner: P1, controller: P2, zone: "play" }], ["b1"]);
  brigandPick(lent.engine, [lent.id("b1")], [lent.id("lent")]);
  assert.deepEqual(battleOf(lent.engine)?.blockingParty, [lent.id("lent")]);
});

clause(BRIGAND, "0:rule", "a character I control but the opponent owns is not 'a character your opponent controls': picking it is refused and the blocker is NOT removed", () => {
  const stolen = brigandBlocked([defender("b1"), { key: "stolen", def: character({ name: "Stolen", strength: 0, life: 5, speed: 1 }), owner: P2, controller: P1, zone: "play" }], ["b1"]);
  refused(() => brigandPick(stolen.engine, [stolen.id("b1")], [stolen.id("stolen")]), "I control it");
  assert.deepEqual(battleOf(stolen.engine)?.blockingParty, [stolen.id("b1")], "the block stands: no one may be removed without a legal replacement");
});

clause(BRIGAND, "0:rule", "with no legal idle character at all, picking a blocker alone changes nothing: the block stands", () => {
  const { engine, id } = brigandBlocked([defender("b1")], ["b1"]);
  const pc = pending(engine);
  if (pc) brigandPick(engine, [id("b1")], []);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("b1")]);
});

clause(BRIGAND, "0:rule", "the idle character can be depleted: 'not in a battle' is the only restriction", () => {
  const { engine, id } = brigandBlocked([defender("b1"), { key: "tired", def: character({ name: "Tired", strength: 0, life: 5, speed: 1 }), owner: P2, zone: "play", depleted: true }], ["b1"]);
  brigandPick(engine, [id("b1")], [id("tired")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("tired")]);
});

clause(BRIGAND, "0:rule", "one blocker and one added character: two blockers or two additions are refused", () => {
  const { engine, id } = brigandBlocked([defender("b1"), defender("b2"), defender("idle"), defender("idle2")], ["b1", "b2"]);
  refused(() => brigandPick(engine, [id("b1"), id("b2")], [id("idle")]), "two blockers");
  refused(() => brigandPick(engine, [id("b1")], [id("idle"), id("idle2")]), "two additions");
  assert.deepEqual([...(battleOf(engine)?.blockingParty ?? [])].sort(), [id("b1"), id("b2")].sort());
});

clause(BRIGAND, "0:rule", "it only happens when the BRIGAND is blocked: unblocked, there is no prompt", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [{ key: "br", def: printing(BRIGAND), owner: P1, zone: "play" }, defender("b1"), defender("idle")]
  });
  declareAttackBy(game.engine, P1, [game.id("br")]);
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  assert.equal(pending(game.engine), undefined);
});

clause(BRIGAND, "0:rule", "...not when only a different attacker is blocked", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [{ key: "br", def: printing(BRIGAND), owner: P1, zone: "play" }, defender("ally", P1), defender("b1"), defender("idle")]
  });
  declareAttackBy(game.engine, P1, [game.id("ally")]);
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [game.id("b1")] });
  assert.equal(pending(game.engine), undefined, "the Brigand isn't attacking");
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("b1")]);
});

clause(BRIGAND, "0:rule", "...and not when the Brigand is the BLOCKER", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [{ key: "br", def: printing(BRIGAND), owner: P1, zone: "play" }, defender("atk", P2), defender("idle", P2)]
  });
  declareAttackBy(game.engine, P2, [game.id("atk")]);
  game.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [game.id("br")] });
  assert.equal(pending(game.engine), undefined);
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("br")]);
});

clause(BRIGAND, "0:rule", "in a party with an ally that is blocked, the Brigand is blocked too and its rule applies", () => {
  const { engine, id } = brigandBlocked([defender("b1"), defender("idle")], ["b1"], { allies: [defender("ally", P1)] });
  const pc = pending(engine);
  assert.ok(pc && pc.kind === "selectTargets", "the Brigand's party was blocked");
  brigandPick(engine, [id("b1")], [id("idle")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("idle")]);
});

clause(BRIGAND, "0:rule", "the swap is for this battle only: afterwards the removed blocker is an ordinary character again (not depleted by it)", () => {
  const { engine, id } = brigandBlocked([defender("b1"), defender("idle")], ["b1"]);
  brigandPick(engine, [id("b1")], [id("idle")]);
  autoResolveBattle(engine);
  assert.equal(isDepleted(engine, id("b1")), false, "the removed blocker never fought, so it is not depleted");
  assert.equal(zoneOf(engine, id("b1")), "play");
});

clause(BRIGAND, "0:rule", "pays exactly 2, needs [D], and has the printed 2/1/2 stats", () => {
  const exact = deployChecks((res) => handBoard(BRIGAND, { deception: res.deception, greed: res.greed }), 2, 1);
  assert.equal(zoneOf(exact.engine, exact.id("me")), "play");
  assert.deepEqual(stats(exact.engine, exact.id("me")), [2, 1, 2]);
});

// --- Mercenary's Creed -------------------------------------------------------------------------------------
// ATTACH TO CHARACTER -- BRIBE -- COST: Both players may use this ability. Pay 3. EFFECT: Take control of the
// attached character. -- BLACKMAIL -- COST: Use this only if you own this card. Pay 2. EFFECT: Take control of
// the attached character.   Item, rogue, subtype gear, cost 3, threshold [D][D].

const CREED = "837d5a93-213d-4e5d-af65-0a6c14c55c7c";

interface CreedOpts {
  /** Who controls / owns the Creed in play (default P1 / P1). */
  creedController?: Pid;
  creedOwner?: Pid;
  hostController?: Pid;
  hostOwner?: Pid;
  p1Resources?: number;
  p2Resources?: number;
  turn?: number;
  active?: Pid;
  extra?: CardPlacement[];
}

/** The Creed (key `creed`) in play, attached to `host`. Defaults: a P2 character, Creed owned and controlled by P1, P1's turn. */
function creedBoard(opts: CreedOpts = {}) {
  const hostOwner = opts.hostOwner ?? P2;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "host", def: character({ name: "Host", strength: 2, life: 3, speed: 2 }), owner: hostOwner, controller: opts.hostController, zone: "play" },
      { key: "creed", def: printing(CREED), owner: opts.creedOwner ?? P1, controller: opts.creedController, zone: "play", attachedToKey: "host" },
      ...bank("deception", opts.p1Resources ?? 6, P1),
      ...bank("deception", opts.p2Resources ?? 6, P2),
      ...(opts.extra ?? [])
    ]
  });
}

/** The Creed in P1's hand, a P2 character `host`, P1 resources. */
function creedHand(opts: HandOpts = {}) {
  return handBoard(CREED, {
    deception: 6,
    ...opts,
    extra: [
      { key: "host", def: character({ name: "Host", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}

clause(CREED, "0:attach", "played from hand it attaches to the character I pick and enters play attached to it", () => {
  const { engine, id } = creedHand();
  play(engine, P1, id("me"), { selected: { attachTo: [id("host")] } });
  assert.equal(zoneOf(engine, id("me")), "play");
  assert.equal(engine.state.cards[id("me")].attachedTo, id("host"));
  assert.equal(controllerOf(engine, id("me")), P1, "I control the Creed, whoever controls its host");
  assert.equal(controllerOf(engine, id("host")), P2, "the host's controller is unchanged by attaching");
});

clause(CREED, "0:attach", "it can attach to one of my own characters as well", () => {
  const { engine, id } = creedHand();
  play(engine, P1, id("me"), { selected: { attachTo: [id("mine")] } });
  assert.equal(engine.state.cards[id("me")].attachedTo, id("mine"));
});

clause(CREED, "0:attach", "it only attaches to a CHARACTER: an item, a location, a faction and a face-down card are refused", () => {
  const { engine, id } = creedHand({
    extra: [
      { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true }
    ]
  });
  for (const key of ["gear", "place", "hidden"]) refused(() => playRaw(engine, P1, id("me"), { selected: { attachTo: [id(key)] } }), `${key} is not a character`);
  refused(() => playRaw(engine, P1, id("me"), { selected: { attachTo: [factionOf(engine, P2)] } }), "a faction is not a character");
  assert.equal(zoneOf(engine, id("me")), "hand", "nothing was played");
});

clause(CREED, "0:attach", "a host must be picked (the pick is an extra cost): none, or two, are refused", () => {
  const { engine, id } = creedHand();
  refused(() => playRaw(engine, P1, id("me"), { selected: {} }), "no host");
  refused(() => playRaw(engine, P1, id("me"), { selected: { attachTo: [id("host"), id("mine")] } }), "two hosts");
  assert.equal(zoneOf(engine, id("me")), "hand");
});

clause(CREED, "0:attach", "with no character in play at all it cannot be played", () => {
  const { engine, id } = handBoard(CREED, { deception: 6 });
  refused(() => playRaw(engine, P1, id("me"), { selected: {} }), "nothing to attach to");
  assert.equal(zoneOf(engine, id("me")), "hand");
});

clause(CREED, "0:attach", "when the host is destroyed the Creed goes with it (to its owner's discard pile)", () => {
  const { engine, id } = creedBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("kill"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "discard");
  assert.equal(zoneOf(engine, id("creed")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("creed")), "discardOf(engine, P1).includes(id(\"creed\"))");
});

clause(CREED, "0:attach", "when the host is returned to its owner's hand the Creed leaves play the same way (CR 301.4a): it goes to its owner's hand, not the discard pile", () => {
  const bounce = tactic({
    name: "Bounce",
    cost: 0,
    behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });
  const { engine, id } = creedBoard({ extra: [{ key: "bounce", def: bounce, owner: P1, zone: "hand" }] });
  play(engine, P1, id("bounce"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "hand", "control: the host was returned to hand");
  assert.equal(zoneOf(engine, id("creed")), "hand", "the attached Creed leaves play the same way");
});

clause(CREED, "0:attach", "pays exactly 3, needs [D][D], and is refused one resource short or without the threshold", () => {
  const exact = deployChecks((res) => creedHand({ deception: res.deception, greed: res.greed }), 3, 2, (id) => ({ attachTo: [id("host")] }));
  assert.equal(zoneOf(exact.engine, exact.id("me")), "play");
});

clause(CREED, "1:ability:bribe", "I pay 3 and take control of the attached character (the opponent's)", () => {
  const { engine, id } = creedBoard();
  const before = ready(engine);
  activate(engine, P1, id("creed"), "bribe");
  assert.equal(before - ready(engine), 3, "exactly 3 is paid");
  assert.equal(controllerOf(engine, id("host")), P1);
  assert.equal(engine.state.cards[id("host")].ownerId, P2, "ownership never changes");
  assert.equal(zoneOf(engine, id("creed")), "play", "the Creed stays");
  assert.equal(engine.state.cards[id("creed")].attachedTo, id("host"), "still attached to the host");
});

clause(CREED, "1:ability:bribe", "'both players may use this ability': the opponent can use it on their turn, paying 3 of THEIR resources, and takes control of the host", () => {
  const { engine, id } = creedBoard({ hostOwner: P1, turn: 2, active: P2 });
  assert.equal(controllerOf(engine, id("host")), P1, "control: the host is mine");
  const mine = ready(engine, P1);
  const theirs = ready(engine, P2);
  activate(engine, P2, id("creed"), "bribe");
  assert.equal(theirs - ready(engine, P2), 3, "they pay 3");
  assert.equal(ready(engine, P1), mine, "I pay nothing");
  assert.equal(controllerOf(engine, id("host")), P2, "the host is theirs now");
  assert.equal(controllerOf(engine, id("creed")), P1, "the Creed stays under my control");
});

clause(CREED, "1:ability:bribe", "...and in response on my turn", () => {
  const { engine, id } = creedBoard({
    hostOwner: P1,
    turn: 2,
    active: P1,
    extra: [{ key: "nothing", def: nothingTactic(), owner: P1, zone: "hand" }]
  });
  playRaw(engine, P1, id("nothing"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "control: the opponent may respond");
  activateRaw(engine, P2, id("creed"), "bribe");
  resolvePendingResponses(engine);
  assert.equal(controllerOf(engine, id("host")), P2);
});

clause(CREED, "1:ability:bribe", "needs the full 3: refused with 2 resources (either player), allowed with exactly 3", () => {
  const mineShort = creedBoard({ p1Resources: 2 });
  refused(() => activate(mineShort.engine, P1, mineShort.id("creed"), "bribe"), "I have 2");
  assert.equal(controllerOf(mineShort.engine, mineShort.id("host")), P2);
  const theirShort = creedBoard({ hostOwner: P1, turn: 2, active: P2, p2Resources: 2 });
  refused(() => activate(theirShort.engine, P2, theirShort.id("creed"), "bribe"), "they have 2");
  const exact = creedBoard({ p1Resources: 3 });
  activate(exact.engine, P1, exact.id("creed"), "bribe");
  assert.equal(controllerOf(exact.engine, exact.id("host")), P1);
  assert.equal(ready(exact.engine), 0);
});

clause(CREED, "1:ability:bribe", "it is available to both players in the ability listing", () => {
  const theirTurn = creedBoard({ hostOwner: P1, turn: 2, active: P2 });
  const theirs = theirTurn.engine.getAvailableActivatedAbilities(P2).filter((a) => a.cardId === theirTurn.id("creed")).map((a) => a.ability.id);
  assert.ok(theirs.includes("bribe"), "the opponent is offered BRIBE");
  assert.equal(theirs.includes("blackmail"), false, "...but not BLACKMAIL");
  const myTurn = creedBoard();
  const mine = myTurn.engine.getAvailableActivatedAbilities(P1).filter((a) => a.cardId === myTurn.id("creed")).map((a) => a.ability.id);
  assert.ok(mine.includes("bribe"), "and so am I (as the Creed's controller)");
  assert.ok(mine.includes("blackmail"), "I own it, so BLACKMAIL is offered to me too");
});

clause(CREED, "1:ability:bribe", "a bribed character can be bribed back: BRIBE goes back and forth for 3 each time", () => {
  const { engine, id } = creedBoard({ hostOwner: P1, turn: 2, active: P2 });
  activate(engine, P2, id("creed"), "bribe");
  assert.equal(controllerOf(engine, id("host")), P2);
  endTurn(engine, P2);
  activate(engine, P1, id("creed"), "bribe");
  assert.equal(controllerOf(engine, id("host")), P1);
});

clause(CREED, "1:ability:bribe", "the cost is paid when it is used, the control change comes after the opponent could respond", () => {
  const { engine, id } = creedBoard();
  const before = ready(engine);
  activateRaw(engine, P1, id("creed"), "bribe");
  assert.equal(before - ready(engine), 3);
  assert.equal(controllerOf(engine, id("host")), P2, "not yet");
  resolvePendingResponses(engine);
  assert.equal(controllerOf(engine, id("host")), P1);
});

clause(CREED, "2:ability:blackmail", "I own and control the Creed: I pay 2 and take control of the attached character", () => {
  const { engine, id } = creedBoard();
  const before = ready(engine);
  activate(engine, P1, id("creed"), "blackmail");
  assert.equal(before - ready(engine), 2, "exactly 2 is paid");
  assert.equal(controllerOf(engine, id("host")), P1);
});

clause(CREED, "2:ability:blackmail", "'only if you own this card': a Creed I control but the opponent owns cannot be used for BLACKMAIL (BRIBE still works)", () => {
  const { engine, id } = creedBoard({ creedOwner: P2, creedController: P1 });
  assert.equal(controllerOf(engine, id("creed")), P1, "control: I control it");
  assert.equal(engine.state.cards[id("creed")].ownerId, P2, "control: they own it");
  const offered = engine.getAvailableActivatedAbilities(P1).filter((a) => a.cardId === id("creed")).map((a) => a.ability.id);
  assert.ok(offered.includes("bribe"), "BRIBE is offered");
  assert.equal(offered.includes("blackmail"), false, "BLACKMAIL is not offered to someone who doesn't own the card");
  refused(() => activate(engine, P1, id("creed"), "blackmail"), "I don't own it");
  assert.equal(controllerOf(engine, id("host")), P2);
});

clause(CREED, "2:ability:blackmail", "the owner who does not control it cannot use it either, and neither can a controller who does not own it", () => {
  const { engine, id } = creedBoard({ creedOwner: P1, creedController: P2, turn: 2, active: P2, hostOwner: P1 });
  refused(() => activate(engine, P1, id("creed"), "blackmail"), "P1 owns it but does not control it, and it is not P1's turn");
  refused(() => activate(engine, P2, id("creed"), "blackmail"), "P2 controls it but doesn't own it");
  assert.equal(controllerOf(engine, id("host")), P1);
});

clause(CREED, "2:ability:blackmail", "needs 2 resources: refused with 1, allowed with exactly 2", () => {
  const short = creedBoard({ p1Resources: 1 });
  refused(() => activate(short.engine, P1, short.id("creed"), "blackmail"), "1 < 2");
  assert.equal(controllerOf(short.engine, short.id("host")), P2);
  const exact = creedBoard({ p1Resources: 2 });
  activate(exact.engine, P1, exact.id("creed"), "blackmail");
  assert.equal(controllerOf(exact.engine, exact.id("host")), P1);
  assert.equal(ready(exact.engine), 0);
});

clause(CREED, "2:ability:blackmail", "the opponent cannot BLACKMAIL with a Creed I own and control", () => {
  const { engine, id } = creedBoard({ hostOwner: P1, turn: 2, active: P2 });
  refused(() => activate(engine, P2, id("creed"), "blackmail"), "only its owner may");
  assert.equal(controllerOf(engine, id("host")), P1);
});

// --- Misappropriation Machine --------------------------------------------------------------------------------------
// STEAL -- COST: Deplete this card. Pick a character or item in your opponent's discard pile.
// EFFECT: Put the character or item into play under your control. Your opponent takes control of this card.
// Item, rogue, cost 3, threshold [D][D].

const MACHINE = "5afd2312-a6aa-4aca-bc1e-2fb4eb78183d";

function machineBoard(opts: { depleted?: boolean; turn?: number; active?: Pid; extra?: CardPlacement[]; controller?: Pid; owner?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "mm", def: printing(MACHINE), owner: opts.owner ?? P1, controller: opts.controller, zone: "play", depleted: opts.depleted },
      { key: "corpse", def: character({ name: "Corpse", strength: 2, life: 2, speed: 2 }), owner: P2, zone: "discard" },
      { key: "relic", def: item({ name: "Relic", cost: 2 }), owner: P2, zone: "discard" },
      { key: "ruin", def: location({ name: "Ruin", structure: 3 }), owner: P2, zone: "discard" },
      { key: "staple", def: resourceCard({ name: "Staple" }), owner: P2, zone: "discard" },
      { key: "spell", def: tactic({ name: "Spell", cost: 1, behavior: { abilities: [{ id: "s", type: "activated", effects: [] }] } }), owner: P2, zone: "discard" },
      { key: "mine", def: character({ name: "MyDead" }), owner: P1, zone: "discard" },
      { key: "oppHand", def: character({ name: "OppHand" }), owner: P2, zone: "hand" },
      { key: "oppDeck", def: character({ name: "OppDeck" }), owner: P2, zone: "deck" },
      { key: "oppPlay", def: character({ name: "OppPlay" }), owner: P2, zone: "play" },
      ...bank("deception", 2, P1),
      ...(opts.extra ?? [])
    ]
  });
}

clause(MACHINE, "0:ability:steal", "a character in their discard pile enters play under MY control, and my opponent takes control of the Machine", () => {
  const { engine, id } = machineBoard();
  activate(engine, P1, id("mm"), "steal", { selected: { pick: [id("corpse")] } });
  assert.equal(zoneOf(engine, id("corpse")), "play");
  assert.equal(controllerOf(engine, id("corpse")), P1);
  assert.equal(engine.state.cards[id("corpse")].ownerId, P2, "ownership never changes");
  assert.equal(controllerOf(engine, id("mm")), P2, "the Machine passed to my opponent");
  assert.equal(engine.state.cards[id("mm")].ownerId, P1);
  assert.equal(zoneOf(engine, id("mm")), "play");
});

clause(MACHINE, "0:ability:steal", "...an ITEM works the same way", () => {
  const { engine, id } = machineBoard();
  activate(engine, P1, id("mm"), "steal", { selected: { pick: [id("relic")] } });
  assert.equal(zoneOf(engine, id("relic")), "play");
  assert.equal(controllerOf(engine, id("relic")), P1);
  assert.equal(controllerOf(engine, id("mm")), P2);
});

clause(MACHINE, "0:ability:steal", "only a character or an item: a location, a resource and a tactic in their discard pile are refused", () => {
  const { engine, id } = machineBoard();
  for (const key of ["ruin", "staple", "spell"]) {
    refused(() => activate(engine, P1, id("mm"), "steal", { selected: { pick: [id(key)] } }), `${key} cannot be picked`);
    assert.equal(zoneOf(engine, id(key)), "discard");
  }
  assert.equal(isDepleted(engine, id("mm")), false, "refused attempts cost nothing");
  assert.equal(controllerOf(engine, id("mm")), P1);
});

clause(MACHINE, "0:ability:steal", "only THEIR discard pile: my discard pile, their hand, their deck and their cards in play are refused", () => {
  const { engine, id } = machineBoard();
  for (const key of ["mine", "oppHand", "oppDeck", "oppPlay"]) {
    refused(() => activate(engine, P1, id("mm"), "steal", { selected: { pick: [id(key)] } }), `${key} is not in their discard pile`);
  }
  assert.equal(zoneOf(engine, id("mine")), "discard");
  assert.equal(controllerOf(engine, id("mm")), P1);
});

clause(MACHINE, "0:ability:steal", "exactly one card: none, or two, are refused", () => {
  const { engine, id } = machineBoard();
  refused(() => activate(engine, P1, id("mm"), "steal", { selected: {} }), "a pick is required");
  refused(() => activate(engine, P1, id("mm"), "steal", { selected: { pick: [id("corpse"), id("relic")] } }), "one card");
  assert.equal(zoneOf(engine, id("corpse")), "discard");
  assert.equal(zoneOf(engine, id("relic")), "discard");
});

clause(MACHINE, "0:ability:steal", "the cost: Deplete this card, paid at activation, with no resources spent", () => {
  const { engine, id } = machineBoard();
  const before = ready(engine);
  activateRaw(engine, P1, id("mm"), "steal", { pick: [id("corpse")] });
  assert.ok(engine.state.responseWindow, "control: awaiting responses");
  assert.equal(isDepleted(engine, id("mm")), true);
  assert.equal(ready(engine), before, "deplete costs no resources");
  assert.equal(zoneOf(engine, id("corpse")), "discard", "the effect has not happened yet");
});

clause(MACHINE, "0:ability:steal", "an already depleted Machine cannot be used", () => {
  const { engine, id } = machineBoard({ depleted: true });
  refused(() => activate(engine, P1, id("mm"), "steal", { selected: { pick: [id("corpse")] } }), "already depleted");
  assert.equal(zoneOf(engine, id("corpse")), "discard");
});

clause(MACHINE, "0:ability:steal", "with nothing legal in their discard pile it cannot be used (and nothing is depleted)", () => {
  const { engine, id } = machineBoard({ extra: [] });
  for (const key of ["corpse", "relic"]) engine.state.players[P2].discard = engine.state.players[P2].discard.filter((c) => c !== id(key));
  refused(() => activate(engine, P1, id("mm"), "steal", { selected: {} }), "no legal pick");
  assert.equal(isDepleted(engine, id("mm")), false);
});

clause(MACHINE, "0:ability:steal", "the new controller (my opponent) can use it on MY discard pile once it is restored, and it comes back to me", () => {
  const { engine, id } = machineBoard({
    extra: [{ key: "myCorpse", def: character({ name: "MyCorpse", strength: 1, life: 2, speed: 1 }), owner: P1, zone: "discard" }]
  });
  activate(engine, P1, id("mm"), "steal", { selected: { pick: [id("corpse")] } });
  assert.equal(controllerOf(engine, id("mm")), P2);
  assert.equal(isDepleted(engine, id("mm")), true, "it arrives depleted");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(isDepleted(engine, id("mm")), false, "their restore untapped it at the start of their turn");
  activate(engine, P2, id("mm"), "steal", { selected: { pick: [id("myCorpse")] } });
  assert.equal(controllerOf(engine, id("myCorpse")), P2, "they took my dead character");
  assert.equal(controllerOf(engine, id("mm")), P1, "and the Machine came back to me ('your opponent' is now me)");
});

clause(MACHINE, "0:ability:steal", "the new controller cannot use it on their own discard pile: 'your opponent's' is now my discard pile only", () => {
  const { engine, id } = machineBoard({ controller: P2, owner: P1, turn: 2, active: P2 });
  refused(() => activate(engine, P2, id("mm"), "steal", { selected: { pick: [id("corpse")] } }), "corpse is in P2's own discard pile");
  assert.equal(zoneOf(engine, id("corpse")), "discard");
});

clause(MACHINE, "0:ability:steal", "the opponent cannot use my Machine", () => {
  const { engine, id } = machineBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "myCorpse", def: character({ name: "MyCorpse" }), owner: P1, zone: "discard" }]
  });
  refused(() => activate(engine, P2, id("mm"), "steal", { selected: { pick: [id("myCorpse")] } }), "P2 does not control it");
  assert.equal(controllerOf(engine, id("mm")), P1);
});

clause(MACHINE, "0:ability:steal", "the card put into play has its own enters-play ability triggered for me", () => {
  const etb = character({
    name: "CorpseEtb",
    behavior: { abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const { engine, id } = machineBoard({
    extra: [{ key: "etb", def: etb, owner: P2, zone: "discard" }, ...deckOfFillers("m", 3, P1)]
  });
  const handBefore = handOf(engine, P1).length;
  activate(engine, P1, id("mm"), "steal", { selected: { pick: [id("etb")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("etb")), "play");
  assert.equal(handOf(engine, P1).length, handBefore + 1, "I drew from its trigger");
});

clause(MACHINE, "0:ability:steal", "usable on the opponent's turn in response", () => {
  const { engine, id } = machineBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "attacker", def: character({ name: "Attacker", life: 9 }), owner: P2, zone: "play" }]
  });
  openDefenderWindow(engine, id("attacker"));
  activateRaw(engine, P1, id("mm"), "steal", { pick: [id("corpse")] });
  resolvePendingResponses(engine);
  assert.equal(controllerOf(engine, id("corpse")), P1);
  assert.equal(controllerOf(engine, id("mm")), P2);
});

clause(MACHINE, "0:ability:steal", "pays exactly 3, needs [D][D]", () => {
  const exact = deployChecks((res) => handBoard(MACHINE, { deception: res.deception, greed: res.greed }), 3, 2);
  assert.equal(zoneOf(exact.engine, exact.id("me")), "play");
  assert.equal(controllerOf(exact.engine, exact.id("me")), P1, "it enters play under MY control (only STEAL hands it over)");
});

// --- Orgy Den Smoke Out ---------------------------------------------------------------------------------------------
// Your opponent must discard a card at random. Put the top 2 cards of their deck into their discard pile.
// Tactic, rogue, cost 2, threshold [D][D].

const SMOKE_OUT = "92083650-6785-4b9a-ba1c-542a348b22aa";

function smokeBoard(opts: HandOpts & { oppHand?: number; oppDeck?: number } = {}) {
  return handBoard(SMOKE_OUT, {
    ...opts,
    extra: [
      ...fillers("oh", opts.oppHand ?? 3, P2, "hand"),
      ...deckOfFillers("o", opts.oppDeck ?? 6, P2),
      ...deckOfFillers("m", 3, P1),
      { key: "myOther", def: character({ name: "MyOther" }), owner: P1, zone: "hand" },
      ...(opts.extra ?? [])
    ]
  });
}

const oppHandIds = (engine: SpoilsEngine) => [...handOf(engine, P2)];

clause(SMOKE_OUT, "0:rule", "the opponent discards exactly one card from their hand, into THEIR discard pile", () => {
  const { engine, id } = smokeBoard();
  const hand = oppHandIds(engine);
  play(engine, P1, id("me"), { selected: { pool: hand } });
  assert.equal(handOf(engine, P2).length, 2, "one card left their hand");
  const gone = hand.filter((c) => !handOf(engine, P2).includes(c));
  assert.equal(gone.length, 1);
  assert.equal(zoneOf(engine, gone[0]), "discard");
  assert.ok(discardOf(engine, P2).includes(gone[0]), "discardOf(engine, P2).includes(gone[0])");
});

clause(SMOKE_OUT, "0:rule", "it is RANDOM: with different random results each of their three cards is the one discarded", () => {
  const discarded = new Set<number>();
  for (const value of [0.0, 0.34, 0.5, 0.67, 0.99]) {
    const { engine, id } = smokeBoard({ random: () => value });
    const hand = oppHandIds(engine);
    play(engine, P1, id("me"), { selected: { pool: hand } });
    const gone = hand.filter((c) => !handOf(engine, P2).includes(c));
    assert.equal(gone.length, 1, `random ${value}`);
    discarded.add(hand.indexOf(gone[0]));
  }
  assert.deepEqual([...discarded].sort(), [0, 1, 2], "every card of their hand can be the one discarded");
});

clause(SMOKE_OUT, "0:rule", "the caster does not choose the pool: played with no cards named, a random card of their whole hand is still discarded", () => {
  const { engine, id } = smokeBoard({ random: () => 0.5 });
  play(engine, P1, id("me"), { selected: {} });
  assert.equal(handOf(engine, P2).length, 2, "one card was discarded even though I named none");
});

clause(SMOKE_OUT, "0:rule", "the caster cannot narrow the random pool: naming only one of their cards still discards a random card of the WHOLE hand", () => {
  const seen = new Set<number>();
  for (const value of [0.0, 0.5, 0.99]) {
    const { engine, id } = smokeBoard({ random: () => value });
    const hand = oppHandIds(engine);
    play(engine, P1, id("me"), { selected: { pool: [hand[0]] } });
    const gone = hand.filter((c) => !handOf(engine, P2).includes(c));
    assert.equal(gone.length, 1);
    seen.add(hand.indexOf(gone[0]));
  }
  assert.ok(seen.size > 1, "the card discarded varies with the random result, whatever I named");
});

clause(SMOKE_OUT, "0:rule", "the opponent does not choose: they get no prompt for the discard", () => {
  const { engine, id } = smokeBoard();
  play(engine, P1, id("me"), { selected: { pool: oppHandIds(engine) } });
  assert.equal(pending(engine), undefined);
});

clause(SMOKE_OUT, "0:rule", "then the top 2 cards of their deck go to their discard pile: exactly those two, the rest of the deck is untouched", () => {
  const { engine, id } = smokeBoard();
  const oppDeck = [...deckOf(engine, P2)];
  play(engine, P1, id("me"), { selected: { pool: oppHandIds(engine) } });
  assert.deepEqual(deckOf(engine, P2), oppDeck.slice(2), "the rest of the deck, in order");
  for (const cardId of oppDeck.slice(0, 2)) assert.equal(zoneOf(engine, cardId), "discard");
  assert.equal(discardOf(engine, P2).length, 3, "1 discarded from hand + 2 from the deck");
});

clause(SMOKE_OUT, "0:rule", "the discarded card is from their HAND, never from the milled cards: their hand is exactly one card smaller", () => {
  const { engine, id } = smokeBoard();
  const hand = oppHandIds(engine);
  play(engine, P1, id("me"), { selected: { pool: hand } });
  assert.equal(handOf(engine, P2).length, hand.length - 1);
  assert.equal(deckOf(engine, P2).length, 4);
});

clause(SMOKE_OUT, "0:rule", "an empty opposing hand: nothing to discard, but the 2 cards are still put into their discard pile", () => {
  const { engine, id } = smokeBoard({ oppHand: 0 });
  play(engine, P1, id("me"), { selected: {} });
  assert.equal(discardOf(engine, P2).length, 2);
  assert.equal(deckOf(engine, P2).length, 4);
  assert.equal(pending(engine), undefined);
});

clause(SMOKE_OUT, "0:rule", "a one-card hand is discarded for sure", () => {
  const { engine, id } = smokeBoard({ oppHand: 1 });
  play(engine, P1, id("me"), { selected: { pool: oppHandIds(engine) } });
  assert.equal(handOf(engine, P2).length, 0);
  assert.equal(discardOf(engine, P2).length, 3);
});

clause(SMOKE_OUT, "0:rule", "a deck of 1 card: only that card is put into the discard pile; an empty deck is harmless", () => {
  const one = smokeBoard({ oppDeck: 1 });
  play(one.engine, P1, one.id("me"), { selected: { pool: oppHandIds(one.engine) } });
  assert.equal(deckOf(one.engine, P2).length, 0);
  assert.equal(discardOf(one.engine, P2).length, 2, "1 from hand + the 1-card deck");
  const none = smokeBoard({ oppDeck: 0 });
  play(none.engine, P1, none.id("me"), { selected: { pool: oppHandIds(none.engine) } });
  assert.equal(discardOf(none.engine, P2).length, 1);
});

clause(SMOKE_OUT, "0:rule", "my own hand, deck and discard pile are untouched (only the opponent loses cards)", () => {
  const { engine, id } = smokeBoard();
  const myDeck = [...deckOf(engine, P1)];
  play(engine, P1, id("me"), { selected: { pool: oppHandIds(engine) } });
  assert.deepEqual(deckOf(engine, P1), myDeck);
  assert.equal(zoneOf(engine, id("myOther")), "hand");
  assert.deepEqual(discardOf(engine, P1), [id("me")], "only the tactic itself");
});

clause(SMOKE_OUT, "0:rule", "my own cards are never the ones discarded: naming them changes nothing, a card of the OPPONENT's hand goes", () => {
  const { engine, id } = smokeBoard();
  play(engine, P1, id("me"), { selected: { pool: [id("myOther")] } });
  assert.equal(zoneOf(engine, id("myOther")), "hand", "my hand card stays");
  assert.equal(handOf(engine, P2).length, 2, "one of the opponent's three cards was discarded");
});

clause(SMOKE_OUT, "0:rule", "pays exactly 2, needs [D][D], and the tactic ends in my discard pile", () => {
  const exact = deployChecks((res) => smokeBoard({ deception: res.deception, greed: res.greed }), 2, 2, (id) => ({ pool: [id("oh0"), id("oh1"), id("oh2")] }));
  assert.equal(zoneOf(exact.engine, exact.id("me")), "discard");
});

// --- Poisoned Blade --------------------------------------------------------------------------------------------------
// ATTACH TO CHARACTER -- If the attached character inflicts damage to a character, destroy the damaged character.
// -- HANDOFF -- COST: Deplete a character you control that is not in a battle. EFFECT: Attach this card to the
// character.   Item, rogue, subtype gear, cost 3, threshold [D].

const BLADE = "239caecc-f9ed-4cf3-bcd1-aed627b6bbab";

function bladeBoard(opts: { hostStrength?: number; victimLife?: number; extra?: CardPlacement[]; turn?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    activePlayerId: P1,
    cards: [
      { key: "host", def: character({ name: "Host", strength: opts.hostStrength ?? 1, life: 6, speed: 2 }), owner: P1, zone: "play" },
      { key: "blade", def: printing(BLADE), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 6, speed: 2 }), owner: P1, zone: "play" },
      { key: "victim", def: character({ name: "Victim", strength: 0, life: opts.victimLife ?? 10, speed: 1 }), owner: P2, zone: "play" },
      { key: "victim2", def: character({ name: "Victim2", strength: 0, life: 10, speed: 1 }), owner: P2, zone: "play" },
      ...bank("deception", 3, P1),
      ...(opts.extra ?? [])
    ]
  });
}

clause(BLADE, "1:rule", "the attached character damages a blocker (1 damage against 10 life): the damaged character is destroyed", () => {
  const { engine, id } = bladeBoard();
  fight(engine, P1, [id("host")], { type: "faction", playerId: P2 }, [id("victim")]);
  assert.equal(zoneOf(engine, id("victim")), "discard", "destroyed by 1 damage");
  assert.ok(discardOf(engine, P2).includes(id("victim")), "discardOf(engine, P2).includes(id(\"victim\"))");
  assert.equal(zoneOf(engine, id("host")), "play");
});

clause(BLADE, "1:rule", "works when the attached character BLOCKS: the attacker it damages is destroyed", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "host", def: character({ name: "Host", strength: 1, life: 6, speed: 2 }), owner: P1, zone: "play" },
      { key: "blade", def: printing(BLADE), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "atk", def: character({ name: "Attacker", strength: 0, life: 10, speed: 1 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(game.engine, P2, [game.id("atk")]);
  game.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [game.id("host")] });
  autoResolveBattle(game.engine);
  assert.equal(zoneOf(game.engine, game.id("atk")), "discard");
});

clause(BLADE, "1:rule", "no damage, no destruction: a 0-strength host does not destroy what it blocks", () => {
  const { engine, id } = bladeBoard({ hostStrength: 0 });
  fight(engine, P1, [id("host")], { type: "faction", playerId: P2 }, [id("victim")]);
  assert.equal(zoneOf(engine, id("victim")), "play");
});

clause(BLADE, "1:rule", "damage to a FACTION destroys nothing: unblocked, the faction loses influence and no character is destroyed", () => {
  const { engine, id } = bladeBoard();
  fight(engine, P1, [id("host")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence(engine, P2), 29);
  assert.equal(zoneOf(engine, id("victim")), "play");
  assert.equal(zoneOf(engine, id("victim2")), "play");
  assert.equal(zoneOf(engine, id("blade")), "play");
});

clause(BLADE, "1:rule", "only the ATTACHED character: another character of mine damaging a blocker does not destroy it", () => {
  const { engine, id } = bladeBoard();
  declareAttackBy(engine, P1, [id("host"), id("ally")]);
  declareBlockers(engine, P2, [id("victim"), id("victim2")]);
  autoResolveBattle(engine, (source) =>
    source.strength > 0 ? [{ sourceId: source.cardId, target: { type: "card", cardId: source.cardId === id("host") ? id("victim") : id("victim2") }, amount: source.strength }] : []
  );
  assert.equal(zoneOf(engine, id("victim")), "discard", "damaged by the host");
  assert.equal(zoneOf(engine, id("victim2")), "play", "damaged only by the ally: survives");
  assert.equal(engine.state.cards[id("victim2")].damage, 1);
});

clause(BLADE, "1:rule", "'the damaged character' only: the other blocker stays when the host's damage goes to one of two", () => {
  const { engine, id } = bladeBoard();
  fight(engine, P1, [id("host")], { type: "faction", playerId: P2 }, [id("victim"), id("victim2")]);
  const destroyed = [id("victim"), id("victim2")].filter((c) => zoneOf(engine, c) === "discard");
  assert.equal(destroyed.length, 1, "exactly the character the host damaged");
});

clause(BLADE, "1:rule", "any damage the host inflicts counts, not only battle damage: an ability of the host that deals 1 damage destroys the target", () => {
  const sniper = character({
    name: "SniperHost",
    strength: 1,
    life: 4,
    behavior: {
      abilities: [
        {
          id: "snipe",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }]
        }
      ]
    }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "host", def: sniper, owner: P1, zone: "play" },
      { key: "blade", def: printing(BLADE), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "victim", def: character({ name: "Victim", life: 10 }), owner: P2, zone: "play" }
    ]
  });
  activate(engine, P1, id("host"), "snipe", { selected: { t: [id("victim")] } });
  assert.equal(zoneOf(engine, id("victim")), "discard");
});

clause(BLADE, "1:rule", "without the Blade the same damage does not destroy (control)", () => {
  const { engine, id } = buildGame({
    turn: 2,
    cards: [
      { key: "host", def: character({ name: "Host", strength: 1, life: 6, speed: 2 }), owner: P1, zone: "play" },
      { key: "victim", def: character({ name: "Victim", strength: 0, life: 10, speed: 1 }), owner: P2, zone: "play" }
    ]
  });
  fight(engine, P1, [id("host")], { type: "faction", playerId: P2 }, [id("victim")]);
  assert.equal(zoneOf(engine, id("victim")), "play");
  assert.equal(engine.state.cards[id("victim")].damage, 1);
});

clause(BLADE, "1:rule", "the rule belongs to the Blade's host whoever controls the Blade: a Blade on the opponent's character kills what THEIR character damages", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "host", def: character({ name: "TheirHost", strength: 1, life: 6, speed: 2 }), owner: P2, zone: "play" },
      { key: "blade", def: printing(BLADE), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "atk", def: character({ name: "MyAttacker", strength: 0, life: 10, speed: 1 }), owner: P1, zone: "play" }
    ]
  });
  declareAttackBy(game.engine, P1, [game.id("atk")]);
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [game.id("host")] });
  autoResolveBattle(game.engine);
  assert.equal(zoneOf(game.engine, game.id("atk")), "discard", "their Blade-bearing blocker destroyed my attacker");
});

clause(BLADE, "1:rule", "a Blade that has left play does nothing: the host's damage no longer destroys", () => {
  const { engine, id } = bladeBoard({ extra: [{ key: "kill", def: tactic({ name: "KillItem", cost: 0, behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P1, zone: "hand" }] });
  play(engine, P1, id("kill"), { selected: { t: [id("blade")] } });
  assert.equal(zoneOf(engine, id("blade")), "discard", "control: the Blade is gone");
  fight(engine, P1, [id("host")], { type: "faction", playerId: P2 }, [id("victim")]);
  assert.equal(zoneOf(engine, id("victim")), "play");
});

clause(BLADE, "0:attach", "played from hand it attaches to the character I pick, and the host then has the destroy-on-damage rule", () => {
  const { engine, id } = handBoard(BLADE, {
    turn: 2,
    deception: 3,
    extra: [
      { key: "host", def: character({ name: "Host", strength: 1, life: 6, speed: 2 }), owner: P1, zone: "play" },
      { key: "victim", def: character({ name: "Victim", strength: 0, life: 10, speed: 1 }), owner: P2, zone: "play" }
    ]
  });
  play(engine, P1, id("me"), { selected: { attachTo: [id("host")] } });
  assert.equal(engine.state.cards[id("me")].attachedTo, id("host"));
  fight(engine, P1, [id("host")], { type: "faction", playerId: P2 }, [id("victim")]);
  assert.equal(zoneOf(engine, id("victim")), "discard");
});

clause(BLADE, "0:attach", "it only attaches to a CHARACTER: an item, a location, a faction and a face-down card are refused; a host is required", () => {
  const { engine, id } = handBoard(BLADE, {
    deception: 3,
    extra: [
      { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P1, zone: "play", faceDown: true }
    ]
  });
  for (const key of ["gear", "place", "hidden"]) refused(() => playRaw(engine, P1, id("me"), { selected: { attachTo: [id(key)] } }), `${key} is not a character`);
  refused(() => playRaw(engine, P1, id("me"), { selected: { attachTo: [factionOf(engine, P1)] } }), "a faction");
  refused(() => playRaw(engine, P1, id("me"), { selected: {} }), "no host");
  assert.equal(zoneOf(engine, id("me")), "hand");
});

clause(BLADE, "0:attach", "when its host is destroyed the Blade goes with it", () => {
  const { engine, id } = bladeBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("kill"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("blade")), "discard");
});

clause(BLADE, "0:attach", "pays exactly 3, needs [D], and is refused one resource short or without the threshold", () => {
  const exact = deployChecks(
    (res) => handBoard(BLADE, { deception: res.deception, greed: res.greed, extra: [{ key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" }] }),
    3,
    1,
    (id) => ({ attachTo: [id("host")] })
  );
  assert.equal(zoneOf(exact.engine, exact.id("me")), "play");
});

clause(BLADE, "2:ability:handoff", "I deplete another character of mine (not in a battle) and the Blade moves to it", () => {
  const { engine, id } = bladeBoard({ turn: 1 });
  activate(engine, P1, id("blade"), "handoff", { selected: { w: [id("ally")] } });
  assert.equal(engine.state.cards[id("blade")].attachedTo, id("ally"), "attached to the new host");
  assert.equal(isDepleted(engine, id("ally")), true, "the new host was depleted (the cost)");
  assert.equal(isDepleted(engine, id("host")), false, "the old host was not");
});

clause(BLADE, "2:ability:handoff", "the old host loses the rule and the new host has it", () => {
  const { engine, id } = bladeBoard({ turn: 2 });
  activate(engine, P1, id("blade"), "handoff", { selected: { w: [id("ally")] } });
  engine.state.cards[id("ally")].depleted = false; // restore it so it can attack (the test is about the rule, not the deplete)
  fight(engine, P1, [id("host")], { type: "faction", playerId: P2 }, [id("victim")]);
  assert.equal(zoneOf(engine, id("victim")), "play", "the old host no longer destroys");
  const second = bladeBoard({ turn: 2 });
  activate(second.engine, P1, second.id("blade"), "handoff", { selected: { w: [second.id("ally")] } });
  second.engine.state.cards[second.id("ally")].depleted = false;
  fight(second.engine, P1, [second.id("ally")], { type: "faction", playerId: P2 }, [second.id("victim")]);
  assert.equal(zoneOf(second.engine, second.id("victim")), "discard", "the new host does");
});

clause(BLADE, "2:ability:handoff", "the cost is paid when activated: the new host is depleted while the opponent can still respond", () => {
  const { engine, id } = bladeBoard({ turn: 1 });
  activateRaw(engine, P1, id("blade"), "handoff", { w: [id("ally")] });
  assert.ok(engine.state.responseWindow, "control: awaiting responses");
  assert.equal(isDepleted(engine, id("ally")), true);
  assert.equal(engine.state.cards[id("blade")].attachedTo, id("host"), "not moved yet");
});

clause(BLADE, "2:ability:handoff", "only a character I control: the opponent's character, an item and a face-down card are refused", () => {
  const { engine, id } = bladeBoard({
    turn: 1,
    extra: [
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P1, zone: "play", faceDown: true }
    ]
  });
  for (const key of ["victim", "gear", "hidden"]) refused(() => activate(engine, P1, id("blade"), "handoff", { selected: { w: [id(key)] } }), `${key} cannot receive it`);
  assert.equal(engine.state.cards[id("blade")].attachedTo, id("host"));
  refused(() => activate(engine, P1, id("blade"), "handoff", { selected: {} }), "a character must be chosen");
});

clause(BLADE, "2:ability:handoff", "a depleted character cannot pay the deplete cost", () => {
  const { engine, id } = bladeBoard({ turn: 1, extra: [{ key: "tired", def: character({ name: "Tired" }), owner: P1, zone: "play", depleted: true }] });
  refused(() => activate(engine, P1, id("blade"), "handoff", { selected: { w: [id("tired")] } }), "already depleted");
  assert.equal(engine.state.cards[id("blade")].attachedTo, id("host"));
});

clause(BLADE, "2:ability:handoff", "'not in a battle': a character in the attacking party is refused, an idle one is accepted (during the battle)", () => {
  const { engine, id } = bladeBoard({ turn: 2 });
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("host")], target: { type: "faction", playerId: P2 } });
  assert.ok(battleOf(engine), "control: a battle is under way and I hold priority");
  refused(() => activateRaw(engine, P1, id("blade"), "handoff", { w: [id("host")] }), "the attacking host is in the battle");
  activateRaw(engine, P1, id("blade"), "handoff", { w: [id("ally")] });
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("blade")].attachedTo, id("ally"), "the idle ally got it");
});

clause(BLADE, "2:ability:handoff", "no resources are spent (the only cost is the deplete)", () => {
  const { engine, id } = bladeBoard({ turn: 1 });
  const before = ready(engine);
  activate(engine, P1, id("blade"), "handoff", { selected: { w: [id("ally")] } });
  assert.equal(ready(engine), before);
});

clause(BLADE, "2:ability:handoff", "the opponent cannot use my Blade's ability", () => {
  const { engine, id } = bladeBoard({
    turn: 2,
    extra: [{ key: "oppAlly", def: character({ name: "OppAlly" }), owner: P2, zone: "play" }]
  });
  declareAttackBy(engine, P1, [id("host")]);
  refused(() => activateRaw(engine, P2, id("blade"), "handoff", { w: [id("oppAlly")] }), "P2 does not control the Blade");
  assert.equal(engine.state.cards[id("blade")].attachedTo, id("host"));
});

// --- Recreant Cad --------------------------------------------------------------------------------------------------------
// SNEAK -- COST: Use this only if your opponent has at least 10 cards in their discard pile. Pay 1. Remove 2
// cards in your opponent's discard pile from the game. EFFECT: This turn, this card gains COVERT.
// Character, rogue, subtype thief, cost 7, threshold [D], 5/3/3.

const CAD = "bad0a682-9807-466b-8d9b-3ac48a34cdb2";

function cadBoard(opts: { discard?: number; deception?: number; turn?: number; active?: Pid; extra?: CardPlacement[]; depleted?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "cad", def: printing(CAD), owner: P1, zone: "play", depleted: opts.depleted },
      ...fillers("od", opts.discard ?? 12, P2, "discard"),
      ...fillers("md", 12, P1, "discard"),
      ...fillers("oh", 3, P2, "hand"),
      ...fillers("odk", 3, P2, "deck"),
      ...bank("deception", opts.deception ?? 3, P1),
      ...(opts.extra ?? [])
    ]
  });
}

clause(CAD, "0:ability:sneak", "with 12 cards in their discard pile: pays 1, removes exactly the 2 chosen cards from the game, and the Cad gains COVERT", () => {
  const { engine, id } = cadBoard();
  const before = ready(engine);
  activate(engine, P1, id("cad"), "sneak", { selected: { rfg: [id("od3"), id("od7")] } });
  assert.equal(before - ready(engine), 1, "pay 1");
  assert.equal(zoneOf(engine, id("od3")), "removed");
  assert.equal(zoneOf(engine, id("od7")), "removed");
  assert.equal(discardOf(engine, P2).length, 10, "exactly two left their discard pile");
  assert.equal(hasKeyword(engine, id("cad"), "covert"), true);
});

clause(CAD, "0:ability:sneak", "...and no other card is removed or touched", () => {
  const { engine, id } = cadBoard();
  activate(engine, P1, id("cad"), "sneak", { selected: { rfg: [id("od0"), id("od1")] } });
  for (let i = 2; i < 12; i++) assert.equal(zoneOf(engine, id(`od${i}`)), "discard", `od${i}`);
  assert.equal(discardOf(engine, P1).length, 12, "my discard pile is untouched");
  assert.equal(handOf(engine, P2).length, 3);
  assert.equal(deckOf(engine, P2).length, 3);
});

clause(CAD, "0:ability:sneak", "'at least 10': exactly 10 cards is enough; 9 is refused", () => {
  const ten = cadBoard({ discard: 10 });
  activate(ten.engine, P1, ten.id("cad"), "sneak", { selected: { rfg: [ten.id("od0"), ten.id("od1")] } });
  assert.equal(hasKeyword(ten.engine, ten.id("cad"), "covert"), true);
  assert.equal(discardOf(ten.engine, P2).length, 8);

  const nine = cadBoard({ discard: 9 });
  refused(() => activate(nine.engine, P1, nine.id("cad"), "sneak", { selected: { rfg: [nine.id("od0"), nine.id("od1")] } }), "only 9 cards");
  assert.equal(zoneOf(nine.engine, nine.id("od0")), "discard");
  assert.equal(hasKeyword(nine.engine, nine.id("cad"), "covert"), false);
  assert.equal(ready(nine.engine), 3, "nothing was paid");
});

clause(CAD, "0:ability:sneak", "only THEIR discard pile counts: my own 12 cards don't satisfy the condition", () => {
  const { engine, id } = cadBoard({ discard: 4 });
  assert.equal(discardOf(engine, P1).length, 12, "control: I have plenty");
  refused(() => activate(engine, P1, id("cad"), "sneak", { selected: { rfg: [id("od0"), id("od1")] } }), "their pile has only 4");
});

clause(CAD, "0:ability:sneak", "exactly 2 cards: one, three, or none are refused", () => {
  const { engine, id } = cadBoard();
  refused(() => activate(engine, P1, id("cad"), "sneak", { selected: { rfg: [id("od0")] } }), "one card");
  refused(() => activate(engine, P1, id("cad"), "sneak", { selected: { rfg: [id("od0"), id("od1"), id("od2")] } }), "three cards");
  refused(() => activate(engine, P1, id("cad"), "sneak", { selected: {} }), "none");
  refused(() => activate(engine, P1, id("cad"), "sneak", { selected: { rfg: [id("od0"), id("od0")] } }), "the same card twice");
  assert.equal(discardOf(engine, P2).length, 12);
});

clause(CAD, "0:ability:sneak", "only cards in THEIR discard pile can be removed: my discard pile, their hand and their deck are refused", () => {
  const { engine, id } = cadBoard();
  refused(() => activate(engine, P1, id("cad"), "sneak", { selected: { rfg: [id("md0"), id("od0")] } }), "my discard pile");
  refused(() => activate(engine, P1, id("cad"), "sneak", { selected: { rfg: [id("oh0"), id("od0")] } }), "their hand");
  refused(() => activate(engine, P1, id("cad"), "sneak", { selected: { rfg: [id("odk0"), id("od0")] } }), "their deck");
  assert.equal(zoneOf(engine, id("md0")), "discard");
  assert.equal(zoneOf(engine, id("oh0")), "hand");
});

clause(CAD, "0:ability:sneak", "I choose which two (any cards: they need not be characters)", () => {
  const { engine, id } = cadBoard({
    extra: [{ key: "spell", def: tactic({ name: "Spell", cost: 1, behavior: { abilities: [{ id: "s", type: "activated", effects: [] }] } }), owner: P2, zone: "discard" }]
  });
  activate(engine, P1, id("cad"), "sneak", { selected: { rfg: [id("spell"), id("od0")] } });
  assert.equal(zoneOf(engine, id("spell")), "removed");
  assert.equal(zoneOf(engine, id("od0")), "removed");
});

clause(CAD, "0:ability:sneak", "the cost is paid when activated (resource spent, cards removed) while the opponent can still respond", () => {
  const { engine, id } = cadBoard();
  const before = ready(engine);
  activateRaw(engine, P1, id("cad"), "sneak", { rfg: [id("od0"), id("od1")] });
  assert.ok(engine.state.responseWindow, "engine.state.responseWindow");
  assert.equal(before - ready(engine), 1);
  assert.equal(zoneOf(engine, id("od0")), "removed");
  assert.equal(hasKeyword(engine, id("cad"), "covert"), false, "COVERT comes with the effect, after responses");
  resolvePendingResponses(engine);
  assert.equal(hasKeyword(engine, id("cad"), "covert"), true);
});

clause(CAD, "0:ability:sneak", "refused with no resource to pay", () => {
  const { engine, id } = cadBoard({ deception: 0 });
  refused(() => activate(engine, P1, id("cad"), "sneak", { selected: { rfg: [id("od0"), id("od1")] } }), "cannot pay 1");
  assert.equal(zoneOf(engine, id("od0")), "discard");
});

clause(CAD, "0:ability:sneak", "COVERT is real: attacking alone, the Cad cannot be blocked by a non-covert character, but a covert one can block it", () => {
  const { engine, id } = cadBoard({
    turn: 2,
    active: P1,
    extra: [
      { key: "plain", def: character({ name: "PlainBlocker" }), owner: P2, zone: "play" },
      { key: "covertBlocker", def: character({ name: "CovertBlocker", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(engine, P1, [id("cad")]);
  declareBlockers(engine, P2, [id("plain")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("plain")], "control: before SNEAK a plain blocker may block");

  const sneaked = cadBoard({
    turn: 2,
    active: P1,
    extra: [
      { key: "plain", def: character({ name: "PlainBlocker" }), owner: P2, zone: "play" },
      { key: "covertBlocker", def: character({ name: "CovertBlocker", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }
    ]
  });
  activate(sneaked.engine, P1, sneaked.id("cad"), "sneak", { selected: { rfg: [sneaked.id("od0"), sneaked.id("od1")] } });
  declareAttackBy(sneaked.engine, P1, [sneaked.id("cad")]);
  refused(() => declareBlockers(sneaked.engine, P2, [sneaked.id("plain")]), "a non-covert character cannot block a covert party");
  declareBlockers(sneaked.engine, P2, [sneaked.id("covertBlocker")]);
  assert.deepEqual(battleOf(sneaked.engine)?.blockingParty, [sneaked.id("covertBlocker")]);
});

clause(CAD, "0:ability:sneak", "'this turn': COVERT ends with the turn", () => {
  const { engine, id } = cadBoard();
  activate(engine, P1, id("cad"), "sneak", { selected: { rfg: [id("od0"), id("od1")] } });
  assert.equal(hasKeyword(engine, id("cad"), "covert"), true);
  endTurn(engine, P1);
  assert.equal(hasKeyword(engine, id("cad"), "covert"), false);
  endTurn(engine, P2);
  assert.equal(hasKeyword(engine, id("cad"), "covert"), false);
});

clause(CAD, "0:ability:sneak", "only the Cad gains COVERT, not my other characters", () => {
  const { engine, id } = cadBoard({ extra: [{ key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" }] });
  activate(engine, P1, id("cad"), "sneak", { selected: { rfg: [id("od0"), id("od1")] } });
  assert.equal(hasKeyword(engine, id("ally"), "covert"), false);
});

clause(CAD, "0:ability:sneak", "it can be used again: 12 -> 10 -> 8; the third use (8 cards) is refused", () => {
  const { engine, id } = cadBoard({ deception: 5 });
  activate(engine, P1, id("cad"), "sneak", { selected: { rfg: [id("od0"), id("od1")] } });
  activate(engine, P1, id("cad"), "sneak", { selected: { rfg: [id("od2"), id("od3")] } });
  assert.equal(discardOf(engine, P2).length, 8);
  refused(() => activate(engine, P1, id("cad"), "sneak", { selected: { rfg: [id("od4"), id("od5")] } }), "only 8 cards left");
  assert.equal(discardOf(engine, P2).length, 8);
  assert.equal(hasKeyword(engine, id("cad"), "covert"), true, "and COVERT does not double up");
});

clause(CAD, "0:ability:sneak", "a depleted Cad can use it (no deplete in the cost)", () => {
  const { engine, id } = cadBoard({ depleted: true });
  activate(engine, P1, id("cad"), "sneak", { selected: { rfg: [id("od0"), id("od1")] } });
  assert.equal(hasKeyword(engine, id("cad"), "covert"), true);
});

clause(CAD, "0:ability:sneak", "the opponent cannot use my Cad's ability", () => {
  const { engine, id } = cadBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "attacker", def: character({ name: "Attacker", life: 9 }), owner: P2, zone: "play" }, ...bank("deception", 2, P2), ...fillers("pd", 12, P1, "discard")]
  });
  openDefenderWindow(engine, id("attacker"));
  refused(() => activateRaw(engine, P2, id("cad"), "sneak", { rfg: [id("md0"), id("md1")] }), "P2 does not control the Cad");
  assert.equal(zoneOf(engine, id("md0")), "discard");
});

clause(CAD, "0:ability:sneak", "pays exactly 7, needs [D], and has the printed 5/3/3 stats", () => {
  const exact = deployChecks((res) => handBoard(CAD, { deception: res.deception, greed: res.greed }), 7, 1);
  assert.equal(zoneOf(exact.engine, exact.id("me")), "play");
  assert.deepEqual(stats(exact.engine, exact.id("me")), [5, 3, 3]);
});

// --- Throatstabber ------------------------------------------------------------------------------------------------------------
// When this card enters play, flip a coin. If you lose, deplete this card.
// Character, rogue, subtype pirate, cost 3, threshold [D][D][D], 3/2/4.

const THROATSTABBER = "7710da84-2994-4019-957f-0fc998917104";

clause(THROATSTABBER, "0:rule", "losing the flip depletes it", () => {
  const { engine, id } = handBoard(THROATSTABBER, { deception: 3, random: LOSE });
  play(engine, P1, id("me"));
  assert.equal(zoneOf(engine, id("me")), "play");
  assert.deepEqual(coinFlips(engine), [{ playerId: P1, won: false }], "one flip, mine, lost");
  assert.equal(isDepleted(engine, id("me")), true);
});

clause(THROATSTABBER, "0:rule", "winning the flip leaves it ready", () => {
  const { engine, id } = handBoard(THROATSTABBER, { deception: 3, random: WIN });
  play(engine, P1, id("me"));
  assert.deepEqual(coinFlips(engine), [{ playerId: P1, won: true }]);
  assert.equal(isDepleted(engine, id("me")), false);
  assert.equal(zoneOf(engine, id("me")), "play");
});

clause(THROATSTABBER, "0:rule", "the flip happens when it ENTERS play, not when it is played from hand", () => {
  const { engine, id } = handBoard(THROATSTABBER, { deception: 3, random: LOSE });
  playRaw(engine, P1, id("me"));
  assert.equal(coinFlips(engine).length, 0, "no flip while the opponent can still respond");
  resolvePendingResponses(engine);
  assert.equal(coinFlips(engine).length, 1);
});

clause(THROATSTABBER, "0:rule", "a depleted Throatstabber cannot block (blockers must be untapped); an untapped one can", () => {
  for (const depleted of [true, false]) {
    const game = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      activePlayerId: P1,
      cards: [
        { key: "ts", def: printing(THROATSTABBER), owner: P2, zone: "play", depleted },
        { key: "atk", def: character({ name: "Attacker", life: 9 }), owner: P1, zone: "play" }
      ]
    });
    declareAttackBy(game.engine, P1, [game.id("atk")]);
    if (depleted) refused(() => declareBlockers(game.engine, P2, [game.id("ts")]), "a depleted character cannot block");
    else {
      declareBlockers(game.engine, P2, [game.id("ts")]);
      assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("ts")]);
    }
  }
});

clause(THROATSTABBER, "0:rule", "it is only the card ENTERING that flips: another card entering play does not", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    random: LOSE,
    cards: [
      { key: "ts", def: printing(THROATSTABBER), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other", cost: 1 }), owner: P1, zone: "hand" },
      ...bank("deception", 1, P1)
    ]
  });
  play(engine, P1, id("other"));
  assert.equal(coinFlips(engine).length, 0);
  assert.equal(isDepleted(engine, id("ts")), false);
});

clause(THROATSTABBER, "0:rule", "a second Throatstabber entering play flips its own coin and leaves the first alone", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    random: LOSE,
    cards: [
      { key: "a", def: printing(THROATSTABBER), owner: P1, zone: "play" },
      { key: "b", def: printing(THROATSTABBER), owner: P1, zone: "hand" },
      ...bank("deception", 3, P1)
    ]
  });
  play(engine, P1, id("b"));
  assert.equal(coinFlips(engine).length, 1);
  assert.equal(isDepleted(engine, id("a")), false);
  assert.equal(isDepleted(engine, id("b")), true);
});

clause(THROATSTABBER, "0:rule", "the flip is the controller's: an opponent's Throatstabber is depleted on THEIR lost flip", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: LOSE,
    turn: 2,
    activePlayerId: P2,
    cards: [{ key: "ts", def: printing(THROATSTABBER), owner: P2, zone: "hand" }, ...bank("deception", 3, P2)]
  });
  play(engine, P2, id("ts"));
  assert.deepEqual(coinFlips(engine), [{ playerId: P2, won: false }]);
  assert.equal(isDepleted(engine, id("ts")), true);
});

clause(THROATSTABBER, "0:rule", "it flips once only: no flip later in the game, and the depletion is undone by my next restore", () => {
  const { engine, id } = handBoard(THROATSTABBER, { deception: 3, random: LOSE });
  play(engine, P1, id("me"));
  assert.equal(isDepleted(engine, id("me")), true);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(coinFlips(engine).length, 1, "no more flips");
  assert.equal(isDepleted(engine, id("me")), false, "restored at the start of my turn");
});

clause(THROATSTABBER, "0:rule", "pays exactly 3, needs [D][D][D], and has the printed 3/2/4 stats", () => {
  const exact = deployChecks((res) => handBoard(THROATSTABBER, { deception: res.deception, greed: res.greed, random: WIN }), 3, 3);
  assert.equal(zoneOf(exact.engine, exact.id("me")), "play");
  assert.deepEqual(stats(exact.engine, exact.id("me")), [3, 2, 4]);
});

// --- Two-Headed Coin ------------------------------------------------------------------------------------------------
// If you lose a coin flip, you may shuffle this card into your deck. If you do, reflip that coin and draw a
// card instead.   Item, rogue, cost 0, threshold [D][D].

const TWO_HEADED_COIN = "f4244678-8524-446d-8c1c-65f126c9df4a";

/** A coin source: win = +1 influence for its controller, lose = -1 (id `c`). */
const coinTactic = (name = "CoinGame"): CameCard =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "c",
          type: "activated",
          effects: [
            {
              type: "flipCoin",
              winEffects: [{ type: "modifyInfluence", player: "controller", amount: 1 }],
              loseEffects: [{ type: "modifyInfluence", player: "controller", amount: -1 }]
            }
          ]
        }
      ]
    }
  });
type CameCard = CardDefinition;

/** A random source whose coin results (and shuffles) follow `mode`: "lose" => 0.9, "win" => 0.1. */
function switchableRandom() {
  const state = { mode: "lose" as "lose" | "win" };
  return { state, random: () => (state.mode === "win" ? 0.1 : 0.9) };
}

function coinBoard(opts: { coins?: number; coinZone?: "play" | "hand" | "deck"; coinOwner?: Pid; coinController?: Pid; faceDown?: boolean; random: () => number; extra?: CardPlacement[]; turn?: number; active?: Pid }) {
  const coins = Array.from(
    { length: opts.coins ?? 1 },
    (_, i): CardPlacement => ({
      key: `coin${i}`,
      def: printing(TWO_HEADED_COIN),
      owner: opts.coinOwner ?? P1,
      controller: opts.coinController,
      zone: opts.coinZone ?? "play",
      faceDown: opts.faceDown
    })
  );
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: opts.random,
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      ...coins,
      { key: "game", def: coinTactic(), owner: P1, zone: "hand" },
      { key: "game2", def: coinTactic("CoinGame2"), owner: P2, zone: "hand" },
      ...deckOfFillers("m", 4, P1),
      ...deckOfFillers("o", 4, P2),
      ...(opts.extra ?? [])
    ]
  });
}

const coinReplaceChoice = (engine: SpoilsEngine, reflip: boolean) => answerPending(engine, "coinFlipReplace", { reflip });

clause(TWO_HEADED_COIN, "0:rule", "I lose a flip and accept: the coin is shuffled into my deck, the coin is reflipped (a win here: the WIN branch runs, not the loss) and I draw a card", () => {
  const rng = switchableRandom();
  const { engine, id } = coinBoard({ random: rng.random });
  const handBefore = handOf(engine, P1).length;
  play(engine, P1, id("game"));
  const pc = pending(engine)!;
  assert.equal(pc.kind, "coinFlipReplace", "I am offered the Coin");
  assert.equal(pc.playerId, P1);
  assert.equal(influence(engine, P1), 30, "nothing has resolved yet");
  rng.state.mode = "win";
  coinReplaceChoice(engine, true);
  assert.equal(zoneOf(engine, id("coin0")), "deck", "the Coin was shuffled into the deck");
  assert.ok(deckOf(engine, P1).includes(id("coin0")), "deckOf(engine, P1).includes(id(\"coin0\"))");
  assert.equal(influence(engine, P1), 31, "the reflip was won: +1, and the original loss (-1) never happened");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1, "exactly one card drawn (the tactic left my hand)");
});

clause(TWO_HEADED_COIN, "0:rule", "...if the reflip loses too, the loss happens once (not twice) and I still draw", () => {
  const rng = switchableRandom();
  const { engine, id } = coinBoard({ random: rng.random });
  const handBefore = handOf(engine, P1).length;
  play(engine, P1, id("game"));
  coinReplaceChoice(engine, true);
  assert.equal(influence(engine, P1), 29, "one loss of 1");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1, "and the card is drawn");
  assert.equal(zoneOf(engine, id("coin0")), "deck", "the Coin was still spent");
});

clause(TWO_HEADED_COIN, "0:rule", "'you may': declining keeps the loss, keeps the Coin in play and draws nothing", () => {
  const rng = switchableRandom();
  const { engine, id } = coinBoard({ random: rng.random });
  const handBefore = handOf(engine, P1).length;
  const deckBefore = [...deckOf(engine, P1)];
  play(engine, P1, id("game"));
  coinReplaceChoice(engine, false);
  assert.equal(influence(engine, P1), 29, "the loss stands");
  assert.equal(zoneOf(engine, id("coin0")), "play", "the Coin stays");
  assert.equal(handOf(engine, P1).length, handBefore - 1, "no card drawn");
  assert.deepEqual(deckOf(engine, P1), deckBefore, "the deck is untouched");
  assert.equal(pending(engine), undefined);
});

clause(TWO_HEADED_COIN, "0:rule", "only when I LOSE: a won flip gives no prompt and nothing happens to the Coin", () => {
  const rng = switchableRandom();
  rng.state.mode = "win";
  const { engine, id } = coinBoard({ random: rng.random });
  play(engine, P1, id("game"));
  assert.equal(pending(engine), undefined);
  assert.equal(influence(engine, P1), 31);
  assert.equal(zoneOf(engine, id("coin0")), "play");
});

clause(TWO_HEADED_COIN, "0:rule", "only MY flips: the opponent losing a flip does not offer me the Coin", () => {
  const rng = switchableRandom();
  const { engine, id } = coinBoard({ random: rng.random, turn: 2, active: P2 });
  play(engine, P2, id("game2"));
  assert.equal(pending(engine), undefined, "no prompt for me");
  assert.equal(influence(engine, P2), 29, "their loss stands");
  assert.equal(zoneOf(engine, id("coin0")), "play");
});

clause(TWO_HEADED_COIN, "0:rule", "the Coin must be in play: in hand or in the deck it does nothing", () => {
  for (const coinZone of ["hand", "deck"] as const) {
    const rng = switchableRandom();
    const { engine, id } = coinBoard({ random: rng.random, coinZone });
    play(engine, P1, id("game"));
    assert.equal(pending(engine), undefined, `Coin in ${coinZone}`);
    assert.equal(influence(engine, P1), 29);
  }
});

clause(TWO_HEADED_COIN, "0:rule", "face-down it is only a resource with no rules text: no prompt", () => {
  const rng = switchableRandom();
  const { engine, id } = coinBoard({ random: rng.random, faceDown: true });
  play(engine, P1, id("game"));
  assert.equal(pending(engine), undefined);
  assert.equal(influence(engine, P1), 29);
});

clause(TWO_HEADED_COIN, "0:rule", "'your deck': a Coin I control but the opponent owns is shuffled into MY deck (the card says so, unlike the default 'owner's deck')", () => {
  const rng = switchableRandom();
  const { engine, id } = coinBoard({ random: rng.random, coinOwner: P2, coinController: P1 });
  play(engine, P1, id("game"));
  coinReplaceChoice(engine, true);
  assert.ok(deckOf(engine, P1).includes(id("coin0")), "in my deck");
  assert.equal(deckOf(engine, P2).includes(id("coin0")), false, "not in its owner's deck");
});

clause(TWO_HEADED_COIN, "0:rule", "a Coin shuffled in is a normal card again: it is no longer in play, so the next lost flip finds no Coin", () => {
  const rng = switchableRandom();
  const { engine, id } = coinBoard({ random: rng.random, extra: [{ key: "game3", def: coinTactic("CoinGame3"), owner: P1, zone: "hand" }] });
  play(engine, P1, id("game"));
  coinReplaceChoice(engine, true);
  play(engine, P1, id("game3"));
  assert.equal(pending(engine), undefined, "no Coin left in play to offer");
});

clause(TWO_HEADED_COIN, "0:rule", "two Coins: a reflip that loses again offers the second Coin; using both ends on a won reflip with two cards drawn", () => {
  const rng = switchableRandom();
  const { engine, id } = coinBoard({ coins: 2, random: rng.random });
  const handBefore = handOf(engine, P1).length;
  play(engine, P1, id("game"));
  coinReplaceChoice(engine, true);
  const second = pending(engine);
  assert.ok(second && second.kind === "coinFlipReplace", "the reflip lost: the other Coin may be used on that loss");
  rng.state.mode = "win";
  coinReplaceChoice(engine, true);
  assert.equal(zoneOf(engine, id("coin0")) === "deck" && zoneOf(engine, id("coin1")) === "deck", true, "both Coins were shuffled in");
  assert.equal(influence(engine, P1), 31, "the final reflip won");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 2, "a card for each Coin used");
});

clause(TWO_HEADED_COIN, "0:rule", "it works on a real card's flip: Fwing!'s lost flip, reflipped and won, gives the +1 strength after all", () => {
  const rng = switchableRandom();
  const { engine, id } = coinBoard({
    random: rng.random,
    extra: [
      { key: "fwing", def: printing(FWING), owner: P1, zone: "hand" },
      { key: "pick", def: character({ name: "Pickee", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      ...bank("deception", 2, P1)
    ]
  });
  playRaw(engine, P1, id("fwing"), { selected: { pick: [id("pick")] } });
  resolvePendingResponses(engine);
  assert.equal(pending(engine)?.kind, "coinFlipReplace");
  rng.state.mode = "win";
  coinReplaceChoice(engine, true);
  assert.equal(engine.getStat(id("pick"), "strength"), 3, "the reflip was a win");
  assert.equal(engine.getStat(id("pick"), "speed"), 3);
});

clause(TWO_HEADED_COIN, "0:rule", "...and Throatstabber's lost flip, reflipped and won, leaves it undepleted", () => {
  const rng = switchableRandom();
  const { engine, id } = coinBoard({
    random: rng.random,
    extra: [{ key: "ts", def: printing(THROATSTABBER), owner: P1, zone: "hand" }, ...bank("deception", 3, P1)]
  });
  play(engine, P1, id("ts"));
  assert.equal(pending(engine)?.kind, "coinFlipReplace");
  rng.state.mode = "win";
  coinReplaceChoice(engine, true);
  assert.equal(zoneOf(engine, id("ts")), "play");
  assert.equal(isDepleted(engine, id("ts")), false);
});

clause(TWO_HEADED_COIN, "0:rule", "declining on Throatstabber's lost flip leaves it depleted", () => {
  const rng = switchableRandom();
  const { engine, id } = coinBoard({
    random: rng.random,
    extra: [{ key: "ts", def: printing(THROATSTABBER), owner: P1, zone: "hand" }, ...bank("deception", 3, P1)]
  });
  play(engine, P1, id("ts"));
  coinReplaceChoice(engine, false);
  assert.equal(isDepleted(engine, id("ts")), true);
  assert.equal(zoneOf(engine, id("coin0")), "play");
});

clause(TWO_HEADED_COIN, "0:rule", "it costs nothing to deploy (cost 0) but needs [D][D]", () => {
  const exact = deployChecks((res) => handBoard(TWO_HEADED_COIN, { deception: res.deception, greed: res.greed }), 0, 2);
  assert.equal(zoneOf(exact.engine, exact.id("me")), "play");
  assert.equal(controllerOf(exact.engine, exact.id("me")), P1);
});

// --- Unexpected Boobysnake -----------------------------------------------------------------------------------------------
// You may play this card whenever you could play a tactic. If you do, discard a card or destroy this card.
// Character, rogue, subtype beast, cost 4, threshold [D][D], 3/2/4.

const SNAKE = "19cf503e-f872-4199-beef-e832d1ee833c";

function snakeBoard(opts: { deception?: number; hand?: number; active?: Pid; turn?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    activePlayerId: opts.active ?? P2,
    cards: [
      { key: "snake", def: printing(SNAKE), owner: P1, zone: "hand" },
      ...fillers("h", opts.hand ?? 2, P1, "hand"),
      { key: "nothing", def: nothingTactic(), owner: P2, zone: "hand" },
      { key: "attacker", def: character({ name: "Attacker", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
      { key: "oppCard", def: character({ name: "OppCard" }), owner: P2, zone: "hand" },
      ...deckOfFillers("m", 3, P1),
      ...bank("deception", opts.deception ?? 6, P1),
      ...(opts.extra ?? [])
    ]
  });
}

/** P2 plays Nothing; I (P1) play the Snake as a response and let it resolve: stops at the Snake's "discard or destroy" choice. */
function snakeInResponse(game: ReturnType<typeof snakeBoard>) {
  playRaw(game.engine, P2, game.id("nothing"));
  playRaw(game.engine, P1, game.id("snake"));
  resolvePendingResponses(game.engine);
}

clause(SNAKE, "0:rule", "it has TACTICAL: it can be played whenever a tactic could be", () => {
  const { engine, id } = snakeBoard();
  assert.ok(hasKeyword(engine, id("snake"), "tactical"), "hasKeyword(engine, id(\"snake\"), \"tactical\")");
});

clause(SNAKE, "0:rule", "on the opponent's turn, in a response window, I can play it from my hand and it enters play", () => {
  const game = snakeBoard();
  snakeInResponse(game);
  const { engine, id } = game;
  assert.equal(zoneOf(engine, id("snake")), "play");
  assert.equal(controllerOf(engine, id("snake")), P1);
});

clause(SNAKE, "0:rule", "...with nothing to respond to on the opponent's turn it cannot be played (no tactic could be)", () => {
  const { engine, id } = snakeBoard();
  refused(() => playRaw(engine, P1, id("snake")), "no window is open for me");
  assert.equal(zoneOf(engine, id("snake")), "hand");
});

clause(SNAKE, "0:rule", "'If you do': having played it that way I must discard a card or destroy it: both options are offered to me", () => {
  const game = snakeBoard();
  snakeInResponse(game);
  const pc = pending(game.engine)!;
  assert.equal(pc.kind, "chooserSelectsOption", "the Snake asks me to choose");
  assert.equal(pc.playerId, P1);
  assert.equal(pc.optionCount, 2, "discard a card, or destroy this card");
});

clause(SNAKE, "0:rule", "choosing to discard: I pick a card from my hand, it goes to my discard pile, and the Snake stays", () => {
  const game = snakeBoard();
  snakeInResponse(game);
  const { engine, id } = game;
  answerPending(engine, "chooserSelectsOption", { index: 0 });
  const pc = pending(engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("h1")] });
  assert.equal(zoneOf(engine, id("h1")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("h1")), "discardOf(engine, P1).includes(id(\"h1\"))");
  assert.equal(zoneOf(engine, id("h0")), "hand", "only the chosen card is discarded");
  assert.equal(zoneOf(engine, id("snake")), "play", "the Snake survives");
  assert.equal(pending(engine), undefined);
});

clause(SNAKE, "0:rule", "choosing to destroy it: the Snake goes to my discard pile and my hand is untouched", () => {
  const game = snakeBoard();
  snakeInResponse(game);
  const { engine, id } = game;
  const hand = [...handOf(engine, P1)];
  answerPending(engine, "chooserSelectsOption", { index: 1 });
  assert.equal(zoneOf(engine, id("snake")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("snake")), "discardOf(engine, P1).includes(id(\"snake\"))");
  assert.deepEqual(handOf(engine, P1), hand, "nothing else was discarded");
  assert.equal(pending(engine), undefined);
});

clause(SNAKE, "0:rule", "the discard must be MY card from MY hand: the opponent's hand card, a card in play and my deck are refused; exactly one", () => {
  const game = snakeBoard();
  snakeInResponse(game);
  const { engine, id } = game;
  answerPending(engine, "chooserSelectsOption", { index: 0 });
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("oppCard")] }), "the opponent's hand");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("m0")] }), "my deck");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("snake")] }), "the Snake itself is in play");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("h0"), id("h1")] }), "two cards");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [] }), "'discard a card' is not optional once chosen");
  assert.equal(zoneOf(engine, id("oppCard")), "hand");
  assert.equal(zoneOf(engine, id("snake")), "play");
});

clause(SNAKE, "0:rule", "with no other card in hand I cannot discard: choosing 'discard a card' cannot save the Snake, which ends up destroyed", () => {
  const game = snakeBoard({ hand: 0 });
  snakeInResponse(game);
  const { engine, id } = game;
  assert.equal(handOf(engine, P1).length, 0, "control: my hand is empty");
  assert.equal(pending(engine)?.kind, "chooserSelectsOption");
  try {
    answerPending(engine, "chooserSelectsOption", { index: 0 });
    if (pending(engine)) answerPending(engine, "chooserSelectsTarget", { selected: [] });
  } catch {
    // refusing the impossible discard is fine
  }
  if (pending(engine)) answerPending(engine, "chooserSelectsOption", { index: 1 });
  assert.equal(zoneOf(engine, id("snake")), "discard", "with nothing to discard the Snake must be destroyed");
  assert.equal(pending(engine), undefined);
});

clause(SNAKE, "0:rule", "it really can be a surprise blocker: played in response to an attack, it blocks that attack", () => {
  const { engine, id } = snakeBoard();
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("attacker")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  playRaw(engine, P1, id("snake"));
  resolvePendingResponses(engine);
  answerPending(engine, "chooserSelectsOption", { index: 0 });
  answerPending(engine, "chooserSelectsTarget", { selected: [id("h0")] });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("snake")), "play");
  declareBlockers(engine, P1, [id("snake")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("snake")]);
});

clause(SNAKE, "0:rule", "the penalty is for playing it at tactic timing: deployed normally in my own main phase there is no discard-or-destroy prompt", () => {
  const { engine, id } = snakeBoard({ turn: 1, active: P1 });
  play(engine, P1, id("snake"));
  assert.equal(zoneOf(engine, id("snake")), "play");
  assert.equal(pending(engine), undefined, "no prompt: I did not use the 'whenever you could play a tactic' permission");
});

clause(SNAKE, "0:rule", "only the Snake's own entering triggers the prompt: another character of mine entering play gives none", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "snake", def: printing(SNAKE), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other", cost: 1 }), owner: P1, zone: "hand" },
      ...bank("deception", 1, P1)
    ]
  });
  play(engine, P1, id("other"));
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("snake")), "play");
});

clause(SNAKE, "0:rule", "it can also be played in response to the opponent announcing the end of their turn", () => {
  const { engine, id } = snakeBoard();
  engine.perform({ type: "endTurn", playerId: P2 });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "control: I may respond");
  playRaw(engine, P1, id("snake"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("snake")), "play");
  assert.equal(pending(engine)?.kind, "chooserSelectsOption", "and the penalty applies");
});

clause(SNAKE, "0:rule", "it costs its full 4 even when played this way, and needs [D][D]", () => {
  const short = snakeBoard({ deception: 3 });
  playRaw(short.engine, P2, short.id("nothing"));
  refused(() => playRaw(short.engine, P1, short.id("snake")), "3 < 4");
  assert.equal(zoneOf(short.engine, short.id("snake")), "hand");

  const exact = snakeBoard({ deception: 4 });
  playRaw(exact.engine, P2, exact.id("nothing"));
  const before = ready(exact.engine);
  playRaw(exact.engine, P1, exact.id("snake"));
  assert.equal(before - ready(exact.engine), 4);
});

clause(SNAKE, "0:rule", "pays exactly 4, needs [D][D] in my own turn too, and has the printed 3/2/4 stats", () => {
  const exact = deployChecks((res) => handBoard(SNAKE, { deception: res.deception, greed: res.greed, turn: 1, active: P1 }), 4, 2);
  assert.equal(zoneOf(exact.engine, exact.id("me")), "play");
  assert.deepEqual(stats(exact.engine, exact.id("me")), [3, 2, 4]);
});

// --- Counter Attack: extra cases ------------------------------------------------------------------------------------------

clause(COUNTER_ATTACK, "0:ability", "choosing no attacker starts no battle ('you cannot attack with 0 characters')", () => {
  const game = counterBoard();
  const { engine } = game;
  openOpponentWindow(game);
  playCounterAttack(game, []);
  assert.equal(battleOf(engine), undefined);
});

clause(COUNTER_ATTACK, "0:ability", "a face-down card is a resource, not a character: it cannot be sent to attack", () => {
  const game = counterBoard({ extra: [{ key: "hidden", def: character({ name: "Hidden", strength: 5 }), owner: P1, zone: "play", faceDown: true }] });
  const { engine, id } = game;
  openOpponentWindow(game);
  refused(() => playRaw(engine, P1, id("ca"), { selected: { atk: [id("hidden")] } }), "a face-down card cannot attack");
  assert.equal(zoneOf(engine, id("ca")), "hand");
});

clause(COUNTER_ATTACK, "0:ability", "my unchosen characters take no part: the bystander does not deplete and can still block later", () => {
  const game = counterBoard();
  const { engine, id } = game;
  openOpponentWindow(game);
  playCounterAttack(game, ["a1"]);
  declareAttackBlockers(engine, []);
  autoResolveBattle(engine);
  assert.equal(isDepleted(engine, id("by")), false);
  assert.equal(isDepleted(engine, id("a2")), false);
});

clause(COUNTER_ATTACK, "0:ability", "the opponent's attackers/characters are not touched by my attack beyond the battle: the battle is mine against their faction only", () => {
  const game = counterBoard();
  const { engine, id } = game;
  openOpponentWindow(game);
  playCounterAttack(game, ["a1"]);
  declareAttackBlockers(engine, []);
  autoResolveBattle(engine);
  assert.equal(isDepleted(engine, id("foe")), false);
  assert.equal(engine.state.cards[id("foe")].damage, 0);
});

// --- extra cases ----------------------------------------------------------------------------------------------------------

/** A free tactic taking control of one picked character (id `tc`, declaration `t`). */
const stealTactic = (): CardDefinition =>
  tactic({
    name: "Steal",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "tc",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });

clause(CHEATS, "0:unique", "taking control of the opponent's Cheats while I control mine makes me choose which to keep (UNIQUE is checked when control changes too)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "mine", def: printing(CHEATS), owner: P1, zone: "play" },
      { key: "theirs", def: printing(CHEATS), owner: P2, zone: "play" },
      { key: "steal", def: stealTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("steal"), { selected: { t: [id("theirs")] } });
  const pc = pending(engine);
  assert.ok(pc && pc.kind === "uniqueSurvivor", "I now control two UNIQUE PLUCK cards");
  assert.equal(pc.playerId, P1);
  answerPending(engine, "uniqueSurvivor", { keep: id("mine") });
  assert.equal(zoneOf(engine, id("mine")), "play");
  assert.equal(zoneOf(engine, id("theirs")), "discard", "the extra copy is destroyed, into its owner's discard pile");
  assert.ok(discardOf(engine, P2).includes(id("theirs")), "discardOf(engine, P2).includes(id(\"theirs\"))");
  assert.equal(pending(engine), undefined);
});

clause(CHEATS, "4:ability:costume", "with no other pluck card in my deck the search finds nothing: nothing enters play, and Cheats has still shuffled itself into the deck", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "cm", def: printing(CHEATS), owner: P1, zone: "play" },
      { key: "twin", def: printing(CHEATS), owner: P1, zone: "deck" },
      { key: "thief", def: character({ name: "Not A Pluck", subtype: ["thief"] }), owner: P1, zone: "deck" },
      ...bank("deception", 3, P1)
    ]
  });
  activate(engine, P1, id("cm"), "costume", { selected: { self: [id("cm")] } });
  const pc = pending(engine);
  if (pc) {
    refused(() => searchPick(engine, [id("twin")]), "a same-named Cheats cannot be found");
    refused(() => searchPick(engine, [id("thief")]), "a non-pluck cannot be found");
    searchPick(engine, []);
    resolvePendingResponses(engine);
  }
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("cm")), "deck");
  assert.equal(zoneOf(engine, id("twin")), "deck");
  assert.equal(zoneOf(engine, id("thief")), "deck");
});

clause(LATE_ADDITION, "0:rule", "played on the opponent's turn in response, I can still play a character from my hand (paying its costs) and draw", () => {
  const { engine, id } = lateBoard({
    turn: 2,
    active: P2,
    extra: [
      { key: "nothing", def: nothingTactic(), owner: P2, zone: "hand" },
      ...bank("deception", 2, P1)
    ]
  });
  playRaw(engine, P2, id("nothing"));
  const before = ready(engine);
  playRaw(engine, P1, id("me"));
  resolvePendingResponses(engine);
  lateChoose(engine, id("guy"));
  assert.equal(zoneOf(engine, id("guy")), "play");
  assert.equal(before - ready(engine), 3, "1 + 2");
  assert.equal(zoneOf(engine, id("m0")), "hand", "and I drew");
});

clause(LATE_ADDITION, "0:rule", "the played character is a normal deploy: its enters-play ability resolves", () => {
  const etb = character({
    name: "EtbGuy",
    cost: 1,
    behavior: { abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "modifyInfluence", player: "opponent", amount: -2 }] }] }
  });
  const { engine, id } = lateBoard({ extra: [{ key: "etbGuy", def: etb, owner: P1, zone: "hand" }] });
  play(engine, P1, id("me"));
  lateChoose(engine, id("etbGuy"));
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("etbGuy")), "play");
  assert.equal(influence(engine, P2), 28, "its trigger drained the opponent");
});

clause(COUNTER_ATTACK, "0:ability", "played in response to the end of their turn, the turn still ends once the battle is resolved (the announcement is not lost)", () => {
  const game = counterBoard();
  const { engine, id } = game;
  engine.perform({ type: "endTurn", playerId: P2 });
  playRaw(engine, P1, id("ca"), { selected: { atk: [id("a1")] } });
  resolvePendingResponses(engine);
  declareAttackBlockers(engine, []);
  autoResolveBattle(engine);
  resolvePendingResponses(engine);
  assert.equal(battleOf(engine), undefined);
  assert.equal(engine.state.activePlayerId, P1, "their turn ended and mine began");
  assert.equal(engine.state.turn, 3);
});

clause(COUNTER_ATTACK, "0:ability", "the opponent's blockers that fought are depleted afterwards only as battle rules say: unblocking characters are not touched", () => {
  const game = counterBoard();
  const { engine, id } = game;
  openOpponentWindow(game);
  playCounterAttack(game, ["a1"]);
  declareAttackBlockers(engine, [id("foe")]);
  autoResolveBattle(engine);
  assert.equal(isDepleted(engine, id("foe")), true, "a blocker that survived the battle is depleted (CR 609.1h)");
  assert.equal(isDepleted(engine, id("foe2")), false, "the character that did not fight is not");
});

clause(TURNCOAT, "0:ability", "taking control of a character in a battle removes it from that battle (CR 407.4)", () => {
  const game = turncoatBoard({
    turn: 2,
    active: P2,
    extra: [
      { key: "atk", def: character({ name: "Attacker", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "atk2", def: character({ name: "Attacker2", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  const { engine, id } = game;
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk"), id("atk2")], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  playRaw(engine, P1, id("me"), { selected: { sac: [id("s1"), id("s2")], picks: [id("atk")] } });
  resolvePendingResponses(engine);
  assert.equal(controllerOf(engine, id("atk")), P1, "control: I took it");
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("atk2")], "it left their attacking party");
});

// --- more depth: elusive characters, vanilla, Gang Leader, Throatstabber ---------------------------------------------------

function opponentTriggerCannotPick(printingId: string) {
  const sniper = character({
    name: "EtbSniper",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "etb",
          type: "triggered",
          event: "cardEnteredPlay",
          condition: { type: "sourceIsEventCard" },
          targets: [{ id: "t", selector: { zone: "play", type: "character", conditions: [{ type: "not", condition: { type: "isCard", other: "source" } }] }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }]
        }
      ]
    }
  });
  const { engine, id } = elusiveBoard(printingId, [
    { key: "plain2", def: character({ name: "Plain2", life: 5 }), owner: P1, zone: "play" },
    { key: "sniper", def: sniper, owner: P2, zone: "hand" }
  ]);
  play(engine, P2, id("sniper"));
  const pc = pending(engine)!;
  assert.equal(pc.kind, "selectTargets", "the opponent must pick a target for the trigger");
  assert.equal(pc.playerId, P2);
  refused(() => answerPending(engine, "selectTargets", { selected: { t: [id("ma")] } }), "a trigger's pick cannot be it");
  answerPending(engine, "selectTargets", { selected: { t: [id("plain")] } });
  assert.equal(engine.state.cards[id("plain")].damage, 1, "control: they can pick my other character");
  assert.equal(engine.state.cards[id("ma")].damage, 0);
}

function opponentUntypedPickCannot(printingId: string) {
  const anyPick = tactic({
    name: "AnyPick",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "a",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }]
        }
      ]
    }
  });
  const { engine, id } = elusiveBoard(printingId, [{ key: "anyPick", def: anyPick, owner: P2, zone: "hand" }]);
  refused(() => playRaw(engine, P2, id("anyPick"), { selected: { t: [id("ma")] } }), "'a card' in play still cannot be it");
  play(engine, P2, id("anyPick"), { selected: { t: [id("plain")] } });
  assert.equal(engine.state.cards[id("plain")].damage, 1);
  assert.equal(engine.state.cards[id("ma")].damage, 0);
}

function opponentTwoPickCannot(printingId: string) {
  const twoPick = tactic({
    name: "TwoPick",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "two",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 2 }],
          effects: [{ type: "forEach", selected: "t", effects: [{ type: "dealDamage", target: { type: "selected", id: "__candidate" }, amount: 1 }] }]
        }
      ]
    }
  });
  const { engine, id } = elusiveBoard(printingId, [
    { key: "plain2", def: character({ name: "Plain2", life: 5 }), owner: P1, zone: "play" },
    { key: "twoPick", def: twoPick, owner: P2, zone: "hand" }
  ]);
  refused(() => playRaw(engine, P2, id("twoPick"), { selected: { t: [id("ma"), id("plain")] } }), "it can't be one of the two");
  play(engine, P2, id("twoPick"), { selected: { t: [id("plain"), id("plain2")] } });
  assert.equal(engine.state.cards[id("plain")].damage, 1);
  assert.equal(engine.state.cards[id("plain2")].damage, 1);
  assert.equal(engine.state.cards[id("ma")].damage, 0);
}

function myOwnAbilityMayPickIt(printingId: string) {
  const sniper = character({
    name: "MySniper",
    behavior: {
      abilities: [
        {
          id: "snipe",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }]
        }
      ]
    }
  });
  const { engine, id } = elusiveBoard(printingId, [{ key: "sniper", def: sniper, owner: P1, zone: "play" }], { active: P1 });
  activate(engine, P1, id("sniper"), "snipe", { selected: { t: [id("ma")] } });
  const life = printing(printingId).life!;
  if (life <= 1) assert.equal(zoneOf(engine, id("ma")), "discard", "I may pick it: 1 damage kills the 1-life Trainee");
  else assert.equal(engine.state.cards[id("ma")].damage, 1, "I may pick it");
}

function stillBlocksAndAttacks(printingId: string) {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "ma", def: printing(printingId), owner: P2, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 0, life: 9, speed: 1 }), owner: P1, zone: "play" }
    ]
  });
  declareAttackBy(engine, P1, [id("atk")]);
  declareBlockers(engine, P2, [id("ma")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("ma")], "being unpickable doesn't stop it blocking");
}

clause(MARTIAL_ARTIST, "0:rule", "an opponent's triggered ability cannot pick it either", () => opponentTriggerCannotPick(MARTIAL_ARTIST));
clause(MARTIAL_ARTIST, "0:rule", "an opponent's pick of 'a card' in play (no type given) cannot be it", () => opponentUntypedPickCannot(MARTIAL_ARTIST));
clause(MARTIAL_ARTIST, "0:rule", "in a two-character pick the opponent can't use it as one of the two", () => opponentTwoPickCannot(MARTIAL_ARTIST));
clause(MARTIAL_ARTIST, "0:rule", "its own controller's abilities can pick it", () => myOwnAbilityMayPickIt(MARTIAL_ARTIST));
clause(MARTIAL_ARTIST, "0:rule", "it still blocks normally", () => stillBlocksAndAttacks(MARTIAL_ARTIST));
clause(TRAINEE, "0:rule", "an opponent's triggered ability cannot pick it either", () => opponentTriggerCannotPick(TRAINEE));
clause(TRAINEE, "0:rule", "an opponent's pick of 'a card' in play (no type given) cannot be it", () => opponentUntypedPickCannot(TRAINEE));
clause(TRAINEE, "0:rule", "in a two-character pick the opponent can't use it as one of the two", () => opponentTwoPickCannot(TRAINEE));
clause(TRAINEE, "0:rule", "its own controller's abilities can pick it", () => myOwnAbilityMayPickIt(TRAINEE));
clause(TRAINEE, "0:rule", "it still blocks normally", () => stillBlocksAndAttacks(TRAINEE));

clause(HASTY, "vanilla", "like any card it can be played face-down as a resource: it then provides one resource and no longer has a name, type or stats of its own", () => {
  const { engine, id } = handBoard(HASTY, { deception: 0 });
  const before = ready(engine);
  developPlay(engine, P1, id("me"), true);
  assert.equal(zoneOf(engine, id("me")), "play");
  assert.equal(engine.state.cards[id("me")].faceDown, true);
  assert.equal(engine.isResource(id("me")), true, "face-down it is a resource");
  assert.equal(ready(engine) - before, 1, "providing one resource to spend");
});

clause(HASTY, "vanilla", "it has no ability to deploy early: in my own turn it is played at the normal timing only, so it cannot be played on the opponent's turn", () => {
  const { engine, id } = handBoard(HASTY, { deception: 6, turn: 2, active: P2, extra: [{ key: "nothing", def: nothingTactic(), owner: P2, zone: "hand" }] });
  playRaw(engine, P2, id("nothing"));
  refused(() => playRaw(engine, P1, id("me")), "a character can't be played in response");
  assert.equal(zoneOf(engine, id("me")), "hand");
});

clause(HASTY, "vanilla", "just entered play it can block but cannot attack that turn", () => {
  const { engine, id } = handBoard(HASTY, { deception: 5, turn: 2, active: P1 });
  play(engine, P1, id("me"));
  refused(() => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("me")], target: { type: "faction", playerId: P2 } }), "not in play since the start of the turn");
});

clause(GANG_LEADER, "0:rule", "two Gang Leaders in one turn: the first gets the bonus twice (once for each entering), the second once, my ally twice", () => {
  const { engine, id } = leaderBoard({ extra: [{ key: "me2", def: printing(GANG_LEADER), owner: P1, zone: "hand" }] });
  play(engine, P1, id("me"));
  play(engine, P1, id("me2"));
  assert.equal(engine.getStat(id("me"), "speed"), 5, "3 + 1 (itself) + 1 (the second Leader)");
  assert.equal(engine.getStat(id("me2"), "speed"), 4, "3 + 1 (itself)");
  assert.equal(engine.getStat(id("a"), "speed"), 4, "2 + 1 + 1");
});

clause(GANG_LEADER, "0:rule", "it triggers however it enters play: put into play by an effect it still speeds my characters up", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "gl", def: printing(GANG_LEADER), owner: P1, zone: "hand" },
      { key: "ally", def: character({ name: "Ally", speed: 2 }), owner: P1, zone: "play" },
      { key: "putin", def: putIntoPlayTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("putin"), { selected: { t: [id("gl")] } });
  assert.equal(zoneOf(engine, id("gl")), "play");
  assert.equal(engine.getStat(id("ally"), "speed"), 3);
});

clause(GANG_LEADER, "0:rule", "the extra speed applies at once to a character that attacks this turn: a speed-1 attacker now strikes before a speed-1 blocker", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "gl", def: printing(GANG_LEADER), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Attacker", strength: 3, life: 1, speed: 1 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blocker", strength: 5, life: 3, speed: 1 }), owner: P2, zone: "play" },
      ...bank("deception", 3, P1)
    ]
  });
  play(engine, P1, id("gl"));
  declareAttackBy(engine, P1, [id("atk")]);
  declareBlockers(engine, P2, [id("blk")]);
  autoResolveBattle(engine);
  assert.equal(zoneOf(engine, id("blk")), "discard");
  assert.equal(zoneOf(engine, id("atk")), "play", "speed 2 struck first and killed the 3-life blocker before it hit back");
});

clause(THROATSTABBER, "0:rule", "put into play by an effect (not deployed) it still flips: a lost flip depletes it", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    random: LOSE,
    cards: [
      { key: "ts", def: printing(THROATSTABBER), owner: P1, zone: "hand" },
      { key: "putin", def: putIntoPlayTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("putin"), { selected: { t: [id("ts")] } });
  assert.equal(zoneOf(engine, id("ts")), "play");
  assert.deepEqual(coinFlips(engine), [{ playerId: P1, won: false }]);
  assert.equal(isDepleted(engine, id("ts")), true);
});

clause(THROATSTABBER, "0:rule", "the win/lose branches are the whole rule: nothing else changes (stats and the opponent are untouched either way)", () => {
  for (const random of [WIN, LOSE]) {
    const { engine, id } = handBoard(THROATSTABBER, { deception: 3, random, extra: [{ key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }] });
    play(engine, P1, id("me"));
    assert.deepEqual(stats(engine, id("me")), [3, 2, 4]);
    assert.equal(influence(engine, P1), 30);
    assert.equal(influence(engine, P2), 30);
    assert.equal(isDepleted(engine, id("foe")), false);
  }
});

// --- END OF FILE MARKER (next card goes above) ---
