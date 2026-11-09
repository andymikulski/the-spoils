// Multiplayer (free-for-all) rules, part 12: player choices that filter their candidates, "any opponent may pay",
// cost modifiers over every opponent, the showdown between two chosen players, playability with player choices and
// lasting records that keep a named player.
// Atoms: data/rule-tests/source/multiplayer.txt (batch mp-ffa): MPX-vocab-an, MPX-select, MPX-offer, MPX-vocab-each,
// MPX-both, MPX-an-superlative, MPX-lasting.
// Every numbered point is tested at 3 and at 4 seats, with the two-seat reduction next to it.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, PlayerId } from "../../../engine.js";
import { loadGame, saveGame } from "../../../engine.js";
import { buildGame, character, item, P1, P2, P3, P4, resolvePendingResponses, resourceCard, tactic, type CardPlacement } from "../support/fixtures.js";
import { settleTurnStart } from "../support/develop.js";
import { refused, rule } from "./_rule.js";
import { ACTIVATED, answerPlayer, baseline, board, cast, lost, pending, plainSeats, play, seatsFor, TABLES, type Table } from "./_mpTable.js";

const ALL_TABLES = [2, ...TABLES] as const;
const CANDIDATE = { type: "chosenPlayer", id: "__candidate" };
const named = (id: string) => ({ type: "chosenPlayer", id });
const resources = (owner: PlayerId, count: number, tag = "extra"): CardPlacement[] =>
  Array.from({ length: count }, (_, i) => ({ key: `${tag}-${owner}-${i}`, def: resourceCard({ name: `${tag} ${owner} ${i}` }), owner }));
const last = (count: number): PlayerId => seatsFor(count)[count - 1]!;

// ---------------------------------------------------------------------------
// A player choice offers only the candidates that meet its condition (MPX-vocab-an).
// ---------------------------------------------------------------------------

describe("choosePlayer condition — 'an opponent who lost influence this turn'", () => {
  /** "Pick an opponent whose faction lost influence this turn. They lose 3 influence." */
  const SHRIEVER = ACTIVATED({
    effects: [
      { type: "choosePlayer", id: "o", from: "opponents", condition: { type: "lostInfluenceThisTurn", player: CANDIDATE } },
      { type: "modifyInfluence", player: named("o"), amount: -3 }
    ]
  });
  const mark = (t: Table, who: PlayerId[]): void => {
    for (const seat of who) t.engine.state.influenceLostThisTurn[seat] = 1;
  };

  for (const count of ALL_TABLES) {
    rule(["MPX-vocab-an", "MPX-select"], `${count} seats: with one qualifying opponent nobody is asked and that opponent is chosen`, () => {
      const t = board(count, tactic({ name: "Shriever", behavior: SHRIEVER }));
      mark(t, [P2]);
      const before = baseline(t);
      cast(t);
      assert.equal(pending(t), undefined);
      assert.equal(lost(t, before, P2), 3);
      for (const other of t.seats.slice(2)) assert.equal(lost(t, before, other), 0);
    });

    rule(["MPX-vocab-an"], `${count} seats: with no qualifying opponent the choice cannot be made and the effects that read it do nothing`, () => {
      const t = board(count, tactic({ name: "Shriever", behavior: SHRIEVER }));
      const before = baseline(t);
      cast(t);
      assert.equal(pending(t), undefined);
      for (const seat of t.seats) assert.equal(lost(t, before, seat), 0);
    });
  }

  for (const count of TABLES) {
    rule(["MPX-vocab-an", "MPX-select"], `${count} seats: only the qualifying opponents are offered, and the controller picks among them`, () => {
      const t = board(count, tactic({ name: "Shriever", behavior: SHRIEVER }));
      const chosen = last(count);
      mark(t, [P2, chosen]);
      const before = baseline(t);
      cast(t);
      assert.equal(pending(t)?.kind, "choosePlayer");
      assert.equal(pending(t)?.playerId, P1);
      assert.deepEqual((pending(t) as { candidates: string[] }).candidates, [P2, chosen]);
      refused(() => answerPlayer(t, P1, count === 4 ? P3 : P1), "a player who does not qualify");
      answerPlayer(t, P1, chosen);
      resolvePendingResponses(t.engine);
      assert.equal(lost(t, before, chosen), 3);
      for (const other of t.seats.filter(seat => seat !== chosen)) assert.equal(lost(t, before, other), 0);
    });

    rule(["MPX-vocab-an"], `${count} seats: a player choice is not a pick, it sets off no "picked" trigger`, () => {
      const watcher = item({
        name: "Pick Watcher",
        behavior: {
          abilities: [{ id: "w", type: "triggered", event: "cardPicked", condition: { type: "sourceIsEventCard" }, effects: [{ type: "modifyInfluence", player: "controller", amount: 10 }] }]
        } as CardDefinition["behavior"]
      });
      const t = board(count, tactic({ name: "Shriever", behavior: SHRIEVER }), [{ key: "watcher", def: watcher, owner: P3 }]);
      mark(t, [P2, P3]);
      const before = baseline(t);
      cast(t);
      answerPlayer(t, P1, P3);
      resolvePendingResponses(t.engine);
      assert.equal(lost(t, before, P3), 3, "no +10 from a pick that never happened");
    });
  }
});

describe("playerChoices condition — 'pick a player that controls more resources than you'", () => {
  const MORE = {
    type: "numberCompare",
    left: { type: "count", selector: { type: "resource", controller: CANDIDATE } },
    operator: ">",
    right: { type: "count", selector: { type: "resource", controller: "self" } }
  };
  /** P1 has four resources; the others have the given counts. */
  const BLITZ = ACTIVATED({
    playerChoices: [{ id: "p", from: "players", condition: MORE }],
    effects: [{ type: "modifyInfluence", player: named("p"), amount: -2 }]
  });
  const table = (count: number, counts: Partial<Record<PlayerId, number>>): Table =>
    board(count, tactic({ name: "Blitz", behavior: BLITZ }), seatsFor(count).slice(1).flatMap(seat => resources(seat, counts[seat] ?? 0)));
  const playersStep = (t: Table) => t.engine.getPlayRequirements(play(t) as never).filter(step => step.kind === "players");

  for (const count of ALL_TABLES) {
    rule(["MPX-vocab-an", "MPX-select"], `${count} seats: a sole qualifying player is taken without asking`, () => {
      const t = table(count, { [P2]: 5, [P3]: 4, [P4]: 4 });
      assert.deepEqual(playersStep(t), []);
      const before = baseline(t);
      cast(t);
      assert.equal(lost(t, before, P2), 2);
      for (const other of t.seats.filter(seat => seat !== P2)) assert.equal(lost(t, before, other), 0);
    });

    rule(["MPX-vocab-an"], `${count} seats: when no player qualifies the choice cannot be made: the card is not playable and the play is refused`, () => {
      const none = table(count, { [P2]: 4, [P3]: 4, [P4]: 4 });
      assert.equal(none.engine.getCardPlayability(P1, none.id("spell")).playable, false);
      refused(() => none.engine.perform(play(none)), "no player controls more resources", /no player meets the condition/);
      const some = table(count, { [P2]: 5, [P3]: 4, [P4]: 4 });
      assert.equal(some.engine.getCardPlayability(P1, some.id("spell")).playable, true);
    });
  }

  rule(["MPX-vocab-an", "MPX-select"], "4 seats: two qualifying players are offered with the action; a player who does not qualify is refused", () => {
    const t = table(4, { [P2]: 5, [P3]: 4, [P4]: 6 });
    assert.deepEqual(playersStep(t), [{ kind: "players", choices: [{ id: "p", candidates: [P2, P4] }] }]);
    refused(() => t.engine.perform(play(t, { players: { p: P3 } })), "P3 controls as many resources as P1", /not one of the choices/);
    const before = baseline(t);
    cast(t, { p: P4 });
    assert.equal(lost(t, before, P4), 2);
    assert.equal(lost(t, before, P2), 0);
  });
});

// ---------------------------------------------------------------------------
// Playability reads the player choices (MPX-vocab-an).
// ---------------------------------------------------------------------------

describe("playability with player choices — a cost reduction that reads a chosen player", () => {
  /** "EXTRA COST: You may remove up to 3 cards in an opponent's discard pile from the game. Reduce this card's numeric cost by the number removed." */
  const ANNIHILATE = ACTIVATED({
    playerChoices: [{ id: "o", from: "opponents" }],
    costs: [{ type: "sacrificeSelected", disposition: "removeFromGame", declarationId: "rm" }],
    costAdjust: { type: "multiply", values: [{ type: "selectionCount", id: "rm" }, -1] },
    targets: [{ id: "rm", selector: { zone: "discard", owner: named("o") }, count: 3, optional: true }],
    effects: []
  });
  const discards = (owner: PlayerId, n: number): CardPlacement[] =>
    Array.from({ length: n }, (_, i) => ({ key: `gone-${owner}-${i}`, def: character({ name: `Gone ${owner} ${i}` }), owner, zone: "discard" as const }));
  const table = (count: number, withDiscard: PlayerId | undefined): Table =>
    board(count, tactic({ name: "Annihilate", cost: 6, behavior: ANNIHILATE }), withDiscard ? discards(withDiscard, 3) : []);

  for (const count of ALL_TABLES) {
    rule(["MPX-vocab-an"], `${count} seats: the reduction counts as available when some opponent has the cards, and not when none does`, () => {
      const t = table(count, last(count));
      const playability = t.engine.getCardPlayability(P1, t.id("spell"));
      assert.equal(playability.playable, true, "6 - 3 = 3 is within the 4 resources");
      assert.equal(playability.numericCost, 3, "the best case over the candidates");
      const empty = table(count, undefined);
      assert.equal(empty.engine.getCardPlayability(P1, empty.id("spell")).playable, false, "6 is more than the 4 resources");
    });

    rule(["MPX-vocab-an"], `${count} seats: the play itself removes the chosen opponent's cards and costs the reduced number`, () => {
      const chosen = last(count);
      const t = table(count, chosen);
      const ids = [0, 1, 2].map(i => t.id(`gone-${chosen}-${i}`));
      cast(t, { o: chosen }, { selected: { rm: ids } });
      for (const id of ids) assert.notEqual(t.engine.state.cards[id]!.zone, "discard");
    });
  }
});

// ---------------------------------------------------------------------------
// Lasting records keep the named players their data reads (MPX-lasting).
// ---------------------------------------------------------------------------

describe("lasting records keep the block's chosen player", () => {
  /** "Pick an opponent. This turn, the speed of all characters that opponent controls is reduced to 0." */
  const SLOW = ACTIVATED({
    playerChoices: [{ id: "o", from: "opponents" }],
    effects: [
      { type: "createAreaModifier", selector: { type: "character", controller: named("o") }, stat: "speed", operation: "set", value: 0, duration: { type: "untilEndOfTurn" } }
    ]
  });
  /** "Pick an opponent. At the end of this turn, they lose 3 influence." */
  const LATER = ACTIVATED({
    playerChoices: [{ id: "o", from: "opponents" }],
    effects: [{ type: "scheduleEffect", when: "endOfTurn", effects: [{ type: "modifyInfluence", player: named("o"), amount: -3 }] }]
  });
  const speeds = (t: Table) => t.seats.map(seat => t.engine.getStat(t.id(`c-${seat}`), "speed"));

  for (const count of ALL_TABLES) {
    rule(["MPX-lasting", "MPX-vocab-an"], `${count} seats: an area modifier keeps reading the chosen player after the block, and a save and load keeps it`, () => {
      const chosen = last(count);
      const t = board(count, tactic({ name: "Slow", behavior: SLOW }));
      const base = speeds(t);
      cast(t, { o: chosen });
      assert.deepEqual(t.engine.state.areaModifiers[0]!.chosenPlayers, { o: chosen });
      const expected = t.seats.map((seat, i) => (seat === chosen ? 0 : base[i]));
      assert.deepEqual(speeds(t), expected);
      const reloaded = loadGame(JSON.parse(JSON.stringify(saveGame(t.engine))), Object.values(t.engine.definitions));
      assert.deepEqual(t.seats.map(seat => reloaded.getStat(t.id(`c-${seat}`), "speed")), expected);
    });

    rule(["MPX-lasting", "MPX-vocab-an"], `${count} seats: a delayed effect keeps the chosen player and affects only them when it fires`, () => {
      const chosen = last(count);
      const built = buildGame({
        ...plainSeats(count),
        cards: [
          { key: "spell", def: tactic({ name: "Later", behavior: LATER }), owner: P1, zone: "hand" },
          ...seatsFor(count).map(owner => ({ key: `c-${owner}`, def: character({ name: `Char ${owner}` }), owner }))
        ]
      });
      const t: Table = { engine: built.engine, id: built.id, seats: seatsFor(count) };
      const before = baseline(t);
      cast(t, { o: chosen });
      assert.deepEqual(t.engine.state.scheduledEffects[0]!.chosenPlayers, { o: chosen });
      t.engine.perform({ type: "endTurn", playerId: P1 });
      resolvePendingResponses(t.engine);
      settleTurnStart(t.engine);
      assert.equal(lost(t, before, chosen), 3);
      for (const other of t.seats.filter(seat => seat !== chosen)) assert.equal(lost(t, before, other), 0);
    });
  }
});
