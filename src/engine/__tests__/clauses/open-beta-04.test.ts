// Clause tests — batch open-beta-04. See docs/TESTING.md and
// `npm run card-tests -- manifest open-beta-04`. Expectations come from each
// card's PRINTED text and RULES.md; engine data is only used to drive the engine.

import assert from "node:assert/strict";
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
  volition,
  P1,
  P2,
  resolvePendingResponses
} from "../per-card/_harness.js";
import type { StapleIcon } from "../per-card/_harness.js";
import { clause, declineAll, drain, printing } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { battleOf, declareAttackBy, fight, playRaw } from "./_battle.js";
import { attachedCount, endTurn, factionOf, readyCount, spentResources, developPlay } from "./_turn.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- shared helpers (this file only) ---------------------------------------

type Icons = Partial<Record<StapleIcon, number>>;

/** Staple resources for `owner`, e.g. `res({ greed: 2, rage: 3 })`. */
const res = (icons: Icons, owner: PlayerId = P1): CardPlacement[] =>
  (Object.entries(icons) as Array<[StapleIcon, number]>).flatMap(([icon, n]) => bank(icon, n, owner));

const pending = (engine: SpoilsEngine) => engine.state.pendingChoice as unknown as PendingChoiceLike | undefined;
const zoneOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].zone;
const handOf = (engine: SpoilsEngine, player: PlayerId) => engine.state.players[player].hand;
const deckOf = (engine: SpoilsEngine, player: PlayerId) => engine.state.players[player].deck;
const discardOf = (engine: SpoilsEngine, player: PlayerId) => engine.state.players[player].discard;
const ready = (engine: SpoilsEngine, player: PlayerId = P1) => engine.getAvailableResourceCount(player);

/** `n` vanilla characters in `owner`'s deck, keyed `<prefix>0..n-1`, top of the deck first. */
function deckCards(prefix: string, n: number, owner: PlayerId): CardPlacement[] {
  return Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: character({ name: `${prefix.toUpperCase()}${i}` }), owner, zone: "deck" as const }));
}

/** `n` vanilla characters in `owner`'s hand, keyed `<prefix>0..n-1`. */
function handCards(prefix: string, n: number, owner: PlayerId): CardPlacement[] {
  return Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: character({ name: `${prefix.toUpperCase()}${i}` }), owner, zone: "hand" as const }));
}

/** Answers the open pending choice (asserting its kind and who answers it), then drains response windows. */
function answerChoice(engine: SpoilsEngine, kind: string, playerId: PlayerId, choice: Record<string, unknown>): void {
  const pc = pending(engine);
  assert.ok(pc, `expected an open pending choice of kind ${kind}`);
  assert.equal(pc.kind, kind, "pending choice kind");
  assert.equal(pc.playerId, playerId, `${kind} must be answered by ${playerId}`);
  engine.perform({ type: "resolvePendingChoice", playerId, choice: { kind, ...choice } } as never);
  resolvePendingResponses(engine);
}

/** Picks `selected` for the open `chooserSelectsTarget` (a search / "pick N" prompt). */
const pickCards = (engine: SpoilsEngine, playerId: PlayerId, selected: CardInstanceId[]) => answerChoice(engine, "chooserSelectsTarget", playerId, { selected });

/** "Up to N less" (1337!, Jo Ciendeilio): the controller is asked how much to reduce (a chooseNumber 0..N). Answers with `value` (the full N when omitted) and drains the response windows; does nothing when no such choice is open. */
function answerUpTo(engine: SpoilsEngine, player: PlayerId = P1, value?: number): void {
  const pc = pending(engine) as unknown as { kind?: string; max?: number } | undefined;
  if (pc?.kind !== "chooseNumber") return;
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooseNumber", value: value ?? (pc.max as number) } } as never);
  resolvePendingResponses(engine);
}

/** Plays a card that says "up to N less" and answers its reduction prompt (the full N unless `value` says otherwise). */
function playUpTo(engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, value?: number): void {
  play(engine, player, cardId);
  answerUpTo(engine, player, value);
}

/** Same pick, WITHOUT draining responses and without asserting — for `assert.throws`. */
const tryPick = (engine: SpoilsEngine, playerId: PlayerId, selected: CardInstanceId[]) => () =>
  engine.perform({ type: "resolvePendingChoice", playerId, choice: { kind: "chooserSelectsTarget", selected } } as never);

/** A tactic that deals `amount` damage to one chosen character (id `zap`, declaration `t`). */
const zapTactic = (name: string, amount: number): CardDefinition =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "zap",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });

/** A free tactic that destroys one chosen card of `type` (id `kill`, declaration `t`). */
const killAnyTactic = (type: "character" | "item" | "location" | "resource"): CardDefinition =>
  tactic({
    name: `Kill ${type}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "kill",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

/** Reveal events in the log (cardsRevealed). */
const revealEvents = (engine: SpoilsEngine) => engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");

// --- Secret Handshake ------------------------------------------------------
// COST: Pick a character. -- EFFECT: This turn, the character gains 4 life.
// Then, draw a card. Tactic, cost 2, threshold [G].

const HANDSHAKE = "00c31fbb-a04b-4087-9023-60f09566fd44";

function handshakeBoard(icons: Icons = { greed: 4 }, extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "sh", def: printing(HANDSHAKE), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...deckCards("a", 3, P1),
      ...deckCards("b", 3, P2),
      ...res(icons),
      ...extra
    ]
  });
}

clause(HANDSHAKE, "0:ability", "pays 2, gives the picked character +4 life and no other character, then its controller draws exactly one card", () => {
  const { engine, id } = handshakeBoard();
  const before = ready(engine);
  const top = deckOf(engine, P1)[0];
  const handBefore = handOf(engine, P1).length;
  play(engine, P1, id("sh"), { selected: { c: [id("mine")] } });

  assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid");
  assert.equal(engine.getStat(id("mine"), "life"), 3 + 4, "the picked character gains 4 life");
  assert.equal(engine.getStat(id("other"), "life"), 3, "another of my characters is unaffected");
  assert.equal(engine.getStat(id("foe"), "life"), 3, "an opponent's character is unaffected");
  assert.equal(engine.getStat(id("mine"), "strength"), 2, "only life changes");
  assert.equal(engine.getStat(id("mine"), "speed"), 2, "only life changes");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1, "the tactic left the hand and one card was drawn");
  assert.equal(zoneOf(engine, top), "hand", "the drawn card is the top card of my deck");
  assert.equal(deckOf(engine, P1).length, 2);
  assert.equal(zoneOf(engine, id("sh")), "discard", "the tactic ends in its owner's discard pile");
});

clause(HANDSHAKE, "0:ability", "can pick an opponent's character: it gains the life, and the tactic's controller (not the picked character's) draws", () => {
  const { engine, id } = handshakeBoard();
  const p1Hand = handOf(engine, P1).length;
  const p2Hand = handOf(engine, P2).length;
  play(engine, P1, id("sh"), { selected: { c: [id("foe")] } });
  assert.equal(engine.getStat(id("foe"), "life"), 3 + 4);
  assert.equal(handOf(engine, P1).length, p1Hand - 1 + 1, "the controller drew");
  assert.equal(handOf(engine, P2).length, p2Hand, "the opponent did not draw");
  assert.equal(deckOf(engine, P2).length, 3);
  assert.equal(engine.getStat(id("mine"), "life"), 3);
});

clause(HANDSHAKE, "0:ability", "the life is a real life boost: a life-2 character survives 5 damage after +4 life (life 6) and dies to the 6th point", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "sh", def: printing(HANDSHAKE), owner: P1, zone: "hand" },
      { key: "weak", def: character({ name: "Weak", strength: 1, life: 2 }), owner: P1, zone: "play" },
      { key: "z5", def: zapTactic("Zap5", 5), owner: P1, zone: "hand" },
      { key: "z1", def: zapTactic("Zap1", 1), owner: P1, zone: "hand" },
      ...deckCards("a", 2, P1),
      ...res({ greed: 4 })
    ]
  });
  play(engine, P1, id("sh"), { selected: { c: [id("weak")] } });
  assert.equal(engine.getStat(id("weak"), "life"), 6);
  play(engine, P1, id("z5"), { selected: { t: [id("weak")] } });
  assert.equal(zoneOf(engine, id("weak")), "play", "5 damage does not kill a life-6 character");
  assert.equal(engine.state.cards[id("weak")].damage, 5);
  play(engine, P1, id("z1"), { selected: { t: [id("weak")] } });
  assert.equal(zoneOf(engine, id("weak")), "discard", "6 damage kills it");
});

clause(HANDSHAKE, "0:ability", "the life boost lasts this turn only", () => {
  const { engine, id } = handshakeBoard();
  play(engine, P1, id("sh"), { selected: { c: [id("mine")] } });
  assert.equal(engine.getStat(id("mine"), "life"), 7, "granted this turn");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2, "the turn has passed");
  assert.equal(engine.getStat(id("mine"), "life"), 3, "gone when the turn ends");
  endTurn(engine, P2);
  assert.equal(engine.getStat(id("mine"), "life"), 3, "and it does not come back next turn");
});

clause(HANDSHAKE, "0:ability", "if the picked character is destroyed in response, the tactic still resolves as far as it can: I still draw the card", () => {
  const { engine, id } = handshakeBoard({ greed: 4 }, [{ key: "foeKill", def: killTactic({ name: "FoeKill" }), owner: P2, zone: "hand" }]);
  const handBefore = handOf(engine, P1).length;
  playRaw(engine, P1, id("sh"), { selected: { c: [id("mine")] } });
  engine.perform({ type: "playCard", playerId: P2, cardId: id("foeKill"), selected: { t: [id("mine")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("mine")), "discard", "the response destroyed the picked character");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1, "the draw still happens (CR 402.5)");
  assert.equal(zoneOf(engine, id("sh")), "discard");
});

clause(HANDSHAKE, "0:ability", "two Secret Handshakes on the same character stack (+8 life)", () => {
  const { engine, id } = handshakeBoard({ greed: 6 }, [{ key: "sh2", def: printing(HANDSHAKE), owner: P1, zone: "hand" }]);
  play(engine, P1, id("sh"), { selected: { c: [id("mine")] } });
  play(engine, P1, id("sh2"), { selected: { c: [id("mine")] } });
  assert.equal(engine.getStat(id("mine"), "life"), 3 + 8);
});

clause(HANDSHAKE, "0:ability", "with an empty deck the life is still gained and nothing is drawn (running out of cards is not a loss)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "sh", def: printing(HANDSHAKE), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", life: 3 }), owner: P1, zone: "play" },
      ...res({ greed: 2 })
    ]
  });
  const handBefore = handOf(engine, P1).length;
  play(engine, P1, id("sh"), { selected: { c: [id("mine")] } });
  assert.equal(engine.getStat(id("mine"), "life"), 7);
  assert.equal(handOf(engine, P1).length, handBefore - 1, "no card to draw");
  assert.equal(engine.state.winner, undefined, "the game goes on");
});

clause(HANDSHAKE, "0:ability", "is refused one resource short of its cost of 2, and without [G] even with plenty of other resources", () => {
  const short = handshakeBoard({ greed: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("sh"), { selected: { c: [short.id("mine")] } }));
  assert.equal(zoneOf(short.engine, short.id("sh")), "hand", "nothing was played");
  assert.equal(short.engine.getStat(short.id("mine"), "life"), 3);

  const noThreshold = handshakeBoard({ rage: 5, elitism: 3 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("sh"), { selected: { c: [noThreshold.id("mine")] } }));

  const exact = handshakeBoard({ greed: 2 });
  play(exact.engine, P1, exact.id("sh"), { selected: { c: [exact.id("mine")] } });
  assert.equal(exact.engine.getStat(exact.id("mine"), "life"), 7, "[G] and exactly 2 resources is enough");
  assert.equal(ready(exact.engine), 0);
});

clause(HANDSHAKE, "0:ability", "[G] is a gate, not a cost: it takes exactly 2 resources, one of which may be the [G], and with more [G] available only 2 are spent", () => {
  const { engine, id } = handshakeBoard({ greed: 5 });
  play(engine, P1, id("sh"), { selected: { c: [id("mine")] } });
  assert.equal(ready(engine), 3);
  assert.equal(attachedCount(engine, P1), 2);
});

clause(HANDSHAKE, "0:ability", "a character must be picked: playing it with no pick is refused", () => {
  const { engine, id } = handshakeBoard();
  assert.throws(() => playRaw(engine, P1, id("sh"), { selected: {} }));
  assert.throws(() => playRaw(engine, P1, id("sh"), { selected: { c: [] } }));
  assert.equal(zoneOf(engine, id("sh")), "hand");
});

clause(HANDSHAKE, "0:ability", "only ONE character is picked: two is refused", () => {
  const { engine, id } = handshakeBoard();
  assert.throws(() => playRaw(engine, P1, id("sh"), { selected: { c: [id("mine"), id("other")] } }));
  assert.equal(zoneOf(engine, id("sh")), "hand");
});

clause(HANDSHAKE, "0:ability", "the pick must be a character in play: an item, a location, a faction, a face-down resource, or a character in hand / discard are refused", () => {
  const { engine, id } = handshakeBoard({ greed: 4 }, [
    { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
    { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
    { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
    { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
    ...volition(1, P1).map((p) => ({ ...p, key: "downResource" }))
  ]);
  const attempt = (picked: string) => () => playRaw(engine, P1, id("sh"), { selected: { c: [picked] } });
  assert.throws(attempt(id("thing")), "item");
  assert.throws(attempt(id("place")), "location");
  assert.throws(attempt(factionOf(engine, P1)), "my faction (CR 202.9)");
  assert.throws(attempt(factionOf(engine, P2)), "their faction (CR 202.9)");
  assert.throws(attempt(id("downResource")), "a face-down card is only a resource");
  assert.throws(attempt(id("inHand")), "hand");
  assert.throws(attempt(id("inDiscard")), "discard pile");
  assert.equal(zoneOf(engine, id("sh")), "hand", "none of those attempts played the card");
  attempt(id("mine"))();
  assert.ok(engine.state.responseWindow, "a character pick is accepted");
});

// --- Selective Gluttony ----------------------------------------------------
// Draw 10 cards. Then, discard 9 cards. Tactic, cost 3, threshold [G][G][G].

const GLUTTONY = "769bc729-4357-41d8-a71a-e8b3679d2102";

function gluttonyBoard(opts: { deck?: number; hand?: number; icons?: Icons } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "sg", def: printing(GLUTTONY), owner: P1, zone: "hand" },
      ...handCards("h", opts.hand ?? 2, P1),
      ...deckCards("d", opts.deck ?? 14, P1),
      ...handCards("oh", 2, P2),
      ...deckCards("od", 5, P2),
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      ...res(opts.icons ?? { greed: 6 })
    ]
  });
}

clause(GLUTTONY, "0:rule", "pays 3, draws exactly the top 10 cards in order, then asks its controller to discard 9 cards", () => {
  const { engine, id } = gluttonyBoard();
  const before = ready(engine);
  const topTen = deckOf(engine, P1).slice(0, 10);
  const rest = deckOf(engine, P1).slice(10);
  play(engine, P1, id("sg"), {});
  assert.equal(before - ready(engine), 3, "the printed cost of 3 is paid");
  const pc = pending(engine);
  assert.ok(pc, "a discard choice is open");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I choose what to discard");
  for (const cardId of topTen) assert.equal(zoneOf(engine, cardId), "hand", "all of the top 10 cards were drawn before discarding");
  assert.deepEqual(deckOf(engine, P1), rest, "the rest of the deck is untouched and in order");
  assert.equal(handOf(engine, P1).length, 2 + 10, "hand: the 2 I held plus 10 drawn");
});

clause(GLUTTONY, "0:rule", "discards exactly the 9 cards the controller picks (mixing old hand cards and drawn ones); the remaining 3 stay in hand", () => {
  const { engine, id } = gluttonyBoard();
  const drawn = deckOf(engine, P1).slice(0, 10);
  play(engine, P1, id("sg"), {});
  const discard = [id("h0"), id("h1"), ...drawn.slice(0, 7)];
  const keep = drawn.slice(7);
  pickCards(engine, P1, discard);
  for (const cardId of discard) {
    assert.equal(zoneOf(engine, cardId), "discard", "a picked card is discarded");
    assert.ok(discardOf(engine, P1).includes(cardId), "...into its owner's discard pile");
  }
  for (const cardId of keep) assert.equal(zoneOf(engine, cardId), "hand", "an unpicked card stays in hand");
  assert.equal(handOf(engine, P1).length, 3, "2 + 10 - 9 = 3 cards left, so the net gain is 1 card after the tactic leaves the hand");
  assert.equal(zoneOf(engine, id("sg")), "discard", "the tactic ends in the discard pile");
  assert.equal(discardOf(engine, P1).length, 9 + 1, "9 discards and the tactic");
  assert.equal(pending(engine), undefined);
});

clause(GLUTTONY, "0:rule", "can discard only drawn cards, keeping the old hand (the choice is free)", () => {
  const { engine, id } = gluttonyBoard();
  const drawn = deckOf(engine, P1).slice(0, 10);
  play(engine, P1, id("sg"), {});
  pickCards(engine, P1, drawn.slice(0, 9));
  assert.equal(zoneOf(engine, id("h0")), "hand");
  assert.equal(zoneOf(engine, id("h1")), "hand");
  assert.equal(zoneOf(engine, drawn[9]), "hand");
});

clause(GLUTTONY, "0:rule", "exactly 9 must be discarded: 8, 10, duplicates, and cards not in my hand are refused", () => {
  const { engine, id } = gluttonyBoard();
  const drawn = deckOf(engine, P1).slice(0, 10);
  const stillInDeck = deckOf(engine, P1)[11];
  play(engine, P1, id("sg"), {});
  assert.throws(tryPick(engine, P1, drawn.slice(0, 8)), "8 cards is too few");
  assert.throws(tryPick(engine, P1, [...drawn, id("h0")]), "11 cards is too many");
  assert.throws(tryPick(engine, P1, [...drawn.slice(0, 8), drawn[0]]), "the same card twice");
  assert.throws(tryPick(engine, P1, [...drawn.slice(0, 8), stillInDeck]), "a card still in the deck is not in my hand");
  assert.throws(tryPick(engine, P1, [...drawn.slice(0, 8), id("oh0")]), "a card in the opponent's hand");
  assert.throws(tryPick(engine, P1, []), "discarding nothing is refused");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  pickCards(engine, P1, drawn.slice(0, 9));
  assert.equal(discardOf(engine, P1).length, 10);
});

clause(GLUTTONY, "0:rule", "only my own cards are affected: the opponent's hand, deck and discard pile are untouched", () => {
  const { engine, id } = gluttonyBoard();
  const oppHand = [...handOf(engine, P2)];
  const oppDeck = [...deckOf(engine, P2)];
  play(engine, P1, id("sg"), {});
  pickCards(engine, P1, handOf(engine, P1).slice(0, 9));
  assert.deepEqual(handOf(engine, P2), oppHand);
  assert.deepEqual(deckOf(engine, P2), oppDeck);
  assert.equal(discardOf(engine, P2).length, 0);
});

clause(GLUTTONY, "0:rule", "draw happens before discard: with an empty starting hand, 10 drawn cards are in hand and then 9 are discarded", () => {
  const { engine, id } = gluttonyBoard({ hand: 0 });
  play(engine, P1, id("sg"), {});
  assert.equal(handOf(engine, P1).length, 10);
  pickCards(engine, P1, handOf(engine, P1).slice(0, 9));
  assert.equal(handOf(engine, P1).length, 1);
});

clause(GLUTTONY, "0:rule", "a deck of exactly 10 cards is drawn out completely (and that is not a loss)", () => {
  const { engine, id } = gluttonyBoard({ deck: 10, hand: 0 });
  play(engine, P1, id("sg"), {});
  assert.equal(deckOf(engine, P1).length, 0);
  assert.equal(handOf(engine, P1).length, 10);
  pickCards(engine, P1, handOf(engine, P1).slice(0, 9));
  assert.equal(handOf(engine, P1).length, 1);
  assert.equal(engine.state.winner, undefined);
});

clause(GLUTTONY, "0:rule", "a deck of 4 cards: only 4 are drawn, and then 9 cards are discarded only as far as the hand allows (2 + 4 = 6 cards, all discarded)", () => {
  const { engine, id } = gluttonyBoard({ deck: 4, hand: 2 });
  play(engine, P1, id("sg"), {});
  assert.equal(deckOf(engine, P1).length, 0, "the whole short deck is drawn");
  assert.equal(handOf(engine, P1).length, 6);
  pickCards(engine, P1, [...handOf(engine, P1)]);
  assert.equal(handOf(engine, P1).length, 0, "a hand smaller than 9 is discarded entirely");
  assert.equal(pending(engine), undefined);
});

clause(GLUTTONY, "0:rule", "with an empty deck nothing is drawn and the discard still applies to the cards already in hand", () => {
  const { engine, id } = gluttonyBoard({ deck: 0, hand: 3 });
  play(engine, P1, id("sg"), {});
  assert.equal(handOf(engine, P1).length, 3);
  pickCards(engine, P1, [...handOf(engine, P1)]);
  assert.equal(handOf(engine, P1).length, 0);
  assert.equal(zoneOf(engine, id("sg")), "discard");
});

clause(GLUTTONY, "0:rule", "is refused one resource short of its cost of 3, and without [G][G][G] even with plenty of other resources", () => {
  const short = gluttonyBoard({ icons: { greed: 3 } });
  const shortBoard = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "sg", def: printing(GLUTTONY), owner: P1, zone: "hand" }, ...deckCards("d", 12, P1), ...res({ greed: 2 })]
  });
  assert.throws(() => playRaw(shortBoard.engine, P1, shortBoard.id("sg")), "2 resources: one short");
  assert.equal(zoneOf(shortBoard.engine, shortBoard.id("sg")), "hand");

  const twoGreed = gluttonyBoard({ icons: { greed: 2, rage: 6 } });
  assert.throws(() => playRaw(twoGreed.engine, P1, twoGreed.id("sg")), "only two [G]");
  assert.equal(zoneOf(twoGreed.engine, twoGreed.id("sg")), "hand");

  play(short.engine, P1, short.id("sg"), {});
  assert.equal(short.engine.state.pendingChoice?.kind, "chooserSelectsTarget", "exactly 3 resources with [G][G][G] is enough");
  assert.equal(ready(short.engine), 0);
});

clause(GLUTTONY, "0:rule", "with the threshold met by 3 greed and extra other resources, only 3 are spent", () => {
  const { engine, id } = gluttonyBoard({ icons: { greed: 3, rage: 3 } });
  play(engine, P1, id("sg"), {});
  assert.equal(ready(engine), 3);
  assert.equal(attachedCount(engine, P1), 3);
});

// --- Shocking Reappearance -------------------------------------------------
// COST: Play this only when you are blocking. Pick a character in your discard
// pile. -- EFFECT: Put the character into play under your control. Add the
// character to the blocking party. Tactic, cost 5, threshold [G][G][G].

const REAPPEARANCE = "b06ca42b-097e-4f1e-a28f-1994b264a2c2";

/** P2 is the active player and attacks P1's faction with `atk`; P1 holds the tactic. Returns before anyone responds. */
function reappearanceBoard(opts: { icons?: Icons; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sr", def: printing(REAPPEARANCE), owner: P1, zone: "hand" },
      { key: "corpse", def: character({ name: "Corpse", strength: 3, life: 4, speed: 2 }), owner: P1, zone: "discard" },
      { key: "corpse2", def: character({ name: "Corpse2", strength: 1, life: 1, speed: 2 }), owner: P1, zone: "discard" },
      { key: "oppCorpse", def: character({ name: "OppCorpse" }), owner: P2, zone: "discard" },
      { key: "itemCorpse", def: item({ name: "ItemCorpse" }), owner: P1, zone: "discard" },
      { key: "blk", def: character({ name: "Blk", strength: 1, life: 6, speed: 1 }), owner: P1, zone: "play" },
      { key: "idle", def: character({ name: "Idle", strength: 1, life: 6, speed: 1 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 2, life: 9, speed: 3 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { greed: 8 }),
      ...(opts.extra ?? [])
    ]
  });
}

/** Passes priority until it is `player`'s turn to respond in the open battle window. */
function untilPriority(engine: SpoilsEngine, player: PlayerId): void {
  let guard = 0;
  while (engine.state.responseWindow && engine.state.responseWindow.priorityPlayerId !== player) {
    assert.ok(guard++ < 10, "priority never reached the player");
    engine.perform({ type: "passPriority", playerId: engine.state.responseWindow.priorityPlayerId });
  }
}

/** The attack is declared, P1 declares `blockers`, and P1 has priority in the first damage window. */
function reachBlockingWindow(engine: SpoilsEngine, id: (key: string) => string, blockers: string[]) {
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: blockers });
  untilPriority(engine, P1);
}

clause(REAPPEARANCE, "0:ability", "while I am blocking: pays 5, puts the picked character from my discard pile into play under my control and adds it to the blocking party", () => {
  const { engine, id } = reappearanceBoard();
  reachBlockingWindow(engine, id, [id("blk")]);
  const before = ready(engine);
  engine.perform({ type: "playCard", playerId: P1, cardId: id("sr"), selected: { c: [id("corpse")] }, variables: {} } as never);
  resolvePendingResponses(engine);

  assert.equal(before - ready(engine), 5, "the printed cost of 5 is paid");
  assert.equal(zoneOf(engine, id("corpse")), "play", "the character is put into play");
  assert.equal(engine.state.cards[id("corpse")].controllerId, P1, "under my control");
  assert.equal(engine.state.cards[id("corpse")].ownerId, P1);
  assert.ok(battleOf(engine)?.blockingParty.includes(id("corpse")), "it is added to the blocking party");
  assert.ok(battleOf(engine)?.blockingParty.includes(id("blk")), "the original blocker is still blocking");
  assert.equal(battleOf(engine)?.blockingParty.length, 2);
  assert.equal(zoneOf(engine, id("sr")), "discard", "the tactic ends in its owner's discard pile");
  assert.equal(zoneOf(engine, id("corpse2")), "discard", "a character I did not pick stays in the discard pile");
});

clause(REAPPEARANCE, "0:ability", "the character is a real member of the blocking party: it takes the attacker's damage and deals its own strength in battle", () => {
  const { engine, id } = reappearanceBoard();
  reachBlockingWindow(engine, id, [id("blk")]);
  engine.perform({ type: "playCard", playerId: P1, cardId: id("sr"), selected: { c: [id("corpse")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  autoResolveBattle(engine, (source) => {
    // everyone aims at the first legal target with their full strength
    return source.legalTargets.length > 0 && source.strength > 0 ? [{ sourceId: source.cardId, target: source.legalTargets[0], amount: source.strength }] : [];
  });
  assert.equal(engine.state.battle, undefined, "the battle resolved");
  assert.equal(engine.state.cards[id("atk")].damage, 3 + 1, "the attacker took the reappeared character's 3 strength plus the other blocker's 1");
});

clause(REAPPEARANCE, "0:ability", "'play this only when you are blocking': refused when there is no battle at all", () => {
  const { engine, id } = reappearanceBoard();
  assert.throws(() => playRaw(engine, P1, id("sr"), { selected: { c: [id("corpse")] } }));
  assert.equal(zoneOf(engine, id("sr")), "hand");
  assert.equal(zoneOf(engine, id("corpse")), "discard");
});

clause(REAPPEARANCE, "0:ability", "'play this only when you are blocking': refused while I am being attacked but have not yet declared blockers", () => {
  const { engine, id } = reappearanceBoard();
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
  untilPriority(engine, P1);
  assert.throws(() => playRaw(engine, P1, id("sr"), { selected: { c: [id("corpse")] } }), "the attack was just declared: blocking has not happened");
  assert.equal(zoneOf(engine, id("corpse")), "discard");
});

clause(REAPPEARANCE, "0:ability", "'play this only when you are blocking': refused if I was attacked but declared no blockers", () => {
  const { engine, id } = reappearanceBoard();
  reachBlockingWindow(engine, id, []);
  assert.throws(() => playRaw(engine, P1, id("sr"), { selected: { c: [id("corpse")] } }), "I am not blocking");
  assert.equal(zoneOf(engine, id("corpse")), "discard");
  assert.equal(zoneOf(engine, id("sr")), "hand");
});

clause(REAPPEARANCE, "0:ability", "'play this only when you are blocking': refused when I am the attacker (my opponent is the one blocking)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "sr", def: printing(REAPPEARANCE), owner: P1, zone: "hand" },
      { key: "corpse", def: character({ name: "Corpse" }), owner: P1, zone: "discard" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      ...res({ greed: 8 })
    ]
  });
  declareAttackBy(engine, P1, [id("atk")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
  untilPriority(engine, P1);
  assert.throws(() => playRaw(engine, P1, id("sr"), { selected: { c: [id("corpse")] } }), "I am attacking, not blocking");
  assert.equal(zoneOf(engine, id("corpse")), "discard");
});

clause(REAPPEARANCE, "0:ability", "the pick must be a CHARACTER in MY discard pile: an item in my discard, a character in the opponent's discard, in my hand, or in play are refused", () => {
  const { engine, id } = reappearanceBoard({ extra: [{ key: "handChar", def: character({ name: "HandChar" }), owner: P1, zone: "hand" }] });
  reachBlockingWindow(engine, id, [id("blk")]);
  const attempt = (picked: string) => () => playRaw(engine, P1, id("sr"), { selected: { c: [picked] } });
  assert.throws(attempt(id("itemCorpse")), "an item in my discard pile");
  assert.throws(attempt(id("oppCorpse")), "a character in the opponent's discard pile");
  assert.throws(attempt(id("handChar")), "a character in my hand");
  assert.throws(attempt(id("idle")), "a character already in play");
  assert.throws(attempt(id("atk")), "the attacking character");
  assert.throws(attempt(factionOf(engine, P1)), "my faction");
  assert.throws(() => playRaw(engine, P1, id("sr"), { selected: {} }), "no pick at all");
  assert.throws(() => playRaw(engine, P1, id("sr"), { selected: { c: [id("corpse"), id("corpse2")] } }), "only one character is picked");
  assert.equal(zoneOf(engine, id("sr")), "hand", "none of those attempts played the card");
  attempt(id("corpse2"))();
  assert.ok(engine.state.responseWindow, "a character in my discard pile is accepted");
});

clause(REAPPEARANCE, "0:ability", "with no character in my discard pile the card cannot be played", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sr", def: printing(REAPPEARANCE), owner: P1, zone: "hand" },
      { key: "itemCorpse", def: item({ name: "ItemCorpse" }), owner: P1, zone: "discard" },
      { key: "blk", def: character({ name: "Blk", strength: 1, life: 6, speed: 1 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 2, life: 9, speed: 3 }), owner: P2, zone: "play" },
      ...res({ greed: 8 })
    ]
  });
  reachBlockingWindow(engine, id, [id("blk")]);
  assert.throws(() => playRaw(engine, P1, id("sr"), { selected: {} }));
  assert.throws(() => playRaw(engine, P1, id("sr"), { selected: { c: [id("itemCorpse")] } }));
  assert.equal(zoneOf(engine, id("sr")), "hand");
});

clause(REAPPEARANCE, "0:ability", "the character enters play for real: its 'enters play' trigger fires", () => {
  const enterer = character({
    name: "Enterer",
    strength: 1,
    life: 3,
    speed: 2,
    behavior: {
      abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }]
    }
  });
  const { engine, id } = reappearanceBoard({ extra: [{ key: "enterer", def: enterer, owner: P1, zone: "discard" }, ...deckCards("a", 3, P1)] });
  reachBlockingWindow(engine, id, [id("blk")]);
  const handBefore = handOf(engine, P1).length;
  engine.perform({ type: "playCard", playerId: P1, cardId: id("sr"), selected: { c: [id("enterer")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("enterer")), "play");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1, "the tactic left my hand; the entered character's trigger drew a card");
});

clause(REAPPEARANCE, "0:ability", "is refused one resource short of its cost of 5, and without [G][G][G] even with plenty of other resources", () => {
  const attemptWith = (icons: Icons) => {
    const { engine, id } = reappearanceBoard({ icons });
    reachBlockingWindow(engine, id, [id("blk")]);
    return { engine, id, run: () => playRaw(engine, P1, id("sr"), { selected: { c: [id("corpse")] } }) };
  };
  const short = attemptWith({ greed: 4 });
  assert.throws(short.run, "4 resources: one short");
  assert.equal(zoneOf(short.engine, short.id("sr")), "hand");
  const twoGreed = attemptWith({ greed: 2, rage: 6 });
  assert.throws(twoGreed.run, "only two [G]");
  const exact = attemptWith({ greed: 3, rage: 2 });
  exact.run();
  resolvePendingResponses(exact.engine);
  assert.equal(zoneOf(exact.engine, exact.id("corpse")), "play", "[G][G][G] and exactly 5 resources is enough");
  assert.equal(ready(exact.engine), 0);
});

// --- Skilled Negotiator ----------------------------------------------------
// HAGGLE -- COST: Deplete this card. Pick a character. -- EFFECT: This turn, the
// character loses 2 strength. Character, cost 2, threshold [G], 0 strength /
// 3 speed / 1 life, subtype lawyer.

const NEGOTIATOR = "f8e6dd2a-c288-4787-8f65-bad609973b6d";
const HAGGLE = "skilled-negotiator-haggle";

function negotiatorBoard(opts: { extra?: CardPlacement[]; resources?: Icons; turn?: number; activePlayerId?: PlayerId; attackEligible?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.activePlayerId,
    cards: [
      { key: "sn", def: printing(NEGOTIATOR), owner: P1, zone: "play", attackEligible: opts.attackEligible },
      { key: "mine", def: character({ name: "Mine", strength: 5, life: 6, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 5, life: 6, speed: 4 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 5, life: 6, speed: 4 }), owner: P2, zone: "play" },
      ...res(opts.resources ?? {}),
      ...(opts.extra ?? [])
    ]
  });
}

const haggle = (engine: SpoilsEngine, id: (key: string) => string, target: string, who = "sn") =>
  activate(engine, P1, id(who), HAGGLE, { selected: { target: [target] } });

clause(NEGOTIATOR, "0:ability:skilled-negotiator-haggle", "deploys for exactly 2 with [G], refused one short or without [G], and has its printed 0 strength / 1 life / 3 speed", () => {
  const board = (icons: Icons) =>
    buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "sn", def: printing(NEGOTIATOR), owner: P1, zone: "hand" }, ...res(icons)] });
  const short = board({ greed: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("sn")));
  const noThreshold = board({ rage: 6 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("sn")));
  const { engine, id } = board({ greed: 3 });
  const before = ready(engine);
  play(engine, P1, id("sn"));
  assert.equal(before - ready(engine), 2, "exactly the printed cost is paid");
  assert.equal(zoneOf(engine, id("sn")), "play");
  assert.equal(engine.getStat(id("sn"), "strength"), 0);
  assert.equal(engine.getStat(id("sn"), "life"), 1);
  assert.equal(engine.getStat(id("sn"), "speed"), 3);
  assert.deepEqual(engine.getSubtypes(id("sn")), ["lawyer"]);
});

clause(NEGOTIATOR, "0:ability:skilled-negotiator-haggle", "depletes this card as its cost and the picked character loses exactly 2 strength; nothing else about it, and no other character, changes", () => {
  const { engine, id } = negotiatorBoard({ resources: { rage: 3 } });
  haggle(engine, id, id("foe"));
  assert.equal(engine.state.cards[id("sn")].depleted, true, "COST: Deplete this card");
  assert.equal(engine.getStat(id("foe"), "strength"), 5 - 2);
  assert.equal(engine.getStat(id("foe"), "life"), 6, "only strength changes");
  assert.equal(engine.getStat(id("foe"), "speed"), 4, "only strength changes");
  assert.equal(engine.getStat(id("foe2"), "strength"), 5, "another opponent character is unaffected");
  assert.equal(engine.getStat(id("mine"), "strength"), 5, "my other character is unaffected");
  assert.equal(readyCount(engine, P1), 3, "no resources were needed or spent");
  assert.equal(attachedCount(engine, P1), 0);
});

clause(NEGOTIATOR, "0:ability:skilled-negotiator-haggle", "can pick one of my own characters, too", () => {
  const { engine, id } = negotiatorBoard();
  haggle(engine, id, id("mine"));
  assert.equal(engine.getStat(id("mine"), "strength"), 3);
  assert.equal(engine.getStat(id("foe"), "strength"), 5);
});

clause(NEGOTIATOR, "0:ability:skilled-negotiator-haggle", "can pick the Negotiator itself (it is a character in play; depleting it first does not remove it)", () => {
  const { engine, id } = negotiatorBoard();
  haggle(engine, id, id("sn"));
  assert.equal(engine.state.cards[id("sn")].depleted, true);
  assert.equal(engine.getStat(id("sn"), "strength") <= 0, true, "0 strength minus 2 stays at or below 0");
});

clause(NEGOTIATOR, "0:ability:skilled-negotiator-haggle", "the strength loss can be used to cut battle damage: a 5-strength unblocked attacker deals only 3 to my faction", () => {
  const { engine, id } = negotiatorBoard({ turn: 2, activePlayerId: P2 });
  const influence = engine.state.players[P1].influence;
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("foe")], target: { type: "faction", playerId: P1 } });
  // the attacker (P2) passes, then I respond
  untilPriority(engine, P1);
  activate(engine, P1, id("sn"), HAGGLE, { selected: { target: [id("foe")] } });
  untilPriority(engine, P1);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
  autoResolveBattle(engine);
  assert.equal(engine.state.players[P1].influence, influence - 3, "5 - 2 = 3 battle damage to my faction");
});

clause(NEGOTIATOR, "0:ability:skilled-negotiator-haggle", "the strength loss lasts this turn only", () => {
  const { engine, id } = negotiatorBoard();
  haggle(engine, id, id("foe"));
  assert.equal(engine.getStat(id("foe"), "strength"), 3, "reduced this turn");
  endTurn(engine, P1);
  assert.equal(engine.getStat(id("foe"), "strength"), 5, "back to normal in the next turn");
  endTurn(engine, P2);
  assert.equal(engine.getStat(id("foe"), "strength"), 5);
});

clause(NEGOTIATOR, "0:ability:skilled-negotiator-haggle", "two Negotiators on the same character stack: -4 strength", () => {
  const { engine, id } = negotiatorBoard({ extra: [{ key: "sn2", def: printing(NEGOTIATOR), owner: P1, zone: "play" }] });
  haggle(engine, id, id("foe"), "sn");
  haggle(engine, id, id("foe"), "sn2");
  assert.equal(engine.getStat(id("foe"), "strength"), 1);
});

clause(NEGOTIATOR, "0:ability:skilled-negotiator-haggle", "a character cannot lose more strength than it has: a 1-strength character that loses 2 has 0 strength, not -1 (CR 410.4)", () => {
  const { engine, id } = negotiatorBoard({ extra: [{ key: "weakling", def: character({ name: "Weakling", strength: 1, life: 3 }), owner: P2, zone: "play" }] });
  haggle(engine, id, id("weakling"));
  assert.equal(engine.getStat(id("weakling"), "strength"), 0);
});

clause(NEGOTIATOR, "0:ability:skilled-negotiator-haggle", "a character with exactly 2 strength drops to 0", () => {
  const { engine, id } = negotiatorBoard({ extra: [{ key: "two", def: character({ name: "Two", strength: 2, life: 3 }), owner: P2, zone: "play" }] });
  haggle(engine, id, id("two"));
  assert.equal(engine.getStat(id("two"), "strength"), 0);
});

clause(NEGOTIATOR, "0:ability:skilled-negotiator-haggle", "cannot be used while depleted (the cost is depleting it), and nothing changes", () => {
  const { engine, id } = negotiatorBoard();
  engine.state.cards[id("sn")].depleted = true;
  assert.throws(() => haggle(engine, id, id("foe")));
  assert.equal(engine.getStat(id("foe"), "strength"), 5);
});

clause(NEGOTIATOR, "0:ability:skilled-negotiator-haggle", "can be used once per untap: a second use the same turn is refused because it is already depleted", () => {
  const { engine, id } = negotiatorBoard();
  haggle(engine, id, id("foe"));
  assert.throws(() => haggle(engine, id, id("foe2")));
  assert.equal(engine.getStat(id("foe2"), "strength"), 5);
});

clause(NEGOTIATOR, "0:ability:skilled-negotiator-haggle", "can be used the turn it entered play (abilities have no summoning sickness)", () => {
  const { engine, id } = negotiatorBoard({ attackEligible: false });
  haggle(engine, id, id("foe"));
  assert.equal(engine.getStat(id("foe"), "strength"), 3);
});

clause(NEGOTIATOR, "0:ability:skilled-negotiator-haggle", "restores at the start of my next turn, so HAGGLE can be used again", () => {
  const { engine, id } = negotiatorBoard();
  haggle(engine, id, id("foe"));
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.cards[id("sn")].depleted, false, "restored by the Restore Rule");
  haggle(engine, id, id("foe2"));
  assert.equal(engine.getStat(id("foe2"), "strength"), 3);
});

clause(NEGOTIATOR, "0:ability:skilled-negotiator-haggle", "the pick must be a character in play: an item, a location, a faction, a face-down resource, or a character in hand are refused", () => {
  const { engine, id } = negotiatorBoard({
    extra: [
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "InHand", strength: 4 }), owner: P2, zone: "hand" },
      ...volition(1, P2).map((p) => ({ ...p, key: "downResource" }))
    ]
  });
  const attempt = (target: string) => () => haggle(engine, id, target);
  assert.throws(attempt(id("thing")), "item");
  assert.throws(attempt(id("place")), "location");
  assert.throws(attempt(factionOf(engine, P2)), "their faction (CR 202.9)");
  assert.throws(attempt(factionOf(engine, P1)), "my faction (CR 202.9)");
  assert.throws(attempt(id("downResource")), "face-down card");
  assert.throws(attempt(id("inHand")), "hand");
  assert.equal(engine.state.cards[id("sn")].depleted, false, "refused attempts do not deplete it");
  attempt(id("foe"))();
  assert.equal(engine.getStat(id("foe"), "strength"), 3, "a character in play is accepted");
});

clause(NEGOTIATOR, "0:ability:skilled-negotiator-haggle", "exactly one character must be picked: none or two are refused", () => {
  const { engine, id } = negotiatorBoard();
  assert.throws(() => activate(engine, P1, id("sn"), HAGGLE, { selected: {} }));
  assert.throws(() => activate(engine, P1, id("sn"), HAGGLE, { selected: { target: [] } }));
  assert.throws(() => activate(engine, P1, id("sn"), HAGGLE, { selected: { target: [id("foe"), id("foe2")] } }));
  assert.equal(engine.state.cards[id("sn")].depleted, false);
  assert.equal(engine.getStat(id("foe"), "strength"), 5);
});

clause(NEGOTIATOR, "0:ability:skilled-negotiator-haggle", "only its controller can use it: the opponent cannot activate my Negotiator", () => {
  const { engine, id } = negotiatorBoard();
  assert.throws(() =>
    engine.perform({ type: "activateAbility", playerId: P2, cardId: id("sn"), abilityId: HAGGLE, selected: { target: [id("mine")] }, variables: {} })
  );
  assert.equal(engine.getStat(id("mine"), "strength"), 5);
  assert.equal(engine.state.cards[id("sn")].depleted, false);
});

// --- Summary Judgment ------------------------------------------------------
// COST: Pick a character your opponent controls. X is that character's strength.
// -- EFFECT: Your opponent must pick one of the following: destroy the character
// or you draw X cards. Tactic, cost 4, threshold [G][G].

const JUDGMENT = "191e0731-b609-4ab3-a62b-8d6c21ed9e2b";

function judgmentBoard(opts: { icons?: Icons; deck?: number; foeStrength?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "sj", def: printing(JUDGMENT), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 4, life: 5 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: opts.foeStrength ?? 3, life: 5 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 2, life: 5 }), owner: P2, zone: "play" },
      ...deckCards("a", opts.deck ?? 6, P1),
      ...deckCards("b", 4, P2),
      ...handCards("h", 1, P1),
      ...handCards("oh", 2, P2),
      ...res(opts.icons ?? { greed: 6 }),
      ...(opts.extra ?? [])
    ]
  });
}

/** Plays Summary Judgment on `target` and leaves the opponent's decision open. */
function judgmentOn(engine: SpoilsEngine, id: (key: string) => string, target: string) {
  play(engine, P1, id("sj"), { selected: { c: [target] } });
  const pc = pending(engine);
  assert.ok(pc, "the opponent is asked to pick");
  assert.equal(pc.kind, "mayPay");
}

clause(JUDGMENT, "0:ability", "pays 4; the opponent picks 'destroy the character': it is destroyed and I draw nothing", () => {
  const { engine, id } = judgmentBoard();
  const before = ready(engine);
  const handBefore = handOf(engine, P1).length;
  const deckBefore = [...deckOf(engine, P1)];
  judgmentOn(engine, id, id("foe"));
  assert.equal(before - ready(engine), 4, "the printed cost of 4 is paid");
  answerChoice(engine, "mayPay", P2, { pay: true });
  assert.equal(zoneOf(engine, id("foe")), "discard", "the character is destroyed");
  assert.ok(discardOf(engine, P2).includes(id("foe")), "into its owner's discard pile");
  assert.equal(handOf(engine, P1).length, handBefore - 1, "I drew no cards (only the tactic left my hand)");
  assert.deepEqual(deckOf(engine, P1), deckBefore, "my deck is untouched");
  assert.equal(zoneOf(engine, id("foe2")), "play", "the other opponent character is untouched");
  assert.equal(zoneOf(engine, id("mine")), "play");
  assert.equal(zoneOf(engine, id("sj")), "discard", "the tactic ends in my discard pile");
  assert.equal(pending(engine), undefined);
});

clause(JUDGMENT, "0:ability", "the opponent picks 'I draw X cards' (declines to destroy): the character survives untouched and I draw X = its strength (3) cards from the top of my deck", () => {
  const { engine, id } = judgmentBoard();
  const topThree = deckOf(engine, P1).slice(0, 3);
  const handBefore = handOf(engine, P1).length;
  const oppHand = [...handOf(engine, P2)];
  const oppDeck = [...deckOf(engine, P2)];
  judgmentOn(engine, id, id("foe"));
  answerChoice(engine, "mayPay", P2, { pay: false });
  assert.equal(zoneOf(engine, id("foe")), "play", "not destroyed");
  assert.equal(engine.state.cards[id("foe")].damage, 0);
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 3, "I drew exactly 3");
  for (const cardId of topThree) assert.equal(zoneOf(engine, cardId), "hand", "the top 3 cards of my deck");
  assert.equal(deckOf(engine, P1).length, 3);
  assert.deepEqual(handOf(engine, P2), oppHand, "the opponent's hand is untouched");
  assert.deepEqual(deckOf(engine, P2), oppDeck, "the opponent's deck is untouched");
  assert.equal(zoneOf(engine, id("sj")), "discard");
});

for (const [strength, label] of [
  [1, "1"],
  [5, "5"]
] as const) {
  clause(JUDGMENT, "0:ability", `X is the picked character's strength: a ${label}-strength character means I draw ${label}`, () => {
    const { engine, id } = judgmentBoard({ foeStrength: strength, deck: 8 });
    const handBefore = handOf(engine, P1).length;
    judgmentOn(engine, id, id("foe"));
    answerChoice(engine, "mayPay", P2, { pay: false });
    assert.equal(handOf(engine, P1).length, handBefore - 1 + strength);
    assert.equal(deckOf(engine, P1).length, 8 - strength);
  });
}

clause(JUDGMENT, "0:ability", "X = 0 (a 0-strength character): declining to destroy draws nothing, and the character survives", () => {
  const { engine, id } = judgmentBoard({ foeStrength: 0 });
  const handBefore = handOf(engine, P1).length;
  judgmentOn(engine, id, id("foe"));
  answerChoice(engine, "mayPay", P2, { pay: false });
  assert.equal(handOf(engine, P1).length, handBefore - 1);
  assert.equal(zoneOf(engine, id("foe")), "play");
});

clause(JUDGMENT, "0:ability", "X is the character's CURRENT strength, including bonuses: a 3-strength character carrying +2 strength means X = 5", () => {
  const booster = item({ name: "Booster", behavior: { abilities: [{ id: "boost", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 2 }] }] }, attachTo: "character" });
  const { engine, id } = judgmentBoard({ deck: 8, extra: [{ key: "booster", def: booster, owner: P2, zone: "play", attachedToKey: "foe" }] });
  assert.equal(engine.getStat(id("foe"), "strength"), 5);
  const handBefore = handOf(engine, P1).length;
  judgmentOn(engine, id, id("foe"));
  answerChoice(engine, "mayPay", P2, { pay: false });
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 5);
});

clause(JUDGMENT, "0:ability", "X is fixed when the cost is paid: a strength bonus the opponent adds in response does not change how many cards I draw", () => {
  const buff = tactic({
    name: "Buff",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "buff",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "strength", operation: "add", value: 4, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });
  const { engine, id } = judgmentBoard({ deck: 10, extra: [{ key: "buff", def: buff, owner: P2, zone: "hand" }] });
  const handBefore = handOf(engine, P1).length;
  playRaw(engine, P1, id("sj"), { selected: { c: [id("foe")] } });
  // the opponent responds, before Summary Judgment resolves
  engine.perform({ type: "playCard", playerId: P2, cardId: id("buff"), selected: { t: [id("foe")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("foe"), "strength"), 7, "the response resolved first");
  answerChoice(engine, "mayPay", P2, { pay: false });
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 3, "X was 3 when the cost was paid");
});

clause(JUDGMENT, "0:ability", "a deck with fewer than X cards: I draw what is there (no loss for drawing from an empty deck)", () => {
  const { engine, id } = judgmentBoard({ deck: 2 });
  const handBefore = handOf(engine, P1).length;
  judgmentOn(engine, id, id("foe"));
  answerChoice(engine, "mayPay", P2, { pay: false });
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 2);
  assert.equal(deckOf(engine, P1).length, 0);
  assert.equal(engine.state.winner, undefined);
});

clause(JUDGMENT, "0:ability", "YOUR OPPONENT makes the pick, not me: the choice belongs to the opponent and I cannot answer it", () => {
  const { engine, id } = judgmentBoard();
  judgmentOn(engine, id, id("foe"));
  assert.equal(pending(engine)?.playerId, P2);
  assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "mayPay", pay: false } } as never), "I may not decide for my opponent");
  assert.equal(pending(engine)?.kind, "mayPay", "still waiting for the opponent");
  answerChoice(engine, "mayPay", P2, { pay: true });
  assert.equal(zoneOf(engine, id("foe")), "discard");
});

clause(JUDGMENT, "0:ability", "the opponent is asked even for a character of theirs that I own: the choice follows who CONTROLS the character", () => {
  const { engine, id } = judgmentBoard({ extra: [{ key: "stolen", def: character({ name: "Stolen", strength: 2, life: 4 }), owner: P1, zone: "play", controller: P2 }] });
  const handBefore = handOf(engine, P1).length;
  judgmentOn(engine, id, id("stolen"));
  assert.equal(pending(engine)?.playerId, P2, "its controller (my opponent) decides");
  answerChoice(engine, "mayPay", P2, { pay: false });
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 2, "X = 2");
  assert.equal(zoneOf(engine, id("stolen")), "play");
});

clause(JUDGMENT, "0:ability", "a character I own but my opponent controls, once destroyed, goes to MY discard pile (its owner's)", () => {
  const { engine, id } = judgmentBoard({ extra: [{ key: "stolen", def: character({ name: "Stolen", strength: 2, life: 4 }), owner: P1, zone: "play", controller: P2 }] });
  judgmentOn(engine, id, id("stolen"));
  answerChoice(engine, "mayPay", P2, { pay: true });
  assert.equal(zoneOf(engine, id("stolen")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("stolen")), "discardOf(engine, P1).includes(id(\"stolen\"))");
});

clause(JUDGMENT, "0:ability", "the pick must be a character my OPPONENT controls: my own character, a character I took from them, an item, a location, a faction, a face-down resource and a hand card are refused", () => {
  const { engine, id } = judgmentBoard({
    extra: [
      { key: "borrowed", def: character({ name: "Borrowed", strength: 2 }), owner: P2, zone: "play", controller: P1 },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...volition(1, P2).map((p) => ({ ...p, key: "downResource" }))
    ]
  });
  const attempt = (picked: string) => () => playRaw(engine, P1, id("sj"), { selected: { c: [picked] } });
  assert.throws(attempt(id("mine")), "my own character");
  assert.throws(attempt(id("borrowed")), "a character I control, even though they own it");
  assert.throws(attempt(id("thing")), "item");
  assert.throws(attempt(id("place")), "location");
  assert.throws(attempt(factionOf(engine, P2)), "their faction (CR 202.9)");
  assert.throws(attempt(factionOf(engine, P1)), "my faction");
  assert.throws(attempt(id("downResource")), "face-down card");
  assert.throws(attempt(id("oh0")), "a card in their hand");
  assert.throws(() => playRaw(engine, P1, id("sj"), { selected: {} }), "no pick");
  assert.throws(() => playRaw(engine, P1, id("sj"), { selected: { c: [id("foe"), id("foe2")] } }), "two picks");
  assert.equal(zoneOf(engine, id("sj")), "hand", "none of those attempts played the card");
  attempt(id("foe2"))();
  assert.ok(engine.state.responseWindow, "an opponent's character is accepted");
});

clause(JUDGMENT, "0:ability", "'destroy the character' is a normal destruction, so a Hidden Sandwich on the character replaces it: the Sandwich is destroyed instead and the character lives", () => {
  const { engine, id } = judgmentBoard({
    extra: [{ key: "sandwich", def: printing("a4396480-efb3-4382-bf85-51331246e5c7"), owner: P2, zone: "play", attachedToKey: "foe" }]
  });
  const handBefore = handOf(engine, P1).length;
  judgmentOn(engine, id, id("foe"));
  answerChoice(engine, "mayPay", P2, { pay: true });
  assert.equal(zoneOf(engine, id("foe")), "play", "the replacement saved the character");
  assert.equal(zoneOf(engine, id("sandwich")), "discard", "the Sandwich was destroyed instead");
  assert.equal(handOf(engine, P1).length, handBefore - 1, "the opponent chose destroy, so I draw nothing");
});

clause(JUDGMENT, "0:ability", "cannot be played when my opponent controls no character", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "sj", def: printing(JUDGMENT), owner: P1, zone: "hand" }, { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" }, ...res({ greed: 6 })]
  });
  assert.throws(() => playRaw(engine, P1, id("sj"), { selected: { c: [id("mine")] } }));
  assert.throws(() => playRaw(engine, P1, id("sj"), { selected: {} }));
  assert.equal(zoneOf(engine, id("sj")), "hand");
});

clause(JUDGMENT, "0:ability", "is refused one resource short of its cost of 4, and without [G][G] even with plenty of other resources", () => {
  const attempt = (icons: Icons) => {
    const board = judgmentBoard({ icons });
    return { ...board, run: () => playRaw(board.engine, P1, board.id("sj"), { selected: { c: [board.id("foe")] } }) };
  };
  const short = attempt({ greed: 3 });
  assert.throws(short.run, "3 resources");
  assert.equal(zoneOf(short.engine, short.id("sj")), "hand");
  const oneGreed = attempt({ greed: 1, rage: 7 });
  assert.throws(oneGreed.run, "only one [G]");
  const exact = attempt({ greed: 2, rage: 2 });
  exact.run();
  assert.ok(exact.engine.state.responseWindow, "[G][G] and exactly 4 resources is enough");
  resolvePendingResponses(exact.engine);
  assert.equal(ready(exact.engine), 0);
});

// --- Tax Attorney ----------------------------------------------------------
// If your faction loses any amount of influence, reduce the amount by 1.
// Character, cost 2, threshold [G][G], 1 strength / 3 speed / 2 life, lawyer + mau.

const ATTORNEY = "95c0d8b9-11b3-48e6-a8c5-58fd53ca93dd";

/** A free tactic: `who` loses `amount` influence (the "loses N influence" effect, not damage). */
const bleedTactic = (name: string, amount: number, who: "controller" | "opponent"): CardDefinition =>
  tactic({ name, cost: 0, behavior: { abilities: [{ id: "bleed", type: "activated", effects: [{ type: "modifyInfluence", player: who, amount: -amount }] }] } });

/** A free tactic: its controller gains `amount` influence. */
const gainTactic = (name: string, amount: number): CardDefinition =>
  tactic({ name, cost: 0, behavior: { abilities: [{ id: "gain", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount }] }] } });

/** A free tactic dealing `amount` damage to a chosen faction (id `blast`, declaration `t`). */
const blastTactic = (name: string, amount: number): CardDefinition =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "blast",
          type: "activated",
          targets: [{ id: "t", selector: { type: "faction" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });

function attorneyBoard(opts: { extra?: CardPlacement[]; attorneyZone?: "play" | "hand" | "discard"; faceDown?: boolean; influence?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: opts.influence ?? 20 },
    playerB: { faction: developFaction(), influence: 20 },
    cards: [
      { key: "ta", def: printing(ATTORNEY), owner: P1, zone: opts.attorneyZone ?? "play", faceDown: opts.faceDown },
      { key: "bleed1", def: bleedTactic("Bleed1", 1, "controller"), owner: P1, zone: "hand" },
      { key: "bleed2", def: bleedTactic("Bleed2", 2, "controller"), owner: P1, zone: "hand" },
      { key: "bleed5", def: bleedTactic("Bleed5", 5, "controller"), owner: P1, zone: "hand" },
      { key: "bleedOpp3", def: bleedTactic("BleedOpp3", 3, "opponent"), owner: P1, zone: "hand" },
      { key: "gain3", def: gainTactic("Gain3", 3), owner: P1, zone: "hand" },
      { key: "blast4", def: blastTactic("Blast4", 4), owner: P1, zone: "hand" },
      { key: "blast1", def: blastTactic("Blast1", 1), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 4, life: 5, speed: 2 }), owner: P2, zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}

const influenceOf = (engine: SpoilsEngine, player: PlayerId) => engine.state.players[player].influence;

for (const [amount, key, expected] of [
  [1, "bleed1", 0],
  [2, "bleed2", 1],
  [5, "bleed5", 4]
] as const) {
  clause(ATTORNEY, "0:rule", `a ${amount}-influence loss ("loses N influence") costs my faction ${expected}`, () => {
    const { engine, id } = attorneyBoard();
    play(engine, P1, id(key), {});
    assert.equal(influenceOf(engine, P1), 20 - expected);
  });
}

clause(ATTORNEY, "0:rule", "control: without the Tax Attorney a 2-influence loss costs the full 2", () => {
  const { engine, id } = attorneyBoard({ attorneyZone: "hand" });
  play(engine, P1, id("bleed2"), {});
  assert.equal(influenceOf(engine, P1), 18);
});

clause(ATTORNEY, "0:rule", "the reduction never turns a loss into a gain: a 1-influence loss is reduced to 0, not below", () => {
  const { engine, id } = attorneyBoard();
  play(engine, P1, id("bleed1"), {});
  assert.equal(influenceOf(engine, P1), 20);
});

clause(ATTORNEY, "0:rule", "damage to my faction is influence loss too: 4 damage to my faction costs 3 influence, 1 damage costs 0", () => {
  const { engine, id } = attorneyBoard();
  play(engine, P1, id("blast4"), { selected: { t: [factionOf(engine, P1)] } });
  assert.equal(influenceOf(engine, P1), 20 - 3);
  play(engine, P1, id("blast1"), { selected: { t: [factionOf(engine, P1)] } });
  assert.equal(influenceOf(engine, P1), 20 - 3, "1 damage, reduced by 1, loses nothing");
});

clause(ATTORNEY, "0:rule", "battle damage to my faction: an unblocked 4-strength attacker takes only 3 influence", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ta", def: printing(ATTORNEY), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 4, life: 5, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  fight(engine, P2, [id("foe")], { type: "faction", playerId: P1 }, []);
  assert.equal(influenceOf(engine, P1), 20 - 3, "4 battle damage, reduced by 1");
});

clause(ATTORNEY, "0:rule", "battle damage of exactly 1 to my faction costs 0 influence", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ta", def: printing(ATTORNEY), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  fight(engine, P2, [id("foe")], { type: "faction", playerId: P1 }, []);
  assert.equal(influenceOf(engine, P1), 20);
});

clause(ATTORNEY, "0:rule", "my opponent's faction takes the full battle damage (the Attorney does not protect it)", () => {
  const { engine, id } = attorneyBoard();
  fight(engine, P1, [id("mine")], { type: "faction", playerId: P2 }, []);
  assert.equal(influenceOf(engine, P2), 20 - 1);
});

clause(ATTORNEY, "0:rule", "it applies once per loss: two separate losses of 2 each cost 1 each (2 in total)", () => {
  const { engine, id } = attorneyBoard({ extra: [{ key: "bleed2b", def: bleedTactic("Bleed2b", 2, "controller"), owner: P1, zone: "hand" }] });
  play(engine, P1, id("bleed2"), {});
  play(engine, P1, id("bleed2b"), {});
  assert.equal(influenceOf(engine, P1), 20 - 2);
});

clause(ATTORNEY, "0:rule", "gaining influence is not affected", () => {
  const { engine, id } = attorneyBoard();
  play(engine, P1, id("gain3"), {});
  assert.equal(influenceOf(engine, P1), 23);
});

clause(ATTORNEY, "0:rule", "only MY faction: my opponent's faction loses the full amount", () => {
  const { engine, id } = attorneyBoard();
  play(engine, P1, id("bleedOpp3"), {});
  assert.equal(influenceOf(engine, P2), 20 - 3);
  assert.equal(influenceOf(engine, P1), 20);
});

clause(ATTORNEY, "0:rule", "my opponent's faction takes full damage from an effect too", () => {
  const { engine, id } = attorneyBoard();
  play(engine, P1, id("blast4"), { selected: { t: [factionOf(engine, P2)] } });
  assert.equal(influenceOf(engine, P2), 20 - 4);
});

clause(ATTORNEY, "0:rule", "an Attorney controlled by my opponent protects THEIR faction and not mine", () => {
  const { engine, id } = attorneyBoard({ attorneyZone: "hand", extra: [{ key: "ta2", def: printing(ATTORNEY), owner: P2, zone: "play" }] });
  play(engine, P1, id("bleedOpp3"), {});
  assert.equal(influenceOf(engine, P2), 20 - 2, "their Attorney reduces their loss");
  play(engine, P1, id("bleed2"), {});
  assert.equal(influenceOf(engine, P1), 20 - 2, "my faction has no Attorney: full loss");
});

clause(ATTORNEY, "0:rule", "'your faction' is the controller's: an Attorney I own but my opponent controls protects them, not me", () => {
  const { engine, id } = attorneyBoard({ attorneyZone: "hand", extra: [{ key: "ta2", def: printing(ATTORNEY), owner: P1, zone: "play", controller: P2 }] });
  play(engine, P1, id("bleed2"), {});
  assert.equal(influenceOf(engine, P1), 20 - 2, "I do not control it, so it does not protect me");
  play(engine, P1, id("bleedOpp3"), {});
  assert.equal(influenceOf(engine, P2), 20 - 2, "its controller's faction is protected");
});

clause(ATTORNEY, "0:rule", "two Tax Attorneys both apply: a 5-influence loss costs 3", () => {
  const { engine, id } = attorneyBoard({ extra: [{ key: "ta2", def: printing(ATTORNEY), owner: P1, zone: "play" }] });
  play(engine, P1, id("bleed5"), {});
  assert.equal(influenceOf(engine, P1), 20 - 3);
});

clause(ATTORNEY, "0:rule", "off in hand and in the discard pile", () => {
  for (const zone of ["hand", "discard"] as const) {
    const { engine, id } = attorneyBoard({ attorneyZone: zone });
    play(engine, P1, id("bleed2"), {});
    assert.equal(influenceOf(engine, P1), 18, zone);
  }
});

clause(ATTORNEY, "0:rule", "off while it is a face-down resource (a face-down card has no rules text)", () => {
  const { engine, id } = attorneyBoard({ faceDown: true });
  play(engine, P1, id("bleed2"), {});
  assert.equal(influenceOf(engine, P1), 18);
});

clause(ATTORNEY, "0:rule", "off again once the Attorney leaves play (destroyed)", () => {
  const { engine, id } = attorneyBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("bleed2"), {});
  assert.equal(influenceOf(engine, P1), 19, "with the Attorney");
  play(engine, P1, id("kill"), { selected: { t: [id("ta")] } });
  assert.equal(zoneOf(engine, id("ta")), "discard");
  play(engine, P1, id("bleed5"), {});
  assert.equal(influenceOf(engine, P1), 19 - 5, "full loss once it is gone");
});

clause(ATTORNEY, "0:rule", "it can save a faction: at 3 influence a 3-influence loss leaves 1 and the game continues, while without the Attorney the same loss is lethal", () => {
  const withAttorney = attorneyBoard({ influence: 3, extra: [{ key: "bleed3", def: bleedTactic("Bleed3", 3, "controller"), owner: P1, zone: "hand" }] });
  play(withAttorney.engine, P1, withAttorney.id("bleed3"), {});
  assert.equal(influenceOf(withAttorney.engine, P1), 1);
  assert.equal(withAttorney.engine.state.winner, undefined, "still in the game");

  const without = attorneyBoard({ influence: 3, attorneyZone: "hand", extra: [{ key: "bleed3", def: bleedTactic("Bleed3", 3, "controller"), owner: P1, zone: "hand" }] });
  play(without.engine, P1, without.id("bleed3"), {});
  assert.equal(influenceOf(without.engine, P1), 0);
  assert.equal(without.engine.state.winner, P2, "control: with no Attorney the same loss is lethal");
});

clause(ATTORNEY, "0:rule", "influence my faction loses as an ability COST ('your faction loses N influence') is a loss too, so it is reduced by 1", () => {
  const toll = character({
    name: "Toll Collector",
    strength: 1,
    life: 3,
    behavior: { abilities: [{ id: "toll", type: "activated", costs: [{ type: "loseInfluence", amount: 3 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const { engine, id } = attorneyBoard({ extra: [{ key: "toll", def: toll, owner: P1, zone: "play" }, ...deckCards("a", 2, P1)] });
  activate(engine, P1, id("toll"), "toll");
  assert.equal(influenceOf(engine, P1), 20 - 2, "the faction lost 3 influence as a cost: reduced by 1");
});

clause(ATTORNEY, "0:rule", "deploys for exactly 2 with [G][G] (refused one short or with one [G]) and has its printed 1 strength / 2 life / 3 speed", () => {
  const board = (icons: Icons) =>
    buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "ta", def: printing(ATTORNEY), owner: P1, zone: "hand" }, ...res(icons)] });
  const short = board({ greed: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("ta")), "one resource");
  const oneGreed = board({ greed: 1, rage: 4 });
  assert.throws(() => playRaw(oneGreed.engine, P1, oneGreed.id("ta")), "only one [G]");
  const { engine, id } = board({ greed: 4 });
  play(engine, P1, id("ta"));
  assert.equal(ready(engine), 2, "exactly 2 spent");
  assert.equal(engine.getStat(id("ta"), "strength"), 1);
  assert.equal(engine.getStat(id("ta"), "life"), 2);
  assert.equal(engine.getStat(id("ta"), "speed"), 3);
  assert.deepEqual([...engine.getSubtypes(id("ta"))].sort(), ["lawyer", "mau"]);
});

// --- The Ministry of Other Smaller Ministries ------------------------------
// Your opponent cannot attack unless they pay 2 for each party.
// Location, cost 3, threshold [G][G], structure 5.

const MINISTRY = "c8f335c2-c065-4e48-befe-ce99752073f1";

/** P2 (the attacker, turn 2) has `rage` ready resources and four 1-strength attackers; P1 controls the Ministry (unless told otherwise). */
function ministryBoard(opts: { rage?: number; ministry?: "play" | "hand" | "none" | "faceDown"; ministryController?: PlayerId; ministryOwner?: PlayerId; extra?: CardPlacement[]; attacker?: PlayerId; p1Resources?: number } = {}) {
  const attacker = opts.attacker ?? P2;
  const defender = attacker === P1 ? P2 : P1;
  const where = opts.ministry ?? "play";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: attacker,
    cards: [
      ...(where === "none"
        ? []
        : [
            {
              key: "min",
              def: printing(MINISTRY),
              owner: opts.ministryOwner ?? opts.ministryController ?? defender,
              controller: opts.ministryController ?? defender,
              zone: where === "hand" ? ("hand" as const) : ("play" as const),
              faceDown: where === "faceDown"
            }
          ]),
      ...["a1", "a2", "a3", "a4"].map((key) => ({ key, def: character({ name: key, strength: 1, life: 5, speed: 2 }), owner: attacker, zone: "play" as const })),
      { key: "def1", def: character({ name: "Def1", strength: 1, life: 5, speed: 2 }), owner: defender, zone: "play" },
      { key: "town", def: location({ name: "Town", structure: 9 }), owner: defender, zone: "play" },
      ...res({ rage: opts.rage ?? 5 }, attacker),
      ...res({ rage: opts.p1Resources ?? 0 }, defender),
      ...(opts.extra ?? [])
    ]
  });
}

const attack = (engine: SpoilsEngine, who: PlayerId, ids: string[], target?: { type: "faction"; playerId: PlayerId } | { type: "card"; cardId: string }) =>
  declareAttackBy(engine, who, ids, target);

clause(MINISTRY, "0:rule", "my opponent's attack is legal if they pay 2: exactly 2 of their ready resources are spent (attached to their faction)", () => {
  const { engine, id } = ministryBoard({ rage: 5 });
  attack(engine, P2, [id("a1")]);
  assert.ok(battleOf(engine), "the attack was declared");
  assert.equal(ready(engine, P2), 3, "2 of 5 resources were paid");
  assert.equal(attachedCount(engine, P2), 2, "...by attaching them to the faction");
  assert.equal(engine.state.cards[id("a1")].depleted, true, "the attacker is depleted as usual");
});

clause(MINISTRY, "0:rule", "the cost is 2 per PARTY, not per attacker: a party of three attackers pays 2 in total", () => {
  const { engine, id } = ministryBoard({ rage: 5 });
  attack(engine, P2, [id("a1"), id("a2"), id("a3")]);
  assert.equal(battleOf(engine)?.attackingParty.length, 3);
  assert.equal(ready(engine, P2), 3, "one party, 2 paid");
});

clause(MINISTRY, "0:rule", "an attack with only 3 ready resources and a party of four is also just 2", () => {
  const { engine, id } = ministryBoard({ rage: 2 });
  attack(engine, P2, [id("a1"), id("a2"), id("a3"), id("a4")]);
  assert.equal(ready(engine, P2), 0);
  assert.equal(battleOf(engine)?.attackingParty.length, 4);
});

clause(MINISTRY, "0:rule", "each party pays: a second attack in the same turn costs another 2, and a third is refused when only 1 resource is left", () => {
  const { engine, id } = ministryBoard({ rage: 5 });
  fight(engine, P2, [id("a1")], { type: "faction", playerId: P1 }, []);
  assert.equal(ready(engine, P2), 3, "first party paid 2");
  fight(engine, P2, [id("a2")], { type: "faction", playerId: P1 }, []);
  assert.equal(ready(engine, P2), 1, "second party paid 2 more");
  assert.throws(() => attack(engine, P2, [id("a3")]), "only 1 resource left: cannot pay 2");
  assert.equal(engine.state.cards[id("a3")].depleted, false, "the refused attacker is not depleted");
  assert.equal(battleOf(engine), undefined);
  assert.equal(ready(engine, P2), 1, "nothing was paid");
});

clause(MINISTRY, "0:rule", "cannot attack at all with 1 ready resource, or with none; the refused attack changes nothing", () => {
  for (const rage of [1, 0]) {
    const { engine, id } = ministryBoard({ rage });
    assert.throws(() => attack(engine, P2, [id("a1")]), `${rage} resources`);
    assert.equal(battleOf(engine), undefined, "no battle");
    assert.equal(engine.state.cards[id("a1")].depleted, false, "the attacker is not depleted");
    assert.equal(ready(engine, P2), rage, "nothing was paid");
    assert.equal(engine.state.responseWindow, undefined);
  }
});

clause(MINISTRY, "0:rule", "exactly 2 ready resources is enough", () => {
  const { engine, id } = ministryBoard({ rage: 2 });
  attack(engine, P2, [id("a1")]);
  assert.ok(battleOf(engine), "battleOf(engine)");
  assert.equal(ready(engine, P2), 0);
});

clause(MINISTRY, "0:rule", "only UNSPENT resources can pay: 5 resources of which 4 are already attached leave just 1, so the attack is refused", () => {
  const { engine, id } = ministryBoard({ rage: 1, extra: spentResources(P2, 4) });
  assert.equal(engine.state.players[P2].play.filter((c) => engine.isResource(c)).length, 5);
  assert.equal(ready(engine, P2), 1);
  assert.throws(() => attack(engine, P2, [id("a1")]));
  assert.equal(battleOf(engine), undefined);
});

clause(MINISTRY, "0:rule", "a face-down resource can pay the 2 as well as a face-up one", () => {
  const { engine, id } = ministryBoard({ rage: 0, extra: volition(2, P2) });
  attack(engine, P2, [id("a1")]);
  assert.ok(battleOf(engine), "battleOf(engine)");
  assert.equal(ready(engine, P2), 0);
});

clause(MINISTRY, "0:rule", "the tax applies to attacks on a location as well as on the faction", () => {
  const poor = ministryBoard({ rage: 1 });
  assert.throws(() => attack(poor.engine, P2, [poor.id("a1")], { type: "card", cardId: poor.id("min") }), "cannot pay for an attack on the Ministry itself");
  assert.throws(() => attack(poor.engine, P2, [poor.id("a1")], { type: "card", cardId: poor.id("town") }), "cannot pay for an attack on another location");
  const rich = ministryBoard({ rage: 4 });
  attack(rich.engine, P2, [rich.id("a1")], { type: "card", cardId: rich.id("town") });
  assert.ok(battleOf(rich.engine), "battleOf(rich.engine)");
  assert.equal(ready(rich.engine, P2), 2, "2 paid for the attack on a location");
});

clause(MINISTRY, "0:rule", "it is MY opponent who pays: when I attack, I pay nothing", () => {
  const { engine, id } = ministryBoard({ attacker: P1, ministryController: P1, rage: 0, p1Resources: 0, extra: [] });
  // P1 controls the Ministry and attacks P2: no resources at all, and the attack is still legal
  attack(engine, P1, [id("a1")]);
  assert.ok(battleOf(engine), "my own Ministry does not tax me");
});

clause(MINISTRY, "0:rule", "with a few resources, my attack through my own Ministry spends none of them", () => {
  const { engine, id } = ministryBoard({ attacker: P1, ministryController: P1, rage: 4 });
  attack(engine, P1, [id("a1")]);
  assert.equal(ready(engine, P1), 4);
});

clause(MINISTRY, "0:rule", "a Ministry controlled by the OTHER player taxes me: I must pay 2 to attack, while they attack free", () => {
  const taxed = ministryBoard({ attacker: P1, ministryController: P2, rage: 3 });
  attack(taxed.engine, P1, [taxed.id("a1")]);
  assert.equal(ready(taxed.engine, P1), 1, "I paid 2");
  const broke = ministryBoard({ attacker: P1, ministryController: P2, rage: 1 });
  assert.throws(() => attack(broke.engine, P1, [broke.id("a1")]));
  assert.equal(battleOf(broke.engine), undefined);
});

clause(MINISTRY, "0:rule", "'your opponent' follows control: a Ministry I own but my opponent controls taxes ME, not them", () => {
  const mine = ministryBoard({ attacker: P1, ministryOwner: P1, ministryController: P2, rage: 3 });
  attack(mine.engine, P1, [mine.id("a1")]);
  assert.equal(ready(mine.engine, P1), 1, "its controller's opponent (me) pays");
  const theirs = ministryBoard({ attacker: P2, ministryOwner: P1, ministryController: P2, rage: 3 });
  attack(theirs.engine, P2, [theirs.id("a1")]);
  assert.equal(ready(theirs.engine, P2), 3, "its controller attacks for free");
});

clause(MINISTRY, "0:rule", "control: with no Ministry in play the same attack is free", () => {
  const { engine, id } = ministryBoard({ ministry: "none", rage: 0 });
  attack(engine, P2, [id("a1")]);
  assert.ok(battleOf(engine), "battleOf(engine)");
  assert.equal(ready(engine, P2), 0);
});

clause(MINISTRY, "0:rule", "off in hand and when it is a face-down resource (no rules text)", () => {
  for (const where of ["hand", "faceDown"] as const) {
    const { engine, id } = ministryBoard({ ministry: where, rage: 0 });
    attack(engine, P2, [id("a1")]);
    assert.ok(battleOf(engine), where);
  }
});

clause(MINISTRY, "0:rule", "the tax stops once the Ministry is destroyed", () => {
  const { engine, id } = ministryBoard({ rage: 1, extra: [{ key: "kill", def: killAnyTactic("location"), owner: P1, zone: "hand" }, ...res({ rage: 2 }, P1)] });
  assert.throws(() => attack(engine, P2, [id("a1")]), "taxed while the Ministry stands");
  // P1 cannot act on P2's turn without a response window; end P2's turn, then P1 kills its own Ministry in its turn
  endTurn(engine, P2);
  play(engine, P1, id("kill"), { selected: { t: [id("min")] } });
  assert.equal(zoneOf(engine, id("min")), "discard");
  endTurn(engine, P1);
  engine.state.cards[id("a1")].attackEligibleTurn = engine.state.turn;
  attack(engine, P2, [id("a1")]);
  assert.ok(battleOf(engine), "without the Ministry the attack is free");
});

clause(MINISTRY, "0:rule", "two Ministries each demand 2: the opponent needs 4 (3 is not enough)", () => {
  const extra = [{ key: "min2", def: printing(MINISTRY), owner: P1, zone: "play" } as CardPlacement];
  const three = ministryBoard({ rage: 3, extra });
  assert.throws(() => attack(three.engine, P2, [three.id("a1")]));
  const four = ministryBoard({ rage: 4, extra });
  attack(four.engine, P2, [four.id("a1")]);
  assert.equal(ready(four.engine, P2), 0, "2 + 2 paid");
});

clause(MINISTRY, "0:rule", "paying does not stop my opponent's other options: after a taxed attack is blocked, the battle resolves as normal", () => {
  const { engine, id } = ministryBoard({ rage: 2 });
  fight(engine, P2, [id("a1")], { type: "faction", playerId: P1 }, [id("def1")]);
  assert.equal(engine.state.battle, undefined, "the battle finished");
  assert.equal(engine.state.cards[id("def1")].damage, 1);
});

clause(MINISTRY, "0:rule", "deploys for exactly 3 with [G][G] (refused one short or with one [G]) and is destroyed by 5 damage, not 4 (structure 5)", () => {
  const board = (icons: Icons) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "min", def: printing(MINISTRY), owner: P1, zone: "hand" },
        { key: "z4", def: tactic({ name: "Z4", cost: 0, behavior: { abilities: [{ id: "z", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 4 }] }] } }), owner: P1, zone: "hand" },
        { key: "z1", def: tactic({ name: "Z1", cost: 0, behavior: { abilities: [{ id: "z", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }] }] } }), owner: P1, zone: "hand" },
        ...res(icons)
      ]
    });
  const short = board({ greed: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("min")));
  const oneGreed = board({ greed: 1, rage: 5 });
  assert.throws(() => playRaw(oneGreed.engine, P1, oneGreed.id("min")));
  const { engine, id } = board({ greed: 4 });
  play(engine, P1, id("min"));
  assert.equal(zoneOf(engine, id("min")), "play");
  assert.equal(ready(engine), 1, "exactly 3 spent");
  play(engine, P1, id("z4"), { selected: { t: [id("min")] } });
  assert.equal(zoneOf(engine, id("min")), "play", "4 damage does not destroy a structure-5 location");
  play(engine, P1, id("z1"), { selected: { t: [id("min")] } });
  assert.equal(zoneOf(engine, id("min")), "discard", "5 damage destroys it");
});

// --- Union Leader ----------------------------------------------------------
// No rules text. Character, cost 7, threshold [G][G], 5 strength / 3 speed /
// 9 life, subtype mau.

const UNION_LEADER = "729e403d-9a3d-436a-b9db-ca6c15d87120";

function unionLeaderBoard(icons: Icons) {
  return buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "ul", def: printing(UNION_LEADER), owner: P1, zone: "hand" }, ...res(icons)] });
}

clause(UNION_LEADER, "vanilla", "deploys for exactly its printed cost of 7 with [G][G], and spends no more", () => {
  const { engine, id } = unionLeaderBoard({ greed: 2, rage: 6 });
  assert.equal(ready(engine), 8);
  play(engine, P1, id("ul"));
  assert.equal(zoneOf(engine, id("ul")), "play");
  assert.equal(ready(engine), 1, "exactly 7 resources were spent");
  assert.equal(attachedCount(engine, P1), 7);
});

clause(UNION_LEADER, "vanilla", "is refused one resource short (6 resources, even all greed)", () => {
  const { engine, id } = unionLeaderBoard({ greed: 6 });
  assert.throws(() => playRaw(engine, P1, id("ul")));
  assert.equal(zoneOf(engine, id("ul")), "hand");
  assert.equal(ready(engine), 6, "nothing was spent");
});

clause(UNION_LEADER, "vanilla", "is refused without [G][G]: one [G] among plenty of other resources is not enough", () => {
  const oneGreed = unionLeaderBoard({ greed: 1, rage: 8 });
  assert.throws(() => playRaw(oneGreed.engine, P1, oneGreed.id("ul")));
  const noGreed = unionLeaderBoard({ elitism: 9 });
  assert.throws(() => playRaw(noGreed.engine, P1, noGreed.id("ul")));
  assert.equal(zoneOf(noGreed.engine, noGreed.id("ul")), "hand");
});

clause(UNION_LEADER, "vanilla", "plays with exactly [G][G] plus 5 other resources", () => {
  const { engine, id } = unionLeaderBoard({ greed: 2, deception: 5 });
  play(engine, P1, id("ul"));
  assert.equal(zoneOf(engine, id("ul")), "play");
  assert.equal(ready(engine), 0);
});

clause(UNION_LEADER, "vanilla", "has its printed stats in play: 5 strength, 9 life, 3 speed, subtype mau, and no keywords or abilities", () => {
  const { engine, id } = unionLeaderBoard({ greed: 7 });
  play(engine, P1, id("ul"));
  assert.equal(engine.getStat(id("ul"), "strength"), 5);
  assert.equal(engine.getStat(id("ul"), "life"), 9);
  assert.equal(engine.getStat(id("ul"), "speed"), 3);
  assert.deepEqual(engine.getSubtypes(id("ul")), ["mau"]);
  assert.deepEqual(engine.getKeywords(id("ul")), []);
  assert.deepEqual(engine.getRestrictions(id("ul")), []);
  assert.deepEqual(engine.getAvailableActivatedAbilities(P1).filter((a) => a.cardId === id("ul")), []);
  assert.deepEqual(engine.getCardTypes(id("ul")), ["character"]);
});

clause(UNION_LEADER, "vanilla", "dies to exactly 9 damage, not 8 (printed life 9)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ul", def: printing(UNION_LEADER), owner: P1, zone: "play" },
      { key: "z8", def: zapTactic("Z8", 8), owner: P1, zone: "hand" },
      { key: "z1", def: zapTactic("Z1", 1), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("z8"), { selected: { t: [id("ul")] } });
  assert.equal(zoneOf(engine, id("ul")), "play");
  play(engine, P1, id("z1"), { selected: { t: [id("ul")] } });
  assert.equal(zoneOf(engine, id("ul")), "discard");
});

// --- 1337! -----------------------------------------------------------------
// The next card you play this turn costs up to 4 less. -- Draw a card.
// Tactic, cost 3, threshold [E].

const LEET = "702128fa-00c9-4ad7-a7cc-710c63e938cb";

/** A tactic with the given printed cost whose only effect is to draw a card (so we can see that it resolved). */
const cantrip = (name: string, cost: number, threshold = ""): CardDefinition =>
  tactic({ name, cost, threshold: threshold as never, behavior: { abilities: [{ id: "c", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });

function leetBoard(opts: { icons?: Icons; extra?: CardPlacement[]; turn?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    cards: [
      { key: "leet", def: printing(LEET), owner: P1, zone: "hand" },
      { key: "leet2", def: printing(LEET), owner: P1, zone: "hand" },
      { key: "c0", def: character({ name: "C0", cost: 0 }), owner: P1, zone: "hand" },
      { key: "c2", def: character({ name: "C2", cost: 2 }), owner: P1, zone: "hand" },
      { key: "c4", def: character({ name: "C4", cost: 4 }), owner: P1, zone: "hand" },
      { key: "c5", def: character({ name: "C5", cost: 5 }), owner: P1, zone: "hand" },
      { key: "c6", def: character({ name: "C6", cost: 6 }), owner: P1, zone: "hand" },
      { key: "c6b", def: character({ name: "C6b", cost: 6 }), owner: P1, zone: "hand" },
      { key: "i5", def: item({ name: "I5", cost: 5 }), owner: P1, zone: "hand" },
      { key: "loc4", def: location({ name: "Loc4", cost: 4 }), owner: P1, zone: "hand" },
      { key: "t3", def: cantrip("T3", 3), owner: P1, zone: "hand" },
      ...deckCards("a", 5, P1),
      ...deckCards("b", 3, P2),
      ...res(opts.icons ?? { elitism: 14 }),
      ...(opts.extra ?? [])
    ]
  });
}

/** Resources `fn` spends. */
function spentBy(engine: SpoilsEngine, player: PlayerId, fn: () => void): number {
  const before = ready(engine, player);
  fn();
  return before - ready(engine, player);
}

clause(LEET, "0:rule", "pays its own cost of 3 with [E] and nothing more, and the tactic goes to my discard pile", () => {
  const { engine, id } = leetBoard();
  assert.equal(spentBy(engine, P1, () => playUpTo(engine, P1, id("leet"))), 3);
  assert.equal(zoneOf(engine, id("leet")), "discard");
});

for (const [key, printed, paid] of [
  ["c6", 6, 2],
  ["c5", 5, 1],
  ["c4", 4, 0],
  ["c2", 2, 0],
  ["c0", 0, 0]
] as const) {
  clause(LEET, "0:rule", `the next card (a character with cost ${printed}) costs up to 4 less: pays ${paid}`, () => {
    const { engine, id } = leetBoard();
    playUpTo(engine, P1, id("leet"));
    assert.equal(spentBy(engine, P1, () => play(engine, P1, id(key))), paid);
    assert.equal(zoneOf(engine, id(key)), "play");
  });
}

clause(LEET, "0:rule", "'up to 4 less': 1337! asks its controller how much to reduce, a number from 0 to 4", () => {
  const { engine, id } = leetBoard();
  play(engine, P1, id("leet"));
  const pc = pending(engine) as unknown as { kind: string; playerId: string; min: number; max: number } | undefined;
  assert.ok(pc, "the controller is asked how much to reduce");
  assert.equal(pc.kind, "chooseNumber");
  assert.equal(pc.playerId, P1);
  assert.equal(pc.min, 0);
  assert.equal(pc.max, 4);
});

for (const [value, paid] of [
  [4, 2],
  [3, 3],
  [2, 4],
  [1, 5],
  [0, 6]
] as const) {
  clause(LEET, "0:rule", `choosing ${value} reduces the next card by exactly ${value}: a cost-6 character pays ${paid}`, () => {
    const { engine, id } = leetBoard();
    playUpTo(engine, P1, id("leet"), value);
    assert.equal(pending(engine), undefined, "the choice is answered");
    assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c6"))), paid);
    assert.equal(zoneOf(engine, id("c6")), "play");
  });
}

clause(LEET, "0:rule", "more than 4 (or a negative number) is refused: the choice stays open, and 4 is still accepted", () => {
  const { engine, id } = leetBoard();
  play(engine, P1, id("leet"));
  for (const value of [5, -1]) {
    assert.throws(
      () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooseNumber", value } } as never),
      /Choose an integer/,
      `${value} is outside 0 to 4`
    );
    assert.equal(pending(engine)?.kind, "chooseNumber", "the choice is still open");
  }
  answerUpTo(engine, P1, 4);
  assert.equal(pending(engine), undefined);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c6"))), 2);
});

clause(LEET, "1:rule", "choosing 0 still draws the card: one card in hand more, the top of my deck", () => {
  const { engine, id } = leetBoard();
  const top = deckOf(engine, P1)[0];
  const handBefore = handOf(engine, P1).length;
  playUpTo(engine, P1, id("leet"), 0);
  assert.equal(zoneOf(engine, top), "hand", "drawn");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1);
  assert.equal(zoneOf(engine, id("leet")), "discard");
});

clause(LEET, "0:rule", "control: without 1337! the same cost-6 character costs the full 6", () => {
  const { engine, id } = leetBoard();
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c6"))), 6);
});

for (const [key, label, printed, paid] of [
  ["i5", "an item", 5, 1],
  ["loc4", "a location", 4, 0],
  ["t3", "a tactic", 3, 0]
] as const) {
  clause(LEET, "0:rule", `works on any card type: ${label} with cost ${printed} pays ${paid}`, () => {
    const { engine, id } = leetBoard();
    playUpTo(engine, P1, id("leet"));
    assert.equal(spentBy(engine, P1, () => play(engine, P1, id(key))), paid);
  });
}

clause(LEET, "0:rule", "only the NEXT card: the card after it costs full price", () => {
  const { engine, id } = leetBoard();
  playUpTo(engine, P1, id("leet"));
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c6"))), 2);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c6b"))), 6, "the reduction was used up");
});

clause(LEET, "0:rule", "the next card can be another 1337!: it costs 0 (3 - 4, never below 0), and ITS reduction applies to the card after", () => {
  const { engine, id } = leetBoard();
  playUpTo(engine, P1, id("leet"));
  assert.equal(spentBy(engine, P1, () => playUpTo(engine, P1, id("leet2"))), 0, "the second 1337! is the next card, so it is free");
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c6"))), 2, "and its own reduction applies to the next card");
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c6b"))), 6);
});

clause(LEET, "0:rule", "it does not carry over: unused at the end of the turn, the reduction is gone", () => {
  const { engine, id } = leetBoard();
  playUpTo(engine, P1, id("leet"));
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c6"))), 6, "the next turn's card pays in full");
});

clause(LEET, "0:rule", "the threshold is not reduced: a discounted card that needs [R][R] is still refused without them", () => {
  const needsRage = character({ name: "NeedsRage", cost: 5, threshold: "rr" as never });
  const { engine, id } = leetBoard({ extra: [{ key: "nr", def: needsRage, owner: P1, zone: "hand" }] });
  playUpTo(engine, P1, id("leet"));
  assert.throws(() => playRaw(engine, P1, id("nr")), "no [R] icons");
  assert.equal(zoneOf(engine, id("nr")), "hand");
});

clause(LEET, "0:rule", "a refused attempt does not use the reduction up: the next card that CAN be played still gets it", () => {
  const needsRage = character({ name: "NeedsRage", cost: 5, threshold: "rr" as never });
  const { engine, id } = leetBoard({ extra: [{ key: "nr", def: needsRage, owner: P1, zone: "hand" }] });
  playUpTo(engine, P1, id("leet"));
  assert.throws(() => playRaw(engine, P1, id("nr")));
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c6"))), 2);
});

clause(LEET, "0:rule", "a card with a threshold the player does meet still gets the reduction: cost 5 with [R][R] pays 1", () => {
  const needsRage = character({ name: "NeedsRage", cost: 5, threshold: "rr" as never });
  const { engine, id } = leetBoard({ icons: { elitism: 4, rage: 4 }, extra: [{ key: "nr", def: needsRage, owner: P1, zone: "hand" }] });
  playUpTo(engine, P1, id("leet"));
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("nr"))), 1);
});

clause(LEET, "0:rule", "only for me: while my reduction is waiting, my opponent's tactic costs them full price, and my next card still gets the reduction", () => {
  const drawer = character({
    name: "Drawer",
    strength: 1,
    life: 3,
    behavior: { abilities: [{ id: "draw1", name: "Study", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const { engine, id } = leetBoard({
    extra: [
      { key: "drawer", def: drawer, owner: P1, zone: "play" },
      { key: "oppTactic", def: cantrip("OppTactic", 3), owner: P2, zone: "hand" },
      ...res({ rage: 5 }, P2)
    ]
  });
  playUpTo(engine, P1, id("leet"));
  // my ability gives my opponent a window to respond; they play a cost-3 tactic
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("drawer"), abilityId: "draw1", selected: {}, variables: {} });
  const theirs = spentBy(engine, P2, () => engine.perform({ type: "playCard", playerId: P2, cardId: id("oppTactic"), selected: {}, variables: {} } as never));
  assert.equal(theirs, 3, "my opponent pays the full 3: my reduction is not theirs");
  resolvePendingResponses(engine);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c6"))), 2, "my reduction is still there for my next card");
});

clause(LEET, "1:rule", "draws exactly one card, the top card of my deck, even when there is no card to play afterwards", () => {
  const { engine, id } = leetBoard();
  const top = deckOf(engine, P1)[0];
  const handBefore = handOf(engine, P1).length;
  playUpTo(engine, P1, id("leet"));
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1);
  assert.equal(zoneOf(engine, top), "hand");
  assert.equal(deckOf(engine, P1).length, 4);
  assert.equal(handOf(engine, P2).length, 0, "the opponent draws nothing");
});

clause(LEET, "1:rule", "with an empty deck the reduction still applies and nothing is drawn", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "leet", def: printing(LEET), owner: P1, zone: "hand" },
      { key: "c6", def: character({ name: "C6", cost: 6 }), owner: P1, zone: "hand" },
      ...res({ elitism: 12 })
    ]
  });
  playUpTo(engine, P1, id("leet"));
  assert.equal(handOf(engine, P1).length, 1);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c6"))), 2);
});

clause(LEET, "0:rule", "the reduction covers the whole numeric cost of the next card, including a 'pay X+X' extra cost (CR 406.3): Invent with X=3 (pay 6) costs 2", () => {
  const { engine, id } = leetBoard({ extra: [{ key: "invent", def: printing("12b9e68e-852b-44ed-b69d-eb53660dfe6a"), owner: P1, zone: "hand" }] });
  playUpTo(engine, P1, id("leet"));
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("invent"), { variables: { x: 3 } })), 6 - 4);
});

clause(LEET, "0:rule", "is refused one resource short of its cost of 3, and without [E] even with plenty of other resources", () => {
  const short = leetBoard({ icons: { elitism: 2 } });
  assert.throws(() => playRaw(short.engine, P1, short.id("leet")));
  assert.equal(zoneOf(short.engine, short.id("leet")), "hand");
  const noThreshold = leetBoard({ icons: { rage: 6, greed: 3 } });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("leet")));
  const exact = leetBoard({ icons: { elitism: 3 } });
  playUpTo(exact.engine, P1, exact.id("leet"));
  assert.equal(zoneOf(exact.engine, exact.id("leet")), "discard", "[E] and exactly 3 resources is enough");
  assert.equal(ready(exact.engine), 0);
});

// --- 3p1ph4ny 31f ----------------------------------------------------------
// When this card enters play, you may play a non-tactic card for free. If you do,
// your opponent may do the same. (You still need the proper resource icons.)
// Character, cost 5, threshold [E][E][E], 2 strength / 3 speed / 2 life, subtype 31f.

const EPIPHANY = "0de292e7-cc1a-481a-ad01-697f928caac1";

function epiphanyBoard(opts: { p1Hand?: CardPlacement[]; p2Hand?: CardPlacement[]; icons?: Icons; p2Icons?: Icons } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "e", def: printing(EPIPHANY), owner: P1, zone: "hand" },
      ...(opts.p1Hand ?? [
        { key: "pc", def: character({ name: "PChar", cost: 9 }), owner: P1, zone: "hand" as const },
        { key: "pi", def: item({ name: "PItem", cost: 3 }), owner: P1, zone: "hand" as const },
        { key: "pl", def: location({ name: "PLoc", cost: 3 }), owner: P1, zone: "hand" as const },
        { key: "pt", def: cantrip("PTactic", 1), owner: P1, zone: "hand" as const },
        { key: "pr", def: character({ name: "PNeedsRage", cost: 1, threshold: "rr" as never }), owner: P1, zone: "hand" as const }
      ]),
      ...(opts.p2Hand ?? [
        { key: "oc", def: character({ name: "OChar", cost: 8 }), owner: P2, zone: "hand" as const },
        { key: "oi", def: item({ name: "OItem", cost: 2 }), owner: P2, zone: "hand" as const },
        { key: "ot", def: cantrip("OTactic", 1), owner: P2, zone: "hand" as const },
        { key: "og", def: character({ name: "ONeedsGreed", cost: 1, threshold: "gg" as never }), owner: P2, zone: "hand" as const }
      ]),
      { key: "inDeck", def: character({ name: "InDeck", cost: 1 }), owner: P1, zone: "deck" },
      { key: "inDiscard", def: character({ name: "InDiscard", cost: 1 }), owner: P1, zone: "discard" },
      ...res(opts.icons ?? { elitism: 8 }),
      ...res(opts.p2Icons ?? { rage: 2 }, P2)
    ]
  });
}

const offeredTo = (engine: SpoilsEngine, player: PlayerId): string[] => {
  const pc = pending(engine);
  assert.ok(pc, "a free-play prompt is open");
  assert.equal(pc.kind, "deployForFree");
  assert.equal(pc.playerId, player, `the prompt belongs to ${player}`);
  return (pc.candidates as string[]).map((c) => engine.getDefinition(c).name).sort();
};

const freeChoice = (engine: SpoilsEngine, player: PlayerId, cardId?: string) => answerChoice(engine, "deployForFree", player, { cardId });
const tryFree = (engine: SpoilsEngine, player: PlayerId, cardId: string) => () =>
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "deployForFree", cardId } } as never);

clause(EPIPHANY, "0:rule", "pays 5 with [E][E][E]; on entering play I am offered the non-tactic cards of my hand I can afford the icons for", () => {
  const { engine, id } = epiphanyBoard();
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("e"))), 5);
  assert.equal(zoneOf(engine, id("e")), "play");
  const names = offeredTo(engine, P1);
  for (const expected of ["PChar", "PItem", "PLoc"]) assert.ok(names.includes(expected), `${expected} is offered`);
  assert.ok(!names.includes("PTactic"), "a tactic is not a non-tactic card");
  for (const other of ["InDeck", "InDiscard", "OChar", "OItem"]) assert.ok(!names.includes(other), `${other} is not in my hand`);
});

for (const [key, label, type] of [
  ["pc", "character", "character"],
  ["pi", "item", "item"],
  ["pl", "location", "location"]
] as const) {
  clause(EPIPHANY, "0:rule", `I may play a ${label} from my hand for free: it enters play under my control and no resources are spent for it`, () => {
    const { engine, id } = epiphanyBoard();
    play(engine, P1, id("e"));
    const afterEpiphany = ready(engine);
    freeChoice(engine, P1, id(key));
    assert.equal(zoneOf(engine, id(key)), "play");
    assert.equal(engine.state.cards[id(key)].controllerId, P1);
    assert.deepEqual(engine.getCardTypes(id(key)), [type]);
    assert.equal(ready(engine), afterEpiphany, "played for free: the cost is not paid (a cost-9 character costs nothing)");
  });
}

clause(EPIPHANY, "0:rule", "a resource card is not offered and cannot be deployed: an effect that lets you deploy a card deploys only a non-resource card (CR 604.2)", () => {
  const { engine, id } = epiphanyBoard({
    p1Hand: [
      { key: "res", def: resourceCard({ name: "Staple", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" },
      { key: "pc", def: character({ name: "PChar", cost: 3 }), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("e"));
  assert.ok(!offeredTo(engine, P1).includes("Staple"), "a resource card is not offered");
  assert.throws(tryFree(engine, P1, id("res")), "deploying a resource card through a deploy effect");
  assert.equal(zoneOf(engine, id("res")), "hand");
});

clause(EPIPHANY, "0:rule", "the card chosen must be a non-tactic card of MY hand with the proper resource icons: a tactic, a card from the opponent's hand, my deck or my discard pile, and a card whose icons I lack are refused", () => {
  const { engine, id } = epiphanyBoard();
  play(engine, P1, id("e"));
  assert.throws(tryFree(engine, P1, id("pt")), "tactic");
  assert.throws(tryFree(engine, P1, id("pr")), "needs [R][R], which I do not control");
  assert.throws(tryFree(engine, P1, id("oc")), "opponent's hand");
  assert.throws(tryFree(engine, P1, id("inDeck")), "my deck");
  assert.throws(tryFree(engine, P1, id("inDiscard")), "my discard pile");
  assert.throws(tryFree(engine, P1, id("e")), "the card itself is already in play");
  assert.equal(pending(engine)?.kind, "deployForFree", "still waiting for a legal answer");
  assert.equal(zoneOf(engine, id("pt")), "hand");
  assert.equal(zoneOf(engine, id("pr")), "hand");
  freeChoice(engine, P1, id("pi"));
  assert.equal(zoneOf(engine, id("pi")), "play");
});

clause(EPIPHANY, "0:rule", "'you still need the proper resource icons': a card needing [R][R] is offered and playable once I control [R][R]", () => {
  const { engine, id } = epiphanyBoard({ icons: { elitism: 5, rage: 2 } });
  play(engine, P1, id("e"));
  assert.ok(offeredTo(engine, P1).includes("PNeedsRage"), "offeredTo(engine, P1).includes(\"PNeedsRage\")");
  freeChoice(engine, P1, id("pr"));
  assert.equal(zoneOf(engine, id("pr")), "play");
});

clause(EPIPHANY, "0:rule", "'may': I can decline, and then nothing from my hand is played", () => {
  const { engine, id } = epiphanyBoard();
  play(engine, P1, id("e"));
  const resources = ready(engine);
  freeChoice(engine, P1, undefined);
  for (const key of ["pc", "pi", "pl", "pt", "pr"]) assert.equal(zoneOf(engine, id(key)), "hand", `${key} stays in hand`);
  assert.equal(ready(engine), resources);
});

clause(EPIPHANY, "0:rule", "if I played a card, my opponent is offered the non-tactic cards of THEIR hand whose icons they meet", () => {
  const { engine, id } = epiphanyBoard();
  play(engine, P1, id("e"));
  freeChoice(engine, P1, id("pi"));
  const names = offeredTo(engine, P2);
  assert.ok(names.includes("OChar") && names.includes("OItem"), "their non-tactic cards are offered");
  assert.ok(!names.includes("OTactic"), "a tactic is not a non-tactic card");
  for (const mine of ["PChar", "PItem", "PLoc", "PTactic", "PNeedsRage"]) assert.ok(!names.includes(mine), `${mine} is in MY hand, not theirs`);
});

clause(EPIPHANY, "0:rule", "the opponent plays their chosen card for free: it enters play under THEIR control and they spend nothing", () => {
  const { engine, id } = epiphanyBoard();
  play(engine, P1, id("e"));
  freeChoice(engine, P1, id("pc"));
  const theirs = ready(engine, P2);
  freeChoice(engine, P2, id("oc"));
  assert.equal(zoneOf(engine, id("oc")), "play");
  assert.equal(engine.state.cards[id("oc")].controllerId, P2);
  assert.equal(ready(engine, P2), theirs, "a cost-8 character for free");
  assert.equal(zoneOf(engine, id("oi")), "hand", "only one card");
  assert.equal(pending(engine), undefined, "nothing more is asked");
});

clause(EPIPHANY, "0:rule", "'may do the same': the opponent can decline", () => {
  const { engine, id } = epiphanyBoard();
  play(engine, P1, id("e"));
  freeChoice(engine, P1, id("pi"));
  freeChoice(engine, P2, undefined);
  assert.equal(zoneOf(engine, id("oc")), "hand");
  assert.equal(zoneOf(engine, id("oi")), "hand");
  assert.equal(pending(engine), undefined);
});

clause(EPIPHANY, "0:rule", "the opponent's choice is limited to their own non-tactic hand cards with icons they control (their tactic, the [G][G] card and my cards are refused)", () => {
  const { engine, id } = epiphanyBoard();
  play(engine, P1, id("e"));
  freeChoice(engine, P1, id("pi"));
  assert.throws(tryFree(engine, P2, id("ot")), "their tactic");
  assert.throws(tryFree(engine, P2, id("og")), "they lack [G][G]");
  assert.throws(tryFree(engine, P2, id("pc")), "a card in MY hand");
  assert.equal(zoneOf(engine, id("pc")), "hand");
  freeChoice(engine, P2, id("oi"));
  assert.equal(zoneOf(engine, id("oi")), "play");
});

clause(EPIPHANY, "0:rule", "the opponent needs the proper icons too: with [G][G] their [G][G] card is offered and playable", () => {
  const { engine, id } = epiphanyBoard({ p2Icons: { greed: 2 } });
  play(engine, P1, id("e"));
  freeChoice(engine, P1, id("pi"));
  assert.ok(offeredTo(engine, P2).includes("ONeedsGreed"), "offeredTo(engine, P2).includes(\"ONeedsGreed\")");
  freeChoice(engine, P2, id("og"));
  assert.equal(zoneOf(engine, id("og")), "play");
});

clause(EPIPHANY, "0:rule", "the opponent's card can also be an item or a location (any non-tactic card)", () => {
  const { engine, id } = epiphanyBoard({
    p2Hand: [
      { key: "oloc", def: location({ name: "OLoc", cost: 7 }), owner: P2, zone: "hand" },
      { key: "oi", def: item({ name: "OItem", cost: 2 }), owner: P2, zone: "hand" }
    ]
  });
  play(engine, P1, id("e"));
  freeChoice(engine, P1, id("pi"));
  assert.deepEqual(offeredTo(engine, P2), ["OItem", "OLoc"]);
  freeChoice(engine, P2, id("oloc"));
  assert.equal(zoneOf(engine, id("oloc")), "play");
});

clause(EPIPHANY, "0:rule", "'If you do': when I decline to play a card, my opponent is NOT offered one", () => {
  const { engine, id } = epiphanyBoard();
  play(engine, P1, id("e"));
  freeChoice(engine, P1, undefined);
  assert.equal(pending(engine), undefined, "I played nothing, so my opponent gets no offer");
  assert.equal(zoneOf(engine, id("oc")), "hand");
});

clause(EPIPHANY, "0:rule", "'If you do': when I have no non-tactic card I can play (so I play nothing), my opponent is NOT offered one", () => {
  const { engine, id } = epiphanyBoard({
    p1Hand: [{ key: "pt", def: cantrip("PTactic", 1), owner: P1, zone: "hand" }]
  });
  play(engine, P1, id("e"));
  assert.equal(pending(engine), undefined, "I could not play anything, so my opponent gets no offer");
  assert.equal(zoneOf(engine, id("oc")), "hand");
});

clause(EPIPHANY, "0:rule", "it triggers when THIS card enters play, not when another card does: playing another character afterwards offers nothing", () => {
  const { engine, id } = epiphanyBoard({
    p1Hand: [
      { key: "later", def: character({ name: "Later", cost: 0 }), owner: P1, zone: "hand" },
      { key: "bystander", def: character({ name: "Bystander", cost: 0 }), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("e"));
  freeChoice(engine, P1, undefined);
  drain(engine, declineAll);
  assert.equal(pending(engine), undefined);
  play(engine, P1, id("later"));
  assert.equal(pending(engine), undefined, "no new offer when a different card enters play");
  assert.equal(zoneOf(engine, id("later")), "play");
  assert.equal(zoneOf(engine, id("bystander")), "hand");
});

clause(EPIPHANY, "0:rule", "a card put into play for free can itself be what I picked even if it costs more than my whole resource pool", () => {
  const { engine, id } = epiphanyBoard({ icons: { elitism: 5 } });
  play(engine, P1, id("e"));
  assert.equal(ready(engine), 0);
  assert.ok(offeredTo(engine, P1).includes("PChar"), "cost 9 with 0 resources left is still offered");
  freeChoice(engine, P1, id("pc"));
  assert.equal(zoneOf(engine, id("pc")), "play");
});

clause(EPIPHANY, "0:rule", "is refused one resource short of its cost of 5, and without [E][E][E] even with plenty of other resources", () => {
  const short = epiphanyBoard({ icons: { elitism: 4 } });
  assert.throws(() => playRaw(short.engine, P1, short.id("e")));
  assert.equal(zoneOf(short.engine, short.id("e")), "hand");
  const twoE = epiphanyBoard({ icons: { elitism: 2, rage: 8 } });
  assert.throws(() => playRaw(twoE.engine, P1, twoE.id("e")));
  const exact = epiphanyBoard({ icons: { elitism: 3, rage: 2 } });
  play(exact.engine, P1, exact.id("e"));
  assert.equal(zoneOf(exact.engine, exact.id("e")), "play", "[E][E][E] and exactly 5 resources is enough");
});

clause(EPIPHANY, "0:rule", "has its printed stats: 2 strength, 2 life, 3 speed, subtype 31f", () => {
  const { engine, id } = epiphanyBoard();
  play(engine, P1, id("e"));
  assert.equal(engine.getStat(id("e"), "strength"), 2);
  assert.equal(engine.getStat(id("e"), "life"), 2);
  assert.equal(engine.getStat(id("e"), "speed"), 3);
  assert.deepEqual(engine.getSubtypes(id("e")), ["31f"]);
});

// --- 633fy 31f ---------------------------------------------------------------
// COST: Play this only if you have played at least 2 other non-resource cards
// this turn. Character, cost 2, threshold [E][E], 4 strength / 3 speed / 4 life,
// subtype 31f.

const FIVE_THREE = "3f48476b-28e1-48da-bab0-714147f8a0b3";

function fiveBoard(opts: { icons?: Icons; extra?: CardPlacement[]; turn?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    cards: [
      { key: "f", def: printing(FIVE_THREE), owner: P1, zone: "hand" },
      { key: "i1", def: item({ name: "I1", cost: 0 }), owner: P1, zone: "hand" },
      { key: "i2", def: item({ name: "I2", cost: 0 }), owner: P1, zone: "hand" },
      { key: "i3", def: item({ name: "I3", cost: 0 }), owner: P1, zone: "hand" },
      { key: "c0", def: character({ name: "C0", cost: 0 }), owner: P1, zone: "hand" },
      { key: "l0", def: location({ name: "L0", cost: 0 }), owner: P1, zone: "hand" },
      { key: "t0", def: cantrip("T0", 0), owner: P1, zone: "hand" },
      { key: "r1", def: character({ name: "R1", cost: 0 }), owner: P1, zone: "hand" },
      { key: "r2", def: character({ name: "R2", cost: 0 }), owner: P1, zone: "hand" },
      { key: "oppTactic", def: cantrip("OppTactic", 0), owner: P2, zone: "hand" },
      ...deckCards("a", 6, P1),
      ...deckCards("b", 3, P2),
      ...res(opts.icons ?? { elitism: 6 }),
      ...(opts.extra ?? [])
    ]
  });
}

const fiveRefused = (engine: SpoilsEngine, id: (key: string) => string) => {
  const before = ready(engine);
  assert.throws(() => playRaw(engine, P1, id("f")));
  assert.equal(zoneOf(engine, id("f")), "hand", "still in hand");
  assert.equal(ready(engine), before, "nothing was spent");
};

function developResourceCard(engine: SpoilsEngine, key: string, id: (key: string) => string) {
  developPlay(engine, P1, id(key), true);
}

clause(FIVE_THREE, "0:ability", "refused when I have played no other non-resource card this turn, and nothing is spent", () => {
  const { engine, id } = fiveBoard();
  fiveRefused(engine, id);
});

clause(FIVE_THREE, "0:ability", "refused after only ONE other non-resource card this turn", () => {
  const { engine, id } = fiveBoard();
  play(engine, P1, id("i1"));
  fiveRefused(engine, id);
});

clause(FIVE_THREE, "0:ability", "allowed after two other non-resource cards: pays 2 and enters play", () => {
  const { engine, id } = fiveBoard();
  play(engine, P1, id("i1"));
  play(engine, P1, id("i2"));
  const spent = spentBy(engine, P1, () => play(engine, P1, id("f")));
  assert.equal(spent, 2, "its printed cost of 2");
  assert.equal(zoneOf(engine, id("f")), "play");
});

clause(FIVE_THREE, "0:ability", "'at least 2': three other non-resource cards is fine too", () => {
  const { engine, id } = fiveBoard();
  play(engine, P1, id("i1"));
  play(engine, P1, id("i2"));
  play(engine, P1, id("i3"));
  play(engine, P1, id("f"));
  assert.equal(zoneOf(engine, id("f")), "play");
});

for (const [a, b, label] of [
  ["c0", "i1", "a character and an item"],
  ["l0", "i1", "a location and an item"],
  ["t0", "i1", "a tactic and an item"],
  ["t0", "c0", "a tactic and a character"],
  ["c0", "l0", "a character and a location"]
] as const) {
  clause(FIVE_THREE, "0:ability", `any non-resource types count: ${label}`, () => {
    const { engine, id } = fiveBoard();
    play(engine, P1, id(a));
    play(engine, P1, id(b));
    drain(engine, declineAll);
    play(engine, P1, id("f"));
    assert.equal(zoneOf(engine, id("f")), "play");
  });
}

clause(FIVE_THREE, "0:ability", "resources do NOT count: one other card plus a resource played with the Develop Rule is still only one", () => {
  const { engine, id } = fiveBoard();
  play(engine, P1, id("i1"));
  developResourceCard(engine, "r1", id);
  assert.equal(engine.isResource(id("r1")), true, "the Develop Rule put a card in as a resource");
  fiveRefused(engine, id);
});

clause(FIVE_THREE, "0:ability", "...but two non-resource cards plus a resource is enough", () => {
  const { engine, id } = fiveBoard();
  play(engine, P1, id("i1"));
  developResourceCard(engine, "r1", id);
  play(engine, P1, id("i2"));
  play(engine, P1, id("f"));
  assert.equal(zoneOf(engine, id("f")), "play");
});

clause(FIVE_THREE, "0:ability", "only cards played THIS turn count: two cards played last turn do not", () => {
  const { engine, id } = fiveBoard({ turn: 1 });
  play(engine, P1, id("i1"));
  play(engine, P1, id("i2"));
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  fiveRefused(engine, id);
  play(engine, P1, id("i3"));
  fiveRefused(engine, id);
});

clause(FIVE_THREE, "0:ability", "only cards I played count, not my opponent's: a tactic my opponent plays in response to my card does not count for me", () => {
  const { engine, id } = fiveBoard();
  playRaw(engine, P1, id("i1"));
  engine.perform({ type: "playCard", playerId: P2, cardId: id("oppTactic"), selected: {}, variables: {} } as never);
  resolvePendingResponses(engine);
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("i1")), "play");
  assert.equal(zoneOf(engine, id("oppTactic")), "discard");
  fiveRefused(engine, id);
  play(engine, P1, id("i2"));
  play(engine, P1, id("f"));
  assert.equal(zoneOf(engine, id("f")), "play");
});

clause(FIVE_THREE, "0:ability", "a refused attempt does not count as a play: after trying and failing, one more card is still not enough but two are", () => {
  const { engine, id } = fiveBoard();
  play(engine, P1, id("i1"));
  assert.throws(() => playRaw(engine, P1, id("f")));
  assert.throws(() => playRaw(engine, P1, id("f")));
  play(engine, P1, id("i2"));
  play(engine, P1, id("f"));
  assert.equal(zoneOf(engine, id("f")), "play");
});

clause(FIVE_THREE, "0:ability", "cards I played still count after they have left play: one of the two characters is destroyed by the opponent in response to the second", () => {
  const foeKill = tactic({
    name: "FoeKill",
    cost: 0,
    behavior: {
      abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character", controller: "opponent" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
    }
  });
  const { engine, id } = fiveBoard({ extra: [{ key: "foeKill", def: foeKill, owner: P2, zone: "hand" }] });
  play(engine, P1, id("c0"));
  playRaw(engine, P1, id("r1"));
  engine.perform({ type: "playCard", playerId: P2, cardId: id("foeKill"), selected: { t: [id("c0")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("c0")), "discard", "the first character is gone");
  assert.equal(zoneOf(engine, id("r1")), "play");
  play(engine, P1, id("f"));
  assert.equal(zoneOf(engine, id("f")), "play", "both plays still count");
});

clause(FIVE_THREE, "0:ability", "a card PUT into play by an effect was not 'played': 700160x 31f's search puts a gear card into play, which does not count", () => {
  const gear = item({ name: "Gear", cost: 1, subtype: ["gear"] });
  const { engine, id } = fiveBoard({
    extra: [
      { key: "x", def: printing("ff8bd2ba-4a15-4de6-9e92-cf2873d3519f"), owner: P1, zone: "hand" },
      { key: "gear", def: gear, owner: P1, zone: "deck" }
    ]
  });
  play(engine, P1, id("x"));
  pickCards(engine, P1, [id("gear")]);
  assert.equal(zoneOf(engine, id("gear")), "play", "the gear card was put into play");
  fiveRefused(engine, id);
  play(engine, P1, id("i1"));
  play(engine, P1, id("f"));
  assert.equal(zoneOf(engine, id("f")), "play", "700160x 31f (played) and the item (played) are the two; the gear was not played");
});

clause(FIVE_THREE, "0:ability", "is refused one resource short of its cost of 2 even with the other plays made, and without [E][E]", () => {
  const attempt = (icons: Icons) => {
    const board = fiveBoard({ icons });
    play(board.engine, P1, board.id("i1"));
    play(board.engine, P1, board.id("i2"));
    return board;
  };
  const short = attempt({ elitism: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("f")), "1 resource");
  const oneE = attempt({ elitism: 1, rage: 4 });
  assert.throws(() => playRaw(oneE.engine, P1, oneE.id("f")), "only one [E]");
  assert.equal(zoneOf(oneE.engine, oneE.id("f")), "hand");
  const exact = attempt({ elitism: 2 });
  play(exact.engine, P1, exact.id("f"));
  assert.equal(zoneOf(exact.engine, exact.id("f")), "play", "[E][E] and exactly 2 resources is enough");
  assert.equal(ready(exact.engine), 0);
});

clause(FIVE_THREE, "0:ability", "has its printed stats: 4 strength, 4 life, 3 speed, subtype 31f", () => {
  const { engine, id } = fiveBoard();
  play(engine, P1, id("i1"));
  play(engine, P1, id("i2"));
  play(engine, P1, id("f"));
  assert.equal(engine.getStat(id("f"), "strength"), 4);
  assert.equal(engine.getStat(id("f"), "life"), 4);
  assert.equal(engine.getStat(id("f"), "speed"), 3);
  assert.deepEqual(engine.getSubtypes(id("f")), ["31f"]);
});

// --- 700160x 31f -------------------------------------------------------------
// When this card enters play, you may search your deck for a "gear" card that
// costs 5 or less. If you do, put that card into play attached to this card.
// Character, cost 3, threshold [E][E], 1 strength / 3 speed / 1 life, subtype 31f.

const SEVEN_HUNDRED = "ff8bd2ba-4a15-4de6-9e92-cf2873d3519f";
const ARMOR = "c2af6000-b2bc-42db-9048-66e482c2d330";
const GOLIATH = "7a1fea92-3899-423c-bf8c-ea859b083df0";

function xBoard(opts: { icons?: Icons; gearInDeck?: boolean; extra?: CardPlacement[] } = {}) {
  const gearInDeck = opts.gearInDeck ?? true;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "x", def: printing(SEVEN_HUNDRED), owner: P1, zone: "hand" },
      ...deckCards("a", 5, P1),
      ...(gearInDeck
        ? [
            { key: "gear5", def: item({ name: "Gear5", cost: 5, subtype: ["gear"] }), owner: P1, zone: "deck" as const },
            { key: "gear6", def: item({ name: "Gear6", cost: 6, subtype: ["gear"] }), owner: P1, zone: "deck" as const },
            { key: "gear0", def: item({ name: "Gear0", cost: 0, subtype: ["gear"] }), owner: P1, zone: "deck" as const },
            { key: "armor", def: printing(ARMOR), owner: P1, zone: "deck" as const },
            { key: "goliath", def: printing(GOLIATH), owner: P1, zone: "deck" as const },
            { key: "notGear", def: item({ name: "NotGear", cost: 1, subtype: ["majig"] }), owner: P1, zone: "deck" as const },
            { key: "noSubtype", def: item({ name: "NoSubtype", cost: 1 }), owner: P1, zone: "deck" as const }
          ]
        : []),
      ...deckCards("z", 4, P1),
      { key: "gearHand", def: item({ name: "GearHand", cost: 1, subtype: ["gear"] }), owner: P1, zone: "hand" },
      { key: "gearDiscard", def: item({ name: "GearDiscard", cost: 1, subtype: ["gear"] }), owner: P1, zone: "discard" },
      { key: "oppGear", def: item({ name: "OppGear", cost: 1, subtype: ["gear"] }), owner: P2, zone: "deck" },
      ...deckCards("b", 3, P2),
      { key: "later", def: character({ name: "Later", cost: 0 }), owner: P1, zone: "hand" },
      ...res(opts.icons ?? { elitism: 6 }),
      ...(opts.extra ?? [])
    ]
  });
}

clause(SEVEN_HUNDRED, "0:rule", "pays 3 with [E][E]; on entering play I am asked to search my own deck", () => {
  const { engine, id } = xBoard();
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("x"))), 3);
  assert.equal(zoneOf(engine, id("x")), "play");
  const pc = pending(engine);
  assert.ok(pc, "a search prompt is open");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I do the searching");
});

clause(SEVEN_HUNDRED, "0:rule", "a gear card costing exactly 5 can be found: it is put into play attached to this card, under my control, without paying for it", () => {
  const { engine, id } = xBoard();
  play(engine, P1, id("x"));
  const afterPlay = ready(engine);
  pickCards(engine, P1, [id("gear5")]);
  assert.equal(zoneOf(engine, id("gear5")), "play");
  assert.equal(engine.state.cards[id("gear5")].attachedTo, id("x"), "attached to this card");
  assert.equal(engine.state.cards[id("gear5")].controllerId, P1);
  assert.equal(ready(engine), afterPlay, "put into play, not played: nothing is paid");
  assert.ok(!deckOf(engine, P1).includes(id("gear5")), "it left my deck");
  assert.equal(pending(engine), undefined);
});

for (const key of ["gear0", "armor"] as const) {
  clause(SEVEN_HUNDRED, "0:rule", `a cheaper gear card (${key}) can be found too`, () => {
    const { engine, id } = xBoard();
    play(engine, P1, id("x"));
    pickCards(engine, P1, [id(key)]);
    assert.equal(zoneOf(engine, id(key)), "play");
    assert.equal(engine.state.cards[id(key)].attachedTo, id("x"));
  });
}

clause(SEVEN_HUNDRED, "0:rule", "a gear card that costs MORE than 5 cannot be found (cost 6, and Luteoderm Goliath at cost 8)", () => {
  const { engine, id } = xBoard();
  play(engine, P1, id("x"));
  assert.throws(tryPick(engine, P1, [id("gear6")]), "cost 6");
  assert.throws(tryPick(engine, P1, [id("goliath")]), "cost 8");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  assert.equal(zoneOf(engine, id("gear6")), "deck");
  assert.equal(zoneOf(engine, id("goliath")), "deck");
});

clause(SEVEN_HUNDRED, "0:rule", "only a GEAR card: a non-gear item, an item with no subtype and a plain character are refused", () => {
  const { engine, id } = xBoard();
  play(engine, P1, id("x"));
  assert.throws(tryPick(engine, P1, [id("notGear")]), "an item that is not gear");
  assert.throws(tryPick(engine, P1, [id("noSubtype")]), "an item with no subtype");
  assert.throws(tryPick(engine, P1, [id("a0")]), "a character");
});

clause(SEVEN_HUNDRED, "0:rule", "only from MY DECK: a gear card in my hand, in my discard pile, or in my opponent's deck is refused", () => {
  const { engine, id } = xBoard();
  play(engine, P1, id("x"));
  assert.throws(tryPick(engine, P1, [id("gearHand")]), "my hand");
  assert.throws(tryPick(engine, P1, [id("gearDiscard")]), "my discard pile");
  assert.throws(tryPick(engine, P1, [id("oppGear")]), "the opponent's deck");
  assert.equal(zoneOf(engine, id("gearHand")), "hand");
  assert.equal(zoneOf(engine, id("gearDiscard")), "discard");
  assert.equal(zoneOf(engine, id("oppGear")), "deck");
});

clause(SEVEN_HUNDRED, "0:rule", "only ONE card: picking two gear cards is refused", () => {
  const { engine, id } = xBoard();
  play(engine, P1, id("x"));
  assert.throws(tryPick(engine, P1, [id("gear5"), id("gear0")]));
  assert.equal(zoneOf(engine, id("gear5")), "deck");
  assert.equal(zoneOf(engine, id("gear0")), "deck");
});

clause(SEVEN_HUNDRED, "0:rule", "'may': I can find nothing; no gear card enters play", () => {
  const { engine, id } = xBoard();
  play(engine, P1, id("x"));
  const gearBefore = ["gear5", "gear6", "gear0", "armor", "goliath"].map(id);
  pickCards(engine, P1, []);
  for (const cardId of gearBefore) assert.equal(zoneOf(engine, cardId), "deck");
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("x")), "play");
});

clause(SEVEN_HUNDRED, "0:rule", "the gear card really is attached: a real Luteoderm Armor found this way gives this card +2 strength and +2 life", () => {
  const { engine, id } = xBoard();
  play(engine, P1, id("x"));
  pickCards(engine, P1, [id("armor")]);
  assert.equal(engine.getStat(id("x"), "strength"), 1 + 2);
  assert.equal(engine.getStat(id("x"), "life"), 1 + 2);
});

clause(SEVEN_HUNDRED, "0:rule", "the attached gear card leaves play with this card (destroyed with it)", () => {
  const { engine, id } = xBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("x"));
  pickCards(engine, P1, [id("armor")]);
  assert.equal(engine.state.cards[id("armor")].attachedTo, id("x"));
  play(engine, P1, id("kill"), { selected: { t: [id("x")] } });
  assert.equal(zoneOf(engine, id("x")), "discard");
  assert.equal(zoneOf(engine, id("armor")), "discard", "the attached card leaves play the same way (CR 301.4)");
});

clause(SEVEN_HUNDRED, "0:rule", "the searched deck is shuffled afterwards (CR 312.1) and holds the same cards minus the one taken", () => {
  const { engine, id } = xBoard();
  const before = deckOf(engine, P1).filter((c) => c !== id("gear5"));
  play(engine, P1, id("x"));
  pickCards(engine, P1, [id("gear5")]);
  const after = deckOf(engine, P1);
  assert.deepEqual([...after].sort(), [...before].sort(), "same cards");
  assert.notDeepEqual(after, before, "in a new order");
});

clause(SEVEN_HUNDRED, "0:rule", "failing the search (picking nothing) still shuffles the deck (CR 312.1)", () => {
  const { engine, id } = xBoard();
  const before = [...deckOf(engine, P1)];
  play(engine, P1, id("x"));
  pickCards(engine, P1, []);
  const after = deckOf(engine, P1);
  assert.deepEqual([...after].sort(), [...before].sort());
  assert.notDeepEqual(after, before, "a searched deck is shuffled even when nothing was taken");
});

clause(SEVEN_HUNDRED, "0:rule", "'you may search': declining is no search at all, so the deck is NOT shuffled (Q2, CR 312.1)", () => {
  const { engine, id } = xBoard();
  const before = [...deckOf(engine, P1)];
  play(engine, P1, id("x"));
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [], declined: true } } as never);
  resolvePendingResponses(engine);
  assert.deepEqual(deckOf(engine, P1), before, "nothing was searched, so the deck keeps its order");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(SEVEN_HUNDRED, "0:rule", "a search of a deck with no gear card at all still shuffles it (CR 312.1: if a deck is searched, its owner must shuffle it afterwards)", () => {
  const { engine, id } = xBoard({ gearInDeck: false });
  const before = [...deckOf(engine, P1)];
  play(engine, P1, id("x"));
  drain(engine, declineAll);
  const after = deckOf(engine, P1);
  assert.deepEqual([...after].sort(), [...before].sort());
  assert.notDeepEqual(after, before, "the deck was searched, so it is shuffled");
});

clause(SEVEN_HUNDRED, "0:rule", "with no gear card in my deck nothing happens: no prompt, nothing enters play", () => {
  const { engine, id } = xBoard({ gearInDeck: false });
  play(engine, P1, id("x"));
  assert.equal(pending(engine), undefined, "nothing to find, so nothing to pick");
  assert.equal(zoneOf(engine, id("x")), "play");
  assert.equal(zoneOf(engine, id("gearHand")), "hand");
});

clause(SEVEN_HUNDRED, "0:rule", "the opponent's deck is not touched by the search", () => {
  const { engine, id } = xBoard();
  const oppDeck = [...deckOf(engine, P2)];
  play(engine, P1, id("x"));
  pickCards(engine, P1, [id("gear5")]);
  assert.deepEqual(deckOf(engine, P2), oppDeck);
});

clause(SEVEN_HUNDRED, "0:rule", "it triggers only when THIS card enters play: a different character entering play does not start a search", () => {
  const { engine, id } = xBoard();
  play(engine, P1, id("x"));
  pickCards(engine, P1, []);
  play(engine, P1, id("later"));
  assert.equal(pending(engine), undefined, "no search for another card entering play");
  assert.equal(zoneOf(engine, id("later")), "play");
});

clause(SEVEN_HUNDRED, "0:rule", "is refused one resource short of its cost of 3, and without [E][E] even with plenty of other resources", () => {
  const short = xBoard({ icons: { elitism: 2 } });
  assert.throws(() => playRaw(short.engine, P1, short.id("x")));
  assert.equal(zoneOf(short.engine, short.id("x")), "hand");
  const oneE = xBoard({ icons: { elitism: 1, rage: 6 } });
  assert.throws(() => playRaw(oneE.engine, P1, oneE.id("x")));
  const exact = xBoard({ icons: { elitism: 2, rage: 1 } });
  play(exact.engine, P1, exact.id("x"));
  assert.equal(zoneOf(exact.engine, exact.id("x")), "play", "[E][E] and exactly 3 resources is enough");
  assert.equal(ready(exact.engine), 0);
});

clause(SEVEN_HUNDRED, "0:rule", "has its printed stats: 1 strength, 1 life, 3 speed, subtype 31f", () => {
  const { engine, id } = xBoard();
  play(engine, P1, id("x"));
  pickCards(engine, P1, []);
  assert.equal(engine.getStat(id("x"), "strength"), 1);
  assert.equal(engine.getStat(id("x"), "life"), 1);
  assert.equal(engine.getStat(id("x"), "speed"), 3);
  assert.deepEqual(engine.getSubtypes(id("x")), ["31f"]);
});

// --- All-Nighter -----------------------------------------------------------
// COST: Play this only during your turn. -- EFFECT: Detach up to 9 resources
// from your faction. Tactic, cost 4, threshold [E][E].

const ALL_NIGHTER = "26ff1094-5651-4639-8543-cf966c46a8c2";

/** The resources attached to (spent on) `player`'s faction. */
const attachedResources = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] =>
  engine.state.players[player].play.filter((c) => engine.isResource(c) && engine.state.cards[c].attachedTo === engine.state.players[player].factionId);

function nighterBoard(opts: { spent?: number; ready?: number; oppSpent?: number; extra?: CardPlacement[]; activePlayerId?: PlayerId; icons?: Icons } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.activePlayerId,
    cards: [
      { key: "an", def: printing(ALL_NIGHTER), owner: P1, zone: "hand" },
      ...res(opts.icons ?? { elitism: opts.ready ?? 6 }),
      ...(opts.spent ? spentResources(P1, opts.spent) : []),
      ...(opts.oppSpent ? spentResources(P2, opts.oppSpent) : []),
      { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 5, speed: 2 }), owner: P2, zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}

clause(ALL_NIGHTER, "0:ability", "on my turn: pays 4, then I choose up to 9 of my attached resources to detach, and exactly those become available again", () => {
  const { engine, id } = nighterBoard({ spent: 12, ready: 6 });
  assert.equal(attachedCount(engine, P1), 12);
  play(engine, P1, id("an"));
  assert.equal(attachedCount(engine, P1), 16, "the 4 paid resources are attached too");
  const pc = pending(engine);
  assert.ok(pc, "a detach choice is open");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I choose");
  const pick = attachedResources(engine, P1).slice(0, 9);
  const rest = attachedResources(engine, P1).slice(9);
  pickCards(engine, P1, pick);
  assert.equal(attachedCount(engine, P1), 7, "9 of the 16 were detached");
  assert.equal(ready(engine), 2 + 9, "they can pay again");
  for (const cardId of pick) assert.equal(engine.state.cards[cardId].attachedTo, undefined, "a picked resource is detached");
  for (const cardId of rest) assert.equal(engine.state.cards[cardId].attachedTo, factionOf(engine, P1), "an unpicked resource stays attached");
  assert.equal(zoneOf(engine, id("an")), "discard", "the tactic ends in my discard pile");
  assert.equal(pending(engine), undefined);
});

clause(ALL_NIGHTER, "0:ability", "the resources just paid for All-Nighter itself can be detached again (net cost 0)", () => {
  const { engine, id } = nighterBoard({ ready: 6 });
  play(engine, P1, id("an"));
  assert.equal(ready(engine), 2);
  const paid = attachedResources(engine, P1);
  assert.equal(paid.length, 4);
  pickCards(engine, P1, paid);
  assert.equal(ready(engine), 6);
  assert.equal(attachedCount(engine, P1), 0);
});

clause(ALL_NIGHTER, "0:ability", "'up to 9': ten is refused; nine, a few, or none are allowed", () => {
  const { engine, id } = nighterBoard({ spent: 12, ready: 6 });
  play(engine, P1, id("an"));
  const attached = attachedResources(engine, P1);
  assert.throws(tryPick(engine, P1, attached.slice(0, 10)), "ten is more than 9");
  assert.throws(tryPick(engine, P1, attached), "all sixteen");
  assert.throws(tryPick(engine, P1, [attached[0], attached[0]]), "the same resource twice");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "still waiting");
  pickCards(engine, P1, attached.slice(0, 3));
  assert.equal(attachedCount(engine, P1), 13, "three detached");
});

clause(ALL_NIGHTER, "0:ability", "detaching none at all is allowed ('up to')", () => {
  const { engine, id } = nighterBoard({ spent: 5, ready: 6 });
  play(engine, P1, id("an"));
  pickCards(engine, P1, []);
  assert.equal(attachedCount(engine, P1), 9);
  assert.equal(zoneOf(engine, id("an")), "discard");
});

clause(ALL_NIGHTER, "0:ability", "with fewer than 9 attached resources, all of them can be detached", () => {
  const { engine, id } = nighterBoard({ ready: 4 });
  play(engine, P1, id("an"));
  const attached = attachedResources(engine, P1);
  assert.equal(attached.length, 4);
  pickCards(engine, P1, attached);
  assert.equal(ready(engine), 4);
});

clause(ALL_NIGHTER, "0:ability", "only my attached resources can be picked: not my ready (unattached) resources, not my opponent's attached resources, and no other kind of card", () => {
  const { engine, id } = nighterBoard({
    ready: 6,
    oppSpent: 3,
    extra: [{ key: "gear", def: item({ name: "Gear", subtype: ["gear"] }), owner: P1, zone: "play", attachedToKey: "host" }]
  });
  play(engine, P1, id("an"));
  const readyOnes = engine.getAvailableResourceIds(P1);
  assert.equal(readyOnes.length, 2);
  assert.throws(tryPick(engine, P1, [readyOnes[0]]), "a resource that is not attached cannot be detached");
  assert.throws(tryPick(engine, P1, [attachedResources(engine, P2)[0]]), "the opponent's attached resource");
  assert.throws(tryPick(engine, P1, [id("gear")]), "an item attached to a character is not attached to my faction");
  assert.throws(tryPick(engine, P1, [id("host")]), "a character");
  assert.throws(tryPick(engine, P1, [factionOf(engine, P1)]), "my faction");
  assert.equal(attachedCount(engine, P2), 3, "the opponent's resources are untouched");
  pickCards(engine, P1, [attachedResources(engine, P1)[0]]);
  assert.equal(attachedCount(engine, P1), 3);
});

clause(ALL_NIGHTER, "0:ability", "the opponent's attached resources stay attached", () => {
  const { engine, id } = nighterBoard({ spent: 3, ready: 6, oppSpent: 4 });
  play(engine, P1, id("an"));
  pickCards(engine, P1, attachedResources(engine, P1).slice(0, 9));
  assert.equal(attachedCount(engine, P2), 4);
});

clause(ALL_NIGHTER, "0:ability", "a face-down resource that is attached can be detached too", () => {
  const { engine, id } = nighterBoard({
    ready: 4,
    extra: volition(2, P1).map((p, i) => ({ ...p, key: `down${i}`, attachedToKey: "__factionA" }))
  });
  play(engine, P1, id("an"));
  const down = [id("down0"), id("down1")];
  assert.equal(engine.state.cards[down[0]].faceDown, true);
  pickCards(engine, P1, down);
  assert.equal(engine.state.cards[down[0]].attachedTo, undefined);
  assert.equal(engine.state.cards[down[1]].attachedTo, undefined);
  assert.equal(engine.state.cards[down[0]].faceDown, true, "still a face-down resource");
});

clause(ALL_NIGHTER, "0:ability", "'play this only during your turn': refused on my opponent's turn (here: in response to their attack)", () => {
  const { engine, id } = nighterBoard({ activePlayerId: P2, ready: 6 });
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("foe")], target: { type: "faction", playerId: P1 } });
  untilPriority(engine, P1);
  assert.throws(() => playRaw(engine, P1, id("an")), "it is not my turn");
  assert.equal(zoneOf(engine, id("an")), "hand");
  assert.equal(ready(engine), 6, "nothing was paid");
});

clause(ALL_NIGHTER, "0:ability", "...while the same situation on my own turn works (control)", () => {
  const { engine, id } = nighterBoard({ ready: 6 });
  playRaw(engine, P1, id("an"));
  assert.ok(engine.state.responseWindow, "played on my turn");
  resolvePendingResponses(engine);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
});

clause(ALL_NIGHTER, "0:ability", "the opponent can respond to it, and what they do first resolves first", () => {
  const { engine, id } = nighterBoard({ ready: 6 });
  playRaw(engine, P1, id("an"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "my opponent may respond");
  assert.equal(pending(engine), undefined, "the detach has not happened yet");
});

clause(ALL_NIGHTER, "0:ability", "detached resources can be spent again right away", () => {
  const { engine, id } = nighterBoard({ spent: 4, ready: 4, extra: [{ key: "big", def: character({ name: "Big", cost: 8 }), owner: P1, zone: "hand" }]  });
  assert.equal(ready(engine), 4);
  play(engine, P1, id("an"));
  pickCards(engine, P1, attachedResources(engine, P1));
  assert.equal(ready(engine), 8);
  play(engine, P1, id("big"));
  assert.equal(zoneOf(engine, id("big")), "play", "a cost-8 character is affordable after the detach");
});

clause(ALL_NIGHTER, "0:ability", "is refused one resource short of its cost of 4, and without [E][E] even with plenty of other resources", () => {
  const short = nighterBoard({ icons: { elitism: 3 } });
  assert.throws(() => playRaw(short.engine, P1, short.id("an")));
  assert.equal(zoneOf(short.engine, short.id("an")), "hand");
  const oneE = nighterBoard({ icons: { elitism: 1, rage: 6 } });
  assert.throws(() => playRaw(oneE.engine, P1, oneE.id("an")));
  const exact = nighterBoard({ icons: { elitism: 2, rage: 2 } });
  play(exact.engine, P1, exact.id("an"));
  assert.equal(pending(exact.engine)?.kind, "chooserSelectsTarget", "[E][E] and exactly 4 resources is enough");
});

// --- Basic Node / Hub Node: the shared 'node' rules -------------------------
// Both cards print:
//   When this card enters play, you may search your deck for a "node" card, reveal it, and put it into your hand.
//   If this card is destroyed, destroy all "node" cards.
// Hub Node adds: This card gains 1 strength and 1 life for each other "node" card in play.

const BASIC_NODE = "b6b084f1-d30f-45eb-96bc-6bb8e78abb71";
const HUB_NODE = "a774110a-7061-467e-ab00-ad43c24e5764";

function nodeEtbBoard(subject: string, opts: { nodesInDeck?: boolean } = {}) {
  const nodes = opts.nodesInDeck ?? true;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "n", def: printing(subject), owner: P1, zone: "hand" },
      ...deckCards("a", 4, P1),
      ...(nodes
        ? [
            { key: "nodeChar", def: character({ name: "NodeChar", subtype: ["node"], cost: 2 }), owner: P1, zone: "deck" as const },
            { key: "nodeItem", def: item({ name: "NodeItem", subtype: ["node"] }), owner: P1, zone: "deck" as const },
            { key: "plainItem", def: item({ name: "PlainItem", subtype: ["gear"] }), owner: P1, zone: "deck" as const }
          ]
        : []),
      ...deckCards("z", 4, P1),
      { key: "nodeHand", def: character({ name: "NodeHand", subtype: ["node"] }), owner: P1, zone: "hand" },
      { key: "nodeDiscard", def: character({ name: "NodeDiscard", subtype: ["node"] }), owner: P1, zone: "discard" },
      { key: "oppNode", def: character({ name: "OppNode", subtype: ["node"] }), owner: P2, zone: "deck" },
      ...deckCards("b", 3, P2),
      { key: "later", def: character({ name: "Later", cost: 0 }), owner: P1, zone: "hand" },
      ...res({ elitism: 6 })
    ]
  });
}

function nodeEtbPicksIntoHand(subject: string) {
  for (const key of ["nodeChar", "nodeItem"]) {
    const { engine, id } = nodeEtbBoard(subject);
    play(engine, P1, id("n"));
    const pc = pending(engine);
    assert.ok(pc, "a search prompt is open");
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P1, "I search my own deck");
    const handBefore = handOf(engine, P1).length;
    const deckBefore = deckOf(engine, P1).length;
    pickCards(engine, P1, [id(key)]);
    assert.equal(zoneOf(engine, id(key)), "hand", `${key} is put into my hand (not into play)`);
    assert.ok(handOf(engine, P1).includes(id(key)), "handOf(engine, P1).includes(id(key))");
    assert.equal(handOf(engine, P1).length, handBefore + 1);
    assert.equal(deckOf(engine, P1).length, deckBefore - 1);
    assert.equal(zoneOf(engine, id("n")), "play", "this card stays in play");
  }
}

function nodeEtbRevealsTheCard(subject: string) {
  const { engine, id } = nodeEtbBoard(subject);
  play(engine, P1, id("n"));
  pickCards(engine, P1, [id("nodeChar")]);
  const reveals = revealEvents(engine);
  assert.equal(reveals.length, 1, "the found card is revealed once");
  const ev = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual(ev.cardIds, [id("nodeChar")], "exactly the found card");
  assert.equal(ev.viewerId, "all", "revealed to everyone");
}

function nodeEtbRefusals(subject: string) {
  const { engine, id } = nodeEtbBoard(subject);
  play(engine, P1, id("n"));
  assert.throws(tryPick(engine, P1, [id("plainItem")]), "an item that is not a node");
  assert.throws(tryPick(engine, P1, [id("a0")]), "a plain character");
  assert.throws(tryPick(engine, P1, [id("nodeHand")]), "a node in my hand");
  assert.throws(tryPick(engine, P1, [id("nodeDiscard")]), "a node in my discard pile");
  assert.throws(tryPick(engine, P1, [id("oppNode")]), "a node in the opponent's deck");
  assert.throws(tryPick(engine, P1, [id("nodeChar"), id("nodeItem")]), "two cards");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  assert.equal(zoneOf(engine, id("oppNode")), "deck");
  assert.equal(zoneOf(engine, id("nodeHand")), "hand");
}

function nodeEtbMayDecline(subject: string) {
  const { engine, id } = nodeEtbBoard(subject);
  const handBefore = [...handOf(engine, P1)].filter((c) => c !== id("n"));
  play(engine, P1, id("n"));
  pickCards(engine, P1, []);
  assert.equal(zoneOf(engine, id("nodeChar")), "deck");
  assert.equal(zoneOf(engine, id("nodeItem")), "deck");
  assert.deepEqual(handOf(engine, P1), handBefore, "my hand is unchanged");
  assert.equal(revealEvents(engine).length, 0, "nothing is revealed when nothing is found");
  assert.equal(pending(engine), undefined);
}

function nodeEtbShuffles(subject: string) {
  const { engine, id } = nodeEtbBoard(subject);
  const before = deckOf(engine, P1).filter((c) => c !== id("nodeChar"));
  play(engine, P1, id("n"));
  pickCards(engine, P1, [id("nodeChar")]);
  const after = deckOf(engine, P1);
  assert.deepEqual([...after].sort(), [...before].sort(), "same cards");
  assert.notDeepEqual(after, before, "in a new order (CR 312.1)");
  const opp = nodeEtbBoard(subject);
  const oppBefore = [...deckOf(opp.engine, P2)];
  play(opp.engine, P1, opp.id("n"));
  pickCards(opp.engine, P1, []);
  assert.deepEqual(deckOf(opp.engine, P2), oppBefore, "the opponent's deck is not touched");
}

function nodeEtbShufflesWhenDeclined(subject: string) {
  const { engine, id } = nodeEtbBoard(subject);
  const before = [...deckOf(engine, P1)];
  play(engine, P1, id("n"));
  pickCards(engine, P1, []);
  const after = deckOf(engine, P1);
  assert.deepEqual([...after].sort(), [...before].sort());
  assert.notDeepEqual(after, before, "a searched deck is shuffled even when nothing was taken");
}

function nodeEtbNoNodesShuffles(subject: string) {
  const { engine, id } = nodeEtbBoard(subject, { nodesInDeck: false });
  const before = [...deckOf(engine, P1)];
  play(engine, P1, id("n"));
  drain(engine, declineAll);
  const after = deckOf(engine, P1);
  assert.deepEqual([...after].sort(), [...before].sort());
  assert.notDeepEqual(after, before, "the deck was searched, so it is shuffled");
}

function nodeEtbNoNodes(subject: string) {
  const { engine, id } = nodeEtbBoard(subject, { nodesInDeck: false });
  const handBefore = handOf(engine, P1).length;
  play(engine, P1, id("n"));
  assert.equal(pending(engine), undefined, "no node to find, so nothing to pick");
  assert.equal(handOf(engine, P1).length, handBefore - 1, "only this card left my hand");
  assert.equal(zoneOf(engine, id("n")), "play");
}

function nodeEtbOnlyForItself(subject: string) {
  const { engine, id } = nodeEtbBoard(subject);
  play(engine, P1, id("n"));
  pickCards(engine, P1, []);
  play(engine, P1, id("later"));
  assert.equal(pending(engine), undefined, "another card entering play starts no search");
  const node = nodeEtbBoard(subject);
  play(node.engine, P1, node.id("n"));
  pickCards(node.engine, P1, []);
  // a second node entering play must not make the first one search again
  const second = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "inPlay", def: printing(subject), owner: P1, zone: "play" },
      { key: "newNode", def: character({ name: "NewNode", subtype: ["node"], cost: 0 }), owner: P1, zone: "hand" },
      { key: "deckNode", def: character({ name: "DeckNode", subtype: ["node"] }), owner: P1, zone: "deck" },
      ...res({ elitism: 4 })
    ]
  });
  play(second.engine, P1, second.id("newNode"));
  assert.equal(pending(second.engine), undefined, "a node card already in play does not search when ANOTHER node enters play");
}

/** Nodes in play for the wipe tests: the subject, plus nodes (and non-nodes) of both players. */
function nodeWipeBoard(subject: string, extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "n", def: printing(subject), owner: P1, zone: "play" },
      { key: "myNode", def: character({ name: "MyNode", subtype: ["node"], life: 9 }), owner: P1, zone: "play" },
      { key: "myNodeItem", def: item({ name: "MyNodeItem", subtype: ["node"] }), owner: P1, zone: "play" },
      { key: "oppNode", def: character({ name: "OppNode", subtype: ["node"], life: 9 }), owner: P2, zone: "play" },
      { key: "oppNodeItem", def: item({ name: "OppNodeItem", subtype: ["node"] }), owner: P2, zone: "play" },
      { key: "oppNodeLoc", def: location({ name: "OppNodeLoc", subtype: ["node"], structure: 9 }), owner: P2, zone: "play" },
      { key: "myPlain", def: character({ name: "MyPlain", life: 9 }), owner: P1, zone: "play" },
      { key: "oppPlain", def: character({ name: "OppPlain", life: 9 }), owner: P2, zone: "play" },
      { key: "oppGear", def: item({ name: "OppGear", subtype: ["gear"] }), owner: P2, zone: "play" },
      { key: "downNode", def: character({ name: "DownNode", subtype: ["node"] }), owner: P2, zone: "play", faceDown: true },
      { key: "handNode", def: character({ name: "HandNode", subtype: ["node"] }), owner: P1, zone: "hand" },
      { key: "deckNode", def: character({ name: "DeckNode", subtype: ["node"] }), owner: P1, zone: "deck" },
      { key: "discardNode", def: character({ name: "DiscardNode", subtype: ["node"] }), owner: P2, zone: "discard" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "zap", def: zapTactic("Zap", 20), owner: P1, zone: "hand" },
      { key: "bounce", def: tactic({ name: "Bounce", cost: 0, behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] } }), owner: P1, zone: "hand" },
      ...res({ elitism: 4 }),
      ...extra
    ]
  });
}

const NODE_KEYS_IN_PLAY = ["myNode", "myNodeItem", "oppNode", "oppNodeItem", "oppNodeLoc"];
const NON_NODE_KEYS = ["myPlain", "oppPlain", "oppGear"];

function nodeWipeByEffect(subject: string) {
  const { engine, id } = nodeWipeBoard(subject);
  play(engine, P1, id("kill"), { selected: { t: [id("n")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("n")), "discard", "the node itself was destroyed");
  for (const key of NODE_KEYS_IN_PLAY) assert.equal(zoneOf(engine, id(key)), "discard", `${key} (a node in play) is destroyed`);
  for (const key of NON_NODE_KEYS) assert.equal(zoneOf(engine, id(key)), "play", `${key} (not a node) is untouched`);
}

function nodeWipeIgnoresOtherZones(subject: string) {
  const { engine, id } = nodeWipeBoard(subject);
  play(engine, P1, id("kill"), { selected: { t: [id("n")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("handNode")), "hand", "a node in hand is not in play");
  assert.equal(zoneOf(engine, id("deckNode")), "deck", "a node in the deck is not in play");
  assert.equal(zoneOf(engine, id("discardNode")), "discard");
}

function nodeWipeSparesFaceDownCards(subject: string) {
  const { engine, id } = nodeWipeBoard(subject);
  play(engine, P1, id("kill"), { selected: { t: [id("n")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("n")), "discard");
  assert.equal(zoneOf(engine, id("downNode")), "play", "a face-down card is only a resource (CR 411.1): it is not a node card");
  assert.equal(engine.state.cards[id("downNode")].faceDown, true);
}

function nodeWipeByDamage(subject: string) {
  const { engine, id } = nodeWipeBoard(subject);
  play(engine, P1, id("zap"), { selected: { t: [id("n")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("n")), "discard", "destroyed by lethal damage");
  for (const key of NODE_KEYS_IN_PLAY) assert.equal(zoneOf(engine, id(key)), "discard", `${key} is destroyed when the node dies of damage`);
  for (const key of NON_NODE_KEYS) assert.equal(zoneOf(engine, id(key)), "play");
}

function nodeWipeNotWhenBounced(subject: string) {
  const { engine, id } = nodeWipeBoard(subject);
  play(engine, P1, id("bounce"), { selected: { t: [id("n")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("n")), "hand", "returned to hand, not destroyed");
  for (const key of NODE_KEYS_IN_PLAY) assert.equal(zoneOf(engine, id(key)), "play", `${key} survives: the node was not destroyed`);
}

function nodeWipeNotWhenOtherNodeDies(subject: string) {
  const { engine, id } = nodeWipeBoard(subject);
  play(engine, P1, id("kill"), { selected: { t: [id("myNode")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("myNode")), "discard");
  assert.equal(zoneOf(engine, id("n")), "play", "'if THIS card is destroyed': another node dying does nothing");
  assert.equal(zoneOf(engine, id("oppNode")), "play");
  assert.equal(zoneOf(engine, id("myNodeItem")), "play");
}

function nodeWipeNotWhenSurvivesDamage(subject: string) {
  const { engine, id } = nodeWipeBoard(subject, [{ key: "poke", def: zapTactic("Poke", 1), owner: P1, zone: "hand" }]);
  play(engine, P1, id("poke"), { selected: { t: [id("n")] } });
  assert.equal(zoneOf(engine, id("n")), "play", "1 damage does not destroy it");
  for (const key of NODE_KEYS_IN_PLAY) assert.equal(zoneOf(engine, id(key)), "play");
}

function nodeWipeKillsOtherNodeCardsOfTheSameName(subject: string) {
  const { engine, id } = nodeWipeBoard(subject, [{ key: "twin", def: printing(subject), owner: P2, zone: "play" }]);
  play(engine, P1, id("kill"), { selected: { t: [id("n")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("twin")), "discard", "the opponent's copy is a node card too");
}

function nodeEtbNotWhenPlayedFaceDown(subject: string) {
  const { engine, id } = nodeEtbBoard(subject);
  developPlay(engine, P1, id("n"), true);
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("n")].faceDown, true, "played as a face-down resource");
  assert.equal(pending(engine), undefined, "a face-down card has no rules text, so there is no search");
  assert.equal(zoneOf(engine, id("nodeChar")), "deck");
}

function nodeWipeNotWhenFaceDown(subject: string) {
  const { engine, id } = nodeWipeBoard(subject, [
    { key: "downSubject", def: printing(subject), owner: P2, zone: "play", faceDown: true },
    { key: "killDown", def: killAnyTactic("resource"), owner: P1, zone: "hand" }
  ]);
  play(engine, P1, id("killDown"), { selected: { t: [id("downSubject")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("downSubject")), "discard", "the face-down card was destroyed");
  for (const key of [...NODE_KEYS_IN_PLAY, "n"]) assert.equal(zoneOf(engine, id(key)), "play", `${key}: a face-down card has no rules text, so its destruction wipes nothing`);
}

// --- Basic Node ------------------------------------------------------------
// Character, cost 1, threshold [E], 1 strength / 4 speed / 1 life, subtype node.

clause(BASIC_NODE, "0:rule", "pays 1 with [E]; on entering play I search my own deck", () => {
  const { engine, id } = nodeEtbBoard(BASIC_NODE);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("n"))), 1);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(engine)?.playerId, P1);
});
clause(BASIC_NODE, "0:rule", "a node card (a character, or an item) from my deck is put into my hand", () => nodeEtbPicksIntoHand(BASIC_NODE));
clause(BASIC_NODE, "0:rule", "the found card is revealed to everyone", () => nodeEtbRevealsTheCard(BASIC_NODE));
clause(BASIC_NODE, "0:rule", "only a node card from my own deck, and only one: other cards, other zones, and two cards are refused", () => nodeEtbRefusals(BASIC_NODE));
clause(BASIC_NODE, "0:rule", "'may': I can find nothing (nothing is revealed or moved)", () => nodeEtbMayDecline(BASIC_NODE));
clause(BASIC_NODE, "0:rule", "the searched deck is shuffled afterwards (CR 312.1); the opponent's deck is not touched", () => nodeEtbShuffles(BASIC_NODE));
clause(BASIC_NODE, "0:rule", "failing the search (picking nothing) still shuffles the deck", () => nodeEtbShufflesWhenDeclined(BASIC_NODE));
clause(BASIC_NODE, "0:rule", "a search of a deck with no node card at all still shuffles it (CR 312.1)", () => nodeEtbNoNodesShuffles(BASIC_NODE));
clause(BASIC_NODE, "0:rule", "with no node card in my deck nothing happens: no prompt, nothing moves", () => nodeEtbNoNodes(BASIC_NODE));
clause(BASIC_NODE, "0:rule", "it triggers only for THIS card entering play, not for another card or another node", () => nodeEtbOnlyForItself(BASIC_NODE));

clause(BASIC_NODE, "1:rule", "when destroyed by an effect, every node card in play is destroyed: both players' characters, items and locations with the node subtype", () => nodeWipeByEffect(BASIC_NODE));
clause(BASIC_NODE, "1:rule", "...but nothing that is not a node card in play (no other subtype, hand, deck, discard pile, or face-down resource)", () => {
  nodeWipeByEffect(BASIC_NODE);
  nodeWipeIgnoresOtherZones(BASIC_NODE);
});
clause(BASIC_NODE, "1:rule", "also triggers when it is destroyed by lethal damage", () => nodeWipeByDamage(BASIC_NODE));
clause(BASIC_NODE, "1:rule", "does not trigger when it merely leaves play (returned to hand)", () => nodeWipeNotWhenBounced(BASIC_NODE));
clause(BASIC_NODE, "1:rule", "does not trigger when ANOTHER node card is destroyed", () => nodeWipeNotWhenOtherNodeDies(BASIC_NODE));
clause(BASIC_NODE, "1:rule", "a face-down card is only a resource (CR 411.1), so a face-down card whose printed subtype is node is NOT destroyed", () => nodeWipeSparesFaceDownCards(BASIC_NODE));
clause(BASIC_NODE, "1:rule", "a face-down copy (a resource, with no rules text) that is destroyed destroys no node card", () => nodeWipeNotWhenFaceDown(BASIC_NODE));
clause(BASIC_NODE, "0:rule", "played face-down as a resource it has no rules text: no search", () => nodeEtbNotWhenPlayedFaceDown(BASIC_NODE));
clause(BASIC_NODE, "1:rule", "the opponent's copy of the same card is destroyed too", () => nodeWipeKillsOtherNodeCardsOfTheSameName(BASIC_NODE));

clause(BASIC_NODE, "1:rule", "has its printed stats: 1 strength, 1 life, 4 speed, subtype node; refused one resource short or without [E]", () => {
  const board = (icons: Icons) => buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "n", def: printing(BASIC_NODE), owner: P1, zone: "hand" }, ...deckCards("a", 3, P1), ...res(icons)] });
  const none = board({});
  assert.throws(() => playRaw(none.engine, P1, none.id("n")), "no resources");
  const noThreshold = board({ rage: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("n")), "no [E]");
  const { engine, id } = board({ elitism: 1 });
  play(engine, P1, id("n"));
  assert.equal(engine.getStat(id("n"), "strength"), 1);
  assert.equal(engine.getStat(id("n"), "life"), 1);
  assert.equal(engine.getStat(id("n"), "speed"), 4);
  assert.deepEqual(engine.getSubtypes(id("n")), ["node"]);
});

// --- Hub Node --------------------------------------------------------------
// Character, cost 3, threshold [E][E][E], 2 strength / 3 speed / 2 life, subtype node.

clause(HUB_NODE, "0:rule", "pays 3 with [E][E][E]; on entering play I search my own deck", () => {
  const { engine, id } = nodeEtbBoard(HUB_NODE);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("n"))), 3);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(engine)?.playerId, P1);
});
clause(HUB_NODE, "0:rule", "a node card (a character, or an item) from my deck is put into my hand", () => nodeEtbPicksIntoHand(HUB_NODE));
clause(HUB_NODE, "0:rule", "the found card is revealed to everyone", () => nodeEtbRevealsTheCard(HUB_NODE));
clause(HUB_NODE, "0:rule", "only a node card from my own deck, and only one: other cards, other zones, and two cards are refused", () => nodeEtbRefusals(HUB_NODE));
clause(HUB_NODE, "0:rule", "'may': I can find nothing (nothing is revealed or moved)", () => nodeEtbMayDecline(HUB_NODE));
clause(HUB_NODE, "0:rule", "the searched deck is shuffled afterwards (CR 312.1); the opponent's deck is not touched", () => nodeEtbShuffles(HUB_NODE));
clause(HUB_NODE, "0:rule", "failing the search (picking nothing) still shuffles the deck", () => nodeEtbShufflesWhenDeclined(HUB_NODE));
clause(HUB_NODE, "0:rule", "a search of a deck with no node card at all still shuffles it (CR 312.1)", () => nodeEtbNoNodesShuffles(HUB_NODE));
clause(HUB_NODE, "0:rule", "with no node card in my deck nothing happens: no prompt, nothing moves", () => nodeEtbNoNodes(HUB_NODE));
clause(HUB_NODE, "0:rule", "it triggers only for THIS card entering play, not for another card or another node", () => nodeEtbOnlyForItself(HUB_NODE));

clause(HUB_NODE, "1:rule", "when destroyed by an effect, every node card in play is destroyed: both players' characters, items and locations with the node subtype", () => nodeWipeByEffect(HUB_NODE));
clause(HUB_NODE, "1:rule", "...but nothing that is not a node card in play (no other subtype, hand, deck, discard pile, or face-down resource)", () => {
  nodeWipeByEffect(HUB_NODE);
  nodeWipeIgnoresOtherZones(HUB_NODE);
});
clause(HUB_NODE, "1:rule", "also triggers when it is destroyed by lethal damage", () => nodeWipeByDamage(HUB_NODE));
clause(HUB_NODE, "1:rule", "does not trigger when it merely leaves play (returned to hand)", () => nodeWipeNotWhenBounced(HUB_NODE));
clause(HUB_NODE, "1:rule", "does not trigger when ANOTHER node card is destroyed", () => nodeWipeNotWhenOtherNodeDies(HUB_NODE));
clause(HUB_NODE, "1:rule", "a face-down card is only a resource (CR 411.1), so a face-down card whose printed subtype is node is NOT destroyed", () => nodeWipeSparesFaceDownCards(HUB_NODE));
clause(HUB_NODE, "1:rule", "a face-down copy (a resource, with no rules text) that is destroyed destroys no node card", () => nodeWipeNotWhenFaceDown(HUB_NODE));
clause(HUB_NODE, "0:rule", "played face-down as a resource it has no rules text: no search", () => nodeEtbNotWhenPlayedFaceDown(HUB_NODE));
clause(HUB_NODE, "1:rule", "the opponent's copy of the same card is destroyed too", () => nodeWipeKillsOtherNodeCardsOfTheSameName(HUB_NODE));
clause(HUB_NODE, "1:rule", "does not trigger when it takes non-lethal damage (its life is raised by the other nodes in play)", () => nodeWipeNotWhenSurvivesDamage(HUB_NODE));

function hubBoard(extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "hub", def: printing(HUB_NODE), owner: P1, zone: "play" }, ...extra]
  });
}

const nodeChar = (key: string, owner: PlayerId, zone: "play" | "hand" | "discard" | "deck" = "play", faceDown = false): CardPlacement => ({
  key,
  def: character({ name: key, subtype: ["node"] }),
  owner,
  zone,
  faceDown
});

clause(HUB_NODE, "2:rule", "alone, it has its printed stats: 2 strength and 2 life (it does not count itself)", () => {
  const { engine, id } = hubBoard();
  assert.equal(engine.getStat(id("hub"), "strength"), 2);
  assert.equal(engine.getStat(id("hub"), "life"), 2);
  assert.equal(engine.getStat(id("hub"), "speed"), 3);
});

for (const count of [1, 2, 4]) {
  clause(HUB_NODE, "2:rule", `with ${count} other node card(s) in play it gains ${count} strength and ${count} life`, () => {
    const nodes = Array.from({ length: count }, (_, i) => nodeChar(`n${i}`, i % 2 === 0 ? P1 : P2));
    const { engine, id } = hubBoard(nodes);
    assert.equal(engine.getStat(id("hub"), "strength"), 2 + count);
    assert.equal(engine.getStat(id("hub"), "life"), 2 + count);
    assert.equal(engine.getStat(id("hub"), "speed"), 3, "speed is unchanged");
  });
}

clause(HUB_NODE, "2:rule", "both players' node cards count, and node items and locations count too", () => {
  const { engine, id } = hubBoard([
    nodeChar("mine", P1),
    nodeChar("theirs", P2),
    { key: "nodeItem", def: item({ name: "NodeItem", subtype: ["node"] }), owner: P2, zone: "play" },
    { key: "nodeLoc", def: location({ name: "NodeLoc", subtype: ["node"] }), owner: P1, zone: "play" }
  ]);
  assert.equal(engine.getStat(id("hub"), "strength"), 2 + 4);
  assert.equal(engine.getStat(id("hub"), "life"), 2 + 4);
});

clause(HUB_NODE, "2:rule", "only cards in play that are nodes count: non-node cards, and node cards in hand, deck, discard pile or face-down do not", () => {
  const { engine, id } = hubBoard([
    { key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "play" },
    { key: "gear", def: item({ name: "Gear", subtype: ["gear"] }), owner: P2, zone: "play" },
    nodeChar("inHand", P1, "hand"),
    nodeChar("inDeck", P1, "deck"),
    nodeChar("inDiscard", P2, "discard"),
    nodeChar("counted", P1)
  ]);
  assert.equal(engine.getStat(id("hub"), "strength"), 2 + 1, "only the one real node in play counts");
  assert.equal(engine.getStat(id("hub"), "life"), 2 + 1);
});

clause(HUB_NODE, "2:rule", "a face-down card is only a resource (CR 411.1), so a face-down card whose printed subtype is node is NOT counted", () => {
  const { engine, id } = hubBoard([nodeChar("faceDown", P2, "play", true), nodeChar("faceDown2", P1, "play", true), nodeChar("counted", P1)]);
  assert.equal(engine.getStat(id("hub"), "strength"), 2 + 1, "only the face-up node counts");
  assert.equal(engine.getStat(id("hub"), "life"), 2 + 1);
});

clause(HUB_NODE, "2:rule", "another Hub Node counts, and each gets the bonus from the other (and from a Basic Node)", () => {
  const { engine, id } = hubBoard([
    { key: "hub2", def: printing(HUB_NODE), owner: P2, zone: "play" },
    { key: "basic", def: printing(BASIC_NODE), owner: P1, zone: "play" }
  ]);
  assert.equal(engine.getStat(id("hub"), "strength"), 2 + 2, "the other Hub Node and the Basic Node");
  assert.equal(engine.getStat(id("hub2"), "strength"), 2 + 2);
  assert.equal(engine.getStat(id("basic"), "strength"), 1, "a Basic Node has no such rule");
});

clause(HUB_NODE, "2:rule", "the bonus follows the board: it drops again when a node card leaves play", () => {
  const { engine, id } = hubBoard([nodeChar("n0", P1), nodeChar("n1", P2), { key: "kill", def: killTactic(), owner: P1, zone: "hand" }]);
  assert.equal(engine.getStat(id("hub"), "strength"), 4);
  // destroying a non-Basic/Hub node does not wipe the board: only Basic/Hub do
  play(engine, P1, id("kill"), { selected: { t: [id("n1")] } });
  assert.equal(zoneOf(engine, id("n1")), "discard");
  assert.equal(engine.getStat(id("hub"), "strength"), 3);
  assert.equal(engine.getStat(id("hub"), "life"), 3);
});

clause(HUB_NODE, "2:rule", "the extra life is real: with two other nodes (life 4) it survives 3 damage and dies to 4", () => {
  const { engine, id } = hubBoard([nodeChar("n0", P1), nodeChar("n1", P2), { key: "z3", def: zapTactic("Z3", 3), owner: P1, zone: "hand" }, { key: "z1", def: zapTactic("Z1", 1), owner: P1, zone: "hand" }]);
  play(engine, P1, id("z3"), { selected: { t: [id("hub")] } });
  assert.equal(zoneOf(engine, id("hub")), "play");
  play(engine, P1, id("z1"), { selected: { t: [id("hub")] } });
  assert.equal(zoneOf(engine, id("hub")), "discard");
});

clause(HUB_NODE, "2:rule", "has its printed stats and subtype node; refused one resource short or without [E][E][E]", () => {
  const board = (icons: Icons) => buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "n", def: printing(HUB_NODE), owner: P1, zone: "hand" }, ...deckCards("a", 3, P1), ...res(icons)] });
  const short = board({ elitism: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("n")), "two resources");
  const twoE = board({ elitism: 2, rage: 4 });
  assert.throws(() => playRaw(twoE.engine, P1, twoE.id("n")), "only two [E]");
  const { engine, id } = board({ elitism: 3 });
  play(engine, P1, id("n"));
  assert.equal(zoneOf(engine, id("n")), "play");
  assert.equal(ready(engine), 0);
  assert.deepEqual(engine.getSubtypes(id("n")), ["node"]);
});

// --- Devastating Mockery ---------------------------------------------------
// COST: Pick a character. -- EFFECT: If the character is COVERT, it loses COVERT
// this turn. Then, draw a card. Tactic, cost 2, threshold [E].

const MOCKERY = "066b5a18-7c0f-4ffc-85dd-51a831c84d7c";

const covertDef = (name: string, extra: Partial<CardDefinition> = {}): CardDefinition =>
  character({ name, strength: 2, life: 4, speed: 2, behavior: { keywords: ["covert"] }, ...extra });

/** A free tactic that gives a chosen character COVERT this turn (id `grant`, declaration `t`). */
const grantCovertTactic = (): CardDefinition =>
  tactic({
    name: "GrantCovert",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "grant",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "grantKeyword", target: { type: "selected", id: "t" }, keyword: "covert", duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });

function mockeryBoard(opts: { icons?: Icons; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "dm", def: printing(MOCKERY), owner: P1, zone: "hand" },
      { key: "covertMine", def: covertDef("CovertMine"), owner: P1, zone: "play" },
      { key: "plainMine", def: character({ name: "PlainMine", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "covertFoe", def: covertDef("CovertFoe"), owner: P2, zone: "play" },
      { key: "covertFoe2", def: covertDef("CovertFoe2"), owner: P2, zone: "play" },
      { key: "plainFoe", def: character({ name: "PlainFoe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      ...deckCards("a", 4, P1),
      ...deckCards("b", 3, P2),
      ...res(opts.icons ?? { elitism: 4 }),
      ...(opts.extra ?? [])
    ]
  });
}

const isCovert = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.getKeywords(cardId).includes("covert");

clause(MOCKERY, "0:ability", "pays 2; a COVERT character loses COVERT and no other character does; its controller then draws exactly one card", () => {
  const { engine, id } = mockeryBoard();
  assert.equal(isCovert(engine, id("covertFoe")), true);
  const top = deckOf(engine, P1)[0];
  const handBefore = handOf(engine, P1).length;
  const spent = spentBy(engine, P1, () => play(engine, P1, id("dm"), { selected: { c: [id("covertFoe")] } }));
  assert.equal(spent, 2, "the printed cost of 2");
  assert.equal(isCovert(engine, id("covertFoe")), false, "the picked character lost COVERT");
  assert.equal(isCovert(engine, id("covertFoe2")), true, "another covert character keeps it");
  assert.equal(isCovert(engine, id("covertMine")), true, "so does my own");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1, "exactly one card drawn");
  assert.equal(zoneOf(engine, top), "hand", "the top card of my deck");
  assert.equal(zoneOf(engine, id("dm")), "discard");
});

clause(MOCKERY, "0:ability", "works on my own covert character too", () => {
  const { engine, id } = mockeryBoard();
  play(engine, P1, id("dm"), { selected: { c: [id("covertMine")] } });
  assert.equal(isCovert(engine, id("covertMine")), false);
  assert.equal(isCovert(engine, id("covertFoe")), true);
});

clause(MOCKERY, "0:ability", "a character that is not COVERT stays not covert, nothing else changes about it, and I still draw a card", () => {
  const { engine, id } = mockeryBoard();
  const handBefore = handOf(engine, P1).length;
  const before = [...engine.getKeywords(id("plainFoe"))];
  play(engine, P1, id("dm"), { selected: { c: [id("plainFoe")] } });
  assert.equal(isCovert(engine, id("plainFoe")), false);
  assert.deepEqual(engine.getKeywords(id("plainFoe")), before);
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1);
  assert.equal(isCovert(engine, id("covertFoe")), true, "no other character is affected");
});

clause(MOCKERY, "0:ability", "the character loses only COVERT: its other keywords stay", () => {
  const both = character({ name: "Both", strength: 2, life: 4, speed: 2, behavior: { keywords: ["covert", "aggro"] } });
  const { engine, id } = mockeryBoard({ extra: [{ key: "both", def: both, owner: P2, zone: "play" }] });
  assert.ok(engine.getKeywords(id("both")).includes("aggro"), "engine.getKeywords(id(\"both\")).includes(\"aggro\")");
  play(engine, P1, id("dm"), { selected: { c: [id("both")] } });
  assert.equal(isCovert(engine, id("both")), false);
  assert.ok(engine.getKeywords(id("both")).includes("aggro"), "AGGRO is untouched");
});

clause(MOCKERY, "0:ability", "COVERT that was only granted this turn is lost too", () => {
  const { engine, id } = mockeryBoard({ extra: [{ key: "grant", def: grantCovertTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("grant"), { selected: { t: [id("plainMine")] } });
  assert.equal(isCovert(engine, id("plainMine")), true, "granted");
  play(engine, P1, id("dm"), { selected: { c: [id("plainMine")] } });
  assert.equal(isCovert(engine, id("plainMine")), false, "and lost again");
});

clause(MOCKERY, "0:ability", "COVERT is lost 'this turn': a character that is covert by its print has it back in the next turn", () => {
  const { engine, id } = mockeryBoard();
  play(engine, P1, id("dm"), { selected: { c: [id("covertMine")] } });
  assert.equal(isCovert(engine, id("covertMine")), false);
  endTurn(engine, P1);
  assert.equal(isCovert(engine, id("covertMine")), true, "it has COVERT again once the turn ends");
  endTurn(engine, P2);
  assert.equal(isCovert(engine, id("covertMine")), true);
});

clause(MOCKERY, "0:ability", "while it is lost, a later grant of COVERT the same turn does not bring it back (the loss wins, CR 402.6)", () => {
  const { engine, id } = mockeryBoard({ extra: [{ key: "grant", def: grantCovertTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("dm"), { selected: { c: [id("covertMine")] } });
  play(engine, P1, id("grant"), { selected: { t: [id("covertMine")] } });
  assert.equal(isCovert(engine, id("covertMine")), false);
});

clause(MOCKERY, "0:ability", "the loss is real in a battle: a lone covert attacker whose COVERT is removed before blocks can be blocked by a non-covert character", () => {
  const board = () =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "dm", def: printing(MOCKERY), owner: P2, zone: "hand" },
        { key: "sneak", def: covertDef("Sneak"), owner: P1, zone: "play" },
        { key: "plainBlocker", def: character({ name: "PlainBlocker", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" },
        ...deckCards("b", 3, P2),
        ...res({ elitism: 4 }, P2)
      ]
    });
  const control = board();
  declareAttackBy(control.engine, P1, [control.id("sneak")]);
  assert.throws(() => control.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [control.id("plainBlocker")] }), "control: a covert party cannot be blocked by a plain character");

  const { engine, id } = board();
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("sneak")], target: { type: "faction", playerId: P2 } });
  untilPriority(engine, P2);
  engine.perform({ type: "playCard", playerId: P2, cardId: id("dm"), selected: { c: [id("sneak")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(isCovert(engine, id("sneak")), false);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("plainBlocker")] });
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("plainBlocker")], "the party is no longer covert, so a plain character may block");
});

clause(MOCKERY, "0:ability", "the pick must be a character in play: an item, a location, a faction, a face-down resource, or a character in hand / discard are refused", () => {
  const { engine, id } = mockeryBoard({
    extra: [
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "inHand", def: covertDef("InHand"), owner: P2, zone: "hand" },
      { key: "inDiscard", def: covertDef("InDiscard"), owner: P2, zone: "discard" },
      ...volition(1, P2).map((p) => ({ ...p, key: "downResource" }))
    ]
  });
  const attempt = (picked: string) => () => playRaw(engine, P1, id("dm"), { selected: { c: [picked] } });
  assert.throws(attempt(id("thing")), "item");
  assert.throws(attempt(id("place")), "location");
  assert.throws(attempt(factionOf(engine, P2)), "their faction (CR 202.9)");
  assert.throws(attempt(factionOf(engine, P1)), "my faction");
  assert.throws(attempt(id("downResource")), "face-down card");
  assert.throws(attempt(id("inHand")), "hand");
  assert.throws(attempt(id("inDiscard")), "discard pile");
  assert.throws(() => playRaw(engine, P1, id("dm"), { selected: {} }), "no pick");
  assert.throws(() => playRaw(engine, P1, id("dm"), { selected: { c: [id("covertFoe"), id("covertFoe2")] } }), "two picks");
  assert.equal(zoneOf(engine, id("dm")), "hand");
  attempt(id("covertFoe"))();
  assert.ok(engine.state.responseWindow, "a character in play is accepted");
});

clause(MOCKERY, "0:ability", "if the picked character is destroyed in response, the tactic still resolves as far as it can: I still draw the card", () => {
  const { engine, id } = mockeryBoard({ extra: [{ key: "foeKill", def: killTactic({ name: "FoeKill" }), owner: P2, zone: "hand" }] });
  const handBefore = handOf(engine, P1).length;
  playRaw(engine, P1, id("dm"), { selected: { c: [id("covertFoe")] } });
  engine.perform({ type: "playCard", playerId: P2, cardId: id("foeKill"), selected: { t: [id("covertFoe")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("covertFoe")), "discard");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1, "the draw still happens (CR 402.5)");
  assert.equal(isCovert(engine, id("covertFoe2")), true);
});

clause(MOCKERY, "0:ability", "with an empty deck COVERT is still lost and nothing is drawn", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "dm", def: printing(MOCKERY), owner: P1, zone: "hand" },
      { key: "covertFoe", def: covertDef("CovertFoe"), owner: P2, zone: "play" },
      ...res({ elitism: 2 })
    ]
  });
  play(engine, P1, id("dm"), { selected: { c: [id("covertFoe")] } });
  assert.equal(isCovert(engine, id("covertFoe")), false);
  assert.equal(handOf(engine, P1).length, 0);
});

clause(MOCKERY, "0:ability", "is refused one resource short of its cost of 2, and without [E] even with plenty of other resources", () => {
  const short = mockeryBoard({ icons: { elitism: 1 } });
  assert.throws(() => playRaw(short.engine, P1, short.id("dm"), { selected: { c: [short.id("covertFoe")] } }));
  assert.equal(zoneOf(short.engine, short.id("dm")), "hand");
  const noThreshold = mockeryBoard({ icons: { rage: 6, greed: 3 } });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("dm"), { selected: { c: [noThreshold.id("covertFoe")] } }));
  const exact = mockeryBoard({ icons: { elitism: 2 } });
  play(exact.engine, P1, exact.id("dm"), { selected: { c: [exact.id("covertFoe")] } });
  assert.equal(isCovert(exact.engine, exact.id("covertFoe")), false, "[E] and exactly 2 resources is enough");
  assert.equal(ready(exact.engine), 0);
});

// --- Epiphanal Mechanic ----------------------------------------------------
// DEVELOPMENT -- COST: Deplete this card. -- EFFECT: Search your deck for an item
// and put it into your hand.
// DEPLOYMENT -- COST: Deplete this card. -- EFFECT: You may play an item for free.
// (You still need the proper resource icons.)
// Character, cost 9, threshold [E][E], 1 strength / 3 speed / 1 life, inventor.

const EPIPHANAL = "dba0f535-7024-4592-89cc-4419ec680978";

function mechanicBoard(opts: { itemsInDeck?: boolean; icons?: Icons; extra?: CardPlacement[]; emZone?: "play" | "hand"; attackEligible?: boolean } = {}) {
  const items = opts.itemsInDeck ?? true;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "em", def: printing(EPIPHANAL), owner: P1, zone: opts.emZone ?? "play", attackEligible: opts.attackEligible },
      ...deckCards("a", 4, P1),
      ...(items
        ? [
            { key: "deckItem", def: item({ name: "DeckItem", cost: 3 }), owner: P1, zone: "deck" as const },
            { key: "deckGear", def: item({ name: "DeckGear", cost: 2, subtype: ["gear"] }), owner: P1, zone: "deck" as const }
          ]
        : []),
      { key: "deckTactic", def: cantrip("DeckTactic", 1), owner: P1, zone: "deck" },
      { key: "deckLocation", def: location({ name: "DeckLocation", cost: 1 }), owner: P1, zone: "deck" },
      ...deckCards("z", 4, P1),
      { key: "handItem", def: item({ name: "HandItem", cost: 5 }), owner: P1, zone: "hand" },
      { key: "handBigItem", def: item({ name: "HandBigItem", cost: 9 }), owner: P1, zone: "hand" },
      { key: "handRageItem", def: item({ name: "HandRageItem", cost: 1, threshold: "rr" as never }), owner: P1, zone: "hand" },
      { key: "handChar", def: character({ name: "HandChar", cost: 1 }), owner: P1, zone: "hand" },
      { key: "handTactic", def: cantrip("HandTactic", 1), owner: P1, zone: "hand" },
      { key: "handLocation", def: location({ name: "HandLocation", cost: 1 }), owner: P1, zone: "hand" },
      { key: "discardItem", def: item({ name: "DiscardItem" }), owner: P1, zone: "discard" },
      { key: "oppItem", def: item({ name: "OppItem" }), owner: P2, zone: "deck" },
      { key: "oppHandItem", def: item({ name: "OppHandItem" }), owner: P2, zone: "hand" },
      ...deckCards("b", 3, P2),
      { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
      ...res(opts.icons ?? { elitism: 4 }),
      ...(opts.extra ?? [])
    ]
  });
}

clause(EPIPHANAL, "0:ability:development", "depletes this card and lets me search my own deck for an item", () => {
  const { engine, id } = mechanicBoard();
  const resources = ready(engine);
  activate(engine, P1, id("em"), "development");
  assert.equal(engine.state.cards[id("em")].depleted, true, "COST: Deplete this card");
  assert.equal(ready(engine), resources, "no resources are spent");
  const pc = pending(engine);
  assert.ok(pc, "a search prompt is open");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
});

clause(EPIPHANAL, "0:ability:development", "the item I find goes into my HAND (not into play), and the rest of the deck stays", () => {
  const { engine, id } = mechanicBoard();
  const handBefore = handOf(engine, P1).length;
  activate(engine, P1, id("em"), "development");
  pickCards(engine, P1, [id("deckItem")]);
  assert.equal(zoneOf(engine, id("deckItem")), "hand");
  assert.equal(handOf(engine, P1).length, handBefore + 1);
  assert.equal(zoneOf(engine, id("deckGear")), "deck", "the other item stays in the deck");
  assert.equal(pending(engine), undefined);
});

clause(EPIPHANAL, "0:ability:development", "any item will do, including a gear item", () => {
  const { engine, id } = mechanicBoard();
  activate(engine, P1, id("em"), "development");
  pickCards(engine, P1, [id("deckGear")]);
  assert.equal(zoneOf(engine, id("deckGear")), "hand");
});

clause(EPIPHANAL, "0:ability:development", "only an ITEM from MY DECK, and only one: a character, tactic or location in the deck, and items in hand, discard pile or the opponent's deck are refused", () => {
  const { engine, id } = mechanicBoard();
  activate(engine, P1, id("em"), "development");
  assert.throws(tryPick(engine, P1, [id("a0")]), "a character");
  assert.throws(tryPick(engine, P1, [id("deckTactic")]), "a tactic");
  assert.throws(tryPick(engine, P1, [id("deckLocation")]), "a location");
  assert.throws(tryPick(engine, P1, [id("handItem")]), "an item in my hand");
  assert.throws(tryPick(engine, P1, [id("discardItem")]), "an item in my discard pile");
  assert.throws(tryPick(engine, P1, [id("oppItem")]), "an item in the opponent's deck");
  assert.throws(tryPick(engine, P1, [id("deckItem"), id("deckGear")]), "two items");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
});

clause(EPIPHANAL, "0:ability:development", "the search can fail on purpose (CR 312.2): I can find nothing, and the cost is still paid", () => {
  const { engine, id } = mechanicBoard();
  activate(engine, P1, id("em"), "development");
  pickCards(engine, P1, []);
  assert.equal(zoneOf(engine, id("deckItem")), "deck");
  assert.equal(engine.state.cards[id("em")].depleted, true);
});

clause(EPIPHANAL, "0:ability:development", "the searched deck is shuffled afterwards (CR 312.1), also when nothing was found by choice; the opponent's deck is not touched", () => {
  const found = mechanicBoard();
  const before = found.engine.state.players[P1].deck.filter((c) => c !== found.id("deckItem"));
  const oppDeck = [...deckOf(found.engine, P2)];
  activate(found.engine, P1, found.id("em"), "development");
  pickCards(found.engine, P1, [found.id("deckItem")]);
  assert.deepEqual([...deckOf(found.engine, P1)].sort(), [...before].sort(), "same cards");
  assert.notDeepEqual(deckOf(found.engine, P1), before, "in a new order");
  assert.deepEqual(deckOf(found.engine, P2), oppDeck);

  const declined = mechanicBoard();
  const all = [...deckOf(declined.engine, P1)];
  activate(declined.engine, P1, declined.id("em"), "development");
  pickCards(declined.engine, P1, []);
  assert.deepEqual([...deckOf(declined.engine, P1)].sort(), [...all].sort());
  assert.notDeepEqual(deckOf(declined.engine, P1), all, "a searched deck is shuffled even when nothing was taken");
});

clause(EPIPHANAL, "0:ability:development", "a search of a deck with no item at all still shuffles it (CR 312.1)", () => {
  const { engine, id } = mechanicBoard({ itemsInDeck: false });
  const before = [...deckOf(engine, P1)];
  activate(engine, P1, id("em"), "development");
  drain(engine, declineAll);
  assert.equal(engine.state.cards[id("em")].depleted, true, "the cost was paid");
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...before].sort());
  assert.notDeepEqual(deckOf(engine, P1), before, "the deck was searched, so it is shuffled");
});

clause(EPIPHANAL, "0:ability:development", "with no item in my deck nothing is found: the cost is paid and no prompt opens", () => {
  const { engine, id } = mechanicBoard({ itemsInDeck: false });
  const handBefore = handOf(engine, P1).length;
  activate(engine, P1, id("em"), "development");
  assert.equal(engine.state.cards[id("em")].depleted, true);
  assert.equal(pending(engine), undefined);
  assert.equal(handOf(engine, P1).length, handBefore);
});

clause(EPIPHANAL, "0:ability:development", "cannot be used while depleted, and not twice in a turn", () => {
  const { engine, id } = mechanicBoard();
  activate(engine, P1, id("em"), "development");
  pickCards(engine, P1, [id("deckItem")]);
  assert.throws(() => activate(engine, P1, id("em"), "development"), "already depleted");
  assert.throws(() => activate(engine, P1, id("em"), "deployment"), "DEPLOYMENT needs the same depletion");
  assert.equal(zoneOf(engine, id("deckGear")), "deck");
});

clause(EPIPHANAL, "0:ability:development", "can be used the turn it came into play, and again after it restores next turn", () => {
  const { engine, id } = mechanicBoard({ attackEligible: false });
  activate(engine, P1, id("em"), "development");
  pickCards(engine, P1, [id("deckItem")]);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("em")].depleted, false, "restored");
  activate(engine, P1, id("em"), "development");
  pickCards(engine, P1, [id("deckGear")]);
  assert.equal(zoneOf(engine, id("deckGear")), "hand");
});

clause(EPIPHANAL, "0:ability:development", "only its controller can use it", () => {
  const { engine, id } = mechanicBoard();
  assert.throws(() => engine.perform({ type: "activateAbility", playerId: P2, cardId: id("em"), abilityId: "development", selected: {}, variables: {} }));
  assert.equal(engine.state.cards[id("em")].depleted, false);
});

clause(EPIPHANAL, "0:ability:development", "deploys for exactly 9 with [E][E] (refused one short or with one [E]) and has its printed 1 strength / 1 life / 3 speed, subtype inventor", () => {
  const board = (icons: Icons) => mechanicBoard({ emZone: "hand", icons });
  const short = board({ elitism: 8 });
  assert.throws(() => playRaw(short.engine, P1, short.id("em")), "8 resources");
  const oneE = board({ elitism: 1, rage: 9 });
  assert.throws(() => playRaw(oneE.engine, P1, oneE.id("em")), "one [E]");
  const { engine, id } = board({ elitism: 2, rage: 7 });
  play(engine, P1, id("em"));
  assert.equal(zoneOf(engine, id("em")), "play");
  assert.equal(ready(engine), 0, "exactly 9 spent");
  assert.equal(engine.getStat(id("em"), "strength"), 1);
  assert.equal(engine.getStat(id("em"), "life"), 1);
  assert.equal(engine.getStat(id("em"), "speed"), 3);
  assert.deepEqual(engine.getSubtypes(id("em")), ["inventor"]);
});

const deploymentChoice = (engine: SpoilsEngine, cardId?: string, selected?: Record<string, string[]>) =>
  answerChoice(engine, "deployForFree", P1, { cardId, selected });

clause(EPIPHANAL, "1:ability:deployment", "depletes this card and offers me the items in my hand", () => {
  const { engine, id } = mechanicBoard();
  activate(engine, P1, id("em"), "deployment");
  assert.equal(engine.state.cards[id("em")].depleted, true, "COST: Deplete this card");
  const names = offeredTo(engine, P1);
  assert.ok(names.includes("HandItem") && names.includes("HandBigItem"), "my hand items");
  for (const other of ["HandChar", "HandTactic", "HandLocation", "DeckItem", "DiscardItem", "OppHandItem"]) assert.ok(!names.includes(other), `${other} is not an item in my hand`);
});

clause(EPIPHANAL, "1:ability:deployment", "the item I pick enters play under my control for free, whatever it costs (a cost-5 item and a cost-9 item with 4 resources)", () => {
  for (const key of ["handItem", "handBigItem"]) {
    const { engine, id } = mechanicBoard();
    const resources = ready(engine);
    activate(engine, P1, id("em"), "deployment");
    deploymentChoice(engine, id(key));
    assert.equal(zoneOf(engine, id(key)), "play", key);
    assert.equal(engine.state.cards[id(key)].controllerId, P1);
    assert.equal(ready(engine), resources, "no resources were spent");
    assert.equal(zoneOf(engine, id("handChar")), "hand");
  }
});

clause(EPIPHANAL, "1:ability:deployment", "'may': I can decline and nothing is played", () => {
  const { engine, id } = mechanicBoard();
  activate(engine, P1, id("em"), "deployment");
  deploymentChoice(engine, undefined);
  for (const key of ["handItem", "handBigItem", "handRageItem"]) assert.equal(zoneOf(engine, id(key)), "hand");
  assert.equal(engine.state.cards[id("em")].depleted, true, "the cost was paid anyway");
});

clause(EPIPHANAL, "1:ability:deployment", "only an ITEM of my hand may be chosen: a character, tactic, location, a deck item, a discard item, or the opponent's item are refused", () => {
  const { engine, id } = mechanicBoard();
  activate(engine, P1, id("em"), "deployment");
  for (const key of ["handChar", "handTactic", "handLocation", "deckItem", "discardItem", "oppHandItem"]) {
    assert.throws(tryFree(engine, P1, id(key)), key);
  }
  assert.equal(pending(engine)?.kind, "deployForFree", "still waiting for a legal answer");
  deploymentChoice(engine, id("handItem"));
  assert.equal(zoneOf(engine, id("handItem")), "play");
});

clause(EPIPHANAL, "1:ability:deployment", "'you still need the proper resource icons': an item needing [R][R] is refused without them and playable with them", () => {
  const without = mechanicBoard();
  activate(without.engine, P1, without.id("em"), "deployment");
  assert.throws(tryFree(without.engine, P1, without.id("handRageItem")), "no [R][R]");
  assert.equal(zoneOf(without.engine, without.id("handRageItem")), "hand");
  const withRage = mechanicBoard({ icons: { elitism: 2, rage: 2 } });
  activate(withRage.engine, P1, withRage.id("em"), "deployment");
  deploymentChoice(withRage.engine, withRage.id("handRageItem"));
  assert.equal(zoneOf(withRage.engine, withRage.id("handRageItem")), "play");
});

clause(EPIPHANAL, "1:ability:deployment", "an ATTACH TO item played this way still attaches to a character I pick: Luteoderm Armor goes onto my character", () => {
  const { engine, id } = mechanicBoard({ extra: [{ key: "armor", def: printing(ARMOR), owner: P1, zone: "hand" }] });
  activate(engine, P1, id("em"), "deployment");
  deploymentChoice(engine, id("armor"), { attachTo: [id("host")] });
  assert.equal(zoneOf(engine, id("armor")), "play");
  assert.equal(engine.state.cards[id("armor")].attachedTo, id("host"));
  assert.equal(engine.getStat(id("host"), "strength"), 1 + 2);
});

clause(EPIPHANAL, "1:ability:deployment", "with no item in my hand it costs the depletion and does nothing", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "em", def: printing(EPIPHANAL), owner: P1, zone: "play" },
      { key: "handChar", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
      ...res({ elitism: 2 })
    ]
  });
  activate(engine, P1, id("em"), "deployment");
  assert.equal(engine.state.cards[id("em")].depleted, true);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("handChar")), "hand");
});

clause(EPIPHANAL, "1:ability:deployment", "cannot be used while depleted, only by its controller, and is separate from DEVELOPMENT (using one depletes it for the other)", () => {
  const { engine, id } = mechanicBoard();
  assert.throws(() => engine.perform({ type: "activateAbility", playerId: P2, cardId: id("em"), abilityId: "deployment", selected: {}, variables: {} }));
  engine.state.cards[id("em")].depleted = true;
  assert.throws(() => activate(engine, P1, id("em"), "deployment"));
  assert.equal(pending(engine), undefined);
});

clause(EPIPHANAL, "1:ability:deployment", "the opponent gets no free play from it", () => {
  const { engine, id } = mechanicBoard();
  activate(engine, P1, id("em"), "deployment");
  deploymentChoice(engine, id("handItem"));
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("oppHandItem")), "hand");
});

// --- I Got the Gear! -------------------------------------------------------
// You may search your deck for a "gear" card. If you do, reveal it, and put it
// into your hand. Tactic, cost 1, threshold [E].

const GOT_THE_GEAR = "979d3623-d758-4c61-b765-6e8b7b1eb4d5";

function gearBoard(opts: { gearInDeck?: boolean; icons?: Icons } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ig", def: printing(GOT_THE_GEAR), owner: P1, zone: "hand" },
      ...deckCards("a", 4, P1),
      ...(opts.gearInDeck === false
        ? []
        : [
            { key: "gearA", def: item({ name: "GearA", cost: 0, subtype: ["gear"] }), owner: P1, zone: "deck" as const },
            { key: "goliath", def: printing(GOLIATH), owner: P1, zone: "deck" as const },
            { key: "notGear", def: item({ name: "NotGear", subtype: ["majig"] }), owner: P1, zone: "deck" as const },
            { key: "plainItem", def: item({ name: "PlainItem" }), owner: P1, zone: "deck" as const }
          ]),
      ...deckCards("z", 4, P1),
      { key: "gearHand", def: item({ name: "GearHand", subtype: ["gear"] }), owner: P1, zone: "hand" },
      { key: "gearDiscard", def: item({ name: "GearDiscard", subtype: ["gear"] }), owner: P1, zone: "discard" },
      { key: "oppGear", def: item({ name: "OppGear", subtype: ["gear"] }), owner: P2, zone: "deck" },
      ...deckCards("b", 3, P2),
      ...res(opts.icons ?? { elitism: 3 })
    ]
  });
}

clause(GOT_THE_GEAR, "0:rule", "pays 1; I search my own deck, and a gear card I find is revealed and put into my HAND (not into play)", () => {
  const { engine, id } = gearBoard();
  const spent = spentBy(engine, P1, () => play(engine, P1, id("ig")));
  assert.equal(spent, 1, "the printed cost of 1");
  const pc = pending(engine);
  assert.ok(pc, "a search prompt is open");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  pickCards(engine, P1, [id("gearA")]);
  assert.equal(zoneOf(engine, id("gearA")), "hand");
  assert.equal(zoneOf(engine, id("ig")), "discard", "the tactic ends in my discard pile");
  const reveals = revealEvents(engine);
  assert.equal(reveals.length, 1, "the found card is revealed");
  const ev = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual(ev.cardIds, [id("gearA")]);
  assert.equal(ev.viewerId, "all", "to everyone");
});

clause(GOT_THE_GEAR, "0:rule", "a gear card of any cost can be found (Luteoderm Goliath, cost 8)", () => {
  const { engine, id } = gearBoard();
  play(engine, P1, id("ig"));
  pickCards(engine, P1, [id("goliath")]);
  assert.equal(zoneOf(engine, id("goliath")), "hand");
});

clause(GOT_THE_GEAR, "0:rule", "only a gear card from my own deck, and only one: other items, a character, other zones, the opponent's deck and two cards are refused", () => {
  const { engine, id } = gearBoard();
  play(engine, P1, id("ig"));
  assert.throws(tryPick(engine, P1, [id("notGear")]), "an item with another subtype");
  assert.throws(tryPick(engine, P1, [id("plainItem")]), "an item with no subtype");
  assert.throws(tryPick(engine, P1, [id("a0")]), "a character");
  assert.throws(tryPick(engine, P1, [id("gearHand")]), "my hand");
  assert.throws(tryPick(engine, P1, [id("gearDiscard")]), "my discard pile");
  assert.throws(tryPick(engine, P1, [id("oppGear")]), "the opponent's deck");
  assert.throws(tryPick(engine, P1, [id("gearA"), id("goliath")]), "two gear cards");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
});

clause(GOT_THE_GEAR, "0:rule", "'may': I can find nothing; nothing is revealed and my hand does not change", () => {
  const { engine, id } = gearBoard();
  const handBefore = handOf(engine, P1).length;
  play(engine, P1, id("ig"));
  pickCards(engine, P1, []);
  assert.equal(handOf(engine, P1).length, handBefore - 1);
  assert.equal(zoneOf(engine, id("gearA")), "deck");
  assert.equal(revealEvents(engine).length, 0);
});

clause(GOT_THE_GEAR, "0:rule", "the searched deck is shuffled afterwards, also when nothing was taken; the opponent's deck is not touched", () => {
  const found = gearBoard();
  const before = deckOf(found.engine, P1).filter((c) => c !== found.id("gearA"));
  const oppDeck = [...deckOf(found.engine, P2)];
  play(found.engine, P1, found.id("ig"));
  pickCards(found.engine, P1, [found.id("gearA")]);
  assert.deepEqual([...deckOf(found.engine, P1)].sort(), [...before].sort());
  assert.notDeepEqual(deckOf(found.engine, P1), before, "in a new order");
  assert.deepEqual(deckOf(found.engine, P2), oppDeck);

  const declined = gearBoard();
  const all = [...deckOf(declined.engine, P1)];
  play(declined.engine, P1, declined.id("ig"));
  pickCards(declined.engine, P1, []);
  assert.deepEqual([...deckOf(declined.engine, P1)].sort(), [...all].sort());
  assert.notDeepEqual(deckOf(declined.engine, P1), all, "a searched deck is shuffled even when nothing was taken");
});

clause(GOT_THE_GEAR, "0:rule", "a search of a deck with no gear card at all still shuffles it (CR 312.1)", () => {
  const { engine, id } = gearBoard({ gearInDeck: false });
  const before = [...deckOf(engine, P1)];
  play(engine, P1, id("ig"));
  drain(engine, declineAll);
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...before].sort());
  assert.notDeepEqual(deckOf(engine, P1), before, "the deck was searched, so it is shuffled");
});

clause(GOT_THE_GEAR, "0:rule", "with no gear card in my deck nothing happens: no prompt, nothing revealed", () => {
  const { engine, id } = gearBoard({ gearInDeck: false });
  const handBefore = handOf(engine, P1).length;
  play(engine, P1, id("ig"));
  assert.equal(pending(engine), undefined);
  assert.equal(handOf(engine, P1).length, handBefore - 1);
  assert.equal(revealEvents(engine).length, 0);
});

clause(GOT_THE_GEAR, "0:rule", "is refused when I cannot pay its cost of 1 or lack [E] (other resources do not help)", () => {
  const none = gearBoard({ icons: {} });
  assert.throws(() => playRaw(none.engine, P1, none.id("ig")), "no resources");
  assert.equal(zoneOf(none.engine, none.id("ig")), "hand");
  const noThreshold = gearBoard({ icons: { rage: 5, greed: 2 } });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("ig")), "no [E]");
  const exact = gearBoard({ icons: { elitism: 1 } });
  play(exact.engine, P1, exact.id("ig"));
  drain(exact.engine, declineAll);
  assert.equal(zoneOf(exact.engine, exact.id("ig")), "discard", "[E] and exactly 1 resource is enough");
  assert.equal(ready(exact.engine), 0);
});

// --- Invent ----------------------------------------------------------------
// COST: Pick a value for X. Pay twice X. -- EFFECT: Search your deck for X-1 cards
// and put them into your hand. Tactic, cost 0, threshold [E][E][E].

const INVENT = "12b9e68e-852b-44ed-b69d-eb53660dfe6a";

function inventBoard(opts: { icons?: Icons; deck?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "iv", def: printing(INVENT), owner: P1, zone: "hand" },
      ...deckCards("d", opts.deck ?? 6, P1),
      { key: "dItem", def: item({ name: "DItem" }), owner: P1, zone: "deck" },
      { key: "dTactic", def: cantrip("DTactic", 1), owner: P1, zone: "deck" },
      { key: "dLocation", def: location({ name: "DLocation" }), owner: P1, zone: "deck" },
      ...deckCards("o", 4, P2),
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...res(opts.icons ?? { elitism: 12 })
    ]
  });
}

for (const [x, cards] of [
  [1, 0],
  [2, 1],
  [3, 2],
  [4, 3]
] as const) {
  clause(INVENT, "0:ability", `X=${x}: pays ${2 * x} (twice X), searches for ${cards} card(s) and puts ${cards === 0 ? "none" : "them"} into my hand`, () => {
    const { engine, id } = inventBoard();
    const picks = ["d1", "dItem", "d4"].slice(0, cards).map(id);
    const deckBefore = [...deckOf(engine, P1)];
    const handBefore = handOf(engine, P1).length;
    const spent = spentBy(engine, P1, () => play(engine, P1, id("iv"), { variables: { x } }));
    assert.equal(spent, 2 * x, "pays twice X (its own printed cost is 0)");
    if (cards > 0) {
      assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
      assert.equal(pending(engine)?.playerId, P1);
      pickCards(engine, P1, picks);
    } else {
      // X-1 is 0 or less: nothing to search for (the engine may still show an empty search prompt)
      drain(engine, declineAll);
    }
    assert.equal(pending(engine), undefined);
    for (const cardId of picks) assert.equal(zoneOf(engine, cardId), "hand", "found cards go to my hand");
    assert.equal(handOf(engine, P1).length, handBefore - 1 + cards, "the tactic left; exactly X-1 cards arrived");
    assert.equal(deckOf(engine, P1).length, deckBefore.length - cards);
    assert.equal(zoneOf(engine, id("iv")), "discard");
  });
}

clause(INVENT, "0:ability", "X=0 is legal and free: it can be played with just [E][E][E] and no other resource, and nothing is spent", () => {
  const { engine, id } = inventBoard({ icons: { elitism: 3 } });
  playRaw(engine, P1, id("iv"), { variables: { x: 0 } });
  assert.ok(engine.state.responseWindow, "the play was accepted");
  assert.equal(ready(engine), 3, "twice 0 is 0: nothing was spent");
  assert.equal(attachedCount(engine, P1), 0);
});

clause(INVENT, "0:ability", "X=0 (a legal value): searching for X-1 = -1 cards means no cards (CR 410.4), so the tactic resolves completely and leaves no prompt that cannot be answered", () => {
  const { engine, id } = inventBoard();
  const deckBefore = [...deckOf(engine, P1)];
  const handBefore = handOf(engine, P1).length;
  play(engine, P1, id("iv"), { variables: { x: 0 } });
  // if the engine asks anything, the only sensible answer (no cards) must be accepted
  if (pending(engine)) pickCards(engine, P1, []);
  assert.equal(pending(engine), undefined, "nothing is left to answer");
  assert.equal(zoneOf(engine, id("iv")), "discard", "the tactic finished and went to the discard pile");
  assert.equal(handOf(engine, P1).length, handBefore - 1, "no card was found");
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...deckBefore].sort());
});

clause(INVENT, "0:ability", "the cards found may be of any type (character, item, tactic, location)", () => {
  const { engine, id } = inventBoard();
  play(engine, P1, id("iv"), { variables: { x: 5 } });
  pickCards(engine, P1, [id("dItem"), id("dTactic"), id("dLocation"), id("d0")]);
  for (const key of ["dItem", "dTactic", "dLocation", "d0"]) assert.equal(zoneOf(engine, id(key)), "hand", key);
});

clause(INVENT, "0:ability", "'search for X-1 cards' with no search criteria must find all X-1 cards: finding fewer is refused (CR 312.2: only a search with specific criteria may fail)", () => {
  const { engine, id } = inventBoard();
  play(engine, P1, id("iv"), { variables: { x: 3 } });
  assert.throws(tryPick(engine, P1, [id("d0")]), "one card is fewer than X-1 = 2");
  assert.throws(tryPick(engine, P1, []), "no card at all");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  pickCards(engine, P1, [id("d0"), id("d1")]);
  assert.equal(zoneOf(engine, id("d0")), "hand");
});

clause(INVENT, "0:ability", "no more than X-1 cards: X=3 with three cards picked is refused", () => {
  const { engine, id } = inventBoard();
  play(engine, P1, id("iv"), { variables: { x: 3 } });
  assert.throws(tryPick(engine, P1, [id("d0"), id("d1"), id("d2")]));
  assert.throws(tryPick(engine, P1, [id("d0"), id("d0")]), "the same card twice");
});

clause(INVENT, "0:ability", "only cards from MY DECK: my hand, my discard pile and the opponent's deck are refused", () => {
  const { engine, id } = inventBoard();
  play(engine, P1, id("iv"), { variables: { x: 2 } });
  assert.throws(tryPick(engine, P1, [id("inHand")]), "my hand");
  assert.throws(tryPick(engine, P1, [id("inDiscard")]), "my discard pile");
  assert.throws(tryPick(engine, P1, [id("o0")]), "the opponent's deck");
});

clause(INVENT, "0:ability", "a deck with fewer than X-1 cards: I find all of them", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "iv", def: printing(INVENT), owner: P1, zone: "hand" },
      { key: "d0", def: character({ name: "D0" }), owner: P1, zone: "deck" },
      { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
      ...res({ elitism: 12 })
    ]
  });
  play(engine, P1, id("iv"), { variables: { x: 6 } });
  pickCards(engine, P1, [id("d0"), id("d1")]);
  assert.equal(deckOf(engine, P1).length, 0);
  assert.equal(zoneOf(engine, id("d0")), "hand");
  assert.equal(zoneOf(engine, id("d1")), "hand");
});

clause(INVENT, "0:ability", "the searched deck is shuffled afterwards (CR 312.1); the opponent's deck is not touched", () => {
  const { engine, id } = inventBoard();
  const before = deckOf(engine, P1).filter((c) => c !== id("d0"));
  const oppDeck = [...deckOf(engine, P2)];
  play(engine, P1, id("iv"), { variables: { x: 2 } });
  pickCards(engine, P1, [id("d0")]);
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...before].sort(), "same cards");
  assert.notDeepEqual(deckOf(engine, P1), before, "in a new order");
  assert.deepEqual(deckOf(engine, P2), oppDeck);
});

clause(INVENT, "0:ability", "X cannot be negative", () => {
  const { engine, id } = inventBoard();
  assert.throws(() => playRaw(engine, P1, id("iv"), { variables: { x: -1 } }));
  assert.equal(zoneOf(engine, id("iv")), "hand");
  assert.equal(ready(engine), 12);
});

clause(INVENT, "0:ability", "is refused when twice X exceeds my resources (X=3 with 5, X=1 with only the three [E] it needs... minus 2)", () => {
  const five = inventBoard({ icons: { elitism: 5 } });
  assert.throws(() => playRaw(five.engine, P1, five.id("iv"), { variables: { x: 3 } }), "needs 6");
  const exact = inventBoard({ icons: { elitism: 6 } });
  play(exact.engine, P1, exact.id("iv"), { variables: { x: 3 } });
  pickCards(exact.engine, P1, [exact.id("d0"), exact.id("d1")]);
  assert.equal(ready(exact.engine), 0, "exactly 6 spent");
  const three = inventBoard({ icons: { elitism: 3 } });
  assert.throws(() => playRaw(three.engine, P1, three.id("iv"), { variables: { x: 2 } }), "X=2 needs 4");
  play(three.engine, P1, three.id("iv"), { variables: { x: 1 } });
  assert.equal(ready(three.engine), 1, "X=1 with three resources pays 2");
});

clause(INVENT, "0:ability", "is refused without [E][E][E] even with plenty of other resources (the icons are a gate, not a cost)", () => {
  const twoE = inventBoard({ icons: { elitism: 2, rage: 10 } });
  assert.throws(() => playRaw(twoE.engine, P1, twoE.id("iv"), { variables: { x: 0 } }), "only two [E]");
  assert.throws(() => playRaw(twoE.engine, P1, twoE.id("iv"), { variables: { x: 2 } }), "only two [E], X=2");
  const threeE = inventBoard({ icons: { elitism: 3, rage: 10 } });
  play(threeE.engine, P1, threeE.id("iv"), { variables: { x: 2 } });
  pickCards(threeE.engine, P1, [threeE.id("d0")]);
  assert.equal(ready(threeE.engine), 13 - 4, "4 paid, the three [E] stay as icons");
});

// --- Hidden Sandwich -------------------------------------------------------
// ATTACH TO CHARACTER. You may play this card whenever you could play a tactic.
// If the attached character would be destroyed, instead destroy this card. Treat
// the character as though it has received no damage this turn.
// Item (gear), cost 3, threshold [E][E].

const SANDWICH = "a4396480-efb3-4382-bf85-51331246e5c7";

function sandwichBoard(opts: { icons?: Icons; extra?: CardPlacement[]; sandwichAttached?: boolean; activePlayerId?: PlayerId; turn?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    activePlayerId: opts.activePlayerId,
    cards: [
      { key: "sw", def: printing(SANDWICH), owner: P1, zone: opts.sandwichAttached ? "play" : "hand", attachedToKey: opts.sandwichAttached ? "host" : undefined },
      { key: "host", def: character({ name: "Host", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "foeKill", def: killTactic({ name: "FoeKill" }), owner: P2, zone: "hand" },
      { key: "myKill", def: killTactic({ name: "MyKill" }), owner: P1, zone: "hand" },
      { key: "zap3", def: zapTactic("Zap3", 3), owner: P1, zone: "hand" },
      { key: "zap1", def: zapTactic("Zap1", 1), owner: P1, zone: "hand" },
      { key: "zap9", def: zapTactic("Zap9", 9), owner: P1, zone: "hand" },
      { key: "bounce", def: tactic({ name: "Bounce", cost: 0, behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] } }), owner: P1, zone: "hand" },
      ...res(opts.icons ?? { elitism: 6 }),
      ...res({ rage: 4 }, P2),
      ...(opts.extra ?? [])
    ]
  });
}

const attachSandwich = (engine: SpoilsEngine, id: (key: string) => string, hostKey: string, cardKey = "sw") =>
  play(engine, P1, id(cardKey), { selected: { attachTo: [id(hostKey)] } });

clause(SANDWICH, "0:attach", "played on my turn: pays 3 and enters play attached to the character I pick (under my control)", () => {
  const { engine, id } = sandwichBoard();
  const spent = spentBy(engine, P1, () => attachSandwich(engine, id, "host"));
  assert.equal(spent, 3, "the printed cost of 3");
  assert.equal(zoneOf(engine, id("sw")), "play");
  assert.equal(engine.state.cards[id("sw")].attachedTo, id("host"));
  assert.equal(engine.state.cards[id("sw")].controllerId, P1);
  assert.equal(engine.state.cards[id("other")].attachedTo, undefined);
});

clause(SANDWICH, "0:attach", "can be attached to an opponent's character, too (any character)", () => {
  const { engine, id } = sandwichBoard();
  attachSandwich(engine, id, "foe");
  assert.equal(engine.state.cards[id("sw")].attachedTo, id("foe"));
  assert.equal(engine.state.cards[id("sw")].controllerId, P1, "I still control the Sandwich");
});

clause(SANDWICH, "0:attach", "must be attached to a CHARACTER: an item, a location, a faction, a face-down resource, and a character in hand or discard are refused", () => {
  const { engine, id } = sandwichBoard({
    extra: [
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...volition(1, P1).map((p) => ({ ...p, key: "downResource" }))
    ]
  });
  const attempt = (hostId: string) => () => playRaw(engine, P1, id("sw"), { selected: { attachTo: [hostId] } });
  assert.throws(attempt(id("thing")), "item");
  assert.throws(attempt(id("place")), "location");
  assert.throws(attempt(factionOf(engine, P1)), "my faction");
  assert.throws(attempt(factionOf(engine, P2)), "their faction");
  assert.throws(attempt(id("downResource")), "face-down card");
  assert.throws(attempt(id("inHand")), "hand");
  assert.throws(attempt(id("inDiscard")), "discard pile");
  assert.throws(() => playRaw(engine, P1, id("sw"), { selected: {} }), "a host must be picked");
  assert.throws(() => playRaw(engine, P1, id("sw"), { selected: { attachTo: [id("host"), id("other")] } }), "only one host");
  assert.equal(zoneOf(engine, id("sw")), "hand");
  attempt(id("host"))();
  assert.ok(engine.state.responseWindow, "a character is accepted");
});

clause(SANDWICH, "0:attach", "with no character in play it cannot be played", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "sw", def: printing(SANDWICH), owner: P1, zone: "hand" }, ...res({ elitism: 4 })]
  });
  assert.throws(() => playRaw(engine, P1, id("sw"), { selected: {} }));
  assert.equal(zoneOf(engine, id("sw")), "hand");
});

clause(SANDWICH, "0:attach", "when the host leaves play by other means than destruction, the Sandwich leaves play the same way (CR 301.4a): a host returned to hand takes it to its owner's hand", () => {
  const { engine, id } = sandwichBoard({ sandwichAttached: true, turn: 1 });
  play(engine, P1, id("bounce"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "hand");
  assert.equal(zoneOf(engine, id("sw")), "hand", "leaves play the same way (CR 301.4a)");
  assert.equal(engine.state.cards[id("sw")].attachedTo, undefined);
});

clause(SANDWICH, "0:attach", "is refused one resource short of its cost of 3, and without [E][E] even with plenty of other resources", () => {
  const attempt = (icons: Icons) => {
    const board = sandwichBoard({ icons });
    return { ...board, run: () => playRaw(board.engine, P1, board.id("sw"), { selected: { attachTo: [board.id("host")] } }) };
  };
  const short = attempt({ elitism: 2 });
  assert.throws(short.run, "2 resources");
  assert.equal(zoneOf(short.engine, short.id("sw")), "hand");
  const oneE = attempt({ elitism: 1, rage: 6 });
  assert.throws(oneE.run, "only one [E]");
  const exact = attempt({ elitism: 2, rage: 1 });
  exact.run();
  resolvePendingResponses(exact.engine);
  assert.equal(zoneOf(exact.engine, exact.id("sw")), "play", "[E][E] and exactly 3 resources is enough");
  assert.equal(ready(exact.engine), 0);
});

clause(SANDWICH, "0:attach", "has the printed type: an item with the gear subtype", () => {
  const { engine, id } = sandwichBoard();
  assert.deepEqual(engine.getCardTypes(id("sw")), ["item"]);
  assert.deepEqual(engine.getSubtypes(id("sw")), ["gear"]);
});

/** P2 (the active player) plays `FoeKill` on `host`; the Sandwich is played in response by P1. Leaves the kill unresolved until `resolvePendingResponses`. */
function sandwichInResponse(engine: SpoilsEngine, id: (key: string) => string, target = "host") {
  playRaw(engine, P2, id("foeKill"), { selected: { t: [id(target)] } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "I may respond");
  engine.perform({ type: "playCard", playerId: P1, cardId: id("sw"), selected: { attachTo: [id(target)] }, variables: {} } as never);
}

clause(SANDWICH, "1:rule", "can be played on my OPPONENT's turn in response to their tactic: it resolves first and saves the character from that very tactic", () => {
  const { engine, id } = sandwichBoard({ activePlayerId: P2 });
  const spent = spentBy(engine, P1, () => {
    sandwichInResponse(engine, id);
    resolvePendingResponses(engine);
  });
  assert.equal(spent, 3);
  assert.equal(zoneOf(engine, id("host")), "play", "the character survived the kill");
  assert.equal(zoneOf(engine, id("sw")), "discard", "the Sandwich was destroyed instead");
  assert.equal(zoneOf(engine, id("foeKill")), "discard");
});

clause(SANDWICH, "1:rule", "can be played in a battle response window (my character is being attacked): attach it, and the lethal battle damage hits the Sandwich instead", () => {
  const { engine, id } = sandwichBoard({
    activePlayerId: P2,
    extra: [{ key: "atk", def: character({ name: "Atk", strength: 9, life: 9, speed: 3 }), owner: P2, zone: "play" }]
  });
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
  untilPriority(engine, P1);
  engine.perform({ type: "playCard", playerId: P1, cardId: id("sw"), selected: { attachTo: [id("host")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("sw")].attachedTo, id("host"), "played during the battle");
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("host")] });
  autoResolveBattle(engine);
  assert.equal(zoneOf(engine, id("host")), "play", "the blocker survived 9 battle damage");
  assert.equal(zoneOf(engine, id("sw")), "discard");
  assert.equal(engine.state.cards[id("host")].damage, 0, "treated as having received no damage");
});

clause(SANDWICH, "1:rule", "control: an ordinary item with ATTACH TO CHARACTER cannot be played on the opponent's turn in response", () => {
  const plain = item({ name: "PlainAttach", cost: 0, attachTo: "character" });
  const { engine, id } = sandwichBoard({ activePlayerId: P2, extra: [{ key: "plain", def: plain, owner: P1, zone: "hand" }] });
  playRaw(engine, P2, id("foeKill"), { selected: { t: [id("host")] } });
  assert.throws(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("plain"), selected: { attachTo: [id("host")] }, variables: {} } as never), "a non-tactical item needs my own turn");
  assert.equal(zoneOf(engine, id("plain")), "hand");
});

// 2:rule — the replacement

clause(SANDWICH, "2:rule", "a destroy effect on the attached character destroys the Sandwich instead: the character stays in play", () => {
  const { engine, id } = sandwichBoard({ sandwichAttached: true, turn: 1 });
  play(engine, P1, id("myKill"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "play", "the character was not destroyed");
  assert.equal(zoneOf(engine, id("sw")), "discard", "this card was destroyed instead");
  assert.ok(discardOf(engine, P1).includes(id("sw")), "discardOf(engine, P1).includes(id(\"sw\"))");
  assert.equal(engine.state.cards[id("host")].damage, 0);
  assert.equal(engine.state.cards[id("other")].zone, "play");
});

clause(SANDWICH, "2:rule", "lethal damage that would destroy the character destroys the Sandwich instead, and the damage the character had is treated as 0", () => {
  const { engine, id } = sandwichBoard({ sandwichAttached: true, turn: 1 });
  play(engine, P1, id("zap3"), { selected: { t: [id("host")] } });
  assert.equal(engine.state.cards[id("host")].damage, 3, "non-lethal damage stays (life 4)");
  assert.equal(zoneOf(engine, id("sw")), "play", "the Sandwich is not used for non-lethal damage");
  play(engine, P1, id("zap1"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "play", "4 damage on a life-4 character would destroy it");
  assert.equal(zoneOf(engine, id("sw")), "discard", "the Sandwich was destroyed instead");
  assert.equal(engine.state.cards[id("host")].damage, 0, "treat the character as though it has received no damage this turn");
});

clause(SANDWICH, "2:rule", "massive damage (9 on a life-4 character) is also replaced, and the damage is cleared", () => {
  const { engine, id } = sandwichBoard({ sandwichAttached: true, turn: 1 });
  play(engine, P1, id("zap9"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "play");
  assert.equal(engine.state.cards[id("host")].damage, 0);
  assert.equal(zoneOf(engine, id("sw")), "discard");
});

clause(SANDWICH, "2:rule", "it works once: with the Sandwich gone, the next destruction kills the character", () => {
  const { engine, id } = sandwichBoard({ sandwichAttached: true, turn: 1 });
  play(engine, P1, id("myKill"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "play");
  play(engine, P1, id("zap9"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "discard", "no Sandwich left");
});

clause(SANDWICH, "2:rule", "only the ATTACHED character is protected: other characters die normally", () => {
  const { engine, id } = sandwichBoard({ sandwichAttached: true, turn: 1 });
  play(engine, P1, id("myKill"), { selected: { t: [id("other")] } });
  assert.equal(zoneOf(engine, id("other")), "discard");
  assert.equal(zoneOf(engine, id("sw")), "play", "the Sandwich was not used");
  play(engine, P1, id("zap9"), { selected: { t: [id("foe")] } });
  assert.equal(zoneOf(engine, id("foe")), "discard");
  assert.equal(zoneOf(engine, id("sw")), "play");
});

clause(SANDWICH, "2:rule", "two Sandwiches on one character: each destruction uses up only one of them", () => {
  const { engine, id } = sandwichBoard({
    sandwichAttached: true,
    turn: 1,
    extra: [{ key: "sw2", def: printing(SANDWICH), owner: P1, zone: "play", attachedToKey: "host" }]
  });
  play(engine, P1, id("myKill"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "play");
  const used = [id("sw"), id("sw2")].filter((c) => zoneOf(engine, c) === "discard");
  assert.equal(used.length, 1, "exactly one Sandwich was destroyed");
  play(engine, P1, id("zap9"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "play", "the second Sandwich saves it again");
  assert.equal(zoneOf(engine, id("sw")), "discard");
  assert.equal(zoneOf(engine, id("sw2")), "discard");
});

clause(SANDWICH, "2:rule", "a Sandwich on my OPPONENT's character protects that character from my destroy effect (the card says the attached character, whoever it belongs to)", () => {
  const { engine, id } = sandwichBoard({ turn: 1 });
  attachSandwich(engine, id, "foe");
  play(engine, P1, id("myKill"), { selected: { t: [id("foe")] } });
  assert.equal(zoneOf(engine, id("foe")), "play");
  assert.equal(zoneOf(engine, id("sw")), "discard");
});

clause(SANDWICH, "2:rule", "damage that does not destroy is kept: 2 damage on a life-4 character stays 2", () => {
  const { engine, id } = sandwichBoard({ sandwichAttached: true, turn: 1, extra: [{ key: "zap2", def: zapTactic("Zap2", 2), owner: P1, zone: "hand" }] });
  play(engine, P1, id("zap2"), { selected: { t: [id("host")] } });
  assert.equal(engine.state.cards[id("host")].damage, 2);
  assert.equal(zoneOf(engine, id("sw")), "play");
});

clause(SANDWICH, "2:rule", "it does not stop other ways to leave play (returned to hand), and the Sandwich goes with the character", () => {
  const { engine, id } = sandwichBoard({ sandwichAttached: true, turn: 1 });
  play(engine, P1, id("bounce"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "hand");
  assert.notEqual(zoneOf(engine, id("sw")), "play");
});

clause(SANDWICH, "2:rule", "a replacement on an ATTACHED card still applies when the host is destroyed as part of an extra cost (CR 506.2a): the Sandwich is destroyed instead and the host survives", () => {
  const altar = item({
    name: "Sacrificial Altar",
    behavior: {
      abilities: [
        {
          id: "sacrifice",
          type: "activated",
          targets: [{ id: "s", selector: { zone: "play", type: "character", controller: "self" }, count: 1 }],
          costs: [{ type: "destroy", target: { type: "selected", id: "s" } }],
          effects: [{ type: "draw", player: "controller", amount: 1 }]
        }
      ]
    }
  });
  const { engine, id } = sandwichBoard({ sandwichAttached: true, turn: 1, extra: [{ key: "altar", def: altar, owner: P1, zone: "play" }, ...deckCards("a", 2, P1)] });
  const handBefore = handOf(engine, P1).length;
  activate(engine, P1, id("altar"), "sacrifice", { selected: { s: [id("host")] } });
  assert.equal(handOf(engine, P1).length, handBefore + 1, "the cost was paid, so the effect happened");
  assert.equal(zoneOf(engine, id("host")), "play", "the attached card's replacement still applies (CR 506.2a)");
  assert.equal(zoneOf(engine, id("sw")), "discard", "the Sandwich was destroyed instead");
});

clause(SANDWICH, "2:rule", "off in hand: a character with no Sandwich attached is destroyed as normal", () => {
  const { engine, id } = sandwichBoard({ turn: 1 });
  play(engine, P1, id("myKill"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "discard");
  assert.equal(zoneOf(engine, id("sw")), "hand");
});

// --- Hypnotic Plafond ------------------------------------------------------
// COVERT parties cannot attack your faction. Location, cost 3, threshold [E][E],
// structure 5.

const PLAFOND = "97b1e279-1f9e-4787-8f3b-997293a6e928";

function plafondBoard(opts: { plafond?: "play" | "hand" | "faceDown" | "none"; controller?: PlayerId; owner?: PlayerId; attacker?: PlayerId; extra?: CardPlacement[] } = {}) {
  const attacker = opts.attacker ?? P2;
  const defender = attacker === P1 ? P2 : P1;
  const where = opts.plafond ?? "play";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: attacker,
    cards: [
      ...(where === "none"
        ? []
        : [
            {
              key: "pl",
              def: printing(PLAFOND),
              owner: opts.owner ?? opts.controller ?? defender,
              controller: opts.controller ?? defender,
              zone: where === "hand" ? ("hand" as const) : ("play" as const),
              faceDown: where === "faceDown"
            }
          ]),
      { key: "covertA", def: covertDef("CovertA"), owner: attacker, zone: "play" },
      { key: "covertB", def: covertDef("CovertB"), owner: attacker, zone: "play" },
      { key: "plainA", def: character({ name: "PlainA", strength: 2, life: 4, speed: 2 }), owner: attacker, zone: "play" },
      { key: "town", def: location({ name: "Town", structure: 9 }), owner: defender, zone: "play" },
      { key: "def1", def: character({ name: "Def1", strength: 1, life: 5, speed: 2 }), owner: defender, zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}

const faction = (player: PlayerId) => ({ type: "faction" as const, playerId: player });

clause(PLAFOND, "0:rule", "a covert party cannot attack my faction: a lone covert attacker, and a party of two covert attackers, are refused and nothing changes", () => {
  for (const attackers of [["covertA"], ["covertA", "covertB"]]) {
    const { engine, id } = plafondBoard();
    assert.throws(() => declareAttackBy(engine, P2, attackers.map(id), faction(P1)), attackers.join("+"));
    assert.equal(battleOf(engine), undefined, "no battle");
    for (const key of attackers) assert.equal(engine.state.cards[id(key)].depleted, false, `${key} was not depleted`);
  }
});

clause(PLAFOND, "0:rule", "control: a party of plain characters can attack my faction", () => {
  const { engine, id } = plafondBoard();
  declareAttackBy(engine, P2, [id("plainA")], faction(P1));
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("plainA")]);
});

clause(PLAFOND, "0:rule", "a party is covert only if EVERY member is covert: a covert and a plain attacker together may attack my faction", () => {
  const { engine, id } = plafondBoard();
  declareAttackBy(engine, P2, [id("covertA"), id("plainA")], faction(P1));
  assert.equal(battleOf(engine)?.attackingParty.length, 2);
});

clause(PLAFOND, "0:rule", "it only protects my FACTION: a covert party can attack my location (another location, and the Plafond itself)", () => {
  const first = plafondBoard();
  declareAttackBy(first.engine, P2, [first.id("covertA")], { type: "card", cardId: first.id("town") });
  assert.deepEqual(battleOf(first.engine)?.attackingParty, [first.id("covertA")]);
  const second = plafondBoard();
  declareAttackBy(second.engine, P2, [second.id("covertA"), second.id("covertB")], { type: "card", cardId: second.id("pl") });
  assert.equal(battleOf(second.engine)?.attackingParty.length, 2);
});

clause(PLAFOND, "0:rule", "COVERT gained this turn counts: a plain character with COVERT granted cannot attack my faction alone", () => {
  const { engine, id } = plafondBoard({ extra: [{ key: "grant", def: grantCovertTactic(), owner: P2, zone: "hand" }, ...res({ rage: 1 }, P2)] });
  play(engine, P2, id("grant"), { selected: { t: [id("plainA")] } });
  assert.equal(isCovert(engine, id("plainA")), true);
  assert.throws(() => declareAttackBy(engine, P2, [id("plainA")], faction(P1)));
  assert.equal(battleOf(engine), undefined);
});

clause(PLAFOND, "0:rule", "a character whose COVERT is removed is a plain character again and may attack my faction", () => {
  const { engine, id } = plafondBoard({ extra: [{ key: "dm", def: printing(MOCKERY), owner: P2, zone: "hand" }, ...res({ elitism: 2 }, P2)] });
  assert.throws(() => declareAttackBy(engine, P2, [id("covertA")], faction(P1)), "before Mockery");
  play(engine, P2, id("dm"), { selected: { c: [id("covertA")] } });
  declareAttackBy(engine, P2, [id("covertA")], faction(P1));
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("covertA")]);
});

clause(PLAFOND, "0:rule", "it protects the faction of its CONTROLLER only: my own covert party can attack my opponent's faction", () => {
  const { engine, id } = plafondBoard({ attacker: P1, controller: P1 });
  declareAttackBy(engine, P1, [id("covertA"), id("covertB")], faction(P2));
  assert.equal(battleOf(engine)?.attackingParty.length, 2);
});

clause(PLAFOND, "0:rule", "a Plafond controlled by my opponent protects THEIR faction from my covert party, and does not stop their covert party attacking mine", () => {
  const blocked = plafondBoard({ attacker: P1, controller: P2 });
  assert.throws(() => declareAttackBy(blocked.engine, P1, [blocked.id("covertA")], faction(P2)));
  assert.equal(battleOf(blocked.engine), undefined);
  const free = plafondBoard({ attacker: P2, controller: P2 });
  declareAttackBy(free.engine, P2, [free.id("covertA")], faction(P1));
  assert.ok(battleOf(free.engine), "their own Plafond does not protect my faction");
});

clause(PLAFOND, "0:rule", "'your faction' is the controller's: a Plafond I own but my opponent controls protects them, not me", () => {
  const mine = plafondBoard({ attacker: P2, owner: P1, controller: P2 });
  declareAttackBy(mine.engine, P2, [mine.id("covertA")], faction(P1));
  assert.ok(battleOf(mine.engine), "I do not control it, so it does not protect my faction");
});

clause(PLAFOND, "0:rule", "off in hand and when it is a face-down resource", () => {
  for (const where of ["hand", "faceDown", "none"] as const) {
    const { engine, id } = plafondBoard({ plafond: where });
    declareAttackBy(engine, P2, [id("covertA")], faction(P1));
    assert.ok(battleOf(engine), where);
  }
});

clause(PLAFOND, "0:rule", "off again once the Plafond is destroyed", () => {
  const { engine, id } = plafondBoard({ extra: [{ key: "kill", def: killAnyTactic("location"), owner: P2, zone: "hand" }] });
  assert.throws(() => declareAttackBy(engine, P2, [id("covertA")], faction(P1)));
  play(engine, P2, id("kill"), { selected: { t: [id("pl")] } });
  assert.equal(zoneOf(engine, id("pl")), "discard");
  declareAttackBy(engine, P2, [id("covertA")], faction(P1));
  assert.ok(battleOf(engine), "the covert party can attack once the Plafond is gone");
});

clause(PLAFOND, "0:rule", "deploys for exactly 3 with [E][E] (refused one short or with one [E]) and is destroyed by 5 damage, not 4 (structure 5)", () => {
  const dmg = (n: number) => tactic({ name: `Z${n}`, cost: 0, behavior: { abilities: [{ id: "z", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: n }] }] } });
  const board = (icons: Icons) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "pl", def: printing(PLAFOND), owner: P1, zone: "hand" },
        { key: "z4", def: dmg(4), owner: P1, zone: "hand" },
        { key: "z1", def: dmg(1), owner: P1, zone: "hand" },
        ...res(icons)
      ]
    });
  const short = board({ elitism: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("pl")));
  const oneE = board({ elitism: 1, rage: 5 });
  assert.throws(() => playRaw(oneE.engine, P1, oneE.id("pl")));
  const { engine, id } = board({ elitism: 4 });
  play(engine, P1, id("pl"));
  assert.equal(ready(engine), 1, "exactly 3 spent");
  play(engine, P1, id("z4"), { selected: { t: [id("pl")] } });
  assert.equal(zoneOf(engine, id("pl")), "play", "4 damage does not destroy structure 5");
  play(engine, P1, id("z1"), { selected: { t: [id("pl")] } });
  assert.equal(zoneOf(engine, id("pl")), "discard");
});

// --- Jacque's Trap ---------------------------------------------------------
// IT'S A TRAP! -- COST: Destroy this card. Pick an attacking character. --
// EFFECT: Destroy the character. Item, cost 3, threshold [E].

const TRAP = "7877af1b-ff36-46fc-bf0c-766009928366";

/** P2 attacks P1 with `atk1`+`atk2` (P2 passes); P1 owns the Trap and has priority. */
function trapBoard(opts: { icons?: Icons; extra?: CardPlacement[]; trapZone?: "play" | "hand" } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "trap", def: printing(TRAP), owner: P1, zone: opts.trapZone ?? "play" },
      { key: "atk1", def: character({ name: "Atk1", strength: 3, life: 5, speed: 3 }), owner: P2, zone: "play" },
      { key: "atk2", def: character({ name: "Atk2", strength: 2, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "idleFoe", def: character({ name: "IdleFoe", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "idleMine", def: character({ name: "IdleMine", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "town", def: location({ name: "Town", structure: 9 }), owner: P1, zone: "play" },
      ...res(opts.icons ?? { elitism: 3 }),
      ...(opts.extra ?? [])
    ]
  });
}

const springTrap = (engine: SpoilsEngine, id: (key: string) => string, target: string, player: PlayerId = P1) =>
  activate(engine, player, id("trap"), "trap", { selected: { c: [id(target)] } });

function startAttack(engine: SpoilsEngine, id: (key: string) => string, attackers: string[]) {
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: attackers.map(id), target: { type: "faction", playerId: P1 } });
  untilPriority(engine, P1);
}

clause(TRAP, "0:ability:trap", "destroys itself as its cost and destroys the attacking character I pick, with no resources spent", () => {
  const { engine, id } = trapBoard();
  startAttack(engine, id, ["atk1"]);
  const resources = ready(engine);
  springTrap(engine, id, "atk1");
  assert.equal(zoneOf(engine, id("trap")), "discard", "COST: Destroy this card");
  assert.ok(discardOf(engine, P1).includes(id("trap")), "discardOf(engine, P1).includes(id(\"trap\"))");
  assert.equal(zoneOf(engine, id("atk1")), "discard", "EFFECT: Destroy the character");
  assert.ok(discardOf(engine, P2).includes(id("atk1")), "into its owner's discard pile");
  assert.equal(ready(engine), resources, "no resources are spent");
});

clause(TRAP, "0:ability:trap", "only the picked attacker dies: the other attackers remain in the party and the battle goes on", () => {
  const { engine, id } = trapBoard();
  startAttack(engine, id, ["atk1", "atk2"]);
  springTrap(engine, id, "atk1");
  assert.equal(zoneOf(engine, id("atk2")), "play");
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("atk2")], "the destroyed attacker left the party");
  assert.equal(zoneOf(engine, id("idleFoe")), "play");
});

clause(TRAP, "0:ability:trap", "the battle then resolves with the remaining attacker: the unblocked survivor hits my faction for its own strength", () => {
  const { engine, id } = trapBoard();
  const influence = engine.state.players[P1].influence;
  startAttack(engine, id, ["atk1", "atk2"]);
  springTrap(engine, id, "atk1");
  untilPriority(engine, P1);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
  autoResolveBattle(engine);
  assert.equal(engine.state.players[P1].influence, influence - 2, "only Atk2's 2 strength; Atk1 never struck");
});

clause(TRAP, "0:ability:trap", "destroying the only attacker ends the battle: no blockers are asked for and my faction takes nothing", () => {
  const { engine, id } = trapBoard();
  const influence = engine.state.players[P1].influence;
  startAttack(engine, id, ["atk1"]);
  springTrap(engine, id, "atk1");
  resolvePendingResponses(engine);
  assert.deepEqual(battleOf(engine)?.attackingParty ?? [], [], "no attacking party is left");
  assert.ok(battleOf(engine) === undefined || battleOf(engine)?.phase === "finished", "the battle is over");
  assert.throws(() => engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("blk")] }), "no blocking step against nothing");
  assert.equal(engine.state.players[P1].influence, influence);
  assert.equal(engine.state.cards[id("blk")].damage, 0);
});

clause(TRAP, "0:ability:trap", "can be used after blockers are declared, before damage: the blocked attacker is destroyed and deals no damage", () => {
  const { engine, id } = trapBoard();
  startAttack(engine, id, ["atk1"]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("blk")] });
  untilPriority(engine, P1);
  springTrap(engine, id, "atk1");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("atk1")), "discard");
  assert.equal(engine.state.cards[id("blk")].damage, 0, "the blocker took no damage");
});

clause(TRAP, "0:ability:trap", "the pick must be an ATTACKING character: a non-attacking character of either player, a blocker, an item, a location and a faction are refused", () => {
  const { engine, id } = trapBoard({ extra: [{ key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" }] });
  startAttack(engine, id, ["atk1"]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("blk")] });
  untilPriority(engine, P1);
  const attempt = (target: string) => () => springTrap(engine, id, target);
  assert.throws(attempt("atk2"), "a character that is not attacking");
  assert.throws(attempt("idleFoe"), "a non-attacking opposing character");
  assert.throws(attempt("idleMine"), "my own non-attacking character");
  assert.throws(attempt("blk"), "a blocking character is not attacking");
  assert.throws(attempt("thing"), "an item");
  assert.throws(attempt("town"), "the location");
});

clause(TRAP, "0:ability:trap", "refused attempts keep the Trap: nothing is destroyed when the pick is illegal", () => {
  const { engine, id } = trapBoard();
  startAttack(engine, id, ["atk1"]);
  assert.throws(() => springTrap(engine, id, "idleFoe"));
  assert.throws(() => activate(engine, P1, id("trap"), "trap", { selected: {} }), "a pick is required");
  assert.throws(() => activate(engine, P1, id("trap"), "trap", { selected: { c: [factionOf(engine, P2)] } }), "a faction is not a character");
  assert.equal(zoneOf(engine, id("trap")), "play", "the Trap was not destroyed");
  assert.equal(zoneOf(engine, id("atk1")), "play");
});

clause(TRAP, "0:ability:trap", "it needs a battle: with no attack there is nothing to pick and it cannot be used", () => {
  const { engine, id } = trapBoard();
  assert.throws(() => springTrap(engine, id, "atk1"));
  assert.equal(zoneOf(engine, id("trap")), "play");
  assert.equal(zoneOf(engine, id("atk1")), "play");
});

clause(TRAP, "0:ability:trap", "'an attacking character' includes my own: when I attack, I can destroy one of my own attackers", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "trap", def: printing(TRAP), owner: P1, zone: "play" },
      { key: "mine1", def: character({ name: "Mine1", strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play" }
    ]
  });
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("mine1"), id("mine2")], target: { type: "faction", playerId: P2 } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "the attacker acts first in the declaration window");
  activate(engine, P1, id("trap"), "trap", { selected: { c: [id("mine1")] } });
  assert.equal(zoneOf(engine, id("mine1")), "discard");
  assert.equal(zoneOf(engine, id("mine2")), "play");
});

clause(TRAP, "0:ability:trap", "it is an ability of the Trap in play: it cannot be used from my hand, and only its controller can use it", () => {
  const inHand = trapBoard({ trapZone: "hand" });
  startAttack(inHand.engine, inHand.id, ["atk1"]);
  assert.throws(() => springTrap(inHand.engine, inHand.id, "atk1"));
  assert.equal(zoneOf(inHand.engine, inHand.id("atk1")), "play");

  const { engine, id } = trapBoard();
  startAttack(engine, id, ["atk1"]);
  assert.throws(() => engine.perform({ type: "activateAbility", playerId: P2, cardId: id("trap"), abilityId: "trap", selected: { c: [id("atk1")] }, variables: {} }));
  assert.equal(zoneOf(engine, id("trap")), "play");
});

clause(TRAP, "0:ability:trap", "'Destroy the character' is an ordinary destruction: a Hidden Sandwich on the attacker is destroyed instead and the attacker lives", () => {
  const { engine, id } = trapBoard({ extra: [{ key: "sw", def: printing(SANDWICH), owner: P2, zone: "play", attachedToKey: "atk1" }] });
  startAttack(engine, id, ["atk1"]);
  springTrap(engine, id, "atk1");
  assert.equal(zoneOf(engine, id("trap")), "discard", "the cost was paid");
  assert.equal(zoneOf(engine, id("atk1")), "play", "the Sandwich replaced the destruction");
  assert.equal(zoneOf(engine, id("sw")), "discard");
});

clause(TRAP, "0:ability:trap", "deploys for exactly 3 with [E] (refused one short or without [E]) as an item", () => {
  const board = (icons: Icons) => buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "trap", def: printing(TRAP), owner: P1, zone: "hand" }, ...res(icons)] });
  const short = board({ elitism: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("trap")));
  const noThreshold = board({ rage: 6 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("trap")));
  const { engine, id } = board({ elitism: 3 });
  play(engine, P1, id("trap"));
  assert.equal(zoneOf(engine, id("trap")), "play");
  assert.deepEqual(engine.getCardTypes(id("trap")), ["item"]);
  assert.equal(ready(engine), 0);
});

// --- Jo Ciendeilio ---------------------------------------------------------
// UNIQUE JO. RESEARCH -- COST: Deplete this card. -- EFFECT: The next numeric
// cost you pay this turn costs up to 3 less. Character, cost 5, threshold
// [E][E][E][E], 1 strength / 3 speed / 1 life, subtype inventor.

const JO = "6c7ee5df-9a79-472e-972a-90aed116b9d4";

function joBoard(opts: { icons?: Icons; extra?: CardPlacement[]; joZone?: "play" | "hand"; attackEligible?: boolean } = {}) {
  const payer = character({
    name: "Payer",
    strength: 1,
    life: 3,
    behavior: { abilities: [{ id: "pay4", type: "activated", costs: [{ type: "payResources", amount: 4 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const drawer = character({
    name: "Drawer",
    strength: 1,
    life: 3,
    behavior: { abilities: [{ id: "free", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "jo", def: printing(JO), owner: P1, zone: opts.joZone ?? "play", attackEligible: opts.attackEligible },
      { key: "c2", def: character({ name: "C2", cost: 2 }), owner: P1, zone: "hand" },
      { key: "c3", def: character({ name: "C3", cost: 3 }), owner: P1, zone: "hand" },
      { key: "c4", def: character({ name: "C4", cost: 4 }), owner: P1, zone: "hand" },
      { key: "c5", def: character({ name: "C5", cost: 5 }), owner: P1, zone: "hand" },
      { key: "c5b", def: character({ name: "C5b", cost: 5 }), owner: P1, zone: "hand" },
      { key: "t6", def: cantrip("T6", 6), owner: P1, zone: "hand" },
      { key: "payer", def: payer, owner: P1, zone: "play" },
      { key: "drawer", def: drawer, owner: P1, zone: "play" },
      { key: "oppTactic", def: cantrip("OppTactic", 3), owner: P2, zone: "hand" },
      ...deckCards("a", 6, P1),
      ...deckCards("b", 3, P2),
      ...res(opts.icons ?? { elitism: 14 }),
      ...res({ rage: 5 }, P2),
      ...(opts.extra ?? [])
    ]
  });
}

const researchRaw = (engine: SpoilsEngine, id: (key: string) => string) => activate(engine, P1, id("jo"), "research");
/** RESEARCH, answering the "up to 3 less" prompt with the full 3 (or `value`). */
const research = (engine: SpoilsEngine, id: (key: string) => string, value?: number) => {
  researchRaw(engine, id);
  answerUpTo(engine, P1, value);
};

clause(JO, "0:unique", "playing a second copy makes me choose which one to keep; keeping the new one destroys the old one", () => {
  const { engine, id } = joBoard({ extra: [{ key: "jo2", def: printing(JO), owner: P1, zone: "hand" }] });
  play(engine, P1, id("jo2"));
  const pc = pending(engine);
  assert.ok(pc, "a choice is open");
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [id("jo"), id("jo2")].sort());
  answerChoice(engine, "uniqueSurvivor", P1, { keep: id("jo2") });
  assert.equal(zoneOf(engine, id("jo2")), "play");
  assert.equal(zoneOf(engine, id("jo")), "discard", "the other copy is destroyed");
  assert.equal(pending(engine), undefined);
});

clause(JO, "0:unique", "keeping the old copy destroys the new one", () => {
  const { engine, id } = joBoard({ extra: [{ key: "jo2", def: printing(JO), owner: P1, zone: "hand" }] });
  play(engine, P1, id("jo2"));
  answerChoice(engine, "uniqueSurvivor", P1, { keep: id("jo") });
  assert.equal(zoneOf(engine, id("jo")), "play");
  assert.equal(zoneOf(engine, id("jo2")), "discard");
});

clause(JO, "0:unique", "a card of a different name with the same designation JO counts (UNIQUE is about the designation, not the name)", () => {
  const otherJo = character({ name: "Some Other Jo", unique: "jo", cost: 0, strength: 1, life: 1, speed: 1 });
  const { engine, id } = joBoard({ extra: [{ key: "iron", def: otherJo, owner: P1, zone: "hand" }] });
  play(engine, P1, id("iron"));
  const pc = pending(engine);
  assert.ok(pc, "UNIQUE JO covers every card with that designation");
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [id("jo"), id("iron")].sort());
  answerChoice(engine, "uniqueSurvivor", P1, { keep: id("jo") });
  assert.equal(zoneOf(engine, id("iron")), "discard");
});

clause(JO, "0:unique", "the restriction is per player: my opponent can control their own copy without any choice", () => {
  const { engine, id } = joBoard({ extra: [{ key: "oppJo", def: printing(JO), owner: P2, zone: "play" }] });
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("jo")), "play");
  assert.equal(zoneOf(engine, id("oppJo")), "play");
});

clause(JO, "0:unique", "only copies I CONTROL count: a copy in my hand, my discard pile or face-down in play does not stop me playing another", () => {
  const { engine, id } = joBoard({
    joZone: "hand",
    extra: [
      { key: "handJo", def: printing(JO), owner: P1, zone: "hand" },
      { key: "discardJo", def: printing(JO), owner: P1, zone: "discard" },
      { key: "downJo", def: printing(JO), owner: P1, zone: "play", faceDown: true }
    ]
  });
  play(engine, P1, id("jo"));
  assert.equal(pending(engine), undefined, "no other copy is in play face-up under my control");
  assert.equal(zoneOf(engine, id("jo")), "play");
  assert.equal(zoneOf(engine, id("handJo")), "hand");
});

clause(JO, "0:unique", "'control', not 'own': a copy I own but my opponent controls does not count against me", () => {
  const { engine, id } = joBoard({ joZone: "hand", extra: [{ key: "stolen", def: printing(JO), owner: P1, zone: "play", controller: P2 }] });
  assert.equal(engine.state.cards[id("stolen")].controllerId, P2);
  play(engine, P1, id("jo"));
  assert.equal(pending(engine), undefined, "I do not control the other copy");
  assert.equal(zoneOf(engine, id("jo")), "play");
  assert.equal(zoneOf(engine, id("stolen")), "play");
});

clause(JO, "1:ability:research", "depletes this card and sets up the reduction without spending anything", () => {
  const { engine, id } = joBoard();
  const resources = ready(engine);
  research(engine, id);
  assert.equal(engine.state.cards[id("jo")].depleted, true, "COST: Deplete this card");
  assert.equal(ready(engine), resources, "no resources are spent");
  assert.equal(attachedCount(engine, P1), 0);
});

for (const [key, printed, paid] of [
  ["c5", 5, 2],
  ["c4", 4, 1],
  ["c3", 3, 0],
  ["c2", 2, 0]
] as const) {
  clause(JO, "1:ability:research", `the next numeric cost I pay costs up to 3 less: a cost-${printed} character pays ${paid}`, () => {
    const { engine, id } = joBoard();
    research(engine, id);
    assert.equal(spentBy(engine, P1, () => play(engine, P1, id(key))), paid);
    assert.equal(zoneOf(engine, id(key)), "play");
  });
}

clause(JO, "1:ability:research", "'up to 3 less': RESEARCH asks its controller how much to reduce, a number from 0 to 3, after depleting Jo", () => {
  const { engine, id } = joBoard();
  researchRaw(engine, id);
  assert.equal(engine.state.cards[id("jo")].depleted, true, "COST: Deplete this card");
  const pc = pending(engine) as unknown as { kind: string; playerId: string; min: number; max: number } | undefined;
  assert.ok(pc, "the controller is asked how much to reduce");
  assert.equal(pc.kind, "chooseNumber");
  assert.equal(pc.playerId, P1);
  assert.equal(pc.min, 0);
  assert.equal(pc.max, 3);
});

for (const [value, paid] of [
  [3, 2],
  [2, 3],
  [1, 4],
  [0, 5]
] as const) {
  clause(JO, "1:ability:research", `choosing ${value} reduces the next numeric cost by exactly ${value}: a cost-5 character pays ${paid}`, () => {
    const { engine, id } = joBoard();
    research(engine, id, value);
    assert.equal(pending(engine), undefined, "the choice is answered");
    assert.equal(engine.state.cards[id("jo")].depleted, true, "Jo is depleted whatever is chosen");
    assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c5"))), paid);
    assert.equal(zoneOf(engine, id("c5")), "play");
  });
}

clause(JO, "1:ability:research", "the chosen amount also applies to a numeric ability cost I pay: choosing 2 turns 'pay 4' into pay 2", () => {
  const { engine, id } = joBoard();
  research(engine, id, 2);
  assert.equal(spentBy(engine, P1, () => activate(engine, P1, id("payer"), "pay4")), 2);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c5"))), 5, "the reduction was used up by the ability");
});

clause(JO, "1:ability:research", "more than 3 (or a negative number) is refused: the choice stays open, and 3 is still accepted", () => {
  const { engine, id } = joBoard();
  researchRaw(engine, id);
  for (const value of [4, -1]) {
    assert.throws(
      () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooseNumber", value } } as never),
      /Choose an integer/,
      `${value} is outside 0 to 3`
    );
    assert.equal(pending(engine)?.kind, "chooseNumber", "the choice is still open");
  }
  answerUpTo(engine, P1, 3);
  assert.equal(pending(engine), undefined);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c5"))), 2);
});

clause(JO, "1:ability:research", "...and a tactic of cost 6 pays 3", () => {
  const { engine, id } = joBoard();
  research(engine, id);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("t6"))), 3);
});

clause(JO, "1:ability:research", "only the NEXT numeric cost: the cost after it is paid in full", () => {
  const { engine, id } = joBoard();
  research(engine, id);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c5"))), 2);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c5b"))), 5);
});

clause(JO, "1:ability:research", "the next numeric cost can be an ability's: an ability that costs 'pay 4' costs 1, then the next one is full price", () => {
  const { engine, id } = joBoard();
  research(engine, id);
  assert.equal(spentBy(engine, P1, () => activate(engine, P1, id("payer"), "pay4")), 1);
  assert.equal(spentBy(engine, P1, () => activate(engine, P1, id("payer"), "pay4")), 4);
});

clause(JO, "1:ability:research", "...so a card played AFTER the ability gets no reduction (the ability used it)", () => {
  const { engine, id } = joBoard();
  research(engine, id);
  activate(engine, P1, id("payer"), "pay4");
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c5"))), 5);
});

clause(JO, "1:ability:research", "the reduction covers the whole numeric cost of the next card, including a 'pay X+X' extra cost (CR 406.3): Invent with X=2 (pay 4) costs 1", () => {
  const { engine, id } = joBoard({ extra: [{ key: "invent", def: printing(INVENT), owner: P1, zone: "hand" }] });
  research(engine, id);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("invent"), { variables: { x: 2 } })), 4 - 3);
});

clause(JO, "1:ability:research", "'this turn': an unused reduction is gone in the next turn", () => {
  const { engine, id } = joBoard();
  research(engine, id);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c5"))), 5);
});

clause(JO, "1:ability:research", "the threshold is not reduced: a discounted card that needs [R][R] is still refused without them", () => {
  const needsRage = character({ name: "NeedsRage", cost: 5, threshold: "rr" as never });
  const { engine, id } = joBoard({ extra: [{ key: "nr", def: needsRage, owner: P1, zone: "hand" }] });
  research(engine, id);
  assert.throws(() => playRaw(engine, P1, id("nr")), "no [R] icons");
  assert.equal(zoneOf(engine, id("nr")), "hand");
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c5"))), 2, "the refused attempt did not use the reduction");
});

clause(JO, "1:ability:research", "only for me: while my reduction is waiting, my opponent's tactic costs them full price", () => {
  const { engine, id } = joBoard();
  research(engine, id);
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("drawer"), abilityId: "free", selected: {}, variables: {} });
  const theirs = spentBy(engine, P2, () => engine.perform({ type: "playCard", playerId: P2, cardId: id("oppTactic"), selected: {}, variables: {} } as never));
  assert.equal(theirs, 3, "my opponent pays the full 3");
  resolvePendingResponses(engine);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c5"))), 2, "my reduction is still waiting for me");
});

clause(JO, "1:ability:research", "cannot be used while depleted (the cost is depleting it); nothing is reduced by the refused attempt", () => {
  const { engine, id } = joBoard();
  engine.state.cards[id("jo")].depleted = true;
  assert.throws(() => research(engine, id));
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c5"))), 5);
});

clause(JO, "1:ability:research", "can be used the turn Jo enters play, and again after Jo restores next turn", () => {
  const { engine, id } = joBoard({ attackEligible: false });
  research(engine, id);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c5"))), 2);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("jo")].depleted, false);
  research(engine, id);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c5b"))), 2);
});

clause(JO, "1:ability:research", "only its controller can use it", () => {
  const { engine, id } = joBoard();
  assert.throws(() => engine.perform({ type: "activateAbility", playerId: P2, cardId: id("jo"), abilityId: "research", selected: {}, variables: {} }));
  assert.equal(engine.state.cards[id("jo")].depleted, false);
});

clause(JO, "1:ability:research", "deploys for exactly 5 with [E][E][E][E] (refused one short or with three [E]) and has its printed 1 strength / 1 life / 3 speed, subtype inventor", () => {
  const board = (icons: Icons) => joBoard({ joZone: "hand", icons });
  const short = board({ elitism: 4 });
  assert.throws(() => playRaw(short.engine, P1, short.id("jo")), "4 resources");
  const threeE = board({ elitism: 3, rage: 8 });
  assert.throws(() => playRaw(threeE.engine, P1, threeE.id("jo")), "three [E]");
  const { engine, id } = board({ elitism: 4, rage: 1 });
  play(engine, P1, id("jo"));
  assert.equal(zoneOf(engine, id("jo")), "play");
  assert.equal(ready(engine), 0, "exactly 5 spent");
  assert.equal(engine.getStat(id("jo"), "strength"), 1);
  assert.equal(engine.getStat(id("jo"), "life"), 1);
  assert.equal(engine.getStat(id("jo"), "speed"), 3);
  assert.deepEqual(engine.getSubtypes(id("jo")), ["inventor"]);
});

// --- Legacy Warmachine -----------------------------------------------------
// No rules text. Character, cost 5, threshold [E], 2 strength / 1 speed / 5 life,
// subtype warmachine.

const WARMACHINE = "3a49aa60-2843-4234-a888-464f6e556506";

function warmachineBoard(icons: Icons) {
  return buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "wm", def: printing(WARMACHINE), owner: P1, zone: "hand" }, ...res(icons)] });
}

clause(WARMACHINE, "vanilla", "deploys for exactly its printed cost of 5 with [E], and spends no more", () => {
  const { engine, id } = warmachineBoard({ elitism: 1, rage: 6 });
  play(engine, P1, id("wm"));
  assert.equal(zoneOf(engine, id("wm")), "play");
  assert.equal(ready(engine), 2, "exactly 5 of 7 resources were spent");
  assert.equal(attachedCount(engine, P1), 5);
});

clause(WARMACHINE, "vanilla", "is refused one resource short (4 resources, all [E])", () => {
  const { engine, id } = warmachineBoard({ elitism: 4 });
  assert.throws(() => playRaw(engine, P1, id("wm")));
  assert.equal(zoneOf(engine, id("wm")), "hand");
  assert.equal(ready(engine), 4);
});

clause(WARMACHINE, "vanilla", "is refused without [E], however many other resources there are", () => {
  const { engine, id } = warmachineBoard({ rage: 6, greed: 4, deception: 4, obsession: 4 });
  assert.throws(() => playRaw(engine, P1, id("wm")));
  assert.equal(zoneOf(engine, id("wm")), "hand");
});

clause(WARMACHINE, "vanilla", "plays with exactly [E] and four other resources", () => {
  const { engine, id } = warmachineBoard({ elitism: 1, rage: 4 });
  play(engine, P1, id("wm"));
  assert.equal(zoneOf(engine, id("wm")), "play");
  assert.equal(ready(engine), 0);
});

clause(WARMACHINE, "vanilla", "has its printed stats in play: 2 strength, 5 life, 1 speed, subtype warmachine, and no keywords or abilities", () => {
  const { engine, id } = warmachineBoard({ elitism: 5 });
  play(engine, P1, id("wm"));
  assert.equal(engine.getStat(id("wm"), "strength"), 2);
  assert.equal(engine.getStat(id("wm"), "life"), 5);
  assert.equal(engine.getStat(id("wm"), "speed"), 1);
  assert.deepEqual(engine.getSubtypes(id("wm")), ["warmachine"]);
  assert.deepEqual(engine.getKeywords(id("wm")), []);
  assert.deepEqual(engine.getRestrictions(id("wm")), []);
  assert.deepEqual(engine.getAvailableActivatedAbilities(P1).filter((a) => a.cardId === id("wm")), []);
  assert.deepEqual(engine.getCardTypes(id("wm")), ["character"]);
});

clause(WARMACHINE, "vanilla", "dies to exactly 5 damage, not 4 (printed life 5)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "wm", def: printing(WARMACHINE), owner: P1, zone: "play" },
      { key: "z4", def: zapTactic("Z4", 4), owner: P1, zone: "hand" },
      { key: "z1", def: zapTactic("Z1", 1), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("z4"), { selected: { t: [id("wm")] } });
  assert.equal(zoneOf(engine, id("wm")), "play");
  play(engine, P1, id("z1"), { selected: { t: [id("wm")] } });
  assert.equal(zoneOf(engine, id("wm")), "discard");
});

// --- Lugubrious Node -------------------------------------------------------
// This card cannot be destroyed by other "node" cards. RECONSTRUCT -- COST: Pay 1,
// deplete this card, pick a "node" card in your discard pile. -- EFFECT: Shuffle
// the card into your deck. Item, cost 4, threshold [E][E][E], subtype node.

const LUGUBRIOUS = "28c02d57-7ab8-4174-9d9f-3dc0f6370047";

/** A node character with an activated ability that destroys a chosen item; `isNode` controls its subtype. */
const smasher = (name: string, isNode: boolean): CardDefinition =>
  character({
    name,
    strength: 1,
    life: 3,
    subtype: isNode ? ["node"] : [],
    behavior: {
      abilities: [
        {
          id: "smash",
          type: "activated",
          costs: [],
          targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

function lugubriousBoard(opts: { extra?: CardPlacement[]; icons?: Icons } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ln", def: printing(LUGUBRIOUS), owner: P1, zone: "play" },
      { key: "basic", def: printing(BASIC_NODE), owner: P1, zone: "play" },
      { key: "oppBasic", def: printing(BASIC_NODE), owner: P2, zone: "play" },
      { key: "otherNode", def: character({ name: "OtherNode", subtype: ["node"], life: 9 }), owner: P1, zone: "play" },
      { key: "otherItem", def: item({ name: "OtherItem", subtype: ["node"] }), owner: P2, zone: "play" },
      { key: "plain", def: character({ name: "Plain", life: 9 }), owner: P2, zone: "play" },
      { key: "kill", def: killAnyTactic("item"), owner: P1, zone: "hand" },
      { key: "killChar", def: killTactic(), owner: P1, zone: "hand" },
      { key: "nodeSmasher", def: smasher("NodeSmasher", true), owner: P1, zone: "play" },
      { key: "plainSmasher", def: smasher("PlainSmasher", false), owner: P1, zone: "play" },
      ...res(opts.icons ?? { elitism: 4 }),
      ...(opts.extra ?? [])
    ]
  });
}

clause(LUGUBRIOUS, "0:rule", "a Basic Node being destroyed destroys every node card EXCEPT this one", () => {
  const { engine, id } = lugubriousBoard();
  play(engine, P1, id("killChar"), { selected: { t: [id("basic")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("basic")), "discard");
  assert.equal(zoneOf(engine, id("ln")), "play", "protected from the node's effect");
  assert.equal(zoneOf(engine, id("otherNode")), "discard", "other node cards are destroyed as normal");
  assert.equal(zoneOf(engine, id("otherItem")), "discard");
  assert.equal(zoneOf(engine, id("oppBasic")), "discard");
  assert.equal(zoneOf(engine, id("plain")), "play");
});

clause(LUGUBRIOUS, "0:rule", "the same for a Hub Node's wipe, and whichever player controls the destroyed node", () => {
  const { engine, id } = lugubriousBoard({ extra: [{ key: "hub", def: printing(HUB_NODE), owner: P2, zone: "play" }] });
  play(engine, P1, id("killChar"), { selected: { t: [id("hub")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("hub")), "discard");
  assert.equal(zoneOf(engine, id("ln")), "play", "an opponent's node cannot destroy it either");
  assert.equal(zoneOf(engine, id("otherNode")), "discard");
});

clause(LUGUBRIOUS, "0:rule", "an activated ability of a node character that destroys it does nothing to it", () => {
  const { engine, id } = lugubriousBoard();
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("nodeSmasher"), abilityId: "smash", selected: { t: [id("ln")] }, variables: {} });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("ln")), "play");
});

clause(LUGUBRIOUS, "0:rule", "control: the same ability on a card that is NOT a node does destroy it", () => {
  const { engine, id } = lugubriousBoard();
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("plainSmasher"), abilityId: "smash", selected: { t: [id("ln")] }, variables: {} });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("ln")), "discard");
});

clause(LUGUBRIOUS, "0:rule", "a destroy tactic (not a node card) destroys it as normal", () => {
  const { engine, id } = lugubriousBoard();
  play(engine, P1, id("kill"), { selected: { t: [id("ln")] } });
  assert.equal(zoneOf(engine, id("ln")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("ln")), "discardOf(engine, P1).includes(id(\"ln\"))");
});

clause(LUGUBRIOUS, "0:rule", "without any node card around nothing changes: it is destroyed by a destroy tactic", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ln", def: printing(LUGUBRIOUS), owner: P1, zone: "play" }, { key: "kill", def: killAnyTactic("item"), owner: P1, zone: "hand" }]
  });
  play(engine, P1, id("kill"), { selected: { t: [id("ln")] } });
  assert.equal(zoneOf(engine, id("ln")), "discard");
});

clause(LUGUBRIOUS, "0:rule", "the protection is only for THIS card: another node item is destroyed by the same node effect", () => {
  const { engine, id } = lugubriousBoard();
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("nodeSmasher"), abilityId: "smash", selected: { t: [id("otherItem")] }, variables: {} });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("otherItem")), "discard");
});

clause(LUGUBRIOUS, "0:rule", "it protects against being destroyed, not against leaving play otherwise: returned to hand it leaves", () => {
  const { engine, id } = lugubriousBoard({
    extra: [{ key: "bounceItem", def: tactic({ name: "BounceItem", cost: 0, behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] } }), owner: P1, zone: "hand" }]
  });
  play(engine, P1, id("bounceItem"), { selected: { t: [id("ln")] } });
  assert.equal(zoneOf(engine, id("ln")), "hand");
});

function reconstructBoard(opts: { resources?: Icons; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ln", def: printing(LUGUBRIOUS), owner: P1, zone: "play" },
      { key: "nodeChar", def: character({ name: "NodeChar", subtype: ["node"] }), owner: P1, zone: "discard" },
      { key: "nodeItem", def: item({ name: "NodeItem", subtype: ["node"] }), owner: P1, zone: "discard" },
      { key: "plainDiscard", def: character({ name: "PlainDiscard" }), owner: P1, zone: "discard" },
      { key: "oppNodeDiscard", def: character({ name: "OppNodeDiscard", subtype: ["node"] }), owner: P2, zone: "discard" },
      { key: "nodeHand", def: character({ name: "NodeHand", subtype: ["node"] }), owner: P1, zone: "hand" },
      { key: "nodeDeck", def: character({ name: "NodeDeck", subtype: ["node"] }), owner: P1, zone: "deck" },
      { key: "nodePlay", def: character({ name: "NodePlay", subtype: ["node"] }), owner: P1, zone: "play" },
      ...deckCards("d", 8, P1),
      ...deckCards("o", 4, P2),
      ...res(opts.resources ?? { rage: 3 }),
      ...(opts.extra ?? [])
    ]
  });
}

const reconstruct = (engine: SpoilsEngine, id: (key: string) => string, target: string) =>
  activate(engine, P1, id("ln"), "reconstruct", { selected: { n: [id(target)] } });

clause(LUGUBRIOUS, "1:ability:reconstruct", "pays 1 (any resource), depletes this card, and shuffles the picked node card from my discard pile into my deck", () => {
  const { engine, id } = reconstructBoard();
  const spent = spentBy(engine, P1, () => reconstruct(engine, id, "nodeChar"));
  assert.equal(spent, 1, "COST: Pay 1");
  assert.equal(engine.state.cards[id("ln")].depleted, true, "COST: deplete this card");
  assert.equal(zoneOf(engine, id("nodeChar")), "deck");
  assert.ok(deckOf(engine, P1).includes(id("nodeChar")), "it is in my deck");
  assert.ok(!discardOf(engine, P1).includes(id("nodeChar")), "!discardOf(engine, P1).includes(id(\"nodeChar\"))");
  assert.equal(zoneOf(engine, id("nodeItem")), "discard", "other cards in the discard pile stay");
});

clause(LUGUBRIOUS, "1:ability:reconstruct", "a node item in the discard pile can be picked too", () => {
  const { engine, id } = reconstructBoard();
  reconstruct(engine, id, "nodeItem");
  assert.equal(zoneOf(engine, id("nodeItem")), "deck");
});

clause(LUGUBRIOUS, "1:ability:reconstruct", "the deck is SHUFFLED: the card is not left on top or at the bottom, and the same cards are in the deck plus the new one", () => {
  const { engine, id } = reconstructBoard();
  const before = [...deckOf(engine, P1)];
  reconstruct(engine, id, "nodeChar");
  const after = deckOf(engine, P1);
  assert.deepEqual([...after].sort(), [...before, id("nodeChar")].sort(), "same cards plus the one shuffled in");
  assert.notDeepEqual(after, [...before, id("nodeChar")], "not just added at the bottom");
  assert.notDeepEqual(after, [id("nodeChar"), ...before], "not just added on top");
});

clause(LUGUBRIOUS, "1:ability:reconstruct", "the opponent's deck is not touched", () => {
  const { engine, id } = reconstructBoard();
  const oppDeck = [...deckOf(engine, P2)];
  reconstruct(engine, id, "nodeChar");
  assert.deepEqual(deckOf(engine, P2), oppDeck);
  assert.equal(zoneOf(engine, id("oppNodeDiscard")), "discard");
});

clause(LUGUBRIOUS, "1:ability:reconstruct", "the pick must be a node card in MY discard pile: a non-node card, a node in my hand / deck / in play, and a node in the opponent's discard pile are refused", () => {
  const { engine, id } = reconstructBoard();
  const attempt = (target: string) => () => reconstruct(engine, id, target);
  assert.throws(attempt("plainDiscard"), "not a node card");
  assert.throws(attempt("nodeHand"), "my hand");
  assert.throws(attempt("nodeDeck"), "my deck");
  assert.throws(attempt("nodePlay"), "in play");
  assert.throws(attempt("oppNodeDiscard"), "the opponent's discard pile");
  assert.throws(() => activate(engine, P1, id("ln"), "reconstruct", { selected: {} }), "no pick");
  assert.throws(() => activate(engine, P1, id("ln"), "reconstruct", { selected: { n: [id("nodeChar"), id("nodeItem")] } }), "two picks");
  assert.equal(engine.state.cards[id("ln")].depleted, false, "refused attempts do not deplete it");
  assert.equal(ready(engine), 3, "...or spend anything");
  attempt("nodeChar")();
  assert.equal(zoneOf(engine, id("nodeChar")), "deck");
});

clause(LUGUBRIOUS, "1:ability:reconstruct", "refused with no resource to pay, and when this card is already depleted", () => {
  const broke = reconstructBoard({ resources: {} });
  assert.throws(() => reconstruct(broke.engine, broke.id, "nodeChar"), "cannot pay 1");
  assert.equal(zoneOf(broke.engine, broke.id("nodeChar")), "discard");
  assert.equal(broke.engine.state.cards[broke.id("ln")].depleted, false);

  const { engine, id } = reconstructBoard();
  engine.state.cards[id("ln")].depleted = true;
  assert.throws(() => reconstruct(engine, id, "nodeChar"), "already depleted");
  assert.equal(ready(engine), 3);
});

clause(LUGUBRIOUS, "1:ability:reconstruct", "with exactly one resource it can be used; it cannot be used twice in a turn", () => {
  const { engine, id } = reconstructBoard({ resources: { greed: 1 } });
  reconstruct(engine, id, "nodeChar");
  assert.equal(ready(engine), 0);
  assert.throws(() => reconstruct(engine, id, "nodeItem"), "depleted now");
  endTurn(engine, P1);
  endTurn(engine, P2);
  reconstruct(engine, id, "nodeItem");
  assert.equal(zoneOf(engine, id("nodeItem")), "deck", "restored for the next turn");
});

clause(LUGUBRIOUS, "1:ability:reconstruct", "only its controller can use it", () => {
  const { engine, id } = reconstructBoard();
  assert.throws(() => engine.perform({ type: "activateAbility", playerId: P2, cardId: id("ln"), abilityId: "reconstruct", selected: { n: [id("nodeChar")] }, variables: {} }));
  assert.equal(zoneOf(engine, id("nodeChar")), "discard");
});

clause(LUGUBRIOUS, "1:ability:reconstruct", "deploys for exactly 4 with [E][E][E] (refused one short or with two [E]), as an item with the node subtype", () => {
  const board = (icons: Icons) => buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "ln", def: printing(LUGUBRIOUS), owner: P1, zone: "hand" }, ...res(icons)] });
  const short = board({ elitism: 3 });
  assert.throws(() => playRaw(short.engine, P1, short.id("ln")));
  const twoE = board({ elitism: 2, rage: 6 });
  assert.throws(() => playRaw(twoE.engine, P1, twoE.id("ln")));
  const { engine, id } = board({ elitism: 3, rage: 2 });
  play(engine, P1, id("ln"));
  assert.equal(zoneOf(engine, id("ln")), "play");
  assert.equal(ready(engine), 1, "exactly 4 spent");
  assert.deepEqual(engine.getCardTypes(id("ln")), ["item"]);
  assert.deepEqual(engine.getSubtypes(id("ln")), ["node"]);
});

// --- Luteoderm Armor / Luteoderm Goliath: the shared 'gear' rules ------------
// Both cards print:
//   ATTACH TO CHARACTER
//   The attached character gains B strength and B life.
//   HANDOFF -- COST: Pay H. Deplete a character you control that is not in a battle. -- EFFECT: Attach this card to the character.
// Armor: B=2, H=3, cost 3, threshold [E][E].  Goliath: B=11, H=6, cost 8, threshold [E][E][E][E].
// (ARMOR and GOLIATH are the printing ids declared above.)

interface Lute {
  subject: string;
  bonus: number;
  handoff: number;
  cost: number;
  eNeeded: number;
}
const LUTE_ARMOR: Lute = { subject: ARMOR, bonus: 2, handoff: 3, cost: 3, eNeeded: 2 };
const LUTE_GOLIATH: Lute = { subject: GOLIATH, bonus: 11, handoff: 6, cost: 8, eNeeded: 4 };

function luteBoard(l: Lute, opts: { onHost?: string; icons?: Icons; extra?: CardPlacement[]; activePlayerId?: PlayerId; turn?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.activePlayerId,
    cards: [
      { key: "gear", def: printing(l.subject), owner: P1, zone: opts.onHost ? "play" : "hand", attachedToKey: opts.onHost },
      { key: "host", def: character({ name: "Host", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "host2", def: character({ name: "Host2", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "host3", def: character({ name: "Host3", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "killChar", def: killTactic(), owner: P1, zone: "hand" },
      { key: "killItem", def: killAnyTactic("item"), owner: P1, zone: "hand" },
      { key: "bounce", def: tactic({ name: "Bounce", cost: 0, behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] } }), owner: P1, zone: "hand" },
      ...res(opts.icons ?? { elitism: 16 }),
      ...(opts.extra ?? [])
    ]
  });
}

const attachGear = (engine: SpoilsEngine, id: (key: string) => string, hostKey: string) =>
  play(engine, P1, id("gear"), { selected: { attachTo: [id(hostKey)] } });

const handoffTo = (engine: SpoilsEngine, id: (key: string) => string, targetKey: string, player: PlayerId = P1) =>
  activate(engine, player, id("gear"), "handoff", { selected: { h: [id(targetKey)] } });

// attach

function luteAttach(l: Lute) {
  const { engine, id } = luteBoard(l);
  const spent = spentBy(engine, P1, () => attachGear(engine, id, "host"));
  assert.equal(spent, l.cost, "the printed cost");
  assert.equal(zoneOf(engine, id("gear")), "play");
  assert.equal(engine.state.cards[id("gear")].attachedTo, id("host"));
  assert.equal(engine.state.cards[id("gear")].controllerId, P1);
  assert.equal(engine.state.cards[id("host2")].attachedTo, undefined);
  const opp = luteBoard(l);
  attachGear(opp.engine, opp.id, "foe");
  assert.equal(opp.engine.state.cards[opp.id("gear")].attachedTo, opp.id("foe"), "any character, including an opponent's");
  assert.equal(opp.engine.state.cards[opp.id("gear")].controllerId, P1);
}

function luteAttachRefusals(l: Lute) {
  const { engine, id } = luteBoard(l, {
    extra: [
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...volition(1, P1).map((p) => ({ ...p, key: "downResource" }))
    ]
  });
  const attempt = (hostId: string) => () => playRaw(engine, P1, id("gear"), { selected: { attachTo: [hostId] } });
  assert.throws(attempt(id("thing")), "item");
  assert.throws(attempt(id("place")), "location");
  assert.throws(attempt(factionOf(engine, P1)), "my faction");
  assert.throws(attempt(factionOf(engine, P2)), "their faction");
  assert.throws(attempt(id("downResource")), "face-down card");
  assert.throws(attempt(id("inHand")), "hand");
  assert.throws(attempt(id("inDiscard")), "discard pile");
  assert.throws(() => playRaw(engine, P1, id("gear"), { selected: {} }), "a host must be picked");
  assert.throws(() => playRaw(engine, P1, id("gear"), { selected: { attachTo: [id("host"), id("host2")] } }), "only one host");
  assert.equal(zoneOf(engine, id("gear")), "hand");
  attempt(id("host"))();
  assert.ok(engine.state.responseWindow, "a character is accepted");
}

function luteDeploy(l: Lute) {
  const attempt = (icons: Icons) => {
    const board = luteBoard(l, { icons });
    return { ...board, run: () => playRaw(board.engine, P1, board.id("gear"), { selected: { attachTo: [board.id("host")] } }) };
  };
  const short = attempt({ elitism: l.cost - 1 });
  assert.throws(short.run, "one resource short");
  assert.equal(zoneOf(short.engine, short.id("gear")), "hand");
  const fewE = attempt({ elitism: l.eNeeded - 1, rage: 20 });
  assert.throws(fewE.run, "one [E] short");
  const exact = attempt({ elitism: l.eNeeded, rage: l.cost - l.eNeeded });
  exact.run();
  resolvePendingResponses(exact.engine);
  assert.equal(zoneOf(exact.engine, exact.id("gear")), "play", "exactly enough");
  assert.equal(ready(exact.engine), 0);
  assert.deepEqual(exact.engine.getCardTypes(exact.id("gear")), ["item"]);
  assert.deepEqual(exact.engine.getSubtypes(exact.id("gear")), ["gear"]);
}

function luteHostDestroyed(l: Lute) {
  const { engine, id } = luteBoard(l, { onHost: "host", turn: 1 });
  play(engine, P1, id("killChar"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "discard");
  assert.equal(zoneOf(engine, id("gear")), "discard", "leaves play the same way: destroyed with its host");
  assert.equal(engine.state.cards[id("gear")].attachedTo, undefined);
}

function luteHostBounced(l: Lute) {
  const { engine, id } = luteBoard(l, { onHost: "host", turn: 1 });
  play(engine, P1, id("bounce"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "hand");
  assert.equal(zoneOf(engine, id("gear")), "hand", "leaves play the same way (CR 301.4a): put into its owner's hand");
}

// the stat rule

function luteBonus(l: Lute) {
  const { engine, id } = luteBoard(l, { onHost: "host" });
  assert.equal(engine.getStat(id("host"), "strength"), 2 + l.bonus);
  assert.equal(engine.getStat(id("host"), "life"), 3 + l.bonus);
  assert.equal(engine.getStat(id("host"), "speed"), 2, "speed is unchanged");
  for (const key of ["host2", "foe"]) {
    assert.equal(engine.getStat(id(key), "strength"), 2, `${key} (not attached) has no bonus`);
    assert.equal(engine.getStat(id(key), "life"), 3);
  }
}

function luteBonusOnOpponentsCharacter(l: Lute) {
  const { engine, id } = luteBoard(l, { onHost: "foe" });
  assert.equal(engine.getStat(id("foe"), "strength"), 2 + l.bonus, "the attached character gains it, whoever controls the character");
  assert.equal(engine.getStat(id("foe"), "life"), 3 + l.bonus);
  assert.equal(engine.getStat(id("host"), "strength"), 2);
}

function luteBonusOffInHand(l: Lute) {
  const { engine, id } = luteBoard(l);
  assert.equal(engine.getStat(id("host"), "strength"), 2);
  assert.equal(engine.getStat(id("host"), "life"), 3);
}

function luteBonusEnds(l: Lute) {
  const { engine, id } = luteBoard(l, { onHost: "host", turn: 1 });
  play(engine, P1, id("killItem"), { selected: { t: [id("gear")] } });
  assert.equal(zoneOf(engine, id("gear")), "discard");
  assert.equal(engine.getStat(id("host"), "strength"), 2);
  assert.equal(engine.getStat(id("host"), "life"), 3);
  assert.equal(zoneOf(engine, id("host")), "play");
}

function luteLifeIsReal(l: Lute) {
  const { engine, id } = luteBoard(l, {
    onHost: "host",
    turn: 1,
    extra: [
      { key: "almost", def: zapTactic("Almost", 2 + l.bonus), owner: P1, zone: "hand" },
      { key: "one", def: zapTactic("One", 1), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("almost"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "play", `${2 + l.bonus} damage does not destroy a life-${3 + l.bonus} character`);
  play(engine, P1, id("one"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "discard", `${3 + l.bonus} damage does`);
}

function luteStacks(l: Lute) {
  const { engine, id } = luteBoard(l, { onHost: "host", extra: [{ key: "gear2", def: printing(l.subject), owner: P1, zone: "play", attachedToKey: "host" }] });
  assert.equal(engine.getStat(id("host"), "strength"), 2 + 2 * l.bonus);
  assert.equal(engine.getStat(id("host"), "life"), 3 + 2 * l.bonus);
}

// HANDOFF

function luteHandoffPays(l: Lute) {
  const { engine, id } = luteBoard(l, { onHost: "host" });
  const spent = spentBy(engine, P1, () => handoffTo(engine, id, "host2"));
  assert.equal(spent, l.handoff, "COST: Pay H");
  assert.equal(engine.state.cards[id("host2")].depleted, true, "COST: deplete the character");
  assert.equal(engine.state.cards[id("gear")].attachedTo, id("host2"), "EFFECT: attach this card to the character");
  assert.equal(engine.state.cards[id("host")].depleted, false, "the old host is not depleted");
  assert.equal(engine.getStat(id("host"), "strength"), 2, "the old host loses the bonus");
  assert.equal(engine.getStat(id("host"), "life"), 3);
  assert.equal(engine.getStat(id("host2"), "strength"), 2 + l.bonus, "the new host gains it");
  assert.equal(engine.getStat(id("host2"), "life"), 3 + l.bonus);
  assert.equal(engine.state.cards[id("host3")].depleted, false, "no other character is depleted");
  assert.equal(zoneOf(engine, id("gear")), "play");
}

function luteHandoffTargets(l: Lute) {
  const { engine, id } = luteBoard(l, {
    onHost: "host",
    extra: [
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      ...volition(1, P1).map((p) => ({ ...p, key: "downResource" }))
    ]
  });
  const resources = ready(engine);
  const attempt = (picked: string) => () => activate(engine, P1, id("gear"), "handoff", { selected: { h: [picked] } });
  assert.throws(attempt(id("foe")), "a character my opponent controls");
  assert.throws(attempt(id("thing")), "an item");
  assert.throws(attempt(id("place")), "a location");
  assert.throws(attempt(factionOf(engine, P1)), "my faction");
  assert.throws(attempt(id("downResource")), "a face-down card");
  assert.throws(attempt(id("inHand")), "a character in my hand");
  assert.throws(() => activate(engine, P1, id("gear"), "handoff", { selected: {} }), "no pick");
  assert.throws(() => activate(engine, P1, id("gear"), "handoff", { selected: { h: [id("host2"), id("host3")] } }), "two picks");
  assert.equal(ready(engine), resources, "nothing was paid by any refused attempt");
  assert.equal(engine.state.cards[id("gear")].attachedTo, id("host"));
  attempt(id("host3"))();
  assert.equal(engine.state.cards[id("gear")].attachedTo, id("host3"));
}

function luteHandoffNotInBattle(l: Lute) {
  const { engine, id } = luteBoard(l, {
    onHost: "host",
    turn: 2,
    activePlayerId: P2,
    extra: [{ key: "atk", def: character({ name: "Atk", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" }]
  });
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
  untilPriority(engine, P1);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("host2")] });
  untilPriority(engine, P1);
  assert.throws(() => handoffTo(engine, id, "host2"), "a blocker is in a battle");
  assert.equal(ready(engine), 16, "nothing was paid");
  assert.equal(engine.state.cards[id("host2")].depleted, false, "the blocker was not depleted");
  assert.equal(engine.state.cards[id("gear")].attachedTo, id("host"));
  handoffTo(engine, id, "host3");
  assert.equal(engine.state.cards[id("gear")].attachedTo, id("host3"), "a character that is not in the battle is fine, even during one");
}

function luteHandoffNotInBattleAttacker(l: Lute) {
  const { engine, id } = luteBoard(l, { onHost: "host2", turn: 2 });
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("host")], target: { type: "faction", playerId: P2 } });
  assert.throws(() => handoffTo(engine, id, "host"), "an attacker is in a battle");
  assert.equal(engine.state.cards[id("gear")].attachedTo, id("host2"));
  handoffTo(engine, id, "host3");
  assert.equal(engine.state.cards[id("gear")].attachedTo, id("host3"));
}

function luteHandoffDepleted(l: Lute) {
  const { engine, id } = luteBoard(l, { onHost: "host" });
  engine.state.cards[id("host2")].depleted = true;
  assert.throws(() => handoffTo(engine, id, "host2"), "an already-depleted character cannot be depleted again");
  assert.equal(ready(engine), 16);
  handoffTo(engine, id, "host3");
  assert.equal(engine.state.cards[id("host3")].depleted, true);
}

function luteHandoffTwice(l: Lute) {
  const { engine, id } = luteBoard(l, { onHost: "host" });
  handoffTo(engine, id, "host2");
  assert.throws(() => handoffTo(engine, id, "host2"), "host2 is depleted now");
  handoffTo(engine, id, "host3");
  assert.equal(engine.state.cards[id("gear")].attachedTo, id("host3"));
  assert.equal(engine.state.cards[id("host2")].depleted, true, "host2 stays depleted");
  assert.equal(engine.getStat(id("host2"), "strength"), 2);
}

function luteHandoffFromOpponentsCharacter(l: Lute) {
  const { engine, id } = luteBoard(l, { onHost: "foe" });
  handoffTo(engine, id, "host2");
  assert.equal(engine.state.cards[id("gear")].attachedTo, id("host2"));
  assert.equal(engine.getStat(id("foe"), "strength"), 2, "the opponent's character loses the bonus");
  assert.equal(engine.getStat(id("host2"), "strength"), 2 + l.bonus);
}

function luteHandoffCost(l: Lute) {
  const short = luteBoard(l, { onHost: "host", icons: { rage: l.handoff - 1 } });
  assert.throws(() => handoffTo(short.engine, short.id, "host2"), "one resource short");
  assert.equal(short.engine.state.cards[short.id("host2")].depleted, false);
  assert.equal(short.engine.state.cards[short.id("gear")].attachedTo, short.id("host"));
  const exact = luteBoard(l, { onHost: "host", icons: { rage: l.handoff } });
  handoffTo(exact.engine, exact.id, "host2");
  assert.equal(exact.engine.state.cards[exact.id("gear")].attachedTo, exact.id("host2"), "any resources will do: HANDOFF has no icon threshold");
  assert.equal(ready(exact.engine), 0);
}

function luteHandoffOldHostDies(l: Lute) {
  const { engine, id } = luteBoard(l, { onHost: "host", turn: 1, extra: [{ key: "zap2", def: zapTactic("Zap2", 3), owner: P1, zone: "hand" }] });
  play(engine, P1, id("zap2"), { selected: { t: [id("host")] } });
  assert.equal(engine.state.cards[id("host")].damage, 3, "3 damage on a life-" + (3 + l.bonus) + " character");
  handoffTo(engine, id, "host2");
  assert.equal(zoneOf(engine, id("host")), "discard", "without the bonus its life is 3, so the damage it has already received destroys it");
}

function luteHandoffController(l: Lute) {
  const { engine, id } = luteBoard(l, { onHost: "host" });
  assert.throws(() => engine.perform({ type: "activateAbility", playerId: P2, cardId: id("gear"), abilityId: "handoff", selected: { h: [id("foe")] }, variables: {} }));
  assert.equal(engine.state.cards[id("gear")].attachedTo, id("host"));
  handoffTo(engine, id, "host2");
  assert.equal(engine.state.cards[id("gear")].attachedTo, id("host2"), "control: its controller can use it");
}

function luteHandoffNotFromHand(l: Lute) {
  const { engine, id } = luteBoard(l);
  assert.throws(() => handoffTo(engine, id, "host2"));
  assert.equal(zoneOf(engine, id("gear")), "hand");
  assert.equal(engine.state.cards[id("host2")].depleted, false);
  const inPlay = luteBoard(l, { onHost: "host" });
  handoffTo(inPlay.engine, inPlay.id, "host2");
  assert.equal(inPlay.engine.state.cards[inPlay.id("gear")].attachedTo, inPlay.id("host2"), "control: from play it works");
}

// --- Luteoderm Armor ---

clause(ARMOR, "0:attach", "played on my turn: pays 3 and enters play attached to the character I pick (mine or the opponent's)", () => luteAttach(LUTE_ARMOR));
clause(ARMOR, "0:attach", "must be attached to a CHARACTER: an item, a location, a faction, a face-down resource, and a character in hand or discard are refused", () => luteAttachRefusals(LUTE_ARMOR));
clause(ARMOR, "0:attach", "deploys for exactly 3 with [E][E] (refused one short or with one [E]) as a gear item", () => luteDeploy(LUTE_ARMOR));
clause(ARMOR, "0:attach", "when the host is destroyed, the Armor leaves play with it (to its owner's discard pile)", () => luteHostDestroyed(LUTE_ARMOR));
clause(ARMOR, "0:attach", "when the host leaves play by other means than destruction, the Armor leaves play the same way (CR 301.4a): a host returned to hand takes it to its owner's hand", () => luteHostBounced(LUTE_ARMOR));
clause(ARMOR, "0:attach", "with no character in play it cannot be played", () => {
  const { engine, id } = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "gear", def: printing(ARMOR), owner: P1, zone: "hand" }, ...res({ elitism: 4 })] });
  assert.throws(() => playRaw(engine, P1, id("gear"), { selected: {} }));
  assert.equal(zoneOf(engine, id("gear")), "hand");
});

clause(ARMOR, "1:rule", "the attached character gains 2 strength and 2 life; its speed and every other character are unchanged", () => luteBonus(LUTE_ARMOR));
clause(ARMOR, "1:rule", "the attached character gains it whoever controls the character (the opponent's character too)", () => luteBonusOnOpponentsCharacter(LUTE_ARMOR));
clause(ARMOR, "1:rule", "off while the Armor is in hand", () => luteBonusOffInHand(LUTE_ARMOR));
clause(ARMOR, "1:rule", "ends when the Armor leaves play (destroyed): the character is back to its own stats", () => luteBonusEnds(LUTE_ARMOR));
clause(ARMOR, "1:rule", "the 2 extra life is real: a 3-life character survives 4 damage and dies at 5", () => luteLifeIsReal(LUTE_ARMOR));
clause(ARMOR, "1:rule", "two Armors on one character stack: +4 strength and +4 life", () => luteStacks(LUTE_ARMOR));

clause(ARMOR, "2:ability:handoff", "pays 3, depletes the picked character of mine, and re-attaches the Armor to it (the bonus moves with it)", () => luteHandoffPays(LUTE_ARMOR));
clause(ARMOR, "2:ability:handoff", "the pick must be a CHARACTER I control: an opponent's character, an item, a location, a faction, a face-down card and a hand card are refused", () => luteHandoffTargets(LUTE_ARMOR));
clause(ARMOR, "2:ability:handoff", "'not in a battle': a blocking character is refused, while a character outside the battle is fine", () => luteHandoffNotInBattle(LUTE_ARMOR));
clause(ARMOR, "2:ability:handoff", "'not in a battle': an attacking character is refused too", () => luteHandoffNotInBattleAttacker(LUTE_ARMOR));
clause(ARMOR, "2:ability:handoff", "an already-depleted character cannot be picked (it cannot be depleted again)", () => luteHandoffDepleted(LUTE_ARMOR));
clause(ARMOR, "2:ability:handoff", "can be used again: the Armor moves on to another character, and the earlier one stays depleted without the bonus", () => luteHandoffTwice(LUTE_ARMOR));
clause(ARMOR, "2:ability:handoff", "an Armor sitting on an opponent's character can be taken over: it moves to my character", () => luteHandoffFromOpponentsCharacter(LUTE_ARMOR));
clause(ARMOR, "2:ability:handoff", "costs exactly 3 resources of any kind: refused with 2, allowed with 3", () => luteHandoffCost(LUTE_ARMOR));
clause(ARMOR, "2:ability:handoff", "the old host loses the bonus at once: damage it has already received can now destroy it", () => luteHandoffOldHostDies(LUTE_ARMOR));
clause(ARMOR, "2:ability:handoff", "only its controller can use it", () => luteHandoffController(LUTE_ARMOR));
clause(ARMOR, "2:ability:handoff", "is an ability of the Armor in play: it cannot be used from my hand", () => luteHandoffNotFromHand(LUTE_ARMOR));

// --- Luteoderm Goliath ---

clause(GOLIATH, "0:attach", "played on my turn: pays 8 and enters play attached to the character I pick (mine or the opponent's)", () => luteAttach(LUTE_GOLIATH));
clause(GOLIATH, "0:attach", "must be attached to a CHARACTER: an item, a location, a faction, a face-down resource, and a character in hand or discard are refused", () => luteAttachRefusals(LUTE_GOLIATH));
clause(GOLIATH, "0:attach", "deploys for exactly 8 with [E][E][E][E] (refused one short or with three [E]) as a gear item", () => luteDeploy(LUTE_GOLIATH));
clause(GOLIATH, "0:attach", "when the host is destroyed, the Goliath leaves play with it (to its owner's discard pile)", () => luteHostDestroyed(LUTE_GOLIATH));
clause(GOLIATH, "0:attach", "when the host leaves play by other means than destruction, the Goliath leaves play the same way (CR 301.4a): a host returned to hand takes it to its owner's hand", () => luteHostBounced(LUTE_GOLIATH));
clause(GOLIATH, "0:attach", "with no character in play it cannot be played", () => {
  const { engine, id } = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "gear", def: printing(GOLIATH), owner: P1, zone: "hand" }, ...res({ elitism: 9 })] });
  assert.throws(() => playRaw(engine, P1, id("gear"), { selected: {} }));
  assert.equal(zoneOf(engine, id("gear")), "hand");
});

clause(GOLIATH, "1:rule", "the attached character gains 11 strength and 11 life; its speed and every other character are unchanged", () => luteBonus(LUTE_GOLIATH));
clause(GOLIATH, "1:rule", "the attached character gains it whoever controls the character (the opponent's character too)", () => luteBonusOnOpponentsCharacter(LUTE_GOLIATH));
clause(GOLIATH, "1:rule", "off while the Goliath is in hand", () => luteBonusOffInHand(LUTE_GOLIATH));
clause(GOLIATH, "1:rule", "ends when the Goliath leaves play (destroyed): the character is back to its own stats", () => luteBonusEnds(LUTE_GOLIATH));
clause(GOLIATH, "1:rule", "the 11 extra life is real: a 3-life character survives 13 damage and dies at 14", () => luteLifeIsReal(LUTE_GOLIATH));
clause(GOLIATH, "1:rule", "two Goliaths on one character stack: +22 strength and +22 life", () => luteStacks(LUTE_GOLIATH));

clause(GOLIATH, "2:ability:handoff", "pays 6, depletes the picked character of mine, and re-attaches the Goliath to it (the bonus moves with it)", () => luteHandoffPays(LUTE_GOLIATH));
clause(GOLIATH, "2:ability:handoff", "the pick must be a CHARACTER I control: an opponent's character, an item, a location, a faction, a face-down card and a hand card are refused", () => luteHandoffTargets(LUTE_GOLIATH));
clause(GOLIATH, "2:ability:handoff", "'not in a battle': a blocking character is refused, while a character outside the battle is fine", () => luteHandoffNotInBattle(LUTE_GOLIATH));
clause(GOLIATH, "2:ability:handoff", "'not in a battle': an attacking character is refused too", () => luteHandoffNotInBattleAttacker(LUTE_GOLIATH));
clause(GOLIATH, "2:ability:handoff", "an already-depleted character cannot be picked (it cannot be depleted again)", () => luteHandoffDepleted(LUTE_GOLIATH));
clause(GOLIATH, "2:ability:handoff", "can be used again: the Goliath moves on to another character, and the earlier one stays depleted without the bonus", () => luteHandoffTwice(LUTE_GOLIATH));
clause(GOLIATH, "2:ability:handoff", "a Goliath sitting on an opponent's character can be taken over: it moves to my character", () => luteHandoffFromOpponentsCharacter(LUTE_GOLIATH));
clause(GOLIATH, "2:ability:handoff", "costs exactly 6 resources of any kind: refused with 5, allowed with 6", () => luteHandoffCost(LUTE_GOLIATH));
clause(GOLIATH, "2:ability:handoff", "the old host loses the bonus at once: damage it has already received can now destroy it", () => luteHandoffOldHostDies(LUTE_GOLIATH));
clause(GOLIATH, "2:ability:handoff", "only its controller can use it", () => luteHandoffController(LUTE_GOLIATH));
clause(GOLIATH, "2:ability:handoff", "is an ability of the Goliath in play: it cannot be used from my hand", () => luteHandoffNotFromHand(LUTE_GOLIATH));

