// Multiplayer (free-for-all) rules, part 8: "your opponent" in text that keeps applying, in triggers, in battle text,
// in a response and in an offer.
// Atoms: data/rule-tests/source/multiplayer.txt (batch mp-ffa): MPX-lasting, MPX-trigger-condition,
// MPX-battle-opponent, MPX-respond (the "your opponent cannot respond" part), MPX-offer, MPX-other-pov, MPX-hidden (2),
// MPX-either-deck, MPX-an-superlative, MP 5.
// Every numbered point is tested at 3 and at 4 seats, and the two-player reduction where the atom has one.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, PlayerId } from "../../../engine.js";
import { loadGame, saveGame } from "../../../engine.js";
import cardsJson from "../../../data/cards.js";
import { buildGame, character, item, P1, P2, P3, P4, resolvePendingResponses, resourceCard, tactic } from "../support/fixtures.js";
import { settleTurnStart } from "../support/develop.js";
import { refused, rule, ruleExempt } from "./_rule.js";
import {
  ACTIVATED,
  answerPlayer,
  baseline,
  board,
  cast,
  influence,
  intoPlay,
  lost,
  pending,
  plainSeats,
  play,
  seatsFor,
  TABLES,
  type Table
} from "./_mpTable.js";

ruleExempt("MP 5", "House rules are non-normative: the engine exposes no house-rule hook for them.");
ruleExempt(
  ["MPX-either-deck", "MPX-an-superlative"],
  "Data-level: both only ask for one opponent chosen first (a playerChoices entry or the block's opponent) and a read-back, which MPX-select, MPX-vocab-an and MPX-both prove; neither needs an engine rule of its own."
);

// ---------------------------------------------------------------------------
// MPX-lasting — "your opponent" in text that keeps applying (RQ-mp-5).
// ---------------------------------------------------------------------------

/** "Your opponent cannot draw cards." (continuous text) */
const WARDEN = {
  abilities: [{ id: "ward", type: "continuous", modifiers: [], drawModifiers: [{ player: "opponent", prevent: true }] }]
} as CardDefinition["behavior"];

/** The seats whose draws the Warden currently stops. */
const stopped = (t: Table): PlayerId[] =>
  t.seats.filter(seat => t.engine.getPlayerEffects(seat).some(effect => effect.kind === "drawModifier"));

/** The extra cards of the lasting tests: a finisher that takes a faction to 0 and a thief that gives the Warden away. */
const FINISH = (who: PlayerId) => tactic({ name: `Finish ${who}`, behavior: ACTIVATED({ effects: [{ type: "modifyInfluence", player: { type: "player", id: who }, amount: -99 }] }) });
const THIEF = tactic({
  name: "Thief",
  behavior: ACTIVATED({
    targets: [{ id: "w", selector: { type: "character", name: "Warden" }, count: 1 }],
    effects: [{ type: "takeControl", target: { type: "selected", id: "w" }, controller: { type: "player", id: P2 } }]
  })
});

/** Plays the Warden from P1's hand, lets everything settle up to the selection prompt, with a finisher per seat and a thief. */
function enterWarden(count: number): Table {
  const t = board(count, character({ name: "Warden", behavior: WARDEN }), [
    ...seatsFor(count).slice(1).map(who => ({ key: `finish-${who}`, def: FINISH(who), owner: P1, zone: "hand" as const })),
    { key: "thief", def: THIEF, owner: P1, zone: "hand" as const },
    { key: "idle", def: tactic({ name: "Idle" }), owner: P1, zone: "hand" as const }
  ]);
  t.engine.perform(play(t));
  resolvePendingResponses(t.engine);
  return t;
}

const playKey = (t: Table, key: string, extra: Record<string, unknown> = {}): void => {
  t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id(key), ...extra } as never);
  resolvePendingResponses(t.engine);
};

describe("MPX-lasting — selected as the text starts applying, kept while it lasts", () => {
  for (const count of TABLES) {
    rule(["MPX-lasting", "MP 2"], `${count} seats: the controller selects when the card enters play, and until then the text does not apply`, () => {
      const t = enterWarden(count);
      assert.equal(pending(t)?.kind, "choosePlayer");
      assert.equal(pending(t)?.playerId, P1);
      assert.deepEqual((pending(t) as { candidates: string[] }).candidates, t.seats.slice(1));
      assert.deepEqual(stopped(t), [], "unselected text applies to nobody");
      answerPlayer(t, P1, P3);
      assert.equal(pending(t), undefined);
      assert.deepEqual(stopped(t), [P3], "only the selected opponent is affected");
      assert.deepEqual(t.engine.state.cards[t.id("spell")]!.boundOpponents, { ward: P3 });
    });

    rule(["MPX-lasting"], `${count} seats: it is not selected again when other things happen, and the selection survives a save and load`, () => {
      const t = enterWarden(count);
      answerPlayer(t, P1, P2);
      playKey(t, "idle");
      assert.equal(pending(t), undefined);
      assert.deepEqual(stopped(t), [P2]);
      const reloaded = loadGame(JSON.parse(JSON.stringify(saveGame(t.engine))), Object.values(t.engine.definitions));
      assert.deepEqual(reloaded.state.cards[t.id("spell")]!.boundOpponents, { ward: P2 });
    });

    rule(["MPX-lasting"], `${count} seats: "your opponents" in lasting text selects nobody and covers every opponent`, () => {
      const all = {
        abilities: [{ id: "ward", type: "continuous", modifiers: [], drawModifiers: [{ player: "opponents", prevent: true }] }]
      } as CardDefinition["behavior"];
      const t = board(count, character({ name: "Warden", behavior: all }));
      t.engine.perform(play(t));
      resolvePendingResponses(t.engine);
      assert.equal(pending(t), undefined);
      assert.deepEqual(stopped(t), t.seats.slice(1));
    });

    rule(["MPX-lasting"], `${count} seats: when the selected opponent is eliminated the controller selects again, from the players left`, () => {
      const t = enterWarden(count);
      answerPlayer(t, P1, P2);
      playKey(t, "finish-p2");
      assert.equal(t.engine.state.players[P2]!.eliminated !== undefined, true);
      if (count === 3) {
        assert.equal(pending(t), undefined, "one opponent left: the text moves to them without asking");
        assert.deepEqual(stopped(t), [P3]);
        assert.equal(t.engine.state.cards[t.id("spell")]!.boundOpponents, undefined);
      } else {
        assert.equal(pending(t)?.kind, "choosePlayer");
        assert.deepEqual((pending(t) as { candidates: string[] }).candidates, [P3, P4]);
        assert.deepEqual(stopped(t), []);
        answerPlayer(t, P1, P4);
        assert.deepEqual(stopped(t), [P4]);
      }
    });

    rule(["MPX-lasting"], `${count} seats: an opponent other than the selected one being eliminated changes nothing`, () => {
      const t = enterWarden(count);
      answerPlayer(t, P1, P3);
      playKey(t, "finish-p2");
      assert.equal(pending(t), undefined);
      assert.deepEqual(stopped(t), [P3]);
    });

    rule(["MPX-lasting"], `${count} seats: when control of the card changes the new controller selects again and the old selection ends`, () => {
      const t = enterWarden(count);
      answerPlayer(t, P1, P3);
      playKey(t, "thief", { selected: { w: [t.id("spell")] } });
      assert.equal(t.engine.state.cards[t.id("spell")]!.controllerId, P2);
      assert.equal(pending(t)?.kind, "choosePlayer");
      assert.equal(pending(t)?.playerId, P2, "the new controller selects");
      assert.deepEqual((pending(t) as { candidates: string[] }).candidates, [P3, ...(count === 4 ? [P4] : []), P1]);
      assert.deepEqual(stopped(t), [], "the old selection ended");
      answerPlayer(t, P2, P3);
      assert.deepEqual(stopped(t), [P3], "even though the old selection is a valid opponent of the new controller, it was asked again");
    });
  }

  rule(["MPX-lasting"], "2 seats: the opponent is the only opponent, nothing is asked and nothing is stored", () => {
    const t = enterWarden(2);
    assert.equal(pending(t), undefined);
    assert.deepEqual(stopped(t), [P2]);
    assert.equal(t.engine.state.cards[t.id("spell")]!.boundOpponents, undefined);
  });

  for (const count of TABLES) {
    rule(["MPX-lasting"], `${count} seats: a conditional that names the opponent is judged against the selected opponent only`, () => {
      const conditional = {
        abilities: [
          {
            id: "ward",
            type: "continuous",
            modifiers: [],
            condition: { type: "numberCompare", left: { type: "count", selector: { type: "character", controller: "opponent" } }, operator: ">=", right: 1 },
            drawModifiers: [{ player: "opponent", prevent: true }]
          }
        ]
      } as CardDefinition["behavior"];
      const t = board(count, character({ name: "Warden", behavior: conditional }));
      t.engine.perform(play(t));
      resolvePendingResponses(t.engine);
      answerPlayer(t, P1, P3);
      assert.deepEqual(stopped(t), [P3]);
      // P3 loses its only character: the condition fails for the selected opponent even though P2 still controls one.
      t.engine.state.cards[t.id("c-p3")]!.zone = "discard";
      t.engine.state.players[P3]!.play = [];
      assert.deepEqual(stopped(t), []);
    });

    rule(["MPX-lasting"], `${count} seats: a lasting effect a block creates keeps reading the opponent that block selected`, () => {
      const buff = ACTIVATED({
        effects: [
          {
            type: "createAreaModifier",
            selector: { type: "character", controller: "opponent" },
            stat: "strength",
            operation: "add",
            value: 4,
            duration: { type: "untilEndOfTurn" }
          }
        ]
      });
      const t = board(count, tactic({ name: "Empower Theirs", behavior: buff }));
      cast(t, { opponent: P3 });
      const strength = (who: PlayerId) => t.engine.getStat(t.id(`c-${who}`), "strength");
      assert.equal(strength(P3), 5);
      for (const other of t.seats.filter(seat => seat !== P3)) assert.equal(strength(other), 1);
    });
  }
});

// ---------------------------------------------------------------------------
// Triggers and replacements: selected when they are followed / apply (MPX-select (2), MPQ-P3).
// ---------------------------------------------------------------------------

const TRIGGERED = (ability: Record<string, unknown>) =>
  ({ abilities: [{ id: "tr", type: "triggered", ...ability }] }) as CardDefinition["behavior"];

/** Extra cards for a trigger board: P1 owns the watcher (in play) and an idle tactic in hand. */
const withWatcher = (count: number, behavior: CardDefinition["behavior"], extra: Parameters<typeof board>[2] = []): Table =>
  board(count, character({ name: "Watcher", strength: 0, behavior }), [{ key: "idle", def: tactic({ name: "Idle" }), owner: P1, zone: "hand" }, ...extra]);

describe("MPX-select (2) — a trigger selects its opponent as it is followed, before its targets", () => {
  const OWN_PLAY = { type: "eventPlayerIs", player: "controller" };
  for (const count of TABLES) {
    rule(["MPX-select", "MP 2"], `${count} seats: the controller is asked when the trigger is followed; only the selected opponent is affected`, () => {
      const t = withWatcher(count, TRIGGERED({ event: "cardPlayed", condition: OWN_PLAY, effects: [{ type: "modifyInfluence", player: "opponent", amount: -2 }] }));
      intoPlay(t);
      const before = baseline(t);
      t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("idle") });
      assert.equal(pending(t)?.kind, "choosePlayer");
      assert.equal(pending(t)?.playerId, P1);
      assert.deepEqual((pending(t) as { candidates: string[] }).candidates, t.seats.slice(1));
      refused(() => answerPlayer(t, P1, P1), "yourself as the opponent");
      answerPlayer(t, P1, P3);
      resolvePendingResponses(t.engine);
      assert.equal(lost(t, before, P3), 2);
      for (const other of t.seats.filter(seat => seat !== P3)) assert.equal(lost(t, before, other), 0);
    });

    rule(["MPX-select"], `${count} seats: the choice comes before the trigger's targets, and the targets follow it`, () => {
      const t = withWatcher(
        count,
        TRIGGERED({
          event: "cardPlayed",
          condition: OWN_PLAY,
          targets: [{ id: "t", selector: { type: "character", controller: "opponent" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }),
        [{ key: "c2-p3", def: character({ name: "Second P3" }), owner: P3 }]
      );
      intoPlay(t);
      t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("idle") });
      assert.equal(pending(t)?.kind, "choosePlayer", "the opponent first");
      answerPlayer(t, P1, P3);
      assert.equal(pending(t)?.kind, "selectTargets");
      refused(
        () => t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { t: [t.id("c-p2")] } } }),
        "a character of the other opponent"
      );
      t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { t: [t.id("c-p3")] } } });
      resolvePendingResponses(t.engine);
      assert.equal(t.engine.state.cards[t.id("c-p3")]!.zone, "discard");
      assert.equal(t.engine.state.cards[t.id("c-p2")]!.zone, "play");
    });

    rule(["MPX-select"], `${count} seats: each time a trigger fires it selects again, independently`, () => {
      const t = withWatcher(
        count,
        TRIGGERED({ event: "cardPlayed", condition: OWN_PLAY, effects: [{ type: "modifyInfluence", player: "opponent", amount: -2 }] }),
        [{ key: "idle2", def: tactic({ name: "Idle Two" }), owner: P1, zone: "hand" }]
      );
      intoPlay(t);
      const before = baseline(t);
      for (const [key, who] of [["idle", P2], ["idle2", P3]] as const) {
        t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id(key) });
        answerPlayer(t, P1, who);
        resolvePendingResponses(t.engine);
      }
      assert.equal(lost(t, before, P2), 2);
      assert.equal(lost(t, before, P3), 2);
    });
  }

  rule(["MPX-select"], "2 seats: a trigger's only opponent is the opponent and nobody is asked", () => {
    const t = withWatcher(2, TRIGGERED({ event: "cardPlayed", condition: OWN_PLAY, effects: [{ type: "modifyInfluence", player: "opponent", amount: -2 }] }));
    intoPlay(t);
    const before = baseline(t);
    t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("idle") });
    assert.equal(pending(t), undefined);
    resolvePendingResponses(t.engine);
    assert.equal(lost(t, before, P2), 2);
  });
});

describe("MPX-trigger-condition — a condition that names your opponent is met by any opponent, who is the block's opponent", () => {
  const OPPONENT_PLAYS = { type: "eventPlayerIs", player: "opponent" };
  /** P1's watcher in play, `actor` has the turn with an idle tactic in hand. */
  function turnOf(count: number, actor: PlayerId, behavior: CardDefinition["behavior"]) {
    const seats = seatsFor(count);
    const built = buildGame({
      ...plainSeats(count),
      activePlayerId: actor,
      turn: seats.indexOf(actor) + 1,
      cards: [
        { key: "watcher", def: character({ name: "Watcher", strength: 0, behavior }), owner: P1 },
        { key: "idle", def: tactic({ name: "Idle" }), owner: actor, zone: "hand" },
        ...(count >= 3 ? [{ key: "c2-p3", def: character({ name: "Second P3" }), owner: P3 }] : []),
        ...seats.map(owner => ({ key: `c-${owner}`, def: character({ name: `Char ${owner}` }), owner }))
      ]
    });
    const t: Table = { engine: built.engine, id: built.id, seats };
    return t;
  }
  for (const count of TABLES) {
    for (const actor of [P2, P3]) {
      rule(["MPX-trigger-condition"], `${count} seats: ${actor} playing a card sets it off, and ${actor} is the opponent: nobody is asked`, () => {
        const t = turnOf(count, actor, TRIGGERED({ event: "cardPlayed", condition: OPPONENT_PLAYS, effects: [{ type: "modifyInfluence", player: "opponent", amount: -2 }] }));
        const before = baseline(t);
        t.engine.perform({ type: "playCard", playerId: actor, cardId: t.id("idle") });
        assert.equal(pending(t), undefined, "no choice is offered");
        resolvePendingResponses(t.engine);
        assert.equal(lost(t, before, actor), 2);
        for (const other of t.seats.filter(seat => seat !== actor)) assert.equal(lost(t, before, other), 0);
      });
    }

    rule(["MPX-trigger-condition"], `${count} seats: the controller's own play does not meet "if your opponent plays"`, () => {
      const t = turnOf(count, P1, TRIGGERED({ event: "cardPlayed", condition: OPPONENT_PLAYS, effects: [{ type: "modifyInfluence", player: "opponent", amount: -2 }] }));
      const before = baseline(t);
      t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("idle") });
      resolvePendingResponses(t.engine);
      for (const seat of t.seats) assert.equal(lost(t, before, seat), 0);
    });

    rule(["MPX-trigger-condition", "MPX-select"], `${count} seats: an event-bound trigger's "that player" and targets follow the opponent whose event it was`, () => {
      const t = turnOf(
        count,
        P3,
        TRIGGERED({
          event: "cardPlayed",
          condition: OPPONENT_PLAYS,
          targets: [{ id: "t", selector: { type: "character", controller: "opponent" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        })
      );
      t.engine.perform({ type: "playCard", playerId: P3, cardId: t.id("idle") });
      assert.equal(pending(t)?.kind, "selectTargets", "no opponent prompt first");
      refused(
        () => t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { t: [t.id("c-p2")] } } }),
        "a character of an opponent who did not play"
      );
      t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { t: [t.id("c-p3")] } } });
      resolvePendingResponses(t.engine);
      assert.equal(t.engine.state.cards[t.id("c-p3")]!.zone, "discard");
    });
  }

  rule(["MPX-trigger-condition"], "2 seats: the only opponent's play sets it off, as before", () => {
    const t = turnOf(2, P2, TRIGGERED({ event: "cardPlayed", condition: OPPONENT_PLAYS, effects: [{ type: "modifyInfluence", player: "opponent", amount: -2 }] }));
    const before = baseline(t);
    t.engine.perform({ type: "playCard", playerId: P2, cardId: t.id("idle") });
    resolvePendingResponses(t.engine);
    assert.equal(lost(t, before, P2), 2);
  });
});

describe("MPX-battle-opponent — your opponent in battle text is the other side of the battle, nobody chooses", () => {
  const ATTACK_TRIGGER = TRIGGERED({
    event: "characterAttacked",
    condition: { type: "sourceIsEventCard" },
    effects: [{ type: "modifyInfluence", player: "opponent", amount: -2 }]
  });
  const DEFEND_TRIGGER = TRIGGERED({
    event: "battleStarted",
    condition: { type: "battleRole", role: "defender" },
    effects: [{ type: "modifyInfluence", player: "opponent", amount: -2 }]
  });
  for (const count of TABLES) {
    rule(["MPX-battle-opponent"], `${count} seats: when the controller attacks, the defending player is the opponent`, () => {
      const seats = seatsFor(count);
      const built = buildGame({
        ...plainSeats(count),
        cards: [
          { key: "raider", def: character({ name: "Raider", strength: 0, behavior: ATTACK_TRIGGER }), owner: P1 },
          ...seats.map(owner => ({ key: `c-${owner}`, def: character({ name: `Char ${owner}`, strength: 0 }), owner }))
        ]
      });
      const t: Table = { engine: built.engine, id: built.id, seats };
      const before = baseline(t);
      t.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [t.id("raider")], target: { type: "faction", playerId: P3 } });
      assert.notEqual(pending(t)?.kind, "choosePlayer", "no choice is offered");
      assert.equal(lost(t, before, P3), 2);
      for (const other of t.seats.filter(seat => seat !== P3)) assert.equal(lost(t, before, other), 0);
    });

    rule(["MPX-battle-opponent"], `${count} seats: when the controller defends, the attacking player is the opponent`, () => {
      const seats = seatsFor(count);
      const built = buildGame({
        ...plainSeats(count),
        activePlayerId: P2,
        turn: 2,
        cards: [
          { key: "guard", def: character({ name: "Guard", strength: 0, behavior: DEFEND_TRIGGER }), owner: P1 },
          ...seats.map(owner => ({ key: `c-${owner}`, def: character({ name: `Char ${owner}`, strength: 0 }), owner }))
        ]
      });
      const t: Table = { engine: built.engine, id: built.id, seats };
      const before = baseline(t);
      t.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [t.id("c-p2")], target: { type: "faction", playerId: P1 } });
      for (let guard = 0; guard < 10 && pending(t) === undefined && t.engine.state.battle && influence(t, P2) === before[P2]; guard++) resolvePendingResponses(t.engine);
      assert.equal(lost(t, before, P2), 2, "the attacker is the opponent");
      for (const other of t.seats.filter(seat => seat !== P2)) assert.equal(lost(t, before, other), 0);
    });

    rule(["MPX-battle-opponent"], `${count} seats: a tactic gated on being the attacker takes the defending player, nobody is asked`, () => {
      const seats = seatsFor(count);
      const strike = tactic({
        name: "Ambush",
        behavior: ACTIVATED({ condition: { type: "battleRole", role: "attacker" }, effects: [{ type: "modifyInfluence", player: "opponent", amount: -4 }] })
      });
      const built = buildGame({
        ...plainSeats(count),
        cards: [
          { key: "raider", def: character({ name: "Raider", strength: 0 }), owner: P1 },
          { key: "spell", def: strike, owner: P1, zone: "hand" },
          ...seats.map(owner => ({ key: `c-${owner}`, def: character({ name: `Char ${owner}`, strength: 0 }), owner }))
        ]
      });
      const t: Table = { engine: built.engine, id: built.id, seats };
      t.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [t.id("raider")], target: { type: "faction", playerId: P2 } });
      const before = baseline(t);
      assert.deepEqual(t.engine.getPlayRequirements(play(t) as never), []);
      t.engine.perform(play(t));
      resolvePendingResponses(t.engine);
      assert.equal(lost(t, before, P2), 4);
      for (const other of t.seats.filter(seat => seat !== P2)) assert.equal(lost(t, before, other), 0);
    });
  }
});

describe("MPX-respond / MPX-select — \"your opponent cannot respond to this card\"", () => {
  const SWINDLE = (rule: true | "opponent") =>
    ({ abilities: [{ id: "go", type: "activated", effects: [{ type: "modifyInfluence", player: "opponent", amount: -3 }] }], noResponse: rule }) as CardDefinition["behavior"];

  /** Everyone who is given priority after the play, in order, until the card has resolved. */
  function priorities(t: Table, opponent: PlayerId | undefined): PlayerId[] {
    t.engine.perform(play(t, opponent ? { players: { opponent } } : {}));
    const given: PlayerId[] = [];
    for (let guard = 0; guard < 12 && t.engine.state.responseWindow?.phase === "acceptingResponses"; guard++) {
      const who = t.engine.state.responseWindow.priorityPlayerId;
      given.push(who);
      t.engine.perform({ type: "passPriority", playerId: who });
    }
    resolvePendingResponses(t.engine);
    return given;
  }

  for (const count of TABLES) {
    rule(["MPX-respond", "MPX-select"], `${count} seats: only the block's opponent may not respond; every other player may`, () => {
      const t = board(count, tactic({ name: "Swindle", behavior: SWINDLE("opponent") }));
      const before = baseline(t);
      const given = priorities(t, P2);
      assert.deepEqual(given, t.seats.slice(2), "P2 is never offered it; the rest are, clockwise");
      assert.equal(lost(t, before, P2), 3);
    });

    rule(["MPX-respond", "MPX-select"], `${count} seats: with another opponent selected, the first seat may respond`, () => {
      const t = board(count, tactic({ name: "Swindle", behavior: SWINDLE("opponent") }));
      const given = priorities(t, P3);
      assert.deepEqual(given, t.seats.slice(1).filter(seat => seat !== P3));
    });

    rule(["MPX-respond"], `${count} seats: noResponse true lets nobody respond`, () => {
      const t = board(count, tactic({ name: "Swindle", behavior: SWINDLE(true) }));
      const before = baseline(t);
      const given = priorities(t, P2);
      assert.deepEqual(given, []);
      assert.equal(lost(t, before, P2), 3);
    });
  }

  rule(["MPX-respond"], "2 seats: with one opponent \"your opponent cannot respond\" means nobody can respond", () => {
    const t = board(2, tactic({ name: "Swindle", behavior: SWINDLE("opponent") }));
    const before = baseline(t);
    assert.deepEqual(priorities(t, undefined), []);
    assert.equal(lost(t, before, P2), 3);
  });
});

describe("MPQ-P3 — a replacement selects its opponent at the moment it applies", () => {
  const LUCKY = {
    abilities: [{ id: "luck", type: "replacement", replaces: { event: "destroy" }, effects: [{ type: "modifyInfluence", player: "opponent", amount: -2 }] }]
  } as CardDefinition["behavior"];
  const KILL = tactic({ name: "Kill", behavior: ACTIVATED({ targets: [{ id: "t", selector: { type: "character", name: "Lucky" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }) });
  for (const count of TABLES) {
    rule(["MPX-select", "MP 2"], `${count} seats: the replacement's controller is asked when it applies, then it applies with that opponent`, () => {
      const t = board(count, KILL, [{ key: "lucky", def: character({ name: "Lucky", behavior: LUCKY }), owner: P2 }]);
      const before = baseline(t);
      t.engine.perform(play(t, { selected: { t: [t.id("lucky")] } }));
      resolvePendingResponses(t.engine);
      assert.equal(pending(t)?.kind, "choosePlayer");
      assert.equal(pending(t)?.playerId, P2, "the replacement's controller selects");
      assert.deepEqual((pending(t) as { candidates: string[] }).candidates, [P3, ...(count === 4 ? [P4] : []), P1]);
      answerPlayer(t, P2, P1);
      resolvePendingResponses(t.engine);
      assert.equal(t.engine.state.cards[t.id("lucky")]!.zone, "play", "the destruction was replaced");
      assert.equal(lost(t, before, P1), 2);
      for (const other of t.seats.slice(1)) assert.equal(lost(t, before, other), 0);
    });
  }
  rule(["MPX-select"], "2 seats: a replacement's only opponent is the opponent and nobody is asked", () => {
    const t = board(2, KILL, [{ key: "lucky", def: character({ name: "Lucky", behavior: LUCKY }), owner: P2 }]);
    const before = baseline(t);
    t.engine.perform(play(t, { selected: { t: [t.id("lucky")] } }));
    resolvePendingResponses(t.engine);
    assert.equal(pending(t), undefined);
    assert.equal(lost(t, before, P1), 2);
  });
});

describe("MPX-offer — any opponent / any player may pay (MPQ-P7)", () => {
  const OFFER = (offerTo: "opponents" | "players" | undefined) =>
    ACTIVATED({
      effects: [
        {
          type: "anyPlayerMayPay",
          ...(offerTo ? { offerTo } : {}),
          costs: [{ type: "payResources", amount: 1 }],
          effects: [{ type: "modifyInfluence", player: "controller", amount: 3 }],
          elseEffects: [{ type: "modifyInfluence", player: "controller", amount: 5 }]
        }
      ]
    });

  /** The board with a resource in play for every seat. */
  const offerBoard = (count: number, offerTo: "opponents" | "players" | undefined): Table =>
    board(
      count,
      tactic({ name: "Offer", behavior: OFFER(offerTo) }),
      seatsFor(count)
        .slice(1)
        .map(owner => ({ key: `pay-${owner}`, def: resourceCard({ name: `Pay ${owner}` }), owner }))
    );

  /** Answers every offer with `pays` (who pays; everybody else declines) and returns who was offered it, in order. */
  function offered(t: Table, pays: PlayerId | undefined): PlayerId[] {
    t.engine.perform(play(t));
    const asked: PlayerId[] = [];
    for (let guard = 0; guard < 12; guard++) {
      resolvePendingResponses(t.engine);
      const choice = t.engine.state.pendingChoice;
      if (!choice) break;
      assert.equal(choice.kind, "anyPlayerMayPay");
      asked.push(choice.playerId);
      t.engine.perform({ type: "resolvePendingChoice", playerId: choice.playerId, choice: { kind: "anyPlayerMayPay", pay: choice.playerId === pays } });
    }
    return asked;
  }

  for (const count of TABLES) {
    rule(["MPX-offer"], `${count} seats: "any opponent may pay" goes clockwise from the seat after the controller, and the first to pay settles it`, () => {
      const t = offerBoard(count, "opponents");
      const before = baseline(t);
      const asked = offered(t, P3);
      assert.deepEqual(asked, [P2, P3], "nobody after the payer is offered it");
      assert.equal(lost(t, before, P3), -3, "they: the player who paid");
      assert.equal(lost(t, before, P1), 0, "no Otherwise");
    });

    rule(["MPX-offer"], `${count} seats: if every opponent declines, Otherwise happens, and the controller is never offered it`, () => {
      const t = offerBoard(count, "opponents");
      const before = baseline(t);
      const asked = offered(t, undefined);
      assert.deepEqual(asked, t.seats.slice(1));
      assert.equal(lost(t, before, P1), -5);
      for (const other of t.seats.slice(1)) assert.equal(lost(t, before, other), 0);
    });

    rule(["MPX-offer"], `${count} seats: "any player may pay" starts with the active player (the controller included) and goes clockwise`, () => {
      const t = offerBoard(count, undefined);
      assert.deepEqual(offered(t, undefined), t.seats);
    });

    rule(["MPX-offer"], `${count} seats: only players still in the game are offered it`, () => {
      const t = offerBoard(count, "opponents");
      t.engine.state.players[P2]!.eliminated = { turn: 1 };
      assert.deepEqual(offered(t, undefined), t.seats.slice(2));
    });
  }

  rule(["MPX-offer"], "2 seats: the one opponent is offered it, then Otherwise", () => {
    const t = offerBoard(2, "opponents");
    const before = baseline(t);
    assert.deepEqual(offered(t, undefined), [P2]);
    assert.equal(lost(t, before, P1), -5);
  });
});

describe("MPX-other-pov — text from another player's point of view (MPQ-P10)", () => {
  /** "At the start of each player's turn: both players lose 1": the acting player and one of their own opponents. */
  const COMMUNION = TRIGGERED({
    event: "turnStarted",
    opponentFrom: "acting",
    effects: [{ type: "forEachPlayer", players: "pair", effects: [{ type: "modifyInfluence", player: "controller", amount: -1 }] }]
  });

  for (const count of TABLES) {
    rule(["MPX-other-pov"], `${count} seats: the acting player selects one of their own opponents, and "both players" is the acting player plus that selection`, () => {
      const t = board(count, item({ name: "Communion", behavior: COMMUNION }));
      intoPlay(t);
      const before = baseline(t);
      t.engine.perform({ type: "endTurn", playerId: P1 });
      resolvePendingResponses(t.engine);
      settleTurnStart(t.engine);
      assert.equal(t.engine.state.activePlayerId, P2);
      assert.equal(pending(t)?.kind, "choosePlayer");
      assert.equal(pending(t)?.playerId, P2, "the acting player, not the card's controller");
      assert.deepEqual((pending(t) as { candidates: string[] }).candidates, [P3, ...(count === 4 ? [P4] : []), P1]);
      answerPlayer(t, P2, P3);
      resolvePendingResponses(t.engine);
      settleTurnStart(t.engine);
      assert.equal(lost(t, before, P2), 1);
      assert.equal(lost(t, before, P3), 1);
      for (const other of t.seats.filter(seat => seat !== P2 && seat !== P3)) assert.equal(lost(t, before, other), 0, "the card's controller is not one of the two unless selected");
    });
  }

  rule(["MPX-other-pov"], "2 seats: the acting player's only opponent is selected for them, nobody is asked", () => {
    const t = board(2, item({ name: "Communion", behavior: COMMUNION }));
    intoPlay(t);
    const before = baseline(t);
    t.engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(t.engine);
    settleTurnStart(t.engine);
    assert.equal(pending(t), undefined);
    assert.equal(lost(t, before, P2), 1);
    assert.equal(lost(t, before, P1), 1);
  });
});

describe("MPX-hidden (2) — as though you were your opponent: the block's selected opponent, and only what you know", () => {
  /** "You may use abilities on your opponent's cards (as though you were your opponent)." */
  const BILLIONAIRE = {
    abilities: [{ id: "borrow", type: "continuous", modifiers: [], canUseOpponentAbilities: "asOpponent" }]
  } as CardDefinition["behavior"];
  /** "Your opponent's hand is revealed at all times." */
  const SEER = {
    abilities: [{ id: "see", type: "continuous", modifiers: [], grantsReveal: { of: "opponent", zone: "hand" } }]
  } as CardDefinition["behavior"];
  /** A character whose ability costs a discard from its controller's hand. */
  const TOLL = character({
    name: "Toll",
    behavior: ACTIVATED({
      costs: [{ type: "discard", id: "d", player: "controller", selector: { zone: "hand" }, count: 1 }],
      effects: []
    })
  });

  const setup = (count: number): Table =>
    board(count, character({ name: "Billionaire", behavior: BILLIONAIRE }), [
      { key: "seer", def: character({ name: "Seer", behavior: SEER }), owner: P1, zone: "hand" },
      ...seatsFor(count).slice(1).flatMap(owner => [
        { key: `toll-${owner}`, def: TOLL, owner },
        { key: `hand-${owner}`, def: tactic({ name: `Hand ${owner}` }), owner, zone: "hand" as const }
      ])
    ]);

  const borrowable = (t: Table, who: PlayerId) =>
    t.engine
      .getActivatedAbilityStatuses(P1)
      .filter(entry => entry.cardId === t.id(`toll-${who}`))
      .map(entry => entry.available);

  for (const count of TABLES) {
    rule(["MPX-hidden", "MPX-lasting"], `${count} seats: only the selected opponent's abilities may be used, and only while their hand is revealed to you`, () => {
      const t = setup(count);
      t.engine.perform(play(t));
      resolvePendingResponses(t.engine);
      answerPlayer(t, P1, P3);
      assert.deepEqual(borrowable(t, P2), [], "another opponent's cards are not the selected opponent's");
      assert.deepEqual(borrowable(t, P3), [false], "their hand is not revealed to you: the discard cannot be made");
      // A hand revealed by an effect on a different opponent does not count.
      t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("seer") });
      resolvePendingResponses(t.engine);
      answerPlayer(t, P1, P2);
      assert.deepEqual(borrowable(t, P3), [false], "P2's revealed hand does not help with P3's");
    });

    rule(["MPX-hidden"], `${count} seats: with the selected opponent's hand revealed the discard can be made`, () => {
      const t = setup(count);
      t.engine.perform(play(t));
      resolvePendingResponses(t.engine);
      answerPlayer(t, P1, P3);
      t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("seer") });
      resolvePendingResponses(t.engine);
      answerPlayer(t, P1, P3);
      assert.deepEqual(borrowable(t, P3), [true]);
    });
  }
});

// ---------------------------------------------------------------------------
// Real catalog cards whose spec entries are `edit: false` (data/card-tests/mp-spec/*.json, status "unchanged"): the
// stored data keeps its "opponent" and the engine binds it. Each asserts its entry's test3 text at 3 seats.
// ---------------------------------------------------------------------------

const realCard = (name: string, set: string): CardDefinition => {
  const found = (cardsJson as CardDefinition[]).find(card => card.name === name && card.set === set);
  assert.ok(found, `${name} (${set}) is in the catalog`);
  return found;
};

describe("catalog cards at 3 seats — Dragon Tank (MPQ-P8 does not apply: MP 2 at the start of the controller's turn)", () => {
  const tank = realCard("Dragon Tank", "1st Edition");
  /** P3's turn ends and P1's starts: the trigger fires and P1 is asked. P2 owns two characters, P3 one. */
  function startOfP1Turn() {
    const seats = [P1, P2, P3];
    const built = buildGame({
      ...plainSeats(3),
      activePlayerId: P3,
      turn: 3,
      cards: [
        { key: "tank", def: tank, owner: P1 },
        { key: "a-p2", def: character({ name: "A2" }), owner: P2 },
        { key: "b-p2", def: character({ name: "B2" }), owner: P2 },
        { key: "a-p3", def: character({ name: "A3" }), owner: P3 }
      ]
    });
    const t: Table = { engine: built.engine, id: built.id, seats };
    t.engine.perform({ type: "endTurn", playerId: P3 });
    resolvePendingResponses(t.engine);
    settleTurnStart(t.engine);
    return t;
  }

  rule(["MPX-select", "MP 2"], "Dragon Tank: P1 chooses P2 or P3 when the trigger resolves, then may destroy only a character of the chosen one", () => {
    const t = startOfP1Turn();
    assert.equal(t.engine.state.activePlayerId, P1);
    assert.equal(pending(t)?.kind, "choosePlayer");
    assert.equal(pending(t)?.playerId, P1);
    assert.deepEqual((pending(t) as { candidates: string[] }).candidates, [P2, P3]);
    answerPlayer(t, P1, P2);
    assert.equal(pending(t)?.kind, "chooserSelectsTarget");
    refused(
      () => t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [t.id("a-p3")] } }),
      "a character of the opponent who was not chosen"
    );
    t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [t.id("a-p2")] } });
    resolvePendingResponses(t.engine);
    assert.equal(t.engine.state.cards[t.id("a-p2")]!.zone, "discard");
    assert.equal(t.engine.state.cards[t.id("a-p3")]!.zone, "play");
    assert.equal(t.engine.state.cards[t.id("tank")]!.zone, "play");
  });

  rule(["MPX-select", "MP 2"], "Dragon Tank: the choice is made first, so choosing an opponent with no character destroys the Tank", () => {
    const t = startOfP1Turn();
    t.engine.state.players[P2]!.play.forEach(id => (t.engine.state.cards[id]!.zone = "discard"));
    t.engine.state.players[P2]!.play = [];
    answerPlayer(t, P1, P2);
    resolvePendingResponses(t.engine);
    assert.equal(t.engine.state.cards[t.id("tank")]!.zone, "discard");
    assert.equal(t.engine.state.cards[t.id("a-p3")]!.zone, "play");
  });
});

describe("catalog cards at 3 seats — Lugubrian Octopod (MPQ-P8): your opponent is the other side of the battle", () => {
  const octopod = realCard("Lugubrian Octopod", "1st Edition");
  for (const target of [P2, P3]) {
    rule(["MPX-battle-opponent"], `Lugubrian Octopod: attacking ${target}'s faction, ${target} discards 2 cards and nobody is asked to choose an opponent`, () => {
      const seats = [P1, P2, P3];
      const hand = (owner: PlayerId) => [0, 1, 2].map(i => ({ key: `h${i}-${owner}`, def: tactic({ name: `Hand ${owner} ${i}` }), owner, zone: "hand" as const }));
      const built = buildGame({
        ...plainSeats(3),
        cards: [{ key: "octopod", def: octopod, owner: P1 }, ...hand(P2), ...hand(P3)]
      });
      const t: Table = { engine: built.engine, id: built.id, seats };
      t.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [t.id("octopod")], target: { type: "faction", playerId: target } });
      let chooser: PlayerId | undefined;
      for (let guard = 0; guard < 40 && t.engine.state.battle; guard++) {
        const choice = t.engine.state.pendingChoice;
        if (choice) {
          assert.notEqual(choice.kind, "choosePlayer", "P1 is never asked for an opponent");
          if (choice.kind === "chooserSelectsTarget") {
            chooser = choice.playerId;
            const own = t.engine.state.players[choice.playerId]!.hand;
            t.engine.perform({ type: "resolvePendingChoice", playerId: choice.playerId, choice: { kind: "chooserSelectsTarget", selected: own.slice(0, 2) } });
          }
          continue;
        }
        if (t.engine.state.responseWindow) {
          resolvePendingResponses(t.engine);
          continue;
        }
        const battle = t.engine.state.battle;
        if (battle.phase === "blocking") {
          t.engine.perform({ type: "declareBlockers", playerId: battle.defenderPlayerId, blockerIds: [] });
          continue;
        }
        const view = t.engine.getBattleView();
        if (view?.actingPlayerId) {
          t.engine.perform({
            type: "assignBattleDamage",
            playerId: view.actingPlayerId,
            assignments: view.damageSources
              .filter(source => source.strength > 0 && source.legalTargets.length > 0)
              .map(source => ({ sourceId: source.cardId, target: source.legalTargets[0]!, amount: source.strength }))
          });
        } else {
          t.engine.perform({ type: "advanceFlow" });
        }
      }
      assert.equal(chooser, target, "the defending player chooses");
      assert.equal(t.engine.state.players[target]!.hand.length, 1, "two of three discarded");
      const other = target === P2 ? P3 : P2;
      assert.equal(t.engine.state.players[other]!.hand.length, 3, "the other opponent discards nothing");
    });
  }
});

describe("catalog cards at 3 seats — Slingerang (MPQ-P5): any opponent's play sets it off and that opponent is the block's opponent", () => {
  const slingerang = realCard("Slingerang", "1st Edition");
  for (const actor of [P2, P3]) {
    rule(["MPX-trigger-condition"], `Slingerang: ${actor} playing a card sets it off; nobody is asked which opponent`, () => {
      const seats = [P1, P2, P3];
      const built = buildGame({
        ...plainSeats(3),
        activePlayerId: actor,
        turn: seats.indexOf(actor) + 1,
        cards: [
          { key: "sling", def: slingerang, owner: P1 },
          { key: "idle", def: character({ name: "Idle Character", cost: 0 }), owner: actor, zone: "hand" },
          { key: "c-p2", def: character({ name: "C2" }), owner: P2 },
          { key: "c-p3", def: character({ name: "C3" }), owner: P3 }
        ]
      });
      const t: Table = { engine: built.engine, id: built.id, seats };
      t.engine.perform({ type: "playCard", playerId: actor, cardId: t.id("idle") });
      const choice = pending(t);
      assert.notEqual(choice?.kind, "choosePlayer", "no opponent selection is offered");
      assert.ok(choice === undefined || choice.playerId === P1, "if Slingerang asks anything it asks its controller");
    });
  }
});
