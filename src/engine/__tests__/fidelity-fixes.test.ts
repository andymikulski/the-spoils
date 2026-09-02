// Hand-written end-to-end coverage for the fidelity pass: cards whose
// printed text the engine wasn't fully obeying, plus the new primitives
// (`targetOwnedBy`, `revealFromTopUntil`, `reveal`, `grantsReveal`).

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
const def = (name: string, set?: string): CardDefinition => {
  const d = CATALOG.find(c => c.name === name && (!set || c.set === set));
  assert.ok(d, `card '${name}'${set ? ` (${set})` : ""} not found`);
  return structuredClone(d);
};
const res = (icon: string, trade: string): CardDefinition =>
  resourceCard({ name: icon, id: `fx-${icon}-${Math.random()}`, trade: trade as CardDefinition["trade"], resource: { provides: [icon as "rage"], staple: true } });

describe("fidelity pass", () => {
  test("A Death Fit for a King — targetOwnedBy scopes the discard branch to an opponent", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "adfk", def: def("A Death Fit for a King"), owner: P1, zone: "hand" },
        // your own UNIQUE character in play — a legal pick (the other branch)
        { key: "mine", def: { ...character({ name: "My Unique", id: "fx-mine" }), text: "UNIQUE FOO", unique: "foo" }, owner: P1 },
        // your own non-unique character in your discard — NOT legal
        { key: "mydiscard", def: character({ name: "My Dead Guy", id: "fx-myd" }), owner: P1, zone: "discard" },
        // an opponent's character in their discard — legal
        { key: "oppdiscard", def: character({ name: "Their Dead Guy", id: "fx-oppd" }), owner: P2, zone: "discard" },
        { key: "o1", def: res("obsession", "arcanist"), owner: P1 },
        { key: "o2", def: res("obsession", "arcanist"), owner: P1 }
      ]
    });

    // Your own discard character is not a legal EXTRA-COST pick.
    assert.throws(
      () => engine.perform({ type: "playCard", playerId: P1, cardId: id("adfk"), selected: { victim: [id("mydiscard")] } }),
      /Illegal target|not a legal/i
    );

    // The opponent's discard character is.
    engine.perform({ type: "playCard", playerId: P1, cardId: id("adfk"), selected: { victim: [id("oppdiscard")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("oppdiscard")].zone, "void");
  });

  test("Surprise! — revealFromTopUntil digs to a cheap character and blocks with it", () => {
    const attacker = character({ name: "Raider", id: "fx-raider", cost: 5, strength: 3, life: 3, speed: 2 });
    const dud = character({ name: "Expensive Dud", id: "fx-dud", cost: 9 });
    const saviour = character({ name: "Cheap Saviour", id: "fx-sav", cost: 2, strength: 1, life: 4, speed: 1 });
    const buried = character({ name: "Buried", id: "fx-buried", cost: 1 });

    const { engine, id } = buildGame({
      cards: [
        { key: "atk", def: attacker, owner: P2, attackEligible: true },
        { key: "surprise", def: def("Surprise!"), owner: P1, zone: "hand" },
        // deck top -> down: dud (no match), saviour (match, cost 2 <= 5), buried (never revealed)
        { key: "dud", def: dud, owner: P1, zone: "deck" },
        { key: "sav", def: saviour, owner: P1, zone: "deck" },
        { key: "buried", def: buried, owner: P1, zone: "deck" },
        { key: "d1", def: res("deception", "rogue"), owner: P1 },
        { key: "d2", def: res("deception", "rogue"), owner: P1 },
        { key: "d3", def: res("deception", "rogue"), owner: P1 }
      ],
      activePlayerId: P2
    });

    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    // In the pre-block response window the attacker has priority first.
    engine.perform({ type: "passPriority", playerId: P2 });

    // Surprise! is a defender-only response; X = the attacker's cost (5).
    engine.perform({ type: "playCard", playerId: P1, cardId: id("surprise"), selected: { k: [id("atk")] } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("sav")].zone, "play", "the cheap character was dug up");
    assert.equal(engine.state.cards[id("sav")].controllerId, P1);
    assert.equal(engine.state.cards[id("dud")].zone, "deck", "the too-expensive reveal was shuffled back");
    assert.equal(engine.state.cards[id("buried")].zone, "deck", "cards below the match were never revealed");
    const battle = engine.state.battle;
    assert.ok(battle && battle.blockingParty.includes(id("sav")), "and it joined the blocking party");
  });

  test("Cheats McGuillicutty — grantsReveal exposes the controller's deck top in the flow view", () => {
    const topCard = character({ name: "Top Secret", id: "fx-top" });
    const { engine, id } = buildGame({
      cards: [
        { key: "cheats", def: def("Cheats McGuillicutty", "1st Edition Part 2"), owner: P1 },
        { key: "top", def: topCard, owner: P1, zone: "deck" },
        { key: "next", def: character({ name: "Next", id: "fx-next" }), owner: P1, zone: "deck" },
        { key: "d1", def: res("deception", "rogue"), owner: P1 },
        { key: "d2", def: res("deception", "rogue"), owner: P1 }
      ]
    });
    const revealed = engine.getFlowView().revealed;
    assert.equal(revealed.deckTop.length, 1);
    assert.equal(revealed.deckTop[0].playerId, P1);
    assert.equal(revealed.deckTop[0].cardId, engine.state.players[P1].deck[0], "flow view mirrors the real deck top");
    assert.deepEqual(revealed.hands, []);

    // BOTTOM DEAL moves the top card away — the flow view tracks the new top.
    const wasTop = engine.state.players[P1].deck[0];
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("cheats"), abilityId: "bottomdeal" });
    resolvePendingResponses(engine);
    assert.equal(engine.getFlowView().revealed.deckTop[0].cardId, engine.state.players[P1].deck[0]);
    assert.notEqual(engine.getFlowView().revealed.deckTop[0].cardId, wasTop, "the old top moved");
    const deckAfter = engine.state.players[P1].deck;
    assert.equal(deckAfter[deckAfter.length - 1], wasTop, "bottomed");
  });

  test("Odious Diva — grantsReveal marks each opponent's hand public", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "diva", def: def("Odious Diva", "1st Edition Part 2"), owner: P1 },
        { key: "h1", def: character({ name: "Held", id: "fx-held" }), owner: P2, zone: "hand" }
      ]
    });
    assert.deepEqual(engine.getFlowView().revealed.hands, [P2]);
  });

  test("Intellectual Reliquary — take a tactic from the top 3 to hand, rest to the bottom", () => {
    const t1 = character({ name: "C1", id: "fx-c1" });
    const wanted = tactic({ name: "Wanted Tactic", id: "fx-wt" });
    const t3 = character({ name: "C3", id: "fx-c3" });
    const bottomSentinel = character({ name: "Bottom", id: "fx-bot" });
    const { engine, id } = buildGame({
      cards: [
        { key: "reliquary", def: def("Intellectual Reliquary", "Seed"), owner: P1 },
        { key: "t1", def: t1, owner: P1, zone: "deck" },
        { key: "wt", def: wanted, owner: P1, zone: "deck" },
        { key: "t3", def: t3, owner: P1, zone: "deck" },
        { key: "bot", def: bottomSentinel, owner: P1, zone: "deck" },
        { key: "o1", def: res("obsession", "arcanist"), owner: P1 }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("reliquary"), abilityId: "imbibe", selected: { pick: [id("wt")] } });
    resolvePendingResponses(engine);
    while (engine.state.pendingChoice) {
      const pc = engine.state.pendingChoice as { kind: string; playerId: string; cardIds?: string[] };
      // reorder-to-bottom: send C1 and C3 down in the given order
      engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId as typeof P1, choice: { kind: "reorderDeck", order: [...(pc.cardIds ?? [])] } as never });
    }
    assert.equal(engine.state.players[P1].hand.includes(id("wt")), true, "the tactic was taken to hand");
    const deck = engine.state.players[P1].deck;
    assert.equal(deck[0], id("bot"), "the untouched 4th card is now on top");
    assert.ok(deck.slice(-2).includes(id("t1")) && deck.slice(-2).includes(id("t3")), "the two non-picked cards went to the bottom");
  });

  test("Eccentric Inquisition — every revealed tactic is forced into the void", () => {
    const oppTactic = (n: number) => tactic({ name: `OppTac${n}`, id: `fx-ot${n}` });
    const oppChar = (n: number) => character({ name: `OppChar${n}`, id: `fx-oc${n}` });
    const { engine, id } = buildGame({
      cards: [
        { key: "ei", def: def("Eccentric Inquisition", "1st Edition Part 2"), owner: P1, zone: "hand" },
        { key: "ot1", def: oppTactic(1), owner: P2, zone: "deck" },
        { key: "oc1", def: oppChar(1), owner: P2, zone: "deck" },
        { key: "ot2", def: oppTactic(2), owner: P2, zone: "deck" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `oc${i + 2}`, def: oppChar(i + 2), owner: P2, zone: "deck" as const })),
        ...Array.from({ length: 4 }, (_, i) => ({ key: `o${i}`, def: res("obsession", "arcanist"), owner: P1 }))
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("ei"), selected: { voided: [id("ot1"), id("ot2")] } });
    resolvePendingResponses(engine);
    while (engine.state.pendingChoice) {
      const pc = engine.state.pendingChoice as { kind: string; playerId: string; cardIds?: string[] };
      engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId as typeof P1, choice: { kind: "reorderDeck", order: [...(pc.cardIds ?? [])] } as never });
    }
    assert.equal(engine.state.cards[id("ot1")].zone, "void");
    assert.equal(engine.state.cards[id("ot2")].zone, "void");
    assert.equal(engine.state.cards[id("oc1")].zone, "deck", "non-tactics stay in the deck");
  });

  test("Warmachine Smelder — LIFE'S WORK offers deploy-for-free or take-to-hand", () => {
    const scrapItem = { ...character({ name: "Scrap", id: "fx-scrap" }), type: "item" as const, strength: undefined, life: undefined, speed: undefined };
    const deckItem = { ...character({ name: "Masterwork", id: "fx-mw", cost: 3 }), type: "item" as const, strength: undefined, life: undefined, speed: undefined };
    const { engine, id } = buildGame({
      cards: [
        { key: "smelder", def: def("Warmachine Smelder", "Seed Saga"), owner: P1 },
        { key: "scrap", def: scrapItem, owner: P1 },
        { key: "mw", def: deckItem, owner: P1, zone: "deck" },
        ...Array.from({ length: 6 }, (_, i) => ({ key: `e${i}`, def: res("elitism", "gearsmith"), owner: P1 }))
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("smelder"), abilityId: "lifeswork", selected: { scrap2: [id("scrap")] } });
    resolvePendingResponses(engine);
    // pick the deck item
    let pc = engine.state.pendingChoice as { kind: string; playerId: string };
    assert.equal(pc.kind, "chooserSelectsTarget");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("mw")] } });
    // deploy-vs-hand
    pc = engine.state.pendingChoice as { kind: string; playerId: string };
    assert.equal(pc.kind, "chooserSelectsOption");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index: 1 } }); // "put it into your hand"
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].hand.includes(id("mw")), true);
  });
});
