// Phase 4 smoke test for 1st Edition Part 2: drives the AUTHORED behavior in
// data/cards.json end-to-end through the public engine API (not synthetic
// fixtures). One scenario per card flagged `reusesProvenShape: false` (a
// genuinely novel composition), plus a few representative capability cards.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import cardsJson from "../../data/cards.js";
import {
  autoResolveBattle,
  buildGame,
  character,
  factionCard,
  location,
  resourceCard,
  P1,
  P2,
  resolvePendingResponses,
  tactic
} from "./support/fixtures.js";
import { settleTurnStart } from "./support/develop.js";
import type { CardDefinition } from "../../engine.js";

const CATALOG = cardsJson as CardDefinition[];
const def = (name: string): CardDefinition => {
  const d = CATALOG.find(c => c.set === "1st Edition Part 2" && c.name === name);
  assert.ok(d, `1st Edition Part 2 card '${name}' not found`);
  return structuredClone(d);
};
let uid = 0;
const res = (icon: string): CardDefinition =>
  resourceCard({
    name: icon,
    id: `p2-smoke-${icon}-${uid++}`,
    trade: "universal",
    resource: { provides: [icon as "rage"], staple: true }
  });
const cycleToTurn = (engine: ReturnType<typeof buildGame>["engine"], active: string) => {
  // Drain to a clean start-of-turn for `active`.
  for (let i = 0; i < 2 && engine.state.activePlayerId !== active; i++) {
    engine.perform({ type: "endTurn", playerId: engine.state.activePlayerId });
    resolvePendingResponses(engine);
  }
};

describe("1st Edition Part 2 smoke: authored behavior drives the engine", () => {
  test("Ambiguity Embiggener — symmetric per-turn hand/deck wheel", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "emb", def: def("Ambiguity Embiggener"), owner: P1, zone: "play" },
        { key: "h1", def: tactic({ name: "H1" }), owner: P1, zone: "hand" },
        { key: "h2", def: tactic({ name: "H2" }), owner: P2, zone: "hand" },
        ...Array.from({ length: 6 }, (_, i) => ({ key: `d${i}`, def: tactic({ name: `D${i}` }), owner: i % 2 ? P2 : P1, zone: "deck" as const }))
      ],
      activePlayerId: P2
    });
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    // P1's turnStarted fires the wheel: active player picks X, then per player.
    assert.equal(engine.state.pendingChoice?.kind, "chooseNumber");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooseNumber", value: 1 } });
    // P1 picks a hand card to bottom
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("h1")] } });
    // P2 picks a hand card to bottom
    engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [id("h2")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("h1")].zone, "deck");
    assert.equal(engine.state.cards[id("h2")].zone, "deck");
    // each drew Y=1 back
    assert.equal(engine.state.players[P1].hand.length, 1);
    assert.equal(engine.state.players[P2].hand.length, 1);
  });

  test("Eccentric Inquisition — voids revealed tactics + grants void-play", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "ei", def: def("Eccentric Inquisition"), owner: P1, zone: "hand" },
        ...Array.from({ length: 4 }, () => 0).map((_, i) => ({ key: `oe${i}`, def: res("obsession"), owner: P1, zone: "play" as const })),
        { key: "t1", def: tactic({ name: "OppTac1", trade: "arcanist" }), owner: P2, zone: "deck" },
        { key: "c1", def: character({ name: "OppChar" }), owner: P2, zone: "deck" },
        { key: "t2", def: tactic({ name: "OppTac2", trade: "arcanist" }), owner: P2, zone: "deck" },
        ...Array.from({ length: 6 }, (_, i) => ({ key: `f${i}`, def: character({ name: `F${i}` }), owner: P2, zone: "deck" as const }))
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("ei"), selected: { voided: [id("t1"), id("t2")] } });
    resolvePendingResponses(engine);
    if (engine.state.pendingChoice?.kind === "reorderDeck") {
      const p = engine.state.pendingChoice;
      engine.perform({ type: "resolvePendingChoice", playerId: p.playerId, choice: { kind: "reorderDeck", order: p.cardIds, bottom: [] } });
      resolvePendingResponses(engine);
    }
    // "Remove ... from the game" is the Out of Game area (CR 403.6), not the Void (E9b, Q4).
    assert.equal(engine.state.cards[id("t1")].zone, "removed");
    assert.equal(engine.state.cards[id("t2")].zone, "removed");
    assert.ok(engine.state.voidPlayGrants.some(g => g.cardId === id("t1") && g.playerId === P1), "engine.state.voidPlayGrants.some(g => g.cardId === id(\"t1\") && g.playerId === P1)");
  });

  test("Cloaked Creeper — its attacking party becomes COVERT", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "creep", def: def("Cloaked Creeper"), owner: P1 },
        { key: "buddy", def: character({ name: "Buddy", strength: 2 }), owner: P1 },
        { key: "blk", def: character({ name: "Blocker", strength: 2, life: 5 }), owner: P2 }
      ]
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("creep"), id("buddy")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    // a non-Covert blocker can no longer legally block the now-Covert party
    assert.throws(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] }));
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);
  });

  test("Insect Appreciator / Anxious Oaf — party-composition gates", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "bug", def: def("Insect Appreciator"), owner: P1 },
        { key: "oaf", def: def("Anxious Oaf"), owner: P1 },
        { key: "x", def: character({ name: "X", strength: 2 }), owner: P1 }
      ]
    });
    // bug alone: odd (1) -> rejected by Insect Appreciator
    assert.throws(() => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("bug")], target: { type: "faction", playerId: P2 } }));
    // bug + x: even (2) and >= 2 -> ok
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("bug"), id("x")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    assert.ok(engine.state.battle, "engine.state.battle");
  });

  test("LeoKaiser — GO MEGA-NEKO-KAISER! buff + solo-attacker block gate", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "leo", def: def("LeoKaiser"), owner: P1 },
        { key: "pk", def: character({ name: "PantherKaiser", subtype: ["kaiser"] }), owner: P1 },
        { key: "tk", def: character({ name: "TigerKaiser", subtype: ["kaiser"] }), owner: P1 },
        { key: "b1", def: character({ name: "B1", life: 20 }), owner: P2 },
        { key: "b2", def: character({ name: "B2", life: 20 }), owner: P2 }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("leo"), abilityId: "mega", selected: { pk: [id("pk")], tk: [id("tk")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("leo"), "strength"), 3 + 8);
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("leo")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    assert.throws(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b1"), id("b2")] }));
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);
  });

  test("Sagacious 31f — searches when its party has 3+ members", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "sag", def: def("Sagacious 31f"), owner: P1 },
        { key: "a", def: character({ name: "A", strength: 1 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 1 }), owner: P1 },
        { key: "d0", def: tactic({ name: "D0" }), owner: P1, zone: "deck" }
      ]
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("sag"), id("a"), id("b")], target: { type: "faction", playerId: P2 } });
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsOption");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index: 0 } });
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("d0")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("d0")].zone, "hand");
  });

  test("Venomous Sacspider — opponent discards their hand on battle-damage death", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "spider", def: def("Venomous Sacspider"), owner: P1, attackEligible: true },
        { key: "killer", def: character({ name: "Killer", strength: 9, life: 9 }), owner: P2 },
        { key: "h1", def: tactic({ name: "H1" }), owner: P2, zone: "hand" },
        { key: "h2", def: tactic({ name: "H2" }), owner: P2, zone: "hand" }
      ],
      activePlayerId: P1
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("spider")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("killer")] });
    autoResolveBattle(engine);
    assert.equal(engine.state.cards[id("spider")].zone, "discard");
    assert.equal(engine.state.players[P2].hand.length, 0);
  });

  test("Hulking Vigilante — self-destructs while you control another owned character", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "hulk", def: def("Hulking Vigilante"), owner: P1, zone: "play" },
        { key: "buddy", def: character({ name: "Buddy", cost: 0 }), owner: P1, zone: "hand" }
      ]
    });
    // deploying Buddy fires a cardEnteredPlay -> Hulking Vigilante's self-check
    engine.perform({ type: "playCard", playerId: P1, cardId: id("buddy") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("hulk")].zone, "discard");
  });

  test("Dethmürderblüdgeon — buffs its host and recurs to hand", () => {
    const zap = tactic({
      name: "Zap",
      behavior: { abilities: [ { id: "z", type: "activated",
        targets: [ { id: "t", selector: { type: "character" }, count: 1 } ],
        effects: [ { type: "dealDamage", target: { type: "selected", id: "t" }, amount: 99 } ] } ] }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host", strength: 3, life: 3 }), owner: P1 },
        { key: "hammer", def: def("Dethmürderblüdgeon, the Craghammer"), owner: P1, attachedToKey: "host" },
        { key: "zap", def: zap, owner: P2, zone: "hand" }
      ],
      activePlayerId: P2
    });
    assert.equal(engine.getStat(id("host"), "strength"), 3 + 2);
    engine.perform({ type: "playCard", playerId: P2, cardId: id("zap"), selected: { t: [id("host")] } });
    resolvePendingResponses(engine);
    // host destroyed -> hammer has no legal host -> would go to discard, redirected to hand
    assert.equal(engine.state.cards[id("host")].zone, "discard");
    assert.equal(engine.state.cards[id("hammer")].zone, "hand");
  });

  test("Wyrmfang Deathskull — attacker picks the only legal blockers", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "wyrm", def: def("Wyrmfang Deathskull"), owner: P1, attackEligible: true },
        { key: "x", def: character({ name: "X", life: 9 }), owner: P2 },
        { key: "y", def: character({ name: "Y", life: 9 }), owner: P2 }
      ],
      activePlayerId: P1
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("wyrm")], target: { type: "faction", playerId: P2 } });
    engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooseChosenBlockers", cardIds: [id("x")] } });
    resolvePendingResponses(engine);
    assert.throws(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("y")] }));
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("x")] });
    autoResolveBattle(engine);
  });

  test("Skin Suit — survivor copies the removed character's rules text", () => {
    const donor = character({
      name: "Donor", strength: 1, life: 1,
      behavior: { abilities: [ { id: "gift", type: "activated", effects: [ { type: "draw", player: "controller", amount: 1 } ] } ] }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "suit", def: def("Skin Suit"), owner: P1, zone: "hand" },
        { key: "mine", def: character({ name: "Mine", strength: 9, life: 5 }), owner: P1 },
        { key: "theirs", def: donor, owner: P2 },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `r${i}`, def: res("rage"), owner: P1, zone: "play" as const })),
        { key: "d0", def: tactic({ name: "D0" }), owner: P1, zone: "deck" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("suit"), selected: { mine: [id("mine")], theirs: [id("theirs")] } });
    resolvePendingResponses(engine);
    // theirs (life 1) took 9 and was removed from the game; mine survives + copies "gift"
    assert.equal(engine.state.cards[id("theirs")].zone, "removed");
    assert.equal(engine.state.cards[id("mine")].zone, "play");
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("mine"), abilityId: "gift" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].hand.length, 1);
  });
});
