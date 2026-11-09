// Multiplayer clause tests for the 1st Edition Part 2 set (3 and 4 seats), part 6: text with no "your opponent" that must
// still behave at any table size (Auction House, Mercenary's Creed, Guardforce Morphmajig), battle text
// (Dethmürderblüdgeon, Wyrmfang Deathskull).
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
  passUntil,
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
const infl = (t: Table, seat: PlayerId): number => t.engine.state.players[seat]!.influence;
const controllerOf = (t: Table, key: string): PlayerId => t.engine.state.cards[t.id(key)]!.controllerId;
const sorted = (ids: readonly string[]): string[] => [...ids].sort();
const dmg = (t: Table, key: string): number => t.engine.state.cards[t.id(key)]!.damage;

// =================================================================================
// Auction House
// At the start of each player's turn, that player must reveal cards from the top of their deck until a character is
// revealed or no cards are left. If a character is revealed, players take turns bidding starting with the active
// player. Players cannot bid a number greater than the number of detached resources they control. Whichever player
// makes the winning bid pays that many resources and puts the character into play under their control. Shuffle all
// other revealed cards into their owner's deck.
// =================================================================================

const AUCTION = "71886432-9edb-44a6-b9aa-7890b3267cf3";

const bidder = (t: Table): { playerId: PlayerId; highBid: number; maxBid: number } => {
  const pc = t.engine.state.pendingChoice as unknown as { kind: string; playerId: PlayerId; highBid: number; maxBid: number } | undefined;
  assert.equal(pc?.kind, "auctionBid", "a bid is asked for");
  return pc!;
};
const bid = (t: Table, who: PlayerId, amount: number): void => {
  assert.equal(bidder(t).playerId, who, `${who} is the next to bid`);
  answerPending(t.engine, "auctionBid", { bid: amount });
};

/** An Auction House table: `resources` detached staple resources per seat, and a deck for `revealer` of [tactic, character "Prize", filler]. */
function auctionTable(count: Count, resources: Record<PlayerId, number>, previous: PlayerId, revealer: PlayerId): Table {
  return table(
    count,
    [
      { key: "ah", def: printing(AUCTION), owner: P1, zone: "play" },
      { key: "tac", def: drawTactic("Revealed Tactic"), owner: revealer, zone: "deck" },
      { key: "prize", def: character({ name: "Prize" }), owner: revealer, zone: "deck" },
      { key: "rest", def: character({ name: "Rest Of Deck" }), owner: revealer, zone: "deck" },
      ...seatsOf(count).flatMap((seat) => bank("greed", resources[seat] ?? 0, seat)),
      ...perSeat(count, { hand: 1 })
    ],
    previous
  );
}

mpClause(AUCTION, "0:rule", 3, "3 seats: the active player reveals from their own deck, bidding goes clockwise from them, a bid above a player's detached resources is refused, and the winner pays and controls the character", () => {
  // P2's turn: P2 reveals; order P2, P3, P1
  let t = auctionTable(3, { [P1]: 3, [P2]: 2, [P3]: 1 }, P1, P2);
  pass(t, P1);
  orderStart(t);
  assert.equal(t.engine.state.activePlayerId, P2);
  assert.equal(bidder(t).playerId, P2, "bidding starts with the active player");
  assert.equal(bidder(t).maxBid, 2, "no more than the detached resources they control");
  bid(t, P2, 1);
  const p3 = bidder(t);
  assert.equal(p3.playerId, P3, "then clockwise: P3");
  assert.equal(p3.maxBid, 1);
  refused(() => answerPending(t.engine, "auctionBid", { bid: 2 }), "P3 has only 1 detached resource");
  refused(() => answerPending(t.engine, "auctionBid", { bid: 1 }), "a bid must be higher than the last");
  bid(t, P3, 0);
  bid(t, P1, 2);
  bid(t, P2, 0);
  assert.equal(open(t), undefined, "one bidder is left: the auction is over");
  assert.equal(zoneOf(t, "prize"), "play");
  assert.equal(controllerOf(t, "prize"), P1, "the winner controls the character");
  assert.equal(t.engine.getAvailableResourceCount(P1), 1, "P1 paid 2 of its 3 resources");
  assert.equal(t.engine.getAvailableResourceCount(P2), 2, "P2 paid nothing");
  assert.equal(t.engine.getAvailableResourceCount(P3), 1, "P3 paid nothing");
  assert.deepEqual(sorted(deckOf(t, P2)), sorted([t.id("tac"), t.id("rest")]), "the other revealed cards were shuffled into P2's deck, the revealer's own");
  assert.equal(deckOf(t, P1).length + deckOf(t, P3).length, 0);

  // P3 wins with its single resource: P3 controls it, nobody else pays
  t = auctionTable(3, { [P1]: 3, [P2]: 2, [P3]: 1 }, P1, P2);
  pass(t, P1);
  orderStart(t);
  bid(t, P2, 0);
  bid(t, P3, 1);
  bid(t, P1, 0);
  assert.equal(controllerOf(t, "prize"), P3);
  assert.equal(t.engine.getAvailableResourceCount(P3), 0);
  assert.equal(t.engine.getAvailableResourceCount(P2), 2);

  // P1's own turn start: P1 reveals from ITS deck and the order is P1, P2, P3
  t = table(3, [
    { key: "ah", def: printing(AUCTION), owner: P1, zone: "play" },
    { key: "prize", def: character({ name: "Prize" }), owner: P1, zone: "deck" },
    { key: "other", def: character({ name: "Other Deck Character" }), owner: P2, zone: "deck" },
    ...bank("greed", 1, P1), ...bank("greed", 1, P2), ...bank("greed", 1, P3),
    ...perSeat(3, { hand: 1 })
  ], P3);
  pass(t, P3);
  orderStart(t);
  assert.equal(t.engine.state.activePlayerId, P1);
  bid(t, P1, 0);
  bid(t, P2, 1);
  bid(t, P3, 0);
  assert.equal(controllerOf(t, "prize"), P2, "P2 won the character revealed from P1's deck");
  assert.equal(zoneOf(t, "other"), "deck", "P2's deck was not revealed");

  // no character revealed: no bidding
  t = table(3, [
    { key: "ah", def: printing(AUCTION), owner: P1, zone: "play" },
    { key: "tac", def: drawTactic("Only A Tactic"), owner: P2, zone: "deck" },
    ...bank("greed", 1, P1), ...bank("greed", 1, P2), ...bank("greed", 1, P3),
    ...perSeat(3, { hand: 1 })
  ], P1);
  pass(t, P1);
  orderStart(t);
  assert.equal(open(t), undefined, "no character was revealed: nobody bids");
});

mpClause(AUCTION, "0:rule", 4, "4 seats: bidding order is clockwise from the active player, a player with no detached resources passes at once, and a player who has passed is skipped", () => {
  // P3's turn: order P3, P4, P1, P2
  const t = auctionTable(4, { [P1]: 3, [P2]: 3, [P3]: 3, [P4]: 0 }, P2, P3);
  pass(t, P2);
  orderStart(t);
  assert.equal(t.engine.state.activePlayerId, P3);
  const asked: PlayerId[] = [];
  const next = (who: PlayerId, amount: number): void => {
    asked.push(bidder(t).playerId);
    bid(t, who, amount);
  };
  assert.equal(bidder(t).maxBid, 3);
  next(P3, 1);
  assert.equal(bidder(t).playerId, P4, "then clockwise: P4");
  assert.equal(bidder(t).maxBid, 0, "no detached resources: nothing can be bid");
  refused(() => answerPending(t.engine, "auctionBid", { bid: 1 }), "P4 has no detached resources");
  next(P4, 0);
  next(P1, 2);
  next(P2, 3);
  // P3 and P1 cannot beat 3 with 3 resources: they pass; P4 passed already and is skipped
  next(P3, 0);
  next(P1, 0);
  assert.equal(open(t), undefined, "one bidder is left");
  assert.deepEqual(asked, [P3, P4, P1, P2, P3, P1], "clockwise from the active player; P4 was asked once only");
  assert.equal(controllerOf(t, "prize"), P2, "the highest bidder controls the character");
  assert.equal(t.engine.getAvailableResourceCount(P2), 0, "P2 paid 3");
  for (const seat of [P1, P3]) assert.equal(t.engine.getAvailableResourceCount(seat), 3, `${seat} paid nothing`);
  assert.deepEqual(sorted(deckOf(t, P3)), sorted([t.id("tac"), t.id("rest")]), "the other revealed cards were shuffled into P3's deck, the revealer's own");
});

// =================================================================================
// Mercenary's Creed — BRIBE
// Both players may use this ability. Pay 3. -- Take control of the attached character.
// (The controller and every opponent may use it: RQ-mp-6, MPQ-P10.)
// =================================================================================

const CREED = "837d5a93-213d-4e5d-af65-0a6c14c55c7c";

for (const count of [3, 4] as const) {
  mpClause(CREED, "1:ability:bribe", count, `${count} seats: the controller and every opponent may use BRIBE, each paying from their own resources, and nobody is asked for an opponent`, () => {
    const hostOwner = P3;
    for (const user of seatsOf(count)) {
      const t = table(
        count,
        [
          { key: "host", def: character({ name: "Host" }), owner: hostOwner, zone: "play" },
          { key: "creed", def: printing(CREED), owner: P1, zone: "play", attachedToKey: "host" },
          ...seatsOf(count).flatMap((seat) => fund(seat, 1)),
          ...perSeat(count, { hand: 1 })
        ],
        user
      );
      const action = activateAction(t, user, "creed", "bribe");
      assert.deepEqual(t.engine.getPlayRequirements(action as never), [], "no opponent is asked for");
      const ready = Object.fromEntries(t.seats.map((s) => [s, t.engine.getAvailableResourceCount(s)]));
      activate(t, user, "creed", "bribe");
      assert.equal(controllerOf(t, "host"), user, `${user} took control of the attached character`);
      for (const seat of t.seats) assert.equal(ready[seat]! - t.engine.getAvailableResourceCount(seat), seat === user ? 3 : 0, `${seat} paid ${seat === user ? 3 : 0}`);
    }
  });
}

// =================================================================================
// Guardforce Morphmajig
// This card can attack even if it has not been in play under your control since the start of the turn.
// If you play a card, put a token on this card. (Playing a resource doesn't count.)
// If your opponent plays a card, remove a token from this card.
// This card gains 1 strength and 1 life for each token on it.
// =================================================================================

const MORPH = "6af508e9-b4a9-473d-80fc-4c1ecbdd5781";
const tokens = (t: Table): number => t.engine.state.cards[t.id("morph")]!.counters?.token ?? 0;

const plantTactic = tactic({
  name: "Plant",
  cost: 0,
  behavior: {
    abilities: [
      {
        id: "go",
        type: "activated",
        effects: [
          {
            type: "chooserSelectsTarget",
            chooser: "controller",
            declaration: { id: "r", selector: { owner: "self", zone: "hand", type: "resource" }, count: 1, optional: true },
            effects: [{ type: "playResource", target: { type: "selected", id: "r" }, faceDown: "auto", player: "controller" }]
          }
        ]
      }
    ]
  } as never
});

function morphTable(count: Count, inPlay: boolean, counters = 0, active: PlayerId = P1): Table {
  return table(
    count,
    [
      { key: "morph", def: printing(MORPH), owner: P1, zone: inPlay ? "play" : "hand", ...(counters ? { counters: { token: counters } } : {}) },
      ...seatsOf(count).flatMap((seat): CardPlacement[] => [
        { key: `tac-${seat}`, def: drawTactic(`Tactic ${seat} A`), owner: seat, zone: "hand" },
        { key: `tac2-${seat}`, def: drawTactic(`Tactic ${seat} B`), owner: seat, zone: "hand" },
        { key: `res-${seat}`, def: resourceCard({ name: `Resource ${seat}` }), owner: seat, zone: "hand" }
      ]),
      { key: "plant", def: plantTactic, owner: P1, zone: "hand" },
      ...fund(P1),
      ...perSeat(count, { deck: 6 })
    ],
    active
  );
}

for (const count of [3, 4] as const) {
  mpClause(MORPH, "0:rule", count, `${count} seats: it attacks on the turn it enters play, and no other player gates that`, () => {
    for (const target of others(count)) {
      const t = morphTable(count, false);
      playCard(t, P1, "morph");
      assert.equal(zoneOf(t, "morph"), "play");
      const before = infl(t, target);
      fightOut(t, P1, ["morph"], { faction: target });
      assert.ok(infl(t, target) < before, `the Morphmajig attacked ${target} and damaged its faction on the turn it entered play`);
    }
  });

  mpClause(MORPH, "1:rule", count, `${count} seats: only P1's own plays add tokens: a resource does not, and neither do other players' plays`, () => {
    const t = morphTable(count, true);
    assert.equal(tokens(t), 0);
    playCard(t, P1, "tac-p1");
    assert.equal(tokens(t), 1, "P1 played a card: a token");
    // a tactic that plays a resource: the tactic is a card played (one token), the resource it plays is not
    playCard(t, P1, "plant");
    answerPick(t, ["res-p1"]);
    resolvePendingResponses(t.engine);
    assert.equal(zoneOf(t, "res-p1"), "play", "the resource was played");
    assert.equal(tokens(t), 2, "playing the tactic added one token, playing the resource none");
    for (const who of others(count)) {
      passUntil(t, who);
      const before = tokens(t);
      playCard(t, who, `tac-${who}`);
      assert.ok(tokens(t) <= before, `${who} playing a card never adds a token`);
    }
    // with no tokens on it another player's card changes nothing
    const empty = morphTable(count, true, 0, P2);
    playCard(empty, P2, "tac-p2");
    assert.equal(tokens(empty), 0, "no token is added by another player's play, and none goes below 0");
  });

  mpClause(MORPH, "2:rule", count, `${count} seats: any opponent playing a card removes a token (never below 0), P1's own play does not remove one, and nobody is asked`, () => {
    const t = morphTable(count, true, 2);
    let expected = 2;
    const order = others(count);
    for (const who of order) {
      passUntil(t, who);
      playCard(t, who, `tac-${who}`);
      expected = Math.max(0, expected - 1);
      assert.equal(open(t), undefined, "no opponent is selected");
      assert.equal(tokens(t), expected, `after ${who} played a card`);
    }
    // one more opponent card with no tokens left: stays at 0
    playCard(t, t.engine.state.activePlayerId, `tac2-${t.engine.state.activePlayerId}`);
    assert.equal(tokens(t), 0);
    // P1's own play does not remove a token (clause 1 adds one)
    passUntil(t, P1);
    playCard(t, P1, "tac-p1");
    assert.equal(tokens(t), 1, "P1's own card added a token and removed none");
  });

  mpClause(MORPH, "3:rule", count, `${count} seats: it gains 1 strength and 1 life per token, and tokens move only with plays`, () => {
    const t = morphTable(count, true, 2);
    const base = morphTable(count, true, 0);
    const stat = (tab: Table, name: "strength" | "life"): number => tab.engine.getStat(tab.id("morph"), name);
    assert.equal(stat(t, "strength") - stat(base, "strength"), 2, "+2 strength with 2 tokens");
    assert.equal(stat(t, "life") - stat(base, "life"), 2, "+2 life with 2 tokens");
    passUntil(t, P2);
    playCard(t, P2, "tac-p2");
    assert.equal(stat(t, "strength") - stat(base, "strength"), 1, "an opponent's play removed a token: +1 strength");
    assert.equal(stat(t, "life") - stat(base, "life"), 1, "and +1 life");
  });
}

// =================================================================================
// Dethmürderblüdgeon, the Craghammer
// The attached character gains 2 strength and 2 life.
// If the attached character is blocked, your opponent's faction loses 2 influence.
// If the attached character inflicts damage to a faction, you may pick a character. If you do, inflict 2 damage to that
// character.
// If this card would go to your discard pile from play, put it into your hand instead.
// =================================================================================

const DETH = "43a51ff8-16f5-4752-aa41-94d0977d219d";

function dethTable(count: Count, extra: CardPlacement[] = []): Table {
  return table(count, [
    { key: "host", def: character({ name: "Host", strength: 1, life: 4 }), owner: P1, zone: "play" },
    { key: "twin", def: character({ name: "Twin", strength: 1, life: 4 }), owner: P1, zone: "play" },
    { key: "deth", def: printing(DETH), owner: P1, zone: "play", attachedToKey: "host" },
    ...others(count).flatMap((seat): CardPlacement[] => [
      { key: `blk-${seat}`, def: character({ name: `Blocker ${seat}`, strength: 1, life: 9 }), owner: seat, zone: "play" },
      { key: `c-${seat}`, def: character({ name: `Char ${seat}`, life: 9 }), owner: seat, zone: "play" }
    ]),
    ...extra,
    ...perSeat(count, { deck: 2 })
  ]);
}

for (const count of [3, 4] as const) {
  mpClause(DETH, "2:rule", count, `${count} seats: only the attached character gains 2 strength and 2 life`, () => {
    const t = dethTable(count);
    assert.equal(t.engine.getStat(t.id("host"), "strength") - t.engine.getStat(t.id("twin"), "strength"), 2);
    assert.equal(t.engine.getStat(t.id("host"), "life") - t.engine.getStat(t.id("twin"), "life"), 2);
    for (const seat of others(count)) assert.equal(t.engine.getStat(t.id(`c-${seat}`), "life"), 9, `${seat}'s characters gain nothing`);
  });

  mpClause(DETH, "3:rule", count, `${count} seats: when the attached character is blocked the defending player's faction loses 2, and nobody is asked who the opponent is`, () => {
    for (const defender of others(count)) {
      const t = dethTable(count);
      const before = Object.fromEntries(t.seats.map((s) => [s, infl(t, s)]));
      const shown = fightOut(t, P1, ["host"], { faction: defender }, [`blk-${defender}`]);
      assert.ok(!shown.some((entry) => entry.startsWith("choosePlayer")), "!shown.some((entry) => entry.startsWith('choosePlayer'))");
      assert.equal(infl(t, defender), before[defender]! - 2, "the defending player's faction lost 2");
      for (const seat of t.seats.filter((s) => s !== defender)) assert.equal(infl(t, seat), before[seat], `${seat}'s faction is unaffected`);
    }
  });

  mpClause(DETH, "4:rule", count, `${count} seats: after damaging a faction P1 may pick any player's character (no opponent is asked) and 2 damage is inflicted to it`, () => {
    const t = dethTable(count);
    const defender = others(count)[0]!;
    const victim = others(count)[others(count).length - 1]!;
    const pickable = ["host", "twin", ...others(count).map((s) => `c-${s}`)];
    const shown = fightOut(t, P1, ["host"], { faction: defender }, [], (pc) => {
      if (pc.kind !== "selectTargets") return undefined;
      for (const key of pickable) {
        assert.equal(
          t.engine.checkAction({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { c: [t.id(key)] } } } as never).ok,
          true,
          `${key} may be picked`
        );
      }
      return { kind: "selectTargets", selected: { c: [t.id(`c-${victim}`)] } };
    });
    assert.ok(shown.includes("selectTargets:p1"), "P1 picks");
    assert.equal(dmg(t, `c-${victim}`), 2, "2 damage was inflicted to the picked character");
    for (const seat of others(count).filter((s) => s !== victim)) assert.equal(dmg(t, `c-${seat}`), 0);
  });

  mpClause(DETH, "5:rule", count, `${count} seats: it goes to its owner's hand instead of the discard pile, with no other player involved`, () => {
    const smash = tactic({
      name: "Smash Item",
      cost: 0,
      behavior: { abilities: [{ id: "go", type: "activated", targets: [{ id: "t", selector: { type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } as never
    });
    const t = dethTable(count, [{ key: "smash", def: smash, owner: P1, zone: "hand" }]);
    playCard(t, P1, "smash", { selected: { t: [t.id("deth")] } });
    assert.equal(zoneOf(t, "deth"), "hand", "put into its owner's hand instead");
    assert.ok(handOf(t, P1).includes(t.id("deth")), "handOf(t, P1).includes(t.id('deth'))");
    assert.equal(open(t), undefined);
  });
}

// =================================================================================
// Wyrmfang Deathskull
// If you attack, your opponent must pick any number of characters they control. Those characters must block during
// this battle if they can, and only those characters can block.
// =================================================================================

const WYRMFANG = "b5fbadf6-df3d-42bd-b55a-daaa1321b076";

for (const count of [3, 4] as const) {
  mpClause(WYRMFANG, "1:rule", count, `${count} seats: the defending player picks any number of their own characters; only those may block, and no one else is involved`, () => {
    for (const defender of others(count)) {
      const t = table(count, [
        { key: "wyrm", def: printing(WYRMFANG), owner: P1, zone: "play" },
        ...others(count).flatMap((seat): CardPlacement[] => [
          { key: `a-${seat}`, def: character({ name: `Blocker A ${seat}`, life: 9 }), owner: seat, zone: "play" },
          { key: `b-${seat}`, def: character({ name: `Blocker B ${seat}`, life: 9 }), owner: seat, zone: "play" }
        ]),
        ...perSeat(count, { deck: 2 })
      ]);
      t.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [t.id("wyrm")], target: { type: "faction", playerId: defender } } as never);
      resolvePendingResponses(t.engine);
      const prompt = open(t);
      assert.ok(prompt && prompt.kind !== "choosePlayer", "the opponent is not asked for");
      assert.equal(prompt?.playerId, defender, "the defending player picks, nobody else is asked");
      assert.equal(prompt?.kind, "chooseChosenBlockers");
      const offered = (t.engine.state.pendingChoice as unknown as { candidates: string[] }).candidates;
      assert.deepEqual(sorted(offered), sorted([t.id(`a-${defender}`), t.id(`b-${defender}`)]), "only the defending player's own characters are offered");
      answerPending(t.engine, "chooseChosenBlockers", { cardIds: [t.id(`a-${defender}`)] });
      assert.equal(open(t), undefined);
      const blockers = (keys: string[]): boolean => t.engine.checkAction({ type: "declareBlockers", playerId: defender, blockerIds: keys.map((key) => t.id(key)) } as never).ok;
      assert.equal(blockers([`b-${defender}`]), false, "a character that was not picked cannot block");
      assert.equal(blockers([]), false, "the picked character must block if it can");
      assert.equal(blockers([`a-${defender}`]), true, "the picked character blocks");
    }
  });
}
