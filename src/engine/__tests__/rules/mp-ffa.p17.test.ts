// Multiplayer (free-for-all) rules, part 17: "Your opponent cannot take control of this card" is the singular form of
// "Opponents cannot take control of this card" - at three or more seats only the opponent the card's controller
// selected is barred, every other opponent can still take control of it (Mountainous Golem, Seed), while the plural
// form bars every opponent (Seed Saga). Every case runs at three and at four seats.
// Atoms: MPX-lasting, MPX-select, CR 407.3.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, PlayerId } from "../../../engine.js";
import { character, P1, resolvePendingResponses, tactic } from "../support/fixtures.js";
import { rule } from "./_rule.js";
import { ACTIVATED, answerPlayer, board, pending, play, seatsFor, TABLES, type Table } from "./_mpTable.js";

const withRestriction = (restriction: string): CardDefinition =>
  ({
    ...character({ name: "Golem" }),
    behavior: { abilities: [{ id: "no-steal", type: "continuous", modifiers: [], restrictions: [{ target: "source", restriction }] }] }
  }) as CardDefinition;

/** "Take control of the Golem." One per seat, in that seat's hand. */
const thief = (seat: PlayerId): CardDefinition =>
  tactic({
    name: `Thief ${seat}`,
    cost: 0,
    behavior: ACTIVATED({
      targets: [{ id: "t", selector: { type: "character", name: "Golem" }, count: 1 }],
      effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
    })
  });

/** P1 plays the Golem, selects `chosen` when asked (only a singular form asks at a table of three or more), and `thieves` wait in their owners' hands. */
function golemTable(count: number, restriction: string, chosen: PlayerId | undefined): Table {
  const thieves = seatsFor(count).slice(1);
  const t = board(count, withRestriction(restriction), thieves.map(seat => ({ key: `thief-${seat}`, def: thief(seat), owner: seat, zone: "hand" as const })));
  t.engine.perform(play(t));
  resolvePendingResponses(t.engine);
  if (chosen !== undefined) {
    assert.equal(pending(t)?.kind, "choosePlayer", "the Golem's controller selects an opponent");
    assert.deepEqual([...((pending(t) as unknown as { candidates: PlayerId[] }).candidates)].sort(), thieves, "the opponents are the choices, never the controller");
    answerPlayer(t, P1, chosen);
  }
  assert.equal(pending(t), undefined);
  assert.equal(t.engine.state.cards[t.id("spell")]!.zone, "play");
  return t;
}

/** `seat` plays its Thief on its own turn; reports who controls the Golem afterwards. */
function stealBy(t: Table, seat: PlayerId): PlayerId {
  while (t.engine.state.activePlayerId !== seat) {
    t.engine.perform({ type: "endTurn", playerId: t.engine.state.activePlayerId });
    resolvePendingResponses(t.engine);
  }
  t.engine.perform({ type: "playCard", playerId: seat, cardId: t.id(`thief-${seat}`), selected: { t: [t.id("spell")] } });
  resolvePendingResponses(t.engine);
  return t.engine.state.cards[t.id("spell")]!.controllerId;
}

describe('MPX-lasting / MPX-select / CR 407.3 — "your opponent cannot take control of this card" bars the selected opponent only', () => {
  for (const count of TABLES) {
    for (const chosen of seatsFor(count).slice(1)) {
      for (const thiefSeat of seatsFor(count).slice(1)) {
        const barred = thiefSeat === chosen;
        rule(
          ["MPX-lasting", "MPX-select", "CR 407.3"],
          `${count} seats: choosing ${chosen}, ${thiefSeat} ${barred ? "cannot" : "can"} take control of the card`,
          () => {
            const t = golemTable(count, "cannotBeTakenControlByOpponent", chosen);
            assert.equal(stealBy(t, thiefSeat), barred ? P1 : thiefSeat);
          }
        );
      }
    }

    for (const thiefSeat of seatsFor(count).slice(1)) {
      rule(
        ["MPX-lasting", "CR 407.3"],
        `${count} seats: "opponents cannot take control of this card" bars ${thiefSeat} like every other opponent, and nobody is asked`,
        () => {
          const t = golemTable(count, "cannotBeTakenControl", undefined);
          assert.equal(stealBy(t, thiefSeat), P1);
        }
      );
    }
  }
});
