// Smoke test for Seed: drives the AUTHORED behavior in data/cards.json
// end-to-end through the public engine API (not synthetic fixtures). One
// scenario per newShape card plus representative capability / idiom cards.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import cardsJson from "../../data/cards.js";
import {
  buildGame,
  character,
  location,
  resourceCard,
  P1,
  P2,
  resolvePendingResponses,
  autoResolveBattle
} from "./support/fixtures.js";
import { developPlay } from "./support/develop.js";
import type { CardDefinition } from "../../engine.js";

const CATALOG = cardsJson as CardDefinition[];
const def = (name: string): CardDefinition => {
  const d = CATALOG.find(c => c.set === "Seed" && c.name === name);
  assert.ok(d, `Seed card '${name}' not found`);
  return structuredClone(d);
};
let uid = 0;
const res = (icon: string): CardDefinition =>
  resourceCard({ name: icon, id: `seed-smoke-${icon}-${uid++}`, trade: "universal", resource: { provides: [icon as "rage"], staple: true } });
const bank = (icon: string, n: number, owner: string) =>
  Array.from({ length: n }, (_, i) => ({ key: `bank-${icon}-${owner}-${uid}-${i}`, def: res(icon), owner, zone: "play" as const }));

describe("Seed smoke: authored behavior drives the engine", () => {
  test("Narrow Passage — a player can declare only one attack per turn", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "np", def: def("Narrow Passage"), owner: P2, zone: "play" },
        { key: "a1", def: character({ name: "A1", strength: 1, life: 2 }), owner: P1, zone: "play" },
        { key: "a2", def: character({ name: "A2", strength: 1, life: 2 }), owner: P1, zone: "play" }
      ]
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("a1")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    assert.throws(() =>
      engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("a2")], target: { type: "faction", playerId: P2 } })
    );
  });

  test("High Court of Demands — ETB draw, and opponents cannot attack your faction", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "hc", def: def("High Court of Demands"), owner: P1, zone: "hand" },
        { key: "a", def: character({ name: "Grunt", strength: 2, life: 2 }), owner: P2, zone: "play" },
        { key: "dk", def: character({ name: "DeckFiller" }), owner: P1, zone: "deck" },
        ...bank("greed", 6, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("hc"), selected: {} });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("hc")].zone, "play");
    // deck card was drawn (hand size: -1 for the played location, +1 for the ETB draw = net same, but the deck card moved)
    assert.equal(engine.state.cards[id("dk")].zone, "hand");
    void handBefore;
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    assert.throws(() =>
      engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("a")], target: { type: "faction", playerId: P1 } })
    );
  });

  test("Courageous Paladin — a blocking magnet soaks all the attacker's battle damage", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "pal", def: def("Courageous Paladin"), owner: P1, zone: "play" },
        { key: "chump", def: character({ name: "Chump", strength: 1, life: 1, speed: 3 }), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Ogre", strength: 3, life: 3, speed: 3 }), owner: P2, zone: "play" }
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("pal"), id("chump")] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    // all 3 of Ogre's damage was forced onto the Paladin (life 3) — Chump untouched.
    assert.equal(engine.state.cards[id("chump")].zone, "play");
    assert.notEqual(engine.state.cards[id("pal")].zone, "play");
  });

  test("Department of Rejections — opponent pays extra to use a character ability", () => {
    // A Seed character with a payResources ability: Gallant Commander (CHARGE!: pay 2).
    const { engine, id } = buildGame({
      cards: [
        { key: "dept", def: def("Department of Rejections"), owner: P1, zone: "play" },
        { key: "gc", def: def("Gallant Commander"), owner: P2, zone: "play" },
        ...bank("rage", 3, P2)
      ],
      activePlayerId: P2,
      turn: 2
    });
    // base cost 2, +2 from Department = 4; P2 has 3 -> unaffordable
    assert.throws(() =>
      engine.perform({ type: "activateAbility", playerId: P2, cardId: id("gc"), abilityId: "charge" })
    );
  });

  test("Auspicious Tax — the attached character's controller pays 3 to attack with it", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host", strength: 2, life: 2 }), owner: P1, zone: "play" },
        { key: "tax", def: def("Auspicious Tax"), owner: P1, zone: "play", attachedToKey: "host" },
        { key: "other", def: character({ name: "Other", strength: 2, life: 2 }), owner: P1, zone: "play" },
        ...bank("greed", 3, P1)
      ]
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("host")], target: { type: "faction", playerId: P2 } });
    assert.equal(engine.getAvailableResourceCount(P1), 0);
  });

  test("Architectural Restitution — redirect the opponent's attack onto a location you bring back", () => {
    const wall = { ...location({ name: "Bulwark", structure: 6 }), id: "seed-smoke-bulwark" };
    const { engine, id } = buildGame({
      cards: [
        { key: "ar", def: def("Architectural Restitution"), owner: P1, zone: "hand" },
        { key: "wall", def: wall, owner: P1, zone: "discard" },
        { key: "atk", def: character({ name: "Raider", strength: 2, life: 2 }), owner: P2, zone: "play" },
        ...bank("greed", 8, P1)
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    // P1 responds with Architectural Restitution during the after-attackers window
    engine.perform({ type: "passPriority", playerId: P2 });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("ar"), selected: { l: [id("wall")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("wall")].zone, "play");
    assert.deepEqual(engine.state.battle?.target, { type: "card", cardId: id("wall") });
  });

  test("Reality Shift — bounce your board, then free-deploy back up to its total cost", () => {
    const c4 = { ...character({ name: "Big", cost: 4, strength: 4, life: 4 }), id: "seed-smoke-big" };
    const c3 = { ...character({ name: "Med", cost: 3, strength: 3, life: 3 }), id: "seed-smoke-med" };
    const { engine, id } = buildGame({
      cards: [
        { key: "rs", def: def("Reality Shift"), owner: P1, zone: "hand" },
        { key: "c4", def: c4, owner: P1, zone: "play" },
        { key: "c3", def: c3, owner: P1, zone: "play" },
        ...bank("obsession", 12, P1)
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("rs"), selected: {} });
    let guard = 0;
    while (++guard < 20) {
      resolvePendingResponses(engine);
      const pc: any = engine.state.pendingChoice;
      if (!pc) break;
      if (pc.kind === "deployForFree") {
        const pickable = (pc.candidates ?? [])[0];
        engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "deployForFree", cardId: pickable } });
      } else break;
    }
    resolvePendingResponses(engine);
    // both were bounced then redeployed for free (pool 7 >= 4 + 3)
    assert.equal(engine.state.cards[id("c4")].zone, "play");
    assert.equal(engine.state.cards[id("c3")].zone, "play");
  });

  test("Surprise! — dig a cheap defender straight into the blocking party", () => {
    const recruit = { ...character({ name: "Recruit", cost: 1, strength: 1, life: 1 }), id: "seed-smoke-recruit" };
    const { engine, id } = buildGame({
      cards: [
        { key: "surprise", def: def("Surprise!"), owner: P1, zone: "hand" },
        { key: "recruit", def: recruit, owner: P1, zone: "deck" },
        { key: "atk", def: character({ name: "Bruiser", strength: 3, life: 3, cost: 5 }), owner: P2, zone: "play" },
        ...bank("deception", 8, P1)
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    engine.perform({ type: "passPriority", playerId: P2 });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("surprise"), selected: { k: [id("atk")] } });
    let guard = 0;
    while (++guard < 15) {
      resolvePendingResponses(engine);
      const pc: any = engine.state.pendingChoice;
      if (!pc) break;
      if (pc.kind === "chooserSelectsTarget") {
        engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsTarget", selected: [id("recruit")] } });
      } else break;
    }
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("recruit")].zone, "play");
    assert.ok(engine.state.battle?.blockingParty.includes(id("recruit")), "engine.state.battle?.blockingParty.includes(id(\"recruit\"))");
  });

  test("Essence of Rage — modal tactic, pick the 'deplete a character' mode", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "eor", def: def("Essence of Rage"), owner: P1, zone: "hand" },
        { key: "victim", def: character({ name: "Victim", strength: 2, life: 2 }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("eor"), selected: { c: [id("victim")] }, mode: 2 } as never);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("victim")].depleted, true);
  });

  test("Adriel, Defender of Marduun — battle damage while blocking is reduced to 0", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "adriel", def: def("Adriel, Defender of Marduun"), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Ogre", strength: 4, life: 4, speed: 3 }), owner: P2, zone: "play" }
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("adriel")] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    // Adriel (life 3) blocked a 4-strength attacker but took 0 damage.
    assert.equal(engine.state.cards[id("adriel")].zone, "play");
    assert.equal(engine.state.cards[id("adriel")].damage ?? 0, 0);
  });

  test("Slick Orator — RECUR from the discard pile draws a card", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "so", def: def("Slick Orator"), owner: P1, zone: "discard" },
        { key: "dk", def: character({ name: "Filler" }), owner: P1, zone: "deck" },
        ...bank("greed", 6, P1)
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("so"), abilityId: "recur" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("so")].zone, "removed");
    assert.equal(engine.state.cards[id("dk")].zone, "hand");
  });

  test("Arrogance — a PROVIDES resource costs 1 influence on entry", () => {
    const devFaction: CardDefinition = {
      id: "seed-smoke-devfac", name: "DevFac", set: "Test", type: "faction", trade: "universal",
      rarity: "common", cost: 0, threshold: 0, subtype: [], text: "",
      faction: {
        startingInfluence: 25,
        setup: { startingResources: { count: 0 }, openingHand: { goingFirst: 0, goingSecond: 0 } },
        turn: { restore: { detachResources: true, restoreNonResources: true }, develop: { choices: [{ type: "playResource", count: 1 }] } }
      }
    };
    const { engine, id } = buildGame({
      playerA: { faction: devFaction },
      cards: [{ key: "arr", def: def("Arrogance"), owner: P1, zone: "hand" }]
    });
    const before = engine.state.players[P1].influence;
    developPlay(engine, P1, id("arr"), false);
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, before - 1);
  });
});
