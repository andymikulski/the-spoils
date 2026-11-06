import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { logMessageFor, type GameLogEntry } from "../../types/log.js";
import {
  buildGame,
  character,
  defaultFactionDefinition,
  factionCard,
  P1,
  P2,
  resolvePendingResponses,
  resourceCard,
  tactic
} from "./support/fixtures.js";
import { developDraw, developPlay } from "./support/develop.js";

function lineFor(log: readonly GameLogEntry[], match: (entry: GameLogEntry) => boolean): GameLogEntry {
  const entry = log.find(match);
  assert.ok(entry, "expected a matching log entry");
  return entry;
}

describe("game log — each reader gets the line from their own vantage", () => {
  test("a drawn card is named to its drawer only; the public line says 'a card'", () => {
    const { engine } = buildGame({
      cards: [{ key: "d1", def: character({ name: "Secret Weapon" }), owner: P1, zone: "deck" }]
    });

    developDraw(engine, P1);

    const moved = lineFor(engine.getLog(), e => e.event?.type === "cardMoved");
    assert.match(moved.message, /Secret Weapon moves from deck to hand/);
    assert.equal(logMessageFor(moved, undefined), moved.message, "the all-seeing reader gets the full line");
    assert.equal(logMessageFor(moved, P1), moved.message, "the drawer sees what they drew");
    assert.equal(logMessageFor(moved, P2), "a card moves from deck to hand");
    assert.equal(logMessageFor(moved, null), "a card moves from deck to hand");
  });

  test("a face-down resource is named to its controller and the all-seeing reader only", () => {
    // The default test faction's Develop Rule only draws; this one can also play a resource.
    const faction = factionCard({
      faction: defaultFactionDefinition({
        turn: {
          restore: { detachResources: true, restoreNonResources: true },
          develop: { choices: [{ type: "draw", count: 1 }, { type: "playResource", count: 1 }] }
        }
      })
    });
    const { engine, id } = buildGame({
      playerA: { faction },
      cards: [{ key: "gem", def: resourceCard({ name: "Hidden Gem" }), owner: P1, zone: "hand" }]
    });

    developPlay(engine, P1, id("gem"), true);

    const played = lineFor(engine.getLog(), e => e.event?.type === "resourcePlayed");
    assert.match(played.message, /Hidden Gem/);
    assert.match(logMessageFor(played, P1), /Hidden Gem/);
    for (const viewer of [P2, null]) {
      const line = logMessageFor(played, viewer);
      assert.doesNotMatch(line, /Hidden Gem/);
      assert.match(line, /a face-down card/);
    }
  });

  test("a private look names the cards to the looker (and the hand's holder); everyone else learns only that it happened", () => {
    const peek = tactic({
      name: "Peek",
      behavior: {
        abilities: [
          {
            id: "peek",
            type: "activated",
            effects: [{ type: "reveal", of: "opponent", zone: "hand", viewer: "controller" }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "peek", def: peek, owner: P1, zone: "hand" },
        { key: "plan", def: tactic({ name: "Secret Plan" }), owner: P2, zone: "hand" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("peek") });
    resolvePendingResponses(engine);

    const revealed = lineFor(engine.getLog(), e => e.event?.type === "cardsRevealed");
    assert.match(logMessageFor(revealed, P1), /Secret Plan/);
    assert.match(logMessageFor(revealed, P2), /Secret Plan/, "it is Bob's own hand");
    assert.equal(logMessageFor(revealed, null), "Alice looks at 1 card from Bob's hand");
  });

  test("a line about public cards carries no redaction", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "spell", def: tactic({ name: "Spark" }), owner: P1, zone: "hand" }]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("spell") });
    resolvePendingResponses(engine);

    for (const entry of engine.getLog()) {
      assert.equal(entry.redacted, undefined, entry.message);
    }
    const toDiscard = lineFor(engine.getLog(), e => e.event?.type === "cardMoved");
    assert.equal(logMessageFor(toDiscard, P2), "Spark moves from play to discard");
  });
});
