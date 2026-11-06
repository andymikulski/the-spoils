// Phase 4 smoke test for 2nd Edition. The set is a pure reprint of
// 1st Edition + 1st Edition Part 2 (every card is a name+text match of an
// already-`verified` card there), so the per-set `*-exercise` pass carries
// the bulk of the verification. These scenarios just drive a representative
// spread of the reprinted behaviour end-to-end through the real catalog +
// public API.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import cardsJson from "../../data/cards.js";
import {
  buildGame,
  character,
  resourceCard,
  P1,
  P2,
  resolvePendingResponses,
  tactic
} from "./support/fixtures.js";
import type { CardDefinition } from "../../engine.js";

const CATALOG = cardsJson as CardDefinition[];
const def = (name: string): CardDefinition => {
  const d = CATALOG.find(c => c.set === "2nd Edition" && c.name === name);
  assert.ok(d, `2nd Edition card '${name}' not found`);
  return structuredClone(d);
};
let uid = 0;
const res = (icon: string): CardDefinition =>
  resourceCard({
    name: icon,
    id: `se-smoke-${icon}-${uid++}`,
    trade: "universal",
    resource: { provides: [icon as "rage"], staple: true }
  });
const bank = (icon: string, n: number, owner: string) =>
  Array.from({ length: n }, (_, i) => ({
    key: `bk-${icon}-${owner}-${uid}-${i}`,
    def: res(icon),
    owner,
    zone: "play" as const
  }));
const settle = (e: ReturnType<typeof buildGame>["engine"]) => resolvePendingResponses(e);

describe("2nd Edition smoke: reprinted behaviour drives the engine", () => {
  test("Clandestine Resort — aura gives every one of your characters +1 life", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "loc", def: def("Clandestine Resort"), owner: P1, zone: "play" },
        { key: "mine", def: character({ name: "Mine", life: 3 }), owner: P1, zone: "play" },
        { key: "theirs", def: character({ name: "Theirs", life: 3 }), owner: P2, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("mine"), "life"), 4);
    assert.equal(engine.getStat(id("theirs"), "life"), 3);
  });

  test("Land Shark — scales +1/+1 per face-down resource each opponent controls", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "shark", def: def("Land Shark"), owner: P1, zone: "play" },
        ...Array.from({ length: 3 }, (_, i) => ({
          key: `fd${i}`,
          def: res("rage"),
          owner: P2,
          zone: "play" as const,
          faceDown: true
        }))
      ]
    });
    assert.equal(engine.getStat(id("shark"), "strength"), 3);
    assert.equal(engine.getStat(id("shark"), "life"), 3);
  });

  test("Armored Keep — your faction at 0 influence does not lose the game", () => {
    const bomb = tactic({
      name: "SelfNuke",
      behavior: {
        abilities: [
          { id: "b", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount: -9 }] }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "keep", def: def("Armored Keep"), owner: P1, zone: "play" },
        { key: "bomb", def: bomb, owner: P1, zone: "play" }
      ],
      playerA: { influence: 5 }
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("bomb"), abilityId: "b" });
    settle(engine);
    assert.ok(engine.state.players[P1].influence <= 0, "engine.state.players[P1].influence <= 0");
    assert.equal(engine.state.winner, undefined);

    engine.state.cards[id("keep")].zone = "discard";
    engine.perform({ type: "endTurn", playerId: P1 });
    settle(engine); // the turn actually ends (and state is checked) after the opponent's window (CR 610.1a)
    assert.equal(engine.state.winner, P2);
  });

  test("Gold Summit — drawing N cards gains your faction N influence", () => {
    const drawTwo = tactic({
      name: "DrawTwo",
      behavior: { abilities: [{ id: "b", type: "activated", effects: [{ type: "draw", player: "controller", amount: 2 }] }] }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "gs", def: def("Gold Summit"), owner: P1, zone: "play" },
        { key: "d2", def: drawTwo, owner: P1, zone: "play" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `dk${i}`, def: character({ name: `Dk${i}` }), owner: P1, zone: "deck" as const }))
      ],
      playerA: { influence: 20 }
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("d2"), abilityId: "b" });
    settle(engine);
    assert.equal(engine.state.players[P1].hand.length, 2);
    assert.equal(engine.state.players[P1].influence, 22);
  });

  test("Dragon Juice — EXTRA COST pick a character; it gets +5 strength this turn", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "dj", def: def("Dragon Juice"), owner: P1, zone: "hand" },
        { key: "guy", def: character({ name: "Guy", strength: 2 }), owner: P1, zone: "play" },
        ...bank("rage", 4, P1)
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("dj"), selected: { target: [id("guy")] } });
    settle(engine);
    assert.equal(engine.getStat(id("guy"), "strength"), 7);
  });

  test("The Ministry of Other Smaller Ministries — each opponent must pay 2 to attack", () => {
    const mkGame = (oppResources: number) =>
      buildGame({
        cards: [
          { key: "min", def: def("The Ministry of Other Smaller Ministries"), owner: P1, zone: "play" },
          { key: "att", def: character({ name: "Att", strength: 3, life: 3 }), owner: P2, zone: "play" },
          ...bank("rage", oppResources, P2)
        ],
        activePlayerId: P2
      });

    const broke = mkGame(0);
    assert.throws(() =>
      broke.engine.perform({
        type: "declareAttack",
        playerId: P2,
        attackerIds: [broke.id("att")],
        target: { type: "faction", playerId: P1 }
      })
    );

    const funded = mkGame(3);
    funded.engine.perform({
      type: "declareAttack",
      playerId: P2,
      attackerIds: [funded.id("att")],
      target: { type: "faction", playerId: P1 }
    });
    assert.ok(funded.engine.state.battle, "funded.engine.state.battle");
    assert.equal(funded.engine.getAvailableResourceCount(P2), 1); // paid 2 of 3
  });

  test("12 Man Brunch of Doom — deplete X, destroy the pick only if its strength <= X+X", () => {
    const mkGame = () =>
      buildGame({
        cards: [
          { key: "brunch", def: def("12 Man Brunch of Doom"), owner: P1, zone: "hand" },
          { key: "fodder", def: character({ name: "Fodder", strength: 1 }), owner: P1, zone: "play" },
          { key: "small", def: character({ name: "Small", strength: 2, life: 5 }), owner: P2, zone: "play" },
          { key: "big", def: character({ name: "Big", strength: 3, life: 5 }), owner: P2, zone: "play" },
          ...bank("obsession", 4, P1)
        ]
      });

    // X = 1 -> threshold 2: Small (str 2) dies.
    const a = mkGame();
    a.engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: a.id("brunch"),
      variables: { x: 1 },
      selected: { depleted: [a.id("fodder")], picked: [a.id("small")] }
    });
    settle(a.engine);
    assert.equal(a.engine.state.cards[a.id("small")].zone, "discard");
    assert.equal(a.engine.state.cards[a.id("fodder")].depleted, true);

    // X = 1 -> threshold 2: Big (str 3) survives.
    const b = mkGame();
    b.engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: b.id("brunch"),
      variables: { x: 1 },
      selected: { depleted: [b.id("fodder")], picked: [b.id("big")] }
    });
    settle(b.engine);
    assert.equal(b.engine.state.cards[b.id("big")].zone, "play");
  });

  test("Air Travel — EXTRA COST pick a character; it gains COVERT this turn and you draw", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "at", def: def("Air Travel"), owner: P1, zone: "hand" },
        { key: "flyer", def: character({ name: "Flyer" }), owner: P1, zone: "play" },
        ...Array.from({ length: 3 }, (_, i) => ({ key: `dk${i}`, def: character({ name: `Dk${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("obsession", 4, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("at"), selected: { target: [id("flyer")] } });
    settle(engine);
    assert.ok(engine.getKeywords(id("flyer")).includes("covert"), "engine.getKeywords(id(\"flyer\")).includes(\"covert\")");
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1); // -Air Travel +draw
  });
});
