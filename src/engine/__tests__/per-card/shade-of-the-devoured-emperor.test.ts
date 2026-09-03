// Per-card correctness suite — Shade of the Devoured Emperor (130 cards,
// the Volition / Thabbash era). One describe() per catalog card.
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

const SET = "Shade of the Devoured Emperor";
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
    case "distributeAmong":
      return { kind: "distributeAmong", shares: {} };
    case "chooseNumber":
      return { kind: "chooseNumber", value: (pc.min as number) ?? 0 };
    case "reorderDeck":
      return { kind: "reorderDeck", order: [...((pc.cardIds as string[]) ?? [])] };
    case "orderTriggers":
      return { kind: "orderTriggers", next: ((pc.triggers as unknown[]) ?? [])[0] };
    case "replacementChoice":
      return { kind: "replacementChoice", apply: false };
    case "nameValue":
      return {
        kind: "nameValue",
        value: pc.valueKind === "resourceIcon" ? "rage" : pc.valueKind === "trade" ? "warlord" : "gear"
      };
    case "deployForFree":
      return { kind: "deployForFree" };
    default:
      return { kind: pc.kind };
  }
};

// A synthetic tactic that restores one chosen character (id `r`, decl `t`).
const restoreTactic = (over: Partial<CardDefinition> = {}) =>
  tactic({
    name: "RestoreIt",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "r",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "restore", target: { type: "selected", id: "t" } }]
        }
      ]
    },
    ...over
  });

// =====================================================================
// Obsession block
// =====================================================================

describe("Shade of the Devoured Emperor — Anxious Imp", () => {
  test("OBSESS grants PROVIDES [O][O][O] this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "imp", def: def("Anxious Imp"), owner: P1, zone: "play" }, ...bank("obsession", 4, P1)]
    });
    const before = engine.getThresholds(P1).obsession ?? 0;
    activate(engine, P1, id("imp"), "imp-obsess");
    assert.equal((engine.getThresholds(P1).obsession ?? 0) - before, 3);
  });
});

describe("Shade of the Devoured Emperor — Concentriculation", () => {
  test("puts a non-resource card on top of its owner's deck", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cc", def: def("Concentriculation"), owner: P1, zone: "hand" },
        { key: "v", def: character({ name: "Victim" }), owner: P2, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P2, zone: "deck" },
        ...bank("obsession", 8, P1)
      ]
    });
    play(engine, P1, id("cc"), { selected: { c: [id("v")] } });
    assert.equal(engine.state.players[P2].deck[0], id("v"));
  });

  test("RECUR from the discard pile returns a character to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cc", def: def("Concentriculation"), owner: P1, zone: "discard" },
        { key: "v", def: character({ name: "Victim" }), owner: P2, zone: "play" },
        ...bank("obsession", 8, P1)
      ]
    });
    activate(engine, P1, id("cc"), "concentriculation-recur", { selected: { ch: [id("v")] } });
    assert.equal(engine.state.cards[id("v")].zone, "hand");
    assert.equal(engine.state.cards[id("cc")].zone, "removed");
  });
});

describe("Shade of the Devoured Emperor — Contiguous Defalcating Machine", () => {
  test("an entering character's controller may choose to lose 3 influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cdm", def: def("Contiguous Defalcating Machine"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C", cost: 1 }), owner: P1, zone: "hand" },
        ...bank("obsession", 8, P1)
      ]
    });
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("c"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 2 } : declineAll(pc)
    );
    assert.equal(engine.state.players[P1].influence, inf - 3);
  });
});

describe("Shade of the Devoured Emperor — Elementary Elemental", () => {
  test("on death: returns to hand, then discard a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ee", def: def("Elementary Elemental"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        { key: "spare", def: character({ name: "Spare" }), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("kill"), { selected: { t: [id("ee")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("spare")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("ee")].zone, "hand");
    assert.equal(engine.state.cards[id("spare")].zone, "discard");
  });
});

describe("Shade of the Devoured Emperor — Expedition Endeavour", () => {
  test("mode 3 grants a character COVERT this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ee", def: def("Expedition Endeavour"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" },
        ...bank("obsession", 6, P1)
      ]
    });
    play(engine, P1, id("ee"), { mode: 2, selected: { ch: [id("c")] } });
    drain(engine, declineAll);
    assert.ok(engine.getKeywords(id("c")).includes("covert"));
  });
});

describe("Shade of the Devoured Emperor — Forgotten Tentacle", () => {
  test("may destroy a chosen face-down resource an opponent controls", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "ft", def: def("Forgotten Tentacle"), owner: P1, zone: "hand" },
        ...volition(2, P2),
        ...bank("obsession", 6, P1)
      ]
    });
    const fdRes = engine.state.players[P2].play.find(c => engine.state.cards[c].faceDown)!;
    play(engine, P1, id("ft"), { selected: { fd: [fdRes] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 1 } : declineAll(pc)
    );
    assert.notEqual(engine.state.cards[fdRes].zone, "play");
  });
});

describe("Shade of the Devoured Emperor — Gloamspike-Gosche Bridge", () => {
  test("cannot be picked; grants TACTICAL to characters in your hand", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "ggb", def: def("Gloamspike-Gosche Bridge"), owner: P1, zone: "play" },
        { key: "hc", def: character({ name: "HandChar" }), owner: P1, zone: "hand" }
      ]
    });
    assert.ok(engine.getRestrictions(id("ggb")).includes("cannotBePicked"));
    assert.ok(engine.getKeywords(id("hc")).includes("tactical"));
  });
});

describe("Shade of the Devoured Emperor — Lugubrian Poacher", () => {
  test("gains COVERT for the turn when it is restored", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "lp", def: def("Lugubrian Poacher"), owner: P1, zone: "play", depleted: true },
        { key: "r", def: restoreTactic(), owner: P1, zone: "hand" },
        ...bank("rage", 4, P1)
      ]
    });
    play(engine, P1, id("r"), { selected: { t: [id("lp")] } });
    assert.equal(engine.state.cards[id("lp")].depleted, false);
    assert.ok(engine.getKeywords(id("lp")).includes("covert"));
  });
});

describe("Shade of the Devoured Emperor — Man Shark", () => {
  test("strength/life scale with the opponent's face-down resources", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "ms", def: def("Man Shark"), owner: P1, zone: "play" }, ...volition(2, P2)]
    });
    assert.equal(engine.getStat(id("ms"), "strength"), 2);
    assert.equal(engine.getStat(id("ms"), "life"), 2);
  });
});

describe("Shade of the Devoured Emperor — Mittens of Muffled Thought", () => {
  test("the attached character cannot attack", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: drawerChar({ name: "Host" }), owner: P1, zone: "play" },
        { key: "m", def: def("Mittens of Muffled Thought"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.ok(engine.getRestrictions(id("host")).includes("cannotAttack"));
  });
});

describe("Shade of the Devoured Emperor — Monstrous Lassitude", () => {
  test("skips its controller's next RESTORE RULE", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "ml", def: def("Monstrous Lassitude"), owner: P1, zone: "hand" },
        { key: "tired", def: character({ name: "Tired" }), owner: P1, zone: "play", depleted: true },
        ...bank("obsession", 8, P1)
      ]
    });
    play(engine, P1, id("ml"), {});
    drain(engine, declineAll);
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    // RESTORE RULE skipped this turn -> the depleted character is still depleted
    assert.equal(engine.state.cards[id("tired")].depleted, true);
  });
});

describe("Shade of the Devoured Emperor — Neuralyzer Agent", () => {
  test("when it attacks, an opponent discards a card", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "na", def: def("Neuralyzer Agent"), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OppCard" }), owner: P2, zone: "hand" }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("na")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("oc")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("oc")].zone, "discard");
  });
});

describe("Shade of the Devoured Emperor — Officially Offensive Overseer", () => {
  test("ETB: bounces a picked small character while you control [O][O][O]", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ooo", def: def("Officially Offensive Overseer"), owner: P1, zone: "hand" },
        { key: "small", def: character({ name: "Small", strength: 2, life: 4 }), owner: P2, zone: "play" },
        ...bank("obsession", 6, P1)
      ]
    });
    play(engine, P1, id("ooo"), { selected: { p: [id("small")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("small")].zone, "hand");
  });
});

describe("Shade of the Devoured Emperor — Ping Konk", () => {
  test("deploys as a plain vanilla character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "pk", def: def("Ping Konk"), owner: P1, zone: "hand" }, ...bank("obsession", 10, P1)]
    });
    play(engine, P1, id("pk"), {});
    assert.equal(engine.state.cards[id("pk")].zone, "play");
  });
});

describe("Shade of the Devoured Emperor — Quotidian Concealer", () => {
  test("enters with a token; OBSCURE spends it to grant a character COVERT", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "qc", def: def("Quotidian Concealer"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" },
        ...bank("obsession", 6, P1)
      ]
    });
    play(engine, P1, id("qc"), {});
    assert.equal(engine.state.cards[id("qc")].counters.token, 1);
    activate(engine, P1, id("qc"), "quotidian-concealer-obscure", { selected: { ch: [id("c")] } });
    assert.ok(engine.getKeywords(id("c")).includes("covert"));
    assert.equal(engine.state.cards[id("qc")].counters.token ?? 0, 0);
  });
});

describe("Shade of the Devoured Emperor — Quotidian Transposition", () => {
  test("each player returns a character they own to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "qt", def: def("Quotidian Transposition"), owner: P1, zone: "hand" },
        { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
        { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "play" },
        ...bank("obsession", 6, P1)
      ]
    });
    play(engine, P1, id("qt"), {});
    drain(engine, pc => {
      if (pc.kind !== "chooserSelectsTarget") return declineAll(pc);
      return {
        kind: "chooserSelectsTarget",
        selected: [pc.playerId === P1 ? id("mine") : id("theirs")]
      };
    });
    assert.equal(engine.state.cards[id("mine")].zone, "hand");
    assert.equal(engine.state.cards[id("theirs")].zone, "hand");
  });
});

describe("Shade of the Devoured Emperor — Study Disturbance", () => {
  test("when the picked player declines to pay, you draw and they cannot play characters this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sd", def: def("Study Disturbance"), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        { key: "oppChar", def: character({ name: "OppChar", cost: 1 }), owner: P2, zone: "hand" },
        ...bank("obsession", 6, P1),
        ...bank("rage", 6, P2)
      ]
    });
    const facP2 = engine.state.players[P2].factionId!;
    const handBefore = engine.state.players[P1].hand.length;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("sd"), selected: { p: [facP2] } } as never);
    resolvePendingResponses(engine);
    drain(engine, pc => (pc.kind === "mayPay" ? { kind: "mayPay", pay: false } : declineAll(pc)));
    // -1 for Study Disturbance, +1 for the draw
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1);
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P2, cardId: id("oppChar"), selected: {} } as never)
    );
  });
});

describe("Shade of the Devoured Emperor — Tedious TriAdic Truculence", () => {
  test("destroys the 3 picked characters of strength <= 3 when the opponent declines to pay", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ttt", def: def("Tedious TriAdic Truculence"), owner: P1, zone: "hand" },
        { key: "a", def: character({ name: "A", strength: 2 }), owner: P2, zone: "play" },
        { key: "b", def: character({ name: "B", strength: 2 }), owner: P2, zone: "play" },
        { key: "c", def: character({ name: "C", strength: 2 }), owner: P2, zone: "play" },
        ...bank("obsession", 8, P1)
      ]
    });
    play(engine, P1, id("ttt"), { selected: { picks: [id("a"), id("b"), id("c")] } });
    drain(engine, pc => (pc.kind === "mayPay" ? { kind: "mayPay", pay: false } : declineAll(pc)));
    assert.equal(engine.state.cards[id("a")].zone, "discard");
    assert.equal(engine.state.cards[id("b")].zone, "discard");
    assert.equal(engine.state.cards[id("c")].zone, "discard");
  });
});

describe("Shade of the Devoured Emperor — Thabbashite Chemist", () => {
  test("DELINIATE gives your face-down resources PROVIDES of the named icon this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "tc", def: def("Thabbashite Chemist"), owner: P1, zone: "play" },
        ...volition(3, P1),
        ...bank("rage", 6, P1)
      ]
    });
    const before = engine.getThresholds(P1).greed ?? 0;
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("tc"), abilityId: "tc-deliniate", selected: {}, variables: {} });
    resolvePendingResponses(engine);
    drain(engine, pc =>
      pc.kind === "nameValue" ? { kind: "nameValue", value: "greed" } : declineAll(pc)
    );
    assert.ok((engine.getThresholds(P1).greed ?? 0) > before);
  });
});

describe("Shade of the Devoured Emperor — The Lugubrian Council of Quotidian Affairs", () => {
  test("CONVENE discards 2 cards for 2 tokens", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "lc", def: def("The Lugubrian Council of Quotidian Affairs"), owner: P1, zone: "play" },
        { key: "h1", def: character({ name: "H1" }), owner: P1, zone: "hand" },
        { key: "h2", def: character({ name: "H2" }), owner: P1, zone: "hand" },
        ...bank("obsession", 8, P1)
      ]
    });
    activate(engine, P1, id("lc"), "council-convene", { selected: { convene: [id("h1"), id("h2")] } });
    assert.equal(engine.state.cards[id("lc")].counters.token, 2);
    assert.equal(engine.state.cards[id("h1")].zone, "discard");
    assert.equal(engine.state.cards[id("h2")].zone, "discard");
  });
});

describe("Shade of the Devoured Emperor — This, That, and the Other Thing", () => {
  test("of 3 picked discard tactics: one deck-shuffled, one face-down in play, one to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "tt", def: def("This, That, and the Other Thing"), owner: P1, zone: "hand" },
        { key: "t1", def: tactic({ name: "T1" }), owner: P1, zone: "discard" },
        { key: "t2", def: tactic({ name: "T2" }), owner: P1, zone: "discard" },
        { key: "t3", def: tactic({ name: "T3" }), owner: P1, zone: "discard" },
        ...bank("obsession", 8, P1)
      ]
    });
    play(engine, P1, id("tt"), { selected: { three: [id("t1"), id("t2"), id("t3")] } });
    let step = 0;
    drain(engine, pc => {
      if (pc.kind !== "chooserSelectsTarget") return declineAll(pc);
      step += 1;
      return { kind: "chooserSelectsTarget", selected: [step === 1 ? id("t1") : id("t2")] };
    });
    assert.equal(engine.state.cards[id("t2")].zone, "play");
    assert.equal(engine.state.cards[id("t2")].faceDown, true);
    assert.equal(engine.state.cards[id("t3")].zone, "hand");
  });
});

describe("Shade of the Devoured Emperor — Underwhelming Performance", () => {
  test("the picked character loses 6 strength this turn and you draw", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "up", def: def("Underwhelming Performance"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", strength: 8, life: 8 }), owner: P2, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("obsession", 8, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("up"), { selected: { ch: [id("c")] } });
    drain(engine, declineAll);
    assert.equal(engine.getStat(id("c"), "strength"), 2);
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1);
  });
});

describe("Shade of the Devoured Emperor — Undevoted Gargantuan", () => {
  test("is COVERT and enters play", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "ug", def: def("Undevoted Gargantuan"), owner: P1, zone: "hand" }, ...bank("obsession", 10, P1)]
    });
    play(engine, P1, id("ug"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("ug")].zone, "play");
    assert.ok(engine.getKeywords(id("ug")).includes("covert"));
  });
});

describe("Shade of the Devoured Emperor — Violating Ritual", () => {
  test("an opponent discards 2 cards and you draw 1", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "vr", def: def("Violating Ritual"), owner: P1, zone: "hand" },
        { key: "o1", def: character({ name: "O1" }), owner: P2, zone: "hand" },
        { key: "o2", def: character({ name: "O2" }), owner: P2, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("obsession", 8, P1)
      ]
    });
    const p2Before = engine.state.players[P2].hand.length;
    play(engine, P1, id("vr"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [engine.state.players[P2].hand[0]] }
        : declineAll(pc)
    );
    assert.equal(engine.state.players[P2].hand.length, p2Before - 2);
  });
});

describe("Shade of the Devoured Emperor — Voidal Trinket", () => {
  test("AUGUR depletes it and can tuck a looked-at card onto your deck", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "vt", def: def("Voidal Trinket"), owner: P1, zone: "play" },
        ...Array.from({ length: 6 }, (_, i) => ({ key: `dk${i}`, def: character({ name: `Dk${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("obsession", 6, P1)
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("vt"), abilityId: "voidal-trinket-augur", selected: { keep: [id("dk1")] }, variables: { x: 2 } });
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("vt")].depleted, true);
    assert.equal(engine.state.players[P1].deck[0], id("dk1"));
  });
});

describe("Shade of the Devoured Emperor — Ancient and Disreputable Law Office", () => {
  test("characters of numeric cost 2 or less cannot attack", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "law", def: def("Ancient and Disreputable Law Office"), owner: P1, zone: "play" },
        { key: "cheap", def: character({ name: "Cheap", cost: 2 }), owner: P1, zone: "play" },
        { key: "pricey", def: character({ name: "Pricey", cost: 3 }), owner: P1, zone: "play" }
      ]
    });
    assert.ok(engine.getRestrictions(id("cheap")).includes("cannotAttack"));
    assert.equal(engine.getRestrictions(id("pricey")).includes("cannotAttack"), false);
  });
});

// =====================================================================
// Greed block
// =====================================================================

describe("Shade of the Devoured Emperor — Arcane Escrow", () => {
  test("a card you control heading to the discard pile can be sent to the void instead", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ae", def: def("Arcane Escrow"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        ...bank("greed", 6, P1)
      ]
    });
    play(engine, P1, id("kill"), { selected: { t: [id("c")] } });
    drain(engine, pc =>
      pc.kind === "replacementChoice" ? { kind: "replacementChoice", apply: true } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("c")].zone, "void");
  });
});

describe("Shade of the Devoured Emperor — Audacious Appraisal", () => {
  test("destroy branch: the character dies and you lose 2X influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "aa", def: def("Audacious Appraisal"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P2, zone: "play" },
        ...bank("greed", 8, P1)
      ]
    });
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("aa"), { selected: { ch: [id("c")] } });
    drain(engine, pc => {
      if (pc.kind === "chooseNumber") return { kind: "chooseNumber", value: 3 };
      if (pc.kind === "chooserSelectsOption") return { kind: "chooserSelectsOption", index: 1 };
      return declineAll(pc);
    });
    assert.equal(engine.state.cards[id("c")].zone, "discard");
    assert.equal(engine.state.players[P1].influence, inf - 6);
  });
});

describe("Shade of the Devoured Emperor — Auspicious Arrival", () => {
  test("digs a strength-1-or-less character from the top 8 into your hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "aa", def: def("Auspicious Arrival"), owner: P1, zone: "hand" },
        { key: "weak", def: character({ name: "Weak", strength: 1 }), owner: P1, zone: "deck" },
        ...Array.from({ length: 5 }, (_, i) => ({ key: `f${i}`, def: character({ name: `F${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("greed", 8, P1)
      ]
    });
    play(engine, P1, id("aa"), { selected: { pick: [id("weak")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("weak")].zone, "hand");
  });
});

describe("Shade of the Devoured Emperor — Contractual Execution", () => {
  test("the picked character is flipped face-down and its controller returns a resource to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ce", def: def("Contractual Execution"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P2, zone: "play" },
        ...bank("greed", 8, P1),
        ...bank("rage", 4, P2)
      ]
    });
    play(engine, P1, id("ce"), { selected: { ch: [id("c")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [engine.state.players[P2].play.find(x => engine.getDefinition(x).type === "resource")!] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("c")].faceDown, true);
  });
});

describe("Shade of the Devoured Emperor — Enlightened Mau", () => {
  test("takes no damage from an attacker that has an item attached", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "mau", def: def("Enlightened Mau"), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 4, life: 4, speed: 3 }), owner: P2, zone: "play" },
        { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play", attachedToKey: "atk" }
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("mau")] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("mau")].damage ?? 0, 0);
  });
});

describe("Shade of the Devoured Emperor — Eustace Padamose-Gristwalter", () => {
  test("FUTURE IMPLICATIONS: pay 2 + lose 1 influence to draw a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "eu", def: def("Eustace Padamose-Gristwalter"), owner: P1, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("greed", 6, P1)
      ]
    });
    const inf = engine.state.players[P1].influence;
    const handBefore = engine.state.players[P1].hand.length;
    activate(engine, P1, id("eu"), "eu-future");
    assert.equal(engine.state.players[P1].hand.length, handBefore + 1);
    assert.equal(engine.state.players[P1].influence, inf - 1);
  });
});

describe("Shade of the Devoured Emperor — Golden Charm", () => {
  test("SERAPHIM FUSION requires a UNIQUE EUSTACE character you control", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "gc", def: def("Golden Charm"), owner: P1, zone: "play" }, ...bank("greed", 8, P1)]
    });
    assert.throws(() =>
      engine.perform({ type: "activateAbility", playerId: P1, cardId: id("gc"), abilityId: "gc-fusion", selected: {}, variables: {} })
    );
  });
});

describe("Shade of the Devoured Emperor — Goldmau Sacks Representative", () => {
  test("RAISE CAPITAL grants PROVIDES [G][G][G] this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "gsr", def: def("Goldmau Sacks Representative"), owner: P1, zone: "play" },
        { key: "spare", def: character({ name: "Spare" }), owner: P1, zone: "hand" },
        ...bank("greed", 6, P1)
      ]
    });
    const before = engine.getThresholds(P1).greed ?? 0;
    activate(engine, P1, id("gsr"), "gsr-raise", { selected: { d: [id("spare")] } });
    assert.equal((engine.getThresholds(P1).greed ?? 0) - before, 3);
  });
});

describe("Shade of the Devoured Emperor — Hassan-i of Thabbash", () => {
  test("on death, each opponent must destroy a character they control", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "hi", def: def("Hassan-i of Thabbash"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        { key: "o1", def: character({ name: "O1" }), owner: P2, zone: "play" },
        { key: "o2", def: character({ name: "O2" }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("kill"), { selected: { t: [id("hi")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("o1")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("o1")].zone, "discard");
  });
});

describe("Shade of the Devoured Emperor — Homewrecker", () => {
  test("locations you control gain 1 structure", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "hw", def: def("Homewrecker"), owner: P1, zone: "play" },
        { key: "loc", def: location({ name: "Loc", structure: 3 }), owner: P1, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("loc"), "structure"), 4);
  });
});

describe("Shade of the Devoured Emperor — Impressionistic Furball", () => {
  test("the attached character gains 2 life", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host", life: 3 }), owner: P1, zone: "play" },
        { key: "if", def: def("Impressionistic Furball"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.equal(engine.getStat(id("host"), "life"), 5);
  });
});

describe("Shade of the Devoured Emperor — Mau Strategist", () => {
  test("ETB may tutor a staple resource to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ms", def: def("Mau Strategist"), owner: P1, zone: "hand" },
        { key: "res", def: cardDef("Seed 3", "Greed"), owner: P1, zone: "deck" },
        ...bank("greed", 6, P1)
      ]
    });
    play(engine, P1, id("ms"), {});
    drain(engine, pc =>
      pc.kind === "selectTargets"
        ? { kind: "selectTargets", selected: { res: [id("res")] } }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("res")].zone, "hand");
  });
});

describe("Shade of the Devoured Emperor — Mr. Fetch", () => {
  test("ETB may exile a discard card and draw", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mf", def: def("Mr. Fetch"), owner: P1, zone: "hand" },
        { key: "grave", def: character({ name: "Grave" }), owner: P1, zone: "discard" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("greed", 6, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("mf"), {});
    drain(engine, pc =>
      pc.kind === "selectTargets"
        ? { kind: "selectTargets", selected: { exile: [id("grave")] } }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("grave")].zone, "removed");
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1);
  });
});

describe("Shade of the Devoured Emperor — Mushroom Merchant", () => {
  test("ETB may give a character +2 life this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mm", def: def("Mushroom Merchant"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", life: 3 }), owner: P1, zone: "play" },
        ...bank("greed", 8, P1)
      ]
    });
    play(engine, P1, id("mm"), {});
    drain(engine, pc =>
      pc.kind === "selectTargets"
        ? { kind: "selectTargets", selected: { pick: [id("c")] } }
        : declineAll(pc)
    );
    assert.equal(engine.getStat(id("c"), "life"), 5);
  });
});

describe("Shade of the Devoured Emperor — Negotiation Ceremonies", () => {
  test("each player draws cards equal to what they paid in the alternating loop", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "nc", def: def("Negotiation Ceremonies"), owner: P1, zone: "hand" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("greed", 6, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("nc"), {});
    let paid = 0;
    drain(engine, pc => {
      if (pc.kind === "alternatingPay") {
        const pay = pc.playerId === P1 && paid < 1;
        if (pay) paid += 1;
        return { kind: "alternatingPay", pay };
      }
      return declineAll(pc);
    });
    // -1 Negotiation Ceremonies, +1 for the 1 P1 paid
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1);
  });
});

describe("Shade of the Devoured Emperor — Pinguid Bodyguard", () => {
  test("PROTECT depletes it to give a character +2 life; it can attack only once per turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pb", def: def("Pinguid Bodyguard"), owner: P1, zone: "play" },
        { key: "ally", def: character({ name: "Ally", life: 3 }), owner: P1, zone: "play" },
        ...bank("greed", 6, P1)
      ]
    });
    activate(engine, P1, id("pb"), "pb-protect", { selected: { c: [id("ally")] } });
    assert.equal(engine.getStat(id("ally"), "life"), 5);
    assert.ok(engine.getRestrictions(id("pb")).includes("attackOncePerTurn"));
  });
});

describe("Shade of the Devoured Emperor — Purloinering Pirate", () => {
  test("PUSH OVERBOARD sacrifices a character you own for a token (+1/+1)", () => {
    const d = def("Purloinering Pirate");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pp", def: d, owner: P1, zone: "play" },
        { key: "sac", def: character({ name: "Sac" }), owner: P1, zone: "play" },
        ...bank("greed", 6, P1)
      ]
    });
    activate(engine, P1, id("pp"), "purloinering-pirate-push-overboard", { selected: { v: [id("sac")] } });
    assert.equal(engine.state.cards[id("sac")].zone, "discard");
    assert.equal(engine.state.cards[id("pp")].counters.token, 1);
    assert.equal(engine.getStat(id("pp"), "strength"), (d.strength ?? 0) + 1);
  });
});

describe("Shade of the Devoured Emperor — Recycling Scheme Facility", () => {
  test("ETB may draw a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rsf", def: def("Recycling Scheme Facility"), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("greed", 8, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("rsf"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 1 } : declineAll(pc)
    );
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1);
  });
});

describe("Shade of the Devoured Emperor — Siluriformes Flaxenscale", () => {
  test("aura: UNIQUE EUSTACE characters gain +3/+3", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "sf", def: def("Siluriformes Flaxenscale"), owner: P1, zone: "play" },
        { key: "eu", def: character({ name: "Eu", strength: 1, life: 3, unique: "eustace" }), owner: P1, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("eu"), "strength"), 4);
    assert.equal(engine.getStat(id("eu"), "life"), 6);
  });
});

describe("Shade of the Devoured Emperor — Swindle", () => {
  test("each opponent attaches a face-down resource to their faction; you draw and discard", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sw", def: def("Swindle"), owner: P1, zone: "hand" },
        { key: "spare", def: character({ name: "Spare" }), owner: P1, zone: "hand" },
        ...volition(1, P2),
        ...bank("greed", 6, P1)
      ]
    });
    const fdRes = engine.state.players[P2].play.find(c => engine.state.cards[c].faceDown)!;
    play(engine, P1, id("sw"), {});
    drain(engine, pc => {
      if (pc.kind === "chooserSelectsTarget") {
        return { kind: "chooserSelectsTarget", selected: pc.playerId === P2 ? [fdRes] : [id("spare")] };
      }
      return declineAll(pc);
    });
    assert.equal(engine.state.cards[fdRes].attachedTo, engine.state.players[P2].factionId);
  });
});

describe("Shade of the Devoured Emperor — Thabbashite Financier", () => {
  test("BLOOD GOLD: lose 1 influence to play a card face-down as a resource", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "tf", def: def("Thabbashite Financier"), owner: P1, zone: "play" },
        { key: "stash", def: character({ name: "Stash" }), owner: P1, zone: "hand" },
        ...volition(2, P1),
        ...bank("rage", 6, P1)
      ]
    });
    const inf = engine.state.players[P1].influence;
    activate(engine, P1, id("tf"), "tf-bloodgold");
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("stash")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.players[P1].influence, inf - 1);
    assert.equal(engine.state.cards[id("stash")].zone, "play");
    assert.equal(engine.state.cards[id("stash")].faceDown, true);
  });
});

describe("Shade of the Devoured Emperor — Timid Mau", () => {
  test("loses 1 speed this turn when blocked by a party of 2 or more", () => {
    const d = def("Timid Mau");
    const { engine, id } = buildGame({
      cards: [
        { key: "tm", def: d, owner: P1, zone: "play" },
        { key: "b1", def: character({ name: "B1", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
        { key: "b2", def: character({ name: "B2", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("tm")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b1"), id("b2")] });
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("tm"), "speed"), (d.speed ?? 0) - 1);
  });
});

describe("Shade of the Devoured Emperor — Underhanded Hang-Out", () => {
  test("DIRTY DEALS: pay 2 and damage a location you own to draw a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "uho", def: def("Underhanded Hang-Out"), owner: P1, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("greed", 6, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    activate(engine, P1, id("uho"), "underhanded-hangout-dirty-deals", { selected: { loc: [id("uho")] } });
    assert.equal(engine.state.players[P1].hand.length, handBefore + 1);
    assert.equal(engine.state.cards[id("uho")].damage, 1);
  });
});

describe("Shade of the Devoured Emperor — Unexpected Codicil", () => {
  test("discard a card and draw X (paying X-2)", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "uc", def: def("Unexpected Codicil"), owner: P1, zone: "hand" },
        { key: "spare", def: character({ name: "Spare" }), owner: P1, zone: "hand" },
        ...Array.from({ length: 5 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
        ...bank("greed", 8, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("uc"), { variables: { x: 3 }, selected: { disc: [id("spare")] } });
    drain(engine, declineAll);
    // -1 codicil, -1 discard, +3 draw
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 - 1 + 3);
  });
});

// =====================================================================
// Elitism block
// =====================================================================

describe("Shade of the Devoured Emperor — 5n4p", () => {
  test("makes a Micromajig token when it restores", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "s", def: def("5n4p"), owner: P1, zone: "play", depleted: true },
        { key: "r", def: restoreTactic(), owner: P1, zone: "hand" },
        ...bank("rage", 4, P1)
      ]
    });
    play(engine, P1, id("r"), { selected: { t: [id("s")] } });
    const majigs = engine.state.players[P1].play.filter(c => engine.getDefinition(c).name === "Micromajig");
    assert.equal(majigs.length, 1);
  });
});

describe("Shade of the Devoured Emperor — Abandoned Testing Complex", () => {
  test("at start of your turn, may pay 3 to play a resource", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "atc", def: def("Abandoned Testing Complex"), owner: P1, zone: "play" },
        { key: "res", def: cardDef("Seed 3", "Elitism"), owner: P1, zone: "hand" },
        ...bank("elitism", 8, P1)
      ],
      activePlayerId: P2
    });
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    drain(engine, pc => {
      if (pc.kind === "mayPay") return { kind: "mayPay", pay: true };
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [id("res")] };
      return declineAll(pc);
    });
    assert.equal(engine.state.cards[id("res")].zone, "play");
  });
});

describe("Shade of the Devoured Emperor — Accumulation Majig", () => {
  test("FEED removes a token; end of turn accrues one", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "am", def: def("Accumulation Majig"), owner: P1, zone: "play", counters: { token: 2 } },
        ...bank("elitism", 6, P1)
      ]
    });
    activate(engine, P1, id("am"), "accumulation-majig-feed");
    assert.equal(engine.state.cards[id("am")].counters.token, 1);
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("am")].counters.token, 2);
  });
});

describe("Shade of the Devoured Emperor — Clockman Junk Picker", () => {
  test("ETB may tutor an item into play face-down", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cjp", def: def("Clockman Junk Picker"), owner: P1, zone: "hand" },
        { key: "it", def: item({ name: "DeepItem" }), owner: P1, zone: "deck" },
        ...bank("elitism", 6, P1)
      ]
    });
    play(engine, P1, id("cjp"), {});
    drain(engine, pc =>
      pc.kind === "selectTargets"
        ? { kind: "selectTargets", selected: { found: [id("it")] } }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("it")].zone, "play");
    assert.equal(engine.state.cards[id("it")].faceDown, true);
  });
});

describe("Shade of the Devoured Emperor — Draconic Luteoderm Suit", () => {
  test("the attached character gains +2/+2", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host", strength: 2, life: 2 }), owner: P1, zone: "play" },
        { key: "suit", def: def("Draconic Luteoderm Suit"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), 4);
    assert.equal(engine.getStat(id("host"), "life"), 4);
  });
});

describe("Shade of the Devoured Emperor — Elitistmajig", () => {
  test("CRUNCH destroys a Micromajig you control for PROVIDES [E][E][E] this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "em", def: def("Elitistmajig"), owner: P1, zone: "play" },
        { key: "majig", def: character({ name: "Micromajig", subtype: ["micromajig"] }), owner: P1, zone: "play" },
        ...bank("elitism", 4, P1)
      ]
    });
    const before = engine.getThresholds(P1).elitism ?? 0;
    activate(engine, P1, id("em"), "em-crunch", { selected: { tok: [id("majig")] } });
    assert.equal(engine.state.cards[id("majig")].zone, "discard");
    assert.equal((engine.getThresholds(P1).elitism ?? 0) - before, 3);
  });
});

describe("Shade of the Devoured Emperor — EPM (Extra Powerful Magnetic) Pulse", () => {
  test("destroys every item and location", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "epm", def: def("EPM (Extra Powerful Magnetic) Pulse"), owner: P1, zone: "hand" },
        { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
        { key: "theirLoc", def: location({ name: "TheirLoc" }), owner: P2, zone: "play" },
        ...bank("elitism", 8, P1)
      ]
    });
    play(engine, P1, id("epm"), {});
    assert.equal(engine.state.cards[id("myItem")].zone, "discard");
    assert.equal(engine.state.cards[id("theirLoc")].zone, "discard");
  });
});

describe("Shade of the Devoured Emperor — Frickin' Sweet Pogo-Bunny", () => {
  test("RAAR! turns it into a 2/2/3 character this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "pb", def: def("Frickin' Sweet Pogo-Bunny"), owner: P1, zone: "play" }, ...bank("elitism", 4, P1)]
    });
    activate(engine, P1, id("pb"), "pogo-raar");
    assert.ok(engine.getCardTypes(id("pb")).includes("character"));
    assert.equal(engine.getStat(id("pb"), "strength"), 2);
  });
});

describe("Shade of the Devoured Emperor — Fallen Quarter-Finalist", () => {
  test("deploys as a plain vanilla character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "fqf", def: def("Fallen Quarter-Finalist"), owner: P1, zone: "hand" }, ...bank("greed", 10, P1)]
    });
    play(engine, P1, id("fqf"), {});
    assert.equal(engine.state.cards[id("fqf")].zone, "play");
  });
});

describe("Shade of the Devoured Emperor — Gigantitect's Giant Giant", () => {
  test("cannot be picked and cannot be taken control of", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "ggg", def: def("Gigantitect's Giant Giant"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getRestrictions(id("ggg")).includes("cannotBePicked"));
    assert.ok(engine.getRestrictions(id("ggg")).includes("cannotBeTakenControl"));
  });
});

describe("Shade of the Devoured Emperor — Industrious Usage", () => {
  test("destroys a chosen item and makes a Micromajig token", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "iu", def: def("Industrious Usage"), owner: P1, zone: "hand" },
        { key: "it", def: item({ name: "Doomed" }), owner: P2, zone: "play" },
        ...bank("elitism", 8, P1)
      ]
    });
    play(engine, P1, id("iu"), { selected: { it: [id("it")] } });
    assert.equal(engine.state.cards[id("it")].zone, "discard");
    assert.equal(engine.state.players[P1].play.filter(c => engine.getDefinition(c).name === "Micromajig").length, 1);
  });
});

describe("Shade of the Devoured Emperor — It's a Trap!", () => {
  test("returns a picked item you control and a picked character to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "trap", def: def("It's a Trap!"), owner: P1, zone: "hand" },
        { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
        { key: "oppChar", def: character({ name: "OppChar" }), owner: P2, zone: "play" },
        ...bank("elitism", 6, P1)
      ]
    });
    play(engine, P1, id("trap"), { selected: { it: [id("myItem")], ch: [id("oppChar")] } });
    assert.equal(engine.state.cards[id("myItem")].zone, "hand");
    assert.equal(engine.state.cards[id("oppChar")].zone, "hand");
  });
});

describe("Shade of the Devoured Emperor — Jo Ciendeilio, M07h3r 0f 1337", () => {
  test("grants each of your characters a RESEARCH ability (reduce next cost by 1)", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "jo", def: def("Jo Ciendeilio, M07h3r 0f 1337"), owner: P1, zone: "play" },
        { key: "pupil", def: character({ name: "Pupil" }), owner: P1, zone: "play" },
        { key: "big", def: character({ name: "Big", cost: 4 }), owner: P1, zone: "hand" },
        ...bank("elitism", 8, P1)
      ]
    });
    activate(engine, P1, id("pupil"), "jo-research");
    assert.equal(engine.getCardPlayability(P1, id("big")).numericCost, 3);
  });
});

describe("Shade of the Devoured Emperor — M3CHm4n1c 31f", () => {
  test("while it has a token, it gains +2/+2", () => {
    const d = def("M3CHm4n1c 31f");
    const { engine, id } = buildGame({
      cards: [{ key: "m", def: d, owner: P1, zone: "play", counters: { token: 1 } }]
    });
    assert.equal(engine.getStat(id("m"), "strength"), (d.strength ?? 0) + 2);
    assert.equal(engine.getStat(id("m"), "life"), (d.life ?? 0) + 2);
  });

  test("ETB may pay 2 to put a token on up to 2 non-resource cards", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "m", def: def("M3CHm4n1c 31f"), owner: P1, zone: "hand" },
        { key: "a", def: character({ name: "A" }), owner: P1, zone: "play" },
        { key: "b", def: character({ name: "B" }), owner: P1, zone: "play" },
        ...bank("elitism", 8, P1)
      ]
    });
    play(engine, P1, id("m"), {});
    drain(engine, pc => {
      if (pc.kind === "mayPay") return { kind: "mayPay", pay: true };
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [id("a"), id("b")] };
      return declineAll(pc);
    });
    assert.equal(engine.state.cards[id("a")].counters.token, 1);
    assert.equal(engine.state.cards[id("b")].counters.token, 1);
  });
});

describe("Shade of the Devoured Emperor — Micromajig Recycling Station", () => {
  test("at start of your turn, destroy X Micromajigs to discount your next cost", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "mrs", def: def("Micromajig Recycling Station"), owner: P1, zone: "play" },
        { key: "m1", def: character({ name: "Micromajig", subtype: ["micromajig"] }), owner: P1, zone: "play" },
        { key: "m2", def: character({ name: "Micromajig", subtype: ["micromajig"] }), owner: P1, zone: "play" }
      ],
      activePlayerId: P2
    });
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    drain(engine, pc => {
      if (pc.kind === "chooseNumber") return { kind: "chooseNumber", value: 2 };
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [id("m1"), id("m2")] };
      return declineAll(pc);
    });
    assert.equal(engine.state.cards[id("m1")].zone, "discard");
    assert.equal(engine.state.cards[id("m2")].zone, "discard");
  });
});

describe("Shade of the Devoured Emperor — Micromajigmakermachinemajig", () => {
  test("RELEASE THE MAJIGS! puts a Micromajig token into play under your control", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "mmm", def: def("Micromajigmakermachinemajig"), owner: P1, zone: "play" }, ...bank("elitism", 4, P1)]
    });
    activate(engine, P1, id("mmm"), "mmm-release");
    drain(engine, declineAll);
    assert.equal(engine.state.players[P1].play.filter(c => engine.getDefinition(c).name === "Micromajig").length, 1);
  });
});

describe("Shade of the Devoured Emperor — Pwny Bomb", () => {
  test("the attached character gains +1/+1", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host", strength: 2, life: 2, subtype: ["micromajig"] }), owner: P1, zone: "play" },
        { key: "pb", def: def("Pwny Bomb"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), 3);
    assert.equal(engine.getStat(id("host"), "life"), 3);
  });
});

describe("Shade of the Devoured Emperor — R3p347 0ff3nd3r", () => {
  test("has AGGRO; gains +1/+1 while it has a token", () => {
    const d = def("R3p347 0ff3nd3r");
    const { engine, id } = buildGame({
      cards: [{ key: "ro", def: d, owner: P1, zone: "play", counters: { token: 1 } }]
    });
    assert.ok(engine.getKeywords(id("ro")).includes("aggro"));
    assert.equal(engine.getStat(id("ro"), "strength"), (d.strength ?? 0) + 1);
  });
});

describe("Shade of the Devoured Emperor — Reluctant Reconciliation", () => {
  test("restores a character and stops it attacking this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rr", def: def("Reluctant Reconciliation"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play", depleted: true },
        ...bank("elitism", 4, P1)
      ]
    });
    play(engine, P1, id("rr"), { selected: { ch: [id("c")] } });
    assert.equal(engine.state.cards[id("c")].depleted, false);
    assert.ok(engine.getRestrictions(id("c")).includes("cannotAttack"));
  });
});

describe("Shade of the Devoured Emperor — Rocket Lawnchair", () => {
  test("NO EJECT! sacrifices itself to destroy one of your characters and one of the opponent's", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rl", def: def("Rocket Lawnchair"), owner: P1, zone: "play" },
        { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
        { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "play" },
        ...bank("elitism", 6, P1)
      ]
    });
    activate(engine, P1, id("rl"), "rocket-lawnchair-no-eject", { selected: { mine: [id("mine")], theirs: [id("theirs")] } });
    assert.equal(engine.state.cards[id("mine")].zone, "discard");
    assert.equal(engine.state.cards[id("theirs")].zone, "discard");
    assert.equal(engine.state.cards[id("rl")].zone, "discard");
  });
});

describe("Shade of the Devoured Emperor — Runic Junker", () => {
  test("at start of your turn, offers a pay-4 option that can be declined", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "rj", def: def("Runic Junker"), owner: P1, zone: "play" },
        ...volition(2, P1)
      ],
      activePlayerId: P2
    });
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("rj")].zone, "play");
  });
});

describe("Shade of the Devoured Emperor — Runic Map", () => {
  test("enters with 2 tokens; PLAN spends one to tutor 'Elitism'", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rm", def: def("Runic Map"), owner: P1, zone: "hand" },
        { key: "elit", def: cardDef("Seed 3", "Elitism"), owner: P1, zone: "deck" },
        ...bank("elitism", 8, P1)
      ]
    });
    play(engine, P1, id("rm"), {});
    assert.equal(engine.state.cards[id("rm")].counters.token, 2);
    activate(engine, P1, id("rm"), "rm-plan", { selected: { e: [id("elit")] } });
    assert.equal(engine.state.cards[id("elit")].zone, "hand");
    assert.equal(engine.state.cards[id("rm")].counters.token, 1);
  });
});

describe("Shade of the Devoured Emperor — Sockem Bot", () => {
  test("PAY OFF reduces this card's outgoing damage by 1 this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "sb", def: def("Sockem Bot"), owner: P1, zone: "play" }, ...bank("elitism", 6, P1)],
      turn: 2
    });
    const inf = engine.state.players[P2].influence;
    activate(engine, P1, id("sb"), "sb-payoff");
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("sb")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    // strength 8, reduced by 1 = 7 influence lost
    assert.equal(engine.state.players[P2].influence, inf - 7);
  });
});

describe("Shade of the Devoured Emperor — Stuttershy", () => {
  test("dodges destruction: flips face-down, opponent gains 1 influence, you make a Micromajig", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "st", def: def("Stuttershy"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P2, zone: "hand" },
        ...bank("rage", 4, P2)
      ],
      activePlayerId: P2
    });
    const inf = engine.state.players[P2].influence;
    play(engine, P2, id("kill"), { selected: { t: [id("st")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("st")].faceDown, true);
    assert.equal(engine.state.players[P2].influence, inf + 1);
  });
});

describe("Shade of the Devoured Emperor — Testudine Autoframe", () => {
  test("aura: characters you control gain AGGRO", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "ta", def: def("Testudine Autoframe"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" }
      ]
    });
    assert.ok(engine.getKeywords(id("c")).includes("aggro"));
  });
});

describe("Shade of the Devoured Emperor — Thabbashite Armorer", () => {
  test("FOR THABBASH gives it +1/+1 this turn", () => {
    const d = def("Thabbashite Armorer");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ta", def: d, owner: P1, zone: "play" },
        ...volition(3, P1),
        ...bank("rage", 6, P1)
      ]
    });
    activate(engine, P1, id("ta"), "ta-forthabbash");
    assert.equal(engine.getStat(id("ta"), "strength"), (d.strength ?? 0) + 1);
    assert.equal(engine.getStat(id("ta"), "life"), (d.life ?? 0) + 1);
  });
});

// =====================================================================
// Deception block
// =====================================================================

describe("Shade of the Devoured Emperor — Backdoor Brigand", () => {
  test("EXIT STAGE RIGHT flips it face-down for 1", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "bb", def: def("Backdoor Brigand"), owner: P1, zone: "play" }, ...bank("deception", 4, P1)]
    });
    activate(engine, P1, id("bb"), "bb-exit");
    assert.equal(engine.state.cards[id("bb")].faceDown, true);
  });
});

describe("Shade of the Devoured Emperor — Banana Peel", () => {
  test("SLIP sacrifices itself to flip an attacking character face-down and draw", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "bp", def: def("Banana Peel"), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 2, life: 5, speed: 3 }), owner: P2, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("deception", 6, P1)
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    engine.perform({ type: "passPriority", playerId: P2 });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("bp"), abilityId: "banana-peel-slip", selected: { atk: [id("atk")] }, variables: {} });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("atk")].faceDown, true);
  });
});

describe("Shade of the Devoured Emperor — Bottlebeard Brandyshanks", () => {
  test("gains 3 speed while the opponent's revealed top card is a character", () => {
    const d = def("Bottlebeard Brandyshanks");
    const { engine, id } = buildGame({
      cards: [
        { key: "bb", def: d, owner: P1, zone: "play" },
        { key: "top", def: character({ name: "Top" }), owner: P2, zone: "deck" }
      ]
    });
    assert.equal(engine.getStat(id("bb"), "speed"), (d.speed ?? 0) + 3);
  });
});

describe("Shade of the Devoured Emperor — Bug Bite", () => {
  test("puts a token on a character and destroys it once tokens reach its numeric cost", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "bb", def: def("Bug Bite"), owner: P1, zone: "hand" },
        { key: "c1", def: character({ name: "C1", cost: 1 }), owner: P2, zone: "play" },
        ...bank("deception", 6, P1)
      ]
    });
    play(engine, P1, id("bb"), { selected: { ch: [id("c1")] } });
    assert.equal(engine.state.cards[id("c1")].zone, "discard");
  });

  test("a pricier character just takes a token", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "bb", def: def("Bug Bite"), owner: P1, zone: "hand" },
        { key: "c3", def: character({ name: "C3", cost: 3 }), owner: P2, zone: "play" },
        ...bank("deception", 6, P1)
      ]
    });
    play(engine, P1, id("bb"), { selected: { ch: [id("c3")] } });
    assert.equal(engine.state.cards[id("c3")].zone, "play");
    assert.equal(engine.state.cards[id("c3")].counters.token, 1);
  });
});

describe("Shade of the Devoured Emperor — Carnival Ringmaster", () => {
  test("ETB may put a token on a chosen character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cr", def: def("Carnival Ringmaster"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" },
        ...bank("deception", 8, P1)
      ]
    });
    play(engine, P1, id("cr"), {});
    drain(engine, pc => {
      if (pc.kind === "chooserSelectsOption") return { kind: "chooserSelectsOption", index: 0 };
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [id("c")] };
      return declineAll(pc);
    });
    assert.equal(engine.state.cards[id("c")].counters.token, 1);
  });
});

describe("Shade of the Devoured Emperor — Cicibeo the Swift", () => {
  test("EXTRA COST: discard a non-resource Rogue card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cb", def: def("Cicibeo the Swift"), owner: P1, zone: "hand" },
        { key: "rogue", def: character({ name: "Rogue", trade: "rogue" }), owner: P1, zone: "hand" },
        ...bank("deception", 8, P1)
      ]
    });
    play(engine, P1, id("cb"), { selected: { toss: [id("rogue")] } });
    assert.equal(engine.state.cards[id("cb")].zone, "play");
    assert.equal(engine.state.cards[id("rogue")].zone, "discard");
  });
});

describe("Shade of the Devoured Emperor — Clockman City Shuffle", () => {
  test("your characters gain +1/+1 and the opponent's lose 1/1 this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ccs", def: def("Clockman City Shuffle"), owner: P1, zone: "hand" },
        { key: "mine", def: character({ name: "Mine", strength: 2, life: 2 }), owner: P1, zone: "play" },
        { key: "theirs", def: character({ name: "Theirs", strength: 3, life: 3 }), owner: P2, zone: "play" },
        ...bank("deception", 8, P1)
      ]
    });
    play(engine, P1, id("ccs"), {});
    assert.equal(engine.getStat(id("mine"), "strength"), 3);
    assert.equal(engine.getStat(id("theirs"), "strength"), 2);
  });
});

describe("Shade of the Devoured Emperor — Drive By Boobing", () => {
  test("removes a character that damaged your faction this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "dbb", def: def("Drive By Boobing"), owner: P1, zone: "hand" },
        { key: "raider", def: character({ name: "Raider" }), owner: P2, zone: "play" },
        ...bank("deception", 8, P1)
      ]
    });
    (engine as unknown as { emit: (e: unknown) => void }).emit({
      type: "damageDealt",
      sourceId: id("raider"),
      targetId: engine.state.players[P1].factionId,
      amount: 2
    });
    play(engine, P1, id("dbb"), { selected: { ch: [id("raider")] } });
    assert.equal(engine.state.cards[id("raider")].zone, "removed");
  });
});

describe("Shade of the Devoured Emperor — Elusive Wolf", () => {
  test("HOWL destroys a 'Deception' you own for a token", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ew", def: def("Elusive Wolf"), owner: P1, zone: "play" },
        { key: "dec", def: cardDef("Seed 3", "Deception"), owner: P1, zone: "play" },
        ...bank("deception", 6, P1)
      ]
    });
    activate(engine, P1, id("ew"), "elusive-wolf-howl", { selected: { dec: [id("dec")] } });
    assert.equal(engine.state.cards[id("dec")].zone, "discard");
    assert.equal(engine.state.cards[id("ew")].counters.token, 1);
  });
});

describe("Shade of the Devoured Emperor — Gang Weapon Dealer", () => {
  test("enters with 2 tokens and gains +1 strength per token", () => {
    const d = def("Gang Weapon Dealer");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "gwd", def: d, owner: P1, zone: "hand" }, ...bank("deception", 8, P1)]
    });
    play(engine, P1, id("gwd"), {});
    assert.equal(engine.state.cards[id("gwd")].counters.token, 2);
    assert.equal(engine.getStat(id("gwd"), "strength"), (d.strength ?? 0) + 2);
  });
});

describe("Shade of the Devoured Emperor — Gassy Gastornis", () => {
  test("has TACTICAL", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "gg", def: def("Gassy Gastornis"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getKeywords(id("gg")).includes("tactical"));
  });
});

describe("Shade of the Devoured Emperor — Guileful Astucion", () => {
  test("mode: +1 speed to the picked character this turn and draw", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ga", def: def("Guileful Astucion"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", speed: 3 }), owner: P1, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("deception", 6, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("ga"), { selected: { ch: [id("c")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 2 } : declineAll(pc)
    );
    assert.equal(engine.getStat(id("c"), "speed"), 4);
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1);
  });
});

describe("Shade of the Devoured Emperor — Martial Arts Wannabe", () => {
  test("cannot be picked while you control more characters than the opponent", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "maw", def: def("Martial Arts Wannabe"), owner: P1, zone: "play" },
        { key: "buddy", def: character({ name: "Buddy" }), owner: P1, zone: "play" }
      ]
    });
    assert.ok(engine.getRestrictions(id("maw")).includes("cannotBePicked"));
  });

  test("can be picked when character counts are even", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "maw", def: def("Martial Arts Wannabe"), owner: P1, zone: "play" },
        { key: "opp", def: character({ name: "Opp" }), owner: P2, zone: "play" }
      ]
    });
    assert.equal(engine.getRestrictions(id("maw")).includes("cannotBePicked"), false);
  });
});

describe("Shade of the Devoured Emperor — Murderous Kleptomaniac", () => {
  test("is COVERT; on death, may exile a card in play", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mk", def: def("Murderous Kleptomaniac"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        { key: "victim", def: character({ name: "Victim" }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    assert.ok(engine.getKeywords(id("mk")).includes("covert"));
    play(engine, P1, id("kill"), { selected: { t: [id("mk")] } });
    drain(engine, pc =>
      pc.kind === "selectTargets"
        ? { kind: "selectTargets", selected: { victim: [id("victim")] } }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("victim")].zone, "removed");
  });
});

describe("Shade of the Devoured Emperor — Numba 1 Stunna!", () => {
  test("has TACTICAL", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "n1s", def: def("Numba 1 Stunna!"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getKeywords(id("n1s")).includes("tactical"));
  });
});

describe("Shade of the Devoured Emperor — Opportunistic Pirate", () => {
  test("EXTRA COST: exile up to 4 of an opponent's discard cards to cut its cost", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "op", def: def("Opportunistic Pirate"), owner: P1, zone: "hand" },
        { key: "g1", def: character({ name: "G1" }), owner: P2, zone: "discard" },
        { key: "g2", def: character({ name: "G2" }), owner: P2, zone: "discard" },
        ...bank("deception", 8, P1)
      ]
    });
    play(engine, P1, id("op"), { selected: { rem: [id("g1"), id("g2")] } });
    assert.equal(engine.state.cards[id("op")].zone, "play");
    assert.equal(engine.state.cards[id("g1")].zone, "removed");
    assert.equal(engine.state.cards[id("g2")].zone, "removed");
  });
});

describe("Shade of the Devoured Emperor — Parkour Hoodlum", () => {
  test("in hand it gains TACTICAL while a location is in play", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "ph", def: def("Parkour Hoodlum"), owner: P1, zone: "hand" },
        { key: "loc", def: location({ name: "Loc" }), owner: P2, zone: "play" }
      ]
    });
    assert.ok(engine.getKeywords(id("ph")).includes("tactical"));
  });
});

describe("Shade of the Devoured Emperor — Sharpey Pointy Lethal Army Tool", () => {
  test("the attached character gains 2 strength", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host", strength: 2 }), owner: P1, zone: "play" },
        { key: "sp", def: def("Sharpey Pointy Lethal Army Tool"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), 4);
  });
});

describe("Shade of the Devoured Emperor — Sickened Sarcophyle", () => {
  test("deploys as a plain character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "ss", def: def("Sickened Sarcophyle"), owner: P1, zone: "hand" }, ...bank("deception", 8, P1)]
    });
    play(engine, P1, id("ss"), {});
    assert.equal(engine.state.cards[id("ss")].zone, "play");
  });
});

describe("Shade of the Devoured Emperor — Sneaker Attack!", () => {
  test("during a battle, depletes a bench character and adds it to your attacking party", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sa", def: def("Sneaker Attack!"), owner: P1, zone: "hand" },
        { key: "atkr", def: character({ name: "Atkr", strength: 2, life: 2, speed: 3 }), owner: P1, zone: "play" },
        { key: "bench", def: character({ name: "Bench", strength: 2, life: 2, speed: 3 }), owner: P1, zone: "play" },
        ...bank("deception", 8, P1)
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atkr")], target: { type: "faction", playerId: P2 } });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("sa"), selected: { ch: [id("bench")] } } as never);
    resolvePendingResponses(engine);
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "chooserSelectsOption", index: 0 }
    });
    assert.ok(engine.state.battle?.attackingParty.includes(id("bench")));
    assert.equal(engine.state.cards[id("bench")].depleted, true);
  });
});

describe("Shade of the Devoured Emperor — Sticky Stealy Hand", () => {
  test("when it leaves play, the attached item's control reverts to its owner", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "oppItem", def: item({ name: "OppItem" }), owner: P2, controller: P1, zone: "play" },
        { key: "ssh", def: def("Sticky Stealy Hand"), owner: P1, zone: "play", attachedToKey: "oppItem" },
        { key: "kill", def: killTactic({ behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P1, zone: "hand" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("kill"), { selected: { t: [id("ssh")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("oppItem")].controllerId, P2);
  });
});

describe("Shade of the Devoured Emperor — Surreptitious Larceny", () => {
  test("mode 2 grants a character COVERT and draws a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sl", def: def("Surreptitious Larceny"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("deception", 8, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("sl"), { mode: 1, selected: { ch: [id("c")] } });
    drain(engine, declineAll);
    assert.ok(engine.getKeywords(id("c")).includes("covert"));
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1);
  });
});

describe("Shade of the Devoured Emperor — Thabbashite Assailant", () => {
  test("[V] and [V][V] tiers give +1 life and +1 strength", () => {
    const d = def("Thabbashite Assailant");
    const { engine, id } = buildGame({
      cards: [{ key: "ta", def: d, owner: P1, zone: "play" }, ...volition(2, P1)]
    });
    assert.equal(engine.getStat(id("ta"), "life"), (d.life ?? 0) + 1);
    assert.equal(engine.getStat(id("ta"), "strength"), (d.strength ?? 0) + 1);
  });
});

describe("Shade of the Devoured Emperor — Torchlight District", () => {
  test("characters you control can attack only once per turn", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "td", def: def("Torchlight District"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" }
      ]
    });
    assert.ok(engine.getRestrictions(id("c")).includes("attackOncePerTurn"));
  });
});

describe("Shade of the Devoured Emperor — Totally Random Kid", () => {
  test("milling: when it damages a faction, mill that many cards from that deck", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "trk", def: def("Totally Random Kid"), owner: P1, zone: "play" },
        ...Array.from({ length: 5 }, (_, i) => ({ key: `od${i}`, def: character({ name: `OD${i}` }), owner: P2, zone: "deck" as const }))
      ],
      turn: 2
    });
    const discBefore = engine.state.players[P2].discard.length;
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("trk")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.players[P2].discard.length, discBefore + 1); // strength 1 -> mill 1
  });
});

// =====================================================================
// Volition + Rage blocks
// =====================================================================

describe("Shade of the Devoured Emperor — Clockman Skydocks", () => {
  test("BUSINESS DAY depletes it after naming an icon", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cs", def: def("Clockman Skydocks"), owner: P1, zone: "play" },
        ...volition(2, P1),
        ...bank("rage", 4, P1)
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("cs"), abilityId: "cs-bday", selected: {}, variables: {} });
    resolvePendingResponses(engine);
    drain(engine, pc => (pc.kind === "nameValue" ? { kind: "nameValue", value: "rage" } : declineAll(pc)));
    assert.equal(engine.state.cards[id("cs")].depleted, true);
  });
});

describe("Shade of the Devoured Emperor — Remains of Foreman Pete, the Clock Man", () => {
  test("CLOCK OUT flips it face-down", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "fp", def: def("Remains of Foreman Pete, the Clock Man"), owner: P1, zone: "play" },
        ...volition(2, P1),
        ...bank("rage", 4, P1)
      ]
    });
    activate(engine, P1, id("fp"), "foreman-pete-clock-out");
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("fp")].faceDown, true);
  });
});

describe("Shade of the Devoured Emperor — Time to Retire", () => {
  test("flips a character you control face-down", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ttr", def: def("Time to Retire"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" },
        ...volition(1, P1),
        ...bank("rage", 4, P1)
      ]
    });
    play(engine, P1, id("ttr"), { selected: { ch: [id("c")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("c")].faceDown, true);
  });
});

describe("Shade of the Devoured Emperor — 6r4wny 60dy9u4rd5", () => {
  test("redirects damage aimed at the warded character onto itself", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "bg", def: def("6r4wny 60dy9u4rd5"), owner: P1, zone: "hand" },
        { key: "ward", def: character({ name: "Ward", life: 5 }), owner: P1, zone: "play" },
        { key: "zap", def: killTactic({ name: "Zap", behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 2 }] }] } }), owner: P1, zone: "hand" },
        ...bank("rage", 10, P1)
      ]
    });
    play(engine, P1, id("bg"), { selected: { ward: [id("ward")] } });
    play(engine, P1, id("zap"), { selected: { t: [id("ward")] } });
    assert.equal(engine.state.cards[id("ward")].damage ?? 0, 0);
    assert.equal(engine.state.cards[id("bg")].damage, 2);
  });
});

describe("Shade of the Devoured Emperor — B.A.S.E. Jump", () => {
  test("deals the picked location's structure as damage to the picked character, then draws", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "bj", def: def("B.A.S.E. Jump"), owner: P1, zone: "hand" },
        { key: "loc", def: location({ name: "Tower", structure: 4 }), owner: P2, zone: "play" },
        { key: "c", def: character({ name: "C", life: 10 }), owner: P2, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("rage", 6, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("bj"), { selected: { loc: [id("loc")], ch: [id("c")] } });
    assert.equal(engine.state.cards[id("c")].damage, 4);
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1);
  });
});

describe("Shade of the Devoured Emperor — Barracks of Precipitancy", () => {
  test("GO TIME! depletes it and can drop the revealed top character into play", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "bop", def: def("Barracks of Precipitancy"), owner: P1, zone: "play" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `dk${i}`, def: character({ name: `Dk${i}`, cost: 1 }), owner: P1, zone: "deck" as const })),
        ...bank("rage", 6, P1)
      ]
    });
    const playBefore = engine.state.players[P1].play.length;
    activate(engine, P1, id("bop"), "bop-gotime");
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("bop")].depleted, true);
    assert.ok(engine.state.players[P1].play.length >= playBefore + 1);
  });
});

describe("Shade of the Devoured Emperor — Battle-Ready Back-Breaker", () => {
  test("ETB may deplete a chosen character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "bb", def: def("Battle-Ready Back-Breaker"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("bb"), {});
    drain(engine, pc =>
      pc.kind === "selectTargets"
        ? { kind: "selectTargets", selected: { pick: [id("c")] } }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("c")].depleted, true);
  });
});

describe("Shade of the Devoured Emperor — Bloating Bask", () => {
  test("[R]x6 grants +1/+1/+1", () => {
    const d = def("Bloating Bask");
    const { engine, id } = buildGame({
      cards: [{ key: "bb", def: d, owner: P1, zone: "play" }, ...bank("rage", 6, P1)]
    });
    assert.equal(engine.getStat(id("bb"), "strength"), (d.strength ?? 0) + 1);
    assert.equal(engine.getStat(id("bb"), "speed"), (d.speed ?? 0) + 1);
  });
});

describe("Shade of the Devoured Emperor — Bloody Fisted Fanatic", () => {
  test("deploys as a plain vanilla character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "bff", def: def("Bloody Fisted Fanatic"), owner: P1, zone: "hand" }, ...bank("rage", 10, P1)]
    });
    play(engine, P1, id("bff"), {});
    assert.equal(engine.state.cards[id("bff")].zone, "play");
  });
});

describe("Shade of the Devoured Emperor — Confrontational Conflagration", () => {
  test("deals your character's strength to both it and an opposing character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cc", def: def("Confrontational Conflagration"), owner: P1, zone: "hand" },
        { key: "mine", def: character({ name: "Mine", strength: 3, life: 10 }), owner: P1, zone: "play" },
        { key: "theirs", def: character({ name: "Theirs", life: 10 }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("cc"), { selected: { mine: [id("mine")], theirs: [id("theirs")] } });
    assert.equal(engine.state.cards[id("mine")].damage, 3);
    assert.equal(engine.state.cards[id("theirs")].damage, 3);
  });
});

describe("Shade of the Devoured Emperor — Discordant Cadencer", () => {
  test("AGITATE: lose 2 influence for PROVIDES [R][R][R] this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "dc", def: def("Discordant Cadencer"), owner: P1, zone: "play" }, ...bank("rage", 6, P1)]
    });
    const inf = engine.state.players[P1].influence;
    const before = engine.getThresholds(P1).rage ?? 0;
    activate(engine, P1, id("dc"), "dc-agitate");
    assert.equal((engine.getThresholds(P1).rage ?? 0) - before, 3);
    assert.equal(engine.state.players[P1].influence, inf - 2);
  });
});

describe("Shade of the Devoured Emperor — Drill Instructor", () => {
  test("has TACTICAL and its ETB picks a target", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "di", def: def("Drill Instructor"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("di"), {});
    drain(engine, pc =>
      pc.kind === "selectTargets"
        ? { kind: "selectTargets", selected: { pick: [id("c")] } }
        : declineAll(pc)
    );
    assert.ok(engine.getKeywords(id("di")).includes("tactical"));
    assert.equal(engine.state.cards[id("di")].zone, "play");
  });
});

describe("Shade of the Devoured Emperor — Duelist of Surfeit", () => {
  test("gains +1/+1 per token", () => {
    const d = def("Duelist of Surfeit");
    const { engine, id } = buildGame({
      cards: [{ key: "ds", def: d, owner: P1, zone: "play", counters: { token: 2 } }]
    });
    assert.equal(engine.getStat(id("ds"), "strength"), (d.strength ?? 0) + 2);
    assert.equal(engine.getStat(id("ds"), "life"), (d.life ?? 0) + 2);
  });
});

describe("Shade of the Devoured Emperor — Fanatical Shriever", () => {
  test("has TACTICAL; EXTRA COST may destroy an item", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "fs", def: def("Fanatical Shriever"), owner: P1, zone: "hand" },
        { key: "it", def: item({ name: "Doomed" }), owner: P2, zone: "play" },
        ...bank("rage", 8, P1)
      ]
    });
    assert.ok(def("Fanatical Shriever").behavior?.keywords?.includes("tactical"));
    play(engine, P1, id("fs"), { selected: { it: [id("it")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("it")].zone, "discard");
  });
});

describe("Shade of the Devoured Emperor — Fistfight", () => {
  test("sacrifice one of your characters to deal its strength + 1 to another", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ff", def: def("Fistfight"), owner: P1, zone: "hand" },
        { key: "a", def: character({ name: "A", strength: 3 }), owner: P1, zone: "play" },
        { key: "b", def: character({ name: "B", life: 10 }), owner: P2, zone: "play" },
        ...bank("rage", 8, P1)
      ]
    });
    play(engine, P1, id("ff"), { selected: { a: [id("a")], b: [id("b")] } });
    assert.equal(engine.state.cards[id("a")].zone, "discard");
    assert.equal(engine.state.cards[id("b")].damage, 4);
  });
});

describe("Shade of the Devoured Emperor — Flaming Cube", () => {
  test("enters play with 3 tokens", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "fc", def: def("Flaming Cube"), owner: P1, zone: "hand" }, ...bank("rage", 8, P1)]
    });
    play(engine, P1, id("fc"), {});
    assert.equal(engine.state.cards[id("fc")].counters.token, 3);
  });
});

describe("Shade of the Devoured Emperor — Juice Closet", () => {
  test("at start of your turn, may give a character +1 strength this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "jc", def: def("Juice Closet"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C", strength: 2 }), owner: P1, zone: "play" }
      ],
      activePlayerId: P2
    });
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    drain(engine, pc =>
      pc.kind === "selectTargets"
        ? { kind: "selectTargets", selected: { ch: [id("c")] } }
        : declineAll(pc)
    );
    assert.equal(engine.getStat(id("c"), "strength"), 3);
  });
});

describe("Shade of the Devoured Emperor — Juice Sale!", () => {
  test("the opponent's highest-strength character cannot block this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "js", def: def("Juice Sale!"), owner: P1, zone: "hand" },
        { key: "strong", def: character({ name: "Strong", strength: 5, life: 5 }), owner: P2, zone: "play" },
        { key: "weak", def: character({ name: "Weak", strength: 2, life: 5 }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("js"), { selected: { ch: [id("strong")] } });
    assert.ok(engine.getRestrictions(id("strong")).includes("cannotBlock"));
  });

  test("a lower-strength character is not a legal target", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "js", def: def("Juice Sale!"), owner: P1, zone: "hand" },
        { key: "strong", def: character({ name: "Strong", strength: 5, life: 5 }), owner: P2, zone: "play" },
        { key: "weak", def: character({ name: "Weak", strength: 2, life: 5 }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("js"), selected: { ch: [id("weak")] } } as never)
    );
  });
});

describe("Shade of the Devoured Emperor — Marauding Madster", () => {
  test("EXTRA COST sacrifices one of your characters; it recycles into your deck on death", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mm", def: def("Marauding Madster"), owner: P1, zone: "hand" },
        { key: "sac", def: character({ name: "Sac" }), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        ...bank("rage", 10, P1)
      ]
    });
    play(engine, P1, id("mm"), { selected: { sacrifice: [id("sac")] } });
    assert.equal(engine.state.cards[id("sac")].zone, "discard");
    assert.equal(engine.state.cards[id("mm")].zone, "play");
    play(engine, P1, id("kill"), { selected: { t: [id("mm")] } });
    assert.equal(engine.state.cards[id("mm")].zone, "deck");
  });
});

describe("Shade of the Devoured Emperor — Rudo Mangod, Dragonweight Champion", () => {
  test("ETB depletes your other characters; scales with depleted Warlord characters", () => {
    const d = def("Rudo Mangod, Dragonweight Champion");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rudo", def: d, owner: P1, zone: "hand" },
        { key: "wl", def: character({ name: "WL", trade: "warlord" }), owner: P1, zone: "play" },
        { key: "other", def: character({ name: "Other" }), owner: P1, zone: "play" },
        ...bank("rage", 10, P1)
      ]
    });
    play(engine, P1, id("rudo"), {});
    assert.equal(engine.state.cards[id("wl")].depleted, true);
    assert.equal(engine.state.cards[id("other")].depleted, true);
    assert.equal(engine.getStat(id("rudo"), "strength"), (d.strength ?? 0) + 1); // one depleted warlord
  });
});

describe("Shade of the Devoured Emperor — Rushing Crushing Blockhead", () => {
  test("cannot block; recoils (self-destructs, faction takes 2) after damaging a faction", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "rcb", def: def("Rushing Crushing Blockhead"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getRestrictions(id("rcb")).includes("cannotBlock"));
    const inf = engine.state.players[P1].influence;
    (engine as unknown as { emit: (e: unknown) => void }).emit({
      type: "damageDealt",
      sourceId: id("rcb"),
      targetId: engine.state.players[P2].factionId,
      amount: 4
    });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("rcb")].zone, "discard");
    assert.equal(engine.state.players[P1].influence, inf - 2);
  });
});

describe("Shade of the Devoured Emperor — the card 'Shade of the Devoured Emperor'", () => {
  test("at end of an opponent's turn, may exile itself to summon a UNIQUE seraph from a deck", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "shade", def: def("Shade of the Devoured Emperor"), owner: P1, zone: "play" },
        { key: "jo", def: character({ name: "JoClone", unique: "jo" }), owner: P1, zone: "deck" }
      ],
      activePlayerId: P2
    });
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    drain(engine, pc => {
      if (pc.kind === "mayPay") return { kind: "mayPay", pay: true };
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [id("jo")] };
      return declineAll(pc);
    });
    assert.equal(engine.state.cards[id("shade")].zone, "removed");
    assert.equal(engine.state.cards[id("jo")].zone, "play");
  });
});

describe("Shade of the Devoured Emperor — Shriever Breeding Program", () => {
  test("mode 2 depletes a character and draws a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sbp", def: def("Shriever Breeding Program"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("rage", 6, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("sbp"), { mode: 1, selected: { ch: [id("c")] } });
    assert.equal(engine.state.cards[id("c")].depleted, true);
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1);
  });
});

describe("Shade of the Devoured Emperor — Skullcrush Steamroller", () => {
  test("cannot be restored by the RESTORE RULE and can attack only once per turn; ASSIST restores it", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ss", def: def("Skullcrush Steamroller"), owner: P1, zone: "play", depleted: true },
        { key: "sac", def: character({ name: "Sac" }), owner: P1, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    assert.ok(engine.getRestrictions(id("ss")).includes("cannotBeRestoredByRule"));
    assert.ok(engine.getRestrictions(id("ss")).includes("attackOncePerTurn"));
    activate(engine, P1, id("ss"), "ss-assist", { selected: { c: [id("sac")] } });
    assert.equal(engine.state.cards[id("ss")].depleted, false);
    assert.equal(engine.state.cards[id("sac")].depleted, true);
  });
});

describe("Shade of the Devoured Emperor — Super Shiny Caltrops of DOOM!", () => {
  test("ETB may deal 2 damage to a chosen character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sc", def: def("Super Shiny Caltrops of DOOM!"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", life: 10 }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("sc"), {});
    drain(engine, pc =>
      pc.kind === "selectTargets"
        ? { kind: "selectTargets", selected: { hit: [id("c")] } }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("c")].damage, 2);
  });
});

describe("Shade of the Devoured Emperor — Thabbashite Warmonger", () => {
  test("[V]: retaliates against the faction of a character that battle-damages a faction", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "tw", def: def("Thabbashite Warmonger"), owner: P1, zone: "play" },
        { key: "attacker", def: character({ name: "Attacker", threshold: "rr" }), owner: P2, zone: "play" },
        ...volition(1, P1)
      ]
    });
    const inf = engine.state.players[P2].influence;
    (engine as unknown as { emit: (e: unknown) => void }).emit({
      type: "damageDealt",
      sourceId: id("attacker"),
      targetId: engine.state.players[P1].factionId,
      amount: 2
    });
    drain(engine, declineAll);
    // Attacker's threshold is [R][R] = 2 icons -> 2 damage to its own (P2) faction
    assert.equal(engine.state.players[P2].influence, inf - 2);
  });
});

describe("Shade of the Devoured Emperor — Ursine Assassin", () => {
  test("TO BEAR ARMS sacrifices a character you control to deal 2 damage", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ua", def: def("Ursine Assassin"), owner: P1, zone: "play" },
        { key: "sac", def: character({ name: "Sac" }), owner: P1, zone: "play" },
        { key: "vic", def: character({ name: "Vic", life: 10 }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    activate(engine, P1, id("ua"), "ursine-to-bear-arms", { selected: { vic: [id("vic")], sac: [id("sac")] } });
    assert.equal(engine.state.cards[id("sac")].zone, "discard");
    assert.equal(engine.state.cards[id("vic")].damage, 2);
  });
});

describe("Shade of the Devoured Emperor — Warbeast of Thabbash", () => {
  test("strength and life scale with the [V] you control", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "wb", def: def("Warbeast of Thabbash"), owner: P1, zone: "play" }, ...volition(3, P1)]
    });
    assert.equal(engine.getStat(id("wb"), "strength"), 3);
    assert.equal(engine.getStat(id("wb"), "life"), 3);
  });
});

describe("Shade of the Devoured Emperor — Words of Glory", () => {
  test("deals (opponents' total strength - 3) to every character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "wg", def: def("Words of Glory"), owner: P1, zone: "hand" },
        { key: "mine", def: character({ name: "Mine", life: 10 }), owner: P1, zone: "play" },
        { key: "theirs", def: character({ name: "Theirs", strength: 5, life: 10 }), owner: P2, zone: "play" },
        ...bank("rage", 12, P1)
      ]
    });
    play(engine, P1, id("wg"), {});
    // opponent total strength 5, minus 3 = 2 to all
    assert.equal(engine.state.cards[id("mine")].damage, 2);
    assert.equal(engine.state.cards[id("theirs")].damage, 2);
  });
});
