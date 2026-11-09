// Multiplayer clause tests for Seed 3, part 5 (Port Manteau). Every test is a real 3- or 4-seat game with the real
// printing, driven through `perform`.

import assert from "node:assert/strict";
import { tactic } from "../../support/fixtures.js";
import { clause } from "../_clause.js";
import { printing } from "../_clause.js";
import { answer, expectChoice, pending, seatsOf, settle, staples, table } from "./_seed-3.js";
import type { CardPlacement, PlayerId, Table } from "./_seed-3.js";
import { P1 } from "./_seed-3.js";

const MANTEAU = "e2f64e14-2f97-4905-8bb0-8bea33994928"; // When this card enters play, name a card subtype. -- Players must pay 2 to deploy cards with the named subtype.

/** Passes priority until `who` holds it. */
function reach(t: Table, who: PlayerId): void {
  for (let guard = 0; guard < 10 && t.engine.state.responseWindow?.priorityPlayerId !== who; guard++) {
    t.engine.perform({ type: "passPriority", playerId: t.engine.state.responseWindow!.priorityPlayerId });
  }
  assert.equal(t.engine.state.responseWindow?.priorityPlayerId, who, `${who} gets priority`);
}

function manteauTable(count: number): Table {
  const seats = seatsOf(count);
  return table(count, [
    { key: "pm", def: printing(MANTEAU), owner: P1, zone: "hand" },
    ...staples("greed", 3),
    ...seats.flatMap((seat): CardPlacement[] => [
      { key: `dragon-${seat}`, def: tactic({ name: `Dragon Trick ${seat}`, cost: 0, subtype: ["Dragon"] }), owner: seat, zone: "hand" },
      { key: `plain-${seat}`, def: tactic({ name: `Plain Trick ${seat}`, cost: 0, subtype: ["Pirate"] }), owner: seat, zone: "hand" },
      ...(seat === P1 ? [] : staples("rage", 1, seat))
    ]),
    { key: "bait", def: tactic({ name: "Bait", cost: 0 }), owner: P1, zone: "hand" }
  ]);
}

const ok = (t: Table, seat: PlayerId, key: string): boolean => t.engine.checkAction({ type: "playCard", playerId: seat, cardId: t.id(`${key}-${seat}`) }).ok;

for (const count of [3, 4] as const) {
  clause(MANTEAU, "0:rule", `${count} seats: when it enters play only the controller names a subtype; no opponent is asked anything`, () => {
    const t = manteauTable(count);
    t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("pm") });
    settle(t);
    const prompt = expectChoice(t, "nameValue", P1);
    assert.equal(prompt.valueKind, "subtype");
    answer(t, P1, { kind: "nameValue", value: "Dragon" });
    assert.equal(pending(t), undefined, "nobody else is asked");
  });

  clause(MANTEAU, "1:rule", `${count} seats: with Dragon named, the controller and every opponent pay 2 more to deploy a Dragon card; other cards cost the normal price for everyone`, () => {
    const t = manteauTable(count);
    t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("pm") });
    settle(t);
    answer(t, P1, { kind: "nameValue", value: "Dragon" });
    // The controller (one resource left) cannot pay 2 more for a Dragon card, and pays the normal cost for another.
    assert.equal(ok(t, P1, "dragon"), false, "the controller pays 2 more");
    assert.equal(ok(t, P1, "plain"), true);
    t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("bait") });
    for (const seat of seatsOf(count).slice(1)) {
      reach(t, seat);
      assert.equal(ok(t, seat, "dragon"), false, `${seat} pays 2 more for a Dragon card (one resource is not enough)`);
      assert.equal(ok(t, seat, "plain"), true, `${seat} pays the normal price for another card`);
    }
  });
}
