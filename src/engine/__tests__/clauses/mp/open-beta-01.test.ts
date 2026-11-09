// Multiplayer clause tests: Open Beta, group A. Each test is written from the card's PRINTED text and the spec in
// data/card-tests/mp-spec/open-beta.json (its `test3` / `test4` line): a real 3- or 4-seat game, real actions through
// `perform`, asserting that the chosen / affected opponent IS affected and the other opponents are NOT.

import assert from "node:assert/strict";
import { character, developFaction, item, resourceCard, tactic } from "../../per-card/_harness.js";
import { clause, clauseMismatch, printing, refused } from "../_clause.js";
import {
  activate,
  answer,
  bank,
  candidatesOf,
  choices,
  deckOf,
  discardOf,
  drive,
  eliminate,
  expectNotAsked,
  expectOpponentAsked,
  fill,
  handOf,
  influenceOf,
  offeredCards,
  opponentsAt,
  P1,
  P2,
  P3,
  P4,
  passAround,
  pendingOf,
  playCard,
  ready,
  seatsFor,
  seatTable,
  zoneOf,
  type CardPlacement,
  type SeatTable
} from "./_mpSeats.js";

const TABLES = [3, 4] as const;
/** The opponents of P1 other than `chosen`. */
const others = (count: number, chosen: string) => [P2, P3, P4].slice(0, count - 1).filter((who) => who !== chosen);

/** Ends turns (trigger order: the first listed; every other prompt left open) until `who` is the active player. */
function advanceTo(t: SeatTable, who: string): void {
  for (let guard = 0; guard < 8 && t.engine.state.activePlayerId !== who; guard++) {
    t.engine.perform({ type: "endTurn", playerId: t.engine.state.activePlayerId } as never);
    drive(t.engine, (pc) => (pc.kind === "orderTriggers" ? { next: (pc as unknown as { triggers: unknown[] }).triggers[0] } : undefined));
  }
  assert.equal(t.engine.state.activePlayerId, who);
}

/** The cards a `getPlayRequirements` pick step offers for `action` (after the player choice it needs). */
function pickCandidates(t: SeatTable, action: Record<string, unknown>): string[] {
  const needs = t.engine.getPlayRequirements(action as never);
  const pick = needs.find((n) => (n as { kind: string }).kind === "pick") as unknown as { candidates: string[] } | undefined;
  assert.ok(pick, "a pick is required");
  return pick.candidates;
}

// --- Arcanist's Almanac ----------------------------------------------------------------------------
// FORESIGHT -- COST: Deplete this card. -- EFFECT: Look at the top 5 cards of either deck and put them back in any order.

const ALMANAC = "f09cc7b1-96fd-47e5-946d-324962b9efe9";

function almanacBoard(count: number) {
  return seatTable(count, [
    { key: "al", def: printing(ALMANAC), owner: P1, zone: "play" },
    ...seatsFor(count).flatMap((who) => fill(`d${who}`, 6, who, "deck"))
  ]);
}
const factionOf = (t: SeatTable, who: string) => t.engine.state.players[who]!.factionId!;

for (const count of TABLES) {
  clause(ALMANAC, "0:ability:almanac-foresight", `${count} seats: the opponent is chosen before targets and only the caster's and the chosen opponent's decks are offered`, () => {
    for (const chosen of choices(count)) {
      const t = almanacBoard(count);
      const action = { type: "activateAbility", playerId: P1, cardId: t.id("al"), abilityId: "almanac-foresight" };
      expectOpponentAsked(t, action);
      const offered = pickCandidates(t, { ...action, players: { opponent: chosen } });
      assert.deepEqual([...offered].sort(), [factionOf(t, P1), factionOf(t, chosen)].sort(), "exactly two decks: the caster's and the chosen opponent's");
      for (const who of others(count, chosen)) refused(() => activate(t.engine, P1, t.id("al"), "almanac-foresight", { players: { opponent: chosen }, selected: { deckOwner: [factionOf(t, who)] } }), `${who}'s deck is not offered`);
      assert.equal(t.engine.state.cards[t.id("al")]!.depleted, false, "a refused attempt depletes nothing");
    }
  });

  clause(ALMANAC, "0:ability:almanac-foresight", `${count} seats: the chosen opponent's deck can be looked at and reordered; no other deck changes zone or order`, () => {
    for (const chosen of choices(count)) {
      const t = almanacBoard(count);
      const decks = Object.fromEntries(t.seats.map((who) => [who, [...deckOf(t.engine, who)]]));
      activate(t.engine, P1, t.id("al"), "almanac-foresight", { players: { opponent: chosen }, selected: { deckOwner: [factionOf(t, chosen)] } });
      assert.equal(t.engine.state.cards[t.id("al")]!.depleted, true, "the cost is depleting the card");
      drive(t.engine, (pc) => {
        if (pc.kind !== "reorderDeck") return undefined;
        const ids = (pc as unknown as { cardIds: string[] }).cardIds;
        assert.deepEqual([...ids].sort(), decks[chosen]!.slice(0, 5).sort(), "the top 5 cards of the chosen opponent's deck");
        return { order: [...ids].reverse() };
      });
      assert.deepEqual(deckOf(t.engine, chosen).slice(0, 5), [...decks[chosen]!.slice(0, 5)].reverse());
      assert.equal(deckOf(t.engine, chosen).length, 6, "nothing changed zone");
      for (const who of t.seats.filter((seat) => seat !== chosen)) assert.deepEqual(deckOf(t.engine, who), decks[who], `${who}'s deck is untouched`);
    }
  });

  clause(ALMANAC, "0:ability:almanac-foresight", `${count} seats: the caster's own deck can be picked from the same two`, () => {
    const chosen = opponentsAt(count)[opponentsAt(count).length - 1]!;
    const t = almanacBoard(count);
    const decks = Object.fromEntries(t.seats.map((who) => [who, [...deckOf(t.engine, who)]]));
    activate(t.engine, P1, t.id("al"), "almanac-foresight", { players: { opponent: chosen }, selected: { deckOwner: [factionOf(t, P1)] } });
    drive(t.engine, (pc) => (pc.kind === "reorderDeck" ? { order: [...(pc as unknown as { cardIds: string[] }).cardIds].reverse() } : undefined));
    assert.deepEqual(deckOf(t.engine, P1).slice(0, 5), [...decks[P1]!.slice(0, 5)].reverse());
    for (const who of opponentsAt(count)) assert.deepEqual(deckOf(t.engine, who), decks[who]);
  });
}

clause(ALMANAC, "0:ability:almanac-foresight", "3 seats: with one opponent left no opponent choice is offered and the decks offered are the caster's and that opponent's", () => {
  const t = almanacBoard(3);
  eliminate(t.engine, P3);
  const action = { type: "activateAbility", playerId: P1, cardId: t.id("al"), abilityId: "almanac-foresight" };
  expectNotAsked(t, action);
  assert.deepEqual([...pickCandidates(t, action)].sort(), [factionOf(t, P1), factionOf(t, P2)].sort());
});

// --- Ashes of Zenobia ------------------------------------------------------------------------------
// NULLIFY -- COST: Pay 5. -- EFFECT: Both players must put a character they control into its owner's hand.

const ASHES = "b3c323b0-c7ea-4970-a286-92df7d2fe2f3";

function ashesBoard(count: number, active = P1) {
  return seatTable(
    count,
    [
      { key: "az", def: printing(ASHES), owner: P1, zone: "play" },
      ...bank("obsession", 8, P1),
      ...seatsFor(count).flatMap((who) => fill(`c${who}`, 2, who, "play"))
    ],
    { activePlayerId: active }
  );
}

for (const count of TABLES) {
  clause(ASHES, "2:ability:nullify", `${count} seats: the controller and the chosen opponent (and only they) each put a character they control into its owner's hand, the controller first`, () => {
    for (const chosen of choices(count)) {
      const t = ashesBoard(count);
      expectOpponentAsked(t, { type: "activateAbility", playerId: P1, cardId: t.id("az"), abilityId: "nullify" });
      const before = ready(t.engine, P1);
      activate(t.engine, P1, t.id("az"), "nullify", { players: { opponent: chosen } });
      assert.equal(before - ready(t.engine, P1), 5, "NULLIFY costs 5");
      const asked = drive(t.engine, (pc) => {
        if (pc.kind !== "chooserSelectsTarget") return undefined;
        const offered = offeredCards(t.engine);
        assert.ok(offered.length === 2 && offered.every((id) => t.engine.state.cards[id]!.controllerId === pc.playerId), "each player chooses among the characters they control");
        return { selected: [offered[0]!] };
      });
      assert.deepEqual(asked.map((a) => a.playerId), [P1, chosen], "P1 (the active player) first, then the chosen opponent, and nobody else");
      for (const who of [P1, chosen]) assert.equal(handOf(t.engine, who).length, 1, `${who} put one character into their hand`);
      for (const who of others(count, chosen)) {
        assert.equal(handOf(t.engine, who).length, 0, `${who} puts nothing back`);
        assert.equal(t.engine.state.players[who]!.play.filter((id) => t.engine.getDefinition(id).type === "character").length, 2, `${who}'s characters all stay in play`);
      }
    }
  });
}

clause(ASHES, "2:ability:nullify", "3 seats: with one opponent left no choice is offered and that opponent is the other player", () => {
  const u = ashesBoard(3);
  eliminate(u.engine, P3);
  expectNotAsked(u, { type: "activateAbility", playerId: P1, cardId: u.id("az"), abilityId: "nullify" });
  activate(u.engine, P1, u.id("az"), "nullify");
  const asked2 = drive(u.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { selected: [offeredCards(u.engine)[0]!] } : undefined));
  assert.deepEqual(asked2.map((a) => a.playerId), [P1, P2]);
});

// --- Spastic Tentacles -----------------------------------------------------------------------------
// When this card enters play, both players must put a resource they control into its owner's hand.

const TENTACLES = "9b955719-5c5a-4401-8a40-d41c7390829e";

function tentaclesBoard(count: number) {
  return seatTable(count, [
    { key: "st", def: printing(TENTACLES), owner: P1, zone: "hand" },
    ...bank("obsession", 6, P1),
    ...opponentsAt(count).flatMap((who) => bank("greed", 3, who))
  ]);
}
const resourcesOf = (t: SeatTable, who: string) => t.engine.state.players[who]!.play.filter((id) => t.engine.getDefinition(id).type === "resource");

for (const count of TABLES) {
  clause(TENTACLES, "0:rule", `${count} seats: the opponent is chosen when the trigger resolves; only the controller and that opponent each put a resource into hand`, () => {
    for (const chosen of choices(count)) {
      const t = tentaclesBoard(count);
      const before = Object.fromEntries(t.seats.map((who) => [who, resourcesOf(t, who).length]));
      playCard(t.engine, P1, t.id("st"));
      const asked = drive(t.engine, (pc) => {
        if (pc.kind === "choosePlayer") {
          assert.equal(pc.playerId, P1, "the controller selects");
          assert.deepEqual(candidatesOf(t.engine), opponentsAt(count));
          return { playerId: chosen };
        }
        if (pc.kind !== "chooserSelectsTarget") return undefined;
        const offered = offeredCards(t.engine);
        assert.ok(offered.length > 0 && offered.every((id) => t.engine.state.cards[id]!.controllerId === pc.playerId && t.engine.getDefinition(id).type === "resource"), "own resources only");
        return { selected: [offered[0]!] };
      });
      assert.deepEqual(asked.map((a) => `${a.kind}:${a.playerId}`), ["choosePlayer:p1", "chooserSelectsTarget:p1", `chooserSelectsTarget:${chosen}`], "P1 chooses, then P1 and only the chosen opponent put a resource back");
      assert.equal(zoneOf(t.engine, t.id("st")), "play", "Spastic Tentacles entered play");
      for (const who of [P1, chosen]) {
        assert.equal(resourcesOf(t, who).length, before[who]! - 1, `${who} returned one resource`);
        assert.equal(handOf(t.engine, who).length, 1);
      }
      for (const who of others(count, chosen)) {
        assert.equal(resourcesOf(t, who).length, before[who], `${who}'s resources stay in play`);
        assert.ok(!asked.some((a) => a.playerId === who), `${who} makes no choice`);
      }
    }
  });
}

clause(TENTACLES, "0:rule", "3 seats: with one opponent left no choice is offered and that opponent is the other player", () => {
  const t = tentaclesBoard(3);
  eliminate(t.engine, P3);
  playCard(t.engine, P1, t.id("st"));
  const asked = drive(t.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { selected: [offeredCards(t.engine)[0]!] } : undefined));
  assert.ok(!asked.some((a) => a.kind === "choosePlayer"), "nobody is asked to choose");
  assert.deepEqual(asked.map((a) => a.playerId), [P1, P2]);
});

// --- Free Trade Agreement --------------------------------------------------------------------------
// At the start of each player's turn, that player must pick one of the following:
// OPTION 1 -- That player may draw a card and their opponent may play a resource.
// OPTION 2 -- That player may play a resource and their opponent may draw a card.
// OPTION 3 -- Both players may draw up to 2 cards.
// OPTION 4 -- Both players may play up to 2 resources.
// Text from the active player's point of view (MPQ-P10): the active player, not the card's controller, selects
// "their opponent" and "both players" is the active player and that opponent.

const FTA = "234559f8-329c-4c05-bc09-c34e087a4182";

/** FTA (P1's) in play; each seat has a deck and three resource cards in hand. The turn is the one before `actor`'s. */
function ftaBoard(count: number, actor: string, eliminated: string[] = []) {
  const seats = seatsFor(count);
  const before = seats[(seats.indexOf(actor) + count - 1) % count]!;
  const t = seatTable(
    count,
    [
      { key: "fta", def: printing(FTA), owner: P1, zone: "play" },
      ...seats.flatMap((who) => [...fill(`dk${who}`, 6, who, "deck"), ...fill(`rs${who}`, 3, who, "hand", (i) => resourceCard({ name: `Res ${who} ${i}` }))])
    ],
    { activePlayerId: before }
  );
  for (const who of eliminated) eliminate(t.engine, who);
  return t;
}

interface FtaRun {
  /** `kind:player` of every prompt, in order. */
  asked: string[];
  /** Candidate lists of the opponent selection, if it was asked. */
  candidates: string[][];
}

/**
 * Ends the turn before `actor`'s, so that `actor`'s turn starts and the agreement triggers. Answers: trigger order first
 * listed; the opponent selection `chosen`; the option `option` (index); every "may" yes; the first card of every pick.
 */
function ftaTurn(t: SeatTable, actor: string, option: number, chosen: string | undefined): FtaRun {
  const run: FtaRun = { asked: [], candidates: [] };
  t.engine.perform({ type: "endTurn", playerId: t.engine.state.activePlayerId } as never);
  drive(t.engine, (pc) => {
    if (pc.kind === "orderTriggers") return { next: (pc as unknown as { triggers: unknown[] }).triggers[0] };
    run.asked.push(`${pc.kind}:${pc.playerId}`);
    if (pc.kind === "choosePlayer") {
      run.candidates.push(candidatesOf(t.engine));
      assert.ok(chosen, "no opponent selection was expected");
      return { playerId: chosen };
    }
    if (pc.kind === "chooserSelectsOption") return { index: option };
    if (pc.kind === "mayPay") return { pay: true };
    if (pc.kind === "chooserSelectsTarget") {
      const offered = offeredCards(t.engine);
      const mine = pc.declaration?.id === "h";
      const count = (pc as unknown as { declaration: { count: number } }).declaration.count;
      return { selected: mine ? offered.slice(0, count) : [offered[0]!] };
    }
    return undefined;
  });
  assert.equal(t.engine.state.activePlayerId, actor);
  return run;
}

const handSize = (t: SeatTable, who: string) => handOf(t.engine, who).length;
const resourcesIn = (t: SeatTable, who: string) => t.engine.state.players[who]!.play.filter((id) => t.engine.getDefinition(id).type === "resource").length;
const candidatesFor = (count: number, actor: string) => seatsFor(count).filter((who) => who !== actor).sort();

for (const count of TABLES) {
  clause(FTA, "0:rule", `${count} seats: the trigger fires at the start of every player's turn, the controller's too, and the active player is always the one who selects and picks`, () => {
    const t = ftaBoard(count, P2);
    const seats = seatsFor(count);
    for (let i = 1; i <= count; i++) {
      const actor = seats[i % count]!;
      const run = ftaTurn(t, actor, 2, candidatesFor(count, actor)[0]);
      assert.ok(run.asked.includes(`choosePlayer:${actor}`), `${actor} selects their own opponent: ${run.asked.join(" ")}`);
      assert.ok(run.asked.includes(`chooserSelectsOption:${actor}`), `${actor} picks the option`);
      assert.ok(run.asked.every((entry) => entry.endsWith(`:${actor}`) || entry.startsWith("mayPay")), `nobody but ${actor} chooses (the other pair member only draws): ${run.asked.join(" ")}`);
      assert.deepEqual(run.candidates.map((c) => [...c].sort()), [candidatesFor(count, actor)], `${actor}'s own opponents are offered, ${actor} excluded`);
    }
  });
}

clause(FTA, "0:rule", "4 seats: when P3 is eliminated the trigger no longer fires for a P3 turn and the other three turns still do", () => {
  const t = ftaBoard(4, P2, [P3]);
  assert.equal(t.engine.state.players[P3]!.eliminated !== undefined, true);
  for (const actor of [P2, P4, P1]) {
    const run = ftaTurn(t, actor, 2, actor === P1 ? P2 : P1);
    assert.ok(run.asked.includes(`chooserSelectsOption:${actor}`), `${actor}'s turn start triggers the agreement`);
    assert.ok(run.candidates[0] !== undefined && !run.candidates[0].includes(P3), "the eliminated seat is never offered");
  }
});

for (const count of TABLES) {
  clause(FTA, "1:option:OPTION 1", `${count} seats: that player draws and only the opponent that player selected may play a resource`, () => {
    const actor = P2;
    for (const chosen of [candidatesFor(count, actor)[0]!, candidatesFor(count, actor).slice(-1)[0]!]) {
      const t = ftaBoard(count, actor);
      const before = Object.fromEntries(t.seats.map((who) => [who, { hand: handSize(t, who), res: resourcesIn(t, who) }]));
      const run = ftaTurn(t, actor, 0, chosen);
      assert.ok(run.candidates.length >= 1 && run.candidates.every((c) => JSON.stringify([...c].sort()) === JSON.stringify(candidatesFor(count, actor))), "the active player selects among all their opponents, the controller included");
      assert.equal(handSize(t, actor), before[actor]!.hand + 1, "the active player drew a card");
      assert.equal(resourcesIn(t, chosen), before[chosen]!.res + 1, "the selected opponent played a resource");
      const plays = run.asked.filter((entry) => entry.startsWith("chooserSelectsTarget"));
      assert.deepEqual(plays, [`chooserSelectsTarget:${chosen}`], "only the selected opponent is offered the resource play");
      for (const who of t.seats.filter((seat) => seat !== actor && seat !== chosen)) {
        assert.equal(resourcesIn(t, who), before[who]!.res, `${who} plays no resource`);
        assert.equal(handSize(t, who), before[who]!.hand, `${who}'s hand is unchanged`);
      }
    }
  });
}

// With a single opponent left for the active player, "their opponent" is that one player and nobody is asked.
for (const count of TABLES) {
  for (const [index, label, key] of [[0, "OPTION 1", "1:option:OPTION 1"], [1, "OPTION 2", "2:option:OPTION 2"]] as const) {
    clauseMismatch(FTA, key, "MP-open-beta-11", `${count} seats: ${label} names "their opponent" once: the active player is asked to select exactly one opponent for the block`, () => {
      const t = ftaBoard(count, P2);
      const run = ftaTurn(t, P2, index, P1);
      assert.equal(run.candidates.length, 1, `one selection prompt, not ${run.candidates.length}`);
    });
  }
}

for (const [seats, eliminated] of [[3, [P3]], [2, []]] as const) {
  clause(FTA, "1:option:OPTION 1", `${seats} seats: with one opponent left the active player's opponent is bound without asking and is the other player, not the active player`, () => {
    const t = ftaBoard(seats, P2, [...eliminated]);
    const before = { hand2: handSize(t, P2), res1: resourcesIn(t, P1), res2: resourcesIn(t, P2) };
    const run = ftaTurn(t, P2, 0, undefined);
    assert.deepEqual(run.candidates, [], "nobody is asked to select");
    assert.equal(handSize(t, P2), before.hand2 + 1, "P2 drew a card");
    assert.equal(resourcesIn(t, P2), before.res2, "P2 (the active player) does not play the opponent's resource");
    assert.equal(resourcesIn(t, P1), before.res1 + 1, "P1, the only opponent of P2 left, played the resource");
  });

  clause(FTA, "2:option:OPTION 2", `${seats} seats: with one opponent left the active player's opponent is bound without asking and is the other player, not the active player`, () => {
    const t = ftaBoard(seats, P2, [...eliminated]);
    const before = { hand1: handSize(t, P1), hand2: handSize(t, P2), res2: resourcesIn(t, P2) };
    const run = ftaTurn(t, P2, 1, undefined);
    assert.deepEqual(run.candidates, [], "nobody is asked to select");
    assert.equal(resourcesIn(t, P2), before.res2 + 1, "P2 played a resource");
    assert.equal(handSize(t, P2), before.hand2 - 1, "P2 only lost the resource it played and does not draw the opponent's card");
    assert.equal(handSize(t, P1), before.hand1 + 1, "P1, the only opponent of P2 left, drew");
  });
}

for (const [seats, eliminated] of [[3, [P3]], [2, []]] as const) {
  clause(FTA, "3:option:OPTION 3", `${seats} seats: with one opponent left both players are the active player and that opponent, each drawing up to 2`, () => {
    const t = ftaBoard(seats, P2, [...eliminated]);
    const before = { p1: handSize(t, P1), p2: handSize(t, P2) };
    const run = ftaTurn(t, P2, 2, undefined);
    assert.deepEqual(run.candidates, [], "nobody is asked to select");
    assert.deepEqual(run.asked.filter((entry) => entry.startsWith("mayPay")), ["mayPay:p2", "mayPay:p2", "mayPay:p1", "mayPay:p1"]);
    assert.equal(handSize(t, P2), before.p2 + 2);
    assert.equal(handSize(t, P1), before.p1 + 2);
  });

  clause(FTA, "4:option:OPTION 4", `${seats} seats: with one opponent left both players are the active player and that opponent, each playing up to 2 resources`, () => {
    const t = ftaBoard(seats, P2, [...eliminated]);
    const before = { p1: resourcesIn(t, P1), p2: resourcesIn(t, P2) };
    const run = ftaTurn(t, P2, 3, undefined);
    assert.deepEqual(run.candidates, []);
    assert.deepEqual(run.asked.filter((entry) => entry.startsWith("chooserSelectsTarget")), ["chooserSelectsTarget:p2", "chooserSelectsTarget:p1"]);
    assert.equal(resourcesIn(t, P2), before.p2 + 2);
    assert.equal(resourcesIn(t, P1), before.p1 + 2);
  });
}

for (const count of TABLES) {
  clause(FTA, "2:option:OPTION 2", `${count} seats: that player plays a resource and only the opponent that player selected may draw`, () => {
    const actor = P3;
    for (const chosen of [candidatesFor(count, actor)[0]!, candidatesFor(count, actor).slice(-1)[0]!]) {
      const t = ftaBoard(count, actor);
      const before = Object.fromEntries(t.seats.map((who) => [who, { hand: handSize(t, who), res: resourcesIn(t, who) }]));
      const run = ftaTurn(t, actor, 1, chosen);
      assert.equal(resourcesIn(t, actor), before[actor]!.res + 1, "the active player played a resource");
      assert.equal(handSize(t, chosen), before[chosen]!.hand + 1, "the selected opponent drew a card");
      assert.ok(run.asked.includes(`mayPay:${chosen}`), "the selected opponent is offered the draw");
      for (const who of t.seats.filter((seat) => seat !== actor && seat !== chosen)) {
        assert.equal(handSize(t, who), before[who]!.hand, `${who} draws nothing`);
        assert.ok(!run.asked.some((entry) => entry.endsWith(`:${who}`)), `${who} is offered nothing`);
      }
    }
  });
}

for (const count of TABLES) {
  clause(FTA, "3:option:OPTION 3", `${count} seats: both players, the active player and the selected opponent only, may draw up to 2 cards, the active player first`, () => {
    const actor = P2;
    for (const chosen of [candidatesFor(count, actor)[0]!, candidatesFor(count, actor).slice(-1)[0]!]) {
      const t = ftaBoard(count, actor);
      const before = Object.fromEntries(t.seats.map((who) => [who, handSize(t, who)]));
      const run = ftaTurn(t, actor, 2, chosen);
      const draws = run.asked.filter((entry) => entry.startsWith("mayPay")).map((entry) => entry.split(":")[1]);
      assert.deepEqual(draws, [actor, actor, chosen, chosen], "the active player first, then the selected opponent, two draws each");
      assert.equal(handSize(t, actor), before[actor]! + 2);
      assert.equal(handSize(t, chosen), before[chosen]! + 2);
      for (const who of t.seats.filter((seat) => seat !== actor && seat !== chosen)) assert.equal(handSize(t, who), before[who], `${who} draws nothing`);
    }
  });
}

for (const count of TABLES) {
  clause(FTA, "4:option:OPTION 4", `${count} seats: both players, the active player and the selected opponent only, may play up to 2 resources, the active player first`, () => {
    const actor = P3;
    for (const chosen of [candidatesFor(count, actor)[0]!, candidatesFor(count, actor).slice(-1)[0]!]) {
      const t = ftaBoard(count, actor);
      const before = Object.fromEntries(t.seats.map((who) => [who, resourcesIn(t, who)]));
      const run = ftaTurn(t, actor, 3, chosen);
      const plays = run.asked.filter((entry) => entry.startsWith("chooserSelectsTarget")).map((entry) => entry.split(":")[1]);
      assert.deepEqual(plays, [actor, chosen], "the active player first, then the selected opponent");
      assert.equal(resourcesIn(t, actor), before[actor]! + 2);
      assert.equal(resourcesIn(t, chosen), before[chosen]! + 2);
      for (const who of t.seats.filter((seat) => seat !== actor && seat !== chosen)) assert.equal(resourcesIn(t, who), before[who], `${who} plays none`);
    }
  });
}

// --- Emergency Obfuscation -------------------------------------------------------------------------
// While this card is in play, both players switch seats. Both players are in control of their opponent's side. If the
// game ends, the owner of the winning deck wins the game.
// MPQ-P1: the controller and the one opponent selected when the card enters play switch; nobody else moves.

const OBFUSCATION = "1999770c-5f2d-415d-8da1-8efe44ef3e41";
const SMASH = tactic({
  name: "Smash",
  cost: 0,
  behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
});
const SIDE_TAKER = tactic({
  name: "Side Taker",
  cost: 0,
  behavior: { abilities: [{ id: "x", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount: -99 }] }] }
});

function obfuscationBoard(count: number, extra: CardPlacement[] = []) {
  return seatTable(count, [
    { key: "eo", def: printing(OBFUSCATION), owner: P1, zone: "hand" },
    { key: "smash", def: SMASH, owner: P1, zone: "hand" },
    { key: "taker", def: SIDE_TAKER, owner: P1, zone: "hand" },
    ...bank("deception", 8, P1),
    ...seatsFor(count).flatMap((who) => [{ key: `c${who}`, def: character({ name: `Char ${who}` }), owner: who, zone: "play" as const }]),
    ...extra
  ]);
}
const controllerOf = (t: SeatTable, key: string) => t.engine.state.cards[t.id(key)]!.controllerId;
const factionOwner = (t: SeatTable, who: string) => t.engine.state.cards[t.engine.state.players[who]!.factionId!]!.ownerId;

/** P1 plays the Obfuscation; when it enters play P1 is offered every other player and selects `chosen`. */
function swapWith(t: SeatTable, chosen: string): void {
  playCard(t.engine, P1, t.id("eo"));
  passAround(t.engine);
  const pc = pendingOf(t.engine)!;
  assert.equal(pc.kind, "choosePlayer", "the opponent is selected when the card enters play");
  assert.equal(pc.playerId, P1);
  assert.deepEqual(candidatesOf(t.engine), opponentsAt(t.seats.length), "every other player is offered");
  answer(t.engine, "choosePlayer", { playerId: chosen });
  passAround(t.engine);
  assert.equal(pendingOf(t.engine), undefined);
}

for (const count of TABLES) {
  for (const chosen of opponentsAt(count)) {
    clause(OBFUSCATION, "1:rule", `${count} seats: choosing ${chosen}, P1 and ${chosen} exchange sides (cards in play and factions); every other player keeps theirs`, () => {
      const t = obfuscationBoard(count);
      swapWith(t, chosen);
      for (const seat of t.seats) {
        const swappedSeat = seat === P1 || seat === chosen;
        const partner = seat === P1 ? chosen : P1;
        assert.equal(controllerOf(t, `c${seat}`), swappedSeat ? partner : seat, `${seat}'s character is controlled by ${swappedSeat ? partner : seat}`);
        assert.equal(factionOwner(t, seat), swappedSeat ? partner : seat, `${seat} now holds the faction of ${swappedSeat ? partner : seat}`);
      }
    });

    clause(OBFUSCATION, "1:rule", `${count} seats: the two exchange places in the seat order, nobody else moves, and the turn order follows the new seats`, () => {
      const t = obfuscationBoard(count);
      swapWith(t, chosen);
      const expected = t.seats.map((seat) => (seat === P1 ? chosen : seat === chosen ? P1 : seat));
      assert.deepEqual(t.engine.getSeats(), expected, "only the two entries are exchanged");
      t.engine.perform({ type: "endTurn", playerId: P1 } as never);
      drive(t.engine, (pc) => (pc.kind === "orderTriggers" ? { next: (pc as unknown as { triggers: unknown[] }).triggers[0] } : undefined));
      assert.equal(t.engine.state.activePlayerId, expected[(expected.indexOf(P1) + 1) % count], "the turn goes to the seat after P1's new place");
    });

    clause(OBFUSCATION, "1:rule", `${count} seats: when the card leaves play the two switch back, seats and control`, () => {
      const t = obfuscationBoard(count);
      swapWith(t, chosen);
      playCard(t.engine, P1, t.id("smash"), { selected: { t: [t.id("eo")] } });
      drive(t.engine, () => undefined);
      assert.equal(zoneOf(t.engine, t.id("eo")), "discard", "the Obfuscation was destroyed");
      assert.deepEqual(t.engine.getSeats(), t.seats);
      assert.equal(t.engine.state.seatSwap, undefined);
      for (const seat of t.seats) {
        assert.equal(controllerOf(t, `c${seat}`), seat);
        assert.equal(factionOwner(t, seat), seat);
      }
    });
  }

  clause(OBFUSCATION, "1:rule", `${count} seats: if the game ends the owner of the faction that reached 0 loses, not the player controlling that side; the controller then selects a new opponent`, () => {
    const t = obfuscationBoard(count);
    swapWith(t, P2);
    // P1 now controls P2's faction: taking it to 0 costs its owner, P2, the game
    playCard(t.engine, P1, t.id("taker"));
    passAround(t.engine);
    assert.ok(t.engine.state.players[P2]!.eliminated, "P2 owned the faction that reached 0 and loses");
    assert.equal(t.engine.state.players[P1]!.eliminated, undefined, "P1, who controlled that side, does not");
    const left = t.seats.filter((seat) => seat !== P1 && seat !== P2);
    if (count === 4) {
      assert.equal(pendingOf(t.engine)?.kind, "choosePlayer", "two opponents are left: the controller selects again");
      assert.deepEqual(candidatesOf(t.engine), left);
      answer(t.engine, "choosePlayer", { playerId: P4 });
    } else {
      assert.equal(pendingOf(t.engine), undefined, "one opponent left: the swap moves to them without asking");
    }
    const now = count === 4 ? P4 : P3;
    assert.equal(controllerOf(t, `c${P1}`), now, "P1's side now sits with the new opponent");
    assert.equal(controllerOf(t, `c${now}`), P1);
    assert.equal(factionOwner(t, P1), now);
    for (const seat of left.filter((s) => s !== now)) assert.equal(controllerOf(t, `c${seat}`), seat, `${seat} is untouched`);
  });
}

clause(OBFUSCATION, "1:rule", "3 seats: with one opponent left before it enters play no choice is offered and the swap is P1 and that opponent", () => {
  const t = obfuscationBoard(3);
  eliminate(t.engine, P3);
  playCard(t.engine, P1, t.id("eo"));
  passAround(t.engine);
  assert.equal(pendingOf(t.engine), undefined, "nobody is asked");
  assert.equal(controllerOf(t, `c${P1}`), P2);
  assert.equal(controllerOf(t, `c${P2}`), P1);
  assert.equal(factionOwner(t, P1), P2);
});

// --- Knobby Stave --------------------------------------------------------------------------------
// This card enters play with 2 tokens on it. -- DISRUPT -- COST: Remove 2 tokens from this card. -- EFFECT: Your opponent must discard a card.

const STAVE = "bb153366-ff1b-44f8-8e82-f005d31120a2";

function staveBoard(count: number) {
  return seatTable(count, [
    { key: "ks", def: printing(STAVE), owner: P1, zone: "play", counters: { token: 2 } },
    ...opponentsAt(count).flatMap((who) => fill(`h${who}`, 3, who, "hand"))
  ]);
}

for (const count of TABLES) {
  clause(STAVE, "1:ability:disrupt", `${count} seats: only the chosen opponent chooses and discards a card, the others are untouched and never asked`, () => {
    for (const chosen of choices(count)) {
      const t = staveBoard(count);
      const action = { type: "activateAbility", playerId: P1, cardId: t.id("ks"), abilityId: "disrupt" };
      expectOpponentAsked(t, action);
      activate(t.engine, P1, t.id("ks"), "disrupt", { players: { opponent: chosen } });
      assert.equal(t.engine.state.cards[t.id("ks")]!.counters?.token ?? 0, 0, "2 tokens were removed");
      const mine = [0, 1, 2].map((i) => t.id(`h${chosen}${i}`));
      const asked = drive(t.engine, (pc) => {
        if (pc.kind !== "chooserSelectsTarget") return undefined;
        assert.deepEqual([...offeredCards(t.engine)].sort(), [...mine].sort(), "the chosen opponent picks among their own hand");
        return { selected: [mine[1]!] };
      });
      assert.deepEqual(asked.map((a) => a.playerId), [chosen], "the chosen opponent chooses the discard");
      assert.equal(zoneOf(t.engine, mine[1]!), "discard");
      for (const who of others(count, chosen)) assert.equal(handOf(t.engine, who).length, 3, `${who}'s hand is unchanged`);
    }
  });
}

clause(STAVE, "1:ability:disrupt", "3 seats: with one opponent left no choice is offered and that opponent discards", () => {
  const t = staveBoard(3);
  eliminate(t.engine, P3);
  expectNotAsked(t, { type: "activateAbility", playerId: P1, cardId: t.id("ks"), abilityId: "disrupt" });
  activate(t.engine, P1, t.id("ks"), "disrupt");
  const asked = drive(t.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { selected: [offeredCards(t.engine)[0]!] } : undefined));
  assert.deepEqual(asked.map((a) => a.playerId), [P2]);
});

// --- Swarm of Gnats ------------------------------------------------------------------------------
// When this card enters or leaves play, your opponent must discard a card.

const GNATS = "a082e30f-1c66-46ff-97fa-77ca89b0076f";
const SMASH_CHAR = tactic({
  name: "Smash Character",
  cost: 0,
  behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
});

function gnatsBoard(count: number) {
  return seatTable(count, [
    { key: "sg", def: printing(GNATS), owner: P1, zone: "hand" },
    { key: "smash", def: SMASH_CHAR, owner: P1, zone: "hand" },
    ...bank("obsession", 8, P1),
    ...opponentsAt(count).flatMap((who) => fill(`h${who}`, 4, who, "hand"))
  ]);
}

/** Answers the opponent selection with `chosen` and the discard with the first card; returns what was asked. */
const gnatDrive = (t: SeatTable, chosen: string | undefined) =>
  drive(t.engine, (pc) => {
    if (pc.kind === "choosePlayer") {
      assert.equal(pc.playerId, P1);
      assert.deepEqual(candidatesOf(t.engine), opponentsAt(t.seats.length));
      return { playerId: chosen };
    }
    if (pc.kind !== "chooserSelectsTarget") return undefined;
    assert.ok(offeredCards(t.engine).every((id) => t.engine.state.cards[id]!.ownerId === pc.playerId), "own hand only");
    return { selected: [offeredCards(t.engine)[0]!] };
  });

for (const count of TABLES) {
  clause(GNATS, "0:rule", `${count} seats: entering play, the opponent is chosen and only they discard; leaving play, a fresh choice is made (it is not remembered)`, () => {
    const opps = opponentsAt(count);
    const first = opps[0]!;
    const last = opps[opps.length - 1]!;
    const t = gnatsBoard(count);
    playCard(t.engine, P1, t.id("sg"));
    const entering = gnatDrive(t, first);
    assert.deepEqual(entering.map((a) => `${a.kind}:${a.playerId}`), ["choosePlayer:p1", `chooserSelectsTarget:${first}`]);
    assert.equal(handOf(t.engine, first).length, 3);
    for (const who of others(count, first)) assert.equal(handOf(t.engine, who).length, 4, `${who} did not discard on entering`);
    playCard(t.engine, P1, t.id("smash"), { selected: { t: [t.id("sg")] } });
    const leaving = gnatDrive(t, last);
    assert.equal(zoneOf(t.engine, t.id("sg")), "discard");
    assert.deepEqual(leaving.map((a) => `${a.kind}:${a.playerId}`), ["choosePlayer:p1", `chooserSelectsTarget:${last}`], "a new selection is offered on leaving");
    assert.equal(handOf(t.engine, last).length, 3);
    assert.equal(handOf(t.engine, first).length, last === first ? 2 : 3, "the first opponent discards only once");
    for (const who of others(count, last).filter((w) => w !== first)) assert.equal(handOf(t.engine, who).length, 4);
  });

  clause(GNATS, "0:rule", `${count} seats: choosing the same player both times is allowed and the two choices are independent`, () => {
    const chosen = opponentsAt(count)[0]!;
    const t = gnatsBoard(count);
    playCard(t.engine, P1, t.id("sg"));
    gnatDrive(t, chosen);
    playCard(t.engine, P1, t.id("smash"), { selected: { t: [t.id("sg")] } });
    const leaving = gnatDrive(t, chosen);
    assert.ok(leaving.some((a) => a.kind === "choosePlayer"), "asked again");
    assert.equal(handOf(t.engine, chosen).length, 2, "discarded once on entering, once on leaving");
  });
}

clause(GNATS, "0:rule", "3 seats: with one opponent left nobody is asked and that opponent discards entering and leaving", () => {
  const t = gnatsBoard(3);
  eliminate(t.engine, P3);
  playCard(t.engine, P1, t.id("sg"));
  const entering = gnatDrive(t, undefined);
  assert.deepEqual(entering.map((a) => a.kind), ["chooserSelectsTarget"]);
  playCard(t.engine, P1, t.id("smash"), { selected: { t: [t.id("sg")] } });
  const leaving = gnatDrive(t, undefined);
  assert.deepEqual(leaving.map((a) => a.playerId), [P2]);
  assert.equal(handOf(t.engine, P2).length, 2);
});

// --- Ritual of the Screaming Cheese ---------------------------------------------------------------
// 0: Your opponent must pick one of the following: -- 1: They discard 2 cards. -- 2: They discard a card at random.

const CHEESE = "0f2fc8b5-c078-4ccb-b7c1-8c34b62413e4";

function cheeseBoard(count: number, random?: () => number) {
  return seatTable(
    count,
    [{ key: "rc", def: printing(CHEESE), owner: P1, zone: "hand" }, ...bank("obsession", 4, P1), ...opponentsAt(count).flatMap((who) => fill(`h${who}`, 3, who, "hand"))],
    random ? { random } : {}
  );
}

for (const count of TABLES) {
  clause(CHEESE, "0:rule", `${count} seats: only the chosen opponent picks the option, no other opponent is offered a pick`, () => {
    for (const chosen of choices(count)) {
      const t = cheeseBoard(count);
      expectOpponentAsked(t, { type: "playCard", playerId: P1, cardId: t.id("rc") });
      playCard(t.engine, P1, t.id("rc"), { players: { opponent: chosen } });
      const asked = drive(t.engine, (pc) => (pc.kind === "chooserSelectsOption" ? { index: 1 } : undefined));
      assert.deepEqual(asked.map((a) => `${a.kind}:${a.playerId}`), [`chooserSelectsOption:${chosen}`], "the chosen opponent, and only they, pick");
    }
  });

  clause(CHEESE, "1:option:OPTION 1", `${count} seats: picking OPTION 1 the chosen opponent chooses and discards 2 cards; the others' hands are unchanged`, () => {
    for (const chosen of choices(count)) {
      const t = cheeseBoard(count);
      playCard(t.engine, P1, t.id("rc"), { players: { opponent: chosen } });
      const asked = drive(t.engine, (pc) => {
        if (pc.kind === "chooserSelectsOption") return { index: 0 };
        if (pc.kind !== "chooserSelectsTarget") return undefined;
        assert.ok(offeredCards(t.engine).every((id) => t.engine.state.cards[id]!.ownerId === chosen), "their own hand only");
        return { selected: offeredCards(t.engine).slice(0, 2) };
      });
      assert.deepEqual(asked.map((a) => a.playerId), [chosen, chosen]);
      assert.equal(handOf(t.engine, chosen).length, 1);
      assert.equal(discardOf(t.engine, chosen).length, 2);
      for (const who of others(count, chosen)) assert.equal(handOf(t.engine, who).length, 3, `${who}'s hand is unchanged`);
    }
  });

  clause(CHEESE, "2:option:OPTION 2", `${count} seats: picking OPTION 2 one card at random is discarded from the chosen opponent's hand only`, () => {
    for (const chosen of choices(count)) {
      const t = cheeseBoard(count, () => 0.5);
      playCard(t.engine, P1, t.id("rc"), { players: { opponent: chosen } });
      drive(t.engine, (pc) => (pc.kind === "chooserSelectsOption" ? { index: 1 } : undefined));
      assert.equal(handOf(t.engine, chosen).length, 2, "one card was discarded at random");
      assert.equal(discardOf(t.engine, chosen).length, 1);
      for (const who of others(count, chosen)) {
        assert.equal(handOf(t.engine, who).length, 3, `${who}'s hand is unchanged`);
        assert.equal(discardOf(t.engine, who).length, 0);
      }
    }
  });
}

clause(CHEESE, "0:rule", "3 seats: with one opponent left no choice is offered and that opponent picks", () => {
  const t = cheeseBoard(3);
  eliminate(t.engine, P3);
  expectNotAsked(t, { type: "playCard", playerId: P1, cardId: t.id("rc") });
  playCard(t.engine, P1, t.id("rc"));
  const asked = drive(t.engine, (pc) => (pc.kind === "chooserSelectsOption" ? { index: 1 } : undefined));
  assert.deepEqual(asked.map((a) => a.playerId), [P2]);
});

// --- Downsizing -----------------------------------------------------------------------------------
// Destroy all characters. Your opponent's faction gains X influence, where X is the number of characters destroyed.

const DOWNSIZING = "43425eec-287e-44b7-8bff-60c2b58feb9f";

function downsizingBoard(count: number) {
  return seatTable(count, [
    { key: "dn", def: printing(DOWNSIZING), owner: P1, zone: "hand" },
    ...bank("greed", 12, P1),
    ...seatsFor(count).flatMap((who) => fill(`c${who}`, 2, who, "play"))
  ]);
}

for (const count of TABLES) {
  clause(DOWNSIZING, "0:rule", `${count} seats: every character of every player is destroyed, and only the chosen opponent's faction gains X`, () => {
    for (const chosen of choices(count)) {
      const t = downsizingBoard(count);
      expectOpponentAsked(t, { type: "playCard", playerId: P1, cardId: t.id("dn") });
      const before = Object.fromEntries(t.seats.map((who) => [who, influenceOf(t.engine, who)]));
      playCard(t.engine, P1, t.id("dn"), { players: { opponent: chosen } });
      drive(t.engine, () => undefined);
      for (const who of t.seats) for (const i of [0, 1]) assert.equal(zoneOf(t.engine, t.id(`c${who}${i}`)), "discard", `${who}'s characters are destroyed`);
      assert.equal(influenceOf(t.engine, chosen) - before[chosen]!, 2 * count, `X is every character destroyed, ${2 * count}`);
      for (const who of [P1, ...others(count, chosen)]) assert.equal(influenceOf(t.engine, who), before[who], `${who}'s faction is unchanged`);
    }
  });
}

clause(DOWNSIZING, "0:rule", "3 seats: with one opponent left no choice is offered and that faction gains X", () => {
  const t = downsizingBoard(3);
  eliminate(t.engine, P3);
  expectNotAsked(t, { type: "playCard", playerId: P1, cardId: t.id("dn") });
  const before = influenceOf(t.engine, P2);
  const characters = t.seats.slice(0, 2).length * 2;
  playCard(t.engine, P1, t.id("dn"));
  drive(t.engine, () => undefined);
  assert.equal(influenceOf(t.engine, P2) - before, characters, "X counts the characters of P1 and P2 still in the game");
});

// --- Voidal Poisoning ----------------------------------------------------------------------------
// You may remove any number of tokens from cards you control. Use the tokens any way you want ...
// 1 TOKEN: Pick a character. Inflict 1 damage to that character. 2 TOKENS: Draw a card.
// 2 TOKENS: Your opponent must discard a card. 3 TOKENS: Search your deck for a card and put it into your hand.

const POISONING = "fed9a0cc-cd8d-4633-ba92-d05a94e6acda";
const DAMAGE_OPTION = 0;
const DRAW_OPTION = 1;
const DISCARD_OPTION = 2;
const SEARCH_OPTION = 3;

function poisoningBoard(count: number) {
  return seatTable(count, [
    { key: "vp", def: printing(POISONING), owner: P1, zone: "hand" },
    ...bank("obsession", 6, P1),
    { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play", counters: { token: 4 } },
    ...fill("dk1", 5, P1, "deck"),
    ...opponentsAt(count).flatMap((who) => [
      { key: `f${who}`, def: character({ name: `Foe ${who}`, life: 5 }), owner: who, zone: "play" as const, counters: { token: 3 } },
      { key: `g${who}`, def: item({ name: `Gizmo ${who}` }), owner: who, zone: "play" as const, counters: { token: 2 } },
      ...fill(`h${who}`, 4, who, "hand"),
      ...fill(`dk${who}`, 4, who, "deck")
    ])
  ]);
}
const menu = (t: SeatTable) => {
  const pc = pendingOf(t.engine) as unknown as { kind: string; playerId: string; options: { cost: number }[]; available: Record<string, number> };
  assert.equal(pc?.kind, "spendCountersMenu", "the token menu is open");
  assert.equal(pc.playerId, P1);
  return pc;
};
const spend = (t: SeatTable, option: number, sources: string[]) => answer(t.engine, "spendCountersMenu", { optionIndex: option, sources }, P1);
const stop = (t: SeatTable) => answer(t.engine, "spendCountersMenu", { optionIndex: null }, P1);
const tokensOn = (t: SeatTable, key: string) => t.engine.state.cards[t.id(key)]!.counters?.token ?? 0;

/** P1 plays Voidal Poisoning naming `chosen` at play and settles every response up to the token menu. */
function castPoisoning(t: SeatTable, chosen: string): void {
  expectOpponentAsked(t, { type: "playCard", playerId: P1, cardId: t.id("vp") });
  playCard(t.engine, P1, t.id("vp"), { players: { opponent: chosen } });
  passAround(t.engine);
}

for (const count of TABLES) {
  clause(POISONING, "0:rule", `${count} seats: tokens may be removed only from cards P1 controls: no opponent's card is offered, whichever opponent was chosen at play`, () => {
    for (const chosen of choices(count)) {
      const t = poisoningBoard(count);
      castPoisoning(t, chosen);
      const m = menu(t);
      assert.deepEqual(Object.keys(m.available), [t.id("mine")], "only P1's card with tokens is in the pool");
      for (const who of opponentsAt(count)) {
        refused(() => spend(t, DRAW_OPTION, [t.id(`f${who}`), t.id(`f${who}`)]), `${who}'s tokens cannot be used`);
        refused(() => spend(t, DRAW_OPTION, [t.id(`g${who}`), t.id(`g${who}`)]), `${who}'s item tokens cannot be used`);
      }
      assert.equal(tokensOn(t, "mine"), 4);
      stop(t);
      assert.equal(pendingOf(t.engine), undefined);
    }
  });

  clause(POISONING, "1:rule", `${count} seats: 1 token inflicts 1 damage to any picked character, the not-chosen opponent's included`, () => {
    const opps = opponentsAt(count);
    const chosen = opps[0]!;
    const victim = opps[opps.length - 1]!;
    const t = poisoningBoard(count);
    castPoisoning(t, chosen);
    spend(t, DAMAGE_OPTION, [t.id("mine")]);
    const pc = pendingOf(t.engine)!;
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P1);
    const offered = offeredCards(t.engine);
    for (const key of ["mine", ...opps.map((who) => `f${who}`)]) assert.ok(offered.includes(t.id(key)), `${key} may be picked`);
    pickCharacter(t, victim);
    assert.equal(t.engine.state.cards[t.id(`f${victim}`)]!.damage, 1, `${victim}'s character took 1 damage`);
    for (const key of ["mine", ...opps.filter((who) => who !== victim).map((who) => `f${who}`)]) assert.equal(t.engine.state.cards[t.id(key)]!.damage, 0, `${key} is undamaged`);
    stop(t);
  });

  clause(POISONING, "2:rule", `${count} seats: 2 tokens draw P1 a card; no opponent's hand or deck changes`, () => {
    const chosen = opponentsAt(count)[0]!;
    const t = poisoningBoard(count);
    const before = Object.fromEntries(opponentsAt(count).map((who) => [who, { hand: [...handOf(t.engine, who)], deck: [...deckOf(t.engine, who)] }]));
    const p1Hand = handOf(t.engine, P1).length;
    castPoisoning(t, chosen);
    spend(t, DRAW_OPTION, [t.id("mine"), t.id("mine")]);
    stop(t);
    assert.equal(handOf(t.engine, P1).length, p1Hand - 1 + 1, "the tactic left the hand and a card was drawn");
    assert.equal(tokensOn(t, "mine"), 2);
    for (const who of opponentsAt(count)) {
      assert.deepEqual(handOf(t.engine, who), before[who]!.hand, `${who}'s hand is unchanged`);
      assert.deepEqual(deckOf(t.engine, who), before[who]!.deck, `${who}'s deck is unchanged`);
    }
  });

  clause(POISONING, "3:rule", `${count} seats: the opponent chosen at play discards each time the 2-token effect is used, the same one every time, and nobody else does`, () => {
    for (const chosen of choices(count)) {
      const t = poisoningBoard(count);
      castPoisoning(t, chosen);
      const asked: string[] = [];
      for (let i = 0; i < 2; i++) {
        spend(t, DISCARD_OPTION, [t.id("mine"), t.id("mine")]);
        const pc = pendingOf(t.engine)!;
        assert.equal(pc.kind, "chooserSelectsTarget");
        asked.push(pc.playerId);
        assert.ok(offeredCards(t.engine).every((id) => t.engine.state.cards[id]!.ownerId === chosen), "the chosen opponent's own hand");
        answer(t.engine, "chooserSelectsTarget", { selected: [offeredCards(t.engine)[0]!] });
      }
      assert.equal(pendingOf(t.engine), undefined, "all 4 tokens are spent: no option is affordable and the menu ends");
      assert.deepEqual(asked, [chosen, chosen], "the same opponent both times");
      assert.equal(handOf(t.engine, chosen).length, 2);
      for (const who of others(count, chosen)) assert.equal(handOf(t.engine, who).length, 4, `${who}'s hand is unchanged`);
    }
  });

  clause(POISONING, "3:rule", `${count} seats: the opponent is chosen at play even if the 2-token effect is never used`, () => {
    const t = poisoningBoard(count);
    castPoisoning(t, opponentsAt(count)[0]!);
    spend(t, DRAW_OPTION, [t.id("mine"), t.id("mine")]);
    stop(t);
    for (const who of opponentsAt(count)) assert.equal(handOf(t.engine, who).length, 4);
    const u = poisoningBoard(count);
    refused(() => playCard(u.engine, P1, u.id("vp")), "naming no opponent is refused", /opponent/i);
  });

  clause(POISONING, "4:rule", `${count} seats: 3 tokens search P1's own deck; no opponent's deck is touched or shuffled`, () => {
    const chosen = opponentsAt(count)[0]!;
    const t = poisoningBoard(count);
    const before = Object.fromEntries(opponentsAt(count).map((who) => [who, [...deckOf(t.engine, who)]]));
    castPoisoning(t, chosen);
    spend(t, SEARCH_OPTION, [t.id("mine"), t.id("mine"), t.id("mine")]);
    const pc = pendingOf(t.engine)!;
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.ok(offeredCards(t.engine).every((id) => t.engine.state.cards[id]!.ownerId === P1), "P1's own deck only");
    answer(t.engine, "chooserSelectsTarget", { selected: [t.id("dk13")] });
    stop(t);
    assert.equal(zoneOf(t.engine, t.id("dk13")), "hand");
    for (const who of opponentsAt(count)) assert.deepEqual(deckOf(t.engine, who), before[who], `${who}'s deck is untouched`);
  });
}

function pickCharacter(t: SeatTable, owner: string): void {
  answer(t.engine, "chooserSelectsTarget", { selected: [t.id(`f${owner}`)] });
}

clause(POISONING, "3:rule", "3 seats: with one opponent left no choice is offered and that opponent discards", () => {
  const t = poisoningBoard(3);
  eliminate(t.engine, P3);
  expectNotAsked(t, { type: "playCard", playerId: P1, cardId: t.id("vp") });
  playCard(t.engine, P1, t.id("vp"));
  passAround(t.engine);
  spend(t, DISCARD_OPTION, [t.id("mine"), t.id("mine")]);
  assert.equal(pendingOf(t.engine)!.playerId, P2);
  answer(t.engine, "chooserSelectsTarget", { selected: [offeredCards(t.engine)[0]!] });
  stop(t);
  assert.equal(handOf(t.engine, P2).length, 3);
});

// --- Quotidian Misfire ----------------------------------------------------------------------------
// This turn, if a card would be put into a player's hand from anywhere, instead put it into that player's discard pile.

const MISFIRE = "ea372d50-f915-41fc-b170-267e0e430132";
const EVERYONE_DRAWS = tactic({
  name: "Everyone Draws",
  cost: 0,
  behavior: { abilities: [{ id: "e", type: "activated", effects: [{ type: "forEachPlayer", effects: [{ type: "draw", player: "controller", amount: 1 }] }] }] }
});
const DRAW_ONE = tactic({ name: "Draw One", cost: 0, behavior: { abilities: [{ id: "d", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });
const BOUNCE_ONE = tactic({
  name: "Bounce One",
  cost: 0,
  behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
});

function misfireBoard(count: number) {
  return seatTable(count, [
    { key: "qm", def: printing(MISFIRE), owner: P1, zone: "hand" },
    { key: "all", def: EVERYONE_DRAWS, owner: P1, zone: "hand" },
    { key: "bounce", def: BOUNCE_ONE, owner: P1, zone: "hand" },
    { key: "p2draw", def: DRAW_ONE, owner: P2, zone: "hand" },
    ...bank("obsession", 4, P1),
    ...seatsFor(count).flatMap((who) => [...fill(`dk${who}`, 5, who, "deck"), { key: `c${who}`, def: character({ name: `Char ${who}` }), owner: who, zone: "play" as const }])
  ]);
}

for (const count of TABLES) {
  clause(MISFIRE, "0:rule", `${count} seats: every player's draws, and any card returned to a hand, go to that player's own discard pile this turn; nothing enters any hand`, () => {
    const t = misfireBoard(count);
    expectNotAsked(t, { type: "playCard", playerId: P1, cardId: t.id("qm") });
    playCard(t.engine, P1, t.id("qm"));
    drive(t.engine, () => undefined);
    const hands = Object.fromEntries(t.seats.map((who) => [who, handOf(t.engine, who).length]));
    playCard(t.engine, P1, t.id("all"));
    drive(t.engine, () => undefined);
    for (const who of t.seats) {
      assert.equal(discardOf(t.engine, who).length, who === P1 ? 2 + 1 : 1, `${who}'s drawn card went to ${who}'s discard pile${who === P1 ? " (with the two spent tactics)" : ""}`);
      assert.equal(deckOf(t.engine, who).length, 4, `${who} drew from their deck`);
      assert.equal(handOf(t.engine, who).length, who === P1 ? hands[who]! - 1 : hands[who], `no card entered ${who}'s hand`);
    }
    const target = opponentsAt(count)[count - 2]!;
    playCard(t.engine, P1, t.id("bounce"), { selected: { t: [t.id(`c${target}`)] } });
    drive(t.engine, () => undefined);
    assert.equal(zoneOf(t.engine, t.id(`c${target}`)), "discard", "the returned character goes to its owner's discard pile");
    assert.ok(discardOf(t.engine, target).includes(t.id(`c${target}`)), `into ${target}'s own pile`);
    for (const who of t.seats.filter((seat) => seat !== target && seat !== P1)) assert.ok(!discardOf(t.engine, who).includes(t.id(`c${target}`)));
    for (const who of t.seats.filter((seat) => seat !== P1)) assert.equal(handOf(t.engine, who).length, hands[who]);
  });

  clause(MISFIRE, "0:rule", `${count} seats: it lasts this turn only: on the next turn cards enter hands again`, () => {
    const t = misfireBoard(count);
    playCard(t.engine, P1, t.id("qm"));
    drive(t.engine, () => undefined);
    t.engine.perform({ type: "endTurn", playerId: P1 } as never);
    drive(t.engine, (pc) => (pc.kind === "orderTriggers" ? { next: (pc as unknown as { triggers: unknown[] }).triggers[0] } : undefined));
    assert.equal(t.engine.state.activePlayerId, P2);
    const handBefore = handOf(t.engine, P2).length;
    playCard(t.engine, P2, t.id("p2draw"));
    drive(t.engine, () => undefined);
    assert.equal(handOf(t.engine, P2).length, handBefore - 1 + 1, "the tactic left the hand and the drawn card entered it");
    assert.equal(discardOf(t.engine, P2).length, 1, "only the spent tactic is in the discard pile");
  });
}

// --- Lugubrian Octopod ---------------------------------------------------------------------------
// COVERT -- If this card inflicts damage to a faction, your opponent must discard 2 cards.
// MPQ-P8: "your opponent" is the other side of the battle (the defending player when the controller attacks).

const OCTOPOD = "9637226d-3115-48cd-bf92-b6946d7eafed";

function octopodBoard(count: number) {
  return seatTable(count, [
    { key: "oc", def: printing(OCTOPOD), owner: P1, zone: "play" },
    ...opponentsAt(count).flatMap((who) => fill(`h${who}`, 4, who, "hand"))
  ]);
}

for (const count of TABLES) {
  clause(OCTOPOD, "1:rule", `${count} seats: when it inflicts damage to a faction the defending player (the other side of the battle) discards 2 cards, with no opponent choice; no other opponent does`, () => {
    for (const defender of choices(count)) {
      const t = octopodBoard(count);
      t.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [t.id("oc")], target: { type: "faction", playerId: defender } } as never);
      passAround(t.engine);
      t.engine.perform({ type: "declareBlockers", playerId: defender, blockerIds: [] } as never);
      const asked: string[] = [];
      for (let guard = 0; guard < 20 && (t.engine.state.battle || pendingOf(t.engine)); guard++) {
        const pc = pendingOf(t.engine);
        if (pc) {
          asked.push(`${pc.kind}:${pc.playerId}`);
          if (pc.kind === "chooserSelectsTarget") {
            assert.ok(offeredCards(t.engine).every((id) => t.engine.state.cards[id]!.ownerId === defender), "the defender discards from their own hand");
            answer(t.engine, "chooserSelectsTarget", { selected: offeredCards(t.engine).slice(0, 2) });
          } else if (pc.kind === "orderTriggers") answer(t.engine, "orderTriggers", { next: (pc as unknown as { triggers: unknown[] }).triggers[0] });
          else assert.fail(`unexpected prompt ${pc.kind}`);
          continue;
        }
        const battle = t.engine.state.battle!;
        if (t.engine.state.responseWindow) {
          passAround(t.engine);
        } else if (battle.phase === "attackerDamageAssignment" || battle.phase === "defenderDamageAssignment") {
          const view = t.engine.getBattleView()!;
          const assignments = view.damageSources.flatMap((source) => (source.legalTargets.length > 0 && source.strength > 0 ? [{ sourceId: source.cardId, target: source.legalTargets[0], amount: source.strength }] : []));
          t.engine.perform({ type: "assignBattleDamage", playerId: view.actingPlayerId!, assignments } as never);
        } else {
          t.engine.perform({ type: "advanceFlow" } as never);
        }
      }
      assert.ok(!asked.some((entry) => entry.startsWith("choosePlayer")), `P1 is never offered an opponent choice: ${asked.join(" ")}`);
      assert.deepEqual(asked.filter((entry) => entry.startsWith("chooserSelectsTarget")), [`chooserSelectsTarget:${defender}`], "the defending player chooses the discards");
      assert.equal(handOf(t.engine, defender).length, 2, `${defender} discarded 2 cards`);
      assert.equal(discardOf(t.engine, defender).length, 2);
      for (const who of others(count, defender)) assert.equal(handOf(t.engine, who).length, 4, `${who} discards nothing`);
    }
  });
}

// --- Tactician Vacation -----------------------------------------------------------------------------
// 0: Your opponent cannot respond to this card.
// 1: If you played this card in response to a tactic, that tactic has no effect.
// 2: For the rest of the turn, no tactics can be played.

const VACATION = "5ca25182-e910-4f21-97d0-b30298e7d4af";
const PROBE = tactic({ name: "Probe", cost: 0, behavior: { abilities: [{ id: "p", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });

function vacationBoard(count: number, active = P1) {
  return seatTable(
    count,
    [
      { key: "tv", def: printing(VACATION), owner: P1, zone: "hand" },
      ...bank("rage", 6, P1),
      { key: "probe1", def: PROBE, owner: P1, zone: "hand" },
      { key: "mineC", def: character({ name: "MineChar", cost: 0 }), owner: P1, zone: "hand" },
      ...opponentsAt(count).flatMap((who) => [{ key: `probe${who}`, def: PROBE, owner: who, zone: "hand" as const }, ...fill(`dk${who}`, 4, who, "deck")]),
      ...fill("dk1", 4, P1, "deck")
    ],
    { activePlayerId: active }
  );
}
/** `players` for the play if the engine asks for the opponent at all. */
const withOpponent = (t: SeatTable, chosen: string): Record<string, unknown> => {
  const needs = t.engine.getPlayRequirements({ type: "playCard", playerId: P1, cardId: t.id("tv") } as never) as unknown as { kind: string }[];
  return needs[0]?.kind === "players" ? { players: { opponent: chosen } } : {};
};

for (const count of TABLES) {
  clauseMismatch(VACATION, "0:rule", "MP-open-beta-1", `${count} seats: the chosen opponent is never offered a response, every other opponent is`, () => {
    for (const chosen of choices(count)) {
      const t = vacationBoard(count);
      expectOpponentAsked(t, { type: "playCard", playerId: P1, cardId: t.id("tv") });
      playCard(t.engine, P1, t.id("tv"), { players: { opponent: chosen } });
      const passers = passAround(t.engine);
      assert.deepEqual(passers, others(count, chosen), `only the other opponents are offered the window, clockwise; ${chosen} never is`);
      assert.equal(zoneOf(t.engine, t.id("tv")), "discard", "it resolved after they passed");
    }
  });
}

clauseMismatch(VACATION, "0:rule", "MP-open-beta-1", "3 seats: the chosen opponent cannot play a tactic in response while the other can", () => {
  const t = vacationBoard(3);
  playCard(t.engine, P1, t.id("tv"), { players: { opponent: P2 } });
  refused(() => playCard(t.engine, P2, t.id("probe" + P2)), "the chosen opponent cannot respond", /priority/);
});

clause(VACATION, "0:rule", "3 seats: with one opponent left no choice is offered and nobody can respond", () => {
  const t = vacationBoard(3);
  eliminate(t.engine, P3);
  expectNotAsked(t, { type: "playCard", playerId: P1, cardId: t.id("tv") });
  playCard(t.engine, P1, t.id("tv"));
  assert.equal(t.engine.state.responseWindow, undefined, "it resolves right after being played");
  assert.equal(zoneOf(t.engine, t.id("tv")), "discard");
});

for (const count of TABLES) {
  clause(VACATION, "1:rule", `${count} seats: played in response to a tactic, that tactic has no effect, whoever played it`, () => {
    const opps = opponentsAt(count);
    const owner = opps[0]!;
    const t = vacationBoard(count, owner);
    const handBefore = handOf(t.engine, owner).length;
    playCard(t.engine, owner, t.id(`probe${owner}`));
    // pass every player before P1 so P1 holds priority in the window to the tactic
    for (let guard = 0; guard < 8 && t.engine.state.responseWindow!.priorityPlayerId !== P1; guard++) {
      t.engine.perform({ type: "passPriority", playerId: t.engine.state.responseWindow!.priorityPlayerId } as never);
    }
    playCard(t.engine, P1, t.id("tv"), withOpponent(t, owner));
    drive(t.engine, () => undefined);
    assert.equal(zoneOf(t.engine, t.id(`probe${owner}`)), "discard", "the tactic was played and left the hand");
    assert.equal(handOf(t.engine, owner).length, handBefore - 1, `${owner}'s Probe had no effect: no card was drawn`);
    assert.equal(deckOf(t.engine, owner).length, 4);
  });

  clause(VACATION, "1:rule", `${count} seats: played outside a response there is no tactic to terminate and it resolves normally`, () => {
    const t = vacationBoard(count);
    const hands = Object.fromEntries(t.seats.map((who) => [who, handOf(t.engine, who).length]));
    playCard(t.engine, P1, t.id("tv"), withOpponent(t, P2));
    drive(t.engine, () => undefined);
    assert.equal(zoneOf(t.engine, t.id("tv")), "discard", "it resolved");
    for (const who of t.seats.filter((seat) => seat !== P1)) assert.equal(handOf(t.engine, who).length, hands[who], `${who} lost nothing`);
  });

  clause(VACATION, "2:rule", `${count} seats: after it resolves nobody can play a tactic for the rest of the turn, and everybody can again on the next turn`, () => {
    const t = vacationBoard(count);
    playCard(t.engine, P1, t.id("tv"), withOpponent(t, P2));
    drive(t.engine, () => undefined);
    assert.equal(zoneOf(t.engine, t.id("tv")), "discard");
    refused(() => playCard(t.engine, P1, t.id("probe1")), "the controller cannot play a tactic any more this turn");
    // an opponent cannot answer an action of P1's with a tactic either
    playCard(t.engine, P1, t.id("mineC"));
    for (const who of opponentsAt(count)) {
      const window = t.engine.state.responseWindow;
      if (window?.priorityPlayerId === who) refused(() => playCard(t.engine, who, t.id(`probe${who}`)), `${who} cannot play a tactic`);
      if (t.engine.state.responseWindow?.priorityPlayerId === who) t.engine.perform({ type: "passPriority", playerId: who } as never);
    }
    drive(t.engine, () => undefined);
    t.engine.perform({ type: "endTurn", playerId: P1 } as never);
    drive(t.engine, (pc) => (pc.kind === "orderTriggers" ? { next: (pc as unknown as { triggers: unknown[] }).triggers[0] } : undefined));
    assert.equal(t.engine.state.activePlayerId, P2);
    const handBefore = handOf(t.engine, P2).length;
    playCard(t.engine, P2, t.id(`probe${P2}`));
    drive(t.engine, () => undefined);
    assert.equal(zoneOf(t.engine, t.id(`probe${P2}`)), "discard", "on the next turn a tactic can be played again");
    assert.equal(handOf(t.engine, P2).length, handBefore - 1 + 1);
  });
}
