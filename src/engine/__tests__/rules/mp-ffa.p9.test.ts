// Multiplayer (free-for-all) rules, part 9: the two-player assumptions that were left in the engine.
// Atoms: data/rule-tests/source/multiplayer.txt (batch mp-ffa): MPX-knitting (PULLING STRINGS), MPX-lasting and
// MPX-turn ("until the start of your opponent's next turn"), MPX-swap (Emergency Obfuscation), MPX-setup and
// MPX-select (The Union's starting-resource opponent is covered in mp-ffa.p4), MPX-seat.
// Every behavior is tested at 3 and at 4 seats, with the selected opponent affected and the others not.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, PlayerId } from "../../../engine.js";
import { buildGame, character, defaultFactionDefinition, factionCard, item, P1, P2, P3, P4, resolvePendingResponses, tactic } from "../support/fixtures.js";
import { rule } from "./_rule.js";
import { ACTIVATED, answerPlayer, board, pending, play, seatsFor, TABLES, type Table } from "./_mpTable.js";

const knitting = () => factionCard({ name: "Knitting", faction: defaultFactionDefinition({ overridesOpponent: { suppressDevelop: true } }) });
const DRAW = [{ type: "draw", count: 1 }];

describe("MPX-knitting — PULLING STRINGS applies to every opponent of the Coalition", () => {
  const table = (count: number) =>
    buildGame({ playerB: { faction: knitting() }, extraPlayers: Array.from({ length: count - 2 }, () => ({})) }).engine;

  for (const count of TABLES) {
    rule(["MPX-knitting"], `${count} seats: every other player ignores their Develop Rule, the Coalition's own is untouched`, () => {
      const engine = table(count);
      assert.deepEqual(engine.getDevelopChoices(P2), DRAW, "the Coalition keeps its own");
      for (const other of seatsFor(count).filter(seat => seat !== P2)) {
        assert.deepEqual(engine.getDevelopChoices(other), [], `${other} ignores its faction's DEVELOP RULE`);
      }
    });

    rule(["MPX-knitting", "MPX-elim"], `${count} seats: once the Coalition's holder has lost, nobody ignores their Develop Rule any more`, () => {
      const engine = table(count);
      engine.state.players[P2]!.eliminated = { turn: 1 };
      for (const other of seatsFor(count).filter(seat => seat !== P2)) {
        assert.deepEqual(engine.getDevelopChoices(other), DRAW, `${other} has its Develop Rule back`);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// "At the start of your opponent's next turn" (Final Countdown): the selected opponent's next turn.
// ---------------------------------------------------------------------------

const COUNTDOWN = tactic({
  name: "Countdown",
  behavior: ACTIVATED({
    effects: [
      {
        type: "scheduleEffect",
        when: "startOfOpponentNextTurn",
        effects: [{ type: "modifyInfluence", player: "controller", amount: 2 }]
      }
    ]
  })
});

const FINISH = (who: PlayerId) =>
  tactic({ name: `Finish ${who}`, behavior: ACTIVATED({ effects: [{ type: "modifyInfluence", player: { type: "player", id: who }, amount: -99 }] }) });

const endTurn = (t: Table): void => {
  t.engine.perform({ type: "endTurn", playerId: t.engine.state.activePlayerId });
  resolvePendingResponses(t.engine);
};
const influenceOf = (t: Table, who: PlayerId): number => t.engine.state.players[who]!.influence;

/** P1 plays the Countdown choosing `opponent`; returns the table and P1's influence before the delayed effect. */
function countdown(count: number, opponent: PlayerId, extra: Parameters<typeof board>[2] = []): { t: Table; start: number } {
  const t = board(count, COUNTDOWN, extra);
  t.engine.perform(play(t, { players: { opponent } }));
  resolvePendingResponses(t.engine);
  return { t, start: influenceOf(t, P1) };
}

describe("MPX-lasting / MPX-turn — a delayed effect waits for the selected opponent's own next turn", () => {
  for (const count of TABLES) {
    for (const chosen of seatsFor(count).slice(1)) {
      rule(["MPX-lasting", "MPX-turn", "MPX-select"], `${count} seats: choosing ${chosen}, it fires at the start of ${chosen}'s turn and at no other opponent's`, () => {
        const { t, start } = countdown(count, chosen);
        for (const seat of seatsFor(count).slice(1)) {
          endTurn(t);
          assert.equal(t.engine.state.activePlayerId, seat);
          assert.equal(influenceOf(t, P1), seat === chosen ? start + 2 : start, `${seat}'s turn started`);
          if (seat === chosen) break;
        }
        for (let i = 0; i < count; i++) endTurn(t);
        assert.equal(influenceOf(t, P1), start + 2, "it fires once and is gone");
      });
    }

    rule(["MPX-lasting", "MPX-select"], `${count} seats: the delayed effect is listed and logged under the selected opponent's name and turn`, () => {
      const chosen = seatsFor(count)[count - 1]!;
      const { t } = countdown(count, chosen);
      const [waiting] = t.engine.getPendingDelayedEffects(P1);
      const name = t.engine.state.players[chosen]!.name;
      assert.ok(waiting!.text.includes(`the start of ${name}'s next turn`), waiting!.text);
      assert.equal(waiting!.turn, t.engine.state.turn + count - 1, "the chosen opponent's first turn after this one");
      assert.ok(
        t.engine.getLog().some(entry => entry.message.includes(`delayed effect for the start of ${name}'s next turn`)),
        "the log line names the same player"
      );
    });

    rule(["MPX-lasting", "MPX-elim"], `${count} seats: when the selected opponent has lost, the controller selects again and the effect waits for the new opponent`, () => {
      const t = board(count, COUNTDOWN, [{ key: "finish", def: FINISH(P3), owner: P1, zone: "hand" }]);
      t.engine.perform(play(t, { players: { opponent: P3 } }));
      resolvePendingResponses(t.engine);
      const start = influenceOf(t, P1);
      t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("finish") });
      resolvePendingResponses(t.engine);
      assert.equal(t.engine.state.players[P3]!.eliminated !== undefined, true);
      if (count === 4) {
        assert.equal(pending(t)?.kind, "choosePlayer");
        assert.deepEqual((pending(t) as { candidates: string[] }).candidates, [P2, P4]);
        answerPlayer(t, P1, P4);
      } else {
        assert.equal(pending(t), undefined, "one opponent left: nobody is asked");
      }
      const expected = count === 4 ? P4 : P2;
      const [waiting] = t.engine.getPendingDelayedEffects(P1);
      assert.ok(waiting!.text.includes(t.engine.state.players[expected]!.name), "the listed delayed effect names the new opponent");
      for (let i = 0; i < count; i++) {
        endTurn(t);
        const fired = influenceOf(t, P1) === start + 2;
        assert.equal(fired, t.engine.state.activePlayerId === expected || (fired && i > 0), `after turn pass ${i + 1}`);
        if (fired) break;
      }
      assert.equal(influenceOf(t, P1), start + 2);
      assert.equal(t.engine.state.activePlayerId, expected, "it fired at the new opponent's turn, and the eliminated seat never had one");
      if (count === 4) assert.equal(t.engine.state.turn, 3, "P2, then P4 (P3 is skipped)");
    });
  }

  rule(["MPX-lasting", "MPX-turn"], "2 seats: nobody is asked and it fires at the start of the opponent's next turn", () => {
    const t = board(2, COUNTDOWN);
    t.engine.perform(play(t));
    resolvePendingResponses(t.engine);
    assert.equal(pending(t), undefined);
    const start = influenceOf(t, P1);
    endTurn(t);
    assert.equal(t.engine.state.activePlayerId, P2);
    assert.equal(influenceOf(t, P1), start + 2);
  });
});

// ---------------------------------------------------------------------------
// Emergency Obfuscation: "both players switch seats", the controller and the selected opponent only.
// ---------------------------------------------------------------------------

const OBFUSCATION = item({
  name: "Obfuscation",
  cost: 0,
  behavior: { abilities: [{ id: "swap", type: "continuous", modifiers: [], swapsSides: true }] }
});

const SMASH = tactic({
  name: "Smash",
  behavior: ACTIVATED({
    targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }],
    effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
  })
});

const SIDE_TAKER = tactic({
  name: "Side Taker",
  behavior: ACTIVATED({ effects: [{ type: "modifyInfluence", player: "controller", amount: -99 }] })
});

/** P1 plays the Obfuscation and answers the opponent prompt with `chosen`. */
function swapped(count: number, chosen: PlayerId, extra: Parameters<typeof board>[2] = []): Table {
  const t = board(count, OBFUSCATION, [
    { key: "smash", def: SMASH, owner: P1, zone: "hand" },
    { key: "taker", def: SIDE_TAKER, owner: P1, zone: "hand" },
    ...extra
  ]);
  t.engine.perform(play(t));
  resolvePendingResponses(t.engine);
  assert.equal(pending(t)?.kind, "choosePlayer");
  assert.equal(pending(t)?.playerId, P1);
  assert.deepEqual((pending(t) as { candidates: string[] }).candidates, seatsFor(count).slice(1), "every other player is offered");
  answerPlayer(t, P1, chosen);
  return t;
}

const controllerOf = (t: Table, key: string): PlayerId => t.engine.state.cards[t.id(key)]!.controllerId;
const factionOwner = (t: Table, who: PlayerId): PlayerId => t.engine.state.cards[t.engine.state.players[who]!.factionId!]!.ownerId;

describe("MPX-swap — the controller and the selected opponent switch seats and sides, and nobody else", () => {
  for (const count of TABLES) {
    for (const chosen of seatsFor(count).slice(1)) {
      rule(["MPX-swap", "MP 3"], `${count} seats: choosing ${chosen}, P1 and ${chosen} exchange sides; every other player keeps theirs`, () => {
        const t = swapped(count, chosen);
        for (const seat of seatsFor(count)) {
          const swappedSeat = seat === P1 || seat === chosen;
          const partner = seat === P1 ? chosen : P1;
          assert.equal(controllerOf(t, `c-${seat}`), swappedSeat ? partner : seat, `${seat}'s character`);
          assert.equal(factionOwner(t, seat), swappedSeat ? partner : seat, `the faction ${seat} holds`);
        }
        assert.equal(controllerOf(t, "spell"), chosen, "the card itself is on the side it was played to, so it passes with it");
      });

      rule(["MPX-swap", "MPX-seat", "MPX-turn"], `${count} seats: the two exchange places in the seat order and the turn order follows`, () => {
        const t = swapped(count, chosen);
        const expected = seatsFor(count).map(seat => (seat === P1 ? chosen : seat === chosen ? P1 : seat));
        assert.deepEqual(t.engine.getSeats(), expected, "only the two entries are exchanged");
        endTurn(t);
        const after = expected[(expected.indexOf(P1) + 1) % count]!;
        assert.equal(t.engine.state.activePlayerId, after, "the turn goes to the seat after P1's new place");
      });

      rule(["MPX-swap"], `${count} seats: when the card leaves play the two switch back, seats and control`, () => {
        const t = swapped(count, chosen);
        t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("smash"), selected: { t: [t.id("spell")] } });
        resolvePendingResponses(t.engine);
        assert.equal(t.engine.state.seatSwap, undefined);
        assert.deepEqual(t.engine.getSeats(), seatsFor(count));
        for (const seat of seatsFor(count)) {
          assert.equal(controllerOf(t, `c-${seat}`), seat);
          assert.equal(factionOwner(t, seat), seat);
        }
      });
    }

    rule(["MPX-swap", "MPX-elim", "MPX-lasting"], `${count} seats: when the selected opponent has lost, the swap with them ends and the controller selects again`, () => {
      const t = swapped(count, P2);
      // P1 now holds P2's faction: taking it to 0 makes its owner, P2, lose.
      t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("taker") });
      resolvePendingResponses(t.engine);
      assert.equal(t.engine.state.players[P2]!.eliminated !== undefined, true, "P2 owned the faction that reached 0");
      assert.equal(t.engine.state.players[P1]!.eliminated, undefined);
      const others = seatsFor(count).filter(seat => seat !== P1 && seat !== P2);
      if (others.length === 1) {
        assert.equal(pending(t), undefined, "one opponent left: the swap moves to them without asking");
      } else {
        assert.equal(pending(t)?.kind, "choosePlayer");
        assert.deepEqual((pending(t) as { candidates: string[] }).candidates, others);
        answerPlayer(t, P1, P4);
      }
      const now = others.length === 1 ? others[0]! : P4;
      assert.equal(controllerOf(t, `c-${P1}`), now, "P1's side now sits with the new opponent");
      assert.equal(controllerOf(t, `c-${now}`), P1);
      assert.equal(factionOwner(t, P1), now, "P1 holds the new opponent's faction, not the one it held before");
      assert.equal(factionOwner(t, now), P1);
      for (const seat of others.filter(seat => seat !== now)) assert.equal(controllerOf(t, `c-${seat}`), seat, `${seat} is untouched`);
    });

    rule(["MPX-swap", "MPX-lasting"], `${count} seats: two copies naming the same opponent cancel each other`, () => {
      const t = swapped(count, P2, [{ key: "second", def: OBFUSCATION, owner: P1, zone: "hand" }]);
      t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("second") });
      resolvePendingResponses(t.engine);
      assert.equal(pending(t)?.kind, "choosePlayer");
      answerPlayer(t, P1, P2);
      assert.equal(t.engine.state.seatSwap, undefined, "the same pair twice is no swap");
      assert.deepEqual(t.engine.getSeats(), seatsFor(count));
      for (const seat of seatsFor(count)) assert.equal(controllerOf(t, `c-${seat}`), seat);
    });
  }
});

// ---------------------------------------------------------------------------
// The singular "your opponent" forms of three continuous-text fields: the block's selected opponent, not every
// opponent (MPX-lasting, MPX-select).
// ---------------------------------------------------------------------------

/** P1 plays `spell` (a permanent with lasting "your opponent" text), selects `chosen`, and the table is returned. */
function selected(count: number, spell: CardDefinition, chosen: PlayerId, extra: Parameters<typeof board>[2] = []): Table {
  const t = board(count, spell, extra);
  t.engine.perform(play(t));
  resolvePendingResponses(t.engine);
  assert.equal(pending(t)?.kind, "choosePlayer");
  answerPlayer(t, P1, chosen);
  assert.equal(pending(t), undefined);
  return t;
}

/** Passes every turn from P1's on and reports `read` for each opponent on the turn it holds. */
function onEachOpponentTurn<T>(t: Table, read: (seat: PlayerId) => T): Record<PlayerId, T> {
  const out: Record<PlayerId, T> = {};
  for (const seat of t.seats.slice(1)) {
    endTurn(t);
    assert.equal(t.engine.state.activePlayerId, seat);
    out[seat] = read(seat);
  }
  return out;
}

const withBehavior = (base: CardDefinition, behavior: unknown): CardDefinition => ({ ...base, behavior } as CardDefinition);

describe('MPX-lasting — singular "your opponent" in a restriction, a cost modifier and an attack bar', () => {
  for (const count of TABLES) {
    for (const chosen of seatsFor(count).slice(1)) {
      rule(["MPX-lasting", "MPX-select"], `${count} seats: choosing ${chosen}, "your opponent cannot pick this card" bars ${chosen} and no other player`, () => {
        const artist = withBehavior(character({ name: "Artist" }), {
          abilities: [{ id: "hide", type: "continuous", modifiers: [], restrictions: [{ target: "source", restriction: "cannotBePickedByOpponent" }] }]
        });
        const t = selected(count, artist, chosen);
        const artistId = t.id("spell");
        for (const picker of t.seats) {
          const pool = t.engine.targetCandidates(
            { zone: "play", type: "character" },
            { sourceId: artistId, controllerId: picker, selected: {} },
            picker
          );
          assert.equal(pool.some(card => card.id === artistId), picker !== chosen, `${picker} ${picker === chosen ? "cannot" : "can"} pick it`);
        }
      });

      rule(["MPX-lasting", "MPX-select"], `${count} seats: choosing ${chosen}, "your opponent must pay 2 to use a character's ability" taxes ${chosen} and no other opponent`, () => {
        const tax = withBehavior(item({ name: "Tax", cost: 0 }), {
          abilities: [{ id: "t", type: "continuous", modifiers: [], abilityCostModifiers: [{ scope: "chosenOpponentCharacters", delta: 2 }] }]
        });
        const workers = seatsFor(count).flatMap(seat => [
          {
            key: `worker-${seat}`,
            def: withBehavior(character({ name: `Worker ${seat}` }), {
              abilities: [{ id: "w", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }]
            }),
            owner: seat
          }
        ]);
        const t = selected(count, tax, chosen, workers);
        // Nobody but P1 owns a resource: a free ability is offered, one taxed by 2 is not.
        const offered = onEachOpponentTurn(t, seat => t.engine.getAvailableActivatedAbilities(seat).length);
        for (const seat of t.seats.slice(1)) assert.equal(offered[seat], seat === chosen ? 0 : 1, `${seat}'s ability`);
      });

      rule(["MPX-lasting", "MPX-select"], `${count} seats: choosing ${chosen}, "your opponent cannot attack your faction" bars ${chosen} and no other opponent`, () => {
        const ward = withBehavior(item({ name: "Ward", cost: 0 }), {
          abilities: [{ id: "ward", type: "continuous", modifiers: [], preventsAttackOnFaction: { player: "self", attacker: "opponent" } }]
        });
        const t = selected(count, ward, chosen);
        const canAttackP1 = onEachOpponentTurn(t, seat =>
          t.engine.getAttackOptions(seat).targets.some(target => target.type === "faction" && target.playerId === P1)
        );
        for (const seat of t.seats.slice(1)) assert.equal(canAttackP1[seat], seat !== chosen, `${seat}`);
      });
    }
  }
});
