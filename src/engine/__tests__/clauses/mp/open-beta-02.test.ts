// Multiplayer clause tests: Open Beta, group B. Each test is written from the card's PRINTED text and the spec in
// data/card-tests/mp-spec/open-beta.json (its `test3` / `test4` line): a real 3- or 4-seat game, real actions through
// `perform`, asserting that the chosen / affected opponent IS affected and the other opponents are NOT.

import assert from "node:assert/strict";
import { character, item, resourceCard, tactic } from "../../per-card/_harness.js";
import { clause, printing, refused } from "../_clause.js";
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
  passAround,
  pendingOf,
  playCard,
  playerRequirement,
  seatsFor,
  seatTable,
  zoneOf,
  type CardPlacement
} from "./_mpSeats.js";

const TABLES = [3, 4] as const;
type Table = ReturnType<typeof seatTable>;

/** The opponents other than `chosen`. */
const others = (count: number, chosen: string) => opponentsAt(count).filter((who) => who !== chosen);

/** Answers a `choosePlayer` prompt with `chosen`, asserting the controller is asked and every opponent is offered. */
const select =
  (count: number, chosen: string) =>
  (t: Table, pc: { kind: string; playerId: string }): Record<string, unknown> | undefined => {
    if (pc.kind !== "choosePlayer") return undefined;
    assert.equal(pc.playerId, P1, "the controller selects the opponent");
    assert.deepEqual(candidatesOf(t.engine), opponentsAt(count), "every opponent still in the game is offered");
    return { playerId: chosen };
  };

/** P1 plays `key`, lets the responses pass and answers the opponent selection of the resolving trigger with `chosen`; other prompts go to `rest`. */
function playAndSelect(t: Table, key: string, chosen: string, rest: (pc: { kind: string; playerId: string }) => Record<string, unknown> | undefined = () => undefined) {
  playCard(t.engine, P1, t.id(key));
  return drive(t.engine, (pc) => select(t.seats.length, chosen)(t, pc) ?? rest(pc));
}

/** Ends turns (trigger order: first listed) until `who` is the active player. */
function advanceTo(t: Table, who: string, answerFor: Parameters<typeof drive>[1] = () => undefined): ReturnType<typeof drive> {
  const asked: ReturnType<typeof drive> = [];
  for (let guard = 0; guard < 8 && t.engine.state.activePlayerId !== who; guard++) {
    t.engine.perform({ type: "endTurn", playerId: t.engine.state.activePlayerId } as never);
    asked.push(...drive(t.engine, (pc) => (pc.kind === "orderTriggers" ? { next: (pc as unknown as { triggers: unknown[] }).triggers[0] } : answerFor(pc))));
  }
  assert.equal(t.engine.state.activePlayerId, who);
  return asked;
}

/** Passes every player before `who` in the open response window, so `who` holds priority. */
function toPriorityOf(t: Table, who: string): void {
  for (let guard = 0; guard < 12; guard++) {
    const window = t.engine.state.responseWindow!;
    if (window.priorityPlayerId === who) return;
    t.engine.perform({ type: "passPriority", playerId: window.priorityPlayerId } as never);
  }
  throw new Error(`${who} never got priority`);
}

// --- Pillaging Pirate ---------------------------------------------------------------------------
// When this card enters play, put the top 2 cards of your opponent's deck into their discard pile.

const PIRATE = "ca14cfec-3ab4-4da6-af9b-2966b31b6716";

for (const count of TABLES) {
  clause(PIRATE, "0:rule", `${count} seats: the opponent is chosen when the trigger resolves; only that opponent's top 2 cards are put into their discard pile`, () => {
    for (const chosen of choices(count)) {
      const t = seatTable(count, [
        { key: "pp", def: printing(PIRATE), owner: P1, zone: "hand" },
        ...bank("deception", 6, P1),
        ...opponentsAt(count).flatMap((who) => fill(`d${who}`, 5, who, "deck"))
      ]);
      const decks = Object.fromEntries(opponentsAt(count).map((who) => [who, [...deckOf(t.engine, who)]]));
      const asked = playAndSelect(t, "pp", chosen);
      assert.deepEqual(asked.map((a) => [a.kind, a.playerId]), [["choosePlayer", P1]], "only the controller is asked, once");
      assert.equal(zoneOf(t.engine, t.id("pp")), "play");
      assert.deepEqual(discardOf(t.engine, chosen), decks[chosen]!.slice(0, 2), "the top 2 cards, in order");
      assert.deepEqual(deckOf(t.engine, chosen), decks[chosen]!.slice(2));
      for (const who of others(count, chosen)) {
        assert.deepEqual(deckOf(t.engine, who), decks[who], `${who}'s deck is untouched`);
        assert.equal(discardOf(t.engine, who).length, 0);
      }
    }
  });
}

clause(PIRATE, "0:rule", "3 seats: with one opponent left no choice is offered and that opponent is milled", () => {
  const t = seatTable(3, [{ key: "pp", def: printing(PIRATE), owner: P1, zone: "hand" }, ...bank("deception", 6, P1), ...fill("d2", 4, P2, "deck"), ...fill("d3", 4, P3, "deck")]);
  eliminate(t.engine, P3);
  playCard(t.engine, P1, t.id("pp"));
  const asked = drive(t.engine, () => undefined);
  assert.equal(asked.length, 0, "nobody is asked");
  assert.equal(discardOf(t.engine, P2).length, 2);
});

// --- Card Counter -------------------------------------------------------------------------------
// When this card enters play, flip a coin. If you win, X is 3 otherwise X is 2. Put the top X cards of your opponent's deck into their discard pile.

const COUNTER = "6120a36b-4cbf-423a-b667-b6ca1df81879";
const WIN = () => 0; // the engine flips with `random() < 0.5`
const LOSE = () => 0.99;

for (const count of TABLES) {
  clause(COUNTER, "0:rule", `${count} seats: the coin decides X; only the chosen opponent's top X cards go to their discard pile`, () => {
    for (const chosen of choices(count)) {
      for (const [random, x] of [[WIN, 3], [LOSE, 2]] as const) {
        const t = seatTable(
          count,
          [{ key: "cc", def: printing(COUNTER), owner: P1, zone: "hand" }, ...bank("deception", 4, P1), ...opponentsAt(count).flatMap((who) => fill(`d${who}`, 5, who, "deck"))],
          { random }
        );
        const decks = Object.fromEntries(opponentsAt(count).map((who) => [who, [...deckOf(t.engine, who)]]));
        const asked = playAndSelect(t, "cc", chosen);
        assert.deepEqual(asked.map((a) => [a.kind, a.playerId]), [["choosePlayer", P1]]);
        assert.deepEqual(discardOf(t.engine, chosen), decks[chosen]!.slice(0, x), `X = ${x}: the top ${x} cards of the chosen opponent's deck`);
        for (const who of others(count, chosen)) {
          assert.deepEqual(deckOf(t.engine, who), decks[who], `${who}'s deck is untouched`);
          assert.equal(discardOf(t.engine, who).length, 0);
        }
      }
    }
  });
}

clause(COUNTER, "0:rule", "3 seats: with one opponent left no choice is offered", () => {
  const t = seatTable(3, [{ key: "cc", def: printing(COUNTER), owner: P1, zone: "hand" }, ...bank("deception", 4, P1), ...fill("d2", 5, P2, "deck"), ...fill("d3", 5, P3, "deck")], { random: WIN });
  eliminate(t.engine, P3);
  playCard(t.engine, P1, t.id("cc"));
  assert.equal(drive(t.engine, () => undefined).length, 0);
  assert.equal(discardOf(t.engine, P2).length, 3);
});

// --- Rabid Sarume -------------------------------------------------------------------------------
// When this card enters play, inflict 1 damage to all your opponent's characters.

const SARUME = "06dceb26-b7b7-49c4-b66c-9fd1b93ef09a";

for (const count of TABLES) {
  clause(SARUME, "0:rule", `${count} seats: each character the chosen opponent controls takes 1 damage; no other player's characters do`, () => {
    for (const chosen of choices(count)) {
      const t = seatTable(count, [
        { key: "rs", def: printing(SARUME), owner: P1, zone: "hand" },
        ...bank("rage", 8, P1),
        { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
        ...opponentsAt(count).flatMap((who) => fill(`c${who}`, 2, who, "play", (i) => character({ name: `Char ${who} ${i}`, life: 5 })))
      ]);
      const asked = playAndSelect(t, "rs", chosen);
      assert.deepEqual(asked.map((a) => a.playerId), [P1]);
      for (const i of [0, 1]) assert.equal(t.engine.state.cards[t.id(`c${chosen}${i}`)]!.damage, 1, "both of the chosen opponent's characters take 1");
      for (const who of others(count, chosen)) for (const i of [0, 1]) assert.equal(t.engine.state.cards[t.id(`c${who}${i}`)]!.damage, 0, `${who}'s characters take none`);
      assert.equal(t.engine.state.cards[t.id("mine")]!.damage, 0, "the controller's character takes none");
    }
  });
}

clause(SARUME, "0:rule", "3 seats: with one opponent left no choice is offered", () => {
  const t = seatTable(3, [
    { key: "rs", def: printing(SARUME), owner: P1, zone: "hand" },
    ...bank("rage", 8, P1),
    { key: "c2", def: character({ name: "C2", life: 5 }), owner: P2, zone: "play" },
    { key: "c3", def: character({ name: "C3", life: 5 }), owner: P3, zone: "play" }
  ]);
  eliminate(t.engine, P3);
  playCard(t.engine, P1, t.id("rs"));
  assert.equal(drive(t.engine, () => undefined).length, 0);
  assert.equal(t.engine.state.cards[t.id("c2")]!.damage, 1);
});

// --- Heist Planner ------------------------------------------------------------------------------
// When this card enters play, you may search your opponent's deck for up to 3 cards with different names and put them into your opponent's discard pile.

const PLANNER = "5f93b923-bd32-4591-9a90-67c68a1e7c88";

for (const count of TABLES) {
  clause(PLANNER, "0:rule", `${count} seats: only the chosen opponent's deck is searched; the cards go to their discard pile`, () => {
    for (const chosen of choices(count)) {
      const t = seatTable(count, [
        { key: "hp", def: printing(PLANNER), owner: P1, zone: "hand" },
        ...bank("deception", 6, P1),
        ...opponentsAt(count).flatMap((who) => fill(`d${who}`, 5, who, "deck"))
      ]);
      const decks = Object.fromEntries(opponentsAt(count).map((who) => [who, [...deckOf(t.engine, who)]]));
      const mine = ["d0", "d2", "d4"].map((suffix) => t.id(`d${chosen}${suffix.slice(1)}`));
      const asked = playAndSelect(t, "hp", chosen, (pc) => {
        if (pc.kind !== "chooserSelectsTarget") return undefined;
        assert.equal(pc.playerId, P1, "the controller searches");
        assert.deepEqual([...offeredCards(t.engine)].sort(), [...decks[chosen]!].sort(), "the chosen opponent's whole deck, no other deck");
        return { selected: mine };
      });
      assert.deepEqual(asked.map((a) => [a.kind, a.playerId]), [["choosePlayer", P1], ["chooserSelectsTarget", P1]]);
      for (const id of mine) assert.equal(zoneOf(t.engine, id), "discard");
      assert.equal(deckOf(t.engine, chosen).length, 2, "3 cards left the chosen opponent's deck");
      for (const who of others(count, chosen)) {
        assert.deepEqual(deckOf(t.engine, who), decks[who], `${who}'s deck is untouched and unshuffled`);
        assert.equal(discardOf(t.engine, who).length, 0);
      }
    }
  });

  clause(PLANNER, "0:rule", `${count} seats: the search takes cards with different names only`, () => {
    const chosen = opponentsAt(count)[0]!;
    const t = seatTable(count, [
      { key: "hp", def: printing(PLANNER), owner: P1, zone: "hand" },
      ...bank("deception", 6, P1),
      { key: "a1", def: character({ id: "dup-def", name: "Twin" }), owner: chosen, zone: "deck" },
      { key: "a2", def: character({ id: "dup-def", name: "Twin" }), owner: chosen, zone: "deck" },
      { key: "b", def: character({ name: "Solo" }), owner: chosen, zone: "deck" }
    ]);
    playCard(t.engine, P1, t.id("hp"));
    drive(t.engine, (pc) => (pc.kind === "choosePlayer" ? { playerId: chosen } : undefined));
    refused(() => answer(t.engine, "chooserSelectsTarget", { selected: [t.id("a1"), t.id("a2")] }), "two cards with the same name");
    answer(t.engine, "chooserSelectsTarget", { selected: [t.id("a1"), t.id("b")] });
    assert.equal(zoneOf(t.engine, t.id("a1")), "discard");
    assert.equal(zoneOf(t.engine, t.id("b")), "discard");
  });
}

clause(PLANNER, "0:rule", "3 seats: with one opponent left no choice is offered and that deck is searched", () => {
  const t = seatTable(3, [{ key: "hp", def: printing(PLANNER), owner: P1, zone: "hand" }, ...bank("deception", 6, P1), ...fill("d2", 3, P2, "deck"), ...fill("d3", 3, P3, "deck")]);
  eliminate(t.engine, P3);
  playCard(t.engine, P1, t.id("hp"));
  const asked = drive(t.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { selected: [t.id("d20")] } : undefined));
  assert.deepEqual(asked.map((a) => a.kind), ["chooserSelectsTarget"], "no opponent choice");
  assert.equal(zoneOf(t.engine, t.id("d20")), "discard");
});

// --- Swashbuckler -------------------------------------------------------------------------------
// When this card enters play, you may remove 4 cards in your opponent's discard pile from the game. If you don't, destroy this card.

const SWASH = "ae5a510d-db82-4c4f-83b5-eb2878145280";

function swashBoard(count: number, discards: Record<string, number>) {
  return seatTable(count, [
    { key: "sw", def: printing(SWASH), owner: P1, zone: "hand" },
    ...bank("deception", 6, P1),
    ...Object.entries(discards).flatMap(([who, n]) => fill(`x${who}`, n, who, "discard"))
  ]);
}

for (const count of TABLES) {
  clause(SWASH, "0:rule", `${count} seats: 4 cards of only the chosen opponent's discard pile are removed from the game and the Swashbuckler stays`, () => {
    for (const chosen of choices(count)) {
      const discards = Object.fromEntries(opponentsAt(count).map((who) => [who, who === chosen ? 4 : 6]));
      const t = swashBoard(count, discards);
      const asked = playAndSelect(t, "sw", chosen, (pc) => {
        if (pc.kind === "chooserSelectsOption") {
          const options = (pc as unknown as { options: { label: string }[] }).options;
          return { index: options.findIndex((o) => /^Remove/.test(o.label)) };
        }
        if (pc.kind !== "chooserSelectsTarget") return undefined;
        const offered = offeredCards(t.engine);
        assert.ok(offered.length === 4 && offered.every((id) => t.engine.state.cards[id]!.ownerId === chosen), "only the chosen opponent's discard pile");
        return { selected: offered };
      });
      assert.deepEqual(asked.map((a) => [a.kind, a.playerId]), [["choosePlayer", P1], ["chooserSelectsOption", P1], ["chooserSelectsTarget", P1]]);
      assert.equal(zoneOf(t.engine, t.id("sw")), "play");
      assert.equal(discardOf(t.engine, chosen).length, 0, "the chosen opponent's 4 cards left the game");
      for (const who of others(count, chosen)) assert.equal(discardOf(t.engine, who).length, 6, `${who}'s discard pile is untouched`);
    }
  });
}

clause(SWASH, "0:rule", "3 seats: declining destroys the Swashbuckler; fewer than 4 cards in the chosen opponent's discard destroys it even when the other opponent has 6", () => {
  const declined = swashBoard(3, { [P2]: 4, [P3]: 6 });
  playAndSelect(declined, "sw", P2, (pc) => (pc.kind === "chooserSelectsOption" ? { index: 1 } : undefined));
  assert.equal(zoneOf(declined.engine, declined.id("sw")), "discard", "declined: destroyed");
  assert.equal(discardOf(declined.engine, P2).length, 4, "nothing was removed");
  const short = swashBoard(3, { [P2]: 3, [P3]: 6 });
  playAndSelect(short, "sw", P2);
  assert.equal(zoneOf(short.engine, short.id("sw")), "discard", "P2 has only 3 cards: destroyed, whatever P3 has");
  assert.equal(discardOf(short.engine, P3).length, 6);
});

clause(SWASH, "0:rule", "3 seats: with one opponent left no choice is offered and that discard pile is used", () => {
  const t = swashBoard(3, { [P2]: 4, [P3]: 6 });
  eliminate(t.engine, P3);
  playCard(t.engine, P1, t.id("sw"));
  const asked = drive(t.engine, (pc) => {
    if (pc.kind === "chooserSelectsOption") return { index: 0 };
    return pc.kind === "chooserSelectsTarget" ? { selected: offeredCards(t.engine) } : undefined;
  });
  assert.ok(!asked.some((a) => a.kind === "choosePlayer"));
  assert.equal(zoneOf(t.engine, t.id("sw")), "play");
  assert.equal(discardOf(t.engine, P2).length, 0);
});

// --- Dragon Tank --------------------------------------------------------------------------------
// At the start of your turn, you may destroy a character your opponent controls. If you don't, destroy this card instead.

const TANK = "e055ac0a-49d8-4bb0-914b-b039336c5e97";

function tankBoard(count: number, chars: Record<string, number>) {
  const seats = seatsFor(count);
  return seatTable(
    count,
    [{ key: "dt", def: printing(TANK), owner: P1, zone: "play" }, ...Object.entries(chars).flatMap(([who, n]) => fill(`c${who}`, n, who, "play"))],
    { activePlayerId: seats[count - 1]!, turn: count }
  );
}

/** The last seat ends its turn: P1's turn starts. `pick` answers the Dragon Tank's pick (undefined leaves it open). */
function tankTurnStart(t: Table, chosen: string, pick: (offered: string[]) => string[] | undefined) {
  return advanceTo(t, P1, (pc) => {
    if (pc.kind === "choosePlayer") return select(t.seats.length, chosen)(t, pc);
    if (pc.kind !== "chooserSelectsTarget") return undefined;
    const selected = pick(offeredCards(t.engine));
    return selected === undefined ? undefined : { selected };
  });
}

for (const count of TABLES) {
  clause(TANK, "0:rule", `${count} seats: at the start of the controller's turn the chosen opponent's character may be destroyed, and only theirs is offered`, () => {
    for (const chosen of choices(count)) {
      const t = tankBoard(count, Object.fromEntries(opponentsAt(count).map((who) => [who, 2])));
      let offered: string[] = [];
      const asked = tankTurnStart(t, chosen, (cards) => {
        offered = cards;
        return [cards[0]!];
      });
      assert.deepEqual(asked.filter((a) => a.kind === "choosePlayer").map((a) => a.playerId), [P1], "the opponent is chosen when the trigger resolves");
      assert.deepEqual([...offered].sort(), [`c${chosen}0`, `c${chosen}1`].map(t.id).sort(), "only the chosen opponent's characters");
      assert.equal(zoneOf(t.engine, t.id("dt")), "play", "the Dragon Tank survives");
      assert.equal(zoneOf(t.engine, offered[0]!), "discard");
      for (const who of others(count, chosen)) for (const i of [0, 1]) assert.equal(zoneOf(t.engine, t.id(`c${who}${i}`)), "play", `${who}'s characters stay`);
    }
  });

  clause(TANK, "0:rule", `${count} seats: declining destroys the Dragon Tank; a chosen opponent with no characters destroys it even when another opponent has one`, () => {
    const chosen = opponentsAt(count)[0]!;
    const declined = tankBoard(count, Object.fromEntries(opponentsAt(count).map((who) => [who, 1])));
    tankTurnStart(declined, chosen, () => []);
    assert.equal(zoneOf(declined.engine, declined.id("dt")), "discard", "declined: the Dragon Tank is destroyed");
    assert.equal(zoneOf(declined.engine, declined.id(`c${chosen}0`)), "play");
    const none = tankBoard(count, Object.fromEntries(opponentsAt(count).map((who) => [who, who === chosen ? 0 : 1])));
    tankTurnStart(none, chosen, () => assert.fail("nothing to pick"));
    assert.equal(zoneOf(none.engine, none.id("dt")), "discard", "the choice was made first: the chosen opponent has no character");
    for (const who of others(count, chosen)) assert.equal(zoneOf(none.engine, none.id(`c${who}0`)), "play");
  });

  clause(TANK, "0:rule", `${count} seats: the trigger fires at the start of the controller's turn only`, () => {
    const t = tankBoard(count, Object.fromEntries(opponentsAt(count).map((who) => [who, 1])));
    const asked = advanceTo(t, P1, (pc) => (pc.kind === "choosePlayer" ? { playerId: P2 } : pc.kind === "chooserSelectsTarget" ? { selected: [] } : undefined));
    assert.equal(asked.filter((a) => a.kind === "choosePlayer").length, 1);
    // the next opponent's turn start does not trigger it again
    const before = Object.fromEntries(opponentsAt(count).map((who) => [who, zoneOf(t.engine, t.id(`c${who}0`))]));
    t.engine.perform({ type: "endTurn", playerId: P1 } as never);
    const next = drive(t.engine, (pc) => (pc.kind === "orderTriggers" ? { next: (pc as unknown as { triggers: unknown[] }).triggers[0] } : undefined));
    assert.ok(!next.some((a) => a.kind === "choosePlayer"), "no prompt at an opponent's turn start");
    assert.ok(Object.entries(before).every(([who, zone]) => zoneOf(t.engine, t.id(`c${who}0`)) === zone));
  });
}

clause(TANK, "0:rule", "3 seats: with one opponent left no choice is offered", () => {
  const t = tankBoard(3, { [P2]: 1, [P3]: 1 });
  eliminate(t.engine, P3);
  t.engine.state.activePlayerId = P2;
  const asked = advanceTo(t, P1, (pc) => (pc.kind === "chooserSelectsTarget" ? { selected: offeredCards(t.engine) } : undefined));
  assert.ok(!asked.some((a) => a.kind === "choosePlayer"));
  assert.equal(zoneOf(t.engine, t.id(`c${P2}0`)), "discard");
});

// --- Irresistible Bribe -------------------------------------------------------------------------
// COST: Pick a character. X is that character's strength. EFFECT: Destroy the character. Your opponent's faction gains X influence.

const BRIBE = "8e36b4a0-419d-413d-9512-b539e37681aa";

for (const count of TABLES) {
  clause(BRIBE, "0:ability", `${count} seats: the picked character may be anyone's; only the chosen opponent's faction gains X`, () => {
    for (const chosen of choices(count)) {
      const opps = opponentsAt(count);
      const victimOwner = others(count, chosen)[0]!;
      const t = seatTable(count, [
        { key: "ib", def: printing(BRIBE), owner: P1, zone: "hand" },
        ...bank("greed", 6, P1),
        ...opps.map((who) => ({ key: `v${who}`, def: character({ name: `Victim ${who}`, strength: 3 }), owner: who, zone: "play" as const }))
      ]);
      expectOpponentAsked(t, { type: "playCard", playerId: P1, cardId: t.id("ib") });
      const before = Object.fromEntries(t.seats.map((who) => [who, influenceOf(t.engine, who)]));
      playCard(t.engine, P1, t.id("ib"), { players: { opponent: chosen }, selected: { c: [t.id(`v${victimOwner}`)] } });
      drive(t.engine, () => undefined);
      assert.equal(zoneOf(t.engine, t.id(`v${victimOwner}`)), "discard", "the picked character is destroyed, though another opponent controls it");
      assert.equal(influenceOf(t.engine, chosen) - before[chosen]!, 3, "the chosen opponent's faction gains X = 3");
      for (const who of [P1, ...others(count, chosen)]) assert.equal(influenceOf(t.engine, who), before[who], `${who}'s faction is unchanged`);
    }
  });
}

clause(BRIBE, "0:ability", "3 seats: the chosen opponent's own character may be the pick; with one opponent left no choice is offered", () => {
  const t = seatTable(3, [{ key: "ib", def: printing(BRIBE), owner: P1, zone: "hand" }, ...bank("greed", 6, P1), { key: "v2", def: character({ name: "V2", strength: 2 }), owner: P2, zone: "play" }, { key: "v3", def: character({ name: "V3", strength: 4 }), owner: P3, zone: "play" }]);
  const before = influenceOf(t.engine, P2);
  playCard(t.engine, P1, t.id("ib"), { players: { opponent: P2 }, selected: { c: [t.id("v2")] } });
  drive(t.engine, () => undefined);
  assert.equal(influenceOf(t.engine, P2) - before, 2);
  const u = seatTable(3, [{ key: "ib", def: printing(BRIBE), owner: P1, zone: "hand" }, ...bank("greed", 6, P1), { key: "v2", def: character({ name: "V2", strength: 2 }), owner: P2, zone: "play" }, { key: "v3", def: character({ name: "V3", strength: 4 }), owner: P3, zone: "play" }]);
  eliminate(u.engine, P3);
  expectNotAsked(u, { type: "playCard", playerId: P1, cardId: u.id("ib") });
  const p2 = influenceOf(u.engine, P2);
  playCard(u.engine, P1, u.id("ib"), { selected: { c: [u.id("v2")] } });
  drive(u.engine, () => undefined);
  assert.equal(influenceOf(u.engine, P2) - p2, 2);
});

// --- Summary Judgment ---------------------------------------------------------------------------
// COST: Pick a character your opponent controls. X is that character's strength. EFFECT: Your opponent must pick one of the following: destroy the character or you draw X cards.

const JUDGMENT = "191e0731-b609-4ab3-a62b-8d6c21ed9e2b";

for (const count of TABLES) {
  clause(JUDGMENT, "0:ability", `${count} seats: only the chosen opponent's characters may be picked, and that opponent (nobody else) decides`, () => {
    for (const chosen of choices(count)) {
      for (const destroy of [true, false]) {
        const opps = opponentsAt(count);
        const t = seatTable(count, [
          { key: "sj", def: printing(JUDGMENT), owner: P1, zone: "hand" },
          ...bank("greed", 8, P1),
          ...fill("mine", 5, P1, "deck"),
          ...opps.map((who) => ({ key: `v${who}`, def: character({ name: `Victim ${who}`, strength: 3 }), owner: who, zone: "play" as const }))
        ]);
        expectOpponentAsked(t, { type: "playCard", playerId: P1, cardId: t.id("sj") });
        for (const who of others(count, chosen)) {
          refused(() => playCard(t.engine, P1, t.id("sj"), { players: { opponent: chosen }, selected: { c: [t.id(`v${who}`)] } }), `${who}'s character is not a legal pick`);
        }
        const hand = handOf(t.engine, P1).length;
        playCard(t.engine, P1, t.id("sj"), { players: { opponent: chosen }, selected: { c: [t.id(`v${chosen}`)] } });
        const asked = drive(t.engine, (pc) => (pc.kind === "mayPay" ? { pay: destroy } : undefined));
        assert.deepEqual(asked.map((a) => [a.kind, a.playerId]), [["mayPay", chosen]], "only the chosen opponent decides");
        assert.equal(zoneOf(t.engine, t.id(`v${chosen}`)), destroy ? "discard" : "play");
        assert.equal(handOf(t.engine, P1).length - hand, destroy ? -1 : 3 - 1, destroy ? "only the tactic left the hand" : "P1 drew X = 3 cards");
        for (const who of others(count, chosen)) assert.equal(zoneOf(t.engine, t.id(`v${who}`)), "play");
      }
    }
  });
}

clause(JUDGMENT, "0:ability", "3 seats: with one opponent left no choice is offered and that opponent decides", () => {
  const t = seatTable(3, [{ key: "sj", def: printing(JUDGMENT), owner: P1, zone: "hand" }, ...bank("greed", 8, P1), { key: "v2", def: character({ name: "V2", strength: 3 }), owner: P2, zone: "play" }, { key: "v3", def: character({ name: "V3", strength: 3 }), owner: P3, zone: "play" }]);
  eliminate(t.engine, P3);
  expectNotAsked(t, { type: "playCard", playerId: P1, cardId: t.id("sj") });
  playCard(t.engine, P1, t.id("sj"), { selected: { c: [t.id("v2")] } });
  const asked = drive(t.engine, (pc) => (pc.kind === "mayPay" ? { pay: true } : undefined));
  assert.deepEqual(asked.map((a) => a.playerId), [P2]);
  assert.equal(zoneOf(t.engine, t.id("v2")), "discard");
});

// --- Scrag --------------------------------------------------------------------------------------
// COST: Pick a character. X is that character's life. EFFECT: Destroy the character if your opponent has at least X cards in their discard pile.

const SCRAG = "c0b6851e-1ad8-4079-8f81-5e5ff07f9187";

function scragBoard(count: number, discards: Record<string, number>) {
  return seatTable(count, [
    { key: "sc", def: printing(SCRAG), owner: P1, zone: "hand" },
    ...bank("deception", 4, P1),
    { key: "target", def: character({ name: "Target", life: 5 }), owner: P1, zone: "play" },
    ...Object.entries(discards).flatMap(([who, n]) => fill(`x${who}`, n, who, "discard"))
  ]);
}

for (const count of TABLES) {
  clause(SCRAG, "0:ability", `${count} seats: only the chosen opponent's discard count decides whether the character is destroyed`, () => {
    for (const chosen of choices(count)) {
      const others_ = others(count, chosen);
      const enough = scragBoard(count, { [chosen]: 5, ...Object.fromEntries(others_.map((who) => [who, 2])) });
      expectOpponentAsked(enough, { type: "playCard", playerId: P1, cardId: enough.id("sc") });
      playCard(enough.engine, P1, enough.id("sc"), { players: { opponent: chosen }, selected: { c: [enough.id("target")] } });
      drive(enough.engine, () => undefined);
      assert.equal(zoneOf(enough.engine, enough.id("target")), "discard", "the chosen opponent has 5 cards in their discard pile: destroyed");
      const short = scragBoard(count, { [chosen]: 4, ...Object.fromEntries(others_.map((who) => [who, 9])) });
      playCard(short.engine, P1, short.id("sc"), { players: { opponent: chosen }, selected: { c: [short.id("target")] } });
      drive(short.engine, () => undefined);
      assert.equal(zoneOf(short.engine, short.id("target")), "play", "4 < 5: not destroyed, however many another opponent has");
    }
  });
}

clause(SCRAG, "0:ability", "3 seats: with one opponent left no choice is offered and that discard pile counts", () => {
  const t = scragBoard(3, { [P2]: 5, [P3]: 0 });
  eliminate(t.engine, P3);
  expectNotAsked(t, { type: "playCard", playerId: P1, cardId: t.id("sc") });
  playCard(t.engine, P1, t.id("sc"), { selected: { c: [t.id("target")] } });
  drive(t.engine, () => undefined);
  assert.equal(zoneOf(t.engine, t.id("target")), "discard");
});

// --- Grand Theft All ----------------------------------------------------------------------------
// Put up to 4 characters, items, locations, and/or resources from your opponent's discard pile into play under your control.

const THEFT = "3f6972bf-88bd-4b14-af92-d6356979c155";

function theftBoard(count: number) {
  return seatTable(count, [
    { key: "gt", def: printing(THEFT), owner: P1, zone: "hand" },
    ...bank("deception", 12, P1),
    ...opponentsAt(count).flatMap((who) => [
      ...fill(`c${who}`, 3, who, "discard"),
      { key: `i${who}`, def: item({ name: `Item ${who}` }), owner: who, zone: "discard" as const },
      { key: `t${who}`, def: tactic({ name: `Tact ${who}`, cost: 0 }), owner: who, zone: "discard" as const }
    ])
  ]);
}

for (const count of TABLES) {
  clause(THEFT, "0:rule", `${count} seats: up to 4 cards of only the chosen opponent's discard pile (no tactic) enter play under the caster's control`, () => {
    for (const chosen of choices(count)) {
      const t = theftBoard(count);
      expectOpponentAsked(t, { type: "playCard", playerId: P1, cardId: t.id("gt") });
      playCard(t.engine, P1, t.id("gt"), { players: { opponent: chosen } });
      const taken = [`c${chosen}0`, `c${chosen}1`, `c${chosen}2`, `i${chosen}`].map(t.id);
      const asked = drive(t.engine, (pc) => {
        if (pc.kind !== "chooserSelectsTarget") return undefined;
        const offered = offeredCards(t.engine);
        assert.deepEqual([...offered].sort(), [...taken].sort(), "the chosen opponent's non-tactic discard cards only");
        return { selected: taken };
      });
      assert.deepEqual(asked.map((a) => a.playerId), [P1]);
      for (const id of taken) {
        assert.equal(zoneOf(t.engine, id), "play");
        assert.equal(t.engine.state.cards[id]!.controllerId, P1);
      }
      for (const who of others(count, chosen)) assert.equal(discardOf(t.engine, who).length, 5, `${who}'s discard pile is untouched`);
    }
  });

  clause(THEFT, "0:rule", `${count} seats: a card of another opponent's discard pile, or a mix, is refused`, () => {
    const opps = opponentsAt(count);
    const chosen = opps[0]!;
    const other = opps[1]!;
    const t = theftBoard(count);
    playCard(t.engine, P1, t.id("gt"), { players: { opponent: chosen } });
    passAround(t.engine);
    refused(() => answer(t.engine, "chooserSelectsTarget", { selected: [t.id(`c${other}0`)] }), "another opponent's card");
    refused(() => answer(t.engine, "chooserSelectsTarget", { selected: [t.id(`c${chosen}0`), t.id(`c${other}0`)] }), "a mix of two discard piles");
    refused(() => answer(t.engine, "chooserSelectsTarget", { selected: [t.id(`t${chosen}`)] }), "a tactic");
    answer(t.engine, "chooserSelectsTarget", { selected: [t.id(`c${chosen}0`)] });
    assert.equal(zoneOf(t.engine, t.id(`c${chosen}0`)), "play");
  });
}

clause(THEFT, "0:rule", "3 seats: with one opponent left no choice is offered", () => {
  const t = theftBoard(3);
  eliminate(t.engine, P3);
  expectNotAsked(t, { type: "playCard", playerId: P1, cardId: t.id("gt") });
  playCard(t.engine, P1, t.id("gt"));
  drive(t.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { selected: [t.id(`c${P2}0`)] } : undefined));
  assert.equal(zoneOf(t.engine, t.id(`c${P2}0`)), "play");
});

// --- Master Scavenger ---------------------------------------------------------------------------
// RECLAIM -- COST: Remove 3 cards in your opponent's discard pile from the game. EFFECT: This card gains 1 strength and 1 life this turn.

const SCAVENGER = "93b8631a-c2f2-4c9b-8c22-c5d12672a329";

function scavengerBoard(count: number, discards: Record<string, number>) {
  return seatTable(count, [
    { key: "ms", def: printing(SCAVENGER), owner: P1, zone: "play" },
    ...Object.entries(discards).flatMap(([who, n]) => fill(`x${who}`, n, who, "discard"))
  ]);
}
const reclaim = (t: Table) => ({ type: "activateAbility", playerId: P1, cardId: t.id("ms"), abilityId: "reclaim" });

for (const count of TABLES) {
  clause(SCAVENGER, "0:ability:reclaim", `${count} seats: the 3 cards removed from the game come from the chosen opponent's discard pile only`, () => {
    for (const chosen of choices(count)) {
      const t = scavengerBoard(count, Object.fromEntries(opponentsAt(count).map((who) => [who, who === chosen ? 3 : 5])));
      expectOpponentAsked(t, reclaim(t));
      const pays = [0, 1, 2].map((i) => t.id(`x${chosen}${i}`));
      for (const who of others(count, chosen)) refused(() => activate(t.engine, P1, t.id("ms"), "reclaim", { players: { opponent: chosen }, selected: { cs: [t.id(`x${who}0`), t.id(`x${who}1`), t.id(`x${who}2`)] } }), `${who}'s discard pile cannot pay`);
      const strength = t.engine.getStat(t.id("ms"), "strength");
      activate(t.engine, P1, t.id("ms"), "reclaim", { players: { opponent: chosen }, selected: { cs: pays } });
      drive(t.engine, () => undefined);
      for (const id of pays) assert.equal(zoneOf(t.engine, id), "removed", "removed from the game");
      assert.equal(t.engine.getStat(t.id("ms"), "strength"), strength + 1);
      assert.equal(t.engine.getStat(t.id("ms"), "life"), 2, "gains 1 life this turn");
      for (const who of others(count, chosen)) assert.equal(discardOf(t.engine, who).length, 5, `${who}'s discard pile is untouched`);
    }
  });

  clause(SCAVENGER, "0:ability:reclaim", `${count} seats: with only 2 cards in the chosen opponent's discard pile the cost cannot be paid, however many another opponent has`, () => {
    const opps = opponentsAt(count);
    const chosen = opps[0]!;
    const t = scavengerBoard(count, Object.fromEntries(opps.map((who) => [who, who === chosen ? 2 : 5])));
    refused(() => activate(t.engine, P1, t.id("ms"), "reclaim", { players: { opponent: chosen }, selected: { cs: [t.id(`x${chosen}0`), t.id(`x${chosen}1`)] } }), "only 2 cards");
    assert.equal(discardOf(t.engine, chosen).length, 2);
  });
}

clause(SCAVENGER, "0:ability:reclaim", "3 seats: with one opponent left no choice is offered and that discard pile pays", () => {
  const t = scavengerBoard(3, { [P2]: 3, [P3]: 5 });
  eliminate(t.engine, P3);
  expectNotAsked(t, reclaim(t));
  activate(t.engine, P1, t.id("ms"), "reclaim", { selected: { cs: [0, 1, 2].map((i) => t.id(`x${P2}${i}`)) } });
  assert.equal(zoneOf(t.engine, t.id(`x${P2}0`)), "removed");
});

// --- Catastrophic Betrayal ----------------------------------------------------------------------
// COST: Play this only when you are attacking. Pick a character in your opponent's discard pile. EFFECT: Put the character into play under your control. Add the character to the attacking party, depleted.

const BETRAYAL = "8a59c571-2e1d-4d25-8627-befb70cf925e";

function betrayalBoard(count: number) {
  return seatTable(count, [
    { key: "cb", def: printing(BETRAYAL), owner: P1, zone: "hand" },
    ...bank("deception", 6, P1),
    { key: "raider", def: character({ name: "Raider", strength: 2, life: 4 }), owner: P1, zone: "play" },
    ...opponentsAt(count).flatMap((who) => [
      { key: `dc${who}`, def: character({ name: `Dead ${who}`, strength: 1, life: 1 }), owner: who, zone: "discard" as const },
      { key: `di${who}`, def: item({ name: `Gear ${who}` }), owner: who, zone: "discard" as const }
    ])
  ]);
}

for (const count of TABLES) {
  clause(BETRAYAL, "0:ability", `${count} seats: no opponent is asked; the defending player's discard pile is the only one offered, and the character joins the attack`, () => {
    for (const defender of choices(count)) {
      const t = betrayalBoard(count);
      t.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [t.id("raider")], target: { type: "faction", playerId: defender } } as never);
      toPriorityOf(t, P1);
      const action = { type: "playCard", playerId: P1, cardId: t.id("cb") };
      expectNotAsked(t, action);
      const needs = t.engine.getPlayRequirements(action as never);
      const pick = needs.find((n) => (n as { kind: string }).kind === "pick") as unknown as { candidates: string[] };
      assert.deepEqual(pick.candidates, [t.id(`dc${defender}`)], "only a character in the defending player's discard pile");
      for (const who of others(count, defender)) refused(() => playCard(t.engine, P1, t.id("cb"), { selected: { c: [t.id(`dc${who}`)] } }), `${who}'s discard pile is not offered`);
      playCard(t.engine, P1, t.id("cb"), { selected: { c: [t.id(`dc${defender}`)] } });
      passAround(t.engine);
      const raised = t.engine.state.cards[t.id(`dc${defender}`)]!;
      assert.equal(raised.zone, "play");
      assert.equal(raised.controllerId, P1, "under P1's control");
      assert.ok(t.engine.state.battle!.attackingParty.includes(t.id(`dc${defender}`)), "added to the attacking party");
      assert.equal(raised.depleted, true);
      for (const who of others(count, defender)) assert.equal(zoneOf(t.engine, t.id(`dc${who}`)), "discard");
    }
  });
}

clause(BETRAYAL, "0:ability", "3 seats: it is refused when the controller is not attacking", () => {
  const t = betrayalBoard(3);
  refused(() => playCard(t.engine, P1, t.id("cb"), { selected: { c: [t.id(`dc${P2}`)] } }), "not attacking");
  assert.equal(zoneOf(t.engine, t.id(`dc${P2}`)), "discard");
});

// --- Adroit Marauder ----------------------------------------------------------------------------
// While your opponent has at least 10 cards in their discard pile, this card gains 3 strength and 3 life.

const MARAUDER = "936d6c91-46c0-4f03-a48e-e64e20e1194b";

function marauderBoard(count: number, discards: Record<string, number>) {
  return seatTable(count, [
    { key: "am", def: printing(MARAUDER), owner: P1, zone: "hand" },
    ...bank("deception", 6, P1),
    ...Object.entries(discards).flatMap(([who, n]) => fill(`x${who}`, n, who, "discard"))
  ]);
}

for (const count of TABLES) {
  clause(MARAUDER, "0:rule", `${count} seats: the controller selects the opponent when it enters play; only that opponent's discard pile counts`, () => {
    const opps = opponentsAt(count);
    const first = opps[0]!;
    const last = opps[opps.length - 1]!;
    const base = printing(MARAUDER);
    // `first` has 10 cards, every other opponent 0: selecting `first` gives the bonus
    const hit = marauderBoard(count, Object.fromEntries(opps.map((who) => [who, who === first ? 10 : 0])));
    const asked = playAndSelect(hit, "am", first);
    assert.deepEqual(asked.map((a) => [a.kind, a.playerId]), [["choosePlayer", P1]]);
    assert.equal(hit.engine.getStat(hit.id("am"), "strength"), base.strength! + 3);
    assert.equal(hit.engine.getStat(hit.id("am"), "life"), base.life! + 3);
    // `first` has only 9 while every other opponent has 12: only `first`'s pile counts
    const miss = marauderBoard(count, Object.fromEntries(opps.map((who) => [who, who === first ? 9 : 12])));
    playAndSelect(miss, "am", first);
    assert.equal(miss.engine.getStat(miss.id("am"), "strength"), base.strength!, "no bonus: 9 < 10 in the selected opponent's pile");
    const other = marauderBoard(count, Object.fromEntries(opps.map((who) => [who, who === last ? 9 : 12])));
    playAndSelect(other, "am", last);
    assert.equal(other.engine.getStat(other.id("am"), "strength"), base.strength!, `${last} has 9`);
  });

  clause(MARAUDER, "0:rule", `${count} seats: when the selected opponent is eliminated the controller selects again and only the new opponent's discard pile counts`, () => {
    const opps = opponentsAt(count);
    const base = printing(MARAUDER);
    const t = marauderBoard(count, Object.fromEntries(opps.map((who) => [who, who === P2 ? 10 : who === P3 ? 3 : 11])));
    playAndSelect(t, "am", P2);
    assert.equal(t.engine.getStat(t.id("am"), "strength"), base.strength! + 3);
    eliminate(t.engine, P2);
    if (count === 4) {
      assert.equal(pendingOf(t.engine)?.kind, "choosePlayer", "two opponents left: the controller selects again");
      assert.deepEqual(candidatesOf(t.engine), [P3, "p4"]);
      answer(t.engine, "choosePlayer", { playerId: P3 });
    } else assert.equal(pendingOf(t.engine), undefined, "one opponent left: nobody is asked");
    assert.equal(t.engine.getStat(t.id("am"), "strength"), base.strength!, "P3 has only 3 cards");
  });
}

// --- Sleeping Guard -----------------------------------------------------------------------------
// While your opponent controls a character, this card gains 1 strength and 1 life.

const GUARD = "1b6600af-3910-4cb2-9899-5fbe3006e6ee";

function guardBoard(count: number, chars: Record<string, number>) {
  return seatTable(count, [
    { key: "sg", def: printing(GUARD), owner: P1, zone: "hand" },
    ...bank("rage", 4, P1),
    ...Object.entries(chars).flatMap(([who, n]) => fill(`c${who}`, n, who, "play"))
  ]);
}

for (const count of TABLES) {
  clause(GUARD, "0:rule", `${count} seats: only the selected opponent's characters count`, () => {
    const opps = opponentsAt(count);
    const first = opps[0]!;
    const last = opps[opps.length - 1]!;
    const base = printing(GUARD);
    const has = guardBoard(count, Object.fromEntries(opps.map((who) => [who, who === first ? 1 : 0])));
    const asked = playAndSelect(has, "sg", first);
    assert.deepEqual(asked.map((a) => [a.kind, a.playerId]), [["choosePlayer", P1]]);
    assert.equal(has.engine.getStat(has.id("sg"), "strength"), base.strength! + 1);
    assert.equal(has.engine.getStat(has.id("sg"), "life"), base.life! + 1);
    // only another opponent controls a character
    const none = guardBoard(count, Object.fromEntries(opps.map((who) => [who, who === last ? 2 : 0])));
    playAndSelect(none, "sg", first);
    assert.equal(none.engine.getStat(none.id("sg"), "strength"), base.strength!, "no bonus: the selected opponent controls none");
  });

  clause(GUARD, "0:rule", `${count} seats: when the selected opponent is eliminated the controller selects again and only the new opponent's characters count`, () => {
    const opps = opponentsAt(count);
    const base = printing(GUARD);
    const t = guardBoard(count, Object.fromEntries(opps.map((who) => [who, who === P2 ? 1 : who === P3 ? 0 : 1])));
    playAndSelect(t, "sg", P2);
    assert.equal(t.engine.getStat(t.id("sg"), "strength"), base.strength! + 1);
    eliminate(t.engine, P2);
    if (count === 4) {
      assert.equal(pendingOf(t.engine)?.kind, "choosePlayer");
      assert.deepEqual(candidatesOf(t.engine), [P3, "p4"]);
      answer(t.engine, "choosePlayer", { playerId: P3 });
    } else assert.equal(pendingOf(t.engine), undefined);
    assert.equal(t.engine.getStat(t.id("sg"), "strength"), base.strength!, "P3 controls no character");
  });
}

// --- Incriminating Photograph -------------------------------------------------------------------
// 0: When this card enters play, name a non-resource card.
// 1: The named card cannot be played.

const PHOTO = "e2e4ccac-ad74-483f-ae30-520a67cada44";

function photoBoard(count: number) {
  return seatTable(count, [
    { key: "ph", def: printing(PHOTO), owner: P1, zone: "hand" },
    ...bank("deception", 4, P1),
    ...seatsFor(count).map((who) => ({ key: `ban${who}`, def: character({ name: "Banned One", cost: 0 }), owner: who, zone: "hand" as const })),
    { key: "raze", def: tactic({ name: "Raze", cost: 0, behavior: { abilities: [{ id: "r", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P1, zone: "hand" }
  ]);
}

for (const count of TABLES) {
  clause(PHOTO, "0:rule", `${count} seats: only the controller names the card; no opponent is asked`, () => {
    const t = photoBoard(count);
    playCard(t.engine, P1, t.id("ph"));
    const asked = drive(t.engine, (pc) => {
      if (pc.kind === "nameValue") return { value: "Banned One" };
      return undefined;
    });
    assert.deepEqual(asked.map((a) => [a.kind, a.playerId]), [["nameValue", P1]], "P1 names the card, nobody else is asked anything");
    expectNotAsked(t, { type: "playCard", playerId: P1, cardId: t.id("ph") });
  });

  clause(PHOTO, "1:rule", `${count} seats: the named card cannot be played by any player; removing the Photograph lifts it for everyone`, () => {
    const t = photoBoard(count);
    playCard(t.engine, P1, t.id("ph"));
    drive(t.engine, (pc) => (pc.kind === "nameValue" ? { value: "Banned One" } : undefined));
    const attempt = (who: string): void => {
      refused(() => playCard(t.engine, who, t.id(`ban${who}`)), `${who} cannot play the named card`);
      assert.equal(zoneOf(t.engine, t.id(`ban${who}`)), "hand");
    };
    attempt(P1);
    for (const who of opponentsAt(count)) {
      advanceTo(t, who);
      attempt(who);
    }
    advanceTo(t, P1);
    playCard(t.engine, P1, t.id("raze"), { selected: { t: [t.id("ph")] } });
    drive(t.engine, () => undefined);
    assert.equal(zoneOf(t.engine, t.id("ph")), "discard", "the Photograph left play");
    playCard(t.engine, P1, t.id(`ban${P1}`));
    drive(t.engine, () => undefined);
    assert.equal(zoneOf(t.engine, t.id(`ban${P1}`)), "play", "P1 can play it again");
    for (const who of opponentsAt(count)) {
      advanceTo(t, who);
      playCard(t.engine, who, t.id(`ban${who}`));
      drive(t.engine, () => undefined);
      assert.equal(zoneOf(t.engine, t.id(`ban${who}`)), "play", `${who} can play it too`);
    }
  });
}
