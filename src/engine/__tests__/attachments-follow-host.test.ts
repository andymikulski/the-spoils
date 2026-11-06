// CR §301.4 / §301.4a / §301.4b: cards attached to a target leave play the
// same way it does. Flipping the host face-down flips its attachments
// face-down too (user ruling) rather than destroying them.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGame,
  cardDef,
  developFaction,
  bank,
  character,
  item,
  killTactic,
  play,
  resolvePendingResponses,
  P1,
  P2
} from "./per-card/_harness.js";

type Engine = ReturnType<typeof buildGame>["engine"];

function drain(engine: Engine, answerFor: (pc: { kind: string; [k: string]: unknown }) => unknown, budget = 40): void {
  let n = 0;
  while (engine.state.pendingChoice && n++ < budget) {
    const pc = engine.state.pendingChoice as { kind: string; playerId: string };
    engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: answerFor(pc) } as never);
    resolvePendingResponses(engine);
  }
}

const resourcesFaceDown = (engine: Engine, owner: string) =>
  engine.state.players[owner].play.filter(cid => engine.state.cards[cid].faceDown);

describe("attachments follow a flipped host (CR §301.4)", () => {
  test("Contractual Execution flips the host and its attached item face-down, not destroying the item", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ce", def: cardDef("Shade of the Devoured Emperor", "Contractual Execution"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P2, zone: "play" },
        { key: "gear", def: item({ name: "Gear", attachTo: "character" }), owner: P2, zone: "play", attachedToKey: "c" },
        ...bank("greed", 8, P1),
        ...bank("rage", 4, P2)
      ]
    });
    play(engine, P1, id("ce"), { selected: { ch: [id("c")] } });
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [engine.state.players[P2].play.find(x => engine.getDefinition(x).type === "resource")!] }
        : { kind: pc.kind, pay: false }
    );
    const host = engine.state.cards[id("c")];
    const gear = engine.state.cards[id("gear")];
    assert.equal(host.faceDown, true);
    assert.equal(gear.zone, "play", "the attachment stays in play");
    assert.equal(gear.faceDown, true, "and is flipped face-down with its host");
    assert.equal(gear.attachedTo, undefined);
  });

  test("Node in a Box's destroy replacement flips Luteoderm Prototype too, and Luteoderm still searches", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        { key: "nb", def: cardDef("Holy Heist", "Node in a Box"), owner: P1, zone: "play" },
        { key: "lute", def: cardDef("1st Edition", "Luteoderm Prototype"), owner: P1, zone: "play", attachedToKey: "nb" },
        { key: "target", def: character({ name: "Fetch" }), owner: P1, zone: "deck" },
        ...bank("elitism", 4, P1)
      ]
    });
    const faceDownBefore = resourcesFaceDown(engine, P1).length;
    play(engine, P1, id("kill"), { selected: { t: [id("nb")] } });
    drain(engine, pc => {
      if (pc.kind === "replacementChoice") return { kind: "replacementChoice", apply: true };
      if (pc.kind === "mayPay") return { kind: "mayPay", pay: true };
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [id("target")] };
      return { kind: pc.kind };
    });
    assert.equal(engine.state.cards[id("nb")].faceDown, true, "Node in a Box flipped instead of dying");
    assert.equal(engine.state.cards[id("lute")].zone, "play");
    assert.equal(engine.state.cards[id("lute")].faceDown, true, "Luteoderm followed it face-down");
    assert.equal(resourcesFaceDown(engine, P1).length - faceDownBefore, 2, "two face-down resources result");
    assert.equal(engine.state.cards[id("target")].zone, "hand", "Luteoderm's leaves-play search still fires");
  });
});

describe("attachments follow a host that leaves play (CR §301.4a)", () => {
  test("a destroyed host takes its attachment to the discard pile", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" },
        { key: "gear", def: item({ name: "Gear", attachTo: "character" }), owner: P1, zone: "play", attachedToKey: "c" }
      ]
    });
    play(engine, P1, id("kill"), { selected: { t: [id("c")] } });
    drain(engine, pc => ({ kind: pc.kind }));
    assert.equal(engine.state.cards[id("c")].zone, "discard");
    assert.equal(engine.state.cards[id("gear")].zone, "discard");
  });
});
