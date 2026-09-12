// Per-card correctness suite — Open Beta (206 cards). One describe() per
// catalog card. See ./_harness.ts and ../../../CARD-TEST-PROGRESS.md.

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
  resourceCard,
  killTactic,
  drawerChar,
  play,
  activate,
  resolvePendingResponses,
  autoResolveBattle,
  P1,
  P2
} from "./_harness.js";
import type { CardDefinition } from "../../../engine.js";

const SET = "Open Beta";
const def = (name: string) => cardDef(SET, name);

function drain(
  engine: ReturnType<typeof buildGame>["engine"],
  answerFor: (pc: { kind: string; playerId: string; [k: string]: unknown }) => unknown,
  budget = 40
): void {
  let n = 0;
  while (engine.state.pendingChoice && n++ < budget) {
    const pc = engine.state.pendingChoice as { kind: string; playerId: string };
    engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: answerFor(pc) } as never);
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
    case "nameValue":
      return { kind: "nameValue", value: pc.valueKind === "resourceIcon" ? "rage" : pc.valueKind === "trade" ? "warlord" : "Nonexistent" };
    case "deployForFree":
      return { kind: "deployForFree" };
    case "spendCountersMenu":
      return { kind: "spendCountersMenu", done: true };
    default:
      return { kind: pc.kind };
  }
};

// =====================================================================
// Parametrized: vanilla resources, vanilla characters, faction
// =====================================================================

describe("Open Beta — vanilla staple resources", () => {
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
      engine.perform({
        type: "chooseDevelop",
        playerId: P1,
        choice: { type: "playResource", cards: [{ cardId: id("r"), faceDown: false }] }
      } as never);
      resolvePendingResponses(engine);
      assert.equal((engine.getThresholds(P1)[icon] ?? 0) - before, 1);
    });
  }
});

describe("Open Beta — vanilla characters", () => {
  for (const name of [
    "Arena Quarter-Finalist",
    "Costly Filcher",
    "Creaky Old Swordsman",
    "Dandy Day-Trader",
    "Dock Sentinel",
    "Headlong Purloiner",
    "Legacy Warmachine",
    "Manifold Quasi-Modal Steamwork",
    "Oversoon Lightfoot",
    "Plodding Brute",
    "Scout",
    "Stalwart Soldier",
    "Union Leader",
    "Warrior Prodigy"
  ]) {
    test(`${name} deploys with its printed stats and no keywords`, () => {
      const d = def(name);
      const { engine, id } = buildGame({
        cards: [{ key: "c", def: d, owner: P1, zone: "play" }]
      });
      assert.equal(engine.getStat(id("c"), "strength"), d.strength ?? 0);
      assert.equal(engine.getStat(id("c"), "life"), d.life ?? 0);
      assert.deepEqual(engine.getKeywords(id("c")), []);
    });
  }
});

describe("Open Beta — The Tournament Faction", () => {
  test("DRAW pays 3 and draws a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: def("The Tournament Faction") },
      cards: [
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("rage", 4, P1)
      ]
    });
    const facId = engine.state.players[P1].factionId!;
    void id;
    const hand = engine.state.players[P1].hand.length;
    engine.perform({ type: "activateAbility", playerId: P1, cardId: facId, abilityId: "tournament-draw", selected: {}, variables: {} });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].hand.length, hand + 1);
  });
});

// =====================================================================
// A – C
// =====================================================================

describe("Open Beta — 12 Man Brunch of Doom", () => {
  test("depletes X of your characters to destroy one with strength ≤ X+X", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "b", def: def("12 Man Brunch of Doom"), owner: P1, zone: "hand" },
        { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC", strength: 2 }), owner: P2, zone: "play" },
        ...bank("obsession", 6, P1)
      ]
    });
    play(engine, P1, id("b"), { variables: { x: 1 }, selected: { depleted: [id("mine")], picked: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].zone, "discard");
    assert.equal(engine.state.cards[id("mine")].depleted, true);
  });
});

describe("Open Beta — 1337!", () => {
  test("draws a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "l", def: def("1337!"), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("elitism", 4, P1)
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    play(engine, P1, id("l"), {});
    assert.equal(engine.state.players[P1].hand.length, hand - 1 + 1);
  });
});

describe("Open Beta — 3p1ph4ny 31f", () => {
  test("ETB lets you deploy a non-tactic card for free", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "e", def: def("3p1ph4ny 31f"), owner: P1, zone: "hand" },
        { key: "freebie", def: character({ name: "Freebie", cost: 9 }), owner: P1, zone: "hand" },
        ...bank("elitism", 6, P1)
      ]
    });
    play(engine, P1, id("e"), {});
    drain(engine, pc =>
      pc.kind === "deployForFree" && pc.playerId === P1
        ? { kind: "deployForFree", cardId: id("freebie") }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("freebie")].zone, "play");
  });
});

describe("Open Beta — 633fy 31f", () => {
  test("cannot be deployed without 2 prior non-resource deploys this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "c", def: def("633fy 31f"), owner: P1, zone: "hand" }, ...bank("elitism", 6, P1)]
    });
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("c"), selected: {} } as never)
    );
  });

  test("deploys after two non-resource deploys this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "c", def: def("633fy 31f"), owner: P1, zone: "hand" },
        { key: "i1", def: item({ name: "I1", cost: 0 }), owner: P1, zone: "hand" },
        { key: "i2", def: item({ name: "I2", cost: 0 }), owner: P1, zone: "hand" },
        ...bank("elitism", 6, P1)
      ],
      turn: 2
    });
    play(engine, P1, id("i1"), {});
    play(engine, P1, id("i2"), {});
    play(engine, P1, id("c"), {});
    assert.equal(engine.state.cards[id("c")].zone, "play");
  });
});

describe("Open Beta — 700160x 31f", () => {
  test("ETB may put a cheap gear card into play attached to it", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "x", def: def("700160x 31f"), owner: P1, zone: "hand" },
        { key: "gear", def: item({ name: "Gear", cost: 3, subtype: ["gear"] }), owner: P1, zone: "deck" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("elitism", 6, P1)
      ]
    });
    play(engine, P1, id("x"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("gear")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("gear")].zone, "play");
    assert.equal(engine.state.cards[id("gear")].attachedTo, id("x"));
  });
});

describe("Open Beta — Adroit Marauder", () => {
  test("gains +3/+3 while an opponent has 10+ cards in discard", () => {
    const d = def("Adroit Marauder");
    const { engine, id } = buildGame({
      cards: [
        { key: "am", def: d, owner: P1, zone: "play" },
        ...Array.from({ length: 10 }, (_, i) => ({ key: `g${i}`, def: character({ name: `G${i}` }), owner: P2, zone: "discard" as const }))
      ]
    });
    assert.equal(engine.getStat(id("am"), "strength"), (d.strength ?? 0) + 3);
    assert.equal(engine.getStat(id("am"), "life"), (d.life ?? 0) + 3);
  });
});

describe("Open Beta — Air Travel", () => {
  test("gives a character COVERT this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "at", def: def("Air Travel"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("obsession", 4, P1)
      ]
    });
    play(engine, P1, id("at"), { selected: { target: [id("c")] } });
    assert.ok(engine.getKeywords(id("c")).includes("covert"));
  });
});

describe("Open Beta — All-Nighter", () => {
  test("resolves during your turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "an", def: def("All-Nighter"), owner: P1, zone: "hand" }, ...bank("elitism", 6, P1)],
      turn: 2
    });
    play(engine, P1, id("an"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("an")].zone, "discard");
  });
});

describe("Open Beta — Ambuscade", () => {
  test("sacrifices your character to burn the attacking party for twice its strength", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "amb", def: def("Ambuscade"), owner: P1, zone: "hand" },
        { key: "sac", def: character({ name: "Sac", strength: 2 }), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 1, life: 8, speed: 3 }), owner: P2, zone: "play" },
        ...bank("deception", 6, P1)
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    engine.perform({ type: "passPriority", playerId: P2 });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("amb"), selected: { c: [id("sac")], atk: [id("atk")] } } as never);
    resolvePendingResponses(engine);
    drain(engine, pc =>
      pc.kind === "distributeAmong" ? { kind: "distributeAmong", shares: { [id("atk")]: 4 } } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("sac")].zone, "discard");
    assert.equal(engine.state.cards[id("atk")].damage, 4);
  });
});

describe("Open Beta — Amortized Straw Man", () => {
  test("loses 1/1 per token; INSTALLMENT PLAN removes a token", () => {
    const d = def("Amortized Straw Man");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "asm", def: d, owner: P1, zone: "play", counters: { token: 3 } },
        ...bank("greed", 6, P1)
      ]
    });
    assert.equal(engine.getStat(id("asm"), "strength"), (d.strength ?? 0) - 3);
    activate(engine, P1, id("asm"), "installment");
    assert.equal(engine.state.cards[id("asm")].counters?.token, 2);
    assert.equal(engine.getStat(id("asm"), "strength"), (d.strength ?? 0) - 2);
  });
});

describe("Open Beta — Arcana Department", () => {
  test("a forming attacking party must have an even number of members", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ad", def: def("Arcana Department"), owner: P1, zone: "play" },
        { key: "a1", def: character({ name: "A1", strength: 1, life: 3, speed: 3 }), owner: P1, zone: "play" }
      ],
      turn: 2
    });
    assert.throws(() =>
      engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("a1")], target: { type: "faction", playerId: P2 } })
    );
  });
});

describe("Open Beta — Arcana Experiment", () => {
  test("cannot be deployed with fewer than 5 cards in your deck", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ae", def: def("Arcana Experiment"), owner: P1, zone: "hand" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("obsession", 10, P1)
      ]
    });
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("ae"), selected: {}, variables: {} } as never)
    );
  });
});

describe("Open Beta — Arcanist's Almanac", () => {
  test("FORESIGHT looks at the top cards of a chosen deck", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "aa", def: def("Arcanist's Almanac"), owner: P1, zone: "play" },
        ...Array.from({ length: 3 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P2, zone: "deck" as const }))
      ]
    });
    const facP2 = engine.state.players[P2].factionId!;
    activate(engine, P1, id("aa"), "almanac-foresight", { selected: { deckOwner: [facP2] } });
    assert.equal(engine.state.pendingChoice?.kind, "reorderDeck");
    drain(engine, declineAll);
  });
});

describe("Open Beta — Armored Keep", () => {
  test("its controller does not lose the game at 0 influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction(), influence: 0 },
      cards: [
        { key: "ak", def: def("Armored Keep"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" }
      ]
    });
    void id;
    assert.equal(engine.state.winner ?? null, null);
  });
});

describe("Open Beta — Ashes of Zenobia", () => {
  test("NULLIFY makes each player bounce a character they control", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "az", def: def("Ashes of Zenobia"), owner: P1, zone: "play" },
        { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
        { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "play" },
        ...bank("obsession", 8, P1)
      ]
    });
    activate(engine, P1, id("az"), "nullify");
    drain(engine, pc => {
      if (pc.kind === "chooserSelectsTarget" && pc.playerId === P1) return { kind: "chooserSelectsTarget", selected: [id("mine")] };
      if (pc.kind === "chooserSelectsTarget" && pc.playerId === P2) return { kind: "chooserSelectsTarget", selected: [id("theirs")] };
      return declineAll(pc);
    });
    assert.equal(engine.state.cards[id("mine")].zone, "hand");
    assert.equal(engine.state.cards[id("theirs")].zone, "hand");
  });
});

describe("Open Beta — Basic Node", () => {
  test("when destroyed, all other node cards are destroyed", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "bn", def: def("Basic Node"), owner: P1, zone: "play" },
        { key: "other", def: character({ name: "OtherNode", subtype: ["node"] }), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("kill"), { selected: { t: [id("bn")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("other")].zone, "discard");
  });
});

describe("Open Beta — Bask Bile", () => {
  test("inflicts 5 damage to a chosen character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "bb", def: def("Bask Bile"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", life: 9 }), owner: P2, zone: "play" },
        ...bank("rage", 8, P1)
      ]
    });
    play(engine, P1, id("bb"), { selected: { t: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].damage, 5);
  });
});

describe("Open Beta — Beatrix Winterbottom", () => {
  test("increases every draw you make by 1", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "bw", def: def("Beatrix Winterbottom"), owner: P1, zone: "play" },
        { key: "drawer", def: drawerChar(), owner: P1, zone: "play" },
        ...Array.from({ length: 3 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const }))
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    activate(engine, P1, id("drawer"), "draw1");
    assert.equal(engine.state.players[P1].hand.length, hand + 2);
  });
});

describe("Open Beta — Befuddling Beggar", () => {
  test("PANHANDLE gives a character +1 speed this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "bb", def: def("Befuddling Beggar"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C", speed: 3 }), owner: P1, zone: "play" }
      ]
    });
    activate(engine, P1, id("bb"), "panhandle", { selected: { c: [id("c")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 0 } : declineAll(pc)
    );
    assert.equal(engine.getStat(id("c"), "speed"), 4);
  });
});

describe("Open Beta — Berserker Corps", () => {
  test("gains +1 strength per token on it", () => {
    const d = def("Berserker Corps");
    const { engine, id } = buildGame({
      cards: [{ key: "bc", def: d, owner: P1, zone: "play", counters: { token: 3 } }]
    });
    assert.equal(engine.getStat(id("bc"), "strength"), (d.strength ?? 0) + 3);
  });
});

describe("Open Beta — Bipolar Sarcophyle", () => {
  test("gains +1/+1 per token on it", () => {
    const d = def("Bipolar Sarcophyle");
    const { engine, id } = buildGame({
      cards: [{ key: "bs", def: d, owner: P1, zone: "play", counters: { token: 1 } }]
    });
    assert.equal(engine.getStat(id("bs"), "strength"), (d.strength ?? 0) + 1);
    assert.equal(engine.getStat(id("bs"), "life"), (d.life ?? 0) + 1);
  });
});

describe("Open Beta — Blanching Butcher", () => {
  test("ETB costs your faction 3 influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "bb", def: def("Blanching Butcher"), owner: P1, zone: "hand" }, ...bank("greed", 4, P1)]
    });
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("bb"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.players[P1].influence, inf - 3);
  });
});

describe("Open Beta — Bloodcurdling Bulldozer", () => {
  test("when it attacks, may deplete a chosen character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "bb", def: def("Bloodcurdling Bulldozer"), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("bb")], target: { type: "faction", playerId: P2 } });
    drain(engine, pc =>
      pc.kind === "selectTargets" ? { kind: "selectTargets", selected: { target: [id("oc")] } } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("oc")].depleted, true);
  });
});

describe("Open Beta — Brummagem Jewelry", () => {
  test("the attached character cannot be restored by the Restore Rule", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
        { key: "bj", def: def("Brummagem Jewelry"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.ok(engine.getRestrictions(id("host")).includes("cannotBeRestoredByRule"));
  });
});

describe("Open Beta — Cannon Squadron", () => {
  test("FIRE! distributes up to 2 damage across chosen characters", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cs", def: def("Cannon Squadron"), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC", life: 5 }), owner: P2, zone: "play" }
      ]
    });
    activate(engine, P1, id("cs"), "cannon-squadron-fire", { selected: { picked: [id("oc")] } });
    drain(engine, pc =>
      pc.kind === "distributeAmong" ? { kind: "distributeAmong", shares: { [id("oc")]: 2 } } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("oc")].damage, 2);
  });
});

describe("Open Beta — Card Counter", () => {
  test("ETB mills an opponent 2 or 3", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cc", def: def("Card Counter"), owner: P1, zone: "hand" },
        ...Array.from({ length: 6 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P2, zone: "deck" as const })),
        ...bank("deception", 4, P1)
      ]
    });
    const disc = engine.state.players[P2].discard.length;
    play(engine, P1, id("cc"), {});
    drain(engine, declineAll);
    assert.ok(engine.state.players[P2].discard.length - disc >= 2);
  });
});

describe("Open Beta — Cash Out", () => {
  test("pays X+X to draw X+1 cards", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "co", def: def("Cash Out"), owner: P1, zone: "hand" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("greed", 6, P1)
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    play(engine, P1, id("co"), { variables: { x: 1 } });
    assert.equal(engine.state.players[P1].hand.length, hand - 1 + 2);
  });
});

describe("Open Beta — Catastrophic Betrayal", () => {
  test("reanimates an opponent's discard character into your attacking party, depleted", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cb", def: def("Catastrophic Betrayal"), owner: P1, zone: "hand" },
        { key: "a", def: character({ name: "A", strength: 1, life: 3, speed: 3 }), owner: P1, zone: "play" },
        { key: "corpse", def: character({ name: "Corpse" }), owner: P2, zone: "discard" },
        ...bank("deception", 8, P1)
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("a")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("cb"), selected: { c: [id("corpse")] } } as never);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("corpse")].zone, "play");
    assert.equal(engine.state.cards[id("corpse")].controllerId, P1);
    assert.equal(engine.state.cards[id("corpse")].depleted, true);
  });
});

describe("Open Beta — Compulsive Creeper", () => {
  test("gains +1/+1/+1 while you have an even number of cards in hand", () => {
    const d = def("Compulsive Creeper");
    const even = buildGame({
      cards: [
        { key: "cc", def: d, owner: P1, zone: "play" },
        { key: "h1", def: character({ name: "H1" }), owner: P1, zone: "hand" },
        { key: "h2", def: character({ name: "H2" }), owner: P1, zone: "hand" }
      ]
    });
    assert.equal(even.engine.getStat(even.id("cc"), "strength"), (d.strength ?? 0) + 1);

    const odd = buildGame({
      cards: [
        { key: "cc", def: d, owner: P1, zone: "play" },
        { key: "h1", def: character({ name: "H1" }), owner: P1, zone: "hand" }
      ]
    });
    assert.equal(odd.engine.getStat(odd.id("cc"), "strength"), d.strength ?? 0);
  });
});

describe("Open Beta — Concealed Goon", () => {
  test("is COVERT; ETB costs your faction 5 influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "cg", def: def("Concealed Goon"), owner: P1, zone: "hand" }, ...bank("greed", 8, P1)]
    });
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("cg"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.players[P1].influence, inf - 5);
    assert.ok(engine.getKeywords(id("cg")).includes("covert"));
  });
});

describe("Open Beta — Crazed Deputy", () => {
  test("when blocked, it gains +2/+2 this turn", () => {
    const d = def("Crazed Deputy");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cd", def: d, owner: P1, zone: "play" },
        { key: "blk", def: character({ name: "Blk", strength: 0, life: 5, speed: 1 }), owner: P2, zone: "play" }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("cd")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("cd"), "strength"), (d.strength ?? 0) + 2);
  });
});

// =====================================================================
// D – H
// =====================================================================

describe("Open Beta — Defenestrate", () => {
  test("mills an opponent 2 and draws a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "df", def: def("Defenestrate"), owner: P1, zone: "hand" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `o${i}`, def: character({ name: `O${i}` }), owner: P2, zone: "deck" as const })),
        { key: "m1", def: character({ name: "M1" }), owner: P1, zone: "deck" },
        ...bank("deception", 4, P1)
      ]
    });
    const disc = engine.state.players[P2].discard.length;
    const hand = engine.state.players[P1].hand.length;
    play(engine, P1, id("df"), {});
    assert.equal(engine.state.players[P2].discard.length, disc + 2);
    assert.equal(engine.state.players[P1].hand.length, hand - 1 + 1);
  });
});

describe("Open Beta — Defense Attorney", () => {
  test("must block if it can", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "da", def: def("Defense Attorney"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getRestrictions(id("da")).includes("mustBlock"));
  });
});

describe("Open Beta — Degenerate Molestation", () => {
  test("an opponent discards a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "dm", def: def("Degenerate Molestation"), owner: P1, zone: "hand" },
        { key: "oh", def: character({ name: "OH", cost: 1 }), owner: P2, zone: "hand" },
        ...bank("obsession", 12, P1)
      ]
    });
    const disc = engine.state.players[P2].discard.length;
    play(engine, P1, id("dm"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" && pc.playerId === P2
        ? { kind: "chooserSelectsTarget", selected: [id("oh")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.players[P2].discard.length, disc + 1);
  });
});

describe("Open Beta — Devastating Mockery", () => {
  test("a COVERT character loses COVERT this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "dm", def: def("Devastating Mockery"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("elitism", 4, P1)
      ]
    });
    play(engine, P1, id("dm"), { selected: { c: [id("oc")] } });
    assert.equal(engine.getKeywords(id("oc")).includes("covert"), false);
  });
});

describe("Open Beta — Downsizing", () => {
  test("destroys all characters", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ds", def: def("Downsizing"), owner: P1, zone: "hand" },
        { key: "m1", def: character({ name: "M1" }), owner: P1, zone: "play" },
        { key: "o1", def: character({ name: "O1" }), owner: P2, zone: "play" },
        ...bank("greed", 12, P1)
      ]
    });
    play(engine, P1, id("ds"), {});
    assert.equal(engine.state.cards[id("m1")].zone, "discard");
    assert.equal(engine.state.cards[id("o1")].zone, "discard");
  });
});

describe("Open Beta — Dragon Catheter", () => {
  test("all characters gain 1 strength per token on them", () => {
    const c = character({ name: "C", strength: 2 });
    const { engine, id } = buildGame({
      cards: [
        { key: "dc", def: def("Dragon Catheter"), owner: P1, zone: "play" },
        { key: "c", def: c, owner: P1, zone: "play", counters: { token: 2 } }
      ]
    });
    assert.equal(engine.getStat(id("c"), "strength"), (c.strength ?? 0) + 2);
  });
});

describe("Open Beta — Dragon Juice", () => {
  test("gives a character +5 strength this turn", () => {
    const c = character({ name: "C", strength: 2 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "dj", def: def("Dragon Juice"), owner: P1, zone: "hand" },
        { key: "c", def: c, owner: P1, zone: "play" },
        ...bank("rage", 4, P1)
      ]
    });
    play(engine, P1, id("dj"), { selected: { target: [id("c")] } });
    assert.equal(engine.getStat(id("c"), "strength"), (c.strength ?? 0) + 5);
  });
});

describe("Open Beta — Dragon Rider", () => {
  test("gains +1/+1 per dragon card you control", () => {
    const d = def("Dragon Rider");
    const { engine, id } = buildGame({
      cards: [
        { key: "dr", def: d, owner: P1, zone: "play" },
        { key: "g1", def: character({ name: "G1", subtype: ["dragon"] }), owner: P1, zone: "play" },
        { key: "g2", def: character({ name: "G2", subtype: ["dragon"] }), owner: P1, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("dr"), "strength"), (d.strength ?? 0) + 2);
  });
});

describe("Open Beta — Dragon Tank", () => {
  test("deploys with its printed stats", () => {
    const d = def("Dragon Tank");
    const { engine, id } = buildGame({
      cards: [{ key: "dt", def: d, owner: P1, zone: "play" }]
    });
    assert.equal(engine.getStat(id("dt"), "strength"), d.strength ?? 0);
    assert.equal(engine.getStat(id("dt"), "life"), d.life ?? 0);
  });
});

describe("Open Beta — Dragon's Anthem", () => {
  test("your characters gain 5 strength this turn", () => {
    const c = character({ name: "C", strength: 2 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "da", def: def("Dragon's Anthem"), owner: P1, zone: "hand" },
        { key: "c", def: c, owner: P1, zone: "play" },
        ...bank("rage", 12, P1)
      ]
    });
    play(engine, P1, id("da"), {});
    assert.equal(engine.getStat(id("c"), "strength"), (c.strength ?? 0) + 5);
  });
});

describe("Open Beta — Dragon's Quarters", () => {
  test("deploys as a warlord location", () => {
    const d = def("Dragon's Quarters");
    assert.equal(d.type, "location");
    assert.equal(d.trade, "warlord");
  });
});

describe("Open Beta — Dragon's Strategy", () => {
  test("an opponent's faction loses 2 influence and you draw", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ds", def: def("Dragon's Strategy"), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("rage", 4, P1)
      ]
    });
    const inf = engine.state.players[P2].influence;
    play(engine, P1, id("ds"), {});
    assert.equal(engine.state.players[P2].influence, inf - 2);
  });
});

describe("Open Beta — Ecto-Distillation", () => {
  test("resolves after naming a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ed", def: def("Ecto-Distillation"), owner: P1, zone: "hand" },
        ...bank("obsession", 6, P1)
      ]
    });
    play(engine, P1, id("ed"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("ed")].zone, "discard");
  });
});

describe("Open Beta — Emergency Obfuscation", () => {
  test("at the end of your turn, if it has 2+ tokens, it is destroyed", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "eo", def: def("Emergency Obfuscation"), owner: P1, zone: "play", counters: { token: 2 } }],
      turn: 2
    });
    engine.perform({ type: "endTurn", playerId: P1 });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("eo")].zone, "discard");
  });
});

describe("Open Beta — Entrancing Harlot", () => {
  test("when it attacks, other members of its party gain 1 speed this turn", () => {
    const ally = character({ name: "Ally", strength: 1, life: 3, speed: 3 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "eh", def: def("Entrancing Harlot"), owner: P1, zone: "play" },
        { key: "ally", def: ally, owner: P1, zone: "play" }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("eh"), id("ally")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("ally"), "speed"), (ally.speed ?? 0) + 1);
  });
});

describe("Open Beta — Epiphanal Mechanic", () => {
  test("DEVELOPMENT tutors an item into hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "em", def: def("Epiphanal Mechanic"), owner: P1, zone: "play" },
        { key: "tool", def: item({ name: "Tool" }), owner: P1, zone: "deck" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" }
      ]
    });
    activate(engine, P1, id("em"), "development");
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("tool")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("tool")].zone, "hand");
  });
});

describe("Open Beta — Erotic Assassin", () => {
  test("cannot be restored by the Restore Rule and attacks only once per turn", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "ea", def: def("Erotic Assassin"), owner: P1, zone: "play" }]
    });
    const r = engine.getRestrictions(id("ea"));
    assert.ok(r.includes("cannotBeRestoredByRule"));
    assert.ok(r.includes("attackOncePerTurn"));
  });

  test("RESTORE pays 2 to restore it", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ea", def: def("Erotic Assassin"), owner: P1, zone: "play", depleted: true },
        ...bank("greed", 4, P1)
      ]
    });
    activate(engine, P1, id("ea"), "restore");
    assert.equal(engine.state.cards[id("ea")].depleted, false);
  });
});

describe("Open Beta — Executive Poaching", () => {
  test("destroys the opponent's highest-cost character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ep", def: def("Executive Poaching"), owner: P1, zone: "hand" },
        { key: "cheap", def: character({ name: "Cheap", cost: 3 }), owner: P2, zone: "play" },
        { key: "pricey", def: character({ name: "Pricey", cost: 7 }), owner: P2, zone: "play" },
        ...bank("greed", 6, P1)
      ]
    });
    play(engine, P1, id("ep"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("pricey")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("pricey")].zone, "discard");
    assert.equal(engine.state.cards[id("cheap")].zone, "play");
  });
});

describe("Open Beta — Eye Gouge", () => {
  test("inflicts 3 damage to a blocking character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "eg", def: def("Eye Gouge"), owner: P1, zone: "hand" },
        { key: "atk", def: character({ name: "Atk", strength: 2, life: 5, speed: 3 }), owner: P1, zone: "play" },
        { key: "blk", def: character({ name: "Blk", strength: 1, life: 6, speed: 1 }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("eg"), selected: { target: [id("blk")] } } as never);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("blk")].damage, 3);
  });
});

describe("Open Beta — Ferrous Ferret", () => {
  test("anything that can pick it must pick it", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ff", def: def("Ferrous Ferret"), owner: P1, zone: "play" },
        { key: "other", def: character({ name: "Other" }), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    assert.ok(engine.getRestrictions(id("ff")).includes("mustBePicked"));
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("kill"), selected: { t: [id("other")] } } as never)
    );
  });
});

describe("Open Beta — Flaming Barduse", () => {
  test("EXTRA COST picks characters; ETB distributes 2 damage to them", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "fb", def: def("Flaming Barduse"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", life: 5 }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("fb"), { selected: { picked: [id("oc")] } });
    drain(engine, pc =>
      pc.kind === "distributeAmong" ? { kind: "distributeAmong", shares: { [id("oc")]: 2 } } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("oc")].damage, 2);
  });
});

describe("Open Beta — Forced Recruitment", () => {
  test("steals a character being deployed into play under your control", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "fr", def: def("Forced Recruitment"), owner: P1, zone: "hand" },
        { key: "guy", def: character({ name: "Guy", cost: 2 }), owner: P2, zone: "hand" },
        ...bank("deception", 10, P1),
        ...bank("greed", 4, P2)
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("guy"), selected: {} } as never);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("fr"), selected: {} } as never);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("guy")].zone, "play");
    assert.equal(engine.state.cards[id("guy")].controllerId, P1);
  });
});

describe("Open Beta — Forget", () => {
  test("bounces a non-resource card and makes an opponent discard from hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "fg", def: def("Forget"), owner: P1, zone: "hand" },
        { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
        { key: "oh", def: character({ name: "OH" }), owner: P2, zone: "hand" },
        ...bank("obsession", 6, P1)
      ]
    });
    play(engine, P1, id("fg"), { selected: { bounced: [id("mine")], discarded: [id("oh")] } });
    assert.equal(engine.state.cards[id("mine")].zone, "hand");
    assert.equal(engine.state.cards[id("oh")].zone, "discard");
  });
});

describe("Open Beta — Free Trade Agreement", () => {
  test("at the start of a turn, the active player picks one of its options", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [{ key: "fta", def: def("Free Trade Agreement"), owner: P1, zone: "play" }],
      turn: 2,
      activePlayerId: P2
    });
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsOption");
    drain(engine, declineAll);
  });
});

describe("Open Beta — Ghostly Auditor", () => {
  test("gains COVERT while you control only 1 character", () => {
    const solo = buildGame({
      cards: [{ key: "ga", def: def("Ghostly Auditor"), owner: P1, zone: "play" }]
    });
    assert.ok(solo.engine.getKeywords(solo.id("ga")).includes("covert"));

    const pair = buildGame({
      cards: [
        { key: "ga", def: def("Ghostly Auditor"), owner: P1, zone: "play" },
        { key: "c2", def: character({ name: "C2" }), owner: P1, zone: "play" }
      ]
    });
    assert.equal(pair.engine.getKeywords(pair.id("ga")).includes("covert"), false);
  });
});

describe("Open Beta — Gold Summit", () => {
  test("when you draw, your faction gains influence equal to the number drawn", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "gs", def: def("Gold Summit"), owner: P1, zone: "play" },
        { key: "drawer", def: drawerChar(), owner: P1, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" }
      ]
    });
    const inf = engine.state.players[P1].influence;
    activate(engine, P1, id("drawer"), "draw1");
    assert.equal(engine.state.players[P1].influence, inf + 1);
  });
});

describe("Open Beta — Grand Theft All", () => {
  test("reanimates up to 4 non-tactic cards from an opponent's discard", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "gta", def: def("Grand Theft All"), owner: P1, zone: "hand" },
        { key: "c1", def: character({ name: "C1" }), owner: P2, zone: "discard" },
        { key: "c2", def: character({ name: "C2" }), owner: P2, zone: "discard" },
        ...bank("deception", 12, P1)
      ]
    });
    play(engine, P1, id("gta"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("c1"), id("c2")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("c1")].zone, "play");
    assert.equal(engine.state.cards[id("c1")].controllerId, P1);
    assert.equal(engine.state.cards[id("c2")].controllerId, P1);
  });
});

describe("Open Beta — Gruesome Trophies", () => {
  test("is a warlord item in the catalog", () => {
    const d = def("Gruesome Trophies");
    assert.equal(d.type, "item");
    assert.equal(d.trade, "warlord");
  });
});

describe("Open Beta — Hammer Smash", () => {
  test("destroys at least one item", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "hs", def: def("Hammer Smash"), owner: P1, zone: "hand" },
        { key: "i1", def: item({ name: "I1" }), owner: P2, zone: "play" },
        { key: "i2", def: item({ name: "I2" }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    // The coin-flip roll (min 1) means at least 1 pick is always in bounds
    // regardless of which way it landed, but the client can't know the
    // roll in advance — `play()` opens a `selectDeployTargets` pending
    // choice rather than accepting `selected` atomically; see
    // docs/multiplayer-architecture.md, "The client-supplied variables exploit".
    play(engine, P1, id("hs"));
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "selectDeployTargets", selected: { picked: [id("i1")] } }
    } as never);
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("i1")].zone, "discard");
  });
});

describe("Open Beta — Hangdog Alley", () => {
  test("a forming attacking party must have only 1 member", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ha", def: def("Hangdog Alley"), owner: P1, zone: "play" },
        { key: "a1", def: character({ name: "A1", strength: 1, life: 3, speed: 3 }), owner: P1, zone: "play" },
        { key: "a2", def: character({ name: "A2", strength: 1, life: 3, speed: 3 }), owner: P1, zone: "play" }
      ],
      turn: 2
    });
    assert.throws(() =>
      engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("a1"), id("a2")], target: { type: "faction", playerId: P2 } })
    );
  });
});

describe("Open Beta — Heirloom Incinerator", () => {
  test("when it inflicts damage to a faction, may destroy an item", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "hi", def: def("Heirloom Incinerator"), owner: P1, zone: "play" },
        { key: "it", def: item({ name: "It" }), owner: P2, zone: "play" }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("hi")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);
    drain(engine, pc =>
      pc.kind === "selectTargets" ? { kind: "selectTargets", selected: { target: [id("it")] } } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("it")].zone, "discard");
  });
});

describe("Open Beta — Heist Planner", () => {
  test("ETB mills 3 differently-named cards from an opponent's deck", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "hp", def: def("Heist Planner"), owner: P1, zone: "hand" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `o${i}`, def: character({ name: `O${i}` }), owner: P2, zone: "deck" as const })),
        ...bank("deception", 6, P1)
      ]
    });
    const disc = engine.state.players[P2].discard.length;
    play(engine, P1, id("hp"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("o0"), id("o1"), id("o2")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.players[P2].discard.length, disc + 3);
  });
});

describe("Open Beta — Hidden Sandwich", () => {
  test("if the attached character would be destroyed, it is destroyed instead", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "host", def: character({ name: "Host", life: 4 }), owner: P1, zone: "play" },
        { key: "sw", def: def("Hidden Sandwich"), owner: P1, zone: "play", attachedToKey: "host" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("kill"), { selected: { t: [id("host")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("host")].zone, "play");
    assert.equal(engine.state.cards[id("sw")].zone, "discard");
  });
});

describe("Open Beta — Hidden Sniper", () => {
  test("SHARPSHOOT inflicts 1 damage to a chosen character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "hs", def: def("Hidden Sniper"), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC", life: 5 }), owner: P2, zone: "play" },
        ...bank("rage", 4, P1)
      ]
    });
    activate(engine, P1, id("hs"), "hidden-sniper-sharpshoot", { selected: { target: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].damage, 1);
  });
});

describe("Open Beta — Hub Node", () => {
  test("gains +1/+1 per other node card in play", () => {
    const d = def("Hub Node");
    const { engine, id } = buildGame({
      cards: [
        { key: "hn", def: d, owner: P1, zone: "play" },
        { key: "n1", def: character({ name: "N1", subtype: ["node"] }), owner: P1, zone: "play" },
        { key: "n2", def: character({ name: "N2", subtype: ["node"] }), owner: P2, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("hn"), "strength"), (d.strength ?? 0) + 2);
  });
});

describe("Open Beta — Humiliating Torture Apparatus", () => {
  test("when a card is depleted, its controller's faction loses 1 influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "hta", def: def("Humiliating Torture Apparatus"), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" },
        { key: "dep", def: tactic({ name: "Dep", cost: 0, behavior: { abilities: [{ id: "d", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "deplete", target: { type: "selected", id: "t" } }] }] } }), owner: P1, zone: "hand" }
      ]
    });
    const inf = engine.state.players[P2].influence;
    play(engine, P1, id("dep"), { selected: { t: [id("oc")] } });
    assert.equal(engine.state.players[P2].influence, inf - 1);
  });
});

describe("Open Beta — Hyperphagic Sarcophyle", () => {
  test("gains +1/+1 per token on it", () => {
    const d = def("Hyperphagic Sarcophyle");
    const { engine, id } = buildGame({
      cards: [{ key: "hs", def: d, owner: P1, zone: "play", counters: { token: 2 } }]
    });
    assert.equal(engine.getStat(id("hs"), "strength"), (d.strength ?? 0) + 2);
    assert.equal(engine.getStat(id("hs"), "life"), (d.life ?? 0) + 2);
  });
});

describe("Open Beta — Hypnotic Plafond", () => {
  test("reduces battle damage to your faction by COVERT-party characters to 0", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "hp", def: def("Hypnotic Plafond"), owner: P1, zone: "play" },
        { key: "sneak", def: character({ name: "Sneak", strength: 4, life: 3, speed: 3, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }
      ],
      turn: 2,
      activePlayerId: P2
    });
    const inf = engine.state.players[P1].influence;
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("sneak")], target: { type: "faction", playerId: P1 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, inf);
  });
});

// =====================================================================
// I – M
// =====================================================================

describe("Open Beta — I Got the Gear!", () => {
  test("tutors a gear card into hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ig", def: def("I Got the Gear!"), owner: P1, zone: "hand" },
        { key: "gear", def: item({ name: "Gear", subtype: ["gear"] }), owner: P1, zone: "deck" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("elitism", 4, P1)
      ]
    });
    play(engine, P1, id("ig"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("gear")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("gear")].zone, "hand");
  });
});

describe("Open Beta — Impulsive Abductress", () => {
  test("KIDNAP destroys itself to destroy a battling character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ia", def: def("Impulsive Abductress"), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 2, life: 5, speed: 3 }), owner: P2, zone: "play" }
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    engine.perform({ type: "passPriority", playerId: P2 });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("ia"), abilityId: "kidnap", selected: { c: [id("atk")] }, variables: {} });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("atk")].zone, "discard");
    assert.equal(engine.state.cards[id("ia")].zone, "discard");
  });
});

describe("Open Beta — Incriminating Photograph", () => {
  test("the named card cannot be deployed", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ip", def: def("Incriminating Photograph"), owner: P1, zone: "hand" },
        { key: "banned", def: character({ name: "Banned", cost: 0 }), owner: P1, zone: "hand" },
        ...bank("deception", 4, P1)
      ],
      turn: 2
    });
    play(engine, P1, id("ip"), {});
    drain(engine, pc =>
      pc.kind === "nameValue" ? { kind: "nameValue", value: "Banned" } : declineAll(pc)
    );
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("banned"), selected: {} } as never)
    );
  });
});

describe("Open Beta — Index of Natural Forces", () => {
  test("CAPITALIZE pays 1 and depletes to draw a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "inf", def: def("Index of Natural Forces"), owner: P1, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("greed", 4, P1)
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    activate(engine, P1, id("inf"), "capitalize");
    assert.equal(engine.state.players[P1].hand.length, hand + 1);
  });
});

describe("Open Beta — Insidious Ecto-Manipulator", () => {
  test("has COVERT", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "ie", def: def("Insidious Ecto-Manipulator"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getKeywords(id("ie")).includes("covert"));
  });
});

describe("Open Beta — Intermittently Sneaky Lawyer", () => {
  test("gains +1 strength and COVERT while you have 6+ cards in hand", () => {
    const d = def("Intermittently Sneaky Lawyer");
    const many = buildGame({
      cards: [
        { key: "isl", def: d, owner: P1, zone: "play" },
        ...Array.from({ length: 6 }, (_, i) => ({ key: `h${i}`, def: character({ name: `H${i}` }), owner: P1, zone: "hand" as const }))
      ]
    });
    assert.equal(many.engine.getStat(many.id("isl"), "strength"), (d.strength ?? 0) + 1);
    assert.ok(many.engine.getKeywords(many.id("isl")).includes("covert"));

    const few = buildGame({
      cards: [
        { key: "isl", def: d, owner: P1, zone: "play" },
        ...Array.from({ length: 5 }, (_, i) => ({ key: `h${i}`, def: character({ name: `H${i}` }), owner: P1, zone: "hand" as const }))
      ]
    });
    assert.equal(few.engine.getKeywords(few.id("isl")).includes("covert"), false);
  });
});

describe("Open Beta — Invent", () => {
  test("pays X+X to tutor X-1 cards into hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "iv", def: def("Invent"), owner: P1, zone: "hand" },
        { key: "q1", def: character({ name: "Q1" }), owner: P1, zone: "deck" },
        { key: "q2", def: character({ name: "Q2" }), owner: P1, zone: "deck" },
        ...bank("elitism", 6, P1)
      ]
    });
    play(engine, P1, id("iv"), { variables: { x: 2 } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("q1")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("q1")].zone, "hand");
  });
});

describe("Open Beta — Irresistible Bribe", () => {
  test("destroys a character and gives its controller's faction its strength in influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ib", def: def("Irresistible Bribe"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", strength: 3 }), owner: P2, zone: "play" },
        ...bank("greed", 6, P1)
      ]
    });
    const inf = engine.state.players[P2].influence;
    play(engine, P1, id("ib"), { selected: { c: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].zone, "discard");
    assert.equal(engine.state.players[P2].influence, inf + 3);
  });
});

describe("Open Beta — Jackmove", () => {
  test("reveals the top X of an opponent's deck, playing characters/items under your control", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "jm", def: def("Jackmove"), owner: P1, zone: "hand" },
        { key: "top1", def: character({ name: "Top1" }), owner: P2, zone: "deck" },
        { key: "top2", def: tactic({ name: "Top2" }), owner: P2, zone: "deck" },
        ...bank("deception", 6, P1)
      ]
    });
    play(engine, P1, id("jm"), { variables: { x: 2 } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("top1")].zone, "play");
    assert.equal(engine.state.cards[id("top1")].controllerId, P1);
    assert.equal(engine.state.cards[id("top2")].zone, "discard");
  });
});

describe("Open Beta — Jacque's Trap", () => {
  test("IT'S A TRAP! destroys itself to destroy an attacking character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "jt", def: def("Jacque's Trap"), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 2, life: 5, speed: 3 }), owner: P2, zone: "play" }
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    engine.perform({ type: "passPriority", playerId: P2 });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("jt"), abilityId: "trap", selected: { c: [id("atk")] }, variables: {} });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("atk")].zone, "discard");
    assert.equal(engine.state.cards[id("jt")].zone, "discard");
  });
});

describe("Open Beta — Jo Ciendeilio", () => {
  test("RESEARCH depletes it", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "jo", def: def("Jo Ciendeilio"), owner: P1, zone: "play" }]
    });
    activate(engine, P1, id("jo"), "research");
    assert.equal(engine.state.cards[id("jo")].depleted, true);
  });
});

describe("Open Beta — Jumping Screamspider", () => {
  test("has COVERT", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "js", def: def("Jumping Screamspider"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getKeywords(id("js")).includes("covert"));
  });
});

describe("Open Beta — Kettinger", () => {
  test("grants +2 strength; HANDOFF re-attaches it", () => {
    const host = character({ name: "Host", strength: 2 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "host", def: host, owner: P1, zone: "play" },
        { key: "host2", def: character({ name: "Host2" }), owner: P1, zone: "play" },
        { key: "k", def: def("Kettinger"), owner: P1, zone: "play", attachedToKey: "host" },
        ...bank("rage", 6, P1)
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), (host.strength ?? 0) + 2);
    activate(engine, P1, id("k"), "kettinger-handoff", { selected: { newWearer: [id("host2")] } });
    assert.equal(engine.state.cards[id("k")].attachedTo, id("host2"));
  });
});

describe("Open Beta — Knobby Stave", () => {
  test("DISRUPT removes 2 tokens to make an opponent discard", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ks", def: def("Knobby Stave"), owner: P1, zone: "play", counters: { token: 2 } },
        { key: "oh", def: character({ name: "OH" }), owner: P2, zone: "hand" }
      ]
    });
    activate(engine, P1, id("ks"), "disrupt");
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("oh")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("oh")].zone, "discard");
  });
});

describe("Open Beta — Limited Liability", () => {
  test("reduces all inflicted damage to 0 this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ll", def: def("Limited Liability"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", life: 3 }), owner: P1, zone: "play" },
        { key: "zap", def: killTactic({ name: "Zap", behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 5 }] }] } }), owner: P1, zone: "hand" },
        ...bank("greed", 6, P1)
      ]
    });
    play(engine, P1, id("ll"), {});
    play(engine, P1, id("zap"), { selected: { t: [id("c")] } });
    assert.equal(engine.state.cards[id("c")].damage ?? 0, 0);
    assert.equal(engine.state.cards[id("c")].zone, "play");
  });
});

describe("Open Beta — Lugubrian Octopod", () => {
  test("is COVERT; on damage to a faction its controller discards 2", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "lo", def: def("Lugubrian Octopod"), owner: P1, zone: "play" },
        { key: "oh1", def: character({ name: "OH1" }), owner: P2, zone: "hand" },
        { key: "oh2", def: character({ name: "OH2" }), owner: P2, zone: "hand" }
      ],
      turn: 2
    });
    assert.ok(engine.getKeywords(id("lo")).includes("covert"));
    const disc = engine.state.players[P2].discard.length;
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("lo")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" && pc.playerId === P2
        ? { kind: "chooserSelectsTarget", selected: [id("oh1"), id("oh2")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.players[P2].discard.length, disc + 2);
  });
});

describe("Open Beta — Lugubrious Finger Trap", () => {
  test("the attached character cannot attack or block", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
        { key: "ft", def: def("Lugubrious Finger Trap"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    const r = engine.getRestrictions(id("host"));
    assert.ok(r.includes("cannotAttack"));
    assert.ok(r.includes("cannotBlock"));
  });
});

describe("Open Beta — Lugubrious Node", () => {
  test("RECONSTRUCT shuffles a node card from your discard into your deck", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ln", def: def("Lugubrious Node"), owner: P1, zone: "play" },
        { key: "node", def: character({ name: "Node", subtype: ["node"] }), owner: P1, zone: "discard" },
        ...bank("elitism", 4, P1)
      ]
    });
    activate(engine, P1, id("ln"), "reconstruct", { selected: { n: [id("node")] } });
    assert.equal(engine.state.cards[id("node")].zone, "deck");
  });
});

describe("Open Beta — Luteoderm Armor", () => {
  test("grants +2/+2 to the attached character", () => {
    const host = character({ name: "Host", strength: 2, life: 2 });
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: host, owner: P1, zone: "play" },
        { key: "la", def: def("Luteoderm Armor"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), (host.strength ?? 0) + 2);
    assert.equal(engine.getStat(id("host"), "life"), (host.life ?? 0) + 2);
  });
});

describe("Open Beta — Luteoderm Goliath", () => {
  test("grants +11/+11 to the attached character", () => {
    const host = character({ name: "Host", strength: 2, life: 2 });
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: host, owner: P1, zone: "play" },
        { key: "lg", def: def("Luteoderm Goliath"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), (host.strength ?? 0) + 11);
    assert.equal(engine.getStat(id("host"), "life"), (host.life ?? 0) + 11);
  });
});

describe("Open Beta — Luteoderm Prototype", () => {
  test("grants +1/+1; when the host leaves play, tutor a card into hand", () => {
    const host = character({ name: "Host", strength: 2, life: 2 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "host", def: host, owner: P1, zone: "play" },
        { key: "lp", def: def("Luteoderm Prototype"), owner: P1, zone: "play", attachedToKey: "host" },
        { key: "q1", def: character({ name: "Q1" }), owner: P1, zone: "deck" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), (host.strength ?? 0) + 1);
    play(engine, P1, id("kill"), { selected: { t: [id("host")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("q1")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("q1")].zone, "hand");
  });
});

describe("Open Beta — Mafia Lawyer", () => {
  test("ETB costs your faction 2 influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "ml", def: def("Mafia Lawyer"), owner: P1, zone: "hand" }, ...bank("greed", 6, P1)]
    });
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("ml"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.players[P1].influence, inf - 2);
  });
});

describe("Open Beta — Magic Vault", () => {
  test("at the start of your turn, may give a faction 2 influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "mv", def: def("Magic Vault"), owner: P1, zone: "play" }],
      turn: 2,
      activePlayerId: P2
    });
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    const facP1 = engine.state.players[P1].factionId!;
    const inf = engine.state.players[P1].influence;
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [facP1] } : declineAll(pc)
    );
    assert.equal(engine.state.players[P1].influence, inf + 2);
  });
});

describe("Open Beta — Master Ritualist", () => {
  test("QUOTIDIAN INSTRUCTION tutors a tactic into hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mr", def: def("Master Ritualist"), owner: P1, zone: "play" },
        { key: "tac", def: tactic({ name: "Tac" }), owner: P1, zone: "deck" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" }
      ]
    });
    activate(engine, P1, id("mr"), "qi");
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("tac")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("tac")].zone, "hand");
  });
});

describe("Open Beta — Master Scavenger", () => {
  test("RECLAIM removes 3 opponent discard cards for +1/+1 this turn", () => {
    const d = def("Master Scavenger");
    const { engine, id } = buildGame({
      cards: [
        { key: "ms", def: d, owner: P1, zone: "play" },
        ...Array.from({ length: 3 }, (_, i) => ({ key: `g${i}`, def: character({ name: `G${i}` }), owner: P2, zone: "discard" as const }))
      ]
    });
    activate(engine, P1, id("ms"), "reclaim", { selected: { cs: [id("g0"), id("g1"), id("g2")] } });
    assert.equal(engine.getStat(id("ms"), "strength"), (d.strength ?? 0) + 1);
    assert.equal(engine.state.cards[id("g0")].zone, "removed");
  });
});

describe("Open Beta — Mau “Consultant”", () => {
  test("ETB costs your faction 2 influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mc", def: def("Mau “Consultant”"), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("greed", 4, P1)
      ]
    });
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("mc"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.players[P1].influence, inf - 2);
  });
});

describe("Open Beta — Mau Tough", () => {
  test("ETB costs your faction 4 influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "mt", def: def("Mau Tough"), owner: P1, zone: "hand" }, ...bank("greed", 6, P1)]
    });
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("mt"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.players[P1].influence, inf - 4);
  });
});

describe("Open Beta — Meager Research", () => {
  test("puts the top card of an opponent's deck into their hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mr", def: def("Meager Research"), owner: P1, zone: "hand" },
        { key: "top", def: character({ name: "Top" }), owner: P2, zone: "deck" },
        { key: "d1", def: character({ name: "D1" }), owner: P2, zone: "deck" },
        ...bank("elitism", 4, P1)
      ]
    });
    play(engine, P1, id("mr"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("top")].zone, "hand");
  });
});

describe("Open Beta — Mephitic Nullifier", () => {
  test("FLASH-BANG destroys itself to bounce a character you control", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mn", def: def("Mephitic Nullifier"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" }
      ]
    });
    activate(engine, P1, id("mn"), "mephitic-nullifier-flash-bang", { selected: { target: [id("c")] } });
    assert.equal(engine.state.cards[id("c")].zone, "hand");
    assert.equal(engine.state.cards[id("mn")].zone, "discard");
  });
});

describe("Open Beta — Micromajig Avalanche", () => {
  test("pays X+X to put X Micromajig tokens into play", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "ma", def: def("Micromajig Avalanche"), owner: P1, zone: "hand" }, ...bank("elitism", 8, P1)]
    });
    play(engine, P1, id("ma"), { variables: { x: 2 } });
    const micros = Object.values(engine.state.cards).filter(
      c => c.zone === "play" && c.controllerId === P1 && engine.getDefinition(c.id).name === "Micromajig"
    );
    assert.equal(micros.length, 2);
  });
});

describe("Open Beta — Micromajig Factory", () => {
  test("WIND UP pays 4 to put a Micromajig token into play", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mf", def: def("Micromajig Factory"), owner: P1, zone: "play" },
        ...bank("elitism", 6, P1)
      ]
    });
    activate(engine, P1, id("mf"), "windup");
    const micros = Object.values(engine.state.cards).filter(
      c => c.zone === "play" && c.controllerId === P1 && engine.getDefinition(c.id).name === "Micromajig"
    );
    assert.equal(micros.length, 1);
  });
});

describe("Open Beta — Micromajig Maker", () => {
  test("ETB may put a Micromajig token into play", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "mm", def: def("Micromajig Maker"), owner: P1, zone: "hand" }, ...bank("elitism", 4, P1)]
    });
    play(engine, P1, id("mm"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 1 } : declineAll(pc)
    );
    const micros = Object.values(engine.state.cards).filter(
      c => c.zone === "play" && c.controllerId === P1 && engine.getDefinition(c.id).name === "Micromajig"
    );
    assert.equal(micros.length, 1);
  });
});

describe("Open Beta — Micromajig Master", () => {
  test("ETB may put 2 Micromajig tokens into play", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "mm", def: def("Micromajig Master"), owner: P1, zone: "hand" }, ...bank("elitism", 4, P1)]
    });
    play(engine, P1, id("mm"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 1 } : declineAll(pc)
    );
    const micros = Object.values(engine.state.cards).filter(
      c => c.zone === "play" && c.controllerId === P1 && engine.getDefinition(c.id).name === "Micromajig"
    );
    assert.equal(micros.length, 2);
  });
});

describe("Open Beta — Napiform Protuberance", () => {
  test("the attached character loses 1/1/1 per token on this card", () => {
    const host = character({ name: "Host", strength: 4, life: 4, speed: 4 });
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: host, owner: P1, zone: "play" },
        { key: "np", def: def("Napiform Protuberance"), owner: P1, zone: "play", attachedToKey: "host", counters: { token: 2 } }
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), (host.strength ?? 0) - 2);
    assert.equal(engine.getStat(id("host"), "speed"), (host.speed ?? 0) - 2);
  });
});

describe("Open Beta — Nasty Butler", () => {
  test("ETB gives your faction 4 influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "nb", def: def("Nasty Butler"), owner: P1, zone: "hand" }, ...bank("greed", 6, P1)]
    });
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("nb"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.players[P1].influence, inf + 4);
  });
});

describe("Open Beta — Nearby Serpent", () => {
  test("has COVERT", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "ns", def: def("Nearby Serpent"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getKeywords(id("ns")).includes("covert"));
  });
});

describe("Open Beta — Necromorph Bureaucrat", () => {
  test("SUBJUGATE depletes up to 2 chosen characters", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "nb", def: def("Necromorph Bureaucrat"), owner: P1, zone: "play" },
        { key: "oc1", def: character({ name: "OC1" }), owner: P2, zone: "play" },
        { key: "oc2", def: character({ name: "OC2" }), owner: P2, zone: "play" }
      ]
    });
    activate(engine, P1, id("nb"), "subjugate", { selected: { cs: [id("oc1"), id("oc2")] } });
    assert.equal(engine.state.cards[id("oc1")].depleted, true);
    assert.equal(engine.state.cards[id("oc2")].depleted, true);
  });
});

// =====================================================================
// N – R
// =====================================================================

describe("Open Beta — Ominous Oozling", () => {
  test("has COVERT", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "oo", def: def("Ominous Oozling"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getKeywords(id("oo")).includes("covert"));
  });
});

describe("Open Beta — One-Legged Hopping Pogo-Bear", () => {
  test("RAAR! makes it a 3/3/3 character this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pb", def: def("One-Legged Hopping Pogo-Bear"), owner: P1, zone: "play" },
        ...bank("elitism", 4, P1)
      ]
    });
    activate(engine, P1, id("pb"), "raar");
    assert.equal(engine.getStat(id("pb"), "strength"), 3);
  });
});

describe("Open Beta — Paralegal Prodigy", () => {
  test("your other lawyer characters gain +1/+1", () => {
    const law = character({ name: "Law", strength: 2, life: 2, subtype: ["lawyer"] });
    const { engine, id } = buildGame({
      cards: [
        { key: "pp", def: def("Paralegal Prodigy"), owner: P1, zone: "play" },
        { key: "law", def: law, owner: P1, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("law"), "strength"), (law.strength ?? 0) + 1);
    assert.equal(engine.getStat(id("law"), "life"), (law.life ?? 0) + 1);
  });
});

describe("Open Beta — Pettifogger", () => {
  test("when it blocks, it and the whole attacking party are destroyed", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pf", def: def("Pettifogger"), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 2, life: 5, speed: 3 }), owner: P2, zone: "play" }
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("pf")] });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("pf")].zone, "discard");
    assert.equal(engine.state.cards[id("atk")].zone, "discard");
  });
});

describe("Open Beta — Pillaging Pirate", () => {
  test("ETB mills an opponent 2", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pp", def: def("Pillaging Pirate"), owner: P1, zone: "hand" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `o${i}`, def: character({ name: `O${i}` }), owner: P2, zone: "deck" as const })),
        ...bank("deception", 4, P1)
      ]
    });
    const disc = engine.state.players[P2].discard.length;
    play(engine, P1, id("pp"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.players[P2].discard.length, disc + 2);
  });
});

describe("Open Beta — Pluck", () => {
  test("GRIFT reanimates a non-tactic from an opponent's discard under your control", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pl", def: def("Pluck"), owner: P1, zone: "play" },
        { key: "corpse", def: character({ name: "Corpse" }), owner: P2, zone: "discard" },
        ...bank("deception", 8, P1)
      ]
    });
    activate(engine, P1, id("pl"), "grift", { selected: { c: [id("corpse")] } });
    assert.equal(engine.state.cards[id("corpse")].zone, "play");
    assert.equal(engine.state.cards[id("corpse")].controllerId, P1);
  });
});

describe("Open Beta — Postmortem Debenture", () => {
  test("returns a character from your discard to your hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pd", def: def("Postmortem Debenture"), owner: P1, zone: "hand" },
        { key: "corpse", def: character({ name: "Corpse" }), owner: P1, zone: "discard" },
        ...bank("greed", 2, P1)
      ]
    });
    play(engine, P1, id("pd"), { selected: { c: [id("corpse")] } });
    assert.equal(engine.state.cards[id("corpse")].zone, "hand");
  });
});

describe("Open Beta — Precise Sabotage", () => {
  test("destroys a chosen item", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ps", def: def("Precise Sabotage"), owner: P1, zone: "hand" },
        { key: "it", def: item({ name: "It" }), owner: P2, zone: "play" },
        ...bank("elitism", 4, P1)
      ]
    });
    play(engine, P1, id("ps"), { selected: { i: [id("it")] } });
    assert.equal(engine.state.cards[id("it")].zone, "discard");
  });
});

describe("Open Beta — Pyramid Scheme", () => {
  test("draws 2 or 3 cards on a coin flip", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ps", def: def("Pyramid Scheme"), owner: P1, zone: "hand" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("greed", 6, P1)
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    play(engine, P1, id("ps"), {});
    assert.ok(engine.state.players[P1].hand.length - (hand - 1) >= 2);
  });
});

describe("Open Beta — Quotidian Assassination", () => {
  test("returns a chosen character to its owner's hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "qa", def: def("Quotidian Assassination"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" },
        ...bank("obsession", 4, P1)
      ]
    });
    play(engine, P1, id("qa"), { selected: { target: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].zone, "hand");
  });
});

describe("Open Beta — Quotidian Ejector", () => {
  test("EJECT removes 2 tokens to bounce a non-resource card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "qe", def: def("Quotidian Ejector"), owner: P1, zone: "play", counters: { token: 2 } },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" }
      ]
    });
    activate(engine, P1, id("qe"), "quotidian-ejector-eject", { selected: { target: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].zone, "hand");
    assert.equal(engine.state.cards[id("qe")].counters?.token ?? 0, 0);
  });
});

describe("Open Beta — Quotidian Misfire", () => {
  test("this turn, cards headed to a hand go to the discard pile instead", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "qm", def: def("Quotidian Misfire"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" },
        { key: "bounce", def: tactic({ name: "Bounce", cost: 0, behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] } }), owner: P1, zone: "hand" },
        ...bank("obsession", 4, P1)
      ]
    });
    play(engine, P1, id("qm"), {});
    play(engine, P1, id("bounce"), { selected: { t: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].zone, "discard");
  });
});

describe("Open Beta — Rabid Sarume", () => {
  test("ETB inflicts 1 damage to all of an opponent's characters", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rs", def: def("Rabid Sarume"), owner: P1, zone: "hand" },
        { key: "o1", def: character({ name: "O1", life: 4 }), owner: P2, zone: "play" },
        { key: "o2", def: character({ name: "O2", life: 4 }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("rs"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("o1")].damage, 1);
    assert.equal(engine.state.cards[id("o2")].damage, 1);
  });
});

describe("Open Beta — Raging Bask", () => {
  test("has REDIRECT DAMAGE", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "rb", def: def("Raging Bask"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getKeywords(id("rb")).includes("redirectDamage"));
  });
});

describe("Open Beta — Rapine", () => {
  test("sacrifices a card you control to take control of a character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rp", def: def("Rapine"), owner: P1, zone: "hand" },
        { key: "sac", def: character({ name: "Sac" }), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" },
        ...bank("deception", 6, P1)
      ]
    });
    play(engine, P1, id("rp"), { selected: { sac: [id("sac")], c: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].controllerId, P1);
    assert.equal(engine.state.cards[id("sac")].zone, "discard");
  });
});

describe("Open Beta — Rate Hike", () => {
  test("gives your faction 2 influence and draws", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rh", def: def("Rate Hike"), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("greed", 4, P1)
      ]
    });
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("rh"), {});
    assert.equal(engine.state.players[P1].influence, inf + 2);
  });
});

describe("Open Beta — Ravenous Wolf", () => {
  test("has COVERT and TACTICAL", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "rw", def: def("Ravenous Wolf"), owner: P1, zone: "play" }]
    });
    const k = engine.getKeywords(id("rw"));
    assert.ok(k.includes("covert"));
    assert.ok(k.includes("tactical"));
  });
});

describe("Open Beta — Reckless Challenger", () => {
  test("is destroyed at the end of your turn if it did not attack", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "rc", def: def("Reckless Challenger"), owner: P1, zone: "play" }],
      turn: 2
    });
    engine.perform({ type: "endTurn", playerId: P1 });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("rc")].zone, "discard");
  });
});

describe("Open Beta — Recondite Hunter", () => {
  test("is COVERT; loses COVERT this turn when it attacks", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "rh", def: def("Recondite Hunter"), owner: P1, zone: "play" }],
      turn: 2
    });
    assert.ok(engine.getKeywords(id("rh")).includes("covert"));
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("rh")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    assert.equal(engine.getKeywords(id("rh")).includes("covert"), false);
  });
});

describe("Open Beta — Red Raven", () => {
  test("gains +1/+1 per token on it", () => {
    const d = def("Red Raven");
    const { engine, id } = buildGame({
      cards: [{ key: "rr", def: d, owner: P1, zone: "play", counters: { token: 2 } }]
    });
    assert.equal(engine.getStat(id("rr"), "strength"), (d.strength ?? 0) + 2);
    assert.equal(engine.getStat(id("rr"), "life"), (d.life ?? 0) + 2);
  });
});

describe("Open Beta — Red Tape", () => {
  test("a character loses 3 strength this turn and you draw", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rt", def: def("Red Tape"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", strength: 5 }), owner: P2, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("greed", 4, P1)
      ]
    });
    play(engine, P1, id("rt"), { selected: { c: [id("oc")] } });
    assert.equal(engine.getStat(id("oc"), "strength"), 5 - 3);
  });
});

describe("Open Beta — Remember", () => {
  test("returns a tactic from your discard to your hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "r", def: def("Remember"), owner: P1, zone: "hand" },
        { key: "tac", def: tactic({ name: "Tac" }), owner: P1, zone: "discard" },
        ...bank("obsession", 4, P1)
      ]
    });
    play(engine, P1, id("r"), { selected: { target: [id("tac")] } });
    assert.equal(engine.state.cards[id("tac")].zone, "hand");
  });
});

describe("Open Beta — Repo Man", () => {
  test("ETB may destroy a location", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rm", def: def("Repo Man"), owner: P1, zone: "hand" },
        { key: "loc", def: location({ name: "Loc", structure: 4 }), owner: P2, zone: "play" },
        ...bank("greed", 6, P1)
      ]
    });
    play(engine, P1, id("rm"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("loc")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("loc")].zone, "discard");
  });
});

describe("Open Beta — Research Assistant", () => {
  test("RESEARCH depletes it", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "ra", def: def("Research Assistant"), owner: P1, zone: "play" }]
    });
    activate(engine, P1, id("ra"), "research");
    assert.equal(engine.state.cards[id("ra")].depleted, true);
  });
});

describe("Open Beta — Research Investment", () => {
  test("each player may put up to 3 staple resources from deck into play", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ri", def: def("Research Investment"), owner: P1, zone: "hand" },
        { key: "r1", def: resourceCard({ name: "Rage", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "deck" },
        { key: "r2", def: resourceCard({ name: "Greed", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "deck" },
        ...bank("elitism", 4, P1)
      ]
    });
    play(engine, P1, id("ri"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" && pc.playerId === P1
        ? { kind: "chooserSelectsTarget", selected: [id("r1"), id("r2")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("r1")].zone, "play");
    assert.equal(engine.state.cards[id("r2")].zone, "play");
  });
});

describe("Open Beta — Resurrection Technician", () => {
  test("ETB may return a character from your discard to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rt", def: def("Resurrection Technician"), owner: P1, zone: "hand" },
        { key: "corpse", def: character({ name: "Corpse" }), owner: P1, zone: "discard" },
        ...bank("greed", 6, P1)
      ]
    });
    play(engine, P1, id("rt"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("corpse")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("corpse")].zone, "hand");
  });
});

describe("Open Beta — Reveille Tower", () => {
  test("all your characters gain 1 strength", () => {
    const c = character({ name: "C", strength: 2 });
    const { engine, id } = buildGame({
      cards: [
        { key: "rt", def: def("Reveille Tower"), owner: P1, zone: "play" },
        { key: "c", def: c, owner: P1, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("c"), "strength"), (c.strength ?? 0) + 1);
  });
});

describe("Open Beta — Ritual of the Screaming Cheese", () => {
  test("an opponent discards at least one card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rsc", def: def("Ritual of the Screaming Cheese"), owner: P1, zone: "hand" },
        { key: "oh1", def: character({ name: "OH1" }), owner: P2, zone: "hand" },
        { key: "oh2", def: character({ name: "OH2" }), owner: P2, zone: "hand" },
        ...bank("obsession", 4, P1)
      ]
    });
    const disc = engine.state.players[P2].discard.length;
    play(engine, P1, id("rsc"), {});
    drain(engine, pc => {
      if (pc.kind === "chooserSelectsOption") return { kind: "chooserSelectsOption", index: 1 };
      if (pc.kind === "chooserSelectsTarget" && pc.playerId === P2) return { kind: "chooserSelectsTarget", selected: [id("oh1")] };
      return declineAll(pc);
    });
    assert.ok(engine.state.players[P2].discard.length - disc >= 1);
  });
});

describe("Open Beta — Ritual of the Shattering Teeth", () => {
  test("pays X+X to make an opponent discard up to X chosen cards", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rst", def: def("Ritual of the Shattering Teeth"), owner: P1, zone: "hand" },
        { key: "oh", def: character({ name: "OH" }), owner: P2, zone: "hand" },
        ...bank("obsession", 6, P1)
      ]
    });
    play(engine, P1, id("rst"), { variables: { x: 1 } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("oh")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("oh")].zone, "discard");
  });
});

describe("Open Beta — Rocket Boots", () => {
  test("grants +1 strength and +1 speed to the attached character", () => {
    const host = character({ name: "Host", strength: 2, speed: 3 });
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: host, owner: P1, zone: "play" },
        { key: "rb", def: def("Rocket Boots"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), (host.strength ?? 0) + 1);
    assert.equal(engine.getStat(id("host"), "speed"), (host.speed ?? 0) + 1);
  });
});

describe("Open Beta — Rudimentary Lathe", () => {
  test("reduces the numeric cost of items you deploy by 1", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rl", def: def("Rudimentary Lathe"), owner: P1, zone: "play" },
        { key: "it", def: item({ name: "It", cost: 3 }), owner: P1, zone: "hand" },
        ...bank("elitism", 2, P1)
      ]
    });
    play(engine, P1, id("it"), {});
    assert.equal(engine.state.cards[id("it")].zone, "play");
  });
});

describe("Open Beta — Rudo Mangod", () => {
  test("PUNCH trades damage between it and a chosen character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rm", def: def("Rudo Mangod"), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC", strength: 2, life: 9 }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    activate(engine, P1, id("rm"), "punch", { selected: { c: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].damage, def("Rudo Mangod").strength ?? 0);
    assert.equal(engine.state.cards[id("rm")].damage, 2);
  });
});

describe("Open Beta — Runic Cannon", () => {
  test("FIRE inflicts damage equal to its tokens, then clears them", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rc", def: def("Runic Cannon"), owner: P1, zone: "play", counters: { token: 3 } },
        { key: "oc", def: character({ name: "OC", life: 9 }), owner: P2, zone: "play" }
      ]
    });
    activate(engine, P1, id("rc"), "fire", { selected: { c: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].damage, 3);
    assert.equal(engine.state.cards[id("rc")].counters?.token ?? 0, 0);
  });
});

describe("Open Beta — Runic Circuitry", () => {
  test("CONSTRUCT removes a token", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rc", def: def("Runic Circuitry"), owner: P1, zone: "play", counters: { token: 2 } },
        ...bank("elitism", 6, P1)
      ]
    });
    activate(engine, P1, id("rc"), "construct");
    assert.equal(engine.state.cards[id("rc")].counters?.token, 1);
    assert.equal(engine.state.cards[id("rc")].depleted, true);
  });
});

// =====================================================================
// S – Z
// =====================================================================

describe("Open Beta — Sarcophyle Matriculation", () => {
  test("takes control of the picked character if it would be destroyed in the battle", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sm", def: def("Sarcophyle Matriculation"), owner: P1, zone: "hand" },
        { key: "blk", def: character({ name: "Blk", strength: 5, life: 5, speed: 1 }), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 2, life: 2, speed: 3 }), owner: P2, zone: "play" },
        ...bank("deception", 6, P1)
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    engine.perform({ type: "passPriority", playerId: P2 });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("sm"), selected: { c: [id("atk")] } } as never);
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("blk")] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("atk")].controllerId, P1);
  });
});

describe("Open Beta — Scavengemajig", () => {
  test("ETB may return an item from your discard to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sm", def: def("Scavengemajig"), owner: P1, zone: "hand" },
        { key: "tool", def: item({ name: "Tool" }), owner: P1, zone: "discard" },
        ...bank("elitism", 6, P1)
      ]
    });
    play(engine, P1, id("sm"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("tool")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("tool")].zone, "hand");
  });
});

describe("Open Beta — Scrag", () => {
  test("destroys a character whose controller's discard is at least as large as its life", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sc", def: def("Scrag"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", life: 2 }), owner: P2, zone: "play" },
        ...Array.from({ length: 3 }, (_, i) => ({ key: `g${i}`, def: character({ name: `G${i}` }), owner: P2, zone: "discard" as const })),
        ...bank("deception", 4, P1)
      ]
    });
    play(engine, P1, id("sc"), { selected: { c: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].zone, "discard");
  });
});

describe("Open Beta — Secret Handshake", () => {
  test("gives a character +4 life this turn and draws", () => {
    const c = character({ name: "C", life: 2 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sh", def: def("Secret Handshake"), owner: P1, zone: "hand" },
        { key: "c", def: c, owner: P1, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("greed", 4, P1)
      ]
    });
    play(engine, P1, id("sh"), { selected: { c: [id("c")] } });
    assert.equal(engine.getStat(id("c"), "life"), (c.life ?? 0) + 4);
  });
});

describe("Open Beta — Securitymajig", () => {
  test("can block COVERT parties", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "sm", def: def("Securitymajig"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getKeywords(id("sm")).includes("canBlockCovert"));
  });
});

describe("Open Beta — Selective Gluttony", () => {
  test("draws 10 and discards 9 (net +1)", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sg", def: def("Selective Gluttony"), owner: P1, zone: "hand" },
        ...Array.from({ length: 12 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("greed", 6, P1)
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    play(engine, P1, id("sg"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: engine.state.players[P1].hand.slice(0, 9) }
        : declineAll(pc)
    );
    assert.equal(engine.state.players[P1].hand.length, hand - 1 + 10 - 9);
  });
});

describe("Open Beta — Servile Centipede", () => {
  test("ETB may tutor a tactic into hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sc", def: def("Servile Centipede"), owner: P1, zone: "hand" },
        { key: "tac", def: tactic({ name: "Tac" }), owner: P1, zone: "deck" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("obsession", 4, P1)
      ]
    });
    play(engine, P1, id("sc"), {});
    drain(engine, pc =>
      pc.kind === "selectTargets" ? { kind: "selectTargets", selected: { target: [id("tac")] } } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("tac")].zone, "hand");
  });
});

describe("Open Beta — Shocking Reappearance", () => {
  test("reanimates a discard character into your blocking party", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sr", def: def("Shocking Reappearance"), owner: P1, zone: "hand" },
        { key: "corpse", def: character({ name: "Corpse" }), owner: P1, zone: "discard" },
        { key: "atk", def: character({ name: "Atk", strength: 2, life: 5, speed: 3 }), owner: P2, zone: "play" },
        ...bank("greed", 8, P1)
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    engine.perform({ type: "passPriority", playerId: P2 });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("sr"), selected: { c: [id("corpse")] } } as never);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("corpse")].zone, "play");
    assert.equal(engine.state.cards[id("corpse")].controllerId, P1);
  });
});

describe("Open Beta — Shriever Attack", () => {
  test("inflicts 2 damage to all characters", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sa", def: def("Shriever Attack"), owner: P1, zone: "hand" },
        { key: "m1", def: character({ name: "M1", life: 5 }), owner: P1, zone: "play" },
        { key: "o1", def: character({ name: "O1", life: 5 }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("sa"), {});
    assert.equal(engine.state.cards[id("m1")].damage, 2);
    assert.equal(engine.state.cards[id("o1")].damage, 2);
  });
});

describe("Open Beta — Siege Machine", () => {
  test("BATTERING RAM destroys a resource to cost an opponent's faction 1 influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sm", def: def("Siege Machine"), owner: P1, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    const res = Object.values(engine.state.cards).find(
      c => c.controllerId === P1 && engine.getDefinition(c.id).type === "resource"
    )!;
    const inf = engine.state.players[P2].influence;
    activate(engine, P1, id("sm"), "ram", { selected: { r: [res.id] } });
    assert.equal(engine.state.players[P2].influence, inf - 1);
    assert.equal(engine.state.cards[res.id].zone, "discard");
  });
});

describe("Open Beta — Skewer", () => {
  test("pays X+X to inflict X damage to a character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sk", def: def("Skewer"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", life: 5 }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("sk"), { variables: { x: 2 }, selected: { target: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].damage, 2);
  });
});

describe("Open Beta — Skilled Negotiator", () => {
  test("HAGGLE gives a character -2 strength this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sn", def: def("Skilled Negotiator"), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC", strength: 5 }), owner: P2, zone: "play" }
      ]
    });
    activate(engine, P1, id("sn"), "skilled-negotiator-haggle", { selected: { target: [id("oc")] } });
    assert.equal(engine.getStat(id("oc"), "strength"), 5 - 2);
  });
});

describe("Open Beta — Skimping Ecto-Manipulator", () => {
  test("ENERGIZE puts a token on a non-resource card you control", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "se", def: def("Skimping Ecto-Manipulator"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" }
      ]
    });
    activate(engine, P1, id("se"), "energize", { selected: { c: [id("c")] } });
    assert.equal(engine.state.cards[id("c")].counters?.token, 1);
  });
});

describe("Open Beta — Sleeping Guard", () => {
  test("gains +1/+1 while an opponent controls a character", () => {
    const d = def("Sleeping Guard");
    const { engine, id } = buildGame({
      cards: [
        { key: "sg", def: d, owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("sg"), "strength"), (d.strength ?? 0) + 1);
  });
});

describe("Open Beta — Slingerang", () => {
  test("enters play with 3 tokens", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "sl", def: def("Slingerang"), owner: P1, zone: "hand" }, ...bank("elitism", 4, P1)]
    });
    play(engine, P1, id("sl"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("sl")].counters?.token, 3);
  });
});

describe("Open Beta — Snake Eyes", () => {
  test("destroys a character that has been damaged this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "se", def: def("Snake Eyes"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", life: 5 }), owner: P2, zone: "play" },
        { key: "zap", def: killTactic({ name: "Zap", behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }] }] } }), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("deception", 6, P1)
      ]
    });
    play(engine, P1, id("zap"), { selected: { t: [id("oc")] } });
    play(engine, P1, id("se"), { selected: { c: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].zone, "discard");
  });
});

describe("Open Beta — Sneaking Spitspider", () => {
  test("has COVERT", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "ss", def: def("Sneaking Spitspider"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getKeywords(id("ss")).includes("covert"));
  });
});

describe("Open Beta — Spastic Tentacles", () => {
  test("ETB makes each player bounce a resource", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "st", def: def("Spastic Tentacles"), owner: P1, zone: "hand" },
        ...bank("obsession", 6, P1),
        ...bank("rage", 2, P2)
      ]
    });
    play(engine, P1, id("st"), {});
    drain(engine, pc => {
      if (pc.kind === "chooserSelectsTarget") {
        const own = engine.state.players[pc.playerId as "p1" | "p2"];
        const res = own.play.find(cid => engine.getDefinition(cid).type === "resource");
        return { kind: "chooserSelectsTarget", selected: res ? [res] : [] };
      }
      return declineAll(pc);
    });
    const p2res = engine.state.players[P2].hand.filter(cid => engine.getDefinition(cid).type === "resource");
    assert.equal(p2res.length, 1);
  });
});

describe("Open Beta — Spontaneous Displacement", () => {
  test("returns a non-resource card to its owner's hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sd", def: def("Spontaneous Displacement"), owner: P1, zone: "hand" },
        { key: "mine", def: character({ name: "Mine", cost: 4 }), owner: P1, zone: "play" },
        ...bank("obsession", 6, P1)
      ]
    });
    play(engine, P1, id("sd"), { selected: { bounced: [id("mine")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("mine")].zone, "hand");
  });
});

describe("Open Beta — Stolen Inspiration", () => {
  test("makes an opponent discard a chosen non-resource card from hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "si", def: def("Stolen Inspiration"), owner: P1, zone: "hand" },
        { key: "oh", def: character({ name: "OH", cost: 4 }), owner: P2, zone: "hand" },
        ...bank("obsession", 6, P1)
      ]
    });
    play(engine, P1, id("si"), { selected: { discarded: [id("oh")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("oh")].zone, "discard");
  });
});

describe("Open Beta — Strength In Numbers", () => {
  test("all attackers gain X/X where X is the attacking party size", () => {
    const a1 = character({ name: "A1", strength: 1, life: 3, speed: 3 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sin", def: def("Strength In Numbers"), owner: P1, zone: "hand" },
        { key: "a1", def: a1, owner: P1, zone: "play" },
        { key: "a2", def: character({ name: "A2", strength: 1, life: 3, speed: 3 }), owner: P1, zone: "play" },
        ...bank("rage", 6, P1)
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("a1"), id("a2")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("sin"), selected: {} } as never);
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("a1"), "strength"), (a1.strength ?? 0) + 2);
  });
});

describe("Open Beta — Sudden Osprey", () => {
  test("has TACTICAL; ETB may give a character +1/+1 this turn", () => {
    const c = character({ name: "C", strength: 2 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "so", def: def("Sudden Osprey"), owner: P1, zone: "hand" },
        { key: "c", def: c, owner: P1, zone: "play" },
        ...bank("deception", 4, P1)
      ]
    });
    assert.ok(def("Sudden Osprey").behavior?.keywords?.includes("tactical"));
    play(engine, P1, id("so"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("c")] } : declineAll(pc)
    );
    assert.equal(engine.getStat(id("c"), "strength"), (c.strength ?? 0) + 1);
  });
});

describe("Open Beta — Summary Judgment", () => {
  test("if the opponent declines to destroy their character, you draw its strength in cards", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sj", def: def("Summary Judgment"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", strength: 3 }), owner: P2, zone: "play" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("greed", 6, P1)
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    play(engine, P1, id("sj"), { selected: { c: [id("oc")] } });
    drain(engine, pc => (pc.kind === "mayPay" ? { kind: "mayPay", pay: false } : declineAll(pc)));
    assert.equal(engine.state.players[P1].hand.length, hand - 1 + 3);
  });
});

describe("Open Beta — Swarm of Gnats", () => {
  test("ETB makes an opponent discard a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sg", def: def("Swarm of Gnats"), owner: P1, zone: "hand" },
        { key: "oh", def: character({ name: "OH" }), owner: P2, zone: "hand" },
        ...bank("obsession", 6, P1)
      ]
    });
    const disc = engine.state.players[P2].discard.length;
    play(engine, P1, id("sg"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" && pc.playerId === P2
        ? { kind: "chooserSelectsTarget", selected: [id("oh")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.players[P2].discard.length, disc + 1);
  });
});

describe("Open Beta — Swashbuckler", () => {
  test("ETB removes 4 opponent discard cards from the game and survives", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sb", def: def("Swashbuckler"), owner: P1, zone: "hand" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `g${i}`, def: character({ name: `G${i}` }), owner: P2, zone: "discard" as const })),
        ...bank("deception", 6, P1)
      ]
    });
    play(engine, P1, id("sb"), {});
    drain(engine, pc => {
      if (pc.kind === "chooserSelectsOption") return { kind: "chooserSelectsOption", index: 0 };
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [id("g0"), id("g1"), id("g2"), id("g3")] };
      return declineAll(pc);
    });
    assert.equal(engine.state.cards[id("sb")].zone, "play");
    assert.equal(engine.state.cards[id("g0")].zone, "removed");
  });
});

describe("Open Beta — Tactician Vacation", () => {
  test("this turn, no more tactics can be deployed", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "tv", def: def("Tactician Vacation"), owner: P1, zone: "hand" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" },
        ...bank("rage", 8, P1)
      ],
      turn: 2
    });
    play(engine, P1, id("tv"), {});
    drain(engine, declineAll);
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("kill"), selected: { t: [id("c")] } } as never)
    );
  });
});

describe("Open Beta — Target Practice", () => {
  test("inflicts 2 damage to a chosen character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "tp", def: def("Target Practice"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", life: 5 }), owner: P2, zone: "play" },
        ...bank("rage", 4, P1)
      ]
    });
    play(engine, P1, id("tp"), { selected: { target: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].damage, 2);
  });
});

describe("Open Beta — Tax Attorney", () => {
  test("reduces influence your faction loses by 1", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ta", def: def("Tax Attorney"), owner: P1, zone: "play" },
        { key: "bleed", def: tactic({ name: "Bleed", cost: 0, behavior: { abilities: [{ id: "b", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount: -3 }] }] } }), owner: P1, zone: "hand" }
      ]
    });
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("bleed"), {});
    assert.equal(engine.state.players[P1].influence, inf - 2);
  });
});

describe("Open Beta — The Billionaire", () => {
  test("CHANGE COSTUME shuffles it away and puts a differently-named pluck into play", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "tb", def: def("The Billionaire"), owner: P1, zone: "play" },
        { key: "other", def: character({ name: "OtherPluck", subtype: ["pluck"] }), owner: P1, zone: "deck" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("deception", 6, P1)
      ]
    });
    activate(engine, P1, id("tb"), "costume");
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("other")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("other")].zone, "play");
    assert.notEqual(engine.state.cards[id("tb")].zone, "play");
  });
});

describe("Open Beta — The Ministry of Other Smaller Ministries", () => {
  test("an opponent with no resources cannot afford to attack", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "min", def: def("The Ministry of Other Smaller Ministries"), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 2, life: 3, speed: 3 }), owner: P2, zone: "play" }
      ],
      activePlayerId: P2,
      turn: 2
    });
    assert.throws(() =>
      engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } })
    );
  });
});

describe("Open Beta — Thief Doyen", () => {
  test("discards a card as an EXTRA COST and enters with that card's cost in tokens", () => {
    const d = def("Thief Doyen");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "td", def: d, owner: P1, zone: "hand" },
        { key: "fuel", def: character({ name: "Fuel", cost: 3 }), owner: P1, zone: "hand" },
        ...bank("deception", 6, P1)
      ]
    });
    play(engine, P1, id("td"), { selected: { d: [id("fuel")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("td")].counters?.token, 3);
    assert.equal(engine.getStat(id("td"), "strength"), (d.strength ?? 0) + 3);
  });
});

describe("Open Beta — TigerKaiser", () => {
  test("TIGER ROAR gives a character +3 strength this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "tk", def: def("TigerKaiser"), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC", strength: 2 }), owner: P2, zone: "play" },
        ...bank("elitism", 4, P1)
      ]
    });
    activate(engine, P1, id("tk"), "roar", { selected: { c: [id("oc")] } });
    assert.equal(engine.getStat(id("oc"), "strength"), 2 + 3);
  });
});

describe("Open Beta — Towering Researchmajig", () => {
  test("RESEARCH removes a token", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "tr", def: def("Towering Researchmajig"), owner: P1, zone: "play", counters: { token: 1 } }]
    });
    activate(engine, P1, id("tr"), "research");
    assert.equal(engine.state.cards[id("tr")].counters?.token ?? 0, 0);
  });
});

describe("Open Beta — Tremor Engine", () => {
  test("at the start of your turn, each player mills 2", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "te", def: def("Tremor Engine"), owner: P1, zone: "play" },
        ...Array.from({ length: 5 }, (_, i) => ({ key: `a${i}`, def: character({ name: `A${i}` }), owner: P1, zone: "deck" as const })),
        ...Array.from({ length: 5 }, (_, i) => ({ key: `b${i}`, def: character({ name: `B${i}` }), owner: P2, zone: "deck" as const }))
      ],
      turn: 2,
      activePlayerId: P2
    });
    const deck = engine.state.players[P1].deck.length;
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.players[P1].deck.length, deck - 2);
  });
});

describe("Open Beta — Tri-Pole Magnet", () => {
  test("GRAPPLE destroys itself to put a discard-pile gear into play attached to a character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
        { key: "tpm", def: def("Tri-Pole Magnet"), owner: P1, zone: "play", attachedToKey: "host" },
        { key: "gear", def: item({ name: "Gear", subtype: ["gear"] }), owner: P1, zone: "discard" }
      ]
    });
    activate(engine, P1, id("tpm"), "grapple", { selected: { g: [id("gear")], host: [id("host")] } });
    assert.equal(engine.state.cards[id("gear")].zone, "play");
    assert.equal(engine.state.cards[id("gear")].attachedTo, id("host"));
    assert.equal(engine.state.cards[id("tpm")].zone, "discard");
  });
});

describe("Open Beta — Vander Malagut", () => {
  test("your other sarcophyle characters gain 1 speed", () => {
    const d = def("Vander Malagut");
    const sarco = character({ name: "Sarco", speed: 3, subtype: ["sarcophyle"] });
    const { engine, id } = buildGame({
      cards: [
        { key: "vm", def: d, owner: P1, zone: "play" },
        { key: "sarco", def: sarco, owner: P1, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("sarco"), "speed"), (sarco.speed ?? 0) + 1);
    assert.equal(engine.getStat(id("vm"), "speed"), d.speed ?? 0);
  });

  test("when destroyed, all other sarcophyle characters are destroyed", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "vm", def: def("Vander Malagut"), owner: P1, zone: "play" },
        { key: "sarco", def: character({ name: "Sarco", subtype: ["sarcophyle"] }), owner: P2, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("kill"), { selected: { t: [id("vm")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("sarco")].zone, "discard");
  });
});

describe("Open Beta — Very Big Hat of Invisibility", () => {
  test("the attached character gains COVERT", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
        { key: "hat", def: def("Very Big Hat of Invisibility"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.ok(engine.getKeywords(id("host")).includes("covert"));
  });
});

describe("Open Beta — Voidal Nullification Chamber", () => {
  test("ENERGIZE pays 2 to add a token", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "vnc", def: def("Voidal Nullification Chamber"), owner: P1, zone: "play" },
        ...bank("obsession", 4, P1)
      ]
    });
    activate(engine, P1, id("vnc"), "energize");
    assert.equal(engine.state.cards[id("vnc")].counters?.token, 1);
  });
});

describe("Open Beta — Voidal Observatory", () => {
  test("STUDY removes 3 tokens to draw a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "vo", def: def("Voidal Observatory"), owner: P1, zone: "play", counters: { token: 3 } },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" }
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    activate(engine, P1, id("vo"), "voidal-observatory-study");
    assert.equal(engine.state.players[P1].hand.length, hand + 1);
    assert.equal(engine.state.cards[id("vo")].counters?.token ?? 0, 0);
  });
});

describe("Open Beta — Voidal Perversion", () => {
  test("distributes up to 2 tokens across chosen non-resource cards and draws", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "vp", def: def("Voidal Perversion"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("obsession", 4, P1)
      ]
    });
    play(engine, P1, id("vp"), { selected: { picked: [id("c")] } });
    drain(engine, pc =>
      pc.kind === "distributeAmong" ? { kind: "distributeAmong", shares: { [id("c")]: 2 } } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("c")].counters?.token, 2);
  });
});

describe("Open Beta — Voidal Poisoning", () => {
  test("resolves its token-spending menu", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "vp", def: def("Voidal Poisoning"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play", counters: { token: 2 } },
        ...bank("obsession", 6, P1)
      ]
    });
    play(engine, P1, id("vp"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("vp")].zone, "discard");
  });
});

describe("Open Beta — Voidal Replication", () => {
  test("cannot be deployed unless a tactic was deployed this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "vr", def: def("Voidal Replication"), owner: P1, zone: "hand" }, ...bank("obsession", 6, P1)]
    });
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("vr"), selected: {} } as never)
    );
  });
});

describe("Open Beta — Voidal Webbing", () => {
  test("gives a character -1 speed this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "vw", def: def("Voidal Webbing"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", speed: 4 }), owner: P2, zone: "play" },
        ...bank("obsession", 4, P1)
      ]
    });
    play(engine, P1, id("vw"), { selected: { target: [id("oc")] } });
    assert.equal(engine.getStat(id("oc"), "speed"), 3);
  });
});

describe("Open Beta — Warehouse Raid", () => {
  test("an opponent discards at random", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "wr", def: def("Warehouse Raid"), owner: P1, zone: "hand" },
        { key: "oh1", def: character({ name: "OH1" }), owner: P2, zone: "hand" },
        { key: "oh2", def: character({ name: "OH2" }), owner: P2, zone: "hand" },
        ...bank("deception", 4, P1)
      ]
    });
    const handSize = engine.state.players[P2].hand.length;
    play(engine, P1, id("wr"), {});
    drain(engine, declineAll);
    assert.ok(engine.state.players[P2].hand.length < handSize);
  });
});

describe("Open Beta — Yoink!", () => {
  test("takes control of a gear card and attaches it to a chosen character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "y", def: def("Yoink!"), owner: P1, zone: "hand" },
        { key: "gear", def: item({ name: "Gear", subtype: ["gear"] }), owner: P2, zone: "play" },
        { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
        ...bank("deception", 4, P1)
      ]
    });
    play(engine, P1, id("y"), { selected: { g: [id("gear")], c: [id("mine")] } });
    assert.equal(engine.state.cards[id("gear")].controllerId, P1);
    assert.equal(engine.state.cards[id("gear")].attachedTo, id("mine"));
  });
});

describe("Open Beta — Zenobia's Spyglass", () => {
  test("FORESIGHT looks at the top X+X cards of your deck", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "zs", def: def("Zenobia's Spyglass"), owner: P1, zone: "play" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("obsession", 4, P1)
      ]
    });
    activate(engine, P1, id("zs"), "foresight", { variables: { x: 1 } });
    assert.equal(engine.state.pendingChoice?.kind, "reorderDeck");
    drain(engine, declineAll);
  });
});
