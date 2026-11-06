// Clause tests, batch seed-saga-02, part p1 (groups 1-5, missing clauses only):
// High-Priest of Thabbash, Hungermaw Deephate, Imperial Thaumaturge, Inhibit, Living God of Thabbash.
// Every expectation is read from the PRINTED text.

import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  bank,
  bounceTactic,
  character,
  developFaction,
  drawerChar,
  item,
  killTactic,
  location,
  play,
  resolvePendingResponses,
  tactic,
  uniqueChar,
  P1,
  P2
} from "../per-card/_harness.js";
import type { StapleIcon } from "../per-card/_harness.js";
import { clause, printing, refused } from "./_clause.js";
import { answerPending, pending, zoneOf } from "./_board.js";
import { playRaw } from "./_battle.js";
import { endTurn, factionOf } from "./_turn.js";
import type { PlayerId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- shared helpers (this file only) ------------------------------------------------

const FACTION_KEY: Record<string, string> = { [P1]: "__factionA", [P2]: "__factionB" };

/** `n` already-SPENT resources (attached to the owner's faction): they count toward thresholds but can't pay. */
function spent(icon: StapleIcon, n: number, owner: PlayerId = P1): CardPlacement[] {
  return bank(icon, n, owner).map((placement) => ({ ...placement, attachedToKey: FACTION_KEY[owner] }));
}

const handOf = (engine: SpoilsEngine, p: PlayerId): string[] => [...engine.state.players[p].hand];
const discardOf = (engine: SpoilsEngine, p: PlayerId): string[] => [...engine.state.players[p].discard];
const ready = (engine: SpoilsEngine, p: PlayerId = P1): number => engine.getAvailableResourceCount(p);
const isDepleted = (engine: SpoilsEngine, cardId: string): boolean => engine.state.cards[cardId].depleted === true;

const rawActivate = (
  engine: SpoilsEngine,
  player: PlayerId,
  cardId: string,
  abilityId: string,
  selected: Record<string, string[]> = {}
): void => {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected, variables: {} } as never);
};

const pad = (prefix: string, n: number, owner: PlayerId, zone: CardPlacement["zone"]): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: character({ name: `${prefix} ${i}`, cost: 0 }), owner, zone }));

const resourceIdOf = (engine: SpoilsEngine, p: PlayerId): string =>
  engine.state.players[p].play.find((c) => engine.getDefinition(c).type === "resource")!;

/** Answer every pending "opponent chooses a discard" prompt with the first card of the chooser's hand. */
function drainDiscards(engine: SpoilsEngine, pick: (hand: string[]) => string = (h) => h[0]): number {
  let n = 0;
  for (let guard = 0; guard < 10 && engine.state.pendingChoice; guard++) {
    const pc = pending(engine)!;
    if (pc.kind !== "chooserSelectsTarget") throw new Error(`unexpected pending choice ${pc.kind}`);
    const hand = handOf(engine, pc.playerId as PlayerId);
    answerPending(engine, "chooserSelectsTarget", { selected: [pick(hand)] });
    n++;
  }
  return n;
}

// =========================================================================================
// HIGH-PRIEST OF THABBASH
// =========================================================================================

const HP = "779f0d80-fce8-4232-9c50-e69c3d498bf1"; // UNIQUE GLOAMSPIKE -- NEGATE -- COST: Pay 2. Deplete this card. Discard a card. Pick a card being deployed of the same type as the discarded card. -- EFFECT: Terminate the card being deployed.

const foeTactic = () =>
  tactic({
    name: "FoeTactic",
    cost: 0,
    behavior: { abilities: [{ id: "d", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });

const FOE_DEFS: Record<string, () => ReturnType<typeof character>> = {
  character: () => character({ name: "FoeChar", cost: 0 }),
  item: () => item({ name: "FoeItem", cost: 0 }),
  tactic: foeTactic,
  location: () => location({ name: "FoeLoc", cost: 0 })
};
const MY_DEFS: Record<string, () => ReturnType<typeof character>> = {
  character: () => character({ name: "MyChar", cost: 0 }),
  item: () => item({ name: "MyItem", cost: 0 }),
  tactic: () => tactic({ name: "MyTactic", cost: 0 }),
  location: () => location({ name: "MyLoc", cost: 0 })
};

function hpBoard(o: { res?: CardPlacement[]; hand?: boolean; hpDepleted?: boolean; handCards?: boolean; active?: PlayerId; extra?: CardPlacement[] } = {}) {
  const active = o.active ?? P2;
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: active,
    cards: [
      { key: "hp", def: printing(HP), owner: P1, zone: o.hand ? "hand" : "play", depleted: o.hpDepleted },
      ...(o.handCards === false
        ? []
        : Object.entries(MY_DEFS).map(([t, d]) => ({ key: `my-${t}`, def: d(), owner: P1, zone: "hand" as const }))),
      ...Object.entries(FOE_DEFS).map(([t, d]) => ({ key: `foe-${t}`, def: d(), owner: P2, zone: "hand" as const })),
      ...pad("p2deck", 3, P2, "deck"),
      ...pad("p1deck", 3, P1, "deck"),
      ...(o.res ?? bank("obsession", 2, P1)),
      ...(o.extra ?? [])
    ]
  });
}
type HpBoard = ReturnType<typeof hpBoard>;

const hpResponse = (b: HpBoard, foe: string, disc: string, drain = true) => {
  rawActivate(b.engine, P1, b.id("hp"), "negate", { dep: [b.id(foe)], disc: [b.id(disc)] });
  if (drain) resolvePendingResponses(b.engine);
};

clause(HP, "0:unique", "printed type / trade / cost 4 / threshold [O][O][O] / 3-3-3 / subtypes; exact cost works, one short or one icon short is refused", () => {
  const b0 = hpBoard({ hand: true, active: P1, res: bank("obsession", 4, P1) });
  const d = b0.engine.getDefinition(b0.id("hp"));
  assert.deepEqual([d.type, d.trade, d.cost, d.threshold, d.strength, d.speed, d.life], ["character", "arcanist", 4, "ooo", 3, 3, 3]);
  assert.deepEqual([...(d.subtype ?? [])].sort(), ["gloamspike", "priest"]);
  play(b0.engine, P1, b0.id("hp"));
  assert.equal(zoneOf(b0.engine, b0.id("hp")), "play");
  assert.equal(ready(b0.engine), 0, "cost 4 was paid");
  assert.deepEqual([b0.engine.getStat(b0.id("hp"), "strength"), b0.engine.getStat(b0.id("hp"), "speed"), b0.engine.getStat(b0.id("hp"), "life")], [3, 3, 3]);
  const short = hpBoard({ hand: true, active: P1, res: bank("obsession", 3, P1) });
  refused(() => play(short.engine, P1, short.id("hp")), "cost 4 with 3 resources", /Costs cannot be paid/);
  const noIcon = hpBoard({ hand: true, active: P1, res: [...bank("obsession", 2, P1), ...bank("rage", 2, P1)] });
  refused(() => play(noIcon.engine, P1, noIcon.id("hp")), "threshold [O][O][O] with two [O]", /Threshold requirements/);
});

function uniqueBoard(o: { second: "hand" | "play"; secondOwner?: PlayerId; res?: number }) {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "hp", def: printing(HP), owner: P1, zone: "play" },
      { key: "hp2", def: printing(HP), owner: o.secondOwner ?? P1, zone: o.second },
      ...bank("obsession", o.res ?? 8, P1)
    ]
  });
}

clause(HP, "0:unique", "a second copy under one controller forces that controller to choose which to keep; the other is destroyed (both choices)", () => {
  for (const keep of ["hp2", "hp"] as const) {
    const { engine, id } = uniqueBoard({ second: "hand" });
    play(engine, P1, id("hp2"));
    const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string; candidates: string[] };
    assert.equal(pc.kind, "uniqueSurvivor");
    assert.equal(pc.playerId, P1, "the controller chooses");
    assert.deepEqual([...pc.candidates].sort(), [id("hp"), id("hp2")].sort());
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id(keep) } } as never);
    const lost = keep === "hp" ? "hp2" : "hp";
    assert.equal(zoneOf(engine, id(keep)), "play");
    assert.equal(zoneOf(engine, id(lost)), "discard", "the other copy is destroyed");
    assert.equal(engine.state.pendingChoice, undefined);
  }
});

clause(HP, "0:unique", "UNIQUE is per player: the opponent controlling their own copy, and a different UNIQUE designation, raise no choice", () => {
  const opp = uniqueBoard({ second: "play", secondOwner: P2 });
  assert.equal(opp.engine.state.pendingChoice, undefined, "opponent's copy is fine");
  assert.equal(zoneOf(opp.engine, opp.id("hp")), "play");
  assert.equal(zoneOf(opp.engine, opp.id("hp2")), "play");
  const other = buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "hp", def: printing(HP), owner: P1, zone: "play" },
      { key: "u", def: uniqueChar({ name: "Highlander" }), owner: P1, zone: "hand" },
      ...bank("obsession", 8, P1)
    ]
  });
  play(other.engine, P1, other.id("u"));
  assert.equal(other.engine.state.pendingChoice, undefined, "a different UNIQUE designation does not clash");
  assert.equal(zoneOf(other.engine, other.id("u")), "play");
  assert.equal(zoneOf(other.engine, other.id("hp")), "play");
});

clause(HP, "0:unique", "the keyword gloamspike is the UNIQUE designation: a different card carrying it also clashes", () => {
  const b = buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "hp", def: printing(HP), owner: P1, zone: "play" },
      { key: "g", def: uniqueChar({ name: "Other Gloam", unique: "gloamspike" }), owner: P1, zone: "hand" },
      ...bank("obsession", 8, P1)
    ]
  });
  play(b.engine, P1, b.id("g"));
  assert.equal(b.engine.state.pendingChoice?.kind, "uniqueSurvivor");
});

clause(HP, "1:ability:negate", "pay 2, deplete, discard a card of the same type: terminates the card being deployed (all four deployable types)", () => {
  for (const type of ["character", "item", "tactic", "location"]) {
    const b = hpBoard({ res: bank("obsession", 2, P1) });
    const p2Hand = handOf(b.engine, P2).length;
    const p2DeckBefore = [...b.engine.state.players[P2].deck];
    playRaw(b.engine, P2, b.id(`foe-${type}`));
    assert.equal(zoneOf(b.engine, b.id(`foe-${type}`)), "deploying", `${type} is being deployed`);
    assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "P1 may respond");
    hpResponse(b, `foe-${type}`, `my-${type}`);
    assert.equal(b.engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(b.engine, b.id(`foe-${type}`)), "discard", `${type} terminated`);
    assert.ok(discardOf(b.engine, P2).includes(b.id(`foe-${type}`)), "into its owner's discard pile");
    assert.equal(handOf(b.engine, P2).length, p2Hand - 1, "only the played card left the hand");
    assert.deepEqual([...b.engine.state.players[P2].deck], p2DeckBefore, "a terminated tactic never resolved (no draw)");
    assert.equal(ready(b.engine), 0, "COST: pay 2");
    assert.equal(isDepleted(b.engine, b.id("hp")), true, "COST: deplete this card");
    assert.equal(zoneOf(b.engine, b.id(`my-${type}`)), "discard", "COST: discarded card");
    assert.ok(discardOf(b.engine, P1).includes(b.id(`my-${type}`)), "discardOf(b.engine, P1).includes(b.id(`my-${type}`))");
    for (const other of Object.keys(MY_DEFS).filter((t) => t !== type)) assert.equal(zoneOf(b.engine, b.id(`my-${other}`)), "hand", "other hand cards untouched");
    assert.equal(zoneOf(b.engine, b.id("hp")), "play");
  }
});

clause(HP, "1:ability:negate", "without terminating, the deployed card does resolve (control) and the opponent holds it only while I respond", () => {
  const b = hpBoard();
  playRaw(b.engine, P2, b.id("foe-character"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foe-character")), "play", "control: unanswered, it enters play");
  const t = hpBoard();
  const deck = t.engine.state.players[P2].deck.length;
  playRaw(t.engine, P2, t.id("foe-tactic"));
  resolvePendingResponses(t.engine);
  assert.equal(t.engine.state.players[P2].deck.length, deck - 1, "control: unanswered, the tactic draws");
});

clause(HP, "1:ability:negate", "the discarded card must be the same type as the card being deployed (each mismatched pairing refused)", () => {
  const types = ["character", "item", "tactic", "location"];
  for (const foe of types) {
    for (const mine of types) {
      if (foe === mine) continue;
      const b = hpBoard();
      playRaw(b.engine, P2, b.id(`foe-${foe}`));
      refused(() => hpResponse(b, `foe-${foe}`, `my-${mine}`, false), `discarding a ${mine} against a ${foe}`);
      assert.equal(zoneOf(b.engine, b.id(`my-${mine}`)), "hand", "nothing was discarded");
      assert.equal(isDepleted(b.engine, b.id("hp")), false, "nothing was depleted");
      assert.equal(ready(b.engine), 2, "nothing was paid");
      assert.equal(zoneOf(b.engine, b.id(`foe-${foe}`)), "deploying");
    }
  }
  const ok = hpBoard();
  playRaw(ok.engine, P2, ok.id("foe-item"));
  hpResponse(ok, "foe-item", "my-item");
  assert.equal(zoneOf(ok.engine, ok.id("foe-item")), "discard", "control: matching type works");
});

clause(HP, "1:ability:negate", "the pick must be a card being deployed: a card already in play, in hand or in a discard pile is refused", () => {
  const b = hpBoard({ extra: [{ key: "inplay", def: character({ name: "InPlay" }), owner: P2, zone: "play" }] });
  playRaw(b.engine, P2, b.id("foe-character"));
  refused(() => rawActivate(b.engine, P1, b.id("hp"), "negate", { dep: [b.id("inplay")], disc: [b.id("my-character")] }), "card in play is not being deployed");
  refused(() => rawActivate(b.engine, P1, b.id("hp"), "negate", { dep: [b.id("foe-item")], disc: [b.id("my-item")] }), "card in hand is not being deployed");
  assert.equal(zoneOf(b.engine, b.id("inplay")), "play");
  assert.equal(isDepleted(b.engine, b.id("hp")), false);
  hpResponse(b, "foe-character", "my-character");
  assert.equal(zoneOf(b.engine, b.id("foe-character")), "discard", "control: the deploying card is valid");
  assert.equal(zoneOf(b.engine, b.id("inplay")), "play");
});

clause(HP, "1:ability:negate", "needs a card being deployed at all: refused with an empty stack", () => {
  const b = hpBoard();
  refused(() => rawActivate(b.engine, P1, b.id("hp"), "negate", { dep: [b.id("foe-character")], disc: [b.id("my-character")] }), "nothing is being deployed", /cannot be used at the current timing/);
  assert.equal(ready(b.engine), 2);
  assert.equal(isDepleted(b.engine, b.id("hp")), false);
});

clause(HP, "1:ability:negate", "COST: pay 2 - one resource short is refused with nothing spent, depleted or discarded; exactly 2 works", () => {
  const b = hpBoard({ res: bank("obsession", 1, P1) });
  playRaw(b.engine, P2, b.id("foe-character"));
  refused(() => hpResponse(b, "foe-character", "my-character", false), "pay 2 with 1 ready", /Ability costs cannot be paid/);
  assert.equal(isDepleted(b.engine, b.id("hp")), false);
  assert.equal(zoneOf(b.engine, b.id("my-character")), "hand");
  assert.equal(ready(b.engine), 1);
  const spentOnly = hpBoard({ res: [...bank("obsession", 1, P1), ...spent("obsession", 3, P1)] });
  playRaw(spentOnly.engine, P2, spentOnly.id("foe-character"));
  refused(() => hpResponse(spentOnly, "foe-character", "my-character", false), "spent resources can't pay", /Ability costs cannot be paid/);
  const ok = hpBoard({ res: bank("obsession", 3, P1) });
  playRaw(ok.engine, P2, ok.id("foe-character"));
  hpResponse(ok, "foe-character", "my-character");
  assert.equal(ready(ok.engine), 1, "exactly 2 of 3 were paid");
});

clause(HP, "1:ability:negate", "COST: deplete this card - refused while depleted, and it can't be used twice", () => {
  const dep = hpBoard({ hpDepleted: true });
  playRaw(dep.engine, P2, dep.id("foe-character"));
  refused(() => hpResponse(dep, "foe-character", "my-character", false), "depleted High-Priest", /Ability costs cannot be paid/);
  assert.equal(zoneOf(dep.engine, dep.id("my-character")), "hand");
  assert.equal(ready(dep.engine), 2);
  const b = hpBoard({ res: bank("obsession", 4, P1) });
  playRaw(b.engine, P2, b.id("foe-character"));
  hpResponse(b, "foe-character", "my-character");
  assert.equal(zoneOf(b.engine, b.id("foe-character")), "discard");
  playRaw(b.engine, P2, b.id("foe-item"));
  refused(() => rawActivate(b.engine, P1, b.id("hp"), "negate", { dep: [b.id("foe-item")], disc: [b.id("my-item")] }), "already depleted by the first use", /Ability costs cannot be paid/);
});

clause(HP, "1:ability:negate", "COST: discard a card - refused with no card in hand; the discarded card comes from my hand only", () => {
  const b = hpBoard({ handCards: false });
  playRaw(b.engine, P2, b.id("foe-character"));
  refused(() => rawActivate(b.engine, P1, b.id("hp"), "negate", { dep: [b.id("foe-character")] }), "no card to discard");
  assert.equal(isDepleted(b.engine, b.id("hp")), false);
  assert.equal(ready(b.engine), 2, "nothing paid");
  const c = hpBoard();
  playRaw(c.engine, P2, c.id("foe-tactic"));
  refused(() => rawActivate(c.engine, P1, c.id("hp"), "negate", { dep: [c.id("foe-tactic")], disc: [c.id("foe-character")] }), "can't discard from the opponent's hand");
  assert.equal(zoneOf(c.engine, c.id("foe-character")), "hand");
});

clause(HP, "1:ability:negate", "a player can't respond to their own deployment (CR 607.1)", () => {
  const b = hpBoard({ active: P1, extra: [{ key: "own", def: character({ name: "OwnDeploy", cost: 0 }), owner: P1, zone: "hand" }] });
  playRaw(b.engine, P1, b.id("own"));
  refused(() => rawActivate(b.engine, P1, b.id("hp"), "negate", { dep: [b.id("own")], disc: [b.id("my-character")] }), "responding to my own deploy", /current timing/);
  assert.equal(isDepleted(b.engine, b.id("hp")), false);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("own")), "play", "my own card resolved normally");
});

// =========================================================================================
// HUNGERMAW DEEPHATE
// =========================================================================================

const HM = "bc73e1ca-85a1-46af-9eff-4033ca6013e5"; // UNIQUE HUNGERMAW -- enters with 8 tokens -- +1 str/+1 life per token -- EJECT

function hmBoard(o: { zone?: "hand" | "play"; tokens?: number; res?: CardPlacement[]; extra?: CardPlacement[]; second?: boolean } = {}) {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      {
        key: "hm",
        def: printing(HM),
        owner: P1,
        zone: o.zone ?? "play",
        counters: o.tokens !== undefined ? { token: o.tokens } : undefined
      },
      ...(o.second ? [{ key: "hm2", def: printing(HM), owner: P1, zone: "hand" as const }] : []),
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 2 }), owner: P2, zone: "play" },
      ...(o.res ?? []),
      ...(o.extra ?? [])
    ]
  });
}

clause(HM, "0:unique", "printed type / trade / cost 8 / threshold [O] / 0-3-0 / subtypes; exact cost works, one short or no [O] is refused", () => {
  const b0 = hmBoard({ zone: "hand", res: bank("obsession", 8, P1) });
  const d = b0.engine.getDefinition(b0.id("hm"));
  assert.deepEqual([d.type, d.trade, d.cost, d.threshold, d.strength, d.speed, d.life], ["character", "arcanist", 8, "o", 0, 3, 0]);
  assert.deepEqual([...(d.subtype ?? [])].sort(), ["dragon", "seraphim"]);
  play(b0.engine, P1, b0.id("hm"));
  assert.equal(zoneOf(b0.engine, b0.id("hm")), "play");
  assert.equal(ready(b0.engine), 0, "cost 8 paid");
  assert.equal(b0.engine.getStat(b0.id("hm"), "speed"), 3);
  const short = hmBoard({ zone: "hand", res: bank("obsession", 7, P1) });
  refused(() => play(short.engine, P1, short.id("hm")), "cost 8 with 7", /Costs cannot be paid/);
  const noIcon = hmBoard({ zone: "hand", res: bank("rage", 8, P1) });
  refused(() => play(noIcon.engine, P1, noIcon.id("hm")), "no [O] icon", /Threshold requirements/);
});

clause(HM, "0:unique", "a second Hungermaw makes its controller choose which to keep; the opponent's copy is not affected", () => {
  for (const keep of ["hm2", "hm"] as const) {
    const { engine, id } = hmBoard({ tokens: 8, second: true, res: bank("obsession", 8, P1) });
    play(engine, P1, id("hm2"));
    const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string; candidates: string[] };
    assert.equal(pc.kind, "uniqueSurvivor");
    assert.equal(pc.playerId, P1);
    assert.deepEqual([...pc.candidates].sort(), [id("hm"), id("hm2")].sort());
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id(keep) } } as never);
    assert.equal(zoneOf(engine, id(keep)), "play");
    assert.equal(zoneOf(engine, id(keep === "hm" ? "hm2" : "hm")), "discard");
  }
  const opp = hmBoard({ tokens: 8, extra: [{ key: "hmOpp", def: printing(HM), owner: P2, zone: "play", counters: { token: 8 } }] });
  assert.equal(opp.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(opp.engine, opp.id("hm")), "play");
  assert.equal(zoneOf(opp.engine, opp.id("hmOpp")), "play");
});

clause(HM, "0:unique", "UNIQUE HUNGERMAW is a designation: another card with designation HUNGERMAW conflicts with it, a card of another designation does not", () => {
  const same = hmBoard({ tokens: 8, extra: [{ key: "x", def: character({ name: "Imposter", cost: 0, unique: "hungermaw" } as never), owner: P1, zone: "hand" }] });
  play(same.engine, P1, same.id("x"));
  const pc = same.engine.state.pendingChoice as unknown as { kind: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor", "a different card with designation HUNGERMAW forces a survivor choice");
  assert.deepEqual([...pc.candidates].sort(), [same.id("hm"), same.id("x")].sort());
  const other = hmBoard({ tokens: 8, extra: [{ key: "x", def: character({ name: "Imposter", cost: 0, unique: "somethingelse" } as never), owner: P1, zone: "hand" }] });
  play(other.engine, P1, other.id("x"));
  assert.equal(other.engine.state.pendingChoice, undefined, "a card of another designation does not conflict");
  assert.equal(zoneOf(other.engine, other.id("hm")), "play");
  assert.equal(zoneOf(other.engine, other.id("x")), "play");
});

clause(HM, "2:rule", "the token bonus is ADDED to other modifiers: with a permanent +2 strength / +3 life modifier on it, 8 tokens give 10 strength / 11 life", () => {
  const boost = item({
    name: "Boost",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "boost",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character", controller: "self" }, count: 1 }],
          effects: [
            { type: "createModifier", target: { type: "selected", id: "t" }, stat: "strength", operation: "add", value: 2, duration: { type: "permanent" } },
            { type: "createModifier", target: { type: "selected", id: "t" }, stat: "life", operation: "add", value: 3, duration: { type: "permanent" } }
          ]
        }
      ]
    }
  } as never);
  const b = hmBoard({ tokens: 8, extra: [{ key: "boost", def: boost, owner: P1, zone: "play" }] });
  activate(b.engine, P1, b.id("boost"), "boost", { selected: { t: [b.id("hm")] } });
  assert.deepEqual([b.engine.getStat(b.id("hm"), "strength"), b.engine.getStat(b.id("hm"), "life")], [10, 11], "tokens + modifier");
  b.engine.state.cards[b.id("hm")].counters = { token: 3 } as never;
  assert.deepEqual([b.engine.getStat(b.id("hm"), "strength"), b.engine.getStat(b.id("hm"), "life")], [5, 6], "3 tokens + modifier");
});

clause(HM, "1:rule", "enters play with exactly 8 tokens on it (and no tokens in hand); other cards entering gain none", () => {
  const b = hmBoard({ zone: "hand", res: bank("obsession", 8, P1) });
  assert.equal(b.engine.state.cards[b.id("hm")].counters?.token ?? 0, 0, "no tokens in hand");
  play(b.engine, P1, b.id("hm"));
  assert.equal(b.engine.state.cards[b.id("hm")].counters?.token, 8);
  assert.equal(b.engine.state.pendingChoice, undefined);
  const c = hmBoard({ tokens: 8, extra: [{ key: "newbie", def: character({ name: "Newbie", cost: 0 }), owner: P1, zone: "hand" }] });
  play(c.engine, P1, c.id("newbie"));
  assert.equal(zoneOf(c.engine, c.id("newbie")), "play");
  assert.equal(c.engine.state.cards[c.id("hm")].counters?.token, 8, "another card entering does not add tokens to it");
  assert.equal(c.engine.state.cards[c.id("newbie")].counters?.token ?? 0, 0, "and gets none itself");
  const d = hmBoard({ zone: "hand", res: bank("obsession", 8, P1), extra: [{ key: "newbie", def: character({ name: "Newbie", cost: 0 }), owner: P1, zone: "hand" }] });
  play(d.engine, P1, d.id("newbie"));
  assert.equal(d.engine.state.cards[d.id("hm")].counters?.token ?? 0, 0, "Hungermaw in hand gets no tokens when another card enters play");
});

clause(HM, "2:rule", "gains 1 strength and 1 life per token on it (0 printed): 8 tokens is 8/8, other values follow", () => {
  const b = hmBoard({ zone: "hand", res: bank("obsession", 8, P1) });
  play(b.engine, P1, b.id("hm"));
  assert.deepEqual([b.engine.getStat(b.id("hm"), "strength"), b.engine.getStat(b.id("hm"), "life")], [8, 8]);
  for (const n of [1, 3, 5]) {
    const c = hmBoard({ tokens: n });
    assert.deepEqual([c.engine.getStat(c.id("hm"), "strength"), c.engine.getStat(c.id("hm"), "life")], [n, n], `${n} tokens`);
    assert.equal(c.engine.getStat(c.id("hm"), "speed"), 3, "speed unaffected");
  }
});

clause(HM, "2:rule", "only tokens on THIS card count: tokens on other cards, and other counter kinds, add nothing", () => {
  const b = hmBoard({
    tokens: 2,
    extra: [{ key: "tokenFoe", def: character({ name: "TokenFoe", strength: 1, life: 1 }), owner: P2, zone: "play", counters: { token: 5 } }]
  });
  assert.deepEqual([b.engine.getStat(b.id("hm"), "strength"), b.engine.getStat(b.id("hm"), "life")], [2, 2]);
  assert.deepEqual([b.engine.getStat(b.id("tokenFoe"), "strength"), b.engine.getStat(b.id("tokenFoe"), "life")], [1, 1], "no stat change for other cards' tokens");
  const c = hmBoard({ tokens: 2, extra: [] });
  c.engine.state.cards[c.id("hm")].counters = { token: 2, other: 4 } as never;
  assert.deepEqual([c.engine.getStat(c.id("hm"), "strength"), c.engine.getStat(c.id("hm"), "life")], [2, 2], "only 'token' counters count");
});

clause(HM, "2:rule", "the bonus follows the token count live: removing tokens lowers it; damage matters against the scaled life", () => {
  const b = hmBoard({ tokens: 4, res: [] });
  activate(b.engine, P1, b.id("hm"), "eject", { selected: { kick: [b.id("foe")] } });
  assert.equal(b.engine.state.cards[b.id("hm")].counters?.token, 2);
  assert.deepEqual([b.engine.getStat(b.id("hm"), "strength"), b.engine.getStat(b.id("hm"), "life")], [2, 2]);
  const d = buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [{ key: "hm", def: printing(HM), owner: P1, zone: "play", counters: { token: 8 }, damage: 7 }]
  });
  assert.equal(zoneOf(d.engine, d.id("hm")), "play", "8 life, 7 damage: survives");
});

clause(HM, "2:rule", "Hungermaw: at 0 tokens it is 0 life and is destroyed", () => {
  const b = hmBoard({ tokens: 2 });
  activate(b.engine, P1, b.id("hm"), "eject", { selected: { kick: [b.id("foe")] } });
  assert.equal(b.engine.state.cards[b.id("hm")].counters?.token ?? 0, 0);
  assert.equal(b.engine.getStat(b.id("hm"), "life"), 0);
  assert.equal(zoneOf(b.engine, b.id("hm")), "discard", "0 life destroys it");
});

clause(HM, "3:ability:eject", "COST: remove 2 tokens; EFFECT: the picked card goes to its owner's hand (own, opponent's)", () => {
  for (const [target, owner] of [["mine", P1], ["foe", P2]] as const) {
    const b = hmBoard({ tokens: 8 });
    activate(b.engine, P1, b.id("hm"), "eject", { selected: { kick: [b.id(target)] } });
    assert.equal(b.engine.state.cards[b.id("hm")].counters?.token, 6, "COST: 2 tokens removed");
    assert.equal(zoneOf(b.engine, b.id(target)), "hand");
    assert.ok(handOf(b.engine, owner).includes(b.id(target)), "owner's hand");
    assert.equal(zoneOf(b.engine, b.id("hm")), "play");
    assert.equal(isDepleted(b.engine, b.id("hm")), false, "no deplete in the cost");
  }
});

clause(HM, "3:ability:eject", "any non-resource card type can be picked: item, location; the card goes to its OWNER's hand even when I control it", () => {
  const b = hmBoard({
    tokens: 8,
    extra: [
      { key: "it", def: item({ name: "TheItem" }), owner: P1, zone: "play" },
      { key: "loc", def: location({ name: "TheLoc" }), owner: P2, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 }
    ]
  });
  activate(b.engine, P1, b.id("hm"), "eject", { selected: { kick: [b.id("it")] } });
  assert.ok(handOf(b.engine, P1).includes(b.id("it")), "handOf(b.engine, P1).includes(b.id(\"it\"))");
  activate(b.engine, P1, b.id("hm"), "eject", { selected: { kick: [b.id("loc")] } });
  assert.ok(handOf(b.engine, P2).includes(b.id("loc")), "handOf(b.engine, P2).includes(b.id(\"loc\"))");
  activate(b.engine, P1, b.id("hm"), "eject", { selected: { kick: [b.id("stolen")] } });
  assert.ok(handOf(b.engine, P2).includes(b.id("stolen")), "owner P2's hand, not the controller's");
  assert.equal(handOf(b.engine, P1).includes(b.id("stolen")), false);
  assert.equal(b.engine.state.cards[b.id("hm")].counters?.token, 2, "three uses removed 6 tokens");
});

clause(HM, "3:ability:eject", "refused when it can't remove 2 tokens (1 token, 0 tokens); exactly 2 works", () => {
  for (const n of [0, 1]) {
    const b = hmBoard({ tokens: n });
    refused(() => activate(b.engine, P1, b.id("hm"), "eject", { selected: { kick: [b.id("foe")] } }), `${n} tokens`, /Ability costs cannot be paid/);
    assert.equal(zoneOf(b.engine, b.id("foe")), "play");
    assert.equal(b.engine.state.cards[b.id("hm")].counters?.token ?? 0, n);
  }
  const ok = hmBoard({ tokens: 2 });
  activate(ok.engine, P1, ok.id("hm"), "eject", { selected: { kick: [ok.id("foe")] } });
  assert.equal(zoneOf(ok.engine, ok.id("foe")), "hand");
  assert.equal(ok.engine.state.cards[ok.id("hm")].counters?.token ?? 0, 0);
});

clause(HM, "3:ability:eject", "the pick must be ANOTHER card (not itself), non-resource (no resource, no face-down card), and in play", () => {
  const b = hmBoard({
    tokens: 8,
    res: bank("obsession", 1, P1),
    extra: [
      { key: "fd", def: character({ name: "FaceDown" }), owner: P1, zone: "play", faceDown: true },
      { key: "inhand", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
      { key: "indisc", def: character({ name: "InDisc" }), owner: P2, zone: "discard" },
      ...bank("greed", 1, P2)
    ]
  });
  const eject = (t: string) => () => activate(b.engine, P1, b.id("hm"), "eject", { selected: { kick: [t] } });
  refused(eject(b.id("hm")), "itself");
  refused(eject(resourceIdOf(b.engine, P1)), "own resource");
  refused(eject(resourceIdOf(b.engine, P2)), "opponent's resource");
  refused(eject(b.id("fd")), "a face-down card is a resource");
  refused(eject(factionOf(b.engine, P2)), "a faction is not a pickable non-resource card");
  refused(eject(b.id("inhand")), "card in hand");
  refused(eject(b.id("indisc")), "card in a discard pile");
  assert.equal(b.engine.state.cards[b.id("hm")].counters?.token, 8, "no refused attempt cost tokens");
  assert.equal(zoneOf(b.engine, b.id("hm")), "play");
  eject(b.id("foe"))();
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand", "control");
});

clause(HM, "3:ability:eject", "can be used repeatedly in one turn while tokens last, and doesn't need Hungermaw to be ready", () => {
  const b = hmBoard({ tokens: 8, extra: [{ key: "x1", def: character({ name: "X1" }), owner: P2, zone: "play" }] });
  b.engine.state.cards[b.id("hm")].depleted = true;
  activate(b.engine, P1, b.id("hm"), "eject", { selected: { kick: [b.id("foe")] } });
  activate(b.engine, P1, b.id("hm"), "eject", { selected: { kick: [b.id("x1")] } });
  assert.equal(b.engine.state.cards[b.id("hm")].counters?.token, 4);
  assert.equal(zoneOf(b.engine, b.id("x1")), "hand");
});

// =========================================================================================
// IMPERIAL THAUMATURGE
// =========================================================================================

const IT = "7c5a0e32-65ca-4f3d-937e-91df2737cdd1"; // TICKLE -- COST: Pay 1. Deplete this card. -- EFFECT: An opponent discards a card.

function itBoard(o: { res?: CardPlacement[]; zone?: "hand" | "play"; depleted?: boolean; oppHand?: number } = {}) {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "it", def: printing(IT), owner: P1, zone: o.zone ?? "play", depleted: o.depleted },
      ...pad("mineH", 2, P1, "hand"),
      ...pad("oppH", o.oppHand ?? 3, P2, "hand"),
      ...pad("oppD", 2, P2, "deck"),
      ...(o.res ?? bank("rage", 1, P1))
    ]
  });
}

clause(IT, "0:ability:tickle", "printed type / trade / cost 6 / threshold [O][O] / 4-3-5 / wizard; exact cost works, one short or one icon short is refused", () => {
  const b = itBoard({ zone: "hand", res: bank("obsession", 6, P1) });
  const d = b.engine.getDefinition(b.id("it"));
  assert.deepEqual([d.type, d.trade, d.cost, d.threshold, d.strength, d.speed, d.life], ["character", "arcanist", 6, "oo", 4, 3, 5]);
  assert.deepEqual([...(d.subtype ?? [])], ["wizard"]);
  play(b.engine, P1, b.id("it"));
  assert.equal(zoneOf(b.engine, b.id("it")), "play");
  assert.equal(ready(b.engine), 0);
  assert.deepEqual([b.engine.getStat(b.id("it"), "strength"), b.engine.getStat(b.id("it"), "speed"), b.engine.getStat(b.id("it"), "life")], [4, 3, 5]);
  const short = itBoard({ zone: "hand", res: bank("obsession", 5, P1) });
  refused(() => play(short.engine, P1, short.id("it")), "cost 6 with 5", /Costs cannot be paid/);
  const noIcon = itBoard({ zone: "hand", res: [...bank("obsession", 1, P1), ...bank("rage", 5, P1)] });
  refused(() => play(noIcon.engine, P1, noIcon.id("it")), "one [O]", /Threshold requirements/);
});

clause(IT, "0:ability:tickle", "COST: pay 1 and deplete; EFFECT: the opponent (not me) discards a card of THEIR choice", () => {
  const b = itBoard({ res: bank("rage", 2, P1) });
  const oppHand = handOf(b.engine, P2);
  const mineHand = handOf(b.engine, P1);
  activate(b.engine, P1, b.id("it"), "tickle");
  assert.equal(ready(b.engine), 1, "COST: pay 1");
  assert.equal(isDepleted(b.engine, b.id("it")), true, "COST: deplete this card");
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the opponent chooses what to discard");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("oppH2")] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(discardOf(b.engine, P2), [b.id("oppH2")]);
  assert.deepEqual(handOf(b.engine, P2), oppHand.filter((c) => c !== b.id("oppH2")), "exactly one card, the other two stay");
  assert.deepEqual(handOf(b.engine, P1), mineHand, "my hand is untouched");
  assert.equal(discardOf(b.engine, P1).length, 0);
});

clause(IT, "0:ability:tickle", "the opponent may pick each card of their hand; only cards in their hand are offered", () => {
  for (const pick of ["oppH0", "oppH1", "oppH2"]) {
    const b = itBoard();
    activate(b.engine, P1, b.id("it"), "tickle");
    const pc = pending(b.engine) as unknown as { cardIds?: string[]; candidates?: string[]; options?: string[] };
    const offered = pc.cardIds ?? pc.candidates ?? pc.options ?? [];
    if (offered.length) {
      assert.deepEqual([...offered].sort(), [b.id("oppH0"), b.id("oppH1"), b.id("oppH2")].sort());
    }
    refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("mineH0")] }), "can't discard from my hand");
    answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id(pick)] });
    assert.deepEqual(discardOf(b.engine, P2), [b.id(pick)]);
    assert.equal(handOf(b.engine, P1).length, 2);
  }
});

clause(IT, "0:ability:tickle", "an opponent with an empty hand discards nothing and nothing hangs", () => {
  const b = itBoard({ oppHand: 0 });
  activate(b.engine, P1, b.id("it"), "tickle");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(discardOf(b.engine, P2).length, 0);
  assert.equal(handOf(b.engine, P1).length, 2, "my hand is not discarded instead");
  assert.equal(ready(b.engine), 0, "the cost is still paid");
  assert.equal(isDepleted(b.engine, b.id("it")), true);
});

clause(IT, "0:ability:tickle", "an opponent with exactly one card discards it", () => {
  const b = itBoard({ oppHand: 1 });
  activate(b.engine, P1, b.id("it"), "tickle");
  if (b.engine.state.pendingChoice) answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("oppH0")] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(discardOf(b.engine, P2), [b.id("oppH0")]);
  assert.equal(handOf(b.engine, P2).length, 0);
});

clause(IT, "0:ability:tickle", "COST: pay 1 - refused with no ready resource (spent ones don't pay); COST: deplete - refused while depleted, and once per ready", () => {
  const none = itBoard({ res: spent("rage", 2, P1) });
  refused(() => activate(none.engine, P1, none.id("it"), "tickle"), "nothing ready to pay", /Ability costs cannot be paid/);
  assert.equal(isDepleted(none.engine, none.id("it")), false);
  assert.equal(handOf(none.engine, P2).length, 3);
  const dep = itBoard({ res: bank("rage", 3, P1), depleted: true });
  refused(() => activate(dep.engine, P1, dep.id("it"), "tickle"), "depleted", /Ability costs cannot be paid/);
  assert.equal(ready(dep.engine), 3, "nothing paid");
  assert.equal(handOf(dep.engine, P2).length, 3);
  const twice = itBoard({ res: bank("rage", 3, P1) });
  activate(twice.engine, P1, twice.id("it"), "tickle");
  drainDiscards(twice.engine);
  refused(() => activate(twice.engine, P1, twice.id("it"), "tickle"), "second use while depleted", /Ability costs cannot be paid/);
  assert.equal(discardOf(twice.engine, P2).length, 1);
});

// =========================================================================================
// INHIBIT
// =========================================================================================

const IB = "29f8f2c9-e259-42ff-aa93-7a30cd36cc17"; // EXTRA COST: Pick a non-resource card. -- Until the start of your next turn, treat the card as though it has no rules text. Draw a card.

const staticChar = () =>
  character({
    name: "Booster",
    strength: 1,
    life: 3,
    behavior: { abilities: [{ id: "s", type: "continuous", modifiers: [{ target: "source", stat: "strength", operation: "add", value: 3 }] }] }
  });
const kwChar = () => character({ name: "Sneak", strength: 1, life: 3, behavior: { keywords: ["covert"] } });
const trigChar = () =>
  character({
    name: "Tripwire",
    strength: 1,
    life: 3,
    behavior: { abilities: [{ id: "t", type: "triggered", event: "cardEnteredPlay", effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });

function ibBoard(o: { res?: CardPlacement[]; extra?: CardPlacement[]; active?: PlayerId } = {}) {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "ib", def: printing(IB), owner: P1, zone: "hand" },
      { key: "booster", def: staticChar(), owner: P2, zone: "play" },
      { key: "sneak", def: kwChar(), owner: P2, zone: "play" },
      { key: "drawer", def: drawerChar(), owner: P2, zone: "play" },
      { key: "mydrawer", def: drawerChar({ name: "MyDrawer" }), owner: P1, zone: "play" },
      { key: "booster2", def: staticChar(), owner: P2, zone: "play" },
      ...pad("p1deck", 4, P1, "deck"),
      ...pad("p2deck", 4, P2, "deck"),
      ...(o.res ?? bank("obsession", 2, P1)),
      ...(o.extra ?? [])
    ]
  });
}
type IbBoard = ReturnType<typeof ibBoard>;
const inhibit = (b: IbBoard, target: string) => play(b.engine, P1, b.id("ib"), { selected: { c: [target] } });

clause(IB, "0:extraCost", "printed type / trade / cost 1 / threshold [O]; exact cost works, one short or no [O] is refused", () => {
  const exact = ibBoard({ res: bank("obsession", 1, P1) });
  const d = exact.engine.getDefinition(exact.id("ib"));
  assert.deepEqual([d.type, d.trade, d.cost, d.threshold], ["tactic", "arcanist", 1, "o"]);
  inhibit(exact, exact.id("booster"));
  assert.equal(zoneOf(exact.engine, exact.id("ib")), "discard");
  assert.equal(ready(exact.engine), 0, "cost 1 paid");
  const none = ibBoard({ res: spent("obsession", 1, P1) });
  refused(() => inhibit(none, none.id("booster")), "threshold met by a spent icon but nothing to pay", /Costs cannot be paid/);
  assert.equal(none.engine.getStat(none.id("booster"), "strength"), 4);
  const noIcon = ibBoard({ res: bank("rage", 3, P1) });
  refused(() => inhibit(noIcon, noIcon.id("booster")), "no [O]", /Threshold requirements/);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("ib")), "hand");
});

clause(IB, "0:extraCost", "any non-resource card can be picked: opponent's or my own character, item, location", () => {
  for (const [key, def, owner] of [
    ["booster", null, P2],
    ["mydrawer", null, P1],
    ["it", item({ name: "AnItem" }), P2],
    ["loc", location({ name: "ALoc" }), P1]
  ] as const) {
    const b = ibBoard({ extra: def ? [{ key, def, owner, zone: "play" as const }] : [] });
    inhibit(b, b.id(key));
    assert.equal(zoneOf(b.engine, b.id("ib")), "discard", `${key} was a legal pick`);
    assert.equal(b.engine.state.pendingChoice, undefined);
  }
});

clause(IB, "0:extraCost", "a resource (own, opponent's, face-down) and a faction can't be picked; neither can a card outside play; a pick is required", () => {
  const b = ibBoard({
    res: bank("obsession", 2, P1),
    extra: [
      { key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "inhand", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
      { key: "indisc", def: character({ name: "InDisc" }), owner: P2, zone: "discard" },
      ...bank("greed", 1, P2)
    ]
  });
  const tryPick = (t: string) => () => inhibit(b, t);
  refused(tryPick(resourceIdOf(b.engine, P1)), "my own resource");
  refused(tryPick(resourceIdOf(b.engine, P2)), "opponent's resource");
  refused(tryPick(b.id("fd")), "face-down card is a resource");
  refused(tryPick(factionOf(b.engine, P2)), "a faction");
  refused(tryPick(b.id("inhand")), "card in hand");
  refused(tryPick(b.id("indisc")), "card in discard");
  refused(() => play(b.engine, P1, b.id("ib"), {}), "no pick at all");
  assert.equal(zoneOf(b.engine, b.id("ib")), "hand", "Inhibit was never played");
  assert.equal(ready(b.engine), 2, "nothing was paid");
  tryPick(b.id("booster"))();
  assert.equal(zoneOf(b.engine, b.id("ib")), "discard", "control");
});

clause(IB, "0:extraCost", "the pick is made as Inhibit is played, before the opponent can respond; the effect itself waits for resolution", () => {
  const b = ibBoard();
  const hand = handOf(b.engine, P1).length;
  playRaw(b.engine, P1, b.id("ib"), { selected: { c: [b.id("booster")] } });
  assert.equal(zoneOf(b.engine, b.id("ib")), "deploying");
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2, "opponent may respond");
  assert.equal(b.engine.getStat(b.id("booster"), "strength"), 4, "the effect has not happened yet");
  assert.equal(handOf(b.engine, P1).length, hand - 1, "no card drawn yet");
  assert.equal(ready(b.engine), 1, "cost already paid");
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.getStat(b.id("booster"), "strength"), 1);
  assert.equal(handOf(b.engine, P1).length, hand, "drew one on resolution");
});

clause(IB, "1:rule", "the picked card is treated as having no rules text: continuous bonus gone, printed stats stay; other copies unaffected", () => {
  const b = ibBoard();
  assert.equal(b.engine.getStat(b.id("booster"), "strength"), 4, "control: +3 before");
  inhibit(b, b.id("booster"));
  assert.equal(b.engine.getStat(b.id("booster"), "strength"), 1, "static ability is off, printed strength 1 remains");
  assert.equal(b.engine.getStat(b.id("booster"), "life"), 3, "printed life remains");
  assert.equal(b.engine.getStat(b.id("booster2"), "strength"), 4, "a different card with the same text is unaffected");
  assert.equal(zoneOf(b.engine, b.id("booster")), "play");
});

clause(IB, "1:rule", "no rules text: activated abilities can't be used (before: usable); other cards' abilities still work", () => {
  const mk = () => ibBoard({ extra: [{ key: "mydrawer2", def: drawerChar({ name: "MyDrawer2" }), owner: P1, zone: "play" }] });
  const c = mk();
  const h0 = handOf(c.engine, P1).length;
  activate(c.engine, P1, c.id("mydrawer"), "draw1");
  assert.equal(handOf(c.engine, P1).length, h0 + 1, "control: ability works");
  const b = mk();
  inhibit(b, b.id("mydrawer"));
  const h1 = handOf(b.engine, P1).length;
  refused(() => activate(b.engine, P1, b.id("mydrawer"), "draw1"), "suppressed ability", /Activated ability not found|current timing|suppress|text/i);
  assert.equal(handOf(b.engine, P1).length, h1);
  assert.equal(
    b.engine.getAvailableActivatedAbilities(P1).some((a: { cardId: string }) => a.cardId === b.id("mydrawer")),
    false,
    "not listed as available"
  );
  activate(b.engine, P1, b.id("mydrawer2"), "draw1");
  assert.equal(handOf(b.engine, P1).length, h1 + 1, "an unpicked drawer still works");
});

clause(IB, "1:rule", "no rules text: an opponent's activated ability (used on their turn) is off after I Inhibit it in response", () => {
  const mk = () =>
    ibBoard({ active: P2, extra: [{ key: "bait", def: character({ name: "Bait", cost: 0 }), owner: P2, zone: "hand" }] });
  const c = mk();
  const c0 = handOf(c.engine, P2).length;
  activate(c.engine, P2, c.id("drawer"), "draw1");
  assert.equal(handOf(c.engine, P2).length, c0 + 1, "control: their drawer works on their turn");
  const b = mk();
  playRaw(b.engine, P2, b.id("bait"));
  playRaw(b.engine, P1, b.id("ib"), { selected: { c: [b.id("drawer")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("ib")), "discard");
  const h = handOf(b.engine, P2).length;
  refused(() => activate(b.engine, P2, b.id("drawer"), "draw1"), "suppressed ability", /Activated ability not found|current timing|suppress|text/i);
  assert.equal(handOf(b.engine, P2).length, h);
});

clause(IB, "1:rule", "no rules text: triggered abilities don't fire (and do fire without Inhibit)", () => {
  const mk = (suppress: boolean) => {
    const b = ibBoard({
      extra: [
        { key: "trip", def: trigChar(), owner: P2, zone: "play" },
        { key: "ent", def: character({ name: "Ent", cost: 0 }), owner: P1, zone: "hand" }
      ]
    });
    if (suppress) inhibit(b, b.id("trip"));
    const before = handOf(b.engine, P2).length;
    play(b.engine, P1, b.id("ent"));
    assert.equal(zoneOf(b.engine, b.id("ent")), "play");
    return handOf(b.engine, P2).length - before;
  };
  assert.equal(mk(false), 1, "control: the trigger draws");
  assert.equal(mk(true), 0, "suppressed: nothing");
});

clause(IB, "1:rule", "no rules text: keywords are gone too (COVERT before, none after)", () => {
  const b = ibBoard();
  assert.ok(b.engine.getKeywords(b.id("sneak")).includes("covert"), "control");
  inhibit(b, b.id("sneak"));
  assert.equal(b.engine.getKeywords(b.id("sneak")).includes("covert"), false);
  assert.ok(b.engine.getStat(b.id("sneak"), "strength") === 1, "b.engine.getStat(b.id(\"sneak\"), \"strength\") === 1");
});

clause(IB, "1:rule", "the effect lasts until the start of MY next turn: still on through the opponent's turn, over when my turn starts", () => {
  const b = ibBoard();
  inhibit(b, b.id("booster"));
  assert.equal(b.engine.getStat(b.id("booster"), "strength"), 1);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(b.engine.getStat(b.id("booster"), "strength"), 1, "still suppressed during the opponent's turn");
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(b.engine.getStat(b.id("booster"), "strength"), 4, "my next turn has started: text is back");
});

clause(IB, "1:rule", "cast on the opponent's turn it still ends at the start of MY next turn (the very next turn change)", () => {
  const b = ibBoard({
    active: P2,
    extra: [{ key: "bait", def: character({ name: "Bait", cost: 0 }), owner: P2, zone: "hand" }]
  });
  playRaw(b.engine, P2, b.id("bait"));
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(b.engine, P1, b.id("ib"), { selected: { c: [b.id("booster")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("ib")), "discard");
  assert.equal(b.engine.getStat(b.id("booster"), "strength"), 1, "suppressed for the rest of their turn");
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(b.engine.getStat(b.id("booster"), "strength"), 4, "my turn started: ended");
});

clause(IB, "1:rule", "Draw a card: its controller draws exactly one, the opponent draws none, whatever was picked", () => {
  const b = ibBoard();
  const deckTop = b.engine.state.players[P1].deck[0];
  const p1Hand = handOf(b.engine, P1).length;
  const p2Hand = handOf(b.engine, P2).length;
  inhibit(b, b.id("booster"));
  assert.equal(handOf(b.engine, P1).length, p1Hand - 1 + 1, "Inhibit left the hand, one card drawn");
  assert.ok(handOf(b.engine, P1).includes(deckTop), "from the top of my deck");
  assert.equal(b.engine.state.players[P1].deck.length, 3);
  assert.equal(handOf(b.engine, P2).length, p2Hand);
  assert.equal(b.engine.state.players[P2].deck.length, 4);
  const mine = ibBoard();
  inhibit(mine, mine.id("mydrawer"));
  assert.equal(handOf(mine.engine, P1).length, p1Hand, "same when I pick my own card");
});

// =========================================================================================
// LIVING GOD OF THABBASH
// =========================================================================================

const LG = "f0bbd413-27be-4fb1-ac4a-f12f0dc29860"; // When a character you control leaves play, an opponent discards a card. -- HIGHER CALLING -- COST: Pay 2. Pick a character you control. -- EFFECT: Put the character into its owner's hand.

const killAny = () =>
  tactic({
    name: "KillAny",
    cost: 0,
    behavior: {
      abilities: [
        { id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }
      ]
    }
  });
const killTwo = () =>
  tactic({
    name: "KillTwo",
    cost: 0,
    behavior: {
      abilities: [
        { id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 2 }], effects: [{ type: "forEach", selected: "t", effects: [{ type: "destroy", target: { type: "selected", id: "__candidate" } }] }] }
      ]
    }
  });
const discardFromHand = () =>
  tactic({
    name: "DiscardMine",
    cost: 0,
    behavior: {
      abilities: [
        { id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "hand", owner: "self", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "discard" }] }
      ]
    }
  });

function lgBoard(o: { zone?: "hand" | "play"; res?: CardPlacement[]; oppHand?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "lg", def: printing(LG), owner: P1, zone: o.zone ?? "play" },
      { key: "mine1", def: character({ name: "Mine1", strength: 1, life: 1 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", strength: 1, life: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 1 }), owner: P2, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "kill", def: killAny(), owner: P1, zone: "hand" },
      { key: "kill2", def: killTwo(), owner: P1, zone: "hand" },
      { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" },
      { key: "dm", def: discardFromHand(), owner: P1, zone: "hand" },
      { key: "inHandChar", def: character({ name: "InHandChar", cost: 0 }), owner: P1, zone: "hand" },
      ...pad("oppH", o.oppHand ?? 4, P2, "hand"),
      ...pad("oppD", 2, P2, "deck"),
      ...(o.res ?? bank("obsession", 2, P1)),
      ...(o.extra ?? [])
    ]
  });
}
type LgBoard = ReturnType<typeof lgBoard>;
const kill = (b: LgBoard, t: string) => play(b.engine, P1, b.id("kill"), { selected: { t: [b.id(t)] } });

clause(LG, "0:rule", "printed type / trade / cost 10 / threshold [O][O] / 7-3-7 / god; exact cost works, one short or one icon short is refused", () => {
  const b = lgBoard({ zone: "hand", res: [...bank("obsession", 2, P1), ...bank("rage", 8, P1)] });
  const d = b.engine.getDefinition(b.id("lg"));
  assert.deepEqual([d.type, d.trade, d.cost, d.threshold, d.strength, d.speed, d.life], ["character", "arcanist", 10, "oo", 7, 3, 7]);
  assert.deepEqual([...(d.subtype ?? [])], ["god"]);
  play(b.engine, P1, b.id("lg"));
  assert.equal(zoneOf(b.engine, b.id("lg")), "play");
  assert.equal(ready(b.engine), 0);
  assert.deepEqual([b.engine.getStat(b.id("lg"), "strength"), b.engine.getStat(b.id("lg"), "speed"), b.engine.getStat(b.id("lg"), "life")], [7, 3, 7]);
  const short = lgBoard({ zone: "hand", res: [...bank("obsession", 2, P1), ...bank("rage", 7, P1)] });
  refused(() => play(short.engine, P1, short.id("lg")), "cost 10 with 9", /Costs cannot be paid/);
  const noIcon = lgBoard({ zone: "hand", res: [...bank("obsession", 1, P1), ...bank("rage", 9, P1)] });
  refused(() => play(noIcon.engine, P1, noIcon.id("lg")), "one [O]", /Threshold requirements/);
});

clause(LG, "0:rule", "when a character I control is destroyed, the opponent discards a card of their choice (and only one)", () => {
  const b = lgBoard();
  const oppHand = handOf(b.engine, P2);
  kill(b, "mine1");
  assert.equal(zoneOf(b.engine, b.id("mine1")), "discard");
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the opponent chooses");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("oppH2")] });
  assert.equal(b.engine.state.pendingChoice, undefined, "exactly one discard");
  assert.deepEqual(discardOf(b.engine, P2), [b.id("oppH2")]);
  assert.deepEqual(handOf(b.engine, P2), oppHand.filter((c) => c !== b.id("oppH2")));
  assert.equal(discardOf(b.engine, P1).filter((c) => c !== b.id("mine1") && c !== b.id("kill")).length, 0, "I discard nothing");
});

clause(LG, "0:rule", "any way of leaving play counts: moved to hand, and Living God itself leaving", () => {
  const b = lgBoard();
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("mine1")] } });
  assert.equal(zoneOf(b.engine, b.id("mine1")), "hand");
  assert.equal(drainDiscards(b.engine), 1, "bounced character -> one opponent discard");
  assert.equal(discardOf(b.engine, P2).length, 1);
  const self = lgBoard();
  kill(self, "lg");
  assert.equal(zoneOf(self.engine, self.id("lg")), "discard");
  assert.equal(drainDiscards(self.engine), 1, "Living God is a character I control, and it leaves play");
  assert.equal(discardOf(self.engine, P2).length, 1);
});

clause(LG, "0:rule", "does not trigger for an opponent's character, an item, or a character leaving hand (near misses)", () => {
  const foe = lgBoard();
  kill(foe, "foe");
  assert.equal(zoneOf(foe.engine, foe.id("foe")), "discard");
  assert.equal(foe.engine.state.pendingChoice, undefined, "opponent's character");
  assert.equal(discardOf(foe.engine, P2).length, 1, "only the dead character itself");
  assert.equal(handOf(foe.engine, P2).length, 4);
  const it = lgBoard();
  kill(it, "myItem");
  assert.equal(zoneOf(it.engine, it.id("myItem")), "discard");
  assert.equal(it.engine.state.pendingChoice, undefined, "my item");
  assert.equal(handOf(it.engine, P2).length, 4);
  const hand = lgBoard();
  play(hand.engine, P1, hand.id("dm"), { selected: { t: [hand.id("inHandChar")] } });
  assert.equal(zoneOf(hand.engine, hand.id("inHandChar")), "discard");
  assert.equal(hand.engine.state.pendingChoice, undefined, "from hand, not from play");
  assert.equal(handOf(hand.engine, P2).length, 4);
});

clause(LG, "0:rule", "'you control' is by controller: a stolen (opponent-owned) character I control triggers; mine controlled by the opponent doesn't", () => {
  const stolen = lgBoard({ extra: [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 }] });
  kill(stolen, "stolen");
  assert.equal(zoneOf(stolen.engine, stolen.id("stolen")), "discard");
  assert.equal(drainDiscards(stolen.engine), 1, "I controlled it");
  const lent = lgBoard({ extra: [{ key: "lent", def: character({ name: "Lent" }), owner: P1, zone: "play", controller: P2 }] });
  kill(lent, "lent");
  assert.equal(zoneOf(lent.engine, lent.id("lent")), "discard");
  assert.equal(lent.engine.state.pendingChoice, undefined, "I only own it");
  assert.equal(handOf(lent.engine, P2).length, 4);
});

clause(LG, "0:rule", "every character that leaves play makes the opponent discard: two at once means two discards", () => {
  const b = lgBoard();
  play(b.engine, P1, b.id("kill2"), { selected: { t: [b.id("mine1"), b.id("mine2")] } });
  assert.equal(zoneOf(b.engine, b.id("mine1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("mine2")), "discard");
  assert.equal(drainDiscards(b.engine), 2);
  assert.equal(discardOf(b.engine, P2).length, 2);
  assert.equal(handOf(b.engine, P2).length, 2);
});

clause(LG, "0:rule", "an opponent with an empty hand has nothing to discard and nothing hangs; with one card it is discarded", () => {
  const empty = lgBoard({ oppHand: 0 });
  kill(empty, "mine1");
  assert.equal(empty.engine.state.pendingChoice, undefined);
  assert.equal(discardOf(empty.engine, P2).length, 0);
  const one = lgBoard({ oppHand: 1 });
  kill(one, "mine1");
  drainDiscards(one.engine);
  assert.equal(handOf(one.engine, P2).length, 0);
  assert.deepEqual(discardOf(one.engine, P2), [one.id("oppH0")]);
});

clause(LG, "0:rule", "the trigger needs Living God in play: with it gone (or still in hand), characters leaving cost the opponent nothing", () => {
  const hand = lgBoard({ zone: "hand" });
  kill(hand, "mine1");
  assert.equal(hand.engine.state.pendingChoice, undefined);
  assert.equal(handOf(hand.engine, P2).length, 4);
  const gone = lgBoard();
  kill(gone, "lg");
  drainDiscards(gone.engine);
  assert.equal(discardOf(gone.engine, P2).length, 1);
  play(gone.engine, P1, gone.id("bounce"), { selected: { t: [gone.id("mine1")] } });
  assert.equal(zoneOf(gone.engine, gone.id("mine1")), "hand");
  assert.equal(gone.engine.state.pendingChoice, undefined, "Living God is no longer in play");
  assert.equal(discardOf(gone.engine, P2).length, 1);
});

clause(LG, "1:ability:higher-calling", "COST: pay 2; EFFECT: the picked character of mine goes to its owner's hand (own, Living God itself, stolen -> owner's hand)", () => {
  const b = lgBoard({ res: bank("obsession", 4, P1), extra: [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 }] });
  activate(b.engine, P1, b.id("lg"), "higher-calling", { selected: { c: [b.id("mine1")] } });
  assert.equal(ready(b.engine), 2, "COST: pay 2");
  assert.equal(zoneOf(b.engine, b.id("mine1")), "hand");
  assert.ok(handOf(b.engine, P1).includes(b.id("mine1")), "handOf(b.engine, P1).includes(b.id(\"mine1\"))");
  assert.equal(drainDiscards(b.engine), 1, "it left play, so the toll applies");
  activate(b.engine, P1, b.id("lg"), "higher-calling", { selected: { c: [b.id("stolen")] } });
  assert.equal(ready(b.engine), 0);
  assert.ok(handOf(b.engine, P2).includes(b.id("stolen")), "its owner's hand");
  assert.equal(handOf(b.engine, P1).includes(b.id("stolen")), false);
  assert.equal(zoneOf(b.engine, b.id("mine2")), "play", "other characters stay");
  drainDiscards(b.engine);
  const self = lgBoard();
  activate(self.engine, P1, self.id("lg"), "higher-calling", { selected: { c: [self.id("lg")] } });
  assert.equal(zoneOf(self.engine, self.id("lg")), "hand", "may pick itself");
});

clause(LG, "1:ability:higher-calling", "the pick must be a character I control: not the opponent's character, an item, or a card outside play", () => {
  const b = lgBoard({ res: bank("obsession", 2, P1), extra: [{ key: "lent", def: character({ name: "Lent" }), owner: P1, zone: "play", controller: P2 }] });
  const pickRaw = (t: string) => () => activate(b.engine, P1, b.id("lg"), "higher-calling", { selected: { c: [t] } });
  refused(pickRaw(b.id("foe")), "opponent's character");
  refused(pickRaw(b.id("lent")), "a character I own but don't control");
  refused(pickRaw(b.id("myItem")), "an item");
  refused(pickRaw(b.id("inHandChar")), "a character in my hand");
  assert.equal(ready(b.engine), 2, "nothing paid by refused attempts");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  pickRaw(b.id("mine2"))();
  assert.equal(zoneOf(b.engine, b.id("mine2")), "hand", "control");
});

clause(LG, "1:ability:higher-calling", "COST: pay 2 - one resource short (or only spent resources) is refused with nothing moved; works while depleted", () => {
  const b = lgBoard({ res: bank("obsession", 1, P1) });
  refused(() => activate(b.engine, P1, b.id("lg"), "higher-calling", { selected: { c: [b.id("mine1")] } }), "pay 2 with 1", /Ability costs cannot be paid/);
  assert.equal(zoneOf(b.engine, b.id("mine1")), "play");
  assert.equal(ready(b.engine), 1);
  const s = lgBoard({ res: [...bank("obsession", 1, P1), ...spent("obsession", 3, P1)] });
  refused(() => activate(s.engine, P1, s.id("lg"), "higher-calling", { selected: { c: [s.id("mine1")] } }), "spent can't pay", /Ability costs cannot be paid/);
  const d = lgBoard({ res: bank("obsession", 2, P1) });
  d.engine.state.cards[d.id("lg")].depleted = true;
  activate(d.engine, P1, d.id("lg"), "higher-calling", { selected: { c: [d.id("mine1")] } });
  assert.equal(zoneOf(d.engine, d.id("mine1")), "hand", "no deplete in the cost");
});
