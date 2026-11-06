// Clause tests — batch seed-saga-08, part p1 (groups 1-6, missing clauses only: Tamper,
// Thorough Sanitization, Time Traveler Tourist Trap, Velocious Golem, Warmachine Smelder,
// Affectionate Dollkeeper). Expectations come from each card's PRINTED text; engine data
// is only used to drive the engine.

import assert from "node:assert/strict";
import { buildGame, activate, bank, character, developFaction, item, location, play, volition, P1, P2 } from "../per-card/_harness.js";
import { clause, drain, declineAll, printing, refused, flipUpNow, holdCostChoices } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { declareAttackBy, fight } from "./_battle.js";
import { fillers, readyResources, zoneOf } from "./_board.js";
import { endTurn } from "./_turn.js";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

const dev = (cards: CardPlacement[], extra: Parameters<typeof buildGame>[0] = {}) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, random: () => 0, ...extra, cards });

const E = (n: number, owner: PlayerId = P1): CardPlacement[] => bank("elitism", n, owner);
const D = (n: number, owner: PlayerId = P1): CardPlacement[] => bank("deception", n, owner);
const V = (n: number, owner: PlayerId = P1): CardPlacement[] => volition(n, owner);
/** `n` resources already spent (attached to the faction): they count for thresholds but cannot pay. */
const spent = (icon: "elitism" | "deception", n: number, owner: PlayerId = P1): CardPlacement[] =>
  bank(icon, n, owner).map((p) => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

const handOf = (e: SpoilsEngine, p: PlayerId): CardInstanceId[] => [...e.state.players[p].hand];
const deckOf = (e: SpoilsEngine, p: PlayerId): CardInstanceId[] => [...e.state.players[p].deck];

const ABILITY_EFFECT = [{ type: "draw", player: "controller", amount: 1 }];
const withAbility = (kind: "activated" | "triggered" | "continuous", over: Partial<Parameters<typeof character>[0]> = {}) => {
  const ability =
    kind === "activated"
      ? { id: "a1", type: "activated", effects: ABILITY_EFFECT }
      : kind === "triggered"
        ? { id: "a1", type: "triggered", event: "cardEnteredPlay", effects: ABILITY_EFFECT }
        : { id: "a1", type: "continuous", modifiers: [] };
  return character({ name: `With ${kind}`, behavior: { abilities: [ability] } as never, ...over });
};

const pickTargets = (selected: CardInstanceId[], optionIndex = 0) => (pc: PendingChoiceLike): unknown =>
  pc.kind === "chooserSelectsTarget"
    ? { kind: "chooserSelectsTarget", selected }
    : pc.kind === "chooserSelectsOption"
      ? { kind: "chooserSelectsOption", index: optionIndex }
      : declineAll(pc);

function flipUpRaw(engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}, variables: Record<string, number> = {}): void {
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables });
}
const flipUp = (engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}): void => {
  flipUpRaw(engine, player, cardId, selected);
  drain(engine, declineAll);
};

const revealsOf = (e: SpoilsEngine) => e.getLog().filter((entry) => entry.event?.type === "cardsRevealed");

// =====================================================================================
// Tamper
// =====================================================================================

const TAMPER = "e489dcd8-52d3-414e-8d7a-1ced648b5b61"; // EXTRA COST: Pick a character with an ability in its rules text. -- Destroy the character. -- FLIP UP: 1 [E][E]

function tamperBoard(res: CardPlacement[], opts: { tamper?: "hand" | "facedown"; spentTamper?: boolean } = {}) {
  return dev([
    opts.tamper === "facedown"
      ? { key: "tam", def: printing(TAMPER), owner: P1, zone: "play", faceDown: true, ...(opts.spentTamper ? { attachedToKey: "__factionA" } : {}) }
      : { key: "tam", def: printing(TAMPER), owner: P1, zone: "hand" },
    { key: "act", def: withAbility("activated"), owner: P2, zone: "play" },
    { key: "trig", def: withAbility("triggered"), owner: P2, zone: "play" },
    { key: "cont", def: withAbility("continuous"), owner: P1, zone: "play" },
    { key: "own", def: withAbility("activated", { name: "Mine" }), owner: P1, zone: "play" },
    { key: "van", def: character({ name: "Vanilla" }), owner: P2, zone: "play" },
    { key: "itm", def: item({ name: "Item With Ability", behavior: { abilities: [{ id: "i1", type: "activated", effects: ABILITY_EFFECT }] } as never }), owner: P2, zone: "play" },
    { key: "dis", def: withAbility("activated", { name: "Discarded" }), owner: P2, zone: "discard" },
    ...res
  ]);
}

const tamperPlay = (g: ReturnType<typeof tamperBoard>, target: string) => play(g.engine, P1, g.id("tam"), { selected: { c: [g.id(target)] } });

clause(TAMPER, "0:extraCost", "printed as a Gearsmith tactic, cost 3, threshold [E][E]: deploys with exactly enough", () => {
  const p = printing(TAMPER);
  assert.deepEqual([p.type, p.trade, p.cost, p.threshold], ["tactic", "gearsmith", 3, "ee"]);
  const g = tamperBoard([...E(2), ...V(1)]);
  tamperPlay(g, "act");
  assert.equal(zoneOf(g.engine, g.id("tam")), "discard", "the tactic resolved and was discarded");
  assert.equal(zoneOf(g.engine, g.id("act")), "discard");
  assert.equal(readyResources(g.engine, P1), 0, "paid its full cost of 3");
});

clause(TAMPER, "0:extraCost", "one resource short of the cost of 3 is refused (threshold met)", () => {
  const ok = tamperBoard([...E(2), ...V(1)]);
  tamperPlay(ok, "act");
  const g = tamperBoard([...E(2)]);
  refused(() => tamperPlay(g, "act"), "cost 3 with only 2 resources", /afford|resource|cost|pay/i);
  assert.equal(zoneOf(g.engine, g.id("act")), "play");
  assert.equal(zoneOf(g.engine, g.id("tam")), "hand");
});

clause(TAMPER, "0:extraCost", "one [E] icon short of the threshold [E][E] is refused (cost payable)", () => {
  const g = tamperBoard([...E(1), ...V(3)]);
  refused(() => tamperPlay(g, "act"), "threshold ee with a single E", /threshold|icon|afford|resource/i);
  assert.equal(zoneOf(g.engine, g.id("act")), "play");
  const none = tamperBoard([...V(4)]);
  refused(() => tamperPlay(none, "act"), "no E at all", /threshold|icon|afford|resource/i);
});

clause(TAMPER, "0:extraCost", "the opponent's [E] do not count toward the threshold", () => {
  const g = tamperBoard([...E(1), ...V(2), ...E(3, P2)]);
  refused(() => tamperPlay(g, "act"), "the threshold counts only my icons", /threshold|icon|afford|resource/i);
});

clause(TAMPER, "0:extraCost", "any character with an (activated) ability may be picked, mine or the opponent's", () => {
  // E9b (Q33): "an ability" is an activated ability (a named cost/effect entry); triggered and continuous paragraphs are not abilities.
  for (const target of ["act", "own"]) {
    const g = tamperBoard([...E(3)]);
    tamperPlay(g, target);
    assert.equal(zoneOf(g.engine, g.id(target)), "discard", `${target} was destroyed`);
  }
});

clause(TAMPER, "0:extraCost", "a character whose only text is a triggered or continuous paragraph is not 'a character with an ability' (Q33)", () => {
  const ok = tamperBoard([...E(3)]);
  tamperPlay(ok, "act");
  for (const target of ["trig", "cont"]) {
    const g = tamperBoard([...E(3)]);
    refused(() => tamperPlay(g, target), `${target} has no activated ability`);
    assert.equal(zoneOf(g.engine, g.id(target)), "play", `${target} stays in play`);
    assert.equal(zoneOf(g.engine, g.id("tam")), "hand", "the tactic stayed in hand");
  }
});

clause(TAMPER, "0:extraCost", "a vanilla character, an item with an ability and a discarded character may not be picked", () => {
  const ok = tamperBoard([...E(3)]);
  tamperPlay(ok, "act");
  for (const target of ["van", "itm", "dis"]) {
    const g = tamperBoard([...E(3)]);
    refused(() => tamperPlay(g, target), `${target} is not a character with an ability in play`);
    assert.equal(zoneOf(g.engine, g.id("tam")), "hand", "the tactic stayed in hand");
    assert.equal(readyResources(g.engine, P1), 3, "nothing was paid");
  }
});

clause(TAMPER, "0:extraCost", "a face-down character (a resource) may not be picked", () => {
  const g = dev([
    { key: "tam", def: printing(TAMPER), owner: P1, zone: "hand" },
    { key: "fd", def: withAbility("activated", { name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
    ...E(3)
  ]);
  refused(() => play(g.engine, P1, g.id("tam"), { selected: { c: [g.id("fd")] } }), "face-down card is a resource");
  assert.equal(zoneOf(g.engine, g.id("fd")), "play");
});

clause(TAMPER, "0:extraCost", "playing it without picking a character is refused (the pick is an extra cost)", () => {
  const g = tamperBoard([...E(3)]);
  refused(() => play(g.engine, P1, g.id("tam"), { selected: {} }), "no pick given");
  assert.equal(zoneOf(g.engine, g.id("tam")), "hand");
  assert.equal(readyResources(g.engine, P1), 3);
});

clause(TAMPER, "1:rule", "destroys the picked character (to its owner's discard) and nothing else", () => {
  const g = tamperBoard([...E(3)]);
  tamperPlay(g, "act");
  assert.ok(g.engine.state.players[P2].discard.includes(g.id("act")), "owner's discard");
  for (const k of ["trig", "cont", "own", "van", "itm"]) assert.equal(zoneOf(g.engine, g.id(k)), "play", `${k} is untouched`);
  assert.equal(zoneOf(g.engine, g.id("dis")), "discard");
});

clause(TAMPER, "1:rule", "it destroys my own character with an ability equally", () => {
  const g = tamperBoard([...E(3)]);
  tamperPlay(g, "own");
  assert.ok(g.engine.state.players[P1].discard.includes(g.id("own")), "g.engine.state.players[P1].discard.includes(g.id(\"own\"))");
});

clause(TAMPER, "2:flipUp", "FLIP UP 1 [E][E]: flips up and destroys the picked character, paying 1 (not the printed 3)", () => {
  const g = tamperBoard([...spent("elitism", 2)], { tamper: "facedown" });
  flipUp(g.engine, P1, g.id("tam"), { c: [g.id("act")] });
  assert.equal(zoneOf(g.engine, g.id("act")), "discard", "the character was destroyed");
  assert.equal(zoneOf(g.engine, g.id("tam")), "discard", "the tactic resolved");
  assert.equal(g.engine.state.cards[g.id("tam")].faceDown, false);
});

clause(TAMPER, "2:flipUp", "FLIP UP works with spare resources, paying exactly 1 of them (rule-neutral on which)", () => {
  const g = tamperBoard([...E(2), ...V(2)], { tamper: "facedown" });
  const before = readyResources(g.engine, P1);
  flipUp(g.engine, P1, g.id("tam"), { c: [g.id("act")] });
  assert.equal(zoneOf(g.engine, g.id("act")), "discard");
  assert.ok([before - 1, before - 2].includes(readyResources(g.engine, P1)), "1 paid; the tactic itself leaves the resource pool");
});

clause(TAMPER, "2:flipUp", "FLIP UP threshold [E][E]: one [E] short is refused (the card's own face-down icon does not count)", () => {
  const ok = tamperBoard([...spent("elitism", 2)], { tamper: "facedown" });
  flipUp(ok.engine, P1, ok.id("tam"), { c: [ok.id("act")] });
  const g = tamperBoard([...spent("elitism", 1), ...V(2)], { tamper: "facedown" });
  refused(() => flipUp(g.engine, P1, g.id("tam"), { c: [g.id("act")] }), "one E short", /threshold|icon/i);
  assert.equal(zoneOf(g.engine, g.id("act")), "play");
  assert.equal(g.engine.state.cards[g.id("tam")].faceDown, true, "still face-down");
});

clause(TAMPER, "2:flipUp", "FLIP UP cost 1 must be affordable: with nothing ready it is refused", () => {
  const g = tamperBoard([...spent("elitism", 2)], { tamper: "facedown", spentTamper: true });
  refused(() => flipUp(g.engine, P1, g.id("tam"), { c: [g.id("act")] }), "cost 1 with nothing ready", /afford|resource|cost|pay|spent|ready/i);
  assert.equal(zoneOf(g.engine, g.id("act")), "play");
});

clause(TAMPER, "2:flipUp", "FLIP UP still needs a legal pick: a vanilla character is refused", () => {
  const ok = tamperBoard([...E(2)], { tamper: "facedown" });
  flipUp(ok.engine, P1, ok.id("tam"), { c: [ok.id("act")] });
  const g = tamperBoard([...E(2)], { tamper: "facedown" });
  refused(() => flipUp(g.engine, P1, g.id("tam"), { c: [g.id("van")] }), "vanilla character");
  refused(() => flipUp(g.engine, P1, g.id("tam"), {}), "no pick");
  assert.equal(zoneOf(g.engine, g.id("van")), "play");
});

clause(TAMPER, "2:flipUp", "a Tamper in hand cannot be FLIP UPed", () => {
  const g = tamperBoard([...E(3)]);
  refused(() => flipUp(g.engine, P1, g.id("tam"), { c: [g.id("act")] }), "not face-down in play");
  assert.equal(zoneOf(g.engine, g.id("act")), "play");
});

// =====================================================================================
// Thorough Sanitization
// =====================================================================================

const SANITIZE = "87849b3c-2318-457b-bf96-e926ceea99ac"; // EXTRA COST: Pick an item. -- Flip the item face-down under its owner's control. -- FLIP UP: 1 [E] and draw a card.

const gizmo = (name: string) =>
  item({ name, behavior: { abilities: [{ id: "g1", type: "activated", effects: ABILITY_EFFECT }] } as never });

function sanBoard(res: CardPlacement[], opts: { tactic?: "hand" | "facedown"; spentTactic?: boolean } = {}) {
  return dev([
    opts.tactic === "facedown"
      ? { key: "san", def: printing(SANITIZE), owner: P1, zone: "play", faceDown: true, ...(opts.spentTactic ? { attachedToKey: "__factionA" } : {}) }
      : { key: "san", def: printing(SANITIZE), owner: P1, zone: "hand" },
    { key: "mine", def: gizmo("Mine"), owner: P1, zone: "play" },
    { key: "theirs", def: gizmo("Theirs"), owner: P2, zone: "play" },
    { key: "lentOut", def: gizmo("Lent Out"), owner: P1, controller: P2, zone: "play" },
    { key: "borrowed", def: gizmo("Borrowed"), owner: P2, controller: P1, zone: "play" },
    { key: "bystander", def: gizmo("Bystander"), owner: P1, zone: "play" },
    { key: "chr", def: character({ name: "A Character" }), owner: P2, zone: "play" },
    { key: "loc", def: location({ name: "A Location" }), owner: P2, zone: "play" },
    { key: "hnd", def: gizmo("Hand Item"), owner: P1, zone: "hand" },
    { key: "dsc", def: gizmo("Discarded Item"), owner: P1, zone: "discard" },
    ...fillers("d1-", 3, P1, "deck"),
    ...fillers("d2-", 3, P2, "deck"),
    ...res
  ]);
}
const sanPlay = (g: ReturnType<typeof sanBoard>, target: string) => play(g.engine, P1, g.id("san"), { selected: { grime: [g.id(target)] } });

clause(SANITIZE, "0:extraCost", "printed as a Gearsmith tactic, cost 1, threshold [E]: deploys with exactly enough", () => {
  const p = printing(SANITIZE);
  assert.deepEqual([p.type, p.trade, p.cost, p.threshold], ["tactic", "gearsmith", 1, "e"]);
  const g = sanBoard([...E(1)]);
  sanPlay(g, "theirs");
  assert.equal(zoneOf(g.engine, g.id("san")), "discard");
  assert.equal(readyResources(g.engine, P1), 0, "paid 1 (the flipped item is the opponent's, so it adds no resource for me)");
});

clause(SANITIZE, "0:extraCost", "with nothing to pay with it is refused; without an [E] icon it is refused", () => {
  const g = sanBoard([]);
  refused(() => sanPlay(g, "mine"), "cost 1 with no resources", /afford|resource|cost|pay|threshold/i);
  assert.equal(g.engine.state.cards[g.id("mine")].faceDown, false);
  const noE = sanBoard([...V(3), ...D(2)]);
  refused(() => sanPlay(noE, "mine"), "threshold e with no E", /threshold|icon/i);
  const theirs = sanBoard([...V(2), ...E(2, P2)]);
  refused(() => sanPlay(theirs, "mine"), "the opponent's E do not count", /threshold|icon/i);
  assert.equal(zoneOf(noE.engine, noE.id("san")), "hand");
});

clause(SANITIZE, "0:extraCost", "any item in play may be picked: mine, the opponent's, lent-out and borrowed", () => {
  for (const target of ["mine", "theirs", "lentOut", "borrowed"]) {
    const g = sanBoard([...E(1)]);
    sanPlay(g, target);
    assert.equal(g.engine.state.cards[g.id(target)].faceDown, true, `${target} was flipped face-down`);
  }
});

clause(SANITIZE, "0:extraCost", "a character, a location, an item in hand or in the discard may not be picked", () => {
  for (const target of ["chr", "loc", "hnd", "dsc"]) {
    const g = sanBoard([...E(1)]);
    refused(() => sanPlay(g, target), `${target} is not an item in play`);
    assert.equal(zoneOf(g.engine, g.id("san")), "hand");
    assert.equal(readyResources(g.engine, P1), 1, "nothing was paid");
  }
});

clause(SANITIZE, "0:extraCost", "an already face-down item may not be picked, and a pick is required", () => {
  const g = dev([
    { key: "san", def: printing(SANITIZE), owner: P1, zone: "hand" },
    { key: "fd", def: gizmo("Hidden"), owner: P2, zone: "play", faceDown: true },
    { key: "mine", def: gizmo("Mine"), owner: P1, zone: "play" },
    ...E(1)
  ]);
  refused(() => play(g.engine, P1, g.id("san"), { selected: { grime: [g.id("fd")] } }), "a face-down card is a resource");
  refused(() => play(g.engine, P1, g.id("san"), { selected: {} }), "no pick");
  assert.equal(readyResources(g.engine, P1), 1, "my E remains unspent (the opponent's face-down card is not my resource)");
});

clause(SANITIZE, "1:rule", "my own item is flipped face-down and stays in play under my control, becoming a resource", () => {
  const g = sanBoard([...E(1)]);
  const before = g.engine.getAvailableResourceCount(P1);
  sanPlay(g, "mine");
  const card = g.engine.state.cards[g.id("mine")];
  assert.equal(card.faceDown, true);
  assert.equal(card.zone, "play");
  assert.equal(card.controllerId, P1);
  assert.equal(g.engine.getAvailableResourceCount(P1), before - 1 + 1, "paid 1 and gained the face-down item as a Volition resource");
});

clause(SANITIZE, "1:rule", "the opponent's item is flipped face-down under the opponent's (its owner's) control", () => {
  const g = sanBoard([...E(1)]);
  const before = g.engine.getAvailableResourceCount(P2);
  sanPlay(g, "theirs");
  const card = g.engine.state.cards[g.id("theirs")];
  assert.equal(card.faceDown, true);
  assert.equal(card.zone, "play");
  assert.equal(card.controllerId, P2);
  assert.equal(g.engine.getAvailableResourceCount(P2), before + 1, "the owner gained a Volition");
});

clause(SANITIZE, "1:rule", "an item I own but the opponent controls ends face-down under MY (its owner's) control", () => {
  const g = sanBoard([...E(1)]);
  const before = g.engine.getAvailableResourceCount(P1);
  sanPlay(g, "lentOut");
  const card = g.engine.state.cards[g.id("lentOut")];
  assert.equal(card.faceDown, true);
  assert.equal(card.ownerId, P1);
  assert.equal(card.controllerId, P1, "returned to its owner's control");
  assert.equal(g.engine.getAvailableResourceCount(P1), before - 1 + 1);
});

clause(SANITIZE, "1:rule", "an item I control but the opponent owns ends face-down under THEIR (its owner's) control", () => {
  const g = sanBoard([...E(1)]);
  const before = g.engine.getAvailableResourceCount(P2);
  sanPlay(g, "borrowed");
  const card = g.engine.state.cards[g.id("borrowed")];
  assert.equal(card.faceDown, true);
  assert.equal(card.ownerId, P2);
  assert.equal(card.controllerId, P2, "returned to its owner's control");
  assert.equal(g.engine.getAvailableResourceCount(P2), before + 1);
});

clause(SANITIZE, "1:rule", "only the picked item flips; it loses its abilities and other items are untouched", () => {
  const g = sanBoard([...E(1)]);
  const listed = (k: string) => g.engine.getAvailableActivatedAbilities(P1).some((a) => a.cardId === g.id(k));
  assert.ok(listed("mine") && listed("bystander"), "both items have abilities before");
  sanPlay(g, "mine");
  assert.ok(!listed("mine"), "a face-down card has no rules text");
  assert.ok(listed("bystander"), "the other item still works");
  assert.equal(g.engine.state.cards[g.id("bystander")].faceDown, false);
  assert.equal(g.engine.state.cards[g.id("theirs")].faceDown, false);
  assert.equal(g.engine.state.cards[g.id("borrowed")].faceDown, false);
  assert.ok(!g.engine.state.players[P1].discard.includes(g.id("mine")), "flipped, not destroyed");
});

clause(SANITIZE, "2:flipUp", "FLIP UP 1 [E] and draw a card: flips up, flips the item face-down and draws exactly one card", () => {
  const g = sanBoard([...spent("elitism", 1)], { tactic: "facedown" });
  const topBefore = deckOf(g.engine, P1)[0];
  const handBefore = handOf(g.engine, P1).length;
  const oppHand = handOf(g.engine, P2).length;
  flipUp(g.engine, P1, g.id("san"), { grime: [g.id("theirs")] });
  assert.equal(g.engine.state.cards[g.id("theirs")].faceDown, true, "the rule effect ran");
  assert.equal(handOf(g.engine, P1).length, handBefore + 1, "drew exactly one");
  assert.ok(handOf(g.engine, P1).includes(topBefore), "the top card of my deck");
  assert.equal(handOf(g.engine, P2).length, oppHand, "the opponent drew nothing");
  assert.equal(zoneOf(g.engine, g.id("san")), "discard");
});

clause(SANITIZE, "2:flipUp", "FLIP UP threshold [E]: no [E] is refused (the opponent's [E] and the card's own volition do not count)", () => {
  const g = sanBoard([...V(2), ...E(2, P2)], { tactic: "facedown" });
  refused(() => flipUp(g.engine, P1, g.id("san"), { grime: [g.id("mine")] }), "no E", /threshold|icon/i);
  assert.equal(g.engine.state.cards[g.id("mine")].faceDown, false);
  assert.equal(g.engine.state.cards[g.id("san")].faceDown, true);
});

clause(SANITIZE, "2:flipUp", "FLIP UP cost 1 must be affordable: with nothing ready it is refused", () => {
  const g = sanBoard([...spent("elitism", 1)], { tactic: "facedown", spentTactic: true });
  refused(() => flipUp(g.engine, P1, g.id("san"), { grime: [g.id("mine")] }), "nothing ready", /afford|resource|cost|pay|spent|ready/i);
  assert.equal(g.engine.state.cards[g.id("mine")].faceDown, false);
});

clause(SANITIZE, "2:flipUp", "FLIP UP still needs a legal item pick", () => {
  const g = sanBoard([...E(1)], { tactic: "facedown" });
  refused(() => flipUp(g.engine, P1, g.id("san"), { grime: [g.id("chr")] }), "a character is not an item");
  refused(() => flipUp(g.engine, P1, g.id("san"), {}), "no pick");
  assert.equal(g.engine.state.cards[g.id("san")].faceDown, true, "still face-down after the refused flips");
});

// =====================================================================================
// Time Traveler Tourist Trap
// =====================================================================================

const TRAP = "03441b15-b428-4453-9d12-89fd64e73c58";
// ENSNARE -- COST: Pay 1 or destroy a Micromajig token you control. -- EFFECT: Put a token on this card.
// MICROMAJIG APOCALYPSE: [E][E][E][E][E][E] -- COST: Use this only if there are at least 20 tokens on this card. Destroy this card. -- EFFECT: Put X Micromajig tokens into play under your control, where X is the number of cards in an opponent's deck.

const MICRO_TOKEN = { name: "Micromajig", cardType: "character", subtype: ["majig"], strength: 1, life: 1, speed: 3 };
const maker = (n: number) =>
  item({ name: "Token Maker", behavior: { abilities: [{ id: "mk", type: "activated", effects: [{ type: "createTokens", controller: "controller", count: n, token: MICRO_TOKEN }] }] } as never });

const tokensOf = (e: SpoilsEngine, owner: PlayerId, name = "Micromajig") =>
  Object.values(e.state.cards).filter((c) => c.isToken && c.ownerId === owner && c.zone === "play" && e.getDefinition(c.id).name === name);
const tokenCount = (e: SpoilsEngine, id: CardInstanceId): number => e.state.cards[id].counters?.token ?? 0;

function trapBoard(res: CardPlacement[], opts: { counters?: Record<string, number>; oppDeck?: number; trap?: "hand" | "play" } = {}) {
  return dev([
    { key: "trap", def: printing(TRAP), owner: P1, zone: opts.trap ?? "play", ...(opts.counters ? { counters: opts.counters } : {}) },
    { key: "mk", def: maker(1), owner: P1, zone: "play" },
    { key: "omk", def: maker(1), owner: P2, zone: "play" },
    { key: "other", def: location({ name: "Other Place" }), owner: P1, zone: "play" },
    ...fillers("myd-", 4, P1, "deck"),
    ...fillers("opd-", opts.oppDeck ?? 3, P2, "deck"),
    ...res
  ]);
}
const makeTokens = (g: ReturnType<typeof trapBoard>, who: PlayerId = P1, times = 1) => {
  for (let i = 0; i < times; i++) activate(g.engine, who, g.id(who === P1 ? "mk" : "omk"), "mk");
};
const ensnare = (g: ReturnType<typeof trapBoard>) => {
  activate(g.engine, P1, g.id("trap"), "ensnare");
  drain(g.engine, declineAll);
};

clause(TRAP, "0:ability:ensnare", "printed as a Gearsmith location, cost 2, threshold [E], structure 12: deploys with exactly enough", () => {
  const p = printing(TRAP);
  assert.deepEqual([p.type, p.trade, p.cost, p.threshold, p.structure], ["location", "gearsmith", 2, "e", 12]);
  const g = trapBoard([...E(1), ...V(1)], { trap: "hand" });
  play(g.engine, P1, g.id("trap"));
  assert.equal(zoneOf(g.engine, g.id("trap")), "play");
  assert.equal(g.engine.getStat(g.id("trap"), "structure"), 12);
  assert.equal(readyResources(g.engine, P1), 0, "paid 2");
});

clause(TRAP, "0:ability:ensnare", "one resource short of the cost of 2 is refused; no [E] icon is refused", () => {
  const short = trapBoard([...E(1)], { trap: "hand" });
  refused(() => play(short.engine, P1, short.id("trap")), "cost 2 with one resource", /afford|resource|cost|pay/i);
  const noE = trapBoard([...V(3)], { trap: "hand" });
  refused(() => play(noE.engine, P1, noE.id("trap")), "threshold e with no E", /threshold|icon/i);
  const theirs = trapBoard([...V(2), ...E(2, P2)], { trap: "hand" });
  refused(() => play(theirs.engine, P1, theirs.id("trap")), "the opponent's E do not count", /threshold|icon/i);
  assert.equal(zoneOf(short.engine, short.id("trap")), "hand");
});

clause(TRAP, "0:ability:ensnare", "ENSNARE paying 1: puts exactly one token on this card and costs exactly 1", () => {
  const g = trapBoard([...V(3)]);
  assert.equal(tokenCount(g.engine, g.id("trap")), 0);
  const before = readyResources(g.engine, P1);
  ensnare(g);
  assert.equal(tokenCount(g.engine, g.id("trap")), 1);
  assert.equal(readyResources(g.engine, P1), before - 1);
  ensnare(g);
  assert.equal(tokenCount(g.engine, g.id("trap")), 2, "tokens accumulate");
  assert.equal(readyResources(g.engine, P1), before - 2);
  assert.equal(tokenCount(g.engine, g.id("other")), 0, "no other card gets a token");
});

clause(TRAP, "0:ability:ensnare", "ENSNARE needs a cost: with no resource and no Micromajig token it is refused", () => {
  const g = trapBoard([]);
  refused(() => ensnare(g), "nothing to pay or destroy", /afford|resource|cost|pay|target|destroy/i);
  assert.equal(tokenCount(g.engine, g.id("trap")), 0);
  const spentOnly = trapBoard([...spent("elitism", 2)]);
  refused(() => ensnare(spentOnly), "spent resources cannot pay", /afford|resource|cost|pay|target|destroy/i);
});

clause(TRAP, "0:ability:ensnare", "ENSNARE by destroying a Micromajig token I control (no resources needed): the token is destroyed and a token is put on this card", () => holdCostChoices(() => {
  const g = trapBoard([]);
  makeTokens(g);
  assert.equal(tokensOf(g.engine, P1).length, 1, "one Micromajig token to start");
  ensnare(g);
  assert.equal(tokensOf(g.engine, P1).length, 0, "the Micromajig token was destroyed");
  assert.equal(tokenCount(g.engine, g.id("trap")), 1);
}));

clause(TRAP, "0:ability:ensnare", "ENSNARE destroying a token costs no resources: spare resources stay ready", () => holdCostChoices(() => {
  const g = trapBoard([...V(2)]);
  makeTokens(g);
  const before = readyResources(g.engine, P1);
  const resolve = (pc: PendingChoiceLike): unknown => (pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 1 } : declineAll(pc));
  activate(g.engine, P1, g.id("trap"), "ensnare");
  drain(g.engine, resolve);
  assert.equal(tokenCount(g.engine, g.id("trap")), 1);
  assert.equal(1 - tokensOf(g.engine, P1).length + (readyResources(g.engine, P1) < before ? 1 : 0), 1, "exactly one of the two costs was paid (the token destroyed XOR a resource spent)");
}));

clause(TRAP, "0:ability:ensnare", "ENSNARE: I choose between 'pay 1' and 'destroy a Micromajig token' when both are possible", () => holdCostChoices(() => {
  const g = trapBoard([...V(2)]);
  makeTokens(g);
  const before = readyResources(g.engine, P1);
  activate(g.engine, P1, g.id("trap"), "ensnare");
  const pc = g.engine.state.pendingChoice as unknown as PendingChoiceLike | undefined;
  assert.ok(pc, "the player is asked which cost to pay");
  drain(g.engine, (c) => (c.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 1 } : declineAll(c)));
  assert.equal(tokensOf(g.engine, P1).length, 0, "choosing 'destroy a token' destroys the token");
  assert.equal(readyResources(g.engine, P1), before, "and pays nothing");
  assert.equal(tokenCount(g.engine, g.id("trap")), 1);
}));

clause(TRAP, "0:ability:ensnare", "ENSNARE can destroy a real Micromajig token (subtype majig) as its cost", () => holdCostChoices(() => {
  const g = trapBoard([]);
  makeTokens(g);
  assert.equal(tokensOf(g.engine, P1).length, 1);
  ensnare(g);
  assert.equal(tokensOf(g.engine, P1).length, 0);
  assert.equal(tokenCount(g.engine, g.id("trap")), 1);
}));

clause(TRAP, "0:ability:ensnare", "the opponent's Micromajig token cannot be destroyed to pay (only 'you control')", () => {
  const g = trapBoard([]);
  endTurn(g.engine, P1);
  makeTokens(g, P2);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(tokensOf(g.engine, P2).length, 1);
  refused(() => ensnare(g), "only the opponent has a token", /afford|resource|cost|pay|target|destroy/i);
  assert.equal(tokensOf(g.engine, P2).length, 1, "their token survives");
  assert.equal(tokenCount(g.engine, g.id("trap")), 0);
});

// A token that also carries the engine's authored subtype "micromajig" lets the destroy branch be exercised
// despite seed-saga-08-p1-2 (a real token has subtype "majig" only).
const SYNTH_TOKEN = { ...MICRO_TOKEN, subtype: ["majig", "micromajig"] };
const synthMaker = () =>
  item({ name: "Synth Maker", behavior: { abilities: [{ id: "mk", type: "activated", effects: [{ type: "createTokens", controller: "controller", count: 1, token: SYNTH_TOKEN }] }] } as never });
function synthBoard() {
  return dev([
    { key: "trap", def: printing(TRAP), owner: P1, zone: "play" },
    { key: "mk", def: synthMaker(), owner: P1, zone: "play" },
    { key: "omk", def: synthMaker(), owner: P2, zone: "play" },
    ...fillers("myd-", 4, P1, "deck"),
    ...fillers("opd-", 3, P2, "deck")
  ]);
}

clause(TRAP, "0:ability:ensnare", "ENSNARE destroys a Micromajig-subtyped token I control as its cost (no resources), and not the opponent's", () => {
  const g = synthBoard();
  activate(g.engine, P1, g.id("mk"), "mk");
  assert.equal(tokensOf(g.engine, P1).length, 1);
  ensnare(g);
  assert.equal(tokensOf(g.engine, P1).length, 0, "my token was destroyed to pay");
  assert.equal(tokenCount(g.engine, g.id("trap")), 1);
  const h = synthBoard();
  endTurn(h.engine, P1);
  activate(h.engine, P2, h.id("omk"), "mk");
  endTurn(h.engine, P2);
  assert.equal(tokensOf(h.engine, P2).length, 1);
  refused(() => ensnare(h), "only the opponent has a token", /afford|resource|cost|pay|target|destroy/i);
  assert.equal(tokensOf(h.engine, P2).length, 1, "their token survives");
  assert.equal(tokenCount(h.engine, h.id("trap")), 0);
});

clause(TRAP, "0:ability:ensnare", "a token I control that is NOT a Micromajig token cannot be destroyed to pay for ENSNARE", () => {
  const sparkMaker = item({
    name: "Spark Maker",
    behavior: { abilities: [{ id: "mk", type: "activated", effects: [{ type: "createTokens", controller: "controller", count: 1, token: { name: "Spark", cardType: "character", subtype: ["spark"], strength: 1, life: 1, speed: 1 } }] }] } as never
  });
  const g = trapBoard([{ key: "sparkmk", def: sparkMaker, owner: P1, zone: "play" }]);
  activate(g.engine, P1, g.id("sparkmk"), "mk");
  assert.equal(tokensOf(g.engine, P1, "Spark").length, 1, "setup: I control a Spark token (not a Micromajig)");
  refused(() => ensnare(g), "the only token I control is not a Micromajig token", /afford|resource|cost|pay|target|destroy/i);
  assert.equal(tokensOf(g.engine, P1, "Spark").length, 1, "the Spark token survives");
  assert.equal(tokenCount(g.engine, g.id("trap")), 0, "no token put on the Trap");
});

clause(TRAP, "0:ability:ensnare", "a non-token card named Micromajig does not count as a Micromajig token", () => {
  const g = trapBoard([{ key: "card", def: character({ name: "Micromajig", subtype: ["majig"] }), owner: P1, zone: "play" }]);
  refused(() => ensnare(g), "a card is not a token", /afford|resource|cost|pay|target|destroy/i);
  assert.equal(zoneOf(g.engine, g.id("card")), "play");
  assert.equal(tokenCount(g.engine, g.id("trap")), 0);
});

clause(TRAP, "1:ability:micromajig-apocalypse", "threshold [E] x6: exactly six [E] works", () => {
  const ok = trapBoard([...E(6)], { counters: { token: 20 } });
  activate(ok.engine, P1, ok.id("trap"), "micromajig-apocalypse");
  assert.equal(zoneOf(ok.engine, ok.id("trap")), "discard");
});

clause(TRAP, "1:ability:micromajig-apocalypse", "threshold [E] x6: five [E] is refused", () => {
  const g = trapBoard([...E(5), ...V(3)], { counters: { token: 20 } });
  refused(() => activate(g.engine, P1, g.id("trap"), "micromajig-apocalypse"), "five E", /threshold|icon/i);
  assert.equal(zoneOf(g.engine, g.id("trap")), "play");
});

clause(TRAP, "1:ability:micromajig-apocalypse", "threshold [E] x6: the opponent's [E] do not count", () => {
  const theirs = trapBoard([...E(5), ...E(6, P2)], { counters: { token: 20 } });
  refused(() => activate(theirs.engine, P1, theirs.id("trap"), "micromajig-apocalypse"), "the opponent's E do not count", /threshold|icon/i);
});

clause(TRAP, "1:ability:micromajig-apocalypse", "use only if at least 20 tokens: 19 is refused, 20 and 25 work", () => {
  for (const n of [20, 25]) {
    const g = trapBoard([...E(6)], { counters: { token: n } });
    activate(g.engine, P1, g.id("trap"), "micromajig-apocalypse");
    assert.equal(zoneOf(g.engine, g.id("trap")), "discard", `${n} tokens`);
  }
  for (const n of [19, 0]) {
    const g = trapBoard([...E(6)], { counters: { token: n } });
    refused(() => activate(g.engine, P1, g.id("trap"), "micromajig-apocalypse"), `${n} tokens`, /condition|token|only|restrict|cannot|can't|not/i);
    assert.equal(zoneOf(g.engine, g.id("trap")), "play", "the location was not destroyed");
  }
});

clause(TRAP, "1:ability:micromajig-apocalypse", "only tokens on THIS card count: tokens on another card do not enable it", () => {
  const g = dev([
    { key: "trap", def: printing(TRAP), owner: P1, zone: "play", counters: { token: 19 } },
    { key: "trap2", def: printing(TRAP), owner: P1, zone: "play", counters: { token: 19 } },
    ...E(6)
  ]);
  refused(() => activate(g.engine, P1, g.id("trap"), "micromajig-apocalypse"), "19 on this card, 38 in total");
  assert.equal(zoneOf(g.engine, g.id("trap")), "play");
});

clause(TRAP, "1:ability:micromajig-apocalypse", "Ensnare 20 times reaches the Apocalypse", () => {
  const g = trapBoard([...E(6), ...V(14)], { counters: { token: 19 } });
  refused(() => activate(g.engine, P1, g.id("trap"), "micromajig-apocalypse"), "19 tokens");
  ensnare(g);
  assert.equal(tokenCount(g.engine, g.id("trap")), 20);
  activate(g.engine, P1, g.id("trap"), "micromajig-apocalypse");
  assert.equal(zoneOf(g.engine, g.id("trap")), "discard");
});

clause(TRAP, "1:ability:micromajig-apocalypse", "destroys this card as its cost", () => {
  const g = trapBoard([...E(6)], { counters: { token: 20 } });
  activate(g.engine, P1, g.id("trap"), "micromajig-apocalypse");
  assert.ok(g.engine.state.players[P1].discard.includes(g.id("trap")), "in my discard");
  assert.equal(zoneOf(g.engine, g.id("other")), "play", "other locations untouched");
});

clause(TRAP, "1:ability:micromajig-apocalypse", "X = cards in the opponent's deck: 3 and 5 tokens under my control, not my own deck's size", () => {
  for (const x of [3, 5]) {
    const g = trapBoard([...E(6)], { counters: { token: 20 }, oppDeck: x });
    const myDeck = deckOf(g.engine, P1).length;
    assert.equal(deckOf(g.engine, P2).length, x, "opponent deck size");
    assert.notEqual(myDeck, x, "distinct from my deck size");
    activate(g.engine, P1, g.id("trap"), "micromajig-apocalypse");
    assert.equal(tokensOf(g.engine, P1).length, x, `X=${x} tokens`);
    assert.equal(tokensOf(g.engine, P2).length, 0, "none for the opponent");
    for (const t of tokensOf(g.engine, P1)) {
      assert.equal(t.controllerId, P1);
      assert.deepEqual([g.engine.getStat(t.id, "strength"), g.engine.getStat(t.id, "life"), g.engine.getStat(t.id, "speed")], [1, 1, 3]);
      assert.ok(g.engine.getDefinition(t.id).subtype.includes("majig"), "g.engine.getDefinition(t.id).subtype.includes(\"majig\")");
      assert.equal(g.engine.getDefinition(t.id).type, "character");
    }
    assert.equal(deckOf(g.engine, P2).length, x, "the opponent's deck is not touched");
  }
});

clause(TRAP, "1:ability:micromajig-apocalypse", "X = 0 when the opponent's deck is empty: no tokens", () => {
  const g = trapBoard([...E(6)], { counters: { token: 20 }, oppDeck: 0 });
  assert.equal(deckOf(g.engine, P2).length, 0);
  activate(g.engine, P1, g.id("trap"), "micromajig-apocalypse");
  assert.equal(tokensOf(g.engine, P1).length, 0);
  assert.equal(zoneOf(g.engine, g.id("trap")), "discard");
});

clause(TRAP, "1:ability:micromajig-apocalypse", "the Micromajig tokens it makes are Gearsmith characters (CR 409.3c)", () => {
  const g = trapBoard([...E(6)], { counters: { token: 20 }, oppDeck: 2 });
  activate(g.engine, P1, g.id("trap"), "micromajig-apocalypse");
  const tokens = tokensOf(g.engine, P1);
  assert.equal(tokens.length, 2);
  for (const t of tokens) assert.equal(g.engine.getDefinition(t.id).trade, "gearsmith");
});

// =====================================================================================
// Velocious Golem
// =====================================================================================

const GOLEM = "4e97e2b1-7346-41ee-9e4c-41f59556816f"; // [E][E][E]: AGGRO

function golemBoard(res: CardPlacement[], opts: { zone?: "hand" | "play"; eligible?: boolean } = {}) {
  return dev([
    { key: "gol", def: printing(GOLEM), owner: P1, zone: opts.zone ?? "play", ...(opts.eligible === false ? { attackEligible: false } : {}) },
    { key: "foe", def: character({ name: "Foe", life: 9 }), owner: P2, zone: "play" },
    ...res
  ]);
}

clause(GOLEM, "0:rule@eee", "printed as a Gearsmith Golem character: cost 5, threshold [E], 4/3/3", () => {
  const p = printing(GOLEM);
  assert.deepEqual([p.type, p.trade, p.cost, p.threshold, p.strength, p.speed, p.life], ["character", "gearsmith", 5, "e", 4, 3, 3]);
  assert.deepEqual(p.subtype, ["golem"]);
  const g = golemBoard([...E(5)], { zone: "hand" });
  play(g.engine, P1, g.id("gol"));
  assert.equal(zoneOf(g.engine, g.id("gol")), "play");
  assert.deepEqual([g.engine.getStat(g.id("gol"), "strength"), g.engine.getStat(g.id("gol"), "speed"), g.engine.getStat(g.id("gol"), "life")], [4, 3, 3]);
});

clause(GOLEM, "0:rule@eee", "one resource short of the cost of 5 is refused; no [E] icon is refused", () => {
  const short = golemBoard([...E(4)], { zone: "hand" });
  refused(() => play(short.engine, P1, short.id("gol")), "cost 5 with 4", /afford|resource|cost|pay/i);
  const noE = golemBoard([...V(5), ...D(2)], { zone: "hand" });
  refused(() => play(noE.engine, P1, noE.id("gol")), "threshold e with no E", /threshold|icon/i);
  const mixed = golemBoard([...E(1), ...V(4)], { zone: "hand" });
  play(mixed.engine, P1, mixed.id("gol"));
  assert.equal(zoneOf(mixed.engine, mixed.id("gol")), "play", "one E is enough to deploy");
});

clause(GOLEM, "0:rule@eee", "with [E][E][E] it has AGGRO", () => {
  const g = golemBoard([...E(3)]);
  assert.ok(g.engine.getKeywords(g.id("gol")).includes("aggro"), "g.engine.getKeywords(g.id(\"gol\")).includes(\"aggro\")");
  const more = golemBoard([...E(5)]);
  assert.ok(more.engine.getKeywords(more.id("gol")).includes("aggro"), "more than three is fine");
});

clause(GOLEM, "0:rule@eee", "with only [E][E] (or no E) it does NOT have AGGRO", () => {
  const ok = golemBoard([...E(3)]);
  assert.ok(ok.engine.getKeywords(ok.id("gol")).includes("aggro"), "ok.engine.getKeywords(ok.id(\"gol\")).includes(\"aggro\")");
  for (const res of [[...E(2), ...V(3)], [...E(1)], [...V(4)], [...E(2), ...D(5)]]) {
    const g = golemBoard(res);
    assert.ok(!g.engine.getKeywords(g.id("gol")).includes("aggro"), "!g.engine.getKeywords(g.id(\"gol\")).includes(\"aggro\")");
  }
  const theirs = golemBoard([...E(2), ...E(5, P2)]);
  assert.ok(!theirs.engine.getKeywords(theirs.id("gol")).includes("aggro"), "the opponent's E do not count");
});

clause(GOLEM, "0:rule@eee", "AGGRO lets it attack the turn it enters play, with [E][E][E]", () => {
  const g = golemBoard([...E(5)], { zone: "hand" });
  play(g.engine, P1, g.id("gol"));
  declareAttackBy(g.engine, P1, [g.id("gol")]);
  assert.ok(g.engine.state.battle, "a battle began");
});

clause(GOLEM, "0:rule@eee", "without [E][E][E] it cannot attack the turn it enters play", () => {
  const g = golemBoard([...E(2), ...V(3)], { zone: "hand" });
  play(g.engine, P1, g.id("gol"));
  refused(() => declareAttackBy(g.engine, P1, [g.id("gol")]), "summoning sickness without AGGRO", /summon|eligible|attack|turn|enter/i);
  assert.equal(g.engine.state.battle, undefined);
});

clause(GOLEM, "0:rule@eee", "AGGRO turns on and off with the threshold: getting a third [E] later grants it", () => {
  const g = golemBoard([...E(2)]);
  assert.ok(!g.engine.getKeywords(g.id("gol")).includes("aggro"), "!g.engine.getKeywords(g.id(\"gol\")).includes(\"aggro\")");
  const h = golemBoard([...E(3)]);
  assert.ok(h.engine.getKeywords(h.id("gol")).includes("aggro"), "h.engine.getKeywords(h.id(\"gol\")).includes(\"aggro\")");
});

clause(GOLEM, "0:rule@eee", "off the battlefield (in hand) the Golem has no AGGRO", () => {
  const g = golemBoard([...E(5)], { zone: "hand" });
  assert.ok(!g.engine.getKeywords(g.id("gol")).includes("aggro"), "!g.engine.getKeywords(g.id(\"gol\")).includes(\"aggro\")");
});

// =====================================================================================
// Warmachine Smelder
// =====================================================================================

const SMELDER = "3be88b1b-8fd8-4c46-82e7-54f832a65e30";
// IN THE FIRE -- COST: Deplete this card. Pick an item you control. -- EFFECT: Destroy the item. Search your deck for an item and reveal it. Put it into your hand.
// LIFE'S WORK: [E]x6 -- COST: Pick an item you control. Destroy this card. -- EFFECT: Destroy the item. Search your deck for an item with numeric cost 7 or less and reveal it. You may deploy that card for free. If you don't, put it into your hand.

function smelderBoard(res: CardPlacement[], opts: { zone?: "hand" | "play"; scrapThreshold?: boolean } = {}) {
  return dev([
    { key: "sm", def: printing(SMELDER), owner: P1, zone: opts.zone ?? "play" },
    { key: "scrap", def: item({ name: "Scrap" }), owner: P1, zone: "play" },
    { key: "scrap2", def: item({ name: "Scrap Two" }), owner: P1, zone: "play" },
    { key: "oscrap", def: item({ name: "Their Scrap" }), owner: P2, zone: "play" },
    { key: "lentOut", def: item({ name: "Lent Out" }), owner: P2, controller: P1, zone: "play" },
    { key: "hscrap", def: item({ name: "Hand Item" }), owner: P1, zone: "hand" },
    { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
    { key: "i1", def: item({ name: "Item One", cost: 1 }), owner: P1, zone: "deck" },
    { key: "dchar", def: character({ name: "Deck Char", cost: 1 }), owner: P1, zone: "deck" },
    { key: "i7", def: item({ name: "Item Seven", cost: 7 }), owner: P1, zone: "deck" },
    { key: "i8", def: item({ name: "Item Eight", cost: 8 }), owner: P1, zone: "deck" },
    { key: "i0", def: item({ name: "Item Zero", cost: 0 }), owner: P1, zone: "deck" },
    { key: "ihard", def: item({ name: "Item Hard", cost: 3, threshold: "rrr" as never }), owner: P1, zone: "deck" },
    { key: "oi", def: item({ name: "Their Item", cost: 1 }), owner: P2, zone: "deck" },
    { key: "oc", def: character({ name: "Their Char", cost: 1 }), owner: P2, zone: "deck" },
    ...fillers("pad-", 2, P1, "deck"),
    ...res
  ]);
}
const fire = (g: ReturnType<typeof smelderBoard>, scrap: string, found: string[] | undefined) => {
  activate(g.engine, P1, g.id("sm"), "fire", { selected: { scrap: [g.id(scrap)] } });
  drain(g.engine, pickTargets((found ?? []).map(g.id)));
};
const answerPick = (g: ReturnType<typeof smelderBoard>, found: string[], option: number) => {
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: found.map(g.id) } } as never);
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index: option } } as never);
};
const work = (g: ReturnType<typeof smelderBoard>, scrap: string, found: string[], option = 0) => {
  activate(g.engine, P1, g.id("sm"), "lifeswork", { selected: { scrap2: [g.id(scrap)] } });
  const pick = pickTargets(found.map(g.id), option);
  drain(g.engine, (pc) => (pc.kind === "deployForFree" ? { kind: "deployForFree", cardId: g.id(found[0]) } : pick(pc)));
};

clause(SMELDER, "0:ability:fire", "printed as a Gearsmith character (31f, craftsman): cost 4, threshold [E][E], 3/3/3", () => {
  const p = printing(SMELDER);
  assert.deepEqual([p.type, p.trade, p.cost, p.threshold, p.strength, p.speed, p.life], ["character", "gearsmith", 4, "ee", 3, 3, 3]);
  assert.deepEqual(p.subtype, ["31f", "craftsman"]);
  const g = smelderBoard([...E(2), ...V(2)], { zone: "hand" });
  play(g.engine, P1, g.id("sm"));
  assert.equal(zoneOf(g.engine, g.id("sm")), "play");
  assert.deepEqual([g.engine.getStat(g.id("sm"), "strength"), g.engine.getStat(g.id("sm"), "speed"), g.engine.getStat(g.id("sm"), "life")], [3, 3, 3]);
  const short = smelderBoard([...E(2), ...V(1)], { zone: "hand" });
  refused(() => play(short.engine, P1, short.id("sm")), "cost 4 with 3 resources", /afford|resource|cost|pay/i);
  const oneE = smelderBoard([...E(1), ...V(4)], { zone: "hand" });
  refused(() => play(oneE.engine, P1, oneE.id("sm")), "one E short of ee", /threshold|icon/i);
});

clause(SMELDER, "0:ability:fire", "IN THE FIRE destroys the picked item, finds an item in my deck, reveals it and puts it into my hand", () => {
  const g = smelderBoard([]);
  fire(g, "scrap", ["i1"]);
  assert.ok(g.engine.state.players[P1].discard.includes(g.id("scrap")), "the item was destroyed");
  assert.ok(handOf(g.engine, P1).includes(g.id("i1")), "the found item is in my hand");
  assert.ok(!deckOf(g.engine, P1).includes(g.id("i1")), "!deckOf(g.engine, P1).includes(g.id(\"i1\"))");
  const reveals = revealsOf(g.engine);
  assert.equal(reveals.length, 1);
  assert.deepEqual((reveals[0].event as unknown as { cardIds: string[] }).cardIds, [g.id("i1")]);
  assert.equal((reveals[0].event as unknown as { viewerId: string }).viewerId, "all");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(SMELDER, "0:ability:fire", "IN THE FIRE: any item may be found (cost 8 and cost 0 alike)", () => {
  for (const k of ["i8", "i0", "i7", "ihard"]) {
    const g = smelderBoard([]);
    fire(g, "scrap", [k]);
    assert.ok(handOf(g.engine, P1).includes(g.id(k)), `${k} found`);
  }
});

clause(SMELDER, "0:ability:fire", "IN THE FIRE: only items in my deck can be found (not a character, not the opponent's items)", () => {
  const ok = smelderBoard([]);
  fire(ok, "scrap", ["i1"]);
  for (const k of ["dchar", "oi", "oc", "hscrap", "oscrap"]) {
    const g = smelderBoard([]);
    refused(() => fire(g, "scrap", [k]), `${k} is not an item in my deck`);
    assert.ok(!handOf(g.engine, P1).includes(g.id(k)) || k === "hscrap", "!handOf(g.engine, P1).includes(g.id(k)) || k === \"hscrap\"");
  }
});

clause(SMELDER, "0:ability:fire", "IN THE FIRE: I find at most one item (picking two is refused)", () => {
  const g = smelderBoard([]);
  refused(() => fire(g, "scrap", ["i1", "i0"]), "two items");
  assert.ok(!handOf(g.engine, P1).includes(g.id("i0")), "!handOf(g.engine, P1).includes(g.id(\"i0\"))");
});

clause(SMELDER, "0:ability:fire", "IN THE FIRE: the found item is the only change to my hand; the opponent's zones are untouched", () => {
  const g = smelderBoard([]);
  const hand = handOf(g.engine, P1);
  const oppDeck = deckOf(g.engine, P2);
  const oppHand = handOf(g.engine, P2);
  fire(g, "scrap", ["i7"]);
  assert.deepEqual([...handOf(g.engine, P1)].sort(), [...hand, g.id("i7")].sort());
  assert.deepEqual(deckOf(g.engine, P2), oppDeck, "their deck untouched, in order");
  assert.deepEqual(handOf(g.engine, P2), oppHand);
});

clause(SMELDER, "0:ability:fire", "IN THE FIRE: my deck is shuffled afterwards (CR 312.1) when an item is found", () => {
  const g = smelderBoard([], {});
  const before = deckOf(g.engine, P1);
  fire(g, "scrap", ["i1"]);
  const after = deckOf(g.engine, P1);
  assert.deepEqual([...after].sort(), before.filter((c) => c !== g.id("i1")).sort(), "same cards");
  assert.notDeepEqual(after, before.filter((c) => c !== g.id("i1")), "the order changed: shuffled");
});

clause(SMELDER, "0:ability:fire", "IN THE FIRE: I am the one who chooses the item, and may find nothing: the item is destroyed, nothing reaches my hand", () => {
  const g = smelderBoard([]);
  const hand = handOf(g.engine, P1);
  const deck = deckOf(g.engine, P1);
  activate(g.engine, P1, g.id("sm"), "fire", { selected: { scrap: [g.id("scrap")] } });
  const pc = g.engine.state.pendingChoice as unknown as PendingChoiceLike & { playerId: string };
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I choose, not my opponent");
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [] } } as never);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.ok(g.engine.state.players[P1].discard.includes(g.id("scrap")), "the item is destroyed anyway");
  assert.deepEqual(handOf(g.engine, P1), hand, "nothing added to hand");
  assert.deepEqual([...deckOf(g.engine, P1)].sort(), [...deck].sort(), "no card left the deck");
});

clause(SMELDER, "0:ability:fire", "IN THE FIRE: choosing to find nothing still destroys the item, finds nothing and shuffles", () => {
  const g = smelderBoard([]);
  const before = deckOf(g.engine, P1);
  const hand = handOf(g.engine, P1);
  fire(g, "scrap", []);
  assert.ok(g.engine.state.players[P1].discard.includes(g.id("scrap")), "the item is destroyed anyway");
  assert.deepEqual(handOf(g.engine, P1), hand, "nothing added to hand");
  assert.deepEqual([...deckOf(g.engine, P1)].sort(), [...before].sort());
  assert.notDeepEqual(deckOf(g.engine, P1), before, "shuffled");
});

clause(SMELDER, "0:ability:fire", "IN THE FIRE: with no item in my deck it finds nothing, and the deck is still shuffled", () => {
  const g = dev([
    { key: "sm", def: printing(SMELDER), owner: P1, zone: "play" },
    { key: "scrap", def: item({ name: "Scrap" }), owner: P1, zone: "play" },
    ...fillers("c-", 5, P1, "deck", () => character({ name: "Deck Char" }))
  ]);
  const before = deckOf(g.engine, P1);
  activate(g.engine, P1, g.id("sm"), "fire", { selected: { scrap: [g.id("scrap")] } });
  drain(g.engine, declineAll);
  assert.ok(g.engine.state.players[P1].discard.includes(g.id("scrap")), "g.engine.state.players[P1].discard.includes(g.id(\"scrap\"))");
  assert.deepEqual([...deckOf(g.engine, P1)].sort(), [...before].sort());
  assert.notDeepEqual(deckOf(g.engine, P1), before, "shuffled even though nothing was found");
});

clause(SMELDER, "0:ability:fire", "IN THE FIRE cost: deplete this card — it is depleted, and a depleted Smelder cannot use it", () => {
  const g = smelderBoard([]);
  assert.equal(g.engine.state.cards[g.id("sm")].depleted, false);
  fire(g, "scrap", ["i1"]);
  assert.equal(g.engine.state.cards[g.id("sm")].depleted, true);
  refused(() => fire(g, "scrap2", ["i0"]), "already depleted", /deplet|costs cannot be paid/i);
  assert.equal(zoneOf(g.engine, g.id("scrap2")), "play");
  assert.ok(!handOf(g.engine, P1).includes(g.id("i0")), "!handOf(g.engine, P1).includes(g.id(\"i0\"))");
});

clause(SMELDER, "0:ability:fire", "IN THE FIRE cost: pick an item I control — the opponent's item, a character, a hand item and no pick are refused", () => {
  const ok = smelderBoard([]);
  fire(ok, "scrap", ["i1"]);
  for (const k of ["oscrap", "foe", "hscrap"]) {
    const g = smelderBoard([]);
    refused(() => fire(g, k, ["i1"]), `${k} is not an item I control in play`);
    assert.equal(g.engine.state.cards[g.id("sm")].depleted, false, "no cost paid");
    assert.equal(zoneOf(g.engine, g.id(k)), k === "hscrap" ? "hand" : "play");
  }
  const none = smelderBoard([]);
  refused(() => activate(none.engine, P1, none.id("sm"), "fire", { selected: {} }), "no pick");
});

clause(SMELDER, "0:ability:fire", "IN THE FIRE cost: only an ITEM I control is pickable: my own character, and my items in the deck or the discard pile, are refused", () => {
  const extra: CardPlacement[] = [
    { key: "mychar", def: character({ name: "My Char" }), owner: P1, zone: "play" },
    { key: "discitem", def: item({ name: "Disc Item" }), owner: P1, zone: "discard" }
  ];
  const ok = smelderBoard(extra);
  fire(ok, "scrap", ["i1"]);
  assert.equal(zoneOf(ok.engine, ok.id("scrap")), "discard", "control: my item in play works");
  for (const k of ["mychar", "discitem", "i1"]) {
    const g = smelderBoard(extra);
    refused(() => fire(g, k, ["i0"]), `${k} is not an item I control in play`);
    assert.equal(g.engine.state.cards[g.id("sm")].depleted, false, `${k}: no cost paid`);
    assert.equal(zoneOf(g.engine, g.id(k)), k === "mychar" ? "play" : k === "i1" ? "deck" : "discard", `${k}: untouched`);
  }
});

clause(SMELDER, "0:ability:fire", "IN THE FIRE: an item I control but do not own is a legal pick, and goes to its owner's discard", () => {
  const g = smelderBoard([]);
  fire(g, "lentOut", ["i1"]);
  assert.ok(g.engine.state.players[P2].discard.includes(g.id("lentOut")), "g.engine.state.players[P2].discard.includes(g.id(\"lentOut\"))");
  assert.ok(handOf(g.engine, P1).includes(g.id("i1")), "handOf(g.engine, P1).includes(g.id(\"i1\"))");
});

clause(SMELDER, "0:ability:fire", "IN THE FIRE needs no resources and no threshold", () => {
  const g = smelderBoard([]);
  assert.equal(readyResources(g.engine, P1), 0);
  fire(g, "scrap", ["i1"]);
  assert.ok(handOf(g.engine, P1).includes(g.id("i1")), "handOf(g.engine, P1).includes(g.id(\"i1\"))");
  assert.equal(readyResources(g.engine, P1), 0);
});

clause(SMELDER, "0:ability:fire", "IN THE FIRE can be used only from play: Smelder in hand cannot activate it", () => {
  const g = smelderBoard([], { zone: "hand" });
  refused(() => fire(g, "scrap", ["i1"]), "Smelder is in hand", /not found|activated|zone|play|ability/i);
});

// --- LIFE'S WORK ---------------------------------------------------------------------

clause(SMELDER, "1:ability:lifeswork", "LIFE'S WORK threshold [E] x6: six [E] works, five is refused (opponent's [E] do not count)", () => {
  const ok = smelderBoard([...E(6)]);
  work(ok, "scrap2", ["i1"]);
  assert.ok(handOf(ok.engine, P1).includes(ok.id("i1")) || zoneOf(ok.engine, ok.id("i1")) === "play", "handOf(ok.engine, P1).includes(ok.id(\"i1\")) || zoneOf(ok.engine, ok.id(\"i1\")) === \"play\"");
  const g = smelderBoard([...E(5), ...V(4)]);
  refused(() => work(g, "scrap2", ["i1"]), "five E", /threshold|icon/i);
  assert.equal(zoneOf(g.engine, g.id("sm")), "play", "not destroyed");
  assert.equal(zoneOf(g.engine, g.id("scrap2")), "play");
  const theirs = smelderBoard([...E(5), ...E(6, P2)]);
  refused(() => work(theirs, "scrap2", ["i1"]), "the opponent's E do not count", /threshold|icon/i);
});

clause(SMELDER, "1:ability:lifeswork", "LIFE'S WORK cost: destroy this card, and pick an item I control", () => {
  const g = smelderBoard([...E(6)]);
  work(g, "scrap2", ["i1"]);
  assert.ok(g.engine.state.players[P1].discard.includes(g.id("sm")), "Smelder was destroyed as the cost");
  assert.ok(g.engine.state.players[P1].discard.includes(g.id("scrap2")), "the picked item was destroyed");
  assert.equal(zoneOf(g.engine, g.id("scrap")), "play", "other items untouched");
  const bad = smelderBoard([...E(6)]);
  for (const k of ["oscrap", "foe", "hscrap"]) {
    refused(() => work(bad, k, ["i1"]), `${k} is not an item I control in play`);
    assert.equal(zoneOf(bad.engine, bad.id("sm")), "play", "Smelder was not destroyed");
  }
  refused(() => activate(bad.engine, P1, bad.id("sm"), "lifeswork", { selected: {} }), "no pick");
  assert.equal(zoneOf(bad.engine, bad.id("sm")), "play");
});

clause(SMELDER, "1:ability:lifeswork", "LIFE'S WORK cost: only an ITEM I control is pickable: my own character, and my items in the deck or the discard pile, are refused", () => {
  const extra: CardPlacement[] = [
    { key: "mychar", def: character({ name: "My Char" }), owner: P1, zone: "play" },
    { key: "discitem", def: item({ name: "Disc Item" }), owner: P1, zone: "discard" }
  ];
  for (const k of ["mychar", "discitem", "i1"]) {
    const g = smelderBoard([...E(6), ...extra]);
    refused(() => work(g, k, ["i0"]), `${k} is not an item I control in play`);
    assert.equal(zoneOf(g.engine, g.id("sm")), "play", `${k}: Smelder was not destroyed`);
    assert.equal(zoneOf(g.engine, g.id(k)), k === "mychar" ? "play" : k === "i1" ? "deck" : "discard", `${k}: untouched`);
  }
});

clause(SMELDER, "1:ability:lifeswork", "LIFE'S WORK with no item I control is refused and Smelder survives", () => {
  const g = dev([
    { key: "sm", def: printing(SMELDER), owner: P1, zone: "play" },
    { key: "oscrap", def: item({ name: "Their Scrap" }), owner: P2, zone: "play" },
    { key: "i1", def: item({ name: "Item One", cost: 1 }), owner: P1, zone: "deck" },
    ...E(6)
  ]);
  refused(() => activate(g.engine, P1, g.id("sm"), "lifeswork", { selected: { scrap2: [g.id("oscrap")] } }), "only the opponent's item");
  assert.equal(zoneOf(g.engine, g.id("sm")), "play");
});

clause(SMELDER, "1:ability:lifeswork", "LIFE'S WORK: an item with numeric cost 7 or less can be found (0, 1, 7), cost 8 cannot", () => {
  for (const k of ["i0", "i1", "i7"]) {
    const g = smelderBoard([...E(6)]);
    work(g, "scrap2", [k], 1);
    assert.ok(handOf(g.engine, P1).includes(g.id(k)), `${k} found`);
  }
  const g = smelderBoard([...E(6)]);
  refused(() => work(g, "scrap2", ["i8"], 1), "cost 8 is over 7");
  assert.ok(!handOf(g.engine, P1).includes(g.id("i8")), "!handOf(g.engine, P1).includes(g.id(\"i8\"))");
  assert.equal(zoneOf(g.engine, g.id("i8")), "deck");
});

clause(SMELDER, "1:ability:lifeswork", "LIFE'S WORK: only items in my deck (not characters, not the opponent's items)", () => {
  for (const k of ["dchar", "oi", "oc"]) {
    const g = smelderBoard([...E(6)]);
    refused(() => work(g, "scrap2", [k], 1), `${k} is not an item in my deck`);
  }
});

clause(SMELDER, "1:ability:lifeswork", "LIFE'S WORK: the found item is revealed", () => {
  const g = smelderBoard([...E(6)]);
  work(g, "scrap2", ["i7"], 1);
  const reveals = revealsOf(g.engine);
  assert.equal(reveals.length, 1);
  assert.deepEqual((reveals[0].event as unknown as { cardIds: string[] }).cardIds, [g.id("i7")]);
  assert.equal((reveals[0].event as unknown as { viewerId: string }).viewerId, "all");
});

clause(SMELDER, "1:ability:lifeswork", "LIFE'S WORK: I may deploy the found item for free — it enters play and nothing is paid", () => {
  const g = smelderBoard([...E(6), ...V(2)]);
  const before = readyResources(g.engine, P1);
  work(g, "scrap2", ["i7"], 0);
  assert.equal(zoneOf(g.engine, g.id("i7")), "play", "the cost-7 item was deployed");
  assert.ok(!handOf(g.engine, P1).includes(g.id("i7")), "and is not in my hand");
  assert.equal(readyResources(g.engine, P1), before, "for free: no resources spent");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(SMELDER, "1:ability:lifeswork", "LIFE'S WORK: if I don't deploy it, it goes into my hand (not into play)", () => {
  const g = smelderBoard([...E(6), ...V(2)]);
  work(g, "scrap2", ["i7"], 1);
  assert.equal(zoneOf(g.engine, g.id("i7")), "hand");
  assert.ok(handOf(g.engine, P1).includes(g.id("i7")), "handOf(g.engine, P1).includes(g.id(\"i7\"))");
});

clause(SMELDER, "1:ability:lifeswork", "LIFE'S WORK: the free deploy does not waive the item's threshold (CR 308.1)", () => {
  const g = smelderBoard([...E(6)]);
  activate(g.engine, P1, g.id("sm"), "lifeswork", { selected: { scrap2: [g.id("scrap2")] } });
  answerPick(g, ["ihard"], 0);
  const pc = g.engine.state.pendingChoice as unknown as PendingChoiceLike;
  assert.equal(pc.kind, "deployForFree", "asked to deploy for free");
  refused(() => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: g.id("ihard") } } as never), "threshold rrr unmet", /threshold/i);
  assert.notEqual(zoneOf(g.engine, g.id("ihard")), "play", "threshold rrr is unmet, so it cannot be deployed");
  assert.equal(g.engine.state.cards[g.id("ihard")].zone, "deck");
});

clause(SMELDER, "1:ability:lifeswork", "LIFE'S WORK: my deck is shuffled afterwards (CR 312.1), whether I deploy or take it", () => {
  for (const option of [0, 1]) {
    const g = smelderBoard([...E(6)]);
    const before = deckOf(g.engine, P1).filter((c) => c !== g.id("i1"));
    work(g, "scrap2", ["i1"], option);
    assert.deepEqual([...deckOf(g.engine, P1)].sort(), [...before].sort());
    assert.notDeepEqual(deckOf(g.engine, P1), before, `shuffled (option ${option})`);
  }
});

clause(SMELDER, "1:ability:lifeswork", "LIFE'S WORK: I choose the item and may find nothing; I find at most one; the deploy-or-hand choice is mine", () => {
  const g = smelderBoard([...E(6)]);
  const hand = handOf(g.engine, P1);
  const deck = deckOf(g.engine, P1);
  activate(g.engine, P1, g.id("sm"), "lifeswork", { selected: { scrap2: [g.id("scrap2")] } });
  const pc = g.engine.state.pendingChoice as unknown as PendingChoiceLike & { playerId: string };
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I choose the item");
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [] } } as never);
  if (g.engine.state.pendingChoice) g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index: 1 } } as never);
  assert.equal(g.engine.state.pendingChoice, undefined, "nothing left to decide");
  assert.ok(g.engine.state.players[P1].discard.includes(g.id("scrap2")), "g.engine.state.players[P1].discard.includes(g.id(\"scrap2\"))");
  assert.ok(g.engine.state.players[P1].discard.includes(g.id("sm")), "g.engine.state.players[P1].discard.includes(g.id(\"sm\"))");
  assert.deepEqual(handOf(g.engine, P1), hand);
  assert.deepEqual([...deckOf(g.engine, P1)].sort(), [...deck].sort());

  const two = smelderBoard([...E(6)]);
  activate(two.engine, P1, two.id("sm"), "lifeswork", { selected: { scrap2: [two.id("scrap2")] } });
  refused(() => two.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [two.id("i1"), two.id("i0")] } } as never), "two items", undefined);
  assert.equal(zoneOf(two.engine, two.id("i0")), "deck");

  const opt = smelderBoard([...E(6)]);
  activate(opt.engine, P1, opt.id("sm"), "lifeswork", { selected: { scrap2: [opt.id("scrap2")] } });
  opt.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [opt.id("i1")] } } as never);
  const pc2 = opt.engine.state.pendingChoice as unknown as PendingChoiceLike & { playerId: string };
  assert.equal(pc2.kind, "chooserSelectsOption");
  assert.equal(pc2.playerId, P1, "I decide whether to deploy");
});

clause(SMELDER, "1:ability:lifeswork", "LIFE'S WORK: choosing to find nothing still destroys the item and Smelder, and shuffles", () => {
  const g = smelderBoard([...E(6)]);
  const before = deckOf(g.engine, P1);
  const hand = handOf(g.engine, P1);
  work(g, "scrap2", [], 1);
  assert.ok(g.engine.state.players[P1].discard.includes(g.id("scrap2")), "g.engine.state.players[P1].discard.includes(g.id(\"scrap2\"))");
  assert.ok(g.engine.state.players[P1].discard.includes(g.id("sm")), "g.engine.state.players[P1].discard.includes(g.id(\"sm\"))");
  assert.deepEqual(handOf(g.engine, P1), hand);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual([...deckOf(g.engine, P1)].sort(), [...before].sort());
  assert.notDeepEqual(deckOf(g.engine, P1), before, "shuffled");
});

clause(SMELDER, "1:ability:lifeswork", "LIFE'S WORK: with no eligible item in my deck, nothing is found and the deck is shuffled", () => {
  const g = dev([
    { key: "sm", def: printing(SMELDER), owner: P1, zone: "play" },
    { key: "scrap2", def: item({ name: "Scrap" }), owner: P1, zone: "play" },
    { key: "i8", def: item({ name: "Item Eight", cost: 8 }), owner: P1, zone: "deck" },
    ...fillers("c-", 4, P1, "deck", () => character({ name: "Deck Char" })),
    ...E(6)
  ]);
  const before = deckOf(g.engine, P1);
  activate(g.engine, P1, g.id("sm"), "lifeswork", { selected: { scrap2: [g.id("scrap2")] } });
  drain(g.engine, declineAll);
  assert.ok(g.engine.state.players[P1].discard.includes(g.id("scrap2")), "g.engine.state.players[P1].discard.includes(g.id(\"scrap2\"))");
  assert.equal(zoneOf(g.engine, g.id("i8")), "deck");
  assert.notDeepEqual(deckOf(g.engine, P1), before, "shuffled even though nothing was found");
});

// =====================================================================================
// Affectionate Dollkeeper
// =====================================================================================

const DOLL = "f72c5546-6a63-4146-b7f9-b4e40364ff4a"; // [D][D][D]: When this card inflicts damage to a character, destroy that character.

function dollBoard(res: CardPlacement[], opts: { zone?: "hand" | "play" } = {}) {
  return dev([
    { key: "dk", def: printing(DOLL), owner: P1, zone: opts.zone ?? "play" },
    { key: "ally", def: character({ name: "Ally", strength: 2, life: 5, speed: 1 }), owner: P1, zone: "play" },
    { key: "blk", def: character({ name: "Big Blocker", strength: 1, life: 10, speed: 1 }), owner: P2, zone: "play" },
    { key: "blk2", def: character({ name: "Second Blocker", strength: 1, life: 10, speed: 1 }), owner: P2, zone: "play" },
    { key: "bystander", def: character({ name: "Bystander", life: 10 }), owner: P2, zone: "play" },
    { key: "loc", def: location({ name: "Their Place", structure: 10 }), owner: P2, zone: "play" },
    ...res
  ]);
}

clause(DOLL, "0:rule@ddd", "printed as a Rogue hedonist: cost 4, threshold [D], 2/4/2", () => {
  const p = printing(DOLL);
  assert.deepEqual([p.type, p.trade, p.cost, p.threshold, p.strength, p.speed, p.life], ["character", "rogue", 4, "d", 2, 4, 2]);
  assert.deepEqual(p.subtype, ["hedonist"]);
  const g = dollBoard([...D(1), ...V(3)], { zone: "hand" });
  play(g.engine, P1, g.id("dk"));
  assert.equal(zoneOf(g.engine, g.id("dk")), "play");
  assert.deepEqual([g.engine.getStat(g.id("dk"), "strength"), g.engine.getStat(g.id("dk"), "speed"), g.engine.getStat(g.id("dk"), "life")], [2, 4, 2]);
  const short = dollBoard([...D(1), ...V(2)], { zone: "hand" });
  refused(() => play(short.engine, P1, short.id("dk")), "cost 4 with 3", /afford|resource|cost|pay/i);
  const noD = dollBoard([...V(4), ...E(2)], { zone: "hand" });
  refused(() => play(noD.engine, P1, noD.id("dk")), "threshold d with no D", /threshold|icon/i);
});

clause(DOLL, "0:rule@ddd", "with [D][D][D], damage it inflicts to a blocking character destroys that character", () => {
  const g = dollBoard([...D(3)]);
  fight(g.engine, P1, [g.id("dk")], { type: "faction", playerId: P2 }, [g.id("blk")]);
  assert.equal(zoneOf(g.engine, g.id("blk")), "discard", "10-life blocker destroyed by 2 damage");
  assert.equal(zoneOf(g.engine, g.id("dk")), "play", "Dollkeeper survives 1 damage");
  assert.equal(zoneOf(g.engine, g.id("bystander")), "play");
  assert.equal(zoneOf(g.engine, g.id("blk2")), "play");
});

clause(DOLL, "0:rule@ddd", "with more than [D][D][D] it still works", () => {
  const g = dollBoard([...D(5)]);
  fight(g.engine, P1, [g.id("dk")], { type: "faction", playerId: P2 }, [g.id("blk")]);
  assert.equal(zoneOf(g.engine, g.id("blk")), "discard");
});

clause(DOLL, "0:rule@ddd", "with only [D][D] (or none) the damaged character is NOT destroyed", () => {
  for (const res of [[...D(2), ...V(3)], [...D(1)], [...V(3)], [...D(2), ...E(5)]]) {
    const g = dollBoard(res);
    fight(g.engine, P1, [g.id("dk")], { type: "faction", playerId: P2 }, [g.id("blk")]);
    assert.equal(zoneOf(g.engine, g.id("blk")), "play", "survives the 2 damage");
    assert.equal(g.engine.state.cards[g.id("blk")].damage, 2);
  }
  const theirs = dollBoard([...D(2), ...D(5, P2)]);
  fight(theirs.engine, P1, [theirs.id("dk")], { type: "faction", playerId: P2 }, [theirs.id("blk")]);
  assert.equal(zoneOf(theirs.engine, theirs.id("blk")), "play", "the opponent's [D] do not count");
});

clause(DOLL, "0:rule@ddd", "it works when Dollkeeper blocks: the attacker it damages is destroyed", () => {
  const g = dollBoard([...D(3)]);
  endTurn(g.engine, P1);
  fight(g.engine, P2, [g.id("blk")], { type: "faction", playerId: P1 }, [g.id("dk")]);
  assert.equal(zoneOf(g.engine, g.id("blk")), "discard", "the 10-life attacker was destroyed by Dollkeeper's 2 damage");
});

clause(DOLL, "0:rule@ddd", "it only triggers on damage THIS card inflicts: another character's damage does not destroy", () => {
  const g = dollBoard([...D(3)]);
  fight(g.engine, P1, [g.id("ally")], { type: "faction", playerId: P2 }, [g.id("blk")]);
  assert.equal(zoneOf(g.engine, g.id("blk")), "play", "Ally dealt the damage, not Dollkeeper");
  assert.equal(g.engine.state.cards[g.id("blk")].damage, 2);
  assert.equal(zoneOf(g.engine, g.id("dk")), "play");
});

clause(DOLL, "0:rule@ddd", "damage dealt TO the Dollkeeper does not destroy the character that dealt it", () => {
  const g = dollBoard([...D(3)]);
  const dk = g.engine.state.cards[g.id("dk")];
  assert.equal(dk.damage, 0);
  fight(g.engine, P1, [g.id("ally")], { type: "faction", playerId: P2 }, [g.id("blk")]);
  assert.equal(zoneOf(g.engine, g.id("blk2")), "play");
  assert.equal(zoneOf(g.engine, g.id("blk")), "play", "a blocker that damaged somebody else but not Dollkeeper is safe");
});

clause(DOLL, "0:rule@ddd", "it only destroys characters: damage it inflicts to a location destroys nothing extra", () => {
  const g = dollBoard([...D(3)]);
  fight(g.engine, P1, [g.id("dk")], { type: "card", cardId: g.id("loc") }, []);
  assert.equal(zoneOf(g.engine, g.id("loc")), "play", "10 structure, only 2 damage, and the trigger is for characters");
  assert.equal(g.engine.state.cards[g.id("loc")].damage, 2);
});

clause(DOLL, "0:rule@ddd", "damage to the opposing faction destroys nothing", () => {
  const g = dollBoard([...D(3)]);
  fight(g.engine, P1, [g.id("dk")], { type: "faction", playerId: P2 }, []);
  for (const k of ["blk", "blk2", "bystander", "loc"]) assert.equal(zoneOf(g.engine, g.id(k)), "play", `${k} untouched`);
  assert.equal(g.engine.state.pendingChoice, undefined);
});
