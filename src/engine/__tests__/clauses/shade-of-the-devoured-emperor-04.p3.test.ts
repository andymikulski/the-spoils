// Clause tests — batch shade-of-the-devoured-emperor-04, part p3 (groups 12-16, missing clauses only).
// Expectations come from each card's PRINTED text and RULES.md / the CR; engine data is only used to drive the engine.

import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import {
  buildGame,
  activate,
  autoResolveBattle,
  bank,
  character,
  developFaction,
  item,
  killTactic,
  location,
  play,
  resourceCard,
  tactic,
  P1,
  P2,
  resolvePendingResponses
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { declareAttackBy, declareAttackOpenWindow, finishBattle, fightThrough } from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { clause, clauseMismatch, declineAll, drain, printing, refused, flipUpNow, holdResourceFace } from "./_clause.js";
import { attachedCount, developResource, endTurn } from "./_turn.js";

type Ids = (key: string) => CardInstanceId;

/** Two-player board with the generic Develop-capable factions. */
function duo(cards: CardPlacement[], opts: { turn?: number; active?: PlayerId; random?: () => number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    activePlayerId: opts.active ?? P1,
    random: opts.random,
    cards
  });
}

const influence = (engine: SpoilsEngine, player: PlayerId): number => engine.state.players[player].influence;
const damageOn = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId].damage;
const handOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].hand];
const deckOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].deck];
const sorted = (ids: CardInstanceId[]): CardInstanceId[] => [...ids].sort();
const chr = (name: string, over: Partial<CardDefinition> = {}): CardDefinition => character({ name, strength: 2, life: 5, speed: 2, ...over });
const elitismCard = (name = "Elitism"): CardDefinition => resourceCard({ name, resource: { provides: ["elitism"], staple: true } });

/** Answers the open `chooserSelectsTarget` choice as `player` WITHOUT draining (so an illegal answer throws). */
function pickAs(engine: SpoilsEngine, player: PlayerId, selected: CardInstanceId[]): void {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsTarget", selected } } as never);
}

/** The FLIP UP action for a face-down card of `player`. */
function flipUp(engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId): void {
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected: {} });
  resolvePendingResponses(engine);
}

// =====================================================================================
// Rocket Lawnchair — item, gearsmith, cost 4, threshold [E][E]
// TACTICAL -- NO EJECT! -- COST: Pick a character you own. Pick a character your opponent controls. Destroy this card.
// EFFECT: Destroy the characters. If either character was a member of an opponent's attacking party, destroy all
// characters in that party. -- FLIP UP: 4 [E][E]
// =====================================================================================

const LAWN = "1dd0bbbc-1202-41c2-9073-5ce87acaf67e";
const NOEJECT = "rocket-lawnchair-no-eject";

function lawnBoard(opts: { active?: PlayerId; lawn?: "play" | "hand" | "faceDown"; elitism?: number; cards?: CardPlacement[] } = {}) {
  const zone = opts.lawn === "hand" ? "hand" : "play";
  return duo(
    [
      { key: "lc", def: printing(LAWN), owner: P1, zone, faceDown: opts.lawn === "faceDown" },
      ...bank("elitism", opts.elitism ?? 0, P1),
      ...(opts.cards ?? [])
    ],
    { active: opts.active }
  );
}

/** The standard "four characters" table: P1 owns m1/m2, P2 owns f1/f2, all in play. */
const fourChars = (): CardPlacement[] => [
  { key: "m1", def: chr("Mine1"), owner: P1, zone: "play" },
  { key: "m2", def: chr("Mine2"), owner: P1, zone: "play" },
  { key: "f1", def: chr("Foe1"), owner: P2, zone: "play" },
  { key: "f2", def: chr("Foe2"), owner: P2, zone: "play" }
];

const noEject = (engine: SpoilsEngine, id: Ids, mine: string, theirs: string): void =>
  activate(engine, P1, id("lc"), NOEJECT, { selected: { mine: [id(mine)], theirs: [id(theirs)] } });

// --- TACTICAL ---------------------------------------------------------------------

clause(LAWN, "0:kw:TACTICAL", "the card has the TACTICAL keyword (a plain item does not)", () => {
  const { engine, id } = duo([
    { key: "lc", def: printing(LAWN), owner: P1, zone: "play" },
    { key: "plain", def: item({ name: "Plain" }), owner: P1, zone: "play" }
  ]);
  assert.ok(engine.getKeywords(id("lc")).includes("tactical"), "engine.getKeywords(id(\"lc\")).includes(\"tactical\")");
  assert.equal(engine.getKeywords(id("plain")).includes("tactical"), false, "control: an ordinary item is not tactical");
});

clause(LAWN, "0:kw:TACTICAL", "it can be deployed from hand whenever a tactic could be (the opponent's attack window), paying its printed cost 4", () => {
  const { engine, id } = lawnBoard({
    active: P2,
    lawn: "hand",
    elitism: 5,
    cards: [{ key: "atk", def: chr("Atk"), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  const before = readyResources(engine, P1);
  play(engine, P1, id("lc"));
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("lc")), "play", "deployed on the opponent's turn");
  assert.equal(before - readyResources(engine, P1), 4, "cost 4 paid");
});

clause(LAWN, "0:kw:TACTICAL", "an ordinary item cannot be deployed in that same window (only the TACTICAL card can)", () => {
  const { engine, id } = lawnBoard({
    active: P2,
    lawn: "hand",
    elitism: 5,
    cards: [
      { key: "atk", def: chr("Atk"), owner: P2, zone: "play" },
      { key: "plain", def: item({ name: "Plain", cost: 1 }), owner: P1, zone: "hand" }
    ]
  });
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  refused(() => play(engine, P1, id("plain")), "a non-tactical item can't be deployed on the opponent's turn");
  assert.equal(zoneOf(engine, id("plain")), "hand");
  play(engine, P1, id("lc"));
  assert.equal(zoneOf(engine, id("lc")), "play", "control: the TACTICAL item can");
});

clause(LAWN, "0:kw:TACTICAL", "TACTICAL changes the timing only: the cost 4 and the [E][E] threshold are still required", () => {
  const attack = (cards: CardPlacement[]) => {
    const b = lawnBoard({ active: P2, lawn: "hand", cards: [{ key: "atk", def: chr("Atk"), owner: P2, zone: "play" }, ...cards] });
    declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
    return b;
  };
  const short = attack(bank("elitism", 3, P1));
  refused(() => play(short.engine, P1, short.id("lc")), "one short of cost 4");
  assert.equal(zoneOf(short.engine, short.id("lc")), "hand");
  const wrongIcons = attack(bank("rage", 5, P1));
  refused(() => play(wrongIcons.engine, P1, wrongIcons.id("lc")), "cost covered but no [E][E]", /threshold/i);
  assert.equal(zoneOf(wrongIcons.engine, wrongIcons.id("lc")), "hand");
  const ok = attack(bank("elitism", 4, P1));
  play(ok.engine, P1, ok.id("lc"));
  assert.equal(zoneOf(ok.engine, ok.id("lc")), "play", "control: exactly cost 4 with [E][E]");
});

clause(LAWN, "0:kw:TACTICAL", "TACTICAL is active while the card is a face-down resource: it can be flipped up in the opponent's window", () => {
  const { engine, id } = lawnBoard({
    active: P2,
    lawn: "faceDown",
    elitism: 5,
    cards: [{ key: "atk", def: chr("Atk"), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  flipUp(engine, P1, id("lc"));
  assert.equal(engine.state.cards[id("lc")].faceDown, false);
  assert.equal(zoneOf(engine, id("lc")), "play");
});

// --- NO EJECT! ----------------------------------------------------------------------

clause(LAWN, "1:ability:rocket-lawnchair-no-eject", "COST + EFFECT: the picked characters and the Lawnchair itself are destroyed; other characters stay", () => {
  const { engine, id } = lawnBoard({ cards: fourChars() });
  noEject(engine, id, "m1", "f1");
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("lc")), "discard", "COST: destroy this card");
  assert.equal(zoneOf(engine, id("m1")), "discard", "the character I picked");
  assert.equal(zoneOf(engine, id("f1")), "discard", "the character my opponent controls that I picked");
  assert.equal(zoneOf(engine, id("m2")), "play", "my other character is untouched");
  assert.equal(zoneOf(engine, id("f2")), "play", "their other character is untouched");
});

clause(LAWN, "1:ability:rocket-lawnchair-no-eject", "the destroyed characters go to their OWNERS' discard piles", () => {
  const { engine, id } = lawnBoard({ cards: fourChars() });
  noEject(engine, id, "m2", "f2");
  assert.deepEqual(sorted(engine.state.players[P1].discard), sorted([id("lc"), id("m2")]));
  assert.deepEqual(engine.state.players[P2].discard, [id("f2")]);
});

clause(LAWN, "1:ability:rocket-lawnchair-no-eject", "'a character you own': my own characters only (not the opponent's, an item of mine, or a card outside play)", () => {
  const { engine, id } = lawnBoard({
    cards: [
      ...fourChars(),
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "myHand", def: chr("MyHand"), owner: P1, zone: "hand" },
      { key: "myDisc", def: chr("MyDisc"), owner: P1, zone: "discard" }
    ]
  });
  const act = (mine: string) => activate(engine, P1, id("lc"), NOEJECT, { selected: { mine: [id(mine)], theirs: [id("f1")] } });
  refused(() => act("f2"), "an opponent's character is not 'a character you own'");
  refused(() => act("myItem"), "an item is not a character");
  refused(() => act("myHand"), "a character in hand is not in play");
  refused(() => act("myDisc"), "a character in the discard pile is not in play");
  assert.equal(zoneOf(engine, id("lc")), "play", "nothing was paid by the refusals");
  act("m2");
  assert.equal(zoneOf(engine, id("m2")), "discard", "control: my own character is accepted");
});

clause(LAWN, "1:ability:rocket-lawnchair-no-eject", "'a character your opponent controls': their characters only (not mine, their item, or a card outside play)", () => {
  const { engine, id } = lawnBoard({
    cards: [
      ...fourChars(),
      { key: "foeItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      { key: "foeHand", def: chr("FoeHand"), owner: P2, zone: "hand" },
      { key: "foeDisc", def: chr("FoeDisc"), owner: P2, zone: "discard" }
    ]
  });
  const act = (theirs: string) => activate(engine, P1, id("lc"), NOEJECT, { selected: { mine: [id("m1")], theirs: [id(theirs)] } });
  refused(() => act("m2"), "my own character is not one my opponent controls");
  refused(() => act("foeItem"), "an item is not a character");
  refused(() => act("foeHand"), "a character in their hand is not in play");
  refused(() => act("foeDisc"), "a character in their discard pile is not in play");
  assert.equal(zoneOf(engine, id("lc")), "play", "nothing was paid by the refusals");
  act("f2");
  assert.equal(zoneOf(engine, id("f2")), "discard", "control: their character is accepted");
});

clause(LAWN, "1:ability:rocket-lawnchair-no-eject", "OWN vs CONTROL: a character I own but the opponent controls counts as 'you own' and as 'your opponent controls'", () => {
  const stolen = (): CardPlacement => ({ key: "stolen", def: chr("Stolen"), owner: P1, zone: "play", controller: P2 });
  const asMine = lawnBoard({ cards: [stolen(), ...fourChars()] });
  noEject(asMine.engine, asMine.id, "stolen", "f1");
  assert.equal(zoneOf(asMine.engine, asMine.id("stolen")), "discard", "picked as the character I OWN");
  assert.equal(zoneOf(asMine.engine, asMine.id("f1")), "discard");
  const asTheirs = lawnBoard({ cards: [stolen(), ...fourChars()] });
  noEject(asTheirs.engine, asTheirs.id, "m1", "stolen");
  assert.equal(zoneOf(asTheirs.engine, asTheirs.id("stolen")), "discard", "picked as the character my opponent CONTROLS");
  assert.equal(zoneOf(asTheirs.engine, asTheirs.id("m1")), "discard");
});

clause(LAWN, "1:ability:rocket-lawnchair-no-eject", "OWN vs CONTROL: a character I control but do not own is neither 'a character you own' nor one 'your opponent controls'", () => {
  const { engine, id } = lawnBoard({ cards: [{ key: "borrowed", def: chr("Borrowed"), owner: P2, zone: "play", controller: P1 }, ...fourChars()] });
  refused(() => noEject(engine, id, "borrowed", "f1"), "I control it but do not own it");
  refused(() => noEject(engine, id, "m1", "borrowed"), "my opponent does not control it");
  assert.equal(zoneOf(engine, id("lc")), "play");
  noEject(engine, id, "m1", "f1");
  assert.equal(zoneOf(engine, id("f1")), "discard", "control");
});

clause(LAWN, "1:ability:rocket-lawnchair-no-eject", "both picks are required, and with no character of mine (or theirs) in play it can't be used (nothing is paid)", () => {
  const both = lawnBoard({ cards: fourChars() });
  refused(() => activate(both.engine, P1, both.id("lc"), NOEJECT, { selected: { mine: [both.id("m1")] } }), "no opponent character picked");
  refused(() => activate(both.engine, P1, both.id("lc"), NOEJECT, { selected: { theirs: [both.id("f1")] } }), "no own character picked");
  assert.equal(zoneOf(both.engine, both.id("lc")), "play");
  const noMine = lawnBoard({ cards: [{ key: "f1", def: chr("Foe1"), owner: P2, zone: "play" }] });
  refused(() => activate(noMine.engine, P1, noMine.id("lc"), NOEJECT, { selected: { theirs: [noMine.id("f1")] } }), "I own no character");
  assert.equal(zoneOf(noMine.engine, noMine.id("lc")), "play", "the Lawnchair wasn't destroyed as a cost");
  const noTheirs = lawnBoard({ cards: [{ key: "m1", def: chr("Mine1"), owner: P1, zone: "play" }] });
  refused(() => activate(noTheirs.engine, P1, noTheirs.id("lc"), NOEJECT, { selected: { mine: [noTheirs.id("m1")] } }), "the opponent controls no character");
  assert.equal(zoneOf(noTheirs.engine, noTheirs.id("lc")), "play");
  assert.equal(zoneOf(noTheirs.engine, noTheirs.id("m1")), "play");
});

clause(LAWN, "1:ability:rocket-lawnchair-no-eject", "it is used from play only: a Lawnchair in hand has no NO EJECT! ability to use", () => {
  const { engine, id } = lawnBoard({ lawn: "hand", cards: fourChars() });
  refused(() => noEject(engine, id, "m1", "f1"), "the Lawnchair is in hand", /Activated ability not found|not in play|zone/i);
  assert.equal(zoneOf(engine, id("m1")), "play");
  assert.equal(zoneOf(engine, id("f1")), "play");
});

clause(LAWN, "1:ability:rocket-lawnchair-no-eject", "party: if THEIR picked character is in an opponent's attacking party, the whole party is destroyed (and my pick, and the Lawnchair)", () => {
  const { engine, id } = lawnBoard({
    active: P2,
    cards: [
      ...fourChars(),
      { key: "a1", def: chr("Attacker1"), owner: P2, zone: "play" },
      { key: "a2", def: chr("Attacker2"), owner: P2, zone: "play" },
      { key: "a3", def: chr("Attacker3"), owner: P2, zone: "play" }
    ]
  });
  declareAttackOpenWindow(engine, P2, [id("a1"), id("a2")]);
  noEject(engine, id, "m1", "a1");
  assert.equal(zoneOf(engine, id("a1")), "discard", "the picked attacker");
  assert.equal(zoneOf(engine, id("a2")), "discard", "its party mate is destroyed too");
  assert.equal(zoneOf(engine, id("m1")), "discard");
  assert.equal(zoneOf(engine, id("lc")), "discard");
  assert.equal(zoneOf(engine, id("a3")), "play", "a character of theirs that is not in the party");
  assert.equal(zoneOf(engine, id("f1")), "play", "another of their characters not in the party");
  assert.equal(zoneOf(engine, id("m2")), "play", "my other character");
});

clause(LAWN, "1:ability:rocket-lawnchair-no-eject", "party: 'either character': if MY picked character is a member of an opponent's attacking party, that whole party is destroyed", () => {
  const { engine, id } = lawnBoard({
    active: P2,
    cards: [
      ...fourChars(),
      { key: "turned", def: chr("Turned"), owner: P1, zone: "play", controller: P2 },
      { key: "a1", def: chr("Attacker1"), owner: P2, zone: "play" }
    ]
  });
  declareAttackOpenWindow(engine, P2, [id("turned"), id("a1")]);
  noEject(engine, id, "turned", "f1");
  assert.equal(zoneOf(engine, id("turned")), "discard", "my picked character (in their attacking party)");
  assert.equal(zoneOf(engine, id("f1")), "discard", "their picked character");
  assert.equal(zoneOf(engine, id("a1")), "discard", "the rest of the party is destroyed");
  assert.equal(zoneOf(engine, id("f2")), "play");
  assert.equal(zoneOf(engine, id("m1")), "play");
});

clause(LAWN, "1:ability:rocket-lawnchair-no-eject", "party: when neither pick is in the attacking party, the attackers are NOT destroyed", () => {
  const { engine, id } = lawnBoard({
    active: P2,
    cards: [...fourChars(), { key: "a1", def: chr("Attacker1"), owner: P2, zone: "play" }, { key: "a2", def: chr("Attacker2"), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(engine, P2, [id("a1"), id("a2")]);
  noEject(engine, id, "m1", "f1");
  assert.equal(zoneOf(engine, id("m1")), "discard");
  assert.equal(zoneOf(engine, id("f1")), "discard");
  assert.equal(zoneOf(engine, id("a1")), "play", "attacker untouched");
  assert.equal(zoneOf(engine, id("a2")), "play", "attacker untouched");
});

clause(LAWN, "1:ability:rocket-lawnchair-no-eject", "party: outside any battle only the two picked characters are destroyed", () => {
  const { engine, id } = lawnBoard({ cards: [...fourChars(), { key: "f3", def: chr("Foe3"), owner: P2, zone: "play" }] });
  noEject(engine, id, "m1", "f1");
  assert.deepEqual(
    ["m1", "f1", "m2", "f2", "f3"].map((key) => zoneOf(engine, id(key))),
    ["discard", "discard", "play", "play", "play"]
  );
});

clause(LAWN, "1:ability:rocket-lawnchair-no-eject", "party: 'an OPPONENT'S attacking party' — my OWN attacking party is not one: only the two picks die", () => {
  const { engine, id } = lawnBoard({
    cards: [...fourChars(), { key: "m3", def: chr("Mine3"), owner: P1, zone: "play" }]
  });
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("m1"), id("m3")], target: { type: "faction", playerId: P2 } });
  noEject(engine, id, "m1", "f1");
  assert.equal(zoneOf(engine, id("m1")), "discard", "my picked attacker");
  assert.equal(zoneOf(engine, id("f1")), "discard");
  assert.equal(zoneOf(engine, id("m3")), "play", "my own party mate is NOT part of an opponent's attacking party");
});

clause(LAWN, "1:ability:rocket-lawnchair-no-eject", "party: a blocker of theirs is not in an attacking party: only the two picks die", () => {
  const { engine, id } = lawnBoard({ active: P1, cards: [...fourChars(), { key: "m3", def: chr("Mine3"), owner: P1, zone: "play" }] });
  declareAttackBy(engine, P1, [id("m1"), id("m3")]);
  declareBlockers(engine, P2, [id("f1")]);
  assert.ok(engine.state.battle, "the battle is still open (blockers declared)");
  noEject(engine, id, "m2", "f1");
  assert.equal(zoneOf(engine, id("f1")), "discard");
  assert.equal(zoneOf(engine, id("m2")), "discard");
  assert.equal(zoneOf(engine, id("m1")), "play", "my attackers are untouched");
  assert.equal(zoneOf(engine, id("m3")), "play", "my attackers are untouched");
  assert.equal(zoneOf(engine, id("f2")), "play");
});

// --- FLIP UP: 4 [E][E] ---------------------------------------------------------------

clause(LAWN, "2:flipUp", "a face-down Lawnchair flips up for exactly 4 resources (with [E][E]) and becomes a face-up item in play", () => {
  const { engine, id } = lawnBoard({ lawn: "faceDown", elitism: 5 });
  assert.equal(attachedCount(engine, P1), 0);
  flipUp(engine, P1, id("lc"));
  assert.equal(engine.state.cards[id("lc")].faceDown, false);
  assert.equal(zoneOf(engine, id("lc")), "play");
  assert.equal(engine.getDefinition(id("lc")).type, "item");
  assert.equal(attachedCount(engine, P1), 4, "exactly the FLIP UP cost 4 was paid");
  assert.equal(engine.state.cards[id("lc")].depleted, false);
});

clause(LAWN, "2:flipUp", "FLIP UP is refused when one resource short of 4 (and nothing is paid)", () => {
  const { engine, id } = lawnBoard({ lawn: "faceDown", elitism: 2 });
  refused(() => flipUp(engine, P1, id("lc")), "2 elitism + its own face-down Volition = 3 < 4");
  assert.equal(engine.state.cards[id("lc")].faceDown, true);
  assert.equal(attachedCount(engine, P1), 0);
});

clause(LAWN, "2:flipUp", "FLIP UP needs [E][E]: four resources without two Elitism icons are refused, two Elitism are enough", () => {
  const one = lawnBoard({ lawn: "faceDown", cards: [...bank("elitism", 1, P1), ...bank("rage", 5, P1)] });
  refused(() => flipUp(one.engine, P1, one.id("lc")), "only one [E] icon", /threshold/i);
  assert.equal(one.engine.state.cards[one.id("lc")].faceDown, true);
  assert.equal(attachedCount(one.engine, P1), 0);
  const two = lawnBoard({ lawn: "faceDown", cards: [...bank("elitism", 2, P1), ...bank("rage", 3, P1)] });
  flipUp(two.engine, P1, two.id("lc"));
  assert.equal(two.engine.state.cards[two.id("lc")].faceDown, false, "control: [E][E] met");
  assert.equal(attachedCount(two.engine, P1), 4);
});

clause(LAWN, "2:flipUp", "only a face-down card can be flipped up: a face-up Lawnchair in play is refused", () => {
  const { engine, id } = lawnBoard({ lawn: "play", elitism: 5 });
  refused(() => flipUp(engine, P1, id("lc")), "already face-up");
  assert.equal(attachedCount(engine, P1), 0);
});

clause(LAWN, "2:flipUp", "FLIP UP of this TACTICAL card is allowed in the opponent's window, with its cost 4 and [E][E] still required there", () => {
  const prep = (elitism: number) => {
    const b = lawnBoard({ active: P2, lawn: "faceDown", elitism, cards: [{ key: "atk", def: chr("Atk"), owner: P2, zone: "play" }] });
    declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
    return b;
  };
  const short = prep(2);
  refused(() => flipUp(short.engine, P1, short.id("lc")), "too few resources, even in a window");
  assert.equal(short.engine.state.cards[short.id("lc")].faceDown, true);
  const ok = prep(5);
  flipUp(ok.engine, P1, ok.id("lc"));
  assert.equal(ok.engine.state.cards[ok.id("lc")].faceDown, false);
  assert.equal(attachedCount(ok.engine, P1), 4);
});

clause(LAWN, "2:flipUp",
  "control: the same card WITHOUT the TACTICAL keyword (a plain item) can not be flipped up in the opponent's window (CR 507.4d)",
  () => {
    const base = printing(LAWN);
    const plainLawn: CardDefinition = { ...base, id: "plain-lawnchair-copy", behavior: { ...base.behavior, keywords: [] } };
    const { engine, id } = duo(
      [
        { key: "lc", def: plainLawn, owner: P1, zone: "play", faceDown: true },
        ...bank("elitism", 5, P1),
        { key: "atk", def: chr("Atk"), owner: P2, zone: "play" }
      ],
      { active: P2 }
    );
    declareAttackOpenWindow(engine, P2, [id("atk")]);
    refused(() => flipUp(engine, P1, id("lc")), "a non-tactic item can't be flipped up in the opponent's response window");
    assert.equal(engine.state.cards[id("lc")].faceDown, true);
    assert.equal(attachedCount(engine, P1), 0);
  }
);

clause(LAWN, "2:flipUp", "a flipped-up Lawnchair is a working item: NO EJECT! can then be used", () => {
  const { engine, id } = lawnBoard({ lawn: "faceDown", elitism: 5, cards: fourChars() });
  flipUp(engine, P1, id("lc"));
  noEject(engine, id, "m1", "f1");
  assert.equal(zoneOf(engine, id("lc")), "discard");
  assert.equal(zoneOf(engine, id("f1")), "discard");
});

// =====================================================================================
// Runic Junker — item, gearsmith, cost 2, threshold [E][E][E]
// At start of your turn you may pay 4. If you do and you control at least 2 face-down resources, pick an opponent.
// That player must pick a face-down resource you control. If the face-down resource is a character or an item
// you may play it for free. (You still need to meet its threshold and satisfy its extra costs.)
// =====================================================================================

const JUNKER = "12b25597-1514-4fc3-9a33-3b32fc436ecb";

const hiddenChar = (over: Partial<CardDefinition> = {}): CardDefinition => character({ name: "Hidden Char", cost: 3, threshold: "ee", strength: 2, life: 2, speed: 1, ...over });
const hiddenItem = (over: Partial<CardDefinition> = {}): CardDefinition => item({ name: "Hidden Item", cost: 2, ...over });
const down = (key: string, def: CardDefinition, owner: PlayerId = P1): CardPlacement => ({ key, def, owner, zone: "play", faceDown: true });

/**
 * A Junker whose controller `me` has `elitism` face-up Elitism resources plus the `hidden` face-down cards. The
 * board is built on the OPPONENT's turn and that turn is ended, so `me`'s start-of-turn trigger has just fired.
 */
function junkerBoard(opts: { me?: PlayerId; elitism?: number; hidden?: CardPlacement[]; extra?: CardPlacement[]; startTurn?: boolean } = {}) {
  const me = opts.me ?? P1;
  const foe = me === P1 ? P2 : P1;
  const b = duo(
    [
      { key: "jk", def: printing(JUNKER), owner: me, zone: "play" },
      ...bank("elitism", opts.elitism ?? 6, me),
      ...(opts.hidden ?? []),
      ...(opts.extra ?? [])
    ],
    { active: foe }
  );
  if (opts.startTurn !== false) endTurn(b.engine, foe);
  return b;
}

/** Pays 4 and lets the opponent pick `pickKey`. */
function junkerPay(b: ReturnType<typeof junkerBoard>, pickKey: string, picker: PlayerId = P2): void {
  answerPending(b.engine, "mayPay", { pay: true });
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the opponent is asked to pick");
  assert.equal(pending(b.engine)?.playerId, picker);
  pickAs(b.engine, picker, [b.id(pickKey)]);
  resolvePendingResponses(b.engine);
}

clause(JUNKER, "0:rule", "at the start of YOUR turn you are asked whether to pay 4; declining pays nothing and nothing else happens", () => {
  const b = junkerBoard({ hidden: [down("h1", hiddenChar()), down("h2", hiddenItem())] });
  assert.equal(b.engine.state.activePlayerId, P1);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "mayPay", "a may-pay choice");
  assert.equal(pc?.playerId, P1, "asked of the Junker's controller");
  const ready = readyResources(b.engine, P1);
  answerPending(b.engine, "mayPay", { pay: false });
  assert.equal(pending(b.engine), undefined, "declining ends it: the opponent is not asked to pick");
  assert.equal(readyResources(b.engine, P1), ready, "nothing paid");
  assert.equal(b.engine.state.cards[b.id("h1")].faceDown, true);
  assert.equal(b.engine.state.cards[b.id("h2")].faceDown, true);
});

clause(JUNKER, "0:rule", "accepting pays exactly 4 resources and then the OPPONENT is asked to pick", () => {
  const b = junkerBoard({ hidden: [down("h1", hiddenChar()), down("h2", hiddenItem())] });
  const ready = readyResources(b.engine, P1);
  answerPending(b.engine, "mayPay", { pay: true });
  assert.equal(ready - readyResources(b.engine, P1), 4, "paid 4");
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P2, "the opponent picks");
});

clause(JUNKER, "0:rule", "the opponent MUST pick, and only a face-down resource the Junker's controller controls (not a face-up one, nor their own)", () => {
  const b = junkerBoard({
    hidden: [down("h1", hiddenChar()), down("h2", hiddenItem())],
    extra: [down("theirs", hiddenChar({ name: "Theirs" }), P2), ...bank("rage", 1, P2)]
  });
  answerPending(b.engine, "mayPay", { pay: true });
  const faceUp = [...b.engine.state.players[P1].play].find((cardId) => b.engine.isResource(cardId) && !b.engine.state.cards[cardId].faceDown)!;
  refused(() => pickAs(b.engine, P2, []), "the pick is mandatory");
  refused(() => pickAs(b.engine, P2, [faceUp]), "a face-up resource isn't a face-down resource");
  refused(() => pickAs(b.engine, P2, [b.id("theirs")]), "the opponent's own face-down resource isn't one the controller controls");
  refused(() => pickAs(b.engine, P2, [b.id("h1"), b.id("h2")]), "exactly one is picked");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  pickAs(b.engine, P2, [b.id("h2")]);
  assert.ok(b.engine.state.cards[b.id("theirs")].faceDown, "their own card untouched");
});

clause(JUNKER, "0:rule", "'if you control at least 2 face-down resources': with only ONE face-down resource the 4 is paid but nobody picks", () => {
  const b = junkerBoard({ hidden: [down("h1", hiddenChar())] });
  const ready = readyResources(b.engine, P1);
  answerPending(b.engine, "mayPay", { pay: true });
  assert.equal(ready - readyResources(b.engine, P1), 4, "the 4 is still paid");
  assert.equal(pending(b.engine), undefined, "no pick with fewer than 2 face-down resources");
  assert.equal(b.engine.state.cards[b.id("h1")].faceDown, true);
  assert.equal(zoneOf(b.engine, b.id("h1")), "play");
});

clause(JUNKER, "0:rule", "'at least 2' includes exactly 2 (and counts only face-down cards, not 5 face-up resources)", () => {
  const none = junkerBoard({ elitism: 6 });
  answerPending(none.engine, "mayPay", { pay: true });
  assert.equal(pending(none.engine), undefined, "6 face-up resources are not face-down resources");
  const two = junkerBoard({ elitism: 6, hidden: [down("h1", hiddenChar()), down("h2", hiddenChar({ name: "Other" }))] });
  answerPending(two.engine, "mayPay", { pay: true });
  assert.equal(pending(two.engine)?.kind, "chooserSelectsTarget", "exactly 2 is enough");
});

clause(JUNKER, "0:rule", "the cost is a real pay-4: with fewer than 4 resources it can't be paid, nothing is picked, nothing is deployed", () => {
  const b = junkerBoard({ elitism: 1, hidden: [down("h1", hiddenChar({ threshold: 0 })), down("h2", hiddenItem())] });
  const ready = readyResources(b.engine, P1);
  assert.equal(ready, 3);
  const pc = pending(b.engine);
  if (pc) refused(() => answerPending(b.engine, "mayPay", { pay: true }), "3 resources can't pay 4");
  drain(b.engine, declineAll);
  assert.equal(readyResources(b.engine, P1), ready, "nothing spent");
  assert.equal(pending(b.engine), undefined);
  assert.equal(b.engine.state.cards[b.id("h1")].faceDown, true);
  assert.equal(b.engine.state.cards[b.id("h2")].faceDown, true);
});

clause(JUNKER, "0:rule", "it only works at the start of ITS CONTROLLER's turn: nothing happens at the start of the opponent's turn", () => {
  const b = duo([
    { key: "jk", def: printing(JUNKER), owner: P1, zone: "play" },
    ...bank("elitism", 6, P1),
    down("h1", hiddenChar()),
    down("h2", hiddenItem())
  ]);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(pending(b.engine), undefined, "no choice for anyone at the opponent's turn start");
  assert.equal(b.engine.state.cards[b.id("h1")].faceDown, true);
});

clause(JUNKER, "0:rule", "'your turn' is the controller's turn: a Junker the opponent controls asks THEM, and I am the one who picks", () => {
  const b = junkerBoard({ me: P2, hidden: [down("h1", hiddenChar(), P2), down("h2", hiddenItem(), P2)] });
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(pending(b.engine)?.kind, "mayPay");
  assert.equal(pending(b.engine)?.playerId, P2, "asked of the controller");
  answerPending(b.engine, "mayPay", { pay: true });
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(b.engine)?.playerId, P1, "the other player picks");
});

clause(JUNKER, "0:rule", "it only works in play: a Junker in hand does nothing at the start of my turn", () => {
  const b = duo(
    [
      { key: "jk", def: printing(JUNKER), owner: P1, zone: "hand" },
      ...bank("elitism", 6, P1),
      down("h1", hiddenChar()),
      down("h2", hiddenItem())
    ],
    { active: P2 }
  );
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(pending(b.engine), undefined);
});

clause(JUNKER, "0:rule", "a face-down TACTIC, LOCATION or real RESOURCE that is picked is not a character or an item: it is not played", () => {
  const tries: Array<[string, CardDefinition]> = [
    ["tactic", tactic({ name: "Hidden Tactic", cost: 0 })],
    ["location", location({ name: "Hidden Location", cost: 1 })],
    ["resource", resourceCard({ name: "Hidden Resource" })]
  ];
  for (const [label, def] of tries) {
    const b = junkerBoard({ hidden: [down("t", def), down("h2", hiddenItem())] });
    const before = readyResources(b.engine, P1);
    junkerPay(b, "t");
    assert.equal(pending(b.engine), undefined, `${label}: nothing is offered for play`);
    assert.equal(b.engine.state.cards[b.id("t")].faceDown, true, `${label}: stays face-down`);
    assert.equal(zoneOf(b.engine, b.id("t")), "play");
    assert.equal(before - readyResources(b.engine, P1), 4, `${label}: only the 4 was paid`);
  }
});

clause(JUNKER, "0:rule",
  "the picked face-down CHARACTER is played for free (offered to the Junker's controller, who accepts)",
  () => {
    const b = junkerBoard({ hidden: [down("h1", hiddenChar()), down("h2", hiddenItem())] });
    answerPending(b.engine, "mayPay", { pay: true });
    pickAs(b.engine, P2, [b.id("h1")]);
    const pc = pending(b.engine);
    assert.equal(pc?.kind, "deployForFree", "the controller may play it for free");
    assert.equal(pc?.playerId, P1);
    answerPending(b.engine, "deployForFree", { cardId: b.id("h1") });
    assert.equal(pending(b.engine), undefined);
    assert.equal(zoneOf(b.engine, b.id("h1")), "play");
    assert.equal(b.engine.state.cards[b.id("h1")].faceDown, false, "flipped up and played");
    assert.equal(b.engine.getDefinition(b.id("h1")).type, "character");
    assert.equal(attachedCount(b.engine, P1), 4, "free: only the 4 for the Junker's own cost was paid");
  }
);

clause(JUNKER, "0:rule",
  "the picked face-down ITEM is played for free",
  () => {
    const b = junkerBoard({ hidden: [down("h1", hiddenChar()), down("h2", hiddenItem())] });
    answerPending(b.engine, "mayPay", { pay: true });
    pickAs(b.engine, P2, [b.id("h2")]);
    assert.equal(pending(b.engine)?.kind, "deployForFree");
    answerPending(b.engine, "deployForFree", { cardId: b.id("h2") });
    assert.equal(zoneOf(b.engine, b.id("h2")), "play");
    assert.equal(b.engine.state.cards[b.id("h2")].faceDown, false);
    assert.equal(b.engine.getDefinition(b.id("h2")).type, "item");
    assert.equal(attachedCount(b.engine, P1), 4, "free: only the 4 for the Junker's own cost was paid");
  }
);

clause(JUNKER, "0:rule",
  "'you MAY play it': the controller can decline, and the card then stays a face-down resource",
  () => {
    const b = junkerBoard({ hidden: [down("h1", hiddenChar()), down("h2", hiddenItem())] });
    answerPending(b.engine, "mayPay", { pay: true });
    pickAs(b.engine, P2, [b.id("h1")]);
    assert.equal(pending(b.engine)?.kind, "deployForFree", "the controller is offered the play");
    answerPending(b.engine, "deployForFree", {});
    assert.equal(pending(b.engine), undefined);
    assert.equal(zoneOf(b.engine, b.id("h1")), "play");
    assert.equal(b.engine.state.cards[b.id("h1")].faceDown, true, "declined: still face-down");
  }
);

clause(JUNKER, "0:rule",
  "'you still need to meet its threshold': a played character whose threshold I lack stays face-down; one I meet is played",
  () => {
    const rage = (): CardDefinition => hiddenChar({ name: "Needs Rage", threshold: "rrr" });
    const lacking = junkerBoard({ hidden: [down("h1", rage()), down("h2", hiddenItem())] });
    answerPending(lacking.engine, "mayPay", { pay: true });
    pickAs(lacking.engine, P2, [lacking.id("h1")]);
    // E10e: accepting the play without the threshold is refused (as for every other 'play it' card); the player then declines.
    assert.equal(pending(lacking.engine)?.kind, "deployForFree");
    refused(() => answerPending(lacking.engine, "deployForFree", { cardId: lacking.id("h1") }), "no [R][R][R]", /threshold/i);
    answerPending(lacking.engine, "deployForFree", {});
    assert.equal(pending(lacking.engine), undefined);
    assert.equal(lacking.engine.state.cards[lacking.id("h1")].faceDown, true, "no [R][R][R]: not played");
    assert.equal(zoneOf(lacking.engine, lacking.id("h1")), "play");
    const meets = junkerBoard({ hidden: [down("h1", rage()), down("h2", hiddenItem())], extra: bank("rage", 3, P1) });
    answerPending(meets.engine, "mayPay", { pay: true });
    pickAs(meets.engine, P2, [meets.id("h1")]);
    assert.equal(pending(meets.engine)?.kind, "deployForFree");
    answerPending(meets.engine, "deployForFree", { cardId: meets.id("h1") });
    assert.equal(meets.engine.state.cards[meets.id("h1")].faceDown, false, "control: [R][R][R] met, played");
  }
);

clause(JUNKER, "0:rule",
  "'you still need to satisfy its extra costs': a played character with an extra cost of 2 influence still pays it",
  () => {
    const taxed = hiddenChar({ name: "Taxed", behavior: { onPlay: { costs: [{ type: "loseInfluence", amount: 2 }] } } });
    const b = junkerBoard({ hidden: [down("h1", taxed), down("h2", hiddenItem())] });
    const before = influence(b.engine, P1);
    answerPending(b.engine, "mayPay", { pay: true });
    pickAs(b.engine, P2, [b.id("h1")]);
    assert.equal(pending(b.engine)?.kind, "deployForFree");
    answerPending(b.engine, "deployForFree", { cardId: b.id("h1") });
    assert.equal(zoneOf(b.engine, b.id("h1")), "play");
    assert.equal(b.engine.state.cards[b.id("h1")].faceDown, false);
    assert.equal(before - influence(b.engine, P1), 2, "the extra cost (lose 2 influence) was paid");
  }
);

// =====================================================================================
// Runic Map — item, gearsmith, cost 2, threshold [E][E]
// This card enters play with 2 tokens on it. If there are no tokens on this card destroy it.
// PLAN -- COST: Pay 1. Remove a token from this card. EFFECT: Search your deck for a card named "Elitism" and reveal it. Put it into your hand.
// FOLLOW PLAN -- COST: Pay 2. Remove a token from this card. EFFECT: You may play a resource.
// NEW PLAN -- COST: Destroy a face-down resource you control. EFFECT: Add a token to this card.
// =====================================================================================

const MAP = "ba4a554e-4fbb-42b4-8e63-3f5f200104e5";

function mapBoard(opts: { tokens?: number; zone?: "play" | "hand"; res?: number; cards?: CardPlacement[]; active?: PlayerId; random?: () => number } = {}) {
  return duo(
    [
      { key: "map", def: printing(MAP), owner: P1, zone: opts.zone ?? "play", counters: opts.tokens ? { token: opts.tokens } : undefined },
      ...bank("elitism", opts.res ?? 4, P1),
      ...(opts.cards ?? [])
    ],
    { active: opts.active, random: opts.random }
  );
}

const planDeck = (): CardPlacement[] => [
  { key: "x1", def: character({ name: "Other 1" }), owner: P1, zone: "deck" },
  { key: "el1", def: elitismCard(), owner: P1, zone: "deck" },
  { key: "x2", def: resourceCard({ name: "Rage" }), owner: P1, zone: "deck" },
  { key: "el2", def: elitismCard(), owner: P1, zone: "deck" },
  { key: "x3", def: character({ name: "Elitism Mk II" }), owner: P1, zone: "deck" },
  { key: "el3", def: elitismCard(), owner: P1, zone: "deck" }
];

// --- rule: tokens ----------------------------------------------------------------------

clause(MAP, "0:rule", "it enters play with exactly 2 tokens on it (deployed from hand for its cost 2 and [E][E])", () => {
  const { engine, id } = mapBoard({ zone: "hand", res: 4 });
  assert.equal(tokensOn(engine, id("map")), 0, "no tokens while in hand");
  const before = readyResources(engine, P1);
  play(engine, P1, id("map"));
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("map")), "play");
  assert.equal(tokensOn(engine, id("map")), 2);
  assert.equal(before - readyResources(engine, P1), 2, "cost 2 paid");
});

clause(MAP, "0:rule", "vanilla deploy: refused one short of cost 2 and without [E][E]", () => {
  // two spent [E] satisfy the threshold but cannot pay, so only the cost can refuse
  const spentE = (): CardPlacement[] => bank("elitism", 2, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }));
  const short = mapBoard({ zone: "hand", res: 1, cards: spentE() });
  refused(() => play(short.engine, P1, short.id("map")), "one resource short of cost 2 ([E][E] threshold met by spent icons)", /Costs cannot be paid/i);
  assert.equal(zoneOf(short.engine, short.id("map")), "hand");
  const exact = mapBoard({ zone: "hand", res: 2, cards: spentE() });
  play(exact.engine, P1, exact.id("map"));
  assert.equal(zoneOf(exact.engine, exact.id("map")), "play", "control: two ready resources pay the cost");
  const wrong = mapBoard({ zone: "hand", res: 0, cards: bank("rage", 4, P1) });
  refused(() => play(wrong.engine, P1, wrong.id("map")), "no [E][E]", /threshold/i);
  assert.equal(zoneOf(wrong.engine, wrong.id("map")), "hand");
});

clause(MAP, "0:rule", "while it has tokens it stays in play: using PLAN once leaves it there with 1 token", () => {
  const { engine, id } = mapBoard({ tokens: 2, cards: planDeck() });
  activate(engine, P1, id("map"), "rm-plan", { selected: { e: [id("el1")] } });
  assert.equal(zoneOf(engine, id("map")), "play");
  assert.equal(tokensOn(engine, id("map")), 1);
});

clause(MAP, "0:rule", "'if there are no tokens on this card destroy it': removing the LAST token (by PLAN) destroys it; the PLAN effect still happens", () => {
  const { engine, id } = mapBoard({ tokens: 1, cards: planDeck() });
  activate(engine, P1, id("map"), "rm-plan", { selected: { e: [id("el2")] } });
  assert.equal(pending(engine), undefined);
  assert.equal(tokensOn(engine, id("map")), 0);
  assert.equal(zoneOf(engine, id("map")), "discard", "no tokens: destroyed");
  assert.deepEqual(handOf(engine, P1), [id("el2")], "the ability still resolved");
});

clause(MAP, "0:rule", "removing the last token by an effect that is not its own ability also destroys it", () => {
  const remover = tactic({
    name: "Token Thief",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "thief",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }],
          effects: [{ type: "removeCounter", target: { type: "selected", id: "t" }, counter: "token", amount: 1 }]
        }
      ]
    }
  });
  const two = mapBoard({ tokens: 2, active: P2, cards: [{ key: "thief", def: remover, owner: P2, zone: "hand" }, { key: "thief2", def: remover, owner: P2, zone: "hand" }] });
  play(two.engine, P2, two.id("thief"), { selected: { t: [two.id("map")] } });
  assert.equal(tokensOn(two.engine, two.id("map")), 1);
  assert.equal(zoneOf(two.engine, two.id("map")), "play", "1 token left: stays");
  play(two.engine, P2, two.id("thief2"), { selected: { t: [two.id("map")] } });
  assert.equal(tokensOn(two.engine, two.id("map")), 0);
  assert.equal(zoneOf(two.engine, two.id("map")), "discard", "0 tokens: destroyed");
});

// --- PLAN ------------------------------------------------------------------------------

clause(MAP, "1:ability:rm-plan", "COST: pay 1 resource and remove one token; EFFECT: the chosen 'Elitism' goes from the deck to my hand", () => {
  const { engine, id } = mapBoard({ tokens: 2, cards: planDeck(), random: () => 0 });
  const ready = readyResources(engine, P1);
  activate(engine, P1, id("map"), "rm-plan", { selected: { e: [id("el2")] } });
  assert.equal(pending(engine), undefined);
  assert.equal(ready - readyResources(engine, P1), 1, "paid exactly 1");
  assert.equal(tokensOn(engine, id("map")), 1, "removed exactly one token");
  assert.deepEqual(handOf(engine, P1), [id("el2")], "exactly the Elitism I chose is in my hand");
  assert.deepEqual(sorted(deckOf(engine, P1)), sorted(["x1", "el1", "x2", "x3", "el3"].map(id)), "the rest of the deck is intact");
});

clause(MAP, "1:ability:rm-plan", "the searched card is REVEALED (to everyone) before it goes to my hand", () => {
  const { engine, id } = mapBoard({ tokens: 2, cards: planDeck() });
  activate(engine, P1, id("map"), "rm-plan", { selected: { e: [id("el3")] } });
  const reveals = engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
  assert.equal(reveals.length, 1, "one reveal");
  const ev = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual(ev.cardIds, [id("el3")]);
  assert.equal(ev.viewerId, "all");
});

clause(MAP, "1:ability:rm-plan", "the deck is shuffled after the search (CR 312.1), found or not", () => {
  const found = mapBoard({ tokens: 2, cards: planDeck(), random: () => 0 });
  const rest = deckOf(found.engine, P1).filter((cardId) => cardId !== found.id("el2"));
  activate(found.engine, P1, found.id("map"), "rm-plan", { selected: { e: [found.id("el2")] } });
  assert.deepEqual(sorted(deckOf(found.engine, P1)), sorted(rest));
  assert.notDeepEqual(deckOf(found.engine, P1), rest, "found: the deck order changed (shuffled)");
  const none = mapBoard({
    tokens: 2,
    random: () => 0,
    cards: ["a", "b", "c", "d"].map((k): CardPlacement => ({ key: k, def: character({ name: `Filler ${k}` }), owner: P1, zone: "deck" }))
  });
  const before = deckOf(none.engine, P1);
  activate(none.engine, P1, none.id("map"), "rm-plan", { selected: {} });
  assert.deepEqual(sorted(deckOf(none.engine, P1)), sorted(before));
  assert.notDeepEqual(deckOf(none.engine, P1), before, "no Elitism: the deck is still shuffled");
});

clause(MAP, "1:ability:rm-plan", "only a card NAMED 'Elitism' can be chosen (not other resources, a similar name, or non-deck copies)", () => {
  const { engine, id } = mapBoard({
    tokens: 2,
    cards: [
      ...planDeck(),
      { key: "elHand", def: elitismCard(), owner: P1, zone: "hand" },
      { key: "elDisc", def: elitismCard(), owner: P1, zone: "discard" }
    ]
  });
  const act = (key: string) => activate(engine, P1, id("map"), "rm-plan", { selected: { e: [id(key)] } });
  refused(() => act("x2"), "a Rage resource is not named Elitism");
  refused(() => act("x3"), "'Elitism Mk II' is not named Elitism");
  refused(() => act("x1"), "a character is not named Elitism");
  refused(() => act("elHand"), "an Elitism in hand is not in the deck");
  refused(() => act("elDisc"), "an Elitism in the discard pile is not in the deck");
  assert.equal(tokensOn(engine, id("map")), 2, "refusals paid nothing");
  act("el1");
  assert.ok(handOf(engine, P1).includes(id("el1")), "control: a deck Elitism works");
});

clause(MAP, "1:ability:rm-plan", "'your deck': the OPPONENT's Elitism cannot be taken", () => {
  const { engine, id } = mapBoard({
    tokens: 2,
    cards: [...planDeck(), { key: "oppEl", def: elitismCard(), owner: P2, zone: "deck" }]
  });
  refused(() => activate(engine, P1, id("map"), "rm-plan", { selected: { e: [id("oppEl")] } }), "that Elitism is in the opponent's deck");
  assert.equal(zoneOf(engine, id("oppEl")), "deck");
  assert.equal(tokensOn(engine, id("map")), 2, "nothing was paid");
  activate(engine, P1, id("map"), "rm-plan", { selected: { e: [id("el1")] } });
  assert.deepEqual(handOf(engine, P1), [id("el1")], "control: my own works");
});

clause(MAP, "1:ability:rm-plan", "'a card': only ONE Elitism is taken even if several are in the deck", () => {
  const { engine, id } = mapBoard({ tokens: 2, cards: planDeck() });
  refused(
    () => activate(engine, P1, id("map"), "rm-plan", { selected: { e: [id("el1"), id("el2")] } }),
    "two cards chosen for 'a card'"
  );
  assert.equal(handOf(engine, P1).length, 0);
  assert.equal(tokensOn(engine, id("map")), 2);
  activate(engine, P1, id("map"), "rm-plan", { selected: { e: [id("el1")] } });
  assert.equal(handOf(engine, P1).length, 1);
});

clause(MAP, "1:ability:rm-plan", "with no Elitism in the deck the search finds nothing, but the cost (1 resource + 1 token) is still paid", () => {
  const { engine, id } = mapBoard({
    tokens: 2,
    cards: ["a", "b", "c"].map((k): CardPlacement => ({ key: k, def: character({ name: `Filler ${k}` }), owner: P1, zone: "deck" }))
  });
  const ready = readyResources(engine, P1);
  activate(engine, P1, id("map"), "rm-plan", { selected: {} });
  assert.equal(pending(engine), undefined);
  assert.equal(ready - readyResources(engine, P1), 1);
  assert.equal(tokensOn(engine, id("map")), 1);
  assert.equal(handOf(engine, P1).length, 0);
  assert.equal(deckOf(engine, P1).length, 3);
});

clause(MAP, "1:ability:rm-plan", "PLAN needs 1 resource to pay and a token to remove: refused with neither, with nothing paid", () => {
  const broke = mapBoard({ tokens: 2, res: 0, cards: planDeck() });
  refused(() => activate(broke.engine, P1, broke.id("map"), "rm-plan", { selected: { e: [broke.id("el1")] } }), "no resource to pay with");
  assert.equal(tokensOn(broke.engine, broke.id("map")), 2, "the token wasn't removed either");
  assert.equal(handOf(broke.engine, P1).length, 0);
  const tokenless = mapBoard({ cards: planDeck() });
  refused(() => activate(tokenless.engine, P1, tokenless.id("map"), "rm-plan", { selected: { e: [tokenless.id("el1")] } }), "no token to remove");
  assert.equal(readyResources(tokenless.engine, P1), 4, "no resource was spent");
  assert.equal(handOf(tokenless.engine, P1).length, 0);
});

// --- FOLLOW PLAN -------------------------------------------------------------------------

clause(MAP, "2:ability:rm-follow", "COST: pay 2 and remove a token; EFFECT: I may play a resource from hand (a real resource card ends up in play)", () => {
  const { engine, id } = mapBoard({ tokens: 2, cards: [{ key: "elHand", def: elitismCard(), owner: P1, zone: "hand" }] });
  const ready = readyResources(engine, P1);
  activate(engine, P1, id("map"), "rm-follow");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "I choose the resource to play");
  assert.equal(pending(engine)?.playerId, P1);
  assert.equal(tokensOn(engine, id("map")), 1, "token removed as a cost");
  assert.equal(ready - readyResources(engine, P1), 2, "paid exactly 2");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("elHand")] });
  drain(engine, (pc) => (pc.kind === "playResource" ? { kind: "playResource", faceDown: false } : declineAll(pc)));
  assert.equal(zoneOf(engine, id("elHand")), "play", "the resource was played");
  assert.equal(pending(engine), undefined);
});

clause(MAP, "2:ability:rm-follow", "'you MAY play a resource': declining plays nothing, but the cost stays paid", () => {
  const { engine, id } = mapBoard({ tokens: 2, cards: [{ key: "elHand", def: elitismCard(), owner: P1, zone: "hand" }] });
  const ready = readyResources(engine, P1);
  activate(engine, P1, id("map"), "rm-follow");
  answerPending(engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("elHand")), "hand", "declined: still in hand");
  assert.equal(ready - readyResources(engine, P1), 2, "cost stays paid");
  assert.equal(tokensOn(engine, id("map")), 1);
});

clause(MAP, "2:ability:rm-follow", "the resource comes from MY hand: not the deck, the discard pile or the opponent's hand", () => {
  const { engine, id } = mapBoard({
    tokens: 2,
    cards: [
      { key: "mine", def: elitismCard("Hand Elitism"), owner: P1, zone: "hand" },
      { key: "deckEl", def: elitismCard("Deck Elitism"), owner: P1, zone: "deck" },
      { key: "discEl", def: elitismCard("Disc Elitism"), owner: P1, zone: "discard" },
      { key: "oppHand", def: elitismCard("Opp Elitism"), owner: P2, zone: "hand" }
    ]
  });
  activate(engine, P1, id("map"), "rm-follow");
  for (const key of ["deckEl", "discEl", "oppHand"]) {
    refused(() => pickAs(engine, P1, [id(key)]), `${key} is not in my hand`);
  }
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("mine")] });
  drain(engine, (pc) => (pc.kind === "playResource" ? { kind: "playResource", faceDown: false } : declineAll(pc)));
  assert.equal(zoneOf(engine, id("mine")), "play");
  assert.equal(zoneOf(engine, id("deckEl")), "deck");
  assert.equal(zoneOf(engine, id("discEl")), "discard");
  assert.equal(zoneOf(engine, id("oppHand")), "hand");
});

clause(MAP, "2:ability:rm-follow", "CR 203.2: any card can be played as a (face-down) resource, e.g. a character from hand", () => {
  const { engine, id } = mapBoard({ tokens: 2, cards: [{ key: "ch", def: chr("Hand Char"), owner: P1, zone: "hand" }] });
  activate(engine, P1, id("map"), "rm-follow");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("ch")] });
  drain(engine, (pc) => (pc.kind === "playResource" ? { kind: "playResource", faceDown: true } : declineAll(pc)));
  assert.equal(zoneOf(engine, id("ch")), "play");
  assert.equal(engine.state.cards[id("ch")].faceDown, true, "a non-resource card can only be played face-down");
});

clause(MAP, "2:ability:rm-follow", "CR 203.2: a real resource card may be played face-down OR face-up, at my choice", () => holdResourceFace(() => {
  const play1 = (faceDown: boolean) => {
    const { engine, id } = mapBoard({ tokens: 2, cards: [{ key: "elHand", def: elitismCard(), owner: P1, zone: "hand" }] });
    activate(engine, P1, id("map"), "rm-follow");
    answerPending(engine, "chooserSelectsTarget", { selected: [id("elHand")] });
    const sawChoice = pending(engine) !== undefined;
    drain(engine, (pc) => (pc.kind === "playResource" ? { kind: "playResource", faceDown } : declineAll(pc)));
    return { zone: zoneOf(engine, id("elHand")), faceDown: engine.state.cards[id("elHand")].faceDown, sawChoice };
  };
  const up = play1(false);
  const dn = play1(true);
  assert.equal(up.zone, "play");
  assert.equal(dn.zone, "play");
  assert.equal(up.faceDown, false, "face-up when I choose face-up");
  assert.equal(dn.faceDown, true, "face-down when I choose face-down");
}));

clause(MAP, "2:ability:rm-follow", "FOLLOW PLAN needs 2 resources and a token: refused with 1 resource or with no token, nothing paid", () => {
  const poor = mapBoard({ tokens: 2, res: 1, cards: [{ key: "elHand", def: elitismCard(), owner: P1, zone: "hand" }] });
  refused(() => activate(poor.engine, P1, poor.id("map"), "rm-follow"), "one resource short of 2");
  assert.equal(tokensOn(poor.engine, poor.id("map")), 2);
  const tokenless = mapBoard({ res: 4, cards: [{ key: "elHand", def: elitismCard(), owner: P1, zone: "hand" }] });
  refused(() => activate(tokenless.engine, P1, tokenless.id("map"), "rm-follow"), "no token to remove");
  assert.equal(readyResources(tokenless.engine, P1), 4);
});

clause(MAP, "2:ability:rm-follow", "'play a resource' is an extra play, separate from the Develop rule (CR 203.1): usable after I developed this turn", () => {
  const { engine, id } = mapBoard({
    tokens: 2,
    cards: [
      { key: "devEl", def: elitismCard("Develop Elitism"), owner: P1, zone: "hand" },
      { key: "planEl", def: elitismCard("Plan Elitism"), owner: P1, zone: "hand" }
    ]
  });
  developResource(engine, P1, id("devEl"), false);
  assert.equal(zoneOf(engine, id("devEl")), "play", "setup: my Develop was used to play a resource");
  activate(engine, P1, id("map"), "rm-follow");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("planEl")] });
  drain(engine, (pc) => (pc.kind === "playResource" ? { kind: "playResource", faceDown: false } : declineAll(pc)));
  assert.equal(zoneOf(engine, id("planEl")), "play", "FOLLOW PLAN played a second resource the same turn");
  assert.equal(tokensOn(engine, id("map")), 1);
});

clause(MAP, "2:ability:rm-follow", "'play a resource' via FOLLOW PLAN does not use up my Develop: I can still develop afterwards", () => {
  const { engine, id } = mapBoard({
    tokens: 2,
    cards: [
      { key: "planEl", def: elitismCard("Plan Elitism"), owner: P1, zone: "hand" },
      { key: "devEl", def: elitismCard("Develop Elitism"), owner: P1, zone: "hand" }
    ]
  });
  activate(engine, P1, id("map"), "rm-follow");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("planEl")] });
  drain(engine, (pc) => (pc.kind === "playResource" ? { kind: "playResource", faceDown: false } : declineAll(pc)));
  assert.equal(zoneOf(engine, id("planEl")), "play");
  developResource(engine, P1, id("devEl"), false);
  assert.equal(zoneOf(engine, id("devEl")), "play", "my Develop was still available");
});

clause(MAP, "2:ability:rm-follow", "removing the last token as a cost destroys the Map, but the ability still resolves (the resource is played)", () => {
  const { engine, id } = mapBoard({ tokens: 1, cards: [{ key: "elHand", def: elitismCard(), owner: P1, zone: "hand" }] });
  activate(engine, P1, id("map"), "rm-follow");
  drain(engine, (pc) => {
    if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [id("elHand")] };
    if (pc.kind === "playResource") return { kind: "playResource", faceDown: false };
    return declineAll(pc);
  });
  assert.equal(zoneOf(engine, id("map")), "discard", "no tokens left: destroyed");
  assert.equal(zoneOf(engine, id("elHand")), "play", "the ability still resolved");
});

// --- NEW PLAN ------------------------------------------------------------------------------

clause(MAP, "3:ability:rm-new", "COST: destroy a face-down resource I control; EFFECT: add a token to the Map", () => {
  const { engine, id } = mapBoard({
    tokens: 1,
    cards: [down("v1", resourceCard({ name: "Hidden 1" })), down("v2", resourceCard({ name: "Hidden 2" }))]
  });
  activate(engine, P1, id("map"), "rm-new", { selected: { fd: [id("v1")] } });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("v1")), "discard", "the face-down resource I chose is destroyed");
  assert.equal(zoneOf(engine, id("v2")), "play", "the other face-down resource is untouched");
  assert.equal(tokensOn(engine, id("map")), 2, "one token added");
});

clause(MAP, "3:ability:rm-new", "NEW PLAN costs no resources: only the destroyed face-down resource goes", () => {
  const { engine, id } = mapBoard({ tokens: 1, res: 3, cards: [down("v1", resourceCard({ name: "Hidden 1" }))] });
  const ready = readyResources(engine, P1);
  activate(engine, P1, id("map"), "rm-new", { selected: { fd: [id("v1")] } });
  assert.equal(ready - readyResources(engine, P1), 1, "just the destroyed face-down resource's Volition");
  assert.equal(attachedCount(engine, P1), 0, "nothing was spent");
});

clause(MAP, "3:ability:rm-new", "the destroyed face-down resource may be any card played face-down (it is a face-down RESOURCE, whatever it is)", () => {
  const { engine, id } = mapBoard({ tokens: 1, cards: [down("v1", chr("Face-down Char"))] });
  activate(engine, P1, id("map"), "rm-new", { selected: { fd: [id("v1")] } });
  assert.equal(zoneOf(engine, id("v1")), "discard");
  assert.equal(tokensOn(engine, id("map")), 2);
});

clause(MAP, "3:ability:rm-new", "'a face-down resource you control': a face-up resource, the opponent's face-down resource and a face-down card in hand are refused", () => {
  const { engine, id } = mapBoard({
    tokens: 1,
    cards: [
      down("v1", resourceCard({ name: "Hidden 1" })),
      down("theirs", resourceCard({ name: "Theirs" }), P2),
      { key: "inHand", def: resourceCard({ name: "InHand" }), owner: P1, zone: "hand" }
    ]
  });
  const faceUp = [...engine.state.players[P1].play].find((cardId) => engine.isResource(cardId) && !engine.state.cards[cardId].faceDown)!;
  refused(() => activate(engine, P1, id("map"), "rm-new", { selected: { fd: [faceUp] } }), "a face-up resource isn't face-down");
  refused(() => activate(engine, P1, id("map"), "rm-new", { selected: { fd: [id("theirs")] } }), "the opponent's face-down resource isn't mine");
  refused(() => activate(engine, P1, id("map"), "rm-new", { selected: { fd: [id("inHand")] } }), "a card in hand isn't a resource I control");
  assert.equal(tokensOn(engine, id("map")), 1, "refusals added nothing");
  assert.equal(zoneOf(engine, faceUp), "play");
  assert.equal(zoneOf(engine, id("theirs")), "play");
  activate(engine, P1, id("map"), "rm-new", { selected: { fd: [id("v1")] } });
  assert.equal(tokensOn(engine, id("map")), 2, "control: my own face-down resource works");
});

clause(MAP, "3:ability:rm-new", "NEW PLAN can't be used without a face-down resource to destroy", () => {
  const { engine, id } = mapBoard({ tokens: 1, res: 4 });
  refused(() => activate(engine, P1, id("map"), "rm-new", {}), "I control no face-down resource");
  assert.equal(tokensOn(engine, id("map")), 1);
});

clause(MAP, "3:ability:rm-new", "adding tokens keeps accumulating: two NEW PLANs add two tokens", () => {
  const { engine, id } = mapBoard({ tokens: 1, cards: [down("v1", resourceCard({ name: "H1" })), down("v2", resourceCard({ name: "H2" }))] });
  activate(engine, P1, id("map"), "rm-new", { selected: { fd: [id("v1")] } });
  activate(engine, P1, id("map"), "rm-new", { selected: { fd: [id("v2")] } });
  assert.equal(tokensOn(engine, id("map")), 3);
});

// =====================================================================================
// Sockem Bot — character, gearsmith, warmachine, cost 6, threshold [E][E][E], 8 / 2 / 6
// PAY OFF -- COST: Any player may use this ability. Pay 1.
// EFFECT: This turn, if damage is inflicted to a character or faction by this card, reduce the amount by 1.
// =====================================================================================

const SOCK = "a981c172-6c40-43d4-b941-0a336e4924fb";
const PAYOFF = "sb-payoff";

function sockBoard(opts: { active?: PlayerId; p1?: number; p2?: number; cards?: CardPlacement[] } = {}) {
  return duo(
    [
      { key: "bot", def: printing(SOCK), owner: P1, zone: "play" },
      ...bank("elitism", opts.p1 ?? 4, P1),
      ...bank("elitism", opts.p2 ?? 0, P2),
      ...(opts.cards ?? [])
    ],
    { active: opts.active }
  );
}

/** P1 uses PAY OFF `uses` times, then Sockem Bot attacks the faction unblocked: returns the influence the opponent lost. */
function lossAfter(uses: number, cards: CardPlacement[] = [], attackers: string[] = ["bot"]): number {
  const { engine, id } = sockBoard({ p1: 10, cards });
  for (let i = 0; i < uses; i += 1) activate(engine, P1, id("bot"), PAYOFF);
  const before = influence(engine, P2);
  fightThrough(engine, P1, attackers.map(id), { type: "faction", playerId: P2 }, []);
  return before - influence(engine, P2);
}

clause(SOCK, "0:ability:sb-payoff", "printed body: 8 strength / 2 speed / 6 life; unreduced, its unblocked hit costs the faction 8", () => {
  const { engine, id } = sockBoard();
  assert.deepEqual([engine.getStat(id("bot"), "strength"), engine.getStat(id("bot"), "speed"), engine.getStat(id("bot"), "life")], [8, 2, 6]);
  assert.equal(lossAfter(0), 8, "baseline without PAY OFF");
});

clause(SOCK, "0:ability:sb-payoff", "vanilla deploy: cost 6 with [E][E][E] (refused one short)", () => {
  const ok = duo([{ key: "bot", def: printing(SOCK), owner: P1, zone: "hand" }, ...bank("elitism", 6, P1)]);
  play(ok.engine, P1, ok.id("bot"));
  assert.equal(zoneOf(ok.engine, ok.id("bot")), "play");
  assert.equal(attachedCount(ok.engine, P1), 6);
  const short = duo([{ key: "bot", def: printing(SOCK), owner: P1, zone: "hand" }, ...bank("elitism", 5, P1)]);
  refused(() => play(short.engine, P1, short.id("bot")), "one short of cost 6");
  const wrong = duo([{ key: "bot", def: printing(SOCK), owner: P1, zone: "hand" }, ...bank("rage", 6, P1)]);
  refused(() => play(wrong.engine, P1, wrong.id("bot")), "no [E][E][E]", /threshold/i);
});

clause(SOCK, "0:ability:sb-payoff", "COST: pay 1 resource; EFFECT: damage inflicted to the FACTION by this card is reduced by 1", () => {
  const { engine, id } = sockBoard({ p1: 4 });
  const ready = readyResources(engine, P1);
  activate(engine, P1, id("bot"), PAYOFF);
  assert.equal(ready - readyResources(engine, P1), 1, "paid exactly 1");
  const before = influence(engine, P2);
  fightThrough(engine, P1, [id("bot")], { type: "faction", playerId: P2 }, []);
  assert.equal(before - influence(engine, P2), 7, "8 - 1");
});

clause(SOCK, "0:ability:sb-payoff", "damage inflicted to a CHARACTER by this card is reduced by 1 too (and the blocker's damage to the Bot is not)", () => {
  const blocker = chr("Wall", { strength: 4, life: 20, speed: 2 });
  const run = (uses: number) => {
    const { engine, id } = sockBoard({ p1: 4, cards: [{ key: "wall", def: blocker, owner: P2, zone: "play" }] });
    for (let i = 0; i < uses; i += 1) activate(engine, P1, id("bot"), PAYOFF);
    fightThrough(engine, P1, [id("bot")], { type: "faction", playerId: P2 }, [id("wall")]);
    return { wall: damageOn(engine, id("wall")), bot: damageOn(engine, id("bot")), inf: influence(engine, P2) };
  };
  const plain = run(0);
  assert.equal(plain.wall, 8, "baseline: 8 damage to the blocker");
  assert.equal(plain.bot, 4);
  const reduced = run(1);
  assert.equal(reduced.wall, 7, "8 - 1 damage to the blocking character");
  assert.equal(reduced.bot, 4, "damage dealt TO the Bot isn't reduced");
  assert.equal(reduced.inf, 30, "the faction was never hit");
});

clause(SOCK, "0:ability:sb-payoff", "each use reduces by 1 more: two uses reduce by 2, three by 3 (uses stack)", () => {
  assert.equal(lossAfter(1), 7);
  assert.equal(lossAfter(2), 6);
  assert.equal(lossAfter(3), 5);
});

clause(SOCK, "0:ability:sb-payoff", "the reduction can't go below 0: reducing by 8 or more leaves the faction untouched", () => {
  assert.equal(lossAfter(7), 1);
  assert.equal(lossAfter(8), 0);
  assert.equal(lossAfter(9), 0, "9 uses reduce 8 damage to 0, not to -1 (no influence is gained)");
});

clause(SOCK, "0:ability:sb-payoff", "'by this card': a partner in the same attack (different speed) is NOT reduced; only Sockem Bot's hit is", () => {
  const partner = chr("Partner", { strength: 3, life: 5, speed: 1 });
  assert.equal(lossAfter(0, [{ key: "pt", def: partner, owner: P1, zone: "play" }], ["bot", "pt"]), 11, "baseline 8 + 3");
  assert.equal(lossAfter(1, [{ key: "pt", def: partner, owner: P1, zone: "play" }], ["bot", "pt"]), 10, "(8 - 1) + 3");
});

clause(SOCK, "0:ability:sb-payoff", "'by this card': a second Sockem Bot of mine is not reduced by the first one's PAY OFF", () => {
  const twin = (): CardPlacement => ({ key: "twin", def: printing(SOCK), owner: P1, zone: "play" });
  assert.equal(lossAfter(0, [twin()], ["bot", "twin"]), 16);
  assert.equal(lossAfter(1, [twin()], ["bot", "twin"]), 15, "only the activated Bot's 8 became 7");
});

clause(SOCK, "0:ability:sb-payoff", "ANY player may use it: the opponent pays 1 of THEIR OWN resources to reduce the Bot's damage", () => {
  const { engine, id } = sockBoard({ p1: 3, p2: 2 });
  const mine = readyResources(engine, P1);
  const theirs = readyResources(engine, P2);
  declareAttackOpenWindow(engine, P1, [id("bot")]);
  activate(engine, P2, id("bot"), PAYOFF);
  assert.equal(theirs - readyResources(engine, P2), 1, "the opponent paid 1");
  assert.equal(readyResources(engine, P1), mine, "I paid nothing");
  const before = influence(engine, P2);
  declareBlockers(engine, P2, []);
  finishBattle(engine);
  assert.equal(before - influence(engine, P2), 7, "reduced by 1 even though the opponent used it");
});

clause(SOCK, "0:ability:sb-payoff", "uses by both players stack: mine on my turn and the opponent's in the window reduce by 2", () => {
  const { engine, id } = sockBoard({ p1: 3, p2: 2 });
  activate(engine, P1, id("bot"), PAYOFF);
  declareAttackOpenWindow(engine, P1, [id("bot")]);
  activate(engine, P2, id("bot"), PAYOFF);
  const before = influence(engine, P2);
  declareBlockers(engine, P2, []);
  finishBattle(engine);
  assert.equal(before - influence(engine, P2), 6);
});

clause(SOCK, "0:ability:sb-payoff", "the opponent can use it on THEIR OWN turn too, reducing the Bot's damage as a blocker", () => {
  const hitter = chr("Hitter", { strength: 1, life: 20, speed: 2 });
  const { engine, id } = sockBoard({ active: P2, p1: 0, p2: 2, cards: [{ key: "hit", def: hitter, owner: P2, zone: "play" }] });
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("hit")], target: { type: "faction", playerId: P1 } });
  activate(engine, P2, id("bot"), PAYOFF);
  resolvePendingResponses(engine);
  declareBlockers(engine, P1, [id("bot")]);
  finishBattle(engine);
  assert.equal(damageOn(engine, id("hit")), 7, "the Bot blocked and dealt 8 - 1");
});

clause(SOCK, "0:ability:sb-payoff", "as a BLOCKER too: my own use during the opponent's attack reduces its damage to their attacker", () => {
  const hitter = chr("Hitter", { strength: 1, life: 20, speed: 2 });
  const { engine, id } = sockBoard({ active: P2, p1: 2, cards: [{ key: "hit", def: hitter, owner: P2, zone: "play" }] });
  declareAttackOpenWindow(engine, P2, [id("hit")]);
  activate(engine, P1, id("bot"), PAYOFF);
  declareBlockers(engine, P1, [id("bot")]);
  finishBattle(engine);
  assert.equal(damageOn(engine, id("hit")), 7);
});

clause(SOCK, "0:ability:sb-payoff", "PAY OFF can't be used without a resource to pay (refused for either player)", () => {
  const { engine, id } = sockBoard({ p1: 0, p2: 0 });
  refused(() => activate(engine, P1, id("bot"), PAYOFF), "I have no resource to pay with");
  declareAttackOpenWindow(engine, P1, [id("bot")]);
  refused(() => activate(engine, P2, id("bot"), PAYOFF), "the opponent has no resource to pay with");
  const funded = sockBoard({ p1: 0, p2: 1 });
  declareAttackOpenWindow(funded.engine, P1, [funded.id("bot")]);
  activate(funded.engine, P2, funded.id("bot"), PAYOFF);
  assert.equal(readyResources(funded.engine, P2), 0, "control: with one resource the opponent can");
});

clause(SOCK, "0:ability:sb-payoff", "'this turn': a reduction bought on my turn is gone on the opponent's turn (the Bot deals full damage again)", () => {
  const hitter = chr("Hitter", { strength: 1, life: 20, speed: 2 });
  const { engine, id } = sockBoard({ p1: 2, cards: [{ key: "hit", def: hitter, owner: P2, zone: "play" }] });
  activate(engine, P1, id("bot"), PAYOFF);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  if (pending(engine)) drain(engine, declineAll);
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("hit")], target: { type: "faction", playerId: P1 } });
  resolvePendingResponses(engine);
  declareBlockers(engine, P1, [id("bot")]);
  finishBattle(engine);
  assert.equal(damageOn(engine, id("hit")), 8, "no reduction any more");
});

clause(SOCK, "0:ability:sb-payoff", "'this turn': the reduction lasts the whole turn it was bought (it applies to a later battle in that turn)", () => {
  const wall = (name: string): CardDefinition => chr(name, { strength: 0, life: 20, speed: 2 });
  const { engine, id } = sockBoard({
    p1: 2,
    cards: [
      { key: "w1", def: wall("Wall1"), owner: P2, zone: "play" },
      { key: "w2", def: wall("Wall2"), owner: P2, zone: "play" },
      { key: "bot2", def: printing(SOCK), owner: P1, zone: "play" }
    ]
  });
  activate(engine, P1, id("bot"), PAYOFF);
  fightThrough(engine, P1, [id("bot")], { type: "faction", playerId: P2 }, [id("w1")]);
  assert.equal(damageOn(engine, id("w1")), 7, "first battle reduced");
  // the Bot is depleted after attacking; attack again with the other copy of the same name is NOT reduced
  fightThrough(engine, P1, [id("bot2")], { type: "faction", playerId: P2 }, [id("w2")]);
  assert.equal(damageOn(engine, id("w2")), 8, "a different Bot copy: unaffected");
});

// =====================================================================================
// Stuttershy — character, gearsmith, horsemajig, cost 1, threshold [E][E], 0 / 3 / 1
// If this card would be destroyed, flip it face-down under its owner's control instead.
// If this card is flipped down, each opponent's faction gains 1 influence and you may put a Micromajig token
// into play under your control for each influence gained this way.
// =====================================================================================

const STUTT = "fd095fbd-7566-4b39-832e-0f40a0181289";

const stuttBoard = (opts: { controller?: PlayerId; extra?: CardPlacement[]; active?: PlayerId } = {}) =>
  duo(
    [
      { key: "st", def: printing(STUTT), owner: P1, zone: "play", controller: opts.controller },
      { key: "kill", def: killTactic(), owner: P2, zone: "hand" },
      ...(opts.extra ?? [])
    ],
    { active: opts.active ?? P2 }
  );

/** "you MAY put a Micromajig token" is an offer (p3-8): by default the controller accepts it (option 1); pass take = false to leave it pending. */
const takeStuttToken = (engine: SpoilsEngine): void => {
  if (pending(engine)?.kind === "chooserSelectsOption") answerPending(engine, "chooserSelectsOption", { index: 1 });
};
const killStutt = (b: ReturnType<typeof stuttBoard>, key = "st", take = true): void => {
  play(b.engine, P2, b.id("kill"), { selected: { t: [b.id(key)] } });
  if (take) takeStuttToken(b.engine);
};
const tokensInPlay = (engine: SpoilsEngine): CardInstanceId[] =>
  Object.values(engine.state.cards)
    .filter((card) => card.isToken && card.zone === "play")
    .map((card) => card.id);

clause(STUTT, "0:rule", "printed body: 0 strength / 3 speed / 1 life, cost 1 with [E][E]", () => {
  const { engine, id } = duo([{ key: "st", def: printing(STUTT), owner: P1, zone: "play" }]);
  assert.deepEqual([engine.getStat(id("st"), "strength"), engine.getStat(id("st"), "speed"), engine.getStat(id("st"), "life")], [0, 3, 1]);
  const dep = duo([{ key: "st", def: printing(STUTT), owner: P1, zone: "hand" }, ...bank("elitism", 1, P1)]);
  refused(() => play(dep.engine, P1, dep.id("st")), "one icon short of [E][E]", /threshold/i);
  const ok = duo([{ key: "st", def: printing(STUTT), owner: P1, zone: "hand" }, ...bank("elitism", 2, P1)]);
  play(ok.engine, P1, ok.id("st"));
  assert.equal(zoneOf(ok.engine, ok.id("st")), "play");
  assert.equal(attachedCount(ok.engine, P1), 1, "cost 1");
});

clause(STUTT, "0:rule", "destroyed by an effect: it is flipped face-down in play instead, NOT put into the discard pile", () => {
  const b = stuttBoard();
  killStutt(b);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("st")), "play", "still in play");
  assert.equal(b.engine.state.cards[b.id("st")].faceDown, true, "flipped face-down");
  assert.equal(b.engine.state.players[P1].discard.includes(b.id("st")), false, "the destruction did not happen");
});

clause(STUTT, "0:rule", "the face-down Stuttershy is a resource of mine now: it provides one more resource", () => {
  const b = stuttBoard({ extra: bank("elitism", 2, P1) });
  const before = readyResources(b.engine, P1);
  killStutt(b);
  assert.equal(readyResources(b.engine, P1) - before, 1, "a face-down card provides Volition (CR 405.5)");
});

clause(STUTT, "0:rule", "destroyed by lethal battle damage (as a blocker): flipped face-down instead of dying", () => {
  const hitter = chr("Hitter", { strength: 3, life: 5, speed: 1 });
  const b = stuttBoard({ extra: [{ key: "hit", def: hitter, owner: P2, zone: "play" }] });
  fightThrough(b.engine, P2, [b.id("hit")], { type: "faction", playerId: P1 }, [b.id("st")], undefined, (pc) =>
    pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 1 } : declineAll(pc)
  );
  assert.equal(zoneOf(b.engine, b.id("st")), "play", "survived the lethal damage by flipping");
  assert.equal(b.engine.state.cards[b.id("st")].faceDown, true);
  assert.equal(b.engine.state.players[P1].discard.includes(b.id("st")), false);
});

clause(STUTT, "0:rule", "destroyed as a COST (a card that destroys it to pay): NOT replaced by the flip (CR 506.2: replacements do not apply to extra costs)", () => {
  const pyre = chr("Pyre", {
    behavior: {
      abilities: [
        {
          id: "burn",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character", name: "Stuttershy" }, count: 1 }],
          costs: [{ type: "destroy", target: { type: "selected", id: "t" } }],
          effects: []
        }
      ]
    }
  });
  const b = stuttBoard({ active: P1, extra: [{ key: "pyre", def: pyre, owner: P1, zone: "play" }] });
  activate(b.engine, P1, b.id("pyre"), "burn", { selected: { t: [b.id("st")] } });
  assert.equal(zoneOf(b.engine, b.id("st")), "discard", "destroyed as part of the extra cost: CR 506.2 says it is not replaced");
  assert.equal(b.engine.state.cards[b.id("st")].faceDown ?? false, false, "not flipped face-down");
});

clause(STUTT, "0:rule", "'under its OWNER's control': a Stuttershy I own but the opponent controls comes back face-down under MY control", () => {
  const b = stuttBoard({ controller: P2 });
  assert.equal(b.engine.state.cards[b.id("st")].controllerId, P2, "setup: they control it");
  killStutt(b);
  const card = b.engine.state.cards[b.id("st")];
  assert.equal(card.zone, "play");
  assert.equal(card.faceDown, true);
  assert.equal(card.ownerId, P1);
  assert.equal(card.controllerId, P1, "under its owner's control");
});

clause(STUTT, "0:rule", "'this card': another character of mine being destroyed is not flipped, and does not trigger anything", () => {
  const b = stuttBoard({ extra: [{ key: "other", def: chr("Bystander"), owner: P1, zone: "play" }] });
  const before = influence(b.engine, P2);
  killStutt(b, "other");
  assert.equal(zoneOf(b.engine, b.id("other")), "discard", "an ordinary character is destroyed normally");
  assert.equal(b.engine.state.cards[b.id("st")].faceDown, false, "Stuttershy itself is untouched");
  assert.equal(influence(b.engine, P2), before, "no influence change");
  assert.deepEqual(tokensInPlay(b.engine), [], "no token");
});

clause(STUTT, "0:rule", "'this card': with two Stuttershies, only the destroyed one flips; the other stays face-up", () => {
  const b = stuttBoard({ extra: [{ key: "st2", def: printing(STUTT), owner: P1, zone: "play" }] });
  killStutt(b, "st2");
  assert.equal(b.engine.state.cards[b.id("st2")].faceDown, true);
  assert.equal(zoneOf(b.engine, b.id("st2")), "play");
  assert.equal(b.engine.state.cards[b.id("st")].faceDown, false, "the other copy is unaffected");
});

clause(STUTT, "0:rule", "an opponent's Stuttershy is not protected by mine: theirs is destroyed normally", () => {
  const b = stuttBoard({ extra: [{ key: "theirs", def: printing(STUTT), owner: P2, zone: "play" }] });
  killStutt(b, "theirs");
  assert.equal(zoneOf(b.engine, b.id("theirs")), "play", "their own Stuttershy flips (its own rule)");
  assert.equal(b.engine.state.cards[b.id("theirs")].faceDown, true);
  assert.equal(b.engine.state.cards[b.id("st")].faceDown, false, "mine is untouched");
});

clause(STUTT, "1:rule", "when flipped down by being destroyed, each opponent's faction gains exactly 1 influence (mine does not)", () => {
  const b = stuttBoard();
  const mine = influence(b.engine, P1);
  const theirs = influence(b.engine, P2);
  killStutt(b);
  assert.equal(influence(b.engine, P2) - theirs, 1, "the opponent's faction gains 1");
  assert.equal(influence(b.engine, P1), mine, "my faction does not");
});

clause(STUTT, "1:rule", "a Micromajig token (a Gearsmith majig character, 1/1/3) enters play under my control", () => {
  const b = stuttBoard();
  killStutt(b);
  const tokens = tokensInPlay(b.engine);
  assert.equal(tokens.length, 1, "one token for the one influence gained");
  const [tok] = tokens;
  const def = b.engine.getDefinition(tok);
  assert.equal(def.name, "Micromajig");
  assert.equal(def.type, "character");
  assert.ok(def.subtype.includes("majig"), "def.subtype.includes(\"majig\")");
  assert.deepEqual([b.engine.getStat(tok, "strength"), b.engine.getStat(tok, "life"), b.engine.getStat(tok, "speed")], [1, 1, 3]);
  assert.equal(b.engine.state.cards[tok].controllerId, P1, "under my control");
});

clause(STUTT, "1:rule", "the Micromajig token is a GEARSMITH character (CR 409.3c)", () => {
  const b = stuttBoard();
  killStutt(b);
  const [tok] = tokensInPlay(b.engine);
  assert.equal(b.engine.getDefinition(tok).trade, "gearsmith");
});

clause(STUTT, "1:rule", "'you' is the Stuttershy's CONTROLLER: for a stolen one the owner's faction gains the influence and the controller gets the token", () => {
  const b = stuttBoard({ controller: P2 });
  const owner = influence(b.engine, P1);
  const controller = influence(b.engine, P2);
  killStutt(b);
  assert.equal(influence(b.engine, P1) - owner, 1, "the controller's opponent (its owner) gains 1");
  assert.equal(influence(b.engine, P2), controller);
  const tokens = tokensInPlay(b.engine);
  assert.equal(tokens.length, 1);
  assert.equal(b.engine.state.cards[tokens[0]].controllerId, P2, "the token comes in under the controller's control");
});

clause(STUTT, "1:rule", "destroyed in battle as a blocker: the influence gain and the token happen too", () => {
  const hitter = chr("Hitter", { strength: 3, life: 5, speed: 1 });
  const b = stuttBoard({ extra: [{ key: "hit", def: hitter, owner: P2, zone: "play" }] });
  const before = influence(b.engine, P2);
  fightThrough(b.engine, P2, [b.id("hit")], { type: "faction", playerId: P1 }, [b.id("st")], undefined, (pc) =>
    pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 1 } : declineAll(pc)
  );
  assert.equal(influence(b.engine, P2) - before, 1);
  assert.equal(tokensInPlay(b.engine).length, 1);
});

clause(STUTT, "1:rule", "'you MAY put a Micromajig token': the controller can decline the token (the influence still happens)", () => {
  const b = stuttBoard();
  const before = influence(b.engine, P2);
  killStutt(b, "st", false);
  // a "may" must be a choice offered to the controller: it can be declined (no token) or accepted (one token)
  const pc = pending(b.engine);
  assert.ok(pc, "the controller is offered the token");
  assert.equal(pc?.playerId, P1);
  drain(b.engine, declineAll);
  assert.deepEqual(tokensInPlay(b.engine), [], "declined: no token");
  assert.equal(influence(b.engine, P2) - before, 1, "the influence is not optional");
  assert.equal(b.engine.state.cards[b.id("st")].faceDown, true);
});

clause(STUTT, "1:rule", "'if this card is flipped down' — ANY flip-down counts, not just the destruction replacement", () => {
  const flipper = tactic({
    name: "Flipper",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "f",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "flipFaceDown", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
  const b = duo(
    [
      { key: "st", def: printing(STUTT), owner: P1, zone: "play" },
      { key: "flip", def: flipper, owner: P2, zone: "hand" }
    ],
    { active: P2 }
  );
  const before = influence(b.engine, P2);
  play(b.engine, P2, b.id("flip"), { selected: { t: [b.id("st")] } });
  assert.equal(b.engine.state.cards[b.id("st")].faceDown, true, "setup: it was flipped down by the effect");
  assert.equal(influence(b.engine, P2) - before, 1, "the opponent's faction gains 1");
  drain(b.engine, (pc) => (pc.kind === "mayPay" ? { kind: "mayPay", pay: true } : { kind: pc.kind, index: 1 }));
  assert.equal(tokensInPlay(b.engine).length, 1, "and a Micromajig can be put into play");
});
