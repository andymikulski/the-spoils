// Multiplayer clause tests for the 1st Edition Part 2 set (3 and 4 seats), part 3: more cards played or activated by
// their controller with "your opponent", and the opponent-bound lasting text (Odious Diva), plus Counter Attack.
// Expectations come from each card's PRINTED text, the multiplayer atoms (data/rule-tests/source/multiplayer.txt) and
// data/card-tests/mp-spec/1st-edition-part-2.json.

import assert from "node:assert/strict";
import { autoResolveBattle, bank } from "../../per-card/_harness.js";
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
  tactic,
  seatsOf,
  stack,
  table,
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
const setInfluence = (t: Table, values: Record<PlayerId, number>): void => {
  for (const [seat, value] of Object.entries(values)) t.engine.state.players[seat]!.influence = value;
};
const dmg = (t: Table, key: string): number => t.engine.state.cards[t.id(key)]!.damage;

// =================================================================================
// Needless Beating
// Pick a character. -- Inflict 2 damage to the character. If your opponent's faction has 15 influence or less, inflict
// 1 additional damage to the character. If your opponent's faction has 10 influence or less, inflict 1 damage to each
// character your opponent controls. If your opponent's faction has 5 influence or less, draw a card.
// =================================================================================

const NEEDLESS = "3ea9bbe2-4b32-4f04-9e2c-7a1201b655b9";

function needlessRun(count: Count, pick: PlayerId, influences: Record<PlayerId, number>): Table {
  const t = table(count, [
    { key: "nb", def: printing(NEEDLESS), owner: P1, zone: "hand" },
    { key: "victim", def: character({ name: "Victim", life: 9 }), owner: P1, zone: "play" },
    ...seatsOf(count).filter((s) => s !== P1).flatMap((seat): CardPlacement[] => [
      { key: `c-${seat}-a`, def: character({ name: `Char ${seat} A`, life: 9 }), owner: seat, zone: "play" },
      { key: `c-${seat}-b`, def: character({ name: `Char ${seat} B`, life: 9 }), owner: seat, zone: "play" }
    ]),
    ...fund(P1),
    ...perSeat(count, { hand: 0, deck: 3 })
  ]);
  setInfluence(t, influences);
  assertAsksOpponent(t, playAction(t, P1, "nb"), t.seats.slice(1));
  playCard(t, P1, "nb", { players: { opponent: pick }, selected: { c: [t.id("victim")] } });
  return t;
}

for (const count of [3, 4] as const) {
  mpClause(NEEDLESS, "0:ability", count, `${count} seats: all four tests read the one chosen opponent's faction, and only their characters take the extra damage`, () => {
    const seats = others(count);
    const [first, second] = seats as [PlayerId, PlayerId];
    // the chosen opponent has 12 (15 or less, not 10 or less); another has 4
    let t = needlessRun(count, first, { [first]: 12, [second]: 4 });
    assert.equal(dmg(t, "victim"), 3, "2 + 1 additional: the chosen opponent's 12 is 15 or less");
    for (const seat of seats) for (const part of ["a", "b"]) assert.equal(dmg(t, `c-${seat}-${part}`), 0, "not 10 or less: no damage to anyone's characters");
    assert.equal(handOf(t, P1).length, 0, "not 5 or less: no card drawn");
    // the chosen opponent has 4; another has 12
    t = needlessRun(count, second, { [second]: 4, [first]: 12 });
    assert.equal(dmg(t, "victim"), 3);
    for (const part of ["a", "b"]) assert.equal(dmg(t, `c-${second}-${part}`), 1, "1 damage to each character the chosen opponent controls");
    for (const part of ["a", "b"]) assert.equal(dmg(t, `c-${first}-${part}`), 0, "the other opponent's characters are unharmed");
    assert.equal(handOf(t, P1).length, 1, "5 or less: P1 drew a card");
    // another opponent being low never satisfies a threshold for the chosen one
    t = needlessRun(count, first, { [first]: 30, [second]: 3 });
    assert.equal(dmg(t, "victim"), 2, "only the 2 base damage");
    for (const seat of seats) for (const part of ["a", "b"]) assert.equal(dmg(t, `c-${seat}-${part}`), 0);
    assert.equal(handOf(t, P1).length, 0);
  });
}

// =================================================================================
// Skin Suit
// Pick a character you control. X is that character's strength. Pick a character your opponent controls. Y is that
// character's strength. -- Inflict X damage to your opponent's character. Inflict Y damage to your character. If only
// 1 of the characters is destroyed by this damage, remove it from the game instead. For the rest of the game, the
// surviving character has all rules text of the removed character in addition to its own rules text.
// =================================================================================

const SKIN_SUIT = "421c7d4c-d711-4a05-9955-d3834655f5fa";

for (const count of [3, 4] as const) {
  mpClause(SKIN_SUIT, "0:ability", count, `${count} seats: only the chosen opponent's characters can be picked; only that character and P1's are affected`, () => {
    for (const pick of others(count)) {
      const t = table(count, [
        { key: "ss", def: printing(SKIN_SUIT), owner: P1, zone: "hand" },
        { key: "mine", def: character({ name: "Mine", strength: 2, life: 5 }), owner: P1, zone: "play" },
        ...others(count).map((seat): CardPlacement => ({ key: `c-${seat}`, def: character({ name: `Char ${seat}`, strength: 3, life: 2 }), owner: seat, zone: "play" })),
        ...fund(P1)
      ]);
      assertAsksOpponent(t, playAction(t, P1, "ss"), t.seats.slice(1));
      assert.deepEqual(pickableBy(t, P1, "ss", "theirs", others(count).map((s) => `c-${s}`), { players: { opponent: pick } }), [`c-${pick}`], "only the chosen opponent's characters can be picked");
      const before = Object.fromEntries(t.seats.map((s) => [s, infl(t, s)]));
      playCard(t, P1, "ss", { players: { opponent: pick }, selected: { mine: [t.id("mine")], theirs: [t.id(`c-${pick}`)] } });
      assert.equal(zoneOf(t, `c-${pick}`), "removed", "X = 2 destroys it (life 2) and mine survives: the destroyed one is removed from the game");
      assert.equal(dmg(t, "mine"), 3, "Y = 3 damage to my character");
      for (const seat of others(count).filter((s) => s !== pick)) {
        assert.equal(zoneOf(t, `c-${seat}`), "play");
        assert.equal(dmg(t, `c-${seat}`), 0, `${seat}'s character is untouched`);
      }
      for (const seat of t.seats) assert.equal(infl(t, seat), before[seat], "no faction is affected");
    }
  });
}

// =================================================================================
// Trophy Collector
// Play this only if your opponent's faction has 10 influence or less.
// =================================================================================

const TROPHY = "33e392bd-4d5d-475c-9cfe-a5dac86bfd2f";

for (const count of [3, 4] as const) {
  mpClause(TROPHY, "0:ability", count, `${count} seats: the restriction is judged for the chosen opponent's faction only`, () => {
    const seats = others(count);
    const [first, second] = seats as [PlayerId, PlayerId];
    const build = (influences: Record<PlayerId, number>): Table => {
      const t = table(count, [{ key: "tc", def: printing(TROPHY), owner: P1, zone: "hand" }, ...fund(P1)]);
      setInfluence(t, influences);
      return t;
    };
    const can = (t: Table, who: PlayerId): boolean => t.engine.checkAction({ type: "playCard", playerId: P1, cardId: t.id("tc"), players: { opponent: who } } as never).ok;
    // the first opponent has 14, the second 8 (and any further opponent 14)
    const t = build({ [first]: 14, [second]: 8, ...Object.fromEntries(seats.slice(2).map((s) => [s, 14])) });
    assertAsksOpponent(t, playAction(t, P1, "tc"), t.seats.slice(1));
    assert.equal(can(t, first), false, `${first} has 14: refused`);
    assert.equal(can(t, second), true, `${second} has 8: allowed`);
    t.engine.state.players[P1]!.influence = 3;
    assert.equal(can(t, second), true, "P1's own influence is irrelevant");
    playCard(t, P1, "tc", { players: { opponent: second } });
    assert.equal(zoneOf(t, "tc"), "play");
    // every opponent above 10: it cannot be played with any choice
    const none = build(Object.fromEntries(seats.map((s) => [s, 14])));
    for (const who of seats) assert.equal(can(none, who), false, `refused for ${who}`);
    refused(() => none.engine.perform(playAction(none, P1, "tc", { players: { opponent: first } }) as never), "every opponent above 10");
  });
}

// =================================================================================
// Odious Diva
// Your opponent's hand is revealed at all times.
// DISAPPROVE — Pay 2. Name a card. -- Look at your opponent's hand. Your opponent must put a card with the chosen name
// on the bottom of their deck. If they do, they draw a card.
// =================================================================================

const DIVA = "b7c7b011-86ef-46db-8b26-c659ad1f24c1";
const revealedHands = (t: Table): PlayerId[] => [...t.engine.getFlowView().revealed.hands].sort() as PlayerId[];

mpClause(DIVA, "0:rule", 3, "3 seats: only the opponent selected as the effect starts applying has a revealed hand, until it is eliminated (then the remaining opponent) or the Diva leaves play", () => {
  const t = table(3, [
    { key: "diva", def: printing(DIVA), owner: P1, zone: "hand" },
    { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
    { key: "fin", def: finisher(P2), owner: P1, zone: "hand" },
    ...fund(P1),
    ...perSeat(3, { hand: 2, deck: 2 })
  ]);
  playCard(t, P1, "diva");
  choosePlayer(t, P1, [P2, P3], P2);
  assert.deepEqual(revealedHands(t), [P2], "only P2's hand is revealed");
  // not P3's, not even when P3 is the active player
  pass(t, P1);
  assert.deepEqual(revealedHands(t), [P2], "still only P2's, on P2's turn");
  pass(t, P2);
  assert.equal(t.engine.state.activePlayerId, P3);
  assert.deepEqual(revealedHands(t), [P2], "P3's hand is not revealed when P3 is the active player");
  pass(t, P3);
  // P2 is eliminated: the controller chooses again, and with one opponent left nothing is asked
  playCard(t, P1, "fin");
  assert.ok(t.engine.state.players[P2]!.eliminated, "t.engine.state.players[P2]!.eliminated");
  assert.equal(open(t), undefined, "one opponent left: no choice is offered");
  assert.deepEqual(revealedHands(t), [P3], "P3's hand is revealed now");
  // the Diva leaves play: nobody's hand is revealed
  playCard(t, P1, "kill", { selected: { t: [t.id("diva")] } });
  assert.equal(zoneOf(t, "diva"), "discard");
  assert.deepEqual(revealedHands(t), [], "no hand is revealed once the Diva has left play");
});

mpClause(DIVA, "1:ability:disapprove", 3, "3 seats: DISAPPROVE chooses its own opponent: only that opponent puts the named card on the bottom of their deck and draws", () => {
  for (const named of [true, false]) {
    const t = table(3, [
      { key: "diva", def: printing(DIVA), owner: P1, zone: "hand" },
      ...(named ? [{ key: "target", def: character({ name: "Target Card" }), owner: P3, zone: "hand" } as CardPlacement] : []),
      { key: "decoy", def: character({ name: "Target Card" }), owner: P2, zone: "hand" },
      ...fund(P1),
      ...perSeat(3, { hand: 1, deck: 3 })
    ]);
    // the Diva's first clause selects P2
    playCard(t, P1, "diva");
    choosePlayer(t, P1, [P2, P3], P2);
    // DISAPPROVE selects its own opponent, independent of the first clause's
    assertAsksOpponent(t, activateAction(t, P1, "diva", "disapprove"), [P2, P3]);
    const before = Object.fromEntries(t.seats.map((s) => [s, { hand: [...handOf(t, s)], deck: [...deckOf(t, s)] }]));
    t.engine.perform({ type: "activateAbility", playerId: P1, cardId: t.id("diva"), abilityId: "disapprove", players: { opponent: P3 }, named: { named: "Target Card" } } as never);
    resolvePendingResponses(t.engine);
    if (named) {
      // P3 (the chosen opponent) puts the named card on the bottom of its deck, then draws a card
      const prompt = openPick(t);
      assert.equal(prompt.playerId, P3, "the chosen opponent chooses");
      assert.deepEqual(prompt.candidates, [t.id("target")], "only a card with the chosen name in the chosen opponent's hand");
      answerPick(t, ["target"]);
      assert.deepEqual(deckOf(t, P3).slice(-1), [t.id("target")], "on the bottom of its deck");
      assert.equal(handOf(t, P3).length, before[P3]!.hand.length - 1 + 1, "it drew a card");
      assert.equal(handOf(t, P3).includes(before[P3]!.deck[0]!), true, "the top card of its own deck");
    } else {
      assert.equal(open(t), undefined, "no card with that name: nothing is asked and nothing moves");
      assert.deepEqual(handOf(t, P3), before[P3]!.hand);
      assert.deepEqual(deckOf(t, P3), before[P3]!.deck, "P3 does not draw");
    }
    assert.deepEqual(handOf(t, P2), before[P2]!.hand, "P2's hand (a card with that name too) is unchanged");
    assert.deepEqual(deckOf(t, P2), before[P2]!.deck, "P2's deck is unchanged");
  }
});

// =================================================================================
// Counter Attack
// Play this only during your opponent's turn and not during a battle. -- Attack your opponent. Draw a card. (This
// effect only allows you to attack once. You must resolve the battle before you draw the card.)
// =================================================================================

const COUNTER_ATTACK = "65bd9386-5d61-415a-be45-5d50b5b369a5";
const nothingTactic = (name: string) => tactic({ name, cost: 0, behavior: { abilities: [{ id: "n", type: "activated", effects: [] }] } as never });

function counterTable(count: Count, active: PlayerId): Table {
  return table(
    count,
    [
      { key: "ca", def: printing(COUNTER_ATTACK), owner: P1, zone: "hand" },
      { key: "a1", def: character({ name: "A1", strength: 2, life: 3, speed: 3 }), owner: P1, zone: "play" },
      ...seatsOf(count).filter((s) => s !== P1).flatMap((seat): CardPlacement[] => [
        { key: `nothing-${seat}`, def: nothingTactic(`Nothing ${seat}`), owner: seat, zone: "hand" },
        { key: `foe-${seat}`, def: character({ name: `Foe ${seat}`, strength: 1, life: 3, speed: 1 }), owner: seat, zone: "play" }
      ]),
      ...bank("deception", 6, P1),
      ...perSeat(count, { deck: 4 })
    ],
    active
  );
}

/** `active` plays a Nothing tactic and every other player passes until P1 holds priority in the window, in the middle of `active`'s turn and with no battle. */
function openWindowForP1(t: Table, active: PlayerId): void {
  t.engine.perform({ type: "playCard", playerId: active, cardId: t.id(`nothing-${active}`) } as never);
  while (t.engine.state.responseWindow?.priorityPlayerId !== P1) t.engine.perform({ type: "passPriority", playerId: t.engine.state.responseWindow!.priorityPlayerId } as never);
}

for (const count of [3, 4] as const) {
  mpClause(COUNTER_ATTACK, "0:ability", count, `${count} seats: P1 attacks the player whose turn it is (the only opponent that satisfies "during your opponent's turn"), and the others are left alone`, () => {
    for (const turnOf of others(count)) {
      const t = counterTable(count, turnOf);
      openWindowForP1(t, turnOf);
      const before = Object.fromEntries(t.seats.map((s) => [s, infl(t, s)]));
      t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("ca"), selected: { atk: [t.id("a1")] } } as never);
      resolvePendingResponses(t.engine);
      const battle = t.engine.state.battle!;
      assert.ok(battle, "a battle began");
      assert.equal(battle.attackerPlayerId, P1);
      assert.equal(battle.defenderPlayerId, turnOf, "the opponent whose turn it is defends");
      assert.deepEqual(battle.target, { type: "faction", playerId: turnOf });
      const handBefore = handOf(t, P1).length;
      t.engine.perform({ type: "declareBlockers", playerId: turnOf, blockerIds: [] } as never);
      autoResolveBattle(t.engine);
      resolvePendingResponses(t.engine);
      assert.equal(t.engine.state.battle, undefined);
      assert.equal(infl(t, turnOf), before[turnOf]! - 2, "the defending opponent's faction took the damage");
      for (const seat of t.seats.filter((s) => s !== turnOf)) assert.equal(infl(t, seat), before[seat], `${seat}'s faction was not attacked`);
      assert.equal(handOf(t, P1).length, handBefore + 1, "P1 drew after the battle");
    }
  });

  mpClause(COUNTER_ATTACK, "0:ability", count, `${count} seats: it cannot be played on P1's own turn, nor during a battle`, () => {
    const own = counterTable(count, P1);
    assert.equal(own.engine.checkAction({ type: "playCard", playerId: P1, cardId: own.id("ca"), selected: { atk: [own.id("a1")] } } as never).ok, false, "not on my own turn");
    const t = counterTable(count, P2);
    // P2 attacks P3 (a battle is under way): P1 may not play it
    t.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [t.id("foe-p2")], target: { type: "faction", playerId: P3 } } as never);
    assert.ok(t.engine.state.battle || t.engine.state.responseWindow, "a battle was declared");
    assert.equal(t.engine.checkAction({ type: "playCard", playerId: P1, cardId: t.id("ca"), selected: { atk: [t.id("a1")] } } as never).ok, false, "not during a battle");
  });
}
