// Multiplayer clause tests for the 2nd Edition set (3 and 4 seats), part 9: lasting text that says "your opponent"
// (Odious Diva, The Ministry of Other Smaller Ministries, Clockman Pickpocket, Cute Cutpurse, Face in the Crowd, The
// Billionaire) and the remaining one-off clauses (Degenerate Molestation, Quotidian Misfire, Tactician Vacation). A lasting
// "your opponent" is selected when the effect starts applying (the card enters play), kept while it applies, and selected
// again when that player is eliminated (RQ-mp-5, MPQ-P2). Expectations come from each card's PRINTED text, the
// multiplayer atoms and data/card-tests/mp-spec/2nd-edition.json.

import assert from "node:assert/strict";
import { bank, character, item, tactic } from "../../per-card/_harness.js";
import { mpClause, printing, settleState } from "../_clause.js";
import { COUNTS, answerFor, drive, ids, killTactic, others, pickable, plain, refused, startOfTurn } from "./_seats2ndEdition.js";
import { choosePlayer, deckOf, handOf, open, P1, P2, P3, playCard, playersNeeded, playRaw, resolvePendingResponses, seatsOf, table, zoneOf, type CardPlacement, type Count, type Table } from "./_seatsSeed2ndFirstP2.js";
import type { PlayerId } from "../../../../engine.js";

const discardOf = (t: Table, who: PlayerId): string[] => t.engine.state.players[who]!.discard;
const handKeys = (seat: PlayerId, n = 3): string[] => Array.from({ length: n }, (_, i) => `hand-${seat}-${i}`);
const hands = (count: Count, n = 3): CardPlacement[] => seatsOf(count).slice(1).flatMap((seat) => plain(`hand-${seat}-`, n, seat, "hand"));
const revealedHands = (t: Table): string[] => [...(t.engine.getFlowView().revealed?.hands ?? [])].sort();
/** The player is out of the game: its faction is at 0 and the state check removes it. */
function eliminate(t: Table, who: PlayerId): void {
  t.engine.state.players[who]!.influence = 0;
  settleState(t.engine);
  assert.ok(t.engine.state.players[who]!.eliminated, `${who} is eliminated`);
}

// =================================================================================
// Degenerate Molestation, clause 1
// Your opponent discards a card. You may play a non-resource card with numeric cost X or less for free, where X is the
// numeric cost of the discarded card. Repeat this card's effect until your opponent has no cards in their hand.
// =================================================================================

const MOLEST = "12cfc4e1-e8f7-431e-a37a-593210181b0c";

function molestTable(count: Count): Table {
  return table(count, [
    { key: "card", def: printing(MOLEST), owner: P1, zone: "hand" },
    ...bank("obsession", 10, P1),
    { key: "one", def: character({ name: "One", cost: 1 }), owner: P1, zone: "hand" },
    { key: "three", def: character({ name: "Three", cost: 3 }), owner: P1, zone: "hand" },
    ...seatsOf(count).slice(1).flatMap((seat): CardPlacement[] =>
      seat === P2
        ? [
            { key: "hand-p2-a", def: character({ name: "A", cost: 2 }), owner: seat, zone: "hand" },
            { key: "hand-p2-b", def: character({ name: "B", cost: 5 }), owner: seat, zone: "hand" },
            { key: "hand-p2-c", def: character({ name: "C", cost: 1 }), owner: seat, zone: "hand" }
          ]
        : plain(`hand-${seat}-`, seat === P3 ? 4 : 2, seat, "hand")
    )
  ]);
}

for (const count of COUNTS) {
  mpClause(MOLEST, "1:rule", count, `${count} seats: only the chosen opponent discards, once per repetition until their hand is empty; the free play is limited by each discarded cost; other hands are never touched or counted`, () => {
    {
      const t = molestTable(count);
      playRaw(t, P1, "card", { players: { opponent: P2 } });
      const offers: string[][] = [];
      const discards: PlayerId[] = [];
      const order = ["hand-p2-a", "hand-p2-b", "hand-p2-c"];
      drive(t, (pc) => {
        if (pc.declaration?.id === "d") {
          discards.push(pc.playerId);
          const next = order.find((key) => zoneOf(t, key) === "hand")!;
          return { kind: "chooserSelectsTarget", selected: ids(t, next) };
        }
        if (pc.kind === "deployForFree") {
          const candidates = [...(pc.candidates as string[])].sort();
          offers.push(candidates);
          assert.equal(pc.playerId, P1, "P1 decides on the free play");
          if (offers.length === 1) {
            refused(() => t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: t.id("three") } } as never), "a cost-3 card after a cost-2 discard");
            return { kind: "deployForFree", cardId: t.id("one") };
          }
          return { kind: "deployForFree" };
        }
        return undefined;
      });
      assert.deepEqual(discards, [P2, P2, P2], "the chosen opponent discards 3 times, once per card in their hand");
      assert.deepEqual(offers[0], ids(t, "one"), "a cost-2 discard allows a cost-1 card and refuses the cost-3 card");
      assert.equal(zoneOf(t, "one"), "play");
      assert.equal(handOf(t, P2).length, 0);
      for (const seat of others(count, P2)) assert.equal(handOf(t, seat).length, seat === P3 ? 4 : 2, `${seat}'s hand is never touched or counted`);
    }
    {
      const t = molestTable(count);
      playRaw(t, P1, "card", { players: { opponent: P3 } });
      const discards: PlayerId[] = [];
      drive(t, (pc) => {
        if (pc.declaration?.id === "d") {
          discards.push(pc.playerId);
          return { kind: "chooserSelectsTarget", selected: [pickable(t)[0]!] };
        }
        return undefined;
      });
      assert.deepEqual(discards, [P3, P3, P3, P3], "choosing the opponent with 4 cards repeats 4 times");
      assert.equal(handOf(t, P2).length, 3, "the other opponent is untouched");
    }
  });
}

// =================================================================================
// Odious Diva
// Your opponent's hand is revealed at all times.
// DISAPPROVE -- COST: Pay 2. Name a card. -- EFFECT: Look at your opponent's hand. Your opponent puts a card with the chosen
// name on the bottom of their deck if they can. If they do, your opponent draws a card.
// =================================================================================

const DIVA = "f2335a40-bdc9-4cf0-9487-b42d424e06fc";

const divaTable = (count: Count, zone: "hand" | "play" = "hand"): Table =>
  table(count, [
    { key: "card", def: printing(DIVA), owner: P1, zone },
    ...bank("obsession", 4, P1),
    { key: "kill", def: killTactic("Odious Diva"), owner: P1, zone: "hand" },
    ...seatsOf(count).slice(1).flatMap((seat): CardPlacement[] => [
      { key: `named-${seat}-0`, def: character({ name: "Named" }), owner: seat, zone: "hand" },
      { key: `named-${seat}-1`, def: character({ name: "Named" }), owner: seat, zone: "hand" },
      { key: `other-${seat}`, def: character({ name: `Other ${seat}` }), owner: seat, zone: "hand" },
      ...plain(`deck-${seat}-`, 3, seat, "deck")
    ])
  ]);

for (const count of COUNTS) {
  mpClause(DIVA, "0:rule", count, `${count} seats: P1 selects the opponent when it enters play; only that opponent's hand is revealed at all times; re-selected if that player is eliminated; nothing stays revealed when it leaves play`, () => {
    for (const opponent of others(count)) {
      const t = divaTable(count);
      playCard(t, P1, "card");
      choosePlayer(t, P1, seatsOf(count).slice(1), opponent);
      assert.deepEqual(revealedHands(t), [opponent], "only the chosen opponent's hand is revealed; the other hands stay hidden");
    }
    // The selected opponent is eliminated: P1 selects again among those left (nobody is asked when one is left).
    {
      const t = divaTable(count);
      playCard(t, P1, "card");
      choosePlayer(t, P1, seatsOf(count).slice(1), P2);
      eliminate(t, P2);
      if (count === 4) {
        choosePlayer(t, P1, [P3, seatsOf(count)[3]!], seatsOf(count)[3]!);
        assert.deepEqual(revealedHands(t), [seatsOf(count)[3]!]);
      } else {
        assert.equal(open(t), undefined, "one opponent left: nobody is asked");
        assert.deepEqual(revealedHands(t), [P3], "the remaining opponent's hand is revealed");
      }
    }
    // It leaves play: no hand stays revealed.
    {
      const t = divaTable(count);
      playCard(t, P1, "card");
      choosePlayer(t, P1, seatsOf(count).slice(1), P2);
      playCard(t, P1, "kill", { selected: { t: ids(t, "card") } });
      assert.equal(zoneOf(t, "card"), "discard");
      assert.deepEqual(revealedHands(t), []);
    }
  });

  mpClause(DIVA, "1:ability:disapprove", count, `${count} seats: P1 names a card; only the opponent chosen for the activation puts such a card on the bottom of their deck and draws; independent of the static clause's choice`, () => {
    for (const opponent of others(count)) {
      const staticChoice = opponent === P2 ? P3 : P2;
      const t = divaTable(count);
      playCard(t, P1, "card");
      choosePlayer(t, P1, seatsOf(count).slice(1), staticChoice);
      assert.deepEqual(playersNeeded(t, { type: "activateAbility", playerId: P1, cardId: t.id("card"), abilityId: "disapprove" } as never), [{ id: "opponent", candidates: seatsOf(count).slice(1) }], "the activation has its own opponent choice");
      const handBefore = Object.fromEntries(t.seats.map((seat) => [seat, handOf(t, seat).length]));
      t.engine.perform({ type: "activateAbility", playerId: P1, cardId: t.id("card"), abilityId: "disapprove", players: { opponent } } as never);
      const asked = drive(t, (pc) => {
        if (pc.kind === "nameValue") return { kind: "nameValue", value: "Named" };
        if (pc.declaration?.id === "x") {
          assert.deepEqual(pickable(t), ids(t, `named-${opponent}-0`, `named-${opponent}-1`).sort(), "only cards named 'Named' in the chosen opponent's hand");
          return { kind: "chooserSelectsTarget", selected: ids(t, `named-${opponent}-1`) };
        }
        return undefined;
      });
      assert.deepEqual(asked.filter((a) => a.decl).map((a) => [a.who, a.decl]), [[opponent, "x"]], "only the chosen opponent picks");
      const bottom = deckOf(t, opponent);
      assert.equal(bottom[bottom.length - 1], t.id(`named-${opponent}-1`), "it went on the bottom of their deck");
      assert.equal(handOf(t, opponent).length, handBefore[opponent]!, "they put one card away and drew one");
      for (const seat of others(count, opponent)) {
        assert.equal(handOf(t, seat).length, handBefore[seat], `${seat}'s hand is untouched`);
        assert.equal(deckOf(t, seat).length, 3, `${seat}'s deck is untouched`);
      }
    }
    // No card with that name: nothing happens and nobody draws.
    {
      const t = divaTable(count);
      playCard(t, P1, "card");
      choosePlayer(t, P1, seatsOf(count).slice(1), P3);
      t.engine.perform({ type: "activateAbility", playerId: P1, cardId: t.id("card"), abilityId: "disapprove", players: { opponent: P2 } } as never);
      drive(t, (pc) => (pc.kind === "nameValue" ? { kind: "nameValue", value: "Nothing" } : undefined));
      assert.equal(handOf(t, P2).length, 3);
      assert.equal(deckOf(t, P2).length, 3, "no draw");
    }
    // One opponent left: nobody is asked.
    const t = divaTable(count);
    for (const gone of others(count, P2)) t.engine.state.players[gone]!.eliminated = { turn: 1 };
    playCard(t, P1, "card");
    assert.equal(open(t), undefined);
    assert.equal(playersNeeded(t, { type: "activateAbility", playerId: P1, cardId: t.id("card"), abilityId: "disapprove" } as never), undefined);
  });
}

// =================================================================================
// Quotidian Misfire
// This turn, if a card is put into a player's hand, put it into their discard pile instead.
// =================================================================================

const MISFIRE = "f45ed56f-654c-44ae-8012-f02d078f3293";

const drawEveryone = (name: string) => tactic({ name, behavior: { abilities: [{ id: "go", type: "activated", effects: [{ type: "forEachPlayer", effects: [{ type: "draw", player: "controller", amount: 1 }] }] }] } as never });
const bounce = () => tactic({ name: "Bounce", behavior: { abilities: [{ id: "go", type: "activated", targets: [{ id: "t", selector: { type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] } as never });

for (const count of COUNTS) {
  mpClause(MISFIRE, "0:rule", count, `${count} seats: this turn a card put into any player's hand goes to that player's discard pile instead; no opponent is chosen; next turn hands work normally`, () => {
    const t = table(count, [
      { key: "card", def: printing(MISFIRE), owner: P1, zone: "hand" },
      ...bank("obsession", 2, P1),
      { key: "draw", def: drawEveryone("Everyone draws"), owner: P1, zone: "hand" },
      { key: "bounce", def: bounce(), owner: P1, zone: "hand" },
      { key: "later", def: drawEveryone("Later draw"), owner: P2, zone: "hand" },
      ...seatsOf(count).flatMap((seat) => [...plain(`deck-${seat}-`, 4, seat, "deck"), ...plain(`field-${seat}-`, 1, seat, "play")])
    ]);
    assert.equal(playersNeeded(t, { type: "playCard", playerId: P1, cardId: t.id("card") } as never), undefined, "no opponent choice is offered");
    playCard(t, P1, "card");
    const handsBefore = Object.fromEntries(t.seats.map((seat) => [seat, handOf(t, seat).length]));
    const decksBefore = Object.fromEntries(t.seats.map((seat) => [seat, deckOf(t, seat).length]));
    playCard(t, P1, "draw");
    for (const seat of t.seats) {
      const played = seat === P1 ? 1 : 0;
      assert.equal(decksBefore[seat]! - deckOf(t, seat).length, 1, `${seat} drew a card from their deck`);
      assert.equal(handOf(t, seat).length, handsBefore[seat]! - played, `${seat}'s drawn card did not enter their hand`);
      assert.ok(discardOf(t, seat).length >= 1, `${seat}'s drawn card went to ${seat}'s own discard pile`);
    }
    playCard(t, P1, "bounce", { selected: { t: ids(t, "field-p3-0") } });
    assert.equal(zoneOf(t, "field-p3-0"), "discard", "a card returned to hand goes to its owner's discard pile instead");
    // Next turn cards enter hands normally.
    startOfTurn(t, P2);
    const before = handOf(t, P2).length;
    playCard(t, P2, "later");
    assert.equal(handOf(t, P2).length, before - 1 + 1, "after this turn, P2's draw goes into P2's hand");
  });
}

// =================================================================================
// Tactician Vacation, clause 1
// If you played this card in response to a tactic, terminate the tactic. This turn, tactics cannot be played.
// =================================================================================

const TVAC = "4181e922-7ffb-4c71-aef6-17adf4f006c7";

const ping = () => tactic({ name: "Ping", behavior: { abilities: [{ id: "go", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } as never });

/** Plays Tactician Vacation as P1 (naming an opponent only when the engine asks for one). */
function playVacation(t: Table, count: Count): void {
  const needs = playersNeeded(t, { type: "playCard", playerId: P1, cardId: t.id("card") } as never);
  playRaw(t, P1, "card", needs ? { players: { opponent: needs[0]!.candidates[0] } } : {});
}

for (const count of COUNTS) {
  mpClause(TVAC, "1:rule", count, `${count} seats: played in response to a tactic it terminates that tactic; for the rest of the turn nobody (P1, P2, P3 ...) can play a tactic; next turn tactics work again`, () => {
    const cards = (): CardPlacement[] => [
      { key: "card", def: printing(TVAC), owner: P1, zone: "hand" },
      ...bank("rage", 4, P1),
      { key: "p1-tactic", def: ping(), owner: P1, zone: "hand" },
      ...seatsOf(count).slice(1).map((seat): CardPlacement => ({ key: `${seat}-tactic`, def: ping(), owner: seat, zone: "hand" })),
      ...plain("deck", 6, P1, "deck"),
      ...seatsOf(count).slice(1).flatMap((seat) => plain(`deck-${seat}-`, 6, seat, "deck"))
    ];
    // In response to P3's tactic: it is terminated (P3 does not draw), and tactics are barred for everyone this turn.
    {
      const t = table(count, cards(), P3);
      const deckP3 = deckOf(t, P3).length;
      t.engine.perform({ type: "playCard", playerId: P3, cardId: t.id("p3-tactic") } as never);
      for (let guard = 0; guard < 6 && t.engine.state.responseWindow!.priorityPlayerId !== P1; guard++) t.engine.perform({ type: "passPriority", playerId: t.engine.state.responseWindow!.priorityPlayerId } as never);
      assert.equal(t.engine.state.responseWindow!.priorityPlayerId, P1, "P1 may respond");
      playVacation(t, count);
      resolvePendingResponses(t.engine);
      assert.equal(deckOf(t, P3).length, deckP3, "P3's tactic was terminated: P3 did not draw");
      for (const seat of t.seats) {
        const key = `${seat}-tactic`;
        if (t.engine.state.cards[t.id(key)]!.zone !== "hand") continue;
        refused(() => t.engine.perform({ type: "playCard", playerId: seat, cardId: t.id(key) } as never), `${seat} cannot play a tactic this turn`, /tactic|cannot|can't|restrict|play/i);
      }
    }
    // Played on its own turn, not in response: nothing is terminated, tactics are still barred for everyone.
    {
      const t = table(count, cards());
      playVacation(t, count);
      resolvePendingResponses(t.engine);
      refused(() => t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("p1-tactic") } as never), "P1 cannot play a tactic this turn", /tactic|cannot|can't|restrict|play/i);
      // Next turn tactics can be played again.
      startOfTurn(t, P2);
      const deckP2 = deckOf(t, P2).length;
      playCard(t, P2, "p2-tactic");
      assert.equal(deckP2 - deckOf(t, P2).length, 1, "the next turn P2 plays a tactic normally");
    }
  });
}

// =================================================================================
// The Ministry of Other Smaller Ministries
// Your opponent must pay 2 to attack.
// =================================================================================

const MINISTRY = "ad487c7d-d286-44f4-8532-085ad2a851f1";

function ministryTable(count: Count): Table {
  return table(count, [
    { key: "card", def: printing(MINISTRY), owner: P1, zone: "hand" },
    ...bank("greed", 3, P1),
    ...seatsOf(count).slice(1).flatMap((seat) => [
      { key: `atk-${seat}`, def: character({ name: `Attacker ${seat}` }), owner: seat, zone: "play" as const },
      ...bank("greed", seat === P2 ? 1 : 3, seat)
    ])
  ]);
}

const attackFactionOfP1 = (t: Table, who: PlayerId) => t.engine.perform({ type: "declareAttack", playerId: who, attackerIds: ids(t, `atk-${who}`), target: { type: "faction", playerId: P1 } } as never);

for (const count of COUNTS) {
  mpClause(MINISTRY, "0:rule", count, `${count} seats: P1 selects the opponent when it enters play; only that opponent must pay 2 to attack, the others attack for free; re-selected if that player is eliminated; nobody pays once it leaves play`, () => {
    for (const taxed of [P2, P3]) {
      const t = ministryTable(count);
      playCard(t, P1, "card");
      choosePlayer(t, P1, seatsOf(count).slice(1), taxed);
      // The taxed opponent with 1 ready resource cannot attack (P2 has 1); with 3 it pays 2 (P3 has 3).
      const free = others(count, taxed)[0]!;
      startOfTurn(t, taxed);
      if (taxed === P2) refused(() => attackFactionOfP1(t, P2), "P2 has 1 ready resource and must pay 2 to attack", /pay|cost|afford|resource/i);
      else {
        const ready = t.engine.getAvailableResourceCount(P3);
        attackFactionOfP1(t, P3);
        assert.equal(ready - t.engine.getAvailableResourceCount(P3), 2, "the taxed opponent paid 2 to attack");
      }
    }
    // The other opponent attacks for free.
    {
      const t = ministryTable(count);
      playCard(t, P1, "card");
      choosePlayer(t, P1, seatsOf(count).slice(1), P3);
      startOfTurn(t, P2);
      const ready = t.engine.getAvailableResourceCount(P2);
      attackFactionOfP1(t, P2);
      assert.equal(ready - t.engine.getAvailableResourceCount(P2), 0, "P2 is not the chosen opponent: it attacks for free");
    }
    // The selected opponent is eliminated: P1 selects again among those left.
    {
      const t = ministryTable(count);
      playCard(t, P1, "card");
      choosePlayer(t, P1, seatsOf(count).slice(1), P2);
      eliminate(t, P2);
      if (count === 4) choosePlayer(t, P1, [P3, seatsOf(count)[3]!], P3);
      else assert.equal(open(t), undefined);
    }
  });
}

// =================================================================================
// "While your opponent controls ..., this card cannot be blocked." (Clockman Pickpocket, Cute Cutpurse, Face in the Crowd)
// =================================================================================

interface Unblockable {
  id: string;
  /** The cards that make the condition true for `seat` (n of them). */
  provides: (seat: PlayerId, n: number) => CardPlacement[];
  /** How many it takes. */
  needed: number;
  bank: [Parameters<typeof bank>[0], number];
}

function unblockableFlow(spec: Unblockable, count: Count): void {
  const build = (counts: Record<string, number>): Table =>
    table(count, [{ key: "card", def: printing(spec.id), owner: P1, zone: "hand" }, ...bank(spec.bank[0], spec.bank[1], P1), ...seatsOf(count).slice(1).flatMap((seat) => spec.provides(seat, counts[seat] ?? 0))]);
  const cannotBeBlocked = (t: Table): boolean => t.engine.getKeywords(t.id("card")).includes("cannotBeBlocked" as never);
  const enter = (t: Table, chosen: PlayerId): void => {
    playCard(t, P1, "card");
    choosePlayer(t, P1, seatsOf(count).slice(1), chosen);
  };
  const [p2, p3] = [P2, P3];
  // The chosen opponent meets the condition (even if it is not the one attacked), another one does not: unblockable.
  {
    const t = build({ [p2]: spec.needed, [p3]: 0 });
    enter(t, p2);
    assert.ok(cannotBeBlocked(t), "the chosen opponent meets the condition: it cannot be blocked");
  }
  // Only a different opponent meets it: still blockable.
  {
    const t = build({ [p2]: 0, [p3]: spec.needed + 2 });
    enter(t, p2);
    assert.ok(!cannotBeBlocked(t), "only another opponent meets the condition: it can be blocked");
  }
  // Rerun choosing the other opponent.
  {
    const t = build({ [p2]: 0, [p3]: spec.needed });
    enter(t, p3);
    assert.ok(cannotBeBlocked(t), "cannotBeBlocked(t)");
  }
  // One short of the condition is not enough.
  {
    const t = build({ [p2]: spec.needed - 1, [p3]: spec.needed + 2 });
    enter(t, p2);
    assert.ok(!cannotBeBlocked(t), "one short: it can be blocked");
  }
  // The chosen opponent is eliminated: P1 chooses again.
  {
    const t = build({ [p2]: spec.needed, [p3]: 0 });
    enter(t, p2);
    eliminate(t, p2);
    if (count === 4) {
      choosePlayer(t, P1, [p3, seatsOf(count)[3]!], p3);
      assert.ok(!cannotBeBlocked(t), "the new choice (P3) does not meet the condition");
    } else assert.equal(open(t), undefined, "one opponent left: nobody is asked");
  }
}

const PICKPOCKET = "e7a5575f-c91c-4ae5-afc7-3368a860ea56";
const CUTPURSE = "db118e14-f80e-4895-96b6-ec2eab18e0cc";
const FACE = "10b2d3fb-c61b-4c10-99ed-7d81de0c6b7e";
const items = (seat: PlayerId, n: number): CardPlacement[] => Array.from({ length: n }, (_, i) => ({ key: `item-${seat}-${i}`, def: item({ name: `Item ${seat} ${i}` }), owner: seat, zone: "play" as const }));

for (const count of COUNTS) {
  mpClause(PICKPOCKET, "0:rule", count, `${count} seats: cannot be blocked while the opponent chosen when it entered play controls an item (not any opponent)`, () => unblockableFlow({ id: PICKPOCKET, provides: items, needed: 1, bank: ["deception", 1] }, count));
  mpClause(CUTPURSE, "0:rule", count, `${count} seats: cannot be blocked while the opponent chosen when it entered play controls an item (not any opponent)`, () => unblockableFlow({ id: CUTPURSE, provides: items, needed: 1, bank: ["deception", 4] }, count));
  mpClause(FACE, "0:rule", count, `${count} seats: cannot be blocked while the opponent chosen when it entered play controls at least 4 characters (not any opponent)`, () =>
    unblockableFlow({ id: FACE, provides: (seat, n) => plain(`char-${seat}-`, n, seat, "play"), needed: 4, bank: ["deception", 6] }, count)
  );
}

// =================================================================================
// The Billionaire
// You may use abilities on your opponent's cards, but you must pay any numeric cost with your own resources. Any additional
// costs must be satisfied as though your opponent is using the ability. The ability's effect happens as if your opponent
// used it.
// =================================================================================

const BILLIONAIRE = "fb604d54-0aa5-40b5-9430-9d163e03fcc9";

const gadget = (name: string) => character({ name, behavior: { abilities: [{ id: "go", type: "activated", costs: [{ type: "payResources", amount: 1 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] } as never });

function billionaireTable(count: Count): Table {
  return table(count, [
    { key: "card", def: printing(BILLIONAIRE), owner: P1, zone: "hand" },
    ...bank("deception", 6, P1),
    ...seatsOf(count).slice(1).flatMap((seat): CardPlacement[] => [
      { key: `gadget-${seat}`, def: gadget(`Gadget ${seat}`), owner: seat, zone: "play" },
      ...plain(`deck-${seat}-`, 4, seat, "deck")
    ]),
    ...plain("mine", 4, P1, "deck")
  ]);
}

const useGadget = (t: Table, seat: PlayerId) => t.engine.perform({ type: "activateAbility", playerId: P1, cardId: t.id(`gadget-${seat}`), abilityId: "go" } as never);

for (const count of COUNTS) {
  mpClause(BILLIONAIRE, "1:rule", count, `${count} seats: P1 selects the opponent when it enters play; only that opponent's cards' abilities may be used, paid with P1's resources, with the effect happening as if that opponent used it`, () => {
    for (const opponent of others(count)) {
      const t = billionaireTable(count);
      playCard(t, P1, "card");
      choosePlayer(t, P1, seatsOf(count).slice(1), opponent);
      const ready = t.engine.getAvailableResourceCount(P1);
      const mine = deckOf(t, P1).length;
      const theirs = deckOf(t, opponent).length;
      useGadget(t, opponent);
      resolvePendingResponses(t.engine);
      assert.equal(ready - t.engine.getAvailableResourceCount(P1), 1, "the numeric cost is paid with P1's own resources");
      assert.equal(theirs - deckOf(t, opponent).length, 1, "the effect happened as if the opponent used it: the opponent drew");
      assert.equal(deckOf(t, P1).length, mine, "P1 did not draw");
      for (const seat of others(count, opponent)) {
        refused(() => useGadget(t, seat), `${seat} was not chosen: P1 cannot use its cards' abilities`);
        assert.equal(deckOf(t, seat).length, 4);
      }
    }
    // The chosen opponent is eliminated: P1 selects again among those left.
    {
      const t = billionaireTable(count);
      playCard(t, P1, "card");
      choosePlayer(t, P1, seatsOf(count).slice(1), P2);
      eliminate(t, P2);
      if (count === 4) choosePlayer(t, P1, [P3, seatsOf(count)[3]!], P3);
      else assert.equal(open(t), undefined);
      useGadget(t, P3);
      resolvePendingResponses(t.engine);
      assert.equal(deckOf(t, P3).length, 3, "the new opponent's ability can be used");
    }
    // It leaves play: no opponent's card is usable.
    {
      const t = table(count, [
        { key: "card", def: printing(BILLIONAIRE), owner: P1, zone: "hand" },
        { key: "kill", def: killTactic("The Billionaire"), owner: P1, zone: "hand" },
        { key: "gadget-p2", def: gadget("Gadget p2"), owner: P2, zone: "play" },
        ...bank("deception", 6, P1)
      ]);
      playCard(t, P1, "card");
      if (count === 4) choosePlayer(t, P1, seatsOf(count).slice(1), P2);
      else choosePlayer(t, P1, seatsOf(count).slice(1), P2);
      playCard(t, P1, "kill", { selected: { t: ids(t, "card") } });
      refused(() => useGadget(t, P2), "the Billionaire left play: P1 cannot use the opponent's card");
    }
  });
}

