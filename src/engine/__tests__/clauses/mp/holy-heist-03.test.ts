// Multiplayer clause tests, Holy Heist part 3: ten cards whose printed text says who is affected (an opponent that discards,
// "pick a player", "that player", "a player controls", "reveal"). Real printings, real 3-seat games, `perform` only.

import assert from "node:assert/strict";
import { clause, printing } from "../_clause.js";
import type { CardDefinition, PlayerId } from "../../../../engine.js";
import { buildGame, item, location as locationCard, noDevelopFaction, resourceCard } from "../../support/fixtures.js";
import {
  P1, P2, P3, activate, answer, bank, character, deckOf, discardOf, factionOf, filler, handOf, influenceOf, pending, pick, pickCandidates, pickIds,
  play, playRequirements, refusal, resolvePendingResponses, seatsOf, sorted, table, tokens, volition, zoneOf,
  type CardPlacement, type Table
} from "./_holy-heist.js";

const endTurn = (t: Table, who: PlayerId): void => {
  t.engine.perform({ type: "endTurn", playerId: who } as never);
  resolvePendingResponses(t.engine);
};

/** Ends `who`'s turn and settles the next turn start's trigger order (Restore Rule first), leaving the Casino's own prompt open. */
function startNextTurn(t: Table, who: PlayerId): void {
  endTurn(t, who);
  for (let guard = 0; guard < 10 && pending(t)?.kind === "orderTriggers"; guard++) {
    const triggers = (pending(t) as unknown as { triggers: Array<{ abilityId: string }> }).triggers;
    const next = triggers.find((trigger) => trigger.abilityId === "restoreRule") ?? triggers[0]!;
    t.engine.perform({ type: "resolvePendingChoice", playerId: pending(t)!.playerId, choice: { kind: "orderTriggers", next } } as never);
    resolvePendingResponses(t.engine);
  }
}

/** Every card of `key` removed from play (a quiet way to make a card leave). */
function leavePlay(t: Table, key: string): void {
  const id = t.id(key);
  t.engine.state.cards[id]!.zone = "discard";
  for (const seat of t.seats) t.engine.state.players[seat]!.play = t.engine.state.players[seat]!.play.filter((c) => c !== id);
}

// --- Bewilderbeast -------------------------------------------------------------------------------------------------
// When an opponent discards any number of cards, this card gains X strength and X life this turn, where X is the number of cards discarded.

const BEAST = "61af506c-d6e4-4b48-aa10-e959b670aaa3";

/** An item whose ability makes `who` discard `count` cards of their own choice (a synthetic source of real discards). */
function discarder(who: PlayerId, count: number): CardDefinition {
  return item({
    name: `Discarder-${who}-${count}`,
    behavior: {
      abilities: [
        {
          id: "discard",
          type: "activated",
          costs: [],
          effects: [
            {
              type: "chooserSelectsTarget",
              chooser: { type: "player", id: who },
              declaration: { id: "d", selector: { zone: "hand", conditions: [{ type: "targetOwnedBy", target: { type: "selected", id: "__candidate" }, player: { type: "player", id: who } }] }, count },
              effects: [{ type: "forEach", selected: "d", effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "discard" }] }]
            }
          ]
        }
      ]
    }
  });
}

clause(BEAST, "0:rule", "3 seats: P2 discards 2 (+2/+2), then P3 discards 1 the same turn (+1/+1 more, 3/3 in all); P1's own discard adds nothing; the bonuses end with the turn", () => {
  const printed = printing(BEAST);
  const t = table(3, [
    { key: "bb", def: printing(BEAST), owner: P1, zone: "play" },
    { key: "d2", def: discarder(P2, 2), owner: P1, zone: "play" },
    { key: "d3", def: discarder(P3, 1), owner: P1, zone: "play" },
    { key: "d1", def: discarder(P1, 2), owner: P1, zone: "play" },
    ...filler("m", 4, P1),
    ...filler("a", 4, P2),
    ...filler("b", 4, P3)
  ]);
  const bonus = (stat: "strength" | "life"): number => t.engine.getStat(t.id("bb"), stat) - (stat === "strength" ? printed.strength! : printed.life!);
  assert.deepEqual([bonus("strength"), bonus("life")], [0, 0]);

  // P1 discards 2 of its own: Bewilderbeast ignores it.
  activate(t, P1, "d1", "discard");
  assert.equal(pending(t)?.playerId, P1);
  pick(t, P1, "m0", "m1");
  assert.equal(discardOf(t, P1).length, 2);
  assert.deepEqual([bonus("strength"), bonus("life")], [0, 0], "the controller's own discard is not an opponent's");

  activate(t, P1, "d2", "discard");
  assert.equal(pending(t)?.playerId, P2, "P2 chooses what P2 discards");
  pick(t, P2, "a0", "a1");
  assert.deepEqual([bonus("strength"), bonus("life")], [2, 2], "X = 2 for P2's discard");

  activate(t, P1, "d3", "discard");
  assert.equal(pending(t)?.playerId, P3);
  pick(t, P3, "b0");
  assert.deepEqual([bonus("strength"), bonus("life")], [3, 3], "P3's card adds 1 more, cumulative over both opponents");
  assert.equal(t.engine.getStat(t.id("bb"), "speed"), printed.speed);

  endTurn(t, P1);
  assert.equal(t.engine.state.activePlayerId, P2);
  assert.deepEqual([bonus("strength"), bonus("life")], [0, 0], "the bonuses end at end of turn");
});

// --- Eldridge Gosche, Godstealer -------------------------------------------------------------------------------------
// TRIBUTE -- COST: Pay 1. Destroy this card. Pick a player. -- EFFECT: That player discards 2 cards. Draw a card.

const ELDRIDGE = "6d511d44-9e80-443b-b67c-ae9625d671dd";

function eldridgeTable(): Table {
  return table(3, [
    { key: "eg", def: printing(ELDRIDGE), owner: P1, zone: "play" },
    ...bank("obsession", 2, P1),
    ...filler("m", 3, P1),
    ...filler("dk", 3, P1, "deck"),
    ...filler("a", 3, P2),
    ...filler("b", 3, P3)
  ]);
}

/** Eldridge's own death trigger may offer tokens for the cards P1 controls: decline it. */
function declineSprinkle(t: Table): void {
  if (pending(t)?.kind === "selectTargets") answer(t, "selectTargets", P1, { kind: "selectTargets", selected: { sprinkle: [] } });
}

clause(ELDRIDGE, "3:ability:eldridge-tribute", "3 seats: the pick offers P1's, P2's and P3's factions with no opponent step; picking P3 makes P3 (not P2) discard 2 of P3's choice and P1 draws a card", () => {
  const t = eldridgeTable();
  assert.deepEqual(sorted(pickCandidates(t, P1, "eg", "p", { abilityId: "eldridge-tribute" })), sorted(t.seats.map((seat) => factionOf(t, seat))));
  assert.deepEqual(playRequirements(t, P1, "eg", "eldridge-tribute").filter((r) => r.kind === "players"), [], "no opponent / player choice step");
  const hands = { p1: handOf(t, P1).length, p2: handOf(t, P2).length, p3: handOf(t, P3).length };
  const ready = t.engine.getAvailableResourceCount(P1);
  activate(t, P1, "eg", "eldridge-tribute", { selected: { p: [factionOf(t, P3)] } });
  declineSprinkle(t);
  assert.equal(ready - t.engine.getAvailableResourceCount(P1), 1, "COST: pay 1");
  assert.notEqual(zoneOf(t, "eg"), "play", "COST: Eldridge is destroyed");
  const pc = pending(t);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P3, "the picked player chooses what to discard");
  for (const wrong of ["a0", "m0"]) assert.throws(() => t.engine.perform({ type: "resolvePendingChoice", playerId: P3, choice: { kind: "chooserSelectsTarget", selected: [t.id(wrong), t.id("b0")] } } as never), /./s, `${wrong} is not in P3's hand`);
  pick(t, P3, "b0", "b2");
  assert.equal(pending(t), undefined);
  assert.equal(zoneOf(t, "b0"), "discard");
  assert.equal(zoneOf(t, "b2"), "discard");
  assert.equal(zoneOf(t, "b1"), "hand", "exactly two");
  assert.equal(handOf(t, P3).length, hands.p3 - 2);
  assert.equal(handOf(t, P2).length, hands.p2, "P2's hand is unchanged");
  assert.equal(discardOf(t, P2).length, 0);
  assert.equal(handOf(t, P1).length, hands.p1 + 1, "P1 draws a card");
});

clause(ELDRIDGE, "3:ability:eldridge-tribute", "3 seats: picking P1's own faction makes P1 discard 2 of P1's own cards and draw 1; P2's and P3's hands are unchanged", () => {
  const t = eldridgeTable();
  activate(t, P1, "eg", "eldridge-tribute", { selected: { p: [factionOf(t, P1)] } });
  declineSprinkle(t);
  assert.equal(pending(t)?.playerId, P1);
  pick(t, P1, "m0", "m1");
  assert.equal(zoneOf(t, "m0"), "discard");
  assert.equal(zoneOf(t, "m1"), "discard");
  assert.equal(handOf(t, P1).length, 3 - 2 + 1, "discarded 2, drew 1");
  assert.equal(handOf(t, P2).length, 3);
  assert.equal(handOf(t, P3).length, 3);
});

// --- Seance Sensor -------------------------------------------------------------------------------------------------
// SEIZE -- COST: Remove a token from this card. Deplete this card. Pick a player. -- EFFECT: That player discards a card.

const SENSOR = "5a8d4a87-61b2-4e20-899c-250830e15eca";

function sensorTable(): Table {
  return table(3, [
    { key: "s", def: printing(SENSOR), owner: P1, zone: "play", counters: { token: 2 } },
    ...filler("m", 3, P1),
    ...filler("a", 3, P2),
    ...filler("b", 3, P3)
  ]);
}

clause(SENSOR, "1:ability:seance-seize", "3 seats: the pick offers all three factions with no opponent step; picking P2 makes P2 (not P3) choose and discard a card; P1's and P3's hands are unchanged", () => {
  const t = sensorTable();
  assert.deepEqual(sorted(pickCandidates(t, P1, "s", "p", { abilityId: "seance-seize" })), sorted(t.seats.map((seat) => factionOf(t, seat))));
  assert.deepEqual(playRequirements(t, P1, "s", "seance-seize").filter((r) => r.kind === "players"), []);
  activate(t, P1, "s", "seance-seize", { selected: { p: [factionOf(t, P2)] } });
  assert.equal(tokens(t, "s"), 1, "COST: one token removed");
  assert.equal(t.engine.state.cards[t.id("s")]!.depleted, true, "COST: depleted");
  const pc = pending(t);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P2, "the picked player chooses");
  for (const wrong of ["b0", "m0"]) assert.throws(() => t.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [t.id(wrong)] } } as never), /./s, `${wrong} is not in P2's hand`);
  pick(t, P2, "a1");
  assert.equal(pending(t), undefined);
  assert.deepEqual(discardOf(t, P2), [t.id("a1")]);
  assert.equal(handOf(t, P2).length, 2);
  assert.equal(handOf(t, P3).length, 3, "P3's hand is unchanged");
  assert.equal(handOf(t, P1).length, 3, "P1's hand is unchanged");
  assert.equal(discardOf(t, P3).length, 0);
});

clause(SENSOR, "1:ability:seance-seize", "3 seats: picking P1 makes P1 discard a card of P1's own; P2 and P3 keep their hands", () => {
  const t = sensorTable();
  activate(t, P1, "s", "seance-seize", { selected: { p: [factionOf(t, P1)] } });
  assert.equal(pending(t)?.playerId, P1);
  pick(t, P1, "m2");
  assert.deepEqual(discardOf(t, P1), [t.id("m2")]);
  assert.equal(handOf(t, P1).length, 2);
  assert.equal(handOf(t, P2).length, 3);
  assert.equal(handOf(t, P3).length, 3);
});

// --- Uhluhtc Niudla ------------------------------------------------------------------------------------------------
// PREVAIL UPON -- COST: Put a resource you control into its owner's hand. Pick a player. Pay 1.
// EFFECT: That player puts a face-down resource they control into its owner's hand.

const NIUDLA = "7be95bf9-e696-4f1d-82cd-e9f23c94f346";

function niudlaTable(opts: { p3FaceDown?: number } = {}): Table {
  const p3 = opts.p3FaceDown ?? 2;
  return table(3, [
    { key: "un", def: printing(NIUDLA), owner: P1, zone: "play" },
    ...["r1", "r2"].map((key) => ({ key, def: resourceCardDef(key), owner: P1, zone: "play" as const })),
    ...Array.from({ length: 2 }, (_, i) => ({ key: `f2-${i}`, def: resourceCardDef(`f2-${i}`), owner: P2, zone: "play" as const, faceDown: true })),
    ...Array.from({ length: p3 }, (_, i) => ({ key: `f3-${i}`, def: resourceCardDef(`f3-${i}`), owner: P3, zone: "play" as const, faceDown: true })),
    { key: "up3", def: resourceCardDef("up3"), owner: P3, zone: "play" }
  ]);
}

function resourceCardDef(name: string): CardDefinition {
  return resourceCard({ name: `Res ${name}` });
}

clause(NIUDLA, "1:ability:uhluhtc-prevail", "3 seats: P1 pays the cost and picks P3 (all three factions offered, no opponent step): P3, not P2, puts a face-down resource of P3's choice into hand; P2's resources stay", () => {
  const t = niudlaTable();
  assert.deepEqual(sorted(pickCandidates(t, P1, "un", "p", { abilityId: "uhluhtc-prevail", selected: { spent: [t.id("r1")] } })), sorted(t.seats.map((seat) => factionOf(t, seat))));
  assert.deepEqual(playRequirements(t, P1, "un", "uhluhtc-prevail").filter((r) => r.kind === "players"), []);
  const ready = t.engine.getAvailableResourceCount(P1);
  activate(t, P1, "un", "uhluhtc-prevail", { selected: { spent: [t.id("r1")], p: [factionOf(t, P3)] } });
  assert.equal(zoneOf(t, "r1"), "hand", "COST: P1's own resource goes to its owner's hand");
  assert.equal(ready - t.engine.getAvailableResourceCount(P1), 2, "COST: the resource left play and 1 more was paid");
  const pc = pending(t);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P3, "the picked player chooses");
  for (const wrong of ["f2-0", "up3", "r2"]) assert.throws(() => t.engine.perform({ type: "resolvePendingChoice", playerId: P3, choice: { kind: "chooserSelectsTarget", selected: [t.id(wrong)] } } as never), /./s, `${wrong} is not a face-down resource P3 controls`);
  pick(t, P3, "f3-1");
  assert.equal(pending(t), undefined);
  assert.equal(zoneOf(t, "f3-1"), "hand");
  assert.ok(handOf(t, P3).includes(t.id("f3-1")), "into its owner's (P3's) hand");
  assert.equal(zoneOf(t, "f3-0"), "play", "only one");
  assert.equal(zoneOf(t, "up3"), "play");
  assert.equal(zoneOf(t, "f2-0"), "play", "P2's resources are unchanged");
  assert.equal(zoneOf(t, "f2-1"), "play");
  assert.equal(handOf(t, P2).length, 0);
});

clause(NIUDLA, "1:ability:uhluhtc-prevail", "3 seats: picking P2 has only P2 choose; picking P3 when P3 has no face-down resource does nothing", () => {
  const t = niudlaTable();
  activate(t, P1, "un", "uhluhtc-prevail", { selected: { spent: [t.id("r1")], p: [factionOf(t, P2)] } });
  assert.equal(pending(t)?.playerId, P2);
  pick(t, P2, "f2-0");
  assert.equal(zoneOf(t, "f2-0"), "hand");
  assert.equal(zoneOf(t, "f2-1"), "play");
  assert.equal(zoneOf(t, "f3-0"), "play", "P3's resources are unchanged");
  assert.equal(handOf(t, P3).length, 0);

  const none = niudlaTable({ p3FaceDown: 0 });
  activate(none, P1, "un", "uhluhtc-prevail", { selected: { spent: [none.id("r1")], p: [factionOf(none, P3)] } });
  assert.equal(pending(none), undefined, "nothing to put into hand");
  assert.equal(zoneOf(none, "up3"), "play", "a face-up resource is not touched");
  assert.equal(zoneOf(none, "f2-0"), "play");
  assert.equal(zoneOf(none, "f2-1"), "play");
});

// --- Thieving Casino -----------------------------------------------------------------------------------------------
// At the start of your turn, flip a coin. If you win, pick a player and put the top 4 cards of their deck into their discard pile.

const CASINO = "c1fdf3be-4790-4560-a4a0-920a951833a4";

/** A 3-seat game like `table()` but with a fixed RNG (a coin flip is won below 0.5); P3 is active so P1's turn is next. */
function casinoTable(random: () => number): Table {
  const cards: CardPlacement[] = [
    { key: "tc", def: printing(CASINO), owner: P1, zone: "play" },
    ...filler("m", 6, P1, "deck"),
    ...filler("a", 6, P2, "deck"),
    ...filler("b", 6, P3, "deck"),
    ...filler("c", 1, P2, "play")
  ];
  const built = buildGame({
    playerA: { faction: noDevelopFaction() },
    playerB: { faction: noDevelopFaction() },
    extraPlayers: [{ faction: noDevelopFaction() }],
    cards,
    activePlayerId: P3,
    random
  });
  return { engine: built.engine, id: built.id, seats: seatsOf(3) };
}

const WIN = (): number => 0.1;
const LOSE = (): number => 0.9;
const milled = (t: Table, prefix: string, count: number): number => Array.from({ length: count }, (_, i) => zoneOf(t, `${prefix}${i}`)).filter((z) => z === "discard").length;

clause(CASINO, "0:rule", "3 seats: at the start of P1's turn a won flip has P1 pick a player (all three factions); picking P3 mills the top 4 of P3's deck only; P2's and P1's decks are unchanged", () => {
  const t = casinoTable(WIN);
  startNextTurn(t, P3);
  assert.equal(t.engine.state.activePlayerId, P1, "P1's turn starts");
  const pc = pending(t);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1, "the Casino's controller picks");
  assert.throws(() => t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [t.id("c0")] } } as never), /./s, "the pick is a player, not a character");
  const decks = { p1: deckOf(t, P1).length, p2: deckOf(t, P2).length, p3: deckOf(t, P3).length };
  const top3 = deckOf(t, P3).slice(0, 4);
  answer(t, "chooserSelectsTarget", P1, { kind: "chooserSelectsTarget", selected: [factionOf(t, P3)] });
  assert.equal(pending(t), undefined);
  assert.equal(deckOf(t, P3).length, decks.p3 - 4);
  assert.deepEqual(top3.map((id) => t.engine.state.cards[id]!.zone), ["discard", "discard", "discard", "discard"], "the top 4 cards");
  assert.equal(discardOf(t, P3).length, 4, "into P3's discard pile");
  assert.equal(deckOf(t, P2).length, decks.p2, "P2's deck is unchanged");
  assert.equal(discardOf(t, P2).length, 0);
  assert.equal(deckOf(t, P1).length, decks.p1, "P1's deck is unchanged");
  assert.equal(discardOf(t, P1).length, 0);
});

clause(CASINO, "0:rule", "3 seats: picking P1's own faction mills P1's own top 4 and picking P2 mills P2's only (so any of the three can be picked); a lost flip asks for no pick and mills nothing", () => {
  const own = casinoTable(WIN);
  startNextTurn(own, P3);
  answer(own, "chooserSelectsTarget", P1, { kind: "chooserSelectsTarget", selected: [factionOf(own, P1)] });
  assert.equal(milled(own, "m", 6), 4, "P1's own deck was milled by 4");
  assert.equal(milled(own, "a", 6), 0);
  assert.equal(milled(own, "b", 6), 0);

  const lost = casinoTable(LOSE);
  startNextTurn(lost, P3);
  assert.equal(lost.engine.state.activePlayerId, P1);
  assert.equal(pending(lost), undefined, "no pick after losing");
  for (const prefix of ["m", "a", "b"]) assert.equal(milled(lost, prefix, 6), 0);

  const other = casinoTable(WIN);
  startNextTurn(other, P3);
  answer(other, "chooserSelectsTarget", P1, { kind: "chooserSelectsTarget", selected: [factionOf(other, P2)] });
  assert.equal(milled(other, "a", 6), 4, "picking P2 mills P2's deck");
  assert.equal(milled(other, "b", 6), 0, "and not P3's");
});

// --- Gathering of Unlikely Heroes ----------------------------------------------------------------------------------
// That player names 2 non-Universal trades. Search your deck for a character that is one of the named trades and reveal it. If you do,
// put it into your hand. Draw a card.

const GATHERING = "b8166db8-01ba-4103-bfee-dfece934c330";

function gatheringTable(): Table {
  return table(3, [
    { key: "guh", def: printing(GATHERING), owner: P1, zone: "hand" },
    ...volition(3, P1),
    { key: "warChar", def: character({ name: "War Char", trade: "warlord" }), owner: P1, zone: "deck" },
    { key: "gearChar", def: character({ name: "Gear Char", trade: "gearsmith" }), owner: P1, zone: "deck" },
    { key: "rogueChar", def: character({ name: "Rogue Char", trade: "rogue" }), owner: P1, zone: "deck" },
    { key: "univChar", def: character({ name: "Univ Char", trade: "universal" }), owner: P1, zone: "deck" },
    { key: "x1", def: character({ name: "X1", trade: "rogue" }), owner: P1, zone: "deck" },
    { key: "foe2", def: character({ name: "Foe Two", trade: "warlord" }), owner: P2, zone: "deck" },
    { key: "foe3", def: character({ name: "Foe Three", trade: "warlord" }), owner: P3, zone: "deck" }
  ]);
}

const nameAnswer = (t: Table, who: PlayerId, value: string): void => answer(t, "nameValue", who, { kind: "nameValue", value });

clause(GATHERING, "1:rule", "3 seats: with P3 picked, P3 (not P2) names 2 non-Universal trades; Universal is refused; P1 then finds a character of a named trade in P1's own deck and draws", () => {
  const t = gatheringTable();
  const hand = handOf(t, P1).length;
  play(t, P1, "guh", { selected: { p: [factionOf(t, P3)] } });
  let pc = pending(t);
  assert.equal(pc?.kind, "nameValue");
  assert.equal(pc?.playerId, P3, "the picked opponent names the first trade");
  assert.equal(pc?.valueKind, "trade");
  assert.throws(() => t.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "nameValue", value: "warlord" } } as never), /./s, "P2 is not asked to name anything");
  refusal(() => nameAnswer(t, P3, "universal"));
  nameAnswer(t, P3, "warlord");
  pc = pending(t);
  assert.equal(pc?.kind, "nameValue", "a second trade is named");
  assert.equal(pc?.playerId, P3, "again by P3");
  refusal(() => nameAnswer(t, P3, "universal"));
  nameAnswer(t, P3, "gearsmith");
  pc = pending(t);
  assert.equal(pc?.kind, "chooserSelectsTarget", "only then the search");
  assert.equal(pc?.playerId, P1, "P1 searches");
  for (const bad of ["rogueChar", "univChar", "foe2", "foe3"]) assert.throws(() => t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [t.id(bad)] } } as never), /./s, `${bad} is not a legal find`);
  pickIds(t, P1, t.id("gearChar"));
  assert.equal(pending(t), undefined);
  assert.equal(zoneOf(t, "gearChar"), "hand");
  assert.equal(handOf(t, P1).length, hand - 1 + 2, "the tactic left, one found and one drawn");
  assert.equal(handOf(t, P2).length, 0);
  assert.equal(handOf(t, P3).length, 0);
  assert.equal(zoneOf(t, "foe2"), "deck");
  assert.equal(zoneOf(t, "foe3"), "deck");
});

clause(GATHERING, "1:rule", "3 seats: with P2 picked, P2 names the trades and P3 is never asked", () => {
  const t = gatheringTable();
  play(t, P1, "guh", { selected: { p: [factionOf(t, P2)] } });
  assert.equal(pending(t)?.playerId, P2);
  nameAnswer(t, P2, "warlord");
  assert.equal(pending(t)?.playerId, P2);
  nameAnswer(t, P2, "rogue");
  assert.equal(pending(t)?.kind, "chooserSelectsTarget");
  assert.equal(pending(t)?.playerId, P1);
});

// --- Profane Proposal ----------------------------------------------------------------------------------------------
// EXTRA COST: Pick an opponent. -- Search your deck for 5 cards with different names and reveal them. That player separates those
// cards into two piles. Put one pile into your hand and shuffle the other into your deck.

const PROFANE = "7f75ce4c-b81e-45a9-973a-1bbe50fb43e4";
const FIVE = ["d0", "d1", "d2", "d3", "d4"];

function proposalTable(): Table {
  return table(3, [
    { key: "pp", def: printing(PROFANE), owner: P1, zone: "hand" },
    ...bank("obsession", 6, P1),
    ...Array.from({ length: 7 }, (_, i) => ({ key: `d${i}`, def: character({ name: `Distinct ${i}` }), owner: P1, zone: "deck" as const })),
    ...filler("a", 3, P2, "deck"),
    ...filler("b", 3, P3, "deck"),
    ...filler("ah", 2, P2),
    ...filler("bh", 2, P3)
  ]);
}

function proposalWith(picked: PlayerId): Table {
  const t = proposalTable();
  play(t, P1, "pp", { selected: { p: [factionOf(t, picked)] } });
  assert.equal(pending(t)?.kind, "chooserSelectsTarget");
  assert.equal(pending(t)?.playerId, P1, "the search is P1's");
  return t;
}

const asIds = (t: Table, keys: string[]): string[] => keys.map((key) => t.id(key));

clause(PROFANE, "1:rule", "3 seats: with P3 picked P1 finds 5 differently named cards in P1's own deck; P3 (not P2) separates them; P1 takes one pile and the other goes back into the deck", () => {
  const t = proposalWith(P3);
  for (const bad of ["a0", "b0"]) assert.throws(() => t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: asIds(t, [...FIVE.slice(0, 4), bad]) } } as never), /./s, `${bad} is not in P1's deck`);
  pick(t, P1, ...FIVE);
  const revealed = t.engine.getLog().filter((e) => e.event?.type === "cardsRevealed").flatMap((e) => (e.event as unknown as { cardIds: string[] }).cardIds);
  for (const key of FIVE) assert.ok(revealed.includes(t.id(key)), `${key} was revealed`);
  const pc = pending(t);
  assert.equal(pc?.kind, "pileAssignment");
  assert.equal(pc?.playerId, P3, "the picked opponent separates the piles");
  assert.deepEqual(sorted(pc?.cardIds as string[]), sorted(asIds(t, FIVE)));
  const split = (who: PlayerId): void => {
    t.engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "pileAssignment", pile1: asIds(t, ["d0", "d1"]), pile2: asIds(t, ["d2", "d3", "d4"]) } } as never);
  };
  assert.throws(() => split(P2), /./s, "P2 takes no part");
  assert.throws(() => split(P1), /./s, "nor does P1 separate");
  answer(t, "pileAssignment", P3, { kind: "pileAssignment", pile1: asIds(t, ["d0", "d1"]), pile2: asIds(t, ["d2", "d3", "d4"]) });
  const choice = pending(t);
  assert.equal(choice?.kind, "chooserSelectsOption");
  assert.equal(choice?.playerId, P1, "P1 chooses the pile");
  answer(t, "chooserSelectsOption", P1, { kind: "chooserSelectsOption", index: 0 });
  assert.equal(pending(t), undefined);
  for (const key of ["d0", "d1"]) assert.equal(zoneOf(t, key), "hand");
  for (const key of ["d2", "d3", "d4"]) assert.equal(zoneOf(t, key), "deck", `${key} was shuffled back into P1's deck`);
  assert.equal(deckOf(t, P2).length, 3, "P2's deck is unchanged");
  assert.equal(handOf(t, P2).length, 2, "P2's hand is unchanged");
  assert.equal(discardOf(t, P2).length, 0);
  assert.equal(deckOf(t, P3).length, 3, "P3's deck is unchanged too: P3 only separated");
  assert.equal(handOf(t, P3).length, 2);
});

clause(PROFANE, "1:rule", "3 seats: with P2 picked, P2 separates the piles and P3 takes no part", () => {
  const t = proposalWith(P2);
  pick(t, P1, ...FIVE);
  assert.equal(pending(t)?.kind, "pileAssignment");
  assert.equal(pending(t)?.playerId, P2);
  assert.throws(() => t.engine.perform({ type: "resolvePendingChoice", playerId: P3, choice: { kind: "pileAssignment", pile1: asIds(t, FIVE), pile2: [] } } as never), /./s, "P3 cannot separate");
  answer(t, "pileAssignment", P2, { kind: "pileAssignment", pile1: asIds(t, ["d0"]), pile2: asIds(t, ["d1", "d2", "d3", "d4"]) });
  assert.equal(pending(t)?.playerId, P1);
  answer(t, "chooserSelectsOption", P1, { kind: "chooserSelectsOption", index: 1 });
  assert.equal(zoneOf(t, "d0"), "deck");
  for (const key of ["d1", "d2", "d3", "d4"]) assert.equal(zoneOf(t, key), "hand");
  assert.equal(handOf(t, P3).length, 2);
  assert.equal(deckOf(t, P3).length, 3);
});

// --- Torchlight Sarcophyle -----------------------------------------------------------------------------------------
// While a player controls a character with COVERT, this character gains COVERT.

const SARC = "b6bc3557-e0d3-4bfc-9bc1-138d0d27fb31";
const spy = (name: string): CardDefinition => character({ name, behavior: { keywords: ["covert"] } as never });
const hasCovert = (t: Table): boolean => t.engine.hasKeyword(t.id("sarc"), "covert");

function sarcTable(spyOwner: PlayerId | undefined): Table {
  return table(3, [
    { key: "sarc", def: printing(SARC), owner: P1, zone: "play" },
    ...filler("plain", 1, P2, "play"),
    ...(spyOwner ? [{ key: "spy", def: spy("Spy"), owner: spyOwner, zone: "play" as const }] : [])
  ]);
}

clause(SARC, "0:rule", "3 seats: no COVERT character means no COVERT; a COVERT character that only P3 controls gives it COVERT and it is lost when that character leaves; the same for P2's and for P1's own", () => {
  assert.equal(hasCovert(sarcTable(undefined)), false, "control: nobody has COVERT");
  for (const owner of [P3, P2, P1]) {
    const t = sarcTable(owner);
    assert.equal(hasCovert(t), true, `a COVERT character ${owner} controls`);
    leavePlay(t, "spy");
    assert.equal(hasCovert(t), false, `${owner}'s COVERT character left play`);
  }
  const borrowed = table(3, [
    { key: "sarc", def: printing(SARC), owner: P1, zone: "play" },
    { key: "spy", def: spy("Spy"), owner: P2, zone: "play", controller: P3 }
  ]);
  assert.equal(hasCovert(borrowed), true, "controlled by P3 though owned by P2");
});

// --- Dweedle Tee ---------------------------------------------------------------------------------------------------
// BULGE: [V][V][V] -- COST: Pay 3 or shuffle your deck. Deplete this card. -- EFFECT: Reveal the top card of your deck. Put that card into your
// discard pile. Put tokens on this card equal to the threshold of the revealed card.

const DWEEDLE = "3714b3c6-39af-4c56-a508-ad389be90933";

clause(DWEEDLE, "1:ability:dweedle-bulge", "3 seats: the top card of P1's deck is revealed to every player, goes to P1's discard pile and its threshold in tokens land on Dweedle Tee; nothing is asked of P2 or P3", () => {
  const t = table(3, [
    { key: "dw", def: printing(DWEEDLE), owner: P1, zone: "play" },
    ...volition(3, P1),
    { key: "top", def: character({ name: "Top", threshold: "ddd" as never }), owner: P1, zone: "deck" },
    ...filler("m", 3, P1, "deck"),
    { key: "o2", def: character({ name: "O2", threshold: "rr" as never }), owner: P2, zone: "deck" },
    { key: "o3", def: character({ name: "O3", threshold: "gg" as never }), owner: P3, zone: "deck" }
  ]);
  const events = (type: string): Array<Record<string, unknown>> =>
    t.engine.getLog().map((entry) => entry.event as unknown as Record<string, unknown> | undefined).filter((event): event is Record<string, unknown> => !!event && event.type === type);
  const decks = { p2: deckOf(t, P2).length, p3: deckOf(t, P3).length };
  activate(t, P1, "dw", "dweedle-bulge");
  assert.equal(pending(t), undefined, "nothing is asked of anyone");
  const revealed = events("cardsRevealed");
  assert.deepEqual(revealed.flatMap((e) => (e.cardIds as string[]) ?? []), [t.id("top")], "exactly the top card of P1's deck");
  for (const e of revealed) assert.equal(e.viewerId, "all", "revealed to every player (P2 and P3 alike)");
  assert.deepEqual(discardOf(t, P1), [t.id("top")]);
  assert.equal(tokens(t, "dw"), 3, "tokens equal the threshold [D][D][D]");
  assert.equal(t.engine.state.cards[t.id("dw")]!.depleted, true);
  assert.equal(deckOf(t, P2).length, decks.p2, "P2's deck is untouched");
  assert.equal(deckOf(t, P3).length, decks.p3, "P3's deck is untouched");
  assert.equal(discardOf(t, P2).length + discardOf(t, P3).length, 0);
});

// --- 0v3rw0rk3d 31f ------------------------------------------------------------------------------------------------
// Abilities on locations cannot be used.

const ELF = "7dd26a5f-d0dc-4231-b70a-d11b189f28db";

const goLocation = (name: string): CardDefinition =>
  locationCard({
    name,
    structure: 5,
    behavior: { abilities: [{ id: "go", type: "activated", costs: [], effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }] } as never
  });

function elfTable(active: PlayerId, withElf: boolean): Table {
  return table(
    3,
    [
      ...(withElf ? [{ key: "elf", def: printing(ELF), owner: P1, zone: "play" as const }] : []),
      ...seatsOf(3).map((seat) => ({ key: `loc-${seat}`, def: goLocation(`Loc ${seat}`), owner: seat, zone: "play" as const }))
    ],
    { active }
  );
}

clause(ELF, "0:rule", "3 seats: with the Elf in play a location of P1, of P2 and of P3 each refuse their activated ability; without the Elf each controller can use it", () => {
  for (const seat of seatsOf(3)) {
    const withElf = elfTable(seat, true);
    const before = influenceOf(withElf, seat);
    assert.equal(withElf.engine.getAvailableActivatedAbilities(seat).some((a) => a.cardId === withElf.id(`loc-${seat}`)), false, `${seat}'s location ability is not offered`);
    refusal(() => activate(withElf, seat, `loc-${seat}`, "go"));
    assert.equal(influenceOf(withElf, seat), before, `${seat}'s location did nothing`);

    const control = elfTable(seat, false);
    const start = influenceOf(control, seat);
    activate(control, seat, `loc-${seat}`, "go");
    assert.equal(influenceOf(control, seat), start + 1, `control: ${seat} can use the same ability without the Elf`);
  }
});
