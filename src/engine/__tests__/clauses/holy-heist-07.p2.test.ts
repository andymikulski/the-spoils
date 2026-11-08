// Clause tests — batch holy-heist-07, part p2 (groups 9-13, missing clauses only).
// Expectations come from each card's PRINTED text and RULES.md; engine data is only used to drive the engine.

import assert from "node:assert/strict";
import type { CardDefinition, PlayerId, SpoilsEngine } from "../../../engine.js";
import {
  buildGame,
  bank,
  character,
  developFaction,
  item,
  location,
  play,
  activate,
  resourceCard,
  tactic,
  volition,
  P1,
  P2,
  resolvePendingResponses
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import { answerPending, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { attachedCount, developResource } from "./_turn.js";
import { declareAttackBy, declareAttackOpenWindow, playRaw } from "./_battle.js";

const AKASHIC = "27d42a55-adb9-43ca-95b6-6778af1648f0";
const GATHERING = "b8166db8-01ba-4103-bfee-dfece934c330";
const MARDUUN = "9290edea-a120-4ac9-8b9b-74a86fdb2797";
const ZIGAL = "9fc239ec-9f39-4fd0-ae5d-4bbd4e116f66";
const BLITZ = "3f5aab3e-81e1-46be-98e7-b55fbd60c047";

const res = (icon: "rage" | "volition", n: number, owner: PlayerId) => (icon === "volition" ? volition(n, owner) : bank("rage", n, owner));
const faction = (engine: SpoilsEngine, p: PlayerId) => engine.state.players[p].factionId!;
const flipUpAction = (engine: SpoilsEngine, player: PlayerId, cardId: string) =>
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected: {}, variables: {} });
const voidRes = () => resourceCard({ name: "Void Res", resource: { provides: ["volition"], staple: false } });
const rageRes = () => bank("rage", 1, P2)[0].def;
const doubleVoid = () => resourceCard({ name: "Double Void", resource: { provides: ["volition", "volition"], staple: false } });

/** A free tactic that destroys one chosen card in play. */
const killer = () =>
  tactic({
    name: "Killer",
    cost: 0,
    behavior: {
      abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
    }
  });
/** A free tactic that returns one chosen card in play to its owner's hand. */
const bouncer = () =>
  tactic({
    name: "Bouncer",
    cost: 0,
    behavior: {
      abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }]
    }
  });

// =============================================================================
// Akashic Notes — item · universal · cost 1 · [V] · UNIQUE AKASHIC OBJECT · FLIP UP 3 [V][V]
// =============================================================================

interface AkOpts {
  ready?: number;
  icon?: "rage" | "volition";
  mine?: CardPlacement[];
  foe?: CardPlacement[];
  notes?: Partial<CardPlacement>;
  active?: PlayerId;
  foeBanks?: number;
  foeVolition?: number;
}
function akBoard(o: AkOpts = {}) {
  const active = o.active ?? P2;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: active === P1 ? 1 : 2,
    activePlayerId: active,
    cards: [
      { key: "notes", def: printing(AKASHIC), owner: P1, zone: "play", ...o.notes },
      ...res(o.icon ?? "rage", o.ready ?? 3, P1),
      ...bank("greed", o.foeBanks ?? 0, P2),
      ...volition(o.foeVolition ?? 0, P2),
      ...(o.mine ?? []),
      ...(o.foe ?? [])
    ]
  });
}
type AkGame = ReturnType<typeof akBoard>;
const handCard = (key: string, owner: PlayerId, def: CardDefinition = character({ name: key })): CardPlacement => ({ key, def, owner, zone: "hand" });
const foeDevelops = (g: AkGame, key: string, faceDown: boolean) => {
  developResource(g.engine, P2, g.id(key), faceDown);
  resolvePendingResponses(g.engine);
};
const notes = (g: AkGame) => g.engine.state.cards[g.id("notes")];

clause(AKASHIC, "0:unique", "controlling a second Akashic Notes makes you keep one: keeping the new copy destroys the old one", () => {
  const g = akBoard({ active: P1, icon: "volition", ready: 1, mine: [{ key: "n2", def: printing(AKASHIC), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("n2"));
  assert.equal(pending(g.engine)?.kind, "uniqueSurvivor", "the controller must pick the survivor");
  assert.equal(pending(g.engine)?.playerId, P1);
  answerPending(g.engine, "uniqueSurvivor", { keep: g.id("n2") });
  assert.equal(zoneOf(g.engine, g.id("n2")), "play");
  assert.equal(zoneOf(g.engine, g.id("notes")), "discard", "the other copy is destroyed");
});

clause(AKASHIC, "0:unique", "keeping the old copy destroys the new one", () => {
  const g = akBoard({ active: P1, icon: "volition", ready: 1, mine: [{ key: "n2", def: printing(AKASHIC), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("n2"));
  answerPending(g.engine, "uniqueSurvivor", { keep: g.id("notes") });
  assert.equal(zoneOf(g.engine, g.id("notes")), "play");
  assert.equal(zoneOf(g.engine, g.id("n2")), "discard");
});

clause(AKASHIC, "0:unique", "the AKASHIC OBJECT designation is shared: a different card with the same unique name also conflicts", () => {
  const g = akBoard({
    active: P1,
    icon: "volition",
    ready: 1,
    notes: { zone: "hand" },
    mine: [{ key: "twin", def: item({ name: "Some Other Object", unique: "akashic object" }), owner: P1, zone: "play" }]
  });
  play(g.engine, P1, g.id("notes"));
  assert.equal(pending(g.engine)?.kind, "uniqueSurvivor", "same UNIQUE designation, different card name");
  answerPending(g.engine, "uniqueSurvivor", { keep: g.id("notes") });
  assert.equal(zoneOf(g.engine, g.id("twin")), "discard");
  assert.equal(zoneOf(g.engine, g.id("notes")), "play");
});

clause(AKASHIC, "0:unique", "a card with another UNIQUE designation does not conflict", () => {
  const g = akBoard({
    active: P1,
    icon: "volition",
    ready: 1,
    notes: { zone: "hand" },
    mine: [{ key: "diff", def: item({ name: "Akashic Notes Lookalike", unique: "something else" }), owner: P1, zone: "play" }]
  });
  play(g.engine, P1, g.id("notes"));
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("notes")), "play");
  assert.equal(zoneOf(g.engine, g.id("diff")), "play");
});

clause(AKASHIC, "0:unique", "UNIQUE only concerns your own cards: the opponent controlling a copy does not force a choice", () => {
  const g = akBoard({
    active: P1,
    icon: "volition",
    ready: 1,
    notes: { zone: "hand" },
    foe: [{ key: "theirs", def: printing(AKASHIC), owner: P2, zone: "play" }]
  });
  play(g.engine, P1, g.id("notes"));
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("notes")), "play");
  assert.equal(zoneOf(g.engine, g.id("theirs")), "play");
});

clause(AKASHIC, "1:rule", "an opponent's face-down develop asks the controller (not the opponent) whether to pay 1", () => {
  const g = akBoard({ mine: [handCard("mine", P1)], foe: [handCard("foeChar", P2)] });
  foeDevelops(g, "foeChar", true);
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "mayPay");
  assert.equal(pc?.playerId, P1, "the Notes' controller decides");
  assert.equal(readyResources(g.engine, P1), 3, "nothing is paid until they say so");
});

const paidBanks = (g: AkGame) =>
  g.engine.state.players[P1].play.filter(c => g.engine.isResource(c) && !g.engine.state.cards[c].faceDown && g.engine.state.cards[c].attachedTo === faction(g.engine, P1)).length;

clause(AKASHIC, "1:rule", "paying: spend exactly 1, play the hand card as a face-down resource under my control, and Notes stays face-up", () => {
  const g = akBoard({ mine: [handCard("mine", P1)], foe: [handCard("foeChar", P2)] });
  foeDevelops(g, "foeChar", true);
  answerPending(g.engine, "mayPay", { pay: true });
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("mine")] }); // "play a face-down resource": the controller picks the card
  assert.equal(pending(g.engine), undefined, "exactly one prompt, nothing left open");
  assert.equal(paidBanks(g), 1, "exactly 1 of my 3 resources was spent");
  const m = g.engine.state.cards[g.id("mine")];
  assert.equal(m.zone, "play", "the hand card was played as a resource");
  assert.equal(m.faceDown, true, "face-down");
  assert.equal(m.controllerId, P1);
  assert.equal(g.engine.isResource(g.id("mine")), true);
  assert.equal(notes(g).zone, "play");
  assert.ok(!notes(g).faceDown, "paying means Notes is NOT flipped face-down");
});

clause(AKASHIC, "1:rule", "the played face-down resource is attached to my faction (already spent)", () => {
  const g = akBoard({ mine: [handCard("mine", P1)], foe: [handCard("foeChar", P2)] });
  foeDevelops(g, "foeChar", true);
  answerPending(g.engine, "mayPay", { pay: true });
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("mine")] }); // "play a face-down resource": the controller picks the card
  const m = g.engine.state.cards[g.id("mine")];
  assert.equal(m.attachedTo, faction(g.engine, P1), "attached to my faction");
  assert.equal(readyResources(g.engine, P1), 2, "3 ready, 1 paid, the new resource arrives attached (spent): 2 ready");
});

clause(AKASHIC, "1:rule", "declining: nothing is paid, no resource is played, and Notes flips face-down under its owner's control", () => {
  const g = akBoard({ mine: [handCard("mine", P1)], foe: [handCard("foeChar", P2)] });
  foeDevelops(g, "foeChar", true);
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(pending(g.engine), undefined);
  assert.equal(notes(g).faceDown, true, "otherwise: flipped face-down");
  assert.equal(notes(g).zone, "play", "still in play, as a resource");
  assert.equal(notes(g).controllerId, P1, "under its owner's control");
  assert.equal(zoneOf(g.engine, g.id("mine")), "hand", "no resource was played");
  assert.equal(attachedCount(g.engine, P1), 0, "nothing was paid");
  assert.equal(readyResources(g.engine, P1), 4, "3 untouched, plus the flipped-down Notes now being a resource");
});

clause(AKASHIC, "1:rule", "fires when the opponent plays a face-up resource that provides [V]", () => {
  const g = akBoard({ mine: [handCard("mine", P1)], foe: [handCard("foeV", P2, voidRes())] });
  foeDevelops(g, "foeV", false);
  assert.equal(pending(g.engine)?.kind, "mayPay");
  assert.equal(pending(g.engine)?.playerId, P1);
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(pending(g.engine), undefined);
  assert.equal(notes(g).faceDown, true);
});

clause(AKASHIC, "1:rule", "'at least [V]': a resource providing two [V] also triggers it", () => {
  const g = akBoard({ mine: [handCard("mine", P1)], foe: [handCard("foeVV", P2, doubleVoid())] });
  foeDevelops(g, "foeVV", false);
  assert.equal(pending(g.engine)?.kind, "mayPay");
  answerPending(g.engine, "mayPay", { pay: true });
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("mine")] }); // "play a face-down resource": the controller picks the card
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("mine")), "play");
  assert.equal(g.engine.state.cards[g.id("mine")].faceDown, true);
});

clause(AKASHIC, "1:rule", "does not fire for an opponent's face-up resource that provides no [V]", () => {
  const g = akBoard({ mine: [handCard("mine", P1)], foe: [handCard("foeR", P2, rageRes())] });
  foeDevelops(g, "foeR", false);
  assert.equal(pending(g.engine), undefined);
  assert.ok(!notes(g).faceDown, "!notes(g).faceDown");
  assert.equal(zoneOf(g.engine, g.id("mine")), "hand");
  assert.equal(readyResources(g.engine, P1), 3);
});

clause(AKASHIC, "1:rule", "does not fire for a non-resource card entering the opponent's control face-up (it provides nothing)", () => {
  const g = akBoard({ foe: [{ key: "foeChar", def: character({ name: "FoeChar", cost: 0 }), owner: P2, zone: "hand" }] });
  play(g.engine, P2, g.id("foeChar"));
  assert.equal(zoneOf(g.engine, g.id("foeChar")), "play", "positive control: it entered play");
  assert.equal(pending(g.engine), undefined);
  assert.ok(!notes(g).faceDown, "!notes(g).faceDown");
});

clause(AKASHIC, "1:rule", "does not fire when the controller plays their own face-down card", () => {
  const g = akBoard({ active: P1, mine: [handCard("mine", P1), handCard("mine2", P1)] });
  developResource(g.engine, P1, g.id("mine"), true);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("mine")), "play", "positive control: it was developed");
  assert.equal(pending(g.engine), undefined);
  assert.ok(!notes(g).faceDown, "!notes(g).faceDown");
  assert.equal(zoneOf(g.engine, g.id("mine2")), "hand");
});

clause(AKASHIC, "1:rule", "once Notes is face-down it no longer reacts", () => {
  const g = akBoard({ notes: { faceDown: true }, mine: [handCard("mine", P1)], foe: [handCard("foeChar", P2)] });
  foeDevelops(g, "foeChar", true);
  assert.equal(zoneOf(g.engine, g.id("foeChar")), "play", "positive control: the develop happened");
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("mine")), "hand");
});

clause(AKASHIC, "1:rule", "with no resources to pay 1 the controller cannot pay: Notes flips face-down and no resource is played", () => {
  const g = akBoard({ ready: 0, mine: [handCard("mine", P1)], foe: [handCard("foeChar", P2)] });
  foeDevelops(g, "foeChar", true);
  drain(g.engine, declineAll);
  assert.equal(pending(g.engine), undefined);
  assert.equal(notes(g).faceDown, true);
  assert.equal(zoneOf(g.engine, g.id("mine")), "hand");
});

clause(AKASHIC, "1:rule", "paying with an empty hand still pays 1 and leaves Notes face-up (there is just nothing to play)", () => {
  const g = akBoard({ foe: [handCard("foeChar", P2)] });
  foeDevelops(g, "foeChar", true);
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(pending(g.engine), undefined);
  assert.equal(attachedCount(g.engine, P1), 1, "the 1 payment is spent");
  assert.ok(!notes(g).faceDown, "!notes(g).faceDown");
});

clause(AKASHIC, "1:rule", "the controller chooses which card to play face-down (with two cards in hand they are asked)", () => {
  const g = akBoard({ mine: [handCard("h1", P1), handCard("h2", P1)], foe: [handCard("foeChar", P2)] });
  foeDevelops(g, "foeChar", true);
  answerPending(g.engine, "mayPay", { pay: true });
  const pc = pending(g.engine);
  assert.ok(pc, "a pick is offered");
  assert.equal(pc?.playerId, P1, "the controller picks");
  answerPending(g.engine, pc!.kind, { selected: [g.id("h2")] });
  assert.equal(zoneOf(g.engine, g.id("h2")), "play");
  assert.equal(g.engine.state.cards[g.id("h2")].faceDown, true);
  assert.equal(zoneOf(g.engine, g.id("h1")), "hand", "the unpicked card stays");
});

clause(AKASHIC, "1:rule", "'opponent' is relative to the Notes' controller: when the opponent owns it, the controller pays/plays and a decline flips it under its OWNER", () => {
  const g = akBoard({
    active: P1,
    notes: { controller: P2 },
    mine: [handCard("mine", P1)],
    foe: [handCard("foeHand", P2)],
    foeBanks: 2
  });
  // The Notes is owned by P1 but controlled by P2; P1 (the owner, an opponent of the controller) plays a face-down card.
  developResource(g.engine, P1, g.id("mine"), true);
  resolvePendingResponses(g.engine);
  assert.equal(pending(g.engine)?.kind, "mayPay");
  assert.equal(pending(g.engine)?.playerId, P2, "the controller (P2) decides");
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(notes(g).faceDown, true);
  assert.equal(notes(g).controllerId, P1, "flipped face-down under its owner's control");
});

clause(AKASHIC, "1:rule", "when the opponent is the controller and pays, the controller's own hand and resources are used", () => {
  const g = akBoard({
    active: P1,
    notes: { controller: P2 },
    mine: [handCard("mine", P1)],
    foe: [handCard("foeHand", P2)],
    foeBanks: 2
  });
  developResource(g.engine, P1, g.id("mine"), true);
  resolvePendingResponses(g.engine);
  answerPending(g.engine, "mayPay", { pay: true });
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("foeHand")] }); // "play a face-down resource": the controller picks the card
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("foeHand")), "play", "the controller's hand card was played");
  assert.equal(g.engine.state.cards[g.id("foeHand")].faceDown, true);
  assert.equal(readyResources(g.engine, P1), 4, "the owner's 3 resources were not spent (the 4th is the card they developed)");
  assert.ok(!notes(g).faceDown, "!notes(g).faceDown");
});

// FLIP UP: 3 [V][V]
const flipBoard = (o: AkOpts = {}) => akBoard({ active: P1, notes: { faceDown: true }, ...o });

clause(AKASHIC, "2:flipUp", "FLIP UP with three [V] resources flips Notes face-up into play as an item", () => {
  const g = flipBoard({ icon: "volition", ready: 3 });
  assert.equal(notes(g).faceDown, true);
  flipUpAction(g.engine, P1, g.id("notes"));
  resolvePendingResponses(g.engine);
  assert.equal(notes(g).zone, "play");
  assert.ok(!notes(g).faceDown, "face-up");
  assert.deepEqual(g.engine.getCardTypes(g.id("notes")), ["item"]);
  assert.equal(g.engine.isResource(g.id("notes")), false, "no longer a resource");
});

clause(AKASHIC, "2:flipUp", "the FLIP UP cost is 3 (not its normal 1, not 4): exactly three other resources are spent from six", () => {
  const g = flipBoard({ icon: "volition", ready: 6 });
  flipUpAction(g.engine, P1, g.id("notes"));
  resolvePendingResponses(g.engine);
  assert.ok(!notes(g).faceDown, "!notes(g).faceDown");
  const left = readyResources(g.engine, P1);
  // The 6 other resources minus the 3 paid leaves 3; if the Notes itself helped pay (CR 507.4b) 4 are left.
  assert.ok(left === 3 || left === 4, `3 paid (leaving 3, or 4 if Notes paid for itself), got ${left}`);
});

clause(AKASHIC, "2:flipUp", "FLIP UP threshold [V][V] is met by a single resource that provides two [V]", () => {
  const g = flipBoard({ ready: 4, mine: [{ key: "dv", def: doubleVoid(), owner: P1, zone: "play" }] });
  flipUpAction(g.engine, P1, g.id("notes"));
  assert.ok(!notes(g).faceDown, "VV from one double-[V] resource plus four rage resources paying 3");
});

clause(AKASHIC, "2:flipUp", "FLIP UP is refused when too few resources are available (one other resource)", () => {
  const g = flipBoard({ icon: "volition", ready: 1 });
  refused(() => flipUpAction(g.engine, P1, g.id("notes")), "cost 3 is not affordable");
  assert.equal(notes(g).faceDown, true);
  const ok = flipBoard({ icon: "volition", ready: 3 });
  flipUpAction(ok.engine, P1, ok.id("notes"));
  assert.ok(!ok.engine.state.cards[ok.id("notes")].faceDown, "positive control");
});

clause(AKASHIC, "2:flipUp", "FLIP UP [V][V]: the face-down Notes' own Volition does not count (literal reading: once flipped it is not a resource)", () => {
  // Besides the Notes there is exactly ONE [V] (plus rage to pay): literally only [V] is available, not [V][V].
  const g = flipBoard({ icon: "rage", ready: 3, mine: volition(1, P1) });
  refused(() => flipUpAction(g.engine, P1, g.id("notes")), "only one other [V]; the Notes' own icon must not count");
  assert.equal(notes(g).faceDown, true);
  // positive control: two OTHER [V] resources meet the threshold
  const ok = flipBoard({ icon: "rage", ready: 2, mine: volition(2, P1) });
  flipUpAction(ok.engine, P1, ok.id("notes"));
  assert.ok(!notes(ok).faceDown, "!notes(ok).faceDown");
});

clause(AKASHIC, "2:flipUp", "FLIP UP is refused without two [V]: five non-[V] resources are not enough", () => {
  const g = flipBoard({ icon: "rage", ready: 5 });
  refused(() => flipUpAction(g.engine, P1, g.id("notes")), "needs [V][V]");
  assert.equal(notes(g).faceDown, true);
  assert.equal(attachedCount(g.engine, P1), 0, "nothing was paid");
});

clause(AKASHIC, "2:flipUp", "FLIP UP is refused during the opponent's response window (a non-tactic)", () => {
  const g = akBoard({
    active: P2,
    icon: "volition",
    ready: 6,
    notes: { faceDown: true },
    foe: [{ key: "atk", def: character({ name: "Atk", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  refused(() => flipUpAction(g.engine, P1, g.id("notes")), "an item cannot be deployed in the opponent's window");
  assert.equal(notes(g).faceDown, true);
});

// =============================================================================
// Gathering of Unlikely Heroes — tactic · universal · cost 3 · [V]
// =============================================================================

interface GuhOpts {
  active?: PlayerId;
  resources?: number;
  icon?: "rage" | "volition";
  deck?: CardPlacement[];
  hand?: CardPlacement[];
}
function guhBoard(o: GuhOpts = {}) {
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: active === P1 ? 1 : 2,
    activePlayerId: active,
    cards: [
      { key: "guh", def: printing(GATHERING), owner: P1, zone: "hand" },
      ...res(o.icon ?? "volition", o.resources ?? 3, P1),
      { key: "warChar", def: character({ name: "War Char", trade: "warlord" }), owner: P1, zone: "deck" },
      { key: "gearChar", def: character({ name: "Gear Char", trade: "gearsmith" }), owner: P1, zone: "deck" },
      { key: "rogueChar", def: character({ name: "Rogue Char", trade: "rogue" }), owner: P1, zone: "deck" },
      { key: "univChar", def: character({ name: "Univ Char", trade: "universal" }), owner: P1, zone: "deck" },
      { key: "warItem", def: item({ name: "War Item", trade: "warlord" }), owner: P1, zone: "deck" },
      { key: "foeWar", def: character({ name: "Foe War", trade: "warlord" }), owner: P2, zone: "deck" },
      ...(o.deck ?? []),
      ...(o.hand ?? [])
    ]
  });
}
type GuhGame = ReturnType<typeof guhBoard>;
const castGuh = (g: GuhGame) => play(g.engine, P1, g.id("guh"), { selected: { p: [faction(g.engine, P2)] } });
const nameBoth = (g: GuhGame, a = "warlord", b = "gearsmith") => {
  answerPending(g.engine, "nameValue", { value: a });
  answerPending(g.engine, "nameValue", { value: b });
};
const handKeys = (g: GuhGame, keys: string[]) => keys.filter(k => g.engine.state.players[P1].hand.includes(g.id(k)));

clause(GATHERING, "0:extraCost", "deploying pays the printed 3 and needs [V]: three face-down resources work, two are refused", () => {
  const g = guhBoard();
  castGuh(g);
  assert.equal(readyResources(g.engine, P1), 0, "all three resources were spent");
  assert.equal(pending(g.engine)?.kind, "nameValue");
  const short = guhBoard({ resources: 2 });
  refused(() => castGuh(short), "cost 3 is not affordable with 2");
  assert.equal(zoneOf(short.engine, short.id("guh")), "hand");
});

clause(GATHERING, "0:extraCost", "the threshold is a single [V]: one [V] resource plus two others is enough", () => {
  const g = guhBoard({ resources: 0, hand: [...bank("rage", 2, P1), ...volition(1, P1)] });
  castGuh(g);
  assert.equal(pending(g.engine)?.kind, "nameValue");
  assert.equal(readyResources(g.engine, P1), 0);
});

clause(GATHERING, "0:extraCost", "deploying needs the [V] threshold: three non-[V] resources are refused", () => {
  const g = guhBoard({ icon: "rage" });
  refused(() => castGuh(g), "no [V]");
  assert.equal(zoneOf(g.engine, g.id("guh")), "hand");
  assert.equal(attachedCount(g.engine, P1), 0, "nothing was paid");
});

clause(GATHERING, "0:extraCost", "Deploy only during your turn: refused when it is the opponent's turn, even with priority in a response window and no battle", () => {
  // The opponent casts a free tactic on their own turn; I hold priority with no battle under way, so only "your turn" can refuse.
  const g = guhBoard({
    active: P2,
    resources: 4,
    hand: [{ key: "t2", def: tactic({ name: "T2", cost: 0, behavior: { abilities: [{ id: "x", type: "activated", targets: [], effects: [] }] } }), owner: P2, zone: "hand" }]
  });
  playRaw(g.engine, P2, g.id("t2"), {});
  assert.equal(g.engine.state.battle, undefined, "no battle");
  assert.equal(g.engine.state.priorityPlayerId, P1, "I hold priority on the opponent's turn");
  refused(() => castGuh(g), "not your turn", /cannot be deployed right now/);
  assert.equal(zoneOf(g.engine, g.id("guh")), "hand");
  const mine = guhBoard({ resources: 4 });
  castGuh(mine);
  assert.equal(pending(mine.engine)?.kind, "nameValue", "positive control on my own turn");
});

clause(GATHERING, "0:extraCost", "Deploy not during a battle: refused while a battle is under way on my own turn", () => {
  const g = guhBoard({
    resources: 4,
    deck: [{ key: "atk", def: character({ name: "Atk", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" }]
  });
  // Declare and keep priority: it is my turn, I hold priority and a response window is open, so ONLY the
  // "not during a battle" condition can refuse (declareAttackBy would hand priority to the defender, which refuses on its own).
  g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("atk")], target: { type: "faction", playerId: P2 } } as never);
  assert.ok(g.engine.state.battle, "a battle is active");
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P1, "I hold priority in an open window on my own turn");
  refused(() => castGuh(g), "during a battle", /cannot be deployed right now/);
  assert.equal(zoneOf(g.engine, g.id("guh")), "hand");
  // control: another tactic with no battle restriction IS deployable in this very window
  const c = guhBoard({
    resources: 4,
    deck: [{ key: "atk", def: character({ name: "Atk", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" }],
    hand: [{ key: "free", def: tactic({ name: "Free", cost: 0, behavior: { abilities: [{ id: "f", type: "activated", targets: [], effects: [] }] } }), owner: P1, zone: "hand" }]
  });
  c.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [c.id("atk")], target: { type: "faction", playerId: P2 } } as never);
  play(c.engine, P1, c.id("free"));
  assert.notEqual(zoneOf(c.engine, c.id("free")), "hand", "positive control: a plain tactic deploys in the same window");
});

clause(GATHERING, "0:extraCost", "Pick an opponent: the opponent's faction is the pick; my own faction is refused", () => {
  const g = guhBoard();
  refused(() => play(g.engine, P1, g.id("guh"), { selected: { p: [faction(g.engine, P1)] } }), "must pick an opponent");
  assert.equal(zoneOf(g.engine, g.id("guh")), "hand");
  castGuh(g);
  assert.equal(pending(g.engine)?.playerId, P2, "positive control: the picked opponent is the one who names");
});

clause(GATHERING, "1:rule", "the picked opponent (not me) names two trades, one after the other", () => {
  const g = guhBoard();
  castGuh(g);
  let pc = pending(g.engine);
  assert.equal(pc?.kind, "nameValue");
  assert.equal(pc?.playerId, P2, "first name is the opponent's");
  assert.equal(pc?.valueKind, "trade");
  answerPending(g.engine, "nameValue", { value: "warlord" });
  pc = pending(g.engine);
  assert.equal(pc?.kind, "nameValue", "a second trade is named");
  assert.equal(pc?.playerId, P2);
  assert.equal(pc?.valueKind, "trade");
  answerPending(g.engine, "nameValue", { value: "gearsmith" });
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget", "only then the search");
  assert.equal(pending(g.engine)?.playerId, P1, "I search");
});

clause(GATHERING, "1:rule", "the named trades must be non-Universal: naming Universal is refused", () => {
  const g = guhBoard();
  castGuh(g);
  refused(() => answerPending(g.engine, "nameValue", { value: "universal" }), "Universal is not a legal name");
  answerPending(g.engine, "nameValue", { value: "warlord" });
  refused(() => answerPending(g.engine, "nameValue", { value: "universal" }), "Universal is not a legal second name");
  answerPending(g.engine, "nameValue", { value: "gearsmith" });
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget");
});

clause(GATHERING, "1:rule", "I can find a character of the FIRST named trade: it goes to my hand and is revealed", () => {
  const g = guhBoard();
  castGuh(g);
  nameBoth(g);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("warChar")] });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("warChar")), "hand");
  const revealed = g.engine.getLog().some(e => e.event?.type === "cardsRevealed" && (e.event as { cardIds: string[] }).cardIds.includes(g.id("warChar")));
  assert.ok(revealed, "the found character was revealed");
});

clause(GATHERING, "1:rule", "I can find a character of the SECOND named trade", () => {
  const g = guhBoard();
  const before = g.engine.state.players[P1].hand.length;
  castGuh(g);
  nameBoth(g);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("gearChar")] });
  assert.equal(zoneOf(g.engine, g.id("gearChar")), "hand");
  assert.equal(g.engine.state.players[P1].hand.length, before - 1 + 2, "only the one found (plus the draw)");
});

clause(GATHERING, "1:rule", "only characters of a named trade qualify: other trades, Universal, non-characters and the opponent's deck are refused", () => {
  const g = guhBoard();
  castGuh(g);
  nameBoth(g);
  for (const bad of ["rogueChar", "univChar", "warItem", "foeWar"]) {
    refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(bad)] }), `${bad} is not a legal find`);
  }
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget", "the search is still open");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("warChar")] });
  assert.equal(zoneOf(g.engine, g.id("warChar")), "hand");
});

clause(GATHERING, "1:rule", "after the search I draw a card (hand grows by the found character plus one drawn)", () => {
  const g = guhBoard({ deck: [{ key: "x1", def: character({ name: "X1", trade: "rogue" }), owner: P1, zone: "deck" }] });
  const before = g.engine.state.players[P1].hand.length;
  const deckBefore = g.engine.state.players[P1].deck.length;
  castGuh(g);
  nameBoth(g);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("warChar")] });
  // Played the tactic: -1 from hand, +1 found, +1 drawn.
  assert.equal(g.engine.state.players[P1].hand.length, before - 1 + 2);
  assert.equal(g.engine.state.players[P1].hand.includes(g.id("warChar")), true);
  assert.equal(g.engine.state.players[P1].deck.length, deckBefore - 2, "the found card and the drawn card left the deck");
});

clause(GATHERING, "1:rule", "the draw happens even if I decline/cannot find a character; nothing else moves", () => {
  const g = guhBoard();
  const before = g.engine.state.players[P1].hand.length;
  const deckBefore = g.engine.state.players[P1].deck.length;
  castGuh(g);
  nameBoth(g, "arcanist", "banker");
  drain(g.engine, declineAll);
  assert.equal(pending(g.engine), undefined);
  assert.equal(handKeys(g, ["warChar", "gearChar", "rogueChar", "univChar", "warItem"]).length <= 1, true, "no named-trade character was fetched; only a draw may bring one");
  assert.equal(g.engine.state.players[P1].hand.length, before - 1 + 1, "tactic gone, exactly one card drawn");
  assert.equal(g.engine.state.players[P1].deck.length, deckBefore - 1);
});

clause(GATHERING, "1:rule", "a failed search is still followed by drawing (no named character in my deck, search shows nothing to find)", () => {
  const g = guhBoard();
  const before = g.engine.state.players[P1].hand.length;
  castGuh(g);
  nameBoth(g, "arcanist", "banker");
  const pc = pending(g.engine);
  if (pc) {
    refused(() => answerPending(g.engine, pc.kind, { selected: [g.id("warChar")] }), "warlord is not a named trade");
    drain(g.engine, declineAll);
  }
  assert.equal(g.engine.state.players[P1].hand.length, before, "tactic spent, one card drawn");
});

// =============================================================================
// Marduun Ruins — location · universal · cost 3 · [V][V][V] · structure 4 · UNIQUE MARDUUN RUINS
// =============================================================================

function ruinsBoard(extra: CardPlacement[] = [], ruins: Partial<CardPlacement> = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ruins", def: printing(MARDUUN), owner: P1, zone: "play", ...ruins },
      { key: "vChar", def: character({ name: "V Char", strength: 2, life: 3, text: "When this enters play, draw a card. [V]" }), owner: P1, zone: "play" },
      { key: "vvChar", def: character({ name: "VV Char", strength: 1, life: 1, text: "[V][V]: do something" }), owner: P1, zone: "play" },
      { key: "rChar", def: character({ name: "R Char", strength: 2, life: 3, text: "Whenever this attacks, [R] bonus" }), owner: P1, zone: "play" },
      { key: "plain", def: character({ name: "Plain", strength: 2, life: 3, text: "Valiant, Vicious and Void." }), owner: P1, zone: "play" },
      { key: "threshOnly", def: character({ name: "Thresh", strength: 2, life: 3, threshold: "v", text: "" }), owner: P1, zone: "play" },
      { key: "foeV", def: character({ name: "Foe V", strength: 2, life: 3, text: "[V] ability" }), owner: P2, zone: "play" },
      { key: "vItem", def: item({ name: "V Item", text: "[V] item", strength: 1, life: 1 }), owner: P1, zone: "play" },
      ...extra
    ]
  });
}
const stats = (g: ReturnType<typeof ruinsBoard>, key: string) => [g.engine.getStat(g.id(key), "strength"), g.engine.getStat(g.id(key), "life")];

clause(MARDUUN, "0:unique", "controlling a second Marduun Ruins makes you keep one: keeping the new copy destroys the old", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "r1", def: printing(MARDUUN), owner: P1, zone: "play" },
      { key: "r2", def: printing(MARDUUN), owner: P1, zone: "hand" },
      ...volition(3, P1)
    ]
  });
  play(g.engine, P1, g.id("r2"));
  assert.equal(pending(g.engine)?.kind, "uniqueSurvivor");
  assert.equal(pending(g.engine)?.playerId, P1);
  answerPending(g.engine, "uniqueSurvivor", { keep: g.id("r2") });
  assert.equal(zoneOf(g.engine, g.id("r2")), "play");
  assert.equal(zoneOf(g.engine, g.id("r1")), "discard");
});

clause(MARDUUN, "0:unique", "keeping the old copy destroys the new one; the opponent's copy never conflicts", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "r1", def: printing(MARDUUN), owner: P1, zone: "play" },
      { key: "r2", def: printing(MARDUUN), owner: P1, zone: "hand" },
      ...volition(3, P1)
    ]
  });
  play(g.engine, P1, g.id("r2"));
  answerPending(g.engine, "uniqueSurvivor", { keep: g.id("r1") });
  assert.equal(zoneOf(g.engine, g.id("r1")), "play");
  assert.equal(zoneOf(g.engine, g.id("r2")), "discard");
  const o = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "theirs", def: printing(MARDUUN), owner: P2, zone: "play" },
      { key: "r2", def: printing(MARDUUN), owner: P1, zone: "hand" },
      ...volition(3, P1)
    ]
  });
  play(o.engine, P1, o.id("r2"));
  assert.equal(pending(o.engine), undefined);
  assert.equal(zoneOf(o.engine, o.id("theirs")), "play");
  assert.equal(zoneOf(o.engine, o.id("r2")), "play");
});

clause(MARDUUN, "0:unique", "the MARDUUN RUINS designation is shared: a different location with the same unique name conflicts", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "twin", def: location({ name: "Other Ruins", unique: "marduun ruins" }), owner: P1, zone: "play" },
      { key: "r2", def: printing(MARDUUN), owner: P1, zone: "hand" },
      ...volition(3, P1)
    ]
  });
  play(g.engine, P1, g.id("r2"));
  assert.equal(pending(g.engine)?.kind, "uniqueSurvivor");
  answerPending(g.engine, "uniqueSurvivor", { keep: g.id("r2") });
  assert.equal(zoneOf(g.engine, g.id("twin")), "discard");
});

clause(MARDUUN, "1:rule", "my characters with a [V] in their rules text get +2 strength and +2 life", () => {
  const g = ruinsBoard();
  assert.deepEqual(stats(g, "vChar"), [4, 5]);
  assert.deepEqual(stats(g, "vvChar"), [3, 3], "[V][V] also counts, once (+2/+2 not +4/+4)");
});

clause(MARDUUN, "1:rule", "my characters without a [V] in their text are unchanged (other icon, plain words, threshold-only)", () => {
  const g = ruinsBoard();
  assert.deepEqual(stats(g, "rChar"), [2, 3], "[R] text");
  assert.deepEqual(stats(g, "plain"), [2, 3], "the letter V in words is not an icon");
  assert.deepEqual(stats(g, "threshOnly"), [2, 3], "a [V] threshold is not rules text");
});

clause(MARDUUN, "1:rule", "only characters YOU control: the opponent's [V] character is unchanged", () => {
  const g = ruinsBoard();
  assert.deepEqual(stats(g, "foeV"), [2, 3]);
  assert.deepEqual(stats(g, "vChar"), [4, 5], "positive control");
});

clause(MARDUUN, "1:rule", "only characters: an item with [V] text is unchanged", () => {
  const g = ruinsBoard();
  assert.equal(g.engine.getStat(g.id("vItem"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("vItem"), "life"), 1);
  assert.deepEqual(stats(g, "vChar"), [4, 5], "positive control");
});

clause(MARDUUN, "1:rule", "it follows control: a [V] character I control that is owned by the opponent gets the bonus", () => {
  const g = ruinsBoard([{ key: "stolen", def: character({ name: "Stolen", strength: 1, life: 1, text: "[V]" }), owner: P2, zone: "play", controller: P1 }]);
  assert.deepEqual(stats(g, "stolen"), [3, 3]);
});

clause(MARDUUN, "1:rule", "the bonus is not there when Marduun Ruins is not in play (in hand)", () => {
  const g = ruinsBoard([], { zone: "hand" });
  assert.deepEqual(stats(g, "vChar"), [2, 3]);
  assert.deepEqual(stats(g, "vvChar"), [1, 1]);
});

clause(MARDUUN, "1:rule", "the bonus ends when Marduun Ruins is destroyed, and stays off afterwards", () => {
  const g = ruinsBoard([{ key: "kill", def: killer(), owner: P1, zone: "hand" }]);
  assert.deepEqual(stats(g, "vChar"), [4, 5]);
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("ruins")] } });
  assert.equal(zoneOf(g.engine, g.id("ruins")), "discard");
  assert.deepEqual(stats(g, "vChar"), [2, 3]);
  assert.deepEqual(stats(g, "vvChar"), [1, 1]);
  resolvePendingResponses(g.engine);
  assert.deepEqual(stats(g, "vChar"), [2, 3], "still off");
});

clause(MARDUUN, "1:rule", "the bonus ends when Marduun Ruins returns to hand", () => {
  const g = ruinsBoard([{ key: "bounce", def: bouncer(), owner: P1, zone: "hand" }]);
  play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("ruins")] } });
  assert.equal(zoneOf(g.engine, g.id("ruins")), "hand");
  assert.deepEqual(stats(g, "vChar"), [2, 3]);
});

clause(MARDUUN, "1:rule", "a damaged character with the bonus keeps its +2 life (3 life + 2: survives 4 damage, dies at 5)", () => {
  const g = ruinsBoard([], {});
  g.engine.state.cards[g.id("vChar")].damage = 4;
  assert.equal(g.engine.getStat(g.id("vChar"), "life"), 5);
  assert.equal(zoneOf(g.engine, g.id("vChar")), "play");
});

// =============================================================================
// Zigalburgonglgr, the Stolen God — character · god · cost 8 · [V]x6 · 6/1/6
// =============================================================================

interface ZigOpts {
  vol?: number;
  rage?: number;
  dbl?: number;
  foeVol?: number;
  zone?: "hand" | "play";
  extra?: CardPlacement[];
}
function zigBoard(o: ZigOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "z", def: printing(ZIGAL), owner: P1, zone: o.zone ?? "hand" },
      ...volition(o.vol ?? 6, P1),
      ...bank("rage", o.rage ?? 2, P1),
      ...Array.from({ length: o.dbl ?? 0 }, (_, i): CardPlacement => ({ key: `dbl${i}`, def: doubleVoid(), owner: P1, zone: "play" })),
      ...volition(o.foeVol ?? 3, P2),
      ...Array.from({ length: 9 }, (_, i): CardPlacement => ({ key: `o${i}`, def: character({ name: `Opp ${i}` }), owner: P2, zone: "play" })),
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "myItem", def: item({ name: "My Item" }), owner: P1, zone: "play" },
      { key: "loc", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...(o.extra ?? [])
    ]
  });
}
type ZigGame = ReturnType<typeof zigBoard>;
const castZig = (g: ZigGame) => {
  play(g.engine, P1, g.id("z"));
  assert.equal(zoneOf(g.engine, g.id("z")), "play", "Zigalburgonglgr entered play");
};
const pickMarks = (g: ZigGame, keys: string[]) => answerPending(g.engine, "selectTargets", { selected: { marks: keys.map(k => g.id(k)) } });
const marked = (g: ZigGame, keys: string[]) => keys.filter(k => tokensOn(g.engine, g.id(k)) > 0);

clause(ZIGAL, "0:rule", "entering play asks its controller to put tokens on up to X non-resource cards, X = my [V] count (6 here)", () => {
  const g = zigBoard();
  castZig(g);
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "selectTargets");
  assert.equal(pc?.playerId, P1);
  pickMarks(g, ["o0", "o1", "o2", "o3", "o4", "o5"]);
  assert.equal(pending(g.engine), undefined);
  assert.deepEqual(marked(g, ["o0", "o1", "o2", "o3", "o4", "o5"]).length, 6);
  for (const k of ["o0", "o5"]) assert.equal(tokensOn(g.engine, g.id(k)), 1, "one token each");
  assert.deepEqual(marked(g, ["o6", "o7", "o8", "mine", "myItem", "loc"]), [], "unpicked cards get nothing");
});

clause(ZIGAL, "0:rule", "it deploys for its printed cost 8 (7 resources refused) and has printed stats 6 / 1 / 6", () => {
  const g = zigBoard({ vol: 6, rage: 2 });
  castZig(g);
  assert.equal(readyResources(g.engine, P1), 0, "all 8 spent");
  assert.equal(g.engine.getStat(g.id("z"), "strength"), 6);
  assert.equal(g.engine.getStat(g.id("z"), "speed"), 1);
  assert.equal(g.engine.getStat(g.id("z"), "life"), 6);
  const short = zigBoard({ vol: 6, rage: 1 });
  refused(() => play(short.engine, P1, short.id("z")), "7 resources < cost 8");
  assert.equal(zoneOf(short.engine, short.id("z")), "hand");
});

clause(ZIGAL, "0:rule", "it needs six [V]: five [V] plus three other resources is refused", () => {
  const g = zigBoard({ vol: 5, rage: 3 });
  refused(() => play(g.engine, P1, g.id("z")), "needs [V]x6");
  assert.equal(zoneOf(g.engine, g.id("z")), "hand");
});

clause(ZIGAL, "0:rule", "more than X targets are refused (7th with X = 6)", () => {
  const g = zigBoard();
  castZig(g);
  refused(() => pickMarks(g, ["o0", "o1", "o2", "o3", "o4", "o5", "o6"]), "up to X = 6");
  assert.deepEqual(marked(g, ["o0", "o6"]), []);
  pickMarks(g, ["o0", "o1", "o2", "o3", "o4", "o5"]);
  assert.equal(marked(g, ["o0", "o5"]).length, 2, "positive control");
});

clause(ZIGAL, "0:rule", "X counts every [V] icon I control, including a double-[V] resource, and ignores the opponent's and non-[V] resources (X = 7 here)", () => {
  const g = zigBoard({ vol: 5, dbl: 1, rage: 2, foeVol: 3 });
  castZig(g);
  refused(() => pickMarks(g, ["o0", "o1", "o2", "o3", "o4", "o5", "o6", "o7"]), "8 > X = 7");
  pickMarks(g, ["o0", "o1", "o2", "o3", "o4", "o5", "o6"]);
  assert.equal(marked(g, ["o0", "o1", "o2", "o3", "o4", "o5", "o6"]).length, 7);
  assert.deepEqual(marked(g, ["o7", "o8"]), []);
});

clause(ZIGAL, "0:rule", "X = 8 with eight [V] resources (no non-[V] resources)", () => {
  const g = zigBoard({ vol: 8, rage: 0 });
  castZig(g);
  refused(() => pickMarks(g, ["o0", "o1", "o2", "o3", "o4", "o5", "o6", "o7", "o8"]), "9 > X = 8");
  pickMarks(g, ["o0", "o1", "o2", "o3", "o4", "o5", "o6", "o7"]);
  assert.equal(marked(g, ["o0", "o7"]).length, 2);
  assert.equal(tokensOn(g.engine, g.id("o8")), 0);
});

clause(ZIGAL, "0:rule", "up to X: choosing fewer (1, or none) is fine; it is a 'you may'", () => {
  const g1 = zigBoard();
  castZig(g1);
  pickMarks(g1, ["o3"]);
  assert.deepEqual(marked(g1, ["o0", "o1", "o2", "o3", "o4"]), ["o3"]);
  const g0 = zigBoard();
  castZig(g0);
  pickMarks(g0, []);
  assert.equal(pending(g0.engine), undefined);
  assert.deepEqual(marked(g0, ["o0", "o1", "o2", "o3", "mine", "myItem", "loc"]), []);
});

clause(ZIGAL, "0:rule", "any non-resource card may get a token: mine, theirs, an item, a location, and Zigalburgonglgr itself", () => {
  const g = zigBoard();
  castZig(g);
  pickMarks(g, ["mine", "myItem", "loc", "o0", "z"]);
  assert.deepEqual(marked(g, ["mine", "myItem", "loc", "o0", "z"]).length, 5);
});

clause(ZIGAL, "0:rule", "resource cards cannot get tokens: my face-down resource and the opponent's are refused", () => {
  const g = zigBoard();
  castZig(g);
  const myRes = g.engine.state.players[P1].play.find(c => g.engine.isResource(c))!;
  const foeRes = g.engine.state.players[P2].play.find(c => g.engine.isResource(c))!;
  refused(() => answerPending(g.engine, "selectTargets", { selected: { marks: [myRes] } }), "my resource");
  refused(() => answerPending(g.engine, "selectTargets", { selected: { marks: [foeRes] } }), "their resource");
  refused(() => answerPending(g.engine, "selectTargets", { selected: { marks: [g.id("o0"), foeRes] } }), "mixed legal and resource");
  assert.equal(tokensOn(g.engine, myRes) + tokensOn(g.engine, foeRes), 0);
  pickMarks(g, ["o0"]);
  assert.equal(tokensOn(g.engine, g.id("o0")), 1, "positive control");
});

clause(ZIGAL, "0:rule", "a faction is not a pickable card for a generic 'non-resource card' (CR 202.9)", () => {
  const g = zigBoard();
  castZig(g);
  refused(() => answerPending(g.engine, "selectTargets", { selected: { marks: [faction(g.engine, P2)] } }), "opponent faction");
  refused(() => answerPending(g.engine, "selectTargets", { selected: { marks: [faction(g.engine, P1)] } }), "my faction");
  assert.equal(tokensOn(g.engine, faction(g.engine, P2)), 0);
});

clause(ZIGAL, "0:rule", "only fires for Zigalburgonglgr itself entering: another card entering play asks nothing", () => {
  const g = zigBoard({ zone: "play", extra: [{ key: "newbie", def: character({ name: "Newbie", cost: 0 }), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("newbie"));
  assert.equal(zoneOf(g.engine, g.id("newbie")), "play");
  assert.equal(pending(g.engine), undefined);
  assert.deepEqual(marked(g, ["o0", "mine", "newbie"]), []);
});

clause(ZIGAL, "1:rule", "when it is destroyed, every non-resource card with a token is destroyed (mine and theirs); untokened cards survive", () => {
  const g = zigBoard({
    zone: "play",
    extra: [
      { key: "kill", def: killer(), owner: P1, zone: "hand" },
      { key: "tokEnemy", def: character({ name: "Tok Enemy" }), owner: P2, zone: "play", counters: { token: 1 } },
      { key: "tokItem", def: item({ name: "Tok Item" }), owner: P1, zone: "play", counters: { token: 1 } },
      { key: "tokLoc", def: location({ name: "Tok Loc" }), owner: P2, zone: "play", counters: { token: 2 } }
    ]
  });
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("z")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("z")), "discard");
  for (const k of ["tokEnemy", "tokItem", "tokLoc"]) assert.equal(zoneOf(g.engine, g.id(k)), "discard", `${k} is destroyed`);
  for (const k of ["o0", "mine", "myItem", "loc"]) assert.equal(zoneOf(g.engine, g.id(k)), "play", `${k} (no token) survives`);
});

clause(ZIGAL, "1:rule", "resources with tokens survive (non-resource cards only), face-up or face-down", () => {
  const g = zigBoard({
    zone: "play",
    extra: [
      { key: "kill", def: killer(), owner: P1, zone: "hand" },
      { key: "tokDown", def: character({ name: "Tok Down" }), owner: P2, zone: "play", faceDown: true, counters: { token: 1 } },
      { key: "tokUp", def: resourceCard({ name: "Tok Up" }), owner: P2, zone: "play", counters: { token: 1 } },
      { key: "tokChar", def: character({ name: "Tok Char" }), owner: P2, zone: "play", counters: { token: 1 } }
    ]
  });
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("z")] } });
  assert.equal(zoneOf(g.engine, g.id("tokChar")), "discard", "positive control: tokened character dies");
  assert.equal(zoneOf(g.engine, g.id("tokDown")), "play");
  assert.equal(zoneOf(g.engine, g.id("tokUp")), "play");
});

clause(ZIGAL, "1:rule", "end to end: the tokens it placed come back to destroy those cards when it dies", () => {
  const g = zigBoard({ extra: [{ key: "kill", def: killer(), owner: P1, zone: "hand" }] });
  castZig(g);
  pickMarks(g, ["o0", "o1", "mine"]);
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("z")] } });
  drain(g.engine, declineAll);
  for (const k of ["z", "o0", "o1", "mine"]) assert.equal(zoneOf(g.engine, g.id(k)), "discard", `${k} destroyed`);
  for (const k of ["o2", "myItem", "loc"]) assert.equal(zoneOf(g.engine, g.id(k)), "play", `${k} untouched`);
});

clause(ZIGAL, "1:rule", "does not fire when another card is destroyed", () => {
  const g = zigBoard({
    zone: "play",
    extra: [
      { key: "kill", def: killer(), owner: P1, zone: "hand" },
      { key: "tokEnemy", def: character({ name: "Tok Enemy" }), owner: P2, zone: "play", counters: { token: 1 } }
    ]
  });
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("o0")] } });
  assert.equal(zoneOf(g.engine, g.id("o0")), "discard", "positive control");
  assert.equal(zoneOf(g.engine, g.id("tokEnemy")), "play");
  assert.equal(zoneOf(g.engine, g.id("z")), "play");
});

clause(ZIGAL, "1:rule", "does not fire when it leaves play without being destroyed (returned to hand)", () => {
  const g = zigBoard({
    zone: "play",
    extra: [
      { key: "bounce", def: bouncer(), owner: P1, zone: "hand" },
      { key: "tokEnemy", def: character({ name: "Tok Enemy" }), owner: P2, zone: "play", counters: { token: 1 } }
    ]
  });
  play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("z")] } });
  assert.equal(zoneOf(g.engine, g.id("z")), "hand", "positive control");
  assert.equal(zoneOf(g.engine, g.id("tokEnemy")), "play");
});

// TURN TO MUSH
const mushBoard = (o: { ready?: number; extra?: CardPlacement[] } = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "z", def: printing(ZIGAL), owner: P1, zone: "play" },
      ...bank("rage", o.ready ?? 3, P1),
      { key: "tokFoe", def: character({ name: "Tok Foe" }), owner: P2, zone: "play", counters: { token: 1 } },
      { key: "tokMine", def: character({ name: "Tok Mine" }), owner: P1, zone: "play", counters: { token: 1 } },
      { key: "bare", def: character({ name: "Bare" }), owner: P2, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen" }), owner: P1, zone: "play", controller: P2, counters: { token: 1 } },
      ...(o.extra ?? [])
    ]
  });
const mush = (g: ReturnType<typeof mushBoard>, key: string, player: PlayerId = P1) => activate(g.engine, player, g.id("z"), "zigal-mush", { selected: { m: [g.id(key)] } });

clause(ZIGAL, "2:ability:zigal-mush", "pay 2, pick an opponent's card with a token: it flips face-down (a resource) under its owner", () => {
  const g = mushBoard();
  mush(g, "tokFoe");
  assert.equal(pending(g.engine), undefined);
  assert.equal(readyResources(g.engine, P1), 1, "exactly 2 of 3 paid");
  const c = g.engine.state.cards[g.id("tokFoe")];
  assert.equal(c.faceDown, true);
  assert.equal(c.zone, "play");
  assert.equal(c.controllerId, P2);
  assert.equal(g.engine.isResource(g.id("tokFoe")), true);
});

clause(ZIGAL, "2:ability:zigal-mush", "my own tokened card can be picked too", () => {
  const g = mushBoard();
  mush(g, "tokMine");
  assert.equal(g.engine.state.cards[g.id("tokMine")].faceDown, true);
  assert.equal(g.engine.state.cards[g.id("tokMine")].controllerId, P1);
});

clause(ZIGAL, "2:ability:zigal-mush", "the card flips under its OWNER's control: a card I own but the opponent controls comes back to me", () => {
  const g = mushBoard();
  mush(g, "stolen");
  const c = g.engine.state.cards[g.id("stolen")];
  assert.equal(c.faceDown, true);
  assert.equal(c.controllerId, P1, "owner P1, no longer controlled by P2");
  assert.equal(c.ownerId ?? P1, P1);
});

clause(ZIGAL, "2:ability:zigal-mush", "the pick needs a token: an untokened card is refused", () => {
  const g = mushBoard();
  refused(() => mush(g, "bare"), "no token");
  assert.ok(!g.engine.state.cards[g.id("bare")].faceDown, "!g.engine.state.cards[g.id(\"bare\")].faceDown");
  assert.equal(attachedCount(g.engine, P1), 0, "nothing paid");
  mush(g, "tokFoe");
  assert.equal(g.engine.state.cards[g.id("tokFoe")].faceDown, true, "positive control");
});

clause(ZIGAL, "2:ability:zigal-mush", "the pick can be a tokened resource (any card with a token): it is turned face-down", () => {
  const g = mushBoard({ extra: [{ key: "tokRes", def: resourceCard({ name: "Tok Res" }), owner: P2, zone: "play", counters: { token: 1 } }] });
  mush(g, "tokRes");
  assert.equal(g.engine.state.cards[g.id("tokRes")].faceDown, true);
  assert.equal(readyResources(g.engine, P1), 1);
});

clause(ZIGAL, "2:ability:zigal-mush", "a faction is not pickable even with a token (CR 202.9)", () => {
  const g = mushBoard();
  g.engine.state.cards[faction(g.engine, P2)].counters = { token: 1 };
  refused(() => activate(g.engine, P1, g.id("z"), "zigal-mush", { selected: { m: [faction(g.engine, P2)] } }), "faction");
  assert.equal(attachedCount(g.engine, P1), 0);
});

clause(ZIGAL, "2:ability:zigal-mush", "Pay 2 is a real cost: one resource is refused, three work", () => {
  const g = mushBoard({ ready: 1 });
  refused(() => mush(g, "tokFoe"), "1 < 2");
  assert.ok(!g.engine.state.cards[g.id("tokFoe")].faceDown, "!g.engine.state.cards[g.id(\"tokFoe\")].faceDown");
  assert.equal(attachedCount(g.engine, P1), 0);
  const ok = mushBoard({ ready: 2 });
  mush(ok, "tokFoe");
  assert.equal(readyResources(ok.engine, P1), 0, "exactly 2 spent");
});

clause(ZIGAL, "2:ability:zigal-mush", "it does not deplete: it can be used again for another 2", () => {
  const g = mushBoard({ ready: 4, extra: [{ key: "tokFoe2", def: character({ name: "Tok Foe 2" }), owner: P2, zone: "play", counters: { token: 1 } }] });
  mush(g, "tokFoe");
  mush(g, "tokFoe2");
  assert.equal(g.engine.state.cards[g.id("tokFoe")].faceDown, true);
  assert.equal(g.engine.state.cards[g.id("tokFoe2")].faceDown, true);
  assert.equal(readyResources(g.engine, P1), 0);
});

clause(ZIGAL, "2:ability:zigal-mush", "only its controller can use it", () => {
  const g = mushBoard({ extra: bank("rage", 3, P2) });
  refused(() => mush(g, "tokFoe", P2), "the opponent cannot activate my Zigalburgonglgr");
  assert.ok(!g.engine.state.cards[g.id("tokFoe")].faceDown, "!g.engine.state.cards[g.id(\"tokFoe\")].faceDown");
});

// =============================================================================
// Blitz of Destruction — tactic · warlord · cost 3 · [R] · FLIP UP 4 [R]
// =============================================================================

interface BlitzOpts {
  rage?: number;
  icon?: "rage" | "volition";
  foeDown?: number;
  foeUp?: number;
  myDown?: number;
  zone?: "hand" | "play";
  faceDown?: boolean;
  active?: PlayerId;
  extra?: CardPlacement[];
}
function blitzBoard(o: BlitzOpts = {}) {
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: active === P1 ? 1 : 2,
    activePlayerId: active,
    cards: [
      { key: "blz", def: printing(BLITZ), owner: P1, zone: o.zone ?? "hand", ...(o.zone === "play" ? { faceDown: o.faceDown ?? true } : {}) },
      ...res(o.icon ?? "rage", o.rage ?? 3, P1),
      ...volition(o.myDown ?? 0, P1),
      ...volition(o.foeDown ?? 2, P2).map((p, i) => ({ ...p, key: `fd${i}` })),
      ...bank("greed", o.foeUp ?? 3, P2).map((p, i) => ({ ...p, key: `fu${i}` })),
      ...(o.extra ?? [])
    ]
  });
}
type BlitzGame = ReturnType<typeof blitzBoard>;
const castBlitz = (g: BlitzGame) => play(g.engine, P1, g.id("blz"));

clause(BLITZ, "0:extraCost", "needs a player with MORE resources than me: the opponent has 5 to my 3, so it can be deployed (cost 3 is paid)", () => {
  const g = blitzBoard();
  castBlitz(g);
  assert.equal(readyResources(g.engine, P1), 0, "3 paid");
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget");
});

clause(BLITZ, "0:extraCost", "an opponent with EQUAL resources (3 vs 3) is refused", () => {
  const g = blitzBoard({ foeDown: 1, foeUp: 2 });
  refused(() => castBlitz(g), "equal is not more", /cannot be deployed right now/);
  assert.equal(zoneOf(g.engine, g.id("blz")), "hand");
  assert.equal(attachedCount(g.engine, P1), 0);
});

clause(BLITZ, "0:extraCost", "an opponent with FEWER resources (2 vs 3) is refused", () => {
  const g = blitzBoard({ foeDown: 1, foeUp: 1 });
  refused(() => castBlitz(g), "fewer", /cannot be deployed right now/);
  assert.equal(zoneOf(g.engine, g.id("blz")), "hand");
});

clause(BLITZ, "0:extraCost", "'more' counts one more: 4 vs 3 is enough", () => {
  const g = blitzBoard({ foeDown: 1, foeUp: 3 });
  castBlitz(g);
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget");
});

clause(BLITZ, "0:extraCost", "my own resources count in the comparison, face-down ones too (3 + 2 face-down = 5 vs 5 is refused)", () => {
  const g = blitzBoard({ myDown: 2, foeDown: 2, foeUp: 3 });
  refused(() => castBlitz(g), "5 vs 5", /cannot be deployed right now/);
  const ok = blitzBoard({ myDown: 2, foeDown: 2, foeUp: 4 });
  castBlitz(ok);
  assert.equal(pending(ok.engine)?.kind, "chooserSelectsTarget", "6 vs 5 works");
});

clause(BLITZ, "0:extraCost", "face-up resources count for the opponent too (all 4 face-up vs my 3)", () => {
  const g = blitzBoard({ foeDown: 0, foeUp: 4 });
  castBlitz(g);
  assert.equal(readyResources(g.engine, P1), 0);
  assert.equal(g.engine.state.cards[g.id("fu0")].zone, "play", "no face-down resource to destroy");
});

clause(BLITZ, "0:extraCost", "the threshold is a single [R]: one rage plus two other resources is enough", () => {
  const g = blitzBoard({ rage: 1, myDown: 2, foeDown: 2, foeUp: 3 });
  castBlitz(g);
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget");
  assert.equal(readyResources(g.engine, P1), 0);
});

clause(BLITZ, "0:extraCost", "the printed cost 3 and [R] threshold apply: 2 resources or no [R] is refused", () => {
  const short = blitzBoard({ rage: 2 });
  refused(() => castBlitz(short), "cost 3");
  const noRage = blitzBoard({ icon: "volition" });
  refused(() => castBlitz(noRage), "needs [R]");
  assert.equal(zoneOf(noRage.engine, noRage.id("blz")), "hand");
});

clause(BLITZ, "1:rule", "the picked player (the opponent) chooses the face-down resource to destroy, not me", () => {
  const g = blitzBoard();
  castBlitz(g);
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P2, "they choose");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("fd1")] });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("fd1")), "discard", "destroyed to the owner's discard");
  assert.equal(zoneOf(g.engine, g.id("fd0")), "play", "exactly one destroyed");
});

clause(BLITZ, "1:rule", "it must be a face-down resource: their face-up resources are refused", () => {
  const g = blitzBoard();
  castBlitz(g);
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("fu0")] }), "face-up resource");
  assert.equal(zoneOf(g.engine, g.id("fu0")), "play");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("fd0")] });
  assert.equal(zoneOf(g.engine, g.id("fd0")), "discard", "positive control");
});

clause(BLITZ, "1:rule", "it must be a resource THEY control: my own face-down resource is refused", () => {
  const g = blitzBoard({ myDown: 1, foeDown: 2, foeUp: 3 });
  castBlitz(g);
  const mineDown = g.engine.state.players[P1].play.find(c => g.engine.isResource(c) && g.engine.state.cards[c].faceDown)!;
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [mineDown] }), "my own resource");
  assert.equal(zoneOf(g.engine, mineDown), "play");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("fd0")] });
  assert.equal(zoneOf(g.engine, g.id("fd0")), "discard");
});

clause(BLITZ, "1:rule", "their face-down non-resource-card characters are not 'resources': a face-up character is not pickable", () => {
  const g = blitzBoard({ extra: [{ key: "foeChar", def: character({ name: "Foe Char" }), owner: P2, zone: "play" }] });
  castBlitz(g);
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("foeChar")] }), "a character in play");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("fd0")] });
  assert.equal(zoneOf(g.engine, g.id("foeChar")), "play");
});

clause(BLITZ, "1:rule", "they must destroy one: declining to pick is not allowed while they have a face-down resource", () => {
  const g = blitzBoard();
  castBlitz(g);
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [] }), "must pick one");
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget");
  assert.equal(zoneOf(g.engine, g.id("fd0")) === "play" && zoneOf(g.engine, g.id("fd1")) === "play", true);
});

// FLIP UP: 4 [R]
const flipBlitzBoard = (o: BlitzOpts = {}) => blitzBoard({ zone: "play", faceDown: true, rage: 4, foeDown: 2, foeUp: 4, ...o });

clause(BLITZ, "2:flipUp", "FLIP UP with four [R] resources against a bigger opponent flips it up and runs its effect", () => {
  const g = flipBlitzBoard();
  assert.equal(g.engine.state.cards[g.id("blz")].faceDown, true);
  flipUpAction(g.engine, P1, g.id("blz"));
  resolvePendingResponses(g.engine);
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P2, "the opponent destroys one of their face-down resources");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("fd0")] });
  assert.equal(zoneOf(g.engine, g.id("fd0")), "discard");
  assert.equal(zoneOf(g.engine, g.id("fd1")), "play");
  assert.notEqual(zoneOf(g.engine, g.id("blz")), "hand");
  assert.ok(!g.engine.state.cards[g.id("blz")].faceDown, "it is no longer a face-down resource");
});

clause(BLITZ, "2:flipUp", "FLIP UP is refused with too few resources (two other resources)", () => {
  const g = flipBlitzBoard({ rage: 2 });
  refused(() => flipUpAction(g.engine, P1, g.id("blz")), "cost 4");
  assert.equal(g.engine.state.cards[g.id("blz")].faceDown, true);
  const ok = flipBlitzBoard();
  flipUpAction(ok.engine, P1, ok.id("blz"));
  assert.equal(pending(ok.engine)?.kind, "chooserSelectsTarget", "positive control");
});

clause(BLITZ, "2:flipUp", "FLIP UP needs [R]: five non-[R] resources are refused", () => {
  // the opponent has 8 resources to my 5 + the face-down Blitz = 6, so the extra cost is satisfied and only the threshold can refuse
  const g = flipBlitzBoard({ icon: "volition", rage: 5, foeUp: 6 });
  refused(() => flipUpAction(g.engine, P1, g.id("blz")), "needs [R]", /cannot be flipped up|threshold/);
  assert.equal(g.engine.state.cards[g.id("blz")].faceDown, true);
  assert.equal(attachedCount(g.engine, P1), 0);
  const ok = flipBlitzBoard({ icon: "rage", rage: 5, foeUp: 6 });
  flipUpAction(ok.engine, P1, ok.id("blz"));
  assert.equal(pending(ok.engine)?.kind, "chooserSelectsTarget", "positive control: same board with [R] resources flips up");
});

clause(BLITZ, "2:flipUp", "the FLIP UP threshold is a single [R]: one rage plus three other resources is enough", () => {
  const g = flipBlitzBoard({ rage: 1, myDown: 3, foeUp: 6 });
  flipUpAction(g.engine, P1, g.id("blz"));
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget");
  assert.ok(!g.engine.state.cards[g.id("blz")].faceDown, "flipped up with just one [R]");
});

clause(BLITZ, "1:rule", "a face-down card in play is a resource: a face-down character of theirs is a legal pick (the selector's type is redundant with faceDown)", () => {
  const g = blitzBoard({ foeDown: 0, foeUp: 3, extra: [{ key: "fdChar", def: character({ name: "Down Char" }), owner: P2, zone: "play", faceDown: true }] });
  castBlitz(g);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("fdChar")] });
  assert.equal(zoneOf(g.engine, g.id("fdChar")), "discard");
});

clause(BLITZ, "2:flipUp", "the extra cost still applies to FLIP UP: an opponent without more resources is refused", () => {
  const g = flipBlitzBoard({ foeDown: 2, foeUp: 2 });
  refused(() => flipUpAction(g.engine, P1, g.id("blz")), "4 vs 4", /cannot be flipped up right now/);
  assert.equal(g.engine.state.cards[g.id("blz")].faceDown, true);
});

clause(BLITZ, "2:flipUp", "FLIP UP spends about 4 resources (not its printed 3, not 5) when more are available", () => {
  const g = flipBlitzBoard({ rage: 6, foeUp: 6 });
  flipUpAction(g.engine, P1, g.id("blz"));
  const left = readyResources(g.engine, P1);
  // 6 other resources minus 4 paid leaves 2; if Blitz itself helped pay (CR 507.4b) 3 are left.
  assert.ok(left === 2 || left === 3, `4 paid (2 left, or 3 if it paid for itself), got ${left}`);
});

clause(BLITZ, "2:flipUp", "a tactic can be flipped up in the opponent's response window (it could be deployed there)", () => {
  const g = flipBlitzBoard({
    active: P2,
    foeDown: 2,
    foeUp: 4,
    extra: [{ key: "atk", def: character({ name: "Atk", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  flipUpAction(g.engine, P1, g.id("blz"));
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget");
  assert.ok(!g.engine.state.cards[g.id("blz")].faceDown, "!g.engine.state.cards[g.id(\"blz\")].faceDown");
});
