// Multiplayer clause tests for the 2nd Edition set (3 and 4 seats), part 7: tactics and abilities that say "your
// opponent" or "your opponent's faction" and act through a picked character, item or counter (Downsizing, Irresistible
// Bribe, Mutiny Grant, Summary Judgment, Ritual of the Knob & Pull, Scrag, Skin Suit, Fool's Gold, Voidal Poisoning).
// The opponent is chosen with the play or activation, before any target. Expectations come from each card's PRINTED
// text, the multiplayer atoms and data/card-tests/mp-spec/2nd-edition.json.

import assert from "node:assert/strict";
import { bank, character, item, volition } from "../../per-card/_harness.js";
import { mpClause, printing } from "../_clause.js";
import { COUNTS, answerFor, drive, eliminateAllBut, ids, opponentChoice, others, plain, refused } from "./_seats2ndEdition.js";
import { P1, P2, deckOf, handOf, influenceOf, playCard, playersNeeded, playRaw, seatsOf, table, zoneOf, type CardPlacement, type Count, type Table } from "./_seatsSeed2ndFirstP2.js";

const playAction = (t: Table, key: string, extra: Record<string, unknown> = {}) => ({ type: "playCard", playerId: P1, cardId: t.id(key), ...extra }) as never;
const abilityAction = (t: Table, key: string, abilityId: string, extra: Record<string, unknown> = {}) => ({ type: "activateAbility", playerId: P1, cardId: t.id(key), abilityId, ...extra }) as never;

/** The cards the pick `declarationId` of a play or activation offers, once the opponent is named. */
function candidatesFor(t: Table, action: unknown, declarationId: string): string[] {
  const need = t.engine.getPlayRequirements(action as never).find((entry) => entry.kind === "pick" && entry.requirement.id === declarationId);
  assert.ok(need && need.kind === "pick", `a pick for '${declarationId}' is asked`);
  return [...need.candidates].sort();
}

// =================================================================================
// Downsizing
// Destroy all characters. Your opponent's faction gains X influence, where X is the number of characters destroyed this way.
// =================================================================================

const DOWNSIZING = "040213b2-7931-48c4-bf89-f8d45eaa98be";
const SIZES: Record<string, number> = { p1: 2, p2: 3, p3: 1, p4: 2 };

const downsizingTable = (count: Count): Table =>
  table(count, [{ key: "card", def: printing(DOWNSIZING), owner: P1, zone: "hand" }, ...bank("greed", 10, P1), ...seatsOf(count).flatMap((seat) => plain(`char-${seat}-`, SIZES[seat]!, seat, "play"))]);

for (const count of COUNTS) {
  mpClause(DOWNSIZING, "0:rule", count, `${count} seats: every seat's characters are destroyed and only the chosen opponent's faction gains X influence`, () => {
    const total = seatsOf(count).reduce((sum, seat) => sum + SIZES[seat]!, 0);
    for (const opponent of others(count)) {
      const t = downsizingTable(count);
      assert.deepEqual(playersNeeded(t, playAction(t, "card")), opponentChoice(count));
      const before = Object.fromEntries(t.seats.map((seat) => [seat, influenceOf(t, seat)]));
      playCard(t, P1, "card", { players: { opponent } });
      for (const seat of t.seats) for (let i = 0; i < SIZES[seat]!; i++) assert.equal(zoneOf(t, `char-${seat}-${i}`), "discard", "all characters of every seat are destroyed");
      for (const seat of t.seats) assert.equal(influenceOf(t, seat) - before[seat]!, seat === opponent ? total : 0, `${seat} gains ${seat === opponent ? total : 0} influence`);
    }
    const t = downsizingTable(count);
    eliminateAllBut(t);
    assert.equal(playersNeeded(t, playAction(t, "card")), undefined);
    const before = influenceOf(t, P2);
    playCard(t, P1, "card");
    assert.ok(influenceOf(t, P2) > before, "P2 is bound automatically and gains the influence");
  });
}

// =================================================================================
// Irresistible Bribe
// Pick a character. X is its strength. -- Destroy the character. Your opponent's faction gains X influence.
// =================================================================================

const BRIBE = "4779dd8b-22b8-45ea-adfc-aaf6c9ce11d8";

const bribeTable = (count: Count): Table =>
  table(count, [
    { key: "card", def: printing(BRIBE), owner: P1, zone: "hand" },
    ...bank("greed", 3, P1),
    ...seatsOf(count).map((seat) => ({ key: `char-${seat}`, def: character({ name: `Brute ${seat}`, strength: 4 }), owner: seat, zone: "play" as const }))
  ]);

for (const count of COUNTS) {
  mpClause(BRIBE, "0:ability", count, `${count} seats: the picked character (anyone's) is destroyed and only the chosen opponent's faction gains X influence`, () => {
    for (const opponent of others(count)) {
      for (const victim of seatsOf(count)) {
        const t = bribeTable(count);
        assert.deepEqual(playersNeeded(t, playAction(t, "card")), opponentChoice(count), "the opponent is chosen before the character is picked");
        assert.ok(candidatesFor(t, playAction(t, "card", { players: { opponent } }), "c").includes(t.id(`char-${victim}`)), `${victim}'s character may be picked whoever the opponent is`);
        const before = Object.fromEntries(t.seats.map((seat) => [seat, influenceOf(t, seat)]));
        playCard(t, P1, "card", { players: { opponent }, selected: { c: ids(t, `char-${victim}`) } });
        assert.equal(zoneOf(t, `char-${victim}`), "discard");
        for (const seat of t.seats) assert.equal(influenceOf(t, seat) - before[seat]!, seat === opponent ? 4 : 0, `${seat} gains ${seat === opponent ? 4 : 0}`);
      }
    }
    const t = bribeTable(count);
    eliminateAllBut(t);
    assert.equal(playersNeeded(t, playAction(t, "card")), undefined);
    const before = influenceOf(t, P2);
    playCard(t, P1, "card", { selected: { c: ids(t, "char-p1") } });
    assert.equal(influenceOf(t, P2) - before, 4, "P2 is bound automatically");
  });
}

// =================================================================================
// Mutiny Grant
// Pick a character your opponent controls. Your faction loses X influence, where X is the numeric cost of that character.
// -- This turn, take control of the character. Restore it.
// =================================================================================

const MUTINY = "9d3a3181-3167-4534-baf2-f5c31764c7d3";

const mutinyTable = (count: Count): Table =>
  table(count, [
    { key: "card", def: printing(MUTINY), owner: P1, zone: "hand" },
    ...bank("greed", 2, P1),
    ...seatsOf(count).slice(1).map((seat, i) => ({ key: `char-${seat}`, def: character({ name: `Prize ${seat}`, cost: 3 + 2 * i }), owner: seat, zone: "play" as const, depleted: true }))
  ]);

for (const count of COUNTS) {
  mpClause(MUTINY, "0:ability", count, `${count} seats: only the chosen opponent's characters can be picked; P1 loses influence equal to the picked cost and takes control of it this turn`, () => {
    for (const opponent of others(count)) {
      const t = mutinyTable(count);
      assert.deepEqual(playersNeeded(t, playAction(t, "card")), opponentChoice(count));
      assert.deepEqual(candidatesFor(t, playAction(t, "card", { players: { opponent } }), "pick"), ids(t, `char-${opponent}`), "only the chosen opponent's characters");
      refused(() => playRaw(t, P1, "card", { players: { opponent }, selected: { pick: ids(t, `char-${others(count, opponent)[0]!}`) } }), "a character of another opponent");
      const cost = t.engine.getDefinition(t.id(`char-${opponent}`)).cost as number;
      const before = influenceOf(t, P1);
      playCard(t, P1, "card", { players: { opponent }, selected: { pick: ids(t, `char-${opponent}`) } });
      assert.equal(before - influenceOf(t, P1), cost, "P1's faction loses the picked character's numeric cost");
      assert.equal(t.engine.state.cards[t.id(`char-${opponent}`)]!.controllerId, P1, "P1 took control of it");
      assert.equal(t.engine.state.cards[t.id(`char-${opponent}`)]!.depleted, false, "it was restored");
    }
    const t = mutinyTable(count);
    eliminateAllBut(t);
    assert.equal(playersNeeded(t, playAction(t, "card")), undefined);
    assert.deepEqual(candidatesFor(t, playAction(t, "card"), "pick"), ids(t, "char-p2"));
  });
}

// =================================================================================
// Summary Judgment
// Pick a character your opponent controls. X is its strength. -- Your opponent may destroy the character. If they don't,
// draw X cards.
// =================================================================================

const JUDGMENT = "40c6d3c3-98bd-4fb0-a5aa-7ffa0f6e8019";

const judgmentTable = (count: Count): Table =>
  table(count, [
    { key: "card", def: printing(JUDGMENT), owner: P1, zone: "hand" },
    ...bank("greed", 4, P1),
    ...plain("mine", 4, P1, "deck"),
    ...seatsOf(count).slice(1).map((seat) => ({ key: `char-${seat}`, def: character({ name: `Defendant ${seat}`, strength: 3 }), owner: seat, zone: "play" as const }))
  ]);

for (const count of COUNTS) {
  mpClause(JUDGMENT, "0:ability", count, `${count} seats: only the chosen opponent's characters can be picked; only that opponent may destroy it, otherwise P1 draws X cards`, () => {
    for (const opponent of others(count)) {
      for (const destroys of [true, false]) {
        const t = judgmentTable(count);
        assert.deepEqual(playersNeeded(t, playAction(t, "card")), opponentChoice(count));
        assert.deepEqual(candidatesFor(t, playAction(t, "card", { players: { opponent } }), "c"), ids(t, `char-${opponent}`), "only the chosen opponent's characters");
        const deckBefore = deckOf(t, P1).length;
        playRaw(t, P1, "card", { players: { opponent }, selected: { c: ids(t, `char-${opponent}`) } });
        const asked = drive(t, (pc) => (pc.kind === "mayPay" ? { kind: "mayPay", pay: destroys } : undefined));
        assert.deepEqual(asked.map((a) => [a.who, a.kind]), [[opponent, "mayPay"]], "only the chosen opponent is asked");
        assert.equal(zoneOf(t, `char-${opponent}`), destroys ? "discard" : "play");
        assert.equal(deckBefore - deckOf(t, P1).length, destroys ? 0 : 3, destroys ? "P1 draws nothing" : "P1 draws X = 3 cards");
        for (const seat of others(count, opponent)) assert.equal(zoneOf(t, `char-${seat}`), "play");
      }
    }
    const t = judgmentTable(count);
    eliminateAllBut(t);
    assert.equal(playersNeeded(t, playAction(t, "card")), undefined);
    playRaw(t, P1, "card", { selected: { c: ids(t, "char-p2") } });
    assert.equal(drive(t)[0]!.who, P2, "P2 is bound automatically and is asked");
  });
}

// =================================================================================
// Ritual of the Knob & Pull
// Pick a character. X is its strength. -- If your opponent controls at least X face-down resources, destroy the character.
// =================================================================================

const KNOB = "87b8eec4-0dec-4ab0-a8da-c7cf70740890";

const knobTable = (count: Count): Table =>
  table(count, [
    { key: "card", def: printing(KNOB), owner: P1, zone: "hand" },
    ...bank("obsession", 3, P1),
    ...volition(2, P1),
    ...volition(1, P2),
    ...volition(5, seatsOf(count)[2]!),
    ...(count === 4 ? volition(5, seatsOf(count)[3]!) : []),
    { key: "victim", def: character({ name: "Victim", strength: 3 }), owner: P1, zone: "play" }
  ]);

for (const count of COUNTS) {
  mpClause(KNOB, "0:ability", count, `${count} seats: only the chosen opponent's face-down resources are counted against X`, () => {
    for (const [opponent, destroyed] of [[seatsOf(count)[2]!, true], [P2, false]] as const) {
      const t = knobTable(count);
      assert.deepEqual(playersNeeded(t, playAction(t, "card")), opponentChoice(count), "the opponent is chosen before the character is picked");
      playCard(t, P1, "card", { players: { opponent }, selected: { c: ids(t, "victim") } });
      assert.equal(zoneOf(t, "victim"), destroyed ? "discard" : "play", destroyed ? "the chosen opponent controls at least 3 face-down resources" : "the chosen opponent controls only 1 (< 3)");
    }
    // P1's own face-down resources and the other opponents' do not count: P2 (1) is chosen while P3 holds 5.
    const t = knobTable(count);
    eliminateAllBut(t);
    assert.equal(playersNeeded(t, playAction(t, "card")), undefined);
    playCard(t, P1, "card", { selected: { c: ids(t, "victim") } });
    assert.equal(zoneOf(t, "victim"), "play", "P2 is bound automatically and controls only 1");
  });
}

// =================================================================================
// Scrag
// Pick a character. X is its life. -- If your opponent has at least X cards in their discard pile, destroy the character.
// =================================================================================

const SCRAG = "a41131b1-d9ab-404b-bd55-1fa9d9c77dcf";

const scragTable = (count: Count): Table =>
  table(count, [
    { key: "card", def: printing(SCRAG), owner: P1, zone: "hand" },
    ...bank("deception", 2, P1),
    ...plain("pile-p1-", 7, P1, "discard"),
    ...plain("pile-p2-", 2, P2, "discard"),
    ...plain("pile-p3-", 6, seatsOf(count)[2]!, "discard"),
    ...(count === 4 ? plain("pile-p4-", 6, seatsOf(count)[3]!, "discard") : []),
    { key: "victim", def: character({ name: "Victim", life: 4 }), owner: P1, zone: "play" }
  ]);

for (const count of COUNTS) {
  mpClause(SCRAG, "0:ability", count, `${count} seats: only the chosen opponent's discard pile is counted against X`, () => {
    for (const [opponent, destroyed] of [[seatsOf(count)[2]!, true], [P2, false]] as const) {
      const t = scragTable(count);
      assert.deepEqual(playersNeeded(t, playAction(t, "card")), opponentChoice(count));
      playCard(t, P1, "card", { players: { opponent }, selected: { c: ids(t, "victim") } });
      assert.equal(zoneOf(t, "victim"), destroyed ? "discard" : "play", destroyed ? "the chosen opponent has at least 4 cards in their discard pile" : "2 < 4: nothing is destroyed");
    }
    const t = scragTable(count);
    eliminateAllBut(t);
    assert.equal(playersNeeded(t, playAction(t, "card")), undefined);
    playCard(t, P1, "card", { selected: { c: ids(t, "victim") } });
    assert.equal(zoneOf(t, "victim"), "play", "P2 is bound automatically and has only 2");
  });
}

// =================================================================================
// Skin Suit
// Pick a character you control. X is its strength. Pick a character your opponent controls. Y is its strength. -- Inflict X
// damage to your opponent's character and Y damage to your character simultaneously. If only 1 of the characters is
// destroyed by this damage, remove it from the game instead. The surviving character gains all rules text of the removed
// character.
// =================================================================================

const SKIN = "c553043b-2514-42cf-9fa9-f2524b4a1ee2";

const skinTable = (count: Count): Table =>
  table(count, [
    { key: "card", def: printing(SKIN), owner: P1, zone: "hand" },
    ...bank("rage", 4, P1),
    { key: "mine", def: character({ name: "Mine", strength: 2, life: 6 }), owner: P1, zone: "play" },
    ...seatsOf(count).slice(1).map((seat, i) => ({ key: `char-${seat}`, def: character({ name: `Theirs ${seat}`, strength: 3 + i, life: 2 }), owner: seat, zone: "play" as const }))
  ]);

for (const count of COUNTS) {
  mpClause(SKIN, "0:ability", count, `${count} seats: the second pick is limited to the chosen opponent's characters; damage and removal affect only P1's and that opponent's characters`, () => {
    for (const opponent of others(count)) {
      const t = skinTable(count);
      assert.deepEqual(playersNeeded(t, playAction(t, "card")), opponentChoice(count));
      assert.deepEqual(candidatesFor(t, playAction(t, "card", { players: { opponent } }), "theirs"), ids(t, `char-${opponent}`), "only the chosen opponent's characters");
      refused(() => playRaw(t, P1, "card", { players: { opponent }, selected: { mine: ids(t, "mine"), theirs: ids(t, `char-${others(count, opponent)[0]!}`) } }), "a character of another opponent");
      playCard(t, P1, "card", { players: { opponent }, selected: { mine: ids(t, "mine"), theirs: ids(t, `char-${opponent}`) } });
      assert.equal(zoneOf(t, `char-${opponent}`), "removed", "2 damage destroyed their character, which is removed from the game instead (only one was destroyed)");
      assert.equal(zoneOf(t, "mine"), "play", "my character survived the opponent's damage");
      for (const seat of others(count, opponent)) assert.equal(zoneOf(t, `char-${seat}`), "play", `${seat}'s character is untouched`);
    }
    const t = skinTable(count);
    eliminateAllBut(t);
    assert.equal(playersNeeded(t, playAction(t, "card")), undefined);
    assert.deepEqual(candidatesFor(t, playAction(t, "card"), "theirs"), ids(t, "char-p2"));
  });
}

// =================================================================================
// Fool's Gold
// TRADE -- COST: Pick an item your opponent controls. Pay X, where X is its numeric cost. Destroy this card. -- EFFECT: Take
// control of the item.
// =================================================================================

const GOLD = "de8ebafc-aab1-4486-9f3a-92f53f9d6848";

const goldTable = (count: Count): Table =>
  table(count, [
    { key: "card", def: printing(GOLD), owner: P1, zone: "play" },
    ...bank("deception", 7, P1),
    ...seatsOf(count).slice(1).map((seat, i) => ({ key: `item-${seat}`, def: item({ name: `Item ${seat}`, cost: 3 + 2 * i }), owner: seat, zone: "play" as const }))
  ]);

for (const count of COUNTS) {
  mpClause(GOLD, "0:ability:trade", count, `${count} seats: only the chosen opponent's items can be picked; P1 pays that item's cost, destroys Fool's Gold and takes control of the item`, () => {
    for (const opponent of others(count)) {
      const t = goldTable(count);
      assert.deepEqual(playersNeeded(t, abilityAction(t, "card", "trade")), opponentChoice(count));
      assert.deepEqual(candidatesFor(t, abilityAction(t, "card", "trade", { players: { opponent } }), "pick"), ids(t, `item-${opponent}`), "only the chosen opponent's items");
      const cost = t.engine.getDefinition(t.id(`item-${opponent}`)).cost as number;
      const ready = t.engine.getAvailableResourceCount(P1);
      t.engine.perform(abilityAction(t, "card", "trade", { players: { opponent }, selected: { pick: ids(t, `item-${opponent}`) } }));
      drive(t);
      assert.equal(ready - t.engine.getAvailableResourceCount(P1), cost, "P1 paid the item's numeric cost");
      assert.equal(zoneOf(t, "card"), "discard", "Fool's Gold was destroyed");
      assert.equal(t.engine.state.cards[t.id(`item-${opponent}`)]!.controllerId, P1, "P1 took control of the item");
      for (const seat of others(count, opponent)) assert.equal(t.engine.state.cards[t.id(`item-${seat}`)]!.controllerId, seat, `${seat}'s item stays`);
    }
    const t = goldTable(count);
    eliminateAllBut(t);
    assert.equal(playersNeeded(t, abilityAction(t, "card", "trade")), undefined);
    assert.deepEqual(candidatesFor(t, abilityAction(t, "card", "trade"), "pick"), ids(t, "item-p2"));
  });
}

// =================================================================================
// Voidal Poisoning
// You may remove any number of tokens from cards you control. Use the tokens to generate the following effects any number
// of times:
// 1 TOKEN - Pick a character. Inflict 1 damage to it.
// 2 TOKENS - Draw a card.
// 2 TOKENS - Your opponent discards a card.
// 3 TOKENS - Search your deck for a card and put it into your hand.
// =================================================================================

const POISON = "19153f74-edc7-4fdf-bce9-925f4ec5cdff";

const poisonTable = (count: Count): Table =>
  table(count, [
    { key: "card", def: printing(POISON), owner: P1, zone: "hand" },
    ...bank("obsession", 3, P1),
    { key: "mine", def: character({ name: "Token holder", life: 5 }), owner: P1, zone: "play", counters: { token: 6 } },
    ...seatsOf(count).slice(1).flatMap((seat): CardPlacement[] => [
      { key: `char-${seat}`, def: character({ name: `Char ${seat}`, life: 5 }), owner: seat, zone: "play", counters: { token: 5 } },
      ...plain(`hand-${seat}-`, 4, seat, "hand")
    ]),
    ...plain("deck", 6, P1, "deck")
  ]);

/** Spends 2 tokens (option `index`) from P1's holder, once. */
const useOption = (t: Table, index: number, cost: number, extra: Record<string, unknown> = {}): void => {
  answerFor(t, P1, "spendCountersMenu", { optionIndex: index, sources: Array.from({ length: cost }, () => t.id("mine")), ...extra });
};

for (const count of COUNTS) {
  mpClause(POISON, "0:rule", count, `${count} seats: the opponent is chosen once for the whole card; tokens come only from cards P1 controls and can be spent on several options in one resolution`, () => {
    const t = poisonTable(count);
    assert.deepEqual(playersNeeded(t, playAction(t, "card")), opponentChoice(count), "chosen once, with the play");
    playCard(t, P1, "card", { players: { opponent: P2 } });
    const menu = t.engine.state.pendingChoice as unknown as { kind: string; available: Record<string, number> };
    assert.equal(menu.kind, "spendCountersMenu");
    assert.deepEqual(Object.keys(menu.available), [t.id("mine")], "tokens on the opponents' cards are not available");
    assert.equal(menu.available[t.id("mine")], 6);
    useOption(t, 1, 2); // draw
    useOption(t, 2, 2); // opponent discards
    answerFor(t, P2, "chooserSelectsTarget", { selected: ids(t, "hand-p2-0") });
    assert.equal(t.engine.state.pendingChoice?.kind, "spendCountersMenu", "the menu stays open for more options in the same resolution");
    useOption(t, 1, 2); // draw again: 6 tokens spent over three uses
    assert.equal(t.engine.state.pendingChoice, undefined, "nothing affordable is left");
    assert.equal(t.engine.state.cards[t.id("mine")]!.counters?.token ?? 0, 0);
  });

  mpClause(POISON, "1:rule", count, `${count} seats: 1 TOKEN picks any character in play (any player's) and inflicts 1 damage to it`, () => {
    const t = poisonTable(count);
    playCard(t, P1, "card", { players: { opponent: P2 } });
    useOption(t, 0, 1);
    for (const seat of seatsOf(count)) assert.ok(candidatesOpen(t).includes(t.id(seat === P1 ? "mine" : `char-${seat}`)), `${seat}'s character may be picked: not tied to the chosen opponent`);
    const target = t.id(`char-${seatsOf(count)[2]!}`);
    answerFor(t, P1, "chooserSelectsTarget", { selected: [target] });
    assert.equal(t.engine.state.cards[target]!.damage, 1, "1 damage to the picked character (here P3's, with P2 chosen)");
    assert.equal(t.engine.state.cards[t.id("char-p2")]!.damage, 0);
  });

  mpClause(POISON, "2:rule", count, `${count} seats: 2 TOKENS draws a card per use, and involves no other player`, () => {
    const t = poisonTable(count);
    const before = Object.fromEntries(t.seats.map((seat) => [seat, [deckOf(t, seat).length, handOf(t, seat).length]]));
    playCard(t, P1, "card", { players: { opponent: P2 } });
    useOption(t, 1, 2);
    useOption(t, 1, 2);
    answerFor(t, P1, "spendCountersMenu", { optionIndex: null });
    assert.equal(before.p1![0]! - deckOf(t, P1).length, 2, "4 tokens: two draws");
    for (const seat of others(count)) assert.deepEqual([deckOf(t, seat).length, handOf(t, seat).length], before[seat], `${seat} is not involved`);
  });

  mpClause(POISON, "3:rule", count, `${count} seats: 2 TOKENS makes only the chosen opponent discard, once per use, for the whole card`, () => {
    const t0 = poisonTable(count);
    assert.deepEqual(playersNeeded(t0, playAction(t0, "card")), opponentChoice(count));
    for (const opponent of others(count)) {
      const t = poisonTable(count);
      playCard(t, P1, "card", { players: { opponent } });
      useOption(t, 2, 2);
      assert.equal(t.engine.state.pendingChoice?.kind, "chooserSelectsTarget");
      assert.equal(t.engine.state.pendingChoice?.playerId, opponent, "the chosen opponent discards (their choice)");
      answerFor(t, opponent, "chooserSelectsTarget", { selected: ids(t, `hand-${opponent}-0`) });
      useOption(t, 2, 2);
      answerFor(t, opponent, "chooserSelectsTarget", { selected: ids(t, `hand-${opponent}-1`) });
      answerFor(t, P1, "spendCountersMenu", { optionIndex: null });
      assert.equal(handOf(t, opponent).length, 2, "4 tokens: two uses, two discards");
      for (const seat of others(count, opponent)) assert.equal(handOf(t, seat).length, 4, `${seat}'s hand is untouched: the opponent stays bound for the card`);
    }
    const t = poisonTable(count);
    eliminateAllBut(t);
    assert.equal(playersNeeded(t, playAction(t, "card")), undefined);
    playCard(t, P1, "card");
    useOption(t, 2, 2);
    assert.equal(t.engine.state.pendingChoice?.playerId, P2, "P2 is bound automatically");
  });

  mpClause(POISON, "4:rule", count, `${count} seats: 3 TOKENS searches P1's own deck for a card and puts it into P1's hand; no other deck is touched`, () => {
    const t = poisonTable(count);
    const decks = Object.fromEntries(t.seats.map((seat) => [seat, [...deckOf(t, seat)]]));
    playCard(t, P1, "card", { players: { opponent: P2 } });
    useOption(t, 3, 3);
    answerFor(t, P1, "chooserSelectsTarget", { selected: [decks.p1![2]!] });
    answerFor(t, P1, "spendCountersMenu", { optionIndex: null });
    assert.ok(handOf(t, P1).includes(decks.p1![2]!), "the card went into P1's hand");
    for (const seat of others(count)) assert.deepEqual(deckOf(t, seat), decks[seat], `${seat}'s deck is untouched`);
  });
}

function candidatesOpen(t: Table): string[] {
  const pc = t.engine.state.pendingChoice as unknown as { kind: string; playerId: string; declaration: { selector: unknown }; context: unknown };
  assert.equal(pc.kind, "chooserSelectsTarget");
  const engine = t.engine as unknown as { targetCandidates(selector: unknown, context: unknown, pickerId: string): Array<{ id: string }> };
  return engine.targetCandidates(pc.declaration.selector, pc.context, pc.playerId).map((card) => card.id);
}
