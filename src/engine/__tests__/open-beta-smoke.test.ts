// Phase 4 smoke test for Open Beta: drives the AUTHORED behavior in
// data/cards/ end-to-end through the public engine API (not synthetic
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
import { settleTurnStart } from "./support/develop.js";
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
        playerId: engine.state.pendingChoice.playerId,
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
    settleTurnStart(engine);
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

  test("Jackmove — reveal top X of an opponent's deck, keep characters/items, discard the rest", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "jm", def: def("Jackmove"), owner: P1, zone: "play" },
        { key: "ch", def: character({ name: "Stolen Char" }), owner: P2, zone: "deck" },
        { key: "tac", def: tactic({ name: "Stolen Tactic" }), owner: P2, zone: "deck" },
        { key: "deep", def: character({ name: "Untouched" }), owner: P2, zone: "deck" },
        ...bank("deception", 6, P1)
      ]
    });
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("jm"),
      abilityId: "body",
      variables: { x: 2 }
    });
    settle(engine);
    assert.equal(engine.state.cards[id("ch")].zone, "play");
    assert.equal(engine.state.cards[id("ch")].controllerId, P1);
    assert.equal(engine.state.cards[id("tac")].zone, "discard");
    assert.equal(engine.state.cards[id("deep")].zone, "deck");
  });

  test("Sarcophyle Matriculation — gated to 'while you are being attacked'", () => {
    // The installReplacement 'would be destroyed -> take control instead'
    // mechanism itself is covered end-to-end in open-beta-caps.test.ts; here
    // we just confirm the authored battleRole:"defender" gate on the body.
    const { engine, id } = buildGame({
      cards: [
        { key: "sm", def: def("Sarcophyle Matriculation"), owner: P1, zone: "hand" },
        { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
        ...bank("deception", 12, P1)
      ]
    });
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("sm"), selected: { c: [id("foe")] } })
    );
  });

  test("The Billionaire — activate an opponent card's ability, paid for as though you were your opponent", () => {
    const oppEngine = character({
      name: "Opp Engine",
      behavior: { abilities: [{ id: "go", type: "activated", costs: [{ type: "payResources", amount: 1 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "b", def: def("The Billionaire"), owner: P1, zone: "play" },
        { key: "o", def: oppEngine, owner: P2, zone: "play" },
        ...bank("deception", 1, P1),
        ...bank("deception", 1, P2),
        ...Array.from({ length: 2 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P2, zone: "deck" as const }))
      ]
    });
    const p2HandBefore = engine.state.players[P2].hand.length;
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("o"), abilityId: "go" });
    settle(engine);
    // Open Beta prints "as though you were your opponent": the opponent pays, the effect is theirs.
    assert.equal(engine.getAvailableResourceCount(P1), 1);
    assert.equal(engine.getAvailableResourceCount(P2), 0);
    assert.equal(engine.state.players[P2].hand.length, p2HandBefore + 1);
  });

  test("3p1ph4ny 31f — deploy a non-tactic for free on ETB", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "e", def: def("3p1ph4ny 31f"), owner: P1, zone: "hand" },
        { key: "freebie", def: character({ name: "Freebie", cost: 4 }), owner: P1, zone: "hand" },
        ...bank("elitism", 12, P1)
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("e") });
    settle(engine);
    // P1's "deploy a non-tactic for free" prompt
    if (engine.state.pendingChoice?.kind === "deployForFree") {
      engine.perform({
        type: "resolvePendingChoice",
        playerId: P1,
        choice: { kind: "deployForFree", cardId: id("freebie") } as any
      });
    }
    settle(engine);
    // decline the opponent's mirrored prompt(s)
    let g = 0;
    while (engine.state.pendingChoice?.kind === "deployForFree" && g++ < 5) {
      engine.perform({ type: "resolvePendingChoice", playerId: engine.state.pendingChoice.playerId, choice: { kind: "deployForFree" } });
      settle(engine);
    }
    assert.equal(engine.state.cards[id("freebie")].zone, "play");
  });

  test("Free Trade Agreement — start-of-turn modal, option 3 lets each player draw", () => {
    const { engine } = buildGame({
      cards: [
        { key: "fta", def: def("Free Trade Agreement"), owner: P1, zone: "play" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `pa${i}`, def: character({ name: `PA${i}` }), owner: P1, zone: "deck" as const })),
        ...Array.from({ length: 4 }, (_, i) => ({ key: `pb${i}`, def: character({ name: `PB${i}` }), owner: P2, zone: "deck" as const }))
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "endTurn", playerId: P2 });
    settle(engine);
    settleTurnStart(engine);
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsOption");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index: 2 } });
    // each player: up to 2 "may draw" prompts — accept all
    let g = 0;
    for (;;) {
      const pc = engine.state.pendingChoice as { kind: string; playerId: string } | undefined;
      if (!pc || pc.kind !== "mayPay" || g++ >= 8) break;
      engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "mayPay", pay: true } });
      settle(engine);
    }
    settle(engine);
    assert.ok(engine.state.players[P1].hand.length >= 1, "engine.state.players[P1].hand.length >= 1");
  });
});
