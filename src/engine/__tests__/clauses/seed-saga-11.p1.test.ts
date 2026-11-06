// Clause tests, batch seed-saga-11, part p1 (groups 1-5, missing clauses only):
// Banner of Betrayal, Banner of Compulsion, Banner of Elysium, Banner of Fury, A Blazing Zero.
// Every expectation is read from the PRINTED text.

import assert from "node:assert/strict";
import {
  buildGame,
  activate,
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
import { clause, printing, refused } from "./_clause.js";
import { answerPending, fillers, pending, zoneOf } from "./_board.js";
import { playRaw } from "./_battle.js";
import { attachedCount, developResource, endTurn } from "./_turn.js";
import type { PlayerId } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

const BET = "adce33c8-0109-44d8-8e9f-aa5c32f8eb20"; // Banner of Betrayal  [D] speed
const COMP = "913d1184-e419-4fda-be05-9d36b0fb9ec1"; // Banner of Compulsion [O] look at top 3
const ELY = "73a4ea63-eac9-4050-a484-97aeefe4ab35"; // Banner of Elysium   [E] detach 2
const FURY = "8a0cb0a2-7234-48db-bbd7-4b956a18a274"; // Banner of Fury      [R] strength
const ZERO = "78ddc556-8739-4a1e-bfa6-d5f282c0cf43"; // A Blazing Zero

interface Cfg {
  id: string;
  icon: StapleIcon;
  letter: string;
  other: StapleIcon;
  otherLetter: string;
}
const C_BET: Cfg = { id: BET, icon: "deception", letter: "d", other: "rage", otherLetter: "r" };
const C_COMP: Cfg = { id: COMP, icon: "obsession", letter: "o", other: "rage", otherLetter: "r" };
const C_ELY: Cfg = { id: ELY, icon: "elitism", letter: "e", other: "rage", otherLetter: "r" };
const C_FURY: Cfg = { id: FURY, icon: "rage", letter: "r", other: "deception", otherLetter: "d" };

// --- shared helpers (this file only) ------------------------------------------------

const FK: Record<string, string> = { [P1]: "__factionA", [P2]: "__factionB" };

const rdy = (prefix: string, n: number, owner: PlayerId = P1, icon: StapleIcon = "rage"): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({
    key: `${prefix}${i}`,
    def: resourceCard({ name: `${prefix}${i}`, resource: { provides: [icon], staple: true } }),
    owner,
    zone: "play" as const
  }));
/** `n` already-SPENT resources (attached to the owner's faction): they count toward thresholds but can't pay. */
const spt = (prefix: string, n: number, owner: PlayerId = P1, icon: StapleIcon = "rage"): CardPlacement[] =>
  rdy(prefix, n, owner, icon).map((p) => ({ ...p, attachedToKey: FK[owner] }));

interface Opt {
  ready?: number;
  bannerZone?: "play" | "hand" | "discard" | "deck";
  active?: PlayerId;
  extra?: CardPlacement[];
  deckSize?: number;
  chars?: boolean;
}

function mk(c: Cfg, o: Opt = {}) {
  const prov = (name: string, provides: StapleIcon[]) => resourceCard({ name, resource: { provides, staple: true } });
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "ban", def: printing(c.id), owner: P1, zone: o.bannerZone ?? "play" },
      { key: "rI", def: prov("ResI", [c.icon]), owner: P1, zone: "hand" },
      { key: "rO", def: prov("ResO", [c.other]), owner: P1, zone: "hand" },
      { key: "rB", def: prov("ResB", [c.icon, c.other]), owner: P1, zone: "hand" },
      { key: "rD", def: prov("ResD", [c.icon, c.icon]), owner: P1, zone: "hand" },
      { key: "prov", def: item({ name: "Prov", cost: 0, resource: { provides: [c.icon] } }), owner: P1, zone: "hand" },
      { key: "noprov", def: item({ name: "NoProv", cost: 0 }), owner: P1, zone: "hand" },
      { key: "oRes", def: prov("TheirRes", [c.icon]), owner: P2, zone: "hand" },
      ...(o.chars === false
        ? []
        : [
            { key: "c1", def: character({ name: "C1", strength: 2, speed: 2, life: 3 }), owner: P1, zone: "play" as const },
            { key: "c2", def: character({ name: "C2", strength: 2, speed: 2, life: 3 }), owner: P2, zone: "play" as const }
          ]),
      { key: "c3", def: character({ name: "C3", strength: 2, speed: 2, life: 3 }), owner: P1, zone: "discard" },
      { key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play" },
      { key: "loc", def: location({ name: "Loc" }), owner: P1, zone: "play" },
      ...fillers("d", o.deckSize ?? 6, P1, "deck"),
      ...fillers("e", 6, P2, "deck"),
      ...rdy("rd", o.ready ?? 3, P1, "greed"),
      ...(o.extra ?? [])
    ]
  });
}
type G = ReturnType<typeof mk>;

const ready = (b: { engine: G["engine"] }, p: PlayerId = P1): number => b.engine.getAvailableResourceCount(p);
const kindOf = (b: G): string | undefined => (pending(b.engine) as unknown as { kind: string } | undefined)?.kind;

/** Answers the open pending choice (an orderTriggers prompt is answered first). */
function mayPay(b: G, pay: boolean, player: PlayerId = P1): void {
  if (kindOf(b) === "orderTriggers") {
    answerPending(b.engine, "orderTriggers", { next: ((pending(b.engine) as unknown as { triggers: unknown[] }).triggers)[0] });
  }
  assert.equal(kindOf(b), "mayPay", "asked whether to pay 1");
  b.engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "mayPay", pay } } as never);
  resolvePendingResponses(b.engine);
}
const dev = (b: G, key: string, faceDown = false, p: PlayerId = P1): void => developResource(b.engine, p, b.id(key), faceDown);
const declineIfAsked = (b: G): void => {
  if (kindOf(b) === "orderTriggers" || kindOf(b) === "mayPay") mayPay(b, false);
};
type Via = "res" | "item";
/** Enter play with a provider of the banner's icon: a face-up resource (develop) or a non-resource item (deploy). */
const enter = (b: G, via: Via): void => (via === "res" ? dev(b, "rI") : void play(b.engine, P1, b.id("prov")));
const gain = (via: Via): number => (via === "res" ? 1 : 0);
const pick = (b: G, selected: string[]): void => answerPending(b.engine, "chooserSelectsTarget", { selected });

function thresholdTactic(letter: string) {
  return tactic({
    name: `Need ${letter}`,
    cost: 0,
    threshold: letter as never,
    behavior: { abilities: [{ id: "x", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  } as never);
}

// === PROVIDES + printed stats ====================================================

const statsBody = (c: Cfg) => () => {
  const p = printing(c.id);
  assert.equal(p.type, "item");
  assert.equal(p.trade, "universal");
  assert.deepEqual(p.subtype, ["banner"]);
  assert.equal(p.cost, 2);
  assert.equal(p.threshold, 0);
  // deploy for exactly 2
  const exact = mk(c, { bannerZone: "hand", ready: 2 });
  play(exact.engine, P1, exact.id("ban"));
  declineIfAsked(exact);
  assert.equal(zoneOf(exact.engine, exact.id("ban")), "play");
  assert.equal(ready(exact), 0, "cost 2 was paid");
  // one short
  const short = mk(c, { bannerZone: "hand", ready: 1 });
  refused(() => play(short.engine, P1, short.id("ban")), "cost 2 with 1 ready resource", /pay|afford|resource|cost/i);
  assert.equal(zoneOf(short.engine, short.id("ban")), "hand");
  // no icon requirement: 3 rage resources are enough for any banner, 1 is spare afterwards
  const spare = mk(c, { bannerZone: "hand", ready: 3 });
  play(spare.engine, P1, spare.id("ban"));
  declineIfAsked(spare);
  assert.equal(zoneOf(spare.engine, spare.id("ban")), "play");
  assert.equal(ready(spare), 1, "exactly 2 were paid");
};

const providesBody = (c: Cfg) => () => {
  const need = (letter: string) => ({ key: "need", def: thresholdTactic(letter), owner: P1, zone: "hand" as const });
  // with the banner in play its icon meets a threshold (CR 311.1)
  const on = mk(c, { extra: [need(c.letter)] });
  play(on.engine, P1, on.id("need"));
  assert.equal(zoneOf(on.engine, on.id("need")), "discard", "banner provides its icon");
  // without the banner (still in hand) the threshold is unmet
  const off = mk(c, { bannerZone: "hand", extra: [need(c.letter)] });
  refused(() => play(off.engine, P1, off.id("need")), "no icon without the banner in play", /threshold|icon/i);
  assert.equal(zoneOf(off.engine, off.id("need")), "hand");
  // only ITS icon: a threshold of another icon is not met
  const wrong = mk(c, { extra: [need(c.otherLetter)] });
  refused(() => play(wrong.engine, P1, wrong.id("need")), "banner provides only its own icon", /threshold|icon/i);
  // an opponent's banner does not help me
  const theirs = mk(c, {
    bannerZone: "discard",
    extra: [need(c.letter), { key: "ban2", def: printing(c.id), owner: P2, zone: "play" }]
  });
  refused(() => play(theirs.engine, P1, theirs.id("need")), "opponent's banner gives me no icon", /threshold|icon/i);
  // ONE icon per banner: a two-icon threshold is not met by a single banner, but is by two
  const one = mk(c, { extra: [need(c.letter + c.letter)] });
  refused(() => play(one.engine, P1, one.id("need")), "a single banner provides one icon only", /threshold|icon/i);
  const two = mk(c, { extra: [need(c.letter + c.letter), { key: "ban2", def: printing(c.id), owner: P1, zone: "play" }] });
  play(two.engine, P1, two.id("need"));
  assert.equal(zoneOf(two.engine, two.id("need")), "discard", "two banners provide two icons");
  // a banner in the discard pile provides nothing
  const disc = mk(c, { bannerZone: "discard", extra: [need(c.letter)] });
  refused(() => play(disc.engine, P1, disc.id("need")), "discarded banner provides nothing", /threshold|icon/i);
};

// === trigger (shared half of the rule clause) ====================================

const acceptBody = (c: Cfg) => () => {
  const b = mk(c);
  const before = ready(b);
  dev(b, "rI");
  assert.equal(kindOf(b), "mayPay", "a resource providing the icon entered play under my control");
  assert.equal((pending(b.engine) as unknown as { playerId: string }).playerId, P1);
  mayPay(b, true);
  // +1 new resource, -1 paid: exactly 1 was paid
  assert.equal(ready(b) - before, 1 - 1);
  // exactly one prompt (the resource both "was played" and "entered play")
  const pc = pending(b.engine) as unknown as { kind: string } | undefined;
  assert.notEqual(pc?.kind, "mayPay", "no second payment prompt");
};

const declineBody = (c: Cfg) => () => {
  const b = mk(c);
  const before = ready(b);
  dev(b, "rI");
  mayPay(b, false);
  assert.equal(pending(b.engine), undefined, "declining ends the trigger: no follow-up pick");
  assert.equal(ready(b) - before, 1, "only the developed resource, nothing paid");
};

const unpayableBody = (c: Cfg) => () => {
  // an item providing the icon (cost 0) deployed with 0 ready resources: the 1 cannot be paid
  const none = mk(c, { ready: 0 });
  play(none.engine, P1, none.id("prov"));
  assert.equal(zoneOf(none.engine, none.id("prov")), "play");
  if (kindOf(none) === "mayPay") refused(() => mayPay(none, true), "cannot pay 1 with no ready resources");
  assert.equal(ready(none), 0);
  assert.notEqual(kindOf(none), "chooserSelectsTarget", "no effect without paying");
  assert.notEqual(kindOf(none), "reorderDeck");
  // exactly 1 ready resource is enough
  const one = mk(c, { ready: 1 });
  play(one.engine, P1, one.id("prov"));
  assert.equal(kindOf(one), "mayPay", "control: with 1 ready resource it prompts");
  mayPay(one, true);
  assert.equal(ready(one), 0, "the 1 was paid");
};

const variantsBody = (c: Cfg) => () => {
  for (const k of ["rB", "rD"]) {
    const b = mk(c);
    dev(b, k);
    assert.equal(kindOf(b), "mayPay", `${k}: provides at least the icon`);
    mayPay(b, false);
    assert.equal(pending(b.engine), undefined, `${k}: only one prompt`);
  }
  const other = mk(c);
  dev(other, "rO");
  assert.equal(pending(other.engine), undefined, "a resource without the icon: no prompt");
  const down = mk(c);
  dev(down, "rI", true);
  assert.equal(pending(down.engine), undefined, "face-down: provides only Volition, no prompt");
  const item1 = mk(c);
  play(item1.engine, P1, item1.id("prov"));
  assert.equal(kindOf(item1), "mayPay", "a non-resource card providing the icon triggers it too");
  mayPay(item1, false);
  const item2 = mk(c);
  play(item2.engine, P1, item2.id("noprov"));
  assert.equal(pending(item2.engine), undefined, "a card not providing the icon: no prompt");
  const ctrl = mk(c);
  dev(ctrl, "rI");
  assert.equal(kindOf(ctrl), "mayPay", "control: face-up icon resource prompts");
};

const thiefDef = (selectorOwner: "opponent") =>
  item({
    name: "Thief",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "steal",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", owner: selectorOwner, type: "item" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  } as never);

const controlBody = (c: Cfg) => () => {
  // the opponent's resource entering under THEIR control (their turn): I am not asked
  const theirs = mk(c, { active: P2 });
  dev(theirs, "oRes", false, P2);
  assert.equal(pending(theirs.engine), undefined, "opponent's provider does not trigger my banner");
  // ... but the opponent's own banner prompts them
  const own = mk(c, {
    active: P2,
    bannerZone: "discard",
    extra: [{ key: "ban2", def: printing(c.id), owner: P2, zone: "play" }]
  });
  dev(own, "oRes", false, P2);
  assert.equal(kindOf(own), "mayPay");
  assert.equal((pending(own.engine) as unknown as { playerId: string }).playerId, P2, "the banner's controller is asked");
  // an opponent-OWNED provider entering under MY control triggers (control, not ownership)
  const steal = mk(c, {
    extra: [
      { key: "thief", def: thiefDef("opponent"), owner: P1, zone: "play" },
      { key: "stolen", def: item({ name: "Stolen", cost: 0, resource: { provides: [c.icon] } }), owner: P2, zone: "discard" }
    ]
  });
  activate(steal.engine, P1, steal.id("thief"), "steal", { selected: { t: [steal.id("stolen")] } });
  assert.equal(steal.engine.state.cards[steal.id("stolen")].controllerId, P1);
  assert.equal(steal.engine.state.cards[steal.id("stolen")].ownerId, P2);
  assert.equal(kindOf(steal), "mayPay", "entering under my control triggers my banner");
  mayPay(steal, false);
  // my provider entering under the OPPONENT's control does not
  const lose = mk(c, {
    active: P2,
    extra: [
      { key: "thief", def: thiefDef("opponent"), owner: P2, zone: "play" },
      { key: "mine", def: item({ name: "Mine", cost: 0, resource: { provides: [c.icon] } }), owner: P1, zone: "discard" }
    ]
  });
  activate(lose.engine, P2, lose.id("thief"), "steal", { selected: { t: [lose.id("mine")] } });
  assert.equal(lose.engine.state.cards[lose.id("mine")].controllerId, P2, "control passed to the opponent");
  assert.equal(pending(lose.engine), undefined, "it entered under their control: my banner stays quiet");
};

const zoneBody = (c: Cfg) => () => {
  for (const z of ["hand", "discard", "deck"] as const) {
    const b = mk(c, { bannerZone: z });
    dev(b, "rI");
    assert.equal(pending(b.engine), undefined, `banner in ${z}: no prompt`);
  }
  const ctrl = mk(c);
  dev(ctrl, "rI");
  assert.equal(kindOf(ctrl), "mayPay", "control: banner in play prompts");
  // once the banner is burned it no longer triggers
  const burned = mk(c);
  activate(burned.engine, P1, burned.id("ban"), "burn");
  assert.equal(zoneOf(burned.engine, burned.id("ban")), "discard");
  dev(burned, "rI");
  assert.equal(pending(burned.engine), undefined, "destroyed banner: no prompt");
};

const twoBody = (c: Cfg) => () => {
  const b = mk(c, { extra: [{ key: "ban2", def: printing(c.id), owner: P1, zone: "play" }] });
  dev(b, "rI");
  let guard = 0;
  let payments = 0;
  while (pending(b.engine) && guard++ < 10) {
    const k = kindOf(b);
    if (k === "mayPay" || k === "orderTriggers") {
      mayPay(b, true);
      payments++;
    } else if (k === "chooserSelectsTarget") {
      const pc = pending(b.engine) as unknown as { declaration: { selector: { type?: string } } };
      if (pc.declaration.selector.type === "character") pick(b, [b.id("c1")]);
      else {
        const attached = b.engine.state.players[P1].play.filter((id) => b.engine.isResource(id) && b.engine.state.cards[id].attachedTo !== undefined);
        pick(b, attached.slice(0, 2));
      }
    } else if (k === "reorderDeck") {
      const pc = pending(b.engine) as unknown as { cardIds: string[] };
      answerPending(b.engine, "reorderDeck", { order: pc.cardIds, bottom: [] });
    } else break;
  }
  assert.equal(pending(b.engine), undefined);
  assert.equal(payments, 2, "both banners ask for their payment and both are paid");
};

const selfBody = (c: Cfg) => () => {
  // user ruling 2026-10-27: the banner must already be in play when a provider enters, so its own entry does not trigger it
  const b = mk(c, { bannerZone: "hand", ready: 3 });
  play(b.engine, P1, b.id("ban"));
  assert.equal(zoneOf(b.engine, b.id("ban")), "play");
  assert.equal(ready(b), 1, "cost 2 paid");
  assert.equal(pending(b.engine), undefined, "the banner's own entry asks nothing");
  dev(b, "rI");
  assert.equal(kindOf(b), "mayPay", "the next provider entering does trigger it");
  mayPay(b, true);
  assert.equal(ready(b), 1, "the 1 was paid (the developed resource added one)");
};

// === BURN IT ================================================================

const burnBody = (c: Cfg) => () => {
  const b = mk(c);
  const top = b.engine.state.players[P1].deck.slice(0, 3);
  const handBefore = [...b.engine.state.players[P1].hand];
  const theirHand = [...b.engine.state.players[P2].hand];
  activate(b.engine, P1, b.id("ban"), "burn");
  assert.equal(pending(b.engine), undefined);
  assert.equal(ready(b), 3 - 2, "COST: pay 2");
  assert.equal(zoneOf(b.engine, b.id("ban")), "discard", "COST: destroyed");
  const hand = b.engine.state.players[P1].hand;
  assert.equal(hand.length - handBefore.length, 2, "draw exactly 2");
  assert.deepEqual(hand.filter((x) => !handBefore.includes(x)).sort(), [top[0], top[1]].sort());
  assert.equal(b.engine.state.players[P1].deck.length, 4);
  assert.equal(b.engine.state.players[P1].deck[0], top[2]);
  assert.deepEqual(b.engine.state.players[P2].hand, theirHand, "opponent draws nothing");
  assert.equal(b.engine.state.players[P2].deck.length, 6);
};

const burnRefuseBody = (c: Cfg) => () => {
  const one = mk(c, { ready: 1 });
  const handLen = one.engine.state.players[P1].hand.length;
  refused(() => activate(one.engine, P1, one.id("ban"), "burn"), "pay 2 with 1 ready resource", /pay|afford|resource|cost/i);
  assert.equal(zoneOf(one.engine, one.id("ban")), "play", "nothing happened");
  assert.equal(one.engine.state.players[P1].hand.length, handLen, "hand untouched");
  const ctrl = mk(c, { ready: 2 });
  activate(ctrl.engine, P1, ctrl.id("ban"), "burn");
  assert.equal(zoneOf(ctrl.engine, ctrl.id("ban")), "discard", "control: exactly 2 resources is enough");
  assert.equal(ready(ctrl), 0);
  // the opponent cannot use my banner
  const opp = mk(c);
  refused(() => activate(opp.engine, P2, opp.id("ban"), "burn"), "not its controller");
  assert.equal(zoneOf(opp.engine, opp.id("ban")), "play");
  // not from hand
  const hand = mk(c, { bannerZone: "hand" });
  refused(() => activate(hand.engine, P1, hand.id("ban"), "burn"), "banner must be in play");
  assert.equal(zoneOf(hand.engine, hand.id("ban")), "hand");
};

const burnGoneBody = (c: Cfg) => () => {
  const need = { key: "need", def: thresholdTactic(c.letter), owner: P1, zone: "hand" as const };
  const b = mk(c, { extra: [need] });
  activate(b.engine, P1, b.id("ban"), "burn");
  assert.equal(zoneOf(b.engine, b.id("ban")), "discard");
  refused(() => play(b.engine, P1, b.id("need")), "destroyed banner no longer provides its icon", /threshold|icon/i);
};

// === Betrayal / Fury (+1 stat to a picked character) ==============================

type Stat = "speed" | "strength";
const otherStat = (s: Stat): Stat => (s === "speed" ? "strength" : "speed");

const statAcceptBody = (c: Cfg, stat: Stat, via: Via = "res") => () => {
  const b = mk(c);
  const before = ready(b);
  enter(b, via);
  mayPay(b, true);
  assert.equal(kindOf(b), "chooserSelectsTarget", "pick a character");
  assert.equal((pending(b.engine) as unknown as { playerId: string }).playerId, P1);
  assert.equal(ready(b) - before, gain(via) - 1, "the 1 is already paid while the pick is open");
  pick(b, [b.id("c1")]);
  assert.equal(pending(b.engine), undefined);
  assert.equal(b.engine.getStat(b.id("c1"), stat), 3, `+1 ${stat}`);
  assert.equal(b.engine.getStat(b.id("c1"), otherStat(stat)), 2, `${otherStat(stat)} unchanged`);
  assert.equal(b.engine.getStat(b.id("c1"), "life"), 3, "life unchanged");
  assert.equal(b.engine.getStat(b.id("c2"), stat), 2, "the other character is unaffected");
  endTurn(b.engine, P1);
  assert.equal(b.engine.getStat(b.id("c1"), stat), 2, "until end of turn");
  assert.equal(b.engine.getStat(b.id("c2"), stat), 2);
};

const statOpponentBody = (c: Cfg, stat: Stat, via: Via = "res") => () => {
  const b = mk(c);
  enter(b, via);
  mayPay(b, true);
  pick(b, [b.id("c2")]);
  assert.equal(b.engine.getStat(b.id("c2"), stat), 3, "any character, including the opponent's");
  assert.equal(b.engine.getStat(b.id("c1"), stat), 2);
  assert.equal(b.engine.getStat(b.id("c2"), otherStat(stat)), 2);
  endTurn(b.engine, P1);
  assert.equal(b.engine.getStat(b.id("c2"), stat), 2, "until end of turn");
};

const statTargetsBody = (c: Cfg, via: Via = "res") => () => {
  const b = mk(c);
  enter(b, via);
  mayPay(b, true);
  const bad = ["itm", "loc", "ban", "c3", "rd0", "rI"].map((k) => b.id(k));
  for (const id of bad) refused(() => pick(b, [id]), `not a character in play: ${id}`, /legal|target|requires|candidate|not/i);
  refused(() => pick(b, [b.engine.state.players[P2].factionId!]), "a faction is not a character", /legal|target|requires|candidate|not/i);
  refused(() => pick(b, [b.id("c1"), b.id("c2")]), "exactly one character", /requires|legal|target/i);
  assert.equal(kindOf(b), "chooserSelectsTarget", "positive control: the pick is still open");
  pick(b, [b.id("c1")]);
  assert.equal(pending(b.engine), undefined);
};

const statDeclineBody = (c: Cfg, stat: Stat) => () => {
  const b = mk(c);
  dev(b, "rI");
  mayPay(b, false);
  assert.equal(pending(b.engine), undefined);
  assert.equal(b.engine.getStat(b.id("c1"), stat), 2);
  assert.equal(b.engine.getStat(b.id("c2"), stat), 2);
};

const statMandatoryBody = (c: Cfg, stat: Stat) => () => {
  const b = mk(c);
  dev(b, "rI");
  mayPay(b, true);
  refused(() => pick(b, []), "'pick a character' is not optional once you paid", /requires|legal|target/i);
  assert.equal(kindOf(b), "chooserSelectsTarget");
  pick(b, [b.id("c1")]);
  assert.equal(b.engine.getStat(b.id("c1"), stat), 3);
};

const statNoCharBody = (c: Cfg) => () => {
  const b = mk(c, { chars: false });
  const before = ready(b);
  dev(b, "rI");
  mayPay(b, true);
  assert.equal(pending(b.engine), undefined, "no character to pick: nothing more to do");
  assert.equal(ready(b) - before, 0, "the 1 was paid");
};

const statStackBody = (c: Cfg, stat: Stat) => () => {
  const b = mk(c, { extra: [{ key: "ban2", def: printing(c.id), owner: P1, zone: "play" }] });
  dev(b, "rI");
  let guard = 0;
  while (pending(b.engine) && guard++ < 8) {
    if (kindOf(b) === "chooserSelectsTarget") pick(b, [b.id("c1")]);
    else mayPay(b, true);
  }
  assert.equal(b.engine.getStat(b.id("c1"), stat), 4, "two banners: +2");
  assert.equal(b.engine.getStat(b.id("c2"), stat), 2);
};

// === Compulsion =============================================================

interface Reorder {
  kind: string;
  playerId: string;
  deckOwnerId: string;
  cardIds: string[];
  to: string;
}
const reorder = (b: G): Reorder => pending(b.engine) as unknown as Reorder;
const deckOf = (b: G, p: PlayerId = P1): string[] => b.engine.state.players[p].deck;
const lookBoard = (c: Cfg, o: Opt = {}, via: Via = "res"): { b: G; top: string[]; rest: string[] } => {
  const b = mk(c, o);
  const all = [...deckOf(b)];
  enter(b, via);
  mayPay(b, true);
  return { b, top: all.slice(0, 3), rest: all.slice(3) };
};
const answerSplit = (b: G, order: string[], bottom: string[]): void => answerPending(b.engine, "reorderDeck", { order, bottom });

const compLookBody = (c: Cfg, via: Via = "res") => () => {
  const b = mk(c);
  const all = [...deckOf(b)];
  const before = ready(b);
  const hand = [...b.engine.state.players[P1].hand];
  enter(b, via);
  mayPay(b, true);
  const pc = reorder(b);
  assert.equal(pc.kind, "reorderDeck");
  assert.equal(pc.playerId, P1, "I decide");
  assert.equal(pc.deckOwnerId, P1, "my deck");
  assert.deepEqual(pc.cardIds, all.slice(0, 3), "the top 3 cards");
  assert.equal(pc.to, "split", "any number to the bottom, the rest on top");
  assert.equal(ready(b) - before, gain(via) - 1, "paid 1 already");
  answerSplit(b, all.slice(0, 3), []);
  assert.deepEqual(deckOf(b), all, "nothing moved");
  assert.deepEqual(b.engine.state.players[P1].hand.filter((x) => !hand.includes(x)), [], "looking draws nothing");
  assert.equal(pending(b.engine), undefined);
  assert.deepEqual(deckOf(b, P2).length, 6, "opponent's deck untouched");
};

const compTopBody = (c: Cfg, via: Via = "res") => () => {
  const { b, top, rest } = lookBoard(c, {}, via);
  answerSplit(b, [top[2], top[0], top[1]], []);
  assert.deepEqual(deckOf(b), [top[2], top[0], top[1], ...rest], "all three back on top in the chosen order");
  assert.equal(pending(b.engine), undefined);
};

const compBottomBody = (c: Cfg, via: Via = "res") => () => {
  const one = lookBoard(c, {}, via);
  answerSplit(one.b, [one.top[0], one.top[2]], [one.top[1]]);
  assert.deepEqual(deckOf(one.b), [one.top[0], one.top[2], ...one.rest, one.top[1]], "one to the bottom, two stay on top");
  const two = lookBoard(c, {}, via);
  answerSplit(two.b, [two.top[1]], [two.top[2], two.top[0]]);
  assert.deepEqual(deckOf(two.b), [two.top[1], ...two.rest, two.top[2], two.top[0]], "bottom pile in the chosen order");
  const all = lookBoard(c, {}, via);
  answerSplit(all.b, [], [all.top[1], all.top[0], all.top[2]]);
  assert.deepEqual(deckOf(all.b), [...all.rest, all.top[1], all.top[0], all.top[2]], "all three to the bottom, in any order");
  assert.equal(deckOf(all.b).length, 6);
};

const compInvalidBody = (c: Cfg) => () => {
  const { b, top, rest } = lookBoard(c);
  refused(() => answerSplit(b, [top[0], top[1]], []), "a looked-at card is missing", /exactly|each once|looked/i);
  refused(() => answerSplit(b, [top[0], top[1], rest[0]], []), "a card that was not looked at", /exactly|each once|looked/i);
  refused(() => answerSplit(b, [top[0], top[0], top[1]], [top[2]]), "a card twice", /exactly|each once|looked/i);
  refused(() => answerSplit(b, [top[0], top[1], top[2]], [top[2]]), "a card on both piles", /exactly|each once|looked/i);
  assert.deepEqual(deckOf(b), [...top, ...rest], "positive control: the deck is unchanged after refusals");
  answerSplit(b, top, []);
  assert.equal(pending(b.engine), undefined);
};

const compDeclineBody = (c: Cfg) => () => {
  const b = mk(c);
  const all = [...deckOf(b)];
  const before = ready(b);
  dev(b, "rI");
  mayPay(b, false);
  assert.equal(pending(b.engine), undefined, "no look");
  assert.deepEqual(deckOf(b), all);
  assert.equal(ready(b) - before, 1);
};

const compShortBody = (c: Cfg) => () => {
  const two = mk(c, { deckSize: 2 });
  const all = [...deckOf(two)];
  dev(two, "rI");
  mayPay(two, true);
  assert.deepEqual(reorder(two).cardIds, all, "only the 2 cards there are");
  answerSplit(two, [all[1]], [all[0]]);
  assert.deepEqual(deckOf(two), [all[1], all[0]]);
  const none = mk(c, { deckSize: 0 });
  dev(none, "rI");
  mayPay(none, true);
  assert.equal(pending(none.engine), undefined, "empty deck: nothing to look at");
  assert.deepEqual(deckOf(none), []);
};

// === Elysium ================================================================

const elyExtra = (): CardPlacement[] => [...spt("s", 4), ...spt("o", 2, P2)];
interface Pick {
  kind: string;
  playerId: string;
  declaration: { count: number; optional?: boolean };
}
const attachedTo = (b: G, key: string): string | undefined => b.engine.state.cards[b.id(key)].attachedTo;

const elyAcceptBody = (c: Cfg, via: Via = "res") => () => {
  const b = mk(c, { extra: elyExtra() });
  assert.equal(attachedCount(b.engine, P1), 4);
  assert.equal(ready(b), 3);
  enter(b, via);
  mayPay(b, true);
  const pc = pending(b.engine) as unknown as Pick;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  assert.equal(pc.declaration.count, 2, "detach 2");
  assert.equal(ready(b), 2 + gain(via), "+1 new resource (resource entry only), -1 paid, already");
  assert.equal(attachedCount(b.engine, P1), 5, "the paid resource is attached");
  pick(b, [b.id("s0"), b.id("s1")]);
  assert.equal(pending(b.engine), undefined);
  assert.equal(attachedTo(b, "s0"), undefined, "s0 detached");
  assert.equal(attachedTo(b, "s1"), undefined, "s1 detached");
  assert.equal(attachedTo(b, "s2"), b.engine.state.players[P1].factionId, "s2 still attached");
  assert.equal(attachedTo(b, "s3"), b.engine.state.players[P1].factionId, "s3 still attached");
  assert.equal(attachedCount(b.engine, P1), 3, "exactly 2 detached");
  assert.equal(ready(b), 4 + gain(via), "the two detached resources are ready again");
  assert.equal(attachedCount(b.engine, P2), 2, "the opponent's attached resources are untouched");
};

const elyTargetsBody = (c: Cfg, via: Via = "res") => () => {
  const b = mk(c, { extra: elyExtra() });
  enter(b, via);
  mayPay(b, true);
  const unattached = b.engine.state.players[P1].play.find(
    (id) => b.engine.isResource(id) && b.engine.state.cards[id].attachedTo === undefined
  )!;
  refused(() => pick(b, [b.id("o0"), b.id("o1")]), "the opponent's faction resources", /legal|target|requires|candidate/i);
  refused(() => pick(b, [b.id("s0"), b.id("o0")]), "one of them is the opponent's", /legal|target|requires|candidate/i);
  refused(() => pick(b, [b.id("c1"), b.id("s0")]), "a character", /legal|target|requires|candidate/i);
  refused(() => pick(b, [unattached, b.id("s0")]), "a resource that is not attached to my faction", /legal|target|requires|candidate/i);
  refused(() => pick(b, [b.id("s0"), b.id("s1"), b.id("s2")]), "only 2", /requires|legal|target/i);
  assert.equal(kindOf(b), "chooserSelectsTarget", "positive control: still open");
  pick(b, [b.id("s2"), b.id("s3")]);
  assert.equal(attachedTo(b, "s2"), undefined);
  assert.equal(attachedTo(b, "s3"), undefined);
  assert.equal(attachedCount(b.engine, P1), 3);
};

const elyDeclineBody = (c: Cfg) => () => {
  const b = mk(c, { extra: elyExtra() });
  dev(b, "rI");
  mayPay(b, false);
  assert.equal(pending(b.engine), undefined);
  assert.equal(attachedCount(b.engine, P1), 4, "nothing paid, nothing detached");
  assert.equal(ready(b), 4);
};

const elyFewBody = (c: Cfg) => () => {
  // nothing attached before: only the paid resource is attached, and it is detached as far as possible
  const none = mk(c);
  dev(none, "rI");
  mayPay(none, true);
  assert.equal(attachedCount(none.engine, P1), 1, "just the paid resource");
  const only = none.engine.state.players[P1].play.find((id) => none.engine.isResource(id) && none.engine.state.cards[id].attachedTo !== undefined)!;
  if (pending(none.engine)) pick(none, [only]);
  assert.equal(pending(none.engine), undefined);
  assert.equal(attachedCount(none.engine, P1), 0);
  assert.equal(ready(none), 4, "all four resources ready again");
  // exactly two attached (one spent before + the paid one)
  const two = mk(c, { extra: spt("s", 1) });
  dev(two, "rI");
  mayPay(two, true);
  assert.equal(attachedCount(two.engine, P1), 2);
  const both = two.engine.state.players[P1].play.filter((id) => two.engine.isResource(id) && two.engine.state.cards[id].attachedTo !== undefined);
  pick(two, both);
  assert.equal(attachedCount(two.engine, P1), 0);
  assert.equal(ready(two), 5);
};

const elyMandNoneBody = (c: Cfg) => () => {
  const none = mk(c, { extra: elyExtra() });
  dev(none, "rI");
  mayPay(none, true);
  refused(() => pick(none, []), "'detach 2 resources' is not optional", /requires|legal|target/i);
  assert.equal(kindOf(none), "chooserSelectsTarget");
};

const elyMandOneBody = (c: Cfg) => () => {
  const one = mk(c, { extra: elyExtra() });
  dev(one, "rI");
  mayPay(one, true);
  refused(() => pick(one, [one.id("s0")]), "'detach 2' means two, not one, when 2+ are attached", /requires|legal|target/i);
  assert.equal(kindOf(one), "chooserSelectsTarget");
};

// === registrations ===========================================================

// --- Banner of Betrayal ---
clause(BET, "0:provides", "printed cost 2, item / universal / banner, no threshold: deploy for exactly 2, refused one short", statsBody(C_BET));
clause(BET, "0:provides", "PROVIDES [D]: counts toward thresholds while in play (own, in play only, only its icon)", providesBody(C_BET));
clause(BET, "1:rule", "a face-up resource providing [D] entering under my control: pay 1 (exactly once)", acceptBody(C_BET));
clause(BET, "1:rule", "declining the payment: nothing is paid and no pick follows", declineBody(C_BET));
clause(BET, "1:rule", "'pay 1' needs a ready resource: refused with none, fine with one", unpayableBody(C_BET));
clause(BET, "1:rule", "'provides at least [D]': multi-icon cards trigger, other icons, face-down and non-providing cards don't; non-resource providers do", variantsBody(C_BET));
clause(BET, "1:rule", "only cards entering under YOUR control (not their provider; their banner asks them; control not ownership)", controlBody(C_BET));
clause(BET, "1:rule", "only works while the banner is in play (not in hand, discard, deck; not after it is burned)", zoneBody(C_BET));
clause(BET, "1:rule", "two banners both trigger and both are paid", twoBody(C_BET));
clause(BET, "1:rule", "the banner itself provides [D], but its own entry does not trigger it (user ruling 2026-10-27): the next provider does", selfBody(C_BET));
clause(BET, "1:rule", "pick a character: it gains 1 speed this turn, others don't, wears off at end of turn", statAcceptBody(C_BET, "speed"));
clause(BET, "1:rule", "any character may be picked, including the opponent's", statOpponentBody(C_BET, "speed"));
clause(BET, "1:rule", "only a single character in play is pickable (no items, locations, banner, discard, resources, factions)", statTargetsBody(C_BET));
clause(BET, "1:rule", "declining to pay: no speed gained", statDeclineBody(C_BET, "speed"));
clause(BET, "1:rule", "with no character in play the 1 is paid and nothing else happens", statNoCharBody(C_BET));
clause(BET, "1:rule", "two banners stack: +2 speed", statStackBody(C_BET, "speed"));
clause(BET, "1:rule", "once paid, the pick is mandatory", statMandatoryBody(C_BET, "speed"));
clause(BET, "2:ability:burn", "BURN IT: pay 2, destroy the banner, draw 2", burnBody(C_BET));
clause(BET, "2:ability:burn", "BURN IT: refused with 1 resource, by the opponent, or from hand", burnRefuseBody(C_BET));
clause(BET, "2:ability:burn", "BURN IT: the destroyed banner no longer provides [D]", burnGoneBody(C_BET));

// --- Banner of Fury ---
clause(FURY, "0:provides", "printed cost 2, item / universal / banner, no threshold: deploy for exactly 2, refused one short", statsBody(C_FURY));
clause(FURY, "0:provides", "PROVIDES [R]: counts toward thresholds while in play (own, in play only, only its icon)", providesBody(C_FURY));
clause(FURY, "1:rule", "a face-up resource providing [R] entering under my control: pay 1 (exactly once)", acceptBody(C_FURY));
clause(FURY, "1:rule", "declining the payment: nothing is paid and no pick follows", declineBody(C_FURY));
clause(FURY, "1:rule", "'pay 1' needs a ready resource: refused with none, fine with one", unpayableBody(C_FURY));
clause(FURY, "1:rule", "'provides at least [R]': multi-icon cards trigger, other icons, face-down and non-providing cards don't; non-resource providers do", variantsBody(C_FURY));
clause(FURY, "1:rule", "only cards entering under YOUR control (not their provider; their banner asks them; control not ownership)", controlBody(C_FURY));
clause(FURY, "1:rule", "only works while the banner is in play (not in hand, discard, deck; not after it is burned)", zoneBody(C_FURY));
clause(FURY, "1:rule", "two banners both trigger and both are paid", twoBody(C_FURY));
clause(FURY, "1:rule", "the banner itself provides [R], but its own entry does not trigger it (user ruling 2026-10-27): the next provider does", selfBody(C_FURY));
clause(FURY, "1:rule", "pick a character: it gains 1 strength this turn, others don't, wears off at end of turn", statAcceptBody(C_FURY, "strength"));
clause(FURY, "1:rule", "any character may be picked, including the opponent's", statOpponentBody(C_FURY, "strength"));
clause(FURY, "1:rule", "only a single character in play is pickable (no items, locations, banner, discard, resources, factions)", statTargetsBody(C_FURY));
clause(FURY, "1:rule", "declining to pay: no strength gained", statDeclineBody(C_FURY, "strength"));
clause(FURY, "1:rule", "with no character in play the 1 is paid and nothing else happens", statNoCharBody(C_FURY));
clause(FURY, "1:rule", "two banners stack: +2 strength", statStackBody(C_FURY, "strength"));
clause(FURY, "1:rule", "once paid, the pick is mandatory", statMandatoryBody(C_FURY, "strength"));
clause(FURY, "2:ability:burn", "BURN IT: pay 2, destroy the banner, draw 2", burnBody(C_FURY));
clause(FURY, "2:ability:burn", "BURN IT: refused with 1 resource, by the opponent, or from hand", burnRefuseBody(C_FURY));
clause(FURY, "2:ability:burn", "BURN IT: the destroyed banner no longer provides [R]", burnGoneBody(C_FURY));

// --- Banner of Compulsion ---
clause(COMP, "0:provides", "printed cost 2, item / universal / banner, no threshold: deploy for exactly 2, refused one short", statsBody(C_COMP));
clause(COMP, "0:provides", "PROVIDES [O]: counts toward thresholds while in play (own, in play only, only its icon)", providesBody(C_COMP));
clause(COMP, "1:rule", "a face-up resource providing [O] entering under my control: pay 1 (exactly once)", acceptBody(C_COMP));
clause(COMP, "1:rule", "declining the payment: nothing is paid and no look follows", declineBody(C_COMP));
clause(COMP, "1:rule", "'pay 1' needs a ready resource: refused with none, fine with one", unpayableBody(C_COMP));
clause(COMP, "1:rule", "'provides at least [O]': multi-icon cards trigger, other icons, face-down and non-providing cards don't; non-resource providers do", variantsBody(C_COMP));
clause(COMP, "1:rule", "only cards entering under YOUR control (not their provider; their banner asks them; control not ownership)", controlBody(C_COMP));
clause(COMP, "1:rule", "only works while the banner is in play (not in hand, discard, deck; not after it is burned)", zoneBody(C_COMP));
clause(COMP, "1:rule", "two banners both trigger and both are paid", twoBody(C_COMP));
clause(COMP, "1:rule", "the banner itself provides [O], but its own entry does not trigger it (user ruling 2026-10-27): the next provider does", selfBody(C_COMP));
clause(COMP, "1:rule", "look at the top 3 cards of your deck (mine, chosen by me, nothing drawn)", compLookBody(C_COMP));
clause(COMP, "1:rule", "all cards may stay on top in any order", compTopBody(C_COMP));
clause(COMP, "1:rule", "any number (1, 2 or all 3) go to the bottom in the chosen order, the rest stay on top in the chosen order", compBottomBody(C_COMP));
clause(COMP, "1:rule", "the piles must be exactly the looked-at cards, each once", compInvalidBody(C_COMP));
clause(COMP, "1:rule", "declining to pay: the deck is not looked at or changed", compDeclineBody(C_COMP));
clause(COMP, "1:rule", "a deck of fewer than 3 cards shows what is there; an empty deck shows nothing", compShortBody(C_COMP));
clause(COMP, "2:ability:burn", "BURN IT: pay 2, destroy the banner, draw 2", burnBody(C_COMP));
clause(COMP, "2:ability:burn", "BURN IT: refused with 1 resource, by the opponent, or from hand", burnRefuseBody(C_COMP));
clause(COMP, "2:ability:burn", "BURN IT: the destroyed banner no longer provides [O]", burnGoneBody(C_COMP));

// --- Banner of Elysium ---
clause(ELY, "0:provides", "printed cost 2, item / universal / banner, no threshold: deploy for exactly 2, refused one short", statsBody(C_ELY));
clause(ELY, "0:provides", "PROVIDES [E]: counts toward thresholds while in play (own, in play only, only its icon)", providesBody(C_ELY));
clause(ELY, "1:rule", "a face-up resource providing [E] entering under my control: pay 1 (exactly once)", acceptBody(C_ELY));
clause(ELY, "1:rule", "declining the payment: nothing is paid and nothing detached", declineBody(C_ELY));
clause(ELY, "1:rule", "'pay 1' needs a ready resource: refused with none, fine with one", unpayableBody(C_ELY));
clause(ELY, "1:rule", "'provides at least [E]': multi-icon cards trigger, other icons, face-down and non-providing cards don't; non-resource providers do", variantsBody(C_ELY));
clause(ELY, "1:rule", "only cards entering under YOUR control (not their provider; their banner asks them; control not ownership)", controlBody(C_ELY));
clause(ELY, "1:rule", "only works while the banner is in play (not in hand, discard, deck; not after it is burned)", zoneBody(C_ELY));
clause(ELY, "1:rule", "two banners both trigger and both are paid", twoBody(C_ELY));
clause(ELY, "1:rule", "the banner itself provides [E], but its own entry does not trigger it (user ruling 2026-10-27): the next provider does", selfBody(C_ELY));
clause(ELY, "1:rule", "detach 2 resources from your faction: exactly 2 chosen are detached, the others and the opponent's stay", elyAcceptBody(C_ELY));
clause(ELY, "1:rule", "only resources attached to MY faction can be detached", elyTargetsBody(C_ELY));
clause(ELY, "1:rule", "declining to pay: nothing detached", elyDeclineBody(C_ELY));
clause(ELY, "1:rule", "with fewer than 2 attached resources, those that exist are detached", elyFewBody(C_ELY));
clause(ELY, "1:rule", "detaching 2 is mandatory: an empty pick is refused", elyMandNoneBody(C_ELY));
clause(ELY, "1:rule", "detaching 2 is mandatory: a pick of only 1 is refused when 2+ are attached", elyMandOneBody(C_ELY));
clause(ELY, "2:ability:burn", "BURN IT: pay 2, destroy the banner, draw 2", burnBody(C_ELY));
clause(ELY, "2:ability:burn", "BURN IT: refused with 1 resource, by the opponent, or from hand", burnRefuseBody(C_ELY));
clause(ELY, "2:ability:burn", "BURN IT: the destroyed banner no longer provides [E]", burnGoneBody(C_ELY));

// --- entering via a non-resource provider (the second trigger path) ---
clause(BET, "1:rule", "entering as a non-resource provider: pay 1, pick a character, +1 speed this turn, others unaffected, wears off", statAcceptBody(C_BET, "speed", "item"));
clause(BET, "1:rule", "entering as a non-resource provider: the opponent's character may be picked", statOpponentBody(C_BET, "speed", "item"));
clause(BET, "1:rule", "entering as a non-resource provider: only a single character in play is pickable", statTargetsBody(C_BET, "item"));
clause(FURY, "1:rule", "entering as a non-resource provider: pay 1, pick a character, +1 strength this turn, others unaffected, wears off", statAcceptBody(C_FURY, "strength", "item"));
clause(FURY, "1:rule", "entering as a non-resource provider: the opponent's character may be picked", statOpponentBody(C_FURY, "strength", "item"));
clause(FURY, "1:rule", "entering as a non-resource provider: only a single character in play is pickable", statTargetsBody(C_FURY, "item"));
clause(COMP, "1:rule", "entering as a non-resource provider: look at my top 3 cards", compLookBody(C_COMP, "item"));
clause(COMP, "1:rule", "entering as a non-resource provider: all three may stay on top in any order", compTopBody(C_COMP, "item"));
clause(COMP, "1:rule", "entering as a non-resource provider: any number to the bottom in order, the rest on top", compBottomBody(C_COMP, "item"));
clause(ELY, "1:rule", "entering as a non-resource provider: detach exactly 2 chosen resources from my faction", elyAcceptBody(C_ELY, "item"));
clause(ELY, "1:rule", "entering as a non-resource provider: only resources attached to my faction can be detached", elyTargetsBody(C_ELY, "item"));

// === A Blazing Zero ==========================================================

const drawTwo = () =>
  tactic({
    name: "Draw Two",
    cost: 0,
    behavior: { abilities: [{ id: "x", type: "activated", effects: [{ type: "draw", player: "controller", amount: 2 }] }] }
  } as never);
const drawOneP2 = () =>
  tactic({
    name: "Their Draw",
    cost: 0,
    behavior: { abilities: [{ id: "y", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  } as never);
const pingItem = () =>
  item({
    name: "Ping",
    cost: 0,
    behavior: { abilities: [{ id: "ping", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  } as never);

function zb(o: { p2Ready?: number; p2Spent?: number; p2Icon?: StapleIcon; p1Ready?: number } = {}) {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "zero", def: printing(ZERO), owner: P2, zone: "hand" },
      { key: "zero2", def: printing(ZERO), owner: P1, zone: "hand" },
      { key: "x", def: drawTwo(), owner: P1, zone: "hand" },
      { key: "y", def: drawOneP2(), owner: P2, zone: "hand" },
      { key: "ping", def: pingItem(), owner: P1, zone: "play" },
      ...fillers("d", 6, P1, "deck"),
      ...fillers("e", 6, P2, "deck"),
      ...rdy("a", o.p1Ready ?? 3, P1),
      ...rdy("b", o.p2Ready ?? 3, P2, o.p2Icon ?? "rage"),
      ...spt("sp", o.p2Spent ?? 0, P2, "rage")
    ]
  });
}
type Z = ReturnType<typeof zb>;
const zready = (z: Z, p: PlayerId): number => z.engine.getAvailableResourceCount(p);

clause(ZERO, "0:rule", "printed tactic / warlord, cost 1, threshold [R]: playable with exactly one ready [R], refused short of cost or icon", () => {
  const p = printing(ZERO);
  assert.equal(p.type, "tactic");
  assert.equal(p.trade, "warlord");
  assert.equal(p.cost, 1);
  assert.equal(p.threshold, "r");
  const play1 = (z: Z) => {
    playRaw(z.engine, P1, z.id("x"));
    play(z.engine, P2, z.id("zero"));
  };
  const exact = zb({ p2Ready: 1 });
  play1(exact);
  assert.equal(zoneOf(exact.engine, exact.id("zero")), "discard", "exactly 1 ready [R] is enough");
  assert.equal(zready(exact, P2), 0, "cost 1 was paid");
  // cost isolated: [R] is only spent, nothing ready to pay
  const noPay = zb({ p2Ready: 0, p2Spent: 1 });
  playRaw(noPay.engine, P1, noPay.id("x"));
  refused(() => play(noPay.engine, P2, noPay.id("zero")), "cost 1 with only a spent [R]", /pay|afford|resource|cost/i);
  // threshold isolated: ready resource but no [R]
  const noIcon = zb({ p2Ready: 1, p2Icon: "obsession" });
  playRaw(noIcon.engine, P1, noIcon.id("x"));
  refused(() => play(noIcon.engine, P2, noIcon.id("zero")), "no [R] icon", /threshold|icon/i);
  // [R] only from a spent resource, cost paid by a ready non-[R] one
  const mixed = zb({ p2Ready: 1, p2Icon: "obsession", p2Spent: 1 });
  playRaw(mixed.engine, P1, mixed.id("x"));
  play(mixed.engine, P2, mixed.id("zero"));
  assert.equal(zoneOf(mixed.engine, mixed.id("zero")), "discard", "the [R] threshold may be met by a spent resource");
});

clause(ZERO, "0:rule", "in response to a tactic: that tactic is terminated (its effect never happens)", () => {
  const z = zb();
  const handBefore = [...z.engine.state.players[P1].hand];
  const deckBefore = [...z.engine.state.players[P1].deck];
  playRaw(z.engine, P1, z.id("x"));
  assert.equal(z.engine.state.players[P1].hand.length, handBefore.length - 1, "control: X is on the stack");
  play(z.engine, P2, z.id("zero"));
  assert.equal(pending(z.engine), undefined);
  assert.equal(z.engine.state.responseWindow, undefined, "stack empty");
  assert.deepEqual(z.engine.state.players[P1].deck, deckBefore, "Draw Two never resolved: the deck is untouched");
  assert.equal(z.engine.state.players[P1].hand.length, handBefore.length - 1, "no cards drawn");
  assert.equal(zoneOf(z.engine, z.id("zero")), "discard", "A Blazing Zero itself goes to its owner's discard pile");
  assert.equal(zready(z, P2), 2, "cost 1 paid");
  // control: without Zero the tactic does resolve
  const c = zb();
  playRaw(c.engine, P1, c.id("x"));
  resolvePendingResponses(c.engine);
  assert.equal(c.engine.state.players[P1].hand.length, handBefore.length - 1 + 2, "control: Draw Two draws 2");
  assert.equal(zoneOf(c.engine, c.id("x")), "discard");
});

clause(ZERO, "0:rule", "the terminated tactic goes into play under its OWNER's control as a face-down resource, not into the discard pile", () => {
  const z = zb();
  const before = zready(z, P1);
  playRaw(z.engine, P1, z.id("x"));
  play(z.engine, P2, z.id("zero"));
  const card = z.engine.state.cards[z.id("x")];
  assert.equal(card.zone, "play");
  assert.equal(card.faceDown, true, "face-down");
  assert.equal(card.controllerId, P1, "under its owner's control");
  assert.equal(card.ownerId, P1);
  assert.equal(z.engine.isResource(z.id("x")), true, "it is a face-down resource");
  assert.ok(z.engine.state.players[P1].play.includes(z.id("x")), "z.engine.state.players[P1].play.includes(z.id(\"x\"))");
  assert.ok(!z.engine.state.players[P1].discard.includes(z.id("x")), "NOT in their discard pile instead");
  assert.equal(zready(z, P1) - before, 1, "the new face-down resource provides Volition");
  assert.ok(!z.engine.state.players[P2].play.includes(z.id("x")), "not in the Zero player's play area");
});

clause(ZERO, "0:rule", "a tactic whose controller differs from its owner goes into play under its OWNER's control, not its controller's", () => {
  const z = zb();
  // "y" is owned by P1 but controlled (cast) by P2. It's P1's turn, so P1 casts X first and P2 answers it with Y.
  z.engine.state.cards[z.id("y")].ownerId = P1;
  playRaw(z.engine, P1, z.id("x"));
  const before1 = zready(z, P1);
  const before2 = zready(z, P2);
  playRaw(z.engine, P2, z.id("y"));
  assert.equal(z.engine.state.cards[z.id("y")].ownerId, P1, "control: owned by P1");
  assert.equal(z.engine.state.cards[z.id("y")].controllerId, P2, "control: controlled by P2 while on the stack");
  play(z.engine, P1, z.id("zero2"));
  const y = z.engine.state.cards[z.id("y")];
  assert.equal(y.zone, "play", "in play, not a discard pile");
  assert.equal(y.faceDown, true);
  assert.equal(y.ownerId, P1);
  assert.equal(y.controllerId, P1, "under its OWNER's (P1's) control, not the player who deployed it");
  assert.ok(z.engine.state.players[P1].play.includes(z.id("y")), "in its owner's play area");
  assert.ok(!z.engine.state.players[P2].play.includes(z.id("y")), "not in the controller's play area");
  assert.ok(!z.engine.state.players[P1].discard.includes(z.id("y")) && !z.engine.state.players[P2].discard.includes(z.id("y")), "in neither discard pile");
  assert.equal(zready(z, P1) - before1, 0 - 1 + 1, "P1 paid 1 for the Zero and gained the face-down resource");
  assert.equal(zready(z, P2) - before2, 0, "the controller gained no resource");
  assert.equal(z.engine.state.players[P2].deck.length, 6, "the terminated tactic never resolved");
});

clause(ZERO, "0:rule", "owner's control also when the opponent's tactic is terminated by me (the other player's tactic ends in THEIR play area)", () => {
  const z = zb();
  const before2 = zready(z, P2);
  // P2's tactic Y is on the stack, answered by my Zero (P1, zero2)
  playRaw(z.engine, P1, z.id("x"));
  playRaw(z.engine, P2, z.id("y"));
  play(z.engine, P1, z.id("zero2"));
  const y = z.engine.state.cards[z.id("y")];
  assert.equal(y.zone, "play", "Y is in play, not the discard pile");
  assert.equal(y.faceDown, true);
  assert.equal(y.controllerId, P2, "under its owner's (P2's) control");
  assert.equal(z.engine.isResource(z.id("y")), true);
  assert.ok(!z.engine.state.players[P2].discard.includes(z.id("y")), "!z.engine.state.players[P2].discard.includes(z.id(\"y\"))");
  assert.equal(zready(z, P2) - before2, 1, "P2 gained a face-down resource");
  assert.equal(z.engine.state.players[P2].hand.length, z.engine.state.players[P2].hand.length);
  // Y never drew
  assert.equal(z.engine.state.players[P2].deck.length, 6, "their Draw never resolved");
  // only Y was terminated; X (lower on the stack) still resolves
  assert.equal(zoneOf(z.engine, z.id("x")), "discard", "X resolved normally");
  assert.equal(z.engine.state.players[P1].deck.length, 4, "X drew 2");
  assert.equal(zoneOf(z.engine, z.id("zero2")), "discard");
});

clause(ZERO, "0:rule", "terminates only the tactic it responds to: a Zero answering a Zero saves the original tactic", () => {
  const z = zb();
  playRaw(z.engine, P1, z.id("x"));
  playRaw(z.engine, P2, z.id("zero"));
  play(z.engine, P1, z.id("zero2"));
  const z1 = z.engine.state.cards[z.id("zero")];
  assert.equal(z1.zone, "play", "the first Zero was terminated and put into play face-down");
  assert.equal(z1.faceDown, true);
  assert.equal(z1.controllerId, P2);
  assert.equal(zoneOf(z.engine, z.id("zero2")), "discard");
  assert.equal(zoneOf(z.engine, z.id("x")), "discard", "Draw Two resolved normally (its terminator was terminated)");
  assert.equal(z.engine.state.players[P1].deck.length, 4, "Draw Two drew 2");
});

clause(ZERO, "0:rule", "'in response to a tactic' only: in response to a non-tactic, or not in response, nothing is terminated", () => {
  // in response to an ability (not a tactic)
  const z = zb();
  const hand = z.engine.state.players[P1].hand.length;
  z.engine.perform({ type: "activateAbility", playerId: P1, cardId: z.id("ping"), abilityId: "ping", selected: {}, variables: {} } as never);
  play(z.engine, P2, z.id("zero"));
  assert.equal(zoneOf(z.engine, z.id("zero")), "discard");
  assert.equal(z.engine.state.players[P1].hand.length, hand + 1, "the ability resolved and drew its card");
  assert.equal(zoneOf(z.engine, z.id("ping")), "play");
  // not in response to anything (my own turn, nothing on the stack)
  const m = zb();
  const deck = [...m.engine.state.players[P1].deck];
  play(m.engine, P1, m.id("zero2"));
  assert.equal(zoneOf(m.engine, m.id("zero2")), "discard", "it is a plain tactic that resolves with no effect");
  assert.deepEqual(m.engine.state.players[P1].deck, deck);
  assert.equal(m.engine.state.players[P1].play.filter((id) => m.engine.state.cards[id].faceDown).length, 0, "nothing was put into play face-down");
  assert.equal(zready(m, P1), 2, "its cost 1 was paid");
});

clause(ZERO, "0:rule", "in response to a CHARACTER being deployed (a non-tactic card): that card is not terminated and not put into play face-down", () => {
  const z = buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "zero", def: printing(ZERO), owner: P2, zone: "hand" },
      { key: "body", def: character({ name: "Cheap Body", cost: 0, strength: 1, speed: 1, life: 1 }), owner: P1, zone: "hand" },
      ...fillers("d", 6, P1, "deck"),
      ...fillers("e", 6, P2, "deck"),
      ...rdy("a", 3, P1),
      ...rdy("b", 3, P2)
    ]
  });
  playRaw(z.engine, P1, z.id("body"));
  play(z.engine, P2, z.id("zero"));
  assert.equal(zoneOf(z.engine, z.id("zero")), "discard", "the Zero resolved as a plain tactic");
  const body = z.engine.state.cards[z.id("body")];
  assert.equal(body.zone, "play", "the deployed character was NOT terminated: it is in play");
  assert.notEqual(body.faceDown, true, "the character is face-up, not a face-down resource");
});
