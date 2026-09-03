// Per-card correctness suite — Seed 2 (110 cards, the FLIP UP / RECUR era).
//
// One describe() per catalog card. See ./_harness.ts and
// ../../../CARD-TEST-PROGRESS.md.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGame,
  cardDef,
  developFaction,
  bank,
  character,
  item,
  location,
  tactic,
  resourceCard,
  drawerChar,
  bounceTactic,
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

const SET = "Seed 2";
const def = (name: string) => cardDef(SET, name);

// Drain a chain of pending choices, answering each with a supplied fn.
function drain(
  engine: ReturnType<typeof buildGame>["engine"],
  answerFor: (pc: { kind: string; playerId: string; [k: string]: unknown }) => unknown,
  budget = 30
): void {
  let n = 0;
  while (engine.state.pendingChoice && n++ < budget) {
    const pc = engine.state.pendingChoice as { kind: string; playerId: string };
    const choice = answerFor(pc);
    engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
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
    case "selectTargets":
      return { kind: "selectTargets", selected: {} };
    case "distributeAmong":
      return { kind: "distributeAmong", shares: {} };
    case "reorderDeck":
      return { kind: "reorderDeck", order: [...((pc.cardIds as string[]) ?? [])] };
    case "orderTriggers":
      return { kind: "orderTriggers", next: ((pc.triggers as unknown[]) ?? [])[0] };
    case "useAnyAbility":
      return { kind: "useAnyAbility", cardId: undefined };
    case "useTargetAbility":
      return { kind: "useTargetAbility" };
    case "replacementChoice":
      return { kind: "replacementChoice", apply: false };
    case "deployForFree":
      return { kind: "deployForFree" };
    default:
      return { kind: pc.kind };
  }
};

// =====================================================================
// Obsession block
// =====================================================================

describe("Seed 2 — Desolate", () => {
  test("destroys exactly the characters whose strength equals X", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "d", def: def("Desolate"), owner: P1, zone: "hand" },
        { key: "s2", def: character({ name: "Str2", strength: 2, life: 5 }), owner: P1, zone: "play" },
        { key: "s3", def: character({ name: "Str3", strength: 3, life: 5 }), owner: P2, zone: "play" },
        ...bank("obsession", 6, P1)
      ]
    });
    play(engine, P1, id("d"), { variables: { x: 2 } });
    assert.equal(engine.state.cards[id("s2")].zone, "discard");
    assert.equal(engine.state.cards[id("s3")].zone, "play");
  });

  test("X may not exceed the number of [O] controlled", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "d", def: def("Desolate"), owner: P1, zone: "hand" }, ...bank("obsession", 2, P1)]
    });
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("d"), selected: {}, variables: { x: 5 } } as never)
    );
  });
});

describe("Seed 2 — Foment", () => {
  test("returns a resource you control to hand and draws a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "f", def: def("Foment"), owner: P1, zone: "hand" },
        { key: "dk", def: character({ name: "Dk" }), owner: P1, zone: "deck" },
        ...bank("obsession", 4, P1)
      ]
    });
    const someRes = engine.state.players[P1].play.find(c => engine.getDefinition(c).type === "resource")!;
    play(engine, P1, id("f"), { selected: { res: [someRes] } });
    assert.equal(engine.state.cards[someRes].zone, "hand");
    assert.equal(engine.state.cards[id("dk")].zone, "hand");
  });
});

describe("Seed 2 — Hextilda, the Exiled Crone", () => {
  test("TOIL AND TROUBLE doubles the tokens on a chosen card you control", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "h", def: def("Hextilda, the Exiled Crone"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "Tokened" }), owner: P1, zone: "play", counters: { token: 3 } },
        ...bank("obsession", 8, P1)
      ]
    });
    activate(engine, P1, id("h"), "toil-and-trouble", { selected: { target: [id("c")] } });
    assert.equal(engine.state.cards[id("c")].counters.token, 6);
    assert.equal(engine.state.cards[id("h")].depleted, true);
  });

  test("a card with no tokens is not a legal target", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "h", def: def("Hextilda, the Exiled Crone"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "Plain" }), owner: P1, zone: "play" },
        ...bank("obsession", 8, P1)
      ]
    });
    assert.throws(() =>
      engine.perform({
        type: "activateAbility",
        playerId: P1,
        cardId: id("h"),
        abilityId: "toil-and-trouble",
        selected: { target: [id("c")] }
      })
    );
  });
});

describe("Seed 2 — Hideous Hexapede of Horror", () => {
  test("sacrifices itself to deal 6 to picked characters and 6 to every faction", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "hex", def: def("Hideous Hexapede of Horror"), owner: P1, zone: "play" },
        { key: "v", def: character({ name: "Victim", life: 6 }), owner: P2, zone: "play" },
        ...bank("obsession", 10, P1)
      ]
    });
    const p1Inf = engine.state.players[P1].influence;
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("hex"),
      abilityId: "hellish-hex",
      selected: { victims: [id("v")] }
    });
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("hex")].zone, "discard");
    assert.equal(engine.state.cards[id("v")].zone, "discard");
    assert.equal(engine.state.players[P1].influence, p1Inf - 6);
  });
});

describe("Seed 2 — Imperial Thaumaturge", () => {
  test("TICKLE forces an opponent to discard", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "t", def: def("Imperial Thaumaturge"), owner: P1, zone: "play" },
        { key: "oh", def: character({ name: "OppCard" }), owner: P2, zone: "hand" },
        ...bank("obsession", 4, P1)
      ]
    });
    activate(engine, P1, id("t"), "tickle");
    answer(engine, P2, { kind: "chooserSelectsTarget", selected: [id("oh")] });
    assert.equal(engine.state.cards[id("oh")].zone, "discard");
    assert.equal(engine.state.cards[id("t")].depleted, true);
  });
});

describe("Seed 2 — Inadequate Wand", () => {
  test("PRESENT THE STAFF bounces your character and tutors a cheap tactic", () => {
    const cheap = { ...tactic({ name: "Cheap", cost: 2 }), id: "s2-cheap-tac" };
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "w", def: def("Inadequate Wand"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C", cost: 3 }), owner: P1, zone: "play" },
        { key: "tac", def: cheap, owner: P1, zone: "deck" },
        ...bank("obsession", 6, P1)
      ]
    });
    activate(engine, P1, id("w"), "present-the-staff", { selected: { char: [id("c")] } });
    if (engine.state.pendingChoice) answer(engine, P1, { kind: "chooserSelectsTarget", selected: [id("tac")] });
    assert.equal(engine.state.cards[id("c")].zone, "hand");
    assert.equal(engine.state.cards[id("tac")].zone, "hand");
  });
});

describe("Seed 2 — Manifest", () => {
  test("deploys a revealed face-down tactic you control and draws a card", () => {
    const hidden = {
      ...tactic({
        name: "HiddenTac",
        cost: 0,
        behavior: { abilities: [{ id: "x", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
      }),
      id: "s2-hidden-tac"
    };
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "m", def: def("Manifest"), owner: P1, zone: "hand" },
        { key: "hid", def: hidden, owner: P1, zone: "play", faceDown: true },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" },
        ...bank("obsession", 4, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("m"), { selected: { rev: [id("hid")] } });
    drain(engine, pc =>
      pc.kind === "deployForFree"
        ? { kind: "deployForFree", cardId: id("hid") }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("hid")].zone, "discard"); // deployed + resolved
    // -1 Manifest, +1 Manifest's own draw, +1 HiddenTac's draw
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 2);
  });
});

describe("Seed 2 — Meat of the Mountain", () => {
  test("on a draw, its controller may add a token to it", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "meat", def: def("Meat of the Mountain"), owner: P1, zone: "play" },
        { key: "drawer", def: drawerChar(), owner: P1, zone: "play" },
        ...Array.from({ length: 8 }, (_, i) => ({
          key: `mdk${i}`,
          def: character({ name: `MDk${i}` }),
          owner: P1,
          zone: "deck" as const
        }))
      ]
    });
    activate(engine, P1, id("drawer"), "draw1");
    drain(engine, pc =>
      pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 1 } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("meat")].counters?.token, 1);
  });
});

describe("Seed 2 — Minion of Thabbash", () => {
  test("is COVERT and provides [O]", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "m", def: def("Minion of Thabbash"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getKeywords(id("m")).includes("covert"));
    assert.equal(engine.getThresholds(P1).obsession ?? 0, 1);
  });
});

describe("Seed 2 — Muddle", () => {
  test("terminates the tactic it responds to", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mud", def: def("Muddle"), owner: P1, zone: "hand" },
        { key: "opp", def: tactic({ name: "OppTac", cost: 1 }), owner: P2, zone: "hand" },
        ...bank("obsession", 8, P1),
        ...bank("rage", 4, P2)
      ],
      activePlayerId: P2
    });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("opp"), selected: {} } as never);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("mud"), selected: {} } as never);
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("opp")].zone, "discard");
  });
});

describe("Seed 2 — Nattering Stoopswaggler", () => {
  test("with a token: loses COVERT, gains +1/+1", () => {
    const d = def("Nattering Stoopswaggler");
    const { engine, id } = buildGame({
      cards: [{ key: "n", def: d, owner: P1, zone: "play", counters: { token: 1 } }]
    });
    assert.equal(engine.getKeywords(id("n")).includes("covert"), false);
    assert.equal(engine.getStat(id("n"), "strength"), (d.strength ?? 0) + 1);
    assert.equal(engine.getStat(id("n"), "life"), (d.life ?? 0) + 1);
  });

  test("with no token: is COVERT and dodges destruction by flipping face-down", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "n", def: def("Nattering Stoopswaggler"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P2, zone: "hand" },
        ...bank("rage", 4, P2)
      ],
      activePlayerId: P2
    });
    assert.ok(engine.getKeywords(id("n")).includes("covert"));
    play(engine, P2, id("kill"), { selected: { t: [id("n")] } });
    assert.equal(engine.state.cards[id("n")].zone, "play");
    assert.equal(engine.state.cards[id("n")].faceDown, true);
  });
});

describe("Seed 2 — Obscene Astrologer", () => {
  test("GAZE deploys a cheap tactic from hand for free", () => {
    const freeTac = {
      ...tactic({
        name: "FreeTac",
        cost: 2,
        behavior: { abilities: [{ id: "x", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
      }),
      id: "s2-free-tac"
    };
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "oa", def: def("Obscene Astrologer"), owner: P1, zone: "play" },
        { key: "ft", def: freeTac, owner: P1, zone: "hand" },
        { key: "dk", def: character({ name: "Dk" }), owner: P1, zone: "deck" },
        ...bank("obsession", 4, P1)
      ]
    });
    activate(engine, P1, id("oa"), "gaze");
    drain(engine, pc =>
      pc.kind === "deployForFree" ? { kind: "deployForFree", cardId: id("ft") } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("ft")].zone, "discard"); // tactic resolved
    assert.equal(engine.state.cards[id("oa")].depleted, true);
  });
});

describe("Seed 2 — Otter Floss", () => {
  test("draws, bottoms a hand card, and re-enters play as a face-down resource", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "of", def: def("Otter Floss"), owner: P1, zone: "hand" },
        { key: "spare", def: character({ name: "Spare" }), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" },
        ...bank("obsession", 6, P1)
      ]
    });
    play(engine, P1, id("of"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("spare")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("spare")].zone, "deck");
    assert.equal(engine.state.cards[id("of")].zone, "play");
    assert.equal(engine.state.cards[id("of")].faceDown, true);
  });
});

describe("Seed 2 — Perturb", () => {
  test("discards a non-resource card from an opponent's hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "p", def: def("Perturb"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OppChar" }), owner: P2, zone: "hand" },
        ...bank("obsession", 8, P1)
      ]
    });
    play(engine, P1, id("p"), { selected: { disc: [id("oc")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("oc")].zone, "discard");
  });

  test("a resource in the opponent's hand is not a legal target", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "p", def: def("Perturb"), owner: P1, zone: "hand" },
        { key: "or", def: cardDef(SET, "Minion of Thabbash"), owner: P2, zone: "hand" },
        { key: "res", def: { ...cardDef("Seed 3", "Rage") }, owner: P2, zone: "hand" },
        ...bank("obsession", 8, P1)
      ]
    });
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("p"), selected: { disc: [id("res")] } } as never)
    );
  });
});

describe("Seed 2 — Redonkulous", () => {
  test("removes the picked character if its controller has <= 3 cards in hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "r", def: def("Redonkulous"), owner: P1, zone: "hand" },
        { key: "v", def: character({ name: "Victim" }), owner: P2, zone: "play" },
        ...bank("obsession", 8, P1)
      ]
    });
    // P2 hand is empty -> <= 3
    play(engine, P1, id("r"), { selected: { char: [id("v")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("v")].zone, "removed");
  });
});

describe("Seed 2 — Ritual of the Double Monkey", () => {
  test("an opponent discards one card (only [O][O][O] adds a second)", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "r", def: def("Ritual of the Double Monkey"), owner: P1, zone: "hand" },
        { key: "o1", def: character({ name: "O1" }), owner: P2, zone: "hand" },
        { key: "o2", def: character({ name: "O2" }), owner: P2, zone: "hand" },
        ...bank("obsession", 2, P1)
      ]
    });
    const before = engine.state.players[P2].hand.length;
    play(engine, P1, id("r"), {});
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [engine.state.players[P2].hand[0]] }
        : declineAll(pc)
    );
    assert.equal(engine.state.players[P2].hand.length, before - 1);
  });
});

describe("Seed 2 — Titillated Mooncalf", () => {
  test("when an [O] source enters, may grant a character COVERT for the turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mc", def: def("Titillated Mooncalf"), owner: P1, zone: "play" },
        { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
        { key: "ores", def: cardDef("Seed 3", "Obsession"), owner: P1, zone: "hand" }
      ]
    });
    engine.perform({
      type: "chooseDevelop",
      playerId: P1,
      choice: { type: "playResource", cards: [{ cardId: id("ores"), faceDown: false }] }
    } as never);
    resolvePendingResponses(engine);
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("ally")] }
        : declineAll(pc)
    );
    assert.ok(engine.getKeywords(id("ally")).includes("covert"));
  });
});

describe("Seed 2 — Tumescent Guilt Bladder", () => {
  test("at end of turn: token added and faction loses influence equal to token count", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "tgb", def: def("Tumescent Guilt Bladder"), owner: P1, zone: "play" },
        ...bank("obsession", 6, P1)
      ]
    });
    const inf = engine.state.players[P1].influence;
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("tgb")].counters.token, 1);
    assert.equal(engine.state.players[P1].influence, inf - 1);
  });
});

describe("Seed 2 — Verrucose Brains", () => {
  test("at end of turn, bounces the lowest-cost character to its owner's hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "vb", def: def("Verrucose Brains"), owner: P1, zone: "play" },
        { key: "cheap", def: character({ name: "Cheap", cost: 1 }), owner: P1, zone: "play" },
        { key: "pricey", def: character({ name: "Pricey", cost: 6 }), owner: P2, zone: "play" }
      ]
    });
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("cheap")].zone, "hand");
    assert.equal(engine.state.cards[id("pricey")].zone, "play");
  });
});

describe("Seed 2 — Witty Worm", () => {
  test("ETB: may bounce a resource you control and then play a resource", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ww", def: def("Witty Worm"), owner: P1, zone: "hand" },
        ...bank("obsession", 6, P1)
      ]
    });
    const resInPlay = engine.state.players[P1].play.filter(c => engine.getDefinition(c).type === "resource");
    play(engine, P1, id("ww"), {});
    drain(engine, pc => {
      if (pc.kind !== "chooserSelectsTarget") return declineAll(pc);
      const declId = (pc.declaration as { id?: string } | undefined)?.id;
      return { kind: "chooserSelectsTarget", selected: declId === "bounce" ? [resInPlay[0]] : [] };
    });
    assert.equal(engine.state.cards[id("ww")].zone, "play");
    assert.equal(engine.state.cards[resInPlay[0]].zone, "hand");
  });
});

describe("Seed 2 — Woadenworm Gloamspike, Thabbashite Prince", () => {
  test("grants FLIP UP to your face-down tactics", () => {
    const fdTac = { ...tactic({ name: "FDTac", cost: 2, threshold: "o" }), id: "s2-gloam-fdtac" };
    const { engine, id } = buildGame({
      cards: [
        { key: "g", def: def("Woadenworm Gloamspike, Thabbashite Prince"), owner: P1, zone: "play" },
        { key: "fd", def: fdTac, owner: P1, zone: "play", faceDown: true }
      ]
    });
    const flip = engine.getEffectiveFlipUp(id("fd"));
    assert.ok(flip, "expected a granted FLIP UP");
  });
});

// =====================================================================
// Greed block
// =====================================================================

describe("Seed 2 — Alluring Quicksand", () => {
  test("flips a chosen character face-down", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "q", def: def("Alluring Quicksand"), owner: P1, zone: "hand" },
        { key: "v", def: character({ name: "Victim" }), owner: P2, zone: "play" },
        ...bank("greed", 8, P1)
      ]
    });
    play(engine, P1, id("q"), { selected: { t: [id("v")] } });
    assert.equal(engine.state.cards[id("v")].faceDown, true);
  });

  test("RECUR from discard flips another character face-down", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "q", def: def("Alluring Quicksand"), owner: P1, zone: "discard" },
        { key: "v", def: character({ name: "Victim" }), owner: P2, zone: "play" },
        ...bank("greed", 8, P1)
      ]
    });
    activate(engine, P1, id("q"), "quicksand-recur", { selected: { rt: [id("v")] } });
    assert.equal(engine.state.cards[id("v")].faceDown, true);
    assert.equal(engine.state.cards[id("q")].zone, "removed");
  });
});

describe("Seed 2 — Ceremonious Groomer", () => {
  test("dodges destruction by flipping face-down instead", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cg", def: def("Ceremonious Groomer"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P2, zone: "hand" },
        ...bank("rage", 4, P2)
      ],
      activePlayerId: P2
    });
    play(engine, P2, id("kill"), { selected: { t: [id("cg")] } });
    assert.equal(engine.state.cards[id("cg")].zone, "play");
    assert.equal(engine.state.cards[id("cg")].faceDown, true);
  });
});

describe("Seed 2 — Clam Hash", () => {
  test("grants a chosen character +2 life this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ch", def: def("Clam Hash"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", life: 3 }), owner: P1, zone: "play" },
        ...bank("greed", 6, P1)
      ]
    });
    play(engine, P1, id("ch"), { selected: { t: [id("c")] } });
    assert.equal(engine.getStat(id("c"), "life"), 5);
  });
});

describe("Seed 2 — Delectable Boon", () => {
  test("redirects the next X damage from the first picked card to the second", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "b", def: def("Delectable Boon"), owner: P1, zone: "hand" },
        { key: "shield", def: character({ name: "Shielded", life: 5 }), owner: P1, zone: "play" },
        { key: "sink", def: character({ name: "Sink", life: 5 }), owner: P1, zone: "play" },
        { key: "kill", def: killTactic({ name: "Zap", behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 2 }] }] } }), owner: P1, zone: "hand" },
        ...bank("greed", 10, P1)
      ]
    });
    play(engine, P1, id("b"), { variables: { x: 2 }, selected: { first: [id("shield")], second: [id("sink")] } });
    play(engine, P1, id("kill"), { selected: { t: [id("shield")] } });
    assert.equal(engine.state.cards[id("shield")].damage ?? 0, 0);
    assert.equal(engine.state.cards[id("sink")].damage, 2);
  });
});

describe("Seed 2 — Derelict Seafarer", () => {
  test("ETB: faction loses 3 influence and a random discard card returns to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ds", def: def("Derelict Seafarer"), owner: P1, zone: "hand" },
        { key: "grave", def: character({ name: "Grave" }), owner: P1, zone: "discard" },
        ...bank("greed", 8, P1)
      ]
    });
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("ds"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.players[P1].influence, inf - 3);
    assert.equal(engine.state.cards[id("grave")].zone, "hand");
  });
});

describe("Seed 2 — Dowsing Cleric", () => {
  test("ETB: may tutor a staple resource to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "dc", def: def("Dowsing Cleric"), owner: P1, zone: "hand" },
        { key: "res", def: cardDef("Seed 3", "Greed"), owner: P1, zone: "deck" },
        ...bank("greed", 6, P1)
      ]
    });
    play(engine, P1, id("dc"), {});
    drain(engine, pc =>
      pc.kind === "selectTargets"
        ? { kind: "selectTargets", selected: { found: [id("res")] } }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("res")].zone, "hand");
  });
});

describe("Seed 2 — Dwarvish Grimalkin", () => {
  test("ETB draws a card while you control [G][G]", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "dg", def: def("Dwarvish Grimalkin"), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" },
        ...bank("greed", 4, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("dg"), {});
    drain(engine, declineAll);
    // -1 Grimalkin, +1 the [G][G] draw
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1);
  });
});

describe("Seed 2 — Emissary of Loot", () => {
  test("DELIVER spends a token to grant a character +2 life", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "e", def: def("Emissary of Loot"), owner: P1, zone: "play", counters: { token: 1 } },
        { key: "c", def: character({ name: "C", life: 3 }), owner: P1, zone: "play" },
        ...bank("greed", 6, P1)
      ]
    });
    activate(engine, P1, id("e"), "emissary-deliver", { selected: { t: [id("c")] } });
    assert.equal(engine.getStat(id("c"), "life"), 5);
    assert.equal(engine.state.cards[id("e")].counters.token ?? 0, 0);
  });
});

describe("Seed 2 — Framptle Tromwibbler, Lord of Bling", () => {
  test("aura: characters cannot attack or be restored", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "fr", def: def("Framptle Tromwibbler, Lord of Bling"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C" }), owner: P2, zone: "play" }
      ]
    });
    assert.ok(engine.getRestrictions(id("c")).includes("cannotAttack"));
  });

  test("gains a token each turn and self-destructs at 2", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "fr", def: def("Framptle Tromwibbler, Lord of Bling"), owner: P1, zone: "play", counters: { token: 1 } }]
    });
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("fr")].zone, "discard");
  });
});

describe("Seed 2 — Gilded Yurt", () => {
  test("CHILLAX voids a character you control", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "y", def: def("Gilded Yurt"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" }
      ]
    });
    activate(engine, P1, id("y"), "yurt-chillax", { selected: { v: [id("c")] } });
    assert.equal(engine.state.cards[id("c")].zone, "void");
    assert.equal(engine.state.cards[id("y")].depleted, true);
  });
});

describe("Seed 2 — Grandiose Resurrector", () => {
  test("RECUR from discard returns discard characters to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "gr", def: def("Grandiose Resurrector"), owner: P1, zone: "discard" },
        { key: "g1", def: character({ name: "G1" }), owner: P1, zone: "discard" },
        { key: "g2", def: character({ name: "G2" }), owner: P1, zone: "discard" },
        ...bank("greed", 10, P1)
      ]
    });
    activate(engine, P1, id("gr"), "resurrector-recur", { selected: { picked: [id("g1"), id("g2")] } });
    assert.equal(engine.state.cards[id("g1")].zone, "hand");
    assert.equal(engine.state.cards[id("g2")].zone, "hand");
    assert.equal(engine.state.cards[id("gr")].zone, "removed");
  });
});

describe("Seed 2 — Gus VanBaymaven", () => {
  test("takes control of a chosen location", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "gus", def: def("Gus VanBaymaven"), owner: P1, zone: "play" },
        { key: "loc", def: location({ name: "Loc" }), owner: P2, zone: "play" },
        ...bank("greed", 8, P1)
      ]
    });
    activate(engine, P1, id("gus"), "gus-bays", { selected: { loc: [id("loc")] } });
    assert.equal(engine.state.cards[id("loc")].controllerId, P1);
  });
});

describe("Seed 2 — Hidden Ruins", () => {
  test("deploys a revealed face-down location you control and draws", () => {
    const fdLoc = { ...location({ name: "FDLoc", cost: 0, structure: 4 }), id: "s2-ruins-fdloc" };
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "hr", def: def("Hidden Ruins"), owner: P1, zone: "hand" },
        { key: "fd", def: fdLoc, owner: P1, zone: "play", faceDown: true },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" },
        ...bank("greed", 6, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("hr"), { selected: { loc: [id("fd")] } });
    drain(engine, pc =>
      pc.kind === "deployForFree" ? { kind: "deployForFree", cardId: id("fd") } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("fd")].faceDown, false);
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1);
  });
});

describe("Seed 2 — Lodge Dock Florist", () => {
  test("grants every character an upkeep 'pay 1 or destroy this' ability", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ldf", def: def("Lodge Dock Florist"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" }
      ]
    });
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    // decline every pay -> the character is destroyed
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("c")].zone, "discard");
  });
});

describe("Seed 2 — Melty Cheese", () => {
  test("the attached character gains 2 life and cannot attack", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host", life: 3 }), owner: P1, zone: "play" },
        { key: "mc", def: def("Melty Cheese"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.equal(engine.getStat(id("host"), "life"), 5);
    assert.ok(engine.getRestrictions(id("host")).includes("cannotAttack"));
  });
});

describe("Seed 2 — Miraculous Regeneration", () => {
  test("one discard character re-enters face-down, the other returns to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mr", def: def("Miraculous Regeneration"), owner: P1, zone: "hand" },
        { key: "a", def: character({ name: "A" }), owner: P1, zone: "discard" },
        { key: "b", def: character({ name: "B" }), owner: P1, zone: "discard" },
        ...bank("greed", 8, P1)
      ]
    });
    play(engine, P1, id("mr"), { selected: { toPlay: [id("a")], toHand: [id("b")] } });
    assert.equal(engine.state.cards[id("a")].zone, "play");
    assert.equal(engine.state.cards[id("a")].faceDown, true);
    assert.equal(engine.state.cards[id("b")].zone, "hand");
  });
});

describe("Seed 2 — Overzealous Excavation", () => {
  test("mills the top 8 cards of your deck and draws 1", () => {
    const deckCards = Array.from({ length: 12 }, (_, i) => ({
      key: `dk${i}`,
      def: character({ name: `Dk${i}` }),
      owner: P1,
      zone: "deck" as const
    }));
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "oe", def: def("Overzealous Excavation"), owner: P1, zone: "hand" }, ...deckCards, ...bank("greed", 6, P1)]
    });
    const discBefore = engine.state.players[P1].discard.length;
    play(engine, P1, id("oe"), {});
    drain(engine, declineAll);
    assert.equal(engine.state.players[P1].discard.length, discBefore + 8 + 1); // 8 milled + Excavation itself
  });
});

describe("Seed 2 — Prophetic Assistant", () => {
  test("at end of turn, may draw the top card if it is a staple resource", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pa", def: def("Prophetic Assistant"), owner: P1, zone: "play" },
        { key: "top", def: cardDef("Seed 3", "Greed"), owner: P1, zone: "deck" },
        { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" }
      ]
    });
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    drain(engine, pc => (pc.kind === "mayPay" ? { kind: "mayPay", pay: true } : declineAll(pc)));
    assert.equal(engine.state.cards[id("top")].zone, "hand");
  });
});

describe("Seed 2 — Swinish Elder", () => {
  test("may pay 1 to attach an opponent's played resource to their faction", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "se", def: def("Swinish Elder"), owner: P1, zone: "play" },
        { key: "res", def: cardDef("Seed 3", "Rage"), owner: P2, zone: "hand" },
        ...bank("greed", 6, P1)
      ],
      activePlayerId: P2
    });
    engine.perform({
      type: "chooseDevelop",
      playerId: P2,
      choice: { type: "playResource", cards: [{ cardId: id("res"), faceDown: false }] }
    } as never);
    resolvePendingResponses(engine);
    drain(engine, pc => (pc.kind === "mayPay" ? { kind: "mayPay", pay: true } : declineAll(pc)));
    assert.equal(engine.state.cards[id("res")].attachedTo, engine.state.players[P2].factionId);
  });
});

describe("Seed 2 — The Poshernacle", () => {
  test("start of turn: faction gains influence and may draw", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "pn", def: def("The Poshernacle"), owner: P1, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" }
      ],
      activePlayerId: P2
    });
    const infBefore = engine.state.players[P1].influence;
    const handBefore = engine.state.players[P1].hand.length;
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    drain(engine, pc => (pc.kind === "mayPay" ? { kind: "mayPay", pay: true } : declineAll(pc)));
    assert.ok(engine.state.players[P1].influence > infBefore, "faction gained influence");
    assert.ok(engine.state.players[P1].hand.length > handBefore, "drew a card");
  });
});

describe("Seed 2 — Tiny Shiny", () => {
  test("reduces the next damage to the picked character by 2 and re-enters as a face-down resource", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ts", def: def("Tiny Shiny"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", life: 5 }), owner: P1, zone: "play" },
        { key: "zap", def: killTactic({ name: "Zap", behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 3 }] }] } }), owner: P1, zone: "hand" },
        ...bank("greed", 8, P1)
      ]
    });
    play(engine, P1, id("ts"), { selected: { t: [id("c")] } });
    assert.equal(engine.state.cards[id("ts")].zone, "play");
    assert.equal(engine.state.cards[id("ts")].faceDown, true);
    play(engine, P1, id("zap"), { selected: { t: [id("c")] } });
    assert.equal(engine.state.cards[id("c")].damage, 1); // 3 - 2
  });
});

// =====================================================================
// Elitism block
// =====================================================================

describe("Seed 2 — 31337!", () => {
  test("grants an extra [E][E][E][E] this turn and re-enters as a face-down resource", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "l", def: def("31337!"), owner: P1, zone: "hand" }, ...bank("elitism", 4, P1)]
    });
    const before = engine.getThresholds(P1).elitism ?? 0;
    play(engine, P1, id("l"), {});
    assert.equal((engine.getThresholds(P1).elitism ?? 0) - before, 4);
    assert.equal(engine.state.cards[id("l")].zone, "play");
    assert.equal(engine.state.cards[id("l")].faceDown, true);
  });
});

describe("Seed 2 — 3cc3n7r1c 73chn1c14n", () => {
  test("ASSIST restores another character you control and stops it attacking this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "t", def: def("3cc3n7r1c 73chn1c14n"), owner: P1, zone: "play" },
        { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play", depleted: true },
        ...bank("elitism", 6, P1)
      ]
    });
    activate(engine, P1, id("t"), "assist", { selected: { ally: [id("ally")] } });
    assert.equal(engine.state.cards[id("ally")].depleted, false);
    assert.ok(engine.getRestrictions(id("ally")).includes("cannotAttack"));
  });

  test("ASSIST cannot target itself", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "t", def: def("3cc3n7r1c 73chn1c14n"), owner: P1, zone: "play", depleted: true },
        ...bank("elitism", 6, P1)
      ]
    });
    assert.throws(() =>
      engine.perform({
        type: "activateAbility",
        playerId: P1,
        cardId: id("t"),
        abilityId: "assist",
        selected: { ally: [id("t")] }
      })
    );
  });
});

describe("Seed 2 — 3p1c D00dm4k3r", () => {
  test("the attached character gains [E]-count strength and life", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host", strength: 2, life: 2 }), owner: P1, zone: "play" },
        { key: "dm", def: def("3p1c D00dm4k3r"), owner: P1, zone: "play", attachedToKey: "host" },
        ...bank("elitism", 3, P1)
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), 5);
    assert.equal(engine.getStat(id("host"), "life"), 5);
  });
});

describe("Seed 2 — 4rm0r3d 31f", () => {
  test("loses 1 life per token", () => {
    const d = def("4rm0r3d 31f");
    const { engine, id } = buildGame({
      cards: [{ key: "e", def: d, owner: P1, zone: "play", counters: { token: 2 } }]
    });
    assert.equal(engine.getStat(id("e"), "life"), (d.life ?? 0) - 2);
  });

  test("FALL APART adds a token and makes a Micromajig", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "e", def: def("4rm0r3d 31f"), owner: P1, zone: "play" }, ...bank("elitism", 4, P1)]
    });
    activate(engine, P1, id("e"), "fall-apart");
    assert.equal(engine.state.cards[id("e")].counters.token, 1);
    const majigs = engine.state.players[P1].play.filter(c => engine.getDefinition(c).name === "Micromajig");
    assert.equal(majigs.length, 1);
  });
});

describe("Seed 2 — Accidental Invention", () => {
  test("deploys a revealed face-down item you control and draws a card", () => {
    const fdItem = { ...item({ name: "FDItem", cost: 0 }), id: "s2-ai-fditem" };
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ai", def: def("Accidental Invention"), owner: P1, zone: "hand" },
        { key: "fd", def: fdItem, owner: P1, zone: "play", faceDown: true },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" },
        ...bank("elitism", 4, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("ai"), { selected: { revealed: [id("fd")] } });
    drain(engine, pc =>
      pc.kind === "deployForFree" ? { kind: "deployForFree", cardId: id("fd") } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("fd")].faceDown, false);
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1);
  });
});

describe("Seed 2 — Braggadocian Aide", () => {
  test("at the start of an opponent's turn, may detach a resource from your faction", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "ba", def: def("Braggadocian Aide"), owner: P1, zone: "play" },
        { key: "ar", def: cardDef("Seed 3", "Rage"), owner: P1, zone: "play", attachedToKey: "__factionA" }
      ],
      activePlayerId: P1
    });
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    drain(engine, pc =>
      pc.kind === "selectTargets"
        ? { kind: "selectTargets", selected: { res: [id("ar")] } }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("ar")].attachedTo, undefined);
  });
});

describe("Seed 2 — Cantankerous Claywork", () => {
  test("has AGGRO", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "cc", def: def("Cantankerous Claywork"), owner: P1, zone: "play" }]
    });
    assert.ok(engine.getKeywords(id("cc")).includes("aggro"));
  });

  test("when it attacks, your other characters gain +1/+1 this turn", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "cc", def: def("Cantankerous Claywork"), owner: P1, zone: "play" },
        { key: "buddy", def: character({ name: "Buddy", strength: 2, life: 2, speed: 3 }), owner: P1, zone: "play" }
      ],
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("cc")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("buddy"), "strength"), 3);
    assert.equal(engine.getStat(id("buddy"), "life"), 3);
  });
});

describe("Seed 2 — Clay Node", () => {
  test("ETB tutors a 'node' subtype card to hand", () => {
    const nodeCard = { ...character({ name: "NodeGuy", subtype: ["node"] }), id: "s2-nodeguy" };
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cn", def: def("Clay Node"), owner: P1, zone: "hand" },
        { key: "nd", def: nodeCard, owner: P1, zone: "deck" },
        ...bank("elitism", 6, P1)
      ]
    });
    play(engine, P1, id("cn"), {});
    drain(engine, pc =>
      pc.kind === "selectTargets"
        ? { kind: "selectTargets", selected: { found: [id("nd")] } }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("nd")].zone, "hand");
  });
});

describe("Seed 2 — Cock Block", () => {
  test("terminates the ability it responds to", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "cb", def: def("Cock Block"), owner: P1, zone: "hand" },
        { key: "drawer", def: drawerChar(), owner: P2, zone: "play" },
        ...bank("elitism", 6, P1)
      ],
      activePlayerId: P2
    });
    const p2HandBefore = engine.state.players[P2].hand.length;
    engine.perform({ type: "activateAbility", playerId: P2, cardId: id("drawer"), abilityId: "draw1", selected: {}, variables: {} });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("cb"), selected: {} } as never);
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.players[P2].hand.length, p2HandBefore);
  });
});

describe("Seed 2 — Contrabulous Fabtraption", () => {
  test("RUNE OF ENHANCEMENT sacrifices itself to give a character +2/+2 this turn", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "cf", def: def("Contrabulous Fabtraption"), owner: P1, zone: "play" },
        { key: "c", def: character({ name: "C", strength: 2, life: 2 }), owner: P1, zone: "play" }
      ]
    });
    activate(engine, P1, id("cf"), "rune-of-enhancement", { selected: { ch: [id("c")] } });
    assert.equal(engine.state.cards[id("cf")].zone, "discard");
    assert.equal(engine.getStat(id("c"), "strength"), 4);
    assert.equal(engine.getStat(id("c"), "life"), 4);
  });
});

describe("Seed 2 — Enormous and Uncooperative Golem", () => {
  test("enters with X tokens and, while tokened, gains +5/+5", () => {
    const d = def("Enormous and Uncooperative Golem");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "g", def: d, owner: P1, zone: "hand" }, ...bank("elitism", 8, P1)]
    });
    play(engine, P1, id("g"), { variables: { x: 2 } });
    assert.equal(engine.state.cards[id("g")].counters.token, 2);
    assert.equal(engine.getStat(id("g"), "strength"), (d.strength ?? 0) + 5);
    assert.equal(engine.getStat(id("g"), "life"), (d.life ?? 0) + 5);
  });
});

describe("Seed 2 — G14n7 5p0rk D3f3n53", () => {
  test("IMPALE sacrifices itself to destroy an attacking character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "spork", def: def("G14n7 5p0rk D3f3n53"), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 2, life: 2, speed: 3 }), owner: P2, zone: "play" },
        ...bank("elitism", 6, P1)
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    engine.perform({ type: "passPriority", playerId: P2 });
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("spork"),
      abilityId: "impale",
      selected: { prey: [id("atk")] }
    });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("atk")].zone, "discard");
    assert.equal(engine.state.cards[id("spork")].zone, "discard");
  });
});

describe("Seed 2 — Gewgawed Gimcrack", () => {
  test("DO...SOMETHING destroys every character whose numeric cost equals its token count", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "gg", def: def("Gewgawed Gimcrack"), owner: P1, zone: "play", counters: { token: 3 } },
        { key: "c3", def: character({ name: "C3", cost: 3 }), owner: P2, zone: "play" },
        { key: "c2", def: character({ name: "C2", cost: 2 }), owner: P2, zone: "play" }
      ]
    });
    activate(engine, P1, id("gg"), "do-something");
    assert.equal(engine.state.cards[id("c3")].zone, "discard");
    assert.equal(engine.state.cards[id("c2")].zone, "play");
    assert.equal(engine.state.cards[id("gg")].zone, "discard");
  });
});

describe("Seed 2 — Golemizer", () => {
  test("the attached character loses 1 speed per token on it", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host", speed: 3 }), owner: P1, zone: "play", counters: { token: 2 } },
        { key: "gz", def: def("Golemizer"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.equal(engine.getStat(id("host"), "speed"), 1);
  });
});

describe("Seed 2 — Goloam", () => {
  test("gains +1/+1 per item in play", () => {
    const d = def("Goloam");
    const { engine, id } = buildGame({
      cards: [
        { key: "gl", def: d, owner: P1, zone: "play" },
        { key: "i1", def: item({ name: "I1" }), owner: P1, zone: "play" },
        { key: "i2", def: item({ name: "I2" }), owner: P2, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("gl"), "strength"), (d.strength ?? 0) + 2);
  });
});

describe("Seed 2 — Lab of Luxury", () => {
  test("INNOVATE: discard a resource -> tutor a location to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "lab", def: def("Lab of Luxury"), owner: P1, zone: "play" },
        { key: "pitch", def: cardDef("Seed 3", "Elitism"), owner: P1, zone: "hand" },
        { key: "loc", def: location({ name: "DeepLoc" }), owner: P1, zone: "deck" },
        ...bank("elitism", 6, P1)
      ]
    });
    activate(engine, P1, id("lab"), "innovate", { selected: { pitched: [id("pitch")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("loc")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("loc")].zone, "hand");
  });
});

describe("Seed 2 — Recyclable Golem", () => {
  test("with a token: -2/-2 and can block COVERT", () => {
    const d = def("Recyclable Golem");
    const { engine, id } = buildGame({
      cards: [{ key: "rg", def: d, owner: P1, zone: "play", counters: { token: 1 } }]
    });
    assert.equal(engine.getStat(id("rg"), "strength"), (d.strength ?? 0) - 2);
    assert.ok(engine.getKeywords(id("rg")).includes("canBlockCovert"));
  });

  test("with no token: dodges destruction by flipping face-down", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rg", def: def("Recyclable Golem"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P2, zone: "hand" },
        ...bank("rage", 4, P2)
      ],
      activePlayerId: P2
    });
    play(engine, P2, id("kill"), { selected: { t: [id("rg")] } });
    assert.equal(engine.state.cards[id("rg")].zone, "play");
    assert.equal(engine.state.cards[id("rg")].faceDown, true);
  });
});

describe("Seed 2 — Research Intern", () => {
  test("RESEARCH reduces your next numeric cost by 1", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ri", def: def("Research Intern"), owner: P1, zone: "play" },
        { key: "big", def: character({ name: "Big", cost: 4 }), owner: P1, zone: "hand" },
        ...bank("elitism", 8, P1)
      ]
    });
    activate(engine, P1, id("ri"), "research");
    assert.equal(engine.getCardPlayability(P1, id("big")).numericCost, 3);
  });
});

describe("Seed 2 — Rewarding Salvage", () => {
  test("returns up to 2 items from your discard pile to hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rs", def: def("Rewarding Salvage"), owner: P1, zone: "hand" },
        { key: "i1", def: item({ name: "I1" }), owner: P1, zone: "discard" },
        { key: "i2", def: item({ name: "I2" }), owner: P1, zone: "discard" },
        ...bank("elitism", 8, P1)
      ]
    });
    play(engine, P1, id("rs"), { selected: { haul: [id("i1"), id("i2")] } });
    assert.equal(engine.state.cards[id("i1")].zone, "hand");
    assert.equal(engine.state.cards[id("i2")].zone, "hand");
  });
});

describe("Seed 2 — Thorough Sanitization", () => {
  test("flips a chosen item face-down", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ts", def: def("Thorough Sanitization"), owner: P1, zone: "hand" },
        { key: "target", def: item({ name: "Target" }), owner: P2, zone: "play" },
        ...bank("elitism", 4, P1)
      ]
    });
    play(engine, P1, id("ts"), { selected: { grime: [id("target")] } });
    assert.equal(engine.state.cards[id("target")].faceDown, true);
  });
});

describe("Seed 2 — Time Traveler Tourist Trap", () => {
  test("ENSNARE pays 1 to add a token", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "tt", def: def("Time Traveler Tourist Trap"), owner: P1, zone: "play" }, ...bank("elitism", 4, P1)]
    });
    activate(engine, P1, id("tt"), "ensnare");
    assert.equal(engine.state.cards[id("tt")].counters.token, 1);
  });
});

// =====================================================================
// Deception block
// =====================================================================

describe("Seed 2 — Ass", () => {
  test("at end of your turn: steal one of the opponent's characters and hand Ass to them", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ass", def: def("Ass"), owner: P1, zone: "play" },
        { key: "oc", def: character({ name: "OppChar" }), owner: P2, zone: "play" }
      ]
    });
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("oc")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("oc")].controllerId, P1);
    assert.equal(engine.state.cards[id("ass")].controllerId, P2);
  });
});

describe("Seed 2 — Burly Assailment", () => {
  test("deploys a revealed face-down character you control and draws", () => {
    const fdChar = { ...character({ name: "FDChar", cost: 0 }), id: "s2-ba-fdchar" };
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ba", def: def("Burly Assailment"), owner: P1, zone: "hand" },
        { key: "fd", def: fdChar, owner: P1, zone: "play", faceDown: true },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" },
        ...bank("deception", 4, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("ba"), { selected: { rev: [id("fd")] } });
    drain(engine, pc =>
      pc.kind === "deployForFree" ? { kind: "deployForFree", cardId: id("fd") } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("fd")].faceDown, false);
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1);
  });
});

describe("Seed 2 — Delusive Strumpet", () => {
  test("has TACTICAL; GRACEFUL EXIT discards a card to flip itself face-down", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ds", def: def("Delusive Strumpet"), owner: P1, zone: "play" },
        { key: "toss", def: character({ name: "Toss" }), owner: P1, zone: "hand" }
      ]
    });
    assert.ok(engine.getKeywords(id("ds")).includes("tactical"));
    activate(engine, P1, id("ds"), "graceful-exit", { selected: { toss: [id("toss")] } });
    assert.equal(engine.state.cards[id("ds")].faceDown, true);
    assert.equal(engine.state.cards[id("toss")].zone, "discard");
  });
});

describe("Seed 2 — Drygulch", () => {
  test("removes the picked character if its life <= [D] you control", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "dg", def: def("Drygulch"), owner: P1, zone: "hand" },
        { key: "frail", def: character({ name: "Frail", life: 3 }), owner: P2, zone: "play" },
        ...bank("deception", 3, P1)
      ]
    });
    play(engine, P1, id("dg"), { selected: { c: [id("frail")] } });
    assert.equal(engine.state.cards[id("frail")].zone, "removed");
  });

  test("leaves a tougher character alone", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "dg", def: def("Drygulch"), owner: P1, zone: "hand" },
        { key: "tank", def: character({ name: "Tank", life: 6 }), owner: P2, zone: "play" },
        ...bank("deception", 3, P1)
      ]
    });
    play(engine, P1, id("dg"), { selected: { c: [id("tank")] } });
    assert.equal(engine.state.cards[id("tank")].zone, "play");
  });
});

describe("Seed 2 — Epicureous Mammajamma", () => {
  test("SLAP IT UP trades 1 strength for 1 life this turn", () => {
    const d = def("Epicureous Mammajamma");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "em", def: d, owner: P1, zone: "play" }, ...bank("deception", 4, P1)]
    });
    activate(engine, P1, id("em"), "slap-it-up");
    assert.equal(engine.getStat(id("em"), "strength"), (d.strength ?? 0) - 1);
    assert.equal(engine.getStat(id("em"), "life"), (d.life ?? 0) + 1);
  });
});

describe("Seed 2 — Fired Hand", () => {
  test("would-be destruction is replaced with a face-down flip", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "fh", def: def("Fired Hand"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P2, zone: "hand" },
        ...bank("rage", 4, P2)
      ],
      activePlayerId: P2
    });
    play(engine, P2, id("kill"), { selected: { t: [id("fh")] } });
    assert.equal(engine.state.cards[id("fh")].zone, "play");
    assert.equal(engine.state.cards[id("fh")].faceDown, true);
  });
});

describe("Seed 2 — I Drink Your Milkshake!", () => {
  test("digs a card out of an opponent's deck into the void", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ms", def: def("I Drink Your Milkshake!"), owner: P1, zone: "hand" },
        { key: "od", def: character({ name: "OppDeck" }), owner: P2, zone: "deck" },
        ...bank("deception", 8, P1)
      ]
    });
    play(engine, P1, id("ms"), { selected: { dig: [id("od")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("od")].zone, "void");
  });
});

describe("Seed 2 — Lucky Bastard", () => {
  test("ETB draws a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "lb", def: def("Lucky Bastard"), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" },
        ...bank("deception", 10, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("lb"), {});
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1);
  });
});

describe("Seed 2 — Mistaken Identity", () => {
  test("cannot be deployed outside a response to a card/ability that picked a character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mi", def: def("Mistaken Identity"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" },
        ...bank("deception", 6, P1)
      ]
    });
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("mi"), selected: { other: [id("c")] } } as never)
    );
  });
});

describe("Seed 2 — Muscle Tribe of Danger and Excellence", () => {
  test("gains +1 strength and COVERT when a [D] source enters under your control", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mt", def: def("Muscle Tribe of Danger and Excellence"), owner: P1, zone: "play" },
        { key: "dres", def: cardDef("Seed 3", "Deception"), owner: P1, zone: "hand" }
      ]
    });
    const d = def("Muscle Tribe of Danger and Excellence");
    engine.perform({
      type: "chooseDevelop",
      playerId: P1,
      choice: { type: "playResource", cards: [{ cardId: id("dres"), faceDown: false }] }
    } as never);
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.getStat(id("mt"), "strength"), (d.strength ?? 0) + 1);
    assert.ok(engine.getKeywords(id("mt")).includes("covert"));
  });
});

describe("Seed 2 — Mustache Aficionado", () => {
  test("MUSTACHE SHOWDOWN resolves and depletes the card", () => {
    const mkDeck = (p: typeof P1) =>
      Array.from({ length: 5 }, (_, i) => ({
        key: `ma-${p}-${i}`,
        def: character({ name: `MA${p}${i}`, cost: i }),
        owner: p,
        zone: "deck" as const
      }));
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ma", def: def("Mustache Aficionado"), owner: P1, zone: "play" },
        ...mkDeck(P1),
        ...mkDeck(P2)
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("ma"), abilityId: "mustache-showdown", selected: {}, variables: {} });
    resolvePendingResponses(engine);
    drain(engine, pc => {
      if (pc.kind === "partitionCards") {
        const ids = (pc.cardIds as string[] | undefined) ?? [];
        return { kind: "partitionCards", piles: [[ids[0]], ids.slice(1)] };
      }
      if (pc.kind === "pickPile") return { kind: "pickPile", index: 0 };
      if (pc.kind === "takeFromPile") return { kind: "takeFromPile", cardIds: [] };
      return declineAll(pc);
    });
    assert.equal(engine.state.cards[id("ma")].depleted, true);
  });
});

describe("Seed 2 — Party Clowns", () => {
  test("at start of your turn, may pay 1 to drop another copy into play", () => {
    const copy = { ...character({ name: "Party Clowns", cost: 4 }), id: "s2-pc-copy" };
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "pc", def: def("Party Clowns"), owner: P1, zone: "play" },
        { key: "copy", def: copy, owner: P1, zone: "deck" },
        ...bank("deception", 6, P1)
      ],
      activePlayerId: P2
    });
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    drain(engine, pc => {
      if (pc.kind === "mayPay") return { kind: "mayPay", pay: true };
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [id("copy")] };
      return declineAll(pc);
    });
    assert.equal(engine.state.cards[id("copy")].zone, "play");
  });
});

describe("Seed 2 — Peculate", () => {
  test("puts a character from an opponent's discard into play under your control for its cost", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pec", def: def("Peculate"), owner: P1, zone: "hand" },
        { key: "corpse", def: character({ name: "Corpse", cost: 3 }), owner: P2, zone: "discard" },
        ...bank("deception", 10, P1)
      ]
    });
    play(engine, P1, id("pec"), { selected: { loot: [id("corpse")] } });
    assert.equal(engine.state.cards[id("corpse")].zone, "play");
    assert.equal(engine.state.cards[id("corpse")].controllerId, P1);
  });

  test("a tactic in the opponent's discard is not a legal target", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pec", def: def("Peculate"), owner: P1, zone: "hand" },
        { key: "tac", def: tactic({ name: "OldTac" }), owner: P2, zone: "discard" },
        ...bank("deception", 10, P1)
      ]
    });
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("pec"), selected: { loot: [id("tac")] } } as never)
    );
  });
});

describe("Seed 2 — Resistance Fighter", () => {
  test("provides [D]; gains +2/+2/+1 while you control a character you don't own", () => {
    const d = def("Resistance Fighter");
    const { engine, id } = buildGame({
      cards: [
        { key: "rf", def: d, owner: P1, zone: "play" },
        { key: "borrowed", def: character({ name: "Borrowed" }), owner: P2, controller: P1, zone: "play" }
      ]
    });
    assert.equal(engine.getThresholds(P1).deception ?? 0, 1);
    assert.equal(engine.getStat(id("rf"), "strength"), (d.strength ?? 0) + 2);
  });
});

describe("Seed 2 — Rosy Palmer, and Her Five Friends", () => {
  test("on death, may steal a character from the top 5 of an opponent's deck", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rosy", def: def("Rosy Palmer, and Her Five Friends"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        ...Array.from({ length: 5 }, (_, i) => ({ key: `od${i}`, def: character({ name: `OD${i}` }), owner: P2, zone: "deck" as const })),
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("kill"), { selected: { t: [id("rosy")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("od0")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("od0")].zone, "play");
    assert.equal(engine.state.cards[id("od0")].controllerId, P1);
  });
});

describe("Seed 2 — Roundalicious Breasticles", () => {
  test("JIGGLE JIGGLE adds a token; TANTALIZE trades itself to steal a cheap character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rb", def: def("Roundalicious Breasticles"), owner: P1, zone: "play" },
        ...bank("deception", 10, P1)
      ]
    });
    activate(engine, P1, id("rb"), "jiggle-jiggle");
    assert.equal(engine.state.cards[id("rb")].counters.token, 1);

    const g2 = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "rb", def: def("Roundalicious Breasticles"), owner: P1, zone: "play", counters: { token: 3 } },
        { key: "steal", def: character({ name: "Steal", cost: 2 }), owner: P2, zone: "play" },
        ...bank("deception", 6, P1)
      ]
    });
    activate(g2.engine, P1, g2.id("rb"), "tantalize", { selected: { c: [g2.id("steal")] } });
    assert.equal(g2.engine.state.cards[g2.id("steal")].controllerId, P1);
    assert.equal(g2.engine.state.cards[g2.id("rb")].zone, "discard");
  });
});

describe("Seed 2 — Rusty Pickaxe", () => {
  test("the attached character gains +1/+1", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host", strength: 2, life: 2 }), owner: P1, zone: "play" },
        { key: "rp", def: def("Rusty Pickaxe"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), 3);
    assert.equal(engine.getStat(id("host"), "life"), 3);
  });
});

describe("Seed 2 — Smothering Corpulence", () => {
  test("targets an opponent's character and draws a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sc", def: def("Smothering Corpulence"), owner: P1, zone: "hand" },
        { key: "oc", def: character({ name: "OC", life: 8 }), owner: P2, zone: "play" },
        { key: "md", def: character({ name: "MD", cost: 2 }), owner: P1, zone: "deck" },
        { key: "md2", def: character({ name: "MD2", cost: 2 }), owner: P1, zone: "deck" },
        { key: "md3", def: character({ name: "MD3", cost: 2 }), owner: P1, zone: "deck" },
        { key: "od", def: character({ name: "OD", cost: 5 }), owner: P2, zone: "deck" },
        { key: "od2", def: character({ name: "OD2", cost: 5 }), owner: P2, zone: "deck" },
        ...bank("deception", 8, P1)
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;
    play(engine, P1, id("sc"), { selected: { c: [id("oc")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1);
  });
});

describe("Seed 2 — Sprint", () => {
  test("gives a character +1 speed this turn and re-enters as a face-down resource", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sp", def: def("Sprint"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", speed: 3 }), owner: P1, zone: "play" },
        ...bank("deception", 6, P1)
      ]
    });
    play(engine, P1, id("sp"), { selected: { c: [id("c")] } });
    assert.equal(engine.getStat(id("c"), "speed"), 4);
    assert.equal(engine.state.cards[id("sp")].zone, "play");
    assert.equal(engine.state.cards[id("sp")].faceDown, true);
  });
});

describe("Seed 2 — Uncontrollable Jalopy", () => {
  test("gains 1 speed per token; unblockable at 5 tokens", () => {
    const d = def("Uncontrollable Jalopy");
    const a = buildGame({ cards: [{ key: "j", def: d, owner: P1, zone: "play", counters: { token: 3 } }] });
    assert.equal(a.engine.getStat(a.id("j"), "speed"), (d.speed ?? 0) + 3);

    const b = buildGame({ cards: [{ key: "j", def: d, owner: P1, zone: "play", counters: { token: 5 } }] });
    assert.ok(b.engine.getKeywords(b.id("j")).includes("cannotBeBlocked"));
  });
});

describe("Seed 2 — Vast Mastabatorium", () => {
  test("YOU KNOW YOU WANT TO draws a card at the cost of 1 faction influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "vm", def: def("Vast Mastabatorium"), owner: P1, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" },
        ...bank("deception", 6, P1)
      ]
    });
    const inf = engine.state.players[P1].influence;
    const handBefore = engine.state.players[P1].hand.length;
    activate(engine, P1, id("vm"), "you-know-you-want-to");
    drain(engine, declineAll);
    assert.equal(engine.state.players[P1].hand.length, handBefore + 1);
    assert.equal(engine.state.players[P1].influence, inf - 1);
  });
});

describe("Seed 2 — Crests (PROVIDES [X][X])", () => {
  for (const [name, icon] of [
    ["Crest of Deception", "deception"],
    ["Crest of Elitism", "elitism"],
    ["Crest of Greed", "greed"],
    ["Crest of Obsession", "obsession"],
    ["Crest of Rage", "rage"]
  ] as const) {
    test(`${name} provides two [${icon}]`, () => {
      const { engine } = buildGame({
        cards: [{ key: "crest", def: def(name), owner: P1, zone: "play" }]
      });
      assert.equal(engine.getThresholds(P1)[icon] ?? 0, 2);
    });
  }

  test("Crest of Elitism spawns a Micromajig when an [E] source enters", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "crest", def: def("Crest of Elitism"), owner: P1, zone: "play" },
        { key: "eres", def: cardDef("Seed 3", "Elitism"), owner: P1, zone: "hand" }
      ]
    });
    engine.perform({
      type: "chooseDevelop",
      playerId: P1,
      choice: { type: "playResource", cards: [{ cardId: id("eres"), faceDown: false }] }
    } as never);
    resolvePendingResponses(engine);
    drain(engine, pc => (pc.kind === "mayPay" ? { kind: "mayPay", pay: true } : declineAll(pc)));
    const majigs = engine.state.players[P1].play.filter(c => engine.getDefinition(c).name === "Micromajig");
    assert.equal(majigs.length, 1);
  });
});

// =====================================================================
// Rage block
// =====================================================================

describe("Seed 2 — A Blazing Zero", () => {
  test("terminates a responded-to tactic and re-plays it as a face-down resource for its owner", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "bz", def: def("A Blazing Zero"), owner: P1, zone: "hand" },
        { key: "opp", def: tactic({ name: "OppTac", cost: 1 }), owner: P2, zone: "hand" },
        ...bank("rage", 8, P1),
        ...bank("greed", 4, P2)
      ],
      activePlayerId: P2
    });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("opp"), selected: {} } as never);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("bz"), selected: {} } as never);
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("opp")].zone, "play");
    assert.equal(engine.state.cards[id("opp")].faceDown, true);
    assert.equal(engine.state.cards[id("opp")].controllerId, P2);
  });
});

describe("Seed 2 — Acidic Phlegm", () => {
  test("inflicts 1 damage to every character", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ap", def: def("Acidic Phlegm"), owner: P1, zone: "hand" },
        { key: "a", def: character({ name: "A", life: 3 }), owner: P1, zone: "play" },
        { key: "b", def: character({ name: "B", life: 3 }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("ap"), {});
    assert.equal(engine.state.cards[id("a")].damage, 1);
    assert.equal(engine.state.cards[id("b")].damage, 1);
  });
});

describe("Seed 2 — Aroused Stiffbone", () => {
  test("costs nothing extra to deploy while you control [R]x7", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "as", def: def("Aroused Stiffbone"), owner: P1, zone: "hand" }, ...bank("rage", 7, P1)]
    });
    play(engine, P1, id("as"), {});
    assert.equal(engine.state.cards[id("as")].zone, "play");
  });
});

describe("Seed 2 — Ascendant Madcap", () => {
  test("gains a token (and +1 strength) when a [R] source enters under your control", () => {
    const d = def("Ascendant Madcap");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "am", def: d, owner: P1, zone: "play" },
        { key: "rres", def: cardDef("Seed 3", "Rage"), owner: P1, zone: "hand" }
      ]
    });
    engine.perform({
      type: "chooseDevelop",
      playerId: P1,
      choice: { type: "playResource", cards: [{ cardId: id("rres"), faceDown: false }] }
    } as never);
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("am")].counters.token, 1);
    assert.equal(engine.getStat(id("am"), "strength"), (d.strength ?? 0) + 1);
  });
});

describe("Seed 2 — Athalamund Mangod, The Iron Fist", () => {
  test("PUNCH deals the victim's strength to itself and twice its own strength to the victim", () => {
    const d = def("Athalamund Mangod, The Iron Fist");
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "at", def: d, owner: P1, zone: "play" },
        { key: "v", def: character({ name: "V", strength: 2, life: 20 }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    activate(engine, P1, id("at"), "punch", { selected: { victim: [id("v")] } });
    assert.equal(engine.state.cards[id("at")].damage, 2); // victim strength
    assert.equal(engine.state.cards[id("v")].damage, 2 * (d.strength ?? 0));
  });
});

describe("Seed 2 — Barrier of Benevolence", () => {
  test("pays X+X to give up to 2 characters +X/+X this turn", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "bb", def: def("Barrier of Benevolence"), owner: P1, zone: "hand" },
        { key: "a", def: character({ name: "A", strength: 1, life: 1 }), owner: P1, zone: "play" },
        { key: "b", def: character({ name: "B", strength: 1, life: 1 }), owner: P1, zone: "play" },
        ...bank("rage", 10, P1)
      ]
    });
    play(engine, P1, id("bb"), { variables: { x: 2 }, selected: { picked: [id("a"), id("b")] } });
    assert.equal(engine.getStat(id("a"), "strength"), 3);
    assert.equal(engine.getStat(id("b"), "life"), 3);
  });
});

describe("Seed 2 — Conscientious Objector", () => {
  test("cannot attack or block while its anchor location is in play", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "co", def: def("Conscientious Objector"), owner: P1, zone: "hand" },
        { key: "loc", def: location({ name: "Anchor" }), owner: P1, zone: "play" },
        ...bank("rage", 6, P1)
      ]
    });
    play(engine, P1, id("co"), { selected: { anchor: [id("loc")] } });
    assert.ok(engine.getRestrictions(id("co")).includes("cannotAttack"));
    assert.ok(engine.getRestrictions(id("co")).includes("cannotBlock"));
  });
});

describe("Seed 2 — Dark Awakening", () => {
  test("deploys a non-resource card from your discard and draws", () => {
    const corpse = {
      ...character({ name: "Corpse", cost: 0, behavior: { abilities: [] } }),
      id: "s2-da-corpse"
    };
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "da", def: def("Dark Awakening"), owner: P1, zone: "hand" },
        { key: "c", def: corpse, owner: P1, zone: "discard" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" },
        ...bank("rage", 8, P1)
      ]
    });
    play(engine, P1, id("da"), { selected: { pick: [id("c")] } });
    drain(engine, pc =>
      pc.kind === "deployForFree" ? { kind: "deployForFree", cardId: id("c") } : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("c")].zone, "play");
  });
});

describe("Seed 2 — Dying Hero", () => {
  test("if depleted at end of your turn, takes 1 damage", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "dh", def: def("Dying Hero"), owner: P1, zone: "play", depleted: true }]
    });
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("dh")].zone, "discard"); // life 1, took 1 -> dies
  });
});

describe("Seed 2 — Embittered Cadet", () => {
  test("provides [R]", () => {
    const { engine } = buildGame({
      cards: [{ key: "ec", def: def("Embittered Cadet"), owner: P1, zone: "play" }]
    });
    assert.equal(engine.getThresholds(P1).rage ?? 0, 1);
  });
});

describe("Seed 2 — Epic Smackdown", () => {
  test("sacrifice X of your characters; the opponent then loses X of theirs; draw a card", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "es", def: def("Epic Smackdown"), owner: P1, zone: "hand" },
        { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
        { key: "o1", def: character({ name: "O1" }), owner: P2, zone: "play" },
        { key: "o2", def: character({ name: "O2" }), owner: P2, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" },
        ...bank("rage", 8, P1)
      ]
    });
    play(engine, P1, id("es"), { variables: { x: 1 }, selected: { sacX: [id("mine")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [id("o1")] }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("mine")].zone, "discard");
    assert.equal(engine.state.cards[id("o1")].zone, "discard");
    assert.equal(engine.state.cards[id("o2")].zone, "play");
  });
});

describe("Seed 2 — Implosive Explosion", () => {
  test("destroys a face-down resource and deals its numeric cost as damage to a character", () => {
    const priceyRes = { ...resourceCard({ name: "PriceyRes", cost: 3 }), id: "s2-ie-res" };
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ie", def: def("Implosive Explosion"), owner: P1, zone: "hand" },
        { key: "fd", def: priceyRes, owner: P1, zone: "play", faceDown: true },
        { key: "v", def: character({ name: "V", life: 10 }), owner: P2, zone: "play" },
        ...bank("rage", 8, P1)
      ]
    });
    play(engine, P1, id("ie"), { selected: { fdres: [id("fd")], victim: [id("v")] } });
    assert.equal(engine.state.cards[id("fd")].zone, "discard");
    assert.equal(engine.state.cards[id("v")].damage, 3);
  });
});

describe("Seed 2 — Midget Mine", () => {
  test("AMBUSH deals 2 to an attacking character and flips itself face-down", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mm", def: def("Midget Mine"), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 2, life: 5, speed: 3 }), owner: P2, zone: "play" },
        ...bank("rage", 6, P1)
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    engine.perform({ type: "passPriority", playerId: P2 });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("mm"), abilityId: "ambush", selected: { atk: [id("atk")] }, variables: {} });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("atk")].damage, 2);
    assert.equal(engine.state.cards[id("mm")].faceDown, true);
  });
});

describe("Seed 2 — Necromantic Healer", () => {
  test("battle damage to a character sharing its party is reduced by 1", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "nh", def: def("Necromantic Healer"), owner: P1, zone: "play" },
        { key: "blk", def: character({ name: "Blk", strength: 1, life: 5, speed: 1 }), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 3, life: 3, speed: 3 }), owner: P2, zone: "play" }
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("nh"), id("blk")] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    // the attacker's 3 damage lands on one blocker, reduced by 1 by the Healer's ward
    const dealt = (engine.state.cards[id("nh")].damage ?? 0) + (engine.state.cards[id("blk")].damage ?? 0);
    assert.equal(dealt, 2);
  });
});

describe("Seed 2 — Padamose, Emperor of Marduun", () => {
  test("aura: your 'sword of great justice' +1/+1; opponent's 'mau' -1/-1", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "pad", def: def("Padamose, Emperor of Marduun"), owner: P1, zone: "play" },
        { key: "sword", def: character({ name: "Sword", strength: 2, life: 2, subtype: ["sword of great justice"] }), owner: P1, zone: "play" },
        { key: "mau", def: character({ name: "Mau", strength: 3, life: 3, subtype: ["mau"] }), owner: P2, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("sword"), "strength"), 3);
    assert.equal(engine.getStat(id("mau"), "strength"), 2);
  });
});

describe("Seed 2 — Plunging Shriever", () => {
  test("ETB: may destroy an item and lose 2 influence", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ps", def: def("Plunging Shriever"), owner: P1, zone: "hand" },
        { key: "it", def: item({ name: "Trinket" }), owner: P2, zone: "play" },
        ...bank("rage", 8, P1)
      ]
    });
    const inf = engine.state.players[P1].influence;
    play(engine, P1, id("ps"), {});
    drain(engine, pc =>
      pc.kind === "selectTargets"
        ? { kind: "selectTargets", selected: { itm: [id("it")] } }
        : declineAll(pc)
    );
    assert.equal(engine.state.cards[id("it")].zone, "discard");
    assert.equal(engine.state.players[P1].influence, inf - 2);
  });
});

describe("Seed 2 — Spiky Pumpkin", () => {
  test("enters play with 3 tokens", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "sp", def: def("Spiky Pumpkin"), owner: P1, zone: "hand" }, ...bank("rage", 8, P1)]
    });
    play(engine, P1, id("sp"), {});
    assert.equal(engine.state.cards[id("sp")].counters.token, 3);
  });
});

describe("Seed 2 — Spry Archer", () => {
  test("when it attacks, inflicts 1 damage to the opposing faction", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "sa", def: def("Spry Archer"), owner: P1, zone: "play" }],
      turn: 2
    });
    const inf = engine.state.players[P2].influence;
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("sa")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P2].influence, inf - 1);
  });
});

describe("Seed 2 — Surplus Soldier", () => {
  test("would-be destruction is replaced with a face-down flip", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ss", def: def("Surplus Soldier"), owner: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P2, zone: "hand" },
        ...bank("rage", 4, P2)
      ],
      activePlayerId: P2
    });
    play(engine, P2, id("kill"), { selected: { t: [id("ss")] } });
    assert.equal(engine.state.cards[id("ss")].zone, "play");
    assert.equal(engine.state.cards[id("ss")].faceDown, true);
  });
});

describe("Seed 2 — The Emperor Barduse", () => {
  test("aura: your other 'dragon' characters gain +1/+1", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "eb", def: def("The Emperor Barduse"), owner: P1, zone: "play" },
        { key: "drag", def: character({ name: "Drake", strength: 2, life: 2, subtype: ["dragon"] }), owner: P1, zone: "play" }
      ]
    });
    assert.equal(engine.getStat(id("drag"), "strength"), 3);
    assert.equal(engine.getStat(id("drag"), "life"), 3);
  });
});

describe("Seed 2 — Vorpal Sword", () => {
  test("the attached character gains +2 strength and +1 life", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host", strength: 2, life: 2 }), owner: P1, zone: "play" },
        { key: "vs", def: def("Vorpal Sword"), owner: P1, zone: "play", attachedToKey: "host" }
      ]
    });
    assert.equal(engine.getStat(id("host"), "strength"), 4);
    assert.equal(engine.getStat(id("host"), "life"), 3);
  });
});
