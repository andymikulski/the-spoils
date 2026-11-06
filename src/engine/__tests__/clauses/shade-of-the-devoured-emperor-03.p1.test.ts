// Clause tests — batch shade-of-the-devoured-emperor-03, part p1 (groups 1-7: Mau Strategist, Mr. Fetch,
// Mushroom Merchant, Negotiation Ceremonies, Pinguid Bodyguard, Purloinering Pirate, Recycling Scheme Facility).
// Expectations come from each card's PRINTED text and RULES.md / the CR; engine data is only used to drive the engine.

import assert from "node:assert/strict";
import type { CardDefinition, SpoilsEngine } from "../../../engine.js";
import {
  buildGame,
  activate,
  bank,
  bounceTactic,
  character,
  developFaction,
  item,
  killTactic,
  location,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic,
  P1,
  P2
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, clauseMismatch, declineAll, drain, printing, refused } from "./_clause.js";
import { declareAttackBy, fightThrough, finishBattle, playRaw } from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { endTurn } from "./_turn.js";

const MAU = "e0b38a11-024e-47b7-a886-a22221328fea"; // Mau Strategist -- ETB: may search for a staple resource; if destroyed: may draw
const FETCH = "78e8d502-b066-4f29-a690-dd202713bcc8"; // Mr. Fetch -- UNIQUE PLUCK; ETB exile+draw; GOOD DEAL
const MERCHANT = "d68c6b4d-ed0c-4896-a9e2-f6c91e5c951e"; // Mushroom Merchant -- ETB: pick a character, +2 life this turn
const NEGOTIATION = "fc6ce67c-25c7-48b2-911c-fec7572c8154"; // Negotiation Ceremonies -- alternating pay loop, each draws what they paid
const BODYGUARD = "3ab1c632-f0ab-4bc6-bbf4-85162d896459"; // Pinguid Bodyguard -- restore after attacking, once per turn, PROTECT
const PIRATE = "66e67194-792c-4d2c-b47b-f410627c1c43"; // Purloinering Pirate -- +1/+1 per token, PUSH OVERBOARD AND LOOT
const FACILITY = "fd3fea1f-448c-405d-96c3-e6aa6e1395ef"; // Recycling Scheme Facility -- ETB draw; characters to discard may be recycled for 4

type Icon = "rage" | "greed" | "deception" | "elitism" | "obsession";
type Player = typeof P1 | typeof P2;

// --- shared helpers --------------------------------------------------------------------------------

const staple = (name: string, icon: Icon = "rage"): CardDefinition => resourceCard({ name, resource: { provides: [icon], staple: true } });
const nonStaple = (name: string): CardDefinition => resourceCard({ name, resource: { provides: ["rage"], staple: false } });
const handOf = (engine: SpoilsEngine, p: Player = P1): string[] => [...engine.state.players[p].hand];
const deckOf = (engine: SpoilsEngine, p: Player = P1): string[] => [...engine.state.players[p].deck];
const discardOf = (engine: SpoilsEngine, p: Player = P1): string[] => [...engine.state.players[p].discard];
const sorted = (xs: string[]): string[] => [...xs].sort();
const isDepleted = (engine: SpoilsEngine, cardId: string): boolean => Boolean(engine.state.cards[cardId].depleted);
const revealsOf = (engine: SpoilsEngine) =>
  engine
    .getLog()
    .filter((entry) => entry.event?.type === "cardsRevealed")
    .map((entry) => entry.event as unknown as { cardIds: string[]; viewerId: string });
/** Index of the option of the open chooserSelectsOption whose label matches. */
const optionIndex = (engine: SpoilsEngine, re: RegExp): number => {
  const pc = pending(engine) as unknown as { kind: string; options: { label: string }[] };
  assert.equal(pc.kind, "chooserSelectsOption", "an option choice is open");
  const i = pc.options.findIndex((o) => re.test(o.label));
  assert.ok(i >= 0, `an option matching ${re} (have ${pc.options.map((o) => o.label).join(" / ")})`);
  return i;
};
/** Fisher-Yates exactly as the engine does it, fed by a constant random source. */
function shuffledWithConstant(items: string[], value: number): string[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(value * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const answerFaction = (engine: SpoilsEngine, p: Player): string => engine.state.players[p].factionId!;

// =====================================================================================================
// Mau Strategist -- character, cost 3, [G][G], 1/3/1, MAU BUREAUCRAT
//   When this card enters play, you may search your deck for a staple resource, reveal it, and put it into your hand.
//   If this card is destroyed, you may draw a card.
// =====================================================================================================

function mauBoard(o: { greed?: number; rage?: number; staples?: boolean; msZone?: "hand" | "play"; extra?: CardPlacement[]; p2?: boolean } = {}) {
  const staples: CardPlacement[] =
    o.staples === false
      ? []
      : [
          { key: "sr", def: staple("Staple Rage", "rage"), owner: P1, zone: "deck" },
          { key: "sg", def: staple("Staple Greed", "greed"), owner: P1, zone: "deck" }
        ];
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: () => 0,
    cards: [
      { key: "ms", def: printing(MAU), owner: P1, zone: o.msZone ?? "hand" },
      ...staples,
      { key: "ns", def: nonStaple("Special Resource"), owner: P1, zone: "deck" },
      { key: "dc", def: character({ name: "Deck Char" }), owner: P1, zone: "deck" },
      ...fillers("f", 3, P1, "deck"),
      { key: "hs", def: staple("Hand Staple"), owner: P1, zone: "hand" },
      { key: "ds", def: staple("Discard Staple"), owner: P1, zone: "discard" },
      { key: "os", def: staple("Opp Staple"), owner: P2, zone: "deck" },
      ...fillers("of", 3, P2, "deck"),
      ...bank("greed", o.greed ?? 3, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.extra ?? [])
    ]
  });
}

clause(MAU, "0:rule", "is deployed for its printed cost of 3 with [G][G]: refused one resource short and without the threshold", () => {
  const ok = mauBoard({ greed: 3 });
  play(ok.engine, P1, ok.id("ms"));
  assert.equal(zoneOf(ok.engine, ok.id("ms")), "play");
  assert.deepEqual([ok.engine.getStat(ok.id("ms"), "strength"), ok.engine.getStat(ok.id("ms"), "speed"), ok.engine.getStat(ok.id("ms"), "life")], [1, 3, 1], "printed strength / speed / life");
  assert.equal(readyResources(ok.engine, P1), 0, "all 3 resources were spent");

  const short = mauBoard({ greed: 2 });
  refused(() => playRaw(short.engine, P1, short.id("ms")), "2 resources is one short of cost 3");
  assert.equal(zoneOf(short.engine, short.id("ms")), "hand");

  const noThreshold = mauBoard({ greed: 1, rage: 2 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("ms")), "3 resources but only one [G] of the [G][G] threshold");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("ms")), "hand");
});

function mauFinds(key: "sr" | "sg") {
  const { engine, id } = mauBoard();
  const oppDeck = deckOf(engine, P2);
  const deckBefore = deckOf(engine, P1);
  const handBefore = handOf(engine, P1);
  play(engine, P1, id("ms"));
  assert.equal(pending(engine)?.kind, "selectTargets", "entering play offers the search");
  answerPending(engine, "selectTargets", { selected: { res: [id(key)] } });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("ms")), "play");
  assert.equal(zoneOf(engine, id(key)), "hand", "the chosen staple resource is put into the hand");
  assert.deepEqual(sorted(handOf(engine, P1)), sorted([...handBefore.filter((c) => c !== id("ms")), id(key)]), "exactly that card joins the hand");
  assert.deepEqual(sorted(deckOf(engine, P1)), sorted(deckBefore.filter((c) => c !== id(key))), "and it left the deck, nothing else did");
  assert.deepEqual(deckOf(engine, P2), oppDeck, "the opponent's deck is untouched");
  const reveals = revealsOf(engine);
  assert.equal(reveals.length, 1, "the found card is revealed");
  assert.deepEqual(reveals[0].cardIds, [id(key)]);
  assert.equal(reveals[0].viewerId, "all", "to everyone");
}
clause(MAU, "0:rule", "ETB: finds a staple resource (Rage) in the deck, reveals it and puts it into the hand", () => mauFinds("sr"));
clause(MAU, "0:rule", "ETB: finds a staple resource (Greed) in the deck, reveals it and puts it into the hand", () => mauFinds("sg"));

clause(MAU, "0:rule", "ETB: only a staple resource in YOUR DECK can be picked (not a non-staple resource, a character, the opponent's deck, your hand or discard)", () => {
  const { engine, id } = mauBoard();
  play(engine, P1, id("ms"));
  for (const bad of ["ns", "dc", "os", "hs", "ds", "f0"]) {
    refused(() => answerPending(engine, "selectTargets", { selected: { res: [id(bad)] } }), `${bad} is not a staple resource in your deck`);
    assert.equal(pending(engine)?.kind, "selectTargets", `${bad}: the search is still open after the refusal`);
  }
  answerPending(engine, "selectTargets", { selected: { res: [id("sg")] } });
  assert.equal(zoneOf(engine, id("sg")), "hand", "control: a staple resource in the deck is accepted");
});

clause(MAU, "0:rule", "ETB: the search deck is shuffled afterwards (CR 312.1)", () => {
  const { engine, id } = mauBoard();
  const remaining = deckOf(engine, P1).filter((c) => c !== id("sr"));
  play(engine, P1, id("ms"));
  answerPending(engine, "selectTargets", { selected: { res: [id("sr")] } });
  assert.deepEqual(sorted(deckOf(engine, P1)), sorted(remaining), "the same cards remain");
  assert.notDeepEqual(deckOf(engine, P1), remaining, "but their order changed: the deck was shuffled");
  assert.deepEqual(deckOf(engine, P1), shuffledWithConstant(remaining, 0));
});

clause(MAU, "0:rule", "ETB: declining the search ('you may search') leaves the deck order untouched", () => {
  const { engine, id } = mauBoard();
  const deckBefore = deckOf(engine, P1);
  play(engine, P1, id("ms"));
  answerPending(engine, "selectTargets", { selected: { res: [], "__declined:res": [] } });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("ms")), "play");
  assert.deepEqual(handOf(engine, P1), [id("hs")], "nothing was added to the hand");
  assert.deepEqual(deckOf(engine, P1), deckBefore, "the deck was not searched, so it is not shuffled");
  assert.equal(revealsOf(engine).length, 0, "nothing revealed");
});

clause(MAU, "0:rule", "ETB: searching and finding nothing (an empty pick that is not a decline) still shuffles the deck (CR 312.1, 312.2)", () => {
  const { engine, id } = mauBoard();
  const before = deckOf(engine, P1);
  play(engine, P1, id("ms"));
  answerPending(engine, "selectTargets", { selected: { res: [] } });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(engine, P1), [id("hs")], "nothing was found");
  assert.deepEqual(sorted(deckOf(engine, P1)), sorted(before), "the same cards remain");
  assert.deepEqual(deckOf(engine, P1), shuffledWithConstant(before, 0), "the failed search shuffled the deck");
});

clause(MAU, "0:rule", "ETB: declining the search puts nothing into the hand and keeps every card in the deck", () => {
  const { engine, id } = mauBoard();
  const deckBefore = deckOf(engine, P1);
  play(engine, P1, id("ms"));
  answerPending(engine, "selectTargets", { selected: { res: [] } });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(engine, P1), [id("hs")]);
  assert.deepEqual(sorted(deckOf(engine, P1)), sorted(deckBefore));
  assert.equal(zoneOf(engine, id("sr")), "deck");
  assert.equal(zoneOf(engine, id("sg")), "deck");
  assert.equal(revealsOf(engine).length, 0, "nothing was revealed");
});

clause(MAU, "0:rule", "ETB: with no staple resource in the deck nothing is found, nothing enters the hand, and the game goes on", () => {
  const { engine, id } = mauBoard({ staples: false });
  play(engine, P1, id("ms"));
  drain(engine, declineAll);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("ms")), "play");
  assert.deepEqual(handOf(engine, P1), [id("hs")]);
  assert.equal(zoneOf(engine, id("ns")), "deck", "a non-staple resource is not a legal find");
  assert.equal(revealsOf(engine).length, 0);
});

clause(MAU, "0:rule", "ETB: only fires when THIS card enters play (another character entering play does not offer the search)", () => {
  const { engine, id } = mauBoard({ msZone: "play", extra: [{ key: "other", def: character({ name: "Other", cost: 0 }), owner: P1, zone: "hand" }] });
  const handBefore = handOf(engine, P1);
  play(engine, P1, id("other"));
  assert.equal(zoneOf(engine, id("other")), "play");
  assert.equal(engine.state.pendingChoice, undefined, "no search offered");
  assert.deepEqual(sorted(handOf(engine, P1)), sorted(handBefore.filter((c) => c !== id("other"))));
  assert.equal(zoneOf(engine, id("sr")), "deck");
});

function mauDies(accept: boolean) {
  const { engine, id } = mauBoard({ msZone: "play", extra: [{ key: "kt", def: killTactic(), owner: P1, zone: "hand" }] });
  const deckBefore = deckOf(engine, P1);
  const handBefore = handOf(engine, P1);
  play(engine, P1, id("kt"), { selected: { t: [id("ms")] } });
  assert.equal(zoneOf(engine, id("ms")), "discard", "Mau Strategist is destroyed");
  assert.equal(pending(engine)?.kind, "chooserSelectsOption", "its controller is offered the draw");
  assert.equal(pending(engine)?.playerId, P1);
  answerPending(engine, "chooserSelectsOption", { index: optionIndex(engine, accept ? /draw/i : /decline|no/i) });
  assert.equal(engine.state.pendingChoice, undefined);
  const handAfter = handOf(engine, P1);
  if (accept) {
    assert.deepEqual(sorted(handAfter), sorted([...handBefore.filter((c) => c !== id("kt")), deckBefore[0]]), "draws exactly the top card");
    assert.deepEqual(deckOf(engine, P1), deckBefore.slice(1));
  } else {
    assert.deepEqual(sorted(handAfter), sorted(handBefore.filter((c) => c !== id("kt"))), "nothing drawn");
    assert.deepEqual(deckOf(engine, P1), deckBefore);
  }
}
clause(MAU, "1:rule", "when destroyed its controller may draw a card: accepting draws exactly one (the top card)", () => mauDies(true));
clause(MAU, "1:rule", "when destroyed its controller may draw a card: declining draws nothing", () => mauDies(false));

clause(MAU, "1:rule", "dying in battle (blocking a stronger attacker) also lets its controller draw", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "att", def: character({ name: "Brute", strength: 5, life: 6 }), owner: P1, zone: "play" },
      { key: "ms", def: printing(MAU), owner: P2, zone: "play" },
      ...fillers("d", 3, P2, "deck")
    ]
  });
  const deckBefore = deckOf(engine, P2);
  const handBefore = handOf(engine, P2);
  let offered: string | undefined;
  fightThrough(engine, P1, [id("att")], { type: "faction", playerId: P2 }, [id("ms")], undefined, (pc) => {
    if (pc.kind === "chooserSelectsOption") {
      offered = pc.playerId;
      return { kind: "chooserSelectsOption", index: optionIndex(engine, /draw/i) };
    }
    return declineAll(pc);
  });
  assert.equal(zoneOf(engine, id("ms")), "discard");
  assert.equal(offered, P2, "the Mau's controller is offered the draw");
  assert.deepEqual(handOf(engine, P2), [...handBefore, deckBefore[0]]);
});

clause(MAU, "1:rule", "near misses: another character being destroyed, or this card leaving play WITHOUT being destroyed, offers no draw", () => {
  const { engine, id } = mauBoard({
    msZone: "play",
    extra: [
      { key: "mate", def: character({ name: "Mate" }), owner: P1, zone: "play" },
      { key: "kt", def: killTactic(), owner: P1, zone: "hand" },
      { key: "bt", def: bounceTactic(), owner: P1, zone: "hand" }
    ]
  });
  const deckBefore = deckOf(engine, P1);
  play(engine, P1, id("kt"), { selected: { t: [id("mate")] } });
  assert.equal(zoneOf(engine, id("mate")), "discard");
  assert.equal(engine.state.pendingChoice, undefined, "a different character's death offers nothing");
  play(engine, P1, id("bt"), { selected: { t: [id("ms")] } });
  assert.equal(zoneOf(engine, id("ms")), "hand", "Mau is returned to hand, not destroyed");
  assert.equal(engine.state.pendingChoice, undefined, "so no draw is offered");
  assert.deepEqual(deckOf(engine, P1), deckBefore, "nothing was drawn");
});

// =====================================================================================================
// Mr. Fetch -- character, cost 4, [G][G], 1/3/2, PLUCK GRIFTER, UNIQUE PLUCK
//   When this card enters play, you may remove a card in your discard pile from the game. If you do, draw a card.
//   GOOD DEAL -- COST: Deplete this card. Pick 2 cards of the same type in your discard pile. Remove them from the game.
//                EFFECT: Search your deck for a card with the same type as the picked cards and reveal it. If you do, put it into your hand.
// =====================================================================================================

const TYPES = ["character", "item", "tactic", "location", "resource"] as const;
type CardType = (typeof TYPES)[number];
const defOfType = (type: CardType, name: string): CardDefinition =>
  type === "character" ? character({ name }) : type === "item" ? item({ name }) : type === "tactic" ? tactic({ name, cost: 5 }) : type === "location" ? location({ name }) : staple(name);

function fetchBoard(o: { zone?: "hand" | "play"; greed?: number; rage?: number; extra?: CardPlacement[]; discardPairs?: boolean } = {}) {
  const discards: CardPlacement[] =
    o.discardPairs === false
      ? []
      : TYPES.flatMap((t) => [1, 2].map((n) => ({ key: `d-${t}-${n}`, def: defOfType(t, `Dead ${t} ${n}`), owner: P1, zone: "discard" as const })));
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: () => 0,
    cards: [
      { key: "mf", def: printing(FETCH), owner: P1, zone: o.zone ?? "hand" },
      ...discards,
      ...TYPES.map((t) => ({ key: `k-${t}`, def: defOfType(t, `Deck ${t}`), owner: P1, zone: "deck" as const })),
      ...fillers("f", 3, P1, "deck"),
      { key: "hh", def: character({ name: "Hand Char" }), owner: P1, zone: "hand" },
      { key: "od1", def: character({ name: "Opp Dead 1" }), owner: P2, zone: "discard" },
      { key: "od2", def: character({ name: "Opp Dead 2" }), owner: P2, zone: "discard" },
      { key: "ok", def: character({ name: "Opp Deck Char" }), owner: P2, zone: "deck" },
      ...bank("greed", o.greed ?? 4, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.extra ?? [])
    ]
  });
}

/**
 * Plays Mr. Fetch into a board that already holds another PLUCK card, answering the ETB offer with "decline" and the
 * survivor choice with `keep`; returns what the survivor choice looked like. The callers' final
 * `resolvePendingResponses` is the "game goes on afterwards" check (SYS-11).
 */
function pluckDuplicate(b: ReturnType<typeof fetchBoard>, keep: string) {
  let survivor: { playerId: string; candidates: string[] } | undefined;
  playRaw(b.engine, P1, b.id("mf"));
  resolvePendingResponses(b.engine);
  let guard = 0;
  while (b.engine.state.pendingChoice && guard++ < 6) {
    const pc = pending(b.engine)!;
    if (pc.kind === "uniqueSurvivor") {
      survivor = { playerId: pc.playerId, candidates: [...(pc.candidates as string[])] };
      b.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "uniqueSurvivor", keep: b.id(keep) } } as never);
    } else {
      b.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: declineAll(pc) } as never);
    }
  }
  return survivor;
}
const GAME_GOES_ON = "after the survivor choice the game is not stuck";

clause(FETCH, "0:unique", "UNIQUE PLUCK: a second Mr. Fetch makes its controller keep one: keeping the new one destroys the old one", () => {
  const b = fetchBoard({ extra: [{ key: "mf2", def: printing(FETCH), owner: P1, zone: "hand" }, { key: "mfOld", def: printing(FETCH), owner: P1, zone: "play" }] });
  const survivor = pluckDuplicate(b, "mf");
  assert.equal(survivor?.playerId, P1, "the controller chooses");
  assert.deepEqual(sorted(survivor?.candidates ?? []), sorted([b.id("mf"), b.id("mfOld")]));
  assert.equal(zoneOf(b.engine, b.id("mf")), "play");
  assert.equal(zoneOf(b.engine, b.id("mfOld")), "discard", "the other copy is destroyed");
  assert.equal(zoneOf(b.engine, b.id("mf2")), "hand", "a third copy in hand is irrelevant");
  assert.doesNotThrow(() => resolvePendingResponses(b.engine), GAME_GOES_ON);
});

clause(FETCH, "0:unique", "UNIQUE PLUCK: keeping the old Mr. Fetch destroys the new one", () => {
  const b = fetchBoard({ extra: [{ key: "mfOld", def: printing(FETCH), owner: P1, zone: "play" }] });
  const survivor = pluckDuplicate(b, "mfOld");
  assert.ok(survivor, "a survivor choice was made");
  assert.equal(zoneOf(b.engine, b.id("mfOld")), "play");
  assert.equal(zoneOf(b.engine, b.id("mf")), "discard");
  assert.doesNotThrow(() => resolvePendingResponses(b.engine), GAME_GOES_ON);
});

clause(FETCH, "0:unique", "UNIQUE PLUCK covers every card with the PLUCK designation, not only Mr. Fetch", () => {
  const b = fetchBoard({ extra: [{ key: "other", def: character({ name: "Other Pluck", unique: "pluck" } as Partial<CardDefinition>), owner: P1, zone: "play" }] });
  const survivor = pluckDuplicate(b, "other");
  assert.ok(survivor, "another PLUCK card is a duplicate");
  assert.equal(zoneOf(b.engine, b.id("mf")), "discard");
  assert.equal(zoneOf(b.engine, b.id("other")), "play");
  assert.doesNotThrow(() => resolvePendingResponses(b.engine), GAME_GOES_ON);
});

clause(FETCH, "0:unique", "UNIQUE is per player (the opponent's own Mr. Fetch is no duplicate) and other designations are not PLUCK", () => {
  const b = fetchBoard({
    extra: [
      { key: "theirs", def: printing(FETCH), owner: P2, zone: "play" },
      { key: "diff", def: character({ name: "Different", unique: "something else" } as Partial<CardDefinition>), owner: P1, zone: "play" },
      { key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "play" }
    ]
  });
  play(b.engine, P1, b.id("mf"));
  drain(b.engine, (pc) => {
    assert.notEqual(pc.kind, "uniqueSurvivor", "no duplicate choice");
    return declineAll(pc);
  });
  assert.equal(zoneOf(b.engine, b.id("mf")), "play");
  assert.equal(zoneOf(b.engine, b.id("theirs")), "play");
  assert.equal(zoneOf(b.engine, b.id("diff")), "play");
  assert.equal(zoneOf(b.engine, b.id("plain")), "play");
});

clause(FETCH, "1:rule", "is deployed for its printed cost of 4 with [G][G]: refused one resource short and without the threshold", () => {
  const ok = fetchBoard({ greed: 4 });
  play(ok.engine, P1, ok.id("mf"));
  assert.equal(zoneOf(ok.engine, ok.id("mf")), "play");
  assert.deepEqual([ok.engine.getStat(ok.id("mf"), "strength"), ok.engine.getStat(ok.id("mf"), "speed"), ok.engine.getStat(ok.id("mf"), "life")], [1, 3, 2], "printed strength / speed / life");
  assert.equal(readyResources(ok.engine, P1), 0, "all 4 resources were spent");
  const short = fetchBoard({ greed: 3 });
  refused(() => playRaw(short.engine, P1, short.id("mf")), "3 resources is one short of cost 4");
  assert.equal(zoneOf(short.engine, short.id("mf")), "hand");
  const noThreshold = fetchBoard({ greed: 1, rage: 3 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("mf")), "4 resources but only one [G]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("mf")), "hand");
});

function fetchEtb(pick: string) {
  const { engine, id } = fetchBoard();
  const deckBefore = deckOf(engine, P1);
  const handBefore = handOf(engine, P1);
  const discardBefore = discardOf(engine, P1);
  play(engine, P1, id("mf"));
  assert.equal(pending(engine)?.kind, "selectTargets", "entering play offers the removal");
  answerPending(engine, "selectTargets", { selected: { exile: [id(pick)] } });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id(pick)), "removed", "the picked card is removed from the game");
  assert.deepEqual(sorted(discardOf(engine, P1)), sorted(discardBefore.filter((c) => c !== id(pick))), "only that card left the discard pile");
  assert.deepEqual(sorted(handOf(engine, P1)), sorted([...handBefore.filter((c) => c !== id("mf")), deckBefore[0]]), "and exactly one card (the top card) was drawn");
  assert.deepEqual(deckOf(engine, P1), deckBefore.slice(1));
}
clause(FETCH, "1:rule", "ETB: may remove a CHARACTER in your discard pile from the game; if you do, draw a card", () => fetchEtb("d-character-1"));
clause(FETCH, "1:rule", "ETB: the removed discard card may be an item (any card type)", () => fetchEtb("d-item-1"));
clause(FETCH, "1:rule", "ETB: the removed discard card may be a tactic (any card type)", () => fetchEtb("d-tactic-1"));
clause(FETCH, "1:rule", "ETB: the removed discard card may be a location (any card type)", () => fetchEtb("d-location-1"));
clause(FETCH, "1:rule", "ETB: the removed discard card may be a resource (any card type)", () => fetchEtb("d-resource-1"));

clause(FETCH, "1:rule", "ETB: only a card in YOUR discard pile can be removed (not the opponent's discard, your hand, deck or play)", () => {
  const { engine, id } = fetchBoard({ extra: [{ key: "inplay", def: character({ name: "In Play" }), owner: P1, zone: "play" }] });
  play(engine, P1, id("mf"));
  for (const bad of ["od1", "hh", "k-character", "inplay"]) {
    refused(() => answerPending(engine, "selectTargets", { selected: { exile: [id(bad)] } }), `${bad} is not in your discard pile`);
    assert.equal(pending(engine)?.kind, "selectTargets", `${bad}: still open after the refusal`);
  }
  answerPending(engine, "selectTargets", { selected: { exile: [id("d-character-1")] } });
  assert.equal(zoneOf(engine, id("d-character-1")), "removed", "control: your own discard card is accepted");
  assert.equal(zoneOf(engine, id("od1")), "discard");
});

clause(FETCH, "1:rule", "ETB: only ONE card is removed and only ONE is drawn", () => {
  const { engine, id } = fetchBoard();
  const handBefore = handOf(engine, P1).length;
  play(engine, P1, id("mf"));
  refused(() => answerPending(engine, "selectTargets", { selected: { exile: [id("d-character-1"), id("d-character-2")] } }), "two cards for a 'a card' pick");
  answerPending(engine, "selectTargets", { selected: { exile: [id("d-character-1")] } });
  assert.equal(zoneOf(engine, id("d-character-2")), "discard");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1, "Mr. Fetch left the hand, one card was drawn");
});

clause(FETCH, "1:rule", "ETB: declining ('you may') removes nothing and, since you did not, draws nothing", () => {
  const { engine, id } = fetchBoard();
  const deckBefore = deckOf(engine, P1);
  const handBefore = handOf(engine, P1);
  const discardBefore = discardOf(engine, P1);
  play(engine, P1, id("mf"));
  answerPending(engine, "selectTargets", { selected: { exile: [] } });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("mf")), "play");
  assert.deepEqual(handOf(engine, P1), handBefore.filter((c) => c !== id("mf")), "no draw");
  assert.deepEqual(deckOf(engine, P1), deckBefore);
  assert.deepEqual(sorted(discardOf(engine, P1)), sorted(discardBefore), "nothing removed");
});

clause(FETCH, "1:rule", "ETB: with an empty discard pile there is nothing to remove and no card is drawn", () => {
  const { engine, id } = fetchBoard({ discardPairs: false });
  const deckBefore = deckOf(engine, P1);
  play(engine, P1, id("mf"));
  drain(engine, declineAll);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("mf")), "play");
  assert.deepEqual(handOf(engine, P1), [id("hh")], "no draw");
  assert.deepEqual(deckOf(engine, P1), deckBefore);
});

clause(FETCH, "1:rule", "ETB: only fires when THIS card enters play (another card entering play does not offer the removal)", () => {
  const { engine, id } = fetchBoard({ zone: "play", extra: [{ key: "other", def: character({ name: "Other", cost: 0 }), owner: P1, zone: "hand" }] });
  play(engine, P1, id("other"));
  assert.equal(zoneOf(engine, id("other")), "play");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("d-character-1")), "discard");
});

// GOOD DEAL ------------------------------------------------------------------------------------------

function goodDeal(type: CardType) {
  const { engine, id } = fetchBoard({ zone: "play" });
  const a = id(`d-${type}-1`);
  const b = id(`d-${type}-2`);
  const found = id(`k-${type}`);
  const deckBefore = deckOf(engine, P1);
  const handBefore = handOf(engine, P1);
  const discardBefore = discardOf(engine, P1);
  const oppDiscard = discardOf(engine, P2);
  activate(engine, P1, id("mf"), "mr-fetch-good-deal", { selected: { t1: [a], t2: [b] } });
  // costs are paid as the ability is used
  assert.equal(isDepleted(engine, id("mf")), true, "COST: Mr. Fetch is depleted");
  assert.equal(zoneOf(engine, a), "removed", "COST: the first picked card is removed from the game");
  assert.equal(zoneOf(engine, b), "removed", "COST: the second picked card is removed from the game");
  assert.deepEqual(sorted(discardOf(engine, P1)), sorted(discardBefore.filter((c) => c !== a && c !== b)), "no other card left the discard pile");
  assert.deepEqual(sorted(discardOf(engine, P2)), sorted(oppDiscard));
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "the search is offered");
  assert.equal(pending(engine)?.playerId, P1);
  // every deck card of ANOTHER type is refused
  for (const other of TYPES.filter((t) => t !== type)) {
    refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id(`k-${other}`)] }), `a ${other} is not the same type as the picked ${type}s`);
    assert.equal(pending(engine)?.kind, "chooserSelectsTarget", `${other}: the search is still open`);
  }
  for (const bad of ["ok", "hh", "od1"]) {
    refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id(bad)] }), `${bad} is not in your deck`);
  }
  answerPending(engine, "chooserSelectsTarget", { selected: [found] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, found), "hand", `the ${type} from the deck is put into the hand`);
  assert.deepEqual(sorted(handOf(engine, P1)), sorted([...handBefore, found]), "exactly that card joins the hand");
  assert.deepEqual(sorted(deckOf(engine, P1)), sorted(deckBefore.filter((c) => c !== found)), "and leaves the deck");
  const reveals = revealsOf(engine);
  assert.equal(reveals.length, 1, "the found card is revealed");
  assert.deepEqual(reveals[0].cardIds, [found]);
}
clause(FETCH, "2:ability:mr-fetch-good-deal", "GOOD DEAL: two characters from the discard pile are removed; a character is fetched from the deck", () => goodDeal("character"));
clause(FETCH, "2:ability:mr-fetch-good-deal", "GOOD DEAL: two items from the discard pile are removed; an item is fetched from the deck", () => goodDeal("item"));
clause(FETCH, "2:ability:mr-fetch-good-deal", "GOOD DEAL: two tactics from the discard pile are removed; a tactic is fetched from the deck", () => goodDeal("tactic"));
clause(FETCH, "2:ability:mr-fetch-good-deal", "GOOD DEAL: two locations from the discard pile are removed; a location is fetched from the deck", () => goodDeal("location"));
clause(FETCH, "2:ability:mr-fetch-good-deal", "GOOD DEAL: two resources from the discard pile are removed; a resource is fetched from the deck", () => goodDeal("resource"));

clause(FETCH, "2:ability:mr-fetch-good-deal", "GOOD DEAL: the two picks must be two DIFFERENT cards of the SAME type in your own discard pile", () => {
  const { engine, id } = fetchBoard({ zone: "play" });
  const go = (t1: string, t2?: string) => () =>
    activate(engine, P1, id("mf"), "mr-fetch-good-deal", { selected: t2 ? { t1: [id(t1)], t2: [id(t2)] } : { t1: [id(t1)] } });
  refused(go("d-character-1", "d-item-1"), "a character and an item are not the same type");
  refused(go("d-tactic-1", "d-location-1"), "a tactic and a location are not the same type");
  refused(go("d-character-1", "d-character-1"), "the same card twice is not two cards");
  refused(go("d-character-1"), "only one card picked");
  refused(go("od1", "od2"), "the opponent's discard pile is not yours");
  refused(go("d-character-1", "od1"), "one of yours and one of theirs");
  refused(go("od1", "d-character-1"), "the first pick is from the opponent's discard pile");
  refused(go("hh", "k-character"), "cards from the hand / deck are not in the discard pile");
  assert.equal(isDepleted(engine, id("mf")), false, "nothing was paid by any refused attempt");
  for (const k of ["d-character-1", "d-character-2", "d-item-1", "d-tactic-1", "d-location-1"]) assert.equal(zoneOf(engine, id(k)), "discard", `${k} is still in the discard pile`);
  go("d-character-1", "d-character-2")();
  assert.equal(zoneOf(engine, id("d-character-1")), "removed", "control: a valid same-type pair is accepted");
});

clause(FETCH, "2:ability:mr-fetch-good-deal", "GOOD DEAL: needs a pair of the same type in the discard pile (no pair = unusable)", () => {
  const { engine, id } = fetchBoard({
    zone: "play",
    discardPairs: false,
    extra: [
      { key: "x1", def: character({ name: "Lone Char" }), owner: P1, zone: "discard" },
      { key: "x2", def: item({ name: "Lone Item" }), owner: P1, zone: "discard" },
      { key: "x3", def: tactic({ name: "Lone Tactic" }), owner: P1, zone: "discard" }
    ]
  });
  for (const [a, b] of [["x1", "x2"], ["x2", "x3"], ["x1", "x3"]]) {
    refused(() => activate(engine, P1, id("mf"), "mr-fetch-good-deal", { selected: { t1: [id(a)], t2: [id(b)] } }), `${a}+${b} differ in type`);
  }
  assert.equal(isDepleted(engine, id("mf")), false);
  assert.deepEqual(sorted(discardOf(engine, P1)), sorted([id("x1"), id("x2"), id("x3")]));
});

clause(FETCH, "2:ability:mr-fetch-good-deal", "GOOD DEAL: Mr. Fetch must be able to deplete itself (refused while depleted)", () => {
  const { engine, id } = fetchBoard({ zone: "play" });
  engine.state.cards[id("mf")].depleted = true;
  refused(() => activate(engine, P1, id("mf"), "mr-fetch-good-deal", { selected: { t1: [id("d-item-1")], t2: [id("d-item-2")] } }), "already depleted");
  assert.equal(zoneOf(engine, id("d-item-1")), "discard", "nothing was removed");
  engine.state.cards[id("mf")].depleted = false;
  activate(engine, P1, id("mf"), "mr-fetch-good-deal", { selected: { t1: [id("d-item-1")], t2: [id("d-item-2")] } });
  assert.equal(zoneOf(engine, id("d-item-1")), "removed", "control: the same activation works when not depleted");
});

clause(FETCH, "2:ability:mr-fetch-good-deal", "GOOD DEAL: the fetched card is optional-to-find: failing the search still pays the whole cost and fetches nothing", () => {
  const { engine, id } = fetchBoard({ zone: "play" });
  const handBefore = handOf(engine, P1);
  activate(engine, P1, id("mf"), "mr-fetch-good-deal", { selected: { t1: [id("d-item-1")], t2: [id("d-item-2")] } });
  answerPending(engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(isDepleted(engine, id("mf")), true, "depleted");
  assert.equal(zoneOf(engine, id("d-item-1")), "removed");
  assert.equal(zoneOf(engine, id("d-item-2")), "removed");
  assert.deepEqual(handOf(engine, P1), handBefore, "no card fetched");
  assert.equal(zoneOf(engine, id("k-item")), "deck");
  assert.equal(revealsOf(engine).length, 0, "nothing revealed");
});

clause(FETCH, "2:ability:mr-fetch-good-deal", "GOOD DEAL: a deck with no card of the picked type finds nothing (the cost is still paid)", () => {
  const b2 = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "mf", def: printing(FETCH), owner: P1, zone: "play" },
      { key: "l1", def: location({ name: "Dead Loc 1" }), owner: P1, zone: "discard" },
      { key: "l2", def: location({ name: "Dead Loc 2" }), owner: P1, zone: "discard" },
      ...fillers("f", 3, P1, "deck")
    ]
  });
  const handBefore = handOf(b2.engine, P1);
  activate(b2.engine, P1, b2.id("mf"), "mr-fetch-good-deal", { selected: { t1: [b2.id("l1")], t2: [b2.id("l2")] } });
  drain(b2.engine, declineAll);
  assert.equal(b2.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b2.engine, b2.id("l1")), "removed");
  assert.equal(zoneOf(b2.engine, b2.id("l2")), "removed");
  assert.equal(isDepleted(b2.engine, b2.id("mf")), true);
  assert.deepEqual(handOf(b2.engine, P1), handBefore, "nothing found, nothing added to the hand");
});

clause(FETCH, "2:ability:mr-fetch-good-deal", "GOOD DEAL: the searched deck is shuffled afterwards (CR 312.1)", () => {
  const { engine, id } = fetchBoard({ zone: "play" });
  const remaining = deckOf(engine, P1).filter((c) => c !== id("k-item"));
  activate(engine, P1, id("mf"), "mr-fetch-good-deal", { selected: { t1: [id("d-item-1")], t2: [id("d-item-2")] } });
  answerPending(engine, "chooserSelectsTarget", { selected: [id("k-item")] });
  assert.deepEqual(sorted(deckOf(engine, P1)), sorted(remaining), "the same cards remain");
  assert.notDeepEqual(deckOf(engine, P1), remaining, "but their order changed: the deck was shuffled");
});

clause(FETCH, "2:ability:mr-fetch-good-deal", "GOOD DEAL: can be used again after Mr. Fetch is restored, each use removing a new pair", () => {
  const { engine, id } = fetchBoard({ zone: "play" });
  activate(engine, P1, id("mf"), "mr-fetch-good-deal", { selected: { t1: [id("d-item-1")], t2: [id("d-item-2")] } });
  answerPending(engine, "chooserSelectsTarget", { selected: [id("k-item")] });
  refused(
    () => activate(engine, P1, id("mf"), "mr-fetch-good-deal", { selected: { t1: [id("d-tactic-1")], t2: [id("d-tactic-2")] } }),
    "depleted by the first use"
  );
  assert.equal(zoneOf(engine, id("d-tactic-1")), "discard");
  endTurn(engine, P1);
  endTurn(engine, P2);
  activate(engine, P1, id("mf"), "mr-fetch-good-deal", { selected: { t1: [id("d-tactic-1")], t2: [id("d-tactic-2")] } });
  answerPending(engine, "chooserSelectsTarget", { selected: [id("k-tactic")] });
  assert.equal(zoneOf(engine, id("k-tactic")), "hand");
  assert.equal(zoneOf(engine, id("d-tactic-1")), "removed");
});

// =====================================================================================================
// Mushroom Merchant -- character, cost 4, [G][G], 2/3/4, MAU MERCHANT
//   When this card enters play, you may pick a character. If you do, this turn, that character gains 2 life.
// =====================================================================================================

function merchantBoard(o: { greed?: number; rage?: number; mmZone?: "hand" | "play"; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "mm", def: printing(MERCHANT), owner: P1, zone: o.mmZone ?? "hand" },
      { key: "own", def: character({ name: "Own", strength: 1, life: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3 }), owner: P2, zone: "play" },
      { key: "itm", def: item({ name: "An Item" }), owner: P1, zone: "play" },
      { key: "loc", def: location({ name: "A Location" }), owner: P2, zone: "play" },
      { key: "inhand", def: character({ name: "In Hand", life: 3 }), owner: P1, zone: "hand" },
      { key: "gone", def: character({ name: "Gone", life: 3 }), owner: P1, zone: "discard" },
      ...bank("greed", o.greed ?? 4, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.extra ?? [])
    ]
  });
}

clause(MERCHANT, "0:rule", "is deployed for its printed cost of 4 with [G][G]: refused one resource short and without the threshold", () => {
  const ok = merchantBoard({ greed: 4 });
  play(ok.engine, P1, ok.id("mm"));
  assert.equal(zoneOf(ok.engine, ok.id("mm")), "play");
  assert.deepEqual([ok.engine.getStat(ok.id("mm"), "strength"), ok.engine.getStat(ok.id("mm"), "speed"), ok.engine.getStat(ok.id("mm"), "life")], [2, 3, 4], "printed strength / speed / life");
  assert.equal(readyResources(ok.engine, P1), 0, "all 4 resources were spent");
  const short = merchantBoard({ greed: 3 });
  refused(() => playRaw(short.engine, P1, short.id("mm")), "3 resources is one short of cost 4");
  assert.equal(zoneOf(short.engine, short.id("mm")), "hand");
  const noThreshold = merchantBoard({ greed: 1, rage: 3 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("mm")), "4 resources but only one [G]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("mm")), "hand");
});

function merchantGives(pick: string, base: number) {
  const { engine, id } = merchantBoard();
  const others = ["own", "foe"].filter((k) => k !== pick);
  play(engine, P1, id("mm"));
  assert.equal(pending(engine)?.kind, "selectTargets", "entering play offers the pick");
  answerPending(engine, "selectTargets", { selected: { pick: [id(pick)] } });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.getStat(id(pick), "life"), base + 2, `${pick} gains 2 life`);
  for (const o of others) assert.equal(engine.getStat(id(o), "life"), 3, `${o} is unaffected`);
  if (pick !== "mm") assert.equal(engine.getStat(id("mm"), "life"), 4, "the Merchant keeps its printed 4 life");
  assert.equal(engine.getStat(id(pick), "strength"), pick === "mm" ? 2 : 1, "only life changes");
  // this turn only
  endTurn(engine, P1);
  assert.equal(engine.getStat(id(pick), "life"), base, "the bonus ends with the turn");
}
clause(MERCHANT, "0:rule", "ETB: you may pick your own character: it gains 2 life this turn only", () => merchantGives("own", 3));
clause(MERCHANT, "0:rule", "ETB: you may pick an opponent's character: it gains 2 life this turn only", () => merchantGives("foe", 3));
clause(MERCHANT, "0:rule", "ETB: you may pick the Merchant itself (a character in play): it gains 2 life this turn only", () => merchantGives("mm", 4));

clause(MERCHANT, "0:rule", "ETB: only a character in play can be picked (not an item, a location, a card in hand or discard, or a Faction)", () => {
  const { engine, id } = merchantBoard();
  play(engine, P1, id("mm"));
  const bad: string[] = ["itm", "loc", "inhand", "gone"];
  for (const k of bad) {
    refused(() => answerPending(engine, "selectTargets", { selected: { pick: [id(k)] } }), `${k} is not a character in play`);
    assert.equal(pending(engine)?.kind, "selectTargets", `${k}: still open after the refusal`);
  }
  refused(() => answerPending(engine, "selectTargets", { selected: { pick: [answerFaction(engine, P2)] } }), "a Faction is not a character");
  refused(() => answerPending(engine, "selectTargets", { selected: { pick: [id("own"), id("foe")] } }), "only one character may be picked");
  answerPending(engine, "selectTargets", { selected: { pick: [id("own")] } });
  assert.equal(engine.getStat(id("own"), "life"), 5, "control: a character is accepted");
  for (const k of ["inhand", "gone"]) assert.equal(engine.getStat(id(k), "life"), 3, `${k} unchanged`);
});

clause(MERCHANT, "0:rule", "ETB: declining ('you may pick') changes no character's life", () => {
  const { engine, id } = merchantBoard();
  play(engine, P1, id("mm"));
  answerPending(engine, "selectTargets", { selected: { pick: [] } });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("mm")), "play");
  for (const [k, life] of [["own", 3], ["foe", 3], ["mm", 4]] as const) assert.equal(engine.getStat(id(k), "life"), life, `${k} unchanged`);
});

function merchantWall(pick: boolean) {
  const { engine, id } = merchantBoard({
    extra: [
      { key: "wall", def: character({ name: "Wall", strength: 1, life: 1 }), owner: P1, zone: "play" },
      { key: "hitter", def: character({ name: "Hitter", strength: 2, life: 9 }), owner: P2, zone: "play" }
    ]
  });
  play(engine, P1, id("mm"));
  answerPending(engine, "selectTargets", { selected: { pick: pick ? [id("wall")] : [] } });
  fightThrough(engine, P1, [id("wall")], { type: "faction", playerId: P2 }, [id("hitter")]);
  return { engine, id };
}
clause(MERCHANT, "0:rule", "ETB: the 2 life is real: a 1-life attacker that takes 2 damage from a blocker survives this turn", () => {
  const { engine, id } = merchantWall(true);
  assert.equal(zoneOf(engine, id("wall")), "play", "1 + 2 = 3 life survives 2 damage");
  assert.equal(engine.state.cards[id("wall")].damage, 2);
});
clause(MERCHANT, "0:rule", "ETB: control: without the pick the same 1-life attacker dies to the same blocker", () => {
  const { engine, id } = merchantWall(false);
  assert.equal(zoneOf(engine, id("wall")), "discard", "1 life does not survive 2 damage");
});

clause(MERCHANT, "0:rule", "ETB: only fires when THIS card enters play (another character entering play offers no pick)", () => {
  const { engine, id } = merchantBoard({ mmZone: "play", extra: [{ key: "other", def: character({ name: "Other", cost: 0 }), owner: P1, zone: "hand" }] });
  play(engine, P1, id("other"));
  assert.equal(zoneOf(engine, id("other")), "play");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.getStat(id("own"), "life"), 3);
});

// =====================================================================================================
// Negotiation Ceremonies -- tactic, cost 0, [G][G]
//   COST: Pick an opponent. You may pay 1. If you do, that opponent may pay 1. Repeat this cost until you or
//   your opponent does not pay. EFFECT: Each player draws cards equal to the amount they paid.
// =====================================================================================================

function negoBoard(o: { p1?: number; p2?: number; rage?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "nc", def: printing(NEGOTIATION), owner: P1, zone: "hand" },
      { key: "keep", def: character({ name: "Kept In Hand" }), owner: P1, zone: "hand" },
      ...fillers("a", 6, P1, "deck"),
      ...fillers("b", 6, P2, "deck"),
      ...bank("greed", o.p1 ?? 4, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...bank("greed", o.p2 ?? 4, P2)
    ]
  });
}

/** Plays Negotiation Ceremonies and answers each pay prompt from `script` (missing = don't pay). */
function negotiate(script: boolean[], o: { p1?: number; p2?: number } = {}) {
  const b = negoBoard(o);
  const deck1 = deckOf(b.engine, P1);
  const deck2 = deckOf(b.engine, P2);
  const hand1 = handOf(b.engine, P1);
  const hand2 = handOf(b.engine, P2);
  const ready1 = readyResources(b.engine, P1);
  const ready2 = readyResources(b.engine, P2);
  const asked: string[] = [];
  let i = 0;
  play(b.engine, P1, b.id("nc"));
  drain(b.engine, (pc) => {
    if (pc.kind === "alternatingPay") {
      asked.push(pc.playerId);
      return { kind: "alternatingPay", pay: script[i++] ?? false };
    }
    return declineAll(pc);
  });
  assert.equal(b.engine.state.pendingChoice, undefined);
  return {
    ...b,
    asked,
    spent1: ready1 - readyResources(b.engine, P1),
    spent2: ready2 - readyResources(b.engine, P2),
    drew1: handOf(b.engine, P1).filter((c) => !hand1.includes(c)),
    drew2: handOf(b.engine, P2).filter((c) => !hand2.includes(c)),
    deck1,
    deck2,
    hand1,
    hand2
  };
}

clause(NEGOTIATION, "0:ability", "is played for cost 0 with [G][G] (refused without the threshold) and the tactic goes to the discard pile", () => {
  const ok = negoBoard();
  play(ok.engine, P1, ok.id("nc"));
  drain(ok.engine, declineAll);
  assert.equal(zoneOf(ok.engine, ok.id("nc")), "discard");
  const noThreshold = negoBoard({ p1: 0, rage: 4 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("nc")), "four resources but no [G]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("nc")), "hand");
  const oneGreed = negoBoard({ p1: 1, rage: 3 });
  refused(() => playRaw(oneGreed.engine, P1, oneGreed.id("nc")), "only one [G] of the [G][G] threshold");
  assert.equal(zoneOf(oneGreed.engine, oneGreed.id("nc")), "hand");
});

clause(NEGOTIATION, "0:ability", "you pay 1, the opponent pays 1, you pay 1, the opponent stops: you paid 2 and draw 2, they paid 1 and draw 1", () => {
  const r = negotiate([true, true, true, false]);
  assert.deepEqual(r.asked, [P1, P2, P1, P2], "the payments alternate, starting with you");
  assert.equal(r.spent1, 2, "you paid 2 resources");
  assert.equal(r.spent2, 1, "the opponent paid 1 resource");
  assert.deepEqual(r.drew1, r.deck1.slice(0, 2), "you draw the top 2 of your deck");
  assert.deepEqual(r.drew2, r.deck2.slice(0, 1), "the opponent draws the top 1 of their deck");
  assert.deepEqual(deckOf(r.engine, P1), r.deck1.slice(2));
  assert.deepEqual(deckOf(r.engine, P2), r.deck2.slice(1));
});

clause(NEGOTIATION, "0:ability", "you decline to pay at once: nobody pays and nobody draws", () => {
  const r = negotiate([false]);
  assert.deepEqual(r.asked, [P1], "the opponent is never asked");
  assert.equal(r.spent1, 0);
  assert.equal(r.spent2, 0);
  assert.deepEqual(r.drew1, []);
  assert.deepEqual(r.drew2, []);
  assert.equal(zoneOf(r.engine, r.id("nc")), "discard");
});

clause(NEGOTIATION, "0:ability", "you pay 1 and the opponent declines: you draw 1, they draw 0 and pay nothing", () => {
  const r = negotiate([true, false]);
  assert.deepEqual(r.asked, [P1, P2]);
  assert.equal(r.spent1, 1);
  assert.equal(r.spent2, 0);
  assert.deepEqual(r.drew1, r.deck1.slice(0, 1));
  assert.deepEqual(r.drew2, []);
});

clause(NEGOTIATION, "0:ability", "you pay, the opponent pays, you stop: each paid 1 and each draws 1", () => {
  const r = negotiate([true, true, false]);
  assert.deepEqual(r.asked, [P1, P2, P1], "the loop ends when you do not pay again");
  assert.equal(r.spent1, 1);
  assert.equal(r.spent2, 1);
  assert.deepEqual(r.drew1, r.deck1.slice(0, 1));
  assert.deepEqual(r.drew2, r.deck2.slice(0, 1));
});

clause(NEGOTIATION, "0:ability", "the loop keeps repeating: 3 payments by you and 2 by the opponent draw 3 and 2", () => {
  const r = negotiate([true, true, true, true, true, false]);
  assert.deepEqual(r.asked, [P1, P2, P1, P2, P1, P2]);
  assert.equal(r.spent1, 3);
  assert.equal(r.spent2, 2);
  assert.deepEqual(r.drew1, r.deck1.slice(0, 3));
  assert.deepEqual(r.drew2, r.deck2.slice(0, 2));
});

clause(NEGOTIATION, "0:ability", "if you run out of resources the loop ends: you can pay at most what you have", () => {
  const r = negotiate([true, true, true, true, true, true, true, true], { p1: 2, p2: 4 });
  assert.equal(r.spent1, 2, "you can only pay the 2 resources you have");
  assert.equal(r.spent2, 2, "the opponent matched each payment");
  assert.equal(readyResources(r.engine, P1), 0);
  assert.equal(r.drew1.length, 2);
  assert.equal(r.drew2.length, 2);
});

clause(NEGOTIATION, "0:ability", "if the opponent has no resource to pay, the loop ends and only you draw", () => {
  const r = negotiate([true, true, true, true], { p1: 4, p2: 0 });
  assert.equal(r.spent1, 1, "you paid once");
  assert.equal(r.spent2, 0);
  assert.equal(readyResources(r.engine, P2), 0, "the opponent never goes below nothing");
  assert.equal(r.drew1.length, 1);
  assert.equal(r.drew2.length, 0);
});

clause(NEGOTIATION, "0:ability", "each payment really spends a resource immediately, and the prompts go to the right player", () => {
  const b = negoBoard();
  play(b.engine, P1, b.id("nc"));
  assert.equal(pending(b.engine)?.kind, "alternatingPay");
  assert.equal(pending(b.engine)?.playerId, P1, "you are asked first");
  const r1 = readyResources(b.engine, P1);
  const r2 = readyResources(b.engine, P2);
  answerPending(b.engine, "alternatingPay", { pay: true });
  assert.equal(readyResources(b.engine, P1), r1 - 1, "your payment is spent");
  assert.equal(pending(b.engine)?.kind, "alternatingPay");
  assert.equal(pending(b.engine)?.playerId, P2, "then the opponent is asked");
  assert.equal(readyResources(b.engine, P2), r2, "before they pay");
  answerPending(b.engine, "alternatingPay", { pay: true });
  assert.equal(readyResources(b.engine, P2), r2 - 1, "their payment is spent");
  assert.equal(pending(b.engine)?.playerId, P1, "and it is back to you");
  answerPending(b.engine, "alternatingPay", { pay: false });
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(NEGOTIATION, "0:ability", "the pay loop is the tactic's COST: it is asked while the tactic is being played, before the opponent can respond", () => {
  const b = negoBoard();
  playRaw(b.engine, P1, b.id("nc"));
  assert.equal(pending(b.engine)?.kind, "alternatingPay", "the cost loop opens as the tactic is played");
  assert.equal(pending(b.engine)?.playerId, P1);
});

// =====================================================================================================
// Pinguid Bodyguard -- character, cost 6, [G][G], 3/3/4, MERCENARY MAU
//   If this card attacks, restore it at the end of the battle. / This card can only attack once each turn.
//   PROTECT -- COST: Deplete this card. Pick a character. EFFECT: This turn, the character gains 2 life.
// =====================================================================================================

type Target = { type: "faction"; playerId: Player };
const AT_P2: Target = { type: "faction", playerId: P2 };

function pbBoard(o: { turn?: number; active?: Player; pbDef?: CardDefinition; pbZone?: "hand" | "play"; greed?: number; rage?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    ...(o.turn !== undefined ? { turn: o.turn } : {}),
    ...(o.active !== undefined ? { activePlayerId: o.active } : {}),
    cards: [
      { key: "pb", def: o.pbDef ?? printing(BODYGUARD), owner: P1, zone: o.pbZone ?? "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 6 }), owner: P2, zone: "play" },
      { key: "brute", def: character({ name: "Brute", strength: 6, life: 8 }), owner: P2, zone: "play" },
      { key: "itm", def: item({ name: "An Item" }), owner: P1, zone: "play" },
      { key: "loc", def: location({ name: "A Location" }), owner: P2, zone: "play" },
      { key: "inhand", def: character({ name: "In Hand", life: 3 }), owner: P1, zone: "hand" },
      { key: "gone", def: character({ name: "Gone", life: 3 }), owner: P1, zone: "discard" },
      ...bank("greed", o.greed ?? 0, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.extra ?? [])
    ]
  });
}
/** The Bodyguard's own definition minus the "can only attack once each turn" restriction (a control for the once-per-turn tests). */
function bodyguardWithoutLimit(): CardDefinition {
  const def = printing(BODYGUARD);
  return { ...def, behavior: { ...def.behavior, abilities: (def.behavior?.abilities ?? []).filter((a) => a.id !== "pb-limit") } } as CardDefinition;
}

clause(BODYGUARD, "0:rule", "is deployed for its printed cost of 6 with [G][G]: refused one resource short and without the threshold", () => {
  const ok = pbBoard({ pbZone: "hand", greed: 6 });
  play(ok.engine, P1, ok.id("pb"));
  assert.equal(zoneOf(ok.engine, ok.id("pb")), "play");
  assert.deepEqual([ok.engine.getStat(ok.id("pb"), "strength"), ok.engine.getStat(ok.id("pb"), "speed"), ok.engine.getStat(ok.id("pb"), "life")], [3, 3, 4], "printed strength / speed / life");
  assert.equal(readyResources(ok.engine, P1), 0, "all 6 resources were spent");
  const short = pbBoard({ pbZone: "hand", greed: 5 });
  refused(() => playRaw(short.engine, P1, short.id("pb")), "5 resources is one short of cost 6");
  assert.equal(zoneOf(short.engine, short.id("pb")), "hand");
  const noThreshold = pbBoard({ pbZone: "hand", greed: 1, rage: 5 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("pb")), "6 resources but only one [G]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("pb")), "hand");
});

clause(BODYGUARD, "0:rule", "if it attacks it is restored (ready again) at the end of the battle, while an ordinary attacker stays depleted", () => {
  const { engine, id } = pbBoard();
  declareAttackBy(engine, P1, [id("pb"), id("ally")], AT_P2);
  declareBlockers(engine, P2, []);
  finishBattle(engine);
  assert.equal(isDepleted(engine, id("ally")), true, "control: an ordinary survivor of the attack is depleted");
  assert.equal(isDepleted(engine, id("pb")), false, "the Bodyguard was restored at the end of the battle");
});

clause(BODYGUARD, "0:rule", "the restore happens at the END of the battle, not when the attack is declared", () => {
  const { engine, id } = pbBoard();
  declareAttackBy(engine, P1, [id("pb")], AT_P2);
  assert.ok(engine.state.battle, "the battle is under way");
  assert.equal(isDepleted(engine, id("pb")), true, "attacking depletes it while the battle is on");
  declareBlockers(engine, P2, []);
  finishBattle(engine);
  assert.equal(isDepleted(engine, id("pb")), false, "restored once the battle ended");
});

clause(BODYGUARD, "0:rule", "if it attacks and is blocked but survives, it is still restored (and keeps its damage)", () => {
  const { engine, id } = pbBoard();
  fightThrough(engine, P1, [id("pb")], AT_P2, [id("foe")]);
  assert.equal(zoneOf(engine, id("pb")), "play", "the Bodyguard survives a 1-strength blocker");
  assert.equal(engine.state.cards[id("pb")].damage, 1, "it took the blocker's 1 damage (restore does not heal)");
  assert.equal(isDepleted(engine, id("pb")), false, "restored");
});

clause(BODYGUARD, "0:rule", "if it attacks and dies in the battle there is nothing to restore (it goes to the discard pile)", () => {
  const { engine, id } = pbBoard();
  fightThrough(engine, P1, [id("pb")], AT_P2, [id("brute")]);
  assert.equal(zoneOf(engine, id("pb")), "discard");
});

clause(BODYGUARD, "0:rule", "the restore is for ATTACKING only: when it blocks, it ends the battle depleted like any other blocker", () => {
  const { engine, id } = pbBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "att1", def: character({ name: "Att1", strength: 1, life: 6 }), owner: P2, zone: "play" }]
  });
  declareAttackBy(engine, P2, [id("foe")], { type: "faction", playerId: P1 });
  declareBlockers(engine, P1, [id("pb")]);
  finishBattle(engine);
  assert.equal(zoneOf(engine, id("pb")), "play");
  assert.equal(isDepleted(engine, id("foe")), true, "control: the attacker is depleted");
  assert.equal(isDepleted(engine, id("pb")), true, "blocking is not attacking: no restore");
});

clause(BODYGUARD, "0:rule", "the restore is about THIS card attacking: when another character attacks, a depleted Bodyguard at home stays depleted", () => {
  const { engine, id } = pbBoard();
  activate(engine, P1, id("pb"), "pb-protect", { selected: { c: [id("ally")] } });
  assert.equal(isDepleted(engine, id("pb")), true, "depleted by PROTECT");
  fightThrough(engine, P1, [id("ally")], AT_P2, []);
  assert.equal(isDepleted(engine, id("ally")), true, "control: the attacker is depleted");
  assert.equal(isDepleted(engine, id("pb")), true, "still depleted: it did not attack");
});

clause(BODYGUARD, "1:rule", "can attack once each turn: after the first battle (and its restore) a second attack in the same turn is refused", () => {
  const { engine, id } = pbBoard();
  fightThrough(engine, P1, [id("pb")], AT_P2, []);
  assert.equal(isDepleted(engine, id("pb")), false, "ready again");
  refused(() => declareAttackBy(engine, P1, [id("pb")], AT_P2), "a second attack by the Bodyguard this turn");
  assert.equal(engine.state.battle, undefined, "no battle started");
});

clause(BODYGUARD, "1:rule", "control: without the 'once each turn' text the same restored Bodyguard CAN attack a second time", () => {
  const { engine, id } = pbBoard({ pbDef: bodyguardWithoutLimit() });
  fightThrough(engine, P1, [id("pb")], AT_P2, []);
  assert.equal(isDepleted(engine, id("pb")), false, "ready again");
  declareAttackBy(engine, P1, [id("pb")], AT_P2);
  assert.ok(engine.state.battle, "a second battle starts");
});

clause(BODYGUARD, "1:rule", "attacking in a party counts as its attack for the turn: it cannot attack again alone", () => {
  const { engine, id } = pbBoard();
  fightThrough(engine, P1, [id("pb"), id("ally")], AT_P2, []);
  refused(() => declareAttackBy(engine, P1, [id("pb")], AT_P2), "second attack");
  assert.equal(engine.state.battle, undefined);
});

clause(BODYGUARD, "1:rule", "the limit is per turn: it can attack again on its controller's next turn", () => {
  const { engine, id } = pbBoard();
  fightThrough(engine, P1, [id("pb")], AT_P2, []);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1, "back to the Bodyguard's controller");
  declareAttackBy(engine, P1, [id("pb")], AT_P2);
  assert.ok(engine.state.battle, "the Bodyguard attacks again on the new turn");
});

function protectBoard() {
  return pbBoard({ greed: 0 });
}

function protects(target: string, base: number) {
  const { engine, id } = protectBoard();
  const others = ["ally", "foe", "pb"].filter((k) => k !== target);
  const baseline = Object.fromEntries(others.map((k) => [k, engine.getStat(id(k), "life")]));
  activate(engine, P1, id("pb"), "pb-protect", { selected: { c: [id(target)] } });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(isDepleted(engine, id("pb")), true, "COST: the Bodyguard is depleted");
  assert.equal(engine.getStat(id(target), "life"), base + 2, `${target} gains 2 life`);
  for (const k of others) assert.equal(engine.getStat(id(k), "life"), baseline[k], `${k} is unaffected`);
  endTurn(engine, P1);
  assert.equal(engine.getStat(id(target), "life"), base, "the bonus lasts only this turn");
}
clause(BODYGUARD, "2:ability:pb-protect", "PROTECT: depletes the Bodyguard; your character gains 2 life this turn", () => protects("ally", 3));
clause(BODYGUARD, "2:ability:pb-protect", "PROTECT: an opponent's character can be picked too (gains 2 life this turn)", () => protects("foe", 6));
clause(BODYGUARD, "2:ability:pb-protect", "PROTECT: the Bodyguard may pick itself (4 life becomes 6 this turn)", () => protects("pb", 4));

clause(BODYGUARD, "2:ability:pb-protect", "PROTECT: only a character in play can be picked", () => {
  const { engine, id } = protectBoard();
  for (const bad of ["itm", "loc", "inhand", "gone"]) {
    refused(() => activate(engine, P1, id("pb"), "pb-protect", { selected: { c: [id(bad)] } }), `${bad} is not a character in play`);
    assert.equal(isDepleted(engine, id("pb")), false, `${bad}: the cost was not paid`);
  }
  refused(() => activate(engine, P1, id("pb"), "pb-protect", { selected: { c: [answerFaction(engine, P1)] } }), "a Faction is not a character");
  refused(() => activate(engine, P1, id("pb"), "pb-protect", { selected: { c: [id("ally"), id("foe")] } }), "exactly one character");
  activate(engine, P1, id("pb"), "pb-protect", { selected: { c: [id("ally")] } });
  assert.equal(engine.getStat(id("ally"), "life"), 5, "control: a character is accepted");
});

clause(BODYGUARD, "2:ability:pb-protect", "PROTECT: cannot be used while the Bodyguard is depleted (the cost)", () => {
  const { engine, id } = protectBoard();
  engine.state.cards[id("pb")].depleted = true;
  refused(() => activate(engine, P1, id("pb"), "pb-protect", { selected: { c: [id("ally")] } }), "already depleted");
  assert.equal(engine.getStat(id("ally"), "life"), 3);
  engine.state.cards[id("pb")].depleted = false;
  activate(engine, P1, id("pb"), "pb-protect", { selected: { c: [id("ally")] } });
  assert.equal(engine.getStat(id("ally"), "life"), 5, "control: works when ready");
});

clause(BODYGUARD, "2:ability:pb-protect", "PROTECT: after an attack the restored Bodyguard can use it, and it is depleted again", () => {
  const { engine, id } = protectBoard();
  fightThrough(engine, P1, [id("pb")], AT_P2, []);
  assert.equal(isDepleted(engine, id("pb")), false);
  activate(engine, P1, id("pb"), "pb-protect", { selected: { c: [id("ally")] } });
  assert.equal(isDepleted(engine, id("pb")), true);
  assert.equal(engine.getStat(id("ally"), "life"), 5);
});

// =====================================================================================================
// Purloinering Pirate -- character, cost 3, [G], 2/3/2, PIRATE
//   This card gains 1 strength and 1 life for each token on it.
//   PUSH OVERBOARD AND LOOT -- COST: Pay 1. Destroy a character you own. EFFECT: Put a token on this card.
// =====================================================================================================

const PUSH = "purloinering-pirate-push-overboard";

function pirateBoard(o: { tokens?: number; banks?: number; rage?: number; zone?: "hand" | "play"; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "pp", def: printing(PIRATE), owner: P1, zone: o.zone ?? "play", ...(o.tokens ? { counters: { token: o.tokens } } : {}) },
      { key: "v1", def: character({ name: "Crew One", strength: 1, life: 1 }), owner: P1, zone: "play" },
      { key: "v2", def: character({ name: "Crew Two", strength: 1, life: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 1 }), owner: P2, zone: "play" },
      { key: "lent", def: character({ name: "Lent To Me", strength: 1, life: 1 }), owner: P2, zone: "play", controller: P1 },
      { key: "stolen", def: character({ name: "Stolen From Me", strength: 1, life: 1 }), owner: P1, zone: "play", controller: P2 },
      { key: "itm", def: item({ name: "An Item" }), owner: P1, zone: "play" },
      { key: "inhand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" },
      { key: "gone", def: character({ name: "Gone" }), owner: P1, zone: "discard" },
      ...bank("greed", o.banks ?? 3, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.extra ?? [])
    ]
  });
}

clause(PIRATE, "0:rule", "is deployed for its printed cost of 3 with [G]: refused one resource short and without the threshold", () => {
  const ok = pirateBoard({ zone: "hand", banks: 3 });
  play(ok.engine, P1, ok.id("pp"));
  assert.equal(zoneOf(ok.engine, ok.id("pp")), "play");
  assert.deepEqual([ok.engine.getStat(ok.id("pp"), "strength"), ok.engine.getStat(ok.id("pp"), "speed"), ok.engine.getStat(ok.id("pp"), "life")], [2, 3, 2], "printed strength / speed / life");
  assert.equal(readyResources(ok.engine, P1), 0, "all 3 resources were spent");
  const short = pirateBoard({ zone: "hand", banks: 2 });
  refused(() => playRaw(short.engine, P1, short.id("pp")), "2 resources is one short of cost 3");
  assert.equal(zoneOf(short.engine, short.id("pp")), "hand");
  const noThreshold = pirateBoard({ zone: "hand", banks: 0, rage: 3 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("pp")), "3 resources but no [G]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("pp")), "hand");
  const oneGreed = pirateBoard({ zone: "hand", banks: 1, rage: 2 });
  play(oneGreed.engine, P1, oneGreed.id("pp"));
  assert.equal(zoneOf(oneGreed.engine, oneGreed.id("pp")), "play", "the threshold is a single [G]: one Greed plus two other resources is enough");
});

function pirateStats(tokens: number) {
  const { engine, id } = pirateBoard({ tokens });
  assert.equal(engine.getStat(id("pp"), "strength"), 2 + tokens, `strength 2 + ${tokens}`);
  assert.equal(engine.getStat(id("pp"), "life"), 2 + tokens, `life 2 + ${tokens}`);
  assert.equal(engine.getStat(id("pp"), "speed"), 3, "speed is not affected");
}
clause(PIRATE, "0:rule", "with no tokens it is its printed 2 strength / 2 life", () => pirateStats(0));
clause(PIRATE, "0:rule", "with 1 token it gains 1 strength and 1 life (3 / 3)", () => pirateStats(1));
clause(PIRATE, "0:rule", "with 3 tokens it gains 3 strength and 3 life (5 / 5)", () => pirateStats(3));

clause(PIRATE, "0:rule", "only tokens ON THIS CARD count: other cards' tokens (even another Pirate's) and other counter kinds do not", () => {
  const { engine, id } = pirateBoard({
    tokens: 1,
    extra: [
      { key: "pp2", def: printing(PIRATE), owner: P1, zone: "play", counters: { token: 4 } },
      { key: "tok", def: character({ name: "Token Holder", strength: 2, life: 2 }), owner: P1, zone: "play", counters: { token: 3 } },
      { key: "oth", def: printing(PIRATE), owner: P2, zone: "play", counters: { gold: 5 } }
    ]
  });
  assert.equal(engine.getStat(id("pp"), "strength"), 3, "1 token: 3 strength");
  assert.equal(engine.getStat(id("pp"), "life"), 3);
  assert.equal(engine.getStat(id("pp2"), "strength"), 6, "the other Pirate reads its own 4 tokens");
  assert.equal(engine.getStat(id("pp2"), "life"), 6);
  assert.equal(engine.getStat(id("oth"), "strength"), 2, "a non-token counter adds nothing");
  assert.equal(engine.getStat(id("oth"), "life"), 2);
  assert.equal(engine.getStat(id("tok"), "strength"), 2, "a card with tokens but no Pirate text is unchanged (printed 2 strength)");
});

clause(PIRATE, "0:rule", "the bonus tracks the tokens as they change, and a token on a Pirate with damage keeps it alive", () => {
  const { engine, id } = pirateBoard({ tokens: 2, extra: [] });
  engine.state.cards[id("pp")].damage = 3;
  assert.equal(engine.getStat(id("pp"), "life"), 4);
  assert.equal(zoneOf(engine, id("pp")), "play");
  engine.state.cards[id("pp")].counters = { token: 0 };
  assert.equal(engine.getStat(id("pp"), "life"), 2, "without tokens, back to the printed 2");
  assert.equal(engine.getStat(id("pp"), "strength"), 2);
});

function pushOverboard(victim: string) {
  const { engine, id } = pirateBoard();
  const ready = readyResources(engine, P1);
  activate(engine, P1, id("pp"), PUSH, { selected: { v: [id(victim)] } });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(readyResources(engine, P1), ready - 1, "COST: 1 resource was paid");
  assert.equal(zoneOf(engine, id(victim)), "discard", "COST: the character was destroyed");
  assert.equal(tokensOn(engine, id("pp")), 1, "EFFECT: a token was put on the Pirate");
  assert.equal(engine.getStat(id("pp"), "strength"), 3);
  assert.equal(engine.getStat(id("pp"), "life"), 3);
  return { engine, id };
}
clause(PIRATE, "1:ability:purloinering-pirate-push-overboard", "PUSH OVERBOARD AND LOOT: pay 1, destroy a character you own, put a token on the Pirate", () => {
  const { engine, id } = pushOverboard("v1");
  assert.equal(zoneOf(engine, id("v2")), "play", "the other crew member is untouched");
  assert.equal(zoneOf(engine, id("pp")), "play");
});

clause(PIRATE, "1:ability:purloinering-pirate-push-overboard", "PUSH OVERBOARD AND LOOT: a character you own but an opponent controls can be destroyed (you OWN it)", () => {
  const { engine, id } = pushOverboard("stolen");
  assert.equal(zoneOf(engine, id("lent")), "play");
});

clause(PIRATE, "1:ability:purloinering-pirate-push-overboard", "PUSH OVERBOARD AND LOOT: the Pirate may destroy itself (it is a character you own); the cost is still paid", () => {
  const { engine, id } = pirateBoard();
  const ready = readyResources(engine, P1);
  activate(engine, P1, id("pp"), PUSH, { selected: { v: [id("pp")] } });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(readyResources(engine, P1), ready - 1, "1 resource paid");
  assert.equal(zoneOf(engine, id("pp")), "discard", "the Pirate destroyed itself");
});

clause(PIRATE, "1:ability:purloinering-pirate-push-overboard", "PUSH OVERBOARD AND LOOT: when the Pirate destroys itself the token has nowhere to go (CR 409.2: tokens disappear when the card leaves play): it ends in the discard pile with no tokens", () => {
  const { engine, id } = pirateBoard();
  activate(engine, P1, id("pp"), PUSH, { selected: { v: [id("pp")] } });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("pp")), "discard");
  assert.equal(tokensOn(engine, id("pp")), 0, "the token was put on a card that had already left play, so it disappears");
  assert.equal(engine.getStat(id("pp"), "strength"), 2, "a card that left play reads printed stats");
  for (const key of ["v1", "v2"]) assert.equal(tokensOn(engine, id(key)), 0, `no token landed on ${key}`);
});

clause(PIRATE, "1:ability:purloinering-pirate-push-overboard", "PUSH OVERBOARD AND LOOT: only a character YOU OWN in play (not the opponent's, one you merely control, an item, a card in hand or discard)", () => {
  const { engine, id } = pirateBoard();
  const ready = readyResources(engine, P1);
  for (const bad of ["foe", "lent", "itm", "inhand", "gone"]) {
    refused(() => activate(engine, P1, id("pp"), PUSH, { selected: { v: [id(bad)] } }), `${bad} is not a character you own in play`);
    assert.equal(readyResources(engine, P1), ready, `${bad}: no resource was paid`);
    assert.equal(tokensOn(engine, id("pp")), 0, `${bad}: no token`);
  }
  assert.equal(zoneOf(engine, id("foe")), "play");
  assert.equal(zoneOf(engine, id("lent")), "play");
  assert.equal(zoneOf(engine, id("itm")), "play");
  refused(() => activate(engine, P1, id("pp"), PUSH, { selected: { v: [id("v1"), id("v2")] } }), "exactly one character is destroyed");
  activate(engine, P1, id("pp"), PUSH, { selected: { v: [id("v1")] } });
  assert.equal(zoneOf(engine, id("v1")), "discard", "control: a character you own is accepted");
});

clause(PIRATE, "1:ability:purloinering-pirate-push-overboard", "PUSH OVERBOARD AND LOOT: refused without a resource to pay (nothing destroyed, no token)", () => {
  const { engine, id } = pirateBoard({ banks: 0 });
  assert.equal(readyResources(engine, P1), 0);
  refused(() => activate(engine, P1, id("pp"), PUSH, { selected: { v: [id("v1")] } }), "no resource to pay");
  assert.equal(zoneOf(engine, id("v1")), "play");
  assert.equal(tokensOn(engine, id("pp")), 0);
  const one = pirateBoard({ banks: 1 });
  activate(one.engine, P1, one.id("pp"), PUSH, { selected: { v: [one.id("v1")] } });
  assert.equal(tokensOn(one.engine, one.id("pp")), 1, "control: exactly 1 resource is enough");
  assert.equal(readyResources(one.engine, P1), 0);
});

clause(PIRATE, "1:ability:purloinering-pirate-push-overboard", "PUSH OVERBOARD AND LOOT: can be used repeatedly; each use adds a token (+1/+1) and costs 1 more", () => {
  const { engine, id } = pirateBoard();
  activate(engine, P1, id("pp"), PUSH, { selected: { v: [id("v1")] } });
  activate(engine, P1, id("pp"), PUSH, { selected: { v: [id("v2")] } });
  assert.equal(tokensOn(engine, id("pp")), 2);
  assert.equal(engine.getStat(id("pp"), "strength"), 4);
  assert.equal(engine.getStat(id("pp"), "life"), 4);
  assert.equal(readyResources(engine, P1), 1, "two payments of 1");
  assert.equal(zoneOf(engine, id("v2")), "discard");
});

// =====================================================================================================
// Recycling Scheme Facility -- location, cost 4, [G][G], structure 4
//   When this card enters play, you may draw a card.
//   If a character goes to a discard pile, any player may pay 4 to put that card on top of its owner's deck.
// =====================================================================================================

const itemKiller = tactic({
  name: "Item Killer",
  cost: 0,
  behavior: {
    abilities: [{ id: "ik", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
  }
});
const miller = item({
  name: "Miller",
  cost: 0,
  behavior: { abilities: [{ id: "mill", type: "activated", costs: [], effects: [{ type: "mill", player: "controller", count: 1 }] }] }
});
const shredder = item({
  name: "Shredder",
  cost: 0,
  behavior: {
    abilities: [{ id: "shred", type: "activated", costs: [{ type: "discard", id: "dc", player: "controller", selector: { owner: "self", zone: "hand", type: "character" }, count: 1 }], effects: [] }]
  }
});

function facBoard(o: { p1?: number; p2?: number; rsfZone?: "play" | "hand"; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "rsf", def: printing(FACILITY), owner: P1, zone: o.rsfZone ?? "play" },
      { key: "v1", def: character({ name: "Victim One" }), owner: P1, zone: "play" },
      { key: "lent", def: character({ name: "Lent To Me" }), owner: P2, zone: "play", controller: P1 },
      { key: "vo", def: character({ name: "Opp Victim" }), owner: P2, zone: "play" },
      { key: "vi", def: item({ name: "Doomed Item" }), owner: P1, zone: "play" },
      { key: "kt", def: killTactic(), owner: P1, zone: "hand" },
      { key: "ik", def: itemKiller, owner: P1, zone: "hand" },
      { key: "bt", def: bounceTactic(), owner: P1, zone: "hand" },
      ...fillers("a", 4, P1, "deck"),
      ...fillers("b", 4, P2, "deck"),
      ...bank("greed", o.p1 ?? 4, P1),
      ...bank("greed", o.p2 ?? 4, P2),
      ...(o.extra ?? [])
    ]
  });
}

clause(FACILITY, "0:rule", "is deployed for its printed cost of 4 with [G][G]: refused one resource short and without the threshold", () => {
  const ok = facBoard({ rsfZone: "hand", p1: 4 });
  play(ok.engine, P1, ok.id("rsf"));
  drain(ok.engine, declineAll);
  assert.equal(zoneOf(ok.engine, ok.id("rsf")), "play");
  assert.equal(ok.engine.getStat(ok.id("rsf"), "structure"), 4, "printed structure");
  assert.equal(readyResources(ok.engine, P1), 0, "all 4 resources were spent");
  const short = facBoard({ rsfZone: "hand", p1: 3 });
  refused(() => playRaw(short.engine, P1, short.id("rsf")), "3 resources is one short of cost 4");
  assert.equal(zoneOf(short.engine, short.id("rsf")), "hand");
  const noThreshold = facBoard({ rsfZone: "hand", p1: 1, extra: bank("rage", 3, P1) });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("rsf")), "4 resources but only one [G]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("rsf")), "hand");
});

function facilityDraw(accept: boolean) {
  const { engine, id } = facBoard({ rsfZone: "hand" });
  const deckBefore = deckOf(engine, P1);
  const handBefore = handOf(engine, P1);
  play(engine, P1, id("rsf"));
  assert.equal(pending(engine)?.kind, "chooserSelectsOption", "entering play offers the draw");
  assert.equal(pending(engine)?.playerId, P1);
  answerPending(engine, "chooserSelectsOption", { index: optionIndex(engine, accept ? /draw/i : /decline|no/i) });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("rsf")), "play");
  if (accept) {
    assert.deepEqual(sorted(handOf(engine, P1)), sorted([...handBefore.filter((c) => c !== id("rsf")), deckBefore[0]]), "exactly the top card is drawn");
    assert.deepEqual(deckOf(engine, P1), deckBefore.slice(1));
  } else {
    assert.deepEqual(sorted(handOf(engine, P1)), sorted(handBefore.filter((c) => c !== id("rsf"))), "nothing drawn");
    assert.deepEqual(deckOf(engine, P1), deckBefore);
  }
}
clause(FACILITY, "0:rule", "ETB: you may draw a card: accepting draws exactly one (the top card)", () => facilityDraw(true));
clause(FACILITY, "0:rule", "ETB: you may draw a card: declining draws nothing", () => facilityDraw(false));

clause(FACILITY, "0:rule", "ETB: only fires when THIS card enters play (another card entering play offers no draw)", () => {
  const { engine, id } = facBoard({ extra: [{ key: "other", def: character({ name: "Other", cost: 0 }), owner: P1, zone: "hand" }] });
  const deckBefore = deckOf(engine, P1);
  play(engine, P1, id("other"));
  assert.equal(zoneOf(engine, id("other")), "play");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(engine, P1), deckBefore);
});

/** Destroys `victim` with the kill tactic and returns the engine with the recycling offer open. */
function killVictim(b: ReturnType<typeof facBoard>, victim: string) {
  play(b.engine, P1, b.id("kt"), { selected: { t: [b.id(victim)] } });
}

clause(FACILITY, "1:rule", "a destroyed character of yours: you pay 4 and it goes on top of your deck (not the discard pile)", () => {
  const b = facBoard();
  const deckBefore = deckOf(b.engine, P1);
  const r1 = readyResources(b.engine, P1);
  const r2 = readyResources(b.engine, P2);
  killVictim(b, "v1");
  assert.equal(pending(b.engine)?.kind, "anyPlayerMayPay", "the offer is made");
  assert.equal(pending(b.engine)?.playerId, P1, "to you first");
  answerPending(b.engine, "anyPlayerMayPay", { pay: true });
  assert.equal(b.engine.state.pendingChoice, undefined, "once someone paid, no one else is asked");
  assert.equal(readyResources(b.engine, P1), r1 - 4, "4 resources were paid by you");
  assert.equal(readyResources(b.engine, P2), r2, "the opponent paid nothing");
  assert.equal(zoneOf(b.engine, b.id("v1")), "deck");
  assert.deepEqual(deckOf(b.engine, P1), [b.id("v1"), ...deckBefore], "on TOP of your deck");
  assert.equal(discardOf(b.engine, P1).includes(b.id("v1")), false);
});

clause(FACILITY, "1:rule", "if you decline, the opponent (any player) may pay 4 instead: it still goes on top of ITS OWNER's deck", () => {
  const b = facBoard();
  const deck1 = deckOf(b.engine, P1);
  const deck2 = deckOf(b.engine, P2);
  const r1 = readyResources(b.engine, P1);
  const r2 = readyResources(b.engine, P2);
  killVictim(b, "v1");
  answerPending(b.engine, "anyPlayerMayPay", { pay: false });
  assert.equal(pending(b.engine)?.kind, "anyPlayerMayPay", "the opponent is offered it next");
  assert.equal(pending(b.engine)?.playerId, P2);
  answerPending(b.engine, "anyPlayerMayPay", { pay: true });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(readyResources(b.engine, P2), r2 - 4, "the opponent paid the 4");
  assert.equal(readyResources(b.engine, P1), r1, "you paid nothing");
  assert.deepEqual(deckOf(b.engine, P1), [b.id("v1"), ...deck1], "the card goes on top of its OWNER's (your) deck");
  assert.deepEqual(deckOf(b.engine, P2), deck2, "not the payer's deck");
});

clause(FACILITY, "1:rule", "if nobody pays, the character stays in the discard pile and no resource is spent", () => {
  const b = facBoard();
  const deck1 = deckOf(b.engine, P1);
  const r1 = readyResources(b.engine, P1);
  const r2 = readyResources(b.engine, P2);
  killVictim(b, "v1");
  answerPending(b.engine, "anyPlayerMayPay", { pay: false });
  answerPending(b.engine, "anyPlayerMayPay", { pay: false });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("v1")), "discard");
  assert.deepEqual(deckOf(b.engine, P1), deck1);
  assert.equal(readyResources(b.engine, P1), r1);
  assert.equal(readyResources(b.engine, P2), r2);
});

clause(FACILITY, "1:rule", "paying needs a full 4 resources: with 3 you cannot pay (3 vs the cost of 4), exactly 4 can", () => {
  const poor = facBoard({ p1: 3, p2: 0 });
  killVictim(poor, "v1");
  drain(poor.engine, () => ({ kind: "anyPlayerMayPay", pay: true }));
  assert.equal(zoneOf(poor.engine, poor.id("v1")), "discard", "nobody could pay 4");
  assert.equal(readyResources(poor.engine, P1), 3, "nothing spent");
  assert.equal(readyResources(poor.engine, P2), 0);
  const exact = facBoard({ p1: 4, p2: 0 });
  killVictim(exact, "v1");
  drain(exact.engine, () => ({ kind: "anyPlayerMayPay", pay: true }));
  assert.equal(zoneOf(exact.engine, exact.id("v1")), "deck", "control: exactly 4 is enough");
  assert.equal(readyResources(exact.engine, P1), 0);
});

clause(FACILITY, "1:rule", "an opponent's character that dies goes on top of the OPPONENT's deck, whoever pays (you here)", () => {
  const b = facBoard();
  const deck1 = deckOf(b.engine, P1);
  const deck2 = deckOf(b.engine, P2);
  killVictim(b, "vo");
  assert.equal(zoneOf(b.engine, b.id("vo")), "discard", "it went to its owner's discard pile first");
  answerPending(b.engine, "anyPlayerMayPay", { pay: true });
  assert.equal(readyResources(b.engine, P1), 0, "you paid 4");
  assert.deepEqual(deckOf(b.engine, P2), [b.id("vo"), ...deck2], "on top of ITS OWNER's deck");
  assert.deepEqual(deckOf(b.engine, P1), deck1);
});

clause(FACILITY, "1:rule", "a character you control but the opponent owns goes to, and recycles onto, its OWNER's deck", () => {
  const b = facBoard();
  const deck1 = deckOf(b.engine, P1);
  const deck2 = deckOf(b.engine, P2);
  killVictim(b, "lent");
  assert.equal(discardOf(b.engine, P2).includes(b.id("lent")), true, "it goes to its owner's discard pile");
  answerPending(b.engine, "anyPlayerMayPay", { pay: true });
  assert.deepEqual(deckOf(b.engine, P2), [b.id("lent"), ...deck2], "on top of its owner's deck");
  assert.deepEqual(deckOf(b.engine, P1), deck1, "not the controller's deck");
});

clause(FACILITY, "1:rule", "a character discarded from the hand (a cost) also goes to a discard pile and can be recycled", () => {
  const b = facBoard({ extra: [{ key: "sh", def: shredder, owner: P1, zone: "play" }, { key: "hc", def: character({ name: "Hand Char" }), owner: P1, zone: "hand" }] });
  const deck1 = deckOf(b.engine, P1);
  activate(b.engine, P1, b.id("sh"), "shred", { selected: { dc: [b.id("hc")] } });
  assert.equal(pending(b.engine)?.kind, "anyPlayerMayPay", "discarding a character from hand offers the recycling");
  answerPending(b.engine, "anyPlayerMayPay", { pay: true });
  assert.deepEqual(deckOf(b.engine, P1), [b.id("hc"), ...deck1]);
});

clause(FACILITY, "1:rule", "a character milled from the top of a deck to the discard pile can be recycled", () => {
  const b = facBoard({ extra: [{ key: "ml", def: miller, owner: P1, zone: "play" }, { key: "top", def: character({ name: "Top Char" }), owner: P1, zone: "deck" }] });
  const top = b.engine.state.players[P1].deck[0];
  activate(b.engine, P1, b.id("ml"), "mill");
  const milled = b.engine.state.players[P1].discard.includes(top);
  assert.equal(milled, true, "the top card was milled");
  assert.equal(pending(b.engine)?.kind, "anyPlayerMayPay", "a character reaching the discard pile from the deck offers the recycling");
  answerPending(b.engine, "anyPlayerMayPay", { pay: true });
  assert.equal(deckOf(b.engine, P1)[0], top);
});

clause(FACILITY, "1:rule", "only CHARACTERS: an item or a tactic going to the discard pile offers no recycling", () => {
  const b = facBoard();
  play(b.engine, P1, b.id("ik"), { selected: { t: [b.id("vi")] } });
  assert.equal(zoneOf(b.engine, b.id("vi")), "discard", "the item was destroyed");
  assert.equal(zoneOf(b.engine, b.id("ik")), "discard", "and the tactic went to the discard pile");
  assert.equal(b.engine.state.pendingChoice, undefined, "neither offers the recycling");
});

clause(FACILITY, "1:rule", "a character leaving play any other way than to a discard pile (back to the hand) offers nothing", () => {
  const b = facBoard();
  play(b.engine, P1, b.id("bt"), { selected: { t: [b.id("v1")] } });
  assert.equal(zoneOf(b.engine, b.id("v1")), "hand");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(FACILITY, "1:rule", "only works while the Facility is in play: a destroyed character offers nothing when it is in hand", () => {
  const b = facBoard({ rsfZone: "hand" });
  killVictim(b, "v1");
  assert.equal(zoneOf(b.engine, b.id("v1")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined, "no offer");
});
