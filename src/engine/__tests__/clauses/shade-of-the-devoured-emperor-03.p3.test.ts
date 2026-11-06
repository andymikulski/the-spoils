// Clause tests — batch shade-of-the-devoured-emperor-03, part p3 (groups 16-20, missing clauses).
// See docs/TESTING.md. Expectations come from each card's PRINTED text
// (Shade of the Devoured Emperor) and RULES.md / the CR; engine data is only used to drive the engine.

import assert from "node:assert/strict";
import { buildGame, activate, bank, character, developFaction, item, location, play, tactic, volition, P1, P2 } from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, refused } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { playRaw } from "./_battle.js";
import { answerPending, pending, tokensOn, zoneOf } from "./_board.js";
import { endTurn } from "./_turn.js";
import type { CardDefinition, CardInstanceId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

type Pid = typeof P1 | typeof P2;
const ready = (engine: SpoilsEngine, p: Pid = P1) => engine.getAvailableResourceCount(p);
const elit = (engine: SpoilsEngine, p: Pid = P1) => engine.getThresholds(p).elitism ?? 0;
const handOf = (engine: SpoilsEngine, p: Pid) => engine.state.players[p].hand;
const deckOf = (engine: SpoilsEngine, p: Pid) => engine.state.players[p].deck;
const discardOf = (engine: SpoilsEngine, p: Pid) => engine.state.players[p].discard;
const sorted = (ids: readonly string[]) => [...ids].sort();
const lcg = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
};
/** A bank of `n` elitism resources that are already spent (attached to P1's faction). */
const spentElitism = (n: number): CardPlacement[] => bank("elitism", n, P1).map((placement) => ({ ...placement, attachedToKey: "__factionA" }));
/** Answers the open picker with `selected`. */
const pick = (engine: SpoilsEngine, selected: Record<string, string[]>) => {
  const pc = pending(engine)!;
  engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "selectTargets", selected } } as never);
};
const tokensOfPlayer = (engine: SpoilsEngine, p: Pid): CardInstanceId[] =>
  Object.values(engine.state.cards)
    .filter((card) => card.isToken && card.zone === "play" && card.controllerId === p)
    .map((card) => card.id);
/** A free tactic that puts `count` tokens called `name` into play under `who`'s control. */
const makeTokens = (count: number, who: "controller" | "opponent", name = "Micromajig"): CardDefinition =>
  tactic({
    name: `Make-${who}-${count}-${name}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "m",
          type: "activated",
          effects: [{ type: "createTokens", controller: who, count, token: { name, cardType: "character", subtype: [], strength: 1, life: 1, speed: 3 } }]
        }
      ]
    }
  });
/** A free tactic that destroys one chosen item in play (declaration `t`). */
const smashItem = (): CardDefinition =>
  tactic({
    name: "Smash",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "k",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

// ============================================================================
// Accumulation Majig — cost 4 · threshold e · str 4 / spd 4 / life 4
// ============================================================================
const AM = "f235f7f5-ae5d-4b85-a187-6bfaf9d454cd";

/** Accumulation Majig (P1) in play with `tokens` tokens and `res` elitism resources; P2 is the active player so P2 ending its turn starts P1's turn. */
function amBoard(
  tokens: number,
  res: number,
  o: { active?: Pid; controller?: Pid; extra?: CardPlacement[] } = {}
) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: o.active ?? P2,
    turn: 2,
    cards: [
      { key: "am", def: printing(AM), owner: P1, controller: o.controller, zone: "play", counters: { token: tokens } },
      ...bank("elitism", res, P1),
      ...(o.extra ?? [])
    ]
  });
}

clause(AM, "0:rule", "deploys for cost 4 with threshold e, as a 4/4/4 with speed 4 and no tokens", () => {
  const board = (res: number, icon: "elitism" | "rage") =>
    buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "am", def: printing(AM), owner: P1, zone: "hand" }, ...bank(icon, res, P1)] });
  const short = board(3, "elitism");
  refused(() => play(short.engine, P1, short.id("am"), {}), "cost 4 with only 3 resources");
  const noIcon = board(4, "rage");
  refused(() => play(noIcon.engine, P1, noIcon.id("am"), {}), "threshold e needs an elitism icon");
  const oneIcon = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "am", def: printing(AM), owner: P1, zone: "hand" }, ...bank("elitism", 1, P1), ...bank("rage", 3, P1)]
  });
  play(oneIcon.engine, P1, oneIcon.id("am"), {});
  assert.equal(zoneOf(oneIcon.engine, oneIcon.id("am")), "play", "a single elitism icon satisfies threshold e");
  const { engine, id } = board(4, "elitism");
  play(engine, P1, id("am"), {});
  assert.equal(zoneOf(engine, id("am")), "play");
  assert.equal(ready(engine), 0, "cost 4 paid");
  assert.deepEqual(
    [engine.getStat(id("am"), "strength"), engine.getStat(id("am"), "speed"), engine.getStat(id("am"), "life")],
    [4, 4, 4]
  );
  assert.equal(tokensOn(engine, id("am")), 0, "enters with no tokens");
});

clause(AM, "0:rule", "start of your turn: you may pay 1 for each token on this card; paying keeps it (and the tokens)", () => {
  const { engine, id } = amBoard(3, 5);
  endTurn(engine, P2);
  const pc = pending(engine)!;
  assert.equal(pc.kind, "mayPay", "asked at the start of P1's turn");
  assert.equal(pc.playerId, P1);
  assert.equal(ready(engine), 5, "nothing is paid until the player agrees");
  assert.equal(zoneOf(engine, id("am")), "play", "not destroyed while the question is open");
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("am")), "play", "paid, so it stays");
  assert.equal(ready(engine), 2, "3 tokens: pays 3");
  assert.equal(tokensOn(engine, id("am")), 3, "paying does not remove tokens");
});

clause(AM, "0:rule", "if you don't pay, destroy this card (and nothing is paid)", () => {
  const { engine, id } = amBoard(3, 5);
  endTurn(engine, P2);
  assert.equal(pending(engine)!.kind, "mayPay");
  answerPending(engine, "mayPay", { pay: false });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("am")), "discard", "declined: destroyed");
  assert.ok(discardOf(engine, P1).includes(id("am")), "discardOf(engine, P1).includes(id(\"am\"))");
  assert.equal(ready(engine), 5, "no resources spent");
});

clause(AM, "0:rule", "pays exactly 1 per token on THIS card (tokens on other cards don't count)", () => {
  for (const n of [1, 2, 4]) {
    const { engine, id } = amBoard(n, 5, {
      extra: [{ key: "other", def: character({ name: "Other" }), owner: P1, zone: "play", counters: { token: 6 } }]
    });
    endTurn(engine, P2);
    answerPending(engine, "mayPay", { pay: true });
    assert.equal(ready(engine), 5 - n, `${n} token(s) cost ${n}`);
    assert.equal(zoneOf(engine, id("am")), "play");
    assert.equal(tokensOn(engine, id("other")), 6, "other cards' tokens untouched");
  }
});

clause(AM, "0:rule", "with no tokens the payment is 0: paying (nothing) keeps it, declining destroys it", () => {
  const pay = amBoard(0, 3);
  endTurn(pay.engine, P2);
  assert.equal(pending(pay.engine)!.kind, "mayPay", "still a may-pay question");
  answerPending(pay.engine, "mayPay", { pay: true });
  assert.equal(zoneOf(pay.engine, pay.id("am")), "play");
  assert.equal(ready(pay.engine), 3, "pay 0");
  const no = amBoard(0, 3);
  endTurn(no.engine, P2);
  answerPending(no.engine, "mayPay", { pay: false });
  assert.equal(zoneOf(no.engine, no.id("am")), "discard");
});

clause(AM, "0:rule", "can't pay (not enough resources): you don't pay, so it's destroyed; exactly enough keeps it", () => {
  const exact = amBoard(3, 3);
  endTurn(exact.engine, P2);
  answerPending(exact.engine, "mayPay", { pay: true });
  assert.equal(zoneOf(exact.engine, exact.id("am")), "play");
  assert.equal(ready(exact.engine), 0);
  const short = amBoard(3, 2);
  endTurn(short.engine, P2);
  if (pending(short.engine)) {
    refused(() => answerPending(short.engine, "mayPay", { pay: true }), "3 tokens cost 3, only 2 ready");
    answerPending(short.engine, "mayPay", { pay: false });
  }
  assert.equal(pending(short.engine), undefined);
  assert.equal(zoneOf(short.engine, short.id("am")), "discard", "unpaid, destroyed");
  assert.equal(ready(short.engine), 2, "nothing was spent");
});

clause(AM, "0:rule", "only at the start of ITS CONTROLLER's turn: not the opponent's turn, and a stolen copy asks its new controller", () => {
  // The owner's own turn end / opponent's turn start asks nothing.
  const own = amBoard(3, 5, { active: P1 });
  endTurn(own.engine, P1);
  assert.equal(pending(own.engine), undefined, "P2's turn start: no upkeep question for P1's card");
  assert.equal(zoneOf(own.engine, own.id("am")), "play");
  // Controlled by P2 (owned by P1): P1's turn start asks nothing, P2's turn start asks P2.
  const { engine, id } = amBoard(3, 0, { controller: P2, extra: bank("elitism", 5, P2) });
  endTurn(engine, P2); // P2's turn ends (its controller: +1 token), P1's turn begins
  assert.equal(tokensOn(engine, id("am")), 4);
  assert.equal(pending(engine), undefined, "P1's turn start: P1 doesn't control it");
  assert.equal(zoneOf(engine, id("am")), "play");
  endTurn(engine, P1);
  const pc = pending(engine)!;
  assert.equal(pc.kind, "mayPay", "P2's turn start: asked");
  assert.equal(pc.playerId, P2, "the controller is asked");
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(ready(engine, P2), 1, "P2 paid 4 of its 5");
  assert.equal(zoneOf(engine, id("am")), "play");
});

clause(AM, "1:rule", "end of your turn: put a token on this card (2 -> 3, 0 -> 1)", () => {
  for (const [start, end] of [[2, 3], [0, 1]] as const) {
    const { engine, id } = amBoard(start, 5, { active: P1 });
    endTurn(engine, P1);
    assert.equal(pending(engine), undefined);
    assert.equal(tokensOn(engine, id("am")), end, `${start} -> ${end}`);
    assert.equal(zoneOf(engine, id("am")), "play");
  }
});

clause(AM, "1:rule", "not at the end of the opponent's turn (tokens unchanged when P2 ends its turn)", () => {
  const { engine, id } = amBoard(3, 5, { active: P2 });
  endTurn(engine, P2);
  assert.equal(pending(engine)!.kind, "mayPay", "P1's upkeep");
  assert.equal(tokensOn(engine, id("am")), 3, "P2's turn ending added nothing");
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(tokensOn(engine, id("am")), 3);
});

clause(AM, "1:rule", "'your turn' is its controller's: a stolen copy gains a token at the end of the controller's turn only", () => {
  const { engine, id } = amBoard(3, 0, { controller: P2, active: P1, extra: bank("elitism", 5, P2) });
  endTurn(engine, P1); // P1's turn ends: not the controller's turn
  assert.equal(pending(engine)!.kind, "mayPay", "P2's upkeep");
  assert.equal(tokensOn(engine, id("am")), 3, "the owner's turn ending added nothing");
  answerPending(engine, "mayPay", { pay: true });
  endTurn(engine, P2);
  assert.equal(tokensOn(engine, id("am")), 4, "the controller's turn ending adds one");
});

clause(AM, "1:rule", "tokens accumulate one per own turn, and the upkeep then costs one more each time", () => {
  const { engine, id } = amBoard(0, 4, { active: P1 });
  endTurn(engine, P1);
  assert.equal(tokensOn(engine, id("am")), 1);
  endTurn(engine, P2);
  assert.equal(pending(engine)!.kind, "mayPay");
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(ready(engine), 3, "upkeep 1");
  endTurn(engine, P1);
  assert.equal(tokensOn(engine, id("am")), 2);
  endTurn(engine, P2);
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(ready(engine), 2, "upkeep 2 (resources restored first)");
  assert.equal(zoneOf(engine, id("am")), "play");
});

const feedBoard = (tokens: number, res: number, extra: CardPlacement[] = []) =>
  buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "am", def: printing(AM), owner: P1, zone: "play", counters: { token: tokens } }, ...bank("elitism", res, P1), ...extra]
  });

clause(AM, "2:ability:accumulation-majig-feed", "COST pay 3; EFFECT removes a token from this card", () => {
  const { engine, id } = feedBoard(3, 5);
  activate(engine, P1, id("am"), "accumulation-majig-feed");
  assert.equal(ready(engine), 2, "paid 3");
  assert.equal(tokensOn(engine, id("am")), 2, "exactly one token removed");
  assert.equal(zoneOf(engine, id("am")), "play");
});

clause(AM, "2:ability:accumulation-majig-feed", "each use removes exactly one token and costs 3 again", () => {
  const { engine, id } = feedBoard(3, 6);
  activate(engine, P1, id("am"), "accumulation-majig-feed");
  activate(engine, P1, id("am"), "accumulation-majig-feed");
  assert.equal(tokensOn(engine, id("am")), 1);
  assert.equal(ready(engine), 0);
  refused(() => activate(engine, P1, id("am"), "accumulation-majig-feed"), "no resources left for a third use");
});

clause(AM, "2:ability:accumulation-majig-feed", "unaffordable: refused with 2 resources (accepted with 3)", () => {
  const poor = feedBoard(2, 2);
  refused(() => activate(poor.engine, P1, poor.id("am"), "accumulation-majig-feed"), "pay 3 with only 2");
  assert.equal(tokensOn(poor.engine, poor.id("am")), 2, "nothing removed");
  assert.equal(ready(poor.engine), 2, "nothing spent");
  const ok = feedBoard(2, 3);
  activate(ok.engine, P1, ok.id("am"), "accumulation-majig-feed");
  assert.equal(tokensOn(ok.engine, ok.id("am")), 1);
});

clause(AM, "2:ability:accumulation-majig-feed", "with no tokens the cost is still paid and the count doesn't go below 0", () => {
  const { engine, id } = feedBoard(0, 5);
  activate(engine, P1, id("am"), "accumulation-majig-feed");
  assert.equal(ready(engine), 2, "cost paid");
  assert.equal(tokensOn(engine, id("am")), 0, "still 0");
});

clause(AM, "2:ability:accumulation-majig-feed", "removes a token from THIS card, not from another card", () => {
  const { engine, id } = feedBoard(3, 5, [{ key: "other", def: character({ name: "Other" }), owner: P1, zone: "play", counters: { token: 4 } }]);
  activate(engine, P1, id("am"), "accumulation-majig-feed");
  assert.equal(tokensOn(engine, id("am")), 2);
  assert.equal(tokensOn(engine, id("other")), 4, "the other card keeps its tokens");
});

clause(AM, "2:ability:accumulation-majig-feed", "only its controller can use it", () => {
  const { engine, id } = feedBoard(3, 5, bank("elitism", 5, P2));
  refused(() => activate(engine, P2, id("am"), "accumulation-majig-feed"), "the opponent can't feed it", /do not control/i);
  assert.equal(tokensOn(engine, id("am")), 3);
  activate(engine, P1, id("am"), "accumulation-majig-feed");
  assert.equal(tokensOn(engine, id("am")), 2, "positive control: the controller can");
});

// ============================================================================
// Clockman Junk Picker — cost 4 · threshold ee · str 2 / spd 3 / life 1
// ============================================================================
const CJP = "f8953a4a-6a5a-4104-bfbc-4626645dc766";

/** Clockman in P1's hand with a mixed deck, P1 bank of `res` elitism. Deck order: f0 f1 itA f2 itB chr loc tac f3. */
function cjpBoard(res = 4, random?: () => number) {
  return buildGame({
    playerA: { faction: developFaction() },
    random,
    cards: [
      { key: "cjp", def: printing(CJP), owner: P1, zone: "hand" },
      { key: "f0", def: character({ name: "F0" }), owner: P1, zone: "deck" },
      { key: "f1", def: character({ name: "F1" }), owner: P1, zone: "deck" },
      { key: "itA", def: item({ name: "ItemA" }), owner: P1, zone: "deck" },
      { key: "f2", def: character({ name: "F2" }), owner: P1, zone: "deck" },
      { key: "itB", def: item({ name: "ItemB" }), owner: P1, zone: "deck" },
      { key: "chr", def: character({ name: "DeepChar" }), owner: P1, zone: "deck" },
      { key: "loc", def: location({ name: "DeepLoc" }), owner: P1, zone: "deck" },
      { key: "tac", def: tactic({ name: "DeepTac", cost: 0 }), owner: P1, zone: "deck" },
      { key: "f3", def: character({ name: "F3" }), owner: P1, zone: "deck" },
      { key: "oppItem", def: item({ name: "OppItem" }), owner: P2, zone: "deck" },
      { key: "handItem", def: item({ name: "HandItem" }), owner: P1, zone: "hand" },
      { key: "discItem", def: item({ name: "DiscItem" }), owner: P1, zone: "discard" },
      ...bank("elitism", res, P1)
    ]
  });
}

clause(CJP, "0:rule", "deploys for cost 4 with threshold ee, as a 2/3/1", () => {
  const short = cjpBoard(3);
  refused(() => play(short.engine, P1, short.id("cjp"), {}), "cost 4 with only 3 resources");
  const noIcon = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "cjp", def: printing(CJP), owner: P1, zone: "hand" }, ...bank("rage", 4, P1)] });
  refused(() => play(noIcon.engine, P1, noIcon.id("cjp"), {}), "threshold ee needs two elitism icons");
  const oneIcon = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "cjp", def: printing(CJP), owner: P1, zone: "hand" }, ...bank("elitism", 1, P1), ...bank("rage", 3, P1)]
  });
  refused(() => play(oneIcon.engine, P1, oneIcon.id("cjp"), {}), "only one elitism icon of the two required");
  const { engine, id } = cjpBoard(4);
  play(engine, P1, id("cjp"), {});
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("cjp")), "play");
  assert.equal(ready(engine), 0, "cost 4 paid");
  assert.deepEqual(
    [engine.getStat(id("cjp"), "strength"), engine.getStat(id("cjp"), "speed"), engine.getStat(id("cjp"), "life")],
    [2, 3, 1]
  );
});

clause(CJP, "0:rule", "ETB: search your deck for an item, reveal it, put it into play as a face-down resource", () => {
  const { engine, id } = cjpBoard(4);
  const deckBefore = [...deckOf(engine, P1)];
  play(engine, P1, id("cjp"), {});
  const pc = pending(engine)!;
  assert.equal(pc.kind, "selectTargets", "asked which item to fetch");
  pick(engine, { found: [id("itA")] });
  drain(engine, declineAll);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("itA")), "play", "the item is in play");
  assert.equal(engine.state.cards[id("itA")].faceDown, true, "face-down");
  assert.equal(ready(engine), 1, "a face-down card is a (Volition) resource: 4 spent, 1 new ready");
  assert.equal(zoneOf(engine, id("itB")), "deck", "only the one chosen item moved");
  assert.equal(sorted(deckOf(engine, P1)).join(), sorted(deckBefore.filter((c) => c !== id("itA"))).join(), "the rest of the deck is intact");
  const reveals = engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
  assert.equal(reveals.length, 1, "the search reveals once");
  const ev = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual([...ev.cardIds], [id("itA")], "the found item is revealed");
  assert.equal(ev.viewerId, "all", "to everyone");
});

clause(CJP, "0:rule", "'may': choosing no item leaves the deck's items where they are and puts nothing into play", () => {
  const { engine, id } = cjpBoard(4);
  const deckBefore = [...deckOf(engine, P1)];
  play(engine, P1, id("cjp"), {});
  assert.equal(pending(engine)!.kind, "selectTargets");
  pick(engine, { found: [] });
  drain(engine, declineAll);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("itA")), "deck");
  assert.equal(zoneOf(engine, id("itB")), "deck");
  assert.equal(zoneOf(engine, id("cjp")), "play");
  assert.equal(ready(engine), 0, "no new resource");
  assert.equal(sorted(deckOf(engine, P1)).join(), sorted(deckBefore).join(), "no card left the deck");
  const reveals = engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
  assert.equal(reveals.length, 0, "nothing was found, nothing is revealed");
});

clause(CJP, "0:rule", "only an item from YOUR deck: characters, locations, tactics, the opponent's deck and other zones are refused", () => {
  const { engine, id } = cjpBoard(4);
  play(engine, P1, id("cjp"), {});
  assert.equal(pending(engine)!.kind, "selectTargets");
  for (const key of ["chr", "loc", "tac", "f0", "oppItem", "handItem", "discItem"]) {
    refused(() => pick(engine, { found: [id(key)] }), `${key} is not an item in your deck`);
    assert.ok(pending(engine), "the picker is still open");
  }
  refused(() => pick(engine, { found: [id("itA"), id("itB")] }), "only one item");
  pick(engine, { found: [id("itB")] });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("itB")), "play", "positive control");
  assert.equal(engine.state.cards[id("itB")].faceDown, true);
  assert.equal(zoneOf(engine, id("itA")), "deck");
  assert.equal(zoneOf(engine, id("oppItem")), "deck");
  assert.equal(zoneOf(engine, id("handItem")), "hand");
  assert.equal(zoneOf(engine, id("discItem")), "discard");
});

clause(CJP, "0:rule", "searching shuffles the deck afterwards, whether or not an item was taken", () => {
  for (const take of [true, false]) {
    const { engine, id } = cjpBoard(4, lcg(12345));
    const deckBefore = [...deckOf(engine, P1)];
    play(engine, P1, id("cjp"), {});
    pick(engine, { found: take ? [id("itA")] : [] });
    drain(engine, declineAll);
    const expectedSet = take ? deckBefore.filter((c) => c !== id("itA")) : deckBefore;
    const after = [...deckOf(engine, P1)];
    assert.equal(sorted(after).join(), sorted(expectedSet).join(), "same cards");
    assert.notEqual(after.join(), expectedSet.join(), `shuffled (item taken: ${take})`);
  }
});

clause(CJP, "0:rule", "a deck with no item: nothing is put into play and the card still enters", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "cjp", def: printing(CJP), owner: P1, zone: "hand" },
      { key: "f0", def: character({ name: "F0" }), owner: P1, zone: "deck" },
      { key: "loc", def: location({ name: "DeepLoc" }), owner: P1, zone: "deck" },
      { key: "oppItem", def: item({ name: "OppItem" }), owner: P2, zone: "deck" },
      ...bank("elitism", 4, P1)
    ]
  });
  play(engine, P1, id("cjp"), {});
  drain(engine, declineAll);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("cjp")), "play");
  assert.equal(ready(engine), 0, "no resource appeared");
  assert.equal(zoneOf(engine, id("f0")), "deck");
  assert.equal(zoneOf(engine, id("oppItem")), "deck");
});

clause(CJP, "0:rule", "only when THIS card enters play: another card entering doesn't search", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "cjp", def: printing(CJP), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other", cost: 0 }), owner: P1, zone: "hand" },
      { key: "itA", def: item({ name: "ItemA" }), owner: P1, zone: "deck" }
    ]
  });
  play(engine, P1, id("other"), {});
  assert.equal(zoneOf(engine, id("other")), "play");
  assert.equal(pending(engine), undefined, "no search for another card's entry");
  assert.equal(zoneOf(engine, id("itA")), "deck");
});

const trashBoard = (extra: CardPlacement[] = [], res: CardPlacement[] = bank("elitism", 6, P1)) =>
  buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "cjp", def: printing(CJP), owner: P1, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "theirItem", def: item({ name: "TheirItem" }), owner: P2, zone: "play" },
      ...res,
      ...extra
    ]
  });

clause(CJP, "1:ability:clockman-trash", "COST pay 1 and destroy this card; EFFECT destroys the picked item (yours or the opponent's)", () => {
  for (const [key, owner] of [["myItem", P1], ["theirItem", P2]] as const) {
    const { engine, id } = trashBoard();
    activate(engine, P1, id("cjp"), "clockman-trash", { selected: { victim: [id(key)] } });
    assert.equal(zoneOf(engine, id("cjp")), "discard", "this card is destroyed (cost)");
    assert.ok(discardOf(engine, P1).includes(id("cjp")), "discardOf(engine, P1).includes(id(\"cjp\"))");
    assert.equal(zoneOf(engine, id(key)), "discard", `${key} destroyed`);
    assert.ok(discardOf(engine, owner).includes(id(key)), "in its owner's discard");
    assert.equal(ready(engine), 5, "paid exactly 1");
    const other = key === "myItem" ? "theirItem" : "myItem";
    assert.equal(zoneOf(engine, id(other)), "play", "only the picked item is destroyed");
  }
});

clause(CJP, "1:ability:clockman-trash", "only an item in play can be picked: characters, locations, face-down cards and cards in other zones are refused", () => {
  const { engine, id } = trashBoard([
    { key: "myChar", def: character({ name: "MyChar" }), owner: P1, zone: "play" },
    { key: "theirChar", def: character({ name: "TheirChar" }), owner: P2, zone: "play" },
    { key: "loc", def: location({ name: "Loc" }), owner: P2, zone: "play" },
    { key: "fdItem", def: item({ name: "FaceDownItem" }), owner: P1, zone: "play", faceDown: true },
    { key: "handItem", def: item({ name: "HandItem" }), owner: P1, zone: "hand" },
    { key: "deckItem", def: item({ name: "DeckItem" }), owner: P1, zone: "deck" },
    { key: "discItem", def: item({ name: "DiscItem" }), owner: P1, zone: "discard" }
  ]);
  const readyBefore = ready(engine); // 6 elitism + the face-down card's Volition
  for (const key of ["myChar", "theirChar", "loc", "fdItem", "handItem", "deckItem", "discItem"]) {
    refused(() => activate(engine, P1, id("cjp"), "clockman-trash", { selected: { victim: [id(key)] } }), `${key} is not an item in play`);
    assert.equal(zoneOf(engine, id("cjp")), "play", "nothing was paid or destroyed");
    assert.equal(ready(engine), readyBefore);
  }
  activate(engine, P1, id("cjp"), "clockman-trash", { selected: { victim: [id("myItem")] } });
  assert.equal(zoneOf(engine, id("myItem")), "discard", "positive control");
});

clause(CJP, "1:ability:clockman-trash", "threshold eeeeee: refused with only five elitism icons, allowed with six", () => {
  const five = trashBoard([], [...bank("elitism", 5, P1), ...bank("rage", 1, P1)]);
  refused(() => activate(five.engine, P1, five.id("cjp"), "clockman-trash", { selected: { victim: [five.id("myItem")] } }), "five icons");
  assert.equal(zoneOf(five.engine, five.id("cjp")), "play");
  assert.equal(zoneOf(five.engine, five.id("myItem")), "play");
  const six = trashBoard();
  activate(six.engine, P1, six.id("cjp"), "clockman-trash", { selected: { victim: [six.id("myItem")] } });
  assert.equal(zoneOf(six.engine, six.id("myItem")), "discard");
});

clause(CJP, "1:ability:clockman-trash", "unaffordable cost: refused when the threshold is met but no resource is ready to pay 1", () => {
  const broke = trashBoard([], spentElitism(6));
  assert.equal(ready(broke.engine), 0);
  refused(() => activate(broke.engine, P1, broke.id("cjp"), "clockman-trash", { selected: { victim: [broke.id("myItem")] } }), "pay 1 with nothing ready");
  assert.equal(zoneOf(broke.engine, broke.id("cjp")), "play");
  assert.equal(zoneOf(broke.engine, broke.id("myItem")), "play");
  const oneLeft = trashBoard([], [...spentElitism(5), ...bank("elitism", 1, P1)]);
  assert.equal(ready(oneLeft.engine), 1);
  activate(oneLeft.engine, P1, oneLeft.id("cjp"), "clockman-trash", { selected: { victim: [oneLeft.id("myItem")] } });
  assert.equal(zoneOf(oneLeft.engine, oneLeft.id("myItem")), "discard", "one ready resource is enough");
  assert.equal(ready(oneLeft.engine), 0);
});

// ============================================================================
// Draconic Luteoderm Suit — item · gearsmith · gear · cost 4 · threshold ee
// ============================================================================
const DS = "63ad03b6-2fbb-46b0-9f86-f264cc1479fe";
const JO = "4e071253-4a43-404c-aad5-15aa1e953501"; // Jo Ciendeilio (UNIQUE JO), 1st Edition
const AUTOFRAME = "f83b3af9-a7cb-4945-9632-bdfab77a111a"; // Testudine Autoframe (Shade of the Devoured Emperor)
const host = (name = "Host") => character({ name, strength: 1, life: 3, speed: 2 });
const gearItem = (name = "GearItem") => item({ name, cost: 0, subtype: ["gear"] });

clause(DS, "0:unique", "the UNIQUE identifier is DRACONIC LUTEDODERM SUIT", () => {
  assert.equal(printing(DS).unique, "draconic lutedoderm suit");
});

clause(DS, "0:unique", "you can't control two: playing a second one makes you keep one and destroy the other", () => {
  for (const keep of ["dsA", "dsB"]) {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "hostA", def: host("HostA"), owner: P1, zone: "play" },
        { key: "hostB", def: host("HostB"), owner: P1, zone: "play" },
        { key: "dsA", def: printing(DS), owner: P1, zone: "play", attachedToKey: "hostA" },
        { key: "dsB", def: printing(DS), owner: P1, zone: "hand" },
        ...bank("elitism", 4, P1)
      ]
    });
    play(engine, P1, id("dsB"), { selected: { attachTo: [id("hostB")] } });
    if (pending(engine)?.kind === "chooserSelectsOption") {
      // the first suit sees another gear card played and offers a draw: decline it
      answerPending(engine, "chooserSelectsOption", { index: 1 - drawOptionIndex(pending(engine)!) });
    }
    const pc = pending(engine)!;
    assert.equal(pc.kind, "uniqueSurvivor");
    assert.equal(pc.playerId, P1, "the controller chooses");
    assert.deepEqual(sorted(pc.candidates as string[]), sorted([id("dsA"), id("dsB")]));
    answerPending(engine, "uniqueSurvivor", { keep: id(keep) });
    assert.equal(pending(engine), undefined);
    const gone = keep === "dsA" ? "dsB" : "dsA";
    assert.equal(zoneOf(engine, id(keep)), "play", "the kept copy stays");
    assert.equal(zoneOf(engine, id(gone)), "discard", "the other copy is destroyed");
  }
});

clause(DS, "0:unique", "deploys for cost 4 with threshold ee (refused one resource short, or without two elitism icons)", () => {
  const board = (res: number, icon: "elitism" | "rage") =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "host", def: host(), owner: P1, zone: "play" },
        { key: "ds", def: printing(DS), owner: P1, zone: "hand" },
        ...bank(icon, res, P1)
      ]
    });
  const cast = (b: ReturnType<typeof board>) => play(b.engine, P1, b.id("ds"), { selected: { attachTo: [b.id("host")] } });
  const short = board(3, "elitism");
  refused(() => cast(short), "cost 4 with only 3 resources");
  assert.equal(zoneOf(short.engine, short.id("ds")), "hand");
  const noIcon = board(4, "rage");
  refused(() => cast(noIcon), "threshold ee needs elitism icons");
  const oneIcon = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "host", def: host(), owner: P1, zone: "play" },
      { key: "ds", def: printing(DS), owner: P1, zone: "hand" },
      ...bank("elitism", 1, P1),
      ...bank("rage", 3, P1)
    ]
  });
  refused(() => cast(oneIcon), "only one of the two elitism icons required");
  assert.equal(zoneOf(oneIcon.engine, oneIcon.id("ds")), "hand");
  const ok = board(4, "elitism");
  cast(ok);
  assert.equal(zoneOf(ok.engine, ok.id("ds")), "play");
  assert.equal(ready(ok.engine), 0, "cost 4 paid");
});

clause(DS, "0:unique", "UNIQUE is per player (the opponent's own copy is fine) and doesn't clash with other identifiers", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "hostA", def: host("HostA"), owner: P1, zone: "play" },
      { key: "hostB", def: host("HostB"), owner: P2, zone: "play" },
      { key: "oppDs", def: printing(DS), owner: P2, zone: "play", attachedToKey: "hostB" },
      { key: "otherUnique", def: item({ name: "Other Unique Gizmo", unique: "other unique gizmo" }), owner: P1, zone: "play" },
      { key: "ds", def: printing(DS), owner: P1, zone: "hand" },
      ...bank("elitism", 4, P1)
    ]
  });
  play(engine, P1, id("ds"), { selected: { attachTo: [id("hostA")] } });
  drain(engine, declineAll);
  assert.equal(pending(engine), undefined, "no Unique conflict");
  assert.equal(zoneOf(engine, id("ds")), "play");
  assert.equal(zoneOf(engine, id("oppDs")), "play");
  assert.equal(zoneOf(engine, id("otherUnique")), "play");
});

clause(DS, "1:rule", "the attached character gains 2 strength and 2 life (and nothing else)", () => {
  const { engine, id } = buildGame({
    cards: [
      { key: "host", def: host(), owner: P1, zone: "play" },
      { key: "bystander", def: host("Bystander"), owner: P1, zone: "play" },
      { key: "ds", def: printing(DS), owner: P1, zone: "play", attachedToKey: "host" }
    ]
  });
  assert.equal(engine.getStat(id("host"), "strength"), 3, "1 + 2");
  assert.equal(engine.getStat(id("host"), "life"), 5, "3 + 2");
  assert.equal(engine.getStat(id("host"), "speed"), 2, "speed is unchanged");
  assert.equal(engine.getStat(id("bystander"), "strength"), 1, "an unattached character is not buffed");
  assert.equal(engine.getStat(id("bystander"), "life"), 3);
});

clause(DS, "1:rule", "no bonus while it is not attached to anything; the opponent's character is buffed too when attached", () => {
  const loose = buildGame({
    cards: [
      { key: "a", def: host("A"), owner: P1, zone: "play" },
      { key: "b", def: host("B"), owner: P2, zone: "play" },
      { key: "ds", def: printing(DS), owner: P1, zone: "play" }
    ]
  });
  for (const key of ["a", "b"]) {
    assert.equal(loose.engine.getStat(loose.id(key), "strength"), 1);
    assert.equal(loose.engine.getStat(loose.id(key), "life"), 3);
  }
  const onFoe = buildGame({
    cards: [
      { key: "b", def: host("B"), owner: P2, zone: "play" },
      { key: "ds", def: printing(DS), owner: P1, zone: "play", attachedToKey: "b" }
    ]
  });
  assert.equal(onFoe.engine.getStat(onFoe.id("b"), "strength"), 3);
  assert.equal(onFoe.engine.getStat(onFoe.id("b"), "life"), 5);
});

clause(DS, "1:rule", "static: the bonus is gone once the suit leaves play, and stays gone", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "host", def: host(), owner: P1, zone: "play" },
      { key: "ds", def: printing(DS), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "smash", def: smashItem(), owner: P1, zone: "hand" }
    ]
  });
  assert.equal(engine.getStat(id("host"), "strength"), 3);
  play(engine, P1, id("smash"), { selected: { t: [id("ds")] } });
  assert.equal(zoneOf(engine, id("ds")), "discard");
  assert.equal(engine.getStat(id("host"), "strength"), 1, "back to printed strength");
  assert.equal(engine.getStat(id("host"), "life"), 3, "back to printed life");
  assert.equal(engine.getStat(id("host"), "strength"), 1, "and stays off");
  assert.equal(zoneOf(engine, id("host")), "play", "the host survives");
});

/** P1 has the suit in play on a host; `hand` cards are P1's; `deckN` cards are on top of P1's deck. */
function gearBoard(o: { suitZone?: "play" | "hand" | "discard"; active?: Pid; extra?: CardPlacement[] } = {}) {
  const suitZone = o.suitZone ?? "play";
  return buildGame({
    playerA: { faction: developFaction() },
    activePlayerId: o.active ?? P1,
    turn: 2,
    cards: [
      { key: "host", def: host(), owner: P1, zone: "play" },
      { key: "ds", def: printing(DS), owner: P1, zone: suitZone, attachedToKey: suitZone === "play" ? "host" : undefined },
      ...Array.from({ length: 4 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
      ...(o.extra ?? [])
    ]
  });
}
const drawOptionIndex = (pc: PendingChoiceLike): number => {
  const options = pc.options as { label: string }[];
  return options.findIndex((option) => /draw/i.test(option.label));
};

clause(DS, "2:rule", "another gear card played: you may draw a card (accept draws exactly the top card)", () => {
  const { engine, id } = gearBoard({ extra: [{ key: "g", def: gearItem(), owner: P1, zone: "hand" }] });
  const deckBefore = [...deckOf(engine, P1)];
  play(engine, P1, id("g"), {});
  const pc = pending(engine)!;
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P1, "the suit's controller chooses");
  assert.equal((pc.options as unknown[]).length, 2, "draw or decline");
  answerPending(engine, "chooserSelectsOption", { index: drawOptionIndex(pc) });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("g")), "play", "the gear card was played");
  assert.deepEqual([...handOf(engine, P1)], [deckBefore[0]], "exactly the top card was drawn");
  assert.deepEqual([...deckOf(engine, P1)], deckBefore.slice(1));
});

clause(DS, "2:rule", "'may': declining draws nothing", () => {
  const { engine, id } = gearBoard({ extra: [{ key: "g", def: gearItem(), owner: P1, zone: "hand" }] });
  const deckBefore = [...deckOf(engine, P1)];
  play(engine, P1, id("g"), {});
  const pc = pending(engine)!;
  assert.equal(pc.kind, "chooserSelectsOption");
  answerPending(engine, "chooserSelectsOption", { index: 1 - drawOptionIndex(pc) });
  assert.equal(pending(engine), undefined);
  assert.equal(handOf(engine, P1).length, 0, "nothing drawn");
  assert.deepEqual([...deckOf(engine, P1)], deckBefore);
  assert.equal(zoneOf(engine, id("g")), "play");
});

clause(DS, "2:rule", "non-gear cards played don't trigger it (item, character, tactic; no subtype or another subtype)", () => {
  const nonGear: [string, CardDefinition][] = [
    ["plain item", item({ name: "Plain", cost: 0 })],
    ["weapon item", item({ name: "Weapon", cost: 0, subtype: ["weapon"] })],
    ["near-miss subtype", item({ name: "Gearbox", cost: 0, subtype: ["gearbox"] })],
    ["character", character({ name: "Hero", cost: 0 })],
    ["tactic", tactic({ name: "Trick", cost: 0 })]
  ];
  for (const [label, def] of nonGear) {
    const { engine, id } = gearBoard({ extra: [{ key: "c", def, owner: P1, zone: "hand" }] });
    play(engine, P1, id("c"), {});
    assert.equal(pending(engine), undefined, `${label}: no draw offer`);
    assert.equal(handOf(engine, P1).length, 0, `${label}: nothing drawn`);
  }
});

clause(DS, "2:rule", "any gear card type triggers it: a gear character and a gear tactic as well as a gear item", () => {
  const gear: [string, CardDefinition][] = [
    ["gear character", character({ name: "GearHero", cost: 0, subtype: ["gear"] })],
    ["gear tactic", tactic({ name: "GearTrick", cost: 0, subtype: ["gear"] })]
  ];
  for (const [label, def] of gear) {
    const { engine, id } = gearBoard({ extra: [{ key: "c", def, owner: P1, zone: "hand" }] });
    play(engine, P1, id("c"), {});
    const pc = pending(engine);
    assert.equal(pc?.kind, "chooserSelectsOption", `${label}: offered a draw`);
    answerPending(engine, "chooserSelectsOption", { index: drawOptionIndex(pc!) });
    assert.equal(handOf(engine, P1).length, 1, `${label}: drew one`);
  }
});

clause(DS, "2:rule", "'any' gear card: the opponent playing gear lets the suit's controller draw", () => {
  const { engine, id } = gearBoard({
    active: P2,
    extra: [{ key: "g", def: gearItem(), owner: P2, zone: "hand" }]
  });
  const deckBefore = [...deckOf(engine, P1)];
  play(engine, P2, id("g"), {});
  const pc = pending(engine)!;
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P1, "P1, the suit's controller, decides");
  answerPending(engine, "chooserSelectsOption", { index: drawOptionIndex(pc) });
  assert.deepEqual([...handOf(engine, P1)], [deckBefore[0]], "P1 drew");
  assert.equal(handOf(engine, P2).length, 0, "P2 drew nothing");
});

clause(DS, "2:rule", "'other': the suit itself being played doesn't trigger it, but another player's suit does", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "hostA", def: host("HostA"), owner: P1, zone: "play" },
      { key: "hostB", def: host("HostB"), owner: P2, zone: "play" },
      { key: "oppDs", def: printing(DS), owner: P2, zone: "play", attachedToKey: "hostB" },
      { key: "ds", def: printing(DS), owner: P1, zone: "hand" },
      ...Array.from({ length: 3 }, (_, i) => ({ key: `a${i}`, def: character({ name: `A${i}` }), owner: P1, zone: "deck" as const })),
      ...Array.from({ length: 3 }, (_, i) => ({ key: `b${i}`, def: character({ name: `B${i}` }), owner: P2, zone: "deck" as const })),
      ...bank("elitism", 4, P1)
    ]
  });
  play(engine, P1, id("ds"), { selected: { attachTo: [id("hostA")] } });
  const pc = pending(engine)!;
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P2, "the OTHER suit's controller is offered the draw");
  answerPending(engine, "chooserSelectsOption", { index: drawOptionIndex(pc) });
  assert.equal(pending(engine), undefined, "the played suit does not offer its own controller a draw");
  assert.equal(handOf(engine, P2).length, 1);
  assert.equal(handOf(engine, P1).length, 0);
  assert.equal(zoneOf(engine, id("ds")), "play");
});

clause(DS, "2:rule", "only while it is in play: a suit in hand or discard offers nothing, and neither does a destroyed one", () => {
  for (const suitZone of ["hand", "discard"] as const) {
    const { engine, id } = gearBoard({ suitZone, extra: [{ key: "g", def: gearItem(), owner: P1, zone: "hand" }] });
    play(engine, P1, id("g"), {});
    assert.equal(pending(engine), undefined, `suit in ${suitZone}`);
    assert.equal(handOf(engine, P1).length, suitZone === "hand" ? 1 : 0, "no draw (the suit itself is in hand in one case)");
  }
  const { engine, id } = gearBoard({
    extra: [
      { key: "g", def: gearItem(), owner: P1, zone: "hand" },
      { key: "smash", def: smashItem(), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("smash"), { selected: { t: [id("ds")] } });
  assert.equal(zoneOf(engine, id("ds")), "discard");
  play(engine, P1, id("g"), {});
  assert.equal(pending(engine), undefined, "destroyed suit: no draw offer");
});

const fusionBoard = (o: { hostDef?: CardDefinition; attach?: boolean; res?: number; extra?: CardPlacement[] } = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    random: lcg(99),
    cards: [
      { key: "host", def: o.hostDef ?? printing(JO), owner: P1, zone: "play" },
      { key: "ds", def: printing(DS), owner: P1, zone: "play", attachedToKey: o.attach === false ? undefined : "host" },
      { key: "f0", def: character({ name: "F0" }), owner: P1, zone: "deck" },
      { key: "f1", def: character({ name: "F1" }), owner: P1, zone: "deck" },
      { key: "ta", def: character({ name: "Testudine Autoframe", strength: 5, life: 3, speed: 4 }), owner: P1, zone: "deck" },
      { key: "f2", def: character({ name: "F2" }), owner: P1, zone: "deck" },
      { key: "f3", def: character({ name: "F3" }), owner: P1, zone: "deck" },
      ...bank("elitism", o.res ?? 5, P1),
      ...(o.extra ?? [])
    ]
  });

clause(DS, "3:ability:draconic-suit-seraphim-fusion", "attached to a UNIQUE JO: pay 3 and destroy the suit, then fetch Testudine Autoframe into play", () => {
  const { engine, id } = fusionBoard();
  activate(engine, P1, id("ds"), "draconic-suit-seraphim-fusion", { selected: { td: [id("ta")] } });
  assert.equal(pending(engine), undefined);
  assert.equal(ready(engine), 2, "paid 3 of 5");
  assert.equal(zoneOf(engine, id("ds")), "discard", "the suit is destroyed");
  assert.equal(zoneOf(engine, id("ta")), "play", "Testudine Autoframe is in play");
  assert.equal(engine.state.cards[id("ta")].controllerId, P1);
  assert.equal(zoneOf(engine, id("host")), "play", "Jo is untouched");
  assert.equal(zoneOf(engine, id("f0")), "deck");
});

clause(DS, "3:ability:draconic-suit-seraphim-fusion", "'use this only if attached to a UNIQUE JO': refused on another unique, a plain character, or when unattached", () => {
  const hosts: [string, CardDefinition | undefined, boolean][] = [
    ["a UNIQUE that isn't JO", character({ name: "Not Jo", unique: "not jo" }), true],
    ["a non-unique character", character({ name: "Jo Ciendeilio" }), true],
    ["nothing (unattached)", undefined, false]
  ];
  for (const [label, hostDef, attach] of hosts) {
    const { engine, id } = fusionBoard({ hostDef, attach });
    refused(() => activate(engine, P1, id("ds"), "draconic-suit-seraphim-fusion", { selected: { td: [id("ta")] } }), `attached to ${label}`);
    assert.equal(zoneOf(engine, id("ds")), "play", "suit not destroyed");
    assert.equal(zoneOf(engine, id("ta")), "deck", "nothing fetched");
    assert.equal(ready(engine), 5, "nothing paid");
  }
  const jo = fusionBoard({ hostDef: character({ name: "Jo Clone", unique: "jo" }) });
  activate(jo.engine, P1, jo.id("ds"), "draconic-suit-seraphim-fusion", { selected: { td: [jo.id("ta")] } });
  assert.equal(zoneOf(jo.engine, jo.id("ta")), "play", "positive control: any UNIQUE JO works");
});

clause(DS, "3:ability:draconic-suit-seraphim-fusion", "unaffordable: refused with 2 resources", () => {
  const poor = fusionBoard({ res: 2 });
  refused(() => activate(poor.engine, P1, poor.id("ds"), "draconic-suit-seraphim-fusion", { selected: { td: [poor.id("ta")] } }), "pay 3 with 2");
  assert.equal(zoneOf(poor.engine, poor.id("ds")), "play");
  assert.equal(zoneOf(poor.engine, poor.id("ta")), "deck");
  const ok = fusionBoard({ res: 3 });
  activate(ok.engine, P1, ok.id("ds"), "draconic-suit-seraphim-fusion", { selected: { td: [ok.id("ta")] } });
  assert.equal(zoneOf(ok.engine, ok.id("ta")), "play");
  assert.equal(ready(ok.engine), 0);
});

clause(DS, "3:ability:draconic-suit-seraphim-fusion", "only a card NAMED Testudine Autoframe, from your deck, can be fetched (exactly one)", () => {
  const { engine, id } = fusionBoard({
    extra: [
      { key: "mk2", def: character({ name: "Testudine Autoframe Mk2" }), owner: P1, zone: "deck" },
      { key: "short", def: character({ name: "Autoframe" }), owner: P1, zone: "deck" },
      { key: "oppTa", def: character({ name: "Testudine Autoframe" }), owner: P2, zone: "deck" },
      { key: "handTa", def: character({ name: "Testudine Autoframe" }), owner: P1, zone: "hand" },
      { key: "discTa", def: character({ name: "Testudine Autoframe" }), owner: P1, zone: "discard" },
      { key: "ta2", def: character({ name: "Testudine Autoframe" }), owner: P1, zone: "deck" }
    ]
  });
  for (const key of ["f0", "mk2", "short", "oppTa", "handTa", "discTa"]) {
    refused(() => activate(engine, P1, id("ds"), "draconic-suit-seraphim-fusion", { selected: { td: [id(key)] } }), `${key} is not a Testudine Autoframe in your deck: the search target is illegal`, /Illegal target/);
    assert.equal(zoneOf(engine, id("ds")), "play", "nothing was paid or destroyed");
    assert.equal(ready(engine), 5);
  }
  refused(() => activate(engine, P1, id("ds"), "draconic-suit-seraphim-fusion", { selected: { td: [id("ta"), id("ta2")] } }), "only one card");
  activate(engine, P1, id("ds"), "draconic-suit-seraphim-fusion", { selected: { td: [id("ta")] } });
  assert.equal(zoneOf(engine, id("ta")), "play");
  assert.equal(zoneOf(engine, id("ta2")), "deck", "just the one");
  assert.equal(zoneOf(engine, id("oppTa")), "deck");
});

clause(DS, "3:ability:draconic-suit-seraphim-fusion", "the search can be failed (no pick): the cost is still paid, the suit still destroyed, the deck is shuffled", () => {
  const { engine, id } = fusionBoard();
  const deckBefore = [...deckOf(engine, P1)];
  activate(engine, P1, id("ds"), "draconic-suit-seraphim-fusion", { selected: { td: [] } });
  assert.equal(pending(engine), undefined);
  assert.equal(ready(engine), 2, "paid 3");
  assert.equal(zoneOf(engine, id("ds")), "discard");
  assert.equal(zoneOf(engine, id("ta")), "deck", "nothing put into play");
  assert.equal(sorted(deckOf(engine, P1)).join(), sorted(deckBefore).join(), "same cards");
  assert.notEqual(deckOf(engine, P1).join(), deckBefore.join(), "shuffled after the search");
});

clause(DS, "3:ability:draconic-suit-seraphim-fusion", "a deck with no Testudine Autoframe: the cost is paid and nothing happens (deck shuffled)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    random: lcg(5),
    cards: [
      { key: "host", def: printing(JO), owner: P1, zone: "play" },
      { key: "ds", def: printing(DS), owner: P1, zone: "play", attachedToKey: "host" },
      ...Array.from({ length: 6 }, (_, i) => ({ key: `f${i}`, def: character({ name: `F${i}` }), owner: P1, zone: "deck" as const })),
      ...bank("elitism", 3, P1)
    ]
  });
  const deckBefore = [...deckOf(engine, P1)];
  activate(engine, P1, id("ds"), "draconic-suit-seraphim-fusion", { selected: { td: [] } });
  assert.equal(pending(engine), undefined);
  assert.equal(ready(engine), 0);
  assert.equal(zoneOf(engine, id("ds")), "discard");
  assert.equal(sorted(deckOf(engine, P1)).join(), sorted(deckBefore).join());
  assert.notEqual(deckOf(engine, P1).join(), deckBefore.join(), "shuffled");
});

clause(DS, "2:rule", "'played' only: a gear card put into play by an effect (Seraphim Fusion) offers no draw", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "hostB", def: host("HostB"), owner: P2, zone: "play" },
      { key: "oppDs", def: printing(DS), owner: P2, zone: "play", attachedToKey: "hostB" },
      { key: "jo", def: printing(JO), owner: P1, zone: "play" },
      { key: "ds", def: printing(DS), owner: P1, zone: "play", attachedToKey: "jo" },
      { key: "ta", def: character({ name: "Testudine Autoframe", subtype: ["gear"] }), owner: P1, zone: "deck" },
      { key: "d0", def: character({ name: "D0" }), owner: P2, zone: "deck" },
      ...bank("elitism", 3, P1)
    ]
  });
  activate(engine, P1, id("ds"), "draconic-suit-seraphim-fusion", { selected: { td: [id("ta")] } });
  assert.equal(zoneOf(engine, id("ta")), "play", "the gear card entered play");
  assert.equal(pending(engine), undefined, "put into play is not played: no draw offer for the other suit");
  assert.equal(handOf(engine, P2).length, 0);
});

clause(DS, "4:ability:draconic-suit-equip", "deploys for its cost 4 as an ordinary unattached item (it has no printed ATTACH TO; EQUIP attaches it later)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "host", def: host(), owner: P1, zone: "play" },
      { key: "ds", def: printing(DS), owner: P1, zone: "hand" },
      ...bank("elitism", 4, P1)
    ]
  });
  play(engine, P1, id("ds"), {});
  assert.equal(zoneOf(engine, id("ds")), "play", "deployed with no host chosen");
  assert.equal(engine.state.cards[id("ds")].attachedTo, undefined, "it enters unattached");
  assert.equal(ready(engine), 0, "cost 4 paid");
  assert.equal(engine.getStat(id("host"), "strength"), 1, "no bonus until EQUIP attaches it");
});

clause(DS, "3:ability:draconic-suit-seraphim-fusion", "the real Testudine Autoframe printing can be fetched into play", () => {
  const { engine, id } = fusionBoard({
    extra: [{ key: "real", def: printing(AUTOFRAME), owner: P1, zone: "deck" }]
  });
  activate(engine, P1, id("ds"), "draconic-suit-seraphim-fusion", { selected: { td: [id("real")] } });
  drain(engine, (pc) => (pc.kind === "mayPay" ? { kind: "mayPay", pay: false } : declineAll(pc)));
  assert.equal(zoneOf(engine, id("real")), "play");
  assert.equal(zoneOf(engine, id("ds")), "discard");
  assert.equal(zoneOf(engine, id("host")), "play", "Jo stays unless the Autoframe's own optional text is accepted");
});

const equipBoard = (res: number, extra: CardPlacement[] = []) =>
  buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ds", def: printing(DS), owner: P1, zone: "play" },
      { key: "ch", def: host("Ch"), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other Unique", unique: "other unique", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "jo", def: printing(JO), owner: P1, zone: "play" },
      { key: "oppCh", def: host("OppCh"), owner: P2, zone: "play" },
      { key: "fakeJo", def: character({ name: "Jo Ciendeilio", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      ...bank("elitism", res, P1),
      ...extra
    ]
  });
const equipTo = (e: ReturnType<typeof equipBoard>, key: string) =>
  activate(e.engine, P1, e.id("ds"), "draconic-suit-equip", { selected: { ch: [e.id(key)] } });

clause(DS, "4:ability:draconic-suit-equip", "a non-JO character: pay 2, then attach (it gains +2/+2)", () => {
  for (const key of ["ch", "other", "oppCh", "fakeJo"]) {
    const e = equipBoard(5);
    equipTo(e, key);
    assert.equal(ready(e.engine), 3, `${key}: pay X = 2`);
    assert.equal(e.engine.state.cards[e.id("ds")].attachedTo, e.id(key), `${key}: attached`);
    assert.equal(e.engine.getStat(e.id(key), "strength"), 3);
    assert.equal(e.engine.getStat(e.id(key), "life"), 5);
    assert.equal(zoneOf(e.engine, e.id("ds")), "play");
  }
});

clause(DS, "4:ability:draconic-suit-equip", "a UNIQUE JO: X is 0, so it's free (even with no resources)", () => {
  const e = equipBoard(0);
  assert.equal(ready(e.engine), 0);
  equipTo(e, "jo");
  assert.equal(e.engine.state.cards[e.id("ds")].attachedTo, e.id("jo"));
  assert.equal(e.engine.getStat(e.id("jo"), "strength"), 3, "Jo's printed 1 + 2");
  assert.equal(e.engine.getStat(e.id("jo"), "life"), 3, "Jo's printed 1 + 2");
  const paid = equipBoard(5);
  equipTo(paid, "jo");
  assert.equal(ready(paid.engine), 5, "nothing paid with resources available either");
});

clause(DS, "4:ability:draconic-suit-equip", "unaffordable: a non-JO needs 2 ready (refused with 1; accepted with 2)", () => {
  const poor = equipBoard(1);
  refused(() => equipTo(poor, "ch"), "pay 2 with 1");
  assert.equal(poor.engine.state.cards[poor.id("ds")].attachedTo, undefined, "not attached");
  assert.equal(ready(poor.engine), 1, "nothing paid");
  const ok = equipBoard(2);
  equipTo(ok, "ch");
  assert.equal(ok.engine.state.cards[ok.id("ds")].attachedTo, ok.id("ch"));
  assert.equal(ready(ok.engine), 0);
});

clause(DS, "4:ability:draconic-suit-equip", "only a character in play can be picked", () => {
  const e = equipBoard(5, [
    { key: "it", def: item({ name: "AnItem" }), owner: P1, zone: "play" },
    { key: "loc", def: location({ name: "ALoc" }), owner: P1, zone: "play" },
    { key: "handCh", def: host("HandCh"), owner: P1, zone: "hand" },
    { key: "discCh", def: host("DiscCh"), owner: P1, zone: "discard" },
    { key: "deckCh", def: host("DeckCh"), owner: P1, zone: "deck" },
    { key: "fdCh", def: host("FaceDown"), owner: P1, zone: "play", faceDown: true }
  ]);
  const readyBefore = ready(e.engine); // 5 elitism + the face-down card's Volition
  for (const key of ["it", "loc", "handCh", "discCh", "deckCh", "fdCh"]) {
    refused(() => equipTo(e, key), `${key} is not a character in play`);
    assert.equal(e.engine.state.cards[e.id("ds")].attachedTo, undefined);
    assert.equal(ready(e.engine), readyBefore, "nothing paid");
  }
  equipTo(e, "ch");
  assert.equal(e.engine.state.cards[e.id("ds")].attachedTo, e.id("ch"), "positive control");
});

clause(DS, "4:ability:draconic-suit-equip", "equipping while attached moves it: the old host loses the bonus, the new one gains it", () => {
  const e = equipBoard(5);
  equipTo(e, "ch");
  assert.equal(e.engine.getStat(e.id("ch"), "strength"), 3);
  equipTo(e, "other");
  assert.equal(e.engine.state.cards[e.id("ds")].attachedTo, e.id("other"), "re-attached");
  assert.equal(ready(e.engine), 1, "paid 2 + 2");
  assert.equal(e.engine.getStat(e.id("ch"), "strength"), 1, "the old host loses +2");
  assert.equal(e.engine.getStat(e.id("ch"), "life"), 3);
  assert.equal(e.engine.getStat(e.id("other"), "strength"), 3, "the new host gains +2");
  assert.equal(e.engine.getStat(e.id("other"), "life"), 5);
});

// ============================================================================
// Elitistmajig — cost 3 · threshold e · str 2 / spd 3 / life 2
// ============================================================================
const EM = "3a4918d7-7c70-4753-b070-0c6dd8799811";
const MICROMAJIG_CARD = "60e8c57d-7aca-47ca-8f9c-501f2c924ead"; // Holy Heist "Micromajig" printing: an ordinary character card, not a token

/** Elitistmajig in play; `tokens` lists tactics (in hand) that spawn tokens; `res` elitism resources. */
function emBoard(o: { res?: number; resIcon?: "elitism" | "rage"; extra?: CardPlacement[]; hand?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "em", def: printing(EM), owner: P1, zone: "play" },
      { key: "mkTwo", def: makeTokens(2, "controller"), owner: P1, zone: "hand" },
      { key: "mkFoe", def: makeTokens(1, "opponent"), owner: P1, zone: "hand" },
      { key: "mkOdd", def: makeTokens(1, "controller", "Gearmajig"), owner: P1, zone: "hand" },
      ...bank(o.resIcon ?? "elitism", o.res ?? 0, P1),
      ...(o.extra ?? []),
      ...(o.hand ?? [])
    ]
  });
}
const spawn = (e: ReturnType<typeof emBoard>, key: string) => play(e.engine, P1, e.id(key), {});

clause(EM, "0:ability:em-crunch", "deploys for cost 3 with threshold e, as a 2/3/2", () => {
  const board = (res: number, icon: "elitism" | "rage") =>
    buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "em", def: printing(EM), owner: P1, zone: "hand" }, ...bank(icon, res, P1)] });
  const short = board(2, "elitism");
  refused(() => play(short.engine, P1, short.id("em"), {}), "cost 3 with 2 resources");
  const noIcon = board(3, "rage");
  refused(() => play(noIcon.engine, P1, noIcon.id("em"), {}), "threshold e needs an elitism icon");
  const { engine, id } = board(3, "elitism");
  play(engine, P1, id("em"), {});
  assert.equal(zoneOf(engine, id("em")), "play");
  assert.equal(ready(engine), 0);
  assert.deepEqual(
    [engine.getStat(id("em"), "strength"), engine.getStat(id("em"), "speed"), engine.getStat(id("em"), "life")],
    [2, 3, 2]
  );
});

clause(EM, "0:ability:em-crunch", "COST destroy a Micromajig token you control; EFFECT this card provides EEE this turn (needs no resources)", () => {
  const e = emBoard();
  spawn(e, "mkTwo");
  const toks = tokensOfPlayer(e.engine, P1);
  assert.equal(toks.length, 2);
  assert.equal(elit(e.engine), 0);
  activate(e.engine, P1, e.id("em"), "em-crunch", { selected: { tok: [toks[0]] } });
  assert.equal(pending(e.engine), undefined);
  assert.deepEqual(tokensOfPlayer(e.engine, P1), [toks[1]], "exactly the picked token is destroyed");
  assert.equal(elit(e.engine), 3, "+3 elitism icons");
  assert.equal(zoneOf(e.engine, e.id("em")), "play");
});

clause(EM, "0:ability:em-crunch", "used twice in one turn (two tokens), each use grants [E][E][E] again (literal reading): +6 [E]", () => {
  const e = emBoard();
  spawn(e, "mkTwo");
  const toks = tokensOfPlayer(e.engine, P1);
  assert.equal(toks.length, 2);
  activate(e.engine, P1, e.id("em"), "em-crunch", { selected: { tok: [toks[0]] } });
  assert.equal(elit(e.engine), 3, "first use: +3");
  activate(e.engine, P1, e.id("em"), "em-crunch", { selected: { tok: [toks[1]] } });
  assert.equal(pending(e.engine), undefined);
  assert.deepEqual(tokensOfPlayer(e.engine, P1), [], "both tokens destroyed");
  assert.equal(elit(e.engine), 6, "second use grants its own [E][E][E]");
});

clause(EM, "0:ability:em-crunch", "the PROVIDES lasts this turn only", () => {
  const e = emBoard({ res: 1 });
  spawn(e, "mkTwo");
  const toks = tokensOfPlayer(e.engine, P1);
  assert.equal(elit(e.engine), 1);
  activate(e.engine, P1, e.id("em"), "em-crunch", { selected: { tok: [toks[0]] } });
  assert.equal(elit(e.engine), 4, "this turn: 1 + 3");
  endTurn(e.engine, P1);
  assert.equal(elit(e.engine), 1, "gone once the turn ends (P2's turn)");
  endTurn(e.engine, P2);
  assert.equal(elit(e.engine), 1, "and it doesn't come back on P1's next turn");
});

clause(EM, "0:ability:em-crunch", "the icons really count toward thresholds: an eee card is playable only after Crunch", () => {
  const e = emBoard({
    res: 0,
    extra: [...bank("rage", 1, P1)],
    hand: [{ key: "needs", def: character({ name: "NeedsEEE", cost: 1, threshold: "eee" }), owner: P1, zone: "hand" }]
  });
  spawn(e, "mkTwo");
  refused(() => play(e.engine, P1, e.id("needs"), {}), "no elitism icons yet");
  activate(e.engine, P1, e.id("em"), "em-crunch", { selected: { tok: [tokensOfPlayer(e.engine, P1)[0]] } });
  play(e.engine, P1, e.id("needs"), {});
  assert.equal(zoneOf(e.engine, e.id("needs")), "play", "playable with the 3 provided icons");
});

clause(EM, "0:ability:em-crunch", "only a Micromajig TOKEN you control: the opponent's token, a differently-named token, a non-token Micromajig and a card in hand are refused", () => {
  const e = emBoard({
    extra: [
      { key: "handMajig", def: character({ name: "Micromajig" }), owner: P1, zone: "hand" },
      { key: "discMajig", def: character({ name: "Micromajig" }), owner: P1, zone: "discard" }
    ]
  });
  spawn(e, "mkFoe");
  spawn(e, "mkOdd");
  const foeTok = tokensOfPlayer(e.engine, P2)[0];
  const oddTok = tokensOfPlayer(e.engine, P1)[0];
  assert.ok(foeTok && oddTok, "foeTok && oddTok");
  const attempt = (card: string) => activate(e.engine, P1, e.id("em"), "em-crunch", { selected: { tok: [card] } });
  refused(() => attempt(foeTok), "the opponent's Micromajig token");
  refused(() => attempt(oddTok), "a token that isn't a Micromajig");
  refused(() => attempt(e.id("handMajig")), "a Micromajig in hand");
  refused(() => attempt(e.id("discMajig")), "a Micromajig in the discard pile");
  refused(() => attempt(e.id("em")), "Elitistmajig itself");
  assert.equal(elit(e.engine), 0, "nothing was granted");
  assert.equal(tokensOfPlayer(e.engine, P1).length, 1);
  assert.equal(tokensOfPlayer(e.engine, P2).length, 1);
});

clause(EM, "0:ability:em-crunch", "a card named Micromajig that is not a token can't be destroyed to pay for Crunch", () => {
  const e = emBoard({ extra: [{ key: "realMajig", def: printing(MICROMAJIG_CARD), owner: P1, zone: "play" }] });
  assert.equal(e.engine.state.cards[e.id("realMajig")].isToken ?? false, false, "setup: an ordinary card, not a token");
  refused(() => activate(e.engine, P1, e.id("em"), "em-crunch", { selected: { tok: [e.id("realMajig")] } }), "a non-token card named Micromajig");
  assert.equal(zoneOf(e.engine, e.id("realMajig")), "play", "the non-token card was not destroyed");
  assert.equal(elit(e.engine), 0, "no PROVIDES was granted");
});

clause(EM, "0:ability:em-crunch", "without a Micromajig token the ability can't be used (positive control with one)", () => {
  const e = emBoard();
  refused(() => activate(e.engine, P1, e.id("em"), "em-crunch", {}), "no token to destroy");
  assert.equal(elit(e.engine), 0);
  spawn(e, "mkTwo");
  activate(e.engine, P1, e.id("em"), "em-crunch", { selected: { tok: [tokensOfPlayer(e.engine, P1)[0]] } });
  assert.equal(elit(e.engine), 3);
});

clause(EM, "0:ability:em-crunch", "'this card' gains PROVIDES: another Elitistmajig that didn't use Crunch provides nothing", () => {
  const e = emBoard({ extra: [{ key: "em2", def: printing(EM), owner: P1, zone: "play" }] });
  spawn(e, "mkTwo");
  activate(e.engine, P1, e.id("em"), "em-crunch", { selected: { tok: [tokensOfPlayer(e.engine, P1)[0]] } });
  assert.equal(elit(e.engine), 3, "only one card provides EEE");
});

const SIX = "[E][E][E][E][E][E] threshold";
clause(EM, "1:rule@eeeeee", `${SIX}: with six elitism icons it gains 2 strength and 2 life (4/3/4)`, () => {
  const e = emBoard({ res: 6 });
  assert.equal(e.engine.getStat(e.id("em"), "strength"), 4);
  assert.equal(e.engine.getStat(e.id("em"), "life"), 4);
  assert.equal(e.engine.getStat(e.id("em"), "speed"), 3, "speed is untouched");
});

clause(EM, "1:rule@eeeeee", `${SIX}: not with five icons, nor with a sixth resource of another icon`, () => {
  const five = emBoard({ res: 5 });
  assert.equal(five.engine.getStat(five.id("em"), "strength"), 2);
  assert.equal(five.engine.getStat(five.id("em"), "life"), 2);
  const mixed = emBoard({ res: 5, extra: bank("rage", 1, P1) });
  assert.equal(mixed.engine.getStat(mixed.id("em"), "strength"), 2);
  assert.equal(mixed.engine.getStat(mixed.id("em"), "life"), 2);
  const none = emBoard({ res: 0 });
  assert.equal(none.engine.getStat(none.id("em"), "strength"), 2);
});

clause(EM, "1:rule@eeeeee", `${SIX}: face-down (Volition) cards and the opponent's resources don't count`, () => {
  const fd = emBoard({ res: 3, extra: volition(3, P1) });
  assert.equal(fd.engine.getStat(fd.id("em"), "strength"), 2, "3 elitism + 3 face-down is not six elitism");
  const foe = emBoard({ res: 0, extra: bank("elitism", 6, P2) });
  assert.equal(foe.engine.getStat(foe.id("em"), "strength"), 2, "the opponent's icons are not mine");
  assert.equal(foe.engine.getStat(foe.id("em"), "life"), 2);
  const mixed = emBoard({ res: 6, extra: volition(3, P1) });
  assert.equal(mixed.engine.getStat(mixed.id("em"), "strength"), 4, "positive control: six elitism plus face-down cards");
});

clause(EM, "1:rule@eeeeee", `${SIX}: only this card is buffed, and the buff does not stack on re-reads or across turns`, () => {
  const e = emBoard({ res: 6, extra: [{ key: "bystander", def: character({ name: "By", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" }] });
  assert.equal(e.engine.getStat(e.id("bystander"), "strength"), 1, "other characters are not buffed");
  assert.equal(e.engine.getStat(e.id("bystander"), "life"), 3);
  for (let i = 0; i < 3; i++) assert.equal(e.engine.getStat(e.id("em"), "strength"), 4, `read ${i}`);
  endTurn(e.engine, P1);
  endTurn(e.engine, P2);
  assert.equal(e.engine.getStat(e.id("em"), "strength"), 4, "still +2 after a full turn cycle");
  assert.equal(e.engine.getStat(e.id("em"), "life"), 4);
});

clause(EM, "1:rule@eeeeee", `${SIX}: icons provided by Crunch count, and the buff turns off again when they expire`, () => {
  const e = emBoard({ res: 3 });
  spawn(e, "mkTwo");
  assert.equal(e.engine.getStat(e.id("em"), "strength"), 2, "3 icons: off");
  activate(e.engine, P1, e.id("em"), "em-crunch", { selected: { tok: [tokensOfPlayer(e.engine, P1)[0]] } });
  assert.equal(elit(e.engine), 6);
  assert.equal(e.engine.getStat(e.id("em"), "strength"), 4, "3 resources + 3 provided = 6: on");
  assert.equal(e.engine.getStat(e.id("em"), "life"), 4);
  endTurn(e.engine, P1);
  assert.equal(e.engine.getStat(e.id("em"), "strength"), 2, "provided icons expired: off");
  assert.equal(e.engine.getStat(e.id("em"), "life"), 2);
  endTurn(e.engine, P2);
  assert.equal(e.engine.getStat(e.id("em"), "strength"), 2, "and still off");
});

clause(EM, "1:rule@eeeeee", `${SIX}: 2 resources + Crunch is only five icons, so no buff`, () => {
  const e = emBoard({ res: 2 });
  spawn(e, "mkTwo");
  activate(e.engine, P1, e.id("em"), "em-crunch", { selected: { tok: [tokensOfPlayer(e.engine, P1)[0]] } });
  assert.equal(elit(e.engine), 5);
  assert.equal(e.engine.getStat(e.id("em"), "strength"), 2);
  assert.equal(e.engine.getStat(e.id("em"), "life"), 2);
});

// ============================================================================
// EPM (Extra Powerful Magnetic) Pulse — tactic · cost 6 · threshold ee
// ============================================================================
const EPM = "53deaf6c-15e8-4ef6-b593-85745e2e61e8";

function epmBoard(res = 6, icon: "elitism" | "rage" = "elitism", faceDown = true) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "epm", def: printing(EPM), owner: P1, zone: "hand" },
      { key: "chP1", def: character({ name: "ChP1", strength: 2, life: 3 }), owner: P1, zone: "play" },
      { key: "chP2", def: character({ name: "ChP2", strength: 2, life: 3 }), owner: P2, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "theirItem", def: item({ name: "TheirItem" }), owner: P2, zone: "play" },
      { key: "attItem", def: item({ name: "AttItem" }), owner: P1, zone: "play", attachedToKey: "chP1" },
      { key: "myLoc", def: location({ name: "MyLoc" }), owner: P1, zone: "play" },
      { key: "theirLoc", def: location({ name: "TheirLoc" }), owner: P2, zone: "play" },
      { key: "swapLoc", def: location({ name: "SwapLoc" }), owner: P1, controller: P2, zone: "play" },
      ...(faceDown ? [{ key: "fdItem", def: item({ name: "FaceDownItem" }), owner: P1, zone: "play" as const, faceDown: true }] : []),
      { key: "handItem", def: item({ name: "HandItem" }), owner: P1, zone: "hand" },
      { key: "deckItem", def: item({ name: "DeckItem" }), owner: P2, zone: "deck" },
      { key: "deckLoc", def: location({ name: "DeckLoc" }), owner: P1, zone: "deck" },
      { key: "discItem", def: item({ name: "DiscItem" }), owner: P2, zone: "discard" },
      ...bank(icon, res, P1)
    ]
  });
}

clause(EPM, "0:rule", "costs 6 with threshold ee: refused with 5 resources, or 6 without elitism icons", () => {
  const short = epmBoard(5, "elitism", false);
  refused(() => play(short.engine, P1, short.id("epm"), {}), "cost 6 with only 5 resources");
  assert.equal(zoneOf(short.engine, short.id("myItem")), "play", "nothing was destroyed");
  const noIcon = epmBoard(6, "rage", false);
  refused(() => play(noIcon.engine, P1, noIcon.id("epm"), {}), "threshold ee needs elitism icons");
  assert.equal(zoneOf(noIcon.engine, noIcon.id("myItem")), "play");
  const oneIcon = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "epm", def: printing(EPM), owner: P1, zone: "hand" },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      ...bank("elitism", 1, P1),
      ...bank("rage", 5, P1)
    ]
  });
  refused(() => play(oneIcon.engine, P1, oneIcon.id("epm"), {}), "only one of the two elitism icons required");
  assert.equal(zoneOf(oneIcon.engine, oneIcon.id("myItem")), "play");
  const { engine, id } = epmBoard(6, "elitism", false);
  play(engine, P1, id("epm"), {});
  assert.equal(ready(engine), 0, "cost 6 paid");
  assert.equal(zoneOf(engine, id("myItem")), "discard", "positive control");
});

clause(EPM, "0:rule", "destroys all items and locations in play, both players', into their owners' discard piles", () => {
  const { engine, id } = epmBoard();
  play(engine, P1, id("epm"), {});
  assert.equal(pending(engine), undefined);
  for (const key of ["myItem", "theirItem", "attItem", "myLoc", "theirLoc", "swapLoc"]) {
    assert.equal(zoneOf(engine, id(key)), "discard", `${key} destroyed`);
  }
  for (const key of ["myItem", "attItem", "myLoc", "swapLoc"]) assert.ok(discardOf(engine, P1).includes(id(key)), `${key} in P1's discard (owner)`);
  for (const key of ["theirItem", "theirLoc"]) assert.ok(discardOf(engine, P2).includes(id(key)), `${key} in P2's discard (owner)`);
});

clause(EPM, "0:rule", "only items and locations: characters (and the host of a destroyed item), factions, face-down cards and other zones are untouched", () => {
  const { engine, id } = epmBoard();
  play(engine, P1, id("epm"), {});
  assert.equal(zoneOf(engine, id("chP1")), "play", "the host survives");
  assert.equal(zoneOf(engine, id("chP2")), "play");
  assert.equal(engine.state.cards[id("chP1")].damage, 0);
  assert.equal(zoneOf(engine, id("fdItem")), "play", "a face-down card is a resource, not an item");
  assert.equal(engine.state.cards[id("fdItem")].faceDown, true);
  assert.equal(zoneOf(engine, engine.state.players[P1].factionId!), "play", "factions stay");
  assert.equal(zoneOf(engine, engine.state.players[P2].factionId!), "play");
  assert.equal(zoneOf(engine, id("handItem")), "hand");
  assert.equal(zoneOf(engine, id("deckItem")), "deck");
  assert.equal(zoneOf(engine, id("deckLoc")), "deck");
  assert.equal(zoneOf(engine, id("discItem")), "discard");
  assert.equal(zoneOf(engine, id("epm")), "discard", "the tactic is spent");
  assert.equal(engine.getStat(id("chP1"), "strength"), 2);
});
