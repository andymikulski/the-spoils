import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildGame, character, item, P1, resolvePendingResponses } from "./support/fixtures.js";
import type { ActivatedAbility } from "../../engine.js";

const NOOP_ABILITY: ActivatedAbility = { id: "noop", type: "activated", effects: [] };

// Tactical (RULES.md §9) is covered in priority-and-responses.test.ts.
// Aggro (RULES.md §9) and Covert (RULES.md §9) are covered in battle.test.ts.

describe("RULES.md §9 — Unique", () => {
  test("controlling two cards with the same Unique designation pauses on a player decision", () => {
    const { engine, id } = buildGame({
      cards: [
        {
          key: "first",
          def: character({ name: "Eldridge Gosche, Godstealer", unique: "eldridge", behavior: { abilities: [NOOP_ABILITY] } }),
          owner: P1
        },
        { key: "second", def: character({ name: "Eldridge Gosche, Godstealer", unique: "eldridge" }), owner: P1 }
      ]
    });

    // Any action triggers a state-based check.
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("first"), abilityId: "noop" });
    resolvePendingResponses(engine);

    // Both copies are still in play — nothing gets auto-destroyed.
    assert.equal(engine.state.cards[id("first")].zone, "play");
    assert.equal(engine.state.cards[id("second")].zone, "play");

    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "uniqueSurvivor");
    assert.equal(pending?.playerId, P1);
    if (pending?.kind === "uniqueSurvivor") {
      assert.equal(pending.unique, "eldridge");
      assert.deepEqual([...pending.candidates].sort(), [id("first"), id("second")].sort());
    }

    assert.equal(engine.getFlowView().mode, "pendingChoice");
  });

  test("the player's choice decides which copy survives — either one", () => {
    for (const keep of ["first", "second"] as const) {
      const { engine, id } = buildGame({
        cards: [
          {
            key: "first",
            def: character({ name: "Eldridge Gosche, Godstealer", unique: "eldridge", behavior: { abilities: [NOOP_ABILITY] } }),
            owner: P1
          },
          { key: "second", def: character({ name: "Eldridge Gosche, Godstealer", unique: "eldridge" }), owner: P1 }
        ]
      });

      engine.perform({ type: "activateAbility", playerId: P1, cardId: id("first"), abilityId: "noop" });
      resolvePendingResponses(engine);

      engine.perform({
        type: "resolvePendingChoice",
        playerId: P1,
        choice: { kind: "uniqueSurvivor", keep: id(keep) }
      });
      resolvePendingResponses(engine);

      const other = keep === "first" ? "second" : "first";
      assert.equal(engine.state.cards[id(keep)].zone, "play");
      assert.equal(engine.state.cards[id(other)].zone, "discard");
      assert.equal(engine.state.pendingChoice, undefined);
    }
  });

  test("only the affected player may answer, and only with one of the actual candidates", () => {
    const { engine, id } = buildGame({
      cards: [
        {
          key: "first",
          def: character({ name: "Eldridge Gosche, Godstealer", unique: "eldridge", behavior: { abilities: [NOOP_ABILITY] } }),
          owner: P1
        },
        { key: "second", def: character({ name: "Eldridge Gosche, Godstealer", unique: "eldridge" }), owner: P1 },
        { key: "bystander", def: character({ name: "Bystander" }), owner: P1 }
      ]
    });

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("first"), abilityId: "noop" });
    resolvePendingResponses(engine);

    assert.throws(() =>
      engine.perform({ type: "resolvePendingChoice", playerId: "p2", choice: { kind: "uniqueSurvivor", keep: id("first") } })
    );
    assert.throws(() =>
      engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("bystander") } })
    );

    // Nothing else can happen while the choice is outstanding, either.
    assert.throws(() =>
      engine.perform({ type: "activateAbility", playerId: P1, cardId: id("bystander"), abilityId: "noop" })
    );
  });

  test("the opponent may control a card with the same Unique designation at the same time", () => {
    const { engine, id } = buildGame({
      cards: [
        {
          key: "mine",
          def: character({ name: "Eldridge Gosche, Godstealer", unique: "eldridge", behavior: { abilities: [NOOP_ABILITY] } }),
          owner: P1
        },
        { key: "theirs", def: character({ name: "Eldridge Gosche, Godstealer", unique: "eldridge" }), owner: "p2" }
      ]
    });

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("mine"), abilityId: "noop" });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("mine")].zone, "play");
    assert.equal(engine.state.cards[id("theirs")].zone, "play");
    assert.equal(engine.state.pendingChoice, undefined);
  });

  test("two cards with different Unique designations coexist fine", () => {
    const { engine, id } = buildGame({
      cards: [
        {
          key: "a",
          def: character({ name: "A", unique: "a", behavior: { abilities: [NOOP_ABILITY] } }),
          owner: P1
        },
        { key: "b", def: character({ name: "B", unique: "b" }), owner: P1 }
      ]
    });

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("a"), abilityId: "noop" });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("a")].zone, "play");
    assert.equal(engine.state.cards[id("b")].zone, "play");
    assert.equal(engine.state.pendingChoice, undefined);
  });
});

describe("RULES.md §9 — Attach to X", () => {
  test("an 'Attach to Character' card is destroyed if its target character leaves play", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P1 },
        {
          key: "gear",
          def: item({ name: "Attached Gear", attachTo: "character", behavior: { abilities: [NOOP_ABILITY] } }),
          owner: P1,
          attachedToKey: "host"
        }
      ]
    });

    // Simulate the host leaving play the way a real destroy would.
    engine.state.cards[id("host")].zone = "discard";

    // Any action triggers a state-based check.
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("gear"), abilityId: "noop" });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("gear")].zone, "discard");
  });

  test("playing an 'Attach to Character' card requires choosing a legal character target", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P1 },
        {
          key: "gear",
          def: item({ name: "Attached Gear", attachTo: "character" }),
          owner: P1,
          zone: "hand"
        }
      ]
    });

    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("gear") })
    );

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("gear"),
      selected: { attachTo: [id("host")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("gear")].zone, "play");
    assert.equal(engine.state.cards[id("gear")].attachedTo, id("host"));
  });

  test("an 'Attach to Character' card played with no legal target in play is rejected", () => {
    const { engine, id } = buildGame({
      cards: [
        {
          key: "gear",
          def: item({ name: "Attached Gear", attachTo: "character" }),
          owner: P1,
          zone: "hand"
        }
      ]
    });

    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("gear") })
    );
  });
});
