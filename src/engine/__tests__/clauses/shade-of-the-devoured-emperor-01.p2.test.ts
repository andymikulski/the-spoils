// Clause tests — batch shade-of-the-devoured-emperor-01, part p2 (groups 6-12): Forgotten Tentacle,
// Gloamspike-Gosche Bridge, Lugubrian Poacher, Man Shark, Mittens of Muffled Thought, Monstrous
// Lassitude, Neuralyzer Agent. Expectations come from each card's PRINTED text and RULES.md / the CR;
// engine data is only used to drive the engine.

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
  P2
} from "../per-card/_harness.js";
import { clause, declineAll, printing, refused, holdResourceFace } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { answerPending, declareBlockers, fillers, pending, readyResources, zoneOf } from "./_board.js";
import { battleOf, declareAttackBy, declareAttackOpenWindow, finishBattle, playRaw } from "./_battle.js";
import { endTurn, factionOf } from "./_turn.js";
import type { CardPlacement } from "../support/fixtures.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";

type Board = ReturnType<typeof buildGame>;
type PlacementZone = NonNullable<CardPlacement["zone"]>;

const handOf = (engine: SpoilsEngine, p: PlayerId): CardInstanceId[] => [...engine.state.players[p].hand];
const deckOf = (engine: SpoilsEngine, p: PlayerId): CardInstanceId[] => [...engine.state.players[p].deck];
const discardOf = (engine: SpoilsEngine, p: PlayerId): CardInstanceId[] => [...engine.state.players[p].discard];
const playOf = (engine: SpoilsEngine, p: PlayerId): CardInstanceId[] => [...engine.state.players[p].play];
const influenceOf = (engine: SpoilsEngine, p: PlayerId): number => engine.state.players[p].influence;
const labelOf = (o: unknown): string => (typeof o === "string" ? o : String((o as { label?: unknown }).label ?? ""));

/** The open chooserSelectsOption (asserted to belong to `who`) is answered with the option whose label matches `re`. */
function chooseOption(engine: SpoilsEngine, who: PlayerId, re: RegExp): void {
  const pc = pending(engine);
  assert.ok(pc, `a choice is pending for ${who}`);
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, who, "the right player makes this choice");
  const options = (pc.options as unknown[]).map(labelOf);
  const index = options.findIndex((label) => re.test(label));
  assert.ok(index >= 0, `an option matching ${re} is offered (${options.join(" / ")})`);
  answerPending(engine, "chooserSelectsOption", { index });
}

const pickCards = (engine: SpoilsEngine, ids: CardInstanceId[]): void => answerPending(engine, "chooserSelectsTarget", { selected: ids });

/** An answer function that makes the next chooserSelectsTarget picks in order (anything else is declined). */
const picksInOrder = (...order: CardInstanceId[]) => {
  const queue = [...order];
  return (pc: PendingChoiceLike): unknown =>
    pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [queue.shift()!] } : declineAll(pc);
};

const dev = () => developFaction();

// =============================================================================
// Forgotten Tentacle — tactic (arcanist), cost 0, threshold [O][O]
// COST: Pick an opponent. Look at that player's face-down resources and pick one.
// EFFECT: You may destroy that card. If you do, that player may draw a card and may play a resource.
// =============================================================================

const FT = "2eb0069f-52fc-4ab6-a0a0-86919ba57118";

function ftBoard(o: { obsession?: number; emptyHand?: boolean; noDown?: boolean } = {}): Board {
  const cards: CardPlacement[] = [
    { key: "ft", def: printing(FT), owner: P1, zone: "hand" },
    { key: "myHand", def: character({ name: "MyHand" }), owner: P1, zone: "hand" },
    { key: "oppUp", def: resourceCard({ name: "OppStaple" }), owner: P2, zone: "play" },
    { key: "oppChar", def: character({ name: "OppChar" }), owner: P2, zone: "play" },
    { key: "mineDown", def: character({ name: "MineDown" }), owner: P1, zone: "play", faceDown: true },
    { key: "oppDisc", def: character({ name: "OppDisc" }), owner: P2, zone: "discard" },
    ...fillers("dk", 3, P2, "deck"),
    ...bank("obsession", o.obsession ?? 2, P1)
  ];
  if (!o.noDown) {
    cards.push(
      { key: "down1", def: character({ name: "Down1" }), owner: P2, zone: "play", faceDown: true },
      { key: "down2", def: item({ name: "Down2" }), owner: P2, zone: "play", faceDown: true }
    );
  }
  if (!o.emptyHand) {
    cards.push(
      { key: "h0", def: character({ name: "Hand0" }), owner: P2, zone: "hand" },
      { key: "h1", def: resourceCard({ name: "HandStaple" }), owner: P2, zone: "hand" },
      { key: "h2", def: item({ name: "Hand2" }), owner: P2, zone: "hand" }
    );
  }
  return buildGame({ playerA: { faction: dev() }, playerB: { faction: dev() }, cards });
}

const ftPlay = (b: Board, pick: string): void => play(b.engine, P1, b.id("ft"), { selected: { fd: [b.id(pick)] } });
const ftRaw = (b: Board, ...picks: string[]): void => playRaw(b.engine, P1, b.id("ft"), { selected: { fd: picks.map((k) => b.id(k)) } });

clause(FT, "0:ability", "COST: picking one of the opponent's face-down resources is the whole cost (printed cost 0): no resource is spent and nothing is destroyed until the controller chooses", () => {
  const b = ftBoard();
  const before = readyResources(b.engine, P1);
  ftPlay(b, "down1");
  assert.equal(readyResources(b.engine, P1), before, "printed cost 0: nothing is spent");
  const pc = pending(b.engine)!;
  assert.deepEqual([pc.kind, pc.playerId], ["chooserSelectsOption", P1], "its controller decides whether to destroy the picked card");
  assert.equal(zoneOf(b.engine, b.id("down1")), "play", "still in play until the controller chooses");
  assert.equal(b.engine.state.cards[b.id("down1")].faceDown, true);
  chooseOption(b.engine, P1, /decline/i);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("ft")), "discard", "the tactic ends in its owner's discard pile");
});

clause(FT, "0:ability", "EFFECT, may: declining leaves the picked card in play face-down and the opponent is never asked to draw or play anything", () => {
  const b = ftBoard();
  const playBefore = playOf(b.engine, P2);
  ftPlay(b, "down1");
  chooseOption(b.engine, P1, /decline/i);
  assert.equal(pending(b.engine), undefined, "no 'if you do' follow-up prompt");
  assert.equal(zoneOf(b.engine, b.id("down1")), "play");
  assert.equal(b.engine.state.cards[b.id("down1")].faceDown, true);
  assert.deepEqual(handOf(b.engine, P2), [b.id("h0"), b.id("h1"), b.id("h2")], "the opponent's hand is untouched");
  assert.equal(deckOf(b.engine, P2).length, 3, "no card was drawn");
  assert.deepEqual(playOf(b.engine, P2), playBefore, "nothing entered or left the opponent's play area");
});

clause(FT, "0:ability", "EFFECT, may: accepting destroys exactly the picked card (to its owner's discard pile) and nothing else", () => {
  const b = ftBoard();
  ftPlay(b, "down1");
  chooseOption(b.engine, P1, /destroy/i);
  assert.equal(zoneOf(b.engine, b.id("down1")), "discard");
  assert.ok(discardOf(b.engine, P2).includes(b.id("down1")), "in its owner's discard pile");
  assert.equal(zoneOf(b.engine, b.id("down2")), "play", "the other face-down resource stays");
  assert.equal(b.engine.state.cards[b.id("down2")].faceDown, true);
  assert.equal(zoneOf(b.engine, b.id("mineDown")), "play", "your own face-down resource stays");
  assert.equal(zoneOf(b.engine, b.id("oppUp")), "play", "the opponent's face-up resource stays");
  assert.equal(zoneOf(b.engine, b.id("oppChar")), "play");
});

clause(FT, "0:ability", "EFFECT, a second picked card: the other face-down resource can be the one destroyed", () => {
  const b = ftBoard();
  ftPlay(b, "down2");
  chooseOption(b.engine, P1, /destroy/i);
  assert.equal(zoneOf(b.engine, b.id("down2")), "discard");
  assert.equal(zoneOf(b.engine, b.id("down1")), "play", "down1 was not picked");
});

clause(FT, "0:ability", "If you do: it is THAT player (the opponent) who decides whether to draw, and who decides whether to play a resource", () => {
  const b = ftBoard();
  ftPlay(b, "down1");
  chooseOption(b.engine, P1, /destroy/i);
  let pc = pending(b.engine)!;
  assert.deepEqual([pc.kind, pc.playerId], ["chooserSelectsOption", P2], "the opponent decides about the draw");
  chooseOption(b.engine, P2, /decline/i);
  pc = pending(b.engine)!;
  assert.deepEqual([pc.kind, pc.playerId], ["chooserSelectsTarget", P2], "the opponent decides about playing a resource, even after declining the draw");
});

clause(FT, "0:ability", "may draw a card: accepting draws exactly the top card of the opponent's deck", () => {
  const b = ftBoard();
  const top = deckOf(b.engine, P2)[0];
  const handBefore = handOf(b.engine, P2);
  ftPlay(b, "down1");
  chooseOption(b.engine, P1, /destroy/i);
  chooseOption(b.engine, P2, /draw/i);
  assert.deepEqual(handOf(b.engine, P2), [...handBefore, top], "one card drawn: the top of the deck");
  assert.equal(deckOf(b.engine, P2).length, 2);
  assert.equal(handOf(b.engine, P1).length, 1, "the tactic's controller draws nothing (myHand only)");
  assert.equal(deckOf(b.engine, P1).length, 0);
  pickCards(b.engine, []);
  assert.equal(pending(b.engine), undefined);
  assert.equal(handOf(b.engine, P2).length, 4, "declining the resource play keeps the drawn card in hand");
});

clause(FT, "0:ability", "may draw a card: declining draws nothing", () => {
  const b = ftBoard();
  const playBefore = playOf(b.engine, P2).length;
  ftPlay(b, "down1");
  chooseOption(b.engine, P1, /destroy/i);
  chooseOption(b.engine, P2, /decline/i);
  pickCards(b.engine, []);
  assert.equal(pending(b.engine), undefined);
  assert.equal(handOf(b.engine, P2).length, 3);
  assert.equal(deckOf(b.engine, P2).length, 3);
  assert.equal(playOf(b.engine, P2).length, playBefore - 1, "down1 destroyed and no resource played");
});

clause(FT, "0:ability", "may play a resource: the opponent plays a card from their hand into play under their control, face-down for a non-resource card", () => {
  const b = ftBoard();
  ftPlay(b, "down1");
  chooseOption(b.engine, P1, /destroy/i);
  chooseOption(b.engine, P2, /decline/i);
  pickCards(b.engine, [b.id("h0")]);
  assert.equal(pending(b.engine), undefined);
  const played = b.engine.state.cards[b.id("h0")];
  assert.equal(played.zone, "play");
  assert.equal(played.controllerId, P2, "the opponent controls the new resource");
  assert.equal(played.faceDown, true, "only actual resource cards can be played face-up (CR 203.2)");
  assert.deepEqual(handOf(b.engine, P2), [b.id("h1"), b.id("h2")], "only the chosen card left the hand");
  assert.equal(deckOf(b.engine, P2).length, 3, "declined draw: deck untouched");
});

clause(FT, "0:ability", "may play a resource: any card type can be played (an item here), and only the chosen one", () => {
  const b = ftBoard();
  ftPlay(b, "down1");
  chooseOption(b.engine, P1, /destroy/i);
  chooseOption(b.engine, P2, /decline/i);
  pickCards(b.engine, [b.id("h2")]);
  assert.equal(b.engine.state.cards[b.id("h2")].zone, "play");
  assert.equal(b.engine.state.cards[b.id("h2")].faceDown, true);
  assert.equal(zoneOf(b.engine, b.id("h0")), "hand");
  assert.equal(zoneOf(b.engine, b.id("h1")), "hand");
});

clause(FT, "0:ability", "may play a resource: only a card from the opponent's own hand can be played (not yours, not a deck or discard card, not a card already in play)", () => {
  const b = ftBoard();
  ftPlay(b, "down1");
  chooseOption(b.engine, P1, /destroy/i);
  chooseOption(b.engine, P2, /decline/i);
  const deckTop = deckOf(b.engine, P2)[0];
  refused(() => pickCards(b.engine, [b.id("myHand")]), "the tactic controller's hand card");
  refused(() => pickCards(b.engine, [deckTop]), "a card in the opponent's deck");
  refused(() => pickCards(b.engine, [b.id("oppDisc")]), "a card in the opponent's discard pile");
  refused(() => pickCards(b.engine, [b.id("oppChar")]), "a card already in play");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting for a legal answer");
  pickCards(b.engine, [b.id("h0")]);
  assert.equal(zoneOf(b.engine, b.id("h0")), "play");
});

clause(FT, "0:ability", "draw first, then play: a card the opponent just drew can be the resource they play", () => {
  const b = ftBoard({ emptyHand: true });
  const top = deckOf(b.engine, P2)[0];
  assert.equal(handOf(b.engine, P2).length, 0);
  ftPlay(b, "down1");
  chooseOption(b.engine, P1, /destroy/i);
  chooseOption(b.engine, P2, /draw/i);
  pickCards(b.engine, [top]);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, top), "play", "the drawn card was played as a resource");
  assert.equal(b.engine.state.cards[top].faceDown, true);
  assert.equal(handOf(b.engine, P2).length, 0);
});

clause(FT, "0:ability", "no card in hand and no draw: accepting the destroy leaves the opponent with nothing to play and the game does not stall", () => {
  const b = ftBoard({ emptyHand: true });
  ftPlay(b, "down1");
  chooseOption(b.engine, P1, /destroy/i);
  chooseOption(b.engine, P2, /decline/i);
  if (pending(b.engine)) pickCards(b.engine, []);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("down1")), "discard");
  assert.equal(handOf(b.engine, P2).length, 0);
});

clause(FT, "0:ability", "may play a resource: the opponent decides face-up or face-down for an actual resource card (CR 203.2)", () => holdResourceFace(() => {
  const b = ftBoard();
  ftPlay(b, "down1");
  chooseOption(b.engine, P1, /destroy/i);
  chooseOption(b.engine, P2, /decline/i);
  pickCards(b.engine, [b.id("h1")]);
  const card = b.engine.state.cards[b.id("h1")];
  assert.ok(pending(b.engine) !== undefined || (card.zone === "play" && card.faceDown === true), "after picking a real resource card the player is asked face-up/face-down (or it is face-down)");
}));

clause(FT, "0:ability", "targets: every face-down resource the opponent controls can be picked, and only those (not your own, not face-up cards, not other zones, not factions)", () => {
  const b = ftBoard();
  for (const key of ["oppUp", "oppChar", "mineDown", "h0", "oppDisc", "myHand"]) {
    refused(() => ftRaw(b, key), `${key} is not a face-down resource the opponent controls`);
  }
  refused(() => playRaw(b.engine, P1, b.id("ft"), { selected: { fd: [factionOf(b.engine, P2)] } }), "the opponent's faction");
  refused(() => playRaw(b.engine, P1, b.id("ft"), { selected: { fd: [factionOf(b.engine, P1)] } }), "your faction");
  assert.equal(zoneOf(b.engine, b.id("ft")), "hand", "nothing was played");
  ftRaw(b, "down2");
  assert.ok(b.engine.state.responseWindow || pending(b.engine), "a face-down opponent resource is accepted");
});

clause(FT, "0:ability", "targets: exactly one is picked (none or two are refused)", () => {
  const b = ftBoard();
  refused(() => ftRaw(b), "no pick");
  refused(() => ftRaw(b, "down1", "down2"), "two picks");
  assert.equal(zoneOf(b.engine, b.id("ft")), "hand");
  ftRaw(b, "down1");
  assert.ok(b.engine.state.responseWindow || pending(b.engine), "one pick is accepted");
});

clause(FT, "0:ability", "cost: if the opponent controls no face-down resource the cost cannot be paid and the tactic cannot be played", () => {
  const b = ftBoard({ noDown: true });
  refused(() => ftRaw(b, "oppUp"), "a face-up resource is not a face-down resource");
  refused(() => ftRaw(b), "nothing to pick");
  assert.equal(zoneOf(b.engine, b.id("ft")), "hand");
  const ok = ftBoard();
  ftRaw(ok, "down1");
  assert.ok(ok.engine.state.responseWindow || pending(ok.engine), "positive control: it can be played when there is one");
});

clause(FT, "0:ability", "threshold [O][O]: refused with one Obsession icon, playable with two", () => {
  const one = ftBoard({ obsession: 1 });
  refused(() => ftRaw(one, "down1"), "one [O] is short of [O][O] (two [O] on the same board plays below)", /threshold/i);
  assert.equal(zoneOf(one.engine, one.id("ft")), "hand");
  const two = ftBoard({ obsession: 2 });
  ftRaw(two, "down1");
  assert.ok(two.engine.state.responseWindow || pending(two.engine), "two [O] meet the threshold");
});

// =============================================================================
// Gloamspike-Gosche Bridge — location (arcanist), cost 6, threshold [O][O][O][O], structure 5
// This card cannot be picked.
// All characters in your hand gain TACTICAL.
// [O]x8: All items and locations in your hand gain TACTICAL.
// =============================================================================

const GGB = "40c10ab8-454a-4bab-98a0-d0530c983344";

const pickDestroy = (name: string, zone: "play" | "discard" = "play") =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pk",
          type: "activated",
          targets: [{ id: "t", selector: { zone, type: "location" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
const pickBack = () =>
  tactic({
    name: "PickBack",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pb",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", type: "location" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    }
  });
const sweepLocations = () =>
  tactic({
    name: "SweepLocations",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "sw",
          type: "activated",
          effects: [{ type: "forEach", selector: { zone: "play", type: "location" }, effects: [{ type: "destroy", target: { type: "selected", id: "__candidate" } }] }]
        }
      ]
    }
  });

function ggbBoard(o: { bridge?: "play" | "discard" | "none"; obsession?: number; active?: PlayerId; bridgeController?: PlayerId } = {}): Board {
  const where = o.bridge ?? "play";
  const cards: CardPlacement[] = [
    { key: "otherLoc", def: location({ name: "OtherLoc" }), owner: P2, zone: "play" },
    { key: "hc", def: character({ name: "HandChar", cost: 1 }), owner: P1, zone: "hand" },
    { key: "hi", def: item({ name: "HandItem", cost: 1 }), owner: P1, zone: "hand" },
    { key: "hl", def: location({ name: "HandLoc", cost: 1 }), owner: P1, zone: "hand" },
    { key: "oc", def: character({ name: "OppHandChar", cost: 1 }), owner: P2, zone: "hand" },
    { key: "oi", def: item({ name: "OppHandItem", cost: 1 }), owner: P2, zone: "hand" },
    { key: "ol", def: location({ name: "OppHandLoc", cost: 1 }), owner: P2, zone: "hand" },
    { key: "dc", def: character({ name: "DeckChar", cost: 1 }), owner: P1, zone: "deck" },
    { key: "xc", def: character({ name: "DiscardChar", cost: 1 }), owner: P1, zone: "discard" },
    { key: "xi", def: item({ name: "DiscardItem", cost: 1 }), owner: P1, zone: "discard" },
    { key: "pc", def: character({ name: "PlayChar", cost: 1 }), owner: P1, zone: "play" },
    { key: "atk", def: character({ name: "Attacker", strength: 1 }), owner: P2, zone: "play" },
    { key: "pk", def: pickDestroy("PickKill"), owner: P1, zone: "hand" },
    { key: "pk2", def: pickDestroy("PickKillOpp"), owner: P2, zone: "hand" },
    { key: "pb", def: pickBack(), owner: P1, zone: "hand" },
    { key: "sw", def: sweepLocations(), owner: P1, zone: "hand" },
    ...bank("obsession", o.obsession ?? 0, P1),
    ...bank("rage", 3, P1)
  ];
  if (where !== "none") {
    cards.push({ key: "ggb", def: printing(GGB), owner: P1, zone: where, ...(o.bridgeController ? { controller: o.bridgeController } : {}) });
  }
  return buildGame({ playerA: { faction: dev() }, playerB: { faction: dev() }, cards, turn: 2, activePlayerId: o.active ?? P1 });
}

const tacticalIn = (b: Board, key: string): boolean => b.engine.getKeywords(b.id(key)).includes("tactical");

clause(GGB, "0:rule", "its controller's tactic can pick another location but cannot pick the Bridge", () => {
  const b = ggbBoard();
  refused(() => playRaw(b.engine, P1, b.id("pk"), { selected: { t: [b.id("ggb")] } }), "the Bridge cannot be picked");
  assert.equal(zoneOf(b.engine, b.id("ggb")), "play");
  assert.equal(zoneOf(b.engine, b.id("pk")), "hand", "nothing was played");
  play(b.engine, P1, b.id("pk"), { selected: { t: [b.id("otherLoc")] } });
  assert.equal(zoneOf(b.engine, b.id("otherLoc")), "discard", "positive control: any other location can be picked");
  assert.equal(zoneOf(b.engine, b.id("ggb")), "play");
});

clause(GGB, "0:rule", "the opponent cannot pick it either", () => {
  const b = ggbBoard({ active: P2 });
  refused(() => playRaw(b.engine, P2, b.id("pk2"), { selected: { t: [b.id("ggb")] } }), "the opponent cannot pick the Bridge");
  assert.equal(zoneOf(b.engine, b.id("ggb")), "play");
  play(b.engine, P2, b.id("pk2"), { selected: { t: [b.id("otherLoc")] } });
  assert.equal(zoneOf(b.engine, b.id("otherLoc")), "discard", "positive control");
});

clause(GGB, "0:rule", "'cannot be picked' only blocks picking: an effect that does not pick (destroy all locations) still destroys it", () => {
  const b = ggbBoard();
  play(b.engine, P1, b.id("sw"));
  assert.equal(zoneOf(b.engine, b.id("ggb")), "discard");
  assert.equal(zoneOf(b.engine, b.id("otherLoc")), "discard");
});

clause(GGB, "0:rule", "the rule is only active in play: once the Bridge is in a discard pile it can be picked", () => {
  const b = ggbBoard({ bridge: "discard" });
  play(b.engine, P1, b.id("pb"), { selected: { t: [b.id("ggb")] } });
  assert.equal(zoneOf(b.engine, b.id("ggb")), "hand", "picked out of the discard pile");
});

clause(GGB, "1:rule", "characters in its controller's hand have TACTICAL (and do not without the Bridge)", () => {
  const b = ggbBoard();
  assert.ok(tacticalIn(b, "hc"), "with the Bridge in play");
  const none = ggbBoard({ bridge: "none" });
  assert.ok(!tacticalIn(none, "hc"), "without the Bridge");
});

clause(GGB, "1:rule", "only characters in YOUR hand: not the opponent's hand, your deck, your discard pile or characters already in play", () => {
  const b = ggbBoard();
  assert.ok(tacticalIn(b, "hc"), "tacticalIn(b, \"hc\")");
  for (const key of ["oc", "dc", "xc", "pc"]) assert.ok(!tacticalIn(b, key), `${key} does not gain TACTICAL`);
});

clause(GGB, "1:rule", "'your hand' follows the Bridge's controller: a Bridge you own but the opponent controls gives TACTICAL to the opponent's hand, not yours", () => {
  const b = ggbBoard({ bridgeController: P2 });
  assert.ok(tacticalIn(b, "oc"), "the controller's hand");
  assert.ok(!tacticalIn(b, "hc"), "not the owner's hand");
});

clause(GGB, "1:rule", "without the [O]x8 threshold only characters (not items or locations) in hand are TACTICAL", () => {
  const b = ggbBoard({ obsession: 7 });
  assert.ok(tacticalIn(b, "hc"), "tacticalIn(b, \"hc\")");
  assert.ok(!tacticalIn(b, "hi"), "item");
  assert.ok(!tacticalIn(b, "hl"), "location");
});

clause(GGB, "1:rule", "TACTICAL means the character can be deployed whenever a tactic could be: during the opponent's attack (and not without the Bridge)", () => {
  const withBridge = ggbBoard({ active: P2 });
  declareAttackOpenWindow(withBridge.engine, P2, [withBridge.id("atk")]);
  playRaw(withBridge.engine, P1, withBridge.id("hc"));
  assert.notEqual(zoneOf(withBridge.engine, withBridge.id("hc")), "hand", "deployed in the response window");
  const without = ggbBoard({ active: P2, bridge: "none" });
  declareAttackOpenWindow(without.engine, P2, [without.id("atk")]);
  refused(() => playRaw(without.engine, P1, without.id("hc")), "an ordinary character cannot be deployed in response");
  assert.equal(zoneOf(without.engine, without.id("hc")), "hand");
});

clause(GGB, "1:rule", "TACTICAL goes away when the Bridge leaves play", () => {
  const b = ggbBoard();
  assert.ok(tacticalIn(b, "hc"), "on");
  play(b.engine, P1, b.id("sw"));
  assert.equal(zoneOf(b.engine, b.id("ggb")), "discard");
  assert.ok(!tacticalIn(b, "hc"), "off after the Bridge left play");
  assert.ok(!tacticalIn(b, "oc"), "!tacticalIn(b, \"oc\")");
});

clause(GGB, "2:rule@oooooooo", "with [O]x8: items and locations in your hand gain TACTICAL (characters still do); with only seven they do not", () => {
  const eight = ggbBoard({ obsession: 8 });
  assert.ok(tacticalIn(eight, "hi"), "item");
  assert.ok(tacticalIn(eight, "hl"), "location");
  assert.ok(tacticalIn(eight, "hc"), "character");
  const seven = ggbBoard({ obsession: 7 });
  assert.ok(!tacticalIn(seven, "hi"), "!tacticalIn(seven, \"hi\")");
  assert.ok(!tacticalIn(seven, "hl"), "!tacticalIn(seven, \"hl\")");
  const none = ggbBoard({ obsession: 8, bridge: "none" });
  assert.ok(!tacticalIn(none, "hi"), "no Bridge, no rule");
  assert.ok(!tacticalIn(none, "hl"), "!tacticalIn(none, \"hl\")");
});

clause(GGB, "2:rule@oooooooo", "only items and locations in YOUR hand: not the opponent's, your deck, your discard pile or cards in play", () => {
  const b = ggbBoard({ obsession: 8 });
  for (const key of ["oi", "ol", "xi"]) assert.ok(!tacticalIn(b, key), `${key} does not gain TACTICAL`);
  assert.ok(!tacticalIn(b, "otherLoc"), "a location in play");
});

clause(GGB, "2:rule@oooooooo", "with [O]x8 an item and a location can be deployed in response to an attack; with seven they cannot", () => {
  const eight = ggbBoard({ obsession: 8, active: P2 });
  declareAttackOpenWindow(eight.engine, P2, [eight.id("atk")]);
  playRaw(eight.engine, P1, eight.id("hi"));
  assert.notEqual(zoneOf(eight.engine, eight.id("hi")), "hand", "item deployed");
  const eightLoc = ggbBoard({ obsession: 8, active: P2 });
  declareAttackOpenWindow(eightLoc.engine, P2, [eightLoc.id("atk")]);
  playRaw(eightLoc.engine, P1, eightLoc.id("hl"));
  assert.notEqual(zoneOf(eightLoc.engine, eightLoc.id("hl")), "hand", "location deployed");
  const seven = ggbBoard({ obsession: 7, active: P2 });
  declareAttackOpenWindow(seven.engine, P2, [seven.id("atk")]);
  refused(() => playRaw(seven.engine, P1, seven.id("hi")), "item with seven [O]: no TACTICAL, so the opponent's window refuses it (eight [O] deploys above)", /Only tactics or TACTICAL cards may be deployed as responses/);
  refused(() => playRaw(seven.engine, P1, seven.id("hl")), "location with seven [O]: no TACTICAL, so the opponent's window refuses it (eight [O] deploys above)", /Only tactics or TACTICAL cards may be deployed as responses/);
});

clause(GGB, "2:rule@oooooooo", "the item/location TACTICAL goes away when the Bridge leaves play", () => {
  const b = ggbBoard({ obsession: 8 });
  assert.ok(tacticalIn(b, "hi"), "on");
  play(b.engine, P1, b.id("sw"));
  assert.equal(zoneOf(b.engine, b.id("ggb")), "discard");
  assert.ok(!tacticalIn(b, "hi"), "off");
  assert.ok(!tacticalIn(b, "hl"), "!tacticalIn(b, \"hl\")");
});

// =============================================================================
// Lugubrian Poacher — character (arcanist; lurker), cost 3, threshold [O][O], 2/2/4
// If this card restores, it gains COVERT this turn.
// =============================================================================

const LP = "ecba9157-e8c2-4237-8e99-0a39f6750044";

const restoreIt = (name = "RestoreIt") =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "r",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "restore", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

function lpBoard(o: { depleted?: boolean } = {}): Board {
  return buildGame({
    playerA: { faction: dev() },
    playerB: { faction: dev() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "lp", def: printing(LP), owner: P1, zone: "play", depleted: o.depleted ?? true },
      { key: "other", def: character({ name: "Other" }), owner: P1, zone: "play", depleted: true },
      { key: "r", def: restoreIt(), owner: P1, zone: "hand" },
      { key: "plain", def: character({ name: "PlainBlocker" }), owner: P2, zone: "play" },
      { key: "cov", def: character({ name: "CovertBlocker", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }
    ]
  });
}
const hasCovert = (b: Board, key: string): boolean => b.engine.getKeywords(b.id(key)).includes("covert");

clause(LP, "0:rule", "a restore effect on the Poacher gives it COVERT (and it had none before)", () => {
  const b = lpBoard();
  assert.ok(!hasCovert(b, "lp"), "no COVERT printed or granted before it restores");
  play(b.engine, P1, b.id("r"), { selected: { t: [b.id("lp")] } });
  assert.equal(b.engine.state.cards[b.id("lp")].depleted, false, "it restored");
  assert.ok(hasCovert(b, "lp"), "gains COVERT");
});

clause(LP, "0:rule", "the granted COVERT works: a non-covert character cannot block it, a covert one can", () => {
  const b = lpBoard();
  play(b.engine, P1, b.id("r"), { selected: { t: [b.id("lp")] } });
  declareAttackBy(b.engine, P1, [b.id("lp")]);
  refused(() => declareBlockers(b.engine, P2, [b.id("plain")]), "a non-covert character cannot block a covert attacker");
  assert.ok(battleOf(b.engine), "the battle is still on after the refused block");
  declareBlockers(b.engine, P2, [b.id("cov")]);
  finishBattle(b.engine);
  assert.equal(battleOf(b.engine), undefined, "the covert blocker was accepted and the battle ran");
});

clause(LP, "0:rule", "control: a never-restored Poacher is not covert, so an ordinary character may block it", () => {
  const b = lpBoard({ depleted: false });
  declareAttackBy(b.engine, P1, [b.id("lp")]);
  declareBlockers(b.engine, P2, [b.id("plain")]);
  assert.ok(!hasCovert(b, "lp"), "!hasCovert(b, \"lp\")");
});

clause(LP, "0:rule", "'this turn': the COVERT ends with the turn it was gained in", () => {
  const b = lpBoard();
  play(b.engine, P1, b.id("r"), { selected: { t: [b.id("lp")] } });
  assert.ok(hasCovert(b, "lp"), "during the turn");
  endTurn(b.engine, P1);
  assert.ok(!hasCovert(b, "lp"), "gone in the opponent's turn");
  endTurn(b.engine, P2);
  assert.ok(!hasCovert(b, "lp"), "and still gone on the Poacher's controller's next turn");
});

clause(LP, "0:rule", "near miss: restoring a different character does not give the Poacher (or that character) COVERT", () => {
  const b = lpBoard();
  play(b.engine, P1, b.id("r"), { selected: { t: [b.id("other")] } });
  assert.equal(b.engine.state.cards[b.id("other")].depleted, false);
  assert.equal(b.engine.state.cards[b.id("lp")].depleted, true, "the Poacher itself did not restore");
  assert.ok(!hasCovert(b, "lp"), "!hasCovert(b, \"lp\")");
  assert.ok(!hasCovert(b, "other"), "the other character gains nothing");
});

clause(LP, "0:rule", "near miss: a restore effect aimed at an already-restored Poacher restores nothing (CR 303.2), so no COVERT", () => {
  const b = lpBoard({ depleted: false });
  play(b.engine, P1, b.id("r"), { selected: { t: [b.id("lp")] } });
  assert.ok(!hasCovert(b, "lp"), "!hasCovert(b, \"lp\")");
});

clause(LP, "0:rule", "restored by its faction's RESTORE RULE at the start of its controller's turn it gains COVERT for that turn", () => {
  const b = lpBoard();
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(b.engine.state.cards[b.id("lp")].depleted, false, "the Restore Rule restored it");
  assert.ok(hasCovert(b, "lp"), "it restored, so it gains COVERT this turn");
  declareAttackBy(b.engine, P1, [b.id("lp")]);
  refused(() => declareBlockers(b.engine, P2, [b.id("plain")]), "a non-covert character cannot block a covert attacker");
});

// =============================================================================
// Man Shark — character (arcanist; lurker), cost 3, threshold [O][O], 0/3/0
// This card gains 1 strength and 1 life for each face-down resource each opponent controls.
// FOLLOW SUIT — COST: Pay 3. Pick an opponent. EFFECT: That player puts a card from their hand
// face-down as a resource under their control.
// =============================================================================

const MS = "efc19e34-03c2-4673-a5da-9d1f19af2409";

const downCard = (key: string, owner: PlayerId, extra: Partial<CardPlacement> = {}): CardPlacement => ({
  key,
  def: character({ name: key }),
  owner,
  zone: "play",
  faceDown: true,
  ...extra
});
const killDown = () =>
  tactic({
    name: "KillDown",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "kd",
          type: "activated",
          targets: [{ id: "t", selector: { controller: "opponent", zone: "play", faceDown: true, type: "resource" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

function msBoard(o: { oppDowns?: number; mineDowns?: number; oppHand?: number; ready?: number; msZone?: PlacementZone; msDepleted?: boolean; extra?: CardPlacement[] } = {}): Board {
  return buildGame({
    playerA: { faction: dev() },
    playerB: { faction: dev() },
    cards: [
      { key: "ms", def: printing(MS), owner: P1, zone: o.msZone ?? "play", depleted: o.msDepleted },
      ...Array.from({ length: o.oppDowns ?? 0 }, (_, i) => downCard(`od${i}`, P2)),
      ...Array.from({ length: o.mineDowns ?? 0 }, (_, i) => downCard(`md${i}`, P1)),
      { key: "oppUp", def: resourceCard({ name: "OppUp" }), owner: P2, zone: "play" },
      { key: "oppChar", def: character({ name: "OppChar" }), owner: P2, zone: "play" },
      { key: "oppVoid", def: character({ name: "OppVoid" }), owner: P2, zone: "void", faceDown: true },
      { key: "kd", def: killDown(), owner: P1, zone: "hand" },
      { key: "myHand", def: character({ name: "MyHand" }), owner: P1, zone: "hand" },
      ...fillers("oh", o.oppHand ?? 3, P2, "hand", (i) => (i === 1 ? resourceCard({ name: "OppHandStaple" }) : character({ name: `OppHand${i}` }))),
      ...fillers("odk", 2, P2, "deck"),
      ...bank("rage", o.ready ?? 3, P1),
      ...(o.extra ?? [])
    ]
  });
}
const stats = (b: Board, key: string): [number, number, number] => [b.engine.getStat(b.id(key), "strength"), b.engine.getStat(b.id(key), "life"), b.engine.getStat(b.id(key), "speed")];

clause(MS, "0:rule", "with one opposing face-down resource it is 1 strength / 1 life (speed stays 3)", () => {
  assert.deepEqual(stats(msBoard({ oppDowns: 1 }), "ms"), [1, 1, 3]);
});

clause(MS, "0:rule", "with three opposing face-down resources it is 3 strength / 3 life", () => {
  assert.deepEqual(stats(msBoard({ oppDowns: 3 }), "ms"), [3, 3, 3]);
});

clause(MS, "0:rule", "only the opponent's face-down resources count: not your own, a face-up resource, a face-up character, a hand card or a card in the void", () => {
  const b = msBoard({ oppDowns: 2, mineDowns: 3 });
  assert.deepEqual(stats(b, "ms"), [2, 2, 3]);
});

clause(MS, "0:rule", "'controls': a face-down card you own but the opponent controls counts, one you control but the opponent owns does not", () => {
  const b = msBoard({
    oppDowns: 1,
    extra: [downCard("stolenIn", P1, { controller: P2 }), downCard("stolenOut", P2, { controller: P1 })]
  });
  assert.equal(b.engine.state.cards[b.id("stolenIn")].controllerId, P2);
  assert.deepEqual(stats(b, "ms"), [2, 2, 3], "od0 plus the one the opponent controls");
});

clause(MS, "0:rule", "deploys for its printed cost of 3 with [O][O]: refused with two resources or with one Obsession icon", () => {
  const ok = msBoard({ oppDowns: 2, msZone: "hand", ready: 0, extra: [...bank("obsession", 2, P1), ...bank("rage", 1, P1)] });
  assert.equal(readyResources(ok.engine, P1), 3);
  play(ok.engine, P1, ok.id("ms"));
  assert.equal(zoneOf(ok.engine, ok.id("ms")), "play");
  assert.equal(readyResources(ok.engine, P1), 0, "3 paid");
  const short = msBoard({ oppDowns: 2, msZone: "hand", ready: 0, extra: [...bank("obsession", 2, P1)] });
  refused(() => playRaw(short.engine, P1, short.id("ms")), "two resources are one short of 3");
  const noThreshold = msBoard({ oppDowns: 2, msZone: "hand", ready: 0, extra: [...bank("obsession", 1, P1), ...bank("rage", 2, P1)] });
  assert.equal(readyResources(noThreshold.engine, P1), 3);
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("ms")), "three resources but one [O] is short of [O][O] (control: two [O] plus a third resource plays above)", /threshold/i);
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("ms")), "hand");
});

clause(MS, "0:rule", "every face-down card the opponent controls counts, whatever its type and even when it is spent (attached to their faction)", () => {
  const b = msBoard({
    oppDowns: 1,
    extra: [
      { key: "downItem", def: item({ name: "DownItem" }), owner: P2, zone: "play", faceDown: true },
      { key: "downLoc", def: location({ name: "DownLoc" }), owner: P2, zone: "play", faceDown: true },
      downCard("spentDown", P2, { attachedToKey: "__factionB" })
    ]
  });
  assert.equal(b.engine.state.cards[b.id("spentDown")].attachedTo, factionOf(b.engine, P2), "the face-down card is spent");
  assert.deepEqual(stats(b, "ms"), [4, 4, 3]);
});

clause(MS, "0:rule", "it follows the count live: losing a face-down resource shrinks it (3 -> 2 -> 1)", () => {
  const b = msBoard({ oppDowns: 3, extra: [{ key: "kd2", def: killDown(), owner: P1, zone: "hand" }] });
  assert.deepEqual(stats(b, "ms"), [3, 3, 3]);
  play(b.engine, P1, b.id("kd"), { selected: { t: [b.id("od0")] } });
  assert.deepEqual(stats(b, "ms"), [2, 2, 3]);
  play(b.engine, P1, b.id("kd2"), { selected: { t: [b.id("od1")] } });
  assert.deepEqual(stats(b, "ms"), [1, 1, 3]);
  assert.equal(zoneOf(b.engine, b.id("ms")), "play", "1 life with 0 damage survives");
});

clause(MS, "0:rule", "the bonus is a rule of the card in play: in hand or in the discard pile it has its printed 0 / 0", () => {
  assert.deepEqual(stats(msBoard({ oppDowns: 2, msZone: "hand" }), "ms").slice(0, 2), [0, 0], "in hand");
  assert.deepEqual(stats(msBoard({ oppDowns: 2, msZone: "discard" }), "ms").slice(0, 2), [0, 0], "in the discard pile");
});

clause(MS, "0:rule", "with no opposing face-down resource it has 0 life and is destroyed (FAQ: a character with 0 life is destroyed)", () => {
  const b = msBoard({ oppDowns: 0, msZone: "hand", extra: [...bank("obsession", 3, P1)] });
  play(b.engine, P1, b.id("ms"));
  assert.equal(zoneOf(b.engine, b.id("ms")), "discard", "printed 0 life + 0 face-down resources = 0 life and 0 damage -> destroyed");
});

clause(MS, "0:rule", "when the opponent's last face-down resource leaves, its life drops to 0 and it is destroyed", () => {
  const b = msBoard({ oppDowns: 1 });
  assert.equal(zoneOf(b.engine, b.id("ms")), "play");
  play(b.engine, P1, b.id("kd"), { selected: { t: [b.id("od0")] } });
  assert.equal(zoneOf(b.engine, b.id("od0")), "discard");
  assert.equal(b.engine.getStat(b.id("ms"), "life"), 0);
  assert.equal(zoneOf(b.engine, b.id("ms")), "discard", "0 life with 0 damage -> destroyed");
});

clause(MS, "1:ability:ms-follow", "COST: Pay 3. EFFECT: the opponent chooses a card from their hand and puts it into play face-down as a resource under their control (everything else stays)", () => {
  const b = msBoard({ oppDowns: 1 });
  assert.equal(readyResources(b.engine, P1), 3);
  const handBefore = handOf(b.engine, P2);
  activate(b.engine, P1, b.id("ms"), "ms-follow");
  assert.equal(readyResources(b.engine, P1), 0, "Pay 3: all three spent");
  const pc = pending(b.engine)!;
  assert.deepEqual([pc.kind, pc.playerId], ["chooserSelectsTarget", P2], "the opponent chooses");
  pickCards(b.engine, [b.id("oh2")]);
  assert.equal(pending(b.engine), undefined);
  const card = b.engine.state.cards[b.id("oh2")];
  assert.equal(card.zone, "play");
  assert.equal(card.faceDown, true, "face-down");
  assert.equal(card.controllerId, P2, "under their control");
  assert.deepEqual(handOf(b.engine, P2), handBefore.filter((c) => c !== b.id("oh2")), "only that card left the hand");
  assert.equal(deckOf(b.engine, P2).length, 2, "nothing was drawn");
});

clause(MS, "1:ability:ms-follow", "the new face-down resource counts for the Shark itself: it grows by 1 / 1", () => {
  const b = msBoard({ oppDowns: 1 });
  assert.deepEqual(stats(b, "ms"), [1, 1, 3]);
  activate(b.engine, P1, b.id("ms"), "ms-follow");
  pickCards(b.engine, [b.id("oh0")]);
  assert.deepEqual(stats(b, "ms"), [2, 2, 3]);
});

clause(MS, "1:ability:ms-follow", "an actual resource card in their hand also goes in face-down, providing Volition instead of its icon", () => {
  const b = msBoard({ oppDowns: 1 });
  const volitionBefore = b.engine.getThresholds(P2).volition ?? 0;
  activate(b.engine, P1, b.id("ms"), "ms-follow");
  pickCards(b.engine, [b.id("oh1")]);
  const card = b.engine.state.cards[b.id("oh1")];
  assert.equal(card.zone, "play");
  assert.equal(card.faceDown, true, "put face-down even though it is a resource card");
  assert.equal((b.engine.getThresholds(P2).volition ?? 0) - volitionBefore, 1, "a face-down card provides one Volition icon");
});

clause(MS, "1:ability:ms-follow", "the opponent's pick comes only from their own hand, and it is mandatory", () => {
  const b = msBoard({ oppDowns: 1 });
  activate(b.engine, P1, b.id("ms"), "ms-follow");
  refused(() => pickCards(b.engine, [b.id("myHand")]), "the Shark controller's hand card");
  refused(() => pickCards(b.engine, [deckOf(b.engine, P2)[0]!]), "a card in the opponent's deck");
  refused(() => pickCards(b.engine, [b.id("oppChar")]), "a card already in play");
  refused(() => pickCards(b.engine, []), "they must put a card");
  refused(() => pickCards(b.engine, [b.id("oh0"), b.id("oh2")]), "one card, not two");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting");
  pickCards(b.engine, [b.id("oh0")]);
  assert.equal(zoneOf(b.engine, b.id("oh0")), "play");
});

clause(MS, "1:ability:ms-follow", "COST: Pay 3 — refused with only two resources, usable with three", () => {
  const short = msBoard({ ready: 2 });
  refused(() => activate(short.engine, P1, short.id("ms"), "ms-follow"), "Pay 3 with two resources");
  assert.equal(pending(short.engine), undefined);
  assert.equal(handOf(short.engine, P2).length, 3);
  const ok = msBoard({ ready: 3 });
  activate(ok.engine, P1, ok.id("ms"), "ms-follow");
  assert.equal(pending(ok.engine)?.kind, "chooserSelectsTarget");
});

clause(MS, "1:ability:ms-follow", "the opponent has no cards in hand: the 3 is still paid and nothing stalls", () => {
  const b = msBoard({ oppDowns: 1, oppHand: 0 });
  const down = playOf(b.engine, P2).length;
  activate(b.engine, P1, b.id("ms"), "ms-follow");
  if (pending(b.engine)) pickCards(b.engine, []);
  assert.equal(pending(b.engine), undefined);
  assert.equal(readyResources(b.engine, P1), 0, "the cost was paid");
  assert.equal(playOf(b.engine, P2).length, down, "nothing entered play");
});

clause(MS, "1:ability:ms-follow", "no other cost: usable while the Shark is depleted, and again in the same turn", () => {
  const b = msBoard({ oppDowns: 1, ready: 6, msDepleted: true });
  activate(b.engine, P1, b.id("ms"), "ms-follow");
  pickCards(b.engine, [b.id("oh0")]);
  activate(b.engine, P1, b.id("ms"), "ms-follow");
  pickCards(b.engine, [b.id("oh2")]);
  assert.equal(readyResources(b.engine, P1), 0);
  assert.equal(zoneOf(b.engine, b.id("oh0")), "play");
  assert.equal(zoneOf(b.engine, b.id("oh2")), "play");
  assert.deepEqual(stats(b, "ms"), [3, 3, 3]);
});

clause(MS, "1:ability:ms-follow", "only the Shark's controller can use it", () => {
  const b = msBoard({ oppDowns: 1 });
  refused(() => activate(b.engine, P2, b.id("ms"), "ms-follow"), "the opponent cannot use it");
  assert.equal(pending(b.engine), undefined);
  assert.equal(readyResources(b.engine, P1), 3);
  activate(b.engine, P1, b.id("ms"), "ms-follow");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "positive control");
});

// =============================================================================
// Mittens of Muffled Thought — item (arcanist; gear), cost 3, threshold [O]
// ATTACH TO CHARACTER
// The attached character cannot attack and has no rules text.
// MOVE — COST: Pick a character that is not in battle. Pay 3. EFFECT: Attach this card to the character.
// =============================================================================

const MIT = "1c7ffb60-714a-4497-ae9f-13d9980158e6";

const hostDef = (name: string): CardDefinition =>
  character({
    name,
    strength: 1,
    life: 3,
    speed: 2,
    behavior: {
      keywords: ["covert"],
      abilities: [
        { id: "h-draw", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] },
        { id: "h-pump", type: "continuous", modifiers: [{ target: "source", stat: "strength", operation: "add", value: 2 }] },
        { id: "h-restored", type: "triggered", event: "cardRestored", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }
      ]
    }
  });
const killChar = () =>
  tactic({
    name: "KillChar",
    cost: 0,
    behavior: { abilities: [{ id: "kc", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
const killItem = () =>
  tactic({
    name: "KillItem",
    cost: 0,
    behavior: { abilities: [{ id: "ki", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
const bounceChar = () =>
  tactic({
    name: "BounceChar",
    cost: 0,
    behavior: { abilities: [{ id: "bc", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });

/** `mit`: where Mittens starts ("hand", "onA" = attached to hostA, or "none"). hostA (P1) and hostB (P2) both carry a keyword, an activated ability, a static pump and a trigger. */
function mitBoard(o: { mit?: "hand" | "onA" | "onB" | "none"; rage?: number; obsession?: number; hostADepleted?: boolean } = {}): Board {
  const where = o.mit ?? "onA";
  const cards: CardPlacement[] = [
    { key: "hostA", def: hostDef("HostA"), owner: P1, zone: "play", depleted: o.hostADepleted },
    { key: "hostB", def: hostDef("HostB"), owner: P2, zone: "play" },
    { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
    { key: "by", def: character({ name: "Bystander" }), owner: P1, zone: "play" },
    { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
    { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
    { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
    { key: "res", def: resourceCard({ name: "OppRes" }), owner: P2, zone: "play" },
    { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
    { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
    { key: "r", def: restoreIt(), owner: P1, zone: "hand" },
    { key: "kill", def: killChar(), owner: P1, zone: "hand" },
    { key: "bounce", def: bounceChar(), owner: P1, zone: "hand" },
    { key: "killIt", def: killItem(), owner: P1, zone: "hand" },
    { key: "blk", def: character({ name: "PlainBlocker" }), owner: P2, zone: "play" },
    ...fillers("dk", 4, P1, "deck"),
    ...bank("obsession", o.obsession ?? 1, P1),
    ...bank("rage", o.rage ?? 2, P1)
  ];
  if (where === "hand") cards.push({ key: "mit", def: printing(MIT), owner: P1, zone: "hand" });
  if (where === "onA") cards.push({ key: "mit", def: printing(MIT), owner: P1, zone: "play", attachedToKey: "hostA" });
  if (where === "onB") cards.push({ key: "mit", def: printing(MIT), owner: P1, zone: "play", attachedToKey: "hostB" });
  return buildGame({ playerA: { faction: dev() }, playerB: { faction: dev() }, cards, turn: 2, activePlayerId: P1 });
}
const attachTo = (b: Board, hostKey: string): void => play(b.engine, P1, b.id("mit"), { selected: { attachTo: [b.id(hostKey)] } });
const attachRaw = (b: Board, ...hostKeys: string[]): void => playRaw(b.engine, P1, b.id("mit"), { selected: { attachTo: hostKeys.map((k) => b.id(k)) } });
const hostOf = (b: Board): CardInstanceId | undefined => b.engine.state.cards[b.id("mit")].attachedTo;

clause(MIT, "0:attach", "attaches to a character you control, paying the printed cost of 3", () => {
  const b = mitBoard({ mit: "hand" });
  assert.equal(readyResources(b.engine, P1), 3);
  attachTo(b, "hostA");
  assert.equal(zoneOf(b.engine, b.id("mit")), "play");
  assert.equal(hostOf(b), b.id("hostA"), "attached to the picked character");
  assert.equal(readyResources(b.engine, P1), 0, "cost 3 paid");
  assert.equal(b.engine.state.cards[b.id("ally")].attachedTo, undefined, "no other character gets it");
});

clause(MIT, "0:attach", "attaches to an opponent's character too (ATTACH TO CHARACTER names no controller) and you keep control of the Mittens", () => {
  const b = mitBoard({ mit: "hand" });
  attachTo(b, "hostB");
  assert.equal(hostOf(b), b.id("hostB"));
  assert.equal(b.engine.state.cards[b.id("mit")].controllerId, P1);
});

clause(MIT, "0:attach", "is refused for a host that is not a character: an item, a location, a face-down card, a resource, a faction", () => {
  const b = mitBoard({ mit: "hand" });
  refused(() => attachRaw(b, "thing"), "an item");
  refused(() => attachRaw(b, "place"), "a location");
  refused(() => attachRaw(b, "hidden"), "a face-down card is only a resource (CR 411.1)");
  refused(() => attachRaw(b, "res"), "a resource");
  refused(() => playRaw(b.engine, P1, b.id("mit"), { selected: { attachTo: [factionOf(b.engine, P1)] } }), "your faction");
  refused(() => playRaw(b.engine, P1, b.id("mit"), { selected: { attachTo: [factionOf(b.engine, P2)] } }), "the opponent's faction");
  assert.equal(zoneOf(b.engine, b.id("mit")), "hand", "nothing was played");
  attachRaw(b, "hostA");
  assert.ok(b.engine.state.responseWindow, "a character is accepted");
});

clause(MIT, "0:attach", "is refused for a character that is not in play (in hand or in a discard pile) and needs exactly one host", () => {
  const b = mitBoard({ mit: "hand" });
  refused(() => attachRaw(b, "inHand"), "a character in hand");
  refused(() => attachRaw(b, "inDiscard"), "a character in a discard pile");
  refused(() => attachRaw(b), "no host");
  refused(() => attachRaw(b, "hostA", "ally"), "two hosts");
  assert.equal(zoneOf(b.engine, b.id("mit")), "hand");
});

clause(MIT, "0:attach", "threshold [O]: refused with no Obsession icon even when the cost is affordable, playable with one", () => {
  const none = mitBoard({ mit: "hand", obsession: 0, rage: 5 });
  assert.equal(readyResources(none.engine, P1), 5);
  refused(() => attachRaw(none, "hostA"), "no [O]");
  assert.equal(zoneOf(none.engine, none.id("mit")), "hand");
  const ok = mitBoard({ mit: "hand", obsession: 1, rage: 2 });
  attachTo(ok, "hostA");
  assert.equal(zoneOf(ok.engine, ok.id("mit")), "play");
});

clause(MIT, "0:attach", "cost 3: refused with only two resources", () => {
  const b = mitBoard({ mit: "hand", obsession: 1, rage: 1 });
  assert.equal(readyResources(b.engine, P1), 2);
  refused(() => attachTo(b, "hostA"), "two resources are one short");
  assert.equal(zoneOf(b.engine, b.id("mit")), "hand");
});

clause(MIT, "0:attach", "when the host is destroyed the attached Mittens leaves play with it (CR 301.4: to the discard pile)", () => {
  const b = mitBoard();
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("hostA")] } });
  assert.equal(zoneOf(b.engine, b.id("hostA")), "discard");
  assert.equal(zoneOf(b.engine, b.id("mit")), "discard");
});

clause(MIT, "0:attach", "when the host leaves play another way (returned to hand) the Mittens leaves play in the same way (CR 301.4)", () => {
  const b = mitBoard();
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("hostA")] } });
  assert.equal(zoneOf(b.engine, b.id("hostA")), "hand");
  assert.equal(zoneOf(b.engine, b.id("mit")), "hand", "returned to its owner's hand along with the host");
});

clause(MIT, "1:rule", "the attached character cannot attack, alone or in a party; an unaffected character attacks fine", () => {
  const b = mitBoard();
  refused(() => b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [b.id("hostA")], target: { type: "faction", playerId: P2 } }), "the attached character cannot attack");
  refused(() => b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [b.id("ally"), b.id("hostA")], target: { type: "faction", playerId: P2 } }), "nor can it join a party");
  assert.equal(b.engine.state.cards[b.id("ally")].depleted, false, "the legal attacker was not depleted by the refused attack");
  assert.equal(battleOf(b.engine), undefined);
  declareAttackBy(b.engine, P1, [b.id("ally")]);
  assert.ok(battleOf(b.engine), "positive control: another character attacks");
});

clause(MIT, "1:rule", "the attack ban follows the Mittens: after MOVE the old host can attack and the new host cannot", () => {
  const b = mitBoard({ rage: 3 });
  activate(b.engine, P1, b.id("mit"), "mmt-move", { selected: { c: [b.id("ally")] } });
  refused(() => b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [b.id("ally")], target: { type: "faction", playerId: P2 } }), "the new host cannot attack");
  declareAttackBy(b.engine, P1, [b.id("hostA")]);
  assert.ok(battleOf(b.engine), "the old host attacks again");
});

clause(MIT, "1:rule", "control: the same character without the Mittens can attack", () => {
  const b = mitBoard({ mit: "none" });
  declareAttackBy(b.engine, P1, [b.id("hostA")]);
  assert.ok(battleOf(b.engine), "battleOf(b.engine)");
});

clause(MIT, "1:rule", "no rules text: the attached character's activated ability cannot be used (and can without the Mittens)", () => {
  const b = mitBoard();
  const handBefore = handOf(b.engine, P1).length;
  refused(() => activate(b.engine, P1, b.id("hostA"), "h-draw"), "its ability is gone", /Activated ability not found/);
  assert.equal(handOf(b.engine, P1).length, handBefore);
  const free = mitBoard({ mit: "none" });
  activate(free.engine, P1, free.id("hostA"), "h-draw");
  assert.equal(handOf(free.engine, P1).length, handBefore + 1, "positive control");
});

clause(MIT, "1:rule", "no rules text: the attached character's triggered ability does not fire (and does without the Mittens)", () => {
  const b = mitBoard({ hostADepleted: true });
  const handBefore = handOf(b.engine, P1).length;
  play(b.engine, P1, b.id("r"), { selected: { t: [b.id("hostA")] } });
  assert.equal(b.engine.state.cards[b.id("hostA")].depleted, false, "it did restore");
  assert.equal(handOf(b.engine, P1).length, handBefore - 1, "only the played tactic left the hand: no draw trigger");
  const free = mitBoard({ mit: "none", hostADepleted: true });
  play(free.engine, P1, free.id("r"), { selected: { t: [free.id("hostA")] } });
  assert.equal(handOf(free.engine, P1).length, handBefore, "positive control: -1 tactic +1 draw");
});

clause(MIT, "1:rule", "no rules text: the attached character's static bonus is off, but its printed stats are not rules text", () => {
  const free = mitBoard({ mit: "none" });
  assert.deepEqual([free.engine.getStat(free.id("hostA"), "strength"), free.engine.getStat(free.id("hostA"), "life"), free.engine.getStat(free.id("hostA"), "speed")], [3, 3, 2], "control: 1 + 2 from its own text");
  const b = mitBoard();
  assert.deepEqual([b.engine.getStat(b.id("hostA"), "strength"), b.engine.getStat(b.id("hostA"), "life"), b.engine.getStat(b.id("hostA"), "speed")], [1, 3, 2], "printed 1 / 3 / 2 remain");
});

clause(MIT, "1:rule", "no rules text: a printed keyword (COVERT) is rules text too, so the attached character does not have it", () => {
  const free = mitBoard({ mit: "none" });
  assert.ok(free.engine.getKeywords(free.id("hostA")).includes("covert"), "control: without the Mittens it has COVERT");
  const b = mitBoard();
  assert.ok(!b.engine.getKeywords(b.id("hostA")).includes("covert"), "with the Mittens attached it has no rules text, so no COVERT");
});

clause(MIT, "1:rule", "only the attached character is affected: other characters keep their rules text (also when the Mittens sits on the opponent's character)", () => {
  const b = mitBoard();
  assert.equal(b.engine.getStat(b.id("hostB"), "strength"), 3, "the opponent's character keeps its static bonus");
  const handBefore = handOf(b.engine, P1).length;
  const onOpp = mitBoard({ mit: "onB" });
  assert.equal(onOpp.engine.getStat(onOpp.id("hostB"), "strength"), 1, "attached to the opponent's character it applies there");
  assert.equal(onOpp.engine.getStat(onOpp.id("hostA"), "strength"), 3, "and hostA is unaffected");
  activate(onOpp.engine, P1, onOpp.id("hostA"), "h-draw");
  assert.equal(handOf(onOpp.engine, P1).length, handBefore + 1, "hostA's ability still works");
});

clause(MIT, "1:rule", "the text comes back when the Mittens leaves the character (here: it moves away)", () => {
  const b = mitBoard({ rage: 3 });
  assert.equal(b.engine.getStat(b.id("hostA"), "strength"), 1, "suppressed while attached");
  refused(() => activate(b.engine, P1, b.id("hostA"), "h-draw"), "no ability while attached", /Activated ability not found/);
  activate(b.engine, P1, b.id("mit"), "mmt-move", { selected: { c: [b.id("ally")] } });
  assert.equal(b.engine.getStat(b.id("hostA"), "strength"), 3, "static bonus returns");
  const handBefore = handOf(b.engine, P1).length;
  activate(b.engine, P1, b.id("hostA"), "h-draw");
  assert.equal(handOf(b.engine, P1).length, handBefore + 1, "its ability returns");
});

clause(MIT, "1:rule", "the text comes back when the Mittens is destroyed", () => {
  const b = mitBoard();
  assert.equal(b.engine.getStat(b.id("hostA"), "strength"), 1);
  play(b.engine, P1, b.id("killIt"), { selected: { t: [b.id("mit")] } });
  assert.equal(zoneOf(b.engine, b.id("mit")), "discard");
  assert.equal(b.engine.getStat(b.id("hostA"), "strength"), 3, "static bonus is back");
  const handBefore = handOf(b.engine, P1).length;
  activate(b.engine, P1, b.id("hostA"), "h-draw");
  assert.equal(handOf(b.engine, P1).length, handBefore + 1, "ability is back");
});

clause(MIT, "2:ability:mmt-move", "moves the Mittens to the picked character (own or the opponent's), paying 3; the new host loses its text and the old one regains it", () => {
  const b = mitBoard({ rage: 3 });
  assert.equal(readyResources(b.engine, P1), 4);
  activate(b.engine, P1, b.id("mit"), "mmt-move", { selected: { c: [b.id("hostB")] } });
  assert.equal(pending(b.engine), undefined);
  assert.equal(hostOf(b), b.id("hostB"), "now on the opponent's character");
  assert.equal(readyResources(b.engine, P1), 1, "Pay 3");
  assert.equal(zoneOf(b.engine, b.id("mit")), "play");
  assert.equal(b.engine.state.cards[b.id("mit")].controllerId, P1);
  assert.equal(b.engine.getStat(b.id("hostB"), "strength"), 1, "new host has no rules text: its static bonus is off");
  assert.equal(b.engine.getStat(b.id("hostA"), "strength"), 3, "old host has its text back");
});

clause(MIT, "2:ability:mmt-move", "moves onto one of your own characters", () => {
  const b = mitBoard({ rage: 3 });
  activate(b.engine, P1, b.id("mit"), "mmt-move", { selected: { c: [b.id("ally")] } });
  assert.equal(hostOf(b), b.id("ally"));
  assert.equal(readyResources(b.engine, P1), 1);
});

clause(MIT, "2:ability:mmt-move", "COST: Pay 3 — refused with only two resources, usable with three", () => {
  const short = mitBoard({ rage: 1 });
  assert.equal(readyResources(short.engine, P1), 2);
  refused(() => activate(short.engine, P1, short.id("mit"), "mmt-move", { selected: { c: [short.id("ally")] } }), "two resources");
  assert.equal(hostOf(short), short.id("hostA"), "did not move");
  const ok = mitBoard({ rage: 2 });
  assert.equal(readyResources(ok.engine, P1), 3);
  activate(ok.engine, P1, ok.id("mit"), "mmt-move", { selected: { c: [ok.id("ally")] } });
  assert.equal(hostOf(ok), ok.id("ally"));
});

clause(MIT, "2:ability:mmt-move", "the pick must be a character in play: not an item, location, face-down card, resource, faction or a card in hand/discard; exactly one", () => {
  const b = mitBoard({ rage: 3 });
  for (const key of ["thing", "place", "hidden", "res", "inHand", "inDiscard"]) {
    refused(() => activate(b.engine, P1, b.id("mit"), "mmt-move", { selected: { c: [b.id(key)] } }), `${key} is not a character in play`);
  }
  refused(() => activate(b.engine, P1, b.id("mit"), "mmt-move", { selected: { c: [factionOf(b.engine, P2)] } }), "a faction");
  refused(() => activate(b.engine, P1, b.id("mit"), "mmt-move", { selected: { c: [] } }), "no pick");
  refused(() => activate(b.engine, P1, b.id("mit"), "mmt-move", { selected: { c: [b.id("ally"), b.id("by")] } }), "two picks");
  assert.equal(hostOf(b), b.id("hostA"));
  assert.equal(readyResources(b.engine, P1), 4, "nothing was paid by the refusals");
  activate(b.engine, P1, b.id("mit"), "mmt-move", { selected: { c: [b.id("by")] } });
  assert.equal(hostOf(b), b.id("by"), "positive control");
});

clause(MIT, "2:ability:mmt-move", "the pick must NOT be in battle: neither an attacker nor a blocker can be picked, a bystander can", () => {
  const b = mitBoard({ rage: 6 });
  declareAttackBy(b.engine, P1, [b.id("ally")]);
  refused(() => activate(b.engine, P1, b.id("mit"), "mmt-move", { selected: { c: [b.id("ally")] } }), "the attacker is in battle");
  declareBlockers(b.engine, P2, [b.id("blk")]);
  refused(() => activate(b.engine, P1, b.id("mit"), "mmt-move", { selected: { c: [b.id("blk")] } }), "the blocker is in battle");
  assert.equal(hostOf(b), b.id("hostA"));
  activate(b.engine, P1, b.id("mit"), "mmt-move", { selected: { c: [b.id("by")] } });
  assert.equal(hostOf(b), b.id("by"), "a character not in battle can be picked");
});

// =============================================================================
// Monstrous Lassitude — character (arcanist; monstrosity), cost 2, threshold [O][O], 4/3/4
// When this card comes into play, on your next turn, skip your faction's RESTORE RULE.
// [V]x4: This card loses all other rules text.
// =============================================================================

const ML = "99ed6205-1f9e-4d62-a1ae-f9038449db17";

function mlBoard(o: { owner?: PlayerId; vol?: number; copies?: number; inPlay?: boolean } = {}): Board {
  const owner = o.owner ?? P1;
  const opp = owner === P1 ? P2 : P1;
  const cards: CardPlacement[] = [
    { key: "tiredMine", def: character({ name: "TiredMine" }), owner, zone: "play", depleted: true },
    { key: "tiredOpp", def: character({ name: "TiredOpp" }), owner: opp, zone: "play", depleted: true },
    { key: "other", def: character({ name: "OtherChar", cost: 1 }), owner, zone: "hand" },
    ...bank("obsession", 6, owner),
    ...(o.vol ? volition(o.vol, owner) : [])
  ];
  if (o.inPlay) cards.push({ key: "ml", def: printing(ML), owner, zone: "play" });
  else for (let i = 0; i < (o.copies ?? 1); i++) cards.push({ key: i === 0 ? "ml" : `ml${i + 1}`, def: printing(ML), owner, zone: "hand" });
  return buildGame({ playerA: { faction: dev() }, playerB: { faction: dev() }, cards, turn: owner === P1 ? 1 : 2, activePlayerId: owner });
}
const isDepleted = (b: Board, key: string): boolean => b.engine.state.cards[b.id(key)].depleted;

clause(ML, "0:rule", "entering play: its controller's NEXT turn's RESTORE RULE is skipped (characters stay depleted, spent resources stay spent), the opponent's turn in between is not, and the turn after restores normally", () => {
  const b = mlBoard();
  const full = readyResources(b.engine, P1);
  play(b.engine, P1, b.id("ml"));
  assert.equal(zoneOf(b.engine, b.id("ml")), "play");
  assert.equal(readyResources(b.engine, P1), full - 2, "cost 2 paid");
  endTurn(b.engine, P1);
  assert.equal(isDepleted(b, "tiredOpp"), false, "the opponent's own restore rule runs on their turn");
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(isDepleted(b, "tiredMine"), true, "skipped: still depleted");
  assert.equal(readyResources(b.engine, P1), full - 2, "skipped: the spent resources were not detached");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(isDepleted(b, "tiredMine"), false, "the following turn the rule runs again");
  assert.equal(readyResources(b.engine, P1), full, "and the resources are detached");
});

clause(ML, "0:rule", "'your faction': an opponent-controlled Lassitude skips the opponent's next restore, not the other player's", () => {
  const b = mlBoard({ owner: P2 });
  play(b.engine, P2, b.id("ml"));
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(isDepleted(b, "tiredOpp"), false, "P1's restore rule is not skipped by P2's card");
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(isDepleted(b, "tiredMine"), true, "P2's own next restore is skipped");
});

clause(ML, "0:rule", "it triggers when it comes into play, not while it is in play: a Lassitude already on the board skips nothing", () => {
  const b = mlBoard({ inPlay: true });
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(isDepleted(b, "tiredMine"), false);
});

clause(ML, "0:rule", "only when THIS card comes into play: a Lassitude on the board and another character entering play skips nothing", () => {
  const b = mlBoard({ inPlay: true });
  play(b.engine, P1, b.id("other"));
  assert.equal(zoneOf(b.engine, b.id("other")), "play");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(isDepleted(b, "tiredMine"), false, "the restore rule ran");
});

clause(ML, "0:rule", "two copies entering the same turn both skip the same 'next turn' once; the turn after that restores normally", () => {
  const b = mlBoard({ copies: 2 });
  play(b.engine, P1, b.id("ml"));
  play(b.engine, P1, b.id("ml2"));
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(isDepleted(b, "tiredMine"), true, "your next turn: skipped");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(isDepleted(b, "tiredMine"), false, "the turn after that is no longer 'your next turn' for either copy");
});

clause(ML, "1:rule@vvvv", "with [V]x4 it loses its other rules text, so the skip trigger does not happen and the next restore runs", () => {
  const b = mlBoard({ vol: 4 });
  const full = readyResources(b.engine, P1);
  play(b.engine, P1, b.id("ml"));
  assert.equal(zoneOf(b.engine, b.id("ml")), "play");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(isDepleted(b, "tiredMine"), false, "restored: the trigger was blank");
  assert.equal(readyResources(b.engine, P1), full, "resources detached too");
});

clause(ML, "1:rule@vvvv", "near miss: with only [V]x3 the card keeps its text and the restore is skipped", () => {
  const b = mlBoard({ vol: 3 });
  play(b.engine, P1, b.id("ml"));
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(isDepleted(b, "tiredMine"), true);
});

clause(ML, "1:rule@vvvv", "losing its rules text does not change its printed stats (4 / 3 / 4), and without [V]x4 they are the same", () => {
  const withV = mlBoard({ vol: 4, inPlay: true });
  assert.deepEqual([withV.engine.getStat(withV.id("ml"), "strength"), withV.engine.getStat(withV.id("ml"), "speed"), withV.engine.getStat(withV.id("ml"), "life")], [4, 3, 4]);
  const without = mlBoard({ inPlay: true });
  assert.deepEqual([without.engine.getStat(without.id("ml"), "strength"), without.engine.getStat(without.id("ml"), "speed"), without.engine.getStat(without.id("ml"), "life")], [4, 3, 4]);
});

// =============================================================================
// Neuralyzer Agent — character (arcanist; muddler), cost 5, threshold [O][O], 3/3/3
// If this card attacks, pick an opponent. That player discards a card.
// [O]x6: If this card inflicts battle damage to an opponent's faction, that faction's owner discards a card.
// =============================================================================

const NA = "0a7c01eb-92bd-4172-9c0d-24886de70287";

function naBoard(o: { obsession?: number; hand?: number; na?: CardDefinition; active?: PlayerId } = {}): Board {
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: dev() },
    playerB: { faction: dev() },
    turn: 2,
    activePlayerId: active,
    cards: [
      { key: "na", def: o.na ?? printing(NA), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 4 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blocker", strength: 1, life: 5 }), owner: P2, zone: "play" },
      { key: "oatk", def: character({ name: "OppAttacker", strength: 1, life: 5 }), owner: P2, zone: "play" },
      ...fillers("oh", o.hand ?? 3, P2, "hand"),
      ...fillers("mh", 2, P1, "hand"),
      ...bank("obsession", o.obsession ?? 0, P1)
    ]
  });
}
const naAttack = (b: Board, attackers: string[] = ["na"]): void => declareAttackBy(b.engine, P1, attackers.map((k) => b.id(k)));

clause(NA, "0:rule", "attacking: the opponent discards a card of THEIR choice from their hand (one card; your hand is untouched)", () => {
  const b = naBoard();
  naAttack(b);
  const pc = pending(b.engine)!;
  assert.deepEqual([pc.kind, pc.playerId], ["chooserSelectsTarget", P2], "the opponent chooses what to discard");
  pickCards(b.engine, [b.id("oh1")]);
  assert.equal(pending(b.engine), undefined);
  assert.deepEqual(discardOf(b.engine, P2), [b.id("oh1")]);
  assert.deepEqual(handOf(b.engine, P2), [b.id("oh0"), b.id("oh2")], "exactly one card discarded");
  assert.equal(handOf(b.engine, P1).length, 2, "the attacker's controller discards nothing");
});

clause(NA, "0:rule", "the discard can only be a card from the opponent's hand, and it is mandatory", () => {
  const b = naBoard();
  naAttack(b);
  refused(() => pickCards(b.engine, [b.id("mh0")]), "the attacker's controller's hand card");
  refused(() => pickCards(b.engine, [b.id("blk")]), "a card in play");
  refused(() => pickCards(b.engine, []), "they must discard");
  refused(() => pickCards(b.engine, [b.id("oh0"), b.id("oh1")]), "one card, not two");
  assert.equal(handOf(b.engine, P2).length, 3, "nothing discarded by the refusals");
  pickCards(b.engine, [b.id("oh0")]);
  assert.equal(handOf(b.engine, P2).length, 2);
});

clause(NA, "0:rule", "it happens on the attack declaration, before blockers, and regardless of how the battle goes (no [O]x6 needed)", () => {
  const b = naBoard();
  naAttack(b);
  assert.equal(battleOf(b.engine) !== undefined, true);
  pickCards(b.engine, [b.id("oh0")]);
  declareBlockers(b.engine, P2, [b.id("blk")]);
  finishBattle(b.engine);
  assert.deepEqual(discardOf(b.engine, P2), [b.id("oh0")], "exactly the one declared-attack discard");
  assert.equal(handOf(b.engine, P2).length, 2);
});

clause(NA, "0:rule", "it only triggers when THIS card attacks: another character attacking alone makes the opponent discard nothing", () => {
  const b = naBoard({ obsession: 6 });
  naAttack(b, ["ally"]);
  assert.equal(pending(b.engine), undefined, "no discard prompt");
  assert.equal(handOf(b.engine, P2).length, 3);
  declareBlockers(b.engine, P2, []);
  finishBattle(b.engine);
  assert.equal(handOf(b.engine, P2).length, 3, "even with [O]x6, the Agent did not attack or deal damage");
  assert.equal(discardOf(b.engine, P2).length, 0);
});

clause(NA, "0:rule", "in a party it still triggers once (not once per attacker)", () => {
  const b = naBoard();
  naAttack(b, ["na", "ally"]);
  assert.equal(pending(b.engine)?.playerId, P2);
  pickCards(b.engine, [b.id("oh2")]);
  assert.equal(pending(b.engine), undefined, "no second prompt");
  assert.equal(handOf(b.engine, P2).length, 2);
});

clause(NA, "0:rule", "blocking is not attacking: the Agent blocking an opponent's attacker makes nobody discard", () => {
  const b = naBoard({ active: P2, obsession: 6 });
  declareAttackBy(b.engine, P2, [b.id("oatk")], { type: "faction", playerId: P1 });
  assert.equal(pending(b.engine), undefined);
  declareBlockers(b.engine, P1, [b.id("na")]);
  finishBattle(b.engine);
  assert.equal(handOf(b.engine, P2).length, 3);
  assert.equal(handOf(b.engine, P1).length, 2);
});

clause(NA, "0:rule", "the opponent has no cards in hand: the attack goes ahead without a stall", () => {
  const b = naBoard({ hand: 0 });
  const inf = influenceOf(b.engine, P2);
  naAttack(b);
  assert.equal(pending(b.engine), undefined);
  declareBlockers(b.engine, P2, []);
  finishBattle(b.engine);
  assert.equal(influenceOf(b.engine, P2), inf - 3, "the 3 battle damage landed");
});

clause(NA, "1:rule@oooooo", "with [O]x6, unblocked damage to the opponent's faction makes the faction's owner discard a card of their choice (in addition to the attack discard)", () => {
  const b = naBoard({ obsession: 6 });
  naAttack(b);
  pickCards(b.engine, [b.id("oh0")]);
  declareBlockers(b.engine, P2, []);
  const inf = influenceOf(b.engine, P2);
  finishBattle(b.engine, undefined, picksInOrder(b.id("oh1")));
  assert.equal(influenceOf(b.engine, P2), inf - 3, "3 battle damage to the faction");
  assert.deepEqual(discardOf(b.engine, P2), [b.id("oh0"), b.id("oh1")], "one at the declaration, one for the damage");
  assert.deepEqual(handOf(b.engine, P2), [b.id("oh2")]);
  assert.equal(handOf(b.engine, P1).length, 2);
});

clause(NA, "1:rule@oooooo", "the damage discard is the opponent's own choice, from their hand", () => {
  const b = naBoard({ obsession: 6, hand: 4 });
  naAttack(b);
  pickCards(b.engine, [b.id("oh0")]);
  declareBlockers(b.engine, P2, []);
  const seen: PendingChoiceLike[] = [];
  finishBattle(b.engine, undefined, (pc) => {
    seen.push({ ...pc });
    return pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [b.id("oh3")] } : declineAll(pc);
  });
  assert.equal(seen.length, 1);
  assert.deepEqual([seen[0]!.kind, seen[0]!.playerId], ["chooserSelectsTarget", P2]);
  assert.ok(discardOf(b.engine, P2).includes(b.id("oh3")), "discardOf(b.engine, P2).includes(b.id(\"oh3\"))");
});

clause(NA, "1:rule@oooooo", "near miss: with only [O]x5 the damage causes no discard (just the attack one)", () => {
  const b = naBoard({ obsession: 5 });
  naAttack(b);
  pickCards(b.engine, [b.id("oh0")]);
  declareBlockers(b.engine, P2, []);
  finishBattle(b.engine);
  assert.equal(discardOf(b.engine, P2).length, 1);
  assert.equal(handOf(b.engine, P2).length, 2);
});

clause(NA, "1:rule@oooooo", "blocked: no battle damage reaches the faction, so only the attack discard happens", () => {
  const b = naBoard({ obsession: 6 });
  naAttack(b);
  pickCards(b.engine, [b.id("oh0")]);
  declareBlockers(b.engine, P2, [b.id("blk")]);
  const inf = influenceOf(b.engine, P2);
  finishBattle(b.engine);
  assert.equal(influenceOf(b.engine, P2), inf, "the faction took nothing");
  assert.equal(discardOf(b.engine, P2).length, 1, "only the declared-attack discard");
  assert.equal(handOf(b.engine, P2).length, 2);
});

clause(NA, "1:rule@oooooo", "only the Agent's own damage counts: an ally hitting the faction while the Agent stays home makes nobody discard", () => {
  const b = naBoard({ obsession: 6 });
  naAttack(b, ["ally"]);
  declareBlockers(b.engine, P2, []);
  const inf = influenceOf(b.engine, P2);
  finishBattle(b.engine);
  assert.equal(influenceOf(b.engine, P2), inf - 1, "the ally's 1 damage landed");
  assert.equal(handOf(b.engine, P2).length, 3, "but nothing was discarded");
});

clause(NA, "1:rule@oooooo", "in a party where both are unblocked, the Agent's damage makes exactly one extra discard (the ally's damage adds none)", () => {
  const b = naBoard({ obsession: 6 });
  naAttack(b, ["na", "ally"]);
  pickCards(b.engine, [b.id("oh0")]);
  declareBlockers(b.engine, P2, []);
  finishBattle(b.engine, undefined, picksInOrder(b.id("oh1"), b.id("oh2")));
  assert.equal(discardOf(b.engine, P2).length, 2, "one for the attack, one for the Agent's damage");
  assert.equal(handOf(b.engine, P2).length, 1);
});

clause(NA, "1:rule@oooooo", "inflicting 0 battle damage inflicts nothing (CR 408.1), so a 0-strength Agent makes no damage discard", () => {
  const b = naBoard({ obsession: 6, na: { ...printing(NA), strength: 0 } });
  naAttack(b);
  pickCards(b.engine, [b.id("oh0")]);
  declareBlockers(b.engine, P2, []);
  finishBattle(b.engine);
  assert.equal(discardOf(b.engine, P2).length, 1, "only the attack discard");
});

clause(NA, "1:rule@oooooo", "with an empty opposing hand at damage time the battle finishes without a stall", () => {
  const b = naBoard({ obsession: 6, hand: 1 });
  const inf = influenceOf(b.engine, P2);
  naAttack(b);
  pickCards(b.engine, [b.id("oh0")]);
  assert.equal(handOf(b.engine, P2).length, 0);
  declareBlockers(b.engine, P2, []);
  finishBattle(b.engine);
  assert.equal(pending(b.engine), undefined);
  assert.equal(influenceOf(b.engine, P2), inf - 3);
});


// =============================================================================
// T3c9 mutation pass: printed card fields (type / trade / subtype / stats / cost / threshold) and a few selectors and durations
// =============================================================================
function printedDeployChecks(id: string, cost: number, icon: "obsession", n: number): void {
  const mk = (cards: CardPlacement[]): Board =>
    buildGame({ playerA: { faction: dev() }, playerB: { faction: dev() }, cards: [{ key: "x", def: printing(id), owner: P1, zone: "hand" }, ...cards] });
  const exact = mk([...bank(icon, n, P1), ...bank("rage", cost - n, P1)]);
  play(exact.engine, P1, exact.id("x"));
  assert.equal(zoneOf(exact.engine, exact.id("x")), "play", "exactly the printed cost with exactly the threshold icons deploys it");
  assert.equal(readyResources(exact.engine, P1), 0, "exactly the printed cost is paid");
  const short = mk([...bank(icon, Math.min(n, cost - 1), P1), ...bank("rage", Math.max(0, cost - 1 - n), P1)]);
  refused(() => playRaw(short.engine, P1, short.id("x")), "one resource short of the printed cost");
  assert.equal(zoneOf(short.engine, short.id("x")), "hand", "still in hand when one resource short");
  const noIcon = mk([...bank(icon, n - 1, P1), ...bank("rage", cost - n + 1, P1)]);
  refused(() => playRaw(noIcon.engine, P1, noIcon.id("x")), "enough resources but one icon short of the threshold");
  assert.equal(zoneOf(noIcon.engine, noIcon.id("x")), "hand", "still in hand when one icon short");
}
const statsOf = (b: Board, key: string, stats: string[]): number[] => stats.map((s) => b.engine.getStat(b.id(key), s as "strength"));
const printedStats = (id: string, stats: string[]): number[] => {
  const b = buildGame({ playerA: { faction: dev() }, playerB: { faction: dev() }, cards: [{ key: "x", def: printing(id), owner: P1, zone: "play" }] });
  return statsOf(b, "x", stats);
};

clause(FT, "0:ability", "(T3c9) printed: an arcanist tactic; may play a resource: the opponent picks at most one card from their hand", () => {
  const p = printing(FT);
  assert.deepEqual([p.type, p.trade, p.cost, p.threshold], ["tactic", "arcanist", 0, "oo"]);
  const b = ftBoard();
  ftPlay(b, "down1");
  chooseOption(b.engine, P1, /destroy/i);
  chooseOption(b.engine, P2, /decline/i);
  refused(() => pickCards(b.engine, [b.id("h0"), b.id("h1")]), "only one card may be played as a resource");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting for a legal answer");
  pickCards(b.engine, [b.id("h0")]);
  assert.equal(zoneOf(b.engine, b.id("h0")), "play");
  assert.equal(zoneOf(b.engine, b.id("h1")), "hand", "the second card stays in hand");
});

clause(GGB, "0:rule", "(T3c9) printed: an arcanist location with structure 5, cost 6 and threshold [O][O][O][O]", () => {
  const p = printing(GGB);
  assert.deepEqual([p.type, p.trade, p.cost, p.threshold], ["location", "arcanist", 6, "oooo"]);
  assert.deepEqual(printedStats(GGB, ["structure"]), [5]);
  printedDeployChecks(GGB, 6, "obsession", 4);
});

clause(GGB, "2:rule@oooooooo", "(T3c9) only items and locations gain TACTICAL at [O]x8: a resource card in hand does not", () => {
  const b = buildGame({
    playerA: { faction: dev() },
    playerB: { faction: dev() },
    cards: [
      { key: "ggb", def: printing(GGB), owner: P1, zone: "play" },
      { key: "hr", def: resourceCard({ name: "HandResource" }), owner: P1, zone: "hand" },
      { key: "hi", def: item({ name: "HandItem", cost: 1 }), owner: P1, zone: "hand" },
      ...bank("obsession", 8, P1)
    ]
  });
  assert.ok(tacticalIn(b, "hi"), "control: an item in hand gains TACTICAL with [O]x8");
  assert.ok(!tacticalIn(b, "hr"), "a resource card in hand is neither an item nor a location");
});

clause(LP, "0:rule", "(T3c9) printed: an arcanist lurker character 2 / 2 / 4 costing 3 with threshold [O][O]", () => {
  const p = printing(LP);
  assert.deepEqual([p.type, p.trade, p.subtype, p.cost, p.threshold], ["character", "arcanist", ["lurker"], 3, "oo"]);
  assert.deepEqual(printedStats(LP, ["strength", "speed", "life"]), [2, 2, 4]);
  printedDeployChecks(LP, 3, "obsession", 2);
});

clause(LP, "0:rule", "(T3c9) 'this turn': the COVERT lasts the whole turn, not just one battle", () => {
  const b = lpBoard();
  play(b.engine, P1, b.id("r"), { selected: { t: [b.id("lp")] } });
  assert.ok(hasCovert(b, "lp"), "gained");
  declareAttackBy(b.engine, P1, [b.id("lp")]);
  declareBlockers(b.engine, P2, []);
  finishBattle(b.engine);
  assert.equal(b.engine.state.battle, undefined, "the battle is over");
  assert.ok(hasCovert(b, "lp"), "still COVERT after the battle, this turn");
});

clause(MS, "0:rule", "(T3c9) printed: an arcanist lurker character 0 / 3 / 0 costing 3 with threshold [O][O]", () => {
  const p = printing(MS);
  assert.deepEqual([p.type, p.trade, p.subtype, p.cost, p.threshold], ["character", "arcanist", ["lurker"], 3, "oo"]);
  assert.deepEqual(printedStats(MS, ["speed"]), [3]);
});

clause(MIT, "0:attach", "(T3c9) printed: an arcanist gear item costing 3 with threshold [O]", () => {
  const p = printing(MIT);
  assert.deepEqual([p.type, p.trade, p.subtype, p.cost, p.threshold], ["item", "arcanist", ["gear"], 3, "o"]);
});

clause(ML, "0:rule", "(T3c9) printed: an arcanist monstrosity character 4 / 3 / 4 costing 2 with threshold [O][O]", () => {
  const p = printing(ML);
  assert.deepEqual([p.type, p.trade, p.subtype, p.cost, p.threshold], ["character", "arcanist", ["monstrosity"], 2, "oo"]);
  assert.deepEqual(printedStats(ML, ["strength", "speed", "life"]), [4, 3, 4]);
  printedDeployChecks(ML, 2, "obsession", 2);
});

clause(NA, "0:rule", "(T3c9) printed: an arcanist muddler character 3 / 3 / 3 costing 5 with threshold [O][O]", () => {
  const p = printing(NA);
  assert.deepEqual([p.type, p.trade, p.subtype, p.cost, p.threshold], ["character", "arcanist", ["muddler"], 5, "oo"]);
  assert.deepEqual(printedStats(NA, ["strength", "speed", "life"]), [3, 3, 3]);
  printedDeployChecks(NA, 5, "obsession", 2);
});
