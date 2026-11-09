// Multiplayer clause tests for the 1st Edition Part 2 set (3 and 4 seats), part 4: triggered abilities whose "your
// opponent" is chosen when the trigger resolves, and event-driven text.
// Expectations come from each card's PRINTED text, the multiplayer atoms (data/rule-tests/source/multiplayer.txt) and
// data/card-tests/mp-spec/1st-edition-part-2.json.

import assert from "node:assert/strict";
import { bank } from "../../per-card/_harness.js";
import { mpClause, printing, refused } from "../_clause.js";
import {
  activate,
  activateAction,
  answerPending,
  answerPick,
  assertAsksOpponent,
  character,
  choosePlayer,
  deckOf,
  drawTactic,
  events,
  fightOut,
  fillers,
  finisher,
  fund,
  handOf,
  item,
  killTactic,
  open,
  openPick,
  orderStart,
  P1,
  P2,
  P3,
  P4,
  pass,
  perSeat,
  pickableBy,
  pickFrom,
  playAction,
  playCard,
  resolvePendingResponses,
  resourceCard,
  seatsOf,
  stack,
  table,
  tactic,
  zoneOf,
  type CardPlacement,
  type Count,
  type PlayerId,
  type Table
} from "./_support1stEditionPart2.js";

const others = (count: Count): PlayerId[] => seatsOf(count).slice(1);
const handKeys = (seat: PlayerId, n: number): string[] => Array.from({ length: n }, (_, i) => `h-${seat}-${i}`);
const deckKeys = (seat: PlayerId, n: number): string[] => Array.from({ length: n }, (_, i) => `d-${seat}-${i}`);
const idsOf = (t: Table, keys: string[]): string[] => keys.map((key) => t.id(key));
const sorted = (ids: readonly string[]): string[] => [...ids].sort();
const infl = (t: Table, seat: PlayerId): number => t.engine.state.players[seat]!.influence;
const controllerOf = (t: Table, key: string): PlayerId => t.engine.state.cards[t.id(key)]!.controllerId;
const snapshot = (t: Table) => Object.fromEntries(t.seats.map((seat) => [seat, { hand: [...handOf(t, seat)], deck: [...deckOf(t, seat)], discard: [...t.engine.state.players[seat]!.discard] }]));
const untouched = (t: Table, before: ReturnType<typeof snapshot>, seat: PlayerId): void => {
  assert.deepEqual(handOf(t, seat), before[seat]!.hand, `${seat}: hand unchanged`);
  assert.deepEqual(deckOf(t, seat), before[seat]!.deck, `${seat}: deck unchanged`);
  assert.deepEqual(t.engine.state.players[seat]!.discard, before[seat]!.discard, `${seat}: discard pile unchanged`);
};
const killOwn = (t: Table, key: string): void => playCard(t, P1, "kill", { selected: { t: [t.id(key)] } });

/** Passes the turn around the table until it is `who`'s turn (every turn start is settled, trigger-ordering prompts answered). */
function passUntil(t: Table, who: PlayerId): void {
  for (let guard = 0; t.engine.state.activePlayerId !== who && guard < 10; guard++) {
    pass(t, t.engine.state.activePlayerId);
    orderStart(t);
  }
}

// =================================================================================
// Arcanology Recruitment Officer
// At the start of your turn, you must pick a character your opponent controls. That character gains COVERT until the
// start of your next turn.
// =================================================================================

const OFFICER = "7b05e4a8-cff1-441c-91bc-de6f671f8b12";

for (const count of [3, 4] as const) {
  mpClause(OFFICER, "0:rule", count, `${count} seats: P1 selects an opponent at its own turn start and must pick one of that opponent's characters; it is covert until P1's next turn`, () => {
    const seats = others(count);
    const last = seatsOf(count)[count - 1]!;
    const t = table(
      count,
      [
        { key: "off", def: printing(OFFICER), owner: P1, zone: "play" },
        ...seats.flatMap((seat): CardPlacement[] => [
          { key: `c-${seat}-a`, def: character({ name: `Char ${seat} A` }), owner: seat, zone: "play" },
          { key: `c-${seat}-b`, def: character({ name: `Char ${seat} B` }), owner: seat, zone: "play" }
        ])
      ],
      last
    );
    const covert = (key: string): boolean => t.engine.hasKeyword(t.id(key), "covert");
    // P1's turn starts
    pass(t, last);
    orderStart(t);
    choosePlayer(t, P1, seats, seats[0]!);
    pickFrom(t, P1, [`c-${seats[0]}-a`, `c-${seats[0]}-b`], [`c-${seats[0]}-a`]);
    assert.equal(open(t), undefined);
    assert.ok(covert(`c-${seats[0]}-a`), "the picked character gains COVERT");
    for (const seat of seats) for (const part of ["a", "b"]) if (!(seat === seats[0] && part === "a")) assert.equal(covert(`c-${seat}-${part}`), false, "no other character does");
    // it does not fire at the start of any other player's turn
    for (const seat of seats) {
      pass(t, t.engine.state.activePlayerId);
      assert.equal(t.engine.state.activePlayerId, seat);
      orderStart(t);
      assert.equal(open(t), undefined, `nothing is asked at the start of ${seat}'s turn`);
    }
    // P1's next turn: the previous cover ends, and a new opponent is selected independently
    pass(t, last);
    orderStart(t);
    assert.equal(t.engine.state.activePlayerId, P1);
    choosePlayer(t, P1, seats, seats[1]!);
    pickFrom(t, P1, [`c-${seats[1]}-a`, `c-${seats[1]}-b`], [`c-${seats[1]}-b`]);
    assert.ok(covert(`c-${seats[1]}-b`), "covert(`c-${seats[1]}-b`)");
    assert.equal(covert(`c-${seats[0]}-a`), false, "the first pick is no longer covert");
  });
}

// =================================================================================
// Gnat
// If this card leaves play, your opponent must discard a card.
// =================================================================================

const GNAT = "d65c3554-ba90-45e8-ab26-4f8d42d498b7";

for (const count of [3, 4] as const) {
  mpClause(GNAT, "0:rule", count, `${count} seats: when it leaves play only the opponent P1 selects discards a card of their choice`, () => {
    for (const pick of others(count)) {
      const t = table(count, [
        { key: "gnat", def: printing(GNAT), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        ...perSeat(count, { hand: 2, deck: 2 })
      ]);
      const before = snapshot(t);
      killOwn(t, "gnat");
      choosePlayer(t, P1, t.seats.slice(1), pick);
      pickFrom(t, pick, handKeys(pick, 2), [handKeys(pick, 2)[1]!]);
      assert.equal(zoneOf(t, handKeys(pick, 2)[1]!), "discard", "the selected opponent discarded the card of its choice");
      assert.equal(open(t), undefined);
      for (const seat of t.seats.filter((s) => s !== pick)) assert.deepEqual(handOf(t, seat).filter((id) => before[seat]!.hand.includes(id)), seat === P1 ? handOf(t, P1) : before[seat]!.hand, `${seat}'s hand is unchanged`);
    }
  });
}

// =================================================================================
// Infatuated Armchair
// If this card leaves play, you may look at the top 2 cards of either deck. If you do, put 1 card on the bottom of
// that deck and 1 card on the top. Draw a card.
// =================================================================================

const ARMCHAIR = "ab4bed28-7665-4017-b829-4c95c366a61e";

/** Answers whatever the Armchair asks: the opponent (when asked) is `pick`, the option is `option` (0 own deck, 1 the opponent's, 2 decline). Returns the kinds of prompts seen. */
function answerArmchair(t: Table, pick: PlayerId, option: number): string[] {
  const seen: string[] = [];
  for (let guard = 0; guard < 8; guard++) {
    const pc = open(t);
    if (!pc) break;
    seen.push(pc.kind);
    if (pc.kind === "choosePlayer") choosePlayer(t, P1, t.seats.slice(1), pick);
    else if (pc.kind === "chooserSelectsOption") answerPending(t.engine, "chooserSelectsOption", { index: option });
    else if (pc.kind === "reorderDeck") {
      const raw = t.engine.state.pendingChoice as unknown as { deckOwnerId: PlayerId; cardIds: string[] };
      answerPending(t.engine, "reorderDeck", { order: [raw.cardIds[1]!], bottom: [raw.cardIds[0]!] });
    } else break;
  }
  return seen;
}

for (const count of [3, 4] as const) {
  mpClause(ARMCHAIR, "0:rule", count, `${count} seats: "either deck" is P1's own deck or the deck of one opponent P1 selects; no other deck is looked at`, () => {
    for (const pick of others(count)) {
      const build = (): Table =>
        table(count, [{ key: "arm", def: printing(ARMCHAIR), owner: P1, zone: "play" }, { key: "kill", def: killTactic(), owner: P1, zone: "hand" }, ...perSeat(count, { hand: 1, deck: 5 })]);
      // the opponent's deck
      let t = build();
      let before = snapshot(t);
      killOwn(t, "arm");
      const seen = answerArmchair(t, pick, 1);
      assert.ok(seen.includes("choosePlayer"), "the opponent is selected");
      assert.equal(open(t), undefined);
      const top = before[pick]!.deck;
      assert.deepEqual(deckOf(t, pick), [top[1]!, top[2]!, top[3]!, top[4]!, top[0]!], "of the selected opponent's deck: 1 card on top, 1 on the bottom");
      assert.equal(handOf(t, P1).length, before[P1]!.hand.length - 1 + 1, "P1 draws a card from its own deck");
      for (const seat of t.seats.filter((s) => s !== pick && s !== P1)) assert.deepEqual(deckOf(t, seat), before[seat]!.deck, `${seat}'s deck was not looked at`);
      assert.deepEqual(deckOf(t, P1), before[P1]!.deck.slice(1), "P1's own deck only lost the card it drew");
      // its own deck
      t = build();
      before = snapshot(t);
      killOwn(t, "arm");
      answerArmchair(t, pick, 0);
      for (const seat of others(count)) assert.deepEqual(deckOf(t, seat), before[seat]!.deck, `${seat}'s deck is untouched when P1 looks at its own`);
      // declining
      t = build();
      before = snapshot(t);
      killOwn(t, "arm");
      answerArmchair(t, pick, 2);
      for (const seat of others(count)) assert.deepEqual(deckOf(t, seat), before[seat]!.deck, `${seat}'s deck is untouched when P1 declines`);
      assert.equal(handOf(t, P1).length, before[P1]!.hand.length - 1 + 1, "P1 still draws a card");
    }
  });
}

// =================================================================================
// Violating Anomaly
// When this card enters play, look at your opponent's hand and pick a card. Your opponent must discard that card.
// If this card leaves play, you may pick a non-resource card. Put that card into its owner's hand. Draw a card.
// =================================================================================

const ANOMALY = "973827cb-fb59-4ce8-9681-1263a14d2e62";

for (const count of [3, 4] as const) {
  mpClause(ANOMALY, "0:rule", count, `${count} seats: when it enters play P1 selects an opponent, picks a card from that opponent's hand only, and that opponent discards it`, () => {
    for (const pick of others(count)) {
      const t = table(count, [{ key: "an", def: printing(ANOMALY), owner: P1, zone: "hand" }, ...fund(P1), ...perSeat(count, { hand: 3, deck: 2 })]);
      const before = snapshot(t);
      playCard(t, P1, "an");
      choosePlayer(t, P1, t.seats.slice(1), pick);
      pickFrom(t, P1, handKeys(pick, 3), [handKeys(pick, 3)[0]!]);
      assert.equal(zoneOf(t, handKeys(pick, 3)[0]!), "discard");
      assert.equal(handOf(t, pick).length, 2);
      for (const seat of t.seats.filter((s) => s !== pick && s !== P1)) untouched(t, before, seat);
    }
  });

  mpClause(ANOMALY, "1:rule", count, `${count} seats: when it leaves play no opponent is selected; P1 may pick any non-resource card in play, which goes to its owner's hand, and draws`, () => {
    const t = table(count, [
      { key: "an", def: printing(ANOMALY), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "stolen", def: character({ name: "Stolen" }), owner: P3, controller: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "res", def: resourceCard({ name: "A Resource" }), owner: P2, zone: "play" },
      ...others(count).map((seat): CardPlacement => ({ key: `c-${seat}`, def: character({ name: `Char ${seat}` }), owner: seat, zone: "play" })),
      ...perSeat(count, { hand: 1, deck: 3 })
    ]);
    const before = snapshot(t);
    killOwn(t, "an");
    assert.equal(open(t)?.kind, "chooserSelectsOption", "the first thing asked is whether to pick: no opponent is selected");
    answerPending(t.engine, "chooserSelectsOption", { index: 0 });
    const prompt = openPick(t);
    assert.equal(prompt.playerId, P1);
    assert.ok(prompt.candidates.includes(t.id("stolen")) && prompt.candidates.includes(t.id("mine")) && others(count).every((seat) => prompt.candidates.includes(t.id(`c-${seat}`))), "any player's non-resource card in play may be picked");
    assert.equal(prompt.candidates.includes(t.id("res")), false, "no resource");
    answerPick(t, ["stolen"]);
    assert.ok(handOf(t, P3).includes(t.id("stolen")), "a card goes to its OWNER's hand");
    assert.equal(handOf(t, P1).length, before[P1]!.hand.length - 1 + 1, "P1 draws a card");
    for (const seat of others(count)) assert.deepEqual(deckOf(t, seat), before[seat]!.deck, `${seat} draws nothing`);
    assert.equal(open(t), undefined);
  });
}

// =================================================================================
// Embezzling Bookkeeper
// When this card enters play, your opponent draws a card.
// =================================================================================

const BOOKKEEPER = "56c1a7f7-7146-43d5-8bd4-2bad9e9522e7";

for (const count of [3, 4] as const) {
  mpClause(BOOKKEEPER, "0:rule", count, `${count} seats: only the opponent P1 selects draws a card`, () => {
    for (const pick of others(count)) {
      const t = table(count, [{ key: "bk", def: printing(BOOKKEEPER), owner: P1, zone: "hand" }, ...fund(P1), ...perSeat(count, { hand: 1, deck: 3 })]);
      const before = snapshot(t);
      playCard(t, P1, "bk");
      choosePlayer(t, P1, t.seats.slice(1), pick);
      assert.equal(handOf(t, pick).length, before[pick]!.hand.length + 1);
      assert.equal(handOf(t, pick).includes(before[pick]!.deck[0]!), true, "the top card of its own deck");
      for (const seat of t.seats.filter((s) => s !== pick && s !== P1)) untouched(t, before, seat);
      assert.equal(handOf(t, P1).length, before[P1]!.hand.length - 1, "P1 drew nothing");
    }
  });
}

// =================================================================================
// Hired Goons
// At the start of your turn, you may pay 2. If you don't, your opponent takes control of this card.
// =================================================================================

const GOONS = "b4d02b5b-bfb5-4384-addd-ba8f738b9940";

/** Settles a turn start of the Goons: `pay` answers the offer; the opponent (when one is asked for) is `pick` among `expected`. Returns the prompts shown. */
function goonsStart(t: Table, pay: boolean, pick: PlayerId, expected: PlayerId[]): string[] {
  const seen: string[] = [];
  for (let guard = 0; guard < 8; guard++) {
    const pc = open(t);
    if (!pc) break;
    seen.push(pc.kind);
    if (pc.kind === "orderTriggers") orderStart(t);
    else if (pc.kind === "choosePlayer") choosePlayer(t, pc.playerId, expected, pick);
    else if (pc.kind === "mayPay") answerPending(t.engine, "mayPay", { pay });
    else break;
  }
  resolvePendingResponses(t.engine);
  return seen;
}

for (const count of [3, 4] as const) {
  mpClause(GOONS, "1:rule", count, `${count} seats: if the controller does not pay, only the opponent it selects takes control, and the new controller faces its own opponents`, () => {
    const seats = others(count);
    const last = seatsOf(count)[count - 1]!;
    const t = table(
      count,
      [{ key: "goons", def: printing(GOONS), owner: P1, zone: "play" }, ...fund(P1), ...fund(P3), ...perSeat(count, { hand: 1, deck: 2 })],
      last
    );
    // P1 pays: nobody takes control
    pass(t, last);
    goonsStart(t, true, P2, seats);
    assert.equal(controllerOf(t, "goons"), P1, "P1 paid: nobody takes control");
    // a round later P1 does not pay and selects P3: P3 takes control, nobody else does
    passUntil(t, last);
    pass(t, last);
    assert.equal(t.engine.state.activePlayerId, P1);
    const seen = goonsStart(t, false, P3, seats);
    assert.ok(seen.includes("choosePlayer"), "the opponent is selected");
    assert.equal(controllerOf(t, "goons"), P3, "P3 takes control");
    // it does not trigger at the start of P2's turn (P2 does not control it)
    pass(t, P1);
    assert.equal(t.engine.state.activePlayerId, P2);
    orderStart(t);
    assert.equal(open(t), undefined, "nothing is asked at the start of a turn of someone who does not control it");
    // P3's turn start: P3 controls it, does not pay, and selects one of ITS opponents (never itself)
    passUntil(t, P3);
    const again = goonsStart(t, false, P1, seatsOf(count).filter((s) => s !== P3));
    assert.ok(again.includes("choosePlayer"), "again.includes('choosePlayer')");
    assert.equal(controllerOf(t, "goons"), P1, "the opponent P3 selected takes control");
  });
}

// =================================================================================
// Hollow Moose
// This card enters play under your opponent's control.
// At the start of your turn, your faction loses 1 influence.
// INFILTRATE — Destroy another item or character you control. -- Your opponent takes control of this card.
// =================================================================================

const MOOSE = "9fb327c0-257b-4685-98ca-de282c1dc6d7";

for (const count of [3, 4] as const) {
  mpClause(MOOSE, "0:rule", count, `${count} seats: it enters play under the control of the opponent P1 selects, and no one else`, () => {
    for (const pick of others(count)) {
      const t = table(count, [{ key: "moose", def: printing(MOOSE), owner: P1, zone: "hand" }, ...fund(P1), ...perSeat(count, { hand: 1, deck: 2 })]);
      playCard(t, P1, "moose");
      choosePlayer(t, P1, t.seats.slice(1), pick);
      assert.equal(zoneOf(t, "moose"), "play");
      assert.equal(controllerOf(t, "moose"), pick, "it is under the selected opponent's control");
      assert.equal(open(t), undefined);
    }
  });

  mpClause(MOOSE, "1:rule", count, `${count} seats: "your faction" is its current controller's: only that controller's faction loses 1 at the start of their turn`, () => {
    const last = seatsOf(count)[count - 1]!;
    // P1 owns the Moose, P2 controls it
    const t = table(
      count,
      [
        { key: "moose", def: printing(MOOSE), owner: P1, controller: P2, zone: "play" },
        { key: "sac", def: character({ name: "Sacrifice" }), owner: P2, zone: "play" },
        ...perSeat(count, { hand: 1, deck: 3 })
      ],
      P1
    );
    const turnStart = (who: PlayerId): Record<PlayerId, number> => {
      const before = Object.fromEntries(t.seats.map((s) => [s, infl(t, s)]));
      passUntil(t, who);
      orderStart(t);
      assert.equal(t.engine.state.activePlayerId, who);
      return before;
    };
    let before = turnStart(P2);
    assert.equal(infl(t, P2), before[P2]! - 1, "P2 controls the Moose: P2's faction loses 1 at the start of P2's turn");
    for (const seat of t.seats.filter((s) => s !== P2)) assert.equal(infl(t, seat), before[seat], `${seat} loses nothing`);
    // at the start of every other player's turn nobody loses anything from it
    for (const who of [...seatsOf(count).slice(2), P1]) {
      before = turnStart(who);
      for (const seat of t.seats) assert.equal(infl(t, seat), before[seat], `no loss at the start of ${who}'s turn (${seat})`);
    }
    void last;
  });

  mpClause(MOOSE, "2:ability:infiltrate", count, `${count} seats: the controller selects one of ITS OWN opponents, who takes control; nobody else does`, () => {
    for (const pick of seatsOf(count).filter((s) => s !== P3)) {
      const t = table(
        count,
        [
          { key: "moose", def: printing(MOOSE), owner: P1, controller: P3, zone: "play" },
          { key: "sac", def: character({ name: "Sacrifice" }), owner: P3, zone: "play" },
          ...perSeat(count, { hand: 1, deck: 3 })
        ],
        P3
      );
      assertAsksOpponent(t, activateAction(t, P3, "moose", "infiltrate"), seatsOf(count).filter((s) => s !== P3));
      activate(t, P3, "moose", "infiltrate", { players: { opponent: pick }, selected: { sac: [t.id("sac")] } });
      assert.equal(zoneOf(t, "sac"), "discard", "another item or character P3 controls was destroyed");
      assert.equal(controllerOf(t, "moose"), pick, "the selected opponent takes control");
    }
  });
}

// =================================================================================
// Master Thief
// If this card is destroyed, you may pick a character, item, location, or resource in your opponent's discard pile.
// If you do, put that card into play under your control.
// =================================================================================

const THIEF = "bfe0fbb0-079e-4f9a-ada8-b0d18e2be880";

for (const count of [3, 4] as const) {
  mpClause(THIEF, "0:rule", count, `${count} seats: only the selected opponent's discard pile is offered (no tactics), and the card enters play under P1's control`, () => {
    for (const pick of others(count)) {
      const t = table(count, [
        { key: "thief", def: printing(THIEF), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        ...others(count).flatMap((seat): CardPlacement[] => [
          { key: `x-${seat}-0`, def: character({ name: `Dead ${seat} 0` }), owner: seat, zone: "discard" },
          { key: `x-${seat}-1`, def: item({ name: `Dead item ${seat}` }), owner: seat, zone: "discard" },
          { key: `x-${seat}-tac`, def: drawTactic(`Dead tactic ${seat}`), owner: seat, zone: "discard" }
        ])
      ]);
      killOwn(t, "thief");
      choosePlayer(t, P1, t.seats.slice(1), pick);
      const prompt = openPick(t);
      assert.equal(prompt.playerId, P1);
      assert.deepEqual(sorted(prompt.candidates), sorted(idsOf(t, [`x-${pick}-0`, `x-${pick}-1`])), "the selected opponent's discard pile only, without tactics");
      answerPick(t, [`x-${pick}-1`]);
      assert.equal(zoneOf(t, `x-${pick}-1`), "play");
      assert.equal(controllerOf(t, `x-${pick}-1`), P1);
      for (const seat of others(count).filter((s) => s !== pick)) assert.equal(zoneOf(t, `x-${seat}-1`), "discard", `${seat}'s discard pile is untouched`);
    }
  });
}

// =================================================================================
// Barbaric Rifleman / Deadly Striker
// When this card enters play, inflict 1 damage to your opponent's faction.
// If this card is destroyed, your opponent's faction loses 4 influence.
// =================================================================================

const RIFLEMAN = "ad4fc0ee-cc07-4927-93ab-c1daeb97798c";
const STRIKER = "46d213bf-f9f2-4e68-93c5-07e004b72e50";

for (const count of [3, 4] as const) {
  mpClause(RIFLEMAN, "0:rule", count, `${count} seats: 1 damage to the faction of the opponent P1 selects, and no other`, () => {
    for (const pick of others(count)) {
      const t = table(count, [{ key: "rf", def: printing(RIFLEMAN), owner: P1, zone: "hand" }, ...fund(P1)]);
      const before = Object.fromEntries(t.seats.map((s) => [s, infl(t, s)]));
      playCard(t, P1, "rf");
      choosePlayer(t, P1, t.seats.slice(1), pick);
      assert.equal(infl(t, pick), before[pick]! - 1);
      for (const seat of t.seats.filter((s) => s !== pick)) assert.equal(infl(t, seat), before[seat], `${seat} is unaffected`);
    }
  });

  mpClause(STRIKER, "0:rule", count, `${count} seats: when it is destroyed only the selected opponent's faction loses 4 influence`, () => {
    for (const pick of others(count)) {
      const t = table(count, [{ key: "st", def: printing(STRIKER), owner: P1, zone: "play" }, { key: "kill", def: killTactic(), owner: P1, zone: "hand" }]);
      const before = Object.fromEntries(t.seats.map((s) => [s, infl(t, s)]));
      killOwn(t, "st");
      choosePlayer(t, P1, t.seats.slice(1), pick);
      assert.equal(infl(t, pick), before[pick]! - 4);
      for (const seat of t.seats.filter((s) => s !== pick)) assert.equal(infl(t, seat), before[seat], `${seat} is unaffected`);
    }
  });
}

// =================================================================================
// Sadistic Colonel
// If your opponent plays a tactic, inflict 2 damage to their faction.
// =================================================================================

const COLONEL = "9bb9052b-c497-4c4c-a22e-e0c2f0edf534";

for (const count of [3, 4] as const) {
  mpClause(COLONEL, "0:rule", count, `${count} seats: any opponent playing a tactic takes 2 damage to its own faction, nobody is asked, and non-tactics and P1's own tactics do nothing`, () => {
    const t = table(count, [
      { key: "col", def: printing(COLONEL), owner: P1, zone: "play" },
      ...seatsOf(count).flatMap((seat): CardPlacement[] => [
        { key: `tac-${seat}`, def: drawTactic(`Tactic ${seat}`), owner: seat, zone: "hand" },
        { key: `chr-${seat}`, def: character({ name: `Newcomer ${seat}`, cost: 0 }), owner: seat, zone: "hand" }
      ]),
      ...perSeat(count, { deck: 4 })
    ]);
    const watch = (who: PlayerId): Record<PlayerId, number> => Object.fromEntries(t.seats.map((s) => [s, infl(t, s)]));
    // P1 plays a tactic on its own turn: nothing
    let before = watch(P1);
    playCard(t, P1, "tac-p1");
    for (const seat of t.seats) assert.equal(infl(t, seat), before[seat], "P1's own tactic does nothing");
    for (const who of others(count)) {
      passUntil(t, who);
      // a non-tactic: nothing
      before = watch(who);
      playCard(t, who, `chr-${who}`);
      for (const seat of t.seats) assert.equal(infl(t, seat), before[seat], `${who} played a character: nothing`);
      // a tactic: 2 damage to that player's own faction, and nobody is asked
      playCard(t, who, `tac-${who}`);
      assert.equal(open(t), undefined, "no opponent is selected: the trigger takes it from the event");
      assert.equal(infl(t, who), before[who]! - 2, `${who}'s faction took 2`);
      for (const seat of t.seats.filter((s) => s !== who)) assert.equal(infl(t, seat), before[seat], `${seat} is unaffected`);
    }
  });
}
