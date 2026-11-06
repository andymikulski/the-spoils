// Clause tests — batch shade-of-the-devoured-emperor-02, part p3 (groups 14-19, missing clauses).
// See docs/TESTING.md. Expectations come from each card's PRINTED text
// (Shade of the Devoured Emperor) and RULES.md / the CR; engine data is only used to drive the engine.

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
  resourceCard,
  tactic,
  volition,
  P1,
  P2
} from "../per-card/_harness.js";
import { clause, declineAll, printing, refused } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { fightThrough, playRaw } from "./_battle.js";
import { answerPending, pending, zoneOf } from "./_board.js";
import { endTurn } from "./_turn.js";
import type { CardDefinition, CardInstanceId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

type Pid = typeof P1 | typeof P2;
const other = (p: Pid): Pid => (p === P1 ? P2 : P1);
const ready = (engine: SpoilsEngine, p: Pid = P1) => engine.getAvailableResourceCount(p);
const handOf = (engine: SpoilsEngine, p: Pid) => engine.state.players[p].hand;
const deckOf = (engine: SpoilsEngine, p: Pid) => engine.state.players[p].deck;
const discardOf = (engine: SpoilsEngine, p: Pid) => engine.state.players[p].discard;
const greedOf = (engine: SpoilsEngine, p: Pid = P1) => engine.getThresholds(p).greed ?? 0;
const sorted = (ids: readonly string[]) => [...ids].sort();
const faceDownOf = (engine: SpoilsEngine, owner: Pid): CardInstanceId[] =>
  engine.state.players[owner].play.filter((c) => engine.state.cards[c].faceDown);
const stats = (engine: SpoilsEngine, c: CardInstanceId) => [engine.getStat(c, "strength"), engine.getStat(c, "life"), engine.getStat(c, "speed")];

/** Fisher-Yates exactly as the engine does it, fed by a constant random source (to predict a shuffle). */
function shuffledWithConstant(items: string[], value: number): string[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(value * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** `resources` already attached to (spent on) the owner's faction. */
function spentBank(icon: "greed" | "obsession" | "rage", n: number, owner: Pid): CardPlacement[] {
  return bank(icon, n, owner).map((p) => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));
}

/** A tactic that moves the picked character from play to its owner's hand (leaves play WITHOUT being destroyed). */
const bounceTactic = () =>
  tactic({
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
  } as Partial<CardDefinition>);

/** A tactic that only draws a card (no search anywhere). */
const cantripTactic = () =>
  tactic({
    name: "Cantrip",
    cost: 0,
    behavior: { abilities: [{ id: "c", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  } as Partial<CardDefinition>);

const stapleResource = (name: string, icon: "rage" | "greed" | "elitism", staple = true) =>
  resourceCard({ name, resource: { provides: [icon], staple } } as Partial<CardDefinition>);

// ==============================================================================
// Fallen Quarter-Finalist — vanilla. banker necromorph character, cost 6, [G][G][G][G], 7 / 3 / 5.
// ==============================================================================

const QUARTER = "44dab93b-3b92-46ee-aa64-6bb4eb42c76a";

function quarterBoard(greed: number, obsession: number) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "fq", def: printing(QUARTER), owner: P1, zone: "hand" },
      ...bank("greed", greed, P1),
      ...bank("obsession", obsession, P1)
    ]
  });
}

clause(QUARTER, "vanilla", "deploys for exactly its printed cost of 6: six resources are spent, none more", () => {
  const b = quarterBoard(4, 2);
  const before = ready(b.engine);
  play(b.engine, P1, b.id("fq"));
  assert.equal(zoneOf(b.engine, b.id("fq")), "play");
  assert.equal(before - ready(b.engine), 6);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(QUARTER, "vanilla", "is refused one resource short of its cost (5 of 6) and stays in hand", () => {
  const short = quarterBoard(4, 1);
  refused(() => playRaw(short.engine, P1, short.id("fq")), "5 resources for a cost of 6");
  assert.equal(zoneOf(short.engine, short.id("fq")), "hand");
  assert.equal(ready(short.engine), 5, "nothing was spent");
  const ok = quarterBoard(4, 2);
  play(ok.engine, P1, ok.id("fq"));
  assert.equal(zoneOf(ok.engine, ok.id("fq")), "play", "positive control: 6 resources deploy it");
});

clause(QUARTER, "vanilla", "is refused without the printed threshold [G][G][G][G] however many other resources you have", () => {
  const three = quarterBoard(3, 9);
  refused(() => playRaw(three.engine, P1, three.id("fq")), "only [G][G][G] of the required [G][G][G][G]");
  assert.equal(three.engine.getCardPlayability(P1, three.id("fq")).playable, false);
  assert.equal(zoneOf(three.engine, three.id("fq")), "hand");
  const four = quarterBoard(4, 2);
  assert.equal(four.engine.getCardPlayability(P1, four.id("fq")).playable, true);
  const six = quarterBoard(6, 0);
  play(six.engine, P1, six.id("fq"));
  assert.equal(zoneOf(six.engine, six.id("fq")), "play", "six [G] pay for it");
});

clause(QUARTER, "vanilla", "has its printed stats in play: 7 strength, 5 life, 3 speed; it is a banker necromorph character", () => {
  const b = quarterBoard(4, 2);
  play(b.engine, P1, b.id("fq"));
  assert.deepEqual(stats(b.engine, b.id("fq")), [7, 5, 3]);
  const def = b.engine.getDefinition(b.id("fq"));
  assert.equal(def.type, "character");
  assert.equal(def.trade, "banker");
  assert.deepEqual(def.subtype, ["necromorph"]);
});

clause(QUARTER, "vanilla", "has no rules text: no keywords, no abilities, no restrictions and nothing triggers when it enters play", () => {
  const b = quarterBoard(4, 2);
  play(b.engine, P1, b.id("fq"));
  assert.deepEqual(b.engine.getKeywords(b.id("fq")), []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.getDefinition(b.id("fq")).behavior?.abilities?.length ?? 0, 0);
  assert.deepEqual(b.engine.getRestrictions(b.id("fq")), []);
  assert.equal(b.engine.getAvailableActivatedAbilities(P1).filter((a) => a.cardId === b.id("fq")).length, 0);
});

// ==============================================================================
// Golden Charm — banker item, cost 3, [G].
//   UNIQUE CHARM
//   If a player would search their deck you may pay 1 instead. If you do, draw a card
//   and then that player searches their deck.
//   SERAPHIM FUSION -- COST: Pay 4. Pick a UNIQUE EUSTACE you control. Destroy this card.
//     EFFECT: Search your deck for a card named "Siluriformes Flaxenscale" and put it into play.
// ==============================================================================

const CHARM = "b36130ca-d095-4cda-98b4-e6a1de823e40";
const GEAR_TACTIC = "97a5cad1-4663-414c-b230-9348968f6fb1"; // I Got the Gear! — cost 1 [E]: "You may search your deck for a gear card and reveal it. If you do, put it into your hand."
const RESEARCH = "ec646752-561a-4ba7-9c0c-69eb41457d56"; // Research Investment — cost 0 [E]x6: "Each player may search their deck for up to 3 staple resources and put them into play."
const SILURIFORMES = "6b29fb62-bd69-49ef-9f20-dc8712205d4f"; // UNIQUE SILURIFORMES: "All UNIQUE EUSTACE gain 3 strength and 3 life."
const EUSTACE = "3f574bdd-e7b7-4757-a955-2a33d19a250d"; // Eustace Padamose-Gristwalter (UNIQUE EUSTACE)
const EUSTACE_GLUTTON = "1b7bb2f0-4fcd-4a93-8ccf-7a0142aca7a0"; // Eustace, Sensible Glutton (UNIQUE EUSTACE)

function charmBoard(extra: CardPlacement[] = [], opts: { greed?: number; turn?: number; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "gc", def: printing(CHARM), owner: P1, zone: "play" },
      ...bank("greed", opts.greed ?? 6, P1),
      ...extra
    ]
  });
}

clause(CHARM, "0:unique", "controlling a second GOLDEN CHARM makes you keep one: choosing the new one destroys the old one", () => {
  const b = charmBoard([{ key: "gc2", def: printing(CHARM), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("gc2"));
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses");
  assert.deepEqual(sorted(pc.candidates), sorted([b.id("gc"), b.id("gc2")]));
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("gc2") } } as never);
  assert.equal(zoneOf(b.engine, b.id("gc2")), "play");
  assert.equal(zoneOf(b.engine, b.id("gc")), "discard", "the other copy is destroyed");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(CHARM, "0:unique", "choosing the old one keeps it and destroys the new one", () => {
  const b = charmBoard([{ key: "gc2", def: printing(CHARM), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("gc2"));
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("gc") } } as never);
  assert.equal(zoneOf(b.engine, b.id("gc")), "play");
  assert.equal(zoneOf(b.engine, b.id("gc2")), "discard");
});

clause(CHARM, "0:unique", "the restriction is per player: the opponent may control their own GOLDEN CHARM with no choice and no destruction", () => {
  const b = charmBoard(
    [
      { key: "gc2", def: printing(CHARM), owner: P2, zone: "hand" },
      ...bank("greed", 6, P2)
    ],
    { turn: 2, active: P2 }
  );
  play(b.engine, P2, b.id("gc2"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("gc")), "play");
  assert.equal(zoneOf(b.engine, b.id("gc2")), "play");
});

clause(CHARM, "0:unique", "taking control of the opponent's GOLDEN CHARM while you have your own is a duplicate: you must keep one", () => {
  const steal = tactic({
    name: "Steal",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "s",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }],
          effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  } as Partial<CardDefinition>);
  const b = charmBoard([
    { key: "theirs", def: printing(CHARM), owner: P2, zone: "play" },
    { key: "steal", def: steal, owner: P1, zone: "hand" }
  ]);
  play(b.engine, P1, b.id("steal"), { selected: { t: [b.id("theirs")] } });
  assert.equal(pending(b.engine)?.kind, "uniqueSurvivor", "two Charms under one player's control");
  assert.equal(pending(b.engine)?.playerId, P1);
});

clause(CHARM, "0:unique", "a card with a different UNIQUE designation (or none) is not a duplicate", () => {
  const b = charmBoard([{ key: "other", def: item({ name: "Other Doodad", unique: "doodad" } as Partial<CardDefinition>), owner: P1, zone: "play" }]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("gc")), "play");
  assert.equal(zoneOf(b.engine, b.id("other")), "play");
});

// --- the search rule -----------------------------------------------------------
// Sources of "a player searches their deck" that use the engine's search-as-pick form:
// I Got the Gear! (one player) and Research Investment (each player).

/** Answers every open choice: a deck search takes `pick(searcher)`, Golden Charm's may-pay is answered by `pay(playerId, promptIndex)`. Returns who was offered the may-pay, in order. */
function driveSearch(engine: SpoilsEngine, pick: (searcher: string) => string[], pay: (playerId: string, index: number) => boolean = () => true): string[] {
  const prompts: string[] = [];
  let guard = 0;
  while (engine.state.pendingChoice && guard++ < 12) {
    const pc = pending(engine) as PendingChoiceLike;
    if (pc.kind === "mayPay") {
      const answer = pay(pc.playerId, prompts.length);
      prompts.push(pc.playerId);
      answerPending(engine, "mayPay", { pay: answer });
    } else if (pc.kind === "chooserSelectsTarget") {
      answerPending(engine, "chooserSelectsTarget", { selected: pick(pc.playerId) });
    } else {
      assert.fail(`unexpected pending choice ${pc.kind}`);
    }
  }
  return prompts;
}

/** The ids of `ids` that are still in `engine`'s deck right now. */
const stillInDeck = (engine: SpoilsEngine, ids: string[]) => ids.filter((c) => engine.state.cards[c].zone === "deck");

/**
 * `searcher` casts I Got the Gear! (cost 1, [E]) with exactly `elitism` elitism and `spare` spare greed. Each player's deck is
 * `<owner>-c0`, `<owner>-g` (a gear item), `<owner>-c1` (top first), or the gear on top with `gearFirst`.
 * `charm`: whose side the Golden Charm is on ("searcher" | "other" | "hand" = in the searcher's hand | "none").
 */
function gearBoard(o: { searcher?: Pid; charm?: "searcher" | "other" | "hand" | "none"; elitism?: number; spare?: number; gearFirst?: boolean } = {}) {
  const searcher = o.searcher ?? P1;
  const opp = other(searcher);
  const deck = (owner: Pid): CardPlacement[] =>
    (o.gearFirst ? ["g", "c0", "c1"] : ["c0", "g", "c1"]).map((n) => ({
      key: `${owner}-${n}`,
      def: n === "g" ? item({ name: `${owner} Gear`, subtype: ["gear"] }) : character({ name: `${owner} ${n}` }),
      owner,
      zone: "deck" as const
    }));
  const charm = o.charm ?? "searcher";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: searcher === P1 ? undefined : 2,
    activePlayerId: searcher === P1 ? undefined : P2,
    cards: [
      { key: "gear", def: printing(GEAR_TACTIC), owner: searcher, zone: "hand" },
      ...bank("elitism", o.elitism ?? 1, searcher),
      ...bank("greed", o.spare ?? 3, searcher),
      ...bank("greed", 3, opp),
      ...(charm === "none"
        ? []
        : [{ key: "charm", def: printing(CHARM), owner: charm === "other" ? opp : searcher, zone: charm === "hand" ? ("hand" as const) : ("play" as const) }]),
      ...deck(P1),
      ...deck(P2)
    ]
  });
}

clause(CHARM, "1:rule", "you search your own deck: the Charm offers you to pay 1; paying spends exactly 1, draws a card, and the search still happens", () => {
  const { engine, id } = gearBoard();
  play(engine, P1, id("gear"));
  const afterCast = ready(engine);
  const prompts = driveSearch(engine, () => stillInDeck(engine, [id("p1-g")]));
  assert.deepEqual(prompts, [P1], "exactly one may-pay, offered to the Charm's controller");
  assert.equal(afterCast - ready(engine), 1, "paid exactly 1");
  assert.deepEqual(sorted(handOf(engine, P1)), sorted([id("p1-c0"), id("p1-g")]), "drew the top card, and the search found the gear");
  assert.deepEqual(deckOf(engine, P1), [id("p1-c1")]);
  assert.equal(zoneOf(engine, id("gear")), "discard");
});

clause(CHARM, "1:rule", "declining the Charm: nothing is paid, nothing is drawn, and the search proceeds normally", () => {
  const { engine, id } = gearBoard();
  play(engine, P1, id("gear"));
  const afterCast = ready(engine);
  const prompts = driveSearch(engine, () => stillInDeck(engine, [id("p1-g")]), () => false);
  assert.deepEqual(prompts, [P1]);
  assert.equal(ready(engine), afterCast, "no resource was paid");
  assert.deepEqual(handOf(engine, P1), [id("p1-g")], "only the searched gear is in hand");
  assert.deepEqual(sorted(deckOf(engine, P1)), sorted([id("p1-c0"), id("p1-c1")]));
});

clause(CHARM, "1:rule", "you draw a card and THEN the search happens: the card just drawn is no longer in the deck to be found", () => {
  const { engine, id } = gearBoard({ gearFirst: true });
  play(engine, P1, id("gear"));
  driveSearch(engine, () => stillInDeck(engine, [id("p1-g")]));
  assert.deepEqual(handOf(engine, P1), [id("p1-g")], "the gear on top was drawn first, so the search had nothing left to find and drew no second card");
  assert.deepEqual(sorted(deckOf(engine, P1)), sorted([id("p1-c0"), id("p1-c1")]), "the other cards stay in the deck");
});

clause(CHARM, "1:rule", "the option is offered even when the search comes up empty (the player would still search): paying still draws", () => {
  const { engine, id } = gearBoard();
  play(engine, P1, id("gear"));
  const afterCast = ready(engine);
  const prompts = driveSearch(engine, () => []);
  assert.deepEqual(prompts, [P1], "the Charm still asks");
  assert.equal(afterCast - ready(engine), 1);
  assert.deepEqual(handOf(engine, P1), [id("p1-c0")], "drew one card; the search found nothing");
});

clause(CHARM, "1:rule", "a search by the OPPONENT also lets the Charm's controller pay 1 and draw; the searcher does not draw", () => {
  const { engine, id } = gearBoard({ searcher: P2, charm: "other" });
  const p1Ready = ready(engine, P1);
  const p2Ready = ready(engine, P2);
  play(engine, P2, id("gear"));
  const p2AfterCast = ready(engine, P2);
  const prompts = driveSearch(engine, () => stillInDeck(engine, [id("p2-g")]));
  assert.deepEqual(prompts, [P1], "the Charm's controller (not the searching player) is asked");
  assert.equal(p1Ready - ready(engine, P1), 1, "the Charm's controller paid 1");
  assert.equal(ready(engine, P2), p2AfterCast, "the searching player paid nothing");
  assert.deepEqual(handOf(engine, P1), [id("p1-c0")], "the Charm's controller drew a card");
  assert.deepEqual(handOf(engine, P2), [id("p2-g")], "the searcher only found the gear: no draw");
  assert.ok(p2Ready > 0, "p2Ready > 0");
});

clause(CHARM, "1:rule", "the Charm on the opponent's side works for them against my search; I do not draw", () => {
  const { engine, id } = gearBoard({ searcher: P1, charm: "other" });
  const p1AfterCast = (play(engine, P1, id("gear")), ready(engine, P1));
  const p2Before = ready(engine, P2);
  const prompts = driveSearch(engine, () => stillInDeck(engine, [id("p1-g")]));
  assert.deepEqual(prompts, [P2]);
  assert.equal(p2Before - ready(engine, P2), 1, "the opponent paid 1");
  assert.deepEqual(handOf(engine, P2), [id("p2-c0")], "the opponent drew");
  assert.deepEqual(handOf(engine, P1), [id("p1-g")], "I only found my gear");
  assert.equal(ready(engine, P1), p1AfterCast);
});

clause(CHARM, "1:rule", "when each player searches, the Charm asks once per search (own and opponent's), and each yes draws a card for its controller", () => {
  const stp = (owner: Pid, n: string) => ({ key: `${owner}-${n}`, def: stapleResource(`${owner} ${n}`, "rage"), owner, zone: "deck" as const });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ri", def: printing(RESEARCH), owner: P1, zone: "hand" },
      { key: "gc", def: printing(CHARM), owner: P1, zone: "play" },
      ...bank("elitism", 6, P1),
      ...bank("greed", 3, P1),
      ...Array.from({ length: 4 }, (_, i) => ({ key: `p1-c${i}`, def: character({ name: `P1 c${i}` }), owner: P1, zone: "deck" as const })),
      stp(P1, "s0"),
      stp(P2, "s0"),
      { key: "p2-c0", def: character({ name: "P2 c0" }), owner: P2, zone: "deck" }
    ]
  });
  play(engine, P1, id("ri"));
  const afterCast = ready(engine);
  const prompts = driveSearch(engine, (searcher) => stillInDeck(engine, [id(`${searcher}-s0`)]));
  assert.deepEqual(prompts, [P1, P1], "two searches (mine, then the opponent's), both offered to the Charm's controller");
  assert.equal(afterCast + 1 - ready(engine), 2, "two payments of 1 (my staple entering play added one ready resource)");
  assert.equal(handOf(engine, P1).length, 2, "two cards drawn");
  assert.equal(handOf(engine, P2).length, 0, "the opponent drew nothing");
  assert.equal(zoneOf(engine, id("p1-s0")), "play", "my search still put my staple into play");
  assert.equal(zoneOf(engine, id("p2-s0")), "play", "and the opponent's search put theirs into play");
});

clause(CHARM, "1:rule", "the draw comes first and the search after it: a staple on top of the deck is drawn, not put into play", () => {
  const stp = (owner: Pid, n: string) => ({ key: `${owner}-${n}`, def: stapleResource(`${owner} ${n}`, "rage"), owner, zone: "deck" as const });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ri", def: printing(RESEARCH), owner: P1, zone: "hand" },
      { key: "gc", def: printing(CHARM), owner: P1, zone: "play" },
      ...bank("elitism", 6, P1),
      ...bank("greed", 3, P1),
      stp(P1, "s0"),
      ...Array.from({ length: 3 }, (_, i) => ({ key: `p1-c${i}`, def: character({ name: `P1 c${i}` }), owner: P1, zone: "deck" as const })),
      { key: "p2-c0", def: character({ name: "P2 c0" }), owner: P2, zone: "deck" }
    ]
  });
  play(engine, P1, id("ri"));
  // pay only for my own search (the first may-pay); the staple is the top card of my deck
  driveSearch(engine, (searcher) => stillInDeck(engine, [id(`${searcher}-s0`)]), (_pid, index) => index === 0);
  assert.equal(zoneOf(engine, id("p1-s0")), "hand", "the top card (the only staple) was drawn first, so the search that follows finds no staple");
  assert.equal(handOf(engine, P1).length, 1, "and exactly one card was drawn");
});

clause(CHARM, "1:rule", "cannot pay 1 with no resource left: no card is drawn, but the search still happens", () => {
  const { engine, id } = gearBoard({ spare: 0 });
  play(engine, P1, id("gear"));
  assert.equal(ready(engine), 0, "the cast spent the only resource");
  driveSearch(engine, () => stillInDeck(engine, [id("p1-g")]));
  assert.equal(ready(engine), 0);
  assert.deepEqual(handOf(engine, P1), [id("p1-g")], "no draw, only the search result");
  assert.ok(deckOf(engine, P1).includes(id("p1-c0")), "the top card was not drawn");
});

clause(CHARM, "1:rule", "does not apply when the Charm is not in play (in hand): the search is just a search", () => {
  const { engine, id } = gearBoard({ charm: "hand" });
  play(engine, P1, id("gear"));
  const prompts = driveSearch(engine, () => stillInDeck(engine, [id("p1-g")]));
  assert.deepEqual(prompts, []);
  assert.deepEqual(handOf(engine, P1).filter((c) => c !== id("charm")), [id("p1-g")]);
});

clause(CHARM, "1:rule", "does not apply when nobody searches: drawing a card or casting an ordinary tactic never offers the payment", () => {
  const { engine, id } = charmBoard([
    { key: "cantrip", def: cantripTactic(), owner: P1, zone: "hand" },
    { key: "top", def: character({ name: "Top" }), owner: P1, zone: "deck" }
  ]);
  play(engine, P1, id("cantrip"));
  assert.equal(engine.state.pendingChoice, undefined, "no may-pay");
  assert.deepEqual(handOf(engine, P1), [id("top")]);
});

// The two real Goldmau / Fusion searches name their card up front instead of picking it afterwards.

clause(CHARM, "1:rule", "a search by Goldmau Sacks Representative's INVEST also lets the Charm's controller pay 1 and draw", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "gc", def: printing(CHARM), owner: P1, zone: "play" },
      { key: "gsr", def: printing("94a47bcb-c174-47a9-a293-8183632b2fac"), owner: P1, zone: "play" },
      ...bank("greed", 8, P1),
      { key: "top", def: character({ name: "Top" }), owner: P1, zone: "deck" },
      { key: "res", def: stapleResource("Deck Rage", "rage"), owner: P1, zone: "deck" }
    ]
  });
  const before = ready(engine);
  activate(engine, P1, id("gsr"), "gsr-invest", { selected: { r: [id("res")] } });
  const pc = pending(engine);
  assert.equal(pc?.kind, "mayPay", "Golden Charm offers its controller to pay 1");
  assert.equal(pc?.playerId, P1);
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(before - ready(engine), 3, "INVEST's 2 plus the Charm's 1");
  assert.deepEqual(sorted(handOf(engine, P1)), sorted([id("top"), id("res")]), "a card was drawn and the resource was searched");
});

clause(CHARM, "1:rule", "an opponent's SERAPHIM FUSION search also lets the other player's Charm pay 1 and draw", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "gc", def: printing(CHARM), owner: P1, zone: "play" },
      { key: "eu", def: printing(EUSTACE), owner: P1, zone: "play" },
      ...bank("greed", 6, P1),
      { key: "theirs", def: printing(CHARM), owner: P2, zone: "play" },
      ...bank("greed", 3, P2),
      { key: "p2top", def: character({ name: "P2 top" }), owner: P2, zone: "deck" },
      { key: "silu", def: printing(SILURIFORMES), owner: P1, zone: "deck" }
    ]
  });
  activate(engine, P1, id("gc"), "gc-fusion", { selected: { e: [id("eu")], s: [id("silu")] } });
  const pc = pending(engine);
  assert.equal(pc?.kind, "mayPay", "the opponent's Golden Charm is triggered by my search");
  assert.equal(pc?.playerId, P2);
});

// --- SERAPHIM FUSION ------------------------------------------------------------

function fusionBoard(o: { resources?: number; eustace?: "mine" | "theirs" | "hand" | "none"; extra?: CardPlacement[]; random?: () => number } = {}) {
  const eustace = o.eustace ?? "mine";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: o.random,
    cards: [
      { key: "gc", def: printing(CHARM), owner: P1, zone: "play" },
      ...(eustace === "none" ? [] : [{ key: "eu", def: printing(EUSTACE), owner: eustace === "theirs" ? P2 : P1, zone: eustace === "hand" ? ("hand" as const) : ("play" as const) }]),
      ...bank("greed", o.resources ?? 4, P1),
      { key: "d0", def: character({ name: "D0" }), owner: P1, zone: "deck" },
      { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
      { key: "silu", def: printing(SILURIFORMES), owner: P1, zone: "deck" },
      { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" },
      { key: "d3", def: character({ name: "D3" }), owner: P1, zone: "deck" },
      ...(o.extra ?? [])
    ]
  });
}

const fuse = (b: ReturnType<typeof fusionBoard>, selected?: Record<string, string[]>) =>
  activate(b.engine, P1, b.id("gc"), "gc-fusion", { selected: selected ?? { e: [b.id("eu")], s: [b.id("silu")] } });

clause(CHARM, "2:ability:gc-fusion", "pays 4, destroys the Charm, and puts Siluriformes Flaxenscale from the deck into play under your control", () => {
  const b = fusionBoard();
  const euBefore = [b.engine.getStat(b.id("eu"), "strength"), b.engine.getStat(b.id("eu"), "life")];
  const before = ready(b.engine);
  fuse(b);
  assert.equal(b.engine.state.pendingChoice, undefined, "the Charm left play as a cost, so its own search is not taxed");
  assert.equal(before - ready(b.engine), 4, "COST: pay 4");
  assert.equal(zoneOf(b.engine, b.id("gc")), "discard", "COST: destroy this card");
  assert.equal(zoneOf(b.engine, b.id("silu")), "play");
  assert.equal(b.engine.state.cards[b.id("silu")].controllerId, P1);
  assert.ok(!b.engine.state.cards[b.id("silu")].faceDown, "!b.engine.state.cards[b.id(\"silu\")].faceDown");
  assert.ok(!deckOf(b.engine, P1).includes(b.id("silu")), "!deckOf(b.engine, P1).includes(b.id(\"silu\"))");
  assert.equal(zoneOf(b.engine, b.id("eu")), "play", "the picked Eustace is not destroyed");
  assert.equal(b.engine.getStat(b.id("eu"), "strength") - euBefore[0], 3, "Siluriformes is really in play: Eustace gains 3 strength");
  assert.equal(b.engine.getStat(b.id("eu"), "life") - euBefore[1], 3, "and 3 life");
});

clause(CHARM, "2:ability:gc-fusion", "any UNIQUE EUSTACE can be picked: Eustace, Sensible Glutton works too", () => {
  const b = fusionBoard({ eustace: "none", extra: [{ key: "eu", def: printing(EUSTACE_GLUTTON), owner: P1, zone: "play" }] });
  fuse(b);
  assert.equal(zoneOf(b.engine, b.id("silu")), "play");
  assert.equal(zoneOf(b.engine, b.id("gc")), "discard");
});

clause(CHARM, "2:ability:gc-fusion", "failing the search is allowed (CR 312.2): the cost is still paid and the Charm still destroyed, nothing enters play", () => {
  const b = fusionBoard();
  const before = ready(b.engine);
  fuse(b, { e: [b.id("eu")] });
  assert.equal(before - ready(b.engine), 4);
  assert.equal(zoneOf(b.engine, b.id("gc")), "discard");
  assert.equal(zoneOf(b.engine, b.id("silu")), "deck", "Siluriformes was not taken");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(CHARM, "2:ability:gc-fusion", "the searched deck is shuffled afterwards (CR 312.1), whether or not the card was found", () => {
  const found = fusionBoard({ random: () => 0 });
  const startDeck = [...deckOf(found.engine, P1)];
  fuse(found);
  const rest = startDeck.filter((c) => c !== found.id("silu"));
  assert.deepEqual(sorted(deckOf(found.engine, P1)), sorted(rest), "same cards remain");
  assert.notDeepEqual(deckOf(found.engine, P1), rest, "but the order changed");
  const failed = fusionBoard({ random: () => 0 });
  const failStart = [...deckOf(failed.engine, P1)];
  fuse(failed, { e: [failed.id("eu")] });
  assert.deepEqual(sorted(deckOf(failed.engine, P1)), sorted(failStart));
  assert.deepEqual(deckOf(failed.engine, P1), shuffledWithConstant(failStart, 0), "a failed search shuffles too");
});

clause(CHARM, "2:ability:gc-fusion", "only a card NAMED Siluriformes Flaxenscale can be taken, and only from the deck: a differently named card, the discard pile or the hand are refused", () => {
  const b = fusionBoard({
    extra: [
      { key: "siluDiscard", def: printing(SILURIFORMES), owner: P1, zone: "discard" },
      { key: "siluHand", def: printing(SILURIFORMES), owner: P1, zone: "hand" }
    ]
  });
  refused(() => fuse(b, { e: [b.id("eu")], s: [b.id("d0")] }), "a differently named card in your deck");
  refused(() => fuse(b, { e: [b.id("eu")], s: [b.id("siluDiscard")] }), "Siluriformes in your discard pile");
  refused(() => fuse(b, { e: [b.id("eu")], s: [b.id("siluHand")] }), "Siluriformes in your hand");
  assert.equal(zoneOf(b.engine, b.id("gc")), "play", "the refused attempts spent and destroyed nothing");
  assert.equal(ready(b.engine), 4);
  fuse(b);
  assert.equal(zoneOf(b.engine, b.id("silu")), "play", "positive control");
});

clause(CHARM, "2:ability:gc-fusion", "it searches YOUR deck: Siluriformes in the opponent's deck cannot be taken", () => {
  const b = fusionBoard({ extra: [{ key: "oppSilu", def: printing(SILURIFORMES), owner: P2, zone: "deck" }] });
  refused(() => fuse(b, { e: [b.id("eu")], s: [b.id("oppSilu")] }), "Siluriformes in the OPPONENT's deck");
  assert.equal(zoneOf(b.engine, b.id("oppSilu")), "deck");
  assert.equal(zoneOf(b.engine, b.id("gc")), "play");
});

clause(CHARM, "2:ability:gc-fusion", "needs a UNIQUE EUSTACE you control: none, an opponent's, one in hand, or another UNIQUE are all refused", () => {
  const none = fusionBoard({ eustace: "none" });
  refused(() => fuse(none, { s: [none.id("silu")] }), "no Eustace at all");
  const theirs = fusionBoard({ eustace: "theirs" });
  refused(() => fuse(theirs, { e: [theirs.id("eu")], s: [theirs.id("silu")] }), "an Eustace the opponent controls");
  const inHand = fusionBoard({ eustace: "hand" });
  refused(() => fuse(inHand, { e: [inHand.id("eu")], s: [inHand.id("silu")] }), "an Eustace in hand");
  const otherUnique = fusionBoard({ eustace: "none", extra: [{ key: "eu", def: character({ name: "Not Eustace", unique: "somebody else" } as Partial<CardDefinition>), owner: P1, zone: "play" }] });
  refused(() => fuse(otherUnique), "a UNIQUE character that is not an EUSTACE");
  const plain = fusionBoard({ eustace: "none", extra: [{ key: "eu", def: character({ name: "Plain" }), owner: P1, zone: "play" }] });
  refused(() => fuse(plain), "a character with no UNIQUE designation");
  for (const b of [none, theirs, inHand, otherUnique, plain]) {
    assert.equal(zoneOf(b.engine, b.id("gc")), "play", "the Charm was not destroyed");
    assert.equal(zoneOf(b.engine, b.id("silu")), "deck");
    assert.equal(ready(b.engine), 4, "nothing was paid");
  }
  const ok = fusionBoard();
  fuse(ok);
  assert.equal(zoneOf(ok.engine, ok.id("silu")), "play", "positive control");
});

clause(CHARM, "2:ability:gc-fusion", "is refused one resource short of the 4 it costs, spending nothing and keeping the Charm", () => {
  const b = fusionBoard({ resources: 3 });
  refused(() => fuse(b), "3 resources for pay 4");
  assert.equal(ready(b.engine), 3);
  assert.equal(zoneOf(b.engine, b.id("gc")), "play");
  assert.equal(zoneOf(b.engine, b.id("silu")), "deck");
  const ok = fusionBoard({ resources: 5 });
  fuse(ok);
  assert.equal(ready(ok.engine), 1, "positive control: costs exactly 4 of 5");
});

// ==============================================================================
// Goldmau Sacks Representative — banker mau employee, cost 3, [G], 2 / 3 / 2.
//   RAISE CAPITAL -- COST: Pay 1. Discard a card. EFFECT: This turn, this card gains PROVIDES: [G][G][G].
//   INVEST: [G][G][G][G][G][G] -- COST: Pay 2. EFFECT: Search your deck for a resource and reveal it. Put it into your hand.
// ==============================================================================

const GSR = "94a47bcb-c174-47a9-a293-8183632b2fac";

function raiseBoard(o: { greed?: number; hand?: number; depleted?: boolean; eligible?: boolean; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "gsr", def: printing(GSR), owner: P1, zone: "play", depleted: o.depleted, attackEligible: o.eligible },
      ...bank("greed", o.greed ?? 6, P1),
      ...Array.from({ length: o.hand ?? 2 }, (_, i) => ({ key: `h${i}`, def: character({ name: `H${i}` }), owner: P1, zone: "hand" as const })),
      ...(o.extra ?? [])
    ]
  });
}

clause(GSR, "0:ability:gsr-raise", "pays 1, discards the chosen card from hand, and this card then provides 3 more [G] this turn", () => {
  const b = raiseBoard();
  const greedBefore = greedOf(b.engine);
  const before = ready(b.engine);
  activate(b.engine, P1, b.id("gsr"), "gsr-raise", { selected: { d: [b.id("h0")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(before - ready(b.engine), 1, "COST: pay 1");
  assert.equal(zoneOf(b.engine, b.id("h0")), "discard", "COST: the chosen card is discarded");
  assert.deepEqual(handOf(b.engine, P1), [b.id("h1")], "the other card stays in hand");
  assert.equal(greedOf(b.engine) - greedBefore, 3, "PROVIDES [G][G][G]");
});

clause(GSR, "0:ability:gsr-raise", "used twice in one turn, each use grants [G][G][G] again (literal reading): two uses mean two grants, +6 [G]", () => {
  const b = raiseBoard();
  const greedBefore = greedOf(b.engine);
  activate(b.engine, P1, b.id("gsr"), "gsr-raise", { selected: { d: [b.id("h0")] } });
  assert.equal(greedOf(b.engine) - greedBefore, 3, "first use: +3");
  activate(b.engine, P1, b.id("gsr"), "gsr-raise", { selected: { d: [b.id("h1")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("h1")), "discard", "the second use discarded its card too");
  assert.equal(greedOf(b.engine) - greedBefore, 6, "second use grants its own [G][G][G]");
});

clause(GSR, "0:ability:gsr-raise", "only this card gains the PROVIDES: a second Goldmau Sacks Representative does not", () => {
  const b = raiseBoard({ extra: [{ key: "gsr2", def: printing(GSR), owner: P1, zone: "play" }] });
  const greedBefore = greedOf(b.engine);
  activate(b.engine, P1, b.id("gsr"), "gsr-raise", { selected: { d: [b.id("h0")] } });
  assert.equal(greedOf(b.engine) - greedBefore, 3, "+3 once, not +6");
  assert.equal(greedOf(b.engine, P2), 0, "the opponent gains nothing");
});

clause(GSR, "0:ability:gsr-raise", "the PROVIDES lasts this turn only: it is gone when the turn ends", () => {
  const b = raiseBoard();
  const greedBefore = greedOf(b.engine);
  activate(b.engine, P1, b.id("gsr"), "gsr-raise", { selected: { d: [b.id("h0")] } });
  assert.equal(greedOf(b.engine) - greedBefore, 3, "still on later in the same turn");
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(greedOf(b.engine), greedBefore, "the turn ended: back to the printed amount");
});

clause(GSR, "0:ability:gsr-raise", "the three extra [G] really count: they unlock INVEST's [G][G][G][G][G][G] requirement", () => {
  const b = raiseBoard({ greed: 4, extra: [{ key: "res", def: stapleResource("Deck Rage", "rage"), owner: P1, zone: "deck" }] });
  refused(() => activate(b.engine, P1, b.id("gsr"), "gsr-invest", { selected: { r: [b.id("res")] } }), "only 4 [G] before RAISE CAPITAL");
  activate(b.engine, P1, b.id("gsr"), "gsr-raise", { selected: { d: [b.id("h0")] } });
  activate(b.engine, P1, b.id("gsr"), "gsr-invest", { selected: { r: [b.id("res")] } });
  assert.ok(handOf(b.engine, P1).includes(b.id("res")), "4 + 3 provided [G] meet the threshold");
});

clause(GSR, "0:ability:gsr-raise", "needs a card to discard: refused with an empty hand, and a card that is not in hand cannot be discarded", () => {
  const empty = raiseBoard({ hand: 0, extra: [{ key: "deckCard", def: character({ name: "Deck" }), owner: P1, zone: "deck" }] });
  refused(() => activate(empty.engine, P1, empty.id("gsr"), "gsr-raise", { selected: {} }), "no card in hand");
  refused(() => activate(empty.engine, P1, empty.id("gsr"), "gsr-raise", { selected: { d: [empty.id("deckCard")] } }), "a deck card as the discard");
  assert.equal(ready(empty.engine), 6, "nothing was paid");
  assert.equal(greedOf(empty.engine), 6);
  const ok = raiseBoard({ hand: 1 });
  activate(ok.engine, P1, ok.id("gsr"), "gsr-raise", { selected: { d: [ok.id("h0")] } });
  assert.equal(greedOf(ok.engine), 9, "positive control");
});

clause(GSR, "0:ability:gsr-raise", "needs 1 resource to pay: refused with none ready, and the hand is untouched", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "gsr", def: printing(GSR), owner: P1, zone: "play" },
      ...spentBank("greed", 3, P1),
      { key: "h0", def: character({ name: "H0" }), owner: P1, zone: "hand" }
    ]
  });
  assert.equal(ready(b.engine), 0);
  refused(() => activate(b.engine, P1, b.id("gsr"), "gsr-raise", { selected: { d: [b.id("h0")] } }), "no resource to pay 1");
  assert.equal(zoneOf(b.engine, b.id("h0")), "hand");
  const ok = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "gsr", def: printing(GSR), owner: P1, zone: "play" },
      ...bank("greed", 1, P1),
      { key: "h0", def: character({ name: "H0" }), owner: P1, zone: "hand" }
    ]
  });
  activate(ok.engine, P1, ok.id("gsr"), "gsr-raise", { selected: { d: [ok.id("h0")] } });
  assert.equal(zoneOf(ok.engine, ok.id("h0")), "discard", "positive control: one resource is enough");
});

clause(GSR, "0:ability:gsr-raise", "has no deplete cost: it works while the character is depleted or not yet attack-eligible", () => {
  const depleted = raiseBoard({ depleted: true });
  activate(depleted.engine, P1, depleted.id("gsr"), "gsr-raise", { selected: { d: [depleted.id("h0")] } });
  assert.equal(greedOf(depleted.engine), 9);
  const fresh = raiseBoard({ eligible: false });
  activate(fresh.engine, P1, fresh.id("gsr"), "gsr-raise", { selected: { d: [fresh.id("h0")] } });
  assert.equal(greedOf(fresh.engine), 9);
  assert.ok(!fresh.engine.state.cards[fresh.id("gsr")].depleted, "and it is not depleted by using it");
});

function investBoard(o: { greed?: number; obsession?: number; spentGreed?: number; random?: () => number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: o.random,
    cards: [
      { key: "gsr", def: printing(GSR), owner: P1, zone: "play" },
      ...bank("greed", o.greed ?? 6, P1),
      ...bank("obsession", o.obsession ?? 0, P1),
      ...spentBank("greed", o.spentGreed ?? 0, P1),
      { key: "c0", def: character({ name: "C0" }), owner: P1, zone: "deck" },
      { key: "rs", def: stapleResource("Deck Rage", "rage"), owner: P1, zone: "deck" },
      { key: "c1", def: character({ name: "C1" }), owner: P1, zone: "deck" },
      { key: "rn", def: stapleResource("Deck Special", "greed", false), owner: P1, zone: "deck" },
      { key: "c2", def: character({ name: "C2" }), owner: P1, zone: "deck" },
      { key: "rd", def: stapleResource("Discarded Rage", "rage"), owner: P1, zone: "discard" },
      { key: "rh", def: stapleResource("Hand Rage", "rage"), owner: P1, zone: "hand" },
      { key: "orx", def: stapleResource("Opp Rage", "rage"), owner: P2, zone: "deck" }
    ]
  });
}
const invest = (b: ReturnType<typeof investBoard>, selected: Record<string, string[]>) =>
  activate(b.engine, P1, b.id("gsr"), "gsr-invest", { selected });

clause(GSR, "1:ability:gsr-invest", "pays 2, takes the chosen resource out of the deck into your hand and reveals it to everyone", () => {
  const b = investBoard();
  const before = ready(b.engine);
  invest(b, { r: [b.id("rs")] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(before - ready(b.engine), 2, "COST: pay 2");
  assert.equal(zoneOf(b.engine, b.id("rs")), "hand");
  assert.equal(handOf(b.engine, P1).length, 2, "exactly one card was added to hand");
  assert.equal(deckOf(b.engine, P1).length, 4, "exactly one card left the deck");
  const reveals = b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed");
  assert.equal(reveals.length, 1, "revealed once");
  const ev = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual(ev.cardIds, [b.id("rs")]);
  assert.equal(ev.viewerId, "all", "to everyone");
});

clause(GSR, "1:ability:gsr-invest", "any resource can be found, not only staples", () => {
  const b = investBoard();
  invest(b, { r: [b.id("rn")] });
  assert.equal(zoneOf(b.engine, b.id("rn")), "hand");
  assert.equal(zoneOf(b.engine, b.id("rs")), "deck", "the other resource stays in the deck");
});

clause(GSR, "1:ability:gsr-invest", "only a resource: characters, resources in hand or discard are refused, and only one card may be taken", () => {
  const b = investBoard();
  refused(() => invest(b, { r: [b.id("c0")] }), "a character is not a resource");
  refused(() => invest(b, { r: [b.id("rd")] }), "a resource in the discard pile");
  refused(() => invest(b, { r: [b.id("rh")] }), "a resource already in hand");
  refused(() => invest(b, { r: [b.id("rs"), b.id("rn")] }), "two resources: it says 'a resource'");
  assert.equal(ready(b.engine), 6, "no refused attempt paid anything");
  assert.equal(zoneOf(b.engine, b.id("rs")), "deck");
});

clause(GSR, "1:ability:gsr-invest", "it searches YOUR deck: a resource in the opponent's deck cannot be taken", () => {
  const b = investBoard();
  refused(() => invest(b, { r: [b.id("orx")] }), "a resource in the opponent's deck");
  assert.equal(zoneOf(b.engine, b.id("orx")), "deck");
  assert.equal(ready(b.engine), 6);
});

clause(GSR, "1:ability:gsr-invest", "the search may be failed (CR 312.2): the 2 is paid, nothing enters hand, nothing is revealed", () => {
  const b = investBoard();
  const before = ready(b.engine);
  invest(b, {});
  assert.equal(before - ready(b.engine), 2);
  assert.equal(handOf(b.engine, P1).length, 1, "hand unchanged");
  assert.equal(deckOf(b.engine, P1).length, 5);
  assert.equal(b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed").length, 0);
});

clause(GSR, "1:ability:gsr-invest", "the deck is shuffled afterwards (CR 312.1), found or not", () => {
  const b = investBoard({ random: () => 0 });
  const start = [...deckOf(b.engine, P1)];
  invest(b, { r: [b.id("rs")] });
  const rest = start.filter((c) => c !== b.id("rs"));
  assert.deepEqual(sorted(deckOf(b.engine, P1)), sorted(rest));
  assert.notDeepEqual(deckOf(b.engine, P1), rest, "order changed");
  const failed = investBoard({ random: () => 0 });
  const failStart = [...deckOf(failed.engine, P1)];
  invest(failed, {});
  assert.deepEqual(deckOf(failed.engine, P1), shuffledWithConstant(failStart, 0), "a failed search shuffles too");
});

clause(GSR, "1:ability:gsr-invest", "needs [G][G][G][G][G][G]: five [G] with plenty of other resources is refused, six is accepted", () => {
  const five = investBoard({ greed: 5, obsession: 5 });
  refused(() => invest(five, { r: [five.id("rs")] }), "five [G]");
  assert.equal(zoneOf(five.engine, five.id("rs")), "deck");
  assert.equal(ready(five.engine), 10, "nothing was paid");
  const six = investBoard({ greed: 6 });
  invest(six, { r: [six.id("rs")] });
  assert.equal(zoneOf(six.engine, six.id("rs")), "hand");
});

clause(GSR, "1:ability:gsr-invest", "needs 2 resources ready to pay even with the threshold met: one ready is refused, two is accepted", () => {
  const one = investBoard({ greed: 1, spentGreed: 5 });
  assert.equal(ready(one.engine), 1);
  refused(() => invest(one, { r: [one.id("rs")] }), "pay 2 with one ready resource");
  assert.equal(zoneOf(one.engine, one.id("rs")), "deck");
  const two = investBoard({ greed: 2, spentGreed: 4 });
  invest(two, { r: [two.id("rs")] });
  assert.equal(zoneOf(two.engine, two.id("rs")), "hand", "positive control: same threshold, two ready");
  assert.equal(ready(two.engine), 0);
});

// ==============================================================================
// Hassan-i of Thabbash — banker assassin, cost 5, [G][G][G], 2 / 3 / 2.
//   If this card is destroyed, each opponent must destroy a character they control.
//   HARASH: [V][V][V] -- COST: Use this only if this card is in your discard pile and only during
//     your turn. Pay 1. Destroy a face-down resource you control.
//     EFFECT: Put this card into play under your control.
// ==============================================================================

const HASSAN = "337f6b9c-02ac-4c53-aaf2-e8301635cc03";

function hassanBoard(o: { extra?: CardPlacement[]; hassanOwner?: Pid } = {}) {
  const owner = o.hassanOwner ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "hi", def: printing(HASSAN), owner, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "p1a", def: character({ name: "P1a" }), owner: P1, zone: "play" },
      { key: "p1b", def: character({ name: "P1b" }), owner: P1, zone: "play" },
      { key: "p2a", def: character({ name: "P2a" }), owner: P2, zone: "play" },
      { key: "p2b", def: character({ name: "P2b" }), owner: P2, zone: "play" },
      { key: "p2item", def: item({ name: "P2 item" }), owner: P2, zone: "play" },
      ...(o.extra ?? [])
    ]
  });
}
const killIt = (b: ReturnType<typeof hassanBoard>, target: string) => play(b.engine, P1, b.id("kill"), { selected: { t: [b.id(target)] } });
const answerPick = (b: ReturnType<typeof hassanBoard>, pick: string[]) => answerPending(b.engine, "chooserSelectsTarget", { selected: pick.map((k) => b.id(k)) });

clause(HASSAN, "0:rule", "when destroyed, the opponent chooses and destroys one character they control; nothing else of theirs dies", () => {
  const b = hassanBoard();
  killIt(b, "hi");
  assert.equal(zoneOf(b.engine, b.id("hi")), "discard");
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P2, "the opponent makes the choice");
  answerPick(b, ["p2b"]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("p2b")), "discard", "the chosen character is destroyed");
  assert.equal(zoneOf(b.engine, b.id("p2a")), "play", "only one");
  assert.equal(zoneOf(b.engine, b.id("p2item")), "play", "items are not characters");
  assert.equal(zoneOf(b.engine, b.id("p1a")), "play", "my characters are safe");
  assert.equal(zoneOf(b.engine, b.id("p1b")), "play");
});

clause(HASSAN, "0:rule", "the destroyed character must be one the opponent controls: my characters, their items, nothing, or two are refused", () => {
  const b = hassanBoard();
  killIt(b, "hi");
  const choose = (pick: string[]) =>
    b.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: pick.map((k) => b.id(k)) } } as never);
  refused(() => choose(["p1a"]), "my character");
  refused(() => choose(["p2item"]), "their item");
  refused(() => choose([]), "'must destroy': declining is not allowed");
  refused(() => choose(["p2a", "p2b"]), "only one character");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting for a legal choice");
  choose(["p2a"]);
  assert.equal(zoneOf(b.engine, b.id("p2a")), "discard");
});

clause(HASSAN, "0:rule", "an opponent with no characters has nothing to destroy: no prompt, no effect on anything else", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "hi", def: printing(HASSAN), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "p1a", def: character({ name: "P1a" }), owner: P1, zone: "play" },
      { key: "p2item", def: item({ name: "P2 item" }), owner: P2, zone: "play" }
    ]
  });
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("hi")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("hi")), "discard");
  assert.equal(zoneOf(b.engine, b.id("p1a")), "play");
  assert.equal(zoneOf(b.engine, b.id("p2item")), "play");
});

clause(HASSAN, "0:rule", "it works from the other side too: when the opponent's Hassan-i is destroyed, I am the opponent who must destroy a character I control", () => {
  const b = hassanBoard({ hassanOwner: P2 });
  killIt(b, "hi");
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1, "the other player chooses this time");
  answerPick(b, ["p1b"]);
  assert.equal(zoneOf(b.engine, b.id("p1b")), "discard");
  assert.equal(zoneOf(b.engine, b.id("p1a")), "play");
  assert.equal(zoneOf(b.engine, b.id("p2a")), "play", "their characters are safe");
  assert.equal(zoneOf(b.engine, b.id("p2b")), "play");
});

clause(HASSAN, "0:rule", "only its own destruction counts: another character dying, or Hassan-i leaving play without being destroyed, does nothing", () => {
  const other = hassanBoard();
  killIt(other, "p1a");
  assert.equal(other.engine.state.pendingChoice, undefined, "another character was destroyed");
  assert.equal(zoneOf(other.engine, other.id("p2a")), "play");
  assert.equal(zoneOf(other.engine, other.id("p2b")), "play");
  const bounced = hassanBoard({ extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }] });
  play(bounced.engine, P1, bounced.id("bounce"), { selected: { t: [bounced.id("hi")] } });
  assert.equal(zoneOf(bounced.engine, bounced.id("hi")), "hand", "Hassan-i went back to hand");
  assert.equal(bounced.engine.state.pendingChoice, undefined, "it was not destroyed");
  assert.equal(zoneOf(bounced.engine, bounced.id("p2a")), "play");
});

clause(HASSAN, "0:rule", "dying in combat counts as destroyed: after the battle the opponent destroys a character they control", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "hi", def: printing(HASSAN), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 5, life: 5, speed: 1 }), owner: P2, zone: "play" },
      { key: "p2a", def: character({ name: "P2a" }), owner: P2, zone: "play" }
    ]
  });
  let asked = 0;
  fightThrough(b.engine, P2, [b.id("atk")], { type: "faction", playerId: P1 }, [b.id("hi")], undefined, (pc) => {
    if (pc.kind === "chooserSelectsTarget") {
      asked++;
      assert.equal(pc.playerId, P2);
      return { kind: "chooserSelectsTarget", selected: [b.id("p2a")] };
    }
    return declineAll(pc);
  });
  assert.equal(zoneOf(b.engine, b.id("hi")), "discard", "Hassan-i took 5 damage and died");
  assert.equal(asked, 1);
  assert.equal(zoneOf(b.engine, b.id("p2a")), "discard", "the opponent chose p2a to destroy");
  assert.equal(zoneOf(b.engine, b.id("atk")), "play");
});

function harashBoard(o: { vol?: number; greed?: number; zone?: "discard" | "hand" | "play" | "deck"; turn?: number; active?: Pid; extra?: CardPlacement[]; spentVol?: boolean } = {}) {
  const vol = volition(o.vol ?? 3, P1).map((p) => (o.spentVol ? { ...p, attachedToKey: "__factionA" } : p));
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn,
    activePlayerId: o.active,
    cards: [{ key: "hi", def: printing(HASSAN), owner: P1, zone: o.zone ?? "discard" }, ...vol, ...bank("greed", o.greed ?? 2, P1), ...(o.extra ?? [])]
  });
}
const harash = (b: ReturnType<typeof harashBoard>, target?: CardInstanceId) =>
  activate(b.engine, P1, b.id("hi"), "hassan-i-harash", { selected: { fdr: [target ?? faceDownOf(b.engine, P1)[0]] } });

clause(HASSAN, "1:ability:hassan-i-harash", "from the discard pile on your turn: pays 1, destroys the chosen face-down resource, and Hassan-i enters play under your control", () => {
  const b = harashBoard();
  const fd = faceDownOf(b.engine, P1);
  assert.equal(fd.length, 3);
  const before = ready(b.engine);
  harash(b, fd[1]);
  assert.equal(b.engine.state.pendingChoice, undefined, "Hassan-i entering play is not a destruction");
  assert.equal(zoneOf(b.engine, b.id("hi")), "play");
  assert.equal(b.engine.state.cards[b.id("hi")].controllerId, P1);
  assert.equal(zoneOf(b.engine, fd[1]), "discard", "COST: the picked face-down resource is destroyed");
  assert.equal(zoneOf(b.engine, fd[0]), "play", "other face-down resources stay");
  assert.equal(zoneOf(b.engine, fd[2]), "play");
  assert.equal(before - ready(b.engine), 2, "COST: pay 1, and the destroyed resource is gone too");
  assert.deepEqual(stats(b.engine, b.id("hi")), [2, 2, 3]);
  assert.ok(!discardOf(b.engine, P1).includes(b.id("hi")), "!discardOf(b.engine, P1).includes(b.id(\"hi\"))");
});

clause(HASSAN, "1:ability:hassan-i-harash", "only from the discard pile: refused while Hassan-i is in hand, in the deck, or already in play", () => {
  const ok = harashBoard();
  harash(ok);
  assert.equal(zoneOf(ok.engine, ok.id("hi")), "play", "positive control");
  for (const zone of ["hand", "deck", "play"] as const) {
    const b = harashBoard({ zone });
    refused(() => harash(b), `Hassan-i in ${zone}`, /must be in zone 'discard'/);
    assert.equal(zoneOf(b.engine, b.id("hi")), zone);
    assert.equal(faceDownOf(b.engine, P1).length, 3, "nothing was destroyed");
    assert.equal(ready(b.engine), 5, "nothing was paid");
  }
});

clause(HASSAN, "1:ability:hassan-i-harash", "only during your turn: refused when I respond during the opponent's turn", () => {
  const mk = (turn: number, active: Pid) =>
    harashBoard({
      turn,
      active,
      extra: [
        { key: "oppKill", def: killTactic(), owner: P2, zone: "hand" },
        { key: "oppChar", def: character({ name: "OppChar" }), owner: P2, zone: "play" },
        { key: "ping", def: item({ name: "Ping", behavior: { abilities: [{ id: "ping", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } } as Partial<CardDefinition>), owner: P1, zone: "play" },
        { key: "top", def: character({ name: "Top" }), owner: P1, zone: "deck" }
      ]
    });
  const b = mk(2, P2);
  playRaw(b.engine, P2, b.id("oppKill"), { selected: { t: [b.id("oppChar")] } });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "I may respond");
  refused(
    () =>
      b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("hi"), abilityId: "hassan-i-harash", selected: { fdr: [faceDownOf(b.engine, P1)[0]] }, variables: {} } as never),
    "Harash during the opponent's turn",
    /condition is not satisfied/
  );
  // the window itself allows my abilities: a free ability of mine is accepted at the same moment
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("ping"), abilityId: "ping", selected: {}, variables: {} } as never);
  assert.equal(zoneOf(b.engine, b.id("hi")), "discard");
  assert.equal(faceDownOf(b.engine, P1).length, 3);
  const own = mk(1, P1);
  harash(own);
  assert.equal(zoneOf(own.engine, own.id("hi")), "play", "positive control: my own turn");
});

clause(HASSAN, "1:ability:hassan-i-harash", "my opponent cannot use my discarded Hassan-i, even with their own [V][V][V]", () => {
  const b = harashBoard({
    turn: 2,
    active: P2,
    extra: [...volition(3, P2), ...bank("greed", 2, P2)]
  });
  const theirs = faceDownOf(b.engine, P2);
  assert.equal(theirs.length, 3);
  refused(
    () => b.engine.perform({ type: "activateAbility", playerId: P2, cardId: b.id("hi"), abilityId: "hassan-i-harash", selected: { fdr: [theirs[0]] }, variables: {} } as never),
    "the opponent using it from my discard pile",
    /do not control/
  );
  assert.equal(zoneOf(b.engine, b.id("hi")), "discard");
  assert.equal(zoneOf(b.engine, theirs[0]), "play");
});

clause(HASSAN, "1:ability:hassan-i-harash", "needs [V][V][V]: two face-down resources and plenty of other resources are refused, three are accepted", () => {
  const two = harashBoard({ vol: 2, greed: 6 });
  refused(() => harash(two), "only [V][V]");
  assert.equal(zoneOf(two.engine, two.id("hi")), "discard");
  assert.equal(ready(two.engine), 8, "nothing was paid");
  const three = harashBoard({ vol: 3, greed: 0 });
  harash(three);
  assert.equal(zoneOf(three.engine, three.id("hi")), "play", "three face-down resources provide [V][V][V]");
});

clause(HASSAN, "1:ability:hassan-i-harash", "the destroyed resource must be a face-down resource YOU control: face-up, the opponent's, or none are refused", () => {
  const b = harashBoard({ extra: [...volition(1, P2)] });
  const faceUp = b.engine.state.players[P1].play.find((c) => !b.engine.state.cards[c].faceDown && b.engine.isResource(c))!;
  const theirs = faceDownOf(b.engine, P2)[0];
  refused(() => harash(b, faceUp), "my own face-up resource");
  refused(() => harash(b, theirs), "the opponent's face-down resource");
  refused(() => activate(b.engine, P1, b.id("hi"), "hassan-i-harash", { selected: {} }), "no resource picked");
  assert.equal(zoneOf(b.engine, b.id("hi")), "discard");
  assert.equal(ready(b.engine), 5, "nothing was paid");
  assert.equal(zoneOf(b.engine, faceUp), "play");
  assert.equal(zoneOf(b.engine, theirs), "play");
  harash(b);
  assert.equal(zoneOf(b.engine, b.id("hi")), "play", "positive control");
});

clause(HASSAN, "1:ability:hassan-i-harash", "needs 1 ready resource to pay: with [V][V][V] met but nothing left to spend it is refused", () => {
  const none = harashBoard({ spentVol: true, greed: 0 });
  assert.equal(ready(none.engine), 0);
  refused(() => harash(none), "pay 1 with no ready resource");
  assert.equal(zoneOf(none.engine, none.id("hi")), "discard");
  assert.equal(faceDownOf(none.engine, P1).length, 3, "the face-down resources were not destroyed");
  const one = harashBoard({ spentVol: true, greed: 1 });
  harash(one);
  assert.equal(zoneOf(one.engine, one.id("hi")), "play", "positive control: one ready resource is enough");
  assert.equal(ready(one.engine), 0);
});

// ==============================================================================
// Homewrecker — banker mau assassin, cost 2, [G], 3 / 3 / 3.
//   COST: Inflict 2 damage to a location you own or pay 3.
//   Locations you control gain 1 structure.
//   PROSTRATE -- COST: Deplete a location you control. Pick a character. EFFECT: Deplete that card.
// ==============================================================================

const WRECKER = "be86071b-9c40-443e-8675-79ac4f8657e6";

function wreckerBoard(o: { greed?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "hw", def: printing(WRECKER), owner: P1, zone: "hand" }, ...bank("greed", o.greed ?? 5, P1), ...(o.extra ?? [])]
  });
}
const myLoc = (): CardPlacement => ({ key: "loc", def: location({ name: "My Loc", structure: 4 }), owner: P1, zone: "play" });

clause(WRECKER, "0:ability", "the damage option: 2 damage to a location you own, and no extra resources are paid", () => {
  const b = wreckerBoard({ extra: [myLoc()] });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("hw"), { selected: { loc: [b.id("loc")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("hw")), "play");
  assert.equal(b.engine.state.cards[b.id("loc")].damage ?? 0, 2, "exactly 2 damage");
  assert.equal(before - ready(b.engine), 2, "only the printed cost of 2");
  assert.equal(zoneOf(b.engine, b.id("loc")), "play", "it survives (structure 4)");
});

clause(WRECKER, ["0:ability", "1:rule"], "the 2 damage is a cost paid BEFORE Homewrecker is in play, so its +1 structure does not shield the location: a structure-2 location is destroyed (state-based check is immediate)", () => {
  const low = wreckerBoard({ extra: [{ key: "loc", def: location({ name: "Low Loc", structure: 2 }), owner: P1, zone: "play" }] });
  play(low.engine, P1, low.id("hw"), { selected: { loc: [low.id("loc")] } });
  assert.equal(low.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(low.engine, low.id("hw")), "play", "Homewrecker is deployed (its cost was paid)");
  assert.equal(zoneOf(low.engine, low.id("loc")), "discard", "2 damage on a structure-2 location destroys it; the aura was not on yet");
});

clause(WRECKER, ["0:ability", "1:rule"], "a structure-3 location survives the 2 damage cost and then reads structure 4; a structure-2 location shielded by an earlier Homewrecker survives too", () => {
  const mid = wreckerBoard({ extra: [{ key: "loc", def: location({ name: "Mid Loc", structure: 3 }), owner: P1, zone: "play" }] });
  play(mid.engine, P1, mid.id("hw"), { selected: { loc: [mid.id("loc")] } });
  assert.equal(zoneOf(mid.engine, mid.id("loc")), "play", "structure 3 survives 2 damage");
  assert.equal(mid.engine.state.cards[mid.id("loc")].damage ?? 0, 2);
  assert.equal(mid.engine.getStat(mid.id("loc"), "structure"), 4, "Homewrecker is in play now: +1 structure");
  // with a Homewrecker already in play, a structure-2 location reads 3 and survives the second Homewrecker's cost
  const shielded = wreckerBoard({
    extra: [
      { key: "hw0", def: printing(WRECKER), owner: P1, zone: "play" },
      { key: "loc", def: location({ name: "Low Loc", structure: 2 }), owner: P1, zone: "play" }
    ]
  });
  play(shielded.engine, P1, shielded.id("hw"), { selected: { loc: [shielded.id("loc")] } });
  assert.equal(zoneOf(shielded.engine, shielded.id("loc")), "play", "the first Homewrecker's aura (+1) makes structure 3, so 2 damage does not destroy it");
});

clause(WRECKER, "0:ability", "the pay option: pay 3 more instead, and the location takes no damage", () => {
  const b = wreckerBoard({ extra: [myLoc()] });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("hw"));
  assert.equal(zoneOf(b.engine, b.id("hw")), "play");
  assert.equal(before - ready(b.engine), 5, "cost 2 plus pay 3");
  assert.equal(b.engine.state.cards[b.id("loc")].damage ?? 0, 0, "you pay OR damage, not both");
  const noLoc = wreckerBoard();
  play(noLoc.engine, P1, noLoc.id("hw"));
  assert.equal(zoneOf(noLoc.engine, noLoc.id("hw")), "play", "with no location at all you can still pay 3");
  assert.equal(ready(noLoc.engine), 0);
});

clause(WRECKER, "0:ability", "with no location to damage and only the printed 2, or 4 resources, it cannot be deployed", () => {
  const two = wreckerBoard({ greed: 2 });
  refused(() => playRaw(two.engine, P1, two.id("hw")), "no location and nothing to pay 3 with");
  assert.equal(zoneOf(two.engine, two.id("hw")), "hand");
  const four = wreckerBoard({ greed: 4 });
  refused(() => playRaw(four.engine, P1, four.id("hw")), "cost 2 + pay 3 needs 5");
  assert.equal(ready(four.engine), 4, "nothing was spent");
  const damage = wreckerBoard({ greed: 2, extra: [myLoc()] });
  play(damage.engine, P1, damage.id("hw"), { selected: { loc: [damage.id("loc")] } });
  assert.equal(zoneOf(damage.engine, damage.id("hw")), "play", "positive control: a location makes 2 resources enough");
});

clause(WRECKER, "0:ability", "the location must be one you OWN: an opponent's location can't be damaged, but one I own and they control can", () => {
  const theirs = wreckerBoard({ greed: 2, extra: [{ key: "oppLoc", def: location({ name: "Opp Loc", structure: 4 }), owner: P2, zone: "play" }] });
  refused(() => playRaw(theirs.engine, P1, theirs.id("hw"), { selected: { loc: [theirs.id("oppLoc")] } }), "an opponent's location");
  assert.equal(zoneOf(theirs.engine, theirs.id("hw")), "hand");
  assert.equal(theirs.engine.state.cards[theirs.id("oppLoc")].damage ?? 0, 0);
  const stolen = wreckerBoard({ greed: 2, extra: [{ key: "loc", def: location({ name: "Stolen", structure: 4 }), owner: P1, controller: P2, zone: "play" }] });
  play(stolen.engine, P1, stolen.id("hw"), { selected: { loc: [stolen.id("loc")] } });
  assert.equal(stolen.engine.state.cards[stolen.id("loc")].damage ?? 0, 2, "'you own': ownership counts, not control");
  const borrowed = wreckerBoard({ greed: 2, extra: [{ key: "loc", def: location({ name: "Borrowed", structure: 4 }), owner: P2, controller: P1, zone: "play" }] });
  refused(() => playRaw(borrowed.engine, P1, borrowed.id("hw"), { selected: { loc: [borrowed.id("loc")] } }), "a location I control but do not own");
  assert.equal(borrowed.engine.state.cards[borrowed.id("loc")].damage ?? 0, 0);
});

clause(WRECKER, "0:ability", "the location picked must be a location in play: a character, an item or a card in hand is refused", () => {
  const b = wreckerBoard({
    greed: 2,
    extra: [
      { key: "ch", def: character({ name: "Ch" }), owner: P1, zone: "play" },
      { key: "it", def: item({ name: "It" }), owner: P1, zone: "play" },
      { key: "handLoc", def: location({ name: "Hand Loc" }), owner: P1, zone: "hand" }
    ]
  });
  for (const key of ["ch", "it", "handLoc"]) refused(() => playRaw(b.engine, P1, b.id("hw"), { selected: { loc: [b.id(key)] } }), `${key} is not a location in play`);
  assert.equal(zoneOf(b.engine, b.id("hw")), "hand");
  assert.equal(ready(b.engine), 2);
});

const wreckerInPlay = (extra: CardPlacement[] = []) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "hw", def: printing(WRECKER), owner: P1, zone: "play" }, ...extra]
  });

clause(WRECKER, "1:rule", "locations you control gain 1 structure; locations the opponent controls do not", () => {
  const { engine, id } = wreckerInPlay([
    { key: "a", def: location({ name: "A", structure: 3 }), owner: P1, zone: "play" },
    { key: "b", def: location({ name: "B", structure: 5 }), owner: P1, zone: "play" },
    { key: "theirs", def: location({ name: "Theirs", structure: 3 }), owner: P2, zone: "play" }
  ]);
  assert.equal(engine.getStat(id("a"), "structure"), 4);
  assert.equal(engine.getStat(id("b"), "structure"), 6);
  assert.equal(engine.getStat(id("theirs"), "structure"), 3, "not mine");
});

clause(WRECKER, "1:rule", "'control' decides: a location I own but they control gets nothing, one I control but they own gets +1", () => {
  const { engine, id } = wreckerInPlay([
    { key: "mineTheirControl", def: location({ name: "MTC", structure: 3 }), owner: P1, controller: P2, zone: "play" },
    { key: "theirsMyControl", def: location({ name: "TMC", structure: 3 }), owner: P2, controller: P1, zone: "play" }
  ]);
  assert.equal(engine.getStat(id("mineTheirControl"), "structure"), 3);
  assert.equal(engine.getStat(id("theirsMyControl"), "structure"), 4);
});

clause(WRECKER, "1:rule", "it only adds structure: characters keep their life, and locations in hand or discard keep their printed structure", () => {
  const { engine, id } = wreckerInPlay([
    { key: "ch", def: character({ name: "Ch", life: 3 }), owner: P1, zone: "play" },
    { key: "handLoc", def: location({ name: "H", structure: 3 }), owner: P1, zone: "hand" },
    { key: "discLoc", def: location({ name: "D", structure: 3 }), owner: P1, zone: "discard" }
  ]);
  assert.equal(engine.getStat(id("ch"), "life"), 3);
  assert.equal(engine.getStat(id("handLoc"), "structure"), 3);
  assert.equal(engine.getStat(id("discLoc"), "structure"), 3);
});

clause(WRECKER, "1:rule", "two Homewreckers stack (+2), and the bonus applies to a location that arrives later", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "hw", def: printing(WRECKER), owner: P1, zone: "play" },
      { key: "hw2", def: printing(WRECKER), owner: P1, zone: "play" },
      { key: "later", def: location({ name: "Later", structure: 3, cost: 0 }), owner: P1, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("later"));
  assert.equal(zoneOf(b.engine, b.id("later")), "play");
  assert.equal(b.engine.getStat(b.id("later"), "structure"), 5);
});

clause(WRECKER, "1:rule", "the bonus is on only while Homewrecker is in play: gone after it is destroyed, and not restored", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "hw", def: printing(WRECKER), owner: P1, zone: "play" },
      { key: "loc", def: location({ name: "Loc", structure: 3 }), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
    ]
  });
  assert.equal(b.engine.getStat(b.id("loc"), "structure"), 4);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("hw")] } });
  assert.equal(zoneOf(b.engine, b.id("hw")), "discard");
  assert.equal(b.engine.getStat(b.id("loc"), "structure"), 3, "off after it leaves play");
  assert.equal(b.engine.getStat(b.id("loc"), "structure"), 3, "and still off");
});

const prostrateBoard = (extra: CardPlacement[] = []) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "hw", def: printing(WRECKER), owner: P1, zone: "play" },
      { key: "locA", def: location({ name: "LocA" }), owner: P1, zone: "play" },
      { key: "locB", def: location({ name: "LocB" }), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "foeLoc", def: location({ name: "FoeLoc" }), owner: P2, zone: "play" },
      { key: "foeItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      ...extra
    ]
  });
const prostrate = (b: ReturnType<typeof prostrateBoard>, loc: string, target: string) =>
  activate(b.engine, P1, b.id("hw"), "homewrecker-prostrate", { selected: { myLoc: [b.id(loc)], ch: [b.id(target)] } });

clause(WRECKER, "2:ability:homewrecker-prostrate", "depletes a location you control as the cost, then depletes the picked character", () => {
  const b = prostrateBoard();
  prostrate(b, "locA", "foe");
  assert.equal(b.engine.state.cards[b.id("locA")].depleted, true, "COST: the location is depleted");
  assert.equal(b.engine.state.cards[b.id("foe")].depleted, true, "EFFECT: the picked character is depleted");
  assert.ok(!b.engine.state.cards[b.id("locB")].depleted, "the other location is not");
  assert.ok(!b.engine.state.cards[b.id("ally")].depleted, "nor are other characters");
  assert.ok(!b.engine.state.cards[b.id("hw")].depleted, "Homewrecker itself is not depleted");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(WRECKER, "2:ability:homewrecker-prostrate", "any character can be picked: my own, or Homewrecker itself", () => {
  const mine = prostrateBoard();
  prostrate(mine, "locA", "ally");
  assert.equal(mine.engine.state.cards[mine.id("ally")].depleted, true);
  assert.ok(!mine.engine.state.cards[mine.id("foe")].depleted, "!mine.engine.state.cards[mine.id(\"foe\")].depleted");
  const self = prostrateBoard();
  prostrate(self, "locA", "hw");
  assert.equal(self.engine.state.cards[self.id("hw")].depleted, true);
});

clause(WRECKER, "2:ability:homewrecker-prostrate", "the cost needs a ready location I control: an opponent's, a depleted one, or none are refused", () => {
  const theirs = prostrateBoard();
  refused(() => prostrate(theirs, "foeLoc", "foe"), "an opponent's location as the cost");
  assert.ok(!theirs.engine.state.cards[theirs.id("foe")].depleted, "!theirs.engine.state.cards[theirs.id(\"foe\")].depleted");
  const spent = prostrateBoard();
  spent.engine.state.cards[spent.id("locA")].depleted = true;
  spent.engine.state.cards[spent.id("locB")].depleted = true;
  refused(() => prostrate(spent, "locA", "foe"), "an already depleted location");
  assert.ok(!spent.engine.state.cards[spent.id("foe")].depleted, "!spent.engine.state.cards[spent.id(\"foe\")].depleted");
  const none = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "hw", def: printing(WRECKER), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }
    ]
  });
  refused(() => activate(none.engine, P1, none.id("hw"), "homewrecker-prostrate", { selected: { ch: [none.id("foe")] } }), "no location at all");
  assert.ok(!none.engine.state.cards[none.id("foe")].depleted, "!none.engine.state.cards[none.id(\"foe\")].depleted");
  const ok = prostrateBoard();
  prostrate(ok, "locB", "foe");
  assert.equal(ok.engine.state.cards[ok.id("foe")].depleted, true, "positive control");
});

clause(WRECKER, "2:ability:homewrecker-prostrate", "the pick must be a character in play: a location, an item, or a character in hand or discard is refused", () => {
  const b = prostrateBoard([
    { key: "handChar", def: character({ name: "HandChar" }), owner: P2, zone: "hand" },
    { key: "discChar", def: character({ name: "DiscChar" }), owner: P1, zone: "discard" }
  ]);
  refused(() => prostrate(b, "locA", "foeLoc"), "a location is not a character");
  refused(() => prostrate(b, "locA", "foeItem"), "an item is not a character");
  refused(() => prostrate(b, "locA", "handChar"), "a character in hand");
  refused(() => prostrate(b, "locA", "discChar"), "a character in the discard pile");
  assert.ok(!b.engine.state.cards[b.id("locA")].depleted, "the cost was not paid");
  assert.ok(!b.engine.state.cards[b.id("foeLoc")].depleted, "!b.engine.state.cards[b.id(\"foeLoc\")].depleted");
});

clause(WRECKER, "2:ability:homewrecker-prostrate", "Homewrecker itself is not depleted by it, so it works while depleted or not yet attack-eligible, and can be used again with another location", () => {
  const b = prostrateBoard();
  b.engine.state.cards[b.id("hw")].depleted = true;
  prostrate(b, "locA", "foe");
  assert.equal(b.engine.state.cards[b.id("foe")].depleted, true);
  b.engine.state.cards[b.id("foe")].depleted = false;
  prostrate(b, "locB", "foe");
  assert.equal(b.engine.state.cards[b.id("locB")].depleted, true);
  assert.equal(b.engine.state.cards[b.id("foe")].depleted, true, "a second use with the second location");
});

// ==============================================================================
// Impressionistic Furball — banker gear item, cost 1, [G][G].
//   ATTACH TO CHARACTER
//   Attached character gains 2 life.
//   COUGH UP: [G][G][G] -- COST: Destroy this card. EFFECT: Draw a card.
// ==============================================================================

const FURBALL = "24e987c9-c089-4ba4-a616-ff2b2fb4592a";

function furballBoard(o: { greed?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "fb", def: printing(FURBALL), owner: P1, zone: "hand" },
      { key: "host", def: character({ name: "Host", life: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 3 }), owner: P2, zone: "play" },
      ...bank("greed", o.greed ?? 3, P1),
      ...(o.extra ?? [])
    ]
  });
}
const attachedFurball = (extra: CardPlacement[] = [], opts: { greed?: number; hostKey?: "host" | "foe" } = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "host", def: character({ name: "Host", life: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 3 }), owner: P2, zone: "play" },
      { key: "fb", def: printing(FURBALL), owner: P1, zone: "play", attachedToKey: opts.hostKey ?? "host" },
      ...bank("greed", opts.greed ?? 3, P1),
      ...extra
    ]
  });

clause(FURBALL, "0:attach", "is played by picking a character as its host and enters play attached to it", () => {
  const b = furballBoard();
  const before = ready(b.engine);
  play(b.engine, P1, b.id("fb"), { selected: { attachTo: [b.id("host")] } });
  assert.equal(zoneOf(b.engine, b.id("fb")), "play");
  assert.equal(b.engine.state.cards[b.id("fb")].attachedTo, b.id("host"));
  assert.equal(before - ready(b.engine), 1, "its cost of 1");
  assert.equal(b.engine.getStat(b.id("host"), "life"), 5);
});

clause(FURBALL, "0:attach", "any character is a legal host, including one the opponent controls", () => {
  const b = furballBoard();
  play(b.engine, P1, b.id("fb"), { selected: { attachTo: [b.id("foe")] } });
  assert.equal(b.engine.state.cards[b.id("fb")].attachedTo, b.id("foe"));
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 5, "the opponent's character gets the life");
  assert.equal(b.engine.getStat(b.id("host"), "life"), 3);
});

clause(FURBALL, "0:attach", "cannot be attached to an item, a location, a card in hand, or with no host at all", () => {
  const b = furballBoard({
    extra: [
      { key: "it", def: item({ name: "It" }), owner: P1, zone: "play" },
      { key: "loc", def: location({ name: "Loc" }), owner: P1, zone: "play" },
      { key: "handChar", def: character({ name: "HandChar" }), owner: P1, zone: "hand" }
    ]
  });
  for (const key of ["it", "loc", "handChar"]) refused(() => playRaw(b.engine, P1, b.id("fb"), { selected: { attachTo: [b.id(key)] } }), `host ${key}`);
  refused(() => playRaw(b.engine, P1, b.id("fb")), "no host picked");
  assert.equal(zoneOf(b.engine, b.id("fb")), "hand");
  assert.equal(ready(b.engine), 3, "nothing was spent");
  const noChars = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "fb", def: printing(FURBALL), owner: P1, zone: "hand" }, ...bank("greed", 3, P1)]
  });
  refused(() => playRaw(noChars.engine, P1, noChars.id("fb")), "no character in play to attach to");
});

clause(FURBALL, "0:attach", "costs 1 and needs [G][G]: refused with no ready resource or with only one [G]", () => {
  const spent = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "fb", def: printing(FURBALL), owner: P1, zone: "hand" },
      { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
      ...spentBank("greed", 2, P1)
    ]
  });
  refused(() => playRaw(spent.engine, P1, spent.id("fb"), { selected: { attachTo: [spent.id("host")] } }), "cost 1 with none ready");
  const oneG = furballBoard({ greed: 1, extra: bank("obsession", 4, P1) });
  refused(() => playRaw(oneG.engine, P1, oneG.id("fb"), { selected: { attachTo: [oneG.id("host")] } }), "threshold [G][G] with one [G]");
  assert.equal(zoneOf(oneG.engine, oneG.id("fb")), "hand");
  const ok = furballBoard({ greed: 2 });
  play(ok.engine, P1, ok.id("fb"), { selected: { attachTo: [ok.id("host")] } });
  assert.equal(zoneOf(ok.engine, ok.id("fb")), "play", "positive control");
});

clause(FURBALL, "1:rule", "the attached character gains exactly 2 life; no other character does, and nothing else changes", () => {
  const b = attachedFurball();
  assert.equal(b.engine.getStat(b.id("host"), "life"), 5);
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 3, "an unattached character is unaffected");
  assert.equal(b.engine.getStat(b.id("host"), "strength"), 1, "strength unchanged");
  assert.equal(b.engine.getStat(b.id("host"), "speed"), 1, "speed unchanged");
});

clause(FURBALL, "1:rule", "attached to an opponent's character, it is THAT character that gains the life", () => {
  const b = attachedFurball([], { hostKey: "foe" });
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 5);
  assert.equal(b.engine.getStat(b.id("host"), "life"), 3);
});

clause(FURBALL, "1:rule", "two Furballs on one character stack to +4 life", () => {
  const b = attachedFurball([{ key: "fb2", def: printing(FURBALL), owner: P1, zone: "play", attachedToKey: "host" }]);
  assert.equal(b.engine.getStat(b.id("host"), "life"), 7);
});

clause(FURBALL, "1:rule", "the life is gone once the Furball leaves play, and stays gone", () => {
  const b = attachedFurball([], { greed: 3 });
  assert.equal(b.engine.getStat(b.id("host"), "life"), 5);
  activate(b.engine, P1, b.id("fb"), "impressionistic-furball-cough-up");
  assert.equal(zoneOf(b.engine, b.id("fb")), "discard");
  assert.equal(b.engine.getStat(b.id("host"), "life"), 3, "off after the Furball left");
  assert.equal(b.engine.getStat(b.id("host"), "life"), 3, "and still off");
});

clause(FURBALL, "1:rule", "when the host leaves play the Furball goes with it and the bonus is not left on another character", () => {
  const b = attachedFurball([{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }, { key: "other", def: character({ name: "Other", life: 3 }), owner: P1, zone: "play" }]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("host")] } });
  assert.equal(zoneOf(b.engine, b.id("host")), "discard");
  assert.equal(zoneOf(b.engine, b.id("fb")), "discard", "an attachment cannot stay without its host");
  assert.equal(b.engine.getStat(b.id("other"), "life"), 3);
});

clause(FURBALL, "2:ability:impressionistic-furball-cough-up", "destroys the Furball and draws exactly one card", () => {
  const b = attachedFurball([
    { key: "top", def: character({ name: "Top" }), owner: P1, zone: "deck" },
    { key: "next", def: character({ name: "Next" }), owner: P1, zone: "deck" }
  ]);
  activate(b.engine, P1, b.id("fb"), "impressionistic-furball-cough-up");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("fb")), "discard", "COST: destroyed");
  assert.deepEqual(handOf(b.engine, P1), [b.id("top")], "drew exactly the top card");
  assert.deepEqual(deckOf(b.engine, P1), [b.id("next")]);
  assert.equal(handOf(b.engine, P2).length, 0);
});

clause(FURBALL, "2:ability:impressionistic-furball-cough-up", "when attached to the opponent's character, its controller (not the host's owner) draws", () => {
  const b = attachedFurball(
    [
      { key: "top", def: character({ name: "Top" }), owner: P1, zone: "deck" },
      { key: "theirTop", def: character({ name: "TheirTop" }), owner: P2, zone: "deck" }
    ],
    { hostKey: "foe" }
  );
  activate(b.engine, P1, b.id("fb"), "impressionistic-furball-cough-up");
  assert.deepEqual(handOf(b.engine, P1), [b.id("top")]);
  assert.equal(handOf(b.engine, P2).length, 0, "the host's owner draws nothing");
  assert.equal(zoneOf(b.engine, b.id("fb")), "discard");
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 3);
});

clause(FURBALL, "2:ability:impressionistic-furball-cough-up", "needs [G][G][G]: two [G] with other resources is refused, three is enough; and it costs no resources", () => {
  const two = attachedFurball([...bank("obsession", 5, P1), { key: "top", def: character({ name: "Top" }), owner: P1, zone: "deck" }], { greed: 2 });
  refused(() => activate(two.engine, P1, two.id("fb"), "impressionistic-furball-cough-up"), "only [G][G]");
  assert.equal(zoneOf(two.engine, two.id("fb")), "play", "the Furball was not destroyed");
  assert.equal(handOf(two.engine, P1).length, 0);
  const spent = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
      { key: "fb", def: printing(FURBALL), owner: P1, zone: "play", attachedToKey: "host" },
      ...spentBank("greed", 3, P1),
      { key: "top", def: character({ name: "Top" }), owner: P1, zone: "deck" }
    ]
  });
  assert.equal(ready(spent.engine), 0);
  activate(spent.engine, P1, spent.id("fb"), "impressionistic-furball-cough-up");
  assert.deepEqual(handOf(spent.engine, P1), [spent.id("top")], "three spent [G] still meet the threshold: no resource is paid");
  assert.equal(zoneOf(spent.engine, spent.id("fb")), "discard");
});
