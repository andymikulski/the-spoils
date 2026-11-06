// Clause tests — batch shade-of-the-devoured-emperor-06, part p2 (groups 7-10, missing clauses only).
// Expectations come from each card's PRINTED text and RULES.md / the CR; engine data is only used to drive the engine.

import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import {
  buildGame,
  activate,
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
  P2
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { declareAttackBy, declareAttackOpenWindow, finishBattle, fightThrough, playRaw } from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, readyResources, zoneOf } from "./_board.js";
import { clause, printing, refused, flipUpNow } from "./_clause.js";
import { endTurn, factionOf } from "./_turn.js";

type Ids = (key: string) => CardInstanceId;
const other = (p: PlayerId): PlayerId => (p === P1 ? P2 : P1);

/** Two-player board with the generic Develop/Restore-capable factions. */
function duo(cards: CardPlacement[], opts: { turn?: number; active?: PlayerId; random?: () => number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    activePlayerId: opts.active ?? P1,
    ...(opts.random ? { random: opts.random } : {}),
    cards
  });
}

const chr = (name: string, over: Partial<CardDefinition> = {}): CardDefinition => character({ name, strength: 2, life: 5, speed: 2, cost: 0, ...over });
const ready = readyResources;
const FACTION = (player: PlayerId) => ({ type: "faction", playerId: player }) as const;
const controllerOf = (engine: SpoilsEngine, cardId: CardInstanceId): PlayerId => engine.state.cards[cardId].controllerId as PlayerId;
const ownerOf = (engine: SpoilsEngine, cardId: CardInstanceId): PlayerId => engine.state.cards[cardId].ownerId as PlayerId;
const flipUp = (engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId): void =>
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected: {}, variables: {} });
const coinFlips = (engine: SpoilsEngine) =>
  engine
    .getLog()
    .filter((entry) => entry.event?.type === "coinFlipped")
    .map((entry) => entry.event as unknown as { playerId: string; won: boolean });
/** A face-down card has been flipped up (it is face-up in play, or already resolved off the board). */
const flippedUp = (engine: SpoilsEngine, cardId: CardInstanceId): boolean => {
  const card = engine.state.cards[cardId];
  return card.zone !== "play" || !card.faceDown;
};

/** Free tactic that destroys one chosen item (target `t`). */
const killItem = (): CardDefinition =>
  tactic({
    name: "KillItem",
    cost: 0,
    behavior: { abilities: [{ id: "ki", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
/** Free tactic that returns one chosen item to its owner's hand (target `t`). */
const bounceItem = (): CardDefinition =>
  tactic({
    name: "BounceItem",
    cost: 0,
    behavior: { abilities: [{ id: "bi", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });
/** Free tactic that destroys one chosen location (target `t`). */
const killLocation = (): CardDefinition =>
  killTactic({
    name: "KillLocation",
    behavior: { abilities: [{ id: "kl", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });

// =====================================================================================
// Sticky Stealy Hand — item, rogue, cost 2, [D][D]
// TACTICAL -- ATTACH TO ITEM -- When this card enters play, flip a coin. If you win, take control of the
// attached item. If you lose, return this card to its owner's hand. -- If this card leaves play, the
// attached item's owner takes control of the item.
// A coin flip is WON when the seeded RNG is below 0.5 (RULES.md: `flipCoin`).
// =====================================================================================

const STICKY = "3d8bb343-be8d-48d8-b3f2-523a3564ffeb";

interface StickyOpts {
  me?: PlayerId;
  active?: PlayerId;
  rng?: number;
  deception?: number;
  rage?: number;
  /** Put the Hand straight into play attached to `foeItem` (no enters-play trigger), controlled by `me`. */
  inPlay?: boolean;
  /** Who controls `foeItem` at the start (default its owner). */
  foeItemController?: PlayerId;
  extra?: CardPlacement[];
}

/** `me` owns the Hand; `foeItem` is the opponent's item, `myItem` mine. Win = RNG below 0.5. */
function stickyBoard(o: StickyOpts = {}) {
  const me = o.me ?? P1;
  const foe = other(me);
  return duo(
    [
      { key: "sh", def: printing(STICKY), owner: me, zone: o.inPlay ? "play" : "hand", ...(o.inPlay ? { attachedToKey: "foeItem" } : {}) },
      { key: "foeItem", def: item({ name: "FoeItem" }), owner: foe, zone: "play", ...(o.foeItemController ? { controller: o.foeItemController } : {}) },
      { key: "myItem", def: item({ name: "MyItem" }), owner: me, zone: "play" },
      { key: "mine", def: chr("Mine"), owner: me, zone: "play" },
      { key: "foeChar", def: chr("FoeChar"), owner: foe, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 5 }), owner: foe, zone: "play" },
      { key: "hidden", def: chr("Hidden"), owner: foe, zone: "play", faceDown: true },
      { key: "res", def: resourceCard({ name: "FoeRes" }), owner: foe, zone: "play" },
      { key: "handItem", def: item({ name: "HandItem" }), owner: foe, zone: "hand" },
      { key: "discItem", def: item({ name: "DiscItem" }), owner: foe, zone: "discard" },
      ...bank("deception", o.deception ?? 2, me),
      ...bank("rage", o.rage ?? 0, me),
      ...(o.extra ?? [])
    ],
    { active: o.active ?? me, random: () => o.rng ?? 0.1 }
  );
}
type StickyBoard = ReturnType<typeof stickyBoard>;
const stickyPlay = (b: StickyBoard, hostKey: string, me: PlayerId = P1): void => play(b.engine, me, b.id("sh"), { selected: { attachTo: [b.id(hostKey)] } });
/** The opponent's attack window with `me` (the non-active player) holding priority. */
function stickyWindow(o: StickyOpts = {}): StickyBoard {
  const me = o.me ?? P1;
  const foe = other(me);
  const b = stickyBoard({
    ...o,
    active: foe,
    extra: [{ key: "atk", def: chr("Atk"), owner: foe, zone: "play" }, { key: "plain", def: item({ name: "Plain", cost: 1 }), owner: me, zone: "hand" }, ...(o.extra ?? [])]
  });
  declareAttackOpenWindow(b.engine, foe, [b.id("atk")]);
  return b;
}

clause(STICKY, "0:kw:TACTICAL", "has the TACTICAL keyword (an ordinary item does not)", () => {
  const { engine, id } = stickyBoard({ extra: [{ key: "plain", def: item({ name: "Plain" }), owner: P1, zone: "hand" }] });
  assert.ok(engine.getKeywords(id("sh")).includes("tactical"), "engine.getKeywords(id(\"sh\")).includes(\"tactical\")");
  assert.equal(engine.getKeywords(id("plain")).includes("tactical"), false, "control: an ordinary item is not tactical");
});

clause(STICKY, "0:kw:TACTICAL", "from hand it deploys in the opponent's attack window (whenever a tactic could be), paying its printed cost 2", () => {
  const b = stickyWindow();
  const before = ready(b.engine, P1);
  stickyPlay(b, "foeItem");
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("sh")), "play", "deployed on the opponent's turn (RNG 0.1 wins the flip, so it stays)");
  assert.equal(b.engine.state.cards[b.id("sh")].attachedTo, b.id("foeItem"));
  assert.equal(before - ready(b.engine, P1), 2, "cost 2 paid");
});

clause(STICKY, "0:kw:TACTICAL", "an ordinary item cannot be deployed in that window, and the Hand cannot on the opponent's turn with no window open", () => {
  const b = stickyBoard({ active: P2, extra: [{ key: "atk", def: chr("Atk"), owner: P2, zone: "play" }, { key: "plain", def: item({ name: "Plain", cost: 1 }), owner: P1, zone: "hand" }] });
  refused(() => play(b.engine, P1, b.id("sh"), { selected: { attachTo: [b.id("foeItem")] } }), "no tactic window on the opponent's turn yet");
  assert.equal(zoneOf(b.engine, b.id("sh")), "hand");
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  refused(() => play(b.engine, P1, b.id("plain"), { selected: { attachTo: [b.id("foeItem")] } }), "a non-tactical item can't be deployed in the opponent's window");
  assert.equal(zoneOf(b.engine, b.id("plain")), "hand");
  stickyPlay(b, "foeItem");
  assert.equal(zoneOf(b.engine, b.id("sh")), "play", "control: the TACTICAL item can");
});

clause(STICKY, "0:kw:TACTICAL", "TACTICAL changes the timing only: cost 2 and the [D][D] threshold are still required in the window", () => {
  // a spent [D] still counts toward [D][D] but cannot pay, so only the cost can refuse
  const spentD = (): CardPlacement[] => bank("deception", 1).map((c) => ({ ...c, attachedToKey: "__factionA" }));
  const short = stickyWindow({ deception: 1, extra: spentD() });
  refused(() => stickyPlay(short, "foeItem"), "one ready resource short of cost 2 ([D][D] threshold met with a spent [D])", /Costs cannot be paid/);
  assert.equal(zoneOf(short.engine, short.id("sh")), "hand");
  const noIcon = stickyWindow({ deception: 0, rage: 5 });
  refused(() => stickyPlay(noIcon, "foeItem"), "cost covered but no [D][D]", /threshold/i);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("sh")), "hand");
  const oneIcon = stickyWindow({ deception: 1, rage: 5 });
  refused(() => stickyPlay(oneIcon, "foeItem"), "only one [D] of the two", /threshold/i);
  const costOk = stickyWindow({ deception: 2, extra: spentD() });
  stickyPlay(costOk, "foeItem");
  assert.equal(zoneOf(costOk.engine, costOk.id("sh")), "play", "control: two ready resources pay the cost");
  const ok = stickyWindow({ deception: 0, rage: 5, extra: bank("deception", 2) });
  stickyPlay(ok, "foeItem");
  assert.equal(zoneOf(ok.engine, ok.id("sh")), "play", "control: [D][D] and enough resources deploys it");
});

clause(STICKY, "1:attach", "attaches to an item: it enters play attached to the picked item and the printed cost 2 is paid", () => {
  const b = stickyBoard();
  const before = ready(b.engine, P1);
  stickyPlay(b, "foeItem");
  assert.equal(zoneOf(b.engine, b.id("sh")), "play");
  assert.equal(b.engine.state.cards[b.id("sh")].attachedTo, b.id("foeItem"), "attached to the picked item");
  assert.equal(before - ready(b.engine, P1), 2, "the printed cost of 2 is paid");
  assert.equal(b.engine.state.cards[b.id("myItem")].attachedTo, undefined, "no other item gets it");
  assert.equal(controllerOf(b.engine, b.id("sh")), P1, "you control the Hand itself");
});

clause(STICKY, "1:attach", "attaches to an item you control too (ATTACH TO ITEM names no controller)", () => {
  const b = stickyBoard();
  stickyPlay(b, "myItem");
  assert.equal(zoneOf(b.engine, b.id("sh")), "play");
  assert.equal(b.engine.state.cards[b.id("sh")].attachedTo, b.id("myItem"));
});

clause(STICKY, "1:attach", "is refused for a host that is not an item: a character, a location, a faction, a face-down card, a resource", () => {
  const b = stickyBoard();
  const attempt = (hostId: CardInstanceId) => () => playRaw(b.engine, P1, b.id("sh"), { selected: { attachTo: [hostId] } });
  refused(attempt(b.id("mine")), "your character");
  refused(attempt(b.id("foeChar")), "an opponent's character");
  refused(attempt(b.id("place")), "a location");
  refused(attempt(factionOf(b.engine, P1)), "your faction");
  refused(attempt(factionOf(b.engine, P2)), "the opponent's faction");
  refused(attempt(b.id("hidden")), "a face-down card is only a resource (CR 411.1)");
  refused(attempt(b.id("res")), "a resource");
  assert.equal(zoneOf(b.engine, b.id("sh")), "hand", "nothing was played");
  attempt(b.id("foeItem"))();
  assert.ok(b.engine.state.responseWindow, "control: an item is accepted");
});

clause(STICKY, "1:attach", "is refused for an item that is not in play (in hand or in a discard pile), and needs exactly one host", () => {
  const b = stickyBoard();
  const attempt = (hostId: CardInstanceId) => () => playRaw(b.engine, P1, b.id("sh"), { selected: { attachTo: [hostId] } });
  refused(attempt(b.id("handItem")), "an item in a hand");
  refused(attempt(b.id("discItem")), "an item in a discard pile");
  refused(() => playRaw(b.engine, P1, b.id("sh"), { selected: { attachTo: [] } }), "no host picked");
  refused(() => playRaw(b.engine, P1, b.id("sh"), {}), "no selection at all");
  refused(() => playRaw(b.engine, P1, b.id("sh"), { selected: { attachTo: [b.id("foeItem"), b.id("myItem")] } }), "two hosts");
  assert.equal(zoneOf(b.engine, b.id("sh")), "hand");
});

clause(STICKY, "2:rule", "won flip (RNG 0.1): the Hand stays in play attached and you take control of the attached item (it stays the opponent's by ownership)", () => {
  const b = stickyBoard({ rng: 0.1 });
  assert.equal(controllerOf(b.engine, b.id("foeItem")), P2, "before: the opponent controls it");
  stickyPlay(b, "foeItem");
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("sh")), "play", "the won flip leaves the Hand in play");
  assert.equal(b.engine.state.cards[b.id("sh")].attachedTo, b.id("foeItem"));
  assert.equal(controllerOf(b.engine, b.id("foeItem")), P1, "you take control of the attached item");
  assert.equal(ownerOf(b.engine, b.id("foeItem")), P2, "ownership does not change");
  assert.equal(controllerOf(b.engine, b.id("myItem")), P1, "your other item is untouched");
});

clause(STICKY, "2:rule", "lost flip (RNG 0.9): the Hand returns to its owner's hand (detached), the item stays with the opponent, and the cost 2 was still paid", () => {
  const b = stickyBoard({ rng: 0.9 });
  const before = ready(b.engine, P1);
  stickyPlay(b, "foeItem");
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("sh")), "hand", "the lost flip returns it to its owner's hand");
  assert.equal(b.engine.state.players[P1].hand.includes(b.id("sh")), true);
  assert.equal(b.engine.state.cards[b.id("sh")].attachedTo, undefined, "no longer attached");
  assert.equal(controllerOf(b.engine, b.id("foeItem")), P2, "the item stays with the opponent");
  assert.equal(before - ready(b.engine, P1), 2, "the resources spent on it stay spent");
});

clause(STICKY, "2:rule", "the flip is made for the player who plays it: the opponent playing it on my item takes control on a win and gets it back in their hand on a loss", () => {
  const won = stickyBoard({ me: P2, rng: 0.1 });
  stickyPlay(won, "foeItem", P2);
  assert.equal(zoneOf(won.engine, won.id("sh")), "play");
  assert.equal(controllerOf(won.engine, won.id("foeItem")), P2, "P2 took control of P1's item");
  assert.equal(ownerOf(won.engine, won.id("foeItem")), P1);
  const lost = stickyBoard({ me: P2, rng: 0.9 });
  stickyPlay(lost, "foeItem", P2);
  assert.equal(zoneOf(lost.engine, lost.id("sh")), "hand");
  assert.equal(lost.engine.state.players[P2].hand.includes(lost.id("sh")), true, "P2's hand");
  assert.equal(controllerOf(lost.engine, lost.id("foeItem")), P1);
});

clause(STICKY, "2:rule", "on an item you already control a won flip changes nothing and the Hand stays; a lost flip still returns it", () => {
  const won = stickyBoard({ rng: 0.1 });
  stickyPlay(won, "myItem");
  assert.equal(zoneOf(won.engine, won.id("sh")), "play");
  assert.equal(controllerOf(won.engine, won.id("myItem")), P1);
  const lost = stickyBoard({ rng: 0.9 });
  stickyPlay(lost, "myItem");
  assert.equal(zoneOf(lost.engine, lost.id("sh")), "hand");
  assert.equal(controllerOf(lost.engine, lost.id("myItem")), P1);
});

clause(STICKY, "2:rule", "a won flip takes back an item the opponent holds but I own (control moves to me)", () => {
  const b = stickyBoard({ rng: 0.1, extra: [{ key: "stolen", def: item({ name: "Stolen" }), owner: P1, zone: "play", controller: P2 }] });
  stickyPlay(b, "stolen");
  assert.equal(zoneOf(b.engine, b.id("sh")), "play");
  assert.equal(controllerOf(b.engine, b.id("stolen")), P1);
});

clause(STICKY, "2:rule", "the flip is a real coin flip: a coinFlipped event is recorded for its controller (won below RNG 0.5)", () => {
  for (const [rng, won] of [[0.1, true], [0.9, false]] as const) {
    const b = stickyBoard({ rng });
    stickyPlay(b, "foeItem");
    const flips = coinFlips(b.engine);
    assert.equal(flips.length, 1, `RNG ${rng}: exactly one coin flip is recorded`);
    assert.equal(flips[0].playerId, P1, "the Hand's controller flips");
    assert.equal(flips[0].won, won, `RNG ${rng}: the flip is ${won ? "won" : "lost"}`);
    assert.equal(zoneOf(b.engine, b.id("sh")) === "play", flips[0].won, "the Hand stays in play exactly when the recorded flip is won");
  }
});

clause(STICKY, "2:rule", "only when THIS card enters play: another card entering play flips no coin (the Hand in play, RNG 0.9, stays and nothing changes)", () => {
  const b = stickyBoard({ inPlay: true, rng: 0.9, foeItemController: P1, extra: [{ key: "newbie", def: chr("Newbie"), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("newbie"));
  assert.equal(zoneOf(b.engine, b.id("newbie")), "play", "the control card deployed");
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("sh")), "play", "no flip was made, so it was not returned");
  assert.equal(controllerOf(b.engine, b.id("foeItem")), P1, "control unchanged");
  assert.equal(coinFlips(b.engine).length, 0, "no coin flipped");
});

clause(STICKY, "3:rule", "leaves play (destroyed): the attached item's owner (not the Hand's controller) takes control of the item back", () => {
  const b = stickyBoard({ inPlay: true, foeItemController: P1, extra: [{ key: "kill", def: killItem(), owner: P1, zone: "hand" }] });
  assert.equal(controllerOf(b.engine, b.id("foeItem")), P1, "before: I control the opponent's item");
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("sh")] } });
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("sh")), "discard", "the Hand was destroyed");
  assert.equal(zoneOf(b.engine, b.id("foeItem")), "play", "the item stays in play");
  assert.equal(controllerOf(b.engine, b.id("foeItem")), P2, "its owner takes control of it");
});

clause(STICKY, "3:rule", "leaves play (returned to hand): control goes back to the item's owner too", () => {
  const b = stickyBoard({ inPlay: true, foeItemController: P1, extra: [{ key: "bounce", def: bounceItem(), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("sh")] } });
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("sh")), "hand", "the Hand went back to my hand");
  assert.equal(controllerOf(b.engine, b.id("foeItem")), P2, "its owner takes control of it");
});

clause(STICKY, "3:rule", "the item's OWNER takes control, not whoever held it before: an item I own that the opponent controlled returns to me, and my own item stays mine", () => {
  // The Hand is on an item I own that the opponent controls.
  const b = duo(
    [
      { key: "sh", def: printing(STICKY), owner: P1, zone: "play", attachedToKey: "stolen" },
      { key: "stolen", def: item({ name: "Stolen" }), owner: P1, zone: "play", controller: P2 },
      { key: "kill", def: killItem(), owner: P1, zone: "hand" }
    ],
    { random: () => 0.1 }
  );
  assert.equal(controllerOf(b.engine, b.id("stolen")), P2);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("sh")] } });
  assert.equal(zoneOf(b.engine, b.id("sh")), "discard");
  assert.equal(controllerOf(b.engine, b.id("stolen")), P1, "the owner (P1) takes control");
  const own = duo(
    [
      { key: "sh", def: printing(STICKY), owner: P1, zone: "play", attachedToKey: "mineItem" },
      { key: "mineItem", def: item({ name: "MineItem" }), owner: P1, zone: "play" },
      { key: "kill", def: killItem(), owner: P1, zone: "hand" }
    ],
    { random: () => 0.1 }
  );
  play(own.engine, P1, own.id("kill"), { selected: { t: [own.id("sh")] } });
  assert.equal(zoneOf(own.engine, own.id("sh")), "discard");
  assert.equal(controllerOf(own.engine, own.id("mineItem")), P1, "my own item stays mine when the Hand leaves");
});

clause(STICKY, "3:rule", "a returned Hand (lost flip) has left play too: an item I own that the opponent controls comes back to me, its owner", () => {
  const b = stickyBoard({ rng: 0.9, extra: [{ key: "stolen", def: item({ name: "Stolen" }), owner: P1, zone: "play", controller: P2 }] });
  assert.equal(controllerOf(b.engine, b.id("stolen")), P2, "before: the opponent controls my item");
  stickyPlay(b, "stolen");
  assert.equal(zoneOf(b.engine, b.id("sh")), "hand", "the lost flip returned the Hand");
  assert.equal(controllerOf(b.engine, b.id("stolen")), P1, "it left play, so the item's owner takes control");
});

clause(STICKY, "3:rule", "only when THIS card leaves play: another item leaving play leaves the stolen item with me", () => {
  const b = stickyBoard({ inPlay: true, foeItemController: P1, extra: [{ key: "kill", def: killItem(), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("myItem")] } });
  assert.equal(zoneOf(b.engine, b.id("myItem")), "discard", "the other item was destroyed");
  assert.equal(zoneOf(b.engine, b.id("sh")), "play", "the Hand is still in play");
  assert.equal(controllerOf(b.engine, b.id("foeItem")), P1, "control unchanged");
});

clause(STICKY, "3:rule", "the attached item leaving play first (destroyed) does not break the Hand: no pending choice, the Hand no longer in play", () => {
  const b = stickyBoard({ inPlay: true, foeItemController: P1, extra: [{ key: "kill", def: killItem(), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("foeItem")] } });
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("foeItem")), "discard", "the item was destroyed (to its owner's discard)");
  assert.notEqual(zoneOf(b.engine, b.id("sh")), "play", "an attachment cannot stay in play without its host");
});

// =====================================================================================
// Surreptitious Larceny — tactic, rogue, cost 3, [D][D]
// Choose one of the following as this card's rules text:
//  OPTION 1 -- COST: Pick a player. This turn, that player may not play cards using FLIP UP.
//              EFFECT: Look at the top card of any deck.
//  OPTION 2 -- COST: Pick a character. EFFECT: This turn, that character gains COVERT. Draw a card.
//  OPTION 3 -- COST: Pick a "gear" card. Pick a character.
//              EFFECT: Attach the "gear" card to the character. This turn, the "gear" card loses all abilities.
// =====================================================================================

const LARCENY = "d2d83970-7b96-41ba-affd-ac69466455e4";

/** A gear item: +2 strength to its host (continuous) and a free "draw a card" activated ability. */
const gearDef = (name: string): CardDefinition =>
  item({
    name,
    subtype: ["gear"],
    attachTo: "character",
    behavior: {
      abilities: [
        { id: "gear-buff", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 2 }] },
        { id: "gear-draw", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }
      ]
    }
  });
const flippyChar = (name: string): CardDefinition => chr(name, { flipUp: { cost: 0, threshold: 0 } } as Partial<CardDefinition>);
const flippyTac = (name: string): CardDefinition =>
  tactic({ name, cost: 0, flipUp: { cost: 0, threshold: 0 }, behavior: { abilities: [{ id: "ft-draw", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } } as Partial<CardDefinition>);

function larcenyBoard(o: { deception?: number; rage?: number; extra?: CardPlacement[]; active?: PlayerId } = {}) {
  return duo(
    [
      { key: "lar", def: printing(LARCENY), owner: P1, zone: "hand" },
      { key: "mine", def: chr("Mine"), owner: P1, zone: "play" },
      { key: "mine2", def: chr("Mine2"), owner: P1, zone: "play" },
      { key: "foe", def: chr("Foe"), owner: P2, zone: "play" },
      { key: "blk", def: chr("Blk"), owner: P2, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 5 }), owner: P2, zone: "play" },
      { key: "hidden", def: chr("Hidden"), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: chr("InHand"), owner: P1, zone: "hand" },
      { key: "gearA", def: gearDef("GearA"), owner: P1, zone: "play", attachedToKey: "mine" },
      { key: "gearFoe", def: gearDef("GearFoe"), owner: P2, zone: "play", attachedToKey: "foe" },
      { key: "plainItem", def: item({ name: "PlainItem" }), owner: P2, zone: "play" },
      { key: "gearHand", def: gearDef("GearHand"), owner: P1, zone: "hand" },
      { key: "gearDisc", def: gearDef("GearDisc"), owner: P1, zone: "discard" },
      ...fillers("d1_", 4, P1, "deck"),
      ...fillers("d2_", 4, P2, "deck"),
      ...bank("deception", o.deception ?? 3, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.extra ?? [])
    ],
    { active: o.active }
  );
}
type LarcenyBoard = ReturnType<typeof larcenyBoard>;
type Sel = Record<string, CardInstanceId[]>;
const cast = (b: LarcenyBoard, mode: number, selected: Sel): void => play(b.engine, P1, b.id("lar"), { mode, selected });
const castRaw = (b: LarcenyBoard, mode: number, selected: Sel): void => playRaw(b.engine, P1, b.id("lar"), { mode, selected });
const pickPlayer = (b: LarcenyBoard, p: PlayerId): Sel => ({ p: [factionOf(b.engine, p)] });
const handOf = (engine: SpoilsEngine, p: PlayerId): CardInstanceId[] => [...engine.state.players[p].hand];
const deckOf = (engine: SpoilsEngine, p: PlayerId): CardInstanceId[] => [...engine.state.players[p].deck];
/** Answer the "look at the top card" prompt (if any) by putting the card back as it was. */
function settleLook(b: LarcenyBoard, deck: PlayerId = P1): void {
  // "any deck": the caster is first asked whose deck to look at (answered with a faction), then sees its top card.
  const choose = pending(b.engine);
  if (choose && choose.kind === "chooserSelectsTarget") answerPending(b.engine, "chooserSelectsTarget", { selected: [factionOf(b.engine, deck)] });
  const pc = pending(b.engine);
  if (pc && pc.kind === "reorderDeck") answerPending(b.engine, "reorderDeck", { order: [...(pc.cardIds as CardInstanceId[])] });
  assert.equal(pending(b.engine), undefined, "no prompt left");
}
const castLook = (b: LarcenyBoard, pick: PlayerId): void => {
  cast(b, 0, pickPlayer(b, pick));
  settleLook(b);
};

// --- 0:rule — Choose one of the following as this card's rules text -----------------

clause(LARCENY, "0:rule", "exactly three options (0, 1, 2) can be chosen; a fourth or a negative option is refused", () => {
  const b = larcenyBoard();
  refused(() => castRaw(b, 3, { ch: [b.id("mine")] }), "there is no fourth option");
  refused(() => castRaw(b, -1, { ch: [b.id("mine")] }), "a negative option");
  assert.equal(zoneOf(b.engine, b.id("lar")), "hand", "nothing was played");
  castRaw(b, 1, { ch: [b.id("mine")] });
  assert.ok(b.engine.state.responseWindow, "control: option 2 (index 1) is accepted");
});

clause(LARCENY, "0:rule", "each chosen option costs the printed 3 and the tactic ends in the discard pile", () => {
  const sels = (b: LarcenyBoard): Sel[] => [pickPlayer(b, P2), { ch: [b.id("mine2")] }, { g: [b.id("gearFoe")], ch: [b.id("mine2")] }];
  for (const mode of [0, 1, 2]) {
    const b = larcenyBoard();
    const before = ready(b.engine, P1);
    cast(b, mode, sels(b)[mode]);
    settleLook(b);
    assert.equal(before - ready(b.engine, P1), 3, `option ${mode + 1}: cost 3 paid`);
    assert.equal(zoneOf(b.engine, b.id("lar")), "discard", `option ${mode + 1}: the tactic is discarded after resolving`);
  }
});

clause(LARCENY, "0:rule", "every option needs [D][D] and the full 3: one resource short and no deception icons are refused", () => {
  const sels = (b: LarcenyBoard): Sel[] => [pickPlayer(b, P2), { ch: [b.id("mine2")] }, { g: [b.id("gearFoe")], ch: [b.id("mine2")] }];
  for (const mode of [0, 1, 2]) {
    const short = larcenyBoard({ deception: 2 });
    refused(() => castRaw(short, mode, sels(short)[mode]), `option ${mode + 1}: 2 resources for cost 3`);
    assert.equal(zoneOf(short.engine, short.id("lar")), "hand");
    const noIcon = larcenyBoard({ deception: 0, rage: 5 });
    refused(() => castRaw(noIcon, mode, sels(noIcon)[mode]), `option ${mode + 1}: cost covered but no [D][D]`, /threshold/i);
    assert.equal(zoneOf(noIcon.engine, noIcon.id("lar")), "hand");
    const oneIcon = larcenyBoard({ deception: 1, rage: 5 });
    refused(() => castRaw(oneIcon, mode, sels(oneIcon)[mode]), `option ${mode + 1}: only one [D]`, /threshold/i);
    const ok = larcenyBoard({ deception: 2, rage: 1 });
    castRaw(ok, mode, sels(ok)[mode]);
    assert.ok(ok.engine.state.responseWindow, `option ${mode + 1}: control — [D][D] plus a third resource works`);
  }
});

clause(LARCENY, "0:rule", "only the chosen option applies: its picks are all that are needed, and the others' effects do not happen", () => {
  // Option 2 (COVERT + draw): no player pick, no gear pick, no look at a deck, no flip-up ban, nothing attached.
  const b = larcenyBoard({ extra: [{ key: "fdMine", def: flippyChar("FdMine"), owner: P1, zone: "play", faceDown: true }] });
  const top = deckOf(b.engine, P1)[0];
  cast(b, 1, { ch: [b.id("mine2")] });
  assert.equal(pending(b.engine), undefined, "option 1's look-at-a-deck prompt did not appear");
  assert.equal(zoneOf(b.engine, top), "hand", "option 2's draw happened");
  assert.equal(b.engine.state.cards[b.id("gearA")].attachedTo, b.id("mine"), "option 3 did not move the gear");
  flipUp(b.engine, P1, b.id("fdMine"));
  assert.equal(flippedUp(b.engine, b.id("fdMine")), true, "option 1's FLIP UP ban did not apply");
  // Option 1: no draw, no COVERT.
  const c = larcenyBoard();
  const handBefore = handOf(c.engine, P1).length - 1; // minus the tactic that is played
  castLook(c, P1);
  assert.equal(handOf(c.engine, P1).length, handBefore, "option 1 draws nothing");
  assert.equal(c.engine.getKeywords(c.id("mine2")).includes("covert"), false, "option 1 grants no COVERT");
  // Option 3: no draw, no COVERT.
  const d = larcenyBoard();
  const dHand = handOf(d.engine, P1).length - 1;
  cast(d, 2, { g: [d.id("gearFoe")], ch: [d.id("mine2")] });
  assert.equal(pending(d.engine), undefined, "no look prompt");
  assert.equal(handOf(d.engine, P1).length, dHand, "option 3 draws nothing");
  assert.equal(d.engine.getKeywords(d.id("mine2")).includes("covert"), false, "option 3 grants no COVERT");
});

// --- OPTION 1 -----------------------------------------------------------------------

const fdMine = (): CardPlacement => ({ key: "fdMine", def: flippyChar("FdMine"), owner: P1, zone: "play", faceDown: true });
const fdFoe = (): CardPlacement => ({ key: "fdFoe", def: flippyChar("FdFoe"), owner: P2, zone: "play", faceDown: true });
const fdFoeTac = (): CardPlacement => ({ key: "fdTac", def: flippyTac("FdTac"), owner: P2, zone: "play", faceDown: true });

clause(LARCENY, "1:option:OPTION 1", "picking yourself: your own FLIP UP is refused for the rest of the turn (a face-down card stays face-down); without the card it works", () => {
  const b = larcenyBoard({ extra: [fdMine()] });
  castLook(b, P1);
  refused(() => flipUp(b.engine, P1, b.id("fdMine")), "the picked player may not play cards using FLIP UP this turn");
  assert.equal(b.engine.state.cards[b.id("fdMine")].faceDown, true, "it stays face-down");
  const control = larcenyBoard({ extra: [fdMine()] });
  flipUp(control.engine, P1, control.id("fdMine"));
  assert.equal(flippedUp(control.engine, control.id("fdMine")), true, "control: the same flip works with no Larceny");
});

clause(LARCENY, "1:option:OPTION 1", "picking the opponent: their FLIP UP (a face-down tactic inside my attack window) is refused, mine is not, and the same flip works without the card", () => {
  const board = (withLarceny: boolean) => {
    const b = larcenyBoard({ extra: [fdMine(), fdFoeTac()] });
    if (withLarceny) castLook(b, P2);
    return b;
  };
  const b = board(true);
  flipUp(b.engine, P1, b.id("fdMine"));
  assert.equal(flippedUp(b.engine, b.id("fdMine")), true, "the player who was NOT picked can still FLIP UP");
  declareAttackOpenWindow(b.engine, P1, [b.id("mine2")]);
  refused(() => flipUp(b.engine, P2, b.id("fdTac")), "the opponent was picked: no FLIP UP this turn");
  assert.equal(b.engine.state.cards[b.id("fdTac")].faceDown, true, "their card stays face-down");
  const control = board(false);
  declareAttackOpenWindow(control.engine, P1, [control.id("mine2")]);
  flipUp(control.engine, P2, control.id("fdTac"));
  assert.equal(flippedUp(control.engine, control.id("fdTac")), true, "control: without the card the opponent's FLIP UP works in that window");
});

clause(LARCENY, "1:option:OPTION 1", "'this turn': the ban ends — the picked opponent can FLIP UP on their own next turn, and I can on mine after picking myself", () => {
  const theirs = larcenyBoard({ extra: [fdFoe()] });
  castLook(theirs, P2);
  endTurn(theirs.engine, P1);
  assert.equal(theirs.engine.state.activePlayerId, P2, "it is the opponent's turn");
  flipUp(theirs.engine, P2, theirs.id("fdFoe"));
  assert.equal(flippedUp(theirs.engine, theirs.id("fdFoe")), true, "the ban did not outlast my turn");
  const mine = larcenyBoard({ extra: [fdMine()] });
  castLook(mine, P1);
  endTurn(mine.engine, P1);
  endTurn(mine.engine, P2);
  assert.equal(mine.engine.state.activePlayerId, P1, "my next turn");
  flipUp(mine.engine, P1, mine.id("fdMine"));
  assert.equal(flippedUp(mine.engine, mine.id("fdMine")), true, "the ban ended with the turn");
});

clause(LARCENY, "1:option:OPTION 1", "only FLIP UP is banned: the picked player can still deploy cards from hand normally", () => {
  const b = larcenyBoard();
  castLook(b, P1);
  play(b.engine, P1, b.id("inHand"));
  assert.equal(zoneOf(b.engine, b.id("inHand")), "play", "a normal deploy still works");
});

clause(LARCENY, "1:option:OPTION 1", "a player must be picked: a character, an item or a location is refused; either faction is accepted", () => {
  const b = larcenyBoard();
  refused(() => castRaw(b, 0, { p: [b.id("mine")] }), "your character is not a player");
  refused(() => castRaw(b, 0, { p: [b.id("foe")] }), "an opponent's character is not a player");
  refused(() => castRaw(b, 0, { p: [b.id("myItem")] }), "an item is not a player");
  refused(() => castRaw(b, 0, { p: [b.id("place")] }), "a location is not a player");
  refused(() => castRaw(b, 0, {}), "no pick at all");
  assert.equal(zoneOf(b.engine, b.id("lar")), "hand");
  castRaw(b, 0, pickPlayer(b, P2));
  assert.ok(b.engine.state.responseWindow, "control: the opponent's faction is accepted");
  const c = larcenyBoard();
  castRaw(c, 0, pickPlayer(c, P1));
  assert.ok(c.engine.state.responseWindow, "control: your own faction is accepted");
});

clause(LARCENY, "1:option:OPTION 1", "looks at the top card (only one) of a deck and puts it back: the deck is unchanged afterwards", () => {
  const b = larcenyBoard();
  const decks = { [P1]: deckOf(b.engine, P1), [P2]: deckOf(b.engine, P2) };
  cast(b, 0, pickPlayer(b, P2));
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "'any deck': the caster first chooses whose deck to look at");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [factionOf(b.engine, P2)] });
  const pc = pending(b.engine);
  assert.ok(pc, "a look prompt is open");
  assert.equal(pc.kind, "reorderDeck");
  assert.equal(pc.playerId, P1, "the Larceny's controller looks");
  const owner = pc.deckOwnerId as PlayerId;
  assert.deepEqual(pc.cardIds, [decks[owner][0]], "exactly the top card of that deck");
  answerPending(b.engine, "reorderDeck", { order: [...(pc.cardIds as CardInstanceId[])] });
  assert.equal(pending(b.engine), undefined);
  assert.deepEqual(deckOf(b.engine, owner), decks[owner], "the looked-at deck is unchanged");
  assert.deepEqual(deckOf(b.engine, other(owner)), decks[other(owner)], "the other deck is untouched");
});

clause(LARCENY, "1:option:OPTION 1", "'any deck': the caster can look at the top card of the OPPONENT's deck (not only their own)", () => {
  const owners = new Set<string>();
  for (const pick of [P1, P2]) {
    const b = larcenyBoard();
    cast(b, 0, pickPlayer(b, pick));
    const choose = pending(b.engine);
    if (choose && choose.kind === "chooserSelectsTarget") answerPending(b.engine, "chooserSelectsTarget", { selected: [factionOf(b.engine, pick)] });
    const pc = pending(b.engine);
    if (pc && pc.kind === "reorderDeck") {
      owners.add(pc.deckOwnerId as string);
      answerPending(b.engine, "reorderDeck", { order: [...(pc.cardIds as CardInstanceId[])] });
    }
  }
  assert.ok(owners.has(P2), `the opponent's deck can be looked at (decks reachable: ${[...owners].join(", ") || "none"})`);
  assert.ok(owners.has(P1), "and so can the caster's own");
});

clause(LARCENY, "1:option:OPTION 1", "the FLIP UP ban is part of the COST: already in force while the tactic waits for responses", () => {
  const board = (picked: PlayerId) => {
    const b = larcenyBoard({ extra: [fdFoeTac()] });
    castRaw(b, 0, pickPlayer(b, picked));
    return b;
  };
  const control = board(P1);
  assert.ok(control.engine.state.responseWindow, "the tactic waits in the response window");
  flipUp(control.engine, P2, control.id("fdTac"));
  assert.equal(flippedUp(control.engine, control.id("fdTac")), true, "control: with myself picked the opponent's FLIP UP works in the window");
  const b = board(P2);
  refused(() => flipUp(b.engine, P2, b.id("fdTac")), "the cost (the ban) was paid when the card was played");
  assert.equal(b.engine.state.cards[b.id("fdTac")].faceDown, true);
});

// --- OPTION 2 -----------------------------------------------------------------------

clause(LARCENY, "2:option:OPTION 2", "my character gains COVERT this turn (the other characters do not) and I draw a card; the cost 3 is paid", () => {
  const b = larcenyBoard();
  const top = deckOf(b.engine, P1)[0];
  const second = deckOf(b.engine, P1)[1];
  const handBefore = handOf(b.engine, P1).length;
  const oppTop = deckOf(b.engine, P2)[0];
  const before = ready(b.engine, P1);
  assert.equal(b.engine.getKeywords(b.id("mine")).includes("covert"), false, "before: no COVERT");
  cast(b, 1, { ch: [b.id("mine")] });
  assert.equal(pending(b.engine), undefined);
  assert.equal(b.engine.getKeywords(b.id("mine")).includes("covert"), true, "the picked character gained COVERT");
  assert.equal(b.engine.getKeywords(b.id("mine2")).includes("covert"), false, "another of mine did not");
  assert.equal(b.engine.getKeywords(b.id("foe")).includes("covert"), false, "an opponent's did not");
  assert.equal(zoneOf(b.engine, top), "hand", "I drew the top card of my deck");
  assert.equal(zoneOf(b.engine, second), "deck", "and only one card: the next card is still in the deck");
  assert.equal(handOf(b.engine, P1).length, handBefore - 1 + 1, "hand: the tactic left, one card drawn");
  assert.equal(zoneOf(b.engine, oppTop), "deck", "the opponent drew nothing");
  assert.equal(before - ready(b.engine, P1), 3, "cost 3 paid");
});

clause(LARCENY, "2:option:OPTION 2", "an opponent's character can be picked: it gains COVERT and I (the Larceny's controller) draw", () => {
  const b = larcenyBoard();
  const top = deckOf(b.engine, P1)[0];
  const oppTop = deckOf(b.engine, P2)[0];
  cast(b, 1, { ch: [b.id("foe")] });
  assert.equal(b.engine.getKeywords(b.id("foe")).includes("covert"), true);
  assert.equal(b.engine.getKeywords(b.id("blk")).includes("covert"), false, "their other character did not");
  assert.equal(zoneOf(b.engine, top), "hand", "I drew");
  assert.equal(zoneOf(b.engine, oppTop), "deck", "the character's controller did not");
});

clause(LARCENY, "2:option:OPTION 2", "only a character in play can be picked: an item, a location, a faction, a face-down card, or a character in hand are refused", () => {
  const b = larcenyBoard();
  const attempt = (pickId: CardInstanceId) => () => castRaw(b, 1, { ch: [pickId] });
  refused(attempt(b.id("myItem")), "an item");
  refused(attempt(b.id("place")), "a location");
  refused(attempt(factionOf(b.engine, P1)), "my faction");
  refused(attempt(factionOf(b.engine, P2)), "the opponent's faction");
  refused(attempt(b.id("hidden")), "a face-down card is only a resource");
  refused(attempt(b.id("inHand")), "a character in hand");
  refused(() => castRaw(b, 1, {}), "no pick");
  assert.equal(zoneOf(b.engine, b.id("lar")), "hand", "nothing was played");
  attempt(b.id("mine"))();
  assert.ok(b.engine.state.responseWindow, "control: a character in play is accepted");
});

clause(LARCENY, "2:option:OPTION 2", "COVERT works: the covert attacker cannot be blocked by a non-covert character (an ordinary attacker can be)", () => {
  const b = larcenyBoard();
  cast(b, 1, { ch: [b.id("mine")] });
  declareAttackBy(b.engine, P1, [b.id("mine")]);
  refused(() => declareBlockers(b.engine, P2, [b.id("blk")]), "a non-covert character can't block a covert party");
  const control = larcenyBoard();
  declareAttackBy(control.engine, P1, [control.id("mine")]);
  declareBlockers(control.engine, P2, [control.id("blk")]);
  assert.ok(control.engine.state.battle, "control: without COVERT the same blocker can block");
});

clause(LARCENY, "2:option:OPTION 2", "'this turn': COVERT is gone on the opponent's turn and afterwards", () => {
  const b = larcenyBoard();
  cast(b, 1, { ch: [b.id("mine")] });
  assert.equal(b.engine.getKeywords(b.id("mine")).includes("covert"), true, "this turn");
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(b.engine.getKeywords(b.id("mine")).includes("covert"), false, "gone on the opponent's turn");
  endTurn(b.engine, P2);
  assert.equal(b.engine.getKeywords(b.id("mine")).includes("covert"), false, "and on my next turn");
});

// --- OPTION 3 -----------------------------------------------------------------------

clause(LARCENY, "3:option:OPTION 3", "attaches the picked gear card to the picked character (it stays in play) and pays the cost 3", () => {
  const b = larcenyBoard();
  const before = ready(b.engine, P1);
  assert.equal(b.engine.state.cards[b.id("gearA")].attachedTo, b.id("mine"), "before: on Mine");
  cast(b, 2, { g: [b.id("gearA")], ch: [b.id("mine2")] });
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("gearA")), "play");
  assert.equal(b.engine.state.cards[b.id("gearA")].attachedTo, b.id("mine2"), "now attached to the picked character");
  assert.equal(b.engine.state.cards[b.id("gearFoe")].attachedTo, b.id("foe"), "another gear card did not move");
  assert.equal(before - ready(b.engine, P1), 3, "cost 3 paid");
});

clause(LARCENY, "3:option:OPTION 3", "an opponent's gear card can be picked and attached to my character, and my gear to an opponent's character", () => {
  const b = larcenyBoard();
  cast(b, 2, { g: [b.id("gearFoe")], ch: [b.id("mine2")] });
  assert.equal(b.engine.state.cards[b.id("gearFoe")].attachedTo, b.id("mine2"), "their gear is now on my character");
  const c = larcenyBoard();
  cast(c, 2, { g: [c.id("gearA")], ch: [c.id("foe")] });
  assert.equal(c.engine.state.cards[c.id("gearA")].attachedTo, c.id("foe"), "my gear is now on their character");
});

clause(LARCENY, "3:option:OPTION 3", "the picks are validated: a non-gear item, a gear card in hand or discard, a non-character host, or a missing pick are refused", () => {
  const b = larcenyBoard();
  const attempt = (g: CardInstanceId, ch: CardInstanceId) => () => castRaw(b, 2, { g: [g], ch: [ch] });
  refused(attempt(b.id("plainItem"), b.id("mine2")), "an item without the gear subtype");
  refused(attempt(b.id("mine2"), b.id("mine")), "a character is not a gear card");
  refused(attempt(b.id("gearHand"), b.id("mine2")), "a gear card in hand");
  refused(attempt(b.id("gearDisc"), b.id("mine2")), "a gear card in a discard pile");
  refused(attempt(b.id("gearA"), b.id("myItem")), "an item is not a character");
  refused(attempt(b.id("gearA"), b.id("place")), "a location is not a character");
  refused(attempt(b.id("gearA"), factionOf(b.engine, P2)), "a faction is not a character");
  refused(attempt(b.id("gearA"), b.id("hidden")), "a face-down card is not a character");
  refused(() => castRaw(b, 2, { g: [b.id("gearA")] }), "no character picked");
  refused(() => castRaw(b, 2, { ch: [b.id("mine2")] }), "no gear card picked");
  assert.equal(zoneOf(b.engine, b.id("lar")), "hand", "nothing was played");
  attempt(b.id("gearA"), b.id("mine2"))();
  assert.ok(b.engine.state.responseWindow, "control: a gear card and a character are accepted");
});

clause(LARCENY, "3:option:OPTION 3", "'This turn, the gear card loses all abilities': its +2 strength and its activated ability are off this turn", () => {
  const b = larcenyBoard();
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 4, "before: the gear gives its host +2 (printed 2)");
  cast(b, 2, { g: [b.id("gearA")], ch: [b.id("mine2")] });
  assert.equal(b.engine.state.cards[b.id("gearA")].attachedTo, b.id("mine2"), "moved");
  assert.equal(b.engine.getStat(b.id("mine2"), "strength"), 2, "its continuous +2 is off this turn");
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 2, "and the old host has no gear bonus either");
  refused(() => activate(b.engine, P1, b.id("gearA"), "gear-draw"), "its activated ability is gone this turn", /not found/i);
});

clause(LARCENY, "3:option:OPTION 3", "only the picked gear card is affected: another gear card in play keeps its abilities (+2 strength and its activated ability)", () => {
  const b = larcenyBoard();
  cast(b, 2, { g: [b.id("gearFoe")], ch: [b.id("mine2")] });
  assert.equal(b.engine.state.cards[b.id("gearFoe")].attachedTo, b.id("mine2"), "the picked gear moved");
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 4, "my other gear card still gives +2 (printed 2)");
  const top = deckOf(b.engine, P1)[0];
  activate(b.engine, P1, b.id("gearA"), "gear-draw");
  assert.equal(zoneOf(b.engine, top), "hand", "and its activated ability still works");
});

clause(LARCENY, "3:option:OPTION 3", "'this turn': the gear card has its abilities again on my next turn (+2 strength on its new host)", () => {
  const b = larcenyBoard();
  cast(b, 2, { g: [b.id("gearA")], ch: [b.id("mine2")] });
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1, "my next turn");
  assert.equal(b.engine.state.cards[b.id("gearA")].attachedTo, b.id("mine2"), "still attached to the new host");
  assert.equal(b.engine.getStat(b.id("mine2"), "strength"), 4, "its +2 strength is back");
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 2, "the old host no longer has it");
});

// =====================================================================================
// Thabbashite Assailant — character, rogue, subtype assassin, cost 1, [D], str 1 / spd 3 / life 1
// [V]: This card gains 1 life. -- [V][V]: This card gains 1 strength. -- [V][V][V]: This card gains 1 speed.
// -- [V][V][V][V]: This card gains 1 life, 1 strength, and 1 speed.
// Each paragraph is active while its controller meets the threshold (RULES.md §4): they stack.
// Volition = face-down resources.
// =====================================================================================

const ASSAILANT = "f474ddf4-9fa8-44f2-b74c-9eebe554f125";

function assailantBoard(o: { vol?: number; foeVol?: number; banks?: CardPlacement[]; extra?: CardPlacement[] } = {}) {
  return duo([
    { key: "ta", def: printing(ASSAILANT), owner: P1, zone: "play" },
    { key: "other", def: chr("Other"), owner: P1, zone: "play" },
    { key: "foeChar", def: chr("FoeChar"), owner: P2, zone: "play" },
    ...volition(o.vol ?? 0, P1),
    ...volition(o.foeVol ?? 0, P2),
    ...(o.banks ?? []),
    ...(o.extra ?? [])
  ]);
}
/** [strength, speed, life] — the printed order "str / spd / life". */
const statsOf = (engine: SpoilsEngine, cardId: CardInstanceId): number[] => [engine.getStat(cardId, "strength"), engine.getStat(cardId, "speed"), engine.getStat(cardId, "life")];

clause(ASSAILANT, "0:rule@v", "with no Volition it has its printed 1 strength / 3 speed / 1 life", () => {
  const b = assailantBoard();
  assert.deepEqual(statsOf(b.engine, b.id("ta")), [1, 3, 1]);
});

clause(ASSAILANT, "0:rule@v", "deploys for its printed cost 1 with [D]: refused with no resources, with a resource of another icon, and with nothing in hand", () => {
  const deploy = (res: CardPlacement[]) => {
    const b = duo([{ key: "ta", def: printing(ASSAILANT), owner: P1, zone: "hand" }, ...res]);
    return b;
  };
  const ok = deploy(bank("deception", 1));
  const before = ready(ok.engine, P1);
  play(ok.engine, P1, ok.id("ta"));
  assert.equal(zoneOf(ok.engine, ok.id("ta")), "play");
  assert.equal(before - ready(ok.engine, P1), 1, "cost 1 paid");
  assert.deepEqual(statsOf(ok.engine, ok.id("ta")), [1, 3, 1], "printed stats on entering play");
  const none = deploy([]);
  refused(() => play(none.engine, P1, none.id("ta")), "no resources for cost 1");
  assert.equal(zoneOf(none.engine, none.id("ta")), "hand");
  const wrongIcon = deploy(bank("rage", 3));
  refused(() => play(wrongIcon.engine, P1, wrongIcon.id("ta")), "cost covered but no [D]", /threshold/i);
  assert.equal(zoneOf(wrongIcon.engine, wrongIcon.id("ta")), "hand");
});

clause(ASSAILANT, "0:rule@v", "[V] (one Volition): gains exactly 1 life — strength and speed unchanged", () => {
  const b = assailantBoard({ vol: 1 });
  assert.deepEqual(statsOf(b.engine, b.id("ta")), [1, 3, 2]);
});

clause(ASSAILANT, "0:rule@v", "the bonus applies to this card only: another character of mine and the opponent's keep their stats at any Volition", () => {
  const b = assailantBoard({ vol: 4 });
  assert.deepEqual(statsOf(b.engine, b.id("other")), [2, 2, 5], "my other character (printed 2/2/5)");
  assert.deepEqual(statsOf(b.engine, b.id("foeChar")), [2, 2, 5], "the opponent's character");
});

clause(ASSAILANT, "0:rule@v", "only my own face-down resources count: the opponent's Volition, and my face-up resources of any icon, give nothing", () => {
  const foe = assailantBoard({ foeVol: 4 });
  assert.deepEqual(statsOf(foe.engine, foe.id("ta")), [1, 3, 1], "the opponent's four Volition");
  const faceUp = assailantBoard({ banks: [...bank("deception", 2), ...bank("rage", 2), ...bank("greed", 1), ...bank("elitism", 1), ...bank("obsession", 1)] });
  assert.deepEqual(statsOf(faceUp.engine, faceUp.id("ta")), [1, 3, 1], "seven face-up staples, none of them Volition");
});

clause(ASSAILANT, "0:rule@v", "a face-down card of any kind in play counts as a Volition resource (a face-down character here)", () => {
  const b = assailantBoard({ extra: [{ key: "hid", def: chr("Hid"), owner: P1, zone: "play", faceDown: true }] });
  assert.deepEqual(statsOf(b.engine, b.id("ta")), [1, 3, 2], "one face-down card = [V]: +1 life");
});

clause(ASSAILANT, "1:rule@vv", "[V][V] (two Volition): the strength bonus is on in addition to the [V] life: 2 strength, 3 speed, 2 life", () => {
  const b = assailantBoard({ vol: 2 });
  assert.deepEqual(statsOf(b.engine, b.id("ta")), [2, 3, 2]);
});

clause(ASSAILANT, "1:rule@vv", "one Volition is not enough for the strength bonus, and a bonus is not repeated per extra icon", () => {
  const one = assailantBoard({ vol: 1 });
  assert.equal(one.engine.getStat(one.id("ta"), "strength"), 1, "one Volition: strength stays 1");
  const three = assailantBoard({ vol: 3 });
  assert.equal(three.engine.getStat(three.id("ta"), "strength"), 2, "three Volition: [V][V] applies once (+1), not twice");
});

clause(ASSAILANT, "2:rule@vvv", "[V][V][V] (three Volition): the speed bonus joins: 2 strength, 4 speed, 2 life", () => {
  const b = assailantBoard({ vol: 3 });
  assert.deepEqual(statsOf(b.engine, b.id("ta")), [2, 4, 2]);
});

clause(ASSAILANT, "2:rule@vvv", "two Volition are not enough for the speed bonus", () => {
  const b = assailantBoard({ vol: 2 });
  assert.equal(b.engine.getStat(b.id("ta"), "speed"), 3);
});

clause(ASSAILANT, "3:rule@vvvv", "[V][V][V][V] (four Volition): 1 life, 1 strength and 1 speed more on top of the lower paragraphs: 3 strength, 5 speed, 3 life", () => {
  const b = assailantBoard({ vol: 4 });
  assert.deepEqual(statsOf(b.engine, b.id("ta")), [3, 5, 3]);
});

clause(ASSAILANT, "3:rule@vvvv", "three Volition are not enough for the fourth paragraph, and more than four add nothing", () => {
  const three = assailantBoard({ vol: 3 });
  assert.deepEqual(statsOf(three.engine, three.id("ta")), [2, 4, 2], "three: no extra life/strength/speed from the fourth paragraph");
  const six = assailantBoard({ vol: 6 });
  assert.deepEqual(statsOf(six.engine, six.id("ta")), [3, 5, 3], "six Volition: still just once each");
});

clause(ASSAILANT, "3:rule@vvvv", "the paragraphs turn off the instant the Volition is gone: losing resources steps the stats back down 4 -> 3 -> 2 -> 1 -> 0, and gaining them brings them back", () => {
  const vols = volition(4, P1);
  const b = assailantBoard({ extra: vols });
  const expected = [
    [3, 5, 3],
    [2, 4, 2],
    [2, 3, 2],
    [1, 3, 2],
    [1, 3, 1]
  ];
  assert.deepEqual(statsOf(b.engine, b.id("ta")), expected[0]);
  for (let n = 1; n <= 4; n++) {
    b.engine.state.cards[b.id(vols[n - 1].key)].faceDown = false; // it stops providing Volition
    assert.deepEqual(statsOf(b.engine, b.id("ta")), expected[n], `${4 - n} Volition left`);
  }
  for (let n = 4; n >= 1; n--) {
    b.engine.state.cards[b.id(vols[n - 1].key)].faceDown = true;
    assert.deepEqual(statsOf(b.engine, b.id("ta")), expected[n - 1], `${5 - n} Volition again`);
  }
});

// =====================================================================================
// Torchlight District — location, rogue, cost 4, [D][D][D], structure 4
// If a character you control with 3 speed or less attacks, restore it at the end of the battle.
// Characters you control can attack only once each turn.
// =====================================================================================

const TORCH = "eeb9ea10-f9e7-4450-93eb-92e8efa7b074";

const speedy = (name: string, speed: number, over: Partial<CardDefinition> = {}): CardDefinition => chr(name, { strength: 1, life: 5, speed, ...over });

function tdBoard(o: { district?: "torch" | "none"; active?: PlayerId; extra?: CardPlacement[] } = {}) {
  return duo(
    [
      ...(o.district === "none" ? [] : [{ key: "td", def: printing(TORCH), owner: P1, zone: "play" as const }]),
      { key: "a2", def: speedy("A2", 2), owner: P1, zone: "play" },
      { key: "a3", def: speedy("A3", 3), owner: P1, zone: "play" },
      { key: "a4", def: speedy("A4", 4), owner: P1, zone: "play" },
      { key: "a5", def: speedy("A5", 5), owner: P1, zone: "play" },
      { key: "f2", def: speedy("F2", 2), owner: P2, zone: "play" },
      { key: "f4", def: speedy("F4", 4), owner: P2, zone: "play" },
      ...(o.extra ?? [])
    ],
    { active: o.active }
  );
}
type TdBoard = ReturnType<typeof tdBoard>;
const depleted = (b: TdBoard, key: string): boolean => b.engine.state.cards[b.id(key)].depleted;
/** One whole unblocked battle: `who` attacks the other faction with `keys`. */
const attackWith = (b: TdBoard, who: PlayerId, keys: string[]): void => fightThrough(b.engine, who, keys.map((k) => b.id(k)), FACTION(other(who)), []);
/** Stand-in for "something restored it": the character is ready again (the once-per-turn rule must still hold). */
const readyAgain = (b: TdBoard, key: string): void => {
  b.engine.state.cards[b.id(key)].depleted = false;
};
const boots = (name: string, value: number): CardDefinition =>
  item({ name, attachTo: "character", behavior: { abilities: [{ id: "boots", type: "continuous", modifiers: [{ target: "attachedTo", stat: "speed", operation: "add", value }] }] } });

clause(TORCH, "0:rule", "a character I control with speed 3 attacks: depleted during the battle, restored at the END of the battle (not restored without the District)", () => {
  const b = tdBoard();
  declareAttackBy(b.engine, P1, [b.id("a3")]);
  assert.equal(depleted(b, "a3"), true, "attacking depletes it");
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  assert.equal(depleted(b, "a3"), true, "still depleted before the battle ends");
  finishBattle(b.engine);
  assert.equal(depleted(b, "a3"), false, "restored at the end of the battle");
  const control = tdBoard({ district: "none" });
  attackWith(control, P1, ["a3"]);
  assert.equal(depleted(control, "a3"), true, "control: without Torchlight District the survivor stays depleted");
});

clause(TORCH, "0:rule", "speed 2 and 3 are restored (3 or less); speed 4 and 5 are not", () => {
  const result: Record<string, boolean> = {};
  for (const key of ["a2", "a3", "a4", "a5"]) {
    const b = tdBoard();
    attackWith(b, P1, [key]);
    result[key] = !depleted(b, key);
  }
  assert.deepEqual(result, { a2: true, a3: true, a4: false, a5: false }, "which of the attackers were restored (true = ready after the battle)");
});

clause(TORCH, "0:rule", "in a party attack each attacker is judged on its own speed: the slow one is restored, the fast one is not", () => {
  const b = tdBoard();
  attackWith(b, P1, ["a2", "a4"]);
  assert.deepEqual({ a2: !depleted(b, "a2"), a4: !depleted(b, "a4") }, { a2: true, a4: false });
});

clause(TORCH, "0:rule", "uses the attacker's CURRENT speed: -1 speed (to 3) allows the restore, +1 speed (to 4) stops it", () => {
  const slow = tdBoard({ extra: [{ key: "boots", def: boots("Slow", -1), owner: P1, zone: "play", attachedToKey: "a4" }] });
  assert.equal(slow.engine.getStat(slow.id("a4"), "speed"), 3, "the boots make it speed 3");
  const fast = tdBoard({ extra: [{ key: "boots", def: boots("Haste", 1), owner: P1, zone: "play", attachedToKey: "a3" }] });
  assert.equal(fast.engine.getStat(fast.id("a3"), "speed"), 4, "the boots make it speed 4");
  attackWith(slow, P1, ["a4"]);
  attackWith(fast, P1, ["a3"]);
  assert.deepEqual({ slowed: !depleted(slow, "a4"), hasted: !depleted(fast, "a3") }, { slowed: true, hasted: false });
});

clause(TORCH, "0:rule", "'control', not ownership: an opponent-owned character I control is restored", () => {
  const b = tdBoard({ extra: [{ key: "stolen", def: speedy("Stolen", 2), owner: P2, zone: "play", controller: P1 }] });
  attackWith(b, P1, ["stolen"]);
  assert.equal(depleted(b, "stolen"), false, "P2-owned, P1-controlled, speed 2: restored");
});

clause(TORCH, "0:rule", "once the location has left play there is no restore (it restored while in play)", () => {
  const present = tdBoard();
  attackWith(present, P1, ["a2"]);
  assert.equal(depleted(present, "a2"), false, "control: with the District in play the speed-2 attacker is restored");
  const b = tdBoard({ extra: [{ key: "kill", def: killLocation(), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("td")] } });
  assert.notEqual(zoneOf(b.engine, b.id("td")), "play", "the location was destroyed");
  attackWith(b, P1, ["a2"]);
  assert.equal(depleted(b, "a2"), true, "no Torchlight District, no restore");
});

clause(TORCH, "0:rule", "only characters I control: the opponent's slow characters attacking me, and my character they control, are not restored", () => {
  const b = tdBoard({ active: P2, extra: [{ key: "lent", def: speedy("Lent", 2), owner: P1, zone: "play", controller: P2 }] });
  attackWith(b, P2, ["f2"]);
  assert.equal(depleted(b, "f2"), true, "their speed-2 attacker stays depleted");
  const lent = tdBoard({ active: P2, extra: [{ key: "lent", def: speedy("Lent", 2), owner: P1, zone: "play", controller: P2 }] });
  attackWith(lent, P2, ["lent"]);
  assert.equal(depleted(lent, "lent"), true, "P1-owned but P2-controlled: not restored by my District");
});

clause(TORCH, "0:rule", "deploys for its printed cost 4 with [D][D][D] (structure 4): refused one short and without the icons", () => {
  const deploy = (res: CardPlacement[]) => duo([{ key: "td", def: printing(TORCH), owner: P1, zone: "hand" }, ...res]);
  const ok = deploy(bank("deception", 4));
  const before = ready(ok.engine, P1);
  play(ok.engine, P1, ok.id("td"));
  assert.equal(zoneOf(ok.engine, ok.id("td")), "play");
  assert.equal(before - ready(ok.engine, P1), 4, "cost 4 paid");
  assert.equal(ok.engine.getStat(ok.id("td"), "structure"), 4, "printed structure 4");
  const short = deploy(bank("deception", 3));
  refused(() => play(short.engine, P1, short.id("td")), "3 resources for cost 4");
  assert.equal(zoneOf(short.engine, short.id("td")), "hand");
  const noIcons = deploy([...bank("rage", 5)]);
  refused(() => play(noIcons.engine, P1, noIcons.id("td")), "cost covered but no [D][D][D]", /threshold/i);
  const twoIcons = deploy([...bank("deception", 2), ...bank("rage", 3)]);
  refused(() => play(twoIcons.engine, P1, twoIcons.id("td")), "only two [D]", /threshold/i);
  const mixed = deploy([...bank("deception", 3), ...bank("rage", 1)]);
  play(mixed.engine, P1, mixed.id("td"));
  assert.equal(zoneOf(mixed.engine, mixed.id("td")), "play", "control: [D][D][D] plus a fourth resource works");
});

// The restore half of the District is broken (p2-5), so these tests make the character ready again by hand
// ("something restored it") — the once-per-turn rule is independent of how it became ready.

clause(TORCH, "1:rule", "a character I control can attack once: after its attack (made ready again) a second attack in the same turn is refused; another character can still attack", () => {
  const b = tdBoard();
  attackWith(b, P1, ["a3"]);
  readyAgain(b, "a3");
  assert.equal(depleted(b, "a3"), false);
  refused(() => declareAttackBy(b.engine, P1, [b.id("a3")]), "it already attacked this turn");
  assert.equal(b.engine.state.battle, undefined, "no battle started");
  declareAttackBy(b.engine, P1, [b.id("a2")]);
  assert.ok(b.engine.state.battle, "control: another character's first attack goes through");
  const control = tdBoard({ district: "none" });
  attackWith(control, P1, ["a3"]);
  readyAgain(control, "a3");
  declareAttackBy(control.engine, P1, [control.id("a3")]);
  assert.ok(control.engine.state.battle, "control: without the District the same ready-again character can attack twice");
});

clause(TORCH, "1:rule", "applies to characters of every speed (2, 3, 4 and 5): none can attack a second time", () => {
  for (const key of ["a2", "a3", "a4", "a5"]) {
    const b = tdBoard();
    attackWith(b, P1, [key]);
    readyAgain(b, key);
    refused(() => declareAttackBy(b.engine, P1, [b.id(key)]), `${key} already attacked this turn`);
    assert.equal(b.engine.state.battle, undefined, `${key}: no second battle`);
  }
});

clause(TORCH, "1:rule", "a party attack counts for every member: a member of an earlier party cannot attack again alone", () => {
  const b = tdBoard();
  attackWith(b, P1, ["a2", "a3"]);
  readyAgain(b, "a2");
  readyAgain(b, "a3");
  refused(() => declareAttackBy(b.engine, P1, [b.id("a3")]), "a3 already attacked in the party");
  refused(() => declareAttackBy(b.engine, P1, [b.id("a2")]), "a2 already attacked in the party");
  refused(() => declareAttackBy(b.engine, P1, [b.id("a2"), b.id("a3")]), "the same party again");
  declareAttackBy(b.engine, P1, [b.id("a4")]);
  assert.ok(b.engine.state.battle, "control: a character that did not attack still can");
});

clause(TORCH, "1:rule", "'each turn': the limit resets, so the same character can attack again on my next turn", () => {
  const b = tdBoard();
  attackWith(b, P1, ["a3"]);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1, "my next turn");
  declareAttackBy(b.engine, P1, [b.id("a3")]);
  assert.ok(b.engine.state.battle, "its attack on the new turn went through");
});

clause(TORCH, "1:rule", "only characters I control: the opponent's characters can attack twice in a turn", () => {
  const b = tdBoard({ active: P2 });
  attackWith(b, P2, ["f4"]);
  readyAgain(b, "f4");
  declareAttackBy(b.engine, P2, [b.id("f4")]);
  assert.ok(b.engine.state.battle, "their second attack went through");
});

clause(TORCH, "1:rule", "'control', not ownership: a P2-owned character I control is limited, a P1-owned character they control is not", () => {
  const stolen = tdBoard({ extra: [{ key: "stolen", def: speedy("Stolen", 4), owner: P2, zone: "play", controller: P1 }] });
  attackWith(stolen, P1, ["stolen"]);
  readyAgain(stolen, "stolen");
  refused(() => declareAttackBy(stolen.engine, P1, [stolen.id("stolen")]), "second attack by a character I control");
  const lent = tdBoard({ active: P2, extra: [{ key: "lent", def: speedy("Lent", 4), owner: P1, zone: "play", controller: P2 }] });
  attackWith(lent, P2, ["lent"]);
  readyAgain(lent, "lent");
  declareAttackBy(lent.engine, P2, [lent.id("lent")]);
  assert.ok(lent.engine.state.battle, "the opponent's control of my character is not limited by my District");
});

clause(TORCH, "1:rule", "the limit is a static rule: once the District has left play a character can attack again", () => {
  const b = tdBoard({ extra: [{ key: "kill", def: killLocation(), owner: P1, zone: "hand" }] });
  attackWith(b, P1, ["a3"]);
  readyAgain(b, "a3");
  refused(() => declareAttackBy(b.engine, P1, [b.id("a3")]), "limited while the District is in play");
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("td")] } });
  assert.notEqual(zoneOf(b.engine, b.id("td")), "play", "the location was destroyed");
  declareAttackBy(b.engine, P1, [b.id("a3")]);
  assert.ok(b.engine.state.battle, "now its second attack goes through");
});
