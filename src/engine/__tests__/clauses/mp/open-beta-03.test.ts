// Multiplayer clause tests: Open Beta (the cards whose logic is shared with other groups). Each test is written from the card's PRINTED text and the spec in
// data/card-tests/mp-spec/open-beta.json (its `test3` / `test4` line): a real 3- or 4-seat game, real actions through
// `perform`, asserting that the chosen / affected opponent IS affected and the other opponents are NOT.

import assert from "node:assert/strict";
import { autoResolveBattle, character, developFaction, item, resourceCard, tactic } from "../../per-card/_harness.js";
import { clause, clauseMismatch, printing, refused } from "../_clause.js";
import { developPlay } from "../_turn.js";
import {
  activate,
  choices,
  expectNotAsked,
  expectOpponentAsked,
  offeredCards,
  opponentsAt,
  answer,
  bank,
  candidatesOf,
  deckOf,
  discardOf,
  drive,
  eliminate,
  fill,
  handOf,
  influenceOf,
  P1,
  P2,
  P3,
  P4,
  passAround,
  pendingOf,
  pickIds,
  playCard,
  playerRequirement,
  ready,
  resolvePendingResponses,
  seatsFor,
  seatTable,
  zoneOf,
  type CardPlacement
} from "./_mpSeats.js";

const MOLESTATION = "f77f9b48-ebfb-4f8f-a32d-46a0309da781";

// --- Degenerate Molestation ----------------------------------------------------------------
// 0: Your opponent cannot respond to this card.
// 1: Your opponent must discard a card. You may play a non-resource card with numeric cost X or less for free, where X is
//    the numeric cost of the discarded card.
// 2: Repeat this until your opponent has no cards in their hand.

function molestation(count: number, hands: { p1?: ReturnType<typeof character>[]; p2?: ReturnType<typeof character>[]; p3?: ReturnType<typeof character>[]; p4?: ReturnType<typeof character>[] }) {
  const owners = [P1, P2, P3, P4] as const;
  return seatTable(count, [
    { key: "dm", def: printing(MOLESTATION), owner: P1, zone: "hand" },
    ...bank("obsession", 12, P1),
    ...(["p1", "p2", "p3", "p4"] as const).flatMap((slot, i) => (hands[slot] ?? []).map((def, n) => ({ key: `${slot}h${n}`, def, owner: owners[i]!, zone: "hand" as const })))
  ]);
}
const cost = (n: number, name = `Cost ${n}`) => character({ name, cost: n });

clause(MOLESTATION, "0:rule", "3 seats: the chosen opponent gets no response window, the other opponent does and resolves after passing", () => {
  for (const [chosen, other] of [[P2, P3], [P3, P2]] as const) {
    const t = molestation(3, { p2: [cost(2)], p3: [cost(2)] });
    assert.deepEqual(playerRequirement(t.engine, { type: "playCard", playerId: P1, cardId: t.id("dm") })?.[0], { id: "opponent", candidates: [P2, P3] });
    playCard(t.engine, P1, t.id("dm"), { players: { opponent: chosen } });
    const window = t.engine.state.responseWindow;
    assert.ok(window, "the card waits on the stack for the other opponent");
    assert.equal(window.priorityPlayerId, other, `${other} is offered the window first`);
    const passers = passAround(t.engine);
    assert.deepEqual(passers, [other], `only ${other} is ever offered a response; ${chosen} never is`);
    assert.equal(pendingOf(t.engine)?.playerId, chosen, "the card then resolves: the chosen opponent must discard");
  }
});

clause(MOLESTATION, "0:rule", "3 seats: the other opponent may respond with a tactic, which resolves before Degenerate Molestation", () => {
  const counter = tactic({ name: "Counter", cost: 0, behavior: { abilities: [{ id: "c", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });
  const t = seatTable(3, [
    { key: "dm", def: printing(MOLESTATION), owner: P1, zone: "hand" },
    ...bank("obsession", 12, P1),
    { key: "p2h0", def: cost(2), owner: P2, zone: "hand" },
    { key: "c2", def: counter, owner: P2, zone: "hand" },
    { key: "c3", def: counter, owner: P3, zone: "hand" },
    ...fill("d3", 2, P3, "deck")
  ]);
  playCard(t.engine, P1, t.id("dm"), { players: { opponent: P2 } });
  refused(() => playCard(t.engine, P2, t.id("c2")), "the chosen opponent cannot respond", /priority/);
  const before = handOf(t.engine, P3).length;
  playCard(t.engine, P3, t.id("c3"));
  passAround(t.engine);
  assert.equal(handOf(t.engine, P3).length, before, "Counter left the hand and drew a card");
  assert.equal(zoneOf(t.engine, t.id("c3")), "discard", "the tactic resolved");
  assert.equal(pendingOf(t.engine)?.playerId, P2, "then Degenerate Molestation resolved: P2 must discard");
});

clause(MOLESTATION, "0:rule", "3 seats: the controller is never a responder, and with the other opponent eliminated nobody can respond", () => {
  const t = molestation(3, { p2: [cost(2)], p3: [cost(2)] });
  eliminate(t.engine, P3);
  assert.deepEqual(playerRequirement(t.engine, { type: "playCard", playerId: P1, cardId: t.id("dm") }), undefined, "one opponent left: nobody is asked");
  playCard(t.engine, P1, t.id("dm"));
  assert.equal(t.engine.state.responseWindow, undefined, "no response window opens at all");
  assert.equal(pendingOf(t.engine)?.playerId, P2, "P2 is the bound opponent and discards");
});

/** What the open "play for free" prompt offers P1, as card ids. */
function freePlayOffer(engine: Parameters<typeof pendingOf>[0], who = P1): string[] {
  const pc = pendingOf(engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc?.kind, "deployForFree", "the controller is asked whether to play a card for free");
  assert.equal(pc.playerId, who);
  return pc.candidates;
}

clause(MOLESTATION, "1:rule", "3 seats: only the chosen opponent discards (from their own hand, P3's untouched), then the free play is limited by that card's cost", () => {
  for (const [chosen, other] of [[P2, P3], [P3, P2]] as const) {
    const t = seatTable(3, [
      { key: "dm", def: printing(MOLESTATION), owner: P1, zone: "hand" },
      ...bank("obsession", 12, P1),
      { key: "cheap", def: cost(1, "Cheap"), owner: P1, zone: "hand" },
      { key: "dear", def: cost(3, "Dear"), owner: P1, zone: "hand" },
      { key: "p2c", def: cost(2, "TwoCost"), owner: P2, zone: "hand" },
      { key: "p3c", def: cost(2, "TwoCostB"), owner: P3, zone: "hand" },
      { key: "p3d", def: cost(2, "TwoCostC"), owner: P3, zone: "hand" },
      { key: "p2d", def: cost(2, "TwoCostD"), owner: P2, zone: "hand" }
    ]);
    playCard(t.engine, P1, t.id("dm"), { players: { opponent: chosen } });
    passAround(t.engine);
    const pc = pendingOf(t.engine)!;
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, chosen, "the chosen opponent picks what they discard");
    const own = chosen === P2 ? ["p2c", "p2d"] : ["p3c", "p3d"];
    const theirs = chosen === P2 ? ["p3c", "p3d"] : ["p2c", "p2d"];
    refused(() => pickIds(t.engine, [t.id(theirs[0]!)]), "a card of the other opponent's hand");
    pickIds(t.engine, [t.id(own[0]!)], chosen);
    assert.equal(zoneOf(t.engine, t.id(own[0]!)), "discard");
    assert.ok(handOf(t.engine, other).length === 2 && theirs.every((k) => zoneOf(t.engine, t.id(k)) === "hand"), `${other}'s hand is untouched`);
    const offer = freePlayOffer(t.engine);
    assert.ok(offer.includes(t.id("cheap")), "cost 1 is within X = 2");
    assert.ok(!offer.includes(t.id("dear")), "cost 3 is above X = 2");
  }
});

clause(MOLESTATION, "1:rule", "3 seats: with the other opponent eliminated, the one opponent left is bound without asking and discards", () => {
  const t = seatTable(3, [
    { key: "dm", def: printing(MOLESTATION), owner: P1, zone: "hand" },
    ...bank("obsession", 12, P1),
    { key: "p2c", def: cost(2), owner: P2, zone: "hand" },
    { key: "p3c", def: cost(2, "Gone"), owner: P3, zone: "hand" }
  ]);
  eliminate(t.engine, P3);
  playCard(t.engine, P1, t.id("dm"));
  const pc = pendingOf(t.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2);
});

clause(MOLESTATION, "2:rule", "3 seats: the repeat runs until the chosen opponent's hand is empty, whatever the other opponent holds", () => {
  for (const [chosen, other, expected] of [[P2, P3, 3], [P3, P2, 4]] as const) {
    const t = seatTable(3, [
      { key: "dm", def: printing(MOLESTATION), owner: P1, zone: "hand" },
      ...bank("obsession", 12, P1),
      ...fill("p2h", 3, P2, "hand", (i) => cost(1, `Two${i}`)),
      ...fill("p3h", 4, P3, "hand", (i) => cost(1, `Three${i}`))
    ]);
    playCard(t.engine, P1, t.id("dm"), { players: { opponent: chosen } });
    passAround(t.engine);
    let discards = 0;
    for (let guard = 0; guard < 12 && pendingOf(t.engine); guard++) {
      const pc = pendingOf(t.engine)!;
      if (pc.kind === "chooserSelectsTarget") {
        assert.equal(pc.playerId, chosen);
        const next = handOf(t.engine, chosen)[0]!;
        pickIds(t.engine, [next]);
        discards++;
      } else if (pc.kind === "deployForFree") {
        t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree" } } as never);
      } else throw new Error(`unexpected prompt ${pc.kind}`);
      resolvePendingResponses(t.engine);
    }
    assert.equal(discards, expected, `${chosen} discarded until their hand was empty`);
    assert.equal(handOf(t.engine, chosen).length, 0);
    assert.equal(handOf(t.engine, other).length, chosen === P2 ? 4 : 3, `${other}'s hand is untouched`);
  }
});

clause(MOLESTATION, "2:rule", "3 seats: a chosen opponent with an empty hand discards nothing and nothing repeats", () => {
  const t = seatTable(3, [
    { key: "dm", def: printing(MOLESTATION), owner: P1, zone: "hand" },
    ...bank("obsession", 12, P1),
    ...fill("p3h", 2, P3, "hand")
  ]);
  playCard(t.engine, P1, t.id("dm"), { players: { opponent: P2 } });
  passAround(t.engine);
  assert.equal(pendingOf(t.engine), undefined, "nothing to discard");
  assert.equal(handOf(t.engine, P3).length, 2);
});

const others = (count: number, chosen: string) => [P2, P3, P4].slice(0, count - 1).filter((who) => who !== chosen);
const TABLES = [3, 4] as const;

// --- Arcana Experiment --------------------------------------------------------------------
// Your opponent picks X of those cards.

const EXPERIMENT = "6e63449c-4363-494b-b90a-db1147b4b9a1";

for (const count of TABLES) {
  clause(EXPERIMENT, "0:ability", `${count} seats: the chosen opponent (and only they) picks X of the 5 searched cards`, () => {
    for (const chosen of choices(count)) {
      const t = seatTable(count, [
        { key: "ae", def: printing(EXPERIMENT), owner: P1, zone: "hand" },
        ...bank("obsession", 12, P1),
        ...fill("m", 6, P1, "play"),
        ...fill("d", 8, P1, "deck"),
        ...opponentsAt(count).flatMap((who) => fill(`o${who}`, 2, who, "play"))
      ]);
      const action = { type: "playCard", playerId: P1, cardId: t.id("ae") };
      expectOpponentAsked(t, action);
      const found = ["d1", "d3", "d4", "d6", "d7"].map(t.id);
      playCard(t.engine, P1, t.id("ae"), { players: { opponent: chosen }, selected: { depleted: ["m0", "m1", "m2"].map(t.id) } });
      const asked = drive(t.engine, (pc) => {
        if (pc.kind !== "chooserSelectsTarget") return undefined;
        if (pc.declaration?.id === "found") return { selected: found };
        const offered = offeredCards(t.engine);
        assert.deepEqual([...offered].sort(), [...found].sort(), "the opponent picks among the 5 searched cards only");
        return { selected: found.slice(0, 3) };
      });
      assert.deepEqual(asked.map((a) => [a.playerId, a.decl]), [[P1, "found"], [chosen, "chosen"]], "nobody but the chosen opponent picks");
      for (const id of found.slice(0, 3)) assert.equal(zoneOf(t.engine, id), "hand");
      for (const id of found.slice(3)) assert.equal(zoneOf(t.engine, id), "discard");
      for (const who of others(count, chosen)) assert.ok(!asked.some((a) => a.playerId === who), `${who} is never asked`);
    }
  });
}

clause(EXPERIMENT, "0:ability", "3 seats: with one opponent left no choice is offered and that player picks", () => {
  const t = seatTable(3, [
    { key: "ae", def: printing(EXPERIMENT), owner: P1, zone: "hand" },
    ...bank("obsession", 12, P1),
    ...fill("m", 6, P1, "play"),
    ...fill("d", 8, P1, "deck"),
    ...fill("o3", 2, P3, "play")
  ]);
  eliminate(t.engine, P3);
  expectNotAsked(t, { type: "playCard", playerId: P1, cardId: t.id("ae") });
  playCard(t.engine, P1, t.id("ae"), { selected: { depleted: ["m0", "m1"].map(t.id) } });
  const asked = drive(t.engine, (pc) => {
    if (pc.kind !== "chooserSelectsTarget") return undefined;
    return { selected: pc.declaration?.id === "found" ? ["d0", "d1", "d2", "d3", "d4"].map(t.id) : ["d0", "d1"].map(t.id) };
  });
  assert.deepEqual(asked.map((a) => a.playerId), [P1, P2]);
});

// --- Ecto-Distillation ----------------------------------------------------------------------
// COST: Name a card. -- EFFECT: Your opponent must search your deck for all copies of the card. Put one in your hand and the rest in your discard pile.

const DISTILLATION = "37f34e7c-dbb2-4393-ad6a-bac2a3571ba9";

function distillationBoard(count: number) {
  return seatTable(count, [
    { key: "ed", def: printing(DISTILLATION), owner: P1, zone: "hand" },
    ...bank("obsession", 12, P1),
    ...fill("t", 3, P1, "deck", () => character({ id: "target-def", name: "Target" })),
    ...fill("x", 2, P1, "deck"),
    ...opponentsAt(count).flatMap((who) => fill(`o${who}`, 2, who, "deck", () => character({ id: "target-def", name: "Target" })))
  ]);
}

for (const count of TABLES) {
  clause(DISTILLATION, "0:ability", `${count} seats: only the chosen opponent searches the caster's deck: the copy they pick goes to the caster's hand, the rest to the caster's discard pile`, () => {
    for (const chosen of choices(count)) {
      const t = distillationBoard(count);
      expectOpponentAsked(t, { type: "playCard", playerId: P1, cardId: t.id("ed") });
      const theirDecks = Object.fromEntries(opponentsAt(count).map((who) => [who, [...deckOf(t.engine, who)]]));
      playCard(t.engine, P1, t.id("ed"), { players: { opponent: chosen } });
      const asked = drive(t.engine, (pc) => {
        if (pc.kind === "nameValue") {
          assert.equal(pc.playerId, P1, "the caster names the card");
          return { value: "Target" };
        }
        if (pc.kind !== "chooserSelectsTarget") return undefined;
        assert.equal(pc.playerId, chosen, "the chosen opponent searches");
        const offered = offeredCards(t.engine);
        assert.deepEqual([...offered].sort(), ["t0", "t1", "t2"].map(t.id).sort(), "the copies in the caster's deck only");
        return { selected: [t.id("t1")] };
      });
      assert.deepEqual(asked.filter((a) => a.kind === "chooserSelectsTarget").map((a) => a.playerId), [chosen]);
      assert.equal(zoneOf(t.engine, t.id("t1")), "hand", "the picked copy is in the caster's hand");
      assert.equal(zoneOf(t.engine, t.id("t0")), "discard");
      assert.equal(zoneOf(t.engine, t.id("t2")), "discard");
      for (const who of opponentsAt(count)) {
        assert.deepEqual(deckOf(t.engine, who), theirDecks[who], `${who}'s deck holds its copies still`);
        assert.equal(handOf(t.engine, who).length, 0);
      }
    }
  });
}

clause(DISTILLATION, "0:ability", "3 seats: with one opponent left no choice is offered and that opponent searches", () => {
  const t = distillationBoard(3);
  eliminate(t.engine, P3);
  expectNotAsked(t, { type: "playCard", playerId: P1, cardId: t.id("ed") });
  playCard(t.engine, P1, t.id("ed"));
  const asked = drive(t.engine, (pc) => {
    if (pc.kind === "nameValue") return { value: "Target" };
    return pc.kind === "chooserSelectsTarget" ? { selected: [t.id("t0")] } : undefined;
  });
  assert.deepEqual(asked.filter((a) => a.kind === "chooserSelectsTarget").map((a) => a.playerId), [P2]);
});

// --- Forget -----------------------------------------------------------------------------------
// Look at your opponent's hand and pick a card. Your opponent must discard that card.

const FORGET = "ea9b719e-c8ee-4911-9dfd-dd4ecfa842ce";

for (const count of TABLES) {
  clause(FORGET, "0:ability", `${count} seats: only the chosen opponent's hand is looked at and only their card is discarded`, () => {
    for (const chosen of choices(count)) {
      const t = seatTable(count, [
        { key: "fg", def: printing(FORGET), owner: P1, zone: "hand" },
        ...bank("obsession", 12, P1),
        { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
        ...opponentsAt(count).flatMap((who) => fill(`h${who}`, 2, who, "hand"))
      ]);
      expectOpponentAsked(t, { type: "playCard", playerId: P1, cardId: t.id("fg") });
      playCard(t.engine, P1, t.id("fg"), { players: { opponent: chosen }, selected: { bounced: [t.id("mine")] } });
      const theirs = [`h${chosen}0`, `h${chosen}1`].map(t.id);
      const asked = drive(t.engine, (pc) => {
        if (pc.kind !== "chooserSelectsTarget") return undefined;
        assert.deepEqual([...offeredCards(t.engine)].sort(), [...theirs].sort(), "the pick is among the chosen opponent's hand only");
        return { selected: [theirs[1]!] };
      });
      assert.deepEqual(asked.map((a) => a.playerId), [P1], "the caster picks the card");
      assert.equal(zoneOf(t.engine, theirs[1]!), "discard");
      assert.equal(zoneOf(t.engine, theirs[0]!), "hand");
      for (const who of others(count, chosen)) assert.equal(handOf(t.engine, who).length, 2, `${who}'s hand is untouched`);
    }
  });
}

clause(FORGET, "0:ability", "3 seats: with one opponent left no choice is offered and that player's hand is looked at", () => {
  const t = seatTable(3, [
    { key: "fg", def: printing(FORGET), owner: P1, zone: "hand" },
    ...bank("obsession", 12, P1),
    { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
    ...fill("h2", 2, P2, "hand"),
    ...fill("h3", 2, P3, "hand")
  ]);
  eliminate(t.engine, P3);
  expectNotAsked(t, { type: "playCard", playerId: P1, cardId: t.id("fg") });
  playCard(t.engine, P1, t.id("fg"), { selected: { bounced: [t.id("mine")] } });
  drive(t.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { selected: [t.id("h20")] } : undefined));
  assert.equal(zoneOf(t.engine, t.id("h20")), "discard");
});

// --- Ritual of the Shattering Teeth ---------------------------------------------------------
// Look at your opponent's hand and pick X or fewer cards. Your opponent must discard those cards.

const RITUAL = "a9d3f161-920e-4d8c-aa3d-9b1174f2fb6a";

for (const count of TABLES) {
  clause(RITUAL, "0:ability", `${count} seats: X or fewer cards of only the chosen opponent's hand are discarded`, () => {
    for (const chosen of choices(count)) {
      for (const pickCount of [2, 1]) {
        const t = seatTable(count, [
          { key: "rt", def: printing(RITUAL), owner: P1, zone: "hand" },
          ...bank("obsession", 12, P1),
          ...opponentsAt(count).flatMap((who) => fill(`h${who}`, 3, who, "hand"))
        ]);
        expectOpponentAsked(t, { type: "playCard", playerId: P1, cardId: t.id("rt") });
        const before = ready(t.engine, P1);
        playCard(t.engine, P1, t.id("rt"), { players: { opponent: chosen }, variables: { x: 2 } });
        assert.equal(before - ready(t.engine, P1), 4, "twice X is paid");
        const mine = [`h${chosen}0`, `h${chosen}1`, `h${chosen}2`].map(t.id);
        const asked = drive(t.engine, (pc) => {
          if (pc.kind !== "chooserSelectsTarget") return undefined;
          assert.deepEqual([...offeredCards(t.engine)].sort(), [...mine].sort(), "the pick is among the chosen opponent's hand only");
          return { selected: mine.slice(0, pickCount) };
        });
        assert.deepEqual(asked.map((a) => a.playerId), [P1]);
        assert.equal(discardOf(t.engine, chosen).length, pickCount);
        for (const who of others(count, chosen)) assert.equal(handOf(t.engine, who).length, 3, `${who}'s hand is untouched`);
      }
    }
  });
}

clause(RITUAL, "0:ability", "3 seats: with one opponent left no choice is offered", () => {
  const t = seatTable(3, [
    { key: "rt", def: printing(RITUAL), owner: P1, zone: "hand" },
    ...bank("obsession", 12, P1),
    ...fill("h2", 2, P2, "hand"),
    ...fill("h3", 2, P3, "hand")
  ]);
  eliminate(t.engine, P3);
  expectNotAsked(t, { type: "playCard", playerId: P1, cardId: t.id("rt") });
  playCard(t.engine, P1, t.id("rt"), { variables: { x: 1 } });
  drive(t.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { selected: [t.id("h20")] } : undefined));
  assert.equal(zoneOf(t.engine, t.id("h20")), "discard");
});

// --- Stolen Inspiration -------------------------------------------------------------------------
// 0: Look at your opponent's hand and pick a non-resource card. Your opponent must discard that card.
// 1: You may play a non-resource card with numeric cost X or less for free, where X is half the numeric cost of the discarded card, rounded up.

const STOLEN = "36a4611a-f7c9-4390-930c-46cd0f82569b";

function stolenBoard(count: number) {
  return seatTable(count, [
    { key: "si", def: printing(STOLEN), owner: P1, zone: "hand" },
    ...bank("obsession", 12, P1),
    { key: "c3", def: character({ name: "Three", cost: 3 }), owner: P1, zone: "hand" },
    { key: "c4", def: character({ name: "Four", cost: 4 }), owner: P1, zone: "hand" },
    ...opponentsAt(count).flatMap((who) => [
      { key: `n${who}`, def: character({ name: `Five ${who}`, cost: 5 }), owner: who, zone: "hand" as const },
      { key: `r${who}`, def: character({ name: `Res ${who}`, cost: 1 }), owner: who, zone: "hand" as const }
    ])
  ]);
}

for (const count of TABLES) {
  clause(STOLEN, "0:rule", `${count} seats: only the chosen opponent's non-resource card is picked and discarded`, () => {
    for (const chosen of choices(count)) {
      const t = stolenBoard(count);
      expectOpponentAsked(t, { type: "playCard", playerId: P1, cardId: t.id("si") });
      playCard(t.engine, P1, t.id("si"), { players: { opponent: chosen } });
      const asked = drive(t.engine, (pc) => {
        if (pc.kind === "deployForFree") return undefined;
        assert.equal(pc.kind, "chooserSelectsTarget");
        assert.ok(offeredCards(t.engine).every((id) => t.engine.state.cards[id]!.ownerId === chosen), "only the chosen opponent's cards are offered");
        assert.ok(offeredCards(t.engine).includes(t.id(`n${chosen}`)));
        return { selected: [t.id(`n${chosen}`)] };
      });
      assert.deepEqual(asked.map((a) => a.playerId), [P1]);
      assert.equal(zoneOf(t.engine, t.id(`n${chosen}`)), "discard");
      for (const who of others(count, chosen)) assert.equal(zoneOf(t.engine, t.id(`n${who}`)), "hand", `${who}'s card stays`);
    }
  });
}

clause(STOLEN, "0:rule", "3 seats: with one opponent left no choice is offered", () => {
  const t = stolenBoard(3);
  eliminate(t.engine, P3);
  expectNotAsked(t, { type: "playCard", playerId: P1, cardId: t.id("si") });
  playCard(t.engine, P1, t.id("si"));
  drive(t.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { selected: [t.id("n" + P2)] } : undefined));
  assert.equal(zoneOf(t.engine, t.id("n" + P2)), "discard");
});

clause(STOLEN, "1:rule", "3 seats: the free play is limited to half the cost (rounded up) of the card the chosen opponent discarded", () => {
  for (const chosen of [P2, P3]) {
    const t = stolenBoard(3);
    playCard(t.engine, P1, t.id("si"), { players: { opponent: chosen } });
    drive(t.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { selected: [t.id(`n${chosen}`)] } : undefined));
    const pc = pendingOf(t.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
    assert.equal(pc.kind, "deployForFree");
    assert.equal(pc.playerId, P1);
    assert.ok(pc.candidates.includes(t.id("c3")), "cost 3 is within half of 5 rounded up");
    assert.ok(!pc.candidates.includes(t.id("c4")), "cost 4 is above 3");
    assert.ok(pc.candidates.every((id) => t.engine.state.cards[id]!.ownerId === P1), "the other opponents' cards play no part");
  }
});

// --- Meager Research ------------------------------------------------------------------------------
// Reveal the top card of your opponent's deck and put it into their hand. You may search your deck for a card of the same type as that card.

const MEAGER = "d25a15e6-3f64-484a-bc42-5121528329c7";

for (const count of TABLES) {
  clause(MEAGER, "0:rule", `${count} seats: the chosen opponent's top card is revealed to all and put into their hand; the other opponents' decks are untouched`, () => {
    for (const chosen of choices(count)) {
      const t = seatTable(count, [
        { key: "mr", def: printing(MEAGER), owner: P1, zone: "hand" },
        ...bank("elitism", 6, P1),
        { key: "mine0", def: character({ name: "MineChar" }), owner: P1, zone: "deck" },
        { key: "mine1", def: item({ name: "MineItem" }), owner: P1, zone: "deck" },
        ...opponentsAt(count).flatMap((who) => [
          { key: `t${who}`, def: character({ name: `Top ${who}` }), owner: who, zone: "deck" as const },
          { key: `u${who}`, def: character({ name: `Under ${who}` }), owner: who, zone: "deck" as const }
        ])
      ]);
      expectOpponentAsked(t, { type: "playCard", playerId: P1, cardId: t.id("mr") });
      const decks = Object.fromEntries(opponentsAt(count).map((who) => [who, [...deckOf(t.engine, who)]]));
      playCard(t.engine, P1, t.id("mr"), { players: { opponent: chosen } });
      const asked = drive(t.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { selected: [t.id("mine0")] } : undefined));
      assert.deepEqual(asked.map((a) => a.playerId), [P1]);
      assert.equal(zoneOf(t.engine, t.id(`t${chosen}`)), "hand", "the top card is in the chosen opponent's hand");
      const reveal = t.engine.getLog().find((entry) => entry.event?.type === "cardsRevealed")?.event as unknown as { cardIds: string[]; viewerId: string };
      assert.deepEqual(reveal.cardIds, [t.id(`t${chosen}`)]);
      assert.equal(reveal.viewerId, "all", "revealed to every player");
      assert.equal(zoneOf(t.engine, t.id("mine0")), "hand", "a character like the revealed one is found in the caster's own deck");
      for (const who of others(count, chosen)) assert.deepEqual(deckOf(t.engine, who), decks[who], `${who}'s deck is untouched`);
    }
  });
}

clause(MEAGER, "0:rule", "3 seats: with one opponent left no choice is offered", () => {
  const t = seatTable(3, [
    { key: "mr", def: printing(MEAGER), owner: P1, zone: "hand" },
    ...bank("elitism", 6, P1),
    { key: "t2", def: character({ name: "Top2" }), owner: P2, zone: "deck" },
    { key: "t3", def: character({ name: "Top3" }), owner: P3, zone: "deck" }
  ]);
  eliminate(t.engine, P3);
  expectNotAsked(t, { type: "playCard", playerId: P1, cardId: t.id("mr") });
  playCard(t.engine, P1, t.id("mr"));
  drive(t.engine, () => undefined);
  assert.equal(zoneOf(t.engine, t.id("t2")), "hand");
});

// --- Defenestrate -----------------------------------------------------------------------------
// Put the top 2 cards of your opponent's deck into their discard pile. Draw a card.

const DEFENESTRATE = "d74f6b0f-58d5-4e07-b5bc-dbd1a17df192";

for (const count of TABLES) {
  clause(DEFENESTRATE, "0:rule", `${count} seats: only the chosen opponent's top 2 cards are put into their discard pile; the caster draws`, () => {
    for (const chosen of choices(count)) {
      const t = seatTable(count, [
        { key: "df", def: printing(DEFENESTRATE), owner: P1, zone: "hand" },
        ...bank("deception", 6, P1),
        ...fill("mine", 2, P1, "deck"),
        ...opponentsAt(count).flatMap((who) => fill(`d${who}`, 4, who, "deck"))
      ]);
      expectOpponentAsked(t, { type: "playCard", playerId: P1, cardId: t.id("df") });
      const decks = Object.fromEntries(opponentsAt(count).map((who) => [who, [...deckOf(t.engine, who)]]));
      playCard(t.engine, P1, t.id("df"), { players: { opponent: chosen } });
      drive(t.engine, () => undefined);
      assert.deepEqual(discardOf(t.engine, chosen), decks[chosen]!.slice(0, 2), "the top 2 cards, in order");
      assert.deepEqual(deckOf(t.engine, chosen), decks[chosen]!.slice(2));
      assert.equal(zoneOf(t.engine, t.id("mine0")), "hand", "the caster draws a card");
      for (const who of others(count, chosen)) assert.deepEqual(deckOf(t.engine, who), decks[who], `${who}'s deck is untouched`);
    }
  });
}

clause(DEFENESTRATE, "0:rule", "3 seats: a chosen opponent with 1 card in their deck mills 1; with one opponent left no choice is offered", () => {
  const t = seatTable(3, [
    { key: "df", def: printing(DEFENESTRATE), owner: P1, zone: "hand" },
    ...bank("deception", 6, P1),
    ...fill("mine", 2, P1, "deck"),
    ...fill("d2", 1, P2, "deck"),
    ...fill("d3", 3, P3, "deck")
  ]);
  playCard(t.engine, P1, t.id("df"), { players: { opponent: P2 } });
  drive(t.engine, () => undefined);
  assert.deepEqual(discardOf(t.engine, P2), [t.id("d20")]);
  const u = seatTable(3, [
    { key: "df", def: printing(DEFENESTRATE), owner: P1, zone: "hand" },
    ...bank("deception", 6, P1),
    ...fill("mine", 2, P1, "deck"),
    ...fill("d2", 3, P2, "deck"),
    ...fill("d3", 3, P3, "deck")
  ]);
  eliminate(u.engine, P3);
  expectNotAsked(u, { type: "playCard", playerId: P1, cardId: u.id("df") });
  playCard(u.engine, P1, u.id("df"));
  drive(u.engine, () => undefined);
  assert.equal(discardOf(u.engine, P2).length, 2);
});

// --- Dragon's Strategy ------------------------------------------------------------------------
// Your opponent's faction loses 2 influence. Draw a card.

const DRAGONS = "463d51ef-13f3-4c9c-a90b-a1e1d63b8e98";

for (const count of TABLES) {
  clause(DRAGONS, "0:rule", `${count} seats: only the chosen opponent's faction loses 2 influence`, () => {
    for (const chosen of choices(count)) {
      const t = seatTable(count, [
        { key: "ds", def: printing(DRAGONS), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1),
        ...fill("mine", 2, P1, "deck")
      ]);
      expectOpponentAsked(t, { type: "playCard", playerId: P1, cardId: t.id("ds") });
      const before = Object.fromEntries(t.seats.map((who) => [who, influenceOf(t.engine, who)]));
      playCard(t.engine, P1, t.id("ds"), { players: { opponent: chosen } });
      drive(t.engine, () => undefined);
      assert.equal(before[chosen]! - influenceOf(t.engine, chosen), 2);
      for (const who of [P1, ...others(count, chosen)]) assert.equal(influenceOf(t.engine, who), before[who], `${who}'s faction is unchanged`);
      assert.equal(zoneOf(t.engine, t.id("mine0")), "hand", "the caster draws a card");
    }
  });
}

clause(DRAGONS, "0:rule", "3 seats: with one opponent left no choice is offered and that faction loses 2", () => {
  const t = seatTable(3, [{ key: "ds", def: printing(DRAGONS), owner: P1, zone: "hand" }, ...bank("rage", 6, P1), ...fill("mine", 2, P1, "deck")]);
  eliminate(t.engine, P3);
  expectNotAsked(t, { type: "playCard", playerId: P1, cardId: t.id("ds") });
  const before = influenceOf(t.engine, P2);
  playCard(t.engine, P1, t.id("ds"));
  drive(t.engine, () => undefined);
  assert.equal(before - influenceOf(t.engine, P2), 2);
});

// --- Siege Machine ---------------------------------------------------------------------------
// BATTERING RAM -- COST: Pay 2. Destroy a resource you control. EFFECT: Your opponent's faction loses 1 influence.

const SIEGE = "5c02a5f8-543e-456b-8ee2-075fd1f6bff9";

for (const count of TABLES) {
  clause(SIEGE, "0:ability:ram", `${count} seats: only the chosen opponent's faction loses 1 influence`, () => {
    for (const chosen of choices(count)) {
      const t = seatTable(count, [{ key: "sm", def: printing(SIEGE), owner: P1, zone: "play" }, ...bank("rage", 4, P1), ...bank("greed", 2, P1)]);
      const action = { type: "activateAbility", playerId: P1, cardId: t.id("sm"), abilityId: "ram" };
      expectOpponentAsked(t, action);
      const before = Object.fromEntries(t.seats.map((who) => [who, influenceOf(t.engine, who)]));
      const doomed = t.engine.state.players[P1]!.play.filter((id) => t.engine.isResource(id))[0]!;
      activate(t.engine, P1, t.id("sm"), "ram", { players: { opponent: chosen }, selected: { r: [doomed] } });
      drive(t.engine, () => undefined);
      assert.equal(zoneOf(t.engine, doomed), "discard", "the resource is destroyed");
      assert.equal(before[chosen]! - influenceOf(t.engine, chosen), 1);
      for (const who of [P1, ...others(count, chosen)]) assert.equal(influenceOf(t.engine, who), before[who]);
    }
  });
}

clause(SIEGE, "0:ability:ram", "3 seats: with one opponent left no choice is offered", () => {
  const t = seatTable(3, [{ key: "sm", def: printing(SIEGE), owner: P1, zone: "play" }, ...bank("rage", 4, P1), ...bank("greed", 2, P1)]);
  eliminate(t.engine, P3);
  expectNotAsked(t, { type: "activateAbility", playerId: P1, cardId: t.id("sm"), abilityId: "ram" });
  const doomed = t.engine.state.players[P1]!.play.filter((id) => t.engine.isResource(id))[0]!;
  const before = influenceOf(t.engine, P2);
  activate(t.engine, P1, t.id("sm"), "ram", { selected: { r: [doomed] } });
  drive(t.engine, () => undefined);
  assert.equal(before - influenceOf(t.engine, P2), 1);
});

// --- Warehouse Raid ----------------------------------------------------------------------------
// EFFECT: Your opponent must discard X cards at random. Put any items discarded this way into play under your control.

const RAID = "3e634264-918f-44bd-bcd5-340220566f8e";
const WIN = () => 0; // the engine flips with `random() < 0.5`
const LOSE = () => 0.99;

for (const count of TABLES) {
  clause(RAID, "0:ability", `${count} seats: only the chosen opponent discards X at random, and their items go into play under the caster's control`, () => {
    for (const chosen of choices(count)) {
      for (const [random, x] of [[WIN, 2], [LOSE, 1]] as const) {
        const t = seatTable(
          count,
          [
            { key: "wr", def: printing(RAID), owner: P1, zone: "hand" },
            ...bank("deception", 6, P1),
            ...opponentsAt(count).flatMap((who) => [
              { key: `i${who}`, def: item({ name: `Item ${who}` }), owner: who, zone: "hand" as const },
              { key: `j${who}`, def: item({ name: `Item2 ${who}` }), owner: who, zone: "hand" as const },
              { key: `k${who}`, def: item({ name: `Item3 ${who}` }), owner: who, zone: "hand" as const }
            ])
          ],
          { random }
        );
        expectOpponentAsked(t, { type: "playCard", playerId: P1, cardId: t.id("wr") });
        playCard(t.engine, P1, t.id("wr"), { players: { opponent: chosen } });
        drive(t.engine, () => undefined);
        assert.equal(handOf(t.engine, chosen).length, 3 - x, `${chosen} discards exactly ${x} at random`);
        const taken = [`i${chosen}`, `j${chosen}`, `k${chosen}`].filter((key) => zoneOf(t.engine, t.id(key)) === "play");
        assert.equal(taken.length, x, "the discarded items entered play");
        for (const key of taken) assert.equal(t.engine.state.cards[t.id(key)]!.controllerId, P1, "under the caster's control");
        for (const who of others(count, chosen)) assert.equal(handOf(t.engine, who).length, 3, `${who}'s hand is untouched`);
      }
    }
  });
}

clause(RAID, "0:ability", "3 seats: a chosen opponent with fewer than X cards discards what they have; with one opponent left no choice is offered", () => {
  const t = seatTable(3, [{ key: "wr", def: printing(RAID), owner: P1, zone: "hand" }, ...bank("deception", 6, P1), { key: "only", def: character({ name: "Only" }), owner: P2, zone: "hand" }, ...fill("h3", 3, P3, "hand")], { random: WIN });
  playCard(t.engine, P1, t.id("wr"), { players: { opponent: P2 } });
  drive(t.engine, () => undefined);
  assert.equal(handOf(t.engine, P2).length, 0);
  assert.equal(handOf(t.engine, P3).length, 3);
  const u = seatTable(3, [{ key: "wr", def: printing(RAID), owner: P1, zone: "hand" }, ...bank("deception", 6, P1), ...fill("h2", 3, P2, "hand"), ...fill("h3", 3, P3, "hand")], { random: LOSE });
  eliminate(u.engine, P3);
  expectNotAsked(u, { type: "playCard", playerId: P1, cardId: u.id("wr") });
  playCard(u.engine, P1, u.id("wr"));
  drive(u.engine, () => undefined);
  assert.equal(handOf(u.engine, P2).length, 2);
});

// --- Jackmove ----------------------------------------------------------------------------------
// Reveal the top X cards of your opponent's deck. Put all revealed characters and items into play under your control, and the remaining cards into your opponent's discard pile.

const JACKMOVE = "63358d71-4e67-40e8-811c-6d1d8ce36f3f";

for (const count of TABLES) {
  clause(JACKMOVE, "0:ability", `${count} seats: only the chosen opponent's top X cards are revealed to all; characters and items enter play under the caster's control, the rest go to that opponent's discard`, () => {
    for (const chosen of choices(count)) {
      const t = seatTable(count, [
        { key: "jm", def: printing(JACKMOVE), owner: P1, zone: "hand" },
        ...bank("deception", 12, P1),
        ...opponentsAt(count).flatMap((who) => [
          { key: `c${who}`, def: character({ name: `Char ${who}` }), owner: who, zone: "deck" as const },
          { key: `i${who}`, def: item({ name: `Item ${who}` }), owner: who, zone: "deck" as const },
          { key: `t${who}`, def: tactic({ name: `Tact ${who}` }), owner: who, zone: "deck" as const },
          { key: `z${who}`, def: character({ name: `Deep ${who}` }), owner: who, zone: "deck" as const }
        ])
      ]);
      expectOpponentAsked(t, { type: "playCard", playerId: P1, cardId: t.id("jm") });
      const decks = Object.fromEntries(opponentsAt(count).map((who) => [who, [...deckOf(t.engine, who)]]));
      const before = ready(t.engine, P1);
      playCard(t.engine, P1, t.id("jm"), { players: { opponent: chosen }, variables: { x: 3 } });
      assert.equal(before - ready(t.engine, P1), 6, "twice X is paid");
      drive(t.engine, () => undefined);
      const [first, second, third] = decks[chosen]!;
      for (const id of [first!, second!, third!].filter((id) => ["character", "item"].includes(t.engine.getDefinition(id).type))) {
        assert.equal(zoneOf(t.engine, id), "play");
        assert.equal(t.engine.state.cards[id]!.controllerId, P1);
      }
      for (const id of [first!, second!, third!].filter((id) => t.engine.getDefinition(id).type === "tactic")) assert.ok(discardOf(t.engine, chosen).includes(id));
      assert.equal(deckOf(t.engine, chosen).length, 1, "exactly 3 cards left the chosen opponent's deck");
      const reveal = t.engine.getLog().find((entry) => entry.event?.type === "cardsRevealed")?.event as unknown as { cardIds: string[]; viewerId: string };
      assert.deepEqual([...reveal.cardIds].sort(), [first!, second!, third!].sort());
      assert.equal(reveal.viewerId, "all");
      for (const who of others(count, chosen)) assert.deepEqual(deckOf(t.engine, who), decks[who], `${who}'s deck is untouched`);
    }
  });
}

clause(JACKMOVE, "0:ability", "3 seats: with one opponent left no choice is offered", () => {
  const t = seatTable(3, [{ key: "jm", def: printing(JACKMOVE), owner: P1, zone: "hand" }, ...bank("deception", 12, P1), ...fill("c2", 2, P2, "deck"), ...fill("c3", 2, P3, "deck")]);
  eliminate(t.engine, P3);
  expectNotAsked(t, { type: "playCard", playerId: P1, cardId: t.id("jm") });
  playCard(t.engine, P1, t.id("jm"), { variables: { x: 1 } });
  drive(t.engine, () => undefined);
  assert.equal(zoneOf(t.engine, t.id("c20")), "play");
});

// --- Pluck --------------------------------------------------------------------------------------
// GRIFT -- COST: Use this only during your turn. Pay 5. Deplete this card. Pick a non-tactic card in your opponent's discard pile.

const PLUCK = "428fa533-f143-4d22-8069-13695bfc6763";

for (const count of TABLES) {
  clause(PLUCK, "1:ability:grift", `${count} seats: only the chosen opponent's non-tactic discard cards are pickable; the pick enters play under the caster's control`, () => {
    for (const chosen of choices(count)) {
      const t = seatTable(count, [
        { key: "pl", def: printing(PLUCK), owner: P1, zone: "play" },
        ...bank("deception", 8, P1),
        ...opponentsAt(count).flatMap((who) => [
          { key: `c${who}`, def: character({ name: `Char ${who}` }), owner: who, zone: "discard" as const },
          { key: `t${who}`, def: tactic({ name: `Tact ${who}` }), owner: who, zone: "discard" as const },
          { key: `i${who}`, def: item({ name: `Item ${who}` }), owner: who, zone: "discard" as const }
        ])
      ]);
      const action = { type: "activateAbility", playerId: P1, cardId: t.id("pl"), abilityId: "grift" };
      expectOpponentAsked(t, action);
      const needs = t.engine.getPlayRequirements({ ...action, players: { opponent: chosen } } as never);
      const pick = needs.find((n) => (n as { kind: string }).kind === "pick") as unknown as { candidates: string[] };
      assert.deepEqual([...pick.candidates].sort(), [`c${chosen}`, `i${chosen}`].map(t.id).sort(), "only the chosen opponent's non-tactic cards");
      refused(() => activate(t.engine, P1, t.id("pl"), "grift", { players: { opponent: chosen }, selected: { c: [t.id(`t${chosen}`)] } }), "a tactic is not pickable");
      for (const who of others(count, chosen)) {
        refused(() => activate(t.engine, P1, t.id("pl"), "grift", { players: { opponent: chosen }, selected: { c: [t.id(`c${who}`)] } }), `${who}'s discard pile is not pickable`);
      }
      activate(t.engine, P1, t.id("pl"), "grift", { players: { opponent: chosen }, selected: { c: [t.id(`c${chosen}`)] } });
      drive(t.engine, () => undefined);
      assert.equal(zoneOf(t.engine, t.id(`c${chosen}`)), "play");
      assert.equal(t.engine.state.cards[t.id(`c${chosen}`)]!.controllerId, P1);
      for (const who of others(count, chosen)) assert.equal(zoneOf(t.engine, t.id(`c${who}`)), "discard");
    }
  });
}

clause(PLUCK, "1:ability:grift", "3 seats: used on an opponent's turn it is refused", () => {
  const t = seatTable(3, [{ key: "pl", def: printing(PLUCK), owner: P1, zone: "play" }, ...bank("deception", 8, P1), { key: "c2", def: character({ name: "C2" }), owner: P2, zone: "discard" }], { activePlayerId: P2 });
  refused(() => activate(t.engine, P1, t.id("pl"), "grift", { players: { opponent: P2 }, selected: { c: [t.id("c2")] } }), "only during your turn");
});

// --- Executive Poaching ---------------------------------------------------------------------------
// Destroy the character your opponent controls with the highest numeric cost. If there is a tie, you decide.

const POACHING = "1d851c52-991f-4c24-9a1d-b56575677bfb";

function poachBoard(count: number, extra: CardPlacement[] = []) {
  return seatTable(count, [
    { key: "ep", def: printing(POACHING), owner: P1, zone: "hand" },
    ...bank("greed", 8, P1),
    { key: "mine", def: character({ name: "Mine", cost: 9 }), owner: P1, zone: "play" },
    { key: "a2", def: character({ name: "A2", cost: 2 }), owner: P2, zone: "play" },
    { key: "b2", def: character({ name: "B2", cost: 5 }), owner: P2, zone: "play" },
    { key: "a3", def: character({ name: "A3", cost: 7 }), owner: P3, zone: "play" },
    { key: "b3", def: character({ name: "B3", cost: 1 }), owner: P3, zone: "play" },
    ...(count === 4 ? [{ key: "a4", def: character({ name: "A4", cost: 8 }), owner: P4, zone: "play" as const }] : []),
    ...extra
  ]);
}

for (const count of TABLES) {
  clause(POACHING, "0:rule", `${count} seats: the highest-cost character is taken among the chosen opponent's characters only`, () => {
    for (const [chosen, doomed] of [[P2, "b2"], [P3, "a3"], ...(count === 4 ? [[P4, "a4"]] : [])] as [string, string][]) {
      const t = poachBoard(count);
      expectOpponentAsked(t, { type: "playCard", playerId: P1, cardId: t.id("ep") });
      playCard(t.engine, P1, t.id("ep"), { players: { opponent: chosen } });
      drive(t.engine, () => undefined);
      assert.equal(zoneOf(t.engine, t.id(doomed)), "discard", `${chosen}'s highest-cost character is destroyed`);
      for (const key of ["mine", "a2", "b2", "a3", "b3", ...(count === 4 ? ["a4"] : [])].filter((key) => key !== doomed)) assert.equal(zoneOf(t.engine, t.id(key)), "play", `${key} stays`);
    }
  });
}

clause(POACHING, "0:rule", "3 seats: on a tie among the chosen opponent's characters the caster decides; an opponent with no characters loses nothing; one opponent left is bound without asking", () => {
  const tie = poachBoard(3, [{ key: "b2tie", def: character({ name: "B2tie", cost: 5 }), owner: P2, zone: "play" }]);
  playCard(tie.engine, P1, tie.id("ep"), { players: { opponent: P2 } });
  const asked = drive(tie.engine, (pc) => {
    if (pc.kind !== "chooserSelectsTarget") return undefined;
    assert.deepEqual([...offeredCards(tie.engine)].sort(), [tie.id("b2"), tie.id("b2tie")].sort(), "only the tied characters of the chosen opponent");
    return { selected: [tie.id("b2tie")] };
  });
  assert.deepEqual(asked.map((a) => a.playerId), [P1]);
  assert.equal(zoneOf(tie.engine, tie.id("b2tie")), "discard");
  assert.equal(zoneOf(tie.engine, tie.id("b2")), "play");
  const empty = seatTable(3, [{ key: "ep", def: printing(POACHING), owner: P1, zone: "hand" }, ...bank("greed", 8, P1), { key: "c3", def: character({ name: "C3", cost: 4 }), owner: P3, zone: "play" }]);
  playCard(empty.engine, P1, empty.id("ep"), { players: { opponent: P2 } });
  drive(empty.engine, () => undefined);
  assert.equal(zoneOf(empty.engine, empty.id("c3")), "play");
  const one = poachBoard(3);
  eliminate(one.engine, P3);
  expectNotAsked(one, { type: "playCard", playerId: P1, cardId: one.id("ep") });
  playCard(one.engine, P1, one.id("ep"));
  drive(one.engine, () => undefined);
  assert.equal(zoneOf(one.engine, one.id("b2")), "discard");
});


// --- Voidal Replication -----------------------------------------------------------------------
// EXTRA COST: Your opponents cannot respond to this card. Deploy this only if a tactic has been deployed this turn. -- Duplicate the last tactic deployed this turn.

const VOIDAL = "b9e94612-3cbd-44ff-9aac-a553a49c0955";

function voidalBoard(count: number) {
  const prior = tactic({ name: "Prior", cost: 0, behavior: { abilities: [{ id: "p", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });
  const counter = tactic({ name: "Counter", cost: 0, behavior: { abilities: [{ id: "c", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });
  const t = seatTable(count, [
    { key: "vr", def: printing(VOIDAL), owner: P1, zone: "hand" },
    { key: "prior", def: prior, owner: P1, zone: "hand" },
    ...bank("obsession", 8, P1),
    ...fill("mine", 4, P1, "deck"),
    ...opponentsAt(count).flatMap((who) => [{ key: `c${who}`, def: counter, owner: who, zone: "hand" as const }, ...fill(`d${who}`, 2, who, "deck")])
  ]);
  playCard(t.engine, P1, t.id("prior"));
  passAround(t.engine);
  return t;
}

for (const count of TABLES) {
  clause(VOIDAL, "0:extraCost", `${count} seats: no opponent is chosen and no opponent is offered a response or can play a tactic in response`, () => {
    const t = voidalBoard(count);
    expectNotAsked(t, { type: "playCard", playerId: P1, cardId: t.id("vr") });
    playCard(t.engine, P1, t.id("vr"));
    assert.equal(t.engine.state.responseWindow, undefined, "no window opens for any opponent: it resolves at once");
    assert.equal(zoneOf(t.engine, t.id("vr")), "discard");
    for (const who of opponentsAt(count)) assert.equal(zoneOf(t.engine, t.id(`c${who}`)), "hand");
  });

  clause(VOIDAL, "0:extraCost", `${count} seats: an opponent cannot respond to it while it is being played`, () => {
    const t = voidalBoard(count);
    playCard(t.engine, P1, t.id("vr"));
    for (const who of opponentsAt(count)) refused(() => playCard(t.engine, who, t.id(`c${who}`)), `${who} cannot respond`);
  });
}

// --- Nearby Serpent ----------------------------------------------------------------------------
// When this card enters play, look at the top 5 cards of either deck and put them back in any order.

const SERPENT = "9b13c156-b7f9-4678-93ff-062a78e3bc5a";

function serpentBoard(count: number) {
  return seatTable(count, [
    { key: "ns", def: printing(SERPENT), owner: P1, zone: "hand" },
    ...bank("obsession", 6, P1),
    ...fill("a", 6, P1, "deck"),
    ...opponentsAt(count).flatMap((who) => fill(`d${who}`, 6, who, "deck"))
  ]);
}

/** The faction cards a `chooserSelectsTarget` of the serpent's trigger offers, as owners. */
const offeredOwners = (engine: Parameters<typeof offeredCards>[0]): string[] => offeredCards(engine).map((id) => engine.state.cards[id]!.ownerId).sort();

for (const count of TABLES) {
  clause(SERPENT, "1:rule", `${count} seats: the opponent is chosen when the trigger resolves, and exactly two decks are offered: the caster's and the chosen opponent's`, () => {
    for (const chosen of choices(count)) {
      const t = serpentBoard(count);
      const decks = Object.fromEntries(t.seats.map((who) => [who, [...deckOf(t.engine, who)]]));
      playCard(t.engine, P1, t.id("ns"));
      passAround(t.engine);
      let pc = pendingOf(t.engine)!;
      assert.equal(pc.kind, "choosePlayer", "the opponent is chosen when the trigger resolves");
      assert.equal(pc.playerId, P1);
      assert.deepEqual(candidatesOf(t.engine), opponentsAt(count));
      answer(t.engine, "choosePlayer", { playerId: chosen });
      pc = pendingOf(t.engine)!;
      assert.equal(pc.kind, "chooserSelectsTarget");
      assert.deepEqual(offeredOwners(t.engine), [P1, chosen].sort(), "the caster's deck and the chosen opponent's deck, never another");
      // pick the chosen opponent's deck, look at its top 5 and put them back reversed
      const faction = (who: string) => t.engine.state.players[who]!.factionId!;
      answer(t.engine, "chooserSelectsTarget", { selected: [faction(chosen)] });
      const reorder = pendingOf(t.engine)!;
      assert.equal(reorder.kind, "reorderDeck");
      const ids = (reorder as unknown as { cardIds: string[] }).cardIds;
      assert.deepEqual([...ids].sort(), decks[chosen]!.slice(0, 5).sort(), "the top 5 of the chosen opponent's deck");
      answer(t.engine, "reorderDeck", { order: [...ids].reverse() });
      assert.deepEqual(deckOf(t.engine, chosen).slice(0, 5), [...decks[chosen]!.slice(0, 5)].reverse());
      assert.equal(deckOf(t.engine, chosen).length, 6, "nothing changed zone");
      for (const who of t.seats.filter((seat) => seat !== chosen)) assert.deepEqual(deckOf(t.engine, who), decks[who], `${who}'s deck is untouched`);
    }
  });

  clause(SERPENT, "1:rule", `${count} seats: the caster's own deck can be picked from the same two`, () => {
    const chosen = opponentsAt(count)[opponentsAt(count).length - 1]!;
    const t = serpentBoard(count);
    const decks = Object.fromEntries(t.seats.map((who) => [who, [...deckOf(t.engine, who)]]));
    playCard(t.engine, P1, t.id("ns"));
    passAround(t.engine);
    answer(t.engine, "choosePlayer", { playerId: chosen });
    answer(t.engine, "chooserSelectsTarget", { selected: [t.engine.state.players[P1]!.factionId!] });
    const ids = (pendingOf(t.engine) as unknown as { cardIds: string[] }).cardIds;
    assert.deepEqual([...ids].sort(), decks[P1]!.slice(0, 5).sort());
    answer(t.engine, "reorderDeck", { order: [...ids].reverse() });
    assert.deepEqual(deckOf(t.engine, P1).slice(0, 5), [...decks[P1]!.slice(0, 5)].reverse());
    for (const who of opponentsAt(count)) assert.deepEqual(deckOf(t.engine, who), decks[who]);
  });

  clause(SERPENT, "1:rule", `${count} seats: a faction that is neither the caster's nor the chosen opponent's cannot be picked`, () => {
    const opps = opponentsAt(count);
    const chosen = opps[0]!;
    const t = serpentBoard(count);
    playCard(t.engine, P1, t.id("ns"));
    passAround(t.engine);
    answer(t.engine, "choosePlayer", { playerId: chosen });
    for (const who of opps.slice(1)) refused(() => answer(t.engine, "chooserSelectsTarget", { selected: [t.engine.state.players[who]!.factionId!] }), `${who}'s deck is not offered`);
    answer(t.engine, "chooserSelectsTarget", { selected: [t.engine.state.players[chosen]!.factionId!] });
  });
}

clause(SERPENT, "1:rule", "3 seats: with one opponent left no opponent choice is offered and the decks offered are the caster's and that opponent's", () => {
  const t = serpentBoard(3);
  eliminate(t.engine, P3);
  playCard(t.engine, P1, t.id("ns"));
  passAround(t.engine);
  const pc = pendingOf(t.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget", "nobody is asked to choose an opponent");
  assert.deepEqual(offeredOwners(t.engine), [P1, P2]);
});

// --- 3p1ph4ny 31f -----------------------------------------------------------------------------
// When this card enters play, you may play a non-tactic card for free. If you do, your opponent may do the same.

const EPIPHANY = "0de292e7-cc1a-481a-ad01-697f928caac1";

function epiphanyBoard(count: number, active = P1) {
  return seatTable(
    count,
    [
      { key: "ep", def: printing(EPIPHANY), owner: P1, zone: "hand" },
      ...bank("elitism", 8, P1),
      { key: "mine", def: character({ name: "MineFree", cost: 1 }), owner: P1, zone: "hand" },
      { key: "tact", def: tactic({ name: "MineTact", cost: 0 }), owner: P1, zone: "hand" },
      ...opponentsAt(count).flatMap((who) => [
        { key: `f${who}`, def: character({ name: `Free ${who}`, cost: 1 }), owner: who, zone: "hand" as const },
        { key: `t${who}`, def: tactic({ name: `Tact ${who}`, cost: 0 }), owner: who, zone: "hand" as const }
      ])
    ],
    { activePlayerId: active }
  );
}

for (const count of TABLES) {
  clause(EPIPHANY, "0:rule", `${count} seats: the opponent is chosen when the trigger resolves; only they may then play a non-tactic card for free`, () => {
    for (const chosen of choices(count)) {
      const t = epiphanyBoard(count);
      playCard(t.engine, P1, t.id("ep"));
      passAround(t.engine);
      let pc = pendingOf(t.engine)!;
      const prompts: string[] = [];
      for (let guard = 0; guard < 6 && pc; guard++, pc = pendingOf(t.engine)!) {
        prompts.push(`${pc.kind}:${pc.playerId}`);
        if (pc.kind === "choosePlayer") {
          assert.equal(pc.playerId, P1);
          assert.deepEqual(candidatesOf(t.engine), opponentsAt(count));
          answer(t.engine, "choosePlayer", { playerId: chosen });
        } else if (pc.kind === "deployForFree") {
          const offer = (pc as unknown as { candidates: string[] }).candidates;
          const mine = pc.playerId === P1;
          assert.ok(offer.includes(t.id(mine ? "mine" : `f${chosen}`)));
          assert.ok(!offer.includes(t.id(mine ? "tact" : `t${chosen}`)), "a tactic is not offered");
          t.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "deployForFree", cardId: t.id(mine ? "mine" : `f${chosen}`) } } as never);
          passAround(t.engine);
        } else throw new Error(`unexpected ${pc.kind}`);
        if (!pendingOf(t.engine)) break;
      }
      assert.ok(prompts.includes(`deployForFree:${chosen}`), `${chosen} was offered the free play: ${prompts.join(" ")}`);
      assert.equal(zoneOf(t.engine, t.id(`f${chosen}`)), "play");
      for (const who of others(count, chosen)) {
        assert.ok(!prompts.some((p) => p.endsWith(`:${who}`)), `${who} is never offered anything`);
        assert.equal(zoneOf(t.engine, t.id(`f${who}`)), "hand");
      }
    }
  });
}

clause(EPIPHANY, "0:rule", "3 seats: if the controller declines the free play the opponent is offered nothing", () => {
  const t = epiphanyBoard(3);
  playCard(t.engine, P1, t.id("ep"));
  passAround(t.engine);
  const prompts: string[] = [];
  for (let guard = 0; guard < 6 && pendingOf(t.engine); guard++) {
    const pc = pendingOf(t.engine)!;
    prompts.push(`${pc.kind}:${pc.playerId}`);
    if (pc.kind === "choosePlayer") answer(t.engine, "choosePlayer", { playerId: P2 });
    else if (pc.kind === "deployForFree") t.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "deployForFree" } } as never);
    passAround(t.engine);
  }
  assert.ok(!prompts.some((p) => p === `deployForFree:${P2}` || p === `deployForFree:${P3}`), prompts.join(" "));
  assert.equal(zoneOf(t.engine, t.id("fp2")), "hand");
});


clause(EPIPHANY, "0:rule", "3 seats: entering play on another player's turn, the controller still chooses the opponent, who may be the active player or the other one", () => {
  for (const chosen of [P2, P3]) {
    const noop = tactic({ name: "Noop", cost: 0, behavior: { abilities: [{ id: "n", type: "activated", effects: [] }] } });
    const cheat = tactic({
      name: "Cheat",
      cost: 0,
      behavior: {
        abilities: [
          {
            id: "c",
            type: "activated",
            targets: [{ id: "e", selector: { zone: "hand", type: "character" }, count: 1 }],
            effects: [{ type: "putIntoPlay", target: { type: "selected", id: "e" }, controller: "controller" }]
          }
        ]
      }
    });
    const t = seatTable(
      3,
      [
        { key: "ep", def: printing(EPIPHANY), owner: P1, zone: "hand" },
        { key: "cheat", def: cheat, owner: P1, zone: "hand" },
        { key: "noop", def: noop, owner: P2, zone: "hand" },
        { key: "fp1", def: character({ name: "Free P1", cost: 1 }), owner: P1, zone: "hand" },
        { key: "fp2", def: character({ name: "Free P2", cost: 1 }), owner: P2, zone: "hand" },
        { key: "fp3", def: character({ name: "Free P3", cost: 1 }), owner: P3, zone: "hand" },
        ...bank("elitism", 8, P1)
      ],
      { activePlayerId: P2 }
    );
    playCard(t.engine, P2, t.id("noop"));
    while (t.engine.state.responseWindow!.priorityPlayerId !== P1) t.engine.perform({ type: "passPriority", playerId: t.engine.state.responseWindow!.priorityPlayerId } as never);
    playCard(t.engine, P1, t.id("cheat"), { selected: { e: [t.id("ep")] } });
    passAround(t.engine);
    const prompts: string[] = [];
    for (let guard = 0; guard < 6 && pendingOf(t.engine); guard++) {
      const pc = pendingOf(t.engine)!;
      prompts.push(`${pc.kind}:${pc.playerId}`);
      if (pc.kind === "choosePlayer") {
        assert.equal(pc.playerId, P1, "the controller chooses even though it is not their turn");
        assert.deepEqual(candidatesOf(t.engine), [P2, P3]);
        answer(t.engine, "choosePlayer", { playerId: chosen });
      } else if (pc.kind === "deployForFree") {
        const mine = pc.playerId === P1;
        t.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "deployForFree", cardId: t.id(mine ? "fp1" : chosen === P2 ? "fp2" : "fp3") } } as never);
      }
      passAround(t.engine);
    }
    assert.ok(prompts.includes(`deployForFree:${chosen}`), prompts.join(" "));
    assert.ok(!prompts.includes(`deployForFree:${chosen === P2 ? P3 : P2}`), prompts.join(" "));
  }
});

// --- Research Investment ------------------------------------------------------------------------
// Both players may search their deck for up to 3 staple resources and put them into play.

const RESEARCH = "828a6b95-9e5f-4035-b348-6258c1937c87";
const staple = (name: string) => resourceCard({ name, resource: { provides: ["rage"], staple: true } });

function researchBoard(count: number) {
  return seatTable(count, [
    { key: "ri", def: printing(RESEARCH), owner: P1, zone: "hand" },
    ...bank("elitism", 8, P1),
    ...seatsFor(count).flatMap((who) => [
      ...fill(`s${who}`, 4, who, "deck", (i) => staple(`Staple ${who} ${i}`)),
      ...fill(`x${who}`, 2, who, "deck")
    ])
  ]);
}

for (const count of TABLES) {
  clause(RESEARCH, "0:rule", `${count} seats: only the caster and the chosen opponent may search their own deck, the caster first; no other opponent searches or shuffles`, () => {
    for (const chosen of choices(count)) {
      const t = researchBoard(count);
      expectOpponentAsked(t, { type: "playCard", playerId: P1, cardId: t.id("ri") });
      const decks = Object.fromEntries(t.seats.map((who) => [who, [...deckOf(t.engine, who)]]));
      playCard(t.engine, P1, t.id("ri"), { players: { opponent: chosen } });
      const asked = drive(t.engine, (pc) => {
        if (pc.kind !== "chooserSelectsTarget") return undefined;
        const offered = offeredCards(t.engine);
        assert.ok(offered.length >= 4 && offered.every((id) => t.engine.state.cards[id]!.ownerId === pc.playerId && t.engine.getDefinition(id).type === "resource"), "own staple resources only");
        return { selected: offered.slice(0, 3) };
      });
      assert.deepEqual(asked.map((a) => a.playerId), [P1, chosen], "the caster searches first, then the chosen opponent, and nobody else");
      for (const who of [P1, chosen]) {
        const inPlay = decks[who]!.filter((id) => zoneOf(t.engine, id) === "play");
        assert.equal(inPlay.length, 3, `${who} put 3 staple resources into play`);
      }
      for (const who of others(count, chosen)) assert.deepEqual(deckOf(t.engine, who), decks[who], `${who}'s deck is untouched and unshuffled`);
    }
  });
}

clause(RESEARCH, "0:rule", "3 seats: each searcher may take 0 to 3; with one opponent left no choice is offered", () => {
  const t = researchBoard(3);
  playCard(t.engine, P1, t.id("ri"), { players: { opponent: P2 } });
  drive(t.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { selected: pc.playerId === P1 ? [] : offeredCards(t.engine).slice(0, 1) } : undefined));
  assert.equal(deckOf(t.engine, P1).filter((id) => zoneOf(t.engine, id) === "play").length, 0);
  assert.equal(t.engine.state.players[P2]!.play.filter((id) => t.engine.isResource(id)).length, 1);
  const u = researchBoard(3);
  eliminate(u.engine, P3);
  expectNotAsked(u, { type: "playCard", playerId: P1, cardId: u.id("ri") });
  playCard(u.engine, P1, u.id("ri"));
  const asked = drive(u.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { selected: [] } : undefined));
  assert.deepEqual(asked.map((a) => a.playerId), [P1, P2]);
});

// --- Tremor Engine -----------------------------------------------------------------------------
// At the start of your turn, both players must put the top 2 cards of their deck into their discard pile.

const TREMOR = "f58d1a64-ffe6-44e6-a0fb-7fee920c215d";

function tremorBoard(count: number) {
  const seats = seatsFor(count);
  return seatTable(
    count,
    [{ key: "te", def: printing(TREMOR), owner: P1, zone: "play" }, ...seats.flatMap((who) => fill(`d${who}`, 8, who, "deck"))],
    { activePlayerId: seats[count - 1]!, turn: count }
  );
}
/** The active player ends their turn; the next turn's start-of-turn prompts are answered (trigger order: first listed; anything else by `answerFor`). */
const endTurnOf = (t: ReturnType<typeof seatTable>, answerFor: Parameters<typeof drive>[1] = () => undefined) => {
  t.engine.perform({ type: "endTurn", playerId: t.engine.state.activePlayerId } as never);
  return drive(t.engine, (pc) => (pc.kind === "orderTriggers" ? { next: (pc as unknown as { triggers: unknown[] }).triggers[0] } : answerFor(pc)));
};

for (const count of TABLES) {
  clause(TREMOR, "0:rule", `${count} seats: at the start of the controller's turn the controller and the chosen opponent (and only they) mill 2; no other turn start triggers it`, () => {
    for (const chosen of choices(count)) {
      const t = tremorBoard(count);
      const decks = Object.fromEntries(t.seats.map((who) => [who, [...deckOf(t.engine, who)]]));
      const asked = endTurnOf(t, (pc) => {
        if (pc.kind !== "choosePlayer") return undefined;
        assert.equal(pc.playerId, P1);
        assert.deepEqual(candidatesOf(t.engine), opponentsAt(count));
        return { playerId: chosen };
      });
      assert.equal(t.engine.state.activePlayerId, P1);
      assert.deepEqual(asked.filter((a) => a.kind === "choosePlayer").map((a) => a.playerId), [P1], "the opponent is chosen by the controller when the trigger resolves");
      assert.deepEqual(discardOf(t.engine, P1), decks[P1]!.slice(0, 2), "the controller mills the top 2 of their own deck");
      assert.deepEqual(discardOf(t.engine, chosen), decks[chosen]!.slice(0, 2), "the chosen opponent mills the top 2 of theirs");
      for (const who of others(count, chosen)) assert.deepEqual(deckOf(t.engine, who), decks[who], `${who}'s deck is untouched`);
      // the next turn starts (an opponent's) do not trigger it
      endTurnOf(t);
      assert.notEqual(t.engine.state.activePlayerId, P1);
      assert.equal(pendingOf(t.engine), undefined);
      assert.equal(discardOf(t.engine, P1).length, 2);
    }
  });
}

clause(TREMOR, "0:rule", "3 seats: with one opponent left no choice is offered and that opponent mills with the controller", () => {
  const t = tremorBoard(3);
  eliminate(t.engine, P3);
  const decks = { [P1]: [...deckOf(t.engine, P1)], [P2]: [...deckOf(t.engine, P2)] };
  t.engine.state.activePlayerId = P2;
  const asked = endTurnOf(t);
  assert.equal(t.engine.state.activePlayerId, P1);
  assert.ok(!asked.some((a) => a.kind === "choosePlayer"), "nobody is asked");
  assert.deepEqual(discardOf(t.engine, P1), decks[P1].slice(0, 2));
  assert.deepEqual(discardOf(t.engine, P2), decks[P2].slice(0, 2));
});

// --- shared helpers for the lasting-text cards ------------------------------------------------

/** Ends turns (answering every start-of-turn prompt: trigger order first listed, anything else declined) until `who` is the active player. */
function advanceTo(t: ReturnType<typeof seatTable>, who: string): void {
  for (let guard = 0; guard < 8 && t.engine.state.activePlayerId !== who; guard++) {
    t.engine.perform({ type: "endTurn", playerId: t.engine.state.activePlayerId } as never);
    drive(t.engine, (pc) => (pc.kind === "orderTriggers" ? { next: (pc as unknown as { triggers: unknown[] }).triggers[0] } : undefined));
  }
  assert.equal(t.engine.state.activePlayerId, who);
}

/** P1 plays `key` and answers the lasting text's opponent selection with `chosen`; returns the prompts asked. */
function playAndSelect(t: ReturnType<typeof seatTable>, key: string, chosen: string) {
  playCard(t.engine, P1, t.id(key));
  return drive(t.engine, (pc) => {
    if (pc.kind !== "choosePlayer") return undefined;
    assert.equal(pc.playerId, P1, "the controller selects");
    assert.deepEqual(candidatesOf(t.engine), opponentsAt(t.seats.length), "every opponent is offered");
    return { playerId: chosen };
  });
}

const facedown = (who: string, n: number, prefix = `fd${who}`) =>
  Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: resourceCard({ name: `FD ${who} ${i}` }), owner: who, zone: "play" as const, faceDown: true }));

// --- The Ministry of Other Smaller Ministries ---------------------------------------------------
// Your opponent must pay 2 for each attacking party they form.

const MINISTRY = "c8f335c2-c065-4e48-befe-ce99752073f1";

function ministryBoard(count: number, p2Resources = 4) {
  return seatTable(count, [
    { key: "mm", def: printing(MINISTRY), owner: P1, zone: "hand" },
    ...bank("greed", 6, P1),
    ...opponentsAt(count).flatMap((who) => [
      { key: `a${who}`, def: character({ name: `Attacker ${who}` }), owner: who, zone: "play" as const },
      { key: `b${who}`, def: character({ name: `Attacker2 ${who}` }), owner: who, zone: "play" as const },
      ...bank("greed", who === P2 ? p2Resources : 4, who)
    ]),
    { key: "mine", def: character({ name: "MineAttacker" }), owner: P1, zone: "play" },
    { key: "raze", def: tactic({ name: "Raze", cost: 0, behavior: { abilities: [{ id: "r", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P1, zone: "hand" }
  ]);
}

for (const count of TABLES) {
  clause(MINISTRY, "0:rule", `${count} seats: only the selected opponent pays 2 per attacking party; the others and the controller attack free`, () => {
    for (const chosen of choices(count)) {
      for (const attacker of opponentsAt(count)) {
        const t = ministryBoard(count);
        playAndSelect(t, "mm", chosen);
        advanceTo(t, attacker);
        const before = ready(t.engine, attacker);
        t.engine.perform({ type: "declareAttack", playerId: attacker, attackerIds: [t.id(`a${attacker}`)], target: { type: "faction", playerId: P1 } } as never);
        assert.equal(before - ready(t.engine, attacker), attacker === chosen ? 2 : 0, `${attacker} ${attacker === chosen ? "pays 2 for the party" : "attacks for free"}`);
      }
    }
  });

  clause(MINISTRY, "0:rule", `${count} seats: the controller's own parties cost nothing, and the selected opponent with too few ready resources cannot form a party`, () => {
    const t = ministryBoard(count, 1);
    playAndSelect(t, "mm", P2);
    const mine = ready(t.engine, P1);
    t.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [t.id("mine")], target: { type: "faction", playerId: P2 } } as never);
    assert.equal(ready(t.engine, P1), mine, "the controller pays nothing");
    const u = ministryBoard(count, 1);
    playAndSelect(u, "mm", P2);
    advanceTo(u, P2);
    refused(() => u.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [u.id(`a${P2}`)], target: { type: "faction", playerId: P1 } } as never), "P2 cannot pay 2 with one ready resource");
  });

  clause(MINISTRY, "0:rule", `${count} seats: when the selected opponent is eliminated the controller selects again; when the card leaves play nobody pays`, () => {
    const t = ministryBoard(count);
    playAndSelect(t, "mm", P2);
    eliminate(t.engine, P2);
    if (count === 4) {
      assert.equal(pendingOf(t.engine)?.kind, "choosePlayer");
      assert.deepEqual(candidatesOf(t.engine), [P3, P4]);
      answer(t.engine, "choosePlayer", { playerId: P4 });
    } else assert.equal(pendingOf(t.engine), undefined);
    const payer = count === 4 ? P4 : P3;
    advanceTo(t, payer);
    const before = ready(t.engine, payer);
    t.engine.perform({ type: "declareAttack", playerId: payer, attackerIds: [t.id(`a${payer}`)], target: { type: "faction", playerId: P1 } } as never);
    assert.equal(before - ready(t.engine, payer), 2, "the newly selected opponent pays");
    const u = ministryBoard(count);
    playAndSelect(u, "mm", P2);
    playCard(u.engine, P1, u.id("raze"), { selected: { t: [u.id("mm")] } });
    drive(u.engine, () => undefined);
    assert.equal(zoneOf(u.engine, u.id("mm")), "discard", "the Ministry left play");
    advanceTo(u, P2);
    const free = ready(u.engine, P2);
    u.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [u.id(`a${P2}`)], target: { type: "faction", playerId: P1 } } as never);
    assert.equal(ready(u.engine, P2), free, "nobody pays once the Ministry has left play");
  });
}

// --- The Billionaire ---------------------------------------------------------------------------
// You may use abilities on your opponent's cards as though you were your opponent. (The effect still happens to your opponent.)

const BILLIONAIRE = "2ec131a8-26eb-4dd7-914d-ced1ca9e770c";
const gadget = (name: string) =>
  item({
    name,
    behavior: { abilities: [{ id: "zap", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount: -2 }] }] }
  });

function billionaireBoard(count: number) {
  return seatTable(count, [
    { key: "bl", def: printing(BILLIONAIRE), owner: P1, zone: "hand" },
    ...bank("deception", 8, P1),
    ...opponentsAt(count).map((who) => ({ key: `g${who}`, def: gadget(`Gadget ${who}`), owner: who, zone: "play" as const }))
  ]);
}

for (const count of TABLES) {
  clause(BILLIONAIRE, "1:rule", `${count} seats: only the selected opponent's cards are usable, and the effect happens to that opponent`, () => {
    for (const chosen of choices(count)) {
      const t = billionaireBoard(count);
      playAndSelect(t, "bl", chosen);
      for (const who of others(count, chosen)) refused(() => activate(t.engine, P1, t.id(`g${who}`), "zap"), `${who}'s card is not usable`);
      const before = Object.fromEntries(t.seats.map((who) => [who, influenceOf(t.engine, who)]));
      activate(t.engine, P1, t.id(`g${chosen}`), "zap");
      drive(t.engine, () => undefined);
      assert.equal(before[chosen]! - influenceOf(t.engine, chosen), 2, "the effect happens to the selected opponent, as though P1 were them");
      assert.equal(influenceOf(t.engine, P1), before[P1], "the Billionaire's controller is untouched");
    }
  });
}

clause(BILLIONAIRE, "1:rule", "3 seats: when the selected opponent is eliminated the controller selects again (only one is left, so nobody is asked) and that opponent's cards become usable; when the card leaves play nothing is usable", () => {
  const t = billionaireBoard(3);
  playAndSelect(t, "bl", P2);
  eliminate(t.engine, P2);
  assert.equal(pendingOf(t.engine), undefined);
  const before = influenceOf(t.engine, P3);
  activate(t.engine, P1, t.id(`g${P3}`), "zap");
  drive(t.engine, () => undefined);
  assert.equal(before - influenceOf(t.engine, P3), 2);
  const u = billionaireBoard(3);
  playAndSelect(u, "bl", P2);
  u.engine.perform({ type: "activateAbility", playerId: P1, cardId: u.id("bl"), abilityId: "costume", selected: {}, variables: {}, players: {} } as never);
  drive(u.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { selected: [] } : undefined));
  assert.notEqual(zoneOf(u.engine, u.id("bl")), "play", "Change Costume shuffled the Billionaire away");
  refused(() => activate(u.engine, P1, u.id(`g${P2}`), "zap"), "nothing is usable once it has left play");
});

// --- Slingerang --------------------------------------------------------------------------------
// 0: This card enters play with 3 tokens on it.
// 1: If your opponent plays a character, you may remove a token from this card.
// 2: CHEAP SHOT -- COST: Use this only if no tokens are on this card and only if your opponent played a character this turn. Destroy this card. Pick a character.

const SLINGERANG = "93ebda5d-c273-4c97-a5c2-29202057b6e0";

function slingBoard(count: number, active = P1, tokens = 3) {
  return seatTable(
    count,
    [
      { key: "sg", def: printing(SLINGERANG), owner: P1, zone: "play", counters: { token: tokens } },
      ...bank("elitism", 4, P1),
      { key: "mineC", def: character({ name: "MineChar", cost: 0 }), owner: P1, zone: "hand" },
      ...opponentsAt(count).flatMap((who) => [
        { key: `c${who}`, def: character({ name: `Char ${who}`, cost: 0 }), owner: who, zone: "hand" as const },
        { key: `i${who}`, def: item({ name: `Item ${who}`, cost: 0 }), owner: who, zone: "hand" as const },
        { key: `p${who}`, def: character({ name: `InPlay ${who}` }), owner: who, zone: "play" as const }
      ])
    ],
    { activePlayerId: active }
  );
}
const tokensOf = (t: ReturnType<typeof seatTable>) => t.engine.state.cards[t.id("sg")]!.counters?.token ?? 0;

clause(SLINGERANG, "0:rule", "3 seats: it enters play with exactly 3 tokens, whatever the table size", () => {
  for (const count of TABLES) {
    const t = seatTable(count, [{ key: "sg", def: printing(SLINGERANG), owner: P1, zone: "hand" }, ...bank("elitism", 4, P1)]);
    playCard(t.engine, P1, t.id("sg"));
    const asked = drive(t.engine, () => undefined);
    assert.equal(tokensOf(t), 3);
    assert.equal(asked.length, 0, "no player is asked anything");
  }
});

for (const count of TABLES) {
  clause(SLINGERANG, "1:rule", `${count} seats: any opponent's character play triggers it with no opponent choice; other plays do not`, () => {
    for (const player of opponentsAt(count)) {
      for (const accept of [true, false]) {
        const t = slingBoard(count, player);
        playCard(t.engine, player, t.id(`c${player}`));
        const asked = drive(t.engine, (pc) => {
          if (pc.kind === "choosePlayer") assert.fail("nobody is asked to choose an opponent");
          if (pc.kind !== "chooserSelectsOption") return undefined;
          assert.equal(pc.playerId, P1, "the controller decides");
          const options = (pc as unknown as { options: { label: string }[] }).options;
          return { index: options.findIndex((o) => accept === /Remove/.test(o.label)) };
        });
        assert.ok(asked.some((a) => a.kind === "chooserSelectsOption" && a.playerId === P1), `${player}'s character triggers it`);
        assert.equal(tokensOf(t), accept ? 2 : 3);
      }
    }
  });

  clause(SLINGERANG, "1:rule", `${count} seats: an opponent's non-character play and the controller's own character play do not trigger it`, () => {
    const opp = opponentsAt(count)[0]!;
    const t = slingBoard(count, opp);
    playCard(t.engine, opp, t.id(`i${opp}`));
    const asked = drive(t.engine, () => undefined);
    assert.equal(asked.length, 0, "an item does not trigger it");
    assert.equal(tokensOf(t), 3);
    const own = slingBoard(count, P1);
    playCard(own.engine, P1, own.id("mineC"));
    assert.equal(drive(own.engine, () => undefined).length, 0, "the controller's own character does not trigger it");
    assert.equal(tokensOf(own), 3);
  });
}

clause(SLINGERANG, "1:rule", "3 seats: with an opponent eliminated only the other opponent's plays trigger it", () => {
  const t = slingBoard(3, P2);
  eliminate(t.engine, P3);
  playCard(t.engine, P2, t.id(`c${P2}`));
  const asked = drive(t.engine, (pc) => (pc.kind === "chooserSelectsOption" ? { index: 1 } : undefined));
  assert.ok(asked.some((a) => a.playerId === P1));
  assert.equal(tokensOf(t), 2);
});

/** After an opponent's play: declines Slingerang's watch prompt and passes every player before P1, so P1 holds priority in the play's response window. */
function toPriorityOfP1(t: ReturnType<typeof seatTable>): void {
  for (let guard = 0; guard < 12; guard++) {
    const pc = pendingOf(t.engine);
    if (pc) {
      assert.equal(pc.kind, "chooserSelectsOption");
      t.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsOption", index: 0 } } as never);
      continue;
    }
    const window = t.engine.state.responseWindow!;
    if (window.priorityPlayerId === P1) return;
    t.engine.perform({ type: "passPriority", playerId: window.priorityPlayerId } as never);
  }
  throw new Error("P1 never got priority");
}

for (const count of TABLES) {
  clause(SLINGERANG, "2:ability:cheapshot", `${count} seats: the selected opponent must be one who played a character this turn`, () => {
    const opps = opponentsAt(count);
    const played = opps[0]!;
    const idle = opps[opps.length - 1]!;
    const make = () => {
      const t = slingBoard(count, played, 0);
      playCard(t.engine, played, t.id(`c${played}`));
      toPriorityOfP1(t);
      return t;
    };
    const action = (t: ReturnType<typeof seatTable>) => ({ type: "activateAbility", playerId: P1, cardId: t.id("sg"), abilityId: "cheapshot" });
    const ok = make();
    expectOpponentAsked(ok, action(ok));
    activate(ok.engine, P1, ok.id("sg"), "cheapshot", { players: { opponent: played }, selected: { c: [ok.id(`p${idle}`)] } });
    drive(ok.engine, () => undefined);
    assert.equal(zoneOf(ok.engine, ok.id("sg")), "discard", "destroyed itself");
    assert.equal(zoneOf(ok.engine, ok.id(`p${idle}`)), "discard", "and the picked character");
    const bad = make();
    refused(() => activate(bad.engine, P1, bad.id("sg"), "cheapshot", { players: { opponent: idle }, selected: { c: [bad.id(`p${idle}`)] } }), `${idle} did not play a character this turn`);
    assert.equal(zoneOf(bad.engine, bad.id("sg")), "play");
  });
}

clause(SLINGERANG, "2:ability:cheapshot", "3 seats: it cannot be used while tokens remain, nor when no opponent played a character; with one opponent left nobody is asked", () => {
  const tokens = slingBoard(3, P2, 1);
  playCard(tokens.engine, P2, tokens.id(`c${P2}`));
  toPriorityOfP1(tokens);
  refused(() => activate(tokens.engine, P1, tokens.id("sg"), "cheapshot", { players: { opponent: P2 }, selected: { c: [tokens.id(`p${P3}`)] } }), "a token is still on it");
  const idle = slingBoard(3, P2, 0);
  refused(() => activate(idle.engine, P1, idle.id("sg"), "cheapshot", { players: { opponent: P2 }, selected: { c: [idle.id(`p${P3}`)] } }), "nobody played a character this turn");
  const one = slingBoard(3, P2, 0);
  playCard(one.engine, P2, one.id(`c${P2}`));
  toPriorityOfP1(one);
  eliminate(one.engine, P3);
  expectNotAsked(one, { type: "activateAbility", playerId: P1, cardId: one.id("sg"), abilityId: "cheapshot" });
  activate(one.engine, P1, one.id("sg"), "cheapshot", { selected: { c: [one.id(`p${P2}`)] } });
  drive(one.engine, () => undefined);
  assert.equal(zoneOf(one.engine, one.id("sg")), "discard");
});

// --- battle helpers ---------------------------------------------------------------------------

/** Passes priority for every player ahead of `who` in the open response window until `who` holds it. */
function toPriority(t: ReturnType<typeof seatTable>, who: string): void {
  for (let guard = 0; guard < 12; guard++) {
    const window = t.engine.state.responseWindow;
    assert.ok(window, "a response window is open");
    if (window.priorityPlayerId === who) return;
    t.engine.perform({ type: "passPriority", playerId: window.priorityPlayerId } as never);
  }
  throw new Error(`${who} never got priority`);
}

// --- Sarcophyle Matriculation ------------------------------------------------------------------
// COST: Play this only when you are being attacked. Pick a character your opponent controls.
// EFFECT: If the character would be destroyed during this battle, instead put it into play under your control, depleted.

const SARCOPHYLE = "e53172ad-eba1-453f-949d-910e4aba0bd6";

function sarcophyleBoard(count: number) {
  return seatTable(
    count,
    [
      { key: "sm", def: printing(SARCOPHYLE), owner: P1, zone: "hand" },
      ...bank("deception", 6, P1),
      { key: "blk", def: character({ name: "Blk", strength: 3, life: 6, speed: 2 }), owner: P1, zone: "play" },
      ...opponentsAt(count).flatMap((who) => [
        { key: `atk${who}`, def: character({ name: `Atk ${who}`, strength: 3, life: 2, speed: 3 }), owner: who, zone: "play" as const },
        { key: `by${who}`, def: character({ name: `Bystander ${who}`, strength: 1, life: 3, speed: 1 }), owner: who, zone: "play" as const }
      ])
    ],
    { activePlayerId: P2 }
  );
}

for (const count of TABLES) {
  clause(SARCOPHYLE, "0:ability", `${count} seats: no opponent choice; the attacking player is the opponent and only that player's characters can be picked`, () => {
    for (const attacker of opponentsAt(count)) {
      const t = sarcophyleBoard(count);
      t.engine.state.activePlayerId = attacker;
      t.engine.perform({ type: "declareAttack", playerId: attacker, attackerIds: [t.id(`atk${attacker}`)], target: { type: "faction", playerId: P1 } } as never);
      toPriority(t, P1);
      const action = { type: "playCard", playerId: P1, cardId: t.id("sm") };
      expectNotAsked(t, action);
      const pick = t.engine.getPlayRequirements(action as never).find((n) => (n as { kind: string }).kind === "pick") as unknown as { candidates: string[] };
      assert.deepEqual([...pick.candidates].sort(), [`atk${attacker}`, `by${attacker}`].map(t.id).sort(), "only the attacking player's characters are offered");
      for (const who of opponentsAt(count).filter((o) => o !== attacker)) {
        refused(() => playCard(t.engine, P1, t.id("sm"), { selected: { c: [t.id(`atk${who}`)] } }), `${who} is not P1's opponent in this battle`);
      }
      playCard(t.engine, P1, t.id("sm"), { selected: { c: [t.id(`atk${attacker}`)] } });
      passAround(t.engine);
    }
  });

  clause(SARCOPHYLE, "0:ability", `${count} seats: the picked attacker destroyed in the battle enters play under the controller's control, depleted, as a sarcophyle; other characters are not saved`, () => {
    const attacker = opponentsAt(count)[opponentsAt(count).length - 1]!;
    const t = sarcophyleBoard(count);
    t.engine.state.activePlayerId = attacker;
    t.engine.perform({ type: "declareAttack", playerId: attacker, attackerIds: [t.id(`atk${attacker}`)], target: { type: "faction", playerId: P1 } } as never);
    toPriority(t, P1);
    playCard(t.engine, P1, t.id("sm"), { selected: { c: [t.id(`atk${attacker}`)] } });
    passAround(t.engine);
    // the battle goes on: P1 blocks and the attacker is killed
    t.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [t.id("blk")] } as never);
    autoResolveBattle(t.engine);
    const id = t.id(`atk${attacker}`);
    assert.equal(zoneOf(t.engine, id), "play", "it was not destroyed");
    assert.equal(t.engine.state.cards[id]!.controllerId, P1, "it is under P1's control");
    assert.equal(t.engine.state.cards[id]!.depleted, true);
    assert.ok(t.engine.getSubtypes(id).includes("sarcophyle"));
    for (const who of opponentsAt(count).filter((o) => o !== attacker)) assert.equal(t.engine.state.cards[t.id(`atk${who}`)]!.controllerId, who, `${who}'s characters are untouched`);
  });
}

clause(SARCOPHYLE, "0:ability", "3 seats: it cannot be played when P1 is not being attacked", () => {
  const t = sarcophyleBoard(3);
  t.engine.state.activePlayerId = P1;
  refused(() => playCard(t.engine, P1, t.id("sm"), { selected: { c: [t.id(`atk${P2}`)] } }), "only when you are being attacked");
  const other = sarcophyleBoard(3);
  other.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [other.id(`atk${P2}`)], target: { type: "faction", playerId: P3 } } as never);
  toPriority(other, P1);
  refused(() => playCard(other.engine, P1, other.id("sm"), { selected: { c: [other.id(`atk${P2}`)] } }), "P3 is being attacked, not P1");
});

// --- Snake Eyes --------------------------------------------------------------------------------
// COST: Pick a character. EFFECT: If the character has received damage this turn, destroy it. Draw a card.

const SNAKE = "3e04b4b1-a534-458f-b98b-626d045e3c17";

for (const count of TABLES) {
  clause(SNAKE, "0:ability", `${count} seats: any character can be picked, and damage from any source this turn makes it destroyed`, () => {
    const t = seatTable(count, [
      { key: "se", def: printing(SNAKE), owner: P1, zone: "hand" },
      ...bank("deception", 4, P1),
      ...fill("mine", 3, P1, "deck"),
      { key: "own", def: character({ name: "Own" }), owner: P1, zone: "play" },
      { key: "ping", def: tactic({ name: "Ping", cost: 0, behavior: { abilities: [{ id: "p", type: "activated", targets: [{ id: "t", selector: { type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }] }] } }), owner: P1, zone: "hand" },
      ...opponentsAt(count).flatMap((who) => [
        { key: `hurt${who}`, def: character({ name: `Hurt ${who}`, life: 5 }), owner: who, zone: "play" as const },
        { key: `well${who}`, def: character({ name: `Well ${who}`, life: 5 }), owner: who, zone: "play" as const }
      ])
    ]);
    const needs = t.engine.getPlayRequirements({ type: "playCard", playerId: P1, cardId: t.id("se") } as never);
    const pick = needs.find((n) => (n as { kind: string }).kind === "pick") as unknown as { candidates: string[] };
    assert.ok(pick.candidates.includes(t.id("own")) && opponentsAt(count).every((who) => pick.candidates.includes(t.id(`hurt${who}`))), "any character may be picked");
    expectNotAsked(t, { type: "playCard", playerId: P1, cardId: t.id("se") });
    const target = opponentsAt(count)[opponentsAt(count).length - 1]!;
    playCard(t.engine, P1, t.id("ping"), { selected: { t: [t.id(`hurt${target}`)] } });
    drive(t.engine, () => undefined);
    assert.equal(t.engine.state.cards[t.id(`hurt${target}`)]!.damage, 1, "it received damage this turn");
    playCard(t.engine, P1, t.id("se"), { selected: { c: [t.id(`hurt${target}`)] } });
    drive(t.engine, () => undefined);
    assert.equal(zoneOf(t.engine, t.id(`hurt${target}`)), "discard", "a character damaged this turn is destroyed");
    assert.equal(zoneOf(t.engine, t.id("mine0")), "hand", "the caster draws");
    const u = seatTable(count, [{ key: "se", def: printing(SNAKE), owner: P1, zone: "hand" }, ...bank("deception", 4, P1), ...fill("mine", 3, P1, "deck"), { key: "well", def: character({ name: "Well", life: 5 }), owner: P2, zone: "play" }]);
    playCard(u.engine, P1, u.id("se"), { selected: { c: [u.id("well")] } });
    drive(u.engine, () => undefined);
    assert.equal(zoneOf(u.engine, u.id("well")), "play", "an undamaged character is not destroyed");
    assert.equal(zoneOf(u.engine, u.id("mine0")), "hand", "but the caster still draws");
  });
}


clause(MOLESTATION, "0:rule", "4 seats: the chosen opponent gets no response window; the other two are offered it clockwise and then it resolves", () => {
  for (const chosen of [P2, P3, P4]) {
    const t = molestation(4, { p2: [cost(2)], p3: [cost(2)], p4: [cost(2)] });
    assert.deepEqual(playerRequirement(t.engine, { type: "playCard", playerId: P1, cardId: t.id("dm") })?.[0], { id: "opponent", candidates: [P2, P3, P4] });
    playCard(t.engine, P1, t.id("dm"), { players: { opponent: chosen } });
    const passers = passAround(t.engine);
    assert.deepEqual(passers, [P2, P3, P4].filter((who) => who !== chosen), `the two other opponents are offered the window in turn order; ${chosen} never is`);
    assert.equal(pendingOf(t.engine)?.playerId, chosen, "then the chosen opponent must discard");
  }
});
