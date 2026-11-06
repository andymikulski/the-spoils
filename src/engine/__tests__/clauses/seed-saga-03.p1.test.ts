// Clause tests, batch seed-saga-03, part p1 (groups 1-8, missing clauses only).
// Perturb, Perturbatious Warlock, Reality Shift, Redonkulous, Rouse, Stupidify, Thabbashite Wizard, Titillated Mooncalf.
import assert from "node:assert/strict";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import { buildGame, activate, bank, character, developFaction, item, location, play, resourceCard, tactic, P1, P2 } from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { answerPending, fillers, pending, readyResources, zoneOf } from "./_board.js";
import { developResource, endTurn } from "./_turn.js";

const PERTURB = "7b12a2d9-6874-4141-8028-66581431090a"; // tactic arcanist cost 5 "oo" -- look at opp hand, pick non-resource, discard; may pick same type, return to owner's hand
const WARLOCK = "82b1ad07-d0b7-4a8a-820e-f4587d4ec574"; // character arcanist wizard cost 2 "oo" 1/3/2 -- ETB opp puts a hand card on top of deck
const SHIFT = "59cfe527-6669-402f-bbbc-f89b9c88e515"; // tactic arcanist cost 7 "ooooo" -- bounce all my non-resource cards, deploy free up to their total cost
const REDONK = "d329cfed-7a85-4e4e-86e9-65b7fa01cb6b"; // tactic arcanist cost 3 "oo" -- EXTRA COST pick a character; FLIP UP: discard 2; <=3 hand: remove; FLIP UP 5 [O][O]
const ROUSE = "3d091c4c-4781-4e6c-8aac-e3d8b25021e5"; // tactic arcanist cost 1 "ooo" -- EXTRA COST pick tactic in my discard, put on top of deck; RECUR ooo
const STUPID = "f76b5c48-1fab-4235-8279-9785524413b0"; // tactic arcanist cost 3 "o" -- opp discards 2; RECUR o pay 2: opp discards 1
const WIZARD = "9470335e-1d2b-46a5-861e-04527371ffb2"; // character arcanist wizard cost 3 "oo" 2/3/2 -- ETB each player may draw up to 2
const MOON = "abbf6eb0-dcd7-4e19-87f4-79463f080153"; // character arcanist monstrosity cost 1 "o" 1/3/1 -- O-providing card enters under my control: may pick a character, COVERT this turn

const ready = (engine: SpoilsEngine, p: PlayerId): number => readyResources(engine, p);
const spent = (icon: "obsession" | "rage", n: number, owner: PlayerId = P1): CardPlacement[] =>
  bank(icon, n, owner).map(p => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));
const mk = (cards: CardPlacement[], active: PlayerId = P1) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, activePlayerId: active, turn: active === P1 ? 1 : 2, random: () => 0.5, cards });
type G = ReturnType<typeof mk>;
const hand = (engine: SpoilsEngine, p: PlayerId): CardInstanceId[] => [...engine.state.players[p].hand];
const deck = (engine: SpoilsEngine, p: PlayerId): CardInstanceId[] => [...engine.state.players[p].deck];
const pickIds = (ids: CardInstanceId[]) => (pc: PendingChoiceLike): unknown =>
  pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: ids } : declineAll(pc);
const hasCovert = (engine: SpoilsEngine, cardId: CardInstanceId): boolean => JSON.stringify(engine.getKeywords(cardId)).toLowerCase().includes("covert");
const pickTarget = (engine: SpoilsEngine, selected: CardInstanceId[]): void => answerPending(engine, "chooserSelectsTarget", { selected });

/** Printed cost / threshold / type as a body: exact works (spent icons help only the threshold), one short, one icon short, spent-only. */
function costBody(
  id: string,
  spec: { cost: number; thresh: number; type: "character" | "tactic"; extra?: CardPlacement[]; selected?: (k: (key: string) => CardInstanceId) => Record<string, CardInstanceId[]> }
): () => void {
  return () => {
    const { cost, thresh } = spec;
    const readyO = Math.min(cost, thresh);
    const readyR = cost - readyO;
    const spentO = thresh - readyO;
    const board = (o: number, r: number, s: number) =>
      mk([{ key: "c", def: printing(id), owner: P1, zone: "hand" }, ...(spec.extra ?? []), ...bank("obsession", o, P1), ...bank("rage", r, P1), ...spent("obsession", s, P1)]);
    const go = (g: G) => play(g.engine, P1, g.id("c"), { selected: spec.selected?.(g.id) });
    const exact = board(readyO, readyR, spentO);
    assert.equal(exact.engine.getCardPlayability(P1, exact.id("c")).numericCost, cost, "printed cost");
    assert.equal(ready(exact.engine, P1), cost);
    go(exact);
    drain(exact.engine, declineAll);
    assert.equal(zoneOf(exact.engine, exact.id("c")), spec.type === "character" ? "play" : "discard", "deployed");
    assert.equal(ready(exact.engine, P1), 0, `exactly ${cost} spent`);
    const short = readyR > 0 ? board(readyO, readyR - 1, spentO) : board(readyO - 1, 0, spentO + 1);
    refused(() => go(short), `one short of cost ${cost}`);
    assert.equal(zoneOf(short.engine, short.id("c")), "hand");
    assert.equal(ready(short.engine, P1), cost - 1, "nothing paid");
    const iconShort = board(readyO - 1, readyR + 1, spentO);
    refused(() => go(iconShort), `threshold needs ${thresh} [O]; one icon short`);
    assert.equal(zoneOf(iconShort.engine, iconShort.id("c")), "hand");
    const spentOnly = board(0, cost - 1, thresh);
    refused(() => go(spentOnly), "spent icons meet the threshold but cannot pay the cost");
    assert.equal(zoneOf(spentOnly.engine, spentOnly.id("c")), "hand");
  };
}
const statsBody = (id: string, subtype: string, str: number, spd: number, life: number): (() => void) => () => {
  const g = mk([{ key: "c", def: printing(id), owner: P1, zone: "play" }]);
  assert.deepEqual(g.engine.getCardTypes(g.id("c")), ["character"]);
  assert.deepEqual([...(g.engine.getDefinition(g.id("c")).subtype ?? [])], [subtype]);
  assert.equal(g.engine.getStat(g.id("c"), "strength"), str);
  assert.equal(g.engine.getStat(g.id("c"), "speed"), spd);
  assert.equal(g.engine.getStat(g.id("c"), "life"), life);
  const theirTurn = mk([{ key: "c", def: printing(id), owner: P1, zone: "hand" }, ...bank("obsession", 5, P1)], P2);
  refused(() => play(theirTurn.engine, P1, theirTurn.id("c")), "a character on the opponent's turn");
  assert.equal(zoneOf(theirTurn.engine, theirTurn.id("c")), "hand");
};

// ============================================================================
// Stupidify -- tactic cost 3 [O]: opponent discards 2; RECUR [O] pay 2, remove: opponent discards a card
// ============================================================================
const stupidBoard = (oppHand: number, more: CardPlacement[] = []) =>
  mk([
    { key: "c", def: printing(STUPID), owner: P1, zone: "hand" },
    ...fillers("mh", 2, P1, "hand"),
    ...fillers("oh", oppHand, P2, "hand"),
    ...bank("obsession", 3, P1),
    ...more
  ]);

clause(STUPID, "0:rule", "costs 3 with [O]: exact works, one short / no [O] / spent-only are refused; it is a tactic", costBody(STUPID, { cost: 3, thresh: 1, type: "tactic",  }));

clause(STUPID, "0:rule", "the opponent chooses and discards exactly 2 cards of their hand; the rest of their hand and my hand stay; the tactic goes to my discard pile", () => {
  const { engine, id } = stupidBoard(4);
  play(engine, P1, id("c"));
  const pc = pending(engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the opponent picks what they discard");
  refused(() => pickTarget(engine, [id("oh1")]), "one card is not 2");
  refused(() => pickTarget(engine, [id("oh1"), id("oh2"), id("oh3")]), "three cards are too many");
  refused(() => pickTarget(engine, [id("mh0"), id("mh1")]), "only the opponent's hand cards can be chosen");
  pickTarget(engine, [id("oh1"), id("oh3")]);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("oh1")), "discard");
  assert.equal(zoneOf(engine, id("oh3")), "discard");
  assert.equal(zoneOf(engine, id("oh0")), "hand");
  assert.equal(zoneOf(engine, id("oh2")), "hand");
  assert.deepEqual([zoneOf(engine, id("mh0")), zoneOf(engine, id("mh1"))], ["hand", "hand"], "my hand untouched");
  assert.equal(zoneOf(engine, id("c")), "discard");
  assert.equal(ready(engine, P1), 0, "3 paid");
});

clause(STUPID, "0:rule", "an opponent with exactly 2 cards discards both; with 1 card discards that one; with none nothing happens", () => {
  const two = stupidBoard(2);
  play(two.engine, P1, two.id("c"));
  drain(two.engine, pickIds([two.id("oh0"), two.id("oh1")]));
  assert.deepEqual([zoneOf(two.engine, two.id("oh0")), zoneOf(two.engine, two.id("oh1"))], ["discard", "discard"]);
  const one = stupidBoard(1);
  play(one.engine, P1, one.id("c"));
  drain(one.engine, pickIds([one.id("oh0")]));
  assert.equal(zoneOf(one.engine, one.id("oh0")), "discard");
  assert.equal(pending(one.engine), undefined);
  const none = stupidBoard(0);
  play(none.engine, P1, none.id("c"));
  drain(none.engine, declineAll);
  assert.equal(pending(none.engine), undefined);
  assert.equal(zoneOf(none.engine, none.id("c")), "discard");
  assert.deepEqual([zoneOf(none.engine, none.id("mh0")), zoneOf(none.engine, none.id("mh1"))], ["hand", "hand"]);
});

const stupidRecur = (opts: { where?: "discard" | "hand"; o?: number; r?: number; s?: number; oppHand?: number } = {}) =>
  mk([
    { key: "c", def: printing(STUPID), owner: P1, zone: opts.where ?? "discard" },
    ...fillers("oh", opts.oppHand ?? 3, P2, "hand"),
    ...fillers("mh", 1, P1, "hand"),
    ...bank("obsession", opts.o ?? 1, P1),
    ...bank("rage", opts.r ?? 2, P1),
    ...spent("obsession", opts.s ?? 0, P1)
  ]);

clause(STUPID, "1:ability:recur", "RECUR from the discard pile with [O]: pays 2 (of 3 resources 1 stays ready), removes this card from the game, and the opponent discards exactly 1 card of their choice", () => {
  const { engine, id } = stupidRecur();
  assert.equal(ready(engine, P1), 3);
  activate(engine, P1, id("c"), "recur");
  const pc = pending(engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the opponent chooses the discard");
  refused(() => pickTarget(engine, [id("oh0"), id("oh1")]), "only 1 card");
  pickTarget(engine, [id("oh2")]);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("oh2")), "discard");
  assert.deepEqual([zoneOf(engine, id("oh0")), zoneOf(engine, id("oh1"))], ["hand", "hand"], "only one discarded");
  assert.equal(zoneOf(engine, id("mh0")), "hand");
  assert.equal(zoneOf(engine, id("c")), "removed", "removed from the game, not back in the discard pile");
  assert.equal(ready(engine, P1), 1, "exactly 2 paid");
});

clause(STUPID, "1:ability:recur", "needs [O] and 2 resources: 2 Rage only / 1 resource only / spent-[O] only are refused; [O] spent earlier plus 2 ready Rage works", () => {
  const noO = stupidRecur({ o: 0, r: 2 });
  refused(() => activate(noO.engine, P1, noO.id("c"), "recur"), "no [O]");
  assert.equal(zoneOf(noO.engine, noO.id("c")), "discard");
  assert.equal(ready(noO.engine, P1), 2);
  const oneRes = stupidRecur({ o: 1, r: 0 });
  refused(() => activate(oneRes.engine, P1, oneRes.id("c"), "recur"), "pay 2 with only 1 resource");
  assert.equal(zoneOf(oneRes.engine, oneRes.id("c")), "discard");
  const spentOnly = stupidRecur({ o: 0, r: 1, s: 1 });
  refused(() => activate(spentOnly.engine, P1, spentOnly.id("c"), "recur"), "spent [O] meets the threshold but only 1 ready resource", /Ability costs cannot be paid\./);
  assert.equal(zoneOf(spentOnly.engine, spentOnly.id("c")), "discard");
  const ok = stupidRecur({ o: 0, r: 2, s: 1 });
  activate(ok.engine, P1, ok.id("c"), "recur");
  drain(ok.engine, pickIds([ok.id("oh0")]));
  assert.equal(zoneOf(ok.engine, ok.id("oh0")), "discard", "control: spent [O] counts toward the threshold");
  assert.equal(ready(ok.engine, P1), 0);
});

clause(STUPID, "1:ability:recur", "can be used only if this card is in the discard pile: refused from the hand, and after recurring it is gone so it cannot recur twice", () => {
  const inHand = stupidRecur({ where: "hand" });
  refused(() => activate(inHand.engine, P1, inHand.id("c"), "recur"), "in hand", /Activated ability not found|discard|zone/i);
  assert.equal(zoneOf(inHand.engine, inHand.id("c")), "hand");
  assert.equal(ready(inHand.engine, P1), 3, "nothing paid");
  const g = stupidRecur({ r: 4 });
  activate(g.engine, P1, g.id("c"), "recur");
  drain(g.engine, pickIds([g.id("oh0")]));
  assert.equal(zoneOf(g.engine, g.id("c")), "removed");
  refused(() => activate(g.engine, P1, g.id("c"), "recur"), "already removed from the game");
});

// ============================================================================
// Perturbatious Warlock -- character cost 2 [O][O] 1/3/2 wizard: ETB the opponent puts a card from hand on top of deck
// ============================================================================
const warlockBoard = (oppHand: number, extra: CardPlacement[] = []) =>
  mk([
    { key: "c", def: printing(WARLOCK), owner: P1, zone: "hand" },
    ...fillers("oh", oppHand, P2, "hand"),
    ...fillers("od", 3, P2, "deck"),
    ...fillers("mh", 2, P1, "hand"),
    ...fillers("md", 2, P1, "deck"),
    ...bank("obsession", 2, P1),
    ...extra
  ]);

clause(WARLOCK, "0:rule", "costs 2 with [O][O] (exact / one short / one icon short / spent-only); printed 1/3/2 wizard; not castable on the opponent's turn", () => {
  costBody(WARLOCK, { cost: 2, thresh: 2, type: "character" })();
  statsBody(WARLOCK, "wizard", 1, 3, 2)();
});

clause(WARLOCK, "0:rule", "entering play: the opponent chooses a card from their hand and it goes on top of their deck (above the old top card); hand shrinks by one, my zones untouched", () => {
  const { engine, id } = warlockBoard(3);
  const before = deck(engine, P2);
  play(engine, P1, id("c"));
  const pc = pending(engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the opponent chooses");
  refused(() => pickTarget(engine, [id("mh0")]), "only the opponent's own hand cards");
  refused(() => pickTarget(engine, [id("oh0"), id("oh1")]), "exactly one card");
  refused(() => pickTarget(engine, []), "mandatory for the opponent");
  pickTarget(engine, [id("oh1")]);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("c")), "play");
  assert.deepEqual(deck(engine, P2), [id("oh1"), ...before], "on TOP of the deck");
  assert.equal(zoneOf(engine, id("oh1")), "deck");
  assert.deepEqual([zoneOf(engine, id("oh0")), zoneOf(engine, id("oh2"))], ["hand", "hand"]);
  assert.equal(hand(engine, P1).length, 2, "my hand untouched");
  assert.deepEqual(deck(engine, P1), [...deck(engine, P1)].filter(Boolean), "my deck untouched");
  assert.equal(deck(engine, P1).length, 2);
});

clause(WARLOCK, "0:rule", "an opponent with one card must put it back; with an empty hand nothing happens and the Warlock still enters", () => {
  const one = warlockBoard(1);
  play(one.engine, P1, one.id("c"));
  drain(one.engine, pickIds([one.id("oh0")]));
  assert.equal(zoneOf(one.engine, one.id("oh0")), "deck");
  assert.equal(deck(one.engine, P2)[0], one.id("oh0"));
  const none = warlockBoard(0);
  play(none.engine, P1, none.id("c"));
  assert.equal(pending(none.engine), undefined);
  assert.equal(zoneOf(none.engine, none.id("c")), "play");
  assert.equal(deck(none.engine, P2).length, 3);
});

clause(WARLOCK, "0:rule", "only when THIS card enters play: another character entering later (mine) does not trigger it", () => {
  const g = warlockBoard(3, [
    { key: "w", def: printing(WARLOCK), owner: P1, zone: "play" },
    { key: "other", def: character({ name: "Other", cost: 0 }), owner: P1, zone: "hand" }
  ]);
  play(g.engine, P1, g.id("other"));
  assert.equal(pending(g.engine), undefined, "no prompt: the Warlock was already in play");
  assert.equal(zoneOf(g.engine, g.id("other")), "play");
  assert.equal(hand(g.engine, P2).length, 3);
  assert.equal(deck(g.engine, P2).length, 3);
});

// ============================================================================
// Thabbashite Wizard -- character cost 3 [O][O] 2/3/2 wizard: ETB each player may draw up to 2 cards
// ============================================================================
const wizardBoard = (extra: CardPlacement[] = []) =>
  mk([
    { key: "c", def: printing(WIZARD), owner: P1, zone: "hand" },
    ...fillers("md", 5, P1, "deck"),
    ...fillers("od", 5, P2, "deck"),
    ...bank("obsession", 3, P1),
    ...extra
  ]);
/** Answers each "may draw up to 2" number prompt per player. */
const drawAnswer = (a: number, b: number) => (pc: PendingChoiceLike): unknown =>
  /number/i.test(pc.kind) ? { kind: pc.kind === "chooserSelectsNumber" ? "chooseNumber" : pc.kind, value: pc.playerId === P1 ? a : b } : declineAll(pc);

clause(WIZARD, "0:rule", "costs 3 with [O][O] (exact / one short / one icon short / spent-only); printed 2/3/2 wizard; not castable on the opponent's turn", () => {
  costBody(WIZARD, { cost: 3, thresh: 2, type: "character" })();
  statsBody(WIZARD, "wizard", 2, 3, 2)();
});

clause(WIZARD, "0:rule", "each player (me AND the opponent) may draw 2: both draw their top two cards in order", () => {
  const { engine, id } = wizardBoard();
  const md = deck(engine, P1);
  const od = deck(engine, P2);
  play(engine, P1, id("c"));
  drain(engine, drawAnswer(2, 2));
  assert.deepEqual(hand(engine, P1), md.slice(0, 2));
  assert.deepEqual(hand(engine, P2), od.slice(0, 2));
  assert.equal(deck(engine, P1).length, 3);
  assert.equal(deck(engine, P2).length, 3);
});

clause(WIZARD, "0:rule", "the draw is optional and up to 2 per player, chosen separately: 0 / 1 / 2 in every mix", () => {
  for (const [a, b] of [[0, 0], [1, 2], [2, 0], [2, 1], [0, 2]] as const) {
    const { engine, id } = wizardBoard();
    play(engine, P1, id("c"));
    drain(engine, drawAnswer(a, b));
    assert.equal(hand(engine, P1).length, a, `P1 draws ${a}`);
    assert.equal(hand(engine, P2).length, b, `P2 draws ${b}`);
    assert.equal(deck(engine, P1).length, 5 - a);
    assert.equal(deck(engine, P2).length, 5 - b);
  }
});

clause(WIZARD, "0:rule", "each player is asked separately and each is bounded by 2: 3 or -1 is refused for either player", () => {
  const { engine, id } = wizardBoard();
  play(engine, P1, id("c"));
  const first = pending(engine)!;
  assert.match(first.kind, /number/i);
  const kind = first.kind === "chooserSelectsNumber" ? "chooseNumber" : first.kind;
  refused(() => engine.perform({ type: "resolvePendingChoice", playerId: first.playerId, choice: { kind, value: 3 } } as never), "more than 2");
  refused(() => engine.perform({ type: "resolvePendingChoice", playerId: first.playerId, choice: { kind, value: -1 } } as never), "negative");
  engine.perform({ type: "resolvePendingChoice", playerId: first.playerId, choice: { kind, value: 1 } } as never);
  const second = pending(engine)!;
  assert.match(second.kind, /number/i, "the other player is asked too");
  assert.notEqual(second.playerId, first.playerId);
  refused(() => engine.perform({ type: "resolvePendingChoice", playerId: second.playerId, choice: { kind, value: 3 } } as never), "more than 2 for the second player");
  engine.perform({ type: "resolvePendingChoice", playerId: second.playerId, choice: { kind, value: 2 } } as never);
  assert.equal(pending(engine), undefined);
  assert.equal(hand(engine, first.playerId as PlayerId).length, 1);
  assert.equal(hand(engine, second.playerId as PlayerId).length, 2);
});

clause(WIZARD, "0:rule", "only when THIS card enters play: another character entering with the Wizard already in play draws nothing", () => {
  const g = wizardBoard([
    { key: "w", def: printing(WIZARD), owner: P1, zone: "play" },
    { key: "other", def: character({ name: "Other", cost: 0 }), owner: P1, zone: "hand" }
  ]);
  play(g.engine, P1, g.id("other"));
  assert.equal(pending(g.engine), undefined);
  assert.deepEqual(hand(g.engine, P1), [g.id("c")], "only the unplayed Wizard in hand; nothing drawn");
  assert.equal(hand(g.engine, P2).length, 0);
});

// ============================================================================
// Rouse -- tactic cost 1 [O][O][O]: EXTRA COST pick a tactic in your discard; put it on top of your deck; RECUR
// ============================================================================
const oldTac = (name: string) => tactic({ name, cost: 0 });
const rouseBoard = (opts: { o?: number; r?: number; s?: number; where?: "hand" | "discard"; extra?: CardPlacement[] } = {}) =>
  mk([
    { key: "c", def: printing(ROUSE), owner: P1, zone: opts.where ?? "hand" },
    { key: "t1", def: oldTac("Old One"), owner: P1, zone: "discard" },
    { key: "t2", def: oldTac("Old Two"), owner: P1, zone: "discard" },
    { key: "ch", def: character({ name: "Dead Guy" }), owner: P1, zone: "discard" },
    { key: "ot", def: oldTac("Their Old"), owner: P2, zone: "discard" },
    { key: "ht", def: oldTac("Held"), owner: P1, zone: "hand" },
    ...fillers("md", 3, P1, "deck"),
    ...bank("obsession", opts.o ?? 3, P1),
    ...bank("rage", opts.r ?? 0, P1),
    ...spent("obsession", opts.s ?? 0, P1),
    ...(opts.extra ?? [])
  ]);

clause(ROUSE, "0:extraCost", "costs 1 with [O][O][O]: [O] spent earlier count for the threshold but cannot pay; one icon short / no ready resource is refused; it is a tactic", costBody(ROUSE, { cost: 1, thresh: 3, type: "tactic", extra: [{ key: "t1", def: oldTac("Old One"), owner: P1, zone: "discard" }], selected: k => ({ t: [k("t1")] }) }));

clause(ROUSE, "0:extraCost", "a tactic in MY discard pile must be picked: none, a character in the discard pile, the opponent's discarded tactic, and a tactic in my hand are all refused", () => {
  const ok = rouseBoard();
  play(ok.engine, P1, ok.id("c"), { selected: { t: [ok.id("t1")] } });
  drain(ok.engine, declineAll);
  assert.equal(zoneOf(ok.engine, ok.id("c")), "discard", "control: a discarded tactic of mine works");
  for (const bad of ["ch", "ot", "ht"]) {
    const g = rouseBoard();
    refused(() => play(g.engine, P1, g.id("c"), { selected: { t: [g.id(bad)] } }), `bad pick ${bad}`);
    assert.equal(zoneOf(g.engine, g.id("c")), "hand");
    assert.equal(ready(g.engine, P1), 3, "nothing paid");
  }
  const none = rouseBoard();
  refused(() => play(none.engine, P1, none.id("c")), "no pick");
  assert.equal(zoneOf(none.engine, none.id("c")), "hand");
  assert.equal(ready(none.engine, P1), 3);
});

clause(ROUSE, "0:extraCost", "a tactic in play-adjacent zones other than the discard pile (Rouse itself in hand) cannot be its own pick", () => {
  const g = rouseBoard();
  refused(() => play(g.engine, P1, g.id("c"), { selected: { t: [g.id("c")] } }), "Rouse cannot pick itself");
  assert.equal(zoneOf(g.engine, g.id("c")), "hand");
});

clause(ROUSE, "1:rule", "the picked tactic goes on top of my deck (first card), other discarded cards and the old deck order stay; Rouse itself ends in the discard pile", () => {
  const { engine, id } = rouseBoard();
  const before = deck(engine, P1);
  play(engine, P1, id("c"), { selected: { t: [id("t2")] } });
  drain(engine, declineAll);
  assert.equal(pending(engine), undefined);
  assert.deepEqual(deck(engine, P1), [id("t2"), ...before]);
  assert.equal(zoneOf(engine, id("t2")), "deck");
  assert.equal(zoneOf(engine, id("t1")), "discard", "the other tactic stays");
  assert.equal(zoneOf(engine, id("ch")), "discard");
  assert.equal(zoneOf(engine, id("ot")), "discard");
  assert.equal(zoneOf(engine, id("c")), "discard");
  assert.equal(hand(engine, P1).includes(id("ht")), true, "hand untouched");
});

clause(ROUSE, "2:ability:recur", "RECUR from the discard pile: pay 1 (exact), remove Rouse from the game, put the picked tactic on top of my deck", () => {
  const { engine, id } = rouseBoard({ where: "discard", o: 3 });
  const before = deck(engine, P1);
  assert.equal(ready(engine, P1), 3);
  activate(engine, P1, id("c"), "recur", { selected: { rt: [id("t1")] } });
  drain(engine, declineAll);
  assert.equal(pending(engine), undefined);
  assert.equal(ready(engine, P1), 2, "exactly 1 paid");
  assert.equal(zoneOf(engine, id("c")), "removed", "Rouse removed from the game");
  assert.deepEqual(deck(engine, P1), [id("t1"), ...before]);
  assert.equal(zoneOf(engine, id("t2")), "discard");
});

clause(ROUSE, "2:ability:recur", "needs [O][O][O] and 1 ready resource: 2 [O] + Rage is refused, 3 spent [O] with nothing ready is refused, 1 ready + 2 spent [O] works", () => {
  const iconShort = rouseBoard({ where: "discard", o: 2, r: 1 });
  refused(() => activate(iconShort.engine, P1, iconShort.id("c"), "recur", { selected: { rt: [iconShort.id("t1")] } }), "two [O] only");
  assert.equal(zoneOf(iconShort.engine, iconShort.id("c")), "discard");
  assert.equal(ready(iconShort.engine, P1), 3);
  const none = rouseBoard({ where: "discard", o: 0, s: 3 });
  refused(() => activate(none.engine, P1, none.id("c"), "recur", { selected: { rt: [none.id("t1")] } }), "nothing ready to pay 1");
  assert.equal(zoneOf(none.engine, none.id("c")), "discard");
  const ok = rouseBoard({ where: "discard", o: 1, s: 2 });
  activate(ok.engine, P1, ok.id("c"), "recur", { selected: { rt: [ok.id("t1")] } });
  drain(ok.engine, declineAll);
  assert.equal(zoneOf(ok.engine, ok.id("t1")), "deck", "control");
  assert.equal(ready(ok.engine, P1), 0);
});

clause(ROUSE, "2:ability:recur", "only from the discard pile (refused from hand); the pick must be a tactic in my discard pile: not Rouse itself, a character, the opponent's tactic, or none", () => {
  const inHand = rouseBoard({ where: "hand" });
  refused(() => activate(inHand.engine, P1, inHand.id("c"), "recur", { selected: { rt: [inHand.id("t1")] } }), "in hand", /Activated ability not found|discard|zone/i);
  assert.equal(zoneOf(inHand.engine, inHand.id("c")), "hand");
  assert.equal(ready(inHand.engine, P1), 3);
  for (const bad of ["ch", "ot", "ht", undefined]) {
    const g = rouseBoard({ where: "discard" });
    refused(() => activate(g.engine, P1, g.id("c"), "recur", bad ? { selected: { rt: [g.id(bad)] } } : {}), `bad pick ${bad}`);
    assert.equal(zoneOf(g.engine, g.id("c")), "discard", "still in the discard pile");
    assert.equal(ready(g.engine, P1), 3, "nothing paid");
  }
});

// ============================================================================
// Perturb -- tactic cost 5 [O][O]: look at opp hand, pick non-resource, they discard it; may pick same type, return to owner's hand
// ============================================================================
const perturbBoard = (extra: CardPlacement[] = [], active: PlayerId = P1) =>
  mk([
    { key: "c", def: printing(PERTURB), owner: P1, zone: "hand" },
    { key: "mh", def: character({ name: "Mine Hand" }), owner: P1, zone: "hand" },
    { key: "oc", def: character({ name: "Opp Char H" }), owner: P2, zone: "hand" },
    { key: "oi", def: item({ name: "Opp Item H" }), owner: P2, zone: "hand" },
    { key: "ol", def: location({ name: "Opp Loc H" }), owner: P2, zone: "hand" },
    { key: "ot", def: tactic({ name: "Opp Tac H", cost: 0 }), owner: P2, zone: "hand" },
    { key: "or", def: resourceCard({ name: "Opp Res H" }), owner: P2, zone: "hand" },
    { key: "mc", def: character({ name: "My Char" }), owner: P1, zone: "play" },
    { key: "mi", def: item({ name: "My Item" }), owner: P1, zone: "play" },
    { key: "pc", def: character({ name: "Their Char" }), owner: P2, zone: "play" },
    { key: "pi", def: item({ name: "Their Item" }), owner: P2, zone: "play" },
    { key: "pl", def: location({ name: "Their Loc" }), owner: P2, zone: "play" },
    ...bank("obsession", 5, P1),
    ...extra
  ], active);

clause(PERTURB, "0:rule", "costs 5 with [O][O]: exact works, one short / one icon short / spent-only refused; it is a tactic", costBody(PERTURB, { cost: 5, thresh: 2, type: "tactic", extra: [{ key: "oc", def: character({ name: "Opp Char H" }), owner: P2, zone: "hand" }], selected: k => ({ disc: [k("oc")] }) }));

clause(PERTURB, "0:rule", "picks a non-resource card in the opponent's hand: a character, item, location and tactic can each be picked; the opponent discards exactly that one", () => {
  for (const key of ["oc", "oi", "ol", "ot"]) {
    const { engine, id } = perturbBoard();
    play(engine, P1, id("c"), { selected: { disc: [id(key)] } });
    drain(engine, declineAll);
    assert.equal(zoneOf(engine, id(key)), "discard", `${key} discarded`);
    for (const other of ["oc", "oi", "ol", "ot", "or"].filter(k => k !== key)) assert.equal(zoneOf(engine, id(other)), "hand", `${other} stays`);
    assert.equal(zoneOf(engine, id("mh")), "hand");
    assert.equal(zoneOf(engine, id("c")), "discard");
  }
});

clause(PERTURB, "0:rule", "the pick must be in the OPPONENT's hand and not a resource: a resource card, my own hand card, and the opponent's cards in play are all refused", () => {
  for (const bad of ["or", "mh", "pc", "mc", "c"]) {
    const g = perturbBoard();
    refused(() => play(g.engine, P1, g.id("c"), { selected: { disc: [g.id(bad)] } }), `bad pick ${bad}`);
    assert.equal(zoneOf(g.engine, g.id("c")), "hand");
    assert.equal(ready(g.engine, P1), 5, "nothing paid");
  }
  const none = perturbBoard();
  refused(() => play(none.engine, P1, none.id("c")), "no pick at all");
  assert.equal(zoneOf(none.engine, none.id("c")), "hand");
});

clause(PERTURB, "0:rule", "the discard is the opponent's: it goes to the opponent's discard pile, the opponent chooses nothing (I pick), and I get no response prompt from them", () => {
  const { engine, id } = perturbBoard();
  play(engine, P1, id("c"), { selected: { disc: [id("oc")] } });
  const pc = pending(engine);
  if (pc) assert.equal(pc.playerId, P1, "any follow-up decision is mine");
  assert.equal(engine.state.cards[id("oc")].zone, "discard");
  assert.ok(engine.state.players[P2].discard.includes(id("oc")), "in the opponent's discard pile");
  assert.ok(!engine.state.players[P1].discard.includes(id("oc")), "!engine.state.players[P1].discard.includes(id(\"oc\"))");
});

clause(PERTURB, "0:rule", "after discarding a character I may pick a character (mine or theirs) and it goes to its OWNER's hand", () => {
  const mine = perturbBoard();
  play(mine.engine, P1, mine.id("c"), { selected: { disc: [mine.id("oc")] } });
  const pc = pending(mine.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I choose");
  pickTarget(mine.engine, [mine.id("mc")]);
  assert.equal(pending(mine.engine), undefined);
  assert.equal(zoneOf(mine.engine, mine.id("mc")), "hand");
  assert.ok(hand(mine.engine, P1).includes(mine.id("mc")), "back in my hand");
  assert.equal(zoneOf(mine.engine, mine.id("pc")), "play", "the other character stays");

  const theirs = perturbBoard();
  play(theirs.engine, P1, theirs.id("c"), { selected: { disc: [theirs.id("oc")] } });
  pickTarget(theirs.engine, [theirs.id("pc")]);
  assert.equal(zoneOf(theirs.engine, theirs.id("pc")), "hand");
  assert.ok(hand(theirs.engine, P2).includes(theirs.id("pc")), "returned to its owner (the opponent)");
  assert.equal(zoneOf(theirs.engine, theirs.id("mc")), "play");
});

clause(PERTURB, "0:rule", "the second pick is a 'may': declining leaves every card in play; and only ONE card is returned", () => {
  const decline = perturbBoard();
  play(decline.engine, P1, decline.id("c"), { selected: { disc: [decline.id("oc")] } });
  assert.equal(pending(decline.engine)?.kind, "chooserSelectsTarget");
  pickTarget(decline.engine, []);
  assert.equal(pending(decline.engine), undefined);
  assert.deepEqual(["mc", "pc"].map(k => zoneOf(decline.engine, decline.id(k))), ["play", "play"]);
  assert.equal(zoneOf(decline.engine, decline.id("oc")), "discard", "the discard stays regardless");
  const two = perturbBoard();
  play(two.engine, P1, two.id("c"), { selected: { disc: [two.id("oc")] } });
  refused(() => pickTarget(two.engine, [two.id("mc"), two.id("pc")]), "only one card");
  pickTarget(two.engine, [two.id("mc")]);
  assert.equal(zoneOf(two.engine, two.id("pc")), "play");
});

clause(PERTURB, "0:rule", "the second pick must be the SAME TYPE as the discarded card: after an item only items are pickable (not characters, locations); after a location only locations", () => {
  const item1 = perturbBoard();
  play(item1.engine, P1, item1.id("c"), { selected: { disc: [item1.id("oi")] } });
  refused(() => pickTarget(item1.engine, [item1.id("mc")]), "a character after discarding an item");
  refused(() => pickTarget(item1.engine, [item1.id("pl")]), "a location after discarding an item");
  pickTarget(item1.engine, [item1.id("pi")]);
  assert.equal(zoneOf(item1.engine, item1.id("pi")), "hand");
  assert.ok(hand(item1.engine, P2).includes(item1.id("pi")), "hand(item1.engine, P2).includes(item1.id(\"pi\"))");
  const item2 = perturbBoard();
  play(item2.engine, P1, item2.id("c"), { selected: { disc: [item2.id("oi")] } });
  pickTarget(item2.engine, [item2.id("mi")]);
  assert.ok(hand(item2.engine, P1).includes(item2.id("mi")), "my own item returns to my hand");
  const loc = perturbBoard();
  play(loc.engine, P1, loc.id("c"), { selected: { disc: [loc.id("ol")] } });
  refused(() => pickTarget(loc.engine, [loc.id("pi")]), "an item after discarding a location");
  refused(() => pickTarget(loc.engine, [loc.id("pc")]), "a character after discarding a location");
  pickTarget(loc.engine, [loc.id("pl")]);
  assert.equal(zoneOf(loc.engine, loc.id("pl")), "hand");
});

clause(PERTURB, "0:rule", "the discarded card itself, and resources, are not valid second picks; a card owned by the opponent but controlled by me returns to the OPPONENT's hand", () => {
  const g = perturbBoard([{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, controller: P1, zone: "play" }]);
  play(g.engine, P1, g.id("c"), { selected: { disc: [g.id("oc")] } });
  refused(() => pickTarget(g.engine, [g.id("oc")]), "the discarded card is not in play");
  refused(() => pickTarget(g.engine, [g.id("or")]), "a resource card in hand");
  pickTarget(g.engine, [g.id("stolen")]);
  assert.equal(zoneOf(g.engine, g.id("stolen")), "hand");
  assert.ok(hand(g.engine, P2).includes(g.id("stolen")), "to its owner, not its controller");
  assert.ok(!hand(g.engine, P1).includes(g.id("stolen")), "!hand(g.engine, P1).includes(g.id(\"stolen\"))");
});

clause(PERTURB, "0:rule", "'pick a card of the same type' means in play: same-type cards in hand, deck and discard (mine and theirs) are NOT pickable", () => {
  const zones = [
    { key: "xhm", owner: P1, zone: "hand" }, { key: "xho", owner: P2, zone: "hand" },
    { key: "xdm", owner: P1, zone: "deck" }, { key: "xdo", owner: P2, zone: "deck" },
    { key: "xsm", owner: P1, zone: "discard" }, { key: "xso", owner: P2, zone: "discard" }
  ] as const;
  const extra = (): CardPlacement[] => zones.map(z => ({ key: z.key, def: character({ name: `Off ${z.key}` }), owner: z.owner, zone: z.zone }));
  for (const z of zones) {
    const g = perturbBoard(extra());
    play(g.engine, P1, g.id("c"), { selected: { disc: [g.id("oc")] } });
    assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget");
    refused(() => pickTarget(g.engine, [g.id(z.key)]), `${z.key} (${z.zone}) is not in play`);
    assert.equal(zoneOf(g.engine, g.id(z.key)), z.zone, `${z.key} did not move`);
    // positive control: a same-type card in play is pickable
    pickTarget(g.engine, [g.id("mc")]);
    assert.equal(zoneOf(g.engine, g.id("mc")), "hand");
    assert.equal(zoneOf(g.engine, g.id(z.key)), z.zone);
  }
  // the same holds after an item discard: items in hand/deck/discard are not pickable
  const items = perturbBoard([
    { key: "ih", def: item({ name: "Off ih" }), owner: P2, zone: "hand" },
    { key: "id", def: item({ name: "Off id" }), owner: P2, zone: "deck" },
    { key: "is", def: item({ name: "Off is" }), owner: P2, zone: "discard" }
  ]);
  play(items.engine, P1, items.id("c"), { selected: { disc: [items.id("oi")] } });
  for (const k of ["ih", "id", "is"]) refused(() => pickTarget(items.engine, [items.id(k)]), `item ${k} not in play`);
  pickTarget(items.engine, [items.id("pi")]);
  assert.equal(zoneOf(items.engine, items.id("pi")), "hand");
});

clause(PERTURB, "0:rule", "a discarded tactic has no same-type card in play: nothing is returned and no card moves", () => {
  const { engine, id } = perturbBoard();
  play(engine, P1, id("c"), { selected: { disc: [id("ot")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("ot")), "discard");
  assert.deepEqual(["mc", "mi", "pc", "pi", "pl"].map(k => zoneOf(engine, id(k))), ["play", "play", "play", "play", "play"]);
});

// ============================================================================
// Reality Shift -- tactic cost 7 [O]x5: X = total cost of my non-resource cards; bounce them; deploy free up to X
// ============================================================================
const shiftBoard = (extra: CardPlacement[] = []) =>
  mk([
    { key: "c", def: printing(SHIFT), owner: P1, zone: "hand" },
    { key: "a", def: character({ name: "Shift A", cost: 3 }), owner: P1, zone: "play" },
    { key: "b", def: item({ name: "Shift B", cost: 2 }), owner: P1, zone: "play" },
    { key: "l", def: location({ name: "Shift L", cost: 4 }), owner: P1, zone: "play" },
    { key: "foe", def: character({ name: "Foe", cost: 5 }), owner: P2, zone: "play" },
    { key: "big", def: character({ name: "Big", cost: 10 }), owner: P1, zone: "hand" },
    { key: "one", def: character({ name: "One", cost: 1 }), owner: P1, zone: "hand" },
    ...bank("obsession", 5, P1),
    ...bank("rage", 5, P1),
    ...extra
  ]);
const freePick = (engine: SpoilsEngine, cardId: CardInstanceId | undefined, selected?: Record<string, CardInstanceId[]>): void => {
  const pc = pending(engine)!;
  assert.equal(pc.kind, "deployForFree");
  assert.equal(pc.playerId, P1, "I decide the free deploys");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId, selected } } as never);
};
const offeredNames = (engine: SpoilsEngine): string[] =>
  ((pending(engine) as unknown as { candidates: string[] }).candidates ?? []).map(c => engine.getDefinition(c).name).sort();

clause(SHIFT, "0:rule", "costs 7 with [O]x5: exact works, one short / one icon short / spent-only refused; it is a tactic", costBody(SHIFT, { cost: 7, thresh: 5, type: "tactic" }));

clause(SHIFT, "0:rule", "all my non-resource cards in play return to their owners' hands (character, item, location); resources, my faction and the opponent's cards stay", () => {
  const { engine, id } = shiftBoard();
  play(engine, P1, id("c"));
  assert.equal(pending(engine)?.kind, "deployForFree");
  for (const k of ["a", "b", "l"]) assert.equal(zoneOf(engine, id(k)), "hand", `${k} bounced`);
  assert.equal(zoneOf(engine, id("foe")), "play");
  assert.equal(engine.state.players[P1].factionId !== undefined && zoneOf(engine, engine.state.players[P1].factionId!), "play");
  assert.equal(engine.state.players[P1].play.filter(c => engine.isResource(c)).length, 10, "all 10 resources stay");
  assert.equal(ready(engine, P1), 3, "only the cost 7 was paid");
});

clause(SHIFT, "0:rule", "X is the TOTAL cost of those cards: 3+2+4 = 9 can be deployed exactly (A, B and L for free), but not 9 plus 1 more", () => {
  const { engine, id } = shiftBoard();
  play(engine, P1, id("c"));
  assert.deepEqual(offeredNames(engine), ["Big", "One", "Shift A", "Shift B", "Shift L"].filter(n => n !== "Big"), "Big (10) is over X=9 and is not offered");
  freePick(engine, id("a"));
  freePick(engine, id("b"));
  freePick(engine, id("l"));
  drain(engine, declineAll);
  assert.deepEqual(["a", "b", "l"].map(k => zoneOf(engine, id(k))), ["play", "play", "play"]);
  assert.equal(ready(engine, P1), 3, "deployed for free: nothing more paid");
  assert.equal(zoneOf(engine, id("one")), "hand", "cost 1 would make 10 > 9");
  assert.equal(zoneOf(engine, id("big")), "hand");
});

clause(SHIFT, "0:rule", "a card costing more than X is refused; a card costing exactly X is allowed; X counts every non-resource card (a 15-cost card needs 15)", () => {
  const over = shiftBoard();
  play(over.engine, P1, over.id("c"));
  refused(() => freePick(over.engine, over.id("big")), "cost 10 > X = 9");
  assert.equal(zoneOf(over.engine, over.id("big")), "hand");
  const exact = shiftBoard([{ key: "nine", def: character({ name: "Nine", cost: 9 }), owner: P1, zone: "hand" }]);
  play(exact.engine, P1, exact.id("c"));
  freePick(exact.engine, exact.id("nine"));
  drain(exact.engine, declineAll);
  assert.equal(zoneOf(exact.engine, exact.id("nine")), "play", "cost 9 == X");
  assert.equal(zoneOf(exact.engine, exact.id("a")), "hand", "the budget is used up");
});

clause(SHIFT, "0:rule", "X counts what I CONTROL, not what I own: a card the opponent owns but I control adds to X and returns to the opponent's hand; mine controlled by the opponent is not counted or bounced", () => {
  const g = shiftBoard([
    { key: "stolen", def: character({ name: "Stolen", cost: 6 }), owner: P2, controller: P1, zone: "play" },
    { key: "lent", def: character({ name: "Lent", cost: 7 }), owner: P1, controller: P2, zone: "play" },
    { key: "fifteen", def: character({ name: "Fifteen", cost: 15 }), owner: P1, zone: "hand" },
    { key: "sixteen", def: character({ name: "Sixteen", cost: 16 }), owner: P1, zone: "hand" }
  ]);
  play(g.engine, P1, g.id("c"));
  assert.equal(zoneOf(g.engine, g.id("stolen")), "hand");
  assert.ok(hand(g.engine, P2).includes(g.id("stolen")), "to its owner's hand");
  assert.equal(zoneOf(g.engine, g.id("lent")), "play", "controlled by the opponent: untouched");
  refused(() => freePick(g.engine, g.id("sixteen")), "X is 15 (9 + 6), not 16 or 22");
  freePick(g.engine, g.id("fifteen"));
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("fifteen")), "play");
});

clause(SHIFT, "0:rule", "X does not include cards in my hand, resources, or the opponent's cards: with only a resource and cheap hand cards X is 0", () => {
  const g = mk([
    { key: "c", def: printing(SHIFT), owner: P1, zone: "hand" },
    { key: "foe", def: character({ name: "Foe", cost: 5 }), owner: P2, zone: "play" },
    { key: "hc", def: character({ name: "Hand Costly", cost: 4 }), owner: P1, zone: "hand" },
    { key: "free", def: item({ name: "Free Item", cost: 0 }), owner: P1, zone: "hand" },
    { key: "res", def: resourceCard({ name: "Res", cost: 6 }), owner: P1, zone: "play" },
    ...bank("obsession", 7, P1)
  ]);
  play(g.engine, P1, g.id("c"));
  assert.equal(zoneOf(g.engine, g.id("res")), "play");
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
  if (pending(g.engine)) refused(() => freePick(g.engine, g.id("hc")), "cost 4 > X = 0");
  assert.equal(zoneOf(g.engine, g.id("hc")), "hand");
  if (pending(g.engine)) freePick(g.engine, g.id("free"));
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("free")), "play", "a cost-0 card fits X = 0");
});

clause(SHIFT, "0:rule", "the free deploys are optional ('may', any number): deploy none, one, or several; the rest stay in hand", () => {
  const none = shiftBoard();
  play(none.engine, P1, none.id("c"));
  freePick(none.engine, undefined);
  drain(none.engine, declineAll);
  assert.deepEqual(["a", "b", "l"].map(k => zoneOf(none.engine, none.id(k))), ["hand", "hand", "hand"]);
  const one = shiftBoard();
  play(one.engine, P1, one.id("c"));
  freePick(one.engine, one.id("l"));
  if (pending(one.engine)) freePick(one.engine, undefined);
  drain(one.engine, declineAll);
  assert.deepEqual(["a", "b", "l"].map(k => zoneOf(one.engine, one.id(k))), ["hand", "hand", "play"]);
});

clause(SHIFT, "0:rule", "the free deploys still need their threshold and extra costs: a [G] card with no [G] is refused; Redonkulous (extra cost: pick a character) needs its pick", () => {
  const g = shiftBoard([
    { key: "needG", def: character({ name: "NeedsGreed", cost: 1, threshold: "g" }), owner: P1, zone: "hand" },
    { key: "redonk", def: printing(REDONK), owner: P1, zone: "hand" }
  ]);
  play(g.engine, P1, g.id("c"));
  refused(() => freePick(g.engine, g.id("needG")), "threshold [G] is not met");
  assert.equal(zoneOf(g.engine, g.id("needG")), "hand");
  refused(() => freePick(g.engine, g.id("redonk")), "the extra cost pick is missing");
  assert.equal(zoneOf(g.engine, g.id("redonk")), "hand");
  freePick(g.engine, g.id("redonk"), { char: [g.id("foe")] });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("redonk")), "discard", "deployed for free with its pick (a tactic resolves into the discard pile)");
  assert.equal(ready(g.engine, P1), 3, "free: Redonkulous's own cost 3 was not paid");
});

// ============================================================================
// Redonkulous -- tactic cost 3 [O][O]: EXTRA COST pick a character; FLIP UP: controller discards 2; <=3 in hand: remove from game; FLIP UP 5 [O][O]
// ============================================================================
interface RBoard { fd?: boolean; target?: "opp" | "mine" | "stolen" | "lent"; th?: number; mh?: number; o?: number; r?: number }
function redonkBoard(o: RBoard = {}) {
  const t = o.target ?? "opp";
  const owner = t === "opp" || t === "stolen" ? P2 : P1;
  const controller = t === "opp" ? P2 : t === "mine" ? P1 : t === "stolen" ? P1 : P2;
  const targetCtl = controller;
  const thOwner = targetCtl; // hand whose size matters
  const other = thOwner === P1 ? P2 : P1;
  const cards: CardPlacement[] = [
    o.fd ? { key: "c", def: printing(REDONK), owner: P1, zone: "play", faceDown: true } : { key: "c", def: printing(REDONK), owner: P1, zone: "hand" },
    { key: "tc", def: character({ name: "Target", cost: 2 }), owner, controller, zone: "play" },
    { key: "it", def: item({ name: "An Item" }), owner: P2, zone: "play" },
    { key: "hc", def: character({ name: "Held Char" }), owner: P2, zone: "hand" },
    ...fillers("th", o.th ?? 0, thOwner, "hand"),
    ...fillers("ot", o.mh ?? 0, other, "hand"),
    ...bank("obsession", o.o ?? (o.fd ? 2 : 2), P1),
    ...bank("rage", o.r ?? (o.fd ? 3 : 1), P1)
  ];
  return mk(cards);
}
type RG = ReturnType<typeof redonkBoard>;
const flip = (g: RG, selected: Record<string, CardInstanceId[]> = { char: [g.id("tc")] }): void =>
  flipUpNow(g.engine, { type: "flipUp", playerId: P1, cardId: g.id("c"), selected, variables: {} });
const handOf = (g: RG, p: PlayerId): number => hand(g.engine, p).filter(c => g.engine.state.cards[c]).length;

clause(REDONK, "0:extraCost", "costs 3 with [O][O]: exact works, one short / one icon short / spent-only refused; it is a tactic", costBody(REDONK, { cost: 3, thresh: 2, type: "tactic", extra: [{ key: "tc", def: character({ name: "Target" }), owner: P2, zone: "play" }], selected: k => ({ char: [k("tc")] }) }));

clause(REDONK, "0:extraCost", "a character in play must be picked: any controller's character is fine; none, an item, a card in hand, and Redonkulous itself are refused and nothing is paid", () => {
  for (const t of ["opp", "mine"] as const) {
    const ok = redonkBoard({ target: t, th: 5 });
    play(ok.engine, P1, ok.id("c"), { selected: { char: [ok.id("tc")] } });
    drain(ok.engine, declineAll);
    assert.equal(zoneOf(ok.engine, ok.id("c")), "discard", `control: pick a ${t} character`);
  }
  for (const bad of ["it", "hc", "c", undefined]) {
    const g = redonkBoard({ th: 5 });
    refused(() => play(g.engine, P1, g.id("c"), bad ? { selected: { char: [g.id(bad)] } } : {}), `bad pick ${bad}`);
    assert.equal(zoneOf(g.engine, g.id("c")), "hand");
    assert.equal(zoneOf(g.engine, g.id("tc")), "play");
    assert.equal(ready(g.engine, P1), 3, "nothing paid");
  }
});

clause(REDONK, "1:rule", "NOT deployed with FLIP UP: no discard happens even with a big hand; a controller with 4 or more cards keeps the character", () => {
  const g = redonkBoard({ th: 4 });
  play(g.engine, P1, g.id("c"), { selected: { char: [g.id("tc")] } });
  assert.equal(pending(g.engine), undefined, "no discard prompt");
  assert.equal(zoneOf(g.engine, g.id("tc")), "play", "4 cards in hand: not removed");
  assert.equal(handOf(g, P2), 4 + 1, "hand intact (4 + the unrelated Held Char)");
});

clause(REDONK, "1:rule", "normal deploy: the opponent's character is removed from the game when its controller has 3 or fewer cards in hand, and stays with 4", () => {
  const few = redonkBoard({ th: 2 });
  play(few.engine, P1, few.id("c"), { selected: { char: [few.id("tc")] } });
  drain(few.engine, declineAll);
  assert.equal(zoneOf(few.engine, few.id("tc")), "removed", "2 + Held Char = 3 cards in hand: removed");
  assert.equal(handOf(few, P2), 3, "no discard happened");
  const more = redonkBoard({ th: 3 });
  play(more.engine, P1, more.id("c"), { selected: { char: [more.id("tc")] } });
  drain(more.engine, declineAll);
  assert.equal(zoneOf(more.engine, more.id("tc")), "play", "3 + Held Char = 4 cards: stays");
});

clause(REDONK, "1:rule", "normal deploy on my own character: judged by MY hand (after Redonkulous left it), removed with 3, kept with 4", () => {
  const three = redonkBoard({ target: "mine", th: 3 });
  play(three.engine, P1, three.id("c"), { selected: { char: [three.id("tc")] } });
  drain(three.engine, declineAll);
  assert.equal(zoneOf(three.engine, three.id("tc")), "removed");
  assert.equal(handOf(three, P1), 3);
  const four = redonkBoard({ target: "mine", th: 4 });
  play(four.engine, P1, four.id("c"), { selected: { char: [four.id("tc")] } });
  drain(four.engine, declineAll);
  assert.equal(zoneOf(four.engine, four.id("tc")), "play");
  assert.equal(handOf(four, P1), 4);
});

clause(REDONK, "1:rule", "'that character's controller' decides both counts: a character I own but the opponent controls is judged by the OPPONENT's hand, not mine (and vice versa)", () => {
  const lent = redonkBoard({ target: "lent", th: 3, mh: 0 }); // P2 controls; P2 has 3 (+Held Char = 4), P1 has 0
  play(lent.engine, P1, lent.id("c"), { selected: { char: [lent.id("tc")] } });
  drain(lent.engine, declineAll);
  assert.equal(zoneOf(lent.engine, lent.id("tc")), "play", "controller P2 has 4 cards; my empty hand is irrelevant");
  const lent2 = redonkBoard({ target: "lent", th: 1, mh: 5 }); // P2 has 1+1 = 2; P1 has 5
  play(lent2.engine, P1, lent2.id("c"), { selected: { char: [lent2.id("tc")] } });
  drain(lent2.engine, declineAll);
  assert.equal(zoneOf(lent2.engine, lent2.id("tc")), "removed", "controller P2 has 2 cards");
  const stolen = redonkBoard({ target: "stolen", th: 4, mh: 0 }); // P1 controls P2's card; P1 has 4, P2 has 0
  play(stolen.engine, P1, stolen.id("c"), { selected: { char: [stolen.id("tc")] } });
  drain(stolen.engine, declineAll);
  assert.equal(zoneOf(stolen.engine, stolen.id("tc")), "play", "controller P1 has 4 cards; the owner's empty hand is irrelevant");
});

clause(REDONK, "1:rule", "FLIP UP, opponent's character, hand 6: the opponent chooses and discards 2 (4 left), so the character stays", () => {
  const g = redonkBoard({ fd: true, th: 5 }); // 5 + Held Char = 6
  flip(g);
  const pc = pending(g.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "that character's controller (the opponent) discards");
  refused(() => pickTarget(g.engine, [g.id("th0")]), "exactly 2");
  refused(() => pickTarget(g.engine, [g.id("th0"), g.id("th1"), g.id("th2")]), "not 3");
  pickTarget(g.engine, [g.id("th0"), g.id("th3")]);
  assert.equal(pending(g.engine), undefined);
  assert.deepEqual(["th0", "th3"].map(k => zoneOf(g.engine, g.id(k))), ["discard", "discard"]);
  assert.deepEqual(["th1", "th2", "th4", "hc"].map(k => zoneOf(g.engine, g.id(k))), ["hand", "hand", "hand", "hand"]);
  assert.equal(zoneOf(g.engine, g.id("tc")), "play", "4 cards left: stays");
  assert.equal(zoneOf(g.engine, g.id("c")), "discard", "the flipped tactic resolves into the discard pile");
});

clause(REDONK, "1:rule", "FLIP UP, hand 5 -> 3 left and hand 4 -> 2 left: the character is removed from the game after the discard", () => {
  for (const th of [4, 3]) {
    const g = redonkBoard({ fd: true, th }); // th + Held Char
    flip(g);
    drain(g.engine, pickIds([g.id("th0"), g.id("th1")]));
    assert.equal(handOf(g, P2), th + 1 - 2);
    assert.equal(zoneOf(g.engine, g.id("tc")), "removed", `${th + 1} -> ${th - 1} cards: removed`);
  }
});

clause(REDONK, "1:rule", "FLIP UP, hand of exactly 2 or 1 or 0: discards what it can, then the character is removed (<= 3)", () => {
  const two = redonkBoard({ fd: true, th: 1 }); // 1 + Held Char = 2
  flip(two);
  drain(two.engine, pickIds([two.id("th0"), two.id("hc")]));
  assert.equal(handOf(two, P2), 0);
  assert.equal(zoneOf(two.engine, two.id("tc")), "removed");
  const none = redonkBoard({ fd: true, th: 0 });
  none.engine.state.players[P2].hand.length; // 1 card: Held Char
  flip(none);
  drain(none.engine, pickIds([none.id("hc")]));
  assert.equal(zoneOf(none.engine, none.id("hc")), "discard");
  assert.equal(zoneOf(none.engine, none.id("tc")), "removed");
});

clause(REDONK, "1:rule", "FLIP UP on my own character: I choose and discard 2 from MY hand, then my character is removed if I have 3 or fewer left; the opponent's hand is untouched", () => {
  const stay = redonkBoard({ fd: true, target: "mine", th: 6, mh: 4 });
  flip(stay);
  const pc = pending(stay.engine)!;
  assert.equal(pc.playerId, P1, "I am the controller, so I discard");
  pickTarget(stay.engine, [stay.id("th0"), stay.id("th1")]);
  assert.deepEqual(["th0", "th1"].map(k => zoneOf(stay.engine, stay.id(k))), ["discard", "discard"], "my two discards go to my discard pile");
  assert.equal(handOf(stay, P1), 4);
  assert.equal(handOf(stay, P2), 4 + 1, "opponent untouched");
  assert.equal(zoneOf(stay.engine, stay.id("tc")), "play", "4 left: stays");
  const go = redonkBoard({ fd: true, target: "mine", th: 5, mh: 9 });
  flip(go);
  pickTarget(go.engine, [go.id("th0"), go.id("th1")]);
  assert.equal(zoneOf(go.engine, go.id("tc")), "removed", "3 left: removed");
  assert.equal(handOf(go, P2), 9 + 1, "opponent untouched");
});

clause(REDONK, "1:rule", "FLIP UP follows the character's CONTROLLER: a character I control but the opponent owns makes ME discard; one the opponent controls makes THEM discard", () => {
  const stolen = redonkBoard({ fd: true, target: "stolen", th: 5, mh: 6 });
  flip(stolen);
  assert.equal(pending(stolen.engine)?.playerId, P1);
  pickTarget(stolen.engine, [stolen.id("th0"), stolen.id("th1")]);
  assert.equal(zoneOf(stolen.engine, stolen.id("tc")), "removed", "my hand is 3 now");
  assert.equal(handOf(stolen, P2), 6 + 1, "the owner's hand is untouched");
  const lent = redonkBoard({ fd: true, target: "lent", th: 4, mh: 0 });
  flip(lent);
  assert.equal(pending(lent.engine)?.playerId, P2);
  pickTarget(lent.engine, [lent.id("th0"), lent.id("th1")]);
  assert.equal(zoneOf(lent.engine, lent.id("tc")), "removed");
});

clause(REDONK, "2:flipUp", "FLIP UP costs exactly 5 with [O][O] (the face-down card itself may help pay, its own icon does not count toward the threshold) and needs the character pick", () => {
  const exact = redonkBoard({ fd: true, th: 5, o: 2, r: 2 }); // 4 others + itself = 5
  flip(exact);
  drain(exact.engine, pickIds([exact.id("th0"), exact.id("th1")]));
  assert.equal(zoneOf(exact.engine, exact.id("c")), "discard");
  assert.equal(ready(exact.engine, P1), 0);
  const spare = redonkBoard({ fd: true, th: 5, o: 2, r: 5 });
  flip(spare);
  drain(spare.engine, pickIds([spare.id("th0"), spare.id("th1")]));
  assert.ok([2, 3].includes(ready(spare.engine, P1)), `rule-neutral ready count after paying 5 of 8 (got ${ready(spare.engine, P1)})`);
  const short = redonkBoard({ fd: true, th: 5, o: 2, r: 1 });
  refused(() => flip(short), "itself + 3 others is only 4");
  assert.equal(short.engine.state.cards[short.id("c")].faceDown, true);
  assert.equal(ready(short.engine, P1), 4, "nothing paid");
  const oneO = redonkBoard({ fd: true, th: 5, o: 1, r: 3 });
  refused(() => flip(oneO), "5 resources but only one [O]");
  assert.equal(oneO.engine.state.cards[oneO.id("c")].faceDown, true);
  const noO = redonkBoard({ fd: true, th: 5, o: 0, r: 6 });
  refused(() => flip(noO), "no [O]: the face-down card's own Volition is not [O]");
  assert.equal(noO.engine.state.cards[noO.id("c")].faceDown, true);
  const noPick = redonkBoard({ fd: true, th: 5, o: 2, r: 2 });
  refused(() => flip(noPick, {}), "FLIP UP still needs the extra-cost pick");
  refused(() => flip(noPick, { char: [noPick.id("it")] }), "an item is not a character");
  assert.equal(noPick.engine.state.cards[noPick.id("c")].faceDown, true);
  assert.equal(ready(noPick.engine, P1), 5, "nothing paid by the refusals");
});

// ============================================================================
// Titillated Mooncalf -- character cost 1 [O] 1/3/1 monstrosity: an [O]-providing card enters under my control: may pick a character, COVERT this turn
// ============================================================================
const moonBoard = (resDefs: Array<{ key: string; def: ReturnType<typeof resourceCard>; owner?: PlayerId }>, active: PlayerId = P1, moonZone: "play" | "hand" = "play") =>
  mk([
    { key: "moon", def: printing(MOON), owner: P1, zone: moonZone },
    { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
    { key: "ally2", def: character({ name: "Ally Two" }), owner: P1, zone: "play" },
    { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
    { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
    ...resDefs.map(r => ({ key: r.key, def: r.def, owner: r.owner ?? P1, zone: "hand" as const })),
    ...fillers("md", 3, P1, "deck"),
    ...fillers("od", 3, P2, "deck")
  ], active);
const obs = (name = "Obs") => resourceCard({ name, resource: { provides: ["obsession"], staple: true } });
const rageRes = () => resourceCard({ name: "Rage Res", resource: { provides: ["rage"], staple: true } });
const dev = (g: ReturnType<typeof moonBoard>, key: string, faceDown = false, p: PlayerId = P1) => developResource(g.engine, p, g.id(key), faceDown);

clause(MOON, "0:rule", "costs 1 with [O] (exact / no ready resource / wrong icon / spent-only); printed 1/3/1 monstrosity; not castable on the opponent's turn", () => {
  costBody(MOON, { cost: 1, thresh: 1, type: "character" })();
  statsBody(MOON, "monstrosity", 1, 3, 1)();
});

clause(MOON, "0:rule", "playing an [O] resource face-up under my control: I am asked once (optional), pick a character, and it gains COVERT; others do not", () => {
  const g = moonBoard([{ key: "r", def: obs() }]);
  dev(g, "r");
  const pc = pending(g.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I choose");
  assert.equal(hasCovert(g.engine, g.id("ally")), false, "no COVERT before the pick");
  pickTarget(g.engine, [g.id("ally")]);
  assert.equal(pending(g.engine), undefined, "asked exactly once");
  assert.equal(hasCovert(g.engine, g.id("ally")), true);
  assert.equal(hasCovert(g.engine, g.id("ally2")), false);
  assert.equal(hasCovert(g.engine, g.id("foe")), false);
  assert.equal(hasCovert(g.engine, g.id("moon")), false);
});

clause(MOON, "0:rule", "the pick may be any character: the opponent's, the Mooncalf itself; an item or a card in hand is refused; picking nobody is allowed", () => {
  const foe = moonBoard([{ key: "r", def: obs() }]);
  dev(foe, "r");
  pickTarget(foe.engine, [foe.id("foe")]);
  assert.equal(hasCovert(foe.engine, foe.id("foe")), true);
  const self = moonBoard([{ key: "r", def: obs() }]);
  dev(self, "r");
  pickTarget(self.engine, [self.id("moon")]);
  assert.equal(hasCovert(self.engine, self.id("moon")), true);
  const bad = moonBoard([{ key: "r", def: obs() }]);
  dev(bad, "r");
  refused(() => pickTarget(bad.engine, [bad.id("gear")]), "an item is not a character");
  refused(() => pickTarget(bad.engine, [bad.id("ally"), bad.id("ally2")]), "only one character");
  pickTarget(bad.engine, []);
  assert.equal(pending(bad.engine), undefined);
  for (const k of ["ally", "ally2", "foe", "moon"]) assert.equal(hasCovert(bad.engine, bad.id(k)), false, `${k} gains nothing when declined`);
});

clause(MOON, "0:rule", "COVERT lasts only this turn: gone after the turn ends", () => {
  const g = moonBoard([{ key: "r", def: obs() }]);
  dev(g, "r");
  pickTarget(g.engine, [g.id("ally")]);
  assert.equal(hasCovert(g.engine, g.id("ally")), true);
  endTurn(g.engine, P1);
  assert.equal(hasCovert(g.engine, g.id("ally")), false, "the grant ended with the turn");
});

clause(MOON, "0:rule", "only a card that provides at least one [O]: a Rage resource, and a face-down card (it provides Volition only), do not trigger it", () => {
  const rage = moonBoard([{ key: "r", def: rageRes() }]);
  dev(rage, "r");
  assert.equal(pending(rage.engine), undefined, "Rage provides no [O]");
  const fd = moonBoard([{ key: "r", def: obs() }]);
  dev(fd, "r", true);
  assert.equal(pending(fd.engine), undefined, "face-down: Volition, not [O]");
  assert.equal(hasCovert(fd.engine, fd.id("ally")), false);
});

clause(MOON, "0:rule", "a card providing [O] twice (or [O] and another icon) still triggers it exactly once", () => {
  const dbl = moonBoard([{ key: "r", def: resourceCard({ name: "Double", resource: { provides: ["obsession", "obsession"] } }) }]);
  dev(dbl, "r");
  assert.equal(pending(dbl.engine)?.kind, "chooserSelectsTarget");
  pickTarget(dbl.engine, [dbl.id("ally")]);
  assert.equal(pending(dbl.engine), undefined, "one prompt only");
  const mix = moonBoard([{ key: "r", def: resourceCard({ name: "Mixed", resource: { provides: ["rage", "obsession"] } }) }]);
  dev(mix, "r");
  assert.equal(pending(mix.engine)?.kind, "chooserSelectsTarget");
  pickTarget(mix.engine, [mix.id("ally2")]);
  assert.equal(pending(mix.engine), undefined);
  assert.equal(hasCovert(mix.engine, mix.id("ally2")), true);
});

clause(MOON, "0:rule", "only under MY control: the opponent playing an [O] resource on their turn does not trigger my Mooncalf", () => {
  const g = moonBoard([{ key: "r", def: obs("Opp Obs"), owner: P2 }], P2);
  dev(g, "r", false, P2);
  assert.equal(pending(g.engine), undefined);
  assert.equal(hasCovert(g.engine, g.id("ally")), false);
  assert.equal(hasCovert(g.engine, g.id("foe")), false);
});

clause(MOON, "0:rule", "the Mooncalf must be in play: with it still in my hand, an [O] resource entering triggers nothing", () => {
  const g = moonBoard([{ key: "r", def: obs() }], P1, "hand");
  dev(g, "r");
  assert.equal(pending(g.engine), undefined);
  assert.equal(hasCovert(g.engine, g.id("ally")), false);
});

clause(ROUSE, "2:ability:recur", "Rouse removes itself as part of the cost BEFORE the pick, so it cannot pick itself: the tactic goes to the deck, Rouse does not", () => {
  const g = rouseBoard({ where: "discard" });
  refused(() => activate(g.engine, P1, g.id("c"), "recur", { selected: { rt: [g.id("c")] } }), "Rouse is already removed from the game when the pick is made");
  assert.equal(zoneOf(g.engine, g.id("c")), "discard");
  assert.equal(ready(g.engine, P1), 3);
});

const putter = (name: string) =>
  tactic({
    name,
    cost: 0,
    behavior: { abilities: [{ id: "p", type: "activated", targets: [{ id: "t", selector: { zone: "discard", owner: "self", type: "resource" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });
const viaEffect = (res: ReturnType<typeof resourceCard>, who: PlayerId = P1) => {
  const g = moonBoard([{ key: "put", def: putter("Putter"), owner: who }, { key: "r", def: res, owner: who }], who);
  g.engine.state.cards[g.id("r")].zone = "discard";
  return g;
};
const cast = (g: ReturnType<typeof moonBoard>, who: PlayerId = P1) => {
  const e = g.engine;
  e.state.players[who].hand = e.state.players[who].hand.filter(c => c !== g.id("r"));
  e.state.players[who].discard.push(g.id("r"));
  play(e, who, g.id("put"), { selected: { t: [g.id("r")] } });
};

clause(MOON, "0:rule", "an [O] card put into play by an effect (not Develop) also triggers it: asked once, the picked character gains COVERT; the pick is optional", () => {
  const g = viaEffect(obs());
  cast(g);
  assert.equal(zoneOf(g.engine, g.id("r")), "play", "the resource entered play");
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(g.engine)?.playerId, P1);
  pickTarget(g.engine, [g.id("foe")]);
  assert.equal(pending(g.engine), undefined, "asked once");
  assert.equal(hasCovert(g.engine, g.id("foe")), true);
  assert.equal(hasCovert(g.engine, g.id("ally")), false);
  const decline = viaEffect(obs());
  cast(decline);
  pickTarget(decline.engine, []);
  assert.equal(hasCovert(decline.engine, decline.id("ally")), false);
});

clause(MOON, "0:rule", "an effect putting a Rage card into play, or a double-[O] card, or an opponent's [O] card entering under their control: only the [O] cards under my control trigger it", () => {
  const rage = viaEffect(rageRes());
  cast(rage);
  assert.equal(pending(rage.engine), undefined, "no [O] provided");
  const dbl = viaEffect(resourceCard({ name: "Double", resource: { provides: ["obsession", "obsession"] } }));
  cast(dbl);
  assert.equal(pending(dbl.engine)?.kind, "chooserSelectsTarget");
  pickTarget(dbl.engine, [dbl.id("ally")]);
  assert.equal(pending(dbl.engine), undefined);
  assert.equal(hasCovert(dbl.engine, dbl.id("ally")), true);
  const opp = viaEffect(obs("Opp Obs"), P2);
  cast(opp, P2);
  assert.equal(zoneOf(opp.engine, opp.id("r")), "play");
  assert.equal(pending(opp.engine), undefined, "the opponent's [O] card is not under my control");
  assert.equal(hasCovert(opp.engine, opp.id("foe")), false);
});
