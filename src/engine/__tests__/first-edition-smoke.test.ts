// Phase 4 smoke test for 1st Edition: drives the AUTHORED behavior of the
// genuinely-novel cards (the 144 reprints are byte-identical to already
// smoke-tested Open Beta cards). Real catalog + public API.

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
  const d = CATALOG.find(c => c.set === "1st Edition" && c.name === name);
  assert.ok(d, `1st Edition card '${name}' not found`);
  return structuredClone(d);
};
let uid = 0;
const res = (icon: string): CardDefinition =>
  resourceCard({ name: icon, id: `fe-smoke-${icon}-${uid++}`, trade: "universal", resource: { provides: [icon as "rage"], staple: true } });
const bank = (icon: string, n: number, owner: string) =>
  Array.from({ length: n }, (_, i) => ({ key: `bk-${icon}-${owner}-${uid}-${i}`, def: res(icon), owner, zone: "play" as const }));
const settle = (e: ReturnType<typeof buildGame>["engine"]) => resolvePendingResponses(e);

describe("1st Edition smoke: novel authored behavior drives the engine", () => {
  test("Ectypal Stave — COUNTERFEIT duplicates the last resolved tactic (cost 2+X)", () => {
    const spark = tactic({
      name: "Spark",
      behavior: { abilities: [{ id: "b", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "sp", def: spark, owner: P1, zone: "hand" },
        { key: "stave", def: def("Ectypal Stave"), owner: P1, zone: "play" },
        ...bank("obsession", 6, P1),
        ...Array.from({ length: 3 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const }))
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("sp") });
    settle(engine);
    assert.equal(engine.state.players[P1].hand.length, 1); // drew 1
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("stave"), abilityId: "counterfeit" });
    settle(engine);
    assert.equal(engine.state.players[P1].hand.length, 2); // duplicate drew again
    assert.equal(engine.state.cards[id("stave")].depleted, true);
  });

  test("Recapitulating Apparition — pay 1 on death to return itself, depleted", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "app", def: def("Recapitulating Apparition"), owner: P1, zone: "play" },
        { key: "kill", def: tactic({
          name: "Kill",
          behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
        }), owner: P1, zone: "hand" },
        ...bank("greed", 8, P1)
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("kill"), selected: { t: [id("app")] } });
    settle(engine);
    if (engine.state.pendingChoice?.kind === "mayPay") {
      engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "mayPay", pay: true } });
    }
    settle(engine);
    assert.equal(engine.state.cards[id("app")].zone, "play");
    assert.equal(engine.state.cards[id("app")].depleted, true);
  });

  test("Resurrection Emporium — a dying character is removed from the game, not discarded", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "emp", def: def("Resurrection Emporium"), owner: P1, zone: "play" },
        { key: "guy", def: character({ name: "Guy", life: 2 }), owner: P1, zone: "play" },
        { key: "kill", def: tactic({
          name: "Kill",
          behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
        }), owner: P1, zone: "hand" },
        ...bank("greed", 8, P1)
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("kill"), selected: { t: [id("guy")] } });
    settle(engine);
    assert.equal(engine.state.cards[id("guy")].zone, "removed");
  });

  test("A Series of Tubes — node aura + REDIRECT the next 1 damage to this card", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "tubes", def: def("A Series of Tubes"), owner: P1, zone: "play" },
        { key: "node", def: character({ name: "Node Buddy", subtype: ["node"], strength: 2, life: 5 }), owner: P1, zone: "play" },
        { key: "ping", def: tactic({
          name: "Ping",
          behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 3 }] }] }
        }), owner: P1, zone: "hand" },
        ...bank("elitism", 8, P1)
      ]
    });
    // node aura: +1/+1
    assert.equal(engine.getStat(id("node"), "strength"), 3);
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("tubes"), abilityId: "redirect", selected: { c: [id("node")] } });
    settle(engine);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("ping"), selected: { t: [id("node")] } });
    settle(engine);
    // 1 of the 3 damage went to Tubes, 2 to the node
    assert.equal(engine.state.cards[id("tubes")].damage, 1);
    assert.equal(engine.state.cards[id("node")].damage, 2);
  });

  test("Spiky Atlasphere — the host may only attack in a 1-member party", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host", strength: 2, life: 2 }), owner: P1, zone: "play" },
        { key: "sphere", def: def("Spiky Atlasphere"), owner: P1, zone: "play", attachedToKey: "host" },
        { key: "buddy", def: character({ name: "Buddy", strength: 2, life: 2 }), owner: P1, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), 3); // +1
    assert.throws(() =>
      engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("host"), id("buddy")], target: { type: "faction", playerId: P2 } })
    );
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("host")], target: { type: "faction", playerId: P2 } });
    assert.ok(engine.state.battle);
  });

  test("Bladefist Doomwing — FIREBREATHING pays X+X and deals X", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "bd", def: def("Bladefist Doomwing"), owner: P1, zone: "play" },
        { key: "foe", def: character({ name: "Foe", life: 9 }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("bd"), abilityId: "firebreathing", variables: { x: 2 }, selected: { c: [id("foe")] } });
    settle(engine);
    assert.equal(engine.state.cards[id("foe")].damage, 2);
    assert.equal(engine.getAvailableResourceCount(P1), 2); // paid 4
  });

  test("Carnival King — CONGA LINE locks the picked character to a 1-member attacking party", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "ck", def: def("Carnival King"), owner: P1, zone: "play" },
        { key: "a1", def: character({ name: "A1", strength: 2, life: 2 }), owner: P1, zone: "play" },
        { key: "a2", def: character({ name: "A2", strength: 2, life: 2 }), owner: P1, zone: "play" },
        ...bank("deception", 6, P1)
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("ck"), abilityId: "conga", selected: { c: [id("a1")] } });
    settle(engine);
    assert.throws(() =>
      engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("a1"), id("a2")], target: { type: "faction", playerId: P2 } })
    );
  });

  test("Bask Bomb — gated to 'while attacking and an opponent is blocking'", () => {
    // The dual-distributeAmong body is covered by first-edition-exercise; here
    // we just confirm the authored battleRole/blocking-party deploy gate.
    const { engine, id } = buildGame({
      cards: [
        { key: "bb", def: def("Bask Bomb"), owner: P1, zone: "hand" },
        { key: "att", def: character({ name: "Att", strength: 3, life: 9 }), owner: P1, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("bb"), selected: { c: [id("att")], bl: [], at: [id("att")] } })
    );
  });
});
