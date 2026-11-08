// Batch r11-general-loops-bidding, part 3 (docs/TESTING.md): CR 102.1 / 102.2,
// when influence losses count as "at the same time". Written from the wording
// of the Comprehensive Rules and the user's rulings (data/rule-tests/rulings.md,
// RQ-r11-2 and RQ-r11-4): a unit is one resolving card or ability's own
// effects, one triggered ability's own effects, or one batch of simultaneous
// battle damage; the game is decided by the first unit in which a faction
// reached 0, for everyone who reached 0 within it.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, SerializedGame, SpoilsEngine } from "../../../engine.js";
import { loadGame, saveGame } from "../../../engine.js";
import { buildGame, character, P1, P2, resolvePendingResponses, tactic } from "../support/fixtures.js";
import { rule } from "./_rule.js";

const ACTIVATED = (effects: unknown[]) =>
  ({ abilities: [{ id: "go", type: "activated", effects }] }) as CardDefinition["behavior"];

const loses = (player: "controller" | "opponent", amount: number) => ({ type: "modifyInfluence" as const, player, amount: -amount });

/** Plays the tactic `key` for P1 and lets every response window close. */
function play(engine: SpoilsEngine, id: (key: string) => string, key: string): void {
  engine.perform({ type: "playCard", playerId: P1, cardId: id(key) });
  resolvePendingResponses(engine);
}

/** A tactic whose one ability runs `effects` in order. */
const spell = (name: string, effects: unknown[]) => tactic({ name, behavior: ACTIVATED(effects) });

/** Attacks P2's faction with `attackerKey`, no blockers, and assigns every damage source's full strength to the faction. */
function attackFaction(engine: SpoilsEngine, id: (key: string) => string, attackerKey: string): void {
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id(attackerKey)], target: { type: "faction", playerId: P2 } });
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  for (let guard = 0; engine.state.battle && guard < 50; guard++) {
    if (engine.state.responseWindow) {
      resolvePendingResponses(engine);
      continue;
    }
    const view = engine.getBattleView();
    if (view?.actingPlayerId) {
      engine.perform({
        type: "assignBattleDamage",
        playerId: view.actingPlayerId,
        assignments: view.damageSources
          .filter(s => s.strength > 0 && s.legalTargets.length > 0)
          .map(s => ({ sourceId: s.cardId, target: s.legalTargets[0]!, amount: s.strength }))
      });
    } else {
      engine.perform({ type: "advanceFlow" });
    }
  }
  assert.equal(engine.state.battle, undefined, "the battle ran to its end");
}

describe("CR 102.2 — the unit of 'at the same time'", () => {
  rule("CR 102.2", "two consecutive influence effects of one ability that take both factions to 0 end the game in a draw", () => {
    const { engine, id } = buildGame({
      playerA: { influence: 3 },
      playerB: { influence: 3 },
      cards: [{ key: "both", def: spell("Both Fall", [loses("controller", 3), loses("opponent", 3)]), owner: P1, zone: "hand" }]
    });
    play(engine, id, "both");
    assert.equal(engine.state.players[P1].influence, 0, "the controller's faction is at 0");
    assert.equal(engine.state.players[P2].influence, 0, "the opponent's faction is at 0");
    assert.equal(engine.state.winner, "draw", "both lost within one resolving ability: a draw, not a win for the player whose faction fell first");
  });

  rule("CR 102.2", "the order of the two effects does not matter: the opponent's faction first, then the controller's, is still a draw", () => {
    const { engine, id } = buildGame({
      playerA: { influence: 2 },
      playerB: { influence: 5 },
      cards: [{ key: "both", def: spell("Both Fall", [loses("opponent", 5), loses("controller", 2)]), owner: P1, zone: "hand" }]
    });
    play(engine, id, "both");
    assert.equal(engine.state.winner, "draw", "both factions are at 0 when the ability ends");
  });

  rule("CR 102.2", "forEachPlayer + modifyInfluence is one instruction: a draw whichever player is processed first", () => {
    const eachLoses = spell("Each Loses", [{ type: "forEachPlayer", effects: [loses("controller", 3)] }]);
    for (const active of [P1, P2] as const) {
      const { engine, id } = buildGame({
        activePlayerId: active,
        playerA: { influence: 3 },
        playerB: { influence: 3 },
        cards: [{ key: "each", def: eachLoses, owner: active, zone: "hand" }]
      });
      engine.perform({ type: "playCard", playerId: active, cardId: id("each") });
      resolvePendingResponses(engine);
      assert.equal(engine.state.players[P1].influence, 0, `P1 is at 0 (active player ${active})`);
      assert.equal(engine.state.players[P2].influence, 0, `P2 is at 0 (active player ${active})`);
      assert.equal(engine.state.winner, "draw", `both lost in one resolution (active player ${active})`);
    }
  });

  rule("CR 102.2", "control: an ability that takes only the opponent's faction to 0 (the controller's loss leaves them above 0) is a win for the controller", () => {
    const { engine, id } = buildGame({
      playerA: { influence: 4 },
      playerB: { influence: 3 },
      cards: [{ key: "hit", def: spell("Uneven", [loses("controller", 3), loses("opponent", 3)]), owner: P1, zone: "hand" }]
    });
    play(engine, id, "hit");
    assert.equal(engine.state.players[P1].influence, 1, "the controller's faction survives with 1");
    assert.equal(engine.state.players[P2].influence, 0, "the opponent's faction is at 0");
    assert.equal(engine.state.winner, P1, "a faction that reaches 0 from something that hits only it loses");
  });

  rule("CR 102.2", "control: an ability that takes only the controller's own faction to 0 loses the game for the controller", () => {
    const { engine, id } = buildGame({
      playerA: { influence: 3 },
      playerB: { influence: 7 },
      cards: [{ key: "self", def: spell("Self Harm", [loses("controller", 3)]), owner: P1, zone: "hand" }]
    });
    play(engine, id, "self");
    assert.equal(engine.state.winner, P2, "the opponent of the faction that hit 0 wins");
  });

  rule("CR 102.2", "control: the game goes on while the unit is unfinished and nobody is at 0 (an ability that takes both to 1)", () => {
    const { engine, id } = buildGame({
      playerA: { influence: 3 },
      playerB: { influence: 3 },
      cards: [{ key: "both", def: spell("Both Dip", [loses("controller", 2), loses("opponent", 2)]), owner: P1, zone: "hand" }]
    });
    play(engine, id, "both");
    assert.equal(engine.state.players[P1].influence, 1, "P1 is at 1");
    assert.equal(engine.state.players[P2].influence, 1, "P2 is at 1");
    assert.equal(engine.state.winner, undefined, "nobody is at 0, so nobody lost");
  });

  /** A character owned by P2 whose triggered ability runs `effects` whenever a faction's influence changes. */
  const onInfluenceChange = (name: string, effects: unknown[]) =>
    character({ name, behavior: { abilities: [{ id: "watch", type: "triggered", event: "influenceChanged", effects }] } as CardDefinition["behavior"] });

  rule("CR 102.2", "a triggered ability set off by the unit is its own later unit: the tactic takes P2 to 0 and the trigger takes P1 to 0, so P1 wins", () => {
    const { engine, id } = buildGame({
      playerA: { influence: 3 },
      playerB: { influence: 3 },
      cards: [
        { key: "hit", def: spell("Hit", [loses("opponent", 3)]), owner: P1, zone: "hand" },
        { key: "grudge", def: onInfluenceChange("Grudge", [loses("opponent", 3)]), owner: P2 }
      ]
    });
    play(engine, id, "hit");
    assert.equal(engine.state.players[P2].influence, 0, "the tactic took P2's faction to 0");
    assert.equal(engine.state.players[P1].influence, 0, "the trigger it set off did resolve and took P1's faction to 0");
    assert.equal(engine.state.winner, P1, "P2 reached 0 in the first unit, so the game was already over: the trigger's loss does not count");
  });

  rule("CR 102.2", "a trigger that runs between two effects of one ability does not split it: effect 1 takes P2 to 0, the trigger runs, effect 2 takes P1 to 0, a draw", () => {
    const watcher = character({
      name: "Watcher",
      behavior: { abilities: [{ id: "watch", type: "triggered", event: "influenceChanged", effects: [{ type: "addCounter", target: "source", counter: "seen", amount: 1 }] }] } as CardDefinition["behavior"]
    });
    const { engine, id } = buildGame({
      playerA: { influence: 3 },
      playerB: { influence: 3 },
      cards: [
        { key: "both", def: spell("Both", [loses("opponent", 3), loses("controller", 3)]), owner: P1, zone: "hand" },
        { key: "watcher", def: watcher, owner: P2 }
      ]
    });
    play(engine, id, "both");
    assert.ok((engine.state.cards[id("watcher")]!.counters.seen ?? 0) >= 1, "the trigger ran (while the ability was resolving)");
    assert.equal(engine.state.players[P1].influence, 0, "effect 2 took P1's faction to 0");
    assert.equal(engine.state.winner, "draw", "both factions reached 0 within the one ability's own effects");
  });

  rule("CR 102.2", "a trigger whose unit is the first in which anyone reached 0 decides the game: it takes P1 to 0 and P2 wins", () => {
    const refill = character({
      name: "Backfire",
      behavior: { abilities: [{ id: "backfire", type: "triggered", event: "cardsDrawn", effects: [loses("controller", 3)] }] } as CardDefinition["behavior"]
    });
    const { engine, id } = buildGame({
      playerA: { influence: 3 },
      playerB: { influence: 3 },
      cards: [
        { key: "draw", def: spell("Draw", [{ type: "draw", player: "controller", amount: 1 }]), owner: P1, zone: "hand" },
        { key: "backfire", def: refill, owner: P1 },
        { key: "top", def: character({ name: "Top" }), owner: P1, zone: "deck" }
      ]
    });
    play(engine, id, "draw");
    assert.equal(engine.state.players[P1].influence, 0, "the trigger took its own controller's faction to 0");
    assert.equal(engine.state.players[P2].influence, 3, "P2's faction was never touched");
    assert.equal(engine.state.winner, P2, "nobody had reached 0 before the trigger, so P1 loses alone");
  });

  rule("CR 102.2", "control: the same trigger in a game where the drawing ability is not played changes nothing (no 0, no winner)", () => {
    const { engine } = buildGame({
      playerA: { influence: 3 },
      playerB: { influence: 3 },
      cards: [{ key: "top", def: character({ name: "Top" }), owner: P1, zone: "deck" }]
    });
    assert.equal(engine.state.winner, undefined, "no winner without a loss");
  });

  rule("CR 102.2", "a triggered ability that resolves after the game has ended is its own instant: the result already reached stands", () => {
    // P2's character: "When the game ends, your opponent's faction loses 3 influence."
    const grudge = character({
      name: "Grudge",
      behavior: { abilities: [{ id: "grudge", type: "triggered", event: "gameEnded", effects: [loses("opponent", 3)] }] }
    });
    const finisher = spell("Finisher", [loses("opponent", 3)]);

    const withGrudge = buildGame({
      playerA: { influence: 3 },
      playerB: { influence: 3 },
      cards: [
        { key: "finisher", def: finisher, owner: P1, zone: "hand" },
        { key: "grudge", def: grudge, owner: P2 }
      ]
    });
    play(withGrudge.engine, withGrudge.id, "finisher");
    assert.equal(withGrudge.engine.state.players[P2].influence, 0, "the tactic took P2's faction to 0");
    assert.equal(withGrudge.engine.state.players[P1].influence, 0, "the later trigger did resolve and took P1's faction to 0 too");
    assert.equal(withGrudge.engine.state.winner, P1, "P2 had already lost alone; the later trigger does not turn it into a draw");

    // Positive control: the same two losses inside ONE ability are simultaneous.
    const together = buildGame({
      playerA: { influence: 3 },
      playerB: { influence: 3 },
      cards: [{ key: "both", def: spell("Both", [loses("opponent", 3), loses("controller", 3)]), owner: P1, zone: "hand" }]
    });
    play(together.engine, together.id, "both");
    assert.equal(together.engine.state.winner, "draw", "control: the same losses in one ability are a draw");

    // Control: without the trigger the game is simply won by P1.
    const without = buildGame({
      playerA: { influence: 3 },
      playerB: { influence: 3 },
      cards: [{ key: "finisher", def: finisher, owner: P1, zone: "hand" }]
    });
    play(without.engine, without.id, "finisher");
    assert.equal(without.engine.state.players[P1].influence, 3, "control: P1 is untouched without the trigger");
    assert.equal(without.engine.state.winner, P1, "control: P1 wins");
  });
});

describe("CR 102.2 — battle damage", () => {
  /**
   * Battle damage only ever lands on the attacked faction, so for both factions to take damage in one batch a
   * damage shield on the attacked faction sends part of the hit to the other faction (`preventDamage` in
   * `redirect` mode), the only way today's vocabulary lets one batch reach both.
   */
  const redirectToMine = (amount: number) =>
    spell("Reflect", [
      {
        type: "preventDamage",
        target: { type: "factionOf", player: "opponent" },
        amount,
        mode: "redirect",
        redirectTo: { type: "factionOf", player: "controller" }
      }
    ]);

  rule("CR 102.2", "one batch of battle damage that takes both factions to 0 (part of the hit redirected to the attacker's own faction) is a draw", () => {
    const { engine, id } = buildGame({
      playerA: { influence: 2 },
      playerB: { influence: 1 },
      cards: [
        { key: "reflect", def: redirectToMine(2), owner: P1, zone: "hand" },
        { key: "hitter", def: character({ name: "Hitter", strength: 3 }), owner: P1 }
      ]
    });
    play(engine, id, "reflect");
    assert.equal(engine.state.players[P1].influence, 2, "setting up the shield costs no influence");
    assert.equal(engine.state.winner, undefined, "no one has lost before the battle");
    attackFaction(engine, id, "hitter");
    assert.equal(engine.state.players[P2].influence, 0, "the defender's faction took the 1 that was not redirected");
    assert.equal(engine.state.players[P1].influence, 0, "the attacker's faction took the 2 that was redirected");
    assert.equal(engine.state.winner, "draw", "both factions took battle damage in the same batch and reached 0 together");
  });

  rule("CR 102.2", "control: the same battle with the attacker's faction left above 0 is a win for the attacker", () => {
    const { engine, id } = buildGame({
      playerA: { influence: 3 },
      playerB: { influence: 1 },
      cards: [
        { key: "reflect", def: redirectToMine(2), owner: P1, zone: "hand" },
        { key: "hitter", def: character({ name: "Hitter", strength: 3 }), owner: P1 }
      ]
    });
    play(engine, id, "reflect");
    attackFaction(engine, id, "hitter");
    assert.equal(engine.state.players[P1].influence, 1, "the attacker's faction took the redirected 2 and survives with 1");
    assert.equal(engine.state.players[P2].influence, 0, "the defender's faction is at 0");
    assert.equal(engine.state.winner, P1, "only the defender's faction reached 0");
  });

  rule("CR 102.2", "control: an ordinary unblocked attack that takes the defender's faction to 0 wins for the attacker", () => {
    const { engine, id } = buildGame({
      playerA: { influence: 2 },
      playerB: { influence: 3 },
      cards: [{ key: "hitter", def: character({ name: "Hitter", strength: 3 }), owner: P1 }]
    });
    attackFaction(engine, id, "hitter");
    assert.equal(engine.state.players[P2].influence, 0, "the defender's faction is at 0");
    assert.equal(engine.state.winner, P1, "the attacker wins");
  });
});

describe("CR 102.1 — a faction at 0 that is raised again before its unit ends", () => {
  rule(
    ["CR 102.1", "CR 102.2"],
    "a faction taken to 0 by one effect and raised above 0 by a later effect of the same ability loses (102.1 'at any time')",
    () => {
      const { engine, id } = buildGame({
        playerA: { influence: 3 },
        playerB: { influence: 5 },
        cards: [
          {
            key: "dip",
            def: spell("Dip", [loses("controller", 3), { type: "modifyInfluence", player: "controller", amount: 1 }]),
            owner: P1,
            zone: "hand"
          }
        ]
      });
      play(engine, id, "dip");
      assert.equal(engine.state.winner, P2, "the faction was at 0 for an instant inside the ability");
    }
  );

  rule(
    ["CR 102.1", "CR 102.2"],
    "a faction taken to 0 by one effect and raised above 0 by a triggered ability that the ability sets off loses (102.1 'at any time')",
    () => {
      const refill = character({
        name: "Refill",
        behavior: { abilities: [{ id: "refill", type: "triggered", event: "cardsDrawn", effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }] }
      });
      const { engine, id } = buildGame({
        playerA: { influence: 3 },
        playerB: { influence: 5 },
        cards: [
          { key: "dip", def: spell("Dip", [loses("controller", 3), { type: "draw", player: "controller", amount: 1 }]), owner: P1, zone: "hand" },
          { key: "refill", def: refill, owner: P1 },
          { key: "top", def: character({ name: "Top" }), owner: P1, zone: "deck" }
        ]
      });
      play(engine, id, "dip");
      assert.equal(engine.state.winner, P2, "the faction was at 0 before the trigger raised it");
    }
  );
});

describe("CR 102.2 — a resolution parked on a player choice", () => {
  /** "Opponent's faction loses 3, then you choose: your faction loses 3." The choice pauses the ability after the first loss. */
  const pausing = spell("Pause", [
    loses("opponent", 3),
    { type: "chooserSelectsOption", chooser: "controller", options: [{ label: "Pay", effects: [loses("controller", 3)] }] }
  ]);

  const answerChoice = (engine: SpoilsEngine) => {
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index: 0 } });
    resolvePendingResponses(engine);
  };

  const pausedGame = (p1Influence: number) => {
    const { engine, id } = buildGame({
      playerA: { influence: p1Influence },
      playerB: { influence: 3 },
      cards: [{ key: "pause", def: pausing, owner: P1, zone: "hand" }]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("pause") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsOption", "the ability is parked on its choice");
    assert.equal(engine.state.players[P2].influence, 0, "the opponent's faction is already at 0");
    assert.equal(engine.state.winner, undefined, "the resolution is not finished, so nobody has lost yet");
    return engine;
  };

  const restore = (engine: SpoilsEngine): SpoilsEngine => {
    const save: SerializedGame = JSON.parse(JSON.stringify(saveGame(engine)));
    return loadGame(save, Object.values(engine.definitions));
  };

  rule("CR 102.2", "saving and restoring while the ability waits on its choice does not change the outcome: both factions at 0 is still a draw", () => {
    const plain = pausedGame(3);
    answerChoice(plain);
    assert.equal(plain.state.winner, "draw", "control: without a save/restore both factions reach 0 together");

    const restored = restore(pausedGame(3));
    assert.equal(restored.state.pendingChoice?.kind, "chooserSelectsOption", "the restored game still waits on the choice");
    assert.equal(restored.state.winner, undefined, "the restored game has no winner yet");
    answerChoice(restored);
    assert.equal(restored.state.players[P1].influence, 0, "the controller's faction is at 0");
    assert.equal(restored.state.winner, "draw", "the restored game ends in the same draw");
    assert.equal(restored.state.pendingLoss, undefined, "nothing is left over once the game is decided");
  });

  rule("CR 102.2", "saving and restoring while the ability waits on its choice does not change the outcome: only the opponent at 0 is still a win", () => {
    const plain = pausedGame(4);
    answerChoice(plain);
    assert.equal(plain.state.winner, P1, "control: without a save/restore the controller wins");

    const restored = restore(pausedGame(4));
    answerChoice(restored);
    assert.equal(restored.state.players[P1].influence, 1, "the controller's faction survives with 1");
    assert.equal(restored.state.winner, P1, "the restored game ends with the same winner");
  });

  rule("CR 102.2", "a faction found at 0 before the pause is remembered across a save and restore: the restored game decides exactly as the unsaved one does", () => {
    const refill = spell("Pause And Refill", [
      loses("opponent", 3),
      { type: "chooserSelectsOption", chooser: "controller", options: [{ label: "Refill", effects: [{ type: "modifyInfluence", player: "opponent", amount: 1 }] }] }
    ]);
    const parked = () => {
      const { engine, id } = buildGame({
        playerA: { influence: 4 },
        playerB: { influence: 3 },
        cards: [{ key: "refill", def: refill, owner: P1, zone: "hand" }]
      });
      engine.perform({ type: "playCard", playerId: P1, cardId: id("refill") });
      resolvePendingResponses(engine);
      assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsOption", "the ability is parked on its choice");
      return engine;
    };
    const plain = parked();
    answerChoice(plain);
    const restored = restore(parked());
    answerChoice(restored);
    assert.equal(restored.state.players[P2].influence, 1, "the later effect raised the opponent's faction in both games");
    assert.equal(restored.state.winner, plain.state.winner, "the restored game reaches the same result as the unsaved one");
    assert.equal(plain.state.winner, P1, "control: the faction that was at 0 before the pause loses in the unsaved game");
  });

  rule("CR 102.2", "a triggered ability parked on its own choice after the tactic took P2 to 0: save and restore, answer, and P1 still wins (P1's loss in the trigger does not count)", () => {
    const grudge = character({
      name: "Grudge",
      behavior: {
        abilities: [
          {
            id: "grudge",
            type: "triggered",
            event: "influenceChanged",
            effects: [{ type: "chooserSelectsOption", chooser: "controller", options: [{ label: "Strike", effects: [loses("opponent", 3)] }] }]
          }
        ]
      } as CardDefinition["behavior"]
    });
    const parked = () => {
      const { engine, id } = buildGame({
        playerA: { influence: 3 },
        playerB: { influence: 3 },
        cards: [
          { key: "hit", def: spell("Hit", [loses("opponent", 3)]), owner: P1, zone: "hand" },
          { key: "grudge", def: grudge, owner: P2 }
        ]
      });
      engine.perform({ type: "playCard", playerId: P1, cardId: id("hit") });
      resolvePendingResponses(engine);
      assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsOption", "the trigger is parked on its choice");
      assert.equal(engine.state.winner, undefined, "the tactic's unit is not over");
      assert.deepEqual(engine.state.pendingLoss?.players, [P2], "P2 reached 0 in the tactic's unit");
      return engine;
    };
    const finish = (engine: SpoilsEngine) => {
      for (let guard = 0; engine.state.pendingChoice && guard < 10; guard++) {
        engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsOption", index: 0 } });
        resolvePendingResponses(engine);
      }
      assert.equal(engine.state.pendingChoice, undefined, "every choice was answered");
    };
    const plain = parked();
    finish(plain);
    assert.equal(plain.state.players[P1].influence, 0, "control: the trigger took P1's faction to 0");
    assert.equal(plain.state.winner, P1, "control: P1 wins without a save/restore");

    const restored = restore(parked());
    finish(restored);
    assert.equal(restored.state.players[P1].influence, 0, "the restored game's trigger took P1's faction to 0 too");
    assert.equal(restored.state.winner, P1, "the restored game decides the same way");
    assert.equal(restored.state.pendingLoss, undefined, "nothing is left over once the game is decided");
  });

  rule("CR 102.2", "the field that carries the pause is absent from a state with no resolution parked", () => {
    const { engine } = buildGame({});
    assert.equal("pendingLoss" in engine.state, false, "a fresh game has no such field");
    const paused = pausedGame(3);
    assert.deepEqual(paused.state.pendingLoss?.players, [P2], "while parked, it names the faction found at 0");
  });
});
