import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFactionGame } from "../../engine.js";
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
import { chooseDevelopOption, settleTurnStart } from "./support/develop.js";

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
  return createFactionGame(
    [FACTION, RAGE, FILLER],
    [{ id: P1, name: "Alice", factionDefinitionId: FACTION.id, deckDefinitionIds: deckOf(10) },
    { id: P2, name: "Bob", factionDefinitionId: FACTION.id, deckDefinitionIds: deckOf(10) }],
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
    assert.ok(!engine.state.players[P1].hand.includes(mulliganed[0]), "!engine.state.players[P1].hand.includes(mulliganed[0])");

    // It is now P2's decision.
    assert.equal((engine.state.setup as { order: string[] }).order[1], P2);

    engine.perform({ type: "mulligan", playerId: P2, cardIds: [] });

    // Both players have mulliganed; setup completes and turn 1 begins.
    assert.equal(engine.state.setup.phase, "complete");
    assert.equal(engine.state.started, true);
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

describe("RULES.md §6 — the develop rule (a start-of-turn trigger)", () => {
  function startedGame() {
    const engine = newFactionGame();
    engine.perform({ type: "mulligan", playerId: P1, cardIds: [] });
    engine.perform({ type: "mulligan", playerId: P2, cardIds: [] });
    return engine;
  }

  /** Orders the faction's two triggers (Restore first) so the Develop Rule's option prompt is the one pending. */
  function orderRestoreFirst(engine: ReturnType<typeof startedGame>, playerId: string) {
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "orderTriggers");
    const next = (pending as { triggers: Array<{ sourceId: string; abilityId: string }> }).triggers.find(
      trigger => trigger.abilityId === "restoreRule"
    )!;
    engine.perform({ type: "resolvePendingChoice", playerId, choice: { kind: "orderTriggers", next } });
  }

  test("choosing 'draw' adds a card to hand, and the rule is not offered again that turn", () => {
    const engine = startedGame();

    const before = engine.state.players[P1].hand.length;
    settleTurnStart(engine, "draw");

    assert.equal(engine.state.players[P1].hand.length, before + 1);
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(engine.state.priorityPlayerId, P1);
  });

  test("choosing 'play a resource' plays the chosen hand card as a resource", () => {
    const engine = startedGame();

    const fillerInHand = engine.state.players[P1].hand.find(
      id => engine.getDefinition(id).name === "Filler"
    )!;

    orderRestoreFirst(engine, P1);
    chooseDevelopOption(engine, P1, "Play a resource");
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "chooserSelectsTarget", selected: [fillerInHand], faceDown: true }
    });

    assert.equal(engine.state.cards[fillerInHand].zone, "play");
    assert.equal(engine.state.cards[fillerInHand].faceDown, true);
    assert.equal(engine.state.pendingChoice, undefined);
  });

  test("CR §602/§603 — normal turn actions do not require the develop rule first", () => {
    const engine = startedGame();

    // The Develop Rule cannot be skipped, but taking its draw is all it needs — ending the turn is legal without
    // playing a resource or doing anything else first.
    const before = engine.state.players[P1].hand.length;
    settleTurnStart(engine, "draw");
    assert.equal(engine.state.players[P1].hand.length, before + 1);
    assert.doesNotThrow(() => engine.perform({ type: "endTurn", playerId: P1 }));
  });

  test("the develop rule is used at most once per turn", () => {
    const engine = startedGame();

    const before = engine.state.players[P1].hand.length;
    settleTurnStart(engine, "draw");

    // Nothing offers it a second time, and no action does it on demand any more.
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(engine.state.players[P1].hand.length, before + 1);
    assert.throws(() =>
      engine.perform({
        type: "resolvePendingChoice",
        playerId: P1,
        choice: { kind: "chooserSelectsOption", index: 0 }
      })
    );
  });

  test("it is taken at the start of the turn: nothing else can be done until it is settled", () => {
    const engine = startedGame();

    assert.equal(engine.state.pendingChoice?.kind, "orderTriggers");
    assert.throws(() => engine.perform({ type: "endTurn", playerId: P1 }));

    settleTurnStart(engine, "draw");
    assert.equal(engine.state.pendingChoice, undefined);
    assert.doesNotThrow(() => engine.perform({ type: "endTurn", playerId: P1 }));
  });

  test("the rule is offered again on the next turn", () => {
    const { engine } = buildGame({ cards: [{ key: "top", def: FILLER, owner: P2, zone: "deck" }] });

    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);

    assert.equal(engine.state.activePlayerId, P2);
    assert.equal(engine.state.pendingChoice?.kind, "orderTriggers");

    const before = engine.state.players[P2].hand.length;
    settleTurnStart(engine, "draw");
    assert.equal(engine.state.players[P2].hand.length, before + 1);
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
    settleTurnStart(engine);

    // P2's turn is the next one at a two-player table; seats between P1 and P2 take (and end) turns first.
    assert.equal(engine.state.turn, 1 + ((engine.state.turnOrder.indexOf(P2) - engine.state.turnOrder.indexOf(P1) + engine.state.turnOrder.length) % engine.state.turnOrder.length));
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
    // (P2's turn is turn 2 at a two-player table; seats between P1 and P2 take turns first)
    assert.equal(engine.state.cards[id("p2Character")].attackEligibleTurn, engine.state.turn);
    assert.equal(engine.state.activePlayerId, P2);
    // ...and P1's is cleared, since it isn't P1's turn.
    assert.equal(engine.state.cards[id("p1Character")].attackEligibleTurn, undefined);
  });
});
