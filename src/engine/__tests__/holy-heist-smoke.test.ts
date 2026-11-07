// Phase 4 smoke test for Holy Heist: drives the AUTHORED behavior in
// data/cards/ end-to-end through the public engine API (not synthetic
// fixtures) to prove the JSON the coverage effort wrote actually works.
// One scenario per representative shape / capability.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import cardsJson from "../../data/cards.js";
import {
  buildGame,
  character,
  factionCard,
  resourceCard,
  P1,
  P2,
  resolvePendingResponses
} from "./support/fixtures.js";
import { developPlay } from "./support/develop.js";
import type { CardDefinition } from "../../engine.js";

const CATALOG = cardsJson as CardDefinition[];
const def = (name: string): CardDefinition => {
  const d = CATALOG.find(c => c.set === "Holy Heist" && c.name === name);
  assert.ok(d, `Holy Heist card '${name}' not found`);
  return structuredClone(d);
};
let uid = 0;
const res = (icon: string, trade: string): CardDefinition =>
  resourceCard({
    name: icon,
    id: `hh-smoke-${icon}-${uid++}`,
    trade: trade as CardDefinition["trade"],
    resource: { provides: [icon as "rage"], staple: true }
  });
const volition = () => res("volition", "universal");
const rage = () => res("rage", "warlord");
const greed = () => res("greed", "banker");
const elitism = () => res("elitism", "gearsmith");

const devFaction = () =>
  factionCard({
    name: "Dev Faction",
    faction: {
      startingInfluence: 25,
      setup: { startingResources: { count: 0 }, openingHand: { goingFirst: 0, goingSecond: 0 } },
      turn: { restore: { detachResources: true, restoreNonResources: true }, develop: { choices: [{ type: "playResource", count: 1 }] } }
    }
  });

describe("Holy Heist smoke: authored behavior drives the engine", () => {
  test("A Boy and His Toy — ETB creates a Micromajig token", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "boy", def: def("A Boy and His Toy"), owner: P1, zone: "hand" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `e${i}`, def: elitism(), owner: P1, zone: "play" as const })),
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("boy") });
    resolvePendingResponses(engine);
    const tokens = Object.values(engine.state.cards).filter(
      c => c.zone === "play" && c.controllerId === P1 && engine.getDefinition(c.id).name === "Micromajig"
    );
    assert.equal(tokens.length, 1, "one Micromajig entered play");
  });

  test("Public Defender Intern — ETB cantrip draws a card", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "pdi", def: def("Public Defender Intern"), owner: P1, zone: "hand" },
        { key: "g1", def: greed(), owner: P1, zone: "play" },
        { key: "g2", def: greed(), owner: P1, zone: "play" },
        { key: "top", def: character({ name: "Top", id: "hh-pdi-top" }), owner: P1, zone: "deck" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("pdi") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("top")].zone, "hand");
  });

  test("Vicious Bruiser — [R]x6 icon gate grants +2/+4", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "vb", def: def("Vicious Bruiser"), owner: P1, zone: "play" },
        ...Array.from({ length: 6 }, (_, i) => ({ key: `r${i}`, def: rage(), owner: P1, zone: "play" as const }))
      ]
    });
    assert.equal(engine.getStat(id("vb"), "strength"), 6, "4 base + 2");
    assert.equal(engine.getStat(id("vb"), "life"), 6, "2 base + 4");
  });

  test("Thabbashite Bowlegger — playing a [V] resource fires its buff trigger", () => {
    const { engine, id } = buildGame({
      playerA: { faction: devFaction() },
      cards: [
        { key: "bow", def: def("Thabbashite Bowlegger"), owner: P1, zone: "play" },
        { key: "ally", def: character({ name: "Ally", id: "hh-bow-ally", strength: 2 }), owner: P1, zone: "play" },
        { key: "v", def: volition(), owner: P1, zone: "hand" }
      ]
    });
    developPlay(engine, P1, id("v"), false);
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice?.kind, "selectTargets", "the optional pick prompt is up");
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "selectTargets", selected: { c: [id("ally")] } }
    });
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("ally"), "strength"), 4, "+2 strength this turn");
  });

  test("Damascus Sword Swinger — +2 strength only while a 'gear' item is attached", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "dss", def: def("Damascus Sword Swinger"), owner: P1, zone: "play" },
        { key: "gear", def: def("Horns of Thabbash"), owner: P1, zone: "play", attachedToKey: "dss" }
      ]
    });
    // Horns: +1 strength. Damascus: +2 while a gear is attached.
    assert.equal(engine.getStat(id("dss"), "strength"), 5 + 1 + 2);
    // detach the gear -> Damascus' bonus falls off
    engine.state.cards[id("gear")].attachedTo = undefined;
    assert.equal(engine.getStat(id("dss"), "strength"), 5);
  });

  test("Guardforce Aggromajig — AGGRO lets it attack the turn it enters play", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "gfa", def: def("Guardforce Aggromajig"), owner: P1, zone: "play", attackEligible: false }]
    });
    assert.equal(engine.hasKeyword(id("gfa"), "aggro"), true);
    assert.doesNotThrow(() =>
      engine.perform({
        type: "declareAttack",
        playerId: P1,
        attackerIds: [id("gfa")],
        target: { type: "faction", playerId: P2 }
      })
    );
  });

  test("Asbestos Drywall — FLIP UP data present; the heal branch removes 2 damage markers", () => {
    const drywall = def("Asbestos Drywall");
    assert.deepEqual(drywall.flipUp, { cost: 3, threshold: "gg" });
    const { engine, id } = buildGame({
      cards: [
        { key: "dw", def: drywall, owner: P1, zone: "hand" },
        { key: "loc", def: def("Marduun Ruins"), owner: P1, zone: "play", damage: 3 },
        ...Array.from({ length: 3 }, (_, i) => ({ key: `g${i}`, def: greed(), owner: P1, zone: "play" as const })),
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("dw"), selected: { loc: [id("loc")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsOption");
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "chooserSelectsOption", index: 0 }
    });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("loc")].damage, 1, "2 damage markers removed");
  });

  test("Bewilderbeast — grows when an opponent discards (cardsDiscarded)", () => {
    const beast = def("Bewilderbeast");
    const discarder = def("Seance Sensor"); // SEIZE: opponent discards a card
    const { engine, id } = buildGame({
      cards: [
        { key: "beast", def: beast, owner: P1, zone: "play" },
        { key: "sensor", def: discarder, owner: P1, zone: "play", counters: { token: 2 } },
        { key: "oppcard", def: character({ name: "Opp Junk", id: "hh-bwb-junk" }), owner: P2, zone: "hand" },
        { key: "o1", def: res("obsession", "arcanist"), owner: P1, zone: "play" },
        { key: "o2", def: res("obsession", "arcanist"), owner: P1, zone: "play" }
      ]
    });
    const s0 = engine.getStat(id("beast"), "strength");
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("sensor"), abilityId: "seance-seize", selected: { p: [engine.state.players[P2].factionId!] } });
    resolvePendingResponses(engine);
    if (engine.state.pendingChoice?.kind === "chooserSelectsTarget") {
      engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [id("oppcard")] } });
      resolvePendingResponses(engine);
    }
    assert.equal(engine.state.cards[id("oppcard")].zone, "discard");
    assert.equal(engine.getStat(id("beast"), "strength"), s0 + 1, "+1 strength from the discard");
  });

  test("Phantasmagoric Tollbooth — an unpaid toll discards the entering opposing character", () => {
    const { engine, id } = buildGame({
      playerB: { influence: 20 },
      cards: [
        { key: "tb", def: def("Phantasmagoric Tollbooth"), owner: P1, zone: "play" },
        { key: "grunt", def: character({ name: "Grunt", id: "hh-tb-grunt", cost: 0, threshold: 0 }), owner: P2, zone: "hand" }
      ],
      activePlayerId: P2
    });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("grunt") });
    resolvePendingResponses(engine);
    // P2 has no resources to pay the toll -> the character is discarded.
    assert.equal(engine.state.cards[id("grunt")].zone, "discard");
  });
});
