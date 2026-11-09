// Multiplayer clause tests for the 2nd Edition set (3 and 4 seats), part 5: triggered abilities that say "your opponent"
// (Gnat, Swarm of Gnats, Violating Anomaly, Card Counter, Master Thief, Dragon Tank, Arcanology Recruitment Officer,
// Heist Planner). The controller selects the opponent when the trigger resolves (MP 2, MPX-select), and is asked again
// each time it triggers. Expectations come from each card's PRINTED text, the multiplayer atoms and
// data/card-tests/mp-spec/2nd-edition.json.

import assert from "node:assert/strict";
import { bank, character, resourceCard } from "../../per-card/_harness.js";
import { clause, printing } from "../_clause.js";
import { COUNTS, LOSE, WIN, drive, eliminateAllBut, ids, killTactic, others, pickable, plain, refused, startOfTurn, tableWithRandom } from "./_seats2ndEdition.js";
import { choosePlayer, deckOf, handOf, open, P1, P2, playCard, seatsOf, table, zoneOf, type CardPlacement, type Count, type Table } from "./_seatsSeed2ndFirstP2.js";
import type { PlayerId } from "../../../../engine.js";

const discardOf = (t: Table, who: PlayerId): string[] => t.engine.state.players[who]!.discard;
const choose = (t: Table, opponent: PlayerId, from: PlayerId[] = t.seats.slice(1)): void => choosePlayer(t, P1, from, opponent);
const hands = (count: Count, n = 3): CardPlacement[] => seatsOf(count).slice(1).flatMap((seat) => plain(`hand-${seat}-`, n, seat, "hand"));

// =================================================================================
// Gnat
// If this card leaves play, your opponent discards a card.
// =================================================================================

const GNAT = "c11290da-e135-4b78-a132-303469bfe855";

const gnatTable = (count: Count, handSize = 3): Table =>
  table(count, [{ key: "gnat", def: printing(GNAT), owner: P1, zone: "play" }, { key: "kill", def: killTactic("Gnat"), owner: P1, zone: "hand" }, ...hands(count, handSize)]);

for (const count of COUNTS) {
  clause(GNAT, "0:rule", `${count} seats: when it leaves play P1 selects the opponent when the trigger resolves; only that opponent discards a card of their choice`, () => {
    for (const opponent of others(count)) {
      const t = gnatTable(count);
      playCard(t, P1, "kill", { selected: { t: ids(t, "gnat") } });
      assert.equal(zoneOf(t, "gnat"), "discard");
      choose(t, opponent);
      const asked = drive(t, (pc) => (pc.declaration?.id === "h" ? { kind: "chooserSelectsTarget", selected: ids(t, `hand-${opponent}-2`) } : undefined));
      assert.deepEqual(asked.map((a) => [a.who, a.decl]), [[opponent, "h"]], "the chosen opponent (not P1) picks the card they discard");
      assert.equal(zoneOf(t, `hand-${opponent}-2`), "discard");
      for (const seat of others(count, opponent)) assert.equal(handOf(t, seat).length, 3, `${seat}'s hand is untouched`);
    }
    // An empty chosen hand: nothing is discarded.
    {
      const t = table(count, [{ key: "gnat", def: printing(GNAT), owner: P1, zone: "play" }, { key: "kill", def: killTactic("Gnat"), owner: P1, zone: "hand" }, ...plain("hand-p3-", 2, seatsOf(count)[2]!, "hand")]);
      playCard(t, P1, "kill", { selected: { t: ids(t, "gnat") } });
      choose(t, P2);
      const asked = drive(t);
      assert.deepEqual(asked, [], "nobody is asked to discard from an empty hand");
      assert.equal(handOf(t, seatsOf(count)[2]!).length, 2);
    }
    // Only one opponent left: nobody is asked to choose.
    const t = gnatTable(count);
    eliminateAllBut(t);
    playCard(t, P1, "kill", { selected: { t: ids(t, "gnat") } });
    const asked = drive(t, (pc) => (pc.declaration?.id === "h" ? { kind: "chooserSelectsTarget", selected: ids(t, "hand-p2-0") } : undefined));
    assert.deepEqual(asked.map((a) => a.who), [P2], "P2 is bound automatically and discards");
  });
}

// =================================================================================
// Swarm of Gnats
// When this card enters or leaves play, your opponent discards a card.
// =================================================================================

const SWARM = "88855760-2a12-4d04-8e88-213f36effba4";

for (const count of COUNTS) {
  clause(SWARM, "0:rule", `${count} seats: entering and leaving play each select the opponent anew; only the selected opponent discards`, () => {
    const t = table(count, [
      { key: "swarm", def: printing(SWARM), owner: P1, zone: "hand" },
      { key: "kill", def: killTactic("Swarm of Gnats"), owner: P1, zone: "hand" },
      ...bank("obsession", 4, P1),
      ...hands(count)
    ]);
    const [first, second] = others(count);
    playCard(t, P1, "swarm");
    choose(t, first!);
    drive(t, (pc) => (pc.declaration?.id === "toDiscard" ? { kind: "chooserSelectsTarget", selected: ids(t, `hand-${first}-0`) } : undefined));
    assert.equal(zoneOf(t, `hand-${first}-0`), "discard", "the first-chosen opponent discarded on enter");
    for (const seat of others(count, first!)) assert.equal(handOf(t, seat).length, 3, `${seat} discarded nothing`);
    playCard(t, P1, "kill", { selected: { t: ids(t, "swarm") } });
    assert.equal(zoneOf(t, "swarm"), "discard");
    choose(t, second!);
    const asked = drive(t, (pc) => (pc.declaration?.id === "toDiscard" ? { kind: "chooserSelectsTarget", selected: ids(t, `hand-${second}-0`) } : undefined));
    assert.deepEqual(asked.map((a) => a.who), [second], "the choice is offered anew when it leaves play, and only the second opponent discards");
    assert.equal(handOf(t, first!).length, 2, "the first opponent did not discard again");
    assert.equal(handOf(t, second!).length, 2);
    // Only one opponent left: nobody is asked.
    const u = table(count, [{ key: "swarm", def: printing(SWARM), owner: P1, zone: "hand" }, ...bank("obsession", 4, P1), ...hands(count)]);
    eliminateAllBut(u);
    playCard(u, P1, "swarm");
    assert.deepEqual(drive(u, (pc) => (pc.declaration?.id === "toDiscard" ? { kind: "chooserSelectsTarget", selected: ids(u, "hand-p2-0") } : undefined)).map((a) => a.who), [P2]);
  });
}

// =================================================================================
// Violating Anomaly
// When this card enters play, look at your opponent's hand and choose a card in it. Your opponent discards that card.
// If this card leaves play, you may pick a non-resource card. If you do, put it into its owner's hand. Draw a card.
// =================================================================================

const ANOMALY = "4d2d797d-30ea-4b54-9826-b0140b03b9ff";

for (const count of COUNTS) {
  clause(ANOMALY, "0:rule", `${count} seats: on entering play P1 selects the opponent, looks at that opponent's hand only and chooses the card they discard`, () => {
    for (const opponent of others(count)) {
      const t = table(count, [{ key: "anomaly", def: printing(ANOMALY), owner: P1, zone: "hand" }, ...bank("obsession", 6, P1), ...hands(count)]);
      playCard(t, P1, "anomaly");
      choose(t, opponent);
      const asked = drive(t, (pc) => {
        if (pc.declaration?.id === "h") {
          assert.deepEqual(pickable(t), ids(t, `hand-${opponent}-0`, `hand-${opponent}-1`, `hand-${opponent}-2`).sort(), "only the chosen opponent's hand is offered");
          return { kind: "chooserSelectsTarget", selected: ids(t, `hand-${opponent}-1`) };
        }
        return undefined;
      });
      assert.deepEqual(asked.map((a) => [a.who, a.decl]), [[P1, "h"]], "P1 chooses; the opponent is not asked");
      assert.equal(zoneOf(t, `hand-${opponent}-1`), "discard");
      for (const seat of others(count, opponent)) assert.equal(handOf(t, seat).length, 3, `${seat}'s hand is untouched`);
    }
    const t = table(count, [{ key: "anomaly", def: printing(ANOMALY), owner: P1, zone: "hand" }, ...bank("obsession", 6, P1), ...hands(count)]);
    eliminateAllBut(t);
    playCard(t, P1, "anomaly");
    assert.equal(open(t)?.kind, "chooserSelectsTarget", "no opponent choice with one opponent left");
    assert.deepEqual(pickable(t), ids(t, "hand-p2-0", "hand-p2-1", "hand-p2-2").sort());
  });

  clause(ANOMALY, "1:rule", `${count} seats: when it leaves play P1 may pick a non-resource card anywhere in play (any player's), puts it into its owner's hand, then draws; no opponent is chosen`, () => {
    const build = (): Table =>
      table(count, [
        { key: "anomaly", def: printing(ANOMALY), owner: P1, zone: "play" },
        { key: "kill", def: killTactic("Violating Anomaly"), owner: P1, zone: "hand" },
        ...seatsOf(count).flatMap((seat) => plain(`field-${seat}-`, 1, seat, "play")),
        { key: "staple", def: resourceCard({ name: "Staple" }), owner: P3seat(count), zone: "play" },
        ...plain("deck", 3, P1, "deck")
      ]);
    // Bounce another player's character: it goes to its OWNER's hand, and P1 draws.
    {
      const t = build();
      playCard(t, P1, "kill", { selected: { t: ids(t, "anomaly") } });
      assert.equal(open(t)?.kind, "chooserSelectsOption", "no opponent choice: the option comes first");
      assert.equal(open(t)?.playerId, P1);
      const handBefore = handOf(t, P1).length;
      drive(t, (pc) => {
        if (pc.kind === "chooserSelectsOption") return { kind: "chooserSelectsOption", index: 0 };
        if (pc.declaration?.id === "c") {
          const offered = pickable(t);
          for (const seat of seatsOf(count)) assert.ok(offered.includes(t.id(`field-${seat}-0`)), `${seat}'s character may be picked`);
          assert.ok(!offered.includes(t.id("staple")), "a resource card cannot be picked");
          return { kind: "chooserSelectsTarget", selected: ids(t, "field-p2-0") };
        }
        return undefined;
      });
      assert.ok(handOf(t, P2).includes(t.id("field-p2-0")), "it went into its owner's hand");
      assert.equal(handOf(t, P1).length, handBefore + 1, "P1 drew a card");
    }
    // Declining the pick still draws.
    {
      const t = build();
      playCard(t, P1, "kill", { selected: { t: ids(t, "anomaly") } });
      const handBefore = handOf(t, P1).length;
      drive(t, (pc) => (pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 1 } : undefined));
      assert.equal(handOf(t, P1).length, handBefore + 1);
      assert.equal(zoneOf(t, "field-p2-0"), "play");
    }
  });
}
function P3seat(count: Count): PlayerId {
  return seatsOf(count)[2]!;
}

// =================================================================================
// Card Counter
// When this card enters play, flip a coin. If you win X, is 3. Otherwise, X is 2. Put the top X cards of your opponent's
// deck into their discard pile.
// =================================================================================

const COUNTER = "93fe1f56-4619-4b79-a41e-7c8067fca386";

for (const count of COUNTS) {
  clause(COUNTER, "0:rule", `${count} seats: P1 selects the opponent when the trigger resolves; a win mills 3, a loss mills 2, from that opponent's deck only`, () => {
    for (const opponent of others(count)) {
      for (const [random, milled] of [[WIN, 3], [LOSE, 2]] as const) {
        const t = tableWithRandom(count, [{ key: "counter", def: printing(COUNTER), owner: P1, zone: "hand" }, ...bank("deception", 3, P1), ...seatsOf(count).flatMap((seat) => plain(`deck-${seat}-`, 6, seat, "deck"))], random);
        const before = Object.fromEntries(t.seats.map((seat) => [seat, [...deckOf(t, seat)]]));
        playCard(t, P1, "counter");
        choose(t, opponent);
        assert.deepEqual(deckOf(t, opponent), before[opponent]!.slice(milled), `the top ${milled} cards of the chosen opponent's deck are milled`);
        assert.deepEqual(discardOf(t, opponent), before[opponent]!.slice(0, milled));
        for (const seat of t.seats.filter((s) => s !== opponent)) assert.deepEqual(deckOf(t, seat), before[seat], `${seat}'s deck is untouched`);
      }
    }
    const t = tableWithRandom(count, [{ key: "counter", def: printing(COUNTER), owner: P1, zone: "hand" }, ...bank("deception", 3, P1), ...plain("deck", 6, P2, "deck")], WIN);
    eliminateAllBut(t);
    playCard(t, P1, "counter");
    assert.equal(open(t), undefined, "no opponent choice with one opponent left");
    assert.equal(discardOf(t, P2).length, 3, "P2 is bound automatically");
  });
}

// =================================================================================
// Master Thief
// If this card is destroyed, you may pick a non-tactic card in your opponent's discard pile. If you do, put it into play
// under your control.
// =================================================================================

const THIEF = "94abdced-81ec-4f6e-bf99-cd6d9d5b87fe";

const thiefTable = (count: Count): Table =>
  table(count, [
    { key: "thief", def: printing(THIEF), owner: P1, zone: "play" },
    { key: "kill", def: killTactic("Master Thief"), owner: P1, zone: "hand" },
    ...seatsOf(count).slice(1).flatMap((seat) => [
      { key: `loot-${seat}`, def: character({ name: `Loot ${seat}` }), owner: seat, zone: "discard" as const },
      { key: `junk-${seat}`, def: character({ name: `Junk ${seat}`, cost: 0 }), owner: seat, zone: "discard" as const },
      { key: `spell-${seat}`, def: { ...character({ name: `Spell ${seat}` }), type: "tactic" as const }, owner: seat, zone: "discard" as const }
    ])
  ]);

for (const count of COUNTS) {
  clause(THIEF, "0:rule", `${count} seats: when destroyed P1 selects the opponent and may pick a non-tactic card from that opponent's discard pile only; it enters play under P1's control`, () => {
    for (const opponent of others(count)) {
      const t = thiefTable(count);
      playCard(t, P1, "kill", { selected: { t: ids(t, "thief") } });
      choose(t, opponent);
      const asked = drive(t, (pc) => {
        if (pc.declaration?.id === "pick") {
          assert.deepEqual(pickable(t), ids(t, `loot-${opponent}`, `junk-${opponent}`).sort(), "only non-tactic cards in the chosen opponent's discard pile");
          return { kind: "chooserSelectsTarget", selected: ids(t, `loot-${opponent}`) };
        }
        return undefined;
      });
      assert.deepEqual(asked.map((a) => [a.who, a.decl]), [[P1, "pick"]]);
      assert.equal(zoneOf(t, `loot-${opponent}`), "play");
      assert.equal(t.engine.state.cards[t.id(`loot-${opponent}`)]!.controllerId, P1, "it enters play under P1's control");
      for (const seat of others(count, opponent)) assert.equal(zoneOf(t, `loot-${seat}`), "discard", `${seat}'s discard pile is untouched`);
    }
    // P1 may decline.
    {
      const t = thiefTable(count);
      playCard(t, P1, "kill", { selected: { t: ids(t, "thief") } });
      choose(t, P2);
      drive(t);
      assert.equal(zoneOf(t, "loot-p2"), "discard");
    }
    // Only one opponent left: nobody is asked.
    const t = thiefTable(count);
    eliminateAllBut(t);
    playCard(t, P1, "kill", { selected: { t: ids(t, "thief") } });
    assert.equal(open(t)?.kind, "chooserSelectsTarget", "no opponent choice with one opponent left");
    assert.deepEqual(pickable(t), ids(t, "loot-p2", "junk-p2").sort());
  });
}

// =================================================================================
// Dragon Tank
// At the start of your turn, you may pick a character your opponent controls. If you do, destroy it. Otherwise, destroy
// this card.
// =================================================================================

const TANK = "3e949563-8af2-40f0-8dde-212932256134";

const tankTable = (count: Count, characters: Record<string, number>): Table =>
  table(count, [{ key: "tank", def: printing(TANK), owner: P1, zone: "play" }, ...seatsOf(count).slice(1).flatMap((seat) => plain(`char-${seat}-`, characters[seat] ?? 0, seat, "play"))]);

for (const count of COUNTS) {
  clause(TANK, "0:rule", `${count} seats: at the start of P1's turn P1 selects the opponent and may pick one of that opponent's characters (never another opponent's) to destroy, otherwise Dragon Tank is destroyed`, () => {
    for (const opponent of others(count)) {
      const t = tankTable(count, { p2: 2, p3: 3, p4: 1 });
      startOfTurn(t, P1);
      choose(t, opponent);
      const asked = drive(t, (pc) => {
        if (pc.declaration?.id === "c") {
          assert.deepEqual(pickable(t), Array.from({ length: opponent === P2 ? 2 : opponent === "p3" ? 3 : 1 }, (_, i) => t.id(`char-${opponent}-${i}`)).sort(), "only the chosen opponent's characters are offered");
          return { kind: "chooserSelectsTarget", selected: [pickable(t)[0]!] };
        }
        return undefined;
      });
      assert.deepEqual(asked.filter((a) => a.decl).map((a) => [a.who, a.decl]), [[P1, "c"]]);
      assert.equal(zoneOf(t, "tank"), "play", "the pick was made: Dragon Tank stays");
      const gone = Array.from({ length: opponent === P2 ? 2 : opponent === "p3" ? 3 : 1 }, (_, i) => i).filter((i) => zoneOf(t, `char-${opponent}-${i}`) === "discard").length;
      assert.equal(gone, 1, "exactly one of the chosen opponent's characters was destroyed");
    }
    // Declining the pick destroys Dragon Tank.
    {
      const t = tankTable(count, { p2: 2, p3: 3 });
      startOfTurn(t, P1);
      choose(t, P2);
      drive(t);
      assert.equal(zoneOf(t, "tank"), "discard");
      assert.equal(zoneOf(t, "char-p2-0"), "play");
    }
    // The chosen opponent controls no characters while another does: there is nothing to pick, Dragon Tank is destroyed.
    {
      const t = tankTable(count, { p3: 3 });
      startOfTurn(t, P1);
      choose(t, P2);
      drive(t);
      assert.equal(zoneOf(t, "tank"), "discard");
      assert.equal(zoneOf(t, "char-p3-0"), "play", "the other opponent's characters are not touched");
    }
    // No trigger at the start of the other players' turns.
    {
      const t = tankTable(count, { p2: 2, p3: 3 });
      startOfTurn(t, P2);
      assert.equal(open(t), undefined, "nothing happens at P2's turn start");
      assert.equal(zoneOf(t, "tank"), "play");
    }
    // Only one opponent left: nobody is asked to choose.
    const t = tankTable(count, { p2: 2, p3: 3 });
    eliminateAllBut(t);
    startOfTurn(t, P1);
    assert.equal(open(t)?.kind, "chooserSelectsTarget");
    assert.deepEqual(pickable(t), ids(t, "char-p2-0", "char-p2-1").sort());
  });
}

// =================================================================================
// Arcanology Recruitment Officer
// At the start of your turn, pick a character your opponent controls. It gains COVERT until the start of your next turn.
// =================================================================================

const OFFICER = "b15e9fc9-b7ab-4f63-8e64-9351338ee763";

const officerTable = (count: Count): Table =>
  table(count, [{ key: "officer", def: printing(OFFICER), owner: P1, zone: "play" }, ...seatsOf(count).flatMap((seat) => plain(`char-${seat}-`, 2, seat, "play"))]);

for (const count of COUNTS) {
  clause(OFFICER, "0:rule", `${count} seats: at the start of P1's turn P1 selects the opponent and picks one of that opponent's characters, which gains COVERT until P1's next turn`, () => {
    for (const opponent of others(count)) {
      const t = officerTable(count);
      startOfTurn(t, P1);
      choose(t, opponent);
      const asked = drive(t, (pc) => {
        if (pc.declaration?.id === "c") {
          assert.deepEqual(pickable(t), ids(t, `char-${opponent}-0`, `char-${opponent}-1`).sort(), "only the chosen opponent's characters can be picked");
          return { kind: "chooserSelectsTarget", selected: ids(t, `char-${opponent}-0`) };
        }
        return undefined;
      });
      assert.deepEqual(asked.map((a) => [a.who, a.decl]), [[P1, "c"]]);
      assert.ok(t.engine.getKeywords(t.id(`char-${opponent}-0`)).includes("covert"), "the picked character gained COVERT");
      for (const seat of t.seats.filter((s) => s !== opponent)) for (const i of [0, 1]) assert.ok(!t.engine.getKeywords(t.id(`char-${seat}-${i}`)).includes("covert"), `${seat}'s characters did not`);
      assert.ok(!t.engine.getKeywords(t.id(`char-${opponent}-1`)).includes("covert"));
    }
    // No trigger at the start of another player's turn.
    {
      const t = officerTable(count);
      startOfTurn(t, P2);
      assert.equal(open(t), undefined);
    }
    // Only one opponent left: nobody is asked to choose.
    const t = officerTable(count);
    eliminateAllBut(t);
    startOfTurn(t, P1);
    assert.equal(open(t)?.kind, "chooserSelectsTarget");
    assert.deepEqual(pickable(t), ids(t, "char-p2-0", "char-p2-1").sort());
  });
}

// =================================================================================
// Heist Planner
// When this card enters play, you may search your opponent's deck for up to 3 cards with different names and reveal them.
// If you do, put them into your opponent's discard pile.
// =================================================================================

const PLANNER = "65ebb568-f0c8-4bd4-a75a-209ff0c36a7e";

const plannerTable = (count: Count): Table =>
  table(count, [
    { key: "planner", def: printing(PLANNER), owner: P1, zone: "hand" },
    ...bank("deception", 3, P1),
    ...seatsOf(count).slice(1).flatMap((seat) => [
      { key: `dup-a-${seat}`, def: character({ id: `dup-${seat}`, name: `Dup ${seat}` }), owner: seat, zone: "deck" as const },
      { key: `dup-b-${seat}`, def: character({ id: `dup-${seat}`, name: `Dup ${seat}` }), owner: seat, zone: "deck" as const },
      ...plain(`deck-${seat}-`, 5, seat, "deck")
    ])
  ]);

for (const count of COUNTS) {
  clause(PLANNER, "0:rule", `${count} seats: P1 selects the opponent and may search only that opponent's deck for up to 3 cards with different names, which go to that opponent's discard pile`, () => {
    for (const opponent of others(count)) {
      const t = plannerTable(count);
      const before = Object.fromEntries(t.seats.map((seat) => [seat, [...deckOf(t, seat)]]));
      playCard(t, P1, "planner");
      choose(t, opponent);
      const asked = drive(t, (pc) => {
        if (pc.declaration?.id === "cs") {
          assert.deepEqual(pickable(t), [...before[opponent]!].sort(), "only the chosen opponent's deck is searched");
          // two cards with the same name: only one counts
          refused(() => t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: ids(t, `dup-a-${opponent}`, `dup-b-${opponent}`) } } as never), "two cards with the same name");
          return { kind: "chooserSelectsTarget", selected: ids(t, `dup-a-${opponent}`, `deck-${opponent}-0`, `deck-${opponent}-1`) };
        }
        return undefined;
      });
      assert.deepEqual(asked.map((a) => [a.who, a.decl]), [[P1, "cs"]]);
      for (const key of [`dup-a-${opponent}`, `deck-${opponent}-0`, `deck-${opponent}-1`]) assert.equal(zoneOf(t, key), "discard", "found cards go to the opponent's discard pile");
      assert.equal(zoneOf(t, `dup-b-${opponent}`), "deck");
      for (const seat of others(count, opponent)) assert.deepEqual(deckOf(t, seat), before[seat], `${seat}'s deck is untouched and was not searched`);
    }
    // P1 may decline the search.
    {
      const t = plannerTable(count);
      playCard(t, P1, "planner");
      choose(t, P2);
      drive(t);
      assert.equal(discardOf(t, P2).length, 0);
    }
    // Only one opponent left: nobody is asked to choose.
    const t = plannerTable(count);
    eliminateAllBut(t);
    playCard(t, P1, "planner");
    assert.equal(open(t)?.kind, "chooserSelectsTarget", "no opponent choice with one opponent left");
    assert.ok(pickable(t).every((id) => t.engine.state.cards[id]!.ownerId === P2));
  });
}
