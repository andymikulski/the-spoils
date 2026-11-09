// Multiplayer clause tests for the 2nd Edition set (3 and 4 seats), part 8: battle text. "Your opponent" in a block that
// can only come from a battle the controller is in is the other side of that battle (MPQ-P8): the defending player when
// the controller attacks, the attacking player when the controller defends. Nobody is asked to choose, and the players
// who are not in the battle are never touched. Expectations come from each card's PRINTED text, the multiplayer atoms and
// data/card-tests/mp-spec/2nd-edition.json.

import assert from "node:assert/strict";
import { bank, character, item, location } from "../../per-card/_harness.js";
import { clause, printing } from "../_clause.js";
import { COUNTS, battle, drive, ids, killTactic, others, pickable, plain } from "./_seats2ndEdition.js";
import { deckOf, handOf, open, P1, P2, P3, playCard, playersNeeded, seatsOf, table, zoneOf, type CardPlacement, type Count, type Table } from "./_seatsSeed2ndFirstP2.js";
import type { PlayerId } from "../../../../engine.js";

const handKeys = (seat: PlayerId, n = 3): string[] => Array.from({ length: n }, (_, i) => `hand-${seat}-${i}`);
const hands = (count: Count, n = 3): CardPlacement[] => seatsOf(count).slice(1).flatMap((seat) => plain(`hand-${seat}-`, n, seat, "hand"));
const discardOf = (t: Table, who: PlayerId): string[] => t.engine.state.players[who]!.discard;

// =================================================================================
// Deceptive Muddler
// COVERT. If this card inflicts damage to a faction, your opponent puts a card from their hand on the top of their deck if
// they can.
// =================================================================================

const MUDDLER = "47d266d5-3281-4b0a-85c5-b5f37e7a862f";

const muddlerTable = (count: Count): Table =>
  table(count, [{ key: "card", def: printing(MUDDLER), owner: P1, zone: "play" }, ...hands(count), ...seatsOf(count).slice(1).map((seat) => ({ key: `place-${seat}`, def: location({ name: `Place ${seat}`, structure: 9 }), owner: seat, zone: "play" as const }))]);

for (const count of COUNTS) {
  clause(MUDDLER, "1:rule", `${count} seats: when it damages a faction the defending player (not chosen by anyone) puts a card of their own hand on top of their deck; nobody else is affected`, () => {
    for (const defender of others(count)) {
      const t = muddlerTable(count);
      const top = handKeys(defender)[1]!;
      const asked = battle(t, P1, ["card"], defender, [], (pc) => (pc.declaration?.id === "h" ? { kind: "chooserSelectsTarget", selected: ids(t, top) } : undefined));
      assert.deepEqual(asked.map((a) => [a.who, a.kind, a.decl]), [[defender, "chooserSelectsTarget", "h"]], "no opponent choice is offered; only the defending player is asked, and picks from their own hand");
      assert.equal(zoneOf(t, top), "deck");
      assert.equal(deckOf(t, defender)[0], t.id(top), "it went on top of their deck");
      for (const seat of others(count, defender)) assert.equal(handOf(t, seat).length, 3, `${seat} (not in the battle) is untouched`);
    }
    // Damage to a card that is not a faction does not trigger it.
    {
      const t = muddlerTable(count);
      const asked = battle(t, P1, ["card"], P2, [], undefined, "place-p2");
      assert.deepEqual(asked, []);
      assert.equal(handOf(t, P2).length, 3);
    }
    // A defender with an empty hand: nothing happens.
    {
      const t = table(count, [{ key: "card", def: printing(MUDDLER), owner: P1, zone: "play" }]);
      assert.deepEqual(battle(t, P1, ["card"], P2), []);
    }
  });
}

// =================================================================================
// Lugubrian Octopod
// COVERT. If this card inflicts damage to a faction, your opponent discards 2 cards.
// =================================================================================

const OCTOPOD = "f54b6b5c-7d76-441f-a521-7d2e65b31d0b";

for (const count of COUNTS) {
  clause(OCTOPOD, "1:rule", `${count} seats: when it damages a faction the defending player (not chosen by anyone) discards 2 cards of their choice; nobody else is affected`, () => {
    for (const defender of others(count)) {
      const t = table(count, [{ key: "card", def: printing(OCTOPOD), owner: P1, zone: "play" }, ...hands(count)]);
      const asked = battle(t, P1, ["card"], defender, [], (pc) => (pc.declaration?.id === "h" ? { kind: "chooserSelectsTarget", selected: ids(t, ...handKeys(defender).slice(0, 2)) } : undefined));
      assert.deepEqual(asked.map((a) => [a.who, a.decl]), [[defender, "h"]], "only the defending player is asked");
      assert.equal(handOf(t, defender).length, 1, "2 cards discarded");
      for (const seat of others(count, defender)) assert.equal(handOf(t, seat).length, 3, `${seat} (not in the battle) is untouched`);
    }
    // A hand of 1 card discards 1.
    const t = table(count, [{ key: "card", def: printing(OCTOPOD), owner: P1, zone: "play" }, ...plain("hand-p2-", 1, P2, "hand"), ...plain("hand-p3-", 3, P3, "hand")]);
    battle(t, P1, ["card"], P2, [], (pc) => (pc.declaration?.id === "h" ? { kind: "chooserSelectsTarget", selected: ids(t, "hand-p2-0") } : undefined));
    assert.equal(handOf(t, P2).length, 0);
    assert.equal(handOf(t, P3).length, 3);
  });
}

// =================================================================================
// Venomous Sacspider
// If this card is destroyed by battle damage, your opponent discards their hand.
// =================================================================================

const SACSPIDER = "25467632-34e7-4eca-b5f0-9b5c50a05d1f";

for (const count of COUNTS) {
  clause(SACSPIDER, "0:rule", `${count} seats: destroyed by battle damage, the other side of that battle (the defender when it attacks, the attacker when it blocks) discards their hand; nobody else does`, () => {
    // Run A: P1's Sacspider attacks a faction and is destroyed by the defender's blocker.
    for (const defender of others(count)) {
      const t = table(count, [
        { key: "card", def: printing(SACSPIDER), owner: P1, zone: "play" },
        { key: "brute", def: character({ name: "Brute", strength: 5, life: 5 }), owner: defender, zone: "play" },
        ...hands(count)
      ]);
      const asked = battle(t, P1, ["card"], defender, ["brute"]);
      assert.equal(zoneOf(t, "card"), "discard", "the Sacspider was destroyed by battle damage");
      assert.deepEqual(asked, [], "no opponent choice is offered");
      assert.equal(handOf(t, defender).length, 0, "the other side of the battle discards their whole hand");
      for (const seat of others(count, defender)) assert.equal(handOf(t, seat).length, 3, `${seat} is untouched`);
    }
    // Run B: a third player attacks P1; P1's Sacspider blocks and is destroyed: the attacking player discards their hand.
    for (const attacker of others(count)) {
      const t = table(
        count,
        [
          { key: "card", def: printing(SACSPIDER), owner: P1, zone: "play" },
          { key: "raider", def: character({ name: "Raider", strength: 5, life: 5 }), owner: attacker, zone: "play" },
          ...hands(count)
        ],
        attacker
      );
      const asked = battle(t, attacker, ["raider"], P1, ["card"]);
      assert.equal(zoneOf(t, "card"), "discard");
      assert.deepEqual(asked, []);
      assert.equal(handOf(t, attacker).length, 0, "the attacking player (the other side) discards their hand");
      for (const seat of others(count, attacker)) assert.equal(handOf(t, seat).length, 3, `${seat} is untouched`);
    }
    // Destroyed by a tactic instead of battle damage: no trigger.
    const t = table(count, [{ key: "card", def: printing(SACSPIDER), owner: P1, zone: "play" }, { key: "kill", def: killTactic("Venomous Sacspider"), owner: P1, zone: "hand" }, ...hands(count)]);
    playCard(t, P1, "kill", { selected: { t: ids(t, "card") } });
    assert.equal(zoneOf(t, "card"), "discard");
    for (const seat of others(count)) assert.equal(handOf(t, seat).length, 3);
    assert.equal(open(t), undefined);
  });
}

// =================================================================================
// Catastrophic Betrayal
// Play this only while you are attacking. Pick a character in your opponent's discard pile. -- Put the character into play
// under your control as a member of the attacking party. Deplete it.
// =================================================================================

const BETRAYAL = "a2c972fc-f5de-4976-a2c6-a0518fa1a0e4";

const betrayalTable = (count: Count): Table =>
  table(count, [
    { key: "card", def: printing(BETRAYAL), owner: P1, zone: "hand" },
    ...bank("deception", 5, P1),
    { key: "raider", def: character({ name: "Raider", strength: 1 }), owner: P1, zone: "play" },
    ...seatsOf(count).slice(1).map((seat) => ({ key: `fallen-${seat}`, def: character({ name: `Fallen ${seat}` }), owner: seat, zone: "discard" as const })),
    ...seatsOf(count).slice(1).map((seat) => ({ key: `wall-${seat}`, def: character({ name: `Wall ${seat}` }), owner: seat, zone: "play" as const }))
  ]);

for (const count of COUNTS) {
  clause(BETRAYAL, "0:ability", `${count} seats: while P1 attacks, the picks are limited to the defending player's discard pile; no opponent choice is offered`, () => {
    for (const defender of others(count)) {
      const t = betrayalTable(count);
      t.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: ids(t, "raider"), target: { type: "faction", playerId: defender } } as never);
      assert.equal(playersNeeded(t, { type: "playCard", playerId: P1, cardId: t.id("card") } as never), undefined, "no opponent choice: the defending player is the other side of the battle");
      const needs = t.engine.getPlayRequirements({ type: "playCard", playerId: P1, cardId: t.id("card") } as never);
      const pick = needs.find((need) => need.kind === "pick");
      assert.ok(pick && pick.kind === "pick");
      assert.deepEqual([...pick.candidates].sort(), ids(t, `fallen-${defender}`), "only the defending player's discard pile is pickable");
      t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("card"), selected: { c: ids(t, `fallen-${defender}`) } } as never);
      drive(t);
      assert.equal(zoneOf(t, `fallen-${defender}`), "play");
      assert.equal(t.engine.state.cards[t.id(`fallen-${defender}`)]!.controllerId, P1, "under P1's control");
      assert.equal(t.engine.state.cards[t.id(`fallen-${defender}`)]!.depleted, true, "it is depleted");
      for (const seat of others(count, defender)) assert.equal(zoneOf(t, `fallen-${seat}`), "discard", `${seat}'s discard pile is untouched`);
    }
    // Not while attacking: refused.
    const t = betrayalTable(count);
    assert.throws(() => t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("card"), selected: { c: ids(t, "fallen-p2") } } as never));
  });
}

// =================================================================================
// Wyrmfang Deathskull
// If you attack, your opponent picks any number of characters they control. Those characters must block during this
// battle if they can, and only those characters can block.
// =================================================================================

const WYRMFANG = "97177f3a-80ff-480f-a12e-385472acf43b";

const wyrmfangTable = (count: Count, active: PlayerId = P1): Table =>
  table(
    count,
    [
      { key: "card", def: printing(WYRMFANG), owner: P1, zone: "play" },
      ...seatsOf(count).flatMap((seat) => plain(`char-${seat}-`, 2, seat, "play"))
    ],
    active
  );

for (const count of COUNTS) {
  clause(WYRMFANG, "1:rule", `${count} seats: the defending player (not chosen by anyone) picks among their own characters; those must block and only they can; the other players take no part`, () => {
    for (const defender of others(count)) {
      const t = wyrmfangTable(count);
      const asked = battle(t, P1, ["card"], defender, [`char-${defender}-0`], (pc) => {
        if (pc.kind === "chooseChosenBlockers") {
          assert.deepEqual([...(pc.candidates as string[])].sort(), ids(t, `char-${defender}-0`, `char-${defender}-1`).sort(), "only the defending player's own characters can be picked");
          return { kind: "chooseChosenBlockers", cardIds: ids(t, `char-${defender}-0`) };
        }
        return undefined;
      });
      assert.deepEqual(asked.filter((a) => a.kind === "chooseChosenBlockers").map((a) => a.who), [defender], "only the defending player picks; nobody else is asked");
      assert.ok(!asked.some((a) => a.who !== defender), "the other players get no prompt");
    }
    // Only the picked characters can block: blocking with the other one is refused.
    {
      const t = wyrmfangTable(count);
      t.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: ids(t, "card"), target: { type: "faction", playerId: P2 } } as never);
      drive(t, (pc) => (pc.kind === "chooseChosenBlockers" ? { kind: "chooseChosenBlockers", cardIds: ids(t, "char-p2-0") } : undefined));
      assert.throws(() => t.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: ids(t, "char-p2-1") } as never), "a character that was not picked cannot block");
    }
    // If P1 does not attack (two other players fight), the trigger does not fire.
    {
      const t = table(count, [{ key: "card", def: printing(WYRMFANG), owner: P1, zone: "play" }, ...plain("atk-", 1, P2, "play"), ...plain("def-", 1, P3, "play")], P2);
      const asked = battle(t, P2, ["atk-0"], P3, ["def-0"]);
      assert.ok(!asked.some((a) => a.kind === "chooseChosenBlockers"), "no pick for Wyrmfang when its controller does not attack");
    }
  });
}

// =================================================================================
// Clockman Pickpocket
// While your opponent controls an item, this card cannot be blocked.
// If this card inflicts damage to a faction, your opponent picks an item they control if they can. If they do, take control
// of it and destroy this card.
// =================================================================================

const PICKPOCKET = "e7a5575f-c91c-4ae5-afc7-3368a860ea56";

const pickpocketTable = (count: Count, items: Record<string, number> = { p2: 1, p3: 1, p4: 1 }): Table =>
  table(count, [
    { key: "card", def: printing(PICKPOCKET), owner: P1, zone: "play" },
    ...seatsOf(count).slice(1).flatMap((seat) => Array.from({ length: items[seat] ?? 0 }, (_, i): CardPlacement => ({ key: `item-${seat}-${i}`, def: item({ name: `Item ${seat} ${i}` }), owner: seat, zone: "play" })))
  ]);

for (const count of COUNTS) {
  clause(PICKPOCKET, "1:rule", `${count} seats: when it damages a faction the defending player (not chosen by anyone) picks an item they control, P1 takes it and destroys the Pickpocket; other players' items are safe`, () => {
    for (const defender of others(count)) {
      const t = pickpocketTable(count);
      const asked = battle(t, P1, ["card"], defender, [], (pc) => {
        if (pc.declaration?.id === "it") {
          assert.deepEqual(pickable(t), ids(t, `item-${defender}-0`), "only an item the defending player controls");
          return { kind: "chooserSelectsTarget", selected: ids(t, `item-${defender}-0`) };
        }
        return undefined;
      });
      assert.deepEqual(asked.map((a) => [a.who, a.decl]), [[defender, "it"]], "the defending player (the other side of the battle) picks");
      assert.equal(t.engine.state.cards[t.id(`item-${defender}-0`)]!.controllerId, P1, "P1 took control of it");
      assert.equal(zoneOf(t, "card"), "discard", "the Pickpocket was destroyed");
      for (const seat of others(count, defender)) assert.equal(t.engine.state.cards[t.id(`item-${seat}-0`)]!.controllerId, seat, `${seat}'s item stays`);
    }
    // The defending player controls no item: nothing happens (another player's item cannot be taken).
    const t = pickpocketTable(count, { p3: 1 });
    battle(t, P1, ["card"], P2);
    assert.equal(zoneOf(t, "card"), "play", "the Pickpocket stays");
    assert.equal(t.engine.state.cards[t.id("item-p3-0")]!.controllerId, P3);
  });
}

// =================================================================================
// Cute Cutpurse
// While your opponent controls an item, this card cannot be blocked.
// If this card inflicts damage to a faction, pick an item your opponent controls if you can. If you do, destroy it.
// =================================================================================

const CUTPURSE = "db118e14-f80e-4895-96b6-ec2eab18e0cc";

for (const count of COUNTS) {
  clause(CUTPURSE, "1:rule", `${count} seats: when it damages a faction P1 picks an item the defending player (not chosen by anyone) controls and destroys it; other players' items are not pickable`, () => {
    for (const defender of others(count)) {
      const t = table(count, [
        { key: "card", def: printing(CUTPURSE), owner: P1, zone: "play" },
        ...seatsOf(count).slice(1).flatMap((seat) => plain(`filler-${seat}-`, 0, seat, "play")),
        ...seatsOf(count).slice(1).flatMap((seat) => [0, 1].map((i): CardPlacement => ({ key: `item-${seat}-${i}`, def: item({ name: `Item ${seat} ${i}` }), owner: seat, zone: "play" })))
      ]);
      const asked = battle(t, P1, ["card"], defender, [], (pc) => {
        if (pc.declaration?.id === "it") {
          assert.deepEqual(pickable(t), ids(t, `item-${defender}-0`, `item-${defender}-1`).sort(), "only the defending player's items are pickable");
          return { kind: "chooserSelectsTarget", selected: ids(t, `item-${defender}-1`) };
        }
        return undefined;
      });
      assert.deepEqual(asked.map((a) => [a.who, a.decl]), [[P1, "it"]], "P1 picks (the other side of the battle is not asked)");
      assert.equal(zoneOf(t, `item-${defender}-1`), "discard");
      for (const seat of others(count, defender)) for (const i of [0, 1]) assert.equal(zoneOf(t, `item-${seat}-${i}`), "play", `${seat}'s items are untouched`);
    }
    // No item to pick: nothing is destroyed.
    const t = table(count, [{ key: "card", def: printing(CUTPURSE), owner: P1, zone: "play" }, { key: "other-item", def: item({ name: "Other item" }), owner: P3, zone: "play" }]);
    battle(t, P1, ["card"], P2);
    assert.equal(zoneOf(t, "other-item"), "play");
  });
}

