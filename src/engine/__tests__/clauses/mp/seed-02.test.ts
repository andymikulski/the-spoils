// Multiplayer clause tests for the Seed set (3 and 4 seats), part 2: the remaining clauses whose data changed, and the
// Mountainous Golem (the singular "your opponent cannot take control"). Expectations come from each card's PRINTED text, the
// multiplayer atoms (data/rule-tests/source/multiplayer.txt) and data/card-tests/mp-spec/seed.json.

import assert from "node:assert/strict";
import { bank, location as locationDef } from "../../per-card/_harness.js";
import { resourceCard, tactic } from "../../support/fixtures.js";
import { mpClause, mpExempt, printing, refused } from "../_clause.js";
import {
  activate,
  answerFor,
  character,
  choosePlayer,
  countIn,
  eventsOf,
  fillSeats,
  open,
  opponents,
  P1,
  P2,
  P3,
  P4,
  passTurn,
  playAction,
  playCard,
  playRaw,
  playersNeeded,
  resolvePendingResponses,
  runPrompts,
  seatsOf,
  sizes,
  table,
  type Count,
  type Table
} from "./_seedKit.js";
import type { CardInstanceId, PlayerId } from "../../../../engine.js";

// --- attack legality: what the factions of other players may be attacked --------------------------------

/** The players whose faction `who` could attack right now. */
const factionTargets = (t: Table, who: PlayerId): PlayerId[] =>
  t.engine
    .getAttackOptions(who)
    .targets.flatMap((target) => (target.type === "faction" ? [target.playerId] : []));

/** The ids of cards `who` could attack right now. */
const cardTargets = (t: Table, who: PlayerId): CardInstanceId[] =>
  t.engine
    .getAttackOptions(who)
    .targets.flatMap((target) => (target.type === "card" ? [target.cardId] : []));

/** A tactic that drains all of an opponent's faction influence (used to eliminate a player through real play). */
const KILLER = tactic({
  name: "Killer",
  behavior: { abilities: [{ id: "body", type: "activated", effects: [{ type: "modifyInfluence", player: "opponent", amount: -99 }] }] }
});

// =================================================================================
// High Court of Demands / Theocratic Senate of Marduun
// Your opponent cannot attack your faction.
// =================================================================================

const HIGH_COURT = "61688c92-96d1-40ae-ac64-2975d292b0d9";
const SENATE = "9f06b372-48a0-49eb-a2df-a4c5c923694b";

function barredTable(count: Count, id: string, icon: "greed"): Table {
  return table(count, [
    { key: "wall", def: printing(id), owner: P1, zone: "hand" },
    { key: "killer", def: KILLER, owner: P1, zone: "hand" },
    ...seatsOf(count).map((seat) => ({ key: `c-${seat}`, def: character({ name: `Fighter ${seat}` }), owner: seat, zone: "play" as const })),
    ...fillSeats(count, 1, 4),
    ...bank(icon, 6, P1)
  ]);
}

/** Plays the wall as P1 and chooses `pick` when the static text starts applying. */
function raise(t: Table, pick: PlayerId): void {
  playCard(t, P1, "wall");
  choosePlayer(t, P1, opponents(t), pick);
  assert.equal(open(t), undefined);
}

// The inventory flags these two clauses only because the card's preventsAttackOnFaction data is shared across its clauses; their
// own wording names no player (mp-spec/seed.json: "nothing for this clause beyond clause 1:rule at any table size").
mpExempt(HIGH_COURT, "0:rule", "\"When this card enters play, draw a card.\" names no player: its controller draws, at any table size; the only multiplayer behavior on the card is clause 1:rule, tested below");
mpExempt(SENATE, "2:rule", "\"If a character inflicts damage to this card, inflict the same amount of damage to the character.\" names no player; the only multiplayer behavior on the card is clause 1:rule, tested below");

for (const [name, id, key] of [
  ["High Court of Demands", HIGH_COURT, "1:rule"],
  ["Theocratic Senate of Marduun", SENATE, "1:rule"]
] as const) {
  for (const count of [3, 4] as const) {
    mpClause(id, key, count, `${count} seats: ${name} bars only the opponent P1 chooses from attacking P1's faction, whoever that is; other opponents and other targets stay open`, () => {
      for (const pick of seatsOf(count).slice(1)) {
        const t = barredTable(count, id, "greed");
        raise(t, pick);
        for (let seat = passTurn(t); seat !== P1; seat = passTurn(t)) {
          const targets = factionTargets(t, seat);
          if (seat === pick) assert.equal(targets.includes(P1), false, `${seat} (chosen) cannot attack P1's faction`);
          else assert.equal(targets.includes(P1), true, `${seat} (not chosen) can attack P1's faction`);
          for (const other of t.seats.filter((s) => s !== seat && s !== P1)) assert.equal(targets.includes(other), true, `${seat} can still attack ${other}'s faction`);
          assert.equal(cardTargets(t, seat).includes(t.id("wall")), true, `${seat} can still attack P1's location`);
        }
      }
    });
  }

  mpClause(id, key, 3, `3 seats: the barred opponent's attack on P1's faction is refused by declareAttack, an attack on P1's location or on the other faction is accepted`, () => {
    const t = barredTable(3, id, "greed");
    raise(t, P2);
    assert.equal(passTurn(t), P2);
    refused(() => t.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [t.id("c-p2")], target: { type: "faction", playerId: P1 } } as never), "the chosen opponent attacking P1's faction");
    t.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [t.id("c-p2")], target: { type: "faction", playerId: P3 } } as never);
    assert.equal(t.engine.state.battle?.target.type, "faction");
    const u = barredTable(3, id, "greed");
    raise(u, P2);
    passTurn(u);
    u.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [u.id("c-p2")], target: { type: "card", cardId: u.id("wall") } } as never);
    assert.equal(u.engine.state.battle?.defenderPlayerId, P1);
    const v = barredTable(3, id, "greed");
    raise(v, P2);
    passTurn(v);
    passTurn(v);
    assert.equal(v.engine.state.activePlayerId, P3);
    v.engine.perform({ type: "declareAttack", playerId: P3, attackerIds: [v.id("c-p3")], target: { type: "faction", playerId: P1 } } as never);
    assert.equal(v.engine.state.battle?.defenderPlayerId, P1, "the opponent that was not chosen attacks P1's faction");
  });
}

mpClause(HIGH_COURT, "1:rule", 3, "3 seats: when the chosen opponent is eliminated P1 chooses again (nobody is asked with one opponent left) and the new choice is barred", () => {
  const t = barredTable(3, HIGH_COURT, "greed");
  raise(t, P2);
  playCard(t, P1, "killer", { players: { opponent: P2 } });
  assert.ok(t.engine.state.players[P2]!.eliminated, "P2 is out");
  assert.equal(open(t), undefined, "only P3 is left to choose: nothing is asked");
  assert.equal(passTurn(t), P3, "P2's turn is skipped");
  assert.equal(factionTargets(t, P3).includes(P1), false, "P3 is the new chosen opponent and cannot attack P1's faction");
});

mpClause(HIGH_COURT, "1:rule", 4, "4 seats: when the chosen opponent is eliminated P1 chooses again among the two left, and only the new choice is barred", () => {
  const t = barredTable(4, HIGH_COURT, "greed");
  raise(t, P2);
  playCard(t, P1, "killer", { players: { opponent: P2 } });
  choosePlayer(t, P1, [P3, P4], P4);
  assert.equal(passTurn(t), P3);
  assert.equal(factionTargets(t, P3).includes(P1), true, "P3 is not the new choice");
  assert.equal(passTurn(t), P4);
  assert.equal(factionTargets(t, P4).includes(P1), false, "P4 is the new choice and cannot attack P1's faction");
});

// =================================================================================
// Department of Rejections
// Your opponent must pay 2 to search their deck.
// Your opponent must pay 2 to use a character's ability. (This includes abilities used when the character is not in play.)
// =================================================================================

const REJECTIONS = "0b6dc892-f833-4ab1-b1c5-c185ff0ca0f1";

const searcher = (seat: PlayerId) =>
  tactic({
    name: `Searcher ${seat}`,
    behavior: {
      abilities: [{ id: "body", type: "activated", effects: [{ type: "chooserSelectsTarget", chooser: "controller", declaration: { id: "s", selector: { zone: "deck", owner: "self" }, count: 1, optional: true }, effects: [] }] }]
    }
  });

const workerBehavior = (zone?: "discard") => ({
  abilities: [{ id: "work", type: "activated" as const, ...(zone ? { activationZone: zone } : {}), costs: [{ type: "payResources" as const, amount: 1 }], effects: [{ type: "draw" as const, player: "controller" as const, amount: 1 }] }]
});

function rejectionsTable(count: Count): Table {
  return table(count, [
    { key: "dor", def: printing(REJECTIONS), owner: P1, zone: "hand" },
    ...seatsOf(count).flatMap((seat) => [
      { key: `s-${seat}`, def: searcher(seat), owner: seat, zone: "hand" as const },
      { key: `w-${seat}`, def: character({ name: `Worker ${seat}`, behavior: workerBehavior() }), owner: seat, zone: "play" as const },
      { key: `r-${seat}`, def: character({ name: `Retiree ${seat}`, behavior: workerBehavior("discard") }), owner: seat, zone: "discard" as const },
      ...bank("greed", 8, seat)
    ]),
    ...fillSeats(count, 1, 6)
  ]);
}

/** Plays Department of Rejections: its first paragraph chooses `search`, its second `ability` (each prompt offers every opponent). */
function raiseRejections(t: Table, search: PlayerId, ability: PlayerId): void {
  playCard(t, P1, "dor");
  choosePlayer(t, P1, opponents(t), search);
  choosePlayer(t, P1, opponents(t), ability);
  assert.equal(open(t), undefined);
}

/** Resources `seat` spends doing `act`. */
function spent(t: Table, seat: PlayerId, act: () => void): number {
  const before = t.engine.getAvailableResourceCount(seat);
  act();
  return before - t.engine.getAvailableResourceCount(seat);
}

function searchCost(t: Table, seat: PlayerId): number {
  return spent(t, seat, () => {
    playRaw(t, seat, `s-${seat}`);
    resolvePendingResponses(t.engine);
    if (open(t)?.kind === "chooserSelectsTarget") answerFor(t, seat, "chooserSelectsTarget", { selected: [] });
  });
}

mpClause(REJECTIONS, "0:rule", 3, "3 seats: the first paragraph's chosen opponent pays 2 more to search their own deck; the other opponent and P1 search for free", () => {
  for (const [search, ability] of [
    [P2, P3],
    [P3, P2]
  ] as const) {
    const t = rejectionsTable(3);
    raiseRejections(t, search, ability);
    const costs: Record<string, number> = {};
    costs[P1] = searchCost(t, P1);
    for (let seat = passTurn(t); seat !== P1; seat = passTurn(t)) costs[seat] = searchCost(t, seat);
    assert.deepEqual(costs, { [P1]: 0, [P2]: search === P2 ? 2 : 0, [P3]: search === P3 ? 2 : 0 });
  }
});

mpClause(REJECTIONS, "0:rule", 4, "4 seats: only the one opponent chosen for the search paragraph pays 2 to search; the two other opponents search for free", () => {
  for (const search of [P2, P4]) {
    const t = rejectionsTable(4);
    raiseRejections(t, search, P3);
    const costs: Record<string, number> = { [P1]: searchCost(t, P1) };
    for (let seat = passTurn(t); seat !== P1; seat = passTurn(t)) costs[seat] = searchCost(t, seat);
    assert.deepEqual(costs, { [P1]: 0, [P2]: search === P2 ? 2 : 0, [P3]: 0, [P4]: search === P4 ? 2 : 0 });
  }
});

mpClause(REJECTIONS, "1:rule", 3, "3 seats: the second paragraph chooses its own opponent: P3 pays 2 more for a character's ability (in play and from the discard pile) while P2 and P1 do not; P2 pays 2 to search and P3 does not", () => {
  const t = rejectionsTable(3);
  raiseRejections(t, P2, P3);
  const work = (seat: PlayerId) => spent(t, seat, () => activate(t, seat, `w-${seat}`, "work"));
  const recur = (seat: PlayerId) => spent(t, seat, () => activate(t, seat, `r-${seat}`, "work"));
  const search: Record<string, number> = { [P1]: searchCost(t, P1) };
  const play: Record<string, number> = { [P1]: work(P1) };
  const retire: Record<string, number> = { [P1]: recur(P1) };
  for (let seat = passTurn(t); seat !== P1; seat = passTurn(t)) {
    search[seat] = searchCost(t, seat);
    play[seat] = work(seat);
    retire[seat] = recur(seat);
  }
  assert.deepEqual(play, { [P1]: 1, [P2]: 1, [P3]: 3 }, "a character's ability costs P3 two more");
  assert.deepEqual(retire, { [P1]: 1, [P2]: 1, [P3]: 3 }, "an ability used while the character is not in play costs P3 two more too");
  assert.deepEqual(search, { [P1]: 0, [P2]: 2, [P3]: 0 }, "the first paragraph's opponent (P2) pays to search, P3 does not");
});

mpClause(REJECTIONS, "1:rule", 4, "4 seats: the second paragraph taxes only its chosen opponent's characters, whichever of the three that is", () => {
  for (const pick of [P2, P3, P4]) {
    const t = rejectionsTable(4);
    raiseRejections(t, P2, pick);
    const work = (seat: PlayerId) => spent(t, seat, () => activate(t, seat, `w-${seat}`, "work"));
    const costs: Record<string, number> = { [P1]: work(P1) };
    for (let seat = passTurn(t); seat !== P1; seat = passTurn(t)) costs[seat] = work(seat);
    assert.deepEqual(costs, { [P1]: 1, [P2]: pick === P2 ? 3 : 1, [P3]: pick === P3 ? 3 : 1, [P4]: pick === P4 ? 3 : 1 });
  }
});

// =================================================================================
// Gambling Den
// At the start of your turn, reveal the top card of your deck. If it has numeric cost 3 or less, both players may draw a
// card. Otherwise, both players may play a resource.
// =================================================================================

const DEN = "ee8821d4-4933-4e4b-a632-c4db1b91ea95";

function denTable(count: Count, topCost: number): Table {
  return table(
    count,
    [
      { key: "den", def: printing(DEN), owner: P1, zone: "play" },
      { key: "top", def: character({ name: "Top card", cost: topCost }), owner: P1, zone: "deck" },
      ...seatsOf(count).flatMap((seat) => [
        { key: `res-${seat}`, def: resourceCard({ name: `Spare resource ${seat}` }), owner: seat, zone: "hand" as const },
        ...(seat === P1 ? [] : [{ key: `top-${seat}`, def: character({ name: `Top ${seat}` }), owner: seat, zone: "deck" as const }])
      ]),
      ...fillSeats(count, 1, 3).filter((placement) => !placement.key.startsWith("d-p1-"))
    ],
    seatsOf(count).slice(-1)[0]!
  );
}

for (const count of [3, 4] as const) {
  mpClause(DEN, "0:rule", count, `${count} seats: with a revealed cost of 3 or less P1 and only the chosen opponent may each draw (accept and decline), the other opponents may not`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      for (const [mine, theirs] of [
        [true, true],
        [false, true],
        [true, false],
        [false, false]
      ] as const) {
        const t = denTable(count, 3);
        const before = sizes(t);
        assert.equal(passTurn(t), P1);
        choosePlayer(t, P1, opponents(t), pick);
        assert.ok(eventsOf(t, "cardsRevealed").some((event) => event.viewerId === "all" && event.ownerId === P1 && event.zone === "deck"), "the top card is revealed to everyone");
        const asked = runPrompts(t, (pc) => ({ index: pc.playerId === P1 ? (mine ? 1 : 0) : theirs ? 1 : 0 }));
        assert.deepEqual(asked.map((entry) => entry.playerId), [P1, pick], "only P1 and the chosen opponent are asked, active player first");
        for (const seat of t.seats) {
          const drew = seat === P1 ? mine : seat === pick ? theirs : false;
          assert.equal(before[seat]!.deck - countIn(t, seat, "deck"), drew ? 1 : 0, `${seat} drew ${drew ? 1 : 0}`);
        }
      }
    }
  });

  mpClause(DEN, "0:rule", count, `${count} seats: with a revealed cost above 3 P1 and only the chosen opponent may each play a resource, the other opponents may not`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      for (const [mine, theirs] of [
        [true, true],
        [false, true],
        [true, false],
        [false, false]
      ] as const) {
        const t = denTable(count, 5);
        assert.equal(passTurn(t), P1);
        choosePlayer(t, P1, opponents(t), pick);
        const asked = runPrompts(t, (pc) => {
          if (pc.kind === "chooserSelectsTarget") {
            const wants = pc.playerId === P1 ? mine : theirs;
            return { selected: wants ? [t.id(`res-${pc.playerId}`)] : [] };
          }
          return { faceDown: false };
        });
        assert.deepEqual(asked.filter((entry) => entry.kind === "chooserSelectsTarget").map((entry) => entry.playerId), [P1, pick]);
        for (const seat of t.seats) {
          const played = seat === P1 ? mine : seat === pick ? theirs : false;
          assert.equal(t.engine.state.cards[t.id(`res-${seat}`)]!.zone, played ? "play" : "hand", `${seat} ${played ? "played" : "kept"} its resource`);
        }
      }
    }
  });
}

mpClause(DEN, "0:rule", 3, "3 seats: it fires only at the start of P1's own turn, not at P2's or P3's", () => {
  const t = denTable(3, 3);
  assert.equal(passTurn(t), P1);
  choosePlayer(t, P1, [P2, P3], P2);
  runPrompts(t, () => ({ index: 0 }));
  const revealed = eventsOf(t, "cardsRevealed").length;
  assert.equal(passTurn(t), P2);
  assert.equal(open(t), undefined, "nothing is asked at P2's turn start");
  assert.equal(passTurn(t), P3);
  assert.equal(open(t), undefined, "nothing is asked at P3's turn start");
  assert.equal(eventsOf(t, "cardsRevealed").length, revealed, "nothing is revealed at P2's or P3's turn start");
});

// =================================================================================
// Architectural Restitution  (MP-seed-1: an opponent is attacking)
// Play this only while your opponent is attacking. Pick a location in your discard pile.
// Put the location into play under your control. Change the target of your opponent's attack to the location.
// =================================================================================

const RESTITUTION = "b4c72134-5c83-4a88-af75-e16482ccd0b1";

function restitutionTable(count: Count, active: PlayerId): Table {
  return table(
    count,
    [
      { key: "ar", def: printing(RESTITUTION), owner: P1, zone: "hand" },
      { key: "ar3", def: printing(RESTITUTION), owner: P3, zone: "hand" },
      { key: "loc", def: locationDef({ name: "Rubble" }), owner: P1, zone: "discard" },
      { key: "loc3", def: locationDef({ name: "Ruins" }), owner: P3, zone: "discard" },
      ...seatsOf(count).map((seat) => ({ key: `c-${seat}`, def: character({ name: `Fighter ${seat}` }), owner: seat, zone: "play" as const })),
      ...bank("greed", 6, P1),
      ...bank("greed", 6, P3),
      ...fillSeats(count, 1, 3)
    ],
    active
  );
}

/** Passes priority for whoever holds it until `who` holds it in the open window. */
function passUntil(t: Table, who: PlayerId): void {
  for (let guard = 0; guard < 6; guard++) {
    const window = t.engine.state.responseWindow;
    if (window?.phase === "acceptingResponses" && window.priorityPlayerId === who) return;
    assert.ok(window?.phase === "acceptingResponses", "the response window is open");
    t.engine.perform({ type: "passPriority", playerId: window.priorityPlayerId } as never);
  }
  assert.fail(`${who} never got priority`);
}

mpClause(RESTITUTION, "0:ability", 3, "3 seats: playable while any opponent is attacking (the attacker is the opponent, no choice when P1 is a party, only the attacker legal otherwise), refused when no opponent attacks", () => {
  // P2 attacks P1's faction: P1 plays it as the defender, nobody is asked
  const a = restitutionTable(3, P2);
  a.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [a.id("c-p2")], target: { type: "faction", playerId: P1 } } as never);
  passUntil(a, P1);
  assert.equal(playersNeeded(a, playAction(a, P1, "ar"))?.some((choice) => choice.id === "opponent") ?? false, false, "no opponent choice: the attacker is the other side of the battle");
  playRaw(a, P1, "ar", { selected: { l: [a.id("loc")] } });
  resolvePendingResponses(a.engine);
  assert.equal(a.engine.state.cards[a.id("loc")]!.zone, "play");
  assert.deepEqual(a.engine.state.battle?.target, { type: "card", cardId: a.id("loc") }, "P2's attack is redirected to the location");

  // P2 attacks P3: P1 is not a party; it may still play it, naming the attacker (P3 is not attacking)
  const b = restitutionTable(3, P2);
  b.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [b.id("c-p2")], target: { type: "faction", playerId: P3 } } as never);
  passUntil(b, P1);
  refused(() => playRaw(b, P1, "ar", { players: { opponent: P3 }, selected: { l: [b.id("loc")] } }), "naming P3, who is not attacking");
  playRaw(b, P1, "ar", { players: { opponent: P2 }, selected: { l: [b.id("loc")] } });
  resolvePendingResponses(b.engine);
  assert.deepEqual(b.engine.state.battle?.target, { type: "card", cardId: b.id("loc") }, "P2's attack is redirected to P1's location");

  // P3 defends against P2 and plays its own copy: no choice, P2's attack is redirected to P3's location
  const c = restitutionTable(3, P2);
  c.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [c.id("c-p2")], target: { type: "faction", playerId: P3 } } as never);
  passUntil(c, P3);
  assert.equal(playersNeeded(c, playAction(c, P3, "ar3"))?.some((choice) => choice.id === "opponent") ?? false, false);
  playRaw(c, P3, "ar3", { selected: { l: [c.id("loc3")] } });
  resolvePendingResponses(c.engine);
  assert.deepEqual(c.engine.state.battle?.target, { type: "card", cardId: c.id("loc3") });

  // refused on P1's own turn while P1 attacks, and when nobody is attacking
  const d = restitutionTable(3, P1);
  refused(() => playRaw(d, P1, "ar", { selected: { l: [d.id("loc")] } }), "nobody is attacking");
  d.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [d.id("c-p1")], target: { type: "faction", playerId: P2 } } as never);
  refused(() => playRaw(d, P1, "ar", { selected: { l: [d.id("loc")] } }), "P1 itself is the attacker");
});

// =================================================================================
// Mountainous Golem  (cannotBeTakenControlByOpponent)
// Your opponent cannot take control of this card.
// =================================================================================

const GOLEM = "c5262c5b-9ef2-40ed-9f16-29b391b39a11";

const thief = (seat: PlayerId) =>
  tactic({
    name: `Thief ${seat}`,
    behavior: { abilities: [{ id: "body", type: "activated", targets: [{ id: "t", selector: { type: "character", name: "Mountainous Golem" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });

mpClause(GOLEM, "0:rule", 3, "3 seats: the opponent P1 chooses when the Golem enters play cannot take control of it, the other opponent can", () => {
  for (const [pick, free] of [
    [P2, P3],
    [P3, P2]
  ] as const) {
    const barred = pick;
    for (const [thiefSeat, expectTaken] of [
      [barred, false],
      [free, true]
    ] as const) {
      const t = table(
        3,
        [
          { key: "golem", def: printing(GOLEM), owner: P1, zone: "hand" },
          { key: "thief", def: thief(thiefSeat), owner: thiefSeat, zone: "hand" },
          ...bank("elitism", 14, P1),
          ...fillSeats(3, 1, 3)
        ],
        P1
      );
      playCard(t, P1, "golem");
      choosePlayer(t, P1, [P2, P3], pick);
      while (t.engine.state.activePlayerId !== thiefSeat) passTurn(t);
      playRaw(t, thiefSeat, "thief", { selected: { t: [t.id("golem")] } });
      resolvePendingResponses(t.engine);
      assert.equal(t.engine.state.cards[t.id("golem")]!.controllerId, expectTaken ? thiefSeat : P1, `${thiefSeat} ${expectTaken ? "takes" : "cannot take"} control of the Golem`);
    }
  }
});

// =================================================================================
// Runivoltaic Accumulator  (MP-seed-3: any opponent's attack)
// If your opponent attacks, you may put a token on this card.
// =================================================================================

const ACCUMULATOR = "6f9876af-52c0-46e5-a06f-22e488ba54a8";

function accumulatorTable(attacker: PlayerId): Table {
  return table(
    3,
    [
      { key: "acc", def: printing(ACCUMULATOR), owner: P1, zone: "play" },
      ...seatsOf(3).map((seat) => ({ key: `c-${seat}`, def: character({ name: `Fighter ${seat}` }), owner: seat, zone: "play" as const })),
      ...fillSeats(3, 1, 3)
    ],
    attacker
  );
}

mpClause(ACCUMULATOR, "0:rule", 3, "3 seats: any opponent's attack lets P1 put a token (whoever is attacked, once per attack, declining adds none, no opponent is asked); P1's own attack does not", () => {
  for (const [attacker, defender, fires] of [
    [P2, P1, true],
    [P2, P3, true],
    [P3, P1, true],
    [P3, P2, true],
    [P1, P2, false]
  ] as const) {
    for (const accept of [true, false]) {
      const t = accumulatorTable(attacker);
      t.engine.perform({ type: "declareAttack", playerId: attacker, attackerIds: [t.id(`c-${attacker}`)], target: { type: "faction", playerId: defender } } as never);
      resolvePendingResponses(t.engine);
      const prompts: string[] = [];
      const pc = () => t.engine.state.pendingChoice as unknown as { kind: string; playerId: PlayerId } | undefined;
      let guard = 0;
      while (pc() && guard++ < 6) {
        const current = pc()!;
        prompts.push(`${current.kind}:${current.playerId}`);
        if (current.kind === "chooserSelectsOption") answerFor(t, current.playerId, "chooserSelectsOption", { index: accept ? 1 : 0 });
        else break;
      }
      const tokens = t.engine.state.cards[t.id("acc")]!.counters?.token ?? 0;
      assert.deepEqual(prompts, fires ? [`chooserSelectsOption:${P1}`] : [], `${attacker} attacks ${defender}: only P1 is asked, and only for an opponent's attack`);
      assert.equal(tokens, fires && accept ? 1 : 0, "one token at most per attack");
    }
  }
});
