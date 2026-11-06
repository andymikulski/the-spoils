// The double-sided-faction-card flip (RULES.md §3.6): Imperial Army /
// Counter-Imperial Army are the SAME physical card — a coin flip at the end
// of the active side's turn may turn it over, swapping which
// `FactionDefinition` governs the controller for every live lookup
// (restore, develop, thresholds, abilities). Previously a documented,
// deliberately-unmodelled "large scope" parity gap (data/card-coverage.json
// -> parityGaps -> "double-sided-faction"); closed by `FactionDefinition
// .flipsTo` + the `flipFactionCard` effect + `turn.endOfTurnEffects`.
//
// Part 1: synthetic fixtures proving the mechanism in isolation. Part 2:
// the real Imperial Army / Counter-Imperial Army catalog data end-to-end.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import cardsJson from "../../data/cards.js";
import {
  buildGame,
  defaultFactionDefinition,
  factionCard,
  P1,
  P2,
  resolvePendingResponses
} from "./support/fixtures.js";
import { settleTurnStart } from "./support/develop.js";
import type { CardDefinition } from "../../engine.js";

const CATALOG = cardsJson as CardDefinition[];
const def = (name: string): CardDefinition => {
  const d = CATALOG.find(c => c.type === "faction" && c.name === name);
  assert.ok(d, `Faction card '${name}' not found`);
  return structuredClone(d);
};

const settle = (engine: ReturnType<typeof buildGame>["engine"]) => {
  resolvePendingResponses(engine);
  settleTurnStart(engine);
};

describe("double-sided faction cards (RULES.md §3.6)", () => {
  test("flipFactionCard swaps the in-play card's definitionId, not its instance id", () => {
    const front: CardDefinition = factionCard({
      name: "Front",
      faction: defaultFactionDefinition({
        turn: {
          restore: { detachResources: true, restoreNonResources: true },
          develop: { choices: [] },
          endOfTurnEffects: [
            { type: "flipCoin", winEffects: [{ type: "flipFactionCard", target: "source" }], loseEffects: [] }
          ]
        },
        flipsTo: "back"
      })
    });
    const back: CardDefinition = factionCard({
      id: "back",
      name: "Back",
      faction: defaultFactionDefinition({ flipsTo: front.id })
    });

    const { engine, id } = buildGame({
      playerA: { faction: front },
      // The engine only registers a CardDefinition it's told about; "back"
      // isn't anyone's faction, so stash it as an inert deck card purely to
      // get it into the definitions map (mirroring how a real consumer
      // loading the full catalog would already have both sides registered).
      cards: [{ key: "back-stash", def: back, owner: P2, zone: "deck" }],
      random: () => 0.1 // always "wins" the coin flip
    });
    const factionInstanceId = id("__factionA");
    assert.equal(engine.getDefinition(factionInstanceId).name, "Front");

    engine.perform({ type: "endTurn", playerId: P1 });
    settle(engine);

    assert.equal(factionInstanceId, engine.state.players[P1].factionId, "same physical card, same instance id");
    assert.equal(engine.getDefinition(factionInstanceId).name, "Back", "now showing the other face");
    assert.equal(engine.getFactionDefinition(P1)?.flipsTo, front.id);
  });

  test("flipFactionCard is a no-op when the current side has no flipsTo", () => {
    const noFlip: CardDefinition = factionCard({
      name: "NoFlip",
      faction: defaultFactionDefinition({
        turn: {
          restore: { detachResources: true, restoreNonResources: true },
          develop: { choices: [] },
          endOfTurnEffects: [{ type: "flipFactionCard", target: "source" }]
        }
      })
    });
    const { engine, id } = buildGame({ playerA: { faction: noFlip } });
    engine.perform({ type: "endTurn", playerId: P1 });
    settle(engine);
    assert.equal(engine.getDefinition(id("__factionA")).name, "NoFlip");
  });

  test("a coin-flip loss leaves the current side active", () => {
    const front: CardDefinition = factionCard({
      name: "Front",
      faction: defaultFactionDefinition({
        turn: {
          restore: { detachResources: true, restoreNonResources: true },
          develop: { choices: [] },
          endOfTurnEffects: [
            { type: "flipCoin", winEffects: [{ type: "flipFactionCard", target: "source" }], loseEffects: [] }
          ]
        },
        flipsTo: "back"
      })
    });

    const { engine, id } = buildGame({
      playerA: { faction: front },
      random: () => 0.9 // always "loses" the coin flip
    });
    engine.perform({ type: "endTurn", playerId: P1 });
    settle(engine);
    assert.equal(engine.getDefinition(id("__factionA")).name, "Front");
  });
});

describe("Imperial Army <-> Counter-Imperial Army: real catalog data end-to-end", () => {
  test("a coin-flip win turns Imperial Army over into Counter-Imperial Army, and back again", () => {
    const imperial = def("Imperial Army");
    const counter = def("Counter-Imperial Army");
    assert.equal(imperial.faction?.flipsTo, counter.id);

    const { engine, id } = buildGame({
      playerA: { faction: imperial },
      // A real consumer loads the full catalog, so Counter-Imperial Army is
      // already registered; buildGame only registers placed definitions.
      cards: [{ key: "counter-stash", def: counter, owner: P2, zone: "deck" }],
      random: () => 0.1 // always wins
    });
    const factionId = id("__factionA");
    assert.equal(engine.getDefinition(factionId).name, "Imperial Army");
    assert.equal(engine.getFactionDefinition(P1)?.turn.develop.choices.length, 0, "Imperial Army's develop rule is a pure cost reduction, not draw/resource");

    engine.perform({ type: "endTurn", playerId: P1 });
    settle(engine);

    assert.equal(engine.getDefinition(factionId).name, "Counter-Imperial Army");
    assert.equal(
      engine.getFactionDefinition(P1)?.turn.develop.choices.length,
      2,
      "Counter-Imperial Army reverts to the generic draw/play-resource develop rule"
    );

    const flipEntry = engine.getLog().find(e => e.event?.type === "factionCardFlipped");
    assert.ok(flipEntry, "the flip itself is logged, not just the coin toss");
    assert.equal(flipEntry.kind, "trigger");
    assert.match(flipEntry.message, /Imperial Army becomes Counter-Imperial Army/);

    // The opponent's turn passes with nothing to flip; Imperial Army's
    // controller ends their next turn from the Counter-Imperial Army side
    // and flips back.
    engine.perform({ type: "endTurn", playerId: P2 });
    settle(engine);
    engine.perform({ type: "endTurn", playerId: P1 });
    settle(engine);
    assert.equal(engine.getDefinition(factionId).name, "Imperial Army");
  });

  test("Counter-Imperial Army's own flipsTo points back at Imperial Army", () => {
    const counter = def("Counter-Imperial Army");
    assert.equal(counter.faction?.flipsTo, "2ce14e80-b0c6-4a3a-999b-c240b4fff9d5");
  });
});
