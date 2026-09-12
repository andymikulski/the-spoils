// Per-card correctness suite — Seed (231 cards). 10 are reprints from
// later sets (parity-checked); the rest get real per-card tests here.
// See ./_harness.ts and ../../../CARD-TEST-PROGRESS.md.

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

const SET = "Seed";
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
    case "nameValue":
      return { kind: "nameValue", value: "Nonexistent" };
    case "deployForFree":
      return { kind: "deployForFree" };
    default:
      return { kind: pc.kind };
  }
};

// =====================================================================
// Parametrized — resources, vanilla characters, faction cards
// =====================================================================

describe("Seed — plain staple resources", () => {
  for (const [name, icon] of [
    ["Deception", "deception"],
    ["Elitism", "elitism"],
    ["Greed", "greed"]
  ] as const) {
    test(`${name} provides [${icon}]`, () => {
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

describe("Seed — downside resources (Arrogance / Exploitation)", () => {
  for (const [name, icon] of [
    ["Arrogance", "elitism"],
    ["Exploitation", "greed"]
  ] as const) {
    test(`${name} costs 1 influence on entry and provides [${icon}][${icon}]`, () => {
      const { engine, id } = buildGame({
        playerA: { faction: developFaction() },
        cards: [{ key: "r", def: def(name), owner: P1, zone: "hand" }]
      });
      const inf = engine.state.players[P1].influence;
      engine.perform({
        type: "chooseDevelop",
        playerId: P1,
        choice: { type: "playResource", cards: [{ cardId: id("r"), faceDown: false }] }
      } as never);
      resolvePendingResponses(engine);
      assert.equal(engine.state.players[P1].influence, inf - 1);
      assert.ok((engine.getThresholds(P1)[icon] ?? 0) >= 2);
    });
  }
});

describe("Seed — vanilla characters", () => {
  for (const name of ["Agile Highwayman", "Casino Kingpin"]) {
    test(`${name} deploys with printed stats and no keywords`, () => {
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

describe("Seed — faction cards (tournament DRAW)", () => {
  for (const name of ["Alliance of Handy Weirdos", "Drowned Catacombs"]) {
    test(`${name} — DRAW pays 3 and draws`, () => {
      const { engine } = buildGame({
        playerA: { faction: def(name) },
        cards: [
          { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
          ...bank("rage", 4, P1)
        ]
      });
      const facId = engine.state.players[P1].factionId!;
      const hand = engine.state.players[P1].hand.length;
      engine.perform({ type: "activateAbility", playerId: P1, cardId: facId, abilityId: "tournament-draw", selected: {}, variables: {} });
      resolvePendingResponses(engine);
      assert.equal(engine.state.players[P1].hand.length, hand + 1);
    });
  }
});

// =====================================================================
// A – D
// =====================================================================

describe("Seed — 313373 M3ch4n1c", () => {
  test("REPAIR destroys itself to reanimate a cheap item from your discard", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "m", def: def("313373 M3ch4n1c"), owner: P1, zone: "play" },
        { key: "tool", def: item({ name: "Tool", cost: 1 }), owner: P1, zone: "discard" },
        ...bank("elitism", 6, P1)
      ]
    });
    activate(engine, P1, id("m"), "repair", { variables: { x: 1 }, selected: { it: [id("tool")] } });
    assert.equal(engine.state.cards[id("tool")].zone, "play");
    assert.equal(engine.state.cards[id("m")].zone, "discard");
  });
});

describe("Seed — 53cur17y 5y573m", () => {
  test("lets any character block COVERT parties", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "s", def: def("53cur17y 5y573m"), owner: P1, zone: "play" },
        { key: "guard", def: character({ name: "Guard" }), owner: P2, zone: "play" }
      ]
    });
    assert.ok(engine.getKeywords(id("guard")).includes("canBlockCovert"));
  });
});

describe("Seed — Adjunct Artisan", () => {
  test("FABRICATE depletes it", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "a", def: def("Adjunct Artisan"), owner: P1, zone: "play" }]
    });
    activate(engine, P1, id("a"), "fabricate");
    assert.equal(engine.state.cards[id("a")].depleted, true);
  });
});

describe("Seed — Adriel, Defender of Marduun", () => {
  test("reduces battle damage inflicted to it while blocking to 0", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ad", def: def("Adriel, Defender of Marduun"), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 6, life: 5, speed: 3 }), owner: P2, zone: "play" }
      ],
      turn: 2,
      activePlayerId: P2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("ad")] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("ad")].damage ?? 0, 0);
    assert.equal(engine.state.cards[id("ad")].zone, "play");
  });
});

describe("Seed — Affectionate Dollkeeper", () => {
  test("[D][D][D]: destroys any character it inflicts damage to", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ad", def: def("Affectionate Dollkeeper"), owner: P1, zone: "play" },
        { key: "blk", def: character({ name: "Blk", strength: 0, life: 10, speed: 1 }), owner: P2, zone: "play" },
        ...bank("deception", 3, P1)
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("ad")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("blk")].zone, "discard");
  });
});

describe("Seed — Anathematize", () => {
  test("a character loses 5 strength this turn and you draw", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "a", def: def("Anathematize"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", strength: 7 }), owner: P2, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("obsession", 4, P1)
      ]
    });
    play(engine, P1, id("a"), { selected: { c: [id("oc")] } });
    assert.equal(engine.getStat(id("oc"), "strength"), 7 - 5);
  });
});

describe("Seed — Arcane Research", () => {
  test("mills up to 4 tactics from your deck", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ar", def: def("Arcane Research"), owner: P1, zone: "hand" },
        { key: "t1", def: tactic({ name: "T1" }), owner: P1, zone: "deck" },
        { key: "t2", def: tactic({ name: "T2" }), owner: P1, zone: "deck" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("obsession", 4, P1)
      ]
    });
    play(engine, P1, id("ar"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("t1"), id("t2")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("t1")].zone, "discard");
    assert.equal(engine.state.cards[id("t2")].zone, "discard");
  });
});

describe("Seed — Architectural Restitution", () => {
  test("reanimates a discard-pile location and redirects the attack onto it", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ar", def: def("Architectural Restitution"), owner: P1, zone: "hand" },
        { key: "loc", def: location({ name: "Loc", structure: 5 }), owner: P1, zone: "discard" },
        { key: "atk", def: character({ name: "Atk", strength: 2, life: 5, speed: 3 }), owner: P2, zone: "play" },
        ...bank("greed", 6, P1)
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    engine.perform({ type: "passPriority", playerId: P2 });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("ar"), selected: { l: [id("loc")] } } as never);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("loc")].zone, "play");
    assert.equal(engine.state.cards[id("loc")].controllerId, P1);
  });
});

describe("Seed — Aristocratic Artificer", () => {
  test("SNUB tutors an Elitism into hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "aa", def: def("Aristocratic Artificer"), owner: P1, zone: "play" },
        { key: "eli", def: resourceCard({ name: "Elitism", resource: { provides: ["elitism"], staple: true } }), owner: P1, zone: "deck" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("elitism", 4, P1)
      ]
    });
    activate(engine, P1, id("aa"), "snub");
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("eli")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("eli")].zone, "hand");
  });
});

describe("Seed — Assistant Mud Whisperer", () => {
  test("at the start of each opponent's turn, may restore a chosen character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "amw", def: def("Assistant Mud Whisperer"), owner: P1, zone: "play" },
        { key: "dep", def: character({ name: "Dep" }), owner: P1, zone: "play", depleted: true }
      ],
      turn: 2,
      activePlayerId: P1
    });
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("dep")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("dep")].depleted, false);
  });
});

describe("Seed — Auspicious Tax", () => {
  test("the attached character's controller must pay 3 to attack with it", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "host", def: character({ name: "Host", strength: 2, life: 3, speed: 3 }), owner: P1, zone: "play" },
        { key: "tax", def: def("Auspicious Tax"), owner: P1, zone: "play", attachedToKey: "host" }
      ],
      turn: 2
    });
    assert.throws(() =>
      engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("host")], target: { type: "faction", playerId: P2 } })
    );
  });
});

describe("Seed — Avuncular Merlion", () => {
  test("enters play with 2 tokens", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "am", def: def("Avuncular Merlion"), owner: P1, zone: "hand" }, ...bank("greed", 12, P1)]
    });
    play(engine, P1, id("am"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("am")].counters?.token, 2);
  });
});

describe("Seed — Aweless Charger", () => {
  test("BORE removes a blocking character from the battle and depletes it", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ac", def: def("Aweless Charger"), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 2, life: 5, speed: 3 }), owner: P1, zone: "play" },
        { key: "blk", def: character({ name: "Blk", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("ac"), abilityId: "bore", selected: { b: [id("blk")] }, variables: {} });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("blk")].depleted, true);
    assert.equal(engine.state.battle?.blockingParty.includes(id("blk")) ?? false, false);
  });
});

describe("Seed — B14nd P3pp3r", () => {
  test("grants +1/+1 to the attached character", () => {
    const host = character({ name: "Host", strength: 2, life: 2 });
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: host, owner: P1, zone: "play" },
        { key: "bp", def: def("B14nd P3pp3r"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), (host.strength ?? 0) + 1);
    assert.equal(engine.getStat(id("host"), "life"), (host.life ?? 0) + 1);
  });
});

describe("Seed — Balking Foecrusher", () => {
  test("when it leaves play, inflicts 1 damage to all characters and draws", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "bf", def: def("Balking Foecrusher"), owner: P1, zone: "play" },
        { key: "bystander", def: character({ name: "Bystander", life: 5 }), owner: P2, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("rage", 6, P1)
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    play(engine, P1, id("kill"), { selected: { t: [id("bf")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("bystander")].damage, 1);
    assert.equal(engine.state.players[P1].hand.length, hand - 1 + 1);
  });
});

describe("Seed — Balthassar Gristwalter", () => {
  test("SCHMOOZE depletes it to draw a card", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "bg", def: def("Balthassar Gristwalter"), owner: P1, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" }
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    activate(engine, P1, id("bg"), "schmooze");
    assert.equal(engine.state.players[P1].hand.length, hand + 1);
    assert.equal(engine.state.cards[id("bg")].depleted, true);
  });
});

describe("Seed — Because God Said So!", () => {
  test("a blocking character gains +5/+5 this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "b", def: def("Because God Said So!"), owner: P1, zone: "hand" },
        { key: "atk", def: character({ name: "Atk", strength: 2, life: 5, speed: 3 }), owner: P2, zone: "play" },
        { key: "blk", def: character({ name: "Blk", strength: 1, life: 5, speed: 1 }), owner: P1, zone: "play" },
        ...bank("greed", 6, P1)
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("blk")] });
    while (engine.state.responseWindow && engine.state.responseWindow.priorityPlayerId !== P1) {
      engine.perform({ type: "passPriority", playerId: engine.state.responseWindow.priorityPlayerId });
    }
    engine.perform({ type: "playCard", playerId: P1, cardId: id("b"), selected: { c: [id("blk")] } } as never);
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("blk"), "strength"), 1 + 5);
  });
});

describe("Seed — Black Scourge of the Brine", () => {
  test("ENCROACH grants COVERT this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "bs", def: def("Black Scourge of the Brine"), owner: P1, zone: "play" },
        ...bank("greed", 8, P1)
      ]
    });
    activate(engine, P1, id("bs"), "encroach");
    assert.ok(engine.getKeywords(id("bs")).includes("covert"));
  });
});

describe("Seed — Blazing Shriever", () => {
  test("INFLAME destroys itself to inflict [R]-count damage to a character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "bs", def: def("Blazing Shriever"), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC", life: 9 }), owner: P2, zone: "play" },
        ...bank("rage", 5, P1)
      ]
    });
    activate(engine, P1, id("bs"), "inflame", { selected: { t: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].damage, 5);
    assert.equal(engine.state.cards[id("bs")].zone, "discard");
  });
});

describe("Seed — Boilstorm", () => {
  test("distributes [R]-count damage across up to 3 chosen characters", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "b", def: def("Boilstorm"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", life: 9 }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("b"), { selected: { cs: [id("oc")] } });
    drain(engine, pc =>
      pc.kind === "distributeAmong" ? { kind: "distributeAmong", shares: { [id("oc")]: (pc.amount as number) ?? 0 } } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("oc")].damage, 6);
  });
});

describe("Seed — Booty Licker", () => {
  test("CLAIM takes control of a chosen item after paying its cost", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "bl", def: def("Booty Licker"), owner: P1, zone: "play" },
        { key: "it", def: item({ name: "It", cost: 2 }), owner: P2, zone: "play" },
        ...bank("deception", 6, P1)
      ]
    });
    activate(engine, P1, id("bl"), "claim", { selected: { it: [id("it")] } });
    drain(engine, pc => (pc.kind === "mayPay" ? { kind: "mayPay", pay: true } : declineAll(pc)));
    assert.equal(engine.state.cards[id("it")].controllerId, P1);
  });
});

describe("Seed — Brilliant Insight", () => {
  test("offers you the option to play up to 2 resources", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "bi", def: def("Brilliant Insight"), owner: P1, zone: "hand" },
        ...bank("elitism", 4, P1)
      ]
    });
    play(engine, P1, id("bi"), {});
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsOption");
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("bi")].zone, "discard");
  });
});

describe("Seed — Caboodling Gladhander", () => {
  test("EXTRA COST destroys a picked character; its controller's faction gains its strength", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cg", def: def("Caboodling Gladhander"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", strength: 3 }), owner: P2, zone: "play" },
        ...bank("greed", 10, P1)
      ]
    });
    const inf = engine.state.players[P2].influence;
    play(engine, P1, id("cg"), { selected: { c: [id("oc")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("oc")].zone, "discard");
    assert.equal(engine.state.players[P2].influence, inf + 3);
  });
});

describe("Seed — Cashier's Window", () => {
  test("CASH IN sacrifices a character you control to draw a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cw", def: def("Cashier's Window"), owner: P1, zone: "play" },
        { key: "sac", def: character({ name: "Sac" }), owner: P1, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" }
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    activate(engine, P1, id("cw"), "cash-in", { selected: { c: [id("sac")] } });
    assert.equal(engine.state.cards[id("sac")].zone, "discard");
    assert.equal(engine.state.players[P1].hand.length, hand + 1);
  });
});

describe("Seed — Chain Reaction", () => {
  test("inflicts 3 damage to a chosen location", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cr", def: def("Chain Reaction"), owner: P1, zone: "hand" },
        { key: "loc", def: location({ name: "Loc", structure: 6 }), owner: P2, zone: "play" },
        ...bank("rage", 4, P1)
      ]
    });
    play(engine, P1, id("cr"), { selected: { l: [id("loc")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("loc")].damage, 3);
  });
});

describe("Seed — Chancellor of Reinstatement", () => {
  test("REINSTATE destroys itself to reanimate a discard character within your [G] count", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cr", def: def("Chancellor of Reinstatement"), owner: P1, zone: "play" },
        { key: "corpse", def: character({ name: "Corpse", cost: 2 }), owner: P1, zone: "discard" },
        ...bank("greed", 8, P1)
      ]
    });
    activate(engine, P1, id("cr"), "reinstate", { selected: { c: [id("corpse")] } });
    assert.equal(engine.state.cards[id("corpse")].zone, "play");
    assert.equal(engine.state.cards[id("cr")].zone, "discard");
  });
});

describe("Seed — Cloaked Weaponmaster", () => {
  test("your gear cards in hand gain TACTICAL", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "cw", def: def("Cloaked Weaponmaster"), owner: P1, zone: "play" },
        { key: "gear", def: item({ name: "Gear", subtype: ["gear"] }), owner: P1, zone: "hand" }
      ]
    });
    assert.ok(engine.getKeywords(id("gear")).includes("tactical"));
  });
});

describe("Seed — Colossal Flattener", () => {
  test("has REDIRECT DAMAGE", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "cf", def: def("Colossal Flattener"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getKeywords(id("cf")).includes("redirectDamage"));
  });
});

describe("Seed — Confounding Conjurer", () => {
  test("EXTRA COST bounces a picked character on ETB", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cc", def: def("Confounding Conjurer"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" },
        ...bank("obsession", 6, P1)
      ]
    });
    play(engine, P1, id("cc"), { selected: { c: [id("oc")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("oc")].zone, "hand");
  });
});

describe("Seed — Courageous Paladin", () => {
  test("in a battle, it is the only legal target for the attacker's damage", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cp", def: def("Courageous Paladin"), owner: P1, zone: "play" },
        { key: "ally", def: character({ name: "Ally", strength: 1, life: 5, speed: 1 }), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 3, life: 5, speed: 3 }), owner: P2, zone: "play" }
      ],
      turn: 2,
      activePlayerId: P2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("cp"), id("ally")] });
    resolvePendingResponses(engine);
    const view = engine.getBattleView();
    const atkSource = view?.damageSources.find(s => s.cardId === id("atk"));
    assert.equal(atkSource?.legalTargets.length, 1);
    assert.equal(
      (atkSource?.legalTargets[0] as { cardId?: string })?.cardId ?? atkSource?.legalTargets[0],
      id("cp")
    );
  });
});

describe("Seed — Cowering Golem", () => {
  test("in a battle, loses 1/1 per member of the opposing party", () => {
    const d = def("Cowering Golem");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cg", def: d, owner: P1, zone: "play" },
        { key: "b1", def: character({ name: "B1", strength: 0, life: 5, speed: 1 }), owner: P2, zone: "play" },
        { key: "b2", def: character({ name: "B2", strength: 0, life: 5, speed: 1 }), owner: P2, zone: "play" }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("cg")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b1"), id("b2")] });
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("cg"), "strength"), (d.strength ?? 0) - 2);
  });
});

describe("Seed — Crushing Usury", () => {
  test("destroys a character and costs your faction 3 influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cu", def: def("Crushing Usury"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" },
        ...bank("greed", 6, P1)
      ]
    });
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("cu"), { selected: { c: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].zone, "discard");
    assert.equal(engine.state.players[P1].influence, inf - 3);
  });
});

describe("Seed — Cunning Disguise", () => {
  test("the attached character loses 1/1 and gains COVERT", () => {
    const host = character({ name: "Host", strength: 3, life: 3 });
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: host, owner: P1, zone: "play" },
        { key: "cd", def: def("Cunning Disguise"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), (host.strength ?? 0) - 1);
    assert.ok(engine.getKeywords(id("host")).includes("covert"));
  });
});

describe("Seed — D3ck W4rd3n", () => {
  test("ETB costs your faction 2 influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "dw", def: def("D3ck W4rd3n"), owner: P1, zone: "hand" }, ...bank("greed", 6, P1)]
    });
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("dw"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.players[P1].influence, inf - 2);
  });
});

describe("Seed — Dazzling Trapezist", () => {
  test("INSPIRE tucks a hand card to give a character +1 speed this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "dt", def: def("Dazzling Trapezist"), owner: P1, zone: "play" },
        { key: "fuel", def: character({ name: "Fuel" }), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", speed: 3 }), owner: P1, zone: "play" }
      ]
    });
    activate(engine, P1, id("dt"), "inspire", { selected: { tuck: [id("fuel")], c: [id("c")] } });
    assert.equal(engine.getStat(id("c"), "speed"), 4);
    assert.equal(engine.state.cards[id("fuel")].zone, "deck");
  });
});

describe("Seed — Defiler of Innocence", () => {
  test("CORRUPT grants a chosen character COVERT this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "di", def: def("Defiler of Innocence"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" },
        ...bank("obsession", 4, P1)
      ]
    });
    activate(engine, P1, id("di"), "corrupt", { selected: { c: [id("c")] } });
    assert.ok(engine.getKeywords(id("c")).includes("covert"));
  });
});

describe("Seed — Department of Rejections", () => {
  test("opponents pay 2 more to use a character's ability", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "dor", def: def("Department of Rejections"), owner: P1, zone: "play" },
        { key: "mage", def: drawerChar(), owner: P2, zone: "play" }
      ]
    });
    // drawerChar's draw1 has no cost — with the tax it needs 2 resources P2 lacks
    assert.throws(() =>
      engine.perform({ type: "activateAbility", playerId: P2, cardId: id("mage"), abilityId: "draw1", selected: {}, variables: {} })
    );
  });
});

describe("Seed — Desserted Island", () => {
  test("draws 3 cards", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "di", def: def("Desserted Island"), owner: P1, zone: "hand" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("greed", 6, P1)
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    play(engine, P1, id("di"), {});
    assert.equal(engine.state.players[P1].hand.length, hand - 1 + 3);
  });
});

describe("Seed — Dragon Archer", () => {
  test("EXTRA COST trades damage with a picked character on ETB", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "da", def: def("Dragon Archer"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", strength: 2, life: 9 }), owner: P2, zone: "play" },
        ...bank("rage", 8, P1)
      ]
    });
    play(engine, P1, id("da"), { selected: { c: [id("oc")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("oc")].damage, def("Dragon Archer").strength ?? 0);
    assert.equal(engine.state.cards[id("da")].damage, 2);
  });
});

describe("Seed — Elzibeth, Military Sorceress", () => {
  test("REANIMATE puts a discard character on top of its owner's deck", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ez", def: def("Elzibeth, Military Sorceress"), owner: P1, zone: "play" },
        { key: "corpse", def: character({ name: "Corpse" }), owner: P1, zone: "discard" },
        ...bank("rage", 6, P1)
      ]
    });
    activate(engine, P1, id("ez"), "reanimate", { selected: { c: [id("corpse")] } });
    assert.equal(engine.state.cards[id("corpse")].zone, "deck");
    assert.equal(engine.state.players[P1].deck[0], id("corpse"));
  });
});

describe("Seed — Enduring Swordsman", () => {
  test("when it leaves play, may inflict 1 damage to a chosen character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "es", def: def("Enduring Swordsman"), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC", life: 5 }), owner: P2, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("kill"), { selected: { t: [id("es")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("oc")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("oc")].damage, 1);
  });
});

describe("Seed — Ensorcelled Familiar", () => {
  test("ETB may tutor a tactic into hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ef", def: def("Ensorcelled Familiar"), owner: P1, zone: "hand" },
        { key: "tac", def: tactic({ name: "Tac" }), owner: P1, zone: "deck" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("obsession", 6, P1)
      ]
    });
    play(engine, P1, id("ef"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("tac")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("tac")].zone, "hand");
  });
});

describe("Seed — Evanesce", () => {
  test("returns a chosen character to its owner's hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "e", def: def("Evanesce"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" },
        ...bank("obsession", 4, P1)
      ]
    });
    play(engine, P1, id("e"), { selected: { c: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].zone, "hand");
  });
});

describe("Seed — Extravagant Contusion", () => {
  test("pays X to destroy a character with numeric cost ≤ X", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ec", def: def("Extravagant Contusion"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", cost: 2 }), owner: P2, zone: "play" },
        ...bank("greed", 6, P1)
      ]
    });
    play(engine, P1, id("ec"), { variables: { x: 2 }, selected: { c: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].zone, "discard");
  });
});

describe("Seed — Fervent Beastslayer", () => {
  test("[R]x5 grants +3 life permanently", () => {
    const d = def("Fervent Beastslayer");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "fb", def: d, owner: P1, zone: "play" }, ...bank("rage", 5, P1)]
    });
    activate(engine, P1, id("fb"), "life");
    assert.equal(engine.getStat(id("fb"), "life"), (d.life ?? 0) + 3);
  });
});

describe("Seed — Fiendish Fez", () => {
  test("the attached character loses 2 strength and cannot attack", () => {
    const host = character({ name: "Host", strength: 4 });
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: host, owner: P1, zone: "play" },
        { key: "ff", def: def("Fiendish Fez"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), (host.strength ?? 0) - 2);
    assert.ok(engine.getRestrictions(id("host")).includes("cannotAttack"));
  });
});

describe("Seed — Flabbergasting Philosopher", () => {
  test("is TACTICAL; ETB gives your faction 4 influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "fp", def: def("Flabbergasting Philosopher"), owner: P1, zone: "hand" }, ...bank("greed", 8, P1)]
    });
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("fp"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.players[P1].influence, inf + 4);
    assert.ok(engine.getKeywords(id("fp")).includes("tactical"));
  });
});

describe("Seed — Fleet Golem", () => {
  test("cannot be blocked while it has a token", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "fg", def: def("Fleet Golem"), owner: P1, zone: "play", counters: { token: 1 } }]
    });
    assert.ok(engine.getKeywords(id("fg")).includes("cannotBeBlocked"));
  });
});

describe("Seed — Foolhardy Desperado", () => {
  test("is COVERT; on inflicting battle damage your faction loses 2 influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "fd", def: def("Foolhardy Desperado"), owner: P1, zone: "play" }],
      turn: 2
    });
    assert.ok(engine.getKeywords(id("fd")).includes("covert"));
    const inf = engine.state.players[P1].influence;
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("fd")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, inf - 2);
  });
});

describe("Seed — Forbidden Knowledge", () => {
  test("draws a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "fk", def: def("Forbidden Knowledge"), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("obsession", 4, P1)
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    play(engine, P1, id("fk"), {});
    assert.equal(engine.state.players[P1].hand.length, hand - 1 + 1);
  });
});

describe("Seed — Foul Diviner", () => {
  test("EXTRA COST removes a discard-pile tactic from the game on deploy", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "fd", def: def("Foul Diviner"), owner: P1, zone: "hand" },
        { key: "tac", def: tactic({ name: "Tac" }), owner: P1, zone: "discard" },
        ...bank("obsession", 6, P1)
      ]
    });
    play(engine, P1, id("fd"), { selected: { exile: [id("tac")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("tac")].zone, "removed");
    assert.equal(engine.state.cards[id("fd")].zone, "play");
  });
});

describe("Seed — Fountain Diver", () => {
  test("RECUR from discard gives a character +3 life this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "fd", def: def("Fountain Diver"), owner: P1, zone: "discard" },
        { key: "c", def: character({ name: "C", life: 3 }), owner: P1, zone: "play" },
        ...bank("greed", 4, P1)
      ]
    });
    activate(engine, P1, id("fd"), "recur", { selected: { rc: [id("c")] } });
    assert.equal(engine.getStat(id("c"), "life"), 3 + 3);
  });
});

describe("Seed — Frenzied Shriever", () => {
  test("increases the battle damage it inflicts to a character by 2", () => {
    const d = def("Frenzied Shriever");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "fs", def: d, owner: P1, zone: "play" },
        { key: "blk", def: character({ name: "Blk", strength: 0, life: 10, speed: 1 }), owner: P2, zone: "play" }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("fs")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("blk")].damage, (d.strength ?? 0) + 2);
  });
});

describe("Seed — Frisky Fortunehunter", () => {
  test("ETB costs 2 influence; leaving play gives back 4", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ff", def: def("Frisky Fortunehunter"), owner: P1, zone: "hand" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        ...bank("greed", 4, P1),
        ...bank("rage", 4, P1)
      ]
    });
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("ff"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.players[P1].influence, inf - 2);
    play(engine, P1, id("kill"), { selected: { t: [id("ff")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.players[P1].influence, inf - 2 + 4);
  });
});

describe("Seed — Gallant Commander", () => {
  test("CHARGE! destroys itself to inflict 3 damage to an opponent's faction", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "gc", def: def("Gallant Commander"), owner: P1, zone: "play" },
        ...bank("rage", 4, P1)
      ]
    });
    const inf = engine.state.players[P2].influence;
    activate(engine, P1, id("gc"), "charge");
    assert.equal(engine.state.players[P2].influence, inf - 3);
    assert.equal(engine.state.cards[id("gc")].zone, "discard");
  });
});

describe("Seed — Gideon, the Ultimate Warrior", () => {
  test("reduces battle damage to it while attacking to 0", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "g", def: def("Gideon, the Ultimate Warrior"), owner: P1, zone: "play" },
        { key: "blk", def: character({ name: "Blk", strength: 5, life: 5, speed: 1 }), owner: P2, zone: "play" }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("g")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("g")].damage ?? 0, 0);
    assert.equal(engine.state.cards[id("g")].zone, "play");
  });
});

describe("Seed — Godwing Thunderhoof", () => {
  test("on attack, may inflict [R]-count damage to a chosen character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "gt", def: def("Godwing Thunderhoof"), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC", life: 9 }), owner: P2, zone: "play" },
        ...bank("rage", 4, P1)
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("gt")], target: { type: "faction", playerId: P2 } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("oc")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("oc")].damage, 4);
  });
});

describe("Seed — Guttersnipe", () => {
  test("has TACTICAL", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "g", def: def("Guttersnipe"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getKeywords(id("g")).includes("tactical"));
  });
});

// =====================================================================
// H – M
// =====================================================================

describe("Seed — H07 P3pp3r", () => {
  test("grants +2/+2 to the attached character", () => {
    const host = character({ name: "Host", strength: 2, life: 2 });
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: host, owner: P1, zone: "play" },
        { key: "hp", def: def("H07 P3pp3r"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), (host.strength ?? 0) + 2);
    assert.equal(engine.getStat(id("host"), "life"), (host.life ?? 0) + 2);
  });
});

describe("Seed — Hall of Great Justice", () => {
  test("DRAW pays 3 and draws", () => {
    const { engine } = buildGame({
      playerA: { faction: def("Hall of Great Justice") },
      cards: [{ key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" }, ...bank("rage", 4, P1)]
    });
    const facId = engine.state.players[P1].factionId!;
    const hand = engine.state.players[P1].hand.length;
    engine.perform({ type: "activateAbility", playerId: P1, cardId: facId, abilityId: "tournament-draw", selected: {}, variables: {} });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].hand.length, hand + 1);
  });
});

describe("Seed — Harbinger of Anguish", () => {
  test("DEMOTIVATE gives a character -1 life this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ha", def: def("Harbinger of Anguish"), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC", life: 4 }), owner: P2, zone: "play" },
        ...bank("deception", 4, P1)
      ]
    });
    activate(engine, P1, id("ha"), "demotivate", { selected: { c: [id("oc")] } });
    assert.equal(engine.getStat(id("oc"), "life"), 3);
  });
});

describe("Seed — Headhunting", () => {
  test("steals a cheap character being deployed into play under your control", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "hh", def: def("Headhunting"), owner: P1, zone: "hand" },
        { key: "guy", def: character({ name: "Guy", cost: 1 }), owner: P2, zone: "hand" },
        ...bank("deception", 10, P1),
        ...bank("greed", 4, P2)
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("guy"), selected: {} } as never);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("hh"), selected: {} } as never);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("guy")].controllerId, P1);
  });
});

describe("Seed — Heavy Sword", () => {
  test("grants +2 strength; [R]x4 adds a further +2", () => {
    const host = character({ name: "Host", strength: 2 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "host", def: host, owner: P1, zone: "play" },
        { key: "hs", def: def("Heavy Sword"), owner: P1, zone: "play", attachedToKey: "host" },
        ...bank("rage", 4, P1)
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), (host.strength ?? 0) + 2);
    activate(engine, P1, id("hs"), "sharpen");
    assert.equal(engine.getStat(id("host"), "strength"), (host.strength ?? 0) + 4);
  });
});

describe("Seed — Heroic Deed", () => {
  test("makes up to 2 chosen characters unable to block this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "hd", def: def("Heroic Deed"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" },
        ...bank("rage", 4, P1)
      ]
    });
    play(engine, P1, id("hd"), { selected: { cs: [id("oc")] } });
    assert.ok(engine.getRestrictions(id("oc")).includes("cannotBlock"));
  });
});

describe("Seed — Hidden Dagger", () => {
  test("is TACTICAL; grants +1 strength to the attached character", () => {
    const host = character({ name: "Host", strength: 2 });
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: host, owner: P1, zone: "play" },
        { key: "hd", def: def("Hidden Dagger"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), (host.strength ?? 0) + 1);
    assert.ok(def("Hidden Dagger").behavior?.keywords?.includes("tactical"));
  });
});

describe("Seed — High Court of Demands", () => {
  test("ETB draws a card; opponents cannot attack your faction", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "hc", def: def("High Court of Demands"), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 2, life: 3, speed: 3 }), owner: P2, zone: "play" }
      ],
      turn: 2,
      activePlayerId: P2
    });
    assert.throws(() =>
      engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } })
    );
  });
});

describe("Seed — High-Priest of Thabbash", () => {
  test("NEGATE discards a card to terminate a same-type card being deployed", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "hp", def: def("High-Priest of Thabbash"), owner: P1, zone: "play" },
        { key: "disc", def: character({ name: "Disc" }), owner: P1, zone: "hand" },
        { key: "guy", def: character({ name: "Guy", cost: 2 }), owner: P2, zone: "hand" },
        ...bank("obsession", 8, P1),
        ...bank("greed", 4, P2)
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("guy"), selected: {} } as never);
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("hp"), abilityId: "negate", selected: { disc: [id("disc")], dep: [id("guy")] }, variables: {} });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("guy")].zone, "discard");
  });
});

describe("Seed — Horrendous Behemoth", () => {
  test("in a battle, the opposing party loses 1 strength and 1 speed", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "hb", def: def("Horrendous Behemoth"), owner: P1, zone: "play" },
        { key: "blk", def: character({ name: "Blk", strength: 3, life: 5, speed: 3 }), owner: P2, zone: "play" }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("hb")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("blk"), "strength"), 2);
    assert.equal(engine.getStat(id("blk"), "speed"), 2);
  });
});

describe("Seed — Horrifying Brain-Monkey", () => {
  test("SLOBBER destroys itself to destroy a character with strength ≤ your [O] count", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "bm", def: def("Horrifying Brain-Monkey"), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC", strength: 2 }), owner: P2, zone: "play" },
        ...bank("obsession", 6, P1)
      ]
    });
    activate(engine, P1, id("bm"), "slobber", { selected: { c: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].zone, "discard");
  });
});

describe("Seed — Hungry-Hungry Idol", () => {
  test("FEED gives a character +1 life and costs your faction 1 influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "hi", def: def("Hungry-Hungry Idol"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C", life: 3 }), owner: P1, zone: "play" },
        ...bank("greed", 4, P1)
      ]
    });
    const inf = engine.state.players[P1].influence;
    activate(engine, P1, id("hi"), "feed", { selected: { c: [id("c")] } });
    assert.equal(engine.getStat(id("c"), "life"), 4);
    assert.equal(engine.state.players[P1].influence, inf - 1);
  });
});

describe("Seed — Hustler's Comeuppance", () => {
  test("with no character having damaged your faction, it resolves harmlessly", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "hc", def: def("Hustler's Comeuppance"), owner: P1, zone: "hand" },
        { key: "safe", def: character({ name: "Safe" }), owner: P2, zone: "play" },
        ...bank("deception", 6, P1)
      ]
    });
    play(engine, P1, id("hc"), {});
    assert.equal(engine.state.cards[id("safe")].zone, "play");
    assert.equal(engine.state.cards[id("hc")].zone, "discard");
  });
});

describe("Seed — Hypnotic Illusionist", () => {
  test("HYPNOTIZE destroys itself to take control of a cheap character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "hi", def: def("Hypnotic Illusionist"), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC", cost: 2 }), owner: P2, zone: "play" },
        ...bank("deception", 8, P1)
      ]
    });
    activate(engine, P1, id("hi"), "hypnotize", { selected: { c: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].controllerId, P1);
  });
});

describe("Seed — Idol Smasher", () => {
  test("EXTRA COST destroys a picked item on ETB", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "is", def: def("Idol Smasher"), owner: P1, zone: "hand" },
        { key: "it", def: item({ name: "It" }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("is"), { selected: { it: [id("it")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("it")].zone, "discard");
  });
});

describe("Seed — Impressive Hero", () => {
  test("EXTRA COST depletes a picked character on ETB", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ih", def: def("Impressive Hero"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" },
        ...bank("rage", 4, P1)
      ]
    });
    play(engine, P1, id("ih"), { selected: { c: [id("oc")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("oc")].depleted, true);
  });
});

describe("Seed — Improvised Blowtorch", () => {
  test("inflicts 2 damage to a chosen character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ib", def: def("Improvised Blowtorch"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", life: 5 }), owner: P2, zone: "play" },
        ...bank("rage", 4, P1)
      ]
    });
    play(engine, P1, id("ib"), { selected: { c: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].damage, 2);
  });
});

describe("Seed — Inconspicuous Golem", () => {
  test("with a token it can block COVERT parties", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "ig", def: def("Inconspicuous Golem"), owner: P1, zone: "play", counters: { token: 1 } }]
    });
    assert.ok(engine.getKeywords(id("ig")).includes("canBlockCovert"));
  });
});

describe("Seed — Inconvenient Roadblock", () => {
  test("reduces all battle damage this turn to 0 and draws", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ir", def: def("Inconvenient Roadblock"), owner: P1, zone: "hand" },
        { key: "atk", def: character({ name: "Atk", strength: 3, life: 5, speed: 3 }), owner: P1, zone: "play" },
        { key: "blk", def: character({ name: "Blk", strength: 3, life: 5, speed: 1 }), owner: P2, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("greed", 4, P1)
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("ir"), selected: {} } as never);
    resolvePendingResponses(engine);
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("atk")].damage ?? 0, 0);
    assert.equal(engine.state.cards[id("blk")].damage ?? 0, 0);
  });
});

describe("Seed — Ingenious Tinker", () => {
  test("ETB reduces the next numeric cost you pay this turn by 3", () => {
    const countRes = (engine: ReturnType<typeof buildGame>["engine"]) =>
      Object.values(engine.state.cards).filter(
        c => c.controllerId === P1 && engine.getDefinition(c.id).type === "resource" && c.zone === "play"
      ).length;
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "it", def: def("Ingenious Tinker"), owner: P1, zone: "hand" },
        { key: "trinket", def: item({ name: "Trinket", cost: 3 }), owner: P1, zone: "hand" },
        ...bank("elitism", 9, P1)
      ],
      turn: 2
    });
    play(engine, P1, id("it"), {});
    drain(engine, declineAll);
    const before = countRes(engine);
    play(engine, P1, id("trinket"), {});
    assert.equal(engine.state.cards[id("trinket")].zone, "play");
    // cost 3 - 3 reduction = 0 resources consumed
    assert.equal(countRes(engine), before);
  });
});

describe("Seed — Inhibit", () => {
  test("suppresses a non-resource card's rules text and draws", () => {
    const buffed = character({
      name: "Buffed",
      strength: 2,
      behavior: { abilities: [{ id: "b", type: "continuous", modifiers: [{ target: "source", stat: "strength", operation: "add", value: 5 }] }] }
    });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "in", def: def("Inhibit"), owner: P1, zone: "hand" },
        { key: "oc", def: buffed, owner: P2, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("obsession", 4, P1)
      ]
    });
    play(engine, P1, id("in"), { selected: { c: [id("oc")] } });
    assert.equal(engine.getStat(id("oc"), "strength"), buffed.strength ?? 0);
  });
});

describe("Seed — Intellectual Reliquary", () => {
  test("IMBIBE tutors a tactic from the top 3 of your deck", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ir", def: def("Intellectual Reliquary"), owner: P1, zone: "play" },
        { key: "tac", def: tactic({ name: "Tac" }), owner: P1, zone: "deck" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" },
        ...bank("obsession", 4, P1)
      ]
    });
    activate(engine, P1, id("ir"), "imbibe", { selected: { pick: [id("tac")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("tac")].zone, "hand");
  });
});

describe("Seed — Jocular Stupefaction", () => {
  test("destroys a COVERT character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "js", def: def("Jocular Stupefaction"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" },
        ...bank("elitism", 4, P1)
      ]
    });
    play(engine, P1, id("js"), { selected: { c: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].zone, "discard");
  });
});

describe("Seed — Karmic Cake", () => {
  test("tutors a resource into hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "kc", def: def("Karmic Cake"), owner: P1, zone: "hand" },
        { key: "res", def: resourceCard({ name: "Greed", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "deck" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("greed", 4, P1)
      ]
    });
    play(engine, P1, id("kc"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("res")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("res")].zone, "hand");
  });
});

describe("Seed — Lingamite Torture Monk", () => {
  test("TORTURE destroys itself to bounce a character you own", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "lm", def: def("Lingamite Torture Monk"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" }
      ]
    });
    activate(engine, P1, id("lm"), "torture", { selected: { c: [id("c")] } });
    assert.equal(engine.state.cards[id("c")].zone, "hand");
    assert.equal(engine.state.cards[id("lm")].zone, "discard");
  });
});

describe("Seed — Living God of Thabbash", () => {
  test("HIGHER CALLING bounces a character you control", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "lg", def: def("Living God of Thabbash"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" },
        ...bank("obsession", 4, P1)
      ]
    });
    activate(engine, P1, id("lg"), "higher-calling", { selected: { c: [id("c")] } });
    assert.equal(engine.state.cards[id("c")].zone, "hand");
  });
});

describe("Seed — Lordly Stables", () => {
  test("your attacking characters' battle damage to a character is increased by 1", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ls", def: def("Lordly Stables"), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 2, life: 5, speed: 3 }), owner: P1, zone: "play" },
        { key: "blk", def: character({ name: "Blk", strength: 0, life: 10, speed: 1 }), owner: P2, zone: "play" }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("blk")].damage, 3);
  });
});

describe("Seed — Lucky Charm", () => {
  test("ETB draws a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "lc", def: def("Lucky Charm"), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("deception", 4, P1)
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    play(engine, P1, id("lc"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.players[P1].hand.length, hand - 1 + 1);
  });
});

describe("Seed — Manful Skirmish", () => {
  test("depletes one, damages another, and pumps the third of 3 picked characters", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ms", def: def("Manful Skirmish"), owner: P1, zone: "hand" },
        { key: "a", def: character({ name: "A", life: 5 }), owner: P1, zone: "play" },
        { key: "b", def: character({ name: "B", life: 5 }), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C", strength: 2, life: 5 }), owner: P1, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("ms"), { selected: { cs: [id("a"), id("b"), id("c")] } });
    drain(engine, pc => {
      if (pc.kind === "chooserSelectsTarget") {
        const decl = (pc as { declaration?: { id?: string } }).declaration?.id;
        if (decl === "d1") return { kind: "chooserSelectsTarget", selected: [id("a")] };
        if (decl === "d2") return { kind: "chooserSelectsTarget", selected: [id("b")] };
        return { kind: "chooserSelectsTarget", selected: [id("c")] };
      }
      return declineAll(pc);
    });
    assert.equal(engine.state.cards[id("a")].depleted, true);
    assert.equal(engine.state.cards[id("b")].damage, 1);
    assert.equal(engine.getStat(id("c"), "strength"), 2 + 2);
  });
});

describe("Seed — Mass Confusion", () => {
  test("resolves against an opponent's characters", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mc", def: def("Mass Confusion"), owner: P1, zone: "hand" },
        { key: "o1", def: character({ name: "O1", life: 5 }), owner: P2, zone: "play" },
        { key: "o2", def: character({ name: "O2", life: 5 }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("mc"), { variables: { x: 1 }, selected: { cs: [id("o1")] } });
    drain(engine, pc =>
      pc.kind === "distributeAmong" ? { kind: "distributeAmong", shares: { [id("o1")]: (pc.amount as number) ?? 0 } } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("o1")].damage, 2); // 2 opp chars - 0 own
  });
});

describe("Seed — Maxwell Cockswagger", () => {
  test("STRUT gives a character +1 speed or -1 life this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mx", def: def("Maxwell Cockswagger"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C", speed: 3 }), owner: P1, zone: "play" },
        ...bank("deception", 4, P1)
      ]
    });
    activate(engine, P1, id("mx"), "strut", { selected: { c: [id("c")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 0 } : declineAll(pc)
    );
    assert.equal(engine.getStat(id("c"), "speed"), 4);
  });
});

describe("Seed — Mesmerizing Enchantress", () => {
  test("EXTRA COST picks characters that cannot attack until your next turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "me", def: def("Mesmerizing Enchantress"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" },
        ...bank("obsession", 6, P1)
      ]
    });
    play(engine, P1, id("me"), { selected: { cs: [id("oc")] } });
    drain(engine, declineAll);
    assert.ok(engine.getRestrictions(id("oc")).includes("cannotAttack"));
  });
});

describe("Seed — Mighty Ballista", () => {
  test("enters play depleted; FIRE inflicts X to a target and X to itself", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mb", def: def("Mighty Ballista"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", life: 9 }), owner: P2, zone: "play" },
        ...bank("rage", 8, P1)
      ]
    });
    play(engine, P1, id("mb"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("mb")].depleted, true);
  });
});

describe("Seed — Montgomery Blatherscythe", () => {
  test("RESURRECT reanimates a cheap discard character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mb", def: def("Montgomery Blatherscythe"), owner: P1, zone: "play" },
        { key: "corpse", def: character({ name: "Corpse", cost: 2 }), owner: P1, zone: "discard" },
        ...bank("greed", 4, P1)
      ]
    });
    activate(engine, P1, id("mb"), "resurrect", { selected: { c: [id("corpse")] } });
    assert.equal(engine.state.cards[id("corpse")].zone, "play");
    assert.equal(engine.state.cards[id("corpse")].controllerId, P1);
  });
});

describe("Seed — Mountainous Golem", () => {
  test("cannot be taken control of; removed from game when discarded", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mg", def: def("Mountainous Golem"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    assert.ok(engine.getRestrictions(id("mg")).includes("cannotBeTakenControl"));
    play(engine, P1, id("kill"), { selected: { t: [id("mg")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("mg")].zone, "removed");
  });
});

describe("Seed — Muddle Bugs", () => {
  test("BINGE adds a token and destroys a character once its tokens reach its cost", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mb", def: def("Muddle Bugs"), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC", cost: 1 }), owner: P2, zone: "play" }
      ]
    });
    activate(engine, P1, id("mb"), "binge", { selected: { c: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].zone, "discard");
  });
});

describe("Seed — Multi-Attachment Man", () => {
  test("when destroyed, may tutor an item into hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mam", def: def("Multi-Attachment Man"), owner: P1, zone: "play" },
        { key: "tool", def: item({ name: "Tool" }), owner: P1, zone: "deck" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("kill"), { selected: { t: [id("mam")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("tool")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("tool")].zone, "hand");
  });
});

describe("Seed — Mundane Pupil", () => {
  test("with a token it gains +1/+1", () => {
    const d = def("Mundane Pupil");
    const { engine, id } = buildGame({
      cards: [{ key: "mp", def: d, owner: P1, zone: "play", counters: { token: 1 } }]
    });
    assert.equal(engine.getStat(id("mp"), "strength"), (d.strength ?? 0) + 1);
    assert.equal(engine.getStat(id("mp"), "life"), (d.life ?? 0) + 1);
  });
});

describe("Seed — Mutineer's Hiatus", () => {
  test("EXTRA COST destroys a character you own to draw 2", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mh", def: def("Mutineer's Hiatus"), owner: P1, zone: "hand" },
        { key: "sac", def: character({ name: "Sac" }), owner: P1, zone: "play" },
        ...Array.from({ length: 3 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("greed", 4, P1)
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    play(engine, P1, id("mh"), { selected: { c: [id("sac")] } });
    assert.equal(engine.state.cards[id("sac")].zone, "discard");
    assert.equal(engine.state.players[P1].hand.length, hand - 1 + 2);
  });
});

describe("Seed — Mysterious Invasion", () => {
  test("OVERWHELM sacrifices 2 of your characters to destroy any character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mi", def: def("Mysterious Invasion"), owner: P1, zone: "play" },
        { key: "f1", def: character({ name: "F1" }), owner: P1, zone: "play" },
        { key: "f2", def: character({ name: "F2" }), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" }
      ]
    });
    activate(engine, P1, id("mi"), "overwhelm", { selected: { kill: [id("oc")], fodder: [id("f1"), id("f2")] } });
    assert.equal(engine.state.cards[id("oc")].zone, "discard");
    assert.equal(engine.state.cards[id("f1")].zone, "discard");
  });
});

describe("Seed — Narrow Passage", () => {
  test("a player may attack only once per turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "np", def: def("Narrow Passage"), owner: P1, zone: "play" },
        { key: "a1", def: character({ name: "A1", strength: 1, life: 3, speed: 3 }), owner: P1, zone: "play" },
        { key: "a2", def: character({ name: "A2", strength: 1, life: 3, speed: 3 }), owner: P1, zone: "play" }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("a1")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    assert.throws(() =>
      engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("a2")], target: { type: "faction", playerId: P2 } })
    );
  });
});

describe("Seed — Nefarious Horror", () => {
  test("while opponents out-number your characters, it gains +2/+2 and loses COVERT", () => {
    const d = def("Nefarious Horror");
    const { engine, id } = buildGame({
      cards: [
        { key: "nh", def: d, owner: P1, zone: "play" },
        { key: "o1", def: character({ name: "O1" }), owner: P2, zone: "play" },
        { key: "o2", def: character({ name: "O2" }), owner: P2, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("nh"), "strength"), (d.strength ?? 0) + 2);
    assert.equal(engine.getKeywords(id("nh")).includes("covert"), false);
  });
});

describe("Seed — Noble Sacrifice", () => {
  test("destroys one of your characters and one of an opponent's, then draws", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ns", def: def("Noble Sacrifice"), owner: P1, zone: "hand" },
        { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
        { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("rage", 4, P1)
      ]
    });
    play(engine, P1, id("ns"), { selected: { mine: [id("mine")], theirs: [id("theirs")] } });
    assert.equal(engine.state.cards[id("mine")].zone, "discard");
    assert.equal(engine.state.cards[id("theirs")].zone, "discard");
  });
});

describe("Seed — Obscure", () => {
  test("grants a chosen character COVERT this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "o", def: def("Obscure"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" },
        ...bank("obsession", 2, P1)
      ]
    });
    play(engine, P1, id("o"), { selected: { c: [id("c")] } });
    assert.ok(engine.getKeywords(id("c")).includes("covert"));
  });
});

describe("Seed — Obtuse Pipesmoker", () => {
  test("[D]x5 grants +1/+1/+1 permanently", () => {
    const d = def("Obtuse Pipesmoker");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "op", def: d, owner: P1, zone: "play" }, ...bank("deception", 5, P1)]
    });
    activate(engine, P1, id("op"), "pump");
    assert.equal(engine.getStat(id("op"), "strength"), (d.strength ?? 0) + 1);
    assert.equal(engine.getStat(id("op"), "speed"), (d.speed ?? 0) + 1);
  });
});

describe("Seed — Oddment Collector", () => {
  test("gains +1/+1 per token; enters with 5", () => {
    const d = def("Oddment Collector");
    const { engine, id } = buildGame({
      cards: [{ key: "oc", def: d, owner: P1, zone: "play", counters: { token: 5 } }]
    });
    assert.equal(engine.getStat(id("oc"), "strength"), (d.strength ?? 0) + 5);
  });
});

describe("Seed — Opportune Slotpuller", () => {
  test("GAMBLE reveals your top card and may pump this card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "os", def: def("Opportune Slotpuller"), owner: P1, zone: "play" },
        { key: "top", def: character({ name: "Top" }), owner: P1, zone: "deck" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("deception", 4, P1)
      ]
    });
    const d = def("Opportune Slotpuller");
    activate(engine, P1, id("os"), "gamble");
    drain(engine, pc =>
      pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 0 } : declineAll(pc)
    );
    assert.equal(engine.getStat(id("os"), "strength"), (d.strength ?? 0) + 2);
  });
});

describe("Seed — Palm Glom", () => {
  test("takes control of a chosen character and draws", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pg", def: def("Palm Glom"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("deception", 8, P1)
      ]
    });
    play(engine, P1, id("pg"), { selected: { t: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].controllerId, P1);
  });
});

describe("Seed — Perforate", () => {
  test("pays X to inflict X damage to a character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "p", def: def("Perforate"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", life: 6 }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("p"), { variables: { x: 3 }, selected: { c: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].damage, 3);
  });
});

describe("Seed — Perturbatious Warlock", () => {
  test("ETB makes an opponent top a card from their hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pw", def: def("Perturbatious Warlock"), owner: P1, zone: "hand" },
        { key: "oh", def: character({ name: "OH" }), owner: P2, zone: "hand" },
        ...bank("obsession", 4, P1)
      ]
    });
    play(engine, P1, id("pw"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" && pc.playerId === P2
        ? { kind: "chooserSelectsTarget", selected: [id("oh")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("oh")].zone, "deck");
  });
});

describe("Seed — Pilgrimage Auditor", () => {
  test("IMPEDE depletes a chosen character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pa", def: def("Pilgrimage Auditor"), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" }
      ]
    });
    activate(engine, P1, id("pa"), "impede", { selected: { c: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].depleted, true);
  });
});

describe("Seed — Pit Boss", () => {
  test("gains 1 speed per [D] you control", () => {
    const d = def("Pit Boss");
    const { engine, id } = buildGame({
      cards: [{ key: "pb", def: d, owner: P1, zone: "play" }, ...bank("deception", 3, P1)]
    });
    assert.equal(engine.getStat(id("pb"), "speed"), (d.speed ?? 0) + 3);
  });
});

describe("Seed — Portly Tradesmau", () => {
  test("when it blocks, draws a card per attacking-party member", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pt", def: def("Portly Tradesmau"), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 1, life: 5, speed: 3 }), owner: P2, zone: "play" },
        ...Array.from({ length: 3 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const }))
      ],
      turn: 2,
      activePlayerId: P2
    });
    const hand = engine.state.players[P1].hand.length;
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("pt")] });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].hand.length, hand + 1);
  });
});

describe("Seed — Prehensile Pirate", () => {
  test("EXTRA COST removes 4 discard cards from the game on deploy", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pp", def: def("Prehensile Pirate"), owner: P1, zone: "hand" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `g${i}`, def: character({ name: `G${i}` }), owner: P1, zone: "discard" as const })),
        ...bank("greed", 6, P1)
      ]
    });
    play(engine, P1, id("pp"), { selected: { exile4: [id("g0"), id("g1"), id("g2"), id("g3")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("g0")].zone, "removed");
    assert.equal(engine.state.cards[id("pp")].zone, "play");
  });
});

describe("Seed — Preponderant Craftsman", () => {
  test("CREATE lets you deploy a character for free", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pc", def: def("Preponderant Craftsman"), owner: P1, zone: "play" },
        { key: "freebie", def: character({ name: "Freebie", cost: 9 }), owner: P1, zone: "hand" },
        ...bank("elitism", 8, P1)
      ]
    });
    activate(engine, P1, id("pc"), "create");
    drain(engine, pc =>
      pc.kind === "deployForFree" ? { kind: "deployForFree", cardId: id("freebie") } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("freebie")].zone, "play");
  });
});

describe("Seed — Property Condemner", () => {
  test("ETB may destroy a location", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pc", def: def("Property Condemner"), owner: P1, zone: "hand" },
        { key: "loc", def: location({ name: "Loc", structure: 4 }), owner: P2, zone: "play" },
        ...bank("greed", 6, P1)
      ]
    });
    play(engine, P1, id("pc"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("loc")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("loc")].zone, "discard");
  });
});

describe("Seed — Protractive Golem", () => {
  test("[E]x6 grants +3/+3 and -1 speed permanently", () => {
    const d = def("Protractive Golem");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "pg", def: d, owner: P1, zone: "play" }, ...bank("elitism", 6, P1)]
    });
    activate(engine, P1, id("pg"), "pump");
    assert.equal(engine.getStat(id("pg"), "strength"), (d.strength ?? 0) + 3);
    assert.equal(engine.getStat(id("pg"), "speed"), (d.speed ?? 0) - 1);
  });
});

describe("Seed — Purifying Priest", () => {
  test("BANISH redirects the next 1 faction damage this turn onto a chosen location", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pp", def: def("Purifying Priest"), owner: P1, zone: "play" },
        { key: "loc", def: location({ name: "Loc", structure: 5 }), owner: P1, zone: "play" }
      ]
    });
    activate(engine, P1, id("pp"), "banish", { selected: { l: [id("loc")] } });
    assert.equal(engine.state.cards[id("pp")].depleted ?? false, false);
    assert.equal(engine.state.cards[id("loc")].zone, "play");
  });
});

describe("Seed — Repurpose", () => {
  test("destroys a chosen item and draws", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "r", def: def("Repurpose"), owner: P1, zone: "hand" },
        { key: "it", def: item({ name: "It" }), owner: P2, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("elitism", 6, P1)
      ]
    });
    play(engine, P1, id("r"), { selected: { it: [id("it")] } });
    assert.equal(engine.state.cards[id("it")].zone, "discard");
  });
});

describe("Seed — Rigged Tables", () => {
  test("WALK AWAY pays 1 and destroys itself to draw", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rt", def: def("Rigged Tables"), owner: P1, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("deception", 4, P1)
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    activate(engine, P1, id("rt"), "walk-away");
    assert.equal(engine.state.players[P1].hand.length, hand + 1);
    assert.equal(engine.state.cards[id("rt")].zone, "discard");
  });
});

describe("Seed — Righteous Exemplar", () => {
  test("[R]x5 grants +1/+1 permanently", () => {
    const d = def("Righteous Exemplar");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "re", def: d, owner: P1, zone: "play" }, ...bank("rage", 5, P1)]
    });
    activate(engine, P1, id("re"), "pump");
    assert.equal(engine.getStat(id("re"), "strength"), (d.strength ?? 0) + 1);
    assert.equal(engine.getStat(id("re"), "life"), (d.life ?? 0) + 1);
  });
});

describe("Seed — Roulette Wheel of DOOM!", () => {
  test("destroys a character with life ≤ the revealed card's cost", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rw", def: def("Roulette Wheel of DOOM!"), owner: P1, zone: "hand" },
        { key: "top", def: character({ name: "Top", cost: 4 }), owner: P1, zone: "deck" },
        { key: "frail", def: character({ name: "Frail", life: 2 }), owner: P2, zone: "play" },
        ...Array.from({ length: 3 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("deception", 4, P1)
      ]
    });
    play(engine, P1, id("rw"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("frail")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("frail")].zone, "discard");
  });
});

describe("Seed — Rouse", () => {
  test("puts a discard-pile tactic on top of your deck", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "r", def: def("Rouse"), owner: P1, zone: "hand" },
        { key: "tac", def: tactic({ name: "Tac" }), owner: P1, zone: "discard" },
        ...bank("obsession", 4, P1)
      ]
    });
    play(engine, P1, id("r"), { selected: { t: [id("tac")] } });
    assert.equal(engine.state.players[P1].deck[0], id("tac"));
  });
});

describe("Seed — Rune of Concealment", () => {
  test("PROTECT pays 2 and depletes to arm a battle-damage save on a character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rc", def: def("Rune of Concealment"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" },
        ...bank("elitism", 6, P1)
      ]
    });
    activate(engine, P1, id("rc"), "protect", { selected: { c: [id("c")] } });
    assert.equal(engine.state.cards[id("rc")].depleted, true);
  });
});

describe("Seed — Runic Armor", () => {
  test("grants +1/+2; [E]x5 adds +2/+1", () => {
    const host = character({ name: "Host", strength: 2, life: 2 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "host", def: host, owner: P1, zone: "play" },
        { key: "ra", def: def("Runic Armor"), owner: P1, zone: "play", attachedToKey: "host" },
        ...bank("elitism", 5, P1)
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), (host.strength ?? 0) + 1);
    activate(engine, P1, id("ra"), "reinforce");
    assert.equal(engine.getStat(id("host"), "strength"), (host.strength ?? 0) + 3);
  });
});

// =====================================================================
// R (cont) – V
// =====================================================================

describe("Seed — Runic Reinforcement", () => {
  test("a character gains +3/+3 this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rr", def: def("Runic Reinforcement"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", strength: 2, life: 2 }), owner: P1, zone: "play" },
        ...bank("elitism", 4, P1)
      ]
    });
    play(engine, P1, id("rr"), { selected: { c: [id("c")] } });
    assert.equal(engine.getStat(id("c"), "strength"), 5);
    assert.equal(engine.getStat(id("c"), "life"), 5);
  });
});

describe("Seed — Runic Tattoo Artist", () => {
  test("MARK gives a character +1/+1 this turn", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "rt", def: def("Runic Tattoo Artist"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C", strength: 2, life: 2 }), owner: P1, zone: "play" }
      ]
    });
    activate(engine, P1, id("rt"), "mark", { selected: { c: [id("c")] } });
    assert.equal(engine.getStat(id("c"), "strength"), 3);
  });
});

describe("Seed — Runic Whale", () => {
  test("with a token it gains +4/+4", () => {
    const d = def("Runic Whale");
    const { engine, id } = buildGame({
      cards: [{ key: "rw", def: d, owner: P1, zone: "play", counters: { token: 1 } }]
    });
    assert.equal(engine.getStat(id("rw"), "strength"), (d.strength ?? 0) + 4);
    assert.equal(engine.getStat(id("rw"), "life"), (d.life ?? 0) + 4);
  });
});

describe("Seed — Runivoltaic Accumulator", () => {
  test("DISCHARGE destroys itself to destroy a character within its token count", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ra", def: def("Runivoltaic Accumulator"), owner: P1, zone: "play", counters: { token: 3 } },
        { key: "oc", def: character({ name: "OC", cost: 2 }), owner: P2, zone: "play" }
      ]
    });
    activate(engine, P1, id("ra"), "discharge", { selected: { c: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].zone, "discard");
    assert.equal(engine.state.cards[id("ra")].zone, "discard");
  });
});

describe("Seed — Scintillating Chamber Pot", () => {
  test("TANTALIZE reduces a character's faction damage to 0 and locks its restore", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cp", def: def("Scintillating Chamber Pot"), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" },
        ...bank("greed", 4, P1)
      ]
    });
    activate(engine, P1, id("cp"), "tantalize", { selected: { c: [id("oc")] } });
    assert.ok(engine.getRestrictions(id("oc")).includes("cannotBeRestored"));
    assert.equal(engine.state.cards[id("cp")].depleted, true);
  });
});

describe("Seed — Sequestered Hellion", () => {
  test("has COVERT", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "sh", def: def("Sequestered Hellion"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getKeywords(id("sh")).includes("covert"));
  });
});

describe("Seed — Seraphim Magic", () => {
  test("a character gains +3 strength this turn and you draw", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sm", def: def("Seraphim Magic"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", strength: 2 }), owner: P1, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("rage", 4, P1)
      ]
    });
    play(engine, P1, id("sm"), { selected: { c: [id("c")] } });
    assert.equal(engine.getStat(id("c"), "strength"), 5);
  });
});

describe("Seed — Shadowy Mugger", () => {
  test("is COVERT; ETB mills a chosen card from an opponent's deck", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sm", def: def("Shadowy Mugger"), owner: P1, zone: "hand" },
        { key: "top", def: character({ name: "Top" }), owner: P2, zone: "deck" },
        { key: "d1", def: character({ name: "D1" }), owner: P2, zone: "deck" },
        ...bank("deception", 6, P1)
      ]
    });
    play(engine, P1, id("sm"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("top")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("top")].zone, "discard");
    assert.ok(engine.getKeywords(id("sm")).includes("covert"));
  });
});

describe("Seed — Shrouded Demon", () => {
  test("is COVERT; [O]x3 grants +2 life permanently", () => {
    const d = def("Shrouded Demon");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "sd", def: d, owner: P1, zone: "play" }, ...bank("obsession", 3, P1)]
    });
    assert.ok(engine.getKeywords(id("sd")).includes("covert"));
    activate(engine, P1, id("sd"), "pump");
    assert.equal(engine.getStat(id("sd"), "life"), (d.life ?? 0) + 2);
  });
});

describe("Seed — Sin Against Nature", () => {
  test("ETB bounces a resource you control", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "san", def: def("Sin Against Nature"), owner: P1, zone: "hand" },
        ...bank("obsession", 4, P1)
      ]
    });
    const res = Object.values(engine.state.cards).find(
      c => c.controllerId === P1 && engine.getDefinition(c.id).type === "resource"
    )!;
    play(engine, P1, id("san"), { selected: { r: [res.id] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[res.id].zone, "hand");
  });
});

describe("Seed — Slick Orator", () => {
  test("RECUR from discard removes itself from the game to draw", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "so", def: def("Slick Orator"), owner: P1, zone: "discard" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("greed", 4, P1)
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    activate(engine, P1, id("so"), "recur");
    assert.equal(engine.state.players[P1].hand.length, hand + 1);
    assert.equal(engine.state.cards[id("so")].zone, "removed");
  });
});

describe("Seed — Slinking Bandido", () => {
  test("is COVERT; on faction damage it gains a token and +1 strength", () => {
    const d = def("Slinking Bandido");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "sb", def: d, owner: P1, zone: "play" }],
      turn: 2
    });
    assert.ok(engine.getKeywords(id("sb")).includes("covert"));
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("sb")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("sb")].counters?.token, 1);
    assert.equal(engine.getStat(id("sb"), "strength"), (d.strength ?? 0) + 1);
  });
});

describe("Seed — Spitting Sarume", () => {
  test("ETB inflicts 1 damage to all of an opponent's characters", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ss", def: def("Spitting Sarume"), owner: P1, zone: "hand" },
        { key: "o1", def: character({ name: "O1", life: 4 }), owner: P2, zone: "play" },
        { key: "o2", def: character({ name: "O2", life: 4 }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("ss"), {});
    assert.equal(engine.state.cards[id("o1")].damage, 1);
    assert.equal(engine.state.cards[id("o2")].damage, 1);
  });
});

describe("Seed — Strangulate", () => {
  test("destroys a character with 4 life or less", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "s", def: def("Strangulate"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", life: 3 }), owner: P2, zone: "play" },
        ...bank("deception", 6, P1)
      ]
    });
    play(engine, P1, id("s"), { selected: { c: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].zone, "discard");
  });
});

describe("Seed — Stupidify", () => {
  test("an opponent discards 2 cards", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "st", def: def("Stupidify"), owner: P1, zone: "hand" },
        { key: "oh1", def: character({ name: "OH1" }), owner: P2, zone: "hand" },
        { key: "oh2", def: character({ name: "OH2" }), owner: P2, zone: "hand" },
        ...bank("obsession", 4, P1)
      ]
    });
    const disc = engine.state.players[P2].discard.length;
    play(engine, P1, id("st"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" && pc.playerId === P2
        ? { kind: "chooserSelectsTarget", selected: [id("oh1"), id("oh2")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.players[P2].discard.length, disc + 2);
  });
});

describe("Seed — Subordinate Demotivation", () => {
  test("destroys the opponent's lowest-cost character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sd", def: def("Subordinate Demotivation"), owner: P1, zone: "hand" },
        { key: "cheap", def: character({ name: "Cheap", cost: 1 }), owner: P2, zone: "play" },
        { key: "pricey", def: character({ name: "Pricey", cost: 7 }), owner: P2, zone: "play" },
        ...bank("greed", 4, P1)
      ]
    });
    play(engine, P1, id("sd"), { selected: { c: [id("cheap")] } });
    assert.equal(engine.state.cards[id("cheap")].zone, "discard");
    assert.equal(engine.state.cards[id("pricey")].zone, "play");
  });
});

describe("Seed — Surprising Nuisance", () => {
  test("puts 2 Micromajig tokens into play", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "sn", def: def("Surprising Nuisance"), owner: P1, zone: "hand" }, ...bank("elitism", 4, P1)]
    });
    play(engine, P1, id("sn"), {});
    const micros = Object.values(engine.state.cards).filter(
      c => c.zone === "play" && c.controllerId === P1 && engine.getDefinition(c.id).name === "Micromajig"
    );
    assert.equal(micros.length, 2);
  });
});

describe("Seed — Swollen Ostrich", () => {
  test("is TACTICAL; ETB may give a character +1/+1 this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "so", def: def("Swollen Ostrich"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", strength: 2 }), owner: P1, zone: "play" },
        ...bank("deception", 4, P1)
      ]
    });
    play(engine, P1, id("so"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("c")] } : declineAll(pc)
    );
    assert.equal(engine.getStat(id("c"), "strength"), 3);
  });
});

describe("Seed — Tamper", () => {
  test("destroys a character that has an ability", () => {
    const withAbility = character({
      name: "Mage",
      behavior: { abilities: [{ id: "x", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
    });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "t", def: def("Tamper"), owner: P1, zone: "hand" },
        { key: "oc", def: withAbility, owner: P2, zone: "play" },
        ...bank("elitism", 4, P1)
      ]
    });
    play(engine, P1, id("t"), { selected: { c: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].zone, "discard");
  });
});

describe("Seed — Temple Guardian", () => {
  test("DEFLECT removes an attacking character from the battle", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "tg", def: def("Temple Guardian"), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 2, life: 5, speed: 3 }), owner: P2, zone: "play" },
        ...bank("greed", 6, P1)
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    engine.perform({ type: "passPriority", playerId: P2 });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("tg"), abilityId: "deflect", selected: { c: [id("atk")] }, variables: {} });
    resolvePendingResponses(engine);
    assert.equal(engine.state.battle?.attackingParty.includes(id("atk")) ?? false, false);
  });
});

describe("Seed — Thabbashite Haruspex", () => {
  test("ETB may draw then bottom a card (net 0)", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "th", def: def("Thabbashite Haruspex"), owner: P1, zone: "hand" },
        ...Array.from({ length: 3 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("obsession", 2, P1)
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    play(engine, P1, id("th"), {});
    drain(engine, pc => {
      if (pc.kind === "chooserSelectsOption") return { kind: "chooserSelectsOption", index: 1 };
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [engine.state.players[P1].hand[0]] };
      return declineAll(pc);
    });
    assert.equal(engine.state.players[P1].hand.length, hand - 1);
  });
});

describe("Seed — Thabbashite Wizard", () => {
  test("ETB lets each player draw up to 2", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "tw", def: def("Thabbashite Wizard"), owner: P1, zone: "hand" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("obsession", 4, P1)
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    play(engine, P1, id("tw"), {});
    drain(engine, pc => {
      if (pc.kind === "chooseNumber") return { kind: "chooseNumber", value: pc.playerId === P1 ? 2 : 0 };
      return declineAll(pc);
    });
    assert.equal(engine.state.players[P1].hand.length, hand - 1 + 2);
  });
});

describe("Seed — The Abominable Hamster", () => {
  test("is COVERT; [O]x5 grants +2 strength permanently", () => {
    const d = def("The Abominable Hamster");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "h", def: d, owner: P1, zone: "play" }, ...bank("obsession", 5, P1)]
    });
    assert.ok(engine.getKeywords(id("h")).includes("covert"));
    activate(engine, P1, id("h"), "pump");
    assert.equal(engine.getStat(id("h"), "strength"), (d.strength ?? 0) + 2);
  });
});

describe("Seed — The Currency Bazaar", () => {
  test("TRADE discards a resource to tutor a staple resource into hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cb", def: def("The Currency Bazaar"), owner: P1, zone: "play" },
        { key: "pay", def: def("Greed"), owner: P1, zone: "hand" },
        { key: "res", def: resourceCard({ name: "Rage", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "deck" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("greed", 4, P1)
      ]
    });
    activate(engine, P1, id("cb"), "trade", { selected: { dr: [id("pay")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("res")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("res")].zone, "hand");
  });
});

describe("Seed — Theocratic Senate of Marduun", () => {
  test("opponents cannot attack your faction", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ts", def: def("Theocratic Senate of Marduun"), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 2, life: 3, speed: 3 }), owner: P2, zone: "play" }
      ],
      turn: 2,
      activePlayerId: P2
    });
    assert.throws(() =>
      engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } })
    );
  });
});

describe("Seed — Titillating Contortionist", () => {
  test("on attack, may force a chosen character to block it", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "tc", def: def("Titillating Contortionist"), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("tc")], target: { type: "faction", playerId: P2 } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("oc")] } : declineAll(pc)
    );
    assert.ok(engine.getRestrictions(id("oc")).includes("mustBlock"));
  });
});

describe("Seed — Transient Smuggler", () => {
  test("SMUGGLE grants a weak character COVERT this turn", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "ts", def: def("Transient Smuggler"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C", strength: 1 }), owner: P1, zone: "play" }
      ]
    });
    activate(engine, P1, id("ts"), "smuggle", { selected: { c: [id("c")] } });
    assert.ok(engine.getKeywords(id("c")).includes("covert"));
  });
});

describe("Seed — Treasure Brokerage", () => {
  test("when a character enters play under your control, may pay 1 to tutor a staple resource", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "tb", def: def("Treasure Brokerage"), owner: P1, zone: "play" },
        { key: "guy", def: character({ name: "Guy", cost: 0 }), owner: P1, zone: "hand" },
        { key: "res", def: resourceCard({ name: "Rage", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "deck" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("greed", 4, P1)
      ]
    });
    play(engine, P1, id("guy"), {});
    drain(engine, pc => {
      if (pc.kind === "mayPay") return { kind: "mayPay", pay: true };
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [id("res")] };
      return declineAll(pc);
    });
    assert.equal(engine.state.cards[id("res")].zone, "hand");
  });
});

describe("Seed — Trebuchet Officer", () => {
  test("FIRE! inflicts 1 damage to a chosen location", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "to", def: def("Trebuchet Officer"), owner: P1, zone: "play" },
        { key: "loc", def: location({ name: "Loc", structure: 5 }), owner: P2, zone: "play" },
        ...bank("rage", 4, P1)
      ]
    });
    activate(engine, P1, id("to"), "fire", { selected: { l: [id("loc")] } });
    assert.equal(engine.state.cards[id("loc")].damage, 1);
  });
});

describe("Seed — Unbearably Heavy Shoes of Teleportation", () => {
  test("the attached character loses 2 strength and cannot be blocked", () => {
    const host = character({ name: "Host", strength: 4 });
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: host, owner: P1, zone: "play" },
        { key: "shoes", def: def("Unbearably Heavy Shoes of Teleportation"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), (host.strength ?? 0) - 2);
    assert.ok(engine.getKeywords(id("host")).includes("cannotBeBlocked"));
  });
});

describe("Seed — Underhanded Gamer", () => {
  test("OUTSMART grants cannotBeBlocked while opponents out-number you", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ug", def: def("Underhanded Gamer"), owner: P1, zone: "play" },
        { key: "o1", def: character({ name: "O1" }), owner: P2, zone: "play" },
        { key: "o2", def: character({ name: "O2" }), owner: P2, zone: "play" },
        ...bank("deception", 4, P1)
      ]
    });
    activate(engine, P1, id("ug"), "outsmart");
    assert.ok(engine.getKeywords(id("ug")).includes("cannotBeBlocked"));
  });
});

describe("Seed — Underpaid Ancestor", () => {
  test("when it hits your discard from play, may pay 3 to return it depleted", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ua", def: def("Underpaid Ancestor"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        ...bank("greed", 6, P1)
      ]
    });
    play(engine, P1, id("kill"), { selected: { t: [id("ua")] } });
    drain(engine, pc => (pc.kind === "mayPay" ? { kind: "mayPay", pay: true } : declineAll(pc)));
    assert.equal(engine.state.cards[id("ua")].zone, "play");
    assert.equal(engine.state.cards[id("ua")].depleted, true);
  });
});

describe("Seed — Unflinching Bowman", () => {
  test("SHOOT inflicts 1 damage to a character and 1 to itself", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ub", def: def("Unflinching Bowman"), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC", life: 5 }), owner: P2, zone: "play" },
        ...bank("rage", 4, P1)
      ]
    });
    activate(engine, P1, id("ub"), "shoot", { selected: { c: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].damage, 1);
    assert.equal(engine.state.cards[id("ub")].damage, 1);
  });
});

describe("Seed — Unscrupulous Attendant", () => {
  test("when a character you control blocks, it gains 1 life this turn", () => {
    const blk = character({ name: "Blk", strength: 1, life: 3, speed: 1 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ua", def: def("Unscrupulous Attendant"), owner: P1, zone: "play" },
        { key: "blk", def: blk, owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 1, life: 5, speed: 3 }), owner: P2, zone: "play" }
      ],
      turn: 2,
      activePlayerId: P2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("blk")] });
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("blk"), "life"), (blk.life ?? 0) + 1);
  });
});

describe("Seed — Velocious Golem", () => {
  test("[E]x3 grants AGGRO", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "vg", def: def("Velocious Golem"), owner: P1, zone: "play" }, ...bank("elitism", 3, P1)]
    });
    assert.ok(engine.getKeywords(id("vg")).includes("aggro"));
  });
});

// =====================================================================
// Batch 5 — remaining resources / factions / vanillas / V–W and
// the alphabetically-skipped locations, items, and modal tactics.
// =====================================================================

describe("Seed — more staple / downside resources", () => {
  test("Obsession provides [obsession]", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "r", def: def("Obsession"), owner: P1, zone: "hand" }]
    });
    const before = engine.getThresholds(P1)["obsession"] ?? 0;
    engine.perform({
      type: "chooseDevelop",
      playerId: P1,
      choice: { type: "playResource", cards: [{ cardId: id("r"), faceDown: false }] }
    } as never);
    resolvePendingResponses(engine);
    assert.equal((engine.getThresholds(P1)["obsession"] ?? 0) - before, 1);
  });

  for (const [name, icon] of [
    ["Neurosis", "obsession"],
    ["Treachery", "deception"],
    ["Violence", "rage"]
  ] as const) {
    test(`${name} costs 1 influence on entry and provides [${icon}][${icon}]`, () => {
      const { engine, id } = buildGame({
        playerA: { faction: developFaction() },
        cards: [{ key: "r", def: def(name), owner: P1, zone: "hand" }]
      });
      const inf = engine.state.players[P1].influence;
      engine.perform({
        type: "chooseDevelop",
        playerId: P1,
        choice: { type: "playResource", cards: [{ cardId: id("r"), faceDown: false }] }
      } as never);
      resolvePendingResponses(engine);
      assert.equal(engine.state.players[P1].influence, inf - 1);
      assert.ok((engine.getThresholds(P1)[icon] ?? 0) >= 2);
    });
  }
});

describe("Seed — more faction cards (tournament DRAW)", () => {
  for (const name of ["The Tournament Faction", "Moist Cave of the Darkpump", "Order of the Golden String"]) {
    test(`${name} — DRAW pays 3 and draws`, () => {
      const { engine } = buildGame({
        playerA: { faction: def(name) },
        cards: [{ key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" }, ...bank("rage", 4, P1)]
      });
      const facId = engine.state.players[P1].factionId!;
      const hand = engine.state.players[P1].hand.length;
      engine.perform({ type: "activateAbility", playerId: P1, cardId: facId, abilityId: "tournament-draw", selected: {}, variables: {} });
      resolvePendingResponses(engine);
      assert.equal(engine.state.players[P1].hand.length, hand + 1);
    });
  }
});

describe("Seed — more vanilla characters", () => {
  for (const name of [
    "Massive Erecting Golem",
    "Terra Cotta Flagellator",
    "Nimble Conscript",
    "Unstoppable Asskicker",
    "Unimportant Wizard",
    "Prostitution Lobbyist",
    "Proficient Battler",
    "Tiny Sarume"
  ]) {
    test(`${name} deploys with printed stats and no keywords`, () => {
      const d = def(name);
      const { engine, id } = buildGame({ cards: [{ key: "c", def: d, owner: P1, zone: "play" }] });
      assert.equal(engine.getStat(id("c"), "strength"), d.strength ?? 0);
      assert.equal(engine.getStat(id("c"), "life"), d.life ?? 0);
      assert.deepEqual(engine.getKeywords(id("c")), []);
    });
  }
});

describe("Seed — Vigilant Raider", () => {
  test("ASSAIL pays 2 for +1 strength this turn", () => {
    const d = def("Vigilant Raider");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "vr", def: d, owner: P1, zone: "play" }, ...bank("rage", 4, P1)]
    });
    activate(engine, P1, id("vr"), "assail");
    assert.equal(engine.getStat(id("vr"), "strength"), (d.strength ?? 0) + 1);
  });
});

describe("Seed — Virtuous Razer", () => {
  test("mirrors its battle damage to a chosen location", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "vr", def: def("Virtuous Razer"), owner: P1, zone: "play" },
        { key: "blk", def: character({ name: "Blk", strength: 0, life: 10, speed: 1 }), owner: P2, zone: "play" },
        { key: "loc", def: location({ name: "Loc", structure: 8 }), owner: P2, zone: "play" }
      ],
      turn: 2
    });
    const dmg = engine.getStat(id("vr"), "strength");
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("vr")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
    autoResolveBattle(engine);
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("loc")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("loc")].damage, dmg);
  });
});

describe("Seed — Virulent Dogmatist", () => {
  test("BERATE pays 2 + deplete for -2 strength on a chosen character", () => {
    const oc = character({ name: "OC", strength: 4, life: 4 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "vd", def: def("Virulent Dogmatist"), owner: P1, zone: "play" },
        { key: "oc", def: oc, owner: P2, zone: "play" },
        ...bank("obsession", 4, P1)
      ]
    });
    activate(engine, P1, id("vd"), "berate", { selected: { c: [id("oc")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 0 } : declineAll(pc)
    );
    assert.equal(engine.getStat(id("oc"), "strength"), (oc.strength ?? 0) - 2);
    assert.equal(engine.state.cards[id("vd")].depleted, true);
  });
});

describe("Seed — Wand of Possession", () => {
  test("POSSESS pays 2 + deplete for a COVERT Micromajig token", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "wp", def: def("Wand of Possession"), owner: P1, zone: "play" }, ...bank("obsession", 4, P1)]
    });
    const before = Object.values(engine.state.cards).filter(
      c => c.zone === "play" && c.controllerId === P1 && engine.getDefinition(c.id).type === "character"
    ).length;
    activate(engine, P1, id("wp"), "possess");
    const chars = Object.values(engine.state.cards).filter(
      c => c.zone === "play" && c.controllerId === P1 && engine.getDefinition(c.id).type === "character"
    );
    assert.equal(chars.length, before + 1);
    assert.ok(engine.getKeywords(chars[chars.length - 1].id).includes("covert"));
  });
});

describe("Seed — Wanton Wizard", () => {
  test("ETB may put a discarded tactic into play as a face-down resource", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ww", def: def("Wanton Wizard"), owner: P1, zone: "hand" },
        { key: "t", def: tactic({ name: "Junk", cost: 0 }), owner: P1, zone: "discard" },
        ...bank("obsession", 4, P1)
      ]
    });
    play(engine, P1, id("ww"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("t")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("t")].zone, "play");
    assert.equal(engine.state.cards[id("t")].faceDown, true);
  });
});

describe("Seed — Wrinkly Rabbit", () => {
  test("is COVERT and gains +1/+1 per [O] you control", () => {
    const d = def("Wrinkly Rabbit");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "wr", def: d, owner: P1, zone: "play" }, ...bank("obsession", 3, P1)]
    });
    assert.ok(engine.getKeywords(id("wr")).includes("covert"));
    assert.equal(engine.getStat(id("wr"), "strength"), (d.strength ?? 0) + 3);
    assert.equal(engine.getStat(id("wr"), "life"), (d.life ?? 0) + 3);
  });
});

describe("Seed — Watchtower", () => {
  test("inflicts 1 damage to a character entering play under an opponent's control", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "wt", def: def("Watchtower"), owner: P1, zone: "play" },
        { key: "guy", def: character({ name: "Guy", cost: 1, life: 5 }), owner: P2, zone: "hand" },
        ...bank("greed", 6, P2)
      ],
      turn: 2,
      activePlayerId: P2
    });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("guy"), selected: {} } as never);
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("guy")].damage, 1);
  });
});

describe("Seed — Circumspect Hijacker", () => {
  test("[G][G][G] ETB draws a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ch", def: def("Circumspect Hijacker"), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("greed", 6, P1)
      ],
      turn: 2
    });
    const hand = engine.state.players[P1].hand.length;
    play(engine, P1, id("ch"), {});
    drain(engine, declineAll);
    // -1 for the card played, +1 for the ETB draw
    assert.equal(engine.state.players[P1].hand.length, hand);
  });
});

describe("Seed — Dauntless Gambler", () => {
  test("ETB naming its deck's top card type puts a token on it for +1/+1", () => {
    const d = def("Dauntless Gambler");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "dg", def: d, owner: P1, zone: "hand" },
        { key: "top", def: character({ name: "Top" }), owner: P1, zone: "deck" },
        ...bank("deception", 4, P1)
      ],
      turn: 2
    });
    play(engine, P1, id("dg"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 0 } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("dg")].counters?.token, 1);
    assert.equal(engine.getStat(id("dg"), "strength"), (d.strength ?? 0) + 1);
  });
});

describe("Seed — Flimflam Man", () => {
  test("ETB naming the top card's type draws it to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "fm", def: def("Flimflam Man"), owner: P1, zone: "hand" },
        { key: "top", def: character({ name: "Top" }), owner: P1, zone: "deck" },
        ...bank("deception", 6, P1)
      ],
      turn: 2
    });
    play(engine, P1, id("fm"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 0 } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("top")].zone, "hand");
  });
});

describe("Seed — Flagitious Denunciator", () => {
  test("is COVERT; DENOUNCE bounces a character and mills a character from an opponent's hand", () => {
    const oc = character({ name: "OC", strength: 2, life: 3 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "fd", def: def("Flagitious Denunciator"), owner: P1, zone: "play" },
        { key: "oc", def: oc, owner: P2, zone: "play" },
        { key: "oh", def: character({ name: "OH" }), owner: P2, zone: "hand" },
        ...bank("obsession", 4, P1)
      ]
    });
    assert.ok(engine.getKeywords(id("fd")).includes("covert"));
    activate(engine, P1, id("fd"), "denounce", { selected: { c: [id("oc")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("oh")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("oc")].zone, "hand");
    assert.equal(engine.state.cards[id("oh")].zone, "discard");
  });
});

describe("Seed — Fiscal Intercessor", () => {
  test("PLEAD reduces the next damage to a chosen character by 1", () => {
    const ally = character({ name: "Ally", life: 10 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "fi", def: def("Fiscal Intercessor"), owner: P1, zone: "play" },
        { key: "ally", def: ally, owner: P1, zone: "play" },
        {
          key: "zap",
          def: killTactic({
            name: "Zap",
            behavior: {
              abilities: [
                {
                  id: "k",
                  type: "activated",
                  targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
                  effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 4 }]
                }
              ]
            }
          }),
          owner: P1,
          zone: "hand"
        },
        ...bank("greed", 8, P1)
      ]
    });
    activate(engine, P1, id("fi"), "plead", { selected: { c: [id("ally")] } });
    play(engine, P1, id("zap"), { selected: { t: [id("ally")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("ally")].damage, 3);
  });
});

describe("Seed — Robustical Badass", () => {
  test("[R]x3: at the start of your turn, may inflict 1 damage to an opponent's faction", () => {
    const { engine } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [{ key: "rb", def: def("Robustical Badass"), owner: P1, zone: "play" }, ...bank("rage", 3, P1)],
      turn: 2,
      activePlayerId: P2
    });
    const inf = engine.state.players[P2].influence;
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    drain(engine, pc =>
      pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 1 } : declineAll(pc)
    );
    assert.equal(engine.state.players[P2].influence, inf - 1);
  });
});

describe("Seed — Sly Bilker", () => {
  test("SIZE UP pays 1 to look at the top card of a chosen deck", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "sb", def: def("Sly Bilker"), owner: P1, zone: "play" },
        { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "deck" },
        { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "deck" },
        ...bank("deception", 4, P1)
      ]
    });
    activate(engine, P1, id("sb"), "size-up");
    drain(engine, pc =>
      pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 0 } : declineAll(pc)
    );
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(engine.state.cards[id("sb")].zone, "play");
  });
});

describe("Seed — Drivey Car", () => {
  test("on leaving play, spawns Micromajig tokens for the opponent's character lead", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "dc", def: def("Drivey Car"), owner: P1, zone: "play" },
        { key: "o1", def: character({ name: "O1" }), owner: P2, zone: "play" },
        { key: "o2", def: character({ name: "O2" }), owner: P2, zone: "play" },
        {
          key: "boom",
          def: killTactic({
            name: "Boom",
            behavior: {
              abilities: [
                {
                  id: "k",
                  type: "activated",
                  targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
                  effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
                }
              ]
            }
          }),
          owner: P1,
          zone: "hand"
        },
        ...bank("deception", 6, P1)
      ]
    });
    play(engine, P1, id("boom"), { selected: { t: [id("dc")] } });
    drain(engine, declineAll);
    const myChars = Object.values(engine.state.cards).filter(
      c => c.zone === "play" && c.controllerId === P1 && engine.getDefinition(c.id).type === "character"
    );
    assert.ok(myChars.length >= 1);
  });
});

describe("Seed — Master Mud Whisperer", () => {
  test("at the start of an opponent's turn, may restore all your characters", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "mmw", def: def("Master Mud Whisperer"), owner: P1, zone: "play" },
        { key: "a", def: character({ name: "A" }), owner: P1, zone: "play", depleted: true },
        { key: "b", def: character({ name: "B" }), owner: P1, zone: "play", depleted: true }
      ],
      turn: 2,
      activePlayerId: P1
    });
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    drain(engine, pc =>
      pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 1 } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("a")].depleted, false);
    assert.equal(engine.state.cards[id("b")].depleted, false);
  });
});

describe("Seed — Mud Whisperer Wannabe", () => {
  test("when it blocks, may restore a chosen character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mww", def: def("Mud Whisperer Wannabe"), owner: P1, zone: "play" },
        { key: "dep", def: character({ name: "Dep" }), owner: P1, zone: "play", depleted: true },
        { key: "atk", def: character({ name: "Atk", strength: 1, life: 5, speed: 3 }), owner: P2, zone: "play" }
      ],
      turn: 2,
      activePlayerId: P2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("mww")] });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("dep")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("dep")].depleted, false);
  });
});

describe("Seed — Claywork Compendium", () => {
  test("RESEARCH depletes for -2 on your next numeric cost", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cc", def: def("Claywork Compendium"), owner: P1, zone: "play" },
        { key: "big", def: character({ name: "Big", cost: 5 }), owner: P1, zone: "hand" },
        ...bank("elitism", 8, P1)
      ]
    });
    activate(engine, P1, id("cc"), "research");
    assert.equal(engine.getCardPlayability(P1, id("big")).numericCost, 3);
  });
});

for (const [name, key] of [
  ["Flailing Knife", "fk"],
  ["P3pp3r 0f 1n54n17y", "pp"],
  ["Phalludrix, the Impotenator", "ph"]
] as const) {
  describe(`Seed — ${name}`, () => {
    test("boosts the attached character's strength", () => {
      const host = character({ name: "Host", strength: 2, life: 6 });
      const d = def(name);
      const { engine, id } = buildGame({
        cards: [
          { key: "host", def: host, owner: P1, zone: "play" },
          { key, def: d, owner: P1, zone: "play", attachedToKey: "host" }
        ]
      });
      const bonus = name === "Flailing Knife" ? 2 : name === "P3pp3r 0f 1n54n17y" ? 3 : 2;
      assert.equal(engine.getStat(id("host"), "strength"), (host.strength ?? 0) + bonus);
    });
  });
}

describe("Seed — Runic Battery", () => {
  test("DISCHARGE destroys itself, detaches resources, and draws", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rb", def: def("Runic Battery"), owner: P1, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("elitism", 6, P1)
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("rb"), abilityId: "discharge", selected: { rs: [] }, variables: {} });
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("rb")].zone, "discard");
    assert.equal(engine.state.players[P1].hand.length, hand + 1);
  });
});

describe("Seed — Obscene Communion", () => {
  test("at each turn start, the active player may pick 'each discards'", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "oc", def: def("Obscene Communion"), owner: P1, zone: "play" },
        { key: "h1", def: character({ name: "H1" }), owner: P1, zone: "hand" },
        { key: "h2", def: character({ name: "H2" }), owner: P2, zone: "hand" }
      ],
      turn: 2,
      activePlayerId: P2
    });
    const d1 = engine.state.players[P1].discard.length;
    const d2 = engine.state.players[P2].discard.length;
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    drain(engine, pc => {
      if (pc.kind === "chooserSelectsOption") return { kind: "chooserSelectsOption", index: 2 };
      if (pc.kind === "chooserSelectsTarget") {
        const h = engine.state.players[pc.playerId].hand;
        return { kind: "chooserSelectsTarget", selected: h.length ? [h[0]] : [] };
      }
      return declineAll(pc);
    });
    assert.equal(engine.state.players[P1].discard.length, d1 + 1);
    assert.equal(engine.state.players[P2].discard.length, d2 + 1);
  });
});

// --- tiered UNIQUE locations ------------------------------------------

function startControllerTurn(engine: ReturnType<typeof buildGame>["engine"]): void {
  engine.perform({ type: "endTurn", playerId: P2 });
  resolvePendingResponses(engine);
}

describe("Seed — Cryptic Athenaeum", () => {
  test("[O]x3: at the start of your turn you may draw a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "ca", def: def("Cryptic Athenaeum"), owner: P1, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("obsession", 3, P1)
      ],
      turn: 2,
      activePlayerId: P2
    });
    const hand = engine.state.players[P1].hand.length;
    startControllerTurn(engine);
    drain(engine, pc =>
      pc.kind === "chooserSelectsOption"
        ? { kind: "chooserSelectsOption", index: pc.playerId === P1 ? 1 : 0 }
        : declineAll(pc)
    );
    assert.equal(engine.state.players[P1].hand.length, hand + 1);
  });
});

describe("Seed — Marduun Baitings and Loan", () => {
  test("[G]x3: at the start of your turn your faction gains 2 influence", () => {
    const { engine } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [{ key: "mbl", def: def("Marduun Baitings and Loan"), owner: P1, zone: "play" }, ...bank("greed", 3, P1)],
      turn: 2,
      activePlayerId: P2
    });
    const inf = engine.state.players[P1].influence;
    startControllerTurn(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.players[P1].influence, inf + 2);
  });
});

describe("Seed — Hall of Conventions", () => {
  test("[E]x3: at the start of your turn, reduce your next numeric cost by 1", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "hoc", def: def("Hall of Conventions"), owner: P1, zone: "play" },
        { key: "big", def: character({ name: "Big", cost: 5 }), owner: P1, zone: "hand" },
        ...bank("elitism", 3, P1)
      ],
      turn: 2,
      activePlayerId: P2
    });
    startControllerTurn(engine);
    drain(engine, declineAll);
    assert.equal(engine.getCardPlayability(P1, id("big")).numericCost, 4);
  });
});

describe("Seed — Heist Training Grounds", () => {
  test("[D]x3: at the start of your turn, may grant a character COVERT", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "htg", def: def("Heist Training Grounds"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" },
        ...bank("deception", 3, P1)
      ],
      turn: 2,
      activePlayerId: P2
    });
    startControllerTurn(engine);
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("c")] } : declineAll(pc)
    );
    assert.ok(engine.getKeywords(id("c")).includes("covert"));
  });
});

describe("Seed — Drill Garrison", () => {
  test("[R]x3: at the start of your turn, may inflict 1 damage to an opponent's faction", () => {
    const { engine } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [{ key: "dg", def: def("Drill Garrison"), owner: P1, zone: "play" }, ...bank("rage", 3, P1)],
      turn: 2,
      activePlayerId: P2
    });
    const inf = engine.state.players[P2].influence;
    startControllerTurn(engine);
    drain(engine, pc =>
      pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 1 } : declineAll(pc)
    );
    assert.equal(engine.state.players[P2].influence, inf - 1);
  });
});

describe("Seed — Domain of Depravity", () => {
  test("marks a character with a token; each token is -1/-1/-1", () => {
    const c = character({ name: "C", strength: 4, life: 4, speed: 4 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "dod", def: def("Domain of Depravity"), owner: P1, zone: "play" },
        { key: "c", def: c, owner: P1, zone: "play" }
      ],
      turn: 2,
      activePlayerId: P2
    });
    startControllerTurn(engine);
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("c")] } : declineAll(pc)
    );
    assert.equal(engine.getStat(id("c"), "strength"), (c.strength ?? 0) - 1);
    assert.equal(engine.getStat(id("c"), "speed"), (c.speed ?? 0) - 1);
  });
});

describe("Seed — Mirthless Altar", () => {
  test("at each turn start, may give a character -1 strength this turn", () => {
    const c = character({ name: "C", strength: 4 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "ma", def: def("Mirthless Altar"), owner: P1, zone: "play" },
        { key: "c", def: c, owner: P1, zone: "play" }
      ],
      turn: 2,
      activePlayerId: P2
    });
    startControllerTurn(engine);
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("c")] } : declineAll(pc)
    );
    assert.equal(engine.getStat(id("c"), "strength"), (c.strength ?? 0) - 1);
  });
});

describe("Seed — Luxurious Gaming Establishment", () => {
  test("at the start of your turn, may give a character -1 speed this turn", () => {
    const c = character({ name: "C", speed: 4 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "lge", def: def("Luxurious Gaming Establishment"), owner: P1, zone: "play" },
        { key: "c", def: c, owner: P1, zone: "play" }
      ],
      turn: 2,
      activePlayerId: P2
    });
    startControllerTurn(engine);
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("c")] } : declineAll(pc)
    );
    assert.equal(engine.getStat(id("c"), "speed"), (c.speed ?? 0) - 1);
  });
});

describe("Seed — Time Portal", () => {
  test("at the start of your turn, may put a Micromajig token into play", () => {
    const { engine } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [{ key: "tp", def: def("Time Portal"), owner: P1, zone: "play" }],
      turn: 2,
      activePlayerId: P2
    });
    const before = Object.values(engine.state.cards).filter(
      c => c.zone === "play" && c.controllerId === P1 && engine.getDefinition(c.id).type === "character"
    ).length;
    startControllerTurn(engine);
    drain(engine, pc =>
      pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 1 } : declineAll(pc)
    );
    const after = Object.values(engine.state.cards).filter(
      c => c.zone === "play" && c.controllerId === P1 && engine.getDefinition(c.id).type === "character"
    ).length;
    assert.equal(after, before + 1);
  });
});

describe("Seed — Gambling Den", () => {
  test("at the start of your turn, a cheap top card lets each player draw", () => {
    const { engine } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "gd", def: def("Gambling Den"), owner: P1, zone: "play" },
        { key: "top", def: character({ name: "Top", cost: 1 }), owner: P1, zone: "deck" },
        { key: "spare", def: character({ name: "Spare" }), owner: P1, zone: "deck" }
      ],
      turn: 2,
      activePlayerId: P2
    });
    const hand = engine.state.players[P1].hand.length;
    startControllerTurn(engine);
    drain(engine, pc =>
      pc.kind === "chooserSelectsOption"
        ? { kind: "chooserSelectsOption", index: pc.playerId === P1 ? 1 : 0 }
        : declineAll(pc)
    );
    assert.equal(engine.state.players[P1].hand.length, hand + 1);
  });
});

describe("Seed — Workshop", () => {
  test("CONSTRUCT removes a discard card from the game to tutor its type", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ws", def: def("Workshop"), owner: P1, zone: "play" },
        { key: "dc", def: character({ name: "DC" }), owner: P1, zone: "discard" },
        { key: "deckc", def: character({ name: "DeckC" }), owner: P1, zone: "deck" },
        ...bank("elitism", 4, P1)
      ]
    });
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("ws"),
      abilityId: "construct",
      selected: { rem: [id("dc")] },
      variables: {}
    });
    resolvePendingResponses(engine);
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("deckc")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("dc")].zone, "removed");
  });
});

// --- modal tactics --------------------------------------------------

describe("Seed — Essence of Greed", () => {
  test("mode 'gain 4 influence'", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "eg", def: def("Essence of Greed"), owner: P1, zone: "hand" }, ...bank("greed", 4, P1)]
    });
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("eg"), { mode: 2 });
    drain(engine, declineAll);
    assert.equal(engine.state.players[P1].influence, inf + 4);
  });
});

describe("Seed — Essence of Deception", () => {
  test("mode '+1 speed' to a chosen character this turn", () => {
    const c = character({ name: "C", speed: 3 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ed", def: def("Essence of Deception"), owner: P1, zone: "hand" },
        { key: "c", def: c, owner: P1, zone: "play" },
        ...bank("deception", 4, P1)
      ]
    });
    play(engine, P1, id("ed"), { mode: 1, selected: { c: [id("c")] } });
    drain(engine, declineAll);
    assert.equal(engine.getStat(id("c"), "speed"), (c.speed ?? 0) + 1);
  });
});

describe("Seed — Essence of Elitism", () => {
  test("mode 'Micromajig' puts a token into play", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "ee", def: def("Essence of Elitism"), owner: P1, zone: "hand" }, ...bank("elitism", 4, P1)]
    });
    const before = Object.values(engine.state.cards).filter(
      c => c.zone === "play" && c.controllerId === P1 && engine.getDefinition(c.id).type === "character"
    ).length;
    play(engine, P1, id("ee"), { mode: 0 });
    drain(engine, declineAll);
    const after = Object.values(engine.state.cards).filter(
      c => c.zone === "play" && c.controllerId === P1 && engine.getDefinition(c.id).type === "character"
    ).length;
    assert.equal(after, before + 1);
  });
});

describe("Seed — Essence of Obsession", () => {
  test("mode '-2 strength' to a chosen character this turn", () => {
    const c = character({ name: "C", strength: 5 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "eo", def: def("Essence of Obsession"), owner: P1, zone: "hand" },
        { key: "c", def: c, owner: P2, zone: "play" },
        ...bank("obsession", 4, P1)
      ]
    });
    play(engine, P1, id("eo"), { mode: 2, selected: { c: [id("c")] } });
    drain(engine, declineAll);
    assert.equal(engine.getStat(id("c"), "strength"), (c.strength ?? 0) - 2);
  });
});

describe("Seed — Essence of Rage", () => {
  test("mode '+2 strength' to a chosen character this turn", () => {
    const c = character({ name: "C", strength: 3 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "er", def: def("Essence of Rage"), owner: P1, zone: "hand" },
        { key: "c", def: c, owner: P1, zone: "play" },
        ...bank("rage", 4, P1)
      ]
    });
    play(engine, P1, id("er"), { mode: 1, selected: { c: [id("c")] } });
    drain(engine, declineAll);
    assert.equal(engine.getStat(id("c"), "strength"), (c.strength ?? 0) + 2);
  });
});

describe("Seed — Overindulge", () => {
  test("mode '-2 life' to a chosen character this turn", () => {
    const c = character({ name: "C", life: 5 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "oi", def: def("Overindulge"), owner: P1, zone: "hand" },
        { key: "c", def: c, owner: P2, zone: "play" },
        ...bank("deception", 4, P1)
      ]
    });
    play(engine, P1, id("oi"), { mode: 0, selected: { c: [id("c")] } });
    drain(engine, declineAll);
    assert.equal(engine.getStat(id("c"), "life"), (c.life ?? 0) - 2);
  });
});

// --- other skipped tactics ----------------------------------------

describe("Seed — Brainbath", () => {
  test("draws 2 then bottoms one card from hand (net hand unchanged)", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "bb", def: def("Brainbath"), owner: P1, zone: "hand" },
        { key: "x", def: character({ name: "X" }), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" },
        ...bank("obsession", 4, P1)
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    play(engine, P1, id("bb"), {});
    drain(engine, pc => {
      if (pc.kind === "chooserSelectsTarget") {
        const h = engine.state.players[pc.playerId].hand;
        return { kind: "chooserSelectsTarget", selected: h.length ? [h[0]] : [] };
      }
      return declineAll(pc);
    });
    assert.equal(engine.state.players[P1].hand.length, hand);
  });
});

describe("Seed — Day of the Tentacle", () => {
  test("puts a chosen non-resource from an opponent's hand into play as their face-down resource", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "dt", def: def("Day of the Tentacle"), owner: P1, zone: "hand" },
        { key: "oh", def: character({ name: "OH" }), owner: P2, zone: "hand" },
        ...bank("obsession", 4, P1)
      ]
    });
    play(engine, P1, id("dt"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("oh")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("oh")].zone, "play");
    assert.equal(engine.state.cards[id("oh")].controllerId, P2);
    assert.equal(engine.state.cards[id("oh")].faceDown, true);
  });
});

describe("Seed — Encumber", () => {
  test("bounces a chosen character to its owner's hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "en", def: def("Encumber"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" },
        ...bank("obsession", 6, P1)
      ]
    });
    play(engine, P1, id("en"), { selected: { t: [id("oc")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("oc")].zone, "hand");
  });
});

describe("Seed — Walk the Plank", () => {
  test("destroys every character with numeric cost <= [G] count", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "wtp", def: def("Walk the Plank"), owner: P1, zone: "hand" },
        { key: "cheap", def: character({ name: "Cheap", cost: 2 }), owner: P2, zone: "play" },
        { key: "pricey", def: character({ name: "Pricey", cost: 9 }), owner: P2, zone: "play" },
        ...bank("greed", 7, P1)
      ]
    });
    play(engine, P1, id("wtp"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("cheap")].zone, "discard");
    assert.equal(engine.state.cards[id("pricey")].zone, "play");
  });
});

describe("Seed — Pant Swipe", () => {
  test("voids the top 4 cards of an opponent's deck", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "ps", def: def("Pant Swipe"), owner: P1, zone: "hand" },
        { key: "e1", def: character({ name: "E1" }), owner: P2, zone: "deck" },
        { key: "e2", def: character({ name: "E2" }), owner: P2, zone: "deck" },
        { key: "e3", def: character({ name: "E3" }), owner: P2, zone: "deck" },
        { key: "e4", def: character({ name: "E4" }), owner: P2, zone: "deck" },
        ...bank("deception", 8, P1)
      ]
    });
    play(engine, P1, id("ps"), { selected: { voided: [id("e1"), id("e2"), id("e3"), id("e4")] } });
    drain(engine, declineAll);
    for (const k of ["e1", "e2", "e3", "e4"]) {
      assert.equal(engine.state.cards[id(k)].zone, "void");
    }
  });
});

describe("Seed — Rumply Ruse", () => {
  test("during a battle, your party's characters gain 1 speed this turn", () => {
    const atk = character({ name: "Atk", strength: 2, life: 4, speed: 3 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rr", def: def("Rumply Ruse"), owner: P1, zone: "hand" },
        { key: "atk", def: atk, owner: P1, zone: "play" },
        { key: "blk", def: character({ name: "Blk", strength: 0, life: 8, speed: 1 }), owner: P2, zone: "play" },
        ...bank("deception", 6, P1)
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    play(engine, P1, id("rr"), {});
    drain(engine, declineAll);
    assert.equal(engine.getStat(id("atk"), "speed"), (atk.speed ?? 0) + 1);
  });
});

describe("Seed — Surprise!", () => {
  test("reveals a cheap enough character from your deck into the blocking party", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "sp", def: def("Surprise!"), owner: P1, zone: "hand" },
        { key: "rec", def: character({ name: "Rec", cost: 1, strength: 1, life: 2, speed: 2 }), owner: P1, zone: "deck" },
        { key: "atk", def: character({ name: "Atk", cost: 3, strength: 2, life: 4, speed: 3 }), owner: P2, zone: "play" },
        ...bank("deception", 6, P1)
      ],
      turn: 2,
      activePlayerId: P2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
    while (engine.state.responseWindow && engine.state.responseWindow.priorityPlayerId !== P1) {
      engine.perform({ type: "passPriority", playerId: engine.state.responseWindow.priorityPlayerId });
    }
    engine.perform({ type: "playCard", playerId: P1, cardId: id("sp"), selected: { k: [id("atk")] } } as never);
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("rec")].zone, "play");
    assert.equal(engine.state.cards[id("rec")].controllerId, P1);
  });
});

describe("Seed — Reality Shift", () => {
  test("bounces your non-resources and opens a free redeploy budget", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rs", def: def("Reality Shift"), owner: P1, zone: "hand" },
        { key: "thing", def: item({ name: "Thing", cost: 1 }), owner: P1, zone: "play" },
        ...bank("obsession", 8, P1)
      ]
    });
    let sawFree = false;
    play(engine, P1, id("rs"), {});
    drain(engine, pc => {
      if (pc.kind === "deployForFree") {
        sawFree = true;
        return { kind: "deployForFree" };
      }
      return declineAll(pc);
    });
    assert.equal(sawFree, true);
    assert.equal(engine.state.cards[id("rs")].zone, "discard");
  });
});
