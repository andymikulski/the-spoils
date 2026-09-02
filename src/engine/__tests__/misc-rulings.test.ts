import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildGame, character, P1, P2, resolvePendingResponses, tactic } from "./support/fixtures.js";
import type { ActivatedAbility } from "../../engine.js";

describe("RULES.md §12 — impossible instructions don't invalidate the rest", () => {
  test("an ability that deals lethal damage and then destroys the same target doesn't crash", () => {
    const overkillThenDestroy: ActivatedAbility = {
      id: "overkillThenDestroy",
      type: "activated",
      targets: [{ id: "target", selector: { controller: "opponent" }, count: 1 }],
      effects: [
        { type: "dealDamage", target: { type: "selected", id: "target" }, amount: 99 },
        { type: "destroy", target: { type: "selected", id: "target" } }
      ]
    };

    const { engine, id } = buildGame({
      cards: [
        { key: "caster", def: character({ name: "Caster", behavior: { abilities: [overkillThenDestroy] } }), owner: P1 },
        { key: "victim", def: character({ name: "Victim", life: 3 }), owner: P2 }
      ]
    });

    assert.doesNotThrow(() => {
      engine.perform({
        type: "activateAbility",
        playerId: P1,
        cardId: id("caster"),
        abilityId: "overkillThenDestroy",
        selected: { target: [id("victim")] }
      });
      resolvePendingResponses(engine);
    });

    assert.equal(engine.state.cards[id("victim")].zone, "discard");
  });

  test("destroying an already-destroyed target a second time is a no-op, not an error", () => {
    const destroyTwice: ActivatedAbility = {
      id: "destroyTwice",
      type: "activated",
      targets: [{ id: "target", selector: { controller: "opponent" }, count: 1 }],
      effects: [
        { type: "destroy", target: { type: "selected", id: "target" } },
        { type: "destroy", target: { type: "selected", id: "target" } }
      ]
    };

    const { engine, id } = buildGame({
      cards: [
        { key: "caster", def: character({ name: "Caster", behavior: { abilities: [destroyTwice] } }), owner: P1 },
        { key: "victim", def: character({ name: "Victim" }), owner: P2 }
      ]
    });

    assert.doesNotThrow(() => {
      engine.perform({
        type: "activateAbility",
        playerId: P1,
        cardId: id("caster"),
        abilityId: "destroyTwice",
        selected: { target: [id("victim")] }
      });
      resolvePendingResponses(engine);
    });

    assert.equal(engine.state.cards[id("victim")].zone, "discard");
  });

  test("paying a destroy-cost with an already-gone target doesn't crash the whole activation", () => {
    // A trigger fires from the same batch and kills the intended cost
    // target before the cost itself is paid.
    const sacrificeSomethingElse: ActivatedAbility = {
      id: "sacrifice",
      type: "activated",
      costs: [{ type: "destroy", target: { type: "selected", id: "sac" } }],
      targets: [{ id: "sac", selector: { controller: "self", type: "character" }, count: 1 }],
      effects: []
    };

    const { engine, id } = buildGame({
      cards: [
        { key: "caster", def: character({ name: "Caster", behavior: { abilities: [sacrificeSomethingElse] } }), owner: P1 },
        { key: "fodder", def: character({ name: "Fodder" }), owner: P1 }
      ]
    });

    // Destroy the intended cost target out from under the ability before
    // it's activated, the way an earlier response in the same window might.
    engine.state.cards[id("fodder")].zone = "discard";

    assert.throws(() =>
      engine.perform({
        type: "activateAbility",
        playerId: P1,
        cardId: id("caster"),
        abilityId: "sacrifice",
        selected: { sac: [id("fodder")] }
      })
    );
  });

  test("a random target whose selector matches nothing no-ops instead of crashing the whole activation", () => {
    // e.g. "discard a card at random from your opponent's hand" when their
    // hand is empty — a very ordinary board state, not a bug.
    const discardRandom: ActivatedAbility = {
      id: "discardRandom",
      type: "activated",
      effects: [
        {
          type: "moveCard",
          target: { type: "random", selector: { controller: "opponent", zone: "hand" } },
          to: "discard"
        }
      ]
    };

    const { engine, id } = buildGame({
      cards: [
        { key: "caster", def: character({ name: "Caster", behavior: { abilities: [discardRandom] } }), owner: P1 }
      ]
    });

    assert.equal(engine.state.players[P2].hand.length, 0);

    assert.doesNotThrow(() => {
      engine.perform({ type: "activateAbility", playerId: P1, cardId: id("caster"), abilityId: "discardRandom" });
      resolvePendingResponses(engine);
    });

    assert.equal(engine.state.players[P2].discard.length, 0);
  });

  test("an effect referencing a declined (empty) optional selection no-ops instead of crashing", () => {
    // A card author forgetting to gate a follow-up effect behind
    // `targetExists` shouldn't be able to crash the whole ability just
    // because the optional target was declined.
    const maybeDamage: ActivatedAbility = {
      id: "maybeDamage",
      type: "activated",
      targets: [{ id: "target", selector: { controller: "opponent" }, count: 1, optional: true }],
      effects: [{ type: "dealDamage", target: { type: "selected", id: "target" }, amount: 5 }]
    };

    const { engine, id } = buildGame({
      cards: [
        { key: "caster", def: character({ name: "Caster", behavior: { abilities: [maybeDamage] } }), owner: P1 },
        { key: "bystander", def: character({ name: "Bystander", life: 3 }), owner: P2 }
      ]
    });

    assert.doesNotThrow(() => {
      engine.perform({
        type: "activateAbility",
        playerId: P1,
        cardId: id("caster"),
        abilityId: "maybeDamage",
        selected: { target: [] }
      });
      resolvePendingResponses(engine);
    });

    assert.equal(engine.state.cards[id("bystander")].damage, 0);
  });

  test("a playResource effect whose target left hand before it resolved (LIFO stack) no-ops instead of crashing", () => {
    // The ability locks in `selected.resource` when activated, but (RULES.md
    // §7) its stack item sits under the opponent's response until the chain
    // resolves LIFO — room for the opponent to move that exact card out of
    // P1's hand first.
    const stashAbility: ActivatedAbility = {
      id: "stash",
      type: "activated",
      targets: [{ id: "resource", selector: { controller: "self", zone: "hand" }, count: 1 }],
      effects: [
        { type: "playResource", target: { type: "selected", id: "resource" }, faceDown: true }
      ]
    };

    // A P2 tactic that discards a card from the opponent's (P1's) hand.
    const discarder = tactic({
      name: "Discarder",
      behavior: {
        abilities: [
          {
            id: "discard-it",
            type: "activated",
            targets: [{ id: "target", selector: { controller: "opponent", zone: "hand" }, count: 1 }],
            effects: [{ type: "moveCard", target: { type: "selected", id: "target" }, to: "discard" }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "caster", def: character({ name: "Caster", behavior: { abilities: [stashAbility] } }), owner: P1 },
        { key: "handCard", def: character({ name: "Hand Card" }), owner: P1, zone: "hand" },
        { key: "discarder", def: discarder, owner: P2, zone: "hand" }
      ]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("caster"),
      abilityId: "stash",
      selected: { resource: [id("handCard")] }
    });

    // P2 responds by discarding the very card `stash` is about to play as a
    // resource. LIFO: the discard resolves first, then `stash` finds its
    // target already gone.
    engine.perform({
      type: "playCard",
      playerId: P2,
      cardId: id("discarder"),
      selected: { target: [id("handCard")] }
    });

    assert.doesNotThrow(() => resolvePendingResponses(engine));

    assert.equal(engine.state.cards[id("handCard")].zone, "discard");
  });
});
