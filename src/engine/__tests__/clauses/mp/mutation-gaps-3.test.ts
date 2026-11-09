// Multiplayer clause tests added after `mp-mutate` (docs/TESTING.md), batch 3: each one fails when a player word in the card's
// data is swapped ("opponents" -> "any" ...), because it checks WHICH cards the engine offers for the pick, with every seat
// (the controller included) holding qualifying cards. Expectations come from each card's PRINTED text.

import assert from "node:assert/strict";
import { mpClause, refused } from "../_clause.js";
import { declareAttackOpenWindow } from "../_battle.js";
import { resolvePendingResponses } from "../../support/fixtures.js";
import { activate, askedPlayers, printing, requirements, res, table, zoneOf, seatsOf, P1, P2, P3 } from "./_mp.js";
import type { Table } from "./_mp.js";
import { character, item } from "../../support/fixtures.js";
import type { CardPlacement } from "../../support/fixtures.js";
import type { PlayerId } from "../../../../engine.js";

const others = (count: number): PlayerId[] => seatsOf(count).slice(1);

/** The cards the engine offers for the pick `pickId` of `action` (its own requirement list). */
function offered(t: Table, action: Record<string, unknown>, pickId: string): string[] {
  const step = requirements(t.engine, action).find((entry) => (entry as { requirement?: { id: string } }).requirement?.id === pickId);
  assert.ok(step, `the action asks for the pick ${pickId}`);
  return (step as unknown as { candidates: string[] }).candidates.slice().sort();
}

// =================================================================================
// Death of the Demon Knights
// EXTRA COST: Pick a character an opponent controls. ...
// =================================================================================

const DDK = "053823cb-77ae-494e-83a1-b19084e9038d";

const ddkTable = (count: number): Table =>
  table(count, [
    { key: "ddk", def: printing(DDK), owner: P1, zone: "hand" },
    ...res("obsession", 7, P1),
    { key: "own", def: character({ name: "P1 own" }), owner: P1, zone: "play" },
    ...others(count).flatMap((p): CardPlacement[] => [
      { key: `a-${p}`, def: character({ name: `${p} A` }), owner: p, zone: "play" },
      { key: `b-${p}`, def: character({ name: `${p} B` }), owner: p, zone: "play" }
    ])
  ]);

for (const count of [3, 4] as const) {
  mpClause(DDK, "0:extraCost", count, `${count} seats: the extra-cost pick offers every opponent's characters and never the controller's own`, () => {
    const t = ddkTable(count);
    const action = { type: "playCard", playerId: P1, cardId: t.id("ddk"), selected: {}, variables: {} };
    const want = others(count).flatMap((p) => [t.id(`a-${p}`), t.id(`b-${p}`)]).sort();
    assert.deepEqual(offered(t, action, "mark"), want, "only characters opponents control, from every opponent, none of P1's own");
    assert.equal(zoneOf(t.engine, t.id("own")), "play", "P1's own character is untouched");
  });
}

// =================================================================================
// Smothering Corpulence
// EXTRA COST: Pick a character an opponent controls. ...
// =================================================================================

const SMO = "6c49725e-d71b-43b3-a85f-38ec7396911d";

for (const count of [3, 4] as const) {
  mpClause(SMO, "0:extraCost", count, `${count} seats: the extra-cost pick offers every opponent's character and never one P1 controls`, () => {
    const t = table(count, [
      { key: "smo", def: printing(SMO), owner: P1, zone: "hand" },
      ...res("deception", 2, P1),
      ...res("rage", 2, P1),
      { key: "own", def: character({ name: "P1 own", life: 6 }), owner: P1, zone: "play" },
      ...others(count).flatMap((p): CardPlacement[] => [
        { key: `ch-${p}`, def: character({ name: `Char ${p}`, life: 6 }), owner: p, zone: "play" },
        { key: `top-${p}`, def: character({ name: `Top ${p}`, cost: 4 }), owner: p, zone: "deck" }
      ]),
      { key: "top-me", def: character({ name: "Top me", cost: 2 }), owner: P1, zone: "deck" }
    ]);
    const action = { type: "playCard", playerId: P1, cardId: t.id("smo"), selected: {}, variables: {} };
    const want = others(count).map((p) => t.id(`ch-${p}`)).sort();
    assert.deepEqual(offered(t, action, "c"), want, "one character per opponent, none of P1's own");
  });
}

// =================================================================================
// Carnival Whipmaster
// GRAND THEFT -- COST: Destroy this card. -- EFFECT: Take control of one character and one item an opponent controls.
// =================================================================================

const WHIP = "2f3399c9-e12b-423d-88e7-e23850939fab";

for (const count of [3, 4] as const) {
  mpClause(WHIP, "1:ability:grand-theft", count, `${count} seats: the character pick offers every opponent's characters and never one P1 controls`, () => {
    const t = table(count, [
      { key: "wm", def: printing(WHIP), owner: P1, zone: "play" },
      { key: "own-ch", def: character({ name: "P1 char" }), owner: P1, zone: "play" },
      { key: "own-it", def: item({ name: "P1 item" }), owner: P1, zone: "play" },
      ...others(count).flatMap((p): CardPlacement[] => [
        { key: `ch-${p}`, def: character({ name: `Char ${p}` }), owner: p, zone: "play" },
        { key: `it-${p}`, def: item({ name: `Item ${p}` }), owner: p, zone: "play" }
      ])
    ]);
    const action = { type: "activateAbility", playerId: P1, cardId: t.id("wm"), abilityId: "grand-theft", selected: {}, variables: {} };
    const want = others(count).map((p) => t.id(`ch-${p}`)).sort();
    assert.deepEqual(offered(t, action, "ch"), want, "the character pick: one per opponent, not Carnival Whipmaster itself nor P1's own character");
    refused(() => activate(t.engine, P1, t.id("wm"), "grand-theft", { selected: { ch: [t.id("own-ch")], it: [t.id("own-it")] } }), "P1's own character and item");
    assert.equal(zoneOf(t.engine, t.id("wm")), "play", "nothing was paid");
  });
}

// =================================================================================
// Rocket Lawnchair
// COST: Pick a character you own. Pick a character an opponent controls. Destroy this card.
// EFFECT: Destroy the characters. If either character was a member of an opponent's attacking party, destroy all characters in that party.
// =================================================================================

const LAWNCHAIR = "1dd0bbbc-1202-41c2-9073-5ce87acaf67e";

for (const count of [3, 4] as const) {
  mpClause(LAWNCHAIR, "1:ability:rocket-lawnchair-no-eject", count, `${count} seats: a character P1 owns that sits in ANOTHER opponent's attacking party takes that whole party with it, whichever opponent P1 named for the second pick`, () => {
    const named = P2;
    const attacker = P3;
    const t = table(
      count,
      [
        { key: "chair", def: printing(LAWNCHAIR), owner: P1, zone: "play" },
        // P1 owns it, but P3 controls it and attacks with it.
        { key: "mine", def: character({ name: "P1 owned, P3 controlled" }), owner: P1, zone: "play", controller: attacker },
        { key: "mate-a", def: character({ name: "P3 mate A" }), owner: attacker, zone: "play" },
        { key: "mate-b", def: character({ name: "P3 mate B" }), owner: attacker, zone: "play" },
        { key: "theirs", def: character({ name: "P2 char" }), owner: named, zone: "play" },
        ...(count === 4 ? ([{ key: "p4", def: character({ name: "P4 char" }), owner: seatsOf(4)[3]!, zone: "play" }] as CardPlacement[]) : [])
      ],
      attacker
    );
    t.engine.perform({ type: "declareAttack", playerId: attacker, attackerIds: [t.id("mine"), t.id("mate-a"), t.id("mate-b")], target: { type: "faction", playerId: named } } as never);
    for (let guard = 0; guard < 8 && t.engine.state.responseWindow?.priorityPlayerId !== P1; guard++) {
      t.engine.perform({ type: "passPriority", playerId: t.engine.state.responseWindow!.priorityPlayerId } as never);
    }
    assert.equal(t.engine.state.responseWindow?.priorityPlayerId, P1, "P1 may respond to the attack");
    t.engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: t.id("chair"),
      abilityId: "rocket-lawnchair-no-eject",
      players: { opponent: named },
      selected: { mine: [t.id("mine")], theirs: [t.id("theirs")] },
      variables: {}
    } as never);
    resolvePendingResponses(t.engine);
    const fates = ["chair", "mine", "theirs", "mate-a", "mate-b"].map((key) => zoneOf(t.engine, t.id(key)));
    assert.deepEqual(fates, ["discard", "discard", "discard", "discard", "discard"], "both picked characters, the card itself and the whole of P3's attacking party are destroyed");
    if (count === 4) assert.equal(zoneOf(t.engine, t.id("p4")), "play", "P4's character is not in the party");
  });
}

// =================================================================================
// Surprise!
// EXTRA COST: Pick a character attacking your faction or a location you control. ...
// =================================================================================

const SURPRISE = "82f7c006-8b9f-4668-b3db-9507ce0bd479";

for (const count of [3, 4] as const) {
  mpClause(SURPRISE, "0:extraCost", count, `${count} seats: the pick offers the attackers of the attack on my faction (from whichever opponent) and asks for no opponent, nothing else`, () => {
    for (const attacker of others(count)) {
      const t = table(
        count,
        [
          { key: "sur", def: printing(SURPRISE), owner: P1, zone: "hand" },
          ...res("deception", 3, P1),
          { key: "mine", def: character({ name: "Mine", cost: 1, life: 6 }), owner: P1, zone: "play" },
          ...others(count).flatMap((p): CardPlacement[] => [
            { key: `atk-${p}`, def: character({ name: `Atk ${p}`, cost: 3, strength: 2, life: 3 }), owner: p, zone: "play" },
            { key: `idle-${p}`, def: character({ name: `Idle ${p}`, cost: 1 }), owner: p, zone: "play" }
          ]),
          { key: "d0", def: character({ name: "Hit", cost: 3 }), owner: P1, zone: "deck" }
        ],
        attacker
      );
      declareAttackOpenWindow(t.engine, attacker, [t.id(`atk-${attacker}`)], { type: "faction", playerId: P1 });
      const action = { type: "playCard", playerId: P1, cardId: t.id("sur"), selected: {}, variables: {} };
      assert.equal(askedPlayers(t.engine, action), undefined, "no opponent is asked for: the card has no 'your opponent'");
      assert.deepEqual(offered(t, action, "k"), [t.id(`atk-${attacker}`)], `only ${attacker}'s attacker is offered: not the idle characters, not another opponent's, not P1's own`);
    }
  });
}
