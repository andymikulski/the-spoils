// Clause tests, batch shade-of-the-devoured-emperor-03 part p2 (groups 8-15, clauses not yet covered).
// Expected behavior comes from the PRINTED text (see docs/TESTING.md).
import assert from "node:assert/strict";
import { buildGame, activate, bank, character, developFaction, item, killTactic, location, play, resolvePendingResponses, resourceCard, tactic, volition, P1, P2 } from "../per-card/_harness.js";
import { clause, declineAll, printing, refused, holdResourceFace } from "./_clause.js";
import { answerPending, declareBlockers, fillers, pending, zoneOf } from "./_board.js";
import { declareAttackBy, finishBattle, playRaw } from "./_battle.js";
import { developDraw, developResource, endTurn, spentResources } from "./_turn.js";
import type { CardPlacement } from "../support/fixtures.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";

const readyOf = (engine: SpoilsEngine, player: PlayerId): number => engine.getAvailableResourceCount(player);
const handOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].hand];
const deckOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].deck];
const discardOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].discard];
const influenceOf = (engine: SpoilsEngine, player: PlayerId): number => engine.state.players[player].influence;
const factionIdOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId => engine.state.players[player].factionId!;
const attachedOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].attachedTo;
const responseWindowOf = (engine: SpoilsEngine) => engine.state.responseWindow;

/** Answers pending choices with `answerFor`, WITHOUT closing response windows (unlike `drain`). */
function answerChoices(engine: SpoilsEngine, answerFor: (pc: NonNullable<ReturnType<typeof pending>>) => unknown): void {
  let guard = 0;
  while (engine.state.pendingChoice && guard++ < 10) {
    const pc = pending(engine)!;
    engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: answerFor(pc) } as never);
  }
}

/** A synthetic tactic that restores one chosen character in play (declaration `t`). */
const restoreTactic = (name = "Restorer"): CardDefinition =>
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

/** A free tactic whose only effect is "draw a card". */
const drawTactic = (name: string): CardDefinition =>
  tactic({ name, cost: 0, behavior: { abilities: [{ id: "d", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });

// =====================================================================================
// Siluriformes Flaxenscale
// =====================================================================================
const SILURIFORMES = "6b29fb62-bd69-49ef-9f20-dc8712205d4f"; // cost 7 · gggg · str 4 / spd 3 / life 5 -- UNIQUE SILURIFORMES -- All UNIQUE EUSTACE gain 3 strength and 3 life. -- NUMISMATIC EMISSION (Pay 5: draw 2, gain 2 influence) -- AURIFEROUS AUGMENTAION (Discard 2 cards: this turn this character gains 2 strength and 2 life)
const PADAMOSE = "3f574bdd-e7b7-4757-a955-2a33d19a250d"; // Eustace Padamose-Gristwalter: UNIQUE EUSTACE, printed 1 str / 3 spd / 3 life
const GLUTTON = "1b7bb2f0-4fcd-4a93-8ccf-7a0142aca7a0"; // Eustace, Sensible Glutton: UNIQUE EUSTACE, printed 1 str / 3 spd / 4 life

const eustace = (name: string, over: Partial<CardDefinition> = {}): CardDefinition =>
  character({ name, unique: "eustace", strength: 1, life: 3, speed: 3, ...over });

function silBoard(cards: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "sil", def: printing(SILURIFORMES), owner: P1, zone: "play" }, ...cards]
  });
}

function twoSilBoard() {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "sil", def: printing(SILURIFORMES), owner: P1, zone: "play" },
      { key: "sil2", def: printing(SILURIFORMES), owner: P1, zone: "hand" },
      ...bank("greed", 8, P1)
    ]
  });
}

clause(SILURIFORMES, "0:unique", "UNIQUE SILURIFORMES: a second copy asks its controller which to keep (keep the new one: the old one is destroyed)", () => {
  const { engine, id } = twoSilBoard();
  play(engine, P1, id("sil2"));
  const pc = pending(engine)!;
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "its controller chooses");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [id("sil"), id("sil2")].sort());
  answerPending(engine, "uniqueSurvivor", { keep: id("sil2") });
  assert.equal(zoneOf(engine, id("sil2")), "play");
  assert.equal(zoneOf(engine, id("sil")), "discard", "the other copy is destroyed");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(SILURIFORMES, "0:unique", "UNIQUE SILURIFORMES: keeping the old copy destroys the new one", () => {
  const { engine, id } = twoSilBoard();
  play(engine, P1, id("sil2"));
  answerPending(engine, "uniqueSurvivor", { keep: id("sil") });
  assert.equal(zoneOf(engine, id("sil")), "play");
  assert.equal(zoneOf(engine, id("sil2")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(SILURIFORMES, "0:unique", "UNIQUE SILURIFORMES: the survivor choice may not name a card that is not one of the copies", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "sil", def: printing(SILURIFORMES), owner: P1, zone: "play" },
      { key: "sil2", def: printing(SILURIFORMES), owner: P1, zone: "hand" },
      { key: "bystander", def: character({ name: "Bystander" }), owner: P1, zone: "play" },
      ...bank("greed", 8, P1)
    ]
  });
  play(engine, P1, id("sil2"));
  refused(() => answerPending(engine, "uniqueSurvivor", { keep: id("bystander") }), "a bystander is not a candidate", /candidate|keep|unique|copies|one of/i);
  assert.equal(zoneOf(engine, id("bystander")), "play");
  assert.ok(engine.state.pendingChoice, "still waiting for a real answer");
});

clause(SILURIFORMES, "0:unique", "UNIQUE SILURIFORMES is per player: the opponent controlling their own copy gets no choice and nothing is destroyed", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sil", def: printing(SILURIFORMES), owner: P1, zone: "play" },
      { key: "sil2", def: printing(SILURIFORMES), owner: P2, zone: "hand" },
      ...bank("greed", 8, P2)
    ]
  });
  play(engine, P2, id("sil2"));
  assert.equal(engine.state.pendingChoice, undefined, "no survivor choice for different controllers");
  assert.equal(zoneOf(engine, id("sil")), "play");
  assert.equal(zoneOf(engine, id("sil2")), "play");
});

clause(SILURIFORMES, "0:unique", "UNIQUE SILURIFORMES: a character with another UNIQUE designation does not count as a second copy", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "sil", def: printing(SILURIFORMES), owner: P1, zone: "play" },
      { key: "eu", def: eustace("Eu"), owner: P1, zone: "play" },
      { key: "sil2", def: printing(SILURIFORMES), owner: P1, zone: "hand" },
      ...bank("greed", 8, P1)
    ]
  });
  play(engine, P1, id("sil2"));
  const pc = pending(engine)!;
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [id("sil"), id("sil2")].sort(), "only the two Siluriformes are candidates");
  assert.equal(zoneOf(engine, id("eu")), "play");
});

clause(SILURIFORMES, "1:rule", "All UNIQUE EUSTACE gain 3 strength and 3 life: every EUSTACE in play, whoever controls it (+3 strength, +3 life, speed untouched)", () => {
  const { engine, id } = silBoard([
    { key: "eu1", def: eustace("Eu One"), owner: P1, zone: "play" },
    { key: "eu2", def: eustace("Eu Two", { life: 4 }), owner: P2, zone: "play" }
  ]);
  assert.equal(engine.getStat(id("eu1"), "strength"), 4, "1 + 3");
  assert.equal(engine.getStat(id("eu1"), "life"), 6, "3 + 3");
  assert.equal(engine.getStat(id("eu1"), "speed"), 3, "speed is not boosted");
  assert.equal(engine.getStat(id("eu2"), "strength"), 4, "the opponent's EUSTACE too (All)");
  assert.equal(engine.getStat(id("eu2"), "life"), 7, "4 + 3");
});

clause(SILURIFORMES, "1:rule", "All UNIQUE EUSTACE gain 3 strength and 3 life: the real EUSTACE printings get 4/6 and 4/7", () => {
  const { engine, id } = silBoard([
    { key: "pad", def: printing(PADAMOSE), owner: P1, zone: "play" },
    { key: "glut", def: printing(GLUTTON), owner: P2, zone: "play" }
  ]);
  assert.deepEqual([engine.getStat(id("pad"), "strength"), engine.getStat(id("pad"), "speed"), engine.getStat(id("pad"), "life")], [4, 3, 6], "printed 1 / 3 / 3, plus 3 strength and 3 life");
  assert.deepEqual([engine.getStat(id("glut"), "strength"), engine.getStat(id("glut"), "speed"), engine.getStat(id("glut"), "life")], [4, 3, 7], "printed 1 / 3 / 4, plus 3 strength and 3 life");
});

clause(SILURIFORMES, "1:rule", "All UNIQUE EUSTACE gain 3 strength and 3 life: only UNIQUE EUSTACE — not a plain character named Eustace, another UNIQUE, Siluriformes itself, or an EUSTACE in hand", () => {
  const { engine, id } = silBoard([
    { key: "plain", def: character({ name: "Eustace", strength: 1, life: 3, speed: 3 }), owner: P1, zone: "play" },
    { key: "other", def: character({ name: "Other Unique", unique: "samuel", strength: 1, life: 3, speed: 3 }), owner: P1, zone: "play" },
    { key: "inhand", def: eustace("Eu In Hand"), owner: P1, zone: "hand" },
    { key: "eu", def: eustace("Eu"), owner: P1, zone: "play" }
  ]);
  assert.equal(engine.getStat(id("eu"), "strength"), 4, "positive control: the EUSTACE in play is boosted");
  assert.deepEqual([engine.getStat(id("plain"), "strength"), engine.getStat(id("plain"), "life")], [1, 3], "no EUSTACE designation");
  assert.deepEqual([engine.getStat(id("other"), "strength"), engine.getStat(id("other"), "life")], [1, 3], "another UNIQUE designation");
  assert.deepEqual([engine.getStat(id("sil"), "strength"), engine.getStat(id("sil"), "life")], [4, 5], "Siluriformes keeps its printed 4 / 5");
  assert.deepEqual([engine.getStat(id("inhand"), "strength"), engine.getStat(id("inhand"), "life")], [1, 3], "an EUSTACE in hand is not boosted");
});

clause(SILURIFORMES, "1:rule", "All UNIQUE EUSTACE gain 3 strength and 3 life: off before Siluriformes enters play, on while it is in play, off again once it leaves", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "sil", def: printing(SILURIFORMES), owner: P1, zone: "hand" },
      { key: "eu", def: eustace("Eu"), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      ...bank("greed", 8, P1)
    ]
  });
  assert.deepEqual([engine.getStat(id("eu"), "strength"), engine.getStat(id("eu"), "life")], [1, 3], "before");
  play(engine, P1, id("sil"));
  assert.equal(zoneOf(engine, id("sil")), "play");
  assert.deepEqual([engine.getStat(id("eu"), "strength"), engine.getStat(id("eu"), "life")], [4, 6], "while in play");
  play(engine, P1, id("kill"), { selected: { t: [id("sil")] } });
  assert.equal(zoneOf(engine, id("sil")), "discard", "Siluriformes was destroyed");
  assert.deepEqual([engine.getStat(id("eu"), "strength"), engine.getStat(id("eu"), "life")], [1, 3], "after it leaves play");
});

const numismaticBoard = (greed = 5) =>
  silBoard([...fillers("d", 5, P1, "deck"), ...fillers("od", 3, P2, "deck"), ...bank("greed", greed, P1)]);

clause(SILURIFORMES, "2:ability:siluriformes-numismatic-emission", "NUMISMATIC EMISSION: pay 5, draw 2 cards (the top two, in order), gain 2 influence", () => {
  const { engine, id } = numismaticBoard(6);
  const top2 = deckOf(engine, P1).slice(0, 2);
  const deckBefore = deckOf(engine, P1).length;
  const influenceBefore = influenceOf(engine, P1);
  const oppBefore = { hand: handOf(engine, P2), deck: deckOf(engine, P2), influence: influenceOf(engine, P2) };
  assert.equal(handOf(engine, P1).length, 0);
  activate(engine, P1, id("sil"), "siluriformes-numismatic-emission");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(engine, P1), top2, "drew the top two cards, in order");
  assert.equal(deckOf(engine, P1).length, deckBefore - 2);
  assert.equal(influenceOf(engine, P1), influenceBefore + 2, "gained 2 influence");
  assert.equal(readyOf(engine, P1), 1, "paid exactly 5 of the 6 resources");
  assert.deepEqual({ hand: handOf(engine, P2), deck: deckOf(engine, P2), influence: influenceOf(engine, P2) }, oppBefore, "the opponent is untouched");
});

clause(SILURIFORMES, "2:ability:siluriformes-numismatic-emission", "NUMISMATIC EMISSION: the 5 is paid on use, before the draw and influence happen", () => {
  const { engine, id } = numismaticBoard(5);
  const influenceBefore = influenceOf(engine, P1);
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("sil"), abilityId: "siluriformes-numismatic-emission", selected: {}, variables: {} } as never);
  assert.equal(readyOf(engine, P1), 0, "5 resources already spent while the ability waits for responses");
  assert.ok(responseWindowOf(engine), "the ability is waiting for the opponent's responses");
  assert.equal(handOf(engine, P1).length, 0, "nothing drawn yet");
  assert.equal(influenceOf(engine, P1), influenceBefore, "no influence yet");
  resolvePendingResponses(engine);
  assert.equal(handOf(engine, P1).length, 2);
  assert.equal(influenceOf(engine, P1), influenceBefore + 2);
});

clause(SILURIFORMES, "2:ability:siluriformes-numismatic-emission", "NUMISMATIC EMISSION can't be used with only 4 resources (and nothing is drawn or gained)", () => {
  const { engine, id } = numismaticBoard(4);
  const influenceBefore = influenceOf(engine, P1);
  refused(() => activate(engine, P1, id("sil"), "siluriformes-numismatic-emission"), "pay 5 with 4 resources", /cannot be paid/i);
  assert.equal(handOf(engine, P1).length, 0);
  assert.equal(influenceOf(engine, P1), influenceBefore);
  assert.equal(readyOf(engine, P1), 4, "nothing was spent");
  const control = numismaticBoard(5);
  activate(control.engine, P1, control.id("sil"), "siluriformes-numismatic-emission");
  assert.equal(handOf(control.engine, P1).length, 2, "positive control: 5 resources work");
});

clause(SILURIFORMES, "2:ability:siluriformes-numismatic-emission", "NUMISMATIC EMISSION can be used again the same turn (no limit printed): 10 resources pay for it twice", () => {
  const { engine, id } = numismaticBoard(10);
  const influenceBefore = influenceOf(engine, P1);
  activate(engine, P1, id("sil"), "siluriformes-numismatic-emission");
  activate(engine, P1, id("sil"), "siluriformes-numismatic-emission");
  assert.equal(handOf(engine, P1).length, 4);
  assert.equal(influenceOf(engine, P1), influenceBefore + 4);
  assert.equal(readyOf(engine, P1), 0);
});

const augBoard = () =>
  silBoard([
    ...fillers("h", 3, P1, "hand"),
    ...fillers("oh", 2, P2, "hand"),
    { key: "ally", def: character({ name: "Ally", strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" }
  ]);

clause(SILURIFORMES, "3:ability:siluriformes-auriferous-augmentation", "AURIFEROUS AUGMENTAION: discard 2 chosen cards; this turn Siluriformes gains 2 strength and 2 life (6 / 7), and only Siluriformes", () => {
  const { engine, id } = augBoard();
  assert.deepEqual([engine.getStat(id("sil"), "strength"), engine.getStat(id("sil"), "speed"), engine.getStat(id("sil"), "life")], [4, 3, 5], "printed stats before");
  activate(engine, P1, id("sil"), "siluriformes-auriferous-augmentation", { selected: { aug: [id("h0"), id("h2")] } });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("h0")), "discard");
  assert.equal(zoneOf(engine, id("h2")), "discard");
  assert.equal(zoneOf(engine, id("h1")), "hand", "the card that was not chosen stays");
  assert.deepEqual(handOf(engine, P2).length, 2, "the opponent's hand is untouched");
  assert.deepEqual([engine.getStat(id("sil"), "strength"), engine.getStat(id("sil"), "speed"), engine.getStat(id("sil"), "life")], [6, 3, 7], "+2 strength, +2 life, speed untouched");
  assert.deepEqual([engine.getStat(id("ally"), "strength"), engine.getStat(id("ally"), "life")], [2, 2], "another character is not boosted");
});

clause(SILURIFORMES, "3:ability:siluriformes-auriferous-augmentation", "AURIFEROUS AUGMENTAION: the boost lasts this turn and is gone when the turn ends", () => {
  const { engine, id } = augBoard();
  activate(engine, P1, id("sil"), "siluriformes-auriferous-augmentation", { selected: { aug: [id("h0"), id("h1")] } });
  assert.equal(engine.getStat(id("sil"), "strength"), 6);
  assert.equal(engine.getStat(id("sil"), "life"), 7);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2, "the next turn began");
  assert.deepEqual([engine.getStat(id("sil"), "strength"), engine.getStat(id("sil"), "life")], [4, 5], "back to the printed 4 / 5");
});

clause(SILURIFORMES, "3:ability:siluriformes-auriferous-augmentation", "AURIFEROUS AUGMENTAION can be used again: two uses stack to +4 / +4", () => {
  const { engine, id } = silBoard([...fillers("h", 4, P1, "hand")]);
  activate(engine, P1, id("sil"), "siluriformes-auriferous-augmentation", { selected: { aug: [id("h0"), id("h1")] } });
  activate(engine, P1, id("sil"), "siluriformes-auriferous-augmentation", { selected: { aug: [id("h2"), id("h3")] } });
  assert.deepEqual([engine.getStat(id("sil"), "strength"), engine.getStat(id("sil"), "life")], [8, 9]);
  assert.equal(handOf(engine, P1).length, 0);
  assert.equal(discardOf(engine, P1).length, 4);
});

clause(SILURIFORMES, "3:ability:siluriformes-auriferous-augmentation", "AURIFEROUS AUGMENTAION can't be used with fewer than 2 cards in hand", () => {
  const one = silBoard([...fillers("h", 1, P1, "hand")]);
  refused(() => activate(one.engine, P1, one.id("sil"), "siluriformes-auriferous-augmentation", { selected: { aug: [one.id("h0")] } }), "only one card to discard");
  assert.equal(zoneOf(one.engine, one.id("h0")), "hand");
  assert.deepEqual([one.engine.getStat(one.id("sil"), "strength"), one.engine.getStat(one.id("sil"), "life")], [4, 5]);
  const control = silBoard([...fillers("h", 2, P1, "hand")]);
  activate(control.engine, P1, control.id("sil"), "siluriformes-auriferous-augmentation", { selected: { aug: [control.id("h0"), control.id("h1")] } });
  assert.equal(control.engine.getStat(control.id("sil"), "strength"), 6, "positive control: 2 cards work");
});

clause(SILURIFORMES, "3:ability:siluriformes-auriferous-augmentation", "AURIFEROUS AUGMENTAION: the discard must be exactly 2 distinct cards from your own hand", () => {
  const bad: Array<[string, (id: (key: string) => CardInstanceId) => CardInstanceId[]]> = [
    ["only one of three", (id) => [id("h0")]],
    ["three cards", (id) => [id("h0"), id("h1"), id("h2")]],
    ["the same card twice", (id) => [id("h0"), id("h0")]],
    ["a card from the opponent's hand", (id) => [id("h0"), id("oh0")]],
    ["a card in play", (id) => [id("h0"), id("ally")]]
  ];
  for (const [label, pick] of bad) {
    const { engine, id } = augBoard();
    refused(() => activate(engine, P1, id("sil"), "siluriformes-auriferous-augmentation", { selected: { aug: pick(id) } }), label);
    assert.equal(handOf(engine, P1).length, 3, `${label}: nothing was discarded`);
    assert.equal(engine.getStat(id("sil"), "strength"), 4, `${label}: no boost`);
  }
  const { engine, id } = augBoard();
  activate(engine, P1, id("sil"), "siluriformes-auriferous-augmentation", { selected: { aug: [id("h0"), id("h1")] } });
  assert.equal(engine.getStat(id("sil"), "strength"), 6, "positive control");
});

// =====================================================================================
// Swindle
// =====================================================================================
const SWINDLE = "f84cac2d-0eb2-4fc8-af31-9a6754c889d6"; // tactic · cost 2 · gg -- COST: Your opponents cannot respond to this card. -- EFFECT: Each opponent must attach a resource to their faction. Draw a card. Discard a card.

function swindleBoard(opponentCards: CardPlacement[], extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "sw", def: printing(SWINDLE), owner: P1, zone: "hand" },
      { key: "spare", def: character({ name: "Spare" }), owner: P1, zone: "hand" },
      ...fillers("d", 4, P1, "deck"),
      ...fillers("od", 3, P2, "deck"),
      { key: "ohand", def: character({ name: "Opp Hand Card" }), owner: P2, zone: "hand" },
      ...bank("greed", 2, P1),
      ...opponentCards,
      ...extra
    ]
  });
}

clause(SWINDLE, "0:ability", "Each opponent must attach a resource to their faction (the opponent picks which); you then draw a card and discard a card you choose, the drawn card included", () => {
  const { engine, id } = swindleBoard(volition(2, P2));
  const [v0, v1] = engine.state.players[P2].play.filter((c) => engine.state.cards[c].faceDown);
  const top = deckOf(engine, P1)[0];
  const oppBefore = { hand: handOf(engine, P2), deck: deckOf(engine, P2) };
  play(engine, P1, id("sw"));
  const attachPick = pending(engine)!;
  assert.equal(attachPick.kind, "chooserSelectsTarget");
  assert.equal(attachPick.playerId, P2, "the opponent chooses which resource to attach");
  answerPending(engine, "chooserSelectsTarget", { selected: [v1] });
  assert.equal(attachedOf(engine, v1), factionIdOf(engine, P2), "the chosen resource is attached to the opponent's faction");
  assert.equal(attachedOf(engine, v0), undefined, "only one resource is attached");
  const discardPick = pending(engine)!;
  assert.equal(discardPick.kind, "chooserSelectsTarget");
  assert.equal(discardPick.playerId, P1, "the Swindler chooses what to discard");
  assert.equal(zoneOf(engine, top), "hand", "the card was already drawn when the discard is chosen");
  assert.deepEqual(handOf(engine, P1).sort(), [id("spare"), top].sort());
  answerPending(engine, "chooserSelectsTarget", { selected: [top] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, top), "discard", "the drawn card could be discarded");
  assert.deepEqual(handOf(engine, P1), [id("spare")], "net: one drawn, one discarded");
  assert.equal(zoneOf(engine, id("sw")), "discard", "Swindle itself ends in the discard pile");
  assert.deepEqual({ hand: handOf(engine, P2), deck: deckOf(engine, P2) }, oppBefore, "the opponent draws and discards nothing");
});

clause(SWINDLE, "0:ability", "Swindle: the discard can be a card other than the drawn one (the card from your hand)", () => {
  const { engine, id } = swindleBoard(volition(1, P2));
  const top = deckOf(engine, P1)[0];
  play(engine, P1, id("sw"));
  answerPending(engine, "chooserSelectsTarget", { selected: [engine.state.players[P2].play.find((c) => engine.state.cards[c].faceDown)!] });
  answerPending(engine, "chooserSelectsTarget", { selected: [id("spare")] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("spare")), "discard");
  assert.deepEqual(handOf(engine, P1), [top], "the drawn card stays in hand");
});

clause(SWINDLE, "0:ability", "Swindle: the attach is mandatory (\"must\") — the opponent can't decline it or attach two", () => {
  const { engine, id } = swindleBoard(volition(2, P2));
  const [v0, v1] = engine.state.players[P2].play.filter((c) => engine.state.cards[c].faceDown);
  play(engine, P1, id("sw"));
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [] }), "declining the attach", /select|choose|exactly|count|required|pick/i);
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [v0, v1] }), "attaching two resources", /select|choose|exactly|count|too many|pick/i);
  assert.ok(pending(engine), "still waiting for the opponent's attach");
  assert.equal(pending(engine)!.playerId, P2);
  assert.equal(attachedOf(engine, v0), undefined);
  assert.equal(attachedOf(engine, v1), undefined);
});

clause(SWINDLE, "0:ability", "Swindle: a face-up resource (an ordinary staple) is a resource too — the opponent must attach one of those", () => {
  const { engine, id } = swindleBoard(bank("rage", 2, P2));
  const ofP2 = engine.state.players[P2].play;
  assert.equal(ofP2.length >= 3, true, "faction plus two face-up resources");
  const faceUp = ofP2.filter((c) => engine.isResource(c));
  assert.equal(faceUp.length, 2);
  play(engine, P1, id("sw"));
  const pc = pending(engine);
  assert.ok(pc && pc.playerId === P2, "the opponent is asked to attach one of their face-up resources");
  answerPending(engine, "chooserSelectsTarget", { selected: [faceUp[0]] });
  assert.equal(attachedOf(engine, faceUp[0]), factionIdOf(engine, P2));
});

clause(SWINDLE, "0:ability", "Swindle: a resource already attached (spent) can't be attached again; the opponent picks among the unattached ones", () => {
  const spentFaceDown: CardPlacement = { ...volition(1, P2)[0], attachedToKey: "__factionB" };
  const { engine, id } = swindleBoard([...volition(1, P2), spentFaceDown, ...spentResources(P2, 1)]);
  const spentUp = engine.state.players[P2].play.find((c) => engine.isResource(c) && !engine.state.cards[c].faceDown)!;
  const faceDown = engine.state.players[P2].play.filter((c) => engine.state.cards[c].faceDown);
  const spentDown = faceDown.find((c) => attachedOf(engine, c) === factionIdOf(engine, P2))!;
  const free = faceDown.find((c) => attachedOf(engine, c) === undefined)!;
  assert.ok(spentUp && spentDown && free, "set-up: one free and two spent resources");
  assert.equal(attachedOf(engine, spentUp), factionIdOf(engine, P2), "set-up: the face-up resource is already spent");
  play(engine, P1, id("sw"));
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [spentDown] }), "an already-attached face-down resource", /select|target|valid|legal|choose|pick/i);
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [spentUp] }), "an already-attached face-up resource", /select|target|valid|legal|choose|pick/i);
  answerPending(engine, "chooserSelectsTarget", { selected: [free] });
  assert.equal(attachedOf(engine, free), factionIdOf(engine, P2));
});

clause(SWINDLE, "0:ability", "Swindle: an opponent with no resource to attach attaches nothing, and you still draw a card and discard a card", () => {
  const { engine, id } = swindleBoard([]);
  const top = deckOf(engine, P1)[0];
  play(engine, P1, id("sw"));
  const pc = pending(engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "the first prompt is the Swindler's discard (no attach prompt)");
  assert.equal(zoneOf(engine, top), "hand", "the draw happened");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("spare")] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("spare")), "discard");
  assert.deepEqual(handOf(engine, P1), [top]);
});

clause(SWINDLE, "0:ability", "Swindle can't be played without the gg threshold (two non-greed resources) or with only 1 resource", () => {
  const rage = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "sw", def: printing(SWINDLE), owner: P1, zone: "hand" }, ...fillers("d", 3, P1, "deck"), ...bank("rage", 2, P1), ...volition(1, P2)]
  });
  refused(() => play(rage.engine, P1, rage.id("sw")), "two rage resources do not give gg", /threshold/i);
  assert.equal(zoneOf(rage.engine, rage.id("sw")), "hand");
  const mixed = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "sw", def: printing(SWINDLE), owner: P1, zone: "hand" }, ...fillers("d", 3, P1, "deck"), ...bank("greed", 1, P1), ...bank("rage", 1, P1), ...volition(1, P2)]
  });
  refused(() => play(mixed.engine, P1, mixed.id("sw")), "one greed icon is not gg", /threshold/i);
  assert.equal(zoneOf(mixed.engine, mixed.id("sw")), "hand");
  const one = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "sw", def: printing(SWINDLE), owner: P1, zone: "hand" }, ...fillers("d", 3, P1, "deck"), ...bank("greed", 1, P1), ...bank("greed", 1, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })), ...volition(1, P2)]
  });
  refused(() => play(one.engine, P1, one.id("sw")), "cost 2 with one unspent resource (gg is met by a spent one)", /costs 2 resources/i);
  assert.equal(zoneOf(one.engine, one.id("sw")), "hand");
  const { engine, id } = swindleBoard(volition(1, P2));
  play(engine, P1, id("sw"));
  assert.ok(pending(engine), "positive control: two greed resources work");
  assert.equal(readyOf(engine, P1), 0, "paid the 2");
});

clause(SWINDLE, "0:ability", "COST: Your opponents cannot respond to this card — no response window opens for them, unlike an ordinary tactic", () => {
  const reply = drawTactic("Reply");
  const plain = drawTactic("Plain Tactic");
  // control: an ordinary tactic hands the opponent priority and they can respond
  const control = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "plain", def: plain, owner: P1, zone: "hand" },
      { key: "reply", def: reply, owner: P2, zone: "hand" },
      ...fillers("d", 3, P1, "deck"),
      ...fillers("od", 3, P2, "deck")
    ]
  });
  playRaw(control.engine, P1, control.id("plain"));
  assert.equal(responseWindowOf(control.engine)?.priorityPlayerId, P2, "control: the opponent holds priority");
  assert.equal(handOf(control.engine, P1).length, 0, "control: the plain tactic has not resolved yet");
  control.engine.perform({ type: "playCard", playerId: P2, cardId: control.id("reply"), selected: {}, variables: {} } as never);
  assert.notEqual(zoneOf(control.engine, control.id("reply")), "hand", "control: the opponent's response was accepted");

  const { engine, id } = swindleBoard(volition(1, P2), [{ key: "reply", def: reply, owner: P2, zone: "hand" }]);
  playRaw(engine, P1, id("sw"));
  assert.notEqual(responseWindowOf(engine)?.priorityPlayerId, P2, "no response window for the opponent");
  assert.ok(pending(engine), "Swindle already started to resolve (the attach prompt is open)");
  answerChoices(engine, (pc) => ({ kind: "chooserSelectsTarget", selected: pc.playerId === P2 ? [engine.state.players[P2].play.find((c) => engine.state.cards[c].faceDown)!] : [id("spare")] }));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.notEqual(responseWindowOf(engine)?.priorityPlayerId, P2, "still no window for the opponent after it resolved");
  refused(() => engine.perform({ type: "playCard", playerId: P2, cardId: id("reply"), selected: {}, variables: {} } as never), "the opponent responding to Swindle", /active player/i);
  assert.equal(zoneOf(engine, id("reply")), "hand");
});

// =====================================================================================
// Thabbashite Financier
// =====================================================================================
const FINANCIER = "3444240c-6824-4a70-83bc-2fff722afaf6"; // character · cost 5 · g · 3/2/3 -- BLOOD GOLD: [V][V] -- COST: Pay 2. Lose 1 influence. -- EFFECT: You may play a card as a face-down resource.

function financierBoard(cards: CardPlacement[] = [], influence?: number) {
  return buildGame({
    playerA: { faction: developFaction(), ...(influence !== undefined ? { influence } : {}) },
    playerB: { faction: developFaction() },
    cards: [
      { key: "tf", def: printing(FINANCIER), owner: P1, zone: "play" },
      { key: "stash", def: character({ name: "Stash" }), owner: P1, zone: "hand" },
      { key: "ohand", def: character({ name: "Opp Hand Card" }), owner: P2, zone: "hand" },
      ...fillers("d", 3, P1, "deck"),
      ...cards
    ]
  });
}

clause(FINANCIER, "0:ability:tf-bloodgold", "BLOOD GOLD: pay 2 and lose 1 influence, then play a card from your hand as a face-down resource", () => {
  const { engine, id } = financierBoard(volition(2, P1));
  const influenceBefore = influenceOf(engine, P1);
  const oppInfluence = influenceOf(engine, P2);
  assert.equal(readyOf(engine, P1), 2);
  activate(engine, P1, id("tf"), "tf-bloodgold");
  const pick = pending(engine)!;
  assert.equal(pick.kind, "chooserSelectsTarget");
  assert.equal(pick.playerId, P1);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("stash")] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(influenceOf(engine, P1), influenceBefore - 1, "lost 1 influence");
  assert.equal(influenceOf(engine, P2), oppInfluence, "the opponent loses nothing");
  assert.equal(zoneOf(engine, id("stash")), "play", "the card entered play");
  assert.equal(engine.state.cards[id("stash")].faceDown, true, "face-down");
  assert.equal(engine.state.cards[id("stash")].controllerId, P1);
  assert.equal(engine.isResource(id("stash")), true, "it is a resource");
  assert.equal(readyOf(engine, P1), 1, "the 2 paid resources are spent; the new face-down resource is ready");
});

clause(FINANCIER, "0:ability:tf-bloodgold", "BLOOD GOLD: the costs are paid on use, before the resource is played", () => {
  const { engine, id } = financierBoard(volition(2, P1));
  const influenceBefore = influenceOf(engine, P1);
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("tf"), abilityId: "tf-bloodgold", selected: {}, variables: {} } as never);
  assert.equal(readyOf(engine, P1), 0, "2 resources spent already");
  assert.equal(influenceOf(engine, P1), influenceBefore - 1, "influence already lost");
  assert.equal(zoneOf(engine, id("stash")), "hand", "the card has not been played yet");
  assert.ok(responseWindowOf(engine), "the ability waits for responses");
  resolvePendingResponses(engine);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("stash")] });
  assert.equal(zoneOf(engine, id("stash")), "play");
});

clause(FINANCIER, "0:ability:tf-bloodgold", "BLOOD GOLD: \"you may\" — declining plays nothing, but the costs stay paid", () => {
  const { engine, id } = financierBoard(volition(2, P1));
  const influenceBefore = influenceOf(engine, P1);
  activate(engine, P1, id("tf"), "tf-bloodgold");
  answerPending(engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("stash")), "hand", "nothing was played");
  assert.equal(influenceOf(engine, P1), influenceBefore - 1);
  assert.equal(readyOf(engine, P1), 0);
  assert.equal(engine.state.players[P1].play.filter((c) => engine.state.cards[c].faceDown).length, 2, "still just the two original face-down resources");
});

for (const [label, def] of [
  ["a tactic", tactic({ name: "Stashed Tactic", cost: 0 })],
  ["a location", location({ name: "Stashed Location" })],
  ["an item", item({ name: "Stashed Item" })],
  ["a resource card (it must still go face-down)", resourceCard({ name: "Stashed Resource", trade: "universal", resource: { provides: ["rage"], staple: true } })]
] as const) {
  clause(FINANCIER, "0:ability:tf-bloodgold", `BLOOD GOLD: any card can be played this way — ${label}, face-down`, () => {
    const { engine, id } = financierBoard([...volition(2, P1), { key: "odd", def, owner: P1, zone: "hand" }]);
    activate(engine, P1, id("tf"), "tf-bloodgold");
    answerPending(engine, "chooserSelectsTarget", { selected: [id("odd")] });
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(engine, id("odd")), "play");
    assert.equal(engine.state.cards[id("odd")].faceDown, true, "face-down");
    assert.equal(engine.isResource(id("odd")), true);
    assert.equal(zoneOf(engine, id("stash")), "hand", "the other hand card is untouched");
  });
}

clause(FINANCIER, "0:ability:tf-bloodgold", "BLOOD GOLD: the card comes from your own hand, one card only — not the opponent's hand, a card in play or your discard pile", () => {
  const { engine, id } = financierBoard([...volition(2, P1), { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" }, { key: "junk", def: character({ name: "Junk" }), owner: P1, zone: "discard" }, { key: "stash2", def: character({ name: "Stash Two" }), owner: P1, zone: "hand" }]);
  activate(engine, P1, id("tf"), "tf-bloodgold");
  for (const [label, pick] of [["opponent's hand card", id("ohand")], ["own card in play", id("ally")], ["own discard pile", id("junk")]] as const) {
    refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [pick] }), label, /select|target|valid|legal|choose|pick/i);
  }
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("stash"), id("stash2")] }), "two cards", /select|target|valid|legal|choose|too many|count|pick/i);
  assert.ok(pending(engine), "still waiting for a legal pick");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("stash2")] });
  assert.equal(zoneOf(engine, id("stash2")), "play");
  assert.equal(zoneOf(engine, id("stash")), "hand");
  assert.equal(zoneOf(engine, id("ohand")), "hand");
});

clause(FINANCIER, "0:ability:tf-bloodgold", "BLOOD GOLD needs [V][V]: one face-down resource plus plenty of face-up ones is refused (and costs nothing)", () => {
  const { engine, id } = financierBoard([...volition(1, P1), ...bank("rage", 5, P1)]);
  const influenceBefore = influenceOf(engine, P1);
  refused(() => activate(engine, P1, id("tf"), "tf-bloodgold"), "only one Volition icon", /threshold/i);
  assert.equal(influenceOf(engine, P1), influenceBefore);
  assert.equal(readyOf(engine, P1), 6, "nothing spent");
  const control = financierBoard([...volition(2, P1), ...bank("rage", 5, P1)]);
  activate(control.engine, P1, control.id("tf"), "tf-bloodgold");
  assert.ok(pending(control.engine), "positive control: two face-down resources work");
});

clause(FINANCIER, "0:ability:tf-bloodgold", "BLOOD GOLD can't be used when the 2 can't be paid (only 1 resource is unspent)", () => {
  const spentFaceDown: CardPlacement = { ...volition(1, P1)[0], attachedToKey: "__factionA" };
  const { engine, id } = financierBoard([...volition(1, P1), spentFaceDown]);
  const influenceBefore = influenceOf(engine, P1);
  assert.equal(readyOf(engine, P1), 1, "set-up: one face-down resource is spent");
  refused(() => activate(engine, P1, id("tf"), "tf-bloodgold"), "pay 2 with one ready resource", /cannot be paid/i);
  assert.equal(influenceOf(engine, P1), influenceBefore, "no influence lost");
  assert.equal(zoneOf(engine, id("stash")), "hand");
});

// =====================================================================================
// Timid Mau
// =====================================================================================
const MAU = "18dc6ee3-84de-4bf8-888f-f8c09a2b12e3"; // character · cost 5 · gg · 4/3/5 -- If this card is blocked by an opposing party of 2 or more characters, it loses 1 speed this turn.

const blocker = (i: number): CardDefinition => character({ name: `Blocker ${i}`, strength: 1, life: 4, speed: 1 });

function mauBoard(blockers: number, extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "mau", def: printing(MAU), owner: P1, zone: "play" },
      ...Array.from({ length: blockers }, (_, i) => ({ key: `b${i}`, def: blocker(i), owner: P2, zone: "play" as const })),
      ...extra
    ]
  });
}

const speedOf = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.getStat(cardId, "speed");

for (const [count, expected] of [[2, 2], [3, 2]] as const) {
  clause(MAU, "0:rule", `Timid Mau blocked by a party of ${count} characters loses 1 speed (3 -> ${expected}), not 1 per blocker`, () => {
    const { engine, id } = mauBoard(count);
    declareAttackBy(engine, P1, [id("mau")]);
    assert.equal(speedOf(engine, id("mau")), 3, "printed speed 3 before it is blocked");
    declareBlockers(engine, P2, Array.from({ length: count }, (_, i) => id(`b${i}`)));
    resolvePendingResponses(engine);
    assert.equal(speedOf(engine, id("mau")), expected);
    assert.equal(engine.getStat(id("mau"), "strength"), 4, "only speed changes");
    assert.equal(engine.getStat(id("mau"), "life"), 5, "only speed changes");
  });
}

clause(MAU, "0:rule", "Timid Mau blocked by a single character keeps its speed 3 (near miss)", () => {
  const { engine, id } = mauBoard(2);
  declareAttackBy(engine, P1, [id("mau")]);
  declareBlockers(engine, P2, [id("b0")]);
  resolvePendingResponses(engine);
  assert.equal(speedOf(engine, id("mau")), 3);
});

clause(MAU, "0:rule", "Timid Mau that is not blocked keeps its speed 3 (near miss)", () => {
  const { engine, id } = mauBoard(2);
  declareAttackBy(engine, P1, [id("mau")]);
  declareBlockers(engine, P2, []);
  resolvePendingResponses(engine);
  assert.equal(speedOf(engine, id("mau")), 3);
});

clause(MAU, "0:rule", "Timid Mau's speed loss lasts this turn: it persists through the battle and is gone when the turn ends", () => {
  const { engine, id } = mauBoard(2);
  declareAttackBy(engine, P1, [id("mau")]);
  declareBlockers(engine, P2, [id("b0"), id("b1")]);
  finishBattle(engine);
  assert.equal(zoneOf(engine, id("mau")), "play", "Mau survived the battle");
  assert.equal(speedOf(engine, id("mau")), 2, "still slowed later in the turn");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(speedOf(engine, id("mau")), 3, "back to speed 3 once the turn is over");
});

clause(MAU, "0:rule", "Timid Mau attacking in a party: when the party is blocked by 2 characters, Mau loses 1 speed and its partner does not", () => {
  const { engine, id } = mauBoard(2, [{ key: "pal", def: character({ name: "Pal", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" }]);
  declareAttackBy(engine, P1, [id("mau"), id("pal")]);
  declareBlockers(engine, P2, [id("b0"), id("b1")]);
  resolvePendingResponses(engine);
  assert.equal(speedOf(engine, id("mau")), 2, "Mau was blocked by a party of 2");
  assert.equal(speedOf(engine, id("pal")), 2, "its partner is not slowed (printed 2)");
});

clause(MAU, "0:rule", "Timid Mau is not slowed when it is the BLOCKER (it isn't the one being blocked) or when it isn't in the battle", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "a1", def: character({ name: "A1", strength: 1, life: 4, speed: 1 }), owner: P1, zone: "play" },
      { key: "a2", def: character({ name: "A2", strength: 1, life: 4, speed: 1 }), owner: P1, zone: "play" },
      { key: "bmau", def: printing(MAU), owner: P2, zone: "play" },
      { key: "bench", def: printing(MAU), owner: P1, zone: "play" }
    ]
  });
  declareAttackBy(engine, P1, [id("a1"), id("a2")]);
  declareBlockers(engine, P2, [id("bmau")]);
  resolvePendingResponses(engine);
  assert.equal(speedOf(engine, id("bmau")), 3, "a blocking Mau keeps speed 3");
  assert.equal(speedOf(engine, id("bench")), 3, "a Mau that isn't attacking keeps speed 3");
});

clause(MAU, "0:rule", "Timid Mau is not slowed when ANOTHER attacker is blocked by 2 characters", () => {
  const { engine, id } = mauBoard(2, [{ key: "pal", def: character({ name: "Pal", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" }]);
  declareAttackBy(engine, P1, [id("pal")]);
  declareBlockers(engine, P2, [id("b0"), id("b1")]);
  resolvePendingResponses(engine);
  assert.equal(speedOf(engine, id("mau")), 3, "Mau stayed home");
});

// =====================================================================================
// Underhanded Hang-Out
// =====================================================================================
const HANGOUT = "2f4973ca-ec4c-4a2d-a9a6-6b2d67dadaab"; // location · cost 1 · g · structure 2 -- DIRTY DEALS -- COST: Pay 2. Pick a location you own and inflict 1 damage to it. -- EFFECT: Draw a card.
const DIRTY = "underhanded-hangout-dirty-deals";

function hangoutBoard(greed = 2, extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "uho", def: printing(HANGOUT), owner: P1, zone: "play" },
      ...fillers("d", 5, P1, "deck"),
      ...fillers("od", 3, P2, "deck"),
      ...bank("greed", greed, P1),
      ...extra
    ]
  });
}

const damageOf = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId].damage;

clause(HANGOUT, "0:ability:underhanded-hangout-dirty-deals", "DIRTY DEALS: pay 2, inflict 1 damage to a location you own (here Hang-Out itself), draw a card", () => {
  const { engine, id } = hangoutBoard(3);
  const top = deckOf(engine, P1)[0];
  const oppBefore = { hand: handOf(engine, P2), deck: deckOf(engine, P2) };
  activate(engine, P1, id("uho"), DIRTY, { selected: { loc: [id("uho")] } });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(damageOf(engine, id("uho")), 1, "1 damage inflicted");
  assert.equal(zoneOf(engine, id("uho")), "play", "structure 2 survives 1 damage");
  assert.deepEqual(handOf(engine, P1), [top], "drew the top card");
  assert.equal(readyOf(engine, P1), 1, "paid exactly 2 of 3");
  assert.deepEqual({ hand: handOf(engine, P2), deck: deckOf(engine, P2) }, oppBefore);
});

clause(HANGOUT, "0:ability:underhanded-hangout-dirty-deals", "DIRTY DEALS: any location you own can be picked — another location takes the damage, Hang-Out takes none", () => {
  const { engine, id } = hangoutBoard(2, [{ key: "loc2", def: location({ name: "Other Place", structure: 3 }), owner: P1, zone: "play" }]);
  activate(engine, P1, id("uho"), DIRTY, { selected: { loc: [id("loc2")] } });
  assert.equal(damageOf(engine, id("loc2")), 1);
  assert.equal(damageOf(engine, id("uho")), 0);
  assert.equal(handOf(engine, P1).length, 1);
  assert.equal(readyOf(engine, P1), 0);
});

clause(HANGOUT, "0:ability:underhanded-hangout-dirty-deals", "DIRTY DEALS: only a location you own — not the opponent's location, a character, or a location that isn't in play", () => {
  const extra: CardPlacement[] = [
    { key: "oloc", def: location({ name: "Opp Place", structure: 3 }), owner: P2, zone: "play" },
    { key: "ally", def: character({ name: "Ally", life: 5 }), owner: P1, zone: "play" },
    { key: "handloc", def: location({ name: "Hand Place", structure: 3 }), owner: P1, zone: "hand" },
    { key: "loc2", def: location({ name: "Other Place", structure: 3 }), owner: P1, zone: "play" }
  ];
  for (const [label, pick] of [["the opponent's location", "oloc"], ["a character", "ally"], ["a location in hand", "handloc"]] as const) {
    const { engine, id } = hangoutBoard(2, extra);
    const handBefore = handOf(engine, P1).length;
    refused(() => activate(engine, P1, id("uho"), DIRTY, { selected: { loc: [id(pick)] } }), label);
    assert.equal(handOf(engine, P1).length, handBefore, `${label}: nothing drawn`);
    assert.equal(readyOf(engine, P1), 2, `${label}: nothing paid`);
    assert.equal(damageOf(engine, id(pick)), 0, `${label}: no damage`);
  }
  const { engine, id } = hangoutBoard(2, extra);
  activate(engine, P1, id("uho"), DIRTY, { selected: { loc: [id("loc2")] } });
  assert.equal(damageOf(engine, id("loc2")), 1, "positive control: an own location in play works");
});

clause(HANGOUT, "0:ability:underhanded-hangout-dirty-deals", "DIRTY DEALS: the damage is a real location destroyer — a 1-structure location dies, and the card is still drawn", () => {
  const { engine, id } = hangoutBoard(2, [{ key: "frail", def: location({ name: "Frail Place", structure: 1 }), owner: P1, zone: "play" }]);
  const top = deckOf(engine, P1)[0];
  activate(engine, P1, id("uho"), DIRTY, { selected: { loc: [id("frail")] } });
  assert.equal(zoneOf(engine, id("frail")), "discard", "1 damage destroys a 1-structure location");
  assert.equal(zoneOf(engine, id("uho")), "play");
  assert.deepEqual(handOf(engine, P1), [top]);
});

clause(HANGOUT, "0:ability:underhanded-hangout-dirty-deals", "DIRTY DEALS: used twice on Hang-Out itself (structure 2) it destroys itself, and both draws happen", () => {
  const { engine, id } = hangoutBoard(4);
  const [t0, t1] = deckOf(engine, P1);
  activate(engine, P1, id("uho"), DIRTY, { selected: { loc: [id("uho")] } });
  assert.equal(zoneOf(engine, id("uho")), "play");
  activate(engine, P1, id("uho"), DIRTY, { selected: { loc: [id("uho")] } });
  assert.equal(zoneOf(engine, id("uho")), "discard", "2 damage on structure 2");
  assert.deepEqual(handOf(engine, P1), [t0, t1], "both draws resolved");
  assert.equal(readyOf(engine, P1), 0);
});

clause(HANGOUT, "0:ability:underhanded-hangout-dirty-deals", "DIRTY DEALS can be used repeatedly in a turn: two uses on a sturdy location add up", () => {
  const { engine, id } = hangoutBoard(4, [{ key: "big", def: location({ name: "Big Place", structure: 4 }), owner: P1, zone: "play" }]);
  activate(engine, P1, id("uho"), DIRTY, { selected: { loc: [id("big")] } });
  activate(engine, P1, id("uho"), DIRTY, { selected: { loc: [id("big")] } });
  assert.equal(damageOf(engine, id("big")), 2);
  assert.equal(handOf(engine, P1).length, 2);
  assert.equal(zoneOf(engine, id("big")), "play");
});

clause(HANGOUT, "0:ability:underhanded-hangout-dirty-deals", "DIRTY DEALS can't be used with only 1 resource (nothing drawn, no damage)", () => {
  const { engine, id } = hangoutBoard(1);
  refused(() => activate(engine, P1, id("uho"), DIRTY, { selected: { loc: [id("uho")] } }), "pay 2 with 1 resource", /cannot be paid/i);
  assert.equal(damageOf(engine, id("uho")), 0);
  assert.equal(handOf(engine, P1).length, 0);
  assert.equal(readyOf(engine, P1), 1);
});

clause(HANGOUT, "0:ability:underhanded-hangout-dirty-deals", "DIRTY DEALS: payment and damage are costs, taken on use before the card is drawn", () => {
  const { engine, id } = hangoutBoard(2);
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("uho"), abilityId: DIRTY, selected: { loc: [id("uho")] }, variables: {} } as never);
  assert.equal(readyOf(engine, P1), 0, "2 paid");
  assert.equal(damageOf(engine, id("uho")), 1, "damage already inflicted");
  assert.equal(handOf(engine, P1).length, 0, "not drawn yet");
  assert.ok(responseWindowOf(engine), "responseWindowOf(engine)");
  resolvePendingResponses(engine);
  assert.equal(handOf(engine, P1).length, 1);
});

// =====================================================================================
// Unexpected Codicil
// =====================================================================================
const CODICIL = "9407541a-9b2b-44cd-b1b4-e0979f192ebb"; // tactic · cost 0 · gggg -- COST: Choose a number for X. Discard X cards. Pay X - 2. -- EFFECT: Draw X cards. -- FINE PRINT: [G][G][G][G] -- COST: Reveal this card from your hand. Your faction loses 2 influence. Pay 2. -- EFFECT: Draw a card.

function codicilBoard(handCards: number, greed = 4, extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "uc", def: printing(CODICIL), owner: P1, zone: "hand" },
      ...fillers("h", handCards, P1, "hand"),
      ...fillers("d", 9, P1, "deck"),
      ...fillers("od", 3, P2, "deck"),
      { key: "ohand", def: character({ name: "Opp Hand Card" }), owner: P2, zone: "hand" },
      ...bank("greed", greed, P1),
      ...extra
    ]
  });
}

/** Plays the Codicil for `x`, discarding the first `x` of the hand fillers h0.., and checks the whole printed result. */
function codicilCase(x: number): void {
  const pay = Math.max(0, x - 2);
  const { engine, id } = codicilBoard(6);
  const chosen = Array.from({ length: x }, (_, i) => id(`h${i}`));
  const drawn = deckOf(engine, P1).slice(0, x);
  const oppBefore = { hand: handOf(engine, P2), deck: deckOf(engine, P2) };
  play(engine, P1, id("uc"), { variables: { x }, selected: { disc: chosen } });
  assert.equal(engine.state.pendingChoice, undefined);
  for (const c of chosen) assert.equal(zoneOf(engine, c), "discard", "the chosen cards were discarded");
  for (const c of drawn) assert.equal(zoneOf(engine, c), "hand", "the top cards were drawn");
  assert.deepEqual(handOf(engine, P1).slice().sort(), [...Array.from({ length: 6 - x }, (_, i) => id(`h${i + x}`)), ...drawn].sort(), "hand = unchosen cards + drawn cards");
  assert.equal(discardOf(engine, P1).length, x + 1, "the X discards plus the Codicil itself");
  assert.equal(readyOf(engine, P1), 4 - pay, `paid X - 2 = ${pay}`);
  assert.deepEqual({ hand: handOf(engine, P2), deck: deckOf(engine, P2) }, oppBefore, "the opponent is untouched");
}

clause(CODICIL, "0:ability", "Unexpected Codicil with X = 1: discard 1 card, pay 0 (X - 2 is below 0), draw 1 card", () => codicilCase(1));
clause(CODICIL, "0:ability", "Unexpected Codicil with X = 0: discard 0 cards, pay 0, draw 0 cards", () => codicilCase(0));
clause(CODICIL, "0:ability", "Unexpected Codicil with X = 2: discard 2 cards, pay 0, draw 2 cards", () => codicilCase(2));
clause(CODICIL, "0:ability", "Unexpected Codicil with X = 3: discard 3 cards, pay 1 (X - 2), draw 3 cards", () => codicilCase(3));
clause(CODICIL, "0:ability", "Unexpected Codicil with X = 4: discard 4 cards, pay 2 (X - 2), draw 4 cards", () => codicilCase(4));

clause(CODICIL, "0:ability", "Unexpected Codicil with X = 1: the number discarded must be exactly X (none, or two, is refused)", () => {
  for (const count of [0, 2]) {
    const { engine, id } = codicilBoard(6);
    refused(() => play(engine, P1, id("uc"), { variables: { x: 1 }, selected: { disc: Array.from({ length: count }, (_, i) => id(`h${i}`)) } }), `${count} discards for X = 1`);
    assert.equal(zoneOf(engine, id("uc")), "hand", `${count}: the Codicil was not played`);
    assert.equal(handOf(engine, P1).length, 7, `${count}: nothing discarded or drawn`);
    assert.equal(readyOf(engine, P1), 4, `${count}: nothing paid`);
  }
  const { engine, id } = codicilBoard(6);
  play(engine, P1, id("uc"), { variables: { x: 1 }, selected: { disc: [id("h0")] } });
  assert.equal(zoneOf(engine, id("h0")), "discard", "positive control: exactly one discard works");
});

clause(CODICIL, "0:ability", "Unexpected Codicil: X = 3 discards exactly 3 chosen cards (2 or 4 are refused, 3 is accepted)", () => {
  for (const count of [2, 4]) {
    const { engine, id } = codicilBoard(6);
    refused(() => play(engine, P1, id("uc"), { variables: { x: 3 }, selected: { disc: Array.from({ length: count }, (_, i) => id(`h${i}`)) } }), `${count} discards for X = 3`);
    assert.equal(zoneOf(engine, id("uc")), "hand", `${count}: the Codicil was not played`);
  }
  const { engine, id } = codicilBoard(6);
  play(engine, P1, id("uc"), { variables: { x: 3 }, selected: { disc: [id("h0"), id("h1"), id("h2")] } });
  assert.equal(zoneOf(engine, id("uc")), "discard", "positive control: 3 discards for X = 3 is a legal play");
});

clause(CODICIL, "0:ability", "Unexpected Codicil: you can only discard cards from your own hand (not the opponent's hand or a card in play)", () => {
  const extra: CardPlacement[] = [{ key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" }];
  for (const [label, pick] of [["the opponent's hand card", "ohand"], ["a card in play", "ally"]] as const) {
    const { engine, id } = codicilBoard(2, 4, extra);
    refused(() => play(engine, P1, id("uc"), { variables: { x: 1 }, selected: { disc: [id(pick)] } }), label);
    assert.equal(zoneOf(engine, id("uc")), "hand", `${label}: not played`);
    assert.equal(handOf(engine, P1).length, 3, `${label}: nothing changed`);
  }
  const { engine, id } = codicilBoard(2, 4, extra);
  play(engine, P1, id("uc"), { variables: { x: 1 }, selected: { disc: [id("h1")] } });
  assert.equal(zoneOf(engine, id("h1")), "discard", "positive control");
});

clause(CODICIL, "0:ability", "Unexpected Codicil: the card being played is in the being-deployed area, so it can't be one of the cards it discards (and with an empty hand X = 1 can't be paid)", () => {
  const alone = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "uc", def: printing(CODICIL), owner: P1, zone: "hand" }, ...fillers("d", 5, P1, "deck"), ...bank("greed", 4, P1)]
  });
  refused(() => play(alone.engine, P1, alone.id("uc"), { variables: { x: 1 }, selected: { disc: [alone.id("uc")] } }), "discarding itself with nothing else in hand");
  assert.equal(handOf(alone.engine, P1).length, 1, "no cards were drawn, and the refused Codicil never left the hand");
  const { engine, id } = codicilBoard(2);
  refused(() => play(engine, P1, id("uc"), { variables: { x: 1 }, selected: { disc: [id("uc")] } }), "discarding itself with other cards in hand");
  assert.equal(handOf(engine, P1).length, 3, "nothing was discarded or drawn");
});

clause(CODICIL, "0:ability", "Unexpected Codicil: with X = 1 and no other card in hand there is nothing to discard (refused)", () => {
  const { engine, id } = codicilBoard(0);
  refused(() => play(engine, P1, id("uc"), { variables: { x: 1 }, selected: { disc: [] } }), "nothing to discard");
  assert.equal(zoneOf(engine, id("uc")), "hand");
  assert.equal(handOf(engine, P1).length, 1);
  assert.equal(readyOf(engine, P1), 4);
});

clause(CODICIL, "0:ability", "Unexpected Codicil: Pay X - 2 must be affordable (X = 7 pays 5, refused with 4 resources; X = 6 pays all 4 and is allowed)", () => {
  const { engine, id } = codicilBoard(7);
  refused(() => play(engine, P1, id("uc"), { variables: { x: 7 }, selected: { disc: Array.from({ length: 7 }, (_, i) => id(`h${i}`)) } }), "pay 5 with 4 resources", /cannot be paid/i);
  assert.equal(zoneOf(engine, id("uc")), "hand");
  assert.equal(handOf(engine, P1).length, 8);
  assert.equal(readyOf(engine, P1), 4);
  const control = codicilBoard(7);
  play(control.engine, P1, control.id("uc"), { variables: { x: 6 }, selected: { disc: Array.from({ length: 6 }, (_, i) => control.id(`h${i}`)) } });
  assert.equal(readyOf(control.engine, P1), 0, "positive control: X = 6 pays all 4");
  assert.equal(handOf(control.engine, P1).length, 7, "7 other cards - 6 discarded + 6 drawn");
});

clause(CODICIL, "0:ability", "Unexpected Codicil needs gggg: three greed plus a rage resource is refused", () => {
  const { engine, id } = codicilBoard(2, 3, bank("rage", 1, P1));
  refused(() => play(engine, P1, id("uc"), { variables: { x: 1 }, selected: { disc: [id("h0")] } }), "three greed icons", /threshold/i);
  assert.equal(zoneOf(engine, id("uc")), "hand");
  assert.equal(handOf(engine, P1).length, 3);
  const control = codicilBoard(2, 4);
  play(control.engine, P1, control.id("uc"), { variables: { x: 1 }, selected: { disc: [control.id("h0")] } });
  assert.equal(zoneOf(control.engine, control.id("uc")), "discard", "positive control: gggg works");
});

clause(CODICIL, "0:ability", "Unexpected Codicil: X must be a whole number — negative and fractional values are refused", () => {
  for (const x of [-1, 1.5]) {
    const { engine, id } = codicilBoard(3);
    refused(() => play(engine, P1, id("uc"), { variables: { x }, selected: { disc: [id("h0")] } }), `X = ${x}`);
    assert.equal(zoneOf(engine, id("uc")), "hand", `X = ${x}: not played`);
    assert.equal(handOf(engine, P1).length, 4, `X = ${x}: nothing drawn or discarded`);
  }
});

clause(CODICIL, "0:ability", "Unexpected Codicil: costs (the discards and the payment) are taken when it is played, before the cards are drawn (X = 4: 4 discards, pay 2)", () => {
  const { engine, id } = codicilBoard(6);
  playRaw(engine, P1, id("uc"), { variables: { x: 4 }, selected: { disc: [id("h0"), id("h1"), id("h2"), id("h3")] } });
  assert.equal(readyOf(engine, P1), 2, "X - 2 = 2 already paid");
  assert.equal(discardOf(engine, P1).length, 4, "4 discards already made");
  assert.equal(handOf(engine, P1).length, 2, "nothing drawn yet");
  assert.ok(responseWindowOf(engine), "waiting for responses");
  resolvePendingResponses(engine);
  assert.equal(handOf(engine, P1).length, 6, "then the 4 cards are drawn");
});

// D5: the finePrint calls no longer pass selected.disc: the main ability now picks exactly X cards (X = 0 here), so the old "one discard" workaround is refused.
/** FINE PRINT is an ability used from the hand (E10e: it used to be driven through the reveal-from-hand develop option). */
function finePrint(engine: SpoilsEngine, id: (key: string) => CardInstanceId, extra: { selected?: Record<string, CardInstanceId[]>; variables?: Record<string, number> } = {}): void {
  activate(engine, P1, id("uc"), "uc-fine-print", extra);
}

clause(CODICIL, "1:ability", "FINE PRINT: your faction loses 2 influence", () => {
  const { engine, id } = codicilBoard(3);
  const influenceBefore = influenceOf(engine, P1);
  const oppInfluence = influenceOf(engine, P2);
  finePrint(engine, id);
  assert.equal(influenceOf(engine, P1), influenceBefore - 2, "your faction lost 2 influence");
  assert.equal(influenceOf(engine, P2), oppInfluence, "the opponent's faction lost nothing");
});

clause(CODICIL, "1:ability", "FINE PRINT: reveal the card (it stays in hand), pay 2, draw exactly one card — no discard and no X", () => {
  const { engine, id } = codicilBoard(3);
  const top = deckOf(engine, P1)[0];
  const handBefore = handOf(engine, P1).length;
  finePrint(engine, id);
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("uc")), "hand", "the revealed Codicil stays in your hand");
  assert.equal(zoneOf(engine, top), "hand", "drew the top card");
  assert.equal(handOf(engine, P1).length, handBefore + 1, "exactly one card drawn, nothing discarded");
  assert.equal(discardOf(engine, P1).length, 0, "no discard cost");
  assert.equal(readyOf(engine, P1), 2, "paid exactly 2 of 4");
});

clause(CODICIL, "1:ability", "FINE PRINT is an ability, not a resource play: using it doesn't use up your Develop Rule for the turn", () => {
  const { engine, id } = codicilBoard(3);
  finePrint(engine, id);
  resolvePendingResponses(engine);
  const top = deckOf(engine, P1)[0];
  developDraw(engine, P1);
  assert.equal(zoneOf(engine, top), "hand", "the Develop Rule's draw is still available after FINE PRINT");
});

clause(CODICIL, "1:ability", "FINE PRINT needs [G][G][G][G]: three greed plus a rage resource is refused", () => {
  const { engine, id } = codicilBoard(3, 3, bank("rage", 1, P1));
  refused(() => finePrint(engine, id), "three greed icons", /threshold/i);
  assert.equal(zoneOf(engine, id("uc")), "hand");
  assert.equal(influenceOf(engine, P1), 30);
  assert.equal(readyOf(engine, P1), 4, "nothing spent");
});

clause(CODICIL, "1:ability", "FINE PRINT reveals the card from your hand: a Codicil in the discard pile can't use it", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "uc", def: printing(CODICIL), owner: P1, zone: "discard" },
      ...fillers("d", 4, P1, "deck"),
      ...bank("greed", 4, P1)
    ]
  });
  refused(() => finePrint(engine, id), "the Codicil isn't in hand", /hand/i);
  assert.equal(influenceOf(engine, P1), 30);
});

clause(CODICIL, "1:ability", "FINE PRINT: the Pay 2 must be affordable (only 1 unspent resource is refused)", () => {
  const spent = bank("greed", 3, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }));
  const { engine, id } = codicilBoard(3, 1, spent);
  assert.equal(readyOf(engine, P1), 1, "set-up: 3 of 4 greed resources are spent");
  refused(() => finePrint(engine, id), "pay 2 with one ready resource", /cannot be paid/i);
  assert.equal(zoneOf(engine, id("uc")), "hand");
  assert.equal(influenceOf(engine, P1), 30, "no influence lost");
});

// =====================================================================================
// 5n4p
// =====================================================================================
const SNAP = "1082ff2c-afd3-4c84-89ae-1002579977df"; // character · cost 5 · ee · 2/2/5 -- If this card is restored, put a Micromajig token into play under your control.

const majigsOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] =>
  engine.state.players[player].play.filter((c) => engine.getDefinition(c).name === "Micromajig");

function snapBoard(snapDepleted = true) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "snap", def: printing(SNAP), owner: P1, zone: "play", depleted: snapDepleted },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play", depleted: true },
      { key: "r", def: restoreTactic(), owner: P1, zone: "hand" }
    ]
  });
}

clause(SNAP, "0:rule", "5n4p restored by an effect: a Micromajig token (1 strength / 3 speed / 1 life Gearsmith character, majig) enters play under your control", () => {
  const { engine, id } = snapBoard();
  assert.equal(majigsOf(engine, P1).length, 0);
  play(engine, P1, id("r"), { selected: { t: [id("snap")] } });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.cards[id("snap")].depleted, false, "5n4p was restored");
  const tokens = majigsOf(engine, P1);
  assert.equal(tokens.length, 1, "exactly one token");
  const token = tokens[0];
  assert.equal(engine.state.cards[token].isToken, true);
  assert.equal(engine.state.cards[token].controllerId, P1, "under your control");
  assert.equal(engine.state.cards[token].ownerId, P1, "owned by the player who controlled the effect (CR 409.3b)");
  assert.equal(engine.getDefinition(token).type, "character");
  assert.deepEqual(engine.getDefinition(token).subtype, ["majig"]);
  assert.deepEqual([engine.getStat(token, "strength"), engine.getStat(token, "speed"), engine.getStat(token, "life")], [1, 3, 1]);
  assert.equal(majigsOf(engine, P2).length, 0);
});

clause(SNAP, "0:rule", "5n4p: the Micromajig token is a Gearsmith character card (CR 409.3c)", () => {
  const { engine, id } = snapBoard();
  play(engine, P1, id("r"), { selected: { t: [id("snap")] } });
  const [token] = majigsOf(engine, P1);
  assert.ok(token, "a token was made");
  assert.equal(engine.getDefinition(token).trade, "gearsmith");
});

clause(SNAP, "0:rule", "5n4p: restoring a different character makes no token (near miss)", () => {
  const { engine, id } = snapBoard();
  play(engine, P1, id("r"), { selected: { t: [id("ally")] } });
  assert.equal(engine.state.cards[id("ally")].depleted, false, "the ally was restored");
  assert.equal(engine.state.cards[id("snap")].depleted, true, "5n4p was not");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(majigsOf(engine, P1).length, 0);
});

clause(SNAP, "0:rule", "5n4p: a 5n4p that is not depleted can't be restored, so no token appears (near miss)", () => {
  const { engine, id } = snapBoard(false);
  play(engine, P1, id("r"), { selected: { t: [id("snap")] } });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(majigsOf(engine, P1).length, 0);
});

clause(SNAP, "0:rule", "5n4p restored by the OPPONENT's effect: the token still comes to its controller, not to the opponent", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "snap", def: printing(SNAP), owner: P1, zone: "play", depleted: true },
      { key: "r", def: restoreTactic(), owner: P2, zone: "hand" }
    ]
  });
  play(engine, P2, id("r"), { selected: { t: [id("snap")] } });
  assert.equal(engine.state.cards[id("snap")].depleted, false);
  assert.equal(majigsOf(engine, P1).length, 1, "the token is under 5n4p's controller's control");
  assert.equal(majigsOf(engine, P2).length, 0, "the effect's caster gets nothing");
});

clause(SNAP, "0:rule", "5n4p restored by its controller's turn-start restore rule also makes a token", () => {
  const { engine, id } = snapBoard();
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(majigsOf(engine, P1).length, 0, "not restored yet on the opponent's turn");
  assert.equal(engine.state.cards[id("snap")].depleted, true);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  answerChoices(engine, declineAll);
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("snap")].depleted, false, "restored by the restore rule");
  assert.equal(majigsOf(engine, P1).length, 1, "restored -> a Micromajig");
});

// =====================================================================================
// Abandoned Testing Complex
// =====================================================================================
const COMPLEX = "90e8b87e-3c0f-4293-9b51-feb0919c8b18"; // location · cost 4 · eee · structure 6 -- At the start of your turn, you may pay 3. If you do you may play a resource.

const elitismSeed = (name = "Seed"): CardDefinition => resourceCard({ name, trade: "universal", resource: { provides: ["elitism"], staple: true } });

function complexBoard(elitism = 5, extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [
      { key: "atc", def: printing(COMPLEX), owner: P1, zone: "play" },
      { key: "res", def: elitismSeed("Seed One"), owner: P1, zone: "hand" },
      { key: "chr", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" },
      { key: "ores", def: elitismSeed("Opp Seed"), owner: P2, zone: "hand" },
      ...fillers("d", 3, P1, "deck"),
      ...bank("elitism", elitism, P1),
      ...extra
    ]
  });
}

clause(COMPLEX, "0:rule", "Abandoned Testing Complex: at the start of your turn, you may pay 3; if you do you may play a resource from your hand", () => {
  const { engine, id } = complexBoard(5);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1, "it is now your turn");
  const offer = pending(engine)!;
  assert.equal(offer.kind, "mayPay");
  assert.equal(offer.playerId, P1);
  assert.equal(zoneOf(engine, id("res")), "hand", "nothing is played before you pay");
  answerPending(engine, "mayPay", { pay: true });
  const pick = pending(engine)!;
  assert.equal(pick.kind, "chooserSelectsTarget");
  assert.equal(pick.playerId, P1);
  assert.equal(readyOf(engine, P1), 2, "paid 3 of 5 before the resource is played");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("res")] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("res")), "play", "the resource entered play");
  assert.equal(engine.isResource(id("res")), true);
  assert.equal(readyOf(engine, P1), 3, "2 unspent + the new (unspent) resource");
  assert.equal(zoneOf(engine, id("chr")), "hand", "other hand cards stay");
});

clause(COMPLEX, "0:rule", "Abandoned Testing Complex: the card played can be any card from your hand, played face-down as a resource", () => {
  const { engine, id } = complexBoard(5);
  endTurn(engine, P2);
  answerPending(engine, "mayPay", { pay: true });
  answerPending(engine, "chooserSelectsTarget", { selected: [id("chr")] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("chr")), "play");
  assert.equal(engine.state.cards[id("chr")].faceDown, true, "a non-resource card goes face-down");
  assert.equal(engine.isResource(id("chr")), true);
  assert.equal(readyOf(engine, P1), 3);
});

clause(COMPLEX, "0:rule", "Abandoned Testing Complex: 'play a resource' lets me choose face-up or face-down for an actual resource card (SYS-7)", () => holdResourceFace(() => {
  const { engine, id } = complexBoard(5);
  endTurn(engine, P2);
  answerPending(engine, "mayPay", { pay: true });
  answerPending(engine, "chooserSelectsTarget", { selected: [id("res")] });
  const asked = engine.state.pendingChoice !== undefined && engine.state.cards[id("res")].zone === "hand";
  const faceDown = engine.state.cards[id("res")].zone === "play" && engine.state.cards[id("res")].faceDown === true;
  assert.ok(asked || faceDown, "after picking an actual resource card the player must get to say face-up or face-down; the engine put it in play face-up without asking");
}));

clause(COMPLEX, "0:rule", "Abandoned Testing Complex: \"you may play\" — paying 3 and then declining to play a resource leaves the 3 spent and the hand untouched", () => {
  const { engine, id } = complexBoard(5);
  endTurn(engine, P2);
  answerPending(engine, "mayPay", { pay: true });
  answerPending(engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(readyOf(engine, P1), 2, "the 3 stay spent");
  assert.equal(zoneOf(engine, id("res")), "hand");
  assert.equal(zoneOf(engine, id("chr")), "hand");
});

clause(COMPLEX, "0:rule", "Abandoned Testing Complex: \"you may pay\" — declining the payment spends nothing and offers no resource play", () => {
  const { engine, id } = complexBoard(5);
  endTurn(engine, P2);
  answerPending(engine, "mayPay", { pay: false });
  assert.equal(engine.state.pendingChoice, undefined, "no resource pick is offered if you didn't pay");
  assert.equal(readyOf(engine, P1), 5, "nothing spent");
  assert.equal(zoneOf(engine, id("res")), "hand");
});

clause(COMPLEX, "0:rule", "Abandoned Testing Complex: the resource must come from your own hand — not the opponent's hand or a card already in play", () => {
  const { engine, id } = complexBoard(5, [{ key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" }]);
  endTurn(engine, P2);
  answerPending(engine, "mayPay", { pay: true });
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("ores")] }), "the opponent's hand card", /select|target|valid|legal|choose|pick/i);
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("ally")] }), "a card in play", /select|target|valid|legal|choose|pick/i);
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("res"), id("chr")] }), "two cards", /select|target|valid|legal|choose|too many|count|pick/i);
  assert.ok(pending(engine), "still waiting for a legal pick");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("res")] });
  assert.equal(zoneOf(engine, id("res")), "play");
  assert.equal(zoneOf(engine, id("ores")), "hand");
});

clause(COMPLEX, "0:rule", "Abandoned Testing Complex: only at the start of YOUR turn — nothing happens at the start of the opponent's turn", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "atc", def: printing(COMPLEX), owner: P1, zone: "play" },
      { key: "res", def: elitismSeed(), owner: P1, zone: "hand" },
      ...bank("elitism", 5, P1)
    ]
  });
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.pendingChoice, undefined, "no offer on the opponent's turn");
  assert.equal(readyOf(engine, P1), 5);
  assert.equal(zoneOf(engine, id("res")), "hand");
});

clause(COMPLEX, "0:rule", "Abandoned Testing Complex: the opponent's own Complex does nothing for you at the start of your turn (it is only its controller's)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "atc", def: printing(COMPLEX), owner: P2, zone: "play" },
      { key: "res", def: elitismSeed(), owner: P1, zone: "hand" },
      ...bank("elitism", 5, P1)
    ]
  });
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.pendingChoice, undefined, "the opponent's Complex doesn't trigger on your turn start");
  assert.equal(zoneOf(engine, id("res")), "hand");
});

clause(COMPLEX, "0:rule", "Abandoned Testing Complex: with fewer than 3 unspent resources you can't pay, so no payment is offered and no resource gets played (exactly 3 is enough)", () => {
  const { engine, id } = complexBoard(2);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.pendingChoice, undefined, "nothing to pay 3 with");
  assert.equal(readyOf(engine, P1), 2, "nothing was spent");
  assert.equal(zoneOf(engine, id("res")), "hand", "nothing was played");
  const control = complexBoard(3);
  endTurn(control.engine, P2);
  answerPending(control.engine, "mayPay", { pay: true });
  answerPending(control.engine, "chooserSelectsTarget", { selected: [control.id("res")] });
  assert.equal(zoneOf(control.engine, control.id("res")), "play", "positive control: exactly 3 resources can pay");
  assert.equal(readyOf(control.engine, P1), 1, "the 3 are spent, the new resource is unspent");
});

clause(COMPLEX, "0:rule", "Abandoned Testing Complex's resource play is separate from the Develop Rule: you can still develop a resource this turn", () => {
  const { engine, id } = complexBoard(5, [{ key: "res2", def: elitismSeed("Seed Two"), owner: P1, zone: "hand" }]);
  endTurn(engine, P2);
  answerPending(engine, "mayPay", { pay: true });
  answerPending(engine, "chooserSelectsTarget", { selected: [id("res")] });
  assert.equal(zoneOf(engine, id("res")), "play");
  developResource(engine, P1, id("res2"), true);
  assert.equal(zoneOf(engine, id("res2")), "play", "the Develop Rule's resource play is still available");
});
