// Covers the 10 faction cards reclassified from "vanilla" to "classified"
// (data/card-coverage.json — they only cloned Tournament Faction because
// their printed `text` was blank when first classified) and then authored:
// Lugubrian Council Expedition Division, The Primitive Tribes of Thabbash,
// Unlikely Heroes, Alliance of Handy Weirdos, Drowned Catacombs, Hall of
// Great Justice, Moist Cave of the Darkpump, Order of the Golden String,
// Defenders of Marduun, Legions of Chaos.
//
// Part 1 proves the five small engine-vocabulary additions this authoring
// needed, against synthetic fixtures (RULES.md §3.6). Part 2 drives each
// faction's real authored data (data/cards.json) end-to-end through the
// public API — this is the "verify" step (BEHAVIORS.md -> Coverage
// workflow) for `reusesProvenShape: false` cards The Primitive Tribes of
// Thabbash and Unlikely Heroes, and a smoke check for the other 8.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import cardsJson from "../../data/cards.js";
import {
  buildGame,
  character,
  defaultFactionDefinition,
  factionCard,
  resourceCard,
  tactic,
  P1,
  P2,
  resolvePendingResponses
} from "./support/fixtures.js";
import { createFactionGame } from "../../engine.js";
import type { CardDefinition } from "../../engine.js";

const CATALOG = cardsJson as CardDefinition[];
const def = (name: string): CardDefinition => {
  const d = CATALOG.find(c => c.type === "faction" && c.name === name);
  assert.ok(d, `Faction card '${name}' not found`);
  return structuredClone(d);
};

const settle = (engine: ReturnType<typeof buildGame>["engine"]) => resolvePendingResponses(engine);

/** Drain response windows, then answer every mayPay (pay) / chooserSelectsTarget (pick `preferred`) that pops. */
function drive(engine: ReturnType<typeof buildGame>["engine"], preferred: string[] = []): void {
  for (let i = 0; i < 40; i++) {
    settle(engine);
    const pc: any = engine.state.pendingChoice;
    if (!pc) return;
    if (pc.kind === "mayPay") {
      engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "mayPay", pay: true } });
    } else if (pc.kind === "chooserSelectsTarget") {
      engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsTarget", selected: preferred } });
    } else {
      return;
    }
  }
}

let uid = 0;
const staple = (name: string, icon: string): CardDefinition =>
  resourceCard({ name, id: `fga-${icon}-${uid++}`, trade: "universal", resource: { provides: [icon as "rage"], staple: true } });
const bank = (name: string, icon: string, n: number, owner: string) =>
  Array.from({ length: n }, (_, i) => ({ key: `fga-bank-${icon}-${owner}-${uid}-${i}`, def: staple(name, icon), owner, zone: "play" as const }));

describe("faction setup/vocabulary additions (RULES.md §3.6)", () => {
  test("startingResources.slots faceDown puts that slot's resource into play face-down", () => {
    const faction = factionCard({
      name: "FaceDownSlot",
      faction: defaultFactionDefinition({
        setup: {
          startingResources: {
            count: 2,
            slots: [
              { kind: "resource", name: "Obsession", faceDown: true },
              { kind: "resource", staple: true }
            ]
          },
          openingHand: { goingFirst: 2, goingSecond: 2 }
        }
      })
    });
    const obsession = resourceCard({ id: "fdown-obsession", name: "Obsession", resource: { provides: ["obsession"], staple: false } });
    const rage = resourceCard({ id: "fdown-rage", name: "Rage", resource: { provides: ["rage"], staple: true } });
    const filler = character({ id: "fdown-filler", name: "Filler" });

    const engine = createFactionGame(
      [faction, obsession, rage, filler],
      [{ id: P1, name: "Alice", deckDefinitionIds: [faction.id, obsession.id, rage.id, filler.id, filler.id] },
      { id: P2, name: "Bob", deckDefinitionIds: [faction.id, obsession.id, rage.id, filler.id, filler.id] }],
      { firstPlayerId: P1 }
    );

    const inPlay = engine.state.players[P1].play.map(cid => engine.state.cards[cid]);
    const obsessionInPlay = inPlay.find(c => engine.getDefinition(c.id).name === "Obsession");
    const rageInPlay = inPlay.find(c => engine.getDefinition(c.id).name === "Rage");
    assert.ok(obsessionInPlay, "obsessionInPlay");
    assert.equal(obsessionInPlay!.faceDown, true, "the Obsession slot is face-down");
    assert.ok(rageInPlay, "rageInPlay");
    assert.equal(rageInPlay!.faceDown, false, "the staple slot is face-up");
  });

  test("TargetDeclaration.distinctTrades rejects two picks that share a trade", () => {
    const faction = factionCard({
      name: "RallyFaction",
      faction: defaultFactionDefinition({
        abilities: [
          {
            id: "rally",
            type: "activated",
            targets: [{ id: "c", selector: { controller: "self", type: "character" }, count: 2, distinctTrades: true }],
            effects: []
          }
        ]
      })
    });
    const a = character({ name: "A", trade: "rogue" as CardDefinition["trade"] });
    const b = character({ name: "B", trade: "rogue" as CardDefinition["trade"] });
    const c = character({ name: "C", trade: "warlord" as CardDefinition["trade"] });

    const { engine, id } = buildGame({
      playerA: { faction },
      cards: [
        { key: "a", def: a, owner: P1, zone: "play" },
        { key: "b", def: b, owner: P1, zone: "play" },
        { key: "c", def: c, owner: P1, zone: "play" }
      ]
    });

    assert.throws(() =>
      engine.perform({
        type: "activateAbility",
        playerId: P1,
        cardId: id("__factionA"),
        abilityId: "rally",
        selected: { c: [id("a"), id("b")] }
      })
    );

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("__factionA"),
      abilityId: "rally",
      selected: { c: [id("a"), id("c")] }
    });
    settle(engine);
  });

  test("sharesTradeWithAny excludes a deck character sharing a trade with an in-play one", () => {
    const faction = factionCard({
      name: "SearchFaction",
      faction: defaultFactionDefinition({
        abilities: [
          {
            id: "search",
            type: "activated",
            targets: [
              {
                id: "c",
                selector: {
                  controller: "self",
                  zone: "deck",
                  type: "character",
                  conditions: [
                    { type: "not", condition: { type: "sharesTradeWithAny", among: { controller: "self", type: "character" } } }
                  ]
                },
                count: 1
              }
            ],
            effects: [{ type: "moveCard", target: { type: "selected", id: "c" }, to: "hand" }]
          }
        ]
      })
    });
    const inPlayRogue = character({ name: "InPlay", trade: "rogue" as CardDefinition["trade"] });
    const deckRogue = character({ name: "DeckRogue", trade: "rogue" as CardDefinition["trade"] });
    const deckWarlord = character({ name: "DeckWarlord", trade: "warlord" as CardDefinition["trade"] });

    const { engine, id } = buildGame({
      playerA: { faction },
      cards: [
        { key: "inplay", def: inPlayRogue, owner: P1, zone: "play" },
        { key: "deckrogue", def: deckRogue, owner: P1, zone: "deck" },
        { key: "deckwarlord", def: deckWarlord, owner: P1, zone: "deck" }
      ]
    });

    // The same-trade deck character is illegal to pick...
    assert.throws(() =>
      engine.perform({
        type: "activateAbility",
        playerId: P1,
        cardId: id("__factionA"),
        abilityId: "search",
        selected: { c: [id("deckrogue")] }
      })
    );
    // ...but the different-trade one is legal.
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("__factionA"),
      abilityId: "search",
      selected: { c: [id("deckwarlord")] }
    });
    settle(engine);
    assert.equal(engine.state.cards[id("deckwarlord")].zone, "hand");
  });

  test("faction.flipUpTax surcharges a FLIP UP deploy, scoped by cardType", () => {
    const faction = factionCard({
      name: "TaxFaction",
      faction: defaultFactionDefinition({
        flipUpTax: { amount: 2, cardType: "tactic" }
      })
    });
    const flipTactic = tactic({ name: "FlipTactic", flipUp: { cost: 1, threshold: 0 }, behavior: { abilities: [{ id: "b", type: "activated", effects: [] }] } });

    const { engine, id } = buildGame({
      playerA: { faction },
      cards: [
        { key: "t", def: flipTactic, owner: P1, zone: "play", faceDown: true },
        ...bank("Rage", "rage", 1, P1)
      ]
    });

    // Flip up costs the printed 1 + the faction's 2 tactic surcharge = 3; only
    // 1 banked resource plus the flipping card itself (2 total) can pay —
    // the deploy should fail affordability.
    assert.throws(() => engine.perform({ type: "flipUp", playerId: P1, cardId: id("t") }));

    const { engine: engine2, id: id2 } = buildGame({
      playerA: { faction },
      cards: [
        { key: "t", def: flipTactic, owner: P1, zone: "play", faceDown: true },
        ...bank("Rage", "rage", 3, P1)
      ]
    });
    engine2.perform({ type: "flipUp", playerId: P1, cardId: id2("t") });
    settle(engine2);
    assert.equal(engine2.getAvailableResourceCount(P1), 0, "all 3 resources were spent on the taxed flip-up cost");
  });

  test("startingDrawSearch fetches a staple not among starting resources into hand before the draw", () => {
    const faction = factionCard({
      name: "SearchDrawFaction",
      faction: defaultFactionDefinition({
        setup: {
          startingResources: { count: 2, stapleOnly: true },
          startingDrawSearch: { selector: { controller: "self", zone: "deck", type: "resource", staple: true } },
          openingHand: { goingFirst: 0, goingSecond: 0 }
        }
      })
    });
    const rage = resourceCard({ id: "sds-rage", name: "Rage", resource: { provides: ["rage"], staple: true } });
    const greed = resourceCard({ id: "sds-greed", name: "Greed", resource: { provides: ["greed"], staple: true } });

    const engine = createFactionGame(
      [faction, rage, greed],
      [{ id: P1, name: "Alice", deckDefinitionIds: [faction.id, rage.id, rage.id, greed.id] },
      { id: P2, name: "Bob", deckDefinitionIds: [faction.id, rage.id, rage.id, greed.id] }],
      { firstPlayerId: P1 }
    );

    // Deck order: 2 Rage go to starting resources; the search then finds the
    // remaining Greed (the only definition NOT already placed) into hand.
    const handNames = engine.state.players[P1].hand.map(cid => engine.getDefinition(cid).name);
    assert.deepEqual(handNames, ["Greed"]);
  });
});

describe("Faction gap authoring: real catalog data end-to-end", () => {
  test("Lugubrian Council Expedition Division — token develop rule, EVIL PLAN, ENERGIZE WITH HUMOUR", () => {
    const { engine, id } = buildGame({
      playerA: { faction: def("Lugubrian Council Expedition Division") },
      cards: [
        { key: "tac", def: tactic({ name: "FillerTactic" }), owner: P1, zone: "deck" },
        { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
        ...bank("Rage", "rage", 8, P1)
      ]
    });

    engine.state.cards[id("__factionA")].counters = { token: 4 };
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("__factionA"),
      abilityId: "lugubrian-evil-plan"
    });
    drive(engine, [id("tac")]);
    assert.equal(engine.state.players[P1].hand.includes(id("tac")), true, "EVIL PLAN put the tactic into hand");
    assert.equal(engine.state.cards[id("__factionA")].counters.token, 0, "4 tokens spent");

    engine.state.cards[id("__factionA")].counters = { token: 2 };
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("__factionA"),
      abilityId: "lugubrian-energize",
      selected: { c: [id("foe")] }
    });
    settle(engine);
    assert.equal(engine.state.cards[id("foe")].counters?.token, 1);
    assert.equal(engine.state.cards[id("__factionA")].counters.token, 0);
  });

  test("The Primitive Tribes of Thabbash — face-down starting Obsession, FLIP UP tax, resolved-tactic redirect", () => {
    const factionDef = def("The Primitive Tribes of Thabbash");
    const obsession = resourceCard({ id: "pt-obsession", name: "Obsession", resource: { provides: ["obsession"], staple: false } });
    const rage = resourceCard({ id: "pt-rage", name: "Rage", resource: { provides: ["rage"], staple: true } });
    const filler = character({ id: "pt-filler", name: "Filler" });

    const engine = createFactionGame(
      [factionDef, obsession, rage, filler],
      [{ id: P1, name: "Alice", deckDefinitionIds: [factionDef.id, obsession.id, rage.id, filler.id, filler.id] },
      { id: P2, name: "Bob", deckDefinitionIds: [factionDef.id, obsession.id, rage.id, filler.id, filler.id] }],
      { firstPlayerId: P1 }
    );
    const obsessionInPlay = engine.state.players[P1].play
      .map(cid => engine.state.cards[cid])
      .find(c => engine.getDefinition(c.id).name === "Obsession");
    assert.ok(obsessionInPlay, "obsessionInPlay");
    assert.equal(obsessionInPlay!.faceDown, true);

    // A resolved tactic controlled by P1 goes to discard; the standing
    // redirect offers to pay 3 to put it into play as a face-down resource
    // instead.
    const { engine: e2, id } = buildGame({
      playerA: { faction: factionDef },
      cards: [
        {
          key: "t",
          def: tactic({ name: "T", behavior: { abilities: [{ id: "b", type: "activated", effects: [] }] } }),
          owner: P1,
          zone: "hand"
        },
        ...bank("Rage", "rage", 8, P1)
      ]
    });
    const before = e2.state.players[P1].play.length;
    e2.perform({ type: "playCard", playerId: P1, cardId: id("t") });
    drive(e2);
    const tactCard = e2.state.cards[id("t")];
    assert.equal(tactCard.zone, "play");
    assert.equal(tactCard.faceDown, true, "redirected into play as a face-down resource");
    assert.equal(e2.state.players[P1].play.length, before + 1, "the redirected tactic is now an extra card in play");

    // FLIP UP surcharge: a tactic with a printed FLIP UP cost of 1 costs 3
    // total for this faction's controller.
    const { engine: e3, id: id3 } = buildGame({
      playerA: { faction: factionDef },
      cards: [
        {
          key: "flip",
          def: tactic({ name: "Flip", flipUp: { cost: 1, threshold: 0 }, behavior: { abilities: [{ id: "b", type: "activated", effects: [] }] } }),
          owner: P1,
          zone: "play",
          faceDown: true
        },
        ...bank("Rage", "rage", 1, P1)
      ]
    });
    assert.throws(() => e3.perform({ type: "flipUp", playerId: P1, cardId: id3("flip") }));
  });

  test("Unlikely Heroes — distinct starting staples + searches a third staple into hand, 7/8 opening draw", () => {
    const factionDef = def("Unlikely Heroes");
    const rage = resourceCard({ id: "uh-rage", name: "Rage", resource: { provides: ["rage"], staple: true } });
    const greed = resourceCard({ id: "uh-greed", name: "Greed", resource: { provides: ["greed"], staple: true } });
    const obsession = resourceCard({ id: "uh-obsession", name: "Obsession", resource: { provides: ["obsession"], staple: true } });
    const filler = character({ id: "uh-filler", name: "Filler" });

    const deck = [
      factionDef.id,
      rage.id,
      greed.id,
      obsession.id,
      ...Array.from({ length: 10 }, () => filler.id)
    ];

    const engine = createFactionGame(
      [factionDef, rage, greed, obsession, filler],
      [{ id: P1, name: "Alice", deckDefinitionIds: deck },
      { id: P2, name: "Bob", deckDefinitionIds: deck }],
      { firstPlayerId: P1 }
    );

    const startingNames = engine.state.players[P1].play
      .map(cid => engine.getDefinition(cid).name)
      .filter(n => n === "Rage" || n === "Greed" || n === "Obsession");
    assert.deepEqual(startingNames, ["Rage", "Greed"], "two DIFFERENT starting staples, deck order");

    const handNames = engine.state.players[P1].hand.map(cid => engine.getDefinition(cid).name);
    assert.ok(handNames.includes("Obsession"), "the third staple was searched into hand");
    assert.equal(engine.state.players[P1].hand.length, 8, "7 drawn going first + 1 searched");
  });

  test("Alliance of Handy Weirdos — ENHANCE pumps +1/+1 this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: def("Alliance of Handy Weirdos") },
      cards: [
        { key: "c", def: character({ name: "C", strength: 2, life: 3 }), owner: P1, zone: "play" },
        ...bank("Rage", "rage", 3, P1)
      ]
    });
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("__factionA"),
      abilityId: "alliance-enhance",
      selected: { c: [id("c")] }
    });
    settle(engine);
    assert.equal(engine.getStat(id("c"), "strength"), 3);
    assert.equal(engine.getStat(id("c"), "life"), 4);
  });

  test("Drowned Catacombs — SNEAK costs X = opponent's character count, grants COVERT this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: def("Drowned Catacombs") },
      cards: [
        { key: "mine", def: character({ name: "Mine", strength: 2 }), owner: P1, zone: "play" },
        { key: "foe1", def: character({ name: "Foe1" }), owner: P2, zone: "play" },
        { key: "foe2", def: character({ name: "Foe2" }), owner: P2, zone: "play" },
        ...bank("Rage", "rage", 2, P1)
      ]
    });
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("__factionA"),
      abilityId: "catacombs-sneak",
      selected: { c: [id("mine")] }
    });
    settle(engine);
    assert.ok(engine.getKeywords(id("mine")).includes("covert"), "engine.getKeywords(id(\"mine\")).includes(\"covert\")");
    assert.equal(engine.getAvailableResourceCount(P1), 0, "X=2 resources spent");
  });

  test("Hall of Great Justice — FOR GREAT JUSTICE! destroys one, deals its strength to another", () => {
    const { engine, id } = buildGame({
      playerA: { faction: def("Hall of Great Justice") },
      cards: [
        { key: "sac", def: character({ name: "Sac", strength: 4, life: 2 }), owner: P1, zone: "play" },
        { key: "foe", def: character({ name: "Foe", life: 6 }), owner: P2, zone: "play" },
        ...bank("Rage", "rage", 5, P1)
      ]
    });
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("__factionA"),
      abilityId: "hall-for-great-justice",
      selected: { c1: [id("sac")], c2: [id("foe")] }
    });
    settle(engine);
    assert.equal(engine.state.cards[id("sac")].zone, "discard");
    assert.equal(engine.state.cards[id("foe")].damage, 4, "took Sac's 4 strength as damage");
  });

  test("Moist Cave of the Darkpump — LUCUBRATE looks at the top card, may bottom it", () => {
    const { engine, id } = buildGame({
      playerA: { faction: def("Moist Cave of the Darkpump") },
      cards: [
        { key: "top", def: character({ name: "Top" }), owner: P1, zone: "deck" },
        { key: "next", def: character({ name: "Next" }), owner: P1, zone: "deck" },
        ...bank("Rage", "rage", 1, P1)
      ]
    });
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("__factionA"),
      abilityId: "moistcave-lucubrate"
    });
    settle(engine);
    assert.ok(engine.state.pendingChoice, "the lookAndReorder pauses for a decision");
  });

  test("Order of the Golden String — CONSPIRE draws 2, discards 1", () => {
    const { engine, id } = buildGame({
      playerA: { faction: def("Order of the Golden String") },
      cards: [
        { key: "h", def: character({ name: "H" }), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" },
        ...bank("Greed", "greed", 4, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("__factionA"),
      abilityId: "golden-conspire"
    });
    drive(engine, [id("h")]);
    assert.equal(engine.state.players[P1].hand.length, handBefore + 2 - 1);
  });

  test("Defenders of Marduun — distinct starting staples; RALLY pumps 3 characters of different trades", () => {
    const factionDef = def("Defenders of Marduun");
    const rage = resourceCard({ id: "dm-rage", name: "Rage", resource: { provides: ["rage"], staple: true } });
    const greed = resourceCard({ id: "dm-greed", name: "Greed", resource: { provides: ["greed"], staple: true } });
    const filler = character({ id: "dm-filler", name: "Filler" });
    const deck = [factionDef.id, rage.id, greed.id, ...Array.from({ length: 10 }, () => filler.id)];

    const setupEngine = createFactionGame(
      [factionDef, rage, greed, filler],
      [{ id: P1, name: "Alice", deckDefinitionIds: deck },
      { id: P2, name: "Bob", deckDefinitionIds: deck }],
      { firstPlayerId: P1 }
    );
    const startingNames = setupEngine.state.players[P1].play
      .map(cid => setupEngine.getDefinition(cid).name)
      .filter(n => n === "Rage" || n === "Greed");
    assert.deepEqual(startingNames, ["Rage", "Greed"]);

    const { engine, id } = buildGame({
      playerA: { faction: factionDef },
      cards: [
        { key: "a", def: character({ name: "A", strength: 1, life: 1, trade: "rogue" as CardDefinition["trade"] }), owner: P1, zone: "play" },
        { key: "b", def: character({ name: "B", strength: 1, life: 1, trade: "warlord" as CardDefinition["trade"] }), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C", strength: 1, life: 1, trade: "arcanist" as CardDefinition["trade"] }), owner: P1, zone: "play" },
        ...bank("Rage", "rage", 5, P1)
      ]
    });
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("__factionA"),
      abilityId: "defenders-rally",
      selected: { c: [id("a"), id("b"), id("c")] }
    });
    settle(engine);
    for (const key of ["a", "b", "c"]) {
      assert.equal(engine.getStat(id(key), "strength"), 3);
      assert.equal(engine.getStat(id(key), "life"), 3);
    }
  });

  test("Legions of Chaos — a deployed character offers to search for one of a different trade", () => {
    const { engine, id } = buildGame({
      playerA: { faction: def("Legions of Chaos") },
      cards: [
        { key: "mine", def: character({ name: "Mine", trade: "rogue" as CardDefinition["trade"] }), owner: P1, zone: "play" },
        { key: "deckSame", def: character({ name: "DeckSame", trade: "rogue" as CardDefinition["trade"] }), owner: P1, zone: "deck" },
        { key: "deckDiff", def: character({ name: "DeckDiff", trade: "warlord" as CardDefinition["trade"] }), owner: P1, zone: "deck" },
        { key: "new", def: character({ name: "New", trade: "arcanist" as CardDefinition["trade"] }), owner: P1, zone: "hand" },
        ...bank("Rage", "rage", 3, P1)
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("new") });
    drive(engine, [id("deckDiff")]);
    assert.equal(engine.state.players[P1].hand.includes(id("deckDiff")), true);
    assert.equal(engine.state.players[P1].hand.includes(id("deckSame")), false);
  });
});
