// Phase 4 smoke test for the Seed 2 set (the FLIP UP era): drives the
// AUTHORED behavior in data/cards.json end-to-end through the public engine
// API — not synthetic fixtures — to prove the JSON the coverage effort
// wrote actually works. One scenario per representative shape / flagged risk.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import cardsJson from "../../data/cards.js";
import { buildGame, character, factionCard, item, tactic, P1, P2, resolvePendingResponses } from "./support/fixtures.js";
import type { CardDefinition } from "../../engine.js";

const CATALOG = cardsJson as CardDefinition[];
const def = (name: string): CardDefinition => {
  const d = CATALOG.find(c => c.set === "Seed 2" && c.name === name);
  assert.ok(d, `Seed 2 card '${name}' not found`);
  return structuredClone(d);
};
const res = (name: string, icon: string, trade: string): CardDefinition => ({
  id: `smoke-${icon}-${Math.random()}`,
  name,
  set: "Seed 2",
  type: "resource",
  trade: trade as CardDefinition["trade"],
  rarity: "",
  cost: 0,
  threshold: 0,
  subtype: [],
  text: "",
  resource: { provides: [icon as "rage"], staple: true }
});
const greed = () => res("Greed", "greed", "banker");
const rage = () => res("Rage", "rage", "warlord");
const elit = () => res("Elitism", "elitism", "gearsmith");
const obs = () => res("Obsession", "obsession", "arcanist");

describe("Seed 2 smoke: authored behavior drives the engine", () => {
  test("Alluring Quicksand flips a character face-down under its owner", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "qs", def: def("Alluring Quicksand"), owner: P1, zone: "hand" },
        { key: "victim", def: character({ name: "Victim", life: 4 }), owner: P2, damage: 2 },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `g${i}`, def: greed(), owner: P1 }))
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("qs"), selected: { t: [id("victim")] } });
    resolvePendingResponses(engine);

    const v = engine.state.cards[id("victim")];
    assert.equal(v.faceDown, true);
    assert.equal(v.controllerId, P2);
    assert.equal(v.damage, 0, "flip wiped the damage");
    assert.equal(engine.getThresholds(P2).volition, 1);
  });

  test("Surplus Soldier's replacement flips it face-down instead of dying", () => {
    // A synthetic bolt tactic that just deals lethal damage.
    const bolt = tactic({
      name: "Smoke Bolt",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 10 }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "sol", def: def("Surplus Soldier"), owner: P1 },
        { key: "bolt", def: bolt, owner: P2, zone: "hand" }
      ],
      activePlayerId: P2
    });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("bolt"), selected: { t: [id("sol")] } });
    resolvePendingResponses(engine);

    const s = engine.state.cards[id("sol")];
    assert.equal(s.faceDown, true, "ducked into a face-down resource");
    assert.equal(s.zone, "play");
    assert.equal(engine.state.players[P1].discard.includes(id("sol")), false);
  });

  test("Acidic Phlegm hits every character; and flips up for its alternate cost", () => {
    // played from hand
    {
      const { engine, id } = buildGame({
        cards: [
          { key: "ph", def: def("Acidic Phlegm"), owner: P1, zone: "hand" },
          { key: "a", def: character({ name: "A", life: 3 }), owner: P1 },
          { key: "b", def: character({ name: "B", life: 3 }), owner: P2 },
          { key: "r1", def: rage(), owner: P1 },
          { key: "r2", def: rage(), owner: P1 }
        ]
      });
      engine.perform({ type: "playCard", playerId: P1, cardId: id("ph") });
      resolvePendingResponses(engine);
      assert.equal(engine.state.cards[id("a")].damage, 1);
      assert.equal(engine.state.cards[id("b")].damage, 1);
    }
    // flipped up (3 [R][R]); the "play a resource" rider is optional
    {
      const { engine, id } = buildGame({
        cards: [
          { key: "ph", def: def("Acidic Phlegm"), owner: P1, zone: "play", faceDown: true },
          { key: "a", def: character({ name: "A", life: 3 }), owner: P1 },
          { key: "r1", def: rage(), owner: P1 },
          { key: "r2", def: rage(), owner: P1 },
          { key: "r3", def: rage(), owner: P1 },
          { key: "r4", def: rage(), owner: P1 }
        ]
      });
      engine.perform({ type: "flipUp", playerId: P1, cardId: id("ph") });
      if (engine.state.pendingChoice) {
        engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [] } });
      }
      resolvePendingResponses(engine);
      assert.equal(engine.state.cards[id("a")].damage, 1);
      assert.equal(engine.state.cards[id("ph")].zone, "discard");
    }
  });

  test("Gilded Yurt voids a character now and returns it at the start of your next turn", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "yurt", def: def("Gilded Yurt"), owner: P1 },
        { key: "guy", def: character({ name: "Guy" }), owner: P1 }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("yurt"), abilityId: "yurt-chillax", selected: { v: [id("guy")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("guy")].zone, "void");

    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("guy")].zone, "void", "still gone on the opponent's turn");

    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("guy")].zone, "play", "back at the start of P1's next turn");
    assert.equal(engine.state.cards[id("guy")].controllerId, P1);
  });

  test("Golemizer's turnEnding chooser pauses mid-end-turn and resumes cleanly", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "gol", def: def("Golemizer"), owner: P1, attachedToKey: "wearer" },
        { key: "wearer", def: character({ name: "Wearer", speed: 2 }), owner: P1 },
        { key: "e1", def: elit(), owner: P1 }
      ]
    });
    engine.perform({ type: "endTurn", playerId: P1 });
    // the wind-down chooser should be pending, mid end-turn
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsOption");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index: 1 } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("wearer")].counters.token, 1, "token added by the chosen branch");
    // end-turn flow completed
    assert.equal(engine.state.activePlayerId, P2);
  });

  test("Manifest deploys a revealed face-down tactic for free", () => {
    const buried = tactic({
      name: "Buried Ping",
      id: "s2-buried-ping",
      cost: 3,
      threshold: 0,
      behavior: {
        abilities: [{ id: "p", type: "activated", effects: [{ type: "modifyInfluence", player: "opponent", amount: -2 }] }]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "man", def: def("Manifest"), owner: P1, zone: "hand" },
        { key: "fd", def: buried, owner: P1, zone: "play", faceDown: true },
        { key: "o1", def: obs(), owner: P1 },
        { key: "d1", def: character({ name: "Draw", id: "s2-draw" }), owner: P1, zone: "deck" }
      ],
      playerB: { influence: 20 }
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("man"), selected: { rev: [id("fd")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice?.kind, "deployForFree");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id("fd") } });
    resolvePendingResponses(engine);
    // the buried tactic resolved (no numeric cost 3 paid), Manifest drew
    assert.equal(engine.state.players[P2].influence, 18);
    assert.equal(engine.state.players[P1].hand.includes(id("d1")), true);
  });

  test("Crest of Rage: an item's PROVIDES counts for threshold, and its trigger reacts to a rage resource", () => {
    const devFaction = factionCard({
      name: "Dev Faction",
      faction: {
        startingInfluence: 25,
        setup: { startingResources: { count: 0 }, openingHand: { goingFirst: 0, goingSecond: 0 } },
        turn: { restore: { detachResources: true, restoreNonResources: true }, develop: { choices: [{ type: "playResource", count: 1 }] } }
      }
    });
    const { engine, id } = buildGame({
      playerA: { faction: devFaction },
      cards: [
        { key: "crest", def: def("Crest of Rage"), owner: P1 },
        { key: "hand-r", def: rage(), owner: P1, zone: "hand" },
        { key: "deck-c", def: character({ name: "TopHat", id: "s2-tophat" }), owner: P1, zone: "deck" },
        { key: "deck-x", def: character({ name: "Filler", id: "s2-filler" }), owner: P1, zone: "deck" }
      ]
    });
    // Crest of Rage provides [R][R]
    assert.equal(engine.getThresholds(P1).rage, 2);

    engine.perform({ type: "chooseDevelop", playerId: P1, choice: { type: "playResource", cards: [{ cardId: id("hand-r"), faceDown: false }] } });
    resolvePendingResponses(engine);
    // its "search your deck for a character, put on top" trigger fired -> a chooser pending choice
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("deck-c")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].deck[0], id("deck-c"), "moved on top of the deck");
  });

  test("Dying Hero: [R]x9 paragraph lifts its life to 5; decays when left depleted", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "hero", def: def("Dying Hero"), owner: P1, depleted: true },
        ...Array.from({ length: 9 }, (_, i) => ({ key: `r${i}`, def: rage(), owner: P1 }))
      ]
    });
    // printed life 1, +4 from the [R]x9 paragraph
    assert.equal(engine.getStat(id("hero"), "life"), 5);

    engine.perform({ type: "endTurn", playerId: P1 });
    // depleted at end of your turn -> 1 self damage, asserted before the
    // start of P2's turn clears all character damage (CR §602.1a)
    assert.equal(engine.state.cards[id("hero")].damage, 1);
    resolvePendingResponses(engine);
  });

  test("Contrabulous Fabtraption: RUNE OF ANIMATION turns an item into a golem character", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "fab", def: def("Contrabulous Fabtraption"), owner: P1 },
        { key: "cog", def: item({ name: "Cog", id: "smoke-cog", cost: 4 }), owner: P1 }
      ]
    });

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("fab"), abilityId: "rune-of-animation", selected: { it: [id("cog")] } });
    resolvePendingResponses(engine);

    assert.ok(engine.hasCardType(id("cog"), "character"), "gained the character type");
    assert.ok(engine.hasCardType(id("cog"), "item"), "kept its printed type (CR §208.1)");
    assert.equal(engine.getStat(id("cog"), "strength"), 4);
    assert.equal(engine.getStat(id("cog"), "speed"), 3);
    assert.equal(engine.state.cards[id("fab")].zone, "discard", "destroyed itself as the rune's cost");
  });

  test("Mistaken Identity: swaps the extra-cost character pick of a responded-to card", () => {
    const grabber = tactic({
      name: "Grabber",
      behavior: {
        abilities: [
          {
            id: "g",
            type: "activated",
            targets: [{ id: "v", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "dealDamage", target: { type: "selected", id: "v" }, amount: 10 }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "grab", def: grabber, owner: P2, zone: "hand" },
        { key: "mi", def: def("Mistaken Identity"), owner: P1, zone: "hand" },
        { key: "ally", def: character({ name: "Ally", life: 3 }), owner: P1 },
        { key: "chump", def: character({ name: "Chump", life: 3 }), owner: P1 },
        { key: "d1", def: res("Deception", "deception", "rogue"), owner: P1 },
        { key: "d2", def: res("Deception", "deception", "rogue"), owner: P1 }
      ],
      activePlayerId: P2
    });

    engine.perform({ type: "playCard", playerId: P2, cardId: id("grab"), selected: { v: [id("ally")] } });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("mi"), selected: { other: [id("chump")] } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("ally")].zone, "play", "originally-picked Ally spared");
    assert.equal(engine.state.cards[id("chump")].zone, "discard", "Chump took the hit instead");
  });

  test("Mustache Aficionado: MUSTACHE SHOWDOWN runs to a taken card", () => {
    const dc = (name: string, cost: number): CardDefinition => ({
      ...character({ name, life: 3 }), id: `smoke-${name}`, cost
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "afi", def: def("Mustache Aficionado"), owner: P1 },
        { key: "a1", def: dc("A1", 1), owner: P1, zone: "deck" },
        { key: "a2", def: dc("A2", 1), owner: P1, zone: "deck" },
        { key: "a3", def: dc("A3", 6), owner: P1, zone: "deck" },
        { key: "b1", def: dc("B1", 1), owner: P2, zone: "deck" },
        { key: "b2", def: dc("B2", 1), owner: P2, zone: "deck" },
        { key: "b3", def: dc("B3", 1), owner: P2, zone: "deck" }
      ]
    });

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("afi"), abilityId: "mustache-showdown" });
    resolvePendingResponses(engine);
    const pc = () => engine.state.pendingChoice as { kind: string; playerId: string } | undefined;

    assert.equal(pc()?.kind, "partitionCards");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "partitionCards", piles: [[id("a1"), id("a2")], [id("a3")]] } });
    engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "partitionCards", piles: [[id("b1"), id("b2")], [id("b3")]] } });
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "pickPile", index: 0 } });
    engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "pickPile", index: 1 } });
    assert.equal(pc()?.kind, "takeFromPile");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "takeFromPile", cardIds: [id("a3")] } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.players[P1].hand.includes(id("a3")), true);
    assert.equal(engine.state.pendingPartition, undefined);
  });

  test("Witty Worm: revealed from hand as the develop play, deployed for 1", () => {
    const devFaction = factionCard({
      name: "Dev Faction",
      faction: {
        startingInfluence: 25,
        setup: { startingResources: { count: 0 }, openingHand: { goingFirst: 0, goingSecond: 0 } },
        turn: { restore: { detachResources: true, restoreNonResources: true }, develop: { choices: [{ type: "playResource", count: 1 }] } }
      }
    });
    const { engine, id } = buildGame({
      playerA: { faction: devFaction },
      cards: [
        { key: "worm", def: def("Witty Worm"), owner: P1, zone: "hand" },
        { key: "o1", def: obs(), owner: P1 },
        { key: "o2", def: obs(), owner: P1 },
        { key: "o3", def: obs(), owner: P1 }
      ]
    });

    engine.perform({
      type: "chooseDevelop",
      playerId: P1,
      choice: { type: "playResource", cards: [], revealFromHand: { cardId: id("worm") } }
    });
    resolvePendingResponses(engine);
    // ETB optional bounce — decline it
    if (engine.state.pendingChoice) {
      engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [] } });
      resolvePendingResponses(engine);
    }

    assert.equal(engine.state.cards[id("worm")].zone, "play");
    assert.equal(engine.state.developsUsedThisTurn, 1);
  });

  test("Rosy Palmer: destroyed -> take a top-5 character, opponent bottoms the rest", () => {
    const bolt = tactic({
      name: "Rosy Smoke Bolt",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 10 }]
          }
        ]
      }
    });
    const dc = (name: string, kind: "char" | "item"): CardDefinition =>
      kind === "char"
        ? { ...character({ name, life: 3 }), id: `smoke-r-${name}` }
        : { ...item({ name }), id: `smoke-r-${name}` };

    const { engine, id } = buildGame({
      cards: [
        { key: "rosy", def: def("Rosy Palmer, and Her Five Friends"), owner: P1, damage: 0 },
        { key: "bolt", def: bolt, owner: P1, zone: "hand" },
        { key: "c1", def: dc("C1", "char"), owner: P2, zone: "deck" },
        { key: "c2", def: dc("C2", "item"), owner: P2, zone: "deck" },
        { key: "c3", def: dc("C3", "char"), owner: P2, zone: "deck" },
        { key: "c4", def: dc("C4", "char"), owner: P2, zone: "deck" },
        { key: "c5", def: dc("C5", "item"), owner: P2, zone: "deck" },
        { key: "c6", def: dc("C6", "char"), owner: P2, zone: "deck" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("bolt"), selected: { t: [id("rosy")] } });
    resolvePendingResponses(engine);
    const pc = () => engine.state.pendingChoice as { kind: string; playerId: string; cardIds?: string[] } | undefined;

    assert.equal(pc()?.kind, "chooserSelectsTarget");
    // C6 is a character but outside the revealed top 5
    assert.throws(
      () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("c6")] } }),
      /Illegal target/
    );
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("c3")] } });

    assert.equal(pc()?.kind, "reorderDeck");
    assert.equal(pc()?.playerId, P2);
    assert.deepEqual(pc()?.cardIds, [id("c1"), id("c2"), id("c4"), id("c5")]);
    engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "reorderDeck", order: [id("c1"), id("c2"), id("c4"), id("c5")] } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("c3")].zone, "play");
    assert.equal(engine.state.cards[id("c3")].controllerId, P1);
    assert.deepEqual(engine.state.players[P2].deck, [id("c6"), id("c1"), id("c2"), id("c4"), id("c5")]);
  });

  test("Embittered Cadet: a character's PROVIDES [R] counts toward threshold", () => {
    // Metadata-only card (no `behavior` block) — the exercise pass skips it,
    // so pin the PROVIDES-on-a-character path here.
    const { engine, id } = buildGame({
      cards: [
        { key: "cadet", def: def("Embittered Cadet"), owner: P1 },
        { key: "cadet2", def: def("Embittered Cadet"), owner: P1 }
      ]
    });
    assert.equal(engine.getThresholds(P1).rage ?? 0, 2, "two in-play Cadets each provide [R]");
  });

  test("Ass: at end of your turn an opponent hands you a character, then takes Ass", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "ass", def: def("Ass"), owner: P1 },
        { key: "pawn", def: character({ name: "Pawn", id: "s2-ass-pawn" }), owner: P2 }
      ]
    });

    engine.perform({ type: "endTurn", playerId: P1 });

    // Two turnEnding triggers, one controller (P1) -> P1 orders them.
    const pc = () => engine.state.pendingChoice as { kind: string; playerId: string; triggers?: { sourceId: string; abilityId: string }[] } | undefined;
    assert.equal(pc()?.kind, "orderTriggers");
    const borrow = pc()!.triggers!.find(t => t.abilityId === "borrowed-body");
    assert.ok(borrow, "the borrowed-body trigger is in the batch");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "orderTriggers", next: borrow } });

    // "borrowed-body" first: the opponent picks one of their own characters.
    assert.equal(pc()?.kind, "chooserSelectsTarget");
    assert.equal(pc()?.playerId, P2);
    engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [id("pawn")] } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("pawn")].controllerId, P1, "P1 borrowed the pawn");
    assert.equal(engine.state.cards[id("ass")].controllerId, P2, "and handed Ass to the opponent");
    assert.equal(engine.state.activePlayerId, P2);
  });
});
