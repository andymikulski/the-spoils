// Phase 4 smoke test for Open Beta: drives the AUTHORED behavior in
// data/cards.json end-to-end through the public engine API (not synthetic
// fixtures). One scenario per novel-composition card, plus representative
// capability cards.

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
import type { CardDefinition, CardInstance } from "../../engine.js";

const CATALOG = cardsJson as CardDefinition[];
const def = (name: string): CardDefinition => {
  const d = CATALOG.find(c => c.set === "Open Beta" && c.name === name);
  assert.ok(d, `Open Beta card '${name}' not found`);
  return structuredClone(d);
};
let uid = 0;
const res = (icon: string): CardDefinition =>
  resourceCard({
    name: icon,
    id: `ob-smoke-${icon}-${uid++}`,
    trade: "universal",
    resource: { provides: [icon as "rage"], staple: true }
  });
const bank = (icon: string, n: number, owner: string) =>
  Array.from({ length: n }, (_, i) => ({
    key: `bank-${icon}-${owner}-${uid}-${i}`,
    def: res(icon),
    owner,
    zone: "play" as const
  }));

// Drain both response windows and any auto-answerable follow-up.
const settle = (engine: ReturnType<typeof buildGame>["engine"]) => {
  resolvePendingResponses(engine);
};

describe("Open Beta smoke: authored behavior drives the engine", () => {
  test("Degenerate Molestation — sweep the opponent's hand, one free deploy per discard", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "spell", def: def("Degenerate Molestation"), owner: P1, zone: "play" },
        { key: "h1", def: character({ name: "Cheapy", cost: 0 }), owner: P2, zone: "hand" },
        { key: "h2", def: character({ name: "Cheapy2", cost: 0 }), owner: P2, zone: "hand" }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("spell"), abilityId: "body" });
    let guard = 0;
    while (++guard < 30) {
      settle(engine);
      const pc: any = engine.state.pendingChoice;
      if (!pc) break;
      if (pc.kind === "chooserSelectsTarget") {
        const hand = engine.state.players[P2].hand;
        engine.perform({
          type: "resolvePendingChoice",
          playerId: pc.playerId,
          choice: { kind: "chooserSelectsTarget", selected: hand[0] ? [hand[0]] : [] }
        });
      } else if (pc.kind === "deployForFree") {
        engine.perform({
          type: "resolvePendingChoice",
          playerId: pc.playerId,
          choice: { kind: "deployForFree" }
        });
      } else {
        break;
      }
    }
    assert.equal(engine.state.players[P2].hand.length, 0);
    assert.equal(engine.state.cards[id("h1")].zone, "discard");
    assert.equal(engine.state.cards[id("h2")].zone, "discard");
  });

  test("Ecto-Distillation — name a card, pull one copy to hand and the rest to discard", () => {
    const namedA = character({ name: "Widget", id: "ob-smoke-widget-a" });
    const namedB = character({ name: "Widget", id: "ob-smoke-widget-b" });
    const { engine, id } = buildGame({
      cards: [
        { key: "e", def: def("Ecto-Distillation"), owner: P1, zone: "hand" },
        { key: "wa", def: namedA, owner: P1, zone: "deck" },
        { key: "wb", def: namedB, owner: P1, zone: "deck" },
        { key: "o", def: character({ name: "Other" }), owner: P1, zone: "deck" },
        ...bank("obsession", 8, P1)
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("e") });
    settle(engine);
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "nameValue", value: "Widget" }
    });
    settle(engine);
    if (engine.state.pendingChoice?.kind === "chooserSelectsTarget") {
      engine.perform({
        type: "resolvePendingChoice",
        playerId: P1,
        choice: { kind: "chooserSelectsTarget", selected: [id("wa")] }
      });
    }
    settle(engine);
    if (engine.state.pendingChoice?.kind === "chooserSelectsTarget") {
      engine.perform({
        type: "resolvePendingChoice",
        playerId: engine.state.pendingChoice.playerId,
        choice: { kind: "chooserSelectsTarget", selected: [] }
      });
    }
    settle(engine);
    assert.equal(engine.state.cards[id("wa")].zone, "hand");
    assert.equal(engine.state.cards[id("wb")].zone, "discard");
    assert.equal(engine.state.cards[id("o")].zone, "deck");
  });

  test("Voidal Poisoning — spend tokens across menu options", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "vp", def: def("Voidal Poisoning"), owner: P1, zone: "play" },
        { key: "batt", def: character({ name: "Battery" }), owner: P1, zone: "play" },
        ...Array.from({ length: 4 }, (_, i) => ({
          key: `d${i}`,
          def: character({ name: `D${i}` }),
          owner: P1,
          zone: "deck" as const
        }))
      ]
    });
    engine.state.cards[id("batt")].counters = { token: 3 };
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("vp"), abilityId: "body" });
    settle(engine);
    assert.equal(engine.state.pendingChoice?.kind, "spendCountersMenu");
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "spendCountersMenu", optionIndex: 1, sources: [id("batt"), id("batt")] }
    });
    settle(engine);
    if (engine.state.pendingChoice?.kind === "spendCountersMenu") {
      engine.perform({
        type: "resolvePendingChoice",
        playerId: P1,
        choice: { kind: "spendCountersMenu", optionIndex: null }
      });
    }
    settle(engine);
    assert.equal(engine.state.players[P1].hand.length, 1);
    assert.equal(engine.state.cards[id("batt")].counters.token, 1);
  });

  test("Voidal Replication — duplicate the last tactic resolved this turn", () => {
    const spark = tactic({
      name: "Spark",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            effects: [{ type: "draw", player: "controller", amount: 1 }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "sp", def: spark, owner: P1, zone: "hand" },
        { key: "vr", def: def("Voidal Replication"), owner: P1, zone: "play" },
        ...Array.from({ length: 3 }, (_, i) => ({
          key: `d${i}`,
          def: character({ name: `D${i}` }),
          owner: P1,
          zone: "deck" as const
        }))
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("sp") });
    settle(engine);
    assert.equal(engine.state.players[P1].hand.length, 1);
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("vr"), abilityId: "body" });
    settle(engine);
    assert.equal(engine.state.players[P1].hand.length, 2);
  });

  test("Rudo Mangod — PUNCH deals this card's strength to a target and takes the target's strength", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "rudo", def: def("Rudo Mangod"), owner: P1, zone: "play" },
        { key: "foe", def: character({ name: "Foe", strength: 1, life: 9 }), owner: P2, zone: "play" },
        ...bank("rage", 4, P1)
      ]
    });
    const rudoStr = engine.getStat(id("rudo"), "strength");
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("rudo"),
      abilityId: "punch",
      selected: { c: [id("foe")] }
    });
    settle(engine);
    assert.equal(engine.state.cards[id("foe")].damage, rudoStr);
    assert.equal(engine.state.cards[id("rudo")].damage, 1);
    assert.equal(engine.state.cards[id("rudo")].depleted, true);
  });

  test("Dragon Catheter — start-of-turn token on the strongest character, all scale with tokens", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "dc", def: def("Dragon Catheter"), owner: P1, zone: "play" },
        { key: "big", def: character({ name: "Big", strength: 5, life: 5 }), owner: P1, zone: "play" },
        { key: "small", def: character({ name: "Small", strength: 1, life: 1 }), owner: P2, zone: "play" }
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "endTurn", playerId: P2 });
    settle(engine);
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget");
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "chooserSelectsTarget", selected: [id("big")] }
    });
    settle(engine);
    assert.equal(engine.state.cards[id("big")].counters.token, 1);
    assert.equal(engine.getStat(id("big"), "strength"), 6);
  });

  test("Tactician Vacation — counter a tactic on the stack and lock tactics for the turn", () => {
    const bolt = tactic({
      name: "Bolt",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            targets: [{ id: "t", selector: { type: "character" }, count: 1 }],
            effects: [
              { type: "dealDamage", target: { type: "selected", id: "t" }, amount: 3 }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "bolt", def: bolt, owner: P2, zone: "hand" },
        { key: "vac", def: def("Tactician Vacation"), owner: P1, zone: "hand" },
        { key: "mark", def: character({ name: "Mark", life: 9 }), owner: P1, zone: "play" },
        ...bank("rage", 6, P1)
      ],
      activePlayerId: P2
    });
    engine.perform({
      type: "playCard",
      playerId: P2,
      cardId: id("bolt"),
      selected: { t: [id("mark")] }
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("vac") });
    settle(engine);
    assert.equal(engine.state.cards[id("bolt")].zone, "discard");
    assert.equal(engine.state.cards[id("mark")].damage, 0);
  });

  test("Reckless Challenger — self-destructs at end of turn if it did not attack", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "rc", def: def("Reckless Challenger"), owner: P1, zone: "play" }]
    });
    engine.perform({ type: "endTurn", playerId: P1 });
    settle(engine);
    assert.equal(engine.state.cards[id("rc")].zone, "discard");
  });
});
