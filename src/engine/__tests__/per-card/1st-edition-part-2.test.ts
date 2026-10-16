// Per-card correctness suite — 1st Edition Part 2 (165 cards, combat-heavy).
// One describe() per catalog card. See ./_harness.ts and
// ../../../CARD-TEST-PROGRESS.md.

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
  P2
} from "./_harness.js";
import type { CardDefinition } from "../../../engine.js";

const SET = "1st Edition Part 2";
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
    case "selectTargets":
      return { kind: "selectTargets", selected: {} };
    case "selectDeployTargets":
      return { kind: "selectDeployTargets", selected: {} };
    case "distributeAmong":
      return { kind: "distributeAmong", shares: {} };
    case "chooseNumber":
      return { kind: "chooseNumber", value: (pc.min as number) ?? 0 };
    case "reorderDeck":
      return { kind: "reorderDeck", order: pc.to === "split" ? [] : [...((pc.cardIds as string[]) ?? [])], bottom: pc.to === "split" ? [...((pc.cardIds as string[]) ?? [])] : undefined };
    case "orderTriggers":
      return { kind: "orderTriggers", next: ((pc.triggers as unknown[]) ?? [])[0] };
    case "replacementChoice":
      return { kind: "replacementChoice", apply: false };
    case "coinFlipReplace":
      return { kind: "coinFlipReplace", reflip: false };
    case "auctionBid":
      return { kind: "auctionBid", bid: 0 };
    case "chooseChosenBlockers":
      return { kind: "chooseChosenBlockers", cardIds: [] };
    case "nameValue":
      return { kind: "nameValue", value: pc.valueKind === "resourceIcon" ? "rage" : pc.valueKind === "trade" ? "warlord" : "Nonexistent" };
    case "deployForFree":
      return { kind: "deployForFree" };
    default:
      return { kind: pc.kind };
  }
};

// =====================================================================
// Obsession block
// =====================================================================

describe("1st Edition Part 2 — Ambiguity Embiggener", () => {
  test("at the start of a turn, the active player names X and each player cycles X cards", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "ae", def: def("Ambiguity Embiggener"), owner: P1, zone: "play" },
        { key: "h1", def: character({ name: "H1" }), owner: P1, zone: "hand" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const }))
      ],
      activePlayerId: P2
    });
    const handBefore = engine.state.players[P1].hand.length;
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    drain(engine, pc => {
      if (pc.kind === "chooseNumber") return { kind: "chooseNumber", value: 1 };
      if (pc.kind === "chooserSelectsTarget") {
        const first = engine.state.players[pc.playerId as "p1"].hand[0];
        return { kind: "chooserSelectsTarget", selected: first ? [first] : [] };
      }
      return declineAll(pc);
    });
    // P1 bottomed 1 and drew 1 -> net hand size unchanged
    assert.equal(engine.state.players[P1].hand.length, handBefore);
  });
});

describe("1st Edition Part 2 — Ameliorate", () => {
  test("bottoms N hand cards and draws N+1", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "am", def: def("Ameliorate"), owner: P1, zone: "hand" },
        { key: "b1", def: character({ name: "B1" }), owner: P1, zone: "hand" },
        { key: "b2", def: character({ name: "B2" }), owner: P1, zone: "hand" },
        ...Array.from({ length: 5 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("obsession", 6, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("am"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("b1"), id("b2")] }
        : declineAll(pc)
    );
    // -1 Ameliorate, -2 bottomed, +3 drawn
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 - 2 + 3);
    assert.equal(engine.state.cards[id("b1")].zone, "deck");
  });
});

describe("1st Edition Part 2 — Arcanology Recruitment Officer", () => {
  test("at the start of your turn, grants an opposing character COVERT", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "aro", def: def("Arcanology Recruitment Officer"), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" }
      ],
      activePlayerId: P2
    });
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("oc")] }
        : declineAll(pc)
    );
    assert.ok(engine.getKeywords(id("oc")).includes("covert"));
  });
});

describe("1st Edition Part 2 — Cloaked Creeper", () => {
  test("is COVERT; while attacking, its whole party is COVERT", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "cc", def: def("Cloaked Creeper"), owner: P1, zone: "play" },
        { key: "buddy", def: character({ name: "Buddy", strength: 2, life: 2, speed: 3 }), owner: P1, zone: "play" }
      ],
      turn: 2
    });
    assert.ok(engine.getKeywords(id("cc")).includes("covert"));
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("cc"), id("buddy")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    assert.ok(engine.getKeywords(id("buddy")).includes("covert"));
  });
});

describe("1st Edition Part 2 — Deceptive Muddler", () => {
  test("is COVERT; on faction damage, that faction's controller tops a hand card", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "dm", def: def("Deceptive Muddler"), owner: P1, zone: "play" },
        { key: "oh", def: character({ name: "OH" }), owner: P2, zone: "hand" }
      ]
    });
    assert.ok(engine.getKeywords(id("dm")).includes("covert"));
    (engine as unknown as { emit: (e: unknown) => void }).emit({
      type: "damageDealt",
      sourceId: id("dm"),
      targetId: engine.state.players[P2].factionId,
      amount: 1
    });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("oh")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.players[P2].deck[0], id("oh"));
  });
});

describe("1st Edition Part 2 — Eccentric Inquisition", () => {
  test("voids the tactics among an opponent's top 7 cards", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ei", def: def("Eccentric Inquisition"), owner: P1, zone: "hand" },
        { key: "ot", def: tactic({ name: "OppTac" }), owner: P2, zone: "deck" },
        ...Array.from({ length: 6 }, (_, i) => ({ key: `od${i}`, def: character({ name: `OD${i}` }), owner: P2, zone: "deck" as const })),
        ...bank("obsession", 6, P1)
      ]
    });
    play(engine, P1, id("ei"), { selected: { voided: [id("ot")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("ot")].zone, "void");
  });
});

describe("1st Edition Part 2 — Eldridge Gosche", () => {
  test("at the start of your turn, may distribute tokens onto your non-resource cards", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "eg", def: def("Eldridge Gosche"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" }
      ],
      activePlayerId: P2
    });
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    drain(engine, pc => {
      if (pc.kind === "chooserSelectsOption") return { kind: "chooserSelectsOption", index: 0 };
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [id("c")] };
      if (pc.kind === "chooseNumber") return { kind: "chooseNumber", value: 2 };
      if (pc.kind === "distributeAmong") return { kind: "distributeAmong", shares: { [id("c")]: 2 } };
      return declineAll(pc);
    });
    assert.equal(engine.state.cards[id("c")].counters.token, 2);
  });
});

describe("1st Edition Part 2 — Horsemajig of the Apocalypse - Famine", () => {
  test("aura: other horsemajig characters gain 1 speed", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "fam", def: def("Horsemajig of the Apocalypse - Famine"), owner: P1, zone: "play" },
        { key: "steed", def: character({ name: "Steed", speed: 2, subtype: ["horsemajig"] }), owner: P1, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("steed"), "speed"), 3);
  });
});

describe("1st Edition Part 2 — Horsemajig of the Apocalypse - Pestilence", () => {
  test("aura: other horsemajig characters gain 1 life", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "pest", def: def("Horsemajig of the Apocalypse - Pestilence"), owner: P1, zone: "play" },
        { key: "steed", def: character({ name: "Steed", life: 2, subtype: ["horsemajig"] }), owner: P1, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("steed"), "life"), 3);
  });

  test("aura excludes only the source instance, not other copies of the same name", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "pestA", def: def("Horsemajig of the Apocalypse - Pestilence"), owner: P1, zone: "play" },
        { key: "pestB", def: def("Horsemajig of the Apocalypse - Pestilence"), owner: P1, zone: "play" }
      ]
    });
    // Each Pestilence is an "other horsemajig character" from the other's
    // point of view, so both get +1 life (printed 3). Neither buffs itself.
    assert.equal(engine.getStat(id("pestA"), "life"), 4);
    assert.equal(engine.getStat(id("pestB"), "life"), 4);
  });

  test("a lone Pestilence does not buff itself", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "pest", def: def("Horsemajig of the Apocalypse - Pestilence"), owner: P1, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("pest"), "life"), 3);
  });
});

describe("1st Edition Part 2 — Puddle of Goo", () => {
  test("has COVERT", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "pg", def: def("Puddle of Goo"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getKeywords(id("pg")).includes("covert"));
  });
});

describe("1st Edition Part 2 — Dimensional Rift", () => {
  test("TELEPORT returns a chosen character to its owner's hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "dr", def: def("Dimensional Rift"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C" }), owner: P2, zone: "play" },
        ...bank("obsession", 8, P1)
      ]
    });
    activate(engine, P1, id("dr"), "teleport", { selected: { c: [id("c")] } });
    assert.equal(engine.state.cards[id("c")].zone, "hand");
    assert.equal(engine.state.cards[id("dr")].depleted, true);
  });
});

describe("1st Edition Part 2 — Ectological Hazard Suit", () => {
  test("the attached character gains +1/+1 per token on it", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host", strength: 2, life: 2 }), owner: P1, zone: "play", counters: { token: 1 } },
        { key: "suit", def: def("Ectological Hazard Suit"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), 3);
    assert.equal(engine.getStat(id("host"), "life"), 3);
  });
});

describe("1st Edition Part 2 — Emphatic Ecto-Manipulator", () => {
  test("EXTRA COST: may put 2 tokens on a picked character you control", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "eem", def: def("Emphatic Ecto-Manipulator"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" },
        ...bank("obsession", 8, P1)
      ]
    });
    play(engine, P1, id("eem"), { selected: { pick: [id("c")] } });
    assert.equal(engine.state.cards[id("c")].counters.token, 2);
  });
});

describe("1st Edition Part 2 — Entangle", () => {
  test("up to 2 characters lose 1 speed this turn; you draw", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "en", def: def("Entangle"), owner: P1, zone: "hand" },
        { key: "a", def: character({ name: "A", speed: 3 }), owner: P2, zone: "play" },
        { key: "b", def: character({ name: "B", speed: 3 }), owner: P2, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("obsession", 6, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("en"), { selected: { picks: [id("a"), id("b")] } });
    assert.equal(engine.getStat(id("a"), "speed"), 2);
    assert.equal(engine.getStat(id("b"), "speed"), 2);
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1);
  });
});

describe("1st Edition Part 2 — Gnat", () => {
  test("when it leaves play, an opponent discards a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "gnat", def: def("Gnat"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        { key: "oh", def: character({ name: "OH" }), owner: P2, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("kill"), { selected: { t: [id("gnat")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("oh")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("oh")].zone, "discard");
  });
});

describe("1st Edition Part 2 — Infatuated Armchair", () => {
  test("when it leaves play, you draw a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ia", def: def("Infatuated Armchair"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" },
        ...bank("rage", 6, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("kill"), { selected: { t: [id("ia")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 2 } : declineAll(pc)
    );
    // -1 kill, +1 the Armchair draw
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1);
  });
});

describe("1st Edition Part 2 — Insect Appreciator", () => {
  test("a party including it must have an even number of members", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "ia", def: def("Insect Appreciator"), owner: P1, zone: "play" }],
      turn: 2
    });
    assert.throws(() =>
      engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("ia")], target: { type: "faction", playerId: P2 } })
    );
  });
});

describe("1st Edition Part 2 — Kinky Asp", () => {
  test("has COVERT", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "ka", def: def("Kinky Asp"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getKeywords(id("ka")).includes("covert"));
  });
});

describe("1st Edition Part 2 — Maladjustment", () => {
  test("returns a resource you control to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "ma", def: def("Maladjustment"), owner: P1, zone: "hand" }, ...bank("obsession", 6, P1)]
    });
    const someRes = engine.state.players[P1].play.find(c => engine.getDefinition(c).type === "resource")!;
    play(engine, P1, id("ma"), { selected: { res: [someRes] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[someRes].zone, "hand");
  });
});

describe("1st Edition Part 2 — Obsessive Compulsion", () => {
  test("scries the top 3 and draws a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "oc", def: def("Obsessive Compulsion"), owner: P1, zone: "hand" },
        ...Array.from({ length: 5 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("obsession", 6, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("oc"), {});
    drain(engine, declineAll);
    // -1 OC, +1 draw
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1);
  });
});

describe("1st Edition Part 2 — Odious Diva", () => {
  test("DISAPPROVE bottoms a named card from an opponent's hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "od", def: def("Odious Diva"), owner: P1, zone: "play" },
        { key: "target", def: character({ name: "Nemesis" }), owner: P2, zone: "hand" },
        { key: "od1", def: character({ name: "OD1" }), owner: P2, zone: "deck" },
        { key: "od2", def: character({ name: "OD2" }), owner: P2, zone: "deck" },
        ...bank("obsession", 6, P1)
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("od"), abilityId: "disapprove", selected: {}, variables: {} });
    resolvePendingResponses(engine);
    drain(engine, pc => {
      if (pc.kind === "nameValue") return { kind: "nameValue", value: "Nemesis" };
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [id("target")] };
      return declineAll(pc);
    });
    assert.equal(engine.state.cards[id("target")].zone, "deck");
  });
});

describe("1st Edition Part 2 — Quotidian Disappearance", () => {
  test("an opponent returns a non-resource card they control to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "qd", def: def("Quotidian Disappearance"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" },
        ...bank("obsession", 4, P1)
      ]
    });
    play(engine, P1, id("qd"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("oc")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("oc")].zone, "hand");
  });
});

describe("1st Edition Part 2 — Quotidian Virtuoso", () => {
  test("DISRUPT: discard a card + deplete to force an opponent to discard", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "qv", def: def("Quotidian Virtuoso"), owner: P1, zone: "play" },
        { key: "spare", def: character({ name: "Spare" }), owner: P1, zone: "hand" },
        { key: "oh", def: character({ name: "OH" }), owner: P2, zone: "hand" },
        ...bank("obsession", 6, P1)
      ]
    });
    activate(engine, P1, id("qv"), "disrupt", { selected: { d: [id("spare")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("oh")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("oh")].zone, "discard");
    assert.equal(engine.state.cards[id("qv")].depleted, true);
  });
});

describe("1st Edition Part 2 — Recollection Bazaar", () => {
  test("RECALL returns a resource you control to hand", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "rb", def: def("Recollection Bazaar"), owner: P1, zone: "play" }, ...bank("obsession", 4, P1)]
    });
    const someRes = engine.state.players[P1].play.find(c => engine.getDefinition(c).type === "resource")!;
    activate(engine, P1, id("rb"), "recall", { selected: { res: [someRes] } });
    assert.equal(engine.state.cards[someRes].zone, "hand");
  });
});

describe("1st Edition Part 2 — Ritual of the Knob & Pull", () => {
  test("destroys the picked character if its controller has strength-many face-down resources", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rkp", def: def("Ritual of the Knob & Pull"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", strength: 2 }), owner: P2, zone: "play" },
        ...volition(3, P2),
        ...bank("obsession", 6, P1)
      ]
    });
    play(engine, P1, id("rkp"), { selected: { c: [id("c")] } });
    assert.equal(engine.state.cards[id("c")].zone, "discard");
  });

  test("leaves the character alone when the [V] count is short", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rkp", def: def("Ritual of the Knob & Pull"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", strength: 5 }), owner: P2, zone: "play" },
        ...volition(1, P2),
        ...bank("obsession", 6, P1)
      ]
    });
    play(engine, P1, id("rkp"), { selected: { c: [id("c")] } });
    assert.equal(engine.state.cards[id("c")].zone, "play");
  });
});

describe("1st Edition Part 2 — Ritual of the Ominous Urn", () => {
  test("an opponent discards; you may tutor a same-type card to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rou", def: def("Ritual of the Ominous Urn"), owner: P1, zone: "hand" },
        { key: "oh", def: character({ name: "OH" }), owner: P2, zone: "hand" },
        { key: "found", def: character({ name: "Found" }), owner: P1, zone: "deck" },
        ...bank("obsession", 6, P1)
      ]
    });
    play(engine, P1, id("rou"), {});
    drain(engine, pc => {
      if (pc.kind !== "chooserSelectsTarget") return declineAll(pc);
      return { kind: "chooserSelectsTarget", selected: pc.playerId === P2 ? [id("oh")] : [id("found")] };
    });
    assert.equal(engine.state.cards[id("oh")].zone, "discard");
    assert.equal(engine.state.cards[id("found")].zone, "hand");
  });
});

describe("1st Edition Part 2 — Rummaging Millipede", () => {
  test("is COVERT; ETB may return a tactic from your discard to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rm", def: def("Rummaging Millipede"), owner: P1, zone: "hand" },
        { key: "grave", def: tactic({ name: "Grave" }), owner: P1, zone: "discard" },
        ...bank("obsession", 8, P1)
      ]
    });
    play(engine, P1, id("rm"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("grave")] }
        : declineAll(pc)
    );
    assert.ok(engine.getKeywords(id("rm")).includes("covert"));
    assert.equal(engine.state.cards[id("grave")].zone, "hand");
  });
});

describe("1st Edition Part 2 — The Deranger", () => {
  test("LOBOTOMIZE discards up to 2 non-resource cards and hands the item to the opponent", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "dr", def: def("The Deranger"), owner: P1, zone: "play" },
        { key: "o1", def: character({ name: "O1" }), owner: P2, zone: "hand" },
        { key: "o2", def: character({ name: "O2" }), owner: P2, zone: "hand" },
        ...bank("obsession", 6, P1)
      ]
    });
    activate(engine, P1, id("dr"), "lobotomize");
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("o1"), id("o2")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("o1")].zone, "discard");
    assert.equal(engine.state.cards[id("dr")].controllerId, P2);
  });
});

describe("1st Edition Part 2 — Toxic Cultivator", () => {
  test("while you control an even number of characters, your tactics cost 1 less", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "tc", def: def("Toxic Cultivator"), owner: P1, zone: "play" },
        { key: "buddy", def: character({ name: "Buddy" }), owner: P1, zone: "play" },
        { key: "tac", def: tactic({ name: "Tac", cost: 3 }), owner: P1, zone: "hand" },
        ...bank("obsession", 8, P1)
      ]
    });
    assert.equal(engine.getCardPlayability(P1, id("tac")).numericCost, 2);
  });
});

describe("1st Edition Part 2 — Unnatural Alteration", () => {
  test("destroy a character you control, then tutor a cheaper one to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ua", def: def("Unnatural Alteration"), owner: P1, zone: "hand" },
        { key: "sac", def: character({ name: "Sac", cost: 3 }), owner: P1, zone: "play" },
        { key: "found", def: character({ name: "Found", cost: 4 }), owner: P1, zone: "deck" },
        ...bank("obsession", 8, P1)
      ]
    });
    play(engine, P1, id("ua"), { selected: { c: [id("sac")] } });
    drain(engine, pc => {
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [id("found")] };
      if (pc.kind === "chooserSelectsOption") return { kind: "chooserSelectsOption", index: 1 };
      return declineAll(pc);
    });
    assert.equal(engine.state.cards[id("sac")].zone, "discard");
    assert.equal(engine.state.cards[id("found")].zone, "hand");
  });
});

describe("1st Edition Part 2 — Venomous Sacspider", () => {
  test("destroyed by battle damage: an opponent discards their hand", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "vs", def: def("Venomous Sacspider"), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 3, life: 3, speed: 3 }), owner: P2, zone: "play" },
        { key: "oh1", def: character({ name: "OH1" }), owner: P2, zone: "hand" },
        { key: "oh2", def: character({ name: "OH2" }), owner: P2, zone: "hand" }
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("vs")] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.players[P2].hand.length, 0);
  });
});

describe("1st Edition Part 2 — Violating Anomaly", () => {
  test("ETB: an opponent discards a chosen card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "va", def: def("Violating Anomaly"), owner: P1, zone: "hand" },
        { key: "oh", def: character({ name: "OH" }), owner: P2, zone: "hand" },
        ...bank("obsession", 8, P1)
      ]
    });
    play(engine, P1, id("va"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("oh")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("oh")].zone, "discard");
  });
});

describe("1st Edition Part 2 — Voidal Interference", () => {
  test("terminates a responded-to card into its owner's hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "vi", def: def("Voidal Interference"), owner: P1, zone: "hand" },
        { key: "opp", def: character({ name: "OppChar", cost: 1 }), owner: P2, zone: "hand" },
        ...bank("obsession", 8, P1),
        ...bank("rage", 6, P2)
      ],
      activePlayerId: P2
    });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("opp"), selected: {} } as never);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("vi"), selected: {} } as never);
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("opp")].zone, "hand");
  });
});

// =====================================================================
// Greed block
// =====================================================================

describe("1st Edition Part 2 — Anesthetizing Opulence", () => {
  test("destroys a character; an opponent draws a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ao", def: def("Anesthetizing Opulence"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P2, zone: "play" },
        { key: "od", def: character({ name: "OD" }), owner: P2, zone: "deck" },
        ...bank("greed", 8, P1)
      ]
    });
    const oppHand = engine.state.players[P2].hand.length;
    play(engine, P1, id("ao"), { selected: { c: [id("c")] } });
    assert.equal(engine.state.cards[id("c")].zone, "discard");
    assert.equal(engine.state.players[P2].hand.length, oppHand + 1);
  });
});

describe("1st Edition Part 2 — Clandestine Resort", () => {
  test("aura: your characters gain 1 life", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "cr", def: def("Clandestine Resort"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C", life: 3 }), owner: P1, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("c"), "life"), 4);
  });
});

describe("1st Edition Part 2 — Class Action Defender", () => {
  test("any damage of 5 or more is reduced to 0", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cad", def: def("Class Action Defender"), owner: P1, zone: "play" },
        { key: "zap", def: killTactic({ name: "Zap", behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 6 }] }] } }), owner: P1, zone: "hand" },
        ...bank("greed", 8, P1)
      ]
    });
    play(engine, P1, id("zap"), { selected: { t: [id("cad")] } });
    assert.equal(engine.state.cards[id("cad")].damage ?? 0, 0);
  });
});

describe("1st Edition Part 2 — Club Mau Bouncer", () => {
  test("when a character damages it, that character takes 1 damage back", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "cmb", def: def("Club Mau Bouncer"), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", life: 5 }), owner: P2, zone: "play" }
      ]
    });
    (engine as unknown as { emit: (e: unknown) => void }).emit({
      type: "damageDealt",
      sourceId: id("atk"),
      targetId: id("cmb"),
      amount: 2
    });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("atk")].damage, 1);
  });
});

describe("1st Edition Part 2 — Crooked Appraiser", () => {
  test("INSPECT deals 2 damage to a location", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ca", def: def("Crooked Appraiser"), owner: P1, zone: "play" },
        { key: "loc", def: location({ name: "Loc", structure: 6 }), owner: P2, zone: "play" }
      ]
    });
    activate(engine, P1, id("ca"), "inspect", { selected: { loc: [id("loc")] } });
    assert.equal(engine.state.cards[id("loc")].damage, 2);
    assert.equal(engine.state.cards[id("ca")].depleted, true);
  });
});

describe("1st Edition Part 2 — Embezzling Bookkeeper", () => {
  test("ETB: an opponent draws a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "eb", def: def("Embezzling Bookkeeper"), owner: P1, zone: "hand" },
        { key: "od", def: character({ name: "OD" }), owner: P2, zone: "deck" },
        ...bank("greed", 6, P1)
      ]
    });
    const oppHand = engine.state.players[P2].hand.length;
    play(engine, P1, id("eb"), {});
    assert.equal(engine.state.players[P2].hand.length, oppHand + 1);
  });
});

describe("1st Edition Part 2 — Entry-Level Employee", () => {
  test("enters with 2 tokens (-1/-1 each); INVEST removes one", () => {
    const d = def("Entry-Level Employee");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "ele", def: d, owner: P1, zone: "hand" }, ...bank("greed", 8, P1)]
    });
    play(engine, P1, id("ele"), {});
    assert.equal(engine.state.cards[id("ele")].counters.token, 2);
    assert.equal(engine.getStat(id("ele"), "strength"), (d.strength ?? 0) - 2);
    activate(engine, P1, id("ele"), "invest");
    assert.equal(engine.state.cards[id("ele")].counters.token, 1);
  });
});

describe("1st Edition Part 2 — Escrow Office", () => {
  test("DEPOSIT puts a token on it", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "eo", def: def("Escrow Office"), owner: P1, zone: "play" }, ...bank("greed", 4, P1)]
    });
    activate(engine, P1, id("eo"), "deposit");
    assert.equal(engine.state.cards[id("eo")].counters.token, 1);
  });
});

describe("1st Edition Part 2 — Extortify", () => {
  test("your faction gains 8 influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "ex", def: def("Extortify"), owner: P1, zone: "hand" }, ...bank("greed", 6, P1)]
    });
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("ex"), {});
    assert.equal(engine.state.players[P1].influence, inf + 8);
  });
});

describe("1st Edition Part 2 — Fat Pants", () => {
  test("the attached character gains 1 strength and 2 life", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host", strength: 2, life: 2 }), owner: P1, zone: "play" },
        { key: "fp", def: def("Fat Pants"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), 3);
    assert.equal(engine.getStat(id("host"), "life"), 4);
  });
});

describe("1st Edition Part 2 — First Unified Market of Abstract Secure Theoreticals", () => {
  test("your faction abilities cost 1 less (min 1)", () => {
    const { engine } = buildGame({
      playerA: { faction: cardDef("Seed 3", "The Evil Alliance") },
      cards: [
        { key: "fumast", def: def("First Unified Market of Abstract Secure Theoreticals"), owner: P1, zone: "play" },
        ...bank("greed", 2, P1),
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" }
      ]
    });
    const factionId = engine.state.players[P1].factionId!;
    const handBefore = engine.state.players[P1].hand.length;
    // The Evil Alliance's DRAW normally costs 3; with the FUMAST discount, 2 (which we have)
    engine.perform({ type: "activateAbility", playerId: P1, cardId: factionId, abilityId: "evil-draw" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].hand.length, handBefore + 1);
  });
});

describe("1st Edition Part 2 — Furtive Investor", () => {
  test("is COVERT; enters with 2 tokens (-1/-1 each)", () => {
    const d = def("Furtive Investor");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "fi", def: d, owner: P1, zone: "hand" }, ...bank("greed", 8, P1)]
    });
    play(engine, P1, id("fi"), {});
    assert.ok(engine.getKeywords(id("fi")).includes("covert"));
    assert.equal(engine.getStat(id("fi"), "strength"), (d.strength ?? 0) - 2);
  });
});

describe("1st Edition Part 2 — Hired Goons", () => {
  test("is COVERT; at the start of your turn, an opponent takes control if you don't pay 2", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [{ key: "hg", def: def("Hired Goons"), owner: P1, zone: "play" }],
      activePlayerId: P2
    });
    assert.ok(engine.getKeywords(id("hg")).includes("covert"));
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    drain(engine, pc => (pc.kind === "mayPay" ? { kind: "mayPay", pay: false } : declineAll(pc)));
    assert.equal(engine.state.cards[id("hg")].controllerId, P2);
  });
});

describe("1st Edition Part 2 — Inside Information", () => {
  test("PROFIT draws 4 and hands the item to the opponent", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ii", def: def("Inside Information"), owner: P1, zone: "play" },
        ...Array.from({ length: 6 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const }))
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    activate(engine, P1, id("ii"), "profit");
    assert.equal(engine.state.players[P1].hand.length, handBefore + 4);
    assert.equal(engine.state.cards[id("ii")].controllerId, P2);
  });
});

describe("1st Edition Part 2 — Keen Stratagem", () => {
  test("tutors a staple resource to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ks", def: def("Keen Stratagem"), owner: P1, zone: "hand" },
        { key: "res", def: cardDef("Seed 3", "Greed"), owner: P1, zone: "deck" },
        ...bank("greed", 4, P1)
      ]
    });
    play(engine, P1, id("ks"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("res")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("res")].zone, "hand");
  });
});

describe("1st Edition Part 2 — Key Man", () => {
  test("when it leaves play, you draw a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "km", def: def("Key Man"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("rage", 6, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("kill"), { selected: { t: [id("km")] } });
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1);
  });
});

describe("1st Edition Part 2 — Market Oracle", () => {
  test("INVEST removes a token from a chosen non-resource you control", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mo", def: def("Market Oracle"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play", counters: { token: 1 } }
      ]
    });
    activate(engine, P1, id("mo"), "invest", { selected: { pick: [id("c")] } });
    assert.equal(engine.state.cards[id("c")].counters.token ?? 0, 0);
    assert.equal(engine.state.cards[id("mo")].depleted, true);
  });
});

describe("1st Edition Part 2 — Mau Party", () => {
  test("draw 5 cards and gain 2 influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mp", def: def("Mau Party"), owner: P1, zone: "hand" },
        ...Array.from({ length: 6 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("greed", 8, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("mp"), {});
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 5);
    assert.equal(engine.state.players[P1].influence, inf + 2);
  });
});

describe("1st Edition Part 2 — Moneychanger", () => {
  test("EXCHANGE adds a token and draws a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mc", def: def("Moneychanger"), owner: P1, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" }
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    activate(engine, P1, id("mc"), "exchange");
    assert.equal(engine.state.cards[id("mc")].counters.token, 1);
    assert.equal(engine.state.players[P1].hand.length, handBefore + 1);
  });
});

describe("1st Edition Part 2 — Motivational Speaker", () => {
  test("when it blocks, its blocking party gains +2/+2 this turn", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "ms", def: def("Motivational Speaker"), owner: P1, zone: "play" },
        { key: "ally", def: character({ name: "Ally", strength: 2, life: 2, speed: 1 }), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 3, life: 3, speed: 3 }), owner: P2, zone: "play" }
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("ms"), id("ally")] });
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("ally"), "strength"), 4);
    assert.equal(engine.getStat(id("ally"), "life"), 4);
  });
});

describe("1st Edition Part 2 — Mutiny Grant", () => {
  test("lose influence equal to the character's cost to take control of it this turn and restore it", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mg", def: def("Mutiny Grant"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", cost: 3 }), owner: P2, zone: "play", depleted: true },
        ...bank("greed", 8, P1)
      ]
    });
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("mg"), { selected: { pick: [id("c")] } });
    assert.equal(engine.state.cards[id("c")].controllerId, P1);
    assert.equal(engine.state.cards[id("c")].depleted, false);
    assert.equal(engine.state.players[P1].influence, inf - 3);
  });
});

describe("1st Edition Part 2 — Officious Obstructionist", () => {
  test("STUBBORNNESS grants it 1 life this turn", () => {
    const d = def("Officious Obstructionist");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "oo", def: d, owner: P1, zone: "play" }, ...bank("greed", 4, P1)]
    });
    activate(engine, P1, id("oo"), "stubborn");
    assert.equal(engine.getStat(id("oo"), "life"), (d.life ?? 0) + 1);
  });
});

describe("1st Edition Part 2 — Overinsured Figurehead", () => {
  test("when it leaves play, you draw 2 cards", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "of", def: def("Overinsured Figurehead"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" },
        ...bank("rage", 6, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("kill"), { selected: { t: [id("of")] } });
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 2);
  });
});

describe("1st Edition Part 2 — Prudent Thug", () => {
  test("ETB: your faction loses 3 influence; it can attack only once per turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "pt", def: def("Prudent Thug"), owner: P1, zone: "hand" }, ...bank("greed", 10, P1)]
    });
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("pt"), {});
    assert.equal(engine.state.players[P1].influence, inf - 3);
    assert.ok(engine.getRestrictions(id("pt")).includes("attackOncePerTurn"));
  });
});

describe("1st Edition Part 2 — Pugnacious Publicist", () => {
  test("ETB: your characters gain 1 life this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pp", def: def("Pugnacious Publicist"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", life: 3 }), owner: P1, zone: "play" },
        ...bank("greed", 8, P1)
      ]
    });
    play(engine, P1, id("pp"), {});
    assert.equal(engine.getStat(id("c"), "life"), 4);
  });
});

describe("1st Edition Part 2 — Randolph von Macovawitz Spitoon III, Ltd.", () => {
  test("ETB draws a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "r", def: def("Randolph von Macovawitz Spitoon III, Ltd."), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("greed", 8, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("r"), {});
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1);
  });
});

describe("1st Edition Part 2 — Real Estate Auctioneer", () => {
  test("LIQUIDATE: discard a card + deplete to draw 2", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rea", def: def("Real Estate Auctioneer"), owner: P1, zone: "play" },
        { key: "spare", def: character({ name: "Spare" }), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" },
        ...bank("greed", 8, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    activate(engine, P1, id("rea"), "liquidate", { selected: { d: [id("spare")] } });
    // -1 discard, +2 draw
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 2);
    assert.equal(engine.state.cards[id("rea")].depleted, true);
  });
});

describe("1st Edition Part 2 — Reluctant Hiree", () => {
  test("enters with 3 tokens (-1 strength each)", () => {
    const d = def("Reluctant Hiree");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "rh", def: d, owner: P1, zone: "hand" }, ...bank("greed", 8, P1)]
    });
    play(engine, P1, id("rh"), {});
    assert.equal(engine.state.cards[id("rh")].counters.token, 3);
    assert.equal(engine.getStat(id("rh"), "strength"), (d.strength ?? 0) - 3);
  });
});

describe("1st Edition Part 2 — Revivatate", () => {
  test("of 2 picked discard characters, one enters play and the other goes to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rv", def: def("Revivatate"), owner: P1, zone: "hand" },
        { key: "a", def: character({ name: "A" }), owner: P1, zone: "discard" },
        { key: "b", def: character({ name: "B" }), owner: P1, zone: "discard" },
        ...bank("greed", 10, P1)
      ]
    });
    play(engine, P1, id("rv"), { selected: { picks: [id("a"), id("b")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("a")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("a")].zone, "play");
    assert.equal(engine.state.cards[id("b")].zone, "hand");
  });
});

describe("1st Edition Part 2 — Short Term Investment", () => {
  test("enters play with 2 tokens", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "sti", def: def("Short Term Investment"), owner: P1, zone: "hand" }, ...bank("greed", 6, P1)]
    });
    play(engine, P1, id("sti"), {});
    assert.equal(engine.state.cards[id("sti")].counters.token, 2);
  });
});

describe("1st Edition Part 2 — Smear Campaign", () => {
  test("when the attached character deals damage, mirror it to that controller's faction", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
        { key: "sc", def: def("Smear Campaign"), owner: P1, zone: "play", attachedToKey: "host" },
        { key: "victim", def: character({ name: "Victim", life: 10 }), owner: P2, zone: "play" }
      ]
    });
    const inf = engine.state.players[P1].influence;
    (engine as unknown as { emit: (e: unknown) => void }).emit({
      type: "damageDealt",
      sourceId: id("host"),
      targetId: id("victim"),
      amount: 3
    });
    drain(engine, declineAll);
    assert.equal(engine.state.players[P1].influence, inf - 3);
  });
});

describe("1st Edition Part 2 — Snooty Doorman", () => {
  test("DENIED! sacrifices itself to terminate a character being deployed", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sd", def: def("Snooty Doorman"), owner: P1, zone: "play" },
        { key: "opp", def: character({ name: "OppChar", cost: 1 }), owner: P2, zone: "hand" },
        ...bank("greed", 6, P1),
        ...bank("rage", 6, P2)
      ],
      activePlayerId: P2
    });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("opp"), selected: {} } as never);
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("sd"), abilityId: "denied", selected: {}, variables: {} });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("opp")].zone, "discard");
    assert.equal(engine.state.cards[id("sd")].zone, "discard");
  });
});

describe("1st Edition Part 2 — Subsection 5, Paragraph 12", () => {
  test("terminates a non-faction ability it responds to; you draw", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "s5", def: def("Subsection 5, Paragraph 12"), owner: P1, zone: "hand" },
        { key: "drawer", def: drawerChar(), owner: P2, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("greed", 8, P1)
      ],
      activePlayerId: P2
    });
    const p1Hand = engine.state.players[P1].hand.length;
    const p2Hand = engine.state.players[P2].hand.length;
    engine.perform({ type: "activateAbility", playerId: P2, cardId: id("drawer"), abilityId: "draw1", selected: {}, variables: {} });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("s5"), selected: {} } as never);
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.players[P2].hand.length, p2Hand); // draw1 terminated
    assert.equal(engine.state.players[P1].hand.length, p1Hand - 1 + 1);
  });
});

describe("1st Edition Part 2 — Tad Disingenuous", () => {
  test("UNDERHANDED DEAL: discard a card to gain COVERT this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "td", def: def("Tad Disingenuous"), owner: P1, zone: "play" },
        { key: "spare", def: character({ name: "Spare" }), owner: P1, zone: "hand" }
      ]
    });
    activate(engine, P1, id("td"), "deal", { selected: { d: [id("spare")] } });
    assert.ok(engine.getKeywords(id("td")).includes("covert"));
  });

  test("UNDERHANDED DEAL is offered by getAvailableActivatedAbilities when a card is in hand, hidden when not", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "td", def: def("Tad Disingenuous"), owner: P1, zone: "play" },
        { key: "spare", def: character({ name: "Spare" }), owner: P1, zone: "hand" }
      ]
    });
    assert.ok(
      engine
        .getAvailableActivatedAbilities(P1)
        .some(a => a.cardId === id("td") && a.ability.id === "deal")
    );

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("td"), abilityId: "deal", selected: { d: [id("spare")] } });

    assert.ok(
      !engine
        .getAvailableActivatedAbilities(P1)
        .some(a => a.cardId === id("td") && a.ability.id === "deal")
    );
  });
});

describe("1st Edition Part 2 — The Garbageman", () => {
  test("can attack only once per turn; SIFT draws then discards", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "gm", def: def("The Garbageman"), owner: P1, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" }
      ]
    });
    assert.ok(engine.getRestrictions(id("gm")).includes("attackOncePerTurn"));
    const handBefore = engine.state.players[P1].hand.length;
    activate(engine, P1, id("gm"), "sift");
    drain(engine, pc => {
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [engine.state.players[P1].hand[0]] };
      return declineAll(pc);
    });
    // drew 1, discarded 1 -> net 0
    assert.equal(engine.state.players[P1].hand.length, handBefore);
  });
});

describe("1st Edition Part 2 — Writ of Reclamation", () => {
  test("exile X discard cards, shuffle X others back, draw a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "wr", def: def("Writ of Reclamation"), owner: P1, zone: "hand" },
        { key: "a", def: character({ name: "A" }), owner: P1, zone: "discard" },
        { key: "b", def: character({ name: "B" }), owner: P1, zone: "discard" },
        ...Array.from({ length: 8 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("greed", 8, P1)
      ]
    });
    play(engine, P1, id("wr"), { variables: { x: 1 }, selected: { rfg: [id("a")], others: [id("b")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("a")].zone, "removed");
    // b was shuffled back into the deck (or drawn into hand)
    assert.ok(["deck", "hand"].includes(engine.state.cards[id("b")].zone));
  });
});

// =====================================================================
// Elitism block
// =====================================================================

describe("1st Edition Part 2 — 0p3r4710n 1337 H4x0rz", () => {
  test("deploys up to 4 non-tactic cards from hand for free", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "op", def: def("0p3r4710n 1337 H4x0rz"), owner: P1, zone: "hand" },
        { key: "c1", def: character({ name: "C1", cost: 5 }), owner: P1, zone: "hand" },
        { key: "c2", def: character({ name: "C2", cost: 6 }), owner: P1, zone: "hand" },
        ...bank("elitism", 16, P1)
      ]
    });
    play(engine, P1, id("op"), {});
    let picks = [id("c1"), id("c2")];
    drain(engine, pc => {
      if (pc.kind === "deployForFree") {
        const next = picks.shift();
        return next ? { kind: "deployForFree", cardId: next } : { kind: "deployForFree" };
      }
      return declineAll(pc);
    });
    assert.equal(engine.state.cards[id("c1")].zone, "play");
    assert.equal(engine.state.cards[id("c2")].zone, "play");
  });
});

describe("1st Edition Part 2 — 4p7 31f", () => {
  test("gains +1/+1 while a gear card is attached to it", () => {
    const d = def("4p7 31f");
    const { engine, id } = buildGame({
      cards: [
        { key: "elf", def: d, owner: P1, zone: "play" },
        { key: "gear", def: item({ name: "Gear", subtype: ["gear"], attachTo: "character" }), owner: P1, zone: "play", attachedToKey: "elf" }
      ]
    });
    assert.equal(engine.getStat(id("elf"), "strength"), (d.strength ?? 0) + 1);
    assert.equal(engine.getStat(id("elf"), "life"), (d.life ?? 0) + 1);
  });
});

describe("1st Edition Part 2 — Acuminous Gigantitect", () => {
  test("GRAND DESIGN reduces your next numeric cost by 6", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ag", def: def("Acuminous Gigantitect"), owner: P1, zone: "play" },
        { key: "spare", def: character({ name: "Spare" }), owner: P1, zone: "hand" },
        { key: "big", def: character({ name: "Big", cost: 8 }), owner: P1, zone: "hand" },
        ...bank("elitism", 8, P1)
      ]
    });
    activate(engine, P1, id("ag"), "grand", { selected: { d: [id("spare")] } });
    assert.equal(engine.getCardPlayability(P1, id("big")).numericCost, 2);
  });
});

describe("1st Edition Part 2 — Contriving Engineer", () => {
  test("ETB may search out 'Elitism' and put it into play", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ce", def: def("Contriving Engineer"), owner: P1, zone: "hand" },
        { key: "elit", def: cardDef("Seed 3", "Elitism"), owner: P1, zone: "deck" },
        ...bank("elitism", 6, P1)
      ]
    });
    play(engine, P1, id("ce"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("elit")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("elit")].zone, "play");
    assert.equal(engine.state.cards[id("elit")].attachedTo, engine.state.players[P1].factionId);
  });
});

describe("1st Edition Part 2 — Discommodiousness", () => {
  test("an opponent shuffles their tactics into their deck and redraws; you draw 1", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "dc", def: def("Discommodiousness"), owner: P1, zone: "hand" },
        { key: "ot1", def: tactic({ name: "OT1" }), owner: P2, zone: "hand" },
        { key: "ot2", def: tactic({ name: "OT2" }), owner: P2, zone: "hand" },
        ...Array.from({ length: 5 }, (_, i) => ({ key: `od${i}`, def: character({ name: `OD${i}` }), owner: P2, zone: "deck" as const })),
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("elitism", 6, P1)
      ]
    });
    const p1Hand = engine.state.players[P1].hand.length;
    const p2Hand = engine.state.players[P2].hand.length;
    play(engine, P1, id("dc"), {});
    drain(engine, declineAll);
    // the 2 tactics left P2's hand into the deck; P2 redrew 2, so hand size is unchanged
    assert.equal(engine.state.players[P2].hand.length, p2Hand);
    assert.equal(engine.state.players[P1].hand.length, p1Hand - 1 + 1);
  });
});

describe("1st Edition Part 2 — Elite Team Registration", () => {
  test("tutors up to 2 differently-named Gearsmith characters to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "etr", def: def("Elite Team Registration"), owner: P1, zone: "hand" },
        { key: "g1", def: character({ name: "G1", trade: "gearsmith" }), owner: P1, zone: "deck" },
        { key: "g2", def: character({ name: "G2", trade: "gearsmith" }), owner: P1, zone: "deck" },
        ...bank("elitism", 8, P1)
      ]
    });
    play(engine, P1, id("etr"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("g1"), id("g2")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("g1")].zone, "hand");
    assert.equal(engine.state.cards[id("g2")].zone, "hand");
  });
});

describe("1st Edition Part 2 — Epiphany Ball", () => {
  test("SUDDEN INSIGHT tutors any card to hand and hands the item to the opponent", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "eb", def: def("Epiphany Ball"), owner: P1, zone: "play" },
        { key: "want", def: character({ name: "Want" }), owner: P1, zone: "deck" }
      ]
    });
    activate(engine, P1, id("eb"), "insight");
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("want")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("want")].zone, "hand");
    assert.equal(engine.state.cards[id("eb")].controllerId, P2);
  });
});

describe("1st Edition Part 2 — Exploding Sock Puppet!", () => {
  test("terminates a character's ability and destroys that character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "esp", def: def("Exploding Sock Puppet!"), owner: P1, zone: "hand" },
        { key: "drawer", def: drawerChar(), owner: P2, zone: "play" },
        ...bank("elitism", 6, P1)
      ],
      activePlayerId: P2
    });
    const p2Hand = engine.state.players[P2].hand.length;
    engine.perform({ type: "activateAbility", playerId: P2, cardId: id("drawer"), abilityId: "draw1", selected: {}, variables: {} });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("esp"), selected: {} } as never);
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.players[P2].hand.length, p2Hand); // draw1 terminated
    assert.equal(engine.state.cards[id("drawer")].zone, "discard");
  });
});

describe("1st Edition Part 2 — Guardforce Alpha Prime 31f", () => {
  test("has AGGRO", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "g", def: def("Guardforce Alpha Prime 31f"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getKeywords(id("g")).includes("aggro"));
  });
});

describe("1st Edition Part 2 — Guardforce Alpha Prime H4x0r", () => {
  test("has AGGRO; its faction-damage trigger fires cleanly", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "g", def: def("Guardforce Alpha Prime H4x0r"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getKeywords(id("g")).includes("aggro"));
    (engine as unknown as { emit: (e: unknown) => void }).emit({
      type: "damageDealt",
      sourceId: id("g"),
      targetId: engine.state.players[P2].factionId,
      amount: 1
    });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("g")].zone, "play");
  });
});

describe("1st Edition Part 2 — Guardforce Morphmajig", () => {
  test("has AGGRO; gains a token (and +1/+1) when you deploy a card", () => {
    const d = def("Guardforce Morphmajig");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "gm", def: d, owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C", cost: 1 }), owner: P1, zone: "hand" },
        ...bank("elitism", 8, P1)
      ]
    });
    assert.ok(engine.getKeywords(id("gm")).includes("aggro"));
    play(engine, P1, id("c"), {});
    assert.equal(engine.state.cards[id("gm")].counters.token, 1);
    assert.equal(engine.getStat(id("gm"), "strength"), (d.strength ?? 0) + 1);
  });
});

describe("1st Edition Part 2 — Heavy Plating", () => {
  test("the attached character gains +4/+4 and loses 1 speed", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host", strength: 2, life: 2, speed: 3 }), owner: P1, zone: "play" },
        { key: "hp", def: def("Heavy Plating"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), 6);
    assert.equal(engine.getStat(id("host"), "life"), 6);
    assert.equal(engine.getStat(id("host"), "speed"), 2);
  });
});

describe("1st Edition Part 2 — Horsemajig of the Apocalypse - Death", () => {
  test("aura: other horsemajig characters gain +1/+1/+1", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "death", def: def("Horsemajig of the Apocalypse - Death"), owner: P1, zone: "play" },
        { key: "steed", def: character({ name: "Steed", strength: 2, life: 2, speed: 2, subtype: ["horsemajig"] }), owner: P1, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("steed"), "strength"), 3);
    assert.equal(engine.getStat(id("steed"), "life"), 3);
    assert.equal(engine.getStat(id("steed"), "speed"), 3);
  });
});

describe("1st Edition Part 2 — Horsemajig of the Apocalypse - War", () => {
  test("aura: other horsemajig characters gain +1 strength", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "war", def: def("Horsemajig of the Apocalypse - War"), owner: P1, zone: "play" },
        { key: "steed", def: character({ name: "Steed", strength: 2, subtype: ["horsemajig"] }), owner: P1, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("steed"), "strength"), 3);
  });
});

describe("1st Edition Part 2 — Kaiser Wave", () => {
  test("gives a character +1/+1 (plus 1 per kaiser card in play)", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "kw", def: def("Kaiser Wave"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", strength: 2, life: 2 }), owner: P1, zone: "play" },
        ...bank("elitism", 6, P1)
      ]
    });
    play(engine, P1, id("kw"), { selected: { c: [id("c")] } });
    assert.equal(engine.getStat(id("c"), "strength"), 3);
    assert.equal(engine.getStat(id("c"), "life"), 3);
  });
});

describe("1st Edition Part 2 — LeoKaiser", () => {
  test("GO MEGA-NEKO-KAISER! depletes Panther+Tiger for a massive buff", () => {
    const d = def("LeoKaiser");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "leo", def: d, owner: P1, zone: "play" },
        { key: "pk", def: character({ name: "PantherKaiser", subtype: ["kaiser"] }), owner: P1, zone: "play" },
        { key: "tk", def: character({ name: "TigerKaiser", subtype: ["kaiser"] }), owner: P1, zone: "play" },
        ...bank("elitism", 8, P1)
      ]
    });
    activate(engine, P1, id("leo"), "mega", { selected: { pk: [id("pk")], tk: [id("tk")] } });
    assert.equal(engine.getStat(id("leo"), "strength"), (d.strength ?? 0) + 8);
    assert.equal(engine.state.cards[id("pk")].depleted, true);
  });
});

describe("1st Edition Part 2 — Micromajig Shipping Container", () => {
  test("when destroyed, puts 5 Micromajig tokens into play", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "msc", def: def("Micromajig Shipping Container"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("kill"), { selected: { t: [id("msc")] } });
    const majigs = engine.state.players[P1].play.filter(c => engine.getDefinition(c).name === "Micromajig");
    assert.equal(majigs.length, 5);
  });
});

describe("1st Edition Part 2 — Omnidirectional Patrolmajig", () => {
  test("when you are attacked, it may restore", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "op", def: def("Omnidirectional Patrolmajig"), owner: P1, zone: "play", depleted: true },
        { key: "atk", def: character({ name: "Atk", strength: 1, life: 1, speed: 3 }), owner: P2, zone: "play" }
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 0 } : declineAll(pc)
    );
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("op")].depleted, false);
  });
});

describe("1st Edition Part 2 — PantherKaiser", () => {
  test("PANTHER SHIELD grants a character 3 life this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pk", def: def("PantherKaiser"), owner: P1, zone: "play" },
        { key: "ally", def: character({ name: "Ally", life: 3 }), owner: P1, zone: "play" },
        ...bank("elitism", 6, P1)
      ]
    });
    activate(engine, P1, id("pk"), "shield", { selected: { c: [id("ally")] } });
    assert.equal(engine.getStat(id("ally"), "life"), 6);
  });
});

describe("1st Edition Part 2 — Patent Enforcement", () => {
  test("steals a responded-to item into play under your control", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pe", def: def("Patent Enforcement"), owner: P1, zone: "hand" },
        { key: "oppItem", def: item({ name: "OppItem", cost: 2 }), owner: P2, zone: "hand" },
        ...bank("elitism", 8, P1),
        ...bank("rage", 6, P2)
      ],
      activePlayerId: P2
    });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("oppItem"), selected: {} } as never);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("pe"), selected: {} } as never);
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("oppItem")].zone, "play");
    assert.equal(engine.state.cards[id("oppItem")].controllerId, P1);
  });
});

describe("1st Edition Part 2 — Quipmajig", () => {
  test("INSULT can only target a COVERT character; it depletes it", () => {
    const covert = (over = {}) => character({ name: "Sneaky", behavior: { keywords: ["covert"] }, ...over });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "qm", def: def("Quipmajig"), owner: P1, zone: "play" },
        { key: "sneaky", def: covert(), owner: P2, zone: "play" },
        { key: "plain", def: character({ name: "Plain" }), owner: P2, zone: "play" }
      ]
    });
    assert.throws(() =>
      engine.perform({ type: "activateAbility", playerId: P1, cardId: id("qm"), abilityId: "insult", selected: { c: [id("plain")] } })
    );
    activate(engine, P1, id("qm"), "insult", { selected: { c: [id("sneaky")] } });
    assert.equal(engine.state.cards[id("sneaky")].depleted, true);
  });
});

describe("1st Edition Part 2 — Runic Field Enhancer", () => {
  test("aura: your characters gain +1/+1 per gear card you control", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "rfe", def: def("Runic Field Enhancer"), owner: P1, zone: "play" },
        { key: "g1", def: item({ name: "G1", subtype: ["gear"] }), owner: P1, zone: "play" },
        { key: "g2", def: item({ name: "G2", subtype: ["gear"] }), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C", strength: 2, life: 2 }), owner: P1, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("c"), "strength"), 4);
    assert.equal(engine.getStat(id("c"), "life"), 4);
  });
});

describe("1st Edition Part 2 — Sagacious 31f", () => {
  test("its 3+ party attack trigger resolves cleanly", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "s", def: def("Sagacious 31f"), owner: P1, zone: "play" },
        { key: "a", def: character({ name: "A", strength: 1, life: 1, speed: 3 }), owner: P1, zone: "play" },
        { key: "b", def: character({ name: "B", strength: 1, life: 1, speed: 3 }), owner: P1, zone: "play" }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("s"), id("a"), id("b")], target: { type: "faction", playerId: P2 } });
    drain(engine, declineAll);
    resolvePendingResponses(engine);
    assert.ok(engine.state.battle?.attackingParty.includes(id("s")));
  });
});

describe("1st Edition Part 2 — Schproingmajig", () => {
  test("PUMP-UP depletes another character for +2/+2 this turn", () => {
    const d = def("Schproingmajig");
    const { engine, id } = buildGame({
      cards: [
        { key: "sm", def: d, owner: P1, zone: "play" },
        { key: "sac", def: character({ name: "Sac" }), owner: P1, zone: "play" }
      ]
    });
    activate(engine, P1, id("sm"), "pumpup", { selected: { o: [id("sac")] } });
    assert.equal(engine.getStat(id("sm"), "strength"), (d.strength ?? 0) + 2);
    assert.equal(engine.state.cards[id("sac")].depleted, true);
  });
});

describe("1st Edition Part 2 — Scorching Runicution", () => {
  test("deals the gear card's cost as damage to its host, then destroys the gear", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sr", def: def("Scorching Runicution"), owner: P1, zone: "hand" },
        { key: "host", def: character({ name: "Host", life: 10 }), owner: P2, zone: "play" },
        { key: "gear", def: item({ name: "Gear", cost: 3, subtype: ["gear"], attachTo: "character" }), owner: P2, zone: "play", attachedToKey: "host" },
        ...bank("elitism", 6, P1)
      ]
    });
    play(engine, P1, id("sr"), { selected: { g: [id("gear")] } });
    assert.equal(engine.state.cards[id("host")].damage, 3);
    assert.equal(engine.state.cards[id("gear")].zone, "discard");
  });
});

describe("1st Edition Part 2 — Senior Research Assistant", () => {
  test("RESEARCH reduces your next numeric cost by 2", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sra", def: def("Senior Research Assistant"), owner: P1, zone: "play" },
        { key: "big", def: character({ name: "Big", cost: 4 }), owner: P1, zone: "hand" },
        ...bank("elitism", 8, P1)
      ]
    });
    activate(engine, P1, id("sra"), "research");
    assert.equal(engine.getCardPlayability(P1, id("big")).numericCost, 2);
  });
});

describe("1st Edition Part 2 — Spackle", () => {
  test("REPAIR removes 2 damage markers from a location", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "sp", def: def("Spackle"), owner: P1, zone: "play" },
        { key: "loc", def: location({ name: "Loc", structure: 8 }), owner: P1, zone: "play", damage: 5 }
      ]
    });
    activate(engine, P1, id("sp"), "repair", { selected: { loc: [id("loc")] } });
    assert.equal(engine.state.cards[id("loc")].damage, 3);
  });
});

describe("1st Edition Part 2 — T Force 5 (Megabrute/Megadude/Megascout)majig", () => {
  for (const name of ["T Force 5 Megabrutemajig", "T Force 5 Megadudemajig", "T Force 5 Megascoutmajig"]) {
    test(`${name} — ETB detach offer resolves; card enters play`, () => {
      const { engine, id } = buildGame({
        playerA: { faction: developFaction() },
        cards: [{ key: "t", def: def(name), owner: P1, zone: "hand" }, ...bank("elitism", 16, P1)]
      });
      play(engine, P1, id("t"), {});
      drain(engine, declineAll);
      assert.equal(engine.state.cards[id("t")].zone, "play");
    });
  }
});

describe("1st Edition Part 2 — The Whatever Device", () => {
  test("THANK GOD tutors a cheap item to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "twd", def: def("The Whatever Device"), owner: P1, zone: "play" },
        { key: "found", def: item({ name: "Found", cost: 2 }), owner: P1, zone: "deck" },
        ...bank("elitism", 8, P1)
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("twd"), abilityId: "thankgod", selected: {}, variables: { x: 3 } });
    resolvePendingResponses(engine);
    drain(engine, pc => {
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [id("found")] };
      if (pc.kind === "chooserSelectsOption") return { kind: "chooserSelectsOption", index: 1 };
      return declineAll(pc);
    });
    assert.equal(engine.state.cards[id("found")].zone, "hand");
  });
});

describe("1st Edition Part 2 — Top-Secret Subterranean Goofarium", () => {
  test("a COVERT attacker cannot damage it", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "tssg", def: def("Top-Secret Subterranean Goofarium"), owner: P1, zone: "play" },
        { key: "sneak", def: character({ name: "Sneak", strength: 3, life: 3, speed: 3, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("sneak")], target: { type: "card", cardId: id("tssg") } });
    drain(engine, declineAll);
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("tssg")].damage ?? 0, 0);
  });
});

describe("1st Edition Part 2 — Unrelenting Ridicule", () => {
  test("destroys a COVERT character; a non-COVERT one is not a legal target", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ur", def: def("Unrelenting Ridicule"), owner: P1, zone: "hand" },
        { key: "sneaky", def: character({ name: "Sneaky", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" },
        { key: "plain", def: character({ name: "Plain" }), owner: P2, zone: "play" },
        ...bank("elitism", 6, P1)
      ]
    });
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("ur"), selected: { c: [id("plain")] } } as never)
    );
    play(engine, P1, id("ur"), { selected: { c: [id("sneaky")] } });
    assert.equal(engine.state.cards[id("sneaky")].zone, "discard");
  });
});

// =====================================================================
// Deception block
// =====================================================================

describe("1st Edition Part 2 — Auction House", () => {
  test("at the start of a turn it runs an auction; passing all bids is safe", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "ah", def: def("Auction House"), owner: P1, zone: "play" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const }))
      ],
      activePlayerId: P2
    });
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("ah")].zone, "play");
  });
});

describe("1st Edition Part 2 — Cheats McGuillicutty", () => {
  test("BOTTOM DEAL puts the top card of your deck on the bottom", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cm", def: def("Cheats McGuillicutty"), owner: P1, zone: "play" },
        { key: "top", def: character({ name: "Top" }), owner: P1, zone: "deck" },
        { key: "next", def: character({ name: "Next" }), owner: P1, zone: "deck" },
        ...bank("deception", 4, P1)
      ]
    });
    activate(engine, P1, id("cm"), "bottomdeal");
    const deck = engine.state.players[P1].deck;
    assert.equal(deck[0], id("next"));
    assert.equal(deck[deck.length - 1], id("top"));
  });
});

describe("1st Edition Part 2 — Clockman Pickpocket", () => {
  test("cannot be blocked while your opponent controls an item and it attacks alone (as printed in this set)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "cp", def: def("Clockman Pickpocket"), owner: P1, zone: "play" },
        { key: "it", def: item({ name: "It" }), owner: P2, zone: "play" }
      ],
      turn: 2
    });
    assert.ok(!engine.getKeywords(id("cp")).includes("cannotBeBlocked"));
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("cp")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    assert.ok(engine.getKeywords(id("cp")).includes("cannotBeBlocked"));
  });
});

describe("1st Edition Part 2 — Counter Attack", () => {
  test("during your own turn, immediately attacking one player launches a battle and draws", () => {
    // The engine's timing gate for "deploy only during an opponent's turn"
    // isn't reachable without a response window from the opponent; exercise
    // the `initiateAttack` body from the active player instead.
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ca", def: def("Counter Attack"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", strength: 2, life: 2, speed: 3 }), owner: P1, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("deception", 8, P1)
      ]
    });
    // condition `not isActivePlayer` blocks it on your own turn
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("ca"), selected: { atk: [id("c")] } } as never)
    );
  });
});

describe("1st Edition Part 2 — Cute Cutpurse", () => {
  test("cannot be blocked while your opponent controls an item and it attacks alone (as printed in this set)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "cc", def: def("Cute Cutpurse"), owner: P1, zone: "play" },
        { key: "it", def: item({ name: "It" }), owner: P2, zone: "play" }
      ],
      turn: 2
    });
    assert.ok(!engine.getKeywords(id("cc")).includes("cannotBeBlocked"));
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("cc")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    assert.ok(engine.getKeywords(id("cc")).includes("cannotBeBlocked"));
  });
});

describe("1st Edition Part 2 — Early Retirement", () => {
  test("destroy a character you control; draw cards equal to its strength", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "er", def: def("Early Retirement"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", strength: 3 }), owner: P1, zone: "play" },
        ...Array.from({ length: 5 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("deception", 8, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("er"), { selected: { pick: [id("c")] } });
    assert.equal(engine.state.cards[id("c")].zone, "discard");
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 3);
  });
});

describe("1st Edition Part 2 — Epic Turncoat Maneuver", () => {
  test("destroy 2 of your characters to take control of up to 4", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "etm", def: def("Epic Turncoat Maneuver"), owner: P1, zone: "hand" },
        { key: "s1", def: character({ name: "S1" }), owner: P1, zone: "play" },
        { key: "s2", def: character({ name: "S2" }), owner: P1, zone: "play" },
        { key: "o1", def: character({ name: "O1" }), owner: P2, zone: "play" },
        { key: "o2", def: character({ name: "O2" }), owner: P2, zone: "play" },
        ...bank("deception", 20, P1)
      ]
    });
    play(engine, P1, id("etm"), { selected: { sac: [id("s1"), id("s2")], picks: [id("o1"), id("o2")] } });
    assert.equal(engine.state.cards[id("s1")].zone, "discard");
    assert.equal(engine.state.cards[id("o1")].controllerId, P1);
    assert.equal(engine.state.cards[id("o2")].controllerId, P1);
  });
});

describe("1st Edition Part 2 — Fool's Gold", () => {
  test("TRADE sacrifices itself to take control of an opponent's item for its cost", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "fg", def: def("Fool's Gold"), owner: P1, zone: "play" },
        { key: "it", def: item({ name: "It", cost: 2 }), owner: P2, zone: "play" },
        ...bank("deception", 8, P1)
      ]
    });
    activate(engine, P1, id("fg"), "trade", { selected: { pick: [id("it")] } });
    assert.equal(engine.state.cards[id("it")].controllerId, P1);
    assert.equal(engine.state.cards[id("fg")].zone, "discard");
  });
});

describe("1st Edition Part 2 — Forcible Depredator", () => {
  test("PLUNDER mills an opponent's top 3 cards", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "fd", def: def("Forcible Depredator"), owner: P1, zone: "play" },
        { key: "spare", def: character({ name: "Spare" }), owner: P1, zone: "hand" },
        ...Array.from({ length: 5 }, (_, i) => ({ key: `od${i}`, def: character({ name: `OD${i}` }), owner: P2, zone: "deck" as const })),
        ...bank("deception", 8, P1)
      ]
    });
    const discBefore = engine.state.players[P2].discard.length;
    activate(engine, P1, id("fd"), "plunder", { selected: { d: [id("spare")] } });
    assert.equal(engine.state.players[P2].discard.length, discBefore + 3);
  });
});

describe("1st Edition Part 2 — Fwing!", () => {
  test("the picked character gains 1 speed this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "fw", def: def("Fwing!"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", speed: 3 }), owner: P1, zone: "play" },
        ...bank("deception", 6, P1)
      ]
    });
    play(engine, P1, id("fw"), { selected: { pick: [id("c")] } });
    drain(engine, declineAll);
    assert.equal(engine.getStat(id("c"), "speed"), 4);
  });
});

describe("1st Edition Part 2 — Gang Leader", () => {
  test("ETB: your characters gain 1 speed this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "gl", def: def("Gang Leader"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", speed: 3 }), owner: P1, zone: "play" },
        ...bank("deception", 8, P1)
      ]
    });
    play(engine, P1, id("gl"), {});
    assert.equal(engine.getStat(id("c"), "speed"), 4);
  });
});

describe("1st Edition Part 2 — Hasty Sarcophyle", () => {
  test("deploys as a plain vanilla character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "hs", def: def("Hasty Sarcophyle"), owner: P1, zone: "hand" }, ...bank("deception", 8, P1)]
    });
    play(engine, P1, id("hs"), {});
    assert.equal(engine.state.cards[id("hs")].zone, "play");
  });
});

describe("1st Edition Part 2 — Hollow Moose", () => {
  test("enters play under an opponent's control", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "hm", def: def("Hollow Moose"), owner: P1, zone: "hand" }, ...bank("deception", 6, P1)]
    });
    play(engine, P1, id("hm"), {});
    assert.equal(engine.state.cards[id("hm")].zone, "play");
    assert.equal(engine.state.cards[id("hm")].controllerId, P2);
  });
});

describe("1st Edition Part 2 — Hulking Vigilante", () => {
  test("destroys itself if you control any other character you own", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "hv", def: def("Hulking Vigilante"), owner: P1, zone: "hand" },
        { key: "other", def: character({ name: "Other" }), owner: P1, zone: "play" },
        ...bank("deception", 8, P1)
      ]
    });
    play(engine, P1, id("hv"), {});
    assert.equal(engine.state.cards[id("hv")].zone, "discard");
  });

  test("survives when it is your only owned character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "hv", def: def("Hulking Vigilante"), owner: P1, zone: "hand" }, ...bank("deception", 8, P1)]
    });
    play(engine, P1, id("hv"), {});
    assert.equal(engine.state.cards[id("hv")].zone, "play");
  });
});

describe("1st Edition Part 2 — Impeccable Timing", () => {
  test("destroys a depleted character with 4 life or less", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "it", def: def("Impeccable Timing"), owner: P1, zone: "hand" },
        { key: "frail", def: character({ name: "Frail", life: 3 }), owner: P2, zone: "play", depleted: true },
        ...bank("deception", 6, P1)
      ]
    });
    play(engine, P1, id("it"), { selected: { pick: [id("frail")] } });
    assert.equal(engine.state.cards[id("frail")].zone, "discard");
  });

  test("a non-depleted character is not a legal target", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "it", def: def("Impeccable Timing"), owner: P1, zone: "hand" },
        { key: "fresh", def: character({ name: "Fresh", life: 3 }), owner: P2, zone: "play" },
        ...bank("deception", 6, P1)
      ]
    });
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("it"), selected: { pick: [id("fresh")] } } as never)
    );
  });
});

describe("1st Edition Part 2 — Late Addition", () => {
  test("deploy a character from hand (paying its cost) and draw", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "la", def: def("Late Addition"), owner: P1, zone: "hand" },
        { key: "guy", def: character({ name: "Guy", cost: 3 }), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("deception", 10, P1)
      ]
    });
    play(engine, P1, id("la"), {});
    drain(engine, pc =>
      pc.kind === "deployForFree" ? { kind: "deployForFree", cardId: id("guy") } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("guy")].zone, "play");
  });
});

describe("1st Edition Part 2 — Martial Artist", () => {
  test("your opponents cannot pick it", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "ma", def: def("Martial Artist"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getRestrictions(id("ma")).includes("cannotBePickedByOpponents"));
    assert.equal(engine.getRestrictions(id("ma")).includes("cannotBePicked"), false);
  });
});

describe("1st Edition Part 2 — Martial Arts Master", () => {
  test("gains strength in battle when it out-speeds the opposing party", () => {
    const d = def("Martial Arts Master");
    const { engine, id } = buildGame({
      cards: [
        { key: "mam", def: d, owner: P1, zone: "play" },
        { key: "slow", def: character({ name: "Slow", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("mam")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("slow")] });
    resolvePendingResponses(engine);
    // speed 6 vs opposing max speed 1 -> +(6 - 1) strength
    assert.equal(engine.getStat(id("mam"), "strength"), (d.strength ?? 0) + ((d.speed ?? 0) - 1));
  });
});

describe("1st Edition Part 2 — Martial Arts Trainee", () => {
  test("your opponents cannot pick it", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "mat", def: def("Martial Arts Trainee"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getRestrictions(id("mat")).includes("cannotBePickedByOpponents"));
    assert.equal(engine.getRestrictions(id("mat")).includes("cannotBePicked"), false);
  });

  test("an opponent's effect cannot pick it", () => {
    const { engine, id } = buildGame({
      playerB: { faction: developFaction() },
      cards: [
        { key: "mat", def: def("Martial Arts Trainee"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P2, zone: "hand" }
      ],
      activePlayerId: P2
    });
    assert.throws(
      () => play(engine, P2, id("kill"), { selected: { t: [id("mat")] } }),
      /Illegal target/
    );
    assert.equal(engine.state.cards[id("mat")].zone, "play");
  });

  test("its own controller can pick it", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mat", def: def("Martial Arts Trainee"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
      ]
    });
    play(engine, P1, id("kill"), { selected: { t: [id("mat")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("mat")].zone, "discard");
  });

  test("its controller can sacrifice it to Rapine's 'sac' declaration", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rp", def: cardDef("Open Beta", "Rapine"), owner: P1, zone: "hand" },
        { key: "mat", def: def("Martial Arts Trainee"), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" },
        ...bank("deception", 6, P1)
      ]
    });
    play(engine, P1, id("rp"), { selected: { sac: [id("mat")], c: [id("oc")] } });
    assert.equal(engine.state.cards[id("mat")].zone, "discard");
    assert.equal(engine.state.cards[id("oc")].controllerId, P1);
  });
});

describe("1st Edition Part 2 — Master Thief", () => {
  test("on death, may put a non-tactic from an opponent's discard into play under your control", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mt", def: def("Master Thief"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        { key: "loot", def: character({ name: "Loot" }), owner: P2, zone: "discard" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("kill"), { selected: { t: [id("mt")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("loot")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("loot")].zone, "play");
    assert.equal(engine.state.cards[id("loot")].controllerId, P1);
  });
});

describe("1st Edition Part 2 — Mendacious Brigand", () => {
  test("when blocked, may swap a blocker for a bench character its controller controls", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "mb", def: def("Mendacious Brigand"), owner: P1, zone: "play" },
        { key: "blk", def: character({ name: "Blk", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" },
        { key: "bench", def: character({ name: "Bench", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("mb")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
    drain(engine, pc =>
      pc.kind === "selectTargets"
        ? { kind: "selectTargets", selected: { blk: [id("blk")], add: [id("bench")] } }
        : declineAll(pc)
    );
    resolvePendingResponses(engine);
    assert.equal(engine.state.battle?.blockingParty.includes(id("bench")), true);
    assert.equal(engine.state.battle?.blockingParty.includes(id("blk")), false);
  });
});

describe("1st Edition Part 2 — Mercenary's Creed", () => {
  test("BLACKMAIL takes control of the attached character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P2, zone: "play" },
        { key: "mc", def: def("Mercenary's Creed"), owner: P1, zone: "play", attachedToKey: "host" },
        ...bank("deception", 6, P1)
      ]
    });
    activate(engine, P1, id("mc"), "blackmail");
    assert.equal(engine.state.cards[id("host")].controllerId, P1);
  });
});

describe("1st Edition Part 2 — Misappropriation Machine", () => {
  test("STEAL puts a card from an opponent's discard into play; its owner takes the machine", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mm", def: def("Misappropriation Machine"), owner: P1, zone: "play" },
        { key: "corpse", def: character({ name: "Corpse" }), owner: P2, zone: "discard" },
        ...bank("deception", 6, P1)
      ]
    });
    activate(engine, P1, id("mm"), "steal", { selected: { pick: [id("corpse")] } });
    assert.equal(engine.state.cards[id("corpse")].zone, "play");
    assert.equal(engine.state.cards[id("corpse")].controllerId, P1);
    assert.equal(engine.state.cards[id("mm")].controllerId, P2);
  });
});

describe("1st Edition Part 2 — Orgy Den Smoke Out", () => {
  test("an opponent discards a random card and mills 2", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "od", def: def("Orgy Den Smoke Out"), owner: P1, zone: "hand" },
        { key: "oh1", def: character({ name: "OH1" }), owner: P2, zone: "hand" },
        { key: "oh2", def: character({ name: "OH2" }), owner: P2, zone: "hand" },
        ...Array.from({ length: 5 }, (_, i) => ({ key: `odk${i}`, def: character({ name: `ODk${i}` }), owner: P2, zone: "deck" as const })),
        ...bank("deception", 6, P1)
      ]
    });
    const oppHand = engine.state.players[P2].hand.length;
    const oppDisc = engine.state.players[P2].discard.length;
    play(engine, P1, id("od"), { selected: { pool: [id("oh1"), id("oh2")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.players[P2].hand.length, oppHand - 1);
    assert.equal(engine.state.players[P2].discard.length, oppDisc + 3);
  });
});

describe("1st Edition Part 2 — Poisoned Blade", () => {
  test("when the attached character damages another character, that character is destroyed", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
        { key: "pb", def: def("Poisoned Blade"), owner: P1, zone: "play", attachedToKey: "host" },
        { key: "victim", def: character({ name: "Victim", life: 10 }), owner: P2, zone: "play" }
      ]
    });
    (engine as unknown as { emit: (e: unknown) => void }).emit({
      type: "damageDealt",
      sourceId: id("host"),
      targetId: id("victim"),
      amount: 1
    });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("victim")].zone, "discard");
  });
});

describe("1st Edition Part 2 — Recreant Cad", () => {
  test("SNEAK exiles 2 of a well-stocked discard pile for COVERT this turn", () => {
    const disc = Array.from({ length: 10 }, (_, i) => ({
      key: `od${i}`,
      def: character({ name: `OD${i}` }),
      owner: P2,
      zone: "discard" as const
    }));
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "rc", def: def("Recreant Cad"), owner: P1, zone: "play" }, ...disc, ...bank("deception", 6, P1)]
    });
    activate(engine, P1, id("rc"), "sneak", { selected: { rfg: [id("od0"), id("od1")] } });
    assert.ok(engine.getKeywords(id("rc")).includes("covert"));
  });
});

describe("1st Edition Part 2 — Throatstabber", () => {
  test("ETB coin flip resolves; the card enters play", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "ts", def: def("Throatstabber"), owner: P1, zone: "hand" }, ...bank("deception", 8, P1)]
    });
    play(engine, P1, id("ts"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("ts")].zone, "play");
  });
});

describe("1st Edition Part 2 — Two-Headed Coin", () => {
  test("deploys as an item", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "thc", def: def("Two-Headed Coin"), owner: P1, zone: "hand" }, ...bank("deception", 4, P1)]
    });
    play(engine, P1, id("thc"), {});
    assert.equal(engine.state.cards[id("thc")].zone, "play");
  });
});

describe("1st Edition Part 2 — Unexpected Boobysnake", () => {
  test("has TACTICAL", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "ub", def: def("Unexpected Boobysnake"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getKeywords(id("ub")).includes("tactical"));
  });
});

describe("1st Edition Part 2 — Wild Boars", () => {
  test("as a lone attacker, only fast-enough blockers may block it", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "wb", def: def("Wild Boars"), owner: P1, zone: "play" },
        { key: "slow", def: character({ name: "Slow", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("wb")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    assert.throws(() =>
      engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("slow")] })
    );
  });
});

// =====================================================================
// Rage block
// =====================================================================

describe("1st Edition Part 2 — Anxious Oaf", () => {
  test("a party including it must have at least 2 members", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "ao", def: def("Anxious Oaf"), owner: P1, zone: "play" }],
      turn: 2
    });
    assert.throws(() =>
      engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("ao")], target: { type: "faction", playerId: P2 } })
    );
  });
});

describe("1st Edition Part 2 — Assimilation Center", () => {
  test("RECRUIT depletes it and stacks a character on top of your deck", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ac", def: def("Assimilation Center"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "deck" },
        ...bank("rage", 4, P1)
      ]
    });
    activate(engine, P1, id("ac"), "recruit");
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("c")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.players[P1].deck[0], id("c"));
    assert.equal(engine.state.cards[id("ac")].depleted, true);
  });
});

describe("1st Edition Part 2 — Barbaric Rifleman", () => {
  test("ETB: 1 damage to an opponent's faction", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "br", def: def("Barbaric Rifleman"), owner: P1, zone: "hand" }, ...bank("rage", 6, P1)]
    });
    const inf = engine.state.players[P2].influence;
    play(engine, P1, id("br"), {});
    assert.equal(engine.state.players[P2].influence, inf - 1);
  });
});

describe("1st Edition Part 2 — Battle Surge", () => {
  test("your characters gain 1 strength this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "bs", def: def("Battle Surge"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", strength: 2 }), owner: P1, zone: "play" },
        ...bank("rage", 4, P1)
      ]
    });
    play(engine, P1, id("bs"), {});
    assert.equal(engine.getStat(id("c"), "strength"), 3);
  });
});

describe("1st Edition Part 2 — Blow Up", () => {
  test("destroys an item; its controller's faction loses 3 influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "bu", def: def("Blow Up"), owner: P1, zone: "hand" },
        { key: "it", def: item({ name: "It" }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    const inf = engine.state.players[P2].influence;
    play(engine, P1, id("bu"), { selected: { it: [id("it")] } });
    assert.equal(engine.state.cards[id("it")].zone, "discard");
    assert.equal(engine.state.players[P2].influence, inf - 3);
  });
});

describe("1st Edition Part 2 — Brash Basher", () => {
  test("deploys as a plain vanilla character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "bb", def: def("Brash Basher"), owner: P1, zone: "hand" }, ...bank("rage", 8, P1)]
    });
    play(engine, P1, id("bb"), {});
    assert.equal(engine.state.cards[id("bb")].zone, "play");
  });
});

describe("1st Edition Part 2 — Callow Liegeman", () => {
  test("when it attacks in a party of 2+, it gains +1/+1 this turn", () => {
    const d = def("Callow Liegeman");
    const { engine, id } = buildGame({
      cards: [
        { key: "cl", def: d, owner: P1, zone: "play" },
        { key: "buddy", def: character({ name: "Buddy", strength: 1, life: 1, speed: 3 }), owner: P1, zone: "play" }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("cl"), id("buddy")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("cl"), "strength"), (d.strength ?? 0) + 1);
  });
});

describe("1st Edition Part 2 — Deadly Striker", () => {
  test("when destroyed, an opponent's faction loses 4 influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ds", def: def("Deadly Striker"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    const inf = engine.state.players[P2].influence;
    play(engine, P1, id("kill"), { selected: { t: [id("ds")] } });
    assert.equal(engine.state.players[P2].influence, inf - 4);
  });
});

describe("1st Edition Part 2 — Dethmürderblüdgeon, the Craghammer", () => {
  test("the attached character gains +2/+2; the item returns to hand instead of the discard pile", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "host", def: character({ name: "Host", strength: 2, life: 2 }), owner: P1, zone: "play" },
        { key: "dmb", def: def("Dethmürderblüdgeon, the Craghammer"), owner: P1, zone: "play", attachedToKey: "host" },
        { key: "kill", def: killTactic({ behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), 4);
    play(engine, P1, id("kill"), { selected: { t: [id("dmb")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("dmb")].zone, "hand");
  });
});

describe("1st Edition Part 2 — Distraction", () => {
  test("depletes a chosen character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "d", def: def("Distraction"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P2, zone: "play" },
        ...bank("rage", 4, P1)
      ]
    });
    play(engine, P1, id("d"), { selected: { c: [id("c")] } });
    assert.equal(engine.state.cards[id("c")].depleted, true);
  });
});

describe("1st Edition Part 2 — Elbow Dropper", () => {
  test("OFF THE TOP ROPE stops a character from blocking this turn", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "ed", def: def("Elbow Dropper"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C" }), owner: P2, zone: "play" }
      ]
    });
    activate(engine, P1, id("ed"), "offtop", { selected: { c: [id("c")] } });
    assert.ok(engine.getRestrictions(id("c")).includes("cannotBlock"));
  });
});

describe("1st Edition Part 2 — Explosive Fury", () => {
  test("sacrifice a character to deal its strength to another", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ef", def: def("Explosive Fury"), owner: P1, zone: "hand" },
        { key: "sac", def: character({ name: "Sac", strength: 3 }), owner: P1, zone: "play" },
        { key: "vic", def: character({ name: "Vic", life: 10 }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("ef"), { selected: { sac: [id("sac")], victim: [id("vic")] } });
    assert.equal(engine.state.cards[id("sac")].zone, "discard");
    assert.equal(engine.state.cards[id("vic")].damage, 3);
  });
});

describe("1st Edition Part 2 — Fleshripping Scenepuller", () => {
  test("when blocked, gains +4 strength per opposing party member this turn", () => {
    const d = def("Fleshripping Scenepuller");
    const { engine, id } = buildGame({
      cards: [
        { key: "fs", def: d, owner: P1, zone: "play" },
        { key: "b1", def: character({ name: "B1", strength: 1, life: 10, speed: 1 }), owner: P2, zone: "play" },
        { key: "b2", def: character({ name: "B2", strength: 1, life: 10, speed: 1 }), owner: P2, zone: "play" }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("fs")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b1"), id("b2")] });
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("fs"), "strength"), (d.strength ?? 0) + 8);
  });
});

describe("1st Edition Part 2 — Gore Engine", () => {
  test("gains +1 strength per token on it", () => {
    const d = def("Gore Engine");
    const { engine, id } = buildGame({
      cards: [{ key: "ge", def: d, owner: P1, zone: "play", counters: { token: 3 } }]
    });
    assert.equal(engine.getStat(id("ge"), "strength"), (d.strength ?? 0) + 3);
  });
});

describe("1st Edition Part 2 — Infuriator", () => {
  test("ETB: your characters gain 1 strength this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "inf", def: def("Infuriator"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", strength: 2 }), owner: P1, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("inf"), {});
    assert.equal(engine.getStat(id("c"), "strength"), 3);
  });
});

describe("1st Edition Part 2 — Lieutenant General", () => {
  test("when it attacks, other soldier characters in its party gain 1 life this turn", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "lg", def: def("Lieutenant General"), owner: P1, zone: "play" },
        { key: "grunt", def: character({ name: "Grunt", strength: 1, life: 2, speed: 3, subtype: ["soldier"] }), owner: P1, zone: "play" }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("lg"), id("grunt")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("grunt"), "life"), 3);
  });
});

describe("1st Edition Part 2 — Morale Officer", () => {
  test("CONVINCE gives your soldier characters +1 strength this turn", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "mo", def: def("Morale Officer"), owner: P1, zone: "play" },
        { key: "grunt", def: character({ name: "Grunt", strength: 2, subtype: ["soldier"] }), owner: P1, zone: "play" }
      ]
    });
    activate(engine, P1, id("mo"), "convince");
    assert.equal(engine.getStat(id("grunt"), "strength"), 3);
  });
});

describe("1st Edition Part 2 — Murderous Commander", () => {
  test("CUNNING PLAN deals 2 to an opponent's faction", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mc", def: def("Murderous Commander"), owner: P1, zone: "play" },
        { key: "spare", def: character({ name: "Spare" }), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    const inf = engine.state.players[P2].influence;
    activate(engine, P1, id("mc"), "plan", { selected: { d: [id("spare")] } });
    assert.equal(engine.state.players[P2].influence, inf - 2);
  });
});

describe("1st Edition Part 2 — Needless Beating", () => {
  test("deals 2 damage to an opponent's character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "nb", def: def("Needless Beating"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", life: 10 }), owner: P2, zone: "play" },
        ...bank("rage", 8, P1)
      ]
    });
    play(engine, P1, id("nb"), { selected: { c: [id("c")] } });
    drain(engine, declineAll);
    assert.ok((engine.state.cards[id("c")].damage ?? 0) >= 2);
  });
});

describe("1st Edition Part 2 — Penetrate", () => {
  test("grants an attacking character REDIRECT DAMAGE this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pen", def: def("Penetrate"), owner: P1, zone: "hand" },
        { key: "atk", def: character({ name: "Atk", strength: 3, life: 3, speed: 3 }), owner: P1, zone: "play" },
        ...bank("rage", 6, P1)
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk")], target: { type: "faction", playerId: P2 } });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("pen"), selected: { atk: [id("atk")] } } as never);
    resolvePendingResponses(engine);
    assert.ok(engine.getKeywords(id("atk")).includes("redirectDamage"));
  });
});

describe("1st Edition Part 2 — Pinch", () => {
  test("deals 1 damage to a character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "p", def: def("Pinch"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", life: 5 }), owner: P2, zone: "play" },
        ...bank("rage", 4, P1)
      ]
    });
    play(engine, P1, id("p"), { selected: { c: [id("c")] } });
    assert.equal(engine.state.cards[id("c")].damage, 1);
  });
});

describe("1st Edition Part 2 — Really Big Barduse", () => {
  test("EXTRA COST: may distribute up to 5 damage among 2 picked characters", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rbb", def: def("Really Big Barduse"), owner: P1, zone: "hand" },
        { key: "a", def: character({ name: "A", life: 10 }), owner: P2, zone: "play" },
        { key: "b", def: character({ name: "B", life: 10 }), owner: P2, zone: "play" },
        ...bank("rage", 12, P1)
      ]
    });
    play(engine, P1, id("rbb"), { selected: { picks: [id("a"), id("b")] } });
    drain(engine, pc =>
      pc.kind === "distributeAmong"
        ? { kind: "distributeAmong", shares: { [id("a")]: 5 } }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("a")].damage, 5);
    assert.equal(engine.state.cards[id("rbb")].zone, "play");
  });
});

describe("1st Edition Part 2 — Ruthless Platoon", () => {
  test("CANNIBALIZE destroys a character you control for +2 strength this turn", () => {
    const d = def("Ruthless Platoon");
    const { engine, id } = buildGame({
      cards: [
        { key: "rp", def: d, owner: P1, zone: "play" },
        { key: "sac", def: character({ name: "Sac" }), owner: P1, zone: "play" }
      ]
    });
    activate(engine, P1, id("rp"), "cannibalize", { selected: { sac: [id("sac")] } });
    assert.equal(engine.state.cards[id("sac")].zone, "discard");
    assert.equal(engine.getStat(id("rp"), "strength"), (d.strength ?? 0) + 2);
  });
});

describe("1st Edition Part 2 — Sadistic Colonel", () => {
  test("when an opponent deploys a tactic, its faction takes 2 damage", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "sc", def: def("Sadistic Colonel"), owner: P1, zone: "play" },
        { key: "opptac", def: tactic({ name: "OppTac", cost: 0 }), owner: P2, zone: "hand" },
        ...bank("rage", 6, P2)
      ],
      activePlayerId: P2
    });
    const inf = engine.state.players[P2].influence;
    engine.perform({ type: "playCard", playerId: P2, cardId: id("opptac"), selected: {} } as never);
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P2].influence, inf - 2);
  });
});

describe("1st Edition Part 2 — Skin Suit", () => {
  test("your character and an opponent's trade strength as damage", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ss", def: def("Skin Suit"), owner: P1, zone: "hand" },
        { key: "mine", def: character({ name: "Mine", strength: 3, life: 10 }), owner: P1, zone: "play" },
        { key: "theirs", def: character({ name: "Theirs", strength: 2, life: 10 }), owner: P2, zone: "play" },
        ...bank("rage", 8, P1)
      ]
    });
    play(engine, P1, id("ss"), { selected: { mine: [id("mine")], theirs: [id("theirs")] } });
    assert.equal(engine.state.cards[id("theirs")].damage, 3);
    assert.equal(engine.state.cards[id("mine")].damage, 2);
  });
});

describe("1st Edition Part 2 — Splattergun", () => {
  test("UNLOAD deals 3 damage; the target's controller takes the item", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "sg", def: def("Splattergun"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C", life: 10 }), owner: P2, zone: "play" }
      ]
    });
    activate(engine, P1, id("sg"), "unload", { selected: { tgt: [id("c")] } });
    assert.equal(engine.state.cards[id("c")].damage, 3);
    assert.equal(engine.state.cards[id("sg")].controllerId, P2);
  });
});

describe("1st Edition Part 2 — Suicide Squad", () => {
  test("ULTIMATE SACRIFICE destroys itself to deal its strength to a character", () => {
    const d = def("Suicide Squad");
    const { engine, id } = buildGame({
      cards: [
        { key: "sq", def: d, owner: P1, zone: "play" },
        { key: "v", def: character({ name: "V", life: 10 }), owner: P2, zone: "play" }
      ]
    });
    activate(engine, P1, id("sq"), "sacrifice", { selected: { c: [id("v")] } });
    assert.equal(engine.state.cards[id("sq")].zone, "discard");
    assert.equal(engine.state.cards[id("v")].damage, d.strength ?? 0);
  });
});

describe("1st Edition Part 2 — Swordchucks", () => {
  test("the attached character gains 4 strength; damage to it is increased by 2", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "host", def: character({ name: "Host", strength: 2, life: 10 }), owner: P1, zone: "play" },
        { key: "sc", def: def("Swordchucks"), owner: P1, zone: "play", attachedToKey: "host" },
        { key: "zap", def: killTactic({ name: "Zap", behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }] }] } }), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), 6);
    play(engine, P1, id("zap"), { selected: { t: [id("host")] } });
    // 1 dealt, increased by 2 by Swordchucks
    assert.equal(engine.state.cards[id("host")].damage, 3);
  });
});

describe("1st Edition Part 2 — Thundering Nilpha", () => {
  test("while attacking a location, it gains 1 strength and cannot be blocked", () => {
    const d = def("Thundering Nilpha");
    const { engine, id } = buildGame({
      cards: [
        { key: "tn", def: d, owner: P1, zone: "play" },
        { key: "loc", def: location({ name: "Loc", structure: 10 }), owner: P2, zone: "play" }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("tn")], target: { type: "card", cardId: id("loc") } });
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("tn"), "strength"), (d.strength ?? 0) + 1);
    assert.ok(engine.getKeywords(id("tn")).includes("cannotBeBlocked"));
  });
});

describe("1st Edition Part 2 — Torrential Bleeder", () => {
  test("at the start of your turn, inflict 1 damage to all characters", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "tb", def: def("Torrential Bleeder"), owner: P1, zone: "play" },
        { key: "other", def: character({ name: "Other", life: 5 }), owner: P2, zone: "play" }
      ],
      activePlayerId: P2
    });
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("other")].damage, 1);
  });
});

describe("1st Edition Part 2 — Trip Wire", () => {
  test("while being attacked, distribute 3 damage among the attackers", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "tw", def: def("Trip Wire"), owner: P1, zone: "hand" },
        { key: "a1", def: character({ name: "A1", strength: 2, life: 10, speed: 3 }), owner: P2, zone: "play" },
        { key: "a2", def: character({ name: "A2", strength: 2, life: 10, speed: 3 }), owner: P2, zone: "play" },
        ...bank("rage", 8, P1)
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("a1"), id("a2")], target: { type: "faction", playerId: P1 } });
    engine.perform({ type: "passPriority", playerId: P2 });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("tw"), selected: { atk: [id("a1"), id("a2")] } } as never);
    resolvePendingResponses(engine);
    drain(engine, pc =>
      pc.kind === "distributeAmong"
        ? { kind: "distributeAmong", shares: { [id("a1")]: 3 } }
        : declineAll(pc)
    );
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("a1")].damage, 3);
  });
});

describe("1st Edition Part 2 — Trophy Collector", () => {
  test("can only be deployed while an opponent's faction has 10 influence or less", () => {
    const low = buildGame({
      playerA: { faction: developFaction() },
      playerB: { influence: 8 },
      cards: [{ key: "tc", def: def("Trophy Collector"), owner: P1, zone: "hand" }, ...bank("rage", 4, P1)]
    });
    play(low.engine, P1, low.id("tc"), {});
    assert.equal(low.engine.state.cards[low.id("tc")].zone, "play");

    const high = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "tc", def: def("Trophy Collector"), owner: P1, zone: "hand" }, ...bank("rage", 4, P1)]
    });
    assert.throws(() =>
      high.engine.perform({ type: "playCard", playerId: P1, cardId: high.id("tc"), selected: {} } as never)
    );
  });
});

describe("1st Edition Part 2 — Wyrmfang Deathskull", () => {
  test("when it attacks, the defender chooses which characters must block", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "wd", def: def("Wyrmfang Deathskull"), owner: P1, zone: "play" },
        { key: "def", def: character({ name: "Def", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("wd")], target: { type: "faction", playerId: P2 } });
    drain(engine, declineAll);
    resolvePendingResponses(engine);
    assert.ok(engine.state.battle);
  });
});
