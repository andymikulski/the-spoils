import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildGame, character, item, P1 } from "./support/fixtures.js";

// Tactical (RULES.md §9) is covered in priority-and-responses.test.ts.
// Aggro (RULES.md §9) and Covert (RULES.md §9) are covered in battle.test.ts.

describe("RULES.md §9 — Unique", () => {
  test(
    "controlling two cards with the same Unique designation forces one to be destroyed",
    { todo: "engine gap: 'Unique' is not implemented anywhere in SpoilsEngine — see RULES.md §9" },
    () => {
      const { engine, id } = buildGame({
        cards: [
          { key: "first", def: character({ name: "Eldridge Gosche, Godstealer", subtype: ["unique:eldridge"] }), owner: P1 },
          { key: "second", def: character({ name: "Eldridge Gosche, Godstealer", subtype: ["unique:eldridge"] }), owner: P1 }
        ]
      });

      // Whatever state-based mechanism eventually enforces Unique, exactly
      // one of the two copies should remain in play.
      const inPlay = [id("first"), id("second")].filter(
        cardId => engine.state.cards[cardId].zone === "play"
      );
      assert.equal(inPlay.length, 1);
    }
  );
});

describe("RULES.md §9 — Attach to X", () => {
  test(
    "an 'Attach to Character' card is destroyed if its target character leaves play",
    { todo: "engine gap: 'Attach to X' is not implemented anywhere in SpoilsEngine — see RULES.md §9" },
    () => {
      const { engine, id } = buildGame({
        cards: [
          { key: "host", def: character({ name: "Host" }), owner: P1 },
          {
            key: "gear",
            def: item({ name: "Attached Gear", subtype: ["attachToCharacter"] }),
            owner: P1,
            attachedToKey: "host"
          }
        ]
      });

      // Simulate the host leaving play the way a real destroy would.
      engine.state.cards[id("host")].zone = "discard";

      assert.equal(engine.state.cards[id("gear")].zone, "discard");
    }
  );
});
