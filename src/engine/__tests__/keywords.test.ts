import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { autoResolveBattle, buildGame, character, item, P1, P2, resolvePendingResponses } from "./support/fixtures.js";
import type { ActivatedAbility, TriggeredAbility } from "../../engine.js";

const NOOP_ABILITY: ActivatedAbility = { id: "noop", type: "activated", effects: [] };

/** "When this card is put into a discard pile, controller gains 1 influence." */
const ON_DISCARDED: TriggeredAbility = {
  id: "on-discarded",
  type: "triggered",
  event: "cardMoved",
  condition: {
    type: "and",
    conditions: [
      { type: "sourceIsEventCard" },
      { type: "cardMovedToZone", zone: "discard" }
    ]
  },
  effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }]
};

/** "When this card is destroyed, controller gains 1 influence." */
const ON_DESTROYED: TriggeredAbility = {
  id: "on-destroyed",
  type: "triggered",
  event: "cardDestroyed",
  condition: { type: "sourceIsEventCard" },
  effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }]
};

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
  test("CR §507.2c — with no valid host, an Attach-to-X card is put into its owner's discard pile (a move, not a destruction)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P1 },
        {
          key: "gear",
          def: item({
            name: "Attached Gear",
            attachTo: "character",
            behavior: { abilities: [NOOP_ABILITY, ON_DISCARDED, ON_DESTROYED] }
          }),
          owner: P1,
          attachedToKey: "host"
        }
      ]
    });

    const before = engine.state.players[P1].influence;

    // Host leaves play; the gear is now hostless.
    engine.state.cards[id("host")].zone = "discard";
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("gear"), abilityId: "noop" });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("gear")].zone, "discard");
    // It was *moved* to discard — the "put into a discard pile" trigger
    // fired, the "when destroyed" trigger did not.
    assert.equal(engine.state.players[P1].influence, before + 1);
  });

  test("CR §507.2e — an Attach-to-X card is destroyed when its host stops being type X", () => {
    // Artificial: attach-to-Item gear placed onto a Character host. First
    // state-based check sees the host isn't an item and destroys the gear.
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P1 },
        {
          key: "gear",
          def: item({
            name: "Wrong-Type Gear",
            attachTo: "item",
            behavior: { abilities: [NOOP_ABILITY, ON_DISCARDED, ON_DESTROYED] }
          }),
          owner: P1,
          attachedToKey: "host"
        }
      ]
    });

    const before = engine.state.players[P1].influence;

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("gear"), abilityId: "noop" });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("gear")].zone, "discard");
    // Destroyed (CR §507.2e), so both a "when destroyed" and a "put into a
    // discard pile" trigger fire (destroy routes through discard).
    assert.equal(engine.state.players[P1].influence, before + 2);
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

describe("CR §412 — cannot be blocked (unblockability)", () => {
  test("while the whole attacking party cannot be blocked, the defender may not declare blockers", () => {
    const { engine, id } = buildGame({
      activePlayerId: P1,
      cards: [
        {
          key: "ghost",
          def: character({ name: "Ghost", strength: 3, behavior: { keywords: ["cannotBeBlocked"] } }),
          owner: P1
        },
        { key: "guard", def: character({ name: "Guard", strength: 2, life: 4 }), owner: P2, attackEligible: false }
      ]
    });

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("ghost")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);

    // A block is illegal...
    assert.throws(() =>
      engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("guard")] })
    );

    // ...an empty blocking party is fine.
    const before = engine.state.players[P2].influence;
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);

    assert.equal(engine.state.players[P2].influence, before - 3);
  });

  test("a mixed party (only some members unblockable) can still be blocked normally", () => {
    const { engine, id } = buildGame({
      activePlayerId: P1,
      cards: [
        {
          key: "ghost",
          def: character({ name: "Ghost", strength: 3, behavior: { keywords: ["cannotBeBlocked"] } }),
          owner: P1
        },
        { key: "brute", def: character({ name: "Brute", strength: 3, life: 4 }), owner: P1 },
        { key: "guard", def: character({ name: "Guard", strength: 2, life: 6 }), owner: P2, attackEligible: false }
      ]
    });

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("ghost"), id("brute")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);

    assert.doesNotThrow(() =>
      engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("guard")] })
    );
  });
});
