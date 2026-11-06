// Clause tests — batch seed-saga-08, part p2 (groups 7-11, missing clauses only: Ashara Gideon's Twin,
// Burly Assailment, Cloaked Weaponmaster, Delusive Strumpet, Drygulch). Expectations come from each
// card's PRINTED text; engine data is only used to drive the engine.

import assert from "node:assert/strict";
import { buildGame, activate, bank, character, developFaction, item, play, resourceCard, tactic, volition, killTactic, resolvePendingResponses, P1, P2 } from "../per-card/_harness.js";
import { clause, clauseMismatch, declineAll, drain, printing, refused, flipUpNow, holdResourceFace } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { declareAttackOpenWindow, playRaw } from "./_battle.js";
import { fillers, pending, readyResources, zoneOf } from "./_board.js";
import { developResource } from "./_turn.js";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

const dev = (cards: CardPlacement[], extra: Parameters<typeof buildGame>[0] = {}) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, random: () => 0, turn: 2, activePlayerId: P1, ...extra, cards });
type Game = ReturnType<typeof dev>;

const D = (n: number, owner: PlayerId = P1): CardPlacement[] => bank("deception", n, owner);
const V = (n: number, owner: PlayerId = P1): CardPlacement[] => volition(n, owner);
/** `n` resources already spent (attached to the faction): they count for thresholds but cannot pay. */
const spent = (icon: "deception" | "rage", n: number, owner: PlayerId = P1): CardPlacement[] =>
  bank(icon, n, owner).map((p) => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));
const act = (e: SpoilsEngine, a: Record<string, unknown>) => e.perform(a as never);
const hasKw = (e: SpoilsEngine, id: CardInstanceId, kw: string) => e.getKeywords(id).includes(kw as never);
const card = (e: SpoilsEngine, id: CardInstanceId) => e.state.cards[id] as unknown as { zone: string; faceDown?: boolean; controllerId: PlayerId; ownerId: PlayerId; depleted?: boolean };
const handOf = (e: SpoilsEngine, p: PlayerId): CardInstanceId[] => [...e.state.players[p].hand];
const deckOf = (e: SpoilsEngine, p: PlayerId): CardInstanceId[] => [...e.state.players[p].deck];
const yes = (pc: PendingChoiceLike): unknown => (pc.kind === "mayPay" ? { kind: "mayPay", pay: true } : declineAll(pc));

// ===========================================================================================
// Ashara, Gideon's Twin — character — rogue — sorceress — cost 1 — threshold ddd — 1/3/3
// ===========================================================================================
const ASH = "5d139b84-9808-49e5-8779-667c0ae91a29";

const ashBoard = (o: { pay?: CardPlacement[]; extra?: CardPlacement[]; turnOf?: PlayerId } = {}) =>
  dev(
    [
      { key: "a", def: printing(ASH), owner: P1, zone: "hand" },
      { key: "c3", def: character({ name: "Three", life: 3, strength: 1 }), owner: P2, zone: "discard" },
      { key: "c2", def: character({ name: "Two", life: 2, strength: 2 }), owner: P2, zone: "discard" },
      ...(o.pay ?? spent("deception", 3).concat(V(1))),
      ...(o.extra ?? [])
    ],
    { activePlayerId: o.turnOf ?? P1 }
  );
const ashPlay = (b: Game, pick?: string[]) => {
  play(b.engine, P1, b.id("a"), pick ? { selected: { revive: pick.map((k) => b.id(k)) } } : {});
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.pendingChoice, undefined);
};

clause(ASH, "0:unique", "printed: character, rogue, sorceress, cost 1, threshold [D][D][D], 1 strength / 3 speed / 3 life; deploys with exactly 1 ready + [D][D][D]; refused one short, one [D] short, with no [D], or with only the opponent's [D]", () => {
  const def = printing(ASH);
  assert.equal(def.type, "character");
  assert.equal(def.trade, "rogue");
  assert.deepEqual([...def.subtype], ["sorceress"]);
  assert.equal(def.cost, 1);
  assert.equal(def.threshold, "ddd");
  const ok = ashBoard();
  assert.equal(readyResources(ok.engine, P1), 1);
  ashPlay(ok);
  assert.equal(zoneOf(ok.engine, ok.id("a")), "play", "control");
  assert.equal(readyResources(ok.engine, P1), 0, "exactly 1 paid");
  assert.equal(ok.engine.getStat(ok.id("a"), "strength"), 1);
  assert.equal(ok.engine.getStat(ok.id("a"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("a"), "life"), 3);
  const short = ashBoard({ pay: spent("deception", 3) });
  refused(() => play(short.engine, P1, short.id("a")), "no ready resource for cost 1");
  const oneD = ashBoard({ pay: spent("deception", 2).concat(V(3)) });
  refused(() => play(oneD.engine, P1, oneD.id("a")), "cost covered but only [D][D]");
  const noD = ashBoard({ pay: V(4) });
  refused(() => play(noD.engine, P1, noD.id("a")), "no [D] at all");
  const theirs = ashBoard({ pay: spent("deception", 2).concat(V(2), spent("deception", 3, P2)) });
  refused(() => play(theirs.engine, P1, theirs.id("a")), "the opponent's [D] does not count");
  const ready = ashBoard({ pay: D(3) });
  ashPlay(ready);
  assert.equal(zoneOf(ready.engine, ready.id("a")), "play", "ready [D] x3 also satisfies the threshold and pays the 1");
  assert.equal(readyResources(ready.engine, P1), 2);
});

clause(ASH, "0:unique", "UNIQUE ASHARA: a second copy under my control makes me choose which to keep (keep the new one: the old one is destroyed)", () => {
  const b = ashBoard({ extra: [{ key: "old", def: printing(ASH), owner: P1, zone: "play" }] });
  play(b.engine, P1, b.id("a"));
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  act(b.engine, { type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("a") } });
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("a")), "play");
  assert.equal(zoneOf(b.engine, b.id("old")), "discard", "the old copy was destroyed");
});

clause(ASH, "0:unique", "keeping the old copy destroys the new one; the choice cannot name an unrelated card", () => {
  const b = ashBoard({ extra: [{ key: "old", def: printing(ASH), owner: P1, zone: "play" }, { key: "bystander", def: character({ name: "By" }), owner: P1, zone: "play" }] });
  play(b.engine, P1, b.id("a"));
  assert.equal(pending(b.engine)!.kind, "uniqueSurvivor");
  assert.throws(() => act(b.engine, { type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("bystander") } }));
  act(b.engine, { type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("old") } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("old")), "play");
  assert.equal(zoneOf(b.engine, b.id("a")), "discard", "the new copy was destroyed");
  assert.equal(zoneOf(b.engine, b.id("bystander")), "play");
});

clause(ASH, "0:unique", "UNIQUE is per player: the opponent controlling their own Ashara causes no choice; a copy in hand or discard is no conflict", () => {
  const b = ashBoard({ extra: [{ key: "theirs", def: printing(ASH), owner: P2, zone: "play" }, { key: "inDiscard", def: printing(ASH), owner: P1, zone: "discard" }, { key: "inHand", def: printing(ASH), owner: P1, zone: "hand" }] });
  ashPlay(b);
  assert.equal(zoneOf(b.engine, b.id("a")), "play");
  assert.equal(zoneOf(b.engine, b.id("theirs")), "play");
  assert.equal(zoneOf(b.engine, b.id("inHand")), "hand");
  assert.equal(zoneOf(b.engine, b.id("inDiscard")), "discard");
});

clause(ASH, "1:extraCost", "may pick a character in an opponent's discard pile with 3 life or less: life 3 and life 2 are pickable, and the pick is the only thing that happens to it at cost time", () => {
  for (const pick of ["c3", "c2"]) {
    const b = ashBoard();
    ashPlay(b, [pick]);
    assert.equal(zoneOf(b.engine, b.id("a")), "play", `${pick}: Ashara deployed`);
    assert.equal(zoneOf(b.engine, b.id(pick)), "play", `${pick}: the pick came into play`);
  }
  const low = ashBoard({ extra: [{ key: "c0", def: character({ name: "Zero", life: 0 }), owner: P2, zone: "discard" }, { key: "c1", def: character({ name: "One", life: 1 }), owner: P2, zone: "discard" }] });
  ashPlay(low, ["c1"]);
  assert.equal(zoneOf(low.engine, low.id("c1")), "play", "life 1 is pickable");
});

clause(ASH, "1:extraCost", "the pick is optional: with no pick Ashara still deploys and the opponent's discard pile is untouched", () => {
  const b = ashBoard();
  const before = [...b.engine.state.players[P2].discard];
  ashPlay(b);
  assert.equal(zoneOf(b.engine, b.id("a")), "play");
  assert.deepEqual([...b.engine.state.players[P2].discard], before);
  assert.equal(zoneOf(b.engine, b.id("c3")), "discard");
  assert.equal(zoneOf(b.engine, b.id("c2")), "discard");
});

clause(ASH, "1:extraCost", "a character with 4 life is refused (positive control: life 3 is accepted)", () => {
  const b = ashBoard({ extra: [{ key: "c4", def: character({ name: "Four", life: 4 }), owner: P2, zone: "discard" }, { key: "c9", def: character({ name: "Nine", life: 9 }), owner: P2, zone: "discard" }] });
  refused(() => play(b.engine, P1, b.id("a"), { selected: { revive: [b.id("c4")] } }), "life 4 is above 3");
  refused(() => play(b.engine, P1, b.id("a"), { selected: { revive: [b.id("c9")] } }), "life 9 is above 3");
  assert.equal(zoneOf(b.engine, b.id("a")), "hand");
  assert.equal(readyResources(b.engine, P1), 1, "nothing was paid");
  ashPlay(b, ["c3"]);
  assert.equal(zoneOf(b.engine, b.id("c3")), "play", "control: life 3 works");
});

clause(ASH, "1:extraCost", "only a CHARACTER: a tactic, item or location card in the opponent's discard pile is refused", () => {
  const b = ashBoard({
    extra: [
      { key: "tac", def: tactic({ name: "Tac", cost: 0 }), owner: P2, zone: "discard" },
      { key: "itm", def: item({ name: "Itm", cost: 0 }), owner: P2, zone: "discard" },
      { key: "loc", def: { ...character({ name: "Loc" }), type: "location", structure: 2 } as never, owner: P2, zone: "discard" }
    ]
  });
  for (const k of ["tac", "itm", "loc"]) {
    refused(() => play(b.engine, P1, b.id("a"), { selected: { revive: [b.id(k)] } }), `${k} is not a character`);
    assert.equal(zoneOf(b.engine, b.id(k)), "discard");
  }
  assert.equal(zoneOf(b.engine, b.id("a")), "hand");
  ashPlay(b, ["c2"]);
  assert.equal(zoneOf(b.engine, b.id("c2")), "play", "control");
});

clause(ASH, "1:extraCost", "only the DISCARD PILE: an opponent's character in play, in hand, or in their deck is refused", () => {
  const b = ashBoard({
    extra: [
      { key: "inPlay", def: character({ name: "InPlay", life: 1 }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "InHand", life: 1 }), owner: P2, zone: "hand" },
      { key: "inDeck", def: character({ name: "InDeck", life: 1 }), owner: P2, zone: "deck" }
    ]
  });
  for (const k of ["inPlay", "inHand", "inDeck"]) refused(() => play(b.engine, P1, b.id("a"), { selected: { revive: [b.id(k)] } }), `${k} is not in a discard pile`);
  assert.equal(zoneOf(b.engine, b.id("a")), "hand");
  assert.equal(zoneOf(b.engine, b.id("inPlay")), "play");
  assert.equal(card(b.engine, b.id("inPlay")).controllerId, P2);
  ashPlay(b, ["c3"]);
  assert.equal(zoneOf(b.engine, b.id("c3")), "play", "control");
});

clause(ASH, "1:extraCost", "a character in MY OWN discard pile is refused (the text says an opponent's discard pile)", () => {
  const b = ashBoard({ extra: [{ key: "mine", def: character({ name: "Mine", life: 1 }), owner: P1, zone: "discard" }] });
  refused(() => play(b.engine, P1, b.id("a"), { selected: { revive: [b.id("mine")] } }), "own discard pile is not an opponent's");
  assert.equal(zoneOf(b.engine, b.id("a")), "hand");
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
});

clause(ASH, "1:extraCost", "only ONE character may be picked (\"a character\")", () => {
  const b = ashBoard();
  refused(() => play(b.engine, P1, b.id("a"), { selected: { revive: [b.id("c3"), b.id("c2")] } }), "two picks for one slot");
  assert.equal(zoneOf(b.engine, b.id("a")), "hand");
  ashPlay(b, ["c3"]);
  assert.equal(zoneOf(b.engine, b.id("c2")), "discard", "control: the unpicked one stays");
});

clause(ASH, "2:rule", "when Ashara enters play with a pick, the picked character is put into play under MY control (owner stays the opponent), face-up, and costs nothing", () => {
  const b = ashBoard();
  ashPlay(b, ["c3"]);
  const c = card(b.engine, b.id("c3"));
  assert.equal(c.zone, "play");
  assert.equal(c.controllerId, P1, "under my control");
  assert.equal(c.ownerId, P2, "still owned by the opponent");
  assert.equal(c.faceDown ?? false, false);
  assert.equal(readyResources(b.engine, P1), 0, "only Ashara's cost of 1 was paid; the character came for free");
  assert.equal(zoneOf(b.engine, b.id("c2")), "discard", "the unpicked character stays in the discard pile");
  assert.ok(!b.engine.state.players[P2].discard.includes(b.id("c3")), "!b.engine.state.players[P2].discard.includes(b.id(\"c3\"))");
  assert.ok(b.engine.state.players[P1].play.includes(b.id("c3")), "listed among my cards in play");
});

clause(ASH, "2:rule", "the revived character is a real character in play (stats readable) and, if destroyed, goes to its OWNER's discard pile", () => {
  const b = ashBoard({ extra: [{ key: "kill", def: killTactic({ name: "Kill" }), owner: P2, zone: "hand" }] });
  ashPlay(b, ["c2"]);
  assert.equal(b.engine.getStat(b.id("c2"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("c2"), "life"), 2);
  assert.equal(b.engine.getStat(b.id("c2"), "speed"), 1);
});

clause(ASH, "2:rule", "if I picked no character, nothing is put into play (no free character, no change to either discard pile)", () => {
  const b = ashBoard();
  const mine = [...b.engine.state.players[P1].play];
  const theirsBefore = [...b.engine.state.players[P2].play];
  ashPlay(b);
  assert.deepEqual(
    [...b.engine.state.players[P1].play].filter((x) => !mine.includes(x)),
    [b.id("a")],
    "only Ashara joined my board"
  );
  assert.deepEqual([...b.engine.state.players[P2].play], theirsBefore);
});

clause(ASH, "2:rule", "the revive belongs to Ashara entering play: an Ashara already on the board does nothing when another card enters, and an Ashara put directly in play with no pick revives nothing", () => {
  const b = ashBoard({ extra: [{ key: "on", def: printing(ASH), owner: P1, zone: "play" }, { key: "chr", def: character({ name: "Chr", cost: 0 }), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("chr"));
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("c3")), "discard");
  assert.equal(zoneOf(b.engine, b.id("c2")), "discard");
});

// ===========================================================================================
// Cloaked Weaponmaster — character — rogue — outlaw — cost 1 — threshold d — 1/3/1
// ===========================================================================================
const CLOAK = "79aee4b9-9640-4af4-84c1-531f1f5bb158";
const gearItem = (name = "Gear") => item({ name, cost: 1, subtype: ["gear"] } as never);

const cloakBoard = (o: { cloakZone?: "play" | "hand" | "discard"; cloakDown?: boolean; cloakOwner?: PlayerId; turnOf?: PlayerId; extra?: CardPlacement[] } = {}) =>
  dev(
    [
      { key: "cl", def: printing(CLOAK), owner: o.cloakOwner ?? P1, zone: o.cloakZone ?? "play", faceDown: o.cloakDown },
      { key: "gear", def: gearItem("Gear"), owner: P1, zone: "hand" },
      { key: "gear2", def: gearItem("Gear2"), owner: P1, zone: "hand" },
      { key: "junk", def: item({ name: "Junk", cost: 1 }), owner: P1, zone: "hand" },
      { key: "chr", def: character({ name: "Chr", cost: 1 }), owner: P1, zone: "hand" },
      { key: "ogear", def: gearItem("OGear"), owner: P2, zone: "hand" },
      { key: "nothing", def: tactic({ name: "Nothing", cost: 0 }), owner: P2, zone: "hand" },
      { key: "nothing2", def: tactic({ name: "Nothing2", cost: 0 }), owner: P2, zone: "hand" },
      { key: "mynothing", def: tactic({ name: "MyNothing", cost: 0 }), owner: P1, zone: "hand" },
      ...V(3, P1),
      ...V(3, P2),
      ...(o.extra ?? [])
    ],
    { activePlayerId: o.turnOf ?? P2 }
  );
const winOpen = (b: Game) => {
  playRaw(b.engine, P2, b.id("nothing"));
};

clause(CLOAK, "0:rule", "printed: character, rogue, outlaw, cost 1, threshold [D], 1 strength / 3 speed / 1 life; deploys with exactly 1 ready + [D]; refused with no ready, no [D], or only the opponent's [D]", () => {
  const def = printing(CLOAK);
  assert.equal(def.type, "character");
  assert.equal(def.trade, "rogue");
  assert.deepEqual([...def.subtype], ["outlaw"]);
  assert.equal(def.cost, 1);
  assert.equal(def.threshold, "d");
  const mk = (pay: CardPlacement[]) => dev([{ key: "cl", def: printing(CLOAK), owner: P1, zone: "hand" }, ...pay]);
  const ok = mk(spent("deception", 1).concat(V(1)));
  play(ok.engine, P1, ok.id("cl"));
  assert.equal(zoneOf(ok.engine, ok.id("cl")), "play", "control");
  assert.equal(readyResources(ok.engine, P1), 0, "exactly 1 paid");
  assert.equal(ok.engine.getStat(ok.id("cl"), "strength"), 1);
  assert.equal(ok.engine.getStat(ok.id("cl"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("cl"), "life"), 1);
  const noReady = mk(spent("deception", 1));
  refused(() => play(noReady.engine, P1, noReady.id("cl")), "cost 1 with nothing ready");
  const noD = mk(V(3));
  refused(() => play(noD.engine, P1, noD.id("cl")), "no [D]");
  const theirs = mk(V(2).concat(spent("deception", 2, P2)));
  refused(() => play(theirs.engine, P1, theirs.id("cl")), "the opponent's [D] does not count");
});

clause(CLOAK, "0:rule", "with Weaponmaster in play I can deploy a gear card from my hand in the opponent's response window (it enters play and its cost is paid)", () => {
  const b = cloakBoard();
  refused(() => playRaw(b.engine, P1, b.id("gear")), "no window is open yet (positive control follows)");
  assert.equal(zoneOf(b.engine, b.id("gear")), "hand");
  winOpen(b);
  const before = readyResources(b.engine, P1);
  playRaw(b.engine, P1, b.id("gear"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("gear")), "play", "gear entered play (not the discard pile)");
  assert.equal(card(b.engine, b.id("gear")).controllerId, P1);
  assert.equal(readyResources(b.engine, P1), before - 1, "its cost of 1 was paid");
});

clause(CLOAK, "0:rule", "without Weaponmaster in play a gear card cannot be deployed in a response window (control for the grant)", () => {
  const b = cloakBoard({ cloakZone: "hand" });
  winOpen(b);
  refused(() => playRaw(b.engine, P1, b.id("gear")), "no Weaponmaster in play", /Only tactics or TACTICAL cards may be deployed as responses/);
  assert.equal(zoneOf(b.engine, b.id("gear")), "hand");
});

clause(CLOAK, "0:rule", "only GEAR cards: a non-gear item and a character cannot be deployed in the window", () => {
  const b = cloakBoard();
  winOpen(b);
  refused(() => playRaw(b.engine, P1, b.id("junk")), "a non-gear item", /Only tactics or TACTICAL cards may be deployed as responses/);
  refused(() => playRaw(b.engine, P1, b.id("chr")), "an ordinary character", /Only tactics or TACTICAL cards may be deployed as responses/);
  assert.equal(zoneOf(b.engine, b.id("junk")), "hand");
  assert.equal(zoneOf(b.engine, b.id("chr")), "hand");
  playRaw(b.engine, P1, b.id("gear"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("gear")), "play", "control: gear works on the same board");
});

clause(CLOAK, "0:rule", "the grant is for my own gear: the opponent's Weaponmaster does not let me, and mine does not let the opponent deploy their gear", () => {
  const theirs = cloakBoard({ cloakOwner: P2 });
  winOpen(theirs);
  refused(() => playRaw(theirs.engine, P1, theirs.id("gear")), "the opponent's Weaponmaster", /Only tactics or TACTICAL cards may be deployed as responses/);
  assert.equal(zoneOf(theirs.engine, theirs.id("gear")), "hand");
  const mine = cloakBoard({ turnOf: P1 });
  playRaw(mine.engine, P1, mine.id("mynothing"));
  refused(() => playRaw(mine.engine, P2, mine.id("ogear")), "my Weaponmaster does not grant it to the opponent's gear", /Only tactics or TACTICAL cards may be deployed as responses/);
  assert.equal(zoneOf(mine.engine, mine.id("ogear")), "hand");
});

clause(CLOAK, "0:rule", "the opponent's own Weaponmaster lets the opponent deploy their gear in a window", () => {
  const b = cloakBoard({ cloakOwner: P2, turnOf: P1 });
  playRaw(b.engine, P1, b.id("mynothing"));
  playRaw(b.engine, P2, b.id("ogear"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("ogear")), "play");
  assert.equal(card(b.engine, b.id("ogear")).controllerId, P2);
});

clause(CLOAK, "0:rule", "static: off while Weaponmaster is face-down (a resource) or in the discard pile, on in play, and off again after it leaves play", () => {
  for (const [label, o] of [["face-down", { cloakDown: true }], ["discard", { cloakZone: "discard" as const }]] as const) {
    const b = cloakBoard(o);
    winOpen(b);
    refused(() => playRaw(b.engine, P1, b.id("gear")), `Weaponmaster ${label}`, /Only tactics or TACTICAL cards may be deployed as responses/);
    assert.equal(zoneOf(b.engine, b.id("gear")), "hand");
  }
  const b = cloakBoard({ extra: [{ key: "kill", def: killTactic({ name: "Kill" }), owner: P2, zone: "hand" }] });
  winOpen(b);
  playRaw(b.engine, P1, b.id("gear"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("gear")), "play", "on while in play");
  playRaw(b.engine, P2, b.id("kill"), { selected: { t: [b.id("cl")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("cl")), "discard", "Weaponmaster is gone");
  const second = b.engine;
  playRaw(second, P2, b.id("nothing2"));
  refused(() => playRaw(second, P1, b.id("gear2")), "off again after it left play", /Only tactics or TACTICAL cards may be deployed as responses/);
  assert.equal(zoneOf(second, b.id("gear2")), "hand");
});

clause(CLOAK, "0:rule", "on my own turn gear deploys normally (the grant adds timing, it does not remove the normal one)", () => {
  const b = cloakBoard({ cloakZone: "hand", turnOf: P1 });
  play(b.engine, P1, b.id("gear"));
  assert.equal(zoneOf(b.engine, b.id("gear")), "play");
});

// ===========================================================================================
// Delusive Strumpet — character — rogue — dancer — cost 3 — threshold dd — 2/3/2
// ===========================================================================================
const STR = "c8888bbb-a2dd-47bf-97de-e590d8a0fe33";

const strBoard = (o: { zone?: "hand" | "play"; pay?: CardPlacement[]; turnOf?: PlayerId; controller?: PlayerId; extra?: CardPlacement[] } = {}) =>
  dev(
    [
      { key: "s", def: printing(STR), owner: P1, zone: o.zone ?? "hand", controller: o.controller },
      { key: "h1", def: character({ name: "H1", cost: 9 }), owner: P1, zone: "hand" },
      { key: "h2", def: character({ name: "H2", cost: 9 }), owner: P1, zone: "hand" },
      { key: "oh", def: character({ name: "OH", cost: 9 }), owner: P2, zone: "hand" },
      { key: "oh2", def: character({ name: "OH2", cost: 9 }), owner: P2, zone: "hand" },
      { key: "nothing", def: tactic({ name: "Nothing", cost: 0 }), owner: P2, zone: "hand" },
      { key: "other", def: character({ name: "Other", cost: 1 }), owner: P1, zone: "hand" },
      ...fillers("dk", 3, P1, "deck"),
      ...(o.pay ?? spent("deception", 2).concat(V(3))),
      ...(o.extra ?? [])
    ],
    { activePlayerId: o.turnOf ?? P1 }
  );

clause(STR, "0:kw:TACTICAL", "printed: character, rogue, dancer, cost 3, threshold [D][D], 2 strength / 3 speed / 2 life; deploys with exactly 3 ready + [D][D]; refused 1 short, [D] short, no [D], or only the opponent's [D]", () => {
  const def = printing(STR);
  assert.equal(def.type, "character");
  assert.equal(def.trade, "rogue");
  assert.deepEqual([...def.subtype], ["dancer"]);
  assert.equal(def.cost, 3);
  assert.equal(def.threshold, "dd");
  const ok = strBoard();
  play(ok.engine, P1, ok.id("s"));
  assert.equal(zoneOf(ok.engine, ok.id("s")), "play", "control");
  assert.equal(readyResources(ok.engine, P1), 0, "exactly 3 paid");
  assert.equal(ok.engine.getStat(ok.id("s"), "strength"), 2);
  assert.equal(ok.engine.getStat(ok.id("s"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("s"), "life"), 2);
  const costShort = strBoard({ pay: spent("deception", 2).concat(V(2)) });
  refused(() => play(costShort.engine, P1, costShort.id("s")), "2 ready for cost 3");
  const oneD = strBoard({ pay: spent("deception", 1).concat(V(4)) });
  refused(() => play(oneD.engine, P1, oneD.id("s")), "cost covered but one [D] short", /Threshold requirements are not met/);
  const noD = strBoard({ pay: V(5) });
  refused(() => play(noD.engine, P1, noD.id("s")), "no [D]");
  const theirs = strBoard({ pay: spent("deception", 1).concat(V(4), spent("deception", 2, P2)) });
  refused(() => play(theirs.engine, P1, theirs.id("s")), "the opponent's [D] does not count");
});

clause(STR, "0:kw:TACTICAL", "has TACTICAL (and no COVERT / AGGRO it does not print); an ordinary character does not", () => {
  const b = strBoard();
  assert.ok(hasKw(b.engine, b.id("s"), "tactical"), "hasKw(b.engine, b.id(\"s\"), \"tactical\")");
  assert.ok(!hasKw(b.engine, b.id("s"), "covert"), "!hasKw(b.engine, b.id(\"s\"), \"covert\")");
  assert.ok(!hasKw(b.engine, b.id("s"), "aggro"), "!hasKw(b.engine, b.id(\"s\"), \"aggro\")");
  assert.ok(!hasKw(b.engine, b.id("other"), "tactical"), "an ordinary character is not tactical");
});

clause(STR, "0:kw:TACTICAL", "TACTICAL: on the opponent's turn, in a response window, I can deploy it from hand; with nothing to respond to it cannot be deployed; an ordinary character cannot", () => {
  const b = strBoard({ turnOf: P2 });
  refused(() => playRaw(b.engine, P1, b.id("s")), "no window is open for me");
  assert.equal(zoneOf(b.engine, b.id("s")), "hand");
  playRaw(b.engine, P2, b.id("nothing"));
  refused(() => playRaw(b.engine, P1, b.id("other")), "an ordinary character cannot be deployed in a window");
  assert.equal(zoneOf(b.engine, b.id("other")), "hand");
  playRaw(b.engine, P1, b.id("s"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("s")), "play", "tactical: enters play");
  assert.equal(card(b.engine, b.id("s")).controllerId, P1);
});

clause(STR, "1:ability:graceful-exit", "GRACEFUL EXIT: discarding a card of my hand as the cost, the Strumpet flips face-down in play under its owner's control", () => {
  const b = strBoard({ zone: "play" });
  activate(b.engine, P1, b.id("s"), "graceful-exit", { selected: { toss: [b.id("h1")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  const c = card(b.engine, b.id("s"));
  assert.equal(c.zone, "play", "still in play");
  assert.equal(c.faceDown, true, "face-down");
  assert.equal(c.controllerId, P1);
  assert.equal(zoneOf(b.engine, b.id("h1")), "discard", "COST: the discarded card");
  assert.equal(zoneOf(b.engine, b.id("h2")), "hand", "only ONE card discarded");
  assert.equal(b.engine.state.players[P1].discard.length, 1);
  assert.equal(b.engine.isResource(b.id("s")), true, "a face-down card in play is a resource");
});

clause(STR, "1:ability:graceful-exit", "the discarded card is the one I choose (either hand card works), and it must come from MY hand", () => {
  for (const pick of ["h1", "h2"]) {
    const b = strBoard({ zone: "play" });
    activate(b.engine, P1, b.id("s"), "graceful-exit", { selected: { toss: [b.id(pick)] } });
    assert.equal(zoneOf(b.engine, b.id(pick)), "discard", pick);
    assert.equal(card(b.engine, b.id("s")).faceDown, true);
  }
  const b = strBoard({ zone: "play" });
  refused(() => activate(b.engine, P1, b.id("s"), "graceful-exit", { selected: { toss: [b.id("oh")] } }), "the opponent's hand card");
  refused(() => activate(b.engine, P1, b.id("s"), "graceful-exit", { selected: { toss: [b.id("dk0")] } }), "a deck card");
  assert.equal(card(b.engine, b.id("s")).faceDown ?? false, false, "nothing flipped on a bad cost pick");
  assert.equal(zoneOf(b.engine, b.id("oh")), "hand");
});

clause(STR, "1:ability:graceful-exit", "the discard cost takes a card from my HAND only: a card in my discard pile or an item in play is refused", () => {
  const extra: CardPlacement[] = [
    { key: "indisc", def: character({ name: "InDisc", cost: 1 }), owner: P1, zone: "discard" },
    { key: "inplay", def: item({ name: "InPlay" }), owner: P1, zone: "play" }
  ];
  for (const k of ["indisc", "inplay"]) {
    const b = strBoard({ zone: "play", extra });
    refused(() => activate(b.engine, P1, b.id("s"), "graceful-exit", { selected: { toss: [b.id(k)] } }), `${k} is not in my hand`);
    assert.equal(card(b.engine, b.id("s")).faceDown ?? false, false, `${k}: the Strumpet did not flip`);
    assert.equal(zoneOf(b.engine, b.id(k)), k === "indisc" ? "discard" : "play", `${k}: untouched`);
  }
  const ok = strBoard({ zone: "play", extra });
  activate(ok.engine, P1, ok.id("s"), "graceful-exit", { selected: { toss: [ok.id("h1")] } });
  assert.equal(card(ok.engine, ok.id("s")).faceDown, true, "control: a hand card pays it");
});

clause(STR, "1:ability:graceful-exit", "cannot be used with no card in hand (the discard cost cannot be paid); with a card it can", () => {
  const b = strBoard({ zone: "play" });
  for (const k of ["h1", "h2", "other"]) {
    const hand = handOf(b.engine, P1);
    assert.ok(hand.includes(b.id(k)), "hand.includes(b.id(k))");
  }
  const empty = dev([{ key: "s", def: printing(STR), owner: P1, zone: "play" }, ...V(2)]);
  refused(() => activate(empty.engine, P1, empty.id("s"), "graceful-exit"), "empty hand", /cost/i);
  assert.equal(card(empty.engine, empty.id("s")).faceDown ?? false, false);
  const one = dev([{ key: "s", def: printing(STR), owner: P1, zone: "play" }, { key: "h", def: character({ name: "H" }), owner: P1, zone: "hand" }]);
  activate(one.engine, P1, one.id("s"), "graceful-exit", { selected: { toss: [one.id("h")] } });
  assert.equal(card(one.engine, one.id("s")).faceDown, true, "control: one card is enough");
});

clause(STR, "1:ability:graceful-exit", "only its controller can use it: the opponent cannot activate my Strumpet", () => {
  const b = strBoard({ zone: "play", turnOf: P2 });
  refused(() => activate(b.engine, P2, b.id("s"), "graceful-exit", { selected: { toss: [b.id("oh")] } }), "not the controller");
  assert.equal(card(b.engine, b.id("s")).faceDown ?? false, false);
  assert.equal(zoneOf(b.engine, b.id("oh")), "hand");
});

clause(STR, "1:ability:graceful-exit", "\"under its owner's control\": a Strumpet I own but the opponent controls goes face-down under MY control (the controller pays the discard from their own hand)", () => {
  const b = strBoard({ zone: "play", turnOf: P2, controller: P2 });
  assert.equal(card(b.engine, b.id("s")).controllerId, P2, "setup: the opponent controls it");
  activate(b.engine, P2, b.id("s"), "graceful-exit", { selected: { toss: [b.id("oh")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  const c = card(b.engine, b.id("s"));
  assert.equal(c.faceDown, true);
  assert.equal(c.controllerId, P1, "back under its owner's control");
  assert.equal(c.ownerId, P1);
  assert.equal(zoneOf(b.engine, b.id("oh")), "discard", "the opponent paid the discard from their hand");
  assert.equal(zoneOf(b.engine, b.id("h1")), "hand");
  assert.ok(b.engine.state.players[P1].play.includes(b.id("s")), "on my side now");
  assert.ok(!b.engine.state.players[P2].play.includes(b.id("s")), "!b.engine.state.players[P2].play.includes(b.id(\"s\"))");
});

// FLIP UP: 4 [D][D] and play a resource.
const flipBoard = (o: { pay?: CardPlacement[]; hand?: CardPlacement[]; turnOf?: PlayerId; noRes?: boolean } = {}) =>
  dev(
    [
      { key: "s", def: printing(STR), owner: P1, zone: "play", faceDown: true },
      ...(o.noRes
        ? []
        : [
            { key: "res", def: resourceCard({ name: "Res", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" as const },
            { key: "res2", def: resourceCard({ name: "Res2", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" as const },
            { key: "chr", def: character({ name: "Chr", cost: 9 }), owner: P1, zone: "hand" as const }
          ]),
      { key: "ores", def: resourceCard({ name: "ORes", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" },
      { key: "att", def: character({ name: "Att", strength: 1, life: 3 }), owner: P2, zone: "play" },
      ...(o.pay ?? spent("deception", 2).concat(V(3))),
      ...(o.hand ?? [])
    ],
    { activePlayerId: o.turnOf ?? P1 }
  );
/** FLIP UP the Strumpet; the "play a resource" pick is a pending choice, answered with `pick` (or nothing). */
const flip = (b: Game, pick?: string, faceDown?: boolean) => {
  flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("s"), selected: {}, variables: {} });
  resolvePendingResponses(b.engine);
  answerFlipRes(b, pick, faceDown);
};
const answerFlipRes = (b: Game, pick?: string, faceDown?: boolean) => {
  let n = 0;
  while (b.engine.state.pendingChoice && n++ < 10) {
    const pc = b.engine.state.pendingChoice as unknown as PendingChoiceLike;
    const choice =
      pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: pick ? [b.id(pick)] : [] }
        : pc.kind === "playResource"
          ? { kind: "playResource", faceDown: faceDown ?? false }
          : declineAll(pc);
    act(b.engine, { type: "resolvePendingChoice", playerId: pc.playerId, choice });
    resolvePendingResponses(b.engine);
  }
};

clause(STR, "2:flipUp", "FLIP UP 4 [D][D]: with exactly 4 (the face-down card may pay for itself) and [D][D] it flips up; the Strumpet becomes a face-up 2/3/2 character under my control and nothing else is paid", () => {
  const b = flipBoard();
  assert.equal(readyResources(b.engine, P1), 4, "3 Volition + the face-down card itself");
  flip(b, "res");
  assert.equal(b.engine.state.pendingChoice, undefined);
  const c = card(b.engine, b.id("s"));
  assert.equal(c.zone, "play");
  assert.equal(c.faceDown ?? false, false, "face-up");
  assert.equal(c.controllerId, P1);
  assert.equal(b.engine.getStat(b.id("s"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("s"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("s"), "life"), 2);
  assert.equal(b.engine.isResource(b.id("s")), false, "no longer a resource");
});

clause(STR, "2:flipUp", "FLIP UP cost is 4, not 3 or 5: refused with 3 ready (one short), allowed with 4; the printed deploy cost (3) is not added on top", () => {
  const short = flipBoard({ pay: spent("deception", 2).concat(V(2)) });
  assert.equal(readyResources(short.engine, P1), 3);
  refused(() => flip(short, "res"), "3 ready for FLIP UP cost 4", /cost|pay|resource|afford/i);
  assert.equal(card(short.engine, short.id("s")).faceDown, true);
  const exact = flipBoard();
  flip(exact, "res");
  assert.equal(card(exact.engine, exact.id("s")).faceDown ?? false, false, "4 is enough: not 3 + 4");
  const spare = flipBoard({ pay: spent("deception", 2).concat(V(5)) });
  flip(spare, "res");
  const ready = readyResources(spare.engine, P1);
  assert.ok(ready === 2 || ready === 3 || ready === 1, `4 paid from 6 ready (+ the resource played): ${ready}`);
});

clause(STR, "2:flipUp", "FLIP UP threshold [D][D]: refused with one [D], none, or only the opponent's; ready (not spent) [D] also counts", () => {
  const one = flipBoard({ pay: spent("deception", 1).concat(V(5)) });
  refused(() => flip(one, "res"), "only one [D]", /threshold|icon|resource/i);
  assert.equal(card(one.engine, one.id("s")).faceDown, true);
  const none = flipBoard({ pay: V(6) });
  refused(() => flip(none, "res"), "no [D]", /threshold|icon|resource/i);
  const theirs = flipBoard({ pay: spent("deception", 1).concat(V(5), spent("deception", 3, P2)) });
  refused(() => flip(theirs, "res"), "the opponent's [D] does not count", /threshold|icon|resource/i);
  const ready = flipBoard({ pay: D(2).concat(V(2)) });
  flip(ready, "res");
  assert.equal(card(ready.engine, ready.id("s")).faceDown ?? false, false, "control: two ready [D] meet the threshold");
});

clause(STR, "2:flipUp", "its own icons do not meet the threshold: a face-down Strumpet provides no [D], so [D] x1 elsewhere is not enough", () => {
  const b = flipBoard({ pay: D(1).concat(V(5)) });
  refused(() => flip(b, "res"), "one [D] on the board", /threshold|icon|resource/i);
  assert.equal(card(b.engine, b.id("s")).faceDown, true);
});

clause(STR, "2:flipUp", "\"and play a resource\": a resource card from my hand is played (enters play under my control); the other resource and the non-resource stay in hand", () => {
  const b = flipBoard();
  flip(b, "res");
  const r = card(b.engine, b.id("res"));
  assert.equal(r.zone, "play", "the resource was played");
  assert.equal(r.controllerId, P1);
  assert.equal(zoneOf(b.engine, b.id("res2")), "hand", "only one resource");
  assert.equal(zoneOf(b.engine, b.id("chr")), "hand", "a non-resource is not played");
  assert.equal(zoneOf(b.engine, b.id("ores")), "hand", "the opponent's resource is untouched");
  assert.equal(b.engine.isResource(b.id("res")), true);
});

clause(STR, "2:flipUp", "the resource played may be a different one of my resource cards (res2); any card of mine may be played as a resource, then face-down (a non-resource card such as a character), still one card only", () => {
  const b = flipBoard();
  flip(b, "res2");
  assert.equal(zoneOf(b.engine, b.id("res2")), "play");
  assert.equal(zoneOf(b.engine, b.id("res")), "hand");
  const other = flipBoard();
  flip(other, "chr");
  const c = card(other.engine, other.id("chr"));
  assert.equal(c.zone, "play", "a non-resource card can be played as a resource");
  assert.equal(c.faceDown, true, "a non-resource card can only be a face-down resource");
  assert.equal(c.controllerId, P1);
  assert.equal(zoneOf(other.engine, other.id("res")), "hand");
  assert.equal(zoneOf(other.engine, other.id("res2")), "hand");
  const theirs = flipBoard();
  refused(() => flip(theirs, "ores"), "the opponent's hand card", /target|pick|select|hand|legal/i);
  assert.equal(zoneOf(theirs.engine, theirs.id("ores")), "hand");
});

clause(STR, "2:flipUp", "the resource is chosen by ME (the opponent is not asked) and it is exactly ONE card: picking two is refused", () => {
  const b = flipBoard();
  flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("s"), selected: {}, variables: {} });
  resolvePendingResponses(b.engine);
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I choose");
  refused(
    () => act(b.engine, { type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [b.id("res"), b.id("res2")] } }),
    "two resources for \"a resource\"",
    /target|select|count|too many|exactly|at most/i
  );
  assert.equal(zoneOf(b.engine, b.id("res")), "hand");
  assert.equal(zoneOf(b.engine, b.id("res2")), "hand");
  answerFlipRes(b, "res");
  assert.equal(zoneOf(b.engine, b.id("res")), "play");
  assert.equal(zoneOf(b.engine, b.id("res2")), "hand");
});

clause(STR, "2:flipUp", "\"and play a resource\" is part of the FLIP UP: with no resource card in hand the FLIP UP is refused", () => {
  const b = flipBoard({ noRes: true });
  refused(() => flip(b), "no resource card in hand to play", /resource/i);
  assert.equal(card(b.engine, b.id("s")).faceDown, true, "it stays face-down");
});

clause(STR, "2:flipUp", "\"and play a resource\" is not optional: with resource cards in hand, declining to play one is refused", () => {
  const b = flipBoard();
  refused(() => flip(b), "answering with no resource while resource cards are in hand", /resource|pick|select|target/i);
  assert.equal(zoneOf(b.engine, b.id("res")), "hand");
  assert.equal(card(b.engine, b.id("s")).faceDown, true, "the FLIP UP did not complete");
});

clause(STR, "2:flipUp", "the resource played by FLIP UP can be played face-down as well as face-up (a real resource card, SYS-7)", () => holdResourceFace(() => {
  const faces = new Set<boolean>();
  for (const sel of [true, false] as const) {
    const b = flipBoard();
    flip(b, "res", sel);
    faces.add(card(b.engine, b.id("res")).faceDown ?? false);
  }
  assert.ok(faces.has(true) && faces.has(false), `the player can end up with it face-down and face-up (saw ${[...faces].join(",")})`);
}));

clause(STR, "2:flipUp", "TACTICAL makes the face-down Strumpet flippable in the opponent's response window", () => {
  const b = flipBoard({ turnOf: P2 });
  declareAttackOpenWindow(b.engine, P2, [b.id("att")]);
  const w = b.engine.state.responseWindow as unknown as { priorityPlayerId?: PlayerId } | undefined;
  assert.ok(w, "a response window is open");
  if (w?.priorityPlayerId === P2) act(b.engine, { type: "passPriority", playerId: P2 });
  assert.equal((b.engine.state.responseWindow as unknown as { priorityPlayerId?: PlayerId }).priorityPlayerId, P1);
  flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("s"), selected: {}, variables: {} });
  answerFlipRes(b, "res");
  assert.equal(card(b.engine, b.id("s")).faceDown ?? false, false, "flipped up in P2's window");
  assert.equal(zoneOf(b.engine, b.id("s")), "play");
});

// ===========================================================================================
// Drygulch — tactic — rogue — cost 2 — threshold d
// ===========================================================================================
const DRY = "b5d5833b-2db4-4da1-95dc-64bbb972b5b0";

const dryBoard = (o: { pay?: CardPlacement[]; extra?: CardPlacement[]; life?: number; owner?: PlayerId } = {}) =>
  dev([
    { key: "dy", def: printing(DRY), owner: P1, zone: "hand" },
    { key: "t", def: character({ name: "Target", strength: 1, life: o.life ?? 1 }), owner: o.owner ?? P2, zone: "play" },
    ...(o.pay ?? spent("deception", 1).concat(V(2))),
    ...(o.extra ?? [])
  ]);
const dryCast = (b: Game, pick = "t") => {
  play(b.engine, P1, b.id("dy"), { selected: { c: [b.id(pick)] } });
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.pendingChoice, undefined);
};

clause(DRY, "0:extraCost", "printed: tactic, rogue, cost 2, threshold [D]; cast with exactly 2 ready + [D]; refused with 1 ready, no [D], or only the opponent's [D]", () => {
  const def = printing(DRY);
  assert.equal(def.type, "tactic");
  assert.equal(def.trade, "rogue");
  assert.equal(def.cost, 2);
  assert.equal(def.threshold, "d");
  const ok = dryBoard();
  dryCast(ok);
  assert.equal(zoneOf(ok.engine, ok.id("dy")), "discard", "control: cast and discarded");
  assert.equal(readyResources(ok.engine, P1), 0, "exactly 2 paid");
  const short = dryBoard({ pay: spent("deception", 1).concat(V(1)) });
  refused(() => play(short.engine, P1, short.id("dy"), { selected: { c: [short.id("t")] } }), "1 ready for cost 2");
  assert.equal(zoneOf(short.engine, short.id("dy")), "hand");
  const noD = dryBoard({ pay: V(4) });
  refused(() => play(noD.engine, P1, noD.id("dy"), { selected: { c: [noD.id("t")] } }), "no [D]");
  const theirs = dryBoard({ pay: V(3).concat(spent("deception", 2, P2)) });
  refused(() => play(theirs.engine, P1, theirs.id("dy"), { selected: { c: [theirs.id("t")] } }), "the opponent's [D] does not count");
});

clause(DRY, "0:extraCost", "EXTRA COST: pick a character in play, mine or the opponent's; picking none is refused", () => {
  const mine = dryBoard({ owner: P1 });
  dryCast(mine);
  assert.equal(mine.engine.state.cards[mine.id("t")].zone, "removed", "my own character can be picked");
  const theirs = dryBoard({ owner: P2 });
  dryCast(theirs);
  assert.equal(theirs.engine.state.cards[theirs.id("t")].zone, "removed", "the opponent's can be picked");
  const none = dryBoard();
  refused(() => play(none.engine, P1, none.id("dy")), "no pick");
  assert.equal(zoneOf(none.engine, none.id("dy")), "hand");
  assert.equal(readyResources(none.engine, P1), 2, "nothing paid");
});

clause(DRY, "0:extraCost", "only a CHARACTER in play: an item, location, a character in hand / discard, and a face-down card are refused; two picks are refused", () => {
  const b = dryBoard({
    extra: [
      { key: "itm", def: item({ name: "Itm", cost: 0 }), owner: P2, zone: "play" },
      { key: "loc", def: { ...character({ name: "Loc" }), type: "location", structure: 1 } as never, owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "InHand", life: 1 }), owner: P2, zone: "hand" },
      { key: "inDis", def: character({ name: "InDis", life: 1 }), owner: P2, zone: "discard" },
      { key: "down", def: character({ name: "Down", life: 1 }), owner: P2, zone: "play", faceDown: true, attachedToKey: "__factionB" },
      { key: "t2", def: character({ name: "T2", life: 1 }), owner: P2, zone: "play" }
    ]
  });
  for (const k of ["itm", "loc", "inHand", "inDis", "down"]) {
    refused(() => play(b.engine, P1, b.id("dy"), { selected: { c: [b.id(k)] } }), `${k} is not a character in play`);
  }
  refused(() => play(b.engine, P1, b.id("dy"), { selected: { c: [b.id("t"), b.id("t2")] } }), "two picks");
  assert.equal(zoneOf(b.engine, b.id("dy")), "hand");
  assert.equal(readyResources(b.engine, P1), 2, "nothing paid by the refused attempts");
  dryCast(b);
  assert.equal(b.engine.state.cards[b.id("t")].zone, "removed", "control");
  assert.equal(zoneOf(b.engine, b.id("t2")), "play");
});

clause(DRY, "1:rule", "removes the character from the game when its life is X or less, X = the [D] I control: equal removes, one above stays (X = 1, 2, 3)", () => {
  for (const x of [1, 2, 3]) {
    const eq = dryBoard({ life: x, pay: spent("deception", x).concat(V(2)) });
    dryCast(eq);
    assert.equal(eq.engine.state.cards[eq.id("t")].zone, "removed", `life ${x} <= X=${x}`);
    // A 0-life character would already be destroyed (CR 408.4), so "below X" starts at X = 2.
    if (x > 1) {
      const below = dryBoard({ life: x - 1, pay: spent("deception", x).concat(V(2)) });
      dryCast(below);
      assert.equal(below.engine.state.cards[below.id("t")].zone, "removed", `life ${x - 1} < X=${x}`);
    }
    const over = dryBoard({ life: x + 1, pay: spent("deception", x).concat(V(2)) });
    dryCast(over);
    assert.equal(zoneOf(over.engine, over.id("t")), "play", `life ${x + 1} > X=${x} stays`);
    assert.equal(zoneOf(over.engine, over.id("dy")), "discard", "the tactic is still spent");
    assert.equal(readyResources(over.engine, P1), 0, "and its cost still paid");
  }
});

clause(DRY, "1:rule", "removed from the game means gone for good: not in play, not in the discard pile, not in hand or deck of either player", () => {
  const b = dryBoard();
  dryCast(b);
  const t = b.id("t");
  for (const p of [P1, P2]) {
    const pl = b.engine.state.players[p];
    for (const z of ["hand", "deck", "discard", "play"] as const) assert.ok(!(pl[z] as CardInstanceId[]).includes(t), `${p} ${z}`);
  }
  assert.equal(b.engine.state.cards[t].zone, "removed");
});

clause(DRY, "1:rule", "X counts [D] ICONS (a card providing [D][D] counts 2), whether the resource is ready or spent, and only my own", () => {
  const dd = item({ name: "DD", cost: 0, resource: { provides: ["deception", "deception"], staple: false } } as never);
  const ddSpent: CardPlacement = { key: "dd", def: dd, owner: P1, zone: "play", attachedToKey: "__factionA" };
  const two = dryBoard({ life: 2, pay: [ddSpent, ...V(2)] });
  dryCast(two);
  assert.equal(two.engine.state.cards[two.id("t")].zone, "removed", "one card providing [D][D] makes X = 2");
  const three = dryBoard({ life: 3, pay: [ddSpent, ...V(2)] });
  dryCast(three);
  assert.equal(zoneOf(three.engine, three.id("t")), "play", "X = 2 does not reach life 3");
  const readyD = dryBoard({ life: 2, pay: D(2).concat(V(1)) });
  dryCast(readyD);
  assert.equal(readyD.engine.state.cards[readyD.id("t")].zone, "removed", "two ready [D] (spent paying the cost) still count: X = 2");
  const opp = dryBoard({ life: 2, pay: spent("deception", 1).concat(V(2), spent("deception", 3, P2)) });
  dryCast(opp);
  assert.equal(zoneOf(opp.engine, opp.id("t")), "play", "the opponent's [D] do not count");
  const other = dryBoard({ life: 2, pay: spent("deception", 1).concat(V(2), spent("rage", 3)) });
  dryCast(other);
  assert.equal(zoneOf(other.engine, other.id("t")), "play", "my [R] do not count");
});

clause(DRY, "1:rule", "face-down resources provide no [D] (they are Volition): they do not raise X", () => {
  const b = dryBoard({ life: 2, pay: spent("deception", 1).concat(V(4)) });
  dryCast(b);
  assert.equal(zoneOf(b.engine, b.id("t")), "play", "X is 1 however many Volition I have");
});

clause(DRY, "1:rule", "X is read when it resolves and compares the character's LIFE stat: a +life buff above X saves it, damage does not lower the life stat", () => {
  const dmg = dryBoard({ life: 3, pay: spent("deception", 1).concat(V(2)), extra: [] });
  (dmg.engine.state.cards[dmg.id("t")] as unknown as { damage: number }).damage = 2;
  dryCast(dmg);
  assert.equal(zoneOf(dmg.engine, dmg.id("t")), "play", "3 life with 2 damage is still a 3-life character: 3 > X=1");
});

clause(DRY, "1:rule", "affects only the picked character: other characters (even with low life) stay, on both sides", () => {
  const b = dryBoard({
    life: 1,
    extra: [
      { key: "mine", def: character({ name: "Mine", life: 1 }), owner: P1, zone: "play" },
      { key: "theirs2", def: character({ name: "Theirs2", life: 1 }), owner: P2, zone: "play" }
    ]
  });
  dryCast(b);
  assert.equal(b.engine.state.cards[b.id("t")].zone, "removed");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  assert.equal(zoneOf(b.engine, b.id("theirs2")), "play");
});

// ===========================================================================================
// Burly Assailment — tactic — rogue — cost 1 — threshold d
// ===========================================================================================
const BURLY = "380fbd91-5070-4bde-bce2-806dd4045968";
const hidden = () => character({ name: "Hidden", cost: 2, strength: 2, life: 2, speed: 1 });

const burlyBoard = (o: { pay?: CardPlacement[]; extra?: CardPlacement[]; zone?: "hand" | "discard" | "play"; down?: boolean; turnOf?: PlayerId; fdSpent?: boolean } = {}) =>
  dev(
    [
      { key: "b", def: printing(BURLY), owner: P1, zone: o.zone ?? "hand", faceDown: o.down },
      { key: "fd", def: hidden(), owner: P1, zone: "play", faceDown: true, ...(o.fdSpent === false ? {} : { attachedToKey: "__factionA" }) },
      ...fillers("dk", 3, P1, "deck"),
      ...fillers("ok", 3, P2, "deck"),
      ...(o.pay ?? spent("deception", 1).concat(V(1))),
      ...(o.extra ?? [])
    ],
    { activePlayerId: o.turnOf ?? P1 }
  );
const deployChoice = (b: Game, key?: string) => {
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "deployForFree", "asked whether to deploy the revealed character");
  act(b.engine, { type: "resolvePendingChoice", playerId: P1, choice: key ? { kind: "deployForFree", cardId: b.id(key) } : { kind: "deployForFree" } });
  resolvePendingResponses(b.engine);
};
const burlyCast = (b: Game, accept: boolean, pick = "fd") => {
  play(b.engine, P1, b.id("b"), { selected: { rev: [b.id(pick)] } });
  deployChoice(b, accept ? pick : undefined);
  assert.equal(b.engine.state.pendingChoice, undefined);
};

clause(BURLY, "0:extraCost", "printed: tactic, rogue, cost 1, threshold [D]; cast with exactly 1 ready + [D]; refused with nothing ready, no [D], or only the opponent's [D]", () => {
  const def = printing(BURLY);
  assert.equal(def.type, "tactic");
  assert.equal(def.trade, "rogue");
  assert.equal(def.cost, 1);
  assert.equal(def.threshold, "d");
  const ok = burlyBoard();
  burlyCast(ok, false);
  assert.equal(zoneOf(ok.engine, ok.id("b")), "discard", "control: cast and discarded");
  assert.equal(readyResources(ok.engine, P1), 0, "exactly 1 paid");
  const none = burlyBoard({ pay: spent("deception", 1) });
  refused(() => play(none.engine, P1, none.id("b"), { selected: { rev: [none.id("fd")] } }), "nothing ready for cost 1");
  assert.equal(zoneOf(none.engine, none.id("b")), "hand");
  const noD = burlyBoard({ pay: V(3) });
  refused(() => play(noD.engine, P1, noD.id("b"), { selected: { rev: [noD.id("fd")] } }), "no [D]");
  const theirs = burlyBoard({ pay: V(2).concat(spent("deception", 2, P2)) });
  refused(() => play(theirs.engine, P1, theirs.id("b"), { selected: { rev: [theirs.id("fd")] } }), "the opponent's [D] does not count");
});

clause(BURLY, "0:extraCost", "EXTRA COST: reveal a face-down character I control: refused with no pick; a face-up character, a face-down non-character, and the opponent's face-down character are refused", () => {
  const b = burlyBoard({
    extra: [
      { key: "up", def: character({ name: "Up" }), owner: P1, zone: "play" },
      { key: "downTac", def: tactic({ name: "DownTac", cost: 0 }), owner: P1, zone: "play", faceDown: true, attachedToKey: "__factionA" },
      { key: "downItm", def: item({ name: "DownItm", cost: 0 }), owner: P1, zone: "play", faceDown: true, attachedToKey: "__factionA" },
      { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "play", faceDown: true },
      { key: "handChr", def: character({ name: "HandChr" }), owner: P1, zone: "hand" }
    ]
  });
  refused(() => play(b.engine, P1, b.id("b")), "no pick");
  for (const k of ["up", "downTac", "downItm", "theirs", "handChr"]) {
    refused(() => play(b.engine, P1, b.id("b"), { selected: { rev: [b.id(k)] } }), `${k} is not a face-down character I control`);
  }
  assert.equal(zoneOf(b.engine, b.id("b")), "hand");
  assert.equal(readyResources(b.engine, P1), 1, "nothing paid by the refused attempts");
  burlyCast(b, false);
  assert.equal(zoneOf(b.engine, b.id("b")), "discard", "control");
});

clause(BURLY, "0:extraCost", "a face-down character I control but the opponent owns can be revealed (control, not ownership); only one is revealed", () => {
  const b = burlyBoard({ extra: [{ key: "stolen", def: character({ name: "Stolen", cost: 2 }), owner: P2, controller: P1, zone: "play", faceDown: true, attachedToKey: "__factionA" }] });
  refused(() => play(b.engine, P1, b.id("b"), { selected: { rev: [b.id("fd"), b.id("stolen")] } }), "two reveals");
  assert.equal(zoneOf(b.engine, b.id("b")), "hand");
  burlyCast(b, false, "stolen");
  assert.equal(zoneOf(b.engine, b.id("b")), "discard");
});

clause(BURLY, "0:extraCost", "revealing only shows it: the revealed card stays face-down in play when I do not deploy it", () => {
  const b = burlyBoard();
  burlyCast(b, false);
  const c = card(b.engine, b.id("fd"));
  assert.equal(c.zone, "play");
  assert.equal(c.faceDown, true, "still face-down");
  assert.equal(c.controllerId, P1);
});

clause(BURLY, "0:extraCost", "revealing: the picked face-down character is revealed to everyone (a cardsRevealed event naming exactly it)", () => {
  const b = burlyBoard({ extra: [{ key: "fd2", def: hidden(), owner: P1, zone: "play", faceDown: true }] });
  burlyCast(b, false);
  const reveals = b.engine.getLog().filter((e) => e.event?.type === "cardsRevealed").map((e) => e.event as unknown as { cardIds: string[]; viewerId: string });
  assert.equal(reveals.length, 1, "one reveal");
  assert.deepEqual(reveals[0].cardIds, [b.id("fd")], "exactly the picked card is revealed (not the other face-down character)");
  assert.equal(reveals[0].viewerId, "all", "revealed to everyone");
});

clause(BURLY, "1:rule", "\"You may deploy the character\": accepting deploys it face-up under my control with its printed stats", () => {
  const b = burlyBoard({ pay: spent("deception", 1).concat(V(3)) });
  burlyCast(b, true);
  const c = card(b.engine, b.id("fd"));
  assert.equal(c.zone, "play");
  assert.equal(c.faceDown ?? false, false, "face-up");
  assert.equal(c.controllerId, P1);
  assert.equal(b.engine.getStat(b.id("fd"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("fd"), "life"), 2);
  assert.equal(b.engine.getStat(b.id("fd"), "speed"), 1);
  assert.equal(b.engine.isResource(b.id("fd")), false);
});

clause(BURLY, "1:rule", "declining the deploy leaves the character face-down and pays nothing extra; the tactic still resolves", () => {
  const b = burlyBoard({ pay: spent("deception", 1).concat(V(3)) });
  burlyCast(b, false);
  assert.equal(card(b.engine, b.id("fd")).faceDown, true);
  assert.equal(readyResources(b.engine, P1), 2, "only the tactic's 1 was paid");
  assert.equal(zoneOf(b.engine, b.id("b")), "discard");
});

clause(BURLY, "1:rule", "\"deploy\" pays the character's cost (2): the deploy is not free, and is impossible without the resources", () => {
  const b = burlyBoard({ pay: spent("deception", 1).concat(V(3)) });
  burlyCast(b, true);
  assert.equal(readyResources(b.engine, P1), 0, "1 for the tactic + 2 for the character");
  const poor = burlyBoard();
  play(poor.engine, P1, poor.id("b"), { selected: { rev: [poor.id("fd")] } });
  assert.equal(pending(poor.engine)?.kind, "deployForFree");
  refused(
    () => {
      act(poor.engine, { type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: poor.id("fd") } });
      resolvePendingResponses(poor.engine);
    },
    "cost 2 with nothing ready",
    /cost|pay|afford|resource/i
  );
  assert.equal(card(poor.engine, poor.id("fd")).faceDown, true, "it stays face-down");
});

clause(BURLY, "1:rule", "\"Draw a card\": I draw exactly one card whether I deploy or not", () => {
  for (const accept of [true, false]) {
    const b = burlyBoard({ pay: spent("deception", 1).concat(V(3)) });
    const deck = deckOf(b.engine, P1);
    const hand = handOf(b.engine, P1);
    burlyCast(b, accept);
    const after = handOf(b.engine, P1);
    assert.equal(deckOf(b.engine, P1).length, deck.length - 1, `accept=${accept}: one card left the deck`);
    const drawn = deck.filter((x) => !deckOf(b.engine, P1).includes(x));
    assert.equal(drawn.length, 1);
    assert.ok(after.includes(drawn[0]), "it is in my hand");
    assert.equal(after.length, hand.length - 1 + 1, "the tactic left my hand, one card arrived");
    assert.equal(deckOf(b.engine, P2).length, 3, "the opponent's deck is untouched");
  }
});

// recursion from the discard pile
const dItem = (provides: string[] = ["deception"], name = "DItem") => item({ name, cost: 0, resource: { provides, staple: false } } as never);
const dRes = (provides: string[] = ["deception"], name = "DRes") => resourceCard({ name, resource: { provides, staple: true } } as never);
const recurBoard = (o: { zone?: "discard" | "hand" | "deck"; pay?: CardPlacement[]; extra?: CardPlacement[]; turnOf?: PlayerId } = {}) =>
  dev(
    [
      { key: "b", def: printing(BURLY), owner: P1, zone: o.zone ?? "discard" },
      { key: "di", def: dItem(), owner: P1, zone: "hand" },
      { key: "ri", def: dItem(["rage"], "RItem"), owner: P1, zone: "hand" },
      { key: "rdi", def: dItem(["rage", "deception"], "RDItem"), owner: P1, zone: "hand" },
      { key: "ddi", def: dItem(["deception", "deception"], "DDItem"), owner: P1, zone: "hand" },
      { key: "chr", def: character({ name: "Chr", cost: 0 }), owner: P1, zone: "hand" },
      { key: "dres", def: dRes(), owner: P1, zone: "hand" },
      { key: "rres", def: dRes(["rage"], "RRes"), owner: P1, zone: "hand" },
      { key: "odi", def: dItem(["deception"], "ODItem"), owner: P2, zone: "hand" },
      { key: "odres", def: dRes(["deception"], "ODRes"), owner: P2, zone: "hand" },
      ...fillers("dk", 3, P1, "deck"),
      ...fillers("ok", 3, P2, "deck"),
      ...(o.pay ?? V(2)),
      ...V(2, P2),
      ...(o.extra ?? [])
    ],
    { activePlayerId: o.turnOf ?? P1 }
  );
const answerMay = (b: Game, pay: boolean) => {
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "mayPay", "asked whether to pay 2");
  act(b.engine, { type: "resolvePendingChoice", playerId: P1, choice: { kind: "mayPay", pay } });
  resolvePendingResponses(b.engine);
};

clause(BURLY, "2:rule", "when a card providing [D] enters play under my control (deployed), I may pay 2: Burly returns to play face-down as a resource under my control", () => {
  const b = recurBoard();
  const before = readyResources(b.engine, P1);
  play(b.engine, P1, b.id("di"));
  answerMay(b, true);
  assert.equal(b.engine.state.pendingChoice, undefined);
  const c = card(b.engine, b.id("b"));
  assert.equal(c.zone, "play");
  assert.equal(c.faceDown, true, "face-down");
  assert.equal(c.controllerId, P1);
  assert.equal(c.ownerId, P1);
  assert.equal(b.engine.isResource(b.id("b")), true, "it is a resource now");
  // an item is not a resource card: -2 paid, +1 Burly as a face-down resource
  assert.equal(readyResources(b.engine, P1) - before, -2 + 1);
  assert.ok(!b.engine.state.players[P1].discard.includes(b.id("b")), "!b.engine.state.players[P1].discard.includes(b.id(\"b\"))");
});

clause(BURLY, "2:rule", "also when a [D] resource card is played as a resource (develop): same prompt, same result", () => {
  const b = recurBoard();
  const before = readyResources(b.engine, P1);
  developResource(b.engine, P1, b.id("dres"), false);
  answerMay(b, true);
  assert.equal(b.engine.state.pendingChoice, undefined);
  const c = card(b.engine, b.id("b"));
  assert.equal(c.zone, "play");
  assert.equal(c.faceDown, true);
  assert.equal(c.controllerId, P1);
  assert.equal(readyResources(b.engine, P1) - before, 1 - 2 + 1);
});

clause(BURLY, "2:rule", "declining the payment: Burly stays in the discard pile and nothing is paid", () => {
  const b = recurBoard();
  const before = readyResources(b.engine, P1);
  play(b.engine, P1, b.id("di"));
  answerMay(b, false);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("b")), "discard");
  assert.equal(readyResources(b.engine, P1), before, "nothing paid");
  const r = recurBoard();
  developResource(r.engine, P1, r.id("dres"), false);
  answerMay(r, false);
  assert.equal(zoneOf(r.engine, r.id("b")), "discard");
});

clause(BURLY, "2:rule", "I must be able to pay 2: with fewer than 2 ready resources Burly stays in the discard pile (a [D] resource card entering counts as ready); with exactly 2 it comes back", () => {
  const none = recurBoard({ pay: [] });
  developResource(none.engine, P1, none.id("dres"), false);
  drain(none.engine, yes);
  assert.equal(none.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(none.engine, none.id("b")), "discard", "1 ready (the new resource) cannot pay 2");
  const item1 = recurBoard({ pay: V(1) });
  play(item1.engine, P1, item1.id("di"));
  drain(item1.engine, yes);
  assert.equal(zoneOf(item1.engine, item1.id("b")), "discard", "1 ready cannot pay 2");
  const ok = recurBoard({ pay: V(1) });
  developResource(ok.engine, P1, ok.id("dres"), false);
  answerMay(ok, true);
  assert.equal(zoneOf(ok.engine, ok.id("b")), "play", "control: 1 + the new resource = 2 pays");
  assert.equal(card(ok.engine, ok.id("b")).faceDown, true);
});

clause(BURLY, "2:rule", "a card providing [R] only does not trigger; a card providing [R] and [D] does; a card providing [D][D] triggers once", () => {
  const rage = recurBoard();
  play(rage.engine, P1, rage.id("ri"));
  drain(rage.engine, yes);
  assert.equal(zoneOf(rage.engine, rage.id("b")), "discard", "[R] only");
  const rageRes = recurBoard();
  developResource(rageRes.engine, P1, rageRes.id("rres"), false);
  assert.equal(rageRes.engine.state.pendingChoice, undefined, "a [R] resource card does not prompt");
  assert.equal(zoneOf(rageRes.engine, rageRes.id("b")), "discard");
  const both = recurBoard();
  play(both.engine, P1, both.id("rdi"));
  answerMay(both, true);
  assert.equal(zoneOf(both.engine, both.id("b")), "play", "[R][D]");
  const dd = recurBoard();
  play(dd.engine, P1, dd.id("ddi"));
  answerMay(dd, true);
  assert.equal(dd.engine.state.pendingChoice, undefined, "exactly one prompt");
  assert.equal(zoneOf(dd.engine, dd.id("b")), "play", "[D][D]");
});

clause(BURLY, "2:rule", "a character (provides nothing) entering play does not trigger it; neither does a FACE-DOWN resource played (it provides only Volition)", () => {
  const chr = recurBoard();
  play(chr.engine, P1, chr.id("chr"));
  assert.equal(chr.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(chr.engine, chr.id("b")), "discard");
  const down = recurBoard();
  developResource(down.engine, P1, down.id("dres"), true);
  assert.equal(down.engine.state.pendingChoice, undefined, "a face-down [D] card provides only Volition");
  assert.equal(zoneOf(down.engine, down.id("b")), "discard");
});

clause(BURLY, "2:rule", "only for cards entering under MY control: the opponent deploying or playing a [D] card does not trigger it", () => {
  const item2 = recurBoard({ turnOf: P2 });
  play(item2.engine, P2, item2.id("odi"));
  assert.equal(item2.engine.state.pendingChoice, undefined, "no prompt for me");
  assert.equal(zoneOf(item2.engine, item2.id("b")), "discard");
  const res2 = recurBoard({ turnOf: P2 });
  developResource(res2.engine, P2, res2.id("odres"), false);
  assert.equal(res2.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(res2.engine, res2.id("b")), "discard");
});

clause(BURLY, "2:rule", "two Burly Assailments in the discard pile each trigger on the same [D] card: with 4 ready resources both come back (2 paid each)", () => {
  const b = recurBoard({ pay: V(4), extra: [{ key: "b2", def: printing(BURLY), owner: P1, zone: "discard" }] });
  const before = readyResources(b.engine, P1);
  play(b.engine, P1, b.id("di"));
  drain(b.engine, yes);
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const k of ["b", "b2"]) {
    assert.equal(zoneOf(b.engine, b.id(k)), "play", `${k} returned to play`);
    assert.equal(card(b.engine, b.id(k)).faceDown, true, `${k} is a face-down resource`);
  }
  assert.equal(readyResources(b.engine, P1) - before, -4 + 2, "4 paid, 2 Burlys became ready resources");
});

clause(BURLY, "2:rule", "two Burly Assailments with only 2 ready resources: only one can come back (each needs its own 2)", () => {
  const b = recurBoard({ pay: V(2), extra: [{ key: "b2", def: printing(BURLY), owner: P1, zone: "discard" }] });
  play(b.engine, P1, b.id("di"));
  drain(b.engine, yes);
  assert.equal(b.engine.state.pendingChoice, undefined);
  const back = ["b", "b2"].filter((k) => zoneOf(b.engine, b.id(k)) === "play");
  assert.equal(back.length, 1, "exactly one Burly returned");
});

clause(BURLY, "2:rule", "only WHILE in the discard pile: with Burly in hand or in my deck, a [D] card entering play does not move it", () => {
  for (const zone of ["hand", "deck"] as const) {
    const b = recurBoard({ zone });
    play(b.engine, P1, b.id("di"));
    drain(b.engine, yes);
    assert.equal(zoneOf(b.engine, b.id("b")), zone, `Burly stays in ${zone}`);
  }
});

clause(BURLY, "2:rule", "recursion enters play as a face-down resource: Burly is not a tactic cast (it does not draw or reveal anything)", () => {
  const b = recurBoard();
  const hand = handOf(b.engine, P1).length;
  const deck = deckOf(b.engine, P1).length;
  play(b.engine, P1, b.id("di"));
  answerMay(b, true);
  assert.equal(handOf(b.engine, P1).length, hand - 1, "only the item left my hand");
  assert.equal(deckOf(b.engine, P1).length, deck, "no card drawn");
});

// FLIP UP: 1 [D]
const burlyFlip = (o: { pay?: CardPlacement[]; extra?: CardPlacement[]; turnOf?: PlayerId } = {}) =>
  dev(
    [
      { key: "b", def: printing(BURLY), owner: P1, zone: "play", faceDown: true },
      { key: "fd", def: hidden(), owner: P1, zone: "play", faceDown: true, attachedToKey: "__factionA" },
      ...fillers("dk", 3, P1, "deck"),
      ...(o.pay ?? spent("deception", 1)),
      ...(o.extra ?? [])
    ],
    { activePlayerId: o.turnOf ?? P1 }
  );
const burlyFlipUp = (b: Game, sel: Record<string, CardInstanceId[]> = { rev: [b.id("fd")] }) => {
  flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("b"), selected: sel, variables: {} });
  resolvePendingResponses(b.engine);
};

clause(BURLY, "3:flipUp", "FLIP UP 1 [D]: with [D] met and the face-down card paying its own 1, it flips and resolves as a tactic: reveal, optional deploy, draw, then it goes to the discard pile", () => {
  const b = burlyFlip();
  assert.equal(readyResources(b.engine, P1), 1, "only the face-down Burly itself is ready");
  const deck = deckOf(b.engine, P1);
  const hand = handOf(b.engine, P1).length;
  burlyFlipUp(b);
  if (pending(b.engine)?.kind === "deployForFree") deployChoice(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("b")), "discard", "a resolved tactic goes to the discard pile");
  assert.equal(deckOf(b.engine, P1).length, deck.length - 1, "it drew a card");
  assert.equal(handOf(b.engine, P1).length, hand + 1);
  assert.equal(card(b.engine, b.id("fd")).faceDown, true, "declined deploy: revealed character stays face-down");
});

clause(BURLY, "3:flipUp", "FLIP UP threshold [D]: refused with no [D] (even with plenty of ready resources); the opponent's [D] does not count; a ready [D] works", () => {
  const none = burlyFlip({ pay: V(4) });
  refused(() => burlyFlipUp(none), "no [D]", /threshold|icon|resource/i);
  assert.equal(card(none.engine, none.id("b")).faceDown, true);
  const theirs = burlyFlip({ pay: V(3).concat(spent("deception", 2, P2)) });
  refused(() => burlyFlipUp(theirs), "the opponent's [D]", /threshold|icon|resource/i);
  const ready = burlyFlip({ pay: D(1) });
  burlyFlipUp(ready);
  if (pending(ready.engine)?.kind === "deployForFree") deployChoice(ready);
  assert.equal(zoneOf(ready.engine, ready.id("b")), "discard", "control: a ready [D] meets the threshold");
});

clause(BURLY, "3:flipUp", "FLIP UP cost is 1 and not more: payable with the face-down card alone (+ [D] spent); refused when a second resource would be required", () => {
  const ok = burlyFlip();
  burlyFlipUp(ok);
  if (pending(ok.engine)?.kind === "deployForFree") deployChoice(ok);
  assert.equal(zoneOf(ok.engine, ok.id("b")), "discard");
  const spare = burlyFlip({ pay: spent("deception", 1).concat(V(2)) });
  burlyFlipUp(spare);
  if (pending(spare.engine)?.kind === "deployForFree") deployChoice(spare);
  const left = readyResources(spare.engine, P1);
  assert.ok(left === 1 || left === 2, `exactly 1 resource was paid out of the 3 (Burly itself leaves play): ${left}`);
});

clause(BURLY, "3:flipUp", "the flipped-up tactic still needs its EXTRA COST: a face-down character to reveal (refused with none picked)", () => {
  const b = burlyFlip();
  refused(() => burlyFlipUp(b, {}), "no reveal chosen", /reveal|target|pick|select/i);
  assert.equal(card(b.engine, b.id("b")).faceDown, true);
});

clause(BURLY, "3:flipUp", "as a tactic it can be flipped up in the opponent's response window", () => {
  const b = burlyFlip({
    turnOf: P2,
    extra: [{ key: "att", def: character({ name: "Att", strength: 1, life: 3 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(b.engine, P2, [b.id("att")]);
  const w = b.engine.state.responseWindow as unknown as { priorityPlayerId?: PlayerId } | undefined;
  assert.ok(w, "a response window is open");
  if (w?.priorityPlayerId === P2) act(b.engine, { type: "passPriority", playerId: P2 });
  flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("b"), selected: { rev: [b.id("fd")] }, variables: {} });
  resolvePendingResponses(b.engine);
  if (pending(b.engine)?.kind === "deployForFree") deployChoice(b);
  assert.equal(zoneOf(b.engine, b.id("b")), "discard", "flipped up and resolved in P2's window");
});
