// Multiplayer clause tests for the 2nd Edition set (3 and 4 seats), part 3: Free Trade Agreement. Its text is written from
// the point of view of the player whose turn is starting ("that player", "their opponent", "both players"): that player
// (the acting player, MPQ-P10), not the card's controller, chooses the option and selects the one opponent.

import assert from "node:assert/strict";
import { character, resourceCard } from "../../per-card/_harness.js";
import { clause, clauseMismatch, declineAll, drain, printing } from "../_clause.js";
import { COUNTS, answerFor, others, passive, pickable, startOfTurn } from "./_seats2ndEdition.js";
import { choosePlayer, deckOf, endTurn, handOf, open, P1, P2, P3, P4, resolvePendingResponses, seatsOf, table, zoneOf, type CardPlacement, type Count, type Table } from "./_seatsSeed2ndFirstP2.js";
import type { PlayerId } from "../../../../engine.js";

const FTA = "6a09105b-8cde-488e-ae5b-89ebc81beade";

// =================================================================================
// Free Trade Agreement
// At the start of each player's turn, that player chooses one of the following:
// OPTION 1: That player may draw a card and their opponent may play a resource.
// OPTION 2: That player may play a resource and their opponent may draw a card.
// OPTION 3: Both players may draw up to 2 cards.
// OPTION 4: Both players may play up to 2 resources.
// =================================================================================

/** P1 controls the Agreement; every seat has a deck, plain cards and resource cards in hand. */
function ftaTable(count: Count): Table {
  return table(count, [
    { key: "fta", def: printing(FTA), owner: P1, zone: "play" },
    ...seatsOf(count).flatMap((seat): CardPlacement[] => [
      ...Array.from({ length: 8 }, (_, i) => ({ key: `d-${seat}-${i}`, def: character({ name: `Deck ${seat} ${i}` }), owner: seat, zone: "deck" as const })),
      ...Array.from({ length: 2 }, (_, i) => ({ key: `c-${seat}-${i}`, def: character({ name: `Card ${seat} ${i}` }), owner: seat, zone: "hand" as const })),
      ...Array.from({ length: 3 }, (_, i) => ({ key: `r-${seat}-${i}`, def: resourceCard({ name: `Resource ${seat} ${i}` }), owner: seat, zone: "hand" as const }))
    ])
  ]);
}

const labelsOf = (t: Table): string[] => (t.engine.state.pendingChoice as unknown as { options: Array<{ label: string }> }).options.map((option) => option.label);

/** The acting player selects `opponent` (when two or more opponents are left) and chooses option `index` (0 to 3). */
function selectAndChoose(t: Table, actor: PlayerId, opponent: PlayerId, index: number): void {
  const candidates = seatsOf(t.seats.length as Count).filter((seat) => seat !== actor && !t.engine.state.players[seat]!.eliminated);
  if (candidates.length > 1) choosePlayer(t, actor, candidates, opponent);
  assert.equal(open(t)?.kind, "chooserSelectsOption");
  answerFor(t, actor, "chooserSelectsOption", { index });
}

/** Everyone who is prompted from now on (in order, by kind), each answered by `answer`, until nothing is open. */
function prompts(t: Table, answer: (pc: { kind: string; playerId: PlayerId; [key: string]: unknown }) => unknown): Array<[PlayerId, string]> {
  const seen: Array<[PlayerId, string]> = [];
  for (let guard = 0; guard < 20 && open(t); guard++) {
    const pc = t.engine.state.pendingChoice as unknown as { kind: string; playerId: PlayerId; [key: string]: unknown };
    seen.push([pc.playerId, pc.kind]);
    t.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: answer(pc) } as never);
    resolvePendingResponses(t.engine);
  }
  return seen;
}
const accepting = (t: Table) => (pc: { kind: string; [key: string]: unknown }): unknown => {
  if (pc.kind === "mayPay") return { kind: "mayPay", pay: true };
  if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: pickable(t).filter((id) => [0, 1, 2].some((i) => id === t.id(`r-${pc.playerId}-${i}`))).slice(0, ((pc.declaration as { count?: number }).count as number) ?? 1) };
  return declineAll(pc);
};

const handSize = (t: Table, who: PlayerId): number => handOf(t, who).length;

for (const count of COUNTS) {
  clause(FTA, "0:rule", `${count} seats: at the start of each player's turn that player (not the controller) chooses one of the four options, and nobody else is offered the choice`, () => {
    // P2, P3 (and P4), then P1 again: the controller P1 is the actor only on its own turn.
    for (const actor of [...seatsOf(count).slice(1), P1]) {
      const t = ftaTable(count);
      if (actor === P1) {
        // P1's second turn: pass every other seat's turn first.
        startOfTurn(t, P1);
      } else startOfTurn(t, actor);
      assert.equal(t.engine.state.activePlayerId, actor);
      const candidates = seatsOf(count).filter((seat) => seat !== actor);
      choosePlayer(t, actor, candidates, candidates[0]!);
      assert.equal(open(t)?.kind, "chooserSelectsOption", "the four options follow");
      assert.equal(open(t)?.playerId, actor, "the option is chosen by the player whose turn is starting, not by the card's controller");
      assert.deepEqual(labelsOf(t), ["You draw a card; opponents may play a resource", "You may play a resource; opponents may draw", "Each player may draw up to 2 cards", "Each player may play up to 2 resources"], "OPTION 1-4 are offered");
      answerFor(t, actor, "chooserSelectsOption", { index: 2 });
      const seen = prompts(t, accepting(t));
      assert.ok(seen.every(([who]) => who === actor || who === candidates[0]), "only the acting player and the one selected opponent are ever prompted");
      assert.equal(open(t), undefined, "exactly one option was applied");
    }
  });
}

clause(FTA, "0:rule", "4 seats: P4 chooses at the start of P4's turn; with P3 eliminated P3's turn never happens and P3 is never offered a choice, while the trigger still fires at P1's, P2's and P4's starts", () => {
  const t = ftaTable(4);
  startOfTurn(t, P4);
  assert.equal(t.engine.state.activePlayerId, P4);
  choosePlayer(t, P4, [P1, P2, P3], P1);
  assert.equal(open(t)?.playerId, P4, "P4 chooses the option");
  assert.equal(open(t)?.kind, "chooserSelectsOption");
  // P3 eliminated: the turn order skips P3, and the trigger fires at the other three starts.
  const gone = ftaTable(4);
  gone.engine.state.players[P3]!.eliminated = { turn: 1 };
  for (const actor of [P2, P4, P1]) {
    startOfTurn(gone, actor);
    const candidates = seatsOf(4).filter((seat) => seat !== actor && seat !== P3);
    choosePlayer(gone, actor, candidates, candidates[0]!);
    assert.equal(open(gone)?.kind, "chooserSelectsOption");
    assert.equal(open(gone)?.playerId, actor);
    drain(gone.engine, passive);
  }
});

// OPTION 3 / OPTION 4: "Both players" is the player whose turn is starting plus the one opponent that player selects.

for (const count of COUNTS) {
  clause(FTA, "3:option:OPTION 3", `${count} seats: both players may draw up to 2 cards: the active player and the opponent the active player selected, in turn order; nobody else`, () => {
    for (const opponent of [P3, P1]) {
      const t = ftaTable(count);
      startOfTurn(t, P2);
      const before = Object.fromEntries(t.seats.map((seat) => [seat, handSize(t, seat)]));
      const deckBefore = Object.fromEntries(t.seats.map((seat) => [seat, deckOf(t, seat).length]));
      selectAndChoose(t, P2, opponent, 2);
      const seen = prompts(t, accepting(t));
      // turn order from the active player P2: P2 first, then clockwise
      const order = seatsOf(count).filter((seat) => seat === P2 || seat === opponent);
      const clockwise = [...seatsOf(count).slice(1), P1].filter((seat) => order.includes(seat));
      assert.deepEqual(seen.map(([who]) => who), clockwise.flatMap((seat) => [seat, seat]), "each of the two is asked twice (up to 2 cards), P2 first");
      for (const seat of t.seats) {
        const drew = seat === P2 || seat === opponent ? 2 : 0;
        assert.equal(deckBefore[seat]! - deckOf(t, seat).length, drew, `${seat} drew ${drew}`);
        assert.equal(handSize(t, seat) - before[seat]!, drew);
      }
    }
  });

  clause(FTA, "4:option:OPTION 4", `${count} seats: both players may play up to 2 resources: the active player and the opponent the active player selected, in turn order; nobody else`, () => {
    for (const opponent of [P1, P2]) {
      const t = ftaTable(count);
      startOfTurn(t, P3);
      const resourcesIn = (seat: PlayerId): number => [0, 1, 2].filter((i) => zoneOf(t, `r-${seat}-${i}`) === "play").length;
      selectAndChoose(t, P3, opponent, 3);
      const seen = prompts(t, accepting(t));
      const clockwise = [...seatsOf(count).slice(2), ...seatsOf(count).slice(0, 2)].filter((seat) => seat === P3 || seat === opponent);
      assert.deepEqual(seen.map(([who]) => who), clockwise, "P3 first, then the selected opponent");
      for (const seat of t.seats) assert.equal(resourcesIn(seat), seat === P3 || seat === opponent ? 2 : 0, `${seat} played ${seat === P3 || seat === opponent ? 2 : 0} resources`);
    }
  });
}

// OPTION 1 / OPTION 2: "their opponent" is the one opponent the active player selected. The stored data still iterates
// every player but the active one, so at three or more seats every other player is offered it.

for (const count of COUNTS) {
  clauseMismatch(FTA, "1:option:OPTION 1", "MP-2nd-edition-1", `${count} seats: the active player may draw a card and only the opponent they selected may play a resource`, () => {
    for (const opponent of [P3, P1]) {
      const t = ftaTable(count);
      startOfTurn(t, P2);
      selectAndChoose(t, P2, opponent, 0);
      const seen = prompts(t, accepting(t));
      const resourcesIn = (seat: PlayerId): number => [0, 1, 2].filter((i) => zoneOf(t, `r-${seat}-${i}`) === "play").length;
      assert.deepEqual(seen.map(([who]) => who).filter((who) => who !== P2), [opponent], "only the selected opponent is offered the resource play");
      for (const seat of others(count, P2)) assert.equal(resourcesIn(seat), seat === opponent ? 1 : 0, `${seat}`);
      assert.equal(resourcesIn(P2), 0, "the active player does not play a resource");
    }
  });

  clauseMismatch(FTA, "2:option:OPTION 2", "MP-2nd-edition-2", `${count} seats: the active player may play a resource and only the opponent they selected may draw a card`, () => {
    for (const opponent of [P1, P2]) {
      const t = ftaTable(count);
      startOfTurn(t, P3);
      const before = Object.fromEntries(t.seats.map((seat) => [seat, deckOf(t, seat).length]));
      selectAndChoose(t, P3, opponent, 1);
      prompts(t, accepting(t));
      for (const seat of t.seats) {
        const drew = seat === opponent ? 1 : 0;
        assert.equal(before[seat]! - deckOf(t, seat).length, drew, `${seat} drew ${drew}`);
      }
    }
  });
}

