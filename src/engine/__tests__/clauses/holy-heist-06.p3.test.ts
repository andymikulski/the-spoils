// Clause tests — batch holy-heist-06, part p3 (groups 13-17, missing clauses).
// Expectations come from each card's PRINTED text and RULES.md; engine data is only used to drive the engine.

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
  resourceCard,
  tactic,
  volition,
  P1,
  P2,
  resolvePendingResponses
} from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import { declareAttackBy, declareAttackOpenWindow, fightThrough } from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { developResource, endTurn } from "./_turn.js";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";

const handOf = (engine: SpoilsEngine, p: PlayerId) => engine.state.players[p].hand;
const infl = (engine: SpoilsEngine, p: PlayerId) => engine.state.players[p].influence;
const F = (p: PlayerId) => ({ type: "faction" as const, playerId: p });
const flipUpAction = (engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId) =>
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected: {}, variables: {} });
const decks = () => [...fillers("dA", 8, P1, "deck"), ...fillers("dB", 8, P2, "deck")];

/** A free item whose ability destroys a picked card of `kind` in play. */
const smasher = (kind: "tactic" | "character") =>
  item({
    name: "Smash",
    behavior: {
      abilities: [
        { id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: kind }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }
      ]
    }
  });

// ===========================================================================
// Ocular Dispersal -- tactic, cost 3, [D]
// ATTACH TO CHARACTER (put this card into play attached to that character instead of into its owner's discard pile)
// If the attached character would assign battle damage, it assigns damage equal to its numeric cost instead of its strength.
// If this card would be destroyed, flip face-down under its owner's control instead.
// ===========================================================================

const OD = "5668c682-8404-49c1-ae1c-0a73ee46ca1c";

function odBoard(o: { dee?: number; rage?: number; hostCost?: number; hostStr?: number; active?: PlayerId } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    ...(o.active === P2 ? { activePlayerId: P2, turn: 2 } : {}),
    cards: [
      { key: "od", def: printing(OD), owner: P1, zone: "hand" },
      { key: "host", def: character({ name: "Host", cost: o.hostCost ?? 4, strength: o.hostStr ?? 1, life: 6, speed: 2 }), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", cost: 1, strength: 2, life: 6, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", cost: 1, strength: 1, life: 10, speed: 2 }), owner: P2, zone: "play" },
      { key: "wall", def: character({ name: "Wall", cost: 1, strength: 0, life: 10, speed: 2 }), owner: P2, zone: "play" },
      { key: "it", def: item({ name: "It" }), owner: P1, zone: "play" },
      { key: "loc", def: location({ name: "Loc" }), owner: P1, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "smash", def: smasher("tactic"), owner: P1, zone: "play" },
      { key: "other", def: tactic({ name: "Other", cost: 0 }), owner: P2, zone: "play" },
      ...bank("deception", o.dee ?? 3, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...decks()
    ]
  });
}
type OdGame = ReturnType<typeof odBoard>;
const castOd = (g: OdGame, host = "host") => play(g.engine, P1, g.id("od"), { selected: { attachTo: [g.id(host)] } });

clause(OD, "0:attach", "it deploys attached to the picked character, stays in play (not the discard pile) and costs 3", () => {
  const g = odBoard({ dee: 5 });
  castOd(g);
  const od = g.engine.state.cards[g.id("od")];
  assert.equal(od.zone, "play");
  assert.equal(od.attachedTo, g.id("host"));
  assert.equal(readyResources(g.engine, P1), 2, "5 - 3");
  assert.ok(!g.engine.state.players[P1].discard.includes(g.id("od")), "!g.engine.state.players[P1].discard.includes(g.id(\"od\"))");
  assert.equal(g.engine.state.cards[g.id("ally")].attachedTo, undefined, "not to the other character");
});

clause(OD, "0:attach", "it can attach to an opponent's character", () => {
  const g = odBoard();
  castOd(g, "foe");
  assert.equal(g.engine.state.cards[g.id("od")].attachedTo, g.id("foe"));
  assert.equal(zoneOf(g.engine, g.id("od")), "play");
});

clause(OD, "0:attach", "attached to an opponent's character: only the caster can play it, it asks the host's controller for no decision, and the host keeps its controller", () => {
  const g = odBoard();
  // P2 is the active player with a free main phase, so only "not your card" can refuse (not the turn timing)
  const theirs = odBoard({ active: P2 });
  refused(() => play(theirs.engine, P2, theirs.id("od"), { selected: { attachTo: [theirs.id("foe")] } }), "the opponent cannot play P1's card from P1's hand", /You do not control that card/);
  assert.equal(zoneOf(theirs.engine, theirs.id("od")), "hand");
  assert.equal(zoneOf(g.engine, g.id("od")), "hand", "control: still in hand");
  castOd(g, "foe");
  const od = g.engine.state.cards[g.id("od")];
  assert.equal(od.attachedTo, g.id("foe"));
  assert.equal(od.ownerId, P1);
  assert.equal(g.engine.state.cards[g.id("foe")].controllerId, P2, "the host keeps its controller");
  assert.equal(g.engine.state.pendingChoice, undefined, "the card asks the host's controller for no decision");
});

clause(OD, "0:attach", "attached to an opponent's character, the card keeps its own controller (the player who played it)", () => {
  const g = odBoard();
  castOd(g, "foe");
  const od = g.engine.state.cards[g.id("od")];
  assert.equal(od.controllerId, P1, "an attached card keeps its own controller; attaching does not hand it over");
  assert.ok(g.engine.state.players[P1].play.includes(g.id("od")), "in its own controller's play list");
  assert.ok(!g.engine.state.players[P2].play.includes(g.id("od")), "not in the host controller's play list");
});

clause(OD, "0:attach", "it cannot attach to an item, a location, a character in hand, or nothing", () => {
  const g = odBoard();
  for (const key of ["it", "loc", "inHand"]) {
    refused(() => play(g.engine, P1, g.id("od"), { selected: { attachTo: [g.id(key)] } }), `host ${key}`);
    assert.equal(zoneOf(g.engine, g.id("od")), "hand");
  }
  refused(() => play(g.engine, P1, g.id("od"), { selected: {} }), "no host");
  castOd(g);
  assert.equal(g.engine.state.cards[g.id("od")].attachedTo, g.id("host"), "control: a character host works");
});

clause(OD, "0:attach", "cost 3 and the [D] threshold are enforced", () => {
  const g2 = odBoard({ dee: 2 });
  refused(() => castOd(g2), "only 2 resources");
  assert.equal(zoneOf(g2.engine, g2.id("od")), "hand");
  const gr = odBoard({ dee: 0, rage: 3 });
  refused(() => castOd(gr), "3 resources but no [D]");
  assert.equal(zoneOf(gr.engine, gr.id("od")), "hand");
  const ok = odBoard({ dee: 1, rage: 2 });
  castOd(ok);
  assert.equal(zoneOf(ok.engine, ok.id("od")), "play", "one [D] plus two others is enough");
  assert.equal(readyResources(ok.engine, P1), 0);
});

clause(OD, "1:rule", "an unblocked host assigns damage equal to its numeric cost (4), not its strength (1), to the faction", () => {
  const g = odBoard();
  castOd(g);
  const before = infl(g.engine, P2);
  fightThrough(g.engine, P1, [g.id("host")], F(P2), []);
  assert.equal(before - infl(g.engine, P2), 4);
});

clause(OD, "1:rule", "a blocked host deals its numeric cost to the blocker", () => {
  const g = odBoard();
  castOd(g);
  fightThrough(g.engine, P1, [g.id("host")], F(P2), [g.id("wall")]);
  assert.equal(g.engine.state.cards[g.id("wall")].damage, 4);
});

clause(OD, "1:rule", "a different numeric cost gives a different amount (cost 2, strength 5 deals 2); cost 0 deals 0", () => {
  const a = odBoard({ hostCost: 2, hostStr: 5 });
  castOd(a);
  const before = infl(a.engine, P2);
  fightThrough(a.engine, P1, [a.id("host")], F(P2), []);
  assert.equal(before - infl(a.engine, P2), 2);
  const z = odBoard({ hostCost: 0, hostStr: 5 });
  castOd(z);
  fightThrough(z.engine, P1, [z.id("host")], F(P2), [z.id("wall")]);
  assert.equal(z.engine.state.cards[z.id("wall")].damage ?? 0, 0);
});

clause(OD, "1:rule", "only the attached character is changed: an unattached ally in the same attack still assigns its strength (2)", () => {
  const g = odBoard();
  castOd(g);
  const before = infl(g.engine, P2);
  fightThrough(g.engine, P1, [g.id("host"), g.id("ally")], F(P2), []);
  assert.equal(before - infl(g.engine, P2), 4 + 2);
});

clause(OD, "1:rule", "the attached character also assigns its numeric cost when it blocks", () => {
  const g = odBoard();
  castOd(g);
  endTurn(g.engine, P1);
  fightThrough(g.engine, P2, [g.id("foe")], F(P1), [g.id("host")]);
  assert.equal(g.engine.state.cards[g.id("foe")].damage, 4);
});

clause(OD, "1:rule", "without the Ocular Dispersal the same character assigns its strength (control)", () => {
  const g = odBoard();
  const before = infl(g.engine, P2);
  fightThrough(g.engine, P1, [g.id("host")], F(P2), []);
  assert.equal(before - infl(g.engine, P2), 1);
});

const destroyOd = (g: OdGame) => activate(g.engine, P1, g.id("smash"), "s", { selected: { t: [g.id("od")] } });

clause(OD, "2:rule", "if it would be destroyed it flips face-down in play instead of going to the discard pile", () => {
  const g = odBoard();
  castOd(g);
  const ready = readyResources(g.engine, P1);
  destroyOd(g);
  const od = g.engine.state.cards[g.id("od")];
  assert.equal(od.zone, "play");
  assert.equal(od.faceDown, true);
  assert.ok(!g.engine.state.players[P1].discard.includes(g.id("od")), "!g.engine.state.players[P1].discard.includes(g.id(\"od\"))");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(readyResources(g.engine, P1), ready + 1, "a face-down card is a resource");
});

clause(OD, "2:rule", "it flips face-down under its OWNER's control even when an opponent controlled it", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "od", def: printing(OD), owner: P1, zone: "play", controller: P2, attachedToKey: "host" },
      { key: "host", def: character({ name: "Host" }), owner: P2, zone: "play" },
      { key: "smash", def: smasher("tactic"), owner: P1, zone: "play" }
    ]
  });
  activate(g.engine, P1, g.id("smash"), "s", { selected: { t: [g.id("od")] } });
  const od = g.engine.state.cards[g.id("od")];
  assert.equal(od.zone, "play");
  assert.equal(od.faceDown, true);
  assert.equal(od.controllerId, P1, "controlled by its owner");
});

clause(OD, "2:rule", "other tactics are destroyed normally (the replacement is only for this card)", () => {
  const g = odBoard();
  castOd(g);
  activate(g.engine, P1, g.id("smash"), "s", { selected: { t: [g.id("other")] } });
  assert.equal(zoneOf(g.engine, g.id("other")), "discard");
  assert.equal(g.engine.state.cards[g.id("od")].faceDown ?? false, false);
  assert.equal(g.engine.state.cards[g.id("od")].attachedTo, g.id("host"));
});

clause(OD, "2:rule", "once flipped face-down (a plain resource has no rules text) the host assigns its strength again", () => {
  const g = odBoard();
  castOd(g);
  destroyOd(g);
  const before = infl(g.engine, P2);
  fightThrough(g.engine, P1, [g.id("host")], F(P2), []);
  assert.equal(before - infl(g.engine, P2), 1);
});

clause(OD, "2:rule", "when its host is destroyed the Ocular Dispersal is destroyed with it (CR 301.4a) and its own flip-face-down replacement applies (CR 301.4b)", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "od", def: printing(OD), owner: P1, zone: "hand" },
      { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
      { key: "smash", def: smasher("character"), owner: P1, zone: "play" },
      ...bank("deception", 3, P1)
    ]
  });
  play(g.engine, P1, g.id("od"), { selected: { attachTo: [g.id("host")] } });
  activate(g.engine, P1, g.id("smash"), "s", { selected: { t: [g.id("host")] } });
  assert.equal(zoneOf(g.engine, g.id("host")), "discard");
  assert.equal(zoneOf(g.engine, g.id("od")), "play", "flipped face-down instead of destroyed");
  assert.equal(g.engine.state.cards[g.id("od")].faceDown, true, "a face-down resource");
});

// ===========================================================================
// Sneaky Sarco -- character, cost 1, [D][D], 1/4/1
// When this card enters play, flip a coin. If you win, put a token on this card.
// While there is a token on this card, it gains COVERT.
// FEED -- COST: Pay 1. Remove a token from this card. -- EFFECT: This turn, this card gains 1 strength and 1 life.
// ===========================================================================

const SARCO = "745b2a35-f814-4f40-a5fb-f072e281e756";

function sarcoBoard(o: { zone?: "hand" | "play"; tokens?: number; dee?: number; rage?: number; random?: () => number; turn?: 1 | 2 } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: o.random,
    cards: [
      { key: "sc", def: printing(SARCO), owner: P1, zone: o.zone ?? "play", ...(o.tokens ? { counters: { token: o.tokens } } : {}) },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "plain", def: character({ name: "Plain", strength: 0, life: 5, speed: 1 }), owner: P2, zone: "play" },
      { key: "covB", def: character({ name: "CovB", strength: 0, life: 5, speed: 1, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" },
      ...bank("deception", o.dee ?? 2, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...decks()
    ]
  });
}
const flips = (engine: SpoilsEngine) =>
  engine
    .getLog()
    .map(e => e.event as unknown as Record<string, unknown> | undefined)
    .filter((e): e is Record<string, unknown> => !!e && e.type === "coinFlipped");

clause(SARCO, "0:rule", "entering play: winning the coin flip puts a token on this card", () => {
  const g = sarcoBoard({ zone: "hand", random: () => 0 });
  play(g.engine, P1, g.id("sc"));
  assert.equal(zoneOf(g.engine, g.id("sc")), "play");
  assert.equal(tokensOn(g.engine, g.id("sc")), 1);
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(SARCO, "0:rule", "the flip is a fair coin: a roll just under half wins (token), a roll just over half loses (none)", () => {
  const win = sarcoBoard({ zone: "hand", random: () => 0.4 });
  play(win.engine, P1, win.id("sc"));
  assert.equal(tokensOn(win.engine, win.id("sc")), 1, "0.4 wins");
  const lose = sarcoBoard({ zone: "hand", random: () => 0.6 });
  play(lose.engine, P1, lose.id("sc"));
  assert.equal(tokensOn(lose.engine, lose.id("sc")), 0, "0.6 loses");
});

clause(SARCO, "0:rule", "entering play: losing the coin flip puts no token", () => {
  const g = sarcoBoard({ zone: "hand", random: () => 0.99 });
  play(g.engine, P1, g.id("sc"));
  assert.equal(zoneOf(g.engine, g.id("sc")), "play");
  assert.equal(tokensOn(g.engine, g.id("sc")), 0);
  assert.equal(g.engine.state.cards[g.id("ally")].counters?.token ?? 0, 0);
});

clause(SARCO, "0:rule", "the coin flip is a real coin flip (one coinFlipped event for the controller, won matching the token)", () => {
  const win = sarcoBoard({ zone: "hand", random: () => 0 });
  play(win.engine, P1, win.id("sc"));
  assert.equal(flips(win.engine).length, 1);
  assert.equal(flips(win.engine)[0].playerId, P1);
  assert.equal(flips(win.engine)[0].won, true);
  const lose = sarcoBoard({ zone: "hand", random: () => 0.99 });
  play(lose.engine, P1, lose.id("sc"));
  assert.equal(flips(lose.engine).length, 1);
  assert.equal(flips(lose.engine)[0].won, false);
});

clause(SARCO, "0:rule", "another card entering play does not flip a coin or add a token", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    random: () => 0,
    cards: [
      { key: "sc", def: printing(SARCO), owner: P1, zone: "play" },
      { key: "next", def: character({ name: "Next", cost: 1 }), owner: P1, zone: "hand" },
      ...bank("deception", 2, P1)
    ]
  });
  play(g.engine, P1, g.id("next"));
  assert.equal(zoneOf(g.engine, g.id("next")), "play");
  assert.equal(tokensOn(g.engine, g.id("sc")), 0);
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(SARCO, "0:rule", "deploying costs 1 and needs [D][D]", () => {
  const g = sarcoBoard({ zone: "hand", dee: 2, random: () => 0.99 });
  play(g.engine, P1, g.id("sc"));
  assert.equal(readyResources(g.engine, P1), 1, "2 - 1");
  const one = sarcoBoard({ zone: "hand", dee: 1 });
  refused(() => play(one.engine, P1, one.id("sc")), "one [D] is short of [D][D]", /Threshold requirements are not met/);
  const rage = sarcoBoard({ zone: "hand", dee: 0, rage: 3 });
  refused(() => play(rage.engine, P1, rage.id("sc")), "no [D]");
  const mixed = sarcoBoard({ zone: "hand", dee: 1, rage: 2 });
  refused(() => play(mixed.engine, P1, mixed.id("sc")), "only one [D]");
  assert.equal(zoneOf(mixed.engine, mixed.id("sc")), "hand");
});

clause(SARCO, "1:rule", "with a token it has COVERT; without one it does not; losing the token loses COVERT", () => {
  const withTok = sarcoBoard({ tokens: 1 });
  assert.ok(withTok.engine.getKeywords(withTok.id("sc")).includes("covert"), "withTok.engine.getKeywords(withTok.id(\"sc\")).includes(\"covert\")");
  const without = sarcoBoard({ tokens: 0 });
  assert.ok(!without.engine.getKeywords(without.id("sc")).includes("covert"), "!without.engine.getKeywords(without.id(\"sc\")).includes(\"covert\")");
  activate(withTok.engine, P1, withTok.id("sc"), "sneaky-sarco-feed");
  assert.ok(!withTok.engine.getKeywords(withTok.id("sc")).includes("covert"), "token removed by FEED");
  const two = sarcoBoard({ tokens: 2 });
  activate(two.engine, P1, two.id("sc"), "sneaky-sarco-feed");
  assert.ok(two.engine.getKeywords(two.id("sc")).includes("covert"), "still a token left");
});

clause(SARCO, "1:rule", "a covert Sarco (token) cannot be blocked by a non-covert character but can by a covert one", () => {
  const g = sarcoBoard({ tokens: 1 });
  declareAttackBy(g.engine, P1, [g.id("sc")]);
  refused(() => declareBlockers(g.engine, P2, [g.id("plain")]), "non-covert cannot block covert");
  declareBlockers(g.engine, P2, [g.id("covB")]);
  assert.ok(g.engine.state.battle, "g.engine.state.battle");
});

clause(SARCO, "1:rule", "without a token Sarco is not covert: a non-covert character blocks it", () => {
  const g = sarcoBoard({ tokens: 0 });
  declareAttackBy(g.engine, P1, [g.id("sc")]);
  refused(() => declareBlockers(g.engine, P2, [g.id("covB")]), "covert may only block covert parties");
  declareBlockers(g.engine, P2, [g.id("plain")]);
  assert.ok(g.engine.state.battle, "g.engine.state.battle");
});

clause(SARCO, "2:ability:sneaky-sarco-feed", "FEED pays 1, removes a token, and this card gets +1 strength and +1 life (2/4/2) with speed unchanged", () => {
  const g = sarcoBoard({ tokens: 1, dee: 3 });
  activate(g.engine, P1, g.id("sc"), "sneaky-sarco-feed");
  assert.equal(readyResources(g.engine, P1), 2, "paid 1");
  assert.equal(tokensOn(g.engine, g.id("sc")), 0);
  assert.equal(g.engine.getStat(g.id("sc"), "strength"), 2);
  assert.equal(g.engine.getStat(g.id("sc"), "life"), 2);
  assert.equal(g.engine.getStat(g.id("sc"), "speed"), 4);
  assert.equal(g.engine.getStat(g.id("ally"), "strength"), 2, "other characters unchanged");
  assert.equal(g.engine.getStat(g.id("ally"), "life"), 2);
});

clause(SARCO, "2:ability:sneaky-sarco-feed", "FEED removes only ONE token (two tokens leave one) and activations stack", () => {
  const g = sarcoBoard({ tokens: 2, dee: 3 });
  activate(g.engine, P1, g.id("sc"), "sneaky-sarco-feed");
  assert.equal(tokensOn(g.engine, g.id("sc")), 1);
  assert.equal(g.engine.getStat(g.id("sc"), "strength"), 2);
  activate(g.engine, P1, g.id("sc"), "sneaky-sarco-feed");
  assert.equal(tokensOn(g.engine, g.id("sc")), 0);
  assert.equal(g.engine.getStat(g.id("sc"), "strength"), 3);
  assert.equal(g.engine.getStat(g.id("sc"), "life"), 3);
  assert.equal(readyResources(g.engine, P1), 1, "paid 1 twice");
});

clause(SARCO, "2:ability:sneaky-sarco-feed", "FEED is refused with no token (and nothing is paid), or with no resource to pay", () => {
  const none = sarcoBoard({ tokens: 0, dee: 3 });
  refused(() => activate(none.engine, P1, none.id("sc"), "sneaky-sarco-feed"), "no token to remove");
  assert.equal(readyResources(none.engine, P1), 3);
  assert.equal(none.engine.getStat(none.id("sc"), "strength"), 1);
  const broke = sarcoBoard({ tokens: 1, dee: 0 });
  refused(() => activate(broke.engine, P1, broke.id("sc"), "sneaky-sarco-feed"), "cannot pay 1");
  assert.equal(tokensOn(broke.engine, broke.id("sc")), 1, "token kept");
  const rage = sarcoBoard({ tokens: 1, dee: 0, rage: 1 });
  activate(rage.engine, P1, rage.id("sc"), "sneaky-sarco-feed");
  assert.equal(tokensOn(rage.engine, rage.id("sc")), 0, "any resource pays (control)");
});

clause(SARCO, "2:ability:sneaky-sarco-feed", "the bonus lasts only this turn", () => {
  const g = sarcoBoard({ tokens: 1, dee: 3 });
  activate(g.engine, P1, g.id("sc"), "sneaky-sarco-feed");
  assert.equal(g.engine.getStat(g.id("sc"), "strength"), 2);
  endTurn(g.engine, P1);
  assert.equal(g.engine.getStat(g.id("sc"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("sc"), "life"), 1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.getStat(g.id("sc"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("sc"), "life"), 1);
});

// ===========================================================================
// Super Slingerang XL200 -- item, cost 1, [D]
// When this card enters play you may discard a card at random. If you do, you may pick a character and destroy it.
// SLING -- COST: Pay 3. Pick an item. Destroy this card. -- EFFECT: Destroy that card.
// RANG -- COST: Pay 4 or discard a non-resource Rogue card. -- EFFECT: Put this card into its owner's hand.
// FLIP UP: 1 [D]
// ===========================================================================

const SX = "469e7907-ded7-4533-8174-02ef735808f6";

function sxBoard(o: { hand?: number; random?: () => number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: o.random,
    cards: [
      { key: "sx", def: printing(SX), owner: P1, zone: "hand" },
      ...fillers("h", o.hand ?? 3, P1, "hand"),
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "foeItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      { key: "foeLoc", def: location({ name: "FoeLoc" }), owner: P2, zone: "play" },
      ...bank("deception", 1, P1),
      ...decks()
    ]
  });
}
type SxGame = ReturnType<typeof sxBoard>;
const sxHandOthers = (g: SxGame) => handOf(g.engine, P1).filter(c => c !== g.id("sx"));
const playSx = (g: SxGame, optIndex: 0 | 1, pick?: string | null) => {
  play(g.engine, P1, g.id("sx"));
  assert.equal(pending(g.engine)?.kind, "chooserSelectsOption", "asked whether to discard at random");
  answerPending(g.engine, "chooserSelectsOption", { index: optIndex });
  if (pick !== undefined && pending(g.engine)?.kind === "chooserSelectsTarget") {
    answerPending(g.engine, "chooserSelectsTarget", { selected: pick === null ? [] : [g.id(pick)] });
  }
};

clause(SX, "0:rule", "accepting: one random card is discarded from hand and the picked character (opponent's) is destroyed", () => {
  const g = sxBoard({ random: () => 0 });
  const before = sxHandOthers(g);
  playSx(g, 1, "foe");
  assert.equal(zoneOf(g.engine, g.id("sx")), "play");
  assert.equal(sxHandOthers(g).length, before.length - 1, "exactly one card discarded");
  const gone = before.filter(c => !sxHandOthers(g).includes(c));
  assert.equal(gone.length, 1);
  assert.equal(zoneOf(g.engine, gone[0]), "discard");
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(SX, "0:rule", "the discard is at random: different seeds discard different cards, and the Slingerang itself is never the discard", () => {
  const lo = sxBoard({ random: () => 0 });
  const hi = sxBoard({ random: () => 0.99 });
  const loBefore = sxHandOthers(lo);
  const hiBefore = sxHandOthers(hi);
  playSx(lo, 1, null);
  playSx(hi, 1, null);
  const loGone = loBefore.filter(c => !sxHandOthers(lo).includes(c));
  const hiGone = hiBefore.filter(c => !sxHandOthers(hi).includes(c));
  assert.equal(loGone.length, 1);
  assert.equal(hiGone.length, 1);
  assert.notEqual(loBefore.indexOf(loGone[0]), hiBefore.indexOf(hiGone[0]), "a different position of the hand");
  assert.equal(zoneOf(lo.engine, lo.id("sx")), "play");
  assert.equal(zoneOf(hi.engine, hi.id("sx")), "play");
});

clause(SX, "0:rule", "the controller (not the opponent) answers both the may-discard option and the character pick", () => {
  const g = sxBoard({ random: () => 0 });
  play(g.engine, P1, g.id("sx"));
  assert.equal((pending(g.engine) as unknown as { playerId: string }).playerId, P1, "may-discard decided by its controller");
  answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget");
  assert.equal((pending(g.engine) as unknown as { playerId: string }).playerId, P1, "pick decided by its controller");
});

clause(SX, "0:rule", "accepting the discard but declining the pick destroys nothing", () => {
  const g = sxBoard({ random: () => 0 });
  const before = sxHandOthers(g).length;
  playSx(g, 1, null);
  assert.equal(sxHandOthers(g).length, before - 1, "the card was still discarded");
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(SX, "0:rule", "declining the discard: nothing is discarded, no character may be picked or destroyed", () => {
  const g = sxBoard({ random: () => 0 });
  const before = sxHandOthers(g);
  playSx(g, 0);
  assert.deepEqual(sxHandOthers(g), before);
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play");
  assert.equal(g.engine.state.pendingChoice, undefined, "no pick offered");
  assert.equal(zoneOf(g.engine, g.id("sx")), "play");
});

clause(SX, "0:rule", "the pick may be any character, including your own", () => {
  const g = sxBoard({ random: () => 0 });
  playSx(g, 1, "mine");
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard");
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
});

clause(SX, "0:rule", "the pick must be a character: an item, a location or a card in hand is refused", () => {
  for (const key of ["foeItem", "foeLoc", "h2"]) {
    const g = sxBoard({ random: () => 0 });
    play(g.engine, P1, g.id("sx"));
    answerPending(g.engine, "chooserSelectsOption", { index: 1 });
    assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget");
    refused(
      () => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [g.id(key)] } } as never),
      `pick ${key}`
    );
    assert.equal(zoneOf(g.engine, g.id(key)), key === "h2" ? "hand" : "play");
  }
});

clause(SX, "0:rule", "with an empty hand nothing can be discarded, so 'if you do' fails and no character may be picked", () => {
  const g = sxBoard({ hand: 0, random: () => 0 });
  play(g.engine, P1, g.id("sx"));
  if (pending(g.engine)?.kind === "chooserSelectsOption") answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  assert.notEqual(pending(g.engine)?.kind, "chooserSelectsTarget", "no pick without a discard");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play");
});

clause(SX, "0:rule", "another item entering play does not trigger it", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "sx", def: printing(SX), owner: P1, zone: "play" },
      { key: "it2", def: item({ name: "It2", cost: 0 }), owner: P1, zone: "hand" },
      ...fillers("h", 2, P1, "hand"),
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }
    ]
  });
  play(g.engine, P1, g.id("it2"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(handOf(g.engine, P1).length, 2);
});

const slingBoard = (o: { res?: number; rage?: boolean } = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "sx", def: printing(SX), owner: P1, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "foeItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "foeLoc", def: location({ name: "FoeLoc" }), owner: P2, zone: "play" },
      { key: "handItem", def: item({ name: "HandItem" }), owner: P2, zone: "hand" },
      ...bank(o.rage ? "rage" : "deception", o.res ?? 5, P1)
    ]
  });

clause(SX, "1:ability:slingerang-sling", "SLING pays 3, destroys the Slingerang, and destroys the picked opposing item", () => {
  const g = slingBoard({ res: 5 });
  activate(g.engine, P1, g.id("sx"), "slingerang-sling", { selected: { it: [g.id("foeItem")] } });
  assert.equal(readyResources(g.engine, P1), 2, "paid 3");
  assert.equal(zoneOf(g.engine, g.id("sx")), "discard");
  assert.equal(zoneOf(g.engine, g.id("foeItem")), "discard");
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
});

clause(SX, "1:ability:slingerang-sling", "SLING may pick your own item, and any resource type pays", () => {
  const g = slingBoard({ res: 3, rage: true });
  activate(g.engine, P1, g.id("sx"), "slingerang-sling", { selected: { it: [g.id("myItem")] } });
  assert.equal(zoneOf(g.engine, g.id("myItem")), "discard");
  assert.equal(zoneOf(g.engine, g.id("sx")), "discard");
  assert.equal(readyResources(g.engine, P1), 0);
});

clause(SX, "1:ability:slingerang-sling", "SLING can pick the Slingerang itself (an item in play): it is destroyed", () => {
  const g = slingBoard({ res: 3 });
  activate(g.engine, P1, g.id("sx"), "slingerang-sling", { selected: { it: [g.id("sx")] } });
  assert.equal(zoneOf(g.engine, g.id("sx")), "discard");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(SX, "1:ability:slingerang-sling", "SLING's pick must be an item in play: a character, a location or an item in hand is refused (nothing paid)", () => {
  const g = slingBoard({ res: 5 });
  for (const key of ["foe", "foeLoc", "handItem"]) {
    refused(() => activate(g.engine, P1, g.id("sx"), "slingerang-sling", { selected: { it: [g.id(key)] } }), `pick ${key}`);
    assert.equal(zoneOf(g.engine, g.id("sx")), "play");
    assert.equal(readyResources(g.engine, P1), 5, "nothing paid");
  }
  refused(() => activate(g.engine, P1, g.id("sx"), "slingerang-sling", { selected: {} }), "no pick");
  activate(g.engine, P1, g.id("sx"), "slingerang-sling", { selected: { it: [g.id("foeItem")] } });
  assert.equal(zoneOf(g.engine, g.id("foeItem")), "discard", "control");
});

clause(SX, "1:ability:slingerang-sling", "SLING is refused with fewer than 3 resources", () => {
  const g = slingBoard({ res: 2 });
  refused(() => activate(g.engine, P1, g.id("sx"), "slingerang-sling", { selected: { it: [g.id("foeItem")] } }), "pay 3 with 2");
  assert.equal(zoneOf(g.engine, g.id("sx")), "play");
  assert.equal(zoneOf(g.engine, g.id("foeItem")), "play");
});

const rangBoard = (o: { res?: number; owner?: PlayerId } = {}) => {
  const controller = o.owner ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: controller,
    turn: controller === P1 ? 1 : 2,
    cards: [
      { key: "sx", def: printing(SX), owner: P1, zone: "play", controller },
      { key: "rogue", def: character({ name: "RogueGuy", trade: "rogue" }), owner: controller, zone: "hand" },
      { key: "rogue2", def: tactic({ name: "RogueTactic", trade: "rogue", cost: 0 }), owner: controller, zone: "hand" },
      { key: "warl", def: character({ name: "Warlord", trade: "warlord" }), owner: controller, zone: "hand" },
      { key: "rogueRes", def: resourceCard({ name: "RogueRes", trade: "rogue", resource: { provides: ["deception"], staple: false } }), owner: controller, zone: "hand" },
      ...bank("deception", o.res ?? 0, controller)
    ]
  });
};

clause(SX, "2:ability:slingerang-rang", "RANG paying 4 returns it to its owner's hand and discards nothing", () => {
  const g = rangBoard({ res: 4 });
  const hand = [...handOf(g.engine, P1)];
  activate(g.engine, P1, g.id("sx"), "slingerang-rang");
  assert.equal(readyResources(g.engine, P1), 0, "paid 4");
  assert.equal(zoneOf(g.engine, g.id("sx")), "hand");
  assert.ok(handOf(g.engine, P1).includes(g.id("sx")), "handOf(g.engine, P1).includes(g.id(\"sx\"))");
  assert.deepEqual(handOf(g.engine, P1).filter(c => c !== g.id("sx")), hand, "no card discarded");
});

clause(SX, "2:ability:slingerang-rang", "RANG discarding a non-resource Rogue card (character or tactic) is the whole cost: no resources needed", () => {
  for (const key of ["rogue", "rogue2"]) {
    const g = rangBoard({ res: 0 });
    activate(g.engine, P1, g.id("sx"), "slingerang-rang", { selected: { "rang-d": [g.id(key)] } });
    assert.equal(zoneOf(g.engine, g.id(key)), "discard", key);
    assert.equal(zoneOf(g.engine, g.id("sx")), "hand");
    assert.equal(g.engine.state.pendingChoice, undefined);
  }
});

clause(SX, "2:ability:slingerang-rang", "with 4 resources AND a Rogue card the player may choose to discard instead of paying", () => {
  const g = rangBoard({ res: 4 });
  activate(g.engine, P1, g.id("sx"), "slingerang-rang", { selected: { "rang-d": [g.id("rogue")] } });
  assert.equal(zoneOf(g.engine, g.id("rogue")), "discard");
  assert.equal(readyResources(g.engine, P1), 4, "no resource spent");
  assert.equal(zoneOf(g.engine, g.id("sx")), "hand");
});

clause(SX, "2:ability:slingerang-rang", "RANG's discard cost refuses a non-Rogue card and a Rogue resource card; without 4 resources it is refused", () => {
  const g = rangBoard({ res: 0 });
  for (const key of ["warl", "rogueRes"]) {
    refused(() => activate(g.engine, P1, g.id("sx"), "slingerang-rang", { selected: { "rang-d": [g.id(key)] } }), `discard ${key}`);
    assert.equal(zoneOf(g.engine, g.id(key)), "hand");
    assert.equal(zoneOf(g.engine, g.id("sx")), "play");
  }
  refused(() => activate(g.engine, P1, g.id("sx"), "slingerang-rang"), "no payment at all");
  const poor = rangBoard({ res: 3 });
  refused(() => activate(poor.engine, P1, poor.id("sx"), "slingerang-rang"), "only 3 resources and no discard");
  assert.equal(zoneOf(poor.engine, poor.id("sx")), "play");
  assert.equal(readyResources(poor.engine, P1), 3);
  activate(g.engine, P1, g.id("sx"), "slingerang-rang", { selected: { "rang-d": [g.id("rogue")] } });
  assert.equal(zoneOf(g.engine, g.id("sx")), "hand", "control");
});

clause(SX, "2:ability:slingerang-rang", "RANG goes to its OWNER's hand even when an opponent controls it", () => {
  const g = rangBoard({ res: 4, owner: P2 });
  activate(g.engine, P2, g.id("sx"), "slingerang-rang");
  assert.equal(zoneOf(g.engine, g.id("sx")), "hand");
  assert.ok(handOf(g.engine, P1).includes(g.id("sx")), "owner's hand");
  assert.ok(!handOf(g.engine, P2).includes(g.id("sx")), "!handOf(g.engine, P2).includes(g.id(\"sx\"))");
});

function flipBoard(o: { dee?: number; rage?: number; faceDown?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "sx", def: printing(SX), owner: P1, zone: "play", faceDown: o.faceDown ?? true },
      ...fillers("h", 2, P1, "hand"),
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      ...bank("deception", o.dee ?? 0, P1),
      ...bank("rage", o.rage ?? 0, P1)
    ]
  });
}

clause(SX, "3:flipUp", "FLIP UP with one [D] turns it face-up as an item in play and spends exactly 1", () => {
  const g = flipBoard({ dee: 2 });
  assert.equal(readyResources(g.engine, P1), 3, "2 banks + the face-down card");
  flipUpAction(g.engine, P1, g.id("sx"));
  resolvePendingResponses(g.engine);
  const sx = g.engine.state.cards[g.id("sx")];
  assert.equal(sx.zone, "play");
  assert.equal(sx.faceDown, false);
  assert.deepEqual(g.engine.getCardTypes(g.id("sx")), ["item"]);
  assert.equal(readyResources(g.engine, P1), 1, "3 - 1 paid - 1 (no longer a resource)");
});

clause(SX, "3:flipUp", "FLIP UP is refused without a [D] (even with plenty of other resources) and with no other resources", () => {
  const rage = flipBoard({ dee: 0, rage: 4 });
  refused(() => flipUpAction(rage.engine, P1, rage.id("sx")), "no [D]");
  assert.equal(rage.engine.state.cards[rage.id("sx")].faceDown, true);
  assert.equal(readyResources(rage.engine, P1), 5);
  const none = flipBoard({});
  refused(() => flipUpAction(none.engine, P1, none.id("sx")), "nothing to pay with");
  const ok = flipBoard({ dee: 1 });
  flipUpAction(ok.engine, P1, ok.id("sx"));
  assert.equal(ok.engine.state.cards[ok.id("sx")].faceDown, false, "control: a single [D] is enough");
});

clause(SX, "3:flipUp", "a face-up Slingerang cannot be flipped up again", () => {
  const g = flipBoard({ dee: 2, faceDown: false });
  refused(() => flipUpAction(g.engine, P1, g.id("sx")), "already face-up");
});

clause(SX, "3:flipUp", "FLIP UP deploys it, so its enters-play ability runs (discard at random, then pick a character to destroy)", () => {
  const g = flipBoard({ dee: 2 });
  flipUpAction(g.engine, P1, g.id("sx"));
  resolvePendingResponses(g.engine);
  assert.equal(pending(g.engine)?.kind, "chooserSelectsOption");
  answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(handOf(g.engine, P1).length, 1, "one card discarded at random");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("foe")] });
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(SX, "3:flipUp", "a non-tactic cannot be flipped up in an opponent's response window", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [
      { key: "sx", def: printing(SX), owner: P1, zone: "play", faceDown: true },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...bank("deception", 2, P1)
    ]
  });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  refused(() => flipUpAction(g.engine, P1, g.id("sx")), "item flip-up in the opponent's window");
  assert.equal(g.engine.state.cards[g.id("sx")].faceDown, true);
});

// ===========================================================================
// Thabbashite Dartist -- character, cost 4, [D], 3/3/1
// When a card that provides at least [V] enters play under your control, you may pick a character.
// If you do, that character loses 1 life this turn.
// ===========================================================================

const DART = "ad2abdfd-c8dc-42fb-9e2c-e3627c2073c4";

function dartBoard(o: { active?: PlayerId; dartZone?: "play" | "hand"; dee?: number; rage?: number } = {}) {
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [
      { key: "dart", def: printing(DART), owner: P1, zone: o.dartZone ?? "play" },
      { key: "dart2", def: printing(DART), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", life: 4 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 3 }), owner: P1, zone: "play" },
      { key: "one", def: character({ name: "One", life: 1 }), owner: P2, zone: "play" },
      { key: "it", def: item({ name: "It" }), owner: P2, zone: "play" },
      { key: "resD", def: resourceCard({ name: "ResD", resource: { provides: ["deception"], staple: true } }), owner: P1, zone: "hand" },
      { key: "resV", def: resourceCard({ name: "ResV", resource: { provides: ["volition"], staple: false } }), owner: P1, zone: "hand" },
      { key: "foeRes", def: resourceCard({ name: "FoeRes", resource: { provides: ["deception"], staple: true } }), owner: P2, zone: "hand" },
      { key: "mover", def: item({ name: "Mover", behavior: { abilities: [{ id: "m", type: "activated", targets: [{ id: "t", selector: { zone: "hand", type: "resource" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] } }), owner: P1, zone: "play" },
      { key: "foeV", def: resourceCard({ name: "FoeV", resource: { provides: ["volition"], staple: false } }), owner: P2, zone: "hand" },
      { key: "mover2", def: item({ name: "Mover2", behavior: { abilities: [{ id: "m", type: "activated", targets: [{ id: "t", selector: { zone: "hand", type: "resource" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] } }), owner: P2, zone: "play" },
      ...bank("deception", o.dee ?? 4, P1),
      ...decks()
    ]
  });
}
type DartGame = ReturnType<typeof dartBoard>;
/** Runs `go`, then answers every pick prompt (counted) with `pick` (null = decline). */
function answerPicks(g: DartGame, pick: string | null): number {
  let prompts = 0;
  drain(g.engine, pc => {
    if (pc.kind === "selectTargets") {
      prompts++;
      return { kind: "selectTargets", selected: { c: pick ? [g.id(pick)] : [] } };
    }
    return declineAll(pc);
  });
  return prompts;
}
const life = (g: DartGame, k: string) => g.engine.getStat(g.id(k), "life");

clause(DART, "0:rule", "a face-down resource (provides [V]) developed under your control: pick a character, it loses exactly 1 life", () => {
  const g = dartBoard();
  developResource(g.engine, P1, g.id("resD"), true);
  resolvePendingResponses(g.engine);
  assert.equal(pending(g.engine)?.kind, "selectTargets");
  assert.equal(answerPicks(g, "foe"), 1, "one prompt only");
  assert.equal(life(g, "foe"), 3);
  assert.equal(life(g, "mine"), 3, "others unaffected");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(DART, "0:rule", "a face-up resource that provides [V] also triggers it (once)", () => {
  const g = dartBoard();
  developResource(g.engine, P1, g.id("resV"), false);
  resolvePendingResponses(g.engine);
  assert.equal(answerPicks(g, "foe"), 1);
  assert.equal(life(g, "foe"), 3);
});

clause(DART, "0:rule", "a face-up resource that provides only [D] does not trigger it", () => {
  const g = dartBoard();
  developResource(g.engine, P1, g.id("resD"), false);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(life(g, "foe"), 4);
});

clause(DART, "0:rule", "a face-up [V] card put into play by an effect (not Develop) triggers it", () => {
  const g = dartBoard();
  activate(g.engine, P1, g.id("mover"), "m", { selected: { t: [g.id("resV")] } });
  assert.equal(zoneOf(g.engine, g.id("resV")), "play");
  assert.equal(answerPicks(g, "foe"), 1);
  assert.equal(life(g, "foe"), 3);
});

clause(DART, "0:rule", "'you may pick': declining leaves every life total unchanged", () => {
  const g = dartBoard();
  developResource(g.engine, P1, g.id("resD"), true);
  resolvePendingResponses(g.engine);
  assert.equal(answerPicks(g, null), 1);
  assert.equal(life(g, "foe"), 4);
  assert.equal(life(g, "mine"), 3);
  assert.equal(life(g, "one"), 1);
});

clause(DART, "0:rule", "any character may be picked, including your own; items are refused", () => {
  const g = dartBoard();
  developResource(g.engine, P1, g.id("resD"), true);
  resolvePendingResponses(g.engine);
  answerPicks(g, "mine");
  assert.equal(life(g, "mine"), 2);
  const bad = dartBoard();
  developResource(bad.engine, P1, bad.id("resD"), true);
  resolvePendingResponses(bad.engine);
  refused(
    () => bad.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { c: [bad.id("it")] } } } as never),
    "an item is not a character"
  );
});

clause(DART, "0:rule", "the life loss lasts only this turn", () => {
  const g = dartBoard();
  developResource(g.engine, P1, g.id("resD"), true);
  resolvePendingResponses(g.engine);
  answerPicks(g, "foe");
  assert.equal(life(g, "foe"), 3);
  endTurn(g.engine, P1);
  assert.equal(life(g, "foe"), 4);
  endTurn(g.engine, P2);
  assert.equal(life(g, "foe"), 4);
});

clause(DART, "0:rule", "an opponent's resource entering play does not trigger it", () => {
  const g = dartBoard({ active: P2 });
  developResource(g.engine, P2, g.id("foeRes"), true);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(life(g, "foe"), 4);
  assert.equal(life(g, "mine"), 3);
});

clause(DART, "0:rule", "a card that does not provide [V] (a character with a face-up deploy) does not trigger it", () => {
  const g = dartBoard();
  play(g.engine, P1, g.id("dart2"));
  assert.equal(zoneOf(g.engine, g.id("dart2")), "play");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(life(g, "foe"), 4);
});

clause(DART, "0:rule", "it only works while in play: a Dartist in hand gives no prompt", () => {
  const g = dartBoard({ dartZone: "hand" });
  developResource(g.engine, P1, g.id("resD"), true);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(life(g, "foe"), 4);
});

clause(DART, "0:rule", "a 1-life character picked loses 1 life and (at 0 life) is destroyed", () => {
  const g = dartBoard();
  developResource(g.engine, P1, g.id("resD"), true);
  resolvePendingResponses(g.engine);
  answerPicks(g, "one");
  assert.equal(zoneOf(g.engine, g.id("one")), "discard");
});

// ===========================================================================
// Thabbashite Urchin -- character, cost 2, [D], 2/3/2
// [V][V][V]: While an opponent controls an item, this card cannot be blocked.
// ===========================================================================

const URCHIN = "e4730213-75fc-4614-9466-1b3c1e42e630";

function urchinBoard(o: { vol?: number; oppVol?: number; dee?: number; foeItem?: boolean; myItem?: boolean; foeLoc?: boolean; stolen?: boolean; lent?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "tu", def: printing(URCHIN), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 0, life: 5, speed: 1 }), owner: P2, zone: "play" },
      ...(o.foeItem === false ? [] : [{ key: "fi", def: item({ name: "FoeItem" }), owner: P2, zone: "play" as const }]),
      ...(o.myItem ? [{ key: "mi", def: item({ name: "MyItem" }), owner: P1, zone: "play" as const }] : []),
      ...(o.foeLoc ? [{ key: "fl", def: location({ name: "FoeLoc" }), owner: P2, zone: "play" as const }] : []),
      ...(o.stolen ? [{ key: "st", def: item({ name: "Stolen" }), owner: P1, zone: "play" as const, controller: P2 }] : []),
      ...(o.lent ? [{ key: "ln", def: item({ name: "Lent" }), owner: P2, zone: "play" as const, controller: P1 }] : []),
      { key: "smash", def: smasher("character"), owner: P1, zone: "play" },
      ...volition(o.vol ?? 3, P1),
      ...volition(o.oppVol ?? 0, P2),
      ...bank("deception", o.dee ?? 0, P1)
    ]
  });
}
const blockable = (g: ReturnType<typeof urchinBoard>) => {
  declareAttackBy(g.engine, P1, [g.id("tu")]);
  try {
    declareBlockers(g.engine, P2, [g.id("blk")]);
    return true;
  } catch {
    return false;
  }
};

clause(URCHIN, "0:rule@vvv", "with [V][V][V] and an opponent's item in play, it cannot be blocked", () => {
  const g = urchinBoard();
  assert.ok(g.engine.getKeywords(g.id("tu")).includes("cannotBeBlocked"), "g.engine.getKeywords(g.id(\"tu\")).includes(\"cannotBeBlocked\")");
  assert.equal(blockable(g), false, "cannot be blocked");
  const u = urchinBoard();
  const before = infl(u.engine, P2);
  fightThrough(u.engine, P1, [u.id("tu")], F(P2), []);
  assert.equal(before - infl(u.engine, P2), 2, "its 2 damage reaches the faction");
});

clause(URCHIN, "0:rule@vvv", "below the threshold ([V][V], or enough non-[V] resources) it can be blocked", () => {
  const two = urchinBoard({ vol: 2 });
  assert.ok(!two.engine.getKeywords(two.id("tu")).includes("cannotBeBlocked"), "!two.engine.getKeywords(two.id(\"tu\")).includes(\"cannotBeBlocked\")");
  assert.equal(blockable(two), true);
  const dee = urchinBoard({ vol: 2, dee: 4 });
  assert.equal(blockable(dee), true, "face-up [D] resources are not [V]");
  const opp = urchinBoard({ vol: 0, oppVol: 3 });
  assert.equal(blockable(opp), true, "the opponent's [V] does not count");
});

clause(URCHIN, "0:rule@vvv", "without an item controlled by an opponent it can be blocked (no item, own item, or only a non-item)", () => {
  assert.equal(blockable(urchinBoard({ foeItem: false })), true, "no items");
  assert.equal(blockable(urchinBoard({ foeItem: false, myItem: true })), true, "only my own item");
  assert.equal(blockable(urchinBoard({ foeItem: false, foeLoc: true })), true, "an opposing location is not an item");
  assert.equal(blockable(urchinBoard({ foeItem: false, lent: true })), true, "an opponent-owned item that I control");
});

clause(URCHIN, "0:rule@vvv", "'controls' not 'owns': an item I own but the opponent controls counts", () => {
  const g = urchinBoard({ foeItem: false, stolen: true });
  assert.ok(g.engine.getKeywords(g.id("tu")).includes("cannotBeBlocked"), "g.engine.getKeywords(g.id(\"tu\")).includes(\"cannotBeBlocked\")");
  assert.equal(blockable(g), false);
});

clause(URCHIN, "0:rule@vvv", "it is only while: when the opposing item leaves play it can be blocked again", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "tu", def: printing(URCHIN), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 0, life: 5, speed: 1 }), owner: P2, zone: "play" },
      { key: "fi", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      {
        key: "smash",
        def: item({ name: "SmashI", behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }),
        owner: P1,
        zone: "play"
      },
      ...volition(3, P1)
    ]
  });
  assert.ok(g.engine.getKeywords(g.id("tu")).includes("cannotBeBlocked"), "g.engine.getKeywords(g.id(\"tu\")).includes(\"cannotBeBlocked\")");
  activate(g.engine, P1, g.id("smash"), "s", { selected: { t: [g.id("fi")] } });
  assert.equal(zoneOf(g.engine, g.id("fi")), "discard");
  assert.ok(!g.engine.getKeywords(g.id("tu")).includes("cannotBeBlocked"), "!g.engine.getKeywords(g.id(\"tu\")).includes(\"cannotBeBlocked\")");
  assert.equal(blockable(g), true);
});

clause(URCHIN, "0:rule@vvv", "a depleted opposing item still counts, and the threshold is lost when a [V] source leaves", () => {
  const g = urchinBoard();
  g.engine.state.cards[g.id("fi")].depleted = true;
  assert.ok(g.engine.getKeywords(g.id("tu")).includes("cannotBeBlocked"), "g.engine.getKeywords(g.id(\"tu\")).includes(\"cannotBeBlocked\")");
  const vols = g.engine.state.players[P1].play.filter(c => g.engine.state.cards[c].faceDown);
  g.engine.state.cards[vols[0]].zone = "discard";
  g.engine.state.players[P1].play = g.engine.state.players[P1].play.filter(c => c !== vols[0]);
  g.engine.state.players[P1].discard.push(vols[0]);
  assert.ok(!g.engine.getKeywords(g.id("tu")).includes("cannotBeBlocked"), "only two [V] left");
});

clause(URCHIN, "0:rule@vvv", "only the Urchin is unblockable: an ordinary attacker beside it can still be blocked", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "tu", def: printing(URCHIN), owner: P1, zone: "play" },
      { key: "buddy", def: character({ name: "Buddy", strength: 1, life: 5, speed: 1 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 0, life: 5, speed: 1 }), owner: P2, zone: "play" },
      { key: "fi", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      ...volition(3, P1)
    ]
  });
  assert.ok(!g.engine.getKeywords(g.id("buddy")).includes("cannotBeBlocked"), "!g.engine.getKeywords(g.id(\"buddy\")).includes(\"cannotBeBlocked\")");
  declareAttackBy(g.engine, P1, [g.id("buddy")]);
  declareBlockers(g.engine, P2, [g.id("blk")]);
  assert.ok(g.engine.state.battle, "g.engine.state.battle");
});

clause(DART, "0:rule", "an effect-put [V] card: declining the pick changes nothing, the loss lasts only this turn, and any character (own too) can be picked but not an item", () => {
  const dec = dartBoard();
  activate(dec.engine, P1, dec.id("mover"), "m", { selected: { t: [dec.id("resV")] } });
  assert.equal(answerPicks(dec, null), 1);
  assert.equal(life(dec, "foe"), 4);
  assert.equal(life(dec, "mine"), 3);
  const g = dartBoard();
  activate(g.engine, P1, g.id("mover"), "m", { selected: { t: [g.id("resV")] } });
  answerPicks(g, "mine");
  assert.equal(life(g, "mine"), 2);
  assert.equal(life(g, "foe"), 4);
  endTurn(g.engine, P1);
  assert.equal(life(g, "mine"), 3, "restored at end of turn");
  const bad = dartBoard();
  activate(bad.engine, P1, bad.id("mover"), "m", { selected: { t: [bad.id("resV")] } });
  refused(
    () => bad.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { c: [bad.id("it")] } } } as never),
    "an item is not a character"
  );
});

clause(DART, "0:rule", "an opponent putting their own [V] card into play by an effect does not trigger it", () => {
  const g = dartBoard({ active: P2 });
  activate(g.engine, P2, g.id("mover2"), "m", { selected: { t: [g.id("foeV")] } });
  assert.equal(zoneOf(g.engine, g.id("foeV")), "play");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(life(g, "foe"), 4);
  assert.equal(life(g, "mine"), 3);
});

clause(DART, "0:rule", "deploying it costs 4 and needs [D], with printed stats 3/3/1", () => {
  const ok = dartBoard({ dee: 4 });
  const before = readyResources(ok.engine, P1);
  play(ok.engine, P1, ok.id("dart2"));
  assert.equal(zoneOf(ok.engine, ok.id("dart2")), "play");
  assert.equal(before - readyResources(ok.engine, P1), 4);
  assert.equal(ok.engine.getStat(ok.id("dart2"), "strength"), 3);
  assert.equal(ok.engine.getStat(ok.id("dart2"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("dart2"), "life"), 1);
  const short = dartBoard({ dee: 3 });
  refused(() => play(short.engine, P1, short.id("dart2")), "3 resources for cost 4");
  assert.equal(zoneOf(short.engine, short.id("dart2")), "hand");
});

clause(DART, "0:rule", "deploying it needs a [D]: four non-[D] resources are not enough", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "d", def: printing(DART), owner: P1, zone: "hand" }, ...bank("rage", 4, P1)]
  });
  refused(() => play(g.engine, P1, g.id("d")), "no [D]");
  const h = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "d", def: printing(DART), owner: P1, zone: "hand" }, ...bank("deception", 1, P1), ...bank("rage", 3, P1)]
  });
  play(h.engine, P1, h.id("d"));
  assert.equal(zoneOf(h.engine, h.id("d")), "play", "one [D] plus three others");
});

clause(URCHIN, "0:rule@vvv", "deploying it costs 2 and needs [D], with printed stats 2/3/2", () => {
  const mk = (res: ReturnType<typeof bank>) =>
    buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "u", def: printing(URCHIN), owner: P1, zone: "hand" }, ...res] });
  const ok = mk(bank("deception", 3, P1));
  play(ok.engine, P1, ok.id("u"));
  assert.equal(zoneOf(ok.engine, ok.id("u")), "play");
  assert.equal(readyResources(ok.engine, P1), 1, "paid 2");
  assert.equal(ok.engine.getStat(ok.id("u"), "strength"), 2);
  assert.equal(ok.engine.getStat(ok.id("u"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("u"), "life"), 2);
  const short = mk(bank("deception", 1, P1));
  refused(() => play(short.engine, P1, short.id("u")), "1 resource for cost 2");
  const rage = mk(bank("rage", 3, P1));
  refused(() => play(rage.engine, P1, rage.id("u")), "no [D]");
});
