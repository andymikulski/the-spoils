// Three-player checks for catalog cards (1st Edition, 1st Edition Part 2, 2nd Edition, Open Beta) whose encoding played
// differently at a bigger table than the printed text under RULES.md §16. Found by the table-mode matrix
// (SPOILS_TABLE=ffa3|ffa4|showdown); each card is loaded from the real catalog by printing id.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import cardsJson from "../../../data/cards.js";
import type { CardDefinition, PlayerId } from "../../../engine.js";
import { buildGame, character, noDevelopFaction, resolvePendingResponses } from "./_harness.js";

const CATALOG = cardsJson as CardDefinition[];

function printing(id: string): CardDefinition {
  const def = CATALOG.find(card => card.id === id);
  if (!def) throw new Error(`no printing ${id}`);
  return structuredClone(def);
}

const SEATS = ["p1", "p2", "p3"].map(id => ({ id, faction: noDevelopFaction() }));
const ONE_ON_ONE = ["p1", "p2"].map(id => ({ id, faction: noDevelopFaction() }));

type Engine = ReturnType<typeof buildGame>["engine"];
type Pending = { kind: string; playerId: PlayerId; [key: string]: unknown };
const pending = (engine: Engine) => engine.state.pendingChoice as Pending | undefined;
const zoneOf = (engine: Engine, cardId: string) => engine.state.cards[cardId].zone;

/** End `playerId`'s turn, close the response windows and resolve the trigger `abilityId` first when the turn start's triggers must be ordered. */
function endTurn(engine: Engine, playerId: PlayerId, abilityId: string): void {
  engine.perform({ type: "endTurn", playerId } as never);
  resolvePendingResponses(engine);
  for (let guard = 0; guard < 10 && pending(engine)?.kind === "orderTriggers"; guard++) {
    const open = pending(engine)!;
    const triggers = open.triggers as Array<{ abilityId: string }>;
    const next = triggers.find(trigger => trigger.abilityId === abilityId) ?? triggers[0];
    engine.perform({ type: "resolvePendingChoice", playerId: open.playerId, choice: { kind: "orderTriggers", next } } as never);
    resolvePendingResponses(engine);
  }
}

describe("Dragon Tank: 'a character an opponent controls' looks at every opponent (RULES.md §16)", () => {
  const TANKS = [
    ["1st Edition", "261002dc-bb50-4fbb-946d-59cafc5f8a51"],
    ["2nd Edition", "3e949563-8af2-40f0-8dde-212932256134"],
    ["Open Beta", "e055ac0a-49d8-4bb0-914b-b039336c5e97"]
  ] as const;

  for (const [set, id] of TANKS) {
    test(`${set}: an opponent with no characters does not destroy the Tank while another opponent has one`, () => {
      // p3 ends its turn, so p1's turn starts: p2 controls a character, p3 none.
      const { engine, id: card } = buildGame({
        players: SEATS,
        activePlayerId: "p3",
        cards: [
          { key: "tank", def: printing(id), owner: "p1", zone: "play" },
          { key: "foe", def: character({ name: "Foe", life: 3 }), owner: "p2", zone: "play" }
        ]
      });
      endTurn(engine, "p3", "cull");
      assert.equal(engine.state.activePlayerId, "p1");
      assert.equal(zoneOf(engine, card("tank")), "play", "p2 has a character, so the Tank may pick it");
      const open = pending(engine);
      assert.equal(open?.kind, "chooserSelectsTarget", "the Tank's controller is asked for a pick");
      assert.equal(open.playerId, "p1");
      engine.perform({ type: "resolvePendingChoice", playerId: "p1", choice: { kind: "chooserSelectsTarget", selected: [card("foe")] } } as never);
      resolvePendingResponses(engine);
      assert.equal(zoneOf(engine, card("foe")), "discard", "p2's character is destroyed");
      assert.equal(zoneOf(engine, card("tank")), "play", "and the Tank stays");
    });

    test(`${set}: with no character under any opponent the Tank is destroyed`, () => {
      const { engine, id: card } = buildGame({
        players: SEATS,
        activePlayerId: "p3",
        cards: [{ key: "tank", def: printing(id), owner: "p1", zone: "play" }]
      });
      endTurn(engine, "p3", "cull");
      assert.equal(zoneOf(engine, card("tank")), "discard");
    });

    test(`${set}: two-player play is unchanged (the Tank asks for a pick, or is destroyed when the opponent has none)`, () => {
      const withFoe = buildGame({
        players: ONE_ON_ONE,
        activePlayerId: "p2",
        cards: [
          { key: "tank", def: printing(id), owner: "p1", zone: "play" },
          { key: "foe", def: character({ name: "Foe", life: 3 }), owner: "p2", zone: "play" }
        ]
      });
      endTurn(withFoe.engine, "p2", "cull");
      assert.equal(pending(withFoe.engine)?.kind, "chooserSelectsTarget");
      assert.equal(zoneOf(withFoe.engine, withFoe.id("tank")), "play");

      const alone = buildGame({
        players: ONE_ON_ONE,
        activePlayerId: "p2",
        cards: [{ key: "tank", def: printing(id), owner: "p1", zone: "play" }]
      });
      endTurn(alone.engine, "p2", "cull");
      assert.equal(zoneOf(alone.engine, alone.id("tank")), "discard");
    });
  }
});
