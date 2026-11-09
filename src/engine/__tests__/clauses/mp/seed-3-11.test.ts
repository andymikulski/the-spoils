// Multiplayer clause tests for Seed 3, part 11 (The Evil Alliance, The Union of Unextraordinary Miners, The Open R&D
// Faction, Slightly Less Evil Alliance). Every test is a real 3- or 4-seat game with the real printing, driven
// through `perform`: setup rules through `createFactionGame`, abilities on a table with the faction in play.

import assert from "node:assert/strict";
import { character } from "../../support/fixtures.js";
import { clause, isDevelopRuleOffer, printing, refused } from "../_clause.js";
import { answer, controllerOf, settle, staples, table } from "./_seed-3.js";
import type { PlayerId, SpoilsEngine } from "./_seed-3.js";
import { factionGame, handSize, IMPERIAL, resourcesOf, TOURNAMENT } from "./_seed-3-factions.js";
import { P1, P2, P3, P4 } from "./_seed-3-factions.js";

const EVIL = "9dc309f4-d43f-4515-841e-ed982ce026e7"; // X is the number of opponents you have at the start of the game. -- Starting influence 15+10X. STARTING RESOURCES: 1+X staples. DEVELOP RULE: draw a card or play a resource, repeated X-1 times.
const UNION = "71038369-24cc-48d9-a58c-e658edc01944"; // MONEY FOR NOTHING: choose X ... Your opponent starts with enough staple resources so that both players have the same number.
const OPEN_RD = "ebef8b79-0dcb-401f-81e9-eafd9235fd7d"; // RESEARCH & DEVELOPMENT: Before the game begins, both players create the rules text for an ability. This card has that ability and both players can use it.
const SLEA = "089a2d63-c9b9-4ad7-8c51-1d0d79a0dfbb"; // TEAMWORK -- COST: Pay 2. Pick a card you control. Choose another player. -- EFFECT: The player takes control of the card.

// =====================================================================================
// The Evil Alliance (X = the number of opponents at the start of the game)
// =====================================================================================

const SEATED = [TOURNAMENT, IMPERIAL, TOURNAMENT];

for (const count of [3, 4] as const) {
  const x = count - 1;
  clause(EVIL, "0:rule", `${count} seats: X is ${x}, so the Evil Alliance's controller starts with ${15 + 10 * x} influence; the other seats start with their own factions' influence`, () => {
    const engine = factionGame([printing(EVIL), ...SEATED.slice(0, x)], { firstPlayerId: P1 });
    assert.equal(engine.state.players[P1]!.influence, 15 + 10 * x);
    assert.equal(engine.state.players[P2]!.influence, TOURNAMENT.faction!.startingInfluence);
  });

  clause(EVIL, "1:rule:STARTING RESOURCES", `${count} seats: the Evil Alliance's controller starts with 1+${x} = ${1 + x} staple resources; the other seats start with their own factions' counts`, () => {
    const engine = factionGame([printing(EVIL), ...SEATED.slice(0, x)], { firstPlayerId: P1 });
    assert.equal(resourcesOf(engine, P1).length, 1 + x);
    assert.equal(resourcesOf(engine, P2).length, 2, "the Tournament Faction's own count");
    if (count === 4) assert.equal(resourcesOf(engine, P3).length, 2, "Imperial Army's own 2 Rage");
  });

  clause(EVIL, "4:rule:DEVELOP RULE", `${count} seats: the Evil Alliance's Develop Rule happens ${x} times at the start of its controller's turn (once, then repeated ${x - 1} times); the other seats develop once`, () => {
    const engine = factionGame([printing(EVIL), ...SEATED.slice(0, x)], { firstPlayerId: P1 });
    // Keep every hand, then count the Develop Rule offers raised at the first turn start (P1's).
    for (let guard = 0; engine.state.setup.phase === "mulligan" && guard < 10; guard++) {
      const setup = engine.state.setup;
      if (setup.phase !== "mulligan") break;
      engine.perform({ type: "mulligan", playerId: setup.order[setup.currentIndex]!, cardIds: [] });
    }
    let offers = 0;
    for (let guard = 0; guard < 30 && engine.state.pendingChoice; guard++) {
      const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: PlayerId; triggers?: unknown[]; options?: Array<{ label?: string }> };
      if (pc.kind === "orderTriggers") engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "orderTriggers", next: pc.triggers![0] } } as never);
      else if (pc.kind === "chooserSelectsOption" && isDevelopRuleOffer(pc)) {
        offers++;
        engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsOption", index: pc.options!.findIndex((o) => /^Draw /.test(o.label ?? "")) } } as never);
      } else if (pc.kind === "mayPay") engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "mayPay", pay: false } } as never);
      else break;
    }
    assert.equal(engine.state.activePlayerId, P1);
    assert.equal(offers, x, `the Develop Rule is offered ${x} times at P1's first turn start`);
  });
}

// =====================================================================================
// The Union of Unextraordinary Miners
// =====================================================================================

for (const count of [3, 4] as const) {
  clause(UNION, "2:rule", `${count} seats: the Union's controller selects one opponent before the game begins; only that opponent starts with enough extra staples to match the controller's starting resources, the others start normally`, () => {
    const others = [TOURNAMENT, IMPERIAL, TOURNAMENT].slice(0, count - 1);
    const opponents = [P2, P3, P4].slice(0, count - 1);
    for (const chosen of opponents) {
      const engine = factionGame([printing(UNION), ...others], { firstPlayerId: P1, startingResourceX: { [P1]: 3 } });
      // With two or more opponents setup waits for the Union's controller to select one (MPX-select (2)).
      const setup = engine.state.setup;
      assert.ok(setup.phase === "chooseMatchOpponent", "setup waits for the Union's selection");
      const pending = engine.state.pendingChoice;
      assert.ok(pending?.kind === "choosePlayer" && pending.playerId === P1, "P1 is asked");
      assert.deepEqual([...pending.candidates].sort(), [...opponents].sort(), "every opponent is a candidate, P1 is not");
      engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "choosePlayer", playerId: chosen } });
      const placed = engine.state.setup;
      assert.ok(placed.phase !== "chooseMatchOpponent", "setup continues after the selection");
      assert.equal(resourcesOf(engine, P1).length, 4, "3 staples and 1 Deception");
      for (const seat of opponents) assert.equal(resourcesOf(engine, seat).length, seat === chosen ? 4 : 2, `${seat} ${seat === chosen ? "matches" : "starts with its usual 2"}`);
    }
    void handSize;
  });
}

// =====================================================================================
// The Open R&D Faction
// =====================================================================================

clause(OPEN_RD, "7:rule:RESEARCH & DEVELOPMENT", "3 seats: the created ability can be used by the controller and the one chosen opponent only; the other opponent is refused", () => {
  const spec = { costs: [{ kind: "pay" as const, amount: 1 }], effect: { kind: "draw" as const, amount: 1 } };
  const make = (active: PlayerId) => {
    const t = table(3, [...staples("rage", 1, P1), ...staples("rage", 1, P2), ...staples("rage", 1, P3), ...[P1, P2, P3].flatMap((seat) => [0, 1].map((i) => ({ key: `d-${seat}-${i}`, def: character({ name: `Deck ${seat} ${i}` }), owner: seat, zone: "deck" as const })))], {
      active,
      factions: { [P1]: printing(OPEN_RD) }
    });
    t.engine.applyCreatedFactionAbility(spec, P2);
    return t;
  };
  const abilityOf = (engine: SpoilsEngine) => engine.state.cards[engine.state.players[P1]!.factionId!]!.createdAbility!.ability.id;
  // P2 is the chosen opponent (named when the text was written): P2 and P1 may use it, P3 may not.
  const chosen = make(P2);
  chosen.engine.perform({ type: "activateAbility", playerId: P2, cardId: chosen.engine.state.players[P1]!.factionId!, abilityId: abilityOf(chosen.engine) });
  settle(chosen);
  const other = make(P3);
  refused(() => other.engine.perform({ type: "activateAbility", playerId: P3, cardId: other.engine.state.players[P1]!.factionId!, abilityId: abilityOf(other.engine) }), "P3 is not the chosen opponent");
});

// =====================================================================================
// Slightly Less Evil Alliance
// =====================================================================================

clause(SLEA, "3:ability", "3 seats: TEAMWORK pays 2, picks a card the controller controls and chooses another player (P2 or P3, never the controller); only that player takes control of the card", () => {
  for (const chosen of [P2, P3] as const) {
    const t = table(3, [{ key: "gift", def: character({ name: "Gift" }), owner: P1 }, ...staples("rage", 2)], { factions: { [P1]: printing(SLEA) } });
    const faction = t.engine.state.players[P1]!.factionId!;
    const action = { type: "activateAbility", playerId: P1, cardId: faction, abilityId: "slea-teamwork" } as const;
    const needs = t.engine.getPlayRequirements(action);
    assert.deepEqual(needs[0], { kind: "players", choices: [{ id: "player", candidates: [P2, P3] }] }, "the player choice is listed first and offers only the other players");
    refused(() => t.engine.perform({ ...action, selected: { card: [t.id("gift")] }, players: { player: P1 } }), "the controller as the other player");
    t.engine.perform({ ...action, selected: { card: [t.id("gift")] }, players: { player: chosen } });
    settle(t);
    assert.equal(controllerOf(t, "gift"), chosen, `${chosen} takes control of the card`);
    assert.equal(t.engine.getAvailableResourceCount(P1), 0, "2 resources were paid");
    void answer;
  }
});
