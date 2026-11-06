// Clause tests — batch ungodly-mess-10, part p2 (groups 7-14). Expectations come from each
// card's PRINTED text and RULES.md; engine data is only used to drive the engine.

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
  tactic,
  volition,
  P1,
  P2
} from "../per-card/_harness.js";
import { clause, clauseMismatch, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { answerPending } from "./_board.js";
import { fight } from "./_battle.js";
import { endTurn, spentResources } from "./_turn.js";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- shared helpers (this file only) ---------------------------------------

const zoneOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].zone;
const ready = (engine: SpoilsEngine, player: PlayerId) => engine.getAvailableResourceCount(player);
const toks = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].counters.token ?? 0;
const dmg = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].damage ?? 0;
const ctl = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].controllerId;
const pend = (engine: SpoilsEngine) => engine.state.pendingChoice as unknown as PendingChoiceLike | undefined;
const handOf = (engine: SpoilsEngine, p: PlayerId) => engine.state.players[p].hand;
const deckOf = (engine: SpoilsEngine, p: PlayerId) => engine.state.players[p].deck;
const sorted = (xs: string[]) => [...xs].sort();

type Icon = "rage" | "greed" | "deception" | "elitism" | "obsession";
/** `n` already-spent (attached) resources of `icon`: they count toward thresholds but cannot pay. */
const spent = (icon: Icon, n: number, owner: PlayerId = P1): CardPlacement[] =>
  bank(icon, n, owner).map((p) => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

const cards = (prefix: string, n: number, owner: PlayerId, zone: "hand" | "deck" | "discard"): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: character({ name: `${prefix.toUpperCase()}${i}` }), owner, zone }));

/** Answers a chooserSelectsTarget with `ids`. */
const chooseWith = (ids: CardInstanceId[]) => (pc: PendingChoiceLike): unknown =>
  pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: ids } : declineAll(pc);

const killer = (name = "Killer") =>
  tactic({
    name,
    behavior: {
      abilities: [
        { id: "body", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }
      ]
    }
  } as never);
const hurter = (amount: number, name = "Hurter") =>
  tactic({
    name,
    behavior: {
      abilities: [
        { id: "body", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }] }
      ]
    }
  } as never);
const bouncer = (name = "Bouncer") =>
  tactic({
    name,
    behavior: {
      abilities: [
        { id: "body", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }
      ]
    }
  } as never);

const flipUpAction = (engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}) =>
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });

// ===========================================================================
// Unwise Encirclement — tactic, warlord, cost 1, [R][R]
// EXTRA COST: Pick a character. -- Put a token on the character. If you deployed this card using FLIP UP,
// put 4 more tokens on the character. Inflict damage to the character equal to the number of tokens on it.
// FLIP UP: 5 [R]
// ===========================================================================

const UE = "4a2644f2-727c-4db8-b3dc-800a0efc82a2";

function ueBoard(extra: CardPlacement[] = [], opts: { faceDown?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      opts.faceDown
        ? { key: "ue", def: printing(UE), owner: P1, zone: "play", faceDown: true }
        : { key: "ue", def: printing(UE), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", life: 9 }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Theirs", life: 9 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play" },
      { key: "inhand", def: character({ name: "InHand", life: 9 }), owner: P2, zone: "hand" },
      ...extra
    ]
  });
}
type UeGame = ReturnType<typeof ueBoard>;
const ueTarget = (g: UeGame, key: string) => ({ c: [g.id(key)] });

clause(UE, "0:extraCost", "printed card: tactic, Warlord, cost 1, threshold [R][R]", () => {
  const def = printing(UE);
  assert.equal(def.type, "tactic");
  assert.equal(def.trade, "warlord");
  assert.equal(def.cost, 1);
  assert.equal(def.threshold, "rr");
});

clause(UE, "0:extraCost", "deploys for exactly 1 resource once [R][R] is shown: 1 ready plus 2 spent Rage leaves nothing ready", () => {
  const g = ueBoard([...spent("rage", 2), ...bank("greed", 1)]);
  play(g.engine, P1, g.id("ue"), { selected: ueTarget(g, "theirs") });
  assert.equal(zoneOf(g.engine, g.id("ue")), "discard");
  assert.equal(ready(g.engine, P1), 0, "exactly 1 was paid");
});

clause(UE, "0:extraCost", "is refused with no ready resource (only the 2 spent Rage) — one short of the cost of 1", () => {
  const g = ueBoard([...spent("rage", 2)]);
  refused(() => play(g.engine, P1, g.id("ue"), { selected: ueTarget(g, "theirs") }), "cost 1 unaffordable");
  assert.equal(zoneOf(g.engine, g.id("ue")), "hand");
  assert.equal(toks(g.engine, g.id("theirs")), 0);
});

clause(UE, "0:extraCost", "is refused one icon short of [R][R]: 1 Rage + 1 Greed cannot", () => {
  const g = ueBoard([...bank("rage", 1), ...bank("greed", 1)]);
  refused(() => play(g.engine, P1, g.id("ue"), { selected: ueTarget(g, "theirs") }), "threshold [R][R] not met");
  assert.equal(zoneOf(g.engine, g.id("ue")), "hand");
  assert.equal(ready(g.engine, P1), 2, "nothing paid");
});

clause(UE, "0:extraCost", "is refused with enough resources but no Rage at all", () => {
  const g = ueBoard([...bank("greed", 3)]);
  refused(() => play(g.engine, P1, g.id("ue"), { selected: ueTarget(g, "theirs") }), "no Rage");
  assert.equal(zoneOf(g.engine, g.id("ue")), "hand");
});

clause(UE, "0:extraCost", "is deployable with 2 ready Rage (one spare resource)", () => {
  const g = ueBoard([...bank("rage", 2)]);
  play(g.engine, P1, g.id("ue"), { selected: ueTarget(g, "theirs") });
  assert.equal(zoneOf(g.engine, g.id("ue")), "discard");
  assert.equal(ready(g.engine, P1), 1, "cost 1 paid, one Rage left");
});

clause(UE, "0:extraCost", "the character is picked as an extra cost: playing with no pick is refused and pays nothing", () => {
  const g = ueBoard([...bank("rage", 3)]);
  refused(() => play(g.engine, P1, g.id("ue"), { selected: {} }), "needs a character pick");
  assert.equal(zoneOf(g.engine, g.id("ue")), "hand");
  assert.equal(ready(g.engine, P1), 3);
  play(g.engine, P1, g.id("ue"), { selected: ueTarget(g, "theirs") });
  assert.equal(zoneOf(g.engine, g.id("ue")), "discard", "positive control");
});

clause(UE, "0:extraCost", "any character can be picked: your own and the opponent's", () => {
  const a = ueBoard([...bank("rage", 3)]);
  play(a.engine, P1, a.id("ue"), { selected: ueTarget(a, "mine") });
  assert.equal(toks(a.engine, a.id("mine")), 1);
  const b = ueBoard([...bank("rage", 3)]);
  play(b.engine, P1, b.id("ue"), { selected: ueTarget(b, "theirs") });
  assert.equal(toks(b.engine, b.id("theirs")), 1);
});

clause(UE, "0:extraCost", "a non-character (item), a character not in play, and a faction cannot be picked", () => {
  const g = ueBoard([...bank("rage", 3)]);
  refused(() => play(g.engine, P1, g.id("ue"), { selected: ueTarget(g, "gear") }), "item is not a character");
  refused(() => play(g.engine, P1, g.id("ue"), { selected: ueTarget(g, "inhand") }), "character in hand is not in play");
  refused(() => play(g.engine, P1, g.id("ue"), { selected: { c: [g.engine.state.players[P2].factionId!] } }), "faction is not a character");
  assert.equal(zoneOf(g.engine, g.id("ue")), "hand");
  assert.equal(ready(g.engine, P1), 3);
  assert.equal(toks(g.engine, g.id("gear")), 0);
});

clause(UE, "1:rule", "a normal deploy puts exactly 1 token on the character and inflicts 1 damage; others are untouched", () => {
  const g = ueBoard([...bank("rage", 2)]);
  play(g.engine, P1, g.id("ue"), { selected: ueTarget(g, "theirs") });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(toks(g.engine, g.id("theirs")), 1);
  assert.equal(dmg(g.engine, g.id("theirs")), 1);
  assert.equal(zoneOf(g.engine, g.id("theirs")), "play");
  assert.equal(toks(g.engine, g.id("mine")), 0);
  assert.equal(dmg(g.engine, g.id("mine")), 0);
});

clause(UE, "1:rule", "damage equals ALL the tokens on the character: 2 existing tokens become 3 tokens and 3 damage", () => {
  const g = ueBoard([...bank("rage", 2), { key: "marked", def: character({ name: "Marked", life: 9 }), owner: P2, zone: "play", counters: { token: 2 } }]);
  play(g.engine, P1, g.id("ue"), { selected: ueTarget(g, "marked") });
  assert.equal(toks(g.engine, g.id("marked")), 3);
  assert.equal(dmg(g.engine, g.id("marked")), 3);
});

clause(UE, "1:rule", "damage is added to damage the character already has", () => {
  const g = ueBoard([...bank("rage", 2), { key: "hurt", def: character({ name: "Hurt", life: 9 }), owner: P2, zone: "play", damage: 2 }]);
  play(g.engine, P1, g.id("ue"), { selected: ueTarget(g, "hurt") });
  assert.equal(toks(g.engine, g.id("hurt")), 1);
  assert.equal(dmg(g.engine, g.id("hurt")), 3);
});

clause(UE, "1:rule", "a character whose life the damage reaches is destroyed (life 1, 1 token = 1 damage)", () => {
  const g = ueBoard([...bank("rage", 2), { key: "frail", def: character({ name: "Frail", life: 1 }), owner: P2, zone: "play" }]);
  play(g.engine, P1, g.id("ue"), { selected: ueTarget(g, "frail") });
  assert.equal(zoneOf(g.engine, g.id("frail")), "discard");
});

clause(UE, "1:rule", "a normal deploy does NOT add the 4 extra tokens: life 2 survives... no, 1 damage on life 2 leaves it alive", () => {
  const g = ueBoard([...bank("rage", 2), { key: "tough", def: character({ name: "Tough", life: 2 }), owner: P2, zone: "play" }]);
  play(g.engine, P1, g.id("ue"), { selected: ueTarget(g, "tough") });
  assert.equal(zoneOf(g.engine, g.id("tough")), "play");
  assert.equal(toks(g.engine, g.id("tough")), 1);
  assert.equal(dmg(g.engine, g.id("tough")), 1);
});

clause(UE, "1:rule", "deployed using FLIP UP: 1 + 4 = 5 tokens and 5 damage", () => {
  const g = ueBoard([...bank("rage", 5)], { faceDown: true });
  flipUpAction(g.engine, P1, g.id("ue"), ueTarget(g, "theirs"));
  assert.equal(toks(g.engine, g.id("theirs")), 5);
  assert.equal(dmg(g.engine, g.id("theirs")), 5);
  assert.equal(zoneOf(g.engine, g.id("theirs")), "play");
  assert.equal(toks(g.engine, g.id("mine")), 0);
});

clause(UE, "1:rule", "FLIP UP with 2 existing tokens: 2 + 1 + 4 = 7 tokens and 7 damage", () => {
  const g = ueBoard([...bank("rage", 5), { key: "marked", def: character({ name: "Marked", life: 9 }), owner: P2, zone: "play", counters: { token: 2 } }], { faceDown: true });
  flipUpAction(g.engine, P1, g.id("ue"), ueTarget(g, "marked"));
  assert.equal(toks(g.engine, g.id("marked")), 7);
  assert.equal(dmg(g.engine, g.id("marked")), 7);
});

clause(UE, "1:rule", "FLIP UP on your own character works the same (5 tokens)", () => {
  const g = ueBoard([...bank("rage", 5)], { faceDown: true });
  flipUpAction(g.engine, P1, g.id("ue"), ueTarget(g, "mine"));
  assert.equal(toks(g.engine, g.id("mine")), 5);
  assert.equal(dmg(g.engine, g.id("mine")), 5);
});

clause(UE, "1:rule", "FLIP UP lethal: 5 damage destroys a life-5 character", () => {
  const g = ueBoard([...bank("rage", 5), { key: "five", def: character({ name: "Five", life: 5 }), owner: P2, zone: "play" }], { faceDown: true });
  flipUpAction(g.engine, P1, g.id("ue"), ueTarget(g, "five"));
  assert.equal(zoneOf(g.engine, g.id("five")), "discard");
});

clause(UE, "1:rule", "after resolving, the tactic goes to the discard pile (deployed either way)", () => {
  const g = ueBoard([...bank("rage", 5)], { faceDown: true });
  flipUpAction(g.engine, P1, g.id("ue"), ueTarget(g, "theirs"));
  assert.equal(zoneOf(g.engine, g.id("ue")), "discard");
});

clause(UE, "2:flipUp", "costs exactly 5: 5 Rage banks plus the face-down card flips it up, 4 other banks plus itself too (CR 507.4b)", () => {
  const g = ueBoard([...bank("rage", 4)], { faceDown: true });
  flipUpAction(g.engine, P1, g.id("ue"), ueTarget(g, "theirs"));
  assert.equal(zoneOf(g.engine, g.id("ue")), "discard");
  assert.equal(toks(g.engine, g.id("theirs")), 5);
  assert.equal(ready(g.engine, P1), 0, "all 5 resources used");
});

clause(UE, "2:flipUp", "with spare resources the cost is still 5 (not the printed 1): 6 Rage banks leave 1 or 2 depending on which paid", () => {
  const g = ueBoard([...bank("rage", 6)], { faceDown: true });
  const before = ready(g.engine, P1);
  assert.equal(before, 7);
  flipUpAction(g.engine, P1, g.id("ue"), ueTarget(g, "theirs"));
  const after = ready(g.engine, P1);
  assert.ok(after === 1 || after === 2, `7 resources, 5 paid, the card itself stops being a resource: ${after}`);
  assert.equal(toks(g.engine, g.id("theirs")), 5);
});

clause(UE, "2:flipUp", "is refused one short: 3 banks plus the card itself is only 4 resources", () => {
  const g = ueBoard([...bank("rage", 3)], { faceDown: true });
  refused(() => flipUpAction(g.engine, P1, g.id("ue"), ueTarget(g, "theirs")), "FLIP UP costs 5");
  assert.equal(g.engine.state.cards[g.id("ue")].faceDown, true);
  assert.equal(zoneOf(g.engine, g.id("ue")), "play");
  assert.equal(ready(g.engine, P1), 4);
  assert.equal(toks(g.engine, g.id("theirs")), 0);
});

clause(UE, "2:flipUp", "needs [R]: 6 Greed resources are enough resources but not the threshold", () => {
  const g = ueBoard([...bank("greed", 6)], { faceDown: true });
  refused(() => flipUpAction(g.engine, P1, g.id("ue"), ueTarget(g, "theirs")), "no [R]");
  assert.equal(g.engine.state.cards[g.id("ue")].faceDown, true);
  assert.equal(ready(g.engine, P1), 7);
});

clause(UE, "2:flipUp", "a single [R] is enough for the threshold (5 Greed + 1 Rage)", () => {
  const g = ueBoard([...bank("greed", 5), ...bank("rage", 1)], { faceDown: true });
  flipUpAction(g.engine, P1, g.id("ue"), ueTarget(g, "theirs"));
  assert.equal(zoneOf(g.engine, g.id("ue")), "discard");
  assert.equal(toks(g.engine, g.id("theirs")), 5);
});

clause(UE, "2:flipUp", "a spent Rage counts toward the threshold even though it cannot pay (5 ready Greed + 1 spent Rage)", () => {
  const g = ueBoard([...bank("greed", 5), ...spent("rage", 1)], { faceDown: true });
  flipUpAction(g.engine, P1, g.id("ue"), ueTarget(g, "theirs"));
  assert.equal(zoneOf(g.engine, g.id("ue")), "discard");
});

clause(UE, "2:flipUp", "the EXTRA COST still applies to FLIP UP: no pick, an item, a hand card and a faction are all refused", () => {
  const g = ueBoard([...bank("rage", 5)], { faceDown: true });
  refused(() => flipUpAction(g.engine, P1, g.id("ue"), {}), "needs a pick");
  refused(() => flipUpAction(g.engine, P1, g.id("ue"), ueTarget(g, "gear")), "item");
  refused(() => flipUpAction(g.engine, P1, g.id("ue"), ueTarget(g, "inhand")), "not in play");
  refused(() => flipUpAction(g.engine, P1, g.id("ue"), { c: [g.engine.state.players[P2].factionId!] }), "faction");
  assert.equal(g.engine.state.cards[g.id("ue")].faceDown, true);
  assert.equal(ready(g.engine, P1), 6, "nothing paid");
  flipUpAction(g.engine, P1, g.id("ue"), ueTarget(g, "theirs"));
  assert.equal(zoneOf(g.engine, g.id("ue")), "discard", "positive control");
});

// ===========================================================================
// Vexillarius Dacian-Draco — character, warlord, vexillarius/seraphim/dragon, cost 6, [R][R][R][R], 6/4/4
// UNIQUE VEXILLARIUS -- All your other characters gain 2 strength and 2 life.
// -- When this card is destroyed, all characters lose 2 strength and 2 life this turn.
// ===========================================================================

const VDD = "a43f20a7-ece5-477b-a791-2ff02689bcb2";

function vddBoard(extra: CardPlacement[] = [], vddZone: "hand" | "play" = "play") {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "vdd", def: printing(VDD), owner: P1, zone: vddZone },
      { key: "ally", def: character({ name: "Ally", strength: 3, speed: 3, life: 5 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 3, speed: 3, life: 5 }), owner: P2, zone: "play" },
      ...extra
    ]
  });
}
type VddGame = ReturnType<typeof vddBoard>;
const stats = (g: VddGame, key: string) => [g.engine.getStat(g.id(key), "strength"), g.engine.getStat(g.id(key), "speed"), g.engine.getStat(g.id(key), "life")];

clause(VDD, "0:unique", "printed card: character, Warlord, subtypes vexillarius/seraphim/dragon, cost 6, [R][R][R][R], 6 strength / 4 speed / 4 life", () => {
  const def = printing(VDD);
  assert.equal(def.type, "character");
  assert.equal(def.trade, "warlord");
  assert.deepEqual([...def.subtype], ["vexillarius", "seraphim", "dragon"]);
  assert.equal(def.cost, 6);
  assert.equal(def.threshold, "rrrr");
  const g = vddBoard();
  assert.deepEqual(stats(g, "vdd"), [6, 4, 4], "no bonus on itself");
});

clause(VDD, "0:unique", "deploys for exactly 6 with [R][R][R][R]; refused with 5 and with 6 resources holding only 3 Rage", () => {
  const ok = vddBoard([...bank("rage", 6)], "hand");
  play(ok.engine, P1, ok.id("vdd"));
  assert.equal(zoneOf(ok.engine, ok.id("vdd")), "play");
  assert.equal(ready(ok.engine, P1), 0, "exactly 6 paid");
  const short = vddBoard([...bank("rage", 5)], "hand");
  refused(() => play(short.engine, P1, short.id("vdd")), "cost 6");
  assert.equal(zoneOf(short.engine, short.id("vdd")), "hand");
  const noThr = vddBoard([...bank("rage", 3), ...bank("greed", 3)], "hand");
  refused(() => play(noThr.engine, P1, noThr.id("vdd")), "only [R][R][R]");
  assert.equal(zoneOf(noThr.engine, noThr.id("vdd")), "hand");
  assert.equal(ready(noThr.engine, P1), 6);
});

clause(VDD, "0:unique", "a second copy under your control makes you choose one to keep: keeping the new one destroys the old one", () => {
  const g = vddBoard([{ key: "vdd2", def: printing(VDD), owner: P1, zone: "hand" }, ...bank("rage", 6)]);
  play(g.engine, P1, g.id("vdd2"));
  const pc = pend(g.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual(sorted(pc.candidates), sorted([g.id("vdd"), g.id("vdd2")]));
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("vdd2") } } as never);
  assert.equal(zoneOf(g.engine, g.id("vdd2")), "play");
  assert.equal(zoneOf(g.engine, g.id("vdd")), "discard");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(VDD, "0:unique", "keeping the old copy destroys the new one", () => {
  const g = vddBoard([{ key: "vdd2", def: printing(VDD), owner: P1, zone: "hand" }, ...bank("rage", 6)]);
  play(g.engine, P1, g.id("vdd2"));
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("vdd") } } as never);
  assert.equal(zoneOf(g.engine, g.id("vdd")), "play");
  assert.equal(zoneOf(g.engine, g.id("vdd2")), "discard");
});

clause(VDD, "0:unique", "UNIQUE is per player: the opponent may control their own copy with no choice and no destruction", () => {
  const g = vddBoard([{ key: "theirs", def: printing(VDD), owner: P2, zone: "play" }]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("vdd")), "play");
  assert.equal(zoneOf(g.engine, g.id("theirs")), "play");
  const h = vddBoard([{ key: "theirs", def: printing(VDD), owner: P2, zone: "play" }, ...bank("rage", 6)], "hand");
  play(h.engine, P1, h.id("vdd"));
  assert.equal(h.engine.state.pendingChoice, undefined, "no survivor prompt when only the opponent has the other copy");
  assert.equal(zoneOf(h.engine, h.id("vdd")), "play");
  assert.equal(zoneOf(h.engine, h.id("theirs")), "play");
});

clause(VDD, "1:rule", "all your OTHER characters gain exactly +2 strength and +2 life (speed unchanged)", () => {
  const g = vddBoard();
  assert.deepEqual(stats(g, "ally"), [5, 3, 7]);
});

clause(VDD, "1:rule", "it does not buff itself, and the opponent's characters are not buffed", () => {
  const g = vddBoard();
  assert.deepEqual(stats(g, "vdd"), [6, 4, 4]);
  assert.deepEqual(stats(g, "foe"), [3, 3, 5]);
});

clause(VDD, "1:rule", "every one of your other characters is buffed, and a second one entering later is too", () => {
  const g = vddBoard([
    { key: "ally2", def: character({ name: "Ally2", strength: 1, speed: 1, life: 3 }), owner: P1, zone: "play" },
    { key: "late", def: character({ name: "Late", strength: 1, speed: 1, life: 3 }), owner: P1, zone: "hand" }
  ]);
  assert.deepEqual(stats(g, "ally2"), [3, 1, 5]);
  play(g.engine, P1, g.id("late"));
  assert.deepEqual(stats(g, "late"), [3, 1, 5]);
});

clause(VDD, "1:rule", "only characters are buffed: an item with no stats is not given any", () => {
  const g = vddBoard([{ key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" }]);
  assert.deepEqual(stats(g, "ally"), [5, 3, 7]);
  assert.equal(g.engine.getStat(g.id("gear"), "strength") ?? 0, 0);
});

clause(VDD, "1:rule", "the buff is on only while it is in play: in hand it gives nothing", () => {
  const g = vddBoard([], "hand");
  assert.deepEqual(stats(g, "ally"), [3, 3, 5]);
});

clause(VDD, "1:rule", "the buff ends when it leaves play without being destroyed (returned to hand) and nothing else happens", () => {
  const g = vddBoard([{ key: "bounce", def: bouncer(), owner: P1, zone: "hand" }]);
  assert.deepEqual(stats(g, "ally"), [5, 3, 7]);
  play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("vdd")] } });
  assert.equal(zoneOf(g.engine, g.id("vdd")), "hand");
  assert.deepEqual(stats(g, "ally"), [3, 3, 5], "buff gone");
  assert.deepEqual(stats(g, "foe"), [3, 3, 5], "no destruction rider: nobody lost anything");
});

clause(VDD, "2:rule", "when destroyed, all characters lose 2 strength and 2 life this turn: yours (its buff gone too) and the opponent's", () => {
  const g = vddBoard([{ key: "kill", def: killer(), owner: P1, zone: "hand" }]);
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("vdd")] } });
  assert.equal(zoneOf(g.engine, g.id("vdd")), "discard");
  assert.deepEqual(stats(g, "ally"), [1, 3, 3], "base 3/5 minus 2/2 (the +2/+2 aura left with it)");
  assert.deepEqual(stats(g, "foe"), [1, 3, 3], "the opponent's characters too");
});

clause(VDD, "2:rule", "the loss lasts this turn only: gone at the start of the next turn", () => {
  const g = vddBoard([{ key: "kill", def: killer(), owner: P1, zone: "hand" }]);
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("vdd")] } });
  assert.deepEqual(stats(g, "foe"), [1, 3, 3], "still reduced later this turn");
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.deepEqual(stats(g, "foe"), [3, 3, 5]);
  assert.deepEqual(stats(g, "ally"), [3, 3, 5]);
});

clause(VDD, "2:rule", "it applies to characters in play when it resolves: one entering later this turn is not reduced", () => {
  const g = vddBoard([
    { key: "kill", def: killer(), owner: P1, zone: "hand" },
    { key: "late", def: character({ name: "Late", strength: 1, speed: 1, life: 3 }), owner: P1, zone: "hand" }
  ]);
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("vdd")] } });
  play(g.engine, P1, g.id("late"));
  assert.deepEqual(stats(g, "late"), [1, 1, 3]);
});

clause(VDD, "2:rule", "the opponent destroying it triggers the same loss for everybody", () => {
  const g = vddBoard([{ key: "kill", def: killer(), owner: P1, zone: "hand" }, { key: "theirVdd", def: printing(VDD), owner: P2, zone: "play" }]);
  assert.deepEqual(stats(g, "foe"), [5, 3, 7], "the opponent's own Vexillarius buffs their characters");
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("theirVdd")] } });
  assert.equal(zoneOf(g.engine, g.id("theirVdd")), "discard");
  assert.deepEqual(stats(g, "foe"), [1, 3, 3]);
  assert.deepEqual(stats(g, "ally"), [3, 3, 5], "your characters lose 2/2 as well (your own buff stays)");
});

clause(VDD, "2:rule", "destroying some OTHER card does not trigger it", () => {
  const g = vddBoard([{ key: "kill", def: killer(), owner: P1, zone: "hand" }]);
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("foe")] } });
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard");
  assert.deepEqual(stats(g, "ally"), [5, 3, 7], "nothing lost");
  assert.equal(zoneOf(g.engine, g.id("vdd")), "play");
});

// ===========================================================================
// Zigalburgonglgr, the Stolen God — character, universal, god, cost 8, [V]x6, 6/1/6
// ETB: you may put a token on up to X non-resource cards (X = number of [V] you control).
// When destroyed: destroy all non-resource cards with tokens on them.
// TURN TO MUSH -- Pay 2. Pick a card with a token on it. -- Flip the card face-down under its owner's control.
// ===========================================================================

const ZIG = "88e58247-0bb3-481f-97ce-724f786d1980";

function zigBoard(extra: CardPlacement[] = [], opts: { zone?: "hand" | "play"; cands?: number } = {}) {
  const cand: CardPlacement[] = Array.from({ length: opts.cands ?? 0 }, (_, i) => ({
    key: `c${i}`,
    def: character({ name: `C${i}`, life: 9 }),
    owner: i % 2 === 0 ? P1 : P2,
    zone: "play" as const
  }));
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "zig", def: printing(ZIG), owner: P1, zone: opts.zone ?? "play" }, ...cand, ...extra]
  });
}
type ZigGame = ReturnType<typeof zigBoard>;
const cIds = (g: ZigGame, n: number) => Array.from({ length: n }, (_, i) => g.id(`c${i}`));
const pickEtb = (g: ZigGame, ids: CardInstanceId[]) => {
  const pc = pend(g.engine);
  assert.ok(pc, "the ETB pick is open");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "the controller picks");
  answerPending(g.engine, "chooserSelectsTarget", { selected: ids });
  assert.equal(g.engine.state.pendingChoice, undefined);
};
const submitPick = (g: ZigGame, ids: CardInstanceId[]) =>
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: ids } } as never);

clause(ZIG, "0:rule", "printed card: character, universal, subtype god, cost 8, six [V], 6 strength / 1 speed / 6 life", () => {
  const def = printing(ZIG);
  assert.equal(def.type, "character");
  assert.equal(def.trade, "universal");
  assert.deepEqual([...def.subtype], ["god"]);
  assert.equal(def.cost, 8);
  assert.equal(def.threshold, "vvvvvv");
  const g = zigBoard();
  assert.deepEqual([g.engine.getStat(g.id("zig"), "strength"), g.engine.getStat(g.id("zig"), "speed"), g.engine.getStat(g.id("zig"), "life")], [6, 1, 6]);
});

clause(ZIG, "0:rule", "deploys for exactly 8 resources with six [V]: 8 Volition works", () => {
  const g = zigBoard([...volition(8)], { zone: "hand" });
  play(g.engine, P1, g.id("zig"));
  assert.equal(zoneOf(g.engine, g.id("zig")), "play");
  assert.equal(ready(g.engine, P1), 0, "exactly 8 paid");
  pickEtb(g, []);
});

clause(ZIG, "0:rule", "is refused one resource short (7 Volition) and one icon short (5 Volition + 3 Rage)", () => {
  const a = zigBoard([...volition(7)], { zone: "hand" });
  refused(() => play(a.engine, P1, a.id("zig")), "cost 8");
  assert.equal(zoneOf(a.engine, a.id("zig")), "hand");
  const b = zigBoard([...volition(5), ...bank("rage", 3)], { zone: "hand" });
  refused(() => play(b.engine, P1, b.id("zig")), "only five [V]");
  assert.equal(zoneOf(b.engine, b.id("zig")), "hand");
  assert.equal(ready(b.engine, P1), 8);
  const c = zigBoard([...volition(6), ...bank("rage", 2)], { zone: "hand" });
  play(c.engine, P1, c.id("zig"));
  assert.equal(zoneOf(c.engine, c.id("zig")), "play", "six [V] + 2 other resources is enough");
});

clause(ZIG, "0:rule", "X is the number of [V] you control: with 8 Volition you may mark up to 8 cards, not 9", () => {
  const g = zigBoard([...volition(8)], { zone: "hand", cands: 10 });
  play(g.engine, P1, g.id("zig"));
  refused(() => submitPick(g, cIds(g, 9)), "X is 8");
  assert.ok(pend(g.engine), "the pick is still open");
  pickEtb(g, cIds(g, 8));
  for (let i = 0; i < 8; i++) assert.equal(toks(g.engine, g.id(`c${i}`)), 1, `c${i}`);
  assert.equal(toks(g.engine, g.id("c8")), 0);
  assert.equal(toks(g.engine, g.id("c9")), 0);
});

clause(ZIG, "0:rule", "X counts only [V] resources: 6 Volition + 2 Rage means up to 6 (not 8), and the opponent's Volition does not count", () => {
  const g = zigBoard([...volition(6), ...bank("rage", 2), ...volition(3, P2)], { zone: "hand", cands: 10 });
  play(g.engine, P1, g.id("zig"));
  refused(() => submitPick(g, cIds(g, 7)), "X is 6");
  pickEtb(g, cIds(g, 6));
  for (let i = 0; i < 6; i++) assert.equal(toks(g.engine, g.id(`c${i}`)), 1);
  assert.equal(toks(g.engine, g.id("c6")), 0);
});

clause(ZIG, "0:rule", "'up to X' and 'may': marking 0, 1 or 3 cards are all allowed", () => {
  for (const n of [0, 1, 3]) {
    const g = zigBoard([...volition(8)], { zone: "hand", cands: 5 });
    play(g.engine, P1, g.id("zig"));
    pickEtb(g, cIds(g, n));
    const total = [0, 1, 2, 3, 4].reduce((s, i) => s + toks(g.engine, g.id(`c${i}`)), 0);
    assert.equal(total, n, `${n} tokens placed`);
  }
});

clause(ZIG, "0:rule", "may pick any non-resource card in play: items, locations, either player's characters and Zigalburgonglgr itself", () => {
  const g = zigBoard(
    [
      ...volition(8),
      { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "play" }
    ],
    { zone: "hand" }
  );
  play(g.engine, P1, g.id("zig"));
  pickEtb(g, [g.id("gear"), g.id("place"), g.id("mine"), g.id("theirs"), g.id("zig")]);
  for (const k of ["gear", "place", "mine", "theirs", "zig"]) assert.equal(toks(g.engine, g.id(k)), 1, k);
});

clause(ZIG, "0:rule", "resource cards cannot be marked: a ready bank and a face-down resource are refused", () => {
  const vols = volition(8);
  const g = zigBoard([...vols, ...bank("rage", 1), { key: "mark", def: character({ name: "Mark" }), owner: P1, zone: "play" }], { zone: "hand" });
  const bankKey = [...g.engine.state.players[P1].play].find((id) => g.engine.isResource(id) && !g.engine.state.cards[id].faceDown)!;
  play(g.engine, P1, g.id("zig"));
  refused(() => submitPick(g, [bankKey]), "face-up resource");
  refused(() => submitPick(g, [g.id(vols[0]!.key)]), "face-down resource");
  refused(() => submitPick(g, [g.id("mark"), bankKey]), "a resource among the picks");
  assert.ok(pend(g.engine), "pick still open");
  pickEtb(g, [g.id("mark")]);
  assert.equal(toks(g.engine, g.id("mark")), 1);
  assert.equal(toks(g.engine, bankKey), 0);
});

clause(ZIG, "0:rule", "tokens go on cards in play only (CR 409.1): a card in hand or in a discard pile cannot be picked", () => {
  const g = zigBoard(
    [
      ...volition(8),
      { key: "hand1", def: character({ name: "Hand1" }), owner: P1, zone: "hand" },
      { key: "disc1", def: character({ name: "Disc1" }), owner: P2, zone: "discard" },
      { key: "mark", def: character({ name: "Mark" }), owner: P1, zone: "play" }
    ],
    { zone: "hand" }
  );
  play(g.engine, P1, g.id("zig"));
  refused(() => submitPick(g, [g.id("hand1")]), "card in hand");
  refused(() => submitPick(g, [g.id("disc1")]), "card in discard");
  pickEtb(g, [g.id("mark")]);
  assert.equal(toks(g.engine, g.id("hand1")), 0);
  assert.equal(toks(g.engine, g.id("disc1")), 0);
});

clause(ZIG, "0:rule", "does not trigger when ANOTHER card enters play", () => {
  const g = zigBoard([{ key: "other", def: character({ name: "Other" }), owner: P1, zone: "hand" }, ...volition(3)], { cands: 2 });
  play(g.engine, P1, g.id("other"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(toks(g.engine, g.id("c0")), 0);
});

clause(ZIG, "1:rule", "when destroyed, every non-resource card with a token is destroyed: both players' characters, items and locations", () => {
  const g = zigBoard(
    [
      { key: "k", def: killer(), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", life: 9 }), owner: P1, zone: "play", counters: { token: 1 } },
      { key: "theirs", def: character({ name: "Theirs", life: 9 }), owner: P2, zone: "play", counters: { token: 3 } },
      { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play", counters: { token: 1 } },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play", counters: { token: 2 } },
      { key: "clean", def: character({ name: "Clean", life: 9 }), owner: P2, zone: "play" },
      { key: "cleanItem", def: item({ name: "CleanItem" }), owner: P1, zone: "play" }
    ]
  );
  play(g.engine, P1, g.id("k"), { selected: { t: [g.id("zig")] } });
  assert.equal(zoneOf(g.engine, g.id("zig")), "discard");
  for (const k of ["mine", "theirs", "gear", "place"]) assert.equal(zoneOf(g.engine, g.id(k)), "discard", k);
  assert.equal(zoneOf(g.engine, g.id("clean")), "play");
  assert.equal(zoneOf(g.engine, g.id("cleanItem")), "play");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(ZIG, "1:rule", "resources with tokens survive: a face-down resource and a face-up bank both stay in play", () => {
  const vols = volition(1);
  const banks = bank("rage", 1);
  const g = zigBoard([
    { key: "k", def: killer(), owner: P1, zone: "hand" },
    { ...vols[0]!, counters: { token: 1 } },
    { ...banks[0]!, counters: { token: 1 } }
  ]);
  play(g.engine, P1, g.id("k"), { selected: { t: [g.id("zig")] } });
  assert.equal(zoneOf(g.engine, g.id("zig")), "discard");
  assert.equal(zoneOf(g.engine, g.id(vols[0]!.key)), "play");
  assert.equal(zoneOf(g.engine, g.id(banks[0]!.key)), "play");
});

clause(ZIG, "1:rule", "marked by its own ETB then destroyed: only the marked cards die", () => {
  const g = zigBoard([...volition(8), { key: "k", def: killer(), owner: P1, zone: "hand" }], { zone: "hand", cands: 4 });
  play(g.engine, P1, g.id("zig"));
  pickEtb(g, [g.id("c0"), g.id("c1")]);
  play(g.engine, P1, g.id("k"), { selected: { t: [g.id("zig")] } });
  assert.equal(zoneOf(g.engine, g.id("c0")), "discard");
  assert.equal(zoneOf(g.engine, g.id("c1")), "discard");
  assert.equal(zoneOf(g.engine, g.id("c2")), "play");
  assert.equal(zoneOf(g.engine, g.id("c3")), "play");
});

clause(ZIG, "1:rule", "does not trigger when another card is destroyed (tokened cards stay)", () => {
  const g = zigBoard([
    { key: "k", def: killer(), owner: P1, zone: "hand" },
    { key: "mine", def: character({ name: "Mine", life: 9 }), owner: P1, zone: "play", counters: { token: 1 } },
    { key: "theirs", def: character({ name: "Theirs", life: 9 }), owner: P2, zone: "play", counters: { token: 1 } }
  ]);
  play(g.engine, P1, g.id("k"), { selected: { t: [g.id("mine")] } });
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard");
  assert.equal(zoneOf(g.engine, g.id("theirs")), "play");
  assert.equal(zoneOf(g.engine, g.id("zig")), "play");
});

clause(ZIG, "1:rule", "does not trigger when it leaves play without being destroyed (returned to hand)", () => {
  const g = zigBoard([
    { key: "b", def: bouncer(), owner: P1, zone: "hand" },
    { key: "theirs", def: character({ name: "Theirs", life: 9 }), owner: P2, zone: "play", counters: { token: 1 } }
  ]);
  play(g.engine, P1, g.id("b"), { selected: { t: [g.id("zig")] } });
  assert.equal(zoneOf(g.engine, g.id("zig")), "hand");
  assert.equal(zoneOf(g.engine, g.id("theirs")), "play");
});

function mushBoard(extra: CardPlacement[], banksN = 2) {
  return zigBoard([...bank("rage", banksN), ...extra]);
}
const mush = (g: ZigGame, key: string) => activate(g.engine, P1, g.id("zig"), "mush", { selected: { c: [g.id(key)] } });

clause(ZIG, "2:ability:mush", "pay 2 and flip your own tokened character face-down: it stays in play as a resource under your control", () => {
  const g = mushBoard([{ key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play", counters: { token: 1 } }]);
  mush(g, "mine");
  assert.equal(g.engine.state.cards[g.id("mine")].faceDown, true);
  assert.equal(zoneOf(g.engine, g.id("mine")), "play");
  assert.equal(ctl(g.engine, g.id("mine")), P1);
  assert.equal(g.engine.isResource(g.id("mine")), true);
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(ZIG, "2:ability:mush", "an opponent's card you control is flipped face-down under its OWNER's control", () => {
  const g = mushBoard(
    [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, controller: P1, zone: "play", counters: { token: 1 } }],
    3
  );
  assert.equal(ctl(g.engine, g.id("stolen")), P1);
  mush(g, "stolen");
  const c = g.engine.state.cards[g.id("stolen")];
  assert.equal(c.faceDown, true);
  assert.equal(ctl(g.engine, g.id("stolen")), P2, "back under its owner's control");
  assert.equal(c.ownerId, P2);
  assert.equal(c.zone, "play");
  assert.equal(ready(g.engine, P1), 1, "exactly 2 of 3 paid");
});

clause(ZIG, "2:ability:mush", "an opponent's own tokened card can be picked and is flipped face-down under their control", () => {
  const g = mushBoard([{ key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "play", counters: { token: 2 } }]);
  mush(g, "theirs");
  const c = g.engine.state.cards[g.id("theirs")];
  assert.equal(c.faceDown, true);
  assert.equal(ctl(g.engine, g.id("theirs")), P2);
  assert.equal(g.engine.isResource(g.id("theirs")), true);
});

clause(ZIG, "2:ability:mush", "any kind of card with a token can be picked: an item and a location are flipped face-down too", () => {
  const g = mushBoard(
    [
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play", counters: { token: 1 } },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play", counters: { token: 1 } }
    ],
    4
  );
  mush(g, "gear");
  assert.equal(g.engine.state.cards[g.id("gear")].faceDown, true);
  mush(g, "place");
  assert.equal(g.engine.state.cards[g.id("place")].faceDown, true);
  assert.equal(ctl(g.engine, g.id("place")), P2);
});

clause(ZIG, "2:ability:mush", "a card without a token cannot be picked; the card with one can", () => {
  const g = mushBoard([
    { key: "plain", def: character({ name: "Plain" }), owner: P2, zone: "play" },
    { key: "marked", def: character({ name: "Marked" }), owner: P2, zone: "play", counters: { token: 1 } }
  ]);
  refused(() => mush(g, "plain"), "no token on it");
  assert.equal(g.engine.state.cards[g.id("plain")].faceDown, false);
  assert.equal(ready(g.engine, P1), 2, "nothing paid");
  mush(g, "marked");
  assert.equal(g.engine.state.cards[g.id("marked")].faceDown, true);
});

clause(ZIG, "2:ability:mush", "costs exactly 2: refused with 1 resource, nothing is flipped", () => {
  const g = mushBoard([{ key: "marked", def: character({ name: "Marked" }), owner: P2, zone: "play", counters: { token: 1 } }], 1);
  refused(() => mush(g, "marked"), "pay 2 with only 1");
  assert.equal(g.engine.state.cards[g.id("marked")].faceDown, false);
  assert.equal(ready(g.engine, P1), 1);
});

clause(ZIG, "2:ability:mush", "needs a pick: activating without one is refused", () => {
  const g = mushBoard([{ key: "marked", def: character({ name: "Marked" }), owner: P2, zone: "play", counters: { token: 1 } }]);
  refused(() => activate(g.engine, P1, g.id("zig"), "mush", { selected: {} }), "needs a card with a token");
  assert.equal(ready(g.engine, P1), 2);
});

clause(ZIG, "2:ability:mush", "the opponent cannot use it outside a response window", () => {
  const g = mushBoard([{ key: "marked", def: character({ name: "Marked" }), owner: P2, zone: "play", counters: { token: 1 } }]);
  refused(() => activate(g.engine, P2, g.id("zig"), "mush", { selected: { c: [g.id("marked")] } }), "not the controller");
  assert.equal(g.engine.state.cards[g.id("marked")].faceDown, false);
});

// ===========================================================================
// Brainbath — tactic, arcanist, cost 1, [O][O]
// Draw 2 cards. Put a card from your hand on the bottom of your deck.
// RECUR [O][O] -- COST: Use this only if this card is in your discard pile. Pay 4. Remove this card from the game.
// -- EFFECT: An opponent discards a card. Draw a card.
// ===========================================================================

const BB = "2bf6045a-5b3f-4189-ae91-28837c0d7b83";

function bbBoard(extra: CardPlacement[] = [], opts: { bb?: "hand" | "discard" | "deck"; bbOwner?: PlayerId; oppHand?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "bb", def: printing(BB), owner: opts.bbOwner ?? P1, zone: opts.bb ?? "hand" },
      ...cards("h", 2, P1, "hand"),
      ...cards("d", 5, P1, "deck"),
      ...cards("o", opts.oppHand ?? 2, P2, "hand"),
      ...cards("od", 3, P2, "deck"),
      ...extra
    ]
  });
}
type BbGame = ReturnType<typeof bbBoard>;
const bbCast = (g: BbGame) => play(g.engine, P1, g.id("bb"));
const answerBb = (g: BbGame, key: string) => {
  const pc = pend(g.engine);
  assert.ok(pc, "a hand pick is open");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(key)] });
  assert.equal(g.engine.state.pendingChoice, undefined);
};

clause(BB, "0:rule", "printed card: tactic, Arcanist, cost 1, threshold [O][O]", () => {
  const def = printing(BB);
  assert.equal(def.type, "tactic");
  assert.equal(def.trade, "arcanist");
  assert.equal(def.cost, 1);
  assert.equal(def.threshold, "oo");
});

clause(BB, "0:rule", "costs exactly 1 with [O][O] shown: 2 spent Obsession + 1 ready resource", () => {
  const g = bbBoard([...spent("obsession", 2), ...bank("rage", 1)]);
  bbCast(g);
  answerBb(g, "h0");
  assert.equal(zoneOf(g.engine, g.id("bb")), "discard");
  assert.equal(ready(g.engine, P1), 0, "exactly 1 paid");
});

clause(BB, "0:rule", "is refused with no ready resource (cost 1 unaffordable) and one icon short ([O] + [G])", () => {
  const a = bbBoard([...spent("obsession", 2)]);
  refused(() => bbCast(a), "cost 1");
  assert.equal(zoneOf(a.engine, a.id("bb")), "hand");
  assert.equal(handOf(a.engine, P1).length, 3);
  const b = bbBoard([...bank("obsession", 1), ...bank("greed", 1)]);
  refused(() => bbCast(b), "[O][O] not met");
  assert.equal(zoneOf(b.engine, b.id("bb")), "hand");
  const c = bbBoard([...bank("greed", 2)]);
  refused(() => bbCast(c), "no Obsession");
  const d = bbBoard([...bank("obsession", 2)]);
  bbCast(d);
  assert.ok(pend(d.engine), "positive control: two ready Obsession works");
});

clause(BB, "0:rule", "draws exactly 2, then you put a card from your hand (including one just drawn) on the bottom of your deck", () => {
  const g = bbBoard([...bank("obsession", 2)]);
  const deck = [...deckOf(g.engine, P1)];
  bbCast(g);
  assert.deepEqual(sorted(handOf(g.engine, P1)), sorted([g.id("h0"), g.id("h1"), deck[0]!, deck[1]!]), "drew the top two before the choice");
  answerBb(g, "d1");
  assert.deepEqual(sorted(handOf(g.engine, P1)), sorted([g.id("h0"), g.id("h1"), deck[0]!]));
  assert.deepEqual(deckOf(g.engine, P1), [deck[2], deck[3], deck[4], deck[1]], "the put-back card is on the bottom");
});

clause(BB, "0:rule", "the card put on the bottom can be one that was already in hand", () => {
  const g = bbBoard([...bank("obsession", 2)]);
  const deck = [...deckOf(g.engine, P1)];
  bbCast(g);
  answerBb(g, "h0");
  assert.deepEqual(sorted(handOf(g.engine, P1)), sorted([g.id("h1"), deck[0]!, deck[1]!]));
  assert.equal((deckOf(g.engine, P1) as string[]).slice(-1)[0], g.id("h0"));
  assert.equal(deckOf(g.engine, P1).length, 4);
});

clause(BB, "0:rule", "the pick is mandatory and only from YOUR hand: an empty pick and an opponent's hand card are refused", () => {
  const g = bbBoard([...bank("obsession", 2)]);
  bbCast(g);
  refused(() => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [] } } as never), "mandatory");
  refused(() => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [g.id("o0")] } } as never), "not your hand");
  assert.ok(pend(g.engine), "still waiting");
  answerBb(g, "h1");
  assert.equal((deckOf(g.engine, P1) as string[]).slice(-1)[0], g.id("h1"));
});

clause(BB, "0:rule", "the opponent's hand and deck are untouched", () => {
  const g = bbBoard([...bank("obsession", 2)]);
  const oh = [...handOf(g.engine, P2)];
  const od = [...deckOf(g.engine, P2)];
  bbCast(g);
  answerBb(g, "h0");
  assert.deepEqual(handOf(g.engine, P2), oh);
  assert.deepEqual(deckOf(g.engine, P2), od);
});

function bbRecurBoard(extra: CardPlacement[] = [], opts: { oppHand?: number } = {}) {
  return bbBoard(extra, { bb: "discard", oppHand: opts.oppHand });
}
const recur = (g: BbGame, player: PlayerId = P1) => activate(g.engine, player, g.id("bb"), "recur");

clause(BB, "1:ability:recur", "from your discard pile for 4 with [O][O]: the opponent discards a card of THEIR choice, you draw 1, and Brainbath is removed from the game", () => {
  const g = bbRecurBoard([...bank("obsession", 2), ...bank("rage", 2)]);
  const deck = [...deckOf(g.engine, P1)];
  recur(g);
  const pc = pend(g.engine);
  assert.ok(pc, "the opponent's discard pick");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the opponent chooses");
  assert.equal(zoneOf(g.engine, g.id("bb")), "removed", "COST: removed from the game");
  assert.equal(ready(g.engine, P1), 0, "COST: pay 4");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("o1")] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("o1")), "discard");
  assert.deepEqual(handOf(g.engine, P2), [g.id("o0")], "the other card stays");
  assert.deepEqual(handOf(g.engine, P1), [g.id("h0"), g.id("h1"), deck[0]!], "drew exactly one");
  assert.deepEqual(deckOf(g.engine, P1), deck.slice(1));
});

clause(BB, "1:ability:recur", "the opponent's pick must come from their hand: your own hand card is refused", () => {
  const g = bbRecurBoard([...bank("obsession", 2), ...bank("rage", 2)]);
  recur(g);
  refused(() => g.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [g.id("h0")] } } as never), "not their hand");
  refused(() => g.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [] } } as never), "mandatory discard");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("o0")] });
  assert.equal(zoneOf(g.engine, g.id("o0")), "discard");
  assert.equal(zoneOf(g.engine, g.id("h0")), "hand");
});

clause(BB, "1:ability:recur", "with an empty opponent hand you still draw a card", () => {
  const g = bbRecurBoard([...bank("obsession", 2), ...bank("rage", 2)], { oppHand: 0 });
  recur(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(handOf(g.engine, P1).length, 3);
  assert.equal(zoneOf(g.engine, g.id("bb")), "removed");
});

clause(BB, "1:ability:recur", "costs exactly 4: refused with 3 resources, nothing is paid or removed", () => {
  const g = bbRecurBoard([...bank("obsession", 2), ...bank("rage", 1)]);
  refused(() => recur(g), "pay 4 with 3");
  assert.equal(zoneOf(g.engine, g.id("bb")), "discard");
  assert.equal(ready(g.engine, P1), 3);
  assert.equal(handOf(g.engine, P2).length, 2);
});

clause(BB, "1:ability:recur", "needs [O][O]: 4 resources with only one Obsession (or none) are refused", () => {
  const g = bbRecurBoard([...bank("obsession", 1), ...bank("rage", 3)]);
  refused(() => recur(g), "only [O]");
  assert.equal(zoneOf(g.engine, g.id("bb")), "discard");
  const h = bbRecurBoard([...bank("rage", 4)]);
  refused(() => recur(h), "no [O]");
  assert.equal(zoneOf(h.engine, h.id("bb")), "discard");
  const i = bbRecurBoard([...spent("obsession", 2), ...bank("rage", 4)]);
  recur(i);
  assert.equal(zoneOf(i.engine, i.id("bb")), "removed", "spent Obsession counts toward the threshold; 4 ready pay");
});

clause(BB, "1:ability:recur", "only from your discard pile: refused from your hand, from your deck, and from the opponent's discard pile", () => {
  const res = () => [...bank("obsession", 2), ...bank("rage", 2)];
  const inHand = bbBoard(res(), { bb: "hand" });
  refused(() => recur(inHand), "in hand", /not found|zone|discard|cannot|can't/i);
  assert.equal(zoneOf(inHand.engine, inHand.id("bb")), "hand");
  assert.equal(ready(inHand.engine, P1), 4);
  const inDeck = bbBoard(res(), { bb: "deck" });
  refused(() => recur(inDeck), "in deck", /not found|zone|discard|cannot|can't/i);
  assert.equal(zoneOf(inDeck.engine, inDeck.id("bb")), "deck");
  const theirs = bbBoard(res(), { bb: "discard", bbOwner: P2 });
  refused(() => recur(theirs), "opponent's discard pile", /not found|zone|discard|cannot|can't|owner|control/i);
  assert.equal(zoneOf(theirs.engine, theirs.id("bb")), "discard");
  assert.equal(ready(theirs.engine, P1), 4);
  const ok = bbBoard(res(), { bb: "discard" });
  recur(ok);
  assert.equal(zoneOf(ok.engine, ok.id("bb")), "removed", "positive control");
});

// ===========================================================================
// Quotidian Assassination — tactic, arcanist, cost 2, [O]
// COST: Pick a character. -- EFFECT: Put the character into its owner's hand.
// ===========================================================================

const QA = "0329f3b4-3d1b-4830-8826-e6c185ab152d";

function qaBoard(extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "qa", def: printing(QA), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen" }), owner: P2, controller: P1, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play" },
      { key: "inhand", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
      ...extra
    ]
  });
}
type QaGame = ReturnType<typeof qaBoard>;
const qaPlay = (g: QaGame, key: string) => play(g.engine, P1, g.id("qa"), { selected: { c: [g.id(key)] } });

clause(QA, "0:ability", "printed card: tactic, Arcanist, cost 2, threshold [O]", () => {
  const def = printing(QA);
  assert.equal(def.type, "tactic");
  assert.equal(def.trade, "arcanist");
  assert.equal(def.cost, 2);
  assert.equal(def.threshold, "o");
});

clause(QA, "0:ability", "costs exactly 2 with one [O]: Obsession + Rage leaves nothing; 1 resource is one short", () => {
  const g = qaBoard([...bank("obsession", 1), ...bank("rage", 1)]);
  qaPlay(g, "theirs");
  assert.equal(zoneOf(g.engine, g.id("qa")), "discard");
  assert.equal(ready(g.engine, P1), 0);
  const s = qaBoard([...bank("obsession", 1)]);
  refused(() => qaPlay(s, "theirs"), "cost 2");
  assert.equal(zoneOf(s.engine, s.id("qa")), "hand");
  assert.equal(zoneOf(s.engine, s.id("theirs")), "play");
});

clause(QA, "0:ability", "needs [O]: 2 Rage cannot cast it, 3 resources without Obsession neither", () => {
  const g = qaBoard([...bank("rage", 3)]);
  refused(() => qaPlay(g, "theirs"), "no [O]");
  assert.equal(zoneOf(g.engine, g.id("qa")), "hand");
  assert.equal(zoneOf(g.engine, g.id("theirs")), "play");
  assert.equal(ready(g.engine, P1), 3);
});

clause(QA, "0:ability", "the opponent's character goes to ITS OWNER's hand", () => {
  const g = qaBoard([...bank("obsession", 2)]);
  qaPlay(g, "theirs");
  assert.equal(zoneOf(g.engine, g.id("theirs")), "hand");
  assert.ok(handOf(g.engine, P2).includes(g.id("theirs")), "handOf(g.engine, P2).includes(g.id(\"theirs\"))");
  assert.ok(!g.engine.state.players[P2].play.includes(g.id("theirs")), "!g.engine.state.players[P2].play.includes(g.id(\"theirs\"))");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play", "others untouched");
});

clause(QA, "0:ability", "your own character can be picked too and returns to your hand", () => {
  const g = qaBoard([...bank("obsession", 2)]);
  qaPlay(g, "mine");
  assert.equal(zoneOf(g.engine, g.id("mine")), "hand");
  assert.ok(handOf(g.engine, P1).includes(g.id("mine")), "handOf(g.engine, P1).includes(g.id(\"mine\"))");
  assert.equal(zoneOf(g.engine, g.id("theirs")), "play");
});

clause(QA, "0:ability", "a character you control but the opponent owns goes to its OWNER's hand, not yours", () => {
  const g = qaBoard([...bank("obsession", 2)]);
  qaPlay(g, "stolen");
  assert.ok(handOf(g.engine, P2).includes(g.id("stolen")), "owner's hand");
  assert.ok(!handOf(g.engine, P1).includes(g.id("stolen")), "not the controller's hand");
  assert.equal(zoneOf(g.engine, g.id("stolen")), "hand");
});

clause(QA, "0:ability", "the pick is a cost: no pick is refused and pays nothing", () => {
  const g = qaBoard([...bank("obsession", 2)]);
  refused(() => play(g.engine, P1, g.id("qa"), { selected: {} }), "needs a pick");
  assert.equal(zoneOf(g.engine, g.id("qa")), "hand");
  assert.equal(ready(g.engine, P1), 2);
});

clause(QA, "0:ability", "an item, a character not in play and a faction cannot be picked", () => {
  const g = qaBoard([...bank("obsession", 2)]);
  refused(() => qaPlay(g, "gear"), "item");
  refused(() => qaPlay(g, "inhand"), "not in play");
  refused(() => play(g.engine, P1, g.id("qa"), { selected: { c: [g.engine.state.players[P2].factionId!] } }), "faction (CR 202.9)");
  refused(() => play(g.engine, P1, g.id("qa"), { selected: { c: [g.engine.state.players[P1].factionId!] } }), "own faction");
  assert.equal(zoneOf(g.engine, g.id("qa")), "hand");
  assert.equal(zoneOf(g.engine, g.id("gear")), "play");
  assert.equal(ready(g.engine, P1), 2);
});

// ===========================================================================
// Circumspect Hijacker — character, banker, pirate/mau, cost 3, [G], 2/3/2
// [G][G][G]: When this card enters play, draw a card.
// RETREAT -- COST: Pay 2. Destroy this card. -- EFFECT: Draw a card.
// ===========================================================================

const CH = "e02fe443-bd47-41e7-8790-1a57a237b8cf";

function chBoard(extra: CardPlacement[] = [], zone: "hand" | "play" = "hand") {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ch", def: printing(CH), owner: P1, zone }, ...cards("d", 4, P1, "deck"), ...cards("od", 4, P2, "deck"), ...extra]
  });
}
type ChGame = ReturnType<typeof chBoard>;

clause(CH, "0:rule@ggg", "printed card: character, Banker, pirate/mau, cost 3, threshold [G], 2 strength / 3 speed / 2 life", () => {
  const def = printing(CH);
  assert.equal(def.type, "character");
  assert.equal(def.trade, "banker");
  assert.deepEqual([...def.subtype], ["pirate", "mau"]);
  assert.equal(def.cost, 3);
  assert.equal(def.threshold, "g");
  const g = chBoard([], "play");
  assert.deepEqual([g.engine.getStat(g.id("ch"), "strength"), g.engine.getStat(g.id("ch"), "speed"), g.engine.getStat(g.id("ch"), "life")], [2, 3, 2]);
});

clause(CH, "0:rule@ggg", "deploys for exactly 3 with a [G]; refused with 2 Greed, and with 3 Rage (no [G])", () => {
  const ok = chBoard([...bank("greed", 3)]);
  play(ok.engine, P1, ok.id("ch"));
  assert.equal(zoneOf(ok.engine, ok.id("ch")), "play");
  assert.equal(ready(ok.engine, P1), 0);
  const short = chBoard([...bank("greed", 2)]);
  refused(() => play(short.engine, P1, short.id("ch")), "cost 3");
  assert.equal(zoneOf(short.engine, short.id("ch")), "hand");
  const noG = chBoard([...bank("rage", 3)]);
  refused(() => play(noG.engine, P1, noG.id("ch")), "no [G]");
  assert.equal(zoneOf(noG.engine, noG.id("ch")), "hand");
  assert.equal(ready(noG.engine, P1), 3);
});

clause(CH, "0:rule@ggg", "with [G][G][G] when it enters, you draw exactly one card", () => {
  const g = chBoard([...bank("greed", 3)]);
  const top = deckOf(g.engine, P1)[0]!;
  play(g.engine, P1, g.id("ch"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(g.engine, P1), [top]);
  assert.equal(deckOf(g.engine, P1).length, 3);
  assert.equal(deckOf(g.engine, P2).length, 4, "the opponent draws nothing");
});

clause(CH, "0:rule@ggg", "spent Greed counts toward [G][G][G] (3 spent Greed + 3 Rage to pay)", () => {
  const g = chBoard([...spent("greed", 3), ...bank("rage", 3)]);
  play(g.engine, P1, g.id("ch"));
  assert.equal(handOf(g.engine, P1).length, 1, "drew");
});

clause(CH, "0:rule@ggg", "without [G][G][G] (2 Greed + 1 Rage) it enters and nothing is drawn", () => {
  const g = chBoard([...bank("greed", 2), ...bank("rage", 1)]);
  play(g.engine, P1, g.id("ch"));
  assert.equal(zoneOf(g.engine, g.id("ch")), "play");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(handOf(g.engine, P1).length, 0);
  assert.equal(deckOf(g.engine, P1).length, 4);
});

clause(CH, "0:rule@ggg", "four Greed also draws (more than the threshold)", () => {
  const g = chBoard([...bank("greed", 4)]);
  play(g.engine, P1, g.id("ch"));
  assert.equal(handOf(g.engine, P1).length, 1);
});

clause(CH, "0:rule@ggg", "does not draw when ANOTHER card enters play, even with [G][G][G] shown", () => {
  const g = chBoard([...bank("greed", 3), { key: "other", def: character({ name: "Other" }), owner: P1, zone: "hand" }], "play");
  play(g.engine, P1, g.id("other"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(handOf(g.engine, P1).length, 0);
  assert.equal(deckOf(g.engine, P1).length, 4);
});

clause(CH, "0:rule@ggg", "a second Hijacker entering draws once (only the entering copy triggers)", () => {
  const g = chBoard([...bank("greed", 3), { key: "ch2", def: printing(CH), owner: P1, zone: "hand" }], "play");
  play(g.engine, P1, g.id("ch2"));
  assert.equal(handOf(g.engine, P1).length, 1);
  assert.equal(deckOf(g.engine, P1).length, 3);
});

const retreat = (g: ChGame, player: PlayerId = P1) => activate(g.engine, player, g.id("ch"), "retreat");

clause(CH, "1:ability:retreat", "pay 2, destroy this card, then draw a card", () => {
  const g = chBoard([...bank("greed", 2)], "play");
  const top = deckOf(g.engine, P1)[0]!;
  retreat(g);
  assert.equal(zoneOf(g.engine, g.id("ch")), "discard", "COST: destroyed");
  assert.equal(ready(g.engine, P1), 0, "COST: pay 2");
  assert.deepEqual(handOf(g.engine, P1), [top], "drew exactly one");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(CH, "1:ability:retreat", "costs exactly 2 (3 resources leave 1) and is refused with 1; the card stays and nothing is drawn", () => {
  const a = chBoard([...bank("rage", 3)], "play");
  retreat(a);
  assert.equal(ready(a.engine, P1), 1);
  const b = chBoard([...bank("rage", 1)], "play");
  refused(() => retreat(b), "pay 2 with only 1");
  assert.equal(zoneOf(b.engine, b.id("ch")), "play");
  assert.equal(handOf(b.engine, P1).length, 0);
  assert.equal(ready(b.engine, P1), 1);
});

clause(CH, "1:ability:retreat", "needs no [G] and works even while depleted (no deplete cost printed)", () => {
  const g = chBoard([...bank("rage", 2)], "play");
  g.engine.state.cards[g.id("ch")].depleted = true;
  retreat(g);
  assert.equal(zoneOf(g.engine, g.id("ch")), "discard");
  assert.equal(handOf(g.engine, P1).length, 1);
});

clause(CH, "1:ability:retreat", "only works from play and only for its controller", () => {
  const inHand = chBoard([...bank("rage", 2)], "hand");
  refused(() => retreat(inHand), "in hand");
  assert.equal(zoneOf(inHand.engine, inHand.id("ch")), "hand");
  const g = chBoard([...bank("rage", 2), ...bank("rage", 2, P2)], "play");
  refused(() => retreat(g, P2), "opponent cannot use it");
  assert.equal(zoneOf(g.engine, g.id("ch")), "play");
  retreat(g);
  assert.equal(zoneOf(g.engine, g.id("ch")), "discard", "positive control");
});

// ===========================================================================
// Limited Liability — tactic, banker, cost 2, [G]
// This turn, cards in play and cards deployed can only be destroyed by costs, and all inflicted damage is reduced to 0.
// ===========================================================================

const LL = "da10bbbb-0cf4-4db8-847e-9a20d7fc2af0";

function llBoard(extra: CardPlacement[] = [], opts: { cast?: boolean } = {}) {
  const g = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ll", def: printing(LL), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 5, life: 3 }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Theirs", strength: 2, life: 3 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 3 }), owner: P1, zone: "play" },
      { key: "kill", def: killer(), owner: P1, zone: "hand" },
      { key: "hurt", def: hurter(2), owner: P1, zone: "hand" },
      { key: "late", def: character({ name: "Late", life: 3 }), owner: P1, zone: "hand" },
      ...bank("greed", 2),
      ...extra
    ]
  });
  if (opts.cast !== false) play(g.engine, P1, g.id("ll"));
  return g;
}
type LlGame = ReturnType<typeof llBoard>;
const llKill = (g: LlGame, key: string) => play(g.engine, P1, g.id("kill"), { selected: { t: [g.id(key)] } });

clause(LL, "0:rule", "printed card: tactic, Banker, cost 2, threshold [G]", () => {
  const def = printing(LL);
  assert.equal(def.type, "tactic");
  assert.equal(def.trade, "banker");
  assert.equal(def.cost, 2);
  assert.equal(def.threshold, "g");
});

clause(LL, "0:rule", "costs exactly 2 with a [G]: 2 Greed or 1 spent Greed + 2 Rage works; 1 resource, or 2 Rage with no [G], is refused", () => {
  const a = llBoard([], { cast: false });
  play(a.engine, P1, a.id("ll"));
  assert.equal(zoneOf(a.engine, a.id("ll")), "discard");
  assert.equal(ready(a.engine, P1), 0);
  const b = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "ll", def: printing(LL), owner: P1, zone: "hand" }, ...spent("greed", 1), ...bank("rage", 2)] });
  play(b.engine, P1, b.id("ll"));
  assert.equal(zoneOf(b.engine, b.id("ll")), "discard", "spent [G] meets the threshold, 2 ready pay");
  const c = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "ll", def: printing(LL), owner: P1, zone: "hand" }, ...bank("greed", 1)] });
  refused(() => play(c.engine, P1, c.id("ll")), "cost 2");
  assert.equal(zoneOf(c.engine, c.id("ll")), "hand");
  const d = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "ll", def: printing(LL), owner: P1, zone: "hand" }, ...bank("rage", 3)] });
  refused(() => play(d.engine, P1, d.id("ll")), "no [G]");
  assert.equal(zoneOf(d.engine, d.id("ll")), "hand");
  assert.equal(ready(d.engine, P1), 3);
});

clause(LL, "0:rule", "control: without it, a destroy effect kills a character and an effect deals its damage", () => {
  const g = llBoard([], { cast: false });
  llKill(g, "theirs");
  assert.equal(zoneOf(g.engine, g.id("theirs")), "discard");
  play(g.engine, P1, g.id("hurt"), { selected: { t: [g.id("mine")] } });
  assert.equal(dmg(g.engine, g.id("mine")), 2);
});

clause(LL, "0:rule", "cards in play cannot be destroyed by an effect: the opponent's character, your own, an item and a location all survive", () => {
  const g = llBoard([{ key: "kill2", def: killer("Killer2"), owner: P1, zone: "hand" }, { key: "kill3", def: killer("Killer3"), owner: P1, zone: "hand" }, { key: "kill4", def: killer("Killer4"), owner: P1, zone: "hand" }]);
  llKill(g, "theirs");
  play(g.engine, P1, g.id("kill2"), { selected: { t: [g.id("mine")] } });
  play(g.engine, P1, g.id("kill3"), { selected: { t: [g.id("gear")] } });
  play(g.engine, P1, g.id("kill4"), { selected: { t: [g.id("place")] } });
  for (const k of ["theirs", "mine", "gear", "place"]) assert.equal(zoneOf(g.engine, g.id(k)), "play", k);
  assert.equal(zoneOf(g.engine, g.id("kill")), "discard", "the destroy tactics still resolved");
});

clause(LL, "0:rule", "all inflicted damage is reduced to 0: an effect dealing 2 leaves 0 damage on a character and on a location", () => {
  const g = llBoard([{ key: "hurt2", def: hurter(2, "Hurter2"), owner: P1, zone: "hand" }]);
  play(g.engine, P1, g.id("hurt"), { selected: { t: [g.id("theirs")] } });
  assert.equal(dmg(g.engine, g.id("theirs")), 0);
  assert.equal(zoneOf(g.engine, g.id("theirs")), "play");
  play(g.engine, P1, g.id("hurt2"), { selected: { t: [g.id("place")] } });
  assert.equal(dmg(g.engine, g.id("place")), 0);
});

clause(LL, "0:rule", "battle damage is reduced to 0 too: a 5-strength attacker blocked by a 3-life character kills nothing and both stay undamaged", () => {
  const g = llBoard();
  fight(g.engine, P1, [g.id("mine")], { type: "faction", playerId: P2 }, [g.id("theirs")]);
  assert.equal(g.engine.state.battle, undefined);
  assert.equal(zoneOf(g.engine, g.id("theirs")), "play");
  assert.equal(dmg(g.engine, g.id("theirs")), 0);
  assert.equal(zoneOf(g.engine, g.id("mine")), "play");
  assert.equal(dmg(g.engine, g.id("mine")), 0);
});

clause(LL, "0:rule", "control for the battle: without it the blocker dies", () => {
  const g = llBoard([], { cast: false });
  fight(g.engine, P1, [g.id("mine")], { type: "faction", playerId: P2 }, [g.id("theirs")]);
  assert.equal(zoneOf(g.engine, g.id("theirs")), "discard");
});

clause(LL, "0:rule", "a card can still be destroyed by a COST: Circumspect Hijacker's RETREAT works", () => {
  const g = llBoard([{ key: "ch", def: printing(CH), owner: P1, zone: "play" }, ...bank("rage", 2), ...cards("d", 3, P1, "deck")]);
  activate(g.engine, P1, g.id("ch"), "retreat");
  assert.equal(zoneOf(g.engine, g.id("ch")), "discard", "destroyed by its own cost");
  assert.equal(handOf(g.engine, P1).length, 4, "RETREAT's draw still happens (kill, hurt, late + 1 drawn)");
});

clause(LL, "0:rule", "cards deployed this turn after it are protected as well: a new character survives a destroy effect and takes no damage", () => {
  const g = llBoard([{ key: "kill2", def: killer("Killer2"), owner: P1, zone: "hand" }]);
  play(g.engine, P1, g.id("late"));
  assert.equal(zoneOf(g.engine, g.id("late")), "play");
  llKill(g, "late");
  assert.equal(zoneOf(g.engine, g.id("late")), "play", "not destroyed");
  play(g.engine, P1, g.id("hurt"), { selected: { t: [g.id("late")] } });
  assert.equal(dmg(g.engine, g.id("late")), 0);
  assert.equal(zoneOf(g.engine, g.id("late")), "play");
});

clause(LL, "0:rule", "a card deployed after it can still be destroyed by a cost (Hijacker played after, then RETREAT)", () => {
  const g = llBoard([{ key: "ch", def: printing(CH), owner: P1, zone: "hand" }, ...bank("rage", 5), ...cards("d", 3, P1, "deck")]);
  play(g.engine, P1, g.id("ch"));
  assert.equal(zoneOf(g.engine, g.id("ch")), "play");
  activate(g.engine, P1, g.id("ch"), "retreat");
  assert.equal(zoneOf(g.engine, g.id("ch")), "discard");
});

clause(LL, "0:rule", "it lasts this turn only: on the opponent's next turn destroy and damage work again", () => {
  const g = llBoard([
    { key: "kill2", def: killer("Killer2"), owner: P2, zone: "hand" },
    { key: "hurt2", def: hurter(2, "Hurter2"), owner: P2, zone: "hand" }
  ]);
  llKill(g, "theirs");
  assert.equal(zoneOf(g.engine, g.id("theirs")), "play", "protected this turn");
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  play(g.engine, P2, g.id("hurt2"), { selected: { t: [g.id("theirs")] } });
  assert.equal(dmg(g.engine, g.id("theirs")), 2, "damage no longer reduced");
  play(g.engine, P2, g.id("kill2"), { selected: { t: [g.id("mine")] } });
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard", "destroy works again");
});

// ===========================================================================
// Overindulge — tactic, rogue, cost 2, [D][D]
// Choose one of the following as this card's rules text:
// OPTION 1 -- COST: Pick a character. -- EFFECT: This turn, the character loses 2 life.
// OPTION 2 -- COST: Pick a character. -- EFFECT: This turn, the character loses 1 life. Draw a card.
// ===========================================================================

const OI = "2a246a25-4b76-4ce3-9b98-bf3ac4ee5bfb";

function oiBoard(extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "oi", def: printing(OI), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4 }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Theirs", strength: 2, life: 4 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play" },
      { key: "inhand", def: character({ name: "InHand", life: 4 }), owner: P2, zone: "hand" },
      ...cards("d", 4, P1, "deck"),
      ...extra
    ]
  });
}
type OiGame = ReturnType<typeof oiBoard>;
const oiPlay = (g: OiGame, mode: number | undefined, key: string) =>
  play(g.engine, P1, g.id("oi"), { ...(mode !== undefined ? { mode } : {}), selected: { c: [g.id(key)] } });
const life = (g: OiGame, key: string) => g.engine.getStat(g.id(key), "life");

clause(OI, "0:rule", "printed card: tactic, Rogue, cost 2, threshold [D][D]", () => {
  const def = printing(OI);
  assert.equal(def.type, "tactic");
  assert.equal(def.trade, "rogue");
  assert.equal(def.cost, 2);
  assert.equal(def.threshold, "dd");
});

clause(OI, "0:rule", "costs exactly 2 with [D][D]: 2 spent Deception + 2 ready resources leaves nothing; 2 spent + 1 ready is one short", () => {
  const g = oiBoard([...spent("deception", 2), ...bank("rage", 2)]);
  oiPlay(g, 0, "theirs");
  assert.equal(zoneOf(g.engine, g.id("oi")), "discard");
  assert.equal(ready(g.engine, P1), 0, "exactly 2 paid");
  const s = oiBoard([...spent("deception", 2), ...bank("rage", 1)]);
  refused(() => oiPlay(s, 0, "theirs"), "cost 2");
  assert.equal(zoneOf(s.engine, s.id("oi")), "hand");
  assert.equal(life(s, "theirs"), 4);
});

clause(OI, "0:rule", "one icon short of [D][D] is refused: 1 spent Deception + 3 Rage, and 1 ready Deception + 1 Rage", () => {
  const a = oiBoard([...spent("deception", 1), ...bank("rage", 3)]);
  refused(() => oiPlay(a, 0, "theirs"), "only [D]");
  assert.equal(zoneOf(a.engine, a.id("oi")), "hand");
  const b = oiBoard([...bank("deception", 1), ...bank("rage", 1)]);
  refused(() => oiPlay(b, 1, "theirs"), "only [D]");
  assert.equal(zoneOf(b.engine, b.id("oi")), "hand");
  assert.equal(ready(b.engine, P1), 2);
  const c = oiBoard([...bank("deception", 2)]);
  oiPlay(c, 1, "theirs");
  assert.equal(zoneOf(c.engine, c.id("oi")), "discard", "positive control: two ready Deception");
});

clause(OI, "0:rule", "you choose ONE option when you play it: OPTION 1 does not draw, OPTION 2 does not take 2 life", () => {
  const a = oiBoard([...bank("deception", 2)]);
  oiPlay(a, 0, "theirs");
  assert.equal(life(a, "theirs"), 2);
  assert.equal(handOf(a.engine, P1).length, 0, "option 1 draws nothing");
  const b = oiBoard([...bank("deception", 2)]);
  oiPlay(b, 1, "theirs");
  assert.equal(life(b, "theirs"), 3);
  assert.equal(handOf(b.engine, P1).length, 1, "option 2 draws one");
});

clause(OI, "0:rule", "there are exactly two options: an out-of-range option and no choice at all are refused", () => {
  const g = oiBoard([...bank("deception", 2)]);
  refused(() => oiPlay(g, 2, "theirs"), "no third option");
  refused(() => oiPlay(g, -1, "theirs"), "negative option");
  assert.equal(zoneOf(g.engine, g.id("oi")), "hand");
  assert.equal(life(g, "theirs"), 4);
  assert.equal(ready(g.engine, P1), 2);
});

clause(OI, "1:option:OPTION 1", "the character loses exactly 2 life this turn (the opponent's, then yours); strength is unchanged", () => {
  const g = oiBoard([...bank("deception", 2)]);
  oiPlay(g, 0, "theirs");
  assert.equal(life(g, "theirs"), 2);
  assert.equal(g.engine.getStat(g.id("theirs"), "strength"), 2);
  assert.equal(life(g, "mine"), 4, "others untouched");
  const h = oiBoard([...bank("deception", 2)]);
  oiPlay(h, 0, "mine");
  assert.equal(life(h, "mine"), 2);
  assert.equal(life(h, "theirs"), 4);
});

clause(OI, "0:rule", "playing it without choosing an option is refused (one must be chosen)", () => {
  const g = oiBoard([...bank("deception", 2)]);
  refused(() => oiPlay(g, undefined, "theirs"), "an option must be chosen");
  assert.equal(zoneOf(g.engine, g.id("oi")), "hand");
  assert.equal(ready(g.engine, P1), 2);
});

clause(OI, "1:option:OPTION 1", "the loss lasts this turn only", () => {
  const g = oiBoard([...bank("deception", 2)]);
  oiPlay(g, 0, "theirs");
  assert.equal(life(g, "theirs"), 2);
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(life(g, "theirs"), 4);
});

clause(OI, "1:option:OPTION 1", "the pick is a cost: none, an item, a card in hand and a faction are all refused with nothing paid", () => {
  const g = oiBoard([...bank("deception", 2)]);
  refused(() => play(g.engine, P1, g.id("oi"), { mode: 0, selected: {} }), "needs a pick");
  refused(() => oiPlay(g, 0, "gear"), "item");
  refused(() => oiPlay(g, 0, "inhand"), "not in play");
  refused(() => play(g.engine, P1, g.id("oi"), { mode: 0, selected: { c: [g.engine.state.players[P2].factionId!] } }), "faction");
  assert.equal(zoneOf(g.engine, g.id("oi")), "hand");
  assert.equal(ready(g.engine, P1), 2);
});

clause(OI, "1:option:OPTION 1", "losing all its life this way destroys the character (life 2 loses 2)", () => {
  const g = oiBoard([...bank("deception", 2), { key: "two", def: character({ name: "Two", life: 2 }), owner: P2, zone: "play" }]);
  oiPlay(g, 0, "two");
  assert.equal(zoneOf(g.engine, g.id("two")), "discard");
});

clause(OI, "1:option:OPTION 1", "life lost counts against damage it already has: life 4 with 3 damage, minus 2 life, is destroyed", () => {
  const g = oiBoard([...bank("deception", 2), { key: "hurt", def: character({ name: "Hurt", life: 4 }), owner: P2, zone: "play", damage: 3 }]);
  oiPlay(g, 0, "hurt");
  assert.equal(zoneOf(g.engine, g.id("hurt")), "discard");
});

clause(OI, "2:option:OPTION 2", "the character loses exactly 1 life this turn and you draw exactly one card", () => {
  const g = oiBoard([...bank("deception", 2)]);
  const top = deckOf(g.engine, P1)[0]!;
  oiPlay(g, 1, "theirs");
  assert.equal(life(g, "theirs"), 3);
  assert.equal(life(g, "mine"), 4);
  assert.deepEqual(handOf(g.engine, P1), [top]);
  assert.equal(deckOf(g.engine, P1).length, 3);
  assert.equal(deckOf(g.engine, P2).length, 0);
  const h = oiBoard([...bank("deception", 2)]);
  oiPlay(h, 1, "mine");
  assert.equal(life(h, "mine"), 3, "your own character works the same");
});

clause(OI, "2:option:OPTION 2", "the loss lasts this turn only", () => {
  const g = oiBoard([...bank("deception", 2)]);
  oiPlay(g, 1, "theirs");
  endTurn(g.engine, P1);
  assert.equal(life(g, "theirs"), 4);
});

clause(OI, "2:option:OPTION 2", "the pick is a cost: none, an item, a card in hand and a faction are refused with nothing paid or drawn", () => {
  const g = oiBoard([...bank("deception", 2)]);
  refused(() => play(g.engine, P1, g.id("oi"), { mode: 1, selected: {} }), "needs a pick");
  refused(() => oiPlay(g, 1, "gear"), "item");
  refused(() => oiPlay(g, 1, "inhand"), "not in play");
  refused(() => play(g.engine, P1, g.id("oi"), { mode: 1, selected: { c: [g.engine.state.players[P1].factionId!] } }), "faction");
  assert.equal(zoneOf(g.engine, g.id("oi")), "hand");
  assert.equal(ready(g.engine, P1), 2);
  assert.equal(handOf(g.engine, P1).length, 1, "only Overindulge itself");
});

clause(OI, "2:option:OPTION 2", "losing the last life destroys the character (life 1 loses 1), and damage already marked counts (life 3, 2 damage)", () => {
  const g = oiBoard([...bank("deception", 2), { key: "one", def: character({ name: "One", life: 1 }), owner: P2, zone: "play" }]);
  oiPlay(g, 1, "one");
  assert.equal(zoneOf(g.engine, g.id("one")), "discard");
  const h = oiBoard([...bank("deception", 2), { key: "hurt", def: character({ name: "Hurt", life: 3 }), owner: P2, zone: "play", damage: 2 }]);
  oiPlay(h, 1, "hurt");
  assert.equal(zoneOf(h.engine, h.id("hurt")), "discard");
});

void clauseMismatch;
void drain;
void P2;
