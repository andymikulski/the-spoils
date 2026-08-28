import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTwoPlayerFactionGame } from "../../engine.js";
import {
  buildGame,
  character,
  defaultFactionDefinition,
  factionCard,
  P1,
  P2,
  resolvePendingResponses,
  resourceCard
} from "./support/fixtures.js";

const RAGE = resourceCard({ name: "Rage", resource: { provides: ["rage"] } });
const FILLER = character({ name: "Filler", life: 2 });

const FACTION = factionCard({
  name: "Testers",
  faction: defaultFactionDefinition({
    startingInfluence: 10,
    setup: {
      startingResources: { count: 2, names: ["Rage"] },
      openingHand: { goingFirst: 3, goingSecond: 4 },
      mulligan: { count: 1, mode: "replaceAny" }
    },
    turn: {
      restore: {
        detachResources: true,
        restoreNonResources: true
      },
      develop: {
        choices: [
          { type: "draw", count: 1 },
          { type: "playResource", count: 1 }
        ]
      }
    }
  })
});

function deckOf(count: number) {
  return [RAGE.id, RAGE.id, ...Array.from({ length: count - 2 }, () => FILLER.id)];
}

function newFactionGame() {
  return createTwoPlayerFactionGame(
    [FACTION, RAGE, FILLER],
    { id: P1, name: "Alice", factionDefinitionId: FACTION.id, deckDefinitionIds: deckOf(10) },
    { id: P2, name: "Bob", factionDefinitionId: FACTION.id, deckDefinitionIds: deckOf(10) },
    { firstPlayerId: P1 }
  );
}

describe("RULES.md §5 — setup", () => {
  test("starting influence, starting resources, and opening hand sizes come from the faction", () => {
    const engine = newFactionGame();

    assert.equal(engine.state.players[P1].influence, 10);
    assert.equal(engine.state.players[P2].influence, 10);

    // 2 starting resources for each player were found and moved into play.
    const p1Resources = engine.state.players[P1].play.filter(id =>
      engine.getDefinition(id).name === "Rage"
    );
    assert.equal(p1Resources.length, 2);

    // First player draws 3 (goingFirst), second draws 4 (goingSecond).
    assert.equal(engine.state.players[P1].hand.length, 3);
    assert.equal(engine.state.players[P2].hand.length, 4);
  });

  test("setup starts in the mulligan step when the faction offers one", () => {
    const engine = newFactionGame();

    assert.equal(engine.state.setup.phase, "mulligan");
    assert.equal(engine.state.started, false);
  });

  test("a replace-any mulligan swaps chosen cards for the same number of new ones, once per player", () => {
    const engine = newFactionGame();

    const p1HandBefore = [...engine.state.players[P1].hand];
    const mulliganed = [p1HandBefore[0]];

    engine.perform({ type: "mulligan", playerId: P1, cardIds: mulliganed });

    assert.equal(engine.state.players[P1].hand.length, 3);
    assert.ok(!engine.state.players[P1].hand.includes(mulliganed[0]));

    // It is now P2's decision.
    assert.equal((engine.state.setup as { order: string[] }).order[1], P2);

    engine.perform({ type: "mulligan", playerId: P2, cardIds: [] });

    // Both players have mulliganed; setup completes and turn 1 begins.
    assert.equal(engine.state.setup.phase, "complete");
    assert.equal(engine.state.started, true);
    assert.equal(engine.state.developedThisTurn, false);
    assert.equal(engine.state.activePlayerId, P1);
  });

  test("mulligan cannot happen again once setup is complete", () => {
    const engine = newFactionGame();

    engine.perform({ type: "mulligan", playerId: P1, cardIds: [] });
    engine.perform({ type: "mulligan", playerId: P2, cardIds: [] });

    assert.throws(() =>
      engine.perform({ type: "mulligan", playerId: P1, cardIds: [] })
    );
  });

  test("the mulligan records which cards each player bottomed", () => {
    const engine = newFactionGame();

    const bottomed = engine.state.players[P1].hand[0];

    engine.perform({ type: "mulligan", playerId: P1, cardIds: [bottomed] });
    engine.perform({ type: "mulligan", playerId: P2, cardIds: [] });

    // P1 set one card aside; P2 kept everything.
    assert.deepEqual(engine.state.mulligan[P1], [bottomed]);
    assert.equal(engine.state.mulligan[P2], undefined);

    // `bottomedInMulligan` (default target "source") reads it.
    assert.equal(
      engine.evaluateCondition(
        { type: "bottomedInMulligan" },
        { sourceId: bottomed, controllerId: P1, selected: {} }
      ),
      true
    );
    assert.equal(
      engine.evaluateCondition(
        { type: "bottomedInMulligan" },
        { sourceId: engine.state.players[P1].hand[0], controllerId: P1, selected: {} }
      ),
      false
    );
  });
});

describe("RULES.md §6 — the develop rule (optional, once per turn)", () => {
  function startedGame() {
    const engine = newFactionGame();
    engine.perform({ type: "mulligan", playerId: P1, cardIds: [] });
    engine.perform({ type: "mulligan", playerId: P2, cardIds: [] });
    return engine;
  }

  test("choosing 'draw' adds a card to hand and marks the rule used for the turn", () => {
    const engine = startedGame();

    const before = engine.state.players[P1].hand.length;
    engine.perform({ type: "chooseDevelop", playerId: P1, choice: { type: "draw" } });

    assert.equal(engine.state.players[P1].hand.length, before + 1);
    assert.equal(engine.state.developedThisTurn, true);
    assert.equal(engine.state.priorityPlayerId, P1);
  });

  test("choosing 'playResource' plays the named hand card(s) as resources", () => {
    const engine = startedGame();

    const fillerInHand = engine.state.players[P1].hand.find(
      id => engine.getDefinition(id).name === "Filler"
    )!;

    engine.perform({
      type: "chooseDevelop",
      playerId: P1,
      choice: { type: "playResource", cards: [{ cardId: fillerInHand, faceDown: true }] }
    });

    assert.equal(engine.state.cards[fillerInHand].zone, "play");
    assert.equal(engine.state.cards[fillerInHand].faceDown, true);
    assert.equal(engine.state.developedThisTurn, true);
  });

  test("CR §602/§603 — normal turn actions do not require the develop rule first", () => {
    const engine = startedGame();

    // No develop yet — ending the turn is still legal.
    assert.equal(engine.state.developedThisTurn, false);
    assert.doesNotThrow(() => engine.perform({ type: "endTurn", playerId: P1 }));
  });

  test("the develop rule can only be used once per turn", () => {
    const { engine } = buildGame({ cards: [] });

    engine.perform({ type: "chooseDevelop", playerId: P1, choice: { type: "draw" } });
    assert.throws(() =>
      engine.perform({ type: "chooseDevelop", playerId: P1, choice: { type: "draw" } })
    );
  });

  test("it can be used later in the turn, not only at the start", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "gadget", def: FILLER, owner: P1, zone: "hand" }]
    });

    // Take a normal action first...
    engine.perform({ type: "playCard", playerId: P1, cardId: id("gadget") });
    resolvePendingResponses(engine);

    // ...then develop.
    assert.ok(engine.canDevelopNow(P1));
    engine.perform({ type: "chooseDevelop", playerId: P1, choice: { type: "draw" } });
    assert.equal(engine.state.developedThisTurn, true);
  });

  test("the rule resets for the next turn", () => {
    const { engine } = buildGame({ cards: [] });

    engine.perform({ type: "chooseDevelop", playerId: P1, choice: { type: "draw" } });
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);

    assert.equal(engine.state.activePlayerId, P2);
    assert.equal(engine.state.developedThisTurn, false);
    assert.doesNotThrow(() =>
      engine.perform({ type: "chooseDevelop", playerId: P2, choice: { type: "draw" } })
    );
  });
});

describe("RULES.md §6 — start-of-turn restore", () => {
  test("ending a turn restores the next active player's board", () => {
    const { engine, id } = buildGame({
      activePlayerId: P1,
      cards: [
        {
          key: "p2Character",
          def: character({ name: "Bruiser", life: 5 }),
          owner: P2,
          damage: 3,
          depleted: true
        },
        { key: "p2Resource", def: resourceCard({ name: "Fuel" }), owner: P2 }
      ]
    });

    // Attach P2's resource to P2's faction, as a numeric-cost payment would.
    engine.state.cards[id("p2Resource")].attachedTo = engine.state.players[P2].factionId;

    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);

    assert.equal(engine.state.turn, 2);
    assert.equal(engine.state.activePlayerId, P2);

    assert.equal(engine.state.cards[id("p2Character")].damage, 0);
    assert.equal(engine.state.cards[id("p2Character")].depleted, false);
    assert.equal(engine.state.cards[id("p2Resource")].attachedTo, undefined);
  });

  test("CR §602.1a — character damage clears at the start of a turn regardless of the faction's Restore Rule", () => {
    // A faction whose Restore Rule does nothing (no detach, no restore).
    const barrenFaction = factionCard({
      name: "Barren",
      faction: defaultFactionDefinition({
        turn: {
          restore: { detachResources: false, restoreNonResources: false },
          develop: { choices: [{ type: "draw", count: 1 }] }
        }
      })
    });

    const { engine, id } = buildGame({
      activePlayerId: P1,
      playerB: { faction: barrenFaction },
      cards: [
        {
          key: "p2Character",
          def: character({ name: "Wounded", life: 5 }),
          owner: P2,
          damage: 4,
          depleted: true
        }
      ]
    });

    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);

    assert.equal(engine.state.activePlayerId, P2);
    // Damage cleared (core rule)...
    assert.equal(engine.state.cards[id("p2Character")].damage, 0);
    // ...but the barren Restore Rule left the character depleted.
    assert.equal(engine.state.cards[id("p2Character")].depleted, true);
  });

  test("CR §602.1b / §610.1a — 'this turn' effects are still active when end-of-turn triggers resolve, and gone by the next start of turn", () => {
    // A card carrying its own "this turn" +5 strength buff and an
    // end-of-turn trigger that bumps influence only while the buff holds.
    const watcher = character({
      name: "Watcher",
      strength: 1,
      behavior: {
        abilities: [
          {
            id: "buff-self",
            type: "activated",
            effects: [
              {
                type: "createModifier",
                target: "source",
                stat: "strength",
                operation: "add",
                value: 5,
                duration: { type: "untilEndOfTurn" }
              }
            ]
          },
          {
            id: "eot-check",
            type: "triggered",
            event: "turnEnding",
            condition: {
              type: "numberCompare",
              left: { type: "stat", target: "source", stat: "strength" },
              operator: ">=",
              right: 5
            },
            effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      activePlayerId: P1,
      cards: [{ key: "watcher", def: watcher, owner: P1 }]
    });

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("watcher"), abilityId: "buff-self" });
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("watcher"), "strength"), 6);

    const before = engine.state.players[P1].influence;
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);

    // The end-of-turn trigger saw the buff still active.
    assert.equal(engine.state.players[P1].influence, before + 1);
    // And by the start of P2's turn, the "this turn" buff has ended.
    assert.equal(engine.getStat(id("watcher"), "strength"), 1);
  });

  test("attack eligibility resets to the new active player's settled board", () => {
    const { engine, id } = buildGame({
      activePlayerId: P1,
      cards: [
        { key: "p1Character", def: character({ name: "Settled P1" }), owner: P1 },
        { key: "p2Character", def: character({ name: "Settled P2" }), owner: P2 }
      ]
    });

    assert.equal(engine.state.cards[id("p1Character")].attackEligibleTurn, 1);

    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);

    // Turn passed to P2: P2's settled character becomes eligible this turn...
    assert.equal(engine.state.cards[id("p2Character")].attackEligibleTurn, 2);
    // ...and P1's is cleared, since it isn't P1's turn.
    assert.equal(engine.state.cards[id("p1Character")].attackEligibleTurn, undefined);
  });
});
