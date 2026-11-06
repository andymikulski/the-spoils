// Clause tests — Seed Saga 07, part 1 (groups 1-6, missing clauses).
// Juggernauts · Master Mud Whisperer · Mountainous Golem · Mud Prison · Mud Whisperer Wannabe · Multi-Attachment Man
import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  bank,
  character,
  developFaction,
  item,
  P1,
  P2,
  play,
  resolvePendingResponses,
  tactic,
  volition
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, clauseMismatch, declineAll, drain, printing, refused, type PendingChoiceLike, flipUpNow } from "./_clause.js";
import { declareAttackBy, declareAttackOpenWindow, finishBattle } from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { endTurn } from "./_turn.js";

const JUG = "3e746f7c-0da4-46ca-adcc-721f87bba463"; // Juggernauts
const MMW = "d105de07-198b-4f0d-a8e6-681f0afb9e61"; // Master Mud Whisperer
const GOLEM = "fe48adc4-e74d-46ce-9b4c-c94ff00f932b"; // Mountainous Golem
const PRISON = "73aa24ca-a9d9-480b-a83e-efa6571a5307"; // Mud Prison
const WANNABE = "5b6d2e39-2f38-4099-95d1-eed5ee298c0e"; // Mud Whisperer Wannabe
const MAM = "62fd5672-18f8-47db-8cff-a9f0363ca04c"; // Multi-Attachment Man

const FACTION_A = "__factionA";
const fdRes = (key: string, owner = P1, spent = false): CardPlacement => ({
  ...volition(1, owner)[0],
  key,
  ...(spent ? { attachedToKey: owner === P1 ? FACTION_A : "__factionB" } : {})
});
const spentBank = (icon: "rage" | "elitism", n: number, owner = P1): CardPlacement[] =>
  bank(icon, n, owner).map((p) => ({ ...p, attachedToKey: owner === P1 ? FACTION_A : "__factionB" }));
const handOf = (e: { state: { players: Record<string, { hand: string[] }> } }, p: string) => e.state.players[p].hand;
const deckOf = (e: { state: { players: Record<string, { deck: string[] }> } }, p: string) => e.state.players[p].deck;
const accept =
  (target: string[] = []) =>
  (pc: PendingChoiceLike): unknown => {
    switch (pc.kind) {
      case "mayPay":
        return { kind: "mayPay", pay: true };
      case "chooserSelectsTarget":
        return { kind: "chooserSelectsTarget", selected: target };
      case "chooserSelectsOption":
        return { kind: "chooserSelectsOption", index: 1 };
      default:
        return declineAll(pc);
    }
  };
const endTurnOf = (engine: Parameters<typeof resolvePendingResponses>[0], p: string) => {
  endTurn(engine, p);
};
const deckPad = (prefix: string, owner: string, n = 5): CardPlacement[] => fillers(prefix, n, owner, "deck");

// A generic opponent "thief" (takeControl) and "mover" (moveCard to a zone) for the Golem, owned by P2.
const thiefDef = (duration?: unknown) =>
  item({
    name: "Thief",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "steal",
          type: "activated",
          costs: [],
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller", ...(duration ? { duration } : {}) }]
        }
      ]
    }
  } as never);
const moverDef = (zone: string, to: string, type?: string) =>
  item({
    name: "Mover",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "mv",
          type: "activated",
          costs: [],
          targets: [{ id: "t", selector: { zone, ...(type ? { type } : {}) }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to }]
        }
      ]
    }
  } as never);
const killerDef = () =>
  item({
    name: "Killer",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "kill",
          type: "activated",
          costs: [],
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  } as never);
const massKillDef = () =>
  item({
    name: "MassKill",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "mass",
          type: "activated",
          costs: [],
          effects: [
            {
              type: "forEach",
              selector: { zone: "play", type: "character" },
              effects: [{ type: "destroy", target: { type: "selected", id: "__candidate" } }]
            }
          ]
        }
      ]
    }
  } as never);

// =====================================================================================================
// JUGGERNAUTS — character · gearsmith · vehicle · cost 6 · [E] · 4/1/4
// =====================================================================================================
type JugOpts = { elit?: number; rage?: number; crew?: number; extra?: CardPlacement[]; random?: () => number };
const jugBoard = (o: JugOpts = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "j", def: printing(JUG), owner: P1, zone: "hand" },
      ...bank("elitism", o.elit ?? 6, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...Array.from({ length: o.crew ?? 0 }, (_, i): CardPlacement => ({ key: `c${i}`, def: character({ name: `Crew${i}`, strength: 1, life: 2 }), owner: P1, zone: "play" })),
      ...(o.extra ?? [])
    ],
    turn: 2,
    random: o.random ?? (() => 0.5)
  });

clause(JUG, "0:extraCost", "printed card: character, gearsmith, vehicle, stats 4 / 1 / 4 once in play", () => {
  const def = printing(JUG);
  assert.equal(def.type, "character");
  assert.equal(def.trade, "gearsmith");
  assert.deepEqual(def.subtype, ["vehicle"]);
  assert.equal(def.cost, 6);
  assert.equal(def.threshold, "e");
  const { engine, id } = jugBoard();
  play(engine, P1, id("j"));
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("j")), "play");
  assert.equal(engine.getStat(id("j"), "strength"), 4);
  assert.equal(engine.getStat(id("j"), "speed"), 1);
  assert.equal(engine.getStat(id("j"), "life"), 4);
});

clause(JUG, "0:extraCost", "cost 6 [E]: exactly 6 deploys; 5 is refused; 6 without an [E] icon is refused; 5 [E] + 1 other deploys", () => {
  const ok = jugBoard({ elit: 6 });
  play(ok.engine, P1, ok.id("j"));
  drain(ok.engine, declineAll);
  assert.equal(zoneOf(ok.engine, ok.id("j")), "play");
  assert.equal(readyResources(ok.engine, P1), 0, "paid exactly 6");

  const short = jugBoard({ elit: 5 });
  refused(() => play(short.engine, P1, short.id("j")), "5 resources for a cost of 6");
  assert.equal(zoneOf(short.engine, short.id("j")), "hand");

  const noIcon = jugBoard({ elit: 0, rage: 6 });
  refused(() => play(noIcon.engine, P1, noIcon.id("j")), "6 resources but no [E] icon");
  assert.equal(zoneOf(noIcon.engine, noIcon.id("j")), "hand");

  const mixed = jugBoard({ elit: 1, rage: 5 });
  play(mixed.engine, P1, mixed.id("j"));
  drain(mixed.engine, declineAll);
  assert.equal(zoneOf(mixed.engine, mixed.id("j")), "play", "a single [E] meets the threshold");
});

clause(JUG, "0:extraCost", "the crew pick is optional: deploying with no characters picked flips nothing", () => {
  const { engine, id } = jugBoard({ crew: 2 });
  play(engine, P1, id("j"));
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("j")), "play");
  assert.equal(engine.state.cards[id("c0")].faceDown ?? false, false);
  assert.equal(engine.state.cards[id("c1")].faceDown ?? false, false);
  assert.equal(engine.state.cards[id("j")].faceDown ?? false, false);
});

clause(JUG, "0:extraCost", "you may pick 1, 2 or 3 characters you control", () => {
  for (const n of [1, 2, 3]) {
    const { engine, id } = jugBoard({ crew: 4 });
    const picks = ["c0", "c1", "c2"].slice(0, n).map(id);
    play(engine, P1, id("j"), { selected: { crew: picks } });
    drain(engine, declineAll);
    assert.equal(zoneOf(engine, id("j")), "play", `deployed with ${n} picked`);
    for (const k of ["c0", "c1", "c2"].slice(0, n)) assert.equal(engine.state.cards[id(k)].faceDown, true, `${k} flipped (n=${n})`);
    for (const k of ["c0", "c1", "c2"].slice(n)) assert.equal(engine.state.cards[id(k)].faceDown ?? false, false, `${k} not picked (n=${n})`);
    assert.equal(engine.state.cards[id("c3")].faceDown ?? false, false, "an unpicked character stays face-up");
  }
});

clause(JUG, "0:extraCost", "more than 3 characters cannot be picked (up to 3)", () => {
  const ok = jugBoard({ crew: 4 });
  play(ok.engine, P1, ok.id("j"), { selected: { crew: ["c0", "c1", "c2"].map(ok.id) } });
  drain(ok.engine, declineAll);
  assert.equal(zoneOf(ok.engine, ok.id("j")), "play", "control: 3 is fine");
  const bad = jugBoard({ crew: 4 });
  refused(() => play(bad.engine, P1, bad.id("j"), { selected: { crew: ["c0", "c1", "c2", "c3"].map(bad.id) } }), "4 characters picked");
  assert.equal(zoneOf(bad.engine, bad.id("j")), "hand");
  assert.equal(bad.engine.state.cards[bad.id("c0")].faceDown ?? false, false);
});

clause(JUG, "0:extraCost", "only characters you control can be picked: an opponent's character, an item of yours, a character in your hand are refused", () => {
  const extra: CardPlacement[] = [
    { key: "opp", def: character({ name: "Opp", strength: 1, life: 2 }), owner: P2, zone: "play" },
    { key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play" },
    { key: "inh", def: character({ name: "InHand" }), owner: P1, zone: "hand" }
  ];
  const ok = jugBoard({ crew: 1, extra });
  play(ok.engine, P1, ok.id("j"), { selected: { crew: [ok.id("c0")] } });
  drain(ok.engine, declineAll);
  assert.equal(zoneOf(ok.engine, ok.id("j")), "play", "control: my character in play");
  for (const k of ["opp", "itm", "inh"]) {
    const b = jugBoard({ crew: 1, extra });
    refused(() => play(b.engine, P1, b.id("j"), { selected: { crew: [b.id(k)] } }), `picking ${k}`);
    assert.equal(zoneOf(b.engine, b.id("j")), "hand", `${k}: not deployed`);
    assert.equal(b.engine.state.cards[b.id(k)].faceDown ?? false, false, `${k}: not flipped`);
  }
});

clause(JUG, "0:extraCost", "only characters in PLAY can be crewed: my own characters in the discard pile or the deck are refused", () => {
  const extra: CardPlacement[] = [
    { key: "indisc", def: character({ name: "InDisc" }), owner: P1, zone: "discard" },
    { key: "indeck", def: character({ name: "InDeck" }), owner: P1, zone: "deck" }
  ];
  for (const k of ["indisc", "indeck"]) {
    const b = jugBoard({ crew: 1, extra });
    refused(() => play(b.engine, P1, b.id("j"), { selected: { crew: [b.id(k)] } }), `picking ${k}`);
    assert.equal(zoneOf(b.engine, b.id("j")), "hand", `${k}: not deployed`);
    assert.equal(zoneOf(b.engine, b.id(k)), k === "indisc" ? "discard" : "deck", `${k}: stays where it was`);
  }
});

clause(JUG, "0:extraCost", "the picked characters cannot help pay the 6 (they flip only after the cost is paid)", () => {
  const { engine, id } = jugBoard({ elit: 5, crew: 1 });
  refused(() => play(engine, P1, id("j"), { selected: { crew: [id("c0")] } }), "5 resources + a picked character is still 5 for a cost of 6");
  assert.equal(zoneOf(engine, id("j")), "hand");
});

clause(JUG, "1:rule", "flips each picked character face-down; the flipped characters become resources (new ready Volition)", () => {
  const { engine, id } = jugBoard({ crew: 3 });
  play(engine, P1, id("j"), { selected: { crew: ["c0", "c1", "c2"].map(id) } });
  drain(engine, declineAll);
  for (const k of ["c0", "c1", "c2"]) {
    assert.equal(engine.state.cards[id(k)].faceDown, true, `${k} is face-down`);
    assert.equal(zoneOf(engine, id(k)), "play", `${k} stays in play`);
    assert.equal(engine.state.cards[id(k)].controllerId, P1);
  }
  assert.equal(readyResources(engine, P1), 3, "three face-down characters are three Volition resources");
  assert.equal(engine.state.cards[id("j")].faceDown ?? false, false, "Juggernauts itself is not flipped");
});

clause(JUG, "1:rule", "nothing is flipped when no characters were picked (other characters, even depleted ones, are untouched)", () => {
  const { engine, id } = jugBoard({
    crew: 1,
    extra: [{ key: "opp", def: character({ name: "Opp", strength: 1, life: 2 }), owner: P2, zone: "play" }]
  });
  play(engine, P1, id("j"));
  drain(engine, declineAll);
  assert.equal(engine.state.cards[id("c0")].faceDown ?? false, false);
  assert.equal(engine.state.cards[id("opp")].faceDown ?? false, false);
  assert.equal(readyResources(engine, P1), 0);
});

clause(JUG, "1:rule", "a picked character is flipped under its OWNER's control: a character I took from the opponent goes back to them face-down", () => {
  const { engine, id } = jugBoard({
    extra: [{ key: "loan", def: character({ name: "Loan", strength: 1, life: 2 }), owner: P2, zone: "play", controller: P1 }]
  });
  assert.equal(engine.state.cards[id("loan")].controllerId, P1, "setup: I control it");
  play(engine, P1, id("j"), { selected: { crew: [id("loan")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("j")), "play");
  assert.equal(engine.state.cards[id("loan")].faceDown, true, "flipped face-down");
  assert.equal(engine.state.cards[id("loan")].controllerId, P2, "under its owner's control");
});

clause(JUG, "1:rule", "a depleted or damaged picked character is flipped as well", () => {
  const { engine, id } = jugBoard({
    extra: [{ key: "hurt", def: character({ name: "Hurt", strength: 1, life: 4 }), owner: P1, zone: "play", depleted: true, damage: 2 }]
  });
  play(engine, P1, id("j"), { selected: { crew: [id("hurt")] } });
  drain(engine, declineAll);
  assert.equal(engine.state.cards[id("hurt")].faceDown, true);
});

// --- TREK -------------------------------------------------------------------------------------------
type TrekOpts = { elit?: number; extra?: CardPlacement[]; deck?: boolean; random?: () => number };
const trekBoard = (o: TrekOpts = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "j", def: printing(JUG), owner: P1, zone: "play" },
      ...bank("elitism", o.elit ?? 2, P1),
      ...(o.deck === false
        ? []
        : ([
            { key: "dc", def: character({ name: "DeckChar", strength: 1, life: 1 }), owner: P1, zone: "deck" },
            { key: "di", def: item({ name: "DeckItem" }), owner: P1, zone: "deck" },
            { key: "dt", def: tactic({ name: "DeckTactic" }), owner: P1, zone: "deck" },
            { key: "dx", def: character({ name: "DeckChar2", strength: 1, life: 1 }), owner: P1, zone: "deck" },
            { key: "dy", def: character({ name: "DeckChar3", strength: 1, life: 1 }), owner: P1, zone: "deck" }
          ] as CardPlacement[])),
      { key: "od", def: item({ name: "OppDeckItem" }), owner: P2, zone: "deck" },
      ...(o.extra ?? [])
    ],
    turn: 2,
    random: o.random ?? (() => 0.5)
  });
const trek = (b: ReturnType<typeof trekBoard>, fuel: string) => activate(b.engine, P1, b.id("j"), "trek", { selected: { fuel: [b.id(fuel)] } });
const pick = (b: ReturnType<typeof trekBoard>, key: string) => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id(key)] });

clause(JUG, "2:ability:trek", "TREK: pays 2, destroys the face-down resource, searches the deck and puts the found card into hand", () => {
  const b = trekBoard({ extra: [fdRes("fd")] });
  const handBefore = handOf(b.engine, P1).length;
  trek(b, "fd");
  pick(b, "di");
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("fd")), "discard", "the face-down resource was destroyed");
  assert.equal(readyResources(b.engine, P1), 0, "2 paid (and the third resource destroyed)");
  assert.equal(handOf(b.engine, P1).length, handBefore + 1);
  assert.ok(handOf(b.engine, P1).includes(b.id("di")), "the found card is in hand");
  assert.ok(!deckOf(b.engine, P1).includes(b.id("di")), "and left the deck");
  assert.equal(deckOf(b.engine, P1).length, 4);
});

clause(JUG, "2:ability:trek", "TREK searches for ANY card: a character, an item and a tactic can all be found", () => {
  for (const k of ["dc", "di", "dt"]) {
    const b = trekBoard({ extra: [fdRes("fd")] });
    trek(b, "fd");
    pick(b, k);
    assert.ok(handOf(b.engine, P1).includes(b.id(k)), `${k} found`);
  }
});

clause(JUG, "2:ability:trek", "TREK searches only YOUR deck: an opponent's deck card cannot be found", () => {
  const b = trekBoard({ extra: [fdRes("fd")] });
  trek(b, "fd");
  refused(() => pick(b, "od"), "the opponent's deck card");
  assert.ok(!handOf(b.engine, P1).includes(b.id("od")), "!handOf(b.engine, P1).includes(b.id(\"od\"))");
  pick(b, "dc");
  assert.ok(handOf(b.engine, P1).includes(b.id("dc")), "control: mine is found");
});

clause(JUG, "2:ability:trek", "TREK is an unconditional search for a card: with a nonempty deck you cannot fail it (CR 312.2)", () => {
  const b = trekBoard({ extra: [fdRes("fd")] });
  trek(b, "fd");
  const handBefore = handOf(b.engine, P1).length;
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [] }), "failing an unconditional search");
  assert.ok(pending(b.engine), "still waiting for a card");
  pick(b, "dc");
  assert.equal(handOf(b.engine, P1).length, handBefore + 1);
});

clause(JUG, "2:ability:trek", "TREK shuffles the searched deck afterwards (CR 312.1)", () => {
  const b = trekBoard({ extra: [fdRes("fd")], random: () => 0 });
  const before = [...deckOf(b.engine, P1)];
  trek(b, "fd");
  pick(b, "dc");
  const unshuffled = before.filter((c) => c !== b.id("dc"));
  assert.deepEqual([...deckOf(b.engine, P1)].sort(), [...unshuffled].sort(), "same cards remain");
  assert.notDeepEqual(deckOf(b.engine, P1), unshuffled, "order changed: shuffled");
});

clause(JUG, "2:ability:trek", "TREK with an empty deck: the costs are still paid and nothing is found (no soft-lock)", () => {
  const b = trekBoard({ deck: false, extra: [fdRes("fd")] });
  deckOf(b.engine, P1).length = 0;
  trek(b, "fd");
  drain(b.engine, declineAll);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("fd")), "discard");
  assert.equal(handOf(b.engine, P1).length, 0);
});

clause(JUG, "2:ability:trek", "TREK needs 2 to pay: one ready resource is refused (the face-down resource is already spent), two works", () => {
  const short = trekBoard({ elit: 1, extra: [fdRes("fd", P1, true)] });
  assert.equal(readyResources(short.engine, P1), 1);
  refused(() => trek(short, "fd"), "only 1 ready resource for Pay 2");
  assert.equal(zoneOf(short.engine, short.id("fd")), "play", "nothing destroyed");
  const ok = trekBoard({ elit: 2, extra: [fdRes("fd", P1, true)] });
  trek(ok, "fd");
  pick(ok, "dc");
  assert.equal(zoneOf(ok.engine, ok.id("fd")), "discard");
  assert.ok(handOf(ok.engine, P1).includes(ok.id("dc")), "handOf(ok.engine, P1).includes(ok.id(\"dc\"))");
  assert.equal(readyResources(ok.engine, P1), 0, "exactly 2 were paid");
});

clause(JUG, "2:ability:trek", "TREK needs a face-down resource you control to destroy: none (only face-up resources), or only the opponent's, is refused", () => {
  const none = trekBoard({ elit: 4 });
  const sel = none.id("j");
  refused(() => activate(none.engine, P1, sel, "trek", { selected: { fuel: [] } }), "no face-down resource at all");
  const faceUp = trekBoard({ elit: 4 });
  const upId = faceUp.engine.state.players[P1].play.find((x) => x !== faceUp.id("j") && faceUp.engine.isResource(x) && !faceUp.engine.state.cards[x].faceDown)!;
  assert.ok(upId, "setup: a face-up resource exists");
  refused(() => activate(faceUp.engine, P1, faceUp.id("j"), "trek", { selected: { fuel: [upId] } }), "a face-up resource is not a valid fuel");
  assert.equal(zoneOf(faceUp.engine, upId), "play");
  const opp = trekBoard({ elit: 4, extra: [fdRes("ofd", P2)] });
  refused(() => trek(opp, "ofd"), "the opponent's face-down resource");
  assert.equal(zoneOf(opp.engine, opp.id("ofd")), "play");
  const ok = trekBoard({ elit: 4, extra: [fdRes("fd")] });
  trek(ok, "fd");
  pick(ok, "dc");
  assert.equal(zoneOf(ok.engine, ok.id("fd")), "discard", "control: with my own face-down resource");
});

clause(JUG, "2:ability:trek", "TREK fuel must be a face-down resource I CONTROL: one I own but the opponent controls is refused; one I control but the opponent owns works", () => {
  const stolen = trekBoard({ elit: 4, extra: [{ ...fdRes("sfd", P1), controller: P2 }] });
  assert.equal(stolen.engine.state.cards[stolen.id("sfd")].controllerId, P2, "setup: the opponent controls it");
  refused(() => trek(stolen, "sfd"), "a face-down resource the opponent controls");
  assert.equal(zoneOf(stolen.engine, stolen.id("sfd")), "play", "not destroyed");
  const borrowed = trekBoard({ elit: 4, extra: [{ ...fdRes("bfd", P2), controller: P1 }] });
  assert.equal(borrowed.engine.state.cards[borrowed.id("bfd")].controllerId, P1, "setup: I control it");
  trek(borrowed, "bfd");
  pick(borrowed, "dc");
  assert.equal(zoneOf(borrowed.engine, borrowed.id("bfd")), "discard", "control: a face-down resource I control is destroyed");
  assert.ok(handOf(borrowed.engine, P1).includes(borrowed.id("dc")), "and the search resolved");
});

clause(JUG, "2:ability:trek", "TREK: I (the controller) choose the card found", () => {
  const b = trekBoard({ elit: 2, extra: [fdRes("fd")] });
  trek(b, "fd");
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "a pick is waiting");
  assert.equal(pc?.playerId, P1, "the Juggernauts' controller picks, not the opponent");
});

clause(JUG, "2:ability:trek", "TREK is not depleting or once-only: it can be used twice in a turn", () => {
  const b = trekBoard({ elit: 4, extra: [fdRes("fd"), fdRes("fe")] });
  trek(b, "fd");
  pick(b, "dc");
  trek(b, "fe");
  pick(b, "di");
  assert.ok(handOf(b.engine, P1).includes(b.id("dc")) && handOf(b.engine, P1).includes(b.id("di")), "handOf(b.engine, P1).includes(b.id(\"dc\")) && handOf(b.engine, P1).includes(b.id(\"di\"))");
  assert.equal(zoneOf(b.engine, b.id("fe")), "discard");
});

clause(JUG, "2:ability:trek", "only the controller can use TREK: the opponent cannot", () => {
  const b = trekBoard({ elit: 2, extra: [fdRes("fd")] });
  refused(() => activate(b.engine, P2, b.id("j"), "trek", { selected: { fuel: [b.id("fd")] } }), "opponent using my TREK");
  assert.equal(zoneOf(b.engine, b.id("fd")), "play");
  trek(b, "fd");
  pick(b, "dc");
  assert.ok(handOf(b.engine, P1).includes(b.id("dc")), "control: I can use it");
});

// =====================================================================================================
// MASTER MUD WHISPERER — character · gearsmith · mud whisperer · cost 6 · [E][E] · 4/2/4
// =====================================================================================================
type MmwOpts = { copies?: number; mState?: "play" | "hand" | "faceDown"; extra?: CardPlacement[] };
const mmwBoard = (o: MmwOpts = {}) => {
  const copies = o.copies ?? 1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      ...Array.from({ length: copies }, (_, i): CardPlacement => ({
        key: i === 0 ? "m" : `m${i}`,
        def: printing(MMW),
        owner: P1,
        zone: o.mState === "hand" ? "hand" : "play",
        ...(o.mState === "faceDown" ? { faceDown: true } : {}),
        ...(o.mState === undefined || o.mState === "play" ? { depleted: true } : {})
      })),
      { key: "c1", def: character({ name: "Mine1", strength: 1, life: 2 }), owner: P1, zone: "play", depleted: true },
      { key: "c2", def: character({ name: "Mine2", strength: 1, life: 2 }), owner: P1, zone: "play", depleted: true },
      { key: "ok", def: character({ name: "Fresh", strength: 1, life: 2 }), owner: P1, zone: "play" },
      { key: "it", def: item({ name: "MyItem" }), owner: P1, zone: "play", depleted: true },
      { key: "loan", def: character({ name: "Loan", strength: 1, life: 2 }), owner: P2, zone: "play", controller: P1, depleted: true },
      ...deckPad("pd", P1),
      ...deckPad("od", P2),
      ...(o.extra ?? [])
    ],
    turn: 2,
    activePlayerId: P1,
    random: () => 0.5
  });
};
type MmwBoard = ReturnType<typeof mmwBoard>;
const isDep = (b: MmwBoard, k: string) => b.engine.state.cards[b.id(k)].depleted === true;

clause(MMW, "0:rule", "printed card: character, gearsmith, mud whisperer, 4 / 2 / 4", () => {
  const def = printing(MMW);
  assert.equal(def.type, "character");
  assert.equal(def.trade, "gearsmith");
  assert.deepEqual(def.subtype, ["mud whisperer"]);
  assert.equal(def.cost, 6);
  assert.equal(def.threshold, "ee");
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "m", def: printing(MMW), owner: P1, zone: "play" }]
  });
  assert.equal(b.engine.getStat(b.id("m"), "strength"), 4);
  assert.equal(b.engine.getStat(b.id("m"), "speed"), 2);
  assert.equal(b.engine.getStat(b.id("m"), "life"), 4);
});

const mmwDeploy = (elit: number, rage: number) => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "m", def: printing(MMW), owner: P1, zone: "hand" }, ...bank("elitism", elit, P1), ...bank("rage", rage, P1)],
    turn: 2
  });
  return b;
};
clause(MMW, "0:rule", "cost 6 [E][E]: exactly 6 with two [E] deploys; 5 refused; 1 [E] + 5 other refused (threshold); 6 without [E] refused", () => {
  const ok = mmwDeploy(2, 4);
  play(ok.engine, P1, ok.id("m"));
  drain(ok.engine, declineAll);
  assert.equal(zoneOf(ok.engine, ok.id("m")), "play");
  assert.equal(readyResources(ok.engine, P1), 0);
  const short = mmwDeploy(2, 3);
  refused(() => play(short.engine, P1, short.id("m")), "5 resources for cost 6");
  const oneIcon = mmwDeploy(1, 5);
  refused(() => play(oneIcon.engine, P1, oneIcon.id("m")), "only one [E] for [E][E]");
  const none = mmwDeploy(0, 6);
  refused(() => play(none.engine, P1, none.id("m")), "no [E]");
  for (const b of [short, oneIcon, none]) assert.equal(zoneOf(b.engine, b.id("m")), "hand");
});

clause(MMW, "0:rule", "at the start of the opponent's turn you may restore all characters you control: accepting restores every depleted character of mine, including itself", () => {
  const b = mmwBoard();
  for (const k of ["m", "c1", "c2", "loan"]) assert.equal(isDep(b, k), true, `${k}: setup depleted`);
  endTurnOf(b.engine, P1);
  const pc = pending(b.engine);
  assert.ok(pc, "a prompt at the opponent's turn start");
  assert.equal(pc!.playerId, P1, "I decide");
  assert.equal(b.engine.state.activePlayerId, P2);
  drain(b.engine, accept());
  assert.equal(pending(b.engine), undefined);
  for (const k of ["m", "c1", "c2", "loan"]) assert.equal(isDep(b, k), false, `${k} restored`);
});

clause(MMW, "0:rule", "declining (it is a may) restores nothing", () => {
  const b = mmwBoard();
  endTurnOf(b.engine, P1);
  assert.ok(pending(b.engine), "pending(b.engine)");
  drain(b.engine, declineAll);
  assert.equal(pending(b.engine), undefined);
  for (const k of ["m", "c1", "c2", "loan"]) assert.equal(isDep(b, k), true, `${k} still depleted`);
});

clause(MMW, "0:rule", "only characters are restored: a depleted item of mine stays depleted", () => {
  const b = mmwBoard();
  endTurnOf(b.engine, P1);
  drain(b.engine, accept());
  assert.equal(isDep(b, "c1"), false, "control: characters are restored");
  assert.equal(isDep(b, "it"), true, "the item is not a character");
});

clause(MMW, "0:rule", "only characters I control are restored: an opponent's depleted character is not restored by it (checked after my choice)", () => {
  const b = mmwBoard({ extra: [{ key: "opp", def: character({ name: "OppDep", strength: 1, life: 2 }), owner: P2, zone: "play", depleted: true }] });
  endTurnOf(b.engine, P1);
  assert.ok(pending(b.engine), "a prompt at the opponent's turn start");
  const before = isDep(b, "opp");
  drain(b.engine, accept());
  assert.equal(isDep(b, "c1"), false, "control: my character restored");
  assert.equal(isDep(b, "opp"), before, "the opponent's character is not changed by my Whisperer's restore");
});

clause(MMW, "0:rule", "it triggers only at the OPPONENT's turn start, not at the start of my own turn", () => {
  const b = mmwBoard();
  b.engine.state.activePlayerId = P2;
  endTurnOf(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1, "my turn started");
  assert.equal(pending(b.engine), undefined, "no prompt at my own turn start");
});

clause(MMW, "0:rule", "the trigger does nothing from hand, and nothing while face-down (a resource has no abilities)", () => {
  const hand = mmwBoard({ mState: "hand" });
  endTurnOf(hand.engine, P1);
  assert.equal(pending(hand.engine), undefined, "in hand");
  assert.equal(isDep(hand, "c1"), true);
  const fd = mmwBoard({ mState: "faceDown" });
  endTurnOf(fd.engine, P1);
  assert.equal(pending(fd.engine), undefined, "face-down");
  assert.equal(isDep(fd, "c1"), true);
});

clause(MMW, "0:rule", "two copies each trigger once at the opponent's turn start (both restore; order prompt answered)", () => {
  const b = mmwBoard({ copies: 2 });
  endTurnOf(b.engine, P1);
  assert.ok(pending(b.engine), "pending(b.engine)");
  let prompts = 0;
  drain(b.engine, (pc) => {
    if (pc.kind === "chooserSelectsOption") prompts++;
    return accept()(pc);
  });
  assert.equal(prompts, 2, "one 'may' prompt per copy");
  for (const k of ["m", "m1", "c1", "c2", "loan"]) assert.equal(isDep(b, k), false, `${k} restored`);
});

// =====================================================================================================
// MOUNTAINOUS GOLEM — character · gearsmith · mountain golem · cost 13 · [E][E] · 13/1/13 · FLIP UP 13 [E][E]
// =====================================================================================================
const golemBoard = (o: { golem?: "play" | "faceDown" | "hand" | "deck"; golemController?: string; activePlayerId?: string; extra?: CardPlacement[]; res?: CardPlacement[] } = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      {
        key: "g",
        def: printing(GOLEM),
        owner: P1,
        zone: o.golem === "faceDown" ? "play" : (o.golem ?? "play"),
        ...(o.golem === "faceDown" ? { faceDown: true } : {}),
        ...(o.golemController ? { controller: o.golemController } : {})
      },
      { key: "own", def: character({ name: "Mine", strength: 1, life: 2 }), owner: P1, zone: "play" },
      ...deckPad("pd", P1),
      ...deckPad("od", P2),
      ...(o.res ?? []),
      ...(o.extra ?? [])
    ],
    turn: 2,
    activePlayerId: o.activePlayerId ?? P2,
    random: () => 0.5
  });

const golemDeploy = (elit: number, rage: number) =>
  buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "g", def: printing(GOLEM), owner: P1, zone: "hand" }, ...bank("elitism", elit, P1), ...bank("rage", rage, P1)],
    turn: 2
  });
clause(GOLEM, "0:rule", "printed card: character, gearsmith, mountain golem, 13 / 1 / 13; cost 13 [E][E]: exactly 13 deploys, 12 refused, one [E] short refused", () => {
  const def = printing(GOLEM);
  assert.equal(def.type, "character");
  assert.equal(def.trade, "gearsmith");
  assert.deepEqual(def.subtype, ["mountain", "golem"]);
  assert.equal(def.cost, 13);
  assert.equal(def.threshold, "ee");
  const ok = golemDeploy(2, 11);
  play(ok.engine, P1, ok.id("g"));
  drain(ok.engine, declineAll);
  assert.equal(zoneOf(ok.engine, ok.id("g")), "play");
  assert.equal(ok.engine.getStat(ok.id("g"), "strength"), 13);
  assert.equal(ok.engine.getStat(ok.id("g"), "speed"), 1);
  assert.equal(ok.engine.getStat(ok.id("g"), "life"), 13);
  assert.equal(readyResources(ok.engine, P1), 0);
  const short = golemDeploy(2, 10);
  refused(() => play(short.engine, P1, short.id("g")), "12 resources for cost 13");
  const oneIcon = golemDeploy(1, 12);
  refused(() => play(oneIcon.engine, P1, oneIcon.id("g")), "one [E] for [E][E]");
  for (const b of [short, oneIcon]) assert.equal(zoneOf(b.engine, b.id("g")), "hand");
});

const steal = (b: ReturnType<typeof golemBoard>, target: string) => activate(b.engine, P2, b.id("th"), "steal", { selected: { t: [b.id(target)] } });
const thiefP2 = (duration?: unknown): CardPlacement => ({ key: "th", def: thiefDef(duration), owner: P2, zone: "play" });
const stealOwn = (b: ReturnType<typeof golemBoard>, who: string, target: string) => activate(b.engine, who, b.id("th"), "steal", { selected: { t: [b.id(target)] } });

clause(GOLEM, "0:rule", "opponents cannot take control of it: a control-grab on the Golem fizzles; the same grab works on an ordinary character", () => {
  const b = golemBoard({ extra: [thiefP2()] });
  steal(b, "own");
  assert.equal(b.engine.state.cards[b.id("own")].controllerId, P2, "control: the thief works on an ordinary character");
  const g = golemBoard({ extra: [thiefP2()] });
  steal(g, "g");
  drain(g.engine, declineAll);
  assert.equal(g.engine.state.cards[g.id("g")].controllerId, P1, "the Golem stays mine");
  assert.equal(zoneOf(g.engine, g.id("g")), "play");
});

clause(GOLEM, "0:rule", "also a durational ('this turn') control grab on the Golem fizzles", () => {
  const dur = { type: "untilEndOfTurn" };
  const ok = golemBoard({ extra: [thiefP2(dur)] });
  steal(ok, "own");
  assert.equal(ok.engine.state.cards[ok.id("own")].controllerId, P2, "control: works on an ordinary character");
  const g = golemBoard({ extra: [thiefP2(dur)] });
  steal(g, "g");
  drain(g.engine, declineAll);
  assert.equal(g.engine.state.cards[g.id("g")].controllerId, P1);
});

clause(GOLEM, "0:rule", "'your opponents': a Golem controlled by P2 (owned by P1) cannot be grabbed by P1, its controller's opponent", () => {
  // Reading "your" as the Golem's controller: P2 controls it, so P1 is the opponent.
  const b = golemBoard({ golemController: P2, activePlayerId: P1, extra: [{ key: "th", def: thiefDef(), owner: P1, zone: "play" }] });
  assert.equal(b.engine.state.cards[b.id("g")].controllerId, P2);
  activate(b.engine, P1, b.id("th"), "steal", { selected: { t: [b.id("g")] } });
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.cards[b.id("g")].controllerId, P2, "P1 (an opponent of its controller) cannot take it");
});

clause(GOLEM, "0:rule", "the protection is on while the Golem is in play and is gone once it has left", () => {
  const b = golemBoard({ extra: [thiefP2()] });
  steal(b, "g");
  assert.equal(b.engine.state.cards[b.id("g")].controllerId, P1, "protected in play");
  const gone = golemBoard({ golem: "hand", extra: [thiefP2()] });
  assert.equal(zoneOf(gone.engine, gone.id("g")), "hand");
  refused(() => steal(gone, "g"), "a Golem in hand is not a character in play to take");
});

const mover = (zone: string, to: string): CardPlacement => ({ key: "mv", def: moverDef(zone, to), owner: P2, zone: "play" });
const move = (b: ReturnType<typeof golemBoard>, key: string) => activate(b.engine, P2, b.id("mv"), "mv", { selected: { t: [b.id(key)] } });
const ctrl = (key: string): CardPlacement => ({ key, def: character({ name: `Ctl-${key}`, strength: 1, life: 2 }), owner: P1, zone: "play" });

clause(GOLEM, "1:rule", "put into your discard from play (moved by an effect): it is removed from the game instead of staying in the discard", () => {
  const b = golemBoard({ extra: [mover("play", "discard"), ctrl("x")] });
  move(b, "x");
  assert.equal(zoneOf(b.engine, b.id("x")), "discard", "control: an ordinary character stays in the discard");
  const g = golemBoard({ extra: [mover("play", "discard")] });
  move(g, "g");
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("g")), "removed", "the Golem is removed from the game");
  assert.ok(!g.engine.state.players[P1].discard.includes(g.id("g")), "not in the discard pile");
});

clause(GOLEM, "1:rule", "destroyed (dies in play): removed from the game", () => {
  const g = golemBoard({ extra: [{ key: "k", def: killerDef(), owner: P2, zone: "play" }] });
  activate(g.engine, P2, g.id("k"), "kill", { selected: { t: [g.id("g")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("g")), "removed");
  assert.ok(!g.engine.state.players[P1].discard.includes(g.id("g")), "!g.engine.state.players[P1].discard.includes(g.id(\"g\"))");
});

clause(GOLEM, "1:rule", "from hand ('from anywhere'): discarded from my hand it is removed from the game", () => {
  const g = golemBoard({ golem: "hand", extra: [mover("hand", "discard")] });
  move(g, "g");
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("g")), "removed");
});

clause(GOLEM, "1:rule", "from the deck ('from anywhere'): put from my deck into my discard it is removed from the game", () => {
  const g = golemBoard({ golem: "deck", extra: [mover("deck", "discard")] });
  move(g, "g");
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("g")), "removed");
  const o = golemBoard({ golem: "deck", extra: [mover("deck", "discard")] });
  move(o, "pd0");
  assert.equal(zoneOf(o.engine, o.id("pd0")), "discard", "control: an ordinary deck card stays in the discard");
});

clause(GOLEM, "1:rule", "from play face-down (as a resource): destroyed it is removed from the game", () => {
  const g = golemBoard({ golem: "faceDown", extra: [mover("play", "discard")] });
  assert.equal(g.engine.state.cards[g.id("g")].faceDown, true);
  move(g, "g");
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("g")), "removed");
});

clause(GOLEM, "1:rule", "lethal battle damage: a Golem that takes 13 damage is removed from the game", () => {
  const atk = character({ name: "Pest", strength: 1, life: 2, speed: 1 });
  const g = golemBoard({
    activePlayerId: P2,
    extra: [{ key: "atk", def: atk, owner: P2, zone: "play" }]
  });
  g.engine.state.cards[g.id("g")].damage = 12;
  declareAttackBy(g.engine, P2, [g.id("atk")]);
  declareBlockers(g.engine, P1, [g.id("g")]);
  finishBattle(g.engine);
  assert.equal(zoneOf(g.engine, g.id("g")), "removed", "removed from the game, not in the discard");
});

clause(GOLEM, "1:rule", "only the Golem itself is removed: other cards (mine or the opponent's) going to a discard pile leave it in play", () => {
  const g = golemBoard({ extra: [mover("play", "discard"), ctrl("x"), { key: "ox", def: character({ name: "OppX", strength: 1, life: 2 }), owner: P2, zone: "play" }] });
  move(g, "x");
  move(g, "ox");
  assert.equal(zoneOf(g.engine, g.id("x")), "discard");
  assert.equal(zoneOf(g.engine, g.id("ox")), "discard");
  assert.equal(zoneOf(g.engine, g.id("g")), "play", "the Golem is unaffected");
  const hand = golemBoard({ golem: "hand", extra: [mover("play", "discard"), ctrl("x")] });
  move(hand, "x");
  assert.equal(zoneOf(hand.engine, hand.id("g")), "hand", "a Golem in hand is unaffected too");
});

clause(GOLEM, "1:rule", "moved to a zone other than the discard (hand) it is not removed from the game", () => {
  const g = golemBoard({ extra: [mover("play", "hand")] });
  move(g, "g");
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("g")), "hand", "bounced to hand, still in the game");
});

clause(GOLEM, "1:rule", "a Golem already sitting in a discard pile is not removed when ANOTHER card is put into a discard pile", () => {
  const g = golemBoard({ extra: [mover("play", "discard"), ctrl("x"), { key: "gd", def: printing(GOLEM), owner: P1, zone: "discard" }] });
  assert.equal(zoneOf(g.engine, g.id("gd")), "discard", "setup: a Golem in the discard pile");
  move(g, "x");
  assert.equal(zoneOf(g.engine, g.id("x")), "discard", "the other card went to the discard pile");
  assert.equal(zoneOf(g.engine, g.id("gd")), "discard", "the Golem in the pile is not 'this card' being put there");
});

clause(GOLEM, "1:rule", "a Golem in a discard pile that leaves it for the hand (not put INTO a discard pile) is not removed from the game", () => {
  const g = golemBoard({ extra: [mover("discard", "hand"), { key: "gd", def: printing(GOLEM), owner: P1, zone: "discard" }] });
  move(g, "gd");
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("gd")), "hand", "moved to hand, still in the game");
});

clause(GOLEM, "1:rule", "the owner is whose discard it goes to: a Golem I own but the opponent controls is removed when destroyed", () => {
  const g = golemBoard({ golemController: P2, activePlayerId: P2, extra: [{ key: "k", def: killerDef(), owner: P2, zone: "play" }] });
  activate(g.engine, P2, g.id("k"), "kill", { selected: { t: [g.id("g")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("g")), "removed");
});

// --- FLIP UP 13 [E][E] ---
const flipUp = (b: ReturnType<typeof golemBoard>) => flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("g"), selected: {}, variables: {} });
const fuBoard = (others: number, elit: number, o: { active?: string } = {}) =>
  golemBoard({ golem: "faceDown", activePlayerId: o.active ?? P1, res: [...bank("elitism", elit, P1), ...bank("rage", others - elit, P1)] });

clause(GOLEM, "2:flipUp", "FLIP UP 13 [E][E]: 12 other resources (with two [E]) plus the Golem paying for itself flips it up as a 13/1/13 character", () => {
  const b = fuBoard(12, 2);
  assert.equal(b.engine.state.cards[b.id("g")].faceDown, true);
  flipUp(b);
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.cards[b.id("g")].faceDown ?? false, false, "face-up");
  assert.equal(zoneOf(b.engine, b.id("g")), "play");
  assert.equal(b.engine.getStat(b.id("g"), "strength"), 13);
  assert.equal(b.engine.getStat(b.id("g"), "speed"), 1);
  assert.equal(b.engine.getStat(b.id("g"), "life"), 13);
  assert.equal(readyResources(b.engine, P1), 0, "13 was paid in total");
});

clause(GOLEM, "2:flipUp", "FLIP UP is refused one resource short (11 others + itself = 12) and stays face-down", () => {
  const b = fuBoard(11, 2);
  refused(() => flipUp(b), "12 resources for a FLIP UP cost of 13");
  assert.equal(b.engine.state.cards[b.id("g")].faceDown, true);
  assert.equal(readyResources(b.engine, P1), 12, "nothing was paid");
});

clause(GOLEM, "2:flipUp", "FLIP UP is refused with one [E] icon short: 13 resources but a single [E] (its own icon does not count)", () => {
  const b = fuBoard(12, 1);
  assert.equal(readyResources(b.engine, P1), 13);
  refused(() => flipUp(b), "[E][E] needs two [E] icons among the others");
  assert.equal(b.engine.state.cards[b.id("g")].faceDown, true);
  const none = fuBoard(12, 0);
  refused(() => flipUp(none), "no [E] at all");
  const ok = fuBoard(12, 2);
  flipUp(ok);
  assert.equal(ok.engine.state.cards[ok.id("g")].faceDown ?? false, false, "control: two [E] works");
});

clause(GOLEM, "2:flipUp", "FLIP UP with spare resources: the surplus stays ready (rule-neutral on which paid)", () => {
  const b = fuBoard(14, 2);
  flipUp(b);
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.cards[b.id("g")].faceDown ?? false, false);
  const ready = readyResources(b.engine, P1);
  assert.ok(ready === 1 || ready === 2, `13 spent of 15 (the Golem's own slot is gone once it flips): ${ready} left`);
});

clause(GOLEM, "2:flipUp", "a non-tactic FLIP UP is refused inside an opponent's response window", () => {
  const w = golemBoard({
    golem: "faceDown",
    activePlayerId: P2,
    res: [...bank("elitism", 2, P1), ...bank("rage", 10, P1)],
    extra: [{ key: "att", def: character({ name: "Att", strength: 1, life: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(w.engine, P2, [w.id("att")]);
  refused(() => flipUp(w), "FLIP UP of a character during the opponent's attack window");
  assert.equal(w.engine.state.cards[w.id("g")].faceDown, true);
});

clause(GOLEM, "2:flipUp", "a character FLIP UP is refused on the opponent's turn outside any window; works on mine", () => {
  const off = fuBoard(12, 2, { active: P2 });
  refused(() => flipUp(off), "FLIP UP of a character on the opponent's turn");
  assert.equal(off.engine.state.cards[off.id("g")].faceDown, true);
  const on = fuBoard(12, 2);
  flipUp(on);
  assert.equal(on.engine.state.cards[on.id("g")].faceDown ?? false, false, "control: my turn works");
});

// =====================================================================================================
// MUD PRISON — location · gearsmith · cost 3 · [E][E][E] · structure 5
// =====================================================================================================
type MpOpts = { elit?: number; copies?: number; inHand?: boolean; extra?: CardPlacement[] };
const mpBoard = (o: MpOpts = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      ...Array.from({ length: o.copies ?? 1 }, (_, i): CardPlacement => ({ key: i === 0 ? "mp" : `mp${i}`, def: printing(PRISON), owner: P1, zone: o.inHand ? "hand" : "play" })),
      { key: "oc", def: character({ name: "OppChar", strength: 2, life: 3 }), owner: P2, zone: "play" },
      { key: "oc2", def: character({ name: "OppChar2", strength: 2, life: 3 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3 }), owner: P1, zone: "play" },
      ...bank("elitism", o.elit ?? 4, P1),
      ...deckPad("pd", P1),
      ...deckPad("od", P2),
      ...(o.extra ?? [])
    ],
    turn: 2,
    activePlayerId: P2,
    random: () => 0.5
  });
type MpBoard = ReturnType<typeof mpBoard>;
const myTurn = (b: MpBoard) => endTurnOf(b.engine, P2);

const mpDeploy = (ready: CardPlacement[], spent: CardPlacement[]) =>
  buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "mp", def: printing(PRISON), owner: P1, zone: "hand" }, ...ready, ...spent], turn: 2 });
clause(PRISON, "0:rule", "printed card: location, gearsmith, structure 5; cost 3 [E][E][E] (cost and threshold isolated with spent [E] icons)", () => {
  const def = printing(PRISON);
  assert.equal(def.type, "location");
  assert.equal(def.trade, "gearsmith");
  assert.equal(def.cost, 3);
  assert.equal(def.threshold, "eee");
  const ok = mpDeploy(bank("elitism", 3, P1), []);
  play(ok.engine, P1, ok.id("mp"));
  drain(ok.engine, declineAll);
  assert.equal(zoneOf(ok.engine, ok.id("mp")), "play");
  assert.equal(ok.engine.getStat(ok.id("mp"), "structure"), 5);
  assert.equal(readyResources(ok.engine, P1), 0, "paid exactly 3");
  // threshold from spent icons, cost from ready rage
  const viaSpent = mpDeploy(bank("rage", 3, P1), spentBank("elitism", 3, P1));
  play(viaSpent.engine, P1, viaSpent.id("mp"));
  drain(viaSpent.engine, declineAll);
  assert.equal(zoneOf(viaSpent.engine, viaSpent.id("mp")), "play", "spent [E] count toward the threshold");
  // cost one short: 2 ready (threshold satisfied by spent)
  const costShort = mpDeploy(bank("rage", 2, P1), spentBank("elitism", 3, P1));
  refused(() => play(costShort.engine, P1, costShort.id("mp")), "only 2 ready for cost 3");
  // threshold one short: 3 ready but only two [E]
  const iconShort = mpDeploy([...bank("elitism", 2, P1), ...bank("rage", 1, P1)], []);
  refused(() => play(iconShort.engine, P1, iconShort.id("mp")), "only two [E] for [E][E][E]");
  for (const b of [costShort, iconShort]) assert.equal(zoneOf(b.engine, b.id("mp")), "hand");
});

clause(PRISON, "0:rule", "at the start of your turn you may pay 1; if you do, the picked opponent character gets one token (1 resource spent)", () => {
  const b = mpBoard();
  myTurn(b);
  assert.equal(b.engine.state.activePlayerId, P1);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "mayPay");
  assert.equal(pc?.playerId, P1);
  const readyBefore = readyResources(b.engine, P1);
  drain(b.engine, accept([b.id("oc")]));
  assert.equal(pending(b.engine), undefined);
  assert.equal(tokensOn(b.engine, b.id("oc")), 1, "exactly one token on the picked character");
  assert.equal(tokensOn(b.engine, b.id("oc2")), 0, "the other opposing character is untouched");
  assert.equal(readyResources(b.engine, P1), readyBefore - 1, "1 paid");
});

clause(PRISON, "0:rule", "declining the payment: no token, nothing paid", () => {
  const b = mpBoard();
  myTurn(b);
  const readyBefore = readyResources(b.engine, P1);
  drain(b.engine, declineAll);
  assert.equal(pending(b.engine), undefined);
  assert.equal(tokensOn(b.engine, b.id("oc")), 0);
  assert.equal(tokensOn(b.engine, b.id("oc2")), 0);
  assert.equal(readyResources(b.engine, P1), readyBefore, "nothing paid");
});

clause(PRISON, "0:rule", "you can't pay 1 with no resources: no token is ever placed", () => {
  const b = mpBoard({ elit: 0 });
  myTurn(b);
  assert.equal(readyResources(b.engine, P1), 0);
  if (pending(b.engine)) refused(() => answerPending(b.engine, "mayPay", { pay: true }), "paying with nothing");
  drain(b.engine, declineAll);
  assert.equal(tokensOn(b.engine, b.id("oc")), 0);
  assert.equal(tokensOn(b.engine, b.id("oc2")), 0);
});

clause(PRISON, "0:rule", "the pick is a character an opponent controls: my character, an opposing item, an opposing location are refused", () => {
  const extra: CardPlacement[] = [
    { key: "oi", def: item({ name: "OppItem" }), owner: P2, zone: "play" },
    { key: "ol", def: { ...character({ name: "OppLoc" }), type: "location" } as never, owner: P2, zone: "play" }
  ];
  for (const bad of ["mine", "oi", "ol"]) {
    const b = mpBoard({ extra });
    myTurn(b);
    answerPending(b.engine, "mayPay", { pay: true });
    refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id(bad)] }), `picking ${bad}`);
    assert.equal(tokensOn(b.engine, b.id(bad)), 0, `${bad}: no token`);
    answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("oc2")] });
    assert.equal(tokensOn(b.engine, b.id("oc2")), 1, "control: an opposing character can be picked");
  }
});

clause(PRISON, "0:rule", "'controls': an opposing-controlled character I own can be picked, one I control but the opponent owns cannot", () => {
  const extra: CardPlacement[] = [
    { key: "stolen", def: character({ name: "Stolen", strength: 1, life: 2 }), owner: P1, zone: "play", controller: P2 },
    { key: "loan", def: character({ name: "Loan", strength: 1, life: 2 }), owner: P2, zone: "play", controller: P1 }
  ];
  const b = mpBoard({ extra });
  myTurn(b);
  answerPending(b.engine, "mayPay", { pay: true });
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("loan")] }), "a character the opponent owns but I control");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("stolen")] });
  assert.equal(tokensOn(b.engine, b.id("stolen")), 1);
  assert.equal(tokensOn(b.engine, b.id("loan")), 0);
});

clause(PRISON, "0:rule", "the picker is me (the Prison's controller) and only a character IN PLAY is pickable: opposing characters in hand, discard or deck are refused", () => {
  const extra: CardPlacement[] = [
    { key: "oh", def: character({ name: "OppHand" }), owner: P2, zone: "hand" },
    { key: "odi", def: character({ name: "OppDisc" }), owner: P2, zone: "discard" },
    { key: "ode", def: character({ name: "OppDeck" }), owner: P2, zone: "deck" }
  ];
  for (const bad of ["oh", "odi", "ode"]) {
    const b = mpBoard({ extra });
    myTurn(b);
    answerPending(b.engine, "mayPay", { pay: true });
    const pc = pending(b.engine);
    assert.equal(pc?.kind, "chooserSelectsTarget", "a pick is waiting");
    assert.equal(pc?.playerId, P1, "I choose the character, not the opponent");
    refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id(bad)] }), `picking ${bad}`);
    assert.equal(tokensOn(b.engine, b.id(bad)), 0, `${bad}: no token`);
    answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("oc")] });
    assert.equal(tokensOn(b.engine, b.id("oc")), 1, "control: an opposing character in play can be picked");
  }
});

clause(PRISON, "0:rule", "only ONE character gets a token (picking two is refused)", () => {
  const b = mpBoard();
  myTurn(b);
  answerPending(b.engine, "mayPay", { pay: true });
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("oc"), b.id("oc2")] }), "picking two characters");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("oc")] });
  assert.equal(tokensOn(b.engine, b.id("oc")), 1);
  assert.equal(tokensOn(b.engine, b.id("oc2")), 0);
});

clause(PRISON, "0:rule", "after paying you must pick a character (it is not optional) when one exists", () => {
  const b = mpBoard();
  myTurn(b);
  answerPending(b.engine, "mayPay", { pay: true });
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [] }), "picking nothing after paying");
  assert.ok(pending(b.engine), "still waiting for the pick");
});

clause(PRISON, "0:rule", "with no opposing character: the payment can be made and nothing breaks (no token anywhere)", () => {
  const none = mpBoard();
  const ids = ["oc", "oc2"].map(none.id);
  for (const i of ids) none.engine.state.players[P2].play = none.engine.state.players[P2].play.filter((x) => x !== i);
  for (const i of ids) none.engine.state.cards[i].zone = "discard";
  myTurn(none);
  drain(none.engine, accept([]));
  assert.equal(pending(none.engine), undefined);
  assert.equal(tokensOn(none.engine, none.id("mine")), 0);
});

clause(PRISON, "0:rule", "it triggers only at the start of MY turn: not at the opponent's turn start, not from hand", () => {
  const b = mpBoard();
  b.engine.state.activePlayerId = P1;
  endTurnOf(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(pending(b.engine), undefined, "no prompt at the opponent's turn start");
  const h = mpBoard({ inHand: true });
  myTurn(h);
  assert.equal(pending(h.engine), undefined, "no prompt with Mud Prison in hand");
  assert.equal(tokensOn(h.engine, h.id("oc")), 0);
});

clause(PRISON, "0:rule", "two Mud Prisons: each triggers (two payments, two tokens)", () => {
  const b = mpBoard({ copies: 2 });
  myTurn(b);
  const readyBefore = readyResources(b.engine, P1);
  drain(b.engine, accept([b.id("oc")]));
  assert.equal(pending(b.engine), undefined);
  assert.equal(tokensOn(b.engine, b.id("oc")), 2, "two tokens");
  assert.equal(readyResources(b.engine, P1), readyBefore - 2, "two resources paid");
});

// --- continuous silence ---
const silenceBoard = (o: { token?: number; counter?: string; ownedBy?: string; controlledBy?: string; mpIn?: boolean } = {}) => {
  const buff = character({
    name: "Brute",
    strength: 2,
    life: 3,
    behavior: {
      keywords: ["aggro"],
      abilities: [
        { id: "buff", type: "continuous", modifiers: [{ target: "source", stat: "strength", operation: "add", value: 3 }] },
        { id: "ping", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] },
        { id: "tick", type: "triggered", event: "turnStarted", condition: { type: "eventPlayerIs", player: "controller" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }
      ]
    }
  } as never);
  const owner = o.ownedBy ?? P2;
  const controller = o.controlledBy ?? owner;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      ...(o.mpIn === false ? [] : [{ key: "mp", def: printing(PRISON), owner: P1, zone: "play" } as CardPlacement]),
      { key: "b", def: buff, owner, zone: "play", controller, ...(o.token ? { counters: { [o.counter ?? "token"]: o.token } } : {}) },
      ...deckPad("pd", P1),
      ...deckPad("od", P2)
    ],
    turn: 2,
    activePlayerId: P2,
    random: () => 0.5
  });
};

clause(PRISON, "1:rule", "a character an opponent controls with a token has no rules text: its static +3 is gone (printed 2 stays); without a token it still has it", () => {
  const plain = silenceBoard();
  assert.equal(plain.engine.getStat(plain.id("b"), "strength"), 5, "no token: text active");
  const tok = silenceBoard({ token: 1 });
  assert.equal(tok.engine.getStat(tok.id("b"), "strength"), 2, "token: no rules text, printed strength remains");
  assert.equal(tok.engine.getStat(tok.id("b"), "life"), 3);
});

clause(PRISON, "1:rule", "no rules text includes keywords: AGGRO is gone with a token, present without", () => {
  const plain = silenceBoard();
  assert.ok(plain.engine.getKeywords(plain.id("b")).includes("aggro"), "control: aggro printed");
  const tok = silenceBoard({ token: 1 });
  assert.ok(!tok.engine.getKeywords(tok.id("b")).includes("aggro"), "keyword is rules text");
});

clause(PRISON, "1:rule", "no rules text includes activated abilities: it cannot be used with a token, can without", () => {
  const plain = silenceBoard();
  const h0 = handOf(plain.engine, P2).length;
  activate(plain.engine, P2, plain.id("b"), "ping");
  assert.equal(handOf(plain.engine, P2).length, h0 + 1, "control: ping draws");
  const tok = silenceBoard({ token: 1 });
  refused(() => activate(tok.engine, P2, tok.id("b"), "ping"), "an activated ability of a silenced character", /Activated ability not found/);
});

clause(PRISON, "1:rule", "no rules text includes triggered abilities: it does not trigger with a token, does without", () => {
  const run = (token: number) => {
    const b = silenceBoard({ token });
    const before = handOf(b.engine, P2).length;
    b.engine.state.activePlayerId = P1;
    endTurnOf(b.engine, P1);
    drain(b.engine, declineAll);
    assert.equal(b.engine.state.activePlayerId, P2);
    return handOf(b.engine, P2).length - before;
  };
  const plainDelta = run(0);
  const tokDelta = run(1);
  assert.ok(plainDelta >= 1, "control: the trigger draws without a token");
  assert.equal(plainDelta - tokDelta, 1, "the trigger's draw only happens without a token");
});

clause(PRISON, "1:rule", "'no rules text' requires Mud Prison in play: with it gone the token no longer silences", () => {
  const withMp = silenceBoard({ token: 1 });
  assert.equal(withMp.engine.getStat(withMp.id("b"), "strength"), 2);
  const without = silenceBoard({ token: 1, mpIn: false });
  assert.equal(without.engine.getStat(without.id("b"), "strength"), 5, "no Mud Prison: its text is back");
  const hand = silenceBoard({ token: 1 });
  hand.engine.state.cards[hand.id("mp")].zone = "hand";
  hand.engine.state.players[P1].play = hand.engine.state.players[P1].play.filter((x) => x !== hand.id("mp"));
  hand.engine.state.players[P1].hand.push(hand.id("mp"));
  assert.equal(hand.engine.getStat(hand.id("b"), "strength"), 5, "Mud Prison out of play: the effect is off");
});

clause(PRISON, "1:rule", "only characters I'm an opponent of: my own character with a token keeps its text", () => {
  const mine = silenceBoard({ token: 1, ownedBy: P1 });
  assert.equal(mine.engine.getStat(mine.id("b"), "strength"), 5, "my token-bearing character keeps its rules text");
  assert.ok(mine.engine.getKeywords(mine.id("b")).includes("aggro"), "mine.engine.getKeywords(mine.id(\"b\")).includes(\"aggro\")");
});

clause(PRISON, "1:rule", "'controlled by an opponent': owned by me but controlled by the opponent is silenced; owned by the opponent but controlled by me is not", () => {
  const stolen = silenceBoard({ token: 1, ownedBy: P1, controlledBy: P2 });
  assert.equal(stolen.engine.getStat(stolen.id("b"), "strength"), 2, "controlled by the opponent: silenced");
  const loan = silenceBoard({ token: 1, ownedBy: P2, controlledBy: P1 });
  assert.equal(loan.engine.getStat(loan.id("b"), "strength"), 5, "controlled by me: keeps its text");
});

clause(PRISON, "1:rule", "only a TOKEN counts: another kind of counter does not silence; two tokens still silence", () => {
  const other = silenceBoard({ token: 2, counter: "poison" });
  assert.equal(other.engine.getStat(other.id("b"), "strength"), 5, "a different counter does not silence");
  const two = silenceBoard({ token: 2 });
  assert.equal(two.engine.getStat(two.id("b"), "strength"), 2, "two tokens still silence");
});

clause(PRISON, "1:rule", "only characters are silenced: an opposing item with a token keeps its ability", () => {
  const pinger = item({
    name: "Pinger",
    cost: 0,
    behavior: { abilities: [{ id: "ping", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  } as never);
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "mp", def: printing(PRISON), owner: P1, zone: "play" },
      { key: "pi", def: pinger, owner: P2, zone: "play", counters: { token: 1 } },
      ...deckPad("od", P2)
    ],
    turn: 2,
    activePlayerId: P2
  });
  const h0 = handOf(b.engine, P2).length;
  activate(b.engine, P2, b.id("pi"), "ping");
  assert.equal(handOf(b.engine, P2).length, h0 + 1, "the item is not a character, so it keeps its text");
});

// =====================================================================================================
// MUD WHISPERER WANNABE — character · gearsmith · mud whisperer, 31f · cost 4 · [E][E] · 2/3/4
// =====================================================================================================
const wanBoard = (o: { extra?: CardPlacement[]; wZone?: "play" | "hand" } = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "w", def: printing(WANNABE), owner: P1, zone: o.wZone ?? "play" },
      { key: "b2", def: character({ name: "OtherBlocker", strength: 1, life: 3 }), owner: P1, zone: "play" },
      { key: "dep", def: character({ name: "MineDep", strength: 1, life: 3 }), owner: P1, zone: "play", depleted: true },
      { key: "odep", def: character({ name: "OppDep", strength: 1, life: 3 }), owner: P2, zone: "play", depleted: true },
      { key: "atk", def: character({ name: "Attacker", strength: 1, life: 5 }), owner: P2, zone: "play" },
      { key: "ghost", def: character({ name: "Ghost", strength: 1, life: 3 }), owner: P1, zone: "discard" },
      { key: "hc", def: character({ name: "HandChar", strength: 1, life: 3 }), owner: P1, zone: "hand" },
      ...(o.extra ?? [])
    ],
    turn: 2,
    activePlayerId: P2,
    random: () => 0.5
  });
type WanBoard = ReturnType<typeof wanBoard>;
const wanBlock = (b: WanBoard, blockers: string[] = ["w"]) => {
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  declareBlockers(b.engine, P1, blockers.map(b.id));
};
const dep = (b: WanBoard, k: string) => b.engine.state.cards[b.id(k)].depleted === true;

const wanDeploy = (elit: number, rage: number) =>
  buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "w", def: printing(WANNABE), owner: P1, zone: "hand" }, ...bank("elitism", elit, P1), ...bank("rage", rage, P1)],
    turn: 2
  });
clause(WANNABE, "0:rule", "printed card: character, gearsmith, mud whisperer + 31f, 2 / 3 / 4; cost 4 [E][E]", () => {
  const def = printing(WANNABE);
  assert.equal(def.type, "character");
  assert.equal(def.trade, "gearsmith");
  assert.deepEqual(def.subtype, ["mud whisperer", "31f"]);
  assert.equal(def.cost, 4);
  assert.equal(def.threshold, "ee");
  const ok = wanDeploy(2, 2);
  play(ok.engine, P1, ok.id("w"));
  drain(ok.engine, declineAll);
  assert.equal(zoneOf(ok.engine, ok.id("w")), "play");
  assert.equal(ok.engine.getStat(ok.id("w"), "strength"), 2);
  assert.equal(ok.engine.getStat(ok.id("w"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("w"), "life"), 4);
  assert.equal(readyResources(ok.engine, P1), 0);
  const short = wanDeploy(2, 1);
  refused(() => play(short.engine, P1, short.id("w")), "3 resources for cost 4");
  const oneIcon = wanDeploy(1, 3);
  refused(() => play(oneIcon.engine, P1, oneIcon.id("w")), "one [E] for [E][E]");
  for (const b of [short, oneIcon]) assert.equal(zoneOf(b.engine, b.id("w")), "hand");
});

clause(WANNABE, "0:rule", "when it blocks you may pick a character and restore it: my depleted character is restored", () => {
  const b = wanBoard();
  wanBlock(b);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1, "I pick");
  assert.equal(dep(b, "dep"), true);
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("dep")] });
  assert.equal(dep(b, "dep"), false, "restored");
  assert.equal(dep(b, "odep"), true, "only the picked character");
});

clause(WANNABE, "0:rule", "the picked character may be any character: an opponent's depleted character is restored too", () => {
  const b = wanBoard();
  wanBlock(b);
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("odep")] });
  assert.equal(dep(b, "odep"), false);
  assert.equal(dep(b, "dep"), true, "mine not picked, still depleted");
});

clause(WANNABE, "0:rule", "declining to pick: nothing is restored", () => {
  const b = wanBoard();
  wanBlock(b);
  answerPending(b.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(pending(b.engine), undefined);
  assert.equal(dep(b, "dep"), true);
  assert.equal(dep(b, "odep"), true);
});

clause(WANNABE, "0:rule", "only ONE character is picked (not two)", () => {
  const b = wanBoard();
  wanBlock(b);
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("dep"), b.id("odep")] }), "picking two characters");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("dep")] });
  assert.equal(dep(b, "dep"), false);
  assert.equal(dep(b, "odep"), true);
});

clause(WANNABE, "0:rule", "it is a character in play that is picked: one in a discard pile or in hand is refused", () => {
  for (const bad of ["ghost", "hc"]) {
    const b = wanBoard();
    wanBlock(b);
    refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id(bad)] }), `picking ${bad}`);
    answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("dep")] });
    assert.equal(dep(b, "dep"), false, "control: a character in play");
  }
});

clause(WANNABE, "0:rule", "a non-character cannot be picked (a depleted item)", () => {
  const b = wanBoard({ extra: [{ key: "it", def: item({ name: "DepItem" }), owner: P1, zone: "play", depleted: true }] });
  wanBlock(b);
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("it")] }), "picking an item");
  assert.equal(b.engine.state.cards[b.id("it")].depleted, true);
});

clause(WANNABE, "0:rule", "it can pick itself (a character) and restore it", () => {
  const b = wanBoard();
  b.engine.state.cards[b.id("w")].depleted = false;
  wanBlock(b);
  b.engine.state.cards[b.id("w")].depleted = true;
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("w")] });
  assert.equal(dep(b, "w"), false, "the blocker itself restored");
});

clause(WANNABE, "0:rule", "triggers only when THIS card blocks: another character blocking does not trigger it", () => {
  const b = wanBoard();
  wanBlock(b, ["b2"]);
  assert.equal(pending(b.engine), undefined, "no prompt when the other blocker blocks alone");
  assert.equal(dep(b, "dep"), true);
});

clause(WANNABE, "0:rule", "triggers when it blocks together with another blocker", () => {
  const b = wanBoard();
  wanBlock(b, ["w", "b2"]);
  assert.ok(pending(b.engine), "prompt");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("dep")] });
  assert.equal(dep(b, "dep"), false);
});

clause(WANNABE, "0:rule", "it does not trigger when it ATTACKS", () => {
  const b = wanBoard();
  b.engine.state.activePlayerId = P1;
  declareAttackBy(b.engine, P1, [b.id("w")]);
  assert.equal(pending(b.engine), undefined);
  declareBlockers(b.engine, P2, []);
  assert.equal(pending(b.engine), undefined, "not even when unblocked");
  assert.equal(dep(b, "dep"), true);
});

clause(WANNABE, "0:rule", "it does not trigger from hand (not in play)", () => {
  const b = wanBoard({ wZone: "hand" });
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  declareBlockers(b.engine, P1, [b.id("b2")]);
  assert.equal(pending(b.engine), undefined);
});

clause(WANNABE, "0:rule", "not blocking at all: no trigger", () => {
  const b = wanBoard();
  wanBlock(b, []);
  assert.equal(pending(b.engine), undefined);
});

// =====================================================================================================
// MULTI-ATTACHMENT MAN — character · gearsmith · mechanic · cost 3 · [E] · 2/3/1
// =====================================================================================================
type MamOpts = { copies?: number; deck?: boolean; extra?: CardPlacement[]; random?: () => number };
const mamBoard = (o: MamOpts = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      ...Array.from({ length: o.copies ?? 1 }, (_, i): CardPlacement => ({ key: i === 0 ? "m" : `m${i}`, def: printing(MAM), owner: P1, zone: "play" })),
      { key: "other", def: character({ name: "Bystander", strength: 1, life: 1 }), owner: P1, zone: "play" },
      { key: "k", def: killerDef(), owner: P2, zone: "play" },
      { key: "mass", def: massKillDef(), owner: P2, zone: "play" },
      ...(o.deck === false
        ? []
        : ([
            { key: "i1", def: item({ name: "DeckItemOne" }), owner: P1, zone: "deck" },
            { key: "i2", def: item({ name: "DeckItemTwo" }), owner: P1, zone: "deck" },
            { key: "c1", def: character({ name: "DeckChar", strength: 1, life: 1 }), owner: P1, zone: "deck" },
            { key: "t1", def: tactic({ name: "DeckTactic" }), owner: P1, zone: "deck" },
            { key: "c2", def: character({ name: "DeckChar2", strength: 1, life: 1 }), owner: P1, zone: "deck" },
            { key: "c3", def: character({ name: "DeckChar3", strength: 1, life: 1 }), owner: P1, zone: "deck" }
          ] as CardPlacement[])),
      { key: "oi", def: item({ name: "OppDeckItem" }), owner: P2, zone: "deck" },
      ...(o.extra ?? [])
    ],
    turn: 2,
    activePlayerId: P2,
    random: o.random ?? (() => 0.5)
  });
type MamBoard = ReturnType<typeof mamBoard>;
const killIt = (b: MamBoard, key: string) => {
  activate(b.engine, P2, b.id("k"), "kill", { selected: { t: [b.id(key)] } });
};
const mamPick = (b: MamBoard, key: string) => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id(key)] });

const mamDeploy = (elit: number, rage: number) =>
  buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "m", def: printing(MAM), owner: P1, zone: "hand" }, ...bank("elitism", elit, P1), ...bank("rage", rage, P1)],
    turn: 2
  });
clause(MAM, "0:rule", "printed card: character, gearsmith, mechanic, 2 / 3 / 1; cost 3 [E]: exactly 3 deploys, 2 refused, 3 without [E] refused", () => {
  const def = printing(MAM);
  assert.equal(def.type, "character");
  assert.equal(def.trade, "gearsmith");
  assert.deepEqual(def.subtype, ["mechanic"]);
  assert.equal(def.cost, 3);
  assert.equal(def.threshold, "e");
  const ok = mamDeploy(1, 2);
  play(ok.engine, P1, ok.id("m"));
  drain(ok.engine, declineAll);
  assert.equal(zoneOf(ok.engine, ok.id("m")), "play");
  assert.equal(ok.engine.getStat(ok.id("m"), "strength"), 2);
  assert.equal(ok.engine.getStat(ok.id("m"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("m"), "life"), 1);
  assert.equal(readyResources(ok.engine, P1), 0);
  const short = mamDeploy(1, 1);
  refused(() => play(short.engine, P1, short.id("m")), "2 resources for cost 3");
  const noIcon = mamDeploy(0, 3);
  refused(() => play(noIcon.engine, P1, noIcon.id("m")), "no [E]");
  for (const b of [short, noIcon]) assert.equal(zoneOf(b.engine, b.id("m")), "hand");
});

clause(MAM, "0:rule", "when destroyed you may search for an item: it is revealed and put into hand", () => {
  const b = mamBoard();
  const handBefore = handOf(b.engine, P1).length;
  killIt(b, "m");
  assert.equal(zoneOf(b.engine, b.id("m")), "discard");
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1);
  mamPick(b, "i2");
  assert.equal(pending(b.engine), undefined);
  assert.ok(handOf(b.engine, P1).includes(b.id("i2")), "the item is in hand");
  assert.equal(handOf(b.engine, P1).length, handBefore + 1);
  assert.ok(!deckOf(b.engine, P1).includes(b.id("i2")), "!deckOf(b.engine, P1).includes(b.id(\"i2\"))");
  const reveals = b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed");
  assert.equal(reveals.length, 1, "revealed");
  const ev = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual(ev.cardIds, [b.id("i2")]);
  assert.equal(ev.viewerId, "all");
});

clause(MAM, "0:rule", "only an ITEM can be found: a character or tactic in the deck is refused; only the controller's deck", () => {
  for (const bad of ["c1", "t1", "oi"]) {
    const b = mamBoard();
    killIt(b, "m");
    refused(() => mamPick(b, bad), `picking ${bad}`);
    assert.ok(!handOf(b.engine, P1).includes(b.id(bad)), `${bad} not in hand`);
    mamPick(b, "i1");
    assert.ok(handOf(b.engine, P1).includes(b.id("i1")), "control: an item of mine");
  }
});

clause(MAM, "0:rule", "it is a may: declining finds nothing ('if you do' does not happen) and hand is unchanged", () => {
  const b = mamBoard();
  const handBefore = [...handOf(b.engine, P1)];
  killIt(b, "m");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(pending(b.engine), undefined);
  assert.deepEqual(handOf(b.engine, P1), handBefore);
  assert.equal(b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed").length, 0, "nothing revealed");
});

clause(MAM, "0:rule", "only ONE item is found, not all of them", () => {
  const b = mamBoard();
  killIt(b, "m");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("i1"), b.id("i2")] }), "two items");
  mamPick(b, "i1");
  assert.ok(!handOf(b.engine, P1).includes(b.id("i2")), "!handOf(b.engine, P1).includes(b.id(\"i2\"))");
});

clause(MAM, "0:rule", "no item in the deck: destroying it is harmless (nothing found, no soft-lock)", () => {
  const b = mamBoard({ deck: false });
  killIt(b, "m");
  drain(b.engine, declineAll);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("m")), "discard");
  assert.equal(handOf(b.engine, P1).length, 0);
});

clause(MAM, "0:rule", "the searched deck is shuffled afterwards (CR 312.1), whether or not an item was taken", () => {
  const found = mamBoard({ random: () => 0 });
  const before = [...deckOf(found.engine, P1)];
  killIt(found, "m");
  mamPick(found, "i1");
  const unshuffled = before.filter((c) => c !== found.id("i1"));
  assert.deepEqual([...deckOf(found.engine, P1)].sort(), [...unshuffled].sort());
  assert.notDeepEqual(deckOf(found.engine, P1), unshuffled, "shuffled after taking an item");
  const declined = mamBoard({ random: () => 0 });
  const before2 = [...deckOf(declined.engine, P1)];
  killIt(declined, "m");
  answerPending(declined.engine, "chooserSelectsTarget", { selected: [] });
  assert.deepEqual([...deckOf(declined.engine, P1)].sort(), [...before2].sort());
  assert.notDeepEqual(deckOf(declined.engine, P1), before2, "shuffled after a declined search too");
});

clause(MAM, "0:rule", "destroyed by lethal battle damage also triggers it", () => {
  const b = mamBoard({ extra: [{ key: "atk", def: character({ name: "Hitter", strength: 2, life: 5 }), owner: P2, zone: "play" }] });
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  declareBlockers(b.engine, P1, [b.id("m")]);
  finishBattle(b.engine, undefined, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [b.id("i1")] } : declineAll(pc)));
  assert.equal(zoneOf(b.engine, b.id("m")), "discard");
  assert.ok(handOf(b.engine, P1).includes(b.id("i1")), "found an item after dying in battle");
});

clause(MAM, "0:rule", "it triggers for ITSELF only: another character of mine being destroyed does nothing", () => {
  const b = mamBoard();
  killIt(b, "other");
  assert.equal(zoneOf(b.engine, b.id("other")), "discard");
  assert.equal(pending(b.engine), undefined, "no search prompt");
  assert.equal(handOf(b.engine, P1).length, 0);
});

clause(MAM, "0:rule", "it does not trigger when it leaves play without being destroyed (returned to hand)", () => {
  const b = mamBoard({ extra: [{ key: "bounce", def: moverDef("play", "hand"), owner: P2, zone: "play" }] });
  activate(b.engine, P2, b.id("bounce"), "mv", { selected: { t: [b.id("m")] } });
  assert.equal(zoneOf(b.engine, b.id("m")), "hand");
  assert.equal(pending(b.engine), undefined, "bounced, not destroyed");
});

clause(MAM, "0:rule", "two copies destroyed together each search (two items found, order prompt answered)", () => {
  const b = mamBoard({ copies: 2 });
  activate(b.engine, P2, b.id("mass"), "mass");
  let picks = 0;
  const wanted = ["i1", "i2"];
  drain(b.engine, (pc) => {
    if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [b.id(wanted[picks++])] };
    return declineAll(pc);
  });
  assert.equal(picks, 2, "two searches");
  assert.ok(handOf(b.engine, P1).includes(b.id("i1")) && handOf(b.engine, P1).includes(b.id("i2")), "both items found");
});

// referenced to keep helper imports used when parts of the suite are edited
void clauseMismatch;
