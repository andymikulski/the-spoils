// Unit tests for the engine capabilities added for the 1st Edition set
// coverage pass. Card-shaped end-to-end scenarios live in
// first-edition-smoke.test.ts.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGame,
  character,
  item,
  P1,
  P2,
  resolvePendingResponses
} from "./support/fixtures.js";

// --- restrict-party-effect --------------------------------------------------

describe("capability: restrictParty effect", () => {
  test("'this turn, an attacking party including the target must have only 1 member'", () => {
    const king = character({
      name: "Conga King",
      behavior: {
        abilities: [
          {
            id: "conga",
            type: "activated",
            targets: [{ id: "c", selector: { type: "character" }, count: 1 }],
            effects: [
              {
                type: "restrictParty",
                target: { type: "selected", id: "c" },
                role: "attacking",
                minMembers: 1,
                maxMembers: 1,
                duration: { type: "untilEndOfTurn" }
              }
            ]
          }
        ]
      }
    });
    const a1 = character({ name: "A1", strength: 2, life: 2 });
    const a2 = character({ name: "A2", strength: 2, life: 2 });
    const { engine, id } = buildGame({
      cards: [
        { key: "king", def: king, owner: P1, zone: "play" },
        { key: "a1", def: a1, owner: P1, zone: "play" },
        { key: "a2", def: a2, owner: P1, zone: "play" }
      ]
    });
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("king"),
      abilityId: "conga",
      selected: { c: [id("a1")] }
    });
    resolvePendingResponses(engine);
    // a1 can't attack in a 2-member party now
    assert.throws(() =>
      engine.perform({
        type: "declareAttack",
        playerId: P1,
        attackerIds: [id("a1"), id("a2")],
        target: { type: "faction", playerId: P2 }
      })
    );
    // a1 solo is fine
    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("a1")],
      target: { type: "faction", playerId: P2 }
    });
    assert.ok(engine.state.battle);
  });

  test("expires at the start of the next turn", () => {
    const king = character({
      name: "Conga King",
      behavior: {
        abilities: [
          {
            id: "conga",
            type: "activated",
            targets: [{ id: "c", selector: { type: "character" }, count: 1 }],
            effects: [
              { type: "restrictParty", target: { type: "selected", id: "c" }, role: "attacking", maxMembers: 1, duration: { type: "untilEndOfTurn" } }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "king", def: king, owner: P1, zone: "play" },
        { key: "a1", def: character({ name: "A1", strength: 2, life: 2 }), owner: P1, zone: "play" },
        { key: "a2", def: character({ name: "A2", strength: 2, life: 2 }), owner: P1, zone: "play" }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("king"), abilityId: "conga", selected: { c: [id("a1")] } });
    resolvePendingResponses(engine);
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    engine.state.cards[id("a1")].attackEligibleTurn = engine.state.turn;
    engine.state.cards[id("a2")].attackEligibleTurn = engine.state.turn;
    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("a1"), id("a2")],
      target: { type: "faction", playerId: P2 }
    });
    assert.ok(engine.state.battle);
  });
});

// --- partyRestriction scope "attachedParty" -------------------------------

describe("capability: partyRestriction scope 'attachedParty'", () => {
  test("a gear item constrains only a party that includes its host", () => {
    const sphere = item({
      name: "Spiky Sphere",
      attachTo: "character",
      behavior: {
        abilities: [
          {
            id: "solo",
            type: "continuous",
            modifiers: [],
            partyRestriction: { role: "attacking", maxMembers: 1, scope: "attachedParty" }
          }
        ]
      }
    });
    const host = character({ name: "Host", strength: 2, life: 2 });
    const other = character({ name: "Other", strength: 2, life: 2 });
    const bystander = character({ name: "Bystander", strength: 2, life: 2 });
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: host, owner: P1, zone: "play" },
        { key: "sphere", def: sphere, owner: P1, zone: "play", attachedToKey: "host" },
        { key: "other", def: other, owner: P1, zone: "play" },
        { key: "by", def: bystander, owner: P1, zone: "play" }
      ]
    });
    // host + other -> illegal (host's party > 1)
    assert.throws(() =>
      engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("host"), id("other")], target: { type: "faction", playerId: P2 } })
    );
    // other + bystander (no host) -> fine
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("other"), id("by")], target: { type: "faction", playerId: P2 } });
    assert.ok(engine.state.battle);
  });
});

// --- all-damage faction ward (Samuel Gristwalter, engine-derived) ---------

describe("capability: unconditional all-damage faction ward", () => {
  test("reduces all damage inflicted to your faction to 0", () => {
    const samuel = character({
      name: "Samuel",
      behavior: {
        abilities: [
          {
            id: "ward",
            type: "continuous",
            modifiers: [],
            damageModifiers: [{ selector: { type: "faction", controller: "self" }, delta: 0, minAmount: 1, setTo: 0 }]
          }
        ]
      }
    });
    const bolt = item({
      name: "Bolt",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 5 }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "s", def: samuel, owner: P2 },
        { key: "bolt", def: bolt, owner: P1, zone: "play" }
      ]
    });
    const before = engine.state.players[P2].influence;
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("bolt"), abilityId: "b" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P2].influence, before);
  });
});
