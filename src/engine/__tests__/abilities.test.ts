import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGame,
  character,
  P1,
  P2,
  resolvePendingResponses,
  resourceCard
} from "./support/fixtures.js";

describe("RULES.md §10 — activated abilities", () => {
  test("an ability cannot be used without paying all of its costs", () => {
    const { engine, id } = buildGame({
      cards: [
        {
          key: "caster",
          def: character({
            name: "Caster",
            behavior: {
              abilities: [
                { id: "spend", type: "activated", costs: [{ type: "payResources", amount: 2 }], effects: [] }
              ]
            }
          }),
          owner: P1
        },
        { key: "onlyResource", def: resourceCard({ name: "Only Resource" }), owner: P1 }
      ]
    });

    assert.throws(() =>
      engine.perform({ type: "activateAbility", playerId: P1, cardId: id("caster"), abilityId: "spend" })
    );
  });

  test("paying an ability's numeric cost attaches that many resources to the faction", () => {
    const { engine, id } = buildGame({
      cards: [
        {
          key: "caster",
          def: character({
            name: "Caster",
            behavior: {
              abilities: [
                { id: "spend", type: "activated", costs: [{ type: "payResources", amount: 2 }], effects: [] }
              ]
            }
          }),
          owner: P1
        },
        { key: "r1", def: resourceCard({ name: "R1" }), owner: P1 },
        { key: "r2", def: resourceCard({ name: "R2" }), owner: P1 }
      ]
    });

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("caster"), abilityId: "spend" });
    resolvePendingResponses(engine);

    assert.equal(engine.getAvailableResourceCount(P1), 0);
  });

  test("a deplete-source ('tap') ability depletes its source and cannot be used again until restored", () => {
    const { engine, id } = buildGame({
      cards: [
        {
          key: "tapper",
          def: character({
            name: "Tapper",
            behavior: {
              abilities: [
                { id: "tap", type: "activated", costs: [{ type: "deplete", target: "source" }], effects: [] }
              ]
            }
          }),
          owner: P1
        }
      ]
    });

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("tapper"), abilityId: "tap" });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("tapper")].depleted, true);

    assert.throws(() =>
      engine.perform({ type: "activateAbility", playerId: P1, cardId: id("tapper"), abilityId: "tap" })
    );
  });

  test("only the controller may use a card's ability", () => {
    const { engine, id } = buildGame({
      cards: [
        {
          key: "caster",
          def: character({
            name: "Caster",
            behavior: { abilities: [{ id: "noop", type: "activated", effects: [] }] }
          }),
          owner: P1
        }
      ]
    });

    assert.throws(() =>
      engine.perform({ type: "activateAbility", playerId: P2, cardId: id("caster"), abilityId: "noop" })
    );
  });
});

describe("RULES.md §10 — triggered abilities", () => {
  test("a triggered ability fires automatically when its event occurs, without a separate action", () => {
    const { engine, id } = buildGame({
      cards: [
        {
          key: "watcher",
          def: character({
            name: "Watcher",
            behavior: {
              abilities: [
                {
                  id: "onEnter",
                  type: "triggered",
                  event: "cardEnteredPlay",
                  effects: [{ type: "modifyInfluence", player: "controller", amount: 5 }]
                }
              ]
            }
          }),
          owner: P1
        },
        { key: "newcomer", def: character({ name: "Newcomer" }), owner: P1, zone: "hand" }
      ]
    });

    const before = engine.state.players[P1].influence;

    engine.perform({ type: "playCard", playerId: P1, cardId: id("newcomer") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.players[P1].influence, before + 5);
  });
});

describe("RULES.md §10 — continuous abilities", () => {
  test("a continuous ability's modifier applies to its target while the source is in play", () => {
    const { engine, id } = buildGame({
      cards: [
        {
          key: "buffed",
          def: character({
            name: "Buffed",
            strength: 1,
            behavior: {
              abilities: [
                {
                  id: "selfBuff",
                  type: "continuous",
                  modifiers: [{ target: { type: "selected", id: "target" }, stat: "strength", operation: "add", value: 2 }]
                }
              ]
            }
          }),
          owner: P1
        }
      ]
    });

    assert.equal(engine.getStat(id("buffed"), "strength"), 3);
  });

  test("a continuous ability's modifier does not apply once its source is out of play", () => {
    const { engine, id } = buildGame({
      cards: [
        {
          key: "buffed",
          def: character({
            name: "Buffed",
            strength: 1,
            behavior: {
              abilities: [
                {
                  id: "selfBuff",
                  type: "continuous",
                  modifiers: [{ target: { type: "selected", id: "target" }, stat: "strength", operation: "add", value: 2 }]
                }
              ]
            }
          }),
          owner: P1,
          zone: "discard"
        }
      ]
    });

    assert.equal(engine.getStat(id("buffed"), "strength"), 1);
  });
});
