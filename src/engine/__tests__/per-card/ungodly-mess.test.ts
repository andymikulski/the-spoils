// Per-card correctness suite — Ungodly Mess (167 catalog entries, 160 distinct
// cards — the FEALTY / "Blade of Questionable Morality" / [_]_[V][V] era).
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
  resourceCard,
  killTactic,
  play,
  activate,
  resolvePendingResponses,
  autoResolveBattle,
  P1,
  P2
} from "./_harness.js";

const SET = "Ungodly Mess";
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
    default:
      return { kind: pc.kind };
  }
};

// =====================================================================
// A – C
// =====================================================================

describe("Ungodly Mess — Abram Ka-darbo Alkazin", () => {
  test("MAKE VANISH depletes it and pays 5 to void a chosen character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "abram", def: def("Abram Ka-darbo Alkazin"), owner: P1, zone: "play" },
        { key: "victim", def: character({ name: "Victim" }), owner: P2, zone: "play" },
        ...bank("deception", 8, P1)
      ]
    });
    activate(engine, P1, id("abram"), "make-vanish", { selected: { c: [id("victim")] } });
    assert.equal(engine.state.cards[id("victim")].zone, "void");
    assert.equal(engine.state.cards[id("abram")].depleted, true);
  });
});

describe("Ungodly Mess — Abusive Major General", () => {
  test("BLEED destroys a resource to inflict 2 damage to a battling character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mg", def: def("Abusive Major General"), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 2, life: 6, speed: 3 }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    engine.perform({ type: "passPriority", playerId: P2 });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("mg"), abilityId: "bleed", selected: { c: [id("atk")] }, variables: {} });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("atk")].damage, 2);
  });
});

describe("Ungodly Mess — Acrolosian Outpost #30016968A", () => {
  test("SNUB tutors a card named Elitism into hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "out", def: def("Acrolosian Outpost #30016968A"), owner: P1, zone: "play" },
        { key: "eli", def: resourceCard({ name: "Elitism", resource: { provides: ["elitism"], staple: true } }), owner: P1, zone: "deck" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("elitism", 4, P1)
      ]
    });
    activate(engine, P1, id("out"), "snub");
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("eli")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("eli")].zone, "hand");
  });
});

describe("Ungodly Mess — Animated Scrap Heap", () => {
  test("gains +1/+1 per token on it", () => {
    const d = def("Animated Scrap Heap");
    const { engine, id } = buildGame({
      cards: [{ key: "ash", def: d, owner: P1, zone: "play", counters: { token: 2 } }]
    });
    assert.equal(engine.getStat(id("ash"), "strength"), (d.strength ?? 0) + 2);
    assert.equal(engine.getStat(id("ash"), "life"), (d.life ?? 0) + 2);
  });
});

describe("Ungodly Mess — Apparition Alley", () => {
  test("WOOSH gives a chosen character +1 speed this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "alley", def: def("Apparition Alley"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C", speed: 3 }), owner: P1, zone: "play" }
      ]
    });
    activate(engine, P1, id("alley"), "woosh", { selected: { c: [id("c")] } });
    assert.equal(engine.getStat(id("c"), "speed"), 4);
  });
});

describe("Ungodly Mess — Arcane Ambush", () => {
  test("destroys all items and locations", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "aa", def: def("Arcane Ambush"), owner: P1, zone: "hand" },
        { key: "myit", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
        { key: "theirloc", def: location({ name: "TheirLoc", structure: 4 }), owner: P2, zone: "play" },
        ...volition(8, P1)
      ]
    });
    const facP2 = engine.state.players[P2].factionId!;
    play(engine, P1, id("aa"), { variables: { x: 0 }, selected: { f: [facP2] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("myit")].zone, "discard");
    assert.equal(engine.state.cards[id("theirloc")].zone, "discard");
  });
});

describe("Ungodly Mess — Arrakis Eternity", () => {
  test("has COVERT", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "ae", def: def("Arrakis Eternity"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getKeywords(id("ae")).includes("covert"));
  });
});

describe("Ungodly Mess — Auditory Adulation", () => {
  test("gives a character strength equal to its numeric cost this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "aa", def: def("Auditory Adulation"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", cost: 4, strength: 2 }), owner: P1, zone: "play" },
        ...bank("rage", 4, P1)
      ]
    });
    play(engine, P1, id("aa"), { selected: { c: [id("c")] } });
    drain(engine, declineAll);
    assert.equal(engine.getStat(id("c"), "strength"), 2 + 4);
  });
});

describe("Ungodly Mess — Bank Rolled", () => {
  test("your faction loses X influence to destroy a character with numeric cost X", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "br", def: def("Bank Rolled"), owner: P1, zone: "hand" },
        { key: "c2", def: character({ name: "C2", cost: 2 }), owner: P2, zone: "play" },
        ...bank("greed", 4, P1)
      ]
    });
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("br"), { variables: { x: 2 }, selected: { c: [id("c2")] } });
    assert.equal(engine.state.cards[id("c2")].zone, "discard");
    assert.equal(engine.state.players[P1].influence, inf - 2);
  });
});

describe("Ungodly Mess — Beefy Researcher", () => {
  test("gains +2/+2/+2 while you control [E]x6", () => {
    const d = def("Beefy Researcher");
    const { engine, id } = buildGame({
      cards: [{ key: "br", def: d, owner: P1, zone: "play" }, ...bank("elitism", 6, P1)]
    });
    assert.equal(engine.getStat(id("br"), "strength"), (d.strength ?? 0) + 2);
    assert.equal(engine.getStat(id("br"), "speed"), (d.speed ?? 0) + 2);
  });
});

describe("Ungodly Mess — Big McLargehuge", () => {
  test("EXTRA COST destroys 2 of your resources on deploy", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "bm", def: def("Big McLargehuge"), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    const before = Object.values(engine.state.cards).filter(
      c => c.controllerId === P1 && engine.getDefinition(c.id).type === "resource" && c.zone === "play"
    ).length;
    play(engine, P1, id("bm"), {});
    drain(engine, declineAll);
    const after = Object.values(engine.state.cards).filter(
      c => c.controllerId === P1 && engine.getDefinition(c.id).type === "resource" && c.zone === "play"
    ).length;
    assert.equal(engine.state.cards[id("bm")].zone, "play");
    assert.equal(before - after, 2);
  });
});

describe("Ungodly Mess — Billowing Bouffant", () => {
  test("ETB may destroy an item", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "bb", def: def("Billowing Bouffant"), owner: P1, zone: "hand" },
        { key: "it", def: item({ name: "It" }), owner: P2, zone: "play" },
        ...bank("elitism", 8, P1)
      ]
    });
    play(engine, P1, id("bb"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("it")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("it")].zone, "discard");
  });
});

describe("Ungodly Mess — Bloodcrazed Berserker", () => {
  test("HEMORAGE destroys itself to inflict 4 damage to a faction", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "bb", def: def("Bloodcrazed Berserker"), owner: P1, zone: "play" }]
    });
    const facP2 = engine.state.players[P2].factionId!;
    const inf = engine.state.players[P2].influence;
    activate(engine, P1, id("bb"), "hemorage", { selected: { t: [facP2] } });
    assert.equal(engine.state.players[P2].influence, inf - 4);
    assert.equal(engine.state.cards[id("bb")].zone, "discard");
  });
});

describe("Ungodly Mess — Brainbath", () => {
  test("draws 2 and bottoms a card from hand (net +1)", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "bb", def: def("Brainbath"), owner: P1, zone: "hand" },
        { key: "keep", def: character({ name: "Keep" }), owner: P1, zone: "hand" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("obsession", 4, P1)
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    play(engine, P1, id("bb"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("keep")] } : declineAll(pc)
    );
    assert.equal(engine.state.players[P1].hand.length, hand - 1 + 2 - 1);
  });
});

describe("Ungodly Mess — Breath of the Barduse", () => {
  test("each player destroys 2 of their own characters", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "bb", def: def("Breath of the Barduse"), owner: P1, zone: "hand" },
        { key: "m1", def: character({ name: "M1" }), owner: P1, zone: "play" },
        { key: "m2", def: character({ name: "M2" }), owner: P1, zone: "play" },
        { key: "m3", def: character({ name: "M3" }), owner: P1, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("bb"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" && pc.playerId === P1
        ? { kind: "chooserSelectsTarget", selected: [id("m1"), id("m2")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("m1")].zone, "discard");
    assert.equal(engine.state.cards[id("m2")].zone, "discard");
    assert.equal(engine.state.cards[id("m3")].zone, "play");
  });
});

describe("Ungodly Mess — Bursting Bask", () => {
  test("[R]x6 ETB may inflict 5 damage to a chosen character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "bb", def: def("Bursting Bask"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", life: 9 }), owner: P2, zone: "play" },
        ...bank("rage", 7, P1)
      ]
    });
    play(engine, P1, id("bb"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("oc")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("oc")].damage, 5);
  });
});

describe("Ungodly Mess — Camouflaged Urchin", () => {
  test("while depleted, opponents cannot pick it", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "cu", def: def("Camouflaged Urchin"), owner: P1, zone: "play", depleted: true }]
    });
    assert.ok(engine.getRestrictions(id("cu")).includes("cannotBePicked"));
  });

  test("while restored, it can be picked", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "cu", def: def("Camouflaged Urchin"), owner: P1, zone: "play" }]
    });
    assert.equal(engine.getRestrictions(id("cu")).includes("cannotBePicked"), false);
  });
});

describe("Ungodly Mess — Candy Skull Commander", () => {
  test("when an opponent forms an attacking party it offers a pay-2 coin flip", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "csc", def: def("Candy Skull Commander"), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 2, life: 4, speed: 3 }), owner: P2, zone: "play" },
        ...bank("deception", 6, P1)
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    assert.equal(engine.state.pendingChoice?.kind, "mayPay");
  });
});

describe("Ungodly Mess — Carnival Funhouse", () => {
  test("ETB swaps strength/life/speed between a chosen enemy and friendly character", () => {
    const oc = character({ name: "OC", strength: 5, life: 1, speed: 2 });
    const mc = character({ name: "MC", strength: 1, life: 5, speed: 3 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cf", def: def("Carnival Funhouse"), owner: P1, zone: "hand" },
        { key: "oc", def: oc, owner: P2, zone: "play" },
        { key: "mc", def: mc, owner: P1, zone: "play" },
        ...bank("deception", 6, P1)
      ]
    });
    play(engine, P1, id("cf"), { selected: { a: [id("oc")], b: [id("mc")] } });
    drain(engine, declineAll);
    assert.equal(engine.getStat(id("oc"), "strength"), 1);
    assert.equal(engine.getStat(id("mc"), "strength"), 5);
  });
});

describe("Ungodly Mess — Carnival Whipmaster", () => {
  test("GRAND THEFT takes control of one enemy character and one enemy item", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cw", def: def("Carnival Whipmaster"), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" },
        { key: "oi", def: item({ name: "OI" }), owner: P2, zone: "play" }
      ]
    });
    activate(engine, P1, id("cw"), "grand-theft", { selected: { ch: [id("oc")], it: [id("oi")] } });
    assert.equal(engine.state.cards[id("oc")].controllerId, P1);
    assert.equal(engine.state.cards[id("oi")].controllerId, P1);
  });
});

describe("Ungodly Mess — Chosen Reaper of Thabbash", () => {
  test("CONSUME FORCE depletes another character for +1 speed this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cr", def: def("Chosen Reaper of Thabbash"), owner: P1, zone: "play" },
        { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
        ...bank("deception", 6, P1)
      ]
    });
    const spd = engine.getStat(id("cr"), "speed");
    activate(engine, P1, id("cr"), "consume-force", { selected: { c: [id("ally")] } });
    assert.equal(engine.getStat(id("cr"), "speed"), spd + 1);
    assert.equal(engine.state.cards[id("ally")].depleted, true);
  });
});

describe("Ungodly Mess — Cicibeo, The Implicator", () => {
  test("IMPLY lets the target's controller deplete it", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cb", def: def("Cicibeo, The Implicator"), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" }
      ]
    });
    activate(engine, P1, id("cb"), "imply", { selected: { c: [id("oc")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 0 } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("oc")].depleted, true);
  });
});

describe("Ungodly Mess — Circumspect Hijacker", () => {
  test("RETREAT pays 2 and destroys itself to draw a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ch", def: def("Circumspect Hijacker"), owner: P1, zone: "play" },
        ...Array.from({ length: 3 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("greed", 4, P1)
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    activate(engine, P1, id("ch"), "retreat");
    assert.equal(engine.state.cards[id("ch")].zone, "discard");
    assert.equal(engine.state.players[P1].hand.length, hand + 1);
  });
});

describe("Ungodly Mess — Conniving Puppeteer", () => {
  test("BETRAY destroys itself to reanimate a non-tactic from an opponent's discard", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cp", def: def("Conniving Puppeteer"), owner: P1, zone: "play" },
        { key: "corpse", def: character({ name: "Corpse" }), owner: P2, zone: "discard" }
      ]
    });
    activate(engine, P1, id("cp"), "betray", { selected: { c: [id("corpse")] } });
    assert.equal(engine.state.cards[id("corpse")].zone, "play");
    assert.equal(engine.state.cards[id("corpse")].controllerId, P1);
    assert.equal(engine.state.cards[id("cp")].zone, "discard");
  });
});

describe("Ungodly Mess — Contriving Engineer", () => {
  test("ETB may put a tutored Elitism into play attached to your faction", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ce", def: def("Contriving Engineer"), owner: P1, zone: "hand" },
        { key: "eli", def: resourceCard({ name: "Elitism", resource: { provides: ["elitism"], staple: true } }), owner: P1, zone: "deck" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("elitism", 4, P1)
      ]
    });
    play(engine, P1, id("ce"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("eli")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("eli")].zone, "play");
    assert.equal(engine.state.cards[id("eli")].attachedTo, engine.state.players[P1].factionId);
  });
});

describe("Ungodly Mess — Corrosive Waste Dispenser", () => {
  test("enters play with 4 tokens", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cwd", def: def("Corrosive Waste Dispenser"), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("cwd"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("cwd")].counters?.token, 4);
  });
});

describe("Ungodly Mess — Crimson Pandiatus", () => {
  test("cannot attack", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "cp", def: def("Crimson Pandiatus"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getRestrictions(id("cp")).includes("cannotAttack"));
  });

  test("[R]x6 grants +4 life", () => {
    const d = def("Crimson Pandiatus");
    const { engine, id } = buildGame({
      cards: [{ key: "cp", def: d, owner: P1, zone: "play" }, ...bank("rage", 6, P1)]
    });
    assert.equal(engine.getStat(id("cp"), "life"), (d.life ?? 0) + 4);
  });
});

describe("Ungodly Mess — Crow With Fists", () => {
  test("is a plain vanilla character", () => {
    const d = def("Crow With Fists");
    const { engine, id } = buildGame({
      cards: [{ key: "cwf", def: d, owner: P1, zone: "play" }]
    });
    assert.equal(engine.getStat(id("cwf"), "strength"), d.strength ?? 0);
    assert.deepEqual(engine.getKeywords(id("cwf")), []);
  });
});

describe("Ungodly Mess — Cunning Ruse", () => {
  test("flips a chosen item face-down under its opponent's control", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cr", def: def("Cunning Ruse"), owner: P1, zone: "hand" },
        { key: "oi", def: item({ name: "OI" }), owner: P2, zone: "play" },
        ...bank("deception", 4, P1)
      ]
    });
    play(engine, P1, id("cr"), { selected: { it: [id("oi")] } });
    assert.equal(engine.state.cards[id("oi")].faceDown, true);
  });
});

describe("Ungodly Mess — Customized 31f", () => {
  test("gains +2/+2 while a location or item is in play", () => {
    const d = def("Customized 31f");
    const { engine, id } = buildGame({
      cards: [
        { key: "c31", def: d, owner: P1, zone: "play" },
        { key: "it", def: item({ name: "It" }), owner: P1, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("c31"), "strength"), (d.strength ?? 0) + 2);
    assert.equal(engine.getStat(id("c31"), "life"), (d.life ?? 0) + 2);
  });
});

// =====================================================================
// D – F
// =====================================================================

describe("Ungodly Mess — Death Investor", () => {
  test("RECUR from discard reanimates a character from your discard pile", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "di", def: def("Death Investor"), owner: P1, zone: "discard" },
        { key: "corpse", def: character({ name: "Corpse" }), owner: P1, zone: "discard" },
        ...bank("greed", 4, P1)
      ]
    });
    activate(engine, P1, id("di"), "recur", { selected: { c: [id("corpse")] } });
    assert.equal(engine.state.cards[id("corpse")].zone, "play");
    assert.equal(engine.state.cards[id("corpse")].controllerId, P1);
    assert.equal(engine.state.cards[id("di")].zone, "removed");
  });
});

describe("Ungodly Mess — Deicidal Detonation", () => {
  test("puts a token on chosen non-resource cards", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "dd", def: def("Deicidal Detonation"), owner: P1, zone: "hand" },
        { key: "mark", def: character({ name: "Mark" }), owner: P2, zone: "play" },
        ...bank("obsession", 6, P1)
      ]
    });
    play(engine, P1, id("dd"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("mark")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("mark")].counters?.token, 1);
  });
});

describe("Ungodly Mess — Demolition Investment", () => {
  test("an opponent's revealed face-down resource is destroyed", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "dinv", def: def("Demolition Investment"), owner: P1, zone: "hand" },
        ...volition(1, P2),
        ...bank("greed", 6, P1)
      ]
    });
    const fd = Object.values(engine.state.cards).find(
      c => c.controllerId === P2 && c.faceDown && engine.getDefinition(c.id).type === "resource"
    )!;
    play(engine, P1, id("dinv"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [fd.id] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[fd.id].zone, "discard");
  });
});

describe("Ungodly Mess — Desperate Defender", () => {
  test("is COVERT; SHOW EVIDENCE depletes a chosen character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "dd", def: def("Desperate Defender"), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" }
      ]
    });
    assert.ok(engine.getKeywords(id("dd")).includes("covert"));
    activate(engine, P1, id("dd"), "show-evidence", { selected: { c: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].depleted, true);
  });
});

describe("Ungodly Mess — Difference of Opinion", () => {
  test("may inflict 1 damage to a chosen character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "doo", def: def("Difference of Opinion"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", life: 5 }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("doo"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("oc")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("oc")].damage, 1);
  });
});

describe("Ungodly Mess — Direstock Cuffs", () => {
  test("the attached character loses COVERT", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host", behavior: { keywords: ["covert"] } }), owner: P1, zone: "play" },
        { key: "cuffs", def: def("Direstock Cuffs"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.equal(engine.getKeywords(id("host")).includes("covert"), false);
  });
});

describe("Ungodly Mess — Direstock Paratrooper", () => {
  test("is a plain vanilla character", () => {
    const d = def("Direstock Paratrooper");
    const { engine, id } = buildGame({
      cards: [{ key: "dp", def: d, owner: P1, zone: "play" }]
    });
    assert.equal(engine.getStat(id("dp"), "strength"), d.strength ?? 0);
    assert.deepEqual(engine.getKeywords(id("dp")), []);
  });
});

describe("Ungodly Mess — Direstock Stronghold", () => {
  test("when you deploy a character, may inflict its cost in damage to a faction", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sh", def: def("Direstock Stronghold"), owner: P1, zone: "play" },
        { key: "guy", def: character({ name: "Guy", cost: 3 }), owner: P1, zone: "hand" },
        ...bank("rage", 8, P1)
      ]
    });
    const facP2 = engine.state.players[P2].factionId!;
    const inf = engine.state.players[P2].influence;
    play(engine, P1, id("guy"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [facP2] } : declineAll(pc)
    );
    assert.equal(engine.state.players[P2].influence, inf - 3);
  });
});

describe("Ungodly Mess — Disposable Meatsack", () => {
  test("[R]x6 grants +1 strength and +1 speed", () => {
    const d = def("Disposable Meatsack");
    const { engine, id } = buildGame({
      cards: [{ key: "dm", def: d, owner: P1, zone: "play" }, ...bank("rage", 6, P1)]
    });
    assert.equal(engine.getStat(id("dm"), "strength"), (d.strength ?? 0) + 1);
    assert.equal(engine.getStat(id("dm"), "speed"), (d.speed ?? 0) + 1);
  });
});

describe("Ungodly Mess — Doarden Flee Market", () => {
  test("HOCK sacrifices a character you own to draw a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "dfm", def: def("Doarden Flee Market"), owner: P1, zone: "play" },
        { key: "sac", def: character({ name: "Sac" }), owner: P1, zone: "play" },
        ...Array.from({ length: 3 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("greed", 4, P1)
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    activate(engine, P1, id("dfm"), "hock", { selected: { c: [id("sac")] } });
    assert.equal(engine.state.cards[id("sac")].zone, "discard");
    assert.equal(engine.state.players[P1].hand.length, hand + 1);
  });
});

describe("Ungodly Mess — Drainbow Crash", () => {
  test("in play, it provides [E][E]", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "dc", def: def("Drainbow Crash"), owner: P1, zone: "play" }]
    });
    void id;
    assert.ok((engine.getThresholds(P1).elitism ?? 0) >= 2);
  });
});

describe("Ungodly Mess — Ecto-Agriolimax", () => {
  test("SLITHER removes a token to bounce an item or location", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ea", def: def("Ecto-Agriolimax"), owner: P1, zone: "play", counters: { token: 2 } },
        { key: "oi", def: item({ name: "OI" }), owner: P2, zone: "play" }
      ]
    });
    activate(engine, P1, id("ea"), "slither", { selected: { c: [id("oi")] } });
    assert.equal(engine.state.cards[id("oi")].zone, "hand");
    assert.equal(engine.state.cards[id("ea")].counters?.token, 1);
  });
});

describe("Ungodly Mess — Ecto-Conduit", () => {
  test("HARNESS destroys itself to void the top card of your deck", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ec", def: def("Ecto-Conduit"), owner: P1, zone: "play" },
        { key: "top", def: character({ name: "Top" }), owner: P1, zone: "deck" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" }
      ]
    });
    activate(engine, P1, id("ec"), "harness");
    assert.equal(engine.state.cards[id("ec")].zone, "discard");
    assert.equal(engine.state.cards[id("top")].zone, "void");
  });
});

describe("Ungodly Mess — Efficacious Gunslinger", () => {
  test("destroys any character it inflicts battle damage to", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "eg", def: def("Efficacious Gunslinger"), owner: P1, zone: "play" },
        { key: "blk", def: character({ name: "Blk", strength: 0, life: 10, speed: 1 }), owner: P2, zone: "play" }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("eg")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("blk")].zone, "discard");
  });
});

describe("Ungodly Mess — Eidolic Cove", () => {
  test("when destroyed, your faction loses 4 influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cove", def: def("Eidolic Cove"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic({ behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("kill"), { selected: { t: [id("cove")] } });
    assert.equal(engine.state.players[P1].influence, inf - 4);
  });
});

describe("Ungodly Mess — Elite Acrolos Engineer", () => {
  test("gains +1/+1 per different staple resource you control", () => {
    const d = def("Elite Acrolos Engineer");
    const { engine, id } = buildGame({
      cards: [
        { key: "eae", def: d, owner: P1, zone: "play" },
        ...bank("rage", 1, P1),
        ...bank("greed", 1, P1),
        ...bank("elitism", 1, P1),
        ...bank("deception", 1, P1),
        ...bank("obsession", 1, P1)
      ]
    });
    assert.equal(engine.getStat(id("eae"), "strength"), (d.strength ?? 0) + 5);
  });
});

describe("Ungodly Mess — Eustace, Sensible Glutton", () => {
  test("on attack it offers a lose-3-influence pump", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "eg", def: def("Eustace, Sensible Glutton"), owner: P1, zone: "play" },
        ...bank("greed", 6, P1)
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("eg")], target: { type: "faction", playerId: P2 } });
    assert.equal(engine.state.pendingChoice?.kind, "mayPay");
  });
});

describe("Ungodly Mess — Ex Machina Majig", () => {
  test("ETB gives all your characters +1/+1 this turn", () => {
    const ally = character({ name: "Ally", strength: 2, life: 2 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "emm", def: def("Ex Machina Majig"), owner: P1, zone: "hand" },
        { key: "ally", def: ally, owner: P1, zone: "play" },
        ...bank("elitism", 8, P1)
      ]
    });
    play(engine, P1, id("emm"), {});
    drain(engine, declineAll);
    assert.equal(engine.getStat(id("ally"), "strength"), (ally.strength ?? 0) + 1);
  });
});

describe("Ungodly Mess — Expedition AutoBlind", () => {
  test("HUNKER DOWN removes a discard-pile character or tactic from the game", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "eab", def: def("Expedition AutoBlind"), owner: P1, zone: "play" },
        { key: "gone", def: character({ name: "Gone" }), owner: P2, zone: "discard" },
        { key: "keep", def: character({ name: "Keep" }), owner: P1, zone: "hand" },
        ...Array.from({ length: 3 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("deception", 4, P1)
      ]
    });
    activate(engine, P1, id("eab"), "hunker-down", { selected: { c: [id("gone")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("gone")].zone, "removed");
  });
});

describe("Ungodly Mess — Expert Debater", () => {
  test("loses 1 life per token on it", () => {
    const d = def("Expert Debater");
    const { engine, id } = buildGame({
      cards: [{ key: "ed", def: d, owner: P1, zone: "play", counters: { token: 2 } }]
    });
    assert.equal(engine.getStat(id("ed"), "life"), (d.life ?? 0) - 2);
  });
});

describe("Ungodly Mess — Extremely Tiny Bonnet of Invisibility", () => {
  test("the attached character gains COVERT", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
        { key: "bonnet", def: def("Extremely Tiny Bonnet of Invisibility"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.ok(engine.getKeywords(id("host")).includes("covert"));
  });
});

describe("Ungodly Mess — Ezekial Cutpurse", () => {
  test("your cheap characters gain strength and your expensive ones gain speed", () => {
    const cheap = character({ name: "Cheap", cost: 2, strength: 1, speed: 3 });
    const pricey = character({ name: "Pricey", cost: 5, strength: 1, speed: 3 });
    const { engine, id } = buildGame({
      cards: [
        { key: "ez", def: def("Ezekial Cutpurse"), owner: P1, zone: "play" },
        { key: "cheap", def: cheap, owner: P1, zone: "play" },
        { key: "pricey", def: pricey, owner: P1, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("cheap"), "strength"), 2);
    assert.equal(engine.getStat(id("pricey"), "speed"), 4);
  });
});

describe("Ungodly Mess — Fade of the Devoured Emperor", () => {
  test("is a plain vanilla character", () => {
    const d = def("Fade of the Devoured Emperor");
    const { engine, id } = buildGame({
      cards: [{ key: "f", def: d, owner: P1, zone: "play" }]
    });
    assert.equal(engine.getStat(id("f"), "strength"), d.strength ?? 0);
    assert.equal(engine.getStat(id("f"), "life"), d.life ?? 0);
  });
});

describe("Ungodly Mess — Fantastic Über Kool Creator Majig", () => {
  test("its numeric cost is reduced by the number of [E] you control", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "fm", def: def("Fantastic Über Kool Creator Majig"), owner: P1, zone: "hand" },
        ...bank("elitism", 7, P1)
      ]
    });
    play(engine, P1, id("fm"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("fm")].zone, "play");
  });
});

describe("Ungodly Mess — Feckless Chronicler", () => {
  test("gains +1/+1 per token on it", () => {
    const d = def("Feckless Chronicler");
    const { engine, id } = buildGame({
      cards: [{ key: "fc", def: d, owner: P1, zone: "play", counters: { token: 2 } }]
    });
    assert.equal(engine.getStat(id("fc"), "strength"), (d.strength ?? 0) + 2);
    assert.equal(engine.getStat(id("fc"), "life"), (d.life ?? 0) + 2);
  });
});

describe("Ungodly Mess — Fleet Majig", () => {
  test("cannot be blocked; [E]x6 grants +2/+2", () => {
    const d = def("Fleet Majig");
    const { engine, id } = buildGame({
      cards: [{ key: "fm", def: d, owner: P1, zone: "play" }, ...bank("elitism", 6, P1)]
    });
    assert.ok(engine.getKeywords(id("fm")).includes("cannotBeBlocked"));
    assert.equal(engine.getStat(id("fm"), "strength"), (d.strength ?? 0) + 2);
  });
});

describe("Ungodly Mess — Flesh Deliquesce", () => {
  test("destroys a character with strength ≤ the opponent's detached-resource count", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "fd", def: def("Flesh Deliquesce"), owner: P1, zone: "hand" },
        { key: "weak", def: character({ name: "Weak", strength: 2, life: 5 }), owner: P2, zone: "play" },
        ...bank("rage", 3, P2),
        ...bank("obsession", 6, P1)
      ]
    });
    play(engine, P1, id("fd"), { selected: { c: [id("weak")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("weak")].zone, "discard");
  });
});

describe("Ungodly Mess — Foreclosure Overseer", () => {
  test("while depleted, opponents must pay 1 more to deploy cards", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "fo", def: def("Foreclosure Overseer"), owner: P1, zone: "play", depleted: true },
        { key: "freebie", def: character({ name: "Freebie", cost: 0 }), owner: P2, zone: "hand" }
      ],
      activePlayerId: P2,
      turn: 2
    });
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P2, cardId: id("freebie"), selected: {} } as never)
    );
  });
});

describe("Ungodly Mess — Frantic Jerryrigging", () => {
  test("destroys your item, then destroys an opponent's cheap item", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "fj", def: def("Frantic Jerryrigging"), owner: P1, zone: "hand" },
        { key: "myit", def: item({ name: "MyItem", cost: 1 }), owner: P1, zone: "play" },
        { key: "oppit", def: item({ name: "OppItem", cost: 2 }), owner: P2, zone: "play" },
        ...bank("elitism", 6, P1)
      ]
    });
    play(engine, P1, id("fj"), { selected: { it: [id("myit")] } });
    drain(engine, pc => {
      if (pc.kind === "chooserSelectsOption") return { kind: "chooserSelectsOption", index: 1 };
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [id("oppit")] };
      return declineAll(pc);
    });
    assert.equal(engine.state.cards[id("oppit")].zone, "discard");
    assert.equal(engine.state.cards[id("myit")].zone, "discard");
  });
});

// =====================================================================
// G
// =====================================================================

describe("Ungodly Mess — Geldale, City-Fortress", () => {
  test("an opponent cannot play a tactic in response during your turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "geld", def: def("Geldale, City-Fortress"), owner: P1, zone: "play" },
        { key: "dummy", def: character({ name: "Dummy", life: 5 }), owner: P1, zone: "play" },
        { key: "mine", def: killTactic({ name: "Mine" }), owner: P1, zone: "hand" },
        { key: "theirs", def: killTactic({ name: "Theirs" }), owner: P2, zone: "hand" },
        ...bank("rage", 6, P1),
        ...bank("rage", 6, P2)
      ],
      turn: 2
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("mine"), selected: { t: [id("dummy")] } } as never);
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P2, cardId: id("theirs"), selected: { t: [id("dummy")] } } as never)
    );
  });
});

describe("Ungodly Mess — Ghosts of Loot", () => {
  test("when it attacks, your faction gains 1 influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "gol", def: def("Ghosts of Loot"), owner: P1, zone: "play" },
        ...bank("greed", 6, P1)
      ],
      turn: 2
    });
    const inf = engine.state.players[P1].influence;
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("gol")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, inf + 1);
  });
});

describe("Ungodly Mess — God's Blessing of Boost", () => {
  test("ETB inflicts 1 damage to all characters", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "gbb", def: def("God's Blessing of Boost"), owner: P1, zone: "hand" },
        { key: "host", def: character({ name: "Host", life: 6 }), owner: P1, zone: "play" },
        { key: "other", def: character({ name: "Other", life: 6 }), owner: P2, zone: "play" },
        ...bank("rage", 8, P1)
      ]
    });
    play(engine, P1, id("gbb"), { selected: { attachTo: [id("host")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("host")].damage, 1);
    assert.equal(engine.state.cards[id("other")].damage, 1);
  });
});

describe("Ungodly Mess — God's Blessing of Foresight", () => {
  test("the attached character's granted text slows your characters by 1 speed", () => {
    const ally = character({ name: "Ally", speed: 3 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "gbf", def: def("God's Blessing of Foresight"), owner: P1, zone: "hand" },
        { key: "host", def: character({ name: "Host", speed: 3 }), owner: P1, zone: "play" },
        { key: "ally", def: ally, owner: P1, zone: "play" },
        ...bank("obsession", 8, P1)
      ]
    });
    play(engine, P1, id("gbf"), { selected: { attachTo: [id("host")] } });
    drain(engine, declineAll);
    assert.equal(engine.getStat(id("ally"), "speed"), (ally.speed ?? 0) - 1);
  });
});

describe("Ungodly Mess — God's Blessing of Moola", () => {
  test("deploys attached to the chosen character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "gbm", def: def("God's Blessing of Moola"), owner: P1, zone: "hand" },
        { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
        ...bank("greed", 8, P1)
      ]
    });
    play(engine, P1, id("gbm"), { selected: { attachTo: [id("host")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("gbm")].attachedTo, id("host"));
  });
});

describe("Ungodly Mess — God's Blessing of Readiness", () => {
  test("the attached character's granted text gives your characters -1 strength and +1 life", () => {
    const ally = character({ name: "Ally", strength: 3, life: 3 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "gbr", def: def("God's Blessing of Readiness"), owner: P1, zone: "hand" },
        { key: "host", def: character({ name: "Host", strength: 3, life: 3 }), owner: P1, zone: "play" },
        { key: "ally", def: ally, owner: P1, zone: "play" },
        ...bank("elitism", 8, P1)
      ]
    });
    play(engine, P1, id("gbr"), { selected: { attachTo: [id("host")] } });
    drain(engine, declineAll);
    assert.equal(engine.getStat(id("ally"), "strength"), (ally.strength ?? 0) - 1);
    assert.equal(engine.getStat(id("ally"), "life"), (ally.life ?? 0) + 1);
  });
});

describe("Ungodly Mess — God's Blessing of Transfiguration", () => {
  test("the attached character's granted text gives your characters +1 strength and -1 life", () => {
    const ally = character({ name: "Ally", strength: 3, life: 3 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "gbt", def: def("God's Blessing of Transfiguration"), owner: P1, zone: "hand" },
        { key: "host", def: character({ name: "Host", strength: 3, life: 3 }), owner: P1, zone: "play" },
        { key: "ally", def: ally, owner: P1, zone: "play" },
        ...bank("deception", 8, P1)
      ]
    });
    play(engine, P1, id("gbt"), { selected: { attachTo: [id("host")] } });
    drain(engine, declineAll);
    assert.equal(engine.getStat(id("ally"), "strength"), (ally.strength ?? 0) + 1);
    assert.equal(engine.getStat(id("ally"), "life"), (ally.life ?? 0) - 1);
  });
});

describe("Ungodly Mess — Gor-blach the Endowed", () => {
  test("GET IN THERE destroys a blocked attacker you control and burns a faction for its strength", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "gb", def: def("Gor-blach the Endowed"), owner: P1, zone: "play" },
        { key: "ga", def: character({ name: "GA", strength: 3, life: 5, speed: 3 }), owner: P1, zone: "play" },
        { key: "blk", def: character({ name: "Blk", strength: 0, life: 5, speed: 1 }), owner: P2, zone: "play" },
        ...volition(6, P1)
      ],
      turn: 2
    });
    const facP2 = engine.state.players[P2].factionId!;
    const inf = engine.state.players[P2].influence;
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("ga")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("gb"), abilityId: "get-in-there", selected: { c: [id("ga")] }, variables: {} });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("ga")].zone, "discard");
    assert.equal(engine.state.players[P2].influence, inf - 3);
  });
});

describe("Ungodly Mess — Gory Trick Box", () => {
  test("the attached character gains 2 strength and loses 2 speed", () => {
    const host = character({ name: "Host", strength: 2, speed: 4 });
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: host, owner: P1, zone: "play" },
        { key: "gtb", def: def("Gory Trick Box"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), (host.strength ?? 0) + 2);
    assert.equal(engine.getStat(id("host"), "speed"), (host.speed ?? 0) - 2);
  });
});

describe("Ungodly Mess — Gosche's harvest locations", () => {
  const locs: Array<{ name: string; icon: "obsession" | "rage" | "greed" | "elitism" | "deception" }> = [
    { name: "Gosche's God Amplification Chamber", icon: "obsession" },
    { name: "Gosche's Restoration Fortress", icon: "rage" },
    { name: "Gosche's Retained Earnings Vault", icon: "greed" },
    { name: "Gosche's Solar Citadel", icon: "elitism" },
    { name: "Gosche's Spynarium", icon: "deception" }
  ];
  for (const { name, icon } of locs) {
    test(`${name} — its seed ability puts a token on a chosen character you control`, () => {
      const { engine, id } = buildGame({
        playerA: { faction: developFaction() },
        cards: [
          { key: "loc", def: def(name), owner: P1, zone: "play" },
          { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" },
          ...bank(icon, 4, P1)
        ]
      });
      activate(engine, P1, id("loc"), "seed", { selected: { c: [id("c")] } });
      assert.equal(engine.state.cards[id("c")].counters?.token, 1);
    });
  }

  test("Gosche's Retained Earnings Vault — a token character leaving play gives +2 influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rev", def: def("Gosche's Retained Earnings Vault"), owner: P1, zone: "play" },
        { key: "tok", def: character({ name: "Tok" }), owner: P1, zone: "play", counters: { token: 1 } },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("kill"), { selected: { t: [id("tok")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.players[P1].influence, inf + 2);
  });
});

describe("Ungodly Mess — Gosche's Voidal Frequency Emission", () => {
  test("draws a card and puts a discard-pile character on top of its owner's deck", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "gvfe", def: def("Gosche's Voidal Frequency Emission"), owner: P1, zone: "hand" },
        { key: "corpse", def: character({ name: "Corpse" }), owner: P1, zone: "discard" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("gvfe"), { selected: { c: [id("corpse")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 0 } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("corpse")].zone, "deck");
    assert.equal(engine.state.players[P1].deck[0], id("corpse"));
  });
});

describe("Ungodly Mess — Great Mau General", () => {
  test("when it inflicts damage and your influence is 10 or less, your faction gains 2", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction(), influence: 8 },
      cards: [
        { key: "gmg", def: def("Great Mau General"), owner: P1, zone: "play" }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("gmg")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, 10);
  });
});

// =====================================================================
// H – P
// =====================================================================

describe("Ungodly Mess — Haunting Execution", () => {
  test("destroys a chosen character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "he", def: def("Haunting Execution"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" },
        ...bank("greed", 8, P1)
      ]
    });
    play(engine, P1, id("he"), { selected: { c: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].zone, "discard");
  });
});

describe("Ungodly Mess — Headshot", () => {
  test("inflicts 1 damage to a chosen character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "hs", def: def("Headshot"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", life: 5 }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("hs"), { selected: { c: [id("oc")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("oc")].damage, 1);
  });
});

describe("Ungodly Mess — Ignatious, Tactician Crafter", () => {
  test("all UNIQUE UHLUHTC gain +3/+3", () => {
    const uhl = character({ name: "Uhl", unique: "uhluhtc", strength: 2, life: 2 });
    const { engine, id } = buildGame({
      cards: [
        { key: "ig", def: def("Ignatious, Tactician Crafter"), owner: P1, zone: "play" },
        { key: "uhl", def: uhl, owner: P1, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("uhl"), "strength"), (uhl.strength ?? 0) + 3);
    assert.equal(engine.getStat(id("uhl"), "life"), (uhl.life ?? 0) + 3);
  });
});

describe("Ungodly Mess — Interpret the Void", () => {
  test("puts up to 3 chosen cards from your deck into the void", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "itv", def: def("Interpret the Void"), owner: P1, zone: "hand" },
        ...Array.from({ length: 3 }, (_, i) => ({ key: `v${i}`, def: character({ name: `V${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("obsession", 4, P1)
      ]
    });
    play(engine, P1, id("itv"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("v0"), id("v1"), id("v2")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("v0")].zone, "void");
    assert.equal(engine.state.cards[id("v2")].zone, "void");
  });
});

describe("Ungodly Mess — Jo Ciendeilio, Iron Born", () => {
  test("ETB may tutor a gearsmith item into hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "jo", def: def("Jo Ciendeilio, Iron Born"), owner: P1, zone: "hand" },
        { key: "tool", def: item({ name: "Tool", trade: "gearsmith" }), owner: P1, zone: "deck" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("elitism", 6, P1)
      ]
    });
    play(engine, P1, id("jo"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("tool")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("tool")].zone, "hand");
  });
});

describe("Ungodly Mess — Key to the City", () => {
  test("UNLOCK POTENTIAL discards it from hand to tutor a resource into hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "kttc", def: def("Key to the City"), owner: P1, zone: "hand" },
        { key: "res", def: resourceCard({ name: "Deception", resource: { provides: ["deception"], staple: true } }), owner: P1, zone: "deck" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("greed", 6, P1)
      ]
    });
    activate(engine, P1, id("kttc"), "unlock-potential");
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("res")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("res")].zone, "hand");
    assert.equal(engine.state.cards[id("kttc")].zone, "discard");
  });
});

describe("Ungodly Mess — Kitten Mittons", () => {
  test("when damage is inflicted to the attached card, your faction gains that much influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "host", def: character({ name: "Host", life: 10 }), owner: P1, zone: "play" },
        { key: "km", def: def("Kitten Mittons"), owner: P1, zone: "play", attachedToKey: "host" },
        { key: "zap", def: killTactic({ name: "Zap", behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 3 }] }] } }), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("zap"), { selected: { t: [id("host")] } });
    assert.equal(engine.state.players[P1].influence, inf + 3);
  });
});

describe("Ungodly Mess — Last Minute Weaponization", () => {
  test("destroys your item to inflict its cost + 1 damage to a character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "lmw", def: def("Last Minute Weaponization"), owner: P1, zone: "hand" },
        { key: "myit", def: item({ name: "MyItem", cost: 1 }), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC", life: 6 }), owner: P2, zone: "play" },
        ...bank("elitism", 6, P1)
      ]
    });
    play(engine, P1, id("lmw"), { selected: { it: [id("myit")], c: [id("oc")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("oc")].damage, 2);
    assert.equal(engine.state.cards[id("myit")].zone, "discard");
  });
});

describe("Ungodly Mess — Lead the Assault", () => {
  test("gives an attacking character you control +2/+2 this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "lta", def: def("Lead the Assault"), owner: P1, zone: "hand" },
        { key: "a", def: character({ name: "A", strength: 2, life: 4, speed: 3 }), owner: P1, zone: "play" },
        ...bank("elitism", 6, P1)
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("a")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("lta"), selected: { c: [id("a")] } } as never);
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("a"), "strength"), 2 + 2);
    assert.equal(engine.getStat(id("a"), "life"), 4 + 2);
  });
});

describe("Ungodly Mess — Limited Liability", () => {
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

describe("Ungodly Mess — Little God of Answers", () => {
  test("at end of your turn, if depleted, may pay 1 to tutor a tactic", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "lga", def: def("Little God of Answers"), owner: P1, zone: "play", depleted: true },
        { key: "tac", def: tactic({ name: "Tac" }), owner: P1, zone: "deck" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("obsession", 6, P1)
      ]
    });
    engine.perform({ type: "endTurn", playerId: P1 });
    drain(engine, pc => {
      if (pc.kind === "mayPay") return { kind: "mayPay", pay: true };
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [id("tac")] };
      return declineAll(pc);
    });
    assert.equal(engine.state.cards[id("tac")].zone, "hand");
  });
});

describe("Ungodly Mess — Lockbox of the Aeons", () => {
  test("an opponent's card in play cannot be returned to their hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "lb", def: def("Lockbox of the Aeons"), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" },
        { key: "bounce", def: tactic({ name: "Bounce", cost: 0, behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] } }), owner: P1, zone: "hand" },
        ...bank("obsession", 4, P1)
      ]
    });
    play(engine, P1, id("bounce"), { selected: { t: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].zone, "play");
  });
});

describe("Ungodly Mess — Lost on Floor 3", () => {
  test("is a rogue tactic in the catalog (unimplemented end-of-turn timing)", () => {
    const d = def("Lost on Floor 3");
    assert.equal(d.type, "tactic");
    assert.equal(d.trade, "rogue");
  });
});

describe("Ungodly Mess — Malevolent Trooper", () => {
  test("PUSH depletes a character you control for +2 strength this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mt", def: def("Malevolent Trooper"), owner: P1, zone: "play" },
        { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    const str = engine.getStat(id("mt"), "strength");
    activate(engine, P1, id("mt"), "push", { selected: { c: [id("ally")] } });
    assert.equal(engine.getStat(id("mt"), "strength"), str + 2);
    assert.equal(engine.state.cards[id("ally")].depleted, true);
  });
});

describe("Ungodly Mess — Micromajig", () => {
  test("is a plain 1/1 token character", () => {
    const d = def("Micromajig");
    const { engine, id } = buildGame({
      cards: [{ key: "mm", def: d, owner: P1, zone: "play" }]
    });
    assert.equal(engine.getStat(id("mm"), "strength"), d.strength ?? 0);
    assert.equal(engine.getStat(id("mm"), "life"), d.life ?? 0);
  });
});

describe("Ungodly Mess — Moment of Annihilation", () => {
  test("destroys a character with 4 life or less", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "moa", def: def("Moment of Annihilation"), owner: P1, zone: "hand" },
        { key: "frail", def: character({ name: "Frail", life: 3 }), owner: P2, zone: "play" },
        ...bank("deception", 8, P1)
      ]
    });
    play(engine, P1, id("moa"), { selected: { rm: [], c: [id("frail")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("frail")].zone, "discard");
  });
});

describe("Ungodly Mess — Multi-Attachment Man", () => {
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

describe("Ungodly Mess — Noxious Gambler", () => {
  test("when restored, offers a look at the top of your deck", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ng", def: def("Noxious Gambler"), owner: P1, zone: "play", depleted: true },
        { key: "restore", def: tactic({ name: "Restore", cost: 0, behavior: { abilities: [{ id: "r", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "restore", target: { type: "selected", id: "t" } }] }] } }), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("restore"), selected: { t: [id("ng")] } } as never);
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice?.kind, "reorderDeck");
    drain(engine, declineAll);
  });
});

describe("Ungodly Mess — Omahkapi'si Pi'kssii", () => {
  test("while an opponent has 10+ cards in discard, they cannot pick it", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "op", def: def("Omahkapi'si Pi'kssii"), owner: P1, zone: "play" },
        ...Array.from({ length: 10 }, (_, i) => ({ key: `g${i}`, def: character({ name: `G${i}` }), owner: P2, zone: "discard" as const }))
      ]
    });
    assert.ok(engine.getRestrictions(id("op")).includes("cannotBePicked"));
  });

  test("FLEX removes an opponent's discard card and grants +2 strength this turn", () => {
    const d = def("Omahkapi'si Pi'kssii");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "op", def: d, owner: P1, zone: "play" },
        { key: "corpse", def: character({ name: "Corpse" }), owner: P2, zone: "discard" },
        ...bank("deception", 6, P1)
      ]
    });
    activate(engine, P1, id("op"), "flex", { selected: { c: [id("corpse")] } });
    assert.equal(engine.state.cards[id("corpse")].zone, "removed");
    assert.equal(engine.getStat(id("op"), "strength"), (d.strength ?? 0) + 2);
  });
});

describe("Ungodly Mess — Overindulge", () => {
  test("OPTION 1 makes a character lose 2 life this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "oi", def: def("Overindulge"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", life: 5 }), owner: P2, zone: "play" },
        ...bank("deception", 6, P1)
      ]
    });
    play(engine, P1, id("oi"), { mode: 0, selected: { c: [id("oc")] } });
    assert.equal(engine.getStat(id("oc"), "life"), 5 - 2);
  });
});

describe("Ungodly Mess — P0p", () => {
  test("BOLSTER depletes another character you control for +1/+1 this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "p0p", def: def("P0p"), owner: P1, zone: "play" },
        { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" }
      ]
    });
    const str = engine.getStat(id("p0p"), "strength");
    activate(engine, P1, id("p0p"), "bolster", { selected: { a: [id("ally")] } });
    assert.equal(engine.getStat(id("p0p"), "strength"), str + 1);
    assert.equal(engine.state.cards[id("ally")].depleted, true);
  });
});

describe("Ungodly Mess — Padamose Cultists", () => {
  test("ETB does not draw without a prior non-character deploy this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pc", def: def("Padamose Cultists"), owner: P1, zone: "hand" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("greed", 4, P1)
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    play(engine, P1, id("pc"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("pc")].zone, "play");
    assert.equal(engine.state.players[P1].hand.length, hand - 1);
  });

  test("ETB draws 2 after you deployed a non-character card this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pc", def: def("Padamose Cultists"), owner: P1, zone: "hand" },
        { key: "trinket", def: item({ name: "Trinket", cost: 0 }), owner: P1, zone: "hand" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("greed", 4, P1)
      ],
      turn: 2
    });
    const hand = engine.state.players[P1].hand.length;
    play(engine, P1, id("trinket"), {});
    play(engine, P1, id("pc"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("pc")].zone, "play");
    assert.equal(engine.state.players[P1].hand.length, hand - 2 + 2);
  });
});

describe("Ungodly Mess — Pandering Politician", () => {
  test("PANDER removes a token from a chosen character or item", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pp", def: def("Pandering Politician"), owner: P1, zone: "play" },
        { key: "tok", def: character({ name: "Tok" }), owner: P2, zone: "play", counters: { token: 2 } }
      ]
    });
    activate(engine, P1, id("pp"), "pander", { selected: { c: [id("tok")] } });
    assert.equal(engine.state.cards[id("tok")].counters?.token, 1);
  });
});

describe("Ungodly Mess — Party Crashers", () => {
  test("[E]x4: when destroyed, puts 2 Micromajig tokens into play", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pc", def: def("Party Crashers"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        ...bank("elitism", 6, P1)
      ]
    });
    play(engine, P1, id("kill"), { selected: { t: [id("pc")] } });
    drain(engine, declineAll);
    const micros = Object.values(engine.state.cards).filter(
      c => c.zone === "play" && c.controllerId === P1 && engine.getDefinition(c.id).name === "Micromajig"
    );
    assert.equal(micros.length, 2);
  });
});

describe("Ungodly Mess — Pluck", () => {
  test("GRIFT pays 5 and depletes to reanimate a non-tactic from an opponent's discard", () => {
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

describe("Ungodly Mess — PP&E", () => {
  test("PAY OFF terminates a character being deployed", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "ppe", def: def("PP&E"), owner: P1, zone: "play" },
        { key: "guy", def: character({ name: "Guy", cost: 2 }), owner: P2, zone: "hand" },
        ...bank("greed", 6, P1),
        ...bank("greed", 4, P2)
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("guy"), selected: {} } as never);
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("ppe"), abilityId: "pay-off", selected: {}, variables: {} });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("guy")].zone, "discard");
    assert.equal(engine.state.cards[id("ppe")].zone, "discard");
  });
});

describe("Ungodly Mess — Pride of Goru-Goru Gidea", () => {
  test("DISAPPEAR grants COVERT this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pg", def: def("Pride of Goru-Goru Gidea"), owner: P1, zone: "play" },
        ...bank("greed", 6, P1)
      ]
    });
    activate(engine, P1, id("pg"), "disappear");
    assert.ok(engine.getKeywords(id("pg")).includes("covert"));
  });
});

describe("Ungodly Mess — Purloining Performance", () => {
  test("resolves a top-4 look at an opponent's deck", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pp", def: def("Purloining Performance"), owner: P1, zone: "hand" },
        ...Array.from({ length: 6 }, (_, i) => ({ key: `o${i}`, def: character({ name: `O${i}` }), owner: P2, zone: "deck" as const })),
        ...bank("deception", 6, P1)
      ]
    });
    const deckLen = engine.state.players[P2].deck.length;
    play(engine, P1, id("pp"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("pp")].zone, "discard");
    assert.equal(engine.state.players[P2].deck.length, deckLen);
  });
});

// =====================================================================
// Q – T
// =====================================================================

describe("Ungodly Mess — Quilt of Old Banners", () => {
  test("HAND IT DOWN shuffles it into your deck and draws a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "quilt", def: def("Quilt of Old Banners"), owner: P1, zone: "play" },
        ...Array.from({ length: 3 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("rage", 4, P1)
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    activate(engine, P1, id("quilt"), "hand-it-down");
    assert.notEqual(engine.state.cards[id("quilt")].zone, "play");
    assert.equal(engine.state.players[P1].hand.length, hand + 1);
  });
});

describe("Ungodly Mess — Quipster D'Genie", () => {
  test("WISH destroys itself to tutor a tactic into hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "qd", def: def("Quipster D'Genie"), owner: P1, zone: "play" },
        { key: "tac", def: tactic({ name: "Tac" }), owner: P1, zone: "deck" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("obsession", 4, P1)
      ]
    });
    activate(engine, P1, id("qd"), "wish");
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("tac")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("tac")].zone, "hand");
    assert.equal(engine.state.cards[id("qd")].zone, "discard");
  });
});

describe("Ungodly Mess — Quotidian Assassination", () => {
  test("returns a chosen character to its owner's hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "qa", def: def("Quotidian Assassination"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" },
        ...bank("obsession", 4, P1)
      ]
    });
    play(engine, P1, id("qa"), { selected: { c: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].zone, "hand");
  });
});

describe("Ungodly Mess — Quotidian Quagmire", () => {
  test("a chosen character loses 1 speed this turn and you draw a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "qq", def: def("Quotidian Quagmire"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", speed: 4 }), owner: P2, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("obsession", 6, P1)
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    play(engine, P1, id("qq"), { selected: { c: [id("oc")] } });
    drain(engine, declineAll);
    assert.equal(engine.getStat(id("oc"), "speed"), 4 - 1);
    assert.equal(engine.state.players[P1].hand.length, hand - 1 + 1);
  });
});

describe("Ungodly Mess — Readied Rifleman", () => {
  test("when restored, may inflict 1 damage to a chosen faction", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rr", def: def("Readied Rifleman"), owner: P1, zone: "play", depleted: true },
        { key: "restore", def: tactic({ name: "Restore", cost: 0, behavior: { abilities: [{ id: "r", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "restore", target: { type: "selected", id: "t" } }] }] } }), owner: P1, zone: "hand" }
      ]
    });
    const facP2 = engine.state.players[P2].factionId!;
    const inf = engine.state.players[P2].influence;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("restore"), selected: { t: [id("rr")] } } as never);
    resolvePendingResponses(engine);
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [facP2] } : declineAll(pc)
    );
    assert.equal(engine.state.players[P2].influence, inf - 1);
  });
});

describe("Ungodly Mess — Redecorator Majig", () => {
  test("EXTRA COST depletes a location; it then gains +3/+1 while that location is depleted", () => {
    const d = def("Redecorator Majig");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rm", def: d, owner: P1, zone: "hand" },
        { key: "loc", def: location({ name: "Loc", structure: 4 }), owner: P2, zone: "play" },
        ...bank("elitism", 8, P1)
      ]
    });
    play(engine, P1, id("rm"), { selected: { loc: [id("loc")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("loc")].depleted, true);
    assert.equal(engine.getStat(id("rm"), "strength"), (d.strength ?? 0) + 3);
  });
});

describe("Ungodly Mess — Regroup & Reassess", () => {
  test("draws 2 cards", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rr", def: def("Regroup & Reassess"), owner: P1, zone: "hand" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("greed", 6, P1)
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    play(engine, P1, id("rr"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.players[P1].hand.length, hand - 1 + 2);
  });
});

describe("Ungodly Mess — Retreat to Mount Mulrich", () => {
  test("a marked character goes to its owner's hand instead of leaving play", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rtm", def: def("Retreat to Mount Mulrich"), owner: P1, zone: "hand" },
        { key: "safe", def: character({ name: "Safe" }), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        ...bank("deception", 6, P1)
      ]
    });
    play(engine, P1, id("rtm"), { selected: { c: [id("safe")] } });
    play(engine, P1, id("kill"), { selected: { t: [id("safe")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("safe")].zone, "hand");
  });
});

describe("Ungodly Mess — Ritual of the Sucking Skull", () => {
  test("cannot be deployed outside a response to a FLIP UP deploy", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rss", def: def("Ritual of the Sucking Skull"), owner: P1, zone: "hand" },
        ...bank("obsession", 6, P1)
      ]
    });
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("rss"), selected: {} } as never)
    );
  });
});

describe("Ungodly Mess — Ritualized Destruction", () => {
  test("a non-[V] card is returned to its owner's hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rd", def: def("Ritualized Destruction"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", text: "no icons" }), owner: P2, zone: "play" },
        ...bank("obsession", 6, P1)
      ]
    });
    play(engine, P1, id("rd"), { selected: { c: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].zone, "hand");
  });
});

describe("Ungodly Mess — Rudo Mangod, Fightful Adonis", () => {
  test("on attack it offers a pay-2 team pump", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rm", def: def("Rudo Mangod, Fightful Adonis"), owner: P1, zone: "play" },
        ...bank("rage", 6, P1)
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("rm")], target: { type: "faction", playerId: P2 } });
    assert.equal(engine.state.pendingChoice?.kind, "mayPay");
  });
});

describe("Ungodly Mess — Salvo Sarume", () => {
  test("on battle damage to a faction, may bounce a resource to inflict 1 damage to all characters", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ss", def: def("Salvo Sarume"), owner: P1, zone: "play" },
        { key: "bystander", def: character({ name: "Bystander", life: 5 }), owner: P2, zone: "play" },
        ...bank("rage", 4, P1)
      ],
      turn: 2
    });
    const res = Object.values(engine.state.cards).find(
      c => c.controllerId === P1 && engine.getDefinition(c.id).type === "resource"
    )!;
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("ss")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [res.id] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[res.id].zone, "hand");
    assert.equal(engine.state.cards[id("bystander")].damage, 1);
  });
});

describe("Ungodly Mess — Seance Ritualist", () => {
  test("VIOLATE depletes it and adds a token", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [{ key: "sr", def: def("Seance Ritualist"), owner: P1, zone: "play" }]
    });
    activate(engine, P1, id("sr"), "violate");
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("sr")].depleted, true);
    assert.equal(engine.state.cards[id("sr")].counters?.token, 1);
  });
});

describe("Ungodly Mess — Securitymajig Mark II", () => {
  test("can block COVERT parties; gains +1 strength per token", () => {
    const d = def("Securitymajig Mark II");
    const { engine, id } = buildGame({
      cards: [{ key: "sm", def: d, owner: P1, zone: "play", counters: { token: 3 } }]
    });
    assert.ok(engine.getKeywords(id("sm")).includes("canBlockCovert"));
    assert.equal(engine.getStat(id("sm"), "strength"), (d.strength ?? 0) + 3);
  });
});

describe("Ungodly Mess — Servers Unavailable", () => {
  test("terminates a card being deployed", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "su", def: def("Servers Unavailable"), owner: P1, zone: "hand" },
        { key: "guy", def: character({ name: "Guy", cost: 2 }), owner: P2, zone: "hand" },
        ...bank("elitism", 8, P1),
        ...bank("greed", 4, P2)
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("guy"), selected: {} } as never);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("su"), selected: {} } as never);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("guy")].zone, "discard");
  });
});

describe("Ungodly Mess — Severed Limb", () => {
  test("the attached character gains 1 strength", () => {
    const host = character({ name: "Host", strength: 2 });
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: host, owner: P1, zone: "play" },
        { key: "sl", def: def("Severed Limb"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), (host.strength ?? 0) + 1);
  });
});

describe("Ungodly Mess — Silencer", () => {
  test("a character with a token on it cannot block it", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sil", def: def("Silencer"), owner: P1, zone: "play" },
        { key: "tok", def: character({ name: "Tok", strength: 0, life: 5, speed: 1 }), owner: P2, zone: "play", counters: { token: 1 } }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("sil")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    assert.throws(() =>
      engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("tok")] })
    );
  });
});

describe("Ungodly Mess — Silent Sentinels", () => {
  test("all characters must attack; [E]x3 grants AGGRO", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ss", def: def("Silent Sentinels"), owner: P1, zone: "play" },
        { key: "other", def: character({ name: "Other" }), owner: P1, zone: "play" },
        ...bank("elitism", 3, P1)
      ]
    });
    assert.ok(engine.getRestrictions(id("other")).includes("mustAttack"));
    assert.ok(engine.getKeywords(id("ss")).includes("aggro"));
  });
});

describe("Ungodly Mess — Single Combat", () => {
  test("inflicts 2 damage to a non-[V] card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sc", def: def("Single Combat"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", life: 5, text: "no icons" }), owner: P2, zone: "play" },
        ...bank("rage", 4, P1)
      ]
    });
    play(engine, P1, id("sc"), { selected: { c: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].damage, 2);
  });
});

describe("Ungodly Mess — Slippery Assailant", () => {
  test("returns to its owner's hand after inflicting battle damage to a faction", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "sa", def: def("Slippery Assailant"), owner: P1, zone: "play" }],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("sa")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("sa")].zone, "hand");
  });
});

describe("Ungodly Mess — Smokin' Hottie", () => {
  test("ETB costs your faction 2 influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sh", def: def("Smokin' Hottie"), owner: P1, zone: "hand" },
        ...bank("greed", 6, P1)
      ]
    });
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("sh"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.players[P1].influence, inf - 2);
  });
});

describe("Ungodly Mess — Soulsearcher", () => {
  test("[R] grants +2 strength this turn", () => {
    const d = def("Soulsearcher");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "so", def: d, owner: P1, zone: "play" }, ...bank("rage", 4, P1)]
    });
    activate(engine, P1, id("so"), "r");
    assert.equal(engine.getStat(id("so"), "strength"), (d.strength ?? 0) + 2);
  });
});

describe("Ungodly Mess — Strategic Vision", () => {
  test("tutors two different staple resources into hand and gains 1 influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sv", def: def("Strategic Vision"), owner: P1, zone: "hand" },
        { key: "r1", def: resourceCard({ name: "Rage", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "deck" },
        { key: "r2", def: resourceCard({ name: "Elitism", resource: { provides: ["elitism"], staple: true } }), owner: P1, zone: "deck" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("greed", 6, P1)
      ]
    });
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("sv"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("r1"), id("r2")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("r1")].zone, "hand");
    assert.equal(engine.state.cards[id("r2")].zone, "hand");
    assert.equal(engine.state.players[P1].influence, inf + 1);
  });
});

describe("Ungodly Mess — Symmetrical Scimitar", () => {
  test("attached to a character you control, it grants +1/+1", () => {
    const host = character({ name: "Host", strength: 2, life: 2 });
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: host, owner: P1, zone: "play" },
        { key: "ss", def: def("Symmetrical Scimitar"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), (host.strength ?? 0) + 1);
    assert.equal(engine.getStat(id("host"), "life"), (host.life ?? 0) + 1);
  });
});

describe("Ungodly Mess — Thabbashite Convert", () => {
  test("[E][E][V][V] grants +1/+1", () => {
    const d = def("Thabbashite Convert");
    const { engine, id } = buildGame({
      cards: [
        { key: "tc", def: d, owner: P1, zone: "play" },
        ...bank("elitism", 2, P1),
        ...volition(2, P1)
      ]
    });
    assert.equal(engine.getStat(id("tc"), "strength"), (d.strength ?? 0) + 1);
    assert.equal(engine.getStat(id("tc"), "life"), (d.life ?? 0) + 1);
  });
});

describe("Ungodly Mess — Thabbashite Desert Creature", () => {
  test("has COVERT", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "tdc", def: def("Thabbashite Desert Creature"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getKeywords(id("tdc")).includes("covert"));
  });
});

describe("Ungodly Mess — Thabbashite Glutton", () => {
  test("[G][G][V][V]: when destroyed, draw a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "tg", def: def("Thabbashite Glutton"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("greed", 2, P1),
        ...volition(2, P1),
        ...bank("rage", 6, P1)
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    play(engine, P1, id("kill"), { selected: { t: [id("tg")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.players[P1].hand.length, hand - 1 + 1);
  });
});

describe("Ungodly Mess — Thabbashite Host", () => {
  test("[R][R][V][V] grants +4 strength", () => {
    const d = def("Thabbashite Host");
    const { engine, id } = buildGame({
      cards: [
        { key: "th", def: d, owner: P1, zone: "play" },
        ...bank("rage", 2, P1),
        ...volition(2, P1)
      ]
    });
    assert.equal(engine.getStat(id("th"), "strength"), (d.strength ?? 0) + 4);
  });
});

describe("Ungodly Mess — Thabbashite Penumbra", () => {
  test("its activated ability grants COVERT this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "tp", def: def("Thabbashite Penumbra"), owner: P1, zone: "play" },
        ...bank("obsession", 8, P1)
      ]
    });
    activate(engine, P1, id("tp"), "veil");
    assert.ok(engine.getKeywords(id("tp")).includes("covert"));
  });
});

describe("Ungodly Mess — Thabbashite Priest of Zig", () => {
  test("[O][O][V][V] grants COVERT", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "tp", def: def("Thabbashite Priest of Zig"), owner: P1, zone: "play" },
        ...bank("obsession", 2, P1),
        ...volition(2, P1)
      ]
    });
    assert.ok(engine.getKeywords(id("tp")).includes("covert"));
  });
});

describe("Ungodly Mess — Thabbashite Seer", () => {
  test("[D][D][V][V]: on attack, offers a look at the top of a deck", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ts", def: def("Thabbashite Seer"), owner: P1, zone: "play" },
        ...bank("deception", 2, P1),
        ...volition(2, P1),
        ...Array.from({ length: 3 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const }))
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("ts")], target: { type: "faction", playerId: P2 } });
    assert.equal(engine.state.pendingChoice?.kind, "reorderDeck");
    drain(engine, declineAll);
  });
});

describe("Ungodly Mess — Thabbashite Weapons Expert", () => {
  test("[V]x5 grants +2 strength", () => {
    const d = def("Thabbashite Weapons Expert");
    const { engine, id } = buildGame({
      cards: [{ key: "twe", def: d, owner: P1, zone: "play" }, ...volition(5, P1)]
    });
    assert.equal(engine.getStat(id("twe"), "strength"), (d.strength ?? 0) + 2);
  });
});

describe("Ungodly Mess — Theological Opportunist", () => {
  test("loses strength and life equal to the number of cards in all hands", () => {
    const d = def("Theological Opportunist");
    const { engine, id } = buildGame({
      cards: [
        { key: "to", def: d, owner: P1, zone: "play" },
        { key: "h1", def: character({ name: "H1" }), owner: P1, zone: "hand" },
        { key: "h2", def: character({ name: "H2" }), owner: P1, zone: "hand" },
        { key: "h3", def: character({ name: "H3" }), owner: P2, zone: "hand" }
      ]
    });
    assert.equal(engine.getStat(id("to"), "strength"), (d.strength ?? 0) - 3);
    assert.equal(engine.getStat(id("to"), "life"), (d.life ?? 0) - 3);
  });
});

describe("Ungodly Mess — Trickster's Globe", () => {
  test("is a rogue item in the catalog", () => {
    const d = def("Trickster's Globe");
    assert.equal(d.type, "item");
    assert.equal(d.trade, "rogue");
  });
});

// =====================================================================
// U – Z
// =====================================================================

describe("Ungodly Mess — Twisted Marionette", () => {
  test("on battle damage to a faction, may pay 1 to bounce one of that player's characters", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "tm", def: def("Twisted Marionette"), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" },
        ...bank("obsession", 4, P1)
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("tm")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);
    drain(engine, pc => {
      if (pc.kind === "mayPay") return { kind: "mayPay", pay: true };
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [id("oc")] };
      return declineAll(pc);
    });
    assert.equal(engine.state.cards[id("oc")].zone, "hand");
  });
});

describe("Ungodly Mess — Unaccustomed Inspection", () => {
  test("a non-[V] card is flipped face-down and costs your faction its numeric cost", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ui", def: def("Unaccustomed Inspection"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", cost: 3, text: "no icons" }), owner: P2, zone: "play" },
        ...bank("greed", 6, P1)
      ]
    });
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("ui"), { selected: { c: [id("oc")] } });
    assert.equal(engine.state.cards[id("oc")].faceDown, true);
    assert.equal(engine.state.players[P1].influence, inf - 3);
  });
});

describe("Ungodly Mess — Unchained Sarcophyle", () => {
  test("is a plain vanilla character", () => {
    const d = def("Unchained Sarcophyle");
    const { engine, id } = buildGame({
      cards: [{ key: "us", def: d, owner: P1, zone: "play" }]
    });
    assert.equal(engine.getStat(id("us"), "strength"), d.strength ?? 0);
    assert.deepEqual(engine.getKeywords(id("us")), []);
  });
});

describe("Ungodly Mess — Undesirable Intrusion", () => {
  test("terminates a character's ability and destroys that character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "ui", def: def("Undesirable Intrusion"), owner: P1, zone: "hand" },
        { key: "mage", def: character({ name: "Mage", behavior: { abilities: [{ id: "draw1", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] } }), owner: P2, zone: "play" },
        ...Array.from({ length: 3 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P2, zone: "deck" as const })),
        ...bank("elitism", 8, P1)
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "activateAbility", playerId: P2, cardId: id("mage"), abilityId: "draw1", selected: {}, variables: {} });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("ui"), selected: {} } as never);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("mage")].zone, "discard");
  });
});

describe("Ungodly Mess — Unfortunate Fortune Hunter", () => {
  test("is a plain vanilla character", () => {
    const d = def("Unfortunate Fortune Hunter");
    const { engine, id } = buildGame({
      cards: [{ key: "ufh", def: d, owner: P1, zone: "play" }]
    });
    assert.equal(engine.getStat(id("ufh"), "strength"), d.strength ?? 0);
    assert.equal(engine.getStat(id("ufh"), "life"), d.life ?? 0);
  });
});

describe("Ungodly Mess — Unwise Encirclement", () => {
  test("puts a token on a chosen character and inflicts damage equal to its tokens", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ue", def: def("Unwise Encirclement"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", life: 5 }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("ue"), { selected: { c: [id("oc")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("oc")].counters?.token, 1);
    assert.equal(engine.state.cards[id("oc")].damage, 1);
  });
});

describe("Ungodly Mess — Vexillarius Dacian-Draco", () => {
  test("all your OTHER characters gain +2/+2", () => {
    const d = def("Vexillarius Dacian-Draco");
    const ally = character({ name: "Ally", strength: 2, life: 2 });
    const { engine, id } = buildGame({
      cards: [
        { key: "vdd", def: d, owner: P1, zone: "play" },
        { key: "ally", def: ally, owner: P1, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("ally"), "strength"), (ally.strength ?? 0) + 2);
    assert.equal(engine.getStat(id("vdd"), "strength"), d.strength ?? 0);
  });
});

describe("Ungodly Mess — Voidal Bask", () => {
  test("when it leaves play, an opponent discards a card from hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "vb", def: def("Voidal Bask"), owner: P1, zone: "play" },
        { key: "oh1", def: character({ name: "OH1" }), owner: P2, zone: "hand" },
        { key: "oh2", def: character({ name: "OH2" }), owner: P2, zone: "hand" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    const disc = engine.state.players[P2].discard.length;
    play(engine, P1, id("kill"), { selected: { t: [id("vb")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("oh1")] } : declineAll(pc)
    );
    assert.equal(engine.state.players[P2].discard.length, disc + 1);
  });
});

describe("Ungodly Mess — Voidal Tactician", () => {
  test("on battle damage to a faction it offers a pay-1 tactic dig", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "vt", def: def("Voidal Tactician"), owner: P1, zone: "play" },
        { key: "t1", def: tactic({ name: "T1" }), owner: P2, zone: "deck" },
        ...bank("obsession", 4, P1)
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("vt")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);
    assert.equal(engine.state.pendingChoice?.kind, "mayPay");
    drain(engine, declineAll);
  });
});

describe("Ungodly Mess — Volatile Communion", () => {
  test("resolves a top-X+2 look at your deck", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "vc", def: def("Volatile Communion"), owner: P1, zone: "hand" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("obsession", 4, P1)
      ]
    });
    play(engine, P1, id("vc"), { variables: { x: 0 } });
    assert.equal(engine.state.pendingChoice?.kind, "reorderDeck");
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("vc")].zone, "discard");
  });
});

describe("Ungodly Mess — War Racketeer", () => {
  test("ETB draws a card for each character in play", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "wr", def: def("War Racketeer"), owner: P1, zone: "hand" },
        { key: "c1", def: character({ name: "C1" }), owner: P1, zone: "play" },
        { key: "c2", def: character({ name: "C2" }), owner: P2, zone: "play" },
        ...Array.from({ length: 6 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("greed", 8, P1)
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    play(engine, P1, id("wr"), {});
    drain(engine, declineAll);
    // WR + c1 + c2 = 3 characters in play when the ETB resolves
    assert.equal(engine.state.players[P1].hand.length, hand - 1 + 3);
  });
});

describe("Ungodly Mess — Wary Reunion", () => {
  test("removes a character with life ≤ your distinct-trade count from the game", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "wr", def: def("Wary Reunion"), owner: P1, zone: "hand" },
        { key: "t1", def: character({ name: "T1", trade: "warlord" }), owner: P1, zone: "play" },
        { key: "t2", def: character({ name: "T2", trade: "rogue" }), owner: P1, zone: "play" },
        { key: "weak", def: character({ name: "Weak", life: 2 }), owner: P2, zone: "play" },
        ...bank("deception", 6, P1)
      ]
    });
    play(engine, P1, id("wr"), { selected: { c: [id("weak")] } });
    assert.equal(engine.state.cards[id("weak")].zone, "removed");
  });
});

describe("Ungodly Mess — Wasted Wickedness", () => {
  test("an opponent returns X of their non-resource cards to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ww", def: def("Wasted Wickedness"), owner: P1, zone: "hand" },
        { key: "oc1", def: character({ name: "OC1" }), owner: P2, zone: "play" },
        { key: "oc2", def: character({ name: "OC2" }), owner: P2, zone: "play" },
        ...bank("rage", 1, P2),
        ...bank("greed", 1, P2),
        ...bank("obsession", 10, P1)
      ]
    });
    play(engine, P1, id("ww"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("oc1"), id("oc2")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("oc1")].zone, "hand");
    assert.equal(engine.state.cards[id("oc2")].zone, "hand");
  });
});

describe("Ungodly Mess — Wasteland", () => {
  test("when a character inflicts damage to it, that character is destroyed", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "w", def: def("Wasteland"), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 3, life: 5, speed: 3 }), owner: P2, zone: "play" }
      ],
      turn: 2,
      activePlayerId: P2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "card", cardId: id("w") } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("atk")].zone, "discard");
  });
});

describe("Ungodly Mess — Whistleblower Policy", () => {
  test("adds 3 damage markers to a chosen location", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "wp", def: def("Whistleblower Policy"), owner: P1, zone: "hand" },
        { key: "loc", def: location({ name: "Loc", structure: 6 }), owner: P2, zone: "play" },
        ...bank("greed", 6, P1)
      ]
    });
    play(engine, P1, id("wp"), { selected: { loc: [id("loc")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("loc")].damage, 3);
  });
});

describe("Ungodly Mess — Wily Circumvention", () => {
  test("resolves against a depleted character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "wc", def: def("Wily Circumvention"), owner: P1, zone: "hand" },
        { key: "dep", def: character({ name: "Dep" }), owner: P2, zone: "play", depleted: true },
        ...bank("elitism", 4, P1)
      ]
    });
    play(engine, P1, id("wc"), { selected: { c: [id("dep")] } });
    assert.equal(engine.state.cards[id("wc")].zone, "discard");
  });

  test("a non-depleted character is not a legal target", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "wc", def: def("Wily Circumvention"), owner: P1, zone: "hand" },
        { key: "fresh", def: character({ name: "Fresh" }), owner: P2, zone: "play" },
        ...bank("elitism", 4, P1)
      ]
    });
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("wc"), selected: { c: [id("fresh")] } } as never)
    );
  });
});

describe("Ungodly Mess — Yenessa Shipping, LLP", () => {
  test("gains +2/+2 per item your opponents control", () => {
    const d = def("Yenessa Shipping, LLP");
    const { engine, id } = buildGame({
      cards: [
        { key: "ys", def: d, owner: P1, zone: "play" },
        { key: "i1", def: item({ name: "I1" }), owner: P2, zone: "play" },
        { key: "i2", def: item({ name: "I2" }), owner: P2, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("ys"), "strength"), (d.strength ?? 0) + 4);
    assert.equal(engine.getStat(id("ys"), "life"), (d.life ?? 0) + 4);
  });
});

describe("Ungodly Mess — Zenobia, Artificer", () => {
  test("CLAIRVOYANCE spends tokens to tutor a card of cost ≤ X", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "za", def: def("Zenobia, Artificer"), owner: P1, zone: "play", counters: { token: 3 } },
        { key: "cheap", def: character({ name: "Cheap", cost: 2 }), owner: P1, zone: "deck" },
        { key: "d1", def: character({ name: "D1", cost: 9 }), owner: P1, zone: "deck" }
      ]
    });
    activate(engine, P1, id("za"), "clairvoyance", { variables: { x: 2 } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("cheap")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("cheap")].zone, "hand");
    assert.equal(engine.state.cards[id("za")].counters?.token, 1);
  });
});

describe("Ungodly Mess — Zenobia's Intervention", () => {
  test("gives a character +1/+1 per different staple resource you control this turn", () => {
    const c = character({ name: "C", strength: 2, life: 2 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "zi", def: def("Zenobia's Intervention"), owner: P1, zone: "hand" },
        { key: "c", def: c, owner: P1, zone: "play" },
        ...bank("elitism", 4, P1)
      ]
    });
    play(engine, P1, id("zi"), { selected: { c: [id("c")] } });
    assert.equal(engine.getStat(id("c"), "strength"), (c.strength ?? 0) + 1);
  });
});

describe("Ungodly Mess — Zenobia's Succor", () => {
  test("[R] mode gives a chosen character +2 strength this turn", () => {
    const c = character({ name: "C", strength: 2 });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "zs", def: def("Zenobia's Succor"), owner: P1, zone: "hand" },
        { key: "c", def: c, owner: P1, zone: "play" },
        ...bank("rage", 2, P1)
      ]
    });
    play(engine, P1, id("zs"), { mode: 4, selected: { c: [id("c")] } });
    assert.equal(engine.getStat(id("c"), "strength"), (c.strength ?? 0) + 2);
  });
});

describe("Ungodly Mess — Zenobia's Tower", () => {
  test("when destroyed, may tutor another copy into hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "zt", def: def("Zenobia's Tower"), owner: P1, zone: "play" },
        { key: "zt2", def: def("Zenobia's Tower"), owner: P1, zone: "deck" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        { key: "kill", def: killTactic({ behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("kill"), { selected: { t: [id("zt")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("zt2")] } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("zt2")].zone, "hand");
  });
});

describe("Ungodly Mess — Zenobian Mechanics Explained", () => {
  test("returns a chosen enemy character to its owner's hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "zme", def: def("Zenobian Mechanics Explained"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" },
        ...bank("obsession", 6, P1)
      ]
    });
    play(engine, P1, id("zme"), { selected: { c: [id("oc")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("oc")].zone, "hand");
  });
});

describe("Ungodly Mess — Zigalburgonglgr, the Stolen God", () => {
  test("TURN TO MUSH flips a token-bearing card face down", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "zig", def: def("Zigalburgonglgr, the Stolen God"), owner: P1, zone: "play" },
        { key: "marked", def: character({ name: "Marked" }), owner: P2, zone: "play", counters: { token: 1 } },
        ...bank("rage", 4, P1)
      ]
    });
    activate(engine, P1, id("zig"), "mush", { selected: { c: [id("marked")] } });
    assert.equal(engine.state.cards[id("marked")].faceDown, true);
  });
});
