// EU1: a trigger that pauses on a choice while a resource is entering play (the Develop Rule's `playResource` answer, or a
// `playResource` effect) must keep the rest of its own effect list, and every outer parked frame, waiting until that
// choice is answered. the resolvePendingChoice "playResource" case never resumes a parked frame while a choice is outstanding.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildGame, character, P1, resolvePendingResponses, resourceCard, tactic } from "./support/fixtures.js";
import { developFaction } from "./per-card/_harness.js";
import { developPlay } from "./support/develop.js";
import type { SpoilsEngine } from "../../engine.js";

const answer = (engine: SpoilsEngine, choice: Record<string, unknown>) =>
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice } as never);

/** A permanent whose trigger fires when one of your resources enters play: it asks for a pick, then does more. */
const watcher = (effects: unknown[]) =>
  character({
    name: "Watcher",
    behavior: {
      abilities: [
        {
          id: "watch",
          type: "triggered",
          event: "cardEnteredPlay",
          condition: {
            type: "and",
            conditions: [
              { type: "eventCardControlledBy", player: "controller" },
              { type: "cardTypeIs", target: "eventCard", cardType: "resource" }
            ]
          },
          effects
        }
      ]
    } as never
  });

const nameThenGain = [
  { type: "nameValue", chooser: "controller", valueKind: "resourceIcon", storeAs: "x" },
  { type: "modifyInfluence", player: "controller", amount: 2 }
];

describe("EU1 — a trigger paused mid-list on a resource entering play", () => {
  test("the Develop Rule's resource: the remainder of the trigger waits for the name", () => {
    const { engine, id: k } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "w", def: watcher(nameThenGain), owner: P1, zone: "play" },
        { key: "r", def: resourceCard({ name: "Plain" }), owner: P1, zone: "hand" }
      ]
    });
    const influence = engine.state.players[P1].influence;
    developPlay(engine, P1, k("r"));
    assert.equal(engine.state.pendingChoice?.kind, "nameValue");
    assert.equal(engine.state.players[P1].influence, influence, "the second effect has not run yet");
    answer(engine, { kind: "nameValue", value: "rage" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(engine.state.players[P1].influence, influence + 2, "it runs once, after the answer");
  });

  test("an effect that plays a resource: its own later effects wait behind the trigger's prompt", () => {
    const play = tactic({
      name: "Sow",
      cost: 0,
      behavior: {
        abilities: [
          {
            id: "sow",
            type: "activated",
            effects: [
              { type: "playResource", target: { type: "selected", id: "pick" }, faceDown: "auto" },
              { type: "modifyInfluence", player: "controller", amount: 5 }
            ],
            targets: [
              {
                id: "pick",
                selector: { owner: "self", zone: "hand", type: "resource" },
                count: 1
              }
            ]
          }
        ]
      } as never
    });
    const { engine, id: k } = buildGame({
      cards: [
        { key: "w", def: watcher(nameThenGain), owner: P1, zone: "play" },
        { key: "t", def: play, owner: P1, zone: "hand" },
        { key: "r", def: resourceCard({ name: "Plain" }), owner: P1, zone: "hand" }
      ]
    });
    const influence = engine.state.players[P1].influence;
    engine.perform({ type: "playCard", playerId: P1, cardId: k("t"), selected: { pick: [k("r")] } } as never);
    resolvePendingResponses(engine);
    // Whatever order the prompts come in, nothing past an outstanding prompt may have run.
    let guard = 0;
    while (engine.state.pendingChoice && guard++ < 6) {
      const pc = engine.state.pendingChoice as { kind: string };
      if (pc.kind === "nameValue") {
        assert.equal(engine.state.players[P1].influence, influence, "no effect ran before the name was given");
        answer(engine, { kind: "nameValue", value: "rage" });
      } else if (pc.kind === "playResource") {
        answer(engine, { kind: "playResource", faceDown: false });
      } else {
        assert.fail(`unexpected prompt ${pc.kind}`);
      }
      resolvePendingResponses(engine);
    }
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(engine.state.players[P1].influence, influence + 7, "trigger +2 and the tactic's +5, each once");
  });
});
