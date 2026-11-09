// The log marker "<card>'s triggered ability resolves" named the card whether or not anyone could see it. A trigger that
// is live wherever its card is (`triggerFromAnyZone`: I Drink Your Milkshake!, Seed 2) fires from a card in a deck or a
// hand, and the public line then told every other player and every spectator what that hidden card was. The marker is
// now described from each vantage like an event line. Found by the seat fuzz (fuzz-seats.test.ts, 2 seats seed 2).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { logMessageFor } from "../../../types/log.js";
import { buildGame, character, P1, P2, resolvePendingResponses } from "../support/fixtures.js";

describe("a trigger of a card nobody can see does not name it", () => {
  for (const zone of ["deck", "hand"] as const) {
    test(`a card in a ${zone} whose trigger fires from anywhere is named to its holder only`, () => {
      const { engine, id } = buildGame({
        cards: [
          {
            key: "echo",
            def: character({
              name: "Hidden Echo",
              behavior: {
                abilities: [
                  {
                    id: "echo",
                    type: "triggered",
                    triggerFromAnyZone: true,
                    event: "cardPlayed",
                    effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }]
                  }
                ]
              }
            }),
            owner: P2,
            zone
          },
          { key: "played", def: character({ name: "Newcomer" }), owner: P1, zone: "hand" }
        ]
      });

      engine.perform({ type: "playCard", playerId: P1, cardId: id("played") });
      resolvePendingResponses(engine);

      const line = engine.getLog().find(entry => entry.marker === "triggerResolving");
      assert.ok(line, "the trigger resolved");
      assert.match(line.message, /Hidden Echo's triggered ability resolves/, "the all-seeing line names it");
      assert.match(logMessageFor(line, P2), /Hidden Echo/, "its holder reads the name");
      assert.equal(logMessageFor(line, P1), "a card's triggered ability resolves");
      assert.equal(logMessageFor(line, null), "a card's triggered ability resolves");
    });
  }

  test("a trigger of a card in play is named to everyone", () => {
    const { engine, id } = buildGame({
      cards: [
        {
          key: "watcher",
          def: character({
            name: "Open Watcher",
            behavior: {
              abilities: [{ id: "w", type: "triggered", event: "cardPlayed", effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }]
            }
          }),
          owner: P2
        },
        { key: "played", def: character({ name: "Newcomer" }), owner: P1, zone: "hand" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("played") });
    resolvePendingResponses(engine);

    const line = engine.getLog().find(entry => entry.marker === "triggerResolving");
    assert.ok(line);
    assert.equal(line.redacted, undefined);
    assert.equal(logMessageFor(line, null), "Open Watcher's triggered ability resolves");
  });
});
