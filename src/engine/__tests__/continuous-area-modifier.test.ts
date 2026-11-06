import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { activate, buildGame, character, developFaction, P1, P2, play, resolvePendingResponses, settleStartFirst } from "./per-card/_harness.js";
import type { ActivatedAbility, CardDefinition, Effect } from "../../engine.js";

// Synthetic fixtures for the `createAreaModifier` effect: a standing "this turn" stat change over every card a
// selector matches, judged live on each stat read (Rasputin Unleashed: "This turn, the speed of all characters that
// opponent controls is reduced to 0" also covers a character the opponent puts into play later this turn).

const sel = (id: string) => ({ type: "selected" as const, id });
const untilEot = { type: "untilEndOfTurn" } as const;

/** A character whose activated abilities run `effects[id]` (no cost, no target). */
const operator = (effects: Record<string, Effect[]>): CardDefinition =>
  character({
    name: "Operator",
    life: 9,
    behavior: {
      abilities: Object.entries(effects).map(
        ([id, list]) =>
          ({
            id,
            type: "activated",
            ...(id === "bump" ? { targets: [{ id: "t", selector: { zone: "play", controller: "any" }, count: 1 }] } : {}),
            effects: list
          }) as unknown as ActivatedAbility
      )
    }
  });

const foes: Effect = {
  type: "createAreaModifier",
  selector: { controller: "opponent", zone: "play", type: "character" },
  stat: "speed",
  operation: "set",
  value: 0,
  duration: untilEot
};

function board() {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      {
        key: "op",
        def: operator({
          slow: [foes],
          // Created after "slow": applies on top of it, in creation order.
          bump: [{ type: "createModifier", target: sel("t"), stat: "speed", operation: "add", value: 1, duration: untilEot }],
          mine: [
            {
              type: "createAreaModifier",
              selector: { controller: "self", zone: "play", type: "character" },
              stat: "strength",
              operation: "add",
              value: 2,
              duration: untilEot
            }
          ]
        }),
        owner: P1
      },
      { key: "foe", def: character({ name: "Foe", speed: 3, strength: 1 }), owner: P2 },
      { key: "late", def: character({ name: "Late", speed: 3, strength: 1, cost: 0 }), owner: P1, zone: "hand" },
      { key: "foeLate", def: character({ name: "Foe Late", speed: 3, strength: 1, cost: 0 }), owner: P2, zone: "hand" }
    ]
  });
}

describe("createAreaModifier (standing this-turn stat change)", () => {
  test("reaches the cards in play now and a card that enters play later the same turn; not other cards", () => {
    const b = board();
    const { engine, id } = b;
    activate(engine, P1, id("op"), "mine");
    const printedOp = 1; // character() default strength
    assert.equal(engine.getStat(id("op"), "strength"), printedOp + 2, "in play now");
    assert.equal(engine.getStat(id("foe"), "strength"), 1, "the opponent's characters are not in the selector");
    assert.equal(engine.getStat(id("late"), "strength"), 1, "a card in hand is not in play, so not matched");
    play(engine, P1, id("late"));
    assert.equal(engine.state.cards[id("late")].zone, "play");
    assert.equal(engine.getStat(id("late"), "strength"), 3, "entered play later: matched live");
  });

  test("'opponent' in the selector is the effect controller's opponent: my own characters and cards not in play are untouched", () => {
    const { engine, id } = board();
    activate(engine, P1, id("op"), "slow");
    assert.equal(engine.getStat(id("foe"), "speed"), 0);
    assert.notEqual(engine.getStat(id("op"), "speed"), 0, "my own characters are not touched");
    assert.equal(engine.getStat(id("foeLate"), "speed"), 3, "a card in the opponent's hand is not in play");
  });

  test("applies in creation order with card-scoped modifiers: a +1 created after the area 'set 0' stays on top", () => {
    const { engine, id } = board();
    activate(engine, P1, id("op"), "slow");
    activate(engine, P1, id("op"), "bump", { selected: { t: [id("foe")] } });
    assert.equal(engine.getStat(id("foe"), "speed"), 1);
  });

  test("ends with the turn (swept at the next start-of-turn point)", () => {
    const { engine, id } = board();
    activate(engine, P1, id("op"), "slow");
    assert.equal(engine.getStat(id("foe"), "speed"), 0);
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    settleStartFirst(engine);
    assert.equal(engine.getStat(id("foe"), "speed"), 3, "back to printed once the turn is over");
    assert.equal(engine.state.areaModifiers.length, 0);
  });
});
