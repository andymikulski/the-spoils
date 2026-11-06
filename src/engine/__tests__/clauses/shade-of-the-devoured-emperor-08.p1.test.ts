// Clause tests — batch shade-of-the-devoured-emperor-08, part p1 (groups 1-8, missing clauses only).
// Cards: Shade of the Devoured Emperor, Shriever Breeding Program, Skullcrush Steamroller,
// Super Shiny Caltrops of DOOM!, Thabbashite Warmonger, Ursine Assassin, Warbeast of Thabbash, Words of Glory.
import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  bank,
  character,
  developFaction,
  item,
  P1,
  P2,
  play,
  resolvePendingResponses,
  tactic,
  volition
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import type { CardDefinition, PlayerId, SpoilsEngine } from "../../../engine.js";
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import { declareAttackBy, declareAttackOpenWindow, finishBattle, fightThrough, playRaw } from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, readyResources, zoneOf } from "./_board.js";
import { endTurn, factionOf, spentResources } from "./_turn.js";

type Eng = SpoilsEngine;
const R = (n: number, owner: PlayerId = P1) => bank("rage", n, owner);
const V = (n: number, owner: PlayerId = P1) => volition(n, owner);
const handOf = (engine: Eng, p: PlayerId): string[] => engine.state.players[p].hand as unknown as string[];
const deckOf = (engine: Eng, p: PlayerId): string[] => engine.state.players[p].deck as unknown as string[];
const influenceOf = (engine: Eng, p: PlayerId): number => engine.state.players[p].influence;
const revealed = (engine: Eng): Array<{ cardIds: string[] }> =>
  engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed").map((entry) => entry.event as unknown as { cardIds: string[] });
const stats = (engine: Eng, id: string): number[] => [engine.getStat(id, "strength"), engine.getStat(id, "speed"), engine.getStat(id, "life")];
const isDepleted = (engine: Eng, id: string): boolean => !!engine.state.cards[id].depleted;
const AT_P2 = { type: "faction", playerId: P2 } as const;
const AT_P1 = { type: "faction", playerId: P1 } as const;

function seededRandom(): () => number {
  let s = 12345;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const unique = (name: string, designation: string, over: Partial<CardDefinition> = {}): CardDefinition =>
  character({ name, strength: 2, life: 3, speed: 2, unique: designation, ...over } as Partial<CardDefinition>);

// =====================================================================================================
// Shade of the Devoured Emperor — character (warlord, padamose emperor mau) · cost 2 · [V][V][V][V] · 0/0/1
// UNIQUE PADAMOSE -- At the end of an opponent's turn, you may remove this card from the game, then choose a
// player and search their deck for a UNIQUE JO, UNIQUE EUSTACE, UNIQUE PLUCK, UNIQUE RUDOLPHUS, or UNIQUE
// IGNATIOUS and reveal it. If you do, put it into play under your control. -- FLIP UP: 2 [V][V][V][V]
// =====================================================================================================
const SHADE = "506f383f-ef35-467b-8554-dd6b4b9729df";
const DESIGNATIONS = ["jo", "eustace", "pluck", "rudolphus", "ignatious"] as const;

function shadeBoard(o: { extra?: CardPlacement[]; zone?: CardPlacement["zone"]; faceDown?: boolean; controller?: PlayerId; owner?: PlayerId; random?: () => number; turnOf?: PlayerId } = {}) {
  const turnOf = o.turnOf ?? P2;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: turnOf === P1 ? 1 : 2,
    activePlayerId: turnOf,
    random: o.random,
    cards: [
      { key: "sh", def: printing(SHADE), owner: o.owner ?? P1, controller: o.controller, zone: o.zone ?? "play", faceDown: o.faceDown },
      ...(o.extra ?? [])
    ]
  });
}
type ShadeBoard = ReturnType<typeof shadeBoard>;

/** Decks for the search tests: Jo (P2's deck, unique jo) plus a mix of near-misses and filler. */
const searchDecks = (): CardPlacement[] => [
  { key: "jo", def: unique("Jo", "jo"), owner: P2, zone: "deck" },
  { key: "eu", def: unique("Eustace", "eustace"), owner: P2, zone: "deck" },
  { key: "plu", def: unique("Pluck", "pluck"), owner: P2, zone: "deck" },
  { key: "rudo", def: unique("Rudolphus", "rudolphus"), owner: P2, zone: "deck" },
  { key: "ign", def: unique("Ignatious", "ignatious"), owner: P2, zone: "deck" },
  { key: "other", def: unique("Someone Else", "someone else"), owner: P2, zone: "deck" },
  { key: "plainJo", def: character({ name: "Jo", strength: 1, life: 1, speed: 1 }), owner: P2, zone: "deck" },
  { key: "padamose", def: unique("Padamose Too", "padamose"), owner: P2, zone: "deck" },
  ...fillers("f", 6, P2, "deck"),
  { key: "myJo", def: unique("My Jo", "jo"), owner: P1, zone: "deck" },
  ...fillers("g", 6, P1, "deck"),
  { key: "handJo", def: unique("Hand Jo", "jo"), owner: P2, zone: "hand" },
  { key: "discJo", def: unique("Discard Jo", "jo"), owner: P2, zone: "discard" }
];

/** The opponent ends their turn; the trigger asks Shade's controller whether to remove it. Returns with the prompt open. */
function endOppTurn(b: ShadeBoard, ender: PlayerId = P2): void {
  endTurn(b.engine, ender);
}
const mayPayChoice = (b: ShadeBoard, pay: boolean, who: PlayerId = P1): void => {
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "mayPay", "the controller is asked whether to remove this card");
  assert.equal(pc?.playerId, who);
  answerPending(b.engine, "mayPay", { pay });
};
/** Accept the removal and reach the card-pick prompt. */
function reachSearch(b: ShadeBoard): void {
  endOppTurn(b);
  mayPayChoice(b, true);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the search prompt is open");
  assert.equal(pending(b.engine)?.playerId, P1, "Shade's controller searches");
}
/** "Choose a player and search their deck": the player (a faction pick) is chosen first -- the owner of `key`'s card, else `who`. */
const choosePlayer = (b: ShadeBoard, who: PlayerId): void => {
  const pc = pending(b.engine) as unknown as { declaration?: { selector?: { type?: string } } } | undefined;
  assert.equal(pc?.declaration?.selector?.type, "faction", "the first prompt chooses a player");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [factionOf(b.engine, who)] });
};
const pickCard = (b: ShadeBoard, key: string | undefined, who: PlayerId = P2): void => {
  choosePlayer(b, key ? b.engine.state.cards[b.id(key)].ownerId : who);
  if (pending(b.engine)) answerPending(b.engine, "chooserSelectsTarget", { selected: key ? [b.id(key)] : [] });
};

clause(SHADE, "0:unique", "deploys for 2 with [V][V][V][V]: printed 0 / 0 / 1, refused one icon short or without any [V]", () => {
  const build = (pay: CardPlacement[]) =>
    buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, cards: [{ key: "sh", def: printing(SHADE), owner: P1, zone: "hand" }, ...pay] });
  const ok = build(V(4));
  play(ok.engine, P1, ok.id("sh"));
  assert.equal(zoneOf(ok.engine, ok.id("sh")), "play");
  assert.deepEqual(stats(ok.engine, ok.id("sh")), [0, 0, 1], "printed strength / speed / life");
  assert.equal(readyResources(ok.engine, P1), 2, "paid exactly 2 of the 4 resources");
  const short = build(V(3));
  refused(() => playRaw(short.engine, P1, short.id("sh")), "only three [V]");
  assert.equal(zoneOf(short.engine, short.id("sh")), "hand");
  const moreButWrongIcons = build([...V(3), ...R(3)]);
  refused(() => playRaw(moreButWrongIcons.engine, P1, moreButWrongIcons.id("sh")), "plenty of resources, but only three [V]");
  const noIcons = build(R(5));
  refused(() => playRaw(noIcons.engine, P1, noIcons.id("sh")), "no [V] at all");
  const opp = build([...V(3), ...V(4, P2)]);
  refused(() => playRaw(opp.engine, P1, opp.id("sh")), "the opponent's [V] don't count");
});

clause(SHADE, "0:unique", "controlling a second Padamose makes you keep one: keeping either destroys the other", () => {
  for (const keep of ["old", "new"] as const) {
    const b = shadeBoard({ turnOf: P1, extra: [{ key: "sh2", def: printing(SHADE), owner: P1, zone: "hand" }, ...V(4)] });
    play(b.engine, P1, b.id("sh2"));
    const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
    assert.equal(pc.kind, "uniqueSurvivor");
    assert.equal(pc.playerId, P1, "the controller chooses");
    assert.deepEqual([...pc.candidates].sort(), [b.id("sh"), b.id("sh2")].sort());
    const kept = keep === "old" ? b.id("sh") : b.id("sh2");
    const lost = keep === "old" ? b.id("sh2") : b.id("sh");
    b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: kept } } as never);
    assert.equal(zoneOf(b.engine, kept), "play", `keep ${keep}`);
    assert.equal(zoneOf(b.engine, lost), "discard", `keep ${keep}: the other copy is destroyed`);
    assert.equal(b.engine.state.pendingChoice, undefined);
  }
});

clause(SHADE, "0:unique", "any other card with UNIQUE PADAMOSE is a duplicate; a different designation or no designation is not; the opponent may have their own", () => {
  const other = shadeBoard({ turnOf: P1, extra: [{ key: "pad", def: unique("Another Padamose", "padamose", { cost: 0 }), owner: P1, zone: "hand" }, ...V(4)] });
  play(other.engine, P1, other.id("pad"));
  assert.equal(pending(other.engine)?.kind, "uniqueSurvivor", "a different card with UNIQUE PADAMOSE alongside Shade is a duplicate");
  const fine = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "sh", def: printing(SHADE), owner: P1, zone: "hand" },
      { key: "jo", def: unique("Jo", "jo"), owner: P1, zone: "play" },
      { key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "play" },
      ...V(4)
    ]
  });
  play(fine.engine, P1, fine.id("sh"));
  assert.equal(fine.engine.state.pendingChoice, undefined, "no survivor choice for a different designation");
  assert.equal(zoneOf(fine.engine, fine.id("sh")), "play");
  const perPlayer = shadeBoard({ turnOf: P2, extra: [{ key: "sh2", def: printing(SHADE), owner: P2, zone: "hand" }, ...V(4, P2)] });
  play(perPlayer.engine, P2, perPlayer.id("sh2"));
  assert.equal(perPlayer.engine.state.pendingChoice, undefined, "the restriction is per player");
  assert.equal(zoneOf(perPlayer.engine, perPlayer.id("sh")), "play");
  assert.equal(zoneOf(perPlayer.engine, perPlayer.id("sh2")), "play");
});

// --- 1:rule — the end-of-opponent's-turn summon -------------------------------------------------------

clause(SHADE, "1:rule", "at the end of the opponent's turn I may remove Shade from the game, search, reveal a Jo from THEIR deck and put it into play under MY control (it stays theirs); their deck is shuffled", () => {
  const b = shadeBoard({ extra: searchDecks(), random: seededRandom() });
  const oppDeckBefore = [...deckOf(b.engine, P2)];
  const myDeckBefore = [...deckOf(b.engine, P1)];
  endOppTurn(b);
  assert.equal(zoneOf(b.engine, b.id("sh")), "play", "nothing happens until I say so");
  mayPayChoice(b, true);
  assert.equal(zoneOf(b.engine, b.id("sh")), "removed", "Shade was removed from the game");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  pickCard(b, "jo");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("jo")), "play");
  assert.equal(b.engine.state.cards[b.id("jo")].controllerId, P1, "under my control");
  assert.equal(b.engine.state.cards[b.id("jo")].ownerId, P2, "still owned by the opponent");
  assert.deepEqual(revealed(b.engine).map((r) => r.cardIds), [[b.id("jo")]], "the found card is revealed");
  const rest = oppDeckBefore.filter((c) => c !== b.id("jo"));
  assert.deepEqual([...deckOf(b.engine, P2)].sort(), [...rest].sort(), "only the found card left their deck");
  assert.notDeepEqual(deckOf(b.engine, P2), rest, "the searched deck is shuffled (CR 312.1)");
  assert.deepEqual(deckOf(b.engine, P1), myDeckBefore, "my own deck was not searched or shuffled");
  for (const k of ["eu", "plu", "rudo", "ign", "myJo"]) assert.equal(zoneOf(b.engine, b.id(k)), "deck", `only one card is taken (${k} stays)`);
  assert.equal(readyResources(b.engine, P1), 0, "put into play, not deployed: nothing paid");
});

clause(SHADE, "1:rule", "the five designations are each findable, in the opponent's deck or in my own", () => {
  for (const d of DESIGNATIONS) {
    for (const deckOwner of [P2, P1]) {
      const b = shadeBoard({
        random: seededRandom(),
        extra: [{ key: "t", def: unique(`T ${d}`, d), owner: deckOwner, zone: "deck" }, ...fillers("f", 4, P2, "deck"), ...fillers("g", 4, P1, "deck")]
      });
      const otherDeck = deckOwner === P2 ? P1 : P2;
      const otherBefore = [...deckOf(b.engine, otherDeck)];
      reachSearch(b);
      pickCard(b, "t");
      assert.equal(b.engine.state.pendingChoice, undefined, `${d}`);
      assert.equal(zoneOf(b.engine, b.id("t")), "play", `${d} from ${deckOwner}'s deck`);
      assert.equal(b.engine.state.cards[b.id("t")].controllerId, P1);
      assert.equal(b.engine.state.cards[b.id("t")].ownerId, deckOwner);
      assert.deepEqual(deckOf(b.engine, otherDeck), otherBefore, `${d}: the other deck is untouched`);
    }
  }
});

clause(SHADE, "1:rule", "the printed Jo, Eustace, Pluck, Rudolphus and Ignatious characters are all findable", () => {
  const real: Array<[string, string]> = [
    ["jo", "4e071253-4a43-404c-aad5-15aa1e953501"],
    ["eustace", "3f574bdd-e7b7-4757-a955-2a33d19a250d"],
    ["pluck", "f4ccc8f6-f59d-47f3-8972-48d83770de94"],
    ["rudolphus", "ae4f6e1e-19c6-4151-be5c-edc185640deb"],
    ["ignatious", "7b6a4bfc-b116-4695-a4d8-86f59e0b140c"]
  ];
  for (const [label, pid] of real) {
    const b = shadeBoard({ random: seededRandom(), extra: [{ key: "t", def: printing(pid), owner: P2, zone: "deck" }, ...fillers("f", 4, P2, "deck")] });
    reachSearch(b);
    pickCard(b, "t");
    drain(b.engine, declineAll);
    assert.equal(zoneOf(b.engine, b.id("t")), "play", `${label}: ${printing(pid).name}`);
    assert.equal(b.engine.state.cards[b.id("t")].controllerId, P1);
  }
});

clause(SHADE, "1:rule", "only a card of one of the five designations in a deck is a legal find: other designations, same-named plain cards, cards outside a deck, two cards", () => {
  const b = shadeBoard({ extra: searchDecks(), random: seededRandom() });
  reachSearch(b);
  choosePlayer(b, P1);
  const attempt = (...keys: string[]) => () => answerPending(b.engine, "chooserSelectsTarget", { selected: keys.map((k) => b.id(k)) });
  refused(attempt("jo"), "the chosen player is me: a Jo in the opponent's deck is not searched");
  refused(attempt("other"), "UNIQUE of a different designation");
  refused(attempt("plainJo"), "a plain card named Jo, no designation");
  refused(attempt("padamose"), "UNIQUE PADAMOSE is not on the list");
  refused(attempt("handJo"), "a Jo in a hand");
  refused(attempt("discJo"), "a Jo in a discard pile");
  refused(attempt("f0"), "a plain filler");
  refused(attempt("sh"), "Shade itself");
  refused(attempt("myJo", "padamose"), "two cards: it finds one");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the search is still open after refusals");
  assert.equal(zoneOf(b.engine, b.id("jo")), "deck");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("myJo")] });
  assert.equal(zoneOf(b.engine, b.id("myJo")), "play", "positive control: a Jo in my own deck is legal");
});

clause(SHADE, "1:rule", "I may fail the search: Shade is still removed, nothing enters play, nothing is revealed", () => {
  const b = shadeBoard({ extra: searchDecks(), random: seededRandom() });
  reachSearch(b);
  pickCard(b, undefined);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("sh")), "removed", "removing Shade was the first part: it is gone for good");
  for (const k of ["jo", "eu", "plu", "rudo", "ign", "myJo"]) assert.equal(zoneOf(b.engine, b.id(k)), "deck", `${k} stays in its deck`);
  assert.equal(revealed(b.engine).length, 0, "nothing revealed");
});

clause(SHADE, "1:rule", "with no matching card anywhere the search fails and Shade is still removed", () => {
  const b = shadeBoard({ extra: [...fillers("f", 5, P2, "deck"), ...fillers("g", 5, P1, "deck")] });
  const playBefore = [...b.engine.state.players[P1].play];
  endOppTurn(b);
  mayPayChoice(b, true);
  assert.equal(zoneOf(b.engine, b.id("sh")), "removed");
  if (pending(b.engine)) pickCard(b, undefined);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(b.engine.state.players[P1].play, playBefore.filter((c) => c !== b.id("sh")), "nothing came into play");
});

clause(SHADE, "1:rule", "declining the 'may': Shade stays in play, no search, nothing revealed, decks untouched", () => {
  const b = shadeBoard({ extra: searchDecks(), random: seededRandom() });
  const decks = [[...deckOf(b.engine, P1)], [...deckOf(b.engine, P2)]];
  endOppTurn(b);
  mayPayChoice(b, false);
  assert.equal(b.engine.state.pendingChoice, undefined, "no search prompt");
  assert.equal(zoneOf(b.engine, b.id("sh")), "play", "Shade is still in play");
  assert.equal(revealed(b.engine).length, 0);
  assert.deepEqual([deckOf(b.engine, P1), deckOf(b.engine, P2)], decks, "no deck was searched or shuffled");
  assert.equal(zoneOf(b.engine, b.id("jo")), "deck");
});

clause(SHADE, "1:rule", "only at the end of an OPPONENT's turn: ending my own turn does not trigger it", () => {
  const own = shadeBoard({ turnOf: P1, extra: searchDecks() });
  endTurn(own.engine, P1);
  assert.equal(own.engine.state.pendingChoice, undefined, "my own turn ending raises nothing");
  assert.equal(zoneOf(own.engine, own.id("sh")), "play");
  assert.equal(own.engine.state.activePlayerId, P2, "the turn passed");
  const opp = shadeBoard({ extra: searchDecks() });
  endTurn(opp.engine, P2);
  assert.equal(pending(opp.engine)?.kind, "mayPay", "positive control: the opponent's turn ending does");
});

clause(SHADE, "1:rule", "it is a rule of the card in play: in hand, in the discard pile or face-down as a resource it does nothing", () => {
  for (const [label, o] of [
    ["in hand", { zone: "hand" as const }],
    ["in the discard pile", { zone: "discard" as const }],
    ["face-down in play", { zone: "play" as const, faceDown: true }]
  ] as const) {
    const b = shadeBoard({ ...o, extra: searchDecks() });
    endTurn(b.engine, P2);
    assert.equal(b.engine.state.pendingChoice, undefined, `${label}: no prompt`);
    assert.notEqual(zoneOf(b.engine, b.id("sh")), "removed", label);
  }
});

clause(SHADE, "1:rule", "'you' is its controller: a Shade I own but the opponent controls asks THEM at the end of MY turn, and the find enters under THEIR control", () => {
  const b = shadeBoard({ turnOf: P1, owner: P1, controller: P2, extra: searchDecks(), random: seededRandom() });
  endTurn(b.engine, P1);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "mayPay");
  assert.equal(pc?.playerId, P2, "the controller is asked");
  answerPending(b.engine, "mayPay", { pay: true });
  assert.equal(pending(b.engine)?.playerId, P2, "the controller searches");
  pickCard(b, "myJo");
  assert.equal(zoneOf(b.engine, b.id("myJo")), "play");
  assert.equal(b.engine.state.cards[b.id("myJo")].controllerId, P2, "the find is under the Shade controller's control");
  assert.equal(b.engine.state.cards[b.id("myJo")].ownerId, P1);
  assert.equal(zoneOf(b.engine, b.id("sh")), "removed");
  // and not at the end of the controller's own turn
  const c = shadeBoard({ turnOf: P2, owner: P1, controller: P2, extra: searchDecks() });
  endTurn(c.engine, P2);
  assert.equal(c.engine.state.pendingChoice, undefined, "the controller's own turn ending does nothing");
});

clause(SHADE, "1:rule", "searching a deck shuffles it afterwards (CR 312.1) even when the search fails: the chosen player's deck is shuffled", () => {
  const b = shadeBoard({ extra: [...fillers("f", 8, P2, "deck"), ...fillers("g", 8, P1, "deck")], random: seededRandom() });
  const before = [[...deckOf(b.engine, P1)], [...deckOf(b.engine, P2)]];
  endOppTurn(b);
  mayPayChoice(b, true);
  if (pending(b.engine)) pickCard(b, undefined);
  assert.equal(b.engine.state.pendingChoice, undefined);
  const shuffledSomething = deckOf(b.engine, P1).join() !== before[0].join() || deckOf(b.engine, P2).join() !== before[1].join();
  assert.ok(shuffledSomething, "a deck was searched (and failed), so its owner must shuffle it");
});

clause(SHADE, "1:rule", "'choose a player and search their deck': the player is chosen first, so the first prompt cannot list cards from both decks at once", () => {
  const b = shadeBoard({ extra: searchDecks(), random: seededRandom() });
  endOppTurn(b);
  mayPayChoice(b, true);
  const pc = pending(b.engine) as unknown as { kind: string; declaration?: { selector?: { zone?: string; owner?: string } } };
  const spansBothDecks = pc.kind === "chooserSelectsTarget" && pc.declaration?.selector?.zone === "deck" && pc.declaration?.selector?.owner === undefined;
  assert.ok(!spansBothDecks, "the first prompt after removing Shade is already a card pick over every deck: no player was chosen");
});

// --- 2:flipUp — FLIP UP: 2 [V][V][V][V] ----------------------------------------------------------------

function flipBoard(o: { pay?: CardPlacement[]; turnOf?: PlayerId; extra?: CardPlacement[] } = {}) {
  const turnOf = o.turnOf ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: turnOf === P1 ? 1 : 2,
    activePlayerId: turnOf,
    cards: [{ key: "sh", def: printing(SHADE), owner: P1, zone: "play", faceDown: true }, ...(o.pay ?? V(4)), ...(o.extra ?? [])]
  });
}
const flipUp = (b: ReturnType<typeof flipBoard>, player: PlayerId = P1): void => {
  flipUpNow(b.engine, { type: "flipUp", playerId: player, cardId: b.id("sh"), selected: {}, variables: {} });
  resolvePendingResponses(b.engine);
};
const spentV = (n: number, owner: PlayerId = P1): CardPlacement[] => V(n, owner).map((p) => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

clause(SHADE, "2:flipUp", "flipping up a face-down Shade with 4 other [V] (its own does not count, CR 507.4b) pays exactly 2 and makes it a face-up 0 / 0 / 1 character", () => {
  const b = flipBoard({ pay: V(4) });
  assert.equal(readyResources(b.engine, P1), 5, "four face-down V + Shade itself");
  flipUp(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("sh")), "play");
  assert.equal(b.engine.state.cards[b.id("sh")].faceDown, false, "face-up");
  assert.deepEqual(stats(b.engine, b.id("sh")), [0, 0, 1], "printed strength / speed / life");
  assert.equal(readyResources(b.engine, P1), 2, "5 resources: 2 paid, and Shade is no longer a resource (5 - 2 - 1 = 2)");
});

clause(SHADE, "2:flipUp", "refused with fewer than four [V]: three (however many other icons), none, or only the opponent's", () => {
  const ok = flipBoard({ pay: [...V(4), ...R(3)] });
  flipUp(ok);
  assert.equal(ok.engine.state.cards[ok.id("sh")].faceDown, false, "control: four other [V] plus other icons works");
  for (const [label, pay] of [
    ["three other [V] (Shade's own does not count) with plenty of Rage", [...V(3), ...R(4)]],
    ["Shade and only Rage", R(6)],
    ["Shade alone", []],
    ["only two other [V]", [...V(2), ...R(4)]],
    ["the opponent's [V][V][V]", [...V(3), ...V(3, P2)]]
  ] as const) {
    const b = flipBoard({ pay: [...pay] });
    refused(() => flipUp(b), label);
    assert.equal(b.engine.state.cards[b.id("sh")].faceDown, true, `${label}: still face-down`);
    assert.equal(zoneOf(b.engine, b.id("sh")), "play");
  }
});

clause(SHADE, "2:flipUp", "the cost of 2 must be payable: four [V] but only one ready resource is refused; two ready is enough (spent resources still count for the threshold)", () => {
  const short = flipBoard({ pay: spentV(4) });
  assert.equal(readyResources(short.engine, P1), 1, "only Shade itself is ready");
  refused(() => flipUp(short), "cost 2 with one ready resource");
  assert.equal(short.engine.state.cards[short.id("sh")].faceDown, true);
  const ok = flipBoard({ pay: [...spentV(3), ...V(1)] });
  assert.equal(readyResources(ok.engine, P1), 2);
  flipUp(ok);
  assert.equal(ok.engine.state.cards[ok.id("sh")].faceDown, false, "two ready resources pay the 2 (one of them Shade itself)");
});

clause(SHADE, "2:flipUp", "FLIP UP does not change when a character can be deployed: refused on the opponent's turn, only a face-down card in play can be flipped", () => {
  const ok = flipBoard();
  flipUp(ok);
  assert.equal(ok.engine.state.cards[ok.id("sh")].faceDown, false, "control: my own turn works");
  const b = flipBoard({ turnOf: P2 });
  refused(() => flipUp(b), "opponent's turn");
  assert.equal(b.engine.state.cards[b.id("sh")].faceDown, true);
  const inHand = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "sh", def: printing(SHADE), owner: P1, zone: "hand" }, ...V(4)]
  });
  refused(() => flipUp(inHand as never), "a Shade in hand is deployed, not flipped up");
  assert.equal(zoneOf(inHand.engine, inHand.id("sh")), "hand");
});

clause(SHADE, "2:flipUp", "a non-tactic FLIP UP is refused inside my opponent's response window (their declared attack)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sh", def: printing(SHADE), owner: P1, zone: "play", faceDown: true },
      { key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" },
      ...V(3)
    ]
  });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  assert.equal(b.engine.state.priorityPlayerId, P1, "I hold priority in their window");
  refused(() => flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("sh"), selected: {}, variables: {} }), "character FLIP UP in a response window");
  assert.equal(b.engine.state.cards[b.id("sh")].faceDown, true);
});

// =====================================================================================================
// Skullcrush Steamroller — character (warlord, warmachine) · cost 3 · [R][R][R] · 4 / 3 / 5
// This card cannot be restored by your faction's RESTORE RULE. -- This card can attack only once each turn.
// -- ASSIST -- COST: Pay 2. Deplete a character you control. -- EFFECT: Restore this card.
// =====================================================================================================
const SS = "ac14455c-c744-4c57-b53b-430450666fac";

function ssBoard(o: { ssDepleted?: boolean; pay?: CardPlacement[]; extra?: CardPlacement[]; zone?: CardPlacement["zone"]; turnOf?: PlayerId; owner?: PlayerId; controller?: PlayerId; def?: CardDefinition } = {}) {
  const turnOf = o.turnOf ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: turnOf === P1 ? 1 : 2,
    activePlayerId: turnOf,
    cards: [
      { key: "ss", def: o.def ?? printing(SS), owner: o.owner ?? P1, controller: o.controller, zone: o.zone ?? "play", depleted: o.ssDepleted },
      ...(o.pay ?? R(3)),
      ...(o.extra ?? [])
    ]
  });
}
type SsBoard = ReturnType<typeof ssBoard>;
const ally = (key = "ally", over: Partial<CardDefinition> = {}, extra: Partial<CardPlacement> = {}): CardPlacement => ({
  key,
  def: character({ name: key, strength: 1, life: 4, speed: 2, ...over }),
  owner: P1,
  zone: "play",
  ...extra
});
/** A free tactic that restores one chosen character (id `rs`, pick `t`) — a restore that is not the Restore Rule. */
const restTactic = (): CardDefinition =>
  tactic({
    name: "Rest",
    cost: 0,
    behavior: { abilities: [{ id: "rs", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "restore", target: { type: "selected", id: "t" } }] }] }
  });
const restore = (b: SsBoard, key: string, tacticKey: string): void => {
  play(b.engine, P1, b.id(tacticKey), { selected: { t: [b.id(key)] } });
};
const assist = (b: SsBoard, pick: string, player: PlayerId = P1): void => activate(b.engine, player, b.id("ss"), "ss-assist", { selected: { c: [b.id(pick)] } });

clause(SS, "0:rule", "deploys for 3 with [R][R][R] as a 4 / 3 / 5: refused one resource short, and with fewer than three [R]", () => {
  const ok = ssBoard({ zone: "hand", pay: R(3) });
  play(ok.engine, P1, ok.id("ss"));
  assert.equal(zoneOf(ok.engine, ok.id("ss")), "play");
  assert.deepEqual(stats(ok.engine, ok.id("ss")), [4, 3, 5], "printed strength / speed / life");
  assert.equal(readyResources(ok.engine, P1), 0, "paid exactly 3");
  const short = ssBoard({ zone: "hand", pay: R(2) });
  refused(() => playRaw(short.engine, P1, short.id("ss")), "two resources for cost 3");
  const twoR = ssBoard({ zone: "hand", pay: [...R(2), ...V(3)] });
  refused(() => playRaw(twoR.engine, P1, twoR.id("ss")), "only two [R] for [R][R][R]");
  assert.equal(zoneOf(twoR.engine, twoR.id("ss")), "hand");
});

clause(SS, "0:rule", "the Restore Rule at the start of my turn restores my depleted characters but NOT the Steamroller", () => {
  const b = ssBoard({ ssDepleted: true, extra: [ally("plain", {}, { depleted: true })] });
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(isDepleted(b.engine, b.id("plain")), false, "control: an ordinary depleted character is restored");
  assert.equal(isDepleted(b.engine, b.id("ss")), true, "the Steamroller stays depleted through its controller's Restore Rule");
});

clause(SS, "0:rule", "it stays depleted turn after turn; and the faction of its CONTROLLER is the one that cannot restore it", () => {
  const b = ssBoard({ ssDepleted: true, extra: [ally("plain", {}, { depleted: true })] });
  for (let i = 0; i < 2; i++) {
    endTurn(b.engine, P1);
    endTurn(b.engine, P2);
    assert.equal(isDepleted(b.engine, b.id("ss")), true, `still depleted after round ${i + 1}`);
  }
  const stolen = ssBoard({ ssDepleted: true, owner: P1, controller: P2, turnOf: P1, extra: [ally("foePlain", {}, { depleted: true, owner: P2 })] });
  endTurn(stolen.engine, P1);
  assert.equal(stolen.engine.state.activePlayerId, P2);
  assert.equal(isDepleted(stolen.engine, stolen.id("foePlain")), false, "control: the controller's ordinary character is restored");
  assert.equal(isDepleted(stolen.engine, stolen.id("ss")), true, "a Steamroller I own but the opponent controls is not restored by THEIR Restore Rule either");
});

clause(SS, "0:rule", "only the Restore Rule is blocked: an effect that restores it still works", () => {
  const b = ssBoard({ ssDepleted: true, extra: [{ key: "rest", def: restTactic(), owner: P1, zone: "hand" }] });
  restore(b, "ss", "rest");
  assert.equal(isDepleted(b.engine, b.id("ss")), false, "restored by an effect");
});

clause(SS, "1:rule", "can attack once each turn: after its first attack and a restore, a second attack in the same turn is refused (a party counts too)", () => {
  const solo = ssBoard({ extra: [{ key: "rest", def: restTactic(), owner: P1, zone: "hand" }, { key: "foe", def: character({ name: "Foe", life: 9 }), owner: P2, zone: "play" }] });
  declareAttackBy(solo.engine, P1, [solo.id("ss")], AT_P2);
  declareBlockers(solo.engine, P2, []);
  finishBattle(solo.engine);
  assert.equal(isDepleted(solo.engine, solo.id("ss")), true, "attacking depletes it");
  restore(solo, "ss", "rest");
  assert.equal(isDepleted(solo.engine, solo.id("ss")), false, "restored again");
  refused(() => declareAttackBy(solo.engine, P1, [solo.id("ss")], AT_P2), "a second attack this turn");
  assert.equal(solo.engine.state.battle, undefined, "no second battle");
  const party = ssBoard({ extra: [ally("ally"), { key: "rest", def: restTactic(), owner: P1, zone: "hand" }] });
  declareAttackBy(party.engine, P1, [party.id("ss"), party.id("ally")], AT_P2);
  declareBlockers(party.engine, P2, []);
  finishBattle(party.engine);
  restore(party, "ss", "rest");
  refused(() => declareAttackBy(party.engine, P1, [party.id("ss")], AT_P2), "attacking in a party counted as its attack this turn");
});

clause(SS, "1:rule", "control: the limit is the Steamroller's own — without it the restored Steamroller attacks twice, and an ordinary character may attack twice", () => {
  const def = printing(SS);
  const noLimit = { ...def, behavior: { ...def.behavior, abilities: (def.behavior?.abilities ?? []).filter((a) => a.id !== "ss-limit") } } as CardDefinition;
  const b = ssBoard({ def: noLimit, extra: [{ key: "rest", def: restTactic(), owner: P1, zone: "hand" }, { key: "rest2", def: restTactic(), owner: P1, zone: "hand" }] });
  declareAttackBy(b.engine, P1, [b.id("ss")], AT_P2);
  declareBlockers(b.engine, P2, []);
  finishBattle(b.engine);
  restore(b, "ss", "rest");
  declareAttackBy(b.engine, P1, [b.id("ss")], AT_P2);
  assert.ok(b.engine.state.battle, "without the limit text the second attack is legal");
  const o = ssBoard({ extra: [ally("ally"), { key: "rest", def: restTactic(), owner: P1, zone: "hand" }] });
  declareAttackBy(o.engine, P1, [o.id("ally")], AT_P2);
  declareBlockers(o.engine, P2, []);
  finishBattle(o.engine);
  restore(o, "ally", "rest");
  declareAttackBy(o.engine, P1, [o.id("ally")], AT_P2);
  assert.ok(o.engine.state.battle, "another character is not limited by the Steamroller's text");
});

clause(SS, "1:rule", "the limit is per turn: on my next turn (once restored) it can attack again", () => {
  const b = ssBoard({ pay: R(4), extra: [ally("ally"), { key: "foe", def: character({ name: "Foe", life: 9 }), owner: P2, zone: "play" }] });
  declareAttackBy(b.engine, P1, [b.id("ss")], AT_P2);
  declareBlockers(b.engine, P2, []);
  finishBattle(b.engine);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(isDepleted(b.engine, b.id("ss")), true, "the Restore Rule did not restore it");
  assist(b, "ally");
  assert.equal(isDepleted(b.engine, b.id("ss")), false, "Assist restored it");
  declareAttackBy(b.engine, P1, [b.id("ss")], AT_P2);
  assert.ok(b.engine.state.battle, "a new turn, a new attack");
});

clause(SS, "2:ability:ss-assist", "pays exactly 2 resources, depletes the character I pick, and restores the depleted Steamroller", () => {
  const b = ssBoard({ ssDepleted: true, pay: R(3), extra: [ally("ally"), ally("other")] });
  assert.equal(readyResources(b.engine, P1), 3);
  assist(b, "ally");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(readyResources(b.engine, P1), 1, "paid exactly 2");
  assert.equal(isDepleted(b.engine, b.id("ally")), true, "the picked character is depleted");
  assert.equal(isDepleted(b.engine, b.id("other")), false, "another character is untouched");
  assert.equal(isDepleted(b.engine, b.id("ss")), false, "the Steamroller is restored");
});

clause(SS, "2:ability:ss-assist", "refused when I cannot pay 2 (and nothing is depleted); exactly 2 is enough", () => {
  const short = ssBoard({ ssDepleted: true, pay: R(1), extra: [ally("ally")] });
  refused(() => assist(short, "ally"), "one resource for a cost of 2");
  assert.equal(isDepleted(short.engine, short.id("ally")), false, "the character was not depleted");
  assert.equal(isDepleted(short.engine, short.id("ss")), true);
  const none = ssBoard({ ssDepleted: true, pay: [], extra: [ally("ally")] });
  refused(() => assist(none, "ally"), "no resources");
  const exact = ssBoard({ ssDepleted: true, pay: V(2), extra: [ally("ally")] });
  assist(exact, "ally");
  assert.equal(isDepleted(exact.engine, exact.id("ss")), false, "any 2 resources, no threshold");
  assert.equal(readyResources(exact.engine, P1), 0);
});

clause(SS, "2:ability:ss-assist", "the deplete must be one of MY characters that can be depleted: not the opponent's, not an item or resource, not an already depleted one, not out of play, not two", () => {
  const b = ssBoard({
    ssDepleted: true,
    pay: R(3),
    extra: [
      ally("ally"),
      ally("depl", {}, { depleted: true }),
      ally("foe", {}, { owner: P2 }),
      { key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDeck", def: character({ name: "InDeck" }), owner: P1, zone: "deck" }
    ]
  });
  for (const [label, key] of [
    ["the opponent's character", "foe"],
    ["an already depleted character", "depl"],
    ["an item", "itm"],
    ["a character in hand", "inHand"],
    ["a character in the deck", "inDeck"]
  ] as const) {
    refused(() => assist(b, key), label);
  }
  refused(() => activate(b.engine, P1, b.id("ss"), "ss-assist", { selected: { c: [b.id("ally"), b.id("depl")] } }), "two characters");
  refused(() => activate(b.engine, P1, b.id("ss"), "ss-assist", { selected: {} }), "no character picked");
  assert.equal(readyResources(b.engine, P1), 3, "nothing was paid by the refusals");
  assert.equal(isDepleted(b.engine, b.id("ss")), true);
  assist(b, "ally");
  assert.equal(isDepleted(b.engine, b.id("ss")), false, "positive control: my ready character works");
});

clause(SS, "2:ability:ss-assist", "the Steamroller may be the character it depletes: a ready Steamroller depletes and restores itself", () => {
  const b = ssBoard({ pay: R(2) });
  assist(b, "ss");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(readyResources(b.engine, P1), 0, "2 paid");
  assert.equal(isDepleted(b.engine, b.id("ss")), false, "deplete as the cost, restore as the effect: ready again");
});

clause(SS, "2:ability:ss-assist", "usable while the Steamroller is ready too (the restore then does nothing): the cost is still paid", () => {
  const b = ssBoard({ pay: R(3), extra: [ally("ally")] });
  assist(b, "ally");
  assert.equal(isDepleted(b.engine, b.id("ally")), true);
  assert.equal(isDepleted(b.engine, b.id("ss")), false);
  assert.equal(readyResources(b.engine, P1), 1);
});

clause(SS, "2:ability:ss-assist", "only its controller can use it, only while it is in play; a second Assist works again (two characters, two payments)", () => {
  const b = ssBoard({ ssDepleted: true, turnOf: P2, pay: [...R(2), ...R(2, P2)], extra: [ally("ally"), ally("foe", {}, { owner: P2 })] });
  refused(() => assist(b, "foe", P2), "the opponent does not control the Steamroller");
  refused(() => assist(b, "ally", P2), "the opponent cannot activate it");
  assert.equal(isDepleted(b.engine, b.id("ss")), true);
  const inHand = ssBoard({ zone: "hand", pay: R(3), extra: [ally("ally")] });
  refused(() => assist(inHand, "ally"), "not in play");
  const twice = ssBoard({ ssDepleted: true, pay: R(4), extra: [ally("a1"), ally("a2")] });
  assist(twice, "a1");
  assist(twice, "a2");
  assert.equal(readyResources(twice.engine, P1), 0, "two uses, two payments of 2");
  assert.equal(isDepleted(twice.engine, twice.id("a1")) && isDepleted(twice.engine, twice.id("a2")), true);
  const stolen = ssBoard({ ssDepleted: true, owner: P1, controller: P2, turnOf: P2, pay: R(2, P2), extra: [ally("foe", {}, { owner: P2 })] });
  assist(stolen, "foe", P2);
  assert.equal(isDepleted(stolen.engine, stolen.id("ss")), false, "the controller (not the owner) can use it");
});

// =====================================================================================================
// Super Shiny Caltrops of DOOM! — item (warlord, gear) · cost 2 · [R]
// When this card enters play, you may pick a character. If you do, inflict 2 damage to the character.
// -- If this card would be destroyed, you may pay 2 instead. If you do, put it into play as a face-down
// resource under its owner's control. -- MOVE -- COST: Pay 2. Pick a character. EFFECT: Attach this card to
// the character if you can. (if you can't, this card remains in play) -- FLIP UP: 2 [R]
// =====================================================================================================
const CAL = "43b9dddc-f557-4efa-86f9-6ce9ca46a277";

function calBoard(o: { zone?: CardPlacement["zone"]; faceDown?: boolean; pay?: CardPlacement[]; extra?: CardPlacement[]; turnOf?: PlayerId; owner?: PlayerId; controller?: PlayerId } = {}) {
  const turnOf = o.turnOf ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: turnOf === P1 ? 1 : 2,
    activePlayerId: turnOf,
    cards: [
      { key: "cal", def: printing(CAL), owner: o.owner ?? P1, controller: o.controller, zone: o.zone ?? "hand", faceDown: o.faceDown },
      ...(o.pay ?? R(3)),
      ...(o.extra ?? [])
    ]
  });
}
type CalBoard = ReturnType<typeof calBoard>;
const foe = (key = "foe", over: Partial<CardDefinition> = {}, extra: Partial<CardPlacement> = {}): CardPlacement => ({
  key,
  def: character({ name: key, strength: 1, life: 5, speed: 2, ...over }),
  owner: P2,
  zone: "play",
  ...extra
});
const dmg = (engine: Eng, id: string): number => engine.state.cards[id].damage ?? 0;
const enterPick = (b: CalBoard, key?: string): void => answerPending(b.engine, "selectTargets", { selected: { hit: key ? [b.id(key)] : [] } });
const replaceAnswer = (b: CalBoard, apply: boolean): void => answerPending(b.engine, "replacementChoice", { apply });
const killTactic = (name = "Kill"): CardDefinition =>
  tactic({
    name,
    cost: 0,
    behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
const killAllItems = (): CardDefinition =>
  tactic({
    name: "KillAll",
    cost: 0,
    behavior: { abilities: [{ id: "ka", type: "activated", effects: [{ type: "forEach", selector: { zone: "play", type: "item" }, effects: [{ type: "destroy", target: { type: "selected", id: "__candidate" } }] }] }] }
  });
const killChar = (): CardDefinition =>
  tactic({
    name: "KillChar",
    cost: 0,
    behavior: { abilities: [{ id: "kc", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
const reanimateItem = (): CardDefinition =>
  tactic({
    name: "ReanimateItem",
    cost: 0,
    behavior: { abilities: [{ id: "re", type: "activated", targets: [{ id: "t", selector: { zone: "discard", type: "item" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });
const destroyCal = (b: CalBoard, tacticKey = "kill", player: PlayerId = P1, target = "cal"): void => {
  play(b.engine, player, b.id(tacticKey), { selected: { t: [b.id(target)] } });
};

clause(CAL, "0:rule", "deploys for 2 with [R]: refused one short and without [R]", () => {
  const ok = calBoard({ pay: R(2) });
  play(ok.engine, P1, ok.id("cal"));
  assert.equal(zoneOf(ok.engine, ok.id("cal")), "play");
  assert.equal(readyResources(ok.engine, P1), 0, "paid exactly 2");
  const short = calBoard({ pay: R(1) });
  refused(() => playRaw(short.engine, P1, short.id("cal")), "one resource for cost 2");
  assert.equal(zoneOf(short.engine, short.id("cal")), "hand");
  const noIcon = calBoard({ pay: V(3) });
  refused(() => playRaw(noIcon.engine, P1, noIcon.id("cal")), "no [R]");
});

clause(CAL, "0:rule", "entering play: I may pick any character, mine or the opponent's, and it takes exactly 2 damage; everyone else takes none", () => {
  for (const key of ["mine", "theirs"]) {
    const b = calBoard({ extra: [ally("mine", { life: 5 }), foe("theirs", {}, { damage: 1 }), foe("bystander")] });
    play(b.engine, P1, b.id("cal"));
    assert.equal(zoneOf(b.engine, b.id("cal")), "play", "it is in play while the pick is open");
    assert.equal(pending(b.engine)?.kind, "selectTargets");
    assert.equal(pending(b.engine)?.playerId, P1);
    enterPick(b, key);
    assert.equal(b.engine.state.pendingChoice, undefined);
    const base = key === "theirs" ? 1 : 0;
    assert.equal(dmg(b.engine, b.id(key)), base + 2, `${key}: +2 damage`);
    for (const other of ["mine", "theirs", "bystander"].filter((k) => k !== key)) assert.equal(dmg(b.engine, b.id(other)), other === "theirs" ? 1 : 0, `${other} is untouched`);
    assert.equal(zoneOf(b.engine, b.id(key)), "play", "survives with life 5");
  }
});

clause(CAL, "0:rule", "2 damage destroys a character with 2 or less life", () => {
  const b = calBoard({ extra: [foe("weak", { life: 2 }), foe("tough", { life: 3 })] });
  play(b.engine, P1, b.id("cal"));
  enterPick(b, "weak");
  assert.equal(zoneOf(b.engine, b.id("weak")), "discard", "2 damage kills a 2-life character");
  assert.equal(zoneOf(b.engine, b.id("tough")), "play");
  const c = calBoard({ extra: [foe("tough", { life: 3 })] });
  play(c.engine, P1, c.id("cal"));
  enterPick(c, "tough");
  assert.equal(zoneOf(c.engine, c.id("tough")), "play", "a 3-life character survives (so it is exactly 2, not more)");
});

clause(CAL, "0:rule", "it is a 'may': picking nobody does no damage", () => {
  const b = calBoard({ extra: [ally("mine"), foe("theirs")] });
  play(b.engine, P1, b.id("cal"));
  enterPick(b, undefined);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual([dmg(b.engine, b.id("mine")), dmg(b.engine, b.id("theirs"))], [0, 0]);
  assert.equal(zoneOf(b.engine, b.id("cal")), "play");
});

clause(CAL, "0:rule", "the pick must be a character in play: not an item, a resource, the faction, a character in hand, or two characters", () => {
  const b = calBoard({
    extra: [
      ally("mine"),
      foe("theirs"),
      { key: "itm", def: item({ name: "Itm" }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
      { key: "inDeck", def: character({ name: "InDeck" }), owner: P2, zone: "deck" }
    ]
  });
  play(b.engine, P1, b.id("cal"));
  const attempt = (...keys: string[]) => () => answerPending(b.engine, "selectTargets", { selected: { hit: keys.map((k) => b.id(k)) } });
  refused(attempt("itm"), "an item");
  refused(attempt("inHand"), "a character in hand");
  refused(attempt("inDeck"), "a character in a deck");
  refused(attempt("cal"), "Caltrops itself is not a character");
  refused(() => answerPending(b.engine, "selectTargets", { selected: { hit: [b.engine.state.players[P2].factionId!] } }), "the opponent's faction");
  refused(() => answerPending(b.engine, "selectTargets", { selected: { hit: [b.engine.state.players[P1].factionId!] } }), "my faction");
  refused(attempt("mine", "theirs"), "two characters");
  assert.equal(pending(b.engine)?.kind, "selectTargets", "still open after the refusals");
  assert.deepEqual([dmg(b.engine, b.id("mine")), dmg(b.engine, b.id("theirs"))], [0, 0]);
  enterPick(b, "theirs");
  assert.equal(dmg(b.engine, b.id("theirs")), 2, "positive control");
});

clause(CAL, "0:rule", "with no character in play there is nothing to pick: Caltrops simply enters", () => {
  const b = calBoard({ extra: [{ key: "itm", def: item({ name: "Itm" }), owner: P2, zone: "play" }] });
  play(b.engine, P1, b.id("cal"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("cal")), "play");
});

clause(CAL, "0:rule", "only when THIS card enters: another item (or a second Caltrops) entering does not trigger the first one; a second Caltrops triggers only its own", () => {
  const b = calBoard({ zone: "play", extra: [{ key: "itm", def: item({ name: "Itm", cost: 0 }), owner: P1, zone: "hand" }, foe("theirs")] });
  play(b.engine, P1, b.id("itm"));
  assert.equal(b.engine.state.pendingChoice, undefined, "an ordinary item entering raises nothing");
  const two = calBoard({ zone: "play", extra: [{ key: "cal2", def: printing(CAL), owner: P1, zone: "hand" }, foe("theirs", { life: 9 })] });
  play(two.engine, P1, two.id("cal2"));
  assert.equal(pending(two.engine)?.kind, "selectTargets");
  assert.equal(pending(two.engine)?.sourceId, two.id("cal2"), "the new Caltrops' trigger");
  enterPick(two, "theirs");
  assert.equal(two.engine.state.pendingChoice, undefined, "the first Caltrops did not trigger as well");
  assert.equal(dmg(two.engine, two.id("theirs")), 2);
});

clause(CAL, "0:rule", "also when an effect puts it into play (from the discard pile)", () => {
  const b = calBoard({ zone: "discard", extra: [{ key: "re", def: reanimateItem(), owner: P1, zone: "hand" }, foe("theirs")] });
  play(b.engine, P1, b.id("re"), { selected: { t: [b.id("cal")] } });
  assert.equal(zoneOf(b.engine, b.id("cal")), "play");
  assert.equal(pending(b.engine)?.kind, "selectTargets", "the enter trigger fires");
  enterPick(b, "theirs");
  assert.equal(dmg(b.engine, b.id("theirs")), 2);
});

// --- 1:rule — the replacement -------------------------------------------------------------------------

const killBoard = (o: { pay?: CardPlacement[]; extra?: CardPlacement[]; owner?: PlayerId; controller?: PlayerId; turnOf?: PlayerId } = {}) =>
  calBoard({ zone: "play", ...o, extra: [{ key: "kill", def: killTactic(), owner: o.turnOf === P2 ? P2 : P1, zone: "hand" }, ...(o.extra ?? [])] });

clause(CAL, "1:rule", "if it would be destroyed I may pay 2 instead: it becomes a ready face-down resource under my control and is not destroyed", () => {
  const b = killBoard({ pay: R(3) });
  assert.equal(readyResources(b.engine, P1), 3);
  destroyCal(b);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "replacementChoice");
  assert.equal(pc?.playerId, P1, "its controller chooses");
  assert.equal(zoneOf(b.engine, b.id("cal")), "play", "nothing has happened yet");
  replaceAnswer(b, true);
  assert.equal(b.engine.state.pendingChoice, undefined);
  const c = b.engine.state.cards[b.id("cal")];
  assert.equal(c.zone, "play", "put into play, not into the discard pile");
  assert.equal(c.faceDown, true, "as a face-down card");
  assert.equal(b.engine.isResource(b.id("cal")), true, "a resource");
  assert.equal(c.controllerId, P1);
  assert.equal(!!c.depleted, false);
  assert.equal(c.attachedTo, undefined, "a fresh resource, not attached to anything");
  assert.equal(readyResources(b.engine, P1), 2, "3 - 2 paid + the new face-down resource");
  assert.deepEqual(b.engine.state.players[P1].discard.filter((x) => x === b.id("cal")), [], "never reached the discard pile");
  const destroyedEvents = b.engine.getLog().filter((e) => e.event?.type === "cardDestroyed" && JSON.stringify(e.event).includes(b.id("cal")));
  assert.equal(destroyedEvents.length, 0, "the original destruction did not happen");
});

clause(CAL, "1:rule", "declining: it is destroyed as normal (discard pile) and nothing is paid", () => {
  const b = killBoard({ pay: R(3) });
  destroyCal(b);
  replaceAnswer(b, false);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("cal")), "discard");
  assert.equal(readyResources(b.engine, P1), 3, "nothing paid");
});

clause(CAL, "1:rule", "I must be able to pay 2: with one resource it cannot be saved (exactly 2 is enough)", () => {
  const short = killBoard({ pay: R(1) });
  destroyCal(short);
  if (pending(short.engine)?.kind === "replacementChoice") {
    refused(() => replaceAnswer(short, true), "paying 2 with one resource");
    replaceAnswer(short, false);
  }
  assert.equal(short.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(short.engine, short.id("cal")), "discard", "destroyed");
  const exact = killBoard({ pay: V(2) });
  destroyCal(exact);
  replaceAnswer(exact, true);
  assert.equal(exact.engine.state.cards[exact.id("cal")].faceDown, true, "two resources of any kind pay");
  assert.equal(zoneOf(exact.engine, exact.id("cal")), "play");
});

clause(CAL, "1:rule", "only for THIS card: another item being destroyed gets no replacement, and a second Caltrops is saved on its own (one payment, the other is untouched)", () => {
  const b = killBoard({ pay: R(4), extra: [{ key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play" }] });
  destroyCal(b, "kill", P1, "itm");
  assert.equal(b.engine.state.pendingChoice, undefined, "no prompt for another item");
  assert.equal(zoneOf(b.engine, b.id("itm")), "discard");
  assert.equal(zoneOf(b.engine, b.id("cal")), "play");
  assert.equal(b.engine.state.cards[b.id("cal")].faceDown, false, "the Caltrops is untouched");
  const two = killBoard({ pay: R(4), extra: [{ key: "cal2", def: printing(CAL), owner: P1, zone: "play" }] });
  destroyCal(two, "kill", P1, "cal");
  let prompts = 0;
  while (pending(two.engine)?.kind === "replacementChoice") {
    prompts++;
    assert.equal(pending(two.engine)?.sourceId, two.id("cal"), "only the destroyed card's own replacement is offered");
    replaceAnswer(two, true);
  }
  assert.equal(prompts, 1, "one prompt");
  assert.equal(two.engine.state.pendingChoice, undefined);
  assert.equal(two.engine.state.cards[two.id("cal")].faceDown, true, "the destroyed Caltrops is saved");
  assert.equal(two.engine.state.cards[two.id("cal2")].faceDown, false, "the other Caltrops is not flipped");
  assert.equal(zoneOf(two.engine, two.id("cal2")), "play");
  assert.equal(readyResources(two.engine, P1), 3, "4 - 2 paid + the new face-down resource");
});

clause(CAL, "1:rule", "the opponent's own Caltrops being destroyed gives me nothing: it is not my card (they have nothing to pay with, so it just dies)", () => {
  const b = calBoard({
    zone: "play",
    pay: R(3),
    extra: [{ key: "theirCal", def: printing(CAL), owner: P2, zone: "play" }, { key: "kill", def: killTactic(), owner: P1, zone: "hand" }]
  });
  destroyCal(b, "kill", P1, "theirCal");
  assert.equal(b.engine.state.pendingChoice, undefined, "no prompt for my Caltrops' replacement");
  assert.equal(zoneOf(b.engine, b.id("theirCal")), "discard", "their Caltrops is destroyed");
  assert.equal(zoneOf(b.engine, b.id("cal")), "play");
  assert.equal(b.engine.state.cards[b.id("cal")].faceDown, false, "mine is untouched");
  assert.equal(readyResources(b.engine, P1), 3, "I paid nothing");
});

clause(CAL, "1:rule", "it applies on every route of destruction: a mass destroy saves it too", () => {
  const b = calBoard({ zone: "play", pay: R(3), extra: [{ key: "ka", def: killAllItems(), owner: P1, zone: "hand" }, { key: "itm", def: item({ name: "Itm" }), owner: P2, zone: "play" }] });
  play(b.engine, P1, b.id("ka"));
  while (pending(b.engine)?.kind === "replacementChoice") replaceAnswer(b, true);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("itm")), "discard", "the other item is destroyed");
  assert.equal(zoneOf(b.engine, b.id("cal")), "play", "Caltrops was saved");
  assert.equal(b.engine.state.cards[b.id("cal")].faceDown, true);
});

clause(CAL, "1:rule", "an opponent destroying my Caltrops still lets ME (its controller) pay 2 to save it", () => {
  const b = killBoard({ turnOf: P2, pay: R(3), extra: [] });
  destroyCal(b, "kill", P2);
  assert.equal(pending(b.engine)?.kind, "replacementChoice");
  assert.equal(pending(b.engine)?.playerId, P1, "I am asked, not the opponent");
  replaceAnswer(b, true);
  assert.equal(b.engine.state.cards[b.id("cal")].faceDown, true);
  assert.equal(b.engine.state.cards[b.id("cal")].controllerId, P1);
  assert.equal(readyResources(b.engine, P1), 2, "I paid 2 of my 3 and gained the resource");
});

clause(CAL, "1:rule", "'under its OWNER's control': a Caltrops I own but the opponent controls comes back as a face-down resource under MY control, paid for by the opponent", () => {
  const b = killBoard({ turnOf: P1, owner: P1, controller: P2, pay: [...R(1), ...R(3, P2)], extra: [] });
  destroyCal(b, "kill", P1);
  assert.equal(pending(b.engine)?.kind, "replacementChoice");
  assert.equal(pending(b.engine)?.playerId, P2, "its controller is asked to pay");
  replaceAnswer(b, true);
  const c = b.engine.state.cards[b.id("cal")];
  assert.equal(c.zone, "play");
  assert.equal(c.faceDown, true);
  assert.equal(c.ownerId, P1);
  assert.equal(c.controllerId, P1, "under its owner's control");
  assert.equal(readyResources(b.engine, P2), 1, "the controller paid 2 of 3 and did not get the resource");
});

clause(CAL, "1:rule", "attached via MOVE and then destroyed: it comes back as a free-standing face-down resource (no longer attached to the character)", () => {
  const b = killBoard({ pay: R(5), extra: [foe("host")] });
  activate(b.engine, P1, b.id("cal"), "super-shiny-caltrops-move", { selected: { ch: [b.id("host")] } });
  assert.equal(b.engine.state.cards[b.id("cal")].attachedTo, b.id("host"));
  destroyCal(b);
  replaceAnswer(b, true);
  const c = b.engine.state.cards[b.id("cal")];
  assert.equal(c.faceDown, true);
  assert.equal(c.zone, "play");
  assert.equal(c.attachedTo, undefined, "not attached to the old host");
});

// --- 2:ability MOVE ------------------------------------------------------------------------------------

const moveCal = (b: CalBoard, key: string, player: PlayerId = P1): void => activate(b.engine, player, b.id("cal"), "super-shiny-caltrops-move", { selected: { ch: [b.id(key)] } });

clause(CAL, "2:ability:super-shiny-caltrops-move", "pays exactly 2 and attaches Caltrops to the picked character, mine or the opponent's; it stays in play under my control", () => {
  for (const key of ["mine", "theirs"]) {
    const b = calBoard({ zone: "play", pay: R(3), extra: [ally("mine"), foe("theirs")] });
    moveCal(b, key);
    assert.equal(b.engine.state.pendingChoice, undefined);
    assert.equal(b.engine.state.cards[b.id("cal")].attachedTo, b.id(key), `attached to ${key}`);
    assert.equal(zoneOf(b.engine, b.id("cal")), "play");
    assert.equal(b.engine.state.cards[b.id("cal")].controllerId, P1, "control does not change");
    assert.equal(readyResources(b.engine, P1), 1, "paid exactly 2");
  }
});

clause(CAL, "2:ability:super-shiny-caltrops-move", "it can be moved again: a second MOVE re-attaches it to another character (another 2)", () => {
  const b = calBoard({ zone: "play", pay: R(4), extra: [ally("mine"), foe("theirs")] });
  moveCal(b, "mine");
  moveCal(b, "theirs");
  assert.equal(b.engine.state.cards[b.id("cal")].attachedTo, b.id("theirs"));
  assert.equal(readyResources(b.engine, P1), 0, "2 + 2");
});

clause(CAL, "2:ability:super-shiny-caltrops-move", "refused for want of 2 resources (nothing attaches), with no character to pick, or with a wrong pick; only its controller can use it", () => {
  const short = calBoard({ zone: "play", pay: R(1), extra: [foe("theirs")] });
  refused(() => moveCal(short, "theirs"), "one resource");
  assert.equal(short.engine.state.cards[short.id("cal")].attachedTo, undefined);
  const noChar = calBoard({ zone: "play", pay: R(3), extra: [{ key: "itm", def: item({ name: "Itm" }), owner: P2, zone: "play" }] });
  refused(() => activate(noChar.engine, P1, noChar.id("cal"), "super-shiny-caltrops-move", { selected: {} }), "no character picked");
  refused(() => moveCal(noChar, "itm"), "an item is not a character");
  const b = calBoard({ zone: "play", pay: R(3), extra: [ally("mine"), foe("theirs")] });
  refused(() => activate(b.engine, P1, b.id("cal"), "super-shiny-caltrops-move", { selected: { ch: [b.id("mine"), b.id("theirs")] } }), "two characters");
  refused(() => moveCal(b, "cal"), "itself");
  assert.equal(readyResources(b.engine, P1), 3, "nothing paid by the refusals");
  const opp = calBoard({ zone: "play", turnOf: P2, pay: R(3, P2), extra: [foe("theirs")] });
  refused(() => moveCal(opp, "theirs", P2), "the opponent does not control it");
  const hand = calBoard({ zone: "hand", pay: R(3), extra: [foe("theirs")] });
  refused(() => moveCal(hand, "theirs"), "not in play");
});

clause(CAL, "2:ability:super-shiny-caltrops-move", "if it cannot attach (the picked character is gone by resolution) it simply remains in play, attached to nothing; the 2 is still paid", () => {
  const b = calBoard({ zone: "play", pay: R(3), extra: [foe("theirs"), { key: "kc", def: killChar(), owner: P2, zone: "hand" }] });
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("cal"), abilityId: "super-shiny-caltrops-move", selected: { ch: [b.id("theirs")] }, variables: {} } as never);
  assert.ok(b.engine.state.responseWindow, "the activation opens a response window");
  if (b.engine.state.responseWindow?.priorityPlayerId === P1) b.engine.perform({ type: "passPriority", playerId: P1 });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent can respond");
  b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("kc"), selected: { t: [b.id("theirs")] }, variables: {} } as never);
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("theirs")), "discard", "the pick was destroyed in response");
  assert.equal(zoneOf(b.engine, b.id("cal")), "play", "Caltrops remains in play");
  assert.equal(b.engine.state.cards[b.id("cal")].attachedTo, undefined, `attached to nothing (actual: ${b.engine.state.cards[b.id("cal")].attachedTo}, the destroyed pick is ${b.id("theirs")})`);
  assert.equal(readyResources(b.engine, P1), 1, "the cost was paid");
});

// --- 3:flipUp — FLIP UP: 2 [R] --------------------------------------------------------------------------

const calFlip = (o: { pay?: CardPlacement[]; turnOf?: PlayerId; extra?: CardPlacement[] } = {}) => calBoard({ zone: "play", faceDown: true, ...o });
const flipCal = (b: CalBoard, player: PlayerId = P1): void => {
  flipUpNow(b.engine, { type: "flipUp", playerId: player, cardId: b.id("cal"), selected: {}, variables: {} });
  resolvePendingResponses(b.engine);
};

clause(CAL, "3:flipUp", "flipping up pays exactly 2 (the face-down Caltrops can pay for itself) with one [R], and it becomes a face-up item in play", () => {
  const b = calFlip({ pay: R(1) });
  assert.equal(readyResources(b.engine, P1), 2, "one Rage + the face-down card itself");
  flipCal(b);
  assert.equal(b.engine.state.pendingChoice, undefined, "no characters: nothing to pick");
  assert.equal(zoneOf(b.engine, b.id("cal")), "play");
  assert.equal(b.engine.state.cards[b.id("cal")].faceDown, false, "face-up");
  assert.equal(b.engine.isResource(b.id("cal")), false, "no longer a resource");
  const more = calFlip({ pay: R(4) });
  flipCal(more);
  assert.equal(readyResources(more.engine, P1), 2, "5 resources: 2 paid (not 2 + 2 for the deploy cost) and the flipped card is no longer one (5 - 2 - 1)");
});

clause(CAL, "3:flipUp", "refused without [R] (only Volition), with no other resource, or with only the opponent's [R]", () => {
  for (const [label, pay] of [
    ["only Volition", V(3)],
    ["nothing but the card itself", []],
    ["the opponent's Rage only", R(3, P2)]
  ] as const) {
    const b = calFlip({ pay: [...pay] });
    refused(() => flipCal(b), label);
    assert.equal(b.engine.state.cards[b.id("cal")].faceDown, true, `${label}: still face-down`);
  }
  const spent = calFlip({ pay: spentResources(P1, 2) });
  assert.equal(readyResources(spent.engine, P1), 1, "only the card itself is ready");
  refused(() => flipCal(spent), "cost 2 with one ready resource, even though [R] is controlled");
});

clause(CAL, "3:flipUp", "FLIP UP is still an item deploy: refused on the opponent's turn", () => {
  const ok = calFlip({ pay: R(2) });
  flipCal(ok);
  assert.equal(ok.engine.state.cards[ok.id("cal")].faceDown, false, "control: my turn works");
  const b = calFlip({ pay: R(2), turnOf: P2 });
  refused(() => flipCal(b), "opponent's turn");
  assert.equal(b.engine.state.cards[b.id("cal")].faceDown, true);
});

clause(CAL, "3:flipUp", "it enters play when flipped up (CR 411.3): its enter trigger fires and may pick a character for 2 damage", () => {
  const b = calFlip({ pay: R(2), extra: [foe("theirs")] });
  flipCal(b);
  assert.equal(pending(b.engine)?.kind, "selectTargets", "the enter trigger prompts");
  enterPick(b, "theirs");
  assert.equal(dmg(b.engine, b.id("theirs")), 2);
  assert.equal(b.engine.state.cards[b.id("cal")].faceDown, false);
});

clause(CAL, "3:flipUp", "a non-tactic FLIP UP is refused inside my opponent's response window (their declared attack)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "cal", def: printing(CAL), owner: P1, zone: "play", faceDown: true },
      { key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" },
      ...R(2)
    ]
  });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  assert.equal(b.engine.state.priorityPlayerId, P1, "I hold priority in their window");
  refused(() => flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("cal"), selected: {}, variables: {} }), "item FLIP UP in a response window");
  assert.equal(b.engine.state.cards[b.id("cal")].faceDown, true);
});

// =====================================================================================================
// Thabbashite Warmonger — character (warlord, tyrant) · cost 1 · [R] · 1 / 3 / 2
// [V]: If a character inflicts battle damage to a faction, X is the number of Threshold Icons of the
// character. Inflict X damage to the faction of that character's controller.
// =====================================================================================================
const WAR = "f75a2be6-4c8f-43e2-b23f-28d1892062c0";

function warBoard(o: { pay?: CardPlacement[]; extra?: CardPlacement[]; turnOf?: PlayerId; warZone?: CardPlacement["zone"] } = {}) {
  const turnOf = o.turnOf ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: turnOf === P1 ? 1 : 2,
    activePlayerId: turnOf,
    cards: [{ key: "war", def: printing(WAR), owner: P1, zone: o.warZone ?? "play" }, ...(o.pay ?? V(1)), ...(o.extra ?? [])]
  });
}
type WarBoard = ReturnType<typeof warBoard>;
const hitter = (key: string, threshold: string, over: Partial<CardDefinition> = {}, extra: Partial<CardPlacement> = {}): CardPlacement => ({
  key,
  def: character({ name: key, strength: 2, life: 5, speed: 3, threshold, ...over } as Partial<CardDefinition>),
  owner: P1,
  zone: "play",
  ...extra
});
/** `attacker` attacks the other faction with `attackers`; `blockers` (the defender's) block. */
const warFight = (b: WarBoard, attackers: string[], blockers: string[] = [], attacker: PlayerId = P1): void =>
  fightThrough(b.engine, attacker, attackers.map((k) => b.id(k)), attacker === P1 ? AT_P2 : AT_P1, blockers.map((k) => b.id(k)));
const infl = (b: WarBoard): [number, number] => [influenceOf(b.engine, P1), influenceOf(b.engine, P2)];

clause(WAR, "0:rule@v", "with [V]: an unblocked character with 3 threshold icons hits a faction for its strength, then X=3 damage hits the faction of the character's controller", () => {
  const b = warBoard({ extra: [hitter("atk", "rrr")] });
  const [a0, d0] = infl(b);
  warFight(b, ["atk"]);
  const [a1, d1] = infl(b);
  assert.equal(d0 - d1, 2, "the opponent's faction took the 2 battle damage");
  assert.equal(a0 - a1, 3, "X = 3 threshold icons: the attacker's own faction takes 3");
});

clause(WAR, "0:rule@v", "X is the number of threshold icons of that character: 1, 2, 4 icons; mixed icons count; none gives 0", () => {
  for (const [threshold, x] of [["r", 1], ["gd", 2], ["rrrr", 4], ["", 0]] as const) {
    const b = warBoard({ extra: [hitter("atk", threshold)] });
    const [a0] = infl(b);
    warFight(b, ["atk"]);
    assert.equal(a0 - infl(b)[0], x, `threshold "${threshold}": X = ${x}`);
  }
});

clause(WAR, "0:rule@v", "any player's character counts: the opponent's attacker hitting MY faction costs the OPPONENT's faction X", () => {
  const b = warBoard({ turnOf: P2, extra: [hitter("atk2", "ee", {}, { owner: P2 })] });
  const [me0, opp0] = infl(b);
  warFight(b, ["atk2"], [], P2);
  const [me1, opp1] = infl(b);
  assert.equal(me0 - me1, 2, "my faction took the 2 battle damage");
  assert.equal(opp0 - opp1, 2, "the attacker's controller's faction takes X = 2");
});

clause(WAR, "0:rule@v", "the Warmonger's controller does not have to be the attacker or the defender's faction owner: the Warmonger works from the OPPONENT's side too", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "war", def: printing(WAR), owner: P2, zone: "play" }, ...V(1, P2), hitter("atk", "rrr")]
  });
  const [a0, d0] = infl(b as never);
  fightThrough(b.engine, P1, [b.id("atk")], AT_P2, []);
  assert.equal(a0 - influenceOf(b.engine, P1), 3, "P2's Warmonger punishes P1's attacker's faction");
  assert.equal(d0 - influenceOf(b.engine, P2), 2);
});

clause(WAR, "0:rule@v", "needs [V]: without any [V] the Warmonger does nothing, the opponent's [V] don't count, and one [V] is enough", () => {
  for (const [label, pay, expectX] of [
    ["no resources", [], 0],
    ["only Rage", R(3), 0],
    ["only the opponent's [V]", V(3, P2), 0],
    ["one [V]", V(1), 3],
    ["one [V] among Rage", [...R(2), ...V(1)], 3]
  ] as const) {
    const b = warBoard({ pay: [...pay], extra: [hitter("atk", "rrr")] });
    const [a0] = infl(b);
    warFight(b, ["atk"]);
    assert.equal(a0 - infl(b)[0], expectX, label);
  }
});

clause(WAR, "0:rule@v", "only damage to a FACTION: a blocked attacker deals its damage to the blocker, so nothing triggers", () => {
  const b = warBoard({ extra: [hitter("atk", "rrr"), hitter("blk", "ggg", { strength: 0, life: 9 }, { owner: P2 })] });
  const before = infl(b);
  warFight(b, ["atk"], ["blk"]);
  assert.deepEqual(infl(b), before, "neither faction lost influence");
  assert.equal(dmg(b.engine, b.id("blk")), 2, "the blocker took the damage");
});

clause(WAR, "0:rule@v", "'battle damage' by a character that deals 0 (strength 0) inflicts nothing, so nothing triggers", () => {
  const b = warBoard({ extra: [hitter("atk", "rrr", { strength: 0 })] });
  const before = infl(b);
  warFight(b, ["atk"]);
  assert.deepEqual(infl(b), before);
});

clause(WAR, "0:rule@v", "the Warmonger is itself 'a character': its own battle damage to a faction triggers it (X = its 1 threshold icon)", () => {
  const b = warBoard();
  const [a0, d0] = infl(b);
  warFight(b, ["war"]);
  assert.equal(d0 - infl(b)[1], 1, "its 1 strength hit the opponent's faction");
  assert.equal(a0 - infl(b)[0], 1, "X = 1 ([R]) hits its controller's faction");
});

clause(WAR, "0:rule@v", "only BATTLE damage: damage a character inflicts to a faction with an ability does not trigger it", () => {
  const zapper: CardDefinition = character({
    name: "Zapper",
    threshold: "rrr",
    behavior: { abilities: [{ id: "zap", type: "activated", costs: [], effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 2 }] }] }
  } as Partial<CardDefinition>);
  const b = warBoard({ extra: [{ key: "zap", def: zapper, owner: P1, zone: "play" }] });
  const [a0, d0] = infl(b);
  activate(b.engine, P1, b.id("zap"), "zap");
  assert.equal(d0 - infl(b)[1], 2, "control: the ability damaged the opponent's faction");
  assert.equal(infl(b)[0], a0, "no X damage to the zapper's controller: it was not battle damage");
});

clause(WAR, "0:rule@v", "only a CHARACTER inflicting it: a tactic's damage to a faction does not trigger it", () => {
  const burn = tactic({ name: "Burn", cost: 0, threshold: "rrr", behavior: { abilities: [{ id: "bn", type: "activated", effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 2 }] }] } } as Partial<CardDefinition>);
  const b = warBoard({ pay: [...V(1), ...R(3)], extra: [{ key: "burn", def: burn, owner: P1, zone: "hand" }] });
  const [a0, d0] = infl(b);
  play(b.engine, P1, b.id("burn"));
  assert.equal(d0 - infl(b)[1], 2, "control: the tactic damaged the opponent's faction");
  assert.equal(infl(b)[0], a0, "nothing hit my faction");
});

clause(WAR, "0:rule@v", "only while the Warmonger is in play: in hand, in the discard pile or face-down it does nothing", () => {
  for (const [label, zone] of [["in hand", "hand"], ["in the discard pile", "discard"]] as const) {
    const b = warBoard({ warZone: zone, extra: [hitter("atk", "rrr")] });
    const [a0] = infl(b);
    warFight(b, ["atk"]);
    assert.equal(a0 - infl(b)[0], 0, label);
  }
  const fd = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "war", def: printing(WAR), owner: P1, zone: "play", faceDown: true }, ...V(1), hitter("atk", "rrr")]
  });
  const a0 = influenceOf(fd.engine, P1);
  fightThrough(fd.engine, P1, [fd.id("atk")], AT_P2, []);
  assert.equal(a0 - influenceOf(fd.engine, P1), 0, "face-down: nothing");
});

clause(WAR, "0:rule@v", "each character that hits triggers separately (a party of 3 and 2 icons costs its faction 5), and a stolen attacker costs its CONTROLLER", () => {
  const b = warBoard({ extra: [hitter("a1", "rrr"), hitter("a2", "gd")] });
  const [a0] = infl(b);
  warFight(b, ["a1", "a2"]);
  assert.equal(a0 - infl(b)[0], 5, "3 + 2");
  const stolen = warBoard({ extra: [hitter("thief", "ooo", {}, { owner: P2, controller: P1 })] });
  const [m0, o0] = infl(stolen);
  warFight(stolen, ["thief"]);
  assert.equal(m0 - infl(stolen)[0], 3, "the controller's faction takes X");
  assert.equal(o0 - infl(stolen)[1], 2, "(the owner's faction takes the battle damage, being the defender)");
});

clause(WAR, "0:rule@v", "two Warmongers each trigger on the attacker's battle damage: X is dealt twice (and the X damage itself is not battle damage)", () => {
  const b = warBoard({ extra: [{ key: "war2", def: printing(WAR), owner: P1, zone: "play" }, hitter("atk", "rrr")] });
  const [a0] = infl(b);
  warFight(b, ["atk"]);
  assert.equal(a0 - infl(b)[0], 6, "3 + 3");
});

clause(WAR, "0:rule@v", "deploys for 1 with [R]: refused without [R]", () => {
  const ok = warBoard({ warZone: "hand", pay: R(1) });
  play(ok.engine, P1, ok.id("war"));
  assert.equal(zoneOf(ok.engine, ok.id("war")), "play");
  assert.deepEqual(stats(ok.engine, ok.id("war")), [1, 3, 2], "printed strength / speed / life");
  const none = warBoard({ warZone: "hand", pay: V(2) });
  refused(() => playRaw(none.engine, P1, none.id("war")), "no [R]");
  const empty = warBoard({ warZone: "hand", pay: [] });
  refused(() => playRaw(empty.engine, P1, empty.id("war")), "no resources for cost 1");
  const spentOnly = warBoard({ warZone: "hand", pay: spentResources(P1, 1) });
  refused(() => playRaw(spentOnly.engine, P1, spentOnly.id("war")), "[R] is controlled but the only resource is spent: nothing left to pay the cost of 1");
  assert.equal(zoneOf(spentOnly.engine, spentOnly.id("war")), "hand");
});

// =====================================================================================================
// Ursine Assassin — character (warlord, warbeast) · cost 4 · [R][R] · 4 / 3 / 2
// TO BEAR ARMS -- COST: Pay 1. Pick a character. Destroy a restored character you control. EFFECT: Inflict 2 damage to the character.
// JUST UNBEARABLE: [R]x6 -- COST: Pay 2. Pick a character. Destroy a restored character you control. EFFECT: Inflict 5 damage to the character.
// =====================================================================================================
const URS = "3c9d8aef-10a8-4834-af0f-fb3b3e4683c8";
const TBA = "ursine-to-bear-arms";
const JUB = "ursine-just-unbearable";

function ursBoard(o: { pay?: CardPlacement[]; extra?: CardPlacement[]; ursDepleted?: boolean; zone?: CardPlacement["zone"]; turnOf?: PlayerId } = {}) {
  const turnOf = o.turnOf ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: turnOf === P1 ? 1 : 2,
    activePlayerId: turnOf,
    cards: [{ key: "urs", def: printing(URS), owner: P1, zone: o.zone ?? "play", depleted: o.ursDepleted }, ...(o.pay ?? R(3)), ...(o.extra ?? [])]
  });
}
type UrsBoard = ReturnType<typeof ursBoard>;
const bear = (b: UrsBoard, abilityId: string, vic: string, sac: string, player: PlayerId = P1): void =>
  activate(b.engine, player, b.id("urs"), abilityId, { selected: { vic: [b.id(vic)], sac: [b.id(sac)] } });

function ursU0(abilityId: string, payN: number, damage: number, pay: () => CardPlacement[]): void {
  for (const victim of ["foeVic", "myVic"]) {
    const b = ursBoard({ pay: pay(), extra: [foe("foeVic", { life: 9 }), ally("myVic", { life: 9 }), ally("sac"), ally("bystander"), foe("foeBystander")] });
    const ready0 = readyResources(b.engine, P1);
    bear(b, abilityId, victim, "sac");
    assert.equal(b.engine.state.pendingChoice, undefined);
    assert.equal(readyResources(b.engine, P1), ready0 - payN, `paid exactly ${payN}`);
    assert.equal(zoneOf(b.engine, b.id("sac")), "discard", "the restored character was destroyed");
    assert.equal(dmg(b.engine, b.id(victim)), damage, `${victim}: exactly ${damage} damage`);
    for (const other of ["foeVic", "myVic"].filter((k) => k !== victim)) assert.equal(dmg(b.engine, b.id(other)), 0, `${other} untouched`);
    assert.equal(zoneOf(b.engine, b.id("bystander")), "play", "another restored character is not destroyed");
    assert.equal(dmg(b.engine, b.id("foeBystander")), 0);
  }
}

function ursU1(abilityId: string, payN: number, damage: number, pay: () => CardPlacement[]): void {
  const b = ursBoard({ pay: pay(), extra: [foe("dies", { life: damage }), foe("lives", { life: damage + 1 }), ally("sac1"), ally("sac2")] });
  bear(b, abilityId, "dies", "sac1");
  assert.equal(zoneOf(b.engine, b.id("dies")), "discard");
  bear(b, abilityId, "lives", "sac2");
  assert.equal(zoneOf(b.engine, b.id("lives")), "play");
  assert.equal(dmg(b.engine, b.id("lives")), damage);
}

function ursU2(abilityId: string, payN: number, damage: number, pay: () => CardPlacement[]): void {
  const b = ursBoard({
    pay: pay(),
    extra: [
      foe("vic", { life: 20 }),
      ally("sac"),
      ally("depl", {}, { depleted: true }),
      foe("foeSac"),
      { key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" }
    ]
  });
  const ready0 = readyResources(b.engine, P1);
  for (const [why, sac] of [["a depleted character", "depl"], ["the opponent's restored character", "foeSac"], ["an item", "itm"], ["a character in hand", "inHand"]] as const) {
    refused(() => bear(b, abilityId, "vic", sac), why);
  }
  refused(() => activate(b.engine, P1, b.id("urs"), abilityId, { selected: { vic: [b.id("vic")] } }), "no character to destroy");
  refused(() => activate(b.engine, P1, b.id("urs"), abilityId, { selected: { vic: [b.id("vic")], sac: [b.id("sac"), b.id("depl")] } }), "two to destroy");
  assert.equal(readyResources(b.engine, P1), ready0, "nothing paid");
  assert.equal(dmg(b.engine, b.id("vic")), 0);
  for (const k of ["sac", "depl", "foeSac", "itm"]) assert.equal(zoneOf(b.engine, b.id(k)), "play", `${k} untouched`);
  bear(b, abilityId, "vic", "sac");
  assert.equal(zoneOf(b.engine, b.id("sac")), "discard", "positive control");
}

function ursU3(abilityId: string, payN: number, damage: number, pay: () => CardPlacement[]): void {
  const b = ursBoard({
    pay: pay(),
    extra: [foe("vic", { life: 20 }), foe("vic2", { life: 20 }), ally("sac"), { key: "itm", def: item({ name: "Itm" }), owner: P2, zone: "play" }, { key: "inHand", def: character({ name: "InHand" }), owner: P2, zone: "hand" }]
  });
  refused(() => bear(b, abilityId, "itm", "sac"), "an item");
  refused(() => bear(b, abilityId, "inHand", "sac"), "a character in hand");
  refused(() => activate(b.engine, P1, b.id("urs"), abilityId, { selected: { vic: [b.engine.state.players[P2].factionId!], sac: [b.id("sac")] } }), "the faction");
  refused(() => activate(b.engine, P1, b.id("urs"), abilityId, { selected: { vic: [b.id("vic"), b.id("vic2")], sac: [b.id("sac")] } }), "two characters");
  refused(() => activate(b.engine, P1, b.id("urs"), abilityId, { selected: { sac: [b.id("sac")] } }), "no character picked");
  assert.equal(zoneOf(b.engine, b.id("sac")), "play", "the sacrifice was not made by a refused activation");
  bear(b, abilityId, "vic", "sac");
  assert.equal(dmg(b.engine, b.id("vic")), damage);
}

function ursU4(abilityId: string, payN: number, damage: number, pay: () => CardPlacement[]): void {
  const short = ursBoard({ pay: abilityId === JUB ? [...R(1), ...spentResources(P1, 5)] : [], extra: [foe("vic"), ally("sac")] });
  refused(() => bear(short, abilityId, "vic", "sac"), `${payN} to pay`);
  assert.equal(zoneOf(short.engine, short.id("sac")), "play");
  assert.equal(dmg(short.engine, short.id("vic")), 0);
  const exact = ursBoard({ pay: abilityId === JUB ? [...R(2), ...spentResources(P1, 4)] : R(1), extra: [foe("vic", { life: 9 }), ally("sac")] });
  bear(exact, abilityId, "vic", "sac");
  assert.equal(dmg(exact.engine, exact.id("vic")), damage, `exactly ${payN} ready resource${payN > 1 ? "s" : ""} is enough`);
}

function ursU5(abilityId: string, payN: number, damage: number, pay: () => CardPlacement[]): void {
  const self = ursBoard({ pay: pay(), extra: [foe("vic", { life: 20 })] });
  bear(self, abilityId, "vic", "urs");
  assert.equal(self.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(self.engine, self.id("urs")), "discard", "destroyed as the cost");
  assert.equal(dmg(self.engine, self.id("vic")), damage, "the effect still resolves");
  const asVictim = ursBoard({ pay: pay(), extra: [ally("sac")] });
  bear(asVictim, abilityId, "urs", "sac");
  assert.equal(zoneOf(asVictim.engine, asVictim.id("urs")), "discard", `${damage} damage destroys the 2-life Ursine`);
  assert.equal(zoneOf(asVictim.engine, asVictim.id("sac")), "discard");
}

function ursU6(abilityId: string, payN: number, damage: number, pay: () => CardPlacement[]): void {
  const b = ursBoard({ pay: pay(), ursDepleted: true, extra: [ally("both", { life: 9 })] });
  bear(b, abilityId, "both", "both");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("both")), "discard", "destroyed by the cost");
  assert.equal(isDepleted(b.engine, b.id("urs")), true, "still depleted: it was not part of the cost");
}

function ursU7(abilityId: string, payN: number, damage: number, pay: () => CardPlacement[]): void {
  const b = ursBoard({ pay: abilityId === JUB ? R(6) : R(3), extra: [foe("vic", { life: 20 }), ally("s1"), ally("s2")] });
  bear(b, abilityId, "vic", "s1");
  bear(b, abilityId, "vic", "s2");
  assert.equal(dmg(b.engine, b.id("vic")), damage * 2, "two uses");
  assert.equal(readyResources(b.engine, P1), (abilityId === JUB ? 6 : 3) - payN * 2);
  const opp = ursBoard({ turnOf: P2, pay: abilityId === JUB ? [...R(6), ...R(6, P2)] : [...R(3), ...R(3, P2)], extra: [foe("vic", { life: 20 }), foe("foeSac")] });
  refused(() => bear(opp, abilityId, "vic", "foeSac", P2), "the opponent does not control it");
  const hand = ursBoard({ zone: "hand", pay: pay(), extra: [foe("vic"), ally("sac")] });
  refused(() => bear(hand, abilityId, "vic", "sac"), "in hand");
}

clause(URS, "0:ability:ursine-to-bear-arms", "pays exactly 1, destroys the restored character I pick, and inflicts exactly 2 damage to the picked character (the opponent's or mine); nobody else is touched", () => ursU0(TBA, 1, 2, () => R(3)));
clause(URS, "0:ability:ursine-to-bear-arms", "2 damage destroys a character with 2 or less life, and does not destroy one with more", () => ursU1(TBA, 1, 2, () => R(3)));
clause(URS, "0:ability:ursine-to-bear-arms", "the destroyed character must be a RESTORED character I control: depleted, the opponent's, an item and nothing at all are refused (and nothing is paid or destroyed)", () => ursU2(TBA, 1, 2, () => R(3)));
clause(URS, "0:ability:ursine-to-bear-arms", "the picked character must be a character in play: not an item, the faction, a card in hand; exactly one", () => ursU3(TBA, 1, 2, () => R(3)));
clause(URS, "0:ability:ursine-to-bear-arms", "refused when 1 resource cannot be paid, and nothing is destroyed", () => ursU4(TBA, 1, 2, () => R(3)));
clause(URS, "0:ability:ursine-to-bear-arms", "Ursine Assassin can be the destroyed character (a restored character I control) and its damage still lands; it can also be the picked character and dies to the damage", () => ursU5(TBA, 1, 2, () => R(3)));
clause(URS, "0:ability:ursine-to-bear-arms", "no deplete is part of the cost: a depleted Ursine Assassin can use it; the same character may be both picked and destroyed", () => ursU6(TBA, 1, 2, () => R(3)));
clause(URS, "0:ability:ursine-to-bear-arms", "usable repeatedly (each use pays and destroys again, damage adds up); only its controller, and only while in play", () => ursU7(TBA, 1, 2, () => R(3)));

clause(URS, "1:ability:ursine-just-unbearable", "pays exactly 2, destroys the restored character I pick, and inflicts exactly 5 damage to the picked character (the opponent's or mine); nobody else is touched", () => ursU0(JUB, 2, 5, () => R(6)));
clause(URS, "1:ability:ursine-just-unbearable", "5 damage destroys a character with 5 or less life, and does not destroy one with more", () => ursU1(JUB, 2, 5, () => R(6)));
clause(URS, "1:ability:ursine-just-unbearable", "the destroyed character must be a RESTORED character I control: depleted, the opponent's, an item and nothing at all are refused (and nothing is paid or destroyed)", () => ursU2(JUB, 2, 5, () => R(6)));
clause(URS, "1:ability:ursine-just-unbearable", "the picked character must be a character in play: not an item, the faction, a card in hand; exactly one", () => ursU3(JUB, 2, 5, () => R(6)));
clause(URS, "1:ability:ursine-just-unbearable", "refused when 2 resources cannot be paid, and nothing is destroyed", () => ursU4(JUB, 2, 5, () => R(6)));
clause(URS, "1:ability:ursine-just-unbearable", "Ursine Assassin can be the destroyed character (a restored character I control) and its damage still lands; it can also be the picked character and dies to the damage", () => ursU5(JUB, 2, 5, () => R(6)));
clause(URS, "1:ability:ursine-just-unbearable", "no deplete is part of the cost: a depleted Ursine Assassin can use it; the same character may be both picked and destroyed", () => ursU6(JUB, 2, 5, () => R(6)));
clause(URS, "1:ability:ursine-just-unbearable", "usable repeatedly (each use pays and destroys again, damage adds up); only its controller, and only while in play", () => ursU7(JUB, 2, 5, () => R(6)));

clause(URS, "0:ability:ursine-to-bear-arms", "TO BEAR ARMS has no threshold: usable with a single non-Rage resource", () => {
  const b = ursBoard({ pay: V(1), extra: [foe("vic", { life: 9 }), ally("sac")] });
  bear(b, TBA, "vic", "sac");
  assert.equal(dmg(b.engine, b.id("vic")), 2);
  assert.equal(readyResources(b.engine, P1), 0);
});

clause(URS, "1:ability:ursine-just-unbearable", "needs [R][R][R][R][R][R]: refused with only five (however many other resources), or with the opponent's Rage; six is enough", () => {
  const ok = ursBoard({ pay: R(6), extra: [foe("vic", { life: 9 }), ally("sac")] });
  bear(ok, JUB, "vic", "sac");
  assert.equal(dmg(ok.engine, ok.id("vic")), 5);
  assert.equal(readyResources(ok.engine, P1), 4, "paid 2 of 6");
  for (const [label, pay] of [
    ["five Rage and lots of other resources", [...R(5), ...V(5)]],
    ["no Rage", V(8)],
    ["the opponent's Rage", [...R(3), ...R(6, P2)]]
  ] as const) {
    const b = ursBoard({ pay: [...pay], extra: [foe("vic", { life: 9 }), ally("sac")] });
    refused(() => bear(b, JUB, "vic", "sac"), label);
    assert.equal(zoneOf(b.engine, b.id("sac")), "play", `${label}: nothing destroyed`);
    assert.equal(dmg(b.engine, b.id("vic")), 0);
  }
});

clause(URS, "1:ability:ursine-just-unbearable", "the threshold counts spent Rage too, but the 2 must still be payable from ready resources", () => {
  const b = ursBoard({ pay: [...R(2), ...spentResources(P1, 4)], extra: [foe("vic", { life: 9 }), ally("sac")] });
  assert.equal(readyResources(b.engine, P1), 2);
  bear(b, JUB, "vic", "sac");
  assert.equal(dmg(b.engine, b.id("vic")), 5, "six Rage icons controlled (four spent) and two ready to pay");
});

clause(URS, "0:ability:ursine-to-bear-arms", "deploys for 4 with [R][R] (printed 4 / 3 / 2): refused one short and without both [R]", () => {
  const build = (pay: CardPlacement[]) => ursBoard({ zone: "hand", pay });
  const ok = build(R(4));
  play(ok.engine, P1, ok.id("urs"));
  assert.equal(zoneOf(ok.engine, ok.id("urs")), "play");
  assert.deepEqual(stats(ok.engine, ok.id("urs")), [4, 3, 2]);
  assert.equal(readyResources(ok.engine, P1), 0, "paid exactly 4");
  const short = build(R(3));
  refused(() => playRaw(short.engine, P1, short.id("urs")), "one short");
  const oneR = build([...R(1), ...V(5)]);
  refused(() => playRaw(oneR.engine, P1, oneR.id("urs")), "one [R] for [R][R]");
});

// =====================================================================================================
// Warbeast of Thabbash — character (warlord, warbeast) · cost 5 · [R] · 0 / 3 / 0
// This card gains 1 strength and 1 life for each [V] you control.
// =====================================================================================================
const WB = "445dfe70-c2f5-4ec9-8e44-385cb5cc24ff";

function wbBoard(o: { pay?: CardPlacement[]; extra?: CardPlacement[]; zone?: CardPlacement["zone"]; turnOf?: PlayerId } = {}) {
  const turnOf = o.turnOf ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: turnOf === P1 ? 1 : 2,
    activePlayerId: turnOf,
    cards: [{ key: "wb", def: printing(WB), owner: P1, zone: o.zone ?? "play" }, ...(o.pay ?? []), ...(o.extra ?? [])]
  });
}
type WbBoard = ReturnType<typeof wbBoard>;
/** A free tactic that moves one chosen resource in play to its owner's discard pile (id `drop`, pick `r`). */
const dropResource = (): CardDefinition =>
  tactic({
    name: "DropResource",
    cost: 0,
    behavior: { abilities: [{ id: "drop", type: "activated", targets: [{ id: "r", selector: { zone: "play", type: "resource" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "r" }, to: "discard" }] }] }
  });
const wbStats = (b: WbBoard): number[] => stats(b.engine, b.id("wb"));

clause(WB, "0:rule", "gains 1 strength and 1 life for each [V] I control: 1, 3 and 5 [V] give 1/3/1, 3/3/3, 5/3/5 (speed stays 3)", () => {
  for (const n of [1, 3, 5]) {
    const b = wbBoard({ pay: V(n) });
    assert.deepEqual(wbStats(b), [n, 3, n], `${n} [V]`);
  }
});

clause(WB, "0:rule", "only [V] counts: Rage, Greed and the other icons add nothing, nor does the opponent's Volition or the opponent's face-down cards", () => {
  const b = wbBoard({ pay: [...V(2), ...R(4), ...bank("greed", 3, P1), ...V(5, P2), ...R(2, P2)] });
  assert.deepEqual(wbStats(b), [2, 3, 2], "only my two [V]");
});

clause(WB, "0:rule", "spent (attached) [V] resources are still [V] I control", () => {
  const b = wbBoard({ pay: [...V(1), ...spentV(2)] });
  assert.equal(readyResources(b.engine, P1), 1);
  assert.deepEqual(wbStats(b), [3, 3, 3]);
});

clause(WB, "0:rule", "it is on THIS card only: another character gets nothing, and two Warbeasts each count the [V] once", () => {
  const b = wbBoard({ pay: V(3), extra: [ally("ally", { strength: 1, life: 4, speed: 2 }), { key: "wb2", def: printing(WB), owner: P1, zone: "play" }] });
  assert.deepEqual(stats(b.engine, b.id("ally")), [1, 2, 4], "the ally keeps its own stats");
  assert.deepEqual(wbStats(b), [3, 3, 3]);
  assert.deepEqual(stats(b.engine, b.id("wb2")), [3, 3, 3], "the second Warbeast counts the same 3 [V]; they do not feed each other");
});

clause(WB, "0:rule", "it tracks the [V] count live: losing a [V] shrinks it, and damage taken this turn then destroys it once it exceeds the new life", () => {
  const scorch = (n: number) =>
    tactic({
      name: `Scorch${n}`,
      cost: 0,
      behavior: { abilities: [{ id: "sc", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: n }] }] }
    });
  const mk = () => wbBoard({ pay: V(3), extra: [{ key: "drop1", def: dropResource(), owner: P1, zone: "hand" }, { key: "sc", def: scorch(2), owner: P1, zone: "hand" }] });
  const dropOne = (b: WbBoard): void => {
    const res = b.engine.state.players[P1].play.filter((c) => b.engine.isResource(c) && b.engine.state.cards[c].ownerId === P1 && c !== b.engine.state.players[P1].factionId);
    play(b.engine, P1, b.id("drop1"), { selected: { r: [res[0]] } });
  };
  const a = mk();
  assert.deepEqual(wbStats(a), [3, 3, 3]);
  dropOne(a);
  assert.deepEqual(wbStats(a), [2, 3, 2], "one [V] gone: shrinks to 2 / 3 / 2");
  assert.equal(zoneOf(a.engine, a.id("wb")), "play");
  play(a.engine, P1, a.id("sc"), { selected: { t: [a.id("wb")] } });
  assert.equal(zoneOf(a.engine, a.id("wb")), "discard", "2 damage kills it at its new life of 2");
  const b = mk();
  play(b.engine, P1, b.id("sc"), { selected: { t: [b.id("wb")] } });
  assert.equal(zoneOf(b.engine, b.id("wb")), "play", "2 damage does not kill a 3-life Warbeast");
  assert.equal(dmg(b.engine, b.id("wb")), 2);
  dropOne(b);
  assert.equal(zoneOf(b.engine, b.id("wb")), "discard", "its life fell to 2 with 2 damage on it: destroyed");
});

clause(WB, "0:rule", "its life is the [V] count: 3 [V] survive 2 damage and die to 3", () => {
  const sc = (n: number) =>
    tactic({
      name: `Scorch${n}`,
      cost: 0,
      behavior: { abilities: [{ id: "sc", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: n }] }] }
    });
  const lives = wbBoard({ pay: V(3), extra: [{ key: "sc", def: sc(2), owner: P1, zone: "hand" }] });
  play(lives.engine, P1, lives.id("sc"), { selected: { t: [lives.id("wb")] } });
  assert.equal(zoneOf(lives.engine, lives.id("wb")), "play", "2 damage vs life 3");
  const dies = wbBoard({ pay: V(3), extra: [{ key: "sc", def: sc(3), owner: P1, zone: "hand" }] });
  play(dies.engine, P1, dies.id("sc"), { selected: { t: [dies.id("wb")] } });
  assert.equal(zoneOf(dies.engine, dies.id("wb")), "discard", "3 damage vs life 3");
});

clause(WB, "0:rule", "deploys for 5 with [R]; its stats count the spent [V] used to pay for it", () => {
  const ok = wbBoard({ zone: "hand", pay: [...R(1), ...V(4)] });
  play(ok.engine, P1, ok.id("wb"));
  assert.equal(zoneOf(ok.engine, ok.id("wb")), "play");
  assert.equal(readyResources(ok.engine, P1), 0, "paid exactly 5");
  assert.deepEqual(wbStats(ok), [4, 3, 4], "four [V] (all spent on it) give 4 / 3 / 4");
  const short = wbBoard({ zone: "hand", pay: [...R(1), ...V(3)] });
  refused(() => playRaw(short.engine, P1, short.id("wb")), "four resources for cost 5");
  const noR = wbBoard({ zone: "hand", pay: V(6) });
  refused(() => playRaw(noR.engine, P1, noR.id("wb")), "no [R]");
});

clause(WB, "0:rule", "with no [V] it has 0 life and (CR 408.4: damage this turn, 0, is not less than life 0) it is destroyed at once", () => {
  const b = wbBoard({ zone: "hand", pay: R(5) });
  play(b.engine, P1, b.id("wb"));
  assert.equal(zoneOf(b.engine, b.id("wb")), "discard", "a 0-life character is destroyed immediately");
});

// =====================================================================================================
// Words of Glory — tactic · cost 7 · [R][R][R][R][R][R]
// COST: Play this only during your turn and not during a battle. EFFECT: X is the total strength of all
// characters your opponents control. Inflict X-3 damage to all characters.
// =====================================================================================================
const WOG = "10d5c7f3-17fe-423e-95c7-b73715b61bc6";

function wogBoard(o: { pay?: CardPlacement[]; extra?: CardPlacement[]; turnOf?: PlayerId } = {}) {
  const turnOf = o.turnOf ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: turnOf === P1 ? 1 : 2,
    activePlayerId: turnOf,
    cards: [{ key: "wog", def: printing(WOG), owner: turnOf, zone: "hand" }, ...(o.pay ?? R(7)), ...(o.extra ?? [])]
  });
}
type WogBoard = ReturnType<typeof wogBoard>;
const big = (key: string, strength: number, owner: PlayerId, extra: Partial<CardPlacement> = {}, over: Partial<CardDefinition> = {}): CardPlacement => ({
  key,
  def: character({ name: key, strength, life: 20, speed: 2, ...over }),
  owner,
  zone: "play",
  ...extra
});

clause(WOG, "0:ability", "costs 7 with [R]x6: exactly 7 resources pay it all; refused one resource short or with only five [R]", () => {
  const ok = wogBoard();
  play(ok.engine, P1, ok.id("wog"));
  assert.equal(zoneOf(ok.engine, ok.id("wog")), "discard", "a resolved tactic goes to the discard pile");
  assert.equal(readyResources(ok.engine, P1), 0, "paid exactly 7");
  const short = wogBoard({ pay: R(6) });
  refused(() => playRaw(short.engine, P1, short.id("wog")), "six resources for cost 7");
  const fiveR = wogBoard({ pay: [...R(5), ...V(3)] });
  refused(() => playRaw(fiveR.engine, P1, fiveR.id("wog")), "eight resources but only five [R]");
  const opp = wogBoard({ pay: [...R(5), ...R(6, P2)] });
  refused(() => playRaw(opp.engine, P1, opp.id("wog")), "the opponent's Rage does not count");
  assert.equal(zoneOf(short.engine, short.id("wog")), "hand");
});

clause(WOG, "0:ability", "X is the opponent's total strength; every character takes X-3: X = 10 deals 7 to all (mine, theirs, depleted ones), X = 4 deals 1", () => {
  for (const [opp, expected] of [[[5, 5], 7], [[4], 1], [[2, 2], 1], [[7, 3, 1], 8]] as const) {
    const b = wogBoard({
      extra: [
        ...opp.map((s, i) => big(`o${i}`, s, P2)),
        big("mine", 9, P1),
        big("mineDepl", 0, P1, { depleted: true }),
        big("oppDepl", 0, P2, { depleted: true })
      ]
    });
    play(b.engine, P1, b.id("wog"));
    assert.equal(b.engine.state.pendingChoice, undefined);
    const all = ["mine", "mineDepl", "oppDepl", ...opp.map((_, i) => `o${i}`)];
    for (const k of all) assert.equal(dmg(b.engine, b.id(k)), expected, `X=${opp.reduce((a, c) => a + c, 0)}: ${k} took ${expected}`);
  }
});

clause(WOG, "0:ability", "X-3 never goes below 0: X = 0, 2 and 3 deal nothing and heal nothing", () => {
  for (const opp of [[], [2], [3], [1, 1]]) {
    const b = wogBoard({ extra: [...opp.map((s, i) => big(`o${i}`, s, P2, { damage: 1 })), big("mine", 5, P1, { damage: 2 })] });
    play(b.engine, P1, b.id("wog"));
    assert.equal(dmg(b.engine, b.id("mine")), 2, `X=${opp.reduce((a, c) => a + c, 0)}: my preset damage is unchanged`);
    opp.forEach((_, i) => assert.equal(dmg(b.engine, b.id(`o${i}`)), 1, "not healed"));
  }
});

clause(WOG, "0:ability", "only the opponents' characters add to X: my own strong characters, and a character I control but they own, do not; one they control but I own does", () => {
  const b = wogBoard({
    extra: [
      big("mine", 8, P1),
      big("stolenFromThem", 6, P2, { controller: P1 }),
      big("stolenFromMe", 4, P1, { controller: P2 }),
      big("theirs", 1, P2)
    ]
  });
  play(b.engine, P1, b.id("wog"));
  // X = 4 + 1 = 5 -> 2 damage to every character
  for (const k of ["mine", "stolenFromThem", "stolenFromMe", "theirs"]) assert.equal(dmg(b.engine, b.id(k)), 2, `${k}: X = 5, so 2`);
});

clause(WOG, "0:ability", "X uses their current strength (a +3 strength effect counts)", () => {
  const buffed = (): CardDefinition =>
    character({
      name: "Buffed",
      strength: 1,
      life: 20,
      speed: 2,
      behavior: { abilities: [{ id: "buff", type: "continuous", modifiers: [{ target: "source", stat: "strength", operation: "add", value: 3 }] }] }
    } as Partial<CardDefinition>);
  const b = wogBoard({ extra: [{ key: "buffed", def: buffed(), owner: P2, zone: "play" }, big("mine", 0, P1)] });
  assert.equal(b.engine.getStat(b.id("buffed"), "strength"), 4, "the buff applies");
  play(b.engine, P1, b.id("wog"));
  assert.equal(dmg(b.engine, b.id("mine")), 1, "X = 4, so X-3 = 1");
  assert.equal(dmg(b.engine, b.id("buffed")), 1);
});

clause(WOG, "0:ability", "only characters in play are hit: items, resources, factions, and characters in hand, deck and discard are untouched", () => {
  const b = wogBoard({
    pay: [...R(7), ...V(2)],
    extra: [
      big("o0", 10, P2),
      { key: "itm", def: item({ name: "Itm" }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "InHand", life: 20 }), owner: P1, zone: "hand" },
      { key: "inDeck", def: character({ name: "InDeck", life: 20 }), owner: P2, zone: "deck" },
      { key: "inDisc", def: character({ name: "InDisc", life: 20 }), owner: P2, zone: "discard" }
    ]
  });
  const infl0 = [influenceOf(b.engine, P1), influenceOf(b.engine, P2)];
  play(b.engine, P1, b.id("wog"));
  assert.equal(dmg(b.engine, b.id("o0")), 7);
  for (const k of ["itm", "inHand", "inDeck", "inDisc"]) assert.equal(dmg(b.engine, b.id(k)), 0, `${k} untouched`);
  assert.deepEqual([influenceOf(b.engine, P1), influenceOf(b.engine, P2)], infl0, "factions untouched");
  assert.equal(b.engine.state.players[P1].play.filter((c) => b.engine.isResource(c)).length >= 2, true, "resources untouched");
});

clause(WOG, "0:ability", "X is fixed before any damage: characters that die do not shrink X, and those with life 7 die while life 8 survive", () => {
  const b = wogBoard({ extra: [big("o0", 5, P2, {}, { life: 1 }), big("o1", 5, P2, {}, { life: 1 }), big("mine7", 0, P1, {}, { life: 7 }), big("mine8", 0, P1, {}, { life: 8 })] });
  play(b.engine, P1, b.id("wog"));
  assert.equal(zoneOf(b.engine, b.id("o0")), "discard");
  assert.equal(zoneOf(b.engine, b.id("o1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("mine7")), "discard", "7 damage kills a 7-life character");
  assert.equal(zoneOf(b.engine, b.id("mine8")), "play");
  assert.equal(dmg(b.engine, b.id("mine8")), 7, "X was 10 for everyone, even after the opponent's characters died");
});

/** A free, harmless tactic: a positive control that tactics CAN be played in the same spot. */
const freeTactic = (): CardDefinition => tactic({ name: "Free", cost: 0, behavior: { abilities: [{ id: "fr", type: "activated", effects: [{ type: "shuffleDeck", player: "controller" }] }] } });
/** Their turn, their attack declared, and I hold priority in the response window. */
function oppWindow(cardId: string, extra: CardPlacement[] = []) {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [{ key: "x", def: printing(cardId), owner: P1, zone: "hand" }, { key: "free", def: freeTactic(), owner: P1, zone: "hand" }, ...R(7), { key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" }, ...extra]
  });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  assert.equal(b.engine.state.priorityPlayerId, P1, "I hold priority in their window");
  return b;
}

clause(WOG, "0:ability", "only during my turn: refused in my opponent's turn (with priority in their response window) while an unrestricted tactic is playable there; works in mine", () => {
  const ok = wogBoard({ extra: [big("o0", 5, P2)] });
  play(ok.engine, P1, ok.id("wog"));
  assert.equal(zoneOf(ok.engine, ok.id("wog")), "discard", "control: on my turn it works");
  // No battle here: they played a tactic and I hold priority in the window for it, in THEIR turn.
  const quiet = () => {
    const q = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      activePlayerId: P2,
      cards: [{ key: "x", def: printing(WOG), owner: P1, zone: "hand" }, { key: "free", def: freeTactic(), owner: P1, zone: "hand" }, { key: "theirFree", def: freeTactic(), owner: P2, zone: "hand" }, ...R(7), big("o0", 5, P2)]
    });
    playRaw(q.engine, P2, q.id("theirFree"));
    if (q.engine.state.priorityPlayerId === P2) q.engine.perform({ type: "passPriority", playerId: P2 });
    assert.equal(q.engine.state.priorityPlayerId, P1, "I hold priority in their turn");
    assert.equal(q.engine.state.battle, undefined, "and there is no battle");
    return q;
  };
  const control = quiet();
  playRaw(control.engine, P1, control.id("free"));
  const b = quiet();
  const before = readyResources(b.engine, P1);
  refused(() => playRaw(b.engine, P1, b.id("x")), "their turn, no battle");
  assert.equal(zoneOf(b.engine, b.id("x")), "hand");
  assert.equal(readyResources(b.engine, P1), before, "nothing paid");
});

clause(WOG, "0:ability", "not during a battle: refused while my attack is under way (an unrestricted tactic is playable then); fine again once the battle is over", () => {
  const mk = () => {
    const b = wogBoard({ extra: [big("atk", 1, P1), big("o0", 5, P2), { key: "free", def: freeTactic(), owner: P1, zone: "hand" }] });
    declareAttackBy(b.engine, P1, [b.id("atk")], AT_P2);
    declareBlockers(b.engine, P2, []);
    assert.ok(b.engine.state.battle, "a battle is under way");
    return b;
  };
  const control = mk();
  playRaw(control.engine, P1, control.id("free"));
  const b = mk();
  const before = readyResources(b.engine, P1);
  refused(() => playRaw(b.engine, P1, b.id("wog")), "during a battle");
  assert.equal(zoneOf(b.engine, b.id("wog")), "hand");
  assert.equal(readyResources(b.engine, P1), before, "nothing paid");
  finishBattle(b.engine);
  play(b.engine, P1, b.id("wog"));
  assert.equal(zoneOf(b.engine, b.id("wog")), "discard", "after the battle it can be played (same turn)");
});

// =====================================================================================================
// Shriever Breeding Program — tactic · cost 3 · [R][R]
// Choose one of the following as this card's rules text:
// OPTION 1 -- COST: Play this only during your turn. EFFECT: You may search your deck for a "dragon" card and reveal it. If you do, put it into your hand.
// OPTION 2 -- COST: Play this only during your turn. Pick a character. EFFECT: Deplete the character. Draw a card.
// =====================================================================================================
const SBP = "cb39b1ed-d160-4760-8c2d-5337b9ea74ec";

function sbpBoard(o: { pay?: CardPlacement[]; extra?: CardPlacement[]; turnOf?: PlayerId; random?: () => number } = {}) {
  const turnOf = o.turnOf ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: turnOf === P1 ? 1 : 2,
    activePlayerId: turnOf,
    random: o.random,
    cards: [{ key: "sbp", def: printing(SBP), owner: turnOf, zone: "hand" }, ...(o.pay ?? R(3)), ...(o.extra ?? [])]
  });
}
type SbpBoard = ReturnType<typeof sbpBoard>;
const dragonDeck = (): CardPlacement[] => [
  { key: "drg", def: character({ name: "Dragon", subtype: ["dragon"] } as Partial<CardDefinition>), owner: P1, zone: "deck" },
  { key: "drg2", def: character({ name: "Dragon Two", subtype: ["warbeast", "dragon"] } as Partial<CardDefinition>), owner: P1, zone: "deck" },
  { key: "drgItem", def: item({ name: "Dragon Hoard", subtype: ["dragon"] } as Partial<CardDefinition>), owner: P1, zone: "deck" },
  { key: "worm", def: character({ name: "Worm", subtype: ["worm"] } as Partial<CardDefinition>), owner: P1, zone: "deck" },
  { key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "deck" },
  ...fillers("f", 6, P1, "deck"),
  { key: "oppDrg", def: character({ name: "Opp Dragon", subtype: ["dragon"] } as Partial<CardDefinition>), owner: P2, zone: "deck" },
  ...fillers("g", 4, P2, "deck"),
  { key: "handDrg", def: character({ name: "Hand Dragon", subtype: ["dragon"] } as Partial<CardDefinition>), owner: P1, zone: "hand" },
  { key: "discDrg", def: character({ name: "Disc Dragon", subtype: ["dragon"] } as Partial<CardDefinition>), owner: P1, zone: "discard" }
];

clause(SBP, "0:rule", "costs 3 with [R][R] whichever option is chosen; refused one short and with only one [R]; an unknown option is refused", () => {
  for (const mode of [0, 1]) {
    const mk = (pay: CardPlacement[]) => sbpBoard({ pay, extra: [...fillers("d", 3, P1, "deck"), ally("t")] });
    const cast = (b: SbpBoard) => playRaw(b.engine, P1, b.id("sbp"), { mode, selected: mode === 0 ? {} : { ch: [b.id("t")] } });
    const ok = mk(R(3));
    cast(ok);
    assert.equal(readyResources(ok.engine, P1), 0, `mode ${mode}: paid exactly 3`);
    const short = mk(R(2));
    refused(() => cast(short), `mode ${mode}: two resources`);
    assert.equal(zoneOf(short.engine, short.id("sbp")), "hand");
    const oneR = mk([...R(1), ...V(4)]);
    refused(() => cast(oneR), `mode ${mode}: one [R]`);
  }
  const b = sbpBoard({ extra: [ally("t")] });
  refused(() => playRaw(b.engine, P1, b.id("sbp"), { mode: 2, selected: {} }), "no third option");
  refused(() => playRaw(b.engine, P1, b.id("sbp"), { mode: -1, selected: {} }), "no negative option");
  assert.equal(zoneOf(b.engine, b.id("sbp")), "hand");
  assert.equal(readyResources(b.engine, P1), 3, "nothing paid");
});

clause(SBP, "0:rule", "one option only: choosing OPTION 1 neither depletes nor draws, choosing OPTION 2 searches nothing", () => {
  const one = sbpBoard({ extra: [...dragonDeck(), ally("t")], random: seededRandom() });
  const handBefore = [...handOf(one.engine, P1)];
  play(one.engine, P1, one.id("sbp"), { mode: 0, selected: { c: [one.id("drg")] } });
  assert.equal(isDepleted(one.engine, one.id("t")), false, "option 1 deplete nothing");
  assert.deepEqual(handOf(one.engine, P1).filter((c) => !handBefore.includes(c)), [one.id("drg")], "option 1 draws nothing: only the found card joins the hand");
  const two = sbpBoard({ extra: [...dragonDeck(), ally("t")], random: seededRandom() });
  const deckBefore = [...deckOf(two.engine, P1)];
  const twoHandBefore = [...handOf(two.engine, P1)];
  play(two.engine, P1, two.id("sbp"), { mode: 1, selected: { ch: [two.id("t")] } });
  assert.deepEqual(handOf(two.engine, P1).filter((c) => !twoHandBefore.includes(c)), [deckBefore[0]], "option 2 draws exactly the top card and finds nothing else");
  assert.deepEqual([...deckOf(two.engine, P1)], deckBefore.slice(1), "option 2 does not search or shuffle the deck");
});

clause(SBP, "0:rule", "a play must choose one of the two options: playing without choosing one is refused (no silent default)", () => {
  const b = sbpBoard({ extra: [ally("t")] });
  refused(() => playRaw(b.engine, P1, b.id("sbp"), { selected: {} }), "no option chosen");
  assert.equal(zoneOf(b.engine, b.id("sbp")), "hand");
  assert.equal(readyResources(b.engine, P1), 3, "nothing paid");
});

clause(SBP, "1:option:OPTION 1", "searches my deck for a dragon card (character, item, any 'dragon' among several subtypes), reveals it and puts it into my hand; the deck is shuffled", () => {
  for (const key of ["drg", "drg2", "drgItem"]) {
    const b = sbpBoard({ extra: dragonDeck(), random: seededRandom() });
    const deckBefore = [...deckOf(b.engine, P1)];
    const oppBefore = [...deckOf(b.engine, P2)];
    const handBefore = [...handOf(b.engine, P1)];
    play(b.engine, P1, b.id("sbp"), { mode: 0, selected: { c: [b.id(key)] } });
    assert.equal(b.engine.state.pendingChoice, undefined, key);
    assert.equal(zoneOf(b.engine, b.id(key)), "hand", `${key} is in my hand`);
    assert.deepEqual([...handOf(b.engine, P1)].sort(), [...handBefore.filter((c) => c !== b.id("sbp")), b.id(key)].sort(), "only the found card joins the hand");
    assert.deepEqual(revealed(b.engine).map((r) => r.cardIds), [[b.id(key)]], "revealed");
    assert.equal(zoneOf(b.engine, b.id("sbp")), "discard", "the tactic is spent");
    const rest = deckBefore.filter((c) => c !== b.id(key));
    assert.deepEqual([...deckOf(b.engine, P1)].sort(), [...rest].sort(), "only the found card left the deck");
    assert.notDeepEqual(deckOf(b.engine, P1), rest, "the searched deck is shuffled (CR 312.1)");
    assert.deepEqual(deckOf(b.engine, P2), oppBefore, "the opponent's deck is not shuffled");
    assert.equal(zoneOf(b.engine, b.id("drg" === key ? "drg2" : "drg")), "deck", "just one card is taken");
  }
});

clause(SBP, "1:option:OPTION 1", "the find must be a dragon card in MY deck: other subtypes, no subtype, the opponent's dragon, a dragon in hand or discard, and two cards are refused", () => {
  const b = sbpBoard({ extra: dragonDeck(), random: seededRandom() });
  const attempt = (...keys: string[]) => () => play(b.engine, P1, b.id("sbp"), { mode: 0, selected: { c: keys.map((k) => b.id(k)) } });
  refused(attempt("worm"), "a worm");
  refused(attempt("plain"), "no subtype");
  refused(attempt("oppDrg"), "the opponent's dragon");
  refused(attempt("handDrg"), "a dragon in my hand");
  refused(attempt("discDrg"), "a dragon in my discard pile");
  refused(attempt("drg", "drg2"), "two cards");
  assert.equal(zoneOf(b.engine, b.id("sbp")), "hand", "nothing was played");
  assert.equal(readyResources(b.engine, P1), 3, "nothing paid");
  attempt("drg")();
  assert.equal(zoneOf(b.engine, b.id("drg")), "hand", "positive control");
});

clause(SBP, "1:option:OPTION 1", "'you may': finding nothing is allowed even with a dragon in the deck (no reveal), and the deck is still shuffled; with no dragon at all it fails the same way", () => {
  const b = sbpBoard({ extra: dragonDeck(), random: seededRandom() });
  const deckBefore = [...deckOf(b.engine, P1)];
  play(b.engine, P1, b.id("sbp"), { mode: 0, selected: {} });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("drg")), "deck");
  assert.equal(revealed(b.engine).length, 0, "nothing revealed");
  assert.equal(zoneOf(b.engine, b.id("sbp")), "discard", "the tactic still resolves");
  assert.deepEqual([...deckOf(b.engine, P1)].sort(), [...deckBefore].sort());
  assert.notDeepEqual(deckOf(b.engine, P1), deckBefore, "a failed search still shuffles (CR 312.1)");
  const none = sbpBoard({ extra: [...fillers("f", 8, P1, "deck")], random: seededRandom() });
  const noneBefore = [...deckOf(none.engine, P1)];
  play(none.engine, P1, none.id("sbp"), { mode: 0, selected: {} });
  assert.equal(zoneOf(none.engine, none.id("sbp")), "discard");
  assert.equal(handOf(none.engine, P1).length, 0);
  assert.notDeepEqual(deckOf(none.engine, P1), noneBefore, "no dragon: the search fails and the deck is shuffled");
});

clause(SBP, "1:option:OPTION 1", "only during my turn: refused in my opponent's turn (with priority in their response window, where an unrestricted tactic is playable)", () => {
  const control = oppWindow(SBP);
  playRaw(control.engine, P1, control.id("free"));
  const b = oppWindow(SBP, dragonDeck());
  refused(() => playRaw(b.engine, P1, b.id("x"), { mode: 0, selected: { c: [b.id("drg")] } }), "their turn");
  assert.equal(zoneOf(b.engine, b.id("x")), "hand");
  assert.equal(readyResources(b.engine, P1), 7, "nothing paid");
});

clause(SBP, "2:option:OPTION 2", "depletes the picked character (mine or the opponent's) and I draw a card: the top card of MY deck", () => {
  for (const key of ["mine", "theirs"]) {
    const b = sbpBoard({ extra: [ally("mine"), foe("theirs"), ally("other"), ...fillers("d", 5, P1, "deck"), ...fillers("e", 5, P2, "deck")] });
    const deck0 = [...deckOf(b.engine, P1)];
    const oppDeck0 = [...deckOf(b.engine, P2)];
    play(b.engine, P1, b.id("sbp"), { mode: 1, selected: { ch: [b.id(key)] } });
    assert.equal(b.engine.state.pendingChoice, undefined);
    assert.equal(isDepleted(b.engine, b.id(key)), true, `${key} is depleted`);
    assert.equal(isDepleted(b.engine, b.id("other")), false, "another character is untouched");
    assert.deepEqual(handOf(b.engine, P1), [deck0[0]], "I drew the top card");
    assert.deepEqual(deckOf(b.engine, P1), deck0.slice(1));
    assert.deepEqual(deckOf(b.engine, P2), oppDeck0, "the opponent drew nothing");
    assert.equal(zoneOf(b.engine, b.id("sbp")), "discard");
    assert.equal(readyResources(b.engine, P1), 0, "paid 3");
  }
});

clause(SBP, "2:option:OPTION 2", "an already depleted character is a legal pick (it stays depleted) and I still draw", () => {
  const b = sbpBoard({ extra: [ally("dep", {}, { depleted: true }), ...fillers("d", 3, P1, "deck")] });
  const deck0 = [...deckOf(b.engine, P1)];
  play(b.engine, P1, b.id("sbp"), { mode: 1, selected: { ch: [b.id("dep")] } });
  assert.equal(isDepleted(b.engine, b.id("dep")), true);
  assert.deepEqual(handOf(b.engine, P1), [deck0[0]], "still draws");
});

clause(SBP, "2:option:OPTION 2", "a character in play must be picked: not an item, a resource, the faction, a card in hand or deck, nothing, or two", () => {
  const b = sbpBoard({
    extra: [ally("mine"), foe("theirs"), { key: "itm", def: item({ name: "Itm" }), owner: P2, zone: "play" }, { key: "inHand", def: character({ name: "InHand" }), owner: P2, zone: "hand" }, ...fillers("d", 3, P1, "deck")]
  });
  const attempt = (...ids: string[]) => () => play(b.engine, P1, b.id("sbp"), { mode: 1, selected: { ch: ids } });
  refused(attempt(b.id("itm")), "an item");
  refused(attempt(b.id("inHand")), "a character in hand");
  refused(attempt(b.engine.state.players[P2].factionId!), "a faction");
  refused(attempt(b.id("mine"), b.id("theirs")), "two characters");
  refused(attempt(), "no pick");
  assert.equal(zoneOf(b.engine, b.id("sbp")), "hand");
  assert.equal(readyResources(b.engine, P1), 3, "nothing paid");
  attempt(b.id("theirs"))();
  assert.equal(isDepleted(b.engine, b.id("theirs")), true, "positive control");
});

clause(SBP, "2:option:OPTION 2", "only during my turn: refused in my opponent's turn (with priority in their response window, where an unrestricted tactic is playable)", () => {
  const control = oppWindow(SBP);
  playRaw(control.engine, P1, control.id("free"));
  const b = oppWindow(SBP, [ally("mine"), ...fillers("d", 3, P1, "deck")]);
  refused(() => playRaw(b.engine, P1, b.id("x"), { mode: 1, selected: { ch: [b.id("mine")] } }), "their turn");
  assert.equal(zoneOf(b.engine, b.id("x")), "hand");
  assert.equal(isDepleted(b.engine, b.id("mine")), false);
  assert.equal(readyResources(b.engine, P1), 7, "nothing paid");
});
