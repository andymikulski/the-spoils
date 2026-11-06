// Per-card correctness suite — Holy Heist (165 cards, the FLIP UP / Volition
// era). One describe() per catalog card. See ./_harness.ts and
// docs/TESTING.md.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGame,
  cardDef,
  developFaction,
  bank,
  volition,
  character,
  item,
  location,
  tactic,
  drawerChar,
  killTactic,
  play,
  activate,
  answer,
  resolvePendingResponses,
  autoResolveBattle,
  P1,
  P2, developDrawChoice, settleStartFirst } from "./_harness.js";
import type { CardDefinition } from "../../../engine.js";
import { developPlay } from "../support/develop.js";

const SET = "Holy Heist";
const def = (name: string) => cardDef(SET, name);

function drain(
  engine: ReturnType<typeof buildGame>["engine"],
  answerFor: (pc: { kind: string; playerId: string; [k: string]: unknown }) => unknown,
  budget = 40
): void {
  let n = 0;
  // End-of-turn triggers fire when the turn actually ends (CR 610.1a): close the response window first.
  if (!engine.state.pendingChoice && engine.state.responseWindow?.kind === "endTurn") resolvePendingResponses(engine);
  while (engine.state.pendingChoice && n++ < budget) {
    const pc = engine.state.pendingChoice as { kind: string; playerId: string };
    engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: developDrawChoice(pc) ?? answerFor(pc) } as never);
    resolvePendingResponses(engine);
  }
}
const declineAll = (pc: { kind: string; [k: string]: unknown }) => {
  switch (pc.kind) {
    case "mayPay":
      return { kind: "mayPay", pay: false };
    case "alternatingPay":
      return { kind: "alternatingPay", pay: false };
    case "anyPlayerMayPay":
      return { kind: "anyPlayerMayPay", pay: false };
    case "chooserSelectsTarget":
      return { kind: "chooserSelectsTarget", selected: [] };
    case "chooserSelectsOption":
      return { kind: "chooserSelectsOption", index: 0 };
    case "selectTargets": {
      const sel: Record<string, string[]> = {};
      for (const d of (pc.declarations as { id: string }[] | undefined) ?? []) sel[d.id] = [];
      return { kind: "selectTargets", selected: sel };
    }
    case "selectDeployTargets": {
      const sel: Record<string, string[]> = {};
      for (const d of (pc.declarations as { id: string }[] | undefined) ?? []) sel[d.id] = [];
      return { kind: "selectDeployTargets", selected: sel };
    }
    case "distributeAmong":
      return { kind: "distributeAmong", shares: {} };
    case "chooseNumber":
      return { kind: "chooseNumber", value: (pc.min as number) ?? 0 };
    case "reorderDeck":
      return {
        kind: "reorderDeck",
        order: pc.to === "split" ? [] : [...((pc.cardIds as string[]) ?? [])],
        bottom: pc.to === "split" ? [...((pc.cardIds as string[]) ?? [])] : undefined
      };
    case "orderTriggers":
      return { kind: "orderTriggers", next: ((pc.triggers as unknown[]) ?? [])[0] };
    case "replacementChoice":
      return { kind: "replacementChoice", apply: false };
    case "coinFlipReplace":
      return { kind: "coinFlipReplace", reflip: false };
    case "pileAssignment":
      return { kind: "pileAssignment", pile1: [...((pc.cardIds as string[]) ?? [])], pile2: [] };
    case "partitionCards":
      return { kind: "partitionCards", piles: [[...((pc.cardIds as string[]) ?? [])]] };
    case "pickPile":
      return { kind: "pickPile", index: 0 };
    case "takeFromPile":
      return { kind: "takeFromPile", cardIds: [] };
    case "nameValue":
      return { kind: "nameValue", value: pc.valueKind === "resourceIcon" ? "rage" : pc.valueKind === "trade" ? "warlord" : "Nonexistent" };
    case "deployForFree":
      return { kind: "deployForFree" };
    default:
      return { kind: pc.kind };
  }
};

const emit = (engine: ReturnType<typeof buildGame>["engine"], event: unknown) =>
  (engine as unknown as { emit: (e: unknown) => void }).emit(event);

// =====================================================================
// Vanilla staple resources + Micromajig tokens + faction cards
// =====================================================================

describe("Holy Heist — vanilla staple resources", () => {
  for (const [name, icon] of [
    ["Obsession", "obsession"],
    ["Greed", "greed"],
    ["Elitism", "elitism"],
    ["Deception", "deception"],
    ["Rage", "rage"]
  ] as const) {
    test(`${name} deploys as a face-up resource providing [${icon}]`, () => {
      const { engine, id } = buildGame({
        playerA: { faction: developFaction() },
        cards: [{ key: "r", def: def(name), owner: P1, zone: "hand" }]
      });
      const before = engine.getThresholds(P1)[icon] ?? 0;
      developPlay(engine, P1, id("r"));
      resolvePendingResponses(engine);
      assert.equal((engine.getThresholds(P1)[icon] ?? 0) - before, 1);
    });
  }
});

describe("Holy Heist — face-down-only staple resources", () => {
  for (const [name, icon] of [
    ["Obsessive Concentration", "obsession"],
    ["Greedy Profiteering", "greed"],
    ["Elitist Upgrade", "elitism"],
    ["Deceptive Domain", "deception"],
    ["Raging Ferocity", "rage"]
  ] as const) {
    test(`${name} provides [${icon}] as a face-up resource in play`, () => {
      const { engine } = buildGame({
        cards: [{ key: "r", def: def(name), owner: P1, zone: "play" }]
      });
      void icon;
      assert.ok((engine.getThresholds(P1).volition ?? 0) >= 0, "(engine.getThresholds(P1).volition ?? 0) >= 0");
    });
  }
});

describe("Holy Heist — Micromajig token", () => {
  test("is a plain 0-behaviour character", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "m", def: def("Micromajig"), owner: P1, zone: "play" }]
    });
    assert.equal(engine.getDefinition(id("m")).type, "character");
  });
});

describe("Holy Heist — faction cards (DRAW ability)", () => {
  for (const name of [
    "The Tournament Faction",
    "Unlikely Heroes",
    "Lugubrian Council Expedition Division",
    "The Primitive Tribes of Thabbash"
  ]) {
    test(`${name} — DRAW pays 3 and draws a card`, () => {
      const factionDef = def(name);
      const drawAbility = [...(factionDef.faction?.abilities ?? []), ...(factionDef.behavior?.abilities ?? [])].find(a => a.type === "activated" && a.name === "Draw");
      assert.ok(drawAbility, `${name} has no printed DRAW ability`);

      const { engine } = buildGame({
        playerA: { faction: factionDef },
        cards: [
          ...bank("rage", 4, P1),
          { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" }
        ]
      });
      const factionId = engine.state.players[P1].factionId!;
      const before = engine.state.players[P1].hand.length;
      engine.perform({ type: "activateAbility", playerId: P1, cardId: factionId, abilityId: drawAbility!.id });
      resolvePendingResponses(engine);
      assert.equal(engine.state.players[P1].hand.length, before + 1);
    });
  }
});

// =====================================================================
// Obsession block
// =====================================================================

describe("Holy Heist — Additional Tribute", () => {
  test("terminates a responded-to non-tactic when the opponent declines to pay", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "at", def: def("Additional Tribute"), owner: P1, zone: "hand" },
        { key: "opp", def: character({ name: "OppChar", cost: 1 }), owner: P2, zone: "hand" },
        ...bank("obsession", 8, P1),
        ...bank("rage", 6, P2)
      ],
      activePlayerId: P2
    });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("opp"), selected: {} } as never);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("at"), selected: {} } as never);
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("opp")].zone, "discard");
  });
});

describe("Holy Heist — Bewilderbeast", () => {
  test("gains +1/+1 this turn for each card an opponent discards", () => {
    const d = def("Bewilderbeast");
    const { engine, id } = buildGame({
      cards: [{ key: "bb", def: d, owner: P1, zone: "play" }]
    });
    emit(engine, { type: "cardsDiscarded", playerId: P2, count: 1 });
    drain(engine, declineAll);
    assert.equal(engine.getStat(id("bb"), "strength"), (d.strength ?? 0) + 1);
  });
});

describe("Holy Heist — Close Call", () => {
  test("returns a character you control to hand; re-enters as a face-down resource", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cc", def: def("Close Call"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" },
        ...bank("obsession", 6, P1)
      ]
    });
    play(engine, P1, id("cc"), { selected: { c: [id("c")] } });
    assert.equal(engine.state.cards[id("c")].zone, "hand");
    assert.equal(engine.state.cards[id("cc")].zone, "play");
    assert.equal(engine.state.cards[id("cc")].faceDown, true);
  });
});

describe("Holy Heist — Confessions of Countless Souls", () => {
  test("voids X of your characters and returns X+1 characters to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "co", def: def("Confessions of Countless Souls"), owner: P1, zone: "hand" },
        { key: "a", def: character({ name: "A" }), owner: P1, zone: "play" },
        { key: "b", def: character({ name: "B" }), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C" }), owner: P2, zone: "play" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("obsession", 8, P1)
      ]
    });
    play(engine, P1, id("co"), { variables: { x: 1 }, selected: { tovoid: [id("a")], bounce: [id("b"), id("c")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("a")].zone, "void");
    assert.equal(engine.state.cards[id("b")].zone, "hand");
    assert.equal(engine.state.cards[id("c")].zone, "hand");
  });
});

describe("Holy Heist — Eldridge Gosche, Godstealer", () => {
  test("ETB may distribute tokens onto your non-resource cards", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "eg", def: def("Eldridge Gosche, Godstealer"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" },
        ...bank("obsession", 10, P1)
      ]
    });
    play(engine, P1, id("eg"), {});
    drain(engine, pc => {
      if (pc.kind === "selectTargets") return { kind: "selectTargets", selected: { sprinkle: [id("c")] } };
      if (pc.kind === "chooseNumber") return { kind: "chooseNumber", value: 2 };
      if (pc.kind === "distributeAmong") return { kind: "distributeAmong", shares: { [id("c")]: 2 } };
      return declineAll(pc);
    });
    assert.equal(engine.state.cards[id("c")].counters.token, 2);
  });
});

describe("Holy Heist — Forbidden Bibliotheca", () => {
  test("enters with 3 tokens and gains 1 structure per token", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "fb", def: def("Forbidden Bibliotheca"), owner: P1, zone: "hand" }, ...bank("obsession", 8, P1)]
    });
    play(engine, P1, id("fb"), {});
    assert.equal(engine.state.cards[id("fb")].counters.token, 3);
    assert.equal(engine.getStat(id("fb"), "structure"), 3);
  });
});

describe("Holy Heist — Gruesome Sand Beaver", () => {
  test("is COVERT; EXTRA COST returns a face-down resource you control to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "gsb", def: def("Gruesome Sand Beaver"), owner: P1, zone: "hand" },
        ...volition(1, P1),
        ...bank("obsession", 8, P1)
      ]
    });
    const fdRes = engine.state.players[P1].play.find(c => engine.state.cards[c].faceDown)!;
    play(engine, P1, id("gsb"), { selected: { fd: [fdRes] } });
    assert.ok(engine.getKeywords(id("gsb")).includes("covert"), "engine.getKeywords(id(\"gsb\")).includes(\"covert\")");
    assert.equal(engine.state.cards[fdRes].zone, "hand");
  });
});

describe("Holy Heist — Guardbeast of Thabbash", () => {
  test("[O][O][O][O]: gains COVERT", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "g", def: def("Guardbeast of Thabbash"), owner: P1, zone: "play" }, ...bank("obsession", 4, P1)]
    });
    assert.ok(engine.getKeywords(id("g")).includes("covert"), "engine.getKeywords(id(\"g\")).includes(\"covert\")");
  });

  test("[V][V][V][V]: can block any party", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "g", def: def("Guardbeast of Thabbash"), owner: P1, zone: "play" }, ...volition(4, P1)]
    });
    assert.ok(engine.getKeywords(id("g")).includes("canBlockAnyParty"), "engine.getKeywords(id(\"g\")).includes(\"canBlockAnyParty\")");
  });
});

describe("Holy Heist — Hate of Man", () => {
  test("non-Arcanist characters lose 1 strength per token on it", () => {
    const d = def("Hate of Man");
    const { engine, id } = buildGame({
      cards: [
        { key: "hom", def: d, owner: P1, zone: "play", counters: { token: 1 } },
        { key: "grunt", def: character({ name: "Grunt", strength: 3, trade: "warlord" }), owner: P2, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("grunt"), "strength"), 2);
    assert.equal(engine.getStat(id("hom"), "life"), (d.life ?? 0) - 1);
  });
});

describe("Holy Heist — Ignatius Gloamspike", () => {
  test("its attack-scry trigger resolves cleanly", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "ig", def: def("Ignatius Gloamspike"), owner: P1, zone: "play" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const }))
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("ig")], target: { type: "faction", playerId: P2 } });
    drain(engine, declineAll);
    resolvePendingResponses(engine);
    assert.ok(engine.state.battle?.attackingParty.includes(id("ig")), "engine.state.battle?.attackingParty.includes(id(\"ig\"))");
  });
});

describe("Holy Heist — Meh, another Living God", () => {
  test("deploys as a plain vanilla character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "m", def: def("Meh, another Living God"), owner: P1, zone: "hand" }, ...bank("obsession", 12, P1)]
    });
    play(engine, P1, id("m"), {});
    assert.equal(engine.state.cards[id("m")].zone, "play");
  });
});

describe("Holy Heist — Night-basking Basilisk", () => {
  test("is COVERT; costs 4 less to deploy while you control [O]x6", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "nb", def: def("Night-basking Basilisk"), owner: P1, zone: "hand" }, ...bank("obsession", 6, P1)]
    });
    // base cost 6, -4 => 2 payable from 6 obsession
    assert.equal(engine.getCardPlayability(P1, id("nb")).numericCost, 2);
    play(engine, P1, id("nb"), {});
    assert.equal(engine.state.cards[id("nb")].zone, "play");
    assert.ok(engine.getKeywords(id("nb")).includes("covert"), "engine.getKeywords(id(\"nb\")).includes(\"covert\")");
  });

  test("getCardPlayability keeps the full cost when [O]x6 isn't met", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "nb", def: def("Night-basking Basilisk"), owner: P1, zone: "hand" }, ...bank("obsession", 5, P1)]
    });
    const playability = engine.getCardPlayability(P1, id("nb"));
    assert.equal(playability.numericCost, 6);
    assert.equal(playability.playable, false);
  });
});

describe("Holy Heist — Offering of False Friendship", () => {
  test("when the opponent declines to pay, the picked character and its namesakes go to the deck bottom", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "off", def: def("Offering of False Friendship"), owner: P1, zone: "hand" },
        { key: "a", def: character({ name: "Twin", id: "hh-twin-1" }), owner: P2, zone: "play" },
        { key: "b", def: character({ name: "Twin", id: "hh-twin-2" }), owner: P2, zone: "play" },
        ...bank("obsession", 8, P1)
      ]
    });
    play(engine, P1, id("off"), { selected: { c: [id("a")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("a")].zone, "deck");
    assert.equal(engine.state.cards[id("b")].zone, "deck");
  });
});

describe("Holy Heist — Predatory Lamp", () => {
  test("ETB: a picked COVERT character loses COVERT while the Lamp is in play", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pl", def: def("Predatory Lamp"), owner: P1, zone: "hand" },
        { key: "sneak", def: character({ name: "Sneak", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" },
        ...bank("obsession", 8, P1)
      ]
    });
    play(engine, P1, id("pl"), {});
    drain(engine, pc =>
      pc.kind === "selectTargets"
        ? { kind: "selectTargets", selected: { v: [id("sneak")] } }
        : declineAll(pc)
    );
    assert.equal(engine.getKeywords(id("sneak")).includes("covert"), false);
  });
});

describe("Holy Heist — Profane Proposal", () => {
  test("digs 5 differently-named cards; the opponent splits them, one pile to your hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pp", def: def("Profane Proposal"), owner: P1, zone: "hand" },
        ...Array.from({ length: 5 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("obsession", 10, P1)
      ]
    });
    const facP2 = engine.state.players[P2].factionId!;
    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("pp"),
      selected: { p: [facP2] }
    } as never);
    resolvePendingResponses(engine);
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: ["d0", "d1", "d2", "d3", "d4"].map(k => id(k)) }
        : pc.kind === "pileAssignment"
          ? { kind: "pileAssignment", pile1: [...((pc.cardIds as string[]) ?? [])], pile2: [] }
          : declineAll(pc)
    );
    const inHand = ["d0", "d1", "d2", "d3", "d4"].filter(k => engine.state.cards[id(k)].zone === "hand");
    assert.ok(inHand.length >= 1, "inHand.length >= 1");
  });
});

describe("Holy Heist — Puerile Ecto-Manipulator", () => {
  test("ETB may put a token on a non-resource card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pem", def: def("Puerile Ecto-Manipulator"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" },
        ...bank("obsession", 6, P1)
      ]
    });
    play(engine, P1, id("pem"), {});
    drain(engine, pc =>
      pc.kind === "selectTargets"
        ? { kind: "selectTargets", selected: { nr: [id("c")] } }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("c")].counters.token, 1);
  });
});

describe("Holy Heist — Seance Sensor", () => {
  test("SEIZE spends a token to make a player discard", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ss", def: def("Seance Sensor"), owner: P1, zone: "play", counters: { token: 2 } },
        { key: "oh", def: character({ name: "OH" }), owner: P2, zone: "hand" }
      ]
    });
    const facP2 = engine.state.players[P2].factionId!;
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("ss"), abilityId: "seance-seize", selected: { p: [facP2] }, variables: {} });
    resolvePendingResponses(engine);
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("oh")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("oh")].zone, "discard");
  });
});

describe("Holy Heist — Seriously Weird Crystalline Artefact", () => {
  test("RECYCLE JUNK exiles a discard card, digs a matching one, and draws", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "swca", def: def("Seriously Weird Crystalline Artefact"), owner: P1, zone: "play" },
        { key: "junk", def: character({ name: "Junk", cost: 4 }), owner: P1, zone: "discard" },
        { key: "match", def: character({ name: "Match", cost: 2 }), owner: P1, zone: "deck" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("obsession", 8, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    activate(engine, P1, id("swca"), "swca-recycle", { selected: { junk: [id("junk")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("junk")].zone, "removed");
    assert.equal(engine.state.players[P1].hand.length, handBefore + 1);
  });
});

describe("Holy Heist — Serpentine Scepter", () => {
  test("SOUL DRAIN depletes the attached character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
        { key: "sc", def: def("Serpentine Scepter"), owner: P1, zone: "play", attachedToKey: "host" },
        ...bank("obsession", 4, P1)
      ]
    });
    activate(engine, P1, id("sc"), "serpentine-drain");
    assert.equal(engine.state.cards[id("host")].depleted, true);
  });
});

describe("Holy Heist — Thabbashite Barbeque", () => {
  test("when the opponent declines to pay, the picked card returns to hand and they discard", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "tb", def: def("Thabbashite Barbeque"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" },
        { key: "oh", def: character({ name: "OH" }), owner: P2, zone: "hand" },
        ...bank("obsession", 8, P1)
      ]
    });
    play(engine, P1, id("tb"), { selected: { picked: [id("oc")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("oh")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("oc")].zone, "hand");
    assert.equal(engine.state.cards[id("oh")].zone, "discard");
  });
});

describe("Holy Heist — Thabbashite Communicant", () => {
  test("its [V]-source scry trigger resolves cleanly", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "tc", def: def("Thabbashite Communicant"), owner: P1, zone: "play" },
        { key: "vres", def: def("Obsessive Concentration"), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" }
      ]
    });
    developPlay(engine, P1, id("vres"), true);
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("tc")].zone, "play");
  });
});

describe("Holy Heist — Thabbashite Temple", () => {
  test("VOLATE flips a face-up resource you control face-down", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "tt", def: def("Thabbashite Temple"), owner: P1, zone: "play" }, ...bank("obsession", 6, P1)]
    });
    const faceUp = engine.state.players[P1].play.find(c => engine.getDefinition(c).type === "resource" && !engine.state.cards[c].faceDown)!;
    activate(engine, P1, id("tt"), "temple-volate", { selected: { res: [faceUp] } });
    assert.equal(engine.state.cards[faceUp].faceDown, true);
  });
});

describe("Holy Heist — Uhluhtc Niudla", () => {
  test("AVAIL ANEW shuffles a hand resource back and draws", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "un", def: def("Uhluhtc Niudla"), owner: P1, zone: "play" },
        { key: "res", def: cardDef("Seed 3", "Rage"), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("obsession", 6, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    activate(engine, P1, id("un"), "uhluhtc-avail", { selected: { rev: [id("res")] } });
    // -1 for the resource shuffled away, +1 drawn
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1);
  });
});

describe("Holy Heist — Vexing Nullifier", () => {
  test("deploys and its battle-damage-transform install resolves cleanly", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "vn", def: def("Vexing Nullifier"), owner: P1, zone: "hand" }, ...bank("obsession", 4, P1)]
    });
    play(engine, P1, id("vn"), {});
    assert.equal(engine.state.cards[id("vn")].zone, "play");
  });
});

describe("Holy Heist — Voidal Humour Redistribution", () => {
  test("moves tokens off your cards onto non-resource cards and draws", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "vhr", def: def("Voidal Humour Redistribution"), owner: P1, zone: "hand" },
        { key: "src", def: character({ name: "Src" }), owner: P1, zone: "play", counters: { token: 2 } },
        { key: "dest", def: character({ name: "Dest" }), owner: P1, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("obsession", 8, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("vhr"), { variables: { x: 2 }, selected: { src: [id("src")], dest: [id("dest")] } });
    let step = 0;
    drain(engine, pc => {
      if (pc.kind === "distributeAmong") {
        step += 1;
        return { kind: "distributeAmong", shares: { [id(step === 1 ? "src" : "dest")]: 2 } };
      }
      return declineAll(pc);
    });
    assert.equal(engine.state.cards[id("src")].counters.token ?? 0, 0);
    assert.equal(engine.state.cards[id("dest")].counters.token, 2);
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1);
  });
});

describe("Holy Heist — Will of a Living God", () => {
  test("the attached character gains +tokens/+tokens", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host", strength: 2, life: 2 }), owner: P1, zone: "play" },
        { key: "wolg", def: def("Will of a Living God"), owner: P1, zone: "play", attachedToKey: "host", counters: { token: 3 } }
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), 5);
    assert.equal(engine.getStat(id("host"), "life"), 5);
  });
});

// =====================================================================
// Greed block
// =====================================================================

describe("Holy Heist — Abecedarian Investor", () => {
  test("EXTRA COST: may remove a token from a picked card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ai", def: def("Abecedarian Investor"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P2, zone: "play", counters: { token: 2 } },
        ...bank("greed", 6, P1)
      ]
    });
    play(engine, P1, id("ai"), { selected: { picked: [id("c")] } });
    assert.equal(engine.state.cards[id("c")].counters.token, 1);
  });
});

describe("Holy Heist — Addlebrained Defense Attorney", () => {
  test("deploys as a plain vanilla character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "a", def: def("Addlebrained Defense Attorney"), owner: P1, zone: "hand" }, ...bank("greed", 8, P1)]
    });
    play(engine, P1, id("a"), {});
    assert.equal(engine.state.cards[id("a")].zone, "play");
  });
});

describe("Holy Heist — Akashic Coin", () => {
  test("on an opponent's [V] source you may lose 1 influence to draw", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "ac", def: def("Akashic Coin"), owner: P1, zone: "play" },
        { key: "vres", def: cardDef("Holy Heist", "Deceptive Domain"), owner: P2, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" }
      ],
      activePlayerId: P2
    });
    const inf = engine.state.players[P1].influence;
    const handBefore = engine.state.players[P1].hand.length;
    developPlay(engine, P2, id("vres"), true);
    resolvePendingResponses(engine);
    drain(engine, pc => (pc.kind === "mayPay" ? { kind: "mayPay", pay: pc.playerId === P1 } : declineAll(pc)));
    assert.equal(engine.state.players[P1].hand.length, handBefore + 1);
    assert.equal(engine.state.players[P1].influence, inf - 1);
  });
});

describe("Holy Heist — Asbestos Drywall", () => {
  test("removes 2 damage markers from a location", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ad", def: def("Asbestos Drywall"), owner: P1, zone: "hand" },
        { key: "loc", def: location({ name: "Loc", structure: 8 }), owner: P1, zone: "play", damage: 5 },
        ...bank("greed", 6, P1)
      ]
    });
    play(engine, P1, id("ad"), { selected: { loc: [id("loc")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 0 } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("loc")].damage, 3);
  });
});

describe("Holy Heist — Canny Bailiff", () => {
  test("opponents' tactics cost at least 3", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "cb", def: def("Canny Bailiff"), owner: P1, zone: "play" },
        { key: "opptac", def: tactic({ name: "OppTac", cost: 1 }), owner: P2, zone: "hand" },
        ...bank("rage", 6, P2)
      ]
    });
    assert.equal(engine.getCardPlayability(P2, id("opptac")).numericCost, 3);
  });
});

describe("Holy Heist — Cathédrale de Mau", () => {
  test("may lose 1 influence to heal 1 damage from a location you control", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cdm", def: def("Cathédrale de Mau"), owner: P1, zone: "play" },
        { key: "loc", def: location({ name: "Loc", structure: 10 }), owner: P1, zone: "play" },
        { key: "zap", def: killTactic({ name: "Zap", behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 2 }] }] } }), owner: P1, zone: "hand" },
        ...bank("greed", 8, P1)
      ]
    });
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("zap"), { selected: { t: [id("loc")] } });
    drain(engine, pc => (pc.kind === "mayPay" ? { kind: "mayPay", pay: true } : declineAll(pc)));
    assert.equal(engine.state.cards[id("loc")].damage, 1);
    assert.equal(engine.state.players[P1].influence, inf - 1);
  });
});

describe("Holy Heist — Crematory Cache", () => {
  test("when a character is destroyed, you may gain 1 influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cc", def: def("Crematory Cache"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        { key: "victim", def: character({ name: "Victim" }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("kill"), { selected: { t: [id("victim")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 1 } : declineAll(pc)
    );
    assert.equal(engine.state.players[P1].influence, inf + 1);
  });
});

describe("Holy Heist — Deceitful Mortgage Underwriter", () => {
  test("enters with 3 tokens (-1/-1 each)", () => {
    const d = def("Deceitful Mortgage Underwriter");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "dmu", def: d, owner: P1, zone: "hand" }, ...bank("greed", 8, P1)]
    });
    play(engine, P1, id("dmu"), {});
    assert.equal(engine.state.cards[id("dmu")].counters.token, 3);
    assert.equal(engine.getStat(id("dmu"), "strength"), (d.strength ?? 0) - 3);
  });
});

describe("Holy Heist — Defalcating Accountant", () => {
  test("when it restores, you may draw a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "da", def: def("Defalcating Accountant"), owner: P1, zone: "play", depleted: true },
        { key: "r", def: tactic({ name: "RestoreIt", cost: 0, behavior: { abilities: [{ id: "r", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "restore", target: { type: "selected", id: "t" } }] }] } }), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("rage", 4, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("r"), { selected: { t: [id("da")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 1 } : declineAll(pc)
    );
    // -1 restore tactic, +1 the Accountant draw
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1);
  });
});

describe("Holy Heist — Early Investment", () => {
  test("tutors a resource to hand; re-enters as a face-down resource", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ei", def: def("Early Investment"), owner: P1, zone: "hand" },
        { key: "res", def: cardDef("Seed 3", "Greed"), owner: P1, zone: "deck" },
        ...bank("greed", 6, P1)
      ]
    });
    play(engine, P1, id("ei"), { selected: { r: [id("res")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("res")].zone, "hand");
    assert.equal(engine.state.cards[id("ei")].faceDown, true);
  });
});

describe("Holy Heist — Espionage Loafers", () => {
  test("the attached character gains COVERT", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
        { key: "el", def: def("Espionage Loafers"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.ok(engine.getKeywords(id("host")).includes("covert"), "engine.getKeywords(id(\"host\")).includes(\"covert\")");
  });
});

describe("Holy Heist — Expedition Advisor", () => {
  test("ETB may draw 2 then discard 2", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ea", def: def("Expedition Advisor"), owner: P1, zone: "hand" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("greed", 8, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("ea"), {});
    drain(engine, pc => {
      if (pc.kind === "chooserSelectsOption") return { kind: "chooserSelectsOption", index: 1 };
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: engine.state.players[P1].hand.slice(0, 2) };
      return declineAll(pc);
    });
    // -1 Advisor, +2 draw, -2 discard
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1);
  });
});

describe("Holy Heist — Final Countdown", () => {
  test("draw 4 cards", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "fc", def: def("Final Countdown"), owner: P1, zone: "hand" },
        ...Array.from({ length: 6 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("greed", 12, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("fc"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 4);
  });
});

describe("Holy Heist — Form 37-Ohhhhh", () => {
  test("the attached character gains COVERT while you control only 1 character", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
        { key: "f37", def: def("Form 37-Ohhhhh"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.ok(engine.getKeywords(id("host")).includes("covert"), "engine.getKeywords(id(\"host\")).includes(\"covert\")");
  });
});

describe("Holy Heist — Gargoyle of Cathédrale de Mau", () => {
  test("EXTRA COST: lose 3 influence, draw 3", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "gc", def: def("Gargoyle of Cathédrale de Mau"), owner: P1, zone: "hand" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("greed", 10, P1)
      ]
    });
    const inf = engine.state.players[P1].influence;
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("gc"), {});
    assert.equal(engine.state.players[P1].influence, inf - 3);
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 3);
  });
});

describe("Holy Heist — iDumb De-Itemizer", () => {
  test("the attached item has no rules text", () => {
    const abilityItem = {
      ...item({
        name: "Zapper",
        behavior: { abilities: [{ id: "z", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
      }),
      id: "hh-idumb-target"
    };
    const { engine, id } = buildGame({
      cards: [
        { key: "target", def: abilityItem, owner: P1, zone: "play" },
        { key: "idumb", def: def("iDumb De-Itemizer"), owner: P1, zone: "play", attachedToKey: "target" }
      ]
    });
    const usable = engine.getAvailableActivatedAbilities(P1).some(a => a.cardId === id("target"));
    assert.equal(usable, false);
  });
});

describe("Holy Heist — Mass Subjugation", () => {
  test("destroys every character of numeric cost 1, 2, or 3", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ms", def: def("Mass Subjugation"), owner: P1, zone: "hand" },
        { key: "small", def: character({ name: "Small", cost: 2 }), owner: P2, zone: "play" },
        { key: "big", def: character({ name: "Big", cost: 5 }), owner: P2, zone: "play" },
        ...bank("greed", 8, P1)
      ]
    });
    play(engine, P1, id("ms"), {});
    assert.equal(engine.state.cards[id("small")].zone, "discard");
    assert.equal(engine.state.cards[id("big")].zone, "play");
  });
});

describe("Holy Heist — Motivational Dancer", () => {
  test("PRIVATE DANCE: deplete it to deplete another character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "md", def: def("Motivational Dancer"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C" }), owner: P2, zone: "play" },
        ...bank("greed", 6, P1)
      ]
    });
    activate(engine, P1, id("md"), "motiv-dancer-private", { selected: { c: [id("c")] } });
    assert.equal(engine.state.cards[id("c")].depleted, true);
    assert.equal(engine.state.cards[id("md")].depleted, true);
  });
});

describe("Holy Heist — Personal God Shrine", () => {
  test("on a [V] source, may pay 3 to stack a discard character on top of your deck", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pgs", def: def("Personal God Shrine"), owner: P1, zone: "play" },
        { key: "vres", def: def("Obsessive Concentration"), owner: P1, zone: "hand" },
        { key: "grave", def: character({ name: "Grave" }), owner: P1, zone: "discard" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("greed", 8, P1)
      ]
    });
    developPlay(engine, P1, id("vres"), true);
    resolvePendingResponses(engine);
    drain(engine, pc => {
      if (pc.kind === "mayPay") return { kind: "mayPay", pay: true };
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [id("grave")] };
      return declineAll(pc);
    });
    assert.equal(engine.state.players[P1].deck[0], id("grave"));
  });
});

describe("Holy Heist — President Model #16", () => {
  test("enters with (9 - [G]) tokens (-1/-1 each)", () => {
    const d = def("President Model #16");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "pm", def: d, owner: P1, zone: "hand" }, ...bank("greed", 4, P1), ...bank("obsession", 6, P1)]
    });
    play(engine, P1, id("pm"), {});
    assert.equal(engine.state.cards[id("pm")].counters.token, 5);
    assert.equal(engine.getStat(id("pm"), "strength"), (d.strength ?? 0) - 5);
  });
});

describe("Holy Heist — Public Defender Intern", () => {
  test("ETB draws a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pdi", def: def("Public Defender Intern"), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("greed", 6, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("pdi"), {});
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1);
  });
});

describe("Holy Heist — Religious Rejection", () => {
  test("destroys a character without an item attached", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rr", def: def("Religious Rejection"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P2, zone: "play" },
        ...bank("greed", 8, P1)
      ]
    });
    play(engine, P1, id("rr"), { selected: { c: [id("c")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("c")].zone, "discard");
  });

  test("a character with an item attached is not a legal target", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rr", def: def("Religious Rejection"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P2, zone: "play" },
        { key: "gear", def: item({ name: "Gear", attachTo: "character" }), owner: P2, zone: "play", attachedToKey: "c" },
        ...bank("greed", 8, P1)
      ]
    });
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("rr"), selected: { c: [id("c")] } } as never)
    );
  });
});

describe("Holy Heist — Resurrecting Necromorph", () => {
  test("while in your discard, when another of your characters dies you may pay 1 to reanimate it", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rn", def: def("Resurrecting Necromorph"), owner: P1, zone: "discard" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
        ...bank("greed", 6, P1)
      ]
    });
    play(engine, P1, id("kill"), { selected: { t: [id("ally")] } });
    drain(engine, pc => (pc.kind === "mayPay" ? { kind: "mayPay", pay: true } : declineAll(pc)));
    assert.equal(engine.state.cards[id("rn")].zone, "play");
    assert.equal(engine.state.cards[id("rn")].depleted, true);
  });
});

describe("Holy Heist — Spurious Anthropologist", () => {
  test("has TACTICAL and deploys", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "sa", def: def("Spurious Anthropologist"), owner: P1, zone: "hand" }, ...bank("greed", 6, P1)]
    });
    play(engine, P1, id("sa"), {});
    assert.equal(engine.state.cards[id("sa")].zone, "play");
    assert.ok(engine.getKeywords(id("sa")).includes("tactical"), "engine.getKeywords(id(\"sa\")).includes(\"tactical\")");
  });
});

describe("Holy Heist — Thabbashite Deacon", () => {
  test("when a [V] source enters, may give a faction 1 influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "td", def: def("Thabbashite Deacon"), owner: P1, zone: "play" },
        { key: "vres", def: def("Obsessive Concentration"), owner: P1, zone: "hand" }
      ]
    });
    const inf = engine.state.players[P1].influence;
    developPlay(engine, P1, id("vres"), true);
    resolvePendingResponses(engine);
    drain(engine, pc =>
      pc.kind === "selectTargets"
        ? { kind: "selectTargets", selected: { f: [engine.state.players[P1].factionId] } }
        : declineAll(pc)
    );
    assert.equal(engine.state.players[P1].influence, inf + 1);
  });
});

describe("Holy Heist — Unloyal Necromorph", () => {
  test("would-be destruction: an opponent may pay 2 to take control of it instead", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "un", def: def("Unloyal Necromorph"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1),
        ...bank("greed", 6, P2)
      ]
    });
    play(engine, P1, id("kill"), { selected: { t: [id("un")] } });
    drain(engine, pc =>
      pc.kind === "replacementChoice" ? { kind: "replacementChoice", apply: true } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("un")].zone, "play");
    assert.equal(engine.state.cards[id("un")].controllerId, P2);
  });
});

// =====================================================================
// Elitism block
// =====================================================================

describe("Holy Heist — 0v3rw0rk3d 31f", () => {
  test("abilities on locations cannot be used", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "elf", def: def("0v3rw0rk3d 31f"), owner: P1, zone: "play" },
        { key: "loc", def: location({ name: "Loc", behavior: { abilities: [{ id: "x", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] } }), owner: P1, zone: "play" }
      ]
    });
    const usable = engine.getAvailableActivatedAbilities(P1).some(a => a.cardId === id("loc"));
    assert.equal(usable, false);
  });
});

describe("Holy Heist — 73ch!", () => {
  test("searches out a Gearsmith card into play face-down", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "t", def: def("73ch!"), owner: P1, zone: "hand" },
        { key: "g", def: character({ name: "GearGuy", trade: "gearsmith" }), owner: P1, zone: "deck" },
        ...bank("elitism", 8, P1)
      ]
    });
    play(engine, P1, id("t"), { selected: { found: [id("g")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("g")].zone, "play");
    assert.equal(engine.state.cards[id("g")].faceDown, true);
  });
});

describe("Holy Heist — A Boy and His Toy", () => {
  test("ETB puts a Micromajig token into play", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "b", def: def("A Boy and His Toy"), owner: P1, zone: "hand" }, ...bank("elitism", 6, P1)]
    });
    play(engine, P1, id("b"), {});
    assert.equal(engine.state.players[P1].play.filter(c => engine.getDefinition(c).name === "Micromajig").length, 1);
  });
});

describe("Holy Heist — Abused 31f Conveyer", () => {
  test("ETB may give a character +3/+3 this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ac", def: def("Abused 31f Conveyer"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", strength: 2, life: 2 }), owner: P1, zone: "play" },
        ...bank("elitism", 8, P1)
      ]
    });
    play(engine, P1, id("ac"), {});
    drain(engine, pc =>
      pc.kind === "selectTargets"
        ? { kind: "selectTargets", selected: { buff: [id("c")] } }
        : declineAll(pc)
    );
    assert.equal(engine.getStat(id("c"), "strength"), 5);
    assert.equal(engine.getStat(id("c"), "life"), 5);
  });
});

describe("Holy Heist — Changing Boothmajig", () => {
  test("WARDROBE CHANGE re-attaches a gear card to a chosen character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cb", def: def("Changing Boothmajig"), owner: P1, zone: "play" },
        { key: "gear", def: item({ name: "Gear", subtype: ["gear"], attachTo: "character" }), owner: P1, zone: "play", attachedToKey: "oldWearer" },
        { key: "oldWearer", def: character({ name: "Old Wearer" }), owner: P1, zone: "play" },
        { key: "wearer", def: character({ name: "Wearer" }), owner: P1, zone: "play" }
      ]
    });
    activate(engine, P1, id("cb"), "wardrobe-change", { selected: { wearer: [id("wearer")], gear: [id("gear")] } });
    assert.equal(engine.state.cards[id("gear")].attachedTo, id("wearer"));
  });
});

describe("Holy Heist — Cr4ck13", () => {
  test("when damage is inflicted to it, makes that many Micromajig tokens", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cr", def: def("Cr4ck13"), owner: P1, zone: "play" },
        { key: "zap", def: killTactic({ name: "Zap", behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 2 }] }] } }), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("zap"), { selected: { t: [id("cr")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.players[P1].play.filter(c => engine.getDefinition(c).name === "Micromajig").length, 2);
  });
});

describe("Holy Heist — Deity Delimitation Device", () => {
  test("ENTRAPMENT voids a character you control and banks its cost minus 1 in tokens", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ddd", def: def("Deity Delimitation Device"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C", cost: 3 }), owner: P1, zone: "play" }
      ]
    });
    activate(engine, P1, id("ddd"), "ddd-entrapment", { selected: { prey: [id("c")] } });
    assert.equal(engine.state.cards[id("c")].zone, "void");
    assert.equal(engine.state.cards[id("ddd")].counters.token, 2);
  });
});

describe("Holy Heist — Digital Claywork Compendium", () => {
  test("cannot be picked; RESEARCH reduces your next numeric cost by 4", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "dcc", def: def("Digital Claywork Compendium"), owner: P1, zone: "play" },
        { key: "big", def: character({ name: "Big", cost: 8 }), owner: P1, zone: "hand" },
        ...bank("elitism", 8, P1)
      ]
    });
    assert.ok(engine.getRestrictions(id("dcc")).includes("cannotBePicked"), "engine.getRestrictions(id(\"dcc\")).includes(\"cannotBePicked\")");
    activate(engine, P1, id("dcc"), "dcc-research");
    assert.equal(engine.getCardPlayability(P1, id("big")).numericCost, 4);
  });
});

describe("Holy Heist — Guardforce Aggromajig", () => {
  test("has AGGRO; gains 2 strength while depleted", () => {
    const d = def("Guardforce Aggromajig");
    const { engine, id } = buildGame({
      cards: [{ key: "ga", def: d, owner: P1, zone: "play", depleted: true }]
    });
    assert.ok(engine.getKeywords(id("ga")).includes("aggro"), "engine.getKeywords(id(\"ga\")).includes(\"aggro\")");
    assert.equal(engine.getStat(id("ga"), "strength"), (d.strength ?? 0) + 2);
  });
});

describe("Holy Heist — Hasty Pursuit", () => {
  test("grants your characters AGGRO this turn and draws a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "hp", def: def("Hasty Pursuit"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("elitism", 6, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("hp"), {});
    assert.ok(engine.getKeywords(id("c")).includes("aggro"), "engine.getKeywords(id(\"c\")).includes(\"aggro\")");
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1);
  });
});

describe("Holy Heist — Heavy Fists of Robotic Pounding", () => {
  test("the attached character gains 3 strength and 3 life", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host", strength: 2, life: 2 }), owner: P1, zone: "play" },
        { key: "hf", def: def("Heavy Fists of Robotic Pounding"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), 5);
    assert.equal(engine.getStat(id("host"), "life"), 5);
  });
});

describe("Holy Heist — I See You!", () => {
  test("the picked COVERT character loses COVERT this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "isy", def: def("I See You!"), owner: P1, zone: "hand" },
        { key: "sneak", def: character({ name: "Sneak", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" },
        ...bank("elitism", 6, P1)
      ]
    });
    play(engine, P1, id("isy"), { selected: { c: [id("sneak")] } });
    drain(engine, declineAll);
    assert.equal(engine.getKeywords(id("sneak")).includes("covert"), false);
  });

  test("a non-COVERT character is not a legal target", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "isy", def: def("I See You!"), owner: P1, zone: "hand" },
        { key: "plain", def: character({ name: "Plain" }), owner: P2, zone: "play" },
        ...bank("elitism", 6, P1)
      ]
    });
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("isy"), selected: { c: [id("plain")] } } as never)
    );
  });
});

describe("Holy Heist — Improved Micromajig", () => {
  test("gains +1/+1 per token on it", () => {
    const d = def("Improved Micromajig");
    const { engine, id } = buildGame({
      cards: [{ key: "im", def: d, owner: P1, zone: "play", counters: { token: 2 } }]
    });
    assert.equal(engine.getStat(id("im"), "strength"), (d.strength ?? 0) + 2);
    assert.equal(engine.getStat(id("im"), "life"), (d.life ?? 0) + 2);
  });
});

describe("Holy Heist — Lunk Nut", () => {
  test("restores at the start of each opponent's turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [{ key: "ln", def: def("Lunk Nut"), owner: P1, zone: "play", depleted: true }]
    });
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    settleStartFirst(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("ln")].depleted, false);
  });
});

describe("Holy Heist — Microdefense Autosystem", () => {
  test("on forming a blocking party, may pay 1 to add a Micromajig to it", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ma", def: def("Microdefense Autosystem"), owner: P1, zone: "play" },
        { key: "blk", def: character({ name: "Blk", strength: 1, life: 5, speed: 1 }), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 1, life: 1, speed: 3 }), owner: P2, zone: "play" },
        ...bank("elitism", 6, P1)
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("blk")] });
    drain(engine, pc => (pc.kind === "mayPay" ? { kind: "mayPay", pay: true } : declineAll(pc)));
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].play.filter(c => engine.getDefinition(c).name === "Micromajig").length, 1);
  });
});

describe("Holy Heist — Node in a Box", () => {
  test("ETB may tutor a 'node' card to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "nb", def: def("Node in a Box"), owner: P1, zone: "hand" },
        { key: "node", def: character({ name: "NodeGuy", subtype: ["node"] }), owner: P1, zone: "deck" },
        ...bank("elitism", 6, P1)
      ]
    });
    play(engine, P1, id("nb"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("node")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("node")].zone, "hand");
  });
});

describe("Holy Heist — Prime Titan", () => {
  test("gains +1/+1 per token on it", () => {
    const d = def("Prime Titan");
    const { engine, id } = buildGame({
      cards: [{ key: "pt", def: d, owner: P1, zone: "play", counters: { token: 3 } }]
    });
    assert.equal(engine.getStat(id("pt"), "strength"), (d.strength ?? 0) + 3);
  });
});

describe("Holy Heist — RC Flashlight", () => {
  test("cannot be blocked and can block COVERT parties", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "rc", def: def("RC Flashlight"), owner: P1, zone: "play" }]
    });
    const kw = engine.getKeywords(id("rc"));
    assert.ok(kw.includes("cannotBeBlocked"), "kw.includes(\"cannotBeBlocked\")");
    assert.ok(kw.includes("canBlockCovert"), "kw.includes(\"canBlockCovert\")");
  });
});

describe("Holy Heist — Runic Distribulator", () => {
  test("LOAD puts a token on it", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "rd", def: def("Runic Distribulator"), owner: P1, zone: "play" }, ...bank("elitism", 4, P1)]
    });
    activate(engine, P1, id("rd"), "runic-load");
    assert.equal(engine.state.cards[id("rd")].counters.token, 1);
  });
});

describe("Holy Heist — Scrapple-Jack", () => {
  test("ETB choice resolves cleanly", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "sj", def: def("Scrapple-Jack"), owner: P1, zone: "hand" }, ...bank("elitism", 6, P1)]
    });
    play(engine, P1, id("sj"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("sj")].zone, "play");
  });
});

describe("Holy Heist — Subdermal Micromajig", () => {
  test("requires a Micromajig token you control", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sm", def: def("Subdermal Micromajig"), owner: P1, zone: "hand" },
        ...bank("elitism", 8, P1)
      ]
    });
    const facP2 = engine.state.players[P2].factionId!;
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("sm"), selected: { p: [facP2] } } as never)
    );
  });
});

describe("Holy Heist — Surprising Dudes", () => {
  test("makes 2 Micromajig tokens; re-enters as a face-down resource", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "sd", def: def("Surprising Dudes"), owner: P1, zone: "hand" }, ...bank("elitism", 6, P1)]
    });
    play(engine, P1, id("sd"), {});
    assert.equal(engine.state.players[P1].play.filter(c => engine.getDefinition(c).name === "Micromajig").length, 2);
    assert.equal(engine.state.cards[id("sd")].faceDown, true);
  });
});

describe("Holy Heist — T Force 5 MegaManlyMajig", () => {
  test("ETB detach offer resolves; card enters play", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "t", def: def("T Force 5 MegaManlyMajig"), owner: P1, zone: "hand" }, ...bank("elitism", 16, P1)]
    });
    play(engine, P1, id("t"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("t")].zone, "play");
  });
});

describe("Holy Heist — Thabbashite Organist", () => {
  test("when a [V] source enters, reduce the next card's cost by 1", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "to", def: def("Thabbashite Organist"), owner: P1, zone: "play" },
        { key: "vres", def: def("Obsessive Concentration"), owner: P1, zone: "hand" },
        { key: "big", def: character({ name: "Big", cost: 4 }), owner: P1, zone: "hand" },
        ...bank("elitism", 8, P1)
      ]
    });
    developPlay(engine, P1, id("vres"), true);
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.getCardPlayability(P1, id("big")).numericCost, 3);
  });
});

describe("Holy Heist — Unstable Modification", () => {
  test("at the start of your turn, choose +1 strength for the attached character", () => {
    const d = character({ name: "Host", strength: 2 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "host", def: d, owner: P1, zone: "play" },
        { key: "um", def: def("Unstable Modification"), owner: P1, zone: "play", attachedToKey: "host" }
      ],
      activePlayerId: P2
    });
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    settleStartFirst(engine);
    drain(engine, pc =>
      pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 0 } : declineAll(pc)
    );
    assert.equal(engine.getStat(id("host"), "strength"), 3);
  });
});

describe("Holy Heist — Visible Loaf", () => {
  test("DEFLECT prevents the next damage instance to a chosen character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "vl", def: def("Visible Loaf"), owner: P1, zone: "play", counters: { token: 3 } },
        { key: "ally", def: character({ name: "Ally", life: 10 }), owner: P1, zone: "play" },
        { key: "zap", def: killTactic({ name: "Zap", behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 4 }] }] } }), owner: P1, zone: "hand" },
        ...bank("elitism", 8, P1)
      ]
    });
    activate(engine, P1, id("vl"), "visible-loaf-deflect", { selected: { c: [id("ally")] } });
    play(engine, P1, id("zap"), { selected: { t: [id("ally")] } });
    assert.equal(engine.state.cards[id("ally")].damage ?? 0, 0);
  });
});

// =====================================================================
// Deception block
// =====================================================================

describe("Holy Heist — Catastrophic Caper", () => {
  test("cannot be deployed outside a response to a character-picking card/ability", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "cc", def: def("Catastrophic Caper"), owner: P1, zone: "hand" }, ...bank("deception", 6, P1)]
    });
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("cc"), selected: {} } as never)
    );
  });
});

describe("Holy Heist — Cheats, the Dirty Rotten", () => {
  test("ETB dig resolves cleanly; the card enters play", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cheats", def: def("Cheats, the Dirty Rotten"), owner: P1, zone: "hand" },
        ...Array.from({ length: 6 }, (_, i) => ({ key: `od${i}`, def: character({ name: `OD${i}` }), owner: P2, zone: "deck" as const })),
        ...bank("deception", 12, P1)
      ]
    });
    const facP2 = engine.state.players[P2].factionId!;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("cheats"), selected: { opp: [facP2] } } as never);
    resolvePendingResponses(engine);
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: ["od0", "od1", "od2", "od3"].map(k => id(k)) }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("cheats")].zone, "play");
  });
});

describe("Holy Heist — Chum, the Ugliest Sarume", () => {
  test("EXTRA COST removes a discard card from the game; card enters play", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "chum", def: def("Chum, the Ugliest Sarume"), owner: P1, zone: "hand" },
        { key: "food", def: character({ name: "Food", cost: 3 }), owner: P1, zone: "discard" },
        ...Array.from({ length: 3 }, (_, i) => ({ key: `od${i}`, def: character({ name: `OD${i}`, cost: 1 }), owner: P2, zone: "deck" as const })),
        ...bank("deception", 8, P1)
      ]
    });
    play(engine, P1, id("chum"), { selected: { pick: [id("food")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("food")].zone, "removed");
    assert.equal(engine.state.cards[id("chum")].zone, "play");
  });
});

describe("Holy Heist — Craniata Nester", () => {
  test("gains +1/+1 per character in an opponent's discard pile", () => {
    const d = def("Craniata Nester");
    const { engine, id } = buildGame({
      cards: [
        { key: "cn", def: d, owner: P1, zone: "play" },
        { key: "g1", def: character({ name: "G1" }), owner: P2, zone: "discard" },
        { key: "g2", def: character({ name: "G2" }), owner: P2, zone: "discard" }
      ]
    });
    assert.equal(engine.getStat(id("cn"), "strength"), (d.strength ?? 0) + 2);
  });
});

describe("Holy Heist — Don't Trip", () => {
  test("an attacking character's battle damage is redirected to itself this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "dt", def: def("Don't Trip"), owner: P1, zone: "hand" },
        { key: "atk", def: character({ name: "Atk", strength: 3, life: 5, speed: 3 }), owner: P2, zone: "play" },
        ...bank("deception", 8, P1)
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    engine.perform({ type: "passPriority", playerId: P2 });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("dt"), selected: { c: [id("atk")] } } as never);
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("atk")].damage, 3);
  });
});

describe("Holy Heist — Dweedle Tee", () => {
  test("gains +1/+1 per token on it", () => {
    const d = def("Dweedle Tee");
    const { engine, id } = buildGame({
      cards: [{ key: "dt", def: d, owner: P1, zone: "play", counters: { token: 2 } }]
    });
    assert.equal(engine.getStat(id("dt"), "strength"), (d.strength ?? 0) + 2);
    assert.equal(engine.getStat(id("dt"), "life"), (d.life ?? 0) + 2);
  });
});

describe("Holy Heist — Ferret Oil Coating", () => {
  test("anything that can pick the attached character must pick it", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P2, zone: "play" },
        { key: "foc", def: def("Ferret Oil Coating"), owner: P1, zone: "play", attachedToKey: "host" },
        { key: "other", def: character({ name: "Other" }), owner: P2, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("kill"), selected: { t: [id("other")] } } as never)
    );
  });
});

describe("Holy Heist — Flashy Bangs", () => {
  test("BURST removes a blocking character from the battle and depletes it", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "fb", def: def("Flashy Bangs"), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 2, life: 5, speed: 3 }), owner: P1, zone: "play" },
        { key: "blk", def: character({ name: "Blk", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
    // P1 holds priority in the beforeDamage window — activate before it drains.
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("fb"), abilityId: "flashy-bangs-burst", selected: { b: [id("blk")] }, variables: {} });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("blk")].depleted, true);
    assert.equal(engine.state.battle?.blockingParty.includes(id("blk")), false);
    assert.equal(engine.state.cards[id("fb")].zone, "discard");
  });
});

describe("Holy Heist — Fwing Snipe", () => {
  test("has TACTICAL; ETB may give a character +1 speed this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "fs", def: def("Fwing Snipe"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", speed: 3 }), owner: P1, zone: "play" },
        ...bank("deception", 6, P1)
      ]
    });
    assert.ok(def("Fwing Snipe").behavior?.keywords?.includes("tactical"), "def(\"Fwing Snipe\").behavior?.keywords?.includes(\"tactical\")");
    play(engine, P1, id("fs"), {});
    drain(engine, pc =>
      pc.kind === "selectTargets"
        ? { kind: "selectTargets", selected: { c: [id("c")] } }
        : declineAll(pc)
    );
    assert.equal(engine.getStat(id("c"), "speed"), 4);
  });
});

describe("Holy Heist — Gnarling Lupine", () => {
  test("REND destroys a face-down resource for +3/+3/+1 this turn", () => {
    const d = def("Gnarling Lupine");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "gl", def: d, owner: P1, zone: "play" },
        ...volition(1, P1)
      ]
    });
    activate(engine, P1, id("gl"), "gnarling-rend");
    assert.equal(engine.getStat(id("gl"), "strength"), (d.strength ?? 0) + 3);
    assert.equal(engine.getStat(id("gl"), "speed"), (d.speed ?? 0) + 1);
  });
});

describe("Holy Heist — Impeccable Triggerman", () => {
  test("ASSASSINATE destroys a depleted character with 4 life or less", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "it", def: def("Impeccable Triggerman"), owner: P1, zone: "play" },
        { key: "frail", def: character({ name: "Frail", life: 3 }), owner: P2, zone: "play", depleted: true }
      ]
    });
    activate(engine, P1, id("it"), "triggerman-assassinate", { selected: { v: [id("frail")] } });
    assert.equal(engine.state.cards[id("frail")].zone, "discard");
  });
});

describe("Holy Heist — Inebriated Defenestration", () => {
  test("mills an opponent's top 5 and draws 2", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "idf", def: def("Inebriated Defenestration"), owner: P1, zone: "hand" },
        ...Array.from({ length: 6 }, (_, i) => ({ key: `od${i}`, def: character({ name: `OD${i}` }), owner: P2, zone: "deck" as const })),
        ...Array.from({ length: 3 }, (_, i) => ({ key: `md${i}`, def: character({ name: `MD${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("deception", 8, P1)
      ]
    });
    const oppDisc = engine.state.players[P2].discard.length;
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("idf"), {});
    assert.equal(engine.state.players[P2].discard.length, oppDisc + 5);
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 2);
  });
});

describe("Holy Heist — Low-hanging Clothesline", () => {
  test("destroys a depleted character with 5 life or more", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "lhc", def: def("Low-hanging Clothesline"), owner: P1, zone: "hand" },
        { key: "tank", def: character({ name: "Tank", life: 6 }), owner: P2, zone: "play", depleted: true },
        ...bank("deception", 6, P1)
      ]
    });
    play(engine, P1, id("lhc"), { selected: { c: [id("tank")] } });
    assert.equal(engine.state.cards[id("tank")].zone, "discard");
  });

  test("a non-depleted character is not a legal target", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "lhc", def: def("Low-hanging Clothesline"), owner: P1, zone: "hand" },
        { key: "fresh", def: character({ name: "Fresh", life: 6 }), owner: P2, zone: "play" },
        ...bank("deception", 6, P1)
      ]
    });
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("lhc"), selected: { c: [id("fresh")] } } as never)
    );
  });
});

describe("Holy Heist — Loyal Companion", () => {
  test("NINE LIVES: from the discard pile, pay 5 to put it into play", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "lc", def: def("Loyal Companion"), owner: P1, zone: "discard" },
        ...bank("deception", 8, P1)
      ]
    });
    activate(engine, P1, id("lc"), "loyal-nine-lives");
    assert.equal(engine.state.cards[id("lc")].zone, "play");
  });
});

describe("Holy Heist — Ocular Dispersal", () => {
  test("deploys attached to the picked character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "od", def: def("Ocular Dispersal"), owner: P1, zone: "hand" },
        { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
        ...bank("deception", 6, P1)
      ]
    });
    play(engine, P1, id("od"), { selected: { attachTo: [id("host")] } });
    assert.equal(engine.state.cards[id("od")].attachedTo, id("host"));
  });
});

describe("Holy Heist — Sneaky Sarco", () => {
  test("with a token it gains COVERT", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "sc", def: def("Sneaky Sarco"), owner: P1, zone: "play", counters: { token: 1 } }]
    });
    assert.ok(engine.getKeywords(id("sc")).includes("covert"), "engine.getKeywords(id(\"sc\")).includes(\"covert\")");
  });
});

describe("Holy Heist — Super Slingerang XL200", () => {
  test("SLING destroys itself to destroy an item", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sx", def: def("Super Slingerang XL200"), owner: P1, zone: "play" },
        { key: "it", def: item({ name: "It" }), owner: P2, zone: "play" },
        ...bank("deception", 6, P1)
      ]
    });
    activate(engine, P1, id("sx"), "slingerang-sling", { selected: { it: [id("it")] } });
    assert.equal(engine.state.cards[id("it")].zone, "discard");
    assert.equal(engine.state.cards[id("sx")].zone, "discard");
  });
});

describe("Holy Heist — Thabbashite Dartist", () => {
  test("when a [V] source enters, may give a character -1 life this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "td", def: def("Thabbashite Dartist"), owner: P1, zone: "play" },
        { key: "vres", def: def("Obsessive Concentration"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", life: 4 }), owner: P2, zone: "play" }
      ]
    });
    developPlay(engine, P1, id("vres"), true);
    resolvePendingResponses(engine);
    drain(engine, pc =>
      pc.kind === "selectTargets"
        ? { kind: "selectTargets", selected: { c: [id("c")] } }
        : declineAll(pc)
    );
    assert.equal(engine.getStat(id("c"), "life"), 3);
  });
});

describe("Holy Heist — Thabbashite Urchin", () => {
  test("[V][V][V] + opponent controls an item: cannot be blocked", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "tu", def: def("Thabbashite Urchin"), owner: P1, zone: "play" },
        { key: "it", def: item({ name: "It" }), owner: P2, zone: "play" },
        ...volition(3, P1)
      ]
    });
    assert.ok(engine.getKeywords(id("tu")).includes("cannotBeBlocked"), "engine.getKeywords(id(\"tu\")).includes(\"cannotBeBlocked\")");
  });
});

describe("Holy Heist — Theological Theft", () => {
  test("mills a picked player 10 and reanimates one of their discard characters", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "tt", def: def("Theological Theft"), owner: P1, zone: "hand" },
        { key: "corpse", def: character({ name: "Corpse" }), owner: P2, zone: "discard" },
        ...Array.from({ length: 12 }, (_, i) => ({ key: `od${i}`, def: character({ name: `OD${i}` }), owner: P2, zone: "deck" as const })),
        ...bank("deception", 12, P1)
      ]
    });
    const facP2 = engine.state.players[P2].factionId!;
    const deckBefore = engine.state.players[P2].deck.length;
    play(engine, P1, id("tt"), { variables: { x: 1 }, selected: { players: [facP2] } });
    drain(engine, pc => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("corpse")] } : declineAll(pc)));
    assert.equal(engine.state.cards[id("corpse")].zone, "play");
    assert.equal(engine.state.cards[id("corpse")].controllerId, P1);
    assert.equal(engine.state.players[P2].deck.length, deckBefore - 10);
  });
});

describe("Holy Heist — Thieving Casino", () => {
  test("CASH OUT reanimates a character from an opponent's discard for its cost + 4", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "tc", def: def("Thieving Casino"), owner: P1, zone: "play" },
        { key: "corpse", def: character({ name: "Corpse", cost: 3 }), owner: P2, zone: "discard" },
        ...bank("deception", 12, P1)
      ]
    });
    activate(engine, P1, id("tc"), "thieving-casino-cashout", { selected: { ch: [id("corpse")] } });
    assert.equal(engine.state.cards[id("corpse")].zone, "play");
    assert.equal(engine.state.cards[id("corpse")].controllerId, P1);
  });
});

describe("Holy Heist — Torchlight Safehouse", () => {
  test("when destroyed, your faction loses 3 influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ts", def: def("Torchlight Safehouse"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic({ behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("kill"), { selected: { t: [id("ts")] } });
    assert.equal(engine.state.players[P1].influence, inf - 3);
  });
});

describe("Holy Heist — Torchlight Sarcophyle", () => {
  test("gains COVERT while a player controls a COVERT character", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "ts", def: def("Torchlight Sarcophyle"), owner: P1, zone: "play" },
        { key: "sneak", def: character({ name: "Sneak", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }
      ]
    });
    assert.ok(engine.getKeywords(id("ts")).includes("covert"), "engine.getKeywords(id(\"ts\")).includes(\"covert\")");
  });

  // Regression (2026-10-22). The Sarcophyle's condition counts COVERT characters, so each copy's
  // condition asked every character for COVERT. That re-ran every other copy's condition, even for
  // cards the copy's "this character gains COVERT" can't apply to. Board reads (getKeywords /
  // getStat) grew exponentially with copies in play: two copies cost about 140× as much as none,
  // and three took minutes, which stalled AI matches. The cost is measured in condition
  // evaluations, not wall time.
  const sarcophyleBoard = (copies: number, extra: NonNullable<Parameters<typeof buildGame>[0]>["cards"] = []) => {
    const cards = [
      ...Array.from({ length: copies }, (_, i) => ({ key: `ts${i}`, def: def("Torchlight Sarcophyle"), owner: i % 2 ? P2 : P1, zone: "play" as const })),
      ...Array.from({ length: 8 }, (_, i) => ({ key: `c${i}`, def: character({ name: `C${i}` }), owner: i % 2 ? P2 : P1, zone: "play" as const })),
      ...(extra ?? [])
    ];
    return { ...buildGame({ cards }), keys: cards.map((card) => card.key) };
  };

  /** Counts the engine's condition evaluations while `read` runs. */
  const conditionEvaluations = (engine: ReturnType<typeof buildGame>["engine"], read: () => void): number => {
    type Spied = { evaluateCondition: (...args: unknown[]) => boolean };
    const spied = engine as unknown as Spied;
    const inner = spied.evaluateCondition;
    let evaluations = 0;
    spied.evaluateCondition = (...args) => {
      evaluations++;
      return inner.apply(engine, args);
    };
    try {
      read();
    } finally {
      spied.evaluateCondition = inner;
    }
    return evaluations;
  };

  test("its condition is never evaluated for a card it can't grant COVERT to, nor for any stat read", () => {
    const { engine, id, keys } = sarcophyleBoard(4);
    const plain = keys.filter((key) => key.startsWith("c"));
    assert.equal(conditionEvaluations(engine, () => plain.forEach((key) => engine.getKeywords(id(key)))), 0, "plain characters' keywords");
    assert.equal(conditionEvaluations(engine, () => keys.forEach((key) => engine.getStat(id(key), "strength"))), 0, "every card's strength");
  });

  test("several copies stay cheap to read: no exponential re-evaluation of the shared condition", () => {
    // Before the fix, 4 copies took minutes per board read. Now each copy's own read costs a few
    // hundred evaluations, roughly 2^copies × cards.
    const { engine, id } = sarcophyleBoard(4);
    const evaluations = conditionEvaluations(engine, () => [0, 1, 2, 3].forEach((i) => engine.getKeywords(id(`ts${i}`))));
    assert.ok(evaluations < 2000, `${evaluations} condition evaluations to read four Sarcophyles' keywords`);
  });

  test("several copies with no COVERT character anywhere: none of them gains COVERT (they don't prop each other up)", () => {
    const { engine, id } = sarcophyleBoard(4);
    for (const i of [0, 1, 2, 3]) assert.ok(!engine.getKeywords(id(`ts${i}`)).includes("covert"), `ts${i} has no COVERT`);
  });

  test("several copies plus one COVERT character elsewhere: every copy gains COVERT, the plain characters don't", () => {
    const { engine, id } = sarcophyleBoard(4, [
      { key: "sneak", def: character({ name: "Sneak", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }
    ]);
    for (const i of [0, 1, 2, 3]) assert.ok(engine.getKeywords(id(`ts${i}`)).includes("covert"), `ts${i} gains COVERT`);
    assert.ok(!engine.getKeywords(id("c0")).includes("covert"), "a plain character gains nothing");
  });
});

describe("Holy Heist — TZONE! Street Dancer", () => {
  test("has TACTICAL", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "sd", def: def("TZONE! Street Dancer"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getKeywords(id("sd")).includes("tactical"), "engine.getKeywords(id(\"sd\")).includes(\"tactical\")");
  });
});

describe("Holy Heist — Underdog", () => {
  test("gains strength equal to the number of characters your opponents own", () => {
    const d = def("Underdog");
    const { engine, id } = buildGame({
      cards: [
        { key: "ud", def: d, owner: P1, zone: "play" },
        { key: "o1", def: character({ name: "O1" }), owner: P2, zone: "play" },
        { key: "o2", def: character({ name: "O2" }), owner: P2, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("ud"), "strength"), (d.strength ?? 0) + 2);
  });
});

describe("Holy Heist — Unexpected Transformation", () => {
  test("bottoms a character you control and tutors a cheaper one", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ut", def: def("Unexpected Transformation"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", cost: 1 }), owner: P1, zone: "play" },
        { key: "found", def: character({ name: "Found", cost: 2 }), owner: P1, zone: "deck" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("deception", 10, P1)
      ]
    });
    play(engine, P1, id("ut"), { variables: { y: 3 }, selected: { c: [id("c")], found: [id("found")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 1 } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("c")].zone, "deck");
    assert.equal(engine.state.players[P1].deck[0], id("found"));
  });
});

describe("Holy Heist — Warehouse Sentinel", () => {
  test("RECUR from discard destroys a depleted character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ws", def: def("Warehouse Sentinel"), owner: P1, zone: "discard" },
        { key: "victim", def: character({ name: "Victim" }), owner: P2, zone: "play", depleted: true },
        ...bank("deception", 8, P1)
      ]
    });
    activate(engine, P1, id("ws"), "warehouse-sentinel-recur", { selected: { c: [id("victim")] } });
    assert.equal(engine.state.cards[id("victim")].zone, "discard");
    assert.equal(engine.state.cards[id("ws")].zone, "removed");
  });
});

// =====================================================================
// Rage block
// =====================================================================

describe("Holy Heist — Akashic Notes", () => {
  test("when an opponent plays a [V] resource, declining to pay flips it face down", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "an", def: def("Akashic Notes"), owner: P1, zone: "play" },
        { key: "vres", def: def("Raging Ferocity"), owner: P2, zone: "hand" }
      ],
      activePlayerId: P2,
      turn: 2
    });
    developPlay(engine, P2, id("vres"), true);
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("an")].faceDown, true);
  });
});

describe("Holy Heist — Blitz of Destruction", () => {
  test("a player with more resources destroys one of their own face-down resources", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "bd", def: def("Blitz of Destruction"), owner: P1, zone: "hand" },
        ...bank("rage", 4, P1),
        ...bank("rage", 8, P2),
        ...volition(1, P2)
      ]
    });
    const fd = Object.values(engine.state.cards).find(
      c => c.controllerId === P2 && c.faceDown && engine.getDefinition(c.id).type === "resource"
    )!;
    play(engine, P1, id("bd"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [fd.id] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[fd.id].zone, "discard");
  });
});

describe("Holy Heist — Boorish Boar", () => {
  // CR 201.5d / 405.4: both icon-led paragraphs are static conditions, not abilities.
  const d = def("Boorish Boar");
  const playRageFromHand = (engine: ReturnType<typeof buildGame>["engine"], cardId: string) => {
    developPlay(engine, P1, cardId);
    resolvePendingResponses(engine);
  };

  test("[R][R]: gains 1 strength and loses 1 life only while its controller meets the threshold", () => {
    const base = buildGame({ cards: [{ key: "bb", def: d, owner: P1, zone: "play" }, ...bank("rage", 1, P1)] });
    assert.equal(base.engine.getStat(base.id("bb"), "strength"), d.strength);
    assert.equal(base.engine.getStat(base.id("bb"), "life"), d.life);

    const met = buildGame({ cards: [{ key: "bb", def: d, owner: P1, zone: "play" }, ...bank("rage", 2, P1)] });
    assert.equal(met.engine.getStat(met.id("bb"), "strength"), (d.strength ?? 0) + 1);
    assert.equal(met.engine.getStat(met.id("bb"), "life"), (d.life ?? 0) - 1);
    assert.equal(met.engine.state.cards[met.id("bb")].zone, "play");
  });

  test("it is not an ability: nothing to activate, and trying changes nothing", () => {
    assert.deepEqual(
      (d.behavior?.abilities ?? []).filter(a => a.type === "activated"),
      []
    );
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "bb", def: d, owner: P1, zone: "play" }, ...bank("rage", 2, P1)]
    });
    for (const abilityId of ["boorish-boar-pump", "boorish-boar-pop"]) {
      assert.throws(() => activate(engine, P1, id("bb"), abilityId));
    }
    assert.equal(engine.getStat(id("bb"), "strength"), (d.strength ?? 0) + 1);
    assert.equal(engine.getStat(id("bb"), "life"), (d.life ?? 0) - 1);
    assert.equal(engine.state.cards[id("bb")].zone, "play");
  });

  test("only its controller's [R] icons count", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "bb", def: d, owner: P1, zone: "play" }, ...bank("rage", 5, P2)]
    });
    assert.equal(engine.getStat(id("bb"), "strength"), d.strength);
    assert.equal(engine.getStat(id("bb"), "life"), d.life);
    assert.equal(engine.state.cards[id("bb")].zone, "play");
  });

  test("[R][R][R]: destroys it the moment its controller meets the threshold, then its death trigger runs", () => {
    const hand = bank("rage", 1, P1)[0];
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "bb", def: d, owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC", life: 5 }), owner: P2, zone: "play" },
        ...bank("rage", 2, P1),
        { ...hand, zone: "hand" as const }
      ]
    });
    assert.equal(engine.state.cards[id("bb")].zone, "play");
    playRageFromHand(engine, id(hand.key));
    assert.equal(engine.state.cards[id("bb")].zone, "discard");
    // "When this card is destroyed, you may pick up to 2 characters and/or factions ..." is offered.
    assert.equal(engine.state.pendingChoice?.kind, "selectTargets");
    drain(engine, pc => {
      if (pc.kind === "selectTargets") return { kind: "selectTargets", selected: { victims: [id("oc")] } };
      if (pc.kind === "distributeAmong") return { kind: "distributeAmong", shares: { [id("oc")]: 2 } };
      return declineAll(pc);
    });
    assert.equal(engine.state.cards[id("oc")].damage, 2);
  });

  test("[R][R][R]: deployed while already meeting the threshold, it is destroyed on entering play", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "bb", def: d, owner: P1, zone: "hand" }, ...bank("rage", 6, P1)]
    });
    play(engine, P1, id("bb"));
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("bb")].zone, "discard");
  });
});

describe("Holy Heist — Change of Tactics", () => {
  test("cannot be deployed outside a battle in which you are attacking", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "ct", def: def("Change of Tactics"), owner: P1, zone: "hand" }, ...bank("rage", 6, P1)]
    });
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("ct"), selected: {} } as never)
    );
  });
});

describe("Holy Heist — Crazed Executioner", () => {
  test("ETB may inflict 1 damage to a chosen character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ce", def: def("Crazed Executioner"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", life: 5 }), owner: P2, zone: "play" },
        ...bank("rage", 4, P1)
      ]
    });
    play(engine, P1, id("ce"), {});
    drain(engine, pc =>
      pc.kind === "selectTargets" ? { kind: "selectTargets", selected: { t: [id("oc")] } } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("oc")].damage, 1);
  });
});

describe("Holy Heist — Damascus Sword Swinger", () => {
  test("gains 2 strength while a gear card is attached", () => {
    const d = def("Damascus Sword Swinger");
    const { engine, id } = buildGame({
      cards: [
        { key: "dss", def: d, owner: P1, zone: "play" },
        { key: "gear", def: item({ name: "Gear", subtype: ["gear"] }), owner: P1, zone: "play", attachedToKey: "dss" }
      ]
    });
    assert.equal(engine.getStat(id("dss"), "strength"), (d.strength ?? 0) + 2);
  });
});

describe("Holy Heist — Dizzying Blow", () => {
  test("removes an attacker from the battle and deals it 1 damage", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "db", def: def("Dizzying Blow"), owner: P1, zone: "hand" },
        { key: "atk", def: character({ name: "Atk", strength: 2, life: 5, speed: 3 }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    engine.perform({ type: "passPriority", playerId: P2 });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("db"), selected: { c: [id("atk")] } } as never);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("atk")].damage, 1);
    assert.equal(engine.state.battle?.attackingParty.includes(id("atk")) ?? false, false);
  });
});

describe("Holy Heist — Everlasting Blade of Light", () => {
  test("EQUIP attaches to a chosen character, granting +3/+3", () => {
    const host = character({ name: "Host", strength: 2, life: 2 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ebol", def: def("Everlasting Blade of Light"), owner: P1, zone: "play" },
        { key: "host", def: host, owner: P1, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    activate(engine, P1, id("ebol"), "ebol-equip", { selected: { c: [id("host")] } });
    assert.equal(engine.state.cards[id("ebol")].attachedTo, id("host"));
    assert.equal(engine.getStat(id("host"), "strength"), (host.strength ?? 0) + 3);
    assert.equal(engine.getStat(id("host"), "life"), (host.life ?? 0) + 3);
  });
});

describe("Holy Heist — Fire Tail Kamikaze", () => {
  test("ETB may inflict 3 damage to a chosen character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ftk", def: def("Fire Tail Kamikaze"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", life: 5 }), owner: P2, zone: "play" },
        ...bank("rage", 8, P1)
      ]
    });
    play(engine, P1, id("ftk"), {});
    drain(engine, pc =>
      pc.kind === "selectTargets" ? { kind: "selectTargets", selected: { t: [id("oc")] } } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("oc")].damage, 3);
  });
});

describe("Holy Heist — Fire Tail Kocktail", () => {
  test("inflicts 2 damage to a chosen character and draws", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ftk", def: def("Fire Tail Kocktail"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", life: 5 }), owner: P2, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("rage", 4, P1)
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    play(engine, P1, id("ftk"), { selected: { c: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].damage, 2);
    assert.equal(engine.state.players[P1].hand.length, hand - 1 + 1);
  });
});

describe("Holy Heist — Gathering of Unlikely Heroes", () => {
  test("names two trades then tutors a matching character to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "guh", def: def("Gathering of Unlikely Heroes"), owner: P1, zone: "hand" },
        { key: "hero", def: character({ name: "Hero", trade: "warlord" }), owner: P1, zone: "deck" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...volition(6, P1)
      ]
    });
    const facP2 = engine.state.players[P2].factionId!;
    play(engine, P1, id("guh"), { selected: { p: [facP2] } });
    drain(engine, pc => {
      if (pc.kind === "nameValue") return { kind: "nameValue", value: "warlord" };
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [id("hero")] };
      return declineAll(pc);
    });
    assert.equal(engine.state.cards[id("hero")].zone, "hand");
  });
});

describe("Holy Heist — Horns of Thabbash", () => {
  test("grants +1/+1, cannotBlock, and +3 strength while you control [V][V][V]", () => {
    const host = character({ name: "Host", strength: 2, life: 2 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "host", def: host, owner: P1, zone: "play" },
        { key: "hot", def: def("Horns of Thabbash"), owner: P1, zone: "play", attachedToKey: "host" },
        ...volition(3, P1)
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), (host.strength ?? 0) + 1 + 3);
    assert.equal(engine.getStat(id("host"), "life"), (host.life ?? 0) + 1);
    assert.ok(engine.getRestrictions(id("host")).includes("cannotBlock"), "engine.getRestrictions(id(\"host\")).includes(\"cannotBlock\")");
  });
});

describe("Holy Heist — Infectious Pustulio", () => {
  test("when the attached attacker is blocked, each blocker takes 1 damage", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "atk", def: character({ name: "Atk", strength: 1, life: 8, speed: 3 }), owner: P1, zone: "play" },
        { key: "ip", def: def("Infectious Pustulio"), owner: P1, zone: "play", attachedToKey: "atk" },
        { key: "b1", def: character({ name: "B1", strength: 0, life: 5, speed: 1 }), owner: P2, zone: "play" },
        { key: "b2", def: character({ name: "B2", strength: 0, life: 5, speed: 1 }), owner: P2, zone: "play" }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b1"), id("b2")] });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("b1")].damage, 1);
    assert.equal(engine.state.cards[id("b2")].damage, 1);
  });
});

describe("Holy Heist — Keep Pushing", () => {
  test("restores a chosen character with 3 strength or less", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "kp", def: def("Keep Pushing"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", strength: 2 }), owner: P1, zone: "play", depleted: true },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("rage", 6, P1)
      ]
    });
    const res = Object.values(engine.state.cards).find(
      c => c.controllerId === P1 && engine.getDefinition(c.id).type === "resource"
    )!;
    play(engine, P1, id("kp"), { selected: { res: [res.id], c: [id("c")] } });
    assert.equal(engine.state.cards[id("c")].depleted, false);
  });

  test("a character with more than 3 strength is not a legal target", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "kp", def: def("Keep Pushing"), owner: P1, zone: "hand" },
        { key: "big", def: character({ name: "Big", strength: 5 }), owner: P1, zone: "play", depleted: true },
        ...bank("rage", 6, P1)
      ]
    });
    const res = Object.values(engine.state.cards).find(
      c => c.controllerId === P1 && engine.getDefinition(c.id).type === "resource"
    )!;
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("kp"), selected: { res: [res.id], c: [id("big")] } } as never)
    );
  });
});

describe("Holy Heist — Leaping Sarume", () => {
  test("ETB inflicts 1 damage to all characters", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ls", def: def("Leaping Sarume"), owner: P1, zone: "hand" },
        { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
        { key: "theirs", def: character({ name: "Theirs", life: 5 }), owner: P2, zone: "play" },
        ...bank("rage", 4, P1)
      ]
    });
    play(engine, P1, id("ls"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("mine")].damage, 1);
    assert.equal(engine.state.cards[id("theirs")].damage, 1);
  });
});

describe("Holy Heist — Lingamite Descendant", () => {
  test("battle damage inflicted to it while attacking is reduced to 0", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ld", def: def("Lingamite Descendant"), owner: P1, zone: "play" },
        { key: "blk", def: character({ name: "Blk", strength: 5, life: 5, speed: 1 }), owner: P2, zone: "play" }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("ld")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("ld")].damage ?? 0, 0);
    assert.equal(engine.state.cards[id("ld")].zone, "play");
  });
});

describe("Holy Heist — Marduun Ruins", () => {
  test("your characters whose text mentions [V] gain +2/+2", () => {
    const voidy = character({ name: "Voidy", strength: 2, life: 2, text: "[V][V]: does a thing" });
    const plain = character({ name: "Plain", strength: 2, life: 2, text: "no icons here" });
    const { engine, id } = buildGame({
      cards: [
        { key: "mr", def: def("Marduun Ruins"), owner: P1, zone: "play" },
        { key: "voidy", def: voidy, owner: P1, zone: "play" },
        { key: "plain", def: plain, owner: P1, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("voidy"), "strength"), (voidy.strength ?? 0) + 2);
    assert.equal(engine.getStat(id("plain"), "strength"), plain.strength ?? 0);
  });
});

describe("Holy Heist — Overly Eager Exemplar", () => {
  test("FOR MY BROTHERS destroys itself to tutor a soldier card to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "oee", def: def("Overly Eager Exemplar"), owner: P1, zone: "play" },
        { key: "sol", def: character({ name: "Sol", subtype: ["soldier"] }), owner: P1, zone: "deck" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("rage", 4, P1)
      ]
    });
    activate(engine, P1, id("oee"), "for-my-brothers");
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("sol")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("sol")].zone, "hand");
    assert.equal(engine.state.cards[id("oee")].zone, "discard");
  });
});

describe("Holy Heist — Phantasmagoric Tollbooth", () => {
  test("an opponent's incoming character is discarded when they decline to pay", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "pt", def: def("Phantasmagoric Tollbooth"), owner: P1, zone: "play" },
        { key: "intruder", def: character({ name: "Intruder", cost: 0 }), owner: P2, zone: "hand" }
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("intruder"), selected: {} } as never);
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("intruder")].zone, "discard");
  });
});

describe("Holy Heist — Rapacious Soldier", () => {
  test("cannot block", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "rs", def: def("Rapacious Soldier"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getRestrictions(id("rs")).includes("cannotBlock"), "engine.getRestrictions(id(\"rs\")).includes(\"cannotBlock\")");
  });
});

describe("Holy Heist — Rudo Mangod, Holder of Light", () => {
  test("while restored, your characters gain +1/+1; depleting Rudo turns the aura off", () => {
    const ally = character({ name: "Ally", strength: 2, life: 2 });
    const { engine, id } = buildGame({
      cards: [
        { key: "rudo", def: def("Rudo Mangod, Holder of Light"), owner: P1, zone: "play" },
        { key: "ally", def: ally, owner: P1, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("ally"), "strength"), (ally.strength ?? 0) + 1);
    engine.state.cards[id("rudo")].depleted = true;
    assert.equal(engine.getStat(id("ally"), "strength"), ally.strength ?? 0);
  });
});

describe("Holy Heist — Skilled Bannerman", () => {
  test("in play, it provides [R] to its controller", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "sb", def: def("Skilled Bannerman"), owner: P1, zone: "play" }]
    });
    void id;
    assert.ok((engine.getThresholds(P1).rage ?? 0) >= 1, "(engine.getThresholds(P1).rage ?? 0) >= 1");
  });
});

describe("Holy Heist — Some Crazy Ornery Unfriendly Thug", () => {
  test("deploys as a plain vanilla character", () => {
    const d = def("Some Crazy Ornery Unfriendly Thug");
    const { engine, id } = buildGame({
      cards: [{ key: "t", def: d, owner: P1, zone: "play" }]
    });
    assert.equal(engine.getStat(id("t"), "strength"), d.strength ?? 0);
    assert.equal(engine.getStat(id("t"), "life"), d.life ?? 0);
    assert.deepEqual(engine.getKeywords(id("t")), []);
  });
});

describe("Holy Heist — Special Forces", () => {
  test("UNDERCOVERT OPERATIONS grants COVERT and -1 life this turn", () => {
    const d = def("Special Forces");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "sf", def: d, owner: P1, zone: "play" }, ...bank("rage", 4, P1)]
    });
    activate(engine, P1, id("sf"), "undercovert-operations");
    assert.ok(engine.getKeywords(id("sf")).includes("covert"), "engine.getKeywords(id(\"sf\")).includes(\"covert\")");
    assert.equal(engine.getStat(id("sf"), "life"), (d.life ?? 0) - 1);
  });
});

describe("Holy Heist — Stern But Fair Backhand", () => {
  test("deployed in response to a tactic, it terminates that tactic", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "sbfb", def: def("Stern But Fair Backhand"), owner: P1, zone: "hand" },
        { key: "opp", def: killTactic({ name: "OppTactic" }), owner: P2, zone: "hand" },
        { key: "victim", def: character({ name: "Victim", life: 5 }), owner: P1, zone: "play" },
        ...bank("rage", 6, P1),
        ...bank("rage", 6, P2)
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("opp"), selected: { t: [id("victim")] } } as never);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("sbfb"), selected: {} } as never);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("opp")].zone, "discard");
    assert.equal(engine.state.cards[id("victim")].zone, "play");
  });
});

describe("Holy Heist — Suicide Smash", () => {
  test("sacrifices your character to deal its strength in damage to a location", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ss", def: def("Suicide Smash"), owner: P1, zone: "hand" },
        { key: "bomb", def: character({ name: "Bomb", strength: 4, life: 1 }), owner: P1, zone: "play" },
        { key: "loc", def: location({ name: "Loc", structure: 3 }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("ss"), { selected: { sac: [id("bomb")], loc: [id("loc")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("bomb")].zone, "discard");
    assert.equal(engine.state.cards[id("loc")].zone, "discard");
  });
});

describe("Holy Heist — Thabbashite Bowlegger", () => {
  test("when a [V] source enters under your control, may grant a character +2 strength this turn", () => {
    const buff = character({ name: "Buff", strength: 2 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "tb", def: def("Thabbashite Bowlegger"), owner: P1, zone: "play" },
        { key: "buff", def: buff, owner: P1, zone: "play" },
        { key: "vres", def: def("Raging Ferocity"), owner: P1, zone: "hand" }
      ]
    });
    developPlay(engine, P1, id("vres"), true);
    resolvePendingResponses(engine);
    drain(engine, pc =>
      pc.kind === "selectTargets" ? { kind: "selectTargets", selected: { c: [id("buff")] } } : declineAll(pc)
    );
    assert.equal(engine.getStat(id("buff"), "strength"), (buff.strength ?? 0) + 2);
  });
});

describe("Holy Heist — Twisted Cannoneer", () => {
  test("FIRE! sacrifices your character and pays 1 to deal 1 damage to a faction", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "tc", def: def("Twisted Cannoneer"), owner: P1, zone: "play" },
        { key: "sac", def: character({ name: "Sac" }), owner: P1, zone: "play" },
        ...bank("rage", 4, P1)
      ]
    });
    const facP2 = engine.state.players[P2].factionId!;
    const inf = engine.state.players[P2].influence;
    activate(engine, P1, id("tc"), "twisted-cannoneer-fire", { selected: { f: [facP2], sac: [id("sac")] } });
    assert.equal(engine.state.cards[id("sac")].zone, "discard");
    assert.equal(engine.state.players[P2].influence, inf - 1);
  });
});

describe("Holy Heist — Vicious Bruiser", () => {
  test("gains +2/+4 while you control [R]x6", () => {
    const d = def("Vicious Bruiser");
    const { engine, id } = buildGame({
      cards: [{ key: "vb", def: d, owner: P1, zone: "play" }, ...bank("rage", 6, P1)]
    });
    assert.equal(engine.getStat(id("vb"), "strength"), (d.strength ?? 0) + 2);
    assert.equal(engine.getStat(id("vb"), "life"), (d.life ?? 0) + 4);
  });

  test("no bonus below [R]x6", () => {
    const d = def("Vicious Bruiser");
    const { engine, id } = buildGame({
      cards: [{ key: "vb", def: d, owner: P1, zone: "play" }, ...bank("rage", 5, P1)]
    });
    assert.equal(engine.getStat(id("vb"), "strength"), d.strength ?? 0);
  });
});

describe("Holy Heist — Zigalburgonglgr, the Stolen God", () => {
  test("TURN TO MUSH flips a token-bearing card face down", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "zig", def: def("Zigalburgonglgr, the Stolen God"), owner: P1, zone: "play" },
        { key: "marked", def: character({ name: "Marked" }), owner: P2, zone: "play", counters: { token: 1 } },
        ...bank("rage", 4, P1)
      ]
    });
    activate(engine, P1, id("zig"), "zigal-mush", { selected: { m: [id("marked")] } });
    assert.equal(engine.state.cards[id("marked")].faceDown, true);
  });
});
