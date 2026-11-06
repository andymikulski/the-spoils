import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTwoPlayerFactionGame, type CardDefinition, type SpoilsEngine } from "../../engine.js";
import {
  character,
  defaultFactionDefinition,
  factionCard,
  P1,
  P2,
  resolvePendingResponses
} from "./support/fixtures.js";
import { chooseDevelopOption, settleTurnStart } from "./support/develop.js";

// The faction's Restore Rule and Develop Rule are ordinary "at the start of your turn" triggers (CR 202.7, 202.8,
// 602.2): queued with the turn's other `turnStarted` triggers as one batch, ordered by the turn's player.

const FILLER = character({ name: "Filler", life: 2 });

// "At the start of your turn, gain 1 influence."
const PAYDAY = character({
  name: "Payday",
  cost: 0,
  behavior: {
    abilities: [
      {
        id: "payday",
        type: "triggered",
        event: "turnStarted",
        condition: { type: "eventPlayerIs", player: "controller" },
        effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }]
      }
    ]
  }
});

// "At the start of your next turn, gain 5 influence." (used from play)
const TIMER = character({
  name: "Timer",
  cost: 0,
  behavior: {
    abilities: [
      {
        id: "arm",
        type: "activated",
        effects: [
          {
            type: "scheduleEffect",
            when: "startOfNextTurn",
            effects: [{ type: "modifyInfluence", player: "controller", amount: 5 }]
          }
        ]
      }
    ]
  }
});

type FactionRules = NonNullable<CardDefinition["faction"]>;

const factionOf = (
  name: string,
  turn: Partial<FactionRules["turn"]> = {},
  rest: Partial<FactionRules> = {}
): CardDefinition =>
  factionCard({
    name,
    faction: defaultFactionDefinition({
      startingInfluence: 10,
      turn: {
        restore: { detachResources: true, restoreNonResources: true },
        develop: { choices: [{ type: "draw", count: 1 }] },
        ...turn
      },
      ...rest
    })
  });

const FACTION = factionOf("Testers");

interface GameOptions {
  factionA?: CardDefinition;
  factionB?: CardDefinition;
  /** Cards in each deck; the opening hand is `hand` of them (no mulligan is configured, so turn 1 begins at once). */
  deck?: CardDefinition[];
  hand?: number;
}

function newGame(options: GameOptions = {}): SpoilsEngine {
  const deck = options.deck ?? Array.from({ length: 10 }, () => FILLER);
  const hand = options.hand ?? 3;
  const withSetup = (faction: CardDefinition): CardDefinition => ({
    ...faction,
    faction: {
      ...faction.faction!,
      setup: { startingResources: { count: 0 }, openingHand: { goingFirst: hand, goingSecond: hand } }
    }
  });
  const a = withSetup(options.factionA ?? FACTION);
  const b = withSetup(options.factionB ?? FACTION);
  const definitions = [a, b, ...new Map(deck.map(card => [card.id, card])).values()];
  return createTwoPlayerFactionGame(
    definitions,
    { id: P1, name: "Alice", factionDefinitionId: a.id, deckDefinitionIds: deck.map(card => card.id) },
    { id: P2, name: "Bob", factionDefinitionId: b.id, deckDefinitionIds: deck.map(card => card.id) },
    { firstPlayerId: P1, seed: 7 }
  );
}

/** The abilityIds of the triggers the turn's player is being asked to order. */
function offered(engine: SpoilsEngine): string[] {
  const pending = engine.state.pendingChoice;
  assert.equal(pending?.kind, "orderTriggers");
  return pending.kind === "orderTriggers" ? pending.triggers.map(trigger => trigger.abilityId).sort() : [];
}

/** Answers the ordering prompt with the trigger whose abilityId is `abilityId`. */
function order(engine: SpoilsEngine, playerId: string, abilityId: string): void {
  const pending = engine.state.pendingChoice;
  assert.equal(pending?.kind, "orderTriggers");
  if (pending?.kind !== "orderTriggers") return;
  const next = pending.triggers.find(trigger => trigger.abilityId === abilityId);
  assert.ok(next, `${abilityId} is not among the offered triggers`);
  engine.perform({ type: "resolvePendingChoice", playerId, choice: { kind: "orderTriggers", next } });
}

describe("the faction's Restore Rule and Develop Rule are start-of-turn triggers", () => {
  test("the game's first turn start gives the first player an ordering choice for both, on the faction card", () => {
    const engine = newGame();

    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "orderTriggers");
    assert.equal(pending?.playerId, P1);
    assert.deepEqual(offered(engine), ["developRule", "restoreRule"]);
    if (pending?.kind === "orderTriggers") {
      for (const trigger of pending.triggers) assert.equal(trigger.sourceId, engine.state.players[P1].factionId);
    }
    // The opponent is not asked anything.
    assert.throws(() =>
      engine.perform({
        type: "resolvePendingChoice",
        playerId: P2,
        choice: { kind: "orderTriggers", next: { sourceId: engine.state.players[P1].factionId!, abilityId: "restoreRule" } }
      })
    );
  });

  test("Develop first, then 'Draw 1 card': a card is drawn and Restore resolves without a further prompt", () => {
    const engine = newGame();
    const before = engine.state.players[P1].hand.length;

    order(engine, P1, "developRule");
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "chooserSelectsOption");
    assert.deepEqual(
      pending?.kind === "chooserSelectsOption" ? pending.options.map(option => option.label) : [],
      ["Draw 1 card"],
      "the Develop Rule offers only the faction's choices: there is no option to skip it"
    );

    chooseDevelopOption(engine, P1, "Draw 1 card");

    assert.equal(engine.state.players[P1].hand.length, before + 1);
    assert.equal(engine.state.pendingChoice, undefined, "the lone Restore trigger resolved on its own");
    assert.equal(engine.state.startingTurnFor, undefined, "the turn start is settled");
  });

  test("the Develop Rule cannot be skipped: its prompt stays open until a real choice (draw or play) is made", () => {
    const engine = newGame();
    const before = engine.state.players[P1].hand.length;

    order(engine, P1, "restoreRule");
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "chooserSelectsOption");
    const labels = pending?.kind === "chooserSelectsOption" ? pending.options.map(option => option.label ?? "") : [];
    assert.ok(labels.every(label => !/skip/i.test(label)), `no skip option is offered: ${labels.join(", ")}`);
    // There is no "none of these" answer either: an index past the offered options is refused and the prompt stays.
    assert.throws(() =>
      engine.perform({
        type: "resolvePendingChoice",
        playerId: P1,
        choice: { kind: "chooserSelectsOption", index: labels.length }
      })
    );
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsOption");
    assert.equal(engine.state.players[P1].hand.length, before);

    chooseDevelopOption(engine, P1, "Draw 1 card");
    assert.equal(engine.state.players[P1].hand.length, before + 1);
    assert.equal(engine.state.pendingChoice, undefined);
  });

  test("a card's own turnStarted trigger joins the batch, so it can be resolved between Restore and Develop", () => {
    const engine = newGame({ deck: [...Array.from({ length: 7 }, () => PAYDAY), ...Array.from({ length: 5 }, () => FILLER)], hand: 6 });
    settleTurnStart(engine);
    const payday = engine.state.players[P1].hand.find(cardId => engine.getDefinition(cardId).name === "Payday")!;
    engine.perform({ type: "playCard", playerId: P1, cardId: payday });
    resolvePendingResponses(engine);

    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);

    assert.equal(engine.state.activePlayerId, P1);
    assert.deepEqual(offered(engine), ["developRule", "payday", "restoreRule"]);

    const influence = engine.state.players[P1].influence;
    order(engine, P1, "restoreRule");
    assert.deepEqual(offered(engine), ["developRule", "payday"], "two left, so the choice is raised again");
    order(engine, P1, "payday");

    // The card's trigger resolved before the Develop Rule, which is now the lone trigger and offers its options.
    assert.equal(engine.state.players[P1].influence, influence + 1);
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsOption");
    chooseDevelopOption(engine, P1, "Draw 1 card");
    assert.equal(engine.state.pendingChoice, undefined);
  });

  test("ending the turn gives the opponent the same prompts; 'at the start of your next turn' waits for them", () => {
    const engine = newGame({ deck: [...Array.from({ length: 7 }, () => TIMER), ...Array.from({ length: 5 }, () => FILLER)], hand: 6 });
    settleTurnStart(engine);
    const timer = engine.state.players[P1].hand.find(cardId => engine.getDefinition(cardId).name === "Timer")!;
    engine.perform({ type: "playCard", playerId: P1, cardId: timer });
    resolvePendingResponses(engine);
    engine.perform({ type: "activateAbility", playerId: P1, cardId: timer, abilityId: "arm" });
    resolvePendingResponses(engine);
    const influence = engine.state.players[P1].influence;

    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);

    // P2's turn: the same two prompts, put to P2.
    assert.equal(engine.state.activePlayerId, P2);
    assert.equal(engine.state.pendingChoice?.playerId, P2);
    assert.deepEqual(offered(engine), ["developRule", "restoreRule"]);
    settleTurnStart(engine);
    assert.equal(engine.state.players[P1].influence, influence, "P1's scheduled effect is not for P2's turn");

    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);

    // P1's turn: the delayed effect has not fired while the prompts are open...
    assert.equal(engine.state.activePlayerId, P1);
    assert.deepEqual(offered(engine), ["developRule", "restoreRule"]);
    assert.equal(engine.state.players[P1].influence, influence);
    order(engine, P1, "restoreRule");
    assert.equal(engine.state.players[P1].influence, influence, "...nor while the Develop Rule's options are open");
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsOption");

    // ...and fires once they have settled.
    chooseDevelopOption(engine, P1, "Draw 1 card");
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(engine.state.players[P1].influence, influence + 5);
  });

  test("a faction whose Develop Rule has no choices queues no Develop trigger", () => {
    const noDevelop = factionOf("No Develop", { develop: { choices: [] } });
    const engine = newGame({ factionA: noDevelop });

    // Restore is the lone trigger: it resolved on its own and nothing else is asked.
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(engine.state.startingTurnFor, undefined);

    // With a second trigger in the batch (a printed start-of-turn effect) only that one is offered beside Restore.
    const withEffect = factionOf("No Develop, Bonus", {
      develop: { choices: [] },
      startOfTurnEffects: [{ type: "modifyInfluence", player: "controller", amount: 1 }]
    });
    assert.deepEqual(offered(newGame({ factionA: withEffect })), ["factionStartEffect:0", "restoreRule"]);
  });

  test("an opposing faction's suppressDevelop (Knitting Coalition) queues no Develop trigger either", () => {
    const knitting = factionOf("Knitting", {}, { overridesOpponent: { suppressDevelop: true } });
    const engine = newGame({ factionB: knitting });

    assert.equal(engine.state.pendingChoice, undefined, "P1 only has the Restore Rule to resolve");

    // The suppression is one-way: Knitting's own player still develops.
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    assert.equal(engine.state.activePlayerId, P2);
    assert.deepEqual(offered(engine), ["developRule", "restoreRule"]);
  });

  test("a faction's printed start-of-turn effect joins the batch: its discount applies only once its trigger resolves", () => {
    const imperial = factionOf("Imperial", {
      startOfTurnEffects: [{ type: "reduceNextCost", player: "controller", amount: 2, cardType: "character" }]
    });
    const engine = newGame({ factionA: imperial });

    assert.deepEqual(offered(engine), ["developRule", "factionStartEffect:0", "restoreRule"]);
    assert.equal(engine.state.costReductions.length, 0);

    order(engine, P1, "restoreRule");
    assert.equal(engine.state.costReductions.length, 0, "not yet");
    order(engine, P1, "factionStartEffect:0");
    assert.equal(engine.state.costReductions.length, 1, "the discount is in place before the Develop Rule is answered");

    chooseDevelopOption(engine, P1, "Draw 1 card");
    assert.equal(engine.state.pendingChoice, undefined);
  });
});
