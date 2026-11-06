// Read-only queries for cards that are used from outside play / outside the hand:
//  - getPlayableFromOutsideHand + the extended getCardPlayability: void / removed cards the player holds a play grant
//    (Cheats, Pant Swipe) or a live aura (Voidal Tactician) for;
//  - getActivatedAbilityStatuses / getAvailableActivatedAbilities for abilities with an `activationZone`
//    (Expedition Advisor RECUR, Loyal Companion NINE LIVES / HELPING PAW).
// Each listing is checked against what perform() really accepts, so listing and playing cannot drift.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  answer,
  bank,
  buildGame,
  character,
  developFaction,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic,
  P1,
  P2
} from "./per-card/_harness.js";
import { pending, zoneOf } from "./clauses/_board.js";
import { declineAll, drain, printing, refused } from "./clauses/_clause.js";

const CHEATS = "6d385d6a-39e5-4b8f-b68b-3519ca99268a";
const PANT_SWIPE_REMOVES = "0fae8376-e4e6-4f0c-ae33-8be60ca717a9"; // removeFromGame + grantVoidPlay
const PANT_SWIPE_VOIDS = "3a9ab0e7-b3f3-4956-8f82-be8f0916a9da"; // face-down void + grantVoidPlay
const ECCENTRIC_INQUISITION = "847cd807-e515-4c1f-8c4d-fa0ffd7b217d";
const EXPEDITION_ADVISOR = "b2676ad4-73d9-4c30-abed-d197a93c03f3";
const LOYAL_COMPANION = "66f28631-377f-4671-a133-429f9b3dc309";

const named = (name: string, over: Record<string, unknown> = {}) =>
  character({ name, cost: 1, threshold: "rr", ...over } as never);

const factionOf = (g: { engine: { state: { players: Record<string, { factionId?: string }> } } }, p: string): string =>
  g.engine.state.players[p].factionId!;

// ---------------------------------------------------------------------------
// Cheats, the Dirty Rotten — the full flow
// ---------------------------------------------------------------------------

const LOOT: Array<[string, unknown]> = [
  ["a1", named("Alpha")],
  ["a2", named("Alpha")],
  ["b", named("Bravo")],
  ["c", named("Charlie")],
  ["d", named("Delta")],
  ["e", named("Echo")],
  ["r1", resourceCard({ name: "Res1" } as never)],
  ["r2", resourceCard({ name: "Res2" } as never)]
];

function cheatsGame(bankD: number) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: () => 0,
    cards: [
      { key: "cheats", def: printing(CHEATS), owner: P1, zone: "hand" },
      ...bank("deception", bankD, P1),
      { key: "mine1", def: named("MineOne"), owner: P1, zone: "deck" },
      ...LOOT.map(([key, def]) => ({ key, def, owner: P2, zone: "deck" as const }))
    ] as never
  });
}

function castCheatsAndLoot(g: ReturnType<typeof cheatsGame>) {
  g.engine.perform({
    type: "playCard",
    playerId: P1,
    cardId: g.id("cheats"),
    selected: { opp: [factionOf(g, P2)] }
  } as never);
  resolvePendingResponses(g.engine);
  answer(g.engine, P1, { kind: "chooserSelectsTarget", selected: ["a1", "b", "c", "d"].map(k => g.id(k)) } as never);
  resolvePendingResponses(g.engine);
  assert.equal(pending(g.engine), undefined, "Cheats' search finished");
}

describe("Cheats, the Dirty Rotten: the cards left in the void are listed and playable", () => {
  test("cost 4 -> 4 voided, 2 discarded at random, the other 2 listed with the grant's terms", () => {
    const g = cheatsGame(5);
    assert.deepEqual(g.engine.getPlayableFromOutsideHand(P1), [], "nothing before Cheats resolves");
    castCheatsAndLoot(g);

    const inVoid = ["a1", "b", "c", "d"].filter(k => zoneOf(g.engine, g.id(k)) === "void");
    const inDiscard = ["a1", "b", "c", "d"].filter(k => zoneOf(g.engine, g.id(k)) === "discard");
    assert.equal(inVoid.length, 2, "two stay in the void");
    assert.equal(inDiscard.length, 2, "two went to the discard pile");

    const listed = g.engine.getPlayableFromOutsideHand(P1);
    assert.deepEqual(
      listed.map(l => l.cardId).sort(),
      inVoid.map(k => g.id(k)).sort(),
      "exactly the two voided cards"
    );
    for (const entry of listed) {
      assert.equal(entry.zone, "void");
      assert.equal(entry.faceDown, false);
      assert.equal(entry.source, "grant");
      assert.equal(entry.grantSourceId, g.id("cheats"), "the grant records Cheats as its source");
      assert.equal(entry.ignoreThreshold, true);
      // The threshold is [R][R] and P1 has only [D] icons: only the grant makes it "met".
      assert.equal(entry.playability.thresholdMet, true);
      assert.equal(entry.playability.thresholdWaived, true);
      assert.equal(entry.playability.fromZone, "void");
      assert.equal(entry.playability.grantSourceId, g.id("cheats"));
      assert.equal(entry.playability.numericCost, 1, "the numeric cost is still charged");
      assert.equal(entry.playability.availableResources, 1);
      assert.equal(entry.playability.legalTiming, true);
      assert.equal(entry.playability.playable, true);
    }

    // The discarded pair is not listed, and the opponent has no permission at all.
    assert.deepEqual(g.engine.getPlayableFromOutsideHand(P2), []);
    for (const k of inDiscard) {
      const p = g.engine.getCardPlayability(P1, g.id(k));
      assert.equal(p.playable, false);
      assert.equal(p.fromZone, undefined);
    }
    assert.deepEqual(g.engine.getPlayableHandCards(P1), [], "getPlayableHandCards stays hand-only");
  });

  test("playing one through the playCard action: control moves, cost paid, grant consumed, query shrinks", () => {
    const g = cheatsGame(5);
    castCheatsAndLoot(g);
    const [first, second] = g.engine.getPlayableFromOutsideHand(P1).map(l => l.cardId);
    assert.equal(g.engine.state.voidPlayGrants.length, 2);
    assert.equal(g.engine.state.cards[first].controllerId, P2, "still the opponent's card while in the void");

    play(g.engine, P1, first);
    drain(g.engine, pc => declineAll(pc as never) as never);

    assert.equal(g.engine.state.cards[first].zone, "play");
    assert.equal(g.engine.state.cards[first].controllerId, P1, "the deploying player takes control");
    assert.equal(g.engine.getAvailableResourceCount(P1), 0, "its cost of 1 was paid");
    assert.deepEqual(
      g.engine.state.voidPlayGrants.map(x => x.cardId),
      [second],
      "the grant is consumed when the card leaves the void"
    );
    const after = g.engine.getPlayableFromOutsideHand(P1);
    assert.deepEqual(after.map(l => l.cardId), [second]);
    // Out of resources: still listed (every held permission is), but not playable, and it says why.
    assert.equal(after[0].playability.playable, false);
    assert.equal(after[0].playability.thresholdMet, true);
    assert.equal(after[0].playability.availableResources, 0);
    refused(() => play(g.engine, P1, second), "the numeric cost cannot be paid");
    assert.equal(zoneOf(g.engine, second), "void");
  });

  test("a hand card's playability is unchanged: no outside-hand fields", () => {
    const g = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "h", def: named("InHand"), owner: P1, zone: "hand" }, ...bank("rage", 2, P1)] as never
    });
    const p = g.engine.getCardPlayability(P1, g.id("h"));
    assert.equal(p.playable, true);
    assert.deepEqual(Object.keys(p).sort(), ["availableResources", "legalTiming", "numericCost", "playable", "thresholdMet"]);
  });
});

// ---------------------------------------------------------------------------
// Pant Swipe (removed zone / face-down void) and Eccentric Inquisition (removed zone)
// ---------------------------------------------------------------------------

function pantSwipeGame(printingId: string) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: () => 0,
    cards: [
      { key: "swipe", def: printing(printingId), owner: P1, zone: "hand" },
      ...bank("deception", 8, P1),
      ...["o1", "o2", "o3", "o4", "o5"].map(key => ({ key, def: named(key), owner: P2, zone: "deck" as const }))
    ] as never
  });
}

describe("Pant Swipe: the loot is listed from the removed zone / the void", () => {
  test("removed-from-game printing", () => {
    const g = pantSwipeGame(PANT_SWIPE_REMOVES);
    play(g.engine, P1, g.id("swipe"));
    resolvePendingResponses(g.engine);
    assert.equal(pending(g.engine), undefined);

    const listed = g.engine.getPlayableFromOutsideHand(P1);
    assert.equal(listed.length, 4, "the top 4 of the opponent's deck");
    assert.ok(listed.every(l => l.zone === "removed" && l.source === "grant" && l.ignoreThreshold), "removed-zone grants");
    assert.ok(listed.every(l => l.grantSourceId === g.id("swipe")), "sourced from Pant Swipe");
    assert.equal(zoneOf(g.engine, g.id("o5")), "deck", "the fifth card was untouched");
    assert.ok(listed.every(l => l.playability.fromZone === "removed" && l.playability.thresholdMet));

    const target = listed[0].cardId;
    assert.equal(g.engine.getAvailableResourceCount(P1), 1);
    assert.equal(listed[0].playability.playable, true);
    play(g.engine, P1, target);
    drain(g.engine, pc => declineAll(pc as never) as never);
    assert.equal(zoneOf(g.engine, target), "play");
    assert.equal(g.engine.state.cards[target].controllerId, P1);
    assert.equal(g.engine.getPlayableFromOutsideHand(P1).length, 3, "the used grant is gone");
  });

  test("face-down void printing is flagged faceDown", () => {
    const g = pantSwipeGame(PANT_SWIPE_VOIDS);
    play(g.engine, P1, g.id("swipe"));
    resolvePendingResponses(g.engine);
    const listed = g.engine.getPlayableFromOutsideHand(P1);
    assert.equal(listed.length, 4);
    assert.ok(listed.every(l => l.zone === "void" && l.faceDown), "face-down in the void");
    assert.ok(listed.every(l => l.playability.playable), "playable");
  });
});

describe("Eccentric Inquisition: tactics removed from the opponent's deck", () => {
  test("only the revealed tactics are listed, from the removed zone", () => {
    const g = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      random: () => 0,
      cards: [
        { key: "ei", def: printing(ECCENTRIC_INQUISITION), owner: P1, zone: "hand" },
        ...bank("obsession", 4, P1),
        { key: "t1", def: tactic({ name: "TacOne", cost: 1, threshold: "rrr" }), owner: P2, zone: "deck" },
        { key: "c1", def: named("CharOne"), owner: P2, zone: "deck" },
        { key: "t2", def: tactic({ name: "TacTwo", cost: 1, threshold: "rrr" }), owner: P2, zone: "deck" },
        ...["c2", "c3", "c4", "c5"].map(key => ({ key, def: named(key), owner: P2, zone: "deck" as const })),
        { key: "c6", def: named("c6"), owner: P2, zone: "deck" as const }
      ] as never
    });
    play(g.engine, P1, g.id("ei"));
    resolvePendingResponses(g.engine);
    // Reordering the remaining five: keep the offered order.
    drain(g.engine, pc => declineAll(pc as never) as never);
    const listed = g.engine.getPlayableFromOutsideHand(P1);
    assert.deepEqual(
      listed.map(l => l.cardId).sort(),
      [g.id("t1"), g.id("t2")].sort(),
      "only the two tactics"
    );
    assert.ok(listed.every(l => l.zone === "removed" && l.ignoreThreshold && l.grantSourceId === g.id("ei")));
  });
});

// ---------------------------------------------------------------------------
// A Voidal-Tactician-style aura (`ContinuousAbility.voidPlay`): only while the source is depleted, tactics in your
// own void only. NOTE: no printed card carries this shape today — the real Voidal Tactician is modeled as a
// "when depleted" trigger + deployFromZone (a prompt, no standing permission) — so the aura is exercised here with
// a synthetic card carrying the engine capability.
// ---------------------------------------------------------------------------

const AURA_CARD = character({
  name: "Voidal Tactician",
  behavior: {
    abilities: [
      {
        id: "void-tactics",
        type: "continuous",
        modifiers: [],
        condition: { type: "cardDepleted", target: "source" },
        voidPlay: { ignoreThreshold: true, selector: { zone: "void", type: "tactic", owner: "self" } }
      }
    ]
  }
} as never);

describe("Voidal Tactician-style aura: lists your void tactics only while the source is depleted", () => {
  const board = (depleted: boolean) =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "vt", def: AURA_CARD, owner: P1, zone: "play", depleted },
        ...bank("greed", 1, P1),
        { key: "myTactic", def: tactic({ name: "Mine", cost: 1, threshold: "rrr" }), owner: P1, zone: "void" },
        { key: "myChar", def: named("MyChar"), owner: P1, zone: "void" },
        { key: "theirTactic", def: tactic({ name: "Theirs", cost: 1 }), owner: P2, zone: "void" }
      ] as never
    });

  test("depleted: just my own tactic, source 'aura', threshold waived", () => {
    const g = board(true);
    const listed = g.engine.getPlayableFromOutsideHand(P1);
    assert.deepEqual(listed.map(l => l.cardId), [g.id("myTactic")], "tactics in my void only");
    assert.equal(listed[0].source, "aura");
    assert.equal(listed[0].grantSourceId, g.id("vt"));
    assert.equal(listed[0].zone, "void");
    assert.equal(listed[0].ignoreThreshold, true);
    assert.equal(listed[0].playability.thresholdMet, true, "[R][R][R] is waived");
    assert.equal(listed[0].playability.playable, true);
    assert.equal(g.engine.state.voidPlayGrants.length, 0, "an aura stores no per-card grant");
    assert.deepEqual(g.engine.getPlayableFromOutsideHand(P2), [], "the opponent has no permission");
  });

  test("not depleted: nothing is listed; getCardPlayability agrees and play is refused", () => {
    const g = board(false);
    assert.deepEqual(g.engine.getPlayableFromOutsideHand(P1), []);
    const p = g.engine.getCardPlayability(P1, g.id("myTactic"));
    assert.equal(p.playable, false);
    assert.equal(p.fromZone, undefined);
    refused(() => play(g.engine, P1, g.id("myTactic")), "no permission while the Tactician is ready");
  });

  test("listed tactic is really playable (and the character is not)", () => {
    const g = board(true);
    refused(() => play(g.engine, P1, g.id("myChar")), "a character in the void is not covered");
    refused(() => play(g.engine, P1, g.id("theirTactic")), "an opponent's void is not covered");
    play(g.engine, P1, g.id("myTactic"));
    drain(g.engine, pc => declineAll(pc as never) as never);
    assert.notEqual(zoneOf(g.engine, g.id("myTactic")), "void", "left the void");
    assert.deepEqual(g.engine.getPlayableFromOutsideHand(P1), []);
  });
});

// ---------------------------------------------------------------------------
// Abilities used from the discard pile / hand
// ---------------------------------------------------------------------------

const forCard = <T extends { cardId: string }>(list: T[], cardId: string): T[] => list.filter(x => x.cardId === cardId);

describe("Expedition Advisor: RECUR is listed from the discard pile", () => {
  const board = (greed: number, zone: "discard" | "play" | "hand" = "discard") =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "adv", def: printing(EXPEDITION_ADVISOR), owner: P1, zone },
        ...bank("greed", greed, P1),
        { key: "d1", def: named("DeckOne"), owner: P1, zone: "deck" },
        { key: "d2", def: named("DeckTwo"), owner: P1, zone: "deck" }
      ] as never
    });

  test("usable: listed as available with zone 'discard', and activating works", () => {
    const g = board(4);
    const statuses = forCard(g.engine.getActivatedAbilityStatuses(P1), g.id("adv"));
    assert.equal(statuses.length, 1);
    assert.equal(statuses[0].ability.id, "expedition-recur");
    assert.equal(statuses[0].zone, "discard");
    assert.equal(statuses[0].available, true);
    assert.equal(forCard(g.engine.getAvailableActivatedAbilities(P1), g.id("adv")).length, 1);

    g.engine.perform({ type: "activateAbility", playerId: P1, cardId: g.id("adv"), abilityId: "expedition-recur" } as never);
    resolvePendingResponses(g.engine);
    assert.equal(zoneOf(g.engine, g.id("adv")), "removed", "COST: remove this card from the game");
    assert.equal(g.engine.state.players[P1].hand.length, 2, "drew 2");
    answer(g.engine, P1, { kind: "chooserSelectsTarget", selected: [...g.engine.state.players[P1].hand] } as never);
    resolvePendingResponses(g.engine);
    assert.equal(pending(g.engine), undefined);
    assert.equal(g.engine.state.players[P1].hand.length, 0, "then discarded 2");
    assert.equal(forCard(g.engine.getActivatedAbilityStatuses(P1), g.id("adv")).length, 0, "gone from the listing");
  });

  test("threshold missing: listed (statuses) but not available", () => {
    const g = board(2);
    const statuses = forCard(g.engine.getActivatedAbilityStatuses(P1), g.id("adv"));
    assert.equal(statuses.length, 1);
    assert.equal(statuses[0].zone, "discard");
    assert.equal(statuses[0].available, false);
    assert.equal(statuses[0].unavailableBecause, "threshold");
    assert.equal(forCard(g.engine.getAvailableActivatedAbilities(P1), g.id("adv")).length, 0, "available list: only usable");
    refused(
      () => g.engine.perform({ type: "activateAbility", playerId: P1, cardId: g.id("adv"), abilityId: "expedition-recur" } as never),
      "listing and activateAbility agree",
      /threshold/i
    );
  });

  test("nothing to pay with: not available (cost)", () => {
    const g = board(0);
    const [status] = forCard(g.engine.getActivatedAbilityStatuses(P1), g.id("adv"));
    assert.equal(status.available, false);
  });

  test("only its owner sees it, and it is not offered in play or in hand", () => {
    const g = board(4);
    assert.equal(forCard(g.engine.getActivatedAbilityStatuses(P2), g.id("adv")).length, 0, "the opponent's pile is not theirs");
    for (const zone of ["play", "hand"] as const) {
      const h = board(4, zone);
      assert.equal(
        forCard(h.engine.getActivatedAbilityStatuses(P1), h.id("adv")).length,
        0,
        `a card in ${zone} lists no discard-pile ability`
      );
      assert.equal(forCard(h.engine.getAvailableActivatedAbilities(P1), h.id("adv")).length, 0);
    }
  });
});

describe("Loyal Companion: HELPING PAW from the hand, NINE LIVES from the discard pile", () => {
  const board = (zone: "hand" | "discard" | "play", deception = 5) =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [{ key: "lc", def: printing(LOYAL_COMPANION), owner: P1, zone }, ...bank("deception", deception, P1)] as never
    });

  test("in hand: only HELPING PAW (zone 'hand'); no battle, so not available", () => {
    const g = board("hand");
    const statuses = forCard(g.engine.getActivatedAbilityStatuses(P1), g.id("lc"));
    assert.deepEqual(statuses.map(s => [s.ability.id, s.zone]), [["loyal-helping-paw", "hand"]]);
    assert.equal(statuses[0].available, false, "needs a character that is blocking or being blocked");
    assert.equal(forCard(g.engine.getAvailableActivatedAbilities(P1), g.id("lc")).length, 0);
  });

  test("in the discard pile: only NINE LIVES (zone 'discard'), available, and activating puts it into play", () => {
    const g = board("discard");
    const statuses = forCard(g.engine.getActivatedAbilityStatuses(P1), g.id("lc"));
    assert.deepEqual(statuses.map(s => [s.ability.id, s.zone, s.available]), [["loyal-nine-lives", "discard", true]]);
    assert.equal(forCard(g.engine.getAvailableActivatedAbilities(P1), g.id("lc")).length, 1);
    g.engine.perform({ type: "activateAbility", playerId: P1, cardId: g.id("lc"), abilityId: "loyal-nine-lives" } as never);
    resolvePendingResponses(g.engine);
    drain(g.engine, pc => declineAll(pc as never) as never);
    assert.equal(zoneOf(g.engine, g.id("lc")), "play");
    assert.equal(g.engine.getAvailableResourceCount(P1), 0, "paid 5");
  });

  test("NINE LIVES unaffordable: listed but not available", () => {
    const g = board("discard", 4);
    const [status] = forCard(g.engine.getActivatedAbilityStatuses(P1), g.id("lc"));
    assert.equal(status.zone, "discard");
    assert.equal(status.available, false);
    assert.equal(status.unavailableBecause, "cost");
  });

  test("in play: neither zone-specific ability is listed", () => {
    const g = board("play");
    assert.deepEqual(forCard(g.engine.getActivatedAbilityStatuses(P1), g.id("lc")), []);
    assert.deepEqual(forCard(g.engine.getAvailableActivatedAbilities(P1), g.id("lc")), []);
  });
});

describe("zone separation on a card that has abilities for several zones", () => {
  const multi = character({
    name: "Multi",
    behavior: {
      abilities: [
        { id: "on-board", type: "activated", effects: [] },
        { id: "from-discard", type: "activated", activationZone: "discard", effects: [] },
        { id: "from-hand", type: "activated", activationZone: "hand", effects: [] }
      ]
    }
  } as never);

  for (const [zone, expected] of [
    ["play", "on-board"],
    ["discard", "from-discard"],
    ["hand", "from-hand"]
  ] as const) {
    test(`in ${zone}: exactly '${expected}'`, () => {
      const g = buildGame({
        playerA: { faction: developFaction() },
        cards: [{ key: "m", def: multi, owner: P1, zone }] as never
      });
      const statuses = forCard(g.engine.getActivatedAbilityStatuses(P1), g.id("m"));
      assert.deepEqual(statuses.map(s => [s.ability.id, s.zone]), [[expected, zone]]);
    });
  }

  test("in the deck / void: nothing is listed", () => {
    for (const zone of ["deck", "void"] as const) {
      const g = buildGame({
        playerA: { faction: developFaction() },
        cards: [{ key: "m", def: multi, owner: P1, zone }] as never
      });
      assert.deepEqual(forCard(g.engine.getActivatedAbilityStatuses(P1), g.id("m")), []);
    }
  });
});
