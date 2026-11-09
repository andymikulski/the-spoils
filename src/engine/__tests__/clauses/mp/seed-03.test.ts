// Multiplayer clause tests for the Seed set (3 and 4 seats), part 3: "your opponent" discards / looks at a hand.
// Expectations come from each card's PRINTED text, the multiplayer atoms (data/rule-tests/source/multiplayer.txt) and
// data/card-tests/mp-spec/seed.json.

import assert from "node:assert/strict";
import { bank } from "../../per-card/_harness.js";
import { item, resourceCard, tactic } from "../../support/fixtures.js";
import { mpClause, refused } from "../_clause.js";
import { printing } from "../_clause.js";
import {
  abilityAction,
  activate,
  answerFor,
  assertNoOpponentAsked,
  assertOpponentAsked,
  character,
  choosePlayer,
  countIn,
  deckOf,
  handOf,
  open,
  opponents,
  P1,
  P2,
  passTurn,
  playAction,
  playCard,
  runPrompts,
  seatsOf,
  sizes,
  table,
  type CardPlacement,
  type Count,
  type Table
} from "./_seedKit.js";
import type { PlayerId } from "../../../../engine.js";

/** Every seat's hand: two characters, an item and a resource card (keys `ch0-<seat>`, `ch1-<seat>`, `it-<seat>`, `rs-<seat>`), and a few deck cards. */
function hands(count: Count): CardPlacement[] {
  return seatsOf(count).flatMap((seat) => [
    { key: `ch0-${seat}`, def: character({ name: `Char A ${seat}` }), owner: seat, zone: "hand" as const },
    { key: `ch1-${seat}`, def: character({ name: `Char B ${seat}` }), owner: seat, zone: "hand" as const },
    { key: `it-${seat}`, def: item({ name: `Item ${seat}` }), owner: seat, zone: "hand" as const },
    { key: `rs-${seat}`, def: resourceCard({ name: `Resource ${seat}` }), owner: seat, zone: "hand" as const },
    ...[0, 1, 2, 3].map((i) => ({ key: `d-${seat}-${i}`, def: character({ name: `Deck ${seat} ${i}` }), owner: seat, zone: "deck" as const })),
    { key: `c-${seat}`, def: character({ name: `Fighter ${seat}` }), owner: seat, zone: "play" as const }
  ]);
}

/** Asserts that only `pick` lost `n` cards from hand (to its discard pile) since `before`; the cards in `gone` are in that discard pile. */
function onlyDiscarded(t: Table, before: ReturnType<typeof sizes>, pick: PlayerId, n: number, gone: string[]): void {
  // P1's own hand and discard pile change with the card it played; the opponents' do not, except the chosen one's.
  for (const seat of t.seats.filter((s) => s !== P1)) {
    if (seat === pick) {
      assert.equal(countIn(t, seat, "hand"), before[seat]!.hand - n, `${seat} lost ${n} from hand`);
      assert.equal(countIn(t, seat, "discard") - before[seat]!.discard, n);
    } else {
      assert.equal(countIn(t, seat, "hand"), before[seat]!.hand, `${seat}'s hand is unchanged`);
      assert.equal(countIn(t, seat, "discard"), before[seat]!.discard, `${seat}'s discard pile is unchanged`);
    }
  }
  for (const key of gone) assert.equal(t.engine.state.cards[t.id(key)]!.zone, "discard", `${key} was discarded`);
}

/** The prompt answers of "the chosen opponent discards": that opponent (alone) picks `keys`. */
function discardPicks(t: Table, pick: PlayerId, keys: string[]) {
  const asked = runPrompts(t, (pc) => {
    assert.equal(pc.kind, "chooserSelectsTarget", "only the discard pick is asked");
    return { selected: keys.map((key) => t.id(key)) };
  });
  assert.deepEqual(asked.map((entry) => entry.playerId), [pick], "only the chosen opponent is asked to discard");
}

// =================================================================================
// Brainbath
// RECUR  Use this only if this card is in your discard pile. Pay 4. Remove this card from the game.
// Your opponent discards a card. Draw a card.
// =================================================================================

const BRAINBATH = "a037259c-6b3d-4e9a-ae5d-ca91c19c6817";

function brainbathTable(count: Count): Table {
  return table(count, [{ key: "bb", def: printing(BRAINBATH), owner: P1, zone: "discard" }, ...hands(count), ...bank("obsession", 6, P1)]);
}

for (const count of [3, 4] as const) {
  mpClause(BRAINBATH, "1:ability:recur", count, `${count} seats: RECUR names the opponent first; only that opponent discards a card of its choice, and P1 draws a card`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = brainbathTable(count);
      assertOpponentAsked(t, abilityAction(t, P1, "bb", "recur"));
      const before = sizes(t);
      activate(t, P1, "bb", "recur", { players: { opponent: pick } });
      discardPicks(t, pick, [`ch1-${pick}`]);
      onlyDiscarded(t, before, pick, 1, [`ch1-${pick}`]);
      assert.equal(countIn(t, P1, "hand"), before[P1]!.hand + 1, "P1 drew a card (not an opponent effect)");
      assert.equal(t.engine.state.cards[t.id("bb")]!.zone, "removed", "Brainbath was removed from the game");
    }
  });
}

// =================================================================================
// Stupidify
// Your opponent discards 2 cards.
// RECUR  Use this only if this card is in your discard pile. Pay 2. Remove this card from the game.
// Your opponent discards a card.
// =================================================================================

const STUPIDIFY = "baef7715-05a4-4082-b546-c458ce97eeb2";

for (const count of [3, 4] as const) {
  mpClause(STUPIDIFY, "0:rule", count, `${count} seats: the opponent is chosen before targets; only that opponent discards 2 cards of its own choice`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = table(count, [{ key: "st", def: printing(STUPIDIFY), owner: P1, zone: "hand" }, ...hands(count), ...bank("obsession", 6, P1)]);
      assertOpponentAsked(t, playAction(t, P1, "st"));
      const before = sizes(t);
      playCard(t, P1, "st", { players: { opponent: pick } });
      discardPicks(t, pick, [`ch0-${pick}`, `it-${pick}`]);
      onlyDiscarded(t, before, pick, 2, [`ch0-${pick}`, `it-${pick}`]);
    }
  });

  mpClause(STUPIDIFY, "1:ability:recur", count, `${count} seats: RECUR names the opponent first; only that opponent discards a card`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = table(count, [{ key: "st", def: printing(STUPIDIFY), owner: P1, zone: "discard" }, ...hands(count), ...bank("obsession", 6, P1)]);
      assertOpponentAsked(t, abilityAction(t, P1, "st", "recur"));
      const before = sizes(t);
      activate(t, P1, "st", "recur", { players: { opponent: pick } });
      discardPicks(t, pick, [`rs-${pick}`]);
      onlyDiscarded(t, before, pick, 1, [`rs-${pick}`]);
      assert.equal(t.engine.state.cards[t.id("st")]!.zone, "removed");
    }
  });
}

// =================================================================================
// Essence of Obsession
// Choose one of the following as this card's rules text:
//   OPTION 1: Your opponent discards a card.
//   OPTION 2: Pick a character. This turn, the character gains COVERT.
//   OPTION 3: Pick a character. This turn, the character loses 2 strength.
// =================================================================================

const ESSENCE_O = "e4260352-6b62-41dc-a031-6dbc0faccb73";

function essenceTable(count: Count): Table {
  return table(count, [{ key: "eo", def: printing(ESSENCE_O), owner: P1, zone: "hand" }, ...hands(count), ...bank("obsession", 6, P1)]);
}

for (const count of [3, 4] as const) {
  mpClause(ESSENCE_O, "0:rule", count, `${count} seats: the option choice involves only P1; only OPTION 1 then asks for an opponent (offering every other seat)`, () => {
    const t = essenceTable(count);
    const first = t.engine.getPlayRequirements(playAction(t, P1, "eo") as never);
    assert.equal(first.length, 1);
    assert.equal(first[0]!.kind, "mode", "the option choice comes first and names no player");
    assertOpponentAsked(t, playAction(t, P1, "eo", { mode: 0 }));
    assertNoOpponentAsked(t, playAction(t, P1, "eo", { mode: 1 }));
    assertNoOpponentAsked(t, playAction(t, P1, "eo", { mode: 2 }));
  });

  mpClause(ESSENCE_O, "1:option:OPTION 1", count, `${count} seats: OPTION 1 names the opponent first; only that opponent discards a card of its choice`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = essenceTable(count);
      const before = sizes(t);
      playCard(t, P1, "eo", { mode: 0, players: { opponent: pick } });
      discardPicks(t, pick, [`ch1-${pick}`]);
      onlyDiscarded(t, before, pick, 1, [`ch1-${pick}`]);
    }
  });

  mpClause(ESSENCE_O, "2:option:OPTION 2", count, `${count} seats: OPTION 2 picks any player's character (P1's, an opponent's, the third seat's); it gains COVERT this turn; no opponent is asked and nobody discards`, () => {
    for (const target of seatsOf(count)) {
      const t = essenceTable(count);
      const before = sizes(t);
      assert.equal(t.engine.getKeywords(t.id(`c-${target}`)).includes("covert"), false);
      playCard(t, P1, "eo", { mode: 1, selected: { c: [t.id(`c-${target}`)] } });
      assert.equal(open(t), undefined, "nobody is asked");
      assert.equal(t.engine.getKeywords(t.id(`c-${target}`)).includes("covert"), true, `${target}'s character gained COVERT`);
      for (const seat of t.seats.filter((s) => s !== target)) assert.equal(t.engine.getKeywords(t.id(`c-${seat}`)).includes("covert"), false);
      for (const seat of t.seats) assert.equal(countIn(t, seat, "hand"), before[seat]!.hand - (seat === P1 ? 1 : 0), "no one discards");
    }
  });

  mpClause(ESSENCE_O, "3:option:OPTION 3", count, `${count} seats: OPTION 3 picks any player's character; it loses 2 strength this turn; no opponent is asked and nobody discards`, () => {
    for (const target of seatsOf(count)) {
      const t = table(count, [
        { key: "eo", def: printing(ESSENCE_O), owner: P1, zone: "hand" },
        ...hands(count).map((placement) => (placement.key.startsWith("c-") ? { ...placement, def: character({ name: placement.def.name, strength: 4 }) } : placement)),
        ...bank("obsession", 6, P1)
      ]);
      const before = sizes(t);
      playCard(t, P1, "eo", { mode: 2, selected: { c: [t.id(`c-${target}`)] } });
      assert.equal(open(t), undefined, "nobody is asked");
      for (const seat of t.seats) assert.equal(t.engine.getStat(t.id(`c-${seat}`), "strength"), seat === target ? 2 : 4, `${seat}'s character strength`);
      for (const seat of t.seats) assert.equal(countIn(t, seat, "hand"), before[seat]!.hand - (seat === P1 ? 1 : 0), "no one discards");
    }
  });
}

// =================================================================================
// Living God of Thabbash
// When a character you control leaves play, your opponent discards a card.
// =================================================================================

const LIVING_GOD = "bc206d76-e136-4096-8ebb-a3abe1288b83";

const bouncer = tactic({
  name: "Bouncer",
  behavior: { abilities: [{ id: "body", type: "activated", targets: [{ id: "t", selector: { type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
});

function godTable(count: Count): Table {
  return table(count, [
    { key: "lg", def: printing(LIVING_GOD), owner: P1, zone: "play" },
    { key: "bounce", def: bouncer, owner: P1, zone: "hand" },
    ...hands(count),
    ...bank("obsession", 6, P1)
  ]);
}

for (const count of [3, 4] as const) {
  mpClause(LIVING_GOD, "0:rule", count, `${count} seats: when a character P1 controls leaves play P1 chooses the opponent when the trigger resolves; only that opponent discards a card of its choice`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = godTable(count);
      const before = sizes(t);
      activate(t, P1, "lg", "higher-calling", { selected: { c: [t.id("c-p1")] } });
      choosePlayer(t, P1, opponents(t), pick);
      discardPicks(t, pick, [`ch0-${pick}`]);
      onlyDiscarded(t, before, pick, 1, [`ch0-${pick}`]);
    }
  });

  mpClause(LIVING_GOD, "0:rule", count, `${count} seats: a character an opponent controls leaving play does not trigger it`, () => {
    for (const owner of seatsOf(count).slice(1)) {
      const t = godTable(count);
      const before = sizes(t);
      playCard(t, P1, "bounce", { selected: { t: [t.id(`c-${owner}`)] } });
      assert.equal(t.engine.state.cards[t.id(`c-${owner}`)]!.zone, "hand");
      assert.equal(open(t), undefined, "nothing is asked");
      for (const seat of t.seats.filter((s) => s !== P1)) assert.equal(countIn(t, seat, "discard"), before[seat]!.discard, `${seat} discarded nothing`);
    }
  });
}

// =================================================================================
// Perturbatious Warlock
// When this card enters play, your opponent puts a card from their hand on the top of their deck.
// =================================================================================

const WARLOCK = "7d385558-dd68-4c00-9c20-0a60daf86d86";

for (const count of [3, 4] as const) {
  mpClause(WARLOCK, "0:rule", count, `${count} seats: P1 chooses the opponent when the trigger resolves; only that opponent puts a card of its choice from hand on top of its own deck`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = table(count, [{ key: "pw", def: printing(WARLOCK), owner: P1, zone: "hand" }, ...hands(count), ...bank("obsession", 4, P1)]);
      const before = sizes(t);
      playCard(t, P1, "pw");
      choosePlayer(t, P1, opponents(t), pick);
      const asked = runPrompts(t, () => ({ selected: [t.id(`it-${pick}`)] }));
      assert.deepEqual(asked.map((entry) => entry.playerId), [pick]);
      assert.equal(deckOf(t, pick)[0], t.id(`it-${pick}`), "on top of the chosen opponent's own deck");
      for (const seat of t.seats) {
        const expectHand = before[seat]!.hand - (seat === P1 ? 1 : 0) - (seat === pick ? 1 : 0);
        assert.equal(countIn(t, seat, "hand"), expectHand, `${seat}'s hand`);
        assert.equal(countIn(t, seat, "deck"), before[seat]!.deck + (seat === pick ? 1 : 0), `${seat}'s deck`);
      }
    }
  });
}

// =================================================================================
// Cryptic Athenaeum
// With [O][O][O]: At the start of your turn, you may draw a card. If you do, your opponent may draw a card.
// With [O]x5: At the start of your turn, your opponent discards a card.
// With [O]x7: At the start of your turn, you may pick a character. If you do, put it into its owner's hand.
// =================================================================================

const ATHENAEUM = "12b6d2a3-5b34-4914-bcc4-20ddb1ad39ba";

function athenaeumTable(count: Count, obsession: number): Table {
  return table(
    count,
    [{ key: "ca", def: printing(ATHENAEUM), owner: P1, zone: "play" }, ...hands(count), ...bank("obsession", obsession, P1)],
    seatsOf(count).slice(-1)[0]!
  );
}

for (const count of [3, 4] as const) {
  mpClause(ATHENAEUM, "1:rule@ooo", count, `${count} seats: P1 draws, then only the opponent P1 chose is asked whether to draw; declining asks no opponent; nothing fires on the other seats' turns`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      for (const accept of [true, false]) {
        const t = athenaeumTable(count, 3);
        const before = sizes(t);
        assert.equal(passTurn(t), P1);
        const asked = runPrompts(t, (pc) => {
          if (pc.kind === "choosePlayer") return { playerId: pick };
          return { index: pc.playerId === P1 ? (accept ? 1 : 0) : 1 };
        });
        const optionAsks = asked.filter((entry) => entry.kind === "chooserSelectsOption").map((entry) => entry.playerId);
        assert.deepEqual(optionAsks, accept ? [P1, pick] : [P1], accept ? "P1 then the chosen opponent are asked" : "no opponent is asked");
        assert.equal(countIn(t, P1, "deck"), before[P1]!.deck - (accept ? 1 : 0));
        for (const seat of t.seats.filter((s) => s !== P1)) assert.equal(countIn(t, seat, "deck"), before[seat]!.deck - (accept && seat === pick ? 1 : 0), `${seat}'s draw`);
        if (accept) assert.deepEqual(asked.filter((entry) => entry.kind === "choosePlayer").map((entry) => entry.playerId), [P1]);
        const decks = sizes(t);
        for (let seat = passTurn(t); seat !== P1; seat = passTurn(t)) {
          assert.equal(open(t), undefined, `nothing is asked at ${seat}'s turn start`);
        }
        assert.deepEqual(sizes(t), decks, "no other turn start drew anything");
      }
    }
  });

  mpClause(ATHENAEUM, "2:rule@ooooo", count, `${count} seats: at the start of P1's turn the opponent P1 chooses discards a card of its choice, nobody else does, and nothing fires on the other seats' turns`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = athenaeumTable(count, 5);
      const before = sizes(t);
      assert.equal(passTurn(t), P1);
      const asked = runPrompts(t, (pc) => {
        if (pc.kind === "choosePlayer") return { playerId: pick };
        if (pc.kind === "chooserSelectsTarget") return { selected: [t.id(`ch0-${pc.playerId}`)] };
        return { index: 0 };
      });
      assert.deepEqual(asked.filter((entry) => entry.kind === "chooserSelectsTarget").map((entry) => entry.playerId), [pick]);
      onlyDiscarded(t, before, pick, 1, [`ch0-${pick}`]);
      for (let seat = passTurn(t); seat !== P1; seat = passTurn(t)) assert.equal(open(t), undefined, `nothing is asked at ${seat}'s turn start`);
      onlyDiscarded(t, before, pick, 1, [`ch0-${pick}`]);
    }
  });
}

mpClause(ATHENAEUM, "3:rule@ooooooo", 3, "3 seats: P1 may pick any character (P1's, P2's or P3's) and put it into its owner's hand; no opponent is asked; nothing fires on the other turns", () => {
  for (const target of seatsOf(3)) {
    const t = athenaeumTable(3, 7);
    assert.equal(passTurn(t), P1);
    const asked = runPrompts(t, (pc) => {
      if (pc.kind === "chooserSelectsTarget" && (pc.declaration as { id: string }).id === "c") return { selected: [t.id(`c-${target}`)] };
      if (pc.kind === "chooserSelectsOption") return { index: 0 };
      if (pc.kind === "choosePlayer") return { playerId: P2 };
      return { selected: [t.id(`ch0-${pc.playerId}`)] };
    });
    // the 5-icon paragraph also fires (opponent chosen, discards): this clause is only the 7-icon pick
    assert.ok(asked.some((entry) => entry.kind === "chooserSelectsTarget" && entry.playerId === P1), "P1 picks the character");
    assert.equal(t.engine.state.cards[t.id(`c-${target}`)]!.zone, "hand", `${target}'s character went to its owner's hand`);
    assert.ok(handOf(t, target).includes(t.id(`c-${target}`)), "handOf(t, target).includes(t.id(`c-${target}`))");
    for (const seat of t.seats.filter((s) => s !== target)) assert.equal(t.engine.state.cards[t.id(`c-${seat}`)]!.zone, "play");
  }
});

// =================================================================================
// Day of the Tentacle
// Look at your opponent's hand and choose a non-resource card in it. Put it into play under your opponent's control as a
// face-down resource.
// =================================================================================

const TENTACLE = "038bef7e-0d08-4751-ab48-0d1de31e3195";

for (const count of [3, 4] as const) {
  mpClause(TENTACLE, "0:rule", count, `${count} seats: the opponent is chosen first; P1 may choose only a non-resource card from that opponent's hand; it enters play under that opponent's control face-down`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = table(count, [{ key: "dt", def: printing(TENTACLE), owner: P1, zone: "hand" }, ...hands(count), ...bank("obsession", 2, P1)]);
      assertOpponentAsked(t, playAction(t, P1, "dt"));
      playCard(t, P1, "dt", { players: { opponent: pick } });
      const pc = open(t);
      assert.equal(pc?.kind, "chooserSelectsTarget");
      assert.equal(pc?.playerId, P1, "P1 chooses");
      for (const bad of [`rs-${pick}`, ...t.seats.filter((s) => s !== pick).map((s) => `ch0-${s}`)]) {
        refused(() => answerFor(t, P1, "chooserSelectsTarget", { selected: [t.id(bad)] }), `${bad} is not a non-resource card of the chosen opponent`);
      }
      answerFor(t, P1, "chooserSelectsTarget", { selected: [t.id(`it-${pick}`)] });
      const card = t.engine.state.cards[t.id(`it-${pick}`)]!;
      assert.equal(card.zone, "play");
      assert.equal(card.controllerId, pick);
      assert.equal(card.faceDown, true);
      for (const seat of t.seats.filter((s) => s !== pick)) assert.equal(countIn(t, seat, "hand"), 4,`${seat}'s hand is untouched`);
    }
  });
}

// =================================================================================
// Defiler of Innocence — DEFILE
// Deplete this card. Look at your opponent's hand and choose a character in it. Your opponent discards that character.
// =================================================================================

const DEFILER = "0f0e1fc8-b7e1-462f-a912-60d2ca99d458";

for (const count of [3, 4] as const) {
  mpClause(DEFILER, "1:ability:defile", count, `${count} seats: DEFILE names the opponent first; P1 may choose only a character in that opponent's hand and that opponent discards it`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = table(count, [{ key: "df", def: printing(DEFILER), owner: P1, zone: "play" }, ...hands(count)]);
      assertOpponentAsked(t, abilityAction(t, P1, "df", "defile"));
      const before = sizes(t);
      activate(t, P1, "df", "defile", { players: { opponent: pick } });
      assert.equal(open(t)?.playerId, P1, "P1 chooses");
      for (const bad of [`it-${pick}`, `rs-${pick}`, ...t.seats.filter((s) => s !== pick).map((s) => `ch0-${s}`)]) {
        refused(() => answerFor(t, P1, "chooserSelectsTarget", { selected: [t.id(bad)] }), `${bad} is not a character in the chosen opponent's hand`);
      }
      answerFor(t, P1, "chooserSelectsTarget", { selected: [t.id(`ch1-${pick}`)] });
      onlyDiscarded(t, before, pick, 1, [`ch1-${pick}`]);
    }
  });
}

// =================================================================================
// Encumber — RECUR
// Use this only if this card is in your discard pile. Pay 2. Remove this card from the game.
// Look at your opponent's hand and choose a non-resource card in it. Your opponent discards that card.
// =================================================================================

const ENCUMBER = "f32de0a3-6f08-47c4-a798-679c5be50631";

for (const count of [3, 4] as const) {
  mpClause(ENCUMBER, "1:ability:recur", count, `${count} seats: RECUR names the opponent first; P1 may choose only a non-resource card in that opponent's hand and that opponent discards it`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = table(count, [{ key: "en", def: printing(ENCUMBER), owner: P1, zone: "discard" }, ...hands(count), ...bank("obsession", 4, P1)]);
      assertOpponentAsked(t, abilityAction(t, P1, "en", "recur"));
      const before = sizes(t);
      activate(t, P1, "en", "recur", { players: { opponent: pick } });
      assert.equal(open(t)?.playerId, P1);
      for (const bad of [`rs-${pick}`, ...t.seats.filter((s) => s !== pick).map((s) => `it-${s}`)]) {
        refused(() => answerFor(t, P1, "chooserSelectsTarget", { selected: [t.id(bad)] }), `${bad} is not a non-resource card in the chosen opponent's hand`);
      }
      answerFor(t, P1, "chooserSelectsTarget", { selected: [t.id(`it-${pick}`)] });
      onlyDiscarded(t, before, pick, 1, [`it-${pick}`]);
    }
  });
}

// =================================================================================
// Flagitious Denunciator — DENOUNCE
// Pay 2. Pick a character. Destroy this card. Put the character into its owner's hand.
// Look at your opponent's hand and choose a character in it. Your opponent discards that character.
// =================================================================================

const DENUNCIATOR = "cae163fe-b4bb-4dde-9227-05359c5961ac";

for (const count of [3, 4] as const) {
  mpClause(DENUNCIATOR, "1:ability:denounce", count, `${count} seats: DENOUNCE bounces any player's picked character (independent of the opponent), then P1 chooses a character in the chosen opponent's hand, which that opponent discards`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const bounced = seatsOf(count).filter((s) => s !== pick && s !== P1).slice(-1)[0] ?? P1;
      const t = table(count, [{ key: "fd", def: printing(DENUNCIATOR), owner: P1, zone: "play" }, ...hands(count), ...bank("obsession", 4, P1)]);
      assertOpponentAsked(t, abilityAction(t, P1, "fd", "denounce", { selected: { c: [t.id(`c-${bounced}`)] } }));
      const before = sizes(t);
      activate(t, P1, "fd", "denounce", { players: { opponent: pick }, selected: { c: [t.id(`c-${bounced}`)] } });
      assert.equal(t.engine.state.cards[t.id("fd")]!.zone, "discard", "Flagitious Denunciator was destroyed");
      assert.equal(t.engine.state.cards[t.id(`c-${bounced}`)]!.zone, "hand", `${bounced}'s character went to its owner's hand`);
      assert.equal(open(t)?.playerId, P1);
      for (const bad of [`it-${pick}`, ...t.seats.filter((s) => s !== pick).map((s) => `ch0-${s}`)]) {
        refused(() => answerFor(t, P1, "chooserSelectsTarget", { selected: [t.id(bad)] }), `${bad} is not a character in the chosen opponent's hand`);
      }
      answerFor(t, P1, "chooserSelectsTarget", { selected: [t.id(`ch0-${pick}`)] });
      assert.equal(t.engine.state.cards[t.id(`ch0-${pick}`)]!.zone, "discard");
      assert.equal(countIn(t, pick, "hand"), before[pick]!.hand - 1 + (bounced === pick ? 1 : 0));
    }
  });
}
