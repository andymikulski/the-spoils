// Multiplayer (free-for-all) rules, part 7: "your opponent" is bound per block of rules text.
// Atoms: data/rule-tests/source/multiplayer.txt (batch mp-ffa): MP 2, MP 3, MP 4, MP 5, MPX-select, MPX-both,
// MPX-lasting, MPX-trigger-condition, MPX-battle-opponent, MPX-vocab-*, MPX-respond (the "your opponent cannot
// respond" part), MPX-hidden (2), MPX-offer, MPX-other-pov.
// Every numbered point is tested at 3 and at 4 seats, and the two-player reduction where the atom has one.
//
// MPX-either-deck (MPQ-P6) and MPX-an-superlative (MPQ-P9) are data-level: they only ask for a player choice and a
// `chosenPlayer` read-back (MPX-vocab-an), or "the other opponent is not affected", which the tests below prove for
// every vocabulary form; they need no engine rule of their own.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, GameAction, PlayerId, SpoilsEngine } from "../../../engine.js";
import { loadGame, saveGame } from "../../../engine.js";
import { buildGame, character, item, P1, P2, P3, P4, resolvePendingResponses, tactic } from "../support/fixtures.js";
import { refused, rule } from "./_rule.js";
import {
  ACTIVATED,
  answerPlayer,
  baseline,
  board,
  cast,
  DESTROY_THEIRS,
  DRAIN_THEIRS,
  intoPlay,
  lost,
  pending,
  plainSeats,
  play,
  seatsFor,
  TABLES,
  type Table
} from "./_mpTable.js";

describe("MP 2 / MPX-select — the opponent is selected when the card is played, before any target", () => {
  for (const count of TABLES) {
    rule(["MP 2", "MPX-select"], `${count} seats: the first thing a "your opponent" card needs is the opponent, offered to every other player`, () => {
      const t = board(count, tactic({ name: "Cull", behavior: DESTROY_THEIRS }));
      const needs = t.engine.getPlayRequirements(play(t) as never);
      assert.equal(needs.length, 1);
      assert.equal(needs[0]!.kind, "players");
      if (needs[0]!.kind !== "players") return;
      assert.deepEqual(needs[0]!.choices, [{ id: "opponent", candidates: t.seats.slice(1) }]);
    });

    rule(["MP 2", "MPX-select"], `${count} seats: the targets follow the choice: only the chosen opponent's characters are offered`, () => {
      const t = board(count, tactic({ name: "Cull", behavior: DESTROY_THEIRS }));
      const chosen = P3;
      const needs = t.engine.getPlayRequirements(play(t, { players: { opponent: chosen } }) as never);
      assert.equal(needs[0]!.kind, "pick");
      if (needs[0]!.kind !== "pick") return;
      assert.deepEqual(needs[0]!.candidates, [t.id(`c-${chosen}`)]);
    });

    rule(["MP 2", "MPX-select"], `${count} seats: the chosen opponent is affected and no other opponent is`, () => {
      const t = board(count, tactic({ name: "Cull", behavior: DESTROY_THEIRS }));
      t.engine.perform(play(t, { players: { opponent: P3 }, selected: { t: [t.id("c-p3")] } }));
      resolvePendingResponses(t.engine);
      assert.equal(t.engine.state.cards[t.id("c-p3")]!.zone, "discard");
      for (const other of t.seats.filter(seat => seat !== P3)) assert.equal(t.engine.state.cards[t.id(`c-${other}`)]!.zone, "play");
    });

    rule(["MP 2", "MPX-select"], `${count} seats: a pick outside the chosen opponent's cards is refused`, () => {
      const t = board(count, tactic({ name: "Cull", behavior: DESTROY_THEIRS }));
      refused(() => t.engine.perform(play(t, { players: { opponent: P3 }, selected: { t: [t.id("c-p2")] } })), "a pick of another opponent");
      t.engine.perform(play(t, { players: { opponent: P3 }, selected: { t: [t.id("c-p3")] } }));
    });

    rule(["MP 2", "MPX-select"], `${count} seats: a missing opponent is refused`, () => {
      const t = board(count, tactic({ name: "Cull", behavior: DESTROY_THEIRS }));
      refused(() => t.engine.perform(play(t, { selected: { t: [t.id("c-p2")] } })), "no opponent named", /Choose your opponent/);
      t.engine.perform(play(t, { players: { opponent: P2 }, selected: { t: [t.id("c-p2")] } }));
    });

    rule(["MPX-select"], `${count} seats: naming yourself, an eliminated player or a non-player is refused`, () => {
      const t = board(count, tactic({ name: "Cull", behavior: DESTROY_THEIRS }));
      t.engine.state.players[P2]!.eliminated = { turn: 1 };
      for (const bad of [P1, P2, "nobody"]) {
        refused(() => t.engine.perform(play(t, { players: { opponent: bad }, selected: { t: [t.id("c-p3")] } })), `opponent ${bad}`);
      }
      t.engine.perform(play(t, { players: { opponent: P3 }, selected: { t: [t.id("c-p3")] } }));
    });
  }
});

describe("MP 2 / MPX-select — what does and does not ask", () => {
  rule(["MP 2", "MPX-select"], "2 seats: the only opponent is the opponent: nothing is asked and nothing extra is stored", () => {
    const t = board(2, tactic({ name: "Drain", behavior: DRAIN_THEIRS }));
    assert.deepEqual(t.engine.getPlayRequirements(play(t) as never), []);
    const before = baseline(t);
    cast(t);
    assert.equal(lost(t, before, P2), 3);
    assert.equal(lost(t, before, P1), 0);
    assert.equal(pending(t), undefined);
  });

  rule(["MP 2", "MPX-select"], "2 seats: the opponent may still be named, and only as the other player", () => {
    const t = board(2, tactic({ name: "Drain", behavior: DRAIN_THEIRS }));
    refused(() => t.engine.perform(play(t, { players: { opponent: P1 } })), "yourself as the opponent");
    const before = baseline(t);
    cast(t, { opponent: P2 });
    assert.equal(lost(t, before, P2), 3);
  });

  for (const count of TABLES) {
    rule(["MPX-select"], `${count} seats: a block that never says "your opponent" selects nobody`, () => {
      const t = board(count, tactic({ name: "Boost", behavior: ACTIVATED({ effects: [{ type: "modifyInfluence", player: "controller", amount: 2 }] }) }));
      assert.deepEqual(t.engine.getPlayRequirements(play(t) as never), []);
      refused(() => t.engine.perform(play(t, { players: { opponent: P2 } })), "a selection for a block with no opponent");
      const before = baseline(t);
      cast(t);
      assert.equal(lost(t, before, P1), -2);
    });
  }
});

describe("MP 4 / MPX-select (5) — a new selection every time, kept across a pause and a save", () => {
  for (const count of TABLES) {
    rule(["MP 4", "MPX-select"], `${count} seats: an ability used twice makes two independent selections`, () => {
      const t = board(count, character({ name: "Siphon", behavior: DRAIN_THEIRS }));
      const siphon = intoPlay(t);
      const before = baseline(t);
      const use = (opponent: PlayerId) => {
        t.engine.perform({ type: "activateAbility", playerId: P1, cardId: siphon, abilityId: "go", players: { opponent } });
        resolvePendingResponses(t.engine);
      };
      use(P2);
      use(P3);
      assert.equal(lost(t, before, P2), 3);
      assert.equal(lost(t, before, P3), 3);
      for (const other of t.seats.slice(3)) assert.equal(lost(t, before, other), 0);
    });

    rule(["MP 4", "MPX-select"], `${count} seats: the selection survives a parked choice and a save and load`, () => {
      const parked = ACTIVATED({
        effects: [
          { type: "chooserSelectsOption", chooser: "controller", options: [{ label: "go", effects: [] }, { label: "stop", effects: [] }] },
          { type: "modifyInfluence", player: "opponent", amount: -3 }
        ]
      });
      const t = board(count, tactic({ name: "Parked", behavior: parked }));
      const before = baseline(t);
      cast(t, { opponent: P3 });
      assert.equal(pending(t)?.kind, "chooserSelectsOption");
      const reloaded = loadGame(JSON.parse(JSON.stringify(saveGame(t.engine))), Object.values(t.engine.definitions));
      const t2: Table = { ...t, engine: reloaded };
      t2.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index: 0 } });
      resolvePendingResponses(t2.engine);
      assert.equal(lost(t2, before, P3), 3);
      for (const other of t.seats.filter(seat => seat !== P3)) assert.equal(lost(t2, before, other), 0);
    });
  }
});

describe("MP 3 / MPX-both — both players is the controller and the one selected opponent", () => {
  const PAIR = ACTIVATED({
    effects: [{ type: "forEachPlayer", players: "pair", effects: [{ type: "modifyInfluence", player: "controller", amount: -2 }] }]
  });
  for (const count of TABLES) {
    rule(["MP 3", "MPX-both"], `${count} seats: the controller and the selected opponent are affected, nobody else`, () => {
      const t = board(count, tactic({ name: "Both", behavior: PAIR }));
      const needs = t.engine.getPlayRequirements(play(t) as never);
      assert.equal(needs[0]!.kind, "players");
      const before = baseline(t);
      cast(t, { opponent: P3 });
      assert.equal(lost(t, before, P1), 2);
      assert.equal(lost(t, before, P3), 2);
      for (const other of t.seats.filter(seat => seat !== P1 && seat !== P3)) assert.equal(lost(t, before, other), 0);
    });

    rule(["MP 3", "MPX-both"], `${count} seats: "both players" and "your opponent" in one block are the same opponent`, () => {
      const both = ACTIVATED({
        effects: [
          { type: "forEachPlayer", players: "pair", effects: [{ type: "modifyInfluence", player: "controller", amount: -1 }] },
          { type: "modifyInfluence", player: "opponent", amount: -5 }
        ]
      });
      const t = board(count, tactic({ name: "Both", behavior: both }));
      const before = baseline(t);
      cast(t, { opponent: P2 });
      assert.equal(lost(t, before, P2), 6);
      assert.equal(lost(t, before, P1), 1);
      for (const other of t.seats.slice(2)) assert.equal(lost(t, before, other), 0);
    });
  }

  rule(["MP 3", "MPX-both"], "2 seats: both players are the two players and nothing is asked", () => {
    const t = board(2, tactic({ name: "Both", behavior: PAIR }));
    assert.deepEqual(t.engine.getPlayRequirements(play(t) as never), []);
    const before = baseline(t);
    cast(t);
    assert.equal(lost(t, before, P1), 2);
    assert.equal(lost(t, before, P2), 2);
  });
});

// ---------------------------------------------------------------------------
// MPX-vocab-*: the player words.
// ---------------------------------------------------------------------------


describe("MPX-vocab-your — your opponent, that opponent, their opponent", () => {
  for (const count of TABLES) {
    rule(["MPX-vocab-your"], `${count} seats: inside "both players" the other of the two is "their opponent"`, () => {
      const theirs = ACTIVATED({
        effects: [{ type: "forEachPlayer", players: "pair", effects: [{ type: "modifyInfluence", player: "opponent", amount: -1 }] }]
      });
      const t = board(count, tactic({ name: "Mirror", behavior: theirs }));
      const before = baseline(t);
      cast(t, { opponent: P3 });
      assert.equal(lost(t, before, P1), 1, "the opponent of the selected opponent is the controller");
      assert.equal(lost(t, before, P3), 1, "the opponent of the controller is the selected opponent");
      for (const other of t.seats.filter(seat => seat !== P1 && seat !== P3)) assert.equal(lost(t, before, other), 0);
    });

    rule(["MPX-vocab-your", "MPX-select"], `${count} seats: a response to another player's card names that player, and nobody is asked`, () => {
      const answerCard = tactic({ name: "Mistaken", behavior: ACTIVATED({ opponentFrom: "respondedTo", effects: [{ type: "modifyInfluence", player: "opponent", amount: -2 }] }) });
      const bait = tactic({ name: "Bait" });
      const seats = seatsFor(count);
      const built = buildGame({
        ...plainSeats(count),
        activePlayerId: P3,
        turn: 3,
        cards: [
          { key: "bait", def: bait, owner: P3, zone: "hand" },
          { key: "spell", def: answerCard, owner: P1, zone: "hand" },
          ...seats.map(owner => ({ key: `c-${owner}`, def: character({ name: `Char ${owner}` }), owner }))
        ]
      });
      const t: Table = { engine: built.engine, id: built.id, seats };
      const before = baseline(t);
      t.engine.perform({ type: "playCard", playerId: P3, cardId: t.id("bait") });
      assert.equal(t.engine.state.responseWindow?.priorityPlayerId, count === 3 ? P1 : P4);
      if (count === 4) t.engine.perform({ type: "passPriority", playerId: P4 });
      assert.deepEqual(t.engine.getPlayRequirements(play(t) as never), []);
      t.engine.perform(play(t));
      resolvePendingResponses(t.engine);
      assert.equal(lost(t, before, P3), 2, "the controller of the card answered is the opponent");
      for (const other of t.seats.filter(seat => seat !== P3)) assert.equal(lost(t, before, other), 0);
    });
  }
});

describe("MPX-vocab-an — an opponent, any opponent", () => {
  const CHOOSE = (from: "opponents" | "players") =>
    ({
      abilities: [
        {
          id: "go",
          type: "activated",
          playerChoices: [{ id: "who", from }],
          effects: [{ type: "modifyInfluence", player: { type: "chosenPlayer", id: "who" }, amount: -3 }]
        }
      ]
    }) as CardDefinition["behavior"];

  for (const count of TABLES) {
    rule(["MPX-vocab-an"], `${count} seats: a selector over "an opponent" offers the cards of every opponent and asks for no player`, () => {
      const any = ACTIVATED({
        targets: [{ id: "t", selector: { type: "character", controller: "opponents" }, count: 1 }],
        effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
      });
      const t = board(count, tactic({ name: "Any", behavior: any }));
      const needs = t.engine.getPlayRequirements(play(t) as never);
      assert.equal(needs[0]!.kind, "pick");
      if (needs[0]!.kind !== "pick") return;
      assert.deepEqual(new Set(needs[0]!.candidates), new Set(t.seats.slice(1).map(seat => t.id(`c-${seat}`))));
      cast(t, undefined, { selected: { t: [t.id("c-p3")] } });
      assert.equal(t.engine.state.cards[t.id("c-p3")]!.zone, "discard");
      assert.equal(t.engine.state.cards[t.id("c-p2")]!.zone, "play");
    });

    rule(["MPX-vocab-an"], `${count} seats: when nothing in the sentence settles it, the controller chooses which opponent, with the action`, () => {
      const t = board(count, tactic({ name: "Any", behavior: CHOOSE("opponents") }));
      const needs = t.engine.getPlayRequirements(play(t) as never);
      assert.deepEqual(needs, [{ kind: "players", choices: [{ id: "who", candidates: t.seats.slice(1) }] }]);
      const before = baseline(t);
      cast(t, { who: P3 });
      assert.equal(lost(t, before, P3), 3);
      for (const other of t.seats.filter(seat => seat !== P3)) assert.equal(lost(t, before, other), 0);
    });

    rule(["MPX-vocab-an"], `${count} seats: a choice among opponents refuses yourself; one among players allows it`, () => {
      const opponents = board(count, tactic({ name: "Any", behavior: CHOOSE("opponents") }));
      refused(() => opponents.engine.perform(play(opponents, { players: { who: P1 } })), "yourself as an opponent");
      const players = board(count, tactic({ name: "Any", behavior: CHOOSE("players") }));
      assert.deepEqual((players.engine.getPlayRequirements(play(players) as never)[0] as { choices: Array<{ candidates: string[] }> }).choices[0]!.candidates, players.seats);
      const before = baseline(players);
      cast(players, { who: P1 });
      assert.equal(lost(players, before, P1), 3);
    });

    rule(["MPX-vocab-an"], `${count} seats: a player choice is not a pick: it sets off no "picked" trigger, a real pick does`, () => {
      const watcher = item({
        name: "Pick Watcher",
        behavior: {
          abilities: [
            {
              id: "w",
              type: "triggered",
              event: "cardPicked",
              condition: { type: "sourceIsEventCard" },
              effects: [{ type: "modifyInfluence", player: "controller", amount: 10 }]
            }
          ]
        } as CardDefinition["behavior"]
      });
      const seats = seatsFor(count);
      const make = (behavior: CardDefinition["behavior"]) =>
        buildGame({
          ...plainSeats(count),
          cards: [
            { key: "spell", def: tactic({ name: "Spell", behavior }), owner: P1, zone: "hand" },
            { key: "watcher", def: watcher, owner: P3 },
            ...seats.map(owner => ({ key: `c-${owner}`, def: character({ name: `Char ${owner}` }), owner }))
          ]
        });
      const choose = make(CHOOSE("opponents"));
      const t1: Table = { engine: choose.engine, id: choose.id, seats };
      const before1 = baseline(t1);
      cast(t1, { who: P3 });
      assert.equal(lost(t1, before1, P3), 3, "no +10 from a pick that never happened");
      const pick = make(
        ACTIVATED({ targets: [{ id: "t", selector: { type: "item", controller: "opponents" }, count: 1 }], effects: [] })
      );
      const t2: Table = { engine: pick.engine, id: pick.id, seats };
      const before2 = baseline(t2);
      cast(t2, undefined, { selected: { t: [t2.id("watcher")] } });
      assert.equal(lost(t2, before2, P3), -10, "a real pick of the watcher fires it");
    });

    rule(["MPX-vocab-an", "MPX-other-pov"], `${count} seats: a choosePlayer effect asks at resolution and the chosen player is read back`, () => {
      const effect = ACTIVATED({
        effects: [
          { type: "choosePlayer", id: "x", from: "opponents" },
          { type: "modifyInfluence", player: { type: "chosenPlayer", id: "x" }, amount: -3 }
        ]
      });
      const t = board(count, tactic({ name: "Late", behavior: effect }));
      assert.deepEqual(t.engine.getPlayRequirements(play(t) as never), [], "nothing is asked with the action");
      const before = baseline(t);
      cast(t);
      assert.equal(pending(t)?.kind, "choosePlayer");
      assert.equal(pending(t)?.playerId, P1);
      assert.deepEqual((pending(t) as { candidates: string[] }).candidates, t.seats.slice(1));
      answerPlayer(t, P1, P2);
      resolvePendingResponses(t.engine);
      assert.equal(lost(t, before, P2), 3);
      for (const other of t.seats.slice(2)) assert.equal(lost(t, before, other), 0);
    });

    rule(["MPX-other-pov"], `${count} seats: a choice written from another player's point of view is that player's, among their own opponents`, () => {
      const effect = ACTIVATED({
        effects: [
          { type: "choosePlayer", id: "x", from: "opponents", chooser: { type: "player", id: P2 } },
          { type: "modifyInfluence", player: { type: "chosenPlayer", id: "x" }, amount: -3 }
        ]
      });
      const t = board(count, tactic({ name: "Theirs", behavior: effect }));
      const before = baseline(t);
      cast(t);
      assert.equal(pending(t)?.playerId, P2);
      assert.deepEqual((pending(t) as { candidates: string[] }).candidates, [P3, ...(count === 4 ? [P4] : []), P1]);
      assert.equal(t.engine.checkAction({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "choosePlayer", playerId: P3 } }).ok, false);
      answerPlayer(t, P2, P1);
      resolvePendingResponses(t.engine);
      assert.equal(lost(t, before, P1), 3);
    });
  }

  rule(["MPX-vocab-an"], "2 seats: with one opponent a player choice is made for you, and a choosePlayer effect never asks", () => {
    const t = board(2, tactic({ name: "Any", behavior: CHOOSE("opponents") }));
    assert.deepEqual(t.engine.getPlayRequirements(play(t) as never), []);
    const before = baseline(t);
    cast(t);
    assert.equal(lost(t, before, P2), 3);
    const late = board(2, tactic({ name: "Late", behavior: ACTIVATED({ effects: [{ type: "choosePlayer", id: "x", from: "opponents" }, { type: "modifyInfluence", player: { type: "chosenPlayer", id: "x" }, amount: -3 }] }) }));
    const before2 = baseline(late);
    cast(late);
    assert.equal(pending(late), undefined);
    assert.equal(lost(late, before2, P2), 3);
  });
});

describe("MPX-vocab-each / MPX-vocab-players — every opponent, every player, in the order of CR 402.2", () => {
  for (const count of TABLES) {
    rule(["MPX-vocab-each"], `${count} seats: "opponents" as a player affects every opponent and not the controller`, () => {
      const t = board(count, tactic({ name: "All Theirs", behavior: ACTIVATED({ effects: [{ type: "modifyInfluence", player: "opponents", amount: -3 }] }) }));
      assert.deepEqual(t.engine.getPlayRequirements(play(t) as never), [], '"each opponent" selects nobody');
      const before = baseline(t);
      cast(t);
      for (const opponent of t.seats.slice(1)) assert.equal(lost(t, before, opponent), 3);
      assert.equal(lost(t, before, P1), 0);
    });

    rule(["MPX-vocab-each"], `${count} seats: an opponent who has lost is not an opponent any more`, () => {
      const t = board(count, tactic({ name: "All Theirs", behavior: ACTIVATED({ effects: [{ type: "modifyInfluence", player: "opponents", amount: -3 }] }) }));
      t.engine.state.players[P2]!.eliminated = { turn: 1 };
      const before = baseline(t);
      cast(t);
      assert.equal(lost(t, before, P2), 0);
      for (const opponent of t.seats.slice(2)) assert.equal(lost(t, before, opponent), 3);
    });

    rule(["MPX-vocab-each", "MPX-vocab-players"], `${count} seats: a condition over "opponents" holds when it holds for any opponent`, () => {
      const conditional = ACTIVATED({
        effects: [
          {
            type: "if",
            condition: { type: "numberCompare", left: { type: "count", selector: { type: "character", controller: "opponents" } }, operator: ">=", right: count - 1 },
            effects: [{ type: "modifyInfluence", player: "controller", amount: 4 }]
          }
        ]
      });
      const t = board(count, tactic({ name: "Count", behavior: conditional }));
      const before = baseline(t);
      cast(t);
      assert.equal(lost(t, before, P1), -4, "a total over your opponents adds up across every opponent");
    });
  }

  const ORDER_PROBE = (players: string | undefined, except?: unknown) =>
    ACTIVATED({
      effects: [
        {
          type: "forEachPlayer",
          ...(players ? { players } : {}),
          ...(except ? { except } : {}),
          effects: [{ type: "chooserSelectsOption", chooser: "controller", options: [{ label: "a", effects: [] }, { label: "b", effects: [] }] }]
        }
      ]
    });

  /** P2 (or whoever `active` is) has the turn and plays a bait tactic; P1 responds with the probe. Returns who is asked, in order. */
  function iterationOrder(count: number, active: PlayerId, behavior: CardDefinition["behavior"]): PlayerId[] {
    const seats = seatsFor(count);
    const built = buildGame({
      ...plainSeats(count),
      activePlayerId: active,
      turn: seats.indexOf(active) + 1,
      cards: [
        { key: "bait", def: tactic({ name: "Bait" }), owner: active, zone: "hand" },
        { key: "spell", def: tactic({ name: "Probe", behavior }), owner: P1, zone: "hand" }
      ]
    });
    const engine = built.engine;
    engine.perform({ type: "playCard", playerId: active, cardId: built.id("bait") });
    // Clockwise from the actor, up to P1.
    for (let guard = 0; guard < 6 && engine.state.responseWindow?.priorityPlayerId !== P1; guard++) {
      engine.perform({ type: "passPriority", playerId: engine.state.responseWindow!.priorityPlayerId });
    }
    engine.perform({ type: "playCard", playerId: P1, cardId: built.id("spell") });
    const asked: PlayerId[] = [];
    for (let guard = 0; guard < 40; guard++) {
      resolvePendingResponses(engine);
      const choice = engine.state.pendingChoice;
      if (!choice) break;
      asked.push(choice.playerId);
      engine.perform({ type: "resolvePendingChoice", playerId: choice.playerId, choice: { kind: "chooserSelectsOption", index: 0 } });
    }
    return asked;
  }

  for (const count of TABLES) {
    rule(["MPX-vocab-players", "MPX-vocab-each"], `${count} seats: "each player" starts with the active player and goes clockwise (CR 402.2)`, () => {
      const seats = seatsFor(count);
      assert.deepEqual(iterationOrder(count, P2, ORDER_PROBE(undefined)), [P2, ...seats.slice(2), P1]);
      assert.deepEqual(iterationOrder(count, P3, ORDER_PROBE("all")), [P3, ...(count === 4 ? [P4] : []), P1, P2]);
    });

    rule(["MPX-vocab-each"], `${count} seats: "each opponent" and "each other player" skip the controller and keep the order`, () => {
      const seats = seatsFor(count);
      for (const players of ["opponents", "others"]) {
        assert.deepEqual(iterationOrder(count, P2, ORDER_PROBE(players)), seats.slice(1), players);
        assert.deepEqual(iterationOrder(count, P3, ORDER_PROBE(players)), [P3, ...(count === 4 ? [P4] : []), P2], players);
      }
    });

    rule(["MPX-vocab-players"], `${count} seats: except leaves one player out of the iteration`, () => {
      const seats = seatsFor(count);
      const asked = iterationOrder(count, P2, ORDER_PROBE("all", { type: "player", id: P3 }));
      assert.deepEqual(asked, [P2, ...seats.slice(3), P1]);
    });

    rule(["MPX-vocab-players"], `${count} seats: "each other player's faction gains" after a pick: everyone but the picked player, the controller included`, () => {
      const gideon = {
        abilities: [
          {
            id: "go",
            type: "activated",
            playerChoices: [{ id: "picked", from: "opponents" }],
            effects: [
              {
                type: "forEachPlayer",
                players: "all",
                except: { type: "chosenPlayer", id: "picked" },
                effects: [{ type: "modifyInfluence", player: "controller", amount: 2 }]
              }
            ]
          }
        ]
      } as CardDefinition["behavior"];
      const t = board(count, tactic({ name: "Legacy", behavior: gideon }));
      const before = baseline(t);
      cast(t, { picked: P2 });
      assert.equal(lost(t, before, P2), 0);
      assert.equal(lost(t, before, P1), -2);
      for (const other of t.seats.slice(2)) assert.equal(lost(t, before, other), -2);
    });

    rule(["MPX-vocab-players"], `${count} seats: "each of you" is the controller and the selected opponent, not every player`, () => {
      const t = board(count, tactic({ name: "Each Of You", behavior: ACTIVATED({ effects: [{ type: "forEachPlayer", players: "pair", effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }] }) }));
      const before = baseline(t);
      cast(t, { opponent: P2 });
      assert.equal(lost(t, before, P1), -1);
      assert.equal(lost(t, before, P2), -1);
      for (const other of t.seats.slice(2)) assert.equal(lost(t, before, other), 0);
    });
  }

  rule(["MPX-vocab-players"], "2 seats: every player-set value reduces to the two-player iteration, active player first", () => {
    for (const players of [undefined, "all", "selfAndOpponents"]) {
      assert.deepEqual(iterationOrder(2, P2, ORDER_PROBE(players)), [P2, P1], String(players));
    }
    for (const players of ["opponents", "others"]) assert.deepEqual(iterationOrder(2, P2, ORDER_PROBE(players)), [P2], players);
  });
});

describe("MPX-knitting — every opponent, no opponent selected", () => {
  const SHARED = {
    abilities: [{ id: "go", type: "activated", usableBy: "anyPlayer", effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }]
  } as CardDefinition["behavior"];
  for (const count of TABLES) {
    rule(["MPX-knitting"], `${count} seats: "both players may use this ability" is the controller and every opponent, resolving under whoever uses it`, () => {
      const t = board(count, item({ name: "Shared", behavior: SHARED }));
      intoPlay(t);
      t.engine.state.activePlayerId = P3;
      t.engine.state.priorityPlayerId = P3;
      for (const seat of t.seats) {
        const listed = t.engine.getActivatedAbilityStatuses(seat).filter(entry => entry.cardId === t.id("spell"));
        assert.equal(listed.length, 1, `${seat} may use it`);
      }
      const before = baseline(t);
      t.engine.perform({ type: "activateAbility", playerId: P3, cardId: t.id("spell"), abilityId: "go" });
      resolvePendingResponses(t.engine);
      assert.equal(lost(t, before, P3), -1);
      assert.equal(lost(t, before, P1), 0);
    });

    rule(["MPX-knitting", "MPX-both"], `${count} seats: selfAndOpponents iterates the controller and every opponent and selects nobody`, () => {
      const t = board(count, tactic({ name: "Everyone", behavior: ACTIVATED({ effects: [{ type: "forEachPlayer", players: "selfAndOpponents", effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }] }) }));
      assert.deepEqual(t.engine.getPlayRequirements(play(t) as never), []);
      const before = baseline(t);
      cast(t);
      for (const seat of t.seats) assert.equal(lost(t, before, seat), -1);
    });
  }
});
