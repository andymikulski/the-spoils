// Clause tests, batch seed-saga-02, part p2 (groups 6-10, missing clauses only):
// Manifest, Mesmerizing Enchantress, Mr. Chesterton, Muddle, Mutilated.
// Every expectation is read from the PRINTED text.

import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  bank,
  character,
  developFaction,
  item,
  location,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic,
  P1,
  P2
} from "../per-card/_harness.js";
import type { StapleIcon } from "../per-card/_harness.js";
import { clause, printing, refused, flipUpNow } from "./_clause.js";
import { declareBlockers, fillers, pending, zoneOf } from "./_board.js";
import { declareAttackBy, playRaw } from "./_battle.js";
import { developResource, endTurn } from "./_turn.js";
import type { CardDefinition, PlayerId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- shared helpers (this file only) ------------------------------------------------

const FACTION_KEY: Record<string, string> = { [P1]: "__factionA", [P2]: "__factionB" };

/** `n` already-SPENT resources (attached to the owner's faction): they count toward thresholds but can't pay. */
function spent(icon: StapleIcon, n: number, owner: PlayerId = P1): CardPlacement[] {
  return bank(icon, n, owner).map((placement) => ({ ...placement, attachedToKey: FACTION_KEY[owner] }));
}

const ready = (engine: SpoilsEngine, p: PlayerId = P1): number => engine.getAvailableResourceCount(p);
const handOf = (engine: SpoilsEngine, p: PlayerId): string[] => engine.state.players[p].hand;

/** A tactic that makes its controller draw `n` cards. */
function drawTactic(name: string, cost: number, n = 1, extra: Partial<CardDefinition> = {}): CardDefinition {
  return tactic({
    name,
    cost,
    behavior: { abilities: [{ id: "d", type: "activated", effects: [{ type: "draw", player: "controller", amount: n }] }] },
    ...extra
  });
}

type B = { engine: SpoilsEngine; id: (key: string) => string };
const getLogRevealed = (engine: SpoilsEngine) =>
  engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
const battleOf2 = (b: B): unknown => b.engine.state.battle;

// =========================================================================================
// MANIFEST
// =========================================================================================

const MAN = "ee4f6ce1-1bbd-4b1e-9801-cab64259568d"; // EXTRA COST: Reveal a face-down tactic you control. -- You may deploy the tactic. Draw a card. -- (in discard: ...) -- FLIP UP: 1 [O]

function manBoard(o: { res?: CardPlacement[]; extra?: CardPlacement[]; fd?: CardDefinition; fdSpent?: boolean; active?: PlayerId } = {}) {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "man", def: printing(MAN), owner: P1, zone: "hand" },
      { key: "fd", def: o.fd ?? drawTactic("Zap", 0, 2), owner: P1, zone: "play", faceDown: true, ...(o.fdSpent ? { attachedToKey: "__factionA" } : {}) },
      ...fillers("d", 10, P1, "deck"),
      ...fillers("e", 6, P2, "deck"),
      ...(o.res ?? bank("obsession", 3, P1)),
      ...(o.extra ?? [])
    ]
  });
}

const deployChoice = (b: B, target: string) => {
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: b.id(target), selected: {} } } as never);
  resolvePendingResponses(b.engine);
};
const declineDeploy = (b: B) => {
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree" } } as never);
  resolvePendingResponses(b.engine);
};

/** Plays Manifest revealing `target`, then answers the "may deploy" prompt. */
function manifest(b: B, answer: "deploy" | "decline" | "none", target = "fd"): void {
  play(b.engine, P1, b.id("man"), { selected: { rev: [b.id(target)] } });
  if (answer === "none") return;
  const pc = pending(b.engine) as unknown as { kind: string } | undefined;
  assert.equal(pc?.kind, "deployForFree", "asked whether to deploy the revealed tactic");
  if (answer === "deploy") deployChoice(b, target);
  else declineDeploy(b);
  assert.equal(pending(b.engine), undefined, "no choice left open");
}

clause(MAN, "0:extraCost", "printed tactic / arcanist / cost 1 / threshold [O]; exact cost works (pays exactly 1)", () => {
  const b = manBoard({ res: bank("obsession", 1, P1) });
  const d = b.engine.getDefinition(b.id("man"));
  assert.deepEqual([d.type, d.trade, d.cost, d.threshold], ["tactic", "arcanist", 1, "o"]);
  const before = ready(b.engine);
  manifest(b, "decline");
  assert.equal(before - ready(b.engine), 1, "cost 1 paid");
  assert.equal(zoneOf(b.engine, b.id("man")), "discard");
});

clause(MAN, "0:extraCost", "one resource short of the cost is refused (threshold met by a spent [O]); nothing is paid or revealed", () => {
  const none = manBoard({ res: spent("obsession", 1, P1), fdSpent: true });
  assert.equal(ready(none.engine), 0);
  refused(() => manifest(none, "none"), "nothing to pay with", /Costs cannot be paid/);
  assert.equal(zoneOf(none.engine, none.id("man")), "hand");
  assert.equal(getLogRevealed(none.engine).length, 0, "nothing was revealed");
  const one = manBoard({ res: [...spent("obsession", 1, P1), ...bank("rage", 1, P1)], fdSpent: true });
  manifest(one, "decline");
  assert.equal(zoneOf(one.engine, one.id("man")), "discard", "control: with one ready resource it works");
});

clause(MAN, "0:extraCost", "needs [O]: refused with enough resources but no obsession icon; works once an [O] is present", () => {
  const b = manBoard({ res: bank("rage", 3, P1) });
  refused(() => manifest(b, "none"), "no [O]", /Threshold requirements/);
  assert.equal(zoneOf(b.engine, b.id("man")), "hand");
  const ok = manBoard({ res: [...bank("rage", 2, P1), ...bank("obsession", 1, P1)] });
  manifest(ok, "decline");
  assert.equal(zoneOf(ok.engine, ok.id("man")), "discard");
});

clause(MAN, "0:extraCost", "the face-down tactic is revealed (a reveal event names it) and stays face-down in play when not deployed", () => {
  const b = manBoard();
  manifest(b, "decline");
  const reveals = getLogRevealed(b.engine);
  assert.equal(reveals.length, 1);
  const ev = reveals[0].event as unknown as { cardIds: string[] };
  assert.deepEqual(ev.cardIds, [b.id("fd")]);
  assert.equal(zoneOf(b.engine, b.id("fd")), "play");
  assert.equal(b.engine.state.cards[b.id("fd")].faceDown, true, "still face-down");
});

clause(MAN, "0:extraCost", "only a face-down tactic you control can be revealed: face-up tactic, face-down character, opponent's face-down tactic, tactic in hand/discard, and no pick are all refused", () => {
  const b = manBoard({
    extra: [
      { key: "up", def: drawTactic("FaceUp", 0), owner: P1, zone: "play" },
      { key: "fdc", def: character({ name: "FdChar" }), owner: P1, zone: "play", faceDown: true },
      { key: "theirs", def: drawTactic("Theirs", 0), owner: P2, zone: "play", faceDown: true },
      { key: "inhand", def: drawTactic("InHand", 0), owner: P1, zone: "hand" },
      { key: "indisc", def: drawTactic("InDisc", 0), owner: P1, zone: "discard" }
    ]
  });
  for (const k of ["up", "fdc", "theirs", "inhand", "indisc"]) {
    refused(() => manifest(b, "none", k), `${k} is not a face-down tactic you control`);
    assert.equal(zoneOf(b.engine, b.id("man")), "hand", `${k}: Manifest was never played`);
  }
  refused(() => play(b.engine, P1, b.id("man"), {}), "a pick is required");
  assert.equal(zoneOf(b.engine, b.id("man")), "hand");
  manifest(b, "decline", "fd");
  assert.equal(zoneOf(b.engine, b.id("man")), "discard", "control: the face-down tactic works");
});

clause(MAN, "0:extraCost", "a face-down tactic you control but do not own is a legal pick", () => {
  const b = manBoard({ extra: [{ key: "stolen", def: drawTactic("Stolen", 0), owner: P2, zone: "play", controller: P1, faceDown: true }] });
  manifest(b, "decline", "stolen");
  assert.equal(zoneOf(b.engine, b.id("man")), "discard");
});

clause(MAN, "1:rule", "you may deploy the revealed tactic: it resolves (its effect happens), then you draw a card", () => {
  const b = manBoard();
  const hand = handOf(b.engine, P1).length;
  manifest(b, "deploy");
  assert.equal(handOf(b.engine, P1).length, hand - 1 + 2 + 1, "Manifest left; Zap drew 2; Manifest drew 1");
  assert.equal(zoneOf(b.engine, b.id("fd")), "discard", "the deployed tactic resolved and was discarded");
  assert.equal(zoneOf(b.engine, b.id("man")), "discard");
});

clause(MAN, "1:rule", "declining the deploy: the tactic does nothing and stays face-down in play, but you still draw a card", () => {
  const b = manBoard();
  const hand = handOf(b.engine, P1).length;
  manifest(b, "decline");
  assert.equal(handOf(b.engine, P1).length, hand - 1 + 1, "only Manifest's own draw");
  assert.equal(zoneOf(b.engine, b.id("fd")), "play");
  assert.equal(b.engine.state.cards[b.id("fd")].faceDown, true);
});

clause(MAN, "1:rule", "'deploy' pays the tactic's numeric cost (no 'for free' is printed): Zap costing 2 takes 2 more resources", () => {
  const b = manBoard({ fd: drawTactic("Zap2", 2, 2), fdSpent: true, res: bank("obsession", 5, P1) });
  const before = ready(b.engine);
  manifest(b, "deploy");
  assert.equal(before - ready(b.engine), 1 + 2, "Manifest 1 + Zap 2");
  assert.equal(zoneOf(b.engine, b.id("fd")), "discard");
});

clause(MAN, "1:rule", "a deployed tactic whose cost can't be paid can't be deployed", () => {
  const b = manBoard({ fd: drawTactic("Zap9", 9, 2), fdSpent: true, res: bank("obsession", 3, P1) });
  play(b.engine, P1, b.id("man"), { selected: { rev: [b.id("fd")] } });
  const hand = handOf(b.engine, P1).length;
  refused(() => deployChoice(b, "fd"), "9 can't be paid with 2 resources");
  assert.equal(zoneOf(b.engine, b.id("fd")), "play");
  assert.equal(handOf(b.engine, P1).length, hand, "no draw from the refused deploy");
});

clause(MAN, "1:rule", "only the revealed tactic can be deployed, not another face-down tactic", () => {
  const b = manBoard({ extra: [{ key: "fd2", def: drawTactic("Other", 0, 3), owner: P1, zone: "play", faceDown: true }] });
  play(b.engine, P1, b.id("man"), { selected: { rev: [b.id("fd")] } });
  const pc = pending(b.engine) as unknown as { kind: string; candidates: string[] };
  assert.equal(pc.kind, "deployForFree");
  assert.deepEqual(pc.candidates, [b.id("fd")]);
  deployChoice(b, "fd");
  assert.equal(zoneOf(b.engine, b.id("fd")), "discard");
  assert.equal(zoneOf(b.engine, b.id("fd2")), "play", "the other face-down tactic is untouched");
  assert.equal(b.engine.state.cards[b.id("fd2")].faceDown, true);
});

// --- recursion: while in the discard pile ----------------------------------------

function recurBoard(o: { res?: CardPlacement[]; extra?: CardPlacement[]; manZone?: "discard" | "hand" | "deck"; active?: PlayerId } = {}) {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "man", def: printing(MAN), owner: P1, zone: o.manZone ?? "discard" },
      { key: "resO", def: resourceCard({ name: "ObsRes", resource: { provides: ["obsession"], staple: true } }), owner: P1, zone: "hand" },
      { key: "resR", def: resourceCard({ name: "RageRes", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" },
      { key: "resOR", def: resourceCard({ name: "ObsRageRes", resource: { provides: ["obsession", "rage"], staple: true } }), owner: P1, zone: "hand" },
      { key: "resOO", def: resourceCard({ name: "ObsObsRes", resource: { provides: ["obsession", "obsession"], staple: true } }), owner: P1, zone: "hand" },
      { key: "oRes", def: resourceCard({ name: "TheirObs", resource: { provides: ["obsession"], staple: true } }), owner: P2, zone: "hand" },
      ...fillers("d", 6, P1, "deck"),
      ...fillers("e", 6, P2, "deck"),
      ...(o.res ?? bank("rage", 3, P1)),
      ...(o.extra ?? [])
    ]
  });
}

const answerMay = (b: B, pay: boolean, player: PlayerId = P1) => {
  const pc = pending(b.engine) as unknown as { kind: string } | undefined;
  assert.equal(pc?.kind, "mayPay", "asked whether to pay 2");
  b.engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "mayPay", pay } } as never);
  resolvePendingResponses(b.engine);
};

clause(MAN, "2:rule", "when an [O]-providing resource enters play under your control, you may pay 2: Manifest returns to play face-down as a resource under your control", () => {
  const b = recurBoard();
  const before = ready(b.engine);
  developResource(b.engine, P1, b.id("resO"), false);
  answerMay(b, true);
  assert.equal(pending(b.engine), undefined);
  const card = b.engine.state.cards[b.id("man")];
  assert.equal(card.zone, "play");
  assert.equal(card.faceDown, true, "face-down");
  assert.equal(card.controllerId, P1);
  assert.equal(b.engine.isResource(b.id("man")), true, "it is a resource now");
  // +1 new Obsession resource, -2 paid, +1 Manifest as a face-down resource
  assert.equal(ready(b.engine) - before, 1 - 2 + 1);
});

clause(MAN, "2:rule", "declining the payment: Manifest stays in the discard pile and nothing is paid", () => {
  const b = recurBoard();
  const before = ready(b.engine);
  developResource(b.engine, P1, b.id("resO"), false);
  answerMay(b, false);
  assert.equal(zoneOf(b.engine, b.id("man")), "discard");
  assert.equal(ready(b.engine) - before, 1, "only the developed resource");
});

clause(MAN, "2:rule", "the payment is 2 and only once, even though the resource both 'played' and 'entered play'", () => {
  const b = recurBoard();
  developResource(b.engine, P1, b.id("resO"), false);
  answerMay(b, true);
  assert.equal(pending(b.engine), undefined, "no second prompt");
  assert.equal(b.engine.state.cards[b.id("man")].faceDown, true);
  assert.equal(b.engine.state.players[P1].play.filter((c) => c === b.id("man")).length, 1);
  // 3 rage + developed ObsRes + Manifest = 5 resources; 2 were spent
  assert.equal(ready(b.engine), 3 + 1 + 1 - 2);
});

clause(MAN, "2:rule", "you must be able to pay 2: with fewer than 2 ready resources it cannot be taken (Manifest stays in the discard pile)", () => {
  const b = recurBoard({ res: [] });
  developResource(b.engine, P1, b.id("resO"), false);
  assert.equal(ready(b.engine), 1);
  const pc = pending(b.engine) as unknown as { kind: string } | undefined;
  if (pc) refused(() => answerMay(b, true), "only 1 resource, can't pay 2");
  assert.equal(zoneOf(b.engine, b.id("man")), "discard");
});

clause(MAN, "2:rule", "exactly 2 ready resources (one of them the new resource) is enough", () => {
  const b = recurBoard({ res: bank("rage", 1, P1) });
  developResource(b.engine, P1, b.id("resO"), false);
  answerMay(b, true);
  assert.equal(zoneOf(b.engine, b.id("man")), "play");
});

clause(MAN, "2:rule", "'provides at least [O]': a resource providing [O]+[R] or [O][O] also triggers it", () => {
  for (const k of ["resOR", "resOO"]) {
    const b = recurBoard();
    developResource(b.engine, P1, b.id(k), false);
    answerMay(b, true);
    assert.equal(zoneOf(b.engine, b.id("man")), "play", k);
  }
});

clause(MAN, "2:rule", "near misses don't trigger: a resource without [O], and a resource played face-down (Volition only)", () => {
  const rage = recurBoard();
  developResource(rage.engine, P1, rage.id("resR"), false);
  assert.equal(pending(rage.engine), undefined, "Rage resource: no prompt");
  assert.equal(zoneOf(rage.engine, rage.id("man")), "discard");
  const down = recurBoard();
  developResource(down.engine, P1, down.id("resO"), true);
  assert.equal(pending(down.engine), undefined, "face-down Obsession resource provides only Volition: no prompt");
  assert.equal(zoneOf(down.engine, down.id("man")), "discard");
  const ctrl = recurBoard();
  developResource(ctrl.engine, P1, ctrl.id("resO"), false);
  assert.equal((pending(ctrl.engine) as unknown as { kind: string })?.kind, "mayPay", "control: the Obsession resource prompts");
});

clause(MAN, "2:rule", "only in the discard pile: Manifest in hand or in the deck does nothing when an [O] resource enters", () => {
  for (const z of ["hand", "deck"] as const) {
    const b = recurBoard({ manZone: z });
    developResource(b.engine, P1, b.id("resO"), false);
    assert.equal(pending(b.engine), undefined, `${z}: no prompt`);
    assert.equal(zoneOf(b.engine, b.id("man")), z);
  }
});

clause(MAN, "2:rule", "only for resources entering under YOUR control: the opponent developing an [O] resource (their turn) doesn't prompt or return it", () => {
  const b = recurBoard({ active: P2 });
  developResource(b.engine, P2, b.id("oRes"), false);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("man")), "discard");
});

clause(MAN, "2:rule", "an [O] resource put into play by an effect (not Develop) also triggers it", () => {
  const plant = tactic({
    name: "Plant",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "plant",
          type: "activated",
          targets: [{ id: "r", selector: { zone: "hand", type: "resource" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "r" }, controller: "controller" }]
        }
      ]
    }
  });
  const b = recurBoard({ extra: [{ key: "plant", def: plant, owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("plant"), { selected: { r: [b.id("resO")] } });
  assert.equal(b.engine.state.cards[b.id("resO")].zone, "play", "control: the resource entered");
  answerMay(b, true);
  assert.equal(zoneOf(b.engine, b.id("man")), "play");
  assert.equal(b.engine.state.cards[b.id("man")].faceDown, true);
});

// --- FLIP UP ----------------------------------------------------------------------

function flipBoard(o: { res?: CardPlacement[]; manSpent?: boolean } = {}) {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "man", def: printing(MAN), owner: P1, zone: "play", faceDown: true, ...(o.manSpent ? { attachedToKey: "__factionA" } : {}) },
      { key: "fd", def: drawTactic("Zap", 0, 2), owner: P1, zone: "play", faceDown: true, attachedToKey: "__factionA" },
      ...fillers("d", 10, P1, "deck"),
      ...fillers("e", 6, P2, "deck"),
      ...(o.res ?? bank("obsession", 2, P1))
    ]
  });
}
const flipMan = (b: B) =>
  flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("man"), selected: { rev: [b.id("fd")] }, variables: {} });

clause(MAN, "3:flipUp", "FLIP UP 1 [O]: flips up, reveals a face-down tactic, may deploy it, draws a card", () => {
  const b = flipBoard();
  const hand = handOf(b.engine, P1).length;
  flipMan(b);
  resolvePendingResponses(b.engine);
  assert.equal((pending(b.engine) as unknown as { kind: string })?.kind, "deployForFree");
  deployChoice(b, "fd");
  assert.equal(handOf(b.engine, P1).length, hand + 2 + 1, "Zap drew 2, Manifest drew 1");
  assert.equal(zoneOf(b.engine, b.id("fd")), "discard");
  assert.equal(zoneOf(b.engine, b.id("man")), "discard", "Manifest, once used, goes to the discard pile");
  assert.equal(getLogRevealed(b.engine).length, 1, "the tactic was revealed");
});

clause(MAN, "3:flipUp", "FLIP UP: the deploy is optional (declined: only the draw happens)", () => {
  const b = flipBoard();
  const hand = handOf(b.engine, P1).length;
  flipMan(b);
  resolvePendingResponses(b.engine);
  declineDeploy(b);
  assert.equal(handOf(b.engine, P1).length, hand + 1);
  assert.equal(zoneOf(b.engine, b.id("fd")), "play");
});

clause(MAN, "3:flipUp", "FLIP UP costs 1 and needs [O]: refused without [O]; works with an [O] icon and the card paying for itself or another resource paying", () => {
  const noO = flipBoard({ res: bank("rage", 3, P1) });
  refused(() => flipMan(noO), "no [O]", /threshold requirements/i);
  assert.equal(noO.engine.state.cards[noO.id("man")].faceDown, true);
  const selfPay = flipBoard({ res: spent("obsession", 1, P1) });
  flipMan(selfPay);
  resolvePendingResponses(selfPay.engine);
  assert.equal(selfPay.engine.state.cards[selfPay.id("man")].faceDown !== true, true, "0 others + itself pays 1");
  const ok = flipBoard({ res: [...spent("obsession", 1, P1), ...bank("rage", 1, P1)] });
  flipMan(ok);
  resolvePendingResponses(ok.engine);
  assert.equal(ok.engine.state.cards[ok.id("man")].faceDown !== true, true, "flipped up");
});

clause(MAN, "3:flipUp", "FLIP UP: its own Volition doesn't satisfy [O]; one other resource plus an [O] icon is enough", () => {
  const b = flipBoard({ res: bank("rage", 1, P1) });
  refused(() => flipMan(b), "the face-down Manifest is Volition; no [O] anywhere", /threshold requirements/i);
  const exact = flipBoard({ res: [...spent("obsession", 1, P1), ...bank("rage", 1, P1)] });
  const before = ready(exact.engine);
  flipMan(exact);
  resolvePendingResponses(exact.engine);
  assert.equal(before - ready(exact.engine) >= 1, true, "1 was paid (and Manifest stopped being a resource)");
});

clause(MAN, "3:flipUp", "FLIP UP costs exactly 1: with every resource and the face-down Manifest itself spent nothing can pay it (refused); the same board with Manifest ready pays and flips up", () => {
  const bad = flipBoard({ res: spent("obsession", 2, P1), manSpent: true });
  assert.equal(ready(bad.engine), 0, "nothing is ready");
  refused(() => flipMan(bad), "cost 1 and nothing ready", /FLIP UP costs cannot be paid/);
  assert.equal(bad.engine.state.cards[bad.id("man")].faceDown, true, "still face-down");
  const good = flipBoard({ res: spent("obsession", 2, P1) });
  flipMan(good);
  resolvePendingResponses(good.engine);
  assert.equal(good.engine.state.cards[good.id("man")].faceDown !== true, true, "the ready Manifest paid 1 and flipped up");
});

// =========================================================================================
// MESMERIZING ENCHANTRESS
// =========================================================================================

const ENCH = "ef0f6043-61e1-4bdf-879f-a923342f844a"; // EXTRA COST: You may pick 4 or fewer characters. -- When this card enters play, if you picked characters as part of its cost, they cannot attack until the start of your next turn.

function enchBoard(o: { res?: CardPlacement[]; extra?: CardPlacement[] } = {}) {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "en", def: printing(ENCH), owner: P1, zone: "hand" },
      { key: "a1", def: character({ name: "A1" }), owner: P1, zone: "play" },
      { key: "a2", def: character({ name: "A2" }), owner: P1, zone: "play" },
      { key: "a3", def: character({ name: "A3" }), owner: P1, zone: "play" },
      { key: "o1", def: character({ name: "O1" }), owner: P2, zone: "play" },
      { key: "o2", def: character({ name: "O2" }), owner: P2, zone: "play" },
      { key: "o3", def: character({ name: "O3" }), owner: P2, zone: "play" },
      ...fillers("d", 4, P1, "deck"),
      ...fillers("e", 4, P2, "deck"),
      ...(o.res ?? bank("obsession", 5, P1)),
      ...(o.extra ?? [])
    ]
  });
}
const ench = (b: B, picks: string[]) => play(b.engine, P1, b.id("en"), { selected: { cs: picks.map((k) => b.id(k)) } });
const attack = (b: B, who: PlayerId, k: string) => declareAttackBy(b.engine, who, [b.id(k)]);

clause(ENCH, "0:extraCost", "printed character / arcanist / sorceress, 2 strength / 3 speed / 4 life, cost 5, threshold [O][O]; exact cost works", () => {
  const b = enchBoard();
  const d = b.engine.getDefinition(b.id("en"));
  assert.deepEqual([d.type, d.trade, d.subtype, d.cost, d.threshold], ["character", "arcanist", ["sorceress"], 5, "oo"]);
  assert.deepEqual([b.engine.getStat(b.id("en"), "strength"), b.engine.getStat(b.id("en"), "speed"), b.engine.getStat(b.id("en"), "life")], [2, 3, 4]);
  ench(b, []);
  assert.equal(zoneOf(b.engine, b.id("en")), "play");
  assert.equal(ready(b.engine), 0, "cost 5 paid");
});

clause(ENCH, "0:extraCost", "one resource short of 5 is refused (threshold met by spent [O][O]); cost 5 works with 5 ready", () => {
  const short = enchBoard({ res: [...spent("obsession", 2, P1), ...bank("rage", 4, P1)] });
  refused(() => ench(short, []), "4 ready, cost 5", /Costs cannot be paid/);
  assert.equal(zoneOf(short.engine, short.id("en")), "hand");
  const ok = enchBoard({ res: [...spent("obsession", 2, P1), ...bank("rage", 5, P1)] });
  ench(ok, []);
  assert.equal(zoneOf(ok.engine, ok.id("en")), "play");
});

clause(ENCH, "0:extraCost", "threshold [O][O]: refused with only one [O] (or none) among enough resources", () => {
  const one = enchBoard({ res: [...bank("obsession", 1, P1), ...bank("rage", 5, P1)] });
  refused(() => ench(one, []), "one [O]", /Threshold requirements/);
  const none = enchBoard({ res: bank("rage", 6, P1) });
  refused(() => ench(none, []), "no [O]", /Threshold requirements/);
  assert.equal(zoneOf(none.engine, none.id("en")), "hand");
});

clause(ENCH, "0:extraCost", "the pick is optional and up to 4: 0, 1 and 4 characters (mixed controllers) are accepted", () => {
  for (const picks of [[], ["a1"], ["a1", "a2", "o1", "o2"]]) {
    const b = enchBoard();
    ench(b, picks);
    assert.equal(zoneOf(b.engine, b.id("en")), "play", `picks ${picks.join(",")}`);
    assert.equal(b.engine.state.pendingChoice, undefined);
  }
});

clause(ENCH, "0:extraCost", "5 picks are refused; so are non-characters, characters outside play and the same character twice", () => {
  const b = enchBoard({
    extra: [
      { key: "it", def: item({ name: "AnItem" }), owner: P1, zone: "play" },
      { key: "loc", def: location({ name: "ALoc" }), owner: P2, zone: "play" },
      { key: "inhand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "indisc", def: character({ name: "InDisc" }), owner: P2, zone: "discard" }
    ]
  });
  refused(() => ench(b, ["a1", "a2", "a3", "o1", "o2"]), "5 picks");
  for (const bad of ["it", "loc", "inhand", "indisc"]) refused(() => ench(b, ["a1", bad]), `${bad} is not a character in play`);
  refused(() => ench(b, ["a1", "a1"]), "the same character twice");
  assert.equal(zoneOf(b.engine, b.id("en")), "hand", "never played");
  assert.equal(ready(b.engine), 5, "nothing paid");
  ench(b, ["a1", "a2", "a3", "o1"]);
  assert.equal(zoneOf(b.engine, b.id("en")), "play", "control: 4 picks");
});

clause(ENCH, "1:rule", "picked characters (yours and the opponent's) cannot attack after it enters play; unpicked ones still can", () => {
  const picked = enchBoard();
  ench(picked, ["a1", "o1"]);
  refused(() => attack(picked, P1, "a1"), "picked own character cannot attack");
  assert.equal(battleOf2(picked), undefined, "no attack was declared");
  const free = enchBoard();
  ench(free, ["a1", "o1"]);
  attack(free, P1, "a2");
  assert.ok(battleOf2(free), "control: an unpicked character attacks");
  const opp = enchBoard();
  ench(opp, ["a1", "o1"]);
  endTurn(opp.engine, P1);
  refused(() => attack(opp, P2, "o1"), "picked opposing character cannot attack on their turn");
  attack(opp, P2, "o2");
  assert.ok(battleOf2(opp), "control: unpicked opposing character attacks");
});

clause(ENCH, "1:rule", "all four picked characters are restricted, not just the first", () => {
  const b = enchBoard();
  ench(b, ["a1", "a2", "a3", "o1"]);
  for (const k of ["a1", "a2", "a3"]) refused(() => attack(b, P1, k), `${k} cannot attack`);
  assert.equal(battleOf2(b), undefined);
  endTurn(b.engine, P1);
  refused(() => attack(b, P2, "o1"), "o1 cannot attack");
  attack(b, P2, "o3");
  assert.ok(battleOf2(b), "control: o3 was never picked");
});

clause(ENCH, "1:rule", "no pick, no restriction: when no characters were picked everyone can attack", () => {
  const b = enchBoard();
  ench(b, []);
  attack(b, P1, "a1");
  assert.ok(battleOf2(b), "battleOf2(b)");
  const c = enchBoard();
  ench(c, []);
  endTurn(c.engine, P1);
  attack(c, P2, "o1");
  assert.ok(battleOf2(c), "battleOf2(c)");
});

clause(ENCH, "1:rule", "'until the start of your next turn': your picked character is free again when your next turn starts", () => {
  const b = enchBoard();
  ench(b, ["a1"]);
  refused(() => attack(b, P1, "a1"), "restricted this turn");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  attack(b, P1, "a1");
  assert.ok(battleOf2(b), "can attack again on my next turn");
});

clause(ENCH, "1:rule", "the opponent's picked character is held back for their whole next turn, and free the turn after", () => {
  const b = enchBoard();
  ench(b, ["o1"]);
  endTurn(b.engine, P1);
  refused(() => attack(b, P2, "o1"), "their next turn");
  endTurn(b.engine, P2);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  attack(b, P2, "o1");
  assert.ok(battleOf2(b), "free on their second turn");
});

clause(ENCH, "1:rule", "triggers only for Enchantress herself entering (not when another character enters later)", () => {
  const b = enchBoard({ extra: [{ key: "later", def: character({ name: "Later", cost: 0 }), owner: P1, zone: "hand" }] });
  ench(b, ["a1"]);
  play(b.engine, P1, b.id("later"));
  assert.equal(zoneOf(b.engine, b.id("later")), "play");
  refused(() => attack(b, P1, "a1"), "still restricted, only a1");
  attack(b, P1, "a2");
  assert.ok(battleOf2(b), "battleOf2(b)");
});

// =========================================================================================
// MR. CHESTERTON
// =========================================================================================

const CHEST = "f2952961-8a1d-4c03-a7f0-69bc68fbd48c"; // EXTRA COST: Pick a tactic in a discard pile. -- While the picked card is in its owner's discard pile, this card gains COVERT.

const recall = () =>
  item({
    name: "Recall",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "rec",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", type: "tactic" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        },
        {
          id: "dump",
          type: "activated",
          targets: [{ id: "h", selector: { zone: "hand", type: "tactic" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "h" }, to: "discard" }]
        },
        {
          id: "exile",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", type: "tactic" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "void" }]
        }
      ]
    }
  });

function chestBoard(o: { res?: CardPlacement[]; extra?: CardPlacement[] } = {}) {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "mc", def: printing(CHEST), owner: P1, zone: "hand" },
      { key: "tA", def: drawTactic("TacA", 0), owner: P1, zone: "discard" },
      { key: "tB", def: drawTactic("TacB", 0), owner: P2, zone: "discard" },
      { key: "rc", def: recall(), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 6 }), owner: P2, zone: "play" },
      ...fillers("d", 4, P1, "deck"),
      ...fillers("e", 4, P2, "deck"),
      ...(o.res ?? bank("obsession", 2, P1)),
      ...(o.extra ?? [])
    ]
  });
}
const chest = (b: B, anchor: string) => play(b.engine, P1, b.id("mc"), { selected: { anchor: [b.id(anchor)] } });
const covert = (b: B) => b.engine.getKeywords(b.id("mc")).includes("covert");

clause(CHEST, "0:extraCost", "printed character / arcanist / advisor, couch / cost 2 / threshold [O] / 2 strength, 3 speed, 2 life; exact cost works", () => {
  const b = chestBoard();
  const d = b.engine.getDefinition(b.id("mc"));
  assert.deepEqual([d.type, d.trade, d.subtype, d.cost, d.threshold], ["character", "arcanist", ["advisor", "couch"], 2, "o"]);
  assert.deepEqual([b.engine.getStat(b.id("mc"), "strength"), b.engine.getStat(b.id("mc"), "speed"), b.engine.getStat(b.id("mc"), "life")], [2, 3, 2]);
  chest(b, "tA");
  assert.equal(zoneOf(b.engine, b.id("mc")), "play");
  assert.equal(ready(b.engine), 0, "cost 2 paid");
});

clause(CHEST, "0:extraCost", "one short of cost 2 is refused (threshold met by a spent [O]); needs [O]", () => {
  const short = chestBoard({ res: [...spent("obsession", 2, P1), ...bank("rage", 1, P1)] });
  refused(() => chest(short, "tA"), "1 ready, cost 2", /Costs cannot be paid/);
  assert.equal(zoneOf(short.engine, short.id("mc")), "hand");
  const noO = chestBoard({ res: bank("rage", 3, P1) });
  refused(() => chest(noO, "tA"), "no [O]", /Threshold requirements/);
  const ok = chestBoard({ res: [...spent("obsession", 1, P1), ...bank("rage", 2, P1)] });
  chest(ok, "tA");
  assert.equal(zoneOf(ok.engine, ok.id("mc")), "play", "control: threshold via a spent [O], cost via 2 rage");
});

clause(CHEST, "0:extraCost", "a tactic in either player's discard pile can be picked", () => {
  for (const k of ["tA", "tB"]) {
    const b = chestBoard();
    chest(b, k);
    assert.equal(zoneOf(b.engine, b.id("mc")), "play", k);
    assert.equal(b.engine.state.pendingChoice, undefined);
  }
});

clause(CHEST, "0:extraCost", "only a tactic in a discard pile: a discarded character, a tactic in hand/play/deck, and no pick are refused", () => {
  const b = chestBoard({
    extra: [
      { key: "cd", def: character({ name: "DiscChar" }), owner: P1, zone: "discard" },
      { key: "th", def: drawTactic("InHand", 0), owner: P1, zone: "hand" },
      { key: "tp", def: drawTactic("InPlay", 0), owner: P1, zone: "play" },
      { key: "tdk", def: drawTactic("InDeck", 0), owner: P2, zone: "deck" }
    ]
  });
  for (const k of ["cd", "th", "tp", "tdk"]) {
    refused(() => chest(b, k), `${k} is not a tactic in a discard pile`);
    assert.equal(zoneOf(b.engine, b.id("mc")), "hand");
  }
  refused(() => play(b.engine, P1, b.id("mc"), {}), "a pick is required");
  assert.equal(ready(b.engine), 2, "nothing was paid");
  chest(b, "tA");
  assert.equal(zoneOf(b.engine, b.id("mc")), "play", "control");
});

clause(CHEST, "1:rule", "gains COVERT while the picked tactic (yours or the opponent's) is in its owner's discard pile; no COVERT of its own", () => {
  for (const k of ["tA", "tB"]) {
    const b = chestBoard();
    assert.equal(b.engine.getKeywords(b.id("mc")).includes("covert"), false, "not covert in hand");
    chest(b, k);
    assert.equal(covert(b), true, `${k} in discard: covert`);
  }
});

clause(CHEST, "1:rule", "loses COVERT when the picked card leaves the discard pile (to hand or out of the game); another tactic leaving changes nothing", () => {
  for (const ability of ["rec", "exile"]) {
    const b = chestBoard();
    chest(b, "tA");
    activate(b.engine, P1, b.id("rc"), ability, { selected: { t: [b.id("tB")] } });
    assert.notEqual(zoneOf(b.engine, b.id("tB")), "discard", "control: the other tactic left");
    assert.equal(covert(b), true, `${ability}: unrelated tactic leaving does not matter`);
    activate(b.engine, P1, b.id("rc"), ability, { selected: { t: [b.id("tA")] } });
    assert.notEqual(zoneOf(b.engine, b.id("tA")), "discard");
    assert.equal(covert(b), false, `${ability}: picked card left the discard pile`);
  }
});

clause(CHEST, "1:rule", "COVERT follows the picked card literally: back in the discard pile, Chesterton is covert again", () => {
  const b = chestBoard();
  chest(b, "tA");
  activate(b.engine, P1, b.id("rc"), "rec", { selected: { t: [b.id("tA")] } });
  assert.equal(covert(b), false);
  activate(b.engine, P1, b.id("rc"), "dump", { selected: { h: [b.id("tA")] } });
  assert.equal(zoneOf(b.engine, b.id("tA")), "discard");
  assert.equal(covert(b), true);
});

clause(CHEST, "1:rule", "the COVERT is real in battle: non-covert characters can't block it while the anchor sits in the discard, and can once it left", () => {
  const run = (leave: boolean) => {
    const b = chestBoard();
    chest(b, "tA");
    endTurn(b.engine, P1);
    endTurn(b.engine, P2);
    if (leave) activate(b.engine, P1, b.id("rc"), "rec", { selected: { t: [b.id("tA")] } });
    declareAttackBy(b.engine, P1, [b.id("mc")]);
    return b;
  };
  const withCovert = run(false);
  refused(() => declareBlockers(withCovert.engine, P2, [withCovert.id("foe")]), "a non-covert character can't block a covert attacker");
  const without = run(true);
  declareBlockers(without.engine, P2, [without.id("foe")]);
  assert.ok(without.engine.state.battle, "control: without COVERT the block is legal");
});

// =========================================================================================
// MUDDLE
// =========================================================================================

const MUD = "661149af-4e4f-42c2-92e0-95081a3a83ac"; // EXTRA COST: Deploy this only in response to a tactic being deployed. Pay X, where X is its numeric cost. -- Duplicate the tactic. Terminate the tactic.

const pump = (name: string, cost: number, amount: number) =>
  tactic({
    name,
    cost,
    behavior: {
      abilities: [
        {
          id: "p",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "strength", operation: "add", value: amount, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });

function mudBoard(o: { tac?: CardDefinition; res?: CardPlacement[]; extra?: CardPlacement[]; active?: PlayerId; mudOwner?: PlayerId } = {}) {
  const caster = o.active ?? P1; // owns the tactic; the opponent owns Muddle
  const responder: PlayerId = caster === P1 ? P2 : P1;
  const mudOwner = o.mudOwner ?? responder;
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: caster,
    cards: [
      { key: "tc", def: o.tac ?? drawTactic("Target", 2), owner: caster, zone: "hand" },
      { key: "mud", def: printing(MUD), owner: mudOwner, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 4 }), owner: caster, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 4 }), owner: responder, zone: "play" },
      ...fillers("d", 8, caster, "deck"),
      ...fillers("e", 8, responder, "deck"),
      ...bank("obsession", 6, caster),
      ...(o.res ?? bank("obsession", 6, responder)),
      ...(o.extra ?? [])
    ]
  });
}
/** The caster deploys the tactic and the other player holds priority; then that player plays Muddle in response. */
function muddleIn(b: B, selected: Record<string, string[]> = {}, caster: PlayerId = P1) {
  playRaw(b.engine, caster, b.id("tc"), { selected });
  const responder: PlayerId = caster === P1 ? P2 : P1;
  playRaw(b.engine, responder, b.id("mud"));
  resolvePendingResponses(b.engine);
}

clause(MUD, "0:extraCost", "printed tactic / arcanist / cost 0 / threshold [O][O][O]", () => {
  const b = mudBoard();
  const d = b.engine.getDefinition(b.id("mud"));
  assert.deepEqual([d.type, d.trade, d.cost, d.threshold], ["tactic", "arcanist", 0, "ooo"]);
});

for (const x of [0, 1, 3]) {
  clause(MUD, "0:extraCost", `pays X, the numeric cost of the tactic (X=${x}), and only that`, () => {
    const b = mudBoard({ tac: drawTactic(`T${x}`, x) });
    playRaw(b.engine, P1, b.id("tc"));
    const before = ready(b.engine, P2);
    playRaw(b.engine, P2, b.id("mud"));
    assert.equal(before - ready(b.engine, P2), x, `X = ${x}`);
    resolvePendingResponses(b.engine);
    assert.equal(zoneOf(b.engine, b.id("mud")), "discard");
  });
}

clause(MUD, "0:extraCost", "exactly X ready resources is enough; one short is refused (threshold met by spent [O]s)", () => {
  const exact = mudBoard({ tac: drawTactic("T3", 3), res: bank("obsession", 3, P2) });
  muddleIn(exact);
  assert.equal(zoneOf(exact.engine, exact.id("mud")), "discard");
  assert.equal(ready(exact.engine, P2), 0, "all 3 spent");
  const short = mudBoard({ tac: drawTactic("T3", 3), res: [...spent("obsession", 3, P2), ...bank("rage", 2, P2)] });
  playRaw(short.engine, P1, short.id("tc"));
  refused(() => playRaw(short.engine, P2, short.id("mud")), "2 ready, X = 3", /Costs cannot be paid/);
  assert.equal(zoneOf(short.engine, short.id("mud")), "hand");
  assert.equal(ready(short.engine, P2), 2, "nothing paid");
});

clause(MUD, "0:extraCost", "needs [O][O][O]: refused with enough resources but only two [O]; works with three", () => {
  const two = mudBoard({ tac: drawTactic("T1", 1), res: [...bank("obsession", 2, P2), ...bank("rage", 3, P2)] });
  playRaw(two.engine, P1, two.id("tc"));
  refused(() => playRaw(two.engine, P2, two.id("mud")), "two [O]", /Threshold requirements/);
  const three = mudBoard({ tac: drawTactic("T1", 1), res: [...bank("obsession", 3, P2), ...bank("rage", 3, P2)] });
  muddleIn(three);
  assert.equal(zoneOf(three.engine, three.id("mud")), "discard");
  const spentThree = mudBoard({ tac: drawTactic("T0", 0), res: spent("obsession", 3, P2) });
  muddleIn(spentThree);
  assert.equal(zoneOf(spentThree.engine, spentThree.id("mud")), "discard", "X=0: spent [O][O][O] satisfy the threshold");
});

clause(MUD, "0:extraCost", "only in response to a tactic being deployed: refused with nothing being deployed (either turn)", () => {
  const mine = mudBoard();
  refused(() => playRaw(mine.engine, P2, mine.id("mud")), "nothing on the stack, opponent's turn");
  assert.equal(zoneOf(mine.engine, mine.id("mud")), "hand");
  const own = mudBoard({ active: P2 });
  refused(() => playRaw(own.engine, P1, own.id("mud")), "nothing to respond to on the opponent's turn");
  const ctrl = mudBoard();
  muddleIn(ctrl);
  assert.equal(zoneOf(ctrl.engine, ctrl.id("mud")), "discard", "control: responding to a tactic works");
});

clause(MUD, "0:extraCost", "you can't respond to your own tactic (CR 607.1): the caster can't Muddle it", () => {
  const b = mudBoard({ mudOwner: P1 });
  playRaw(b.engine, P1, b.id("tc"));
  refused(() => playRaw(b.engine, P1, b.id("mud")), "own action", /priority/);
  assert.equal(zoneOf(b.engine, b.id("mud")), "hand");
});

clause(MUD, "0:extraCost", "not in response to a character being deployed or an ability being used", () => {
  const abil = character({
    name: "Poker",
    strength: 1,
    life: 3,
    behavior: { abilities: [{ id: "poke", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const b = mudBoard({ extra: [{ key: "pk", def: abil, owner: P1, zone: "play" }] });
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("pk"), abilityId: "poke", selected: {}, variables: {} } as never);
  refused(() => playRaw(b.engine, P2, b.id("mud")), "responding to an ability, not a tactic");
  assert.equal(zoneOf(b.engine, b.id("mud")), "hand");
  const c = mudBoard({ extra: [{ key: "cc", def: character({ name: "Newcomer", cost: 0 }), owner: P1, zone: "hand" }] });
  playRaw(c.engine, P1, c.id("cc"));
  refused(() => playRaw(c.engine, P2, c.id("mud")), "responding to a character, not a tactic");
  assert.equal(zoneOf(c.engine, c.id("mud")), "hand");
});

clause(MUD, "1:rule", "Duplicate the tactic: its effect happens for Muddle's controller (the duplicate), Terminate: the original never resolves", () => {
  const b = mudBoard();
  const p1Hand = handOf(b.engine, P1).length;
  const p2Hand = handOf(b.engine, P2).length;
  muddleIn(b);
  assert.equal(handOf(b.engine, P2).length, p2Hand - 1 + 1, "Muddle left the hand; the duplicate drew a card for P2");
  assert.equal(handOf(b.engine, P1).length, p1Hand - 1, "the original tactic left P1's hand and drew nothing: it was terminated");
  assert.equal(zoneOf(b.engine, b.id("tc")), "discard", "the terminated original goes to its owner's discard pile");
  assert.equal(zoneOf(b.engine, b.id("mud")), "discard");
});

clause(MUD, "1:rule", "works the same from the other seat: on the opponent's turn the other player Muddles", () => {
  const b = mudBoard({ active: P2 });
  const p1Hand = handOf(b.engine, P1).length;
  const p2Hand = handOf(b.engine, P2).length;
  muddleIn(b, {}, P2);
  assert.equal(handOf(b.engine, P1).length, p1Hand - 1 + 1, "P1 (Muddle) drew from the duplicate");
  assert.equal(handOf(b.engine, P2).length, p2Hand - 1, "P2's original was terminated");
});

clause(MUD, "1:rule", "Terminate the tactic means only THAT tactic: a tactic lower on the stack (the one it responded to) still resolves", () => {
  const b = mudBoard({
    tac: drawTactic("Under", 0, 2),
    mudOwner: P1,
    extra: [{ key: "xt", def: drawTactic("Over", 1, 1), owner: P2, zone: "hand" }]
  });
  const p1Hand = handOf(b.engine, P1).length;
  const p2Hand = handOf(b.engine, P2).length;
  playRaw(b.engine, P1, b.id("tc")); // Under (draw 2) goes on the stack
  playRaw(b.engine, P2, b.id("xt")); // Over (draw 1) responds
  playRaw(b.engine, P1, b.id("mud")); // Muddle responds to Over
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("xt")), "discard", "Over was terminated");
  assert.equal(handOf(b.engine, P2).length, p2Hand - 1, "Over drew nothing for P2: it was terminated");
  assert.equal(zoneOf(b.engine, b.id("tc")), "discard", "Under resolved normally and was discarded");
  assert.equal(handOf(b.engine, P1).length, p1Hand - 1 - 1 + 1 + 2, "P1: -Under -Muddle, +1 from the duplicate of Over, +2 from Under resolving");
});

// W3a: test corrected. It asserted that the copy reuses the ORIGINAL's pick (foe). The copy has all the original's rules text,
// so it satisfies the tactic's picks anew (CR 307.1); Muddle's controller (P2) picks for the copy. The original is terminated.
clause(MUD, "1:rule", "a duplicated targeted tactic resolves exactly once, on the pick made for the copy (+3 strength once, not twice and not zero)", () => {
  const b = mudBoard({ tac: pump("Pump", 1, 3) });
  playRaw(b.engine, P1, b.id("tc"), { selected: { t: [b.id("foe")] } });
  playRaw(b.engine, P2, b.id("mud"));
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice?.kind, "chooserSelectsTarget", "the copy's pick is asked of Muddle's controller");
  assert.equal(b.engine.state.pendingChoice?.playerId, P2);
  b.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [b.id("mine")] } } as never);
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 1 + 3, "exactly one resolution, on the copy's pick");
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 1, "the terminated original did nothing to its pick");
  assert.equal(zoneOf(b.engine, b.id("tc")), "discard");
});

clause(MUD, "1:rule", "the duplicate keeps the tactic's extra costs and the original does nothing", () => {
  const tithe = tactic({
    name: "Tithe",
    cost: 1,
    behavior: {
      abilities: [
        {
          id: "tithe",
          type: "activated",
          costs: [{ type: "discard", id: "dc", player: "controller", selector: { zone: "hand" }, count: 1 }],
          effects: [{ type: "modifyInfluence", player: "opponent", amount: -1 }]
        }
      ]
    }
  });
  const b = mudBoard({
    tac: tithe,
    extra: [
      { key: "h1", def: character({ name: "H1" }), owner: P1, zone: "hand" },
      { key: "h2", def: character({ name: "H2" }), owner: P2, zone: "hand" }
    ]
  });
  const p1 = b.engine.state.players[P1].influence;
  const p2 = b.engine.state.players[P2].influence;
  playRaw(b.engine, P1, b.id("tc"), { selected: { dc: [b.id("h1")] } });
  playRaw(b.engine, P2, b.id("mud"), { selected: {} });
  resolvePendingResponses(b.engine);
  // E3b: the copy keeps the extra cost "discard a card", so Muddle's controller (P2) is asked what to discard for it.
  assert.equal(b.engine.state.pendingChoice?.kind, "chooserSelectsTarget", "the copy's 'discard a card' is asked of Muddle's controller");
  assert.equal(b.engine.state.pendingChoice?.playerId, P2);
  b.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [b.id("h2")] } } as never);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("h2")), "discard", "the copy's extra cost was paid");
  assert.equal(b.engine.state.players[P2].influence, p2, "the original did not hit P2");
  assert.equal(b.engine.state.players[P1].influence, p1 - 1, "the duplicate (P2's) hits P1");
});

// =========================================================================================
// MUTILATED
// =========================================================================================

const MUT = "946891f2-c6c7-4894-b8e4-b897ebd74472"; // EXTRA COST: Pick a character you control. That character loses 2 life this turn. Pick another character. -- The character gains 1 strength and COVERT this turn. Draw a card. -- FLIP UP: 2 [O]

function mutBoard(o: { res?: CardPlacement[]; extra?: CardPlacement[]; mineLife?: number } = {}) {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "mut", def: printing(MUT), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: o.mineLife ?? 5 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", strength: 2, life: 4 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 3, life: 4 }), owner: P2, zone: "play" },
      ...fillers("d", 8, P1, "deck"),
      ...fillers("e", 4, P2, "deck"),
      ...(o.res ?? bank("obsession", 4, P1)),
      ...(o.extra ?? [])
    ]
  });
}
const mut = (b: B, mine: string, buff: string) => play(b.engine, P1, b.id("mut"), { selected: { mine: [b.id(mine)], buff: [b.id(buff)] } });
const st = (b: B, k: string, s: "strength" | "life" = "strength") => b.engine.getStat(b.id(k), s);
const cov = (b: B, k: string) => b.engine.getKeywords(b.id(k)).includes("covert");

clause(MUT, "0:extraCost", "printed tactic / arcanist / cost 2 / threshold [O]; exact cost works", () => {
  const b = mutBoard({ res: bank("obsession", 2, P1) });
  const d = b.engine.getDefinition(b.id("mut"));
  assert.deepEqual([d.type, d.trade, d.cost, d.threshold], ["tactic", "arcanist", 2, "o"]);
  mut(b, "mine", "foe");
  assert.equal(zoneOf(b.engine, b.id("mut")), "discard");
  assert.equal(ready(b.engine), 0, "cost 2 paid");
});

clause(MUT, "0:extraCost", "one short of cost 2 is refused (threshold met by a spent [O]); needs [O]", () => {
  const short = mutBoard({ res: [...spent("obsession", 2, P1), ...bank("rage", 1, P1)] });
  refused(() => mut(short, "mine", "foe"), "1 ready, cost 2", /Costs cannot be paid/);
  assert.equal(zoneOf(short.engine, short.id("mut")), "hand");
  assert.equal(st(short, "mine", "life"), 5, "no life lost");
  const noO = mutBoard({ res: bank("rage", 3, P1) });
  refused(() => mut(noO, "mine", "foe"), "no [O]", /Threshold requirements/);
  const ok = mutBoard({ res: [...spent("obsession", 1, P1), ...bank("rage", 2, P1)] });
  mut(ok, "mine", "foe");
  assert.equal(zoneOf(ok.engine, ok.id("mut")), "discard", "control");
});

clause(MUT, "0:extraCost", "the first pick must be a character YOU control (also a stolen one); opponent's, item, hand and discard cards are refused", () => {
  const b = mutBoard({
    extra: [
      { key: "it", def: item({ name: "AnItem" }), owner: P1, zone: "play" },
      { key: "inhand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "indisc", def: character({ name: "InDisc" }), owner: P1, zone: "discard" },
      { key: "stolen", def: character({ name: "Stolen", life: 5 }), owner: P2, zone: "play", controller: P1 },
      { key: "lent", def: character({ name: "Lent", life: 5 }), owner: P1, zone: "play", controller: P2 }
    ]
  });
  for (const bad of ["foe", "it", "inhand", "indisc", "lent"]) {
    refused(() => mut(b, bad, "mine2"), `${bad} is not a character I control in play`);
    assert.equal(zoneOf(b.engine, b.id("mut")), "hand");
  }
  assert.equal(ready(b.engine), 4, "nothing paid");
  mut(b, "stolen", "foe");
  assert.equal(zoneOf(b.engine, b.id("mut")), "discard", "control: a character I control but don't own");
});

clause(MUT, "0:extraCost", "the second pick is 'another character': any other character (mine or theirs), never the first, an item, or a card outside play; both picks are required", () => {
  const b = mutBoard({
    extra: [
      { key: "it", def: item({ name: "AnItem" }), owner: P2, zone: "play" },
      { key: "inhand", def: character({ name: "InHand" }), owner: P2, zone: "hand" }
    ]
  });
  refused(() => mut(b, "mine", "mine"), "the same character twice");
  refused(() => mut(b, "mine", "it"), "an item");
  refused(() => mut(b, "mine", "inhand"), "a character in hand");
  refused(() => play(b.engine, P1, b.id("mut"), { selected: { mine: [b.id("mine")] } }), "second pick missing");
  refused(() => play(b.engine, P1, b.id("mut"), { selected: { buff: [b.id("foe")] } }), "first pick missing");
  refused(() => play(b.engine, P1, b.id("mut"), {}), "no picks");
  assert.equal(zoneOf(b.engine, b.id("mut")), "hand");
  assert.equal(ready(b.engine), 4);
  mut(b, "mine", "foe");
  assert.equal(zoneOf(b.engine, b.id("mut")), "discard", "control: an opposing character");
  const own = mutBoard();
  mut(own, "mine", "mine2");
  assert.equal(zoneOf(own.engine, own.id("mut")), "discard", "control: another of my own characters");
});

clause(MUT, "0:extraCost", "the picked character loses 2 life as part of the COST (already while the tactic waits for responses); the other pick is untouched until it resolves", () => {
  const b = mutBoard();
  playRaw(b.engine, P1, b.id("mut"), { selected: { mine: [b.id("mine")], buff: [b.id("foe")] } });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(st(b, "mine", "life"), 3, "5 - 2 right away");
  assert.equal(st(b, "foe"), 2, "no strength yet");
  assert.equal(cov(b, "foe"), false, "no COVERT yet");
  resolvePendingResponses(b.engine);
  assert.equal(st(b, "foe"), 3);
});

clause(MUT, "0:extraCost", "'loses 2 life this turn': exactly -2 on the first pick only, restored at the end of the turn; the second pick's life is unchanged", () => {
  const b = mutBoard();
  mut(b, "mine", "foe");
  assert.equal(st(b, "mine", "life"), 3);
  assert.equal(st(b, "foe", "life"), 4, "the second pick loses no life");
  assert.equal(st(b, "mine2", "life"), 4, "unpicked untouched");
  endTurn(b.engine, P1);
  assert.equal(st(b, "mine", "life"), 5, "back to 5 after the turn");
});

clause(MUT, "0:extraCost", "a first pick with 2 life drops to 0 and dies", () => {
  const b = mutBoard({ mineLife: 2 });
  mut(b, "mine", "foe");
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
});

clause(MUT, "1:rule", "the second pick gains 1 strength and COVERT, you draw a card", () => {
  const b = mutBoard();
  const hand = handOf(b.engine, P1).length;
  mut(b, "mine", "foe");
  assert.equal(st(b, "foe"), 3, "2 + 1");
  assert.equal(cov(b, "foe"), true);
  assert.equal(handOf(b.engine, P1).length, hand - 1 + 1, "Mutilated left, one card drawn");
});

clause(MUT, "1:rule", "only the second pick is buffed: the first pick and unpicked characters gain nothing", () => {
  const b = mutBoard();
  mut(b, "mine", "foe");
  assert.equal(st(b, "mine"), 1);
  assert.equal(cov(b, "mine"), false);
  for (const k of ["mine2", "foe2"]) {
    assert.equal(cov(b, k), false, `${k} no covert`);
  }
  assert.equal(st(b, "mine2"), 2);
  assert.equal(st(b, "foe2"), 3);
});

clause(MUT, "1:rule", "the buff can go on one of your own other characters", () => {
  const b = mutBoard();
  mut(b, "mine", "mine2");
  assert.equal(st(b, "mine2"), 3);
  assert.equal(cov(b, "mine2"), true);
  assert.equal(st(b, "mine", "life"), 3);
});

clause(MUT, "1:rule", "the strength and COVERT last only this turn", () => {
  const b = mutBoard();
  mut(b, "mine", "foe");
  endTurn(b.engine, P1);
  assert.equal(st(b, "foe"), 2, "strength back to printed");
  assert.equal(cov(b, "foe"), false, "covert gone");
  endTurn(b.engine, P2);
  assert.equal(st(b, "foe"), 2);
});

// --- FLIP UP ---

function mutFlip(o: { res?: CardPlacement[]; mutSpent?: boolean } = {}) {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "mut", def: printing(MUT), owner: P1, zone: "play", faceDown: true, ...(o.mutSpent ? { attachedToKey: "__factionA" } : {}) },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 5 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4 }), owner: P2, zone: "play" },
      ...fillers("d", 8, P1, "deck"),
      ...fillers("e", 4, P2, "deck"),
      ...(o.res ?? [...spent("obsession", 2, P1), ...bank("rage", 1, P1)])
    ]
  });
}
const flipMut = (b: B) =>
  flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("mut"), selected: { mine: [b.id("mine")], buff: [b.id("foe")] }, variables: {} });

clause(MUT, "2:flipUp", "FLIP UP 2 [O]: flips up for 2 and resolves like the tactic (first pick -2 life, second +1 strength and COVERT, draw)", () => {
  const b = mutFlip();
  const hand = handOf(b.engine, P1).length;
  flipMut(b);
  resolvePendingResponses(b.engine);
  assert.equal(st(b, "mine", "life"), 3);
  assert.equal(st(b, "foe"), 3);
  assert.equal(cov(b, "foe"), true);
  assert.equal(handOf(b.engine, P1).length, hand + 1, "drew a card");
  assert.equal(zoneOf(b.engine, b.id("mut")), "discard", "used up");
});

// Lead (2026-10-21): the card image prints "FLIP UP – 2 [O]" (one icon); this test used to assert [O][O] from the data.
clause(MUT, "2:flipUp", "FLIP UP costs exactly 2 and needs [O]: short on payment is refused, no [O] is refused, exact works", () => {
  const oneReady = mutFlip({ res: spent("obsession", 2, P1) });
  assert.equal(ready(oneReady.engine), 1, "only the face-down card itself");
  refused(() => flipMut(oneReady), "1 ready, cost 2", /FLIP UP costs cannot be paid/);
  assert.equal(st(oneReady, "mine", "life"), 5);
  const noO = mutFlip({ res: bank("rage", 4, P1) });
  refused(() => flipMut(noO), "no [O] at all", /threshold requirements/i);
  assert.equal(noO.engine.state.cards[noO.id("mut")].faceDown, true);
  const exact = mutFlip({ res: [...spent("obsession", 2, P1), ...bank("rage", 1, P1)] });
  flipMut(exact);
  resolvePendingResponses(exact.engine);
  assert.equal(st(exact, "foe"), 3, "control: 1 other + itself pays 2");
});

clause(MUT, "2:flipUp", "FLIP UP 2 [O] needs ONE [O] icon (not two): a single [O] among the resources (ready or spent) is enough to flip it up", () => {
  const oneO = mutFlip({ res: [...bank("obsession", 1, P1), ...bank("rage", 3, P1)] });
  flipMut(oneO);
  resolvePendingResponses(oneO.engine);
  assert.equal(oneO.engine.state.cards[oneO.id("mut")].faceDown !== true, true, "one [O] meets the printed [O] threshold");
  assert.equal(st(oneO, "mine", "life"), 3, "and it resolved like the tactic");
  const spentO = mutFlip({ res: [...spent("obsession", 1, P1), ...bank("rage", 2, P1)] });
  flipMut(spentO);
  resolvePendingResponses(spentO.engine);
  assert.equal(spentO.engine.state.cards[spentO.id("mut")].faceDown !== true, true, "a single spent [O] also meets the threshold");
  const noO = mutFlip({ res: bank("rage", 3, P1) });
  refused(() => flipMut(noO), "no [O] at all", /threshold requirements/i);
});
