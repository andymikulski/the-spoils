// Multiplayer clause tests (3 and 4 seats) — Decade of Deckadence, part 2: the clauses whose player words changed
// (picks of "an opponent" and the pick-then-"that opponent" chains).

import assert from "node:assert/strict";
import { character, item, location, tactic } from "../../support/fixtures.js";
import { clause, printing, refused } from "../_clause.js";
import {
  accepts,
  activate,
  choosePlayer,
  deck,
  discard,
  expectIdle,
  expectPending,
  factionOf,
  hand,
  ids,
  influence,
  KILL,
  lost,
  needs,
  offered,
  offeredTargets,
  option,
  P1,
  P2,
  P3,
  P4,
  pickTargets,
  playCard,
  plain,
  res,
  select,
  snapshot,
  table,
  zoneOf,
  mayPay,
  type Count,
  type Table
} from "./_dod.js";
import type { CardDefinition, PlayerId } from "../../../../engine.js";

const SEATS_OF = (count: Count): PlayerId[] => [P1, P2, P3, P4].slice(0, count);

/** A free tactic that inflicts `amount` damage to `who`'s faction. */
const hit = (who: PlayerId, amount = 1): CardDefinition =>
  tactic({
    name: `Test Hit ${who}`,
    behavior: { abilities: [{ id: "h", type: "activated", effects: [{ type: "dealDamage", target: { type: "factionOf", player: { type: "player", id: who } }, amount }] }] } as CardDefinition["behavior"]
  });

// --- Chain Reaction ------------------------------------------------------------------------

const CHAIN_REACTION = "5332f878-57a2-46dd-ab1e-f7ab6113a5bd";

function chainTable(count: Count): Table {
  return table(count, [
    { key: "me", def: printing(CHAIN_REACTION), owner: P1, zone: "hand" },
    { key: "place", def: location({ name: "Doomed Place", structure: 3 }), owner: P2, zone: "play" },
    { key: "vic", def: character({ name: "Victim", life: 2 }), owner: P3, zone: "play" },
    { key: "tough", def: character({ name: "Tough", life: 9 }), owner: P3, zone: "play" },
    ...res({ rage: 2 }),
    ...plain("d", 3, P1, "deck")
  ]);
}

clause(CHAIN_REACTION, "1:rule", "3 seats: the opponent is picked only when the last step is reached; P1 picks P2 or P3 and only that faction takes 1 while P1 draws", () => {
  for (const chosen of [P2, P3]) {
    const t = chainTable(3);
    const before = snapshot(t);
    const handBefore = hand(t, P1).length;
    playCard(t, P1, "me", { selected: { l: [t.id("place")] } });
    expectPending(t, "chooserSelectsTarget", P1);
    select(t, P1, ["vic"]);
    choosePlayer(t, P1, [P2, P3], chosen);
    expectIdle(t);
    assert.equal(zoneOf(t, "place"), "discard", "the location took 3 and was destroyed");
    assert.equal(zoneOf(t, "vic"), "discard", "2 damage destroyed the character");
    for (const seat of t.seats) assert.equal(lost(t, before, seat), seat === chosen ? 1 : 0, `${seat}`);
    assert.equal(hand(t, P1).length, handBefore - 1 + 1, "P1 played the card and drew one");
  }
});

clause(CHAIN_REACTION, "1:rule", "3 seats: if the chain stops before the character dies, no opponent is picked and nobody's faction is hit", () => {
  const t = chainTable(3);
  const before = snapshot(t);
  playCard(t, P1, "me", { selected: { l: [t.id("place")] } });
  select(t, P1, ["tough"]);
  assert.equal(zoneOf(t, "tough"), "play");
  expectIdle(t, "no opponent is asked for");
  for (const seat of t.seats) assert.equal(lost(t, before, seat), 0);
  const declined = chainTable(3);
  playCard(declined, P1, "me", { selected: { l: [declined.id("place")] } });
  select(declined, P1, []);
  expectIdle(declined);
  for (const seat of declined.seats) assert.equal(influence(declined, seat), 25);
});

clause(CHAIN_REACTION, "1:rule", "4 seats: P2, P3 and P4 can each be picked, the others are untouched", () => {
  for (const chosen of [P2, P3, P4]) {
    const t = chainTable(4);
    const before = snapshot(t);
    playCard(t, P1, "me", { selected: { l: [t.id("place")] } });
    select(t, P1, ["vic"]);
    choosePlayer(t, P1, [P2, P3, P4], chosen);
    for (const seat of t.seats) assert.equal(lost(t, before, seat), seat === chosen ? 1 : 0, `${seat}`);
  }
});

// --- Devilfang Thunderhoof --------------------------------------------------------------------

const THUNDERHOOF = "e1d91071-20c5-4eac-9dec-5b147de9804e";

function thunderhoofTable(count: Count): Table {
  return table(count, [
    { key: "me", def: printing(THUNDERHOOF), owner: P1, zone: "play", counters: { token: 2 } },
    ...res({ obsession: 4 }),
    ...SEATS_OF(count).slice(1).flatMap((seat) => plain(`${seat}h`, 2, seat, "hand"))
  ]);
}

clause(THUNDERHOOF, "3:ability:thunderhoof-disrupt", "3 seats: the opponent is picked as part of the cost; that opponent, and not the other, chooses and discards a card", () => {
  const probe = thunderhoofTable(3);
  const asks = needs(probe, { type: "activateAbility", playerId: P1, cardId: probe.id("me"), abilityId: "thunderhoof-disrupt" });
  assert.equal(asks[0]!.kind, "players");
  assert.deepEqual(asks[0]!.choices, [{ id: "opp", candidates: [P2, P3] }]);
  refused(() => activate(probe, P1, "me", "thunderhoof-disrupt"), "no opponent picked");
  for (const chosen of [P2, P3]) {
    const t = thunderhoofTable(3);
    const other = chosen === P2 ? P3 : P2;
    activate(t, P1, "me", "thunderhoof-disrupt", { players: { opp: chosen } });
    assert.equal(t.engine.state.cards[t.id("me")]!.counters?.token, 1, "a token was removed as part of the cost");
    expectPending(t, "chooserSelectsTarget", chosen);
    assert.deepEqual(new Set(offered(t)), new Set(ids(t, [`${chosen}h0`, `${chosen}h1`])), "only the picked opponent's hand is offered");
    assert.equal(accepts(t, chosen, { kind: "chooserSelectsTarget", selected: [t.id(`${other}h0`)] }), false);
    select(t, chosen, [`${chosen}h0`]);
    expectIdle(t);
    assert.equal(zoneOf(t, `${chosen}h0`), "discard");
    assert.equal(hand(t, other).length, 2, "the other opponent's hand is unchanged");
  }
});

// --- Drill Garrison -------------------------------------------------------------------------------

const DRILL = "ecf19d3f-857f-4a62-8c29-dd293164c495";

function drillTable(count: Count, rage: number): Table {
  return table(
    count,
    [
      { key: "me", def: printing(DRILL), owner: P1, zone: "play" },
      ...res({ rage }),
      ...SEATS_OF(count).map((seat) => ({ key: `c-${seat}`, def: character({ name: `Char ${seat}`, life: 5 }), owner: seat, zone: "play" as const }))
    ],
    { activePlayerId: SEATS_OF(count)[count - 1]!, turn: count }
  );
}

/** Orders the start-of-turn triggers: the faction's own rules first, then the card's. */
function settleStart(t: Table): void {
  for (let guard = 0; guard < 10; guard++) {
    const choice = t.engine.state.pendingChoice;
    if (choice?.kind !== "orderTriggers") return;
    const next = choice.triggers.find((trigger) => trigger.abilityId === "restoreRule") ?? choice.triggers[0]!;
    t.engine.perform({ type: "resolvePendingChoice", playerId: choice.playerId, choice: { kind: "orderTriggers", next } });
  }
}

/** `player` ends their turn and every response window closes; the next turn's start-of-turn prompts are left pending. */
function endTurnOf(t: Table, player: PlayerId): void {
  t.engine.perform({ type: "endTurn", playerId: player });
  for (let guard = 0; guard < 20 && t.engine.state.responseWindow && !t.engine.state.pendingChoice; guard++) {
    const window = t.engine.state.responseWindow;
    t.engine.perform(window.phase === "acceptingResponses" ? { type: "passPriority", playerId: window.priorityPlayerId } : { type: "advanceFlow" });
  }
  settleStart(t);
}

/** Ends the last seat's turn, so P1's turn starts. */
function toP1Turn(t: Table): void {
  endTurnOf(t, t.seats[t.seats.length - 1]!);
}

clause(DRILL, "1:rule@rrr", "3 seats: at the start of P1's turn P1 may inflict 1 damage to an opponent, picking P2 or P3; only that faction takes it", () => {
  for (const chosen of [P2, P3]) {
    const t = drillTable(3, 3);
    const before = snapshot(t);
    toP1Turn(t);
    expectPending(t, "chooserSelectsOption", P1);
    option(t, P1, 1);
    choosePlayer(t, P1, [P2, P3], chosen);
    expectIdle(t);
    for (const seat of t.seats) assert.equal(lost(t, before, seat), seat === chosen ? 1 : 0, `${seat}`);
  }
});

clause(DRILL, "1:rule@rrr", "3 seats: declining deals no damage and asks for no opponent; the trigger does not fire at P2's or P3's turn start; without [R][R][R] it is inactive", () => {
  const declined = drillTable(3, 3);
  toP1Turn(declined);
  option(declined, P1, 0);
  expectIdle(declined);
  for (const seat of declined.seats) assert.equal(influence(declined, seat), 25);
  const t = drillTable(3, 3);
  t.engine.state.activePlayerId = P1;
  t.engine.state.turn = 1;
  endTurnOf(t, P1);
  assert.equal(t.engine.state.activePlayerId, P2);
  expectIdle(t, "no Drill Garrison prompt at P2's turn start");
  const weak = drillTable(3, 2);
  toP1Turn(weak);
  expectIdle(weak, "inactive without [R][R][R]");
});

// --- Dual Blade Assassin -------------------------------------------------------------------------------

const DUAL_BLADE = "ca0987a9-99ab-462e-8d61-cc898b3441dc";

function dualBladeTable(count: Count): Table {
  const seats = SEATS_OF(count);
  return table(count, [
    { key: "me", def: printing(DUAL_BLADE), owner: P1, zone: "hand" },
    ...res({ rage: 4 }),
    { key: "bait", def: tactic({ name: "Bait" }), owner: P1, zone: "hand" },
    ...seats.map((seat) => ({ key: `hit-${seat}`, def: hit(seat), owner: P1, zone: "hand" as const })),
    { key: "p2-hit-p3", def: hit(P3), owner: P2, zone: "hand" as const }
  ]);
}

clause(DUAL_BLADE, "0:extraCost", "3 seats: P1 may deploy it after inflicting damage to P2's faction or to P3's faction; damage by someone else, to P1's own faction or none refuses it", () => {
  for (const victim of [P2, P3]) {
    const t = dualBladeTable(3);
    playCard(t, P1, `hit-${victim}`);
    playCard(t, P1, "me");
    assert.equal(zoneOf(t, "me"), "play", `damage to ${victim}'s faction allows it`);
  }
  const none = dualBladeTable(3);
  refused(() => playCard(none, P1, "me"), "no damage at all");
  assert.equal(zoneOf(none, "me"), "hand");
  const own = dualBladeTable(3);
  playCard(own, P1, "hit-p1");
  refused(() => playCard(own, P1, "me"), "damage to P1's own faction only");
  const byOther = dualBladeTable(3);
  byOther.engine.perform({ type: "playCard", playerId: P1, cardId: byOther.id("bait") });
  byOther.engine.perform({ type: "playCard", playerId: P2, cardId: byOther.id("p2-hit-p3") });
  for (let guard = 0; guard < 20 && byOther.engine.state.responseWindow; guard++) {
    const window = byOther.engine.state.responseWindow;
    byOther.engine.perform(window.phase === "acceptingResponses" ? { type: "passPriority", playerId: window.priorityPlayerId } : { type: "advanceFlow" });
  }
  assert.ok(influence(byOther, P3) < 25, "P2 damaged P3's faction");
  refused(() => playCard(byOther, P1, "me"), "P2 (not P1) damaged P3's faction");
});

// --- Engorged Sarcophyle ------------------------------------------------------------------------------

const ENGORGED = "3ad8995c-8bd2-4e07-9e64-1be39cc38f0d";

function engorgedTable(count: Count): Table {
  const seats = SEATS_OF(count);
  return table(count, [
    { key: "me", def: printing(ENGORGED), owner: P1, zone: "play" },
    { key: "kill", def: KILL, owner: P1, zone: "hand" },
    ...seats.slice(1).flatMap((seat) => plain(`${seat}c`, 2, seat, "play"))
  ]);
}

clause(ENGORGED, "0:rule", "3 seats: P1 picks P2's or P3's faction (not their own); only the picked opponent chooses and destroys a character they control", () => {
  for (const chosen of [P2, P3]) {
    const other = chosen === P2 ? P3 : P2;
    const t = engorgedTable(3);
    playCard(t, P1, "kill", { selected: { t: [t.id("me")] } });
    expectPending(t, "selectTargets", P1);
    assert.deepEqual(new Set(offeredTargets(t, "opp")), new Set([factionOf(t, P2), factionOf(t, P3)]), "only opponents' factions are offered");
    t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { opp: [factionOf(t, chosen)] } } });
    expectPending(t, "chooserSelectsTarget", chosen);
    assert.deepEqual(new Set(offered(t)), new Set(ids(t, [`${chosen}c0`, `${chosen}c1`])), "only the picked opponent's characters are offered");
    select(t, chosen, [`${chosen}c0`]);
    expectIdle(t);
    assert.equal(zoneOf(t, `${chosen}c0`), "discard");
    assert.equal(zoneOf(t, `${other}c0`), "play");
    assert.equal(zoneOf(t, `${other}c1`), "play");
  }
});

// --- Finger Explosive ---------------------------------------------------------------------------------

const FINGER = "e634a62b-1295-4fbe-8349-1434c067e9d1";

function fingerTable(count: Count): Table {
  const seats = SEATS_OF(count);
  return table(count, [
    { key: "me", def: printing(FINGER), owner: P1, zone: "play" },
    ...res({ elitism: 2 }),
    { key: "mine", def: character({ name: "Mine", life: 3 }), owner: P1, zone: "play" },
    { key: "mine2", def: character({ name: "Mine 2", life: 3 }), owner: P1, zone: "play" },
    ...seats.slice(1).map((seat) => ({ key: `c-${seat}`, def: character({ name: `Char ${seat}`, life: 3 }), owner: seat, zone: "play" as const }))
  ]);
}

clause(FINGER, "0:ability:finger-explosive-pull", "3 seats: the second pick may be a character of P2 or of P3, never of P1; both picked characters and Finger Explosive are destroyed and the other opponent loses nothing", () => {
  const probe = fingerTable(3);
  const asks = needs(probe, { type: "activateAbility", playerId: P1, cardId: probe.id("me"), abilityId: "finger-explosive-pull" });
  const theirs = asks.find((step) => step.requirement?.id === "theirs");
  assert.deepEqual(new Set(theirs!.candidates), new Set(ids(probe, ["c-p2", "c-p3"])));
  for (const victim of [P2, P3]) {
    const other = victim === P2 ? P3 : P2;
    const t = fingerTable(3);
    refused(() => activate(t, P1, "me", "finger-explosive-pull", { selected: { mine: [t.id("mine")], theirs: [t.id("mine2")] } }), "a second pick of a P1 character");
    activate(t, P1, "me", "finger-explosive-pull", { selected: { mine: [t.id("mine")], theirs: [t.id(`c-${victim}`)] } });
    assert.equal(zoneOf(t, "mine"), "discard");
    assert.equal(zoneOf(t, `c-${victim}`), "discard");
    assert.equal(zoneOf(t, "me"), "discard");
    assert.equal(zoneOf(t, `c-${other}`), "play", "the opponent that was not picked loses nothing");
  }
});

// --- Illusionist's Trick -------------------------------------------------------------------------------

const ILLUSIONIST = "ab4f55ff-fe17-4dde-b44d-a16b5f7540f6";

function illusionistTable(count: Count): Table {
  const seats = SEATS_OF(count);
  return table(count, [
    { key: "me", def: printing(ILLUSIONIST), owner: P1, zone: "hand" },
    ...res({ deception: 2 }),
    { key: "fast", def: character({ name: "Fast", speed: 3 }), owner: P1, zone: "play" },
    { key: "slow", def: character({ name: "Slow", speed: 2 }), owner: P1, zone: "play" },
    ...plain("d1_", 3, P1, "deck"),
    ...seats.slice(1).flatMap((seat) => plain(`${seat}d`, 6, seat, "deck"))
  ]);
}

clause(ILLUSIONIST, "0:extraCost", "3 seats: the opponent is picked as the extra cost, P2's or P3's faction; P1's own faction is refused and the unpicked opponent is unaffected", () => {
  const probe = illusionistTable(3);
  const asks = needs(probe, { type: "playCard", playerId: P1, cardId: probe.id("me") });
  assert.deepEqual(new Set(asks.find((step) => step.requirement?.id === "p")!.candidates), new Set([factionOf(probe, P2), factionOf(probe, P3)]));
  refused(() => probe.engine.perform({ type: "playCard", playerId: P1, cardId: probe.id("me"), selected: { p: [factionOf(probe, P1)] } }), "P1's own faction");
  for (const chosen of [P2, P3]) {
    const other = chosen === P2 ? P3 : P2;
    const t = illusionistTable(3);
    const otherDeck = deck(t, other).length;
    playCard(t, P1, "me", { selected: { p: [factionOf(t, chosen)] } });
    assert.equal(deck(t, other).length, otherDeck, "the unpicked opponent's deck is unchanged");
    assert.equal(discard(t, other).length, 0);
  }
});

clause(ILLUSIONIST, "1:rule", "3 seats: the picked opponent puts the top cards equal to P1's highest speed (3) into their discard pile, the other opponent's deck is unchanged, and P1 draws", () => {
  for (const chosen of [P2, P3]) {
    const other = chosen === P2 ? P3 : P2;
    const t = illusionistTable(3);
    const handBefore = hand(t, P1).length;
    playCard(t, P1, "me", { selected: { p: [factionOf(t, chosen)] } });
    assert.equal(discard(t, chosen).length, 3, "3 cards milled from the picked opponent's deck");
    assert.equal(deck(t, chosen).length, 3);
    assert.equal(deck(t, other).length, 6);
    assert.equal(discard(t, other).length, 0);
    assert.equal(hand(t, P1).length, handBefore, "P1 played the card and drew one");
  }
});

// --- Ipsighast, the Lustful ---------------------------------------------------------------------------

const IPSIGHAST = "2a7f9474-5265-4804-865f-f4c3b63b6651";

function ipsighastTable(count: Count): Table {
  const seats = SEATS_OF(count);
  return table(count, [
    { key: "me", def: printing(IPSIGHAST), owner: P1, zone: "play" },
    ...res({ deception: 3 }),
    { key: "mine", def: character({ name: "Mine Gone" }), owner: P1, zone: "discard" },
    ...seats.slice(1).flatMap((seat) => [
      { key: `${seat}gone`, def: character({ name: `${seat} Gone` }), owner: seat, zone: "discard" as const },
      ...plain(`${seat}d`, 5, seat, "deck")
    ])
  ]);
}

clause(IPSIGHAST, "1:ability:ipsighast-exhume", "3 seats: the picked character may sit in P2's or P3's discard pile (not P1's); its owner is the opponent whose deck loses the top 3, and the other opponent is unaffected", () => {
  const probe = ipsighastTable(3);
  const asks = needs(probe, { type: "activateAbility", playerId: P1, cardId: probe.id("me"), abilityId: "ipsighast-exhume" });
  assert.deepEqual(new Set(asks.find((step) => step.requirement?.id === "c")!.candidates), new Set(ids(probe, ["p2gone", "p3gone"])));
  for (const chosen of [P2, P3]) {
    const other = chosen === P2 ? P3 : P2;
    const t = ipsighastTable(3);
    activate(t, P1, "me", "ipsighast-exhume", { selected: { c: [t.id(`${chosen}gone`)] } });
    assert.equal(zoneOf(t, `${chosen}gone`), "void");
    assert.ok(t.engine.getKeywords(t.id("me")).includes("covert"), "Ipsighast gains COVERT this turn");
    option(t, P1, 1);
    expectIdle(t);
    assert.equal(deck(t, chosen).length, 2, "the picked card's owner's deck lost 3");
    assert.equal(discard(t, chosen).length, 3);
    assert.equal(deck(t, other).length, 5);
    assert.equal(discard(t, other).length, 1, "the other opponent's discard pile is unchanged");
  }
  const own = ipsighastTable(3);
  refused(() => activate(own, P1, "me", "ipsighast-exhume", { selected: { c: [own.id("mine")] } }), "a character in P1's own discard pile");
});

// --- Opportunistic Pirate -------------------------------------------------------------------------------

const PIRATE = "fa3a29ad-e316-4e66-96f1-d367b4720d1d";

function pirateTable(count: Count): Table {
  const seats = SEATS_OF(count);
  return table(count, [
    { key: "me", def: printing(PIRATE), owner: P1, zone: "hand" },
    ...res({ deception: 8 }),
    ...plain("mine", 2, P1, "discard"),
    ...seats.slice(1).flatMap((seat) => plain(`${seat}x`, 5, seat, "discard"))
  ]);
}

const readyOf = (t: Table, player: PlayerId): number => t.engine.getAvailableResourceCount(player);

clause(PIRATE, "1:extraCost", "3 seats: the voided cards all come from one opponent's discard pile: 3 from P2 cost 4, 4 from P3 cost 3, a P2 and P3 mix is refused, none gives no reduction", () => {
  const probe = pirateTable(3);
  const asks = needs(probe, { type: "playCard", playerId: P1, cardId: probe.id("me") });
  assert.equal(asks[0]!.kind, "players");
  assert.deepEqual(asks[0]!.choices, [{ id: "opp", candidates: [P2, P3] }]);
  const a = pirateTable(3);
  playCard(a, P1, "me", { players: { opp: P2 }, selected: { rem: ids(a, ["p2x0", "p2x1", "p2x2"]) } });
  assert.equal(zoneOf(a, "me"), "play");
  assert.equal(readyOf(a, P1), 8 - 4, "cost 7 reduced by 3");
  assert.deepEqual(ids(a, ["p2x0", "p2x1", "p2x2"]).map((id) => a.engine.state.cards[id]!.zone), ["void", "void", "void"]);
  const b = pirateTable(3);
  playCard(b, P1, "me", { players: { opp: P3 }, selected: { rem: ids(b, ["p3x0", "p3x1", "p3x2", "p3x3"]) } });
  assert.equal(readyOf(b, P1), 8 - 3, "cost 7 reduced by 4");
  const c = pirateTable(3);
  refused(() => playCard(c, P1, "me", { players: { opp: P2 }, selected: { rem: ids(c, ["p2x0", "p3x0"]) } }), "a pick mixing P2's and P3's cards");
  refused(() => playCard(c, P1, "me", { players: { opp: P2 }, selected: { rem: ids(c, ["mine0"]) } }), "a card in P1's own discard pile");
  assert.equal(zoneOf(c, "me"), "hand");
  const d = pirateTable(3);
  playCard(d, P1, "me", { players: { opp: P2 }, selected: { rem: [] } });
  assert.equal(readyOf(d, P1), 8 - 7, "voiding none gives no reduction");
});

// --- Plunging Shriever ---------------------------------------------------------------------------------

const SHRIEVER = "8ca591c5-d7d1-47d2-87a7-cf0a04edb205";

function shrieverTable(count: Count): Table {
  const seats = SEATS_OF(count);
  return table(count, [
    { key: "me", def: printing(SHRIEVER), owner: P1, zone: "play" },
    { key: "mine", def: item({ name: "Mine Item" }), owner: P1, zone: "discard" },
    ...seats.slice(1).map((seat) => ({ key: `${seat}item`, def: item({ name: `${seat} Item` }), owner: seat, zone: "discard" as const }))
  ]);
}

clause(SHRIEVER, "1:ability:fly-away", "3 seats: FLY AWAY voids an item from P2's discard pile or from P3's, and flips Shriever face-down; an item in P1's own discard pile is refused", () => {
  for (const chosen of [P2, P3]) {
    const other = chosen === P2 ? P3 : P2;
    const t = shrieverTable(3);
    activate(t, P1, "me", "fly-away", { selected: { gone: [t.id(`${chosen}item`)] } });
    assert.equal(zoneOf(t, `${chosen}item`), "void");
    assert.equal(zoneOf(t, `${other}item`), "discard");
    assert.equal(t.engine.state.cards[t.id("me")]!.faceDown, true);
    assert.equal(t.engine.state.cards[t.id("me")]!.controllerId, P1);
  }
  const own = shrieverTable(3);
  refused(() => activate(own, P1, "me", "fly-away", { selected: { gone: [own.id("mine")] } }), "an item in P1's own discard pile");
  assert.equal(own.engine.state.cards[own.id("me")]!.faceDown, false);
});

// --- Rantzigite Inquisitor -----------------------------------------------------------------------------

const INQUISITOR = "c27110b6-26bc-473b-874c-0461819ee0d3";

function inquisitorTable(count: Count, zone: "play" | "hand" = "play"): Table {
  const seats = SEATS_OF(count);
  const arcanist = (name: string): CardDefinition => character({ name, trade: "arcanist" });
  return table(count, [
    { key: "me", def: printing(INQUISITOR), owner: P1, zone },
    { key: "kill", def: KILL, owner: P1, zone: "hand" },
    ...res({ obsession: 2 }),
    { key: "mineA", def: arcanist("P1 Arcanist"), owner: P1, zone: "hand" },
    ...seats.slice(1).flatMap((seat) => [{ key: `${seat}A`, def: arcanist(`${seat} Arcanist`), owner: seat, zone: "hand" as const }, ...plain(`${seat}h`, 2, seat, "hand")])
  ]);
}

clause(INQUISITOR, "1:rule", "3 seats: when it is destroyed P1 picks P2 or P3; only that opponent chooses and discards a card from their own hand", () => {
  for (const chosen of [P2, P3]) {
    const other = chosen === P2 ? P3 : P2;
    const t = inquisitorTable(3);
    const otherHand = hand(t, other).length;
    playCard(t, P1, "kill", { selected: { t: [t.id("me")] } });
    choosePlayer(t, P1, [P2, P3], chosen);
    expectPending(t, "chooserSelectsTarget", chosen);
    assert.deepEqual(new Set(offered(t)), new Set(ids(t, [`${chosen}A`, `${chosen}h0`, `${chosen}h1`])), "the picked opponent's hand only");
    select(t, chosen, [`${chosen}h0`]);
    expectIdle(t);
    assert.equal(zoneOf(t, `${chosen}h0`), "discard");
    assert.equal(hand(t, other).length, otherHand, "the other opponent's hand is unchanged");
  }
});

clause(INQUISITOR, "0:extraCost", "3 seats: only an Arcanist card from P1's own hand can be discarded to deploy it free; P2's and P3's hands are not offered", () => {
  const t = inquisitorTable(3, "hand");
  const asks = needs(t, { type: "playCard", playerId: P1, cardId: t.id("me") });
  assert.deepEqual(asks.find((step) => step.requirement?.id === "tossed")!.candidates, [t.id("mineA")]);
  playCard(t, P1, "me", { selected: { tossed: [t.id("mineA")] } });
  assert.equal(zoneOf(t, "me"), "play");
  assert.equal(zoneOf(t, "mineA"), "discard");
  assert.equal(t.engine.getAvailableResourceCount(P1), 2, "deployed for free");
  for (const seat of [P2, P3]) assert.equal(zoneOf(t, `${seat}A`), "hand");
});

// --- Rasputin Unleashed ---------------------------------------------------------------------------------

const RASPUTIN = "2f870c54-2a0f-470c-a73e-2939196e0853";

function rasputinTable(count: Count): Table {
  const seats = SEATS_OF(count);
  return table(count, [
    { key: "me", def: printing(RASPUTIN), owner: P1, zone: "play" },
    { key: "entrant", def: character({ name: "Entrant", speed: 3 }), owner: P1, zone: "hand" },
    ...seats.map((seat) => ({ key: `c-${seat}`, def: character({ name: `Char ${seat}`, speed: 3 }), owner: seat, zone: "play" as const }))
  ]);
}

const speedOf = (t: Table, key: string): number => t.engine.getStat(t.id(key), "speed");

clause(RASPUTIN, "1:rule", "3 seats: when another character enters under P1 the opponent picked has every character's speed reduced to 0 this turn, the other opponent's and P1's keep theirs", () => {
  for (const chosen of [P2, P3]) {
    const other = chosen === P2 ? P3 : P2;
    const t = rasputinTable(3);
    playCard(t, P1, "entrant");
    choosePlayer(t, P1, [P2, P3], chosen);
    expectIdle(t);
    assert.equal(speedOf(t, `c-${chosen}`), 0, `${chosen}'s characters are reduced to 0`);
    assert.equal(speedOf(t, `c-${other}`), 3);
    assert.equal(speedOf(t, "c-p1"), 3);
    assert.equal(speedOf(t, "entrant"), 3);
    t.engine.perform({ type: "endTurn", playerId: P1 });
    for (let guard = 0; guard < 20 && t.engine.state.responseWindow && !t.engine.state.pendingChoice; guard++) {
      const window = t.engine.state.responseWindow;
      t.engine.perform(window.phase === "acceptingResponses" ? { type: "passPriority", playerId: window.priorityPlayerId } : { type: "advanceFlow" });
    }
    assert.equal(speedOf(t, `c-${chosen}`), 3, "speeds return at end of turn");
  }
});

// --- Redonkulous ------------------------------------------------------------------------------------------

const REDONKULOUS = "95277828-2708-4a76-b7ae-2615d898a7e1";

function redonkulousTable(count: Count): Table {
  const seats = SEATS_OF(count);
  return table(count, [
    { key: "me", def: printing(REDONKULOUS), owner: P1, zone: "play", faceDown: true },
    ...res({ obsession: 3, rage: 4 }),
    ...seats.map((seat) => ({ key: `c-${seat}`, def: character({ name: `Char ${seat}`, life: 4 }), owner: seat, zone: "play" as const })),
    ...seats.flatMap((seat) => plain(`${seat}h`, 5, seat, "hand"))
  ]);
}

const flipUp = (t: Table, selected: Record<string, string[]>): void => {
  t.engine.perform({ type: "flipUp", playerId: P1, cardId: t.id("me"), selected: Object.fromEntries(Object.entries(selected).map(([k, v]) => [k, v.map((key) => t.id(key))])), variables: {} } as never);
  for (let guard = 0; guard < 20 && t.engine.state.responseWindow && !t.engine.state.pendingChoice; guard++) {
    const window = t.engine.state.responseWindow;
    t.engine.perform(window.phase === "acceptingResponses" ? { type: "passPriority", playerId: window.priorityPlayerId } : { type: "advanceFlow" });
  }
};

clause(REDONKULOUS, "1:rule", "3 seats: after FLIP UP the picked character's controller, whoever it is, discards 2 and is the one whose hand is checked; the other opponent's hand is untouched", () => {
  for (const owner of [P3, P2, P1]) {
    const t = redonkulousTable(3);
    flipUp(t, { char: [`c-${owner}`] });
    expectPending(t, "chooserSelectsTarget", owner);
    assert.deepEqual(new Set(offered(t)), new Set(ids(t, [0, 1, 2, 3, 4].map((n) => `${owner}h${n}`))), "only that controller's hand is offered");
    select(t, owner, [`${owner}h0`, `${owner}h1`]);
    expectIdle(t);
    assert.equal(hand(t, owner).length, 3);
    assert.equal(zoneOf(t, `c-${owner}`), "void", "3 or fewer cards in hand: the character is voided");
    for (const seat of t.seats.filter((seat) => seat !== owner)) {
      assert.equal(hand(t, seat).length, 5, `${seat}'s hand is untouched`);
      assert.equal(zoneOf(t, `c-${seat}`), "play");
    }
  }
});

// --- Ritual of the Double Monkey ---------------------------------------------------------------------------

const RITUAL = "a013b3ee-9b2b-4ea2-b30d-90c48cacf17a";

function ritualTable(count: Count, obsession: number): Table {
  const seats = SEATS_OF(count);
  return table(count, [
    { key: "me", def: printing(RITUAL), owner: P1, zone: "hand" },
    ...res({ obsession }),
    ...seats.slice(1).flatMap((seat) => plain(`${seat}h`, 5, seat, "hand"))
  ]);
}

clause(RITUAL, "0:rule", "3 seats: P1 picks one opponent when the effect resolves; every discard (1, 2 with [O][O][O], 3 with eight [O]) is by that opponent and the other's hand is untouched", () => {
  for (const [obsession, discards] of [[2, 1], [3, 2], [8, 3]] as const) {
    for (const chosen of [P2, P3]) {
      const other = chosen === P2 ? P3 : P2;
      const t = ritualTable(3, obsession);
      playCard(t, P1, "me");
      choosePlayer(t, P1, [P2, P3], chosen);
      for (let n = 0; n < discards; n++) {
        expectPending(t, "chooserSelectsTarget", chosen);
        assert.deepEqual(new Set(offered(t)), new Set(hand(t, chosen)), "only the picked opponent's hand");
        select(t, chosen, [`${chosen}h${n}`]);
      }
      expectIdle(t);
      assert.equal(hand(t, chosen).length, 5 - discards);
      assert.equal(hand(t, other).length, 5, "the other opponent's hand is untouched");
    }
  }
});

// --- Shriever General -----------------------------------------------------------------------------------------

const GENERAL = "2ac6e84e-f9c7-4c31-9cbb-c7572cb99858";

function generalTable(count: Count): Table {
  const seats = SEATS_OF(count);
  return table(count, [
    { key: "me", def: printing(GENERAL), owner: P1, zone: "hand" },
    ...res({ rage: 8 }),
    ...seats.map((seat) => ({ key: `hit-${seat}`, def: hit(seat), owner: P1, zone: "hand" as const })),
    ...seats.slice(1).flatMap((seat) => plain(`${seat}c`, 2, seat, "play"))
  ]);
}

clause(GENERAL, "1:rule", "3 seats: only P2's faction lost influence: P1 may inflict 2 to that faction and 2 to a character P2 controls (not P3's)", () => {
  for (const victim of [P2, P3]) {
    const other = victim === P2 ? P3 : P2;
    const t = generalTable(3);
    playCard(t, P1, `hit-${victim}`);
    const before = snapshot(t);
    playCard(t, P1, "me");
    mayPay(t, P1, true);
    expectPending(t, "chooserSelectsTarget", P1);
    assert.deepEqual(new Set(offered(t)), new Set(ids(t, [`${victim}c0`, `${victim}c1`])), "only that opponent's characters");
    select(t, P1, [`${victim}c0`]);
    expectIdle(t);
    assert.equal(lost(t, before, victim), 2, "2 damage to the faction that lost influence");
    assert.equal(lost(t, before, other), 0);
    assert.equal(t.engine.state.cards[t.id(`${victim}c0`)]!.damage, 2);
    assert.equal(t.engine.state.cards[t.id(`${other}c0`)]!.damage, 0);
  }
});

clause(GENERAL, "1:rule", "3 seats: when both opponents' factions lost influence P1 picks which; the faction and the character are the same opponent's", () => {
  for (const victim of [P2, P3]) {
    const t = generalTable(3);
    playCard(t, P1, "hit-p2");
    playCard(t, P1, "hit-p3");
    const before = snapshot(t);
    playCard(t, P1, "me");
    choosePlayer(t, P1, [P2, P3], victim);
    mayPay(t, P1, true);
    expectPending(t, "chooserSelectsTarget", P1);
    assert.deepEqual(new Set(offered(t)), new Set(ids(t, [`${victim}c0`, `${victim}c1`])), "only the picked opponent's characters");
    select(t, P1, [`${victim}c1`]);
    assert.equal(lost(t, before, victim), 2);
    assert.equal(lost(t, before, victim === P2 ? P3 : P2), 0);
  }
});

clause(GENERAL, "1:rule", "3 seats: if no opponent's faction lost influence nothing happens, and a loss of P1's own faction does not count", () => {
  const none = generalTable(3);
  playCard(none, P1, "me");
  expectIdle(none, "no prompt without a qualifying faction");
  const own = generalTable(3);
  playCard(own, P1, "hit-p1");
  playCard(own, P1, "me");
  expectIdle(own, "P1's own loss does not count");
  assert.equal(influence(own, P2), 25);
  assert.equal(influence(own, P3), 25);
});

// --- Uhluhtc Unleashed ---------------------------------------------------------------------------------------

const UHLUHTC = "c82c7e2c-41c8-43d7-9ebe-f9fa03837ca2";

function uhluhtcTable(count: Count): Table {
  const seats = SEATS_OF(count);
  return table(count, [
    { key: "me", def: printing(UHLUHTC), owner: P1, zone: "hand" },
    ...res({ obsession: 8 }),
    ...seats.slice(1).flatMap((seat) => [
      ...plain(`${seat}h`, 3, seat, "hand"),
      { key: `${seat}res`, def: res({ rage: 1 }, seat)[0]!.def, owner: seat, zone: "hand" as const },
      ...plain(`${seat}c`, 2, seat, "play")
    ])
  ]);
}

clause(UHLUHTC, "1:rule", "3 seats: when it enters play from P1's hand P1 picks the opponent before choosing an option; the option affects that opponent only", () => {
  for (const chosen of [P2, P3]) {
    const t = uhluhtcTable(3);
    playCard(t, P1, "me");
    assert.equal(zoneOf(t, "me"), "play");
    choosePlayer(t, P1, [P2, P3], chosen);
    expectPending(t, "chooserSelectsOption", P1);
    option(t, P1, 1);
    expectPending(t, "chooserSelectsTarget", chosen);
    select(t, chosen, [`${chosen}c0`]);
    expectIdle(t);
    const other = chosen === P2 ? P3 : P2;
    assert.equal(zoneOf(t, `${other}c0`), "play");
    assert.equal(zoneOf(t, `${other}c1`), "play");
  }
});

clause(UHLUHTC, "2:option:OPTION 1", "3 seats: P1 looks at the picked opponent's hand and chooses a non-resource card there; only that opponent discards it", () => {
  for (const chosen of [P2, P3]) {
    const other = chosen === P2 ? P3 : P2;
    const t = uhluhtcTable(3);
    playCard(t, P1, "me");
    choosePlayer(t, P1, [P2, P3], chosen);
    option(t, P1, 0);
    expectPending(t, "chooserSelectsTarget", P1);
    assert.deepEqual(new Set(offered(t)), new Set(ids(t, [`${chosen}h0`, `${chosen}h1`, `${chosen}h2`])), "the picked opponent's non-resource cards only");
    select(t, P1, [`${chosen}h1`]);
    expectIdle(t);
    assert.equal(zoneOf(t, `${chosen}h1`), "discard");
    assert.equal(hand(t, other).length, 4, "the other opponent's hand is unchanged");
  }
});

clause(UHLUHTC, "3:option:OPTION 2", "3 seats: the picked opponent chooses and destroys a character they control; the other opponent's characters are untouched", () => {
  for (const chosen of [P2, P3]) {
    const other = chosen === P2 ? P3 : P2;
    const t = uhluhtcTable(3);
    playCard(t, P1, "me");
    choosePlayer(t, P1, [P2, P3], chosen);
    option(t, P1, 1);
    expectPending(t, "chooserSelectsTarget", chosen);
    assert.deepEqual(new Set(offered(t)), new Set(ids(t, [`${chosen}c0`, `${chosen}c1`])));
    select(t, chosen, [`${chosen}c1`]);
    assert.equal(zoneOf(t, `${chosen}c1`), "discard");
    assert.equal(zoneOf(t, `${other}c0`), "play");
    assert.equal(zoneOf(t, `${other}c1`), "play");
  }
});

// --- Violating Ritual -----------------------------------------------------------------------------------------

const VIOLATING = "575ecc83-447b-4e43-9e61-87d6513b7949";

function violatingTable(count: Count): Table {
  const seats = SEATS_OF(count);
  return table(count, [
    { key: "me", def: printing(VIOLATING), owner: P1, zone: "hand" },
    ...res({ obsession: 6 }),
    ...plain("d", 3, P1, "deck"),
    ...seats.slice(1).flatMap((seat) => plain(`${seat}h`, 4, seat, "hand"))
  ]);
}

clause(VIOLATING, "0:extraCost", "3 seats: the opponent is picked as part of playing it, P2 or P3 (never P1, never nobody); the unpicked opponent is unaffected", () => {
  const probe = violatingTable(3);
  const asks = needs(probe, { type: "playCard", playerId: P1, cardId: probe.id("me") });
  assert.equal(asks[0]!.kind, "players");
  assert.deepEqual(asks[0]!.choices, [{ id: "opp", candidates: [P2, P3] }]);
  refused(() => playCard(probe, P1, "me"), "no opponent picked");
  refused(() => playCard(probe, P1, "me", { players: { opp: P1 } }), "P1 as the opponent");
  for (const chosen of [P2, P3]) {
    const other = chosen === P2 ? P3 : P2;
    const t = violatingTable(3);
    playCard(t, P1, "me", { players: { opp: chosen } });
    assert.equal(hand(t, other).length, 4, "the unpicked opponent is unaffected");
    expectPending(t, "chooserSelectsTarget", chosen);
  }
});

clause(VIOLATING, "1:rule", "3 seats: the picked opponent (not the other) chooses and discards 2 cards from their own hand, then P1 draws a card", () => {
  for (const chosen of [P2, P3]) {
    const other = chosen === P2 ? P3 : P2;
    const t = violatingTable(3);
    const handBefore = hand(t, P1).length;
    playCard(t, P1, "me", { players: { opp: chosen } });
    expectPending(t, "chooserSelectsTarget", chosen);
    assert.deepEqual(new Set(offered(t)), new Set(hand(t, chosen)), "only the picked opponent's hand");
    select(t, chosen, [`${chosen}h0`, `${chosen}h1`]);
    expectIdle(t);
    assert.equal(hand(t, chosen).length, 2);
    assert.equal(hand(t, other).length, 4);
    assert.equal(hand(t, P1).length, handBefore, "P1 played it and drew one");
  }
});
