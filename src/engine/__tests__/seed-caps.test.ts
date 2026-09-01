// Unit tests for the engine capabilities added for the Seed set coverage
// pass. Card-shaped end-to-end scenarios live in seed-smoke.test.ts.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  autoResolveBattle,
  buildGame,
  character,
  item,
  location,
  resourceCard,
  tactic,
  P1,
  P2,
  resolvePendingResponses
} from "./support/fixtures.js";

// --- preventsAttackOnFaction ---------------------------------------------------

describe("capability: preventsAttackOnFaction", () => {
  test("'your opponents cannot attack your faction'", () => {
    const court = location({
      name: "High Court",
      behavior: {
        abilities: [
          {
            id: "ward",
            type: "continuous",
            modifiers: [],
            preventsAttackOnFaction: { player: "self" }
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "court", def: court, owner: P1 },
        { key: "a", def: character({ name: "Grunt", strength: 2, life: 2 }), owner: P2, zone: "play" }
      ],
      activePlayerId: P2,
      turn: 2
    });
    assert.throws(() =>
      engine.perform({
        type: "declareAttack",
        playerId: P2,
        attackerIds: [id("a")],
        target: { type: "faction", playerId: P1 }
      })
    );
  });

  test("without the ward the same attack is legal", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "Grunt", strength: 2, life: 2 }), owner: P2, zone: "play" }
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({
      type: "declareAttack",
      playerId: P2,
      attackerIds: [id("a")],
      target: { type: "faction", playerId: P1 }
    });
    assert.ok(engine.state.battle);
  });
});

// --- attackLimitPerTurn ------------------------------------------------------

describe("capability: attackLimitPerTurn", () => {
  test("'players can attack only once each turn'", () => {
    const passage = location({
      name: "Narrow Passage",
      behavior: {
        abilities: [
          {
            id: "limit",
            type: "continuous",
            modifiers: [],
            attackLimitPerTurn: 1
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "p", def: passage, owner: P2 },
        { key: "a1", def: character({ name: "A1", strength: 2, life: 2 }), owner: P1, zone: "play" },
        { key: "a2", def: character({ name: "A2", strength: 2, life: 2 }), owner: P1, zone: "play" }
      ]
    });
    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("a1")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    assert.throws(() =>
      engine.perform({
        type: "declareAttack",
        playerId: P1,
        attackerIds: [id("a2")],
        target: { type: "faction", playerId: P2 }
      })
    );
  });

  test("the counter resets at the start of the next turn", () => {
    const passage = location({
      name: "Narrow Passage",
      behavior: {
        abilities: [
          { id: "limit", type: "continuous", modifiers: [], attackLimitPerTurn: 1 }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "p", def: passage, owner: P2 },
        { key: "a1", def: character({ name: "A1", strength: 1, life: 2 }), owner: P1, zone: "play" }
      ]
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("a1")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    engine.state.cards[id("a1")].attackEligibleTurn = engine.state.turn;
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("a1")], target: { type: "faction", playerId: P2 } });
    assert.ok(engine.state.battle);
  });
});

// --- redirectAttackTarget --------------------------------------------------

describe("capability: redirectAttackTarget effect", () => {
  test("repoints the in-flight battle at a location", () => {
    const shifter = item({
      name: "Restitution",
      behavior: {
        abilities: [
          {
            id: "redir",
            type: "triggered",
            event: "battleStarted",
            condition: { type: "battleRole", role: "defender" },
            targets: [{ id: "loc", selector: { type: "location", controller: "self" }, count: 1 }],
            effects: [{ type: "redirectAttackTarget", to: { type: "selected", id: "loc" } }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "s", def: shifter, owner: P1, zone: "play" },
        { key: "wall", def: location({ name: "Wall", structure: 5 }), owner: P1 },
        { key: "a", def: character({ name: "Grunt", strength: 2, life: 2 }), owner: P2, zone: "play" }
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({
      type: "declareAttack",
      playerId: P2,
      attackerIds: [id("a")],
      target: { type: "faction", playerId: P1 }
    });
    if (engine.state.pendingChoice?.kind === "selectTargets") {
      engine.perform({
        type: "resolvePendingChoice",
        playerId: P1,
        choice: { kind: "selectTargets", selected: { loc: [id("wall")] } }
      });
    }
    resolvePendingResponses(engine);
    assert.deepEqual(engine.state.battle?.target, { type: "card", cardId: id("wall") });
  });
});

// --- deployForFree.budget -------------------------------------------------

describe("capability: deployForFree budget (total-cost pool)", () => {
  test("re-prompts until the pool is spent", () => {
    const shift = item({
      name: "Reality Shift",
      behavior: {
        abilities: [
          {
            id: "body",
            type: "activated",
            effects: [
              {
                type: "deployForFree",
                player: "controller",
                maxCost: 99,
                budget: 5,
                free: true
              }
            ]
          }
        ]
      }
    });
    const c2a = character({ name: "C2a", cost: 2 });
    const c2b = character({ name: "C2b", cost: 2 });
    const c2c = character({ name: "C2c", cost: 2 });
    const { engine, id } = buildGame({
      cards: [
        { key: "shift", def: shift, owner: P1, zone: "play" },
        { key: "h1", def: c2a, owner: P1, zone: "hand" },
        { key: "h2", def: c2b, owner: P1, zone: "hand" },
        { key: "h3", def: c2c, owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("shift"), abilityId: "body" });
    resolvePendingResponses(engine);
    // first pick
    assert.equal(engine.state.pendingChoice?.kind, "deployForFree");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id("h1") } });
    // pool is now 3 — still can afford a cost-2 card
    assert.equal(engine.state.pendingChoice?.kind, "deployForFree");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id("h2") } });
    // pool is now 1 — nothing in hand fits, loop ends
    assert.equal(engine.state.pendingChoice, undefined);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("h1")].zone, "play");
    assert.equal(engine.state.cards[id("h2")].zone, "play");
    assert.equal(engine.state.cards[id("h3")].zone, "hand");
  });

  test("declining ends the loop early", () => {
    const shift = item({
      name: "Reality Shift",
      behavior: {
        abilities: [
          {
            id: "body",
            type: "activated",
            effects: [
              { type: "deployForFree", player: "controller", maxCost: 99, budget: 10, free: true }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "shift", def: shift, owner: P1, zone: "play" },
        { key: "h1", def: character({ name: "C", cost: 1 }), owner: P1, zone: "hand" },
        { key: "h2", def: character({ name: "C", cost: 1 }), owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("shift"), abilityId: "body" });
    resolvePendingResponses(engine);
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id("h1") } });
    assert.equal(engine.state.pendingChoice?.kind, "deployForFree");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree" } });
    assert.equal(engine.state.pendingChoice, undefined);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("h1")].zone, "play");
    assert.equal(engine.state.cards[id("h2")].zone, "hand");
  });
});

// --- sumCost expression --------------------------------------------------

describe("capability: sumCost expression", () => {
  test("sums printed numeric cost over an in-play selector", () => {
    const probe = character({
      name: "Probe",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            effects: [
              { type: "bind", id: "x", value: { type: "sumCost", selector: { controller: "self", type: "character" } } },
              { type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: { type: "variable", id: "x" } }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "probe", def: probe, owner: P1, zone: "play" },
        { key: "c5", def: character({ name: "C5", cost: 5 }), owner: P1, zone: "play" },
        { key: "c3", def: character({ name: "C3", cost: 3 }), owner: P1, zone: "play" }
      ]
    });
    const before = engine.state.players[P2].influence;
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("probe"), abilityId: "b" });
    resolvePendingResponses(engine);
    // probe (0) + c5 (5) + c3 (3) = 8
    assert.equal(before - engine.state.players[P2].influence, 8);
  });
});

// --- mustReceiveBattleDamage (Courageous Paladin) -----------------------------

describe("capability: mustReceiveBattleDamage (damage magnet)", () => {
  test("all battle damage in the party must be assigned to the magnet", () => {
    const paladin = character({
      name: "Courageous Paladin",
      strength: 1,
      life: 6,
      behavior: {
        abilities: [
          { id: "magnet", type: "continuous", modifiers: [], mustReceiveBattleDamage: true }
        ]
      }
    });
    const chump = character({ name: "Chump", strength: 1, life: 1 });
    const attacker = character({ name: "Grunt", strength: 3, life: 3, speed: 1 });
    const { engine, id } = buildGame({
      cards: [
        { key: "pal", def: paladin, owner: P1, zone: "play" },
        { key: "chump", def: chump, owner: P1, zone: "play" },
        { key: "a", def: attacker, owner: P2, zone: "play" }
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({
      type: "declareAttack",
      playerId: P2,
      attackerIds: [id("a")],
      target: { type: "faction", playerId: P1 }
    });
    resolvePendingResponses(engine);
    engine.perform({
      type: "declareBlockers",
      playerId: P1,
      blockerIds: [id("pal"), id("chump")]
    });
    resolvePendingResponses(engine);
    const view = engine.getBattleView();
    const src = view?.damageSources.find(s => s.cardId === id("a"));
    assert.ok(src);
    assert.deepEqual(
      src!.legalTargets,
      [{ type: "card", cardId: id("pal") }]
    );
  });
});

// --- abilityCostModifiers scope "opponentCharacters" ------------------------

describe("capability: abilityCostModifiers scope 'opponentCharacters'", () => {
  test("opponents pay +N to use a character's ability", () => {
    const dept = location({
      name: "Department of Rejections",
      behavior: {
        abilities: [
          {
            id: "tax",
            type: "continuous",
            modifiers: [],
            abilityCostModifiers: [{ scope: "opponentCharacters", delta: 2 }]
          }
        ]
      }
    });
    const worker = character({
      name: "Worker",
      behavior: {
        abilities: [
          {
            id: "poke",
            type: "activated",
            costs: [{ type: "payResources", amount: 0 }],
            effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 1 }]
          }
        ]
      }
    });
    const build = (resources: number) =>
      buildGame({
        cards: [
          { key: "d", def: dept, owner: P1 },
          { key: "w", def: worker, owner: P2, zone: "play" },
          ...Array.from({ length: resources }, (_, i) => ({
            key: `r${i}`,
            def: resourceCard({ name: `R${i}` }),
            owner: P2,
            zone: "play" as const
          }))
        ],
        activePlayerId: P2,
        turn: 2
      });

    const poor = build(1);
    assert.throws(() =>
      poor.engine.perform({ type: "activateAbility", playerId: P2, cardId: poor.id("w"), abilityId: "poke" })
    );

    const rich = build(2);
    rich.engine.perform({ type: "activateAbility", playerId: P2, cardId: rich.id("w"), abilityId: "poke" });
    assert.equal(rich.engine.getAvailableResourceCount(P2), 0);
  });
});

// --- searchTax -------------------------------------------------------------

describe("capability: searchTax", () => {
  const tutor = character({
    name: "Tutor",
    behavior: {
      abilities: [
        {
          id: "search",
          type: "activated",
          effects: [
            {
              type: "chooserSelectsTarget",
              chooser: "controller",
              declaration: { id: "found", count: 1, optional: true, selector: { owner: "self", zone: "deck" } },
              effects: [{ type: "moveCard", target: { type: "selected", id: "found" }, to: "hand" }]
            }
          ]
        }
      ]
    }
  });

  test("an unpayable search tax makes the search do nothing", () => {
    const dept = location({
      name: "Department of Rejections",
      behavior: {
        abilities: [
          { id: "tax", type: "continuous", modifiers: [], searchTax: { player: "opponent", amount: 2 } }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "d", def: dept, owner: P1 },
        { key: "t", def: tutor, owner: P2, zone: "play" },
        { key: "deck1", def: character({ name: "D1" }), owner: P2, zone: "deck" }
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "activateAbility", playerId: P2, cardId: id("t"), abilityId: "search" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(engine.state.cards[id("deck1")].zone, "deck");
  });

  test("a payable search tax is charged and the search proceeds", () => {
    const dept = location({
      name: "Department of Rejections",
      behavior: {
        abilities: [
          { id: "tax", type: "continuous", modifiers: [], searchTax: { player: "opponent", amount: 2 } }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "d", def: dept, owner: P1 },
        { key: "t", def: tutor, owner: P2, zone: "play" },
        { key: "deck1", def: character({ name: "D1" }), owner: P2, zone: "deck" },
        { key: "r0", def: resourceCard({ name: "R0" }), owner: P2, zone: "play" },
        { key: "r1", def: resourceCard({ name: "R1" }), owner: P2, zone: "play" }
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "activateAbility", playerId: P2, cardId: id("t"), abilityId: "search" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget");
    engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [id("deck1")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("deck1")].zone, "hand");
    assert.equal(engine.getAvailableResourceCount(P2), 0);
  });
});

// --- attackTax: player "activePlayer" + requiresAttackerMatch ----------------

describe("capability: attackTax activePlayer / requiresAttackerMatch", () => {
  const auspicious = item({
    name: "Auspicious Tax",
    attachTo: "character",
    behavior: {
      abilities: [
        {
          id: "toll",
          type: "continuous",
          modifiers: [],
          attackTax: {
            player: "activePlayer",
            amount: 3,
            requiresAttackerMatch: {
              conditions: [
                { type: "isCard", target: { type: "selected", id: "__candidate" }, other: "attachedTo" }
              ]
            }
          }
        }
      ]
    }
  });

  test("the tax is charged only when the attached character attacks", () => {
    const build = () =>
      buildGame({
        cards: [
          { key: "host", def: character({ name: "Host", strength: 2, life: 2 }), owner: P1, zone: "play" },
          { key: "tax", def: auspicious, owner: P1, zone: "play", attachedToKey: "host" },
          { key: "other", def: character({ name: "Other", strength: 2, life: 2 }), owner: P1, zone: "play" },
          { key: "r0", def: resourceCard({ name: "R0" }), owner: P1, zone: "play" },
          { key: "r1", def: resourceCard({ name: "R1" }), owner: P1, zone: "play" },
          { key: "r2", def: resourceCard({ name: "R2" }), owner: P1, zone: "play" }
        ]
      });

    const withHost = build();
    withHost.engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [withHost.id("host")],
      target: { type: "faction", playerId: P2 }
    });
    assert.equal(withHost.engine.getAvailableResourceCount(P1), 0);

    const withoutHost = build();
    withoutHost.engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [withoutHost.id("other")],
      target: { type: "faction", playerId: P2 }
    });
    assert.equal(withoutHost.engine.getAvailableResourceCount(P1), 3);
  });
});
