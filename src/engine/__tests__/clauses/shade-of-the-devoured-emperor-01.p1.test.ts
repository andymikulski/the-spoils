// Clause tests — batch shade-of-the-devoured-emperor-01, part p1 (groups 1-5, missing clauses only).
// Cards: Anxious Imp, Concentriculation, Contiguous Defalcating Machine, Elementary Elemental, Expedition Endeavour.
import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  bank,
  character,
  developFaction,
  item,
  killTactic,
  location,
  P1,
  P2,
  play,
  resolvePendingResponses,
  tactic,
  volition
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import type { CardDefinition, PlayerId, SpoilsEngine } from "../../../engine.js";
import { clause, declineAll, drain, printing, refused } from "./_clause.js";
import { declareAttackBy, fightThrough, playRaw } from "./_battle.js";
import { answerPending, fillers, pending, zoneOf } from "./_board.js";
import { attachedCount, endTurn, readyCount, spentResources } from "./_turn.js";

type Eng = SpoilsEngine;
const O = (n: number, owner: PlayerId = P1) => bank("obsession", n, owner);
const R = (n: number, owner: PlayerId = P1) => bank("rage", n, owner);
const kws = (engine: Eng, cardId: string): string[] => engine.getKeywords(cardId) as unknown as string[];
const obsessionIcons = (engine: Eng, p: PlayerId): number => engine.getThresholds(p).obsession ?? 0;
const factionIdOf = (engine: Eng, p: PlayerId): string => engine.state.players[p].factionId!;

// A synthetic tactic that drops one chosen resource in play into its owner's discard pile (id `drop`, decl `r`).
const dropResourceTactic = (): CardDefinition =>
  tactic({
    name: "DropResource",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "drop",
          type: "activated",
          targets: [{ id: "r", selector: { zone: "play", type: "resource" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "r" }, to: "discard" }]
        }
      ]
    }
  });

// =====================================================================
// Anxious Imp
// =====================================================================
const IMP = "72661539-2086-49b7-a58d-b66a2ba45a30"; // character · cost 3 · [O] · 2/3/2 -- OBSESS -- COST: Pay 2. -- EFFECT: This turn, this card gains PROVIDES: [O][O][O]. -- [O][O][O][O][O][O]: This card gains COVERT.

function impBoard(extra: CardPlacement[], opts: { zone?: CardPlacement["zone"]; depleted?: boolean; controller?: PlayerId } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "imp", def: printing(IMP), owner: P1, zone: opts.zone ?? "play", depleted: opts.depleted, controller: opts.controller },
      ...fillers("a", 3, P1, "deck"),
      ...extra
    ]
  });
}

clause(IMP, "0:ability:imp-obsess", "deploys for 3 with [O] and has the printed stats 2 / 3 / 2", () => {
  const b = impBoard([...O(3)], { zone: "hand" });
  play(b.engine, P1, b.id("imp"));
  assert.equal(zoneOf(b.engine, b.id("imp")), "play");
  assert.equal(readyCount(b.engine, P1), 0, "paid exactly 3");
  assert.equal(b.engine.getStat(b.id("imp"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("imp"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("imp"), "life"), 2);

  const short = impBoard([...O(2)], { zone: "hand" });
  refused(() => play(short.engine, P1, short.id("imp")), "one resource short of 3");
  const noIcon = impBoard([...R(3)], { zone: "hand" });
  refused(() => play(noIcon.engine, P1, noIcon.id("imp")), "no [O] icon for the [O] threshold");
});

clause(IMP, "0:ability:imp-obsess", "COST pay 2: exactly 2 resources are attached to the faction, and the Imp gains PROVIDES [O][O][O] this turn", () => {
  const { engine, id } = impBoard([...O(3)]);
  assert.equal(obsessionIcons(engine, P1), 3);
  assert.equal(readyCount(engine, P1), 3);
  activate(engine, P1, id("imp"), "imp-obsess");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(attachedCount(engine, P1), 2, "paid 2");
  assert.equal(readyCount(engine, P1), 1, "the Imp is not a resource that can pay");
  assert.equal(obsessionIcons(engine, P1), 6, "+3 [O] from the Imp (spent resources still provide their icons)");
  assert.equal(engine.getThresholds(P1).rage ?? 0, 0, "only [O] icons were added");
  assert.equal(obsessionIcons(engine, P2), 0, "the opponent gets nothing");
});

clause(IMP, "0:ability:imp-obsess", "used twice in one turn, each use grants [O][O][O] again (literal reading): two uses mean two grants, +6 [O]", () => {
  const { engine, id } = impBoard([...O(5)]);
  assert.equal(obsessionIcons(engine, P1), 5);
  activate(engine, P1, id("imp"), "imp-obsess");
  assert.equal(obsessionIcons(engine, P1), 8, "first use: +3");
  activate(engine, P1, id("imp"), "imp-obsess");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(attachedCount(engine, P1), 4, "paid 2 twice");
  assert.equal(obsessionIcons(engine, P1), 11, "second use grants its own [O][O][O]: 5 + 3 + 3");
});

clause(IMP, "0:ability:imp-obsess", "the PROVIDES lasts this turn only", () => {
  const { engine, id } = impBoard([...O(3)]);
  activate(engine, P1, id("imp"), "imp-obsess");
  assert.equal(obsessionIcons(engine, P1), 6);
  endTurn(engine, P1);
  assert.equal(obsessionIcons(engine, P1), 3, "back to the 3 resource icons");
  assert.equal(zoneOf(engine, id("imp")), "play");
});

clause(IMP, "0:ability:imp-obsess", "can't be used with fewer than 2 unattached resources (attached ones don't count)", () => {
  const short = impBoard([...spentResources(P1, 5), ...O(1)]);
  assert.equal(readyCount(short.engine, P1), 1);
  refused(() => activate(short.engine, P1, short.id("imp"), "imp-obsess"), "only 1 unattached resource");
  assert.equal(obsessionIcons(short.engine, P1), 1, "nothing was granted");

  const exact = impBoard([...spentResources(P1, 5), ...O(2)]);
  activate(exact.engine, P1, exact.id("imp"), "imp-obsess");
  assert.equal(readyCount(exact.engine, P1), 0, "positive control: 2 unattached resources pay for it");
  assert.equal(obsessionIcons(exact.engine, P1), 5);
});

clause(IMP, "0:ability:imp-obsess", "has no deplete cost: a depleted Imp can still OBSESS", () => {
  const { engine, id } = impBoard([...O(2)], { depleted: true });
  activate(engine, P1, id("imp"), "imp-obsess");
  assert.equal(obsessionIcons(engine, P1), 5);
});

clause(IMP, "0:ability:imp-obsess", "the provided [O][O][O] count toward the thresholds of the player's cards", () => {
  const needsOOO = tactic({
    name: "NeedsOOO",
    cost: 0,
    threshold: "ooo",
    behavior: { abilities: [{ id: "n", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const { engine, id } = impBoard([...R(2), { key: "t", def: needsOOO, owner: P1, zone: "hand" }]);
  refused(() => play(engine, P1, id("t")), "no [O] icons yet");
  activate(engine, P1, id("imp"), "imp-obsess");
  play(engine, P1, id("t"));
  assert.equal(zoneOf(engine, id("t")), "discard", "with the Imp's [O][O][O] the [O][O][O] threshold is met");
});

clause(IMP, "1:rule@oooooo", "with six [O] the Imp has COVERT; with five (or other icons) it doesn't", () => {
  for (const [label, extra, expected] of [
    ["6 [O]", O(6), true],
    ["7 [O]", O(7), true],
    ["5 [O]", O(5), false],
    ["5 [O] + 3 rage", [...O(5), ...R(3)], false],
    ["5 [O] + 2 Volition", [...O(5), ...volition(2)], false],
    ["no resources", [], false]
  ] as Array<[string, CardPlacement[], boolean]>) {
    const { engine, id } = impBoard([...extra, { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" }]);
    assert.equal(kws(engine, id("imp")).includes("covert"), expected, label);
    assert.equal(kws(engine, id("ally")).includes("covert"), false, `${label}: only the Imp itself gains COVERT`);
  }
});

clause(IMP, "1:rule@oooooo", "COVERT works in battle: a non-covert character can't block the Imp while it has six [O]", () => {
  const board = (n: number) =>
    impBoard([...O(n), { key: "blk", def: character({ name: "Plain" }), owner: P2, zone: "play" }]);
  const six = board(6);
  declareAttackBy(six.engine, P1, [six.id("imp")]);
  refused(
    () => six.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [six.id("blk")] }),
    "a non-covert character can't block a covert party"
  );
  const five = board(5);
  declareAttackBy(five.engine, P1, [five.id("imp")]);
  five.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [five.id("blk")] });
  assert.deepEqual(five.engine.state.battle?.blockingParty, [five.id("blk")], "control: without COVERT it can be blocked");
});

clause(IMP, "1:rule@oooooo", "turns on with the sixth [O] gained this turn (OBSESS) and off again at end of turn", () => {
  const { engine, id } = impBoard([...O(3)]);
  assert.equal(kws(engine, id("imp")).includes("covert"), false);
  activate(engine, P1, id("imp"), "imp-obsess");
  assert.equal(kws(engine, id("imp")).includes("covert"), true, "3 resources + the Imp's [O][O][O]");
  endTurn(engine, P1);
  assert.equal(kws(engine, id("imp")).includes("covert"), false);
});

clause(IMP, "1:rule@oooooo", "turns off the instant a resource leaves play", () => {
  const banks = O(6);
  const { engine, id } = impBoard([...banks, { key: "drop", def: dropResourceTactic(), owner: P1, zone: "hand" }]);
  assert.equal(kws(engine, id("imp")).includes("covert"), true);
  play(engine, P1, id("drop"), { selected: { r: [id(banks[0].key)] } });
  assert.equal(zoneOf(engine, id(banks[0].key)), "discard");
  assert.equal(kws(engine, id("imp")).includes("covert"), false, "down to five [O]");
});

clause(IMP, "1:rule@oooooo", "the threshold is its controller's: icons you control, not the owner's", () => {
  const theirIcons = impBoard([...O(6, P1)], { controller: P2 });
  assert.equal(kws(theirIcons.engine, theirIcons.id("imp")).includes("covert"), false, "P2 controls the Imp but P1 has the icons");
  const myIcons = impBoard([...O(6, P2)], { controller: P2 });
  assert.equal(kws(myIcons.engine, myIcons.id("imp")).includes("covert"), true, "P2 controls the Imp and the six [O]");
});

clause(IMP, "1:rule@oooooo", "the Imp has no COVERT outside play (hand, discard pile)", () => {
  for (const zone of ["hand", "discard"] as const) {
    const { engine, id } = impBoard([...O(6)], { zone });
    assert.equal(kws(engine, id("imp")).includes("covert"), false, zone);
  }
});

// =====================================================================
// Concentriculation
// =====================================================================
const CONC = "c6595d11-cbd1-4731-a244-78cc20f36d19"; // tactic · cost 5 · [O][O][O] -- COST: Pick a non-resource card. -- EFFECT: Put the card on the top of its owner's deck. -- RECUR: [O][O][O] -- COST: Use this only if this card is in your discard pile. Pay 3. Pick a character. Remove this card from the game. -- EFFECT: Put the character into its owner's hand.

function concBoard(extra: CardPlacement[] = [], opts: { obs?: number; zone?: "hand" | "discard" } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "cc", def: printing(CONC), owner: P1, zone: opts.zone ?? "hand" },
      ...O(opts.obs ?? 8),
      ...fillers("a", 3, P1, "deck"),
      ...fillers("b", 3, P2, "deck"),
      ...extra
    ]
  });
}

clause(CONC, "0:ability", "picks a non-resource card as the cost (the tactic costs 5), then puts it on top of its owner's deck", () => {
  const { engine, id } = concBoard([{ key: "v", def: character({ name: "Victim" }), owner: P2, zone: "play" }]);
  const deckBefore = [...engine.state.players[P2].deck];
  playRaw(engine, P1, id("cc"), { selected: { c: [id("v")] } });
  assert.equal(readyCount(engine, P1), 3, "paid 5 of 8");
  assert.equal(zoneOf(engine, id("v")), "play", "the pick is a cost; the card moves when the tactic resolves");
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("v")), "deck");
  assert.deepEqual(engine.state.players[P2].deck, [id("v"), ...deckBefore], "on TOP, the rest of the deck unchanged below it");
  assert.equal(zoneOf(engine, id("cc")), "discard");
});

clause(CONC, "0:ability", "any non-resource card in play can be picked: characters, items and locations of either player", () => {
  const defs: Array<[string, CardDefinition]> = [
    ["character", character({ name: "VChar" })],
    ["item", item({ name: "VItem" })],
    ["location", location({ name: "VLoc" })]
  ];
  for (const [kind, def] of defs) {
    for (const controller of [P1, P2]) {
      const { engine, id } = concBoard([{ key: "v", def, owner: controller, zone: "play" }]);
      const deckBefore = [...engine.state.players[controller].deck];
      play(engine, P1, id("cc"), { selected: { c: [id("v")] } });
      assert.equal(engine.state.pendingChoice, undefined, `${kind} of ${controller}`);
      assert.deepEqual(engine.state.players[controller].deck, [id("v"), ...deckBefore], `${kind} of ${controller} goes on top of its owner's deck`);
    }
  }
});

clause(CONC, "0:ability", "the card goes to its OWNER's deck, whoever controls it", () => {
  const stolen = concBoard([{ key: "v", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 }]);
  const p2Before = [...stolen.engine.state.players[P2].deck];
  const p1Before = [...stolen.engine.state.players[P1].deck];
  play(stolen.engine, P1, stolen.id("cc"), { selected: { c: [stolen.id("v")] } });
  assert.deepEqual(stolen.engine.state.players[P2].deck, [stolen.id("v"), ...p2Before], "owned by P2, controlled by P1: P2's deck");
  assert.deepEqual(stolen.engine.state.players[P1].deck, p1Before, "P1's deck is untouched");

  const lent = concBoard([{ key: "v", def: character({ name: "Lent" }), owner: P1, zone: "play", controller: P2 }]);
  const lentBefore = [...lent.engine.state.players[P1].deck];
  play(lent.engine, P1, lent.id("cc"), { selected: { c: [lent.id("v")] } });
  assert.deepEqual(lent.engine.state.players[P1].deck, [lent.id("v"), ...lentBefore], "owned by P1, controlled by P2: P1's deck");
});

clause(CONC, "0:ability", "can't pick resources (face-up or face-down), factions, or cards outside play", () => {
  const [upRes] = R(1, P2);
  const [downRes] = volition(1, P2);
  const { engine, id } = concBoard([
    upRes,
    downRes,
    { key: "v", def: character({ name: "Valid" }), owner: P2, zone: "play" },
    { key: "inHand", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
    { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" }
  ]);
  const attempt = (target: string) => () => play(engine, P1, id("cc"), { selected: { c: [target] } });
  refused(attempt(id(upRes.key)), "a face-up resource is a resource");
  refused(attempt(id(downRes.key)), "a face-down card is a resource");
  refused(attempt(factionIdOf(engine, P2)), "the opponent's faction (CR 202.9)");
  refused(attempt(factionIdOf(engine, P1)), "your own faction");
  refused(attempt(id("inHand")), "a card in hand isn't in play");
  refused(attempt(id("inDiscard")), "a card in the discard pile isn't in play");
  refused(attempt(id("b0")), "a card in a deck isn't in play");
  refused(() => play(engine, P1, id("cc"), { selected: {} }), "the pick is required");
  assert.equal(zoneOf(engine, id("cc")), "hand", "nothing was played");
  play(engine, P1, id("cc"), { selected: { c: [id("v")] } });
  assert.equal(zoneOf(engine, id("v")), "deck", "positive control: the character can be picked");
});

clause(CONC, "0:ability", "costs 5 and needs [O][O][O]", () => {
  const ok = concBoard([{ key: "v", def: character({ name: "V" }), owner: P2, zone: "play" }], { obs: 5 });
  play(ok.engine, P1, ok.id("cc"), { selected: { c: [ok.id("v")] } });
  assert.equal(readyCount(ok.engine, P1), 0, "paid exactly 5");

  const short = concBoard([{ key: "v", def: character({ name: "V" }), owner: P2, zone: "play" }], { obs: 4 });
  refused(() => play(short.engine, P1, short.id("cc"), { selected: { c: [short.id("v")] } }), "one resource short of 5");

  const noThreshold = concBoard([{ key: "v", def: character({ name: "V" }), owner: P2, zone: "play" }, ...R(3)], { obs: 2 });
  refused(
    () => play(noThreshold.engine, P1, noThreshold.id("cc"), { selected: { c: [noThreshold.id("v")] } }),
    "5 resources but only two [O]"
  );
});

clause(CONC, "0:ability", "an attached card follows its picked host to the owner's deck", () => {
  const { engine, id } = concBoard([
    { key: "host", def: character({ name: "Host" }), owner: P2, zone: "play" },
    { key: "gear", def: item({ name: "Gear", attachTo: "character" } as Partial<CardDefinition>), owner: P2, zone: "play", attachedToKey: "host" }
  ]);
  play(engine, P1, id("cc"), { selected: { c: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "deck");
  assert.equal(zoneOf(engine, id("gear")), "deck", "CR 301.4: the attached card leaves play the same way");
  assert.deepEqual([...engine.state.players[P2].deck.slice(0, 2)].sort(), [id("host"), id("gear")].sort(), "both on top");
});

const recurBoard = (extra: CardPlacement[], obs = 3) => concBoard(extra, { obs, zone: "discard" });
const recur = (b: ReturnType<typeof concBoard>, target: string) =>
  activate(b.engine, P1, b.id("cc"), "concentriculation-recur", { selected: { ch: [target] } });

clause(CONC, "1:ability:concentriculation-recur", "from the discard pile: pays 3, removes itself from the game, and returns the picked character to its owner's hand", () => {
  const b = recurBoard([{ key: "v", def: character({ name: "Victim" }), owner: P2, zone: "play" }], 5);
  const handBefore = [...b.engine.state.players[P2].hand];
  recur(b, b.id("v"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("v")), "hand");
  assert.deepEqual(b.engine.state.players[P2].hand, [...handBefore, b.id("v")]);
  assert.equal(zoneOf(b.engine, b.id("cc")), "removed", "Remove this card from the game");
  assert.equal(readyCount(b.engine, P1), 2, "paid 3 of 5 (not the printed 5)");
});

clause(CONC, "1:ability:concentriculation-recur", "the character goes to its OWNER's hand, whoever controls it; your own characters can be picked too", () => {
  const stolen = recurBoard([{ key: "v", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 }]);
  recur(stolen, stolen.id("v"));
  assert.equal(stolen.engine.state.cards[stolen.id("v")].zone, "hand");
  assert.ok(stolen.engine.state.players[P2].hand.includes(stolen.id("v")), "owner's hand");
  assert.equal(stolen.engine.state.players[P1].hand.includes(stolen.id("v")), false);

  const mine = recurBoard([{ key: "v", def: character({ name: "Mine" }), owner: P1, zone: "play" }]);
  recur(mine, mine.id("v"));
  assert.ok(mine.engine.state.players[P1].hand.includes(mine.id("v")), "mine.engine.state.players[P1].hand.includes(mine.id(\"v\"))");
});

clause(CONC, "1:ability:concentriculation-recur", "the costs (pay 3, pick, remove this card) are paid when it is used, before the effect resolves", () => {
  const b = recurBoard([{ key: "v", def: character({ name: "Victim" }), owner: P2, zone: "play" }]);
  b.engine.perform({
    type: "activateAbility",
    playerId: P1,
    cardId: b.id("cc"),
    abilityId: "concentriculation-recur",
    selected: { ch: [b.id("v")] },
    variables: {}
  } as never);
  assert.equal(zoneOf(b.engine, b.id("cc")), "removed", "removed as a cost");
  assert.equal(readyCount(b.engine, P1), 0, "pay 3 as a cost");
  assert.equal(zoneOf(b.engine, b.id("v")), "play", "the effect hasn't resolved yet");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("v")), "hand");
});

clause(CONC, "1:ability:concentriculation-recur", "use this only if this card is in your discard pile", () => {
  const board = (zone: "hand" | "discard") => recurBoard([{ key: "v", def: character({ name: "V" }), owner: P2, zone: "play" }]);
  const inHand = concBoard([{ key: "v", def: character({ name: "V" }), owner: P2, zone: "play" }], { obs: 8, zone: "hand" });
  refused(
    () => recur(inHand, inHand.id("v")),
    "RECUR from hand",
    /not found|zone|discard|cannot|can't|only/i
  );
  assert.equal(zoneOf(inHand.engine, inHand.id("cc")), "hand");
  const fromDiscard = board("discard");
  recur(fromDiscard, fromDiscard.id("v"));
  assert.equal(zoneOf(fromDiscard.engine, fromDiscard.id("v")), "hand", "positive control: from the discard pile");
});

clause(CONC, "1:ability:concentriculation-recur", "can't be used without 3 unattached resources, or without [O][O][O]", () => {
  const v = (): CardPlacement => ({ key: "v", def: character({ name: "V" }), owner: P2, zone: "play" });
  const short = recurBoard([v(), ...spentResources(P1, 4)], 2);
  refused(() => recur(short, short.id("v")), "only 2 unattached resources");
  assert.equal(zoneOf(short.engine, short.id("cc")), "discard");
  const noThreshold = recurBoard([v(), ...R(4)], 2);
  refused(() => recur(noThreshold, noThreshold.id("v")), "4 resources but only two [O]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("cc")), "discard");
  const ok = recurBoard([v(), ...R(1)], 3);
  recur(ok, ok.id("v"));
  assert.equal(zoneOf(ok.engine, ok.id("v")), "hand", "positive control: three [O] and nothing else");
});

clause(CONC, "1:ability:concentriculation-recur", "only a character in play can be picked", () => {
  const [downRes] = volition(1, P2);
  const [upRes] = R(1, P2);
  const b = recurBoard([
    { key: "v", def: character({ name: "Valid" }), owner: P2, zone: "play" },
    { key: "it", def: item({ name: "AnItem" }), owner: P2, zone: "play" },
    { key: "loc", def: location({ name: "ALoc" }), owner: P2, zone: "play" },
    downRes,
    upRes,
    { key: "inHand", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
    { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" }
  ], 8);
  refused(() => recur(b, b.id("it")), "an item");
  refused(() => recur(b, b.id("loc")), "a location");
  refused(() => recur(b, b.id(upRes.key)), "a resource");
  refused(() => recur(b, b.id(downRes.key)), "a face-down card is a resource, not a character");
  refused(() => recur(b, factionIdOf(b.engine, P2)), "a faction");
  refused(() => recur(b, b.id("inHand")), "a character in hand");
  refused(() => recur(b, b.id("inDiscard")), "a character in the discard pile");
  refused(() => activate(b.engine, P1, b.id("cc"), "concentriculation-recur", { selected: {} }), "the pick is required");
  assert.equal(zoneOf(b.engine, b.id("cc")), "discard", "nothing was paid or removed");
  recur(b, b.id("v"));
  assert.equal(zoneOf(b.engine, b.id("v")), "hand", "positive control");
});

clause(CONC, "1:ability:concentriculation-recur", "the main (play) ability isn't available from the discard pile", () => {
  const b = concBoard([{ key: "v", def: character({ name: "V" }), owner: P2, zone: "play" }], { obs: 8, zone: "discard" });
  refused(() => play(b.engine, P1, b.id("cc"), { selected: { c: [b.id("v")] } }), "a tactic can't be played from the discard pile");
  assert.equal(zoneOf(b.engine, b.id("v")), "play");
  assert.equal(zoneOf(b.engine, b.id("cc")), "discard");
});

// =====================================================================
// Contiguous Defalcating Machine
// =====================================================================
const CDM = "25ba52f8-62c9-4e2c-8daa-7e6d841f6c76"; // item · cost 5 · [O][O] -- UNIQUE CONTIGUOUS DEFALCATING MACHINE -- If a character enters play, its controller must choose one of the following: OPTION 1 Put a resource they control into its owner's hand. OPTION 2 Destroy that character. OPTION 3 Their faction loses 3 influence.

function cdmBoard(extra: CardPlacement[] = [], opts: { zone?: CardPlacement["zone"]; controller?: PlayerId; p2Turn?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.p2Turn ? 2 : undefined,
    activePlayerId: opts.p2Turn ? P2 : undefined,
    cards: [{ key: "cdm", def: printing(CDM), owner: P1, zone: opts.zone ?? "play", controller: opts.controller }, ...extra]
  });
}
const freeChar = (name: string): CardDefinition => character({ name, cost: 0 });
const influenceOf = (engine: Eng, p: PlayerId): number => engine.state.players[p].influence;
const handOf = (engine: Eng, p: PlayerId): string[] => engine.state.players[p].hand as unknown as string[];
const resourcesInPlay = (engine: Eng, p: PlayerId): number => engine.state.players[p].play.filter((c) => engine.isResource(c)).length;
const chooseOptionAs = (engine: Eng, p: PlayerId, index: number): void =>
  engine.perform({ type: "resolvePendingChoice", playerId: p, choice: { kind: "chooserSelectsOption", index } } as never);
const chooseOption = (engine: Eng, index: number) => answerPending(engine, "chooserSelectsOption", { index });

// Tactics that make characters enter play other than by being deployed from hand.
const reanimateTactic = (): CardDefinition =>
  tactic({
    name: "Reanimate",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "re",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
const makeTokenTactic = (): CardDefinition =>
  tactic({
    name: "MakeToken",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "mk",
          type: "activated",
          effects: [{ type: "createTokens", controller: "controller", count: 1, token: { name: "Micro", cardType: "character", subtype: [], strength: 1, life: 1, speed: 3 } }]
        }
      ]
    }
  });
const destroyItemTactic = (): CardDefinition =>
  tactic({
    name: "BreakItem",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "bi",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

clause(CDM, "0:unique", "deploys for 5 with [O][O]", () => {
  const b = cdmBoard([...O(5)], { zone: "hand" });
  play(b.engine, P1, b.id("cdm"));
  assert.equal(zoneOf(b.engine, b.id("cdm")), "play");
  assert.equal(readyCount(b.engine, P1), 0, "paid exactly 5");
  const short = cdmBoard([...O(4)], { zone: "hand" });
  refused(() => play(short.engine, P1, short.id("cdm")), "one resource short of 5");
  const noIcons = cdmBoard([...O(1), ...R(4)], { zone: "hand" });
  refused(() => play(noIcons.engine, P1, noIcons.id("cdm")), "only one [O] for the [O][O] threshold");
});

clause(CDM, "0:unique", "controlling a second Machine makes you keep one: keeping the new one destroys the old one, keeping the old one destroys the new one", () => {
  for (const keep of ["old", "new"] as const) {
    const b = cdmBoard([{ key: "cdm2", def: printing(CDM), owner: P1, zone: "hand" }, ...O(5)]);
    play(b.engine, P1, b.id("cdm2"));
    const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
    assert.equal(pc.kind, "uniqueSurvivor");
    assert.equal(pc.playerId, P1, "the controller chooses");
    assert.deepEqual([...pc.candidates].sort(), [b.id("cdm"), b.id("cdm2")].sort());
    const kept = keep === "old" ? b.id("cdm") : b.id("cdm2");
    const lost = keep === "old" ? b.id("cdm2") : b.id("cdm");
    b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: kept } } as never);
    assert.equal(zoneOf(b.engine, kept), "play", `keep ${keep}`);
    assert.equal(zoneOf(b.engine, lost), "discard", `keep ${keep}: the other copy is destroyed`);
    assert.equal(b.engine.state.pendingChoice, undefined);
  }
});

clause(CDM, "0:unique", "the restriction is per player: the opponent may control their own Machine", () => {
  const b = cdmBoard([{ key: "cdm2", def: printing(CDM), owner: P2, zone: "hand" }, ...O(5, P2)], { p2Turn: true });
  play(b.engine, P2, b.id("cdm2"));
  assert.equal(b.engine.state.pendingChoice, undefined, "no survivor choice");
  assert.equal(zoneOf(b.engine, b.id("cdm")), "play");
  assert.equal(zoneOf(b.engine, b.id("cdm2")), "play");
});

clause(CDM, "0:unique", "taking control of the opponent's Machine while you have your own is a duplicate", () => {
  const steal = tactic({
    name: "Steal",
    cost: 0,
    behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });
  const b = cdmBoard([
    { key: "theirs", def: printing(CDM), owner: P2, zone: "play" },
    { key: "steal", def: steal, owner: P1, zone: "hand" }
  ]);
  play(b.engine, P1, b.id("steal"), { selected: { t: [b.id("theirs")] } });
  assert.equal(pending(b.engine)?.kind, "uniqueSurvivor", "two Machines under one player's control");
  assert.equal(pending(b.engine)?.playerId, P1);
});

clause(CDM, "0:unique", "a different UNIQUE designation (or none) is not a duplicate", () => {
  const b = cdmBoard([{ key: "other", def: item({ name: "OtherItem", unique: "other item" } as Partial<CardDefinition>), owner: P1, zone: "play" }]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("cdm")), "play");
  assert.equal(zoneOf(b.engine, b.id("other")), "play");
});

clause(CDM, "1:rule", "a character entering play makes ITS controller choose one of the three options (nothing happens until they do)", () => {
  const mine = cdmBoard([{ key: "c", def: freeChar("Mine"), owner: P1, zone: "hand" }]);
  play(mine.engine, P1, mine.id("c"));
  assert.equal(pending(mine.engine)?.kind, "chooserSelectsOption");
  assert.equal(pending(mine.engine)?.playerId, P1);
  assert.equal(pending(mine.engine)?.optionCount, 3);
  assert.equal(zoneOf(mine.engine, mine.id("c")), "play", "still in play while the choice is open");
  assert.equal(influenceOf(mine.engine, P1), 30);

  const theirs = cdmBoard([{ key: "c", def: freeChar("Theirs"), owner: P2, zone: "hand" }], { p2Turn: true });
  play(theirs.engine, P2, theirs.id("c"));
  assert.equal(pending(theirs.engine)?.kind, "chooserSelectsOption");
  assert.equal(pending(theirs.engine)?.playerId, P2, "the entering character's controller (not the Machine's) chooses");
  refused(() => chooseOptionAs(theirs.engine, P1, 1), "the Machine's controller can't answer for the opponent's character");
  assert.equal(zoneOf(theirs.engine, theirs.id("c")), "play");
});

clause(CDM, "1:rule", "the choice is mandatory: no option outside 1-3 is accepted and the choice stays open", () => {
  const b = cdmBoard([{ key: "c", def: freeChar("Mine"), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("c"));
  refused(() => chooseOptionAs(b.engine, P1, 3), "no fourth option");
  refused(() => chooseOptionAs(b.engine, P1, -1), "no negative option");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption", "the choice is still open");
  assert.equal(influenceOf(b.engine, P1), 30);
  assert.equal(zoneOf(b.engine, b.id("c")), "play");
});

clause(CDM, "1:rule", "it triggers however the character enters: put into play by an effect, or as a token", () => {
  const re = cdmBoard([
    { key: "dead", def: freeChar("Dead"), owner: P1, zone: "discard" },
    { key: "re", def: reanimateTactic(), owner: P1, zone: "hand" }
  ]);
  play(re.engine, P1, re.id("re"), { selected: { t: [re.id("dead")] } });
  assert.equal(zoneOf(re.engine, re.id("dead")), "play");
  assert.equal(pending(re.engine)?.kind, "chooserSelectsOption", "put into play by an effect");
  assert.equal(pending(re.engine)?.playerId, P1);

  const tok = cdmBoard([{ key: "mk", def: makeTokenTactic(), owner: P1, zone: "hand" }]);
  play(tok.engine, P1, tok.id("mk"));
  assert.equal(pending(tok.engine)?.kind, "chooserSelectsOption", "a character token entering play");
  assert.equal(pending(tok.engine)?.playerId, P1);
});

clause(CDM, "1:rule", "only characters entering play trigger it: an item or location entering doesn't", () => {
  const b = cdmBoard([
    { key: "it", def: item({ name: "AnItem", cost: 0 }), owner: P1, zone: "hand" },
    { key: "loc", def: location({ name: "ALoc", cost: 0 }), owner: P1, zone: "hand" }
  ]);
  play(b.engine, P1, b.id("it"));
  assert.equal(b.engine.state.pendingChoice, undefined, "an item entering");
  play(b.engine, P1, b.id("loc"));
  assert.equal(b.engine.state.pendingChoice, undefined, "a location entering");
  assert.equal(zoneOf(b.engine, b.id("it")), "play");
  assert.equal(zoneOf(b.engine, b.id("loc")), "play");
});

clause(CDM, "1:rule", "a Machine controlled by the opponent still makes the entering character's controller choose", () => {
  const b = cdmBoard([{ key: "c", def: freeChar("Mine"), owner: P1, zone: "hand" }, ...R(1, P1)], { controller: P2 });
  play(b.engine, P1, b.id("c"));
  assert.equal(pending(b.engine)?.playerId, P1);
  chooseOption(b.engine, 2);
  assert.equal(influenceOf(b.engine, P1), 27, "P1's faction (the character's controller) loses 3");
  assert.equal(influenceOf(b.engine, P2), 30);
});

clause(CDM, "1:rule", "does nothing while the Machine is not in play, and stops once it leaves play", () => {
  const inHand = cdmBoard([{ key: "c", def: freeChar("C"), owner: P1, zone: "hand" }], { zone: "hand" });
  play(inHand.engine, P1, inHand.id("c"));
  assert.equal(inHand.engine.state.pendingChoice, undefined, "Machine in hand");

  const inDiscard = cdmBoard([{ key: "c", def: freeChar("C"), owner: P1, zone: "hand" }], { zone: "discard" });
  play(inDiscard.engine, P1, inDiscard.id("c"));
  assert.equal(inDiscard.engine.state.pendingChoice, undefined, "Machine in the discard pile");

  const b = cdmBoard([
    { key: "c", def: freeChar("C"), owner: P1, zone: "hand" },
    { key: "c2", def: freeChar("C2"), owner: P1, zone: "hand" },
    { key: "brk", def: destroyItemTactic(), owner: P1, zone: "hand" }
  ]);
  play(b.engine, P1, b.id("c"));
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption", "control: with the Machine in play it triggers");
  chooseOption(b.engine, 2);
  play(b.engine, P1, b.id("brk"), { selected: { t: [b.id("cdm")] } });
  assert.equal(zoneOf(b.engine, b.id("cdm")), "discard");
  play(b.engine, P1, b.id("c2"));
  assert.equal(b.engine.state.pendingChoice, undefined, "after the Machine left play");
  assert.equal(zoneOf(b.engine, b.id("c2")), "play");
});

// ---- OPTION 1: put a resource they control into its owner's hand
clause(CDM, "2:option:OPTION 1", "the controller puts a resource they control into its owner's hand (face-up, spent, or face-down); nothing else moves", () => {
  const [upRes] = R(1, P1);
  const [spent] = spentResources(P1, 1);
  const [down] = volition(1, P1);
  for (const [label, res] of [["face-up", upRes], ["spent (attached)", spent], ["face-down", down]] as const) {
    const [theirs] = R(1, P2);
    const b = cdmBoard([upRes, spent, down, theirs, { key: "c", def: freeChar("Mine"), owner: P1, zone: "hand" }]);
    play(b.engine, P1, b.id("c"));
    chooseOption(b.engine, 0);
    assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", label);
    assert.equal(pending(b.engine)?.playerId, P1, label);
    answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id(res.key)] });
    assert.equal(b.engine.state.pendingChoice, undefined, label);
    assert.equal(zoneOf(b.engine, b.id(res.key)), "hand", `${label}: the resource goes to its owner's hand`);
    assert.ok(handOf(b.engine, P1).includes(b.id(res.key)), label);
    for (const other of [upRes, spent, down].filter((r) => r !== res)) assert.equal(zoneOf(b.engine, b.id(other.key)), "play", `${label}: only one resource moves`);
    assert.equal(zoneOf(b.engine, b.id(theirs.key)), "play", `${label}: the opponent's resource stays`);
    assert.equal(zoneOf(b.engine, b.id("c")), "play", `${label}: the character stays`);
    assert.equal(influenceOf(b.engine, P1), 30, `${label}: no influence lost`);
  }
});

clause(CDM, "2:option:OPTION 1", "only a resource THEY control: not the opponent's resources, not other card types", () => {
  const [mine] = R(1, P1);
  const [theirs] = R(1, P2);
  const [theirsDown] = volition(1, P2);
  const b = cdmBoard([
    mine,
    theirs,
    theirsDown,
    { key: "ally", def: freeChar("Ally"), owner: P1, zone: "play" },
    { key: "c", def: freeChar("Mine"), owner: P1, zone: "hand" }
  ]);
  play(b.engine, P1, b.id("c"));
  chooseOption(b.engine, 0);
  const attempt = (target: string) => () => answerPending(b.engine, "chooserSelectsTarget", { selected: [target] });
  refused(attempt(b.id(theirs.key)), "the opponent's resource");
  refused(attempt(b.id(theirsDown.key)), "the opponent's face-down resource");
  refused(attempt(b.id("ally")), "a character is not a resource");
  refused(attempt(b.id("cdm")), "an item is not a resource");
  assert.equal(zoneOf(b.engine, b.id(theirs.key)), "play");
  attempt(b.id(mine.key))();
  assert.equal(zoneOf(b.engine, b.id(mine.key)), "hand", "positive control");
});

clause(CDM, "2:option:OPTION 1", "when the opponent's character enters, the opponent puts one of THEIR resources into their hand", () => {
  const [mine] = R(1, P1);
  const [theirs] = R(1, P2);
  const b = cdmBoard([mine, theirs, { key: "c", def: freeChar("Theirs"), owner: P2, zone: "hand" }], { p2Turn: true });
  play(b.engine, P2, b.id("c"));
  chooseOptionAs(b.engine, P2, 0);
  assert.equal(pending(b.engine)?.playerId, P2);
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id(mine.key)] }), "the Machine's controller's resource");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id(theirs.key)] });
  assert.equal(zoneOf(b.engine, b.id(theirs.key)), "hand");
  assert.ok(handOf(b.engine, P2).includes(b.id(theirs.key)), "P2's hand");
  assert.equal(zoneOf(b.engine, b.id(mine.key)), "play", "P1's resource untouched");
});

clause(CDM, "2:option:OPTION 1", "a resource they control but don't own goes to its OWNER's hand", () => {
  const borrowed: CardPlacement = { ...R(1, P2)[0], controller: P1 };
  const b = cdmBoard([borrowed, { key: "c", def: freeChar("Mine"), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("c"));
  chooseOption(b.engine, 0);
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id(borrowed.key)] });
  assert.equal(zoneOf(b.engine, b.id(borrowed.key)), "hand");
  assert.ok(handOf(b.engine, P2).includes(b.id(borrowed.key)), "owner P2's hand");
  assert.equal(handOf(b.engine, P1).includes(b.id(borrowed.key)), false);
});

clause(CDM, "2:option:OPTION 1", "with no resource to put back the option can still be chosen and simply does nothing", () => {
  const b = cdmBoard([{ key: "c", def: freeChar("Mine"), owner: P1, zone: "hand" }, ...R(2, P2)]);
  play(b.engine, P1, b.id("c"));
  chooseOption(b.engine, 0);
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("c")), "play");
  assert.equal(influenceOf(b.engine, P1), 30);
  assert.equal(resourcesInPlay(b.engine, P2), 2, "the opponent's resources are untouched");
});

// ---- OPTION 2: destroy that character
clause(CDM, "3:option:OPTION 2", "destroys the entering character (to its owner's discard pile) and nothing else", () => {
  for (const [who, p2Turn] of [[P1, false], [P2, true]] as const) {
    const b = cdmBoard(
      [
        { key: "c", def: freeChar("Entering"), owner: who, zone: "hand" },
        { key: "mine", def: freeChar("MyBystander"), owner: P1, zone: "play" },
        { key: "theirs", def: freeChar("TheirBystander"), owner: P2, zone: "play" },
        ...R(2, P1),
        ...R(2, P2)
      ],
      { p2Turn }
    );
    play(b.engine, who, b.id("c"));
    chooseOptionAs(b.engine, who, 1);
    assert.equal(b.engine.state.pendingChoice, undefined, who);
    assert.equal(zoneOf(b.engine, b.id("c")), "discard", `${who}: that character is destroyed`);
    assert.equal(zoneOf(b.engine, b.id("mine")), "play");
    assert.equal(zoneOf(b.engine, b.id("theirs")), "play");
    assert.equal(zoneOf(b.engine, b.id("cdm")), "play", "the Machine stays");
    assert.equal(influenceOf(b.engine, P1), 30, `${who}: no influence lost`);
    assert.equal(influenceOf(b.engine, P2), 30);
    assert.equal(resourcesInPlay(b.engine, P1), 2, "no resource moved");
    assert.equal(resourcesInPlay(b.engine, P2), 2);
  }
});

// ---- OPTION 3: their faction loses 3 influence
clause(CDM, "4:option:OPTION 3", "the entering character's controller's faction loses 3 influence; the other faction doesn't; the character stays", () => {
  for (const [who, other, p2Turn] of [[P1, P2, false], [P2, P1, true]] as const) {
    const b = cdmBoard(
      [{ key: "c", def: freeChar("Entering"), owner: who, zone: "hand" }, ...R(1, P1), ...R(1, P2)],
      { p2Turn }
    );
    play(b.engine, who, b.id("c"));
    chooseOptionAs(b.engine, who, 2);
    assert.equal(b.engine.state.pendingChoice, undefined, who);
    assert.equal(influenceOf(b.engine, who), 27, `${who} loses exactly 3`);
    assert.equal(influenceOf(b.engine, other), 30, `${other} loses nothing`);
    assert.equal(zoneOf(b.engine, b.id("c")), "play", "the character stays");
    assert.equal(resourcesInPlay(b.engine, who), 1, "no resource moved");
  }
});

// =====================================================================
// Elementary Elemental
// =====================================================================
const EE = "42d337d5-bba5-48bb-be0a-ff19f295699a"; // character · cost 1 · [O] · 1/3/2 -- If this card is destroyed, put it into its owner's hand, then discard a card.

function eeBoard(extra: CardPlacement[] = [], opts: { faceDown?: boolean; owner?: PlayerId; controller?: PlayerId; noSpares?: boolean; p2Turn?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.p2Turn ? 2 : undefined,
    activePlayerId: opts.p2Turn ? P2 : undefined,
    cards: [
      { key: "ee", def: printing(EE), owner: opts.owner ?? P1, zone: "play", controller: opts.controller, faceDown: opts.faceDown },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      ...(opts.noSpares
        ? []
        : [
            { key: "s1", def: character({ name: "Spare1" }), owner: P1, zone: "hand" as const },
            { key: "s2", def: character({ name: "Spare2" }), owner: P1, zone: "hand" as const }
          ]),
      ...extra
    ]
  });
}
const killEE = (b: ReturnType<typeof eeBoard>) => play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("ee")] } });
const discardPick = (b: ReturnType<typeof eeBoard>, key: string) => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id(key)] });
const sendTactic = (name: string, effect: Record<string, unknown>): CardDefinition =>
  tactic({
    name,
    cost: 0,
    behavior: { abilities: [{ id: "x", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [effect as never] }] }
  });

clause(EE, "0:rule", "deploys for 1 with [O] and has the printed stats 1 / 3 / 2", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ee", def: printing(EE), owner: P1, zone: "hand" }, ...O(1)]
  });
  play(b.engine, P1, b.id("ee"));
  assert.equal(zoneOf(b.engine, b.id("ee")), "play");
  assert.equal(readyCount(b.engine, P1), 0, "paid exactly 1");
  assert.equal(b.engine.getStat(b.id("ee"), "strength"), 1);
  assert.equal(b.engine.getStat(b.id("ee"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("ee"), "life"), 2);
  const none = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "ee", def: printing(EE), owner: P1, zone: "hand" }] });
  refused(() => play(none.engine, P1, none.id("ee")), "no resource to pay with");
  const wrongIcon = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "ee", def: printing(EE), owner: P1, zone: "hand" }, ...R(1)] });
  refused(() => play(wrongIcon.engine, P1, wrongIcon.id("ee")), "no [O] for the threshold");
});

clause(EE, "0:rule", "when destroyed it goes into its owner's hand (not the discard pile), then its controller discards a card", () => {
  const b = eeBoard();
  killEE(b);
  assert.equal(zoneOf(b.engine, b.id("ee")), "hand", "put into its owner's hand");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "then discard a card");
  assert.equal(pending(b.engine)?.playerId, P1);
  discardPick(b, "s1");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("s1")), "discard", "the chosen card is discarded");
  assert.equal(zoneOf(b.engine, b.id("s2")), "hand", "only one card is discarded");
  assert.equal(zoneOf(b.engine, b.id("ee")), "hand", "the Elemental stays in hand");
  assert.deepEqual([...handOf(b.engine, P1)].sort(), [b.id("ee"), b.id("s2")].sort());
});

clause(EE, "0:rule", "the discard is mandatory, exactly one card from your hand; the returned Elemental is a legal choice", () => {
  const b = eeBoard([
    { key: "oh", def: character({ name: "OppHand" }), owner: P2, zone: "hand" },
    { key: "by", def: character({ name: "Bystander" }), owner: P1, zone: "play" },
    { key: "dd", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" }
  ]);
  killEE(b);
  const pick = (selected: string[]) => () => answerPending(b.engine, "chooserSelectsTarget", { selected });
  refused(pick([]), "discarding nothing");
  refused(pick([b.id("s1"), b.id("s2")]), "discarding two cards");
  refused(pick([b.id("oh")]), "the opponent's hand card");
  refused(pick([b.id("by")]), "a card in play");
  refused(pick([b.id("dd")]), "a card already in the discard pile");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the choice is still open");
  pick([b.id("ee")])();
  assert.equal(zoneOf(b.engine, b.id("ee")), "discard", "it may discard the Elemental itself");
  assert.equal(zoneOf(b.engine, b.id("s1")), "hand");
  assert.equal(zoneOf(b.engine, b.id("s2")), "hand");
  assert.equal(zoneOf(b.engine, b.id("oh")), "hand");
});

clause(EE, "0:rule", "with no other card in hand, the Elemental itself is discarded", () => {
  const b = eeBoard([], { noSpares: true });
  killEE(b);
  drain(b.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [b.id("ee")] } : declineAll(pc)));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("ee")), "discard");
  assert.equal(handOf(b.engine, P1).length, 0);
});

clause(EE, "0:rule", "lethal battle damage destroys it too: back to hand, then a discard", () => {
  const b = eeBoard(
    [{ key: "atk", def: character({ name: "Attacker", strength: 2, life: 3, speed: 1 }), owner: P2, zone: "play" }],
    { p2Turn: true }
  );
  fightThrough(b.engine, P2, [b.id("atk")], { type: "faction", playerId: P1 }, [b.id("ee")], undefined, (pc) =>
    pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [b.id("s1")] } : declineAll(pc)
  );
  assert.equal(zoneOf(b.engine, b.id("ee")), "hand", "destroyed by 2 damage on 2 life");
  assert.equal(zoneOf(b.engine, b.id("s1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("s2")), "hand");
});

clause(EE, "0:rule", "not triggered when it leaves play without being destroyed (returned to hand, removed from the game)", () => {
  const bounce = eeBoard([{ key: "bounce", def: sendTactic("Bounce", { type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }), owner: P1, zone: "hand" }]);
  play(bounce.engine, P1, bounce.id("bounce"), { selected: { t: [bounce.id("ee")] } });
  assert.equal(zoneOf(bounce.engine, bounce.id("ee")), "hand");
  assert.equal(bounce.engine.state.pendingChoice, undefined, "no discard prompt");
  assert.equal(zoneOf(bounce.engine, bounce.id("s1")), "hand");
  assert.equal(zoneOf(bounce.engine, bounce.id("s2")), "hand");

  const exile = eeBoard([{ key: "exile", def: sendTactic("Exile", { type: "removeFromGame", target: { type: "selected", id: "t" } }), owner: P1, zone: "hand" }]);
  play(exile.engine, P1, exile.id("exile"), { selected: { t: [exile.id("ee")] } });
  assert.equal(zoneOf(exile.engine, exile.id("ee")), "removed");
  assert.equal(exile.engine.state.pendingChoice, undefined, "no discard prompt");
  assert.equal(zoneOf(exile.engine, exile.id("s1")), "hand");
});

clause(EE, "0:rule", "only when THIS card is destroyed: another character's destruction does nothing", () => {
  const b = eeBoard([{ key: "other", def: character({ name: "Other" }), owner: P2, zone: "play" }]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("other")] } });
  assert.equal(zoneOf(b.engine, b.id("other")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("ee")), "play");
  assert.equal(zoneOf(b.engine, b.id("s1")), "hand");
});

clause(EE, "0:rule", "a face-down Elemental has no rules text: destroyed, it just goes to the discard pile", () => {
  const killResource = tactic({
    name: "KillResource",
    cost: 0,
    behavior: { abilities: [{ id: "kr", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "resource" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const b = eeBoard([{ key: "kr", def: killResource, owner: P1, zone: "hand" }], { faceDown: true });
  play(b.engine, P1, b.id("kr"), { selected: { t: [b.id("ee")] } });
  assert.equal(zoneOf(b.engine, b.id("ee")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined, "no trigger from a face-down card");
  assert.equal(zoneOf(b.engine, b.id("s1")), "hand");
});

clause(EE, "0:rule", "if you control but don't own it: it goes to its OWNER's hand and YOU discard from your hand", () => {
  const b = eeBoard([{ key: "p2h", def: character({ name: "P2Hand" }), owner: P2, zone: "hand" }], { owner: P2, controller: P1 });
  killEE(b);
  assert.ok(handOf(b.engine, P2).includes(b.id("ee")), "back to its owner's (P2's) hand");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(b.engine)?.playerId, P1, "its controller discards");
  discardPick(b, "s1");
  assert.equal(zoneOf(b.engine, b.id("s1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("p2h")), "hand", "the owner's hand loses nothing");
  assert.equal(zoneOf(b.engine, b.id("ee")), "hand");
});

// =====================================================================
// Expedition Endeavour
// =====================================================================
const EXP = "e0a7e6af-da4e-4442-ade8-d1b0547deb11"; // tactic · cost 3 · [O][O] -- Choose one of the following as this card's rules text: OPTION 1 / OPTION 2 / OPTION 3

function seededRandom(): () => number {
  let s = 12345;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function expBoard(extra: CardPlacement[] = [], opts: { pay?: CardPlacement[]; random?: () => number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: opts.random,
    cards: [{ key: "ex", def: printing(EXP), owner: P1, zone: "hand" }, ...(opts.pay ?? O(3)), ...extra]
  });
}
type ExpBoard = ReturnType<typeof expBoard>;
const attachedIds = (engine: Eng, p: PlayerId): string[] =>
  engine.state.players[p].play.filter((c) => engine.isResource(c) && engine.state.cards[c].attachedTo === engine.state.players[p].factionId) as unknown as string[];
const revealed = (engine: Eng): Array<{ cardIds: string[] }> =>
  engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed").map((entry) => entry.event as unknown as { cardIds: string[] });
const answerTargets = (b: ExpBoard, selected: string[]) => answerPending(b.engine, "chooserSelectsTarget", { selected });

// Mode 0 (OPTION 1)
const searchDeck = (): CardPlacement[] => [
  { key: "arc", def: character({ name: "ArcChar", trade: "arcanist" }), owner: P1, zone: "deck" },
  { key: "arc2", def: character({ name: "ArcChar2", trade: "arcanist" }), owner: P1, zone: "deck" },
  { key: "war", def: character({ name: "WarChar", trade: "warlord" }), owner: P1, zone: "deck" },
  { key: "arcItem", def: item({ name: "ArcItem", trade: "arcanist" }), owner: P1, zone: "deck" },
  ...fillers("f", 8, P1, "deck"),
  { key: "oarc", def: character({ name: "OppArc", trade: "arcanist" }), owner: P2, zone: "deck" },
  { key: "harc", def: character({ name: "HandArc", trade: "arcanist" }), owner: P1, zone: "hand" }
];
const noOppDetach = (pc: { kind: string; [k: string]: unknown }) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [] } : declineAll(pc as never));

clause(EXP, "0:rule", "choosing a mode: an unknown mode is refused and nothing is paid", () => {
  const b = expBoard([{ key: "t", def: character({ name: "T" }), owner: P1, zone: "play" }]);
  refused(() => play(b.engine, P1, b.id("ex"), { mode: 3, selected: {} }), "no fourth mode");
  refused(() => play(b.engine, P1, b.id("ex"), { mode: -1, selected: {} }), "no negative mode");
  assert.equal(zoneOf(b.engine, b.id("ex")), "hand");
  assert.equal(readyCount(b.engine, P1), 3, "nothing paid");
});

clause(EXP, "0:rule", "every mode costs 3 and needs [O][O]; the chosen mode's cost is part of it", () => {
  const cast = (b: ExpBoard, mode: number) =>
    playRaw(b.engine, P1, b.id("ex"), mode === 0 ? { mode, selected: {} } : mode === 1 ? { mode, variables: { x: 0 }, selected: {} } : { mode, selected: { ch: [b.id("t")] } });
  const target = (): CardPlacement => ({ key: "t", def: character({ name: "T" }), owner: P1, zone: "play" });
  for (const mode of [0, 1, 2]) {
    const ok = expBoard([target()]);
    cast(ok, mode);
    assert.equal(readyCount(ok.engine, P1), 0, `mode ${mode}: paid exactly 3`);
    const short = expBoard([target()], { pay: O(2) });
    refused(() => cast(short, mode), `mode ${mode}: one resource short of 3`);
    const noIcons = expBoard([target()], { pay: [...O(1), ...R(2)] });
    refused(() => cast(noIcons, mode), `mode ${mode}: only one [O] for the [O][O] threshold`);
  }
});

clause(EXP, "1:option:OPTION 1", "may search your deck for an Arcanist character, reveal it, and put it into your hand", () => {
  const b = expBoard(searchDeck(), { random: seededRandom() });
  const handBefore = [...handOf(b.engine, P1)];
  play(b.engine, P1, b.id("ex"), { mode: 0, selected: { c: [b.id("arc")] } });
  drain(b.engine, noOppDetach);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("arc")), "hand");
  assert.deepEqual([...handOf(b.engine, P1)].sort(), [...handBefore.filter((c) => c !== b.id("ex")), b.id("arc")].sort(), "only the found card joins the hand");
  assert.deepEqual(revealed(b.engine).map((r) => r.cardIds), [[b.id("arc")]], "the found card is revealed");
  assert.equal(zoneOf(b.engine, b.id("arc2")), "deck", "only one card is taken");
  assert.equal(zoneOf(b.engine, b.id("ex")), "discard");
});

clause(EXP, "1:option:OPTION 1", "the search takes only an Arcanist CHARACTER from YOUR DECK", () => {
  const b = expBoard(searchDeck());
  const attempt = (target: string) => () => play(b.engine, P1, b.id("ex"), { mode: 0, selected: { c: [target] } });
  refused(attempt(b.id("war")), "a non-Arcanist character");
  refused(attempt(b.id("arcItem")), "an Arcanist item");
  refused(attempt(b.id("oarc")), "a card in the opponent's deck");
  refused(attempt(b.id("harc")), "a card in your hand");
  refused(attempt(b.id("f0")), "a plain filler character");
  refused(() => play(b.engine, P1, b.id("ex"), { mode: 0, selected: { c: [b.id("arc"), b.id("arc2")] } }), "two cards: a search finds an Arcanist character, not two");
  assert.equal(zoneOf(b.engine, b.id("ex")), "hand");
  attempt(b.id("arc2"))();
  drain(b.engine, noOppDetach);
  assert.equal(zoneOf(b.engine, b.id("arc2")), "hand", "positive control: any Arcanist character in the deck");
});

clause(EXP, "1:option:OPTION 1", "declining the search finds nothing (no reveal) but the deck is still shuffled", () => {
  const b = expBoard(searchDeck(), { random: seededRandom() });
  const deckBefore = [...b.engine.state.players[P1].deck];
  play(b.engine, P1, b.id("ex"), { mode: 0, selected: {} });
  drain(b.engine, noOppDetach);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("arc")), "deck");
  assert.equal(zoneOf(b.engine, b.id("harc")), "hand");
  assert.equal(revealed(b.engine).length, 0, "nothing revealed");
  assert.equal(b.engine.state.players[P1].deck.length, deckBefore.length);
  assert.notDeepEqual(b.engine.state.players[P1].deck, deckBefore, "searching a deck shuffles it (CR 312.1)");
  assert.deepEqual([...b.engine.state.players[P1].deck].sort(), [...deckBefore].sort(), "same cards");
});

clause(EXP, "1:option:OPTION 1", "with no Arcanist character in the deck the search fails, the tactic still resolves, and the deck is shuffled", () => {
  const b = expBoard([...fillers("f", 10, P1, "deck")], { random: seededRandom() });
  const deckBefore = [...b.engine.state.players[P1].deck];
  play(b.engine, P1, b.id("ex"), { mode: 0, selected: {} });
  drain(b.engine, noOppDetach);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("ex")), "discard", "it resolved");
  assert.equal(handOf(b.engine, P1).length, 0, "nothing found");
  assert.notDeepEqual(b.engine.state.players[P1].deck, deckBefore, "a failed search still shuffles the deck (CR 312.1)");
});

clause(EXP, "1:option:OPTION 1", "the opponent may detach up to 3 of their (attached) resources: 0, 1, 2 or 3, nobody else's", () => {
  for (const n of [0, 1, 2, 3]) {
    const theirs = spentResources(P2, 5);
    const b = expBoard([...theirs, ...spentResources(P1, 2)]);
    play(b.engine, P1, b.id("ex"), { mode: 0, selected: {} });
    assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", `n=${n}`);
    assert.equal(pending(b.engine)?.playerId, P2, `n=${n}: the opponent decides`);
    // E3c: the opponent is asked as the tactic is played, before its own numeric cost of 3 is paid (paid last).
    const mineBefore = attachedIds(b.engine, P1).length + 3;
    answerTargets(b, theirs.slice(0, n).map((r) => b.id(r.key)));
    assert.equal(b.engine.state.pendingChoice, undefined, `n=${n}`);
    assert.equal(attachedIds(b.engine, P2).length, 5 - n, `n=${n}: exactly ${n} detached`);
    for (const r of theirs.slice(0, n)) assert.equal(b.engine.state.cards[b.id(r.key)].attachedTo, undefined, `n=${n}: the chosen ones are detached`);
    assert.equal(attachedIds(b.engine, P1).length, mineBefore, `n=${n}: the caster's resources are untouched`);
    assert.equal(zoneOf(b.engine, b.id("ex")), "discard");
  }
});

clause(EXP, "1:option:OPTION 1", "the opponent can't detach more than 3, nor the caster's resources, nor an unattached or non-resource card", () => {
  const theirs = spentResources(P2, 5);
  const mine = spentResources(P1, 2);
  const [theirsFree] = R(1, P2);
  const b = expBoard([...theirs, ...mine, theirsFree, { key: "oc", def: character({ name: "OppChar" }), owner: P2, zone: "play" }]);
  play(b.engine, P1, b.id("ex"), { mode: 0, selected: {} });
  refused(() => answerTargets(b, theirs.slice(0, 4).map((r) => b.id(r.key))), "4 resources");
  refused(() => answerTargets(b, [b.id(mine[0].key)]), "the caster's attached resource");
  refused(() => answerTargets(b, [b.id("oc")]), "a character");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still open");
  answerTargets(b, theirs.slice(0, 3).map((r) => b.id(r.key)));
  assert.equal(attachedIds(b.engine, P2).length, 2, "positive control");
});

clause(EXP, "1:option:OPTION 1", "a resource that is not attached to the faction can't be detached, so it can't be one of the opponent's picks", () => {
  const theirs = spentResources(P2, 2);
  const [free] = R(1, P2);
  const b = expBoard([...theirs, free]);
  play(b.engine, P1, b.id("ex"), { mode: 0, selected: {} });
  refused(() => answerTargets(b, [b.id(free.key)]), "an unattached resource has nothing to detach from");
  answerTargets(b, [b.id(theirs[0].key)]);
  assert.equal(attachedIds(b.engine, P2).length, 1, "positive control: an attached one can be detached");
});

clause(EXP, "1:option:OPTION 1", "the opponent's detach is a COST: it is chosen and done as the tactic is played, before it resolves", () => {
  const theirs = spentResources(P2, 3);
  const b = expBoard([...theirs, ...searchDeck()]);
  playRaw(b.engine, P1, b.id("ex"), { mode: 0, selected: { c: [b.id("arc")] } });
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the opponent is asked while the tactic is being played");
  assert.equal(pending(b.engine)?.playerId, P2);
  assert.equal(zoneOf(b.engine, b.id("arc")), "deck", "the search hasn't happened yet");
  b.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [b.id(theirs[0].key)] } } as never);
  assert.equal(b.engine.state.cards[b.id(theirs[0].key)].attachedTo, undefined, "detached as a cost");
  assert.equal(zoneOf(b.engine, b.id("arc")), "deck", "the effect (search) hasn't resolved yet");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("arc")), "hand");
});

// Mode 1 (OPTION 2): choose X, deplete X characters you control, detach X+3 resources from your faction
function xBoard(opts: { spent?: number; pay?: CardPlacement[] } = {}) {
  const mySpent = spentResources(P1, opts.spent ?? 5);
  const theirSpent = spentResources(P2, 4);
  const [free] = R(1, P1);
  const [inert] = R(1, P2);
  const b = expBoard(
    [
      ...mySpent,
      ...theirSpent,
      free,
      inert,
      { key: "c1", def: character({ name: "C1" }), owner: P1, zone: "play" },
      { key: "c2", def: character({ name: "C2" }), owner: P1, zone: "play" },
      { key: "c3", def: character({ name: "C3" }), owner: P1, zone: "play" },
      { key: "dep", def: character({ name: "AlreadyDepleted" }), owner: P1, zone: "play", depleted: true },
      { key: "oc", def: character({ name: "OppChar" }), owner: P2, zone: "play" },
      { key: "it", def: item({ name: "AnItem" }), owner: P1, zone: "play" }
    ],
    { pay: opts.pay }
  );
  return { b, mySpent, theirSpent, free, inert };
}
const castX = (b: ExpBoard, x: number, dep: string[] = []) => play(b.engine, P1, b.id("ex"), { mode: 1, variables: { x }, selected: { dep } });
const isDepleted = (b: ExpBoard, key: string): boolean => b.engine.state.cards[b.id(key)].depleted === true;

clause(EXP, "2:option:OPTION 2", "X=0: no characters are depleted and exactly 3 of your attached resources are detached (the ones just paid are legal choices)", () => {
  const { b, mySpent, theirSpent } = xBoard();
  castX(b, 0);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(b.engine)?.playerId, P1, "you choose which");
  assert.equal(attachedIds(b.engine, P1).length, 8, "5 spent + 3 just paid");
  for (const k of ["c1", "c2", "c3", "oc"]) assert.equal(isDepleted(b, k), false, `${k} not depleted`);
  const chosen = mySpent.slice(0, 3).map((r) => b.id(r.key));
  answerTargets(b, chosen);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(attachedIds(b.engine, P1).length, 5, "exactly 3 detached");
  for (const c of chosen) assert.equal(b.engine.state.cards[c].attachedTo, undefined);
  assert.equal(attachedIds(b.engine, P2).length, theirSpent.length, "the opponent's resources stay attached");
  assert.equal(zoneOf(b.engine, b.id("ex")), "discard");

  const paid = xBoard({ spent: 0 });
  castX(paid.b, 0);
  const justPaid = attachedIds(paid.b.engine, P1);
  assert.equal(justPaid.length, 3);
  answerTargets(paid.b, justPaid);
  assert.equal(attachedIds(paid.b.engine, P1).length, 0, "the three resources paid for this tactic can be detached again");
});

clause(EXP, "2:option:OPTION 2", "X=1 and X=2: exactly X chosen characters you control are depleted (as a cost, when the tactic is played)", () => {
  for (const x of [0, 1, 2]) {
    const { b } = xBoard();
    const dep = ["c1", "c2"].slice(0, x);
    playRaw(b.engine, P1, b.id("ex"), { mode: 1, variables: { x }, selected: { dep: dep.map((k) => b.id(k)) } });
    for (const k of dep) assert.equal(isDepleted(b, k), true, `X=${x}: ${k} is depleted`);
    for (const k of ["c1", "c2", "c3"].filter((k) => !dep.includes(k))) assert.equal(isDepleted(b, k), false, `X=${x}: ${k} is not`);
    assert.equal(isDepleted(b, "oc"), false, `X=${x}: the opponent's character is not`);
    assert.equal(readyCount(b.engine, P1), 1, `X=${x}: paid 3 of the 4 unattached resources`);
  }
});

clause(EXP, "2:option:OPTION 2", "X=1 and X=2: X+3 resources are detached after depleting X characters", () => {
  for (const x of [1, 2]) {
    const { b, mySpent } = xBoard();
    const dep = ["c1", "c2"].slice(0, x);
    castX(b, x, dep.map((k) => b.id(k)));
    for (const k of dep) assert.equal(isDepleted(b, k), true, `X=${x}: ${k} is depleted`);
    for (const k of ["c1", "c2", "c3"].filter((k) => !dep.includes(k))) assert.equal(isDepleted(b, k), false, `X=${x}: ${k} is not`);
    assert.equal(isDepleted(b, "oc"), false);
    assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", `X=${x}`);
    const chosen = mySpent.slice(0, x + 3).map((r) => b.id(r.key));
    answerTargets(b, chosen);
    assert.equal(b.engine.state.pendingChoice, undefined, `X=${x}`);
    assert.equal(attachedIds(b.engine, P1).length, 8 - (x + 3), `X=${x}: exactly ${x + 3} detached`);
    for (const c of chosen) assert.equal(b.engine.state.cards[c].attachedTo, undefined, `X=${x}`);
  }
});

clause(EXP, "2:option:OPTION 2", "exactly X+3 must be detached: fewer or more is refused", () => {
  const { b, mySpent } = xBoard();
  castX(b, 1, [b.id("c1")]);
  refused(() => answerTargets(b, mySpent.slice(0, 3).map((r) => b.id(r.key))), "3 of the required 4");
  refused(() => answerTargets(b, []), "none of the required 4");
  refused(() => answerTargets(b, mySpent.slice(0, 5).map((r) => b.id(r.key))), "5 where 4 are required");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the choice is still open");
  assert.equal(attachedIds(b.engine, P1).length, 8);
  answerTargets(b, mySpent.slice(0, 4).map((r) => b.id(r.key)));
  assert.equal(attachedIds(b.engine, P1).length, 4, "positive control");
});

clause(EXP, "2:option:OPTION 2", "only resources attached to YOUR faction can be detached", () => {
  const { b, theirSpent, free, inert, mySpent } = xBoard();
  castX(b, 0);
  const attempt = (ids: string[]) => () => answerTargets(b, ids);
  refused(attempt([b.id(theirSpent[0].key), b.id(mySpent[0].key), b.id(mySpent[1].key)]), "the opponent's attached resource");
  refused(attempt([b.id(free.key), b.id(mySpent[0].key), b.id(mySpent[1].key)]), "an unattached resource");
  refused(attempt([b.id(inert.key), b.id(mySpent[0].key), b.id(mySpent[1].key)]), "the opponent's unattached resource");
  refused(attempt([b.id("c1"), b.id(mySpent[0].key), b.id(mySpent[1].key)]), "a character");
  assert.equal(attachedIds(b.engine, P2).length, theirSpent.length);
  attempt(mySpent.slice(0, 3).map((r) => b.id(r.key)))();
  assert.equal(attachedIds(b.engine, P1).length, 5, "positive control");
});

clause(EXP, "2:option:OPTION 2", "with fewer than X+3 attached resources, all of them are detached", () => {
  const { b } = xBoard({ spent: 0 });
  castX(b, 1, [b.id("c1")]);
  const attached = attachedIds(b.engine, P1);
  assert.equal(attached.length, 3, "only the 3 just paid");
  answerTargets(b, attached);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(attachedIds(b.engine, P1).length, 0, "all three detached though 4 were asked for");
  assert.equal(isDepleted(b, "c1"), true);
});

clause(EXP, "2:option:OPTION 2", "COST: X characters you control must exist, be undepleted, be characters, and be exactly X", () => {
  const { b } = xBoard();
  const cast = (x: number, dep: string[]) => () => play(b.engine, P1, b.id("ex"), { mode: 1, variables: { x }, selected: { dep: dep.map((k) => b.id(k)) } });
  refused(cast(1, ["oc"]), "the opponent's character");
  refused(cast(1, ["dep"]), "an already-depleted character");
  refused(cast(1, ["it"]), "an item");
  refused(cast(1, []), "X=1 with nothing to deplete");
  refused(cast(2, ["c1"]), "X=2 with only one chosen");
  refused(cast(1, ["c1", "c2"]), "X=1 with two chosen");
  refused(cast(1, ["c1", "c1"]), "the same character twice");
  assert.equal(zoneOf(b.engine, b.id("ex")), "hand", "nothing was played");
  assert.equal(readyCount(b.engine, P1), 4, "nothing paid: 3 O + 1 spare rage");
  assert.equal(isDepleted(b, "c1"), false);
  cast(1, ["c1"])();
  assert.equal(isDepleted(b, "c1"), true, "positive control");
});

clause(EXP, "2:option:OPTION 2", "X can't be more than the characters you can deplete, and must be a whole non-negative number", () => {
  const few = expBoard([{ key: "c1", def: character({ name: "C1" }), owner: P1, zone: "play" }, ...spentResources(P1, 5)]);
  refused(() => play(few.engine, P1, few.id("ex"), { mode: 1, variables: { x: 2 }, selected: { dep: [few.id("c1")] } }), "X=2 with a single character");
  const { b } = xBoard();
  refused(() => castX(b, -1), "negative X");
  refused(() => castX(b, 0.5, [b.id("c1")]), "fractional X");
  assert.equal(zoneOf(b.engine, b.id("ex")), "hand");
  assert.equal(isDepleted(b, "c1"), false);
});

clause(EXP, "2:option:OPTION 2", "the deplete cost is paid as the tactic is played, before it resolves", () => {
  const { b } = xBoard();
  playRaw(b.engine, P1, b.id("ex"), { mode: 1, variables: { x: 1 }, selected: { dep: [b.id("c1")] } });
  assert.equal(isDepleted(b, "c1"), true, "depleted as a cost");
  assert.equal(attachedIds(b.engine, P1).length, 8, "the 3 resources are paid");
  assert.equal(b.engine.state.pendingChoice, undefined, "no prompt while the tactic waits to resolve");
  resolvePendingResponses(b.engine);
  // The detach of X+3 resources is mandatory: it asks for exactly 4 attached resources when the tactic resolves.
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the detach pick is offered at resolution");
  answerTargets(b, attachedIds(b.engine, P1).slice(0, 4));
  assert.equal(zoneOf(b.engine, b.id("ex")), "discard", "resolved");
  assert.equal(isDepleted(b, "c1"), true);
});

// Mode 2 (OPTION 3): pick a character; this turn it gains COVERT
clause(EXP, "3:option:OPTION 3", "the picked character (yours or the opponent's) gains COVERT this turn; no other character does; the other modes don't happen", () => {
  for (const [label, owner] of [["own", P1], ["opponent's", P2]] as const) {
    const theirs = spentResources(P2, 3);
    const b = expBoard([
      { key: "t", def: character({ name: "Target" }), owner, zone: "play" },
      { key: "mine", def: character({ name: "MyOther" }), owner: P1, zone: "play" },
      { key: "theirsOther", def: character({ name: "TheirOther" }), owner: P2, zone: "play" },
      ...theirs,
      ...searchDeck()
    ]);
    assert.equal(kws(b.engine, b.id("t")).includes("covert"), false, `${label}: control, no COVERT yet`);
    play(b.engine, P1, b.id("ex"), { mode: 2, selected: { ch: [b.id("t")] } });
    assert.equal(b.engine.state.pendingChoice, undefined, `${label}: nothing to answer`);
    assert.equal(kws(b.engine, b.id("t")).includes("covert"), true, `${label}: the picked character has COVERT`);
    assert.equal(kws(b.engine, b.id("mine")).includes("covert"), false);
    assert.equal(kws(b.engine, b.id("theirsOther")).includes("covert"), false);
    assert.equal(attachedIds(b.engine, P2).length, 3, "OPTION 1 (opponent detaches) did not happen");
    assert.equal(zoneOf(b.engine, b.id("arc")), "deck", "OPTION 1 (search) did not happen");
    assert.equal(b.engine.state.cards[b.id("mine")].depleted, false, "OPTION 2 (deplete) did not happen");
    assert.equal(zoneOf(b.engine, b.id("ex")), "discard");
  }
});

clause(EXP, "3:option:OPTION 3", "COVERT lasts this turn only", () => {
  const b = expBoard([{ key: "t", def: character({ name: "Target" }), owner: P1, zone: "play" }]);
  play(b.engine, P1, b.id("ex"), { mode: 2, selected: { ch: [b.id("t")] } });
  assert.equal(kws(b.engine, b.id("t")).includes("covert"), true);
  endTurn(b.engine, P1);
  assert.equal(kws(b.engine, b.id("t")).includes("covert"), false, "gone at end of turn");
  assert.equal(zoneOf(b.engine, b.id("t")), "play");
});

clause(EXP, "3:option:OPTION 3", "the granted COVERT works in battle: a non-covert character can't block the party", () => {
  const board = (grant: boolean) => {
    const b = expBoard([
      { key: "atk", def: character({ name: "Attacker" }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Plain" }), owner: P2, zone: "play" }
    ]);
    if (grant) play(b.engine, P1, b.id("ex"), { mode: 2, selected: { ch: [b.id("atk")] } });
    declareAttackBy(b.engine, P1, [b.id("atk")]);
    return b;
  };
  const covert = board(true);
  refused(() => covert.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [covert.id("blk")] }), "a non-covert character can't block a covert party");
  const plain = board(false);
  plain.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [plain.id("blk")] });
  assert.deepEqual(plain.engine.state.battle?.blockingParty, [plain.id("blk")], "control: without the tactic it can be blocked");
});

clause(EXP, "3:option:OPTION 3", "only a character in play can be picked", () => {
  const [downRes] = volition(1, P2);
  const [upRes] = R(1, P2);
  const b = expBoard([
    { key: "t", def: character({ name: "Target" }), owner: P2, zone: "play" },
    { key: "it", def: item({ name: "AnItem" }), owner: P2, zone: "play" },
    { key: "loc", def: location({ name: "ALoc" }), owner: P2, zone: "play" },
    downRes,
    upRes,
    { key: "inHand", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
    { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" }
  ]);
  const attempt = (target: string) => () => play(b.engine, P1, b.id("ex"), { mode: 2, selected: { ch: [target] } });
  refused(attempt(b.id("it")), "an item");
  refused(attempt(b.id("loc")), "a location");
  refused(attempt(b.id(upRes.key)), "a resource");
  refused(attempt(b.id(downRes.key)), "a face-down card is a resource");
  refused(attempt(factionIdOf(b.engine, P2)), "a faction");
  refused(attempt(b.id("inHand")), "a character in hand");
  refused(attempt(b.id("inDiscard")), "a character in the discard pile");
  refused(() => play(b.engine, P1, b.id("ex"), { mode: 2, selected: {} }), "the pick is required");
  assert.equal(zoneOf(b.engine, b.id("ex")), "hand", "nothing was played");
  attempt(b.id("t"))();
  assert.equal(kws(b.engine, b.id("t")).includes("covert"), true, "positive control");
});

// =====================================================================
// T3c9 mutation pass: printed card fields, exact thresholds, and a few durations / selectors the first pass left open
// =====================================================================
clause(IMP, "0:ability:imp-obsess", "(T3c9) printed: an arcanist familiar character costing 3 with threshold [O]; one [O] plus two Rage is enough", () => {
  const p = printing(IMP);
  assert.deepEqual([p.type, p.trade, p.subtype, p.cost, p.threshold], ["character", "arcanist", ["familiar"], 3, "o"]);
  const b = impBoard([...O(1), ...R(2)], { zone: "hand" });
  play(b.engine, P1, b.id("imp"));
  assert.equal(zoneOf(b.engine, b.id("imp")), "play", "a single [O] meets the threshold");
  assert.equal(readyCount(b.engine, P1), 0, "paid exactly 3");
});

clause(IMP, "0:ability:imp-obsess", "(T3c9) the PROVIDES lasts the whole turn, not just one battle", () => {
  const { engine, id } = impBoard([...O(3)]);
  activate(engine, P1, id("imp"), "imp-obsess");
  assert.equal(obsessionIcons(engine, P1), 6);
  fightThrough(engine, P1, [id("imp")], { type: "faction", playerId: P2 }, []);
  assert.equal(engine.state.battle, undefined, "the battle is over");
  assert.equal(obsessionIcons(engine, P1), 6, "still +3 [O] after the battle");
});

clause(CONC, "0:ability", "(T3c9) printed: an arcanist tactic costing 5 with threshold [O][O][O]; exactly three [O] plus two Rage is enough", () => {
  const p = printing(CONC);
  assert.deepEqual([p.type, p.trade, p.cost, p.threshold], ["tactic", "arcanist", 5, "ooo"]);
  const b = concBoard([{ key: "v", def: character({ name: "V" }), owner: P2, zone: "play" }, ...R(2)], { obs: 3 });
  play(b.engine, P1, b.id("cc"), { selected: { c: [b.id("v")] } });
  assert.equal(zoneOf(b.engine, b.id("cc")), "discard", "three [O] meet the threshold");
  assert.equal(readyCount(b.engine, P1), 0, "paid exactly 5");
});

clause(CDM, "0:unique", "(T3c9) printed: an arcanist item costing 5 with threshold [O][O]; exactly two [O] plus three Rage is enough", () => {
  const p = printing(CDM);
  assert.deepEqual([p.type, p.trade, p.cost, p.threshold], ["item", "arcanist", 5, "oo"]);
  const b = cdmBoard([...O(2), ...R(3)], { zone: "hand" });
  play(b.engine, P1, b.id("cdm"));
  assert.equal(zoneOf(b.engine, b.id("cdm")), "play", "two [O] meet the threshold");
  assert.equal(readyCount(b.engine, P1), 0, "paid exactly 5");
});

clause(CDM, "0:unique", "(T3c9) the designation is CONTIGUOUS DEFALCATING MACHINE: any other card with that designation conflicts with it", () => {
  const twin = item({ name: "Twin", cost: 0, unique: "contiguous defalcating machine" } as Partial<CardDefinition>);
  const b = cdmBoard([{ key: "twin", def: twin, owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("twin"));
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] } | undefined;
  assert.equal(pc?.kind, "uniqueSurvivor", "a card with the same UNIQUE designation is a duplicate");
  assert.deepEqual([...pc!.candidates].sort(), [b.id("cdm"), b.id("twin")].sort());
});

clause(CDM, "2:option:OPTION 1", "(T3c9) exactly one resource IN PLAY moves: a resource card in hand or discard, an item, and a second resource are refused", () => {
  for (const side of ["mine", "theirs"] as const) {
    const owner = side === "mine" ? P1 : P2;
    const [r1, r2] = [R(1, owner)[0], { ...R(1, owner)[0], key: "r2" }];
    const asHand = { ...R(1, owner)[0], key: "rh", zone: "hand" as const };
    const asDiscard = { ...R(1, owner)[0], key: "rd", zone: "discard" as const };
    const b = cdmBoard(
      [r1, r2, asHand, asDiscard, { key: "c", def: freeChar("Entering"), owner, zone: "hand" }, { key: "it", def: item({ name: "AnItem" }), owner, zone: "play" }],
      { p2Turn: owner === P2 }
    );
    play(b.engine, owner, b.id("c"));
    chooseOptionAs(b.engine, owner, 0);
    const attempt = (keys: string[]) => () => answerPending(b.engine, "chooserSelectsTarget", { selected: keys.map((k) => b.id(k)) });
    refused(attempt(["rh"]), `${side}: a resource card in hand is not a resource they control`);
    refused(attempt(["rd"]), `${side}: a resource card in the discard pile`);
    refused(attempt(["it"]), `${side}: an item in play`);
    refused(attempt([r1.key, "r2"]), `${side}: two resources`);
    assert.equal(zoneOf(b.engine, b.id(r1.key)), "play", `${side}: nothing moved yet`);
    attempt([r1.key])();
    assert.equal(zoneOf(b.engine, b.id(r1.key)), "hand", `${side}: the picked resource returns to its owner's hand`);
    assert.equal(zoneOf(b.engine, b.id("r2")), "play", `${side}: the other resource stays`);
  }
});

clause(EE, "0:rule", "(T3c9) printed: an arcanist lurker character costing 1 with threshold [O]", () => {
  const p = printing(EE);
  assert.deepEqual([p.type, p.trade, p.subtype, p.cost, p.threshold], ["character", "arcanist", ["lurker"], 1, "o"]);
});

clause(EXP, "0:rule", "(T3c9) printed: an arcanist tactic costing 3 with threshold [O][O]; two [O] plus a Rage pays for every mode", () => {
  const p = printing(EXP);
  assert.deepEqual([p.type, p.trade, p.cost, p.threshold], ["tactic", "arcanist", 3, "oo"]);
  for (const mode of [0, 1, 2]) {
    const b = expBoard([{ key: "t", def: character({ name: "T" }), owner: P1, zone: "play" }], { pay: [...O(2), ...R(1)] });
    const opts: { mode: number; variables?: Record<string, number>; selected: Record<string, string[]> } =
      mode === 0 ? { mode, selected: {} } : mode === 1 ? { mode, variables: { x: 0 }, selected: {} } : { mode, selected: { ch: [b.id("t")] } };
    playRaw(b.engine, P1, b.id("ex"), opts);
    assert.equal(readyCount(b.engine, P1), 0, `mode ${mode}: two [O] meet the threshold and exactly 3 is paid`);
  }
});

clause(EXP, "2:option:OPTION 2", "(T3c9) only characters IN PLAY can be depleted: a character in hand is refused", () => {
  const b = expBoard([
    { key: "c1", def: character({ name: "C1" }), owner: P1, zone: "play" },
    { key: "hc", def: character({ name: "HandC" }), owner: P1, zone: "hand" },
    { key: "dc", def: character({ name: "DiscardC" }), owner: P1, zone: "discard" },
    ...O(3, P1).map((r) => ({ ...r, attachedToKey: undefined })),
    ...spentResources(P1, 4)
  ]);
  const cast = (dep: string[]) => () => play(b.engine, P1, b.id("ex"), { mode: 1, variables: { x: 1 }, selected: { dep: dep.map((k) => b.id(k)) } });
  refused(cast(["hc"]), "a character card in hand");
  refused(cast(["dc"]), "a character card in the discard pile");
  assert.equal(zoneOf(b.engine, b.id("ex")), "hand", "nothing was played");
  cast(["c1"])();
  assert.equal(b.engine.state.cards[b.id("c1")].depleted, true, "control: a character in play is depleted");
});

clause(EXP, "3:option:OPTION 3", "(T3c9) COVERT lasts the whole turn, not just one battle", () => {
  const b = expBoard([{ key: "atk", def: character({ name: "Attacker" }), owner: P1, zone: "play" }]);
  play(b.engine, P1, b.id("ex"), { mode: 2, selected: { ch: [b.id("atk")] } });
  assert.equal(kws(b.engine, b.id("atk")).includes("covert"), true);
  fightThrough(b.engine, P1, [b.id("atk")], { type: "faction", playerId: P2 }, []);
  assert.equal(b.engine.state.battle, undefined, "the battle is over");
  assert.equal(kws(b.engine, b.id("atk")).includes("covert"), true, "still COVERT after the battle, this turn");
});
