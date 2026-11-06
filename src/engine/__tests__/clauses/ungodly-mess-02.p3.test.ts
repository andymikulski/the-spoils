// Clause tests: Ungodly Mess batch 02, part p3 (groups 14-18, missing clauses only).
import assert from "node:assert/strict";
import type { SpoilsEngine } from "../../SpoilsEngine.js";
import {
  buildGame,
  activate, bank, character, developFaction, item, location, play, resolvePendingResponses, volition, P1, P2
} from "../per-card/_harness.js";
import { covertBlocksOnlyCovertParties, covertCannotBeBlockedByNonCovert, covertHasKeyword, covertPartyNeedsEveryMemberCovert } from "./_battle.js";
import { fillers, pending, zoneOf } from "./_board.js";
import { clause, declineAll, drain, printing, refused, type PendingChoiceLike, flipUpNow } from "./_clause.js";
import { endTurn, factionOf } from "./_turn.js";

type Cards = NonNullable<NonNullable<Parameters<typeof buildGame>[0]>["cards"]>;
const ANY = /[\s\S]*/;
const ready = (e: SpoilsEngine, p: string) => e.getAvailableResourceCount(p as never);
const handOf = (e: SpoilsEngine, p: string) => [...e.state.players[p as never].hand] as string[];
const deckOf = (e: SpoilsEngine, p: string) => [...e.state.players[p as never].deck] as string[];
const infl = (e: SpoilsEngine, p: string) => e.state.players[p as never].influence as number;
const pickIds = (ids: string[]) => (pc: PendingChoiceLike) =>
  pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: ids } : declineAll(pc);
const resolveChoice = (e: SpoilsEngine, choice: Record<string, unknown>) => {
  const pc = pending(e)!;
  e.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
};
const revealedIds = (e: SpoilsEngine) =>
  e.getLog().filter(entry => entry.event?.type === "cardsRevealed").flatMap(entry => (entry.event as unknown as { cardIds: string[] }).cardIds);
const spentGreed = (n: number, owner: string = P1): Cards =>
  bank("greed", n, owner as never).map(p => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

// ============================================================================
// BANK ROLLED -- EXTRA COST: Choose a number for X. Your faction loses X influence. -- Destroy a character with numeric cost X.
// -- FLIP UP: 4 [G][G] and your faction gains 4 influence.   (tactic, banker, cost 1, [G][G][G])
const BR = "c936b17a-0829-4858-bdf8-3de62c06dd39";
function brBoard(o: { greed?: number; vol?: number; inf?: number; flip?: boolean; extra?: Cards; spent?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: o.inf ?? 10 },
    cards: [
      { key: "br", def: printing(BR), owner: P1, zone: o.flip ? "play" : "hand", faceDown: o.flip ? true : undefined },
      ...bank("greed", o.greed ?? 3, P1),
      ...volition(o.vol ?? 0, P1),
      ...spentGreed(o.spent ?? 0),
      { key: "c0", def: character({ name: "C0", cost: 0, text: "no icons" }), owner: P2, zone: "play" },
      { key: "c2", def: character({ name: "C2", cost: 2, text: "no icons" }), owner: P2, zone: "play" },
      { key: "c2b", def: character({ name: "C2b", cost: 2, text: "no icons" }), owner: P2, zone: "play" },
      { key: "c3", def: character({ name: "C3", cost: 3, text: "no icons" }), owner: P2, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", cost: 2, text: "no icons" }), owner: P1, zone: "play" },
      { key: "it2", def: item({ name: "It2", cost: 2 }), owner: P2, zone: "play" },
      ...(o.extra ?? [])
    ]
  });
}
const brPlay = (b: ReturnType<typeof brBoard>, x: number, c: string[]) => play(b.engine, P1, b.id("br"), { variables: { x }, selected: { c } });
const brFlip = (b: ReturnType<typeof brBoard>, x: number, c: string[]) =>
  flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("br"), selected: { c }, variables: { x } });

clause(BR, "0:extraCost", "Bank Rolled is a Banker tactic, cost 1, threshold [G][G][G]: three Greed resources deploy it and spend exactly 1", () => {
  const p = printing(BR);
  assert.deepEqual([p.type, p.trade, p.cost, p.threshold], ["tactic", "banker", 1, "ggg"]);
  const b = brBoard();
  assert.equal(ready(b.engine, P1), 3);
  brPlay(b, 2, [b.id("c2")]);
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("br")), "discard");
  assert.equal(ready(b.engine, P1), 2, "exactly 1 resource spent");
  assert.equal(zoneOf(b.engine, b.id("c2")), "discard");
});

clause(BR, "0:extraCost", "deploying needs [G][G][G]: two Greed plus a Volition is refused, nothing paid; three Greed works", () => {
  const b = brBoard({ greed: 2, vol: 1 });
  assert.equal(ready(b.engine, P1), 3);
  refused(() => brPlay(b, 2, [b.id("c2")]), "threshold short", /threshold|icon/i);
  assert.equal(ready(b.engine, P1), 3);
  assert.equal(infl(b.engine, P1), 10);
  assert.equal(zoneOf(b.engine, b.id("c2")), "play");
  const ok = brBoard();
  brPlay(ok, 2, [ok.id("c2")]);
  assert.equal(zoneOf(ok.engine, ok.id("c2")), "discard", "control");
});

clause(BR, "0:extraCost", "deploying needs a ready resource for the cost of 1: threshold met by spent Greed but none ready is refused; one ready works", () => {
  const b = brBoard({ greed: 0, spent: 3 });
  assert.equal(ready(b.engine, P1), 0);
  refused(() => brPlay(b, 2, [b.id("c2")]), "cost short", /afford|resource|pay|cost/i);
  assert.equal(infl(b.engine, P1), 10);
  const ok = brBoard({ greed: 1, spent: 2 });
  assert.equal(ready(ok.engine, P1), 1);
  brPlay(ok, 2, [ok.id("c2")]);
  assert.equal(zoneOf(ok.engine, ok.id("c2")), "discard", "control");
});

clause(BR, "0:extraCost", "your faction loses exactly X influence: X=2 from 10 leaves 8, X=3 leaves 7, X=0 leaves 10", () => {
  for (const [x, target, left] of [[2, "c2", 8], [3, "c3", 7], [0, "c0", 10]] as const) {
    const b = brBoard();
    const theirs = infl(b.engine, P2);
    brPlay(b, x, [b.id(target)]);
    resolvePendingResponses(b.engine);
    assert.equal(infl(b.engine, P1), left, `X=${x}`);
    assert.equal(infl(b.engine, P2), theirs, "the opponent's faction is untouched");
  }
});

clause(BR, "0:extraCost", "exactly 2 influence can pay X=2 (leaves 0)", () => {
  const ok = brBoard({ inf: 2 });
  brPlay(ok, 2, [ok.id("c2")]);
  assert.equal(infl(ok.engine, P1), 0);
  assert.equal(zoneOf(ok.engine, ok.id("c2")), "discard");
});

clause(BR, "0:extraCost", "the influence must be affordable: 1 influence cannot pay X=2 (refused, nothing happens)", () => {
  const b = brBoard({ inf: 1 });
  refused(() => brPlay(b, 2, [b.id("c2")]), "cannot afford X=2", /influence/i);
  assert.equal(infl(b.engine, P1), 1);
  assert.equal(zoneOf(b.engine, b.id("c2")), "play");
  assert.equal(zoneOf(b.engine, b.id("br")), "hand");
});

clause(BR, "1:rule", "destroys the chosen character with numeric cost X (only that one, even with another cost-X character around)", () => {
  const b = brBoard();
  brPlay(b, 2, [b.id("c2")]);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("c2")), "discard");
  assert.equal(zoneOf(b.engine, b.id("c2b")), "play", "'a character': the other cost-2 character survives");
  assert.equal(zoneOf(b.engine, b.id("mine2")), "play");
  assert.equal(zoneOf(b.engine, b.id("c3")), "play");
  assert.equal(zoneOf(b.engine, b.id("c0")), "play");
});

clause(BR, "1:rule", "a character you control with numeric cost X can be picked too", () => {
  const b = brBoard();
  brPlay(b, 2, [b.id("mine2")]);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("mine2")), "discard");
  assert.equal(zoneOf(b.engine, b.id("c2")), "play");
});

clause(BR, "1:rule", "X=0 destroys a character with numeric cost 0", () => {
  const b = brBoard();
  brPlay(b, 0, [b.id("c0")]);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("c0")), "discard");
  assert.equal(zoneOf(b.engine, b.id("c2")), "play");
});

clause(BR, "1:rule", "a character whose cost is not X is refused (cost 3 with X=2, cost 2 with X=3, cost 0 with X=2), as is a non-character with cost X or a faction", () => {
  for (const [x, target] of [[2, "c3"], [3, "c2"], [2, "c0"]] as const) {
    const b = brBoard();
    refused(() => brPlay(b, x, [b.id(target)]), `${target} is not cost ${x}`, /target|select|valid|illegal/i);
    assert.equal(zoneOf(b.engine, b.id(target)), "play");
    assert.equal(infl(b.engine, P1), 10, "nothing paid");
  }
  const b = brBoard();
  refused(() => brPlay(b, 2, [b.id("it2")]), "an item with cost 2", /target|select|valid|illegal/i);
  refused(() => brPlay(b, 2, [b.engine.state.players[P2].factionId!]), "a faction", /target|select|valid|illegal/i);
  assert.equal(zoneOf(b.engine, b.id("it2")), "play");
  brPlay(b, 2, [b.id("c2")]);
  assert.equal(zoneOf(b.engine, b.id("c2")), "discard", "control");
});

clause(BR, "2:flipUp", "FLIP UP (self + 3 others, [G][G] after flipping): gains 4 influence, then plays the rule: X=2 loses 2 and destroys the cost-2 character; the tactic ends in the discard", () => {
  const b = brBoard({ flip: true, greed: 2, vol: 1 });
  assert.equal(ready(b.engine, P1), 4, "the face-down card plus three resources");
  brFlip(b, 2, [b.id("c2")]);
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("br")), "discard");
  assert.equal(infl(b.engine, P1), 12, "10 + 4 gained - 2 lost");
  assert.equal(zoneOf(b.engine, b.id("c2")), "discard");
  assert.equal(zoneOf(b.engine, b.id("c2b")), "play");
  assert.equal(ready(b.engine, P1), 0, "all four paid (self included)");
});

clause(BR, "2:flipUp", "FLIP UP costs exactly 4, not the printed 1: with 7 other resources only 4 are spent", () => {
  const b = brBoard({ flip: true, greed: 3, vol: 4 });
  assert.equal(ready(b.engine, P1), 8);
  brFlip(b, 2, [b.id("c2")]);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("br")), "discard");
  assert.equal(ready(b.engine, P1), 3, "8 ready, 4 paid, the flipped card no longer a resource");
});

clause(BR, "2:flipUp", "FLIP UP is refused one resource short (self + 2 others = 3 ready) with nothing paid; self + 3 others works", () => {
  const b = brBoard({ flip: true, greed: 2, vol: 0 });
  assert.equal(ready(b.engine, P1), 3);
  refused(() => brFlip(b, 2, [b.id("c2")]), "3 ready for cost 4", /afford|resource|pay|cost/i);
  assert.equal(b.engine.state.cards[b.id("br")].faceDown, true);
  assert.equal(zoneOf(b.engine, b.id("br")), "play");
  assert.equal(ready(b.engine, P1), 3);
  assert.equal(infl(b.engine, P1), 10, "no influence gained");
  const ok = brBoard({ flip: true, greed: 2, vol: 1 });
  brFlip(ok, 2, [ok.id("c2")]);
  assert.equal(zoneOf(ok.engine, ok.id("br")), "discard", "control");
});

clause(BR, "2:flipUp", "FLIP UP needs [G][G] after flipping: one Greed plus Volition is refused (its own face-down Volition doesn't count); two Greed works", () => {
  const b = brBoard({ flip: true, greed: 1, vol: 2 });
  assert.equal(ready(b.engine, P1), 4);
  refused(() => brFlip(b, 2, [b.id("c2")]), "one [G] only", /threshold|icon/i);
  assert.equal(b.engine.state.cards[b.id("br")].faceDown, true);
  assert.equal(ready(b.engine, P1), 4, "nothing paid");
  assert.equal(infl(b.engine, P1), 10);
  const ok = brBoard({ flip: true, greed: 2, vol: 1 });
  brFlip(ok, 2, [ok.id("c2")]);
  assert.equal(zoneOf(ok.engine, ok.id("br")), "discard", "control");
});

clause(BR, "2:flipUp", "a flipped-up Bank Rolled still follows the rule: a character whose cost is not X is refused", () => {
  const b = brBoard({ flip: true, greed: 2, vol: 1 });
  refused(() => brFlip(b, 2, [b.id("c3")]), "cost 3 with X=2", /target|select|valid|illegal/i);
  assert.equal(b.engine.state.cards[b.id("br")].faceDown, true);
  assert.equal(infl(b.engine, P1), 10);
  assert.equal(ready(b.engine, P1), 4);
});

// ============================================================================
// DEATH INVESTOR -- When this card enters play, you may put a character in your discard pile on top of its owner's deck.
// -- [G]x6: This card gains 3 strength and 3 life. -- RECUR: [G] -- COST: Use this only if this card is in your discard pile. Pay 1.
// Remove this card from the game. Pick a character in your discard pile. -- EFFECT: Put the picked character into play under your control.
const DI = "b974a7f9-f347-4731-8e5c-f3f2a41d1877";
function diBoard(o: { hand?: boolean; greed?: number; vol?: number; spent?: number; zone?: "hand" | "play" | "discard"; oppGreed?: number; extra?: Cards } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: 10 },
    cards: [
      { key: "di", def: printing(DI), owner: P1, zone: o.zone ?? "hand" },
      ...bank("greed", o.greed ?? 1, P1),
      ...volition(o.vol ?? 0, P1),
      ...spentGreed(o.spent ?? 0),
      ...bank("greed", o.oppGreed ?? 0, P2),
      { key: "dc1", def: character({ name: "Dead One", text: "no icons" }), owner: P1, zone: "discard" },
      { key: "dc2", def: character({ name: "Dead Two", text: "no icons" }), owner: P1, zone: "discard" },
      { key: "dit", def: item({ name: "Dead Item" }), owner: P1, zone: "discard" },
      { key: "oc", def: character({ name: "Their Dead", text: "no icons" }), owner: P2, zone: "discard" },
      ...fillers("dk", 3, P1, "deck"),
      ...(o.extra ?? [])
    ]
  });
}
const diDeploy = (b: ReturnType<typeof diBoard>) => play(b.engine, P1, b.id("di"), {});

clause(DI, "0:rule", "Death Investor is a Banker character, subtypes Investor and Mau, cost 1, [G], 1 strength / 3 speed / 1 life: one Greed deploys it for exactly 1; refused with no Greed", () => {
  const p = printing(DI);
  assert.deepEqual([p.type, p.trade, p.cost, p.threshold, [...p.subtype]], ["character", "banker", 1, "g", ["investor", "mau"]]);
  const b = diBoard({ greed: 1 });
  diDeploy(b);
  drain(b.engine, pickIds([]));
  assert.equal(zoneOf(b.engine, b.id("di")), "play");
  assert.equal(b.engine.getStat(b.id("di"), "strength"), 1);
  assert.equal(b.engine.getStat(b.id("di"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("di"), "life"), 1);
  assert.equal(ready(b.engine, P1), 0, "exactly 1 spent");
  const noG = diBoard({ greed: 0, vol: 1 });
  refused(() => diDeploy(noG), "no [G]", /threshold|icon/i);
  assert.equal(zoneOf(noG.engine, noG.id("di")), "hand");
  const none = diBoard({ greed: 0, spent: 1 });
  refused(() => diDeploy(none), "nothing ready to pay 1", /afford|resource|pay|cost/i);
  assert.equal(zoneOf(none.engine, none.id("di")), "hand");
});

clause(DI, "0:rule", "enter-play trigger: you choose a character in your discard pile and it goes on top of its owner's deck (above the cards already there); other discard cards stay", () => {
  const b = diBoard();
  const deckBefore = deckOf(b.engine, P1);
  diDeploy(b);
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  resolveChoice(b.engine, { kind: "chooserSelectsTarget", selected: [b.id("dc1")] });
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine), undefined);
  assert.deepEqual(deckOf(b.engine, P1), [b.id("dc1"), ...deckBefore], "on top of the deck");
  assert.equal(zoneOf(b.engine, b.id("dc2")), "discard");
  assert.equal(zoneOf(b.engine, b.id("dit")), "discard");
  assert.equal(zoneOf(b.engine, b.id("oc")), "discard");
  assert.equal(zoneOf(b.engine, b.id("di")), "play");
});

clause(DI, "0:rule", "the other character can be chosen instead (any character in the pile)", () => {
  const b = diBoard();
  diDeploy(b);
  resolveChoice(b.engine, { kind: "chooserSelectsTarget", selected: [b.id("dc2")] });
  resolvePendingResponses(b.engine);
  assert.equal(deckOf(b.engine, P1)[0], b.id("dc2"));
  assert.equal(zoneOf(b.engine, b.id("dc1")), "discard");
});

clause(DI, "0:rule", "'may': declining leaves every card where it is", () => {
  const b = diBoard();
  const deckBefore = deckOf(b.engine, P1);
  diDeploy(b);
  resolveChoice(b.engine, { kind: "chooserSelectsTarget", selected: [] });
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine), undefined);
  assert.deepEqual(deckOf(b.engine, P1), deckBefore);
  assert.equal(zoneOf(b.engine, b.id("dc1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("dc2")), "discard");
  assert.equal(zoneOf(b.engine, b.id("di")), "play");
});

clause(DI, "0:rule", "only a character in YOUR discard pile: an item in your discard and the opponent's discarded character are refused", () => {
  const b = diBoard();
  diDeploy(b);
  refused(() => resolveChoice(b.engine, { kind: "chooserSelectsTarget", selected: [b.id("dit")] }), "an item", ANY);
  refused(() => resolveChoice(b.engine, { kind: "chooserSelectsTarget", selected: [b.id("oc")] }), "opponent's discard", ANY);
  assert.equal(zoneOf(b.engine, b.id("dit")), "discard");
  assert.equal(zoneOf(b.engine, b.id("oc")), "discard");
  resolveChoice(b.engine, { kind: "chooserSelectsTarget", selected: [b.id("dc1")] });
  assert.equal(zoneOf(b.engine, b.id("dc1")), "deck", "control");
});

clause(DI, "0:rule", "'a character': choosing two characters at once is refused, and only the one is moved", () => {
  const b = diBoard();
  diDeploy(b);
  refused(() => resolveChoice(b.engine, { kind: "chooserSelectsTarget", selected: [b.id("dc1"), b.id("dc2")] }), "two characters", ANY);
  assert.equal(zoneOf(b.engine, b.id("dc1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("dc2")), "discard");
  resolveChoice(b.engine, { kind: "chooserSelectsTarget", selected: [b.id("dc1")] });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("dc1")), "deck", "control");
  assert.equal(zoneOf(b.engine, b.id("dc2")), "discard");
});

clause(DI, "0:rule", "with no character in your discard pile there is nothing to choose (no prompt)", () => {
  const b = diBoard({ extra: [] });
  for (const k of ["dc1", "dc2"]) b.engine.state.players[P1].discard = b.engine.state.players[P1].discard.filter((c: string) => c !== b.id(k));
  for (const k of ["dc1", "dc2"]) delete b.engine.state.cards[b.id(k)];
  diDeploy(b);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("di")), "play");
  assert.equal(zoneOf(b.engine, b.id("dit")), "discard");
});

clause(DI, "0:rule", "the trigger is 'this card enters play': another character entering later does not prompt", () => {
  const b = diBoard({ zone: "play", greed: 1, extra: [{ key: "oth", def: character({ name: "Other", cost: 0, text: "no icons" }), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("oth"), {});
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("oth")), "play");
  assert.equal(zoneOf(b.engine, b.id("dc1")), "discard");
});

clause(DI, "1:rule@gggggg", "with [G]x6 it gets +3 strength and +3 life (4/3/4; speed unchanged)", () => {
  const b = diBoard({ zone: "play", greed: 6 });
  assert.equal(b.engine.getStat(b.id("di"), "strength"), 4);
  assert.equal(b.engine.getStat(b.id("di"), "life"), 4);
  assert.equal(b.engine.getStat(b.id("di"), "speed"), 3);
});

clause(DI, "1:rule@gggggg", "with only five Greed plus a Volition it stays 1/3/1", () => {
  const b = diBoard({ zone: "play", greed: 5, vol: 1 });
  assert.equal(b.engine.getStat(b.id("di"), "strength"), 1);
  assert.equal(b.engine.getStat(b.id("di"), "life"), 1);
  assert.equal(b.engine.getStat(b.id("di"), "speed"), 3);
});

clause(DI, "1:rule@gggggg", "only YOUR icons count: six opposing Greed does not boost it", () => {
  const b = diBoard({ zone: "play", greed: 1, oppGreed: 6 });
  assert.equal(b.engine.getStat(b.id("di"), "strength"), 1);
  assert.equal(b.engine.getStat(b.id("di"), "life"), 1);
});

clause(DI, "1:rule@gggggg", "spent Greed still counts toward the six; deploying it with six Greed gives 4/3/4 straight away and turns off when a resource is lost", () => {
  const b = diBoard({ greed: 3, spent: 3 });
  diDeploy(b);
  drain(b.engine, pickIds([]));
  assert.equal(b.engine.getStat(b.id("di"), "strength"), 4);
  assert.equal(b.engine.getStat(b.id("di"), "life"), 4);
  const low = diBoard({ greed: 2, spent: 3 });
  diDeploy(low);
  drain(low.engine, pickIds([]));
  assert.equal(low.engine.getStat(low.id("di"), "strength"), 1, "five icons only");
  assert.equal(low.engine.getStat(low.id("di"), "life"), 1);
});

const RECUR = "recur";
clause(DI, "2:ability:recur", "RECUR from the discard pile: pays 1, removes Death Investor from the game and puts the picked character into play under your control", () => {
  const b = diBoard({ zone: "discard", greed: 2 });
  assert.equal(ready(b.engine, P1), 2);
  activate(b.engine, P1, b.id("di"), RECUR, { selected: { c: [b.id("dc1")] } });
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("dc1")), "play");
  assert.equal(b.engine.state.cards[b.id("dc1")].controllerId, P1);
  assert.equal(ready(b.engine, P1), 1, "exactly 1 paid");
  assert.equal(zoneOf(b.engine, b.id("di")), "removed", "removed from the game");
  assert.equal(zoneOf(b.engine, b.id("dc2")), "discard", "the other discarded character stays");
});

clause(DI, "2:ability:recur", "RECUR can pick either discarded character", () => {
  const b = diBoard({ zone: "discard", greed: 1 });
  activate(b.engine, P1, b.id("di"), RECUR, { selected: { c: [b.id("dc2")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("dc2")), "play");
  assert.equal(zoneOf(b.engine, b.id("dc1")), "discard");
  assert.equal(ready(b.engine, P1), 0);
});

clause(DI, "2:ability:recur", "'use this only if this card is in your discard pile': refused while it is in play or in hand", () => {
  for (const zone of ["play", "hand"] as const) {
    const b = diBoard({ zone, greed: 2 });
    refused(() => activate(b.engine, P1, b.id("di"), RECUR, { selected: { c: [b.id("dc1")] } }), `in ${zone}`, /Activated ability not found|not found|zone/i);
    assert.equal(zoneOf(b.engine, b.id("di")), zone);
    assert.equal(zoneOf(b.engine, b.id("dc1")), "discard");
    assert.equal(ready(b.engine, P1), 2);
  }
  const ok = diBoard({ zone: "discard", greed: 2 });
  activate(ok.engine, P1, ok.id("di"), RECUR, { selected: { c: [ok.id("dc1")] } });
  assert.equal(zoneOf(ok.engine, ok.id("dc1")), "play", "control");
});

clause(DI, "2:ability:recur", "RECUR threshold [G]: with only Volition it is refused, nothing paid; with one Greed it works", () => {
  const b = diBoard({ zone: "discard", greed: 0, vol: 2 });
  refused(() => activate(b.engine, P1, b.id("di"), RECUR, { selected: { c: [b.id("dc1")] } }), "no [G]", /threshold|icon/i);
  assert.equal(zoneOf(b.engine, b.id("di")), "discard");
  assert.equal(zoneOf(b.engine, b.id("dc1")), "discard");
  assert.equal(ready(b.engine, P1), 2);
});

clause(DI, "2:ability:recur", "RECUR 'Pay 1': refused with nothing ready (the threshold alone is met by spent Greed); the card stays in the discard", () => {
  const b = diBoard({ zone: "discard", greed: 0, spent: 1 });
  assert.equal(ready(b.engine, P1), 0);
  refused(() => activate(b.engine, P1, b.id("di"), RECUR, { selected: { c: [b.id("dc1")] } }), "cannot pay 1", /afford|resource|pay|cost/i);
  assert.equal(zoneOf(b.engine, b.id("di")), "discard");
  assert.equal(zoneOf(b.engine, b.id("dc1")), "discard");
});

clause(DI, "2:ability:recur", "the picked card must be a character in your discard pile: an item, the opponent's character and Death Investor itself are refused", () => {
  const b = diBoard({ zone: "discard", greed: 2 });
  refused(() => activate(b.engine, P1, b.id("di"), RECUR, { selected: { c: [b.id("dit")] } }), "an item", /target|select|valid|illegal/i);
  refused(() => activate(b.engine, P1, b.id("di"), RECUR, { selected: { c: [b.id("oc")] } }), "opponent's discard", /target|select|valid|illegal/i);
  assert.equal(zoneOf(b.engine, b.id("di")), "discard", "nothing happened");
  assert.equal(zoneOf(b.engine, b.id("dit")), "discard");
  assert.equal(zoneOf(b.engine, b.id("oc")), "discard");
  assert.equal(ready(b.engine, P1), 2);
});

clause(DI, "2:ability:recur", "Death Investor cannot pick itself: it is removed from the game as a cost before the pick", () => {
  const b = diBoard({ zone: "discard", greed: 2 });
  refused(() => activate(b.engine, P1, b.id("di"), RECUR, { selected: { c: [b.id("di")] } }), "itself (already removed from the game as the cost)", /target|select|valid|illegal/i);
  // A refused play changes nothing (CR 604.1e): the Investor was removed only in the rehearsal, it is still in the discard pile.
  assert.equal(zoneOf(b.engine, b.id("di")), "discard");
  assert.equal(ready(b.engine, P1), 2);
});

clause(DI, "2:ability:recur", "with no other character in your discard pile RECUR cannot be used (it can't pick itself)", () => {
  const b = diBoard({ zone: "discard", greed: 2 });
  b.engine.state.players[P1].discard = b.engine.state.players[P1].discard.filter((c: string) => ![b.id("dc1"), b.id("dc2")].includes(c));
  refused(() => activate(b.engine, P1, b.id("di"), RECUR, { selected: { c: [] } }), "no character to pick", /target|select|valid|illegal/i);
  assert.equal(zoneOf(b.engine, b.id("di")), "discard");
  assert.equal(ready(b.engine, P1), 2);
});

// ============================================================================
// DEMOLITION INVESTMENT -- EXTRA COST: Pick a player. Your faction loses 3 influence. -- That player reveals a face-down resource they control.
// Your faction gains influence equal to that card's numeric cost. Destroy that card. -- FLIP UP: 4 [G]   (tactic, banker, cost 4, [G])
const DEMO = "453db85c-818d-4e89-a019-9abf16307109";
function demoBoard(o: { greed?: number; vol?: number; inf?: number; flip?: boolean; oppDown?: number[]; oppUp?: number; myDown?: number[]; extra?: Cards } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: o.inf ?? 10 },
    cards: [
      { key: "demo", def: printing(DEMO), owner: P1, zone: o.flip ? "play" : "hand", faceDown: o.flip ? true : undefined },
      ...bank("greed", o.greed ?? 4, P1),
      ...volition(o.vol ?? 0, P1),
      ...(o.oppDown ?? []).map((cost, i) => ({ key: `fd${i}`, def: character({ name: `Down${i}`, cost, text: "no icons" }), owner: P2, zone: "play" as const, faceDown: true })),
      ...(o.myDown ?? []).map((cost, i) => ({ key: `my${i}`, def: character({ name: `Mine${i}`, cost, text: "no icons" }), owner: P1, zone: "play" as const, faceDown: true })),
      ...bank("greed", o.oppUp ?? 0, P2),
      ...(o.extra ?? [])
    ]
  });
}
const demoPick = (b: ReturnType<typeof demoBoard>, ids: string[]) => {
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  resolveChoice(b.engine, { kind: "chooserSelectsTarget", selected: ids });
  resolvePendingResponses(b.engine);
};
const demoFlip = (b: ReturnType<typeof demoBoard>) =>
  flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("demo"), selected: { p: [factionOf(b.engine, P2)] }, variables: {} });

clause(DEMO, "0:extraCost", "Demolition Investment is a Banker tactic, cost 4, threshold [G]: four resources with one Greed deploy it for exactly 4 and lose 3 influence", () => {
  const p = printing(DEMO);
  assert.deepEqual([p.type, p.trade, p.cost, p.threshold], ["tactic", "banker", 4, "g"]);
  const b = demoBoard({ greed: 1, vol: 3, oppDown: [2] });
  assert.equal(ready(b.engine, P1), 4);
  play(b.engine, P1, b.id("demo"), { selected: { p: [factionOf(b.engine, P2)] } });
  demoPick(b, [b.id("fd0")]);
  assert.equal(zoneOf(b.engine, b.id("demo")), "discard");
  assert.equal(ready(b.engine, P1), 0, "all four paid");
  assert.equal(infl(b.engine, P1), 9, "10 - 3 + 2");
});

clause(DEMO, "0:extraCost", "refused with only three resources (cost 4), and with four Volition (no [G]); nothing paid in either case", () => {
  const short = demoBoard({ greed: 3, oppDown: [2] });
  refused(() => play(short.engine, P1, short.id("demo"), { selected: { p: [factionOf(short.engine, P2)] } }), "3 ready for cost 4", /afford|resource|pay|cost/i);
  assert.equal(zoneOf(short.engine, short.id("demo")), "hand");
  assert.equal(infl(short.engine, P1), 10);
  assert.equal(ready(short.engine, P1), 3);
  const noG = demoBoard({ greed: 0, vol: 4, oppDown: [2] });
  refused(() => play(noG.engine, P1, noG.id("demo"), { selected: { p: [factionOf(noG.engine, P2)] } }), "no [G]", /threshold|icon/i);
  assert.equal(zoneOf(noG.engine, noG.id("demo")), "hand");
  assert.equal(infl(noG.engine, P1), 10);
  assert.equal(ready(noG.engine, P1), 4);
});

clause(DEMO, "0:extraCost", "your faction loses exactly 3 influence (cost 0 revealed card so no gain): 10 becomes 7", () => {
  const b = demoBoard({ oppDown: [0] });
  const theirs = infl(b.engine, P2);
  play(b.engine, P1, b.id("demo"), { selected: { p: [factionOf(b.engine, P2)] } });
  demoPick(b, [b.id("fd0")]);
  assert.equal(infl(b.engine, P1), 7);
  assert.equal(infl(b.engine, P2), theirs, "the opponent's faction is untouched");
  assert.equal(zoneOf(b.engine, b.id("fd0")), "discard");
});

clause(DEMO, "0:extraCost", "exactly 3 influence can pay the extra cost (3 - 3 + 2 = 2)", () => {
  const ok = demoBoard({ inf: 3, oppDown: [2] });
  play(ok.engine, P1, ok.id("demo"), { selected: { p: [factionOf(ok.engine, P2)] } });
  demoPick(ok, [ok.id("fd0")]);
  assert.equal(infl(ok.engine, P1), 2);
});

clause(DEMO, "0:extraCost", "the 3 influence must be affordable: 2 influence is refused with nothing changed", () => {
  const b = demoBoard({ inf: 2, oppDown: [2] });
  refused(() => play(b.engine, P1, b.id("demo"), { selected: { p: [factionOf(b.engine, P2)] } }), "cannot afford 3 influence", /influence/i);
  assert.equal(infl(b.engine, P1), 2);
  assert.equal(zoneOf(b.engine, b.id("demo")), "hand");
  assert.equal(ready(b.engine, P1), 4);
  assert.equal(zoneOf(b.engine, b.id("fd0")), "play");
});

clause(DEMO, "0:extraCost", "'Pick a player' lets the caster choose either player (own face-down resource too)", () => {
  // The opponent has no face-down resource; the caster picks themself.
  const b = demoBoard({ myDown: [3], oppDown: [] });
  play(b.engine, P1, b.id("demo"), { selected: { p: [factionOf(b.engine, P1)] } });
  drain(b.engine, pickIds([b.id("my0")]));
  assert.equal(zoneOf(b.engine, b.id("my0")), "discard", "the picked player (me) reveals and loses their face-down resource");
  assert.equal(infl(b.engine, P1), 10, "10 - 3 + 3");
});

clause(DEMO, "1:rule", "the OPPONENT chooses which face-down resource they reveal; your faction gains influence equal to its numeric cost (cost 2 gives +2); it is destroyed, revealed, and the other stays face-down", () => {
  const b = demoBoard({ oppDown: [2, 5] });
  play(b.engine, P1, b.id("demo"), { selected: { p: [factionOf(b.engine, P2)] } });
  const pc = pending(b.engine)!;
  assert.equal(pc.playerId, P2, "the pick belongs to the player picked (the opponent)");
  demoPick(b, [b.id("fd0")]);
  assert.equal(infl(b.engine, P1), 9, "10 - 3 + 2");
  assert.equal(zoneOf(b.engine, b.id("fd0")), "discard");
  assert.equal(zoneOf(b.engine, b.id("fd1")), "play");
  assert.equal(b.engine.state.cards[b.id("fd1")].faceDown, true);
  assert.deepEqual(revealedIds(b.engine), [b.id("fd0")], "only the chosen card is revealed");
});

clause(DEMO, "1:rule", "the gain follows the revealed card's cost: picking the cost-5 card gives +5", () => {
  const b = demoBoard({ oppDown: [2, 5] });
  play(b.engine, P1, b.id("demo"), { selected: { p: [factionOf(b.engine, P2)] } });
  demoPick(b, [b.id("fd1")]);
  assert.equal(infl(b.engine, P1), 12, "10 - 3 + 5");
  assert.equal(zoneOf(b.engine, b.id("fd1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("fd0")), "play");
});

clause(DEMO, "1:rule", "only a face-down resource is eligible: the opponent's face-up resources are refused, and your own face-down resources are untouched", () => {
  const b = demoBoard({ oppDown: [4], oppUp: 3, myDown: [6] });
  play(b.engine, P1, b.id("demo"), { selected: { p: [factionOf(b.engine, P2)] } });
  const faceUp = Object.values(b.engine.state.cards).find(c => c.controllerId === P2 && c.zone === "play" && !c.faceDown)!;
  refused(() => resolveChoice(b.engine, { kind: "chooserSelectsTarget", selected: [faceUp.id] }), "a face-up resource", ANY);
  refused(() => resolveChoice(b.engine, { kind: "chooserSelectsTarget", selected: [b.id("my0")] }), "my own face-down resource", ANY);
  demoPick(b, [b.id("fd0")]);
  assert.equal(infl(b.engine, P1), 11, "10 - 3 + 4");
  assert.equal(zoneOf(b.engine, b.id("my0")), "play");
  assert.equal(b.engine.state.cards[b.id("my0")].faceDown, true);
  assert.equal(zoneOf(b.engine, faceUp.id), "play");
});

clause(DEMO, "1:rule", "the opponent with no face-down resource reveals nothing: no gain, nothing destroyed, no prompt (the 3 influence is still lost)", () => {
  const b = demoBoard({ oppUp: 3, myDown: [6] });
  play(b.engine, P1, b.id("demo"), { selected: { p: [factionOf(b.engine, P2)] } });
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine), undefined);
  assert.equal(infl(b.engine, P1), 7);
  assert.equal(zoneOf(b.engine, b.id("demo")), "discard");
  assert.equal(zoneOf(b.engine, b.id("my0")), "play");
  assert.deepEqual(revealedIds(b.engine), []);
});

clause(DEMO, "1:rule", "a revealed face-down card with numeric cost 0 gains 0 and is still destroyed", () => {
  const b = demoBoard({ oppDown: [0] });
  play(b.engine, P1, b.id("demo"), { selected: { p: [factionOf(b.engine, P2)] } });
  demoPick(b, [b.id("fd0")]);
  assert.equal(infl(b.engine, P1), 7);
  assert.equal(zoneOf(b.engine, b.id("fd0")), "discard");
});

clause(DEMO, "1:rule", "'reveals a face-down resource they control' is mandatory: the opponent cannot decline when they have one", () => {
  const b = demoBoard({ oppDown: [3] });
  play(b.engine, P1, b.id("demo"), { selected: { p: [factionOf(b.engine, P2)] } });
  try { resolveChoice(b.engine, { kind: "chooserSelectsTarget", selected: [] }); } catch { /* refusing the decline is the correct behavior */ }
  resolvePendingResponses(b.engine);
  if (pending(b.engine)) demoPick(b, [b.id("fd0")]);
  assert.equal(zoneOf(b.engine, b.id("fd0")), "discard", "the face-down resource is revealed and destroyed anyway");
  assert.equal(infl(b.engine, P1), 10, "10 - 3 + 3");
});

clause(DEMO, "2:flipUp", "FLIP UP (self + 3 others, one [G]): plays the rule: -3 influence, the opponent reveals, +cost, destroyed; the tactic ends in the discard", () => {
  const b = demoBoard({ flip: true, greed: 1, vol: 2, oppDown: [2] });
  assert.equal(ready(b.engine, P1), 4, "the face-down card plus three resources");
  demoFlip(b);
  assert.equal(pending(b.engine)!.playerId, P2);
  demoPick(b, [b.id("fd0")]);
  assert.equal(zoneOf(b.engine, b.id("demo")), "discard");
  assert.equal(zoneOf(b.engine, b.id("fd0")), "discard");
  assert.equal(infl(b.engine, P1), 9, "10 - 3 + 2");
  assert.equal(ready(b.engine, P1), 0, "all four paid (self included)");
});

clause(DEMO, "2:flipUp", "FLIP UP costs exactly 4: with 8 resources in all only 4 are spent", () => {
  const b = demoBoard({ flip: true, greed: 3, vol: 4, oppDown: [2] });
  assert.equal(ready(b.engine, P1), 8);
  demoFlip(b);
  demoPick(b, [b.id("fd0")]);
  assert.equal(zoneOf(b.engine, b.id("demo")), "discard");
  assert.equal(ready(b.engine, P1), 3, "8 ready, 4 paid, the flipped card no longer a resource");
});

clause(DEMO, "2:flipUp", "FLIP UP is refused one resource short (self + 2 others) with nothing paid; self + 3 others works", () => {
  const b = demoBoard({ flip: true, greed: 2, oppDown: [2] });
  assert.equal(ready(b.engine, P1), 3);
  refused(() => demoFlip(b), "3 ready for cost 4", /afford|resource|pay|cost/i);
  assert.equal(b.engine.state.cards[b.id("demo")].faceDown, true);
  assert.equal(ready(b.engine, P1), 3);
  assert.equal(infl(b.engine, P1), 10);
  const ok = demoBoard({ flip: true, greed: 3, oppDown: [2] });
  demoFlip(ok);
  demoPick(ok, [ok.id("fd0")]);
  assert.equal(zoneOf(ok.engine, ok.id("demo")), "discard", "control");
});

clause(DEMO, "2:flipUp", "FLIP UP needs [G] after flipping: its own face-down Volition does not count (three Volition refused); one Greed works", () => {
  const b = demoBoard({ flip: true, greed: 0, vol: 3, oppDown: [2] });
  assert.equal(ready(b.engine, P1), 4);
  refused(() => demoFlip(b), "no [G]", /threshold|icon/i);
  assert.equal(b.engine.state.cards[b.id("demo")].faceDown, true);
  assert.equal(ready(b.engine, P1), 4);
  assert.equal(infl(b.engine, P1), 10);
  const ok = demoBoard({ flip: true, greed: 1, vol: 2, oppDown: [2] });
  demoFlip(ok);
  demoPick(ok, [ok.id("fd0")]);
  assert.equal(zoneOf(ok.engine, ok.id("demo")), "discard", "control");
});

clause(DEMO, "2:flipUp", "a flipped-up Demolition Investment still pays its extra cost: 2 influence is refused", () => {
  const b = demoBoard({ flip: true, greed: 1, vol: 2, inf: 2, oppDown: [2] });
  refused(() => demoFlip(b), "cannot afford 3 influence", /influence/i);
  assert.equal(b.engine.state.cards[b.id("demo")].faceDown, true);
  assert.equal(infl(b.engine, P1), 2);
  assert.equal(ready(b.engine, P1), 4);
});

// ============================================================================
// DESPERATE DEFENDER -- COVERT -- SHOW EVIDENCE -- COST: Use this ability only once each turn. Pick a character. -- EFFECT: Deplete that character.
const DD = "50e0be9e-dc07-43b2-afea-630a90e77308";
function ddBoard(o: { gg?: number; extra?: Cards } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "dd", def: printing(DD), owner: P1, zone: o.gg === undefined ? "play" : "hand" },
      ...bank("greed", o.gg ?? 0, P1),
      { key: "foe", def: character({ name: "Foe", text: "no icons" }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", text: "no icons" }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", text: "no icons" }), owner: P1, zone: "play" },
      { key: "it", def: item({ name: "It" }), owner: P2, zone: "play" },
      ...(o.extra ?? [])
    ]
  });
}
const evidence = (b: ReturnType<typeof ddBoard>, c: string[]) => activate(b.engine, P1, b.id("dd"), "show-evidence", { selected: { c } });

clause(DD, "0:kw:COVERT", "Desperate Defender has COVERT", () => covertHasKeyword(DD));
clause(DD, "0:kw:COVERT", "COVERT: cannot be blocked by a non-COVERT character", () => covertCannotBeBlockedByNonCovert(DD));
clause(DD, "0:kw:COVERT", "COVERT: a party needs every member COVERT", () => covertPartyNeedsEveryMemberCovert(DD));
clause(DD, "0:kw:COVERT", "COVERT: only blocks COVERT parties", () => covertBlocksOnlyCovertParties(DD));

clause(DD, "0:kw:COVERT", "Desperate Defender is a Banker Lawyer, cost 3, [G][G], 1 strength / 3 speed / 2 life: deploys with exactly three resources including two Greed, refused one short and with one Greed", () => {
  const p = printing(DD);
  assert.deepEqual([p.type, p.trade, p.cost, p.threshold, [...p.subtype]], ["character", "banker", 3, "gg", ["lawyer"]]);
  const b = ddBoard({ gg: 3 });
  play(b.engine, P1, b.id("dd"), {});
  assert.equal(zoneOf(b.engine, b.id("dd")), "play");
  assert.equal(b.engine.getStat(b.id("dd"), "strength"), 1);
  assert.equal(b.engine.getStat(b.id("dd"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("dd"), "life"), 2);
  assert.equal(ready(b.engine, P1), 0, "exactly 3 spent");
  const short = ddBoard({ gg: 2 });
  refused(() => play(short.engine, P1, short.id("dd"), {}), "two resources", /afford|resource|pay|cost/i);
  assert.equal(zoneOf(short.engine, short.id("dd")), "hand");
  const oneGreed = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "dd", def: printing(DD), owner: P1, zone: "hand" }, ...bank("greed", 1, P1), ...volition(2, P1)]
  });
  assert.equal(ready(oneGreed.engine, P1), 3);
  refused(() => play(oneGreed.engine, P1, oneGreed.id("dd"), {}), "one Greed", /threshold|icon/i);
  assert.equal(zoneOf(oneGreed.engine, oneGreed.id("dd")), "hand");
});

clause(DD, "1:ability:show-evidence", "SHOW EVIDENCE depletes the picked opposing character, for free", () => {
  const b = ddBoard();
  assert.equal(b.engine.state.cards[b.id("foe")].depleted, false);
  evidence(b, [b.id("foe")]);
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("foe")].depleted, true);
  assert.equal(b.engine.state.cards[b.id("foe2")].depleted, false, "only the picked character");
  assert.equal(b.engine.state.cards[b.id("mine")].depleted, false);
  assert.equal(b.engine.state.cards[b.id("dd")].depleted, false, "using it does not deplete Desperate Defender");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
});

clause(DD, "1:ability:show-evidence", "any character can be picked: your own character, and Desperate Defender itself", () => {
  const b = ddBoard();
  evidence(b, [b.id("mine")]);
  assert.equal(b.engine.state.cards[b.id("mine")].depleted, true);
  assert.equal(b.engine.state.cards[b.id("foe")].depleted, false);
  const s = ddBoard();
  evidence(s, [s.id("dd")]);
  assert.equal(s.engine.state.cards[s.id("dd")].depleted, true);
});

clause(DD, "1:ability:show-evidence", "only a character can be picked: an item and a faction are refused", () => {
  const b = ddBoard();
  refused(() => evidence(b, [b.id("it")]), "an item", /target|select|valid|illegal/i);
  refused(() => evidence(b, [b.engine.state.players[P2].factionId!]), "a faction", /target|select|valid|illegal/i);
  refused(() => evidence(b, []), "no pick", /target|select|valid|illegal/i);
  assert.equal(b.engine.state.cards[b.id("it")].depleted, false);
  evidence(b, [b.id("foe")]);
  assert.equal(b.engine.state.cards[b.id("foe")].depleted, true, "control: refusals burned no use");
});

clause(DD, "1:ability:show-evidence", "once each turn: a second use the same turn is refused, and it works again next turn (and a second copy has its own use)", () => {
  const b = ddBoard({ extra: [{ key: "dd2", def: printing(DD), owner: P1, zone: "play" }] });
  evidence(b, [b.id("foe")]);
  refused(() => evidence(b, [b.id("foe2")]), "second use this turn", /once|turn|used|uses/i);
  assert.equal(b.engine.state.cards[b.id("foe2")].depleted, false);
  activate(b.engine, P1, b.id("dd2"), "show-evidence", { selected: { c: [b.id("foe2")] } });
  assert.equal(b.engine.state.cards[b.id("foe2")].depleted, true, "the second copy has its own use");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  b.engine.state.cards[b.id("mine")].depleted = false;
  evidence(b, [b.id("mine")]);
  assert.equal(b.engine.state.cards[b.id("mine")].depleted, true, "next turn it works again");
});

// ============================================================================
// DOARDEN FLEE MARKET -- HOCK -- COST: Pay 1. Deplete this card. Destroy a character you own. -- EFFECT: Draw a card.
// WEEDLE: [G]x6 -- COST: Pay 2. Deplete this card. Destroy a character you own. -- EFFECT: Draw 3 cards.   (location, banker, cost 4, [G], structure 2)
const DFM = "c1096e81-40be-4c71-b4b4-77726cdef722";
function dfmBoard(o: { hand?: boolean; greed?: number; vol?: number; spent?: number; extra?: Cards } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "mk", def: printing(DFM), owner: P1, zone: o.hand ? "hand" : "play" },
      ...bank("greed", o.greed ?? 2, P1),
      ...volition(o.vol ?? 0, P1),
      ...spentGreed(o.spent ?? 0),
      { key: "mine", def: character({ name: "Mine", text: "no icons" }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", text: "no icons" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", text: "no icons" }), owner: P2, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen", text: "no icons" }), owner: P2, zone: "play", controller: P1 },
      { key: "lent", def: character({ name: "Lent", text: "no icons" }), owner: P1, zone: "play", controller: P2 },
      ...fillers("dk", 6, P1, "deck"),
      ...(o.extra ?? [])
    ]
  });
}
const hock = (b: ReturnType<typeof dfmBoard>, c: string[]) => activate(b.engine, P1, b.id("mk"), "hock", { selected: { c } });
const weedle = (b: ReturnType<typeof dfmBoard>, c: string[]) => activate(b.engine, P1, b.id("mk"), "weedle", { selected: { c } });

clause(DFM, "0:ability:hock", "Doarden Flee Market is a Banker location, cost 4, [G], structure 2: four resources with one Greed deploy it for exactly 4; refused with three, and with no Greed", () => {
  const p = printing(DFM);
  assert.deepEqual([p.type, p.trade, p.cost, p.threshold], ["location", "banker", 4, "g"]);
  const b = dfmBoard({ hand: true, greed: 1, vol: 3 });
  assert.equal(ready(b.engine, P1), 4);
  play(b.engine, P1, b.id("mk"), {});
  assert.equal(zoneOf(b.engine, b.id("mk")), "play");
  assert.equal(b.engine.getStat(b.id("mk"), "structure"), 2);
  assert.equal(ready(b.engine, P1), 0, "exactly 4 spent");
  const short = dfmBoard({ hand: true, greed: 3 });
  refused(() => play(short.engine, P1, short.id("mk"), {}), "three resources", /afford|resource|pay|cost/i);
  assert.equal(zoneOf(short.engine, short.id("mk")), "hand");
  const noG = dfmBoard({ hand: true, greed: 0, vol: 4 });
  refused(() => play(noG.engine, P1, noG.id("mk"), {}), "no Greed", /threshold|icon/i);
  assert.equal(zoneOf(noG.engine, noG.id("mk")), "hand");
});

clause(DFM, "0:ability:hock", "HOCK pays 1, depletes the market, destroys the chosen character you own, and draws 1 card (the top card)", () => {
  const b = dfmBoard();
  const deckBefore = deckOf(b.engine, P1);
  const handBefore = handOf(b.engine, P1);
  hock(b, [b.id("mine")]);
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine), undefined);
  assert.equal(ready(b.engine, P1), 1, "exactly 1 paid");
  assert.equal(b.engine.state.cards[b.id("mk")].depleted, true);
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  assert.equal(zoneOf(b.engine, b.id("mine2")), "play", "only the picked character");
  assert.deepEqual(handOf(b.engine, P1), [...handBefore, deckBefore[0]], "drew exactly the top card");
  assert.equal(deckOf(b.engine, P1).length, deckBefore.length - 1);
});

clause(DFM, "0:ability:hock", "HOCK works with exactly 1 ready resource", () => {
  const b = dfmBoard({ greed: 1 });
  hock(b, [b.id("mine")]);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  assert.equal(ready(b.engine, P1), 0);
});

clause(DFM, "0:ability:hock", "HOCK pay 1: refused with nothing ready, with nothing destroyed and nothing drawn", () => {
  const b = dfmBoard({ greed: 0, spent: 2 });
  assert.equal(ready(b.engine, P1), 0);
  const hand = handOf(b.engine, P1);
  refused(() => hock(b, [b.id("mine")]), "cannot pay 1", /afford|resource|pay|cost/i);
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  assert.equal(b.engine.state.cards[b.id("mk")].depleted, false);
  assert.deepEqual(handOf(b.engine, P1), hand);
});

clause(DFM, "0:ability:hock", "HOCK deplete: a depleted market cannot be used again (second use refused, same turn)", () => {
  const b = dfmBoard({ greed: 3 });
  hock(b, [b.id("mine")]);
  resolvePendingResponses(b.engine);
  const hand = handOf(b.engine, P1);
  refused(() => hock(b, [b.id("mine2")]), "market already depleted", /costs cannot be paid|deplet/i);
  assert.equal(zoneOf(b.engine, b.id("mine2")), "play");
  assert.deepEqual(handOf(b.engine, P1), hand);
  assert.equal(ready(b.engine, P1), 2, "nothing more paid");
});

clause(DFM, "0:ability:hock", "HOCK destroys 'a character you own': an opponent's character, a location and no pick are refused", () => {
  const b = dfmBoard();
  refused(() => hock(b, [b.id("foe")]), "opponent's character", /target|select|valid|illegal/i);
  refused(() => hock(b, [b.id("mk")]), "the market is not a character", /target|select|valid|illegal/i);
  refused(() => hock(b, []), "no pick", /target|select|valid|illegal/i);
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  assert.equal(b.engine.state.cards[b.id("mk")].depleted, false);
  assert.equal(ready(b.engine, P1), 2);
  hock(b, [b.id("mine")]);
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard", "control");
});

clause(DFM, "0:ability:hock", "'you own' is ownership: a character you own but an opponent controls can be destroyed, one you control but they own cannot", () => {
  const b = dfmBoard();
  refused(() => hock(b, [b.id("stolen")]), "controlled but not owned", /target|select|valid|illegal/i);
  assert.equal(zoneOf(b.engine, b.id("stolen")), "play");
  assert.equal(ready(b.engine, P1), 2);
  hock(b, [b.id("lent")]);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("lent")), "discard", "owned but not controlled is allowed");
});

clause(DFM, "1:ability:weedle", "WEEDLE with [G]x6: pays 2, depletes the market, destroys the chosen character you own, and draws 3 cards", () => {
  const b = dfmBoard({ greed: 6 });
  const deckBefore = deckOf(b.engine, P1);
  const handBefore = handOf(b.engine, P1);
  weedle(b, [b.id("mine")]);
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine), undefined);
  assert.equal(ready(b.engine, P1), 4, "exactly 2 paid");
  assert.equal(b.engine.state.cards[b.id("mk")].depleted, true);
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  assert.equal(zoneOf(b.engine, b.id("mine2")), "play");
  assert.deepEqual(handOf(b.engine, P1), [...handBefore, ...deckBefore.slice(0, 3)], "drew exactly the top 3 cards");
  assert.equal(deckOf(b.engine, P1).length, deckBefore.length - 3);
});

clause(DFM, "1:ability:weedle", "WEEDLE needs [G]x6: five Greed plus a Volition is refused with nothing paid", () => {
  const b = dfmBoard({ greed: 5, vol: 1 });
  assert.equal(ready(b.engine, P1), 6);
  const hand = handOf(b.engine, P1);
  refused(() => weedle(b, [b.id("mine")]), "only five [G]", /threshold|icon/i);
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  assert.equal(b.engine.state.cards[b.id("mk")].depleted, false);
  assert.equal(ready(b.engine, P1), 6);
  assert.deepEqual(handOf(b.engine, P1), hand);
});

clause(DFM, "1:ability:weedle", "WEEDLE pay 2: with only one ready resource (the other five Greed spent) it is refused; with two ready it works", () => {
  const b = dfmBoard({ greed: 1, spent: 5 });
  assert.equal(ready(b.engine, P1), 1);
  refused(() => weedle(b, [b.id("mine")]), "cannot pay 2", /afford|resource|pay|cost/i);
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  assert.equal(b.engine.state.cards[b.id("mk")].depleted, false);
  const ok = dfmBoard({ greed: 2, spent: 4 });
  weedle(ok, [ok.id("mine")]);
  resolvePendingResponses(ok.engine);
  assert.equal(zoneOf(ok.engine, ok.id("mine")), "discard", "control");
  assert.equal(ready(ok.engine, P1), 0);
});

clause(DFM, "1:ability:weedle", "WEEDLE deplete: refused when the market is already depleted", () => {
  const b = dfmBoard({ greed: 6 });
  b.engine.state.cards[b.id("mk")].depleted = true;
  refused(() => weedle(b, [b.id("mine")]), "depleted", /costs cannot be paid|deplet/i);
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  assert.equal(ready(b.engine, P1), 6);
});

clause(DFM, "1:ability:weedle", "WEEDLE destroys only 'a character you own': opponent's character and no pick are refused; owned-but-lent is allowed, controlled-but-not-owned is not", () => {
  const b = dfmBoard({ greed: 6 });
  refused(() => weedle(b, [b.id("foe")]), "opponent's character", /target|select|valid|illegal/i);
  refused(() => weedle(b, [b.id("stolen")]), "controlled but not owned", /target|select|valid|illegal/i);
  refused(() => weedle(b, []), "no pick", /target|select|valid|illegal/i);
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  assert.equal(zoneOf(b.engine, b.id("stolen")), "play");
  assert.equal(ready(b.engine, P1), 6);
  weedle(b, [b.id("lent")]);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("lent")), "discard", "control");
});
