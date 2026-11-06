// Clause tests, batch ungodly-mess-10, part p1 (groups 1-6, only clauses not yet covered).
import assert from "node:assert/strict";
import { buildGame, activate, bank, bounceTactic, character, developFaction, item, killTactic, location, P1, P2, play, resolvePendingResponses, tactic, volition } from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, refused, flipUpNow, holdCostChoices } from "./_clause.js";
import { declareAttackBy, declareAttackOpenWindow, fight, finishBattle } from "./_battle.js";
import { answerPending, declareBlockers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { endTurn, factionOf, spentResources } from "./_turn.js";
import type { CardPlacement } from "../support/fixtures.js";
import type { PlayerId } from "../../../engine.js";

const ANY = /./;
type Game = ReturnType<typeof buildGame>;
const ready = (g: Game, p: PlayerId = P1) => readyResources(g.engine, p);
const dmg = (g: Game, key: string): number => g.engine.state.cards[g.id(key)].damage ?? 0;
const str = (g: Game, key: string): number => g.engine.getStat(g.id(key), "strength");
const faction = (g: Game, p: PlayerId) => factionOf(g.engine, p);
const flipUp = (g: Game, key: string, selected: Record<string, string[]> = {}, player: PlayerId = P1) => {
  flipUpNow(g.engine, { type: "flipUp", playerId: player, cardId: g.id(key), selected, variables: {} });
  resolvePendingResponses(g.engine);
};
const baseInf = new WeakMap<object, Record<string, number>>();
const board = (cards: CardPlacement[], turn = 3, active: PlayerId = P1, random: () => number = () => 0.5): Game => {
  const g = buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, turn, activePlayerId: active, cards, random });
  baseInf.set(g, { [P1]: g.engine.state.players[P1].influence, [P2]: g.engine.state.players[P2].influence });
  return g;
};
/** Faction damage = influence lost since the board was built. */
const lost = (g: Game, p: PlayerId): number => baseInf.get(g)![p] - g.engine.state.players[p].influence;
const rage = (n: number, o: PlayerId = P1) => bank("rage", n, o);
const greed = (n: number, o: PlayerId = P1) => bank("greed", n, o);

// =====================================================================
// Severed Limb — item, warlord, gear, cost 0, [R]
// ATTACH TO CHARACTER -- The attached character gains 1 strength. -- BULK UP
// =====================================================================
const SL = "d7a08113-2e68-4b1b-84d0-37558b6ae285";
const hostDef = () => character({ name: "Host", strength: 2, life: 5, text: "plain" });
function slHand(res: CardPlacement[], extra: CardPlacement[] = []): Game {
  return board([
    { key: "limb", def: printing(SL), owner: P1, zone: "hand" },
    { key: "limb2", def: printing(SL), owner: P1, zone: "hand" },
    { key: "host", def: hostDef(), owner: P1, zone: "play" },
    { key: "foe", def: character({ name: "Foe", strength: 4, life: 5, text: "plain" }), owner: P2, zone: "play" },
    { key: "ally", def: character({ name: "Ally", strength: 2, life: 5, text: "plain" }), owner: P1, zone: "play" },
    ...res, ...extra
  ]);
}
function slPlay(res: CardPlacement[], extra: CardPlacement[] = []): Game {
  return board([
    { key: "limb", def: printing(SL), owner: P1, zone: "play", attachedToKey: "host" },
    { key: "host", def: hostDef(), owner: P1, zone: "play" },
    { key: "ally", def: character({ name: "Ally", strength: 2, life: 5, text: "plain" }), owner: P1, zone: "play" },
    ...res, ...extra
  ]);
}
const attach = (g: Game, limb: string, host: string) => play(g.engine, P1, g.id(limb), { selected: { attachTo: [g.id(host)] } });

clause(SL, "0:attach", "printed as an item (gear), cost 0, threshold [R]; deploys attached to a character for no payment", () => {
  const p = printing(SL);
  assert.equal(p.type, "item");
  assert.equal(p.cost, 0);
  assert.equal(p.threshold, "r");
  assert.deepEqual([...(p.subtype ?? [])], ["gear"]);
  const g = slHand(rage(1));
  attach(g, "limb", "host");
  assert.equal(zoneOf(g.engine, g.id("limb")), "play");
  assert.equal(g.engine.state.cards[g.id("limb")].attachedTo, g.id("host"));
  assert.equal(ready(g), 1, "cost 0 pays nothing");
});

clause(SL, "0:attach", "needs [R]: refused with no resources or only Greed, allowed with one Rage", () => {
  refused(() => attach(slHand([]), "limb", "host"), "no resources", ANY);
  const gr = slHand(greed(3));
  refused(() => attach(gr, "limb", "host"), "greed only", ANY);
  assert.equal(zoneOf(gr.engine, gr.id("limb")), "hand");
  const ok = slHand(rage(1));
  attach(ok, "limb", "host");
  assert.equal(zoneOf(ok.engine, ok.id("limb")), "play", "control: one Rage is enough");
});

clause(SL, "0:attach", "attaches to a character of either player; an item, a location, a faction or no pick is refused", () => {
  const opp = slHand(rage(1));
  attach(opp, "limb", "foe");
  assert.equal(opp.engine.state.cards[opp.id("limb")].attachedTo, opp.id("foe"), "an opponent's character is a legal host");
  const extra: CardPlacement[] = [
    { key: "thing", def: item({ name: "Thing", text: "plain" }), owner: P1, zone: "play" },
    { key: "place", def: location({ name: "Place", text: "plain" }), owner: P1, zone: "play" }
  ];
  const g = slHand(rage(1), extra);
  refused(() => attach(g, "limb", "thing"), "item host", ANY);
  refused(() => attach(g, "limb", "place"), "location host", ANY);
  refused(() => play(g.engine, P1, g.id("limb"), { selected: { attachTo: [faction(g, P1)] } }), "faction host", ANY);
  refused(() => play(g.engine, P1, g.id("limb")), "no host picked", ANY);
  assert.equal(zoneOf(g.engine, g.id("limb")), "hand");
  attach(g, "limb", "host");
  assert.equal(g.engine.state.cards[g.id("limb")].attachedTo, g.id("host"), "control: a character host works");
});

clause(SL, "0:attach", "when the host leaves play the Limb leaves with it; when the host returns to hand the Limb goes too", () => {
  const g = slHand(rage(1), [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }]);
  attach(g, "limb", "host");
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("host")] } });
  assert.equal(zoneOf(g.engine, g.id("host")), "discard");
  assert.equal(zoneOf(g.engine, g.id("limb")), "discard", "the attachment follows its destroyed host");
  const b = slHand(rage(1), [{ key: "bnc", def: bounceTactic(), owner: P1, zone: "hand" }]);
  attach(b, "limb", "host");
  play(b.engine, P1, b.id("bnc"), { selected: { t: [b.id("host")] } });
  assert.equal(zoneOf(b.engine, b.id("host")), "hand");
  assert.notEqual(zoneOf(b.engine, b.id("limb")), "play", "the attachment leaves play with a bounced host");
});

clause(SL, "1:rule", "the attached character gains 1 strength; nobody else does", () => {
  const g = slHand(rage(1));
  assert.equal(str(g, "host"), 2);
  attach(g, "limb", "host");
  assert.equal(str(g, "host"), 3);
  assert.equal(str(g, "ally"), 2, "another of my characters is unaffected");
  assert.equal(str(g, "foe"), 4, "the opponent's character is unaffected");
});

clause(SL, "1:rule", "attached to an opponent's character, that character gains 1 strength (the host, not my characters)", () => {
  const g = slHand(rage(1));
  attach(g, "limb", "foe");
  assert.equal(str(g, "foe"), 5);
  assert.equal(str(g, "host"), 2);
});

clause(SL, "1:rule", "two Severed Limbs on one character stack for +2", () => {
  const g = slHand(rage(1));
  attach(g, "limb", "host");
  attach(g, "limb2", "host");
  assert.equal(str(g, "host"), 4);
});

clause(SL, "1:rule", "the bonus ends when the Limb leaves play and does not come back", () => {
  const g = slPlay(rage(1), [{ key: "zap", def: tactic({ name: "Zap", cost: 0, behavior: { abilities: [{ id: "z", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P1, zone: "hand" }]);
  assert.equal(str(g, "host"), 3);
  play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("limb")] } });
  assert.equal(zoneOf(g.engine, g.id("limb")), "discard");
  assert.equal(str(g, "host"), 2, "bonus gone");
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(str(g, "host"), 2, "and still gone");
});

// --- BULK UP -----------------------------------------------------------------
const bulk = (g: Game, player: PlayerId = P1) => activate(g.engine, player, g.id("limb"), "bulk-up");

clause(SL, "2:ability:bulk-up", "COST pays exactly 1 resource and destroys the Rage; EFFECT gives the host +1 strength this turn on top of the passive +1", () => {
  const g = slPlay([...spentResources(P1, 1), ...greed(3)]);
  const rageKey = Object.keys(g.engine.state.cards).find((cid) => g.engine.getDefinition(cid).name === "Rage")!;
  assert.equal(ready(g), 3);
  bulk(g);
  assert.equal(pending(g.engine), undefined);
  assert.equal(ready(g), 2, "exactly 1 paid");
  assert.equal(zoneOf(g.engine, rageKey), "discard", "the Rage is destroyed");
  assert.equal(str(g, "host"), 4, "2 base +1 passive +1 this turn");
  assert.equal(str(g, "ally"), 2, "only the attached character");
});

clause(SL, "2:ability:bulk-up", "the +1 lasts this turn only, and it can be used again for a second +1", () => {
  const g = slPlay([...spentResources(P1, 2), ...greed(3)]);
  bulk(g);
  bulk(g);
  assert.equal(str(g, "host"), 5, "two activations stack: 2 +1 +1 +1");
  endTurn(g.engine, P1);
  assert.equal(str(g, "host"), 3, "only the passive remains after the turn");
  endTurn(g.engine, P2);
  assert.equal(str(g, "host"), 3);
});

clause(SL, "2:ability:bulk-up", "the pay-1 cost is required: a lone spent Rage and nothing ready cannot pay", () => {
  const g = slPlay(spentResources(P1, 1));
  refused(() => bulk(g), "nothing ready to pay 1", ANY);
  assert.equal(str(g, "host"), 3);
  const ok = slPlay([...spentResources(P1, 1), ...greed(1)]);
  bulk(ok);
  assert.equal(str(ok, "host"), 4, "control: one ready resource is enough");
});

clause(SL, "2:ability:bulk-up", "the destroy cost needs a card named Rage that I own: Greed-only, an opponent's Rage, or a Rage in hand are refused", () => {
  const noRage = slPlay(greed(3));
  refused(() => bulk(noRage), "no Rage at all", ANY);
  const oppRage = slPlay([...greed(3), ...rage(1, P2)]);
  refused(() => bulk(oppRage), "only the opponent's Rage", ANY);
  assert.equal(str(oppRage, "host"), 3);
  const handRage = slPlay(greed(3), [{ key: "hr", def: bank("rage", 1, P1)[0].def, owner: P1, zone: "hand" }]);
  refused(() => bulk(handRage), "a Rage card in hand is not destroyable", ANY);
  const ok = slPlay([...greed(3), ...rage(1, P1)]);
  bulk(ok);
  assert.equal(str(ok, "host"), 4, "control: my own Rage in play");
});

clause(SL, "2:ability:bulk-up", "an opponent's Rage stays when mine is destroyed (only a card I own)", () => {
  const g = slPlay([...greed(3), ...rage(1, P1)], [...rage(1, P2)]);
  bulk(g);
  const rages = Object.keys(g.engine.state.cards).filter((cid) => g.engine.getDefinition(cid).name === "Rage");
  const mine = rages.filter((cid) => g.engine.state.cards[cid].ownerId === P1);
  const theirs = rages.filter((cid) => g.engine.state.cards[cid].ownerId === P2);
  assert.ok(mine.every((cid) => zoneOf(g.engine, cid) === "discard"), "mine.every((cid) => zoneOf(g.engine, cid) === \"discard\")");
  assert.ok(theirs.every((cid) => zoneOf(g.engine, cid) === "play"), "the opponent's Rage untouched");
});

clause(SL, "2:ability:bulk-up", "with two Rage cards I own, I choose which one is destroyed", () => holdCostChoices(() => {
  const g = slPlay([...spentResources(P1, 2), ...greed(3)]);
  const rages = Object.keys(g.engine.state.cards).filter((cid) => g.engine.getDefinition(cid).name === "Rage" && g.engine.state.cards[cid].ownerId === P1);
  assert.equal(rages.length, 2);
  g.engine.perform({ type: "activateAbility", playerId: P1, cardId: g.id("limb"), abilityId: "bulk-up", selected: {}, variables: {} } as never);
  const pc = pending(g.engine);
  assert.ok(pc, "a choice of which Rage to destroy is offered");
  assert.equal(pc!.playerId, P1);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [rages[1]] });
  assert.equal(zoneOf(g.engine, rages[1]), "discard");
  assert.equal(zoneOf(g.engine, rages[0]), "play", "the other Rage stays");
}));

clause(SL, "2:ability:bulk-up", "only the Limb's controller can use it, and not from hand", () => {
  const g = slPlay([...spentResources(P1, 1), ...greed(3), ...greed(3, P2)]);
  refused(() => bulk(g, P2), "the opponent cannot activate", ANY);
  const h = slHand([...spentResources(P1, 1), ...greed(3)]);
  refused(() => bulk(h), "the Limb is in hand", ANY);
});

// =====================================================================
// Silencer — character, warlord, mercenary, cost 2, [R], 3/2/2
// =====================================================================
const SIL = "dae21a35-cc0b-4da5-8a97-1a178ce4a9a0";
const plain = (name: string, over: Record<string, unknown> = {}) => character({ name, strength: 1, life: 4, text: "plain", ...over });

clause(SIL, "0:rule", "printed as a 3/2/2 warlord mercenary character costing 2 with [R]; deploys with exactly 2 Rage", () => {
  const p = printing(SIL);
  assert.deepEqual([p.type, p.cost, p.threshold, p.strength, p.speed, p.life], ["character", 2, "r", 3, 2, 2]);
  assert.deepEqual([...(p.subtype ?? [])], ["mercenary"]);
  const mk = (res: CardPlacement[]) => board([{ key: "sil", def: p, owner: P1, zone: "hand" }, ...res]);
  const ok = mk(rage(2));
  play(ok.engine, P1, ok.id("sil"));
  assert.equal(zoneOf(ok.engine, ok.id("sil")), "play");
  assert.equal(ready(ok), 0, "paid exactly 2");
  refused(() => play(mk(rage(1)).engine, P1, mk(rage(1)).id("sil")), "one short", ANY);
  const g1 = mk([...rage(1), ...greed(1)]);
  assert.equal(ready(g1), 2);
  const g2 = mk(greed(3));
  refused(() => play(g2.engine, P1, g2.id("sil")), "no [R] icon", ANY);
  const g3 = mk([...rage(1), ...greed(1)]);
  play(g3.engine, P1, g3.id("sil"));
  assert.equal(zoneOf(g3.engine, g3.id("sil")), "play", "control: one Rage meets the threshold");
});

const silAttack = (extraP2: CardPlacement[], extraP1: CardPlacement[] = []) => {
  const g = board([
    { key: "sil", def: printing(SIL), owner: P1, zone: "play" },
    ...extraP1, ...extraP2
  ]);
  declareAttackBy(g.engine, P1, [g.id("sil"), ...extraP1.filter((c) => c.key === "ally").map((c) => g.id(c.key))]);
  return g;
};

clause(SIL, "0:rule", "a character with a token on it cannot block this card; one without can", () => {
  const g = silAttack([
    { key: "tok", def: plain("Tok"), owner: P2, zone: "play", counters: { token: 1 } },
    { key: "clean", def: plain("Clean"), owner: P2, zone: "play" }
  ]);
  refused(() => declareBlockers(g.engine, P2, [g.id("tok")]), "tokened blocker", ANY);
  declareBlockers(g.engine, P2, [g.id("clean")]);
  assert.equal(pending(g.engine), undefined);
  assert.ok(g.engine.state.battle, "the clean block stood");
});

clause(SIL, "0:rule", "any number of tokens (2) still stops the block; other counter types do not", () => {
  const g = silAttack([
    { key: "tok2", def: plain("Tok2"), owner: P2, zone: "play", counters: { token: 2 } },
    { key: "oth", def: plain("Oth"), owner: P2, zone: "play", counters: { other: 1 } }
  ]);
  refused(() => declareBlockers(g.engine, P2, [g.id("tok2")]), "two tokens", ANY);
  declareBlockers(g.engine, P2, [g.id("oth")]);
  assert.equal(pending(g.engine), undefined);
  assert.ok(g.engine.state.battle, "the block stood");
});

clause(SIL, "0:rule", "the restriction is only about blocking Silencer: a tokened character may block another attacker", () => {
  const g = board([
    { key: "sil", def: printing(SIL), owner: P1, zone: "play" },
    { key: "ally", def: plain("Ally"), owner: P1, zone: "play" },
    { key: "tok", def: plain("Tok"), owner: P2, zone: "play", counters: { token: 1 } }
  ]);
  declareAttackBy(g.engine, P1, [g.id("ally")]);
  declareBlockers(g.engine, P2, [g.id("tok")]);
  assert.equal(pending(g.engine), undefined);
  assert.ok(g.engine.state.battle, "the block stood");
});

clause(SIL, "0:rule", "a tokened character cannot block a party that contains Silencer", () => {
  const g = silAttack([
    { key: "tok", def: plain("Tok"), owner: P2, zone: "play", counters: { token: 1 } },
    { key: "clean", def: plain("Clean"), owner: P2, zone: "play" }
  ], [{ key: "ally", def: plain("Ally"), owner: P1, zone: "play" }]);
  refused(() => declareBlockers(g.engine, P2, [g.id("tok")]), "tokened blocker vs party with Silencer", ANY);
  declareBlockers(g.engine, P2, [g.id("clean")]);
});

clause(SIL, "1:rule", "an opponent's character entering play: I may pay 1 and, if I do, it gets a token", () => {
  const g = board([
    { key: "sil", def: printing(SIL), owner: P1, zone: "play" },
    ...rage(2),
    { key: "nc", def: plain("NewChar", { cost: 0 }), owner: P2, zone: "hand" }
  ], 2, P2);
  play(g.engine, P2, g.id("nc"));
  const pc = pending(g.engine);
  assert.ok(pc, "I am offered the payment");
  assert.equal(pc!.kind, "mayPay");
  assert.equal(pc!.playerId, P1);
  assert.equal(tokensOn(g.engine, g.id("nc")), 0, "no token before I decide");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(pending(g.engine), undefined);
  assert.equal(tokensOn(g.engine, g.id("nc")), 1);
  assert.equal(ready(g, P1), 1, "exactly 1 paid");
  assert.equal(zoneOf(g.engine, g.id("nc")), "play");
});

clause(SIL, "1:rule", "declining the payment leaves the character untagged and costs nothing", () => {
  const g = board([
    { key: "sil", def: printing(SIL), owner: P1, zone: "play" },
    ...rage(2),
    { key: "nc", def: plain("NewChar", { cost: 0 }), owner: P2, zone: "hand" }
  ], 2, P2);
  play(g.engine, P2, g.id("nc"));
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(pending(g.engine), undefined);
  assert.equal(tokensOn(g.engine, g.id("nc")), 0);
  assert.equal(ready(g, P1), 2);
});

clause(SIL, "1:rule", "with nothing I can pay, the character gets no token", () => {
  const g = board([
    { key: "sil", def: printing(SIL), owner: P1, zone: "play" },
    ...spentResources(P1, 2),
    { key: "nc", def: plain("NewChar", { cost: 0 }), owner: P2, zone: "hand" }
  ], 2, P2);
  play(g.engine, P2, g.id("nc"));
  if (pending(g.engine)) drain(g.engine, declineAll);
  assert.equal(tokensOn(g.engine, g.id("nc")), 0);
  assert.equal(pending(g.engine), undefined);
});

clause(SIL, "1:rule", "my own characters entering do not trigger it", () => {
  const g = board([
    { key: "sil", def: printing(SIL), owner: P1, zone: "play" },
    ...rage(2),
    { key: "mine", def: plain("Mine", { cost: 0 }), owner: P1, zone: "hand" }
  ], 3, P1);
  play(g.engine, P1, g.id("mine"));
  assert.equal(pending(g.engine), undefined, "my own character: no prompt");
  assert.equal(tokensOn(g.engine, g.id("mine")), 0);
});

const silOpp = (key: string, def: ReturnType<typeof item>) => {
  const g = board([
    { key: "sil", def: printing(SIL), owner: P1, zone: "play" },
    ...rage(2),
    { key, def, owner: P2, zone: "hand" }
  ], 2, P2);
  play(g.engine, P2, g.id(key));
  return g;
};
clause(SIL, "1:rule", "an item entering under the opponent's control is not a character: no payment prompt, no token", () => {
  const g = silOpp("thing", item({ name: "Thing", cost: 0, text: "plain" }));
  assert.equal(pending(g.engine), undefined, "an item is not a character");
  assert.equal(tokensOn(g.engine, g.id("thing")), 0);
});
clause(SIL, "1:rule", "a location entering under the opponent's control is not a character: no payment prompt, no token", () => {
  const g = silOpp("place", location({ name: "Place", cost: 0, text: "plain" }));
  assert.equal(pending(g.engine), undefined, "a location is not a character");
  assert.equal(tokensOn(g.engine, g.id("place")), 0);
});

clause(SIL, "1:rule", "'your opponent' is relative to Silencer's controller: with the opponent's Silencer, my entering character is tagged for them", () => {
  const g = board([
    { key: "sil", def: printing(SIL), owner: P2, zone: "play" },
    ...rage(2, P2),
    { key: "nc", def: plain("NewChar", { cost: 0 }), owner: P1, zone: "hand" }
  ], 3, P1);
  play(g.engine, P1, g.id("nc"));
  const pc = pending(g.engine);
  assert.ok(pc, "the Silencer's controller is offered the payment");
  assert.equal(pc!.playerId, P2);
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(tokensOn(g.engine, g.id("nc")), 1);
});

clause(SIL, "1:rule", "only while Silencer is in play: from hand it triggers nothing", () => {
  const g = board([
    { key: "sil", def: printing(SIL), owner: P1, zone: "hand" },
    ...rage(2),
    { key: "nc", def: plain("NewChar", { cost: 0 }), owner: P2, zone: "hand" }
  ], 2, P2);
  play(g.engine, P2, g.id("nc"));
  assert.equal(pending(g.engine), undefined);
  assert.equal(tokensOn(g.engine, g.id("nc")), 0);
});

clause(SIL, "1:rule", "a character I tagged cannot then block Silencer (both clauses together)", () => {
  const g = board([
    { key: "sil", def: printing(SIL), owner: P1, zone: "play" },
    ...rage(2),
    { key: "nc", def: plain("NewChar", { cost: 0 }), owner: P2, zone: "hand" }
  ], 2, P2);
  play(g.engine, P2, g.id("nc"));
  answerPending(g.engine, "mayPay", { pay: true });
  endTurn(g.engine, P2);
  declareAttackBy(g.engine, P1, [g.id("sil")]);
  refused(() => declareBlockers(g.engine, P2, [g.id("nc")]), "tagged character cannot block", ANY);
});

// =====================================================================
// Single Combat (two printings) — tactic, warlord, cost 2, [R][R]
// EXTRA COST: Pick a character or location. -- [V] in its text: 6 damage, else 2. -- FLIP UP: 1 [R][R]
// =====================================================================
const SC_A = "d32dd930-efd3-4f97-b95b-5b68a32cecd5";
const SC_B = "0c879f7e-a01c-4e64-b0d7-a0d3cd6d73be";
const THH = "4f0e52f0-eb5a-4f49-8606-1b722891ca4f";
const vChar = (name = "Vee") => character({ name, strength: 1, life: 9, text: "[V]: something" });
const nChar = (name = "Nee") => character({ name, strength: 1, life: 9, text: "[R][G][D][E][O] and no volition" });

function scBody(ID: string) {
  const p = printing(ID);
  const hand = (res: CardPlacement[], extra: CardPlacement[] = []) =>
    board([{ key: "sc", def: p, owner: P1, zone: "hand" }, ...res, ...extra]);
  const targets: CardPlacement[] = [
    { key: "mineN", def: nChar("MineN"), owner: P1, zone: "play" },
    { key: "foeN", def: nChar("FoeN"), owner: P2, zone: "play" },
    { key: "foeV", def: vChar("FoeV"), owner: P2, zone: "play" },
    { key: "mineV", def: vChar("MineV"), owner: P1, zone: "play" },
    { key: "placeN", def: location({ name: "PlaceN", structure: 9, text: "plain words" }), owner: P2, zone: "play" },
    { key: "placeV", def: location({ name: "PlaceV", structure: 9, text: "[V] on a location" }), owner: P2, zone: "play" }
  ];
  const cast = (g: Game, key: string) => play(g.engine, P1, g.id("sc"), { selected: { c: [g.id(key)] } });
  return {
    cost() {
      assert.deepEqual([p.type, p.cost, p.threshold], ["tactic", 2, "rr"]);
      const ok = hand(rage(2), targets);
      cast(ok, "foeN");
      assert.equal(zoneOf(ok.engine, ok.id("sc")), "discard", "the resolved tactic is discarded");
      assert.equal(ready(ok), 0, "exactly 2 paid");
      const one = hand(rage(1), targets);
      refused(() => cast(one, "foeN"), "one resource short", ANY);
      assert.equal(zoneOf(one.engine, one.id("sc")), "hand");
      const mixed = hand([...rage(1), ...greed(1)], targets);
      refused(() => cast(mixed, "foeN"), "one [R] icon short", ANY);
      const spentShort = hand([...spentResources(P1, 2), ...greed(1)], targets);
      refused(() => cast(spentShort, "foeN"), "cost short: spent Rage meet [R][R] but cannot pay", ANY);
      const spentOk = hand([...spentResources(P1, 2), ...greed(2)], targets);
      cast(spentOk, "foeN");
      assert.equal(zoneOf(spentOk.engine, spentOk.id("sc")), "discard", "control: spent Rage fill the threshold, 2 ready pay the cost");
      assert.equal(dmg(spentOk, "foeN"), 2);
    },
    extra() {
      const g = hand(rage(2), [...targets,
        { key: "thing", def: item({ name: "Thing", text: "plain" }), owner: P2, zone: "play" },
        { key: "hid", def: nChar("Hid"), owner: P2, zone: "play", faceDown: true },
        { key: "inHand", def: nChar("InHand"), owner: P2, zone: "hand" },
        { key: "inDisc", def: nChar("InDisc"), owner: P2, zone: "discard" }]);
      refused(() => play(g.engine, P1, g.id("sc")), "no pick", ANY);
      for (const bad of ["thing", "hid", "inHand", "inDisc"]) refused(() => cast(g, bad), `bad pick ${bad}`, ANY);
      refused(() => play(g.engine, P1, g.id("sc"), { selected: { c: [faction(g, P2)] } }), "faction", ANY);
      assert.equal(zoneOf(g.engine, g.id("sc")), "hand");
      assert.equal(ready(g), 2, "nothing paid by the refused attempts");
      for (const [key, who] of [["mineN", "my character"], ["foeN", "their character"], ["placeN", "a location"]] as const) {
        const ok = hand(rage(2), targets);
        cast(ok, key);
        assert.equal(zoneOf(ok.engine, ok.id("sc")), "discard", `${who} can be picked`);
      }
    },
    damage() {
      const g = hand(rage(2), targets);
      cast(g, "foeN");
      assert.equal(dmg(g, "foeN"), 2, "no [V]: 2 damage");
      for (const k of ["mineN", "foeV", "mineV", "placeN", "placeV"]) assert.equal(dmg(g, k), 0, `${k} untouched`);
      const v = hand(rage(2), targets);
      cast(v, "foeV");
      assert.equal(dmg(v, "foeV"), 6, "[V] in rules text: 6 damage");
      assert.equal(dmg(v, "foeN"), 0);
      const mv = hand(rage(2), targets);
      cast(mv, "mineV");
      assert.equal(dmg(mv, "mineV"), 6, "my own character too");
      const pv = hand(rage(2), targets);
      cast(pv, "placeV");
      assert.equal(dmg(pv, "placeV"), 6, "a location with [V] in its text");
      assert.equal(dmg(pv, "placeN"), 0);
      const pn = hand(rage(2), targets);
      cast(pn, "placeN");
      assert.equal(dmg(pn, "placeN"), 2, "a location without [V]");
    },
    real() {
      const g = hand(rage(2), [
        { key: "thh", def: printing(THH), owner: P2, zone: "play" },
        { key: "sil", def: printing(SIL), owner: P2, zone: "play" }
      ]);
      cast(g, "thh");
      assert.equal(zoneOf(g.engine, g.id("thh")), "discard", "Thabbashite Host (has [V] in its text, life 6) takes 6 and dies");
      const s = hand(rage(2), [
        { key: "thh", def: printing(THH), owner: P2, zone: "play" },
        { key: "sil", def: printing(SIL), owner: P2, zone: "play" }
      ]);
      cast(s, "sil");
      assert.equal(zoneOf(s.engine, s.id("sil")), "discard", "Silencer (no [V], life 2) takes 2 and dies");
      assert.equal(zoneOf(s.engine, s.id("thh")), "play");
      assert.equal(dmg(s, "thh"), 0);
    },
    flip() {
      const mk = (res: CardPlacement[], turn = 3, active: PlayerId = P1, extra: CardPlacement[] = []) =>
        board([{ key: "sc", def: p, owner: P1, zone: "play", faceDown: true }, ...res, ...targets, ...extra], turn, active);
      const g = mk(rage(2));
      const before = ready(g);
      assert.equal(before, 3);
      flipUp(g, "sc", { c: [g.id("foeV")] });
      assert.equal(zoneOf(g.engine, g.id("sc")), "discard", "the flipped-up tactic resolves and is discarded");
      assert.equal(dmg(g, "foeV"), 6, "same [V] rule via FLIP UP");
      assert.ok([1, 2].includes(ready(g)), "exactly 1 paid");
      const n = mk(rage(2));
      flipUp(n, "sc", { c: [n.id("foeN")] });
      assert.equal(dmg(n, "foeN"), 2);
      assert.equal(dmg(n, "foeV"), 0);
      // the cost really is 1: spent Rage fill the threshold and the card pays for itself
      const solo = mk(spentResources(P1, 2));
      flipUp(solo, "sc", { c: [solo.id("foeN")] });
      assert.equal(zoneOf(solo.engine, solo.id("sc")), "discard", "threshold [R][R] met by two spent Rage; the card pays its own 1");
      assert.equal(dmg(solo, "foeN"), 2);
    },
    flipRefused() {
      const one = board([{ key: "sc", def: p, owner: P1, zone: "play", faceDown: true }, ...rage(1), ...greed(2), ...targets]);
      refused(() => flipUp(one, "sc", { c: [one.id("foeN")] }), "only one [R]", ANY);
      assert.equal(one.engine.state.cards[one.id("sc")].faceDown, true);
      assert.equal(zoneOf(one.engine, one.id("sc")), "play");
      assert.equal(ready(one), 4, "nothing paid");
      const none = board([{ key: "sc", def: p, owner: P1, zone: "play", faceDown: true }, ...greed(3), ...targets]);
      refused(() => flipUp(none, "sc", { c: [none.id("foeN")] }), "no [R]", ANY);
      const nopick = board([{ key: "sc", def: p, owner: P1, zone: "play", faceDown: true }, ...rage(2), ...targets]);
      refused(() => flipUp(nopick, "sc", {}), "no pick", ANY);
      refused(() => flipUp(nopick, "sc", { c: [faction(nopick, P2)] }), "faction pick", ANY);
      assert.equal(nopick.engine.state.cards[nopick.id("sc")].faceDown, true);
    },
    flipWindow() {
      const g = board([
        { key: "sc", def: p, owner: P1, zone: "play", faceDown: true }, ...rage(2),
        { key: "atk", def: nChar("Atk"), owner: P2, zone: "play" }
      ], 2, P2);
      declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
      flipUp(g, "sc", { c: [g.id("atk")] });
      assert.equal(zoneOf(g.engine, g.id("sc")), "discard", "a tactic may be flipped up in the opponent's response window");
      assert.equal(dmg(g, "atk"), 2);
    }
  };
}
const scA = scBody(SC_A);
const scB = scBody(SC_B);
clause(SC_A, "0:extraCost", "Pick a character or location: any character or location of either player, nothing else; printed tactic, cost 2, [R][R]", () => scA.extra());
clause(SC_B, "0:extraCost", "Pick a character or location: any character or location of either player, nothing else", () => scB.extra());
clause(SC_A, "0:extraCost", "printed tactic costing 2 with [R][R]: exactly 2 Rage pay; one short, one icon short, or spent Rage as payment are refused", () => scA.cost());
clause(SC_B, "0:extraCost", "printed tactic costing 2 with [R][R]: exactly 2 Rage pay; one short, one icon short, or spent Rage as payment are refused", () => scB.cost());
clause(SC_A, "1:rule", "6 damage to a picked card with [V] in its rules text, otherwise 2, to the picked card only", () => scA.damage());
clause(SC_B, "1:rule", "6 damage to a picked card with [V] in its rules text, otherwise 2, to the picked card only", () => scB.damage());
clause(SC_A, "1:rule", "real cards: Thabbashite Host ([V]) takes 6 and dies; Silencer (no [V]) takes 2 and dies", () => scA.real());
clause(SC_B, "1:rule", "real cards: Thabbashite Host ([V]) takes 6 and dies; Silencer (no [V]) takes 2 and dies", () => scB.real());
clause(SC_A, "2:flipUp", "FLIP UP for 1 [R][R] resolves the same effect on the pick and discards the tactic", () => scA.flip());
clause(SC_B, "2:flipUp", "FLIP UP for 1 [R][R] resolves the same effect on the pick and discards the tactic", () => scB.flip());
clause(SC_A, "2:flipUp", "FLIP UP needs [R][R] and a legal pick; nothing is paid when refused", () => scA.flipRefused());
clause(SC_B, "2:flipUp", "FLIP UP needs [R][R] and a legal pick; nothing is paid when refused", () => scB.flipRefused());
clause(SC_A, "2:flipUp", "as a tactic it may be flipped up in the opponent's response window", () => scA.flipWindow());
clause(SC_B, "2:flipUp", "as a tactic it may be flipped up in the opponent's response window", () => scB.flipWindow());

// =====================================================================
// Slippery Assailant — character, warlord, soldier, cost 1, [R], 2/3/2
// =====================================================================
const SA = "dcb6b020-1971-4a8f-8de0-7e0c22c9027b";
const saBoard = (extra: CardPlacement[] = [], o: { owner?: PlayerId; controller?: PlayerId } = {}) =>
  board([
    { key: "sa", def: printing(SA), owner: o.owner ?? P1, controller: o.controller, zone: "play" },
    ...extra
  ]);

clause(SA, "0:rule", "printed as a 2/3/2 warlord soldier costing 1 with [R]", () => {
  const p = printing(SA);
  assert.deepEqual([p.type, p.cost, p.threshold, p.strength, p.speed, p.life], ["character", 1, "r", 2, 3, 2]);
  assert.deepEqual([...(p.subtype ?? [])], ["soldier"]);
  const mk = (res: CardPlacement[]) => board([{ key: "sa", def: p, owner: P1, zone: "hand" }, ...res]);
  const ok = mk(rage(1));
  play(ok.engine, P1, ok.id("sa"));
  assert.equal(zoneOf(ok.engine, ok.id("sa")), "play");
  assert.equal(ready(ok), 0, "paid exactly 1");
  const none = mk([]);
  refused(() => play(none.engine, P1, none.id("sa")), "nothing to pay", ANY);
  const gr = mk(greed(2));
  refused(() => play(gr.engine, P1, gr.id("sa")), "no [R] icon", ANY);
});

clause(SA, "0:rule", "dealing battle damage to a faction puts it into its owner's hand", () => {
  const g = saBoard();
  fight(g.engine, P1, [g.id("sa")], { type: "faction", playerId: P2 }, []);
  assert.equal(lost(g, P2), 2, "the faction took its 2 strength");
  assert.equal(zoneOf(g.engine, g.id("sa")), "hand");
  assert.ok(g.engine.state.players[P1].hand.includes(g.id("sa")), "g.engine.state.players[P1].hand.includes(g.id(\"sa\"))");
  assert.equal(pending(g.engine), undefined);
});

clause(SA, "0:rule", "if it is blocked it inflicts no faction damage and stays in play", () => {
  const g = saBoard([{ key: "blk", def: character({ name: "Blk", strength: 1, life: 9, text: "plain" }), owner: P2, zone: "play" }]);
  fight(g.engine, P1, [g.id("sa")], { type: "faction", playerId: P2 }, [g.id("blk")]);
  assert.equal(zoneOf(g.engine, g.id("sa")), "play");
  assert.equal(lost(g, P2), 0);
});

clause(SA, "0:rule", "attacking a card instead of a faction does not return it", () => {
  const g = saBoard([{ key: "tgt", def: location({ name: "Tgt", structure: 9, text: "plain" }), owner: P2, zone: "play" }]);
  fight(g.engine, P1, [g.id("sa")], { type: "card", cardId: g.id("tgt") }, []);
  assert.equal((g.engine.state.cards[g.id("tgt")].damage ?? 0) > 0, true, "it damaged the location");
  assert.equal(zoneOf(g.engine, g.id("sa")), "play", "damage to a location is not damage to a faction");
});

clause(SA, "0:rule", "in a party only the Assailant returns; another attacker that damages the faction stays", () => {
  const g = saBoard([{ key: "ally", def: character({ name: "Ally", strength: 3, life: 9, text: "plain" }), owner: P1, zone: "play" }]);
  declareAttackBy(g.engine, P1, [g.id("sa"), g.id("ally")]);
  g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  finishBattle(g.engine);
  assert.equal(zoneOf(g.engine, g.id("sa")), "hand");
  assert.equal(zoneOf(g.engine, g.id("ally")), "play");
  assert.equal(lost(g, P2), 5, "both dealt damage (2 + 3)");
});

clause(SA, "0:rule", "another character dealing battle damage to a faction does not return the Assailant", () => {
  const g = saBoard([{ key: "ally", def: character({ name: "Ally", strength: 3, life: 9, text: "plain" }), owner: P1, zone: "play" }]);
  fight(g.engine, P1, [g.id("ally")], { type: "faction", playerId: P2 }, []);
  assert.equal(lost(g, P2), 3);
  assert.equal(zoneOf(g.engine, g.id("sa")), "play", "the idle Assailant stays");
});

clause(SA, "0:rule", "the opponent's Assailant attacking my faction also returns, to its owner's hand", () => {
  const g = board([{ key: "sa", def: printing(SA), owner: P2, zone: "play" }], 2, P2);
  fight(g.engine, P2, [g.id("sa")], { type: "faction", playerId: P1 }, []);
  assert.equal(lost(g, P1), 2);
  assert.equal(zoneOf(g.engine, g.id("sa")), "hand");
  assert.ok(g.engine.state.players[P2].hand.includes(g.id("sa")), "g.engine.state.players[P2].hand.includes(g.id(\"sa\"))");
});

clause(SA, "0:rule", "it goes to its OWNER's hand, not its controller's", () => {
  const g = saBoard([], { owner: P2, controller: P1 });
  fight(g.engine, P1, [g.id("sa")], { type: "faction", playerId: P2 }, []);
  assert.equal(lost(g, P2), 2);
  assert.ok(g.engine.state.players[P2].hand.includes(g.id("sa")), "owner's hand");
  assert.ok(!g.engine.state.players[P1].hand.includes(g.id("sa")), "!g.engine.state.players[P1].hand.includes(g.id(\"sa\"))");
});

const saFlip = (res: CardPlacement[], turn = 3, active: PlayerId = P1, extra: CardPlacement[] = []) =>
  board([{ key: "sa", def: printing(SA), owner: P1, zone: "play", faceDown: true }, ...res, ...extra], turn, active);

clause(SA, "1:flipUp", "FLIP UP 0 [R]: with one Rage it turns face up as a character and pays nothing", () => {
  const g = saFlip(rage(1));
  const before = ready(g);
  assert.equal(before, 2, "one bank plus the face-down card");
  flipUp(g, "sa");
  assert.equal(g.engine.state.cards[g.id("sa")].faceDown, false);
  assert.equal(zoneOf(g.engine, g.id("sa")), "play");
  assert.equal(ready(g), 1, "the Rage bank is still ready: cost 0");
  assert.equal(g.engine.getStat(g.id("sa"), "strength"), 2);
});

clause(SA, "1:flipUp", "FLIP UP needs [R]: Greed only or no other resources is refused", () => {
  const gr = saFlip(greed(3));
  refused(() => flipUp(gr, "sa"), "greed only", ANY);
  assert.equal(gr.engine.state.cards[gr.id("sa")].faceDown, true);
  const none = saFlip([]);
  refused(() => flipUp(none, "sa"), "no [R]", ANY);
  const spent = saFlip(spentResources(P1, 1));
  flipUp(spent, "sa");
  assert.equal(spent.engine.state.cards[spent.id("sa")].faceDown, false, "control: a spent Rage still meets the threshold");
});

clause(SA, "1:flipUp", "a non-tactic cannot be flipped up in the opponent's response window", () => {
  const g = saFlip(rage(1), 2, P2, [{ key: "atk", def: character({ name: "Atk", strength: 1, life: 9, text: "plain" }), owner: P2, zone: "play" }]);
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  refused(() => flipUp(g, "sa"), "character FLIP UP in the opponent's window", ANY);
  assert.equal(g.engine.state.cards[g.id("sa")].faceDown, true);
});

// =====================================================================
// Thabbashite Host — character, warlord, fighter, cost 8, [R], 5/3/6
// [R][R][V][V]: +4 strength; leaves play -> may pick a character, +4 this turn. FLIP UP: 7 [V][V][V][V]
// =====================================================================
const thBoard = (res: CardPlacement[], extra: CardPlacement[] = [], turn = 3, active: PlayerId = P1) =>
  board([{ key: "th", def: printing(THH), owner: P1, zone: "play" }, ...res, ...extra], turn, active);
const rrvv = () => [...rage(2), ...volition(2)];
const allyP = (): CardPlacement[] => [
  { key: "ally", def: character({ name: "Ally", strength: 2, life: 9, text: "plain" }), owner: P1, zone: "play" },
  { key: "foe", def: character({ name: "Foe", strength: 3, life: 9, text: "plain" }), owner: P2, zone: "play" },
  { key: "thing", def: item({ name: "Thing", text: "plain" }), owner: P1, zone: "play" }
];

clause(THH, "0:rule@rrvv", "printed as a 5/3/6 warlord fighter costing 8 with [R]", () => {
  const p = printing(THH);
  assert.deepEqual([p.type, p.cost, p.threshold, p.strength, p.speed, p.life], ["character", 8, "r", 5, 3, 6]);
  assert.deepEqual([...(p.subtype ?? [])], ["fighter"]);
  const mk = (res: CardPlacement[]) => board([{ key: "th", def: p, owner: P1, zone: "hand" }, ...res]);
  const ok = mk(rage(8));
  play(ok.engine, P1, ok.id("th"));
  assert.equal(zoneOf(ok.engine, ok.id("th")), "play");
  assert.equal(ready(ok), 0, "paid exactly 8");
  const short = mk(rage(7));
  refused(() => play(short.engine, P1, short.id("th")), "one short", ANY);
  const gr = mk(greed(8));
  refused(() => play(gr.engine, P1, gr.id("th")), "no [R]", ANY);
  const mixed = mk([...rage(1), ...greed(7)]);
  play(mixed.engine, P1, mixed.id("th"));
  assert.equal(zoneOf(mixed.engine, mixed.id("th")), "play", "control: one Rage meets the threshold");
});

clause(THH, "0:rule@rrvv", "+4 strength only with [R][R][V][V]: 5 without, 9 with", () => {
  assert.equal(str(thBoard(rrvv()), "th"), 9);
  assert.equal(str(thBoard([]), "th"), 5);
  assert.equal(str(thBoard([...rage(1), ...volition(2)]), "th"), 5, "one Rage short");
  assert.equal(str(thBoard([...rage(2), ...volition(1)]), "th"), 5, "one Volition short");
  assert.equal(str(thBoard([...rage(4)]), "th"), 5, "no Volition");
  assert.equal(str(thBoard([...volition(4)]), "th"), 5, "no Rage");
  assert.equal(str(thBoard([...greed(2), ...volition(2)]), "th"), 5, "Greed is not Rage");
  assert.equal(str(thBoard([...rage(3), ...volition(3)]), "th"), 9, "extra icons do not stack");
});

clause(THH, "0:rule@rrvv", "spent resources still count toward the threshold; the opponent's resources do not", () => {
  assert.equal(str(thBoard([...spentResources(P1, 2), ...volition(2)]), "th"), 9);
  assert.equal(str(thBoard([...rage(2, P2), ...volition(2, P2)]), "th"), 5);
});

clause(THH, "0:rule@rrvv", "the +4 is only for this card; my other characters do not gain it", () => {
  const g = thBoard(rrvv(), allyP());
  assert.equal(str(g, "th"), 9);
  assert.equal(str(g, "ally"), 2);
  assert.equal(str(g, "foe"), 3);
});

const killT = (owner: PlayerId = P1): CardPlacement => ({ key: "kill", def: killTactic(), owner, zone: "hand" });
const killTh = (g: Game, player: PlayerId = P1) => play(g.engine, player, g.id("kill"), { selected: { t: [g.id("th")] } });

clause(THH, "0:rule@rrvv", "when it leaves play with the threshold met I may pick a character: it gains 4 strength this turn", () => {
  for (const [who, base] of [["ally", 2], ["foe", 3]] as const) {
    const g = thBoard([...rrvv(), ...rage(2)], [...allyP(), killT()]);
    killTh(g);
    assert.equal(zoneOf(g.engine, g.id("th")), "discard");
    const pc = pending(g.engine);
    assert.ok(pc, "a pick is offered");
    assert.equal(pc!.kind, "chooserSelectsTarget");
    assert.equal(pc!.playerId, P1);
    answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(who)] });
    assert.equal(pending(g.engine), undefined);
    assert.equal(str(g, who), base + 4, `${who} gains 4`);
    assert.equal(str(g, who === "ally" ? "foe" : "ally"), who === "ally" ? 3 : 2, "nobody else gains it");
  }
});

clause(THH, "0:rule@rrvv", "the pick is optional and only characters qualify; declining gives nothing", () => {
  const g = thBoard([...rrvv(), ...rage(2)], [...allyP(), killT()]);
  killTh(g);
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("thing")] }), "an item is not a character", ANY);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(pending(g.engine), undefined);
  assert.equal(str(g, "ally"), 2);
  assert.equal(str(g, "foe"), 3);
});

clause(THH, "0:rule@rrvv", "the +4 from leaving play lasts this turn only", () => {
  const g = thBoard([...rrvv(), ...rage(2)], [...allyP(), killT()]);
  killTh(g);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("ally")] });
  assert.equal(str(g, "ally"), 6);
  endTurn(g.engine, P1);
  assert.equal(str(g, "ally"), 2, "gone at end of turn");
  endTurn(g.engine, P2);
  assert.equal(str(g, "ally"), 2);
});

clause(THH, "0:rule@rrvv", "without the threshold nothing is offered when it leaves play", () => {
  const g = thBoard([...rage(2), ...volition(1), ...rage(2)], [...allyP(), killT()]);
  killTh(g);
  assert.equal(zoneOf(g.engine, g.id("th")), "discard");
  assert.equal(pending(g.engine), undefined);
  assert.equal(str(g, "ally"), 2);
});

clause(THH, "0:rule@rrvv", "near-miss thresholds offer nothing when it leaves play: [R][V][V], [R][R][V], no Volition, no Rage", () => {
  const near: [string, CardPlacement[]][] = [
    ["one Rage, two Volition", [...rage(1), ...volition(2), ...greed(3)]],
    ["two Rage, one Volition", [...rage(2), ...volition(1), ...greed(3)]],
    ["four Rage, no Volition", [...rage(4)]],
    ["four Volition, no Rage", [...volition(4)]]
  ];
  for (const [label, res] of near) {
    const g = thBoard(res, [...allyP(), killT()]);
    killTh(g);
    assert.equal(zoneOf(g.engine, g.id("th")), "discard", label);
    assert.equal(pending(g.engine), undefined, `${label}: no pick`);
  }
});

clause(THH, "0:rule@rrvv", "entering play does not offer the pick (only leaving play does)", () => {
  const g = board([
    { key: "th", def: printing(THH), owner: P1, zone: "hand" }, ...rage(8), ...volition(2), ...allyP()
  ]);
  play(g.engine, P1, g.id("th"));
  assert.equal(zoneOf(g.engine, g.id("th")), "play");
  assert.equal(pending(g.engine), undefined);
  assert.equal(str(g, "ally"), 2);
});

clause(THH, "0:rule@rrvv", "the pick is of ONE character: two picks are refused", () => {
  const g = thBoard([...rrvv(), ...rage(2)], [...allyP(), killT()]);
  killTh(g);
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("ally"), g.id("foe")] }), "two characters", ANY);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("ally")] });
  assert.equal(str(g, "ally"), 6);
  assert.equal(str(g, "foe"), 3);
});

clause(THH, "0:rule@rrvv", "another card leaving play does not trigger it", () => {
  const g = thBoard([...rrvv(), ...rage(2)], [...allyP(), killT()]);
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("ally")] } });
  assert.equal(zoneOf(g.engine, g.id("ally")), "discard");
  assert.equal(pending(g.engine), undefined);
  assert.equal(str(g, "th"), 9);
});

clause(THH, "0:rule@rrvv", "any way of leaving play counts: returning to hand also offers the pick", () => {
  const g = thBoard([...rrvv(), ...rage(2)], [...allyP(), { key: "bnc", def: bounceTactic(), owner: P1, zone: "hand" }]);
  play(g.engine, P1, g.id("bnc"), { selected: { t: [g.id("th")] } });
  assert.equal(zoneOf(g.engine, g.id("th")), "hand");
  const pc = pending(g.engine);
  assert.ok(pc, "pick offered");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("ally")] });
  assert.equal(str(g, "ally"), 6);
});

clause(THH, "0:rule@rrvv", "I (its controller) get the pick even when the opponent destroys it", () => {
  const g = board([
    { key: "th", def: printing(THH), owner: P1, zone: "play" }, ...rrvv(), ...rage(2, P2),
    ...allyP(), { key: "kill", def: killTactic(), owner: P2, zone: "hand" }
  ], 2, P2);
  play(g.engine, P2, g.id("kill"), { selected: { t: [g.id("th")] } });
  const pc = pending(g.engine);
  assert.ok(pc, "pick offered");
  assert.equal(pc!.playerId, P1);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("foe")] });
  assert.equal(str(g, "foe"), 7);
});

const thFlip = (vol: number, other: number, extra: CardPlacement[] = [], turn = 3, active: PlayerId = P1) =>
  board([{ key: "th", def: printing(THH), owner: P1, zone: "play", faceDown: true }, ...volition(vol), ...rage(other), ...extra], turn, active);

clause(THH, "1:flipUp", "FLIP UP 7 [V][V][V][V]: four other Volition plus enough to pay 7 turns it face up", () => {
  const g = thFlip(4, 3);
  flipUp(g, "th");
  assert.equal(g.engine.state.cards[g.id("th")].faceDown, false);
  assert.equal(zoneOf(g.engine, g.id("th")), "play");
  assert.equal(g.engine.getStat(g.id("th"), "life"), 6);
  const exact = thFlip(4, 2);
  assert.equal(ready(exact), 7, "exactly seven resources including itself");
  flipUp(exact, "th");
  assert.equal(exact.engine.state.cards[exact.id("th")].faceDown, false, "the card may pay for its own FLIP UP cost");
});

clause(THH, "1:flipUp", "FLIP UP cost 7: one resource short is refused and pays nothing", () => {
  const g = thFlip(4, 1);
  assert.equal(ready(g), 6);
  refused(() => flipUp(g, "th"), "one short of 7", ANY);
  assert.equal(g.engine.state.cards[g.id("th")].faceDown, true);
  assert.equal(ready(g), 6, "nothing paid");
  const spent = board([{ key: "th", def: printing(THH), owner: P1, zone: "play", faceDown: true }, ...volition(4), ...spentResources(P1, 3)]);
  refused(() => flipUp(spent, "th"), "spent resources cannot pay", ANY);
});

clause(THH, "1:flipUp", "FLIP UP threshold is Volition only (no Rage needed) and two other Volition are refused", () => {
  const all = thFlip(7, 0);
  assert.equal(ready(all), 8);
  flipUp(all, "th");
  assert.equal(all.engine.state.cards[all.id("th")].faceDown, false, "seven other Volition, no Rage: allowed");
  const two = thFlip(2, 6);
  refused(() => flipUp(two, "th"), "only 2 other Volition", ANY);
  assert.equal(two.engine.state.cards[two.id("th")].faceDown, true);
  const one = thFlip(0, 8);
  refused(() => flipUp(one, "th"), "Rage cannot stand in for Volition", ANY);
});

clause(THH, "1:flipUp", "FLIP UP needs [V][V][V][V] AFTER flipping: its own face-down icon does not count, so 3 other Volition is refused", () => {
  const g = thFlip(3, 5);
  assert.equal(ready(g), 9, "plenty to pay: the only shortfall is the threshold");
  refused(() => flipUp(g, "th"), "only 3 other Volition icons", ANY);
  assert.equal(g.engine.state.cards[g.id("th")].faceDown, true);
  assert.equal(ready(g), 9);
});

clause(THH, "1:flipUp", "FLIP UP: no Volition at all is refused, and four spent Volition-free resources do not help", () => {
  const g = thFlip(0, 9);
  refused(() => flipUp(g, "th"), "no Volition", ANY);
  assert.equal(g.engine.state.cards[g.id("th")].faceDown, true);
});

clause(THH, "1:flipUp", "a non-tactic cannot be flipped up in the opponent's response window", () => {
  const g = thFlip(4, 3, [{ key: "atk", def: character({ name: "Atk", strength: 1, life: 9, text: "plain" }), owner: P2, zone: "play" }], 2, P2);
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  refused(() => flipUp(g, "th"), "character FLIP UP in the opponent's window", ANY);
  assert.equal(g.engine.state.cards[g.id("th")].faceDown, true);
});

// =====================================================================
// Thabbashite Weapons Expert — character, warlord, fighter, cost 2, [R], 2/3/1
// =====================================================================
const WE = "e8cd0ae5-9aba-4996-8a29-3f160b2d96f2";
const weBoard = (res: CardPlacement[], extra: CardPlacement[] = [], o: { owner?: PlayerId } = {}) =>
  board([{ key: "we", def: printing(WE), owner: o.owner ?? P1, zone: "play" }, ...res, ...extra], 2, P2);
const weItems = (): CardPlacement[] => [
  { key: "i1", def: item({ name: "I1", cost: 1, text: "plain" }), owner: P2, zone: "play" },
  { key: "i2", def: item({ name: "I2", cost: 2, text: "plain" }), owner: P2, zone: "play" },
  { key: "i3", def: item({ name: "I3", cost: 3, text: "plain" }), owner: P2, zone: "play" },
  { key: "i4", def: item({ name: "I4", cost: 4, text: "plain" }), owner: P2, zone: "play" },
  { key: "mi2", def: item({ name: "MI2", cost: 2, text: "plain" }), owner: P1, zone: "play" },
  { key: "ch", def: character({ name: "Ch", cost: 0, strength: 1, life: 9, text: "plain" }), owner: P2, zone: "play" },
  { key: "pl", def: location({ name: "Pl", cost: 0, text: "plain" }), owner: P2, zone: "play" }
];
/** Ends P2's turn so P1's turn starts; returns the pending prompt. */
const startP1 = (g: Game) => { endTurn(g.engine, P2); return pending(g.engine); };

clause(WE, "0:rule", "printed as a 2/3/1 warlord fighter costing 2 with [R]", () => {
  const p = printing(WE);
  assert.deepEqual([p.type, p.cost, p.threshold, p.strength, p.speed, p.life], ["character", 2, "r", 2, 3, 1]);
  assert.deepEqual([...(p.subtype ?? [])], ["fighter"]);
  const mk = (res: CardPlacement[]) => board([{ key: "we", def: p, owner: P1, zone: "hand" }, ...res]);
  const ok = mk(rage(2));
  play(ok.engine, P1, ok.id("we"));
  assert.equal(zoneOf(ok.engine, ok.id("we")), "play");
  assert.equal(ready(ok), 0, "paid exactly 2");
  const short = mk(rage(1));
  refused(() => play(short.engine, P1, short.id("we")), "one short", ANY);
  const gr = mk(greed(3));
  refused(() => play(gr.engine, P1, gr.id("we")), "no [R]", ANY);
  const mixed = mk([...rage(1), ...greed(1)]);
  play(mixed.engine, P1, mixed.id("we"));
  assert.equal(zoneOf(mixed.engine, mixed.id("we")), "play", "control: one Rage suffices");
});

clause(WE, "0:rule", "at the start of my turn I am offered to destroy it; declining leaves everything unchanged", () => {
  const g = weBoard([], weItems());
  const pc = startP1(g);
  assert.ok(pc, "offered");
  assert.equal(pc!.kind, "mayPay");
  assert.equal(pc!.playerId, P1);
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(pending(g.engine), undefined, "no follow-up prompt when I decline");
  assert.equal(zoneOf(g.engine, g.id("we")), "play");
  assert.equal(lost(g, P2), 0);
  assert.equal(zoneOf(g.engine, g.id("i1")), "play");
});

clause(WE, "0:rule", "destroying it then lets me choose: X damage to each opponent's faction (X = its strength, 2)", () => {
  const g = weBoard([], weItems());
  startP1(g);
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(zoneOf(g.engine, g.id("we")), "discard", "it is destroyed");
  const pc = pending(g.engine);
  assert.ok(pc, "the choice is mine");
  assert.equal(pc!.kind, "chooserSelectsOption");
  assert.equal(pc!.playerId, P1);
  answerPending(g.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(pending(g.engine), undefined);
  assert.equal(lost(g, P2), 2, "X = 2 to the opponent's faction");
  assert.equal(lost(g, P1), 0, "not my faction");
  for (const k of ["i1", "i2", "i3", "i4", "mi2"]) assert.equal(zoneOf(g.engine, g.id(k)), "play", `${k} untouched`);
});

clause(WE, "0:rule", "X is the strength at the start of the turn: with [V][V][V][V][V] it is 4", () => {
  const g = weBoard(volition(5), weItems());
  assert.equal(str(g, "we"), 4);
  startP1(g);
  answerPending(g.engine, "mayPay", { pay: true });
  answerPending(g.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(lost(g, P2), 4, "X = 4, read before it was destroyed");
});

clause(WE, "0:rule", "the other option: pick an item with numeric cost X or less (X = 2) and destroy it", () => {
  const g = weBoard([], weItems());
  startP1(g);
  answerPending(g.engine, "mayPay", { pay: true });
  answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  const pc = pending(g.engine);
  assert.ok(pc, "pc");
  assert.equal(pc!.kind, "chooserSelectsTarget");
  assert.equal(pc!.playerId, P1);
  for (const bad of ["i3", "i4", "ch", "pl"]) refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(bad)] }), `${bad} is not an item with cost <= 2`, ANY);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("i2")] });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("i2")), "discard", "cost exactly X is allowed");
  for (const k of ["i1", "i3", "i4", "mi2"]) assert.equal(zoneOf(g.engine, g.id(k)), "play", `${k} untouched`);
  assert.equal(lost(g, P2), 0, "no faction damage on this branch");
});

clause(WE, "0:rule", "items of either player qualify, including cost below X; with X = 4 the cost-3 and cost-4 items qualify", () => {
  const a = weBoard([], weItems());
  startP1(a);
  answerPending(a.engine, "mayPay", { pay: true });
  answerPending(a.engine, "chooserSelectsOption", { index: 1 });
  answerPending(a.engine, "chooserSelectsTarget", { selected: [a.id("mi2")] });
  assert.equal(zoneOf(a.engine, a.id("mi2")), "discard", "my own item");
  const b = weBoard([], weItems());
  startP1(b);
  answerPending(b.engine, "mayPay", { pay: true });
  answerPending(b.engine, "chooserSelectsOption", { index: 1 });
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("i1")] });
  assert.equal(zoneOf(b.engine, b.id("i1")), "discard", "cost below X");
  const c = weBoard(volition(5), weItems());
  startP1(c);
  answerPending(c.engine, "mayPay", { pay: true });
  answerPending(c.engine, "chooserSelectsOption", { index: 1 });
  answerPending(c.engine, "chooserSelectsTarget", { selected: [c.id("i4")] });
  assert.equal(zoneOf(c.engine, c.id("i4")), "discard", "cost exactly X = 4");
});

clause(WE, "0:rule", "with X = 2 an item costing 3 cannot be picked; with X = 4 it can", () => {
  const c = weBoard(volition(5), weItems());
  startP1(c);
  answerPending(c.engine, "mayPay", { pay: true });
  answerPending(c.engine, "chooserSelectsOption", { index: 1 });
  answerPending(c.engine, "chooserSelectsTarget", { selected: [c.id("i3")] });
  assert.equal(zoneOf(c.engine, c.id("i3")), "discard");
  assert.equal(zoneOf(c.engine, c.id("i4")), "play");
});

clause(WE, "0:rule", "it only triggers at the start of MY turn: my Expert does nothing at the opponent's turn start", () => {
  const g = board([{ key: "we", def: printing(WE), owner: P1, zone: "play" }, ...weItems()], 3, P1);
  endTurn(g.engine, P1);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("we")), "play");
});

clause(WE, "0:rule", "the opponent's Expert triggers at their turn start and damages MY faction", () => {
  const g = board([{ key: "we", def: printing(WE), owner: P2, zone: "play" }], 3, P1);
  endTurn(g.engine, P1);
  const pc = pending(g.engine);
  assert.ok(pc, "pc");
  assert.equal(pc!.playerId, P2);
  answerPending(g.engine, "mayPay", { pay: true });
  answerPending(g.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(lost(g, P1), 2);
  assert.equal(lost(g, P2), 0);
});

clause(WE, "0:rule", "choosing the item branch with no item cheap enough destroys nothing", () => {
  const g = weBoard([], [{ key: "i4", def: item({ name: "I4", cost: 4, text: "plain" }), owner: P2, zone: "play" }]);
  startP1(g);
  answerPending(g.engine, "mayPay", { pay: true });
  answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  if (pending(g.engine)) drain(g.engine, declineAll);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("i4")), "play");
  assert.equal(zoneOf(g.engine, g.id("we")), "discard");
});

clause(WE, "1:rule@vvvvv", "+2 strength only with five Volition: 4 with, 2 with four or none", () => {
  assert.equal(str(weBoard(volition(5)), "we"), 4);
  assert.equal(str(weBoard(volition(4)), "we"), 2, "one short");
  assert.equal(str(weBoard([...volition(4), ...rage(3)]), "we"), 2, "Rage is not Volition");
  assert.equal(str(weBoard([]), "we"), 2);
  assert.equal(str(weBoard(volition(8)), "we"), 4, "extra Volition does not stack");
  assert.equal(str(weBoard(volition(5, P2)), "we"), 2, "the opponent's Volition does not count");
});

clause(WE, "1:rule@vvvvv", "the +2 is only for this card", () => {
  const g = weBoard(volition(5), [{ key: "ally", def: character({ name: "Ally", strength: 2, life: 5, text: "plain" }), owner: P1, zone: "play" }]);
  assert.equal(str(g, "we"), 4);
  assert.equal(str(g, "ally"), 2);
});
