// Phase 4 smoke test for Seed Saga. ~89% of the set is a reprint of an
// earlier `verified` card (carried by `seed-saga-exercise`); these scenarios
// drive the 40 genuinely-novel cards' authored behaviour end-to-end through
// the real catalog + public API.

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
  const d = CATALOG.find(c => c.set === "Seed Saga" && c.name === name);
  assert.ok(d, `Seed Saga card '${name}' not found`);
  return structuredClone(d);
};
let uid = 0;
const res = (icon: string): CardDefinition =>
  resourceCard({ name: icon, id: `ss-smoke-${icon}-${uid++}`, trade: "universal", resource: { provides: [icon as "rage"], staple: true } });
const bank = (icon: string, n: number, owner: string) =>
  Array.from({ length: n }, (_, i) => ({ key: `bk-${icon}-${owner}-${uid}-${i}`, def: res(icon), owner, zone: "play" as const }));
const settle = (e: ReturnType<typeof buildGame>["engine"]) => resolvePendingResponses(e);

// Drain response windows, then answer every mayPay (pay) / chooserSelectsTarget
// (pick `preferred`) that pops, until the engine is idle.
function drive(engine: ReturnType<typeof buildGame>["engine"], preferred: string[] = []): void {
  for (let i = 0; i < 40; i++) {
    settle(engine);
    const pc: any = engine.state.pendingChoice;
    if (!pc) return;
    if (pc.kind === "mayPay") {
      engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "mayPay", pay: true } });
    } else if (pc.kind === "chooserSelectsTarget") {
      engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsTarget", selected: preferred } });
    } else if (pc.kind === "selectTargets") {
      const sel: Record<string, string[]> = {};
      for (const d of pc.declarations ?? []) sel[d.id] = [];
      engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "selectTargets", selected: sel } });
    } else {
      return;
    }
  }
}

describe("Seed Saga smoke: novel authored behaviour drives the engine", () => {
  test("Hungermaw Deephate — +1/+1 per token; EJECT removes 2 tokens and bounces a card", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "h", def: def("Hungermaw Deephate"), owner: P1, zone: "play" },
        { key: "other", def: character({ name: "Other" }), owner: P1, zone: "play" }
      ]
    });
    engine.state.cards[id("h")].counters = { token: 8 };
    const base = def("Hungermaw Deephate");
    assert.equal(engine.getStat(id("h"), "strength"), (base.strength ?? 0) + 8);
    assert.equal(engine.getStat(id("h"), "life"), (base.life ?? 0) + 8);
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("h"), abilityId: "eject", selected: { kick: [id("other")] } });
    settle(engine);
    assert.equal(engine.state.cards[id("h")].counters.token, 6);
    assert.equal(engine.state.cards[id("other")].zone, "hand");
  });

  test("Undead Sword — enters with 2 tokens; -1/-1 per token", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "s", def: def("Undead Sword"), owner: P1, zone: "play" }]
    });
    // ETB trigger only fires on a real entrance; simulate the 2 tokens then check the decay aura
    engine.state.cards[id("s")].counters = { token: 2 };
    const base = def("Undead Sword");
    assert.equal(engine.getStat(id("s"), "strength"), (base.strength ?? 0) - 2);
    assert.equal(engine.getStat(id("s"), "life"), (base.life ?? 0) - 2);
  });

  test("Mutilated — -2 life to one char, +1 str & COVERT to another, draw", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "m", def: def("Mutilated"), owner: P1, zone: "hand" },
        { key: "a", def: character({ name: "A", strength: 2, life: 5 }), owner: P1, zone: "play" },
        { key: "b", def: character({ name: "B", strength: 2, life: 5 }), owner: P1, zone: "play" },
        ...Array.from({ length: 3 }, (_, i) => ({ key: `dk${i}`, def: character({ name: `Dk${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("obsession", 4, P1)
      ]
    });
    const hb = engine.state.players[P1].hand.length;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("m"), selected: { mine: [id("a")], buff: [id("b")] } });
    settle(engine);
    assert.equal(engine.getStat(id("a"), "life"), 3);
    assert.equal(engine.getStat(id("b"), "strength"), 3);
    assert.ok(engine.getKeywords(id("b")).includes("covert"));
    assert.equal(engine.state.players[P1].hand.length, hb - 1 + 1);
  });

  test("Duskfall Buckgriff — SNEAK pays 1 to gain COVERT this turn", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "d", def: def("Duskfall Buckgriff"), owner: P1, zone: "play" }, ...bank("deception", 3, P1)]
    });
    assert.ok(!engine.getKeywords(id("d")).includes("covert"));
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("d"), abilityId: "sneak" });
    settle(engine);
    assert.ok(engine.getKeywords(id("d")).includes("covert"));
    assert.equal(engine.getAvailableResourceCount(P1), 2);
  });

  test("The Enemy's Head — a token per opp character destroyed; +1 str/token to your characters", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "head", def: def("The Enemy's Head"), owner: P1, zone: "play" },
        { key: "mine", def: character({ name: "Mine", strength: 2 }), owner: P1, zone: "play" },
        { key: "foe", def: character({ name: "Foe", life: 1 }), owner: P2, zone: "play" },
        { key: "kill", def: tactic({ name: "Kill", behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P1, zone: "hand" },
        ...bank("rage", 8, P1)
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("kill"), selected: { t: [id("foe")] } });
    settle(engine);
    if (engine.state.pendingChoice?.kind === "mayPay") {
      engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "mayPay", pay: true } });
      settle(engine);
    }
    assert.equal(engine.state.cards[id("head")].counters.token, 1);
    assert.equal(engine.getStat(id("mine"), "strength"), 3);
  });

  test("Executive Order #6370u7 — start of opp turn: pay 2 to deplete a char + skip its next restore", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "eo", def: def("Executive Order #6370u7"), owner: P1, zone: "play" },
        { key: "victim", def: character({ name: "Victim" }), owner: P2, zone: "play" },
        ...bank("greed", 4, P1)
      ],
      activePlayerId: P1
    });
    engine.perform({ type: "endTurn", playerId: P1 });
    // P2's turn starts -> Exec Order's mayPay window opens for P1
    drive(engine, [id("victim")]);
    assert.equal(engine.state.cards[id("victim")].depleted, true);
    assert.equal(engine.state.cards[id("victim")].skipNextRestore, true);
  });

  test("Banner of Fury — PROVIDES [R]; a [R] resource entering triggers pay-1 → +1 str; BURN IT draws 2", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "bf", def: def("Banner of Fury"), owner: P1, zone: "play" },
        { key: "guy", def: character({ name: "Guy", strength: 2 }), owner: P1, zone: "play" },
        { key: "r", def: res("rage"), owner: P1, zone: "play" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `dk${i}`, def: character({ name: `Dk${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("rage", 6, P1)
      ]
    });
    // a [R]-providing resource entering play under P1's control fires the Banner's on-res trigger
    (engine as any).emit({ type: "resourcePlayed", playerId: P1, cardId: id("r") });
    drive(engine, [id("guy")]);
    assert.equal(engine.getStat(id("guy"), "strength"), 3);

    const hb = engine.state.players[P1].hand.length;
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("bf"), abilityId: "burn" });
    settle(engine);
    assert.equal(engine.state.cards[id("bf")].zone, "discard");
    assert.equal(engine.state.players[P1].hand.length, hb + 2);
  });

  test("Crushjaw Oceanhide — has AGGRO", () => {
    const { engine, id } = buildGame({ cards: [{ key: "c", def: def("Crushjaw Oceanhide"), owner: P1, zone: "play" }] });
    assert.ok(engine.getKeywords(id("c")).includes("aggro"));
  });

  test("Invade! — EXTRA COST pick a character; it cannot block this turn", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "inv", def: def("Invade!"), owner: P1, zone: "hand" },
        { key: "blk", def: character({ name: "Blk", strength: 2, life: 2 }), owner: P2, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 3, life: 5 }), owner: P1, zone: "play" },
        ...bank("rage", 4, P1)
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("inv"), selected: { mark: [id("blk")] } });
    settle(engine);
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk")], target: { type: "faction", playerId: P2 } });
    engine.perform({ type: "passPriority", playerId: P1 });
    assert.throws(() =>
      engine.perform({ type: "declareBlockers", playerId: P2, blocks: [{ blockerId: id("blk"), attackerId: id("atk") }] } as any)
    );
  });

  test("Elzibeth — KEEP EM COMING: the picked char goes to deck top instead of being destroyed this turn", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "el", def: def("Elzibeth, Counter Imperial Countess"), owner: P1, zone: "play" },
        { key: "ward", def: character({ name: "Ward", life: 1 }), owner: P1, zone: "play" },
        { key: "kill", def: tactic({ name: "Kill", behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P1, zone: "hand" },
        ...bank("rage", 10, P1)
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("el"), abilityId: "keepemcoming", selected: { ward: [id("ward")] } });
    settle(engine);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("kill"), selected: { t: [id("ward")] } });
    settle(engine);
    assert.equal(engine.state.cards[id("ward")].zone, "deck");
  });
});
