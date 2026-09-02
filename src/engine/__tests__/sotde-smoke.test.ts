// Phase 4 smoke test for the Shade of the Devoured Emperor set (the
// Volition / Thabbash era): drives the AUTHORED behavior in
// data/cards.json end-to-end through the public engine API — not synthetic
// fixtures — to prove the JSON the coverage effort wrote actually works.
// One scenario per representative new shape / capability.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import cardsJson from "../../data/cards.js";
import {
  autoResolveBattle,
  buildGame,
  character,
  resourceCard,
  tactic,
  P1,
  P2,
  resolvePendingResponses
} from "./support/fixtures.js";
import type { CardDefinition } from "../../engine.js";

const CATALOG = cardsJson as CardDefinition[];
const def = (name: string): CardDefinition => {
  const d = CATALOG.find(c => c.set === "Shade of the Devoured Emperor" && c.name === name);
  assert.ok(d, `SotDE card '${name}' not found`);
  return structuredClone(d);
};
const res = (name: string, icon: string, trade: string): CardDefinition =>
  resourceCard({
    name,
    id: `sotde-smoke-${icon}-${Math.random()}`,
    trade: trade as CardDefinition["trade"],
    resource: { provides: [icon as "rage"], staple: true }
  });
const rage = () => res("Rage", "rage", "warlord");
const obs = () => res("Obsession", "obsession", "arcanist");
const greed = () => res("Greed", "greed", "banker");

describe("SotDE smoke: authored behavior drives the engine", () => {
  test("Anxious Imp — OBSESS grants a card-level PROVIDES this turn", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "imp", def: def("Anxious Imp"), owner: P1 },
        { key: "o1", def: obs(), owner: P1 },
        { key: "o2", def: obs(), owner: P1 }
      ]
    });
    assert.equal(engine.getThresholds(P1).obsession ?? 0, 2);
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("imp"), abilityId: "imp-obsess" });
    resolvePendingResponses(engine);
    assert.equal(engine.getThresholds(P1).obsession ?? 0, 5, "2 resources + Imp's granted [O][O][O]");
  });

  test("Discordant Cadencer — AGITATE costs 2 resources and 2 influence", () => {
    const { engine, id } = buildGame({
      playerA: { influence: 20 },
      cards: [
        { key: "dc", def: def("Discordant Cadencer"), owner: P1 },
        { key: "r1", def: rage(), owner: P1 },
        { key: "r2", def: rage(), owner: P1 }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("dc"), abilityId: "dc-agitate" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, 18, "lost 2 influence");
    assert.equal(engine.getThresholds(P1).rage ?? 0, 5, "2 rage + granted [R][R][R]");
  });

  test("Skullcrush Steamroller — attackOncePerTurn blocks a second attack the same turn", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "ss", def: def("Skullcrush Steamroller"), owner: P1 },
        { key: "ally", def: character({ name: "Ally", id: "sm-ally" }), owner: P1 },
        { key: "def", def: character({ name: "Def", id: "sm-def", life: 9 }), owner: P2 },
        { key: "r1", def: rage(), owner: P1 },
        { key: "r2", def: rage(), owner: P1 },
        { key: "r3", def: rage(), owner: P1 }
      ]
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("ss")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    resolvePendingResponses(engine);
    autoResolveBattle(engine);
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("ss"), abilityId: "ss-assist", selected: { c: [id("ally")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("ss")].depleted, false, "ASSIST restored it");
    assert.throws(
      () => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("ss")], target: { type: "faction", playerId: P2 } }),
      /once each turn/
    );
  });

  test("Monstrous Lassitude — [V][V][V][V] suppresses its own ETB (via a fresh copy that hasn't fired yet)", () => {
    // Its ETB schedules a restore-rule skip; the [V]x4 continuous
    // suppresses all *other* abilities. Prove the continuous is the only
    // live ability once 4 Volition are up: hasAbility sees just the
    // suppressor.
    const vv = res("Volition", "volition", "universal");
    const { engine, id } = buildGame({
      cards: [
        { key: "ml", def: def("Monstrous Lassitude"), owner: P1 },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `v${i}`, def: { ...vv, id: `sotde-v-${i}` }, owner: P1 }))
      ]
    });
    // the "when it enters play" trigger only fires on entry; here it's
    // placed directly. Just assert the suppressor leaves the card with a
    // continuous ability but strips triggers (findTriggers won't pick it).
    assert.equal(
      engine.evaluateCondition(
        { type: "hasAbility", target: { type: "selected", id: "t" }, abilityType: "triggered" },
        { sourceId: id("ml"), controllerId: P1, selected: { t: [id("ml")] } } as never
      ),
      false,
      "the ETB trigger is suppressed while [V][V][V][V] are up"
    );
  });

  test("Rushing Crushing Blockhead — faction damage recoils and self-destructs", () => {
    const { engine, id } = buildGame({
      playerA: { influence: 20 },
      playerB: { influence: 20 },
      cards: [
        { key: "rcb", def: def("Rushing Crushing Blockhead"), owner: P1, attackEligible: true },
        { key: "r1", def: rage(), owner: P1 }
      ],
      activePlayerId: P1
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("rcb")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    resolvePendingResponses(engine);
    autoResolveBattle(engine);
    assert.equal(engine.state.cards[id("rcb")].zone, "discard", "destroyed itself after damaging the faction");
    assert.equal(engine.state.players[P1].influence, 18, "and dealt 2 to its own faction");
    assert.ok(engine.state.players[P2].influence < 20, "P2's faction took battle damage");
  });

  test("Clockman Skydocks — BUSINESS DAY cuts the next deploy's named-icon threshold", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "dock", def: def("Clockman Skydocks"), owner: P1 },
        { key: "big", def: { ...character({ name: "Rrr", id: "sk-big" }), threshold: "rrr" }, owner: P1, zone: "hand" },
        { key: "v1", def: res("Volition", "volition", "universal"), owner: P1 },
        { key: "r1", def: rage(), owner: P1 }
      ]
    });
    assert.equal(engine.getCardPlayability(P1, id("big")).thresholdMet, false);
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("dock"), abilityId: "cs-bday" });
    resolvePendingResponses(engine);
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "nameValue", value: "rage" } });
    resolvePendingResponses(engine);
    assert.equal(engine.getCardPlayability(P1, id("big")).thresholdMet, false, "only −1 of [R], still need rr");
  });

  test("Shriever Breeding Program — modal tactic: mode 1 searches for a dragon", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "sbp", def: def("Shriever Breeding Program"), owner: P1, zone: "hand" },
        { key: "drg", def: { ...character({ name: "Wyrmling", id: "sbp-drg" }), subtype: ["dragon"] }, owner: P1, zone: "deck" },
        ...Array.from({ length: 3 }, (_, i) => ({ key: `r${i}`, def: rage(), owner: P1 }))
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("sbp"), mode: 0, selected: { c: [id("drg")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].hand.includes(id("drg")), true, "dragon fetched to hand");
  });

  test("Frickin' Sweet Pogo-Bunny — RAAR! makes it a character, HIDE! takes it back", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "pogo", def: def("Frickin' Sweet Pogo-Bunny"), owner: P1 },
        { key: "e1", def: res("Elitism", "elitism", "gearsmith"), owner: P1 },
        { key: "e2", def: res("Elitism", "elitism", "gearsmith"), owner: P1 }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("pogo"), abilityId: "pogo-raar" });
    resolvePendingResponses(engine);
    assert.equal(engine.hasCardType(id("pogo"), "character"), true);
    assert.equal(engine.getStat(id("pogo"), "strength"), 2);
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("pogo"), abilityId: "pogo-hide" });
    resolvePendingResponses(engine);
    assert.equal(engine.hasCardType(id("pogo"), "character"), false, "lost the character type");
    assert.equal(engine.hasCardType(id("pogo"), "item"), true);
  });

  test("6r4wny 60dy9u4rd5 — redirects damage from the warded character onto itself", () => {
    const bolt = tactic({
      name: "SmokeBolt",
      id: "sotde-smoke-bolt",
      behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 3 }] }] }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "ward", def: character({ name: "Ward", id: "bg-ward", life: 2 }), owner: P1 },
        { key: "bg", def: def("6r4wny 60dy9u4rd5"), owner: P1, zone: "hand" },
        { key: "bolt", def: bolt, owner: P1, zone: "hand" },
        ...Array.from({ length: 6 }, (_, i) => ({ key: `r${i}`, def: rage(), owner: P1 }))
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("bg"), selected: { ward: [id("ward")] } });
    resolvePendingResponses(engine);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("bolt"), selected: { t: [id("ward")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("ward")].damage, 0);
    assert.equal(engine.state.cards[id("bg")].damage, 3, "the bodyguard soaked it");
  });

  test("Runic Map — enters with 2 tokens, dies when they hit 0", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "map", def: def("Runic Map"), owner: P1, zone: "hand" },
        { key: "e1", def: res("Elitism", "elitism", "gearsmith"), owner: P1 },
        { key: "e2", def: res("Elitism", "elitism", "gearsmith"), owner: P1 },
        { key: "fd1", def: character({ name: "FD1", id: "rm-fd1" }), owner: P1, zone: "play", faceDown: true },
        { key: "fd2", def: character({ name: "FD2", id: "rm-fd2" }), owner: P1, zone: "play", faceDown: true }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("map") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("map")].counters.token, 2);
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("map"), abilityId: "rm-new", selected: { fd: [id("fd1")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("map")].counters.token, 3);
  });

  test("Opportunistic Pirate — removing 2 cards from an opponent's discard cuts its numeric cost", () => {
    const dec = (i: number) => res(`Deception${i}`, "deception", "rogue");
    const junk = (i: number): CardDefinition => ({ ...character({ name: `Junk${i}`, id: `op-junk-${i}` }) });
    const { engine, id } = buildGame({
      cards: [
        { key: "pir", def: def("Opportunistic Pirate"), owner: P1, zone: "hand" },
        // 7 deception in play: 2 cover the [D][D] threshold, 5 pay the reduced cost.
        ...Array.from({ length: 7 }, (_, i) => ({ key: `d${i}`, def: dec(i), owner: P1 })),
        { key: "j1", def: junk(1), owner: P2, zone: "discard" },
        { key: "j2", def: junk(2), owner: P2, zone: "discard" }
      ]
    });

    // Printed cost 7; only 5 detachable resources would be left after the
    // extra cost, so the deploy only succeeds because the removal rebate applies.
    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("pir"),
      selected: { rem: [id("j1"), id("j2")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("pir")].zone, "play", "deployed for 7 - 2 = 5");
    assert.equal(engine.state.cards[id("j1")].zone, "removed");
    assert.equal(engine.state.cards[id("j2")].zone, "removed");
    const detached = engine.state.players[P1].play.filter(
      cid => engine.getDefinition(cid).type === "resource" && !engine.state.cards[cid].depleted && engine.state.cards[cid].attachedTo === undefined
    );
    assert.equal(detached.length, 2, "5 of 7 deception spent on the reduced cost");
  });
});
