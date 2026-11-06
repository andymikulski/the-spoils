// Clause tests: holy-heist-09 part p4 (missing clauses of The Primitive Tribes of Thabbash:
// STARTING RESOURCES, STARTING DRAW, RESTORE RULE, DEVELOP RULE, DRAW, RESOURCE).

import assert from "node:assert/strict";
import { buildGame, bank, character, developFaction, resolvePendingResponses, volition, P1, P2 } from "../per-card/_harness.js";
import { resourceCard } from "../support/fixtures.js";
import { clause, printing, refused, holdResourceFace } from "./_clause.js";
import { answerPending, fillers, pending, zoneOf } from "./_board.js";
import { attachedCount, developDraw, developResource, endTurn, factionOf, setupGame, spentResources, developOffers, endTurnRaw } from "./_turn.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";
import { settleTurnStart } from "../support/develop.js";

const PRIMITIVE = "94296fb0-a890-4503-8146-9c7cacc079d0"; // faction, 24 influence

const OBSESSION = printing("dab6e897-b5be-4760-95c0-20c2795a9ae3");
const RAGE = printing("3be26b3f-2c78-4d0c-8849-0b4ca48951fd");
const GREED = printing("61766da9-6482-4ecb-8306-becda47294ec");
const ODD = resourceCard({ id: "p4-odd", name: "Odd Resource", resource: { provides: ["elitism"], staple: false } });
const FILLER = character({ id: "p4-filler", name: "Filler" });
const repeat = (def: CardDefinition, n: number): CardDefinition[] => Array.from({ length: n }, () => def);

const handSize = (engine: SpoilsEngine, p: PlayerId): number => engine.state.players[p].hand.length;
const deckOf = (engine: SpoilsEngine, p: PlayerId) => engine.state.players[p].deck;
const ready = (engine: SpoilsEngine, p: PlayerId = P1): number => engine.getAvailableResourceCount(p);
const playCards = (engine: SpoilsEngine, p: PlayerId): CardInstanceId[] =>
  engine.state.players[p].play.filter((c) => engine.getDefinition(c).type !== "faction");
const names = (engine: SpoilsEngine, ids: CardInstanceId[]): string[] => ids.map((c) => engine.getDefinition(c).name).sort();

const seat = (deck: CardDefinition[]) => ({ faction: printing(PRIMITIVE), deck });
const stdDeck = (): CardDefinition[] => [OBSESSION, RAGE, GREED, ODD, ...repeat(FILLER, 40)];

// ===============================================================================
// STARTING RESOURCES: 1 face-down Obsession, 1 staple resource.
// ===============================================================================

clause(PRIMITIVE, "0:rule:STARTING RESOURCES", "starts with exactly 2 resources in play: the Obsession face-down and one staple", () => {
  const engine = setupGame(seat([OBSESSION, RAGE, ODD, ...repeat(FILLER, 40)]), seat(stdDeck()));
  const mine = playCards(engine, P1);
  assert.equal(mine.length, 2, "exactly two starting resources");
  assert.deepEqual(names(engine, mine), ["Obsession", "Rage"]);
  const obs = mine.find((c) => engine.getDefinition(c).name === "Obsession")!;
  const rage = mine.find((c) => engine.getDefinition(c).name === "Rage")!;
  assert.equal(engine.state.cards[obs].faceDown, true, "the Obsession starts face-down");
  assert.equal(engine.state.cards[rage].faceDown, false, "the staple is face-up");
  assert.equal(engine.getThresholds(P1).volition, 1, "a face-down resource provides Volition");
  assert.equal(engine.getThresholds(P1).obsession ?? 0, 0, "face-down, it does not provide Obsession");
  assert.equal(engine.getThresholds(P1).rage, 1, "the staple provides its icon");
  assert.equal(ready(engine), 2);
});

clause(PRIMITIVE, "0:rule:STARTING RESOURCES", "the face-down card is an Obsession; a non-staple resource is never taken; resources come out of the deck", () => {
  const deck = [OBSESSION, RAGE, GREED, ODD, ...repeat(FILLER, 40)];
  const engine = setupGame(seat(deck), seat(stdDeck()));
  const mine = playCards(engine, P1);
  assert.equal(mine.filter((c) => engine.state.cards[c].faceDown).length, 1, "exactly one face-down card");
  const down = mine.find((c) => engine.state.cards[c].faceDown)!;
  assert.equal(engine.getDefinition(down).name, "Obsession", "the face-down one is the Obsession");
  const up = mine.find((c) => !engine.state.cards[c].faceDown)!;
  assert.ok(["Rage", "Greed"].includes(engine.getDefinition(up).name), "the other is a staple (not Obsession's slot, not the non-staple)");
  assert.ok(!names(engine, mine).includes("Odd Resource"), "a non-staple resource is not taken");
  assert.equal(deckOf(engine, P1).length, deck.length - 2 - 8, "44 cards less 2 starting resources less 8 in hand: they come out of the deck");
  assert.equal(handSize(engine, P1), 8);
});

clause(PRIMITIVE, "0:rule:STARTING RESOURCES", "with the choose-starting-resources step on, the player picks which staple (Rage, Greed...) is the 1 staple resource", () => {
  const engine = setupGame(seat([OBSESSION, RAGE, GREED, GREED, ODD, ...repeat(FILLER, 40)]), seat(stdDeck()), { choose: true });
  assert.equal(engine.state.setup.phase, "chooseStartingResources", "'1 staple resource' is unrestricted: I am asked which staple");
  const choice = engine.getStartingResourceChoice(P1)!;
  assert.ok(choice, "P1 is offered a choice");
  const picked = choice.candidateCardIds.filter((c) => engine.getDefinition(c).name === "Greed").slice(0, 1);
  assert.equal(picked.length, 1, "Greed is a candidate staple");
  assert.ok(!choice.candidateCardIds.some((c) => engine.getDefinition(c).name === "Odd Resource"), "the non-staple is not a candidate");
  engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: picked });
  assert.deepEqual(names(engine, playCards(engine, P1)), ["Greed", "Obsession"], "the picked staple plus the face-down Obsession");
});

clause(PRIMITIVE, "0:rule:STARTING RESOURCES", "the 1 staple slot takes only a staple: with no staple besides the Obsession, setup cannot find it", () => {
  refused(() => setupGame(seat([OBSESSION, ODD, ...repeat(FILLER, 40)]), seat(stdDeck())), "the non-staple resource is not a staple", /no matching starting resource/);
  const ok = setupGame(seat([OBSESSION, GREED, ODD, ...repeat(FILLER, 40)]), seat(stdDeck()));
  assert.deepEqual(names(ok, playCards(ok, P1)), ["Greed", "Obsession"], "control: with a staple present it starts");
  assert.equal(ok.state.players[P1].influence, 24, "the faction's starting influence");
});

// ===============================================================================
// STARTING DRAW: 8 going first, 9 going second.
// ===============================================================================

clause(PRIMITIVE, "1:rule:STARTING DRAW", "draws 8 going first", () => {
  const engine = setupGame(seat(stdDeck()), seat(stdDeck()), { first: P1 });
  assert.equal(handSize(engine, P1), 8, "going first: 8");
  assert.equal(deckOf(engine, P1).length, 44 - 2 - 8);
});

clause(PRIMITIVE, "1:rule:STARTING DRAW", "draws 9 going second", () => {
  const engine = setupGame(seat(stdDeck()), seat(stdDeck()), { first: P2 });
  assert.equal(handSize(engine, P1), 9, "going second: 9");
  assert.equal(handSize(engine, P2), 8, "the opponent, going first with the same faction, draws 8");
  assert.equal(deckOf(engine, P1).length, 44 - 2 - 9);
});

// ===============================================================================
// RESTORE RULE: At the start of your turn, restore all your depleted cards and detach all resources from your faction.
// ===============================================================================

function restoreBoard(active: PlayerId) {
  return buildGame({
    playerA: { faction: printing(PRIMITIVE) },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    cards: [
      { key: "mineChar", def: character({ name: "My Depleted Character" }), owner: P1, depleted: true },
      { key: "mineReady", def: character({ name: "My Ready Character" }), owner: P1 },
      ...spentResources(P1, 3),
      ...volition(1, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })),
      ...bank("greed", 2, P1),
      { key: "theirChar", def: character({ name: "Their Depleted Character" }), owner: P2, depleted: true },
      { key: "stolenIn", def: character({ name: "Stolen In" }), owner: P2, controller: P1, depleted: true },
      { key: "stolenOut", def: character({ name: "Stolen Out" }), owner: P1, controller: P2, depleted: true },
      ...spentResources(P2, 2),
      ...fillers("mydeck", 4, P1, "deck"),
      ...fillers("theirdeck", 4, P2, "deck")
    ]
  });
}

clause(PRIMITIVE, "2:rule:RESTORE RULE", "at the start of my turn my depleted cards restore and every resource (face-up and face-down) detaches from my faction", () => {
  const { engine, id } = restoreBoard(P2);
  assert.equal(attachedCount(engine, P1), 4, "3 rage + 1 volition attached before my turn");
  assert.equal(engine.state.cards[id("mineChar")].depleted, true);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.cards[id("mineChar")].depleted, false, "my depleted character is restored");
  assert.equal(engine.state.cards[id("mineReady")].depleted, false);
  assert.equal(engine.state.cards[id("stolenIn")].depleted, false, "a depleted card I control (owned by the opponent) is mine to restore");
  assert.equal(attachedCount(engine, P1), 0, "all resources are detached from my faction");
  assert.equal(ready(engine), 6, "all six resources are ready again");
});

clause(PRIMITIVE, "2:rule:RESTORE RULE", "does not restore the opponent's cards or detach the opponent's resources", () => {
  const { engine, id } = restoreBoard(P2);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("theirChar")].depleted, true, "the opponent's depleted character stays depleted");
  assert.equal(engine.state.cards[id("stolenOut")].depleted, true, "a card I own but the opponent controls is not mine to restore");
  assert.equal(attachedCount(engine, P2), 2, "the opponent's resources stay attached");
});

clause(PRIMITIVE, "2:rule:RESTORE RULE", "does nothing at the start of the opponent's turn", () => {
  const { engine, id } = restoreBoard(P1);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.cards[id("mineChar")].depleted, true, "my depleted character stays depleted");
  assert.equal(engine.state.cards[id("stolenIn")].depleted, true);
  assert.equal(attachedCount(engine, P1), 4, "my resources stay attached");
  assert.equal(attachedCount(engine, P2), 0, "(the opponent's own restore ran for them)");
});

clause(PRIMITIVE, "2:rule:RESTORE RULE", "restores my depleted faction card too", () => {
  const { engine } = restoreBoard(P2);
  engine.state.cards[factionOf(engine, P1)].depleted = true;
  endTurn(engine, P2);
  assert.equal(engine.state.cards[factionOf(engine, P1)].depleted, false, "my faction is one of my depleted cards");
});

// ===============================================================================
// DEVELOP RULE: At the start of your turn, draw a card or play a resource.
// ===============================================================================

function developBoard(active: PlayerId = P1) {
  return buildGame({
    playerA: { faction: printing(PRIMITIVE) },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    cards: [
      { key: "handRes", def: resourceCard({ name: "Hand Resource", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
      { key: "handRes2", def: resourceCard({ name: "Hand Resource 2", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" },
      { key: "handChar", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" },
      ...fillers("mydeck", 4, P1, "deck"),
      ...fillers("theirdeck", 4, P2, "deck"),
      { key: "theirHand", def: character({ name: "Their Hand Card" }), owner: P2, zone: "hand" }
    ]
  });
}

clause(PRIMITIVE, "3:rule:DEVELOP RULE", "may draw a card (the top of the deck)", () => {
  const { engine, id } = developBoard();
  const hand = handSize(engine, P1);
  const deck = [...deckOf(engine, P1)];
  const theirs = handSize(engine, P2);
  assert.ok(developOffers(engine, P1).length > 0, "the Develop Rule offers something");
  developDraw(engine, P1);
  assert.equal(handSize(engine, P1), hand + 1);
  assert.equal(zoneOf(engine, id("mydeck0")), "hand", "the top card");
  assert.deepEqual(deckOf(engine, P1), deck.slice(1));
  assert.equal(handSize(engine, P2), theirs, "the opponent draws nothing");
  assert.equal(playCards(engine, P1).length, 0, "no resource is played");
});

clause(PRIMITIVE, "3:rule:DEVELOP RULE", "may play a resource card face-up", () => {
  const { engine, id } = developBoard();
  const hand = handSize(engine, P1);
  const deck = [...deckOf(engine, P1)];
  developResource(engine, P1, id("handRes"), false);
  assert.equal(zoneOf(engine, id("handRes")), "play");
  assert.equal(engine.state.cards[id("handRes")].faceDown, false);
  assert.equal(engine.getThresholds(P1).greed, 1);
  assert.equal(handSize(engine, P1), hand - 1);
  assert.deepEqual(deckOf(engine, P1), deck, "nothing drawn");
  assert.equal(zoneOf(engine, id("handRes2")), "hand", "only one resource is played");
});

clause(PRIMITIVE, "3:rule:DEVELOP RULE", "may play any card face-down as a resource (Volition)", () => {
  const { engine, id } = developBoard();
  developResource(engine, P1, id("handChar"), true);
  assert.equal(zoneOf(engine, id("handChar")), "play");
  assert.equal(engine.state.cards[id("handChar")].faceDown, true);
  assert.equal(engine.getThresholds(P1).volition, 1);
  const real = developBoard();
  developResource(real.engine, P1, real.id("handRes"), true);
  assert.equal(real.engine.state.cards[real.id("handRes")].faceDown, true);
  assert.equal(real.engine.getThresholds(P1).greed ?? 0, 0, "face-down, it no longer provides its icon");
});

clause(PRIMITIVE, "3:rule:DEVELOP RULE", "a non-resource card cannot be played face-up", () => {
  const { engine, id } = developBoard();
  developResource(engine, P1, id("handChar"), false); // asked to play it face-up
  assert.equal(engine.state.cards[id("handChar")].faceDown, true, "only an actual resource card may go face-up: a non-resource card enters face-down");
  assert.equal(zoneOf(engine, id("handChar")), "play");
  assert.equal(engine.state.pendingChoice, undefined, "that was the Develop Rule's one resource play");
  const control = developBoard();
  developResource(control.engine, P1, control.id("handRes"), false);
  assert.equal(zoneOf(control.engine, control.id("handRes")), "play");
  assert.equal(control.engine.state.cards[control.id("handRes")].faceDown, false);
});

clause(PRIMITIVE, "3:rule:DEVELOP RULE", "draw OR play a resource: not both; and only once per turn", () => {
  const drawn = developBoard();
  developDraw(drawn.engine, P1);
  assert.equal(drawn.engine.state.pendingChoice, undefined, "drawing was the Develop Rule: neither a resource play nor a second draw is offered");
  assert.equal(zoneOf(drawn.engine, drawn.id("handRes")), "hand");
  const played = developBoard();
  const deck = [...deckOf(played.engine, P1)];
  developResource(played.engine, P1, played.id("handRes"), false);
  assert.equal(played.engine.state.pendingChoice, undefined, "playing a resource was the Develop Rule: neither a draw nor a second resource is offered");
  assert.deepEqual(deckOf(played.engine, P1), deck);
  assert.equal(zoneOf(played.engine, played.id("handRes2")), "hand");
});

clause(PRIMITIVE, "3:rule:DEVELOP RULE", "only on my own turn", () => {
  const { engine, id } = developBoard();
  const handBefore = engine.state.players[P1].hand.length;
  endTurnRaw(engine, P1); // the opponent's turn starts
  assert.equal(engine.state.activePlayerId, P2);
  const pending = engine.state.pendingChoice as unknown as { playerId: string } | undefined;
  assert.equal(pending?.playerId, P2, "only the player whose turn it is gets a Develop Rule to use");
  settleTurnStart(engine, "draw");
  assert.equal(engine.state.players[P1].hand.length, handBefore, "I draw nothing at the opponent's turn start");
  assert.equal(zoneOf(engine, id("handRes")), "hand");
  const mine = developBoard();
  developResource(mine.engine, P1, mine.id("handRes"), false);
  assert.equal(zoneOf(mine.engine, mine.id("handRes")), "play");
});

clause(PRIMITIVE, "3:rule:DEVELOP RULE", "is optional and available again each turn", () => {
  const { engine } = developBoard();
  const hand = handSize(engine, P1);
  endTurn(engine, P1);
  assert.equal(handSize(engine, P1), hand, "skipping costs nothing");
  endTurnRaw(engine, P2);
  settleTurnStart(engine, "draw");
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(handSize(engine, P1), hand + 1, "the Develop Rule is offered again at the start of my next turn");
});

clause(PRIMITIVE, "3:rule:DEVELOP RULE", "offers only draw and play a resource (nothing else)", () => {
  const { engine } = developBoard();
  assert.deepEqual(developOffers(engine, P1), ["Draw 1 card", "Play a resource"], "not a Develop choice");
});

// ===============================================================================
// DRAW (Pay 3: draw a card) and RESOURCE (Pay 4: play a resource)
// ===============================================================================

function abilityBoard(resources: number, extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: printing(PRIMITIVE) },
    playerB: { faction: developFaction() },
    cards: [
      ...bank("rage", resources, P1),
      ...fillers("mydeck", 4, P1, "deck"),
      ...fillers("theirdeck", 4, P2, "deck"),
      { key: "handRes", def: resourceCard({ name: "Hand Resource", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
      { key: "handChar", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" },
      { key: "theirHand", def: resourceCard({ name: "Their Hand Resource", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" },
      ...extra
    ]
  });
}

function activateFaction(engine: SpoilsEngine, pid: PlayerId, abilityId: string, owner: PlayerId = pid, selected: Record<string, CardInstanceId[]> = {}): void {
  engine.perform({ type: "activateAbility", playerId: pid, cardId: factionOf(engine, owner), abilityId, selected, variables: {} });
  resolvePendingResponses(engine);
}

clause(PRIMITIVE, "4:ability", "DRAW pays exactly 3 resources and draws one card", () => {
  const { engine, id } = abilityBoard(5);
  const hand = handSize(engine, P1);
  const deck = [...deckOf(engine, P1)];
  assert.equal(ready(engine), 5);
  activateFaction(engine, P1, "primitive-draw");
  assert.equal(ready(engine), 2, "exactly 3 paid");
  assert.equal(attachedCount(engine, P1), 3, "paid resources attach to the faction");
  assert.equal(handSize(engine, P1), hand + 1);
  assert.equal(zoneOf(engine, id("mydeck0")), "hand", "the top card");
  assert.deepEqual(deckOf(engine, P1), deck.slice(1));
  assert.equal(handSize(engine, P2), 1, "the opponent draws nothing");
  assert.equal(engine.state.cards[factionOf(engine, P1)].depleted, false, "the faction is not depleted");
});

clause(PRIMITIVE, "4:ability", "DRAW is refused when 3 can't be paid", () => {
  const two = abilityBoard(2);
  refused(() => activateFaction(two.engine, P1, "primitive-draw"), "2 resources", /cannot be paid/);
  assert.equal(handSize(two.engine, P1), 2);
  assert.equal(attachedCount(two.engine, P1), 0, "nothing half-paid");
  const spent = abilityBoard(4);
  for (const r of spent.engine.getAvailableResourceIds(P1).slice(0, 2)) spent.engine.state.cards[r].attachedTo = factionOf(spent.engine, P1);
  refused(() => activateFaction(spent.engine, P1, "primitive-draw"), "4 resources, 2 spent", /cannot be paid/);
  const exact = abilityBoard(3);
  activateFaction(exact.engine, P1, "primitive-draw");
  assert.equal(handSize(exact.engine, P1), 3);
});

clause(PRIMITIVE, "4:ability", "DRAW can be used repeatedly, is separate from the Develop Rule, and only by its controller", () => {
  const { engine } = abilityBoard(7);
  const hand = handSize(engine, P1);
  activateFaction(engine, P1, "primitive-draw");
  activateFaction(engine, P1, "primitive-draw");
  assert.equal(handSize(engine, P1), hand + 2);
  assert.equal(attachedCount(engine, P1), 6);
  assert.ok(developOffers(engine, P1).length > 0, "using the ability does not use up the Develop Rule");
  developDraw(engine, P1);
  assert.equal(handSize(engine, P1), hand + 3);
  const foe = buildGame({
    playerA: { faction: printing(PRIMITIVE) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [...bank("rage", 6, P2), ...bank("rage", 6, P1), ...fillers("theirdeck", 4, P2, "deck")]
  });
  const theirs = handSize(foe.engine, P2);
  refused(() => activateFaction(foe.engine, P2, "primitive-draw", P1), "the opponent cannot use my faction's ability", /do not control/i);
  assert.equal(handSize(foe.engine, P2), theirs);
  assert.equal(attachedCount(foe.engine, P2), 0);
});

function useResource(engine: SpoilsEngine, pick: CardInstanceId[], pid: PlayerId = P1, owner: PlayerId = pid): void {
  activateFaction(engine, pid, "primitive-resource", owner);
  answerPending(engine, "chooserSelectsTarget", { selected: pick });
}

clause(PRIMITIVE, "5:ability", "RESOURCE pays exactly 4 and plays a resource card from my hand", () => {
  const { engine, id } = abilityBoard(6);
  const hand = handSize(engine, P1);
  const deck = [...deckOf(engine, P1)];
  useResource(engine, [id("handRes")]);
  assert.equal(attachedCount(engine, P1), 4, "exactly 4 paid");
  assert.equal(zoneOf(engine, id("handRes")), "play");
  assert.equal(engine.state.cards[id("handRes")].faceDown, false, "an actual resource card goes in face-up");
  assert.equal(engine.getThresholds(P1).greed, 1);
  assert.equal(handSize(engine, P1), hand - 1);
  assert.deepEqual(deckOf(engine, P1), deck, "nothing drawn");
  assert.equal(zoneOf(engine, id("handChar")), "hand", "only the chosen card is played");
  assert.equal(ready(engine), 6 - 4 + 1);
});

clause(PRIMITIVE, "5:ability", "RESOURCE plays a non-resource card face-down", () => {
  const { engine, id } = abilityBoard(4);
  useResource(engine, [id("handChar")]);
  assert.equal(zoneOf(engine, id("handChar")), "play");
  assert.equal(engine.state.cards[id("handChar")].faceDown, true);
  assert.equal(engine.getThresholds(P1).volition, 1);
  assert.equal(zoneOf(engine, id("handRes")), "hand");
});

clause(PRIMITIVE, "5:ability", "RESOURCE lets me choose face-up or face-down for an actual resource card", () => holdResourceFace(() => {
  const { engine, id } = abilityBoard(4);
  useResource(engine, [id("handRes")]);
  const asked = engine.state.pendingChoice !== undefined && zoneOf(engine, id("handRes")) === "hand";
  const faceDown = zoneOf(engine, id("handRes")) === "play" && engine.state.cards[id("handRes")].faceDown;
  assert.ok(asked || faceDown, "the player must get to say face-up or face-down; the engine put it in play face-up without asking");
}));

clause(PRIMITIVE, "5:ability", "RESOURCE plays exactly one resource, not two", () => {
  const { engine, id } = abilityBoard(4);
  activateFaction(engine, P1, "primitive-resource");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("handRes"), id("handChar")] }), "two cards", /./);
  assert.equal(zoneOf(engine, id("handRes")), "hand");
  assert.equal(zoneOf(engine, id("handChar")), "hand");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("handRes")] });
  assert.equal(zoneOf(engine, id("handRes")), "play");
  assert.equal(zoneOf(engine, id("handChar")), "hand");
});

clause(PRIMITIVE, "5:ability", "RESOURCE card must come from my own hand", () => {
  const { engine, id } = abilityBoard(4);
  activateFaction(engine, P1, "primitive-resource");
  const ask = (ids: CardInstanceId[]) => () => answerPending(engine, "chooserSelectsTarget", { selected: ids });
  refused(ask([id("theirHand")]), "the opponent's hand card");
  refused(ask([id("mydeck0")]), "a card in my deck");
  assert.equal(zoneOf(engine, id("theirHand")), "hand");
  assert.equal(zoneOf(engine, id("mydeck0")), "deck");
  assert.ok(pending(engine), "still waiting for a legal pick");
  ask([id("handChar")])();
  assert.equal(zoneOf(engine, id("handChar")), "play");
  assert.equal(pending(engine), undefined);
});

clause(PRIMITIVE, "5:ability", "RESOURCE is refused when 4 can't be paid; usable repeatedly; only by its controller", () => {
  const three = abilityBoard(3);
  refused(() => useResource(three.engine, [three.id("handRes")]), "3 resources", /cannot be paid/);
  assert.equal(zoneOf(three.engine, three.id("handRes")), "hand");
  assert.equal(attachedCount(three.engine, P1), 0);
  const spent = abilityBoard(5);
  for (const r of spent.engine.getAvailableResourceIds(P1).slice(0, 2)) spent.engine.state.cards[r].attachedTo = factionOf(spent.engine, P1);
  refused(() => useResource(spent.engine, [spent.id("handRes")]), "5 resources, 2 spent", /cannot be paid/);
  const exact = abilityBoard(4);
  useResource(exact.engine, [exact.id("handRes")]);
  assert.equal(zoneOf(exact.engine, exact.id("handRes")), "play");

  const twice = abilityBoard(9);
  useResource(twice.engine, [twice.id("handRes")]);
  useResource(twice.engine, [twice.id("handChar")]);
  assert.equal(zoneOf(twice.engine, twice.id("handChar")), "play", "usable again the same turn");
  assert.equal(attachedCount(twice.engine, P1), 8);
  assert.ok(developOffers(twice.engine, P1).length > 0, "separate from the Develop Rule");

  const foe = buildGame({
    playerA: { faction: printing(PRIMITIVE) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [...bank("rage", 6, P2), ...bank("rage", 6, P1), { key: "fh", def: character({ name: "Foe Hand" }), owner: P2, zone: "hand" }]
  });
  refused(() => activateFaction(foe.engine, P2, "primitive-resource", P1), "the opponent cannot use my faction's ability", /do not control/i);
  assert.equal(zoneOf(foe.engine, foe.id("fh")), "hand");
});

clause(PRIMITIVE, "5:ability", "RESOURCE: 'Play a resource' is not optional, so a player holding cards cannot decline the pick after paying", () => {
  const { engine, id } = abilityBoard(4);
  activateFaction(engine, P1, "primitive-resource");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [] }), "declining to play any resource", /./);
  assert.equal(zoneOf(engine, id("handRes")), "hand");
});
