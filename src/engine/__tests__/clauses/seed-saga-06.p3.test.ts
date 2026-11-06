// Clause tests, batch seed-saga-06, part p3 (groups 8-11, missing clauses only).
// Essence of Elitism, G14n7 5p0rk D3f3n53, Golemizer, Jocular Stupefaction.
import assert from "node:assert/strict";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import { buildGame, activate, resolvePendingResponses, character, developFaction, item, play, tactic, P1, P2 } from "../per-card/_harness.js";
import { bank } from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, printing, refused, flipUpNow } from "./_clause.js";
import { answerPending, declareBlockers, fillers, pending, readyResources, zoneOf } from "./_board.js";
import { declareAttackBy, declareAttackOpenWindow, fightThrough, playRaw } from "./_battle.js";
import { endTurn } from "./_turn.js";

const ESS = "cd2a4bf7-f5d1-4636-b4e2-13ace594b525"; // tactic gearsmith cost 1 "ee" -- choose one: micromajig token / covert char loses COVERT this turn / item from my discard to hand
const GSD = "df65552d-5534-4c91-bc2a-4bfe232c5a01"; // item gearsmith cost 3 "ee" -- TACTICAL; IMPALE destroy self + attacking character; FLIP UP 1 [E][E]
const GOL = "70614755-e530-4e56-be6c-35db100dff6d"; // item gearsmith gear cost 1 "e" -- ATTACH TO CHARACTER; -1 speed per token; end of my turn may add token, 0 speed destroys; destroy replacement; FLIP UP 4 [E][E][E]
const JOC = "ed496918-5b67-476d-ac00-362ac5be1e20"; // tactic gearsmith cost 3 "e" -- pick a COVERT character, destroy it; FLIP UP 3 [E]

const spent = (placements: CardPlacement[], owner: PlayerId): CardPlacement[] =>
  placements.map((p) => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));
const E = (n: number, owner: PlayerId = P1, isSpent = false): CardPlacement[] => {
  const placements = bank("elitism", n, owner);
  return isSpent ? spent(placements, owner) : placements;
};
const R = (n: number, owner: PlayerId = P1, isSpent = false): CardPlacement[] => {
  const placements = bank("rage", n, owner);
  return isSpent ? spent(placements, owner) : placements;
};
const ready = (engine: SpoilsEngine, player: PlayerId): number => readyResources(engine, player);

/** P1 active on turn 3 by default; `active: P2` is the opponent's turn 4. */
function mk(cards: CardPlacement[], o: { turn?: number; active?: PlayerId } = {}) {
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn ?? (active === P1 ? 3 : 4),
    activePlayerId: active,
    random: () => 0.5,
    cards: [...fillers("d", 3, P1, "deck"), ...fillers("f", 3, P2, "deck"), ...cards]
  });
}

const rawFlipUp = (engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}): void =>
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });

const COVERT = { behavior: { keywords: ["covert"] } as never };
const kw = (engine: SpoilsEngine, cardId: CardInstanceId): string[] => (engine.getKeywords(cardId) as unknown as string[]).map((k) => String(k).toLowerCase());
const tokensOf = (engine: SpoilsEngine, controller: PlayerId): CardInstanceId[] =>
  Object.keys(engine.state.cards).filter((cardId) => {
    const card = engine.state.cards[cardId];
    return card.zone === "play" && card.controllerId === controller && engine.getDefinition(cardId).name === "Micromajig";
  });

// ============================== Essence of Elitism ==============================
const essBoard = (o: { resources?: CardPlacement[]; extra?: CardPlacement[]; active?: PlayerId } = {}) =>
  mk(
    [
      { key: "ess", def: printing(ESS), owner: P1, zone: "hand" },
      ...(o.resources ?? [...E(2, P1, true), ...R(2)]),
      ...(o.extra ?? [])
    ],
    { active: o.active }
  );
const covChars: CardPlacement[] = [
  { key: "cov", def: character({ name: "Sneak", ...COVERT }), owner: P1, zone: "play" },
  { key: "cov2", def: character({ name: "Sneak Two", ...COVERT }), owner: P1, zone: "play" },
  { key: "covFoe", def: character({ name: "Foe Sneak", ...COVERT }), owner: P2, zone: "play" },
  { key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "play" },
  { key: "plainFoe", def: character({ name: "Plain Foe" }), owner: P2, zone: "play" },
  { key: "covHand", def: character({ name: "Hand Sneak", ...COVERT }), owner: P1, zone: "hand" },
  { key: "covDisc", def: character({ name: "Dead Sneak", ...COVERT }), owner: P1, zone: "discard" }
];
const itemCards: CardPlacement[] = [
  { key: "itemMine", def: item({ name: "Mine Item" }), owner: P1, zone: "discard" },
  { key: "itemMine2", def: item({ name: "Mine Item Two" }), owner: P1, zone: "discard" },
  { key: "itemFoe", def: item({ name: "Foe Item" }), owner: P2, zone: "discard" },
  { key: "itemPlay", def: item({ name: "Board Item" }), owner: P1, zone: "play" },
  { key: "itemHand", def: item({ name: "Hand Item" }), owner: P1, zone: "hand" },
  { key: "itemDeck", def: item({ name: "Deck Item" }), owner: P1, zone: "deck" },
  { key: "charDisc", def: character({ name: "Dead Char" }), owner: P1, zone: "discard" }
];

clause(ESS, "0:rule", "printed cost 1 / threshold [E][E] gearsmith tactic: deploys with two spent [E] and one ready, refused with nothing ready, one [E] short, or no [E]", () => {
  assert.equal(printing(ESS).trade, "gearsmith");
  assert.equal(printing(ESS).type, "tactic");
  const ok = essBoard();
  play(ok.engine, P1, ok.id("ess"), { mode: 0 });
  assert.equal(zoneOf(ok.engine, ok.id("ess")), "discard", "a resolved tactic is discarded");
  assert.equal(ready(ok.engine, P1), 1, "exactly 1 paid of two ready Rage");
  const none = essBoard({ resources: E(2, P1, true) });
  refused(() => play(none.engine, P1, none.id("ess"), { mode: 0 }), "cost 1, nothing ready", /./);
  assert.equal(zoneOf(none.engine, none.id("ess")), "hand");
  const icon = essBoard({ resources: [...E(1, P1, true), ...R(1)] });
  refused(() => play(icon.engine, P1, icon.id("ess"), { mode: 0 }), "one [E] icon short", /./);
  assert.equal(zoneOf(icon.engine, icon.id("ess")), "hand");
  const noE = essBoard({ resources: R(4) });
  refused(() => play(noE.engine, P1, noE.id("ess"), { mode: 0 }), "no [E]", /./);
  const plain = essBoard({ resources: E(2) });
  play(plain.engine, P1, plain.id("ess"), { mode: 0 });
  assert.equal(ready(plain.engine, P1), 1, "two ready [E]: pay 1");
});

clause(ESS, "0:rule", "it has exactly three rules-text choices: a fourth mode is refused, each of the three resolves", () => {
  const g = essBoard({ extra: [...covChars, ...itemCards] });
  refused(() => play(g.engine, P1, g.id("ess"), { mode: 3 }), "there is no option 4", /./);
  assert.equal(zoneOf(g.engine, g.id("ess")), "hand");
  for (const mode of [0, 1, 2]) {
    const ok = essBoard({ extra: [...covChars, ...itemCards] });
    play(ok.engine, P1, ok.id("ess"), { mode, selected: mode === 1 ? { c: [ok.id("cov")] } : mode === 2 ? { it: [ok.id("itemMine")] } : {} });
    assert.equal(zoneOf(ok.engine, ok.id("ess")), "discard", `mode ${mode} resolves`);
  }
});

clause(ESS, "0:rule", "only the chosen option's text is in force: the micromajig option needs no covert character and no item in the discard pile", () => {
  const g = essBoard();
  play(g.engine, P1, g.id("ess"), { mode: 0 });
  assert.equal(tokensOf(g.engine, P1).length, 1, "option 1 has no extra cost to satisfy");
  const cov = essBoard({ extra: [{ key: "cov", def: character({ name: "Sneak", ...COVERT }), owner: P1, zone: "play" }] });
  refused(() => play(cov.engine, P1, cov.id("ess"), { mode: 2 }), "option 3's pick (an item in my discard) cannot be made, even though option 2 could be", /./);
  const item3 = essBoard({ extra: [{ key: "itemMine", def: item({ name: "Mine Item" }), owner: P1, zone: "discard" }] });
  refused(() => play(item3.engine, P1, item3.id("ess"), { mode: 1 }), "option 2's pick (a COVERT character) cannot be made, even though option 3 could be", /./);
});

clause(ESS, "0:rule", "the printed tactic has no subtype and is a gearsmith tactic", () => {
  assert.deepEqual(printing(ESS).subtype, [], "Essence of Elitism prints no subtype");
  assert.equal(printing(ESS).type, "tactic");
  assert.equal(printing(ESS).trade, "gearsmith");
});

clause(ESS, "2:option:OPTION 2", "EXTRA COST: only a CHARACTER with COVERT can be picked: a COVERT item in play is refused", () => {
  const extra = [...covChars, { key: "covItem", def: item({ name: "Sneaky Item", ...COVERT }), owner: P1, zone: "play" as const }];
  const ok = essBoard({ extra });
  strip(ok, "cov");
  assert.equal(zoneOf(ok.engine, ok.id("ess")), "discard", "positive control: a covert character");
  const bad = essBoard({ extra });
  refused(() => strip(bad, "covItem"), "an item is not a character", /./);
  assert.equal(zoneOf(bad.engine, bad.id("ess")), "hand", "nothing played");
  assert.equal(ready(bad.engine, P1), 2, "nothing paid");
});

clause(ESS, "2:option:OPTION 2", "'This turn' means the whole turn, not just the battle: after a battle ends the picked character still has no COVERT until the turn is over", () => {
  const g = essBoard({ extra: covChars });
  strip(g, "cov");
  fightThrough(g.engine, P1, [g.id("plain")], { type: "faction", playerId: P2 }, []);
  assert.equal(g.engine.state.battle, undefined, "the battle is over");
  assert.ok(!kw(g.engine, g.id("cov")).includes("covert"), "still no COVERT later in the same turn");
  endTurn(g.engine, P1);
  assert.ok(kw(g.engine, g.id("cov")).includes("covert"), "COVERT is back after the turn");
});


clause(ESS, "1:option:OPTION 1", "puts exactly one Micromajig token into play under my control: a 1/1 character, speed 3, majig subtype, the opponent gets none", () => {
  const g = essBoard({ extra: [{ key: "bystander", def: character({ name: "Bystander" }), owner: P2, zone: "play" }] });
  assert.equal(tokensOf(g.engine, P1).length, 0);
  play(g.engine, P1, g.id("ess"), { mode: 0 });
  assert.equal(g.engine.state.pendingChoice, undefined);
  const tokens = tokensOf(g.engine, P1);
  assert.equal(tokens.length, 1, "exactly one token");
  assert.equal(tokensOf(g.engine, P2).length, 0, "none for the opponent");
  const t = tokens[0];
  assert.equal(g.engine.state.cards[t].ownerId, P1);
  assert.equal(g.engine.state.cards[t].zone, "play");
  assert.deepEqual([g.engine.getStat(t, "strength"), g.engine.getStat(t, "life"), g.engine.getStat(t, "speed")], [1, 1, 3]);
  assert.deepEqual(g.engine.getSubtypes(t), ["majig"]);
  assert.ok(g.engine.getCardTypes(t).includes("character"), "g.engine.getCardTypes(t).includes(\"character\")");
  assert.equal(g.engine.state.players[P1].play.filter((c) => g.engine.getDefinition(c).name === "Micromajig").length, 1);
});

clause(ESS, "1:option:OPTION 1", "the Micromajig token is a Gearsmith character", () => {
  const g = essBoard();
  play(g.engine, P1, g.id("ess"), { mode: 0 });
  const tokens = tokensOf(g.engine, P1);
  assert.equal(tokens.length, 1);
  assert.equal(g.engine.getDefinition(tokens[0]).trade, "gearsmith");
});

clause(ESS, "1:option:OPTION 1", "playing it twice puts two tokens (nothing is shared between plays) and the second play also costs 1", () => {
  const g = essBoard({ resources: [...E(2, P1, true), ...R(2)], extra: [{ key: "ess2", def: printing(ESS), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("ess"), { mode: 0 });
  play(g.engine, P1, g.id("ess2"), { mode: 0 });
  assert.equal(tokensOf(g.engine, P1).length, 2);
  assert.equal(ready(g.engine, P1), 0, "1 + 1 paid");
});

const strip = (g: ReturnType<typeof essBoard>, pick: string) => play(g.engine, P1, g.id("ess"), { mode: 1, selected: { c: [g.id(pick)] } });

clause(ESS, "2:option:OPTION 2", "EXTRA COST: any character with COVERT can be picked, mine or the opponent's, and the played card goes to the discard", () => {
  for (const pick of ["cov", "covFoe"]) {
    const g = essBoard({ extra: covChars });
    assert.ok(kw(g.engine, g.id(pick)).includes("covert"), `${pick} starts with COVERT`);
    strip(g, pick);
    assert.equal(g.engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(g.engine, g.id("ess")), "discard");
    assert.equal(zoneOf(g.engine, g.id(pick)), "play", "it is not destroyed or moved");
  }
});

clause(ESS, "2:option:OPTION 2", "EXTRA COST: a character without COVERT, a COVERT character in hand or in the discard pile, and no pick at all are refused", () => {
  const extra = [...covChars, ...itemCards];
  const ok = essBoard({ extra });
  strip(ok, "cov");
  assert.equal(zoneOf(ok.engine, ok.id("ess")), "discard", "positive control: a covert character in play");
  for (const bad of ["plain", "plainFoe", "covHand", "covDisc", "itemPlay", "itemMine"]) {
    const g = essBoard({ extra });
    refused(() => strip(g, bad), `${bad} is not a character with COVERT in play`, /./);
    assert.equal(zoneOf(g.engine, g.id("ess")), "hand", `${bad}: nothing played`);
    assert.equal(ready(g.engine, P1), 2, `${bad}: nothing paid`);
  }
  const none = essBoard({ extra });
  refused(() => play(none.engine, P1, none.id("ess"), { mode: 1 }), "the extra cost pick is required", /./);
  assert.equal(zoneOf(none.engine, none.id("ess")), "hand");
  const noCov = essBoard({ extra: covChars.filter((c) => !["cov", "cov2", "covFoe"].includes(c.key)) });
  refused(() => play(noCov.engine, P1, noCov.id("ess"), { mode: 1 }), "no COVERT character in play", /./);
  assert.equal(zoneOf(noCov.engine, noCov.id("ess")), "hand");
});

clause(ESS, "2:option:OPTION 2", "the picked character loses COVERT this turn, and only that character: other COVERT characters keep it, non-COVERT stay without", () => {
  const g = essBoard({ extra: covChars });
  strip(g, "cov");
  assert.ok(!kw(g.engine, g.id("cov")).includes("covert"), "picked: no COVERT");
  assert.ok(kw(g.engine, g.id("cov2")).includes("covert"), "my other covert keeps it");
  assert.ok(kw(g.engine, g.id("covFoe")).includes("covert"), "the opponent's covert keeps it");
  assert.ok(!kw(g.engine, g.id("plain")).includes("covert"), "!kw(g.engine, g.id(\"plain\")).includes(\"covert\")");
  const f = essBoard({ extra: covChars });
  strip(f, "covFoe");
  assert.ok(!kw(f.engine, f.id("covFoe")).includes("covert"), "an opponent's picked character loses it too");
  assert.ok(kw(f.engine, f.id("cov")).includes("covert"), "kw(f.engine, f.id(\"cov\")).includes(\"covert\")");
});

clause(ESS, "2:option:OPTION 2", "'This turn': the character has COVERT again once the turn is over, on the opponent's turn and on my next one", () => {
  const g = essBoard({ extra: covChars });
  strip(g, "cov");
  assert.ok(!kw(g.engine, g.id("cov")).includes("covert"), "!kw(g.engine, g.id(\"cov\")).includes(\"covert\")");
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.ok(kw(g.engine, g.id("cov")).includes("covert"), "back on the opponent's turn");
  endTurn(g.engine, P2);
  assert.ok(kw(g.engine, g.id("cov")).includes("covert"), "and on my next turn");
});

clause(ESS, "2:option:OPTION 2", "the character stays a normal character: its stats, zone and other keywords are untouched", () => {
  const def = character({ name: "Loud Sneak", strength: 3, life: 4, speed: 2, behavior: { keywords: ["covert", "aggro"] } as never });
  const g = essBoard({ extra: [{ key: "cov", def, owner: P1, zone: "play" }] });
  strip(g, "cov");
  assert.ok(!kw(g.engine, g.id("cov")).includes("covert"), "!kw(g.engine, g.id(\"cov\")).includes(\"covert\")");
  assert.ok(kw(g.engine, g.id("cov")).includes("aggro"), "only COVERT is removed");
  assert.deepEqual([g.engine.getStat(g.id("cov"), "strength"), g.engine.getStat(g.id("cov"), "life"), g.engine.getStat(g.id("cov"), "speed")], [3, 4, 2]);
});

const recur = (g: ReturnType<typeof essBoard>, pick: string) => play(g.engine, P1, g.id("ess"), { mode: 2, selected: { it: [g.id(pick)] } });

clause(ESS, "3:option:OPTION 3", "EXTRA COST: an item in my own discard pile can be picked, and the played card goes to the discard too", () => {
  const g = essBoard({ extra: itemCards });
  recur(g, "itemMine");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ess")), "discard");
});

clause(ESS, "3:option:OPTION 3", "EXTRA COST: an opponent's discarded item, an item in play / hand / deck, a character in my discard pile, and no pick are all refused", () => {
  const ok = essBoard({ extra: itemCards });
  recur(ok, "itemMine2");
  assert.equal(zoneOf(ok.engine, ok.id("itemMine2")), "hand", "positive control");
  for (const bad of ["itemFoe", "itemPlay", "itemHand", "itemDeck", "charDisc"]) {
    const g = essBoard({ extra: itemCards });
    refused(() => recur(g, bad), `${bad} is not an item in my discard pile`, /./);
    assert.equal(zoneOf(g.engine, g.id("ess")), "hand", `${bad}: nothing played`);
    assert.equal(ready(g.engine, P1), 2, `${bad}: nothing paid`);
  }
  const none = essBoard({ extra: itemCards });
  refused(() => play(none.engine, P1, none.id("ess"), { mode: 2 }), "the pick is required", /./);
  const empty = essBoard({ extra: itemCards.filter((c) => c.key !== "itemMine" && c.key !== "itemMine2") });
  refused(() => play(empty.engine, P1, empty.id("ess"), { mode: 2 }), "no item in my discard", /./);
});

clause(ESS, "3:option:OPTION 3", "EFFECT: the picked item goes to my hand; other discarded items (mine and the opponent's) stay where they are", () => {
  const g = essBoard({ extra: itemCards });
  recur(g, "itemMine");
  assert.equal(zoneOf(g.engine, g.id("itemMine")), "hand");
  assert.ok(g.engine.state.players[P1].hand.includes(g.id("itemMine")), "g.engine.state.players[P1].hand.includes(g.id(\"itemMine\"))");
  assert.equal(zoneOf(g.engine, g.id("itemMine2")), "discard", "only the picked item");
  assert.equal(zoneOf(g.engine, g.id("itemFoe")), "discard");
  assert.equal(zoneOf(g.engine, g.id("charDisc")), "discard");
  assert.equal(zoneOf(g.engine, g.id("itemPlay")), "play");
});

clause(ESS, "3:option:OPTION 3", "the recovered item is a real card in hand again: it can be deployed", () => {
  const g = essBoard({ resources: [...E(2, P1, true), ...R(4)], extra: [{ key: "itemMine", def: item({ name: "Mine Item", cost: 2 }), owner: P1, zone: "discard" }] });
  recur(g, "itemMine");
  play(g.engine, P1, g.id("itemMine"));
  assert.equal(zoneOf(g.engine, g.id("itemMine")), "play");
});

// ============================== G14n7 5p0rk D3f3n53 ==============================
const gsdBoard = (o: { down?: boolean; resources?: CardPlacement[]; extra?: CardPlacement[]; active?: PlayerId } = {}) =>
  mk(
    [
      { key: "gsd", def: printing(GSD), owner: P1, zone: o.down ? "play" : "hand", ...(o.down ? { faceDown: true } : {}) },
      ...(o.resources ?? [...E(2, P1, true), ...R(3)]),
      ...(o.extra ?? [])
    ],
    { active: o.active }
  );
const gsdUp = (extra: CardPlacement[] = [], resources: CardPlacement[] = [...E(2), ...R(2)]): ReturnType<typeof mk> =>
  mk(
    [{ key: "gsd", def: printing(GSD), owner: P1, zone: "play" }, ...resources, ...extra],
    { active: P2 }
  );
const foeAttackers: CardPlacement[] = [
  { key: "atk", def: character({ name: "Raider", life: 9 }), owner: P2, zone: "play" },
  { key: "atk2", def: character({ name: "Raider Two", life: 9 }), owner: P2, zone: "play" },
  { key: "idle", def: character({ name: "Idler", life: 9 }), owner: P2, zone: "play", attackEligible: false },
  { key: "mine", def: character({ name: "Defender", life: 9 }), owner: P1, zone: "play" },
  { key: "mine2", def: character({ name: "Defender Two", life: 9 }), owner: P1, zone: "play" }
];

clause(GSD, "0:kw:TACTICAL", "printed cost 3 / threshold [E][E] gearsmith item: deploys with two spent [E] and one ready (cost 3 total), refused one short or an [E] short", () => {
  assert.equal(printing(GSD).trade, "gearsmith");
  assert.equal(printing(GSD).type, "item");
  assert.deepEqual(printing(GSD).subtype, []);
  const ok = gsdBoard({ resources: [...E(2), ...R(1)] });
  play(ok.engine, P1, ok.id("gsd"));
  assert.equal(zoneOf(ok.engine, ok.id("gsd")), "play");
  assert.equal(ready(ok.engine, P1), 0, "three resources paid");
  const plus = gsdBoard({ resources: [...E(2), ...R(2)] });
  play(plus.engine, P1, plus.id("gsd"));
  assert.equal(ready(plus.engine, P1), 1, "exactly 3 paid of 4");
  const short = gsdBoard({ resources: [...E(2)] });
  refused(() => play(short.engine, P1, short.id("gsd")), "cost 3, two resources", /./);
  assert.equal(zoneOf(short.engine, short.id("gsd")), "hand");
  const icon = gsdBoard({ resources: [...E(1), ...R(2)] });
  refused(() => play(icon.engine, P1, icon.id("gsd")), "one [E] icon short", /./);
  const noE = gsdBoard({ resources: R(4) });
  refused(() => play(noE.engine, P1, noE.id("gsd")), "no [E]", /./);
  const spentE = gsdBoard({ resources: [...E(2, P1, true), ...R(3)] });
  play(spentE.engine, P1, spentE.id("gsd"));
  assert.equal(zoneOf(spentE.engine, spentE.id("gsd")), "play", "spent [E] still count for the threshold");
});

clause(GSD, "0:kw:TACTICAL", "TACTICAL: engine keyword is present, and it can be deployed while the opponent holds the turn, in my response window; an ordinary item cannot", () => {
  const g = mk([{ key: "gsd", def: printing(GSD), owner: P1, zone: "hand" }, { key: "plainItem", def: item({ name: "Plain Item", cost: 3 }), owner: P1, zone: "hand" }, ...E(2), ...R(4), ...foeAttackers], { active: P2 });
  assert.ok(kw(g.engine, g.id("gsd")).includes("tactical"), "kw(g.engine, g.id(\"gsd\")).includes(\"tactical\")");
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P1, "I hold priority");
  refused(() => playRaw(g.engine, P1, g.id("plainItem")), "a non-TACTICAL item is not deployable in a response window", /./);
  assert.equal(zoneOf(g.engine, g.id("plainItem")), "hand");
  playRaw(g.engine, P1, g.id("gsd"));
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("gsd")), "play", "the TACTICAL item is");
  assert.equal(ready(g.engine, P1), 3, "three paid of six");
});

clause(GSD, "0:kw:TACTICAL", "TACTICAL: it can also be deployed on my own turn in the main phase like any item", () => {
  const g = gsdBoard({ resources: [...E(2), ...R(1)] });
  play(g.engine, P1, g.id("gsd"));
  assert.equal(zoneOf(g.engine, g.id("gsd")), "play");
});

const impale = (g: ReturnType<typeof mk>, pick: string) => activate(g.engine, P1, g.id("gsd"), "impale", { selected: { prey: [g.id(pick)] } });

clause(GSD, "1:ability:impale", "COST + EFFECT: destroys this card, then the picked attacking character is destroyed; the other attacker and the defenders survive", () => {
  const g = gsdUp(foeAttackers);
  declareAttackOpenWindow(g.engine, P2, [g.id("atk"), g.id("atk2")]);
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P1);
  assert.ok(g.engine.getAvailableActivatedAbilities(P1).some((a) => a.cardId === g.id("gsd")), "listed");
  impale(g, "atk");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("gsd")), "discard", "COST: destroy this card");
  assert.equal(zoneOf(g.engine, g.id("atk")), "discard", "the attacker is destroyed");
  assert.equal(zoneOf(g.engine, g.id("atk2")), "play", "the other attacker is not");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play");
  assert.equal(zoneOf(g.engine, g.id("idle")), "play");
});

clause(GSD, "1:ability:impale", "'an attacking character': a non-attacking character (the opponent's idle one, or my own) cannot be picked; the control picks an attacker", () => {
  for (const bad of ["idle", "mine", "mine2"]) {
    const g = gsdUp(foeAttackers);
    declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
    refused(() => impale(g, bad), `${bad} is not attacking`, /./);
    assert.equal(zoneOf(g.engine, g.id("gsd")), "play", `${bad}: the item was not destroyed`);
    assert.equal(zoneOf(g.engine, g.id(bad)), "play");
  }
  const ok = gsdUp(foeAttackers);
  declareAttackOpenWindow(ok.engine, P2, [ok.id("atk2")]);
  impale(ok, "atk2");
  assert.equal(zoneOf(ok.engine, ok.id("atk2")), "discard");
  assert.equal(zoneOf(ok.engine, ok.id("atk")), "play", "the character that did not attack is untouched");
});

clause(GSD, "1:ability:impale", "a blocking (defending) character is not an attacking character and cannot be picked; the attacker still can", () => {
  const g = gsdUp(foeAttackers);
  declareAttackBy(g.engine, P2, [g.id("atk")]);
  declareBlockers(g.engine, P1, [g.id("mine")]);
  g.engine.perform({ type: "passPriority", playerId: P2 } as never);
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P1, "the attacker passed; I hold priority with the blockers declared");
  refused(() => impale(g, "mine"), "a blocker is not attacking", /./);
  assert.equal(zoneOf(g.engine, g.id("gsd")), "play");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play");
  impale(g, "atk");
  assert.equal(zoneOf(g.engine, g.id("atk")), "discard");
});

clause(GSD, "1:ability:impale", "'an attacking character' includes my own attacker: on my turn I can destroy my own attacking character", () => {
  const g = mk([{ key: "gsd", def: printing(GSD), owner: P1, zone: "play" }, ...E(2), ...foeAttackers], { active: P1 });
  declareAttackBy(g.engine, P1, [g.id("mine")]);
  declareBlockers(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P1, "the attacker holds priority first");
  refused(() => impale(g, "atk"), "the blocker is not attacking", /./);
  impale(g, "mine");
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard");
  assert.equal(zoneOf(g.engine, g.id("atk")), "play");
});

clause(GSD, "1:ability:impale", "no pick, a non-character, and use outside a battle are refused; the item stays in play", () => {
  const g = gsdUp(foeAttackers);
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  refused(() => activate(g.engine, P1, g.id("gsd"), "impale", {}), "an attacking character must be picked", /./);
  assert.equal(zoneOf(g.engine, g.id("gsd")), "play");
  const calm = gsdUp(foeAttackers);
  refused(() => impale(calm, "atk"), "no battle: nothing is attacking", /./);
  assert.equal(zoneOf(calm.engine, calm.id("gsd")), "play");
  assert.equal(zoneOf(calm.engine, calm.id("atk")), "play");
});

clause(GSD, "1:ability:impale", "it is a cost-less ability beyond destroying itself: no resources are spent", () => {
  const g = gsdUp(foeAttackers, [...E(2, P1, true)]);
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  impale(g, "atk");
  assert.equal(zoneOf(g.engine, g.id("atk")), "discard", "works with every resource spent");
  const h = gsdUp(foeAttackers, [...E(2), ...R(2)]);
  declareAttackOpenWindow(h.engine, P2, [h.id("atk")]);
  const before = ready(h.engine, P1);
  impale(h, "atk");
  assert.equal(ready(h.engine, P1), before, "no resources paid");
});

clause(GSD, "1:ability:impale", "a face-down copy has no abilities: it cannot be used", () => {
  const g = mk([{ key: "gsd", def: printing(GSD), owner: P1, zone: "play", faceDown: true }, ...E(2), ...foeAttackers], { active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  refused(() => impale(g, "atk"), "face-down", /./);
  assert.equal(zoneOf(g.engine, g.id("atk")), "play");
});

clause(GSD, "2:flipUp", "a face-down copy flips up for 1 with [E][E]: it is face-up in play afterwards and has been paid for (itself or one other resource)", () => {
  const g = gsdBoard({ down: true, resources: [...E(2, P1, true)] });
  rawFlipUp(g.engine, P1, g.id("gsd"));
  assert.equal(g.engine.state.cards[g.id("gsd")].faceDown, false);
  assert.equal(zoneOf(g.engine, g.id("gsd")), "play");
  const h = gsdBoard({ down: true, resources: [...E(2), ...R(2)] });
  rawFlipUp(h.engine, P1, h.id("gsd"));
  assert.equal(h.engine.state.cards[h.id("gsd")].faceDown, false);
  assert.ok([3, 4].includes(ready(h.engine, P1)), "1 paid (by itself or by another resource), not its deploy cost 3");
});

clause(GSD, "2:flipUp", "the threshold [E][E] must be met by other resources: one [E], or no [E], or only the opponent's [E] is refused", () => {
  const one = gsdBoard({ down: true, resources: [...E(1), ...R(3)] });
  refused(() => rawFlipUp(one.engine, P1, one.id("gsd")), "one [E] is one icon short", /./);
  assert.equal(one.engine.state.cards[one.id("gsd")].faceDown, true);
  const none = gsdBoard({ down: true, resources: R(4) });
  refused(() => rawFlipUp(none.engine, P1, none.id("gsd")), "no [E]", /./);
  const alone = gsdBoard({ down: true, resources: [] });
  refused(() => rawFlipUp(alone.engine, P1, alone.id("gsd")), "no icons at all, the card's own icon does not count", /./);
  const foe = gsdBoard({ down: true, resources: [...E(2, P2), ...R(2)] });
  refused(() => rawFlipUp(foe.engine, P1, foe.id("gsd")), "the opponent's [E] do not count", /./);
  const ok = gsdBoard({ down: true, resources: [...E(2, P1, true)] });
  rawFlipUp(ok.engine, P1, ok.id("gsd"));
  assert.equal(ok.engine.state.cards[ok.id("gsd")].faceDown, false, "positive control: two spent [E] meet the threshold, itself pays the 1");
});

clause(GSD, "2:flipUp", "the cost is exactly 1, not 0 and not the deploy cost 3: with two spent [E] only the card itself can pay, and the opponent's resources cannot", () => {
  const g = gsdBoard({ down: true, resources: [...E(2, P1, true), ...R(2, P2)] });
  rawFlipUp(g.engine, P1, g.id("gsd"));
  assert.equal(g.engine.state.cards[g.id("gsd")].faceDown, false);
  assert.equal(ready(g.engine, P2), 2, "the opponent paid nothing");
  const pool = gsdBoard({ down: true, resources: [...E(2, P1, true), ...R(1)] });
  rawFlipUp(pool.engine, P1, pool.id("gsd"));
  assert.ok([0, 1].includes(ready(pool.engine, P1)), "[0, 1].includes(ready(pool.engine, P1))");
});

clause(GSD, "2:flipUp", "FLIP UP really costs 1: with the card and both [E] spent nothing can pay and it is refused; one ready Rage pays it", () => {
  const dry = gsdBoard({ down: true, resources: E(2, P1, true) });
  dry.engine.state.cards[dry.id("gsd")].attachedTo = dry.engine.state.players[P1].factionId!;
  assert.equal(ready(dry.engine, P1), 0, "nothing is ready");
  refused(() => rawFlipUp(dry.engine, P1, dry.id("gsd")), "cost 1 cannot be paid", /./);
  assert.equal(dry.engine.state.cards[dry.id("gsd")].faceDown, true);
  const one = gsdBoard({ down: true, resources: [...E(2, P1, true), ...R(1)] });
  one.engine.state.cards[one.id("gsd")].attachedTo = one.engine.state.players[P1].factionId!;
  assert.equal(ready(one.engine, P1), 1);
  rawFlipUp(one.engine, P1, one.id("gsd"));
  assert.equal(one.engine.state.cards[one.id("gsd")].faceDown, false, "one ready resource pays the cost");
  assert.equal(ready(one.engine, P1), 0, "exactly 1 was paid");
});


clause(GSD, "2:flipUp", "FLIP UP does not change when an item may be deployed: refused? no - TACTICAL, so it may flip up in my response window; afterwards IMPALE works", () => {
  const g = mk([{ key: "gsd", def: printing(GSD), owner: P1, zone: "play", faceDown: true }, ...E(2), ...R(2), ...foeAttackers], { active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  rawFlipUp(g.engine, P1, g.id("gsd"));
  assert.equal(g.engine.state.cards[g.id("gsd")].faceDown, false);
  impale(g, "atk");
  assert.equal(zoneOf(g.engine, g.id("atk")), "discard");
});

// ============================== Golemizer ==============================
const hostDef = (speed = 4) => character({ name: "Host", strength: 2, life: 9, speed });
const golBoard = (o: { hand?: boolean; down?: boolean; hostSpeed?: number; tokens?: number; resources?: CardPlacement[]; extra?: CardPlacement[]; golController?: PlayerId; freeDown?: boolean; golOwner?: PlayerId; hostOwner?: PlayerId; active?: PlayerId } = {}) => {
  const hostOwner = o.hostOwner ?? P1;
  return mk(
    [
      { key: "host", def: hostDef(o.hostSpeed), owner: hostOwner, zone: "play", ...(o.tokens ? { counters: { token: o.tokens } } : {}) },
      o.hand
        ? { key: "gol", def: printing(GOL), owner: P1, zone: "hand" }
        : { key: "gol", def: printing(GOL), owner: o.golOwner ?? P1, controller: o.golController, zone: "play", ...(o.freeDown ? {} : { attachedToKey: "host" }), ...(o.down || o.freeDown ? { faceDown: true } : {}) },
      ...(o.resources ?? [...E(2), ...R(1)]),
      ...(o.extra ?? [])
    ],
    { active: o.active }
  );
};
const speed = (g: ReturnType<typeof mk>, key: string): number => g.engine.getStat(g.id(key), "speed");
const tokenCount = (g: ReturnType<typeof mk>, key: string): number => (g.engine.state.cards[g.id(key)].counters?.token as number | undefined) ?? 0;
const foeHost: CardPlacement = { key: "foeHost", def: character({ name: "Foe Host", strength: 1, life: 5, speed: 3 }), owner: P2, zone: "play" };
const stuff: CardPlacement[] = [
  foeHost,
  { key: "wall", def: item({ name: "Wall", cost: 1 }), owner: P1, zone: "play" },
  { key: "spot", def: { ...(item({ name: "Spot" }) as object), type: "location" } as never, owner: P1, zone: "play" }
];
const attachPlay = (g: ReturnType<typeof mk>, hostKey: string) => play(g.engine, P1, g.id("gol"), { selected: { attachTo: [g.id(hostKey)] } });

clause(GOL, "0:attach", "printed cost 1 / threshold [E] gearsmith gear item: deploys with a spent [E] and one ready resource, refused with nothing ready or without [E]", () => {
  assert.equal(printing(GOL).trade, "gearsmith");
  assert.equal(printing(GOL).type, "item");
  assert.deepEqual(printing(GOL).subtype, ["gear"]);
  const ok = golBoard({ hand: true, resources: [...E(1, P1, true), ...R(1)] });
  attachPlay(ok, "host");
  assert.equal(zoneOf(ok.engine, ok.id("gol")), "play");
  assert.equal(ready(ok.engine, P1), 0, "exactly 1 paid");
  const none = golBoard({ hand: true, resources: [...E(1, P1, true)] });
  refused(() => attachPlay(none, "host"), "cost 1, nothing ready", /./);
  assert.equal(zoneOf(none.engine, none.id("gol")), "hand");
  const noE = golBoard({ hand: true, resources: R(3) });
  refused(() => attachPlay(noE, "host"), "no [E]", /./);
  assert.equal(zoneOf(noE.engine, noE.id("gol")), "hand");
  const plus = golBoard({ hand: true, resources: [...E(2), ...R(1)] });
  attachPlay(plus, "host");
  assert.equal(ready(plus.engine, P1), 2, "3 ready, pay 1");
});

clause(GOL, "0:attach", "ATTACH TO CHARACTER: attaches to my character or the opponent's, and is refused for an item, a location, or no host at all", () => {
  const mine = golBoard({ hand: true, extra: stuff });
  attachPlay(mine, "host");
  assert.equal(mine.engine.state.cards[mine.id("gol")].attachedTo, mine.id("host"));
  const foe = golBoard({ hand: true, extra: stuff });
  attachPlay(foe, "foeHost");
  assert.equal(foe.engine.state.cards[foe.id("gol")].attachedTo, foe.id("foeHost"));
  assert.equal(foe.engine.state.cards[foe.id("gol")].controllerId, P1, "I control it, though it sits on their character");
  for (const bad of ["wall", "spot"]) {
    const g = golBoard({ hand: true, extra: stuff });
    refused(() => attachPlay(g, bad), `${bad} is not a character`, /./);
    assert.equal(zoneOf(g.engine, g.id("gol")), "hand");
    assert.equal(ready(g.engine, P1), 3, `${bad}: nothing paid`);
  }
  const g = golBoard({ hand: true });
  refused(() => play(g.engine, P1, g.id("gol"), { selected: { attachTo: [] } }), "no host picked", /./);
  assert.equal(zoneOf(g.engine, g.id("gol")), "hand");
});

clause(GOL, "1:rule", "the attached character loses 1 speed for each token on it: 0, 1, 2 and 3 tokens on a speed 4 host", () => {
  for (const n of [0, 1, 2, 3]) {
    const g = golBoard({ tokens: n });
    assert.equal(speed(g, "host"), 4 - n, `${n} tokens`);
  }
});

clause(GOL, "1:rule", "only tokens count (other counters do not), and only the attached character is slowed", () => {
  const g = golBoard({ tokens: 1, extra: [
    { key: "other", def: hostDef(4), owner: P1, zone: "play", counters: { token: 2 } },
    { key: "oddHost", def: hostDef(4), owner: P1, zone: "play", counters: { wound: 3 } }
  ] });
  assert.equal(speed(g, "host"), 3);
  assert.equal(speed(g, "other"), 4, "tokens on an unattached character change nothing");
  assert.equal(speed(g, "oddHost"), 4);
  const h = golBoard({ extra: [{ key: "other", def: hostDef(4), owner: P1, zone: "play", counters: { wound: 3 } }] });
  assert.equal(speed(h, "host"), 4, "no tokens: no slowing");
});

clause(GOL, "1:rule", "an opponent's character wearing my Golemizer is slowed by its own tokens; exactly as many tokens as speed leave it at 0", () => {
  const g = golBoard({ hostOwner: P2, tokens: 2 });
  assert.equal(speed(g, "host"), 2);
  const h = golBoard({ hostSpeed: 2, tokens: 2 });
  assert.equal(speed(h, "host"), 0);
});

clause(GOL, "1:rule", "a speed can't be reduced below 0: a speed 2 host with 5 tokens has speed 0, not -3", () => {
  const h = golBoard({ hostSpeed: 2, tokens: 5 });
  assert.equal(speed(h, "host"), 0, "not negative");
});

clause(GOL, "1:rule", "the slowing only lasts while Golemizer is attached face-up: gone once it leaves play; a face-down copy does not slow", () => {
  const g = golBoard({ tokens: 2, extra: [{ key: "smasher", def: smasher(), owner: P1, zone: "hand" }] });
  assert.equal(speed(g, "host"), 2);
  play(g.engine, P1, g.id("smasher"), { selected: { t: [g.id("gol")] } });
  if (pending(g.engine)) answerPending(g.engine, pending(g.engine)!.kind, declineReplacement(g.engine));
  assert.equal(zoneOf(g.engine, g.id("gol")), "discard");
  assert.equal(speed(g, "host"), 4, "removed");
  assert.equal(speed(g, "host"), 4, "and still removed");
  const down = golBoard({ down: true, tokens: 2 });
  assert.equal(speed(down, "host"), 4, "face-down: no abilities");
});

const turnEndPrompt = (g: ReturnType<typeof mk>, player: PlayerId) => {
  endTurn(g.engine, player);
  return pending(g.engine);
};

clause(GOL, "2:rule", "at the end of my turn I am asked; accepting puts exactly one token on the attached character and slows it", () => {
  const g = golBoard();
  const pc = turnEndPrompt(g, P1);
  assert.equal(pc?.kind, "chooserSelectsOption");
  assert.equal(pc?.playerId, P1);
  answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(tokenCount(g, "host"), 1);
  assert.equal(speed(g, "host"), 3);
  assert.equal(zoneOf(g.engine, g.id("host")), "play", "speed 3 left: it lives");
});

clause(GOL, "2:rule", "'you may': declining puts no token", () => {
  const g = golBoard();
  const pc = turnEndPrompt(g, P1);
  assert.equal(pc?.kind, "chooserSelectsOption");
  answerPending(g.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(tokenCount(g, "host"), 0);
  assert.equal(speed(g, "host"), 4);
  assert.equal(zoneOf(g.engine, g.id("host")), "play");
});

clause(GOL, "2:rule", "it adds to existing tokens each turn: 2 tokens + 1 = 3, speed 1; the character is destroyed only when speed reaches 0", () => {
  const g = golBoard({ tokens: 2 });
  turnEndPrompt(g, P1);
  answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(tokenCount(g, "host"), 3);
  assert.equal(speed(g, "host"), 1);
  assert.equal(zoneOf(g.engine, g.id("host")), "play", "speed 1: survives");
  const h = golBoard({ tokens: 3 });
  turnEndPrompt(h, P1);
  answerPending(h.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(zoneOf(h.engine, h.id("host")), "discard", "3 + 1 tokens on speed 4: speed 0, destroyed");
});

clause(GOL, "2:rule", "If it has 0 speed, destroy it: a speed 1 host dies from the first token, a speed 2 host from the second turn", () => {
  const g = golBoard({ hostSpeed: 1 });
  turnEndPrompt(g, P1);
  answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(zoneOf(g.engine, g.id("host")), "discard");
  const h = golBoard({ hostSpeed: 2 });
  turnEndPrompt(h, P1);
  answerPending(h.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(zoneOf(h.engine, h.id("host")), "play", "speed 1 after one token");
  endTurn(h.engine, P2);
  turnEndPrompt(h, P1);
  answerPending(h.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(zoneOf(h.engine, h.id("host")), "discard", "speed 0 after the second");
});

clause(GOL, "2:rule", "'If it has 0 speed, destroy it' is not conditional on putting a token: a host already at 0 speed dies even when I decline", () => {
  const g = golBoard({ hostSpeed: 0 });
  const pc = turnEndPrompt(g, P1);
  if (pc) answerPending(g.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(zoneOf(g.engine, g.id("host")), "discard");
});

clause(GOL, "2:rule", "the trigger is only at the end of MY turn: nothing is asked at the opponent's end of turn", () => {
  const g = golBoard();
  turnEndPrompt(g, P1);
  answerPending(g.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(g.engine.state.activePlayerId, P2);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.pendingChoice, undefined, "no prompt at the opponent's end of turn");
  assert.equal(tokenCount(g, "host"), 0);
  assert.equal(g.engine.state.activePlayerId, P1);
});

clause(GOL, "2:rule", "controller matters, not owner: a Golemizer controlled by the opponent asks them at their end of turn, not me", () => {
  const g = golBoard({ golOwner: P1, golController: P2 });
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.pendingChoice, undefined, "not at my end of turn");
  endTurn(g.engine, P2);
  const pc = pending(g.engine);
  assert.equal(pc?.playerId, P2);
  answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(tokenCount(g, "host"), 1);
});

clause(GOL, "2:rule", "two Golemizers on one character each offer their token, and their slowing stacks: 2 tokens x 2 Golemizers = -4 speed", () => {
  const g = golBoard({ hostSpeed: 6, extra: [{ key: "gol2", def: printing(GOL), owner: P1, zone: "play", attachedToKey: "host" }] });
  assert.equal(speed(g, "host"), 6);
  endTurn(g.engine, P1);
  for (let i = 0; i < 6 && pending(g.engine); i += 1) {
    const pc = pending(g.engine)!;
    answerPending(g.engine, pc.kind, pc.kind === "orderTriggers" ? { next: ((pc as unknown as { triggers: unknown[] }).triggers)[0] } : { index: 1 });
  }
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(tokenCount(g, "host"), 2, "one token from each");
  assert.equal(speed(g, "host"), 2, "each Golemizer slows by the 2 tokens: 6 - 2 - 2");
});

const smasher = () =>
  tactic({
    name: "Item Smasher",
    cost: 0,
    behavior: {
      abilities: [{ id: "smash", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
    } as never
  });
const smashBoard = (o: Parameters<typeof golBoard>[0] = {}) =>
  golBoard({ ...o, extra: [{ key: "smasher", def: smasher(), owner: P1, zone: "hand" }, ...(o.extra ?? [])] });
const smash = (g: ReturnType<typeof mk>, key = "gol") => play(g.engine, P1, g.id("smasher"), { selected: { t: [g.id(key)] } });
const declineReplacement = (engine: SpoilsEngine): Record<string, unknown> => {
  const pc = pending(engine)!;
  return pc.kind === "chooserSelectsOption" ? { index: 1 } : { kind: pc.kind };
};

const answerRepl = (g: ReturnType<typeof mk>, apply: boolean) => answerPending(g.engine, "replacementChoice", { apply });

clause(GOL, "3:rule", "When it would be destroyed I am offered the choice; accepting flips it face-down instead: it stays in play, face-down, not in the discard pile", () => {
  const g = smashBoard({ tokens: 1 });
  smash(g);
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "replacementChoice");
  assert.equal(pc?.playerId, P1, "its controller decides");
  assert.equal(zoneOf(g.engine, g.id("gol")), "play", "nothing happens before the answer");
  answerRepl(g, true);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("gol")), "play");
  assert.equal(g.engine.state.cards[g.id("gol")].faceDown, true);
  assert.ok(!g.engine.state.players[P1].discard.includes(g.id("gol")), "!g.engine.state.players[P1].discard.includes(g.id(\"gol\"))");
  assert.equal(g.engine.state.cards[g.id("gol")].controllerId, P1);
  assert.equal(speed(g, "host"), 4, "a face-down Golemizer no longer slows its host");
});

clause(GOL, "3:rule", "'you may': declining lets it be destroyed normally, into its owner's discard pile", () => {
  const g = smashBoard({ tokens: 1 });
  smash(g);
  answerRepl(g, false);
  assert.equal(zoneOf(g.engine, g.id("gol")), "discard");
  assert.ok(g.engine.state.players[P1].discard.includes(g.id("gol")), "g.engine.state.players[P1].discard.includes(g.id(\"gol\"))");
  assert.equal(speed(g, "host"), 4, "gone: no slowing");
});

clause(GOL, "3:rule", "'under its owner's control': a Golemizer I own but the opponent controls comes back face-down under MY control", () => {
  const g = smashBoard({ golOwner: P1, golController: P2, tokens: 1 });
  assert.equal(g.engine.state.cards[g.id("gol")].controllerId, P2);
  smash(g);
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "replacementChoice");
  assert.equal(pc?.playerId, P2, "its current controller decides");
  answerRepl(g, true);
  assert.equal(g.engine.state.cards[g.id("gol")].faceDown, true);
  assert.equal(g.engine.state.cards[g.id("gol")].controllerId, P1, "controlled by its owner now");
  assert.ok(g.engine.state.players[P1].play.includes(g.id("gol")), "g.engine.state.players[P1].play.includes(g.id(\"gol\"))");
  assert.ok(!g.engine.state.players[P2].play.includes(g.id("gol")), "!g.engine.state.players[P2].play.includes(g.id(\"gol\"))");
});

clause(GOL, "3:rule", "only 'this card': destroying a different item, or a character, offers no choice; a second Golemizer's destruction offers exactly one choice, for itself", () => {
  const g = smashBoard({ extra: [{ key: "wall", def: item({ name: "Wall", cost: 1 }), owner: P1, zone: "play" }] });
  smash(g, "wall");
  assert.equal(g.engine.state.pendingChoice, undefined, "destroying another item asks nothing");
  assert.equal(zoneOf(g.engine, g.id("wall")), "discard");
  assert.equal(zoneOf(g.engine, g.id("gol")), "play");
  assert.equal(g.engine.state.cards[g.id("gol")].faceDown, false);
  const h = smashBoard({ extra: [{ key: "gol2", def: printing(GOL), owner: P1, zone: "play", attachedToKey: "host" }] });
  smash(h, "gol2");
  const pc = pending(h.engine);
  assert.equal(pc?.kind, "replacementChoice");
  assert.equal((pc as unknown as { affectedCardId: string }).affectedCardId, h.id("gol2"));
  answerRepl(h, false);
  assert.equal(h.engine.state.pendingChoice, undefined, "one choice only: the other copy has no say");
  assert.equal(zoneOf(h.engine, h.id("gol2")), "discard");
  assert.equal(zoneOf(h.engine, h.id("gol")), "play");
  assert.equal(h.engine.state.cards[h.id("gol")].faceDown, false, "the first copy is untouched");
});

clause(GOL, "3:rule", "the flipped-down Golemizer is a face-down card in my play area that counts as a resource", () => {
  const g = smashBoard({ resources: [...E(2)] });
  const before = g.engine.getAvailableResourceCount(P1);
  smash(g);
  answerRepl(g, true);
  assert.equal(g.engine.getAvailableResourceCount(P1), before + 1, "it is a face-down resource now");
});

const golDownBoard = (resources: CardPlacement[], extra: CardPlacement[] = []) => golBoard({ freeDown: true, tokens: 1, resources, extra });
const flipGol = (g: ReturnType<typeof mk>, host = "host") => rawFlipUp(g.engine, P1, g.id("gol"), { attachTo: [g.id(host)] });

clause(GOL, "4:flipUp", "a face-down Golemizer flips up for 4 with [E][E][E]: three spent [E] and three ready others, with itself paying the fourth, is enough", () => {
  const g = golDownBoard([...E(3, P1, true), ...R(3)]);
  assert.equal(speed(g, "host"), 4, "face-down: no slowing");
  flipGol(g);
  assert.equal(g.engine.state.cards[g.id("gol")].faceDown, false);
  assert.equal(zoneOf(g.engine, g.id("gol")), "play");
  assert.equal(ready(g.engine, P1), 0, "all four ready resources (3 Rage + itself) were the cost 4");
  const h = golDownBoard([...E(3), ...R(4)]);
  flipGol(h);
  assert.equal(h.engine.state.cards[h.id("gol")].faceDown, false);
  assert.ok([3, 4].includes(ready(h.engine, P1)), "7 others: 4 paid (itself counts) -> 3 or 4 ready, not its deploy cost 1");
});

clause(GOL, "4:flipUp", "the cost is exactly 4: itself plus two others is refused, nothing is paid or flipped", () => {
  const g = golDownBoard([...E(3, P1, true), ...R(2)]);
  refused(() => flipGol(g), "3 resources in all (2 others + itself) is not 5? 2 + itself = 3 < 4", /./);
  assert.equal(g.engine.state.cards[g.id("gol")].faceDown, true);
  assert.equal(ready(g.engine, P1), 3, "nothing paid: 2 Rage + itself still ready");
  const ok = golDownBoard([...E(3, P1, true), ...R(3)]);
  flipGol(ok);
  assert.equal(ok.engine.state.cards[ok.id("gol")].faceDown, false, "positive control: 3 others + itself");
});

clause(GOL, "4:flipUp", "the threshold [E][E][E] must be met: two [E] and Rage is one icon short, no [E] lacks it, the opponent's [E] do not count", () => {
  const two = golDownBoard([...E(2), ...R(4)]);
  refused(() => flipGol(two), "two [E]", /./);
  assert.equal(two.engine.state.cards[two.id("gol")].faceDown, true);
  const none = golDownBoard(R(6));
  refused(() => flipGol(none), "no [E]", /./);
  const foe = golDownBoard([...E(2), ...E(2, P2), ...R(3)]);
  refused(() => flipGol(foe), "the opponent's [E] do not count", /./);
  const spentOk = golDownBoard([...E(3, P1, true), ...R(3)]);
  flipGol(spentOk);
  assert.equal(spentOk.engine.state.cards[spentOk.id("gol")].faceDown, false, "spent [E] count for the threshold");
});

clause(GOL, "4:flipUp", "once flipped up it is the same attached Golemizer again: it slows its host and is no longer a face-down resource", () => {
  const g = golDownBoard([...E(3), ...R(3)]);
  flipGol(g);
  assert.equal(zoneOf(g.engine, g.id("gol")), "play");
  assert.equal(g.engine.state.cards[g.id("gol")].attachedTo, g.id("host"), "on the host");
  assert.equal(speed(g, "host"), 3, "1 token slows the host again");
});

clause(GOL, "4:flipUp", "ATTACH TO CHARACTER still applies when flipping up: a non-character host or no host is refused", () => {
  const stuff2 = [...stuff];
  for (const bad of ["wall", "spot"]) {
    const g = golDownBoard([...E(3), ...R(3)], stuff2);
    refused(() => flipGol(g, bad), `${bad} is not a character`, /./);
    assert.equal(g.engine.state.cards[g.id("gol")].faceDown, true);
  }
  const none = golDownBoard([...E(3), ...R(3)]);
  refused(() => rawFlipUp(none.engine, P1, none.id("gol"), { attachTo: [] }), "no host", /./);
  assert.equal(none.engine.state.cards[none.id("gol")].faceDown, true);
  const ok = golDownBoard([...E(3), ...R(3)], stuff2);
  flipGol(ok, "foeHost");
  assert.equal(ok.engine.state.cards[ok.id("gol")].attachedTo, ok.id("foeHost"), "any character, including the opponent's");
});

clause(GOL, "4:flipUp", "Golemizer isn't TACTICAL: it can't be flipped up inside the opponent's response window", () => {
  const g = mk([{ key: "gol", def: printing(GOL), owner: P1, zone: "play", faceDown: true }, ...E(3), ...R(3), ...foeAttackers], { active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P1);
  refused(() => flipGol(g), "a non-tactic cannot FLIP UP in a response window", /./);
  assert.equal(g.engine.state.cards[g.id("gol")].faceDown, true);
});

// ============================== Jocular Stupefaction ==============================
const jocBoard = (o: { down?: boolean; resources?: CardPlacement[]; extra?: CardPlacement[]; active?: PlayerId } = {}) =>
  mk(
    [
      { key: "joc", def: printing(JOC), owner: P1, zone: o.down ? "play" : "hand", ...(o.down ? { faceDown: true } : {}) },
      ...(o.resources ?? [...E(1, P1, true), ...R(3)]),
      ...(o.extra ?? [])
    ],
    { active: o.active }
  );
const jocCast = (g: ReturnType<typeof mk>, pick: string) => play(g.engine, P1, g.id("joc"), { selected: { c: [g.id(pick)] } });

clause(JOC, "0:extraCost", "printed cost 3 / threshold [E] gearsmith tactic: deploys with exactly three resources (one [E]), refused with two or with no [E]", () => {
  assert.equal(printing(JOC).trade, "gearsmith");
  assert.equal(printing(JOC).type, "tactic");
  const ok = jocBoard({ resources: [...E(1), ...R(2)], extra: covChars });
  jocCast(ok, "cov");
  assert.equal(zoneOf(ok.engine, ok.id("joc")), "discard");
  assert.equal(ready(ok.engine, P1), 0, "three paid");
  const plus = jocBoard({ resources: [...E(1), ...R(3)], extra: covChars });
  jocCast(plus, "cov");
  assert.equal(ready(plus.engine, P1), 1, "exactly 3 paid of 4");
  const short = jocBoard({ resources: [...E(1), ...R(1)], extra: covChars });
  refused(() => jocCast(short, "cov"), "cost 3, two resources", /./);
  assert.equal(zoneOf(short.engine, short.id("joc")), "hand");
  assert.equal(ready(short.engine, P1), 2, "nothing paid");
  assert.equal(zoneOf(short.engine, short.id("cov")), "play");
  const noE = jocBoard({ resources: R(4), extra: covChars });
  refused(() => jocCast(noE, "cov"), "no [E]", /./);
  assert.equal(zoneOf(noE.engine, noE.id("joc")), "hand");
  const spentE = jocBoard({ resources: [...E(1, P1, true), ...R(3)], extra: covChars });
  jocCast(spentE, "cov");
  assert.equal(zoneOf(spentE.engine, spentE.id("cov")), "discard", "a spent [E] still meets the threshold");
});

clause(JOC, "0:extraCost", "the printed tactic has no subtype and is a gearsmith tactic", () => {
  assert.deepEqual(printing(JOC).subtype, [], "Jocular Stupefaction prints no subtype");
  assert.equal(printing(JOC).type, "tactic");
  assert.equal(printing(JOC).trade, "gearsmith");
});


clause(JOC, "0:extraCost", "EXTRA COST: any character with COVERT can be picked, mine or the opponent's", () => {
  for (const pick of ["cov", "cov2", "covFoe"]) {
    const g = jocBoard({ extra: covChars });
    jocCast(g, pick);
    assert.equal(g.engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(g.engine, g.id("joc")), "discard", `${pick}: played`);
    assert.equal(zoneOf(g.engine, g.id(pick)), "discard", `${pick}: destroyed`);
  }
});

clause(JOC, "0:extraCost", "EXTRA COST: a character without COVERT, a COVERT character in hand / discard, a non-character, or no pick is refused and costs nothing", () => {
  const extra = [...covChars, ...itemCards, { key: "covItem", def: item({ name: "Covert Gizmo", ...COVERT }), owner: P1, zone: "play" } as CardPlacement];
  for (const bad of ["plain", "plainFoe", "covHand", "covDisc", "itemPlay", "covItem"]) {
    const g = jocBoard({ extra });
    refused(() => jocCast(g, bad), `${bad} is not a character with COVERT in play`, /./);
    assert.equal(zoneOf(g.engine, g.id("joc")), "hand", `${bad}: not played`);
    assert.equal(ready(g.engine, P1), 3, `${bad}: nothing paid`);
    assert.equal(zoneOf(g.engine, g.id(bad)), bad === "covHand" ? "hand" : bad === "covDisc" ? "discard" : "play");
  }
  const none = jocBoard({ extra });
  refused(() => play(none.engine, P1, none.id("joc")), "an extra-cost pick is required", /./);
  assert.equal(zoneOf(none.engine, none.id("joc")), "hand");
  const empty = jocBoard({ extra: covChars.filter((c) => !c.key.startsWith("cov") || c.key === "covHand" || c.key === "covDisc") });
  refused(() => play(empty.engine, P1, empty.id("joc")), "no COVERT character in play", /./);
  assert.equal(zoneOf(empty.engine, empty.id("joc")), "hand");
});

clause(JOC, "0:extraCost", "a character that lost COVERT (Essence of Elitism option 2) is no longer pickable", () => {
  const g = jocBoard({ resources: [...E(2, P1, true), ...R(5)], extra: [...covChars, { key: "ess", def: printing(ESS), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("ess"), { mode: 1, selected: { c: [g.id("cov")] } });
  refused(() => jocCast(g, "cov"), "cov lost COVERT this turn", /./);
  assert.equal(zoneOf(g.engine, g.id("joc")), "hand");
  jocCast(g, "cov2");
  assert.equal(zoneOf(g.engine, g.id("cov2")), "discard", "another covert character still can be");
});

clause(JOC, "1:rule", "Destroy the character: the picked character goes to its owner's discard pile; other characters (covert or not, mine or theirs) survive", () => {
  const g = jocBoard({ extra: covChars });
  jocCast(g, "covFoe");
  assert.ok(g.engine.state.players[P2].discard.includes(g.id("covFoe")), "the opponent's discard pile");
  for (const other of ["cov", "cov2", "plain", "plainFoe"]) assert.equal(zoneOf(g.engine, g.id(other)), "play", other);
  const h = jocBoard({ extra: covChars });
  jocCast(h, "cov");
  assert.ok(h.engine.state.players[P1].discard.includes(h.id("cov")), "h.engine.state.players[P1].discard.includes(h.id(\"cov\"))");
  assert.equal(zoneOf(h.engine, h.id("cov2")), "play");
  assert.equal(zoneOf(h.engine, h.id("covFoe")), "play");
});

clause(JOC, "1:rule", "it destroys regardless of the character's toughness or damage: a 9-life undamaged character dies", () => {
  const tank = character({ name: "Tank", life: 9, strength: 5, ...COVERT });
  const g = jocBoard({ extra: [{ key: "tank", def: tank, owner: P2, zone: "play" }, { key: "tank2", def: tank, owner: P2, zone: "play" }] });
  jocCast(g, "tank");
  assert.equal(zoneOf(g.engine, g.id("tank")), "discard");
  assert.equal(zoneOf(g.engine, g.id("tank2")), "play");
});

clause(JOC, "1:rule", "it is playable in a response window like any tactic, destroying a COVERT attacker", () => {
  const sneak = { key: "sneak", def: character({ name: "Sneak Attacker", life: 9, ...COVERT }), owner: P2, zone: "play" } as CardPlacement;
  const g = jocBoard({ active: P2, resources: [...E(1), ...R(3)], extra: [sneak] });
  declareAttackOpenWindow(g.engine, P2, [g.id("sneak")]);
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(g.engine, P1, g.id("joc"), { selected: { c: [g.id("sneak")] } });
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("sneak")), "discard");
  assert.equal(zoneOf(g.engine, g.id("joc")), "discard");
});

clause(JOC, "2:flipUp", "a face-down copy flips up for 3 with [E]: it needs a COVERT pick, and the picked character is destroyed", () => {
  const g = jocBoard({ down: true, resources: [...E(1), ...R(2)], extra: covChars });
  rawFlipUp(g.engine, P1, g.id("joc"), { c: [g.id("covFoe")] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("covFoe")), "discard", "its effect ran: destroyed");
  assert.equal(zoneOf(g.engine, g.id("cov")), "play");
  assert.equal(g.engine.state.cards[g.id("joc")].faceDown, false);
  assert.ok([0, 1].includes(ready(g.engine, P1)), "3 paid in all: the three others, or itself plus two");
});

clause(JOC, "2:flipUp", "the cost is exactly 3: itself plus one other is refused, itself plus two others works, a COVERT pick is still required", () => {
  const short = jocBoard({ down: true, resources: [...E(1)], extra: covChars });
  refused(() => rawFlipUp(short.engine, P1, short.id("joc"), { c: [short.id("cov")] }), "1 other + itself = 2 < 3", /./);
  assert.equal(short.engine.state.cards[short.id("joc")].faceDown, true);
  assert.equal(zoneOf(short.engine, short.id("cov")), "play");
  const ok = jocBoard({ down: true, resources: [...E(1), ...R(1)], extra: covChars });
  rawFlipUp(ok.engine, P1, ok.id("joc"), { c: [ok.id("cov")] });
  assert.equal(zoneOf(ok.engine, ok.id("cov")), "discard", "2 others + itself pays 3");
  const noPick = jocBoard({ down: true, resources: [...E(1), ...R(2)], extra: covChars });
  refused(() => rawFlipUp(noPick.engine, P1, noPick.id("joc"), {}), "no pick", /./);
  assert.equal(noPick.engine.state.cards[noPick.id("joc")].faceDown, true);
  const badPick = jocBoard({ down: true, resources: [...E(1), ...R(2)], extra: covChars });
  refused(() => rawFlipUp(badPick.engine, P1, badPick.id("joc"), { c: [badPick.id("plain")] }), "a non-covert pick", /./);
  assert.equal(zoneOf(badPick.engine, badPick.id("plain")), "play");
});

clause(JOC, "2:flipUp", "the threshold [E] must come from another resource: three Rage is one icon short, the opponent's [E] do not count, a spent [E] does", () => {
  const rage = jocBoard({ down: true, resources: R(4), extra: covChars });
  refused(() => rawFlipUp(rage.engine, P1, rage.id("joc"), { c: [rage.id("cov")] }), "no [E]", /./);
  assert.equal(rage.engine.state.cards[rage.id("joc")].faceDown, true);
  const foe = jocBoard({ down: true, resources: [...R(3), ...E(2, P2)], extra: covChars });
  refused(() => rawFlipUp(foe.engine, P1, foe.id("joc"), { c: [foe.id("cov")] }), "the opponent's [E]", /./);
  const spentE = jocBoard({ down: true, resources: [...E(1, P1, true), ...R(2)], extra: covChars });
  rawFlipUp(spentE.engine, P1, spentE.id("joc"), { c: [spentE.id("cov")] });
  assert.equal(zoneOf(spentE.engine, spentE.id("cov")), "discard");
});

clause(JOC, "2:flipUp", "a tactic may flip up inside the opponent's response window (it could be played there)", () => {
  const sneak = { key: "sneak", def: character({ name: "Sneak Attacker", life: 9, ...COVERT }), owner: P2, zone: "play" } as CardPlacement;
  const g = jocBoard({ down: true, active: P2, resources: [...E(1), ...R(2)], extra: [sneak] });
  declareAttackOpenWindow(g.engine, P2, [g.id("sneak")]);
  rawFlipUp(g.engine, P1, g.id("joc"), { c: [g.id("sneak")] });
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("sneak")), "discard");
});
