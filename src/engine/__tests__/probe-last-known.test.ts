// A read-only query answers from what the game knows about cards that have left play, as the real resolution does
// ("a character with less strength than that character had"): the probe copy a query runs on carries the last-known
// information, so the candidates it offers are exactly the ones the answer is checked against.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { P1, P2, buildGame, character, killTactic, play, resolvePendingResponses } from "./per-card/_harness.js";
import type { PickStep } from "../../engine.js";

describe("queries read last-known information like the real resolution", () => {
  test("a pick judged against the strength a departed character had: query candidates = accepted answers", () => {
    // "When a character you control leaves play, you may pick a character with less strength than that character had."
    const watcher = character({
      name: "Watcher",
      strength: 5,
      behavior: {
        abilities: [
          {
            id: "w",
            type: "triggered",
            event: "cardMoved",
            condition: {
              type: "and",
              conditions: [
                { type: "cardMovedFromZone", zone: "play" },
                { type: "cardTypeIs", target: "eventCard", cardType: "character" },
                { type: "eventCardControlledBy", player: "controller" }
              ]
            },
            effects: [
              {
                type: "chooserSelectsTarget",
                chooser: "controller",
                declaration: {
                  id: "r",
                  selector: {
                    type: "character",
                    conditions: [
                      {
                        type: "statCompare",
                        target: { type: "selected", id: "__candidate" },
                        stat: "strength",
                        operator: "<",
                        value: { type: "stat", target: "eventCard", stat: "strength" }
                      }
                    ]
                  },
                  count: 1,
                  optional: true
                },
                effects: []
              }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "w", def: watcher, owner: P1, zone: "play" },
        { key: "dies", def: character({ name: "Doomed", strength: 3, life: 5 }), owner: P1, zone: "play" },
        { key: "two", def: character({ name: "Two", strength: 2 }), owner: P2, zone: "play" },
        { key: "one", def: character({ name: "One", strength: 1 }), owner: P2, zone: "play" },
        // "Your opponents' characters get -1 strength": an aura, so it stops applying the moment the card leaves play.
        {
          key: "aura",
          def: character({
            name: "Weakener",
            strength: 0,
            behavior: {
              abilities: [
                { id: "weaken", type: "continuous", modifiers: [{ selector: { controller: "opponent", type: "character" }, stat: "strength", operation: "add", value: -1 }] }
              ]
            }
          }),
          owner: P2,
          zone: "play"
        },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
      ]
    });
    // It had 2 strength when it left (3 printed, -1 from the aura, which no longer reaches it in the discard pile):
    // only "One" has less.
    assert.equal(engine.getStat(id("dies"), "strength"), 2);
    play(engine, P1, id("kill"), { selected: { t: [id("dies")] } });
    resolvePendingResponses(engine);
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "chooserSelectsTarget");
    if (pending?.kind !== "chooserSelectsTarget") return;

    const accepted = engine.targetCandidates(pending.declaration.selector, pending.context, pending.playerId).map(card => card.id);
    const step = engine
      .getSelectionRequirements({
        sourceId: pending.context.sourceId,
        controllerId: pending.context.controllerId,
        pickerId: pending.playerId,
        declarations: [pending.declaration],
        costs: [],
        selected: {},
        variables: {},
        context: pending.context
      })
      .find((r): r is PickStep => r.kind === "pick");
    assert.ok(step, "the query lists the pick");
    assert.deepEqual([...step.candidates].sort(), [...accepted].sort(), "the query offers exactly what the answer is checked against");
    // Judged against the 2 strength it had, not the 3 it shows in the discard pile: "Two" (2) is not less.
    assert.deepEqual([...accepted].sort(), [id("one"), id("aura")].sort());
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("one")] } } as never);
  });
});
