// Multiplayer clause tests for the Seed set (3 and 4 seats), part 5: "your opponent's faction" (damage, influence) and
// comparisons with "the characters your opponent controls". Expectations come from each card's PRINTED text, the
// multiplayer atoms (data/rule-tests/source/multiplayer.txt) and data/card-tests/mp-spec/seed.json.

import assert from "node:assert/strict";
import { bank } from "../../per-card/_harness.js";
import { location as locationDef, tactic } from "../../support/fixtures.js";
import { mpClause, printing, refused } from "../_clause.js";
import {
  abilityAction,
  activate,
  answerFor,
  assertOpponentAsked,
  character,
  choosePlayer,
  countIn,
  fillSeats,
  influences,
  mixedHands,
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
  runPrompts,
  seatsOf,
  table,
  type CardPlacement,
  type Count,
  type Table
} from "./_seedKit.js";
import type { PlayerId } from "../../../../engine.js";

/** Only `pick`'s faction changed by `delta`; every other seat is as before. */
function onlyFaction(t: Table, before: Record<PlayerId, number>, pick: PlayerId, delta: number): void {
  const now = influences(t);
  for (const seat of t.seats) assert.equal(now[seat], before[seat]! + (seat === pick ? delta : 0), `${seat}'s faction`);
}

/** `n` extra characters in play for `seat` (keys `x-<seat>-0..n-1`), each with `life` and `cost`. */
const crowd = (seat: PlayerId, n: number, extra: { life?: number; cost?: number; strength?: number } = {}): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({ key: `x-${seat}-${i}`, def: character({ name: `Crowd ${seat} ${i}`, ...extra }), owner: seat, zone: "play" as const }));

/** A tactic that drains all of an opponent's faction influence (used to eliminate a player through real play). */
const KILLER = tactic({
  name: "Killer",
  behavior: { abilities: [{ id: "body", type: "activated", effects: [{ type: "modifyInfluence", player: "opponent", amount: -99 }] }] }
});

// =================================================================================
// Drill Garrison
// With [R][R][R]: At the start of your turn, you may inflict 1 damage to your opponent's faction.
// With [R]x5: At the start of your turn, you may pick a character. If you do, deplete it.
// With [R]x7: At the start of your turn, you may pick a character. If you do, inflict 2 damage to it.
// =================================================================================

const GARRISON = "0dfc144b-12b2-472c-b7af-8c7bbf815a0e";

function garrisonTable(count: Count, rage: number): Table {
  return table(count, [{ key: "dg", def: printing(GARRISON), owner: P1, zone: "play" }, ...mixedHands(count), ...bank("rage", rage, P1)], seatsOf(count).slice(-1)[0]!);
}

for (const count of [3, 4] as const) {
  mpClause(GARRISON, "1:rule@rrr", count, `${count} seats: at the start of P1's turn P1 may damage only the chosen opponent's faction (1); nothing fires on the other turns`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      for (const accept of [true, false]) {
        const t = garrisonTable(count, 3);
        const before = influences(t);
        assert.equal(passTurn(t), P1);
        const asked = runPrompts(t, (pc) => (pc.kind === "choosePlayer" ? { playerId: pick } : { index: accept ? 1 : 0 }));
        assert.equal(asked.filter((entry) => entry.kind === "choosePlayer").length, 1);
        onlyFaction(t, before, pick, accept ? -1 : 0);
        const after = influences(t);
        for (let seat = passTurn(t); seat !== P1; seat = passTurn(t)) assert.equal(open(t), undefined);
        assert.deepEqual(influences(t), after, "nothing happens at the other turns");
      }
    }
  });
}

mpClause(GARRISON, "2:rule@rrrrr", 3, "3 seats: at the start of P1's turn P1 may pick any character (P1's, P2's or P3's) and deplete it; nothing fires on the other turns", () => {
  for (const target of seatsOf(3)) {
    const t = garrisonTable(3, 5);
    assert.equal(passTurn(t), P1);
    runPrompts(t, (pc) => {
      if (pc.kind === "choosePlayer") return { playerId: P2 };
      if (pc.kind === "chooserSelectsOption") return { index: 0 };
      return { selected: [t.id(`c-${target}`)] };
    });
    for (const seat of t.seats) assert.equal(t.engine.state.cards[t.id(`c-${seat}`)]!.depleted, seat === target, `${seat}'s character`);
    for (let seat = passTurn(t); seat !== P1; seat = passTurn(t)) assert.equal(open(t), undefined);
  }
});

mpClause(GARRISON, "3:rule@rrrrrrr", 3, "3 seats: at the start of P1's turn P1 may pick any character (P1's, P2's or P3's) and inflict 2 damage to it; nothing fires on the other turns", () => {
  for (const target of seatsOf(3)) {
    const t = garrisonTable(3, 7);
    assert.equal(passTurn(t), P1);
    runPrompts(t, (pc) => {
      if (pc.kind === "choosePlayer") return { playerId: P2 };
      if (pc.kind === "chooserSelectsOption") return { index: 0 };
      return { selected: (pc.declaration as { id: string }).id === "c" ? [t.id(`c-${target}`)] : [] };
    });
    for (const seat of t.seats) assert.ok([0, 2].includes(t.engine.state.cards[t.id(`c-${seat}`)]!.damage), "[0, 2].includes(t.engine.state.cards[t.id(`c-${seat}`)]!.damage)");
    assert.equal(t.engine.state.cards[t.id(`c-${target}`)]!.damage, 2);
  }
});

// =================================================================================
// Robustical Badass
// With [R][R][R]: At the start of your turn, you may inflict 1 damage to your opponent's faction.
// =================================================================================

const BADASS = "1855fff6-56b5-45df-8792-3436ebb5c3ba";

for (const count of [3, 4] as const) {
  mpClause(BADASS, "0:rule@rrr", count, `${count} seats: at the start of P1's turn P1 may damage only the chosen opponent's faction (1); nothing fires on the other turns`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      for (const accept of [true, false]) {
        const t = table(count, [{ key: "rb", def: printing(BADASS), owner: P1, zone: "play" }, ...mixedHands(count), ...bank("rage", 3, P1)], seatsOf(count).slice(-1)[0]!);
        const before = influences(t);
        assert.equal(passTurn(t), P1);
        runPrompts(t, (pc) => (pc.kind === "choosePlayer" ? { playerId: pick } : { index: accept ? 1 : 0 }));
        onlyFaction(t, before, pick, accept ? -1 : 0);
        const after = influences(t);
        for (let seat = passTurn(t); seat !== P1; seat = passTurn(t)) assert.equal(open(t), undefined);
        assert.deepEqual(influences(t), after);
      }
    }
  });
}

// =================================================================================
// Gallant Commander
// CHARGE!  Pay 2. Destroy this card. Inflict 3 damage to your opponent's faction.
// =================================================================================

const COMMANDER = "53178e50-33bf-47f7-ace0-20f9e7e88c52";

for (const count of [3, 4] as const) {
  mpClause(COMMANDER, "0:ability:charge", count, `${count} seats: CHARGE! names the opponent first; only that opponent's faction takes 3 damage`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = table(count, [{ key: "gc", def: printing(COMMANDER), owner: P1, zone: "play" }, ...mixedHands(count), ...bank("rage", 3, P1)]);
      assertOpponentAsked(t, abilityAction(t, P1, "gc", "charge"));
      const before = influences(t);
      activate(t, P1, "gc", "charge", { players: { opponent: pick } });
      assert.equal(t.engine.state.cards[t.id("gc")]!.zone, "discard", "Gallant Commander was destroyed");
      onlyFaction(t, before, pick, -3);
    }
  });
}

// =================================================================================
// Chain Reaction
// Pick a location. Inflict 3 damage to the location. If it is destroyed by that damage, you may pick a character. If you
// do, inflict 2 damage to that character. If it is destroyed by that damage, inflict 1 damage to your opponent's faction
// and draw a card.
// =================================================================================

const CHAIN = "2630e650-a402-4646-af6a-e8a47b033c5c";

function chainTable(count: Count): Table {
  return table(count, [
    { key: "cr", def: printing(CHAIN), owner: P1, zone: "hand" },
    ...seatsOf(count).flatMap((seat) => [
      { key: `loc-${seat}`, def: locationDef({ name: `Place ${seat}`, structure: 3 }), owner: seat, zone: "play" as const },
      { key: `weak-${seat}`, def: character({ name: `Weakling ${seat}`, life: 2 }), owner: seat, zone: "play" as const }
    ]),
    ...mixedHands(count),
    ...bank("rage", 2, P1)
  ]);
}

for (const count of [3, 4] as const) {
  mpClause(CHAIN, "0:ability", count, `${count} seats: the location and the character may belong to anyone; only the chosen opponent's faction takes 1 damage, and P1 draws`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = chainTable(count);
      assertOpponentAsked(t, playAction(t, P1, "cr"));
      const others = seatsOf(count).filter((s) => s !== pick);
      const locSeat = others.slice(-1)[0]!;
      const weakSeat = seatsOf(count).filter((s) => s !== locSeat)[0]!;
      const before = influences(t);
      const handBefore = countIn(t, P1, "hand");
      playCard(t, P1, "cr", { players: { opponent: pick }, selected: { l: [t.id(`loc-${locSeat}`)] } });
      answerFor(t, P1, "chooserSelectsTarget", { selected: [t.id(`weak-${weakSeat}`)] });
      assert.equal(t.engine.state.cards[t.id(`loc-${locSeat}`)]!.zone, "discard", "the location was destroyed");
      assert.equal(t.engine.state.cards[t.id(`weak-${weakSeat}`)]!.zone, "discard", "the character was destroyed");
      onlyFaction(t, before, pick, -1);
      assert.equal(countIn(t, P1, "hand"), handBefore - 1 + 1, "P1 played Chain Reaction and drew a card");
    }
  });
}

// =================================================================================
// Caboodling Gladhander
// You may pick a character. When this card enters play, if you picked a character as part of its cost, destroy that
// character. Your opponent's faction gains X influence, where X is the strength of that character.
// =================================================================================

const GLADHANDER = "d75f8c4e-5fd7-4169-8daa-051c703fb089";

function gladhanderTable(count: Count): Table {
  return table(count, [
    { key: "cg", def: printing(GLADHANDER), owner: P1, zone: "hand" },
    ...seatsOf(count).map((seat, i) => ({ key: `s-${seat}`, def: character({ name: `Strong ${seat}`, strength: 3 + i }), owner: seat, zone: "play" as const })),
    ...mixedHands(count),
    ...bank("greed", 9, P1)
  ]);
}

mpClause(GLADHANDER, "0:ability", 3, "3 seats: P1 may pick any character (P1's, P2's, P3's) or none as part of the cost; no opponent is asked for the pick", () => {
  const t = gladhanderTable(3);
  const requirements = t.engine.getPlayRequirements(playAction(t, P1, "cg") as never);
  const pick = requirements.find((requirement) => requirement.kind === "pick");
  assert.ok(pick && pick.kind === "pick", "pick && pick.kind === 'pick'");
  assert.equal(pick.declinable || pick.min === 0, true, "the pick is optional");
  assert.deepEqual([...pick.candidates].sort(), [...[P1, P2, P3].map((seat) => t.id(`s-${seat}`)), ...[P1, P2, P3].map((seat) => t.id(`c-${seat}`))].sort(), "every player's characters may be picked");
  assert.equal(requirements.some((requirement) => requirement.kind === "players"), false, "the pick is independent of the opponent clause");
  // picking nothing: nothing is destroyed and nobody gains influence
  const before = influences(t);
  playCard(t, P1, "cg");
  choosePlayer(t, P1, [P2, P3], P2);
  assert.deepEqual(influences(t), before, "no character picked: no influence is gained");
  assert.equal(t.engine.state.cards[t.id("s-p2")]!.zone, "play");
});

for (const count of [3, 4] as const) {
  mpClause(GLADHANDER, "1:rule", count, `${count} seats: the picked character is destroyed and only the opponent P1 chooses (not the picked character's owner) gains influence equal to its strength`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const owner = seatsOf(count).filter((s) => s !== pick).slice(-1)[0]!;
      const t = gladhanderTable(count);
      const strength = t.engine.getStat(t.id(`s-${owner}`), "strength");
      const before = influences(t);
      playCard(t, P1, "cg", { selected: { c: [t.id(`s-${owner}`)] } });
      choosePlayer(t, P1, opponents(t), pick);
      assert.equal(t.engine.state.cards[t.id(`s-${owner}`)]!.zone, "discard", "the picked character was destroyed");
      onlyFaction(t, before, pick, strength);
    }
  });
}

// =================================================================================
// Nefarious Horror
// While your opponent controls more characters than you, this card gains 2 strength, 2 life, and loses COVERT.
// =================================================================================

const HORROR = "287fad39-5bc3-499b-9099-f95294af36e6";

function horrorTable(count: Count, crowds: Record<PlayerId, number>): Table {
  return table(count, [
    { key: "nh", def: printing(HORROR), owner: P1, zone: "hand" },
    { key: "killer", def: KILLER, owner: P1, zone: "hand" },
    ...seatsOf(count).flatMap((seat) => crowd(seat, crowds[seat] ?? 0, { life: 3 })),
    ...fillSeats(count, 1, 3),
    ...bank("obsession", 4, P1)
  ]);
}

const horrorState = (t: Table) => ({
  strength: t.engine.getStat(t.id("nh"), "strength"),
  life: t.engine.getStat(t.id("nh"), "life"),
  covert: t.engine.getKeywords(t.id("nh")).includes("covert")
});

mpClause(HORROR, "1:rule", 3, "3 seats: only the opponent P1 chooses is compared with P1 (the other opponent's character count is ignored)", () => {
  // P1 will control 2 characters (the Horror and one more), P2 3, P3 1.
  for (const [pick, bonus] of [
    [P2, true],
    [P3, false]
  ] as const) {
    const t = horrorTable(3, { [P1]: 1, [P2]: 3, [P3]: 1 });
    playCard(t, P1, "nh");
    choosePlayer(t, P1, [P2, P3], pick);
    const printed = printing(HORROR);
    assert.deepEqual(horrorState(t), { strength: printed.strength! + (bonus ? 2 : 0), life: printed.life! + (bonus ? 2 : 0), covert: !bonus }, `${pick} chosen`);
  }
  // an opponent that is not chosen controlling more characters does not turn the bonus on
  const t = horrorTable(3, { [P1]: 1, [P2]: 0, [P3]: 5 });
  playCard(t, P1, "nh");
  choosePlayer(t, P1, [P2, P3], P2);
  const printed = printing(HORROR);
  assert.deepEqual(horrorState(t), { strength: printed.strength!, life: printed.life!, covert: true }, "P3 has more characters but P2 was chosen");
});

mpClause(HORROR, "1:rule", 3, "3 seats: when the chosen opponent is eliminated P1 chooses again (nobody is asked with one opponent left) and the new opponent is the one compared", () => {
  const t = horrorTable(3, { [P1]: 1, [P2]: 0, [P3]: 5 });
  playCard(t, P1, "nh");
  choosePlayer(t, P1, [P2, P3], P2);
  const printed = printing(HORROR);
  assert.equal(horrorState(t).strength, printed.strength!, "P2 (chosen) has fewer characters");
  playCard(t, P1, "killer", { players: { opponent: P2 } });
  assert.ok(t.engine.state.players[P2]!.eliminated, "t.engine.state.players[P2]!.eliminated");
  assert.equal(open(t), undefined, "only P3 is left: nothing is asked");
  assert.equal(horrorState(t).strength, printed.strength! + 2, "P3 controls more characters than P1, so the bonus applies");
});

mpClause(HORROR, "1:rule", 4, "4 seats: when the chosen opponent is eliminated P1 chooses again among the two left", () => {
  const t = horrorTable(4, { [P1]: 1, [P2]: 0, [P3]: 5, [P4]: 0 });
  playCard(t, P1, "nh");
  choosePlayer(t, P1, [P2, P3, P4], P2);
  playCard(t, P1, "killer", { players: { opponent: P2 } });
  choosePlayer(t, P1, [P3, P4], P3);
  assert.equal(horrorState(t).strength, printing(HORROR).strength! + 2, "the new choice, P3, controls more characters");
});

// =================================================================================
// Drivey Car
// If this card leaves play, put X Micromajig tokens into play, where X is the number of characters your opponent controls
// minus the number of characters you control.
// =================================================================================

const DRIVEY = "16a1de58-a23b-49c4-a3da-c696b92a74c6";

const bouncer = tactic({
  name: "Bouncer",
  behavior: { abilities: [{ id: "body", type: "activated", targets: [{ id: "t", selector: { type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
});

/** Micromajig tokens P1 controls in play. */
const tokensOf = (t: Table): number =>
  t.engine.state.players[P1]!.play.filter((id) => t.engine.state.cards[id]!.isToken && t.engine.state.cards[id]!.controllerId === P1).length;

for (const count of [3, 4] as const) {
  mpClause(DRIVEY, "0:rule", count, `${count} seats: when it leaves play P1 chooses the opponent when the trigger resolves; X counts only that opponent's characters minus P1's`, () => {
    // P1 keeps 2 characters (besides the Car); P2 controls 4, P3 3, P4 5.
    const crowds: Record<PlayerId, number> = { [P1]: 2, [P2]: 4, [P3]: 3, [P4]: 5 };
    for (const pick of seatsOf(count).slice(1)) {
      const t = table(count, [
        { key: "dc", def: printing(DRIVEY), owner: P1, zone: "play" },
        { key: "bounce", def: bouncer, owner: P1, zone: "hand" },
        ...seatsOf(count).flatMap((seat) => crowd(seat, crowds[seat]!)),
        ...fillSeats(count, 1, 3),
        ...bank("greed", 2, P1)
      ]);
      const expected = crowds[pick]! - crowds[P1]!;
      playCard(t, P1, "bounce", { selected: { t: [t.id("dc")] } });
      choosePlayer(t, P1, opponents(t), pick);
      assert.equal(tokensOf(t), Math.max(0, expected), `X = ${crowds[pick]} - ${crowds[P1]}`);
    }
  });
}

// =================================================================================
// Mass Confusion
// Choose a number for X. Pay X. Pick X characters. Inflict Y damage divided however you want to the characters, where Y is
// the number of characters your opponent controls minus the number of characters you control.
// =================================================================================

const CONFUSION = "48c4d2f0-8d0f-4203-a6ae-b81d9ebce2eb";

for (const count of [3, 4] as const) {
  mpClause(CONFUSION, "0:ability", count, `${count} seats: Y counts only the chosen opponent's characters minus P1's; P1 divides Y among the picked characters`, () => {
    const crowds: Record<PlayerId, number> = { [P1]: 2, [P2]: 4, [P3]: 3, [P4]: 5 };
    for (const pick of seatsOf(count).slice(1)) {
      const t = table(count, [
        { key: "mc", def: printing(CONFUSION), owner: P1, zone: "hand" },
        ...seatsOf(count).flatMap((seat) => crowd(seat, crowds[seat]!, { life: 9 })),
        ...fillSeats(count, 1, 3),
        ...bank("rage", 3, P1)
      ]);
      assertOpponentAsked(t, playAction(t, P1, "mc", { variables: { x: 2 } }));
      playCard(t, P1, "mc", { variables: { x: 2 }, players: { opponent: pick }, selected: { cs: [t.id(`x-${P1}-0`), t.id(`x-${P1}-1`)] } });
      const pc = t.engine.state.pendingChoice as unknown as { kind: string; playerId: PlayerId; amount: number; targets: string[] };
      assert.equal(pc.kind, "distributeAmong");
      assert.equal(pc.playerId, P1, "P1 divides the damage");
      const y = crowds[pick]! - crowds[P1]!;
      assert.equal(pc.amount, y, `Y = ${crowds[pick]} - ${crowds[P1]}`);
      assert.equal(pc.targets.length, 2);
      answerFor(t, P1, "distributeAmong", { shares: { [pc.targets[0]!]: y, [pc.targets[1]!]: 0 } });
      assert.equal(t.engine.state.cards[pc.targets[0]!]!.damage, y);
    }
  });
}

// =================================================================================
// Underhanded Gamer
// OUTSMART  Use this only if your opponent controls more characters than you. Pay 3. This turn, this card cannot be blocked.
// =================================================================================

const GAMER = "8c111617-ef44-42a4-a79e-b895dd8005c3";

function gamerTable(count: Count, crowds: Record<PlayerId, number>): Table {
  return table(count, [
    { key: "ug", def: printing(GAMER), owner: P1, zone: "play" },
    ...seatsOf(count).flatMap((seat) => crowd(seat, crowds[seat] ?? 0)),
    ...fillSeats(count, 1, 3),
    ...bank("deception", 4, P1)
  ]);
}

const unblockable = (t: Table) => t.engine.getKeywords(t.id("ug")).includes("cannotBeBlocked");

for (const count of [3, 4] as const) {
  mpClause(GAMER, "0:ability:outsmart", count, `${count} seats: the condition is checked against the opponent P1 names: allowed when that opponent controls more characters than P1, refused when it does not`, () => {
    // P1 controls 2 (the Gamer and one more), P2 3, P3 1, P4 2
    const crowds: Record<PlayerId, number> = { [P1]: 1, [P2]: 3, [P3]: 1, [P4]: 2 };
    for (const pick of seatsOf(count).slice(1)) {
      const t = gamerTable(count, crowds);
      assertOpponentAsked(t, abilityAction(t, P1, "ug", "outsmart"));
      const more = crowds[pick]! > crowds[P1]! + 1;
      if (more) {
        activate(t, P1, "ug", "outsmart", { players: { opponent: pick } });
        assert.equal(unblockable(t), true, `${pick} controls more characters: it cannot be blocked`);
      } else {
        refused(() => activate(t, P1, "ug", "outsmart", { players: { opponent: pick } }), `${pick} does not control more characters than P1`);
        assert.equal(unblockable(t), false);
      }
    }
  });

  mpClause(GAMER, "0:ability:outsmart", count, `${count} seats: with no opponent controlling more characters than P1 the ability is refused whichever opponent is named`, () => {
    const t = gamerTable(count, { [P1]: 3, [P2]: 2, [P3]: 1, [P4]: 3 });
    for (const pick of seatsOf(count).slice(1)) refused(() => activate(t, P1, "ug", "outsmart", { players: { opponent: pick } }), `${pick} does not control more characters`);
    assert.equal(unblockable(t), false);
  });
}

// =================================================================================
// Subordinate Demotivation
// Destroy the character your opponent controls with the lowest numeric cost. If there is a tie, you decide which character
// is destroyed.
// =================================================================================

const DEMOTIVATION = "e99994ea-71f1-4143-98dd-c2782fc38ff7";

for (const count of [3, 4] as const) {
  mpClause(DEMOTIVATION, "0:rule", count, `${count} seats: only the chosen opponent's characters are considered: its cheapest is destroyed, cheaper characters of P1 and of the other opponents are not`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = table(count, [
        { key: "sd", def: printing(DEMOTIVATION), owner: P1, zone: "hand" },
        ...seatsOf(count).flatMap((seat) => [
          { key: `lo-${seat}`, def: character({ name: `Low ${seat}`, cost: seat === pick ? 2 : 0 }), owner: seat, zone: "play" as const },
          { key: `hi-${seat}`, def: character({ name: `High ${seat}`, cost: 4 }), owner: seat, zone: "play" as const }
        ]),
        ...fillSeats(count, 1, 3),
        ...bank("greed", 4, P1)
      ]);
      assertOpponentAsked(t, playAction(t, P1, "sd"));
      playCard(t, P1, "sd", { players: { opponent: pick } });
      assert.equal(t.engine.state.cards[t.id(`lo-${pick}`)]!.zone, "discard", "the chosen opponent's cheapest character was destroyed");
      for (const seat of t.seats) {
        if (seat !== pick) for (const key of [`lo-${seat}`, `hi-${seat}`]) assert.equal(t.engine.state.cards[t.id(key)]!.zone, "play", `${key} is not touched, however cheap`);
      }
      assert.equal(t.engine.state.cards[t.id(`hi-${pick}`)]!.zone, "play");
    }
  });

  mpClause(DEMOTIVATION, "0:rule", count, `${count} seats: on a tie among the chosen opponent's characters P1 decides which is destroyed, from the tied ones only`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = table(count, [
        { key: "sd", def: printing(DEMOTIVATION), owner: P1, zone: "hand" },
        ...seatsOf(count).flatMap((seat) => [
          { key: `a-${seat}`, def: character({ name: `Tie A ${seat}`, cost: seat === pick ? 2 : 0 }), owner: seat, zone: "play" as const },
          { key: `b-${seat}`, def: character({ name: `Tie B ${seat}`, cost: seat === pick ? 2 : 0 }), owner: seat, zone: "play" as const },
          { key: `hi-${seat}`, def: character({ name: `High ${seat}`, cost: 5 }), owner: seat, zone: "play" as const }
        ]),
        ...fillSeats(count, 1, 3),
        ...bank("greed", 4, P1)
      ]);
      playCard(t, P1, "sd", { players: { opponent: pick } });
      assert.equal(open(t)?.kind, "chooserSelectsTarget");
      assert.equal(open(t)?.playerId, P1, "P1 decides the tie");
      for (const bad of [`hi-${pick}`, ...t.seats.filter((s) => s !== pick).map((s) => `a-${s}`)]) refused(() => answerFor(t, P1, "chooserSelectsTarget", { selected: [t.id(bad)] }), `${bad} is not tied for lowest cost among the chosen opponent's characters`);
      answerFor(t, P1, "chooserSelectsTarget", { selected: [t.id(`b-${pick}`)] });
      assert.equal(t.engine.state.cards[t.id(`b-${pick}`)]!.zone, "discard");
      assert.equal(t.engine.state.cards[t.id(`a-${pick}`)]!.zone, "play");
    }
  });
}

// =================================================================================
// Noble Sacrifice
// Pick a character you own. Pick a character your opponent owns. Destroy the characters. Draw a card.
// =================================================================================

const SACRIFICE = "f013f5ae-5301-4cd1-9504-b2e50f1e4a48";

for (const count of [3, 4] as const) {
  mpClause(SACRIFICE, "0:ability", count, `${count} seats: the second pick is limited to characters the chosen opponent owns (by ownership, not control); both picks are destroyed and P1 draws`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const other = seatsOf(count).filter((s) => s !== P1 && s !== pick)[0]!;
      const t = table(count, [
        { key: "ns", def: printing(SACRIFICE), owner: P1, zone: "hand" },
        ...seatsOf(count).map((seat) => ({ key: `c-${seat}`, def: character({ name: `Fighter ${seat}` }), owner: seat, zone: "play" as const })),
        // owned by the chosen opponent but controlled by P1 / owned by another opponent but controlled by the chosen one
        { key: "loan", def: character({ name: "Loaned out" }), owner: pick, controller: P1, zone: "play" as const },
        { key: "lent", def: character({ name: "Lent to them" }), owner: other, controller: pick, zone: "play" as const },
        ...fillSeats(count, 1, 3),
        ...bank("rage", 2, P1)
      ]);
      assertOpponentAsked(t, playAction(t, P1, "ns"));
      const requirements = t.engine.getPlayRequirements(playAction(t, P1, "ns", { players: { opponent: pick } }) as never);
      const picks = Object.fromEntries(requirements.flatMap((requirement) => (requirement.kind === "pick" ? [[requirement.requirement.id, requirement.candidates]] : [])));
      assert.deepEqual([...picks.theirs!].sort(), [t.id(`c-${pick}`), t.id("loan")].sort(), "characters owned by the chosen opponent (even if another player controls one), and none owned by anyone else");
      refused(() => playRaw(t, P1, "ns", { players: { opponent: pick }, selected: { mine: [t.id("c-p1")], theirs: [t.id("lent")] } }), "a character the chosen opponent controls but does not own");
      const handBefore = countIn(t, P1, "hand");
      playCard(t, P1, "ns", { players: { opponent: pick }, selected: { mine: [t.id("c-p1")], theirs: [t.id("loan")] } });
      assert.equal(t.engine.state.cards[t.id("c-p1")]!.zone, "discard");
      assert.equal(t.engine.state.cards[t.id("loan")]!.zone, "discard", "the owned-but-loaned character was destroyed");
      assert.equal(countIn(t, P1, "hand"), handBefore - 1 + 1, "P1 drew a card");
      assert.equal(open(t), undefined);
    }
  });
}

// =================================================================================
// Spitting Sarume
// When this card enters play, inflict 1 damage to all characters your opponent controls.
// =================================================================================

const SARUME = "47d63dba-085e-4cbc-ab0c-ecdbe65fded0";

for (const count of [3, 4] as const) {
  mpClause(SARUME, "0:rule", count, `${count} seats: P1 chooses the opponent when the trigger resolves; every character of only that opponent takes 1 damage`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = table(count, [
        { key: "sa", def: printing(SARUME), owner: P1, zone: "hand" },
        ...seatsOf(count).flatMap((seat) => crowd(seat, 2, { life: 3 })),
        ...fillSeats(count, 1, 3),
        ...bank("rage", 6, P1)
      ]);
      playCard(t, P1, "sa");
      choosePlayer(t, P1, opponents(t), pick);
      for (const seat of t.seats) for (const i of [0, 1]) assert.equal(t.engine.state.cards[t.id(`x-${seat}-${i}`)]!.damage, seat === pick ? 1 : 0, `${seat}'s character ${i}`);
    }
  });
}

