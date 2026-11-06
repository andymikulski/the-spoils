// Batch r13-multiplayer (docs/TESTING.md): the printed Multi-Player Guidelines,
// MP 1-MP 5 (docs/rules/multiplayer-guidelines.md). Written from the wording of
// the rules, not from the engine; docs/MULTIPLAYER-PLAN.md D4 says how the
// engine binds "your opponent". Synthetic fixtures only.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { SpoilsEngine } from "../../../engine.js";
import { createFactionGame, isLiving, opponentsOf } from "../../../engine.js";
import {
  buildGame,
  character,
  defaultFactionDefinition,
  factionCard,
  noDevelopFaction,
  resolvePendingResponses,
  resourceCard
} from "../support/fixtures.js";
import { refused, rule, ruleExempt } from "./_rule.js";

const seats = (...ids: string[]) => ids.map(id => ({ id, faction: noDevelopFaction() }));
const THREE = seats("p1", "p2", "p3");
const FOUR = seats("p1", "p2", "p3", "p4");

const influenceOf = (engine: SpoilsEngine): Record<string, number> =>
  Object.fromEntries(Object.values(engine.state.players).map(p => [p.id, p.influence]));

/** "You gain 3 influence and your opponent loses 2 influence." */
const SWAP = character({
  name: "Swapper",
  behavior: {
    abilities: [
      {
        id: "swap",
        type: "activated",
        costs: [],
        effects: [
          { type: "modifyInfluence", player: "controller", amount: 3 },
          { type: "modifyInfluence", player: "opponent", amount: -2 }
        ]
      }
    ]
  }
});

/** "You lose 1 influence, your opponent loses 1, then you lose 1 more and your opponent loses 2 more." */
const BOTH_NOW = character({
  name: "Both Now",
  behavior: {
    abilities: [
      {
        id: "both",
        type: "activated",
        costs: [],
        effects: [
          { type: "modifyInfluence", player: "controller", amount: -1 },
          { type: "modifyInfluence", player: "opponent", amount: -1 },
          { type: "modifyInfluence", player: "controller", amount: -1 },
          { type: "modifyInfluence", player: "opponent", amount: -2 }
        ]
      }
    ]
  }
});

/** "At the end of your turn, you and your opponent each lose 1 influence" (nothing in the event ties to an opponent). */
const BOTH_AT_END = character({
  name: "Both At End",
  behavior: {
    abilities: [
      {
        id: "both",
        type: "triggered",
        event: "turnEnding",
        condition: { type: "eventPlayerIs", player: "controller" },
        effects: [
          { type: "modifyInfluence", player: "controller", amount: -1 },
          { type: "modifyInfluence", player: "opponent", amount: -1 }
        ]
      }
    ]
  }
});

/** "At the end of your turn, your opponent loses 1 influence." */
const TOLL = character({
  name: "Toll",
  behavior: {
    abilities: [
      {
        id: "toll",
        type: "triggered",
        event: "turnEnding",
        condition: { type: "eventPlayerIs", player: "controller" },
        effects: [{ type: "modifyInfluence", player: "opponent", amount: -1 }]
      }
    ]
  }
});

/** "Your opponent loses 1 influence." */
const DRAIN = character({
  name: "Drainer",
  behavior: { abilities: [{ id: "drain", type: "activated", costs: [], effects: [{ type: "modifyInfluence", player: "opponent", amount: -1 }] }] }
});

function activate(engine: SpoilsEngine, cardId: string, abilityId: string, opponentId?: string): void {
  engine.perform({ type: "activateAbility", playerId: "p1", cardId, abilityId, ...(opponentId ? { opponentId } : {}) });
  resolvePendingResponses(engine);
}

/**
 * Answers every "which opponent?" prompt with `picks` in order, letting responses close in between.
 * A prompt to order simultaneous triggers (the effects are identical, so any order) is answered first-come.
 */
function answerOpponentPrompts(engine: SpoilsEngine, picks: string[]): void {
  const remaining = [...picks];
  resolvePendingResponses(engine);
  for (let guard = 0; guard < 20 && engine.state.pendingChoice; guard++) {
    const pending = engine.state.pendingChoice;
    if (pending.kind === "orderTriggers") {
      engine.perform({ type: "resolvePendingChoice", playerId: pending.playerId, choice: { kind: "orderTriggers", next: pending.triggers[0] } });
    } else {
      assert.equal(pending.kind, "chooseOpponent", "the only other prompt is which opponent");
      const opponentId = remaining.shift();
      assert.ok(opponentId, "more prompts than selections made");
      engine.perform({ type: "resolvePendingChoice", playerId: pending.playerId, choice: { kind: "chooseOpponent", opponentId } });
    }
    resolvePendingResponses(engine);
  }
  assert.deepEqual(remaining, [], "every selection was asked for");
  assert.equal(engine.state.pendingChoice, undefined, "no prompt is left");
}

/** Ends the active player's turn and lets every response window close. */
function passTurn(engine: SpoilsEngine): void {
  engine.perform({ type: "endTurn", playerId: engine.state.activePlayerId });
  resolvePendingResponses(engine);
}

describe("MP 1 - three or more players", () => {
  rule("MP 1", "a game can be played with three players, each seat holding its own faction", () => {
    const { engine } = buildGame({ players: THREE });
    assert.deepEqual(Object.keys(engine.state.players).sort(), ["p1", "p2", "p3"]);
    assert.deepEqual(engine.state.turnOrder, ["p1", "p2", "p3"]);
    for (const seat of THREE) {
      const factions = Object.values(engine.state.cards).filter(c => c.ownerId === seat.id && c.zone === "play");
      assert.equal(factions.length, 1, `${seat.id} has its faction in play`);
    }
  });

  rule("MP 1", "a game can be played with more than three players, and the turn passes through every seat", () => {
    const { engine } = buildGame({ players: FOUR });
    assert.deepEqual(engine.state.turnOrder, ["p1", "p2", "p3", "p4"]);
    const actives: string[] = [];
    for (let i = 0; i < 5; i++) {
      actives.push(engine.state.activePlayerId);
      passTurn(engine);
    }
    assert.deepEqual(actives, ["p1", "p2", "p3", "p4", "p1"]);
  });

  rule("MP 1", "a setup-built three-player game gives every seat its faction's influence and an opening hand (control: two players still work)", () => {
    const rage = resourceCard({ name: "Rage", resource: { provides: ["rage"] } });
    const filler = character({ name: "Filler", life: 2 });
    const faction = factionCard({
      name: "Testers",
      faction: defaultFactionDefinition({
        startingInfluence: 10,
        setup: { startingResources: { count: 2, names: ["Rage"] }, openingHand: { goingFirst: 3, goingSecond: 4 } }
      })
    });
    const deck = [rage.id, rage.id, ...Array.from({ length: 10 }, () => filler.id)];
    const build = (ids: string[]) =>
      createFactionGame(
        [faction, rage, filler],
        ids.map(id => ({ id, name: id, factionDefinitionId: faction.id, deckDefinitionIds: deck })),
        { firstPlayerId: "p1", seed: 5 }
      );
    const three = build(["p1", "p2", "p3"]);
    for (const id of ["p1", "p2", "p3"]) {
      assert.equal(three.state.players[id].influence, 10, `${id} starts with its faction's influence`);
      assert.equal(three.state.players[id].hand.length, id === "p1" ? 3 : 4, `${id} drew its opening hand`);
    }
    assert.deepEqual(Object.keys(build(["p1", "p2"]).state.players).sort(), ["p1", "p2"]);
  });

  rule("MP 1", "play continues when one of three players is out of the game: the other two carry on", () => {
    const { engine, id } = buildGame({ players: THREE, cards: [{ key: "s", def: SWAP, owner: "p1" }] });
    engine.state.players.p3.influence = 1;
    activate(engine, id("s"), "swap", "p3");
    passTurn(engine);
    assert.equal(isLiving(engine.state, "p3"), false, "p3's faction ran out of influence");
    assert.equal(engine.state.result, undefined, "two players remain, so the game is not over");
    assert.equal(engine.state.activePlayerId, "p2", "the next turn still goes to the next player");
  });
});

describe("MP 2 - select one of the other players as your opponent", () => {
  rule("MP 2", "a card that refers to 'your opponent' asks which of the other players: every other player is on offer, never yourself", () => {
    const { engine, id } = buildGame({ players: THREE, cards: [{ key: "s", def: SWAP, owner: "p1" }] });
    const action = { type: "activateAbility", playerId: "p1", cardId: id("s"), abilityId: "swap" } as const;
    assert.deepEqual(engine.getPlayRequirements(action)[0], { kind: "opponent", candidates: ["p2", "p3"] });
    assert.deepEqual(opponentsOf(engine.state, "p1"), ["p2", "p3"]);
    refused(() => engine.perform(action), "the opponent has not been selected", /Choose which opponent/);
  });

  rule("MP 2", "with four players all three others can be selected", () => {
    const { engine, id } = buildGame({ players: FOUR, cards: [{ key: "s", def: SWAP, owner: "p1" }] });
    const requirements = engine.getPlayRequirements({ type: "activateAbility", playerId: "p1", cardId: id("s"), abilityId: "swap" });
    assert.deepEqual(requirements[0], { kind: "opponent", candidates: ["p2", "p3", "p4"] });
  });

  rule("MP 2", "whichever other player is selected is the opponent: the card affects that player and no other", () => {
    for (const chosen of ["p2", "p3"]) {
      const { engine, id } = buildGame({ players: THREE, cards: [{ key: "s", def: SWAP, owner: "p1" }] });
      const before = influenceOf(engine);
      activate(engine, id("s"), "swap", chosen);
      const after = influenceOf(engine);
      const bystander = chosen === "p2" ? "p3" : "p2";
      assert.equal(after[chosen], before[chosen] - 2, `${chosen} lost 2`);
      assert.equal(after[bystander], before[bystander], `${bystander} was not an opponent for this text`);
    }
  });

  rule("MP 2", "you cannot select yourself as your opponent", () => {
    const { engine, id } = buildGame({ players: THREE, cards: [{ key: "s", def: SWAP, owner: "p1" }] });
    const before = influenceOf(engine);
    refused(() => activate(engine, id("s"), "swap", "p1"), "p1 named itself", /not one of your opponents/);
    assert.deepEqual(influenceOf(engine), before, "nothing happened");
    activate(engine, id("s"), "swap", "p2");
    assert.equal(influenceOf(engine).p2, before.p2 - 2, "control: naming another player works");
  });

  rule("MP 2", "a triggered text that refers to 'your opponent' asks its controller which of the other players, and applies the answer", () => {
    const { engine } = buildGame({ players: THREE, cards: [{ key: "t", def: TOLL, owner: "p1" }] });
    const before = influenceOf(engine);
    engine.perform({ type: "endTurn", playerId: "p1" });
    resolvePendingResponses(engine);
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "chooseOpponent");
    assert.equal(pending.playerId, "p1", "the card's controller selects");
    assert.deepEqual(pending.candidates, ["p2", "p3"]);
    answerOpponentPrompts(engine, ["p3"]);
    assert.equal(influenceOf(engine).p3, before.p3 - 1);
    assert.equal(influenceOf(engine).p2, before.p2);
  });

  rule("MP 2", "in a two-player game the only other player is the opponent, with no selection to make", () => {
    const { engine, id } = buildGame({ cards: [{ key: "s", def: SWAP, owner: "p1" }] });
    const before = influenceOf(engine);
    assert.notEqual(
      engine.getPlayRequirements({ type: "activateAbility", playerId: "p1", cardId: id("s"), abilityId: "swap" })[0]?.kind,
      "opponent"
    );
    activate(engine, id("s"), "swap");
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(influenceOf(engine).p2, before.p2 - 2);
  });
});

describe("MP 3 - 'both players' means you and the selected opponent", () => {
  rule("MP 3", "a text that affects you and your opponent in one block hits you and the one opponent selected, not the third player", () => {
    const { engine, id } = buildGame({ players: THREE, cards: [{ key: "s", def: SWAP, owner: "p1" }] });
    const before = influenceOf(engine);
    activate(engine, id("s"), "swap", "p3");
    const after = influenceOf(engine);
    assert.equal(after.p1, before.p1 + 3, "you are one of 'both players'");
    assert.equal(after.p3, before.p3 - 2, "the selected opponent is the other");
    assert.equal(after.p2, before.p2, "the player not selected is not among 'both players'");
  });

  rule("MP 3", "the same selection applies to every mention in the block: all of its opponent effects land on the one opponent", () => {
    const { engine, id } = buildGame({ players: FOUR, cards: [{ key: "b", def: BOTH_NOW, owner: "p1" }] });
    const before = influenceOf(engine);
    activate(engine, id("b"), "both", "p2");
    const after = influenceOf(engine);
    assert.equal(after.p1, before.p1 - 2, "you lose 1 and 1");
    assert.equal(after.p2, before.p2 - 3, "one opponent takes both losses");
    assert.equal(after.p3, before.p3);
    assert.equal(after.p4, before.p4);
  });

  rule("MP 3", "a triggered text that names both players asks for the selection once and applies it to both mentions", () => {
    const { engine } = buildGame({ players: THREE, cards: [{ key: "b", def: BOTH_AT_END, owner: "p1" }] });
    const before = influenceOf(engine);
    engine.perform({ type: "endTurn", playerId: "p1" });
    answerOpponentPrompts(engine, ["p2"]);
    const after = influenceOf(engine);
    assert.equal(after.p1, before.p1 - 1, "you are one of both players");
    assert.equal(after.p2, before.p2 - 1, "the selected opponent is the other");
    assert.equal(after.p3, before.p3, "the third player is neither");
  });

  rule("MP 3", "in a two-player game 'both players' is simply you and the other player (control)", () => {
    const { engine, id } = buildGame({ cards: [{ key: "s", def: SWAP, owner: "p1" }] });
    const before = influenceOf(engine);
    activate(engine, id("s"), "swap");
    assert.equal(influenceOf(engine).p1, before.p1 + 3);
    assert.equal(influenceOf(engine).p2, before.p2 - 2);
  });
});

describe("MP 4 - the selected opponent is temporary", () => {
  rule("MP 4", "two activations of the same ability may name different opponents: each hits only the one named for it", () => {
    const { engine, id } = buildGame({ players: THREE, cards: [{ key: "s", def: SWAP, owner: "p1" }] });
    const before = influenceOf(engine);
    activate(engine, id("s"), "swap", "p2");
    const mid = influenceOf(engine);
    assert.equal(mid.p2, before.p2 - 2);
    assert.equal(mid.p3, before.p3, "p3 untouched by the first block");
    activate(engine, id("s"), "swap", "p3");
    const after = influenceOf(engine);
    assert.equal(after.p3, before.p3 - 2, "the second block named p3");
    assert.equal(after.p2, mid.p2, "p2 was not carried over to the second block");
    assert.equal(after.p1, before.p1 + 6);
  });

  rule("MP 4", "the earlier selection does not stick: naming nobody on the next activation is refused, not defaulted to the previous opponent", () => {
    const { engine, id } = buildGame({ players: THREE, cards: [{ key: "s", def: SWAP, owner: "p1" }] });
    activate(engine, id("s"), "swap", "p2");
    const before = influenceOf(engine);
    refused(() => activate(engine, id("s"), "swap"), "a new selection is needed", /Choose which opponent/);
    assert.deepEqual(influenceOf(engine), before);
    assert.deepEqual(
      engine.getPlayRequirements({ type: "activateAbility", playerId: "p1", cardId: id("s"), abilityId: "swap" })[0],
      { kind: "opponent", candidates: ["p2", "p3"] },
      "every opponent is offered again, including the one picked last time"
    );
  });

  rule("MP 4", "the same opponent may be selected again; the selection is simply made afresh each time", () => {
    const { engine, id } = buildGame({ players: THREE, cards: [{ key: "s", def: SWAP, owner: "p1" }] });
    const before = influenceOf(engine);
    activate(engine, id("s"), "swap", "p2");
    activate(engine, id("s"), "swap", "p2");
    assert.equal(influenceOf(engine).p2, before.p2 - 4);
    assert.equal(influenceOf(engine).p3, before.p3);
  });

  rule("MP 4", "different cards select independently: each block of rules text has its own opponent", () => {
    const { engine, id } = buildGame({
      players: THREE,
      cards: [
        { key: "s", def: SWAP, owner: "p1" },
        { key: "d", def: DRAIN, owner: "p1" }
      ]
    });
    const before = influenceOf(engine);
    activate(engine, id("s"), "swap", "p2");
    activate(engine, id("d"), "drain", "p3");
    const after = influenceOf(engine);
    assert.equal(after.p2, before.p2 - 2, "the first block's opponent");
    assert.equal(after.p3, before.p3 - 1, "the second block's opponent");
  });

  rule("MP 4", "a new selection is made each time one is needed: two triggered texts at once prompt separately and may name different opponents", () => {
    const twin = character({ name: "Both At End Twin", behavior: BOTH_AT_END.behavior });
    const { engine } = buildGame({
      players: THREE,
      cards: [
        { key: "t1", def: BOTH_AT_END, owner: "p1" },
        { key: "t2", def: twin, owner: "p1" }
      ]
    });
    const before = influenceOf(engine);
    engine.perform({ type: "endTurn", playerId: "p1" });
    answerOpponentPrompts(engine, ["p2", "p3"]);
    const after = influenceOf(engine);
    assert.equal(after.p2, before.p2 - 1, "one block named p2");
    assert.equal(after.p3, before.p3 - 1, "the other block named p3");
    assert.equal(after.p1, before.p1 - 2, "you are in both blocks");
  });

  rule("MP 4", "a selection is for the block it was made in: the same trigger on a later turn asks again and may name someone else", () => {
    const { engine } = buildGame({ players: THREE, cards: [{ key: "t", def: BOTH_AT_END, owner: "p1" }] });
    const before = influenceOf(engine);
    engine.perform({ type: "endTurn", playerId: "p1" });
    answerOpponentPrompts(engine, ["p2"]);
    // Pass the other seats' turns (the card only triggers on its controller's turn).
    for (let guard = 0; guard < 6 && engine.state.activePlayerId !== "p1"; guard++) passTurn(engine);
    assert.equal(engine.state.activePlayerId, "p1", "the turn came back around to p1");
    engine.perform({ type: "endTurn", playerId: "p1" });
    answerOpponentPrompts(engine, ["p3"]);
    const after = influenceOf(engine);
    assert.equal(after.p2, before.p2 - 1, "the first end of turn named p2");
    assert.equal(after.p3, before.p3 - 1, "the second named p3 instead");
  });
});

describe("MP 5 - house rules", () => {
  ruleExempt(
    "MP 5",
    "Non-normative encouragement: the insert only invites play groups to adopt house rules for combinations too powerful in multi-player. It states no game rule, and the engine deliberately exposes no house-rule hook (docs/house-rules-mods-design.md), so there is no behavior to assert."
  );
});
