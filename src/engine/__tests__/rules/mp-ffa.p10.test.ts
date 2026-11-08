// Multiplayer (free-for-all) rules, part 10: saving and loading at three and four seats, and the public queries.
// Atoms: data/rule-tests/source/multiplayer.txt (batch mp-ffa): MP 2, MP 4, MPX-select, MPX-lasting, MPX-seat,
// MPX-turn, MPX-elim, MPX-priority, MPX-respond, MPX-attack.
// Every numbered point is tested at 3 and at 4 seats.
//
// A save is the engine's whole state as plain data. Every test here saves a game in the middle of something that only
// exists at three or more seats (a player choice, a selected opponent, a record that keeps one, an elimination, a
// response window that has been passed by some players), loads it into a second engine and plays both games on with
// the same actions: the two states must stay identical after every action.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, GameAction, PlayerId, SpoilsEngine } from "../../../engine.js";
import { getSaveSummary, loadGame, saveGame } from "../../../engine.js";
import { buildGame, character, noDevelopFaction, P1, P2, P3, P4, resolvePendingResponses, resourceCard, tactic } from "../support/fixtures.js";
import { canonicalJson } from "../support/digest.js";
import { refused, rule } from "./_rule.js";
import { ACTIVATED, answerPlayer, board, intoPlay, pending, plainSeats, play, seatsFor, TABLES, type Table } from "./_mpTable.js";
import { playRandomGame, randomSetup, CATALOG, CARD_NAME_CATALOG } from "../support/driver.js";

/** A second engine loaded from a save of `engine`, as a server restoring the game would build it. */
function reload(engine: SpoilsEngine): SpoilsEngine {
  const save = JSON.parse(JSON.stringify(saveGame(engine)));
  return loadGame(save, Object.values(engine.definitions).filter(def => !def.id.startsWith("token-def_")));
}

/** The whole state of an engine as comparable plain data (key order and `undefined` properties do not matter). */
const plain = (engine: SpoilsEngine): unknown => JSON.parse(canonicalJson(engine.state));

function assertSame(a: SpoilsEngine, b: SpoilsEngine, what: string): void {
  assert.deepEqual(plain(b), plain(a), what);
}

/** Performs `action` on both games and requires them to end in the same state. */
function both(a: SpoilsEngine, b: SpoilsEngine, action: GameAction, what: string): void {
  a.perform(JSON.parse(JSON.stringify(action)) as GameAction);
  b.perform(JSON.parse(JSON.stringify(action)) as GameAction);
  assertSame(a, b, what);
}

/** Lets every response window close on both games, one pass at a time, requiring identical states throughout. */
function drainBoth(a: SpoilsEngine, b: SpoilsEngine, what: string): void {
  for (let guard = 0; a.state.responseWindow && !a.state.pendingChoice; guard++) {
    assert.ok(guard < 200, "the windows did not close");
    const window = a.state.responseWindow;
    both(
      a,
      b,
      window.phase === "acceptingResponses" ? { type: "passPriority", playerId: window.priorityPlayerId } : { type: "advanceFlow" },
      `${what}: after ${window.phase} ${window.priorityPlayerId}`
    );
  }
}

const answer = (playerId: PlayerId, chosen: PlayerId): GameAction => ({ type: "resolvePendingChoice", playerId, choice: { kind: "choosePlayer", playerId: chosen } });

const TRIGGERED = (ability: Record<string, unknown>) => ({ abilities: [{ id: "tr", type: "triggered", ...ability }] }) as CardDefinition["behavior"];
/** How much influence each seat has lost since `before`. */
const lossesSince = (engine: SpoilsEngine, before: Record<PlayerId, number>): Record<PlayerId, number> =>
  Object.fromEntries(Object.entries(before).map(([seat, was]) => [seat, was - engine.state.players[seat]!.influence]));
const influences = (engine: SpoilsEngine): Record<PlayerId, number> =>
  Object.fromEntries(Object.values(engine.state.players).map(player => [player.id, player.influence]));
const onlyLost = (seat: PlayerId, amount: number, seats: PlayerId[]): Record<PlayerId, number> =>
  Object.fromEntries(seats.map(other => [other, other === seat ? amount : 0]));

const lose = (who: PlayerId, amount: number) => ({ type: "modifyInfluence" as const, player: { type: "player" as const, id: who }, amount: -amount });

// ---------------------------------------------------------------------------
// A save taken while a player is choosing a player.
// ---------------------------------------------------------------------------

describe("MPX-select / MPX-lasting — a save taken in the middle of a player choice", () => {
  /** "Your opponent cannot draw cards." (continuous text): its controller selects when it enters play. */
  const WARDEN = {
    abilities: [{ id: "ward", type: "continuous", modifiers: [], drawModifiers: [{ player: "opponent", prevent: true }] }]
  } as CardDefinition["behavior"];
  const stopped = (engine: SpoilsEngine, seats: PlayerId[]): PlayerId[] =>
    seats.filter(seat => engine.getPlayerEffects(seat).some(effect => effect.kind === "drawModifier"));

  for (const count of TABLES) {
    rule(["MPX-lasting", "MPX-select"], `${count} seats: a card whose text names your opponent, saved while its controller selects, loads to the same prompt and ends the same way`, () => {
      const t = board(count, character({ name: "Warden", behavior: WARDEN }));
      t.engine.perform(play(t));
      resolvePendingResponses(t.engine);
      const prompt = pending(t)!;
      assert.equal(prompt.kind, "choosePlayer");
      const loaded = reload(t.engine);
      assertSame(t.engine, loaded, "the loaded game is the saved one");
      assert.deepEqual(loaded.state.pendingChoice, prompt, "the same prompt, for the same player, with the same candidates");
      assert.deepEqual(stopped(loaded, t.seats), [], "until it is selected the text applies to nobody");

      refused(() => loaded.perform(answer(P2, P3)), "a player who is not the chooser answering");
      refused(() => loaded.perform(answer(P1, P1)), "the controller choosing themselves");
      both(t.engine, loaded, answer(P1, P3), "after the selection");
      assert.deepEqual(loaded.state.cards[t.id("spell")]!.boundOpponents, { ward: P3 });
      assert.deepEqual(stopped(loaded, t.seats), [P3], "only the selected opponent is affected, in the loaded game too");

      const again = reload(loaded);
      assertSame(loaded, again, "a second save and load keeps the selection");
      assert.deepEqual(stopped(again, t.seats), [P3]);
    });

    rule(["MPX-select", "MP 2"], `${count} seats: a trigger's selection, saved while its controller is asked, loads to the same prompt and ends the same way`, () => {
      const watcher = character({
        name: "Watcher",
        strength: 0,
        behavior: TRIGGERED({
          event: "cardPlayed",
          condition: { type: "eventPlayerIs", player: "controller" },
          effects: [{ type: "modifyInfluence", player: "opponent", amount: -2 }]
        })
      });
      const t = board(count, watcher, [{ key: "idle", def: tactic({ name: "Idle" }), owner: P1, zone: "hand" }]);
      intoPlay(t);
      const before = influences(t.engine);
      t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("idle") });
      const prompt = pending(t)!;
      assert.equal(prompt.kind, "choosePlayer");
      const loaded = reload(t.engine);
      assertSame(t.engine, loaded, "the loaded game is the saved one");
      assert.deepEqual(loaded.state.pendingChoice, prompt);
      both(t.engine, loaded, answer(P1, P3), "after the selection");
      drainBoth(t.engine, loaded, "the trigger resolving");
      assert.deepEqual(lossesSince(loaded, before), onlyLost(P3, 2, t.seats), "only the selected opponent lost influence");
    });

    rule(["MPX-select"], `${count} seats: a replacement's selection, saved while its controller is asked, loads to the same prompt and ends the same way`, () => {
      const lucky = character({
        name: "Lucky",
        behavior: { abilities: [{ id: "luck", type: "replacement", replaces: { event: "destroy" }, effects: [{ type: "modifyInfluence", player: "opponent", amount: -2 }] }] } as CardDefinition["behavior"]
      });
      const kill = tactic({
        name: "Kill",
        behavior: ACTIVATED({ targets: [{ id: "t", selector: { type: "character", name: "Lucky" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] })
      });
      const t = board(count, kill, [{ key: "lucky", def: lucky, owner: P2 }]);
      const before = influences(t.engine);
      t.engine.perform(play(t, { selected: { t: [t.id("lucky")] } }));
      resolvePendingResponses(t.engine);
      const prompt = pending(t)!;
      assert.equal(prompt.kind, "choosePlayer");
      assert.equal(prompt.playerId, P2, "the replacement's controller selects");
      const loaded = reload(t.engine);
      assertSame(t.engine, loaded, "the loaded game is the saved one");
      assert.deepEqual(loaded.state.pendingChoice, prompt);
      both(t.engine, loaded, answer(P2, P1), "after the selection");
      drainBoth(t.engine, loaded, "the replaced destruction");
      assert.equal(loaded.state.cards[t.id("lucky")]!.zone, "play", "the destruction was replaced");
      assert.deepEqual(lossesSince(loaded, before), onlyLost(P1, 2, t.seats), "the selected player lost influence");
    });

    rule(["MPX-select"], `${count} seats: a player named at play and kept in a parked resolution survives a save and load`, () => {
      const parked = ACTIVATED({
        playerChoices: [{ id: "victim", from: "opponents" }],
        effects: [
          { type: "chooserSelectsOption", chooser: "controller", options: [{ label: "go", effects: [] }, { label: "stop", effects: [] }] },
          { type: "modifyInfluence", player: { type: "chosenPlayer", id: "victim" }, amount: -3 }
        ]
      });
      const t = board(count, tactic({ name: "Parked", behavior: parked }));
      const before = influences(t.engine);
      t.engine.perform(play(t, { players: { victim: P3 } }));
      resolvePendingResponses(t.engine);
      assert.equal(pending(t)?.kind, "chooserSelectsOption");
      const loaded = reload(t.engine);
      assertSame(t.engine, loaded, "the loaded game is the saved one");
      both(t.engine, loaded, { type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index: 0 } }, "after the option");
      drainBoth(t.engine, loaded, "the tactic resolving");
      assert.deepEqual(lossesSince(loaded, before), onlyLost(P3, 3, t.seats), "the named player, and only that player, lost influence");
    });
  }
});

// ---------------------------------------------------------------------------
// Records that keep the opponent a block selected, and bindings kept on a card.
// ---------------------------------------------------------------------------

describe("MPX-lasting — records that keep a selected opponent survive a save and load", () => {
  /** "Your opponent's faction loses 2 influence at the end of the turn." and "this turn, your opponent's characters get -1 strength". */
  const DELAYED = tactic({
    name: "Delayed",
    behavior: ACTIVATED({
      effects: [
        { type: "scheduleEffect", when: "endOfTurn", effects: [{ type: "modifyInfluence", player: "opponent", amount: -2 }] },
        { type: "createAreaModifier", selector: { type: "character", controller: "opponent" }, stat: "strength", operation: "add", value: 3, duration: "untilEndOfTurn" }
      ]
    })
  });

  for (const count of TABLES) {
    rule(["MPX-lasting", "MP 4"], `${count} seats: a delayed effect and an area modifier keep the opponent selected when they were made, through a save and load and the end of the turn`, () => {
      const t = board(count, DELAYED);
      const before = influences(t.engine);
      t.engine.perform(play(t, { players: { opponent: P3 } }));
      resolvePendingResponses(t.engine);
      assert.equal(t.engine.state.scheduledEffects[0]!.opponentId, P3, "the delayed effect holds the selection");
      assert.equal(t.engine.state.areaModifiers[0]!.opponentId, P3, "the area modifier holds the selection");

      const loaded = reload(t.engine);
      assertSame(t.engine, loaded, "the loaded game is the saved one");
      assert.equal(loaded.state.scheduledEffects[0]!.opponentId, P3);
      assert.equal(loaded.state.areaModifiers[0]!.opponentId, P3);
      const strength = (engine: SpoilsEngine, who: PlayerId) => engine.getStat(t.id(`c-${who}`), "strength");
      for (const seat of t.seats) {
        assert.equal(strength(loaded, seat), strength(t.engine, seat), `${seat}'s character reads the same in both games`);
        assert.equal(strength(loaded, seat), seat === P3 ? strength(loaded, P1) + 3 : strength(loaded, P1), `only the selected opponent's characters changed (${seat})`);
      }

      both(t.engine, loaded, { type: "endTurn", playerId: P1 }, "ending the turn");
      drainBoth(t.engine, loaded, "the end of the turn");
      assert.deepEqual(lossesSince(loaded, before), onlyLost(P3, 2, t.seats), "the delayed effect hit the selected opponent and nobody else");
    });

    rule(["MPX-lasting", "MPX-elim"], `${count} seats: when the selected opponent is eliminated, the record asks its creator again; the prompt survives a save and load`, () => {
      const finish = tactic({ name: "Finish", behavior: ACTIVATED({ effects: [lose(P3, 99)] }) });
      const t = board(count, DELAYED, [{ key: "finish", def: finish, owner: P1, zone: "hand" }]);
      const before = influences(t.engine);
      t.engine.perform(play(t, { players: { opponent: P3 } }));
      resolvePendingResponses(t.engine);
      t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("finish") });
      resolvePendingResponses(t.engine);
      assert.ok(t.engine.state.players[P3]!.eliminated, "P3 is out");
      if (count === 3) {
        assert.equal(pending(t), undefined, "one opponent left: the records move to them without asking");
        assert.equal(t.engine.state.scheduledEffects[0]!.opponentId, undefined);
        const loaded = reload(t.engine);
        assertSame(t.engine, loaded, "the loaded game is the saved one");
        both(t.engine, loaded, { type: "endTurn", playerId: P1 }, "ending the turn");
        drainBoth(t.engine, loaded, "the end of the turn");
        assert.equal(lossesSince(loaded, before)[P2], 2, "the only opponent left is hit");
      } else {
        const prompt = pending(t)!;
        assert.equal(prompt.kind, "choosePlayer");
        assert.equal(prompt.playerId, P1);
        assert.deepEqual((prompt as { candidates: string[] }).candidates, [P2, P4]);
        const loaded = reload(t.engine);
        assertSame(t.engine, loaded, "the loaded game is the saved one");
        assert.deepEqual(loaded.state.pendingChoice, prompt);
        both(t.engine, loaded, answer(P1, P4), "after choosing again");
        while (pending(t)) both(t.engine, loaded, answer(P1, P4), "after choosing again");
        both(t.engine, loaded, { type: "endTurn", playerId: P1 }, "ending the turn");
        drainBoth(t.engine, loaded, "the end of the turn");
        assert.equal(lossesSince(loaded, before)[P4], 2, "the newly selected opponent is hit");
        assert.equal(lossesSince(loaded, before)[P2], 0, "the other opponent is not");
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Seats, elimination and the order of play.
// ---------------------------------------------------------------------------

describe("MPX-seat / MPX-turn / MPX-elim — an eliminated player and the seat order survive a save and load", () => {
  /** A table where P1 can finish P2 and every seat has a few cards. */
  function eliminatedTable(count: number): Table {
    const finish = tactic({ name: "Finish", behavior: ACTIVATED({ effects: [lose(P2, 99)] }) });
    const t = board(count, finish, [
      { key: "hand-p2", def: tactic({ name: "Secret Of P2" }), owner: P2, zone: "hand" },
      { key: "deck-p2", def: tactic({ name: "Deck Of P2" }), owner: P2, zone: "deck" },
      { key: "down-p3", def: resourceCard({ name: "Down Of P3" }), owner: P3, zone: "play", faceDown: true }
    ]);
    t.engine.perform(play(t));
    resolvePendingResponses(t.engine);
    assert.ok(t.engine.state.players[P2]!.eliminated, "P2 is out");
    return t;
  }

  for (const count of TABLES) {
    rule(["MPX-elim", "MPX-seat"], `${count} seats: the loaded game knows who is out, keeps the seat order, and has the eliminated player's cards out of the game`, () => {
      const t = eliminatedTable(count);
      const loaded = reload(t.engine);
      assertSame(t.engine, loaded, "the loaded game is the saved one");
      assert.deepEqual(loaded.getSeats(), seatsFor(count), "the seat order");
      assert.equal(loaded.isEliminated(P2), true);
      assert.deepEqual(loaded.state.players[P2]!.eliminated, t.engine.state.players[P2]!.eliminated);
      assert.deepEqual(loaded.getOpponents(P1), seatsFor(count).filter(seat => seat !== P1 && seat !== P2));
      assert.deepEqual(loaded.getPlayersInSeatOrder(P3), seatsFor(count).filter(seat => seat !== P2).sort((x, y) => ((seatsFor(count).indexOf(x) - 2 + count) % count) - ((seatsFor(count).indexOf(y) - 2 + count) % count)));
      assert.equal(loaded.state.cards[t.id("hand-p2")]!.zone, "removed", "the eliminated player's hand left the game");
      assert.equal(loaded.state.cards[t.id("deck-p2")]!.zone, "removed", "and their deck");
      refused(() => loaded.perform({ type: "endTurn", playerId: P2 }), "an eliminated player acting");
    });

    rule(["MPX-turn", "MPX-seat", "MPX-endturn"], `${count} seats: turns pass in seat order past the eliminated seat in a loaded game exactly as in the original`, () => {
      const t = eliminatedTable(count);
      const loaded = reload(t.engine);
      const order: PlayerId[] = [];
      for (let turns = 0; turns < count + 2; turns++) {
        const active = t.engine.state.activePlayerId;
        order.push(active);
        both(t.engine, loaded, { type: "endTurn", playerId: active }, `${active} ends the turn`);
        drainBoth(t.engine, loaded, `the end of ${active}'s turn`);
        while (t.engine.state.pendingChoice) {
          const choice = t.engine.state.pendingChoice;
          assert.fail(`unexpected prompt ${choice.kind} for ${choice.playerId}`);
        }
      }
      const live = seatsFor(count).filter(seat => seat !== P2);
      assert.deepEqual(order, Array.from({ length: count + 2 }, (_, i) => live[i % live.length]), "P1, then the next seat still in the game, and so on around the table");
    });

    rule(["MPX-priority", "MPX-respond"], `${count} seats: the players who have passed on an item are still listed after a save and load, and the item resolves after the same passes`, () => {
      const gain = tactic({ name: "Gain", behavior: ACTIVATED({ effects: [{ type: "modifyInfluence", player: "controller", amount: 2 }] }) });
      const t = board(count, gain);
      const before = influences(t.engine);
      t.engine.perform(play(t));
      assert.equal(t.engine.state.responseWindow?.priorityPlayerId, P2, "the seat after the controller is offered it first");
      t.engine.perform({ type: "passPriority", playerId: P2 });
      assert.deepEqual(t.engine.state.responseWindow?.passed, [P2]);
      assert.equal(t.engine.state.responseWindow?.priorityPlayerId, P3);

      const loaded = reload(t.engine);
      assertSame(t.engine, loaded, "the loaded game is the saved one");
      assert.deepEqual(loaded.state.responseWindow?.passed, [P2], "who has passed");
      assert.equal(loaded.state.responseWindow?.priorityPlayerId, P3, "who is offered it now");
      assert.equal(loaded.getFlowView().actingPlayerId, P3);
      refused(() => loaded.perform({ type: "passPriority", playerId: P2 }), "a player who already passed acting again", /priority/i);

      const loadedAgain = reload(loaded);
      both(t.engine, loaded, { type: "passPriority", playerId: P3 }, "P3 passes");
      if (count === 4) {
        assert.deepEqual(loaded.state.responseWindow?.passed, [P2, P3]);
        assert.equal(loaded.state.responseWindow?.priorityPlayerId, P4);
        both(t.engine, loaded, { type: "passPriority", playerId: P4 }, "P4 passes");
      }
      assert.equal(loaded.state.responseWindow?.phase, "resolving", "every other player has passed in a row");
      drainBoth(t.engine, loaded, "the item resolving");
      assert.equal(lossesSince(loaded, before)[P1], -2);

      // The copy loaded before P3 passed is still waiting for P3 and ends the same way.
      assert.equal(loadedAgain.state.responseWindow?.priorityPlayerId, P3);
      loadedAgain.perform({ type: "passPriority", playerId: P3 });
      if (count === 4) loadedAgain.perform({ type: "passPriority", playerId: P4 });
      resolvePendingResponses(loadedAgain);
      assertSame(t.engine, loadedAgain, "the earlier save ends in the same state");
    });

    rule(["MPX-priority", "MPX-elim"], `${count} seats: an elimination inside a response window leaves the window the same in a loaded game`, () => {
      const finishP3 = tactic({ name: "Finish P3", behavior: ACTIVATED({ effects: [lose(P3, 99)] }) });
      const gain = tactic({ name: "Gain", behavior: ACTIVATED({ effects: [{ type: "modifyInfluence", player: "controller", amount: 2 }] }) });
      const t = board(count, gain, [{ key: "finish", def: finishP3, owner: P2, zone: "hand" }]);
      const before = influences(t.engine);
      t.engine.perform(play(t));
      t.engine.perform({ type: "playCard", playerId: P2, cardId: t.id("finish") });
      t.engine.perform({ type: "passPriority", playerId: P3 });
      if (count === 4) t.engine.perform({ type: "passPriority", playerId: P4 });
      t.engine.perform({ type: "passPriority", playerId: P1 });
      assert.equal(t.engine.state.responseWindow?.phase, "resolving", "the response is next to resolve");
      const loaded = reload(t.engine);
      assertSame(t.engine, loaded, "the loaded game is the saved one");
      drainBoth(t.engine, loaded, "both items resolving");
      assert.ok(loaded.state.players[P3]!.eliminated, "P3 was eliminated by the response");
      assert.equal(lossesSince(loaded, before)[P1], -2, "the first item still resolved");
      assert.equal(loaded.state.responseWindow, undefined);
    });
  }
});

describe("MPX-seat — the summary a database row is built from", () => {
  for (const count of TABLES) {
    rule(["MPX-seat", "MPX-elim"], `${count} seats: getSaveSummary lists every player and marks the ones who are out`, () => {
      const t = board(count, tactic({ name: "Finish", behavior: ACTIVATED({ effects: [lose(P2, 99)] }) }));
      const before = getSaveSummary(t.engine);
      assert.deepEqual(before.players.map(player => player.id), seatsFor(count));
      assert.ok(before.players.every(player => player.eliminated === undefined), "nobody is marked while everybody is in");
      t.engine.perform(play(t));
      resolvePendingResponses(t.engine);
      const after = getSaveSummary(reload(t.engine));
      assert.deepEqual(after.players.map(player => [player.id, player.eliminated === true]), seatsFor(count).map(seat => [seat, seat === P2]));
      assert.equal(after.activePlayerId, P1);
      assert.equal(after.winner, undefined);
      assert.deepEqual(after, getSaveSummary(t.engine), "the summary of the loaded game is the original's");
    });
  }
});

// ---------------------------------------------------------------------------
// Whole games.
// ---------------------------------------------------------------------------

describe("MPX-seat / MPX-lasting — real decks at three and four seats, saved and loaded all game long", () => {
  for (const count of TABLES) {
    rule(["MPX-seat", "MPX-lasting", "MPX-priority"], `${count} seats: a game loaded from a save every few actions never leaves the original's state`, () => {
      const setup = randomSetup(40 + count, { seats: count });
      let shadow: SpoilsEngine | undefined;
      let left = 0;
      let checks = 0;
      const result = playRandomGame(setup, 11, {
        maxActions: 260,
        onAction(engine, action, index) {
          if (shadow && left > 0) {
            shadow.perform(JSON.parse(JSON.stringify(action)) as GameAction);
            left--;
            checks++;
            assert.deepEqual(plain(shadow), plain(engine), `after action ${index} (${action.type})`);
          }
          if (index % 9 === 0 || left === 0) {
            const save = JSON.parse(JSON.stringify(saveGame(engine)));
            shadow = loadGame(save, CATALOG, undefined, CARD_NAME_CATALOG);
            left = 8;
            assert.deepEqual(plain(shadow), plain(engine), `a save at action ${index} loads to the same state`);
          }
        }
      });
      assert.notEqual(result.status, "finding", JSON.stringify(result.finding));
      assert.ok(checks > 150, `the loaded game was compared after ${checks} actions`);
    });
  }
});
