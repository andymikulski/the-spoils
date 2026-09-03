// Per-card correctness suite — Seed 3 (43 cards).
//
// One describe() per catalog card. Each test seeds a tiny mid-game board,
// takes the acting player's turn, triggers/activates/plays the card with
// concrete picks, and asserts the concrete outcome + target legality.
// See ./_harness.ts and ../../../CARD-TEST-PROGRESS.md.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGame,
  cardDef,
  developFaction,
  bank,
  character,
  tactic,
  play,
  activate,
  answer,
  resolvePendingResponses,
  autoResolveBattle,
  P1,
  P2
} from "./_harness.js";
import type { CardDefinition } from "../../../engine.js";

const SET = "Seed 3";
const def = (name: string) => cardDef(SET, name);

// A synthetic character that carries a Unique designation.
const uniqueChar = (over: Partial<CardDefinition> = {}) =>
  character({ name: "UniqueGuy", unique: "uniqueguy", strength: 2, life: 3, ...over });

// A synthetic character with a trivial "pay nothing: draw 1" activated ability.
const drawerChar = (over: Partial<CardDefinition> = {}) =>
  character({
    name: "Drawer",
    strength: 1,
    life: 3,
    behavior: {
      abilities: [
        {
          id: "draw1",
          name: "Study",
          type: "activated",
          costs: [],
          effects: [{ type: "draw", player: "controller", amount: 1 }]
        }
      ]
    },
    ...over
  });

// A synthetic tactic that moves a chosen opponent character to its owner's hand.
const bounceTactic = (over: Partial<CardDefinition> = {}) =>
  tactic({
    name: "Bounce",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "b",
          type: "activated",
          targets: [
            {
              id: "t",
              selector: { zone: "play", type: "character" },
              count: 1
            }
          ],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    },
    ...over
  });

// A synthetic tactic that destroys a chosen character.
const killTactic = (over: Partial<CardDefinition> = {}) =>
  tactic({
    name: "Kill",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "k",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    },
    ...over
  });

// ---------------------------------------------------------------------------
// Vanilla resources
// ---------------------------------------------------------------------------

describe("Seed 3 — vanilla staple resources", () => {
  for (const [name, icon] of [
    ["Rage", "rage"],
    ["Greed", "greed"],
    ["Deception", "deception"],
    ["Elitism", "elitism"],
    ["Obsession", "obsession"]
  ] as const) {
    test(`${name} deploys as a face-up resource providing [${icon}]`, () => {
      const { engine, id } = buildGame({
        playerA: { faction: developFaction() },
        cards: [{ key: "r", def: def(name), owner: P1, zone: "hand" }]
      });
      const before = engine.getThresholds(P1)[icon] ?? 0;
      engine.perform({
        type: "chooseDevelop",
        playerId: P1,
        choice: { type: "playResource", cards: [{ cardId: id("r"), faceDown: false }] }
      } as never);
      resolvePendingResponses(engine);
      assert.equal(engine.state.cards[id("r")].zone, "play");
      assert.equal(engine.state.cards[id("r")].faceDown, false);
      assert.equal((engine.getThresholds(P1)[icon] ?? 0) - before, 1);
    });
  }
});

// ---------------------------------------------------------------------------
// Faction cards — generic tournament abilities
// ---------------------------------------------------------------------------

describe("Seed 3 — faction cards (tournament DRAW / RESOURCE abilities)", () => {
  const factions = [
    "The Evil Alliance",
    "The Society of Magical Propriety",
    "The Knitting Coalition",
    "The Open R&D Faction",
    "The Union of Unextraordinary Miners",
    "Imperial Army",
    "Counter-Imperial Army",
    "Slightly Less Evil Alliance"
  ];
  for (const name of factions) {
    test(`${name} — DRAW ability pays 3 and draws a card`, () => {
      const { engine } = buildGame({
        playerA: { faction: def(name) },
        cards: [
          ...bank("rage", 4, P1),
          { key: "d1", def: character({ name: "DeckA" }), owner: P1, zone: "deck" },
          { key: "d2", def: character({ name: "DeckB" }), owner: P1, zone: "deck" }
        ]
      });
      const factionId = engine.state.players[P1].factionId!;
      const before = engine.state.players[P1].hand.length;
      engine.perform({
        type: "activateAbility",
        playerId: P1,
        cardId: factionId,
        abilityId: "tournament-draw"
      });
      resolvePendingResponses(engine);
      assert.equal(engine.state.players[P1].hand.length, before + 1);
    });
  }
});

// ---------------------------------------------------------------------------
// Cowslaw
// ---------------------------------------------------------------------------

describe("Seed 3 — Cowslaw", () => {
  test("removes X discard tactics from the game and tutors a cheap tactic to hand", () => {
    const cheap = { ...tactic({ name: "CheapTac", cost: 1 }), id: "s3-cheaptac" };
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cow", def: def("Cowslaw"), owner: P1, zone: "hand" },
        { key: "f1", def: tactic({ name: "Fodder1" }), owner: P1, zone: "discard" },
        { key: "f2", def: tactic({ name: "Fodder2" }), owner: P1, zone: "discard" },
        { key: "tut", def: cheap, owner: P1, zone: "deck" },
        ...bank("obsession", 4, P1)
      ]
    });
    play(engine, P1, id("cow"), { variables: { x: 1 }, selected: { fodder: [id("f1")], search: [id("tut")] } });
    assert.equal(engine.state.cards[id("f1")].zone, "removed");
    assert.equal(engine.state.cards[id("tut")].zone, "hand");
    assert.equal(engine.state.cards[id("cow")].zone, "discard");
  });

  test("X must be greater than 0", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cow", def: def("Cowslaw"), owner: P1, zone: "hand" },
        ...bank("obsession", 4, P1)
      ]
    });
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("cow"), selected: {}, variables: { x: 0 } } as never)
    );
  });
});

// ---------------------------------------------------------------------------
// Devilfang Thunderhoof
// ---------------------------------------------------------------------------

describe("Seed 3 — Devilfang Thunderhoof", () => {
  test("enters with [O]-count tokens and gains +1 strength per token", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "th", def: def("Devilfang Thunderhoof"), owner: P1, zone: "hand" },
        ...bank("obsession", 4, P1),
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("th"));
    assert.equal(engine.state.cards[id("th")].zone, "play");
    assert.equal(engine.state.cards[id("th")].counters.token, 4);
    // printed strength 1 + 4 tokens
    assert.equal(engine.getStat(id("th"), "strength"), 5);
  });

  test("DISRUPT removes a token and forces an opponent to discard", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "th", def: def("Devilfang Thunderhoof"), owner: P1, zone: "play", counters: { token: 3 } },
        { key: "h1", def: character({ name: "OppHand" }), owner: P2, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    activate(engine, P1, id("th"), "thunderhoof-disrupt");
    // opponent chooses which card to pitch
    answer(engine, P2, { kind: "chooserSelectsTarget", selected: [id("h1")] });
    assert.equal(engine.state.cards[id("th")].counters.token, 2);
    assert.equal(engine.state.cards[id("h1")].zone, "discard");
  });
});

// ---------------------------------------------------------------------------
// Geiseric, the Souleater
// ---------------------------------------------------------------------------

describe("Seed 3 — Geiseric, the Souleater", () => {
  test("intercepts an opponent character heading to hand: exile it + token on Geiseric", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "g", def: def("Geiseric, the Souleater"), owner: P1, zone: "play" },
        { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" },
        { key: "victim", def: character({ name: "Victim" }), owner: P2, zone: "play" },
        ...bank("obsession", 6, P1)
      ]
    });
    play(engine, P1, id("bounce"), { selected: { t: [id("victim")] } });
    answer(engine, P1, { kind: "replacementChoice", apply: true });
    assert.equal(engine.state.cards[id("victim")].zone, "removed");
    assert.equal(engine.state.cards[id("g")].counters.token, 1);
  });

  test("does not fire for the controller's own character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "g", def: def("Geiseric, the Souleater"), owner: P1, zone: "play" },
        { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" },
        { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
        ...bank("obsession", 6, P1)
      ]
    });
    play(engine, P1, id("bounce"), { selected: { t: [id("mine")] } });
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(engine.state.cards[id("mine")].zone, "hand");
  });
});

// ---------------------------------------------------------------------------
// God's Autograph
// ---------------------------------------------------------------------------

describe("Seed 3 — God's Autograph", () => {
  test("grants Unique <name> to every non-resource card, not resources", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "auto", def: def("God's Autograph"), owner: P1, zone: "play" },
        { key: "ch", def: character({ name: "Nameless" }), owner: P1, zone: "play" },
        ...bank("rage", 1, P1)
      ]
    });
    assert.equal(engine.getEffectiveUnique(id("ch")), "Nameless");
    const resId = engine.state.players[P1].play.find(
      c => engine.getDefinition(c).type === "resource"
    )!;
    assert.equal(engine.getEffectiveUnique(resId), undefined);
  });
});

// ---------------------------------------------------------------------------
// Pony Slaystation
// ---------------------------------------------------------------------------

describe("Seed 3 — Pony Slaystation", () => {
  test("destroys an entering opposing character of strength <= 3 and takes that much damage", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pony", def: def("Pony Slaystation"), owner: P1, zone: "play" },
        { key: "weak", def: character({ name: "Weakling", strength: 2, life: 5, cost: 1 }), owner: P2, zone: "hand" },
        ...bank("rage", 6, P2)
      ],
      activePlayerId: P2
    });
    play(engine, P2, id("weak"));
    assert.equal(engine.state.cards[id("weak")].zone, "discard");
    // structure 3 location; 2 strength -> 2 damage, survives
    assert.equal(engine.state.cards[id("pony")].zone, "play");
    assert.equal(engine.state.cards[id("pony")].damage, 2);
  });

  test("ignores an entering opposing character of strength >= 4", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pony", def: def("Pony Slaystation"), owner: P1, zone: "play" },
        { key: "big", def: character({ name: "Bruiser", strength: 4, life: 4, cost: 1 }), owner: P2, zone: "hand" },
        ...bank("rage", 6, P2)
      ],
      activePlayerId: P2
    });
    play(engine, P2, id("big"));
    assert.equal(engine.state.cards[id("big")].zone, "play");
    assert.equal(engine.state.cards[id("pony")].damage ?? 0, 0);
  });
});

// ---------------------------------------------------------------------------
// Spatchcocking
// ---------------------------------------------------------------------------

describe("Seed 3 — Spatchcocking", () => {
  test("each player keeps one card per non-resource type; the rest bounce to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sp", def: def("Spatchcocking"), owner: P1, zone: "hand" },
        { key: "p1keep", def: character({ name: "P1Keep" }), owner: P1, zone: "play" },
        { key: "p1drop", def: character({ name: "P1Drop" }), owner: P1, zone: "play" },
        { key: "p2keep", def: character({ name: "P2Keep" }), owner: P2, zone: "play" },
        { key: "p2drop", def: character({ name: "P2Drop" }), owner: P2, zone: "play" },
        ...bank("obsession", 6, P1)
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("sp"), selected: {} } as never);
    resolvePendingResponses(engine);
    // Walk the chain of "keep one of type X" chooser prompts.
    let guard = 0;
    while (engine.state.pendingChoice && guard++ < 30) {
      const pc = engine.state.pendingChoice as { kind: string; playerId: string; declaration?: { selector?: { type?: string } } };
      if (pc.kind !== "chooserSelectsTarget") break;
      const wantChar = pc.declaration?.selector?.type === "character";
      const keepId = pc.playerId === P1 ? id("p1keep") : id("p2keep");
      engine.perform({
        type: "resolvePendingChoice",
        playerId: pc.playerId,
        choice: { kind: "chooserSelectsTarget", selected: wantChar ? [keepId] : [] }
      } as never);
      resolvePendingResponses(engine);
    }
    assert.equal(engine.state.cards[id("p1keep")].zone, "play");
    assert.equal(engine.state.cards[id("p1drop")].zone, "hand");
    assert.equal(engine.state.cards[id("p2keep")].zone, "play");
    assert.equal(engine.state.cards[id("p2drop")].zone, "hand");
  });
});

// ---------------------------------------------------------------------------
// The Stone of Shame
// ---------------------------------------------------------------------------

describe("Seed 3 — The Stone of Shame", () => {
  test("a character that would go to a hand is destroyed instead", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "shame", def: def("The Stone of Shame"), owner: P1, zone: "play" },
        { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" },
        { key: "victim", def: character({ name: "Victim" }), owner: P2, zone: "play" },
        ...bank("rage", 4, P1)
      ]
    });
    play(engine, P1, id("bounce"), { selected: { t: [id("victim")] } });
    assert.equal(engine.state.cards[id("victim")].zone, "discard");
  });
});

// ---------------------------------------------------------------------------
// Anatidaephobia
// ---------------------------------------------------------------------------

describe("Seed 3 — Anatidaephobia", () => {
  test("terminates a character being deployed, paying its numeric cost", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "anat", def: def("Anatidaephobia"), owner: P1, zone: "hand" },
        { key: "big", def: character({ name: "Incoming", cost: 3, strength: 2, life: 2 }), owner: P2, zone: "hand" },
        ...bank("greed", 8, P1),
        ...bank("rage", 6, P2)
      ],
      activePlayerId: P2
    });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("big"), selected: {} } as never);
    // the opponent (P1) already holds priority in the deploy's response window
    engine.perform({ type: "playCard", playerId: P1, cardId: id("anat"), selected: {} } as never);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("big")].zone, "discard");
  });

  test("cannot be deployed except in response to a character being deployed", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "anat", def: def("Anatidaephobia"), owner: P1, zone: "hand" },
        ...bank("greed", 8, P1)
      ]
    });
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("anat"), selected: {} } as never)
    );
  });
});

// ---------------------------------------------------------------------------
// Fecal Urgency
// ---------------------------------------------------------------------------

describe("Seed 3 — Fecal Urgency", () => {
  test("draws X and the faction loses 2X influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "fu", def: def("Fecal Urgency"), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" },
        ...bank("greed", 3, P1)
      ]
    });
    const infBefore = engine.state.players[P1].influence;
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("fu"), { variables: { x: 2 } });
    // -1 hand for the tactic played, +2 drawn
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 2);
    assert.equal(engine.state.players[P1].influence, infBefore - 4);
  });

  test("X may not exceed the number of [G] controlled", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "fu", def: def("Fecal Urgency"), owner: P1, zone: "hand" },
        ...bank("greed", 3, P1)
      ]
    });
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("fu"), selected: {}, variables: { x: 4 } } as never)
    );
  });
});

// ---------------------------------------------------------------------------
// Intriguing Mezzanine
// ---------------------------------------------------------------------------

describe("Seed 3 — Intriguing Mezzanine", () => {
  test("ETB depletes the 2 picked characters; PARTY ON depletes another for 1 self-damage", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mez", def: def("Intriguing Mezzanine"), owner: P1, zone: "hand" },
        { key: "c1", def: character({ name: "C1" }), owner: P1, zone: "play" },
        { key: "c2", def: character({ name: "C2" }), owner: P2, zone: "play" },
        { key: "c3", def: character({ name: "C3" }), owner: P2, zone: "play" },
        ...bank("greed", 10, P1)
      ]
    });
    play(engine, P1, id("mez"), { selected: { picked: [id("c1"), id("c2")] } });
    assert.equal(engine.state.cards[id("c1")].depleted, true);
    assert.equal(engine.state.cards[id("c2")].depleted, true);
    assert.equal(engine.state.cards[id("c3")].depleted ?? false, false);
    activate(engine, P1, id("mez"), "mezz-party", { selected: { c: [id("c3")] } });
    assert.equal(engine.state.cards[id("c3")].depleted, true);
    assert.equal(engine.state.cards[id("mez")].damage, 1);
  });
});

// ---------------------------------------------------------------------------
// Port Manteau
// ---------------------------------------------------------------------------

describe("Seed 3 — Port Manteau", () => {
  test("names a subtype; cards of that subtype cost 2 more to deploy", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pm", def: def("Port Manteau"), owner: P1, zone: "hand" },
        { key: "gear", def: character({ name: "GearGuy", subtype: ["gear"], cost: 1 }), owner: P1, zone: "hand" },
        { key: "plain", def: character({ name: "PlainGuy", subtype: [], cost: 1 }), owner: P1, zone: "hand" },
        ...bank("greed", 10, P1)
      ]
    });
    play(engine, P1, id("pm"));
    answer(engine, P1, { kind: "nameValue", value: "gear" });
    assert.equal(engine.getCardPlayability(P1, id("gear")).numericCost, 3);
    assert.equal(engine.getCardPlayability(P1, id("plain")).numericCost, 1);
  });
});

// ---------------------------------------------------------------------------
// Prestige Inversion
// ---------------------------------------------------------------------------

describe("Seed 3 — Prestige Inversion", () => {
  test("removes a UNIQUE character from the game", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pi", def: def("Prestige Inversion"), owner: P1, zone: "hand" },
        { key: "u", def: uniqueChar(), owner: P2, zone: "play" },
        ...bank("greed", 6, P1)
      ]
    });
    play(engine, P1, id("pi"), { selected: { t: [id("u")] } });
    assert.equal(engine.state.cards[id("u")].zone, "removed");
  });

  test("a non-UNIQUE character is not a legal target", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pi", def: def("Prestige Inversion"), owner: P1, zone: "hand" },
        { key: "plain", def: character({ name: "Plain" }), owner: P2, zone: "play" },
        ...bank("greed", 6, P1)
      ]
    });
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("pi"), selected: { t: [id("plain")] } } as never)
    );
  });

  test("RECUR from the discard pile: pay 1, exile self, draw a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pi", def: def("Prestige Inversion"), owner: P1, zone: "discard" },
        { key: "dk", def: character({ name: "DeckCard" }), owner: P1, zone: "deck" },
        ...bank("greed", 6, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    activate(engine, P1, id("pi"), "prestige-recur");
    assert.equal(engine.state.cards[id("pi")].zone, "removed");
    assert.equal(engine.state.players[P1].hand.length, handBefore + 1);
  });
});

// ---------------------------------------------------------------------------
// Vilghame Manewaft
// ---------------------------------------------------------------------------

describe("Seed 3 — Vilghame Manewaft", () => {
  test("opponents pay 1 more to deploy a tactic", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "v", def: def("Vilghame Manewaft"), owner: P1, zone: "play" },
        { key: "opptac", def: tactic({ name: "OppTac", cost: 2 }), owner: P2, zone: "hand" },
        ...bank("rage", 6, P2)
      ]
    });
    assert.equal(engine.getCardPlayability(P2, id("opptac")).numericCost, 3);
  });

  test("an opponent's first resource each turn enters attached to their faction", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "v", def: def("Vilghame Manewaft"), owner: P1, zone: "play" },
        { key: "res", def: cardDef(SET, "Greed"), owner: P2, zone: "hand" }
      ],
      activePlayerId: P2
    });
    engine.perform({
      type: "chooseDevelop",
      playerId: P2,
      choice: { type: "playResource", cards: [{ cardId: id("res"), faceDown: false }] }
    } as never);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("res")].zone, "play");
    assert.equal(engine.state.cards[id("res")].attachedTo, engine.state.players[P2].factionId);
  });
});

// ---------------------------------------------------------------------------
// 94r913 My 908570pp3r5
// ---------------------------------------------------------------------------

describe("Seed 3 — 94r913 My 908570pp3r5", () => {
  test("picks up to 2 characters that must attack this turn, and draws a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pop", def: def("94r913 My 908570pp3r5"), owner: P1, zone: "hand" },
        { key: "a", def: character({ name: "A" }), owner: P1, zone: "play" },
        { key: "b", def: character({ name: "B" }), owner: P1, zone: "play" },
        { key: "dk", def: character({ name: "DeckCard" }), owner: P1, zone: "deck" },
        ...bank("elitism", 6, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("pop"), { selected: { picked: [id("a"), id("b")] } });
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1);
    assert.ok(engine.getRestrictions(id("a")).includes("mustAttack"));
    assert.ok(engine.getRestrictions(id("b")).includes("mustAttack"));
  });
});

// ---------------------------------------------------------------------------
// Ensmallment Ray
// ---------------------------------------------------------------------------

describe("Seed 3 — Ensmallment Ray", () => {
  test("ETB draws a card; your characters get -1/-1 and cost 2 less (min 1)", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ray", def: def("Ensmallment Ray"), owner: P1, zone: "hand" },
        { key: "onboard", def: character({ name: "OnBoard", strength: 3, life: 3 }), owner: P1, zone: "play" },
        { key: "inhand", def: character({ name: "InHand", cost: 4 }), owner: P1, zone: "hand" },
        { key: "dk", def: character({ name: "DeckCard" }), owner: P1, zone: "deck" },
        ...bank("elitism", 10, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("ray"));
    // -1 hand (ray) +1 draw
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1);
    assert.equal(engine.getStat(id("onboard"), "strength"), 2);
    assert.equal(engine.getStat(id("onboard"), "life"), 2);
    assert.equal(engine.getCardPlayability(P1, id("inhand")).numericCost, 2);
  });
});

// ---------------------------------------------------------------------------
// Hilarious Refrigerator Alarm
// ---------------------------------------------------------------------------

describe("Seed 3 — Hilarious Refrigerator Alarm", () => {
  test("terminates every other unresolved card on the stack", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "alarm", def: def("Hilarious Refrigerator Alarm"), owner: P1, zone: "hand" },
        { key: "other", def: tactic({ name: "OtherTac", cost: 0 }), owner: P2, zone: "hand" },
        ...bank("elitism", 8, P1),
        ...bank("rage", 4, P2)
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("alarm"), selected: {} } as never);
    // P2 responds with its own tactic, then both pass so the stack resolves top-down
    engine.perform({ type: "playCard", playerId: P2, cardId: id("other"), selected: {} } as never);
    resolvePendingResponses(engine);
    let guard = 0;
    while (engine.state.pendingChoice && guard++ < 20) {
      const pc = engine.state.pendingChoice as { kind: string; playerId: string };
      // decline any micromajig offers
      engine.perform({
        type: "resolvePendingChoice",
        playerId: pc.playerId,
        choice: pc.kind === "mayPay" ? { kind: "mayPay", pay: false } : { kind: "chooserSelectsOption", index: 0 }
      } as never);
      resolvePendingResponses(engine);
    }
    assert.equal(engine.state.cards[id("other")].zone, "discard");
  });
});

// ---------------------------------------------------------------------------
// Merbegon, the Insatiable Taxidermist
// ---------------------------------------------------------------------------

describe("Seed 3 — Merbegon, the Insatiable Taxidermist", () => {
  test("has AGGRO", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "m", def: def("Merbegon, the Insatiable Taxidermist"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getKeywords(id("m")).includes("aggro"));
  });

  test("may graft an entering ally: destroy it and buff a chosen character by its stats", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "m", def: def("Merbegon, the Insatiable Taxidermist"), owner: P1, zone: "play" },
        { key: "food", def: character({ name: "Food", cost: 1, strength: 3, life: 5 }), owner: P1, zone: "hand" },
        { key: "buffme", def: character({ name: "BuffMe", strength: 1, life: 1 }), owner: P1, zone: "play" },
        ...bank("elitism", 10, P1)
      ]
    });
    play(engine, P1, id("food"));
    answer(engine, P1, { kind: "mayPay", pay: true });
    if (engine.state.pendingChoice) {
      answer(engine, P1, { kind: "chooserSelectsTarget", selected: [id("buffme")] });
    }
    assert.equal(engine.state.cards[id("food")].zone, "discard");
    assert.equal(engine.getStat(id("buffme"), "strength"), 4);
    assert.equal(engine.getStat(id("buffme"), "life"), 6);
  });
});

// ---------------------------------------------------------------------------
// Notion Sickness
// ---------------------------------------------------------------------------

describe("Seed 3 — Notion Sickness", () => {
  test("uses a controlled card's activated ability twice, then destroys that card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ns", def: def("Notion Sickness"), owner: P1, zone: "hand" },
        { key: "drawer", def: drawerChar(), owner: P1, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" },
        { key: "d3", def: character({ name: "D3" }), owner: P1, zone: "deck" },
        ...bank("elitism", 8, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("ns"), { selected: { pick: [id("drawer")] } });
    let guard = 0;
    while (engine.state.pendingChoice && guard++ < 10) {
      const pc = engine.state.pendingChoice as { kind: string; playerId: string };
      engine.perform({
        type: "resolvePendingChoice",
        playerId: pc.playerId,
        choice:
          pc.kind === "useTargetAbility"
            ? { kind: "useTargetAbility", abilityId: "draw1" }
            : pc.kind === "useAnyAbility"
              ? { kind: "useAnyAbility", cardId: id("drawer") }
              : { kind: "chooserSelectsOption", index: 0 }
      } as never);
      resolvePendingResponses(engine);
    }
    // -1 ns, +2 from the doubled draw
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 2);
    assert.equal(engine.state.cards[id("drawer")].zone, "discard");
  });
});

// ---------------------------------------------------------------------------
// Axeclaw Grandchest
// ---------------------------------------------------------------------------

describe("Seed 3 — Axeclaw Grandchest", () => {
  test("gains strength equal to the numeric cost of the revealed top card of the deck", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "ax", def: def("Axeclaw Grandchest"), owner: P1, zone: "play" },
        { key: "top", def: character({ name: "TopCard", cost: 4 }), owner: P1, zone: "deck" }
      ]
    });
    // printed strength (0) + revealed top card's numeric cost (4)
    assert.equal(engine.getStat(id("ax"), "strength"), (def("Axeclaw Grandchest").strength ?? 0) + 4);
  });

  test("SHAKE UP costs 2", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "ax", def: def("Axeclaw Grandchest"), owner: P1, zone: "play" },
        { key: "top", def: character({ name: "TopCard", cost: 4 }), owner: P1, zone: "deck" },
        ...bank("rage", 2, P1)
      ]
    });
    activate(engine, P1, id("ax"), "axeclaw-shakeup");
    assert.equal(engine.getAvailableResourceCount(P1), 0);
  });
});

// ---------------------------------------------------------------------------
// Community Chest
// ---------------------------------------------------------------------------

describe("Seed 3 — Community Chest", () => {
  test("at the start of a turn each player may draw a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "cc", def: def("Community Chest"), owner: P1, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P2, zone: "deck" },
        { key: "d2", def: character({ name: "D2" }), owner: P2, zone: "deck" }
      ]
    });
    const p2HandBefore = engine.state.players[P2].hand.length;
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    let guard = 0;
    while (engine.state.pendingChoice && guard++ < 20) {
      const pc = engine.state.pendingChoice as { kind: string; playerId: string };
      engine.perform({
        type: "resolvePendingChoice",
        playerId: pc.playerId,
        choice:
          pc.kind === "mayPay"
            ? { kind: "mayPay", pay: pc.playerId === P2 }
            : pc.kind === "chooserSelectsOption"
              ? { kind: "chooserSelectsOption", index: 0 }
              : { kind: "chooserSelectsTarget", selected: [] }
      } as never);
      resolvePendingResponses(engine);
    }
    assert.equal(engine.state.players[P2].hand.length, p2HandBefore + 1);
  });
});

// ---------------------------------------------------------------------------
// Delicious Strawberry Flavored Death
// ---------------------------------------------------------------------------

describe("Seed 3 — Delicious Strawberry Flavored Death", () => {
  test("depletes every non-Rogue character on both sides; Rogues are untouched", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "death", def: def("Delicious Strawberry Flavored Death"), owner: P1, zone: "hand" },
        { key: "mine", def: character({ name: "Mine", trade: "universal" }), owner: P1, zone: "play" },
        { key: "rogue", def: character({ name: "Sneak", trade: "rogue" }), owner: P1, zone: "play" },
        { key: "theirs", def: character({ name: "Theirs", trade: "warlord" }), owner: P2, zone: "play" },
        { key: "dk", def: character({ name: "DeckCard" }), owner: P1, zone: "deck" },
        ...bank("deception", 8, P1)
      ]
    });
    play(engine, P1, id("death"));
    assert.equal(engine.state.cards[id("mine")].depleted, true);
    assert.equal(engine.state.cards[id("theirs")].depleted, true);
    assert.equal(engine.state.cards[id("rogue")].depleted ?? false, false);
  });
});

// ---------------------------------------------------------------------------
// Fornicaves
// ---------------------------------------------------------------------------

describe("Seed 3 — Fornicaves", () => {
  test("every character loses (printed life - 2) life", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "forn", def: def("Fornicaves"), owner: P1, zone: "play" },
        { key: "big", def: character({ name: "Big", life: 5 }), owner: P1, zone: "play" },
        { key: "small", def: character({ name: "Small", life: 2 }), owner: P2, zone: "play" }
      ]
    });
    // life 5 -> 5 - (5 - 2) = 2
    assert.equal(engine.getStat(id("big"), "life"), 2);
    // life 2 -> 2 - (2 - 2) = 2
    assert.equal(engine.getStat(id("small"), "life"), 2);
  });
});

// ---------------------------------------------------------------------------
// Iohane, the Convex
// ---------------------------------------------------------------------------

describe("Seed 3 — Iohane, the Convex", () => {
  test("has TACTICAL", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "io", def: def("Iohane, the Convex"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getKeywords(id("io")).includes("tactical"));
  });

  test("SNEAK grants COVERT for the turn", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "io", def: def("Iohane, the Convex"), owner: P1, zone: "play" },
        ...bank("deception", 2, P1)
      ]
    });
    assert.equal(engine.getKeywords(id("io")).includes("covert"), false);
    activate(engine, P1, id("io"), "iohane-sneak");
    assert.ok(engine.getKeywords(id("io")).includes("covert"));
  });
});

// ---------------------------------------------------------------------------
// Ipsighast, the Lustful
// ---------------------------------------------------------------------------

describe("Seed 3 — Ipsighast, the Lustful", () => {
  test("EXHUMATION exiles a character from an opponent's discard and gains COVERT", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ip", def: def("Ipsighast, the Lustful"), owner: P1, zone: "play" },
        { key: "corpse", def: character({ name: "Corpse" }), owner: P2, zone: "discard" },
        ...bank("deception", 6, P1)
      ]
    });
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("ip"),
      abilityId: "ipsighast-exhume",
      selected: { c: [id("corpse")] }
    });
    resolvePendingResponses(engine);
    if (engine.state.pendingChoice) answer(engine, P1, { kind: "mayPay", pay: false });
    assert.equal(engine.state.cards[id("corpse")].zone, "removed");
    assert.ok(engine.getKeywords(id("ip")).includes("covert"));
  });

  test("a character in your own discard is not a legal target", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ip", def: def("Ipsighast, the Lustful"), owner: P1, zone: "play" },
        { key: "mine", def: character({ name: "MyCorpse" }), owner: P1, zone: "discard" },
        ...bank("deception", 6, P1)
      ]
    });
    assert.throws(() =>
      engine.perform({
        type: "activateAbility",
        playerId: P1,
        cardId: id("ip"),
        abilityId: "ipsighast-exhume",
        selected: { c: [id("mine")] }
      })
    );
  });
});

// ---------------------------------------------------------------------------
// Unscrupuls of Victory
// ---------------------------------------------------------------------------

describe("Seed 3 — Unscrupuls of Victory", () => {
  test("[O][O]: an opponent discards; [G][G]: you draw", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "uv", def: def("Unscrupuls of Victory"), owner: P1, zone: "hand" },
        { key: "opphand", def: character({ name: "OppHand" }), owner: P2, zone: "hand" },
        { key: "dk", def: character({ name: "DeckCard" }), owner: P1, zone: "deck" },
        ...bank("obsession", 2, P1),
        ...bank("greed", 2, P1)
      ]
    });
    const p1HandBefore = engine.state.players[P1].hand.length;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("uv"), selected: {} } as never);
    resolvePendingResponses(engine);
    let guard = 0;
    while (engine.state.pendingChoice && guard++ < 10) {
      const pc = engine.state.pendingChoice as { kind: string; playerId: string };
      engine.perform({
        type: "resolvePendingChoice",
        playerId: pc.playerId,
        choice: { kind: "chooserSelectsTarget", selected: pc.playerId === P2 ? [id("opphand")] : [] }
      } as never);
      resolvePendingResponses(engine);
    }
    assert.equal(engine.state.cards[id("opphand")].zone, "discard");
    // -1 for the tactic, +1 from the [G][G] draw
    assert.equal(engine.state.players[P1].hand.length, p1HandBefore - 1 + 1);
  });
});

// ---------------------------------------------------------------------------
// Giada, the Elegant
// ---------------------------------------------------------------------------

describe("Seed 3 — Giada, the Elegant", () => {
  test("loses 1 strength and 1 life per token", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "gi", def: def("Giada, the Elegant"), owner: P1, zone: "play", counters: { token: 1 } }]
    });
    const d = def("Giada, the Elegant");
    assert.equal(engine.getStat(id("gi"), "strength"), (d.strength ?? 0) - 1);
    assert.equal(engine.getStat(id("gi"), "life"), (d.life ?? 0) - 1);
  });

  test("would-be destruction by an opponent is replaced with a token + deplete", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "gi", def: def("Giada, the Elegant"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P2, zone: "hand" },
        ...bank("rage", 4, P2)
      ],
      activePlayerId: P2
    });
    play(engine, P2, id("kill"), { selected: { t: [id("gi")] } });
    if (engine.state.pendingChoice) answer(engine, P1, { kind: "replacementChoice", apply: true });
    assert.equal(engine.state.cards[id("gi")].zone, "play");
    assert.equal(engine.state.cards[id("gi")].counters.token, 1);
    assert.equal(engine.state.cards[id("gi")].depleted, true);
  });
});

// ---------------------------------------------------------------------------
// Octo-Ba-Ba, the Devourer
// ---------------------------------------------------------------------------

describe("Seed 3 — Octo-Ba-Ba, the Devourer", () => {
  test("gains a token when an opposing character is destroyed; DEVOUR spends it for 3 damage", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "octo", def: def("Octo-Ba-Ba, the Devourer"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        { key: "prey", def: character({ name: "Prey", life: 3 }), owner: P2, zone: "play" },
        { key: "target", def: character({ name: "Target", life: 10 }), owner: P2, zone: "play" },
        ...bank("rage", 10, P1)
      ]
    });
    play(engine, P1, id("kill"), { selected: { t: [id("prey")] } });
    assert.equal(engine.state.cards[id("octo")].counters.token, 1);
    activate(engine, P1, id("octo"), "octo-devour", { selected: { t: [id("target")] } });
    assert.equal(engine.state.cards[id("target")].damage, 3);
    assert.equal(engine.state.cards[id("octo")].counters.token ?? 0, 0);
    assert.equal(engine.state.cards[id("octo")].depleted, true);
  });
});

// ---------------------------------------------------------------------------
// Shieldmane Grandchest
// ---------------------------------------------------------------------------

describe("Seed 3 — Shieldmane Grandchest", () => {
  test("battle damage to a character you control is reduced by 2", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "sg", def: def("Shieldmane Grandchest"), owner: P1, zone: "play" },
        { key: "blocker", def: character({ name: "Blocker", strength: 1, life: 5, speed: 1 }), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Attacker", strength: 3, life: 3, speed: 3 }), owner: P2, zone: "play" }
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("blocker")] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    // 3 strength - 2 from Shieldmane = 1 damage
    assert.equal(engine.state.cards[id("blocker")].damage, 1);
  });
});

// ---------------------------------------------------------------------------
// The Great Wall of Keeping Stuff Out
// ---------------------------------------------------------------------------

describe("Seed 3 — The Great Wall of Keeping Stuff Out", () => {
  test("a deployed tactic is terminated and the wall takes 1 damage", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "wall", def: def("The Great Wall of Keeping Stuff Out"), owner: P1, zone: "play" },
        { key: "tac", def: tactic({ name: "Doomed", cost: 0 }), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("tac"));
    assert.equal(engine.state.cards[id("tac")].zone, "discard");
    assert.equal(engine.state.cards[id("wall")].damage, 1);
  });
});

// ---------------------------------------------------------------------------
// The Stone of Triumph
// ---------------------------------------------------------------------------

describe("Seed 3 — The Stone of Triumph", () => {
  test("on an ally death, pay 1 to tutor a same-named card to the top of the deck", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "st", def: def("The Stone of Triumph"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        { key: "hero", def: character({ name: "Hero", id: "s3-hero-play" }), owner: P1, zone: "play" },
        { key: "heroCopy", def: character({ name: "Hero", id: "s3-hero-deck" }), owner: P1, zone: "deck" },
        { key: "filler", def: character({ name: "Filler" }), owner: P1, zone: "deck" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("kill"), { selected: { t: [id("hero")] } });
    if (engine.state.pendingChoice) answer(engine, P1, { kind: "mayPay", pay: true });
    if (engine.state.pendingChoice) {
      answer(engine, P1, { kind: "chooserSelectsTarget", selected: [id("heroCopy")] });
    }
    assert.equal(engine.state.players[P1].deck[0], id("heroCopy"));
  });
});
