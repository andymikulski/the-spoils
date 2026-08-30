// Phase 4 smoke test for the Seed 3 set: exercises the AUTHORED behavior in
// data/cards.json (not synthetic fixtures) end-to-end through the public
// engine API, to prove the JSON the coverage effort wrote actually drives
// the engine. One scenario per representative card shape.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import cardsJson from "../../data/cards.js";
import { CARD_CATALOG, SEED3_SAMPLER_DECK } from "../../data.js";
import { createTwoPlayerFactionGame } from "../../engine.js";
import { buildGame, character, item, resourceCard, tactic, P1, P2, resolvePendingResponses } from "./support/fixtures.js";
import type { CardDefinition } from "../../engine.js";

const CATALOG = cardsJson as CardDefinition[];
const def = (name: string): CardDefinition => {
  const d = CATALOG.find(c => c.set === "Seed 3" && c.name === name);
  assert.ok(d, `Seed 3 card '${name}' not found`);
  return structuredClone(d);
};

describe("Seed 3 smoke: authored behavior drives the engine", () => {
  test("Fornicaves aura sets every character's life toward 2 (printedStat)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "cave", def: def("Fornicaves"), owner: P1 },
        { key: "big", def: { ...def("Shieldmane Grandchest") }, owner: P1 },
        { key: "small", def: def("Iohane, the Convex"), owner: P2 }
      ]
    });
    // Shieldmane printed life 6 -> loses (6-2)=4 -> 2 ; Iohane printed 2 -> loses 0 -> 2
    assert.equal(engine.getStat(id("big"), "life"), 2);
    assert.equal(engine.getStat(id("small"), "life"), 2);
  });

  test("Devilfang Thunderhoof ETB tokens scale with [O], and buff strength", () => {
    const obsession = CATALOG.find(c => c.set === "Seed 3" && c.name === "Obsession")!;
    const { engine, id } = buildGame({
      cards: [
        { key: "hoof", def: def("Devilfang Thunderhoof"), owner: P1, zone: "hand" },
        ...Array.from({ length: 6 }, (_, i) => ({
          key: `o${i}`,
          def: structuredClone(obsession),
          owner: P1
        }))
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("hoof") });
    resolvePendingResponses(engine);
    // 6 [O] in play -> 6 tokens
    assert.equal(engine.state.cards[id("hoof")].counters.token, 6);
    // base strength 1 + 6 tokens = 7
    assert.equal(engine.getStat(id("hoof"), "strength"), 7);
  });

  test("The Great Wall terminates a deployed tactic and takes 1 damage", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "wall", def: def("The Great Wall of Keeping Stuff Out"), owner: P1 },
        { key: "unscrup", def: def("Unscrupuls of Victory"), owner: P2, zone: "hand" },
        ...Array.from({ length: 2 }, (_, i) => ({ key: `g${i}`, def: greedRes(), owner: P2 }))
      ],
      activePlayerId: P2
    });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("unscrup") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("unscrup")].zone, "discard");
    assert.equal(engine.state.cards[id("wall")].damage, 1);
  });

  function greedRes(): CardDefinition {
    return {
      id: `smoke-greed-${Math.random()}`, name: "Greed", set: "Seed 3",
      type: "resource", trade: "banker", rarity: "", cost: 0, threshold: 0,
      subtype: [], text: "", resource: { provides: ["greed"], staple: true }
    };
  }

  test("Octo-Ba-Ba DEVOUR: spend a token to inflict 3 damage; feeds on the kill", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "octo", def: def("Octo-Ba-Ba, the Devourer"), owner: P1, attackEligible: false, counters: { token: 1 } },
        // Merbegon printed life 5, no damage modifier — survives 3 damage
        { key: "target", def: def("Merbegon, the Insatiable Taxidermist"), owner: P2, attackEligible: false },
        ...Array.from({ length: 3 }, (_, i) => ({ key: `r${i}`, def: rageRes(), owner: P1 }))
      ]
    });
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("octo"),
      abilityId: "octo-devour",
      selected: { t: [id("target")] }
    });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("target")].damage, 3);
    assert.equal(engine.state.cards[id("octo")].counters.token, 0);
    assert.equal(engine.state.cards[id("octo")].depleted, true);
  });

  function rageRes(): CardDefinition {
    return {
      id: `smoke-rage-${Math.random()}`,
      name: "Rage",
      set: "Seed 3",
      type: "resource",
      trade: "warlord",
      rarity: "",
      cost: 0,
      threshold: 0,
      subtype: [],
      text: "",
      resource: { provides: ["rage"], staple: true }
    };
  }

  test("Delicious Strawberry Flavored Death flips up for its alternate cost", () => {
    const dcards: CardDefinition[] = [];
    const decep = () => ({
      id: `smoke-dec-${dcards.length}-${Math.random()}`,
      name: "Deception",
      set: "Seed 3",
      type: "resource" as const,
      trade: "rogue" as const,
      rarity: "",
      cost: 0,
      threshold: 0 as const,
      subtype: [] as string[],
      text: "",
      resource: { provides: ["deception" as const], staple: true }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "death", def: def("Delicious Strawberry Flavored Death"), owner: P1, faceDown: true },
        { key: "d1", def: decep(), owner: P1 },
        { key: "rogueGuy", def: rogueChar(), owner: P1, attackEligible: false },
        { key: "warlordGuy", def: warlordChar(), owner: P2 },
        { key: "draw1", def: rogueChar(), owner: P1, zone: "deck" }
      ]
    });

    const inflBefore = engine.state.players[P1].influence;
    engine.perform({ type: "flipUp", playerId: P1, cardId: id("death") });
    resolvePendingResponses(engine);

    // flipped up: faction lost 5 influence, non-Rogue characters depleted,
    // Rogue characters not, a card drawn
    assert.equal(engine.state.players[P1].influence, inflBefore - 5);
    assert.equal(engine.state.cards[id("warlordGuy")].depleted, true);
    assert.equal(engine.state.cards[id("rogueGuy")].depleted, false);
    assert.equal(engine.state.cards[id("death")].zone, "discard");
  });

  function rogueChar(): CardDefinition {
    return {
      id: `smoke-rogue-${Math.random()}`, name: "Rogue Smoke", set: "Seed 3",
      type: "character", trade: "rogue", rarity: "common", cost: 1, threshold: 0,
      subtype: [], text: "", strength: 1, life: 2, speed: 2
    };
  }
  function warlordChar(): CardDefinition {
    return {
      id: `smoke-war-${Math.random()}`, name: "Warlord Smoke", set: "Seed 3",
      type: "character", trade: "warlord", rarity: "common", cost: 1, threshold: 0,
      subtype: [], text: "", strength: 1, life: 2, speed: 2
    };
  }

  test("a multi-turn run with several Seed 3 permanents in play never throws", () => {
    const { engine } = buildGame({
      cards: [
        { key: "wall", def: def("Pony Slaystation"), owner: P1 },
        { key: "ray", def: def("Ensmallment Ray"), owner: P1 },
        { key: "shield", def: def("Shieldmane Grandchest"), owner: P1, attackEligible: false },
        { key: "octo", def: def("Octo-Ba-Ba, the Devourer"), owner: P2, attackEligible: false },
        { key: "auto", def: def("God's Autograph"), owner: P2 }
      ]
    });

    // getFlowView + a few phase-legal actions across turns
    for (let i = 0; i < 6; i++) {
      const view = engine.getFlowView();
      assert.ok(view.mode);
      if (view.developAvailable) {
        engine.perform({ type: "chooseDevelop", playerId: view.activePlayerId, choice: { type: "draw" } });
        resolvePendingResponses(engine);
      }
      if (engine.state.pendingChoice) break;
      engine.perform({ type: "endTurn", playerId: engine.state.activePlayerId });
      resolvePendingResponses(engine);
    }
  });

  test("SEED3_SAMPLER_DECK builds a real faction game and reaches turn 1", () => {
    assert.equal(SEED3_SAMPLER_DECK.length, 40);
    const known = new Set(CARD_CATALOG.map(c => c.id));
    assert.deepEqual(
      SEED3_SAMPLER_DECK.filter(id => !known.has(id)),
      [],
      "every sampler id is a real catalog id"
    );

    const engine = createTwoPlayerFactionGame(
      CARD_CATALOG,
      { id: P1, name: "P1", deckDefinitionIds: SEED3_SAMPLER_DECK },
      { id: P2, name: "P2", deckDefinitionIds: SEED3_SAMPLER_DECK },
      { seed: 3 }
    );

    // The Evil Alliance offers a mulligan — clear both, then turn 1 begins.
    engine.perform({ type: "mulligan", playerId: engine.state.setup.phase === "mulligan" ? engine.state.setup.order[0] : P1, cardIds: [] });
    engine.perform({ type: "mulligan", playerId: P2, cardIds: [] });

    assert.equal(engine.state.setup.phase, "complete");
    assert.equal(engine.state.turn, 1);
    assert.equal(engine.state.developsUsedThisTurn, 0);
    // 2 staple resources found + moved to play for each side.
    for (const pid of [P1, P2]) {
      const inPlay = engine.state.players[pid].play
        .map(cid => engine.getDefinition(cid))
        .filter(d => d.type === "resource").length;
      assert.equal(inPlay, 2);
    }
  });

  // Final-review fix: the RECUR effect ("Each OPPONENT reveals their hand
  // ...") must NOT touch the caster's own hand.
  test("Spatchcocking RECUR discards only from the opponent's hand", () => {
    const obs = () => resourceCard({ name: "Obsession", resource: { provides: ["obsession"], staple: true } });
    const { engine, id } = buildGame({
      cards: [
        { key: "spatch", def: def("Spatchcocking"), owner: P1, zone: "discard" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `o${i}`, def: obs(), owner: P1 })),
        { key: "p1keep", def: character({ name: "P1 Keep" }), owner: P1, zone: "hand" },
        { key: "p1item", def: item({ name: "P1 Item" }), owner: P1, zone: "hand" },
        { key: "p2keep", def: character({ name: "P2 Keep" }), owner: P2, zone: "hand" },
        { key: "p2item", def: item({ name: "P2 Item" }), owner: P2, zone: "hand" }
      ]
    });

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("spatch"), abilityId: "spatchcocking-recur" });
    resolvePendingResponses(engine);

    // P2 (the opponent) is the one prompted to keep — a character first.
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget");
    assert.equal(engine.state.pendingChoice?.playerId, P2);
    engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [id("p2keep")] } });
    resolvePendingResponses(engine);
    // ...then an item — decline (keep nothing), so the item is discarded.
    assert.equal(engine.state.pendingChoice?.playerId, P2);
    engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [] } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("p2item")].zone, "discard");
    assert.equal(engine.state.cards[id("p2keep")].zone, "hand");
    // The caster's hand is untouched.
    assert.equal(engine.state.cards[id("p1keep")].zone, "hand");
    assert.equal(engine.state.cards[id("p1item")].zone, "hand");
    assert.equal(engine.state.cards[id("spatch")].zone, "removed");
  });

  // Final-review fix: the FLIP UP rider "... and you may play a resource".
  test("Hilarious Refrigerator Alarm's FLIP UP rider lets the flipper play a resource", () => {
    const eli = () => resourceCard({ name: "Elitism", resource: { provides: ["elitism"], staple: true } });
    const { engine, id } = buildGame({
      cards: [
        { key: "alarm", def: def("Hilarious Refrigerator Alarm"), owner: P1, faceDown: true },
        { key: "e1", def: eli(), owner: P1 },
        { key: "e2", def: eli(), owner: P1 },
        { key: "riderRes", def: resourceCard({ name: "Rider", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" }
      ]
    });

    engine.perform({ type: "flipUp", playerId: P1, cardId: id("alarm"), selected: {} });

    // The rider chooser runs first.
    const riderChoice = engine.state.pendingChoice;
    assert.equal(riderChoice?.kind, "chooserSelectsTarget");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("riderRes")] } });
    resolvePendingResponses(engine);

    // The card's own effects then run — opponent's "may make 3 tokens" — decline it.
    const tokenChoice = engine.state.pendingChoice;
    assert.equal(tokenChoice?.kind, "mayPay");
    engine.perform({ type: "resolvePendingChoice", playerId: tokenChoice!.playerId, choice: { kind: "mayPay", pay: false } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("riderRes")].zone, "play");
    assert.equal(engine.state.cards[id("alarm")].zone, "discard");
  });

  // No prior test drove Geiseric's authored JSON end-to-end.
  test("Geiseric's optional replacement removes an opponent's bounced character from the game", () => {
    const bounce = tactic({
      name: "Bounce",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "geiseric", def: def("Geiseric, the Souleater"), owner: P1, attackEligible: false },
        { key: "victim", def: character({ name: "Victim" }), owner: P2, attackEligible: false },
        { key: "pay", def: resourceCard({ name: "Ob", resource: { provides: ["obsession"], staple: true } }), owner: P1 },
        { key: "bounce", def: bounce, owner: P1, zone: "hand" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("bounce"), selected: { t: [id("victim")] } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice?.kind, "replacementChoice");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "replacementChoice", apply: true } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("victim")].zone, "removed");
    assert.equal(engine.state.players[P2].hand.includes(id("victim")), false);
    assert.equal(engine.state.cards[id("geiseric")].counters.token, 1);
  });

  test("Community Chest: bottomed in the mulligan -> draws from the deck at the start of your turn while you control [D]", () => {
    const { engine, id } = buildGame({
      cards: [
        // chest is at the BOTTOM (it was bottomed in the mulligan)
        { key: "f1", def: character({ name: "F1", id: "cc-f1" }), owner: P1, zone: "deck" },
        { key: "f2", def: character({ name: "F2", id: "cc-f2" }), owner: P1, zone: "deck" },
        { key: "chest", def: def("Community Chest"), owner: P1, zone: "deck" },
        { key: "d1", def: resourceCard({ name: "Dec", id: "cc-dec", resource: { provides: ["deception"], staple: true } }), owner: P1 }
      ]
    });
    engine.state.mulligan[P1] = [id("chest")];
    const handBefore = engine.state.players[P1].hand.length;

    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);

    // the deck-zone trigger drew a card; the chest-boon ability does NOT
    // fire from the deck (no triggerZone -> play only)
    assert.equal(engine.state.players[P1].hand.length, handBefore + 1);
    assert.equal(engine.state.cards[id("chest")].zone, "deck", "stays in the deck");
  });

  test("Community Chest: not bottomed / no [D] -> no deck draw", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "chest", def: def("Community Chest"), owner: P1, zone: "deck" },
        { key: "d1", def: resourceCard({ name: "Dec", id: "cc-dec2", resource: { provides: ["deception"], staple: true } }), owner: P1 },
        { key: "filler", def: character({ name: "Filler", id: "cc-filler2" }), owner: P1, zone: "deck" }
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;

    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);

    assert.equal(engine.state.players[P1].hand.length, handBefore, "no mulligan bottom -> no draw");
  });
});
