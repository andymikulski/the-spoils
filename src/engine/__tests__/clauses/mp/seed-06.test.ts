// Multiplayer clause tests for the Seed set (3 and 4 seats), part 6: "your opponent's turn", per-player limits and
// taxes, and effects that name no opponent. Expectations come from each card's PRINTED text, the multiplayer atoms
// (data/rule-tests/source/multiplayer.txt) and data/card-tests/mp-spec/seed.json.

import assert from "node:assert/strict";
import { autoResolveBattle, bank } from "../../per-card/_harness.js";
import { tactic } from "../../support/fixtures.js";
import { mpClause, printing, refused } from "../_clause.js";
import {
  activate,
  answerFor,
  character,
  choosePlayer,
  countIn,
  fillSeats,
  mixedHands,
  open,
  opponents,
  P1,
  P2,
  P3,
  P4,
  passTurn,
  playCard,
  playRaw,
  resolvePendingResponses,
  runPrompts,
  seatsOf,
  table,
  tableWith,
  type CardPlacement,
  type Count,
  type Table
} from "./_seedKit.js";
import type { PlayerId } from "../../../../engine.js";

const KILLER = tactic({
  name: "Killer",
  behavior: { abilities: [{ id: "body", type: "activated", effects: [{ type: "modifyInfluence", player: "opponent", amount: -99 }] }] }
});

/** One depleted character in play per seat (`c-<seat>`). */
const tiredFighters = (count: Count): CardPlacement[] => seatsOf(count).map((seat) => ({ key: `c-${seat}`, def: character({ name: `Fighter ${seat}` }), owner: seat, zone: "play" as const, depleted: true }));

const depleted = (t: Table, key: string): boolean => t.engine.state.cards[t.id(key)]!.depleted;

// =================================================================================
// Mirthless Altar
// At the start of each player's turn, you may pick a character. If you do, it loses 1 strength this turn.
// =================================================================================

const ALTAR = "9e0f839e-f482-42b1-b6d4-4c19dbdcd70a";

function altarTable(count: Count): Table {
  return table(count, [
    { key: "ma", def: printing(ALTAR), owner: P1, zone: "play" },
    ...seatsOf(count).map((seat) => ({ key: `c-${seat}`, def: character({ name: `Fighter ${seat}`, strength: 4 }), owner: seat, zone: "play" as const })),
    ...fillSeats(count, 1, 3)
  ]);
}

for (const count of [3, 4] as const) {
  mpClause(ALTAR, "0:rule", count, `${count} seats: it fires at the start of every player's turn (once each) and P1, the controller and not the active player, picks any character, which loses 1 strength this turn`, () => {
    const t = altarTable(count);
    const targets = seatsOf(count);
    let turn = 0;
    for (let seat = passTurn(t); ; seat = passTurn(t)) {
      const target = targets[(turn + 1) % count]!;
      assert.equal(open(t)?.kind, "chooserSelectsTarget", `the trigger fires at the start of ${seat}'s turn`);
      assert.equal(open(t)?.playerId, P1, "P1 picks, not the active player");
      answerFor(t, P1, "chooserSelectsTarget", { selected: [t.id(`c-${target}`)] });
      assert.equal(open(t), undefined, "once per turn start");
      for (const owner of targets) assert.equal(t.engine.getStat(t.id(`c-${owner}`), "strength"), owner === target ? 3 : 4, `${owner}'s character during ${seat}'s turn`);
      turn++;
      if (seat === P1) break;
    }
    assert.equal(turn, count, "one trigger for each of the players' turns");
  });
}

mpClause(ALTAR, "0:rule", 4, "4 seats: an eliminated player's turn never happens, so it does not fire for it", () => {
  const t = table(4, [
    { key: "ma", def: printing(ALTAR), owner: P1, zone: "play" },
    { key: "killer", def: KILLER, owner: P1, zone: "hand" },
    ...seatsOf(4).map((seat) => ({ key: `c-${seat}`, def: character({ name: `Fighter ${seat}` }), owner: seat, zone: "play" as const })),
    ...fillSeats(4, 1, 3)
  ]);
  playCard(t, P1, "killer", { players: { opponent: P3 } });
  assert.ok(t.engine.state.players[P3]!.eliminated, "t.engine.state.players[P3]!.eliminated");
  const turns: PlayerId[] = [];
  for (let seat = passTurn(t); ; seat = passTurn(t)) {
    turns.push(seat);
    assert.equal(open(t)?.kind, "chooserSelectsTarget");
    answerFor(t, P1, "chooserSelectsTarget", { selected: [] });
    if (seat === P1) break;
  }
  assert.deepEqual(turns, [P2, P4, P1], "P3's turn is skipped, and so is its trigger");
});

// =================================================================================
// Assistant Mud Whisperer / Master Mud Whisperer / P3pp3r 0f 1n54n17y / Phalludrix
// At the start of your opponent's turn, ...
// =================================================================================

const ASSISTANT = "cf55d22c-3b57-4e63-bad2-4ec8ea6478d6";
const MASTER = "3256cb1c-e1b5-4b46-b7a7-7c5fad249ef4";
const PEPPER = "85f2ffda-8d98-4da2-80c6-3d7f0d0b0a6b";
const PHALLUDRIX = "b0ad296c-f76a-4df7-be3a-639662c664b5";

/** The turn starts of every seat after P1, then back to P1: `fn(seat)` runs right after each turn start's prompts were ordered. */
function eachTurnStart(t: Table, fn: (seat: PlayerId) => void): void {
  for (let seat = passTurn(t); ; seat = passTurn(t)) {
    fn(seat);
    if (seat === P1) break;
  }
}

for (const count of [3, 4] as const) {
  mpClause(ASSISTANT, "0:rule", count, `${count} seats: at the start of each opponent's turn (once per turn, none at P1's own) P1 may pick any character and restore it`, () => {
    const t = tableWith(count, [{ key: "am", def: printing(ASSISTANT), owner: P1, zone: "play" }, ...tiredFighters(count), ...fillSeats(count, 1, 3)], {}, P1, true);
    let restored = 0;
    eachTurnStart(t, (seat) => {
      if (seat === P1) {
        assert.equal(open(t), undefined, "nothing fires at the start of P1's own turn");
        return;
      }
      assert.equal(open(t)?.kind, "chooserSelectsTarget", `it fires at the start of ${seat}'s turn`);
      assert.equal(open(t)?.playerId, P1, "P1 picks");
      const target = seatsOf(count).filter((s) => s !== seat && s !== P1).slice(-1)[0] ?? P1;
      answerFor(t, P1, "chooserSelectsTarget", { selected: [t.id(`c-${target}`)] });
      assert.equal(open(t), undefined, "once per opponent turn, not once per opponent");
      assert.equal(depleted(t, `c-${target}`), false, `${target}'s character was restored`);
      restored++;
    });
    assert.equal(restored, count - 1);
  });

  mpClause(MASTER, "0:rule", count, `${count} seats: at the start of each opponent's turn (once per turn, none at P1's own) P1 may restore all the characters P1 controls, and no one else's`, () => {
    const t = tableWith(count, [{ key: "mm", def: printing(MASTER), owner: P1, zone: "play" }, ...tiredFighters(count), ...fillSeats(count, 1, 3)], {}, P1, true);
    eachTurnStart(t, (seat) => {
      if (seat === P1) {
        assert.equal(open(t), undefined, "nothing fires at the start of P1's own turn");
        return;
      }
      assert.equal(open(t)?.kind, "chooserSelectsOption", `it fires at the start of ${seat}'s turn`);
      assert.equal(open(t)?.playerId, P1);
      answerFor(t, P1, "chooserSelectsOption", { index: 1 });
      assert.equal(open(t), undefined);
      assert.equal(depleted(t, "c-p1"), false, "P1's character was restored");
      for (const other of t.seats.filter((s) => s !== P1)) assert.equal(depleted(t, `c-${other}`), true, `${other}'s character was not restored`);
      t.engine.state.cards[t.id("c-p1")]!.depleted = true;
    });
  });

  mpClause(PEPPER, "2:rule", count, `${count} seats: at the start of each opponent's turn the attached character is restored (once per turn, none at P1's own)`, () => {
    const t = tableWith(count, [...tiredFighters(count), { key: "pp", def: printing(PEPPER), owner: P1, zone: "play", attachedToKey: "c-p1" }, ...fillSeats(count, 1, 3)], {}, P1, true);
    eachTurnStart(t, (seat) => {
      if (seat === P1) {
        assert.equal(depleted(t, "c-p1"), true, "nothing restores it at the start of P1's own turn");
        return;
      }
      assert.equal(open(t), undefined, "no prompt: the restore is not optional");
      assert.equal(depleted(t, "c-p1"), false, `restored at the start of ${seat}'s turn`);
      t.engine.state.cards[t.id("c-p1")]!.depleted = true;
    });
  });

  mpClause(PHALLUDRIX, "4:rule", count, `${count} seats: at the start of each opponent's turn P1 may restore the attached character (once per turn, none at P1's own)`, () => {
    for (const accept of [true, false]) {
      const t = tableWith(count, [...tiredFighters(count), { key: "ph", def: printing(PHALLUDRIX), owner: P1, zone: "play", attachedToKey: "c-p1" }, ...fillSeats(count, 1, 3)], {}, P1, true);
      eachTurnStart(t, (seat) => {
        if (seat === P1) {
          assert.equal(open(t), undefined, "nothing fires at the start of P1's own turn");
          return;
        }
        assert.equal(open(t)?.kind, "chooserSelectsOption");
        assert.equal(open(t)?.playerId, P1);
        answerFor(t, P1, "chooserSelectsOption", { index: accept ? 1 : 0 });
        assert.equal(open(t), undefined, "once per opponent turn");
        assert.equal(depleted(t, "c-p1"), !accept);
        t.engine.state.cards[t.id("c-p1")]!.depleted = true;
      });
    }
  });
}

mpClause(PEPPER, "1:rule", 3, "3 seats: the attached character gains 3 strength and 3 life, and no other character does", () => {
  const t = table(3, [
    ...seatsOf(3).map((seat) => ({ key: `c-${seat}`, def: character({ name: `Fighter ${seat}`, strength: 2, life: 3 }), owner: seat, zone: "play" as const })),
    { key: "pp", def: printing(PEPPER), owner: P1, zone: "play", attachedToKey: "c-p1" },
    ...fillSeats(3, 1, 3)
  ]);
  for (const seat of t.seats) {
    assert.equal(t.engine.getStat(t.id(`c-${seat}`), "strength"), seat === P1 ? 5 : 2, `${seat}'s strength`);
    assert.equal(t.engine.getStat(t.id(`c-${seat}`), "life"), seat === P1 ? 6 : 3, `${seat}'s life`);
  }
  passTurn(t);
  assert.equal(t.engine.getStat(t.id("c-p1"), "strength"), 5, "whoever's turn it is");
});

mpClause(PHALLUDRIX, "3:rule", 3, "3 seats: the attached character gains 2 strength whoever controls it", () => {
  for (const host of seatsOf(3)) {
    const t = table(3, [
      ...seatsOf(3).map((seat) => ({ key: `c-${seat}`, def: character({ name: `Fighter ${seat}`, strength: 2 }), owner: seat, zone: "play" as const })),
      { key: "ph", def: printing(PHALLUDRIX), owner: P1, zone: "play", attachedToKey: `c-${host}` },
      ...fillSeats(3, 1, 3)
    ]);
    for (const seat of t.seats) assert.equal(t.engine.getStat(t.id(`c-${seat}`), "strength"), seat === host ? 4 : 2, `${seat}'s character`);
  }
});

mpClause(PHALLUDRIX, "2:ability", 3, "3 seats: EQUIP picks any player's character (X is 0 for an adriel card, otherwise 3), pays X and attaches; no opponent is asked", () => {
  for (const [host, cost] of [
    [P1, 3],
    [P2, 3],
    [P3, 0]
  ] as const) {
    const t = table(3, [
      { key: "ph", def: printing(PHALLUDRIX), owner: P1, zone: "play" },
      ...seatsOf(3).map((seat) => ({ key: `c-${seat}`, def: character({ name: `Fighter ${seat}`, subtype: seat === P3 ? ["adriel"] : [] }), owner: seat, zone: "play" as const })),
      ...fillSeats(3, 1, 3),
      ...bank("rage", 4, P1)
    ]);
    const before = t.engine.getAvailableResourceCount(P1);
    activate(t, P1, "ph", "equip", { selected: { eq: [t.id(`c-${host}`)] } });
    assert.equal(open(t), undefined, "no opponent is asked");
    assert.equal(t.engine.state.cards[t.id("ph")]!.attachedTo, t.id(`c-${host}`), `attached to ${host}'s character`);
    assert.equal(before - t.engine.getAvailableResourceCount(P1), cost, `X is ${cost}`);
  }
});

/** A tactic whose controller makes "the opponent" discard a card of its choice. */
const discarder = (name: string) =>
  tactic({
    name,
    behavior: {
      abilities: [
        {
          id: "body",
          type: "activated",
          effects: [{ type: "chooserSelectsTarget", chooser: "opponent", declaration: { id: "d", selector: { owner: "opponent", zone: "hand" }, count: 1, optional: false }, effects: [{ type: "forEach", selected: "d", effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "discard" }] }] }]
        }
      ]
    }
  });

/** A tactic whose controller discards one of its own cards. */
const selfDiscarder = tactic({
  name: "Self discard",
  behavior: {
    abilities: [{ id: "body", type: "activated", effects: [{ type: "chooserSelectsTarget", chooser: "controller", declaration: { id: "d", selector: { owner: "self", zone: "hand" }, count: 1, optional: false }, effects: [{ type: "forEach", selected: "d", effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "discard" }] }] }] }]
  }
});

for (const count of [3, 4] as const) {
  mpClause(PHALLUDRIX, "1:rule", count, `${count} seats: when an effect controlled by any opponent makes P1 discard, P1 may put the cards back (the opponent is that effect's controller, nobody is asked); another player's discard is not covered`, () => {
    for (const actor of seatsOf(count).slice(1)) {
      const t = table(
        count,
        [
          { key: "ph", def: printing(PHALLUDRIX), owner: P1, zone: "play" },
          ...seatsOf(count).map((seat) => ({ key: `dis-${seat}`, def: discarder(`Discard ${seat}`), owner: seat, zone: "hand" as const })),
          ...mixedHands(count)
        ],
        actor
      );
      playRaw(t, actor, `dis-${actor}`, { players: { opponent: P1 } });
      const asked = runPrompts(t, (pc) => {
        if (pc.kind === "chooserSelectsTarget") return { selected: [t.id("ch0-p1")] };
        if (pc.kind === "replacementChoice") return { apply: true };
        throw new Error(`unexpected prompt ${pc.kind}`);
      });
      assert.ok(asked.some((entry) => entry.kind === "replacementChoice" && entry.playerId === P1), `P1 is offered the replacement for ${actor}'s effect`);
      assert.equal(asked.some((entry) => entry.kind === "choosePlayer"), false, "no opponent is chosen: the effect's controller is it");
      assert.equal(t.engine.state.cards[t.id("ch0-p1")]!.zone, "hand", "P1 put the discarded card back into its hand");

      // a discard that another opponent makes another player do: P1's cards are not involved
      const other = seatsOf(count).filter((s) => s !== P1 && s !== actor)[0]!;
      const u = table(count, [{ key: "ph", def: printing(PHALLUDRIX), owner: P1, zone: "play" }, { key: "dis", def: discarder("Discard"), owner: other, zone: "hand" }, ...mixedHands(count)], other);
      playRaw(u, other, "dis", { players: { opponent: actor } });
      const askedOther = runPrompts(u, (pc) => {
        if (pc.kind === "chooserSelectsTarget") return { selected: [u.id(`ch0-${actor}`)] };
        throw new Error(`unexpected prompt ${pc.kind}`);
      });
      assert.deepEqual(askedOther.map((entry) => entry.playerId), [actor], "only the discarding player is asked; P1 is not");
      assert.equal(u.engine.state.cards[u.id(`ch0-${actor}`)]!.zone, "discard");
    }
  });
}

mpClause(PHALLUDRIX, "1:rule", 3, "3 seats: P1 discarding to P1's own effect is not covered", () => {
  const t = table(3, [{ key: "ph", def: printing(PHALLUDRIX), owner: P1, zone: "play" }, { key: "self", def: selfDiscarder, owner: P1, zone: "hand" }, ...mixedHands(3)]);
  playRaw(t, P1, "self");
  const asked = runPrompts(t, (pc) => {
    if (pc.kind === "chooserSelectsTarget") return { selected: [t.id("ch0-p1")] };
    throw new Error(`unexpected prompt ${pc.kind}`);
  });
  assert.deepEqual(asked.map((entry) => entry.kind), ["chooserSelectsTarget"], "no replacement is offered");
  assert.equal(t.engine.state.cards[t.id("ch0-p1")]!.zone, "discard");
});

// =================================================================================
// Auspicious Tax
// The attached character's controller must pay 3 to attack with it.
// =================================================================================

const TAX = "95b246cb-d25a-44c2-84ae-fc1e5ec73389";

function taxTable(count: Count, cards: CardPlacement[] = []): Table {
  return table(count, [
    ...seatsOf(count).map((seat) => ({ key: `c-${seat}`, def: character({ name: `Fighter ${seat}` }), owner: seat, zone: "play" as const })),
    { key: "tax", def: printing(TAX), owner: P1, zone: "play", attachedToKey: "c-p2" },
    ...fillSeats(count, 1, 3),
    ...seatsOf(count).flatMap((seat) => bank("greed", 5, seat)),
    ...cards
  ]);
}

for (const count of [3, 4] as const) {
  mpClause(TAX, "1:rule", count, `${count} seats: the attached character's controller (P2) pays 3 to attack with it; P1 (who controls the Tax) and the other players pay nothing`, () => {
    const t = taxTable(count);
    const taxes: Record<string, number> = {};
    for (let seat = P1 as PlayerId; ; seat = passTurn(t)) {
      taxes[seat] = t.engine.getAttackOptions(seat, [t.id(`c-${seat}`)]).tax;
      if (seat === P2) {
        const before = t.engine.getAvailableResourceCount(P2);
        t.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [t.id("c-p2")], target: { type: "faction", playerId: P3 } } as never);
        assert.equal(before - t.engine.getAvailableResourceCount(P2), 3, "P2 actually paid 3 to attack");
        break;
      }
    }
    assert.deepEqual(taxes, { [P1]: 0, [P2]: 3 });
    const u = taxTable(count);
    passTurn(u);
    passTurn(u);
    assert.equal(u.engine.getAttackOptions(P3, [u.id("c-p3")]).tax, 0, "P3's own attack is not taxed");
  });
}

mpClause(TAX, "1:rule", 3, "3 seats: if P1 takes control of the attached character, P1 pays on P1's attacks and P2 no longer pays", () => {
  const thief = tactic({ name: "Thief", behavior: { abilities: [{ id: "body", type: "activated", targets: [{ id: "t", selector: { type: "character" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }] }] } });
  const t = taxTable(3, [{ key: "thief", def: thief, owner: P1, zone: "hand" }]);
  playCard(t, P1, "thief", { selected: { t: [t.id("c-p2")] } });
  assert.equal(t.engine.state.cards[t.id("c-p2")]!.controllerId, P1);
  assert.equal(passTurn(t), P2);
  assert.equal(passTurn(t), P3);
  assert.equal(passTurn(t), P1);
  assert.equal(t.engine.getAttackOptions(P1, [t.id("c-p2")]).tax, 3, "P1 pays for attacks with the stolen character");
  assert.equal(t.engine.getAttackOptions(P1, [t.id("c-p1")]).tax, 0);
});

// =================================================================================
// Lucky Charm
// When this card enters play, draw a card. Your opponent must pay 1 to pick a character you control.
// =================================================================================

const CHARM = "209f6903-153c-455b-b211-b7fa87571220";

for (const count of [3, 4] as const) {
  mpClause(CHARM, "0:rule", count, `${count} seats: when it enters play under P1, P1 draws a card and no other player draws`, () => {
    const t = table(count, [{ key: "lc", def: printing(CHARM), owner: P1, zone: "hand" }, ...mixedHands(count), ...bank("deception", 3, P1)]);
    const before = Object.fromEntries(t.seats.map((seat) => [seat, countIn(t, seat, "deck")]));
    playCard(t, P1, "lc");
    if (open(t)?.kind === "choosePlayer") choosePlayer(t, P1, opponents(t), P2);
    for (const seat of t.seats) assert.equal(before[seat]! - countIn(t, seat, "deck"), seat === P1 ? 1 : 0, `${seat}'s draw`);
  });
}

const poke = tactic({
  name: "Poke",
  behavior: { abilities: [{ id: "body", type: "activated", targets: [{ id: "t", selector: { type: "character" }, count: 1 }], effects: [] }] }
});

for (const count of [3, 4] as const) {
  mpClause(CHARM, "1:rule", count, `${count} seats: only the opponent P1 chose (when the Charm entered play) pays 1 to pick a character P1 controls; picking anyone else's character, or any other opponent picking P1's, is free`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      for (const actor of seatsOf(count).slice(1)) {
        for (const victim of [P1, seatsOf(count).filter((s) => s !== actor && s !== P1)[0]!]) {
          const t = table(
            count,
            [
              { key: "lc", def: printing(CHARM), owner: P1, zone: "hand" },
              ...seatsOf(count).map((seat) => ({ key: `poke-${seat}`, def: poke, owner: seat, zone: "hand" as const })),
              ...mixedHands(count),
              ...bank("deception", 2, P1),
              ...seatsOf(count).flatMap((seat) => bank("rage", 3, seat))
            ],
            P1
          );
          playCard(t, P1, "lc");
          choosePlayer(t, P1, opponents(t), pick);
          while (t.engine.state.activePlayerId !== actor) passTurn(t);
          const before = t.engine.getAvailableResourceCount(actor);
          playCard(t, actor, `poke-${actor}`, { selected: { t: [t.id(`c-${victim}`)] } });
          const paid = before - t.engine.getAvailableResourceCount(actor);
          assert.equal(paid, actor === pick && victim === P1 ? 1 : 0, `${actor} picks ${victim}'s character (${pick} was chosen)`);
        }
      }
    }
  });
}

// =================================================================================
// Narrow Passage
// Players can attack only once each turn.
// =================================================================================

const PASSAGE = "a29a0fb1-c505-410f-8a78-55380f603326";

function passageTable(count: Count): Table {
  return table(count, [
    { key: "np", def: printing(PASSAGE), owner: P1, zone: "play" },
    ...seatsOf(count).flatMap((seat) => [
      { key: `a-${seat}`, def: character({ name: `Raider ${seat}` }), owner: seat, zone: "play" as const },
      { key: `b-${seat}`, def: character({ name: `Second ${seat}` }), owner: seat, zone: "play" as const }
    ]),
    ...fillSeats(count, 1, 3)
  ]);
}

/** `seat` attacks once and the battle is played out; then a second attack declaration of the same turn is refused. */
function attackOnceThenRefused(t: Table, seat: PlayerId): void {
  const defender = t.seats[(t.seats.indexOf(seat) + 1) % t.seats.length]!;
  t.engine.perform({ type: "declareAttack", playerId: seat, attackerIds: [t.id(`a-${seat}`)], target: { type: "faction", playerId: defender } } as never);
  resolvePendingResponses(t.engine);
  t.engine.perform({ type: "declareBlockers", playerId: defender, blockerIds: [] } as never);
  autoResolveBattle(t.engine);
  assert.equal(t.engine.state.battle, undefined, "the first battle is over");
  assert.ok(t.engine.getAttackOptions(seat).blockedReason, `${seat} has no attack left this turn`);
  refused(() => t.engine.perform({ type: "declareAttack", playerId: seat, attackerIds: [t.id(`b-${seat}`)], target: { type: "faction", playerId: defender } } as never), `${seat}'s second attack this turn`);
}

for (const count of [3, 4] as const) {
  mpClause(PASSAGE, "0:rule", count, `${count} seats: every player, P1 included, may attack once on their own turn; a second attack declaration is refused`, () => {
    const t = passageTable(count);
    attackOnceThenRefused(t, P1);
    for (let seat = passTurn(t); seat !== P1; seat = passTurn(t)) attackOnceThenRefused(t, seat);
    assert.equal(t.engine.getAttackOptions(P1).blockedReason, undefined, "the limit resets with each player's turn");
  });
}

// =================================================================================
// 53cur17y 5y573m
// COVERT parties can be blocked by characters without COVERT.
// =================================================================================

const SECURITY = "7e73ff48-a894-408a-a176-76bedfebc97d";

const covertBehavior = { keywords: ["covert" as const] };

function securityTable(withCard: boolean, active: PlayerId): Table {
  return table(
    3,
    [
      ...(withCard ? [{ key: "sec", def: printing(SECURITY), owner: P1, zone: "play" as const }] : []),
      ...seatsOf(3).flatMap((seat) => [
        { key: `cov-${seat}`, def: character({ name: `Covert ${seat}`, behavior: covertBehavior }), owner: seat, zone: "play" as const },
        { key: `plain-${seat}`, def: character({ name: `Plain ${seat}` }), owner: seat, zone: "play" as const }
      ]),
      ...fillSeats(3, 1, 3)
    ],
    active
  );
}

function covertAttackThenBlock(withCard: boolean, attacker: PlayerId, defender: PlayerId): void {
  const t = securityTable(withCard, attacker);
  t.engine.perform({ type: "declareAttack", playerId: attacker, attackerIds: [t.id(`cov-${attacker}`)], target: { type: "faction", playerId: defender } } as never);
  resolvePendingResponses(t.engine);
  t.engine.perform({ type: "declareBlockers", playerId: defender, blockerIds: [t.id(`plain-${defender}`)] } as never);
  assert.deepEqual(t.engine.state.battle?.blockingParty, [t.id(`plain-${defender}`)], `${defender}'s non-COVERT character blocks ${attacker}'s COVERT party`);
}

mpClause(SECURITY, "0:rule", 3, "3 seats: whoever controls the attacking COVERT party, the defender's characters without COVERT may block it (P1 attacks P2, P2 attacks P3, P3 attacks P1); no opponent is asked", () => {
  covertAttackThenBlock(true, P1, P2);
  covertAttackThenBlock(true, P2, P3);
  covertAttackThenBlock(true, P3, P1);
  for (const [attacker, defender] of [
    [P1, P2],
    [P2, P3]
  ] as const) {
    const t = securityTable(false, attacker);
    t.engine.perform({ type: "declareAttack", playerId: attacker, attackerIds: [t.id(`cov-${attacker}`)], target: { type: "faction", playerId: defender } } as never);
    resolvePendingResponses(t.engine);
    refused(() => t.engine.perform({ type: "declareBlockers", playerId: defender, blockerIds: [t.id(`plain-${defender}`)] } as never), "without the card a non-COVERT character cannot block a COVERT party");
  }
  const t = securityTable(true, P1);
  assert.equal(open(t), undefined, "no opponent is asked");
});

// =================================================================================
// Watchtower
// If a character enters play under your opponent's control, inflict 1 damage to it.
// =================================================================================

const WATCHTOWER = "b92743d8-0593-4d1a-87c2-9dc5b4520945";

for (const count of [3, 4] as const) {
  mpClause(WATCHTOWER, "1:rule", count, `${count} seats: a character entering play under any opponent's control takes 1 damage, one entering under P1's does not, and no opponent is chosen`, () => {
    const t = table(count, [
      { key: "wt", def: printing(WATCHTOWER), owner: P1, zone: "play" },
      ...seatsOf(count).map((seat) => ({ key: `new-${seat}`, def: character({ name: `Newcomer ${seat}`, cost: 0, life: 3 }), owner: seat, zone: "hand" as const })),
      ...fillSeats(count, 1, 3)
    ]);
    const damage = (seat: PlayerId) => t.engine.state.cards[t.id(`new-${seat}`)]!.damage;
    playCard(t, P1, `new-${P1}`);
    assert.equal(t.engine.state.cards[t.id(`new-${P1}`)]!.zone, "play");
    assert.equal(damage(P1), 0, "P1's own character is not damaged");
    assert.equal(open(t), undefined);
    for (let seat = passTurn(t); seat !== P1; seat = passTurn(t)) {
      playCard(t, seat, `new-${seat}`);
      assert.equal(t.engine.state.cards[t.id(`new-${seat}`)]!.zone, "play");
      assert.equal(open(t), undefined, "no opponent is asked");
      assert.equal(damage(seat), 1, `${seat}'s character took 1 damage`);
    }
  });
}
