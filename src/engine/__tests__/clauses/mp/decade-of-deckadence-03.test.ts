// Multiplayer clause tests (3 and 4 seats) — Decade of Deckadence, part 3: the clauses whose data is unchanged at a
// table of three or more (event-bound triggers, "each faction", every player's cards), proving the claim, plus the
// extra-cost and pick clauses that share a site with a changed clause.

import assert from "node:assert/strict";
import { character, item, location, tactic } from "../../support/fixtures.js";
import { volition } from "../../per-card/_harness.js";
import { mpClause, printing, refused } from "../_clause.js";
import {
  act,
  activate,
  choosePlayer,
  expectIdle,
  expectPending,
  hand,
  ids,
  influence,
  KILL,
  KILL_ANY,
  lost,
  mayPay,
  needs,
  offered,
  oneEach,
  P1,
  P2,
  P3,
  P4,
  playCard,
  plain,
  res,
  select,
  snapshot,
  table,
  zoneOf,
  type Count,
  type Table
} from "./_dod.js";
import type { CardDefinition, PlayerId } from "../../../../engine.js";

const SEATS_OF = (count: Count): PlayerId[] => [P1, P2, P3, P4].slice(0, count);

/** Passes every response window until it closes (stopping at a pending choice). */
function closeWindows(t: Table): void {
  for (let guard = 0; guard < 30 && t.engine.state.responseWindow && !t.engine.state.pendingChoice; guard++) {
    const window = t.engine.state.responseWindow;
    t.engine.perform(window.phase === "acceptingResponses" ? { type: "passPriority", playerId: window.priorityPlayerId } : { type: "advanceFlow" });
  }
}

/** Orders the start-of-turn triggers: the faction's own rules first. */
function settleStart(t: Table): void {
  for (let guard = 0; guard < 10; guard++) {
    const choice = t.engine.state.pendingChoice;
    if (choice?.kind !== "orderTriggers") return;
    const next = choice.triggers.find((trigger) => trigger.abilityId === "restoreRule") ?? choice.triggers[0]!;
    t.engine.perform({ type: "resolvePendingChoice", playerId: choice.playerId, choice: { kind: "orderTriggers", next } });
  }
}

/** Ends the last seat's turn, so P1's turn starts; start-of-turn prompts of the cards are left pending. */
function toP1Turn(t: Table): void {
  t.engine.perform({ type: "endTurn", playerId: t.seats[t.seats.length - 1]! });
  closeWindows(t);
  settleStart(t);
}

// --- Chain Reaction (extra cost) --------------------------------------------------------------------------------

const CHAIN_REACTION = "5332f878-57a2-46dd-ab1e-f7ab6113a5bd";

mpClause(CHAIN_REACTION, "0:extraCost", 3, "3 seats: the extra-cost pick is any location: P1's, P2's and P3's are all legal, a character is not; no opponent is asked for", () => {
  const t = table(3, [
    { key: "me", def: printing(CHAIN_REACTION), owner: P1, zone: "hand" },
    ...res({ rage: 2 }),
    { key: "l1", def: location({ name: "P1 Place" }), owner: P1, zone: "play" },
    { key: "l2", def: location({ name: "P2 Place" }), owner: P2, zone: "play" },
    { key: "l3", def: location({ name: "P3 Place" }), owner: P3, zone: "play" },
    ...oneEach([P1, P2, P3])
  ]);
  const asks = needs(t, { type: "playCard", playerId: P1, cardId: t.id("me") });
  assert.notEqual(asks[0]!.kind, "players", "no opponent is picked up front");
  assert.deepEqual(new Set(asks.find((step) => step.requirement?.id === "l")!.candidates), new Set(ids(t, ["l1", "l2", "l3"])));
  refused(() => t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("me"), selected: { l: [t.id("c-p2")] } }), "a character is not a location");
});

// --- Redonkulous (extra cost) ----------------------------------------------------------------------------------------

const REDONKULOUS = "95277828-2708-4a76-b7ae-2615d898a7e1";

mpClause(REDONKULOUS, "0:extraCost", 3, "3 seats: the extra-cost pick is any character, controlled by P1, P2 or P3; no opponent is asked for", () => {
  const t = table(3, [
    { key: "me", def: printing(REDONKULOUS), owner: P1, zone: "hand" },
    ...res({ obsession: 4 }),
    ...oneEach([P1, P2, P3])
  ]);
  const asks = needs(t, { type: "playCard", playerId: P1, cardId: t.id("me") });
  assert.notEqual(asks[0]!.kind, "players", "no opponent is asked for");
  assert.deepEqual(new Set(asks.find((step) => step.requirement?.id === "char")!.candidates), new Set(ids(t, ["c-p1", "c-p2", "c-p3"])));
  for (const key of ["c-p1", "c-p2", "c-p3"]) {
    const run = table(3, [
      { key: "me", def: printing(REDONKULOUS), owner: P1, zone: "hand" },
      ...res({ obsession: 4 }),
      ...oneEach([P1, P2, P3]),
      ...[P1, P2, P3].flatMap((seat) => plain(`${seat}h`, 5, seat, "hand"))
    ]);
    playCard(run, P1, "me", { selected: { char: [run.id(key)] } });
    assert.equal(zoneOf(run, "me"), "discard", `cast with ${key} picked`);
    expectIdle(run, "a normal deploy discards nothing");
  }
});

// --- Drill Garrison (higher thresholds) ---------------------------------------------------------------------------

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

/** Answers P1's start-of-turn prompts: options decline, the pick of ability `ability` selects `keys`; asserts no opponent is ever asked for. */
function driveDrill(t: Table, ability: "t5" | "t7", keys: string[]): void {
  for (let guard = 0; guard < 20; guard++) {
    const choice = t.engine.state.pendingChoice as unknown as { kind: string; playerId: PlayerId; context?: { abilityId?: string } } | undefined;
    if (!choice) return;
    assert.notEqual(choice.kind, "choosePlayer", "no opponent is picked");
    if (choice.kind === "orderTriggers") settleStart(t);
    else if (choice.kind === "chooserSelectsOption") {
      t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index: 0 } });
    } else if (choice.kind === "chooserSelectsTarget") {
      const mine = choice.context?.abilityId === ability;
      if (mine) assert.deepEqual(new Set(offered(t)), new Set(ids(t, t.seats.map((seat) => `c-${seat}`))), "any character, P1's, P2's or P3's");
      t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: mine ? ids(t, keys) : [] } });
    } else throw new Error(`unexpected ${choice.kind}`);
  }
}

mpClause(DRILL, "2:rule@rrrrr", 3, "3 seats: at the start of P1's turn P1 may pick any character, P1's own or an opponent's, and deplete it; no opponent is picked", () => {
  for (const victim of ["c-p1", "c-p2", "c-p3"]) {
    const t = drillTable(3, 5);
    toP1Turn(t);
    driveDrill(t, "t5", [victim]);
    for (const seat of t.seats) assert.equal(t.engine.state.cards[t.id(`c-${seat}`)]!.depleted, `c-${seat}` === victim, `c-${seat}`);
  }
});

mpClause(DRILL, "3:rule@rrrrrrr", 3, "3 seats: at the start of P1's turn P1 may pick any character, P1's own or an opponent's, and inflict 2 damage to it; no opponent is picked", () => {
  for (const victim of ["c-p1", "c-p2", "c-p3"]) {
    const t = drillTable(3, 7);
    toP1Turn(t);
    driveDrill(t, "t7", [victim]);
    for (const seat of t.seats) assert.equal(t.engine.state.cards[t.id(`c-${seat}`)]!.damage, `c-${seat}` === victim ? 2 : 0, `c-${seat}`);
  }
});

// --- Illusionist's Trick: see part 2 (0:extraCost, 1:rule share the faction pick) -------------------------------

// --- Master General ------------------------------------------------------------------------------------------------

const MASTER_GENERAL = "ffee58bd-4f4b-4742-b601-0d6e84566a2c";

function generalTable(count: Count): Table {
  return table(count, [
    { key: "me", def: printing(MASTER_GENERAL), owner: P1, zone: "play" },
    ...SEATS_OF(count).map((seat) => ({ key: `tactic-${seat}`, def: tactic({ name: `Tactic ${seat}` }), owner: seat, zone: "hand" as const })),
    { key: "troop", def: character({ name: "Troop" }), owner: P1, zone: "hand" }
  ]);
}

/** P1 plays its tactic; `responder` answers it with its own. */
function bothPlay(t: Table, responder: PlayerId): void {
  t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("tactic-p1") });
  while (t.engine.state.responseWindow?.priorityPlayerId !== responder) t.engine.perform({ type: "passPriority", playerId: t.engine.state.responseWindow!.priorityPlayerId });
  act(t, { type: "playCard", playerId: responder, cardId: t.id(`tactic-${responder}`) });
}

mpClause(MASTER_GENERAL, "0:rule", 3, "3 seats: whoever deploys a tactic takes 3 damage to their own faction (P1, P2 or P3), nobody else does, and a non-tactic deploys damages nobody", () => {
  const self = generalTable(3);
  const base = snapshot(self);
  playCard(self, P1, "tactic-p1");
  assert.deepEqual(self.seats.map((seat) => lost(self, base, seat)), [3, 0, 0], "P1's own tactic");
  for (const responder of [P2, P3]) {
    const t = generalTable(3);
    const before = snapshot(t);
    bothPlay(t, responder);
    expectIdle(t, "no opponent is asked for");
    for (const seat of t.seats) assert.equal(lost(t, before, seat), seat === P1 || seat === responder ? 3 : 0, `${seat} when ${responder} responds`);
  }
  const troop = generalTable(3);
  const quiet = snapshot(troop);
  playCard(troop, P1, "troop");
  for (const seat of troop.seats) assert.equal(lost(troop, quiet, seat), 0, "a character deploy damages nobody");
});

// --- Mindrender ------------------------------------------------------------------------------------------------

const MINDRENDER = "1fcd1fda-0d6c-45a6-8b08-918b5c15b6e9";

const DISCARD_ONE = tactic({
  name: "Test Discard",
  behavior: {
    abilities: [
      {
        id: "d",
        type: "activated",
        effects: [
          {
            type: "chooserSelectsTarget",
            chooser: "controller",
            declaration: { id: "x", selector: { owner: "self", zone: "hand", type: "character" }, count: 1 },
            effects: [{ type: "moveCard", target: { type: "selected", id: "x" }, to: "discard" }]
          }
        ]
      }
    ]
  } as CardDefinition["behavior"]
});

function mindrenderTable(count: Count, active: PlayerId): Table {
  const seats = SEATS_OF(count);
  return table(
    count,
    [
      { key: "me", def: printing(MINDRENDER), owner: P1, zone: "hand" },
      ...res({ obsession: 3 }),
      ...seats.flatMap((seat) => [
        { key: `disc-${seat}`, def: DISCARD_ONE, owner: seat, zone: "hand" as const },
        { key: `disc2-${seat}`, def: DISCARD_ONE, owner: seat, zone: "hand" as const },
        ...plain(`${seat}h`, 3, seat, "hand")
      ])
    ],
    { activePlayerId: active, turn: seats.indexOf(active) + 1 }
  );
}

mpClause(MINDRENDER, "1:rule", 3, "3 seats: a discard by P2, or by P3, lets P1 reveal Mindrender and deploy it for 1; a discard by P1 does not; the option comes again on a second discard", () => {
  for (const discarder of [P2, P3]) {
    const t = mindrenderTable(3, discarder);
    playCard(t, discarder, `disc-${discarder}`);
    select(t, discarder, [`${discarder}h0`]);
    expectPending(t, "mayPay", P1);
    mayPay(t, P1, false);
    expectIdle(t);
    assert.equal(zoneOf(t, "me"), "hand", "declined");
    playCard(t, discarder, `disc2-${discarder}`);
    select(t, discarder, [`${discarder}h1`]);
    mayPay(t, P1, true);
    expectPending(t, "deployForFree", P1);
    t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: t.id("me") } });
    closeWindows(t);
    expectIdle(t);
    assert.equal(zoneOf(t, "me"), "play", "revealed and deployed for 1");
    assert.equal(t.engine.getAvailableResourceCount(P1), 2, "for exactly 1");
    const revealed = t.engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
    assert.ok(revealed.length >= 1, "revealed.length >= 1");
  }
  const own = mindrenderTable(3, P1);
  playCard(own, P1, "disc-p1");
  select(own, P1, ["p1h0"]);
  expectIdle(own, "P1's own discard does not trigger it");
  assert.equal(zoneOf(own, "me"), "hand");
});

// --- Purifier of the Fallen ------------------------------------------------------------------------------------------

const PURIFIER = "f74f67af-3f00-4937-a79d-7e3c53858d85";

function purifierTable(count: Count, zone: "hand" | "play"): Table {
  const seats = SEATS_OF(count);
  return table(count, [
    { key: "me", def: printing(PURIFIER), owner: P1, zone },
    ...volition(4, P1),
    { key: "kill", def: KILL, owner: P1, zone: "hand" },
    { key: "demolish", def: KILL_ANY, owner: P1, zone: "hand" },
    ...seats.flatMap((seat) => [...plain(`${seat}x`, 2, seat, "discard"), { key: `c-${seat}`, def: character({ name: `Char ${seat}`, life: 3 }), owner: seat, zone: "play" as const }])
  ]);
}

mpClause(PURIFIER, "0:rule", 3, "3 seats: when it enters play the discard piles of P1, P2 and P3 are all voided", () => {
  const t = purifierTable(3, "hand");
  playCard(t, P1, "me");
  assert.equal(zoneOf(t, "me"), "play");
  for (const seat of t.seats) for (const n of [0, 1]) assert.equal(zoneOf(t, `${seat}x${n}`), "void", `${seat}'s discard card ${n}`);
});

mpClause(PURIFIER, "1:rule", 3, "3 seats: while it is in play a card that would go to P1's, P2's or P3's discard pile is voided instead, and cards go to discard piles again once it leaves", () => {
  for (const seat of [P1, P2, P3]) {
    const t = purifierTable(3, "play");
    playCard(t, P1, "kill", { selected: { t: [t.id(`c-${seat}`)] } });
    assert.equal(zoneOf(t, `c-${seat}`), "void", `${seat}'s destroyed character is voided`);
    assert.equal(t.engine.state.players[seat]!.discard.length, 2, `${seat}'s discard pile gained nothing`);
  }
  const t = purifierTable(3, "play");
  playCard(t, P1, "demolish", { selected: { t: [t.id("me")] } });
  assert.notEqual(zoneOf(t, "me"), "play", "Purifier left play");
  playCard(t, P1, "kill", { selected: { t: [t.id("c-p2")] } });
  assert.equal(zoneOf(t, "c-p2"), "discard", "cards go to discard piles again");
});

// --- Silencer ---------------------------------------------------------------------------------------------------------

const SILENCER = "71422ede-b7b7-4d1c-b176-a0bb7d9a8b30";

function silencerTable(count: Count): Table {
  const seats = SEATS_OF(count);
  return table(count, [
    { key: "me", def: printing(SILENCER), owner: P1, zone: "play" },
    ...seats.slice(1).flatMap((seat) => [
      { key: `${seat}tok`, def: character({ name: `${seat} Tagged`, life: 4 }), owner: seat, zone: "play" as const, counters: { token: 1 } },
      { key: `${seat}plain`, def: character({ name: `${seat} Plain`, life: 4 }), owner: seat, zone: "play" as const }
    ])
  ]);
}

mpClause(SILENCER, "0:rule", 3, "3 seats: a character with a token controlled by P2 or by P3 cannot block it; a character with no token can", () => {
  for (const defender of [P2, P3]) {
    const t = silencerTable(3);
    act(t, { type: "declareAttack", playerId: P1, attackerIds: [t.id("me")], target: { type: "faction", playerId: defender } });
    assert.ok(t.engine.state.battle, "the attack was declared");
    refused(() => t.engine.perform({ type: "declareBlockers", playerId: defender, blockerIds: [t.id(`${defender}tok`)] }), `${defender}'s tagged character cannot block`);
    t.engine.perform({ type: "declareBlockers", playerId: defender, blockerIds: [t.id(`${defender}plain`)] });
    assert.deepEqual(t.engine.state.battle?.blockingParty, [t.id(`${defender}plain`)], "the untagged character blocks");
  }
});

function silencerTrigger(entrant: PlayerId, count: Count): Table {
  const seats = SEATS_OF(count);
  return table(
    count,
    [
      { key: "me", def: printing(SILENCER), owner: P1, zone: "play" },
      ...res({ rage: 2 }),
      ...seats.map((seat) => ({ key: `new-${seat}`, def: character({ name: `New ${seat}` }), owner: seat, zone: "hand" as const }))
    ],
    { activePlayerId: entrant, turn: seats.indexOf(entrant) + 1 }
  );
}

mpClause(SILENCER, "1:rule", 3, "3 seats: a character entering under P2's or P3's control triggers it with nobody asked to choose; P1 may pay 1 to put a token on that character; P1's own entering character does not", () => {
  for (const entrant of [P2, P3]) {
    const t = silencerTrigger(entrant, 3);
    playCard(t, entrant, `new-${entrant}`);
    expectPending(t, "mayPay", P1);
    mayPay(t, P1, true);
    expectIdle(t);
    assert.equal(t.engine.state.cards[t.id(`new-${entrant}`)]!.counters?.token, 1, "a token was put on it");
    assert.equal(t.engine.getAvailableResourceCount(P1), 1, "P1 paid 1");
    const declined = silencerTrigger(entrant, 3);
    playCard(declined, entrant, `new-${entrant}`);
    mayPay(declined, P1, false);
    assert.equal(declined.engine.state.cards[declined.id(`new-${entrant}`)]!.counters?.token ?? 0, 0);
  }
  const own = silencerTrigger(P1, 3);
  playCard(own, P1, "new-p1");
  expectIdle(own, "a character entering under P1's own control does not trigger it");
});

// --- Tempered Rage -----------------------------------------------------------------------------------------------------

const TEMPERED_RAGE = "79e1db0c-a18b-4a66-ad29-1fd522a41f2e";

function rageTable(count: Count): Table {
  const seats = SEATS_OF(count);
  return table(count, [
    { key: "me", def: printing(TEMPERED_RAGE), owner: P1, zone: "play", faceDown: true },
    ...res({ greed: 3 }),
    { key: "kill1", def: KILL, owner: P1, zone: "hand" },
    { key: "kill2", def: KILL, owner: P1, zone: "hand" },
    ...seats.map((seat) => ({ key: `c-${seat}`, def: character({ name: `Char ${seat}`, life: 3 }), owner: seat, zone: "play" as const }))
  ]);
}

mpClause(TEMPERED_RAGE, "1:ability:fire-up", 3, "3 seats: FIRE UP with two characters destroyed this turn makes every faction, P1's, P2's and P3's, lose 2", () => {
  const t = rageTable(3);
  playCard(t, P1, "kill1", { selected: { t: [t.id("c-p2")] } });
  playCard(t, P1, "kill2", { selected: { t: [t.id("c-p3")] } });
  const before = snapshot(t);
  activate(t, P1, "me", "fire-up");
  expectIdle(t);
  assert.equal(t.engine.state.cards[t.id("me")]!.faceDown, false);
  assert.deepEqual(t.seats.map((seat) => lost(t, before, seat)), [2, 2, 2]);
});

mpClause(TEMPERED_RAGE, "1:ability:fire-up", 4, "4 seats: all four factions lose X, and an eliminated seat's faction is not affected", () => {
  const t = rageTable(4);
  playCard(t, P1, "kill1", { selected: { t: [t.id("c-p2")] } });
  playCard(t, P1, "kill2", { selected: { t: [t.id("c-p3")] } });
  const before = snapshot(t);
  activate(t, P1, "me", "fire-up");
  assert.deepEqual(t.seats.map((seat) => lost(t, before, seat)), [2, 2, 2, 2]);
  const out = rageTable(4);
  playCard(out, P1, "kill1", { selected: { t: [out.id("c-p2")] } });
  playCard(out, P1, "kill2", { selected: { t: [out.id("c-p4")] } });
  out.engine.state.players[P3]!.eliminated = { turn: 1 };
  const base = snapshot(out);
  activate(out, P1, "me", "fire-up");
  assert.deepEqual(out.seats.map((seat) => lost(out, base, seat)), [2, 2, 0, 2], "the eliminated P3 is skipped");
});

// --- Upstart Arcanist --------------------------------------------------------------------------------------------------

const UPSTART = "ea562e12-53f2-4da2-831f-fe986b9229cb";

function upstartTable(count: Count): Table {
  const seats = SEATS_OF(count);
  return table(count, [
    { key: "me", def: printing(UPSTART), owner: P1, zone: "play" },
    { key: "top", def: tactic({ name: "Top Tactic" }), owner: P1, zone: "deck" },
    ...plain("under", 2, P1, "deck"),
    ...seats.slice(1).flatMap((seat) => plain(`${seat}d`, 2, seat, "deck"))
  ], { activePlayerId: seats[count - 1]!, turn: count });
}

mpClause(UPSTART, "1:rule", 3, "3 seats: at the start of P1's turn P1 may reveal the top card of P1's deck to everyone, and take it if it is a tactic; P2's and P3's decks are unchanged", () => {
  const t = upstartTable(3);
  const decks = t.seats.map((seat) => t.engine.state.players[seat]!.deck.length);
  const topId = t.engine.state.players[P1]!.deck[0]!;
  toP1Turn(t);
  mayPay(t, P1, true);
  const reveals = t.engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed").map((entry) => entry.event as unknown as { cardIds: string[]; viewerId: string });
  const shown = reveals.find((event) => event.cardIds.includes(topId));
  assert.ok(shown, "the top card was revealed");
  assert.equal(shown!.viewerId, "all", "to every player, P2 and P3 alike");
  mayPay(t, P1, true);
  expectIdle(t);
  assert.ok(hand(t, P1).includes(topId), "the revealed tactic went to P1's hand");
  assert.equal(t.engine.state.players[P2]!.deck.length, decks[1]);
  assert.equal(t.engine.state.players[P3]!.deck.length, decks[2]);
});
