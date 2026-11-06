import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildGame, character, item, P1, P2, resourceCard } from "./support/fixtures.js";
import { settleTurnStart } from "./support/develop.js";
import { developFaction } from "./per-card/_harness.js";
import { developResource } from "./clauses/_turn.js";
import type { TriggeredAbility } from "../../engine.js";

const watcher = (event: string, condition: unknown, id = "w"): TriggeredAbility =>
  ({
    id,
    type: "triggered",
    event,
    condition,
    effects: [{ type: "addCounter", target: "source", counter: "n", amount: 1 }]
  }) as never;

describe("E9a engine capabilities", () => {
  test("a developed resource emits cardEnteredPlay with from=hand (SYS-49) and enteredPlayFrom matches", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "w", def: character({ name: "W", behavior: { abilities: [watcher("cardEnteredPlay", { type: "enteredPlayFrom", zone: "hand" })] } }), owner: P1 },
        { key: "wd", def: character({ name: "WD", behavior: { abilities: [watcher("cardEnteredPlay", { type: "enteredPlayFrom", zone: "discard" })] } }), owner: P1 },
        { key: "r", def: character({ name: "R" }), owner: P1, zone: "hand" }
      ]
    });
    developResource(engine, P1, id("r"), true);
    assert.equal(engine.state.cards[id("w")].counters.n, 1, "face-down develop fired a from-hand watcher");
    assert.equal(engine.state.cards[id("wd")].counters.n ?? 0, 0, "the from-discard watcher did not fire");
  });

  test("damageSourceIs matches the card that dealt the damage (SYS-50 attachment trigger)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P1 },
        {
          key: "it",
          def: item({ name: "It", behavior: { abilities: [watcher("damageDealt", { type: "damageSourceIs", target: "attachedTo" })] } }),
          owner: P1,
          attachedToKey: "host"
        },
        { key: "other", def: character({ name: "Other" }), owner: P1 },
        { key: "foe", def: character({ name: "Foe", life: 9 }), owner: P2 }
      ]
    });
    (engine as any).emit({ type: "damageDealt", sourceId: id("other"), targetId: id("foe"), amount: 1 });
    assert.equal(engine.state.cards[id("it")].counters.n ?? 0, 0, "damage by another card does not fire it");
    (engine as any).emit({ type: "damageDealt", sourceId: id("host"), targetId: id("foe"), amount: 1 });
    assert.equal(engine.state.cards[id("it")].counters.n, 1, "damage by the attached host fires it");
  });

  test("the turn-start Restore Rule emits cardRestored (SYS-47)", () => {
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "w", def: character({ name: "W", behavior: { abilities: [watcher("cardRestored", { type: "sourceIsEventCard" })] } }), owner: P1, depleted: true }
      ]
    });
    engine.perform({ type: "endTurn", playerId: P2 } as never);
    for (let i = 0; i < 20 && engine.state.activePlayerId !== P1; i++) {
      if (engine.state.responseWindow) engine.perform(engine.state.responseWindow.phase === "acceptingResponses" ? ({ type: "passPriority", playerId: engine.state.responseWindow.priorityPlayerId } as never) : ({ type: "advanceFlow" } as never));
    }
    settleTurnStart(engine);
    assert.equal(engine.state.cards[id("w")].depleted, false, "restored by the rule");
    assert.equal(engine.state.cards[id("w")].counters.n, 1, "its own 'when restored' trigger fired once");
  });
});
